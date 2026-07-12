import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadContentDeliveryMode,
  EnterpriseLeadContentOutputPlatformId,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadTaskAgentRole,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentCalibrationDraft,
  EnterpriseLeadWorkspaceAgentCalibrationExample,
  EnterpriseLeadWorkspaceContentPlatformConfig,
  EnterpriseLeadWorkspaceContentPlatformSettings,
} from '../../shared/enterpriseLeadWorkspace/types';
import type { WorkflowArtifactRef } from '../../shared/enterpriseLeadWorkspace/workflowContracts';
import {
  AiDialogueReplyLanguage,
  AiDialogueReplySurface,
  buildAiDialogueReplyContract,
} from '../libs/aiDialogueReplyContract';
import type {
  WorkspaceChunkExtractionResult,
  WorkspaceExtractionChunk,
} from './documentExtraction';
import { getEnterpriseLeadAgentMetadata } from './workflow';

interface WorkspaceExtractionPromptInput {
  sourceText: string;
  sourceLabel: string;
}

interface WorkspaceChunkExtractionPromptInput {
  chunk: WorkspaceExtractionChunk;
  sourceLabel: string;
  totalChunks: number;
}

interface WorkspaceChunkMergePromptInput {
  chunkResults: WorkspaceChunkExtractionResult[];
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

const promotionRolePrefix = 'promotion_';

export function buildPromotionTaskOutputSchema(role: EnterpriseLeadTaskAgentRole): Record<string, unknown> {
  switch (role) {
    case EnterpriseLeadAgentRole.PromotionDataScraping:
      return {
        items: [
          {
            sourceKind: 'website | social | search | manual | unknown',
            sourceUrl: 'http(s) source evidence URL',
            title: '标题',
            content: '有证据支持的内容摘录',
            capturedAt: 'ISO timestamp',
            confidence: 'high | medium | low',
          },
        ],
      };
    case EnterpriseLeadAgentRole.PromotionDataCleaning:
      return {
        records: [
          {
            id: '线索 ID',
            companyName: '企业名称',
            industry: '行业',
            contactHint: '公开联系线索；没有时留空',
            fieldConfidence: { companyName: 'high | medium | low' },
          },
        ],
        duplicates: ['重复线索 ID'],
        missingFields: ['缺失字段'],
      };
    case EnterpriseLeadAgentRole.PromotionLeadScoring:
      return {
        leads: [
          {
            id: '线索 ID',
            score: '0-100',
            tier: 'high | medium | low',
            reasons: ['评分依据'],
            missingFields: ['缺失字段'],
            nextAction: '仅供人工执行的下一步建议',
          },
        ],
      };
    case EnterpriseLeadAgentRole.PromotionMultiPlatformAssets:
      return {
        assets: [
          {
            platform: '目标平台',
            title: '草稿标题',
            body: '草稿正文',
            tags: ['标签'],
            callToAction: '草稿 CTA',
            manualReviewRequired: true,
          },
        ],
      };
    case EnterpriseLeadAgentRole.ContentQuality:
      return {
        riskLevel: 'low | medium | high',
        blockingIssues: ['阻断问题'],
        warnings: ['警告'],
        requiredRevisions: ['必须修改项'],
        canArchive: false,
      };
    case EnterpriseLeadAgentRole.PromotionAccountMonitoring:
      return {
        metrics: ['渠道指标对象'],
        anomalies: ['异常对象'],
        hypotheses: ['异常假设'],
        adjustmentActions: ['人工确认后的调整建议'],
      };
    default:
      return {};
  }
}

const toPromptArtifactSummary = (artifact: WorkflowArtifactRef) => ({
  id: artifact.id,
  kind: artifact.kind,
  schemaVersion: artifact.schemaVersion,
  summary: artifact.summary,
  producerTaskId: artifact.producerTaskId,
  evidenceIds: artifact.evidenceIds,
});

const isPromotionTask = (
  task: EnterpriseLeadAgentTask,
  upstreamTasks: EnterpriseLeadAgentTask[],
): boolean =>
  task.role.startsWith(promotionRolePrefix) ||
  (task.role === EnterpriseLeadAgentRole.ContentQuality &&
    upstreamTasks.some(upstream => upstream.role.startsWith(promotionRolePrefix)));

const buildPromotionTaskContext = (
  task: EnterpriseLeadAgentTask,
  upstreamTasks: EnterpriseLeadAgentTask[],
) => ({
  taskId: task.id,
  runId: task.runId,
  role: task.role,
  status: task.status,
  inputArtifacts: (task.artifactRefs ?? []).map(toPromptArtifactSummary),
  artifactSummaries: upstreamTasks.flatMap(upstream =>
    (upstream.artifactRefs ?? []).map(toPromptArtifactSummary),
  ),
});

const toPromotionPromptWorkspace = (workspace: EnterpriseLeadWorkspace) => ({
  id: workspace.id,
  name: workspace.name,
  profile: workspace.profile,
  riskRules: workspace.riskRules,
  research: {
    external: toPromptExternalResearchSettings(workspace),
    domestic: workspace.settings.domesticResearch,
  },
  platforms: toPromptContentPlatformSettings(workspace.settings.contentPlatforms),
  outputPreferences: workspace.settings.outputPreferences,
});

const buildTaskResultSchema = (role: EnterpriseLeadTaskAgentRole, promotion: boolean) => ({
  ...taskResultSchema,
  outputs: promotion ? buildPromotionTaskOutputSchema(role) : taskResultSchema.outputs,
});

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

export function buildWorkspaceChunkExtractionPrompt({
  chunk,
  sourceLabel,
  totalChunks,
}: WorkspaceChunkExtractionPromptInput): string {
  return [
    '你是企业获客工作空间资料抽取助手。',
    '',
    '安全边界：',
    buildSafetySection(),
    '',
    '请只阅读当前资料分块，抽取这个分块中有明确证据支持的局部事实。',
    '不要根据其他分块或常识补全事实。无法确认的信息写入 missingInfo。',
    '只输出结构化 JSON，不要输出 Markdown、解释、前后缀或代码围栏。',
    '',
    '输出 JSON schema：',
    stringify({
      facts: {
        companySummary: ['企业概况事实'],
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
      evidence: [
        {
          field: 'facts 中的字段名',
          value: '事实值',
          chunkId: chunk.chunkId,
          quote: '支持该事实的原文短摘录',
          confidence: 'low | medium | high',
        },
      ],
    }),
    '',
    `资料来源：${sourceLabel}`,
    `资料分块：${chunk.index + 1}/${totalChunks}`,
    `分块 ID：${chunk.chunkId}`,
    '分块正文：',
    chunk.text,
  ].join('\n');
}

export function buildWorkspaceChunkMergePrompt({
  chunkResults,
  sourceLabel,
}: WorkspaceChunkMergePromptInput): string {
  return [
    '你是企业获客工作空间资料合并助手。',
    '',
    '安全边界：',
    buildSafetySection(),
    '',
    '请合并多个资料分块的局部抽取结果，生成一个工作空间草稿。',
    '只合并有分块事实支持的内容，不得编造。',
    '禁用表达和联系规则是硬规则，除非完全重复，否则不要删除。',
    '只输出结构化 JSON，不要输出 Markdown、解释、前后缀或代码围栏。',
    '',
    '输出 JSON schema：',
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
        kind: 'file',
        label: sourceLabel,
        text: '原始资料由系统保存，不要在这里复述全文',
      },
    }),
    '',
    `资料来源：${sourceLabel}`,
    '分块抽取结果：',
    stringify(chunkResults),
  ].join('\n');
}

export function buildAgentTaskPrompt({
  workspace,
  task,
  upstreamTasks,
}: AgentTaskPromptInput): string {
  const metadata = getAgentTaskPromptMetadata(task);
  const promotion = isPromotionTask(task, upstreamTasks);
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
    promotion
      ? '请基于工作空间、输入 Artifact 和 Artifact 摘要生成本 Agent 的结构化 JSON 结果。'
      : '请基于工作空间、当前任务和上游 Agent 结果生成本 Agent 的结构化 JSON 结果。',
    '输出 JSON schema：',
    stringify(buildTaskResultSchema(task.role, promotion)),
    '',
    '工作空间：',
    stringify(promotion ? toPromotionPromptWorkspace(workspace) : toPromptWorkspace(workspace)),
    '',
    ...(promotion
      ? ['任务输入与 Artifact 摘要：', stringify(buildPromotionTaskContext(task, upstreamTasks))]
      : ['当前任务：', stringify(task), '', '上游 Agent 结果：', buildUpstreamSection(upstreamTasks)]),
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
