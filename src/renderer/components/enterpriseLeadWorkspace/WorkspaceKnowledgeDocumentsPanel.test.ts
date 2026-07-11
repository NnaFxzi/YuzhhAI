import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeDocumentVisibility,
  KnowledgeIngestionJobStatus,
  KnowledgeIngestionStage,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeDocumentIndexSummary,
  KnowledgeDocumentListItem,
  KnowledgeImportBatchResult,
} from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import { KnowledgeBaseServiceError } from '../../services/knowledgeBase';
import type { WorkspaceKnowledgeDocumentsState } from './useWorkspaceKnowledgeDocuments';
import {
  createWorkspaceKnowledgeDocumentsPanelActions,
  getWorkspaceKnowledgeDocumentCount,
  WorkspaceKnowledgeDocumentsPanelView,
} from './WorkspaceKnowledgeDocumentsPanel';

const createDocument = (
  overrides: Partial<KnowledgeDocumentListItem> = {},
): KnowledgeDocumentListItem => ({
  id: 'document-a',
  displayName: '产品手册.pdf',
  sourceMode: KnowledgeDocumentSourceMode.Managed,
  currentVersionId: 'version-a',
  revision: 1,
  status: KnowledgeDocumentStatus.Ready,
  fileSize: 2_048,
  mimeType: 'application/pdf',
  contentHash: 'safe-hash',
  currentJob: null,
  localIndex: null,
  createdAt: '2026-07-11T01:00:00.000Z',
  updatedAt: '2026-07-11T02:00:00.000Z',
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

const createState = (
  overrides: Partial<WorkspaceKnowledgeDocumentsState> = {},
): WorkspaceKnowledgeDocumentsState => ({
  documents: [],
  deletedDocuments: [],
  selectedDetails: null,
  selectedDocumentId: null,
  lastImportResult: null,
  isLoading: false,
  isDetailsLoading: false,
  isMutating: false,
  error: null,
  clearError: vi.fn(),
  refresh: vi.fn(async () => undefined),
  selectAndImport: vi.fn(async () => null),
  deleteDocument: vi.fn(async () => undefined),
  restoreDocument: vi.fn(async () => undefined),
  retryDocument: vi.fn(async () => undefined),
  retryLocalIndex: vi.fn(async () => undefined),
  loadDetails: vi.fn(async () => undefined),
  ...overrides,
});

const renderView = (
  state: WorkspaceKnowledgeDocumentsState,
  visibility: KnowledgeDocumentVisibility = KnowledgeDocumentVisibility.Active,
): string =>
  renderToStaticMarkup(
    React.createElement(WorkspaceKnowledgeDocumentsPanelView, {
      state,
      visibility,
      query: '',
      statusFilter: 'all',
      pendingDeleteId: null,
      detailsOpen: true,
      onVisibilityChange: vi.fn(),
      onQueryChange: vi.fn(),
      onStatusFilterChange: vi.fn(),
      onUpload: vi.fn(),
      onOpen: vi.fn(),
      onDeleteRequest: vi.fn(),
      onDeleteConfirm: vi.fn(),
      onDeleteCancel: vi.fn(),
      onRestore: vi.fn(),
      onRetry: vi.fn(),
      onRetryLocalIndex: vi.fn(),
      onCloseDetails: vi.fn(),
    }),
  );

describe('WorkspaceKnowledgeDocumentsPanel', () => {
  afterEach(() => {
    i18nService.setLanguage('zh', { persist: false });
  });

  test('reports the normalized active-document count after loading', () => {
    expect(
      getWorkspaceKnowledgeDocumentCount(
        createState({ documents: [createDocument()], isLoading: true }),
      ),
    ).toBeNull();
    expect(
      getWorkspaceKnowledgeDocumentCount(
        createState({
          error: new KnowledgeBaseServiceError(KnowledgeBaseErrorCode.PersistenceFailed),
        }),
      ),
    ).toBeNull();
    expect(
      getWorkspaceKnowledgeDocumentCount(
        createState({
          documents: [createDocument(), createDocument({ id: 'document-b' })],
          deletedDocuments: [
            createDocument({ id: 'document-deleted', deletedAt: '2026-07-11T03:00:00.000Z' }),
          ],
        }),
      ),
    ).toBe(2);
  });

  test('routes all document mutations through normalized panel actions', async () => {
    const active = createDocument();
    const deleted = createDocument({
      id: 'document-deleted',
      deletedAt: '2026-07-11T03:00:00.000Z',
    });
    const state = createState();
    const actions = createWorkspaceKnowledgeDocumentsPanelActions(state);

    await actions.importFiles();
    await actions.open(active.id);
    await actions.delete(active);
    await actions.restore(deleted);
    await actions.retry(active);
    await actions.retryLocalIndex(active);

    expect(state.selectAndImport).toHaveBeenCalledTimes(1);
    expect(state.loadDetails).toHaveBeenCalledWith(active.id);
    expect(state.deleteDocument).toHaveBeenCalledWith(active);
    expect(state.restoreDocument).toHaveBeenCalledWith(deleted);
    expect(state.retryDocument).toHaveBeenCalledWith(active);
    expect(state.retryLocalIndex).toHaveBeenCalledWith(active);
  });

  test('requests a workspace projection refresh after a successful normalized import', async () => {
    const document = createDocument();
    const onWorkspaceProjectionChange = vi.fn(async () => undefined);
    const state = createState({
      selectAndImport: vi.fn(async (): Promise<KnowledgeImportBatchResult> => ({
        importedCount: 1,
        failedCount: 0,
        items: [{ success: true, itemId: 'item-a', document }],
      })),
    });
    const actions = createWorkspaceKnowledgeDocumentsPanelActions(
      state,
      onWorkspaceProjectionChange,
    );

    await actions.importFiles();

    expect(onWorkspaceProjectionChange).toHaveBeenCalledTimes(1);
  });

  test('skips the workspace projection refresh when no document was imported', async () => {
    const onWorkspaceProjectionChange = vi.fn(async () => undefined);
    const cancelledActions = createWorkspaceKnowledgeDocumentsPanelActions(
      createState({ selectAndImport: vi.fn(async () => null) }),
      onWorkspaceProjectionChange,
    );
    const failedActions = createWorkspaceKnowledgeDocumentsPanelActions(
      createState({
        selectAndImport: vi.fn(async (): Promise<KnowledgeImportBatchResult> => ({
          importedCount: 0,
          failedCount: 1,
          items: [
            {
              success: false,
              itemId: 'item-failed',
              fileName: 'failed.pdf',
              errorCode: KnowledgeBaseErrorCode.PersistenceFailed,
            },
          ],
        })),
      }),
      onWorkspaceProjectionChange,
    );

    await cancelledActions.importFiles();
    await failedActions.importFiles();

    expect(onWorkspaceProjectionChange).not.toHaveBeenCalled();
  });

  test('refreshes the workspace projection after document lifecycle mutations', async () => {
    const active = createDocument();
    const deleted = createDocument({
      id: 'document-deleted',
      deletedAt: '2026-07-11T03:00:00.000Z',
    });
    const onWorkspaceProjectionChange = vi.fn(async () => undefined);
    const actions = createWorkspaceKnowledgeDocumentsPanelActions(
      createState(),
      onWorkspaceProjectionChange,
    );

    await actions.delete(active);
    await actions.restore(deleted);
    await actions.retry(active);

    expect(onWorkspaceProjectionChange).toHaveBeenCalledTimes(3);
  });

  test('reports partial imports and distinguishes saved-without-text documents', () => {
    const html = renderView(
      createState({
        documents: [
          createDocument({
            id: 'document-no-text',
            displayName: '旧格式附件.doc',
            status: KnowledgeDocumentStatus.CompletedWithoutText,
          }),
        ],
        lastImportResult: {
          importedCount: 8,
          failedCount: 2,
          items: [
            {
              success: false,
              itemId: 'failed-large',
              fileName: '超大手册.pdf',
              errorCode: KnowledgeBaseErrorCode.FileTooLarge,
            },
            {
              success: false,
              itemId: 'failed-changed',
              fileName: '已变更资料.txt',
              errorCode: KnowledgeBaseErrorCode.SelectedFileChanged,
            },
          ],
        },
      }),
    );

    expect(html).toContain('data-testid="knowledge-import-summary"');
    expect(html).toContain(
      i18nService
        .t('enterpriseKnowledgeImportPartialSuccess')
        .replace('{imported}', '8')
        .replace('{failed}', '2'),
    );
    expect(html).toContain(i18nService.t('enterpriseKnowledgeDocumentStatusSavedNotSearchable'));
    expect(html).toContain('data-testid="knowledge-import-failures"');
    expect(html).toContain('超大手册.pdf');
    expect(html).toContain('已变更资料.txt');
    expect(html).toContain(i18nService.t('enterpriseKnowledgeErrorFileTooLarge'));
    expect(html).toContain(i18nService.t('enterpriseKnowledgeErrorFileChanged'));
  });

  test('shows retry for failed or restore-cancelled jobs and restore only in trash', () => {
    const failed = createDocument({
      id: 'document-failed',
      status: KnowledgeDocumentStatus.Failed,
      currentJob: {
        id: 'job-failed',
        documentVersionId: 'version-a',
        stage: KnowledgeIngestionStage.Parsing,
        status: KnowledgeIngestionJobStatus.Failed,
        progress: 0.35,
        errorCode: 'parse_failed',
        updatedAt: '2026-07-11T02:00:00.000Z',
      },
    });
    const noFailedJob = createDocument({
      id: 'document-without-failed-job',
      status: KnowledgeDocumentStatus.Failed,
    });
    const cancelled = createDocument({
      id: 'document-cancelled',
      status: KnowledgeDocumentStatus.Pending,
      currentJob: {
        id: 'job-cancelled',
        documentVersionId: 'version-a',
        stage: KnowledgeIngestionStage.Queued,
        status: KnowledgeIngestionJobStatus.Cancelled,
        progress: 0,
        errorCode: null,
        updatedAt: '2026-07-11T02:00:00.000Z',
      },
    });
    const activeHtml = renderView(createState({ documents: [failed, noFailedJob, cancelled] }));

    expect(activeHtml).toContain('data-retry-document-id="document-failed"');
    expect(activeHtml).toContain('data-retry-document-id="document-cancelled"');
    expect(activeHtml).not.toContain('data-retry-document-id="document-without-failed-job"');
    expect(activeHtml).not.toContain('data-restore-document-id=');

    const deletedHtml = renderView(
      createState({ deletedDocuments: [failed] }),
      KnowledgeDocumentVisibility.Deleted,
    );
    expect(deletedHtml).toContain('data-restore-document-id="document-failed"');
    expect(deletedHtml).not.toContain('data-delete-document-id=');
    expect(deletedHtml).not.toContain('data-retry-document-id=');
  });

  test('renders progress and details without exposing filesystem paths', () => {
    const processing = createDocument({
      status: KnowledgeDocumentStatus.Processing,
      currentJob: {
        id: 'job-running',
        documentVersionId: 'version-a',
        stage: KnowledgeIngestionStage.Chunking,
        status: KnowledgeIngestionJobStatus.Running,
        progress: 0.64,
        errorCode: null,
        updatedAt: '2026-07-11T02:00:00.000Z',
      },
    });
    const html = renderView(
      createState({
        documents: [processing],
        selectedDetails: {
          document: processing,
          activeVersion: {
            id: 'version-a',
            parser: 'pdf-local',
            extractedText: '这是按需加载的安全正文。',
            extractionPartial: false,
            createdAt: '2026-07-11T01:00:00.000Z',
          },
        },
      }),
    );

    expect(html).toContain('value="64"');
    expect(html).toContain('这是按需加载的安全正文。');
    expect(html).not.toContain('/Users/');
    expect(html).not.toContain('filePath');
  });

  test.each([
    [null, 'enterpriseKnowledgeLocalIndexStatusNotStarted'],
    [KnowledgeDocumentIndexStatus.Pending, 'enterpriseKnowledgeLocalIndexStatusPending'],
    [KnowledgeDocumentIndexStatus.Indexing, 'enterpriseKnowledgeLocalIndexStatusIndexing'],
    [KnowledgeDocumentIndexStatus.Indexed, 'enterpriseKnowledgeLocalIndexStatusIndexed'],
    [
      KnowledgeDocumentIndexStatus.NotApplicable,
      'enterpriseKnowledgeLocalIndexStatusNotApplicable',
    ],
    [KnowledgeDocumentIndexStatus.Failed, 'enterpriseKnowledgeLocalIndexStatusFailed'],
  ])('renders active local-index state %s', (status, key) => {
    const document = createDocument({
      localIndex: status ? createIndexSummary(status) : null,
    });
    const html = renderView(createState({ documents: [document] }));

    expect(html).toContain(i18nService.t(key));
  });

  test('hides local-index status and retry controls in trash', () => {
    const deleted = createDocument({
      deletedAt: '2026-07-11T00:00:00.000Z',
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Failed),
    });
    const html = renderView(
      createState({ deletedDocuments: [deleted] }),
      KnowledgeDocumentVisibility.Deleted,
    );

    expect(html).not.toContain(i18nService.t('enterpriseKnowledgeLocalIndex'));
    expect(html).not.toContain(i18nService.t('enterpriseKnowledgeLocalIndexStatusFailed'));
    expect(html).not.toContain('data-retry-local-index-document-id');
  });

  test('renders parsing and local-index state independently', () => {
    const document = createDocument({
      status: KnowledgeDocumentStatus.Ready,
      currentJob: null,
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed, { chunkCount: 7 }),
    });
    const html = renderView(createState({ documents: [document] }));

    expect(html).toContain(i18nService.t('enterpriseKnowledgeDocumentParsing'));
    expect(html).toContain(i18nService.t('enterpriseKnowledgeLocalIndex'));
    expect(html).toContain(i18nService.t('enterpriseKnowledgeLocalIndexStatusIndexed'));
    expect(html).toContain('7');
  });

  test('renders a dedicated retry only for active failed local index', () => {
    const document = createDocument({
      currentJob: null,
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Failed, {
        errorCode: '/private/path SQLITE_BUSY stack',
      }),
    });
    const html = renderView(createState({ documents: [document] }));

    expect(html).toContain(`data-retry-local-index-document-id="${document.id}"`);
    expect(html).not.toContain(`data-retry-document-id="${document.id}"`);
    expect(html).not.toContain('/private/path');
    expect(html).not.toContain('SQLITE_BUSY');
  });

  test('announces a failed local-index state while keeping retry outside the live region', () => {
    const document = createDocument({
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Failed),
    });
    const html = renderView(createState({ documents: [document] }));
    const liveRegionStart = html.indexOf('role="status"');
    const liveRegionEnd = html.indexOf('</span><button', liveRegionStart);
    const failedStatusStart = html.indexOf(
      i18nService.t('enterpriseKnowledgeLocalIndexStatusFailed'),
      liveRegionStart,
    );
    const retryButtonStart = html.indexOf('data-retry-local-index-document-id');

    expect(liveRegionStart).toBeGreaterThanOrEqual(0);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(failedStatusStart).toBeGreaterThan(liveRegionStart);
    expect(failedStatusStart).toBeLessThan(liveRegionEnd);
    expect(liveRegionEnd).toBeGreaterThan(liveRegionStart);
    expect(retryButtonStart).toBeGreaterThan(liveRegionEnd);
  });

  test('keeps indexed status and chunk count inside the live region', () => {
    const document = createDocument({
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed, { chunkCount: 7 }),
    });
    const html = renderView(createState({ documents: [document] }));
    const liveRegionStart = html.indexOf('role="status"');
    const liveRegionEnd = html.indexOf('</span></span>', liveRegionStart);
    const indexedStatusStart = html.indexOf(
      i18nService.t('enterpriseKnowledgeLocalIndexStatusIndexed'),
      liveRegionStart,
    );
    const chunkCountStart = html.indexOf(
      i18nService.t('enterpriseKnowledgeLocalIndexChunkCount').replace('{count}', '7'),
      liveRegionStart,
    );

    expect(liveRegionStart).toBeGreaterThanOrEqual(0);
    expect(liveRegionEnd).toBeGreaterThan(liveRegionStart);
    expect(indexedStatusStart).toBeGreaterThan(liveRegionStart);
    expect(indexedStatusStart).toBeLessThan(liveRegionEnd);
    expect(chunkCountStart).toBeGreaterThan(indexedStatusStart);
    expect(chunkCountStart).toBeLessThan(liveRegionEnd);
  });

  test('local-index retry does not report a workspace projection change', async () => {
    const state = createState();
    const onWorkspaceProjectionChange = vi.fn();
    const actions = createWorkspaceKnowledgeDocumentsPanelActions(
      state,
      onWorkspaceProjectionChange,
    );
    const document = createDocument();

    await actions.retryLocalIndex(document);

    expect(state.retryLocalIndex).toHaveBeenCalledWith(document);
    expect(onWorkspaceProjectionChange).not.toHaveBeenCalled();
  });

  test('marks document rows for deferred off-screen rendering', () => {
    const html = renderView(createState({ documents: [createDocument()] }));

    expect(html).toContain('[content-visibility:auto]');
    expect(html).toContain('[contain-intrinsic-size:auto_160px]');
  });

  test.each([
    ['zh' as const, '7 个内容片段'],
    ['en' as const, '7 content chunk(s)'],
  ])('renders indexed chunk count in $0', (language, expected) => {
    i18nService.setLanguage(language, { persist: false });
    const document = createDocument({
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed, { chunkCount: 7 }),
    });

    expect(renderView(createState({ documents: [document] }))).toContain(expected);
  });

  test('clears old detail content and shows a loading state for the next document', () => {
    const document = createDocument({ id: 'document-loading' });
    const html = renderView(
      createState({
        documents: [document],
        selectedDocumentId: document.id,
        selectedDetails: null,
        isDetailsLoading: true,
      }),
    );

    expect(html).toContain('data-testid="knowledge-document-details"');
    expect(html).toContain(i18nService.t('enterpriseKnowledgeLoadingDetails'));
  });
});
