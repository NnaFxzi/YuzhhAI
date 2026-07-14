import { VIDEO_GENERATION_HANDOFF_PROMPT } from '../../shared/contentProduction/videoGenerationHandoff';
import {
  CoworkWorkspaceAgentMode,
  type CoworkWorkspaceAgentSelection,
} from '../../shared/cowork/workspaceAgentSelection';
import { EnterpriseLeadAgentRole } from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
} from '../../shared/enterpriseLeadWorkspace/types';

const MAX_FIELD_LENGTH = 900;
const MAX_AGENT_COUNT = 12;

interface CoworkWorkspaceAgentPromptInfo {
  id: string;
  name: string;
  description: string;
  identity: string;
  systemPrompt: string;
  icon: string;
  model: string;
  skillIds: string[];
  order: number;
}

export interface CoworkWorkspaceAgentTeamPromptOptions {
  workspace: EnterpriseLeadWorkspace | null | undefined;
  selection: CoworkWorkspaceAgentSelection | null | undefined;
}

const cleanText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const cleanTextList = (value: unknown): string[] =>
  Array.isArray(value) ? Array.from(new Set(value.map(cleanText).filter(Boolean))) : [];

const boundText = (value: unknown): string => {
  const text = cleanText(value);
  if (text.length <= MAX_FIELD_LENGTH) return text;
  return `${text.slice(0, MAX_FIELD_LENGTH).trimEnd()}...`;
};

const readEffectiveAgentText = (
  binding: EnterpriseLeadWorkspaceAgentBinding,
  key: 'name' | 'description' | 'identity' | 'systemPrompt' | 'icon' | 'model',
): string => boundText(binding.overrides?.[key] ?? binding[key]);

const readEffectiveSkillIds = (binding: EnterpriseLeadWorkspaceAgentBinding): string[] =>
  cleanTextList(binding.overrides?.skillIds ?? binding.skillIds).slice(0, MAX_AGENT_COUNT);

const toPromptInfo = (
  binding: EnterpriseLeadWorkspaceAgentBinding,
): CoworkWorkspaceAgentPromptInfo => {
  const name = readEffectiveAgentText(binding, 'name') || binding.agentId;
  return {
    id: binding.agentId,
    name,
    description: readEffectiveAgentText(binding, 'description'),
    identity: readEffectiveAgentText(binding, 'identity'),
    systemPrompt: readEffectiveAgentText(binding, 'systemPrompt'),
    icon: readEffectiveAgentText(binding, 'icon'),
    model: readEffectiveAgentText(binding, 'model'),
    skillIds: readEffectiveSkillIds(binding),
    order: Number.isFinite(binding.order) ? binding.order : 0,
  };
};

const resolveEnabledAgents = (
  workspace: EnterpriseLeadWorkspace,
): CoworkWorkspaceAgentPromptInfo[] =>
  workspace.workspaceAgents
    .filter(binding => binding.enabled)
    .sort((left, right) => left.order - right.order || left.agentId.localeCompare(right.agentId))
    .slice(0, MAX_AGENT_COUNT)
    .map(toPromptInfo);

const buildAgentLines = (agent: CoworkWorkspaceAgentPromptInfo, isTarget: boolean): string[] => {
  const title = `- ${agent.name}${isTarget ? ' (target)' : ''}`;
  const details = [
    `  id: ${agent.id}`,
    agent.description ? `  description: ${agent.description}` : '',
    agent.identity ? `  identity: ${agent.identity}` : '',
    agent.systemPrompt ? `  systemPrompt: ${agent.systemPrompt}` : '',
    agent.id === EnterpriseLeadAgentRole.ContentPlanning
      ? `  outputFollowUp: ${VIDEO_GENERATION_HANDOFF_PROMPT}`
      : '',
    agent.model ? `  model: ${agent.model}` : '',
    agent.skillIds.length > 0 ? `  skills: ${agent.skillIds.join(', ')}` : '',
  ].filter(Boolean);

  return [title, ...details];
};

export const buildCoworkWorkspaceAgentTeamPrompt = ({
  workspace,
  selection,
}: CoworkWorkspaceAgentTeamPromptOptions): string | null => {
  if (!workspace || !selection || workspace.id !== selection.workspaceId) {
    return null;
  }

  const agents = resolveEnabledAgents(workspace);
  if (agents.length === 0) return null;

  const manualTarget =
    selection.mode === CoworkWorkspaceAgentMode.Manual && selection.agentId
      ? (agents.find(agent => agent.id === selection.agentId) ?? null)
      : null;
  const routingMode = manualTarget
    ? CoworkWorkspaceAgentMode.Manual
    : CoworkWorkspaceAgentMode.Auto;

  const lines = [
    'Cowork workspace Agent team context',
    `Workspace: ${boundText(workspace.name || workspace.id)}`,
    `Routing mode: ${routingMode}`,
    manualTarget ? `Manual target Agent: ${manualTarget.name}` : '',
    manualTarget
      ? 'Answer under the selected Agent responsibility while keeping Cowork tools and context available.'
      : 'Choose the most relevant Agent responsibility for the user request, or combine responsibilities when useful.',
    'Auto/manual selection only routes the current Cowork turn; it does not start or represent an executed workflow.',
    'For a complete promotion plan, bulk lead generation, or ongoing monitoring, recommend the workflow run page.',
    'Do not claim other Agents executed unless a corresponding Workflow Event or an OpenClaw child-session event provides that result.',
    `Enabled Agents (${agents.length}):`,
    ...agents.flatMap(agent => buildAgentLines(agent, agent.id === manualTarget?.id)),
  ].filter(Boolean);

  return lines.join('\n');
};
