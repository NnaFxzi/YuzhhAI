import { describe, expect, test } from 'vitest';

import {
  type CoworkSettingsLayer,
  resolveLayeredCoworkSettings,
  SettingScope,
} from './layeredSettings';

const globalLayer: CoworkSettingsLayer = {
  scope: SettingScope.Global,
  values: {
    workingDirectory: '/global/project',
    executionMode: 'local',
    memoryEnabled: true,
    embeddingEnabled: false,
    dreamingEnabled: false,
    skillIds: ['global-skill'],
    defaultModel: 'global-model',
  },
};

describe('resolveLayeredCoworkSettings', () => {
  test('uses workspace overrides before global defaults', () => {
    const resolved = resolveLayeredCoworkSettings({
      global: globalLayer,
      workspace: {
        scope: SettingScope.Workspace,
        values: {
          workingDirectory: '/workspace/project',
          skillIds: ['workspace-skill'],
        },
      },
    });

    expect(resolved.values.workingDirectory).toBe('/workspace/project');
    expect(resolved.sources.workingDirectory).toBe(SettingScope.Workspace);
    expect(resolved.values.executionMode).toBe('local');
    expect(resolved.sources.executionMode).toBe(SettingScope.Global);
    expect(resolved.values.skillIds).toEqual(['workspace-skill']);
  });

  test('uses agent overrides before workspace overrides', () => {
    const resolved = resolveLayeredCoworkSettings({
      global: globalLayer,
      workspace: {
        scope: SettingScope.Workspace,
        values: { defaultModel: 'workspace-model' },
      },
      agent: {
        scope: SettingScope.Agent,
        values: { defaultModel: 'agent-model' },
      },
    });

    expect(resolved.values.defaultModel).toBe('agent-model');
    expect(resolved.sources.defaultModel).toBe(SettingScope.Agent);
  });

  test('keeps skill selection owned by workspace when agent and session provide skills', () => {
    const resolved = resolveLayeredCoworkSettings({
      global: globalLayer,
      workspace: {
        scope: SettingScope.Workspace,
        values: { skillIds: ['workspace-skill'] },
      },
      agent: {
        scope: SettingScope.Agent,
        values: { skillIds: ['agent-skill'] },
      },
      session: {
        scope: SettingScope.Session,
        values: { skillIds: ['session-skill'] },
      },
    });

    expect(resolved.values.skillIds).toEqual(['workspace-skill']);
    expect(resolved.sources.skillIds).toBe(SettingScope.Workspace);
  });

  test('uses session snapshot before all mutable layers', () => {
    const resolved = resolveLayeredCoworkSettings({
      global: globalLayer,
      workspace: {
        scope: SettingScope.Workspace,
        values: { executionMode: 'sandbox' },
      },
      session: {
        scope: SettingScope.Session,
        values: { executionMode: 'local' },
      },
    });

    expect(resolved.values.executionMode).toBe('local');
    expect(resolved.sources.executionMode).toBe(SettingScope.Session);
  });
});
