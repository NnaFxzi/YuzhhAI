import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import { IndustryPackId } from '../../shared/industryPack/constants';
import { IndustryPackStore } from './industryPackStore';
import { PositioningService } from './positioningService';

describe('PositioningService', () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  test('saves a report and builds compact reusable context', () => {
    db = new Database(':memory:');
    const store = new IndustryPackStore(db);
    const service = new PositioningService({ store });

    const report = service.saveReport({
      packId: IndustryPackId.HeavyPackaging,
      agentId: 'marketing',
      requestedBy: 'agent',
      recommendedDirectionId: 'wooden_box_replacement',
      sourceSummary: { lanes: [] },
      candidates: [
        {
          id: 'wooden_box_replacement',
          name: '替代木箱包装',
          summary: '适合出口重货和项目制发货客户。',
          scores: {},
          keywords: ['替代木箱', '出口免熏蒸'],
          painPoints: ['木箱成本高', '出口熏蒸麻烦'],
          competitorSignals: ['厂家直销'],
          opportunitySignals: ['整体方案表达不足'],
          recommendedChannels: ['baidu_seo', '1688', 'wechat_moments'],
          missingFacts: ['真实客户案例'],
        },
      ],
      backupDirectionIds: [],
      nextActions: ['生成百度 SEO 文章'],
    });

    expect(report.recommendedDirectionId).toBe('wooden_box_replacement');
    expect(service.buildLatestPromptContext(IndustryPackId.HeavyPackaging, 'marketing')).toContain('替代木箱包装');
    expect(service.buildLatestPromptContext(IndustryPackId.HeavyPackaging, 'marketing')).toContain('出口免熏蒸');
    expect(service.buildLatestPromptContext(IndustryPackId.HeavyPackaging, 'content')).toBe('');
  });

  test('builds heavy-packaging baseline evidence when no positioning report exists', () => {
    db = new Database(':memory:');
    const store = new IndustryPackStore(db);
    const service = new PositioningService({ store });

    const payload = service.buildLatestToolPayload(IndustryPackId.HeavyPackaging, 'marketing');

    expect(payload.status).toBe('baseline');
    expect(payload.packId).toBe(IndustryPackId.HeavyPackaging);
    expect(payload.industryLabel).toBe('重包装/工业包装');
    expect(payload.message).toContain('No saved positioning report');
    expect(payload.baselineEvidence.join('\n')).toContain('重型包装获客内容包');
    expect(payload.baselineEvidence.join('\n')).toContain('重型瓦楞纸箱');
    expect(payload.baselineEvidence.join('\n')).toContain('蜂窝纸箱');
    expect(payload.baselineEvidence.join('\n')).toContain('替代木箱包装');
    expect(payload.answerGuidance).toContain('不要追问用户具体行业');
    expect(payload.answerGuidance).toContain('待验证');
  });
});
