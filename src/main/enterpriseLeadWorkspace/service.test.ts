import Database from 'better-sqlite3';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  AgentExternalResearchMode,
  ExternalResearchProviderId,
} from '../../shared/agent/externalResearch';
import {
  buildEnterpriseLeadWorkspaceKnowledgeScopeId,
  EnterpriseLeadAgentRole,
  EnterpriseLeadContentDeliveryMode,
  EnterpriseLeadDeliverableKind,
  EnterpriseLeadDocumentExtractionStage,
  EnterpriseLeadDocumentExtractionStatus,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadKnowledgeIndexStatus,
  EnterpriseLeadRiskLevel,
  EnterpriseLeadRunStatus,
  EnterpriseLeadTaskStatus,
  EnterpriseLeadTodoKind,
  EnterpriseLeadWorkspaceAgentCalibrationCheckId,
  EnterpriseLeadWorkspaceAgentSource,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type { EnterpriseLeadWorkspaceDraft } from '../../shared/enterpriseLeadWorkspace/types';
import { buildDefaultEnterpriseLeadWorkspaceSettings } from '../../shared/enterpriseLeadWorkspace/validation';
import {
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
} from '../../shared/knowledgeBase/constants';
import type { ModelClientAdapter, ModelGenerationInput } from '../industryPack/modelClientAdapter';
import { KnowledgeDocumentStore } from '../knowledgeBase/knowledgeDocumentStore';
import { ContentKnowledgeSourceType } from '../libs/contentKnowledgeRetrieval';
import { ContentKnowledgeVectorStore } from '../libs/contentKnowledgeVectorStore';
import {
  buildWorkspaceExtractionChunks,
  DIRECT_EXTRACTION_MAX_CHARS,
  type WorkspaceChunkExtractionResult,
} from './documentExtraction';
import { cleanModelJsonText, parseModelJsonObject } from './modelJson';
import {
  type EnterpriseLeadWorkspaceAgentProvider,
  type EnterpriseLeadWorkspaceAgentTemplate,
  EnterpriseLeadWorkspaceService,
} from './service';
import { EnterpriseLeadWorkspaceStore } from './store';
import {
  buildDefaultEnterpriseLeadWorkspaceAgents,
  buildDefaultPromotionDepartmentWorkspaceAgents,
  ENTERPRISE_LEAD_AGENT_WORKFLOW,
} from './workflow';

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

const createService = (
  overrides: Partial<{
    store: EnterpriseLeadWorkspaceStore;
    modelClient: FakeModelClient;
    agentProvider: EnterpriseLeadWorkspaceAgentProvider;
    contentKnowledgeVectorStore: ContentKnowledgeVectorStore;
  }> = {},
): {
  agentProvider: EnterpriseLeadWorkspaceAgentProvider;
  contentKnowledgeVectorStore: ContentKnowledgeVectorStore;
  db: Database.Database;
  modelClient: FakeModelClient;
  service: EnterpriseLeadWorkspaceService;
  store: EnterpriseLeadWorkspaceStore;
} => {
  const db = new Database(':memory:');
  const store = overrides.store ?? new EnterpriseLeadWorkspaceStore(db);
  const modelClient = overrides.modelClient ?? new FakeModelClient();
  const agentProvider = overrides.agentProvider ?? createAgentProvider();
  const contentKnowledgeVectorStore =
    overrides.contentKnowledgeVectorStore ?? new ContentKnowledgeVectorStore(db);
  return {
    agentProvider,
    contentKnowledgeVectorStore,
    db,
    modelClient,
    service: new EnterpriseLeadWorkspaceService({
      store,
      modelClient,
      agentProvider,
      ...({ contentKnowledgeVectorStore } as Record<string, unknown>),
    } as never),
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
  enabledAgentRoles: ENTERPRISE_LEAD_AGENT_WORKFLOW.map(agent => agent.role),
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
        task.role === EnterpriseLeadAgentRole.ContentQuality
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

const waitForModelPromptCount = async (
  modelClient: FakeModelClient,
  count: number,
): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (modelClient.prompts.length >= count) {
      return;
    }
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  }
  throw new Error(`Expected ${count} model prompt(s), got ${modelClient.prompts.length}`);
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

  test('updates workspace sources and synchronizes readable text into the vector index', () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      extractionSources: [],
    });

    const updated = setup.service.updateWorkspaceSources(workspace.id, [
      {
        kind: 'file',
        label: '工业包装资料',
        fileName: 'packing.md',
        text: '主营工业包装服务，客户是机械设备厂采购负责人，卖点是防破损、免熏蒸和替代木箱。',
      },
    ]);
    const indexedSource = updated.extractionSources[0] as {
      vectorChunkCount?: number;
      vectorEmbeddingVersion?: string;
      vectorIndexStatus?: string;
      vectorIndexedAt?: string;
    };

    expect(indexedSource.vectorIndexStatus).toBe('indexed');
    expect(indexedSource.vectorChunkCount).toBeGreaterThan(0);
    expect(indexedSource.vectorEmbeddingVersion).toBe('lobsterai-content-keyword-hash-v1');
    expect(Date.parse(indexedSource.vectorIndexedAt ?? '')).not.toBeNaN();
    const sourceId = updated.extractionSources[0]?.id;
    expect(sourceId).toMatch(/^source_/);

    const updatedAgain = setup.service.updateWorkspaceSources(
      workspace.id,
      updated.extractionSources,
    );
    expect(updatedAgain.extractionSources[0]?.id).toBe(sourceId);

    const searchResult = setup.contentKnowledgeVectorStore.search(
      `enterprise-workspace:${workspace.id}`,
      '帮我做 10 个小红书选题',
    );

    expect(searchResult.matched).toBe(true);
    expect(searchResult.hits[0].chunk.text).toContain('工业包装服务');
  });

  test('preserves normalized knowledge document projections from stale legacy updates', () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      extractionSources: [],
    });
    const created = new KnowledgeDocumentStore(setup.db).createDocumentWithVersion({
      workspaceId: workspace.id,
      displayName: 'manual.pdf',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: {
        contentHash: 'a'.repeat(64),
        managedPath: `blobs/aa/${'a'.repeat(64)}`,
        mimeType: 'application/pdf',
        fileSize: 10,
        sourceMtime: 100,
        parser: 'pdf',
        extractedText: null,
        extractionPartial: false,
      },
    });
    const normalizedSourceId = `knowledge-document:${created.document.id}`;
    setup.store.upsertWorkspaceSourceById(workspace.id, {
      id: normalizedSourceId,
      kind: EnterpriseLeadExtractionSourceKind.File,
      label: '最新文档状态',
      fileName: 'manual.pdf',
      text: '已迁移的本地正文',
      extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
      vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
    });

    const updated = setup.service.updateWorkspaceSources(workspace.id, [
      {
        id: 'legacy-manual',
        kind: EnterpriseLeadExtractionSourceKind.Manual,
        label: '旧页面仍可编辑的手工资料',
        text: '手工正文',
      },
    ]);

    expect(updated.extractionSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'legacy-manual', text: '手工正文' }),
        expect.objectContaining({
          id: normalizedSourceId,
          label: '最新文档状态',
          extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
          vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexed,
          vectorChunkCount: 1,
        }),
      ]),
    );
  });

  test('queues document extraction and vector indexing without waiting for the model response', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const pendingExtraction = setup.modelClient.enqueuePending();

    const queuedWorkspace = setup.service.enqueueWorkspaceDocumentProcessing(
      workspace.id,
      [
        {
          kind: 'file',
          label: '工厂资料',
          fileName: 'factory.md',
          text: '我们主营精密金属支架，服务自动化设备厂，卖点是来图定制和小批量快反。',
        },
      ],
      0,
    );

    expect(queuedWorkspace.extractionSources[0]?.id).toMatch(/^source_/);
    expect(queuedWorkspace.extractionSources[0]?.extractionStatus).toBe(
      EnterpriseLeadDocumentExtractionStatus.Extracting,
    );
    expect(queuedWorkspace.extractionSources[0]?.vectorIndexStatus).toBe(
      EnterpriseLeadKnowledgeIndexStatus.Pending,
    );
    expect(queuedWorkspace.profile.productList).not.toContain('精密金属支架');

    pendingExtraction.resolve({
      ...draftPayload(),
      profile: {
        ...draftPayload().profile,
        productList: ['精密金属支架'],
        targetCustomers: ['自动化设备厂'],
        sellingPoints: ['来图定制', '小批量快反'],
      },
    });
    await setup.service.waitForDocumentProcessingIdle();

    const processedWorkspace = setup.service.getWorkspace(workspace.id);
    expect(processedWorkspace?.profile.productList).toContain('精密金属支架');
    expect(processedWorkspace?.profile.sellingPoints).toContain('小批量快反');
    expect(processedWorkspace?.extractionSources[0]?.extractionStatus).toBe(
      EnterpriseLeadDocumentExtractionStatus.Extracted,
    );
    expect(processedWorkspace?.extractionSources[0]?.vectorIndexStatus).toBe(
      EnterpriseLeadKnowledgeIndexStatus.Indexed,
    );
    expect(processedWorkspace?.extractionSources[0]?.extractedKnowledgeKeys).toContain(
      'productList:精密金属支架',
    );
  });

  test('extracts large documents through chunk facts before merging the workspace draft', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const largeText = [
      '公司：精密五金加工厂，主营金属支架。',
      `${'产品能力：CNC 加工、来图定制、小批量快反。\n'.repeat(3_200)}`,
      '客户：自动化设备厂和机器人集成商。禁用表达：绝对最低价。联系规则：报价需人工确认。',
    ].join('\n\n');
    const chunkPlan = buildWorkspaceExtractionChunks({
      sourceId: 'source-large',
      sourceLabel: 'large.md',
      sourceText: largeText,
    });
    expect(largeText.length).toBeGreaterThan(DIRECT_EXTRACTION_MAX_CHARS);
    expect(chunkPlan.chunks.length).toBeGreaterThan(1);

    chunkPlan.chunks.forEach((chunk, index) => {
      const result: WorkspaceChunkExtractionResult = {
        facts: {
          companySummary: index === 0 ? ['精密五金加工厂'] : [],
          productList: index === 0 ? ['金属支架'] : [],
          productCapabilities: ['CNC 加工', '来图定制', '小批量快反'],
          targetCustomers:
            index === chunkPlan.chunks.length - 1 ? ['自动化设备厂', '机器人集成商'] : [],
          applicationScenarios: [],
          sellingPoints: ['小批量快反'],
          channelPreferences: [],
          prohibitedClaims: index === chunkPlan.chunks.length - 1 ? ['绝对最低价'] : [],
          contactRules: index === chunkPlan.chunks.length - 1 ? ['报价需人工确认'] : [],
          missingInfo: [],
        },
        evidence: [
          {
            field: 'productCapabilities',
            value: 'CNC 加工',
            chunkId: chunk.chunkId,
            quote: '产品能力：CNC 加工',
            confidence: 'high',
          },
        ],
      };
      setup.modelClient.enqueue(result);
    });
    setup.modelClient.enqueue({
      ...draftPayload(),
      name: '大文件资料',
      profile: {
        ...draftPayload().profile,
        companySummary: '精密五金加工厂',
        productList: ['金属支架'],
        productCapabilities: ['CNC 加工', '来图定制', '小批量快反'],
        targetCustomers: ['自动化设备厂', '机器人集成商'],
        sellingPoints: ['小批量快反'],
        prohibitedClaims: ['绝对最低价'],
        contactRules: ['报价需人工确认'],
      },
    });

    setup.service.enqueueWorkspaceDocumentProcessing(
      workspace.id,
      [
        {
          kind: 'file',
          label: 'large.md',
          fileName: 'large.md',
          text: largeText,
        },
      ],
      0,
    );
    await setup.service.waitForDocumentProcessingIdle();

    const processedWorkspace = setup.service.getWorkspace(workspace.id);
    expect(setup.modelClient.prompts).toHaveLength(chunkPlan.chunks.length + 1);
    expect(setup.modelClient.prompts[0]?.prompt).toContain('资料分块');
    expect(setup.modelClient.prompts[setup.modelClient.prompts.length - 1]?.prompt).toContain(
      '合并',
    );
    expect(processedWorkspace?.profile.productCapabilities).toContain('CNC 加工');
    expect(processedWorkspace?.profile.targetCustomers).toContain('机器人集成商');
    expect(processedWorkspace?.profile.prohibitedClaims).toContain('绝对最低价');
    expect(processedWorkspace?.extractionSources[0]?.vectorIndexStatus).toBe(
      EnterpriseLeadKnowledgeIndexStatus.Indexed,
    );
  });

  test('updates large document extraction progress while chunk processing is pending', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const largeText = [
      '公司：精密五金加工厂，主营金属支架。',
      `${'产品能力：CNC 加工、来图定制、小批量快反。\n'.repeat(3_200)}`,
      '客户：自动化设备厂和机器人集成商。',
    ].join('\n\n');
    const chunkPlan = buildWorkspaceExtractionChunks({
      sourceId: 'source-large-progress',
      sourceLabel: 'large.md',
      sourceText: largeText,
    });
    expect(chunkPlan.chunks.length).toBeGreaterThan(1);
    const firstChunk = setup.modelClient.enqueuePending();
    chunkPlan.chunks.slice(1).forEach(chunk => {
      setup.modelClient.enqueue({
        facts: {
          productCapabilities: ['CNC 加工'],
        },
        evidence: [
          {
            field: 'productCapabilities',
            value: 'CNC 加工',
            chunkId: chunk.chunkId,
            quote: '产品能力：CNC 加工',
          },
        ],
      });
    });
    setup.modelClient.enqueue({
      ...draftPayload(),
      profile: {
        ...draftPayload().profile,
        productCapabilities: ['CNC 加工'],
      },
    });

    setup.service.enqueueWorkspaceDocumentProcessing(
      workspace.id,
      [
        {
          kind: 'file',
          label: 'large.md',
          fileName: 'large.md',
          text: largeText,
        },
      ],
      0,
    );
    await waitForModelPromptCount(setup.modelClient, 1);

    const extractingWorkspace = setup.service.getWorkspace(workspace.id);
    expect(extractingWorkspace?.extractionSources[0]?.extractionStage).toBe(
      EnterpriseLeadDocumentExtractionStage.ExtractingChunks,
    );
    expect(extractingWorkspace?.extractionSources[0]?.extractionProgressCurrent).toBe(0);
    expect(extractingWorkspace?.extractionSources[0]?.extractionProgressTotal).toBe(
      chunkPlan.chunks.length,
    );

    firstChunk.resolve({
      facts: {
        companySummary: ['精密五金加工厂'],
        productList: ['金属支架'],
        productCapabilities: ['CNC 加工'],
      },
      evidence: [
        {
          field: 'companySummary',
          value: '精密五金加工厂',
          chunkId: chunkPlan.chunks[0]?.chunkId,
          quote: '公司：精密五金加工厂',
        },
      ],
    });
    await setup.service.waitForDocumentProcessingIdle();

    const processedWorkspace = setup.service.getWorkspace(workspace.id);
    expect(processedWorkspace?.extractionSources[0]?.extractionStatus).toBe(
      EnterpriseLeadDocumentExtractionStatus.Extracted,
    );
    expect(processedWorkspace?.extractionSources[0]?.extractionStage).toBeUndefined();
    expect(processedWorkspace?.extractionSources[0]?.extractionProgressCurrent).toBeUndefined();
    expect(processedWorkspace?.extractionSources[0]?.extractionProgressTotal).toBeUndefined();
  });

  test('marks document processing failed when model extraction times out', async () => {
    vi.useFakeTimers();
    try {
      const setup = createService();
      db = setup.db;
      const workspace = setup.service.createWorkspace(draftPayload());
      setup.modelClient.enqueuePending();

      setup.service.enqueueWorkspaceDocumentProcessing(
        workspace.id,
        [
          {
            kind: 'file',
            label: '大文件资料',
            fileName: 'large.md',
            text: '我们主营精密金属支架，服务自动化设备厂。'.repeat(200),
          },
        ],
        0,
      );

      await vi.advanceTimersByTimeAsync(180_001);
      await Promise.resolve();

      const processedWorkspace = setup.service.getWorkspace(workspace.id);
      expect(processedWorkspace?.extractionSources[0]?.extractionStatus).toBe(
        EnterpriseLeadDocumentExtractionStatus.Failed,
      );
      expect(processedWorkspace?.extractionSources[0]?.vectorIndexStatus).toBe(
        EnterpriseLeadKnowledgeIndexStatus.Failed,
      );
      expect(processedWorkspace?.extractionSources[0]?.extractionError).toContain('timed out');
    } finally {
      vi.useRealTimers();
    }
  });

  test('repairs stale document processing status when loading a workspace', () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    setup.store.updateWorkspaceSources(workspace.id, [
      {
        kind: 'file',
        label: '中断资料',
        fileName: 'interrupted.md',
        text: '我们主营精密金属支架，服务自动化设备厂。',
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracting,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexing,
        updatedAt: '2000-01-01T00:00:00.000Z',
      },
    ]);

    const repairedWorkspace = setup.service.getWorkspace(workspace.id);

    expect(repairedWorkspace?.extractionSources[0]?.extractionStatus).toBe(
      EnterpriseLeadDocumentExtractionStatus.Failed,
    );
    expect(repairedWorkspace?.extractionSources[0]?.vectorIndexStatus).toBe(
      EnterpriseLeadKnowledgeIndexStatus.Failed,
    );
    expect(repairedWorkspace?.extractionSources[0]?.extractionError).toContain('interrupted');
  });

  test('does not merge document knowledge that the user has ignored', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    setup.service.updateWorkspaceProfile(workspace.id, {
      ...workspace.profile,
      productList: [],
      ignoredKnowledgeKeys: ['productList:精密金属支架'],
    });
    setup.modelClient.enqueue({
      ...draftPayload(),
      profile: {
        ...draftPayload().profile,
        productList: ['精密金属支架'],
      },
    });

    setup.service.enqueueWorkspaceDocumentProcessing(
      workspace.id,
      [
        {
          kind: 'file',
          label: '工厂资料',
          fileName: 'factory.md',
          text: '我们主营精密金属支架，服务自动化设备厂，卖点是来图定制。',
        },
      ],
      0,
    );
    await setup.service.waitForDocumentProcessingIdle();

    const processedWorkspace = setup.service.getWorkspace(workspace.id);
    expect(processedWorkspace?.profile.productList).not.toContain('精密金属支架');
    expect(processedWorkspace?.profile.ignoredKnowledgeKeys).toContain('productList:精密金属支架');
    expect(processedWorkspace?.extractionSources[0]?.extractedKnowledgeKeys ?? []).not.toContain(
      'productList:精密金属支架',
    );
  });

  test('clears stale raw workspace source vectors when documents are removed', () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      extractionSources: [],
    });

    setup.service.updateWorkspaceSources(workspace.id, [
      {
        kind: 'file',
        label: '工业包装资料',
        text: '主营工业包装服务，客户是机械设备厂采购负责人，卖点是防破损。',
      },
    ]);
    expect(
      setup.contentKnowledgeVectorStore.search(
        `enterprise-workspace:${workspace.id}`,
        '帮我做 10 个小红书选题',
      ).matched,
    ).toBe(true);

    const updated = setup.service.updateWorkspaceSources(workspace.id, []);
    const searchResult = setup.contentKnowledgeVectorStore.search(
      `enterprise-workspace:${workspace.id}`,
      '帮我做 10 个小红书选题',
    );
    const remainingRows = setup.db
      .prepare(
        `
        SELECT source_type
        FROM content_knowledge_chunks
        WHERE scope_id = ?
      `,
      )
      .all(buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspace.id)) as Array<{
      source_type: string;
    }>;

    expect(updated.extractionSources).toEqual([]);
    expect(searchResult.matched).toBe(false);
    expect(
      remainingRows.some(row => row.source_type === ContentKnowledgeSourceType.WorkspaceDocument),
    ).toBe(false);
    expect(
      remainingRows.some(row => row.source_type === ContentKnowledgeSourceType.WorkspaceRule),
    ).toBe(true);
  });

  test('indexes the initial workspace source when a workspace is created', () => {
    const setup = createService();
    db = setup.db;

    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      source: {
        kind: 'file',
        label: '初始工业包装资料',
        text: '主营工业包装服务，目标客户是机械设备厂采购负责人，卖点是防破损和免熏蒸。',
      },
    });

    expect(workspace.extractionSources[0]?.vectorIndexStatus).toBe('indexed');
    expect(workspace.extractionSources[0]?.vectorChunkCount).toBeGreaterThan(0);
    expect(
      setup.contentKnowledgeVectorStore.search(
        `enterprise-workspace:${workspace.id}`,
        '帮我做 10 个小红书选题',
      ).matched,
    ).toBe(true);
  });

  test('does not persist blank workspace creation as a document source', () => {
    const setup = createService();
    db = setup.db;

    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      source: {
        kind: EnterpriseLeadExtractionSourceKind.Blank,
        label: '空白创建',
      },
    });
    const remainingRows = setup.db
      .prepare(
        `
        SELECT source_type
        FROM content_knowledge_chunks
        WHERE scope_id = ?
      `,
      )
      .all(buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspace.id)) as Array<{
      source_type: string;
    }>;

    expect(workspace.extractionSources).toEqual([]);
    expect(setup.store.getWorkspace(workspace.id)?.extractionSources).toEqual([]);
    expect(
      remainingRows.some(row => row.source_type === ContentKnowledgeSourceType.WorkspaceDocument),
    ).toBe(false);
  });

  test('indexes confirmed profile facts and hard rules as derived workspace sources', () => {
    const setup = createService();
    db = setup.db;
    const baseDraft = draftPayload();

    const workspace = setup.service.createWorkspace({
      ...baseDraft,
      profile: {
        ...baseDraft.profile,
        productList: ['重型纸箱', '蜂窝纸板'],
        sellingPoints: ['可替代木箱'],
        prohibitedClaims: ['绝对防损'],
        contactRules: ['仅生成草稿，不要代替客户发送'],
        confirmedKnowledgeKeys: ['productList:重型纸箱', 'sellingPoints:可替代木箱'],
      },
      source: {
        kind: 'file',
        label: '初始工业包装资料',
        text: '主营工业包装服务，目标客户是机械设备厂采购负责人，卖点是防破损和免熏蒸。',
      },
    });
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspace.id);
    const rows = setup.db
      .prepare(
        `
        SELECT source_type, content
        FROM content_knowledge_chunks
        WHERE scope_id = ?
        ORDER BY source_type, chunk_index
      `,
      )
      .all(scopeId) as Array<{ source_type: string; content: string }>;
    const confirmedSource = rows.find(
      row => row.source_type === ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
    );
    const ruleSource = rows.find(
      row => row.source_type === ContentKnowledgeSourceType.WorkspaceRule,
    );

    expect(rows.some(row => row.source_type === ContentKnowledgeSourceType.WorkspaceDocument)).toBe(
      true,
    );
    expect(confirmedSource).toBeDefined();
    expect(confirmedSource?.content).toContain('重型纸箱');
    expect(confirmedSource?.content).toContain('可替代木箱');
    expect(confirmedSource?.content).not.toContain('蜂窝纸板');
    expect(ruleSource).toBeDefined();
    expect(ruleSource?.content).toContain('绝对防损');
    expect(ruleSource?.content).toContain('仅生成草稿，不要代替客户发送');
  });

  test('clears indexed workspace source content when a workspace is deleted', () => {
    const setup = createService();
    db = setup.db;

    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      source: {
        kind: 'file',
        label: '初始工业包装资料',
        text: '主营工业包装服务，目标客户是机械设备厂采购负责人，卖点是防破损和免熏蒸。',
      },
    });
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspace.id);

    expect(
      setup.contentKnowledgeVectorStore.search(scopeId, '帮我做 10 个小红书选题').matched,
    ).toBe(true);

    expect(setup.service.deleteWorkspace(workspace.id)).toBe(true);
    const searchResult = setup.contentKnowledgeVectorStore.search(
      scopeId,
      '帮我做 10 个小红书选题',
    );

    expect(searchResult.matched).toBe(false);
    expect(searchResult.diagnostics.candidateCount).toBe(0);
  });

  test('preserves uploaded document metadata and pending extraction status on creation', () => {
    const setup = createService();
    db = setup.db;

    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      source: {
        kind: EnterpriseLeadExtractionSourceKind.File,
        label: 'factory.md',
        fileName: 'factory.md',
        fileSize: 128,
        text: '主营精密五金加工。',
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Pending,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
      },
    });

    expect(workspace.extractionSources[0]).toMatchObject({
      kind: EnterpriseLeadExtractionSourceKind.File,
      label: 'factory.md',
      fileName: 'factory.md',
      fileSize: 128,
      text: '主营精密五金加工。',
      extractionStatus: EnterpriseLeadDocumentExtractionStatus.Pending,
    });
  });

  test('preserves Indexed vector status for sources without text or summary (e.g. images)', () => {
    const setup = createService();
    db = setup.db;

    const imageSource = {
      kind: EnterpriseLeadExtractionSourceKind.Image,
      label: 'factory-photo.png',
      fileName: 'factory-photo.png',
      filePath: '/tmp/factory-photo.png',
      fileSize: 2048,
      extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
      vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexed,
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
    };
    const textSource = {
      kind: EnterpriseLeadExtractionSourceKind.File,
      label: 'factory.md',
      fileName: 'factory.md',
      text: '主营精密五金加工。',
      extractionStatus: EnterpriseLeadDocumentExtractionStatus.Pending,
      vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
    };

    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      source: textSource,
      extractionSources: [imageSource, textSource],
    });

    expect(workspace.extractionSources).toHaveLength(2);
    const [storedImage, storedText] = workspace.extractionSources;
    expect(storedImage.vectorIndexStatus).toBe(EnterpriseLeadKnowledgeIndexStatus.Indexed);
    expect(storedImage.vectorChunkCount ?? 0).toBe(0);
    expect(storedText.vectorIndexStatus).toBe(EnterpriseLeadKnowledgeIndexStatus.Indexed);
    expect(storedText.vectorChunkCount).toBeGreaterThan(0);
  });

  test('preserves Indexed vector status for empty-content sources even when store throws', () => {
    const setup = createService();
    db = setup.db;

    const throwingStore = {
      ...setup.store,
      replaceSources: vi.fn(() => {
        throw new Error('vector store offline');
      }),
    };
    const serviceWithFailingStore = new EnterpriseLeadWorkspaceService({
      store: setup.store,
      modelClient: setup.modelClient,
      agentProvider: setup.agentProvider,
      contentKnowledgeVectorStore: throwingStore as unknown as ContentKnowledgeVectorStore,
    } as never);

    const imageSource = {
      kind: EnterpriseLeadExtractionSourceKind.Image,
      label: 'factory-photo.png',
      fileName: 'factory-photo.png',
      fileSize: 2048,
      extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
      vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexed,
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
    };
    const textSource = {
      kind: EnterpriseLeadExtractionSourceKind.File,
      label: 'factory.md',
      fileName: 'factory.md',
      text: '主营精密五金加工。',
      extractionStatus: EnterpriseLeadDocumentExtractionStatus.Pending,
      vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
    };

    const workspace = serviceWithFailingStore.createWorkspace({
      ...draftPayload(),
      source: textSource,
      extractionSources: [imageSource, textSource],
    });

    const [storedImage, storedText] = workspace.extractionSources;
    expect(storedImage.vectorIndexStatus).toBe(EnterpriseLeadKnowledgeIndexStatus.Indexed);
    expect(storedText.vectorIndexStatus).toBe(EnterpriseLeadKnowledgeIndexStatus.Failed);
  });

  test('does not expose dedicated workspace chat service methods', () => {
    const setup = createService();
    db = setup.db;
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(setup.service));
    const removedSessionMethodSuffixes = [`${'Chat'}Session`, `${'Chat'}Sessions`];

    expect(methodNames).not.toContain('chat');
    expect(
      methodNames.some(methodName =>
        removedSessionMethodSuffixes.some(suffix => methodName.endsWith(suffix)),
      ),
    ).toBe(false);
  });

  test('creates workspace and run with all workflow Agent tasks', async () => {
    const setup = createService();
    db = setup.db;

    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '找到本周可跟进的机械厂线索');

    expect(workspace.extractionSources).toEqual([
      expect.objectContaining({
        kind: 'file',
        label: 'ignored',
        text: 'ignored',
      }),
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
      skillIds: [],
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

  test('createWorkspace leaves workspace Agent bindings empty until the user adds Agents', () => {
    const setup = createService();
    db = setup.db;

    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      enabledAgentRoles: [],
      workspaceAgents: [],
    });

    expect(workspace.enabledAgentRoles).toEqual([]);
    expect(workspace.workspaceAgents).toEqual([]);
    expect(setup.store.getWorkspace(workspace.id)?.workspaceAgents).toEqual([]);
  });

  test('system template bindings resolve workflow defaults before workspace overrides', () => {
    const setup = createService();
    db = setup.db;

    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      workspaceAgents: [
        {
          agentId: EnterpriseLeadAgentRole.TopicPlanning,
          source: EnterpriseLeadWorkspaceAgentSource.SystemTemplate,
          templateId: EnterpriseLeadAgentRole.TopicPlanning,
          enabled: true,
          order: 0,
          overrides: {
            name: '本空间选题策划 Agent',
            model: 'gpt-4.1',
          },
        },
      ],
    });

    const snapshot = setup.service.createRun(workspace.id, '生成渠道内容');

    expect(snapshot.tasks[0].agentSnapshot).toMatchObject({
      agentId: EnterpriseLeadAgentRole.TopicPlanning,
      name: '本空间选题策划 Agent',
      description: '生成选题、标题、爆点、内容系列和平台角度。',
      identity: '选题策划 Agent',
      icon: '题',
      model: 'gpt-4.1',
      skillIds: [],
    });
    expect(snapshot.tasks[0].agentSnapshot?.systemPrompt).toContain(
      '输出：选题列表、标题方向、内容系列、推荐形式',
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

  test('local Agent bindings inherit local Agent definitions for execution', () => {
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
          source: EnterpriseLeadWorkspaceAgentSource.LocalAgent,
          enabled: true,
          order: 0,
          overrides: {},
        },
      ],
    });

    const snapshot = setup.service.createRun(workspace.id, '运行本地 Agent');

    expect(snapshot.tasks[0].agentSnapshot).toMatchObject({
      agentId: 'agent-content',
      name: 'Global content Agent',
      description: 'Global content description',
      identity: 'Global identity',
      systemPrompt: 'Global system prompt',
      icon: 'global',
      model: 'global-model',
      skillIds: [],
    });
    expect(agentProvider.getAgent).toHaveBeenCalledWith('agent-content');
  });

  test('workspace skill settings drive execution while prompts keep Agent config distinct', async () => {
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
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.skillIds = ['space-skill'];

    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      settings,
      workspaceAgents: [
        {
          agentId: 'agent-content',
          source: EnterpriseLeadWorkspaceAgentSource.WorkspaceCreated,
          enabled: true,
          order: 0,
          overrides: {
            name: 'Workspace content Agent',
            systemPrompt: 'Workspace-only execution prompt',
            skillIds: ['agent-skill'],
          },
        },
      ],
    });

    const snapshot = setup.service.createRun(workspace.id, '只使用空间技能');
    const task = snapshot.tasks[0];

    expect(task.agentSnapshot?.skillIds).toEqual(['space-skill']);

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
    expect(taskPrompt).toContain('space-skill');
    expect(taskPrompt).toMatch(/"workspaceAgents": \[\s*\{[\s\S]*"skillIds": \[\]/);
    expect(taskPrompt).toMatch(/"agentSnapshot": \{[\s\S]*"skillIds": \[\s*"space-skill"\s*\]/);
    expect(taskPrompt).not.toContain('agent-skill');
    expect(taskPrompt).not.toContain('global-skill');
  });

  test('new runs snapshot edited workspace-owned Agent definitions', () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      workspaceAgents: buildDefaultEnterpriseLeadWorkspaceAgents(),
    });

    const updated = setup.service.updateWorkspaceAgents(
      workspace.id,
      workspace.workspaceAgents.map(agent =>
        agent.agentId === EnterpriseLeadAgentRole.ProductSellingPoint
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
      task => task.role === EnterpriseLeadAgentRole.ProductSellingPoint,
    );

    expect(productTask?.workspaceAgentId).toBe(EnterpriseLeadAgentRole.ProductSellingPoint);
    expect(productTask?.agentSnapshot).toMatchObject({
      agentId: EnterpriseLeadAgentRole.ProductSellingPoint,
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
      skillIds: [],
    });
    expect(secondSnapshot.tasks[0].agentSnapshot).toMatchObject({
      agentId: 'agent-content',
      name: 'Edited content Agent',
      systemPrompt: 'Edited prompt',
      model: 'gpt-edited',
      skillIds: [],
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
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      workspaceAgents: buildDefaultEnterpriseLeadWorkspaceAgents(),
    });
    setup.service.updateWorkspaceAgents(
      workspace.id,
      workspace.workspaceAgents.filter(agent =>
        [EnterpriseLeadAgentRole.SocialCopy, EnterpriseLeadAgentRole.ContentQuality].includes(
          agent.agentId as EnterpriseLeadAgentRole,
        ),
      ),
    );

    const snapshot = setup.service.createRun(workspace.id, '输出小红书草稿并做风险检查');

    expect(snapshot.tasks.map(task => task.role)).toEqual([
      EnterpriseLeadAgentRole.SocialCopy,
      EnterpriseLeadAgentRole.ContentQuality,
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

  test('excludes workspace provider secrets from Agent task and pending-version prompts', async () => {
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

    const pendingVersionPrompt = setup.modelClient.prompts.at(-1)?.prompt ?? '';
    expect(pendingVersionPrompt).toContain('工业包装供应商');
    expect(pendingVersionPrompt).toContain('"configured": true');
    expect(pendingVersionPrompt).not.toContain('sk-workspace');
    expect(pendingVersionPrompt).not.toContain('tvly-workspace');
    expect(pendingVersionPrompt).not.toContain('"apiKey"');
  });

  test('excludes content platform secrets from Agent task and pending-version prompts', async () => {
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

    await setup.service.createPendingVersionFromChat(task.id, '根据默认平台写一版触达内容');

    const pendingVersionPrompt = setup.modelClient.prompts.at(-1)?.prompt ?? '';
    expect(pendingVersionPrompt).toContain('"defaultPlatformId": "xiaohongshu_draft"');
    expect(pendingVersionPrompt).toContain('"deliveryMode": "third_party_draft"');
    expect(pendingVersionPrompt).toContain('"configured": true');
    setup.modelClient.prompts
      .map(prompt => prompt.prompt)
      .forEach(prompt => {
        expect(prompt).not.toContain('xhs-secret-token');
        expect(prompt).not.toContain('https://draft.example.com/xhs');
        expect(prompt).not.toContain('"token"');
        expect(prompt).not.toContain('"endpoint"');
      });
  });

  test('tests a workspace Agent draft without persisting a chat session', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayloadWithWorkspaceModelConfig());
    setup.modelClient.enqueue(
      [
        '客户优先级：高',
        '判断依据：行业匹配，已有图纸和明确交期。',
        '缺失信息：目标价格和验收标准。',
        '下一步动作：安排技术评估，并由销售确认预算。',
      ].join('\n'),
    );

    const response = await setup.service.testWorkspaceAgent(workspace.id, {
      agentId: 'agent-opportunity',
      agent: {
        name: '商机雷达 Agent',
        description: '判断客户方向、采购信号、商机评分和跟进优先级。',
        identity: '只按当前编辑草稿执行。',
        systemPrompt: '当前草稿要求必须输出客户优先级、判断依据、缺失信息和下一步动作。',
        icon: '商',
        model: 'gpt-calibration',
        skillIds: [],
      },
      example: {
        sampleInput: '客户来自汽车零部件行业，询问 5000 件铝合金精密件。',
        expectedPriority: '高',
        expectedReason: '行业匹配，已有图纸，数量明确。',
        expectedMissing: '目标价格、材料牌号、验收标准仍需补充。',
        expectedNextStep: '安排技术评估图纸，并由销售确认预算和交期可行性。',
      },
    });

    expect(response.content).toContain('客户优先级：高');
    expect(response.checks).toEqual([
      { id: EnterpriseLeadWorkspaceAgentCalibrationCheckId.Priority, passed: true },
      { id: EnterpriseLeadWorkspaceAgentCalibrationCheckId.Reason, passed: true },
      { id: EnterpriseLeadWorkspaceAgentCalibrationCheckId.Missing, passed: true },
      { id: EnterpriseLeadWorkspaceAgentCalibrationCheckId.NextStep, passed: true },
    ]);
    expect(setup.modelClient.prompts).toHaveLength(1);
    expect(setup.modelClient.prompts[0].prompt).toContain('当前 Agent 草稿');
    expect(setup.modelClient.prompts[0].prompt).toContain('当前草稿要求必须输出客户优先级');
    expect(setup.modelClient.prompts[0].prompt).toContain('客户来自汽车零部件行业');
    expect(setup.modelClient.prompts[0].prompt).toContain('期望输出参考');
    expect(setup.modelClient.prompts[0].model).toBe('gpt-calibration');
  });

  test('creates a pending Agent version and applies it to the snapshot', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '优化私信草稿');
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.SocialCopy);
    if (!task) throw new Error('Expected social operation task');
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.SocialCopy,
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
      item => item.role === EnterpriseLeadAgentRole.TopicPlanning,
    );
    const socialTask = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.SocialCopy,
    );
    const salesTask = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.PrivateDomainConversion,
    );
    if (!contentTask || !socialTask || !salesTask) {
      throw new Error('Expected downstream tasks');
    }
    setup.store.updateTaskResult(socialTask.id, {
      role: EnterpriseLeadAgentRole.SocialCopy,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '旧版社媒草稿。',
      outputs: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });
    setup.store.updateTaskResult(salesTask.id, {
      role: EnterpriseLeadAgentRole.PrivateDomainConversion,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '旧版销售交接。',
      outputs: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.TopicPlanning,
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
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.ContentQuality);
    if (!task) throw new Error('Expected risk review task');
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.ContentQuality,
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
          role: EnterpriseLeadAgentRole.ContentQuality,
        },
      ],
      risks: [
        {
          level: EnterpriseLeadRiskLevel.High,
          title: '夸大宣传',
          description: '不能承诺绝对防损。',
          role: EnterpriseLeadAgentRole.ContentQuality,
        },
      ],
      handoffContext: {
        canArchive: false,
      },
    });

    const updatedTask = await setup.service.runTask(task.id);

    expect(updatedTask).toMatchObject({
      role: EnterpriseLeadAgentRole.ContentQuality,
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
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.TopicPlanning);
    if (!task) throw new Error('Expected content planning task');
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.ContentQuality,
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
      role: EnterpriseLeadAgentRole.TopicPlanning,
      status: EnterpriseLeadTaskStatus.NeedsInput,
      summary: '模型返回了错误枚举，但内容可保留。',
    });
  });

  test('downgrades malformed promotion results before they persist as completed', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      workspaceAgents: buildDefaultPromotionDepartmentWorkspaceAgents(),
    });
    const snapshot = setup.service.createRun(workspace.id, '抓取有来源的推广线索');
    const task = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.PromotionDataScraping,
    );
    if (!task) throw new Error('Expected promotion scraping task');
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.PromotionDataScraping,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '已抓取一条线索。',
      outputs: {
        items: [
          {
            sourceKind: 'search',
            title: '缺少来源的线索',
            content: '模型没有提供来源证据。',
            capturedAt: '2026-07-12T00:00:00.000Z',
            confidence: 'high',
          },
        ],
      },
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });

    const updatedTask = await setup.service.runTask(task.id);

    expect(updatedTask).toMatchObject({
      status: EnterpriseLeadTaskStatus.NeedsInput,
      outputPayload: {},
    });
    expect(setup.store.getTask(task.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.NeedsInput,
      outputPayload: {},
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
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.TopicPlanning);
    const socialTask = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.SocialCopy,
    );
    const salesTask = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.PrivateDomainConversion,
    );
    if (!task || !socialTask || !salesTask) {
      throw new Error('Expected content planning task and downstream tasks');
    }
    setup.store.updateTaskResult(socialTask.id, {
      role: EnterpriseLeadAgentRole.SocialCopy,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '旧版社媒计划。',
      outputs: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });
    setup.store.updateTaskResult(salesTask.id, {
      role: EnterpriseLeadAgentRole.PrivateDomainConversion,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '旧版销售交接。',
      outputs: {},
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.TopicPlanning,
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
    const snapshot = setup.service.createRun(workspace.id, '生成一套内容生产计划');
    const productTask = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.ProductSellingPoint,
    );
    const topicTask = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.TopicPlanning,
    );
    const scriptTask = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.ShortVideoScript,
    );
    if (!snapshot.currentRun || !productTask || !topicTask || !scriptTask) {
      throw new Error('Expected current run and workflow tasks');
    }
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.ProductSellingPoint,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '产品卖点完成。',
      outputs: {
        sellingPoints: ['替代木箱', '出口防损'],
      },
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    });
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.TopicPlanning,
      status: EnterpriseLeadTaskStatus.NeedsInput,
      summary: '需要确认首发平台。',
      outputs: {},
      missingInfo: ['首发平台'],
      todos: [],
      risks: [],
      handoffContext: {},
    });

    const workflowSnapshot = await setup.service.runWorkflow(workspace.id, snapshot.currentRun.id);

    expect(setup.modelClient.prompts).toHaveLength(2);
    expect(workflowSnapshot.currentRun).toMatchObject({
      id: snapshot.currentRun.id,
      status: EnterpriseLeadRunStatus.NeedsInput,
      currentRole: EnterpriseLeadAgentRole.TopicPlanning,
    });
    expect(workflowSnapshot.tasks.find(item => item.id === productTask.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.Completed,
      summary: '产品卖点完成。',
    });
    expect(workflowSnapshot.tasks.find(item => item.id === topicTask.id)).toMatchObject({
      status: EnterpriseLeadTaskStatus.NeedsInput,
      summary: '需要确认首发平台。',
    });
    expect(workflowSnapshot.tasks.find(item => item.id === scriptTask.id)).toMatchObject({
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
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.ContentQuality);
    if (!task || !snapshot.currentRun) throw new Error('Expected risk review task and current run');
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.ContentQuality,
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
          role: EnterpriseLeadAgentRole.ContentQuality,
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
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.TopicPlanning);
    if (!task || !snapshot.currentRun)
      throw new Error('Expected content planning task and current run');
    markRunReadyToArchive(setup.store, snapshot.currentRun.id);
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.TopicPlanning,
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
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.TopicPlanning);
    if (!task || !snapshot.currentRun)
      throw new Error('Expected content planning task and current run');
    markRunReadyToArchive(setup.store, snapshot.currentRun.id);
    const pendingGeneration = setup.modelClient.enqueuePending();

    const runTaskPromise = setup.service.runTask(task.id);
    expect(setup.modelClient.prompts).toHaveLength(1);
    setup.service.archiveRun(workspace.id, snapshot.currentRun.id);
    pendingGeneration.resolve({
      role: EnterpriseLeadAgentRole.TopicPlanning,
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
      summary: `${EnterpriseLeadAgentRole.TopicPlanning} 已完成。`,
      outputPayload: {},
    });
  });

  test('createPendingVersionFromChat rejects if run is archived while model generation is pending', async () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace(draftPayload());
    const snapshot = setup.service.createRun(workspace.id, '归档竞态测试');
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.TopicPlanning);
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
      role: EnterpriseLeadAgentRole.TopicPlanning,
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
    const task = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.PrivateDomainConversion,
    );
    if (!task) throw new Error('Expected sales handoff task');
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.PrivateDomainConversion,
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
          role: EnterpriseLeadAgentRole.PrivateDomainConversion,
        },
      ],
      risks: [],
      handoffContext: {},
    });
    await setup.service.runTask(task.id);
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.PrivateDomainConversion,
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
        role: EnterpriseLeadAgentRole.PrivateDomainConversion,
        title: '私域转化 Agent',
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

  test('derives promotion department deliverable kinds from completed Agent tasks', () => {
    const setup = createService();
    db = setup.db;
    const workspace = setup.service.createWorkspace({
      ...draftPayload(),
      workspaceAgents: buildDefaultPromotionDepartmentWorkspaceAgents(),
    });
    const snapshot = setup.service.createRun(workspace.id, '执行推广部闭环');
    const runId = snapshot.currentRun?.id;
    if (!runId) throw new Error('Expected promotion department run');

    const completeTask = (role: EnterpriseLeadAgentRole, summary: string): void => {
      const task = snapshot.tasks.find(item => item.role === role);
      if (!task) throw new Error(`Expected task for ${role}`);
      setup.store.updateTaskResult(task.id, {
        role,
        status: EnterpriseLeadTaskStatus.Completed,
        summary,
        outputs: {
          role,
          summary,
        },
        missingInfo: [],
        todos: [],
        risks: [],
        handoffContext: {},
      });
    };

    completeTask(EnterpriseLeadAgentRole.PromotionDataScraping, '原始线索已抓取。');
    completeTask(EnterpriseLeadAgentRole.PromotionLeadScoring, '商机评分已完成。');
    completeTask(EnterpriseLeadAgentRole.PromotionAccountMonitoring, '账户指标已监控。');
    completeTask(EnterpriseLeadAgentRole.PromotionPerformanceReview, '推广复盘已归档。');

    const updatedSnapshot = setup.service.getSnapshot(workspace.id, runId);

    expect(updatedSnapshot.deliverables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: EnterpriseLeadDeliverableKind.PromotionResearchData,
          role: EnterpriseLeadAgentRole.PromotionDataScraping,
          title: '数据抓取 Agent',
        }),
        expect.objectContaining({
          kind: EnterpriseLeadDeliverableKind.OpportunityReport,
          role: EnterpriseLeadAgentRole.PromotionLeadScoring,
          title: '商机评分 Agent',
        }),
        expect.objectContaining({
          kind: EnterpriseLeadDeliverableKind.PromotionMetricReport,
          role: EnterpriseLeadAgentRole.PromotionAccountMonitoring,
          title: '账户监控 Agent',
        }),
        expect.objectContaining({
          kind: EnterpriseLeadDeliverableKind.PromotionPerformanceReview,
          role: EnterpriseLeadAgentRole.PromotionPerformanceReview,
          title: '复盘归档 Agent',
        }),
      ]),
    );
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
    const task = snapshot.tasks.find(
      item => item.role === EnterpriseLeadAgentRole.PrivateDomainConversion,
    );
    if (!task) throw new Error('Expected sales handoff task');
    setup.modelClient.enqueue({
      role: EnterpriseLeadAgentRole.PrivateDomainConversion,
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
        role: EnterpriseLeadAgentRole.PrivateDomainConversion,
        title: '补充联系人',
      }),
    ]);
  });
});
