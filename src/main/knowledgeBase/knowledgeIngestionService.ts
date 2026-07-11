import path from 'node:path';

import Database from 'better-sqlite3';

import {
  KNOWLEDGE_GENERAL_JOB_CONCURRENCY,
  KnowledgeBaseErrorCode,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentStatus,
  KnowledgeIngestionJobStatus,
  KnowledgeIngestionStage,
} from '../../shared/knowledgeBase/constants';
import type {
  KnowledgeIngestionJob,
  KnowledgeIngestionJobAttempt,
} from '../../shared/knowledgeBase/types';
import {
  type KnowledgeDocumentIndexStore,
  runTransientSqliteWriteTransactionUntilSuccess,
  type TransientSqliteBusyRetryDelay,
} from './knowledgeDocumentIndexStore';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';
import {
  KnowledgeIngestionJobStateError,
  KnowledgeIngestionJobStore,
} from './knowledgeIngestionJobStore';
import { KnowledgeManagedFileStore } from './knowledgeManagedFileStore';

const OCR_EXTENSIONS = new Set([
  '.bmp',
  '.gif',
  '.heic',
  '.heif',
  '.jpeg',
  '.jpg',
  '.png',
  '.tif',
  '.tiff',
  '.webp',
]);

const SAFE_EXTRACTION_ERROR_MESSAGE = 'Local document extraction failed';

const getSafeErrorCode = (error: unknown): string | null =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof error.code === 'string'
    ? error.code
    : null;

export interface LocalKnowledgeExtractionResult {
  content: string;
  parser: string;
  truncated: boolean;
}

export interface KnowledgeIngestionServiceOptions {
  db: Database.Database;
  documentStore: KnowledgeDocumentStore;
  indexStore: Pick<KnowledgeDocumentIndexStore, 'scheduleCurrentVersion'>;
  jobStore: KnowledgeIngestionJobStore;
  managedFileStore: KnowledgeManagedFileStore;
  extractDocumentText: (
    managedPath: string,
    options: {
      extensionHint: string;
      onProgress?: (progress: number) => void;
    },
  ) => Promise<LocalKnowledgeExtractionResult>;
  onDocumentUpdated?: (workspaceId: string, documentId: string) => void;
  onIndexQueued?: () => void;
  busyRetryDelay?: TransientSqliteBusyRetryDelay;
}

export class KnowledgeIngestionService {
  private drainPromise: Promise<void> | null = null;

  private wakeRequested = false;

  private indexWakeRequested = false;

