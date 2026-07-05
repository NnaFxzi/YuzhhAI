import { describe, expect, test } from 'vitest';

import {
  DomesticResearchMode,
  DomesticResearchSourceId,
} from '../agent/domesticResearch';
import {
  AgentExternalResearchMode,
  ExternalResearchProviderId,
} from '../agent/externalResearch';
import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadContentPlatformId,
  EnterpriseLeadRiskLevel,
  EnterpriseLeadTodoKind,
} from './constants';
import {
  buildDefaultEnterpriseLeadWorkspaceSettings,
  normalizeAgentTaskResultInput,
  normalizeEnterpriseLeadRunAgentSnapshot,
  normalizeEnterpriseLeadWorkspaceAgents,
  normalizeEnterpriseLeadWorkspaceSettings,
  normalizeEnterpriseLeadWorkspaceSettingsUpdate,
  normalizeRiskReviewOutput,
  normalizeWorkspaceChatResearchIntent,
  normalizeWorkspaceDraftInput,
} from './validation';

describe('enterprise lead workspace validation', () => {
  test('normalizes a workspace draft from extracted profile data', () => {
    const draft = normalizeWorkspaceDraftInput({
      name: ' 重型包装获客 ',
      profile: {
        companySummary: '东莞工厂，做重型纸箱',
        productList: ['重型纸箱', '蜂窝纸箱', '重型纸箱'],
        targetCustomers: ['汽配', '机械设备'],
        channelPreferences: ['朋友圈'],
        sellingPoints: ['防破损'],
        prohibitedClaims: ['不能写具体承重'],
        missingInfo: ['真实案例'],
      },
      source: { kind: 'conversation', label: '用户描述' },
    });

    expect(draft.name).toBe('重型包装获客');
    expect(draft.profile.productList).toEqual(['重型纸箱', '蜂窝纸箱']);
    expect(draft.source.kind).toBe('conversation');
  });

  test('rejects a workspace draft without a name', () => {
    expect(() => normalizeWorkspaceDraftInput({
      name: '',
      profile: {},
      source: { kind: 'conversation', label: '用户描述' },
    })).toThrow('workspace draft name is required');
  });

  test('normalizes an Agent task result envelope', () => {
    const result = normalizeAgentTaskResultInput({
      role: EnterpriseLeadAgentRole.ProductUnderstanding,
      summary: '已识别产品和客户方向',
      outputs: { productProfile: { name: '重型纸箱' } },
      missingInfo: ['承重范围'],
      todos: [{
        kind: EnterpriseLeadTodoKind.MissingInfo,
        title: '补充承重范围',
        description: '用于避免编造具体参数',
      }],
      risks: [],
      handoffContext: { product: '重型纸箱' },
      status: 'completed',
    });

    expect(result.summary).toBe('已识别产品和客户方向');
    expect(result.missingInfo).toEqual(['承重范围']);
    expect(result.todos[0].kind).toBe(EnterpriseLeadTodoKind.MissingInfo);
  });

  test('high risk prevents archive without explicit confirmation', () => {
    const output = normalizeRiskReviewOutput({
      riskLevel: EnterpriseLeadRiskLevel.High,
      blockingIssues: ['内容暗示已经私信客户'],
      warnings: [],
      requiredRevisions: ['改成私信草稿'],
      approvalTodos: [],
      draftOnlyConfirmed: false,
      canArchive: true,
    });

    expect(output.canArchive).toBe(false);
    expect(output.blockingIssues).toEqual(['内容暗示已经私信客户']);
  });

  test('builds independent workspace settings from real project config domains', () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();

    expect(settings.model).toEqual({
      defaultModel: '',
      defaultModelProvider: '',
      providers: {},
    });
    expect(settings.skillIds).toEqual([]);
    expect(settings.externalResearch.providers.tavily).toEqual({
      enabled: false,
      apiKey: '',
    });
    expect(settings.domesticResearch.sources.bilibili.enabled).toBe(true);
    expect(settings.contentPlatforms.platforms.xiaohongshu_draft).toEqual(expect.objectContaining({
      id: 'xiaohongshu_draft',
      enabled: true,
      deliveryMode: 'draft_only',
    }));
    expect(settings.contentPlatforms.outputRules).toEqual({
      defaultPlatformId: 'sales_message',
      lengthPolicy: 'compress',
      riskCheckBeforeExport: true,
      variablePlaceholders: ['客户名', '行业', '痛点', '卖点'],
      archiveOutputs: true,
    });
  });

  test('normalizes workspace provider, skill, external research, and domestic platform settings', () => {
    const settings = normalizeEnterpriseLeadWorkspaceSettings({
      model: {
        defaultModel: ' gpt-4.1 ',
        defaultModelProvider: ' openai ',
        providers: {
          openai: {
            enabled: true,
            apiKey: ' sk-workspace ',
            baseUrl: ' https://api.openai.com/v1 ',
            apiFormat: 'openai',
            models: [{ id: ' gpt-4.1 ', name: ' GPT-4.1 ', supportsImage: true }],
          },
        },
      },
      skillIds: ['docx', 'web-search', 'docx', ' '],
      externalResearch: {
        mode: 'override',
        providers: {
          tavily: { enabled: true, apiKey: ' tvly-workspace ' },
          firecrawl: { enabled: false, apiKey: '' },
        },
      },
      domesticResearch: {
        sources: {
          xiaohongshu: {
            enabled: true,
            modes: ['url_import'],
            urls: [' https://www.xiaohongshu.com/explore/1 '],
          },
          bilibili: {
            enabled: false,
            modes: ['search'],
            urls: [],
          },
        },
      },
      contentPlatforms: {
        platforms: {
          xiaohongshu_draft: {
            enabled: true,
            deliveryMode: ' third_party_draft ',
            account: ' 启盛精密 ',
            endpoint: ' https://draft.example.com/xhs ',
            token: ' xhs-token ',
          },
          custom_webhook: {
            enabled: true,
            deliveryMode: ' webhook ',
            endpoint: ' https://automation.example.com/lead ',
            payloadFormat: ' markdown ',
          },
        },
        outputRules: {
          defaultPlatformId: ' xiaohongshu_draft ',
          lengthPolicy: ' split ',
          riskCheckBeforeExport: false,
          variablePlaceholders: [' 客户名 ', '', '行业', '客户名'],
          archiveOutputs: false,
        },
      },
    });

    expect(settings.model.defaultModel).toBe('gpt-4.1');
    expect(settings.model.defaultModelProvider).toBe('openai');
    expect(settings.model.providers.openai).toEqual(expect.objectContaining({
      enabled: true,
      apiKey: 'sk-workspace',
      baseUrl: 'https://api.openai.com/v1',
      apiFormat: 'openai',
    }));
    expect(settings.model.providers.openai.models).toEqual([
      { id: 'gpt-4.1', name: 'GPT-4.1', supportsImage: true },
    ]);
    expect(settings.skillIds).toEqual(['docx', 'web-search']);
    expect(settings.externalResearch.providers.tavily.apiKey).toBe('tvly-workspace');
    expect(settings.domesticResearch.sources.xiaohongshu.urls).toEqual([
      'https://www.xiaohongshu.com/explore/1',
    ]);
    expect(settings.contentPlatforms.platforms.xiaohongshu_draft).toEqual(expect.objectContaining({
      enabled: true,
      deliveryMode: 'third_party_draft',
      account: '启盛精密',
      endpoint: 'https://draft.example.com/xhs',
      token: 'xhs-token',
    }));
    expect(settings.contentPlatforms.platforms.custom_webhook).toEqual(expect.objectContaining({
      enabled: true,
      endpoint: 'https://automation.example.com/lead',
      payloadFormat: 'markdown',
    }));
    expect(settings.contentPlatforms.outputRules).toEqual({
      defaultPlatformId: 'xiaohongshu_draft',
      lengthPolicy: 'split',
      riskCheckBeforeExport: false,
      variablePlaceholders: ['客户名', '行业'],
      archiveOutputs: false,
    });
  });

  test('migrates legacy workbench settings into the new independent settings shape', () => {
    const settings = normalizeEnterpriseLeadWorkspaceSettings({
      modelRef: 'openai/gpt-4.1',
      skillCapabilities: {
        documentParsing: { enabled: true },
        contentRewrite: { enabled: true },
      },
      researchCapabilities: {
        webSearch: { enabled: true },
      },
      contentPlatforms: {
        [EnterpriseLeadContentPlatformId.Xiaohongshu]: {
          enabled: true,
          configured: true,
          account: '华南重包',
        },
      },
    });

    expect(settings.model.defaultModelProvider).toBe('openai');
    expect(settings.model.defaultModel).toBe('gpt-4.1');
    expect(settings.skillIds).toEqual(['documentParsing', 'contentRewrite']);
    expect(settings.externalResearch.providers.tavily.enabled).toBe(true);
    expect(settings.domesticResearch.sources.xiaohongshu.enabled).toBe(true);
    expect(settings.domesticResearch.sources.xiaohongshu.urls).toEqual([]);
    expect(settings.contentPlatforms.platforms.xiaohongshu_draft.enabled).toBe(true);
    expect(settings.contentPlatforms.platforms.xiaohongshu_draft.account).toBe('华南重包');
  });

  test('normalizes partial settings updates against existing workspace settings', () => {
    const current = normalizeEnterpriseLeadWorkspaceSettings({
      model: {
        defaultModel: 'kimi-k2.6',
        defaultModelProvider: 'moonshot',
        providers: {
          moonshot: {
            enabled: true,
            apiKey: 'sk-old',
            baseUrl: 'https://api.moonshot.cn/v1',
            apiFormat: 'openai',
            models: [{ id: 'kimi-k2.6', name: 'Kimi K2.6' }],
          },
        },
      },
      skillIds: ['docx'],
    });

    const update = normalizeEnterpriseLeadWorkspaceSettingsUpdate({
      settings: {
        model: {
          providers: {
            moonshot: {
              apiKey: ' sk-new ',
            },
          },
        },
        skillIds: ['docx', 'web-search'],
      },
    }, current);

    const updatedProviders = update.settings?.model?.providers;
    expect(updatedProviders).toBeDefined();
    expect(updatedProviders?.moonshot).toEqual(expect.objectContaining({
      enabled: true,
      apiKey: 'sk-new',
      baseUrl: 'https://api.moonshot.cn/v1',
    }));
    expect(update.settings?.skillIds).toEqual(['docx', 'web-search']);
  });

  test('preserves custom enabled agent role strings during settings updates', () => {
    const current = buildDefaultEnterpriseLeadWorkspaceSettings();

    const update = normalizeEnterpriseLeadWorkspaceSettingsUpdate({
      enabledAgentRoles: [
        EnterpriseLeadAgentRole.ContentPlanning,
        ' workspace-agent-alpha ',
        '',
        'workspace-agent-alpha',
      ],
    }, current);

    expect(update.enabledAgentRoles).toEqual([
      EnterpriseLeadAgentRole.ContentPlanning,
      'workspace-agent-alpha',
    ]);
  });

  test('preserves external research fields during partial settings updates', () => {
    const current = normalizeEnterpriseLeadWorkspaceSettings({
      externalResearch: {
        mode: AgentExternalResearchMode.Override,
        providers: {
          [ExternalResearchProviderId.Tavily]: { enabled: false, apiKey: 'old-tavily' },
          [ExternalResearchProviderId.Firecrawl]: { enabled: true, apiKey: 'old-firecrawl' },
        },
      },
    });

    const update = normalizeEnterpriseLeadWorkspaceSettingsUpdate({
      settings: {
        externalResearch: {
          providers: {
            [ExternalResearchProviderId.Tavily]: { enabled: true, apiKey: ' new-tavily ' },
          },
        },
      },
    }, current);

    expect(update.settings?.externalResearch).toEqual({
      mode: AgentExternalResearchMode.Override,
      providers: {
        [ExternalResearchProviderId.Tavily]: { enabled: true, apiKey: 'new-tavily' },
        [ExternalResearchProviderId.Firecrawl]: { enabled: true, apiKey: 'old-firecrawl' },
      },
    });
  });

  test('preserves domestic research fields during partial settings updates', () => {
    const current = normalizeEnterpriseLeadWorkspaceSettings({
      domesticResearch: {
        sources: {
          [DomesticResearchSourceId.Xiaohongshu]: {
            enabled: false,
            modes: [DomesticResearchMode.UrlImport],
            urls: ['https://www.xiaohongshu.com/explore/1'],
          },
          [DomesticResearchSourceId.Bilibili]: {
            enabled: true,
            modes: [DomesticResearchMode.Search],
            urls: ['https://www.bilibili.com/video/BV1'],
          },
        },
        customSources: [{
          id: 'industry-forum',
          name: '行业论坛',
          enabled: true,
          modes: [DomesticResearchMode.UrlImport],
          urls: ['https://forum.example.com/a'],
        }],
      },
    });

    const update = normalizeEnterpriseLeadWorkspaceSettingsUpdate({
      settings: {
        domesticResearch: {
          sources: {
            [DomesticResearchSourceId.Xiaohongshu]: {
              enabled: true,
            },
          },
        },
      },
    }, current);

    expect(update.settings?.domesticResearch.sources.xiaohongshu).toEqual({
      enabled: true,
      modes: [DomesticResearchMode.UrlImport],
      urls: ['https://www.xiaohongshu.com/explore/1'],
    });
    expect(update.settings?.domesticResearch.sources.bilibili).toEqual({
      enabled: true,
      modes: [DomesticResearchMode.Search],
      urls: ['https://www.bilibili.com/video/BV1'],
    });
    expect(update.settings?.domesticResearch.customSources).toEqual([{
      id: 'industry-forum',
      name: '行业论坛',
      enabled: true,
      modes: [DomesticResearchMode.UrlImport],
      urls: ['https://forum.example.com/a'],
    }]);
  });

  test('normalizes workspace agent bindings with local overrides', () => {
    const normalized = normalizeEnterpriseLeadWorkspaceAgents([
      {
        agentId: ' agent-a ',
        enabled: false,
        order: 2.7,
        overrides: {
          name: '  Space Writer  ',
          description: '  Writes for this workspace only  ',
          identity: '  Workspace identity  ',
          systemPrompt: '  Workspace prompt  ',
          icon: '  briefcase  ',
          model: '  deepseek/deepseek-chat  ',
          skillIds: [' docx ', '', 'docx', 'web-search'],
        },
      },
    ]);

    expect(normalized).toEqual([
      {
        agentId: 'agent-a',
        enabled: false,
        order: 0,
        overrides: {
          name: 'Space Writer',
          description: 'Writes for this workspace only',
          identity: 'Workspace identity',
          systemPrompt: 'Workspace prompt',
          icon: 'briefcase',
          model: 'deepseek/deepseek-chat',
          skillIds: ['docx', 'web-search'],
        },
      },
    ]);
  });

  test('normalizes workspace-owned Agent definitions from direct fields', () => {
    const normalized = normalizeEnterpriseLeadWorkspaceAgents([
      {
        agentId: ' product_understanding ',
        enabled: true,
        order: 0,
        name: '  产品理解 Agent  ',
        description: '  整理产品画像和卖点  ',
        identity: '  你是当前空间的产品理解专家  ',
        systemPrompt: '  先抽取产品能力，再标记缺失信息  ',
        icon: '  产  ',
        model: '  deepseek/deepseek-v4-pro  ',
        skillIds: [' product-profile ', '', 'source-check'],
      },
    ]);

    expect(normalized).toEqual([
      {
        agentId: EnterpriseLeadAgentRole.ProductUnderstanding,
        enabled: true,
        order: 0,
        overrides: {
          name: '产品理解 Agent',
          description: '整理产品画像和卖点',
          identity: '你是当前空间的产品理解专家',
          systemPrompt: '先抽取产品能力，再标记缺失信息',
          icon: '产',
          model: 'deepseek/deepseek-v4-pro',
          skillIds: ['product-profile', 'source-check'],
        },
      },
    ]);
  });

  test('normalizes immutable run Agent snapshots', () => {
    expect(normalizeEnterpriseLeadRunAgentSnapshot({
      agentId: ' global-agent-1 ',
      name: '  Space Writer  ',
      description: '  Writes workspace leads  ',
      identity: '  Workspace identity  ',
      systemPrompt: '  Workspace prompt  ',
      icon: '  briefcase  ',
      model: '  deepseek/deepseek-chat  ',
      skillIds: [' docx ', '', 'docx', 'web-search'],
    })).toEqual({
      agentId: 'global-agent-1',
      name: 'Space Writer',
      description: 'Writes workspace leads',
      identity: 'Workspace identity',
      systemPrompt: 'Workspace prompt',
      icon: 'briefcase',
      model: 'deepseek/deepseek-chat',
      skillIds: ['docx', 'web-search'],
    });

    expect(normalizeEnterpriseLeadRunAgentSnapshot({
      agentId: ' global-agent-2 ',
      name: ' ',
    })).toEqual({
      agentId: 'global-agent-2',
      name: 'global-agent-2',
      description: '',
      identity: '',
      systemPrompt: '',
      icon: '',
      model: '',
      skillIds: [],
    });

    expect(normalizeEnterpriseLeadRunAgentSnapshot({ agentId: ' ' })).toBeNull();
  });

  test('drops workspace agent bindings without an agent id', () => {
    expect(normalizeEnterpriseLeadWorkspaceAgents([
      { agentId: ' ', enabled: true, order: 0, overrides: { name: 'Missing' } },
    ])).toEqual([]);
  });

  test('sorts workspace agent bindings and remaps contiguous order', () => {
    const normalized = normalizeEnterpriseLeadWorkspaceAgents([
      { agentId: ' agent-three ', enabled: true, order: 3, overrides: { name: 'Third' } },
      { agentId: ' ', enabled: true, order: 0, overrides: { name: 'Missing' } },
      { agentId: ' agent-invalid ', enabled: true, order: 'later', overrides: { name: 'Fallback' } },
      { agentId: ' agent-one ', enabled: true, order: 1, overrides: { name: 'First' } },
      { agentId: ' agent-one ', enabled: false, order: 4, overrides: { name: 'Replacement' } },
    ]);

    expect(normalized.map(agent => agent.agentId)).toEqual([
      'agent-invalid',
      'agent-three',
      'agent-one',
    ]);
    expect(normalized.map(agent => agent.order)).toEqual([0, 1, 2]);
    expect(normalized).not.toContainEqual(expect.objectContaining({ agentId: '' }));
    expect(normalized[2]).toEqual({
      agentId: 'agent-one',
      enabled: false,
      order: 2,
      overrides: {
        name: 'Replacement',
      },
    });
  });

  test('normalizes oversized workspace chat search intent', () => {
    const normalized = normalizeWorkspaceChatResearchIntent({
      kind: 'search',
      query: 'x'.repeat(700),
      provider: 'unknown',
    });

    expect(normalized).toEqual({
      kind: 'search',
      query: 'x'.repeat(500),
      provider: 'auto',
    });
  });

  test('normalizes extract intents to http urls and ten items', () => {
    const urls = [
      'https://example.com/a',
      'ftp://example.com/b',
      'http://example.com/c',
      ...Array.from({ length: 20 }, (_, index) => `https://example.com/${index}`),
    ];

    const normalized = normalizeWorkspaceChatResearchIntent({
      kind: 'extract',
      urls,
      query: '  summarize competitor pages  ',
      provider: 'firecrawl',
    });

    expect(normalized.kind).toBe('extract');
    if (normalized.kind !== 'extract') throw new Error('Expected extract intent');
    expect(normalized.urls).toHaveLength(10);
    expect(normalized.urls).not.toContain('ftp://example.com/b');
    expect(normalized.query).toBe('summarize competitor pages');
    expect(normalized.provider).toBe('firecrawl');
  });

  test('caps extract intent query length', () => {
    const normalized = normalizeWorkspaceChatResearchIntent({
      kind: 'extract',
      urls: ['https://example.com/a'],
      query: ` ${'x'.repeat(700)} `,
      provider: 'tavily',
    });

    expect(normalized.kind).toBe('extract');
    if (normalized.kind !== 'extract') throw new Error('Expected extract intent');
    expect(normalized.query).toBe('x'.repeat(500));
  });

  test('normalizes domestic search intents with valid searchable source ids', () => {
    const normalized = normalizeWorkspaceChatResearchIntent({
      kind: 'domestic_search',
      query: ` ${'客户线索'.repeat(200)} `,
      sourceIds: ['bilibili', 'unknown', 'wechat_official_accounts', 'bilibili'],
    });

    expect(normalized).toEqual({
      kind: 'domestic_search',
      query: '客户线索'.repeat(125),
      sourceIds: ['bilibili', 'wechat_official_accounts'],
    });
  });

  test('drops domestic search intents without a query', () => {
    expect(normalizeWorkspaceChatResearchIntent({
      kind: 'domestic_search',
      query: ' ',
      sourceIds: ['bilibili'],
    })).toEqual({ kind: 'none' });
  });
});
