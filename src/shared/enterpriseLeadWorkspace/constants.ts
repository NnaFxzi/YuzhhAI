export const EnterpriseLeadWorkspaceType = {
  EnterpriseLead: 'enterprise_lead',
} as const;
export type EnterpriseLeadWorkspaceType =
  (typeof EnterpriseLeadWorkspaceType)[keyof typeof EnterpriseLeadWorkspaceType];

export const EnterpriseLeadKnowledgeScope = {
  Workspace: 'enterprise-workspace',
} as const;
export type EnterpriseLeadKnowledgeScope =
  (typeof EnterpriseLeadKnowledgeScope)[keyof typeof EnterpriseLeadKnowledgeScope];

export const buildEnterpriseLeadWorkspaceKnowledgeScopeId = (workspaceId: string): string =>
  `${EnterpriseLeadKnowledgeScope.Workspace}:${workspaceId}`;

export const EnterpriseLeadAgentRole = {
  ProductSellingPoint: 'product_selling_point',
  TopicPlanning: 'topic_planning',
  ShortVideoScript: 'short_video_script',
  SocialCopy: 'social_copy',
  PrivateDomainConversion: 'private_domain_conversion',
  ContentQuality: 'content_quality',
  PromotionController: 'promotion_controller',
  PromotionDataScraping: 'promotion_data_scraping',
  PromotionDataCleaning: 'promotion_data_cleaning',
  PromotionCompetitorInsight: 'promotion_competitor_insight',
  PromotionLeadScoring: 'promotion_lead_scoring',
  PromotionMultiPlatformAssets: 'promotion_multi_platform_assets',
  PromotionPublishingSchedule: 'promotion_publishing_schedule',
  PromotionAccountMonitoring: 'promotion_account_monitoring',
  PromotionPerformanceReview: 'promotion_performance_review',
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
  (typeof EnterpriseLeadAgentRole)[keyof typeof EnterpriseLeadAgentRole];

export const EnterpriseLeadContentAgentRoles = [
  EnterpriseLeadAgentRole.ProductSellingPoint,
  EnterpriseLeadAgentRole.TopicPlanning,
  EnterpriseLeadAgentRole.ShortVideoScript,
  EnterpriseLeadAgentRole.SocialCopy,
  EnterpriseLeadAgentRole.PrivateDomainConversion,
  EnterpriseLeadAgentRole.ContentQuality,
] as const;

export const EnterpriseLeadWorkspaceAgentSource = {
  SystemTemplate: 'system_template',
  LocalAgent: 'local_agent',
  WorkspaceCreated: 'workspace_created',
} as const;
export type EnterpriseLeadWorkspaceAgentSource =
  (typeof EnterpriseLeadWorkspaceAgentSource)[keyof typeof EnterpriseLeadWorkspaceAgentSource];

export const EnterpriseLeadWorkspaceAgentCalibrationCheckId = {
  Priority: 'priority',
  Reason: 'reason',
  Missing: 'missing',
  NextStep: 'next_step',
} as const;
export type EnterpriseLeadWorkspaceAgentCalibrationCheckId =
  (typeof EnterpriseLeadWorkspaceAgentCalibrationCheckId)[keyof typeof EnterpriseLeadWorkspaceAgentCalibrationCheckId];

export const EnterpriseLeadRunStatus = {
  Draft: 'draft',
  Running: 'running',
  NeedsInput: 'needs_input',
  AwaitingApproval: 'awaiting_approval',
  Blocked: 'blocked',
  Completed: 'completed',
  Cancelled: 'cancelled',
  Archived: 'archived',
  Error: 'error',
} as const;
export type EnterpriseLeadRunStatus =
  (typeof EnterpriseLeadRunStatus)[keyof typeof EnterpriseLeadRunStatus];

export const EnterpriseLeadTaskStatus = {
  Waiting: 'waiting',
  Ready: 'ready',
  Running: 'running',
  NeedsInput: 'needs_input',
  AwaitingApproval: 'awaiting_approval',
  Completed: 'completed',
  Stale: 'stale',
  Blocked: 'blocked',
  Cancelled: 'cancelled',
  Error: 'error',
} as const;
export type EnterpriseLeadTaskStatus =
  (typeof EnterpriseLeadTaskStatus)[keyof typeof EnterpriseLeadTaskStatus];

export const EnterpriseLeadRiskLevel = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
} as const;
export type EnterpriseLeadRiskLevel =
  (typeof EnterpriseLeadRiskLevel)[keyof typeof EnterpriseLeadRiskLevel];

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
  (typeof EnterpriseLeadTodoKind)[keyof typeof EnterpriseLeadTodoKind];

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
  PromotionResearchData: 'promotion_research_data',
  PromotionCleanDataset: 'promotion_clean_dataset',
  PromotionCompetitorInsight: 'promotion_competitor_insight',
  PromotionMetricReport: 'promotion_metric_report',
  PromotionPerformanceReview: 'promotion_performance_review',
} as const;
export type EnterpriseLeadDeliverableKind =
  (typeof EnterpriseLeadDeliverableKind)[keyof typeof EnterpriseLeadDeliverableKind];

