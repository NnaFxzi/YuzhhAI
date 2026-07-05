import {
  ArrowRightIcon,
  ClockIcon,
  EllipsisHorizontalIcon,
  ExclamationTriangleIcon,
  FolderOpenIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { EnterpriseLeadWorkspace } from '../../../shared/enterpriseLeadWorkspace/types';
import { i18nService } from '../../services/i18n';
import Modal from '../common/Modal';
import {
  EnterpriseLeadEntryAction,
  EnterpriseLeadWorkspaceHistoryState,
  getEntryHomeActions,
  getHistoryModalState,
  shouldRefreshHistoryOnEntryAction,
  sortWorkspacesByRecentUpdate,
  summarizeWorkspaceDraft,
} from './enterpriseLeadWorkspaceUi';

interface WorkspaceEntryHomeProps {
  workspaces: EnterpriseLeadWorkspace[];
  isLoadingWorkspaces: boolean;
  workspaceListError: string;
  onCreate: () => void;
  onHistoryOpen: () => void;
  onOpen: (workspaceId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => Promise<boolean>;
}

const HISTORY_MODAL_TITLE_ID = 'enterprise-lead-history-title';
const HISTORY_MODAL_DESCRIPTION_ID = 'enterprise-lead-history-desc';
const DELETE_CONFIRM_TITLE_ID = 'enterprise-lead-delete-confirm-title';
const DELETE_CONFIRM_DESCRIPTION_ID = 'enterprise-lead-delete-confirm-desc';
const FOCUSABLE_MODAL_SELECTOR = [
  'button',
  '[href]',
  'input',
  'select',
  'textarea',
  '[tabindex]:not([tabindex="-1"])',
].join(',');
const entryBrandLogoSrc = new URL(
  '../../../../brand/yuzhh-logo-ai-concept.png',
  import.meta.url,
).href;

const getSummaryLabels = () => ({
  productsFallback: i18nService.t('enterpriseLeadProductsFallback'),
  customersFallback: i18nService.t('enterpriseLeadCustomersFallback'),
  targetCustomersPrefix: i18nService.t('enterpriseLeadTargetCustomersPrefix'),
});

const formatWorkspaceUpdatedDate = (updatedAt: string): string => {
  const timestamp = Date.parse(updatedAt);

  if (Number.isNaN(timestamp)) {
    return '';
  }

  try {
    const locale = i18nService.getLanguage() === 'zh' ? 'zh-CN' : 'en-US';
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
};

const formatI18nMessage = (
  key: string,
  values: Record<string, string>,
): string => Object.entries(values).reduce(
  (message, [name, value]) => message.replace(`{${name}}`, value),
  i18nService.t(key),
);

const getFocusableElements = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_MODAL_SELECTOR)).filter(
    element => {
      const disabledElement = element as HTMLElement & { disabled?: boolean };

      return (
        !disabledElement.disabled &&
        element.getAttribute('aria-hidden') !== 'true' &&
        !element.closest('[aria-hidden="true"]')
      );
    },
  );

const getEntryIcon = (actionId: EnterpriseLeadEntryAction): React.ReactNode => {
  if (actionId === EnterpriseLeadEntryAction.Create) {
    return <PlusIcon className="h-6 w-6" />;
  }

  return <FolderOpenIcon className="h-6 w-6" />;
};

export interface WorkspaceHistoryListProps {
  historyState: EnterpriseLeadWorkspaceHistoryState;
  sortedWorkspaces: EnterpriseLeadWorkspace[];
  activeActionsWorkspaceId: string | null;
  isDeletingWorkspaceId: string | null;
  onOpen: (workspaceId: string) => void;
  onCreate: () => void;
  onToggleActions: (workspaceId: string) => void;
  onRequestDelete: (workspace: EnterpriseLeadWorkspace) => void;
}

export const WorkspaceHistoryList: React.FC<WorkspaceHistoryListProps> = ({
  historyState,
  sortedWorkspaces,
  activeActionsWorkspaceId,
  isDeletingWorkspaceId,
  onOpen,
  onCreate,
  onToggleActions,
  onRequestDelete,
}) => {
  if (historyState === EnterpriseLeadWorkspaceHistoryState.Loading) {
    return (
      <div className="flex min-h-[180px] items-center justify-center rounded-lg border border-border bg-background px-4 py-8 text-sm text-secondary">
        {i18nService.t('loading')}
      </div>
    );
  }

  if (historyState === EnterpriseLeadWorkspaceHistoryState.Error) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
        {i18nService.t('enterpriseLeadHistoryLoadFailed')}
      </div>
    );
  }

  if (historyState === EnterpriseLeadWorkspaceHistoryState.Empty) {
    return (
      <div className="rounded-lg border border-border bg-background px-4 py-6 text-center">
        <p className="text-sm font-medium text-foreground">
          {i18nService.t('enterpriseLeadHistoryEmptyTitle')}
        </p>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-secondary">
          {i18nService.t('enterpriseLeadHistoryEmptyDesc')}
        </p>
        <button
          type="button"
          onClick={onCreate}
          className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {i18nService.t('enterpriseLeadCreateWorkspace')}
        </button>
      </div>
    );
  }

  return (
    <div className="grid max-h-[360px] min-w-0 gap-2 overflow-y-auto overflow-x-hidden pr-1">
      {sortedWorkspaces.map(workspace => {
        const summary = summarizeWorkspaceDraft(workspace, getSummaryLabels());
        const updatedDate = formatWorkspaceUpdatedDate(workspace.updatedAt);
        const isActionsOpen = activeActionsWorkspaceId === workspace.id;
        const isDeleting = isDeletingWorkspaceId === workspace.id;

        return (
          <article
            key={workspace.id}
            className="group relative min-w-0 overflow-visible rounded-lg border border-border bg-background transition-colors hover:border-primary/40 hover:bg-surface-raised focus-within:ring-2 focus-within:ring-primary/20"
          >
            <button
              type="button"
              onClick={() => onOpen(workspace.id)}
              disabled={isDeleting}
              className="block w-full min-w-0 rounded-lg p-3 pr-12 text-left transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="block truncate text-sm font-semibold text-foreground">
                {summary.name}
              </span>
              <span className="mt-1 line-clamp-2 break-words text-sm leading-5 text-secondary">
                {summary.products}
              </span>
              <span className="mt-1 line-clamp-2 break-words text-xs leading-5 text-secondary">
                {summary.targetCustomers}
              </span>
              {updatedDate && (
                <span className="mt-2 inline-flex flex-wrap items-center gap-1 text-xs text-secondary">
                  <ClockIcon className="h-3.5 w-3.5" />
                  {i18nService.t('enterpriseLeadHistoryUpdatedAtPrefix')}
                  {updatedDate}
                </span>
              )}
            </button>
            <div className="absolute right-2 top-2">
              <button
                type="button"
                onClick={() => onToggleActions(workspace.id)}
                disabled={isDeleting}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-secondary opacity-80 transition-colors hover:bg-surface hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-40 group-hover:opacity-100"
                aria-label={i18nService.t('enterpriseLeadHistoryWorkspaceActions')}
                aria-haspopup="menu"
                aria-expanded={isActionsOpen}
              >
                <EllipsisHorizontalIcon className="h-5 w-5" />
              </button>
              {isActionsOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-9 z-10 min-w-[132px] rounded-lg border border-border bg-surface p-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => onRequestDelete(workspace)}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:text-red-300"
                  >
                    <TrashIcon className="h-4 w-4" />
                    {i18nService.t('enterpriseLeadHistoryDeleteWorkspace')}
                  </button>
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
};

export interface WorkspaceDeleteConfirmDialogProps {
  workspace: EnterpriseLeadWorkspace | null;
  isDeletingWorkspaceId: string | null;
  deleteError: string;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

export const WorkspaceDeleteConfirmDialog: React.FC<WorkspaceDeleteConfirmDialogProps> = ({
  workspace,
  isDeletingWorkspaceId,
  deleteError,
  onCancelDelete,
  onConfirmDelete,
}) => {
  if (!workspace) {
    return null;
  }

  const isDeleting = Boolean(isDeletingWorkspaceId);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 px-4"
      onClick={() => {
        if (!isDeleting) {
          onCancelDelete();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={DELETE_CONFIRM_TITLE_ID}
        aria-describedby={DELETE_CONFIRM_DESCRIPTION_ID}
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 text-left shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-600 dark:text-red-300">
            <ExclamationTriangleIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3
              id={DELETE_CONFIRM_TITLE_ID}
              className="text-base font-semibold text-foreground"
            >
              {formatI18nMessage('enterpriseLeadHistoryDeleteConfirmTitle', {
                name: workspace.name,
              })}
            </h3>
            <p
              id={DELETE_CONFIRM_DESCRIPTION_ID}
              className="mt-2 text-sm leading-6 text-secondary"
            >
              {i18nService.t('enterpriseLeadHistoryDeleteWarning')}
            </p>
            {deleteError && (
              <p className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-300">
                {deleteError}
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelDelete}
            disabled={isDeleting}
            autoFocus
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {i18nService.t('enterpriseLeadHistoryCancelDelete')}
          </button>
          <button
            type="button"
            onClick={onConfirmDelete}
            disabled={isDeleting}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-red-600 px-3 text-sm font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isDeleting
              ? i18nService.t('enterpriseLeadHistoryDeleting')
              : i18nService.t('enterpriseLeadHistoryDeleteWorkspace')}
          </button>
        </div>
      </section>
    </div>
  );
};

export const WorkspaceEntryHome: React.FC<WorkspaceEntryHomeProps> = ({
  workspaces,
  isLoadingWorkspaces,
  workspaceListError,
  onCreate,
  onHistoryOpen,
  onOpen,
  onDeleteWorkspace,
}) => {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [activeActionsWorkspaceId, setActiveActionsWorkspaceId] = useState<string | null>(null);
  const [pendingDeleteWorkspace, setPendingDeleteWorkspace] =
    useState<EnterpriseLeadWorkspace | null>(null);
  const [isDeletingWorkspaceId, setIsDeletingWorkspaceId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const historyDialogRef = useRef<HTMLDivElement>(null);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const actions = getEntryHomeActions();
  const sortedWorkspaces = useMemo(
    () => sortWorkspacesByRecentUpdate(workspaces),
    [workspaces],
  );
  const historyState = getHistoryModalState({
    isLoading: isLoadingWorkspaces,
    error: workspaceListError,
    workspaces: sortedWorkspaces,
  });

  const resetHistoryActions = useCallback((): void => {
    setActiveActionsWorkspaceId(null);
    setPendingDeleteWorkspace(null);
    setIsDeletingWorkspaceId(null);
    setDeleteError('');
  }, []);

  const closeHistoryModal = useCallback((): void => {
    setIsHistoryOpen(false);
    resetHistoryActions();
    requestAnimationFrame(() => {
      historyTriggerRef.current?.focus();
    });
  }, [resetHistoryActions]);

  const handleToggleHistoryActions = useCallback((workspaceId: string): void => {
    setPendingDeleteWorkspace(null);
    setDeleteError('');
    setActiveActionsWorkspaceId(previous => (previous === workspaceId ? null : workspaceId));
  }, []);

  const handleRequestDelete = useCallback((workspace: EnterpriseLeadWorkspace): void => {
    setActiveActionsWorkspaceId(null);
    setPendingDeleteWorkspace(workspace);
    setDeleteError('');
  }, []);

  const handleCancelDelete = useCallback((): void => {
    if (isDeletingWorkspaceId) {
      return;
    }
    setPendingDeleteWorkspace(null);
    setDeleteError('');
  }, [isDeletingWorkspaceId]);

  const handleConfirmDelete = useCallback((): void => {
    if (!pendingDeleteWorkspace || isDeletingWorkspaceId) {
      return;
    }

    const workspaceId = pendingDeleteWorkspace.id;
    setIsDeletingWorkspaceId(workspaceId);
    setDeleteError('');

    void onDeleteWorkspace(workspaceId)
      .then(deleted => {
        if (!deleted) {
          setDeleteError(i18nService.t('enterpriseLeadHistoryDeleteFailed'));
          return;
        }
        setPendingDeleteWorkspace(null);
        setActiveActionsWorkspaceId(null);
      })
      .catch(() => {
        setDeleteError(i18nService.t('enterpriseLeadHistoryDeleteFailed'));
      })
      .finally(() => {
        setIsDeletingWorkspaceId(null);
      });
  }, [isDeletingWorkspaceId, onDeleteWorkspace, pendingDeleteWorkspace]);

  useEffect(() => {
    if (!isHistoryOpen) {
      return;
    }

    const openDialogElement = historyDialogRef.current;
    const openFocusableElements = openDialogElement
      ? getFocusableElements(openDialogElement)
      : [];

    if (openFocusableElements.length > 0) {
      openFocusableElements[0].focus();
    } else {
      openDialogElement?.focus();
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (pendingDeleteWorkspace) {
          handleCancelDelete();
          return;
        }

        closeHistoryModal();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const dialogElement = historyDialogRef.current;

      if (!dialogElement) {
        return;
      }

      const focusableElements = getFocusableElements(dialogElement);

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogElement.focus();
        return;
      }

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (!(activeElement instanceof HTMLElement)) {
        event.preventDefault();
        firstFocusable.focus();
        return;
      }

      if (activeElement === dialogElement) {
        event.preventDefault();
        if (event.shiftKey) {
          lastFocusable.focus();
          return;
        }

        firstFocusable.focus();
        return;
      }

      if (event.shiftKey && activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
        return;
      }

      if (!event.shiftKey && activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
        return;
      }

      if (!dialogElement.contains(activeElement)) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeHistoryModal, handleCancelDelete, isHistoryOpen, pendingDeleteWorkspace]);

  const handleAction = (actionId: EnterpriseLeadEntryAction): void => {
    if (actionId === EnterpriseLeadEntryAction.Create) {
      onCreate();
      return;
    }

    if (shouldRefreshHistoryOnEntryAction(actionId)) {
      resetHistoryActions();
      onHistoryOpen();
    }

    setIsHistoryOpen(true);
  };

  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-background px-6 py-12">
      <main
        className="grid w-full max-w-[880px] justify-items-center gap-8"
        aria-label={i18nService.t('enterpriseLeadEntryHomeAriaLabel')}
      >
        <div
          className="inline-flex items-center justify-center gap-3 text-[#202938]"
          aria-label={i18nService.t('enterpriseLeadEntryBrandName')}
        >
          <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-lg bg-white shadow-[0_8px_24px_rgba(32,41,56,0.07)]">
            <img
              src={entryBrandLogoSrc}
              alt=""
              className="h-full w-full object-cover"
            />
          </span>
          <span className="text-[30px] font-[820] leading-tight">
            {i18nService.t('enterpriseLeadEntryBrandName')}
          </span>
        </div>

        <section
          className="w-full max-w-[720px] rounded-[14px] border border-[#e3e8f0] bg-white px-8 py-10 shadow-[0_28px_70px_rgba(32,41,56,0.1)] sm:px-14 sm:py-14"
          aria-labelledby="enterprise-lead-entry-title"
        >
          <div>
            <h1
              id="enterprise-lead-entry-title"
              className="m-0 text-[34px] font-[820] leading-tight text-[#202938] sm:text-[38px]"
            >
              {i18nService.t('enterpriseLeadEntryTitle')}
            </h1>
            <p className="mt-3 text-lg leading-[30px] text-[#5f6b7a]">
              {i18nService.t('enterpriseLeadEntrySubtitle')}
            </p>
          </div>

          <div
            className="mt-9 grid gap-5 md:grid-cols-2"
            aria-label={i18nService.t('enterpriseLeadEntryActionsAriaLabel')}
          >
            {actions.map(action => {
              const isPrimary = action.tone === 'primary';

              return (
                <button
                  key={action.id}
                  ref={
                    action.id === EnterpriseLeadEntryAction.History
                      ? historyTriggerRef
                      : undefined
                  }
                  type="button"
                  onClick={() => handleAction(action.id)}
                  className={`group flex min-h-[138px] flex-col justify-between rounded-lg border px-[22px] py-5 text-left shadow-[0_2px_8px_rgba(32,41,56,0.04)] transition duration-150 focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                    isPrimary
                      ? 'border-[#3b82f6] bg-[#3b82f6] text-white hover:-translate-y-0.5 hover:border-[#2f75ee] hover:bg-[#2f75ee] hover:shadow-[0_16px_32px_rgba(47,117,238,0.22)]'
                      : 'border-[#e3e8f0]/90 bg-white/80 text-[#202938] hover:-translate-y-0.5 hover:border-[#3b82f6]/30 hover:bg-white hover:shadow-[0_8px_24px_rgba(32,41,56,0.07)]'
                  }`}
                >
                  <span className="grid w-full grid-cols-[42px_minmax(0,1fr)] items-center gap-x-3.5">
                    <span
                      className={`row-span-2 grid h-[42px] w-[42px] place-items-center rounded-full border shadow-[0_2px_6px_rgba(32,41,56,0.05)] ${
                        isPrimary
                          ? 'border-white/20 bg-white/15 text-white'
                          : 'border-[#e3e8f0] bg-white text-[#2f75ee]'
                      }`}
                    >
                      {getEntryIcon(action.id)}
                    </span>
                    <span
                      className={`block text-base font-bold leading-[23px] ${
                        isPrimary ? 'text-white' : 'text-[#202938]'
                      }`}
                    >
                      {i18nService.t(action.titleKey)}
                    </span>
                    <span
                      className={`mt-1 block text-[13px] leading-5 ${
                        isPrimary ? 'text-white/80' : 'text-[#5f6b7a]'
                      }`}
                    >
                      {i18nService.t(action.descriptionKey)}
                    </span>
                  </span>
                  <span
                    className={`mt-4 inline-flex items-center gap-2.5 text-[13px] font-bold leading-5 ${
                      isPrimary ? 'text-white' : 'text-[#2f75ee]'
                    }`}
                  >
                    {i18nService.t(action.actionKey)}
                    <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </main>

      <Modal
        isOpen={isHistoryOpen}
        onClose={closeHistoryModal}
        className="max-h-[calc(100vh-64px)] w-full max-w-lg overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-surface p-5 shadow-xl"
        overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      >
        <div
          ref={historyDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={HISTORY_MODAL_TITLE_ID}
          aria-describedby={HISTORY_MODAL_DESCRIPTION_ID}
          tabIndex={-1}
          className="min-w-0 focus:outline-none"
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2
                id={HISTORY_MODAL_TITLE_ID}
                className="text-base font-semibold text-foreground"
              >
                {i18nService.t('enterpriseLeadHistoryModalTitle')}
              </h2>
              <p
                id={HISTORY_MODAL_DESCRIPTION_ID}
                className="mt-1 text-sm text-secondary"
              >
                {i18nService.t('enterpriseLeadHistoryModalDesc')}
              </p>
            </div>
            <button
              type="button"
              onClick={closeHistoryModal}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
              aria-label={i18nService.t('enterpriseLeadHistoryModalClose')}
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          <WorkspaceHistoryList
            historyState={historyState}
            sortedWorkspaces={sortedWorkspaces}
            activeActionsWorkspaceId={activeActionsWorkspaceId}
            isDeletingWorkspaceId={isDeletingWorkspaceId}
            onOpen={workspaceId => {
              closeHistoryModal();
              onOpen(workspaceId);
            }}
            onCreate={() => {
              closeHistoryModal();
              onCreate();
            }}
            onToggleActions={handleToggleHistoryActions}
            onRequestDelete={handleRequestDelete}
          />
          <WorkspaceDeleteConfirmDialog
            workspace={pendingDeleteWorkspace}
            isDeletingWorkspaceId={isDeletingWorkspaceId}
            deleteError={deleteError}
            onCancelDelete={handleCancelDelete}
            onConfirmDelete={handleConfirmDelete}
          />
        </div>
      </Modal>
    </div>
  );
};

export default WorkspaceEntryHome;
