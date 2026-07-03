import { ChatBubbleLeftRightIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import { selectCurrentSession, selectCurrentSessionId } from '../../store/selectors/coworkSelectors';
import type { CoworkSessionSummary } from '../../types/cowork';
import { getAgentDisplayNameById, isDefaultAgentId } from '../../utils/agentDisplay';
import AgentAvatarIcon from '../agent/AgentAvatarIcon';
import { CoworkUiEvent } from '../cowork/constants';
import { formatAgentTaskRelativeTime } from './time';
import { sortRecentConversationSessions } from './useAgentSidebarState';

interface RecentConversationsSectionProps {
  onSelectConversation: (session: CoworkSessionSummary) => void;
}

const RECENT_CONVERSATION_LIMIT = 6;

const normalizeAgentId = (agentId?: string | null): string => agentId?.trim() || 'main';

const RecentConversationsSection: React.FC<RecentConversationsSectionProps> = ({
  onSelectConversation,
}) => {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const currentSession = useSelector(selectCurrentSession);
  const sessions = useSelector((state: RootState) => state.cowork.sessions);
  const [recentSessions, setRecentSessions] = useState<CoworkSessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadError, setHasLoadError] = useState(false);

  const recentRefreshKey = useMemo(() => {
    const currentSessionKey = currentSession
      ? `${currentSession.id}:${currentSession.updatedAt}:${currentSession.status}`
      : '';
    const sessionListKey = sessions
      .slice(0, RECENT_CONVERSATION_LIMIT)
      .map((session) => `${session.id}:${session.updatedAt}:${session.status}`)
      .join('|');
    return `${currentSessionKey}#${sessionListKey}`;
  }, [currentSession, sessions]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setHasLoadError(false);

    void coworkService.listRecentSessions(RECENT_CONVERSATION_LIMIT)
      .then((result) => {
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

  const renderAgentBadge = (session: CoworkSessionSummary) => {
    const agentId = normalizeAgentId(session.agentId);
    if (isDefaultAgentId(agentId)) return null;

    const agent = agents.find((item) => item.id === agentId);
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
          {recentSessions.map((session) => {
            const relativeTime = formatAgentTaskRelativeTime(session.updatedAt || session.createdAt);
            const isActive = session.id === currentSessionId;
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelectConversation(session)}
                className={`-ml-[6px] flex min-h-9 w-[calc(100%+12px)] min-w-0 items-center gap-2 rounded-md py-1 pl-3 pr-2.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04] ${
                  isActive ? 'bg-black/[0.035] dark:bg-white/[0.055]' : ''
                }`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-foreground opacity-[0.46]">
                  <ChatBubbleLeftRightIcon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-foreground opacity-[0.76]">
                    {session.title}
                  </span>
                  {renderAgentBadge(session)}
                </span>
                <span
                  className="shrink-0 text-[11px] text-secondary/70"
                  title={relativeTime.full}
                >
                  {relativeTime.compact}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="-ml-[6px] flex h-8 w-[calc(100%+12px)] items-center pl-3 pr-2.5 text-[13px] text-foreground opacity-[0.28]">
          {isLoading ? i18nService.t('loading') : (
            hasLoadError
              ? i18nService.t('myAgentSidebarLoadFailed')
              : i18nService.t('myAgentSidebarNoRecentConversations')
          )}
        </div>
      )}
    </section>
  );
};

export default RecentConversationsSection;
