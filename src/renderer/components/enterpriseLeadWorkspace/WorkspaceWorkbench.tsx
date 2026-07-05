import {
  Cog6ToothIcon,
  EllipsisHorizontalIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { EnterpriseLeadAgentRole } from '@shared/enterpriseLeadWorkspace/constants';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
  EnterpriseLeadWorkspaceAgentOverrides,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
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

type WorkspaceWorkbenchSaveState = 'idle' | 'saving' | 'saved' | 'error';

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
  skillIds: string;
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

const cleanOptionalText = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseSkillIds = (value: string): string[] | undefined => {
  const skillIds = value
    .split(',')
    .map(skillId => skillId.trim())
    .filter(Boolean);
  return skillIds.length > 0 ? skillIds : undefined;
};

const getOverrideDraft = (
  binding: EnterpriseLeadWorkspaceAgentBinding | undefined,
): Required<Record<keyof EnterpriseLeadWorkspaceAgentOverrides, string>> => ({
  name: binding?.overrides.name ?? '',
  description: binding?.overrides.description ?? '',
  identity: binding?.overrides.identity ?? '',
  systemPrompt: binding?.overrides.systemPrompt ?? '',
  icon: binding?.overrides.icon ?? '',
  model: binding?.overrides.model ?? '',
  skillIds: binding?.overrides.skillIds?.join(', ') ?? '',
});

type WorkspaceAgentOverrideDraft = ReturnType<typeof getOverrideDraft>;

const emptyWorkspaceAgentDraft = (): WorkspaceAgentOverrideDraft => ({
  name: '',
  description: '',
  systemPrompt: '',
  identity: '',
  model: '',
  icon: '',
  skillIds: '',
});

interface WorkspaceAgentEditorDialogProps {
  draft: WorkspaceAgentOverrideDraft;
  saveState: WorkspaceWorkbenchSaveState;
  titleKey?: string;
  descriptionKey?: string;
  saveLabelKey?: string;
  saveDisabled?: boolean;
  onDraftChange: (field: keyof WorkspaceAgentOverrideDraft, value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

interface WorkspaceAgentEditorField {
  field: keyof WorkspaceAgentOverrideDraft;
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
    titleKey: 'enterpriseLeadWorkbenchEditorExecution',
    fields: [
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
    ],
  },
  {
    titleKey: 'enterpriseLeadWorkbenchEditorCapabilities',
    fields: [
      {
        field: 'model',
        labelKey: 'enterpriseLeadWorkbenchOverrideModel',
      },
      {
        field: 'skillIds',
        labelKey: 'enterpriseLeadWorkbenchOverrideSkillIds',
      },
    ],
  },
];

export const WorkspaceAgentEditorDialog: React.FC<WorkspaceAgentEditorDialogProps> = ({
  draft,
  saveState,
  titleKey = 'enterpriseLeadWorkbenchOverrideTitle',
  descriptionKey = 'enterpriseLeadWorkbenchOverrideDesc',
  saveLabelKey = 'save',
  saveDisabled = false,
  onDraftChange,
  onCancel,
  onSave,
}) => (
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
          <p className="mt-1 text-sm leading-6 text-secondary">
            {i18nService.t(descriptionKey)}
          </p>
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
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {section.fields.map(({
                  field,
                  labelKey,
                  multiline,
                  large,
                  className,
                }) => (
                  <label key={field} className={className ?? ''}>
                    <span className="text-xs font-medium text-secondary">
                      {i18nService.t(labelKey)}
                    </span>
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
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
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
          {saveState === 'saving'
            ? i18nService.t('saving')
            : i18nService.t(saveLabelKey)}
        </button>
      </div>
    </section>
  </div>
);

interface WorkspaceAgentActionsMenuProps {
  agentId: string;
  enabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

export const WorkspaceAgentActionsMenu: React.FC<WorkspaceAgentActionsMenuProps> = ({
  enabled,
  canMoveUp,
  canMoveDown,
  onToggle,
  onMoveUp,
  onMoveDown,
  onRemove,
}) => (
  <div className="absolute right-0 top-10 z-20 w-40 rounded-lg border border-border bg-background p-1.5 shadow-lg">
    <button
      type="button"
      onClick={onToggle}
      className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
    >
      {i18nService.t(enabled
        ? 'enterpriseLeadWorkbenchDisableAgent'
        : 'enterpriseLeadWorkbenchEnableAgent')}
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
    <button
      type="button"
      onClick={onRemove}
      className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-300"
    >
      {i18nService.t('enterpriseLeadWorkbenchRemoveAgent')}
    </button>
  </div>
);

const buildWorkspaceAgentOverrides = (
  draft: Required<Record<keyof EnterpriseLeadWorkspaceAgentOverrides, string>>,
): EnterpriseLeadWorkspaceAgentOverrides => {
  const overrides: EnterpriseLeadWorkspaceAgentOverrides = {};
  const name = cleanOptionalText(draft.name);
  const description = cleanOptionalText(draft.description);
  const identity = cleanOptionalText(draft.identity);
  const systemPrompt = cleanOptionalText(draft.systemPrompt);
  const icon = cleanOptionalText(draft.icon);
  const model = cleanOptionalText(draft.model);
  const skillIds = parseSkillIds(draft.skillIds);

  if (name) overrides.name = name;
  if (description) overrides.description = description;
  if (identity) overrides.identity = identity;
  if (systemPrompt) overrides.systemPrompt = systemPrompt;
  if (icon) overrides.icon = icon;
  if (model) overrides.model = model;
  if (skillIds) overrides.skillIds = skillIds;

  return overrides;
};

const isEnterpriseLeadAgentRole = (role: string): role is EnterpriseLeadAgentRole =>
  Object.values(EnterpriseLeadAgentRole).includes(role as EnterpriseLeadAgentRole);

const buildDefaultWorkspaceAgentBindings = (
  roles: EnterpriseLeadWorkspace['enabledAgentRoles'],
): EnterpriseLeadWorkspaceAgentBinding[] => roles
  .filter(isEnterpriseLeadAgentRole)
  .map((role, order) => {
    const metadata = getAgentRoleLabel(role);
    const description = i18nService.t(metadata.descriptionKey);

    return {
      agentId: role,
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
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [overrideDraft, setOverrideDraft] = useState(getOverrideDraft(undefined));
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [createAgentDraft, setCreateAgentDraft] = useState(emptyWorkspaceAgentDraft);
  const [openAgentMenuId, setOpenAgentMenuId] = useState<string | null>(null);
  const [agentSearchQuery, setAgentSearchQuery] = useState('');
  const [agentStatusFilter, setAgentStatusFilter] = useState<WorkspaceAgentStatusFilter>(
    WorkspaceAgentStatusFilter.All,
  );
  const [agentModelFilter, setAgentModelFilter] = useState<WorkspaceAgentModelFilter>(
    WorkspaceAgentModelFilter.All,
  );
  const [saveState, setSaveState] = useState<WorkspaceWorkbenchSaveState>('idle');

  useEffect(() => {
    setEditingAgentId(null);
    setOverrideDraft(getOverrideDraft(undefined));
    setIsCreatingAgent(false);
    setCreateAgentDraft(emptyWorkspaceAgentDraft());
    setOpenAgentMenuId(null);
    setAgentSearchQuery('');
    setAgentStatusFilter(WorkspaceAgentStatusFilter.All);
    setAgentModelFilter(WorkspaceAgentModelFilter.All);
    saveInFlightRef.current = false;
    setSaveState('idle');
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

  useEffect(() => {
    if (!editingBinding) {
      setOverrideDraft(getOverrideDraft(undefined));
      return;
    }
    setOverrideDraft(getOverrideDraft(editingBinding));
  }, [editingBinding]);

  const saveWorkspaceAgents = async (
    nextBindings: EnterpriseLeadWorkspaceAgentBinding[],
    onSaved?: () => void,
  ): Promise<void> => {
    await saveWorkbenchWorkspaceAgents({
      workspaceId: workspace.id,
      workspaceAgents: prepareWorkspaceAgentBindings(nextBindings),
      workspaceIdRef,
      saveSequenceRef,
      saveInFlightRef,
      onSaving: () => setSaveState('saving'),
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
    if (!createAgentDraft.name.trim() || saveInFlightRef.current) {
      return;
    }

    const saveWorkspaceId = workspace.id;
    const saveSequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = saveSequence;
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

  const moveWorkspaceAgent = (agentId: string, direction: -1 | 1): void => {
    void saveWorkspaceAgents(moveWorkspaceAgentBinding(workspaceAgentBindings, agentId, direction));
  };

  const toggleWorkspaceAgent = (agentId: string): void => {
    void saveWorkspaceAgents(workspaceAgentBindings.map(binding => (
      binding.agentId === agentId
        ? { ...binding, enabled: !binding.enabled }
        : binding
    )));
  };

  const removeWorkspaceAgent = (agentId: string): void => {
    void saveWorkspaceAgents(
      workspaceAgentBindings.filter(binding => binding.agentId !== agentId),
      () => {
        if (editingAgentId === agentId) {
          setEditingAgentId(null);
        }
      },
    );
  };

  const saveOverrides = (): void => {
    if (!editingAgentId) {
      return;
    }

    void saveWorkspaceAgents(
      workspaceAgentBindings.map(binding => (
        binding.agentId === editingAgentId
          ? {
            ...binding,
            overrides: buildWorkspaceAgentOverrides(overrideDraft),
          }
          : binding
      )),
      () => {
        setEditingAgentId(null);
      },
    );
  };

  const getSaveStatusLabel = (): string => {
    if (saveState === 'saving') return i18nService.t('saving');
    if (saveState === 'saved') return i18nService.t('enterpriseLeadWorkbenchSaved');
    if (saveState === 'error') return i18nService.t('enterpriseLeadWorkbenchSaveFailed');
    return '';
  };

  const openCreateAgentDialog = (): void => {
    setEditingAgentId(null);
    setCreateAgentDraft(emptyWorkspaceAgentDraft());
    setIsCreatingAgent(true);
  };

  const closeCreateAgentDialog = (): void => {
    setIsCreatingAgent(false);
    setCreateAgentDraft(emptyWorkspaceAgentDraft());
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
    const skillCountLabel = i18nService.t('enterpriseLeadWorkbenchAgentSkillCount').replace(
      '{count}',
      String(agent.skillIds.length),
    );

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
              <span className="truncate text-sm font-semibold text-foreground">
                {agent.name}
              </span>
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {i18nService.t('enterpriseLeadWorkbenchWorkspaceScoped')}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-secondary">
              {agent.id}
            </p>
          </div>
        </div>
        <div role="cell" className="min-w-0">
          <p className="line-clamp-2 text-sm leading-5 text-secondary">
            {agent.description || i18nService.t('enterpriseLeadWorkbenchNoAgentDescription')}
          </p>
        </div>
        <div role="cell" className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {modelLabel}
          </p>
          <p className="mt-1 truncate text-xs text-secondary">
            {skillCountLabel}
          </p>
        </div>
        <div role="cell">
          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${agentStatusClassName}`}>
            {i18nService.t(agent.enabled
              ? 'enterpriseLeadWorkbenchAgentEnabled'
              : 'enterpriseLeadWorkbenchAgentDisabled')}
          </span>
        </div>
        <div role="cell" className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
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
              onClick={() =>
                setOpenAgentMenuId(openAgentMenuId === agent.id ? null : agent.id)}
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
                onToggle={() => {
                  setOpenAgentMenuId(null);
                  toggleWorkspaceAgent(agent.id);
                }}
                onMoveUp={() => {
                  setOpenAgentMenuId(null);
                  moveWorkspaceAgent(agent.id, -1);
                }}
                onMoveDown={() => {
                  setOpenAgentMenuId(null);
                  moveWorkspaceAgent(agent.id, 1);
                }}
                onRemove={() => {
                  setOpenAgentMenuId(null);
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
                  {i18nService.t('enterpriseLeadWorkbenchWorkspaceAgentCount').replace(
                    '{count}',
                    String(workspaceAgentBindings.length),
                  )}
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
                onClick={openCreateAgentDialog}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <PlusIcon className="h-4 w-4" />
                {i18nService.t('enterpriseLeadWorkbenchCreateAgent')}
              </button>
            </div>
          </header>

          <div className="grid gap-2 border-b border-border bg-surface px-5 py-3 md:grid-cols-4">
            {configurationItems.map(item => (
              <div
                key={item.id}
                className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/70 bg-background px-3 py-2"
              >
                <span className="min-w-0 truncate text-xs font-medium text-secondary">
                  {i18nService.t(item.labelKey)}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${statusBadgeClassNames[item.tone]}`}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>

          <div className="border-b border-border px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-medium text-primary">
                {i18nService.t('enterpriseLeadWorkbenchAgentScopeNotice')}
              </p>
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
                    setAgentStatusFilter(event.target.value as WorkspaceAgentStatusFilter)}
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
                    setAgentModelFilter(event.target.value as WorkspaceAgentModelFilter)}
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
                    <div role="columnheader" className="text-right text-xs font-semibold text-secondary">
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
        </section>

        {editingBinding ? (
          <WorkspaceAgentEditorDialog
            draft={overrideDraft}
            saveState={saveState}
            onCancel={() => setEditingAgentId(null)}
            onDraftChange={(field, value) => setOverrideDraft(previous => ({
              ...previous,
              [field]: value,
            }))}
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
            saveDisabled={!createAgentDraft.name.trim()}
            onCancel={closeCreateAgentDialog}
            onDraftChange={(field, value) => setCreateAgentDraft(previous => ({
              ...previous,
              [field]: value,
            }))}
            onSave={() => void createWorkspaceAgent()}
          />
        ) : null}
      </div>
    </div>
  );
};

export default WorkspaceWorkbench;
