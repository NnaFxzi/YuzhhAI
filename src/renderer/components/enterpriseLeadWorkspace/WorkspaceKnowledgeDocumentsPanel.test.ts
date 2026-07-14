import fs from 'node:fs';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeDocumentVisibility,
  KnowledgeEnrichmentStatus,
  KnowledgeIngestionJobStatus,
  KnowledgeIngestionStage,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeDocumentIndexSummary,
  KnowledgeDocumentListItem,
  KnowledgeEnrichmentSummary,
  KnowledgeExtractionAuthorizationPreparation,
  KnowledgeImportBatchResult,
} from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import { KnowledgeBaseServiceError } from '../../services/knowledgeBase';
import type { WorkspaceKnowledgeDocumentsState } from './useWorkspaceKnowledgeDocuments';
import {
  createWorkspaceKnowledgeDocumentsPanelActions,
  createWorkspaceKnowledgeExtractionDialogActions,
  getKnowledgeDocumentStatusPopoverPlacement,
  getWorkspaceKnowledgeDocumentCount,
  WorkspaceKnowledgeDocumentsPanelView,
  WorkspaceKnowledgeExtractionIntentKind,
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
  enrichment: null,
  hasStalePriorVersionExtraction: false,
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

const createEnrichmentSummary = (
  status: KnowledgeEnrichmentStatus,
  overrides: Partial<KnowledgeEnrichmentSummary> = {},
): KnowledgeEnrichmentSummary => ({
  requestId: 'request-a',
  documentId: 'document-a',
  documentVersionId: 'version-a',
  status,
  progress: 0.62,
  revision: 2,
  attemptCount: 1,
  validCandidateCount: 3,
  discardedCandidateCount: 0,
  pendingFactCount: 3,
  partialReasons: [],
  errorCode: null,
  createdAt: '2026-07-11T02:00:00.000Z',
  updatedAt: '2026-07-11T02:01:00.000Z',
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
  extractionMutatingDocumentIds: [],
  error: null,
  clearError: vi.fn(),
  refresh: vi.fn(async () => undefined),
  selectAndImport: vi.fn(async () => null),
  deleteDocument: vi.fn(async () => undefined),
  restoreDocument: vi.fn(async () => undefined),
  retryDocument: vi.fn(async () => undefined),
  retryLocalIndex: vi.fn(async () => undefined),
  prepareExtractionAuthorization: vi.fn(async (): Promise<KnowledgeExtractionAuthorizationPreparation> => ({
    authorizationToken: 'token-a',
    descriptor: {
      workspaceId: 'workspace-a',
      documentId: 'document-a',
      documentVersionId: 'version-a',
      documentDisplayName: '产品手册.pdf',
      providerId: 'provider-a',
      providerLabel: 'Provider A',
      modelId: 'model-a',
      modelLabel: 'Model A',
      plannedModelCalls: 1,
      partial: false,
      expiresAt: '2026-07-11T03:00:00.000Z',
    },
  })),
  requestExtraction: vi.fn(async () => undefined),
  retryExtraction: vi.fn(async () => undefined),
  cancelExtraction: vi.fn(async () => undefined),
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
      pendingDeleteId: null,
      detailsOpen: true,
      onVisibilityChange: vi.fn(),
      onUpload: vi.fn(),
      onOpen: vi.fn(),
      onDeleteRequest: vi.fn(),
      onDeleteConfirm: vi.fn(),
      onDeleteCancel: vi.fn(),
      onRestore: vi.fn(),
      onRetry: vi.fn(),
      onRetryLocalIndex: vi.fn(),
      onPrepareExtraction: vi.fn(),
      onRetryExtraction: vi.fn(),
      onCancelExtraction: vi.fn(),
      onCloseDetails: vi.fn(),
    }),
  );

