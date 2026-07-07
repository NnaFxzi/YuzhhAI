import { VIDEO_GENERATION_HANDOFF_PROMPT } from '../../shared/contentProduction/videoGenerationHandoff';
import type { EnterpriseLeadAgentRole } from '../../shared/enterpriseLeadWorkspace/constants';
import {
  EnterpriseLeadAgentRole as AgentRole,
  EnterpriseLeadContentAgentRoles,
  EnterpriseLeadWorkspaceAgentSource,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type { EnterpriseLeadWorkspaceAgentBinding } from '../../shared/enterpriseLeadWorkspace/types';

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

const ENTERPRISE_LEAD_AGENT_METADATA_BY_ROLE = new Map<
  EnterpriseLeadAgentRole,
  EnterpriseLeadAgentMetadata
>(ENTERPRISE_LEAD_AGENT_WORKFLOW.map(agent => [agent.role, agent]));

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

const getUnknownRoleError = (role: EnterpriseLeadAgentRole): Error =>
  new Error(`Unknown enterprise lead Agent role: ${role}`);

const findWorkflowContainingRole = (
  role: EnterpriseLeadAgentRole,
): EnterpriseLeadAgentMetadata[] | null =>
  [ENTERPRISE_LEAD_AGENT_WORKFLOW, LEGACY_ENTERPRISE_LEAD_AGENT_WORKFLOW].find(workflow =>
    workflow.some(agent => agent.role === role),
  ) ?? null;

export const getEnterpriseLeadAgentMetadata = (
  role: EnterpriseLeadAgentRole,
): EnterpriseLeadAgentMetadata => {
  const metadata =
    ENTERPRISE_LEAD_AGENT_METADATA_BY_ROLE.get(role) ??
    LEGACY_ENTERPRISE_LEAD_AGENT_WORKFLOW.find(agent => agent.role === role);

  if (!metadata) {
    throw getUnknownRoleError(role);
  }

  return metadata;
};

export const getDownstreamAgentRoles = (role: EnterpriseLeadAgentRole): EnterpriseLeadAgentRole[] => {
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
