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
  test.each(PROMOTION_WORKFLOW_GRAPH.map(node => node.role))(
    'rejects empty outputs for every promotion graph role: %s',
    role => {
      expect(() => parsePromotionTaskResult(role, { ...taskResult({}) })).toThrow();
    },
  );

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

  test.each([
    [EnterpriseLeadAgentRole.PromotionDataScraping, { items: [] }, 'items'],
    [
      EnterpriseLeadAgentRole.PromotionDataCleaning,
      { records: [], duplicates: [], missingFields: [] },
      'records',
    ],
    [EnterpriseLeadAgentRole.PromotionLeadScoring, { leads: [] }, 'leads'],
    [EnterpriseLeadAgentRole.PromotionMultiPlatformAssets, { assets: [] }, 'assets'],
    [
      EnterpriseLeadAgentRole.PromotionAccountMonitoring,
      { metrics: [], anomalies: [], hypotheses: [], adjustmentActions: [] },
      'metrics',
    ],
  ])('rejects empty primary deliverables for %s', (role, outputs, key) => {
    expect(() => parsePromotionTaskResult(role, { ...taskResult(outputs) })).toThrow(
      `${key} must not be empty`,
    );
  });

  test.each(['anomalies', 'hypotheses', 'adjustmentActions'])(
    'rejects empty monitoring %s',
    key => {
      expect(() =>
        parsePromotionTaskResult(EnterpriseLeadAgentRole.PromotionAccountMonitoring, {
          ...taskResult({
            metrics: [{}],
            anomalies: key === 'anomalies' ? [] : [{}],
            hypotheses: key === 'hypotheses' ? [] : ['暂无明确原因'],
            adjustmentActions: key === 'adjustmentActions' ? [] : ['人工确认数据'],
          }),
        }),
      ).toThrow(`${key} must not be empty`);
    },
  );

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

  test('requires structured product selling points in promotion contexts', () => {
    const result = parsePromotionTaskResult(EnterpriseLeadAgentRole.ProductSellingPoint, {
      ...taskResult({ sellingPoints: ['替代木箱，需人工确认客户适配性'] }),
    });

    expect(result.outputs).toEqual({ sellingPoints: ['替代木箱，需人工确认客户适配性'] });
    expect(() =>
      parsePromotionTaskResult(EnterpriseLeadAgentRole.ProductSellingPoint, {
        ...taskResult({ sellingPoints: 'not-an-array' }),
      }),
    ).toThrow('sellingPoints');
  });

  test('normalizes publishing and sales handoff results into review-required drafts', () => {
    const publishing = parsePromotionTaskResult(
      EnterpriseLeadAgentRole.PromotionPublishingSchedule,
      {
        ...taskResult({
          publicationDrafts: [
            {
              platform: 'xiaohongshu',
              scheduledFor: '2026-07-13T09:00:00.000Z',
              draftSummary: '人工审核后发布的产品卖点草稿。',
              manualReviewRequired: false,
              published: true,
            },
          ],
        }),
      },
    );
    const salesHandoff = parsePromotionTaskResult(EnterpriseLeadAgentRole.SalesHandoff, {
      ...taskResult({
        handoffDraft: {
          summary: '销售人工确认后跟进高意向线索。',
          followUpTasks: ['人工核验联系人后发送跟进草稿。'],
          manualReviewRequired: false,
          contacted: true,
        },
      }),
    });

    expect(publishing.outputs).toEqual({
      publicationDrafts: [
        {
          platform: 'xiaohongshu',
          scheduledFor: '2026-07-13T09:00:00.000Z',
          draftSummary: '人工审核后发布的产品卖点草稿。',
          manualReviewRequired: true,
        },
      ],
    });
    expect(salesHandoff.outputs).toEqual({
      handoffDraft: {
        summary: '销售人工确认后跟进高意向线索。',
        followUpTasks: ['人工核验联系人后发送跟进草稿。'],
        manualReviewRequired: true,
      },
    });
  });

  test('requires meaningful structured competitor insight outputs', () => {
    expect(() =>
      parsePromotionTaskResult(EnterpriseLeadAgentRole.PromotionCompetitorInsight, {
        ...taskResult({ competitorInsights: [] }),
      }),
    ).toThrow('competitorInsights');

    expect(
      parsePromotionTaskResult(EnterpriseLeadAgentRole.PromotionCompetitorInsight, {
        ...taskResult({
          competitorInsights: [
            {
              competitor: '竞品 A',
              finding: '官网强调交期保障。',
              implication: '需人工验证后调整卖点表达。',
            },
          ],
        }),
      }).outputs,
    ).toEqual({
      competitorInsights: [
        {
          competitor: '竞品 A',
          finding: '官网强调交期保障。',
          implication: '需人工验证后调整卖点表达。',
        },
      ],
    });
  });

  test.each([
    {
      role: EnterpriseLeadAgentRole.ProductSellingPoint,
      key: 'sellingPoints',
      outputs: { sellingPoints: [123] },
    },
    {
      role: EnterpriseLeadAgentRole.PromotionDataCleaning,
      key: 'duplicates',
      outputs: {
        records: [
          {
            id: 'lead-1',
            companyName: '某包装厂',
            industry: '机械制造',
            contactHint: '',
            fieldConfidence: { companyName: 'high' },
          },
        ],
        duplicates: [123],
        missingFields: [],
      },
    },
    {
      role: EnterpriseLeadAgentRole.PromotionLeadScoring,
      key: 'reasons',
      outputs: {
        leads: [
          {
            id: 'lead-1',
            score: 80,
            tier: 'high',
            reasons: [123],
            missingFields: [],
            nextAction: '人工确认联系人',
          },
        ],
      },
    },
    {
      role: EnterpriseLeadAgentRole.PromotionMultiPlatformAssets,
      key: 'tags',
      outputs: {
        assets: [
          {
            platform: 'xiaohongshu',
            title: '标题',
            body: '正文',
            tags: [123],
            callToAction: '咨询',
          },
        ],
      },
    },
    {
      role: EnterpriseLeadAgentRole.ContentQuality,
      key: 'requiredRevisions',
      outputs: {
        riskLevel: 'low',
        blockingIssues: [],
        warnings: [],
        requiredRevisions: [123],
        canArchive: true,
      },
    },
    {
      role: EnterpriseLeadAgentRole.PromotionAccountMonitoring,
      key: 'adjustmentActions',
      outputs: {
        metrics: [{}],
        anomalies: [{}],
        hypotheses: ['暂无明确原因'],
        adjustmentActions: [123],
      },
    },
  ])('rejects non-text elements in $key arrays for $role', ({ role, key, outputs }) => {
    expect(() => parsePromotionTaskResult(role, { ...taskResult(outputs) })).toThrow(
      `${key}[0]`,
    );
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
        anomalies: [{}],
        hypotheses: ['暂无明确原因'],
        adjustmentActions: ['人工确认数据'],
      }),
      status: 'published',
    });

    expect(result.status).toBe(EnterpriseLeadTaskStatus.NeedsInput);
    expect(() =>
      parsePromotionTaskResult(EnterpriseLeadAgentRole.PromotionAccountMonitoring, {
          ...taskResult({ metrics: {}, anomalies: [{}], hypotheses: ['暂无明确原因'], adjustmentActions: ['人工确认数据'] }),
      }),
    ).toThrow('metrics');
  });
});
