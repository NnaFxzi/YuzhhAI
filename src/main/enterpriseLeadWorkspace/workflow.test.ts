import { describe, expect, test } from 'vitest';

import { EnterpriseLeadAgentRole } from '../../shared/enterpriseLeadWorkspace/constants';
import {
  ENTERPRISE_LEAD_AGENT_WORKFLOW,
  getDownstreamAgentRoles,
  getEnterpriseLeadAgentMetadata,
} from './workflow';

describe('enterprise lead agent workflow metadata', () => {
  test('keeps the fixed agent workflow role order', () => {
    expect(ENTERPRISE_LEAD_AGENT_WORKFLOW.map(agent => agent.role)).toEqual([
      EnterpriseLeadAgentRole.Controller,
      EnterpriseLeadAgentRole.ProductUnderstanding,
      EnterpriseLeadAgentRole.OpportunityRadar,
      EnterpriseLeadAgentRole.ContentPlanning,
      EnterpriseLeadAgentRole.SocialOperation,
      EnterpriseLeadAgentRole.SalesHandoff,
      EnterpriseLeadAgentRole.RiskReview,
      EnterpriseLeadAgentRole.ProjectSummary,
      EnterpriseLeadAgentRole.ProjectArchive,
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

  test('throws for unknown roles', () => {
    expect(() => getEnterpriseLeadAgentMetadata('unknown_role' as EnterpriseLeadAgentRole)).toThrow(
      'Unknown enterprise lead Agent role: unknown_role',
    );
    expect(() => getDownstreamAgentRoles('unknown_role' as EnterpriseLeadAgentRole)).toThrow(
      'Unknown enterprise lead Agent role: unknown_role',
    );
  });
});
