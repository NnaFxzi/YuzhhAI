import { describe, expect, test } from 'vitest';

import { IndustryPackChannel, IndustryPackId, IndustryPackTask } from './constants';
import {
  normalizeGenerationRequest,
  validateGenerationRequest,
  validateIndustryPackManifest,
} from './validation';

describe('industry pack validation', () => {
  test('accepts a valid heavy packaging manifest', () => {
    const result = validateIndustryPackManifest({
      id: IndustryPackId.HeavyPackaging,
      name: '重型包装获客内容包',
      version: '1.0.0',
      category: 'manufacturing-marketing',
      description: '用于工业包装企业的国内推广内容生成。',
      locale: 'zh-CN',
      entryTasks: [IndustryPackTask.GenerateContentPackage],
      supportedChannels: [IndustryPackChannel.WechatMoments],
      supportedThemes: ['replace_wooden_box'],
      supportedTones: ['boss'],
      defaultOutputSchemas: ['content-package'],
    });

    expect(result.ok).toBe(true);
  });

  test('rejects a manifest without an id', () => {
    const result = validateIndustryPackManifest({
      name: 'Broken pack',
      version: '1.0.0',
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('manifest.id is required');
  });

  test('rejects manifests missing required text and list fields', () => {
    const result = validateIndustryPackManifest({
      id: IndustryPackId.HeavyPackaging,
      name: 'Broken pack',
      version: '1.0.0',
      entryTasks: [IndustryPackTask.GenerateContentPackage],
      supportedChannels: [IndustryPackChannel.WechatMoments],
      supportedThemes: [''],
      supportedTones: [],
      defaultOutputSchemas: ['content-package'],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      'manifest.category is required',
      'manifest.description is required',
      'manifest.locale is required',
      'manifest.supportedThemes must contain only non-empty strings',
      'manifest.supportedTones must include at least one value',
    ]);
  });

  test('rejects manifest arrays with empty or non-string items', () => {
    const result = validateIndustryPackManifest({
      id: IndustryPackId.HeavyPackaging,
      name: 'Broken pack',
      version: '1.0.0',
      category: 'manufacturing-marketing',
      description: '用于工业包装企业的国内推广内容生成。',
      locale: 'zh-CN',
      entryTasks: [IndustryPackTask.GenerateContentPackage],
      supportedChannels: [IndustryPackChannel.WechatMoments, ''],
      supportedThemes: ['anti_damage', 123],
      supportedTones: ['boss'],
      defaultOutputSchemas: ['content-package'],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      'manifest.supportedChannels must contain only non-empty strings',
      'manifest.supportedThemes must contain only non-empty strings',
    ]);
  });

  test('validates a generation request', () => {
    const result = validateGenerationRequest({
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentCalendar,
      period: { kind: 'preset', days: 7 },
      channels: [IndustryPackChannel.WechatMoments],
      themes: ['anti_damage'],
      tone: 'boss',
      profile: { factoryName: '东莞重包包装厂' },
    });

    expect(result.ok).toBe(true);
  });

  test('rejects malformed generation request period and lists', () => {
    const result = validateGenerationRequest({
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentCalendar,
      period: { kind: 'quarter', days: 0 },
      channels: [''],
      themes: [],
      tone: 'boss',
      profile: { factoryName: '东莞重包包装厂' },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'request.period.kind must be today, preset, or custom',
      'request.period.days must be at least 1',
      'request.channels must contain only non-empty strings',
      'request.themes must include at least one theme',
    ]));
    expect(result.errors).toHaveLength(4);
  });

  test('rejects non-string optional generation request fields before normalization', () => {
    const request = {
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentCalendar,
      period: { kind: 'custom', days: 7 },
      channels: [IndustryPackChannel.WechatMoments],
      themes: ['anti_damage'],
      tone: 'boss',
      profile: { factoryName: '东莞重包包装厂' },
      supplementalText: 123,
    };

    const result = validateGenerationRequest(request);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['request.supplementalText must be a string']);
  });

  test('normalizes custom period bounds', () => {
    const normalized = normalizeGenerationRequest({
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentCalendar,
      period: { kind: 'custom', days: 45 },
      channels: [IndustryPackChannel.WechatMoments],
      themes: ['anti_damage'],
      tone: 'boss',
      profile: { factoryName: '东莞重包包装厂' },
    });

    expect(normalized.period).toEqual({ kind: 'custom', days: 30 });
  });
});
