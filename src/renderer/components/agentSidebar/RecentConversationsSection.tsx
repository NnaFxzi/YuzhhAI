import {
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import {
  selectCurrentSession,
  selectCurrentSessionId,
} from '../../store/selectors/coworkSelectors';
import { CoworkSessionStatusValue, type CoworkSessionSummary } from '../../types/cowork';
import { getAgentDisplayNameById, isDefaultAgentId } from '../../utils/agentDisplay';
import AgentAvatarIcon from '../agent/AgentAvatarIcon';
import Modal from '../common/Modal';
import { CoworkUiEvent } from '../cowork/constants';
import TrashIcon from '../icons/TrashIcon';
import { formatAgentTaskRelativeTime } from './time';
import {
  removeRecentConversationSessions,
  sortRecentConversationSessions,
} from './useAgentSidebarState';

interface RecentConversationsSectionProps {
  onSelectConversation: (session: CoworkSessionSummary) => void;
  onDeleteConversation: (session: CoworkSessionSummary) => Promise<boolean>;
  deletedSessionIds?: string[];
}

const RECENT_CONVERSATION_LIMIT = 6;

const normalizeAgentId = (agentId?: string | null): string => agentId?.trim() || 'main';

interface RecentConversationRowProps {
  session: CoworkSessionSummary;
  isActive: boolean;
  agentBadge: React.ReactNode;
  onSelect: (session: CoworkSessionSummary) => void;
  onRequestDelete: (session: CoworkSessionSummary) => void;
}

export const RecentConversationRow: React.FC<RecentConversationRowProps> = ({
  session,
  isActive,
  agentBadge,
  onSelect,
  onRequestDelete,
}) => {
  const relativeTime = formatAgentTaskRelativeTime(session.updatedAt || session.createdAt);
  const isInConversation = session.status === CoworkSessionStatusValue.Running;
  const showMetadata = Boolean(agentBadge) || isInConversation;
  const statusLabel = i18nService.t('myAgentSidebarInConversation');

  return (
    <div
      className={`group relative -ml-[6px] flex min-h-9 w-[calc(100%+12px)] min-w-0 items-center rounded-md transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04] ${
        isActive ? 'bg-black/[0.035] dark:bg-white/[0.055]' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(session)}
        className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md py-1 pl-3 pr-8 text-left"
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-foreground opacity-[0.46]">
          <ChatBubbleLeftRightIcon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-foreground opacity-[0.76]">
            {session.title}
          </span>
          {showMetadata && (
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
              {agentBadge}
              {isInConversation && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
                  title={statusLabel}
                  aria-label={statusLabel}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                  <span>{statusLabel}</span>
                </span>
              )}
            </span>
          )}
        </span>
        <span
          className="shrink-0 text-[11px] text-secondary/70 transition-opacity group-hover:opacity-0"
          title={relativeTime.full}
        >
          {relativeTime.compact}
        </span>
      </button>
      <button
        type="button"
        onClick={event => {
          event.stopPropagation();
          onRequestDelete(session);
        }}
        className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-foreground opacity-0 transition-opacity hover:opacity-[0.46] group-hover:opacity-[0.3]"
        aria-label={i18nService.t('deleteSession')}
        title={i18nService.t('deleteSession')}
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

const RecentConversationsSection: React.FC<RecentConversationsSectionProps> = ({
  onSelectConversation,
  onDeleteConversation,
  deletedSessionIds = [],
}) => {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const currentSession = useSelector(selectCurrentSession);
  const sessions = useSelector((state: RootState) => state.cowork.sessions);
  const [recentSessions, setRecentSessions] = useState<CoworkSessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadError, setHasLoadError] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [pendingDeleteSession, setPendingDeleteSession] = useState<CoworkSessionSummary | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const recentRefreshKey = useMemo(() => {
    const currentSessionKey = currentSession
      ? `${currentSession.id}:${currentSession.updatedAt}:${currentSession.status}`
      : '';
    const sessionListKey = sessions
      .slice(0, RECENT_CONVERSATION_LIMIT)
      .map(session => `${session.id}:${session.updatedAt}:${session.status}`)
      .join('|');
    return `${currentSessionKey}#${sessionListKey}#${refreshVersion}`;
  }, [currentSession, refreshVersion, sessions]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setHasLoadError(false);

    void coworkService
      .listRecentSessions(RECENT_CONVERSATION_LIMIT)
      .then(result => {
        if (cancelled) return;
        if (!result.success) {
          setHasLoadError(true);
          setRecentSessions([]);
          return;
        }
        setRecentSessions(sortRecentConversationSessions(result.sessions ?? []));
      })
      .catch(() => {
        if (!cancelled) {
          setHasLoadError(true);
          setRecentSessions([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [recentRefreshKey]);

  useEffect(() => {
    if (deletedSessionIds.length === 0) return;
    setRecentSessions(previous => removeRecentConversationSessions(previous, deletedSessionIds));
  }, [deletedSessionIds]);

  const handleConfirmDelete = async () => {
    if (!pendingDeleteSession || isDeleting) return;

    setIsDeleting(true);
    const sessionId = pendingDeleteSession.id;
    let deleted = false;
    try {
      deleted = await onDeleteConversation(pendingDeleteSession);
    } catch {
      deleted = false;
    } finally {
      setIsDeleting(false);
    }

    if (!deleted) {
      window.dispatchEvent(
        new CustomEvent('app:showToast', {
          detail: i18nService.t('deleteSessionFailed'),
        }),
      );
      return;
    }

    setPendingDeleteSession(null);
    setRecentSessions(previous => removeRecentConversationSessions(previous, [sessionId]));
    setRefreshVersion(previous => previous + 1);
  };

  const renderAgentBadge = (session: CoworkSessionSummary) => {
    const agentId = normalizeAgentId(session.agentId);
    if (isDefaultAgentId(agentId)) return null;

    const agent = agents.find(item => item.id === agentId);
    const label = getAgentDisplayNameById(agentId, agents) ?? agentId;
    return (
      <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-secondary/80">
        <AgentAvatarIcon
          value={agent?.icon ?? ''}
          className="h-3.5 w-3.5"
          iconClassName="h-3.5 w-3.5"
          legacyClassName="text-[11px]"
          fallbackText={label.trim().slice(0, 1).toUpperCase() || 'A'}
        />
        <span className="min-w-0 truncate">{label}</span>
      </span>
    );
  };

  return (
    <section className="pb-3" aria-label={i18nService.t('myAgentSidebarRecentConversations')}>
      <div className="sticky top-0 z-30 -ml-[6px] flex h-10 w-[calc(100%+12px)] items-center justify-between bg-surface-raised pl-3 pr-1">
        <h2 className="min-w-0 truncate text-[14px] font-normal text-foreground opacity-[0.28]">
          {i18nService.t('myAgentSidebarRecentConversations')}
        </h2>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent(CoworkUiEvent.ShortcutSearch))}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-foreground opacity-[0.34] transition-opacity hover:opacity-[0.5]"
          aria-label={i18nService.t('myAgentSidebarSearchRecentConversations')}
        >
          <MagnifyingGlassIcon className="h-4 w-4" />
        </button>
      </div>

      {recentSessions.length > 0 ? (
        <div className="space-y-0.5">
          {recentSessions.map(session => {
            return (
              <RecentConversationRow
                key={session.id}
                session={session}
                isActive={session.id === currentSessionId}
                agentBadge={renderAgentBadge(session)}
                onSelect={onSelectConversation}
                onRequestDelete={setPendingDeleteSession}
              />
            );
          })}
        </div>
      ) : (
        <div className="-ml-[6px] flex h-8 w-[calc(100%+12px)] items-center pl-3 pr-2.5 text-[13px] text-foreground opacity-[0.28]">
          {isLoading
            ? i18nService.t('loading')
            : hasLoadError
              ? i18nService.t('myAgentSidebarLoadFailed')
              : i18nService.t('myAgentSidebarNoRecentConversations')}
        </div>
      )}

      {pendingDeleteSession && (
        <Modal
          onClose={() => {
            if (!isDeleting) {
              setPendingDeleteSession(null);
            }
          }}
          className="w-full max-w-sm mx-4 bg-surface rounded-2xl shadow-xl overflow-hidden"
        >
          <div className="flex items-center gap-3 px-5 py-4">
            <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
              <ExclamationTriangleIcon className="h-5 w-5 text-red-600 dark:text-red-500" />
            </div>
            <h2 className="text-base font-semibold text-foreground">
              {i18nService.t('deleteTaskConfirmTitle')}
            </h2>
          </div>
          <div className="px-5 pb-4">
            <p className="text-sm text-secondary">{i18nService.t('deleteTaskConfirmMessage')}</p>
          </div>
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border">
            <button
              type="button"
              onClick={() => setPendingDeleteSession(null)}
              disabled={isDeleting}
              className="px-4 py-2 text-sm font-medium rounded-lg text-secondary hover:bg-surface-raised transition-colors disabled:opacity-50"
            >
              {i18nService.t('cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmDelete()}
              disabled={isDeleting}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-red-500 text-white transition-colors hover:bg-red-600 disabled:opacity-60"
            >
              {i18nService.t('deleteSession')}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
};

export default RecentConversationsSection;
