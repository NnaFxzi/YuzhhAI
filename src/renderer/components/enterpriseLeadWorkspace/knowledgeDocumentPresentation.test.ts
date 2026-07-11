import { afterEach, describe, expect, test } from 'vitest';

import {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeIngestionJobStatus,
  KnowledgeIngestionStage,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeDocumentListItem,
  KnowledgeImportBatchResult,
} from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import {
  filterKnowledgeDocuments,
  getKnowledgeDocumentErrorKey,
  getKnowledgeDocumentStatusKey,
  shouldPollKnowledgeDocuments,
  summarizeKnowledgeImportBatch,
} from './knowledgeDocumentPresentation';

const documentItem = (
  overrides: Partial<KnowledgeDocumentListItem> = {},
): KnowledgeDocumentListItem => ({
  id: 'document-1',
  displayName: 'Factory Manual.pdf',
  sourceMode: KnowledgeDocumentSourceMode.Managed,
  currentVersionId: 'version-1',
  revision: 1,
  status: KnowledgeDocumentStatus.Pending,
  fileSize: 100,
  mimeType: 'application/pdf',
  contentHash: 'a'.repeat(64),
  currentJob: {
    id: 'job-1',
    documentVersionId: 'version-1',
    stage: KnowledgeIngestionStage.Queued,
    status: KnowledgeIngestionJobStatus.Queued,
    progress: 0,
    errorCode: null,
    updatedAt: '2026-07-11T00:00:00.000Z',
  },
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  deletedAt: null,
  ...overrides,
});

describe('knowledge document presentation', () => {
  afterEach(() => {
    i18nService.setLanguage('zh', { persist: false });
  });

  test('does not describe no-text completion as searchable success', () => {
    expect(getKnowledgeDocumentStatusKey(KnowledgeDocumentStatus.CompletedWithoutText)).toBe(
      'enterpriseKnowledgeDocumentStatusSavedNotSearchable',
    );
    i18nService.setLanguage('zh', { persist: false });
    expect(i18nService.t('enterpriseKnowledgeDocumentStatusSavedNotSearchable')).toBe(
      '已保存，但不可搜索',
    );
    i18nService.setLanguage('en', { persist: false });
    expect(i18nService.t('enterpriseKnowledgeDocumentStatusSavedNotSearchable')).toBe(
      'Saved, not searchable',
    );
  });

  test('summarizes complete, partial, and failed batches with stable keys', () => {
    const result = (importedCount: number, failedCount: number): KnowledgeImportBatchResult => ({
      importedCount,
      failedCount,
      items: [],
    });

    expect(summarizeKnowledgeImportBatch(result(8, 0))).toEqual({
      key: 'enterpriseKnowledgeImportSuccess',
      values: { imported: 8, failed: 0 },
    });
    expect(summarizeKnowledgeImportBatch(result(8, 2))).toEqual({
      key: 'enterpriseKnowledgeImportPartialSuccess',
      values: { imported: 8, failed: 2 },
    });
    expect(summarizeKnowledgeImportBatch(result(0, 2))).toEqual({
      key: 'enterpriseKnowledgeImportFailed',
      values: { imported: 0, failed: 2 },
    });
  });

  test('polls only while a visible document has queued or running work', () => {
    expect(shouldPollKnowledgeDocuments([documentItem()])).toBe(true);
    expect(
      shouldPollKnowledgeDocuments([
        documentItem({
          currentJob: {
            ...documentItem().currentJob!,
            status: KnowledgeIngestionJobStatus.Running,
          },
        }),
      ]),
    ).toBe(true);
    expect(
      shouldPollKnowledgeDocuments([
        documentItem({
          currentJob: {
            ...documentItem().currentJob!,
            status: KnowledgeIngestionJobStatus.Completed,
          },
        }),
      ]),
    ).toBe(false);
    expect(shouldPollKnowledgeDocuments([documentItem({ currentJob: null })])).toBe(false);
  });

  test('filters by case-insensitive display name, MIME type, and status', () => {
    const failed = documentItem({
      id: 'document-2',
      displayName: 'Customers.csv',
      mimeType: 'text/csv',
      status: KnowledgeDocumentStatus.Failed,
    });

    expect(filterKnowledgeDocuments([documentItem(), failed], 'factory', 'all')).toEqual([
      documentItem(),
    ]);
    expect(
      filterKnowledgeDocuments(
        [documentItem(), failed],
        'TEXT/CSV',
        KnowledgeDocumentStatus.Failed,
      ),
    ).toEqual([failed]);
  });

  test('maps stable service errors to localized message keys', () => {
    expect(getKnowledgeDocumentErrorKey(KnowledgeBaseErrorCode.RevisionConflict)).toBe(
      'enterpriseKnowledgeRevisionConflict',
    );
    expect(getKnowledgeDocumentErrorKey(KnowledgeBaseErrorCode.WorkspaceQuotaExceeded)).toBe(
      'enterpriseKnowledgeErrorQuotaExceeded',
    );
    expect(getKnowledgeDocumentErrorKey(KnowledgeBaseErrorCode.PersistenceFailed)).toBe(
      'enterpriseKnowledgeErrorPersistence',
    );
  });
});