  private ocrTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: KnowledgeIngestionServiceOptions) {}

  wake(): void {
    this.wakeRequested = true;
    if (this.drainPromise) {
      return;
    }
    const running = this.runUntilIdle();
    let tracked!: Promise<void>;
    tracked = running.finally(() => {
      if (this.drainPromise !== tracked) {
        return;
      }
      this.drainPromise = null;
      if (this.wakeRequested) {
        this.wake();
      }
    });
    this.drainPromise = tracked;
  }

  async waitForIdle(): Promise<void> {
    while (this.drainPromise) {
      await this.drainPromise;
    }
  }

  private async runUntilIdle(): Promise<void> {
    do {
      this.wakeRequested = false;
      await Promise.all(
        Array.from({ length: KNOWLEDGE_GENERAL_JOB_CONCURRENCY }, () => this.runWorker()),
      );
    } while (this.wakeRequested);
    if (this.indexWakeRequested) {
      this.indexWakeRequested = false;
      this.notifyIndexQueued();
    }
  }

  private async runWorker(): Promise<void> {
    let claim = await runTransientSqliteWriteTransactionUntilSuccess(
      () => this.options.jobStore.claimNextJob(),
      this.options.busyRetryDelay,
    );
    while (claim) {
      await this.processClaim(claim.job, claim.attempt);
      claim = await runTransientSqliteWriteTransactionUntilSuccess(
        () => this.options.jobStore.claimNextJob(),
        this.options.busyRetryDelay,
      );
    }
  }

  private async processClaim(
    job: KnowledgeIngestionJob,
    attempt: KnowledgeIngestionJobAttempt,
  ): Promise<void> {
    try {
      const document = this.options.documentStore.getDocument(job.documentId);
      const version = this.options.documentStore.getVersion(job.documentVersionId);
      if (!document || !version?.managedPath) {
        throw new Error('Managed document target is unavailable');
      }

      const extensionHint = path.extname(document.displayName).toLowerCase();
      const isOcr = OCR_EXTENSIONS.has(extensionHint);
      this.options.jobStore.updateStage(
        job.id,
        attempt.id,
        isOcr ? KnowledgeIngestionStage.Ocr : KnowledgeIngestionStage.Parsing,
      );
      if (
        !this.options.documentStore.setDocumentStatusIfCurrentVersion({
          documentId: document.id,
          documentVersionId: version.id,
          status: KnowledgeDocumentStatus.Processing,
        })
      ) {
        this.options.jobStore.cancel(job.id);
        return;
      }
      if (this.options.onDocumentUpdated) {
        await this.notifyDocumentUpdated(job.workspaceId, job.documentId);
      }

      const extract = (): Promise<LocalKnowledgeExtractionResult> =>
        this.options.extractDocumentText(
          this.options.managedFileStore.resolveManagedPath(version.managedPath!),
          {
            extensionHint,
            ...(isOcr
              ? {
                  onProgress: (progress: number): void => {
                    try {
                      this.options.jobStore.heartbeat(job.id, attempt.id, progress);
                    } catch (error) {
                      if (!(error instanceof KnowledgeIngestionJobStateError)) {
                        throw error;
                      }
                    }
                  },
                }
              : {}),
          },
        );
      const extraction = isOcr ? await this.withOcrPermit(extract) : await extract();
      const extractedText = extraction.content.trim();
      const status = extractedText
        ? KnowledgeDocumentStatus.Ready
        : KnowledgeDocumentStatus.CompletedWithoutText;

      const commit = this.options.db.transaction(() => {
        const applied = this.options.documentStore.applyExtractionResult({
          documentId: document.id,
          documentVersionId: version.id,
          parser: extraction.parser,
          extractedText: extractedText || null,
          extractionPartial: extraction.truncated,
          status,
        });
        if (!applied) {
          this.options.jobStore.cancel(job.id);
          return null;
        }
        this.options.jobStore.complete(job.id, attempt.id);
        return this.options.indexStore.scheduleCurrentVersion({
          workspaceId: job.workspaceId,
          documentId: job.documentId,
          documentVersionId: job.documentVersionId,
        });
      });
      const committed = await runTransientSqliteWriteTransactionUntilSuccess(
        commit,
        this.options.busyRetryDelay,
      );
      if (committed) {
        if (this.options.onDocumentUpdated) {
          await this.notifyDocumentUpdated(job.workspaceId, job.documentId);
        }
        if (committed.status === KnowledgeDocumentIndexStatus.Pending) {
          this.indexWakeRequested = true;
        }
      }
    } catch (error) {
      await this.failClaim(job, attempt, error);
    }
  }

  private async failClaim(
    job: KnowledgeIngestionJob,
    attempt: KnowledgeIngestionJobAttempt,
    processingError: unknown,
  ): Promise<void> {
    try {
      const persistFailure = this.options.db.transaction(() => {
        const currentJob = this.options.jobStore.getJob(job.id);
        if (currentJob?.status !== KnowledgeIngestionJobStatus.Running) {
          return false;
        }
        const statusUpdated = this.options.documentStore.setDocumentStatusIfCurrentVersion({
          documentId: job.documentId,
          documentVersionId: job.documentVersionId,
          status: KnowledgeDocumentStatus.Failed,
        });
        if (!statusUpdated) {
          this.options.jobStore.cancel(job.id);
          return false;
        }
        this.options.jobStore.fail(job.id, attempt.id, {
          code: KnowledgeBaseErrorCode.IngestionFailed,
          message: SAFE_EXTRACTION_ERROR_MESSAGE,
        });
        return true;
      });
      const failed = await runTransientSqliteWriteTransactionUntilSuccess(
        persistFailure,
        this.options.busyRetryDelay,
      );
      if (failed) {
        if (this.options.onDocumentUpdated) {
          await this.notifyDocumentUpdated(job.workspaceId, job.documentId);
        }
      }
    } catch (error) {
      console.error('[KnowledgeBase] Failed to persist ingestion failure:', {
        processingErrorCode: getSafeErrorCode(processingError),
        persistenceErrorCode: getSafeErrorCode(error),
      });
    }
  }

  private async withOcrPermit<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.ocrTail;
    this.ocrTail = new Promise<void>(resolve => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async notifyDocumentUpdated(workspaceId: string, documentId: string): Promise<void> {
    try {
      await runTransientSqliteWriteTransactionUntilSuccess(
        () => this.options.onDocumentUpdated?.(workspaceId, documentId),
        this.options.busyRetryDelay,
      );
    } catch (error) {
      console.warn('[KnowledgeBase] Failed to update compatibility projection:', {
        errorCode: getSafeErrorCode(error),
      });
    }
  }

  private notifyIndexQueued(): void {
    try {
      this.options.onIndexQueued?.();
    } catch (error) {
      console.warn('[KnowledgeBase] Failed to wake local index worker:', error);
    }
  }
}
