import { randomUUID } from 'crypto';

import {
  DomesticResearchMode,
  type DomesticResearchSourceId as DomesticResearchSourceIdValue,
  DomesticResearchSourceIds,
} from '../../shared/agent/domesticResearch';
import {
  AgentExternalResearchMode,
  type ExternalResearchProviderConfig,
  ExternalResearchProviderId,
  type ExternalResearchProviderId as ExternalResearchProviderIdValue,
  redactExternalResearchSecret,
} from '../../shared/agent/externalResearch';
import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadChatProgressPhase,
  EnterpriseLeadChatProgressStatus,
  EnterpriseLeadDeliverableKind,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadKnowledgeIndexStatus,
  EnterpriseLeadRiskLevel,
  EnterpriseLeadRunStatus,
  EnterpriseLeadTaskStatus,
  EnterpriseLeadTodoKind,
  EnterpriseLeadWorkspaceAgentCalibrationCheckId,
  EnterpriseLeadWorkspaceAgentSource,
  EnterpriseLeadWorkspaceType,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadAgentTaskResult,
  EnterpriseLeadArchive,
  EnterpriseLeadDeliverable,
  EnterpriseLeadExtractionSource,
  EnterpriseLeadPendingVersion,
  EnterpriseLeadRun,
  EnterpriseLeadTaskAgentRole,
  EnterpriseLeadTodo,
  EnterpriseLeadTodoInput,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
  EnterpriseLeadWorkspaceAgentCalibrationRequest,
  EnterpriseLeadWorkspaceAgentCalibrationResponse,
  EnterpriseLeadWorkspaceChatLeadCandidate,
  EnterpriseLeadWorkspaceChatMessage,
  EnterpriseLeadWorkspaceChatProgressEvent,
  EnterpriseLeadWorkspaceChatRequest,
  EnterpriseLeadWorkspaceChatResearchIntent,
  EnterpriseLeadWorkspaceChatResearchResult,
  EnterpriseLeadWorkspaceChatResponse,
  EnterpriseLeadWorkspaceChatRouteStep,
  EnterpriseLeadWorkspaceChatRouting,
  EnterpriseLeadWorkspaceChatSession,
  EnterpriseLeadWorkspaceChatSessionSummary,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceProfile,
  EnterpriseLeadWorkspaceRunAgentSnapshot,
  EnterpriseLeadWorkspaceRunSummary,
  EnterpriseLeadWorkspaceSettingsUpdate,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../shared/enterpriseLeadWorkspace/types';
import {
  normalizeAgentTaskResultInput,
  normalizeWorkspaceChatResearchIntent,
  normalizeWorkspaceDraftInput,
} from '../../shared/enterpriseLeadWorkspace/validation';
import type { ModelClientAdapter, ModelGenerationInput } from '../industryPack/modelClientAdapter';
import { resolveRawApiConfigFromAppConfig } from '../libs/claudeSettings';
import {
  CONTENT_KNOWLEDGE_EMBEDDING_VERSION,
  type ContentKnowledgeSearchHit,
  ContentKnowledgeSourceType,
} from '../libs/contentKnowledgeRetrieval';
import type { ContentKnowledgeVectorStore } from '../libs/contentKnowledgeVectorStore';
import { parseModelJsonObject } from './modelJson';
import {
  buildAgentChatPrompt,
  buildAgentTaskPrompt,
  buildWorkspaceAgentCalibrationPrompt,
  buildWorkspaceChatAgentStepPrompt,
  buildWorkspaceChatResearchIntentPrompt,
  buildWorkspaceChatResponsePrompt,
  buildWorkspaceExtractionPrompt,
  type WorkspaceChatAgentPromptSummary,
  type WorkspaceChatContentKnowledgeContext,
  type WorkspaceChatIndustryContext,
  type WorkspaceChatLeadContext,
} from './promptTemplates';
import type {
  CreateEnterpriseLeadTaskInput,
  EnterpriseLeadWorkspaceStore,
} from './store';
import {
  buildDefaultEnterpriseLeadWorkspaceAgents,
  ENTERPRISE_LEAD_AGENT_WORKFLOW,
  getEnterpriseLeadAgentMetadata,
} from './workflow';

interface EnterpriseLeadWorkspaceServiceOptions {
  store: EnterpriseLeadWorkspaceStore;
  modelClient: ModelClientAdapter;
  agentProvider?: EnterpriseLeadWorkspaceAgentProvider;
  contentKnowledgeVectorStore?: ContentKnowledgeVectorStore;
  researchClient?: EnterpriseLeadWorkspaceResearchClient;
  researchTimeoutMs?: number;
}

export interface EnterpriseLeadWorkspaceAgentTemplate {
  id: string;
  name: string;
  description?: string;
  identity?: string;
  systemPrompt?: string;
  icon?: string;
  model?: string;
  skillIds?: string[];
  enabled?: boolean;
}

export interface EnterpriseLeadWorkspaceAgentProvider {
  listAgents(): EnterpriseLeadWorkspaceAgentTemplate[];
  getAgent(agentId: string): EnterpriseLeadWorkspaceAgentTemplate | null;
}

export interface EnterpriseLeadWorkspaceResearchClient {
  tavilySearch(apiKey: string, query: string, maxResults: number): Promise<unknown>;
  tavilyExtract(apiKey: string, urls: string[], query?: string): Promise<unknown>;
  firecrawlSearch(apiKey: string, query: string, maxResults: number): Promise<unknown>;
  firecrawlScrape(apiKey: string, url: string): Promise<unknown>;
  domesticSearch(sourceId: string, query: string, maxResults: number): Promise<unknown>;
}

interface WorkspaceChatPlanningResult {
  researchIntent: EnterpriseLeadWorkspaceChatResearchIntent;
  targetAgent: WorkspaceChatAgentPromptSummary | null;
  route: WorkspaceChatAgentRoute | null;
}

interface WorkspaceChatAutoRouteRule {
  agentIds: EnterpriseLeadAgentRole[];
  agentTextPatterns: string[];
  messagePatterns: string[];
  reason: string;
}

interface WorkspaceChatAgentRoute {
  agents: WorkspaceChatAgentPromptSummary[];
  reason: string;
}

interface WorkspaceChatAgentStepRunInput {
  workspace: EnterpriseLeadWorkspace;
  effectiveAgents: WorkspaceChatAgentPromptSummary[];
  targetAgent: WorkspaceChatAgentPromptSummary | null;
  route: WorkspaceChatAgentRoute | null;
  recentMessages: EnterpriseLeadWorkspaceChatMessage[];
  userMessage: string;
  recentRunOutputs: unknown[];
  workspaceIndustryContext: WorkspaceChatIndustryContext;
  workspaceLeadContext: WorkspaceChatLeadContext;
  workspaceContentKnowledgeContext: WorkspaceChatContentKnowledgeContext;
  research: EnterpriseLeadWorkspaceChatResearchResult;
  apiConfig?: ModelGenerationInput['apiConfig'];
  progress?: WorkspaceChatProgressEmitter;
}

export type EnterpriseLeadWorkspaceChatProgressSink = (
  event: EnterpriseLeadWorkspaceChatProgressEvent,
) => void;

type WorkspaceChatProgressEventInput = Omit<
  EnterpriseLeadWorkspaceChatProgressEvent,
  'requestId' | 'timestamp'
>;

interface WorkspaceChatProgressEmitter {
  readonly events: EnterpriseLeadWorkspaceChatProgressEvent[];
  emit(event: WorkspaceChatProgressEventInput): void;
}

const noopAgentProvider: EnterpriseLeadWorkspaceAgentProvider = {
  listAgents: () => [],
  getAgent: () => null,
};

const noopResearchClient: EnterpriseLeadWorkspaceResearchClient = {
  tavilySearch: async () => ({}),
  tavilyExtract: async () => ({}),
  firecrawlSearch: async () => ({}),
  firecrawlScrape: async () => ({}),
  domesticSearch: async () => ({}),
};

const WorkspaceChatResearchStatus = {
  Skipped: 'skipped',
  Completed: 'completed',
  Failed: 'failed',
} as const;

const RESEARCH_PROMPT_PAYLOAD_TEXT_LIMIT = 2_000;
const RESEARCH_PROMPT_PAYLOAD_ITEM_LIMIT = 24;
const DEFAULT_WORKSPACE_CHAT_RESEARCH_TIMEOUT_MS = 20_000;
const sensitiveResearchPayloadKeyPattern =
  /(api.?key|secret|token|authorization|cookie|password|credential|raw|html)/i;

const WORKSPACE_CHAT_SESSION_TITLE_LIMIT = 48;
const WORKSPACE_CHAT_RESEARCH_AGENT_ATTRIBUTION = {
  id: 'research_helper',
  name: '调研助手 Agent',
} as const;
const WORKSPACE_CHAT_LEAD_CANDIDATE_LIMIT = 8;
const ENTERPRISE_WORKSPACE_KNOWLEDGE_SCOPE_PREFIX = 'enterprise-workspace';
const WORKSPACE_CONTENT_KNOWLEDGE_MAX_HITS = 6;
const WORKSPACE_CONTENT_PRODUCTION_PATTERNS = [
  '小红书',
  '选题',
  '标题',
  '脚本',
  '短视频',
  '口播',
  '分镜',
  '文案',
  '图文',
  '朋友圈',
  '私域',
  '私聊',
  '私信',
  '话术',
  '销售回复',
  '销售话术',
  '成交话术',
  '转化内容',
  '触达内容',
  '种草',
  '推广内容',
  '内容策划',
];

const createWorkspaceChatProgressEmitter = (
  requestId: string,
  progressSink?: EnterpriseLeadWorkspaceChatProgressSink,
): WorkspaceChatProgressEmitter => {
  const events: EnterpriseLeadWorkspaceChatProgressEvent[] = [];

  return {
    events,
    emit(eventInput) {
      const event: EnterpriseLeadWorkspaceChatProgressEvent = {
        ...eventInput,
        requestId,
        timestamp: Date.now(),
      };
      events.push(event);
      progressSink?.(event);
    },
  };
};

const buildEnterpriseWorkspaceKnowledgeScopeId = (workspaceId: string): string =>
  `${ENTERPRISE_WORKSPACE_KNOWLEDGE_SCOPE_PREFIX}:${workspaceId}`;

const buildEnterpriseWorkspaceKnowledgeSourceId = (index: number): string =>
  `source-${index}`;

const buildEnterpriseWorkspaceKnowledgeSourceContent = (
  source: EnterpriseLeadExtractionSource,
): string => [
  source.summary?.trim() ? `摘要：${source.summary.trim()}` : '',
  source.text?.trim() ?? '',
]
  .filter(Boolean)
  .join('\n\n');

const RISK_REVIEW_MISSING_COPY_RESPONSE = [
  '可以，我会按内容质检 Agent 来检查。',
  '',
  '请把待审宣传文案粘贴过来，最好包含标题、正文、落款和拟发布渠道。',
  '',
  '收到后我会输出问题句、风险原因、修改建议和更自然的可外发版本。',
].join('\n');

const OPPORTUNITY_MISSING_CUSTOMERS_RESPONSE = [
  '可以，我会按真实客户线索来判断跟进优先级。',
  '',
  '当前工作区还没有可用于排序的客户名单。请粘贴客户列表，或先导入包含公司名、行业、地区、需求、沟通记录的线索文件。',
  '',
  '最少给我：公司名 + 行业/产品 + 需求或沟通信号。我收到后会直接排序并给出跟进建议。',
].join('\n');

const OPPORTUNITY_RESEARCH_WITHOUT_COMPANIES_RESPONSE = [
  '可以，我已经检查了当前工作区资料和本轮调研结果。',
  '',
  '关键结论：未拿到具体公司名单，所以现在不能判断“这批客户谁更值得优先跟进”。我也不能把客户类型包装成真实客户来排序。',
  '',
  '当前能确定的是优先开发方向：自动化设备/包装机械/物流设备类机械厂，其次是有 OEM/ODM 需求的外贸公司或跨境电商品牌，再其次是工程承包商。',
  '',
  '下一步请提供客户名单，或继续按这些方向调研真实公司。拿到公司名、行业、需求信号或沟通记录后，我会直接给出评分排序和跟进建议。',
].join('\n');

