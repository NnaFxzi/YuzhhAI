import {
  KNOWLEDGE_INDEX_WORKER_CLEANUP_BATCH_ROWS,
  KNOWLEDGE_INDEX_WORKER_WRITE_BATCH_CHUNKS,
  KnowledgeDocumentIndexErrorCode,
} from '../../shared/knowledgeBase/constants';
import { chunkKnowledgeDocumentVersion } from './knowledgeDocumentChunker';
import {
  isTransientSqliteBusyError,
  KnowledgeDocumentIndexStateError,
  KnowledgeDocumentIndexStore,
} from './knowledgeDocumentIndexStore';
import type { KnowledgeDocumentIndexRunResult } from './knowledgeDocumentIndexTypes';

export interface KnowledgeDocumentIndexRunnerOptions {
  afterSuccessfulWriteBatch?: () => void;
  afterSuccessfulCleanupBatch?: () => void;
}

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
      console.error('[KnowledgeBase] Local index attempt failed:', error);
      try {
        store.failAttempt({
          documentVersionId: claim.state.documentVersionId,
          attemptId: claim.attempt.id,
          errorCode: error instanceof KnowledgeDocumentIndexStateError
            ? KnowledgeDocumentIndexErrorCode.StateConflict
            : KnowledgeDocumentIndexErrorCode.ProcessingFailed,
        });
      } catch (persistError) {
        if (isTransientSqliteBusyError(persistError)) {
          throw persistError;
        }
        console.warn('[KnowledgeBase] Failed to persist local index attempt failure:', persistError);
      }
      failedCount += 1;
    }
    purgeInactiveGenerationsUntilIdle(store, options);
    claim = store.claimNext();
  }
  return { indexedCount, failedCount };
};
