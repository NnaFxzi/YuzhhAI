import {
  KNOWLEDGE_INDEX_WORKER_CLEANUP_BATCH_ROWS,
  KNOWLEDGE_INDEX_WORKER_WRITE_BATCH_CHUNKS,
  KnowledgeDocumentIndexErrorCode,
} from '../../shared/knowledgeBase/constants';
import { isTransientSqliteBusyError } from '../libs/sqliteTransactionRetry';
import { chunkKnowledgeDocumentVersion } from './knowledgeDocumentChunker';
import {
  KnowledgeDocumentIndexStateError,
  KnowledgeDocumentIndexStore,
} from './knowledgeDocumentIndexStore';
import type { KnowledgeDocumentIndexRunResult } from './knowledgeDocumentIndexTypes';

export interface KnowledgeDocumentIndexRunnerOptions {
  afterSuccessfulWriteBatch?: () => void;
  afterSuccessfulCleanupBatch?: () => void;
}

export const KnowledgeDocumentIndexRunnerLogStage = {
  PersistAttemptFailure: 'persist_attempt_failure',
  ProcessClaim: 'process_claim',
} as const;

export const KnowledgeDocumentIndexRunnerLogCode = {
  FailurePersistenceFailed: 'index_failure_persistence_failed',
} as const;

const purgeInactiveGenerationsUntilIdle = (
  store: KnowledgeDocumentIndexStore,
  options: KnowledgeDocumentIndexRunnerOptions,
): void => {
  while (
    store.purgeInactiveGenerationBatch(KNOWLEDGE_INDEX_WORKER_CLEANUP_BATCH_ROWS) > 0
  ) {
    options.afterSuccessfulCleanupBatch?.();
  }
};

export const runKnowledgeDocumentIndexUntilIdle = (
  store: KnowledgeDocumentIndexStore,
  options: KnowledgeDocumentIndexRunnerOptions = {},
): KnowledgeDocumentIndexRunResult => {
  let indexedCount = 0;
  let failedCount = 0;
  const recoveryNow = new Date();
  store.recoverAbandonedIndexing(
    new Date(recoveryNow.getTime() + 1).toISOString(),
    recoveryNow.toISOString(),
  );
  purgeInactiveGenerationsUntilIdle(store, options);
  let claim = store.claimNext();
  while (claim) {
    try {
      let lastHeartbeat = Date.now();
      const chunks = chunkKnowledgeDocumentVersion({
        documentVersionId: claim.state.documentVersionId,
        text: claim.extractedText,
        onProgress: () => {
          const now = Date.now();
          if (now - lastHeartbeat >= 10_000) {
            store.heartbeat({
              documentVersionId: claim!.state.documentVersionId,
              attemptId: claim!.attempt.id,
            });
            lastHeartbeat = now;
          }
        },
      });
      for (
        let offset = 0;
        offset < chunks.length;
        offset += KNOWLEDGE_INDEX_WORKER_WRITE_BATCH_CHUNKS
      ) {
        store.stageVersionBatch({
          workspaceId: claim.state.workspaceId,
          documentId: claim.state.documentId,
          documentVersionId: claim.state.documentVersionId,
          attemptId: claim.attempt.id,
          chunks: chunks.slice(offset, offset + KNOWLEDGE_INDEX_WORKER_WRITE_BATCH_CHUNKS),
        });
        options.afterSuccessfulWriteBatch?.();
      }
      store.publishVersion({
        workspaceId: claim.state.workspaceId,
        documentId: claim.state.documentId,
        documentVersionId: claim.state.documentVersionId,
        attemptId: claim.attempt.id,
        chunkCount: chunks.length,
      });
      indexedCount += 1;
    } catch (error) {
      if (isTransientSqliteBusyError(error)) {
        throw error;
      }
      const errorCode = error instanceof KnowledgeDocumentIndexStateError
        ? KnowledgeDocumentIndexErrorCode.StateConflict
        : KnowledgeDocumentIndexErrorCode.ProcessingFailed;
      const logIdentity = {
        workspaceId: claim.state.workspaceId,
        documentId: claim.state.documentId,
        documentVersionId: claim.state.documentVersionId,
        attemptId: claim.attempt.id,
      };
      console.error('[KnowledgeDocumentIndex]', {
        ...logIdentity,
        stage: KnowledgeDocumentIndexRunnerLogStage.ProcessClaim,
        code: errorCode,
      });
      try {
        store.failAttempt({
          documentVersionId: claim.state.documentVersionId,
          attemptId: claim.attempt.id,
          errorCode,
        });
      } catch (persistError) {
        if (isTransientSqliteBusyError(persistError)) {
          throw persistError;
        }
        console.warn('[KnowledgeDocumentIndex]', {
          ...logIdentity,
          stage: KnowledgeDocumentIndexRunnerLogStage.PersistAttemptFailure,
          code: KnowledgeDocumentIndexRunnerLogCode.FailurePersistenceFailed,
        });
      }
      failedCount += 1;
    }
    purgeInactiveGenerationsUntilIdle(store, options);
    claim = store.claimNext();
  }
  return { indexedCount, failedCount };
};
