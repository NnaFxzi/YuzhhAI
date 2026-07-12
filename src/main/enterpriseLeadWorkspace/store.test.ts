import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import {
  AgentExternalResearchMode,
  ExternalResearchProviderId,
} from '../../shared/agent/externalResearch';
import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadRiskLevel,
  EnterpriseLeadRunStatus,
  EnterpriseLeadTaskStatus,
  EnterpriseLeadTodoKind,
  EnterpriseLeadWorkspaceAgentSource,
  EnterpriseLeadWorkspaceType,
} from '../../shared/enterpriseLeadWorkspace/constants';
import { buildDefaultEnterpriseLeadWorkspaceSettings } from '../../shared/enterpriseLeadWorkspace/validation';
import { WorkflowExecutionMode } from '../../shared/enterpriseLeadWorkspace/workflowContracts';
import {
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
} from '../../shared/knowledgeBase/constants';
import { KnowledgeDocumentStore } from '../knowledgeBase/knowledgeDocumentStore';
import { EnterpriseLeadWorkspaceStore } from './store';

const createStore = (): { db: Database.Database; store: EnterpriseLeadWorkspaceStore } => {
  const db = new Database(':memory:');
  return {
    db,
    store: new EnterpriseLeadWorkspaceStore(db),
  };
};

const profile = {
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
};

type EnterpriseLeadWorkspaceTable =
  | 'enterprise_lead_workspaces'
  | 'enterprise_lead_runs'
  | 'enterprise_lead_agent_tasks'
  | 'enterprise_lead_pending_versions';

const readTableCount = (
  database: Database.Database,
  table: EnterpriseLeadWorkspaceTable,
): number => {
  const row = database.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as {
    count: number;
  };
  return row.count;
};

