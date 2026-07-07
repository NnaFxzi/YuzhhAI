import { AgentAnswerShape, defaultAgentResponseContract } from '@shared/agent';
import { buildDefaultDomesticResearchConfig } from '@shared/agent/domesticResearch';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { store } from '../store';
import { setAgents, setCurrentAgentId } from '../store/slices/agentSlice';
import { clearActiveSkills, setActiveSkillIds } from '../store/slices/skillSlice';
import type { Agent } from '../types/agent';
import { agentService } from './agent';

const makeAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: 'agent-1',
  name: 'Agent 1',
  description: '',
  systemPrompt: '',
  identity: '',
  model: '',
  workingDirectory: '',
  responseContract: defaultAgentResponseContract,
  icon: '',
  skillIds: [],
  enabled: true,
  pinned: false,
  pinOrder: null,
  isDefault: false,
  source: 'custom',
  presetId: '',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

beforeEach(() => {
  store.dispatch(setAgents([]));
  store.dispatch(setCurrentAgentId('main'));
  store.dispatch(clearActiveSkills());
  vi.restoreAllMocks();
  delete (globalThis as { window?: unknown }).window;
});

describe('agentService.updateAgent', () => {
  test('refreshes active skills when the current agent is saved', async () => {
    store.dispatch(setAgents([{
      id: 'agent-1',
      name: 'Agent 1',
      description: '',
      icon: '',
      model: '',
      workingDirectory: '',
      enabled: true,
      pinned: false,
      pinOrder: null,
      isDefault: false,
      source: 'custom',
      skillIds: [],
    }]));
    store.dispatch(setCurrentAgentId('agent-1'));

    (globalThis as { window?: unknown }).window = {
      electron: {
        agents: {
          update: vi.fn().mockResolvedValue(makeAgent({ skillIds: ['docx', 'web-search'] })),
        },
      },
    };

    await agentService.updateAgent('agent-1', { skillIds: ['docx', 'web-search'] });

    expect(store.getState().agent.agents[0].skillIds).toEqual(['docx', 'web-search']);
    expect(store.getState().skill.activeSkillIds).toEqual(['docx', 'web-search']);
  });

  test('does not clear active skills when only model is updated', async () => {
    store.dispatch(setAgents([{
      id: 'agent-1',
      name: 'Agent 1',
      description: '',
      icon: '',
      model: '',
      workingDirectory: '',
      enabled: true,
      pinned: false,
      pinOrder: null,
      isDefault: false,
      source: 'custom',
      skillIds: [],
    }]));
    store.dispatch(setCurrentAgentId('agent-1'));
    store.dispatch(setActiveSkillIds(['user-selected-skill']));

    (globalThis as { window?: unknown }).window = {
      electron: {
        agents: {
          update: vi.fn().mockResolvedValue(makeAgent({ model: 'new-model', skillIds: [] })),
        },
      },
    };

    await agentService.updateAgent('agent-1', { model: 'new-model' });

    // Active skills should remain untouched since skillIds was not in the update
    expect(store.getState().skill.activeSkillIds).toEqual(['user-selected-skill']);
  });

  test('stores the response contract returned by the main process', async () => {
    store.dispatch(
      setAgents([
        {
          id: 'agent-1',
          name: 'Agent 1',
          description: '',
          icon: '',
          model: '',
          workingDirectory: '',
          enabled: true,
          pinned: false,
          pinOrder: null,
          isDefault: false,
          source: 'custom',
          skillIds: [],
        },
      ]),
    );

    (globalThis as { window?: unknown }).window = {
      electron: {
        agents: {
          update: vi.fn().mockResolvedValue(
            makeAgent({
              responseContract: {
                ...defaultAgentResponseContract,
                answerShape: AgentAnswerShape.CopyReady,
                mustAvoid: ['不要编造硬事实'],
              },
            }),
          ),
        },
      },
    };

    await agentService.updateAgent('agent-1', { model: 'new-model' });

    expect(store.getState().agent.agents[0].responseContract?.answerShape).toBe(
      AgentAnswerShape.CopyReady,
    );
    expect(store.getState().agent.agents[0].responseContract?.mustAvoid).toEqual([
      '不要编造硬事实',
    ]);
  });

  test('does not replace active skills when another agent is saved', async () => {
    store.dispatch(setAgents([{
      id: 'agent-1',
      name: 'Agent 1',
      description: '',
      icon: '',
      model: '',
      workingDirectory: '',
      enabled: true,
      pinned: false,
      pinOrder: null,
      isDefault: false,
      source: 'custom',
      skillIds: ['docx'],
    }]));
    store.dispatch(setCurrentAgentId('agent-2'));
    store.dispatch(setActiveSkillIds(['xlsx']));

    (globalThis as { window?: unknown }).window = {
      electron: {
        agents: {
          update: vi.fn().mockResolvedValue(makeAgent({ skillIds: ['docx', 'web-search'] })),
        },
      },
    };

    await agentService.updateAgent('agent-1', { skillIds: ['docx', 'web-search'] });

    expect(store.getState().skill.activeSkillIds).toEqual(['xlsx']);
  });
});

