import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadContentDeliveryMode,
  EnterpriseLeadContentOutputPlatformId,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceChatMessage,
  EnterpriseLeadWorkspaceChatResearchResult,
  EnterpriseLeadWorkspaceContentPlatformConfig,
  EnterpriseLeadWorkspaceContentPlatformSettings,
} from '../../shared/enterpriseLeadWorkspace/types';
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

interface WorkspaceChatPromptBaseInput {
  workspace: EnterpriseLeadWorkspace;
  effectiveAgents: WorkspaceChatAgentPromptSummary[];
  targetAgent?: WorkspaceChatAgentPromptSummary | null;
  recentMessages: EnterpriseLeadWorkspaceChatMessage[];
  userMessage: string;
  recentRunOutputs?: unknown[];
}

type WorkspaceChatResearchIntentPromptInput = WorkspaceChatPromptBaseInput;

interface WorkspaceChatResponsePromptInput extends WorkspaceChatPromptBaseInput {
  researchResult: EnterpriseLeadWorkspaceChatResearchResult;
}

const stringify = (value: unknown): string => JSON.stringify(value, null, 2);

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

const getAgentTaskPromptMetadata = (task: EnterpriseLeadAgentTask): {
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
  stringify(upstreamTasks.map(task => ({
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
  })));

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
      researchIntent: {
        kind: 'none | search | extract | domestic_search | domestic_status',
        query: 'search/extract/domestic_search 可选查询词，最多 500 字',
        urls: ['extract 需要读取的 http/https URL'],
        provider: 'auto | tavily | firecrawl',
        sourceIds: ['domestic_search 可选国内来源 id，例如 bilibili、wechat_official_accounts'],
      },
    }),
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
    }),
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

export function buildWorkspaceChatResponsePrompt({
  workspace,
  effectiveAgents,
  targetAgent,
  recentMessages,
  userMessage,
  recentRunOutputs = [],
  researchResult,
}: WorkspaceChatResponsePromptInput): string {
  return [
    targetAgent
      ? `你是当前工作空间中的 ${targetAgent.name}，请按该 Agent 的职责回答用户。`
      : '你是企业获客工作空间 AI 助手，请基于当前工作空间资料回答用户。',
    '',
    '安全边界：',
    buildChatSafetySection(),
    '- 外部动作只允许只读搜索、读取、摘录、总结或起草；不得发布、评论、私信、发送邮件、建联、下单或修改外部系统。',
    '- 不得编造客户、联系人、认证、价格、交付、产能、案例或成本降低等事实；信息不足时明确说明。',
    '',
    '回答要求：',
    '- 用中文自然回答，不输出 JSON。',
    '- 明确区分“工作空间已有资料”“研究结果”和“建议/推测”。',
    '- 如果研究失败或未配置，说明限制，并继续基于已有工作空间资料给出可执行建议。',
    '- 如涉及外发内容，只能生成草稿或审批建议。',
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
    }),
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
    '研究结果：',
    stringify(researchResult),
    '',
    '用户本轮消息：',
    userMessage,
  ].join('\n');
}
