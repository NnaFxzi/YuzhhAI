import { VIDEO_GENERATION_HANDOFF_PROMPT } from '../../shared/contentProduction/videoGenerationHandoff';
import { PROMOTION_DEPARTMENT_AGENT_ROLES } from '../../shared/enterpriseLeadWorkspace/agentOrganization';
import type { EnterpriseLeadAgentRole } from '../../shared/enterpriseLeadWorkspace/constants';
import {
  EnterpriseLeadAgentRole as AgentRole,
  EnterpriseLeadContentAgentRoles,
  EnterpriseLeadWorkspaceAgentSource,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type { EnterpriseLeadWorkspaceAgentBinding } from '../../shared/enterpriseLeadWorkspace/types';

export const PROMOTION_WORKFLOW_VERSION = 'promotion-v1';

export interface EnterpriseLeadAgentMetadata {
  role: EnterpriseLeadAgentRole;
  title: string;
  shortLabel: string;
  description: string;
  inputSummary: string;
  outputSummary: string;
  safetyCritical: boolean;
}

export const ENTERPRISE_LEAD_AGENT_WORKFLOW: EnterpriseLeadAgentMetadata[] = [
  {
    role: AgentRole.ProductSellingPoint,
    title: '产品卖点 Agent',
    shortLabel: '卖',
    description: '提炼产品优势、用户痛点、信任背书和差异化卖点。',
    inputSummary: '企业资料、产品资料、目标用户、已有内容素材',
    outputSummary: '核心卖点、用户痛点、信任背书、内容角度',
    safetyCritical: false,
  },
  {
    role: AgentRole.TopicPlanning,
    title: '选题策划 Agent',
    shortLabel: '题',
    description: '生成选题、标题、爆点、内容系列和平台角度。',
    inputSummary: '产品卖点、目标用户、平台偏好、内容目标',
    outputSummary: '选题列表、标题方向、内容系列、推荐形式',
    safetyCritical: false,
  },
  {
    role: AgentRole.ShortVideoScript,
    title: '短视频脚本 Agent',
    shortLabel: '视',
    description: '生成短视频钩子、口播脚本、分镜节奏和行动引导。',
    inputSummary: '产品卖点、选题角度、平台偏好、目标时长',
    outputSummary: '前三秒钩子、口播脚本、分镜建议、CTA',
    safetyCritical: false,
  },
  {
    role: AgentRole.SocialCopy,
    title: '图文文案 Agent',
    shortLabel: '文',
    description: '生成朋友圈、小红书、公众号、海报和种草文案。',
    inputSummary: '产品卖点、平台、目标用户、转化目标',
    outputSummary: '平台文案、标题、正文、行动引导',
    safetyCritical: false,
  },
  {
    role: AgentRole.PrivateDomainConversion,
    title: '私域转化 Agent',
    shortLabel: '私',
    description: '生成微信私聊、社群跟进、异议处理和成交引导话术。',
    inputSummary: '内容成果、客户阶段、常见顾虑、跟进目标',
    outputSummary: '私聊话术、社群话术、跟进节奏、转化 CTA',
    safetyCritical: false,
  },
  {
    role: AgentRole.ContentQuality,
    title: '内容质检 Agent',
    shortLabel: '检',
    description: '检查内容是否空泛、像 AI、缺少依据或缺少转化点，并给出改稿。',
    inputSummary: '内容草稿、平台要求、品牌语气、禁用表达',
    outputSummary: '质检结论、问题清单、优化版本、发布提醒',
    safetyCritical: true,
  },
];

export const PROMOTION_DEPARTMENT_AGENT_WORKFLOW: EnterpriseLeadAgentMetadata[] = [
  {
    role: AgentRole.PromotionController,
    title: '推广总控 Agent',
    shortLabel: '总',
    description: '理解推广目标、拆解任务、调度数据、商机、物料和监控 Agent，并汇总进度。',
    inputSummary: '用户目标、推广阶段、工作空间资料、历史结果、人工约束',
    outputSummary: '推广计划、任务分派、阶段状态、风险与待确认事项',
    safetyCritical: true,
  },
  {
    role: AgentRole.PromotionDataScraping,
    title: '数据抓取 Agent',
    shortLabel: '抓',
    description: '抓取客户、竞品、平台内容、行业线索和公开资料，并保留来源。',
    inputSummary: '目标行业、关键词、平台范围、竞品名单、抓取限制',
    outputSummary: '原始线索、来源链接、抓取时间、可信度、待清洗字段',
    safetyCritical: true,
  },
  {
    role: AgentRole.PromotionDataCleaning,
    title: '数据清洗 Agent',
    shortLabel: '洗',
    description: '去重、补全和标准化抓取结果，形成可交给商机分析的结构化数据。',
    inputSummary: '原始线索、来源链接、字段规则、重复判断标准、人工标注',
    outputSummary: '清洗数据集、重复项、字段缺口、可信度标记、清洗日志',
    safetyCritical: true,
  },
  {
    role: AgentRole.PromotionCompetitorInsight,
    title: '竞品洞察 Agent',
    shortLabel: '竞',
    description: '分析竞品渠道、内容、关键词、卖点和活动节奏，找出推广机会。',
    inputSummary: '清洗数据、竞品名单、平台内容、关键词、行业资料',
    outputSummary: '竞品机会、关键词、内容差距、可借鉴做法、风险提醒',
    safetyCritical: false,
  },
  {
    role: AgentRole.PromotionLeadScoring,
    title: '商机评分 Agent',
    shortLabel: '商',
    description: '评估客户意向、匹配度、紧急程度和跟进价值，输出优先级。',
    inputSummary: '清洗客户数据、意图信号、ICP 条件、预算线索、历史互动',
    outputSummary: '商机评分、分层优先级、判断依据、缺失信息、跟进建议',
    safetyCritical: false,
  },
  {
    role: AgentRole.ProductSellingPoint,
    title: '产品卖点 Agent',
    shortLabel: '卖',
    description: '提炼产品优势、用户痛点、信任背书和差异化卖点。',
    inputSummary: '企业资料、产品资料、目标用户、已有内容素材',
    outputSummary: '核心卖点、用户痛点、信任背书、内容角度',
    safetyCritical: false,
  },
  {
    role: AgentRole.PromotionMultiPlatformAssets,
    title: '多平台物料 Agent',
    shortLabel: '料',
    description: '按平台配置生成图文、短视频、广告、私域和落地页物料包。',
    inputSummary: '卖点、商机分层、平台配置、可用素材、转化目标、禁用表达',
    outputSummary: '平台物料包、标题、正文、脚本、标签、CTA、需确认表达',
    safetyCritical: false,
  },
  {
    role: AgentRole.ContentQuality,
    title: '内容质检 Agent',
    shortLabel: '检',
    description: '检查内容是否空泛、像 AI、缺少依据或缺少转化点，并给出改稿。',
    inputSummary: '内容草稿、平台要求、品牌语气、禁用表达',
    outputSummary: '质检结论、问题清单、优化版本、发布提醒',
    safetyCritical: true,
  },
  {
    role: AgentRole.PromotionPublishingSchedule,
    title: '发布排期 Agent',
    shortLabel: '排',
    description: '编排内容日历、发布时间、平台分发顺序和人工发布待办。',
    inputSummary: '物料包、平台优先级、账号节奏、审核状态、人工可执行时间',
    outputSummary: '发布日历、分发顺序、人工待办、依赖关系、风险提醒',
    safetyCritical: true,
  },
  {
    role: AgentRole.PromotionAccountMonitoring,
    title: '账户监控 Agent',
    shortLabel: '监',
    description: '监控账号曝光、点击、互动、线索、转化和成本异常，提示调整动作。',
    inputSummary: '指标快照、平台账号、活动目标、历史基线、预算或线索目标',
    outputSummary: '异常指标、趋势判断、原因假设、调整动作、待确认数据',
    safetyCritical: true,
  },
  {
    role: AgentRole.PromotionPerformanceReview,
    title: '复盘归档 Agent',
    shortLabel: '复',
    description: '汇总推广表现、沉淀有效素材和失败原因，反哺下一轮推广。',
    inputSummary: '监控报告、发布记录、线索反馈、转化结果、人工结论',
    outputSummary: '复盘结论、有效策略、失败原因、归档索引、下一轮建议',
    safetyCritical: false,
  },
];

export const LEGACY_ENTERPRISE_LEAD_AGENT_WORKFLOW: EnterpriseLeadAgentMetadata[] = [
  {
    role: AgentRole.Controller,
    title: '项目总控 Agent',
    shortLabel: '总',
    description: '理解目标、拆解任务、调度专业 Agent、汇总状态。',
    inputSummary: '用户目标、工作空间资料、历史执行',
    outputSummary: '执行计划、阶段状态、总控总结',
    safetyCritical: true,
  },
  {
    role: AgentRole.ProductUnderstanding,
    title: '产品理解 Agent',
    shortLabel: '产',
    description: '整理产品画像、卖点、适合客户、应用场景和缺失资料。',
    inputSummary: '用户目标、企业资料、产品资料',
    outputSummary: '产品画像、核心卖点、适合客户、缺失信息',
    safetyCritical: false,
  },
  {
    role: AgentRole.OpportunityRadar,
    title: '商机雷达 Agent',
    shortLabel: '商',
    description: '判断客户方向、采购信号、商机评分和跟进优先级。',
    inputSummary: '产品画像、客户方向、市场线索',
    outputSummary: '商机评分、采购信号、优先级建议',
    safetyCritical: false,
  },
  {
    role: AgentRole.ContentPlanning,
    title: '内容策划 Agent',
    shortLabel: '内',
    description: '生成小红书、短视频、公众号、产品介绍和销售话术草稿。',
    inputSummary: '产品理解、商机判断、渠道偏好、禁用表达',
    outputSummary: '内容草稿、高风险表达、下游上下文',
    safetyCritical: false,
  },
  {
    role: AgentRole.SocialOperation,
    title: '社媒运营 Agent',
    shortLabel: '媒',
    description: '生成发布计划、评论回复草稿、私信草稿和运营待办。',
    inputSummary: '内容草稿、平台偏好、互动规则',
    outputSummary: '社媒计划、评论草稿、私信草稿、人工待办',
    safetyCritical: true,
  },
  {
    role: AgentRole.SalesHandoff,
    title: '销售交接 Agent',
    shortLabel: '销',
    description: '生成销售交接单、SOP、异议处理和每日人工待办。',
    inputSummary: '商机评分、客户痛点、内容成果',
    outputSummary: '销售交接单、跟进 SOP、销售待办',
    safetyCritical: false,
  },
  {
    role: AgentRole.RiskReview,
    title: '风控审核 Agent',
    shortLabel: '控',
    description: '检查外发风险、夸大宣传、来源缺失和人工审批。',
    inputSummary: '全部草稿、外部动作、来源声明',
    outputSummary: '风险等级、返工项、审批项',
    safetyCritical: true,
  },
  {
    role: AgentRole.ProjectSummary,
    title: '项目归纳 Agent',
    shortLabel: '归',
    description: '汇总所有 Agent 输出，生成用户可读的最终总结。',
    inputSummary: '全部模块结果、返工日志、风控结论',
    outputSummary: '最终总结、待确认事项、下一步建议',
    safetyCritical: false,
  },
  {
    role: AgentRole.ProjectArchive,
    title: '项目归档 Agent',
    shortLabel: '档',
    description: '保存成果、风控记录、待办和历史查看入口。',
    inputSummary: '最终总结、成果包、风控记录、待办',
    outputSummary: '归档记录、结果索引、重新打开入口',
    safetyCritical: true,
  },
];

const ENTERPRISE_LEAD_AGENT_WORKFLOWS = [
  ENTERPRISE_LEAD_AGENT_WORKFLOW,
  PROMOTION_DEPARTMENT_AGENT_WORKFLOW,
  LEGACY_ENTERPRISE_LEAD_AGENT_WORKFLOW,
];

const ENTERPRISE_LEAD_AGENT_METADATA_BY_ROLE = new Map<
  EnterpriseLeadAgentRole,
  EnterpriseLeadAgentMetadata
>(ENTERPRISE_LEAD_AGENT_WORKFLOWS.flatMap(workflow => workflow.map(agent => [agent.role, agent])));

const getUnknownRoleError = (role: EnterpriseLeadAgentRole): Error =>
  new Error(`Unknown enterprise lead Agent role: ${role}`);

const findWorkflowContainingRole = (
  role: EnterpriseLeadAgentRole,
): EnterpriseLeadAgentMetadata[] | null =>
  ENTERPRISE_LEAD_AGENT_WORKFLOWS.find(workflow => workflow.some(agent => agent.role === role)) ??
  null;

export const getEnterpriseLeadAgentMetadata = (
  role: EnterpriseLeadAgentRole,
): EnterpriseLeadAgentMetadata => {
  const metadata = ENTERPRISE_LEAD_AGENT_METADATA_BY_ROLE.get(role);

  if (!metadata) {
    throw getUnknownRoleError(role);
  }

  return metadata;
};

export const buildDefaultPromotionDepartmentWorkspaceAgents =
  (): EnterpriseLeadWorkspaceAgentBinding[] =>
    buildDefaultEnterpriseLeadWorkspaceAgents(PROMOTION_DEPARTMENT_AGENT_ROLES);

export const getDownstreamAgentRoles = (
  role: EnterpriseLeadAgentRole,
): EnterpriseLeadAgentRole[] => {
  const workflow = findWorkflowContainingRole(role);

  if (!workflow) {
    throw getUnknownRoleError(role);
  }

  const roleIndex = workflow.findIndex(agent => agent.role === role);

  return workflow.slice(roleIndex + 1).map(agent => agent.role);
};

const buildDefaultSystemPrompt = (agent: EnterpriseLeadAgentMetadata): string =>
  [
    agent.description,
    `输入：${agent.inputSummary}`,
    `输出：${agent.outputSummary}`,
    agent.role === AgentRole.ContentPlanning ? VIDEO_GENERATION_HANDOFF_PROMPT : '',
  ]
    .filter(Boolean)
    .join('\n');

export const buildDefaultEnterpriseLeadWorkspaceAgents = (
  roles: readonly EnterpriseLeadAgentRole[] = EnterpriseLeadContentAgentRoles,
): EnterpriseLeadWorkspaceAgentBinding[] => {
  return roles
    .map(role => {
      try {
        return getEnterpriseLeadAgentMetadata(role);
      } catch {
        return null;
      }
    })
    .filter((agent): agent is EnterpriseLeadAgentMetadata => Boolean(agent))
    .map((agent, order) => ({
      agentId: agent.role,
      source: EnterpriseLeadWorkspaceAgentSource.SystemTemplate,
      templateId: agent.role,
      enabled: true,
      order,
      overrides: {
        name: agent.title,
        description: agent.description,
        identity: agent.title,
        systemPrompt: buildDefaultSystemPrompt(agent),
        icon: agent.shortLabel,
        skillIds: [] as string[],
      },
    }));
};
