import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadContentDeliveryMode,
  EnterpriseLeadContentOutputPlatformId,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentCalibrationDraft,
  EnterpriseLeadWorkspaceAgentCalibrationExample,
  EnterpriseLeadWorkspaceChatMessage,
  EnterpriseLeadWorkspaceChatResearchResult,
  EnterpriseLeadWorkspaceChatRouteStep,
  EnterpriseLeadWorkspaceChatRouting,
  EnterpriseLeadWorkspaceContentPlatformConfig,
  EnterpriseLeadWorkspaceContentPlatformSettings,
} from '../../shared/enterpriseLeadWorkspace/types';
import {
  AiDialogueReplyLanguage,
  AiDialogueReplySurface,
  buildAiDialogueReplyContract,
} from '../libs/aiDialogueReplyContract';
import { getEnterpriseLeadAgentMetadata } from './workflow';

interface WorkspaceExtractionPromptInput {
  sourceText: string;
  sourceLabel: string;
}

interface AgentTaskPromptInput {
  workspace: EnterpriseLeadWorkspace;
  task: EnterpriseLeadAgentTask;
  upstreamTasks: EnterpriseLeadAgentTask[];
}

interface AgentChatPromptInput extends AgentTaskPromptInput {
  userMessage: string;
}

export interface WorkspaceChatAgentPromptSummary {
  id: string;
  name: string;
  description: string;
  identity: string;
  systemPrompt: string;
  icon: string;
  model: string;
  skillIds: string[];
}

export interface WorkspaceChatLeadContext {
  status: 'available' | 'empty';
  note: string;
  sources: Array<{
    kind: 'workspace_source' | 'run_output';
    label: string;
    text: string;
  }>;
}

export interface WorkspaceChatIndustryContext {
  status: 'available' | 'empty';
  industryLabel: string;
  confidence: 'high' | 'medium' | 'low';
  note: string;
  evidence: Array<{
    kind: 'workspace_profile' | 'workspace_source' | 'run_output';
    label: string;
    text: string;
  }>;
  missingInfo: string[];
}

export interface WorkspaceChatContentKnowledgeContext {
  status: 'matched' | 'profile_fallback' | 'missing' | 'not_applicable';
  note: string;
  hits: Array<{
    sourceLabel: string;
    sourceType: string;
    text: string;
    score: number;
  }>;
  missingInfo: string[];
  diagnostics?: {
    candidateCount: number;
    rejectedCount: number;
    hitThreshold: number;
  };
}

interface WorkspaceChatPromptBaseInput {
  workspace: EnterpriseLeadWorkspace;
  effectiveAgents: WorkspaceChatAgentPromptSummary[];
  targetAgent?: WorkspaceChatAgentPromptSummary | null;
  routing?: EnterpriseLeadWorkspaceChatRouting | null;
  recentMessages: EnterpriseLeadWorkspaceChatMessage[];
  userMessage: string;
  recentRunOutputs?: unknown[];
  workspaceLeadContext?: WorkspaceChatLeadContext;
  workspaceIndustryContext?: WorkspaceChatIndustryContext;
  workspaceContentKnowledgeContext?: WorkspaceChatContentKnowledgeContext;
}

type WorkspaceChatResearchIntentPromptInput = WorkspaceChatPromptBaseInput;

interface WorkspaceChatResponsePromptInput extends WorkspaceChatPromptBaseInput {
  agentStepResults?: EnterpriseLeadWorkspaceChatRouteStep[];
  researchResult: EnterpriseLeadWorkspaceChatResearchResult;
}

interface WorkspaceChatAgentStepPromptInput extends WorkspaceChatPromptBaseInput {
  currentAgent: WorkspaceChatAgentPromptSummary;
  previousStepResults: EnterpriseLeadWorkspaceChatRouteStep[];
  researchResult: EnterpriseLeadWorkspaceChatResearchResult;
}

interface WorkspaceAgentCalibrationPromptInput {
  workspace: EnterpriseLeadWorkspace;
  agent: EnterpriseLeadWorkspaceAgentCalibrationDraft;
  example: EnterpriseLeadWorkspaceAgentCalibrationExample;
}

const stringify = (value: unknown): string => JSON.stringify(value, null, 2);

