import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisHorizontalIcon,
  NoSymbolIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { AgentId } from '@shared/agent';
import { EnterpriseLeadAgentGroupId } from '@shared/enterpriseLeadWorkspace/agentOrganization';
import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadContentAgentRoles,
  EnterpriseLeadDocumentExtractionStatus,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadKnowledgeIndexStatus,
  EnterpriseLeadWorkspaceAgentCalibrationCheckId,
  EnterpriseLeadWorkspaceAgentSource,
  EnterpriseLeadWorkspaceType,
} from '@shared/enterpriseLeadWorkspace/constants';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSelector } from 'react-redux';

import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
  EnterpriseLeadWorkspaceAgentCalibrationRequest,
  EnterpriseLeadWorkspaceAgentCalibrationResponse,
  EnterpriseLeadWorkspaceAgentOverrides,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceSettings,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import { toOpenClawModelRef } from '../../utils/openclawModelRef';
import {
  buildEmptyEnterpriseLeadWorkspaceProfile,
  type EnterpriseLeadWorkbenchMode as EnterpriseLeadWorkbenchModeType,
  EnterpriseLeadWorkbenchStatusTone,
  getAgentRoleLabel,
  getEffectiveWorkspaceAgent,
  getPromotionDepartmentSections,
  type WorkspaceAgentTemplate,
} from './enterpriseLeadWorkspaceUi';
import {
  createWorkspaceAgentCalibrationChecks,
  createWorkspaceAgentStabilityProfileDraft,
  type WorkspaceAgentStabilityDraftContext,
} from './workspaceAgentStabilityProfiles';

export { buildEnterpriseLeadWorkspaceSettingsFromCurrentConfig } from './WorkspaceSettings';

interface WorkspaceWorkbenchProps {
  workspace: EnterpriseLeadWorkspace;
  initialSnapshot?: EnterpriseLeadWorkspaceSnapshot | null;
  initialMode?: EnterpriseLeadWorkbenchModeType;
  onWorkspaceUpdated?: (workspace: EnterpriseLeadWorkspace) => void;
}

export type WorkspaceWorkbenchSaveState = 'idle' | 'saving' | 'saved' | 'error';

export const WorkspaceAgentOperation = {
  AddTemplate: 'add_template',
  AddLocalAgent: 'add_local_agent',
  Enable: 'enable',
  Disable: 'disable',
  Reorder: 'reorder',
  Remove: 'remove',
  SaveEdits: 'save_edits',
  Create: 'create',
} as const;
export type WorkspaceAgentOperation =
  (typeof WorkspaceAgentOperation)[keyof typeof WorkspaceAgentOperation];

type WorkspaceAgentOperationFeedbackStatus = Exclude<WorkspaceWorkbenchSaveState, 'idle'>;

const workspaceAgentOperationFeedbackLabelKeys: Record<
  WorkspaceAgentOperation,
  Record<WorkspaceAgentOperationFeedbackStatus, string>
> = {
  [WorkspaceAgentOperation.AddTemplate]: {
    saving: 'enterpriseLeadWorkbenchAgentOperationAddTemplateSaving',
    saved: 'enterpriseLeadWorkbenchAgentOperationAddTemplateSaved',
    error: 'enterpriseLeadWorkbenchAgentOperationAddTemplateError',
  },
  [WorkspaceAgentOperation.AddLocalAgent]: {
    saving: 'enterpriseLeadWorkbenchAgentOperationAddLocalSaving',
    saved: 'enterpriseLeadWorkbenchAgentOperationAddLocalSaved',
    error: 'enterpriseLeadWorkbenchAgentOperationAddLocalError',
  },
  [WorkspaceAgentOperation.Enable]: {
    saving: 'enterpriseLeadWorkbenchAgentOperationEnableSaving',
    saved: 'enterpriseLeadWorkbenchAgentOperationEnableSaved',
    error: 'enterpriseLeadWorkbenchAgentOperationEnableError',
  },
  [WorkspaceAgentOperation.Disable]: {
    saving: 'enterpriseLeadWorkbenchAgentOperationDisableSaving',
    saved: 'enterpriseLeadWorkbenchAgentOperationDisableSaved',
    error: 'enterpriseLeadWorkbenchAgentOperationDisableError',
  },
  [WorkspaceAgentOperation.Reorder]: {
    saving: 'enterpriseLeadWorkbenchAgentOperationReorderSaving',
    saved: 'enterpriseLeadWorkbenchAgentOperationReorderSaved',
    error: 'enterpriseLeadWorkbenchAgentOperationReorderError',
  },
  [WorkspaceAgentOperation.Remove]: {
    saving: 'enterpriseLeadWorkbenchAgentOperationRemoveSaving',
    saved: 'enterpriseLeadWorkbenchAgentOperationRemoveSaved',
    error: 'enterpriseLeadWorkbenchAgentOperationRemoveError',
  },
  [WorkspaceAgentOperation.SaveEdits]: {
    saving: 'enterpriseLeadWorkbenchAgentOperationSaveEditsSaving',
    saved: 'enterpriseLeadWorkbenchAgentOperationSaveEditsSaved',
    error: 'enterpriseLeadWorkbenchAgentOperationSaveEditsError',
  },
  [WorkspaceAgentOperation.Create]: {
    saving: 'enterpriseLeadWorkbenchAgentOperationCreateSaving',
    saved: 'enterpriseLeadWorkbenchAgentOperationCreateSaved',
    error: 'enterpriseLeadWorkbenchAgentOperationCreateError',
  },
};

const workspaceAgentGroupSummaryLabelKeys: Record<EnterpriseLeadAgentGroupId, string> = {
  [EnterpriseLeadAgentGroupId.PromotionLeadership]:
    'enterpriseLeadAgentGroupPromotionLeadershipSummary',
  [EnterpriseLeadAgentGroupId.DataIntelligence]: 'enterpriseLeadAgentGroupDataIntelligenceSummary',
  [EnterpriseLeadAgentGroupId.OpportunityStrategy]:
    'enterpriseLeadAgentGroupOpportunityStrategySummary',
  [EnterpriseLeadAgentGroupId.ContentAssets]: 'enterpriseLeadAgentGroupContentAssetsSummary',
  [EnterpriseLeadAgentGroupId.QualityRisk]: 'enterpriseLeadAgentGroupQualityRiskSummary',
  [EnterpriseLeadAgentGroupId.OperationExecution]:
    'enterpriseLeadAgentGroupOperationExecutionSummary',
  [EnterpriseLeadAgentGroupId.MonitoringReview]: 'enterpriseLeadAgentGroupMonitoringReviewSummary',
};

export const getWorkspaceAgentOperationFeedbackLabelKey = (
  operation: WorkspaceAgentOperation | null | undefined,
  saveState: WorkspaceWorkbenchSaveState,
): string => {
  if (!operation || saveState === 'idle') {
    return '';
  }

  return workspaceAgentOperationFeedbackLabelKeys[operation][saveState];
};

const isEnterpriseLeadAgentRole = (role: string): role is EnterpriseLeadAgentRole =>
  Object.values(EnterpriseLeadAgentRole).includes(role as EnterpriseLeadAgentRole);

const resolveWorkspaceAgentSource = (
  binding: EnterpriseLeadWorkspaceAgentBinding,
  agentId: string,
): EnterpriseLeadWorkspaceAgentSource => {
  if (
    binding.source === EnterpriseLeadWorkspaceAgentSource.SystemTemplate ||
    binding.source === EnterpriseLeadWorkspaceAgentSource.LocalAgent ||
    binding.source === EnterpriseLeadWorkspaceAgentSource.WorkspaceCreated
  ) {
    return binding.source;
  }

  return isEnterpriseLeadAgentRole(agentId)
    ? EnterpriseLeadWorkspaceAgentSource.SystemTemplate
    : EnterpriseLeadWorkspaceAgentSource.WorkspaceCreated;
};

const statusBadgeClassNames: Record<string, string> = {
  [EnterpriseLeadWorkbenchStatusTone.Enabled]:
    'bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300',
  [EnterpriseLeadWorkbenchStatusTone.Warning]:
    'bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-300',
  [EnterpriseLeadWorkbenchStatusTone.Disabled]:
    'bg-slate-500/10 text-slate-500 ring-1 ring-slate-500/15 dark:text-slate-300',
  [EnterpriseLeadWorkbenchStatusTone.Configured]:
    'bg-primary/10 text-primary ring-1 ring-primary/20',
  [EnterpriseLeadWorkbenchStatusTone.Unconfigured]:
    'bg-slate-500/10 text-slate-500 ring-1 ring-slate-500/15 dark:text-slate-300',
};

interface SaveWorkspaceAgentBindingsOptions {
  workspaceId: string;
  workspaceAgents: EnterpriseLeadWorkspaceAgentBinding[];
  isCurrentSave: () => boolean;
  onSaved: (workspace: EnterpriseLeadWorkspace) => void;
  onError: () => void;
  saveInFlightRef?: { current: boolean };
}

interface SaveWorkbenchWorkspaceAgentsOptions {
  workspaceId: string;
  workspaceAgents: EnterpriseLeadWorkspaceAgentBinding[];
  workspaceIdRef: { current: string };
  saveSequenceRef: { current: number };
  saveInFlightRef: { current: boolean };
  onSaving: () => void;
  onSaved: (workspace: EnterpriseLeadWorkspace) => void;
  onError: () => void;
}

interface CreateAndBindWorkspaceAgentOptions {
  workspaceId: string;
  workspaceAgents: EnterpriseLeadWorkspaceAgentBinding[];
  name: string;
  description: string;
  systemPrompt: string;
  identity: string;
  model: string;
  icon: string;
  isCurrentSave: () => boolean;
  onSaved: (workspace: EnterpriseLeadWorkspace) => void;
  onError: () => void;
  saveInFlightRef?: { current: boolean };
}

interface CreateWorkspaceFromUploadedMaterialOptions {
  workspaceName: string;
  sourceText: string;
  sourceLabel: string;
  fileName?: string;
  fileSize?: number;
  settings?: EnterpriseLeadWorkspaceSettings;
  onCreated?: (workspaceId: string) => void;
}

export const createWorkspaceFromUploadedMaterial = async ({
  workspaceName,
  sourceText,
  sourceLabel,
  fileName,
  fileSize,
  settings,
  onCreated,
}: CreateWorkspaceFromUploadedMaterialOptions): Promise<EnterpriseLeadWorkspace | null> => {
  const trimmedSourceLabel = sourceLabel.trim();
  const draft: EnterpriseLeadWorkspaceDraft = {
    name: workspaceName.trim() || trimmedSourceLabel,
    type: EnterpriseLeadWorkspaceType.EnterpriseLead,
    profile: buildEmptyEnterpriseLeadWorkspaceProfile(),
    source: {
      kind: EnterpriseLeadExtractionSourceKind.File,
      label: trimmedSourceLabel,
      fileName: fileName?.trim() || undefined,
      fileSize,
      text: sourceText.trim() || undefined,
      extractionStatus: EnterpriseLeadDocumentExtractionStatus.Pending,
      vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
    },
    enabledAgentRoles: [],
    settings,
    workspaceAgents: [],
  };

  const workspace = await enterpriseLeadWorkspaceService.createWorkspace(draft);
  if (!workspace) {
    return null;
  }

  onCreated?.(workspace.id);
  void enterpriseLeadWorkspaceService
    .processDocumentSource(workspace.id, workspace.extractionSources, 0)
    .catch((): void => undefined);

  return workspace;
};

export const saveWorkspaceAgentBindings = async ({
  workspaceId,
  workspaceAgents,
  isCurrentSave,
  onSaved,
  onError,
  saveInFlightRef,
}: SaveWorkspaceAgentBindingsOptions): Promise<void> => {
  if (saveInFlightRef?.current) {
    return;
  }

  if (saveInFlightRef) {
    saveInFlightRef.current = true;
  }

  try {
    const updated = await enterpriseLeadWorkspaceService.updateWorkspaceAgents(
      workspaceId,
      prepareWorkspaceAgentBindings(workspaceAgents),
    );
    if (!isCurrentSave()) {
      return;
    }
    if (!updated) {
      onError();
      return;
    }
    onSaved(updated);
  } catch {
    if (isCurrentSave()) {
      onError();
    }
  } finally {
    if (saveInFlightRef && isCurrentSave()) {
      saveInFlightRef.current = false;
    }
  }
};

export const saveWorkbenchWorkspaceAgents = async ({
  workspaceId,
  workspaceAgents,
  workspaceIdRef,
  saveSequenceRef,
  saveInFlightRef,
  onSaving,
  onSaved,
  onError,
}: SaveWorkbenchWorkspaceAgentsOptions): Promise<void> => {
  if (saveInFlightRef.current) {
    return;
  }

  const saveSequence = saveSequenceRef.current + 1;
  saveSequenceRef.current = saveSequence;
  onSaving();

  await saveWorkspaceAgentBindings({
    workspaceId,
    workspaceAgents: prepareWorkspaceAgentBindings(workspaceAgents),
    isCurrentSave: () =>
      workspaceIdRef.current === workspaceId && saveSequenceRef.current === saveSequence,
    onSaved,
    onError,
    saveInFlightRef,
  });
};

