import {
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { ArrowUpIcon } from '@heroicons/react/24/solid';
import { EnterpriseLeadAgentRole } from '@shared/enterpriseLeadWorkspace/constants';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
  EnterpriseLeadWorkspaceChatMessage,
  EnterpriseLeadWorkspaceChatResearchResult,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import { getAgentRoleLabel, getWorkspaceAgentDisplayName } from './enterpriseLeadWorkspaceUi';
import { isWorkspaceSettingReady } from './workspaceSettingsReadiness';

interface WorkspaceAiChatProps {
  workspace: EnterpriseLeadWorkspace;
  activeSessionId?: string | null;
  onSessionChange?: (sessionId: string | null) => void;
  onSessionsUpdated?: () => void;
}

export interface AgentChoice {
  id: string;
  label: string;
  enabled: boolean;
  order: number;
}

interface WorkspaceAiChatRequestToken {
  requestId: number;
  workspaceId: string;
  sessionId: string | null;
}

interface WorkspaceAiChatKeyEventLike {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
  nativeEvent?: {
    isComposing?: boolean;
  };
}

export const shouldSubmitWorkspaceChatKey = (event: WorkspaceAiChatKeyEventLike): boolean =>
  event.key === 'Enter' && !event.shiftKey && !event.isComposing && !event.nativeEvent?.isComposing;

export const getWorkspaceAiChatEntranceStyle = (delayMs: number): React.CSSProperties => ({
  animationDelay: `${delayMs}ms`,
  animationFillMode: 'both',
});

export const getWorkspaceAiChatMessageRowClassName = (isUser: boolean, animate = true): string =>
  [
    'flex',
    isUser ? 'justify-end' : 'justify-start',
    animate ? 'animate-message-in motion-reduce:animate-none' : '',
  ]
    .filter(Boolean)
    .join(' ');

const getPendingDotStyle = (index: number): React.CSSProperties => ({
  animationDelay: `${index * 120}ms`,
  animationFillMode: 'both',
});

const getWorkspaceAiChatPendingStepClassName = (isMuted = false): string =>
  [
    'flex',
    'min-h-7',
    'items-center',
    'gap-1.5',
    'rounded-lg',
    'px-2',
    'text-xs',
    'font-medium',
    'leading-4',
    isMuted ? 'bg-background/70 text-tertiary' : 'bg-primary/10 text-primary',
  ].join(' ');

const WORKSPACE_AI_CHAT_TYPEWRITER_INTERVAL_MS = 18;
const WORKSPACE_AI_CHAT_TYPEWRITER_STEP = 2;

const WORKSPACE_AI_CHAT_ADJUSTMENT_REASONS = [
  'enterpriseLeadAiChatAdjustReasonSpecific',
  'enterpriseLeadAiChatAdjustReasonResearch',
  'enterpriseLeadAiChatAdjustReasonKnowledge',
  'enterpriseLeadAiChatAdjustReasonFormat',
  'enterpriseLeadAiChatAdjustReasonTone',
  'enterpriseLeadAiChatAdjustReasonWrongAgent',
] as const;

export const getWorkspaceAiChatTypewriterText = (
  content: string,
  visibleCharacterCount: number,
): string => Array.from(content).slice(0, Math.max(0, visibleCharacterCount)).join('');

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const isWorkspaceAiChatRequestCurrent = (
  token: WorkspaceAiChatRequestToken,
  current: WorkspaceAiChatRequestToken,
): boolean =>
  token.workspaceId === current.workspaceId &&
  token.sessionId === current.sessionId &&
  token.requestId === current.requestId;

const createLocalChatMessage = (
  content: string,
  createdAt: string,
): EnterpriseLeadWorkspaceChatMessage => ({
  id: `local-${createdAt}-${Math.random().toString(36).slice(2)}`,
  role: 'user',
  content,
  createdAt,
});

export const buildWorkspaceAiChatRetryDraft = ({
  agentName,
  instruction,
}: {
  agentName: string;
  instruction: string;
}): string =>
  i18nService
    .t('enterpriseLeadAiChatAdjustRetryDraft')
    .replace('{agent}', agentName)
    .replace('{instruction}', instruction.trim());

export const getSortedAgentChoices = (
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
): EnterpriseLeadWorkspaceAgentBinding[] =>
  roles.filter(isEnterpriseLeadAgentRole).map((role, order) => {
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
    <span
      className={`rounded-md px-2 py-0.5 text-xs font-medium ${getResearchStatusClassName(research.status)}`}
    >
      {i18nService.t(getResearchStatusLabelKey(research.status))}
    </span>
    {research.provider ? (
      <span className="rounded-md bg-surface-raised px-2 py-0.5 text-xs text-tertiary">
        {research.provider}
      </span>
    ) : null}
    {research.summary ? (
      <span className="min-w-0 text-xs leading-5 text-secondary">{research.summary}</span>
    ) : null}
  </div>
);

interface TypewriterMessageTextProps {
  content: string;
  isActive?: boolean;
  visibleCharacterCount?: number;
  onComplete?: () => void;
}

export const TypewriterMessageText: React.FC<TypewriterMessageTextProps> = ({
  content,
  isActive = false,
  visibleCharacterCount,
  onComplete,
}) => {
  const characterCount = useMemo(() => Array.from(content).length, [content]);
  const isControlled = visibleCharacterCount !== undefined;
  const [visibleCount, setVisibleCount] = useState(() => (isActive ? 0 : characterCount));
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (isControlled) {
      return undefined;
    }

    if (!isActive) {
      setVisibleCount(characterCount);
      return undefined;
    }

    if (prefersReducedMotion() || characterCount === 0) {
      setVisibleCount(characterCount);
      onCompleteRef.current?.();
      return undefined;
    }

    setVisibleCount(0);
    let intervalId: number | undefined;
    intervalId = window.setInterval(() => {
      setVisibleCount(previous => {
        const next = Math.min(previous + WORKSPACE_AI_CHAT_TYPEWRITER_STEP, characterCount);

        if (next >= characterCount && intervalId !== undefined) {
          window.clearInterval(intervalId);
          onCompleteRef.current?.();
        }

        return next;
      });
    }, WORKSPACE_AI_CHAT_TYPEWRITER_INTERVAL_MS);

    return () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [characterCount, content, isActive, isControlled]);

  const effectiveVisibleCount = isControlled ? visibleCharacterCount : visibleCount;
  const visibleText = getWorkspaceAiChatTypewriterText(
    content,
    effectiveVisibleCount ?? characterCount,
  );
  const showCursor = isActive && (effectiveVisibleCount ?? 0) < characterCount;

  return (
    <p
      aria-live={isActive ? 'polite' : undefined}
      className="break-words whitespace-pre-wrap text-sm leading-6"
    >
      {visibleText}
      {showCursor ? (
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 rounded-full bg-current opacity-70 animate-pulse motion-reduce:hidden"
        />
      ) : null}
    </p>
  );
};

interface WorkspaceAiChatMessageRowProps {
  message: EnterpriseLeadWorkspaceChatMessage;
  animate?: boolean;
  typewriter?: boolean;
  onTypewriterComplete?: () => void;
  onAdjustAgent?: (message: EnterpriseLeadWorkspaceChatMessage) => void;
}

export const WorkspaceAiChatMessageRow: React.FC<WorkspaceAiChatMessageRowProps> = ({
  message,
  animate = true,
  typewriter = false,
  onTypewriterComplete,
  onAdjustAgent,
}) => {
  const isUser = message.role === 'user';
  const attributedAgents = message.routing?.agents.length
    ? message.routing.agents
    : message.agent
      ? [message.agent]
      : [];
  const attributedAgentLabel = attributedAgents.map(agent => agent.name).join(' + ');

  return (
    <article className={getWorkspaceAiChatMessageRowClassName(isUser, animate)}>
      <div
        className={`max-w-[78%] rounded-2xl px-3 py-2 ${
          isUser ? 'border border-primary/20 bg-primary/10 text-primary' : 'text-foreground'
        }`}
      >
        <TypewriterMessageText
          content={message.content}
          isActive={typewriter}
          onComplete={onTypewriterComplete}
        />
        {!isUser && message.research ? <ResearchStatusChip research={message.research} /> : null}
        {!isUser && attributedAgents.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs leading-5 text-secondary">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary">
              {i18nService
                .t('enterpriseLeadAiChatUsedAgent')
                .replace('{agent}', attributedAgentLabel)}
            </span>
            {message.routing?.reason ? (
              <span className="rounded-md bg-surface-raised px-2 py-0.5 text-secondary">
                {i18nService
                  .t('enterpriseLeadAiChatRouteReason')
                  .replace('{reason}', message.routing.reason)}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onAdjustAgent?.(message)}
              className="rounded-md px-2 py-0.5 font-medium text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              {i18nService.t('enterpriseLeadAiChatAdjustAgent')}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
};

export const WorkspaceAiChatAdjustmentDrawer: React.FC<{
  agentName: string;
  messageContent: string;
  onClose: () => void;
  onRetry: (draft: string) => void;
}> = ({ agentName, messageContent, onClose, onRetry }) => {
  const [instruction, setInstruction] = useState('');
  const [selectedReason, setSelectedReason] = useState('');
  const effectiveInstruction = instruction.trim() || selectedReason;
  const canRetry = effectiveInstruction.trim().length > 0;

  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-ai-chat-agent-adjust-title"
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-border bg-surface shadow-card"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2
            id="workspace-ai-chat-agent-adjust-title"
            className="text-base font-semibold text-foreground"
          >
            {i18nService.t('enterpriseLeadAiChatAdjustAgent')}
          </h2>
          <p className="mt-1 truncate text-xs text-secondary">{agentName}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={i18nService.t('close')}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <div>
          <p className="text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadAiChatAdjustQuestion')}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {WORKSPACE_AI_CHAT_ADJUSTMENT_REASONS.map(reasonKey => {
              const label = i18nService.t(reasonKey);
              const isSelected = selectedReason === label;
              return (
                <button
                  key={reasonKey}
                  type="button"
                  onClick={() => setSelectedReason(isSelected ? '' : label)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    isSelected
                      ? 'border-primary/30 bg-primary/10 text-primary'
                      : 'border-border text-secondary hover:bg-surface-raised hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label
            htmlFor="workspace-ai-chat-agent-adjust-instruction"
            className="text-xs font-medium text-secondary"
          >
            {i18nService.t('enterpriseLeadAiChatAdjustInstructionLabel')}
          </label>
          <textarea
            id="workspace-ai-chat-agent-adjust-instruction"
            value={instruction}
            onChange={event => setInstruction(event.target.value)}
            placeholder={i18nService.t('enterpriseLeadAiChatAdjustInstructionPlaceholder')}
            className="mt-2 min-h-[112px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none placeholder:text-secondary/60 focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="rounded-lg border border-border bg-background px-3 py-2">
          <p className="text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadAiChatAdjustApplyTo')}
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {i18nService.t('enterpriseLeadAiChatAdjustRetryOnly')}
          </p>
          <p className="mt-2 line-clamp-3 text-xs leading-5 text-secondary">{messageContent}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded-lg px-3 text-sm font-medium text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
        >
          {i18nService.t('cancel')}
        </button>
        <button
          type="button"
          disabled={!canRetry}
          onClick={() => {
            if (!canRetry) return;
            onRetry(
              buildWorkspaceAiChatRetryDraft({
                agentName,
                instruction: effectiveInstruction,
              }),
            );
          }}
          className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {i18nService.t('enterpriseLeadAiChatAdjustRetry')}
        </button>
      </div>
    </aside>
  );
};

interface WorkspaceAiChatPendingRowProps {
  isResearchEnabled?: boolean;
}

export const WorkspaceAiChatPendingRow: React.FC<WorkspaceAiChatPendingRowProps> = ({
  isResearchEnabled = true,
}) => {
  const steps = [
    {
      key: 'agent',
      label: i18nService.t('enterpriseLeadAiChatPendingAgent'),
      muted: false,
    },
    {
      key: 'research',
      label: i18nService.t(
        isResearchEnabled
          ? 'enterpriseLeadAiChatPendingResearch'
          : 'enterpriseLeadAiChatPendingResearchSkipped',
      ),
      muted: !isResearchEnabled,
    },
    {
      key: 'generation',
      label: i18nService.t('enterpriseLeadAiChatPendingGenerate'),
      muted: false,
    },
  ];

  return (
    <article aria-live="polite" className={getWorkspaceAiChatMessageRowClassName(false)}>
      <div className="max-w-[min(560px,88%)] rounded-2xl px-3 py-2 text-foreground">
        <div className="rounded-2xl bg-surface-raised px-3 py-3 text-sm leading-6 text-secondary shadow-subtle">
          <div className="inline-flex items-center gap-2">
            <span className="font-medium text-foreground">
              {i18nService.t('enterpriseLeadAiChatThinking')}
            </span>
            <span className="flex items-center gap-1" aria-hidden="true">
              {[0, 1, 2].map(index => (
                <span
                  key={index}
                  className="h-1.5 w-1.5 rounded-full bg-secondary/70 animate-bounce motion-reduce:animate-pulse"
                  style={getPendingDotStyle(index)}
                />
              ))}
            </span>
          </div>
          <ol className="mt-2 flex flex-wrap gap-1.5">
            {steps.map((step, index) => (
              <li key={step.key} className={getWorkspaceAiChatPendingStepClassName(step.muted)}>
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                    step.muted ? 'bg-surface-raised text-tertiary' : 'bg-primary/15 text-primary'
                  }`}
                >
                  {index + 1}
                </span>
                <span>{step.label}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </article>
  );
};

interface WorkspaceAiChatAgentPickerProps {
  choices: AgentChoice[];
  selectedAgentId: string;
  onSelectedAgentIdChange: (agentId: string) => void;
  className?: string;
  defaultOpen?: boolean;
}

export const WorkspaceAiChatAgentPicker: React.FC<WorkspaceAiChatAgentPickerProps> = ({
  choices,
  selectedAgentId,
  onSelectedAgentIdChange,
  className = '',
  defaultOpen = false,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();
  const menuId = useId();
  const selectedChoice = choices.find(choice => choice.id === selectedAgentId);
  const selectedLabel = selectedChoice?.label ?? i18nService.t('enterpriseLeadAiChatAgentAll');

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isOpen]);

  const renderOption = (
    id: string,
    label: string,
    description: string,
    badge: string,
  ): React.ReactElement => {
    const isSelected = id === selectedAgentId;

    return (
      <button
        key={id || 'all'}
        type="button"
        role="option"
        aria-selected={isSelected}
        className={`group flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors ${
          isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-surface-raised'
        }`}
        onClick={() => {
          onSelectedAgentIdChange(id);
          setIsOpen(false);
        }}
      >
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold ${
            isSelected
              ? 'bg-primary/15 text-primary'
              : 'bg-background text-secondary group-hover:text-foreground'
          }`}
        >
          {badge}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{label}</span>
          <span
            className={`mt-0.5 block text-xs leading-4 ${
              isSelected ? 'text-primary/80' : 'text-secondary'
            }`}
          >
            {description}
          </span>
        </span>
        {isSelected ? <CheckIcon className="mt-1.5 h-4 w-4 shrink-0" /> : null}
      </button>
    );
  };

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        id={triggerId}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={menuId}
        aria-label={i18nService.t('enterpriseLeadAiChatAgentPickerLabel')}
        className="flex h-7 max-w-full items-center gap-1.5 rounded-lg px-2 text-[13px] text-secondary transition-all duration-150 ease-out hover:bg-background/80 hover:text-foreground active:scale-[0.98]"
        onClick={() => setIsOpen(previous => !previous)}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            setIsOpen(false);
          }
        }}
      >
        <SparklesIcon className="h-4 w-4 shrink-0" />
        <span className="shrink-0">{i18nService.t('enterpriseLeadAiChatAgentLabel')}</span>
        <span className="min-w-0 truncate font-medium text-foreground">{selectedLabel}</span>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen ? (
        <div
          id={menuId}
          role="listbox"
          aria-labelledby={triggerId}
          className="absolute bottom-full left-0 z-50 mb-2 w-[294px] max-w-[min(294px,calc(100vw-48px))] rounded-2xl border border-border bg-surface p-1.5 shadow-card"
        >
          <div className="px-2 pb-1 pt-1 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadAiChatAgentPickerLabel')}
          </div>
          {renderOption(
            '',
            i18nService.t('enterpriseLeadAiChatAgentAll'),
            i18nService.t('enterpriseLeadAiChatAgentAutoDesc'),
            'A',
          )}
          {choices.map(choice =>
            renderOption(
              choice.id,
              choice.label,
              i18nService.t('enterpriseLeadAiChatAgentSpecificDesc'),
              choice.label.trim().slice(0, 1).toUpperCase() || 'A',
            ),
          )}
        </div>
      ) : null}
    </div>
  );
};

