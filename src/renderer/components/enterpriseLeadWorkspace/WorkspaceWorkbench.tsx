import {
  EllipsisHorizontalIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadContentAgentRoles,
  EnterpriseLeadWorkspaceAgentCalibrationCheckId,
  EnterpriseLeadWorkspaceAgentSource,
} from '@shared/enterpriseLeadWorkspace/constants';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
  EnterpriseLeadWorkspaceAgentCalibrationRequest,
  EnterpriseLeadWorkspaceAgentCalibrationResponse,
  EnterpriseLeadWorkspaceAgentOverrides,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import { toOpenClawModelRef } from '../../utils/openclawModelRef';
import {
  type EnterpriseLeadWorkbenchMode as EnterpriseLeadWorkbenchModeType,
  EnterpriseLeadWorkbenchStatusTone,
  getAgentRoleLabel,
  getEffectiveWorkspaceAgent,
} from './enterpriseLeadWorkspaceUi';

export {
  buildEnterpriseLeadWorkspaceSettingsFromCurrentConfig,
} from './WorkspaceSettings';

interface WorkspaceWorkbenchProps {
  workspace: EnterpriseLeadWorkspace;
  initialSnapshot?: EnterpriseLeadWorkspaceSnapshot | null;
  initialMode?: EnterpriseLeadWorkbenchModeType;
  onWorkspaceUpdated?: (workspace: EnterpriseLeadWorkspace) => void;
}

export type WorkspaceWorkbenchSaveState = 'idle' | 'saving' | 'saved' | 'error';

export const WorkspaceAgentOperation = {
  AddTemplate: 'add_template',
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

export const getWorkspaceAgentOperationFeedbackLabelKey = (
  operation: WorkspaceAgentOperation | null | undefined,
  saveState: WorkspaceWorkbenchSaveState,
): string => {
  if (!operation || saveState === 'idle') {
    return '';
  }

  return workspaceAgentOperationFeedbackLabelKeys[operation][saveState];
};

const WorkspaceAgentStatusFilter = {
  All: 'all',
  Enabled: 'enabled',
  Disabled: 'disabled',
} as const;
type WorkspaceAgentStatusFilter =
  typeof WorkspaceAgentStatusFilter[keyof typeof WorkspaceAgentStatusFilter];

const WorkspaceAgentModelFilter = {
  All: 'all',
  Default: 'default',
  Custom: 'custom',
} as const;
type WorkspaceAgentModelFilter =
  typeof WorkspaceAgentModelFilter[keyof typeof WorkspaceAgentModelFilter];

const isEnterpriseLeadAgentRole = (role: string): role is EnterpriseLeadAgentRole =>
  Object.values(EnterpriseLeadAgentRole).includes(role as EnterpriseLeadAgentRole);

const resolveWorkspaceAgentSource = (
  binding: EnterpriseLeadWorkspaceAgentBinding,
  agentId: string,
): EnterpriseLeadWorkspaceAgentSource => {
  if (
    binding.source === EnterpriseLeadWorkspaceAgentSource.SystemTemplate ||
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
  skillIds: string[];
  isCurrentSave: () => boolean;
  onSaved: (workspace: EnterpriseLeadWorkspace) => void;
  onError: () => void;
  saveInFlightRef?: { current: boolean };
}

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
      workspaceIdRef.current === workspaceId
      && saveSequenceRef.current === saveSequence,
    onSaved,
    onError,
    saveInFlightRef,
  });
};

