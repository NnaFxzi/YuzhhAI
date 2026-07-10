import { EnterpriseLeadAgentRole } from './constants';

export const EnterpriseLeadDepartmentId = {
  Promotion: 'promotion',
} as const;
export type EnterpriseLeadDepartmentId =
  (typeof EnterpriseLeadDepartmentId)[keyof typeof EnterpriseLeadDepartmentId];

export const EnterpriseLeadAgentGroupId = {
  PromotionLeadership: 'promotion_leadership',
  DataIntelligence: 'data_intelligence',
  OpportunityStrategy: 'opportunity_strategy',
  ContentAssets: 'content_assets',
  QualityRisk: 'quality_risk',
  OperationExecution: 'operation_execution',
  MonitoringReview: 'monitoring_review',
} as const;
export type EnterpriseLeadAgentGroupId =
  (typeof EnterpriseLeadAgentGroupId)[keyof typeof EnterpriseLeadAgentGroupId];

export interface EnterpriseLeadAgentGroupTemplate {
  id: EnterpriseLeadAgentGroupId;
  titleKey: string;
  roles: EnterpriseLeadAgentRole[];
}

export interface EnterpriseLeadDepartmentTemplate {
  id: EnterpriseLeadDepartmentId;
  titleKey: string;
  groups: EnterpriseLeadAgentGroupTemplate[];
}

export interface EnterpriseLeadAgentDepartmentPlacement {
  departmentId: EnterpriseLeadDepartmentId;
  groupId: EnterpriseLeadAgentGroupId;
  groupTitleKey: string;
  order: number;
}

export const PROMOTION_DEPARTMENT_AGENT_ROLES = [
  EnterpriseLeadAgentRole.PromotionController,
  EnterpriseLeadAgentRole.PromotionDataScraping,
  EnterpriseLeadAgentRole.PromotionDataCleaning,
  EnterpriseLeadAgentRole.PromotionCompetitorInsight,
  EnterpriseLeadAgentRole.PromotionLeadScoring,
  EnterpriseLeadAgentRole.ProductSellingPoint,
  EnterpriseLeadAgentRole.PromotionMultiPlatformAssets,
  EnterpriseLeadAgentRole.ContentQuality,
  EnterpriseLeadAgentRole.PromotionPublishingSchedule,
  EnterpriseLeadAgentRole.PromotionAccountMonitoring,
  EnterpriseLeadAgentRole.PromotionPerformanceReview,
] as const;

export const PROMOTION_DEPARTMENT_TEMPLATE: EnterpriseLeadDepartmentTemplate = {
  id: EnterpriseLeadDepartmentId.Promotion,
  titleKey: 'enterpriseLeadDepartmentPromotionTitle',
  groups: [
    {
      id: EnterpriseLeadAgentGroupId.PromotionLeadership,
      titleKey: 'enterpriseLeadAgentGroupPromotionLeadershipTitle',
      roles: [EnterpriseLeadAgentRole.PromotionController],
    },
    {
      id: EnterpriseLeadAgentGroupId.DataIntelligence,
      titleKey: 'enterpriseLeadAgentGroupDataIntelligenceTitle',
      roles: [
        EnterpriseLeadAgentRole.PromotionDataScraping,
        EnterpriseLeadAgentRole.PromotionDataCleaning,
        EnterpriseLeadAgentRole.PromotionCompetitorInsight,
      ],
    },
    {
      id: EnterpriseLeadAgentGroupId.OpportunityStrategy,
      titleKey: 'enterpriseLeadAgentGroupOpportunityStrategyTitle',
      roles: [
        EnterpriseLeadAgentRole.PromotionLeadScoring,
        EnterpriseLeadAgentRole.ProductSellingPoint,
      ],
    },
    {
      id: EnterpriseLeadAgentGroupId.ContentAssets,
      titleKey: 'enterpriseLeadAgentGroupContentAssetsTitle',
      roles: [EnterpriseLeadAgentRole.PromotionMultiPlatformAssets],
    },
    {
      id: EnterpriseLeadAgentGroupId.QualityRisk,
      titleKey: 'enterpriseLeadAgentGroupQualityRiskTitle',
      roles: [EnterpriseLeadAgentRole.ContentQuality],
    },
    {
      id: EnterpriseLeadAgentGroupId.OperationExecution,
      titleKey: 'enterpriseLeadAgentGroupOperationExecutionTitle',
      roles: [EnterpriseLeadAgentRole.PromotionPublishingSchedule],
    },
    {
      id: EnterpriseLeadAgentGroupId.MonitoringReview,
      titleKey: 'enterpriseLeadAgentGroupMonitoringReviewTitle',
      roles: [
        EnterpriseLeadAgentRole.PromotionAccountMonitoring,
        EnterpriseLeadAgentRole.PromotionPerformanceReview,
      ],
    },
  ],
};

const PROMOTION_DEPARTMENT_PLACEMENTS = new Map<
  EnterpriseLeadAgentRole,
  EnterpriseLeadAgentDepartmentPlacement
>(
  PROMOTION_DEPARTMENT_TEMPLATE.groups.flatMap(group =>
    group.roles.map((role, order) => [
      role,
      {
        departmentId: PROMOTION_DEPARTMENT_TEMPLATE.id,
        groupId: group.id,
        groupTitleKey: group.titleKey,
        order,
      },
    ]),
  ),
);

export const getPromotionDepartmentAgentRoles = (): EnterpriseLeadAgentRole[] =>
  PROMOTION_DEPARTMENT_TEMPLATE.groups.flatMap(group => group.roles);

export const getPromotionDepartmentGroups = (): EnterpriseLeadAgentGroupTemplate[] =>
  PROMOTION_DEPARTMENT_TEMPLATE.groups.map(group => ({
    ...group,
    roles: [...group.roles],
  }));

export const getAgentDepartmentPlacement = (
  role: EnterpriseLeadAgentRole | string,
): EnterpriseLeadAgentDepartmentPlacement | null => {
  const placement = PROMOTION_DEPARTMENT_PLACEMENTS.get(role as EnterpriseLeadAgentRole);
  return placement ? { ...placement } : null;
};
