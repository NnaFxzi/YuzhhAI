import {
  ArrowPathIcon,
  ArrowUpTrayIcon,
  ArrowUturnLeftIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useState } from 'react';

import {
  type KnowledgeDocumentStatus,
  KnowledgeDocumentStatus as KnowledgeDocumentStatuses,
  KnowledgeDocumentVisibility as KnowledgeDocumentVisibilities,
  type KnowledgeDocumentVisibility,
  KnowledgeIngestionJobStatus,
  type KnowledgeIngestionStage,
  KnowledgeIngestionStage as KnowledgeIngestionStages,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeDocumentListItem,
  KnowledgeImportBatchResult,
  KnowledgeImportItemResult,
} from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import {
  filterKnowledgeDocuments,
  getKnowledgeDocumentErrorKey,
  getKnowledgeDocumentStatusKey,
  type KnowledgeDocumentStatusFilter,
  summarizeKnowledgeImportBatch,
} from './knowledgeDocumentPresentation';
import {
  useWorkspaceKnowledgeDocuments,
  type WorkspaceKnowledgeDocumentsState,
} from './useWorkspaceKnowledgeDocuments';

export type WorkspaceProjectionChangeHandler = () => Promise<void> | void;

export interface WorkspaceKnowledgeDocumentsPanelProps {
  workspaceId: string;
  initialImportResult?: KnowledgeImportBatchResult;
  onDocumentCountChange?: (count: number) => void;
  onWorkspaceProjectionChange?: WorkspaceProjectionChangeHandler;
}

export interface WorkspaceKnowledgeDocumentsPanelActions {
  importFiles: () => Promise<void>;
  open: (documentId: string) => Promise<void>;
  delete: (document: KnowledgeDocumentListItem) => Promise<void>;
  restore: (document: KnowledgeDocumentListItem) => Promise<void>;
  retry: (document: KnowledgeDocumentListItem) => Promise<void>;
}

export const createWorkspaceKnowledgeDocumentsPanelActions = (
  state: WorkspaceKnowledgeDocumentsState,
  onWorkspaceProjectionChange?: WorkspaceProjectionChangeHandler,
): WorkspaceKnowledgeDocumentsPanelActions => ({
  importFiles: async () => {
    const result = await state.selectAndImport();
    if (result && result.importedCount > 0) {
      await onWorkspaceProjectionChange?.();
    }
  },
  open: async documentId => {
    await state.loadDetails(documentId);
  },
  delete: async document => {
    await state.deleteDocument(document);
    await onWorkspaceProjectionChange?.();
  },
  restore: async document => {
    await state.restoreDocument(document);
    await onWorkspaceProjectionChange?.();
  },
  retry: async document => {
    await state.retryDocument(document);
    await onWorkspaceProjectionChange?.();
  },
});

export const getWorkspaceKnowledgeDocumentCount = (
  state: Pick<WorkspaceKnowledgeDocumentsState, 'documents' | 'error' | 'isLoading'>,
): number | null => (state.isLoading || state.error ? null : state.documents.length);

const formatTranslation = (key: string, values?: Record<string, string | number>): string => {
  const translation = i18nService.t(key);
  if (!values) {
    return translation;
  }
  return Object.entries(values).reduce(
    (result, [name, value]) => result.replace(`{${name}}`, String(value)),
    translation,
  );
};

const formatFileSize = (fileSize: number | null): string => {
  if (fileSize === null) {
    return i18nService.t('enterpriseKnowledgeFileSizeUnknown');
  }
  if (fileSize < 1_024) {
    return `${fileSize} B`;
  }
  if (fileSize < 1_024 * 1_024) {
    return `${(fileSize / 1_024).toFixed(1)} KiB`;
  }
  if (fileSize < 1_024 * 1_024 * 1_024) {
    return `${(fileSize / (1_024 * 1_024)).toFixed(1)} MiB`;
  }
  return `${(fileSize / (1_024 * 1_024 * 1_024)).toFixed(1)} GiB`;
};