export const EnterpriseLeadExtractionSourceKind = {
  Conversation: 'conversation',
  File: 'file',
  Image: 'image',
  Manual: 'manual',
  Blank: 'blank',
} as const;
export type EnterpriseLeadExtractionSourceKind =
  (typeof EnterpriseLeadExtractionSourceKind)[keyof typeof EnterpriseLeadExtractionSourceKind];

export const EnterpriseLeadReadableDocumentExtension = {
  Txt: 'txt',
  Markdown: 'md',
  MarkdownLong: 'markdown',
  Csv: 'csv',
  Tsv: 'tsv',
  Json: 'json',
  Jsonl: 'jsonl',
  Html: 'html',
  Htm: 'htm',
  Xml: 'xml',
  Yaml: 'yaml',
  Yml: 'yml',
  Log: 'log',
  Pdf: 'pdf',
  Docx: 'docx',
  Xls: 'xls',
  Xlsx: 'xlsx',
  Pptx: 'pptx',
} as const;
export type EnterpriseLeadReadableDocumentExtension =
  (typeof EnterpriseLeadReadableDocumentExtension)[keyof typeof EnterpriseLeadReadableDocumentExtension];

export const EnterpriseLeadPlainTextDocumentExtensions = [
  EnterpriseLeadReadableDocumentExtension.Txt,
  EnterpriseLeadReadableDocumentExtension.Markdown,
  EnterpriseLeadReadableDocumentExtension.MarkdownLong,
  EnterpriseLeadReadableDocumentExtension.Csv,
  EnterpriseLeadReadableDocumentExtension.Tsv,
  EnterpriseLeadReadableDocumentExtension.Json,
  EnterpriseLeadReadableDocumentExtension.Jsonl,
  EnterpriseLeadReadableDocumentExtension.Html,
  EnterpriseLeadReadableDocumentExtension.Htm,
  EnterpriseLeadReadableDocumentExtension.Xml,
  EnterpriseLeadReadableDocumentExtension.Yaml,
  EnterpriseLeadReadableDocumentExtension.Yml,
  EnterpriseLeadReadableDocumentExtension.Log,
] as const;

export const EnterpriseLeadRichDocumentExtensions = [
  EnterpriseLeadReadableDocumentExtension.Pdf,
  EnterpriseLeadReadableDocumentExtension.Docx,
  EnterpriseLeadReadableDocumentExtension.Xls,
  EnterpriseLeadReadableDocumentExtension.Xlsx,
  EnterpriseLeadReadableDocumentExtension.Pptx,
] as const;

export const EnterpriseLeadReadableDocumentExtensions = [
  ...EnterpriseLeadPlainTextDocumentExtensions,
  ...EnterpriseLeadRichDocumentExtensions,
] as const;

export const EnterpriseLeadAttachmentOnlyDocumentExtension = {
  Doc: 'doc',
  Ppt: 'ppt',
} as const;
export type EnterpriseLeadAttachmentOnlyDocumentExtension =
  (typeof EnterpriseLeadAttachmentOnlyDocumentExtension)[keyof typeof EnterpriseLeadAttachmentOnlyDocumentExtension];

