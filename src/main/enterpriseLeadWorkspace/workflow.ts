import type { EnterpriseLeadAgentRole } from '../../shared/enterpriseLeadWorkspace/constants';
import { EnterpriseLeadAgentRole as AgentRole } from '../../shared/enterpriseLeadWorkspace/constants';
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

export const getEnterpriseLeadAgentMetadata = (
  role: EnterpriseLeadAgentRole,
): EnterpriseLeadAgentMetadata => {
  const metadata = ENTERPRISE_LEAD_AGENT_WORKFLOW.find(agent => agent.role === role);

  if (!metadata) {
    throw getUnknownRoleError(role);
  }

  return metadata;
};

export const getDownstreamAgentRoles = (role: EnterpriseLeadAgentRole): EnterpriseLeadAgentRole[] => {
  const roleIndex = ENTERPRISE_LEAD_AGENT_WORKFLOW.findIndex(agent => agent.role === role);

  if (roleIndex === -1) {
    throw getUnknownRoleError(role);
  }

  return ENTERPRISE_LEAD_AGENT_WORKFLOW.slice(roleIndex + 1).map(agent => agent.role);
};

const buildDefaultSystemPrompt = (agent: EnterpriseLeadAgentMetadata): string =>
  [
    agent.description,
    `输入：${agent.inputSummary}`,
    `输出：${agent.outputSummary}`,
  ].join('\n');

export const buildDefaultEnterpriseLeadWorkspaceAgents = (
  roles: EnterpriseLeadAgentRole[] = ENTERPRISE_LEAD_AGENT_WORKFLOW.map(agent => agent.role),
): EnterpriseLeadWorkspaceAgentBinding[] => {
  const roleSet = new Set(roles);

  return ENTERPRISE_LEAD_AGENT_WORKFLOW
    .filter(agent => roleSet.has(agent.role))
    .map((agent, order) => ({
      agentId: agent.role,
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
