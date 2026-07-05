import {
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { EnterpriseLeadAgentRole } from '@shared/enterpriseLeadWorkspace/constants';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
  EnterpriseLeadWorkspaceChatMessage,
  EnterpriseLeadWorkspaceChatResearchResult,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import {
  getAgentRoleLabel,
  getWorkspaceAgentDisplayName,
} from './enterpriseLeadWorkspaceUi';
import { isWorkspaceSettingReady } from './workspaceSettingsReadiness';

interface WorkspaceAiChatProps {
  workspace: EnterpriseLeadWorkspace;
}

interface AgentChoice {
  id: string;
  label: string;
  enabled: boolean;
  order: number;
}

interface WorkspaceAiChatRequestToken {
  requestId: number;
  workspaceId: string;
}

export const isWorkspaceAiChatRequestCurrent = (
  token: WorkspaceAiChatRequestToken,
  current: WorkspaceAiChatRequestToken,
): boolean => token.workspaceId === current.workspaceId && token.requestId === current.requestId;

const createLocalChatMessage = (
  content: string,
  createdAt: string,
): EnterpriseLeadWorkspaceChatMessage => ({
  id: `local-${createdAt}-${Math.random().toString(36).slice(2)}`,
  role: 'user',
  content,
  createdAt,
});

const getSortedAgentChoices = (
  bindings: EnterpriseLeadWorkspaceAgentBinding[],
): AgentChoice[] => {
  return bindings
    .filter(binding => binding.enabled)
    .map(binding => ({
      id: binding.agentId,
      label: getWorkspaceAgentDisplayName(binding),
      enabled: binding.enabled,
      order: binding.order,
    }))
    .sort((first, second) => {
      if (first.enabled !== second.enabled) {
        return first.enabled ? -1 : 1;
      }

      if (first.order !== second.order) {
        return first.order - second.order;
      }

      return first.label.localeCompare(second.label);
    });
};

const isEnterpriseLeadAgentRole = (role: string): role is EnterpriseLeadAgentRole =>
  Object.values(EnterpriseLeadAgentRole).includes(role as EnterpriseLeadAgentRole);

const buildDefaultWorkspaceAgentBindings = (
  roles: EnterpriseLeadWorkspace['enabledAgentRoles'],
): EnterpriseLeadWorkspaceAgentBinding[] => roles
  .filter(isEnterpriseLeadAgentRole)
  .map((role, order) => {
    const metadata = getAgentRoleLabel(role);

    return {
      agentId: role,
      enabled: true,
      order,
      overrides: {
        name: i18nService.t(metadata.titleKey),
        description: i18nService.t(metadata.descriptionKey),
        icon: i18nService.t(metadata.shortLabelKey),
      },
    };
  });

const getResearchStatusLabelKey = (
  status: EnterpriseLeadWorkspaceChatResearchResult['status'],
): string => {
  if (status === 'completed') {
    return 'enterpriseLeadAiChatResearchCompleted';
  }

  if (status === 'failed') {
    return 'enterpriseLeadAiChatResearchFailed';
  }

  return 'enterpriseLeadAiChatResearchSkipped';
};

const getResearchStatusClassName = (
  status: EnterpriseLeadWorkspaceChatResearchResult['status'],
): string => {
  if (status === 'completed') {
    return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  }

  if (status === 'failed') {
    return 'bg-red-500/10 text-red-700 dark:text-red-300';
  }

  return 'bg-slate-500/10 text-slate-600 dark:text-slate-300';
};

const ResearchStatusChip: React.FC<{
  research: EnterpriseLeadWorkspaceChatResearchResult;
}> = ({ research }) => (
  <div className="mt-2 flex flex-wrap items-center gap-2">
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${getResearchStatusClassName(research.status)}`}>
      {i18nService.t(getResearchStatusLabelKey(research.status))}
    </span>
    {research.provider ? (
      <span className="rounded-md bg-surface-raised px-2 py-0.5 text-xs text-tertiary">
        {research.provider}
      </span>
    ) : null}
    {research.summary ? (
      <span className="min-w-0 text-xs leading-5 text-secondary">
        {research.summary}
      </span>
    ) : null}
  </div>
);

const MessageRow: React.FC<{
  message: EnterpriseLeadWorkspaceChatMessage;
}> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <article className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[78%] rounded-lg border px-3 py-2 ${
        isUser
          ? 'border-primary/20 bg-primary/10'
          : 'border-border bg-surface'
      }`}
      >
        <p className="text-[11px] font-medium uppercase text-tertiary">
          {i18nService.t(
            isUser
              ? 'enterpriseLeadAiChatUserRole'
              : 'enterpriseLeadAiChatAssistantRole',
          )}
        </p>
        <p className="mt-1 break-words whitespace-pre-wrap text-sm leading-6 text-foreground">
          {message.content}
        </p>
        {!isUser && message.research ? (
          <ResearchStatusChip research={message.research} />
        ) : null}
      </div>
    </article>
  );
};

