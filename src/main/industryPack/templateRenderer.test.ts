import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  IndustryPackChannel,
  IndustryPackId,
  IndustryPackTask,
} from '../../shared/industryPack/constants';
import { planGenerationItems } from './generationPlanner';
import { IndustryPackLoader, type LoadedIndustryPack } from './industryPackLoader';
import { renderIndustryPrompt } from './templateRenderer';

describe('industry prompt rendering', () => {
  const loader = new IndustryPackLoader({
    packsRoot: path.resolve(process.cwd(), 'resources/industry-packs'),
  });

  test('plans one item per channel for a today content package', () => {
    const items = planGenerationItems({
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentPackage,
      period: { kind: 'today', days: 1 },
      channels: [IndustryPackChannel.WechatMoments, IndustryPackChannel.Platform1688],
      themes: ['replace_wooden_box'],
      tone: 'boss',
      profile: { factoryName: '东莞重包包装厂' },
    });

    expect(items.map(item => item.channel)).toEqual([
      IndustryPackChannel.WechatMoments,
      IndustryPackChannel.Platform1688,
    ]);
  });

  test('expands calendar plans from the requested period days', () => {
    const items = planGenerationItems({
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentCalendar,
      period: { kind: 'custom', days: 3 },
      channels: [IndustryPackChannel.WechatMoments, IndustryPackChannel.WechatGroup],
      themes: ['replace_wooden_box', 'anti_damage'],
      tone: 'boss',
      profile: { factoryName: '东莞重包包装厂' },
    });

    expect(items).toHaveLength(6);
    expect(items.map(item => item.day)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  test('normalizes today plans to one day', () => {
    const items = planGenerationItems({
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentCalendar,
      period: { kind: 'today', days: 7 },
      channels: [IndustryPackChannel.WechatMoments, IndustryPackChannel.WechatGroup],
      themes: ['replace_wooden_box'],
      tone: 'boss',
      profile: { factoryName: '东莞重包包装厂' },
    });

    expect(items).toHaveLength(2);
    expect(items.map(item => item.day)).toEqual([1, 1]);
  });

  test('caps custom period plans to thirty days', () => {
    const items = planGenerationItems({
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentCalendar,
      period: { kind: 'custom', days: 45 },
      channels: [IndustryPackChannel.WechatMoments],
      themes: ['replace_wooden_box'],
      tone: 'boss',
      profile: { factoryName: '东莞重包包装厂' },
    });

    expect(items).toHaveLength(30);
    expect(items.at(-1)?.day).toBe(30);
  });

  test('renders prompt with selected channel rules and schema instruction', () => {
    const pack = loader.getPack(IndustryPackId.HeavyPackaging);
    const prompt = renderIndustryPrompt(pack, {
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentPackage,
      period: { kind: 'today', days: 1 },
      channels: [IndustryPackChannel.WechatMoments],
      themes: ['anti_damage'],
      tone: 'professional_sales',
      profile: {
        factoryName: '东莞重包包装厂',
        productTypes: ['重型瓦楞纸箱'],
      },
      supplementalText: '客户常运输 80kg 机械零部件。',
    });

    expect(prompt).toContain('东莞重包包装厂');
    expect(prompt).toContain('朋友圈规则');
    expect(prompt).toContain('80kg 机械零部件');
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('Return only JSON with an "assets" array');
  });

  test('renders calendar prompt with days output instruction', () => {
    const pack = loader.getPack(IndustryPackId.HeavyPackaging);
    const prompt = renderIndustryPrompt(pack, {
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentCalendar,
      period: { kind: 'custom', days: 3 },
      channels: [IndustryPackChannel.WechatMoments],
      themes: ['anti_damage'],
      tone: 'professional_sales',
      profile: {
        factoryName: '东莞重包包装厂',
        productTypes: ['重型瓦楞纸箱'],
      },
    });

    expect(prompt).toContain('Return only JSON with a "days" array');
    expect(prompt).toContain('daily item');
    expect(prompt).not.toContain('Return only JSON with an "assets" array');
  });

  test('renders channel asset prompt with single object instruction', () => {
    const pack = loader.getPack(IndustryPackId.HeavyPackaging);
    const channelAssetPack: LoadedIndustryPack = {
      ...pack,
      tasks: [
        {
          id: 'generate_channel_asset',
          name: '生成单渠道内容',
          outputSchema: 'channel-asset',
        },
      ],
    };
    const prompt = renderIndustryPrompt(channelAssetPack, {
      packId: IndustryPackId.HeavyPackaging,
      taskId: 'generate_channel_asset',
      period: { kind: 'today', days: 1 },
      channels: [IndustryPackChannel.WechatMoments],
      themes: ['anti_damage'],
      tone: 'professional_sales',
      profile: {
        factoryName: '东莞重包包装厂',
        productTypes: ['重型瓦楞纸箱'],
      },
    });

    expect(prompt).toContain('Return only JSON with a single top-level asset object');
    expect(prompt).not.toContain('Return only JSON with an "assets" array');
  });
});