export const EnterpriseLeadAttachmentOnlyDocumentExtensions = [
  EnterpriseLeadAttachmentOnlyDocumentExtension.Doc,
  EnterpriseLeadAttachmentOnlyDocumentExtension.Ppt,
] as const;

export const EnterpriseLeadImageAttachmentExtension = {
  Png: 'png',
  Jpg: 'jpg',
  Jpeg: 'jpeg',
  Webp: 'webp',
  Gif: 'gif',
  Bmp: 'bmp',
  Tif: 'tif',
  Tiff: 'tiff',
  Heic: 'heic',
  Heif: 'heif',
} as const;
export type EnterpriseLeadImageAttachmentExtension =
  (typeof EnterpriseLeadImageAttachmentExtension)[keyof typeof EnterpriseLeadImageAttachmentExtension];

export const EnterpriseLeadImageAttachmentExtensions = [
  EnterpriseLeadImageAttachmentExtension.Png,
  EnterpriseLeadImageAttachmentExtension.Jpg,
  EnterpriseLeadImageAttachmentExtension.Jpeg,
  EnterpriseLeadImageAttachmentExtension.Webp,
  EnterpriseLeadImageAttachmentExtension.Gif,
  EnterpriseLeadImageAttachmentExtension.Bmp,
  EnterpriseLeadImageAttachmentExtension.Tif,
  EnterpriseLeadImageAttachmentExtension.Tiff,
  EnterpriseLeadImageAttachmentExtension.Heic,
  EnterpriseLeadImageAttachmentExtension.Heif,
] as const;

export const EnterpriseLeadSourceDocumentFileFilterExtensions = [
  ...EnterpriseLeadReadableDocumentExtensions,
  EnterpriseLeadAttachmentOnlyDocumentExtension.Doc,
  EnterpriseLeadAttachmentOnlyDocumentExtension.Ppt,
  ...EnterpriseLeadImageAttachmentExtensions,
] as const;

export const EnterpriseLeadReadableDocumentMimeType = {
  Text: 'text/plain',
  Markdown: 'text/markdown',
  Csv: 'text/csv',
  Tsv: 'text/tab-separated-values',
  Json: 'application/json',
  Jsonl: 'application/x-ndjson',
  Html: 'text/html',
  Xml: 'application/xml',
  Yaml: 'application/yaml',
  Pdf: 'application/pdf',
  Docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  Xls: 'application/vnd.ms-excel',
  Xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  Pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
} as const;
export type EnterpriseLeadReadableDocumentMimeType =
  (typeof EnterpriseLeadReadableDocumentMimeType)[keyof typeof EnterpriseLeadReadableDocumentMimeType];

export const EnterpriseLeadReadableDocumentAcceptTypes = [
  ...EnterpriseLeadReadableDocumentExtensions.map(extension => `.${extension}`),
  ...Object.values(EnterpriseLeadReadableDocumentMimeType),
] as const;

export const EnterpriseLeadDocumentExtractionStatus = {
  Pending: 'pending',
  Extracting: 'extracting',
  Extracted: 'extracted',
  Failed: 'failed',
} as const;
export type EnterpriseLeadDocumentExtractionStatus =
  (typeof EnterpriseLeadDocumentExtractionStatus)[keyof typeof EnterpriseLeadDocumentExtractionStatus];

export const EnterpriseLeadDocumentExtractionStage = {
  Queued: 'queued',
  ExtractingChunks: 'extracting_chunks',
  Merging: 'merging',
  Indexing: 'indexing',
} as const;
export type EnterpriseLeadDocumentExtractionStage =
  (typeof EnterpriseLeadDocumentExtractionStage)[keyof typeof EnterpriseLeadDocumentExtractionStage];

