import Database from 'better-sqlite3';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  AgentExternalResearchMode,
  ExternalResearchProviderId,
} from '../../shared/agent/externalResearch';
import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadContentDeliveryMode,
  EnterpriseLeadRiskLevel,
  EnterpriseLeadRunStatus,
  EnterpriseLeadTaskStatus,
  EnterpriseLeadTodoKind,
  EnterpriseLeadWorkspaceAgentSource,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type { EnterpriseLeadWorkspaceDraft } from '../../shared/enterpriseLeadWorkspace/types';
import { buildDefaultEnterpriseLeadWorkspaceSettings } from '../../shared/enterpriseLeadWorkspace/validation';
import type { ModelClientAdapter, ModelGenerationInput } from '../industryPack/modelClientAdapter';
import { cleanModelJsonText, parseModelJsonObject } from './modelJson';
import {
  type EnterpriseLeadWorkspaceAgentProvider,
  type EnterpriseLeadWorkspaceAgentTemplate,
  type EnterpriseLeadWorkspaceResearchClient,
  EnterpriseLeadWorkspaceService,
} from './service';
import { EnterpriseLeadWorkspaceStore } from './store';
import { ENTERPRISE_LEAD_AGENT_WORKFLOW } from './workflow';

class FakeModelClient implements ModelClientAdapter {
  readonly prompts: ModelGenerationInput[] = [];

  private responses: Array<string | Promise<string>> = [];

  enqueue(value: unknown): void {
    this.responses.push(typeof value === 'string' ? value : JSON.stringify(value));
  }

  enqueuePending(): { resolve: (value: unknown) => void } {
    let resolveResponse: (value: string) => void = () => {};
    const response = new Promise<string>(resolve => {
      resolveResponse = resolve;
    });
    this.responses.push(response);

    return {
      resolve: (value: unknown) => {
        resolveResponse(typeof value === 'string' ? value : JSON.stringify(value));
      },
    };
  }

  async generate(input: ModelGenerationInput): Promise<{ text: string }> {
    this.prompts.push(input);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error('No fake model response queued');
    }
    const text = await response;
    return { text };
  }
}

const createAgentProvider = (
  agents: EnterpriseLeadWorkspaceAgentTemplate[] = [],
): EnterpriseLeadWorkspaceAgentProvider => ({
  listAgents: vi.fn(() => agents),
  getAgent: vi.fn((agentId: string) => agents.find(agent => agent.id === agentId) ?? null),
});

const createResearchClient = (
  overrides: Partial<EnterpriseLeadWorkspaceResearchClient> = {},
): EnterpriseLeadWorkspaceResearchClient => ({
  tavilySearch: vi.fn(async () => ({ results: [] })),
  tavilyExtract: vi.fn(async () => ({ results: [] })),
  firecrawlSearch: vi.fn(async () => ({ success: true, data: [] })),
  firecrawlScrape: vi.fn(async () => ({ success: true, data: { markdown: '' } })),
  domesticSearch: vi.fn(async () => ({ results: [] })),
  ...overrides,
});

const createService = (
  overrides: Partial<{
    store: EnterpriseLeadWorkspaceStore;
    modelClient: FakeModelClient;
    agentProvider: EnterpriseLeadWorkspaceAgentProvider;
    researchClient: EnterpriseLeadWorkspaceResearchClient;
    researchTimeoutMs: number;
  }> = {},
): {
  agentProvider: EnterpriseLeadWorkspaceAgentProvider;
  db: Database.Database;
  modelClient: FakeModelClient;
  researchClient: EnterpriseLeadWorkspaceResearchClient;
  service: EnterpriseLeadWorkspaceService;
  store: EnterpriseLeadWorkspaceStore;
} => {
  const db = new Database(':memory:');
  const store = overrides.store ?? new EnterpriseLeadWorkspaceStore(db);
  const modelClient = overrides.modelClient ?? new FakeModelClient();
  const agentProvider = overrides.agentProvider ?? createAgentProvider();
  const researchClient = overrides.researchClient ?? createResearchClient();
  return {
    agentProvider,
    db,
    modelClient,
    researchClient,
    service: new EnterpriseLeadWorkspaceService({
      store,
      modelClient,
      agentProvider,
      researchClient,
      ...(overrides.researchTimeoutMs === undefined
        ? {}
        : { researchTimeoutMs: overrides.researchTimeoutMs }),
    }),
    store,
  };
};

const draftPayload = (): EnterpriseLeadWorkspaceDraft => ({
  name: '华南重包获客工作台',
  type: 'ignored',
  profile: {
    companySummary: '工业包装供应商',
    productList: ['重型纸箱', '蜂窝纸板'],
    productCapabilities: ['抗压设计'],
    targetCustomers: ['机械设备厂'],
    applicationScenarios: ['出口运输'],
    sellingPoints: ['可替代木箱'],
    channelPreferences: ['微信'],
    prohibitedClaims: ['绝对防损'],
    contactRules: ['仅生成草稿'],
    missingInfo: ['案例图片'],
  },
  source: {
    kind: 'file',
    label: 'ignored',
    text: 'ignored',
  },
  enabledAgentRoles: [],
  workspaceAgents: [],
});

const draftPayloadWithWorkspaceModelConfig = (): EnterpriseLeadWorkspaceDraft => {
  const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
  settings.model = {
    defaultModel: 'gpt-4.1',
    defaultModelProvider: 'openai',
    providers: {
      openai: {
        enabled: true,
        apiKey: 'sk-workspace',
        baseUrl: 'https://api.openai.com/v1',
        apiFormat: 'openai',
        models: [{ id: 'gpt-4.1', name: 'GPT-4.1' }],
      },
    },
  };
  settings.skillIds = ['docx', 'web-search'];
  settings.externalResearch = {
    mode: AgentExternalResearchMode.Override,
    providers: {
      [ExternalResearchProviderId.Tavily]: { enabled: true, apiKey: 'tvly-workspace' },
      [ExternalResearchProviderId.Firecrawl]: { enabled: false, apiKey: '' },
    },
  };

  return {
    ...draftPayload(),
    settings,
  };
};