const WORKSPACE_CHAT_AUTO_ROUTE_RULES: WorkspaceChatAutoRouteRule[] = [
  {
    agentIds: [EnterpriseLeadAgentRole.ContentQuality],
    agentTextPatterns: ['content_quality', '质检', '审核', '风险', '夸大', '不像 ai', 'ai 味'],
    messagePatterns: [
      '太像 ai',
      '像ai',
      '不像人写',
      '改自然',
      '润色',
      '优化',
      '质检',
      '检查',
      '风险',
      '夸大',
      '合规',
      '禁用表达',
    ],
    reason: '识别到：内容质检/改稿',
  },
  {
    agentIds: [
      EnterpriseLeadAgentRole.ProductSellingPoint,
      EnterpriseLeadAgentRole.ShortVideoScript,
      EnterpriseLeadAgentRole.ContentQuality,
    ],
    agentTextPatterns: ['short_video_script', '短视频', '脚本', '口播', '分镜'],
    messagePatterns: [
      '短视频',
      '视频脚本',
      '口播',
      '分镜',
      '脚本',
      '开头',
      '前三秒',
      '60 秒',
      '60秒',
      '抖音',
      '视频号',
    ],
    reason: '识别到：短视频脚本',
  },
  {
    agentIds: [
      EnterpriseLeadAgentRole.ProductSellingPoint,
      EnterpriseLeadAgentRole.PrivateDomainConversion,
      EnterpriseLeadAgentRole.ContentQuality,
    ],
    agentTextPatterns: ['private_domain_conversion', '私域', '私聊', '社群', '转化', '跟进'],
    messagePatterns: [
      '私域',
      '私聊',
      '私信',
      '微信',
      '社群',
      '跟进话术',
      '转化',
      '成交',
      '异议',
      '话术',
    ],
    reason: '识别到：私域转化话术',
  },
  {
    agentIds: [
      EnterpriseLeadAgentRole.ProductSellingPoint,
      EnterpriseLeadAgentRole.TopicPlanning,
      EnterpriseLeadAgentRole.ContentQuality,
    ],
    agentTextPatterns: ['topic_planning', '选题', '标题', '内容主题', '系列'],
    messagePatterns: [
      '选题',
      '标题',
      '主题',
      '内容日历',
      '内容规划',
      '系列',
      '爆点',
      '角度',
      '内容方向',
    ],
    reason: '识别到：选题策划',
  },
  {
    agentIds: [
      EnterpriseLeadAgentRole.ProductSellingPoint,
      EnterpriseLeadAgentRole.SocialCopy,
      EnterpriseLeadAgentRole.ContentQuality,
    ],
    agentTextPatterns: ['social_copy', '图文', '文案', '小红书', '朋友圈', '公众号'],
    messagePatterns: [
      '小红书',
      '朋友圈',
      '公众号',
      '海报',
      '图文',
      '种草',
      '文案',
      '推文',
      '活动文案',
    ],
    reason: '识别到：图文文案',
  },
  {
    agentIds: [EnterpriseLeadAgentRole.ProductSellingPoint],
    agentTextPatterns: ['product_selling_point', '卖点', '痛点', '信任背书', '差异化'],
    messagePatterns: ['卖点', '痛点', '优势', '差异化', '信任背书', '产品价值'],
    reason: '识别到：产品卖点提炼',
  },
];

const workflowRoles = (): EnterpriseLeadAgentRole[] =>
  ENTERPRISE_LEAD_AGENT_WORKFLOW.map(item => item.role);

const isEnterpriseLeadTaskStatus = (value: string): value is EnterpriseLeadTaskStatus =>
  Object.values(EnterpriseLeadTaskStatus).includes(value as EnterpriseLeadTaskStatus);

const isEnterpriseLeadTodoKind = (value: string): value is EnterpriseLeadTodoKind =>
  Object.values(EnterpriseLeadTodoKind).includes(value as EnterpriseLeadTodoKind);

const isEnterpriseLeadAgentRole = (value: string): value is EnterpriseLeadAgentRole =>
  Object.values(EnterpriseLeadAgentRole).includes(value as EnterpriseLeadAgentRole);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const getUpstreamTasks = (
  tasks: EnterpriseLeadAgentTask[],
  task: EnterpriseLeadAgentTask,
): EnterpriseLeadAgentTask[] => {
  const taskIndex = tasks.findIndex(item => item.id === task.id);
  if (taskIndex === -1) {
    return [];
  }

  return tasks.slice(0, taskIndex);
};

const getTaskTitle = (task: EnterpriseLeadAgentTask): string => {
  if (task.agentSnapshot?.name) {
    return task.agentSnapshot.name;
  }
  if (isEnterpriseLeadAgentRole(task.role)) {
    return getEnterpriseLeadAgentMetadata(task.role).title;
  }
  return task.role;
};

const getDeliverableKind = (
  role: EnterpriseLeadTaskAgentRole,
): EnterpriseLeadDeliverable['kind'] => {
  switch (role) {
    case EnterpriseLeadAgentRole.ProductSellingPoint:
    case EnterpriseLeadAgentRole.ProductUnderstanding:
      return EnterpriseLeadDeliverableKind.ProductProfile;
    case EnterpriseLeadAgentRole.TopicPlanning:
    case EnterpriseLeadAgentRole.ShortVideoScript:
    case EnterpriseLeadAgentRole.SocialCopy:
      return EnterpriseLeadDeliverableKind.ContentDraft;
    case EnterpriseLeadAgentRole.PrivateDomainConversion:
      return EnterpriseLeadDeliverableKind.SalesHandoff;
    case EnterpriseLeadAgentRole.ContentQuality:
      return EnterpriseLeadDeliverableKind.RiskReview;
    case EnterpriseLeadAgentRole.OpportunityRadar:
      return EnterpriseLeadDeliverableKind.OpportunityReport;
    case EnterpriseLeadAgentRole.ContentPlanning:
      return EnterpriseLeadDeliverableKind.ContentDraft;
    case EnterpriseLeadAgentRole.SocialOperation:
      return EnterpriseLeadDeliverableKind.SocialPlan;
    case EnterpriseLeadAgentRole.SalesHandoff:
      return EnterpriseLeadDeliverableKind.SalesHandoff;
    case EnterpriseLeadAgentRole.RiskReview:
      return EnterpriseLeadDeliverableKind.RiskReview;
    case EnterpriseLeadAgentRole.ProjectSummary:
      return EnterpriseLeadDeliverableKind.FinalSummary;
    default:
      return EnterpriseLeadDeliverableKind.FinalSummary;
  }
};

const sanitizeTaskResult = (
  result: EnterpriseLeadAgentTaskResult,
  task: EnterpriseLeadAgentTask,
): EnterpriseLeadAgentTaskResult => ({
  ...result,
  role: task.role,
  status: isEnterpriseLeadTaskStatus(result.status)
    ? result.status
    : EnterpriseLeadTaskStatus.NeedsInput,
});

const resolveWorkspaceApiConfig = (workspace: EnterpriseLeadWorkspace) =>
  resolveRawApiConfigFromAppConfig({
    model: {
      defaultModel: workspace.settings.model.defaultModel,
      defaultModelProvider: workspace.settings.model.defaultModelProvider,
    },
    providers: workspace.settings.model.providers,
  }).config ?? undefined;

const normalizeCalibrationText = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, '');

const includesAnyCalibrationToken = (content: string, tokens: string[]): boolean => {
  const normalizedContent = normalizeCalibrationText(content);
  return tokens.some(token => normalizedContent.includes(normalizeCalibrationText(token)));
};

const buildWorkspaceAgentCalibrationChecks = (
  content: string,
): EnterpriseLeadWorkspaceAgentCalibrationResponse['checks'] => [
  {
    id: EnterpriseLeadWorkspaceAgentCalibrationCheckId.Priority,
    passed: includesAnyCalibrationToken(content, ['客户优先级', '优先级', 'priority']),
  },
  {
    id: EnterpriseLeadWorkspaceAgentCalibrationCheckId.Reason,
    passed: includesAnyCalibrationToken(content, ['判断依据', '依据', 'reason']),
  },
  {
    id: EnterpriseLeadWorkspaceAgentCalibrationCheckId.Missing,
    passed: includesAnyCalibrationToken(content, ['缺失信息', '缺失', '待补充', 'missing']),
  },
  {
    id: EnterpriseLeadWorkspaceAgentCalibrationCheckId.NextStep,
    passed: includesAnyCalibrationToken(content, ['下一步动作', '下一步', '跟进', 'next']),
  },
];

const getResearchProgressDetail = (intent: EnterpriseLeadWorkspaceChatResearchIntent): string => {
  if (intent.kind === 'search' || intent.kind === 'domestic_search') {
    return intent.query;
  }
  if (intent.kind === 'extract') {
    return intent.query || intent.urls.join(', ');
  }
  return '';
};

const buildWorkspaceChatSessionTitle = (message: string): string => {
  const compact = message.replace(/\s+/g, ' ').trim();
  if (compact.length <= WORKSPACE_CHAT_SESSION_TITLE_LIMIT) {
    return compact || 'New chat';
  }
  return `${compact.slice(0, WORKSPACE_CHAT_SESSION_TITLE_LIMIT - 1)}…`;
};

export class EnterpriseLeadWorkspaceService {
  private readonly store: EnterpriseLeadWorkspaceStore;

  private readonly modelClient: ModelClientAdapter;

  private readonly agentProvider: EnterpriseLeadWorkspaceAgentProvider;

  private readonly researchClient: EnterpriseLeadWorkspaceResearchClient;

  private readonly contentKnowledgeVectorStore?: ContentKnowledgeVectorStore;

  private readonly researchTimeoutMs: number;

  constructor(options: EnterpriseLeadWorkspaceServiceOptions) {
    this.store = options.store;
    this.modelClient = options.modelClient;
    this.agentProvider = options.agentProvider ?? noopAgentProvider;
    this.contentKnowledgeVectorStore = options.contentKnowledgeVectorStore;
    this.researchClient = options.researchClient ?? noopResearchClient;
    this.researchTimeoutMs =
      options.researchTimeoutMs && options.researchTimeoutMs > 0
        ? options.researchTimeoutMs
        : DEFAULT_WORKSPACE_CHAT_RESEARCH_TIMEOUT_MS;
  }

  listWorkspaces(): EnterpriseLeadWorkspace[] {
    return this.store.listWorkspaces();
  }

  getWorkspace(id: string): EnterpriseLeadWorkspace | null {
    return this.store.getWorkspace(id);
  }

  async extractDraftFromConversation(sourceText: string): Promise<EnterpriseLeadWorkspaceDraft> {
    const sourceLabel = '对话输入';
    const result = await this.modelClient.generate({
      prompt: buildWorkspaceExtractionPrompt({ sourceText, sourceLabel }),
    });
    const draft = normalizeWorkspaceDraftInput(parseModelJsonObject(result.text));

    return {
      ...draft,
      source: {
        kind: EnterpriseLeadExtractionSourceKind.Conversation,
        label: sourceLabel,
        text: sourceText,
      },
    };
  }

  createWorkspace(draft: unknown): EnterpriseLeadWorkspace {
    const normalizedDraft = normalizeWorkspaceDraftInput(draft);
    const workspaceAgents = normalizedDraft.workspaceAgents.length > 0
      ? normalizedDraft.workspaceAgents
      : buildDefaultEnterpriseLeadWorkspaceAgents(workflowRoles());

    const workspace = this.store.createWorkspace({
      name: normalizedDraft.name,
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile: normalizedDraft.profile,
      extractionSources: [normalizedDraft.source],
      enabledAgentRoles: workflowRoles(),
      settings: normalizedDraft.settings,
      workspaceAgents,
    });
    if (!this.contentKnowledgeVectorStore) {
      return workspace;
    }
    return this.store.updateWorkspaceSources(
      workspace.id,
      this.syncWorkspaceSourcesToVectorIndex(workspace.id, workspace.extractionSources),
    );
  }

  deleteWorkspace(workspaceId: string): boolean {
    return this.store.deleteWorkspace(workspaceId);
  }

  updateWorkspaceSettings(
    workspaceId: string,
    input: EnterpriseLeadWorkspaceSettingsUpdate,
  ): EnterpriseLeadWorkspace {
    return this.store.updateWorkspaceSettings(workspaceId, input);
  }

  updateWorkspaceProfile(
    workspaceId: string,
    profile: EnterpriseLeadWorkspaceProfile,
  ): EnterpriseLeadWorkspace {
    return this.store.updateWorkspaceProfile(workspaceId, profile);
  }

  updateWorkspaceSources(
    workspaceId: string,
    sources: EnterpriseLeadExtractionSource[],
  ): EnterpriseLeadWorkspace {
    return this.store.updateWorkspaceSources(
      workspaceId,
      this.syncWorkspaceSourcesToVectorIndex(workspaceId, sources),
    );
  }