export const WorkspaceAiChat: React.FC<WorkspaceAiChatProps> = ({
  workspace,
  activeSessionId = null,
  onSessionChange,
  onSessionsUpdated,
}) => {
  const [messages, setMessages] = useState<EnterpriseLeadWorkspaceChatMessage[]>([]);
  const [draftMessage, setDraftMessage] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [typewriterMessageId, setTypewriterMessageId] = useState<string | null>(null);
  const [adjustingMessage, setAdjustingMessage] =
    useState<EnterpriseLeadWorkspaceChatMessage | null>(null);
  const requestTokenRef = useRef<WorkspaceAiChatRequestToken>({
    requestId: 0,
    workspaceId: workspace.id,
    sessionId: activeSessionId,
  });

  const workspaceAgentBindings = useMemo(
    () =>
      workspace.workspaceAgents.length > 0
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
    const sessionId = activeSessionId ?? null;
    requestTokenRef.current = {
      requestId: requestTokenRef.current.requestId + 1,
      workspaceId: workspace.id,
      sessionId,
    };
    setDraftMessage('');
    setError('');
    setSelectedAgentId('');
    setIsSending(false);
    setTypewriterMessageId(null);
    setAdjustingMessage(null);

    if (!sessionId) {
      setMessages([]);
      return undefined;
    }

    let isCancelled = false;
    const requestToken = requestTokenRef.current;

    enterpriseLeadWorkspaceService
      .getChatSession(workspace.id, sessionId)
      .then(session => {
        if (
          isCancelled ||
          !isWorkspaceAiChatRequestCurrent(requestToken, requestTokenRef.current)
        ) {
          return;
        }

        setMessages(session?.messages ?? []);
      })
      .catch(() => {
        if (
          !isCancelled &&
          isWorkspaceAiChatRequestCurrent(requestToken, requestTokenRef.current)
        ) {
          setMessages([]);
          setError(i18nService.t('enterpriseLeadAiChatFailed'));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [activeSessionId, workspace.id]);

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
    const sessionId = activeSessionId ?? null;
    const requestToken = {
      requestId: requestTokenRef.current.requestId + 1,
      workspaceId: workspace.id,
      sessionId,
    };
    requestTokenRef.current = requestToken;
    const isCurrentRequest = (): boolean =>
      isWorkspaceAiChatRequestCurrent(requestToken, requestTokenRef.current);

    setMessages(previous => [...previous, userMessage]);
    setDraftMessage('');
    setError('');
    setIsSending(true);

    try {
      const responsePromise = enterpriseLeadWorkspaceService.chat(workspace.id, {
        message: messageToSend,
        sessionId: sessionId || undefined,
        targetAgentId: selectedAgentId || undefined,
        recentMessages,
      });
      onSessionsUpdated?.();
      const response = await responsePromise;

      if (!isCurrentRequest()) {
        return;
      }

      if (response?.session) {
        setMessages(response.session.messages);
        const latestAssistantMessage = [...response.session.messages]
          .reverse()
          .find(message => message.role === 'assistant');
        setTypewriterMessageId(latestAssistantMessage?.id ?? null);
        onSessionChange?.(response.session.id);
        onSessionsUpdated?.();
        return;
      }

      if (response?.message) {
        setMessages(previous => [...previous, response.message]);
        setTypewriterMessageId(response.message.role === 'assistant' ? response.message.id : null);
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

  const renderComposer = (compact = false): React.ReactElement => {
    const formClassName = compact
      ? 'mx-auto w-full max-w-[920px] text-left'
      : 'mx-auto w-full max-w-[920px] text-left';
    const cardClassName = compact
      ? 'relative z-10 rounded-2xl border border-border bg-surface shadow-subtle transition-all duration-200 ease-out focus-within:border-primary/30 focus-within:shadow-card'
      : 'relative z-10 rounded-2xl border border-border bg-surface shadow-card transition-all duration-200 ease-out focus-within:border-primary/30 focus-within:shadow-card';
    const textareaClassName = compact
      ? 'w-full min-h-[56px] max-h-[140px] resize-none bg-transparent px-4 pb-2 pt-3 text-sm leading-[22px] text-foreground outline-none placeholder:text-secondary/60 dark:placeholder:text-foregroundSecondary/60'
      : 'w-full min-h-[92px] max-h-[180px] resize-none bg-transparent px-4 pb-2 pt-3 text-[15px] leading-[23px] text-foreground outline-none placeholder:text-secondary/60 dark:placeholder:text-foregroundSecondary/60';
    const iconButtonClassName =
      'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-secondary transition-all duration-150 ease-out hover:bg-surface-raised hover:text-foreground active:scale-[0.98]';
    const contextControlClassName =
      'flex h-7 max-w-full items-center gap-1.5 rounded-lg px-2 text-[13px] text-secondary transition-all duration-150 ease-out hover:bg-background/80 hover:text-foreground active:scale-[0.98]';
    const sendButtonClassName = `flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-all ${
      canSend
        ? 'bg-neutral-950 text-white shadow-subtle duration-150 ease-out hover:bg-neutral-800 active:scale-95 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200'
        : 'cursor-not-allowed bg-neutral-300 text-white duration-150 ease-out dark:bg-neutral-700 dark:text-neutral-500'
    }`;

    return (
      <form onSubmit={handleSubmit} className={formClassName}>
        <div className={cardClassName}>
          <textarea
            value={draftMessage}
            onChange={event => setDraftMessage(event.target.value)}
            onKeyDown={event => {
              if (shouldSubmitWorkspaceChatKey(event)) {
                event.preventDefault();
                void handleSend();
              }
            }}
            aria-label={i18nService.t('enterpriseLeadAiChatInputLabel')}
            placeholder={i18nService.t('enterpriseLeadAiChatPlaceholder')}
            rows={compact ? 2 : 4}
            className={textareaClassName}
          />

          <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                className={iconButtonClassName}
                aria-label={i18nService.t('enterpriseLeadAiChatAddContext')}
              >
                <PlusIcon className="h-5 w-5" />
              </button>
            </div>

            <button
              type="submit"
              disabled={!canSend}
              aria-label={i18nService.t(
                isSending ? 'enterpriseLeadAiChatSending' : 'enterpriseLeadAiChatSend',
              )}
              className={sendButtonClassName}
            >
              <ArrowUpIcon className="h-[17px] w-[17px]" />
            </button>
          </div>
        </div>

        <div className="-mt-2 flex min-h-10 items-center gap-1 rounded-b-2xl bg-black/[0.035] px-4 pb-2 pt-3.5 dark:bg-white/[0.05]">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <WorkspaceAiChatAgentPicker
              choices={agentChoices}
              selectedAgentId={selectedAgentId}
              onSelectedAgentIdChange={setSelectedAgentId}
              className="max-w-[300px]"
            />
            <span className={contextControlClassName}>
              <MagnifyingGlassIcon className="h-4 w-4 shrink-0" />
              {i18nService.t(
                isResearchEnabled
                  ? 'enterpriseLeadAiChatCapabilityResearchEnabled'
                  : 'enterpriseLeadAiChatCapabilityResearchDisabled',
              )}
            </span>
            <span className={contextControlClassName}>
              <BookOpenIcon className="h-4 w-4 shrink-0" />
              {i18nService.t('enterpriseLeadAiChatCapabilityKnowledge')}
            </span>
          </div>
        </div>
      </form>
    );
  };

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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {messages.length > 0 ? (
          <div className="mx-auto flex w-full max-w-[920px] flex-col gap-[22px] px-5 pb-[22px] pt-[46px]">
            {messages.map((message, index) => (
              <WorkspaceAiChatMessageRow
                key={message.id}
                message={message}
                animate={index === messages.length - 1}
                typewriter={message.id === typewriterMessageId}
                onAdjustAgent={setAdjustingMessage}
                onTypewriterComplete={() => {
                  setTypewriterMessageId(current => (current === message.id ? null : current));
                }}
              />
            ))}
            {isSending ? <WorkspaceAiChatPendingRow isResearchEnabled={isResearchEnabled} /> : null}
          </div>
        ) : (
          <div className="relative flex min-h-full w-full min-w-[320px] flex-col items-center justify-center px-6 py-10 text-center">
            <div className="w-full max-w-[920px]">
              <div className="mx-auto max-w-3xl">
                <h1
                  className="text-[28px] font-semibold leading-9 tracking-normal text-foreground animate-fade-in-up motion-reduce:animate-none"
                  style={getWorkspaceAiChatEntranceStyle(70)}
                >
                  {i18nService.t('enterpriseLeadAiChatEmptyTitle')}
                </h1>
                <p
                  className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-secondary animate-fade-in-up motion-reduce:animate-none"
                  style={getWorkspaceAiChatEntranceStyle(120)}
                >
                  {i18nService.t('enterpriseLeadAiChatSubtitle')}
                </p>
              </div>
              <div
                className="mt-7 w-full text-left animate-fade-in-up motion-reduce:animate-none"
                style={getWorkspaceAiChatEntranceStyle(160)}
              >
                {renderComposer(false)}
              </div>
            </div>
          </div>
        )}
      </div>

      {messages.length > 0 ? (
        <div className="shrink-0 bg-background px-5 pb-[18px] pt-3">{renderComposer(true)}</div>
      ) : null}

      {adjustingMessage?.agent ? (
        <WorkspaceAiChatAdjustmentDrawer
          agentName={adjustingMessage.agent.name}
          messageContent={adjustingMessage.content}
          onClose={() => setAdjustingMessage(null)}
          onRetry={draft => {
            setDraftMessage(draft);
            setAdjustingMessage(null);
          }}
        />
      ) : null}
    </div>
  );
};

export default WorkspaceAiChat;