const markRunReadyToArchive = (store: EnterpriseLeadWorkspaceStore, runId: string): void => {
  const tasks = store.listTasks(runId);
  tasks.forEach(task => {
    store.updateTaskResult(task.id, {
      role: task.role,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: `${task.role} 已完成。`,
      outputs:
        task.role === EnterpriseLeadAgentRole.RiskReview
          ? {
              riskLevel: EnterpriseLeadRiskLevel.Low,
              canArchive: true,
            }
          : {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });
  });
  store.updateRunProgress({
    runId,
    status: EnterpriseLeadRunStatus.Completed,
    currentRole: null,
    controllerSummary: '本次任务已完成。',
  });
};

describe('EnterpriseLeadWorkspaceService', () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  test('extracts a workspace draft from conversation text', async () => {
    const setup = createService();
    db = setup.db;
    setup.modelClient.enqueue(draftPayload());

    const draft =
      await setup.service.extractDraftFromConversation('我们做重型纸箱，主要服务机械设备厂。');

    expect(draft.name).toBe('华南重包获客工作台');
    expect(draft.type).toBe('enterprise_lead');
    expect(draft.source).toEqual({
      kind: 'conversation',
      label: '对话输入',
      text: '我们做重型纸箱，主要服务机械设备厂。',
    });
    expect(draft.profile.productList).toEqual(['重型纸箱', '蜂窝纸板']);
    expect(setup.modelClient.prompts[0].prompt).toContain('对话输入');
    expect(setup.modelClient.prompts[0].prompt).toContain('只输出结构化 JSON');
  });

  test('creates and appends persisted workspace chat sessions', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    setup.modelClient.enqueue({ kind: 'none' });
    setup.modelClient.enqueue('可以，我来整理安装步骤。');

    const firstResponse = await setup.service.chat(workspace.id, {
      message: '安装 oh-my-claudecode skill',
    });

    expect(firstResponse.session?.title).toBe('安装 oh-my-claudecode skill');
    expect(firstResponse.session?.messages.map(message => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(setup.service.listChatSessions(workspace.id)).toEqual([
      {
        id: firstResponse.session!.id,
        workspaceId: workspace.id,
        title: '安装 oh-my-claudecode skill',
        createdAt: firstResponse.session!.createdAt,
        updatedAt: firstResponse.session!.updatedAt,
        messageCount: 2,
      },
    ]);

    setup.modelClient.enqueue({ kind: 'none' });
    setup.modelClient.enqueue('继续使用 GitHub 插件。');
    const secondResponse = await setup.service.chat(workspace.id, {
      sessionId: firstResponse.session!.id,
      message: '使用 GitHub 插件',
      recentMessages: firstResponse.session!.messages,
    });

    expect(secondResponse.session?.id).toBe(firstResponse.session?.id);
    expect(secondResponse.session?.messages.map(message => message.content)).toEqual([
      '安装 oh-my-claudecode skill',
      '可以，我来整理安装步骤。',
      '使用 GitHub 插件',
      '继续使用 GitHub 插件。',
    ]);
    expect(
      setup.service.getChatSession(workspace.id, firstResponse.session!.id)?.messageCount,
    ).toBe(4);
  });

  test('creates a new chat session with the user message before the assistant response completes', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const pendingPlanning = setup.modelClient.enqueuePending();

    const chatPromise = setup.service.chat(workspace.id, {
      message: '帮我判断这批客户谁更值得优先跟进',
    });

    const sessionsDuringPlanning = setup.service.listChatSessions(workspace.id);

    expect(sessionsDuringPlanning).toHaveLength(1);
    expect(sessionsDuringPlanning[0]).toMatchObject({
      workspaceId: workspace.id,
      title: '帮我判断这批客户谁更值得优先跟进',
      messageCount: 1,
    });
    expect(
      setup.service
        .getChatSession(workspace.id, sessionsDuringPlanning[0].id)
        ?.messages.map(message => message.content),
    ).toEqual(['帮我判断这批客户谁更值得优先跟进']);

    setup.modelClient.enqueue('商机雷达 Agent 回答。');
    pendingPlanning.resolve({ researchIntent: { kind: 'none' } });
    await chatPromise;
  });

  test('creates workspace and run with all workflow Agent tasks', async () => {
    const setup = createService();
    db = setup.db;

    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '找到本周可跟进的机械厂线索');

    expect(workspace.extractionSources).toEqual([
      {
        kind: 'file',
        label: 'ignored',
        text: 'ignored',
      },
    ]);
    expect(workspace.enabledAgentRoles).toEqual(
      ENTERPRISE_LEAD_AGENT_WORKFLOW.map(agent => agent.role),
    );
    expect(snapshot.currentRun?.userGoal).toBe('找到本周可跟进的机械厂线索');
    expect(snapshot.tasks.map(task => task.role)).toEqual(
      ENTERPRISE_LEAD_AGENT_WORKFLOW.map(agent => agent.role),
    );
  });

  test('creates runs from enabled workspace-owned Agents with immutable Agent snapshots', () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      workspaceAgents: [
        {
          agentId: 'agent-risk',
          enabled: true,
          order: 1,
          overrides: {
            name: 'Risk review Agent',
            description: 'Checks outbound claims',
            identity: 'Risk specialist',
            systemPrompt: 'Block risky promises',
            icon: 'shield',
            model: 'gpt-4.1-mini',
            skillIds: ['risk-check'],
          },
        },
        {
          agentId: 'agent-disabled',
          enabled: false,
          order: 2,
          overrides: {},
        },
        {
          agentId: 'agent-content',
          enabled: true,
          order: 0,
          overrides: {
            name: 'Workspace content Agent',
            description: 'Workspace content description',
            identity: 'Workspace identity',
            systemPrompt: 'Workspace-only execution prompt',
            model: 'gpt-4.1',
            skillIds: ['workspace-skill'],
          },
        },
      ],
    });

    const snapshot = setup.service.createRun(workspace.id, '按空间 Agent 执行获客任务');

    expect(snapshot.currentRun?.currentRole).toBe('agent-content');
    expect(snapshot.tasks.map(task => task.role)).toEqual(['agent-content', 'agent-risk']);
    expect(snapshot.tasks.map(task => task.workspaceAgentId)).toEqual([
      'agent-content',
      'agent-risk',
    ]);
    expect(snapshot.tasks[0].agentSnapshot).toMatchObject({
      agentId: 'agent-content',
      name: 'Workspace content Agent',
      description: 'Workspace content description',
      identity: 'Workspace identity',
      systemPrompt: 'Workspace-only execution prompt',
      model: 'gpt-4.1',
      skillIds: ['workspace-skill'],
    });
    expect(snapshot.tasks[1].agentSnapshot).toMatchObject({
      agentId: 'agent-risk',
      name: 'Risk review Agent',
      model: 'gpt-4.1-mini',
    });
  });

  test('createWorkspace preserves draft workspaceAgents', () => {
    const setup = createService();
    db = setup.db;

    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      workspaceAgents: [
        {
          agentId: 'global-agent-1',
          enabled: true,
          order: 0,
          overrides: {
            name: 'Workspace-only name',
            systemPrompt: 'Workspace-only prompt',
          },
        },
      ],
    });

    expect(workspace.workspaceAgents).toEqual([
      {
        agentId: 'global-agent-1',
        source: EnterpriseLeadWorkspaceAgentSource.WorkspaceCreated,
        enabled: true,
        order: 0,
        overrides: {
          name: 'Workspace-only name',
          systemPrompt: 'Workspace-only prompt',
        },
      },
    ]);
    expect(setup.store.getWorkspace(workspace.id)?.workspaceAgents).toEqual(
      workspace.workspaceAgents,
    );
  });

  test('createWorkspace initializes default workspace-owned execution Agents', () => {
    const setup = createService();
    db = setup.db;

    const workspace = setup.service.createWorkspace(draftPayload());

    expect(workspace.workspaceAgents.map(agent => agent.agentId)).toEqual(
      ENTERPRISE_LEAD_AGENT_WORKFLOW.map(agent => agent.role),
    );
    expect(workspace.workspaceAgents.every(agent => agent.enabled)).toBe(true);
    expect(
      workspace.workspaceAgents.find(
        agent => agent.agentId === EnterpriseLeadAgentRole.ProductUnderstanding,
      ),
    ).toMatchObject({
      agentId: EnterpriseLeadAgentRole.ProductUnderstanding,
      order: 1,
      overrides: {
        name: '产品理解 Agent',
        description: '整理产品画像、卖点、适合客户、应用场景和缺失资料。',
        icon: '产',
      },
    });
  });

  test('system template bindings resolve workflow defaults before workspace overrides', () => {
    const setup = createService();
    db = setup.db;

    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      workspaceAgents: [
        {
          agentId: EnterpriseLeadAgentRole.ContentPlanning,
          source: EnterpriseLeadWorkspaceAgentSource.SystemTemplate,
          templateId: EnterpriseLeadAgentRole.ContentPlanning,
          enabled: true,
          order: 0,
          overrides: {
            name: '本空间内容策划 Agent',
            model: 'gpt-4.1',
          },
        },
      ],
    });

    const snapshot = setup.service.createRun(workspace.id, '生成渠道内容');

    expect(snapshot.tasks[0].agentSnapshot).toMatchObject({
      agentId: EnterpriseLeadAgentRole.ContentPlanning,
      name: '本空间内容策划 Agent',
      description: '生成小红书、短视频、公众号、产品介绍和销售话术草稿。',
      identity: '内容策划 Agent',
      icon: '内',
      model: 'gpt-4.1',
      skillIds: [],
    });
    expect(snapshot.tasks[0].agentSnapshot?.systemPrompt).toContain(
      '输出：内容草稿、高风险表达、下游上下文',
    );
  });

  test('workspace-created bindings do not inherit matching global Agent templates', () => {
    const agentProvider = createAgentProvider([
      {
        id: 'agent-content',
        name: 'Global content Agent',
        description: 'Global content description',
        identity: 'Global identity',
        systemPrompt: 'Global system prompt',
        icon: 'global',
        model: 'global-model',
        skillIds: ['global-skill'],
        enabled: true,
      },
    ]);
    const setup = createService({ agentProvider });
    db = setup.db;

    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      workspaceAgents: [
        {
          agentId: 'agent-content',
          source: EnterpriseLeadWorkspaceAgentSource.WorkspaceCreated,
          enabled: true,
          order: 0,
          overrides: {
            name: 'Workspace content Agent',
          },
        },
      ],
    });

    const snapshot = setup.service.createRun(workspace.id, '只运行本空间 Agent');

    expect(snapshot.tasks[0].agentSnapshot).toEqual({
      agentId: 'agent-content',
      name: 'Workspace content Agent',
      description: '',
      identity: '',
      systemPrompt: '',
      icon: '',
      model: '',
      skillIds: [],
    });
    expect(agentProvider.getAgent).not.toHaveBeenCalled();
  });

  test('new runs snapshot edited workspace-owned Agent definitions', () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());

    const updated = setup.service.updateWorkspaceAgents(
      workspace.id,
      workspace.workspaceAgents.map(agent =>
        agent.agentId === EnterpriseLeadAgentRole.ProductUnderstanding
          ? {
              ...agent,
              overrides: {
                ...agent.overrides,
                name: '产品诊断 Agent',
                systemPrompt: '输出前必须指出产品资料缺口。',
              },
            }
          : agent,
      ),
    );
    const snapshot = setup.service.createRun(updated.id, '重新整理产品画像');
    const productTask = snapshot.tasks.find(
      task => task.role === EnterpriseLeadAgentRole.ProductUnderstanding,
    );

    expect(productTask?.workspaceAgentId).toBe(EnterpriseLeadAgentRole.ProductUnderstanding);
    expect(productTask?.agentSnapshot).toMatchObject({
      agentId: EnterpriseLeadAgentRole.ProductUnderstanding,
      name: '产品诊断 Agent',
      systemPrompt: '输出前必须指出产品资料缺口。',
    });
  });

  test('existing run Agent snapshots stay unchanged after workspace Agent edits', () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      workspaceAgents: [
        {
          agentId: 'agent-content',
          source: EnterpriseLeadWorkspaceAgentSource.WorkspaceCreated,
          enabled: true,
          order: 0,
          overrides: {
            name: 'Original content Agent',
            systemPrompt: 'Original prompt',
            model: 'gpt-original',
            skillIds: ['original-skill'],
          },
        },
      ],
    });

    const firstSnapshot = setup.service.createRun(workspace.id, '第一次运行');
    setup.service.updateWorkspaceAgents(workspace.id, [
      {
        agentId: 'agent-content',
        source: EnterpriseLeadWorkspaceAgentSource.WorkspaceCreated,
        enabled: true,
        order: 0,
        overrides: {
          name: 'Edited content Agent',
          systemPrompt: 'Edited prompt',
          model: 'gpt-edited',
          skillIds: ['edited-skill'],
        },
      },
    ]);
    const persistedFirstSnapshot = setup.service.getSnapshot(
      workspace.id,
      firstSnapshot.currentRun?.id,
    );
    const secondSnapshot = setup.service.createRun(workspace.id, '第二次运行');

    expect(persistedFirstSnapshot.tasks[0].agentSnapshot).toMatchObject({
      agentId: 'agent-content',
      name: 'Original content Agent',
      systemPrompt: 'Original prompt',
      model: 'gpt-original',
      skillIds: ['original-skill'],
    });
    expect(secondSnapshot.tasks[0].agentSnapshot).toMatchObject({
      agentId: 'agent-content',
      name: 'Edited content Agent',
      systemPrompt: 'Edited prompt',
      model: 'gpt-edited',
      skillIds: ['edited-skill'],
    });
  });

  test('updateWorkspaceAgents updates only workspace-local bindings', () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());

    const updated = setup.service.updateWorkspaceAgents(workspace.id, [
      {
        agentId: 'global-agent-1',
        enabled: true,
        order: 0,
        overrides: {
          name: 'Workspace-only name',
        },
      },
    ]);

    expect(updated).toMatchObject({
      id: workspace.id,
      name: workspace.name,
      enabledAgentRoles: workspace.enabledAgentRoles,
      settings: workspace.settings,
      workspaceAgents: [
        {
          agentId: 'global-agent-1',
          enabled: true,
          order: 0,
          overrides: {
            name: 'Workspace-only name',
          },
        },
      ],
    });
    expect(setup.store.getWorkspace(workspace.id)?.workspaceAgents[0].overrides.name).toBe(
      'Workspace-only name',
    );
  });

  test('creates a run only for enabled workspace-owned Agents', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    setup.service.updateWorkspaceAgents(
      workspace.id,
      workspace.workspaceAgents.filter(agent =>
        [EnterpriseLeadAgentRole.ContentPlanning, EnterpriseLeadAgentRole.RiskReview].includes(
          agent.agentId as EnterpriseLeadAgentRole,
        ),
      ),
    );

    const snapshot = setup.service.createRun(workspace.id, '输出小红书草稿并做风险检查');

    expect(snapshot.tasks.map(task => task.role)).toEqual([
      EnterpriseLeadAgentRole.ContentPlanning,
      EnterpriseLeadAgentRole.RiskReview,
    ]);
  });

  test('passes workspace model provider settings to Agent task generation', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayloadWithWorkspaceModelConfig());
    const snapshot = setup.service.createRun(workspace.id, '输出内容选题');
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.Controller,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '总控已完成拆解。',
      outputs: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });

    await setup.service.runTask(snapshot.tasks[0].id);

    expect(setup.modelClient.prompts.at(-1)?.apiConfig).toEqual({
      apiKey: 'sk-workspace',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4.1',
      apiType: 'openai',
    });
  });

  test('runs dynamic workspace Agent tasks with snapshot prompt and model config', async () => {
    const agentProvider = createAgentProvider([
      {
        id: 'agent-content',
        name: 'Global content Agent',
        description: 'Global content description',
        identity: 'Global identity',
        systemPrompt: 'Global prompt',
        icon: 'pen',
        model: 'gpt-4.1',
        skillIds: ['global-skill'],
        enabled: true,
      },
    ]);
    const setup = createService({ agentProvider });
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayloadWithWorkspaceModelConfig(),
      workspaceAgents: [
        {
          agentId: 'agent-content',
          enabled: true,
          order: 0,
          overrides: {
            name: 'Workspace content Agent',
            identity: 'Workspace execution identity',
            systemPrompt: 'Workspace-only execution prompt',
            model: 'gpt-4.1-mini',
          },
        },
      ],
    });
    const snapshot = setup.service.createRun(workspace.id, '输出内容选题');
    const task = snapshot.tasks[0];
    setup.modelClient.enqueue({
      role: task.role,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '动态 Agent 已完成。',
      outputs: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });

    await setup.service.runTask(task.id);

    const taskPrompt = setup.modelClient.prompts.at(-1)?.prompt ?? '';
    expect(taskPrompt).toContain('Workspace content Agent');
    expect(taskPrompt).toContain('Workspace execution identity');
    expect(taskPrompt).toContain('Workspace-only execution prompt');
    expect(setup.modelClient.prompts.at(-1)?.model).toBe('gpt-4.1-mini');

    setup.modelClient.enqueue({
      role: task.role,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '动态待确认版本已完成。',
      outputs: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });

    await setup.service.createPendingVersionFromChat(task.id, '换一个更稳的角度');

    const chatPrompt = setup.modelClient.prompts.at(-1)?.prompt ?? '';
    expect(chatPrompt).toContain('Workspace content Agent');
    expect(chatPrompt).toContain('Workspace-only execution prompt');
    expect(setup.modelClient.prompts.at(-1)?.model).toBe('gpt-4.1-mini');
  });

  test('excludes workspace provider secrets from Agent task prompts', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayloadWithWorkspaceModelConfig());
    const snapshot = setup.service.createRun(workspace.id, '输出内容选题');
    const task = snapshot.tasks[0];
    setup.modelClient.enqueue({
      role: task.role,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '任务已完成。',
      outputs: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });

    await setup.service.runTask(task.id);

    const taskPrompt = setup.modelClient.prompts.at(-1)?.prompt ?? '';
    expect(taskPrompt).toContain('工业包装供应商');
    expect(taskPrompt).toContain('docx');
    expect(taskPrompt).toContain('web-search');
    expect(taskPrompt).toContain('"configured": true');
    expect(taskPrompt).not.toContain('sk-workspace');
    expect(taskPrompt).not.toContain('tvly-workspace');
    expect(taskPrompt).not.toContain('"apiKey"');

    setup.modelClient.enqueue({
      role: task.role,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '待确认版本已完成。',
      outputs: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });

    await setup.service.createPendingVersionFromChat(task.id, '语气更稳一点');

    const chatPrompt = setup.modelClient.prompts.at(-1)?.prompt ?? '';
    expect(chatPrompt).toContain('工业包装供应商');
    expect(chatPrompt).toContain('"configured": true');
    expect(chatPrompt).not.toContain('sk-workspace');
    expect(chatPrompt).not.toContain('tvly-workspace');
    expect(chatPrompt).not.toContain('"apiKey"');
  });

  test('excludes content platform secrets from Agent task and chat prompts', async () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.contentPlatforms.platforms.xiaohongshu_draft = {
      ...settings.contentPlatforms.platforms.xiaohongshu_draft,
      enabled: true,
      deliveryMode: EnterpriseLeadContentDeliveryMode.ThirdPartyDraft,
      account: '启盛小红书',
      endpoint: 'https://draft.example.com/xhs',
      token: 'xhs-secret-token',
    };
    settings.contentPlatforms.outputRules.defaultPlatformId = 'xiaohongshu_draft';
    settings.contentPlatforms.outputRules.lengthPolicy = 'split';
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      settings,
    });
    const snapshot = setup.service.createRun(workspace.id, '输出小红书草稿');
    const task = snapshot.tasks[0];
    setup.modelClient.enqueue({
      role: task.role,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '任务已完成。',
      outputs: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });

    await setup.service.runTask(task.id);

    const taskPrompt = setup.modelClient.prompts.at(-1)?.prompt ?? '';
    expect(taskPrompt).toContain('"defaultPlatformId": "xiaohongshu_draft"');
    expect(taskPrompt).toContain('"deliveryMode": "third_party_draft"');
    expect(taskPrompt).toContain('"configured": true');
    expect(taskPrompt).toContain('"lengthPolicy": "split"');
    expect(taskPrompt).not.toContain('xhs-secret-token');
    expect(taskPrompt).not.toContain('https://draft.example.com/xhs');
    expect(taskPrompt).not.toContain('"token"');
    expect(taskPrompt).not.toContain('"endpoint"');

    setup.modelClient.enqueue({ researchIntent: { kind: 'none' } });
    setup.modelClient.enqueue('内容策划 Agent step。');
    setup.modelClient.enqueue('销售交接 Agent step。');
    setup.modelClient.enqueue('风控审核 Agent step。');
    setup.modelClient.enqueue('已按小红书输出规则回答。');

    await setup.service.chat(workspace.id, {
      message: '根据默认平台写一版触达内容',
    });

    const intentPrompt =
      setup.modelClient.prompts.find(prompt => prompt.prompt.includes('研究意图判断助手'))
        ?.prompt ?? '';
    const finalPrompt = setup.modelClient.prompts.at(-1)?.prompt ?? '';
    expect(intentPrompt).toContain('"defaultPlatformId": "xiaohongshu_draft"');
    expect(finalPrompt).toContain('"defaultPlatformId": "xiaohongshu_draft"');
    expect(finalPrompt).toContain('"deliveryMode": "third_party_draft"');
    expect(finalPrompt).toContain('"configured": true');
    setup.modelClient.prompts
      .map(prompt => prompt.prompt)
      .forEach(prompt => {
        expect(prompt).not.toContain('xhs-secret-token');
        expect(prompt).not.toContain('https://draft.example.com/xhs');
        expect(prompt).not.toContain('"token"');
        expect(prompt).not.toContain('"endpoint"');
      });
  });

  test('chat answers with workspace profile and effective workspace Agent override in prompts', async () => {
    const agentProvider = createAgentProvider([
      {
        id: 'agent-content',
        name: 'Global content Agent',
        description: 'Global content description',
        identity: 'Global identity',
        systemPrompt: 'Global system prompt',
        icon: 'pen',
        model: 'gpt-4.1',
        skillIds: ['global-skill'],
        enabled: true,
      },
    ]);
    const setup = createService({ agentProvider });
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      workspaceAgents: [
        {
          agentId: 'agent-content',
          enabled: true,
          order: 0,
          overrides: {
            name: 'Workspace content Agent',
            systemPrompt: 'Workspace-only content strategy',
            model: 'gpt-4.1',
            skillIds: ['workspace-skill'],
          },
        },
      ],
    });
    setup.modelClient.enqueue({ researchIntent: { kind: 'none' } });
    setup.modelClient.enqueue('这是基于工作台资料生成的回答。');

    const response = await setup.service.chat(workspace.id, {
      message: '帮我整理一下今天先做什么',
      targetAgentId: 'agent-content',
    });

    expect(response.message).toMatchObject({
      role: 'assistant',
      content: '这是基于工作台资料生成的回答。',
      agent: {
        id: 'agent-content',
        name: 'Workspace content Agent',
      },
      research: {
        status: 'skipped',
        intent: { kind: 'none' },
      },
    });
    expect(setup.modelClient.prompts).toHaveLength(2);
    expect(setup.modelClient.prompts[0].prompt).toContain('工业包装供应商');
    expect(setup.modelClient.prompts[0].prompt).toContain('Workspace content Agent');
    expect(setup.modelClient.prompts[0].prompt).toContain('Workspace-only content strategy');
    expect(setup.modelClient.prompts[0].prompt).not.toContain('[LobsterAI reply contract]');
    expect(setup.modelClient.prompts[1].prompt).toContain('工业包装供应商');
    expect(setup.modelClient.prompts[1].prompt).toContain('Workspace content Agent');
    expect(setup.modelClient.prompts[1].prompt).toContain('[LobsterAI reply contract]');
    expect(setup.modelClient.prompts[1].prompt).toContain('用中文自然回答');
    expect(setup.modelClient.prompts[1].prompt).toContain(
      '不得编造客户、联系人、认证、价格、交付、产能、案例或成本降低等事实',
    );
    expect(setup.modelClient.prompts[1].prompt).toContain(
      '明确区分工作空间已有资料、研究结果、建议和推测',
    );
    expect(setup.modelClient.prompts[1].model).toBe('gpt-4.1');
  });

  test('chat auto mode uses the workspace Agent selected by the planning response', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      workspaceAgents: [
        {
          agentId: 'agent-opportunity',
          enabled: true,
          order: 0,
          overrides: {
            name: '商机雷达 Agent',
            description: '判断客户方向、采购信号、商机评分和跟进优先级。',
            systemPrompt: '优先输出商机判断和跟进理由。',
            model: 'gpt-opportunity',
          },
        },
      ],
    });
    setup.modelClient.enqueue({
      targetAgentId: 'agent-opportunity',
      researchIntent: { kind: 'none' },
    });
    setup.modelClient.enqueue('我会直接按商机雷达 Agent 的职责给出判断。');

    const response = await setup.service.chat(workspace.id, {
      message: '帮我判断机械设备厂线索的商机优先级',
    });

    expect(response.message).toMatchObject({
      role: 'assistant',
      content: '我会直接按商机雷达 Agent 的职责给出判断。',
      agent: {
        id: 'agent-opportunity',
        name: '商机雷达 Agent',
      },
    });
    expect(setup.modelClient.prompts[0].prompt).toContain('targetAgentId');
    expect(setup.modelClient.prompts[0].prompt).toContain('不要建议用户去使用或切换 Agent');
    expect(setup.modelClient.prompts[1].prompt).toContain('你是当前工作空间中的 商机雷达 Agent');
    expect(setup.modelClient.prompts[1].model).toBe('gpt-opportunity');
  });

  [
    {
      message: '帮我判断客户方向和商机优先级',
      agentId: EnterpriseLeadAgentRole.OpportunityRadar,
      agentName: '商机雷达 Agent',
    },
    {
      message: '帮我写一版适合发给机械设备厂老板的私信',
      agentId: EnterpriseLeadAgentRole.ContentPlanning,
      agentName: '内容策划 Agent',
      expectedRoutingAgentNames: ['内容策划 Agent', '销售交接 Agent', '风控审核 Agent'],
      expectedRouteReason: '识别到：私信/外发文案',
    },
    {
      message: '帮我检查这段宣传文案有没有夸大风险：我们是行业第一，所有客户都能降本 50%。',
      agentId: EnterpriseLeadAgentRole.RiskReview,
      agentName: '风控审核 Agent',
    },
  ].forEach(({ message, agentId, agentName, expectedRoutingAgentNames, expectedRouteReason }) => {
    test(`chat auto mode falls back to ${agentName} when the planning response omits targetAgentId`, async () => {
      const setup = createService();
      db = setup.db;
      const workspace = setup.service.createWorkspace(draftPayload());
      setup.modelClient.enqueue({ researchIntent: { kind: 'none' } });
      if (expectedRoutingAgentNames) {
        setup.modelClient.enqueue('内容策划 Agent step。');
        setup.modelClient.enqueue('销售交接 Agent step。');
        setup.modelClient.enqueue('风控审核 Agent step。');
      }
      setup.modelClient.enqueue(`${agentName} 回答。`);

      const response = await setup.service.chat(workspace.id, { message });

      expect(response.message).toMatchObject({
        role: 'assistant',
        content: `${agentName} 回答。`,
        agent: {
          id: agentId,
          name: agentName,
        },
      });
      if (expectedRoutingAgentNames) {
        expect(response.message.routing).toMatchObject({
          reason: expectedRouteReason,
          agents: expectedRoutingAgentNames.map(name => ({
            name,
          })),
        });
      } else {
        expect(response.message.routing).toMatchObject({
          reason: expect.any(String),
          agents: [
            {
              id: agentId,
              name: agentName,
            },
          ],
        });
      }
      if (expectedRoutingAgentNames) {
        expect(setup.modelClient.prompts[0].prompt).not.toContain('[LobsterAI reply contract]');
        expect(setup.modelClient.prompts[1].prompt).toContain(`当前执行 Agent：${agentName}`);
        expect(setup.modelClient.prompts[1].prompt).toContain('[LobsterAI reply contract]');
        expect(setup.modelClient.prompts[1].prompt).toContain('外部动作只能生成草稿或审批建议');
        expect(setup.modelClient.prompts.at(-1)?.prompt).toContain(
          `你是当前工作空间中的 ${agentName}`,
        );
        expect(setup.modelClient.prompts[1].prompt).toContain('参与 Agent 链路');
        expectedRoutingAgentNames.forEach(name => {
          expect(setup.modelClient.prompts.at(-1)?.prompt).toContain(name);
        });
      } else {
        expect(setup.modelClient.prompts[1].prompt).toContain(`你是当前工作空间中的 ${agentName}`);
      }
    });
  });

  test('chat customer priority request uses workspace lead sources before asking for a list', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      source: {
        kind: 'file',
        label: '制造业客户名单.csv',
        text: [
          '客户名单',
          '杭州长江自动化设备有限公司｜自动化设备｜本周询价不锈钢支架｜月需求 500 套',
          '苏州恒力包装机械有限公司｜包装机械｜只问价格｜暂无图纸',
        ].join('\n'),
      },
    });
    setup.modelClient.enqueue({ researchIntent: { kind: 'none' } });
    setup.modelClient.enqueue('我会直接基于工作区客户名单排序。');

    const response = await setup.service.chat(workspace.id, {
      message: '帮我判断这批客户谁更值得优先跟进',
    });

    expect(response.message.content).toBe('我会直接基于工作区客户名单排序。');
    expect(response.message.agent).toEqual({
      id: EnterpriseLeadAgentRole.OpportunityRadar,
      name: '商机雷达 Agent',
    });
    expect(setup.modelClient.prompts).toHaveLength(2);
    expect(setup.modelClient.prompts[0].prompt).toContain('工作区可用线索');
    expect(setup.modelClient.prompts[1].prompt).toContain('工作区可用线索');
    expect(setup.modelClient.prompts[1].prompt).toContain('制造业客户名单.csv');
    expect(setup.modelClient.prompts[1].prompt).toContain('杭州长江自动化设备有限公司');
    expect(setup.modelClient.prompts[1].prompt).toContain(
      '请直接基于这些线索评分、排序和给出跟进建议',
    );
  });

  test('chat customer priority request gives a short input prompt when workspace has no leads', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    setup.modelClient.enqueue({ researchIntent: { kind: 'none' } });

    const response = await setup.service.chat(workspace.id, {
      message: '帮我判断这批客户谁更值得优先跟进',
    });

    expect(response.message).toMatchObject({
      role: 'assistant',
      agent: {
        id: EnterpriseLeadAgentRole.OpportunityRadar,
        name: '商机雷达 Agent',
      },
      routing: {
        reason: '识别到：客户优先级/商机判断',
        agents: [
          {
            id: EnterpriseLeadAgentRole.OpportunityRadar,
            name: '商机雷达 Agent',
          },
        ],
      },
    });
    expect(response.message.content).toContain('当前工作区还没有可用于排序的客户名单');
    expect(response.message.content).toContain('公司名 + 行业/产品 + 需求或沟通信号');
    expect(response.message.content).not.toContain('客户类型与匹配度');
    expect(setup.modelClient.prompts).toHaveLength(1);
  });

  test('chat auto mode executes private-message routes through multiple Agent steps before final synthesis', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    setup.modelClient.enqueue({ researchIntent: { kind: 'none' } });
    setup.modelClient.enqueue('内容策划 Agent：先生成机械设备厂老板私信草稿。');
    setup.modelClient.enqueue('销售交接 Agent：补充开场、跟进节奏和异议处理。');
    setup.modelClient.enqueue('风控审核 Agent：删除绝对化承诺并保留审批提醒。');
    setup.modelClient.enqueue('最终私信：您好，我们可以先按您的设备结构做一版加工方案草稿。');

    const response = await setup.service.chat(workspace.id, {
      message: '帮我写一版适合发给机械设备厂老板的私信',
    });

    expect(response.message).toMatchObject({
      role: 'assistant',
      content: '最终私信：您好，我们可以先按您的设备结构做一版加工方案草稿。',
      agent: {
        id: EnterpriseLeadAgentRole.ContentPlanning,
        name: '内容策划 Agent',
      },
      routing: {
        reason: '识别到：私信/外发文案',
        agents: [
          { id: EnterpriseLeadAgentRole.ContentPlanning, name: '内容策划 Agent' },
          { id: EnterpriseLeadAgentRole.SalesHandoff, name: '销售交接 Agent' },
          { id: EnterpriseLeadAgentRole.RiskReview, name: '风控审核 Agent' },
        ],
      },
    });
    expect((response.message.routing as any)?.steps).toEqual([
      {
        agent: { id: EnterpriseLeadAgentRole.ContentPlanning, name: '内容策划 Agent' },
        content: '内容策划 Agent：先生成机械设备厂老板私信草稿。',
      },
      {
        agent: { id: EnterpriseLeadAgentRole.SalesHandoff, name: '销售交接 Agent' },
        content: '销售交接 Agent：补充开场、跟进节奏和异议处理。',
      },
      {
        agent: { id: EnterpriseLeadAgentRole.RiskReview, name: '风控审核 Agent' },
        content: '风控审核 Agent：删除绝对化承诺并保留审批提醒。',
      },
    ]);
    expect(setup.modelClient.prompts).toHaveLength(5);
    expect(setup.modelClient.prompts[1].prompt).toContain('当前执行 Agent：内容策划 Agent');
    expect(setup.modelClient.prompts[2].prompt).toContain('当前执行 Agent：销售交接 Agent');
    expect(setup.modelClient.prompts[2].prompt).toContain(
      '内容策划 Agent：先生成机械设备厂老板私信草稿。',
    );
    expect(setup.modelClient.prompts[3].prompt).toContain('当前执行 Agent：风控审核 Agent');
    expect(setup.modelClient.prompts[3].prompt).toContain(
      '销售交接 Agent：补充开场、跟进节奏和异议处理。',
    );
    expect(setup.modelClient.prompts[4].prompt).toContain('多 Agent 中间结果');
    expect(setup.modelClient.prompts[4].prompt).toContain(
      '风控审核 Agent：删除绝对化承诺并保留审批提醒。',
    );
  });

  test('chat risk review asks for copy when no review text is provided', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    setup.modelClient.enqueue({ researchIntent: { kind: 'none' } });

    const response = await setup.service.chat(workspace.id, {
      message: '帮我检查这段宣传文案有没有夸大风险',
    });

    expect(response.message).toMatchObject({
      role: 'assistant',
      content: [
        '可以，我会按风控审核 Agent 来检查。',
        '',
        '请把待审宣传文案粘贴过来，最好包含标题、正文、落款和拟发布渠道。',
        '',
        '收到后我会输出风险等级、问题句、风险原因、修改建议和可外发版本。',
      ].join('\n'),
      agent: {
        id: EnterpriseLeadAgentRole.RiskReview,
        name: '风控审核 Agent',
      },
      research: {
        status: 'skipped',
        summary: '未请求外部调研。',
      },
    });
    expect(setup.modelClient.prompts).toHaveLength(1);
  });

  test('chat auto mode ignores planning target Agent ids outside the workspace', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      workspaceAgents: [
        {
          agentId: 'agent-content',
          enabled: true,
          order: 0,
          overrides: {
            name: '内容策划 Agent',
          },
        },
      ],
    });
    setup.modelClient.enqueue({
      targetAgentId: 'unbound-agent',
      researchIntent: { kind: 'none' },
    });
    setup.modelClient.enqueue('通用助手回答。');

    const response = await setup.service.chat(workspace.id, {
      message: '帮我看看下一步',
    });

    expect(response.message.agent).toBeUndefined();
    expect(setup.modelClient.prompts[1].prompt).not.toContain('unbound-agent');
    expect(setup.modelClient.prompts[1].model).toBeUndefined();
  });

  test('chat still answers when requested search research is unconfigured', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    setup.modelClient.enqueue({
      researchIntent: {
        kind: 'search',
        query: '机械设备厂 重型纸箱 采购',
        provider: 'auto',
      },
    });
    setup.modelClient.enqueue('目前没有可用搜索能力，但可以先基于工作台资料推进。');

    const response = await setup.service.chat(workspace.id, {
      message: '查一下机械设备厂线索',
    });

    expect(response.message.content).toBe('目前没有可用搜索能力，但可以先基于工作台资料推进。');
    expect(response.message.research).toMatchObject({
      status: 'failed',
      intent: {
        kind: 'search',
        query: '机械设备厂 重型纸箱 采购',
        provider: 'auto',
      },
    });
    expect(response.message.research?.summary).toMatch(/unavailable|unconfigured|not configured/i);
    expect(setup.researchClient.tavilySearch).not.toHaveBeenCalled();
    expect(setup.researchClient.firecrawlSearch).not.toHaveBeenCalled();
  });

  test('chat still answers when external search research times out', async () => {
    vi.useFakeTimers();
    try {
      const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
      settings.externalResearch = {
        mode: AgentExternalResearchMode.Override,
        providers: {
          [ExternalResearchProviderId.Tavily]: { enabled: true, apiKey: 'tvly-workspace' },
          [ExternalResearchProviderId.Firecrawl]: { enabled: false, apiKey: '' },
        },
      };
      const researchClient = createResearchClient({
        tavilySearch: vi.fn(() => new Promise(() => {})),
      });
      const setup = createService({ researchClient, researchTimeoutMs: 5 });
      db = setup.db;
      const workspace = setup.service.createWorkspace({
        ...draftPayload(),
        settings,
      });
      setup.modelClient.enqueue({
        researchIntent: {
          kind: 'search',
          query: '机械设备厂 重型纸箱 采购',
          provider: 'tavily',
        },
      });
      setup.modelClient.enqueue('调研超时后仍然基于工作台资料回答。');

      let response: Awaited<ReturnType<EnterpriseLeadWorkspaceService['chat']>> | undefined;
      void setup.service
        .chat(workspace.id, {
          message: '查一下机械设备厂线索',
        })
        .then(result => {
          response = result;
        });

      await vi.advanceTimersByTimeAsync(6);
      await Promise.resolve();

      expect(response?.message.content).toBe('调研超时后仍然基于工作台资料回答。');
      expect(response?.message.research).toMatchObject({
        status: 'failed',
        intent: {
          kind: 'search',
          query: '机械设备厂 重型纸箱 采购',
          provider: 'tavily',
        },
      });
      expect(response?.message.research?.summary).toContain('timed out');
      expect(researchClient.tavilySearch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('chat research planning prompt includes configured workspace research capabilities', async () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.externalResearch = {
      mode: AgentExternalResearchMode.Override,
      providers: {
        [ExternalResearchProviderId.Tavily]: { enabled: true, apiKey: 'tvly-workspace' },
        [ExternalResearchProviderId.Firecrawl]: { enabled: false, apiKey: '' },
      },
    };
    settings.domesticResearch.sources.bilibili.enabled = true;
    settings.domesticResearch.sources.bilibili.modes = ['search'];
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      settings,
    });
    setup.modelClient.enqueue({ researchIntent: { kind: 'none' } });
    setup.modelClient.enqueue('已按当前空间能力回答。');

    await setup.service.chat(workspace.id, {
      message: '按当前空间能力查一下客户线索',
    });

    const intentPrompt = setup.modelClient.prompts[0].prompt;
    const finalPrompt = setup.modelClient.prompts[1].prompt;
    expect(intentPrompt).toContain('"externalResearch"');
    expect(intentPrompt).toContain('"tavily"');
    expect(intentPrompt).toContain('"configured": true');
    expect(intentPrompt).toContain('"firecrawl"');
    expect(intentPrompt).toContain('"configured": false');
    expect(intentPrompt).toContain('"domesticResearch"');
    expect(intentPrompt).toContain('"bilibili"');
    expect(intentPrompt).not.toContain('tvly-workspace');
    expect(intentPrompt).not.toContain('"apiKey"');
    expect(finalPrompt).toContain('"externalResearch"');
    expect(finalPrompt).not.toContain('tvly-workspace');
    expect(finalPrompt).not.toContain('"apiKey"');
  });

  test('chat falls back to configured external research for customer opportunity requests when planning omits research', async () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.externalResearch = {
      mode: AgentExternalResearchMode.Override,
      providers: {
        [ExternalResearchProviderId.Tavily]: { enabled: true, apiKey: 'tvly-workspace' },
        [ExternalResearchProviderId.Firecrawl]: { enabled: false, apiKey: '' },
      },
    };
    const researchClient = createResearchClient({
      tavilySearch: vi.fn(async (_apiKey: string, query: string) => ({
        results: [
          {
            title: '杭州长江自动化设备有限公司采购信号',
            url: 'https://example.com/hangzhou-changjiang',
            content: `杭州长江自动化设备有限公司正在采购自动化设备支架，${query} 的公开线索`,
          },
          {
            title: '自动化设备厂客户类型线索',
            content: '自动化设备厂通常关注非标支架、钣金外壳和设备机箱。',
          },
        ],
      })),
    });
    const setup = createService({ researchClient });
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      settings,
    });
    setup.modelClient.enqueue({ researchIntent: { kind: 'none' } });
    setup.modelClient.enqueue('已结合调研结果判断客户优先级。');

    const response = await setup.service.chat(workspace.id, {
      message: '帮我判断这批客户谁更值得优先跟进',
    });

    expect(response.message.content).toBe('已结合调研结果判断客户优先级。');
    expect(response.message.research).toMatchObject({
      status: 'completed',
      provider: 'tavily',
      intent: {
        kind: 'search',
        provider: 'auto',
      },
    });
    expect(response.message.research?.summary).toContain('1 个具体公司');
    expect(response.message.research?.summary).toContain('1 条客户类型线索');
    expect(response.message.research?.summary).not.toBe('未请求外部调研。');
    expect(response.message.routing?.agents.map(agent => agent.name)).toEqual([
      '调研助手 Agent',
      '商机雷达 Agent',
    ]);
    expect((response.message.research as any)?.leadCandidates).toEqual([
      expect.objectContaining({
        kind: 'company',
        name: '杭州长江自动化设备有限公司',
        sourceTitle: '杭州长江自动化设备有限公司采购信号',
        sourceUrl: 'https://example.com/hangzhou-changjiang',
        confidence: 'high',
      }),
      expect.objectContaining({
        kind: 'category',
        name: '自动化设备厂客户类型线索',
        confidence: 'low',
      }),
    ]);
    expect(researchClient.tavilySearch).toHaveBeenCalledTimes(1);
    expect(researchClient.tavilySearch).toHaveBeenCalledWith(
      'tvly-workspace',
      expect.stringContaining('帮我判断这批客户谁更值得优先跟进'),
      5,
    );
    expect(setup.modelClient.prompts[1].prompt).toContain('杭州长江自动化设备有限公司采购信号');
    expect(setup.modelClient.prompts[1].prompt).toContain('leadCandidates');
    expect(setup.modelClient.prompts[1].prompt).toContain('不得输出“模拟客户”');
    expect(setup.modelClient.prompts[1].prompt).toContain(
      '只能基于工作区可用线索或研究结果中的真实公司',
    );
    expect(setup.modelClient.prompts[1].prompt).toContain('未拿到具体公司名单');
  });

  test('chat does not simulate customer ranking when research has no concrete companies', async () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.externalResearch = {
      mode: AgentExternalResearchMode.Override,
      providers: {
        [ExternalResearchProviderId.Tavily]: { enabled: false, apiKey: '' },
        [ExternalResearchProviderId.Firecrawl]: { enabled: true, apiKey: 'fc-workspace' },
      },
    };
    const researchClient = createResearchClient({
      firecrawlSearch: vi.fn(async () => ({
        success: true,
        data: [
          {
            title: '自动化设备厂客户类型线索',
            markdown: '自动化设备厂通常关注非标支架、钣金外壳和设备机箱，但没有具体公司名称。',
          },
          {
            title: '工程配套客户方向',
            markdown: '工程配套项目可能采购固定板、安装底座和承重连接件。',
          },
        ],
      })),
    });
    const setup = createService({ researchClient });
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      settings,
    });
    setup.modelClient.enqueue({ researchIntent: { kind: 'none' } });

    const response = await setup.service.chat(workspace.id, {
      message: '帮我判断这批客户谁更值得优先跟进',
    });

    expect(response.message.content).toContain('未拿到具体公司名单');
    expect(response.message.content).toContain('不能把客户类型包装成真实客户来排序');
    expect(response.message.content).not.toContain('示例线索');
    expect(response.message.content).not.toContain('模拟');
    expect(response.message.research).toMatchObject({
      status: 'completed',
      provider: 'firecrawl',
    });
    expect(response.message.routing?.agents.map(agent => agent.name)).toEqual([
      '调研助手 Agent',
      '商机雷达 Agent',
    ]);
    expect(setup.modelClient.prompts).toHaveLength(1);
  });

  test('chat treats workspace customer profiles as directions, not sortable customer lists', async () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.externalResearch = {
      mode: AgentExternalResearchMode.Override,
      providers: {
        [ExternalResearchProviderId.Tavily]: { enabled: false, apiKey: '' },
        [ExternalResearchProviderId.Firecrawl]: { enabled: true, apiKey: 'fc-workspace' },
      },
    };
    const researchClient = createResearchClient({
      firecrawlSearch: vi.fn(async () => ({
        success: true,
        data: [
          {
            title: '机械设备厂客户画像',
            markdown: '机械设备厂、外贸公司和工程承包商是适合开发的客户类型，但没有具体公司名称。',
          },
        ],
      })),
    });
    const setup = createService({ researchClient });
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      source: {
        kind: 'conversation',
        label: '产品理解 Agent 输出',
        text: [
          '客户类型线索',
          '目标客户画像：机械设备厂、外贸公司、工程承包商。',
          '这些方向适合采购精密金属支架、钣金外壳和安装底座。',
        ].join('\n'),
      },
      settings,
    });
    setup.modelClient.enqueue({ researchIntent: { kind: 'none' } });

    const response = await setup.service.chat(workspace.id, {
      message: '帮我判断这批客户谁更值得优先跟进',
    });

    expect(response.message.content).toContain('未拿到具体公司名单');
    expect(response.message.content).toContain('不能把客户类型包装成真实客户来排序');
    expect(response.message.content).not.toContain('杭州锐途');
    expect(response.message.content).not.toContain('示例客户');
    expect(response.message.research).toMatchObject({
      status: 'completed',
      provider: 'firecrawl',
    });
    expect(setup.modelClient.prompts).toHaveLength(1);
  });

  test('chat executes domestic platform search with workspace-enabled searchable sources', async () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.domesticResearch.sources.bilibili.enabled = true;
    settings.domesticResearch.sources.bilibili.modes = ['search'];
    settings.domesticResearch.sources.wechat_official_accounts.enabled = true;
    settings.domesticResearch.sources.wechat_official_accounts.modes = ['search'];
    settings.domesticResearch.sources.xiaohongshu.enabled = true;
    settings.domesticResearch.sources.xiaohongshu.modes = ['url_import'];
    const researchClient = createResearchClient({
      domesticSearch: vi.fn(async (sourceId: string, query: string) => ({
        sourceId,
        query,
        results: [`${sourceId}-result`],
      })),
    });
    const setup = createService({ researchClient });
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      settings,
    });
    setup.modelClient.enqueue({
      researchIntent: {
        kind: 'domestic_search',
        query: '自动化设备厂 精密支架',
        sourceIds: ['bilibili', 'wechat_official_accounts', 'xiaohongshu', 'unknown'],
      },
    });
    setup.modelClient.enqueue('已结合国内平台搜索结果回答。');

    const response = await setup.service.chat(workspace.id, {
      message: '查一下国内平台有没有自动化设备厂线索',
    });

    expect(response.message.research).toMatchObject({
      status: 'completed',
      provider: 'domestic',
      intent: {
        kind: 'domestic_search',
        query: '自动化设备厂 精密支架',
        sourceIds: ['bilibili', 'wechat_official_accounts'],
      },
    });
    expect(researchClient.domesticSearch).toHaveBeenCalledTimes(2);
    expect(researchClient.domesticSearch).toHaveBeenCalledWith(
      'bilibili',
      '自动化设备厂 精密支架',
      5,
    );
    expect(researchClient.domesticSearch).toHaveBeenCalledWith(
      'wechat_official_accounts',
      '自动化设备厂 精密支架',
      5,
    );
    expect(researchClient.domesticSearch).not.toHaveBeenCalledWith(
      'xiaohongshu',
      '自动化设备厂 精密支架',
      5,
    );
    expect(setup.modelClient.prompts[1].prompt).toContain('bilibili-result');
    expect(setup.modelClient.prompts[1].prompt).toContain('wechat_official_accounts-result');
  });

  test('chat normalizes extract URLs and provider before research calls', async () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.externalResearch = {
      mode: AgentExternalResearchMode.Override,
      providers: {
        [ExternalResearchProviderId.Tavily]: { enabled: true, apiKey: 'tvly-workspace' },
        [ExternalResearchProviderId.Firecrawl]: { enabled: true, apiKey: 'fc-workspace' },
      },
    };
    const researchClient = createResearchClient({
      firecrawlScrape: vi.fn(async () => ({
        success: true,
        data: { markdown: 'valid page content' },
      })),
    });
    const setup = createService({ researchClient });
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      settings,
    });
    setup.modelClient.enqueue({
      researchIntent: {
        kind: 'extract',
        urls: ['ftp://example.com/bad', 'https://example.com/a'],
        query: '提取客户信息',
        provider: 'bad-provider',
      },
    });
    setup.modelClient.enqueue('已基于有效页面内容整理。');

    const response = await setup.service.chat(workspace.id, {
      message: '提取这些页面的有效信息',
    });

    expect(response.message.research).toMatchObject({
      status: 'completed',
      provider: 'firecrawl',
      intent: {
        kind: 'extract',
        urls: ['https://example.com/a'],
        query: '提取客户信息',
        provider: 'auto',
      },
    });
    expect(researchClient.firecrawlScrape).toHaveBeenCalledTimes(1);
    expect(researchClient.firecrawlScrape).toHaveBeenCalledWith(
      'fc-workspace',
      'https://example.com/a',
    );
    expect(researchClient.tavilyExtract).not.toHaveBeenCalled();
    expect(researchClient.firecrawlScrape).not.toHaveBeenCalledWith(
      'fc-workspace',
      'ftp://example.com/bad',
    );
  });

  test('chat ignores target Agent ids that are not bound to the workspace', async () => {
    const agentProvider = createAgentProvider([
      {
        id: 'unbound-global-agent',
        name: 'Unbound global Agent',
        description: 'This Agent is not part of the workspace',
        identity: 'Unbound identity',
        systemPrompt: 'Unbound secret prompt',
        icon: 'sparkles',
        model: 'unbound-model',
        skillIds: ['unbound-skill'],
        enabled: true,
      },
    ]);
    const setup = createService({ agentProvider });
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    setup.modelClient.enqueue({ researchIntent: { kind: 'none' } });
    setup.modelClient.enqueue('通用助手回答。');

    const response = await setup.service.chat(workspace.id, {
      message: '用这个 Agent 帮我回答',
      targetAgentId: 'unbound-global-agent',
    });

    expect(response.message.agent).toBeUndefined();
    expect(setup.modelClient.prompts[1].prompt).not.toContain('Unbound global Agent');
    expect(setup.modelClient.prompts[1].prompt).not.toContain('Unbound secret prompt');
    expect(setup.modelClient.prompts[1].prompt).not.toContain('unbound-model');
    expect(setup.modelClient.prompts[1].model).toBeUndefined();
  });

  test('chat sanitizes fresh research payload before building the final prompt', async () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.externalResearch = {
      mode: AgentExternalResearchMode.Override,
      providers: {
        [ExternalResearchProviderId.Tavily]: { enabled: true, apiKey: 'tvly-workspace' },
        [ExternalResearchProviderId.Firecrawl]: { enabled: false, apiKey: '' },
      },
    };
    const oversizedRawPage = 'oversized-raw-page'.repeat(500);
    const researchClient = createResearchClient({
      tavilySearch: vi.fn(async () => ({
        answer: '公开资料摘要',
        apiKey: 'FAKE_PROVIDER_SECRET',
        nested: {
          rawHtml: oversizedRawPage,
        },
        results: [
          {
            title: '可用公开结果',
            url: 'https://example.com/lead',
            content: '公开网页摘要',
          },
        ],
      })),
    });
    const setup = createService({ researchClient });
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      settings,
    });
    setup.modelClient.enqueue({
      researchIntent: {
        kind: 'search',
        query: '重型纸箱 采购',
        provider: 'tavily',
      },
    });
    setup.modelClient.enqueue('已结合安全摘要回答。');

    const response = await setup.service.chat(workspace.id, {
      message: '搜索并总结',
    });

    const finalPrompt = setup.modelClient.prompts[1].prompt;
    expect(response.message.research?.payload).toEqual(
      expect.objectContaining({
        answer: '公开资料摘要',
        apiKey: 'FAKE_PROVIDER_SECRET',
      }),
    );
    expect(finalPrompt).toContain('tavily search completed for: 重型纸箱 采购');
    expect(finalPrompt).toContain('公开网页摘要');
    expect(finalPrompt).not.toContain('FAKE_PROVIDER_SECRET');
    expect(finalPrompt).not.toContain('oversized-raw-page');
  });

  test('chat redacts workspace research secrets from failed research summaries and prompts', async () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.externalResearch = {
      mode: AgentExternalResearchMode.Override,
      providers: {
        [ExternalResearchProviderId.Tavily]: { enabled: true, apiKey: 'tvly-workspace-secret' },
        [ExternalResearchProviderId.Firecrawl]: { enabled: true, apiKey: 'fc-workspace-secret' },
      },
    };
    const researchClient = createResearchClient({
      tavilySearch: vi.fn(async () => {
        throw new Error(
          'Provider HTTP 401 Authorization: Bearer tvly-workspace-secret apiKey=fc-workspace-secret',
        );
      }),
    });
    const setup = createService({ researchClient });
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      settings,
    });
    setup.modelClient.enqueue({
      researchIntent: {
        kind: 'search',
        query: '重型纸箱 采购',
        provider: 'tavily',
      },
    });
    setup.modelClient.enqueue('研究失败后仍然基于工作台资料回答。');

    const response = await setup.service.chat(workspace.id, {
      message: '搜索一下采购信息',
    });

    const finalPrompt = setup.modelClient.prompts[1].prompt;
    expect(response.message.research).toMatchObject({
      status: 'failed',
    });
    expect(response.message.research?.summary).toContain('[redacted]');
    expect(response.message.research?.summary).not.toContain('tvly-workspace-secret');
    expect(response.message.research?.summary).not.toContain('fc-workspace-secret');
    expect(finalPrompt).not.toContain('tvly-workspace-secret');
    expect(finalPrompt).not.toContain('fc-workspace-secret');
  });

  test('chat redacts workspace research secrets from recent message summaries before prompting', async () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.externalResearch = {
      mode: AgentExternalResearchMode.Override,
      providers: {
        [ExternalResearchProviderId.Tavily]: { enabled: true, apiKey: 'recent-tvly-secret' },
        [ExternalResearchProviderId.Firecrawl]: { enabled: false, apiKey: '' },
      },
    };
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      settings,
    });
    setup.modelClient.enqueue({ researchIntent: { kind: 'none' } });
    setup.modelClient.enqueue('已基于安全历史摘要回答。');

    await setup.service.chat(workspace.id, {
      message: '继续刚才的问题',
      recentMessages: [
        {
          id: 'assistant-history',
          role: 'assistant',
          content: '上一轮研究失败',
          createdAt: '2026-07-05T00:00:00.000Z',
          research: {
            intent: { kind: 'search', query: '包装采购', provider: 'tavily' },
            status: 'failed',
            provider: 'tavily',
            summary: 'Previous failure Authorization: Bearer recent-tvly-secret',
            payload: {
              raw: 'should not be forwarded from recent message',
            },
          },
        },
      ],
    });

    const intentPrompt = setup.modelClient.prompts[0].prompt;
    const finalPrompt = setup.modelClient.prompts[1].prompt;
    expect(intentPrompt).toContain('Previous failure Authorization: Bearer [redacted]');
    expect(intentPrompt).not.toContain('recent-tvly-secret');
    expect(intentPrompt).not.toContain('should not be forwarded from recent message');
    expect(finalPrompt).toContain('Previous failure Authorization: Bearer [redacted]');
    expect(finalPrompt).not.toContain('recent-tvly-secret');
    expect(finalPrompt).not.toContain('should not be forwarded from recent message');
  });

  test('chat sanitizes recent run outputs before building prompts', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '整理最近运行输出');
    const task = snapshot.tasks[0];
    setup.store.updateTaskResult(task.id, {
      role: task.role,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '安全任务摘要',
      outputs: {
        safeInsight: '安全线索摘要',
        apiKey: 'RUN_OUTPUT_SECRET',
        token: 'RUN_OUTPUT_TOKEN',
        rawDump: 'large-raw-run-output'.repeat(500),
      },
      missingInfo: ['缺少客户行业'],
      todos: [
        {
          kind: EnterpriseLeadTodoKind.MissingInfo,
          title: '安全待办',
          description: '补充行业信息',
          role: task.role,
        },
      ],
      risks: [
        {
          level: EnterpriseLeadRiskLevel.Low,
          title: '安全风险',
          description: '需要确认来源',
          role: task.role,
        },
      ],
      handoffContext: {},
    });
    setup.modelClient.enqueue({ researchIntent: { kind: 'none' } });
    setup.modelClient.enqueue('已结合最近运行摘要回答。');

    await setup.service.chat(workspace.id, {
      message: '结合最近运行结果回答',
    });

    const intentPrompt = setup.modelClient.prompts[0].prompt;
    const finalPrompt = setup.modelClient.prompts[1].prompt;
    expect(intentPrompt).toContain('安全任务摘要');
    expect(intentPrompt).toContain('安全线索摘要');
    expect(intentPrompt).not.toContain('RUN_OUTPUT_SECRET');
    expect(intentPrompt).not.toContain('RUN_OUTPUT_TOKEN');
    expect(intentPrompt).not.toContain('large-raw-run-output');
    expect(finalPrompt).toContain('安全任务摘要');
    expect(finalPrompt).toContain('安全线索摘要');
    expect(finalPrompt).not.toContain('RUN_OUTPUT_SECRET');
    expect(finalPrompt).not.toContain('RUN_OUTPUT_TOKEN');
    expect(finalPrompt).not.toContain('large-raw-run-output');
  });

  test('creates a pending Agent version and applies it to the snapshot', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '优化私信草稿');
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.SocialOperation);
    if (!task) throw new Error('Expected social operation task');
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.SocialOperation,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '更新后的私信草稿。',
      outputs: {
        draft: '您好，我们可以先根据尺寸做包装建议。',
      },
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {
        approvedByUser: true,
      },
    });

    const pendingVersion = await setup.service.createPendingVersionFromChat(
      task.id,
      '语气更稳一点',
    );
    const appliedSnapshot = setup.service.applyPendingVersion(pendingVersion.id);

    expect(pendingVersion.status).toBe('pending');
    expect(appliedSnapshot.tasks.find(item => item.id === task.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '更新后的私信草稿。',
      outputPayload: {
        draft: '您好，我们可以先根据尺寸做包装建议。',
      },
    });
    expect(appliedSnapshot.pendingVersions[0]).toMatchObject({
      id: pendingVersion.id,
      status: 'applied',
    });
  });

  test('applying a pending Agent version marks downstream tasks stale in the service snapshot', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '完成从内容到销售交接');
    const contentTask = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.ContentPlanning,
    );
    const socialTask = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.SocialOperation,
    );
    const salesTask = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.SalesHandoff,
    );
    if (!contentTask || !socialTask || !salesTask) {
      throw new Error('Expected downstream tasks');
    }
    setup.store.updateTaskResult(socialTask.id, {
      role: EnterpriseLeadAgentRole.SocialOperation,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '旧版社媒草稿。',
      outputs: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });
    setup.store.updateTaskResult(salesTask.id, {
      role: EnterpriseLeadAgentRole.SalesHandoff,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '旧版销售交接。',
      outputs: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.ContentPlanning,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '新版内容规划。',
      outputs: {
        themes: ['大件防损'],
      },
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });

    const pendingVersion = await setup.service.createPendingVersionFromChat(
      contentTask.id,
      '换一个角度',
    );
    const appliedSnapshot = setup.service.applyPendingVersion(pendingVersion.id);

    expect(appliedSnapshot.tasks.find(item => item.id === contentTask.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.Completed,
      stale: false,
    });
    expect(appliedSnapshot.tasks.find(item => item.id === socialTask.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.Stale,
      stale: true,
    });
    expect(appliedSnapshot.tasks.find(item => item.id === salesTask.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.Stale,
      stale: true,
    });
  });

  test('runs risk review and preserves high-risk blocked result', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '检查外发内容风险');
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.RiskReview);
    if (!task) throw new Error('Expected risk review task');
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.RiskReview,
      status: EnterpriseLeadTaskStatus.Blocked,
      summary: '存在高风险外发承诺，暂不允许归档。',
      outputs: {
        riskLevel: EnterpriseLeadRiskLevel.High,
        blockingIssues: ['声称绝对防损'],
        canArchive: false,
      },
      missingInfo: [],
      todos: [
        {
          kind: EnterpriseLeadTodoKind.ReviewRisk,
          title: '修改高风险承诺',
          description: '删除绝对防损表达。',
          role: EnterpriseLeadAgentRole.RiskReview,
        },
      ],
      risks: [
        {
          level: EnterpriseLeadRiskLevel.High,
          title: '夸大宣传',
          description: '不能承诺绝对防损。',
          role: EnterpriseLeadAgentRole.RiskReview,
        },
      ],
      handoffContext: {
        canArchive: false,
      },
    });

    const updatedTask = await setup.service.runTask(task.id);

    expect(updatedTask).toMatchObject({
      role: EnterpriseLeadAgentRole.RiskReview,
      status: EnterpriseLeadTaskStatus.Blocked,
      summary: '存在高风险外发承诺，暂不允许归档。',
      outputPayload: {
        riskLevel: EnterpriseLeadRiskLevel.High,
        blockingIssues: ['声称绝对防损'],
        canArchive: false,
      },
    });
    expect(updatedTask.risks[0].level).toBe(EnterpriseLeadRiskLevel.High);
  });

  test('defaults invalid model task role and status before persisting', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '生成内容草稿');
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.ContentPlanning);
    if (!task) throw new Error('Expected content planning task');
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.RiskReview,
      status: 'shipped',
      summary: '模型返回了错误枚举，但内容可保留。',
      outputs: {
        draft: '替代木箱方案草稿。',
      },
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });

    const updatedTask = await setup.service.runTask(task.id);

    expect(updatedTask).toMatchObject({
      role: EnterpriseLeadAgentRole.ContentPlanning,
      status: EnterpriseLeadTaskStatus.NeedsInput,
      summary: '模型返回了错误枚举，但内容可保留。',
    });
  });

  test('parses fenced and extra text model JSON objects with clear errors', () => {
    expect(cleanModelJsonText('```json\n{"name":"A"}\n```')).toBe('{"name":"A"}');
    expect(parseModelJsonObject('prefix {"name":"B"} suffix')).toEqual({ name: 'B' });
    expect(() => parseModelJsonObject('{bad json}')).toThrow(
      'Enterprise lead model response was not valid JSON',
    );
    expect(() => parseModelJsonObject('[]')).toThrow(
      'Enterprise lead model response must be a JSON object',
    );
  });

  test('getSnapshot rejects a run from another workspace', () => {
    const setup = createService();
    db = setup.db;
    const firstWorkspace = setup.service.createWorkspace(draftPayload());
    const secondWorkspace = setup.service.createWorkspace({
      ...draftPayload(),
      name: '华东重包获客工作台',
    });
    const firstSnapshot = setup.service.createRun(firstWorkspace.id, '整理第一组线索');
    const secondSnapshot = setup.service.createRun(secondWorkspace.id, '整理第二组线索');

    expect(() =>
      setup.service.getSnapshot(firstWorkspace.id, secondSnapshot.currentRun?.id),
    ).toThrow('Enterprise lead run does not belong to workspace');
    expect(() =>
      setup.service.getSnapshot(secondWorkspace.id, firstSnapshot.currentRun?.id),
    ).toThrow('Enterprise lead run does not belong to workspace');
  });

  test('rerunTask updates the Agent and marks downstream completed tasks stale', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '重新生成内容草稿');
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.ContentPlanning);
    const socialTask = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.SocialOperation,
    );
    const salesTask = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.SalesHandoff,
    );
    if (!task || !socialTask || !salesTask) {
      throw new Error('Expected content planning task and downstream tasks');
    }
    setup.store.updateTaskResult(socialTask.id, {
      role: EnterpriseLeadAgentRole.SocialOperation,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '旧版社媒计划。',
      outputs: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });
    setup.store.updateTaskResult(salesTask.id, {
      role: EnterpriseLeadAgentRole.SalesHandoff,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '旧版销售交接。',
      outputs: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.ContentPlanning,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '内容草稿已重新生成。',
      outputs: {
        draft: '重新生成的草稿',
      },
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });

    const updatedTask = await setup.service.rerunTask(task.id);

    expect(updatedTask.id).toBe(task.id);
    expect(updatedTask.status).toBe(EnterpriseLeadTaskStatus.Completed);
    expect(updatedTask.summary).toBe('内容草稿已重新生成。');
    expect(setup.store.getTask(socialTask.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.Stale,
      stale: true,
    });
    expect(setup.store.getTask(salesTask.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.Stale,
      stale: true,
    });
  });

  test('runWorkflow executes Agents in order and pauses when one needs input', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '交给总控整理获客计划');
    const controllerTask = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.Controller,
    );
    const productTask = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.ProductUnderstanding,
    );
    const radarTask = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.OpportunityRadar,
    );
    const contentTask = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.ContentPlanning,
    );
    if (!snapshot.currentRun || !controllerTask || !productTask || !radarTask || !contentTask) {
      throw new Error('Expected current run and workflow tasks');
    }
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.Controller,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '总控计划完成。',
      outputs: {
        plan: ['产品理解', '商机雷达'],
      },
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.ProductUnderstanding,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '产品理解完成。',
      outputs: {
        profile: '重型包装方案',
      },
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.OpportunityRadar,
      status: EnterpriseLeadTaskStatus.NeedsInput,
      summary: '需要确认目标区域。',
      outputs: {},
      missingInfo: ['目标区域'],
      todos: [],
      risks: [],
      handoffContext: {},
    });

    const workflowSnapshot = await setup.service.runWorkflow(workspace.id, snapshot.currentRun.id);

    expect(setup.modelClient.prompts).toHaveLength(3);
    expect(workflowSnapshot.currentRun).toMatchObject({
      id: snapshot.currentRun.id,
      status: EnterpriseLeadRunStatus.NeedsInput,
      currentRole: EnterpriseLeadAgentRole.OpportunityRadar,
    });
    expect(workflowSnapshot.tasks.find(item => item.id === controllerTask.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '总控计划完成。',
    });
    expect(workflowSnapshot.tasks.find(item => item.id === productTask.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '产品理解完成。',
    });
    expect(workflowSnapshot.tasks.find(item => item.id === radarTask.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.NeedsInput,
      summary: '需要确认目标区域。',
    });
    expect(workflowSnapshot.tasks.find(item => item.id === contentTask.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.Waiting,
      summary: '',
      stale: false,
    });
  });

  test('archiveRun archives a workspace run and rejects foreign runs', () => {
    const setup = createService();
    db = setup.db;
    const firstWorkspace = setup.service.createWorkspace(draftPayload());
    const secondWorkspace = setup.service.createWorkspace({
      ...draftPayload(),
      name: '华东重包获客工作台',
    });
    const firstSnapshot = setup.service.createRun(firstWorkspace.id, '整理第一组线索');
    const secondSnapshot = setup.service.createRun(secondWorkspace.id, '整理第二组线索');
    const firstRunId = firstSnapshot.currentRun?.id;
    const secondRunId = secondSnapshot.currentRun?.id;
    if (!firstRunId || !secondRunId) throw new Error('Expected current runs');
    markRunReadyToArchive(setup.store, firstRunId);

    const archivedSnapshot = setup.service.archiveRun(firstWorkspace.id, firstRunId);

    expect(archivedSnapshot.currentRun).toEqual(
      expect.objectContaining({
        id: firstRunId,
        status: EnterpriseLeadRunStatus.Archived,
        archiveStatus: 'archived',
      }),
    );
    expect(archivedSnapshot.archives).toEqual([
      expect.objectContaining({
        runId: firstRunId,
        workspaceId: firstWorkspace.id,
        title: '整理第一组线索',
      }),
    ]);
    expect(() => setup.service.archiveRun(firstWorkspace.id, secondRunId)).toThrow(
      'Enterprise lead run does not belong to workspace',
    );
  });

  test('archiveRun supports completed dynamic workspace Agent runs without fixed risk role', () => {
    const agentProvider = createAgentProvider([
      {
        id: 'agent-content',
        name: 'Workspace content Agent',
        description: 'Writes safe drafts',
        model: 'gpt-4.1',
        enabled: true,
      },
    ]);
    const setup = createService({ agentProvider });
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      workspaceAgents: [
        {
          agentId: 'agent-content',
          enabled: true,
          order: 0,
          overrides: {},
        },
      ],
    });
    const snapshot = setup.service.createRun(workspace.id, '动态 Agent 归档');
    const task = snapshot.tasks[0];
    if (!snapshot.currentRun || !task) {
      throw new Error('Expected dynamic run and task');
    }

    setup.store.updateTaskResult(task.id, {
      role: task.role,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '动态内容草稿已完成。',
      outputs: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });
    setup.store.updateRunProgress({
      runId: snapshot.currentRun.id,
      status: EnterpriseLeadRunStatus.Completed,
      currentRole: null,
      controllerSummary: '动态运行已完成。',
    });

    const archivedSnapshot = setup.service.archiveRun(workspace.id, snapshot.currentRun.id);

    expect(archivedSnapshot.currentRun).toMatchObject({
      id: snapshot.currentRun.id,
      archiveStatus: 'archived',
    });
    expect(archivedSnapshot.archives[0]).toMatchObject({
      title: '动态 Agent 归档',
      summary: '动态运行已完成。',
    });
  });

  test('archiveRun rejects completed dynamic workspace Agent runs with blocking risk signals', () => {
    const agentProvider = createAgentProvider([
      {
        id: 'agent-content',
        name: 'Workspace content Agent',
        description: 'Writes outbound drafts',
        model: 'gpt-4.1',
        enabled: true,
      },
    ]);
    const setup = createService({ agentProvider });
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      workspaceAgents: [
        {
          agentId: 'agent-content',
          enabled: true,
          order: 0,
          overrides: {},
        },
      ],
    });
    const snapshot = setup.service.createRun(workspace.id, '动态 Agent 高风险归档');
    const task = snapshot.tasks[0];
    if (!snapshot.currentRun || !task) {
      throw new Error('Expected dynamic run and task');
    }

    setup.store.updateTaskResult(task.id, {
      role: task.role,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '动态内容草稿含高风险承诺。',
      outputs: {
        canArchive: false,
        riskLevel: EnterpriseLeadRiskLevel.High,
      },
      missingInfo: [],
      todos: [],
      risks: [
        {
          level: EnterpriseLeadRiskLevel.High,
          title: '夸大承诺',
          description: '不能承诺绝对防损。',
          role: task.role,
        },
      ],
      handoffContext: {},
    });
    setup.store.updateRunProgress({
      runId: snapshot.currentRun.id,
      status: EnterpriseLeadRunStatus.Completed,
      currentRole: null,
      controllerSummary: '动态运行已完成但有风险。',
    });

    expect(() => setup.service.archiveRun(workspace.id, snapshot.currentRun?.id || '')).toThrow(
      'Enterprise lead run has unresolved risk review',
    );
  });

  test('archiveRun rejects runs before the controller workflow is completed', () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '未完成不能归档');
    if (!snapshot.currentRun) throw new Error('Expected current run');

    expect(() => setup.service.archiveRun(workspace.id, snapshot.currentRun?.id || '')).toThrow(
      'Enterprise lead run must be completed before archive',
    );
  });

  test('archiveRun rejects completed runs when risk review is not completed', () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '风控未完成不能归档');
    if (!snapshot.currentRun) throw new Error('Expected current run');
    setup.store.updateRunProgress({
      runId: snapshot.currentRun.id,
      status: EnterpriseLeadRunStatus.Completed,
      currentRole: null,
      controllerSummary: '总控提前标记完成。',
    });

    expect(() => setup.service.archiveRun(workspace.id, snapshot.currentRun?.id || '')).toThrow(
      'Enterprise lead risk review must be completed before archive',
    );
  });

  test('archiveRun rejects runs with blocking high-risk review output', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '高风险内容不能归档');
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.RiskReview);
    if (!task || !snapshot.currentRun) throw new Error('Expected risk review task and current run');
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.RiskReview,
      status: EnterpriseLeadTaskStatus.Blocked,
      summary: '发现高风险承诺。',
      outputs: {
        riskLevel: EnterpriseLeadRiskLevel.High,
        blockingIssues: ['绝对防损'],
        canArchive: false,
      },
      missingInfo: [],
      todos: [],
      risks: [
        {
          level: EnterpriseLeadRiskLevel.High,
          title: '夸大承诺',
          description: '不能承诺绝对防损。',
          role: EnterpriseLeadAgentRole.RiskReview,
        },
      ],
      handoffContext: {},
    });
    await setup.service.runTask(task.id);
    setup.store.updateRunProgress({
      runId: snapshot.currentRun.id,
      status: EnterpriseLeadRunStatus.Completed,
      currentRole: null,
      controllerSummary: '总控已完成但风控阻断。',
    });

    expect(() => setup.service.archiveRun(workspace.id, snapshot.currentRun?.id || '')).toThrow(
      'Enterprise lead run has unresolved risk review',
    );
  });

  test('archived runs reject task and pending version mutations', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '归档后拒绝改写');
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.ContentPlanning);
    if (!task || !snapshot.currentRun)
      throw new Error('Expected content planning task and current run');
    markRunReadyToArchive(setup.store, snapshot.currentRun.id);
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.ContentPlanning,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '归档前的待应用版本。',
      outputs: {
        draft: '归档前版本',
      },
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });
    const pendingVersion = await setup.service.createPendingVersionFromChat(
      task.id,
      '归档前先生成一版',
    );

    setup.service.archiveRun(workspace.id, snapshot.currentRun.id);

    await expect(setup.service.rerunTask(task.id)).rejects.toThrow(
      'Enterprise lead run is archived',
    );
    await expect(
      setup.service.createPendingVersionFromChat(task.id, '归档后继续改'),
    ).rejects.toThrow('Enterprise lead run is archived');
    expect(() => setup.service.applyPendingVersion(pendingVersion.id)).toThrow(
      'Enterprise lead run is archived',
    );
  });

  test('runTask rejects if run is archived while model generation is pending', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '归档竞态测试');
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.ContentPlanning);
    if (!task || !snapshot.currentRun)
      throw new Error('Expected content planning task and current run');
    markRunReadyToArchive(setup.store, snapshot.currentRun.id);
    const pendingGeneration = setup.modelClient.enqueuePending();

    const runTaskPromise = setup.service.runTask(task.id);
    expect(setup.modelClient.prompts).toHaveLength(1);
    setup.service.archiveRun(workspace.id, snapshot.currentRun.id);
    pendingGeneration.resolve({
      role: EnterpriseLeadAgentRole.ContentPlanning,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '归档后不应写入。',
      outputs: {
        draft: 'should-not-land',
      },
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });

    await expect(runTaskPromise).rejects.toThrow('Enterprise lead run is archived');
    expect(setup.store.getTask(task.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.Completed,
      summary: `${EnterpriseLeadAgentRole.ContentPlanning} 已完成。`,
      outputPayload: {},
    });
  });

  test('createPendingVersionFromChat rejects if run is archived while model generation is pending', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '归档竞态测试');
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.ContentPlanning);
    if (!task || !snapshot.currentRun)
      throw new Error('Expected content planning task and current run');
    markRunReadyToArchive(setup.store, snapshot.currentRun.id);
    const pendingGeneration = setup.modelClient.enqueuePending();

    const pendingVersionPromise = setup.service.createPendingVersionFromChat(
      task.id,
      '生成待确认版本',
    );
    expect(setup.modelClient.prompts).toHaveLength(1);
    setup.service.archiveRun(workspace.id, snapshot.currentRun.id);
    pendingGeneration.resolve({
      role: EnterpriseLeadAgentRole.ContentPlanning,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '归档后不应插入。',
      outputs: {
        draft: 'should-not-land',
      },
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });

    await expect(pendingVersionPromise).rejects.toThrow('Enterprise lead run is archived');
    expect(setup.store.listPendingVersions(snapshot.currentRun.id)).toEqual([]);
  });

  test('getSnapshot returns current run, pending versions, derived deliverables, and derived todos', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '整理销售交接材料');
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.SalesHandoff);
    if (!task) throw new Error('Expected sales handoff task');
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.SalesHandoff,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '销售交接单已生成。',
      outputs: {
        handoff: '先确认尺寸和运输路线。',
      },
      missingInfo: [],
      todos: [
        {
          kind: EnterpriseLeadTodoKind.MissingInfo,
          title: '补充运输路线',
          description: '确认目标客户常见运输路线。',
          role: EnterpriseLeadAgentRole.SalesHandoff,
        },
      ],
      risks: [],
      handoffContext: {},
    });
    await setup.service.runTask(task.id);
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.SalesHandoff,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '更短的销售交接单。',
      outputs: {
        handoff: '确认尺寸和运输路线。',
      },
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });
    await setup.service.createPendingVersionFromChat(task.id, '补一版更短的交接单');

    const updatedSnapshot = setup.service.getSnapshot(workspace.id, snapshot.currentRun?.id);

    expect(updatedSnapshot.currentRun?.id).toBe(snapshot.currentRun?.id);
    expect(updatedSnapshot.pendingVersions).toHaveLength(1);
    expect(updatedSnapshot.deliverables).toEqual([
      expect.objectContaining({
        runId: snapshot.currentRun?.id,
        workspaceId: workspace.id,
        role: EnterpriseLeadAgentRole.SalesHandoff,
        title: '销售交接 Agent',
        summary: '销售交接单已生成。',
        payload: {
          handoff: '先确认尺寸和运输路线。',
        },
        status: 'draft',
      }),
    ]);
    expect(updatedSnapshot.todos).toEqual([
      expect.objectContaining({
        runId: snapshot.currentRun?.id,
        workspaceId: workspace.id,
        title: '补充运输路线',
        status: 'open',
      }),
    ]);
    expect(updatedSnapshot.archives).toEqual([]);
  });

  test('listRuns returns summaries with counts newest first', () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const firstSnapshot = setup.service.createRun(workspace.id, 'first goal');
    const firstRun = firstSnapshot.currentRun;
    if (!firstRun) throw new Error('Expected first run');
    const firstTask = firstSnapshot.tasks[0];
    setup.store.updateTaskResult(firstTask.id, {
      role: firstTask.role,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '首个任务已完成。',
      outputs: {
        plan: 'draft',
      },
      missingInfo: [],
      todos: [
        {
          kind: EnterpriseLeadTodoKind.MissingInfo,
          title: '补充客户名单',
          description: '确认目标客户名单。',
          role: firstTask.role,
        },
      ],
      risks: [
        {
          level: EnterpriseLeadRiskLevel.Medium,
          title: '资料不足',
          description: '客户名单还不完整。',
          role: firstTask.role,
        },
        {
          level: EnterpriseLeadRiskLevel.Low,
          title: '表达待确认',
          description: '需要确认措辞。',
          role: firstTask.role,
        },
      ],
      handoffContext: {},
    });
    const secondSnapshot = setup.service.createRun(workspace.id, 'second goal');
    const secondRun = secondSnapshot.currentRun;
    if (!secondRun) throw new Error('Expected second run');

    const summaries = setup.service.listRuns(workspace.id);

    expect(summaries.map(summary => summary.run.id)).toEqual([secondRun.id, firstRun.id]);
    expect(summaries[0]).toMatchObject({
      run: {
        id: secondRun.id,
      },
      taskCount: ENTERPRISE_LEAD_AGENT_WORKFLOW.length,
      deliverableCount: 0,
      todoCount: 0,
      riskCount: 0,
    });
    expect(summaries[1]).toMatchObject({
      run: {
        id: firstRun.id,
      },
      taskCount: ENTERPRISE_LEAD_AGENT_WORKFLOW.length,
      deliverableCount: 1,
      todoCount: 1,
      riskCount: 2,
    });
  });

  test('getSnapshot sanitizes invalid derived todo kind and role', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '整理待办');
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.SalesHandoff);
    if (!task) throw new Error('Expected sales handoff task');
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.SalesHandoff,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '销售交接单已生成。',
      outputs: {},
      missingInfo: [],
      todos: [
        {
          kind: 'invented_todo_kind',
          title: '补充联系人',
          description: '确认联系人信息。',
          role: 'invented_role',
        },
      ],
      risks: [],
      handoffContext: {},
    });
    await setup.service.runTask(task.id);

    const updatedSnapshot = setup.service.getSnapshot(workspace.id, snapshot.currentRun?.id);

    expect(updatedSnapshot.todos).toEqual([
      expect.objectContaining({
        kind: EnterpriseLeadTodoKind.MissingInfo,
        role: EnterpriseLeadAgentRole.SalesHandoff,
        title: '补充联系人',
      }),
    ]);
  });
});