export const prepareWorkspaceAgentBindings = (
  bindings: EnterpriseLeadWorkspaceAgentBinding[],
): EnterpriseLeadWorkspaceAgentBinding[] => {
  const lastBindingByAgentId = new Map<
    string,
    {
      binding: EnterpriseLeadWorkspaceAgentBinding;
      sourceIndex: number;
    }
  >();

  bindings.forEach((binding, sourceIndex) => {
    const agentId = binding.agentId.trim();
    if (!agentId) {
      return;
    }
    const overrides = { ...(binding.overrides ?? {}) };
    delete overrides.skillIds;
    const normalizedBinding: EnterpriseLeadWorkspaceAgentBinding = {
      ...binding,
      agentId,
      source: resolveWorkspaceAgentSource(binding, agentId),
      ...(resolveWorkspaceAgentSource(binding, agentId) ===
      EnterpriseLeadWorkspaceAgentSource.SystemTemplate
        ? { templateId: binding.templateId?.trim() || agentId }
        : { templateId: undefined }),
      order: Number.isFinite(binding.order) ? binding.order : sourceIndex,
      overrides,
    };
    delete normalizedBinding.skillIds;

    lastBindingByAgentId.set(agentId, {
      binding: normalizedBinding,
      sourceIndex,
    });
  });

  return Array.from(lastBindingByAgentId.values())
    .sort((a, b) => a.binding.order - b.binding.order || a.sourceIndex - b.sourceIndex)
    .map(({ binding }, index) => ({
      ...binding,
      order: index,
    }));
};

export const moveWorkspaceAgentBinding = (
  bindings: EnterpriseLeadWorkspaceAgentBinding[],
  agentId: string,
  direction: -1 | 1,
): EnterpriseLeadWorkspaceAgentBinding[] => {
  const prepared = prepareWorkspaceAgentBindings(bindings);
  const currentIndex = prepared.findIndex(binding => binding.agentId === agentId);
  const targetIndex = currentIndex + direction;

  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= prepared.length) {
    return prepared;
  }

  const moved = [...prepared];
  const [item] = moved.splice(currentIndex, 1);
  moved.splice(targetIndex, 0, item);

  return moved.map((binding, order) => ({
    ...binding,
    order,
  }));
};

export const addSystemAgentBindingToWorkspace = (
  workspaceAgents: EnterpriseLeadWorkspaceAgentBinding[],
  template: EnterpriseLeadWorkspaceAgentBinding,
): EnterpriseLeadWorkspaceAgentBinding[] => {
  const preparedWorkspaceAgents = prepareWorkspaceAgentBindings(workspaceAgents);
  const templateId = template.templateId?.trim() || template.agentId.trim();
  if (!templateId) {
    return preparedWorkspaceAgents;
  }

  const alreadyAdded = preparedWorkspaceAgents.some(
    binding =>
      binding.source === EnterpriseLeadWorkspaceAgentSource.SystemTemplate &&
      (binding.templateId ?? binding.agentId) === templateId,
  );
  if (alreadyAdded) {
    return preparedWorkspaceAgents;
  }

  return prepareWorkspaceAgentBindings([
    ...preparedWorkspaceAgents,
    {
      ...template,
      enabled: true,
      order: preparedWorkspaceAgents.length,
      source: EnterpriseLeadWorkspaceAgentSource.SystemTemplate,
      templateId,
    },
  ]);
};

export const addSystemAgentBindingsToWorkspace = (
  workspaceAgents: EnterpriseLeadWorkspaceAgentBinding[],
  templates: EnterpriseLeadWorkspaceAgentBinding[],
): EnterpriseLeadWorkspaceAgentBinding[] =>
  templates.reduce(
    (bindings, template) => addSystemAgentBindingToWorkspace(bindings, template),
    workspaceAgents,
  );

export const addLocalAgentBindingToWorkspace = (
  workspaceAgents: EnterpriseLeadWorkspaceAgentBinding[],
  agent: WorkspaceAgentTemplate,
): EnterpriseLeadWorkspaceAgentBinding[] => {
  const preparedWorkspaceAgents = prepareWorkspaceAgentBindings(workspaceAgents);
  const agentId = agent.id.trim();
  if (!agentId || preparedWorkspaceAgents.some(binding => binding.agentId === agentId)) {
    return preparedWorkspaceAgents;
  }

  return prepareWorkspaceAgentBindings([
    ...preparedWorkspaceAgents,
    {
      agentId,
      source: EnterpriseLeadWorkspaceAgentSource.LocalAgent,
      enabled: true,
      order: preparedWorkspaceAgents.length,
      overrides: {},
    },
  ]);
};

const cleanOptionalText = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export type WorkspaceAgentOverrideDraft = {
  name: string;
  description: string;
  identity: string;
  systemPrompt: string;
  icon: string;
  model: string;
  skillIds: string[];
};

type WorkspaceAgentTextDraftField = Exclude<keyof WorkspaceAgentOverrideDraft, 'skillIds'>;
export type WorkspaceAgentDraftValidationError = 'name' | 'systemPrompt';

