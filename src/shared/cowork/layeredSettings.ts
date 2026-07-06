export const SettingScope = {
  Default: 'default',
  Global: 'global',
  Workspace: 'workspace',
  Agent: 'agent',
  Session: 'session',
} as const;

export type SettingScope = (typeof SettingScope)[keyof typeof SettingScope];

export const InheritSetting = {
  Value: '__inherit__',
} as const;

export type InheritSetting = (typeof InheritSetting)[keyof typeof InheritSetting];

export interface LayeredCoworkSettingsValues {
  workingDirectory: string;
  executionMode: 'auto' | 'local' | 'sandbox';
  memoryEnabled: boolean;
  embeddingEnabled: boolean;
  dreamingEnabled: boolean;
  skillIds: string[];
  defaultModel: string;
}

export type LayeredCoworkSettingsUpdate = Partial<{
  [K in keyof LayeredCoworkSettingsValues]: LayeredCoworkSettingsValues[K] | InheritSetting;
}>;

export interface CoworkSettingsLayer {
  scope: SettingScope;
  values: Partial<LayeredCoworkSettingsValues>;
}

export interface LayeredCoworkSettingsResolution {
  values: LayeredCoworkSettingsValues;
  sources: Record<keyof LayeredCoworkSettingsValues, SettingScope>;
}

export const defaultLayeredCoworkSettings: LayeredCoworkSettingsValues = {
  workingDirectory: '',
  executionMode: 'local',
  memoryEnabled: true,
  embeddingEnabled: false,
  dreamingEnabled: false,
  skillIds: [],
  defaultModel: '',
};

const settingKeys = Object.keys(defaultLayeredCoworkSettings) as Array<
  keyof LayeredCoworkSettingsValues
>;

const applyLayer = (result: LayeredCoworkSettingsResolution, layer?: CoworkSettingsLayer): void => {
  if (!layer) return;

  for (const key of settingKeys) {
    const value = layer.values[key];
    if (value !== undefined) {
      result.values[key] = value as never;
      result.sources[key] = layer.scope;
    }
  }
};

export const resolveLayeredCoworkSettings = (layers: {
  global: CoworkSettingsLayer;
  workspace?: CoworkSettingsLayer;
  agent?: CoworkSettingsLayer;
  session?: CoworkSettingsLayer;
}): LayeredCoworkSettingsResolution => {
  const result = settingKeys.reduce<LayeredCoworkSettingsResolution>(
    (acc, key) => {
      acc.values[key] = defaultLayeredCoworkSettings[key] as never;
      acc.sources[key] = SettingScope.Default;
      return acc;
    },
    {
      values: { ...defaultLayeredCoworkSettings },
      sources: {} as Record<keyof LayeredCoworkSettingsValues, SettingScope>,
    },
  );

  applyLayer(result, layers.global);
  applyLayer(result, layers.workspace);
  applyLayer(result, layers.agent);
  applyLayer(result, layers.session);

  return result;
};
