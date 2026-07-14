import { afterEach, describe, expect, test } from 'vitest';

import {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeEnrichmentStatus,
  KnowledgeIngestionJobStatus,
  KnowledgeIngestionStage,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeDocumentIndexSummary,
  KnowledgeDocumentListItem,
  KnowledgeEnrichmentSummary,
  KnowledgeImportBatchResult,
} from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import {
  canRetryKnowledgeDocumentIndex,
  filterKnowledgeDocuments,
  getKnowledgeDocumentErrorKey,
  getKnowledgeDocumentExtractionPresentation,
  getKnowledgeDocumentIndexStatusKey,
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
  localIndex: null,
  enrichment: null,
  hasStalePriorVersionExtraction: false,
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  deletedAt: null,
  ...overrides,
});

const createIndexSummary = (
  status: KnowledgeDocumentIndexStatus,
  overrides: Partial<KnowledgeDocumentIndexSummary> = {},
): KnowledgeDocumentIndexSummary => ({
  documentVersionId: 'version-a',
  status,
  chunkCount: 0,
  attemptCount: 1,
  errorCode: null,
  updatedAt: '2026-07-11T00:00:00.000Z',
  completedAt: null,
  ...overrides,
});

const createEnrichmentSummary = (
  status: KnowledgeEnrichmentStatus,
  overrides: Partial<KnowledgeEnrichmentSummary> = {},
): KnowledgeEnrichmentSummary => ({
  requestId: 'request-a',
  documentId: 'document-1',
  documentVersionId: 'version-1',
  status,
  progress: 0.4,
  revision: 1,
  attemptCount: 1,
  validCandidateCount: 2,
  discardedCandidateCount: 0,
  pendingFactCount: 2,
  partialReasons: [],
  errorCode: null,
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:01:00.000Z',
  completedAt: null,
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

  test.each([
    [KnowledgeDocumentIndexStatus.Pending, 'enterpriseKnowledgeLocalIndexStatusPending'],
    [KnowledgeDocumentIndexStatus.Indexing, 'enterpriseKnowledgeLocalIndexStatusIndexing'],
    [KnowledgeDocumentIndexStatus.Indexed, 'enterpriseKnowledgeLocalIndexStatusIndexed'],
    [
      KnowledgeDocumentIndexStatus.NotApplicable,
      'enterpriseKnowledgeLocalIndexStatusNotApplicable',
    ],
    [KnowledgeDocumentIndexStatus.Failed, 'enterpriseKnowledgeLocalIndexStatusFailed'],
  ])('maps local-index status %s to %s', (status, key) => {
    expect(getKnowledgeDocumentIndexStatusKey(status)).toBe(key);
  });

  test.each([
    KnowledgeDocumentIndexStatus.Pending,
    KnowledgeDocumentIndexStatus.Indexing,
  ])('polls while local indexing is %s even after ingestion completes', status => {
    expect(
      shouldPollKnowledgeDocuments([
        documentItem({
          currentJob: null,
          localIndex: createIndexSummary(status),
        }),
      ]),
    ).toBe(true);
  });

  test.each([
    KnowledgeDocumentIndexStatus.Indexed,
    KnowledgeDocumentIndexStatus.NotApplicable,
    KnowledgeDocumentIndexStatus.Failed,
  ])('stops polling when local indexing is terminal: %s', status => {
    expect(
      shouldPollKnowledgeDocuments([
        documentItem({
          currentJob: null,
          localIndex: createIndexSummary(status),
        }),
      ]),
    ).toBe(false);
  });

  test('allows local-index retry only for an active failed current version', () => {
    const failed = documentItem({
      currentVersionId: 'version-a',
      deletedAt: null,
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Failed, {
        documentVersionId: 'version-a',
      }),
    });

    expect(canRetryKnowledgeDocumentIndex(failed)).toBe(true);
    expect(
      canRetryKnowledgeDocumentIndex({
        ...failed,
        deletedAt: '2026-07-11T00:00:00.000Z',
      }),
    ).toBe(false);
    expect(
      canRetryKnowledgeDocumentIndex({
        ...failed,
        localIndex: { ...failed.localIndex!, documentVersionId: 'old-version' },
      }),
    ).toBe(false);
  });

  test('keeps parsing, local indexing, and AI extraction as independent states', () => {
    const document = documentItem({
      status: KnowledgeDocumentStatus.Failed,
      currentJob: {
        ...documentItem().currentJob!,
        status: KnowledgeIngestionJobStatus.Failed,
        errorCode: 'unsafe /private/path stack',
      },
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed, {
        documentVersionId: 'version-1',
        chunkCount: 8,
      }),
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Completed),
    });

    const presentation = getKnowledgeDocumentExtractionPresentation(document);

    expect(getKnowledgeDocumentStatusKey(document.status)).toBe(
      'enterpriseKnowledgeDocumentStatusFailed',
    );
    expect(getKnowledgeDocumentIndexStatusKey(document.localIndex!.status)).toBe(
      'enterpriseKnowledgeLocalIndexStatusIndexed',
    );
    expect(presentation.statusKey).toBe('enterpriseKnowledgeAiExtractionStatusCompleted');
    expect(presentation).toMatchObject({
      canPrepare: false,
      canRetry: false,
      canCancel: false,
    });
    expect(JSON.stringify(presentation)).not.toContain('/private/path');
  });

  test.each([
    [KnowledgeEnrichmentStatus.Queued, false, false, true],
    [KnowledgeEnrichmentStatus.Running, false, false, true],
    [KnowledgeEnrichmentStatus.ReviewRequired, false, false, false],
    [KnowledgeEnrichmentStatus.Completed, false, false, false],
    [KnowledgeEnrichmentStatus.Failed, false, true, false],
    [KnowledgeEnrichmentStatus.Cancelled, false, true, false],
    [KnowledgeEnrichmentStatus.Stale, false, true, false],
  ])(
    'maps current enrichment %s to independent prepare/retry/cancel controls',
    (status, canPrepare, canRetry, canCancel) => {
      const document = documentItem({
        status: KnowledgeDocumentStatus.Ready,
        currentJob: null,
        localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed, {
          documentVersionId: 'version-1',
        }),
        enrichment: createEnrichmentSummary(status),
      });

      expect(getKnowledgeDocumentExtractionPresentation(document)).toMatchObject({
        statusKey: `enterpriseKnowledgeAiExtractionStatus${
          status === KnowledgeEnrichmentStatus.ReviewRequired
            ? 'ReviewRequired'
            : status.charAt(0).toUpperCase() + status.slice(1)
        }`,
        canPrepare,
        canRetry,
        canCancel,
        showsStalePriorVersion: false,
      });
    },
  );

  test('offers current-version extraction only when no current enrichment exists', () => {
    const eligible = documentItem({
      status: KnowledgeDocumentStatus.Ready,
      currentJob: null,
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed, {
        documentVersionId: 'version-1',
      }),
      enrichment: null,
      hasStalePriorVersionExtraction: true,
    });
    const withCurrent = {
      ...eligible,
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Queued),
    };

    expect(getKnowledgeDocumentExtractionPresentation(eligible)).toMatchObject({
      statusKey: 'enterpriseKnowledgeAiExtractionStatusStalePriorVersion',
      canPrepare: true,
      canRetry: false,
      canCancel: false,
      showsStalePriorVersion: true,
    });
    expect(getKnowledgeDocumentExtractionPresentation(withCurrent)).toMatchObject({
      statusKey: 'enterpriseKnowledgeAiExtractionStatusQueued',
      canPrepare: false,
      canCancel: true,
      showsStalePriorVersion: false,
    });
  });

  test('requires a ready current local index before preparing or retrying paid extraction', () => {
    const noIndex = documentItem({ status: KnowledgeDocumentStatus.Ready, currentJob: null });
    const failedIndex = documentItem({
      status: KnowledgeDocumentStatus.Ready,
      currentJob: null,
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Failed, {
        documentVersionId: 'version-1',
      }),
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Failed),
    });
    const oldIndex = documentItem({
      status: KnowledgeDocumentStatus.Ready,
      currentJob: null,
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed, {
        documentVersionId: 'old-version',
      }),
    });

    expect(getKnowledgeDocumentExtractionPresentation(noIndex).canPrepare).toBe(false);
    expect(getKnowledgeDocumentExtractionPresentation(failedIndex).canRetry).toBe(false);
    expect(getKnowledgeDocumentExtractionPresentation(oldIndex).canPrepare).toBe(false);
  });

  test.each([KnowledgeEnrichmentStatus.Queued, KnowledgeEnrichmentStatus.Running])(
    'polls while current AI extraction is %s',
    status => {
      expect(
        shouldPollKnowledgeDocuments([
          documentItem({
            currentJob: null,
            localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed, {
              documentVersionId: 'version-1',
            }),
            enrichment: createEnrichmentSummary(status),
          }),
        ]),
      ).toBe(true);
    },
  );

  test.each([KnowledgeEnrichmentStatus.Queued, KnowledgeEnrichmentStatus.Running])(
    'does not poll an old-version AI extraction that is %s',
    status => {
      expect(
        shouldPollKnowledgeDocuments([
          documentItem({
            currentJob: null,
            localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed, {
              documentVersionId: 'version-1',
            }),
            enrichment: createEnrichmentSummary(status, {
              documentVersionId: 'old-version',
            }),
          }),
        ]),
      ).toBe(false);
    },
  );

  test('does not label a non-null wrong-version summary as the stale-prior marker', () => {
    const presentation = getKnowledgeDocumentExtractionPresentation(
      documentItem({
        status: KnowledgeDocumentStatus.Ready,
        currentJob: null,
        localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed, {
          documentVersionId: 'version-1',
        }),
        enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Completed, {
          documentVersionId: 'old-version',
        }),
        hasStalePriorVersionExtraction: true,
      }),
    );

    expect(presentation.showsStalePriorVersion).toBe(false);
    expect(presentation.statusKey).toBe('enterpriseKnowledgeAiExtractionStatusNotStarted');
    expect(presentation.canPrepare).toBe(true);
  });

  test.each([
    KnowledgeEnrichmentStatus.ReviewRequired,
    KnowledgeEnrichmentStatus.Completed,
    KnowledgeEnrichmentStatus.Failed,
    KnowledgeEnrichmentStatus.Cancelled,
    KnowledgeEnrichmentStatus.Stale,
  ])('does not poll terminal/review AI extraction %s', status => {
    expect(
      shouldPollKnowledgeDocuments([
        documentItem({
          currentJob: null,
          enrichment: createEnrichmentSummary(status),
        }),
      ]),
    ).toBe(false);
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

  test.each([
    {
      language: 'zh' as const,
      expected: [
        '文档解析',
        '本地搜索索引',
        '尚未建立',
        '等待建立',
        '建立中',
        '已就绪',
        '无可索引文本',
        '建立失败',
        '重试索引',
      ],
    },
    {
      language: 'en' as const,
      expected: [
        'Document parsing',
        'Local search index',
        'Not indexed yet',
        'Waiting to index',
        'Indexing',
        'Ready',
        'No indexable text',
        'Indexing failed',
        'Retry indexing',
      ],
    },
  ])('publishes complete $language local-index copy', ({ language, expected }) => {
    i18nService.setLanguage(language, { persist: false });
    const keys = [
      'enterpriseKnowledgeDocumentParsing',
      'enterpriseKnowledgeLocalIndex',
      'enterpriseKnowledgeLocalIndexStatusNotStarted',
      'enterpriseKnowledgeLocalIndexStatusPending',
      'enterpriseKnowledgeLocalIndexStatusIndexing',
      'enterpriseKnowledgeLocalIndexStatusIndexed',
      'enterpriseKnowledgeLocalIndexStatusNotApplicable',
      'enterpriseKnowledgeLocalIndexStatusFailed',
      'enterpriseKnowledgeRetryLocalIndex',
    ];

    expect(keys.map(key => i18nService.t(key))).toEqual(expected);
  });
});
