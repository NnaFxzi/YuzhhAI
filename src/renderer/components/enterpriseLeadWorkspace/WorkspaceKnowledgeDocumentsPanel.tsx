import {
  ArrowPathIcon,
  ArrowUpTrayIcon,
  ArrowUturnLeftIcon,
  CheckCircleIcon,
  ClockIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  MinusCircleIcon,
  SparklesIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  KnowledgeBaseErrorCode,
  type KnowledgeDocumentIndexStatus,
  KnowledgeDocumentIndexStatus as KnowledgeDocumentIndexStatuses,
  KnowledgeDocumentStatus as KnowledgeDocumentStatuses,
  KnowledgeDocumentVisibility as KnowledgeDocumentVisibilities,
  type KnowledgeDocumentVisibility,
  KnowledgeEnrichmentStatus,
  KnowledgeIngestionJobStatus,
  type KnowledgeIngestionStage,
  KnowledgeIngestionStage as KnowledgeIngestionStages,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeDocumentListItem,
  KnowledgeExtractionAuthorizationPreparation,
  KnowledgeImportBatchResult,
  KnowledgeImportItemResult,
} from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import { KnowledgeBaseServiceError } from '../../services/knowledgeBase';
import {
  canRetryKnowledgeDocumentIndex,
  getKnowledgeDocumentErrorKey,
  getKnowledgeDocumentExtractionPresentation,
  getKnowledgeDocumentIndexStatusKey,
  getKnowledgeDocumentStatusKey,
  summarizeKnowledgeImportBatch,
} from './knowledgeDocumentPresentation';
import {
  useWorkspaceKnowledgeDocuments,
  type WorkspaceKnowledgeDocumentsState,
} from './useWorkspaceKnowledgeDocuments';
import WorkspaceKnowledgeExtractionDialog from './WorkspaceKnowledgeExtractionDialog';
import { WorkspaceKnowledgeExtractionStatus } from './WorkspaceKnowledgeExtractionStatus';

export type WorkspaceProjectionChangeHandler = () => Promise<void> | void;

export interface WorkspaceKnowledgeDocumentsPanelProps {
  workspaceId: string;
  initialImportResult?: KnowledgeImportBatchResult;
  uploadButtonSlotId?: string;
  onDocumentCountChange?: (count: number) => void;
  onWorkspaceProjectionChange?: WorkspaceProjectionChangeHandler;
  onAiKnowledgeMetricsRefresh?: WorkspaceProjectionChangeHandler;
}

export const workspaceKnowledgeUploadButtonSlotId = 'enterprise-knowledge-upload-slot';

export interface WorkspaceKnowledgeDocumentsPanelActions {
  importFiles: () => Promise<void>;
  open: (documentId: string) => Promise<void>;
  delete: (document: KnowledgeDocumentListItem) => Promise<void>;
  restore: (document: KnowledgeDocumentListItem) => Promise<void>;
  retry: (document: KnowledgeDocumentListItem) => Promise<void>;
  retryLocalIndex: (document: KnowledgeDocumentListItem) => Promise<void>;
  cancelExtraction: (document: KnowledgeDocumentListItem) => Promise<void>;
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
  retryLocalIndex: async document => {
    await state.retryLocalIndex(document);
  },
  cancelExtraction: async document => {
    await state.cancelExtraction(document);
  },
});

export const WorkspaceKnowledgeExtractionIntentKind = {
  Request: 'request',
  Retry: 'retry',
} as const;
export type WorkspaceKnowledgeExtractionIntentKind =
  (typeof WorkspaceKnowledgeExtractionIntentKind)[keyof typeof WorkspaceKnowledgeExtractionIntentKind];

export interface WorkspaceKnowledgeExtractionIntent {
  kind: WorkspaceKnowledgeExtractionIntentKind;
  documentId: string;
  documentVersionId: string;
}

export interface WorkspaceKnowledgeExtractionDialogActions {
  prepare: () => Promise<KnowledgeExtractionAuthorizationPreparation>;
  send: (authorizationToken: string) => Promise<void>;
}

