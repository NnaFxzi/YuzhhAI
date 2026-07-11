import { describe, expect, test } from 'vitest';

import {
  KNOWLEDGE_CHUNK_OVERLAP_CHARS,
  KNOWLEDGE_CHUNK_TARGET_CHARS,
  KNOWLEDGE_DOCUMENT_LEGACY_SOURCE_PREFIX,
  KNOWLEDGE_GENERAL_JOB_CONCURRENCY,
  KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS,
  KNOWLEDGE_INDEX_WORKER_CLEANUP_BATCH_ROWS,
  KNOWLEDGE_INDEX_WORKER_CLEANUP_YIELD_MS,
  KNOWLEDGE_INDEX_WORKER_WRITE_BATCH_CHUNKS,
  KNOWLEDGE_INDEX_WORKER_WRITER_YIELD_MS,
  KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS,
  KNOWLEDGE_MAX_FILE_BYTES,
  KNOWLEDGE_MAX_SELECTION_FILES,
  KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES,
  KNOWLEDGE_OCR_JOB_CONCURRENCY,
  KNOWLEDGE_SELECTION_TOKEN_TTL_MS,
  KnowledgeBaseIpc,
  KnowledgeDocumentIndexAttemptOutcome,
  KnowledgeDocumentIndexErrorCode,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentIndexTokenizer,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeDocumentVisibility,
  KnowledgeIngestionAttemptOutcome,
  KnowledgeIngestionJobStatus,
  KnowledgeIngestionStage,
  KnowledgeMigrationStatus,
} from './constants';
import type { KnowledgeDocumentListItem } from './types';

