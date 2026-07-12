import { describe, expect, test } from 'vitest';

import { EnterpriseLeadAgentRole, EnterpriseLeadTaskStatus } from './constants';
import {
  parsePromotionTaskResult,
  type PromotionTaskResult,
} from './promotionTaskContracts';
import { PROMOTION_WORKFLOW_GRAPH } from './promotionWorkflowGraph';
import { normalizeWorkflowArtifactRef } from './workflowContracts';

const taskResult = (outputs: Record<string, unknown>): PromotionTaskResult => ({
  role: EnterpriseLeadAgentRole.PromotionDataScraping,
  status: EnterpriseLeadTaskStatus.Completed,
  summary: '处理完成',
  outputs,
  missingInfo: [],
  todos: [],
  risks: [],
  handoffContext: {},
  artifactRefs: [],
});

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

  test('requires source evidence for scraped items', () => {
    expect(() =>
      parsePromotionTaskResult(EnterpriseLeadAgentRole.PromotionDataScraping, {
        ...taskResult({
          items: [
            {
              sourceKind: 'search',
              title: '某公司',
              content: '有明确采购需求',
              capturedAt: '2026-07-12T00:00:00.000Z',
              confidence: 'high',
            },
          ],
        }),
      }),
    ).toThrow('sourceUrl');
  });

  test('normalizes data cleaning records and rejects non-array role outputs', () => {
    const result = parsePromotionTaskResult(EnterpriseLeadAgentRole.PromotionDataCleaning, {
      ...taskResult({
        records: [
          {
            id: 'lead-1',
            companyName: '某包装厂',
            industry: '机械制造',
            contactHint: '官网表单',
            fieldConfidence: { companyName: 'high', contactHint: 'low' },
          },
        ],
        duplicates: [],
        missingFields: ['联系人姓名'],
      }),
    });

    expect(result.outputs).toMatchObject({
      records: [{ id: 'lead-1', fieldConfidence: { contactHint: 'low' } }],
      duplicates: [],
      missingFields: ['联系人姓名'],
    });
    expect(() =>
      parsePromotionTaskResult(EnterpriseLeadAgentRole.PromotionDataCleaning, {
        ...taskResult({ records: {}, duplicates: [], missingFields: [] }),
      }),
    ).toThrow('records');
  });

  test('uses the requested role instead of a model-supplied envelope role', () => {
    const result = parsePromotionTaskResult(EnterpriseLeadAgentRole.PromotionDataCleaning, {
      ...taskResult({
        records: [
          {
            id: 'lead-1',
            companyName: '某包装厂',
            industry: '机械制造',
            contactHint: '',
            fieldConfidence: { companyName: 'high' },
          },
        ],
        duplicates: [],
        missingFields: [],
      }),
      role: EnterpriseLeadAgentRole.PromotionDataScraping,
    });

    expect(result.role).toBe(EnterpriseLeadAgentRole.PromotionDataCleaning);
  });

  test('validates lead scoring values and required actions', () => {
    const result = parsePromotionTaskResult(EnterpriseLeadAgentRole.PromotionLeadScoring, {
      ...taskResult({
        leads: [
          {
            id: 'lead-1',
            score: 88,
            tier: 'high',
            reasons: ['需求明确'],
            missingFields: [],
            nextAction: '人工确认联系人',
          },
        ],
      }),
    });

    expect(result.outputs).toMatchObject({ leads: [{ score: 88, tier: 'high' }] });
    expect(() =>
      parsePromotionTaskResult(EnterpriseLeadAgentRole.PromotionLeadScoring, {
        ...taskResult({
          leads: [
            { id: 'lead-1', score: 80, tier: 'high', reasons: [], missingFields: [] },
          ],
        }),
      }),
    ).toThrow('nextAction');
  });

  test('normalizes platform assets into draft-only deliverables', () => {
    const result = parsePromotionTaskResult(EnterpriseLeadAgentRole.PromotionMultiPlatformAssets, {
      ...taskResult({
        assets: [
          {
            platform: 'xiaohongshu',
            title: '标题',
            body: '正文',
            tags: ['包装'],
            callToAction: '咨询',
            manualReviewRequired: false,
          },
        ],
      }),
    });

    expect(result.outputs).toMatchObject({
      assets: [{ platform: 'xiaohongshu', manualReviewRequired: true }],
    });
    expect(() =>
      parsePromotionTaskResult(EnterpriseLeadAgentRole.PromotionMultiPlatformAssets, {
        ...taskResult({ assets: [{ title: '缺少平台', body: '正文', tags: [], callToAction: '咨询' }] }),
      }),
    ).toThrow('platform');
  });

  test('rejects invalid content quality risk levels and protects high-risk archives', () => {
    const result = parsePromotionTaskResult(EnterpriseLeadAgentRole.ContentQuality, {
      ...taskResult({
        riskLevel: 'high',
        blockingIssues: ['需要人工审核'],
        warnings: [],
        requiredRevisions: ['改成草稿表达'],
        canArchive: true,
      }),
    });

    expect(result.outputs).toMatchObject({ riskLevel: 'high', canArchive: false });
    expect(() =>
      parsePromotionTaskResult(EnterpriseLeadAgentRole.ContentQuality, {
        ...taskResult({
          riskLevel: 'urgent',
          blockingIssues: [],
          warnings: [],
          requiredRevisions: [],
          canArchive: false,
        }),
      }),
    ).toThrow('riskLevel');
  });

  test('requires monitoring arrays and safely downgrades invalid statuses', () => {
    const result = parsePromotionTaskResult(EnterpriseLeadAgentRole.PromotionAccountMonitoring, {
      ...taskResult({
        metrics: [{ channel: 'xiaohongshu', value: 42 }],
        anomalies: [],
        hypotheses: [],
        adjustmentActions: [],
      }),
      status: 'published',
    });

    expect(result.status).toBe(EnterpriseLeadTaskStatus.NeedsInput);
    expect(() =>
      parsePromotionTaskResult(EnterpriseLeadAgentRole.PromotionAccountMonitoring, {
        ...taskResult({ metrics: {}, anomalies: [], hypotheses: [], adjustmentActions: [] }),
      }),
    ).toThrow('metrics');
  });
});