export const prepareWorkspaceAgentBindings = (
  bindings: EnterpriseLeadWorkspaceAgentBinding[],
): EnterpriseLeadWorkspaceAgentBinding[] => {
  const lastBindingByAgentId = new Map<string, {
    binding: EnterpriseLeadWorkspaceAgentBinding;
    sourceIndex: number;
  }>();

  bindings.forEach((binding, sourceIndex) => {
    const agentId = binding.agentId.trim();
    if (!agentId) {
      return;
    }

    lastBindingByAgentId.set(agentId, {
      binding: {
        ...binding,
        agentId,
        source: resolveWorkspaceAgentSource(binding, agentId),
        ...(resolveWorkspaceAgentSource(binding, agentId) ===
        EnterpriseLeadWorkspaceAgentSource.SystemTemplate
          ? { templateId: binding.templateId?.trim() || agentId }
          : { templateId: undefined }),
        order: Number.isFinite(binding.order) ? binding.order : sourceIndex,
        overrides: binding.overrides ?? {},
      },
      sourceIndex,
    });
  });

  return Array.from(lastBindingByAgentId.values())
    .sort((a, b) =>
      a.binding.order - b.binding.order
      || a.sourceIndex - b.sourceIndex)
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

const cleanOptionalText = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const cleanSkillIds = (value: string[]): string[] | undefined => {
  const skillIds = value.map(skillId => skillId.trim()).filter(Boolean);
  return skillIds.length > 0 ? skillIds : undefined;
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
export type WorkspaceAgentDraftValidationError = 'name';

export const validateWorkspaceAgentDraft = ({
  draft,
  source,
}: {
  draft: WorkspaceAgentOverrideDraft;
  source: EnterpriseLeadWorkspaceAgentSource;
  availableModelRefs: Set<string>;
  enabledSkillIds: Set<string>;
}): { valid: boolean; errors: WorkspaceAgentDraftValidationError[] } => {
  const errors: WorkspaceAgentDraftValidationError[] = [];
  if (source === EnterpriseLeadWorkspaceAgentSource.WorkspaceCreated && !draft.name.trim()) {
    errors.push('name');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

const getOverrideDraft = (
  binding: EnterpriseLeadWorkspaceAgentBinding | undefined,
): WorkspaceAgentOverrideDraft => ({
  name: binding?.overrides.name ?? '',
  description: binding?.overrides.description ?? '',
  identity: binding?.overrides.identity ?? '',
  systemPrompt: binding?.overrides.systemPrompt ?? '',
  icon: binding?.overrides.icon ?? '',
  model: binding?.overrides.model ?? '',
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

export interface WorkspaceAgentStabilityDraft {
  rules: Record<WorkspaceAgentStabilityRuleField, string>;
  examples: WorkspaceAgentCalibrationExampleDraft[];
}

interface WorkspaceAgentCalibrationRunState {
  status: 'running' | 'success' | 'error';
  response?: EnterpriseLeadWorkspaceAgentCalibrationResponse;
}

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

export const createDefaultWorkspaceAgentStabilityDraft = (): WorkspaceAgentStabilityDraft => ({
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

export const parseWorkspaceAgentStabilityDraft = (
  systemPrompt: string,
): WorkspaceAgentStabilityDraft => {
  const defaults = createDefaultWorkspaceAgentStabilityDraft();
  return {
    rules: workspaceAgentStabilityRuleSpecs.reduce(
      (rules, spec) => ({
        ...rules,
        [spec.field]: readWorkspaceAgentStabilityPromptBlock(
          systemPrompt,
          `rule.${spec.field}`,
          defaults.rules[spec.field],
        ),
      }),
      {} as Record<WorkspaceAgentStabilityRuleField, string>,
    ),
    examples: workspaceAgentCalibrationExampleSpecs.map(spec => {
      const fallback = defaults.examples.find(example => example.id === spec.id)!;
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
};

export const buildWorkspaceAgentStabilityPrompt = (stabilityDraft: WorkspaceAgentStabilityDraft): string =>
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
    systemPrompt: ensureWorkspaceAgentStabilityPrompt(draft.systemPrompt),
    icon: draft.icon.trim(),
    model: draft.model.trim(),
    skillIds: cleanSkillIds(draft.skillIds) ?? [],
  },
  example: {
    sampleInput: example.sampleInput.trim(),
    expectedPriority: example.expectedPriority.trim(),
    expectedReason: example.expectedReason.trim(),
    expectedMissing: example.expectedMissing.trim(),
    expectedNextStep: example.expectedNextStep.trim(),
  },
});

const ensureWorkspaceAgentStabilityPrompt = (systemPrompt: string): string => {
  const trimmedPrompt = systemPrompt.trim();
  if (hasWorkspaceAgentStabilityPrompt(trimmedPrompt)) {
    return trimmedPrompt;
  }

  return mergeWorkspaceAgentStabilityPrompt(
    trimmedPrompt,
    parseWorkspaceAgentStabilityDraft(trimmedPrompt),
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
  validationErrors = [],
  feedbackLabelKey = '',
  onDraftChange,
  onCancel,
  onSave,
}) => {
  const [calibrationRuns, setCalibrationRuns] = useState<
    Record<string, WorkspaceAgentCalibrationRunState>
  >({});
  const stabilityDraft = useMemo(
    () => parseWorkspaceAgentStabilityDraft(draft.systemPrompt),
    [draft.systemPrompt],
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

    return (
      <div className="grid gap-3 rounded-lg border border-border-subtle bg-background p-3">
        <div>
          <h6 className="text-sm font-semibold text-foreground">
            {i18nService.t('enterpriseLeadWorkbenchCalibrationResultTitle')}
          </h6>
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
      createDefaultWorkspaceAgentStabilityDraft().examples[index];
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
            {spec.checkKeys.map((checkKey, checkIndex) => (
              <div
                key={checkKey}
                className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 text-xs leading-5 text-secondary"
              >
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-[11px] font-bold text-emerald-700">
                  {checkIndex + 1}
                </span>
                <span>{i18nService.t(checkKey)}</span>
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
              <div>
                <h4 className="text-sm font-semibold text-foreground">
                  {i18nService.t('enterpriseLeadWorkbenchStabilityTitle')}
                </h4>
                <p className="mt-1 text-xs leading-5 text-secondary">
                  {i18nService.t('enterpriseLeadWorkbenchStabilityDesc')}
                </p>
              </div>
              <div className="grid gap-3">
                {workspaceAgentStabilityRuleSpecs.map(renderStabilityRuleField)}
              </div>
            </section>

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
    <div className="absolute right-0 top-10 z-20 w-52 rounded-lg border border-border bg-background p-1.5 shadow-lg">
      <button
        type="button"
        onClick={onToggle}
        className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
      >
        {i18nService.t(
          enabled ? 'enterpriseLeadWorkbenchDisableAgent' : 'enterpriseLeadWorkbenchEnableAgent',
        )}
      </button>
      <button
        type="button"
        onClick={onMoveUp}
        disabled={!canMoveUp}
        className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-45"
      >
        {i18nService.t('enterpriseLeadWorkbenchMoveAgentUp')}
      </button>
      <button
        type="button"
        onClick={onMoveDown}
        disabled={!canMoveDown}
        className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-45"
      >
        {i18nService.t('enterpriseLeadWorkbenchMoveAgentDown')}
      </button>
      {confirmingRemove ? (
        <div className="mt-1 rounded-md border border-red-500/20 bg-red-500/5 p-2">
          <p className="text-xs leading-5 text-red-700 dark:text-red-300">
            {i18nService.t('enterpriseLeadWorkbenchRemoveAgentConfirmDesc')}
          </p>
          <div className="mt-2 flex gap-2">
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
          className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-300"
        >
          {i18nService.t('enterpriseLeadWorkbenchRemoveAgent')}
        </button>
      )}
    </div>
  );
};

export const buildWorkspaceAgentOverrides = (
  draft: WorkspaceAgentOverrideDraft,
): EnterpriseLeadWorkspaceAgentOverrides => {
  const overrides: EnterpriseLeadWorkspaceAgentOverrides = {};
  const name = cleanOptionalText(draft.name);
  const description = cleanOptionalText(draft.description);
  const identity = cleanOptionalText(draft.identity);
  const systemPrompt = cleanOptionalText(ensureWorkspaceAgentStabilityPrompt(draft.systemPrompt));
  const icon = cleanOptionalText(draft.icon);
  const model = cleanOptionalText(draft.model);
  const skillIds = cleanSkillIds(draft.skillIds);

  if (name) overrides.name = name;
  if (description) overrides.description = description;
  if (identity) overrides.identity = identity;
  if (systemPrompt) overrides.systemPrompt = systemPrompt;
  if (icon) overrides.icon = icon;
  if (model) overrides.model = model;
  if (skillIds) overrides.skillIds = skillIds;

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
        skillIds: [],
      },
    };
  });
};

const createWorkspaceAgentId = (
  name: string,
  existingAgents: EnterpriseLeadWorkspaceAgentBinding[],
): string => {
  const baseId = name
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
  skillIds,
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
          skillIds,
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
  const [agentSearchQuery, setAgentSearchQuery] = useState('');
  const [agentStatusFilter, setAgentStatusFilter] = useState<WorkspaceAgentStatusFilter>(
    WorkspaceAgentStatusFilter.All,
  );
  const [agentModelFilter, setAgentModelFilter] = useState<WorkspaceAgentModelFilter>(
    WorkspaceAgentModelFilter.All,
  );
  const [isTemplateLibraryOpen, setIsTemplateLibraryOpen] = useState(false);
  const [saveState, setSaveState] = useState<WorkspaceWorkbenchSaveState>('idle');
  const [agentOperation, setAgentOperation] = useState<WorkspaceAgentOperation | null>(null);

  useEffect(() => {
    setEditingAgentId(null);
    setOverrideDraft(getOverrideDraft(undefined));
    setIsCreatingAgent(false);
    setCreateAgentDraft(emptyWorkspaceAgentDraft());
    setOpenAgentMenuId(null);
    setConfirmingRemoveAgentId(null);
    setAgentSearchQuery('');
    setAgentStatusFilter(WorkspaceAgentStatusFilter.All);
    setAgentModelFilter(WorkspaceAgentModelFilter.All);
    setIsTemplateLibraryOpen(false);
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
    () => storedBindings.length > 0
      ? storedBindings
      : prepareWorkspaceAgentBindings(buildDefaultWorkspaceAgentBindings(legacyEnabledRoles)),
    [legacyEnabledRoles, storedBindings],
  );
  const systemTemplateBindings = useMemo(
    () =>
      prepareWorkspaceAgentBindings(
        buildDefaultWorkspaceAgentBindings(EnterpriseLeadContentAgentRoles),
      ),
    [],
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
  const effectiveWorkspaceAgents = useMemo(
    () => workspaceAgentBindings.map(binding => getEffectiveWorkspaceAgent(binding)),
    [workspaceAgentBindings],
  );
  const filteredWorkspaceAgents = useMemo(
    () => effectiveWorkspaceAgents.filter(agent => {
      const normalizedSearch = agentSearchQuery.trim().toLowerCase();
      const matchesSearch = !normalizedSearch
        || `${agent.name} ${agent.description} ${agent.model}`.toLowerCase()
          .includes(normalizedSearch);
      const matchesStatus = agentStatusFilter === WorkspaceAgentStatusFilter.All
        || (agentStatusFilter === WorkspaceAgentStatusFilter.Enabled && agent.enabled)
        || (agentStatusFilter === WorkspaceAgentStatusFilter.Disabled && !agent.enabled);
      const hasModelOverride = agent.model.trim().length > 0;
      const matchesModel = agentModelFilter === WorkspaceAgentModelFilter.All
        || (agentModelFilter === WorkspaceAgentModelFilter.Default && !hasModelOverride)
        || (agentModelFilter === WorkspaceAgentModelFilter.Custom && hasModelOverride);

      return matchesSearch && matchesStatus && matchesModel;
    }),
    [agentModelFilter, agentSearchQuery, agentStatusFilter, effectiveWorkspaceAgents],
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

  useEffect(() => {
    if (!editingBinding) {
      setOverrideDraft(getOverrideDraft(undefined));
      setOverrideValidationErrors([]);
      return;
    }
    setOverrideDraft(getOverrideDraft(editingBinding));
    setOverrideValidationErrors([]);
  }, [editingBinding]);

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
        workspaceIdRef.current === saveWorkspaceId
        && saveSequenceRef.current === saveSequence,
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
              overrides: buildWorkspaceAgentOverrides(overrideDraft),
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

  const renderWorkspaceAgentRow = (
    agent: ReturnType<typeof getEffectiveWorkspaceAgent>,
  ) => {
    const agentIndex = effectiveWorkspaceAgents.findIndex(item => item.id === agent.id);
    const agentStatusClassName = agent.enabled
      ? statusBadgeClassNames[EnterpriseLeadWorkbenchStatusTone.Enabled]
      : statusBadgeClassNames[EnterpriseLeadWorkbenchStatusTone.Disabled];
    const fallbackInitial = agent.name.trim().charAt(0).toUpperCase() || '#';
    const avatarLabel = agent.icon.length <= 2 ? agent.icon || fallbackInitial : fallbackInitial;
    const modelLabel = agent.model || i18nService.t('enterpriseLeadWorkbenchAgentDefaultModel');
    const skillCountLabel =
      agent.skillIds.length > 0
        ? i18nService
            .t('enterpriseLeadWorkbenchAgentSkillCount')
            .replace('{count}', String(agent.skillIds.length))
        : i18nService.t('enterpriseLeadWorkbenchAgentInheritedSkills');
    const source =
      workspaceAgentBindings.find(binding => binding.agentId === agent.id)?.source ??
      EnterpriseLeadWorkspaceAgentSource.WorkspaceCreated;
    const sourceLabelKey =
      source === EnterpriseLeadWorkspaceAgentSource.SystemTemplate
        ? 'enterpriseLeadWorkbenchAgentSourceSystemTemplate'
        : 'enterpriseLeadWorkbenchAgentSourceWorkspaceCreated';
    const sourceBadgeClassName =
      source === EnterpriseLeadWorkspaceAgentSource.SystemTemplate
        ? 'bg-slate-500/10 text-slate-600 ring-1 ring-slate-500/15 dark:text-slate-300'
        : 'bg-primary/10 text-primary ring-1 ring-primary/20';

    return (
      <div
        key={agent.id}
        role="row"
        className="grid min-h-[76px] grid-cols-[minmax(220px,1.35fr)_minmax(220px,1.2fr)_minmax(160px,0.9fr)_120px_112px] items-center gap-4 border-t border-border/70 px-4 py-3 first:border-t-0"
      >
        <div role="cell" className="flex min-w-0 items-center gap-3">
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
              type="button"
              onClick={() => {
                setConfirmingRemoveAgentId(null);
                setOpenAgentMenuId(openAgentMenuId === agent.id ? null : agent.id);
              }}
              disabled={saveState === 'saving'}
              title={i18nService.t('enterpriseLeadWorkbenchAgentMoreActions')}
              aria-label={i18nService.t('enterpriseLeadWorkbenchAgentMoreActions')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-secondary transition-colors hover:bg-surface-raised hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <EllipsisHorizontalIcon className="h-4 w-4" />
            </button>
            {openAgentMenuId === agent.id ? (
              <WorkspaceAgentActionsMenu
                agentId={agent.id}
                enabled={agent.enabled}
                canMoveUp={agentIndex > 0}
                canMoveDown={agentIndex >= 0 && agentIndex < effectiveWorkspaceAgents.length - 1}
                confirmingRemove={confirmingRemoveAgentId === agent.id}
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

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-surface-raised px-6 py-5">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
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
                onClick={() => setIsTemplateLibraryOpen(value => !value)}
                aria-expanded={isTemplateLibraryOpen}
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

          <div className="border-b border-border px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {i18nService.t('enterpriseLeadWorkbenchWorkspaceAgentsTitle')}
                </h3>
                <p className="mt-1 text-xs leading-5 text-secondary">
                  {i18nService.t('enterpriseLeadWorkbenchWorkspaceAgentsDesc')}
                </p>
                <p className="mt-2 text-xs font-medium text-primary">
                  {i18nService.t('enterpriseLeadWorkbenchAgentScopeNotice')}
                </p>
                <p className="mt-1 text-xs leading-5 text-secondary">
                  {i18nService.t('enterpriseLeadWorkbenchRuntimeEffectNotice')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={agentSearchQuery}
                  onChange={event => setAgentSearchQuery(event.target.value)}
                  placeholder={i18nService.t('enterpriseLeadWorkbenchAgentSearchPlaceholder')}
                  className="h-9 w-64 max-w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-secondary/70 focus:ring-2 focus:ring-primary/20"
                />
                <select
                  value={agentStatusFilter}
                  onChange={event =>
                    setAgentStatusFilter(event.target.value as WorkspaceAgentStatusFilter)
                  }
                  className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value={WorkspaceAgentStatusFilter.All}>
                    {i18nService.t('enterpriseLeadWorkbenchAgentStatusFilterAll')}
                  </option>
                  <option value={WorkspaceAgentStatusFilter.Enabled}>
                    {i18nService.t('enterpriseLeadWorkbenchAgentStatusFilterEnabled')}
                  </option>
                  <option value={WorkspaceAgentStatusFilter.Disabled}>
                    {i18nService.t('enterpriseLeadWorkbenchAgentStatusFilterDisabled')}
                  </option>
                </select>
                <select
                  value={agentModelFilter}
                  onChange={event =>
                    setAgentModelFilter(event.target.value as WorkspaceAgentModelFilter)
                  }
                  className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value={WorkspaceAgentModelFilter.All}>
                    {i18nService.t('enterpriseLeadWorkbenchAgentModelFilterAll')}
                  </option>
                  <option value={WorkspaceAgentModelFilter.Default}>
                    {i18nService.t('enterpriseLeadWorkbenchAgentModelFilterDefault')}
                  </option>
                  <option value={WorkspaceAgentModelFilter.Custom}>
                    {i18nService.t('enterpriseLeadWorkbenchAgentModelFilterCustom')}
                  </option>
                </select>
              </div>
            </div>
          </div>

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
                  {filteredWorkspaceAgents.length > 0 ? (
                    filteredWorkspaceAgents.map(agent => renderWorkspaceAgentRow(agent))
                  ) : (
                    <div className="px-4 py-8">
                      <h3 className="text-sm font-semibold text-foreground">
                        {i18nService.t('enterpriseLeadWorkbenchNoAgentFilterResultsTitle')}
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-secondary">
                        {i18nService.t('enterpriseLeadWorkbenchNoAgentFilterResultsDesc')}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {isTemplateLibraryOpen ? (
            <div className="grid gap-2 border-t border-border px-5 py-4">
              {systemTemplateBindings.map(binding => {
                const agent = getEffectiveWorkspaceAgent(binding);
                const templateId = binding.templateId ?? binding.agentId;
                const isAdded = addedSystemTemplateIds.has(templateId);
                const fallbackInitial = agent.name.trim().charAt(0).toUpperCase() || '#';
                const avatarLabel =
                  agent.icon.length <= 2 ? agent.icon || fallbackInitial : fallbackInitial;

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
                          <span className="truncate text-sm font-medium text-foreground">
                            {agent.name}
                          </span>
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
              })}
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