export const EnterpriseLeadKnowledgeIndexStatus = {
  Pending: 'pending',
  Indexing: 'indexing',
  Indexed: 'indexed',
  Failed: 'failed',
} as const;
export type EnterpriseLeadKnowledgeIndexStatus =
  (typeof EnterpriseLeadKnowledgeIndexStatus)[keyof typeof EnterpriseLeadKnowledgeIndexStatus];

export const EnterpriseLeadSkillCapabilityId = {
  DocumentParsing: 'documentParsing',
  CustomerProfile: 'customerProfile',
  LeadFiltering: 'leadFiltering',
  ContentRewrite: 'contentRewrite',
} as const;
export type EnterpriseLeadSkillCapabilityId =
  (typeof EnterpriseLeadSkillCapabilityId)[keyof typeof EnterpriseLeadSkillCapabilityId];

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
  (typeof EnterpriseLeadResearchCapabilityId)[keyof typeof EnterpriseLeadResearchCapabilityId];

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
  (typeof EnterpriseLeadContentPlatformId)[keyof typeof EnterpriseLeadContentPlatformId];

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
  (typeof EnterpriseLeadContentOutputPlatformId)[keyof typeof EnterpriseLeadContentOutputPlatformId];

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
  (typeof EnterpriseLeadContentOutputLengthPolicy)[keyof typeof EnterpriseLeadContentOutputLengthPolicy];

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
  (typeof EnterpriseLeadContentDeliveryMode)[keyof typeof EnterpriseLeadContentDeliveryMode];

export const EnterpriseLeadWorkspaceIpc = {
  ListWorkspaces: 'enterpriseLeadWorkspace:workspaces:list',
  GetWorkspace: 'enterpriseLeadWorkspace:workspaces:get',
  UpdateWorkspaceProfile: 'enterpriseLeadWorkspace:workspaces:updateProfile',
  UpdateWorkspaceSources: 'enterpriseLeadWorkspace:workspaces:updateSources',
  ProcessDocumentSource: 'enterpriseLeadWorkspace:documents:processSource',
  UpdateWorkspaceSettings: 'enterpriseLeadWorkspace:workspaces:updateSettings',
  UpdateWorkspaceAgents: 'enterpriseLeadWorkspace:workspaces:updateAgents',
  ExtractDraft: 'enterpriseLeadWorkspace:drafts:extract',
  CreateWorkspace: 'enterpriseLeadWorkspace:workspaces:create',
  DeleteWorkspace: 'enterpriseLeadWorkspace:workspaces:delete',
  ListRuns: 'enterpriseLeadWorkspace:runs:list',
  CreateRun: 'enterpriseLeadWorkspace:runs:create',
  GetRun: 'enterpriseLeadWorkspace:runs:get',
  RunWorkflow: 'enterpriseLeadWorkspace:runs:runWorkflow',
  TestWorkspaceAgent: 'enterpriseLeadWorkspace:agents:test',
  RunTask: 'enterpriseLeadWorkspace:tasks:run',
  RerunTask: 'enterpriseLeadWorkspace:tasks:rerun',
  CreatePendingVersion: 'enterpriseLeadWorkspace:tasks:createPendingVersion',
  ApplyPendingVersion: 'enterpriseLeadWorkspace:tasks:applyPendingVersion',
  ArchiveRun: 'enterpriseLeadWorkspace:runs:archive',
} as const;
export type EnterpriseLeadWorkspaceIpc =
  (typeof EnterpriseLeadWorkspaceIpc)[keyof typeof EnterpriseLeadWorkspaceIpc];

export const EnterpriseLeadWorkflowIpc = {
  Start: 'enterpriseLeadWorkflow:start',
  Resume: 'enterpriseLeadWorkflow:resume',
  Cancel: 'enterpriseLeadWorkflow:cancel',
  ApproveTask: 'enterpriseLeadWorkflow:approveTask',
  RejectTask: 'enterpriseLeadWorkflow:rejectTask',
  Event: 'enterpriseLeadWorkflow:event',
} as const;
export type EnterpriseLeadWorkflowIpc =
  (typeof EnterpriseLeadWorkflowIpc)[keyof typeof EnterpriseLeadWorkflowIpc];