const buildEnterpriseLeadReplyContract = (): string =>
  buildAiDialogueReplyContract({
    surface: AiDialogueReplySurface.EnterpriseLead,
    language: AiDialogueReplyLanguage.Zh,
  });

const buildContentProductionOutputSection = (): string => [
  '内容生产交付规范：',
  '- 优先输出可直接复制使用的成品，不要只给思路或建议。',
  '- 信息不足时先给可用草稿，并用「[待补充：...]」标出缺口；不要只反问用户。',
  '- B2B/获客内容必须围绕目标客户场景、痛点、证据、信任背书和清晰 CTA。',
  '- 选题类输出标题/角度/目标人群/痛点/钩子/转化点，避免只有标题列表。',
  '- 短视频脚本输出前三秒钩子、口播台词、画面或分镜节奏、字幕提示和 CTA。',
  '- 图文文案输出标题备选、正文、配图或封面建议、评论/私信引导和发布提醒。',
  '- 私域或销售转化输出破冰句、价值承接、需求确认、异议回应、下一步动作和跟进节奏。',
  '- 内容质检输出问题清单、修改理由、优化版本和发布前提醒；重点去空泛、去 AI 味、去夸张承诺。',
].join('\n');

const emptyWorkspaceLeadContext = (): WorkspaceChatLeadContext => ({
  status: 'empty',
  note: '没有检测到可用于客户排序的具体客户名单或线索。',
  sources: [],
});

const emptyWorkspaceIndustryContext = (): WorkspaceChatIndustryContext => ({
  status: 'empty',
  industryLabel: '',
  confidence: 'low',
  note: '没有检测到足够的工作区行业证据。',
  evidence: [],
  missingInfo: [],
});

const emptyWorkspaceContentKnowledgeContext = (): WorkspaceChatContentKnowledgeContext => ({
  status: 'not_applicable',
  note: '本轮不是选题、脚本、私域话术或销售转化类内容生产请求，未触发向量知识预检。',
  hits: [],
  missingInfo: [],
});

const buildIndustryAnalysisInstructionSection = (
  workspaceIndustryContext?: WorkspaceChatIndustryContext,
): string => {
  if (!workspaceIndustryContext || workspaceIndustryContext.status !== 'available') {
    return '';
  }

  return [
    '行业态势分析要求：',
    '- 工作区行业证据包已识别当前行业时，不要追问用户属于什么行业；先按证据包识别的行业输出。',
    '- 必须基于证据包、工作空间资料和研究结果分析；没有证据的判断标记为“待验证”。',
    '- 固定结构：一句话判断、行业现状、客户采购逻辑、竞争格局、对本公司的影响、获客机会、风险与不确定性、下一步动作。',
  ].join('\n');
};

const buildWorkspaceContentKnowledgeInstructionSection = (
  workspaceContentKnowledgeContext?: WorkspaceChatContentKnowledgeContext,
): string => {
  if (!workspaceContentKnowledgeContext) {
    return '';
  }
  if (workspaceContentKnowledgeContext.status === 'matched') {
    return [
      '工作区向量知识使用要求：',
      '- 本轮内容生产请求已命中工作区向量知识；优先使用“工作区向量知识命中包”中的片段作为事实依据。',
      '- 只能把命中片段、工作空间资料或研究结果中出现的信息当成事实；不能把未命中的资料当成事实。',
      '- 可以基于命中事实做选题、脚本、私域话术和销售转化表达，但产品、客户、卖点、案例、价格、承诺必须有依据。',
      '- 如果命中包或当前工作空间资料已经包含工厂、产品、客户或卖点信息，不要说“没有存过你们工厂的具体资料”，不要重复询问已经出现在命中包里的产品、客户或卖点。',
      '- 面对朋友圈文案、图文文案、短视频脚本、选题或私域话术这类短内容请求，先输出一版可直接使用的成品草稿；需要补充的信息放在草稿后，用 1-2 个问题追问。',
    ].join('\n');
  }
  if (workspaceContentKnowledgeContext.status === 'profile_fallback') {
    return [
      '工作区向量知识使用要求：',
      '- 本轮内容生产请求没有命中足够相关的向量片段，但工作区基础画像可用；请基于当前工作空间资料先输出一版可直接使用的草稿。',
      '- 缺失的产品细节、客户行业、案例、数据、价格、认证或交付承诺用「[待补充：...]」标注，不要虚构。',
      '- 不要只追问用户；草稿后最多补 1-2 个最关键问题，帮助用户继续完善。',
      '- 如果当前工作空间资料已经包含工厂、产品、客户或卖点信息，不要说“没有存过你们工厂的具体资料”，不要重复询问已经出现的产品、客户或卖点。',
    ].join('\n');
  }
  if (workspaceContentKnowledgeContext.status === 'missing') {
    return [
      '工作区向量知识使用要求：',
      '- 本轮是内容生产请求，但工作区向量知识没有足够相关命中；这条规则优先级高于“内容生产交付规范”。',
      '- 不要直接生成选题、脚本、私域话术或销售转化内容，不要用行业常识或猜测补齐业务事实。',
      '- 先说明缺少哪些业务信息，并给出最小补充清单：领域/产品、目标人群、核心卖点、转化目标、账号定位、可引用素材或证据。',
    ].join('\n');
  }
  return '';
};