  private syncWorkspaceSourcesToVectorIndex(
    workspaceId: string,
    sources: EnterpriseLeadExtractionSource[],
  ): EnterpriseLeadExtractionSource[] {
    if (!this.contentKnowledgeVectorStore) {
      return sources;
    }

    const now = new Date().toISOString();
    const contentSources = sources.map((source, index) => ({
      source,
      sourceId: buildEnterpriseWorkspaceKnowledgeSourceId(index),
      content: buildEnterpriseWorkspaceKnowledgeSourceContent(source),
    }));

    try {
      const syncResult = this.contentKnowledgeVectorStore.replaceSources(
        buildEnterpriseWorkspaceKnowledgeScopeId(workspaceId),
        contentSources
          .filter(item => item.content.trim())
          .map(item => ({
            sourceId: item.sourceId,
            sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
            label: item.source.label,
            content: item.content,
          })),
      );
      const chunkCountBySourceId = new Map(
        syncResult.sourceResults.map(item => [item.sourceId, item.chunkCount]),
      );

      return contentSources.map((item): EnterpriseLeadExtractionSource => {
        const chunkCount = chunkCountBySourceId.get(item.sourceId) ?? 0;
        return {
          ...item.source,
          vectorChunkCount: chunkCount,
          vectorEmbeddingVersion: CONTENT_KNOWLEDGE_EMBEDDING_VERSION,
          vectorIndexError: undefined as string | undefined,
          vectorIndexedAt: chunkCount > 0 ? now : undefined,
          vectorIndexStatus: chunkCount > 0
            ? EnterpriseLeadKnowledgeIndexStatus.Indexed
            : EnterpriseLeadKnowledgeIndexStatus.Pending,
        };
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return sources.map((source): EnterpriseLeadExtractionSource => ({
        ...source,
        vectorChunkCount: 0,
        vectorEmbeddingVersion: CONTENT_KNOWLEDGE_EMBEDDING_VERSION,
        vectorIndexError: errorMessage,
        vectorIndexedAt: undefined as string | undefined,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Failed,
      }));
    }
  }

  updateWorkspaceAgents(
    workspaceId: string,
    agents: EnterpriseLeadWorkspaceAgentBinding[],
  ): EnterpriseLeadWorkspace {
    return this.store.updateWorkspaceAgents(workspaceId, agents);
  }

  listRuns(workspaceId: string): EnterpriseLeadWorkspaceRunSummary[] {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    return this.store.listRuns(workspaceId).map(run => {
      const tasks = this.store.listTasks(run.id);
      return {
        run,
        taskCount: tasks.length,
        deliverableCount: this.deriveDeliverables(workspace, run, tasks).length,
        todoCount: this.deriveTodos(workspace, run, tasks).length,
        riskCount: tasks.reduce((count, task) => count + task.risks.length, 0),
      };
    });
  }

  listChatSessions(workspaceId: string): EnterpriseLeadWorkspaceChatSessionSummary[] {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    return this.store.listChatSessions(workspaceId);
  }

  getChatSession(workspaceId: string, sessionId: string): EnterpriseLeadWorkspaceChatSession | null {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    return this.store.getChatSession(workspaceId, sessionId);
  }

  deleteChatSession(workspaceId: string, sessionId: string): boolean {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    return this.store.deleteChatSession(workspaceId, sessionId);
  }

  async chat(
    workspaceId: string,
    request: EnterpriseLeadWorkspaceChatRequest,
    progressSink?: EnterpriseLeadWorkspaceChatProgressSink,
  ): Promise<EnterpriseLeadWorkspaceChatResponse> {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    const effectiveAgents = this.resolveEffectiveWorkspaceAgents(workspace);
    const manualTargetAgent = this.resolveTargetAgent(request.targetAgentId, effectiveAgents);
    const recentMessages = this.sanitizeRecentMessages(workspace, request.recentMessages ?? []);
    const recentRunOutputs = this.collectRecentRunOutputs(workspace);
    const workspaceLeadContext = this.collectWorkspaceLeadContext(workspace, recentRunOutputs);
    const workspaceIndustryContext = this.collectWorkspaceIndustryContext(
      workspace,
      recentRunOutputs,
      request.message,
    );
    const workspaceContentKnowledgeContext = this.collectWorkspaceContentKnowledgeContext(
      workspace,
      request.message,
    );
    const progressRequestId = request.requestId?.trim() || randomUUID();
    const progress = createWorkspaceChatProgressEmitter(progressRequestId, progressSink);
    const emitProgress = progress.emit;
    const existingSession = request.sessionId
      ? this.store.getChatSession(workspace.id, request.sessionId)
      : null;
    if (request.sessionId && !existingSession) {
      throw new Error('Enterprise lead chat session not found');
    }
    const session = existingSession ?? this.store.createChatSession({
      workspaceId: workspace.id,
      title: buildWorkspaceChatSessionTitle(request.message),
    });
    this.store.appendChatMessage(session.id, {
      id: randomUUID(),
      role: 'user',
      content: request.message,
      createdAt: new Date().toISOString(),
    });
    const apiConfig = resolveWorkspaceApiConfig(workspace);
    emitProgress({
      stepId: 'routing',
      phase: EnterpriseLeadChatProgressPhase.Routing,
      status: EnterpriseLeadChatProgressStatus.Running,
      title: '正在分析任务和选择 Agent',
    });
    const intentResult = await this.modelClient.generate({
      prompt: buildWorkspaceChatResearchIntentPrompt({
        workspace,
        effectiveAgents,
        targetAgent: manualTargetAgent,
        recentMessages,
        userMessage: request.message,
        recentRunOutputs,
        workspaceIndustryContext,
        workspaceLeadContext,
        workspaceContentKnowledgeContext,
      }),
      apiConfig,
      ...(manualTargetAgent?.model ? { model: manualTargetAgent.model } : {}),
    });
    const planning = this.parseChatPlanningResult(
      intentResult.text,
      manualTargetAgent,
      effectiveAgents,
      request.message,
    );
    const { targetAgent, route } = planning;
    emitProgress({
      stepId: 'routing',
      phase: EnterpriseLeadChatProgressPhase.Routing,
      status: EnterpriseLeadChatProgressStatus.Completed,
      title: route ? '已选择 Agent' : '使用通用助手',
      ...(route?.reason ? { detail: route.reason } : {}),
      ...(targetAgent?.name ? { source: targetAgent.name } : {}),
    });
    const researchIntent = this.resolveEffectiveChatResearchIntent({
      workspace,
      plannedIntent: planning.researchIntent,
      userMessage: request.message,
    });
    if (researchIntent.kind !== 'none' && researchIntent.kind !== 'domestic_status') {
      emitProgress({
        stepId: 'research',
        phase: EnterpriseLeadChatProgressPhase.Research,
        status: EnterpriseLeadChatProgressStatus.Running,
        title: '正在调研公开信息',
        detail: getResearchProgressDetail(researchIntent),
      });
    }
    const research = this.enrichResearchResultForChat(
      await this.executeResearch(workspace, researchIntent),
    );
    if (researchIntent.kind !== 'none' && researchIntent.kind !== 'domestic_status') {
      emitProgress({
        stepId: 'research',
        phase: EnterpriseLeadChatProgressPhase.Research,
        status: research.status === 'failed'
          ? EnterpriseLeadChatProgressStatus.Failed
          : EnterpriseLeadChatProgressStatus.Completed,
        title: research.status === 'failed' ? '调研失败' : '调研完成',
        detail: research.summary,
        ...(research.provider ? { source: research.provider } : {}),
      });
    }
    const shortcutAnswer = this.resolveShortcutChatAnswer(
      request.message,
      targetAgent,
      workspaceLeadContext,
      research,
    );
    const shouldEmitSingleAgentProgress = Boolean(route && route.agents.length <= 1);
    if (shouldEmitSingleAgentProgress) {
      route?.agents.forEach(agent => {
        emitProgress({
          stepId: `agent:${agent.id}`,
          phase: EnterpriseLeadChatProgressPhase.Agent,
          status: EnterpriseLeadChatProgressStatus.Running,
          title: `${agent.name} 正在处理`,
          source: agent.name,
        });
      });
    }
    const agentStepResults = shortcutAnswer
      ? []
      : await this.runWorkspaceChatAgentSteps({
        workspace,
        effectiveAgents,
        targetAgent,
        route,
        recentMessages,
        userMessage: request.message,
        recentRunOutputs,
        workspaceIndustryContext,
        workspaceLeadContext,
        workspaceContentKnowledgeContext,
        research,
        apiConfig,
        progress,
      });
    const responseRoute = route
      ? this.withResearchAgentRoute(route, research, effectiveAgents)
      : null;
    if (shouldEmitSingleAgentProgress) {
      route?.agents.forEach(agent => {
        emitProgress({
          stepId: `agent:${agent.id}`,
          phase: EnterpriseLeadChatProgressPhase.Agent,
          status: EnterpriseLeadChatProgressStatus.Completed,
          title: `${agent.name} 已完成`,
          source: agent.name,
        });
      });
    }
    emitProgress({
      stepId: 'synthesis',
      phase: EnterpriseLeadChatProgressPhase.Synthesis,
      status: EnterpriseLeadChatProgressStatus.Running,
      title: '正在生成最终回复',
    });
    const answerText = shortcutAnswer ?? (await this.modelClient.generate({
      prompt: buildWorkspaceChatResponsePrompt({
        workspace,
        effectiveAgents,
        targetAgent,
        routing: responseRoute ? this.toChatRouting(responseRoute) : null,
        agentStepResults,
        recentMessages,
        userMessage: request.message,
        recentRunOutputs,
        workspaceIndustryContext,
        workspaceLeadContext,
        workspaceContentKnowledgeContext,
        researchResult: this.sanitizeResearchForPrompt(workspace, research),
      }),
      apiConfig,
      ...(targetAgent?.model ? { model: targetAgent.model } : {}),
    })).text.trim();
    emitProgress({
      stepId: 'synthesis',
      phase: EnterpriseLeadChatProgressPhase.Synthesis,
      status: EnterpriseLeadChatProgressStatus.Completed,
      title: '最终回复已生成',
    });
    emitProgress({
      stepId: 'done',
      phase: EnterpriseLeadChatProgressPhase.Done,
      status: EnterpriseLeadChatProgressStatus.Completed,
      title: '处理完成',
    });
    const assistantMessage: EnterpriseLeadWorkspaceChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: answerText,
      createdAt: new Date().toISOString(),
      ...(targetAgent
        ? {
          agent: {
            id: targetAgent.id,
            name: targetAgent.name,
          },
        }
        : {}),
      ...(route
        ? {
          routing: this.toChatRouting(responseRoute ?? route, agentStepResults),
        }
        : {}),
      research,
      progressEvents: progress.events,
    };
    this.store.appendChatMessage(session.id, assistantMessage);
    const persistedSession = this.store.getChatSession(workspace.id, session.id);

    return {
      message: assistantMessage,
      ...(persistedSession ? { session: persistedSession } : {}),
    };
  }

  async testWorkspaceAgent(
    workspaceId: string,
    request: EnterpriseLeadWorkspaceAgentCalibrationRequest,
  ): Promise<EnterpriseLeadWorkspaceAgentCalibrationResponse> {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    const result = await this.modelClient.generate({
      prompt: buildWorkspaceAgentCalibrationPrompt({
        workspace,
        agent: request.agent,
        example: request.example,
      }),
      apiConfig: resolveWorkspaceApiConfig(workspace),
      ...(request.agent.model.trim() ? { model: request.agent.model.trim() } : {}),
    });
    const content = result.text.trim();

    return {
      content,
      checks: buildWorkspaceAgentCalibrationChecks(content),
    };
  }

  createRun(workspaceId: string, userGoal: string): EnterpriseLeadWorkspaceSnapshot {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }
    const dynamicTasks = this.resolveRunTasksForWorkspace(workspace);
    const run = dynamicTasks.length > 0
      ? this.store.createRun({
          workspaceId,
          userGoal,
          tasks: dynamicTasks,
        })
      : this.store.createRun({
          workspaceId,
          userGoal,
          roles: this.resolveLegacyRunRoles(workspace),
        });

    return this.getSnapshot(workspaceId, run.id);
  }

  async runTask(taskId: string): Promise<EnterpriseLeadAgentTask> {
    const taskContext = this.getTaskContext(taskId);
    const taskModel = taskContext.task.agentSnapshot?.model.trim();
    const result = await this.modelClient.generate({
      prompt: buildAgentTaskPrompt(taskContext),
      apiConfig: resolveWorkspaceApiConfig(taskContext.workspace),
      ...(taskModel ? { model: taskModel } : {}),
    });
    const normalizedResult = sanitizeTaskResult(
      normalizeAgentTaskResultInput(parseModelJsonObject(result.text)),
      taskContext.task,
    );

    this.store.updateTaskResult(taskId, normalizedResult);
    const updatedTask = this.store.getTask(taskId);
    if (!updatedTask) {
      throw new Error('Enterprise lead Agent task disappeared after update');
    }

    return updatedTask;
  }

  async rerunTask(taskId: string): Promise<EnterpriseLeadAgentTask> {
    return this.runTask(taskId);
  }

