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

import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceChatSessionSummary,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { i18nService } from '../../services/i18n';
import {
  type EnterpriseLeadWorkbenchNavIcon as EnterpriseLeadWorkbenchNavIconType,
  type EnterpriseLeadWorkspaceInternalPage as EnterpriseLeadWorkspaceInternalPageType,
  getDefaultWorkbenchSidebarMode,
  getWorkbenchSidebarWidth,
  getWorkspaceInternalPages,
} from './enterpriseLeadWorkspaceUi';

interface WorkspaceShellProps {
  workspace: EnterpriseLeadWorkspace;
  activePage: EnterpriseLeadWorkspaceInternalPageType;
  onPageChange: (page: EnterpriseLeadWorkspaceInternalPageType) => void;
  onExitWorkspace?: () => void;
  chatSessions?: EnterpriseLeadWorkspaceChatSessionSummary[];
  activeChatSessionId?: string | null;
  onChatSessionSelect?: (sessionId: string) => void;
  onChatSessionDelete?: (sessionId: string) => Promise<boolean>;
  children: React.ReactNode;
}

const CHAT_SESSION_DELETE_TITLE_ID = 'enterprise-lead-chat-session-delete-title';
const CHAT_SESSION_DELETE_DESCRIPTION_ID = 'enterprise-lead-chat-session-delete-desc';

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
  children,
}) => {
  const sidebarMode = getDefaultWorkbenchSidebarMode();
  const sidebarWidth = getWorkbenchSidebarWidth(sidebarMode);
  const pages = getWorkspaceInternalPages();
  const [pendingDeleteSession, setPendingDeleteSession] =
    useState<EnterpriseLeadWorkspaceChatSessionSummary | null>(null);
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
        className="flex h-full shrink-0 flex-col border-r border-border bg-surface px-3 py-5"
        style={{ width: sidebarWidth }}
        data-workspace-shell-sidebar-mode={sidebarMode}
      >
        <nav
          className="flex shrink-0 flex-col gap-1 pb-4"
          aria-label={i18nService.t('enterpriseLeadNavLabel')}
        >
          {pages.map(page => {
            const Icon = navIconById[page.icon];
            const isActive = page.id === activePage;

            return (
              <button
                key={page.id}
                type="button"
                onClick={() => onPageChange(page.id)}
                className={`flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-surface-raised text-foreground shadow-sm'
                    : 'text-secondary hover:bg-surface-raised hover:text-foreground'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{i18nService.t(page.labelKey)}</span>
              </button>
            );
          })}
        </nav>
        <section className="min-h-0 flex-1 overflow-y-auto border-t border-border pt-4">
          <p className="px-2 text-xs font-semibold text-tertiary">
            {i18nService.t('enterpriseLeadWorkspaceSidebarConversations')}
          </p>
          {chatSessions.length > 0 ? (
            <div className="mt-3 space-y-1">
              {chatSessions.map(session => {
                const isActive = session.id === activeChatSessionId;
                const sessionAge = formatChatSessionAge(session.updatedAt);
                const sessionTitle =
                  session.title || i18nService.t('enterpriseLeadAiChatUntitledSession');
                const deleteLabel = formatWorkspaceShellMessage(
                  'enterpriseLeadWorkspaceDeleteConversationAria',
                  { title: sessionTitle },
                );

                return (
                  <div
                    key={session.id}
                    className={`group flex h-9 w-full items-center gap-1 rounded-md transition-colors ${
                      isActive
                        ? 'bg-surface-raised text-foreground shadow-sm'
                        : 'text-secondary hover:bg-surface-raised hover:text-foreground'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onChatSessionSelect?.(session.id)}
                      className="flex h-full min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <span className="min-w-0 truncate font-medium">{sessionTitle}</span>
                      {sessionAge ? (
                        <span className="shrink-0 text-xs text-tertiary">{sessionAge}</span>
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
                        className="mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-tertiary opacity-0 transition-colors hover:bg-red-500/10 hover:text-red-600 focus:bg-red-500/10 focus:text-red-600 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 group-hover:opacity-100 dark:hover:text-red-300 dark:focus:text-red-300"
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
          <div className="shrink-0 border-t border-border pt-3">
            <button
              type="button"
              onClick={onExitWorkspace}
              className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
              aria-label={i18nService.t('enterpriseLeadWorkspaceExitToList')}
            >
              <ArrowLeftIcon className="h-4 w-4 shrink-0" />
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
                      i18nService.t('enterpriseLeadAiChatUntitledSession'),
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