const isEnterpriseLeadAgentRole = (value: string): value is EnterpriseLeadAgentRole =>
  Object.values(EnterpriseLeadAgentRole).includes(value as EnterpriseLeadAgentRole);

const hasText = (value: string): boolean => value.trim().length > 0;

const isPromptContentPlatformConfigured = (
  platform: EnterpriseLeadWorkspaceContentPlatformConfig,
): boolean => {
  if (!platform.enabled) {
    return false;
  }

  if (platform.id === EnterpriseLeadContentOutputPlatformId.XiaohongshuDraft) {
    if (
      platform.deliveryMode === EnterpriseLeadContentDeliveryMode.DraftOnly ||
      platform.deliveryMode === EnterpriseLeadContentDeliveryMode.MarkdownExport
    ) {
      return true;
    }
    return hasText(platform.endpoint) && hasText(platform.token);
  }

  if (platform.id === EnterpriseLeadContentOutputPlatformId.SalesMessage) {
    if (platform.deliveryMode === EnterpriseLeadContentDeliveryMode.SmsTemplate) {
      return true;
    }
    return hasText(platform.endpoint);
  }

  if (platform.id === EnterpriseLeadContentOutputPlatformId.WechatArticle) {
    if (platform.deliveryMode === EnterpriseLeadContentDeliveryMode.MarkdownExport) {
      return true;
    }
    return hasText(platform.appId) && hasText(platform.token);
  }

  if (platform.id === EnterpriseLeadContentOutputPlatformId.CustomWebhook) {
    return hasText(platform.endpoint);
  }

  return hasText(platform.endpoint) || hasText(platform.token);
};

const toPromptContentPlatformSettings = (
  settings: EnterpriseLeadWorkspaceContentPlatformSettings,
) => ({
  platforms: Object.fromEntries(
    Object.entries(settings.platforms).map(([platformId, platform]) => [
      platformId,
      {
        id: platform.id,
        enabled: platform.enabled,
        deliveryMode: platform.deliveryMode,
        account: platform.account,
        payloadFormat: platform.payloadFormat,
        configured: isPromptContentPlatformConfigured(platform),
      },
    ]),
  ),
  outputRules: settings.outputRules,
});

const toPromptExternalResearchSettings = (workspace: EnterpriseLeadWorkspace) => ({
  mode: workspace.settings.externalResearch.mode,
  providers: Object.fromEntries(
    Object.entries(workspace.settings.externalResearch.providers).map(([providerId, provider]) => [
      providerId,
      {
        enabled: provider.enabled,
        configured: provider.apiKey.trim().length > 0,
      },
    ]),
  ),
});

const buildWorkspaceOutputPreferenceSection = (workspace: EnterpriseLeadWorkspace): string => {
  const instructions = workspace.settings.outputPreferences?.instructions ?? [];
  if (!instructions.length) {
    return '';
  }

  return [
    '空间输出习惯：',
    ...instructions.map(instruction => `- ${instruction}`),
  ].join('\n');
};

