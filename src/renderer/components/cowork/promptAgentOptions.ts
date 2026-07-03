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

export function resolvePromptAgentSelectorState({
  agents,
  currentAgentId,
}: {
  agents: PromptAgentOption[];
  currentAgentId: string;
}): PromptAgentSelectorState {
  const currentAgent = agents.find((agent) => agent.id === currentAgentId) ?? null;
  const isCurrentDefaultAgent = isDefaultAgentId(currentAgentId);
  const userAgents = agents.filter((agent) => !isDefaultAgentId(agent.id));
  const enabledUserAgents = userAgents.filter((agent) => agent.enabled);
  const currentCustomAgent = currentAgent && !isCurrentDefaultAgent ? currentAgent : null;
  const agentOptions = currentCustomAgent && !enabledUserAgents.some((agent) => agent.id === currentCustomAgent.id)
    ? [currentCustomAgent, ...enabledUserAgents]
    : enabledUserAgents;

  return {
    agentOptions,
    currentAgentForDisplay: currentCustomAgent,
    shouldShowAgentSelector: agentOptions.length > 0,
  };
}
