import type { UpdateAgentRequest } from '../../types/agent';

export const AgentSettingsSaveStep = {
  Agent: 'agent',
  ExternalResearch: 'externalResearch',
  DomesticResearch: 'domesticResearch',
  Bootstrap: 'bootstrap',
  ImBindings: 'imBindings',
} as const;

export type AgentSettingsSaveStep =
  (typeof AgentSettingsSaveStep)[keyof typeof AgentSettingsSaveStep];

export type AgentSettingsSaveStepStatus = 'success' | 'failed';

export interface AgentSettingsSaveStepResult {
  step: AgentSettingsSaveStep;
  status: AgentSettingsSaveStepStatus;
}

const AGENT_SETTINGS_SAVE_STEP_LABEL_KEYS: Record<AgentSettingsSaveStep, string> = {
  [AgentSettingsSaveStep.Agent]: 'agentSaveStepAgent',
  [AgentSettingsSaveStep.ExternalResearch]: 'agentSaveStepExternalResearch',
  [AgentSettingsSaveStep.DomesticResearch]: 'agentSaveStepDomesticResearch',
  [AgentSettingsSaveStep.Bootstrap]: 'agentSaveStepBootstrap',
  [AgentSettingsSaveStep.ImBindings]: 'agentSaveStepImBindings',
};

type Translate = (key: string) => string;

const AGENT_SETTINGS_RUNTIME_IMPACT_LABEL_KEYS = [
  ['model', 'agentRuntimeImpactModel'],
  ['skillIds', 'agentRuntimeImpactSkills'],
  ['workingDirectory', 'agentRuntimeImpactWorkingDirectory'],
  ['imBindings', 'agentRuntimeImpactImBindings'],
] as const;

export interface AgentSettingsUpdateDraft {
  name: string;
  description: string;
  systemPrompt: string;
  identity: string;
  model: string;
  workingDirectory: string;
  icon: string;
  skillIds: string[];
  enabled: boolean;
}

export const buildAgentSettingsUpdateRequest = (
  draft: AgentSettingsUpdateDraft,
  isSystemAgent: boolean,
): UpdateAgentRequest => {
  if (isSystemAgent) {
    return {
      model: draft.model,
      workingDirectory: draft.workingDirectory,
      enabled: draft.enabled,
    };
  }

  return draft;
};

export const buildAgentSettingsSaveFailureMessage = (
  results: AgentSettingsSaveStepResult[],
  t: Translate,
): string => {
  const labels = (status: AgentSettingsSaveStepStatus) =>
    results
      .filter(result => result.status === status)
      .map(result => t(AGENT_SETTINGS_SAVE_STEP_LABEL_KEYS[result.step]));
  const succeededLabels = labels('success');
  const failedLabels = labels('failed');
  const failedSummary = `${t('agentSaveFailedSteps')}：${failedLabels.join('、')}`;

  if (succeededLabels.length === 0) {
    return `${t('agentSaveFailed')}。${failedSummary}`;
  }

  return `${t('agentSavePartialFailed')}${t('agentSaveSucceededSteps')}：${succeededLabels.join('、')}；${failedSummary}`;
};

export const buildAgentSettingsRuntimeImpactMessage = (
  changedFields: string[],
  t: Translate,
): string => {
  const changedFieldSet = new Set(changedFields);
  const impactLabels = AGENT_SETTINGS_RUNTIME_IMPACT_LABEL_KEYS.filter(([field]) =>
    changedFieldSet.has(field),
  ).map(([, labelKey]) => t(labelKey));

  if (impactLabels.length === 0) {
    return '';
  }

  return `${t('agentRuntimeImpactPrefix')}${t('agentRuntimeImpactSeparator')}${impactLabels.join(t('agentRuntimeImpactJoiner'))}`;
};