const getAgentTaskPromptMetadata = (
  task: EnterpriseLeadAgentTask,
): {
  title: string;
  description: string;
  inputSummary: string;
  outputSummary: string;
  identity: string;
  systemPrompt: string;
} => {
  if (task.agentSnapshot) {
    return {
      title: task.agentSnapshot.name || task.role,
      description: task.agentSnapshot.description || '当前工作空间配置的 Agent。',
      inputSummary: '工作空间资料、用户目标、上游 Agent 结果、本 Agent 的空间内配置',
      outputSummary: '符合本 Agent 职责的结构化获客任务结果、风险、待办和交接上下文',
      identity: task.agentSnapshot.identity,
      systemPrompt: task.agentSnapshot.systemPrompt,
    };
  }

  if (isEnterpriseLeadAgentRole(task.role)) {
    const metadata = getEnterpriseLeadAgentMetadata(task.role);
    return {
      title: metadata.title,
      description: metadata.description,
      inputSummary: metadata.inputSummary,
      outputSummary: metadata.outputSummary,
      identity: '',
      systemPrompt: '',
    };
  }

  return {
    title: task.role,
    description: '当前工作空间配置的 Agent。',
    inputSummary: '工作空间资料、用户目标、上游 Agent 结果',
    outputSummary: '结构化获客任务结果、风险、待办和交接上下文',
    identity: '',
    systemPrompt: '',
  };
};

const toPromptWorkspace = (workspace: EnterpriseLeadWorkspace) => ({
  id: workspace.id,
  name: workspace.name,
  type: workspace.type,
  profile: workspace.profile,
  extractionSources: workspace.extractionSources,
  riskRules: workspace.riskRules,
  enabledAgentRoles: workspace.enabledAgentRoles,
  workspaceAgents: workspace.workspaceAgents.map(binding => ({
    agentId: binding.agentId,
    enabled: binding.enabled,
    order: binding.order,
    name: binding.overrides.name ?? binding.name,
    description: binding.overrides.description ?? binding.description,
    identity: binding.overrides.identity ?? binding.identity,
    systemPrompt: binding.overrides.systemPrompt ?? binding.systemPrompt,
    icon: binding.overrides.icon ?? binding.icon,
    model: binding.overrides.model ?? binding.model,
    skillIds: binding.overrides.skillIds ?? binding.skillIds ?? [],
  })),
  settings: {
    skillIds: workspace.settings.skillIds,
    model: {
      defaultModel: workspace.settings.model.defaultModel,
      defaultModelProvider: workspace.settings.model.defaultModelProvider,
    },
    externalResearch: {
      ...toPromptExternalResearchSettings(workspace),
    },
    domesticResearch: workspace.settings.domesticResearch,
    contentPlatforms: toPromptContentPlatformSettings(workspace.settings.contentPlatforms),
    outputPreferences: workspace.settings.outputPreferences,
  },
  recentRunId: workspace.recentRunId,
  createdAt: workspace.createdAt,
  updatedAt: workspace.updatedAt,
});

const safetyBoundaries = [
  '只输出结构化 JSON，不要输出 Markdown、解释、前后缀或代码围栏。',
  '不得执行任何外部动作，不得真实发布、评论、私信、发送邮件、下单、联系客户或修改外部系统。',
  '发布、评论、私信、邮件只能作为草稿、待办或需用户审批的建议输出。',
  '不得编造客户、联系人、来源、认证、价格、交付、产能、案例、成本降低等事实。',
  '信息不足时写入 missingInfo、todos 或 risks，不要用猜测补齐。',
];

const taskResultSchema = {
  role: 'Agent role from the task',
  status: 'completed | needs_input | blocked',
  summary: 'Brief Chinese summary',
  outputs: {},
  missingInfo: ['Missing facts that block confidence'],
  todos: [
    {
      kind: 'missing_info | confirm_expression | manual_publish | manual_comment | manual_direct_message | manual_email | review_risk | confirm_source',
      title: 'Todo title',
      description: 'Todo description',
      role: 'Agent role',
    },
  ],
  risks: [
    {
      level: 'low | medium | high',
      title: 'Risk title',
      description: 'Risk description',
      role: 'Agent role',
    },
  ],
  handoffContext: {},
};

const buildSafetySection = (): string => safetyBoundaries.map(item => `- ${item}`).join('\n');

const buildChatSafetySection = (): string =>
  safetyBoundaries
    .filter(item => !item.includes('只输出结构化 JSON'))
    .map(item => `- ${item}`)
    .join('\n');