export const createWorkspaceKnowledgeExtractionDialogActions = (
  state: WorkspaceKnowledgeDocumentsState,
  intent: WorkspaceKnowledgeExtractionIntent,
): WorkspaceKnowledgeExtractionDialogActions => {
  const resolveDocument = (): KnowledgeDocumentListItem => {
    const document = state.documents.find(
      item =>
        item.id === intent.documentId && item.currentVersionId === intent.documentVersionId,
    );
    if (!document) {
      throw new KnowledgeBaseServiceError(KnowledgeBaseErrorCode.InvalidRequest);
    }
    return document;
  };
  return {
    prepare: async () => state.prepareExtractionAuthorization(resolveDocument()),
    send: async authorizationToken => {
      const document = resolveDocument();
      return intent.kind === WorkspaceKnowledgeExtractionIntentKind.Retry
        ? state.retryExtraction(document, authorizationToken)
        : state.requestExtraction(document, authorizationToken);
    },
  };
};

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

const stageKeys: Record<KnowledgeIngestionStage, string> = {
  [KnowledgeIngestionStages.Queued]: 'enterpriseKnowledgeStageQueued',
  [KnowledgeIngestionStages.Parsing]: 'enterpriseKnowledgeStageParsing',
  [KnowledgeIngestionStages.Ocr]: 'enterpriseKnowledgeStageOcr',
  [KnowledgeIngestionStages.Chunking]: 'enterpriseKnowledgeStageChunking',
  [KnowledgeIngestionStages.Indexing]: 'enterpriseKnowledgeStageIndexing',
  [KnowledgeIngestionStages.FactExtraction]: 'enterpriseKnowledgeStageFactExtraction',
};

type KnowledgeFailedImportItem = Extract<KnowledgeImportItemResult, { success: false }>;

const canRetryDocument = (document: KnowledgeDocumentListItem): boolean =>
  document.currentJob?.status === KnowledgeIngestionJobStatus.Cancelled ||
  (document.status === KnowledgeDocumentStatuses.Failed &&
    document.currentJob?.status === KnowledgeIngestionJobStatus.Failed);

type KnowledgeDocumentStatusPopoverKind =
  | 'document-parsing'
  | 'local-index'
  | 'ai-extraction';

export interface KnowledgeDocumentStatusPopoverRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface KnowledgeDocumentStatusPopoverSize {
  width: number;
  height: number;
}

export interface KnowledgeDocumentStatusPopoverViewport {
  width: number;
  height: number;
}

export interface KnowledgeDocumentStatusPopoverPlacement {
  placement: 'above' | 'below';
  top: number;
  left: number;
}

export const getKnowledgeDocumentStatusPopoverPlacement = (
  trigger: KnowledgeDocumentStatusPopoverRect,
  popover: KnowledgeDocumentStatusPopoverSize,
  viewport: KnowledgeDocumentStatusPopoverViewport,
): KnowledgeDocumentStatusPopoverPlacement => {
  const gap = 8;
  const margin = 12;
  const fitsBelow = trigger.bottom + gap + popover.height <= viewport.height - margin;
  const placement = fitsBelow ? 'below' : 'above';
  const rawTop = fitsBelow ? trigger.bottom + gap : trigger.top - gap - popover.height;
  const rawLeft = trigger.right - popover.width;
  return {
    placement,
    top: Math.max(margin, Math.min(rawTop, viewport.height - popover.height - margin)),
    left: Math.max(margin, Math.min(rawLeft, viewport.width - popover.width - margin)),
  };
};

interface KnowledgeDocumentStatusPopoverProps {
  kind: KnowledgeDocumentStatusPopoverKind;
  label: string;
  disabled: boolean;
  open: boolean;
  icon: React.ReactNode;
  onToggle: () => void;
  onClose: () => void;
  children: React.ReactNode;
}

