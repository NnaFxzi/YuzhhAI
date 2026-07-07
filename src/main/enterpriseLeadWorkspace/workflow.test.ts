import { describe, expect, test } from 'vitest';

import { EnterpriseLeadAgentRole } from '../../shared/enterpriseLeadWorkspace/constants';
import {
  buildDefaultEnterpriseLeadWorkspaceAgents,
  ENTERPRISE_LEAD_AGENT_WORKFLOW,
  getDownstreamAgentRoles,
  getEnterpriseLeadAgentMetadata,
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