const buildUpstreamSection = (upstreamTasks: EnterpriseLeadAgentTask[]): string =>
  stringify(
    upstreamTasks.map(task => ({
      role: task.role,
      agentName: task.agentSnapshot?.name,
      workspaceAgentId: task.workspaceAgentId,
      status: task.status,
      summary: task.summary,
      outputPayload: task.outputPayload,
      missingInfo: task.missingInfo,
      todos: task.todos,
      risks: task.risks,
      handoffContext: task.handoffContext,
    })),
  );

export function buildWorkspaceExtractionPrompt({
  sourceText,
  sourceLabel,
}: WorkspaceExtractionPromptInput): string {
  return [
    '你是企业获客工作空间资料抽取助手。',
    '',
    '安全边界：',
    buildSafetySection(),
    '',
    '请从用户提供的资料中抽取工作空间草稿，只输出结构化 JSON，字段如下：',
    stringify({
      name: '工作空间名称',
      type: 'enterprise_lead',
      profile: {
        companySummary: '企业概况',
        productList: ['产品'],
        productCapabilities: ['能力'],
        targetCustomers: ['目标客户'],
        applicationScenarios: ['应用场景'],
        sellingPoints: ['卖点'],
        channelPreferences: ['渠道偏好'],
        prohibitedClaims: ['禁用表达'],
        contactRules: ['联系规则'],
        missingInfo: ['缺失信息'],
      },
      source: {
        kind: 'conversation',
        label: sourceLabel,
        text: '原始输入文本',
      },
    }),
    '',
    `资料来源：${sourceLabel}`,
    '资料正文：',
    sourceText,
  ].join('\n');
}

export function buildAgentTaskPrompt({
  workspace,
  task,
  upstreamTasks,
}: AgentTaskPromptInput): string {
  const metadata = getAgentTaskPromptMetadata(task);
  const agentConfigLines = [
    metadata.identity ? `Agent 身份：${metadata.identity}` : '',
    metadata.systemPrompt ? `Agent 系统提示词：${metadata.systemPrompt}` : '',
  ].filter(Boolean);

  return [
    `你是 ${metadata.title}。`,
    metadata.description,
    ...agentConfigLines,
    `输入重点：${metadata.inputSummary}`,
    `输出重点：${metadata.outputSummary}`,
    '',
    '安全边界：',
    buildSafetySection(),
    '',
    '请基于工作空间、当前任务和上游 Agent 结果生成本 Agent 的结构化 JSON 结果。',
    '输出 JSON schema：',
    stringify(taskResultSchema),
    '',
    '工作空间：',
    stringify(toPromptWorkspace(workspace)),
    '',
    '当前任务：',
    stringify(task),
    '',
    '上游 Agent 结果：',
    buildUpstreamSection(upstreamTasks),
  ].join('\n');
}

export function buildAgentChatPrompt({
  workspace,
  task,
  upstreamTasks,
  userMessage,
}: AgentChatPromptInput): string {
  const metadata = getAgentTaskPromptMetadata(task);
  const agentConfigLines = [
    metadata.identity ? `Agent 身份：${metadata.identity}` : '',
    metadata.systemPrompt ? `Agent 系统提示词：${metadata.systemPrompt}` : '',
  ].filter(Boolean);

  return [
    `你是 ${metadata.title}，正在根据用户反馈生成一个待确认的新版本。`,
    metadata.description,
    ...agentConfigLines,
    '',
    '安全边界：',
    buildSafetySection(),
    '',
    '请只输出结构化 JSON，格式与 Agent 任务结果一致。不要直接修改外部系统。',
    '输出 JSON schema：',
    stringify(taskResultSchema),
    '',
    '用户反馈：',
    userMessage,
    '',
    '工作空间：',
    stringify(toPromptWorkspace(workspace)),
    '',
    '当前任务：',
    stringify(task),
    '',
    '上游 Agent 结果：',
    buildUpstreamSection(upstreamTasks),
  ].join('\n');
}

