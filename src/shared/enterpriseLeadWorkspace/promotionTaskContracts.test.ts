import { describe, expect, test } from 'vitest';

import { EnterpriseLeadAgentRole } from './constants';
import { PROMOTION_WORKFLOW_GRAPH } from './promotionWorkflowGraph';
import { normalizeWorkflowArtifactRef } from './workflowContracts';

describe('promotion workflow contracts', () => {
  test('keeps cleaning behind scraping and fans out insight tasks', () => {
    const cleaning = PROMOTION_WORKFLOW_GRAPH.find(
      node => node.role === EnterpriseLeadAgentRole.PromotionDataCleaning,
    );
    const insight = PROMOTION_WORKFLOW_GRAPH.find(
      node => node.role === EnterpriseLeadAgentRole.PromotionCompetitorInsight,
    );
    const scoring = PROMOTION_WORKFLOW_GRAPH.find(
      node => node.role === EnterpriseLeadAgentRole.PromotionLeadScoring,
    );

    expect(cleaning?.dependsOn).toEqual([
      EnterpriseLeadAgentRole.PromotionDataScraping,
    ]);
    expect(insight?.dependsOn).toEqual([
      EnterpriseLeadAgentRole.PromotionDataCleaning,
    ]);
    expect(scoring?.dependsOn).toEqual([
      EnterpriseLeadAgentRole.PromotionDataCleaning,
    ]);
  });

  test('rejects artifact references without an id and kind', () => {
    expect(normalizeWorkflowArtifactRef({ id: 'a' })).toBeNull();
    expect(normalizeWorkflowArtifactRef({ id: 'a', kind: 'clean_leads' })).toMatchObject({
      id: 'a',
      kind: 'clean_leads',
    });
  });
});