  async runWorkflow(workspaceId: string, runId: string): Promise<EnterpriseLeadWorkspaceSnapshot> {
    const run = this.getRunForWorkspace(workspaceId, runId);
    const tasks = this.store.listTasks(run.id);

    for (const task of tasks) {
      if (task.status === EnterpriseLeadTaskStatus.Completed && !task.stale) {
        continue;
      }

      const taskTitle = getTaskTitle(task);
      this.store.updateRunProgress({
        runId: run.id,
        status: EnterpriseLeadRunStatus.Running,
        currentRole: task.role,
        controllerSummary: `${taskTitle} 正在处理。`,
      });

      const updatedTask = await this.runTask(task.id);
      if (updatedTask.status !== EnterpriseLeadTaskStatus.Completed) {
        const updatedTaskTitle = getTaskTitle(updatedTask);
        this.store.updateRunProgress({
          runId: run.id,
          status: this.mapTaskStatusToRunStatus(updatedTask.status),
          currentRole: updatedTask.role,
          controllerSummary: updatedTask.summary || `${updatedTaskTitle} 需要人工确认后继续。`,
        });
        return this.getSnapshot(workspaceId, run.id);
      }
    }

    this.store.updateRunProgress({
      runId: run.id,
      status: EnterpriseLeadRunStatus.Completed,
      currentRole: null,
      controllerSummary: '总控已完成本次获客任务。',
    });

    return this.getSnapshot(workspaceId, run.id);
  }

  async createPendingVersionFromChat(
    taskId: string,
    userMessage: string,
  ): Promise<EnterpriseLeadPendingVersion> {
    const taskContext = this.getTaskContext(taskId);
    const taskModel = taskContext.task.agentSnapshot?.model.trim();
    const result = await this.modelClient.generate({
      prompt: buildAgentChatPrompt({
        ...taskContext,
        userMessage,
      }),
      apiConfig: resolveWorkspaceApiConfig(taskContext.workspace),
      ...(taskModel ? { model: taskModel } : {}),
    });
    const normalizedResult = sanitizeTaskResult(
      normalizeAgentTaskResultInput(parseModelJsonObject(result.text)),
      taskContext.task,
    );

    return this.store.createPendingVersion({
      taskId,
      userMessage,
      summary: normalizedResult.summary,
      outputPayload: normalizedResult.outputs,
      missingInfo: normalizedResult.missingInfo,
      todos: normalizedResult.todos,
      risks: normalizedResult.risks,
      handoffContext: normalizedResult.handoffContext,
    });
  }

  applyPendingVersion(pendingVersionId: string): EnterpriseLeadWorkspaceSnapshot {
    const pendingVersion = this.store.applyPendingVersion(pendingVersionId);
    return this.getSnapshot(pendingVersion.workspaceId, pendingVersion.runId);
  }

  archiveRun(workspaceId: string, runId: string): EnterpriseLeadWorkspaceSnapshot {
    const runToArchive = this.getRunForWorkspace(workspaceId, runId);
    if (runToArchive.status !== EnterpriseLeadRunStatus.Completed) {
      throw new Error('Enterprise lead run must be completed before archive');
    }
    this.assertRunHasNoBlockingRiskReview(runToArchive.id);
    const run = this.store.archiveRun(workspaceId, runId);
    return this.getSnapshot(workspaceId, run.id);
  }

  getSnapshot(workspaceId: string, runId?: string): EnterpriseLeadWorkspaceSnapshot {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    const currentRun = this.getCurrentRun(workspace, runId);
    const tasks = currentRun ? this.store.listTasks(currentRun.id) : [];
    const pendingVersions = currentRun ? this.store.listPendingVersions(currentRun.id) : [];

    return {
      workspace,
      currentRun,
      tasks,
      pendingVersions,
      deliverables: currentRun ? this.deriveDeliverables(workspace, currentRun, tasks) : [],
      todos: currentRun ? this.deriveTodos(workspace, currentRun, tasks) : [],
      archives: this.deriveArchives(workspace),
    };
  }

  private resolveLegacyRunRoles(workspace: EnterpriseLeadWorkspace): EnterpriseLeadAgentRole[] {
    const selectedRoles = workspace.enabledAgentRoles.filter(isEnterpriseLeadAgentRole);
    return selectedRoles.length > 0 ? selectedRoles : workflowRoles();
  }

  private resolveRunTasksForWorkspace(
    workspace: EnterpriseLeadWorkspace,
  ): CreateEnterpriseLeadTaskInput[] {
    return this.resolveEffectiveWorkspaceAgents(workspace).map(agent => ({
      role: agent.id,
      workspaceAgentId: agent.id,
      agentSnapshot: this.toRunAgentSnapshot(agent),
    }));
  }

  private toRunAgentSnapshot(
    agent: WorkspaceChatAgentPromptSummary,
  ): EnterpriseLeadWorkspaceRunAgentSnapshot {
    return {
      agentId: agent.id,
      name: agent.name,
      description: agent.description,
      identity: agent.identity,
      systemPrompt: agent.systemPrompt,
      icon: agent.icon,
      model: agent.model,
      skillIds: agent.skillIds,
    };
  }

  private resolveEffectiveWorkspaceAgents(
    workspace: EnterpriseLeadWorkspace,
  ): WorkspaceChatAgentPromptSummary[] {
    const workspaceAgents = workspace.workspaceAgents.length > 0
      ? workspace.workspaceAgents
      : buildDefaultEnterpriseLeadWorkspaceAgents(this.resolveLegacyRunRoles(workspace));

    return [...workspaceAgents]
      .filter(binding => binding.enabled)
      .sort((left, right) => left.order - right.order)
      .map(binding => this.mergeWorkspaceAgentBinding(binding))
      .filter((agent): agent is WorkspaceChatAgentPromptSummary => Boolean(agent));
  }

  private mergeWorkspaceAgentBinding(
    binding: EnterpriseLeadWorkspaceAgentBinding,
  ): WorkspaceChatAgentPromptSummary | null {
    const baseBinding = binding.source === EnterpriseLeadWorkspaceAgentSource.SystemTemplate
      ? this.resolveSystemTemplateBinding(binding)
      : null;
    if (binding.source === EnterpriseLeadWorkspaceAgentSource.SystemTemplate && !baseBinding) {
      return null;
    }

    const baseOverrides = baseBinding?.overrides ?? {};
    const overrides = {
      ...baseOverrides,
      ...binding.overrides,
    };
    const name = overrides.name ?? binding.name ?? binding.agentId;
    return {
      id: binding.agentId,
      name,
      description: overrides.description ?? binding.description ?? '',
      identity: overrides.identity ?? binding.identity ?? '',
      systemPrompt: overrides.systemPrompt ?? binding.systemPrompt ?? '',
      icon: overrides.icon ?? binding.icon ?? '',
      model: overrides.model ?? binding.model ?? '',
      skillIds: overrides.skillIds ?? binding.skillIds ?? [],
    };
  }

  private resolveSystemTemplateBinding(
    binding: EnterpriseLeadWorkspaceAgentBinding,
  ): EnterpriseLeadWorkspaceAgentBinding | null {
    const templateId = binding.templateId ?? binding.agentId;
    if (!isEnterpriseLeadAgentRole(templateId)) {
      return null;
    }

    return buildDefaultEnterpriseLeadWorkspaceAgents([templateId])[0] ?? null;
  }

  private resolveTargetAgent(
    targetAgentId: string | undefined,
    effectiveAgents: WorkspaceChatAgentPromptSummary[],
  ): WorkspaceChatAgentPromptSummary | null {
    const targetId = targetAgentId?.trim();
    if (!targetId) {
      return null;
    }

    return effectiveAgents.find(agent => agent.id === targetId) ?? null;
  }

  private sanitizeRecentMessages(
    workspace: EnterpriseLeadWorkspace,
    messages: EnterpriseLeadWorkspaceChatMessage[],
  ): EnterpriseLeadWorkspaceChatMessage[] {
    return messages
      .filter(message => message.role === 'user' || message.role === 'assistant')
      .slice(-12)
      .map(message => {
        const sanitized: EnterpriseLeadWorkspaceChatMessage = {
          id: message.id,
          role: message.role,
          content: message.content.slice(0, 4_000),
          createdAt: message.createdAt,
        };
        if (message.research) {
          sanitized.research = this.sanitizeRecentResearch(workspace, message.research);
        }
        return sanitized;
      });
  }

  private sanitizeRecentResearch(
    workspace: EnterpriseLeadWorkspace,
    research: EnterpriseLeadWorkspaceChatResearchResult,
  ): EnterpriseLeadWorkspaceChatResearchResult {
    return {
      intent: research.intent,
      status: research.status,
      ...(research.provider ? { provider: research.provider } : {}),
      summary: this.redactWorkspaceResearchText(workspace, research.summary).slice(0, 1_000),
    };
  }

  private sanitizeResearchForPrompt(
    workspace: EnterpriseLeadWorkspace,
    research: EnterpriseLeadWorkspaceChatResearchResult,
  ): EnterpriseLeadWorkspaceChatResearchResult {
    const sanitized: EnterpriseLeadWorkspaceChatResearchResult = {
      intent: research.intent,
      status: research.status,
      ...(research.provider ? { provider: research.provider } : {}),
      summary: this.redactWorkspaceResearchText(workspace, research.summary).slice(0, 1_000),
    };
    const payloadSummary = this.summarizeResearchPayloadForPrompt(research.payload);
    if (payloadSummary) {
      sanitized.payload = {
        dataSummary: payloadSummary,
      };
    }
    if (research.leadCandidates?.length) {
      sanitized.leadCandidates = research.leadCandidates;
    }
    return sanitized;
  }

  private summarizeResearchPayloadForPrompt(payload: unknown): string {
    const items: string[] = [];
    const seen = new WeakSet<object>();

    const addText = (value: string): void => {
      const text = value.replace(/\s+/g, ' ').trim();
      if (!text) return;
      const currentLength = items.join('\n').length;
      if (currentLength >= RESEARCH_PROMPT_PAYLOAD_TEXT_LIMIT) return;
      const remaining = RESEARCH_PROMPT_PAYLOAD_TEXT_LIMIT - currentLength;
      items.push(text.slice(0, remaining));
    };

    const visit = (value: unknown, key?: string): void => {
      if (items.length >= RESEARCH_PROMPT_PAYLOAD_ITEM_LIMIT) {
        return;
      }
      if (key && sensitiveResearchPayloadKeyPattern.test(key)) {
        return;
      }
      if (typeof value === 'string') {
        addText(value);
        return;
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        addText(String(value));
        return;
      }
      if (!value || typeof value !== 'object') {
        return;
      }
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
      if (Array.isArray(value)) {
        value.slice(0, RESEARCH_PROMPT_PAYLOAD_ITEM_LIMIT).forEach(item => visit(item));
        return;
      }
      Object.entries(value)
        .slice(0, RESEARCH_PROMPT_PAYLOAD_ITEM_LIMIT)
        .forEach(([entryKey, entryValue]) => visit(entryValue, entryKey));
    };

    visit(payload);
    return items.join('\n').slice(0, RESEARCH_PROMPT_PAYLOAD_TEXT_LIMIT);
  }

  private redactWorkspaceResearchText(
    workspace: EnterpriseLeadWorkspace | undefined,
    text: string,
  ): string {
    if (!workspace) {
      return text;
    }
    return redactExternalResearchSecret(text, this.getWorkspaceResearchSecrets(workspace));
  }

  private getWorkspaceResearchSecrets(workspace: EnterpriseLeadWorkspace): string[] {
    return Object.values(workspace.settings.externalResearch.providers)
      .map(provider => provider.apiKey.trim())
      .filter(Boolean);
  }

  private collectRecentRunOutputs(workspace: EnterpriseLeadWorkspace): unknown[] {
    if (!workspace.recentRunId) {
      return [];
    }

    const run = this.store.getRun(workspace.recentRunId);
    if (!run || run.workspaceId !== workspace.id) {
      return [];
    }

    return this.store.listTasks(run.id)
      .filter(task => task.summary.trim() || Object.keys(task.outputPayload).length > 0)
      .slice(0, 12)
      .map(task => ({
        role: task.role,
        agentName: task.agentSnapshot?.name,
        workspaceAgentId: task.workspaceAgentId,
        status: task.status,
        summary: task.summary.slice(0, 1_000),
        outputSummary: this.summarizeResearchPayloadForPrompt(task.outputPayload),
        missingInfoSummary: this.summarizeResearchPayloadForPrompt(task.missingInfo),
        todoSummary: this.summarizeResearchPayloadForPrompt(task.todos),
        riskSummary: this.summarizeResearchPayloadForPrompt(task.risks),
      }));
  }