const KnowledgeDocumentStatusPopover = ({
  kind,
  label,
  disabled,
  open,
  icon,
  onToggle,
  onClose,
  children,
}: KnowledgeDocumentStatusPopoverProps): React.ReactElement => {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = `knowledge-document-status-${useId()}`;
  const [popoverPosition, setPopoverPosition] =
    useState<KnowledgeDocumentStatusPopoverPlacement | null>(null);

  useEffect(() => {
    if (!open) {
      setPopoverPosition(null);
      return undefined;
    }

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }

    const updatePosition = (): void => {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) {
        return;
      }
      const triggerRect = trigger.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      setPopoverPosition(
        getKnowledgeDocumentStatusPopoverPlacement(
          {
            top: triggerRect.top,
            right: triggerRect.right,
            bottom: triggerRect.bottom,
            left: triggerRect.left,
            width: triggerRect.width,
            height: triggerRect.height,
          },
          { width: popoverRect.width, height: popoverRect.height },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      onClose();
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  const portalContent =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            role="dialog"
            data-status-popover-content={kind}
            data-status-popover-portal="true"
            className="fixed z-[70] max-h-[min(480px,calc(100vh-24px))] w-[min(320px,calc(100vw-24px))] overflow-auto rounded-xl border border-border bg-background p-3 text-left shadow-2xl"
            style={{
              position: 'fixed',
              top: popoverPosition?.top ?? 0,
              left: popoverPosition?.left ?? 0,
              visibility: popoverPosition ? 'visible' : 'hidden',
            }}
          >
            {children}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={containerRef} className="relative" data-knowledge-state={kind}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        data-status-popover-trigger={kind}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        title={label}
        className={`grid h-8 w-8 place-items-center rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-45 ${
          open
            ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
            : 'text-secondary hover:bg-surface-raised hover:text-foreground'
        }`}
        onClick={onToggle}
      >
        {icon}
        <span className="sr-only">{label}</span>
      </button>
      {portalContent}
    </div>
  );
};

const statusIconClassName = 'h-4 w-4';
const statusIconToneClassNames = {
  neutral: 'text-secondary',
  info: 'text-primary',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
  danger: 'text-red-500',
} as const;

const getDocumentParsingIcon = (
  document: KnowledgeDocumentListItem,
  jobIsActive: boolean,
): React.ReactElement => {
  if (jobIsActive) {
    return (
      <ArrowPathIcon
        aria-hidden="true"
        className={`${statusIconClassName} animate-spin text-primary motion-reduce:animate-none`}
      />
    );
  }
  if (document.status === KnowledgeDocumentStatuses.Ready) {
    return <CheckCircleIcon aria-hidden="true" className={`${statusIconClassName} text-emerald-500`} />;
  }
  if (document.status === KnowledgeDocumentStatuses.Failed) {
    return (
      <ExclamationTriangleIcon
        aria-hidden="true"
        className={`${statusIconClassName} text-red-500`}
      />
    );
  }
  if (document.status === KnowledgeDocumentStatuses.CompletedWithoutText) {
    return (
      <MinusCircleIcon
        aria-hidden="true"
        className={`${statusIconClassName} text-amber-500`}
      />
    );
  }
  return <ClockIcon aria-hidden="true" className={`${statusIconClassName} text-secondary`} />;
};

const getLocalIndexIcon = (
  status: KnowledgeDocumentIndexStatus | null,
): React.ReactElement => {
  if (status === KnowledgeDocumentIndexStatuses.Indexed) {
    return <CheckCircleIcon aria-hidden="true" className={`${statusIconClassName} text-emerald-500`} />;
  }
  if (status === KnowledgeDocumentIndexStatuses.Indexing) {
    return (
      <ArrowPathIcon
        aria-hidden="true"
        className={`${statusIconClassName} animate-spin text-primary motion-reduce:animate-none`}
      />
    );
  }
  if (status === KnowledgeDocumentIndexStatuses.Failed) {
    return (
      <ExclamationTriangleIcon
        aria-hidden="true"
        className={`${statusIconClassName} text-red-500`}
      />
    );
  }
  if (status === KnowledgeDocumentIndexStatuses.NotApplicable) {
    return <MinusCircleIcon aria-hidden="true" className={`${statusIconClassName} text-secondary`} />;
  }
  return <ClockIcon aria-hidden="true" className={`${statusIconClassName} text-secondary`} />;
};

const getAiExtractionIcon = (
  status: KnowledgeEnrichmentStatus | null,
): React.ReactElement => {
  if (status === KnowledgeEnrichmentStatus.Running) {
    return (
      <ArrowPathIcon
        aria-hidden="true"
        data-extraction-icon="running"
        className={`${statusIconClassName} animate-spin text-primary motion-reduce:animate-none`}
      />
    );
  }
  if (status === KnowledgeEnrichmentStatus.Queued) {
    return (
      <ClockIcon
        aria-hidden="true"
        data-extraction-icon="queued"
        className={`${statusIconClassName} text-primary`}
      />
    );
  }
  if (status === KnowledgeEnrichmentStatus.Completed) {
    return (
      <CheckCircleIcon
        aria-hidden="true"
        data-extraction-icon="completed"
        className={`${statusIconClassName} text-emerald-500`}
      />
    );
  }
  if (status === KnowledgeEnrichmentStatus.ReviewRequired) {
    return (
      <ExclamationTriangleIcon
        aria-hidden="true"
        data-extraction-icon="review-required"
        className={`${statusIconClassName} text-amber-500`}
      />
    );
  }
  if (
    status === KnowledgeEnrichmentStatus.Failed ||
    status === KnowledgeEnrichmentStatus.Cancelled ||
    status === KnowledgeEnrichmentStatus.Stale
  ) {
    return (
      <ExclamationTriangleIcon
        aria-hidden="true"
        data-extraction-icon="attention"
        className={`${statusIconClassName} text-red-500`}
      />
    );
  }
  return (
    <SparklesIcon
      aria-hidden="true"
      data-extraction-icon="not-started"
      className={`${statusIconClassName} ${statusIconToneClassNames.info}`}
    />
  );
};

interface KnowledgeDocumentRowProps {
  document: KnowledgeDocumentListItem;
  visibility: KnowledgeDocumentVisibility;
  disabled: boolean;
  onOpen: () => void;
  onDeleteRequest: () => void;
  onRestore: () => void;
  onRetry: () => void;
  onRetryLocalIndex: () => void;
  isExtractionMutating: boolean;
  onPrepareExtraction: () => void;
  onRetryExtraction: () => void;
  onCancelExtraction: () => void;
}

const KnowledgeDocumentRow = ({
  document,
  visibility,
  disabled,
  onOpen,
  onDeleteRequest,
  onRestore,
  onRetry,
  onRetryLocalIndex,
  isExtractionMutating,
  onPrepareExtraction,
  onRetryExtraction,
  onCancelExtraction,
}: KnowledgeDocumentRowProps): React.ReactElement => {
  const currentJob = document.currentJob;
  const jobIsActive =
    currentJob?.status === KnowledgeIngestionJobStatus.Queued ||
    currentJob?.status === KnowledgeIngestionJobStatus.Running;
  const progress = Math.round(Math.min(100, Math.max(0, (currentJob?.progress ?? 0) * 100)));
  const isDeleted = visibility === KnowledgeDocumentVisibilities.Deleted;
  const extraction = getKnowledgeDocumentExtractionPresentation(document);
  const [openPopover, setOpenPopover] = useState<KnowledgeDocumentStatusPopoverKind | null>(null);
  const parsingStatusLabel = i18nService.t(
    isDeleted
      ? 'enterpriseKnowledgeDocumentStatusDeleted'
      : getKnowledgeDocumentStatusKey(document.status),
  );
  const parsingLabel = `${i18nService.t('enterpriseKnowledgeDocumentParsing')} · ${parsingStatusLabel}`;
  const localIndexStatusLabel = document.localIndex
    ? i18nService.t(getKnowledgeDocumentIndexStatusKey(document.localIndex.status))
    : i18nService.t('enterpriseKnowledgeLocalIndexStatusNotStarted');
  const localIndexLabel = `${i18nService.t('enterpriseKnowledgeLocalIndex')} · ${localIndexStatusLabel}`;
  const extractionStatusLabel = i18nService.t(extraction.statusKey);
  const extractionLabel = `${i18nService.t('enterpriseKnowledgeAiExtraction')} · ${extractionStatusLabel}`;
  const closePopover = (): void => setOpenPopover(null);
  const togglePopover = (kind: KnowledgeDocumentStatusPopoverKind): void => {
    setOpenPopover(current => (current === kind ? null : kind));
  };

  return (
    <article
      data-document-id={document.id}
      data-document-row-density="compact"
      className="group border-b border-border/80 bg-background transition-colors last:border-b-0 hover:bg-surface-raised/45 [content-visibility:auto] [contain-intrinsic-size:auto_72px]"
    >
      <div className="flex min-w-0 items-center gap-3 px-3 py-2.5 sm:px-4">
        <button
          type="button"
          disabled={disabled}
          className="flex min-w-0 flex-1 items-center gap-3 text-left focus:outline-none focus:ring-2 focus:ring-primary/20"
          onClick={onOpen}
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <DocumentTextIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">
              {document.displayName}
            </span>
            <span className="mt-0.5 block truncate text-xs text-secondary">
              {[
                document.mimeType ?? i18nService.t('enterpriseKnowledgeFileTypeUnknown'),
                formatFileSize(document.fileSize),
                formatUpdatedAt(document.updatedAt),
              ].join(' · ')}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          <KnowledgeDocumentStatusPopover
            kind="document-parsing"
            label={parsingLabel}
            disabled={disabled}
            open={openPopover === 'document-parsing'}
            icon={getDocumentParsingIcon(document, jobIsActive)}
            onToggle={() => togglePopover('document-parsing')}
            onClose={closePopover}
          >
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {i18nService.t('enterpriseKnowledgeDocumentParsing')}
                </p>
                <p className="mt-1 text-xs text-secondary">{parsingStatusLabel}</p>
              </div>
              {currentJob ? (
                <div className="space-y-2 rounded-lg bg-surface-raised/60 p-2.5">
                  <div className="flex items-center justify-between gap-3 text-xs text-secondary">
                    <span>{i18nService.t(stageKeys[currentJob.stage])}</span>
                    <span>{formatTranslation('enterpriseKnowledgeProgress', { progress })}</span>
                  </div>
                  {jobIsActive ? (
                    <progress
                      className="h-1.5 w-full overflow-hidden rounded-full accent-primary"
                      max={100}
                      value={progress}
                      aria-label={i18nService.t('enterpriseKnowledgeProcessingProgress')}
                    />
                  ) : null}
                </div>
              ) : null}
              {canRetryDocument(document) ? (
                <button
                  type="button"
                  data-retry-document-id={document.id}
                  disabled={disabled}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/20 bg-primary/10 px-2.5 text-xs font-semibold text-primary disabled:opacity-45"
                  onClick={onRetry}
                >
                  <ArrowPathIcon className="h-4 w-4" />
                  {i18nService.t('enterpriseKnowledgeRetryDocument')}
                </button>
              ) : null}
            </div>
          </KnowledgeDocumentStatusPopover>

          {!isDeleted ? (
            <KnowledgeDocumentStatusPopover
              kind="local-index"
              label={localIndexLabel}
              disabled={disabled}
              open={openPopover === 'local-index'}
              icon={getLocalIndexIcon(document.localIndex?.status ?? null)}
              onToggle={() => togglePopover('local-index')}
              onClose={closePopover}
            >
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {i18nService.t('enterpriseKnowledgeLocalIndex')}
                  </p>
                  <p className="mt-1 text-xs text-secondary">{localIndexStatusLabel}</p>
                </div>
                {document.localIndex?.status === KnowledgeDocumentIndexStatuses.Indexed ? (
                  <p className="rounded-lg bg-surface-raised/60 p-2.5 text-xs text-secondary">
                    {formatTranslation('enterpriseKnowledgeLocalIndexChunkCount', {
                      count: document.localIndex.chunkCount,
                    })}
                  </p>
                ) : null}
                {canRetryKnowledgeDocumentIndex(document) ? (
                  <button
                    type="button"
                    data-retry-local-index-document-id={document.id}
                    disabled={disabled}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/20 bg-primary/10 px-2.5 text-xs font-semibold text-primary disabled:opacity-45"
                    onClick={onRetryLocalIndex}
                  >
                    <ArrowPathIcon className="h-4 w-4" />
                    {i18nService.t('enterpriseKnowledgeRetryLocalIndex')}
                  </button>
                ) : null}
              </div>
            </KnowledgeDocumentStatusPopover>
          ) : null}

          {!isDeleted ? (
            <KnowledgeDocumentStatusPopover
              kind="ai-extraction"
              label={extractionLabel}
              disabled={isExtractionMutating}
              open={openPopover === 'ai-extraction'}
              icon={getAiExtractionIcon(extraction.status)}
              onToggle={() => togglePopover('ai-extraction')}
              onClose={closePopover}
            >
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {i18nService.t('enterpriseKnowledgeAiExtraction')}
                  </p>
                  <p className="mt-1 text-xs text-secondary">{extractionStatusLabel}</p>
                </div>
                <WorkspaceKnowledgeExtractionStatus
                  presentation={extraction}
                  isMutating={isExtractionMutating}
                  onCancel={onCancelExtraction}
                  onRetry={onRetryExtraction}
                />
              </div>
            </KnowledgeDocumentStatusPopover>
          ) : null}
          {!isDeleted && extraction.canPrepare ? (
            <button
              type="button"
              data-prepare-extraction-document-id={document.id}
              disabled={isExtractionMutating}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/20 bg-primary/10 px-2.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={onPrepareExtraction}
            >
              <SparklesIcon className="h-4 w-4" />
              {i18nService.t(
                extraction.showsStalePriorVersion
                  ? 'enterpriseKnowledgeExtractCurrentVersion'
                  : 'enterpriseKnowledgeExtractAiKnowledge',
              )}
            </button>
          ) : null}
        </div>

        <div className="hidden shrink-0 text-right text-xs text-secondary md:block">
          {formatUpdatedAt(document.updatedAt)}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {isDeleted ? (
            <button
              type="button"
              data-restore-document-id={document.id}
              disabled={disabled}
              aria-label={i18nService.t('enterpriseKnowledgeRestoreDocument')}
              title={i18nService.t('enterpriseKnowledgeRestoreDocument')}
              className="grid h-8 w-8 place-items-center rounded-md text-secondary transition-colors hover:bg-surface-raised hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
              onClick={onRestore}
            >
              <ArrowUturnLeftIcon className="h-4 w-4" />
            </button>
          ) : (
            <>
              {canRetryDocument(document) ? (
                <button
                  type="button"
                  data-retry-document-id={document.id}
                  disabled={disabled}
                  aria-label={i18nService.t('enterpriseKnowledgeRetryDocument')}
                  title={i18nService.t('enterpriseKnowledgeRetryDocument')}
                  className="grid h-8 w-8 place-items-center rounded-md text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={onRetry}
                >
                  <ArrowPathIcon className="h-4 w-4" />
                </button>
              ) : null}
              <button
                type="button"
                data-delete-document-id={document.id}
                disabled={disabled}
                aria-label={i18nService.t('enterpriseKnowledgeDeleteDocument')}
                title={i18nService.t('enterpriseKnowledgeDeleteDocument')}
                className="grid h-8 w-8 place-items-center rounded-md text-red-600 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-45 dark:text-red-300"
                onClick={onDeleteRequest}
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
};

export interface WorkspaceKnowledgeDocumentsPanelViewProps {
  state: WorkspaceKnowledgeDocumentsState;
  visibility: KnowledgeDocumentVisibility;
  uploadButtonSlotId?: string;
  pendingDeleteId: string | null;
  detailsOpen: boolean;
  onVisibilityChange: (visibility: KnowledgeDocumentVisibility) => void;
  onUpload: () => void;
  onOpen: (documentId: string) => void;
  onDeleteRequest: (documentId: string) => void;
  onDeleteConfirm: (documentId: string) => void;
  onDeleteCancel: () => void;
  onRestore: (document: KnowledgeDocumentListItem) => void;
  onRetry: (document: KnowledgeDocumentListItem) => void;
  onRetryLocalIndex: (document: KnowledgeDocumentListItem) => void;
  onPrepareExtraction: (document: KnowledgeDocumentListItem) => void;
  onRetryExtraction: (document: KnowledgeDocumentListItem) => void;
  onCancelExtraction: (document: KnowledgeDocumentListItem) => void;
  onCloseDetails: () => void;
  extractionDialog?: React.ReactNode;
}

export const WorkspaceKnowledgeDocumentsPanelView = ({
  state,
  visibility,
  uploadButtonSlotId,
  pendingDeleteId,
  detailsOpen,
  onVisibilityChange,
  onUpload,
  onOpen,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
  onRestore,
  onRetry,
  onRetryLocalIndex,
  onPrepareExtraction,
  onRetryExtraction,
  onCancelExtraction,
  onCloseDetails,
  extractionDialog,
}: WorkspaceKnowledgeDocumentsPanelViewProps): React.ReactElement => {
  const sourceRows =
    visibility === KnowledgeDocumentVisibilities.Active ? state.documents : state.deletedDocuments;
  const rows = sourceRows;
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
  const [uploadButtonSlot, setUploadButtonSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!uploadButtonSlotId || typeof document === 'undefined') {
      setUploadButtonSlot(null);
      return;
    }
    setUploadButtonSlot(document.getElementById(uploadButtonSlotId));
  }, [uploadButtonSlotId]);

  const uploadButton = (
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
  );
  const uploadButtonContent = uploadButtonSlot
    ? createPortal(uploadButton, uploadButtonSlot)
    : uploadButton;

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {uploadButtonContent}

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

      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
        {state.isLoading && rows.length === 0 ? (
          <div className="grid min-h-[240px] place-items-center text-sm text-secondary">
            {i18nService.t('enterpriseKnowledgeLoadingDocuments')}
          </div>
        ) : rows.length > 0 ? (
          <div
            data-testid="knowledge-document-list"
            className="overflow-visible rounded-xl border border-border bg-background shadow-sm"
          >
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
                onRetryLocalIndex={() => onRetryLocalIndex(document)}
                isExtractionMutating={state.extractionMutatingDocumentIds.includes(document.id)}
                onPrepareExtraction={() => onPrepareExtraction(document)}
                onRetryExtraction={() => onRetryExtraction(document)}
                onCancelExtraction={() => onCancelExtraction(document)}
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

      <footer className="shrink-0 border-t border-border px-5 py-2.5">
        <button
          type="button"
          data-testid={
            visibility === KnowledgeDocumentVisibilities.Active
              ? 'knowledge-trash-entry'
              : 'knowledge-documents-entry'
          }
          aria-current={visibility === KnowledgeDocumentVisibilities.Deleted ? 'page' : undefined}
          className={`inline-flex h-8 items-center gap-2 rounded-md px-2 text-xs font-medium transition-colors ${
            visibility === KnowledgeDocumentVisibilities.Deleted
              ? 'bg-surface-raised text-foreground'
              : 'text-secondary hover:bg-surface-raised hover:text-foreground'
          }`}
          onClick={() =>
            onVisibilityChange(
              visibility === KnowledgeDocumentVisibilities.Active
                ? KnowledgeDocumentVisibilities.Deleted
                : KnowledgeDocumentVisibilities.Active,
            )
          }
        >
          {visibility === KnowledgeDocumentVisibilities.Active ? (
            <TrashIcon className="h-4 w-4" />
          ) : (
            <ArrowUturnLeftIcon className="h-4 w-4" />
          )}
          {visibility === KnowledgeDocumentVisibilities.Active
            ? `${i18nService.t('enterpriseKnowledgeDeletedDocuments')} (${state.deletedDocuments.length})`
            : i18nService.t('enterpriseKnowledgeFileListTitle')}
        </button>
      </footer>

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

      {extractionDialog}
    </section>
  );
};

const ignoreRejectedAction = (action: Promise<void>): void => {
  void action.catch(() => undefined);
};

export default function WorkspaceKnowledgeDocumentsPanel({
  workspaceId,
  initialImportResult,
  uploadButtonSlotId,
  onDocumentCountChange,
  onWorkspaceProjectionChange,
  onAiKnowledgeMetricsRefresh,
}: WorkspaceKnowledgeDocumentsPanelProps): React.ReactElement {
  const state = useWorkspaceKnowledgeDocuments(workspaceId, initialImportResult, {
    onReviewRequired: onAiKnowledgeMetricsRefresh,
  });
  const [visibility, setVisibility] = useState<KnowledgeDocumentVisibility>(
    KnowledgeDocumentVisibilities.Active,
  );
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [extractionIntent, setExtractionIntent] =
    useState<WorkspaceKnowledgeExtractionIntent | null>(null);
  const actions = useMemo(
    () => createWorkspaceKnowledgeDocumentsPanelActions(state, onWorkspaceProjectionChange),
    [onWorkspaceProjectionChange, state],
  );
  const activeDocumentCount = getWorkspaceKnowledgeDocumentCount(state);
  const extractionDialogActions = useMemo(
    () =>
      extractionIntent
        ? createWorkspaceKnowledgeExtractionDialogActions(state, extractionIntent)
        : null,
    [extractionIntent, state],
  );
  const extractionIntentDocument = extractionIntent
    ? state.documents.find(
        document =>
          document.id === extractionIntent.documentId &&
          document.currentVersionId === extractionIntent.documentVersionId,
      ) ?? null
    : null;

  useEffect(() => {
    if (activeDocumentCount !== null) {
      onDocumentCountChange?.(activeDocumentCount);
    }
  }, [activeDocumentCount, onDocumentCountChange]);

  useEffect(() => {
    setVisibility(KnowledgeDocumentVisibilities.Active);
    setPendingDeleteId(null);
    setDetailsOpen(false);
    setExtractionIntent(null);
  }, [workspaceId]);

  useEffect(() => {
    if (extractionIntent && !extractionIntentDocument) {
      setExtractionIntent(null);
    }
  }, [extractionIntent, extractionIntentDocument]);

  return (
    <WorkspaceKnowledgeDocumentsPanelView
      state={state}
      visibility={visibility}
      uploadButtonSlotId={uploadButtonSlotId}
      pendingDeleteId={pendingDeleteId}
      detailsOpen={detailsOpen}
      onVisibilityChange={nextVisibility => {
        setVisibility(nextVisibility);
        setPendingDeleteId(null);
      }}
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
      onRetryLocalIndex={document => ignoreRejectedAction(actions.retryLocalIndex(document))}
      onPrepareExtraction={document =>
        setExtractionIntent({
          kind: WorkspaceKnowledgeExtractionIntentKind.Request,
          documentId: document.id,
          documentVersionId: document.currentVersionId,
        })
      }
      onRetryExtraction={document =>
        setExtractionIntent({
          kind: WorkspaceKnowledgeExtractionIntentKind.Retry,
          documentId: document.id,
          documentVersionId: document.currentVersionId,
        })
      }
      onCancelExtraction={document =>
        ignoreRejectedAction(actions.cancelExtraction(document))
      }
      onCloseDetails={() => setDetailsOpen(false)}
      extractionDialog={
        extractionIntent && extractionIntentDocument && extractionDialogActions ? (
          <WorkspaceKnowledgeExtractionDialog
            key={`${extractionIntent.kind}:${extractionIntent.documentId}:${extractionIntent.documentVersionId}`}
            prepare={extractionDialogActions.prepare}
            send={extractionDialogActions.send}
            onClose={() => setExtractionIntent(null)}
          />
        ) : null
      }
    />
  );
}
