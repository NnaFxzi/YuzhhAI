import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import {
  type LayeredCoworkSettingsResolution,
  SettingScope,
} from '../../../shared/cowork/layeredSettings';
import { i18nService } from '../../services/i18n';
import WorkspaceSettingsPanel from './WorkspaceSettingsPanel';

const effectiveSettings: LayeredCoworkSettingsResolution = {
  values: {
    workingDirectory: '/workspace/project',
    executionMode: 'sandbox',
    memoryEnabled: true,
    embeddingEnabled: false,
    dreamingEnabled: true,
    skillIds: ['docs'],
    defaultModel: 'openai/gpt-5.1',
  },
  sources: {
    workingDirectory: SettingScope.Workspace,
    executionMode: SettingScope.Global,
    memoryEnabled: SettingScope.Global,
    embeddingEnabled: SettingScope.Global,
    dreamingEnabled: SettingScope.Workspace,
    skillIds: SettingScope.Workspace,
    defaultModel: SettingScope.Workspace,
  },
};

const renderPanel = (workspaceId = '/workspace/project'): string =>
  renderToStaticMarkup(
    React.createElement(WorkspaceSettingsPanel, {
      workspaceId,
      workspaceSettings: {
        workingDirectory: '/workspace/project',
        dreamingEnabled: true,
        skillIds: ['docs'],
        defaultModel: 'openai/gpt-5.1',
      },
      effectiveSettings,
    }),
  );

describe('WorkspaceSettingsPanel', () => {
  test('renders workspace setting inheritance controls in Chinese', () => {
    i18nService.setLanguage('zh', { persist: false });

    const markup = renderPanel();

    expect(markup).toContain('继承全局');
    expect(markup).toContain('当前工作空间');
    expect(markup).toContain('恢复继承');
    expect(markup).toContain('工作目录');
    expect(markup).toContain('默认模型');
    expect(markup).toContain('记忆');
    expect(markup).toContain('向量检索');
    expect(markup).toContain('梦境任务');
  });

  test('renders workspace setting inheritance controls in English', () => {
    i18nService.setLanguage('en', { persist: false });

    const markup = renderPanel();

    expect(markup).toContain('Inherited from global');
    expect(markup).toContain('Current workspace');
    expect(markup).toContain('Restore inheritance');
  });

  test('explains that workspace settings are disabled when no workspace is selected', () => {
    i18nService.setLanguage('zh', { persist: false });

    const markup = renderPanel('');

    expect(markup).toContain('未选择工作空间');
    expect(markup).toContain('选择一个工作空间后才能编辑这些设置');
  });

  test('explains when the visible directory is only the default fallback', () => {
    i18nService.setLanguage('zh', { persist: false });

    const markup = renderToStaticMarkup(
      React.createElement(WorkspaceSettingsPanel, {
        workspaceId: '',
        workspaceLabel: '/Users/me/yuzhh-ai-assistant/project',
        disabledHintKey: 'workspaceSettingsDefaultFallbackDisabledHint',
        effectiveSettings,
      }),
    );

    expect(markup).toContain('/Users/me/yuzhh-ai-assistant/project');
    expect(markup).toContain('当前仅显示系统默认工作目录');
  });
});
