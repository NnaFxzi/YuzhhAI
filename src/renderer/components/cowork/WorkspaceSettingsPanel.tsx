import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  defaultLayeredCoworkSettings,
  InheritSetting,
  type LayeredCoworkSettingsResolution,
  type LayeredCoworkSettingsValues,
  SettingScope,
} from '../../../shared/cowork/layeredSettings';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import type {
  CoworkEffectiveSettings,
  CoworkWorkspaceSettings,
  CoworkWorkspaceSettingsUpdate,
} from '../../types/cowork';

type WorkspaceSettingKey = keyof LayeredCoworkSettingsValues;

type WorkspaceSettingRow = {
  key: WorkspaceSettingKey;
  labelKey: string;
  kind: 'text' | 'boolean' | 'select';
  options?: Array<{ value: LayeredCoworkSettingsValues['executionMode']; labelKey: string }>;
};

type ResolvedWorkspaceSettingRow = WorkspaceSettingRow & {
  hasWorkspaceOverride: boolean;
  source: SettingScope;
  draftValue: string;
  effectiveValue: LayeredCoworkSettingsValues[WorkspaceSettingKey];
};

export interface WorkspaceSettingsPanelProps {
  workspaceId: string;
  workspaceLabel?: string;
  disabledHintKey?: string;
  workspaceSettings?: CoworkWorkspaceSettings | null;
  effectiveSettings?: CoworkEffectiveSettings | null;
}

const settingKeys: WorkspaceSettingKey[] = [
  'workingDirectory',
  'executionMode',
  'memoryEnabled',
  'embeddingEnabled',
  'dreamingEnabled',
  'skillIds',
  'defaultModel',
];

const workspaceRows: WorkspaceSettingRow[] = [
  { key: 'workingDirectory', labelKey: 'workspaceSettingsWorkingDirectory', kind: 'text' },
  {
    key: 'executionMode',
    labelKey: 'workspaceSettingsExecutionMode',
    kind: 'select',
    options: [
      { value: 'local', labelKey: 'workspaceSettingsExecutionLocal' },
      { value: 'sandbox', labelKey: 'workspaceSettingsExecutionSandbox' },
      { value: 'auto', labelKey: 'workspaceSettingsExecutionAuto' },
    ],
  },
  { key: 'memoryEnabled', labelKey: 'workspaceSettingsMemory', kind: 'boolean' },
  { key: 'embeddingEnabled', labelKey: 'workspaceSettingsEmbedding', kind: 'boolean' },
  { key: 'dreamingEnabled', labelKey: 'workspaceSettingsDreaming', kind: 'boolean' },
  { key: 'skillIds', labelKey: 'workspaceSettingsSkills', kind: 'text' },
  { key: 'defaultModel', labelKey: 'workspaceSettingsDefaultModel', kind: 'text' },
];

const buildDefaultEffectiveSettings = (): LayeredCoworkSettingsResolution => ({
  values: { ...defaultLayeredCoworkSettings },
  sources: settingKeys.reduce(
    (sources, key) => {
      sources[key] = SettingScope.Default;
      return sources;
    },
    {} as Record<WorkspaceSettingKey, SettingScope>,
  ),
});

const formatSettingValue = (
  key: WorkspaceSettingKey,
  value: LayeredCoworkSettingsValues[WorkspaceSettingKey],
): string => {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') {
    return value ? i18nService.t('workspaceSettingsOn') : i18nService.t('workspaceSettingsOff');
  }
  if (key === 'executionMode') {
    return i18nService.t(
      `workspaceSettingsExecution${String(value)[0].toUpperCase()}${String(value).slice(1)}`,
    );
  }
  return String(value ?? '');
};

const parseDraftValue = (
  key: WorkspaceSettingKey,
  value: string,
): CoworkWorkspaceSettingsUpdate => {
  if (key === 'skillIds') {
    return {
      skillIds: value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean),
    };
  }
  if (key === 'executionMode') {
    const mode = value === 'auto' || value === 'sandbox' ? value : 'local';
    return { executionMode: mode };
  }
  if (key === 'workingDirectory') return { workingDirectory: value };
  if (key === 'defaultModel') return { defaultModel: value };
  return {};
};

const cloneEffectiveValue = (
  key: WorkspaceSettingKey,
  effectiveSettings: LayeredCoworkSettingsResolution,
): CoworkWorkspaceSettingsUpdate => ({
  [key]: effectiveSettings.values[key],
});

