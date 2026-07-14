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
  isTransientSqliteBusyError,
  runTransientSqliteWriteTransactionUntilSuccess,
} from '../libs/sqliteTransactionRetry';
import type { KnowledgeDocumentIndexStore } from './knowledgeDocumentIndexStore';
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

const SAFE_INGESTION_LOG_ERROR_CODES = new Set<string>([
  ...Object.values(KnowledgeBaseErrorCode),
  'SQLITE_BUSY',
  'SQLITE_BUSY_SNAPSHOT',
  'SQLITE_CONSTRAINT',
]);

const getSafeErrorCode = (error: unknown): string | null =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof error.code === 'string' &&
  SAFE_INGESTION_LOG_ERROR_CODES.has(error.code)
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
  indexStore: Pick<KnowledgeDocumentIndexStore, 'scheduleCurrentVersionInCurrentTransaction'>;
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
  updateCompatibilityProjectionInCurrentTransaction?: (
    workspaceId: string,
    documentId: string,
  ) => void;
  replaceWorkspaceDocumentSource?: (
    workspaceId: string,
    documentId: string,
  ) => unknown;
  replaceWorkspaceDocumentSources?: (workspaceId: string) => unknown;
  onIndexQueued?: () => void;
  busyRetryDelay?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

const INGESTION_SHUTDOWN = Symbol('knowledge-ingestion-shutdown');

export class KnowledgeIngestionService {
  private drainPromise: Promise<void> | null = null;

  private wakeRequested = false;

  private indexWakeRequested = false;

  private ocrTail: Promise<void> = Promise.resolve();

  private readonly shutdownController = new AbortController();

  private closing = false;

  private shutdownPromise: Promise<void> | null = null;

  constructor(private readonly options: KnowledgeIngestionServiceOptions) {}

  wake(): void {
    if (this.closing) return;
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

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.closing = true;
    this.wakeRequested = false;
    this.indexWakeRequested = false;
    this.shutdownController.abort(INGESTION_SHUTDOWN);
    const pending = this.drainPromise ?? Promise.resolve();
    this.shutdownPromise = pending.catch(error => {
      if (!this.isShutdownError(error)) throw error;
    });
    return this.shutdownPromise;
  }

  private async runUntilIdle(): Promise<void> {
    do {
      if (this.closing) return;
      this.wakeRequested = false;
      await Promise.all(
        Array.from({ length: KNOWLEDGE_GENERAL_JOB_CONCURRENCY }, () => this.runWorker()),
      );
    } while (this.wakeRequested);
    if (this.indexWakeRequested && !this.closing) {
      this.indexWakeRequested = false;
      this.notifyIndexQueued();
    }
  }

  private async runWorker(): Promise<void> {
    let claim = await this.runWriteUntilSuccess(() => this.options.jobStore.claimNextJob());
    while (claim && !this.closing) {
      await this.processClaim(claim.job, claim.attempt);
      if (this.closing) return;
      await new Promise<void>(resolve => setImmediate(resolve));
      claim = await this.runWriteUntilSuccess(() => this.options.jobStore.claimNextJob());
    }
  }

  private async processClaim(
    job: KnowledgeIngestionJob,
    attempt: KnowledgeIngestionJobAttempt,
  ): Promise<void> {
    if (this.closing) return;
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
      if (this.closing) return;
      const extractedText = extraction.content.trim();
      const status = extractedText
        ? KnowledgeDocumentStatus.Ready
        : KnowledgeDocumentStatus.CompletedWithoutText;

      const commit = this.options.db.transaction(() => {
        const applied = this.options.documentStore.applyExtractionResultInCurrentTransaction({
          documentId: document.id,
          documentVersionId: version.id,
          parser: extraction.parser,
          extractedText: extractedText || null,
          extractionPartial: extraction.truncated,
          status,
        });
        if (!applied) {
          this.options.jobStore.cancelInCurrentTransaction(job.id);
          return null;
        }
        this.options.jobStore.completeInCurrentTransaction(job.id, attempt.id);
        const indexState = this.options.indexStore.scheduleCurrentVersionInCurrentTransaction({
          workspaceId: job.workspaceId,
          documentId: job.documentId,
          documentVersionId: job.documentVersionId,
        });
        if (this.options.updateCompatibilityProjectionInCurrentTransaction) {
          this.options.updateCompatibilityProjectionInCurrentTransaction(
            job.workspaceId,
            job.documentId,
          );
        }
        return indexState;
      });
      const committed = await this.runWriteUntilSuccess(commit);
      if (committed) {
        if (this.closing) return;
        if (status === KnowledgeDocumentStatus.Ready && extractedText) {
          await this.notifyRawSource(job.workspaceId, job.documentId);
        }
        if (!this.closing && this.options.onDocumentUpdated) {
          await this.notifyDocumentUpdated(job.workspaceId, job.documentId);
        }
        if (!this.closing && committed.status === KnowledgeDocumentIndexStatus.Pending) {
          this.indexWakeRequested = true;
        }
      }
    } catch (error) {
      if (this.closing || this.isShutdownError(error)) return;
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
          this.options.jobStore.cancelInCurrentTransaction(job.id);
          return false;
        }
        this.options.jobStore.failInCurrentTransaction(job.id, attempt.id, {
          code: KnowledgeBaseErrorCode.IngestionFailed,
          message: SAFE_EXTRACTION_ERROR_MESSAGE,
        });
        if (this.options.updateCompatibilityProjectionInCurrentTransaction) {
          try {
          this.options.updateCompatibilityProjectionInCurrentTransaction?.(
            job.workspaceId,
            job.documentId,
          );
          } catch (error) {
            if (isTransientSqliteBusyError(error)) throw error;
            console.warn('[KnowledgeIngestion]', {
              code: 'compatibility_projection_failed',
            });
          }
        }
        return true;
      });
      const failed = await this.runWriteUntilSuccess(persistFailure);
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
    if (this.closing) throw INGESTION_SHUTDOWN;
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

  private async notifyRawSource(workspaceId: string, documentId: string): Promise<void> {
    try {
      await this.options.replaceWorkspaceDocumentSource?.(workspaceId, documentId);
    } catch {
      console.warn('[KnowledgeIngestion]', { code: 'raw_source_refresh_failed' });
    }
  }

  private notifyIndexQueued(): void {
    try {
      this.options.onIndexQueued?.();
    } catch {
      console.warn('[KnowledgeIngestion]', { code: 'index_worker_wake_failed' });
    }
  }

  private async runWriteUntilSuccess<T>(run: () => T): Promise<T> {
    return runTransientSqliteWriteTransactionUntilSuccess(
      run,
      delayMs => this.waitForBusyRetry(delayMs),
    );
  }

  private async waitForBusyRetry(delayMs: number): Promise<void> {
    if (this.closing) throw INGESTION_SHUTDOWN;
    if (this.options.busyRetryDelay) {
      await this.options.busyRetryDelay(delayMs, this.shutdownController.signal);
      if (this.closing) throw INGESTION_SHUTDOWN;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const signal = this.shutdownController.signal;
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const cleanup = (): void => {
        signal.removeEventListener('abort', abort);
        if (timeout !== null) {
          clearTimeout(timeout);
          timeout = null;
        }
      };
      const complete = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const abort = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(INGESTION_SHUTDOWN);
      };
      timeout = setTimeout(complete, delayMs);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }

  private isShutdownError(error: unknown): boolean {
    return error === INGESTION_SHUTDOWN || (
      this.closing && this.shutdownController.signal.aborted
    );
  }
}
