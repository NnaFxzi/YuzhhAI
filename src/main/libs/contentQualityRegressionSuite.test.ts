import { describe, expect, test } from 'vitest';

import {
  buildContentQualityEvaluationPrompt,
  CONTENT_QUALITY_REGRESSION_CASES,
  CONTENT_QUALITY_SCORE_DIMENSIONS,
  getContentQualityRegressionCasesByCategory,
} from './contentQualityRegressionSuite';

describe('contentQualityRegressionSuite', () => {
  test('defines a 20-case regression set across the five priority content categories', () => {
    expect(CONTENT_QUALITY_REGRESSION_CASES).toHaveLength(20);

    const categories = new Set(CONTENT_QUALITY_REGRESSION_CASES.map(item => item.category));

    expect(categories).toEqual(
      new Set([
        'wechat_moments',
        'owner_tone_rewrite',
        'short_video_script',
        'private_domain_message',
        'sales_conversion',
      ]),
    );

    categories.forEach(category => {
      expect(getContentQualityRegressionCasesByCategory(category)).toHaveLength(4);
    });
  });

  test('uses the six agreed quality scoring dimensions with an 8-point pass threshold', () => {
    expect(CONTENT_QUALITY_SCORE_DIMENSIONS.map(dimension => dimension.id)).toEqual([
      'channel_fit',
      'factory_profile_reuse',
      'human_voice',
      'conversion_action',
      'factual_boundaries',
      'specificity',
    ]);

    expect(CONTENT_QUALITY_SCORE_DIMENSIONS.map(dimension => dimension.labelZh)).toEqual([
      '渠道适配',
      '工厂画像复用',
      '真人感',
      '转化动作',
      '事实边界',
      '空泛程度',
    ]);

    expect(CONTENT_QUALITY_SCORE_DIMENSIONS.every(dimension => dimension.passScore === 8)).toBe(
      true,
    );
  });

  test('includes real prompts that exercise remembered factory facts, rewrites, scripts, private-domain messages, and sales conversion', () => {
    const prompts = CONTENT_QUALITY_REGRESSION_CASES.map(item => item.prompt);

    expect(prompts).toContain('帮我写一条朋友圈文案');
    expect(prompts).toContain(
      '基于上一条输出，改写成老板口吻。保留原有工厂画像、产品、客户、卖点和渠道信息。不要新增没有证据的硬事实，不要编造载重、交期、认证、价格、产能、服务区域等信息。只输出可直接使用的改写结果，不要解释。',
    );
    expect(prompts).toContain('帮我写一个 30 秒短视频脚本，主题是替代木箱包装');
    expect(prompts).toContain('帮我写一条发到微信群里的重型包装获客话术');
    expect(prompts).toContain('客户问纸箱能不能代替木箱，帮我写一段销售回复');
  });

  test('builds a structured evaluator prompt that can drive the next automated quality gate', () => {
    const evaluationPrompt = buildContentQualityEvaluationPrompt({
      testCase: CONTENT_QUALITY_REGRESSION_CASES[0],
      modelOutput: '我们做重型纸箱、蜂窝箱、纸护角和纸托盘，可根据产品尺寸评估替代木箱包装方案。',
    });

    expect(evaluationPrompt).toContain('内容质量回归评审');
    expect(evaluationPrompt).toContain('只输出 JSON');
    expect(evaluationPrompt).toContain('"scores"');
    expect(evaluationPrompt).toContain('"shouldRewrite"');
    expect(evaluationPrompt).toContain('渠道适配');
    expect(evaluationPrompt).toContain('工厂画像复用');
    expect(evaluationPrompt).toContain('不要编造载重、交期、认证、价格、产能、服务区域');
    expect(evaluationPrompt).toContain('帮我写一条朋友圈文案');
  });
});