export function buildWorkspaceChatResearchIntentPrompt({
  workspace,
  effectiveAgents,
  targetAgent,
  recentMessages,
  userMessage,
  recentRunOutputs = [],
  workspaceLeadContext,
  workspaceIndustryContext,
  workspaceContentKnowledgeContext,
}: WorkspaceChatResearchIntentPromptInput): string {
  return [
    '你是企业获客工作空间的研究意图判断助手。',
    '',
    '安全边界：',
    buildSafetySection(),
    '',
    '判断是否需要只读研究能力来回答用户。外部动作只允许搜索、读取、摘录、总结或起草，不得发布、评论、私信、发送邮件或修改外部系统。',
    '只输出 JSON，schema 如下：',
    stringify({
      targetAgentId:
        '自动模式下选择的当前工作空间 Agent id；没有明确匹配时为空字符串。手动指定目标 Agent 时必须回填该 id。',
      researchIntent: {
        kind: 'none | search | extract | domestic_search | domestic_status',
        query: 'search/extract/domestic_search 可选查询词，最多 500 字',
        urls: ['extract 需要读取的 http/https URL'],
        provider: 'auto | tavily | firecrawl',
        sourceIds: ['domestic_search 可选国内来源 id，例如 bilibili、wechat_official_accounts'],
      },
    }),
    '',
    'Agent 使用规则：',
    targetAgent
      ? `- 用户已手动指定目标 Agent：${targetAgent.id} / ${targetAgent.name}。targetAgentId 必须返回这个 id。`
      : '- 当前处于自动模式：必须从“当前工作空间内 Agents”中判断是否有已启用 Agent 明确匹配用户任务。',
    '- 如果某个 Agent 已经配置且明确匹配，返回它的 id，让系统直接使用；不要建议用户去使用或切换 Agent。',
    '- 如果没有明确匹配，targetAgentId 返回空字符串，并由通用助手回答。',
    '',
    '当前工作空间资料：',
    stringify({
      id: workspace.id,
      name: workspace.name,
      profile: workspace.profile,
      extractionSources: workspace.extractionSources,
      riskRules: workspace.riskRules,
      enabledAgentRoles: workspace.enabledAgentRoles,
      workspaceSkillIds: workspace.settings.skillIds,
      externalResearch: toPromptExternalResearchSettings(workspace),
      domesticResearch: workspace.settings.domesticResearch,
      contentPlatforms: toPromptContentPlatformSettings(workspace.settings.contentPlatforms),
      outputPreferences: workspace.settings.outputPreferences,
    }),
    '',
    '工作区可用线索：',
    stringify(workspaceLeadContext ?? emptyWorkspaceLeadContext()),
    '',
    '工作区行业证据包：',
    stringify(workspaceIndustryContext ?? emptyWorkspaceIndustryContext()),
    '',
    '工作区向量知识命中包：',
    stringify(workspaceContentKnowledgeContext ?? emptyWorkspaceContentKnowledgeContext()),
    '',
    '当前工作空间内 Agents：',
    stringify(effectiveAgents),
    '',
    '目标 Agent：',
    stringify(targetAgent ?? null),
    '',
    '最近对话：',
    stringify(recentMessages),
    '',
    '最近运行输出：',
    stringify(recentRunOutputs),
    '',
    '用户本轮消息：',
    userMessage,
  ].join('\n');
}

