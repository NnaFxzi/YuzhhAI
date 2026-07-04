import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import {
  IndustryPackChannel,
  IndustryPackId,
  IndustryPackTask,
} from '../../shared/industryPack/constants';
import { ContentGenerationService } from './contentGenerationService';
import { IndustryPackLoader } from './industryPackLoader';
import { IndustryPackStore } from './industryPackStore';
import type { ModelClientAdapter } from './modelClientAdapter';
import { PositioningService } from './positioningService';

const createService = (
  modelClient: ModelClientAdapter,
): {
  db: Database.Database;
  service: ContentGenerationService;
  store: IndustryPackStore;
} => {
  const db = new Database(':memory:');
  const store = new IndustryPackStore(db);
  const loader = new IndustryPackLoader({
    packsRoot: path.resolve(process.cwd(), 'resources/industry-packs'),
  });
  const positioningService = new PositioningService({ store });

  return {
    db,
    service: new ContentGenerationService({
      loader,
      modelClient,
      store,
      positioningService,
    }),
    store,
  };
};

describe('ContentGenerationService', () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  test('persists generated channel assets from the model response', async () => {
    let prompt = '';
    const modelClient: ModelClientAdapter = {
      async generate(input) {
        prompt = input.prompt;

        return {
          text: JSON.stringify({
            assets: [
              {
                channel: IndustryPackChannel.WechatMoments,
                theme: 'anti_damage',
                title: '80kg 零部件运输，纸箱怎么减少破损',
                body: '先看重量、尺寸和运输距离，再选重型瓦楞结构和护角方案。',
                keywords: ['重型纸箱', '防破损'],
                cta: '发尺寸和重量，帮你评估包装结构。',
              },
              {
                channel: IndustryPackChannel.WechatGroup,
                theme: 'anti_damage',
                title: '重货发货前先确认这三点',
                body: '确认承重、堆码和装卸方式，能少走很多返工弯路。',
                keywords: ['重型包装', '物流防护'],
                cta: '把货物照片发来，给你一个初步建议。',
              },
            ],
          }),
        };
      },
    };
    const setup = createService(modelClient);
    db = setup.db;

    const result = await setup.service.generate({
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentPackage,
      period: { kind: 'today', days: 1 },
      channels: [IndustryPackChannel.WechatMoments, IndustryPackChannel.WechatGroup],
      themes: ['anti_damage'],
      tone: 'professional_sales',
      profile: {
        factoryName: '东莞重包包装厂',
        productTypes: ['重型瓦楞纸箱'],
      },
    });

    expect(prompt).toContain('东莞重包包装厂');
    expect(result.assets).toHaveLength(2);
    expect(result.workspace.packId).toBe(IndustryPackId.HeavyPackaging);
    expect(setup.store.listGeneratedAssets(result.workspace.id).map(asset => ({
      channel: asset.channel,
      title: asset.title,
      keywords: asset.keywords,
    }))).toEqual([
      {
        channel: IndustryPackChannel.WechatGroup,
        title: '重货发货前先确认这三点',
        keywords: ['重型包装', '物流防护'],
      },
      {
        channel: IndustryPackChannel.WechatMoments,
        title: '80kg 零部件运输，纸箱怎么减少破损',
        keywords: ['重型纸箱', '防破损'],
      },
    ]);
  });

  test('rejects invalid generation requests before calling the model', async () => {
    let callCount = 0;
    const setup = createService({
      async generate() {
        callCount += 1;
        return { text: '{"assets":[]}' };
      },
    });
    db = setup.db;

    await expect(setup.service.generate({
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentPackage,
      period: { kind: 'today', days: 1 },
      channels: [],
      themes: ['anti_damage'],
      tone: 'professional_sales',
      profile: { factoryName: '东莞重包包装厂' },
    })).rejects.toThrow('Invalid industry generation request: request.channels must include at least one channel');
    expect(callCount).toBe(0);
  });

  test('persists a top-level single asset model response', async () => {
    const setup = createService({
      async generate() {
        return {
          text: JSON.stringify({
            channel: IndustryPackChannel.WechatMoments,
            theme: 'anti_damage',
            title: '重型纸箱不是越厚越好',
            body: '关键是结构、承重和堆码场景匹配。',
            keywords: ['重型纸箱', '承重结构'],
            cta: '提供产品尺寸和重量，帮你初步判断。',
          }),
        };
      },
    });
    db = setup.db;

    const result = await setup.service.generate({
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentPackage,
      period: { kind: 'today', days: 1 },
      channels: [IndustryPackChannel.WechatMoments],
      themes: ['anti_damage'],
      tone: 'professional_sales',
      profile: { factoryName: '东莞重包包装厂' },
    });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].title).toBe('重型纸箱不是越厚越好');
  });

  test('rejects model assets outside the selected request channels', async () => {
    const setup = createService({
      async generate() {
        return {
          text: JSON.stringify({
            assets: [
              {
                channel: IndustryPackChannel.BaiduSeo,
                theme: 'anti_damage',
                title: '百度搜索内容',
                body: '这条内容不属于本次选择渠道。',
                keywords: ['重型纸箱'],
                cta: '咨询包装方案。',
              },
            ],
          }),
        };
      },
    });
    db = setup.db;

    await expect(setup.service.generate({
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentPackage,
      period: { kind: 'today', days: 1 },
      channels: [IndustryPackChannel.WechatMoments],
      themes: ['anti_damage'],
      tone: 'professional_sales',
      profile: { factoryName: '东莞重包包装厂' },
    })).rejects.toThrow('Invalid industry generation asset 0 channel "baidu_seo"');
  });

  test('throws a clear error for calendar responses that cannot be persisted as assets', async () => {
    const setup = createService({
      async generate() {
        return {
          text: JSON.stringify({
            days: [
              {
                dateOffset: 0,
                channel: IndustryPackChannel.WechatMoments,
                theme: 'anti_damage',
                title: '今日选题',
                brief: '讲重货运输破损原因。',
                cta: '咨询包装结构。',
              },
            ],
          }),
        };
      },
    });
    db = setup.db;

    await expect(setup.service.generate({
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentCalendar,
      period: { kind: 'today', days: 1 },
      channels: [IndustryPackChannel.WechatMoments],
      themes: ['anti_damage'],
      tone: 'professional_sales',
      profile: { factoryName: '东莞重包包装厂' },
    })).rejects.toThrow('Calendar generation responses are not supported for asset persistence yet');
  });

  test('includes saved positioning context in later generation prompts', async () => {
    let prompt = '';
    const setup = createService({
      async generate(input) {
        prompt = input.prompt;
        return {
          text: JSON.stringify({
            channel: IndustryPackChannel.WechatMoments,
            theme: 'replace_wooden_box',
            title: '替代木箱包装怎么选',
            body: '先看出口、重量和运输线路。',
            keywords: ['替代木箱'],
            cta: '发尺寸重量，帮你评估。',
          }),
        };
      },
    });
    db = setup.db;
    setup.store.createPositioningReport({
      packId: IndustryPackId.HeavyPackaging,
      requestedBy: 'agent',
      recommendedDirectionId: 'wooden_box_replacement',
      sourceSummary: { lanes: [] },
      candidates: [
        {
          id: 'wooden_box_replacement',
          name: '替代木箱包装',
          summary: '适合出口重货。',
          scores: {},
          keywords: ['替代木箱'],
          painPoints: ['木箱成本高'],
          competitorSignals: [],
          opportunitySignals: ['整体方案表达不足'],
          recommendedChannels: ['baidu_seo'],
          missingFacts: [],
        },
      ],
      backupDirectionIds: [],
      nextActions: [],
    });

    await setup.service.generate({
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentPackage,
      period: { kind: 'today', days: 1 },
      channels: [IndustryPackChannel.WechatMoments],
      themes: ['replace_wooden_box'],
      tone: 'professional_sales',
      profile: { factoryName: '东莞重包包装厂' },
    });

    expect(prompt).toContain('已保存的产品定位分析');
    expect(prompt).toContain('推荐主推方向：替代木箱包装');
  });
});
