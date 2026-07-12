import { EnterpriseLeadAgentRole } from './constants';
import type { PromotionWorkflowNode } from './workflowContracts';
import { WorkflowExecutionMode } from './workflowContracts';

export const PROMOTION_WORKFLOW_GRAPH: PromotionWorkflowNode[] = [
  { role: EnterpriseLeadAgentRole.PromotionController, dependsOn: [], executionMode: WorkflowExecutionMode.Inline },
  { role: EnterpriseLeadAgentRole.PromotionDataScraping, dependsOn: [EnterpriseLeadAgentRole.PromotionController], executionMode: WorkflowExecutionMode.Inline },
  { role: EnterpriseLeadAgentRole.ProductSellingPoint, dependsOn: [EnterpriseLeadAgentRole.PromotionController], executionMode: WorkflowExecutionMode.Inline },
  { role: EnterpriseLeadAgentRole.PromotionDataCleaning, dependsOn: [EnterpriseLeadAgentRole.PromotionDataScraping, EnterpriseLeadAgentRole.ProductSellingPoint], executionMode: WorkflowExecutionMode.Inline },
  { role: EnterpriseLeadAgentRole.PromotionCompetitorInsight, dependsOn: [EnterpriseLeadAgentRole.PromotionDataCleaning], executionMode: WorkflowExecutionMode.Inline },
  { role: EnterpriseLeadAgentRole.PromotionLeadScoring, dependsOn: [EnterpriseLeadAgentRole.PromotionDataCleaning], executionMode: WorkflowExecutionMode.Inline },
  { role: EnterpriseLeadAgentRole.PromotionMultiPlatformAssets, dependsOn: [EnterpriseLeadAgentRole.ProductSellingPoint, EnterpriseLeadAgentRole.PromotionCompetitorInsight, EnterpriseLeadAgentRole.PromotionLeadScoring], executionMode: WorkflowExecutionMode.Inline },
  { role: EnterpriseLeadAgentRole.ContentQuality, dependsOn: [EnterpriseLeadAgentRole.PromotionMultiPlatformAssets], executionMode: WorkflowExecutionMode.Inline },
  { role: EnterpriseLeadAgentRole.PromotionPublishingSchedule, dependsOn: [EnterpriseLeadAgentRole.ContentQuality], executionMode: WorkflowExecutionMode.Inline },
  { role: EnterpriseLeadAgentRole.SalesHandoff, dependsOn: [EnterpriseLeadAgentRole.PromotionLeadScoring, EnterpriseLeadAgentRole.PromotionMultiPlatformAssets], executionMode: WorkflowExecutionMode.Inline, optional: true, enableWhen: 'sales_handoff_requested' },
  { role: EnterpriseLeadAgentRole.PromotionAccountMonitoring, dependsOn: [EnterpriseLeadAgentRole.PromotionPublishingSchedule], executionMode: WorkflowExecutionMode.Inline, optional: true, enableWhen: 'monitoring_requested' },
  { role: EnterpriseLeadAgentRole.PromotionPerformanceReview, dependsOn: [EnterpriseLeadAgentRole.PromotionAccountMonitoring], executionMode: WorkflowExecutionMode.Inline, optional: true, enableWhen: 'monitoring_requested' },
];
