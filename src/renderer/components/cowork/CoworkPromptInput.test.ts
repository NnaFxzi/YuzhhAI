import { readFileSync } from 'node:fs';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { describe, expect, test } from 'vitest';

import { i18nService } from '../../services/i18n';
import { store } from '../../store';
import { setAgents, setCurrentAgentId } from '../../store/slices/agentSlice';
import { setActiveKitIds, setMarketplaceKits } from '../../store/slices/kitSlice';

describe('CoworkPromptInput', () => {
  test('omits the read-only context row below the conversation input', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'MacIntel' },
      configurable: true,
    });

    i18nService.setLanguage('zh', { persist: false });
    store.dispatch(
      setAgents([
        {
          id: 'marketing-agent',
          name: 'marketing-agent',
          description: '',
          icon: '',
          model: '',
          workingDirectory: '/Users/me/project',
          enabled: true,
          pinned: false,
          isDefault: false,
          source: 'custom',
          skillIds: [],
        },
      ]),
    );
    store.dispatch(setCurrentAgentId('marketing-agent'));

    const { default: CoworkPromptInput } = await import('./CoworkPromptInput');
    const markup = renderToStaticMarkup(
      React.createElement(Provider, {
        store,
        children: React.createElement(CoworkPromptInput, {
          onSubmit: () => undefined,
          size: 'large',
          showReadOnlyContext: true,
          readOnlyContextTrailingText: i18nService.t('aiGeneratedDisclaimer'),
          workingDirectory: '/Users/me/project',
          contextAgentId: 'marketing-agent',
        }),
      }),
    );

    expect(markup).not.toContain('内容由 AI 生成，仅供参考');
    expect(markup).not.toContain('/Users/me/project');
    expect(markup).not.toContain('marketing-agent');
  });

  test('omits kits and media model buttons from the large prompt toolbar', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'MacIntel' },
      configurable: true,
    });

    i18nService.setLanguage('zh', { persist: false });

    const { default: CoworkPromptInput } = await import('./CoworkPromptInput');
    const markup = renderToStaticMarkup(
      React.createElement(Provider, {
        store,
        children: React.createElement(CoworkPromptInput, {
          onSubmit: () => undefined,
          size: 'large',
        }),
      }),
    );

    expect(markup).not.toContain('专家套件');
    expect(markup).not.toContain('clip0_magic');
  });

  test('keeps Agent and Kit context for workspace Cowork without team controls or analytics', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'MacIntel' },
      configurable: true,
    });

    i18nService.setLanguage('en', { persist: false });
    store.dispatch(
      setAgents([
        {
          id: 'main',
          name: 'main',
          description: '',
          icon: '',
          model: '',
          workingDirectory: '',
          enabled: true,
          pinned: false,
          isDefault: true,
          source: 'preset',
          skillIds: [],
        },
        {
          id: 'writing-agent',
          name: 'writing-agent',
          description: '',
          icon: '',
          model: '',
          workingDirectory: '',
          enabled: true,
          pinned: false,
          isDefault: false,
          source: 'custom',
          skillIds: [],
        },
      ]),
    );
    store.dispatch(setCurrentAgentId('writing-agent'));
    store.dispatch(
      setMarketplaceKits([
        {
          id: 'campaign-kit',
          name: 'Campaign Kit',
          description: 'Campaign workflows',
        },
      ]),
    );
    store.dispatch(setActiveKitIds(['campaign-kit']));

    const { default: CoworkPromptInput } = await import('./CoworkPromptInput');
    const markup = renderToStaticMarkup(
      React.createElement(Provider, {
        store,
        children: React.createElement(CoworkPromptInput, {
          onSubmit: () => undefined,
          size: 'large',
          showAgentSelector: true,
        }),
      }),
    );

    expect(markup).toContain('writing-agent');
    expect(markup).toContain('Campaign Kit');
    expect(markup).not.toContain('Agent Team');

    const source = readFileSync(new URL('./CoworkPromptInput.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain(['workspace', '_agent_', 'team_'].join(''));

    const viewSource = readFileSync(new URL('./CoworkView.tsx', import.meta.url), 'utf8');
    expect(viewSource).not.toContain(['workspace', 'Agent', 'Team'].join(''));
    expect(viewSource).not.toContain(['workspace', 'Agent', 'Selection'].join(''));
  });
});