  private collectWorkspaceLeadContext(
    workspace: EnterpriseLeadWorkspace,
    recentRunOutputs: unknown[],
  ): WorkspaceChatLeadContext {
    const sources: WorkspaceChatLeadContext['sources'] = [];

    workspace.extractionSources.forEach((source, index) => {
      const label = source.label.trim() || `工作区资料 ${index + 1}`;
      const text = source.text?.trim() ?? '';
      const searchableText = [label, text].filter(Boolean).join('\n');
      if (!this.isLikelyWorkspaceLeadText(searchableText)) {
        return;
      }
      sources.push({
        kind: 'workspace_source',
        label,
        text: this.summarizeWorkspaceLeadText(text || label),
      });
    });

    recentRunOutputs.forEach((output, index) => {
      const text = this.summarizeResearchPayloadForPrompt(output);
      if (!this.isLikelyWorkspaceLeadText(text)) {
        return;
      }
      sources.push({
        kind: 'run_output',
        label: `最近运行输出 ${index + 1}`,
        text: this.summarizeWorkspaceLeadText(text),
      });
    });

    const limitedSources = sources.slice(0, 6);
    if (limitedSources.length === 0) {
      return {
        status: 'empty',
        note: '没有检测到可用于客户排序的具体客户名单或线索。',
        sources: [],
      };
    }

    return {
      status: 'available',
      note: '检测到工作区已有线索。请直接基于这些线索评分、排序和给出跟进建议；不要要求用户重复提供名单。',
      sources: limitedSources,
    };
  }

  private collectWorkspaceContentKnowledgeContext(
    workspace: EnterpriseLeadWorkspace,
    userMessage: string,
  ): WorkspaceChatContentKnowledgeContext {
    if (!this.isWorkspaceContentProductionRequest(userMessage)) {
      return {
        status: 'not_applicable',
        note: '本轮不是选题、脚本、私域话术或销售转化类内容生产请求，未触发向量知识预检。',
        hits: [],
        missingInfo: [],
      };
    }

    if (!this.contentKnowledgeVectorStore) {
      if (this.hasWorkspaceContentProfileBasics(workspace)) {
        return this.buildWorkspaceContentProfileFallbackContext(workspace);
      }
      return {
        status: 'missing',
        note: '本轮是内容生产请求，但本地向量知识库不可用。',
        hits: [],
        missingInfo: this.buildWorkspaceContentKnowledgeMissingInfo(workspace),
      };
    }

    const result = this.contentKnowledgeVectorStore.search(
      buildEnterpriseWorkspaceKnowledgeScopeId(workspace.id),
      userMessage,
      { maxHits: WORKSPACE_CONTENT_KNOWLEDGE_MAX_HITS },
    );
    const diagnostics = {
      candidateCount: result.diagnostics.candidateCount,
      rejectedCount: result.diagnostics.rejectedCount,
      hitThreshold: result.diagnostics.hitThreshold,
    };

    if (!result.matched) {
      if (this.hasWorkspaceContentProfileBasics(workspace)) {
        return {
          ...this.buildWorkspaceContentProfileFallbackContext(workspace),
          diagnostics,
        };
      }
      return {
        status: 'missing',
        note: '本轮是内容生产请求，但工作区向量知识没有足够相关命中。',
        hits: [],
        missingInfo: this.buildWorkspaceContentKnowledgeMissingInfo(workspace),
        diagnostics,
      };
    }

    return {
      status: 'matched',
      note: '本轮内容生产请求已命中工作区向量知识。回答时优先使用这些片段作为事实依据。',
      hits: result.hits
        .slice(0, WORKSPACE_CONTENT_KNOWLEDGE_MAX_HITS)
        .map(hit => this.toWorkspaceContentKnowledgeHit(hit)),
      missingInfo: workspace.profile.missingInfo.slice(0, 6),
      diagnostics,
    };
  }

  private buildWorkspaceContentProfileFallbackContext(
    workspace: EnterpriseLeadWorkspace,
  ): WorkspaceChatContentKnowledgeContext {
    return {
      status: 'profile_fallback',
      note: '本轮是内容生产请求，向量知识未充分命中，但工作区基础画像可用。请先基于工作空间资料输出草稿，并标注待补充信息。',
      hits: [],
      missingInfo: this.buildWorkspaceContentKnowledgeMissingInfo(workspace),
    };
  }

  private hasWorkspaceContentProfileBasics(workspace: EnterpriseLeadWorkspace): boolean {
    const profile = workspace.profile;
    const profileText = [
      profile.companySummary,
      ...profile.productList,
      ...profile.productCapabilities,
      ...profile.targetCustomers,
      ...profile.applicationScenarios,
      ...profile.sellingPoints,
      ...profile.channelPreferences,
    ].join('\n');
    if (profileText.trim()) {
      return true;
    }

    return workspace.extractionSources.some(source => {
      const text = [
        source.label,
        source.summary,
        source.text,
      ].filter(Boolean).join('\n');
      return this.isLikelyWorkspaceIndustryText(text);
    });
  }

  private toWorkspaceContentKnowledgeHit(
    hit: ContentKnowledgeSearchHit,
  ): WorkspaceChatContentKnowledgeContext['hits'][number] {
    return {
      score: Number(hit.scores.finalScore.toFixed(3)),
      sourceLabel: hit.chunk.sourceLabel,
      sourceType: hit.chunk.sourceType,
      text: hit.chunk.text.slice(0, 900),
    };
  }

  private buildWorkspaceContentKnowledgeMissingInfo(
    workspace: EnterpriseLeadWorkspace,
  ): string[] {
    return Array.from(new Set([
      ...workspace.profile.missingInfo,
      '领域/产品',
      '目标人群',
      '核心卖点',
      '转化目标',
      '账号定位',
      '可引用素材或证据',
    ])).slice(0, 8);
  }

  private isWorkspaceContentProductionRequest(userMessage: string): boolean {
    const normalizedMessage = this.normalizeAutoRouteText(userMessage);
    return WORKSPACE_CONTENT_PRODUCTION_PATTERNS.some(pattern =>
      normalizedMessage.includes(this.normalizeAutoRouteText(pattern)),
    );
  }

  private collectWorkspaceIndustryContext(
    workspace: EnterpriseLeadWorkspace,
    recentRunOutputs: unknown[],
    userMessage: string,
  ): WorkspaceChatIndustryContext {
    if (!this.isIndustryAnalysisRequest(userMessage)) {
      return {
        status: 'empty',
        industryLabel: '',
        confidence: 'low',
        note: '本轮不是行业态势分析请求，未激活行业证据包。',
        evidence: [],
        missingInfo: [],
      };
    }

    const evidence: WorkspaceChatIndustryContext['evidence'] = [];
    const profile = workspace.profile;
    const profileEvidenceText = this.summarizeWorkspaceIndustryText([
      profile.companySummary ? `企业概况：${profile.companySummary}` : '',
      profile.productList.length ? `产品：${profile.productList.join('、')}` : '',
      profile.productCapabilities.length
        ? `能力：${profile.productCapabilities.join('、')}`
        : '',
      profile.targetCustomers.length ? `目标客户：${profile.targetCustomers.join('、')}` : '',
      profile.applicationScenarios.length
        ? `应用场景：${profile.applicationScenarios.join('、')}`
        : '',
      profile.sellingPoints.length ? `卖点：${profile.sellingPoints.join('、')}` : '',
    ].filter(Boolean).join('\n'));
    if (profileEvidenceText) {
      evidence.push({
        kind: 'workspace_profile',
        label: '工作区企业画像',
        text: profileEvidenceText,
      });
    }

    workspace.extractionSources.forEach((source, index) => {
      if (evidence.filter(item => item.kind === 'workspace_source').length >= 4) {
        return;
      }
      const label = source.label.trim() || `工作区资料 ${index + 1}`;
      const text = this.summarizeWorkspaceIndustryText(source.text || label);
      if (!text) {
        return;
      }
      evidence.push({
        kind: 'workspace_source',
        label,
        text,
      });
    });

    recentRunOutputs.forEach((output, index) => {
      if (evidence.filter(item => item.kind === 'run_output').length >= 3) {
        return;
      }
      const text = this.summarizeWorkspaceIndustryText(
        this.summarizeResearchPayloadForPrompt(output),
      );
      if (!this.isLikelyWorkspaceIndustryText(text)) {
        return;
      }
      evidence.push({
        kind: 'run_output',
        label: `最近运行输出 ${index + 1}`,
        text,
      });
    });

    if (evidence.length === 0) {
      return {
        status: 'empty',
        industryLabel: '',
        confidence: 'low',
        note: '用户正在请求行业分析，但工作区缺少可识别的行业资料。',
        evidence: [],
        missingInfo: profile.missingInfo.slice(0, 8),
      };
    }

    const industryLabel = this.buildWorkspaceIndustryLabel(workspace, evidence);
    const hasSourceEvidence = evidence.some(item => item.kind === 'workspace_source');
    return {
      status: 'available',
      industryLabel,
      confidence: hasSourceEvidence ? 'high' : 'medium',
      note: `已从工作区资料识别行业方向：${industryLabel}。回答时先基于该行业分析，缺证据的判断标记为待验证。`,
      evidence: evidence.slice(0, 8),
      missingInfo: profile.missingInfo.slice(0, 8),
    };
  }

