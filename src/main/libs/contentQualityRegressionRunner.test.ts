import { describe, expect, test } from 'vitest';

import {
  parseContentQualityEvaluation,
  runContentQualityRegressionSuite,
} from './contentQualityRegressionRunner';
import {
  CONTENT_QUALITY_REGRESSION_CASES,
  ContentQualityRegressionCategory,
} from './contentQualityRegressionSuite';

describe('contentQualityRegressionRunner', () => {
  test('runs selected cases through generation, evaluator prompts, and aggregate scoring', async () => {
    const selectedCases = CONTENT_QUALITY_REGRESSION_CASES.filter(
      item =>
        item.category === ContentQualityRegressionCategory.WeChatMoments ||
        item.category === ContentQualityRegressionCategory.SalesConversion,
    ).slice(0, 2);

    const generationPrompts: string[] = [];
    const evaluationPrompts: string[] = [];

    const report = await runContentQualityRegressionSuite({
      cases: selectedCases,
      generateOutput: testCase => {
        generationPrompts.push(testCase.prompt);
        return testCase.id === 'moments-single-heavy-packaging'
          ? '我们做重型纸箱、蜂窝箱、纸护角和纸托盘，可根据产品尺寸评估替代木箱方案。'
          : '纸箱肯定能代替木箱，价格最低，今天下单明天交货。';
      },
      evaluateOutput: ({ evaluationPrompt, testCase }) => {
        evaluationPrompts.push(evaluationPrompt);
        if (testCase.id === 'moments-single-heavy-packaging') {
          return JSON.stringify({
            scores: {
              channel_fit: 9,
              factory_profile_reuse: 9,
              human_voice: 8,
              conversion_action: 8,
              factual_boundaries: 9,
              specificity: 8,
            },
            shouldRewrite: false,
            reasons: [],
            rewriteFocus: [],
          });
        }

        return JSON.stringify({
          scores: {
            channel_fit: 7,
            factory_profile_reuse: 4,
            human_voice: 5,
            conversion_action: 3,
            factual_boundaries: 2,
            specificity: 4,
          },
          shouldRewrite: true,
          reasons: ['硬承诺过多'],
          rewriteFocus: ['改成可评估表达'],
        });
      },
    });

    expect(generationPrompts).toEqual(selectedCases.map(testCase => testCase.prompt));
    expect(evaluationPrompts[0]).toContain('内容质量回归评审');
    expect(evaluationPrompts[0]).toContain(selectedCases[0].prompt);
    expect(evaluationPrompts[0]).toContain('可根据产品尺寸评估替代木箱方案');
    expect(report.total).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.passRate).toBe(0.5);
    expect(report.rewriteCases).toHaveLength(1);
    expect(report.rewriteCases[0].testCase.id).toBe(selectedCases[1].id);
    expect(report.rewriteCases[0].failedDimensions).toEqual([
      'channel_fit',
      'factory_profile_reuse',
      'human_voice',
      'conversion_action',
      'factual_boundaries',
      'specificity',
    ]);
  });

  test('parses evaluator JSON from fenced output and forces rewrite when any score is below the threshold', () => {
    const parsed = parseContentQualityEvaluation(
      [
        '```json',
        '{',
        '  "scores": {',
        '    "channel_fit": 9,',
        '    "factory_profile_reuse": 8,',
        '    "human_voice": 8,',
        '    "conversion_action": 8,',
        '    "factual_boundaries": 7,',
        '    "specificity": 8',
        '  },',
        '  "shouldRewrite": false,',
        '  "reasons": ["事实边界略弱"],',
        '  "rewriteFocus": ["降低确定性"]',
        '}',
        '```',
      ].join('\n'),
    );

    expect(parsed.shouldRewrite).toBe(true);
    expect(parsed.failedDimensions).toEqual(['factual_boundaries']);
    expect(parsed.scores.factual_boundaries).toBe(7);
    expect(parsed.reasons).toEqual(['事实边界略弱']);
    expect(parsed.rewriteFocus).toEqual(['降低确定性']);
  });
});
