import { PlusIcon } from '@heroicons/react/24/outline';
import type { ProviderConfig } from '@shared/providers';
import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceSettings,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { normalizeEnterpriseLeadWorkspaceSettings } from '../../../shared/enterpriseLeadWorkspace/validation';
import { configService } from '../../services/config';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import type { RootState } from '../../store';
import { setSkills } from '../../store/slices/skillSlice';
import type { Skill } from '../../types/skill';
import { EnterpriseLeadWorkbenchStatusTone } from './enterpriseLeadWorkspaceUi';

export { getWorkspaceSettingsReadiness } from './workspaceSettingsReadiness';

interface WorkspaceSettingsProps {
  workspace: EnterpriseLeadWorkspace;
  onWorkspaceUpdated?: (workspace: EnterpriseLeadWorkspace) => void;
  onShowSkills?: () => void;
}

const SkillPresetId = {
  AcquisitionContent: 'acquisition_content',
  ResearchAnalysis: 'research_analysis',
  LightweightChat: 'lightweight_chat',
} as const;
type SkillPresetId = (typeof SkillPresetId)[keyof typeof SkillPresetId];

interface SkillPresetDefinition {
  id: SkillPresetId;
  titleKey: string;
  descriptionKey: string;
  skillIds: string[];
}

const skillPresetDefinitions: SkillPresetDefinition[] = [
  {
    id: SkillPresetId.AcquisitionContent,
    titleKey: 'enterpriseLeadWorkbenchSkillPresetAcquisitionContent',
    descriptionKey: 'enterpriseLeadWorkbenchSkillPresetAcquisitionContentDesc',
    skillIds: ['article-writer', 'content-planner', 'web-search', 'xlsx', 'risk-review'],
  },
  {
    id: SkillPresetId.ResearchAnalysis,
    titleKey: 'enterpriseLeadWorkbenchSkillPresetResearchAnalysis',
    descriptionKey: 'enterpriseLeadWorkbenchSkillPresetResearchAnalysisDesc',
    skillIds: ['web-search', 'technology-search', 'xlsx'],
  },
  {
    id: SkillPresetId.LightweightChat,
    titleKey: 'enterpriseLeadWorkbenchSkillPresetLightweightChat',
    descriptionKey: 'enterpriseLeadWorkbenchSkillPresetLightweightChatDesc',
    skillIds: ['docx', 'xlsx'],
  },
];

const statusBadgeClassNames: Record<string, string> = {
  [EnterpriseLeadWorkbenchStatusTone.Enabled]:
    'bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300',
  [EnterpriseLeadWorkbenchStatusTone.Warning]:
    'bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-300',
  [EnterpriseLeadWorkbenchStatusTone.Disabled]:
    'bg-slate-500/10 text-slate-500 ring-1 ring-slate-500/15 dark:text-slate-300',
};

const cloneProviders = (
  providers: Record<string, ProviderConfig> | undefined,
): Record<string, ProviderConfig> =>
  JSON.parse(JSON.stringify(providers ?? {})) as Record<string, ProviderConfig>;

export const buildEnterpriseLeadWorkspaceSettingsFromCurrentConfig =
  (): EnterpriseLeadWorkspaceSettings => {
    const config = configService.getConfig();
    return normalizeEnterpriseLeadWorkspaceSettings({
      model: {
        defaultModel: config.model.defaultModel,
        defaultModelProvider: config.model.defaultModelProvider ?? '',
        providers: cloneProviders(config.providers),
      },
    });
  };

const ensureWorkspaceSettingsHaveProviders = (
  settings: EnterpriseLeadWorkspaceSettings,
): EnterpriseLeadWorkspaceSettings => {
  if (Object.keys(settings.model.providers).length > 0) {
    return settings;
  }
  const initial = buildEnterpriseLeadWorkspaceSettingsFromCurrentConfig();
  return normalizeEnterpriseLeadWorkspaceSettings({
    ...settings,
    model: initial.model,
  });
};