  private summarizeWorkspaceLeadText(text: string): string {
    return text
      .split(/\r?\n/)
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, 1_800);
  }

  private summarizeWorkspaceIndustryText(text: string): string {
    return text
      .split(/\r?\n/)
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, 1_200);
  }

  private isIndustryAnalysisRequest(userMessage: string): boolean {
    const normalizedMessage = this.normalizeAutoRouteText(userMessage);
    if (!normalizedMessage) {
      return false;
    }

    return [
      '行业形势',
      '行业形式',
      '行业态势',
      '行业分析',
      '行业趋势',
      '行业机会',
      '市场形势',
      '市场态势',
      '市场趋势',
      '竞争格局',
      '产业趋势',
      '分析当前行业',
      '当前行业',
    ].some(pattern => normalizedMessage.includes(this.normalizeAutoRouteText(pattern)));
  }

  private isLikelyWorkspaceIndustryText(text: string): boolean {
    const normalizedText = this.normalizeAutoRouteText(text);
    if (!normalizedText) {
      return false;
    }

    return [
      '行业',
      '市场',
      '趋势',
      '竞争',
      '采购',
      '客户',
      '产品',
      '场景',
      '替代',
      '成本',
      '需求',
      '出口',
      '运输',
    ].some(pattern => normalizedText.includes(this.normalizeAutoRouteText(pattern)));
  }

  private buildWorkspaceIndustryLabel(
    workspace: EnterpriseLeadWorkspace,
    evidence: WorkspaceChatIndustryContext['evidence'],
  ): string {
    const profile = workspace.profile;
    const combinedText = [
      workspace.name,
      profile.companySummary,
      profile.productList.join(' '),
      profile.targetCustomers.join(' '),
      profile.applicationScenarios.join(' '),
      profile.sellingPoints.join(' '),
      ...evidence.map(item => `${item.label} ${item.text}`),
    ].join(' ');
    const normalizedText = this.normalizeAutoRouteText(combinedText);

    if (normalizedText.includes('重包装') || normalizedText.includes('重包')) {
      return '重包装';
    }
    if (normalizedText.includes('工业包装')) {
      return '工业包装';
    }
    if (normalizedText.includes('包装')) {
      return '包装';
    }
    if (profile.companySummary.trim()) {
      return profile.companySummary.trim().slice(0, 40);
    }
    if (profile.productList.length > 0) {
      return profile.productList[0].slice(0, 40);
    }
    return '当前工作区行业';
  }

  private isLikelyWorkspaceLeadText(text: string): boolean {
    const normalizedText = this.normalizeAutoRouteText(text);
    if (!normalizedText) {
      return false;
    }

    const explicitLeadPatterns = [
      '客户名单',
      '客户列表',
      '客户池',
      '客户线索',
      '客户类型线索',
      '线索池',
      '线索名单',
      '线索',
      '潜客',
      '潜在客户',
      '公司名称',
      '公司名',
      '客户名称',
      '联系人',
      '询价',
      '采购信号',
      '沟通记录',
      '跟进记录',
    ];
    if (explicitLeadPatterns.some(pattern =>
      normalizedText.includes(this.normalizeAutoRouteText(pattern)),
    )) {
      return true;
    }

    const lines = text.split(/\r?\n|[;；]/).filter(line => line.trim().length > 0);
    const companyMarkers = text.match(/有限公司|股份有限公司|集团|公司/g) ?? [];
    const hasDemandSignal = ['询价', '需求', '采购', '月需求', '图纸', '打样', '报价', '跟进']
      .some(pattern => normalizedText.includes(this.normalizeAutoRouteText(pattern)));

    return lines.length >= 2 && companyMarkers.length >= 2 && hasDemandSignal;
  }

  private enrichResearchResultForChat(
    research: EnterpriseLeadWorkspaceChatResearchResult,
  ): EnterpriseLeadWorkspaceChatResearchResult {
    if (research.status !== WorkspaceChatResearchStatus.Completed) {
      return research;
    }

    const leadCandidates = this.extractLeadCandidatesFromResearchPayload(research.payload);
    if (leadCandidates.length === 0) {
      return research;
    }

    const companyCount = leadCandidates.filter(candidate => candidate.kind === 'company').length;
    const categoryCount = leadCandidates.filter(candidate => candidate.kind === 'category').length;
    return {
      ...research,
      summary: `调研提取 ${companyCount} 个具体公司，${categoryCount} 条客户类型线索。`,
      leadCandidates,
    };
  }

  private extractLeadCandidatesFromResearchPayload(
    payload: unknown,
  ): EnterpriseLeadWorkspaceChatLeadCandidate[] {
    const entries = this.collectResearchPayloadEntries(payload);
    const seen = new Set<string>();
    const candidates: EnterpriseLeadWorkspaceChatLeadCandidate[] = [];

    for (const entry of entries) {
      const text = [entry.title, entry.content].filter(Boolean).join('\n');
      if (!this.isLikelyWorkspaceLeadText(text)) {
        continue;
      }

      const companyName = this.extractCompanyName(text);
      const demandSignal = this.extractDemandSignal(this.stripResearchQueryEcho(text));
      const isConcreteCompanyLead = Boolean(companyName && demandSignal);
      const kind = isConcreteCompanyLead ? 'company' : 'category';
      const name = isConcreteCompanyLead ? companyName : entry.title.slice(0, 80);
      const key = `${kind}:${name}:${entry.url ?? ''}`;
      if (!name || seen.has(key)) {
        continue;
      }
      seen.add(key);

      candidates.push({
        kind,
        name,
        evidence: entry.content.slice(0, 280) || entry.title,
        ...(entry.title ? { sourceTitle: entry.title } : {}),
        ...(entry.url ? { sourceUrl: entry.url } : {}),
        ...(demandSignal ? { demandSignal } : {}),
        matchReason: isConcreteCompanyLead
          ? '搜索结果包含具体公司名称和客户/采购相关信号。'
          : companyName
            ? '搜索结果包含公司或供应商页面，但缺少采购、询价或需求信号；不能当作可排序客户。'
            : '搜索结果包含客户类型或行业需求方向，但没有具体公司名称。',
        confidence: isConcreteCompanyLead ? 'high' : 'low',
      });

      if (candidates.length >= WORKSPACE_CHAT_LEAD_CANDIDATE_LIMIT) {
        break;
      }
    }

    return candidates;
  }

  private collectResearchPayloadEntries(payload: unknown): Array<{
    title: string;
    content: string;
    url?: string;
  }> {
    const entries: Array<{ title: string; content: string; url?: string }> = [];
    const seen = new WeakSet<object>();

    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object' || entries.length >= WORKSPACE_CHAT_LEAD_CANDIDATE_LIMIT * 2) {
        return;
      }
      if (seen.has(value)) {
        return;
      }
      seen.add(value);

      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }

      const record = value as Record<string, unknown>;
      const title = this.cleanResearchEntryText(record.title ?? record.name ?? record.companyName);
      const content = this.cleanResearchEntryText(
        record.content
          ?? record.snippet
          ?? record.description
          ?? record.markdown
          ?? record.text,
      );
      const url = this.cleanResearchEntryText(record.url ?? record.link ?? record.sourceUrl);
      if (title || content) {
        entries.push({
          title: title || content.slice(0, 80),
          content,
          ...(url ? { url } : {}),
        });
      }

      Object.values(record).forEach(visit);
    };

    visit(payload);
    return entries;
  }

  private cleanResearchEntryText(value: unknown): string {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  }

  private stripResearchQueryEcho(text: string): string {
    return text
      .replace(/(?:页面匹配)?搜索词[:：][^。；;\n]*/g, '')
      .replace(/(?:search\s+query|query)[:：][^。；;\n]*/gi, '');
  }

  private extractCompanyName(text: string): string | null {
    const match = text.match(/[\u4e00-\u9fa5A-Za-z0-9（）()·\-]{2,50}(?:股份有限公司|集团有限公司|有限公司|集团|公司)/);
    const companyName = match?.[0]?.trim() ?? '';
    if (!companyName || this.isGenericCompanyName(companyName)) {
      return null;
    }
    return companyName;
  }

  private isGenericCompanyName(companyName: string): boolean {
    const normalized = companyName.replace(/\s+/g, '');
    if (/^[\u4e00-\u9fa5A-Za-z0-9（）()·-]{1,2}公司$/.test(normalized)) {
      return true;
    }
    return [
      '具体公司',
      '没有具体公司',
      '无具体公司',
      '外贸公司',
      '电商公司',
      '跨境电商公司',
      '机械设备公司',
      '自动化设备公司',
      '品牌公司',
      '客户公司',
      '目标公司',
      '潜在公司',
      '公司名称',
      '客户类型',
      '客户画像',
      '目标客户画像',
    ].some(pattern => normalized.includes(pattern));
  }

  private extractDemandSignal(text: string): string | null {
    const signalMatch = text.match(
      /[^。；;\n]*(?:采购|询价|求购|招标|中标|需求|月需求|打样|报价|寻源|找供应商|供应商征集|扩产|产线改造|设备改造|沟通记录|跟进记录)[^。；;\n]*/,
    );
    return signalMatch?.[0]?.replace(/\s+/g, ' ').trim().slice(0, 160) ?? null;
  }

  private async runWorkspaceChatAgentSteps({
    workspace,
    effectiveAgents,
    targetAgent,
    route,
  recentMessages,
  userMessage,
  recentRunOutputs,
  workspaceIndustryContext,
  workspaceLeadContext,
  workspaceContentKnowledgeContext,
  research,
  apiConfig,
    progress,
  }: WorkspaceChatAgentStepRunInput): Promise<EnterpriseLeadWorkspaceChatRouteStep[]> {
    if (!route || route.agents.length <= 1) {
      return [];
    }

    const stepResults: EnterpriseLeadWorkspaceChatRouteStep[] = [];
    const routing = this.toChatRouting(route);

    for (const [index, currentAgent] of route.agents.entries()) {
      const progressStepId = `agent:${currentAgent.id}:${index}`;
      progress?.emit({
        stepId: progressStepId,
        phase: EnterpriseLeadChatProgressPhase.Agent,
        status: EnterpriseLeadChatProgressStatus.Running,
        title: `${currentAgent.name} 正在处理`,
        source: currentAgent.name,
      });
      const result = await this.modelClient.generate({
        prompt: buildWorkspaceChatAgentStepPrompt({
          workspace,
          effectiveAgents,
          targetAgent,
          routing,
          currentAgent,
          previousStepResults: stepResults,
          recentMessages,
          userMessage,
          recentRunOutputs,
          workspaceIndustryContext,
          workspaceLeadContext,
          workspaceContentKnowledgeContext,
          researchResult: this.sanitizeResearchForPrompt(workspace, research),
        }),
        apiConfig,
        ...(currentAgent.model ? { model: currentAgent.model } : {}),
      });
      const content = result.text.trim();
      progress?.emit({
        stepId: progressStepId,
        phase: EnterpriseLeadChatProgressPhase.Agent,
        status: EnterpriseLeadChatProgressStatus.Completed,
        title: `${currentAgent.name} 已完成`,
        detail: content,
        source: currentAgent.name,
      });
      stepResults.push({
        agent: {
          id: currentAgent.id,
          name: currentAgent.name,
        },
        content,
      });
    }

    return stepResults;
  }

  private parseChatPlanningResult(
    modelText: string,
    manualTargetAgent: WorkspaceChatAgentPromptSummary | null,
    effectiveAgents: WorkspaceChatAgentPromptSummary[],
    userMessage: string,
  ): WorkspaceChatPlanningResult {
    try {
      const parsed = parseModelJsonObject(modelText);
      const rawIntent = isRecord(parsed) ? parsed.researchIntent : undefined;
      const plannedTargetAgent = this.resolvePlannedTargetAgent(parsed, effectiveAgents);
      const route = this.resolveChatAgentRoute({
        manualTargetAgent,
        plannedTargetAgent,
        userMessage,
        effectiveAgents,
      });
      return {
        researchIntent: normalizeWorkspaceChatResearchIntent(rawIntent),
        targetAgent: route?.agents[0] ?? null,
        route,
      };
    } catch {
      const route = this.resolveChatAgentRoute({
        manualTargetAgent,
        plannedTargetAgent: null,
        userMessage,
        effectiveAgents,
      });
      return {
        researchIntent: { kind: 'none' },
        targetAgent: route?.agents[0] ?? null,
        route,
      };
    }
  }

  private resolveEffectiveChatResearchIntent({
    workspace,
    plannedIntent,
    userMessage,
  }: {
    workspace: EnterpriseLeadWorkspace;
    plannedIntent: EnterpriseLeadWorkspaceChatResearchIntent;
    userMessage: string;
  }): EnterpriseLeadWorkspaceChatResearchIntent {
    if (plannedIntent.kind !== 'none') {
      return plannedIntent;
    }

    const autoIntent = this.resolveAutoExternalSearchResearchIntent({
      workspace,
      userMessage,
    });
    return autoIntent ?? plannedIntent;
  }

  private resolveAutoExternalSearchResearchIntent({
    workspace,
    userMessage,
  }: {
    workspace: EnterpriseLeadWorkspace;
    userMessage: string;
  }): EnterpriseLeadWorkspaceChatResearchIntent | null {
    if (!this.selectSearchProvider(workspace, 'auto')) {
      return null;
    }
    if (!this.shouldAutoSearchForLeadOpportunity(userMessage)) {
      return null;
    }

    return {
      kind: 'search',
      query: this.buildLeadOpportunitySearchQuery(workspace, userMessage),
      provider: 'auto',
    };
  }

  private shouldAutoSearchForLeadOpportunity(userMessage: string): boolean {
    const normalizedMessage = this.normalizeAutoRouteText(userMessage);
    if (!normalizedMessage) {
      return false;
    }

    const hasResearchCue = [
      '调研',
      '查',
      '搜索',
      '搜',
      '找',
      '线索',
      '客户名单',
      '客户列表',
      '客户线索',
      '潜在客户',
      '采购信号',
    ].some(pattern => normalizedMessage.includes(this.normalizeAutoRouteText(pattern)));
    const hasOpportunityCue = [
      '商机',
      '优先跟进',
      '谁更值得',
      '优先级',
      '判断这批客户',
      '判断这些客户',
    ].some(pattern => normalizedMessage.includes(this.normalizeAutoRouteText(pattern)));

    return hasResearchCue || hasOpportunityCue;
  }

  private buildLeadOpportunitySearchQuery(
    workspace: EnterpriseLeadWorkspace,
    userMessage: string,
  ): string {
    const profile = workspace.profile;
    const terms = [
      userMessage.trim(),
      profile.productList.slice(0, 4).join(' '),
      profile.targetCustomers.slice(0, 4).join(' '),
      profile.applicationScenarios.slice(0, 4).join(' '),
      '客户线索 采购信号 商机优先级',
    ]
      .map(term => term.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return Array.from(new Set(terms)).join(' ').slice(0, 500);
  }

  private resolveChatAgentRoute({
    manualTargetAgent,
    plannedTargetAgent,
    userMessage,
    effectiveAgents,
  }: {
    manualTargetAgent: WorkspaceChatAgentPromptSummary | null;
    plannedTargetAgent: WorkspaceChatAgentPromptSummary | null;
    userMessage: string;
    effectiveAgents: WorkspaceChatAgentPromptSummary[];
  }): WorkspaceChatAgentRoute | null {
    if (manualTargetAgent) {
      return {
        reason: `手动选择：${manualTargetAgent.name}`,
        agents: [manualTargetAgent],
      };
    }
    if (plannedTargetAgent) {
      return {
        reason: `自动判断：${plannedTargetAgent.name} 与任务匹配`,
        agents: [plannedTargetAgent],
      };
    }
    return this.resolveAutoRoute(userMessage, effectiveAgents);
  }

  private resolvePlannedTargetAgent(
    parsedPlanning: unknown,
    effectiveAgents: WorkspaceChatAgentPromptSummary[],
  ): WorkspaceChatAgentPromptSummary | null {
    if (!isRecord(parsedPlanning)) {
      return null;
    }

    const route = isRecord(parsedPlanning.route) ? parsedPlanning.route : null;
    const agent = isRecord(parsedPlanning.agent) ? parsedPlanning.agent : null;
    const rawTargetAgentId =
      (typeof parsedPlanning.targetAgentId === 'string' ? parsedPlanning.targetAgentId : undefined)
      ?? (route && typeof route.targetAgentId === 'string' ? route.targetAgentId : undefined)
      ?? (agent && typeof agent.id === 'string' ? agent.id : undefined);

    return this.resolveTargetAgent(rawTargetAgentId, effectiveAgents);
  }

  private resolveAutoRoute(
    userMessage: string,
    effectiveAgents: WorkspaceChatAgentPromptSummary[],
  ): WorkspaceChatAgentRoute | null {
    const normalizedMessage = this.normalizeAutoRouteText(userMessage);
    if (!normalizedMessage) {
      return null;
    }

    const matchedRule = WORKSPACE_CHAT_AUTO_ROUTE_RULES.find(rule =>
      rule.messagePatterns.some(pattern =>
        normalizedMessage.includes(this.normalizeAutoRouteText(pattern)),
      ),
    );
    if (!matchedRule) {
      return null;
    }

    const agents = this.findAutoRouteAgents(matchedRule, effectiveAgents);
    return agents.length > 0
      ? {
        agents,
        reason: matchedRule.reason,
      }
      : null;
  }

  private findAutoRouteAgents(
    rule: WorkspaceChatAutoRouteRule,
    effectiveAgents: WorkspaceChatAgentPromptSummary[],
  ): WorkspaceChatAgentPromptSummary[] {
    const directAgents = rule.agentIds
      .map(agentId => effectiveAgents.find(agent => agent.id === agentId))
      .filter((agent): agent is WorkspaceChatAgentPromptSummary => Boolean(agent));
    if (directAgents.length > 0) {
      return directAgents;
    }

    const textMatchedAgent = effectiveAgents.find(agent => {
        const searchableText = this.normalizeAutoRouteText([
          agent.id,
          agent.name,
          agent.description,
          agent.identity,
          agent.systemPrompt,
        ].join(' '));
        return rule.agentTextPatterns.some(pattern =>
          searchableText.includes(this.normalizeAutoRouteText(pattern)),
        );
      })
      ?? null;
    return textMatchedAgent ? [textMatchedAgent] : [];
  }

  private normalizeAutoRouteText(value: string): string {
    return value.replace(/\s+/g, '').trim().toLowerCase();
  }

  private withResearchAgentRoute(
    route: WorkspaceChatAgentRoute,
    research: EnterpriseLeadWorkspaceChatResearchResult,
    effectiveAgents: WorkspaceChatAgentPromptSummary[],
  ): WorkspaceChatAgentRoute {
    if (research.status !== WorkspaceChatResearchStatus.Completed || research.intent.kind === 'none') {
      return route;
    }

    const researchAgent = this.resolveResearchAgentAttribution(effectiveAgents);
    if (route.agents.some(agent => agent.id === researchAgent.id)) {
      return route;
    }

    return {
      ...route,
      agents: [
        researchAgent,
        ...route.agents,
      ],
    };
  }

  private resolveResearchAgentAttribution(
    effectiveAgents: WorkspaceChatAgentPromptSummary[],
  ): WorkspaceChatAgentPromptSummary {
    const configuredResearchAgent = effectiveAgents.find(agent => {
      const searchableText = this.normalizeAutoRouteText([
        agent.id,
        agent.name,
        agent.description,
        agent.identity,
        agent.systemPrompt,
      ].join(' '));
      return ['调研', '研究', '搜索', '情报', 'research'].some(pattern =>
        searchableText.includes(this.normalizeAutoRouteText(pattern)),
      );
    });
    return configuredResearchAgent ?? {
      ...WORKSPACE_CHAT_RESEARCH_AGENT_ATTRIBUTION,
      description: '执行外部搜索、读取公开来源并整理调研依据。',
      identity: '调研助手 Agent',
      systemPrompt: '执行外部搜索、读取公开来源并整理调研依据。',
      icon: '研',
      model: '',
      skillIds: [],
    };
  }

  private toChatRouting(
    route: WorkspaceChatAgentRoute,
    steps: EnterpriseLeadWorkspaceChatRouteStep[] = [],
  ): EnterpriseLeadWorkspaceChatRouting {
    return {
      reason: route.reason,
      agents: route.agents.map(agent => ({
        id: agent.id,
        name: agent.name,
      })),
      ...(steps.length > 0 ? { steps } : {}),
    };
  }

  private resolveShortcutChatAnswer(
    userMessage: string,
    targetAgent: WorkspaceChatAgentPromptSummary | null,
    workspaceLeadContext: WorkspaceChatLeadContext,
    research: EnterpriseLeadWorkspaceChatResearchResult,
  ): string | null {
    if (
      this.isCustomerPriorityReferenceRequest(userMessage)
      && (!targetAgent || this.isOpportunityRadarAgent(targetAgent))
    ) {
      const hasConcreteWorkspaceLeads = this.hasConcreteWorkspaceLeadContext(workspaceLeadContext);
      if (research.intent.kind === 'none' && !hasConcreteWorkspaceLeads) {
        return OPPORTUNITY_MISSING_CUSTOMERS_RESPONSE;
      }
      if (!hasConcreteWorkspaceLeads && !this.hasConcreteResearchLeadCandidates(research)) {
        return OPPORTUNITY_RESEARCH_WITHOUT_COMPANIES_RESPONSE;
      }
    }
    if (!targetAgent) {
      return null;
    }
    if (
      this.isRiskReviewAgent(targetAgent)
      && this.isRiskReviewMissingCopyRequest(userMessage)
    ) {
      return RISK_REVIEW_MISSING_COPY_RESPONSE;
    }
    return null;
  }

  private hasConcreteWorkspaceLeadContext(
    workspaceLeadContext: WorkspaceChatLeadContext,
  ): boolean {
    return workspaceLeadContext.sources.some(source =>
      Boolean(this.extractCompanyName([source.label, source.text].join('\n'))),
    );
  }

  private hasConcreteResearchLeadCandidates(
    research: EnterpriseLeadWorkspaceChatResearchResult,
  ): boolean {
    return research.leadCandidates?.some(candidate => candidate.kind === 'company') ?? false;
  }

  private isOpportunityRadarAgent(agent: WorkspaceChatAgentPromptSummary): boolean {
    if (agent.id === EnterpriseLeadAgentRole.OpportunityRadar) {
      return true;
    }
    const searchableText = this.normalizeAutoRouteText([
      agent.id,
      agent.name,
      agent.description,
      agent.identity,
      agent.systemPrompt,
    ].join(' '));
    return ['opportunity_radar', '商机', '机会', '采购信号', '评分', '优先级'].some(pattern =>
      searchableText.includes(this.normalizeAutoRouteText(pattern)),
    );
  }

  private isCustomerPriorityReferenceRequest(userMessage: string): boolean {
    const normalizedMessage = this.normalizeAutoRouteText(userMessage);
    if (!normalizedMessage) {
      return false;
    }

    const hasCustomerReference = [
      '这批客户',
      '这些客户',
      '这组客户',
      '客户名单',
      '客户列表',
      '线索名单',
      '这批线索',
      '这些线索',
    ].some(pattern => normalizedMessage.includes(this.normalizeAutoRouteText(pattern)));
    const hasPriorityIntent = [
      '优先跟进',
      '值得优先',
      '谁更值得',
      '优先级',
      '排序',
      '评分',
      '判断',
    ].some(pattern => normalizedMessage.includes(this.normalizeAutoRouteText(pattern)));

    return hasCustomerReference && hasPriorityIntent;
  }

  private isRiskReviewAgent(agent: WorkspaceChatAgentPromptSummary): boolean {
    if (
      agent.id === EnterpriseLeadAgentRole.RiskReview ||
      agent.id === EnterpriseLeadAgentRole.ContentQuality
    ) {
      return true;
    }
    const searchableText = this.normalizeAutoRouteText([
      agent.id,
      agent.name,
      agent.description,
      agent.identity,
      agent.systemPrompt,
    ].join(' '));
    return ['risk_review', 'content_quality', '风控', '审核', '风险', '质检'].some(pattern =>
      searchableText.includes(this.normalizeAutoRouteText(pattern)),
    );
  }

  private isRiskReviewMissingCopyRequest(userMessage: string): boolean {
    const trimmedMessage = userMessage.trim();
    if (!trimmedMessage) {
      return true;
    }

    const normalizedMessage = this.normalizeAutoRouteText(trimmedMessage);
    const asksForReview = ['检查', '审核', '风控', '风险', '夸大', '合规', '宣传文案']
      .some(pattern => normalizedMessage.includes(this.normalizeAutoRouteText(pattern)));
    if (!asksForReview) {
      return false;
    }

    const [, trailingContent = ''] = trimmedMessage.split(/[:：\n]/, 2);
    if (trailingContent.trim().length > 0) {
      return trailingContent.replace(/[“”"']/g, '').trim().length < 12;
    }

    const possibleCopy = trimmedMessage
      .replace(/帮我|请|检查|审核|看看|一下|这段|宣传文案|有没有|是否|夸大|风险|风控|合规/g, '')
      .replace(/\s+/g, '')
      .trim();
    return possibleCopy.length < 24 && trimmedMessage.length < 70;
  }

  private async executeResearch(
    workspace: EnterpriseLeadWorkspace,
    intent: EnterpriseLeadWorkspaceChatResearchIntent,
  ): Promise<EnterpriseLeadWorkspaceChatResearchResult> {
    if (intent.kind === 'none') {
      return {
        intent,
        status: WorkspaceChatResearchStatus.Skipped,
        summary: '未请求外部调研。',
      };
    }

    try {
      if (intent.kind === 'search') {
        return await this.executeSearchResearch(workspace, intent);
      }
      if (intent.kind === 'extract') {
        return await this.executeExtractResearch(workspace, intent);
      }
      if (intent.kind === 'domestic_search') {
        return await this.executeDomesticSearchResearch(workspace, intent);
      }
      return await this.executeDomesticStatusResearch(workspace, intent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        intent,
        status: WorkspaceChatResearchStatus.Failed,
        summary: this.redactWorkspaceResearchText(workspace, message),
      };
    }
  }

  private async executeSearchResearch(
    workspace: EnterpriseLeadWorkspace,
    intent: Extract<EnterpriseLeadWorkspaceChatResearchIntent, { kind: 'search' }>,
  ): Promise<EnterpriseLeadWorkspaceChatResearchResult> {
    const provider = this.selectSearchProvider(workspace, intent.provider);
    if (!provider) {
      return this.failedResearch(
        intent,
        'External search is unavailable because Tavily or Firecrawl is not configured for this workspace.',
      );
    }

    const config = workspace.settings.externalResearch.providers[provider];
    const payload = provider === ExternalResearchProviderId.Tavily
      ? await this.withResearchTimeout(
          this.researchClient.tavilySearch(config.apiKey, intent.query, 5),
          `${provider} search`,
        )
      : await this.withResearchTimeout(
          this.researchClient.firecrawlSearch(config.apiKey, intent.query, 5),
          `${provider} search`,
        );

    return {
      intent,
      status: WorkspaceChatResearchStatus.Completed,
      provider,
      summary: `${provider} search completed for: ${intent.query}`,
      payload,
    };
  }

  private async executeExtractResearch(
    workspace: EnterpriseLeadWorkspace,
    intent: Extract<EnterpriseLeadWorkspaceChatResearchIntent, { kind: 'extract' }>,
  ): Promise<EnterpriseLeadWorkspaceChatResearchResult> {
    const provider = this.selectExtractProvider(workspace, intent.provider);
    if (!provider) {
      return this.failedResearch(
        intent,
        'External extraction is unavailable because Tavily or Firecrawl is not configured for this workspace.',
      );
    }

    const config = workspace.settings.externalResearch.providers[provider];
    const payload = provider === ExternalResearchProviderId.Firecrawl
      ? await this.withResearchTimeout(
          Promise.all(intent.urls.map(url =>
            this.researchClient.firecrawlScrape(config.apiKey, url),
          )),
          `${provider} extraction`,
        )
      : await this.withResearchTimeout(
          this.researchClient.tavilyExtract(config.apiKey, intent.urls, intent.query),
          `${provider} extraction`,
        );

    return {
      intent,
      status: WorkspaceChatResearchStatus.Completed,
      provider,
      summary: `${provider} extraction completed for ${intent.urls.length} URL(s).`,
      payload,
    };
  }

  private async executeDomesticStatusResearch(
    workspace: EnterpriseLeadWorkspace,
    intent: Extract<EnterpriseLeadWorkspaceChatResearchIntent, { kind: 'domestic_status' }>,
  ): Promise<EnterpriseLeadWorkspaceChatResearchResult> {
    const domesticConfig = workspace.settings.domesticResearch;
    const enabledSources = DomesticResearchSourceIds
      .map(sourceId => ({
        sourceId,
        ...domesticConfig.sources[sourceId],
      }))
      .filter(source => source.enabled);
    const searchableSources = enabledSources.filter(source =>
      source.modes.includes(DomesticResearchMode.Search),
    );
    const searched = await Promise.all(searchableSources.map(async source => ({
      sourceId: source.sourceId,
      result: await this.withResearchTimeout(
        this.researchClient.domesticSearch(source.sourceId, workspace.name, 5),
        `${source.sourceId} domestic status search`,
      ),
    })));
    const enabledCustomSources = domesticConfig.customSources.filter(source => source.enabled);

    return {
      intent,
      status: WorkspaceChatResearchStatus.Completed,
      provider: 'domestic',
      summary: enabledSources.length > 0 || enabledCustomSources.length > 0
        ? 'Domestic research sources are configured for read-only status and URL review.'
        : 'No domestic research sources are enabled for this workspace.',
      payload: {
        enabledSources,
        customSources: enabledCustomSources,
        searched,
      },
    };
  }

  private async executeDomesticSearchResearch(
    workspace: EnterpriseLeadWorkspace,
    intent: Extract<EnterpriseLeadWorkspaceChatResearchIntent, { kind: 'domestic_search' }>,
  ): Promise<EnterpriseLeadWorkspaceChatResearchResult> {
    const searchableSourceIds = this.selectDomesticSearchSourceIds(workspace, intent.sourceIds);
    const normalizedIntent: EnterpriseLeadWorkspaceChatResearchIntent = {
      ...intent,
      sourceIds: searchableSourceIds,
    };

    if (searchableSourceIds.length === 0) {
      return this.failedResearch(
        normalizedIntent,
        'Domestic platform search is unavailable because no enabled searchable domestic sources are configured for this workspace.',
      );
    }

    const searched = await Promise.all(searchableSourceIds.map(async sourceId => ({
      sourceId,
      result: await this.withResearchTimeout(
        this.researchClient.domesticSearch(sourceId, intent.query, 5),
        `${sourceId} domestic search`,
      ),
    })));

    return {
      intent: normalizedIntent,
      status: WorkspaceChatResearchStatus.Completed,
      provider: 'domestic',
      summary: `Domestic platform search completed for: ${intent.query}`,
      payload: {
        searched,
      },
    };
  }

  private failedResearch(
    intent: EnterpriseLeadWorkspaceChatResearchIntent,
    summary: string,
  ): EnterpriseLeadWorkspaceChatResearchResult {
    return {
      intent,
      status: WorkspaceChatResearchStatus.Failed,
      summary,
    };
  }

  private withResearchTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${label} timed out after ${this.researchTimeoutMs}ms.`));
      }, this.researchTimeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    });
  }

  private selectSearchProvider(
    workspace: EnterpriseLeadWorkspace,
    requestedProvider: 'auto' | 'tavily' | 'firecrawl',
  ): ExternalResearchProviderIdValue | null {
    if (requestedProvider !== 'auto') {
      return this.isProviderReady(workspace, requestedProvider) ? requestedProvider : null;
    }
    if (this.isProviderReady(workspace, ExternalResearchProviderId.Tavily)) {
      return ExternalResearchProviderId.Tavily;
    }
    if (this.isProviderReady(workspace, ExternalResearchProviderId.Firecrawl)) {
      return ExternalResearchProviderId.Firecrawl;
    }
    return null;
  }

  private selectExtractProvider(
    workspace: EnterpriseLeadWorkspace,
    requestedProvider: 'auto' | 'tavily' | 'firecrawl',
  ): ExternalResearchProviderIdValue | null {
    if (requestedProvider !== 'auto') {
      return this.isProviderReady(workspace, requestedProvider) ? requestedProvider : null;
    }
    if (this.isProviderReady(workspace, ExternalResearchProviderId.Firecrawl)) {
      return ExternalResearchProviderId.Firecrawl;
    }
    if (this.isProviderReady(workspace, ExternalResearchProviderId.Tavily)) {
      return ExternalResearchProviderId.Tavily;
    }
    return null;
  }

  private isProviderReady(
    workspace: EnterpriseLeadWorkspace,
    providerId: ExternalResearchProviderIdValue,
  ): boolean {
    const externalConfig = workspace.settings.externalResearch;
    if (externalConfig.mode === AgentExternalResearchMode.Disabled) {
      return false;
    }
    const providerConfig: ExternalResearchProviderConfig = externalConfig.providers[providerId];
    return providerConfig.enabled && providerConfig.apiKey.trim().length > 0;
  }

  private selectDomesticSearchSourceIds(
    workspace: EnterpriseLeadWorkspace,
    requestedSourceIds: DomesticResearchSourceIdValue[],
  ): DomesticResearchSourceIdValue[] {
    const requested = requestedSourceIds.length > 0
      ? new Set(requestedSourceIds)
      : null;
    return DomesticResearchSourceIds.filter(sourceId => {
      if (requested && !requested.has(sourceId)) {
        return false;
      }
      const source = workspace.settings.domesticResearch.sources[sourceId];
      return source.enabled && source.modes.includes(DomesticResearchMode.Search);
    });
  }

  private getRunForWorkspace(workspaceId: string, runId: string): EnterpriseLeadRun {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    const run = this.store.getRun(runId);
    if (!run) {
      throw new Error('Enterprise lead run not found');
    }
    if (run.workspaceId !== workspace.id) {
      throw new Error('Enterprise lead run does not belong to workspace');
    }
    if (run.status === EnterpriseLeadRunStatus.Archived || run.archiveStatus === 'archived') {
      throw new Error('Enterprise lead run is archived');
    }

    return run;
  }

  private getCurrentRun(
    workspace: EnterpriseLeadWorkspace,
    runId?: string,
  ): EnterpriseLeadRun | null {
    const currentRunId = runId ?? workspace.recentRunId;
    if (!currentRunId) {
      return null;
    }

    const run = this.store.getRun(currentRunId);
    if (!run) {
      throw new Error('Enterprise lead run not found');
    }
    if (run.workspaceId !== workspace.id) {
      throw new Error('Enterprise lead run does not belong to workspace');
    }

    return run;
  }

  private getTaskContext(taskId: string): {
    workspace: EnterpriseLeadWorkspace;
    task: EnterpriseLeadAgentTask;
    upstreamTasks: EnterpriseLeadAgentTask[];
  } {
    const task = this.store.getTask(taskId);
    if (!task) {
      throw new Error('Enterprise lead Agent task not found');
    }

    const run = this.store.getRun(task.runId);
    if (!run) {
      throw new Error('Enterprise lead workspace not found for task');
    }
    if (run.status === EnterpriseLeadRunStatus.Archived || run.archiveStatus === 'archived') {
      throw new Error('Enterprise lead run is archived');
    }

    const workspace = this.store.getWorkspace(run.workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found for task');
    }

    const tasks = this.store.listTasks(task.runId);
    return {
      workspace,
      task,
      upstreamTasks: getUpstreamTasks(tasks, task),
    };
  }

  private deriveDeliverables(
    workspace: EnterpriseLeadWorkspace,
    run: EnterpriseLeadRun,
    tasks: EnterpriseLeadAgentTask[],
  ): EnterpriseLeadDeliverable[] {
    return tasks
      .filter(task => task.summary.trim())
      .map(task => {
        return {
          id: `task:${task.id}`,
          runId: run.id,
          workspaceId: workspace.id,
          kind: getDeliverableKind(task.role),
          role: task.role,
          title: getTaskTitle(task),
          summary: task.summary,
          payload: task.outputPayload,
          status: 'draft',
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        };
      });
  }

  private deriveTodos(
    workspace: EnterpriseLeadWorkspace,
    run: EnterpriseLeadRun,
    tasks: EnterpriseLeadAgentTask[],
  ): EnterpriseLeadTodo[] {
    return tasks.flatMap(task => task.todos.map((todo, index) => ({
      id: `task:${task.id}:todo:${index}`,
      runId: run.id,
      workspaceId: workspace.id,
      kind: this.sanitizeTodoKind(todo),
      title: todo.title,
      description: todo.description,
      role: this.sanitizeTodoRole(todo, task),
      status: 'open',
      createdAt: task.updatedAt,
      updatedAt: task.updatedAt,
    })));
  }

  private sanitizeTodoKind(todo: EnterpriseLeadTodoInput): EnterpriseLeadTodoKind {
    return isEnterpriseLeadTodoKind(todo.kind)
      ? todo.kind
      : EnterpriseLeadTodoKind.MissingInfo;
  }

  private sanitizeTodoRole(
    todo: EnterpriseLeadTodoInput,
    task: EnterpriseLeadAgentTask,
  ): EnterpriseLeadTaskAgentRole | null {
    if (!todo.role) {
      return null;
    }

    if (isEnterpriseLeadAgentRole(todo.role)) {
      return todo.role;
    }

    if (task.workspaceAgentId || task.agentSnapshot) {
      return todo.role === task.role || todo.role === task.workspaceAgentId
        ? todo.role
        : task.role;
    }

    return task.role;
  }

  private deriveArchives(workspace: EnterpriseLeadWorkspace): EnterpriseLeadArchive[] {
    return this.store.listArchivedRuns(workspace.id).map(run => {
      const tasks = this.store.listTasks(run.id);
      const summaryTask = tasks.find(task =>
        task.role === EnterpriseLeadAgentRole.ProjectSummary ||
        task.role === EnterpriseLeadAgentRole.ProjectArchive,
      ) ?? [...tasks].reverse().find(task => task.summary.trim());

      return {
        id: `run:${run.id}`,
        runId: run.id,
        workspaceId: workspace.id,
        title: run.userGoal,
        summary: run.controllerSummary || summaryTask?.summary || run.userGoal,
        payload: {
          userGoal: run.userGoal,
          controllerSummary: run.controllerSummary,
          tasks: tasks.map(task => ({
            role: task.role,
            status: task.status,
            summary: task.summary,
            outputPayload: task.outputPayload,
            risks: task.risks,
            todos: task.todos,
          })),
        },
        createdAt: run.completedAt || run.updatedAt,
      };
    });
  }

  private mapTaskStatusToRunStatus(status: EnterpriseLeadTaskStatus): EnterpriseLeadRunStatus {
    if (status === EnterpriseLeadTaskStatus.Blocked) {
      return EnterpriseLeadRunStatus.Blocked;
    }
    if (status === EnterpriseLeadTaskStatus.Error) {
      return EnterpriseLeadRunStatus.Error;
    }
    return EnterpriseLeadRunStatus.NeedsInput;
  }

  private assertRunHasNoBlockingRiskReview(runId: string): void {
    const tasks = this.store.listTasks(runId);
    const riskTask = tasks.find(task =>
      task.role === EnterpriseLeadAgentRole.RiskReview ||
      task.role === EnterpriseLeadAgentRole.ContentQuality,
    ) ?? tasks.find(task => this.isDynamicRiskReviewTask(task));
    if (!riskTask) {
      if (tasks.some(task => task.workspaceAgentId || task.agentSnapshot)) {
        this.assertDynamicRunHasNoBlockingRisk(tasks);
        return;
      }
      throw new Error('Enterprise lead risk review must be completed before archive');
    }

    const canArchive = riskTask.outputPayload.canArchive ?? riskTask.handoffContext.canArchive;
    const riskLevel = riskTask.outputPayload.riskLevel;
    const hasHighRisk = riskTask.risks.some(risk => risk.level === EnterpriseLeadRiskLevel.High);
    if (
      riskTask.status === EnterpriseLeadTaskStatus.Blocked ||
      canArchive === false ||
      riskLevel === EnterpriseLeadRiskLevel.High ||
      hasHighRisk
    ) {
      throw new Error('Enterprise lead run has unresolved risk review');
    }
    if (riskTask.status !== EnterpriseLeadTaskStatus.Completed || riskTask.stale) {
      throw new Error('Enterprise lead risk review must be completed before archive');
    }
    if (tasks.some(task => task.workspaceAgentId || task.agentSnapshot)) {
      this.assertDynamicRunHasNoBlockingRisk(tasks);
    }
  }

  private isDynamicRiskReviewTask(task: EnterpriseLeadAgentTask): boolean {
    if (!task.workspaceAgentId && !task.agentSnapshot) {
      return false;
    }
    const text = [
      task.role,
      task.agentSnapshot?.name,
      task.agentSnapshot?.description,
      task.agentSnapshot?.identity,
    ].join(' ').toLowerCase();

    return /risk|review|audit|风险|风控|审核|合规/.test(text);
  }

  private assertDynamicRunHasNoBlockingRisk(tasks: EnterpriseLeadAgentTask[]): void {
    const hasUnfinishedTask = tasks.some(task =>
      task.status !== EnterpriseLeadTaskStatus.Completed || task.stale);
    if (hasUnfinishedTask) {
      throw new Error('Enterprise lead risk review must be completed before archive');
    }

    const hasBlockingRisk = tasks.some(task =>
      task.status === EnterpriseLeadTaskStatus.Blocked ||
      task.outputPayload.canArchive === false ||
      task.handoffContext.canArchive === false ||
      task.outputPayload.riskLevel === EnterpriseLeadRiskLevel.High ||
      task.risks.some(risk => risk.level === EnterpriseLeadRiskLevel.High));

    if (hasBlockingRisk) {
      throw new Error('Enterprise lead run has unresolved risk review');
    }
  }
}
