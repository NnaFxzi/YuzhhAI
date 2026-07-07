import {
  CoworkWorkspaceAgentMode,
  type CoworkWorkspaceAgentSelection,
} from '../../../shared/cowork/workspaceAgentSelection';
import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
} from '../../../shared/enterpriseLeadWorkspace/types';

export interface WorkspaceAgentTeamChoice {
  id: string;
  label: string;
  description?: string;
  model?: string;
  iconText?: string;
}

export interface WorkspaceAgentTeamChoiceState {
  shouldShow: boolean;
  choices: WorkspaceAgentTeamChoice[];
  selection: CoworkWorkspaceAgentSelection | null;
  selectedChoice: WorkspaceAgentTeamChoice | null;
}

const cleanText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const readAgentText = (
  binding: EnterpriseLeadWorkspaceAgentBinding,
  key: 'name' | 'description' | 'icon' | 'model',
): string => cleanText(binding.overrides?.[key] ?? binding[key]);

const toChoice = (binding: EnterpriseLeadWorkspaceAgentBinding): WorkspaceAgentTeamChoice => {
  const label = readAgentText(binding, 'name') || binding.agentId;
  return {
    id: binding.agentId,
    label,
    ...(readAgentText(binding, 'description')
      ? { description: readAgentText(binding, 'description') }
      : {}),
    ...(readAgentText(binding, 'model') ? { model: readAgentText(binding, 'model') } : {}),
    iconText: readAgentText(binding, 'icon') || label.slice(0, 1),
  };
};

export const deriveWorkspaceAgentTeamChoices = (
  workspace: EnterpriseLeadWorkspace | null | undefined,
  currentSelection: CoworkWorkspaceAgentSelection | null | undefined,
): WorkspaceAgentTeamChoiceState => {
  if (!workspace) {
    return {
      shouldShow: false,
      choices: [],
      selection: null,
      selectedChoice: null,
    };
  }

  const choices = workspace.workspaceAgents
    .filter(binding => binding.enabled)
    .sort((left, right) => left.order - right.order || left.agentId.localeCompare(right.agentId))
    .map(toChoice);

  if (choices.length === 0) {
    return {
      shouldShow: false,
      choices: [],
      selection: null,
      selectedChoice: null,
    };
  }

  const selectedChoice =
    currentSelection?.workspaceId === workspace.id &&
    currentSelection.mode === CoworkWorkspaceAgentMode.Manual &&
    currentSelection.agentId
      ? (choices.find(choice => choice.id === currentSelection.agentId) ?? null)
      : null;

  const selection: CoworkWorkspaceAgentSelection = selectedChoice
    ? {
        workspaceId: workspace.id,
        mode: CoworkWorkspaceAgentMode.Manual,
        agentId: selectedChoice.id,
      }
    : {
        workspaceId: workspace.id,
        mode: CoworkWorkspaceAgentMode.Auto,
      };

  return {
    shouldShow: true,
    choices,
    selection,
    selectedChoice,
  };
};
