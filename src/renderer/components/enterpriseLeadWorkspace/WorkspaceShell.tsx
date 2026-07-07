import {
  ArrowLeftIcon,
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  RectangleGroupIcon,
  TrashIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import React, { useCallback, useState } from 'react';

import type { EnterpriseLeadWorkspace } from '../../../shared/enterpriseLeadWorkspace/types';
import { i18nService } from '../../services/i18n';
import {
  type EnterpriseLeadWorkbenchNavIcon as EnterpriseLeadWorkbenchNavIconType,
  EnterpriseLeadWorkspaceInternalPage,
  type EnterpriseLeadWorkspaceInternalPage as EnterpriseLeadWorkspaceInternalPageType,
  getDefaultWorkbenchSidebarMode,
  getWorkbenchSidebarWidth,
  getWorkspaceInternalPages,
} from './enterpriseLeadWorkspaceUi';
import type { WorkspaceConversationRecord } from './workspaceCoworkSessionRecords';

interface WorkspaceShellProps {
  workspace: EnterpriseLeadWorkspace;
  activePage: EnterpriseLeadWorkspaceInternalPageType;
  onPageChange: (page: EnterpriseLeadWorkspaceInternalPageType) => void;
  onExitWorkspace?: () => void;
  chatSessions?: WorkspaceConversationRecord[];
  activeChatSessionId?: string | null;
  onChatSessionSelect?: (sessionId: string) => void;
  onChatSessionDelete?: (sessionId: string) => Promise<boolean>;
  onSearchOpen?: () => void;
  children: React.ReactNode;
}

const CHAT_SESSION_DELETE_TITLE_ID = 'enterprise-lead-chat-session-delete-title';
const CHAT_SESSION_DELETE_DESCRIPTION_ID = 'enterprise-lead-chat-session-delete-desc';

export const WorkspaceShellNavAction = {
  ChangePage: 'change_page',
  OpenSearch: 'open_search',
} as const;
export type WorkspaceShellNavAction =
  (typeof WorkspaceShellNavAction)[keyof typeof WorkspaceShellNavAction];

export const getWorkspaceShellNavAction = (
  page: EnterpriseLeadWorkspaceInternalPageType,
): WorkspaceShellNavAction =>
  page === EnterpriseLeadWorkspaceInternalPage.Search
    ? WorkspaceShellNavAction.OpenSearch
    : WorkspaceShellNavAction.ChangePage;

export const getWorkspaceShellNavItemActive = (
  page: EnterpriseLeadWorkspaceInternalPageType,
  activePage: EnterpriseLeadWorkspaceInternalPageType,
  activeChatSessionId: string | null,
): boolean => {
  if (page === EnterpriseLeadWorkspaceInternalPage.AiChat) {
    return activePage === page && !activeChatSessionId;
  }

  return activePage === page;
};

const navIconById: Record<EnterpriseLeadWorkbenchNavIconType, React.ComponentType<{ className?: string }>> = {
  dashboard: RectangleGroupIcon,
  chat: ChatBubbleLeftRightIcon,
  search: MagnifyingGlassIcon,
  knowledge: BookOpenIcon,
  records: ClockIcon,
  agents: UserGroupIcon,
  settings: Cog6ToothIcon,
};

const formatChatSessionAge = (updatedAt: string): string => {
  const timestamp = Date.parse(updatedAt);
  if (Number.isNaN(timestamp)) {
    return '';
  }

  const elapsedMs = Date.now() - timestamp;
  if (elapsedMs < 86_400_000) {
    return i18nService.t('enterpriseLeadWorkspaceSidebarToday');
  }

  const dayCount = Math.max(1, Math.floor(elapsedMs / 86_400_000));
  return i18nService
    .t('enterpriseLeadWorkspaceSidebarDaysAgo')
    .replace('{count}', String(dayCount));
};

const formatWorkspaceShellMessage = (key: string, values: Record<string, string>): string =>
  Object.entries(values).reduce(
    (message, [name, value]) => message.replace(`{${name}}`, value),
    i18nService.t(key),
  );

export const WorkspaceShell: React.FC<WorkspaceShellProps> = ({
  activePage,
  onPageChange,
  onExitWorkspace,
  chatSessions = [],
  activeChatSessionId = null,
  onChatSessionSelect,
  onChatSessionDelete,
  onSearchOpen,
  children,
}) => {
  const sidebarMode = getDefaultWorkbenchSidebarMode();
  const sidebarWidth = getWorkbenchSidebarWidth(sidebarMode);
  const pages = getWorkspaceInternalPages();
  const [pendingDeleteSession, setPendingDeleteSession] =
    useState<WorkspaceConversationRecord | null>(null);
  const [isDeletingSessionId, setIsDeletingSessionId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const isDeletingSession = Boolean(isDeletingSessionId);

  const cancelDeleteSession = useCallback((): void => {
    if (isDeletingSession) {
      return;
    }
    setPendingDeleteSession(null);
    setDeleteError('');
  }, [isDeletingSession]);

  const confirmDeleteSession = useCallback((): void => {
    if (!pendingDeleteSession || !onChatSessionDelete || isDeletingSession) {
      return;
    }

    setIsDeletingSessionId(pendingDeleteSession.id);
    setDeleteError('');
    void onChatSessionDelete(pendingDeleteSession.id)
      .then(deleted => {
        if (!deleted) {
          setDeleteError(i18nService.t('enterpriseLeadWorkspaceDeleteConversationFailed'));
          return;
        }
        setPendingDeleteSession(null);
      })
      .catch(() => {
        setDeleteError(i18nService.t('enterpriseLeadWorkspaceDeleteConversationFailed'));
      })
      .finally(() => {
        setIsDeletingSessionId(null);
      });
  }, [isDeletingSession, onChatSessionDelete, pendingDeleteSession]);

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-background">
      <aside
        className="flex h-full shrink-0 flex-col border-r border-border/80 bg-[linear-gradient(180deg,var(--lobster-surface)_0%,color-mix(in_srgb,var(--lobster-surface)_86%,var(--lobster-background))_52%,var(--lobster-background)_100%)] px-3 py-3.5"
        style={{ width: sidebarWidth }}
        data-workspace-shell-sidebar-mode={sidebarMode}
      >
        <nav
          className="flex shrink-0 flex-col gap-[3px]"
          aria-label={i18nService.t('enterpriseLeadNavLabel')}
        >
          {pages.map(page => {
            const Icon = navIconById[page.icon];
            const isActive = getWorkspaceShellNavItemActive(
              page.id,
              activePage,
              activeChatSessionId,
            );
            const navAction = getWorkspaceShellNavAction(page.id);

            return (
              <button
                key={page.id}
                type="button"
                onClick={() => {
                  if (navAction === WorkspaceShellNavAction.OpenSearch) {
                    onSearchOpen?.();
                    return;
                  }
                  onPageChange(page.id);
                }}
                data-workspace-nav-action={navAction}
                className={`group relative grid h-9 w-full grid-cols-[26px_minmax(0,1fr)] items-center gap-2 rounded-[7px] px-2 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 ${
                  isActive
                    ? 'bg-primary/10 text-foreground ring-1 ring-primary/15 before:absolute before:left-1 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-primary'
                    : 'text-secondary hover:bg-surface-raised hover:text-foreground'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <span
                  className={`grid h-[26px] w-[26px] place-items-center rounded-md ${
                    isActive ? 'text-primary' : 'text-tertiary group-hover:text-secondary'
                  }`}
                >
                  <Icon className="h-[17px] w-[17px]" />
                </span>
                <span className="min-w-0 truncate">{i18nService.t(page.labelKey)}</span>
              </button>
            );
          })}
        </nav>
        <section className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden pt-0.5">
          <p className="pb-2 pl-1 pr-0.5 text-xs font-semibold text-secondary">
            {i18nService.t('enterpriseLeadWorkspaceSidebarConversations')}
          </p>
          {chatSessions.length > 0 ? (
            <div className="workspace-shell-scroll grid min-h-0 flex-1 content-start gap-[3px] overflow-y-auto pr-1">
              {chatSessions.map(session => {
                const isActive = session.id === activeChatSessionId;
                const sessionAge = formatChatSessionAge(session.updatedAt);
                const sessionTitle =
                  session.title || i18nService.t('enterpriseLeadWorkspaceConversationUntitled');
                const deleteLabel = formatWorkspaceShellMessage(
                  'enterpriseLeadWorkspaceDeleteConversationAria',
                  { title: sessionTitle },
                );

                return (
                  <div
                    key={session.id}
                    className={`group relative flex min-h-10 w-full items-center rounded-[9px] transition-colors ${
                      isActive
                        ? 'bg-primary/10 text-foreground ring-1 ring-primary/15 before:absolute before:left-1 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-primary'
                        : 'text-secondary hover:bg-surface-raised/80 hover:text-foreground'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onChatSessionSelect?.(session.id)}
                      className={`grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[9px] py-1.5 pl-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 ${
                        onChatSessionDelete ? 'pr-9' : 'pr-2.5'
                      }`}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <span className="min-w-0 truncate text-[13px] font-medium leading-5">
                        {sessionTitle}
                      </span>
                      {sessionAge ? (
                        <span className="shrink-0 rounded-full bg-background/70 px-1.5 text-[11px] font-medium leading-5 text-tertiary transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                          {sessionAge}
                        </span>
                      ) : null}
                    </button>
                    {onChatSessionDelete && (
                      <button
                        type="button"
                        data-testid="enterprise-lead-chat-session-delete"
                        onClick={() => {
                          setPendingDeleteSession(session);
                          setDeleteError('');
                        }}
                        className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-tertiary opacity-0 transition-colors hover:bg-red-500/10 hover:text-red-600 focus-visible:bg-red-500/10 focus-visible:text-red-600 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/20 group-hover:opacity-100 dark:hover:text-red-300 dark:focus-visible:text-red-300"
                        aria-label={deleteLabel}
                    title={i18nService.t('enterpriseLeadWorkspaceDeleteConversation')}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>
        {onExitWorkspace && (
          <div className="shrink-0 border-t border-border/70 pt-3">
            <button
              type="button"
              onClick={onExitWorkspace}
              className="grid h-9 w-full grid-cols-[26px_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 text-left text-[13px] font-medium text-secondary transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              aria-label={i18nService.t('enterpriseLeadWorkspaceExitToList')}
            >
              <span className="grid h-6 w-6 place-items-center rounded-md text-tertiary">
                <ArrowLeftIcon className="h-4 w-4" />
              </span>
              <span className="min-w-0 truncate">
                {i18nService.t('enterpriseLeadWorkspaceExitToList')}
              </span>
            </button>
          </div>
        )}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      {pendingDeleteSession && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 px-4"
          onClick={cancelDeleteSession}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={CHAT_SESSION_DELETE_TITLE_ID}
            aria-describedby={CHAT_SESSION_DELETE_DESCRIPTION_ID}
            className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 text-left shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-600 dark:text-red-300">
                <ExclamationTriangleIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3
                  id={CHAT_SESSION_DELETE_TITLE_ID}
                  className="text-base font-semibold text-foreground"
                >
                  {formatWorkspaceShellMessage('enterpriseLeadWorkspaceDeleteConversationTitle', {
                    title:
                      pendingDeleteSession.title ||
                      i18nService.t('enterpriseLeadWorkspaceConversationUntitled'),
                  })}
                </h3>
                <p
                  id={CHAT_SESSION_DELETE_DESCRIPTION_ID}
                  className="mt-2 text-sm leading-6 text-secondary"
                >
                  {i18nService.t('enterpriseLeadWorkspaceDeleteConversationWarning')}
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
                onClick={cancelDeleteSession}
                disabled={isDeletingSession}
                autoFocus
                className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {i18nService.t('enterpriseLeadHistoryCancelDelete')}
              </button>
              <button
                type="button"
                onClick={confirmDeleteSession}
                disabled={isDeletingSession}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-red-600 px-3 text-sm font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeletingSession
                  ? i18nService.t('enterpriseLeadHistoryDeleting')
                  : i18nService.t('enterpriseLeadWorkspaceDeleteConversation')}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default WorkspaceShell;
