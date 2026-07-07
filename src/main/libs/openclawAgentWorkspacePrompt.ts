import type { AgentResponseContract } from '../../shared/agent';
import { buildAgentKnowledgeEvidencePrompt } from './agentKnowledgeEvidencePrompt';
import { buildAgentResponseContractRuntimePrompt } from './agentResponseContractPrompt';

export const buildAgentWorkspaceSystemPrompt = (agent: {
  systemPrompt?: string | null;
  responseContract?: AgentResponseContract | null;
}): string =>
  [
    (agent.systemPrompt || '').trim(),
    buildAgentKnowledgeEvidencePrompt(),
    buildAgentResponseContractRuntimePrompt(agent.responseContract),
  ]
    .filter(Boolean)
    .join('\n\n');
