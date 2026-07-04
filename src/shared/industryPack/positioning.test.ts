import { describe, expect, test } from 'vitest';

import { IndustryPackId } from './constants';
import {
  normalizePositioningReportInput,
  PositioningConfidence,
  PositioningResearchLane,
  PositioningScoreFactor,
  validatePositioningReportInput,
} from './positioning';

describe('positioning report validation', () => {
  test('normalizes a valid positioning report input', () => {
    const normalized = normalizePositioningReportInput({
      packId: IndustryPackId.HeavyPackaging,
      agentId: 'marketing',
      requestedBy: 'agent',
      recommendedDirectionId: 'wooden_box_replacement',
      providerAvailability: { tavily: true, firecrawl: false },
      sourceCounts: { searchResults: 5, extractedPages: 2 },
      sourceSummary: {
        lanes: [
          {
            lane: PositioningResearchLane.Search,
            confidence: PositioningConfidence.High,
            summary: '客户主动搜索替代木箱和出口免熏蒸包装。',
            keywords: ['替代木箱', '出口免熏蒸'],
            painPoints: ['木箱成本高', '出口熏蒸麻烦'],
            competitorSignals: [],
            opportunitySignals: ['方案型表达少'],
          },
        ],
      },
      candidates: [
        {
          id: 'wooden_box_replacement',
          name: '替代木箱包装',
          summary: '适合出口重货和项目制发货客户。',
          scores: {
            [PositioningScoreFactor.MarketDemand]: {
              score: 5,
              reason: '搜索词有明确采购意图。',
            },
            [PositioningScoreFactor.CompetitiveOpportunity]: {
              score: 4,
              reason: '同行多讲产品参数，方案表达较少。',
            },
            [PositioningScoreFactor.FactoryFit]: {
              score: 4,
              reason: '工厂有重型纸箱和蜂窝箱能力。',
            },
            [PositioningScoreFactor.DealFeasibility]: {
              score: 4,
              reason: '客户可以直接提供尺寸重量询价。',
            },
            [PositioningScoreFactor.ContentExpansion]: {
              score: 5,
              reason: '可覆盖百度、1688、朋友圈和微信群。',
            },
          },
          keywords: ['替代木箱', '重型纸箱'],
          painPoints: ['木箱成本高'],
          competitorSignals: ['厂家直销', '可定制'],
          opportunitySignals: ['整体方案表达不足'],
          recommendedChannels: ['baidu_seo', '1688', 'wechat_moments'],
          missingFacts: ['真实客户案例'],
        },
      ],
      backupDirectionIds: ['honeycomb_carton'],
      nextActions: ['生成百度 SEO 文章', '生成朋友圈案例'],
    });

    expect(normalized.agentId).toBe('marketing');
    expect(normalized.providerAvailability).toEqual({ tavily: true, firecrawl: false });
    expect(normalized.sourceCounts).toEqual({ searchResults: 5, extractedPages: 2 });
    expect(normalized.candidates[0].totalScore).toBe(22);
    expect(normalized.candidates[0].confidence).toBe(PositioningConfidence.High);
    expect(normalized.backupDirectionIds).toEqual(['honeycomb_carton']);
  });

  test('defaults agent and provider metadata when older inputs omit it', () => {
    const normalized = normalizePositioningReportInput({
      packId: IndustryPackId.HeavyPackaging,
      requestedBy: 'agent',
      recommendedDirectionId: 'direction-1',
      sourceSummary: { lanes: [] },
      candidates: [
        {
          id: 'direction-1',
          name: '方向一',
          summary: '测试方向',
          scores: {},
          keywords: [],
          painPoints: [],
          competitorSignals: [],
          opportunitySignals: [],
          recommendedChannels: [],
          missingFacts: [],
        },
      ],
      backupDirectionIds: [],
      nextActions: [],
    });

    expect(normalized.agentId).toBe('main');
    expect(normalized.providerAvailability).toEqual({ tavily: false, firecrawl: false });
    expect(normalized.sourceCounts).toEqual({ searchResults: 0, extractedPages: 0 });
  });


  test('rejects missing recommended direction', () => {
    const result = validatePositioningReportInput({
      packId: IndustryPackId.HeavyPackaging,
      requestedBy: 'agent',
      recommendedDirectionId: 'missing',
      sourceSummary: { lanes: [] },
      candidates: [],
      backupDirectionIds: [],
      nextActions: [],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('recommendedDirectionId must match a candidate id');
  });

  test('rejects scores outside one to five', () => {
    const result = validatePositioningReportInput({
      packId: IndustryPackId.HeavyPackaging,
      requestedBy: 'agent',
      recommendedDirectionId: 'direction-1',
      sourceSummary: { lanes: [] },
      candidates: [
        {
          id: 'direction-1',
          name: '方向一',
          summary: '测试方向',
          scores: {
            [PositioningScoreFactor.MarketDemand]: {
              score: 6,
              reason: '错误分数',
            },
          },
          keywords: [],
          painPoints: [],
          competitorSignals: [],
          opportunitySignals: [],
          recommendedChannels: [],
          missingFacts: [],
        },
      ],
      backupDirectionIds: [],
      nextActions: [],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('candidate direction-1 score market_demand must be between 1 and 5');
  });
});