const getDocumentRowMarkup = (html: string, documentId: string): string => {
  const documentMarker = html.indexOf(`data-document-id="${documentId}"`);
  const rowStart = html.lastIndexOf('<article', documentMarker);
  const rowEnd = html.indexOf('</article>', documentMarker);
  return html.slice(rowStart, rowEnd);
};

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
    await actions.cancelExtraction(active);

    expect(state.selectAndImport).toHaveBeenCalledTimes(1);
    expect(state.loadDetails).toHaveBeenCalledWith(active.id);
    expect(state.deleteDocument).toHaveBeenCalledWith(active);
    expect(state.restoreDocument).toHaveBeenCalledWith(deleted);
    expect(state.retryDocument).toHaveBeenCalledWith(active);
    expect(state.retryLocalIndex).toHaveBeenCalledWith(active);
    expect(state.cancelExtraction).toHaveBeenCalledWith(active);
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

    expect(activeHtml).toContain('data-status-popover-trigger="document-parsing"');
    expect(getDocumentRowMarkup(activeHtml, failed.id)).toContain(
      i18nService.t('enterpriseKnowledgeDocumentStatusFailed'),
    );
    expect(getDocumentRowMarkup(activeHtml, cancelled.id)).toContain(
      i18nService.t('enterpriseKnowledgeDocumentStatusPending'),
    );
    expect(getDocumentRowMarkup(activeHtml, noFailedJob.id)).not.toContain(
      'data-retry-document-id=',
    );
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

    expect(html).not.toContain('value="64"');
    expect(html).toContain('data-status-popover-trigger="document-parsing"');
    expect(html).toContain('这是按需加载的安全正文。');
    expect(html).not.toContain('/Users/');
    expect(html).not.toContain('filePath');
  });

  test('renders compact document rows with closed status popovers', () => {
    const running = createDocument({
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
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexing),
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Running),
    });
    const html = renderView(createState({ documents: [running] }));
    const row = getDocumentRowMarkup(html, running.id);

    expect(html).toContain('data-testid="knowledge-document-list"');
    expect(row).toContain('data-document-row-density="compact"');
    expect(row).toContain('data-status-popover-trigger="document-parsing"');
    expect(row).toContain('data-status-popover-trigger="local-index"');
    expect(row).toContain('data-status-popover-trigger="ai-extraction"');
    expect(row).toContain('data-extraction-icon="running"');
    expect(row).not.toContain('data-status-popover-content');
    expect(row).not.toContain('data-extraction-indeterminate');
    expect(row).not.toContain(
      i18nService.t('enterpriseKnowledgeAiExtractionRunningDescription'),
    );
  });

  test('keeps upload as the primary document action without a status filter', () => {
    const html = renderView(createState({ documents: [createDocument()] }));

    expect(html).toContain('data-testid="knowledge-upload"');
    expect(html).not.toContain('<select');
    expect(html).not.toContain(i18nService.t('enterpriseKnowledgeStatusFilter'));
  });

  test('renders a compact document list body with bottom trash entry', () => {
    const html = renderView(createState({ documents: [createDocument()] }));

    expect(html).toContain('data-testid="knowledge-upload"');
    expect(html).toContain('data-testid="knowledge-trash-entry"');
    expect(html).not.toContain(i18nService.t('enterpriseKnowledgeFileListTitle'));
    expect(html).not.toContain('data-document-count="1"');
    expect(html).not.toContain('data-testid="knowledge-search-toggle"');
    expect(html).not.toContain('data-testid="knowledge-search-input"');
    expect(html).not.toContain(i18nService.t('enterpriseKnowledgeActiveDocuments'));
  });

  test('keeps the toolbar search-free for larger document lists', () => {
    const html = renderView(
      createState({
        documents: Array.from({ length: 8 }, (_, index) =>
          createDocument({ id: `document-${index}` }),
        ),
      }),
    );

    expect(html).toContain('data-testid="knowledge-upload"');
    expect(html).not.toContain('data-testid="knowledge-search-toggle"');
    expect(html).not.toContain('data-testid="knowledge-search-input"');
  });

  test('places an open status popover above a trigger near the viewport bottom', () => {
    expect(
      getKnowledgeDocumentStatusPopoverPlacement(
        { top: 740, bottom: 772, left: 1180, right: 1212, width: 32, height: 32 },
        { width: 320, height: 240 },
        { width: 1280, height: 800 },
      ),
    ).toEqual({ placement: 'above', top: 492, left: 892 });
  });

  test('keeps the status details outside the scrolling document row', () => {
    const source = fs.readFileSync(
      new URL('./WorkspaceKnowledgeDocumentsPanel.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('createPortal');
    expect(source).toContain('data-status-popover-portal');
    expect(source).toContain('position: \'fixed\'');
  });

  test('keeps the initial AI extraction action visible beside the closed status popover', () => {
    const document = createDocument({
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed),
    });
    const html = renderView(createState({ documents: [document] }));
    const row = getDocumentRowMarkup(html, document.id);

    expect(row).toContain(`data-prepare-extraction-document-id="${document.id}"`);
    expect(row).toContain(i18nService.t('enterpriseKnowledgeExtractAiKnowledge'));
    expect(row).not.toContain('data-status-popover-content="ai-extraction"');
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

    expect(html).toContain('data-status-popover-trigger="local-index"');
    expect(html).toContain(i18nService.t('enterpriseKnowledgeLocalIndexStatusFailed'));
    expect(html).not.toContain(`data-retry-local-index-document-id="${document.id}"`);
    expect(html).not.toContain(`data-retry-document-id="${document.id}"`);
    expect(html).not.toContain('/private/path');
    expect(html).not.toContain('SQLITE_BUSY');
  });

  test('keeps failed local-index details out of the compact row until opened', () => {
    const document = createDocument({
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Failed),
    });
    const html = renderView(createState({ documents: [document] }));
    expect(html).toContain('data-status-popover-trigger="local-index"');
    expect(html).toContain('aria-label="本地搜索索引 · 建立失败"');
    expect(html).not.toContain('data-status-popover-content="local-index"');
    expect(html).not.toContain('data-retry-local-index-document-id');
  });

  test('keeps indexed status and chunk count in the closed local-index popover', () => {
    const document = createDocument({
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed, { chunkCount: 7 }),
    });
    const html = renderView(createState({ documents: [document] }));
    expect(html).toContain('aria-label="本地搜索索引 · 已就绪"');
    expect(html).not.toContain(
      i18nService.t('enterpriseKnowledgeLocalIndexChunkCount').replace('{count}', '7'),
    );
    expect(html).not.toContain('data-status-popover-content="local-index"');
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

  test('routes fresh authorization and first/retry send without a Profile projection callback', async () => {
    const document = createDocument({
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Failed),
    });
    Object.freeze(document.enrichment);
    Object.freeze(document);
    const state = createState({ documents: [document] });
    const onWorkspaceProjectionChange = vi.fn();
    const firstIntent = Object.freeze({
      kind: WorkspaceKnowledgeExtractionIntentKind.Request,
      documentId: document.id,
      documentVersionId: document.currentVersionId,
    });
    const retryIntent = Object.freeze({
      kind: WorkspaceKnowledgeExtractionIntentKind.Retry,
      documentId: document.id,
      documentVersionId: document.currentVersionId,
    });
    const first = createWorkspaceKnowledgeExtractionDialogActions(state, firstIntent);
    const retry = createWorkspaceKnowledgeExtractionDialogActions(state, retryIntent);

    await first.prepare();
    await first.send('first-fresh-token');
    await retry.prepare();
    await retry.send('retry-fresh-token');
    await createWorkspaceKnowledgeDocumentsPanelActions(
      state,
      onWorkspaceProjectionChange,
    ).cancelExtraction(document);

    expect(state.prepareExtractionAuthorization).toHaveBeenCalledTimes(2);
    expect(state.prepareExtractionAuthorization).toHaveBeenNthCalledWith(1, document);
    expect(state.prepareExtractionAuthorization).toHaveBeenNthCalledWith(2, document);
    expect(state.requestExtraction).toHaveBeenCalledWith(document, 'first-fresh-token');
    expect(state.retryExtraction).toHaveBeenCalledWith(document, 'retry-fresh-token');
    expect(state.cancelExtraction).toHaveBeenCalledWith(document);
    expect(onWorkspaceProjectionChange).not.toHaveBeenCalled();
    expect(firstIntent).toEqual({
      kind: WorkspaceKnowledgeExtractionIntentKind.Request,
      documentId: 'document-a',
      documentVersionId: 'version-a',
    });
    expect(retryIntent).toEqual({
      kind: WorkspaceKnowledgeExtractionIntentKind.Retry,
      documentId: 'document-a',
      documentVersionId: 'version-a',
    });
  });

  test('locks dialog actions to the exact current document version', async () => {
    const currentDocument = createDocument({ currentVersionId: 'version-current' });
    const state = createState({ documents: [currentDocument] });
    const actions = createWorkspaceKnowledgeExtractionDialogActions(state, {
      kind: WorkspaceKnowledgeExtractionIntentKind.Request,
      documentId: currentDocument.id,
      documentVersionId: 'version-old',
    });

    await expect(actions.prepare()).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.InvalidRequest,
    });
    await expect(actions.send('must-not-be-used')).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.InvalidRequest,
    });
    expect(state.prepareExtractionAuthorization).not.toHaveBeenCalled();
    expect(state.requestExtraction).not.toHaveBeenCalled();
  });

  test('renders parsing, local-index, and AI-extraction rows with independent controls', () => {
    const ready = createDocument({
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed),
    });
    const failedExtraction = createDocument({
      id: 'document-failed-extraction',
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed),
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Failed, {
        documentId: 'document-failed-extraction',
        errorCode: KnowledgeBaseErrorCode.ModelRequestFailed,
      }),
    });
    const running = createDocument({
      id: 'document-running',
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed),
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Running, {
        documentId: 'document-running',
      }),
      hasStalePriorVersionExtraction: true,
    });
    const queued = createDocument({
      id: 'document-queued',
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed),
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Queued, {
        documentId: 'document-queued',
      }),
    });
    const cancelled = createDocument({
      id: 'document-cancelled-extraction',
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed),
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Cancelled, {
        documentId: 'document-cancelled-extraction',
      }),
    });
    const html = renderView(
      createState({ documents: [ready, failedExtraction, running, queued, cancelled] }),
    );

    expect(html.match(/data-knowledge-state="document-parsing"/g)).toHaveLength(5);
    expect(html.match(/data-knowledge-state="local-index"/g)).toHaveLength(5);
    expect(html.match(/data-knowledge-state="ai-extraction"/g)).toHaveLength(5);
    expect(html).toContain('data-status-popover-trigger="ai-extraction"');
    expect(getDocumentRowMarkup(html, 'document-failed-extraction')).toContain(
      'data-extraction-icon="attention"',
    );
    expect(getDocumentRowMarkup(html, 'document-cancelled-extraction')).toContain(
      'data-extraction-icon="attention"',
    );
    expect(getDocumentRowMarkup(html, 'document-running')).toContain(
      'data-extraction-icon="running"',
    );
    expect(getDocumentRowMarkup(html, 'document-queued')).toContain(
      'data-extraction-icon="queued"',
    );
    const runningHtml = getDocumentRowMarkup(html, 'document-running');
    expect(runningHtml).toContain(
      i18nService.t('enterpriseKnowledgeAiExtractionStatusRunning'),
    );
    expect(runningHtml).not.toContain(
      i18nService.t('enterpriseKnowledgeAiExtractionRunningDescription'),
    );
    expect(runningHtml).not.toContain('data-extraction-status-label');
    expect(html).not.toContain('data-status-popover-content="ai-extraction"');
  });

  test('keeps terminal AI state visible beside parsing failure and hides AI controls in trash', () => {
    const completedAfterParseFailure = createDocument({
      status: KnowledgeDocumentStatus.Failed,
      currentJob: {
        id: 'job-failed',
        documentVersionId: 'version-a',
        stage: KnowledgeIngestionStage.Parsing,
        status: KnowledgeIngestionJobStatus.Failed,
        progress: 0.2,
        errorCode: 'unsafe /private/path SQL stack',
        updatedAt: '2026-07-11T02:00:00.000Z',
      },
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed),
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Completed),
    });
    const activeHtml = renderView(createState({ documents: [completedAfterParseFailure] }));
    expect(activeHtml).toContain(i18nService.t('enterpriseKnowledgeDocumentStatusFailed'));
    expect(activeHtml).toContain(i18nService.t('enterpriseKnowledgeLocalIndexStatusIndexed'));
    expect(activeHtml).toContain(i18nService.t('enterpriseKnowledgeAiExtractionStatusCompleted'));
    expect(activeHtml).not.toContain('/private/path');
    expect(activeHtml).not.toContain('SQL stack');

    const deleted = { ...completedAfterParseFailure, deletedAt: '2026-07-11T05:00:00.000Z' };
    const deletedHtml = renderView(
      createState({ deletedDocuments: [deleted] }),
      KnowledgeDocumentVisibility.Deleted,
    );
    expect(deletedHtml).not.toContain('data-knowledge-state="local-index"');
    expect(deletedHtml).not.toContain('data-knowledge-state="ai-extraction"');
    expect(deletedHtml).not.toContain('data-prepare-extraction-document-id');
    expect(deletedHtml).not.toContain('data-extraction-action');
  });

  test('marks document rows for deferred off-screen rendering', () => {
    const html = renderView(createState({ documents: [createDocument()] }));

    expect(html).toContain('[content-visibility:auto]');
    expect(html).toContain('[contain-intrinsic-size:auto_72px]');
  });

  test.each([
    ['zh' as const, '7 个内容片段'],
    ['en' as const, '7 content chunk(s)'],
  ])('renders indexed chunk count in $0', (language, expected) => {
    i18nService.setLanguage(language, { persist: false });
    const document = createDocument({
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed, { chunkCount: 7 }),
    });

    const html = renderView(createState({ documents: [document] }));
    expect(html).not.toContain(expected);
    expect(html).toContain('data-status-popover-trigger="local-index"');
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