const sortSkillsForWorkspace = (skills: Skill[], selectedSkillIds: string[]): Skill[] => {
  const selected = new Set(selectedSkillIds);
  return [...skills].sort((left, right) => {
    const leftSelected = selected.has(left.id) ? 0 : 1;
    const rightSelected = selected.has(right.id) ? 0 : 1;
    if (leftSelected !== rightSelected) {
      return leftSelected - rightSelected;
    }
    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
};

interface SaveWorkspaceSettingsDraftOptions {
  workspaceId: string;
  draftSettings: EnterpriseLeadWorkspaceSettings;
  onSaved: (workspace: EnterpriseLeadWorkspace) => void;
  onError: () => void;
}

export const saveWorkspaceSettingsDraft = async ({
  workspaceId,
  draftSettings,
  onSaved,
  onError,
}: SaveWorkspaceSettingsDraftOptions): Promise<void> => {
  try {
    const updated = await enterpriseLeadWorkspaceService.updateWorkspaceSettings(workspaceId, {
      settings: draftSettings,
    });
    if (!updated) {
      onError();
      return;
    }
    onSaved({
      ...updated,
      settings: ensureWorkspaceSettingsHaveProviders(updated.settings),
    });
  } catch {
    onError();
  }
};

export const WorkspaceSettings: React.FC<WorkspaceSettingsProps> = ({
  workspace,
  onWorkspaceUpdated,
  onShowSkills,
}) => {
  const dispatch = useDispatch();
  const skills = useSelector((state: RootState) => state.skill.skills);
  const initialSettings = useMemo(
    () => ensureWorkspaceSettingsHaveProviders(workspace.settings),
    [workspace.settings],
  );
  const [draftSettings, setDraftSettings] =
    useState<EnterpriseLeadWorkspaceSettings>(initialSettings);
  const [savedSettings, setSavedSettings] =
    useState<EnterpriseLeadWorkspaceSettings>(initialSettings);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [selectedSkillPresetId, setSelectedSkillPresetId] = useState<SkillPresetId>(
    SkillPresetId.AcquisitionContent,
  );

  useEffect(() => {
    let active = true;
    void skillService
      .loadSkills()
      .then(loadedSkills => {
        if (active) {
          dispatch(setSkills(loadedSkills));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [dispatch]);

  useEffect(() => {
    setDraftSettings(initialSettings);
    setSavedSettings(initialSettings);
    setSaveState('idle');
  }, [initialSettings]);

  const orderedSkills = useMemo(
    () => sortSkillsForWorkspace(skills, draftSettings.skillIds),
    [draftSettings.skillIds, skills],
  );
  const isDirty = JSON.stringify(draftSettings) !== JSON.stringify(savedSettings);
  const canSaveSettings = isDirty && saveState !== 'saving';

  const updateSkillIds = (skillIds: string[]): void => {
    setDraftSettings(previous =>
      normalizeEnterpriseLeadWorkspaceSettings(
        {
          ...previous,
          skillIds,
        },
        previous,
      ),
    );
    if (saveState !== 'saving') {
      setSaveState('idle');
    }
  };

  const toggleSkill = (skillId: string): void => {
    const selected = new Set(draftSettings.skillIds);
    if (selected.has(skillId)) {
      selected.delete(skillId);
    } else {
      selected.add(skillId);
    }
    updateSkillIds(Array.from(selected));
  };

  const selectSkillPreset = (preset: SkillPresetDefinition): void => {
    setSelectedSkillPresetId(preset.id);
    const availableSkillIds = new Set(skills.map(skill => skill.id));
    const presetSkillIds = preset.skillIds.filter(skillId => availableSkillIds.has(skillId));
    updateSkillIds(
      presetSkillIds.length > 0 || skills.length > 0 ? presetSkillIds : preset.skillIds,
    );
  };

  const saveSettings = async (): Promise<void> => {
    if (!canSaveSettings) {
      return;
    }
    setSaveState('saving');
    await saveWorkspaceSettingsDraft({
      workspaceId: workspace.id,
      draftSettings,
      onSaved: updatedWorkspace => {
        const normalizedUpdatedSettings = ensureWorkspaceSettingsHaveProviders(
          updatedWorkspace.settings,
        );
        setDraftSettings(normalizedUpdatedSettings);
        setSavedSettings(normalizedUpdatedSettings);
        setSaveState('saved');
        onWorkspaceUpdated?.({
          ...updatedWorkspace,
          settings: normalizedUpdatedSettings,
        });
      },
      onError: () => {
        setSaveState('error');
      },
    });
  };

  const getSaveStatusLabel = (): string => {
    if (saveState === 'saving') return i18nService.t('saving');
    if (saveState === 'saved') return i18nService.t('saved');
    if (saveState === 'error') return i18nService.t('enterpriseLeadWorkbenchSaveFailed');
    return isDirty
      ? i18nService.t('enterpriseLeadWorkbenchUnsavedChanges')
      : i18nService.t('saved');
  };

  const openGlobalSkillManager = (): void => {
    if (onShowSkills) {
      onShowSkills();
      return;
    }
    window.dispatchEvent(new CustomEvent('app:open-skills'));
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-surface-raised px-6 py-5">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground">
              {i18nService.t('enterpriseLeadWorkbenchNavSettings')}
            </h1>
            <p className="mt-1 text-sm leading-6 text-secondary">
              {i18nService.t('enterpriseLeadWorkspaceSettingsQuickDesc')}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${
              saveState === 'error'
                ? 'bg-red-500/10 text-red-600 dark:text-red-300'
                : isDirty
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            }`}
          >
            {getSaveStatusLabel()}
          </span>
        </div>

        <section className="rounded-lg border border-border bg-background shadow-sm">
          <div className="grid gap-4 border-b border-border px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold leading-6 text-foreground">
                {i18nService.t('enterpriseLeadWorkbenchBasicSkillTitle')}
              </h2>
              <p className="mt-1 text-sm leading-6 text-secondary">
                {i18nService
                  .t('enterpriseLeadWorkbenchBasicSkillDesc')
                  .replace('{count}', String(draftSettings.skillIds.length))}
              </p>
            </div>
            <div className="shrink-0 lg:max-w-[240px] lg:text-right">
              <button
                type="button"
                onClick={openGlobalSkillManager}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
              >
                <PlusIcon className="h-4 w-4" />
                {i18nService.t('enterpriseLeadWorkbenchManageSkills')}
              </button>
              <p className="mt-1 text-xs leading-5 text-secondary">
                {i18nService.t('enterpriseLeadWorkbenchManageSkillsDesc')}
              </p>
            </div>
          </div>

          <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <section className="rounded-lg border border-border bg-surface px-3 py-3">
              <h3 className="text-sm font-semibold text-foreground">
                {i18nService.t('enterpriseLeadWorkbenchQuickSkillPresetTitle')}
              </h3>
              <p className="mt-1 text-xs leading-5 text-secondary">
                {i18nService.t('enterpriseLeadWorkbenchQuickSkillPresetDesc')}
              </p>
              <div className="mt-3 grid gap-2">
                {skillPresetDefinitions.map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={selectedSkillPresetId === preset.id}
                    onClick={() => selectSkillPreset(preset)}
                    className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      selectedSkillPresetId === preset.id
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border bg-background hover:bg-surface-raised'
                    }`}
                  >
                    <strong className="block text-sm text-foreground">
                      {i18nService.t(preset.titleKey)}
                    </strong>
                    <span className="mt-1 block text-xs leading-5 text-secondary">
                      {i18nService.t(preset.descriptionKey)}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-surface px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">
                    {i18nService.t('enterpriseLeadWorkbenchAdvancedSkillsTitle')}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-secondary">
                    {i18nService.t('enterpriseLeadWorkbenchAdvancedSkillsDesc')}
                  </p>
                </div>
                <span className="shrink-0 rounded-lg bg-primary/10 px-3 py-2 text-xs font-medium text-primary ring-1 ring-primary/20">
                  {draftSettings.skillIds.length}/{skills.length}
                </span>
              </div>

              <div className="mt-3 grid max-h-[420px] gap-1.5 overflow-y-auto">
                {orderedSkills.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-secondary">
                    {i18nService.t('enterpriseLeadWorkbenchSkillsEmpty')}
                  </div>
                ) : (
                  orderedSkills.map(skill => {
                    const checked = draftSettings.skillIds.includes(skill.id);
                    return (
                      <label
                        key={skill.id}
                        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border/70 bg-background px-2.5 py-2"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSkill(skill.id)}
                          className="h-4 w-4 accent-primary"
                        />
                        <span className="min-w-0">
                          <strong className="block truncate text-sm text-foreground">
                            {skill.name}
                          </strong>
                          <span className="block truncate text-xs text-secondary">
                            {skill.description}
                          </span>
                        </span>
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-medium ${
                            statusBadgeClassNames[
                              skill.enabled
                                ? EnterpriseLeadWorkbenchStatusTone.Enabled
                                : EnterpriseLeadWorkbenchStatusTone.Disabled
                            ]
                          }`}
                        >
                          {i18nService.t(
                            skill.enabled
                              ? 'enterpriseLeadWorkbenchStatusEnabled'
                              : 'enterpriseLeadWorkbenchStatusDisabled',
                          )}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        </section>

        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">
              {i18nService.t('enterpriseLeadWorkbenchQuickSaveDockTitle')}
            </div>
            <div className="mt-0.5 truncate text-xs leading-5 text-secondary">
              {i18nService.t('enterpriseLeadWorkspaceQuickSaveDockDesc')}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden rounded-md bg-surface px-2 py-1 text-xs font-medium text-secondary sm:inline-flex">
              {getSaveStatusLabel()}
            </span>
            <button
              type="button"
              disabled={!canSaveSettings}
              onClick={() => void saveSettings()}
              className="h-9 rounded-lg bg-primary px-3 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-white/80 dark:disabled:bg-slate-700"
            >
              {saveState === 'saving'
                ? i18nService.t('saving')
                : i18nService.t('enterpriseLeadWorkbenchSaveConfig')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkspaceSettings;
