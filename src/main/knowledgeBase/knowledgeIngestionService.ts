import path from 'node:path';

import Database from 'better-sqlite3';

import {
  KNOWLEDGE_GENERAL_JOB_CONCURRENCY,
  KnowledgeBaseErrorCode,
  KnowledgeDocumentStatus,
  KnowledgeIngestionJobStatus,
  KnowledgeIngestionStage,
} from '../../shared/knowledgeBase/constants';
import type {
  KnowledgeIngestionJob,
  KnowledgeIngestionJobAttempt,
} from '../../shared/knowledgeBase/types';
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

export interface LocalKnowledgeExtractionResult {
  content: string;
  parser: string;
  truncated: boolean;
}

export interface KnowledgeIngestionServiceOptions {
  db: Database.Database;
  documentStore: KnowledgeDocumentStore;
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
}

export class KnowledgeIngestionService {
  private drainPromise: Promise<void> | null = null;

  private wakeRequested = false;

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
  }

  private async runWorker(): Promise<void> {
    let claim = this.options.jobStore.claimNextJob();
    while (claim) {
      await this.processClaim(claim.job, claim.attempt);
      claim = this.options.jobStore.claimNextJob();
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
      this.notifyDocumentUpdated(job.workspaceId, job.documentId);

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

      const committed = this.options.db.transaction(() => {
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
          return false;
        }
        this.options.jobStore.complete(job.id, attempt.id);
        return true;
      })();
      if (committed) {
        this.notifyDocumentUpdated(job.workspaceId, job.documentId);
      }
    } catch {
      this.failClaim(job, attempt);
    }
  }

  private failClaim(job: KnowledgeIngestionJob, attempt: KnowledgeIngestionJobAttempt): void {
    try {
      const failed = this.options.db.transaction(() => {
        const statusUpdated = this.options.documentStore.setDocumentStatusIfCurrentVersion({
          documentId: job.documentId,
          documentVersionId: job.documentVersionId,
          status: KnowledgeDocumentStatus.Failed,
        });
        const currentJob = this.options.jobStore.getJob(job.id);
        if (currentJob?.status !== KnowledgeIngestionJobStatus.Running) {
          return false;
        }
        if (!statusUpdated) {
          this.options.jobStore.cancel(job.id);
          return false;
        }
        this.options.jobStore.fail(job.id, attempt.id, {
          code: KnowledgeBaseErrorCode.IngestionFailed,
          message: SAFE_EXTRACTION_ERROR_MESSAGE,
        });
        return true;
      })();
      if (failed) {
        this.notifyDocumentUpdated(job.workspaceId, job.documentId);
      }
    } catch (error) {
      console.error('[KnowledgeBase] Failed to persist ingestion failure:', error);
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

  private notifyDocumentUpdated(workspaceId: string, documentId: string): void {
    try {
      this.options.onDocumentUpdated?.(workspaceId, documentId);
    } catch (error) {
      console.warn('[KnowledgeBase] Failed to update compatibility projection:', error);
    }
  }
}
