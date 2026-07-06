export const EnterpriseLeadWorkspaceType = {
  EnterpriseLead: 'enterprise_lead',
} as const;
export type EnterpriseLeadWorkspaceType =
  typeof EnterpriseLeadWorkspaceType[keyof typeof EnterpriseLeadWorkspaceType];

export const EnterpriseLeadAgentRole = {
  Controller: 'controller',
  ProductUnderstanding: 'product_understanding',
  OpportunityRadar: 'opportunity_radar',
  ContentPlanning: 'content_planning',
  SocialOperation: 'social_operation',
  SalesHandoff: 'sales_handoff',
  RiskReview: 'risk_review',
  ProjectSummary: 'project_summary',
  ProjectArchive: 'project_archive',
} as const;
export type EnterpriseLeadAgentRole =
  typeof EnterpriseLeadAgentRole[keyof typeof EnterpriseLeadAgentRole];

export const EnterpriseLeadWorkspaceAgentSource = {
  SystemTemplate: 'system_template',
  WorkspaceCreated: 'workspace_created',
} as const;
export type EnterpriseLeadWorkspaceAgentSource =
  (typeof EnterpriseLeadWorkspaceAgentSource)[keyof typeof EnterpriseLeadWorkspaceAgentSource];

export const EnterpriseLeadRunStatus = {
  Draft: 'draft',
  Running: 'running',
  NeedsInput: 'needs_input',
  Blocked: 'blocked',
  Completed: 'completed',
  Archived: 'archived',
  Error: 'error',
} as const;
export type EnterpriseLeadRunStatus =
  typeof EnterpriseLeadRunStatus[keyof typeof EnterpriseLeadRunStatus];

export const EnterpriseLeadTaskStatus = {
  Waiting: 'waiting',
  Running: 'running',
  NeedsInput: 'needs_input',
  Completed: 'completed',
  Stale: 'stale',
  Blocked: 'blocked',
  Error: 'error',
} as const;
export type EnterpriseLeadTaskStatus =
  typeof EnterpriseLeadTaskStatus[keyof typeof EnterpriseLeadTaskStatus];

export const EnterpriseLeadRiskLevel = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
} as const;
export type EnterpriseLeadRiskLevel =
  typeof EnterpriseLeadRiskLevel[keyof typeof EnterpriseLeadRiskLevel];

export const EnterpriseLeadTodoKind = {
  MissingInfo: 'missing_info',
  ConfirmExpression: 'confirm_expression',
  ManualPublish: 'manual_publish',
  ManualComment: 'manual_comment',
  ManualDirectMessage: 'manual_direct_message',
  ManualEmail: 'manual_email',
  ReviewRisk: 'review_risk',
  ConfirmSource: 'confirm_source',
} as const;
export type EnterpriseLeadTodoKind =
  typeof EnterpriseLeadTodoKind[keyof typeof EnterpriseLeadTodoKind];

export const EnterpriseLeadDeliverableKind = {
  ProductProfile: 'product_profile',
  OpportunityReport: 'opportunity_report',
  ContentDraft: 'content_draft',
  SocialPlan: 'social_plan',
  CommentDraft: 'comment_draft',
  DirectMessageDraft: 'direct_message_draft',
  SalesHandoff: 'sales_handoff',
  RiskReview: 'risk_review',
  FinalSummary: 'final_summary',
} as const;
export type EnterpriseLeadDeliverableKind =
  typeof EnterpriseLeadDeliverableKind[keyof typeof EnterpriseLeadDeliverableKind];

export const EnterpriseLeadExtractionSourceKind = {
  Conversation: 'conversation',
  File: 'file',
  Manual: 'manual',
  Blank: 'blank',
} as const;
export type EnterpriseLeadExtractionSourceKind =
  typeof EnterpriseLeadExtractionSourceKind[keyof typeof EnterpriseLeadExtractionSourceKind];

export const EnterpriseLeadSkillCapabilityId = {
  DocumentParsing: 'documentParsing',
  CustomerProfile: 'customerProfile',
  LeadFiltering: 'leadFiltering',
  ContentRewrite: 'contentRewrite',
} as const;
export type EnterpriseLeadSkillCapabilityId =
  typeof EnterpriseLeadSkillCapabilityId[keyof typeof EnterpriseLeadSkillCapabilityId];

export const EnterpriseLeadSkillCapabilityIds = [
  EnterpriseLeadSkillCapabilityId.DocumentParsing,
  EnterpriseLeadSkillCapabilityId.CustomerProfile,
  EnterpriseLeadSkillCapabilityId.LeadFiltering,
  EnterpriseLeadSkillCapabilityId.ContentRewrite,
] as const;

export const EnterpriseLeadResearchCapabilityId = {
  WebSearch: 'webSearch',
  CompanyInfo: 'companyInfo',
  SocialTrend: 'socialTrend',
  HiringSignal: 'hiringSignal',
} as const;
export type EnterpriseLeadResearchCapabilityId =
  typeof EnterpriseLeadResearchCapabilityId[keyof typeof EnterpriseLeadResearchCapabilityId];