export function buildWorkspaceChatAgentStepPrompt({
  workspace,
  effectiveAgents,
  targetAgent,
  routing,
  currentAgent,
  previousStepResults,
  recentMessages,
  userMessage,
  recentRunOutputs = [],
  researchResult,
  workspaceLeadContext,
  workspaceIndustryContext,
  workspaceContentKnowledgeContext,
}: WorkspaceChatAgentStepPromptInput): string {
  return [
    `当前执行 Agent：${currentAgent.name}`,
    currentAgent.description || '当前工作空间中的专业 Agent。',
    currentAgent.identity ? `Agent 身份：${currentAgent.identity}` : '',
    currentAgent.systemPrompt ? `Agent 系统提示词：${currentAgent.systemPrompt}` : '',
    '',
    '安全边界：',
    buildChatSafetySection(),
    '- 只生成本 Agent 的中间贡献，不要声称已经完成其他 Agent 的职责。',
    '- 不得发布、评论、私信、发送邮件、建联、下单或修改外部系统。',
    '- 不得编造客户、联系人、认证、价格、交付、产能、案例或成本降低等事实。',
    '',
    '回复质量规则：',
    buildEnterpriseLeadReplyContract(),
    buildContentProductionOutputSection(),
    buildWorkspaceOutputPreferenceSection(workspace),
    buildIndustryAnalysisInstructionSection(workspaceIndustryContext),
    buildWorkspaceContentKnowledgeInstructionSection(workspaceContentKnowledgeContext),
    '',
    '输出要求：',
    '- 用中文输出。',
    '- 只输出本 Agent 的中间结果，不要输出最终汇总标题。',
    '- 如果前序 Agent 输出存在问题，可以指出并修正。',
    '',
    '工作空间资料：',
    stringify({
      id: workspace.id,
      name: workspace.name,
      profile: workspace.profile,
      extractionSources: workspace.extractionSources,
      riskRules: workspace.riskRules,
      enabledAgentRoles: workspace.enabledAgentRoles,
      workspaceSkillIds: workspace.settings.skillIds,
      externalResearch: toPromptExternalResearchSettings(workspace),
      domesticResearch: workspace.settings.domesticResearch,
      contentPlatforms: toPromptContentPlatformSettings(workspace.settings.contentPlatforms),
      outputPreferences: workspace.settings.outputPreferences,
    }),
    '',
    '工作区可用线索：',
    stringify(workspaceLeadContext ?? emptyWorkspaceLeadContext()),
    '',
    '工作区行业证据包：',
    stringify(workspaceIndustryContext ?? emptyWorkspaceIndustryContext()),
    '',
    '工作区向量知识命中包：',
    stringify(workspaceContentKnowledgeContext ?? emptyWorkspaceContentKnowledgeContext()),
    '',
    '当前工作空间内 Agents：',
    stringify(effectiveAgents),
    '',
    '目标 Agent：',
    stringify(targetAgent ?? null),
    '',
    '参与 Agent 链路：',
    stringify(routing ?? null),
    '',
    '前序 Agent 中间结果：',
    stringify(previousStepResults),
    '',
    '最近对话：',
    stringify(recentMessages),
    '',
    '最近运行输出：',
    stringify(recentRunOutputs),
    '',
    '研究结果：',
    stringify(researchResult),
    '',
    '用户本轮消息：',
    userMessage,
  ]
    .filter(line => line !== '')
    .join('\n');
}