describe('knowledge base contracts', () => {
  test('publishes stable local-enterprise status values', () => {
    expect(KnowledgeDocumentSourceMode).toEqual({ Managed: 'managed', Linked: 'linked' });
    expect(KnowledgeDocumentStatus.CompletedWithoutText).toBe('completed_without_text');
    expect(KnowledgeIngestionJobStatus).toEqual({
      Queued: 'queued',
      Running: 'running',
      Completed: 'completed',
      Failed: 'failed',
      Cancelled: 'cancelled',
    });
    expect(KnowledgeIngestionAttemptOutcome.Abandoned).toBe('abandoned');
    expect(KnowledgeIngestionStage.FactExtraction).toBe('fact_extraction');
    expect(KnowledgeMigrationStatus.Completed).toBe('completed');
  });

  test('publishes the approved capacity defaults', () => {
    expect(KNOWLEDGE_MAX_FILE_BYTES).toBe(50 * 1024 * 1024);
    expect(KNOWLEDGE_MAX_SELECTION_FILES).toBe(100);
    expect(KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES).toBe(20 * 1024 * 1024 * 1024);
    expect(KNOWLEDGE_GENERAL_JOB_CONCURRENCY).toBe(2);
    expect(KNOWLEDGE_OCR_JOB_CONCURRENCY).toBe(1);
  });

  test('publishes stable Stage 2 IPC channels and visibility values', () => {
    expect(KnowledgeBaseIpc).toEqual({
      DeleteDocument: 'knowledgeBase:documents:delete',
      GetDocumentDetails: 'knowledgeBase:documents:getDetails',
      ImportSelection: 'knowledgeBase:documents:importSelection',
      ListDocuments: 'knowledgeBase:documents:list',
      RestoreDocument: 'knowledgeBase:documents:restore',
      RetryDocument: 'knowledgeBase:documents:retry',
      RetryLocalIndex: 'knowledgeBase:documents:retryLocalIndex',
      SelectFiles: 'knowledgeBase:files:select',
    });
    expect(KnowledgeDocumentVisibility).toEqual({ Active: 'active', Deleted: 'deleted' });
    expect(KNOWLEDGE_SELECTION_TOKEN_TTL_MS).toBe(5 * 60_000);
    expect(KNOWLEDGE_DOCUMENT_LEGACY_SOURCE_PREFIX).toBe('knowledge-document:');
  });

  test('keeps renderer document DTOs display-safe', () => {
    const item: KnowledgeDocumentListItem = {
      id: 'document-1',
      displayName: 'manual.pdf',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      currentVersionId: 'version-1',
      revision: 1,
      status: KnowledgeDocumentStatus.Pending,
      fileSize: 1024,
      mimeType: 'application/pdf',
      contentHash: 'hash',
      currentJob: null,
      localIndex: null,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
      deletedAt: null,
    };

    expect(item).not.toHaveProperty('originalPath');
    expect(item).not.toHaveProperty('legacySourceId');
    expect(item).not.toHaveProperty('extractedText');
    expect(item).not.toHaveProperty('managedPath');
  });

  test('publishes stable local-index constants and retry channel', () => {
    expect(KnowledgeDocumentIndexStatus).toEqual({
      Pending: 'pending',
      Indexing: 'indexing',
      Indexed: 'indexed',
      NotApplicable: 'not_applicable',
      Failed: 'failed',
    });
    expect(KnowledgeDocumentIndexAttemptOutcome).toEqual({
      Running: 'running',
      Indexed: 'indexed',
      Failed: 'failed',
      Cancelled: 'cancelled',
      Abandoned: 'abandoned',
    });
    expect(KnowledgeDocumentIndexTokenizer).toEqual({
      TrigramV1: 'fts5_trigram_v1',
      CjkBigramV1: 'unicode61_cjk_bigram_v1',
    });
    expect(KnowledgeDocumentIndexErrorCode).toEqual({
      ProcessingFailed: 'index_processing_failed',
      WorkerUnavailable: 'index_worker_unavailable',
      StateConflict: 'index_state_conflict',
    });
    expect(KnowledgeBaseIpc).toEqual({
      DeleteDocument: 'knowledgeBase:documents:delete',
      GetDocumentDetails: 'knowledgeBase:documents:getDetails',
      ImportSelection: 'knowledgeBase:documents:importSelection',
      ListDocuments: 'knowledgeBase:documents:list',
      RestoreDocument: 'knowledgeBase:documents:restore',
      RetryDocument: 'knowledgeBase:documents:retry',
      RetryLocalIndex: 'knowledgeBase:documents:retryLocalIndex',
      SelectFiles: 'knowledgeBase:files:select',
    });
    expect(KNOWLEDGE_CHUNK_TARGET_CHARS).toBe(18_000);
    expect(KNOWLEDGE_CHUNK_OVERLAP_CHARS).toBe(800);
    expect(KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS).toBe(8);
    expect(KNOWLEDGE_INDEX_WORKER_WRITE_BATCH_CHUNKS).toBe(8);
    expect(KNOWLEDGE_INDEX_WORKER_WRITER_YIELD_MS).toBe(1);
    expect(KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS).toBe(64);
    expect(KNOWLEDGE_INDEX_WORKER_CLEANUP_BATCH_ROWS).toBe(64);
    expect(KNOWLEDGE_INDEX_WORKER_CLEANUP_YIELD_MS).toBe(105);
  });

  test('keeps local-index document summaries display-safe', () => {
    const item: KnowledgeDocumentListItem = {
      id: 'document-a',
      displayName: 'manual.pdf',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      currentVersionId: 'version-a',
      revision: 1,
      status: KnowledgeDocumentStatus.Ready,
      fileSize: 100,
      mimeType: 'application/pdf',
      contentHash: 'a'.repeat(64),
      currentJob: null,
      localIndex: {
        documentVersionId: 'version-a',
        status: KnowledgeDocumentIndexStatus.Indexed,
        chunkCount: 4,
        attemptCount: 1,
        errorCode: null,
        updatedAt: '2026-07-11T00:00:00.000Z',
        completedAt: '2026-07-11T00:00:01.000Z',
      },
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:01.000Z',
      deletedAt: null,
    };

    expect(item.localIndex).not.toHaveProperty('activeAttemptId');
    expect(item.localIndex).not.toHaveProperty('heartbeatAt');
    expect(item.localIndex).not.toHaveProperty('tokenizerVersion');
    expect(item.localIndex).not.toHaveProperty('content');
    expect(item.localIndex).not.toHaveProperty('managedPath');
  });
});