export const EnterpriseLeadResearchCapabilityIds = [
  EnterpriseLeadResearchCapabilityId.WebSearch,
  EnterpriseLeadResearchCapabilityId.CompanyInfo,
  EnterpriseLeadResearchCapabilityId.SocialTrend,
  EnterpriseLeadResearchCapabilityId.HiringSignal,
] as const;

export const EnterpriseLeadContentPlatformId = {
  Xiaohongshu: 'xiaohongshu',
  Douyin: 'douyin',
  Kuaishou: 'kuaishou',
  WechatOfficial: 'wechatOfficial',
  Wecom: 'wecom',
} as const;
export type EnterpriseLeadContentPlatformId =
  typeof EnterpriseLeadContentPlatformId[keyof typeof EnterpriseLeadContentPlatformId];

export const EnterpriseLeadContentPlatformIds = [
  EnterpriseLeadContentPlatformId.Xiaohongshu,
  EnterpriseLeadContentPlatformId.Douyin,
  EnterpriseLeadContentPlatformId.Kuaishou,
  EnterpriseLeadContentPlatformId.WechatOfficial,
  EnterpriseLeadContentPlatformId.Wecom,
] as const;

export const EnterpriseLeadContentOutputPlatformId = {
  XiaohongshuDraft: 'xiaohongshu_draft',
  SalesMessage: 'sales_message',
  WechatArticle: 'wechat_article',
  CustomWebhook: 'custom_webhook',
} as const;
export type EnterpriseLeadContentOutputPlatformId =
  typeof EnterpriseLeadContentOutputPlatformId[keyof typeof EnterpriseLeadContentOutputPlatformId];

export const EnterpriseLeadContentOutputPlatformIds = [
  EnterpriseLeadContentOutputPlatformId.XiaohongshuDraft,
  EnterpriseLeadContentOutputPlatformId.SalesMessage,
  EnterpriseLeadContentOutputPlatformId.WechatArticle,
  EnterpriseLeadContentOutputPlatformId.CustomWebhook,
] as const;

export const EnterpriseLeadContentOutputLengthPolicy = {
  Compress: 'compress',
  Split: 'split',
  WarnOnly: 'warn_only',
} as const;
export type EnterpriseLeadContentOutputLengthPolicy =
  typeof EnterpriseLeadContentOutputLengthPolicy[keyof typeof EnterpriseLeadContentOutputLengthPolicy];

export const EnterpriseLeadContentDeliveryMode = {
  DraftOnly: 'draft_only',
  MarkdownExport: 'markdown_export',
  ThirdPartyDraft: 'third_party_draft',
  WecomDraft: 'wecom_draft',
  CrmDraft: 'crm_draft',
  SmsTemplate: 'sms_template',
  WechatDraft: 'wechat_draft',
  Webhook: 'webhook',
} as const;
export type EnterpriseLeadContentDeliveryMode =
  typeof EnterpriseLeadContentDeliveryMode[keyof typeof EnterpriseLeadContentDeliveryMode];

export const EnterpriseLeadWorkspaceIpc = {
  ListWorkspaces: 'enterpriseLeadWorkspace:workspaces:list',
  GetWorkspace: 'enterpriseLeadWorkspace:workspaces:get',
  UpdateWorkspaceProfile: 'enterpriseLeadWorkspace:workspaces:updateProfile',
  UpdateWorkspaceSettings: 'enterpriseLeadWorkspace:workspaces:updateSettings',
  UpdateWorkspaceAgents: 'enterpriseLeadWorkspace:workspaces:updateAgents',
  ExtractDraft: 'enterpriseLeadWorkspace:drafts:extract',
  CreateWorkspace: 'enterpriseLeadWorkspace:workspaces:create',
  DeleteWorkspace: 'enterpriseLeadWorkspace:workspaces:delete',
  ListRuns: 'enterpriseLeadWorkspace:runs:list',
  CreateRun: 'enterpriseLeadWorkspace:runs:create',
  GetRun: 'enterpriseLeadWorkspace:runs:get',
  RunWorkflow: 'enterpriseLeadWorkspace:runs:runWorkflow',
  ListChatSessions: 'enterpriseLeadWorkspace:chatSessions:list',
  GetChatSession: 'enterpriseLeadWorkspace:chatSessions:get',
  DeleteChatSession: 'enterpriseLeadWorkspace:chatSessions:delete',
  Chat: 'enterpriseLeadWorkspace:chat:send',
  RunTask: 'enterpriseLeadWorkspace:tasks:run',
  RerunTask: 'enterpriseLeadWorkspace:tasks:rerun',
  CreatePendingVersion: 'enterpriseLeadWorkspace:tasks:createPendingVersion',
  ApplyPendingVersion: 'enterpriseLeadWorkspace:tasks:applyPendingVersion',
  ArchiveRun: 'enterpriseLeadWorkspace:runs:archive',
} as const;
export type EnterpriseLeadWorkspaceIpc =
  typeof EnterpriseLeadWorkspaceIpc[keyof typeof EnterpriseLeadWorkspaceIpc];