describe('EnterpriseLeadWorkspaceStore', () => {
  let db: Database.Database | undefined;
  let store: EnterpriseLeadWorkspaceStore;

  const setupStore = (): void => {
    const setup = createStore();
    db = setup.db;
    store = setup.store;
  };

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  test('creates and lists workspaces with profile round trip', () => {
    setupStore();

    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [
        {
          kind: 'conversation',
          label: '访谈记录',
          text: '客户做重型包装。',
        },
      ],
      enabledAgentRoles: [
        EnterpriseLeadAgentRole.ProductUnderstanding,
        EnterpriseLeadAgentRole.OpportunityRadar,
      ],
    });

    expect(workspace.profile).toEqual(profile);
    expect(workspace.riskRules).toEqual([
      'no_real_publish',
      'no_real_comment',
      'no_real_direct_message',
      'no_real_email',
      'draft_only_external_actions',
    ]);
    expect(store.getWorkspace(workspace.id)).toEqual(workspace);
    expect(store.listWorkspaces()).toEqual([workspace]);
  });

  test('upserts one stable source without replacing unrelated legacy entries', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '兼容投影测试',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [
        {
          id: 'legacy-a',
          kind: EnterpriseLeadExtractionSourceKind.File,
          label: '旧资料',
          text: '保留原文',
        },
      ],
      enabledAgentRoles: [],
    });

    store.upsertWorkspaceSourceById(workspace.id, {
      id: 'knowledge-document:doc-1',
      kind: EnterpriseLeadExtractionSourceKind.File,
      label: 'Managed.pdf',
    });
    store.upsertWorkspaceSourceById(workspace.id, {
      id: 'knowledge-document:doc-1',
      kind: EnterpriseLeadExtractionSourceKind.File,
      label: 'Renamed.pdf',
    });

    expect(store.getWorkspace(workspace.id)?.extractionSources).toEqual([
      expect.objectContaining({ id: 'legacy-a', text: '保留原文' }),
      expect.objectContaining({ id: 'knowledge-document:doc-1', label: 'Renamed.pdf' }),
    ]);
  });

  test('removes only the matching stable source id', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '兼容投影删除测试',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [
        { id: 'legacy-a', kind: EnterpriseLeadExtractionSourceKind.File, label: '旧资料' },
        {
          id: 'knowledge-document:doc-1',
          kind: EnterpriseLeadExtractionSourceKind.File,
          label: 'Managed.pdf',
        },
      ],
      enabledAgentRoles: [],
    });

    expect(
      store.removeWorkspaceSourceById(workspace.id, 'knowledge-document:doc-1'),
    ).toBe(true);
    expect(store.getWorkspace(workspace.id)?.extractionSources).toEqual([
      expect.objectContaining({ id: 'legacy-a' }),
    ]);
    expect(store.removeWorkspaceSourceById(workspace.id, 'missing')).toBe(false);
  });

  test('uses normalized legacy ids as authoritative sources and deletion tombstones', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '迁移投影保护测试',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [
        {
          id: 'legacy-a',
          kind: EnterpriseLeadExtractionSourceKind.File,
          label: '最新投影',
          text: '保留正文',
        },
      ],
      enabledAgentRoles: [],
    });
    const documentStore = new KnowledgeDocumentStore(db!);
    const created = documentStore.createDocumentWithVersion({
      workspaceId: workspace.id,
      legacySourceId: 'legacy-a',
      displayName: 'legacy.pdf',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: {
        contentHash: 'a'.repeat(64),
        managedPath: `blobs/aa/${'a'.repeat(64)}`,
        mimeType: 'application/pdf',
        fileSize: 10,
        sourceMtime: 100,
        parser: 'pdf',
        extractedText: '保留正文',
        extractionPartial: false,
      },
    });

    const protectedWorkspace = store.updateWorkspaceSources(workspace.id, [
      {
        id: 'legacy-a',
        kind: EnterpriseLeadExtractionSourceKind.File,
        label: '旧页面的过期投影',
      },
    ]);
    expect(protectedWorkspace.extractionSources[0]).toMatchObject({
      id: 'legacy-a',
      label: '最新投影',
      text: '保留正文',
    });

    documentStore.softDeleteDocument(created.document.id, created.document.revision);
    const afterStaleWrite = store.updateWorkspaceSources(workspace.id, [
      {
        id: 'legacy-a',
        kind: EnterpriseLeadExtractionSourceKind.File,
        label: '旧页面尝试重新写入',
      },
    ]);
    expect(afterStaleWrite.extractionSources).toEqual([]);
  });

  test('deletes a workspace with its runs, tasks, and pending versions', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [EnterpriseLeadAgentRole.ContentPlanning],
    });
    const retainedWorkspace = store.createWorkspace({
      name: '华东精密件获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [EnterpriseLeadAgentRole.SalesHandoff],
    });
    const run = store.createRun({
      workspaceId: workspace.id,
      userGoal: '生成销售触达素材',
      roles: [EnterpriseLeadAgentRole.ContentPlanning],
    });
    const retainedRun = store.createRun({
      workspaceId: retainedWorkspace.id,
      userGoal: '整理销售交接材料',
      roles: [EnterpriseLeadAgentRole.SalesHandoff],
    });
    const task = store.listTasks(run.id)[0];
    store.createPendingVersion({
      taskId: task.id,
      userMessage: '改成更短的销售私信',
      summary: '短版销售私信。',
      outputPayload: { draft: '您好，想了解贵司机械配件采购需求。' },
      missingInfo: [],
      todos: [
        {
          kind: EnterpriseLeadTodoKind.VerifyData,
          title: '确认客户名单',
          description: '发送前由销售确认名单准确性。',
        },
      ],
      risks: [
        {
          level: EnterpriseLeadRiskLevel.Low,
          title: '外发前复核',
          description: '需要人工确认后再发送。',
        },
      ],
      handoffContext: { channel: 'wechat' },
    });

    const deleted = store.deleteWorkspace(workspace.id);

    expect(deleted).toBe(true);
    expect(store.getWorkspace(workspace.id)).toBeNull();
    expect(store.getWorkspace(retainedWorkspace.id)).not.toBeNull();
    expect(store.getRun(run.id)).toBeNull();
    expect(store.getRun(retainedRun.id)).not.toBeNull();
    expect(store.listRuns(workspace.id)).toEqual([]);
    expect(store.listTasks(run.id)).toEqual([]);
    expect(readTableCount(db!, 'enterprise_lead_workspaces')).toBe(1);
    expect(readTableCount(db!, 'enterprise_lead_runs')).toBe(1);
    expect(readTableCount(db!, 'enterprise_lead_agent_tasks')).toBe(1);
    expect(readTableCount(db!, 'enterprise_lead_pending_versions')).toBe(0);
  });

  test('creates and lists workspaces with normalized workspace agent bindings', () => {
    setupStore();

    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [EnterpriseLeadAgentRole.Controller],
      workspaceAgents: [
        {
          agentId: 'global-agent-2',
          enabled: false,
          order: 5,
          overrides: {
            name: 'Second Agent',
          },
        },
        {
          agentId: 'global-agent-1',
          enabled: true,
          order: 2,
          overrides: {
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
          systemPrompt: 'Workspace-only prompt',
        },
      },
      {
        agentId: 'global-agent-2',
        source: EnterpriseLeadWorkspaceAgentSource.WorkspaceCreated,
        enabled: false,
        order: 1,
        overrides: {
          name: 'Second Agent',
        },
      },
    ]);
    expect(store.getWorkspace(workspace.id)?.workspaceAgents).toEqual(workspace.workspaceAgents);
    expect(store.listWorkspaces()[0].workspaceAgents).toEqual(workspace.workspaceAgents);
  });

  test('round-trips system template workspace agent source metadata', () => {
    setupStore();

    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [EnterpriseLeadAgentRole.ContentPlanning],
      workspaceAgents: [
        {
          agentId: EnterpriseLeadAgentRole.ContentPlanning,
          source: EnterpriseLeadWorkspaceAgentSource.SystemTemplate,
          templateId: EnterpriseLeadAgentRole.ContentPlanning,
          enabled: true,
          order: 0,
          overrides: {
            name: '本空间内容策划 Agent',
          },
        },
      ],
    });

    expect(store.getWorkspace(workspace.id)?.workspaceAgents).toEqual([
      {
        agentId: EnterpriseLeadAgentRole.ContentPlanning,
        source: EnterpriseLeadWorkspaceAgentSource.SystemTemplate,
        templateId: EnterpriseLeadAgentRole.ContentPlanning,
        enabled: true,
        order: 0,
        overrides: {
          name: '本空间内容策划 Agent',
        },
      },
    ]);
    expect(store.listWorkspaces()[0].workspaceAgents).toEqual(
      store.getWorkspace(workspace.id)?.workspaceAgents,
    );
  });

  test('creates a workspace with independent initial settings copied from the current app config', () => {
    setupStore();
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

    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [EnterpriseLeadAgentRole.ProductUnderstanding],
      settings,
    });

    expect(workspace.settings.model.providers.openai.apiKey).toBe('sk-workspace');
    expect(workspace.settings.skillIds).toEqual(['docx', 'web-search']);
    expect(workspace.settings.externalResearch.providers.tavily.apiKey).toBe('tvly-workspace');
    expect(store.getWorkspace(workspace.id)?.settings).toEqual(workspace.settings);
  });

  test('updates workspace settings and enabled agent roles with profile round trip preserved', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [
        EnterpriseLeadAgentRole.ProductUnderstanding,
        EnterpriseLeadAgentRole.OpportunityRadar,
      ],
    });

    const updated = store.updateWorkspaceSettings(workspace.id, {
      enabledAgentRoles: [
        EnterpriseLeadAgentRole.ContentPlanning,
        EnterpriseLeadAgentRole.RiskReview,
      ],
      settings: {
        model: {
          defaultModel: 'gpt-4.1',
          defaultModelProvider: 'openai',
          providers: {
            openai: {
              enabled: true,
              apiKey: 'sk-updated',
              baseUrl: 'https://api.openai.com/v1',
              apiFormat: 'openai',
              models: [{ id: 'gpt-4.1', name: 'GPT-4.1' }],
            },
          },
        },
        skillIds: ['docx'],
        externalResearch: {
          mode: AgentExternalResearchMode.Override,
          providers: {
            [ExternalResearchProviderId.Tavily]: { enabled: true, apiKey: 'tvly-updated' },
            [ExternalResearchProviderId.Firecrawl]: { enabled: false, apiKey: '' },
          },
        },
      },
    });

    expect(updated.enabledAgentRoles).toEqual([
      EnterpriseLeadAgentRole.ContentPlanning,
      EnterpriseLeadAgentRole.RiskReview,
    ]);
    expect(updated.settings.model.defaultModel).toBe('gpt-4.1');
    expect(updated.settings.model.providers.openai.apiKey).toBe('sk-updated');
    expect(updated.settings.skillIds).toEqual(['docx']);
    expect(updated.profile).toEqual(profile);
    expect(store.getWorkspace(workspace.id)).toEqual(updated);
  });

  test('updates workspace profile knowledge without changing workspace settings', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [EnterpriseLeadAgentRole.ProductUnderstanding],
      settings: buildDefaultEnterpriseLeadWorkspaceSettings(),
    });

    const updated = store.updateWorkspaceProfile(workspace.id, {
      ...profile,
      companySummary: '更新后的企业画像',
      productList: ['精密金属支架'],
      prohibitedClaims: ['不能承诺最低价'],
    });

    expect(updated.profile.companySummary).toBe('更新后的企业画像');
    expect(updated.profile.productList).toEqual(['精密金属支架']);
    expect(updated.profile.prohibitedClaims).toEqual(['不能承诺最低价']);
    expect(updated.settings).toEqual(workspace.settings);
    expect(Date.parse(updated.updatedAt)).not.toBeNaN();
    expect(store.getWorkspace(workspace.id)?.profile).toEqual(updated.profile);
  });

  test('persists workspace agent bindings without changing global agents', () => {
    const setup = createStore();
    const testStore = setup.store;
    db = setup.db;
    store = testStore;
    const workspace = testStore.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [EnterpriseLeadAgentRole.Controller],
    });

    const updated = testStore.updateWorkspaceAgents(workspace.id, [
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

    expect(updated.workspaceAgents).toEqual([
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
    expect(testStore.getWorkspace(workspace.id)?.workspaceAgents[0].overrides.name).toBe(
      'Workspace-only name',
    );
  });

  test('creates a run with fixed agent tasks in supplied role order and waiting status', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [EnterpriseLeadAgentRole.ProductUnderstanding],
    });

    const run = store.createRun({
      workspaceId: workspace.id,
      userGoal: '找到本周可跟进的机械厂线索',
      roles: [
        EnterpriseLeadAgentRole.ProductUnderstanding,
        EnterpriseLeadAgentRole.OpportunityRadar,
        EnterpriseLeadAgentRole.ContentPlanning,
      ],
    });
    const tasks = store.listTasks(run.id);

    expect(run.workspaceId).toBe(workspace.id);
    expect(run.userGoal).toBe('找到本周可跟进的机械厂线索');
    expect(run.status).toBe(EnterpriseLeadRunStatus.Running);
    expect(store.getWorkspace(workspace.id)?.recentRunId).toBe(run.id);
    expect(tasks.map(task => task.role)).toEqual([
      EnterpriseLeadAgentRole.ProductUnderstanding,
      EnterpriseLeadAgentRole.OpportunityRadar,
      EnterpriseLeadAgentRole.ContentPlanning,
    ]);
    expect(tasks.map(task => task.status)).toEqual([
      EnterpriseLeadTaskStatus.Waiting,
      EnterpriseLeadTaskStatus.Waiting,
      EnterpriseLeadTaskStatus.Waiting,
    ]);
    expect(tasks.map(task => task.workspaceAgentId)).toEqual([null, null, null]);
    expect(tasks.map(task => task.agentSnapshot)).toEqual([null, null, null]);
    expect(tasks[0].inputPayload).toEqual({
      workspaceId: workspace.id,
      workspaceProfile: profile,
      userGoal: '找到本周可跟进的机械厂线索',
    });
  });

  test('creates dynamic workspace Agent task rows with immutable snapshots', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [EnterpriseLeadAgentRole.Controller],
    });

    const run = store.createRun({
      workspaceId: workspace.id,
      userGoal: '让动态 Agent 协作整理线索',
      tasks: [
        {
          role: 'workspace-agent-alpha',
          workspaceAgentId: ' workspace-agent-alpha ',
          agentSnapshot: {
            agentId: ' global-agent-alpha ',
            name: ' Alpha Writer ',
            description: ' Writes lead copy ',
            identity: ' Alpha identity ',
            systemPrompt: ' Alpha prompt ',
            icon: ' pen-tool ',
            model: ' openai/gpt-4.1 ',
            skillIds: [' docx ', 'web-search', 'docx', ' '],
          },
        },
        {
          role: 'workspace-agent-beta',
          workspaceAgentId: 'workspace-agent-beta',
          agentSnapshot: {
            agentId: ' global-agent-beta ',
            name: ' ',
            skillIds: [' research '],
          },
        },
      ],
    });

    const tasks = store.listTasks(run.id);

    expect(run.currentRole).toBe('workspace-agent-alpha');
    expect(tasks.map(task => task.role)).toEqual(['workspace-agent-alpha', 'workspace-agent-beta']);
    expect(tasks.map(task => task.workspaceAgentId)).toEqual([
      'workspace-agent-alpha',
      'workspace-agent-beta',
    ]);
    expect(tasks[0].agentSnapshot).toEqual({
      agentId: 'global-agent-alpha',
      name: 'Alpha Writer',
      description: 'Writes lead copy',
      identity: 'Alpha identity',
      systemPrompt: 'Alpha prompt',
      icon: 'pen-tool',
      model: 'openai/gpt-4.1',
      skillIds: ['docx', 'web-search'],
    });
    expect(tasks[1].agentSnapshot).toEqual({
      agentId: 'global-agent-beta',
      name: 'global-agent-beta',
      description: '',
      identity: '',
      systemPrompt: '',
      icon: '',
      model: '',
      skillIds: ['research'],
    });
  });

  test('reads current run by id', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const run = store.createRun({
      workspaceId: workspace.id,
      userGoal: '整理销售交接材料',
      roles: [EnterpriseLeadAgentRole.SalesHandoff],
    });

    expect(store.getRun(run.id)).toEqual(run);
    expect(store.getRun('missing-run')).toBeNull();
  });

  test('lists runs for a workspace newest first with archive state', () => {
    const setup = createStore();
    const testStore = setup.store;
    db = setup.db;
    store = testStore;
    const workspace = testStore.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [EnterpriseLeadAgentRole.Controller],
    });
    const first = testStore.createRun({
      workspaceId: workspace.id,
      userGoal: 'first goal',
      roles: [EnterpriseLeadAgentRole.Controller],
    });
    const second = testStore.createRun({
      workspaceId: workspace.id,
      userGoal: 'second goal',
      roles: [EnterpriseLeadAgentRole.Controller],
    });

    expect(testStore.listRuns(workspace.id).map(run => run.id)).toEqual([second.id, first.id]);
  });

  test('lists runs by creation time after an older run receives progress updates', async () => {
    const setup = createStore();
    const testStore = setup.store;
    db = setup.db;
    store = testStore;
    const workspace = testStore.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [EnterpriseLeadAgentRole.Controller],
    });
    const first = testStore.createRun({
      workspaceId: workspace.id,
      userGoal: 'first goal',
      roles: [EnterpriseLeadAgentRole.Controller],
    });
    const second = testStore.createRun({
      workspaceId: workspace.id,
      userGoal: 'second goal',
      roles: [EnterpriseLeadAgentRole.Controller],
    });
    await new Promise(resolve => {
      setTimeout(resolve, 5);
    });

    testStore.updateRunProgress({
      runId: first.id,
      status: EnterpriseLeadRunStatus.Running,
      currentRole: EnterpriseLeadAgentRole.Controller,
      controllerSummary: 'first run touched after second run',
    });

    expect(testStore.listRuns(workspace.id).map(run => run.id)).toEqual([second.id, first.id]);
  });

  test('archives a run owned by the workspace', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const run = store.createRun({
      workspaceId: workspace.id,
      userGoal: '整理销售交接材料',
      roles: [EnterpriseLeadAgentRole.SalesHandoff],
    });

    const archivedRun = store.archiveRun(workspace.id, run.id);

    expect(archivedRun).toEqual(
      expect.objectContaining({
        id: run.id,
        workspaceId: workspace.id,
        status: EnterpriseLeadRunStatus.Archived,
        archiveStatus: 'archived',
      }),
    );
    expect(archivedRun.completedAt).toBeTruthy();
    expect(store.getRun(run.id)).toEqual(archivedRun);
  });

  test('rejects archive when run does not belong to workspace', () => {
    setupStore();
    const firstWorkspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const secondWorkspace = store.createWorkspace({
      name: '华东重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const run = store.createRun({
      workspaceId: secondWorkspace.id,
      userGoal: '整理销售交接材料',
      roles: [EnterpriseLeadAgentRole.SalesHandoff],
    });

    expect(() => store.archiveRun(firstWorkspace.id, run.id)).toThrow(
      'Enterprise lead run does not belong to workspace',
    );
    expect(store.getRun(run.id)?.status).toBe(EnterpriseLeadRunStatus.Running);
  });

  test('updates task result and stores structured output, todos, risks, and handoff context', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const run = store.createRun({
      workspaceId: workspace.id,
      userGoal: '输出内容选题',
      roles: [EnterpriseLeadAgentRole.ContentPlanning],
    });
    const task = store.listTasks(run.id)[0];

    store.updateTaskResult(task.id, {
      role: EnterpriseLeadAgentRole.ContentPlanning,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '建议先写替代木箱主题。',
      outputs: {
        themes: ['替代木箱'],
      },
      missingInfo: ['客户案例'],
      todos: [
        {
          kind: EnterpriseLeadTodoKind.ConfirmExpression,
          title: '确认表达',
          description: '确认是否可使用替代木箱说法。',
          role: EnterpriseLeadAgentRole.ContentPlanning,
        },
      ],
      risks: [
        {
          level: EnterpriseLeadRiskLevel.Medium,
          title: '效果承诺',
          description: '避免承诺绝对防损。',
          role: EnterpriseLeadAgentRole.ContentPlanning,
        },
      ],
      handoffContext: {
        nextRole: EnterpriseLeadAgentRole.SocialOperation,
      },
    });

    expect(store.getTask(task.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.Completed,
      outputPayload: {
        themes: ['替代木箱'],
      },
      summary: '建议先写替代木箱主题。',
      missingInfo: ['客户案例'],
      todos: [
        {
          kind: EnterpriseLeadTodoKind.ConfirmExpression,
          title: '确认表达',
          description: '确认是否可使用替代木箱说法。',
          role: EnterpriseLeadAgentRole.ContentPlanning,
        },
      ],
      risks: [
        {
          level: EnterpriseLeadRiskLevel.Medium,
          title: '效果承诺',
          description: '避免承诺绝对防损。',
          role: EnterpriseLeadAgentRole.ContentPlanning,
        },
      ],
      handoffContext: {
        nextRole: EnterpriseLeadAgentRole.SocialOperation,
      },
      error: '',
      stale: false,
    });
  });

  test('persists artifact references across task-store reloads', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const run = store.createRun({
      workspaceId: workspace.id,
      userGoal: '保存推广产物引用',
      roles: [EnterpriseLeadAgentRole.PromotionDataScraping],
    });
    const task = store.listTasks(run.id)[0];
    const artifactRefs = [
      {
        id: 'artifact-source-1',
        kind: 'scraped_leads',
        schemaVersion: 1,
        summary: '已抓取的一条来源线索',
        producerTaskId: task.id,
        evidenceIds: ['source-1'],
      },
    ];

    store.updateTaskResult(task.id, {
      role: task.role,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '来源线索已保存。',
      outputs: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
      artifactRefs,
    });
    const reloadedStore = new EnterpriseLeadWorkspaceStore(db!);

    expect(reloadedStore.getTask(task.id)?.artifactRefs).toEqual(artifactRefs);
  });

  test('migrates legacy workflow tasks without an execution mode to inline execution', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '兼容旧版推广任务',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const run = store.createRun({
      workspaceId: workspace.id,
      userGoal: '恢复旧版推广任务',
      roles: [EnterpriseLeadAgentRole.PromotionDataScraping],
    });
    const task = store.listTasks(run.id)[0];
    db!.prepare('UPDATE enterprise_lead_agent_tasks SET execution_mode = NULL WHERE id = ?').run(task.id);

    const reloadedStore = new EnterpriseLeadWorkspaceStore(db!);

    expect(reloadedStore.getTask(task.id)?.executionMode).toBe(WorkflowExecutionMode.Inline);
  });

  test('creates and applies a pending agent version', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const run = store.createRun({
      workspaceId: workspace.id,
      userGoal: '优化私信草稿',
      roles: [EnterpriseLeadAgentRole.SocialOperation],
    });
    const task = store.listTasks(run.id)[0];

    const pendingVersion = store.createPendingVersion({
      taskId: task.id,
      userMessage: '语气更稳一点',
      summary: '更新后的私信草稿。',
      outputPayload: {
        draft: '您好，我们可以先根据尺寸做包装建议。',
      },
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {
        approvedByUser: true,
      },
    });

    expect(store.listPendingVersions(run.id)).toEqual([pendingVersion]);

    const applied = store.applyPendingVersion(pendingVersion.id);

    expect(applied.status).toBe('applied');
    expect(applied.appliedAt).not.toBeNull();
    expect(store.getTask(task.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '更新后的私信草稿。',
      outputPayload: {
        draft: '您好，我们可以先根据尺寸做包装建议。',
      },
      handoffContext: {
        approvedByUser: true,
      },
      stale: false,
    });
  });

  test('marks downstream tasks stale after applying a pending version', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const run = store.createRun({
      workspaceId: workspace.id,
      userGoal: '完成从内容到销售交接',
      roles: [
        EnterpriseLeadAgentRole.ContentPlanning,
        EnterpriseLeadAgentRole.SocialOperation,
        EnterpriseLeadAgentRole.SalesHandoff,
      ],
    });
    const [contentTask, socialTask, salesTask] = store.listTasks(run.id);
    store.updateTaskResult(socialTask.id, {
      role: EnterpriseLeadAgentRole.SocialOperation,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '旧版社媒草稿。',
      outputs: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });
    store.updateTaskResult(salesTask.id, {
      role: EnterpriseLeadAgentRole.SalesHandoff,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '旧版销售交接。',
      outputs: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });
    const pendingVersion = store.createPendingVersion({
      taskId: contentTask.id,
      userMessage: '换一个角度',
      summary: '新版内容规划。',
      outputPayload: {
        themes: ['大件防损'],
      },
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });

    store.applyPendingVersion(pendingVersion.id);

    expect(store.getTask(contentTask.id)?.stale).toBe(false);
    expect(store.getTask(socialTask.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.Stale,
      stale: true,
    });
    expect(store.getTask(salesTask.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.Stale,
      stale: true,
    });
  });

  test('orders tasks by semantic sequence when SQLite rowids change', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const run = store.createRun({
      workspaceId: workspace.id,
      userGoal: '验证任务顺序',
      roles: [
        EnterpriseLeadAgentRole.ContentPlanning,
        EnterpriseLeadAgentRole.SocialOperation,
        EnterpriseLeadAgentRole.SalesHandoff,
      ],
    });
    const [contentTask] = store.listTasks(run.id);
    db?.prepare('UPDATE enterprise_lead_agent_tasks SET rowid = rowid + 100 WHERE id = ?').run(
      contentTask.id,
    );

    expect(store.listTasks(run.id).map(task => task.role)).toEqual([
      EnterpriseLeadAgentRole.ContentPlanning,
      EnterpriseLeadAgentRole.SocialOperation,
      EnterpriseLeadAgentRole.SalesHandoff,
    ]);
  });

  test('marks downstream tasks stale using semantic sequence order', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const run = store.createRun({
      workspaceId: workspace.id,
      userGoal: '验证下游过期顺序',
      roles: [
        EnterpriseLeadAgentRole.ContentPlanning,
        EnterpriseLeadAgentRole.SocialOperation,
        EnterpriseLeadAgentRole.SalesHandoff,
      ],
    });
    const [contentTask, socialTask, salesTask] = store.listTasks(run.id);
    db?.prepare('UPDATE enterprise_lead_agent_tasks SET rowid = rowid + 100 WHERE id = ?').run(
      contentTask.id,
    );
    store.updateTaskResult(socialTask.id, {
      role: EnterpriseLeadAgentRole.SocialOperation,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '旧版社媒计划。',
      outputs: {
        plan: '旧版计划',
      },
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });
    const pendingVersion = store.createPendingVersion({
      taskId: contentTask.id,
      userMessage: '重新生成上游产物',
      summary: '新版内容规划。',
      outputPayload: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });

    store.applyPendingVersion(pendingVersion.id);

    expect(store.getTask(contentTask.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.Completed,
      stale: false,
    });
    expect(store.getTask(socialTask.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.Stale,
      stale: true,
    });
    expect(store.getTask(salesTask.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.Waiting,
      stale: false,
    });
  });

  test('rejects applying an already applied pending version', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const run = store.createRun({
      workspaceId: workspace.id,
      userGoal: '避免重复应用',
      roles: [EnterpriseLeadAgentRole.ContentPlanning],
    });
    const [task] = store.listTasks(run.id);
    const pendingVersion = store.createPendingVersion({
      taskId: task.id,
      userMessage: '第一次调整',
      summary: '新版内容规划。',
      outputPayload: {
        version: 1,
      },
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });

    store.applyPendingVersion(pendingVersion.id);

    expect(() => store.applyPendingVersion(pendingVersion.id)).toThrow(
      'Enterprise lead pending version is not pending',
    );
  });

  test('falls back when persisted workspace profile JSON is malformed', () => {
    setupStore();
    const workspace = store.createWorkspace({
      name: '华南重包获客工作台',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    db?.prepare('UPDATE enterprise_lead_workspaces SET profile = ? WHERE id = ?').run(
      '{"broken":',
      workspace.id,
    );

    expect(store.getWorkspace(workspace.id)?.profile).toEqual({
      companySummary: '',
      productList: [],
      productCapabilities: [],
      targetCustomers: [],
      applicationScenarios: [],
      sellingPoints: [],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
    });
  });

  test('backfills task sequence for legacy task tables before applying pending versions', () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE enterprise_lead_workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        profile TEXT NOT NULL,
        extraction_sources TEXT NOT NULL,
        risk_rules TEXT NOT NULL,
        enabled_agent_roles TEXT NOT NULL,
        recent_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE enterprise_lead_runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_goal TEXT NOT NULL,
        status TEXT NOT NULL,
        current_role TEXT,
        controller_summary TEXT NOT NULL,
        archive_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE enterprise_lead_agent_tasks (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        input_payload TEXT NOT NULL,
        output_payload TEXT NOT NULL,
        summary TEXT NOT NULL,
        missing_info TEXT NOT NULL,
        todos TEXT NOT NULL,
        risks TEXT NOT NULL,
        handoff_context TEXT NOT NULL,
        error TEXT NOT NULL,
        stale INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const now = '2026-07-04T00:00:00.000Z';
    db.prepare(
      `
      INSERT INTO enterprise_lead_workspaces (
        id,
        name,
        type,
        profile,
        extraction_sources,
        risk_rules,
        enabled_agent_roles,
        recent_run_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      'workspace-legacy',
      '旧版获客工作台',
      EnterpriseLeadWorkspaceType.EnterpriseLead,
      JSON.stringify(profile),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([]),
      'run-legacy',
      now,
      now,
    );
    db.prepare(
      `
      INSERT INTO enterprise_lead_runs (
        id,
        workspace_id,
        user_goal,
        status,
        current_role,
        controller_summary,
        archive_status,
        created_at,
        updated_at,
        completed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      'run-legacy',
      'workspace-legacy',
      '迁移旧版任务顺序',
      EnterpriseLeadRunStatus.Running,
      EnterpriseLeadAgentRole.ContentPlanning,
      '',
      'not_archived',
      now,
      now,
      null,
    );
    const insertLegacyTask = db.prepare(`
      INSERT INTO enterprise_lead_agent_tasks (
        id,
        run_id,
        role,
        status,
        input_payload,
        output_payload,
        summary,
        missing_info,
        todos,
        risks,
        handoff_context,
        error,
        stale,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    [
      ['legacy-task-content', EnterpriseLeadAgentRole.ContentPlanning],
      ['legacy-task-social', EnterpriseLeadAgentRole.SocialOperation],
      ['legacy-task-sales', EnterpriseLeadAgentRole.SalesHandoff],
    ].forEach(([taskId, role]) => {
      const hasExistingOutput = taskId === 'legacy-task-social';
      insertLegacyTask.run(
        taskId,
        'run-legacy',
        role,
        hasExistingOutput ? EnterpriseLeadTaskStatus.Completed : EnterpriseLeadTaskStatus.Waiting,
        JSON.stringify({
          workspaceId: 'workspace-legacy',
          workspaceProfile: profile,
          userGoal: '迁移旧版任务顺序',
        }),
        JSON.stringify(hasExistingOutput ? { plan: '旧版社媒计划' } : {}),
        hasExistingOutput ? '旧版社媒计划。' : '',
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify({}),
        '',
        0,
        now,
        now,
      );
    });

    store = new EnterpriseLeadWorkspaceStore(db);
    const tasks = store.listTasks('run-legacy');
    const pendingVersion = store.createPendingVersion({
      taskId: 'legacy-task-content',
      userMessage: '迁移后重写内容规划',
      summary: '迁移后的新版内容规划。',
      outputPayload: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });

    store.applyPendingVersion(pendingVersion.id);

    expect(tasks.map(task => task.role)).toEqual([
      EnterpriseLeadAgentRole.ContentPlanning,
      EnterpriseLeadAgentRole.SocialOperation,
      EnterpriseLeadAgentRole.SalesHandoff,
    ]);
    expect(store.getTask('legacy-task-content')).toMatchObject({
      status: EnterpriseLeadTaskStatus.Completed,
      stale: false,
    });
    expect(store.getTask('legacy-task-social')).toMatchObject({
      status: EnterpriseLeadTaskStatus.Stale,
      stale: true,
    });
    expect(store.getTask('legacy-task-sales')).toMatchObject({
      status: EnterpriseLeadTaskStatus.Waiting,
      stale: false,
    });
  });

  test('migrates legacy run tables without archive columns', () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE enterprise_lead_workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        profile TEXT NOT NULL,
        extraction_sources TEXT NOT NULL,
        risk_rules TEXT NOT NULL,
        enabled_agent_roles TEXT NOT NULL,
        recent_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE enterprise_lead_runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_goal TEXT NOT NULL,
        status TEXT NOT NULL,
        current_role TEXT,
        controller_summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const now = '2026-07-04T00:00:00.000Z';
    db.prepare(
      `
      INSERT INTO enterprise_lead_workspaces (
        id,
        name,
        type,
        profile,
        extraction_sources,
        risk_rules,
        enabled_agent_roles,
        recent_run_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      'workspace-legacy-runs',
      '旧版获客工作台',
      EnterpriseLeadWorkspaceType.EnterpriseLead,
      JSON.stringify(profile),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([EnterpriseLeadAgentRole.ContentPlanning]),
      'run-legacy',
      now,
      now,
    );
    db.prepare(
      `
      INSERT INTO enterprise_lead_runs (
        id,
        workspace_id,
        user_goal,
        status,
        current_role,
        controller_summary,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      'run-legacy',
      'workspace-legacy-runs',
      '旧版运行',
      EnterpriseLeadRunStatus.Running,
      EnterpriseLeadAgentRole.ContentPlanning,
      '',
      now,
      now,
    );

    store = new EnterpriseLeadWorkspaceStore(db);

    expect(store.getRun('run-legacy')).toEqual(
      expect.objectContaining({
        id: 'run-legacy',
        archiveStatus: 'not_archived',
        completedAt: null,
      }),
    );

    const createdRun = store.createRun({
      workspaceId: 'workspace-legacy-runs',
      userGoal: '迁移后新运行',
      roles: [EnterpriseLeadAgentRole.SalesHandoff],
    });
    const archivedRun = store.archiveRun('workspace-legacy-runs', createdRun.id);

    expect(archivedRun).toEqual(
      expect.objectContaining({
        id: createdRun.id,
        status: EnterpriseLeadRunStatus.Archived,
        archiveStatus: 'archived',
      }),
    );
    expect(archivedRun.completedAt).toBeTruthy();
  });
});
