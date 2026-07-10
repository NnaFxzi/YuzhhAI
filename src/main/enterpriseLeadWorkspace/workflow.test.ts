import { describe, expect, test } from 'vitest';

import { EnterpriseLeadAgentRole } from '../../shared/enterpriseLeadWorkspace/constants';
import {
  buildDefaultEnterpriseLeadWorkspaceAgents,
  buildDefaultPromotionDepartmentWorkspaceAgents,
  ENTERPRISE_LEAD_AGENT_WORKFLOW,
  getDownstreamAgentRoles,
  getEnterpriseLeadAgentMetadata,
  PROMOTION_DEPARTMENT_AGENT_WORKFLOW,
} from './workflow';

describe('enterprise lead agent workflow metadata', () => {
  test('keeps the fixed agent workflow role order', () => {
    expect(ENTERPRISE_LEAD_AGENT_WORKFLOW.map(agent => agent.role)).toEqual([
      EnterpriseLeadAgentRole.ProductSellingPoint,
      EnterpriseLeadAgentRole.TopicPlanning,
      EnterpriseLeadAgentRole.ShortVideoScript,
      EnterpriseLeadAgentRole.SocialCopy,
      EnterpriseLeadAgentRole.PrivateDomainConversion,
      EnterpriseLeadAgentRole.ContentQuality,
    ]);
  });

  test('returns safety metadata for risk review agent', () => {
    expect(getEnterpriseLeadAgentMetadata(EnterpriseLeadAgentRole.RiskReview)).toMatchObject({
      title: '风控审核 Agent',
      shortLabel: '控',
      safetyCritical: true,
    });
  });

  test('registers promotion department workflow metadata', () => {
    expect(PROMOTION_DEPARTMENT_AGENT_WORKFLOW.map(agent => agent.role)).toEqual([
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
    expect(
      getEnterpriseLeadAgentMetadata(EnterpriseLeadAgentRole.PromotionDataScraping).title,
    ).toBe('数据抓取 Agent');
    expect(getDownstreamAgentRoles(EnterpriseLeadAgentRole.PromotionDataScraping)[0]).toBe(
      EnterpriseLeadAgentRole.PromotionDataCleaning,
    );
  });

  test('builds default promotion department workspace agents', () => {
    const agents = buildDefaultPromotionDepartmentWorkspaceAgents();

    expect(agents).toHaveLength(11);
    expect(agents[0]).toMatchObject({
      agentId: EnterpriseLeadAgentRole.PromotionController,
      overrides: { name: '推广总控 Agent', icon: '总' },
    });
    expect(agents[1].overrides.systemPrompt).toContain('来源链接');
  });

  test('returns every downstream role after content planning', () => {
    expect(getDownstreamAgentRoles(EnterpriseLeadAgentRole.ContentPlanning)).toEqual([
      EnterpriseLeadAgentRole.SocialOperation,
      EnterpriseLeadAgentRole.SalesHandoff,
      EnterpriseLeadAgentRole.RiskReview,
      EnterpriseLeadAgentRole.ProjectSummary,
      EnterpriseLeadAgentRole.ProjectArchive,
    ]);
  });

  test('content planning default prompt asks whether to continue into video generation', () => {
    const contentPlanningAgent = buildDefaultEnterpriseLeadWorkspaceAgents([
      EnterpriseLeadAgentRole.ContentPlanning,
    ])[0];

    expect(contentPlanningAgent.overrides.systemPrompt).toContain('是否需要继续生成视频');
  });

  test('throws for unknown roles', () => {
    expect(() => getEnterpriseLeadAgentMetadata('unknown_role' as EnterpriseLeadAgentRole)).toThrow(
      'Unknown enterprise lead Agent role: unknown_role',
    );
    expect(() => getDownstreamAgentRoles('unknown_role' as EnterpriseLeadAgentRole)).toThrow(
      'Unknown enterprise lead Agent role: unknown_role',
    );
  });
});
