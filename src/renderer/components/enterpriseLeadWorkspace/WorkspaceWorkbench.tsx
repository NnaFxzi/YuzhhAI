import {
  Cog6ToothIcon,
  EllipsisHorizontalIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadWorkspaceAgentSource,
} from '@shared/enterpriseLeadWorkspace/constants';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
  EnterpriseLeadWorkspaceAgentOverrides,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import type { Model } from '../../store/slices/modelSlice';
import { resolveOpenClawModelRef, toOpenClawModelRef } from '../../utils/openclawModelRef';
import AgentSkillSelector from '../agent/AgentSkillSelector';
import { AgentSkillFilter } from '../agent/agentSkillSelectorUi';
import ModelSelector from '../ModelSelector';
import {
  type EnterpriseLeadWorkbenchMode as EnterpriseLeadWorkbenchModeType,
  EnterpriseLeadWorkbenchStatusTone,
  getAgentRoleLabel,
  getEffectiveWorkspaceAgent,
} from './enterpriseLeadWorkspaceUi';
import { getWorkspaceSettingsReadiness } from './workspaceSettingsReadiness';

export {
  buildEnterpriseLeadWorkspaceSettingsFromCurrentConfig,
} from './WorkspaceSettings';

interface WorkspaceWorkbenchProps {
  workspace: EnterpriseLeadWorkspace;
  initialSnapshot?: EnterpriseLeadWorkspaceSnapshot | null;
  initialMode?: EnterpriseLeadWorkbenchModeType;
  onWorkspaceUpdated?: (workspace: EnterpriseLeadWorkspace) => void;
  onOpenSettings?: () => void;
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

type WorkspaceAgentOverrideDraft = {
  name: string;
  description: string;
  identity: string;
  systemPrompt: string;
  icon: string;
  model: string;
  skillIds: string[];
};

type WorkspaceAgentTextDraftField = Exclude<keyof WorkspaceAgentOverrideDraft, 'skillIds'>;
export type WorkspaceAgentDraftValidationError = 'name' | 'model' | 'skills';

export const validateWorkspaceAgentDraft = ({
  draft,
  source,
  availableModelRefs,
  enabledSkillIds,
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

  const model = draft.model.trim();
  if (model && !availableModelRefs.has(model)) {
    errors.push('model');
  }

  const hasUnavailableSkill = draft.skillIds
    .map(skillId => skillId.trim())
    .filter(Boolean)
    .some(skillId => !enabledSkillIds.has(skillId));
  if (hasUnavailableSkill) {
    errors.push('skills');
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
  onOpenSettings?: () => void;
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
  {
    titleKey: 'enterpriseLeadWorkbenchEditorCapabilities',
    fields: [],
  },
];

const workspaceAgentAdvancedFields: WorkspaceAgentEditorField[] = [
  {
    field: 'identity',
    labelKey: 'enterpriseLeadWorkbenchOverrideIdentity',
    multiline: true,
  },
  {
    field: 'systemPrompt',
    labelKey: 'enterpriseLeadWorkbenchOverrideSystemPrompt',
    multiline: true,
    large: true,
  },
];

export const WorkspaceAgentEditorDialog: React.FC<WorkspaceAgentEditorDialogProps> = ({
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
  onOpenSettings,
  onSave,
}) => {
  const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false);
  const availableModels = useSelector((state: RootState) => state.model.availableModels);
  const skills = useSelector((state: RootState) => state.skill.skills);
  const hasEnabledSkills = useMemo(() => skills.some(skill => skill.enabled), [skills]);
  const selectedModel = useMemo(
    () => resolveOpenClawModelRef(draft.model, availableModels),
    [availableModels, draft.model],
  );
  const handleModelChange = (model: Model | null): void => {
    onDraftChange('model', model ? toOpenClawModelRef(model) : '');
  };
  const hasValidationError = (error: WorkspaceAgentDraftValidationError): boolean =>
    validationErrors.includes(error);
  const validationMessageClassName = 'mt-1 text-xs leading-5 text-red-600 dark:text-red-300';
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
                {section.fields.length > 0 ? (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {section.fields.map(renderEditorField)}
                  </div>
                ) : (
                  <div className="mt-3 grid gap-4">
                    <div>
                      <span className="text-xs font-medium text-secondary">
                        {i18nService.t('enterpriseLeadWorkbenchOverrideModel')}
                      </span>
                      <div className="mt-1 inline-flex min-h-9 max-w-full items-center rounded-lg border border-border bg-background px-2">
                        <ModelSelector
                          value={selectedModel}
                          onChange={handleModelChange}
                          defaultLabel={i18nService.t('enterpriseLeadWorkbenchAgentDefaultModel')}
                          compact
                          portal
                          alignDropdownToTriggerEnd
                        />
                      </div>
                      {hasValidationError('model') ? (
                        <p className={validationMessageClassName}>
                          {i18nService.t('enterpriseLeadWorkbenchAgentModelInvalid')}
                        </p>
                      ) : null}
                    </div>
                    <div className="min-h-0">
                      <span className="text-xs font-medium text-secondary">
                        {i18nService.t('enterpriseLeadWorkbenchOverrideSkillIds')}
                      </span>
                      {hasValidationError('skills') ? (
                        <p className={validationMessageClassName}>
                          {i18nService.t('enterpriseLeadWorkbenchAgentSkillsInvalid')}
                        </p>
                      ) : null}
                      {hasEnabledSkills ? (
                        <div className="mt-2 h-[420px] min-h-0 rounded-xl border border-border bg-background p-3.5">
                          <AgentSkillSelector
                            selectedSkillIds={draft.skillIds}
                            onChange={skillIds => onDraftChange('skillIds', skillIds)}
                            initialFilter={AgentSkillFilter.Recommended}
                          />
                        </div>
                      ) : (
                        <div className="mt-2 rounded-xl border border-dashed border-border bg-surface/45 px-4 py-5">
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-secondary">
                              <Cog6ToothIcon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-foreground">
                                {i18nService.t('enterpriseLeadWorkbenchNoEnabledSkillsTitle')}
                              </div>
                              <p className="mt-1 text-xs leading-5 text-secondary">
                                {i18nService.t('enterpriseLeadWorkbenchNoEnabledSkillsDesc')}
                              </p>
                              {onOpenSettings || draft.skillIds.length > 0 ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {onOpenSettings ? (
                                    <button
                                      type="button"
                                      onClick={onOpenSettings}
                                      aria-label={i18nService.t(
                                        'enterpriseLeadWorkbenchOpenSkillSettingsAria',
                                      )}
                                      className="h-8 rounded-lg border border-primary/30 bg-primary/10 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
                                    >
                                      {i18nService.t(
                                        'enterpriseLeadWorkbenchOpenSettingsForSkills',
                                      )}
                                    </button>
                                  ) : null}
                                  {draft.skillIds.length > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() => onDraftChange('skillIds', [])}
                                      className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
                                    >
                                      {i18nService.t('enterpriseLeadWorkbenchClearSkillLimit')}
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            ))}
            <section className="rounded-lg border border-border bg-surface/40 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-foreground">
                    {i18nService.t('enterpriseLeadWorkbenchEditorAdvanced')}
                  </h4>
                  <p className="mt-1 text-xs leading-5 text-secondary">
                    {i18nService.t('enterpriseLeadWorkbenchEditorAdvancedDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAdvancedSettingsOpen(value => !value)}
                  aria-expanded={isAdvancedSettingsOpen}
                  className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
                >
                  {i18nService.t(
                    isAdvancedSettingsOpen
                      ? 'enterpriseLeadWorkbenchCollapseAdvancedSettings'
                      : 'enterpriseLeadWorkbenchExpandAdvancedSettings',
                  )}
                </button>
              </div>
              {isAdvancedSettingsOpen ? (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {workspaceAgentAdvancedFields.map(renderEditorField)}
                </div>
              ) : null}
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

const buildWorkspaceAgentOverrides = (
  draft: WorkspaceAgentOverrideDraft,
): EnterpriseLeadWorkspaceAgentOverrides => {
  const overrides: EnterpriseLeadWorkspaceAgentOverrides = {};
  const name = cleanOptionalText(draft.name);
  const description = cleanOptionalText(draft.description);
  const identity = cleanOptionalText(draft.identity);
  const systemPrompt = cleanOptionalText(draft.systemPrompt);
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
  roles: EnterpriseLeadWorkspace['enabledAgentRoles'],
): EnterpriseLeadWorkspaceAgentBinding[] => roles
  .filter(isEnterpriseLeadAgentRole)
  .map((role, order) => {
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
  onOpenSettings,
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
        buildDefaultWorkspaceAgentBindings(Object.values(EnterpriseLeadAgentRole)),
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
  const availableSystemTemplateCount = useMemo(
    () =>
      systemTemplateBindings.filter(
        binding => !addedSystemTemplateIds.has(binding.templateId ?? binding.agentId),
      ).length,
    [addedSystemTemplateIds, systemTemplateBindings],
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
  const settingsReadiness = useMemo(
    () => getWorkspaceSettingsReadiness(workspace.settings),
    [workspace.settings],
  );
  const modelReadiness = settingsReadiness.find(item => item.id === 'model')!;
  const researchReadiness = settingsReadiness.find(item => item.id === 'research')!;
  const contentReadiness = settingsReadiness.find(item => item.id === 'content')!;
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

  const openSettingsFromEditingDialog = (): void => {
    setEditingAgentId(null);
    setOverrideValidationErrors([]);
    onOpenSettings?.();
  };

  const openSettingsFromCreateDialog = (): void => {
    closeCreateAgentDialog();
    onOpenSettings?.();
  };

  const configurationItems = [
    {
      id: 'provider',
      labelKey: 'enterpriseLeadWorkbenchStatusModel',
      value: i18nService.t(modelReadiness.statusKey),
      tone: modelReadiness.tone,
    },
    {
      id: 'skills',
      labelKey: 'enterpriseLeadWorkbenchStatusSkills',
      value: i18nService.t('enterpriseLeadWorkbenchAgentSkillCount').replace(
        '{count}',
        String(workspace.settings.skillIds.length),
      ),
      tone: EnterpriseLeadWorkbenchStatusTone.Configured,
    },
    {
      id: 'research',
      labelKey: 'enterpriseLeadWorkbenchStatusResearch',
      value: i18nService.t(researchReadiness.statusKey),
      tone: researchReadiness.tone,
    },
    {
      id: 'platforms',
      labelKey: 'enterpriseLeadWorkbenchStatusPlatforms',
      value: i18nService.t(contentReadiness.statusKey),
      tone: contentReadiness.tone,
    },
  ];

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
                onClick={onOpenSettings}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
              >
                <Cog6ToothIcon className="h-4 w-4" />
                {i18nService.t('enterpriseLeadWorkbenchNavSettings')}
              </button>
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

          <div className="grid border-t border-border lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]">
            <section className="border-b border-border px-5 py-4 lg:border-b-0 lg:border-r">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {i18nService.t('enterpriseLeadWorkbenchCapabilityAuditTitle')}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-secondary">
                    {i18nService.t('enterpriseLeadWorkbenchCapabilityAuditDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="h-8 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
                >
                  {i18nService.t('enterpriseLeadWorkbenchNavSettings')}
                </button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {configurationItems.map(item => (
                  <div
                    key={item.id}
                    className="flex min-w-0 items-center justify-between gap-3 border-t border-border/70 py-2 first:border-t-0"
                  >
                    <span className="min-w-0 truncate text-xs font-medium text-secondary">
                      {i18nService.t(item.labelKey)}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${statusBadgeClassNames[item.tone]}`}
                    >
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {i18nService.t('enterpriseLeadWorkbenchSystemAgentsTitle')}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-secondary">
                    {i18nService.t('enterpriseLeadWorkbenchSystemAgentsDesc')}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-secondary">
                    {i18nService
                      .t('enterpriseLeadWorkbenchTemplateLibrarySummary')
                      .replace('{count}', String(availableSystemTemplateCount))}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsTemplateLibraryOpen(value => !value)}
                  aria-expanded={isTemplateLibraryOpen}
                  className="h-8 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
                >
                  {i18nService.t(
                    isTemplateLibraryOpen
                      ? 'enterpriseLeadWorkbenchCollapseTemplateLibrary'
                      : 'enterpriseLeadWorkbenchExpandTemplateLibrary',
                  )}
                </button>
              </div>

              {isTemplateLibraryOpen ? (
                <div className="mt-3 grid gap-2">
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
          </div>
        </section>

        {editingBinding ? (
          <WorkspaceAgentEditorDialog
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
            onOpenSettings={onOpenSettings ? openSettingsFromEditingDialog : undefined}
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
            onOpenSettings={onOpenSettings ? openSettingsFromCreateDialog : undefined}
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
