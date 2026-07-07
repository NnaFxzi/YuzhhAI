import { AgentId } from '@shared/agent';

import { i18nService } from '../../services/i18n';
import { isDefaultAgentId } from '../../utils/agentDisplay';

export interface PromptAgentOption {
  id: string;
  name?: string;
  icon?: string;
  enabled: boolean;
}

export interface PromptAgentSelectorState {
  agentOptions: PromptAgentOption[];
  currentAgentForDisplay: PromptAgentOption | null;
  shouldShowAgentSelector: boolean;
}

export const shouldDisplayPromptAgentContext = (agentId?: string | null): boolean =>
  Boolean(agentId?.trim()) && !isDefaultAgentId(agentId);

export function resolvePromptAgentSelectorState({
  agents,
  currentAgentId,
}: {
  agents: PromptAgentOption[];
  currentAgentId: string;
}): PromptAgentSelectorState {
  const currentAgent = agents.find((agent) => agent.id === currentAgentId) ?? null;
  const configuredDefaultAgent = agents.find((agent) => isDefaultAgentId(agent.id));
  const defaultAgent = {
    id: AgentId.Main,
    name: i18nService.t('coworkNoAgentOption'),
    icon: configuredDefaultAgent?.icon ?? '',
    enabled: configuredDefaultAgent?.enabled ?? true,
  };
  const isCurrentDefaultAgent = isDefaultAgentId(currentAgentId);
  const userAgents = agents.filter((agent) => !isDefaultAgentId(agent.id));
  const enabledUserAgents = userAgents.filter((agent) => agent.enabled);
  const currentCustomAgent = currentAgent && !isCurrentDefaultAgent ? currentAgent : null;
  const customAgentOptions = currentCustomAgent && !enabledUserAgents.some((agent) => agent.id === currentCustomAgent.id)
    ? [currentCustomAgent, ...enabledUserAgents]
    : enabledUserAgents;
  const agentOptions = customAgentOptions.length > 0
    ? [defaultAgent, ...customAgentOptions]
    : customAgentOptions;

  return {
    agentOptions,
    currentAgentForDisplay: currentCustomAgent,
    shouldShowAgentSelector: Boolean(currentCustomAgent) && agentOptions.length > 0,
  };
}