describe('agentService.addPreset', () => {
  test('updates an existing preset Agent summary instead of adding a duplicate', async () => {
    store.dispatch(
      setAgents([
        {
          id: 'marketing-agent',
          name: '旧推广 Agent',
          description: '',
          icon: '',
          model: '',
          workingDirectory: '',
          enabled: true,
          pinned: false,
          pinOrder: null,
          isDefault: false,
          source: 'preset',
          skillIds: [],
        },
      ]),
    );

    (globalThis as { window?: unknown }).window = {
      electron: {
        agents: {
          addPreset: vi.fn().mockResolvedValue(
            makeAgent({
              id: 'marketing-agent',
              name: '推广 Agent',
              source: 'preset',
              presetId: 'marketing-agent',
            }),
          ),
        },
      },
    };

    await agentService.addPreset('marketing-agent');

    expect(store.getState().agent.agents).toHaveLength(1);
    expect(store.getState().agent.agents[0].name).toBe('推广 Agent');
  });
});

describe('agentService.getPresetTemplates', () => {
  test('marks installed preset templates with their current enabled state', async () => {
    store.dispatch(
      setAgents([
        {
          id: 'marketing-agent',
          name: '推广 Agent',
          description: '',
          icon: '',
          model: '',
          workingDirectory: '',
          enabled: false,
          pinned: false,
          pinOrder: null,
          isDefault: false,
          source: 'preset',
          skillIds: [],
        },
      ]),
    );

    (globalThis as { window?: unknown }).window = {
      electron: {
        agents: {
          presetTemplates: vi.fn().mockResolvedValue([
            {
              id: 'marketing-agent',
              name: '推广 Agent',
              nameEn: 'Marketing Agent',
              icon: '',
              description: '',
              descriptionEn: '',
              identity: '',
              identityEn: '',
              systemPrompt: '',
              systemPromptEn: '',
              skillIds: [],
            },
          ]),
        },
      },
    };

    await expect(agentService.getPresetTemplates()).resolves.toMatchObject([
      {
        id: 'marketing-agent',
        installed: true,
        enabled: false,
      },
    ]);
  });
});

describe('agentService external research settings', () => {
  test('reports when external research settings save bridge is unavailable', () => {
    (globalThis as { window?: unknown }).window = {
      electron: {
        agents: {},
      },
    };

    expect(agentService.canSaveExternalResearchSettings()).toBe(false);
  });

  test('saves external research settings through preload API', async () => {
    const saveExternalResearchSettings = vi.fn().mockResolvedValue({
      mode: 'override',
      providers: {
        tavily: { enabled: true, hasApiKey: true, apiKeyPreview: 'tvly...test' },
        firecrawl: { enabled: false, hasApiKey: false, apiKeyPreview: '' },
      },
    });
    (globalThis as { window?: unknown }).window = {
      electron: {
        agents: {
          saveExternalResearchSettings,
        },
      },
    };

    const result = await agentService.saveExternalResearchSettings('agent-1', {
      mode: 'override',
      providers: {
        tavily: { enabled: true, apiKeyAction: 'replace', apiKey: 'tvly-test' },
        firecrawl: { enabled: false, apiKeyAction: 'clear', apiKey: '' },
      },
    });

    expect(result?.providers.tavily.hasApiKey).toBe(true);
    expect(saveExternalResearchSettings).toHaveBeenCalledWith('agent-1', expect.objectContaining({ mode: 'override' }));
  });

  test('tests an external research provider through preload API', async () => {
    const testExternalResearchProvider = vi.fn().mockResolvedValue({ ok: true, message: 'Connection successful.' });
    (globalThis as { window?: unknown }).window = {
      electron: {
        agents: {
          testExternalResearchProvider,
        },
      },
    };

    const result = await agentService.testExternalResearchProvider({
      providerId: 'firecrawl',
      apiKey: 'fc-test',
    });

    expect(result.ok).toBe(true);
    expect(testExternalResearchProvider).toHaveBeenCalledWith({ providerId: 'firecrawl', apiKey: 'fc-test' });
  });
});

describe('agentService domestic research settings', () => {
  test('loads domestic research settings through preload API', async () => {
    const getDomesticResearchSettings = vi.fn().mockResolvedValue({
      settings: {
        sources: {
          douyin: { enabled: true, modes: ['url_import'] },
          bilibili: { enabled: true, modes: ['search', 'url_import'] },
        },
        customSources: [],
      },
      statuses: {
        douyin: { sourceId: 'douyin', enabled: true, status: 'link_import_only', modes: ['url_import'], limitations: [] },
        bilibili: { sourceId: 'bilibili', enabled: true, status: 'available', modes: ['search', 'url_import'], limitations: [] },
      },
    });
    (globalThis as { window?: unknown }).window = {
      electron: {
        agents: {
          getDomesticResearchSettings,
        },
      },
    };

    const result = await agentService.getDomesticResearchSettings('agent-1');

    expect(result?.statuses.douyin.status).toBe('link_import_only');
    expect(getDomesticResearchSettings).toHaveBeenCalledWith('agent-1');
  });

  test('saves domestic research settings through preload API', async () => {
    const config = buildDefaultDomesticResearchConfig();
    config.sources.douyin.enabled = false;
    const saveDomesticResearchSettings = vi.fn().mockResolvedValue({
      sources: config.sources,
      customSources: [
        {
          id: 'custom-1',
          name: '行业论坛',
          enabled: true,
          modes: ['url_import'],
          urls: ['https://example.com/topic'],
        },
      ],
    });
    (globalThis as { window?: unknown }).window = {
      electron: {
        agents: {
          saveDomesticResearchSettings,
        },
      },
    };

    const result = await agentService.saveDomesticResearchSettings('agent-1', config);

    expect(result?.sources.douyin.enabled).toBe(false);
    expect(result?.customSources[0]?.urls).toEqual(['https://example.com/topic']);
    expect(saveDomesticResearchSettings).toHaveBeenCalledWith('agent-1', expect.objectContaining({ sources: expect.any(Object) }));
  });
});