export function buildWorkspaceChatResponsePrompt({
  workspace,
  effectiveAgents,
  targetAgent,
  routing,
  agentStepResults = [],
  recentMessages,
  userMessage,
  recentRunOutputs = [],
  researchResult,
  workspaceLeadContext,
  workspaceIndustryContext,
  workspaceContentKnowledgeContext,
}: WorkspaceChatResponsePromptInput): string {
  return [
    targetAgent
      ? `你是当前工作空间中的 ${targetAgent.name}，请按该 Agent 的职责回答用户。`
      : '你是企业获客工作空间 AI 助手，当前处于 Agent 自动模式，请基于当前工作空间资料回答用户。',
    '',
    '安全边界：',
    buildChatSafetySection(),
    '- 外部动作只允许只读搜索、读取、摘录、总结或起草；不得发布、评论、私信、发送邮件、建联、下单或修改外部系统。',
    '- 不得编造客户、联系人、认证、价格、交付、产能、案例或成本降低等事实；信息不足时明确说明。',
    '',
    '回复质量规则：',
    buildEnterpriseLeadReplyContract(),
    buildContentProductionOutputSection(),
    buildWorkspaceOutputPreferenceSection(workspace),
    buildIndustryAnalysisInstructionSection(workspaceIndustryContext),
    buildWorkspaceContentKnowledgeInstructionSection(workspaceContentKnowledgeContext),
    '',
    '回答要求：',
    '- 用中文自然回答，不输出 JSON。',
    '- 明确区分“工作空间已有资料”“研究结果”和“建议/推测”。',
    '- 如果研究失败或未配置，说明限制，并继续基于已有工作空间资料给出可执行建议。',
    '- 涉及客户线索、商机评分或跟进优先级时，不得输出“模拟客户”“模拟线索”或虚构客户名单。',
    '- 只能基于工作区可用线索或研究结果中的真实公司、真实页面、真实公开信号做排序；证据不足时不要把客户类别包装成具体客户。',
    '- 如果研究结果只包含行业类别、关键词或泛化方向，必须明确说明“未拿到具体公司名单”，然后输出可跟进客户类型、继续调研建议和需要用户补充的信息。',
    '- 如果本轮已经执行过研究（研究结果 status 为 completed/failed），不要再询问用户是否需要授权搜索；直接基于结果给出结论、缺口和下一步。',
    '- 没有真实公司名单时，不要用客户类型优先级表代替客户名单排序；客户类型只能作为开发方向或下一步调研方向。',
    '- 如涉及外发内容，只能生成草稿或审批建议。',
    targetAgent
      ? '- 当前已经选中目标 Agent，请直接按这个 Agent 的职责完成，不再让用户手动切换。'
      : '- 自动模式下，如果当前工作空间内某个 Agent 明确匹配，请自行代入该 Agent 的职责完成；不要建议用户去使用或切换 Agent。',
    routing?.agents.length && routing.agents.length > 1
      ? '- 当前有参与 Agent 链路，请按链路顺序综合多个 Agent 的职责，输出一份完整结果。'
      : '',
    '',
    '当前工作空间资料：',
    stringify({
      id: workspace.id,
      name: workspace.name,
      profile: workspace.profile,
      extractionSources: workspace.extractionSources,
      riskRules: workspace.riskRules,
      enabledAgentRoles: workspace.enabledAgentRoles,
      workspaceSkillIds: workspace.settings.skillIds,
      externalResearch: toPromptExternalResearchSettings(workspace),
      domesticResearch: workspace.settings.domesticResearch,
      contentPlatforms: toPromptContentPlatformSettings(workspace.settings.contentPlatforms),
      outputPreferences: workspace.settings.outputPreferences,
    }),
    '',
    '工作区可用线索：',
    stringify(workspaceLeadContext ?? emptyWorkspaceLeadContext()),
    '',
    '工作区行业证据包：',
    stringify(workspaceIndustryContext ?? emptyWorkspaceIndustryContext()),
    '',
    '工作区向量知识命中包：',
    stringify(workspaceContentKnowledgeContext ?? emptyWorkspaceContentKnowledgeContext()),
    '',
    '当前工作空间内 Agents：',
    stringify(effectiveAgents),
    '',
    '目标 Agent：',
    stringify(targetAgent ?? null),
    '',
    '参与 Agent 链路：',
    stringify(routing ?? null),
    '',
    '多 Agent 中间结果：',
    stringify(agentStepResults),
    '',
    '最近对话：',
    stringify(recentMessages),
    '',
    '最近运行输出：',
    stringify(recentRunOutputs),
    '',
    '研究结果：',
    stringify(researchResult),
    '',
    '用户本轮消息：',
    userMessage,
  ].join('\n');
}

export function buildWorkspaceAgentCalibrationPrompt({
  workspace,
  agent,
  example,
}: WorkspaceAgentCalibrationPromptInput): string {
  return [
    '你正在试运行一个企业获客工作空间 Agent 草稿。',
    '这次试运行只用于校验当前编辑内容，不得修改外部系统，不得写入真实任务，不得声称已经联系客户。',
    '',
    '安全边界：',
    buildChatSafetySection(),
    '- 不得编造客户、联系人、认证、价格、交付、产能、案例或成本降低等事实。',
    '- 信息不足时必须明确列出缺失信息，不得自行补全关键事实。',
    '',
    '回复质量规则：',
    buildEnterpriseLeadReplyContract(),
    '',
    '输出要求：',
    '- 用中文自然回答，不输出 JSON。',
    '- 必须按固定结构输出：客户优先级、判断依据、缺失信息、下一步动作。',
    '- 如果示例涉及报价、交期、承诺、外发内容或合作结果，必须提示人工确认。',
    '',
    '当前 Agent 草稿：',
    stringify(agent),
    '',
    '当前工作空间资料：',
    stringify(toPromptWorkspace(workspace)),
    '',
    '示例输入：',
    example.sampleInput,
    '',
    '期望输出参考：',
    stringify({
      priority: example.expectedPriority,
      reason: example.expectedReason,
      missing: example.expectedMissing,
      nextStep: example.expectedNextStep,
    }),
    '',
    '请直接输出这个 Agent 面对“示例输入”时应该交付给用户的回答。',
  ].join('\n');
}
