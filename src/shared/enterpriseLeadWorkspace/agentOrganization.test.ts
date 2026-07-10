import { describe, expect, test } from 'vitest';

import {
  EnterpriseLeadAgentGroupId,
  EnterpriseLeadDepartmentId,
  getAgentDepartmentPlacement,
  getPromotionDepartmentAgentRoles,
  getPromotionDepartmentGroups,
  PROMOTION_DEPARTMENT_TEMPLATE,
} from './agentOrganization';
import { EnterpriseLeadAgentRole } from './constants';

describe('enterprise lead agent organization', () => {
  test('keeps promotion department agent role order', () => {
    expect(getPromotionDepartmentAgentRoles()).toEqual([
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
    ]);
  });

  test('places promotion agents in department groups', () => {
    expect(
      getAgentDepartmentPlacement(EnterpriseLeadAgentRole.PromotionAccountMonitoring),
    ).toMatchObject({
      departmentId: EnterpriseLeadDepartmentId.Promotion,
      groupId: EnterpriseLeadAgentGroupId.MonitoringReview,
    });
    expect(getAgentDepartmentPlacement(EnterpriseLeadAgentRole.ProductSellingPoint)).toMatchObject({
      departmentId: EnterpriseLeadDepartmentId.Promotion,
      groupId: EnterpriseLeadAgentGroupId.OpportunityStrategy,
    });
    expect(getAgentDepartmentPlacement(EnterpriseLeadAgentRole.SocialCopy)).toBeNull();
  });

  test('returns cloned promotion department groups', () => {
    const groups = getPromotionDepartmentGroups();
    groups[0].roles.push(EnterpriseLeadAgentRole.SocialCopy);

    expect(PROMOTION_DEPARTMENT_TEMPLATE.groups[0].roles).toEqual([
      EnterpriseLeadAgentRole.PromotionController,
    ]);
  });
});
