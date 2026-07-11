import { describe, expect, test } from 'vitest';

import {
  KNOWLEDGE_DOCUMENT_LEGACY_SOURCE_PREFIX,
  KNOWLEDGE_GENERAL_JOB_CONCURRENCY,
  KNOWLEDGE_MAX_FILE_BYTES,
  KNOWLEDGE_MAX_SELECTION_FILES,
  KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES,
  KNOWLEDGE_OCR_JOB_CONCURRENCY,
  KNOWLEDGE_SELECTION_TOKEN_TTL_MS,
  KnowledgeBaseIpc,
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
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
      deletedAt: null,
    };

    expect(item).not.toHaveProperty('originalPath');
    expect(item).not.toHaveProperty('legacySourceId');
    expect(item).not.toHaveProperty('extractedText');
    expect(item).not.toHaveProperty('managedPath');
  });
});