const formatUpdatedAt = (updatedAt: string): string => {
  const timestamp = Date.parse(updatedAt);
  if (Number.isNaN(timestamp)) {
    return i18nService.t('enterpriseKnowledgeUnknownTime');
  }
  return new Intl.DateTimeFormat(i18nService.getLanguage() === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
};

const statusClassNames: Record<KnowledgeDocumentStatus, string> = {
  [KnowledgeDocumentStatuses.Pending]: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
  [KnowledgeDocumentStatuses.Processing]: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  [KnowledgeDocumentStatuses.Ready]: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  [KnowledgeDocumentStatuses.CompletedWithoutText]:
    'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  [KnowledgeDocumentStatuses.Failed]: 'bg-red-500/10 text-red-700 dark:text-red-300',
};

const stageKeys: Record<KnowledgeIngestionStage, string> = {
  [KnowledgeIngestionStages.Queued]: 'enterpriseKnowledgeStageQueued',
  [KnowledgeIngestionStages.Parsing]: 'enterpriseKnowledgeStageParsing',
  [KnowledgeIngestionStages.Ocr]: 'enterpriseKnowledgeStageOcr',
  [KnowledgeIngestionStages.Chunking]: 'enterpriseKnowledgeStageChunking',
  [KnowledgeIngestionStages.Indexing]: 'enterpriseKnowledgeStageIndexing',
  [KnowledgeIngestionStages.FactExtraction]: 'enterpriseKnowledgeStageFactExtraction',
};

const documentStatusOptions = Object.values(KnowledgeDocumentStatuses);
type KnowledgeFailedImportItem = Extract<KnowledgeImportItemResult, { success: false }>;

const canRetryDocument = (document: KnowledgeDocumentListItem): boolean =>
  document.currentJob?.status === KnowledgeIngestionJobStatus.Cancelled ||
  (document.status === KnowledgeDocumentStatuses.Failed &&
    document.currentJob?.status === KnowledgeIngestionJobStatus.Failed);

interface KnowledgeDocumentRowProps {
  document: KnowledgeDocumentListItem;
  visibility: KnowledgeDocumentVisibility;
  disabled: boolean;
  onOpen: () => void;
  onDeleteRequest: () => void;
  onRestore: () => void;
  onRetry: () => void;
}

const KnowledgeDocumentRow = ({
  document,
  visibility,
  disabled,
  onOpen,
  onDeleteRequest,
  onRestore,
  onRetry,
}: KnowledgeDocumentRowProps): React.ReactElement => {
  const currentJob = document.currentJob;
  const jobIsActive =
    currentJob?.status === KnowledgeIngestionJobStatus.Queued ||
    currentJob?.status === KnowledgeIngestionJobStatus.Running;
  const progress = Math.round(Math.min(100, Math.max(0, (currentJob?.progress ?? 0) * 100)));
  const isDeleted = visibility === KnowledgeDocumentVisibilities.Deleted;

  return (
    <article
      data-document-id={document.id}
      className="rounded-lg border border-border bg-background p-4 shadow-sm transition-colors hover:border-primary/25"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          disabled={disabled}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          onClick={onOpen}
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <DocumentTextIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">
              {document.displayName}
            </span>
            <span className="mt-1 block truncate text-xs text-secondary">
              {[
                document.mimeType ?? i18nService.t('enterpriseKnowledgeFileTypeUnknown'),
                formatFileSize(document.fileSize),
                formatUpdatedAt(document.updatedAt),
              ].join(' · ')}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span
            className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${
              isDeleted
                ? 'bg-slate-500/10 text-slate-700 dark:text-slate-300'
                : statusClassNames[document.status]
            }`}
          >
            {i18nService.t(
              isDeleted
                ? 'enterpriseKnowledgeDocumentStatusDeleted'
                : getKnowledgeDocumentStatusKey(document.status),
            )}
          </span>
          {isDeleted ? (
            <button
              type="button"
              data-restore-document-id={document.id}
              disabled={disabled}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-semibold text-secondary transition-colors hover:bg-surface-raised hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
              onClick={onRestore}
            >
              <ArrowUturnLeftIcon className="h-4 w-4" />
              {i18nService.t('enterpriseKnowledgeRestoreDocument')}
            </button>
          ) : (
            <>
              {canRetryDocument(document) ? (
                <button
                  type="button"
                  data-retry-document-id={document.id}
                  disabled={disabled}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/20 bg-primary/10 px-2.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={onRetry}
                >
                  <ArrowPathIcon className="h-4 w-4" />
                  {i18nService.t('enterpriseKnowledgeRetryDocument')}
                </button>
              ) : null}
              <button
                type="button"
                data-delete-document-id={document.id}
                disabled={disabled}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-500/20 px-2.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-45 dark:text-red-300"
                onClick={onDeleteRequest}
              >
                <TrashIcon className="h-4 w-4" />
                {i18nService.t('enterpriseKnowledgeDeleteDocument')}
              </button>
            </>
          )}
        </div>
      </div>

      {currentJob ? (
        <div className="mt-3 border-t border-border/70 pt-3">
          <div className="flex items-center justify-between gap-3 text-xs text-secondary">
            <span>{i18nService.t(stageKeys[currentJob.stage])}</span>
            <span>{formatTranslation('enterpriseKnowledgeProgress', { progress })}</span>
          </div>
          {jobIsActive ? (
            <progress
              className="mt-2 h-1.5 w-full overflow-hidden rounded-full accent-primary"
              max={100}
              value={progress}
              aria-label={i18nService.t('enterpriseKnowledgeProcessingProgress')}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
};

export interface WorkspaceKnowledgeDocumentsPanelViewProps {
  state: WorkspaceKnowledgeDocumentsState;
  visibility: KnowledgeDocumentVisibility;
  query: string;
  statusFilter: KnowledgeDocumentStatusFilter;
  pendingDeleteId: string | null;
  detailsOpen: boolean;
  onVisibilityChange: (visibility: KnowledgeDocumentVisibility) => void;
  onQueryChange: (query: string) => void;
  onStatusFilterChange: (status: KnowledgeDocumentStatusFilter) => void;
  onUpload: () => void;
  onOpen: (documentId: string) => void;
  onDeleteRequest: (documentId: string) => void;
  onDeleteConfirm: (documentId: string) => void;
  onDeleteCancel: () => void;
  onRestore: (document: KnowledgeDocumentListItem) => void;
  onRetry: (document: KnowledgeDocumentListItem) => void;
  onCloseDetails: () => void;
}

export const WorkspaceKnowledgeDocumentsPanelView = ({
  state,
  visibility,
  query,
  statusFilter,
  pendingDeleteId,
  detailsOpen,
  onVisibilityChange,
  onQueryChange,
  onStatusFilterChange,
  onUpload,
  onOpen,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
  onRestore,
  onRetry,
  onCloseDetails,
}: WorkspaceKnowledgeDocumentsPanelViewProps): React.ReactElement => {
  const sourceRows =
    visibility === KnowledgeDocumentVisibilities.Active ? state.documents : state.deletedDocuments;
  const rows = filterKnowledgeDocuments(sourceRows, query, statusFilter);
  const pendingDeleteDocument = state.documents.find(document => document.id === pendingDeleteId);
  const batchSummary = state.lastImportResult
    ? summarizeKnowledgeImportBatch(state.lastImportResult)
    : null;
  const failedImports = (state.lastImportResult?.items ?? []).filter(
    (item): item is KnowledgeFailedImportItem => !item.success,
  );
  const details = detailsOpen ? state.selectedDetails : null;
  const detailsLoading = detailsOpen && state.isDetailsLoading;
  const selectedDocument = [...state.documents, ...state.deletedDocuments].find(
    document => document.id === state.selectedDocumentId,
  );

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              {i18nService.t('enterpriseKnowledgeDocumentsTitle')}
            </h2>
            <p className="mt-1 text-sm leading-6 text-secondary">
              {i18nService.t('enterpriseKnowledgeDocumentsSubtitle')}
            </p>
          </div>
          <button
            type="button"
            data-testid="knowledge-upload"
            disabled={state.isMutating}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onUpload}
          >
            <ArrowUpTrayIcon className="h-4 w-4" />
            {i18nService.t('enterpriseKnowledgeUploadFiles')}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-border bg-surface p-1">
            <button
              type="button"
              className={`h-8 rounded-md px-3 text-sm font-semibold transition-colors ${
                visibility === KnowledgeDocumentVisibilities.Active
                  ? 'bg-background text-primary shadow-sm'
                  : 'text-secondary hover:text-foreground'
              }`}
              onClick={() => onVisibilityChange(KnowledgeDocumentVisibilities.Active)}
            >
              {i18nService.t('enterpriseKnowledgeActiveDocuments')} ({state.documents.length})
            </button>
            <button
              type="button"
              className={`h-8 rounded-md px-3 text-sm font-semibold transition-colors ${
                visibility === KnowledgeDocumentVisibilities.Deleted
                  ? 'bg-background text-primary shadow-sm'
                  : 'text-secondary hover:text-foreground'
              }`}
              onClick={() => onVisibilityChange(KnowledgeDocumentVisibilities.Deleted)}
            >
              {i18nService.t('enterpriseKnowledgeDeletedDocuments')} (
              {state.deletedDocuments.length})
            </button>
          </div>
          <div className="flex min-w-[280px] flex-1 flex-wrap justify-end gap-2 sm:flex-nowrap">
            <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-secondary sm:max-w-md">
              <MagnifyingGlassIcon className="h-4 w-4 shrink-0" />
              <input
                type="search"
                value={query}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-tertiary"
                placeholder={i18nService.t('enterpriseKnowledgeSearchPlaceholder')}
                onChange={event => onQueryChange(event.target.value)}
              />
            </label>
            <select
              value={statusFilter}
              aria-label={i18nService.t('enterpriseKnowledgeStatusFilter')}
              className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-secondary outline-none"
              onChange={event =>
                onStatusFilterChange(event.target.value as KnowledgeDocumentStatusFilter)
              }
            >
              <option value="all">{i18nService.t('enterpriseKnowledgeStatusAll')}</option>
              {documentStatusOptions.map(status => (
                <option key={status} value={status}>
                  {i18nService.t(getKnowledgeDocumentStatusKey(status))}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {state.error ? (
        <div
          role="alert"
          className="mx-5 mt-4 flex shrink-0 items-center justify-between gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
        >
          <span>{i18nService.t(getKnowledgeDocumentErrorKey(state.error.code))}</span>
          <button
            type="button"
            className="rounded-md p-1 hover:bg-red-500/10"
            aria-label={i18nService.t('close')}
            onClick={state.clearError}
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {batchSummary ? (
        <div
          data-testid="knowledge-import-summary"
          className="mx-5 mt-4 shrink-0 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground"
        >
          <p>{formatTranslation(batchSummary.key, batchSummary.values)}</p>
          {failedImports.length > 0 ? (
            <div
              data-testid="knowledge-import-failures"
              className="mt-2 border-t border-primary/15 pt-2"
            >
              <p className="text-xs font-semibold text-secondary">
                {i18nService.t('enterpriseKnowledgeImportFailuresTitle')}
              </p>
              <ul className="mt-1 max-h-32 space-y-1 overflow-auto text-xs">
                {failedImports.map(item => (
                  <li key={item.itemId} className="flex min-w-0 gap-2">
                    <span className="min-w-0 flex-1 truncate" title={item.fileName}>
                      {item.fileName}
                    </span>
                    <span className="shrink-0 text-secondary">
                      {i18nService.t(getKnowledgeDocumentErrorKey(item.errorCode))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {state.isLoading && rows.length === 0 ? (
          <div className="grid min-h-[240px] place-items-center text-sm text-secondary">
            {i18nService.t('enterpriseKnowledgeLoadingDocuments')}
          </div>
        ) : rows.length > 0 ? (
          <div className="grid gap-3">
            {rows.map(document => (
              <KnowledgeDocumentRow
                key={document.id}
                document={document}
                visibility={visibility}
                disabled={state.isMutating}
                onOpen={() => onOpen(document.id)}
                onDeleteRequest={() => onDeleteRequest(document.id)}
                onRestore={() => onRestore(document)}
                onRetry={() => onRetry(document)}
              />
            ))}
          </div>
        ) : (
          <div className="grid min-h-[240px] place-items-center px-6 text-center">
            <div>
              <DocumentTextIcon className="mx-auto h-10 w-10 text-tertiary" />
              <p className="mt-3 text-sm leading-6 text-secondary">
                {i18nService.t(
                  visibility === KnowledgeDocumentVisibilities.Active
                    ? 'enterpriseKnowledgeNoDocuments'
                    : 'enterpriseKnowledgeNoDeletedDocuments',
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      {details || detailsLoading ? (
        <aside
          data-testid="knowledge-document-details"
          className="absolute inset-y-0 right-0 z-20 flex w-[min(560px,100%)] flex-col border-l border-border bg-background shadow-2xl"
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-foreground">
                {details?.document.displayName ??
                  selectedDocument?.displayName ??
                  i18nService.t('enterpriseKnowledgeLoadingDetails')}
              </h3>
              <p className="mt-1 text-xs text-secondary">
                {i18nService.t('enterpriseKnowledgeDocumentDetails')}
              </p>
            </div>
            <button
              type="button"
              className="rounded-md p-1.5 text-secondary hover:bg-surface-raised hover:text-foreground"
              aria-label={i18nService.t('enterpriseKnowledgeCloseDetails')}
              onClick={onCloseDetails}
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
            {detailsLoading ? (
              <div className="grid min-h-[220px] place-items-center text-center text-sm text-secondary">
                {i18nService.t('enterpriseKnowledgeLoadingDetails')}
              </div>
            ) : details?.activeVersion.extractedText ? (
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-foreground">
                {details.activeVersion.extractedText}
              </pre>
            ) : (
              <div className="grid min-h-[220px] place-items-center text-center text-sm text-secondary">
                {i18nService.t('enterpriseKnowledgeDocumentTextEmpty')}
              </div>
            )}
          </div>
        </aside>
      ) : null}

      {pendingDeleteDocument ? (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/25 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="enterprise-knowledge-delete-title"
            className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-2xl"
          >
            <h3
              id="enterprise-knowledge-delete-title"
              className="text-base font-semibold text-foreground"
            >
              {i18nService.t('enterpriseKnowledgeDeleteConfirm')}
            </h3>
            <p className="mt-2 text-sm leading-6 text-secondary">
              {formatTranslation('enterpriseKnowledgeDeleteConfirmMessage', {
                name: pendingDeleteDocument.displayName,
              })}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={state.isMutating}
                className="h-9 rounded-lg border border-border px-3 text-sm font-medium text-secondary hover:bg-surface-raised disabled:opacity-50"
                onClick={onDeleteCancel}
              >
                {i18nService.t('enterpriseKnowledgeCancel')}
              </button>
              <button
                type="button"
                disabled={state.isMutating}
                className="h-9 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                onClick={() => onDeleteConfirm(pendingDeleteDocument.id)}
              >
                {i18nService.t('enterpriseKnowledgeDeleteDocument')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};

const ignoreRejectedAction = (action: Promise<void>): void => {
  void action.catch(() => undefined);
};

export default function WorkspaceKnowledgeDocumentsPanel({
  workspaceId,
  initialImportResult,
  onDocumentCountChange,
  onWorkspaceProjectionChange,
}: WorkspaceKnowledgeDocumentsPanelProps): React.ReactElement {
  const state = useWorkspaceKnowledgeDocuments(workspaceId, initialImportResult);
  const [visibility, setVisibility] = useState<KnowledgeDocumentVisibility>(
    KnowledgeDocumentVisibilities.Active,
  );
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<KnowledgeDocumentStatusFilter>('all');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const actions = useMemo(
    () => createWorkspaceKnowledgeDocumentsPanelActions(state, onWorkspaceProjectionChange),
    [onWorkspaceProjectionChange, state],
  );
  const activeDocumentCount = getWorkspaceKnowledgeDocumentCount(state);

  useEffect(() => {
    if (activeDocumentCount !== null) {
      onDocumentCountChange?.(activeDocumentCount);
    }
  }, [activeDocumentCount, onDocumentCountChange]);

  useEffect(() => {
    setVisibility(KnowledgeDocumentVisibilities.Active);
    setQuery('');
    setStatusFilter('all');
    setPendingDeleteId(null);
    setDetailsOpen(false);
  }, [workspaceId]);

  return (
    <WorkspaceKnowledgeDocumentsPanelView
      state={state}
      visibility={visibility}
      query={query}
      statusFilter={statusFilter}
      pendingDeleteId={pendingDeleteId}
      detailsOpen={detailsOpen}
      onVisibilityChange={nextVisibility => {
        setVisibility(nextVisibility);
        setStatusFilter('all');
        setPendingDeleteId(null);
      }}
      onQueryChange={setQuery}
      onStatusFilterChange={setStatusFilter}
      onUpload={() => ignoreRejectedAction(actions.importFiles())}
      onOpen={documentId => {
        setDetailsOpen(true);
        ignoreRejectedAction(actions.open(documentId));
      }}
      onDeleteRequest={setPendingDeleteId}
      onDeleteConfirm={documentId => {
        const document = state.documents.find(item => item.id === documentId);
        setPendingDeleteId(null);
        if (document) {
          ignoreRejectedAction(actions.delete(document));
        }
      }}
      onDeleteCancel={() => setPendingDeleteId(null)}
      onRestore={document => ignoreRejectedAction(actions.restore(document))}
      onRetry={document => ignoreRejectedAction(actions.retry(document))}
      onCloseDetails={() => setDetailsOpen(false)}
    />
  );
}