const WorkspaceCapabilityStrip: React.FC<{
  agentCount: number;
  researchEnabled: boolean;
}> = ({ agentCount, researchEnabled }) => (
  <div className="border-t border-border bg-surface-raised/70 px-4 py-2 text-xs text-secondary">
    <span className="font-medium text-foreground">
      {i18nService.t('enterpriseLeadAiChatCapabilityLabel')}
    </span>
    <span className="ml-2">
      {i18nService.t('enterpriseLeadAiChatCapabilityAgents').replace('{count}', String(agentCount))}
    </span>
    <span className="mx-2 text-tertiary">·</span>
    <span>
      {i18nService.t(
        researchEnabled
          ? 'enterpriseLeadAiChatCapabilityResearchEnabled'
          : 'enterpriseLeadAiChatCapabilityResearchDisabled',
      )}
    </span>
    <span className="mx-2 text-tertiary">·</span>
    <span>{i18nService.t('enterpriseLeadAiChatCapabilityKnowledge')}</span>
  </div>
);

export const WorkspaceAiChat: React.FC<WorkspaceAiChatProps> = ({ workspace }) => {
  const [messages, setMessages] = useState<EnterpriseLeadWorkspaceChatMessage[]>([]);
  const [draftMessage, setDraftMessage] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const requestTokenRef = useRef<WorkspaceAiChatRequestToken>({
    requestId: 0,
    workspaceId: workspace.id,
  });

  const workspaceAgentBindings = useMemo(
    () => workspace.workspaceAgents.length > 0
      ? workspace.workspaceAgents
      : buildDefaultWorkspaceAgentBindings(workspace.enabledAgentRoles),
    [workspace.enabledAgentRoles, workspace.workspaceAgents],
  );
  const agentChoices = useMemo(
    () => getSortedAgentChoices(workspaceAgentBindings),
    [workspaceAgentBindings],
  );
  const isResearchEnabled = useMemo(
    () => isWorkspaceSettingReady(workspace.settings, 'research'),
    [workspace.settings],
  );

  useEffect(() => {
    requestTokenRef.current = {
      requestId: requestTokenRef.current.requestId + 1,
      workspaceId: workspace.id,
    };
    setMessages([]);
    setDraftMessage('');
    setError('');
    setSelectedAgentId('');
    setIsSending(false);
  }, [workspace.id]);

  useEffect(() => {
    if (selectedAgentId && !agentChoices.some(choice => choice.id === selectedAgentId)) {
      setSelectedAgentId('');
    }
  }, [agentChoices, selectedAgentId]);

  const trimmedMessage = draftMessage.trim();
  const canSend = Boolean(trimmedMessage) && !isSending;

  const handleSend = async (): Promise<void> => {
    const messageToSend = draftMessage.trim();

    if (!messageToSend || isSending) {
      return;
    }

    const recentMessages = messages.slice(-8);
    const userMessage = createLocalChatMessage(messageToSend, new Date().toISOString());
    const requestToken = {
      requestId: requestTokenRef.current.requestId + 1,
      workspaceId: workspace.id,
    };
    requestTokenRef.current = requestToken;
    const isCurrentRequest = (): boolean =>
      isWorkspaceAiChatRequestCurrent(requestToken, requestTokenRef.current);

    setMessages(previous => [...previous, userMessage]);
    setDraftMessage('');
    setError('');
    setIsSending(true);

    try {
      const response = await enterpriseLeadWorkspaceService.chat(workspace.id, {
        message: messageToSend,
        targetAgentId: selectedAgentId || undefined,
        recentMessages,
      });

      if (!isCurrentRequest()) {
        return;
      }

      if (response?.message) {
        setMessages(previous => [...previous, response.message]);
        return;
      }

      setError(i18nService.t('enterpriseLeadAiChatFailed'));
    } catch {
      if (isCurrentRequest()) {
        setError(i18nService.t('enterpriseLeadAiChatFailed'));
      }
    } finally {
      if (isCurrentRequest()) {
        setIsSending(false);
      }
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void handleSend();
  };

  const renderComposer = (compact = false) => (
    <form
      onSubmit={handleSubmit}
      className={`overflow-hidden rounded-xl border border-border bg-background shadow-sm ${
        compact ? '' : 'shadow-2xl shadow-slate-950/5'
      }`}
    >
      <textarea
        value={draftMessage}
        onChange={event => setDraftMessage(event.target.value)}
        aria-label={i18nService.t('enterpriseLeadAiChatInputLabel')}
        placeholder={i18nService.t('enterpriseLeadAiChatPlaceholder')}
        rows={compact ? 2 : 4}
        className={`w-full resize-none border-0 bg-background px-4 py-3 text-sm leading-6 text-foreground outline-none placeholder:text-tertiary ${
          compact ? 'min-h-[76px]' : 'min-h-[124px]'
        }`}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-background px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-secondary hover:bg-surface-raised hover:text-foreground"
            aria-label={i18nService.t('enterpriseLeadAiChatAddContext')}
          >
            <PlusIcon className="h-4 w-4" />
          </button>
          <label className="inline-flex min-w-[160px] items-center rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
            <select
              value={selectedAgentId}
              onChange={event => setSelectedAgentId(event.target.value)}
              className="min-w-0 bg-transparent text-xs font-medium text-primary outline-none"
            >
              <option value="">
                {i18nService.t('enterpriseLeadAiChatAgentAll')}
              </option>
              {agentChoices.map(choice => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <span className={`rounded-full px-3 py-1.5 text-xs font-medium ${
            isResearchEnabled
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'bg-slate-500/10 text-secondary'
          }`}
          >
            {i18nService.t(
              isResearchEnabled
                ? 'enterpriseLeadAiChatCapabilityResearchEnabled'
                : 'enterpriseLeadAiChatCapabilityResearchDisabled',
            )}
          </span>
          <span className="rounded-full bg-surface-raised px-3 py-1.5 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadAiChatCapabilityKnowledge')}
          </span>
        </div>

        <button
          type="submit"
          disabled={!canSend}
          aria-label={i18nService.t(
            isSending
              ? 'enterpriseLeadAiChatSending'
              : 'enterpriseLeadAiChatSend',
          )}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PaperAirplaneIcon className="h-4 w-4" />
        </button>
      </div>

      <WorkspaceCapabilityStrip
        agentCount={agentChoices.length}
        researchEnabled={isResearchEnabled}
      />
    </form>
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {messages.length > 0 || error ? (
        <div className="shrink-0 px-6 pt-4">
        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {messages.length > 0 ? (
          <div className="mx-auto max-w-4xl space-y-4">
            {messages.map(message => (
              <MessageRow key={message.id} message={message} />
            ))}
          </div>
        ) : (
          <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col items-center justify-center px-4 py-10 text-center">
            <p className="text-xs font-semibold text-secondary">
              {i18nService.t('enterpriseLeadAiChatTitle')}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-normal text-foreground">
              {i18nService.t('enterpriseLeadAiChatEmptyTitle')}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-secondary">
              {i18nService.t('enterpriseLeadAiChatSubtitle')}
            </p>
            <div className="mt-6 w-full max-w-4xl text-left">
              {renderComposer(false)}
            </div>
          </div>
        )}
      </div>

      {messages.length > 0 ? (
        <div className="shrink-0 border-t border-border bg-surface px-6 py-4">
          <div className="mx-auto max-w-4xl">
            {renderComposer(true)}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default WorkspaceAiChat;
