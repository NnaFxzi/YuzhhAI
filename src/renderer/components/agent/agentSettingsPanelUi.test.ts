import { describe, expect, test } from 'vitest';

import {
  AgentSettingsSaveStep,
  buildAgentSettingsRuntimeImpactMessage,
  buildAgentSettingsSaveFailureMessage,
  buildAgentSettingsUpdateRequest,
} from './agentSettingsPanelUi';

const draft = {
  name: 'Agent name',
  description: 'Agent description',
  systemPrompt: 'System prompt',
  identity: 'Identity',
  model: 'provider/model',
  workingDirectory: '/tmp/project',
  icon: 'icon-value',
  skillIds: ['skill-a', 'skill-b'],
  enabled: false,
};

describe('buildAgentSettingsUpdateRequest', () => {
  test('keeps definition fields out of system Agent saves', () => {
    expect(buildAgentSettingsUpdateRequest(draft, true)).toEqual({
      model: 'provider/model',
      workingDirectory: '/tmp/project',
      enabled: false,
    });
  });

  test('includes definition fields for legacy custom Agent saves', () => {
    expect(buildAgentSettingsUpdateRequest(draft, false)).toEqual(draft);
  });
});

describe('buildAgentSettingsSaveFailureMessage', () => {
  const t = (key: string) =>
    ({
      agentSavePartialFailed: '部分设置已保存，仍有项目保存失败。',
      agentSaveFailed: '保存 Agent 设置失败',
      agentSaveSucceededSteps: '已保存',
      agentSaveFailedSteps: '未保存',
      agentSaveStepAgent: 'Agent 本体',
      agentSaveStepExternalResearch: '外部调研',
      agentSaveStepImBindings: 'IM 绑定',
    })[key] ?? key;

  test('summarizes partial success with saved and failed steps', () => {
    expect(
      buildAgentSettingsSaveFailureMessage(
        [
          { step: AgentSettingsSaveStep.Agent, status: 'success' },
          { step: AgentSettingsSaveStep.ExternalResearch, status: 'success' },
          { step: AgentSettingsSaveStep.ImBindings, status: 'failed' },
        ],
        t,
      ),
    ).toBe('部分设置已保存，仍有项目保存失败。已保存：Agent 本体、外部调研；未保存：IM 绑定');
  });

  test('summarizes a full failure without implying partial success', () => {
    expect(
      buildAgentSettingsSaveFailureMessage(
        [{ step: AgentSettingsSaveStep.Agent, status: 'failed' }],
        t,
      ),
    ).toBe('保存 Agent 设置失败。未保存：Agent 本体');
  });
});

describe('buildAgentSettingsRuntimeImpactMessage', () => {
  const t = (key: string) =>
    ({
      agentRuntimeImpactPrefix: '运行影响',
      agentRuntimeImpactSeparator: '：',
      agentRuntimeImpactJoiner: '；',
      agentRuntimeImpactModel: '模型用于新会话和新任务，已有运行任务保持原快照',
      agentRuntimeImpactSkills: '技能用于新会话和新任务，已有运行任务保持原快照',
      agentRuntimeImpactWorkingDirectory:
        '工作目录保存后会同步到 OpenClaw，并在需要时重启 gateway；已有运行任务不切换目录',
      agentRuntimeImpactImBindings:
        'IM 绑定保存后会同步到 OpenClaw，并重启 gateway；影响新的 IM 会话；已有 IM 会话保持原 session 映射',
    })[key] ?? key;

  test('returns an empty message when no runtime-impacting fields changed', () => {
    expect(buildAgentSettingsRuntimeImpactMessage(['name', 'description'], t)).toBe('');
  });

  test('summarizes model and skill changes as future-session effects', () => {
    expect(buildAgentSettingsRuntimeImpactMessage(['model', 'skillIds'], t)).toBe(
      '运行影响：模型用于新会话和新任务，已有运行任务保持原快照；技能用于新会话和新任务，已有运行任务保持原快照',
    );
  });

  test('summarizes gateway and IM effects for working directory and binding changes', () => {
    expect(buildAgentSettingsRuntimeImpactMessage(['workingDirectory', 'imBindings'], t)).toBe(
      '运行影响：工作目录保存后会同步到 OpenClaw，并在需要时重启 gateway；已有运行任务不切换目录；IM 绑定保存后会同步到 OpenClaw，并重启 gateway；影响新的 IM 会话；已有 IM 会话保持原 session 映射',
    );
  });
});