const sourceLabelKey = (scope: SettingScope): string => {
  switch (scope) {
    case SettingScope.Workspace:
      return 'workspaceSettingsSourceWorkspace';
    case SettingScope.Agent:
      return 'workspaceSettingsSourceAgent';
    case SettingScope.Session:
      return 'workspaceSettingsSourceSession';
    case SettingScope.Global:
      return 'workspaceSettingsSourceGlobal';
    case SettingScope.Default:
    default:
      return 'workspaceSettingsSourceDefault';
  }
};

const WorkspaceSettingsPanel: React.FC<WorkspaceSettingsPanelProps> = ({
  workspaceId,
  workspaceLabel,
  disabledHintKey = 'workspaceSettingsDisabledHint',
  workspaceSettings,
  effectiveSettings,
}) => {
  const normalizedWorkspaceId = workspaceId.trim();
  const normalizedWorkspaceLabel = workspaceLabel?.trim() || normalizedWorkspaceId;
  const hasWorkspace = normalizedWorkspaceId.length > 0;
  const [localWorkspaceSettings, setLocalWorkspaceSettings] = useState<CoworkWorkspaceSettings>(
    workspaceSettings ?? {},
  );
  const [localEffectiveSettings, setLocalEffectiveSettings] = useState<CoworkEffectiveSettings>(
    effectiveSettings ?? buildDefaultEffectiveSettings(),
  );
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<WorkspaceSettingKey | null>(null);

  useEffect(() => {
    if (workspaceSettings) {
      setLocalWorkspaceSettings(workspaceSettings);
    }
  }, [workspaceSettings]);

  useEffect(() => {
    if (effectiveSettings) {
      setLocalEffectiveSettings(effectiveSettings);
    }
  }, [effectiveSettings]);

  useEffect(() => {
    let active = true;
    if (!hasWorkspace) {
      setLocalWorkspaceSettings({});
      setDraftValues({});
      return () => {
        active = false;
      };
    }

    void Promise.all([
      coworkService.getWorkspaceSettings(normalizedWorkspaceId),
      coworkService.getEffectiveSettings({ workspaceId: normalizedWorkspaceId }),
    ]).then(([nextWorkspaceSettings, nextEffectiveSettings]) => {
      if (!active) return;
      if (nextWorkspaceSettings) {
        setLocalWorkspaceSettings(nextWorkspaceSettings);
      }
      if (nextEffectiveSettings) {
        setLocalEffectiveSettings(nextEffectiveSettings);
      }
    });

    return () => {
      active = false;
    };
  }, [hasWorkspace, normalizedWorkspaceId]);

  const saveUpdate = useCallback(
    async (key: WorkspaceSettingKey, update: CoworkWorkspaceSettingsUpdate) => {
      if (!hasWorkspace) return;
      setSavingKey(key);
      setLocalWorkspaceSettings(previous => {
        const next = { ...previous };
        const value = update[key];
        if (value === InheritSetting.Value) {
          delete next[key];
        } else if (value !== undefined) {
          next[key] = value as never;
        }
        return next;
      });

      try {
        const saved = await coworkService.setWorkspaceSettings(normalizedWorkspaceId, update);
        if (!saved) return;
        const [nextWorkspaceSettings, nextEffectiveSettings] = await Promise.all([
          coworkService.getWorkspaceSettings(normalizedWorkspaceId),
          coworkService.getEffectiveSettings({ workspaceId: normalizedWorkspaceId }),
        ]);
        if (nextWorkspaceSettings) {
          setLocalWorkspaceSettings(nextWorkspaceSettings);
        }
        if (nextEffectiveSettings) {
          setLocalEffectiveSettings(nextEffectiveSettings);
        }
      } finally {
        setSavingKey(null);
      }
    },
    [hasWorkspace, normalizedWorkspaceId],
  );

  const rows = useMemo<ResolvedWorkspaceSettingRow[]>(
    () =>
      workspaceRows.map(row => {
        const visibleWorkspaceSettings = hasWorkspace ? localWorkspaceSettings : {};
        const overrideValue = visibleWorkspaceSettings[row.key];
        const hasWorkspaceOverride = hasWorkspace && overrideValue !== undefined;
        const effectiveValue = localEffectiveSettings.values[row.key];
        const displayValue = hasWorkspaceOverride ? overrideValue : effectiveValue;
        const draftKey = row.key;
        const draftValue =
          draftValues[draftKey] ?? formatSettingValue(row.key, displayValue as never);

        return {
          ...row,
          hasWorkspaceOverride,
          source: hasWorkspace ? localEffectiveSettings.sources[row.key] : SettingScope.Global,
          draftValue,
          effectiveValue,
        };
      }),
    [draftValues, hasWorkspace, localEffectiveSettings, localWorkspaceSettings],
  );

  const renderValueControl = (row: ResolvedWorkspaceSettingRow) => {
    const disabled = !hasWorkspace || !row.hasWorkspaceOverride || savingKey === row.key;
    if (row.kind === 'boolean') {
      const currentValue = localWorkspaceSettings[row.key] ?? row.effectiveValue;
      return (
        <div className="flex items-center gap-1">
          {[true, false].map(value => (
            <button
              key={String(value)}
              type="button"
              disabled={disabled}
              onClick={() => {
                void saveUpdate(row.key, { [row.key]: value });
              }}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                currentValue === value
                  ? 'border-primary bg-primary-muted text-primary'
                  : 'border-border text-secondary hover:bg-surface-raised'
              } disabled:opacity-50`}
            >
              {i18nService.t(value ? 'workspaceSettingsOn' : 'workspaceSettingsOff')}
            </button>
          ))}
        </div>
      );
    }

    if (row.kind === 'select') {
      return (
        <select
          value={
            row.hasWorkspaceOverride
              ? String(localWorkspaceSettings[row.key] ?? 'local')
              : String(row.effectiveValue)
          }
          disabled={disabled}
          onChange={event => {
            void saveUpdate(row.key, parseDraftValue(row.key, event.target.value));
          }}
          className="h-8 min-w-[132px] rounded-md border border-border bg-surface px-2 text-xs text-foreground disabled:opacity-50"
        >
          {row.options?.map(option => (
            <option key={option.value} value={option.value}>
              {i18nService.t(option.labelKey)}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        value={row.draftValue}
        disabled={disabled}
        onChange={event => {
          setDraftValues(previous => ({
            ...previous,
            [row.key]: event.target.value,
          }));
        }}
        onBlur={event => {
          if (!hasWorkspace || !row.hasWorkspaceOverride) return;
          void saveUpdate(row.key, parseDraftValue(row.key, event.target.value));
        }}
        className="h-8 w-full min-w-0 rounded-md border border-border bg-surface px-2 text-xs text-foreground disabled:opacity-60"
      />
    );
  };

  return (
    <section className="rounded-lg border border-border bg-surface px-4 py-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-foreground">
            {i18nService.t('workspaceSettingsTitle')}
          </h4>
          <div className="mt-1 text-xs text-secondary">
            {i18nService.t('workspaceSettingsCurrentWorkspace')}:{' '}
            {normalizedWorkspaceLabel || i18nService.t('workspaceSettingsNoWorkspace')}
          </div>
          {!hasWorkspace && (
            <div className="mt-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-xs text-secondary">
              {i18nService.t(disabledHintKey)}
            </div>
          )}
        </div>
        <span className="rounded-md border border-border px-2 py-1 text-xs text-secondary">
          {i18nService.t('workspaceSettingsNoSecrets')}
        </span>
      </div>

      <div className="divide-y divide-border">
        {rows.map(row => (
          <div
            key={row.key}
            className="grid grid-cols-[minmax(96px,160px)_1fr_auto] items-center gap-3 py-3"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                {i18nService.t(row.labelKey)}
              </div>
              <div className="mt-1 inline-flex rounded-md bg-surface-raised px-2 py-0.5 text-[11px] text-secondary">
                {i18nService.t(sourceLabelKey(row.source))}
              </div>
            </div>

            <div className="min-w-0">{renderValueControl(row)}</div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  void saveUpdate(row.key, { [row.key]: InheritSetting.Value });
                }}
                disabled={!hasWorkspace || !row.hasWorkspaceOverride || savingKey === row.key}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                  row.hasWorkspaceOverride
                    ? 'border-border text-secondary hover:bg-surface-raised'
                    : 'border-primary bg-primary-muted text-primary'
                } disabled:opacity-60`}
              >
                {i18nService.t('workspaceSettingsInheritGlobal')}
              </button>
              <button
                type="button"
                onClick={() => {
                  void saveUpdate(row.key, cloneEffectiveValue(row.key, localEffectiveSettings));
                }}
                disabled={!hasWorkspace || row.hasWorkspaceOverride || savingKey === row.key}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                  row.hasWorkspaceOverride
                    ? 'border-primary bg-primary-muted text-primary'
                    : 'border-border text-secondary hover:bg-surface-raised'
                } disabled:opacity-60`}
              >
                {i18nService.t('workspaceSettingsCustom')}
              </button>
              <button
                type="button"
                onClick={() => {
                  void saveUpdate(row.key, { [row.key]: InheritSetting.Value });
                }}
                disabled={!hasWorkspace || !row.hasWorkspaceOverride || savingKey === row.key}
                className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-secondary transition-colors hover:bg-surface-raised disabled:opacity-50"
              >
                {i18nService.t('workspaceSettingsRestoreInheritance')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default WorkspaceSettingsPanel;