export const validateWorkspaceAgentDraft = ({
  draft,
  source,
  requireExecutionRules = false,
}: {
  draft: WorkspaceAgentOverrideDraft;
  source: EnterpriseLeadWorkspaceAgentSource;
  availableModelRefs: Set<string>;
  enabledSkillIds: Set<string>;
  requireExecutionRules?: boolean;
}): { valid: boolean; errors: WorkspaceAgentDraftValidationError[] } => {
  const errors: WorkspaceAgentDraftValidationError[] = [];
  if (source === EnterpriseLeadWorkspaceAgentSource.WorkspaceCreated && !draft.name.trim()) {
    errors.push('name');
  }
  if (
    requireExecutionRules &&
    source === EnterpriseLeadWorkspaceAgentSource.WorkspaceCreated &&
    !hasCompleteWorkspaceAgentStabilityRules(draft.systemPrompt)
  ) {
    errors.push('systemPrompt');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

const getOverrideDraft = (
  binding: EnterpriseLeadWorkspaceAgentBinding | undefined,
  baseAgent?: WorkspaceAgentTemplate | null,
): WorkspaceAgentOverrideDraft => ({
  name: binding?.overrides.name ?? binding?.name ?? baseAgent?.name ?? '',
  description:
    binding?.overrides.description ?? binding?.description ?? baseAgent?.description ?? '',
  identity: binding?.overrides.identity ?? binding?.identity ?? baseAgent?.identity ?? '',
  systemPrompt:
    binding?.overrides.systemPrompt ?? binding?.systemPrompt ?? baseAgent?.systemPrompt ?? '',
  icon: binding?.overrides.icon ?? binding?.icon ?? baseAgent?.icon ?? '',
  model: binding?.overrides.model ?? binding?.model ?? baseAgent?.model ?? '',
  skillIds: binding?.overrides.skillIds ?? [],
});

const emptyWorkspaceAgentDraft = (): WorkspaceAgentOverrideDraft => ({
  name: '',
  description: '',
  systemPrompt: '',
  identity: '',
  model: '',
  icon: '',
  skillIds: [],
});

interface WorkspaceAgentEditorDialogProps {
  workspaceId?: string;
  agentId?: string;
  draft: WorkspaceAgentOverrideDraft;
  saveState: WorkspaceWorkbenchSaveState;
  titleKey?: string;
  descriptionKey?: string;
  saveLabelKey?: string;
  saveDisabled?: boolean;
  manualExecutionRequired?: boolean;
  validationErrors?: WorkspaceAgentDraftValidationError[];
  feedbackLabelKey?: string;
  onDraftChange: (
    field: keyof WorkspaceAgentOverrideDraft,
    value: WorkspaceAgentOverrideDraft[keyof WorkspaceAgentOverrideDraft],
  ) => void;
  onCancel: () => void;
  onSave: () => void;
}

interface WorkspaceAgentEditorField {
  field: WorkspaceAgentTextDraftField;
  labelKey: string;
  multiline?: boolean;
  large?: boolean;
  className?: string;
}

const workspaceAgentEditorSections: ReadonlyArray<{
  titleKey: string;
  fields: WorkspaceAgentEditorField[];
}> = [
  {
    titleKey: 'enterpriseLeadWorkbenchEditorBasicInfo',
    fields: [
      {
        field: 'name',
        labelKey: 'enterpriseLeadWorkbenchOverrideName',
      },
      {
        field: 'icon',
        labelKey: 'enterpriseLeadWorkbenchOverrideIcon',
      },
      {
        field: 'description',
        labelKey: 'enterpriseLeadWorkbenchOverrideDescription',
        multiline: true,
        className: 'md:col-span-2',
      },
    ],
  },
];

export type WorkspaceAgentStabilityRuleField =
  'workStyle' | 'inputRequirements' | 'outputFormat' | 'guardrails';

interface WorkspaceAgentStabilityRuleSpec {
  field: WorkspaceAgentStabilityRuleField;
  labelKey: string;
  hintKey: string;
  defaultValueKey: string;
  rows?: number;
}

interface WorkspaceAgentCalibrationExampleSpec {
  id: string;
  titleKey: string;
  descKey: string;
  sampleHintKey: string;
  sampleDefaultKey: string;
  sampleNoteKey: string;
  expectedHintKey: string;
  expectedPriorityDefaultKey: string;
  expectedReasonDefaultKey: string;
  expectedMissingDefaultKey: string;
  expectedNextStepDefaultKey: string;
  checkKeys: [string, string, string];
}

export interface WorkspaceAgentCalibrationExampleDraft {
  id: string;
  sampleInput: string;
  expectedPriority: string;
  expectedReason: string;
  expectedMissing: string;
  expectedNextStep: string;
}

type WorkspaceAgentCalibrationCheckTexts = [string, string, string];

export interface WorkspaceAgentStabilityDraft {
  rules: Record<WorkspaceAgentStabilityRuleField, string>;
  examples: WorkspaceAgentCalibrationExampleDraft[];
  checks?: Record<string, WorkspaceAgentCalibrationCheckTexts>;
}

interface WorkspaceAgentCalibrationRunState {
  status: 'running' | 'success' | 'error';
  response?: EnterpriseLeadWorkspaceAgentCalibrationResponse;
}

export type WorkspaceAgentCalibrationScoreStatus = 'passed' | 'partial' | 'failed';

export interface WorkspaceAgentCalibrationScore {
  passed: number;
  total: number;
  status: WorkspaceAgentCalibrationScoreStatus;
  labelKey: string;
  failedCheckIds: EnterpriseLeadWorkspaceAgentCalibrationCheckId[];
}

export const getWorkspaceAgentCalibrationScore = (
  checks: EnterpriseLeadWorkspaceAgentCalibrationResponse['checks'],
): WorkspaceAgentCalibrationScore => {
  const total = checks.length;
  const passed = checks.filter(check => check.passed).length;
  const status: WorkspaceAgentCalibrationScoreStatus =
    total > 0 && passed === total ? 'passed' : passed > 0 ? 'partial' : 'failed';

  return {
    passed,
    total,
    status,
    failedCheckIds: checks.filter(check => !check.passed).map(check => check.id),
    labelKey:
      status === 'passed'
        ? 'enterpriseLeadWorkbenchCalibrationScorePassed'
        : status === 'partial'
          ? 'enterpriseLeadWorkbenchCalibrationScorePartial'
          : 'enterpriseLeadWorkbenchCalibrationScoreFailed',
  };
};

const workspaceAgentCalibrationCheckLabelKeys: Record<
  EnterpriseLeadWorkspaceAgentCalibrationCheckId,
  string
> = {
  [EnterpriseLeadWorkspaceAgentCalibrationCheckId.Priority]:
    'enterpriseLeadWorkbenchCalibrationCheckPriority',
  [EnterpriseLeadWorkspaceAgentCalibrationCheckId.Reason]:
    'enterpriseLeadWorkbenchCalibrationCheckReason',
  [EnterpriseLeadWorkspaceAgentCalibrationCheckId.Missing]:
    'enterpriseLeadWorkbenchCalibrationCheckMissing',
  [EnterpriseLeadWorkspaceAgentCalibrationCheckId.NextStep]:
    'enterpriseLeadWorkbenchCalibrationCheckNextStep',
};

const workspaceAgentStabilityRuleSpecs: WorkspaceAgentStabilityRuleSpec[] = [
  {
    field: 'workStyle',
    labelKey: 'enterpriseLeadWorkbenchStabilityWorkStyle',
    hintKey: 'enterpriseLeadWorkbenchStabilityWorkStyleHint',
    defaultValueKey: 'enterpriseLeadWorkbenchStabilityWorkStyleDefault',
  },
  {
    field: 'inputRequirements',
    labelKey: 'enterpriseLeadWorkbenchStabilityInputRequirements',
    hintKey: 'enterpriseLeadWorkbenchStabilityInputRequirementsHint',
    defaultValueKey: 'enterpriseLeadWorkbenchStabilityInputRequirementsDefault',
  },
  {
    field: 'outputFormat',
    labelKey: 'enterpriseLeadWorkbenchStabilityOutputFormat',
    hintKey: 'enterpriseLeadWorkbenchStabilityOutputFormatHint',
    defaultValueKey: 'enterpriseLeadWorkbenchStabilityOutputFormatDefault',
    rows: 4,
  },
  {
    field: 'guardrails',
    labelKey: 'enterpriseLeadWorkbenchStabilityGuardrails',
    hintKey: 'enterpriseLeadWorkbenchStabilityGuardrailsHint',
    defaultValueKey: 'enterpriseLeadWorkbenchStabilityGuardrailsDefault',
  },
];

const workspaceAgentCalibrationExampleSpecs: WorkspaceAgentCalibrationExampleSpec[] = [
  {
    id: 'high-intent',
    titleKey: 'enterpriseLeadWorkbenchCalibrationHighIntentTitle',
    descKey: 'enterpriseLeadWorkbenchCalibrationHighIntentDesc',
    sampleHintKey: 'enterpriseLeadWorkbenchCalibrationSampleHint',
    sampleDefaultKey: 'enterpriseLeadWorkbenchCalibrationHighIntentSample',
    sampleNoteKey: 'enterpriseLeadWorkbenchCalibrationHighIntentNote',
    expectedHintKey: 'enterpriseLeadWorkbenchCalibrationExpectedHint',
    expectedPriorityDefaultKey: 'enterpriseLeadWorkbenchCalibrationHighIntentPriority',
    expectedReasonDefaultKey: 'enterpriseLeadWorkbenchCalibrationHighIntentReason',
    expectedMissingDefaultKey: 'enterpriseLeadWorkbenchCalibrationHighIntentMissing',
    expectedNextStepDefaultKey: 'enterpriseLeadWorkbenchCalibrationHighIntentNextStep',
    checkKeys: [
      'enterpriseLeadWorkbenchCalibrationHighIntentCheck1',
      'enterpriseLeadWorkbenchCalibrationHighIntentCheck2',
      'enterpriseLeadWorkbenchCalibrationHighIntentCheck3',
    ],
  },
  {
    id: 'missing-info',
    titleKey: 'enterpriseLeadWorkbenchCalibrationMissingInfoTitle',
    descKey: 'enterpriseLeadWorkbenchCalibrationMissingInfoDesc',
    sampleHintKey: 'enterpriseLeadWorkbenchCalibrationSampleHint',
    sampleDefaultKey: 'enterpriseLeadWorkbenchCalibrationMissingInfoSample',
    sampleNoteKey: 'enterpriseLeadWorkbenchCalibrationMissingInfoNote',
    expectedHintKey: 'enterpriseLeadWorkbenchCalibrationExpectedHint',
    expectedPriorityDefaultKey: 'enterpriseLeadWorkbenchCalibrationMissingInfoPriority',
    expectedReasonDefaultKey: 'enterpriseLeadWorkbenchCalibrationMissingInfoReason',
    expectedMissingDefaultKey: 'enterpriseLeadWorkbenchCalibrationMissingInfoMissing',
    expectedNextStepDefaultKey: 'enterpriseLeadWorkbenchCalibrationMissingInfoNextStep',
    checkKeys: [
      'enterpriseLeadWorkbenchCalibrationMissingInfoCheck1',
      'enterpriseLeadWorkbenchCalibrationMissingInfoCheck2',
      'enterpriseLeadWorkbenchCalibrationMissingInfoCheck3',
    ],
  },
  {
    id: 'manual-review',
    titleKey: 'enterpriseLeadWorkbenchCalibrationManualReviewTitle',
    descKey: 'enterpriseLeadWorkbenchCalibrationManualReviewDesc',
    sampleHintKey: 'enterpriseLeadWorkbenchCalibrationSampleHint',
    sampleDefaultKey: 'enterpriseLeadWorkbenchCalibrationManualReviewSample',
    sampleNoteKey: 'enterpriseLeadWorkbenchCalibrationManualReviewNote',
    expectedHintKey: 'enterpriseLeadWorkbenchCalibrationExpectedHint',
    expectedPriorityDefaultKey: 'enterpriseLeadWorkbenchCalibrationManualReviewPriority',
    expectedReasonDefaultKey: 'enterpriseLeadWorkbenchCalibrationManualReviewReason',
    expectedMissingDefaultKey: 'enterpriseLeadWorkbenchCalibrationManualReviewMissing',
    expectedNextStepDefaultKey: 'enterpriseLeadWorkbenchCalibrationManualReviewNextStep',
    checkKeys: [
      'enterpriseLeadWorkbenchCalibrationManualReviewCheck1',
      'enterpriseLeadWorkbenchCalibrationManualReviewCheck2',
      'enterpriseLeadWorkbenchCalibrationManualReviewCheck3',
    ],
  },
];

const workspaceAgentStabilityPromptPrefix = 'lobsterai-agent-stability';

const getWorkspaceAgentStabilityPromptMarker = (key: string, end = false): string =>
  `[[${end ? '/' : ''}${workspaceAgentStabilityPromptPrefix}:${key}]]`;

const readWorkspaceAgentStabilityPromptBlock = (
  source: string,
  key: string,
  fallback: string,
): string => {
  const startMarker = getWorkspaceAgentStabilityPromptMarker(key);
  const endMarker = getWorkspaceAgentStabilityPromptMarker(key, true);
  const startIndex = source.indexOf(startMarker);
  if (startIndex < 0) {
    return fallback;
  }
  const contentStartIndex = startIndex + startMarker.length;
  const endIndex = source.indexOf(endMarker, contentStartIndex);
  if (endIndex < 0) {
    return fallback;
  }
  const parsed = source.slice(contentStartIndex, endIndex).trim();
  return parsed || fallback;
};

const renderWorkspaceAgentStabilityPromptBlock = (key: string, value: string): string =>
  [
    getWorkspaceAgentStabilityPromptMarker(key),
    value.trim(),
    getWorkspaceAgentStabilityPromptMarker(key, true),
  ].join('\n');

const createGenericWorkspaceAgentStabilityDraft = (): WorkspaceAgentStabilityDraft => ({
  rules: workspaceAgentStabilityRuleSpecs.reduce(
    (rules, spec) => ({
      ...rules,
      [spec.field]: i18nService.t(spec.defaultValueKey),
    }),
    {} as Record<WorkspaceAgentStabilityRuleField, string>,
  ),
  examples: workspaceAgentCalibrationExampleSpecs.map(spec => ({
    id: spec.id,
    sampleInput: i18nService.t(spec.sampleDefaultKey),
    expectedPriority: i18nService.t(spec.expectedPriorityDefaultKey),
    expectedReason: i18nService.t(spec.expectedReasonDefaultKey),
    expectedMissing: i18nService.t(spec.expectedMissingDefaultKey),
    expectedNextStep: i18nService.t(spec.expectedNextStepDefaultKey),
  })),
});

export const createWorkspaceAgentStabilityDraft = (
  context: WorkspaceAgentStabilityDraftContext = {},
): WorkspaceAgentStabilityDraft =>
  createWorkspaceAgentStabilityProfileDraft(context, createGenericWorkspaceAgentStabilityDraft());

export const createDefaultWorkspaceAgentStabilityDraft = (): WorkspaceAgentStabilityDraft =>
  createGenericWorkspaceAgentStabilityDraft();

export const createEmptyWorkspaceAgentStabilityDraft = (): WorkspaceAgentStabilityDraft => ({
  rules: workspaceAgentStabilityRuleSpecs.reduce(
    (rules, spec) => ({
      ...rules,
      [spec.field]: '',
    }),
    {} as Record<WorkspaceAgentStabilityRuleField, string>,
  ),
  examples: workspaceAgentCalibrationExampleSpecs.map(spec => ({
    id: spec.id,
    sampleInput: '',
    expectedPriority: '',
    expectedReason: '',
    expectedMissing: '',
    expectedNextStep: '',
  })),
});

export const parseWorkspaceAgentStabilityDraft = (
  systemPrompt: string,
  fallbackDraft: WorkspaceAgentStabilityDraft = createDefaultWorkspaceAgentStabilityDraft(),
): WorkspaceAgentStabilityDraft => {
  const parsedDraft: WorkspaceAgentStabilityDraft = {
    rules: workspaceAgentStabilityRuleSpecs.reduce(
      (rules, spec) => ({
        ...rules,
        [spec.field]: readWorkspaceAgentStabilityPromptBlock(
          systemPrompt,
          `rule.${spec.field}`,
          fallbackDraft.rules[spec.field],
        ),
      }),
      {} as Record<WorkspaceAgentStabilityRuleField, string>,
    ),
    examples: workspaceAgentCalibrationExampleSpecs.map(spec => {
      const fallback =
        fallbackDraft.examples.find(example => example.id === spec.id) ??
        createEmptyWorkspaceAgentStabilityDraft().examples[0];
      return {
        id: spec.id,
        sampleInput: readWorkspaceAgentStabilityPromptBlock(
          systemPrompt,
          `example.${spec.id}.sampleInput`,
          fallback.sampleInput,
        ),
        expectedPriority: readWorkspaceAgentStabilityPromptBlock(
          systemPrompt,
          `example.${spec.id}.expectedPriority`,
          fallback.expectedPriority,
        ),
        expectedReason: readWorkspaceAgentStabilityPromptBlock(
          systemPrompt,
          `example.${spec.id}.expectedReason`,
          fallback.expectedReason,
        ),
        expectedMissing: readWorkspaceAgentStabilityPromptBlock(
          systemPrompt,
          `example.${spec.id}.expectedMissing`,
          fallback.expectedMissing,
        ),
        expectedNextStep: readWorkspaceAgentStabilityPromptBlock(
          systemPrompt,
          `example.${spec.id}.expectedNextStep`,
          fallback.expectedNextStep,
        ),
      };
    }),
  };

  if (fallbackDraft.checks) {
    parsedDraft.checks = createWorkspaceAgentCalibrationChecks(parsedDraft.rules);
  }

  return parsedDraft;
};

const hasCompleteWorkspaceAgentStabilityRules = (systemPrompt: string): boolean => {
  const stabilityDraft = parseWorkspaceAgentStabilityDraft(
    systemPrompt,
    createEmptyWorkspaceAgentStabilityDraft(),
  );
  return workspaceAgentStabilityRuleSpecs.every(spec => stabilityDraft.rules[spec.field].trim());
};

export const buildWorkspaceAgentStabilityPrompt = (
  stabilityDraft: WorkspaceAgentStabilityDraft,
): string =>
  [
    i18nService.t('enterpriseLeadWorkbenchStabilityPromptTitle'),
    ...workspaceAgentStabilityRuleSpecs.map(spec =>
      renderWorkspaceAgentStabilityPromptBlock(
        `rule.${spec.field}`,
        stabilityDraft.rules[spec.field],
      ),
    ),
    i18nService.t('enterpriseLeadWorkbenchCalibrationPromptTitle'),
    ...stabilityDraft.examples.flatMap(example => [
      renderWorkspaceAgentStabilityPromptBlock(
        `example.${example.id}.sampleInput`,
        example.sampleInput,
      ),
      renderWorkspaceAgentStabilityPromptBlock(
        `example.${example.id}.expectedPriority`,
        example.expectedPriority,
      ),
      renderWorkspaceAgentStabilityPromptBlock(
        `example.${example.id}.expectedReason`,
        example.expectedReason,
      ),
      renderWorkspaceAgentStabilityPromptBlock(
        `example.${example.id}.expectedMissing`,
        example.expectedMissing,
      ),
      renderWorkspaceAgentStabilityPromptBlock(
        `example.${example.id}.expectedNextStep`,
        example.expectedNextStep,
      ),
    ]),
  ].join('\n\n');

const hasWorkspaceAgentStabilityPrompt = (systemPrompt: string): boolean =>
  systemPrompt.includes(getWorkspaceAgentStabilityPromptMarker('rule.workStyle'));

const getWorkspaceAgentCustomPromptPrefix = (systemPrompt: string): string => {
  const firstMarkerIndex = systemPrompt.indexOf(
    getWorkspaceAgentStabilityPromptMarker('rule.workStyle'),
  );
  const rawPrefix = firstMarkerIndex < 0 ? systemPrompt : systemPrompt.slice(0, firstMarkerIndex);
  return rawPrefix.replace(/\n*\s*#[^\n]*\s*$/, '').trim();
};

export const mergeWorkspaceAgentStabilityPrompt = (
  systemPrompt: string,
  stabilityDraft: WorkspaceAgentStabilityDraft,
): string => {
  const customPromptPrefix = getWorkspaceAgentCustomPromptPrefix(systemPrompt);
  const stabilityPrompt = buildWorkspaceAgentStabilityPrompt(stabilityDraft);
  return customPromptPrefix ? [customPromptPrefix, stabilityPrompt].join('\n\n') : stabilityPrompt;
};

export const buildWorkspaceAgentCalibrationRequest = ({
  agentId,
  draft,
  example,
}: {
  agentId?: string;
  draft: WorkspaceAgentOverrideDraft;
  example: WorkspaceAgentCalibrationExampleDraft;
}): EnterpriseLeadWorkspaceAgentCalibrationRequest => ({
  ...(agentId ? { agentId } : {}),
  agent: {
    name: draft.name.trim(),
    description: draft.description.trim(),
    identity: draft.identity.trim(),
    systemPrompt: ensureWorkspaceAgentStabilityPrompt(
      draft.systemPrompt,
      createWorkspaceAgentStabilityDraft({
        agentId,
        name: draft.name,
        description: draft.description,
        identity: draft.identity,
        systemPrompt: draft.systemPrompt,
      }),
    ),
    icon: draft.icon.trim(),
    model: draft.model.trim(),
    skillIds: [],
  },
  example: {
    sampleInput: example.sampleInput.trim(),
    expectedPriority: example.expectedPriority.trim(),
    expectedReason: example.expectedReason.trim(),
    expectedMissing: example.expectedMissing.trim(),
    expectedNextStep: example.expectedNextStep.trim(),
  },
});

const ensureWorkspaceAgentStabilityPrompt = (
  systemPrompt: string,
  fallbackDraft: WorkspaceAgentStabilityDraft = createDefaultWorkspaceAgentStabilityDraft(),
): string => {
  const trimmedPrompt = systemPrompt.trim();
  if (hasWorkspaceAgentStabilityPrompt(trimmedPrompt)) {
    return trimmedPrompt;
  }

  return mergeWorkspaceAgentStabilityPrompt(
    trimmedPrompt,
    parseWorkspaceAgentStabilityDraft(trimmedPrompt, fallbackDraft),
  );
};

export const WorkspaceAgentEditorDialog: React.FC<WorkspaceAgentEditorDialogProps> = ({
  workspaceId,
  agentId,
  draft,
  saveState,
  titleKey = 'enterpriseLeadWorkbenchOverrideTitle',
  descriptionKey = 'enterpriseLeadWorkbenchOverrideDesc',
  saveLabelKey = 'save',
  saveDisabled = false,
  manualExecutionRequired = false,
  validationErrors = [],
  feedbackLabelKey = '',
  onDraftChange,
  onCancel,
  onSave,
}) => {
  const [calibrationRuns, setCalibrationRuns] = useState<
    Record<string, WorkspaceAgentCalibrationRunState>
  >({});
  const roleStabilityDraft = useMemo(
    () =>
      createWorkspaceAgentStabilityDraft({
        agentId,
        name: draft.name,
        description: draft.description,
        identity: draft.identity,
        systemPrompt: draft.systemPrompt,
      }),
    [agentId, draft.name, draft.description, draft.identity, draft.systemPrompt],
  );
  const stabilityDraft = useMemo(
    () =>
      parseWorkspaceAgentStabilityDraft(
        draft.systemPrompt,
        manualExecutionRequired ? createEmptyWorkspaceAgentStabilityDraft() : roleStabilityDraft,
      ),
    [draft.systemPrompt, manualExecutionRequired, roleStabilityDraft],
  );
  const hasValidationError = (error: WorkspaceAgentDraftValidationError): boolean =>
    validationErrors.includes(error);
  const validationMessageClassName = 'mt-1 text-xs leading-5 text-red-600 dark:text-red-300';
  const commitStabilityDraft = (nextDraft: WorkspaceAgentStabilityDraft): void => {
    onDraftChange(
      'systemPrompt',
      mergeWorkspaceAgentStabilityPrompt(draft.systemPrompt, nextDraft),
    );
  };
  const runtimePromptPreview = useMemo(
    () => mergeWorkspaceAgentStabilityPrompt(draft.systemPrompt, stabilityDraft),
    [draft.systemPrompt, stabilityDraft],
  );
  const resetStabilityDraftToRoleDefault = (): void => {
    setCalibrationRuns({});
    commitStabilityDraft(roleStabilityDraft);
  };
  const updateStabilityRule = (field: WorkspaceAgentStabilityRuleField, value: string): void => {
    commitStabilityDraft({
      ...stabilityDraft,
      rules: {
        ...stabilityDraft.rules,
        [field]: value,
      },
    });
  };
  const updateCalibrationExample = (
    exampleId: string,
    field: keyof Omit<WorkspaceAgentCalibrationExampleDraft, 'id'>,
    value: string,
  ): void => {
    commitStabilityDraft({
      ...stabilityDraft,
      examples: stabilityDraft.examples.map(example =>
        example.id === exampleId
          ? {
              ...example,
              [field]: value,
            }
          : example,
      ),
    });
  };
  const runCalibrationExample = async (
    exampleDraft: WorkspaceAgentCalibrationExampleDraft,
  ): Promise<void> => {
    if (!workspaceId || !draft.name.trim()) {
      setCalibrationRuns(previous => ({
        ...previous,
        [exampleDraft.id]: { status: 'error' },
      }));
      return;
    }

    const request = buildWorkspaceAgentCalibrationRequest({
      agentId,
      draft,
      example: exampleDraft,
    });
    setCalibrationRuns(previous => ({
      ...previous,
      [exampleDraft.id]: { status: 'running' },
    }));

    try {
      const response = await enterpriseLeadWorkspaceService.testWorkspaceAgent(
        workspaceId,
        request,
      );
      setCalibrationRuns(previous => ({
        ...previous,
        [exampleDraft.id]: response ? { status: 'success', response } : { status: 'error' },
      }));
    } catch {
      setCalibrationRuns(previous => ({
        ...previous,
        [exampleDraft.id]: { status: 'error' },
      }));
    }
  };
  const renderEditorField = ({
    field,
    labelKey,
    multiline,
    large,
    className,
  }: WorkspaceAgentEditorField): React.ReactElement => (
    <label key={field} className={className ?? ''}>
      <span className="text-xs font-medium text-secondary">{i18nService.t(labelKey)}</span>
      {multiline ? (
        <textarea
          value={draft[field]}
          onChange={event => onDraftChange(field, event.target.value)}
          rows={large ? 7 : 3}
          className={`mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 ${
            large ? 'font-mono leading-6' : ''
          }`}
        />
      ) : (
        <input
          value={draft[field]}
          onChange={event => onDraftChange(field, event.target.value)}
          className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20"
        />
      )}
      {field === 'name' && hasValidationError('name') ? (
        <p className={validationMessageClassName}>
          {i18nService.t('enterpriseLeadWorkbenchAgentNameRequired')}
        </p>
      ) : null}
    </label>
  );
  const renderStabilityRuleField = (spec: WorkspaceAgentStabilityRuleSpec): React.ReactElement => (
    <div
      key={spec.field}
      className="grid gap-2 border-t border-border-subtle pt-3 first:border-t-0 first:pt-0 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-4"
    >
      <div>
        <label
          htmlFor={`workspace-agent-stability-${spec.field}`}
          className="text-sm font-semibold text-foreground"
        >
          {i18nService.t(spec.labelKey)}
        </label>
        <p className="mt-1 text-xs leading-5 text-secondary">{i18nService.t(spec.hintKey)}</p>
      </div>
      <textarea
        id={`workspace-agent-stability-${spec.field}`}
        value={stabilityDraft.rules[spec.field]}
        onChange={event => updateStabilityRule(spec.field, event.target.value)}
        rows={spec.rows ?? 3}
        className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
  const renderCalibrationRunResult = (
    runState: WorkspaceAgentCalibrationRunState | undefined,
  ): React.ReactElement | null => {
    if (!runState) {
      return null;
    }

    if (runState.status === 'running') {
      return (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs leading-5 text-primary">
          {i18nService.t('enterpriseLeadWorkbenchCalibrationRunning')}
        </div>
      );
    }

    if (runState.status === 'error' || !runState.response) {
      return (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs leading-5 text-red-600 dark:text-red-300">
          {i18nService.t('enterpriseLeadWorkbenchCalibrationFailed')}
        </div>
      );
    }

    const score = getWorkspaceAgentCalibrationScore(runState.response.checks);
    const scoreClassName =
      score.status === 'passed'
        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        : score.status === 'partial'
          ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
          : 'bg-red-500/10 text-red-700 dark:text-red-300';

    return (
      <div className="grid gap-3 rounded-lg border border-border-subtle bg-background p-3">
        <div>
          <h6 className="text-sm font-semibold text-foreground">
            {i18nService.t('enterpriseLeadWorkbenchCalibrationResultTitle')}
          </h6>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs leading-5">
            <span className="font-medium text-foreground">
              {i18nService.t('enterpriseLeadWorkbenchCalibrationScoreTitle')}
            </span>
            <span className={`rounded-full px-2 py-0.5 font-semibold ${scoreClassName}`}>
              {score.passed}/{score.total}
            </span>
            <span className="text-secondary">{i18nService.t(score.labelKey)}</span>
          </div>
          {score.failedCheckIds.length > 0 ? (
            <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
              <span className="font-medium">
                {i18nService.t('enterpriseLeadWorkbenchCalibrationImproveTitle')}
              </span>{' '}
              {score.failedCheckIds
                .map(checkId => i18nService.t(workspaceAgentCalibrationCheckLabelKeys[checkId]))
                .join(i18nService.t('enterpriseLeadWorkbenchCalibrationImproveSeparator'))}
            </div>
          ) : null}
          <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-secondary">
            {runState.response.content}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {runState.response.checks.map(check => (
            <span
              key={check.id}
              className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium ${
                check.passed
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
              }`}
            >
              {i18nService.t(workspaceAgentCalibrationCheckLabelKeys[check.id])}
              {' · '}
              {i18nService.t(
                check.passed
                  ? 'enterpriseLeadWorkbenchCalibrationCheckPassed'
                  : 'enterpriseLeadWorkbenchCalibrationCheckNeedsReview',
              )}
            </span>
          ))}
        </div>
      </div>
    );
  };
  const renderCalibrationExample = (
    spec: WorkspaceAgentCalibrationExampleSpec,
    index: number,
  ): React.ReactElement => {
    const exampleDraft =
      stabilityDraft.examples.find(example => example.id === spec.id) ??
      roleStabilityDraft.examples[index] ??
      createDefaultWorkspaceAgentStabilityDraft().examples[index];
    const checkTexts =
      stabilityDraft.checks?.[spec.id] ?? spec.checkKeys.map(checkKey => i18nService.t(checkKey));
    const runState = calibrationRuns[spec.id];
    const isRunning = runState?.status === 'running';
    return (
      <section
        key={spec.id}
        className="grid gap-3 rounded-lg border border-border-subtle bg-surface/45 p-3"
      >
        <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
            {index + 1}
          </span>
          <div className="min-w-0">
            <h5 className="text-sm font-semibold text-foreground">
              {i18nService.t(spec.titleKey)}
            </h5>
            <p className="mt-1 text-xs leading-5 text-secondary">{i18nService.t(spec.descKey)}</p>
          </div>
        </div>

        <div className="rounded-lg border border-border-subtle bg-background p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h6 className="text-sm font-semibold text-foreground">
              {i18nService.t('enterpriseLeadWorkbenchCalibrationSampleTitle')}
            </h6>
            <span className="text-xs text-secondary">{i18nService.t(spec.sampleHintKey)}</span>
          </div>
          <label>
            <span className="text-xs font-medium text-secondary">
              {i18nService.t('enterpriseLeadWorkbenchCalibrationInputContent')}
            </span>
            <textarea
              value={exampleDraft.sampleInput}
              onChange={event =>
                updateCalibrationExample(spec.id, 'sampleInput', event.target.value)
              }
              rows={4}
              className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <p className="mt-2 text-xs leading-5 text-secondary">
            {i18nService.t(spec.sampleNoteKey)}
          </p>
        </div>

        <div className="rounded-lg border border-border-subtle bg-background p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h6 className="text-sm font-semibold text-foreground">
              {i18nService.t('enterpriseLeadWorkbenchCalibrationExpectedTitle')}
            </h6>
            <span className="text-xs text-secondary">{i18nService.t(spec.expectedHintKey)}</span>
          </div>
          <div className="grid gap-3">
            <label>
              <span className="text-xs font-medium text-secondary">
                {i18nService.t('enterpriseLeadWorkbenchCalibrationExpectedPriority')}
              </span>
              <input
                value={exampleDraft.expectedPriority}
                onChange={event =>
                  updateCalibrationExample(spec.id, 'expectedPriority', event.target.value)
                }
                className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label>
              <span className="text-xs font-medium text-secondary">
                {i18nService.t('enterpriseLeadWorkbenchCalibrationExpectedReason')}
              </span>
              <textarea
                value={exampleDraft.expectedReason}
                onChange={event =>
                  updateCalibrationExample(spec.id, 'expectedReason', event.target.value)
                }
                rows={2}
                className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label>
              <span className="text-xs font-medium text-secondary">
                {i18nService.t('enterpriseLeadWorkbenchCalibrationExpectedMissing')}
              </span>
              <textarea
                value={exampleDraft.expectedMissing}
                onChange={event =>
                  updateCalibrationExample(spec.id, 'expectedMissing', event.target.value)
                }
                rows={2}
                className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label>
              <span className="text-xs font-medium text-secondary">
                {i18nService.t('enterpriseLeadWorkbenchCalibrationExpectedNextStep')}
              </span>
              <textarea
                value={exampleDraft.expectedNextStep}
                onChange={event =>
                  updateCalibrationExample(spec.id, 'expectedNextStep', event.target.value)
                }
                rows={2}
                className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
          </div>
        </div>

        <div className="rounded-lg border border-border-subtle bg-background p-3">
          <h6 className="text-sm font-semibold text-foreground">
            {i18nService.t('enterpriseLeadWorkbenchCalibrationChecksTitle')}
          </h6>
          <div className="mt-3 grid gap-2">
            {checkTexts.map((checkText, checkIndex) => (
              <div
                key={`${spec.id}-${checkIndex}`}
                className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 text-xs leading-5 text-secondary"
              >
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-[11px] font-bold text-emerald-700">
                  {checkIndex + 1}
                </span>
                <span>{checkText}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => commitStabilityDraft(stabilityDraft)}
            className="h-8 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
          >
            {i18nService.t('enterpriseLeadWorkbenchCalibrationSaveExample')}
          </button>
          <button
            type="button"
            onClick={() => void runCalibrationExample(exampleDraft)}
            disabled={isRunning || !draft.name.trim()}
            className="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-white/80 dark:disabled:bg-slate-700"
          >
            {i18nService.t(
              isRunning
                ? 'enterpriseLeadWorkbenchCalibrationRunningShort'
                : 'enterpriseLeadWorkbenchCalibrationRunExample',
            )}
          </button>
        </div>
        {renderCalibrationRunResult(runState)}
      </section>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-agent-editor-title"
    >
      <section className="flex max-h-[calc(100vh-3rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3
              id="workspace-agent-editor-title"
              className="truncate text-base font-semibold text-foreground"
            >
              {i18nService.t(titleKey)}
            </h3>
            <p className="mt-1 text-sm leading-6 text-secondary">{i18nService.t(descriptionKey)}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={i18nService.t('cancel')}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <div className="grid gap-5">
            {workspaceAgentEditorSections.map(section => (
              <section key={section.titleKey}>
                <h4 className="text-sm font-semibold text-foreground">
                  {i18nService.t(section.titleKey)}
                </h4>
                <p className="mt-1 text-xs leading-5 text-secondary">
                  {i18nService.t('enterpriseLeadWorkbenchEditorBasicInfoDesc')}
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {section.fields.map(renderEditorField)}
                </div>
              </section>
            ))}
            <section className="grid gap-3 rounded-lg border border-border bg-surface/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-foreground">
                    {i18nService.t('enterpriseLeadWorkbenchStabilityTitle')}
                  </h4>
                  <p className="mt-1 text-xs leading-5 text-secondary">
                    {i18nService.t('enterpriseLeadWorkbenchStabilityDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetStabilityDraftToRoleDefault}
                  className="h-8 shrink-0 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
                >
                  {i18nService.t('enterpriseLeadWorkbenchStabilityRegenerate')}
                </button>
              </div>
              <div className="grid gap-3">
                {workspaceAgentStabilityRuleSpecs.map(renderStabilityRuleField)}
              </div>
              {hasValidationError('systemPrompt') ? (
                <p className={validationMessageClassName}>
                  {i18nService.t('enterpriseLeadWorkbenchAgentExecutionRequired')}
                </p>
              ) : null}
            </section>

            <details className="rounded-lg border border-border bg-background p-4">
              <summary className="cursor-pointer text-sm font-semibold text-foreground">
                {i18nService.t('enterpriseLeadWorkbenchRuntimePreviewTitle')}
              </summary>
              <p className="mt-2 text-xs leading-5 text-secondary">
                {i18nService.t('enterpriseLeadWorkbenchRuntimePreviewDesc')}
              </p>
              <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-border-subtle bg-surface px-3 py-2 text-xs leading-5 text-secondary">
                {runtimePromptPreview}
              </pre>
            </details>

            <section className="grid gap-3">
              <div>
                <h4 className="text-sm font-semibold text-foreground">
                  {i18nService.t('enterpriseLeadWorkbenchCalibrationTitle')}
                </h4>
                <p className="mt-1 text-xs leading-5 text-secondary">
                  {i18nService.t('enterpriseLeadWorkbenchCalibrationDesc')}
                </p>
              </div>
              <div className="grid gap-3 rounded-lg border border-border bg-background p-3">
                {workspaceAgentCalibrationExampleSpecs.map(renderCalibrationExample)}
              </div>
            </section>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
          <p
            className={`text-xs leading-5 ${
              saveState === 'error' || validationErrors.length > 0
                ? 'text-red-600 dark:text-red-300'
                : 'text-secondary'
            }`}
          >
            {validationErrors.length > 0
              ? i18nService.t('enterpriseLeadWorkbenchAgentValidationFailed')
              : feedbackLabelKey
                ? i18nService.t(feedbackLabelKey)
                : saveState === 'error'
                  ? i18nService.t('enterpriseLeadWorkbenchSaveFailedDraftKept')
                  : i18nService.t('enterpriseLeadWorkbenchRuntimeEffectNotice')}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
            >
              {i18nService.t('cancel')}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saveState === 'saving' || saveDisabled}
              className="h-9 rounded-lg bg-primary px-3 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-white/80 dark:disabled:bg-slate-700"
            >
              {saveState === 'saving' ? i18nService.t('saving') : i18nService.t(saveLabelKey)}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

interface WorkspaceAgentActionsMenuProps {
  agentId: string;
  enabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  confirmingRemove?: boolean;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRequestRemove?: () => void;
  onCancelRemove?: () => void;
  onRemove: () => void;
}

const workspaceAgentActionsMenuWidth = 160;
const workspaceAgentActionsMenuDefaultHeight = 132;
const workspaceAgentActionsMenuGap = 8;
const workspaceAgentActionsMenuViewportMargin = 12;

interface WorkspaceAgentActionsMenuPositionInput {
  anchorRect: Pick<DOMRect, 'top' | 'bottom' | 'right'>;
  menuWidth?: number;
  menuHeight?: number;
  viewportWidth?: number;
  viewportHeight?: number;
}

export const getWorkspaceAgentActionsMenuPosition = ({
  anchorRect,
  menuWidth = workspaceAgentActionsMenuWidth,
  menuHeight = workspaceAgentActionsMenuDefaultHeight,
  viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth,
  viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight,
}: WorkspaceAgentActionsMenuPositionInput): { left: number; top: number } => {
  const maxLeft = Math.max(
    workspaceAgentActionsMenuViewportMargin,
    viewportWidth - menuWidth - workspaceAgentActionsMenuViewportMargin,
  );
  const left = Math.min(
    Math.max(anchorRect.right - menuWidth, workspaceAgentActionsMenuViewportMargin),
    maxLeft,
  );
  const availableBelow =
    viewportHeight -
    anchorRect.bottom -
    workspaceAgentActionsMenuGap -
    workspaceAgentActionsMenuViewportMargin;
  const availableAbove =
    anchorRect.top - workspaceAgentActionsMenuGap - workspaceAgentActionsMenuViewportMargin;
  const shouldOpenAbove = menuHeight > availableBelow && availableAbove > availableBelow;
  const preferredTop = shouldOpenAbove
    ? anchorRect.top - menuHeight - workspaceAgentActionsMenuGap
    : anchorRect.bottom + workspaceAgentActionsMenuGap;
  const maxTop = Math.max(
    workspaceAgentActionsMenuViewportMargin,
    viewportHeight - menuHeight - workspaceAgentActionsMenuViewportMargin,
  );
  const top = Math.min(Math.max(preferredTop, workspaceAgentActionsMenuViewportMargin), maxTop);

  return { left, top };
};

export const WorkspaceAgentActionsMenu: React.FC<WorkspaceAgentActionsMenuProps> = ({
  enabled,
  canMoveUp,
  canMoveDown,
  confirmingRemove = false,
  onToggle,
  onMoveUp,
  onMoveDown,
  onRequestRemove,
  onCancelRemove,
  onRemove,
}) => {
  const handleRemoveRequest = (): void => {
    if (onRequestRemove) {
      onRequestRemove();
      return;
    }
    onRemove();
  };

  return (
    <div role="menu" className="w-40 rounded-lg border border-border bg-background p-1 shadow-xl">
      <button
        type="button"
        onClick={onToggle}
        role="menuitem"
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
      >
        {enabled ? (
          <NoSymbolIcon className="h-3.5 w-3.5 text-secondary" />
        ) : (
          <CheckCircleIcon className="h-3.5 w-3.5 text-secondary" />
        )}
        {i18nService.t(
          enabled ? 'enterpriseLeadWorkbenchDisableAgent' : 'enterpriseLeadWorkbenchEnableAgent',
        )}
      </button>
      {canMoveUp ? (
        <button
          type="button"
          onClick={onMoveUp}
          role="menuitem"
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
        >
          <ArrowUpIcon className="h-3.5 w-3.5 text-secondary" />
          {i18nService.t('enterpriseLeadWorkbenchMoveAgentUp')}
        </button>
      ) : null}
      {canMoveDown ? (
        <button
          type="button"
          onClick={onMoveDown}
          role="menuitem"
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
        >
          <ArrowDownIcon className="h-3.5 w-3.5 text-secondary" />
          {i18nService.t('enterpriseLeadWorkbenchMoveAgentDown')}
        </button>
      ) : null}
      {confirmingRemove ? (
        <div className="mt-1 border-t border-border/70 pt-1">
          <p className="px-2 py-1 text-xs leading-5 text-red-700 dark:text-red-300">
            {i18nService.t('enterpriseLeadWorkbenchRemoveAgentConfirmShort')}
          </p>
          <div className="flex gap-1 px-1 pb-1">
            <button
              type="button"
              onClick={onRemove}
              className="h-7 flex-1 rounded-md bg-red-600 px-2 text-xs font-medium text-white transition-colors hover:bg-red-700"
            >
              {i18nService.t('enterpriseLeadWorkbenchConfirmRemoveAgent')}
            </button>
            <button
              type="button"
              onClick={onCancelRemove}
              className="h-7 flex-1 rounded-md border border-border px-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
            >
              {i18nService.t('cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleRemoveRequest}
          role="menuitem"
          className="mt-1 flex h-8 w-full items-center gap-2 rounded-md border-t border-border/70 px-2 text-left text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-300"
        >
          <TrashIcon className="h-3.5 w-3.5" />
          {i18nService.t('enterpriseLeadWorkbenchRemoveAgent')}
        </button>
      )}
    </div>
  );
};

interface WorkspaceAgentActionsPopoverProps extends WorkspaceAgentActionsMenuProps {
  anchorElement: HTMLElement | null;
  onClose: () => void;
}

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const WorkspaceAgentActionsPopover: React.FC<WorkspaceAgentActionsPopoverProps> = ({
  anchorElement,
  onClose,
  ...menuProps
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useBrowserLayoutEffect(() => {
    if (!anchorElement || typeof window === 'undefined') {
      return undefined;
    }

    let frameId: number | null = null;
    const updatePosition = (): void => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        setPosition(
          getWorkspaceAgentActionsMenuPosition({
            anchorRect: anchorElement.getBoundingClientRect(),
            menuWidth: menuRef.current?.offsetWidth,
            menuHeight: menuRef.current?.offsetHeight,
          }),
        );
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorElement, menuProps.canMoveDown, menuProps.canMoveUp, menuProps.confirmingRemove]);

  useEffect(() => {
    if (!anchorElement || typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (anchorElement.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [anchorElement, onClose]);

  if (!anchorElement || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      style={{
        left: position?.left ?? 0,
        position: 'fixed',
        top: position?.top ?? 0,
        visibility: position ? 'visible' : 'hidden',
        zIndex: 60,
      }}
    >
      <WorkspaceAgentActionsMenu {...menuProps} />
    </div>,
    document.body,
  );
};

export const buildWorkspaceAgentOverrides = (
  draft: WorkspaceAgentOverrideDraft,
  options: { agentId?: string } = {},
): EnterpriseLeadWorkspaceAgentOverrides => {
  const overrides: EnterpriseLeadWorkspaceAgentOverrides = {};
  const name = cleanOptionalText(draft.name);
  const description = cleanOptionalText(draft.description);
  const identity = cleanOptionalText(draft.identity);
  const systemPromptInput = cleanOptionalText(draft.systemPrompt);
  const fallbackDraft = createWorkspaceAgentStabilityDraft({
    agentId: options.agentId,
    name: draft.name,
    description: draft.description,
    identity: draft.identity,
    systemPrompt: draft.systemPrompt,
  });
  const systemPrompt = systemPromptInput
    ? cleanOptionalText(ensureWorkspaceAgentStabilityPrompt(systemPromptInput, fallbackDraft))
    : undefined;
  const icon = cleanOptionalText(draft.icon);
  const model = cleanOptionalText(draft.model);

  if (name) overrides.name = name;
  if (description) overrides.description = description;
  if (identity) overrides.identity = identity;
  if (systemPrompt) overrides.systemPrompt = systemPrompt;
  if (icon) overrides.icon = icon;
  if (model) overrides.model = model;

  return overrides;
};

const buildDefaultWorkspaceAgentBindings = (
  roles: readonly string[],
): EnterpriseLeadWorkspaceAgentBinding[] => {
  const normalizedRoles = roles.filter(isEnterpriseLeadAgentRole);
  const defaultRoles =
    normalizedRoles.length > 0 ? normalizedRoles : [...EnterpriseLeadContentAgentRoles];

  return defaultRoles.map((role, order) => {
    const metadata = getAgentRoleLabel(role);
    const description = i18nService.t(metadata.descriptionKey);

    return {
      agentId: role,
      source: EnterpriseLeadWorkspaceAgentSource.SystemTemplate,
      templateId: role,
      enabled: true,
      order,
      overrides: {
        name: i18nService.t(metadata.titleKey),
        description,
        identity: i18nService.t(metadata.titleKey),
        systemPrompt: [
          description,
          `${i18nService.t('enterpriseLeadAgentDefaultInputPrefix')}${i18nService.t(metadata.inputKey)}`,
          `${i18nService.t('enterpriseLeadAgentDefaultOutputPrefix')}${i18nService.t(metadata.outputKey)}`,
        ].join('\n'),
        icon: i18nService.t(metadata.shortLabelKey),
      },
    };
  });
};

const createWorkspaceAgentId = (
  name: string,
  existingAgents: EnterpriseLeadWorkspaceAgentBinding[],
): string => {
  const baseId =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workspace-agent';
  const existingIds = new Set(existingAgents.map(agent => agent.agentId));

  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  while (existingIds.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseId}-${suffix}`;
};

export const createAndBindWorkspaceAgent = async ({
  workspaceId,
  workspaceAgents,
  name,
  description,
  systemPrompt,
  identity,
  model,
  icon,
  isCurrentSave,
  onSaved,
  onError,
  saveInFlightRef,
}: CreateAndBindWorkspaceAgentOptions): Promise<void> => {
  if (saveInFlightRef?.current) {
    return;
  }

  const trimmedName = name.trim();
  if (!trimmedName) {
    onError();
    return;
  }

  if (saveInFlightRef) {
    saveInFlightRef.current = true;
  }

  try {
    const nextBindings = prepareWorkspaceAgentBindings([
      ...workspaceAgents,
      {
        agentId: createWorkspaceAgentId(trimmedName, workspaceAgents),
        source: EnterpriseLeadWorkspaceAgentSource.WorkspaceCreated,
        enabled: true,
        order: workspaceAgents.length,
        overrides: buildWorkspaceAgentOverrides({
          name: trimmedName,
          description,
          identity,
          systemPrompt,
          model,
          icon,
          skillIds: [],
        }),
      },
    ]);
    const updated = await enterpriseLeadWorkspaceService.updateWorkspaceAgents(
      workspaceId,
      nextBindings,
    );

    if (!isCurrentSave()) {
      return;
    }
    if (!updated) {
      onError();
      return;
    }
    onSaved(updated);
  } catch {
    if (isCurrentSave()) {
      onError();
    }
  } finally {
    if (saveInFlightRef && isCurrentSave()) {
      saveInFlightRef.current = false;
    }
  }
};

export const WorkspaceWorkbench: React.FC<WorkspaceWorkbenchProps> = ({
  workspace,
  onWorkspaceUpdated,
}) => {
  const workspaceIdRef = useRef(workspace.id);
  const saveSequenceRef = useRef(0);
  const saveInFlightRef = useRef(false);
  workspaceIdRef.current = workspace.id;
  const availableModels = useSelector((state: RootState) => state.model.availableModels);
  const skills = useSelector((state: RootState) => state.skill.skills);
  const localAgents = useSelector((state: RootState) => state.agent.agents);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [overrideDraft, setOverrideDraft] = useState(getOverrideDraft(undefined));
  const [overrideValidationErrors, setOverrideValidationErrors] = useState<
    WorkspaceAgentDraftValidationError[]
  >([]);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [createAgentDraft, setCreateAgentDraft] = useState(emptyWorkspaceAgentDraft);
  const [createAgentValidationErrors, setCreateAgentValidationErrors] = useState<
    WorkspaceAgentDraftValidationError[]
  >([]);
  const [openAgentMenuId, setOpenAgentMenuId] = useState<string | null>(null);
  const [confirmingRemoveAgentId, setConfirmingRemoveAgentId] = useState<string | null>(null);
  const [isAgentLibraryOpen, setIsAgentLibraryOpen] = useState(false);
  const [expandedWorkspaceAgentGroupIds, setExpandedWorkspaceAgentGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [saveState, setSaveState] = useState<WorkspaceWorkbenchSaveState>('idle');
  const [agentOperation, setAgentOperation] = useState<WorkspaceAgentOperation | null>(null);
  const agentMenuButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    setEditingAgentId(null);
    setOverrideDraft(getOverrideDraft(undefined));
    setIsCreatingAgent(false);
    setCreateAgentDraft(emptyWorkspaceAgentDraft());
    setOpenAgentMenuId(null);
    setConfirmingRemoveAgentId(null);
    setIsAgentLibraryOpen(false);
    setExpandedWorkspaceAgentGroupIds(new Set());
    saveInFlightRef.current = false;
    setSaveState('idle');
    setAgentOperation(null);
    setOverrideValidationErrors([]);
    setCreateAgentValidationErrors([]);
  }, [workspace.id]);

  const storedBindings = useMemo(
    () => prepareWorkspaceAgentBindings(workspace.workspaceAgents ?? []),
    [workspace.workspaceAgents],
  );
  const legacyEnabledRoles = useMemo(
    () => workspace.enabledAgentRoles.filter(isEnterpriseLeadAgentRole),
    [workspace.enabledAgentRoles],
  );
  const workspaceAgentBindings = useMemo(
    () =>
      storedBindings.length > 0
        ? storedBindings
        : legacyEnabledRoles.length > 0
          ? prepareWorkspaceAgentBindings(buildDefaultWorkspaceAgentBindings(legacyEnabledRoles))
          : [],
    [legacyEnabledRoles, storedBindings],
  );
  const systemTemplateBindings = useMemo(() => {
    const promotionRoles = getPromotionDepartmentSections().flatMap(section =>
      section.roles.map(role => role.role),
    );
    const seenTemplateIds = new Set<string>();
    const templates = [
      ...buildDefaultWorkspaceAgentBindings(EnterpriseLeadContentAgentRoles),
      ...buildDefaultWorkspaceAgentBindings(promotionRoles),
    ].filter(binding => {
      const templateId = binding.templateId ?? binding.agentId;
      if (seenTemplateIds.has(templateId)) {
        return false;
      }
      seenTemplateIds.add(templateId);
      return true;
    });

    return prepareWorkspaceAgentBindings(templates);
  }, []);
  const promotionDepartmentSections = useMemo(() => getPromotionDepartmentSections(), []);
  const promotionTemplateBindings = useMemo(
    () =>
      prepareWorkspaceAgentBindings(
        buildDefaultWorkspaceAgentBindings(
          promotionDepartmentSections.flatMap(section => section.roles.map(role => role.role)),
        ),
      ),
    [promotionDepartmentSections],
  );
  const promotionTemplateBindingById = useMemo(
    () => new Map(promotionTemplateBindings.map(binding => [binding.agentId, binding])),
    [promotionTemplateBindings],
  );
  const addedSystemTemplateIds = useMemo(
    () =>
      new Set(
        workspaceAgentBindings
          .filter(binding => binding.source === EnterpriseLeadWorkspaceAgentSource.SystemTemplate)
          .map(binding => binding.templateId ?? binding.agentId),
      ),
    [workspaceAgentBindings],
  );
  const localAgentTemplates = useMemo<WorkspaceAgentTemplate[]>(
    () =>
      localAgents
        .filter(agent => agent.enabled && !agent.isDefault && agent.id !== AgentId.Main)
        .map(agent => ({
          id: agent.id,
          name: agent.name,
          description: agent.description,
          identity: '',
          systemPrompt: '',
          icon: agent.icon,
          model: agent.model,
          enabled: agent.enabled,
        })),
    [localAgents],
  );
  const localAgentTemplateById = useMemo(
    () => new Map(localAgentTemplates.map(agent => [agent.id, agent])),
    [localAgentTemplates],
  );
  const systemTemplateById = useMemo(
    () =>
      new Map(
        systemTemplateBindings.map(binding => {
          const agent = getEffectiveWorkspaceAgent(binding);
          return [
            binding.agentId,
            {
              id: agent.id,
              name: agent.name,
              description: agent.description,
              identity: agent.identity,
              systemPrompt: agent.systemPrompt,
              icon: agent.icon,
              model: agent.model,
              enabled: agent.enabled,
            } satisfies WorkspaceAgentTemplate,
          ];
        }),
      ),
    [systemTemplateBindings],
  );
  const workspaceAgentTemplateById = useMemo(
    () => new Map([...systemTemplateById, ...localAgentTemplateById]),
    [localAgentTemplateById, systemTemplateById],
  );
  const addedAgentIds = useMemo(
    () => new Set(workspaceAgentBindings.map(binding => binding.agentId)),
    [workspaceAgentBindings],
  );
  const availableLocalAgentTemplates = useMemo(
    () => localAgentTemplates.filter(agent => !addedAgentIds.has(agent.id)),
    [addedAgentIds, localAgentTemplates],
  );
  const effectiveWorkspaceAgents = useMemo(
    () =>
      workspaceAgentBindings.map(binding =>
        getEffectiveWorkspaceAgent(binding, workspaceAgentTemplateById.get(binding.agentId)),
      ),
    [workspaceAgentBindings, workspaceAgentTemplateById],
  );
  const effectiveWorkspaceAgentById = useMemo(
    () => new Map(effectiveWorkspaceAgents.map(agent => [agent.id, agent])),
    [effectiveWorkspaceAgents],
  );
  const promotionRoleIds = useMemo(
    () =>
      new Set(promotionDepartmentSections.flatMap(section => section.roles.map(role => role.role))),
    [promotionDepartmentSections],
  );
  const otherWorkspaceAgents = useMemo(
    () => effectiveWorkspaceAgents.filter(agent => !promotionRoleIds.has(agent.id as never)),
    [effectiveWorkspaceAgents, promotionRoleIds],
  );
  const editingBinding = workspaceAgentBindings.find(binding => binding.agentId === editingAgentId);
  const availableModelRefs = useMemo(
    () =>
      new Set(
        availableModels
          .filter(model => model.accessible !== false)
          .map(model => toOpenClawModelRef(model)),
      ),
    [availableModels],
  );
  const enabledSkillIds = useMemo(
    () => new Set(skills.filter(skill => skill.enabled).map(skill => skill.id)),
    [skills],
  );
  const editingBaseAgent = editingBinding
    ? workspaceAgentTemplateById.get(editingBinding.agentId)
    : undefined;

  useEffect(() => {
    if (!editingBinding) {
      setOverrideDraft(getOverrideDraft(undefined));
      setOverrideValidationErrors([]);
      return;
    }
    setOverrideDraft(getOverrideDraft(editingBinding, editingBaseAgent));
    setOverrideValidationErrors([]);
  }, [editingBaseAgent, editingBinding]);

  const saveWorkspaceAgents = async (
    nextBindings: EnterpriseLeadWorkspaceAgentBinding[],
    onSaved?: () => void,
    operation?: WorkspaceAgentOperation,
  ): Promise<void> => {
    await saveWorkbenchWorkspaceAgents({
      workspaceId: workspace.id,
      workspaceAgents: prepareWorkspaceAgentBindings(nextBindings),
      workspaceIdRef,
      saveSequenceRef,
      saveInFlightRef,
      onSaving: () => {
        setAgentOperation(operation ?? null);
        setSaveState('saving');
      },
      onSaved: updated => {
        setSaveState('saved');
        onSaved?.();
        onWorkspaceUpdated?.(updated);
      },
      onError: () => {
        setSaveState('error');
      },
    });
  };

  const createWorkspaceAgent = async (): Promise<void> => {
    if (saveInFlightRef.current) {
      return;
    }

    const validation = validateWorkspaceAgentDraft({
      draft: createAgentDraft,
      source: EnterpriseLeadWorkspaceAgentSource.WorkspaceCreated,
      availableModelRefs,
      enabledSkillIds,
      requireExecutionRules: true,
    });
    if (!validation.valid) {
      setCreateAgentValidationErrors(validation.errors);
      return;
    }
    setCreateAgentValidationErrors([]);

    if (!createAgentDraft.name.trim()) {
      return;
    }

    const saveWorkspaceId = workspace.id;
    const saveSequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = saveSequence;
    setAgentOperation(WorkspaceAgentOperation.Create);
    setSaveState('saving');

    await createAndBindWorkspaceAgent({
      workspaceId: saveWorkspaceId,
      workspaceAgents: workspaceAgentBindings,
      ...createAgentDraft,
      isCurrentSave: () =>
        workspaceIdRef.current === saveWorkspaceId && saveSequenceRef.current === saveSequence,
      onSaved: updated => {
        setSaveState('saved');
        setIsCreatingAgent(false);
        setCreateAgentDraft(emptyWorkspaceAgentDraft());
        onWorkspaceUpdated?.(updated);
      },
      onError: () => {
        setSaveState('error');
      },
      saveInFlightRef,
    });
  };

  const addSystemAgentToWorkspace = (templateId: string): void => {
    const template = systemTemplateBindings.find(binding => binding.agentId === templateId);
    if (!template || addedSystemTemplateIds.has(templateId) || saveInFlightRef.current) {
      return;
    }

    void saveWorkspaceAgents(
      addSystemAgentBindingToWorkspace(workspaceAgentBindings, template),
      undefined,
      WorkspaceAgentOperation.AddTemplate,
    );
  };

  const addPromotionDepartmentTemplateToWorkspace = (): void => {
    if (saveInFlightRef.current) {
      return;
    }

    const nextBindings = addSystemAgentBindingsToWorkspace(
      workspaceAgentBindings,
      promotionTemplateBindings,
    );
    if (nextBindings.length === workspaceAgentBindings.length) {
      return;
    }

    void saveWorkspaceAgents(nextBindings, undefined, WorkspaceAgentOperation.AddTemplate);
  };

  const addLocalAgentToWorkspace = (agentId: string): void => {
    const agent = localAgentTemplateById.get(agentId);
    if (!agent || addedAgentIds.has(agent.id) || saveInFlightRef.current) {
      return;
    }

    void saveWorkspaceAgents(
      addLocalAgentBindingToWorkspace(workspaceAgentBindings, agent),
      undefined,
      WorkspaceAgentOperation.AddLocalAgent,
    );
  };

  const moveWorkspaceAgent = (agentId: string, direction: -1 | 1): void => {
    void saveWorkspaceAgents(
      moveWorkspaceAgentBinding(workspaceAgentBindings, agentId, direction),
      undefined,
      WorkspaceAgentOperation.Reorder,
    );
  };

  const toggleWorkspaceAgent = (agentId: string): void => {
    const targetBinding = workspaceAgentBindings.find(binding => binding.agentId === agentId);
    void saveWorkspaceAgents(
      workspaceAgentBindings.map(binding =>
        binding.agentId === agentId ? { ...binding, enabled: !binding.enabled } : binding,
      ),
      undefined,
      targetBinding?.enabled ? WorkspaceAgentOperation.Disable : WorkspaceAgentOperation.Enable,
    );
  };

  const removeWorkspaceAgent = (agentId: string): void => {
    void saveWorkspaceAgents(
      workspaceAgentBindings.filter(binding => binding.agentId !== agentId),
      () => {
        if (editingAgentId === agentId) {
          setEditingAgentId(null);
        }
      },
      WorkspaceAgentOperation.Remove,
    );
  };

  const saveOverrides = (): void => {
    if (!editingAgentId || !editingBinding) {
      return;
    }

    const validation = validateWorkspaceAgentDraft({
      draft: overrideDraft,
      source: resolveWorkspaceAgentSource(editingBinding, editingBinding.agentId),
      availableModelRefs,
      enabledSkillIds,
    });
    if (!validation.valid) {
      setOverrideValidationErrors(validation.errors);
      return;
    }
    setOverrideValidationErrors([]);

    void saveWorkspaceAgents(
      workspaceAgentBindings.map(binding =>
        binding.agentId === editingAgentId
          ? {
              ...binding,
              overrides: buildWorkspaceAgentOverrides(overrideDraft, { agentId: editingAgentId }),
            }
          : binding,
      ),
      () => {
        setEditingAgentId(null);
      },
      WorkspaceAgentOperation.SaveEdits,
    );
  };

  const getSaveStatusLabel = (): string => {
    const operationLabelKey = getWorkspaceAgentOperationFeedbackLabelKey(agentOperation, saveState);
    if (operationLabelKey) return i18nService.t(operationLabelKey);
    if (saveState === 'saving') return i18nService.t('saving');
    if (saveState === 'saved') return i18nService.t('enterpriseLeadWorkbenchSaved');
    if (saveState === 'error') return i18nService.t('enterpriseLeadWorkbenchSaveFailed');
    return '';
  };

  const agentOperationFeedbackLabelKey = getWorkspaceAgentOperationFeedbackLabelKey(
    agentOperation,
    saveState,
  );

  const openCreateAgentDialog = (): void => {
    setEditingAgentId(null);
    setConfirmingRemoveAgentId(null);
    setOverrideValidationErrors([]);
    setCreateAgentDraft(emptyWorkspaceAgentDraft());
    setCreateAgentValidationErrors([]);
    setIsCreatingAgent(true);
  };

  const closeCreateAgentDialog = (): void => {
    setIsCreatingAgent(false);
    setCreateAgentDraft(emptyWorkspaceAgentDraft());
    setCreateAgentValidationErrors([]);
  };

  const toggleWorkspaceAgentGroup = (groupId: string): void => {
    setExpandedWorkspaceAgentGroupIds(previous => {
      const next = new Set(previous);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const renderWorkspaceAgentRow = (
    agent: ReturnType<typeof getEffectiveWorkspaceAgent>,
    options: { nested?: boolean } = {},
  ) => {
    const agentIndex = effectiveWorkspaceAgents.findIndex(item => item.id === agent.id);
    const agentStatusClassName = agent.enabled
      ? statusBadgeClassNames[EnterpriseLeadWorkbenchStatusTone.Enabled]
      : statusBadgeClassNames[EnterpriseLeadWorkbenchStatusTone.Disabled];
    const fallbackInitial = agent.name.trim().charAt(0).toUpperCase() || '#';
    const avatarLabel = agent.icon.length <= 2 ? agent.icon || fallbackInitial : fallbackInitial;
    const modelLabel = agent.model || i18nService.t('enterpriseLeadWorkbenchAgentDefaultModel');
    const skillCountLabel = i18nService.t('enterpriseLeadWorkbenchAgentInheritedSkills');
    const source =
      workspaceAgentBindings.find(binding => binding.agentId === agent.id)?.source ??
      EnterpriseLeadWorkspaceAgentSource.WorkspaceCreated;
    const sourceLabelKey =
      source === EnterpriseLeadWorkspaceAgentSource.SystemTemplate
        ? 'enterpriseLeadWorkbenchAgentSourceSystemTemplate'
        : source === EnterpriseLeadWorkspaceAgentSource.LocalAgent
          ? 'enterpriseLeadWorkbenchAgentSourceLocalAgent'
          : 'enterpriseLeadWorkbenchAgentSourceWorkspaceCreated';
    const sourceBadgeClassName =
      source === EnterpriseLeadWorkspaceAgentSource.SystemTemplate
        ? 'bg-slate-500/10 text-slate-600 ring-1 ring-slate-500/15 dark:text-slate-300'
        : source === EnterpriseLeadWorkspaceAgentSource.LocalAgent
          ? 'bg-sky-500/10 text-sky-700 ring-1 ring-sky-500/20 dark:text-sky-300'
          : 'bg-primary/10 text-primary ring-1 ring-primary/20';
    const rowClassName = options.nested
      ? 'grid min-h-[76px] grid-cols-[minmax(220px,1.35fr)_minmax(220px,1.2fr)_minmax(160px,0.9fr)_120px_112px] items-center gap-4 border-t border-border/50 bg-surface/35 py-3 pl-14 pr-4'
      : 'grid min-h-[76px] grid-cols-[minmax(220px,1.35fr)_minmax(220px,1.2fr)_minmax(160px,0.9fr)_120px_112px] items-center gap-4 border-t border-border/70 px-4 py-3 first:border-t-0';

    return (
      <div key={agent.id} role="row" className={rowClassName}>
        <div role="cell" className="relative flex min-w-0 items-center gap-3">
          {options.nested ? (
            <>
              <span
                aria-hidden="true"
                className="absolute -left-6 -bottom-3 -top-3 w-px bg-border/70"
              />
              <span aria-hidden="true" className="absolute -left-6 top-1/2 h-px w-4 bg-border/70" />
            </>
          ) : null}
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary ring-1 ring-primary/10">
            {avatarLabel}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">{agent.name}</span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${sourceBadgeClassName}`}
              >
                {i18nService.t(sourceLabelKey)}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-secondary">{agent.id}</p>
          </div>
        </div>
        <div role="cell" className="min-w-0">
          <p className="line-clamp-2 text-sm leading-5 text-secondary">
            {agent.description || i18nService.t('enterpriseLeadWorkbenchNoAgentDescription')}
          </p>
        </div>
        <div role="cell" className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{modelLabel}</p>
          <p className="mt-1 truncate text-xs text-secondary">{skillCountLabel}</p>
        </div>
        <div role="cell">
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${agentStatusClassName}`}
          >
            {i18nService.t(
              agent.enabled
                ? 'enterpriseLeadWorkbenchAgentEnabled'
                : 'enterpriseLeadWorkbenchAgentDisabled',
            )}
          </span>
        </div>
        <div role="cell" className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setConfirmingRemoveAgentId(null);
              setOpenAgentMenuId(null);
              setEditingAgentId(agent.id);
            }}
            className="h-8 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
          >
            {i18nService.t('enterpriseLeadWorkbenchAgentEdit')}
          </button>
          <div className="relative">
            <button
              ref={node => {
                if (node) {
                  agentMenuButtonRefs.current.set(agent.id, node);
                } else {
                  agentMenuButtonRefs.current.delete(agent.id);
                }
              }}
              type="button"
              onClick={() => {
                setConfirmingRemoveAgentId(null);
                setOpenAgentMenuId(openAgentMenuId === agent.id ? null : agent.id);
              }}
              disabled={saveState === 'saving'}
              aria-expanded={openAgentMenuId === agent.id}
              aria-haspopup="menu"
              title={i18nService.t('enterpriseLeadWorkbenchAgentMoreActions')}
              aria-label={i18nService.t('enterpriseLeadWorkbenchAgentMoreActions')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-secondary transition-colors hover:bg-surface-raised hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <EllipsisHorizontalIcon className="h-4 w-4" />
            </button>
            {openAgentMenuId === agent.id ? (
              <WorkspaceAgentActionsPopover
                agentId={agent.id}
                anchorElement={agentMenuButtonRefs.current.get(agent.id) ?? null}
                enabled={agent.enabled}
                canMoveUp={agentIndex > 0}
                canMoveDown={agentIndex >= 0 && agentIndex < effectiveWorkspaceAgents.length - 1}
                confirmingRemove={confirmingRemoveAgentId === agent.id}
                onClose={() => {
                  setOpenAgentMenuId(null);
                  setConfirmingRemoveAgentId(null);
                }}
                onToggle={() => {
                  setOpenAgentMenuId(null);
                  setConfirmingRemoveAgentId(null);
                  toggleWorkspaceAgent(agent.id);
                }}
                onMoveUp={() => {
                  setOpenAgentMenuId(null);
                  setConfirmingRemoveAgentId(null);
                  moveWorkspaceAgent(agent.id, -1);
                }}
                onMoveDown={() => {
                  setOpenAgentMenuId(null);
                  setConfirmingRemoveAgentId(null);
                  moveWorkspaceAgent(agent.id, 1);
                }}
                onRequestRemove={() => {
                  setConfirmingRemoveAgentId(agent.id);
                }}
                onCancelRemove={() => {
                  setConfirmingRemoveAgentId(null);
                }}
                onRemove={() => {
                  setOpenAgentMenuId(null);
                  setConfirmingRemoveAgentId(null);
                  removeWorkspaceAgent(agent.id);
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const renderWorkspaceAgentGroupHeader = (
    key: string,
    title: string,
    options: {
      addedCount?: number;
      summary?: string;
      sourceLabelKey?: string;
      totalCount?: number;
      expanded: boolean;
      onToggle: () => void;
    },
  ) => {
    const complete =
      options.addedCount !== undefined &&
      options.totalCount !== undefined &&
      options.addedCount >= options.totalCount;
    const partial =
      options.addedCount !== undefined &&
      options.totalCount !== undefined &&
      options.addedCount > 0 &&
      options.addedCount < options.totalCount;
    const progressClassName = complete
      ? 'bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300'
      : partial
        ? 'bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-300'
        : 'bg-slate-500/10 text-slate-600 ring-1 ring-slate-500/15 dark:text-slate-300';
    const buttonStateClassName = options.expanded
      ? 'border-primary/20 bg-primary/5'
      : 'border-transparent hover:border-border/80 hover:bg-surface-raised/60';
    const toggleClassName = options.expanded
      ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
      : 'bg-surface-raised text-secondary ring-1 ring-border/70';

    return (
      <div key={key} role="row" className="border-t border-border/70 bg-background px-3 py-2">
        <div role="cell" className="col-span-5">
          <button
            type="button"
            aria-expanded={options.expanded}
            onClick={options.onToggle}
            className={`grid min-h-[58px] w-full grid-cols-[minmax(220px,1.35fr)_minmax(220px,1.2fr)_minmax(160px,0.9fr)_120px_112px] items-center gap-4 rounded-lg border px-3 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 ${buttonStateClassName}`}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${toggleClassName}`}
              >
                {options.expanded ? (
                  <ChevronDownIcon className="h-4 w-4" />
                ) : (
                  <ChevronRightIcon className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {title}
                </span>
                <span className="mt-0.5 block truncate text-xs text-secondary">
                  {options.summary || title}
                </span>
              </span>
            </span>
            <span className="line-clamp-2 text-xs leading-5 text-secondary">
              {options.summary || title}
            </span>
            <span className="truncate text-xs font-medium text-secondary">
              {i18nService.t(options.sourceLabelKey ?? 'enterpriseLeadWorkbenchAgentGroupType')}
            </span>
            <span
              className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ${progressClassName}`}
            >
              {options.addedCount === undefined || options.totalCount === undefined
                ? title
                : i18nService
                    .t('enterpriseLeadWorkbenchAgentGroupProgress')
                    .replace('{added}', String(options.addedCount))
                    .replace('{total}', String(options.totalCount))}
            </span>
            <span className="justify-self-end text-xs font-medium text-primary">
              {options.expanded
                ? i18nService.t('enterpriseLeadWorkbenchAgentGroupCollapse')
                : i18nService.t('enterpriseLeadWorkbenchAgentGroupExpand')}
            </span>
          </button>
        </div>
      </div>
    );
  };

  const renderMissingPromotionAgentRow = (
    binding: EnterpriseLeadWorkspaceAgentBinding,
    options: { nested?: boolean } = {},
  ) => {
    const agent = getEffectiveWorkspaceAgent(binding);
    const templateId = binding.templateId ?? binding.agentId;
    const fallbackInitial = agent.name.trim().charAt(0).toUpperCase() || '#';
    const avatarLabel = agent.icon.length <= 2 ? agent.icon || fallbackInitial : fallbackInitial;
    const rowClassName = options.nested
      ? 'grid min-h-[76px] grid-cols-[minmax(220px,1.35fr)_minmax(220px,1.2fr)_minmax(160px,0.9fr)_120px_112px] items-center gap-4 border-t border-border/50 bg-surface/35 py-3 pl-14 pr-4 opacity-80'
      : 'grid min-h-[76px] grid-cols-[minmax(220px,1.35fr)_minmax(220px,1.2fr)_minmax(160px,0.9fr)_120px_112px] items-center gap-4 border-t border-border/70 px-4 py-3 opacity-80';

    return (
      <div key={`missing-${templateId}`} role="row" className={rowClassName}>
        <div role="cell" className="relative flex min-w-0 items-center gap-3">
          {options.nested ? (
            <>
              <span
                aria-hidden="true"
                className="absolute -left-6 -bottom-3 -top-3 w-px bg-border/70"
              />
              <span aria-hidden="true" className="absolute -left-6 top-1/2 h-px w-4 bg-border/70" />
            </>
          ) : null}
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-500/10 text-sm font-semibold text-slate-500 ring-1 ring-slate-500/15 dark:text-slate-300">
            {avatarLabel}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">{agent.name}</span>
              <span className="shrink-0 rounded-full bg-slate-500/10 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-500/15 dark:text-slate-300">
                {i18nService.t('enterpriseLeadWorkbenchAgentSourceSystemTemplate')}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-secondary">{templateId}</p>
          </div>
        </div>
        <div role="cell" className="min-w-0">
          <p className="line-clamp-2 text-sm leading-5 text-secondary">
            {agent.description || i18nService.t('enterpriseLeadWorkbenchNoAgentDescription')}
          </p>
        </div>
        <div role="cell" className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {i18nService.t('enterpriseLeadWorkbenchAgentDefaultModel')}
          </p>
          <p className="mt-1 truncate text-xs text-secondary">
            {i18nService.t('enterpriseLeadWorkbenchAgentInheritedSkills')}
          </p>
        </div>
        <div role="cell">
          <span className="inline-flex rounded-full bg-slate-500/10 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-500/15 dark:text-slate-300">
            {i18nService.t('enterpriseLeadWorkbenchAgentNotAdded')}
          </span>
        </div>
        <div role="cell" className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => addSystemAgentToWorkspace(templateId)}
            disabled={saveState === 'saving'}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-55"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {i18nService.t('enterpriseLeadWorkbenchAddSystemAgent')}
          </button>
        </div>
      </div>
    );
  };

  const renderPromotionWorkspaceAgentRow = (role: string, options: { nested?: boolean } = {}) => {
    const existingAgent = effectiveWorkspaceAgentById.get(role);
    if (existingAgent) {
      return renderWorkspaceAgentRow(existingAgent, options);
    }

    const template = promotionTemplateBindingById.get(role);
    return template ? renderMissingPromotionAgentRow(template, options) : null;
  };

  const renderSystemTemplateCard = (binding: EnterpriseLeadWorkspaceAgentBinding) => {
    const agent = getEffectiveWorkspaceAgent(binding);
    const templateId = binding.templateId ?? binding.agentId;
    const isAdded = addedSystemTemplateIds.has(templateId);
    const fallbackInitial = agent.name.trim().charAt(0).toUpperCase() || '#';
    const avatarLabel = agent.icon.length <= 2 ? agent.icon || fallbackInitial : fallbackInitial;

    return (
      <div
        key={templateId}
        className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/70 bg-surface px-3 py-2"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-500/10 text-xs font-semibold text-slate-600 ring-1 ring-slate-500/15 dark:text-slate-300">
            {avatarLabel}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">{agent.name}</span>
              <span className="shrink-0 rounded-full bg-slate-500/10 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-500/15 dark:text-slate-300">
                {i18nService.t('enterpriseLeadWorkbenchAgentSourceSystemTemplate')}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-secondary">
              {agent.description || templateId}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => addSystemAgentToWorkspace(templateId)}
          disabled={isAdded || saveState === 'saving'}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-55"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          {i18nService.t(
            isAdded
              ? 'enterpriseLeadWorkbenchSystemAgentAlreadyAdded'
              : 'enterpriseLeadWorkbenchAddSystemAgent',
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-surface-raised px-6 py-5">
      <div className="flex w-full min-w-0 flex-col gap-4">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <h2 className="truncate text-xl font-semibold leading-7 text-foreground">
                  {i18nService.t('enterpriseLeadWorkbenchAgentManagementTitle')}
                </h2>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary ring-1 ring-primary/20">
                  {i18nService
                    .t('enterpriseLeadWorkbenchWorkspaceAgentCount')
                    .replace('{count}', String(workspaceAgentBindings.length))}
                </span>
                {saveState === 'idle' ? null : (
                  <span
                    className={`rounded-md px-2 py-1 text-xs font-medium ${
                      saveState === 'error'
                        ? 'bg-red-500/10 text-red-600 dark:text-red-300'
                        : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    }`}
                  >
                    {getSaveStatusLabel()}
                  </span>
                )}
              </div>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-secondary">
                {i18nService.t('enterpriseLeadWorkbenchAgentManagementDesc')}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={addPromotionDepartmentTemplateToWorkspace}
                disabled={
                  saveState === 'saving' ||
                  promotionTemplateBindings.every(binding =>
                    addedSystemTemplateIds.has(binding.templateId ?? binding.agentId),
                  )
                }
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-55"
              >
                <PlusIcon className="h-4 w-4" />
                {i18nService.t('enterpriseLeadWorkbenchAddPromotionDepartmentTemplate')}
              </button>
              <button
                type="button"
                onClick={() => setIsAgentLibraryOpen(value => !value)}
                aria-expanded={isAgentLibraryOpen}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
              >
                <PlusIcon className="h-4 w-4" />
                {i18nService.t('enterpriseLeadWorkbenchAddFromTemplate')}
              </button>
              <button
                type="button"
                onClick={openCreateAgentDialog}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <PlusIcon className="h-4 w-4" />
                {i18nService.t('enterpriseLeadWorkbenchNewWorkspaceAgent')}
              </button>
            </div>
          </header>

          <div className="min-h-0 overflow-x-auto">
            {workspaceAgentBindings.length === 0 ? (
              <div className="m-5 rounded-lg border border-dashed border-border bg-surface px-4 py-5">
                <h3 className="text-sm font-semibold text-foreground">
                  {i18nService.t('enterpriseLeadWorkbenchNoWorkspaceAgentsTitle')}
                </h3>
                <p className="mt-1 text-sm leading-6 text-secondary">
                  {i18nService.t('enterpriseLeadWorkbenchNoWorkspaceAgentsDesc')}
                </p>
              </div>
            ) : (
              <div role="table" className="min-w-[920px]">
                <div role="rowgroup">
                  <div
                    role="row"
                    className="grid grid-cols-[minmax(220px,1.35fr)_minmax(220px,1.2fr)_minmax(160px,0.9fr)_120px_112px] gap-4 bg-surface px-4 py-2.5"
                  >
                    <div role="columnheader" className="text-xs font-semibold text-secondary">
                      {i18nService.t('enterpriseLeadWorkbenchAgentTableAgent')}
                    </div>
                    <div role="columnheader" className="text-xs font-semibold text-secondary">
                      {i18nService.t('enterpriseLeadWorkbenchAgentTableResponsibility')}
                    </div>
                    <div role="columnheader" className="text-xs font-semibold text-secondary">
                      {i18nService.t('enterpriseLeadWorkbenchAgentTableModelSkills')}
                    </div>
                    <div role="columnheader" className="text-xs font-semibold text-secondary">
                      {i18nService.t('enterpriseLeadWorkbenchAgentTableStatus')}
                    </div>
                    <div
                      role="columnheader"
                      className="text-right text-xs font-semibold text-secondary"
                    >
                      {i18nService.t('enterpriseLeadWorkbenchAgentTableActions')}
                    </div>
                  </div>
                </div>
                <div role="rowgroup" className="divide-y divide-border/70">
                  {promotionDepartmentSections.flatMap(section => {
                    const addedCount = section.roles.filter(role =>
                      effectiveWorkspaceAgentById.has(role.role),
                    ).length;
                    const expanded = expandedWorkspaceAgentGroupIds.has(section.groupId);
                    const summary = i18nService.t(
                      workspaceAgentGroupSummaryLabelKeys[section.groupId],
                    );

                    return [
                      renderWorkspaceAgentGroupHeader(
                        `group-${section.groupId}`,
                        i18nService.t(section.titleKey),
                        {
                          addedCount,
                          summary,
                          totalCount: section.roles.length,
                          expanded,
                          onToggle: () => toggleWorkspaceAgentGroup(section.groupId),
                        },
                      ),
                      ...(expanded
                        ? section.roles.map(role =>
                            renderPromotionWorkspaceAgentRow(role.role, { nested: true }),
                          )
                        : []),
                    ];
                  })}
                  {otherWorkspaceAgents.length > 0
                    ? [
                        renderWorkspaceAgentGroupHeader(
                          'group-other-agents',
                          i18nService.t('enterpriseLeadWorkbenchOtherAgentsTitle'),
                          {
                            addedCount: otherWorkspaceAgents.length,
                            expanded: expandedWorkspaceAgentGroupIds.has('other-agents'),
                            sourceLabelKey: 'enterpriseLeadWorkbenchAgentGroupType',
                            summary: i18nService.t('enterpriseLeadWorkbenchOtherAgentsSummary'),
                            totalCount: otherWorkspaceAgents.length,
                            onToggle: () => toggleWorkspaceAgentGroup('other-agents'),
                          },
                        ),
                        ...(expandedWorkspaceAgentGroupIds.has('other-agents')
                          ? otherWorkspaceAgents.map(agent =>
                              renderWorkspaceAgentRow(agent, { nested: true }),
                            )
                          : []),
                      ]
                    : null}
                </div>
              </div>
            )}
          </div>

          {isAgentLibraryOpen ? (
            <div className="grid gap-4 border-t border-border px-5 py-4">
              <section>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    {i18nService.t('enterpriseLeadWorkbenchLocalAgentsTitle')}
                  </h3>
                  <span className="text-xs text-secondary">
                    {i18nService
                      .t('enterpriseLeadWorkbenchLocalAgentLibrarySummary')
                      .replace('{count}', String(availableLocalAgentTemplates.length))}
                  </span>
                </div>
                {availableLocalAgentTemplates.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-surface px-3 py-3 text-sm text-secondary">
                    {i18nService.t('enterpriseLeadWorkbenchNoAvailableAgents')}
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {availableLocalAgentTemplates.map(agent => {
                      const agentName = agent.name?.trim() || agent.id;
                      const fallbackInitial = agentName.charAt(0).toUpperCase() || '#';
                      const avatarLabel =
                        agent.icon && agent.icon.length <= 2 ? agent.icon : fallbackInitial;

                      return (
                        <div
                          key={agent.id}
                          className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/70 bg-surface px-3 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-xs font-semibold text-sky-700 ring-1 ring-sky-500/20 dark:text-sky-300">
                              {avatarLabel}
                            </div>
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-sm font-medium text-foreground">
                                  {agentName}
                                </span>
                                <span className="shrink-0 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-sky-500/20 dark:text-sky-300">
                                  {i18nService.t('enterpriseLeadWorkbenchAgentSourceLocalAgent')}
                                </span>
                              </div>
                              <p className="mt-1 truncate text-xs text-secondary">
                                {agent.description || agent.id}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => addLocalAgentToWorkspace(agent.id)}
                            disabled={saveState === 'saving'}
                            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            <PlusIcon className="h-3.5 w-3.5" />
                            {i18nService.t('enterpriseLeadWorkbenchAddLocalAgent')}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="border-t border-border/70 pt-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    {i18nService.t('enterpriseLeadWorkbenchSystemAgentsTitle')}
                  </h3>
                  <span className="text-xs text-secondary">
                    {i18nService
                      .t('enterpriseLeadWorkbenchTemplateLibrarySummary')
                      .replace(
                        '{count}',
                        String(
                          Math.max(0, systemTemplateBindings.length - addedSystemTemplateIds.size),
                        ),
                      )}
                  </span>
                </div>
                <div className="grid gap-3">
                  <div className="rounded-lg border border-border/70 bg-background px-3 py-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-foreground">
                        {i18nService.t('enterpriseLeadDepartmentPromotionTitle')}
                      </h4>
                      <button
                        type="button"
                        onClick={addPromotionDepartmentTemplateToWorkspace}
                        disabled={
                          saveState === 'saving' ||
                          promotionTemplateBindings.every(binding =>
                            addedSystemTemplateIds.has(binding.templateId ?? binding.agentId),
                          )
                        }
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        <PlusIcon className="h-3.5 w-3.5" />
                        {i18nService.t('enterpriseLeadWorkbenchAddPromotionDepartmentTemplate')}
                      </button>
                    </div>
                    <div className="grid gap-3">
                      {promotionDepartmentSections.map(section => (
                        <div key={section.groupId} className="grid gap-2">
                          <h5 className="text-xs font-semibold text-secondary">
                            {i18nService.t(section.titleKey)}
                          </h5>
                          <div className="grid gap-2">
                            {section.roles
                              .map(role => promotionTemplateBindingById.get(role.role))
                              .filter((binding): binding is EnterpriseLeadWorkspaceAgentBinding =>
                                Boolean(binding),
                              )
                              .map(binding => renderSystemTemplateCard(binding))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          ) : null}
        </section>

        {editingBinding ? (
          <WorkspaceAgentEditorDialog
            workspaceId={workspace.id}
            agentId={editingAgentId ?? undefined}
            draft={overrideDraft}
            saveState={saveState}
            validationErrors={overrideValidationErrors}
            feedbackLabelKey={
              agentOperation === WorkspaceAgentOperation.SaveEdits
                ? agentOperationFeedbackLabelKey
                : ''
            }
            onCancel={() => {
              setEditingAgentId(null);
              setOverrideValidationErrors([]);
            }}
            onDraftChange={(field, value) => {
              setOverrideValidationErrors([]);
              setOverrideDraft(previous => ({
                ...previous,
                [field]: value,
              }));
            }}
            onSave={saveOverrides}
          />
        ) : null}

        {isCreatingAgent ? (
          <WorkspaceAgentEditorDialog
            workspaceId={workspace.id}
            draft={createAgentDraft}
            saveState={saveState}
            titleKey="enterpriseLeadWorkbenchCreateAgentTitle"
            descriptionKey="enterpriseLeadWorkbenchCreateAgentDesc"
            saveLabelKey="enterpriseLeadWorkbenchCreateAndBindAgent"
            manualExecutionRequired
            validationErrors={createAgentValidationErrors}
            feedbackLabelKey={
              agentOperation === WorkspaceAgentOperation.Create
                ? agentOperationFeedbackLabelKey
                : ''
            }
            onCancel={closeCreateAgentDialog}
            onDraftChange={(field, value) => {
              setCreateAgentValidationErrors([]);
              setCreateAgentDraft(previous => ({
                ...previous,
                [field]: value,
              }));
            }}
            onSave={() => void createWorkspaceAgent()}
          />
        ) : null}
      </div>
    </div>
  );
};

export default WorkspaceWorkbench;
