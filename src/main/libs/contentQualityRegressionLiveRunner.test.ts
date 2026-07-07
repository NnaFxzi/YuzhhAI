import { describe, expect, test } from 'vitest';

import {
  buildContentQualityGenerationPrompt,
  formatContentQualityRegressionReport,
  runContentQualityRegressionWithModel,
} from './contentQualityRegressionLiveRunner';
import { CONTENT_QUALITY_REGRESSION_CASES } from './contentQualityRegressionSuite';

describe('contentQualityRegressionLiveRunner', () => {
  test('runs generation and evaluation through model clients and returns a report', async () => {
    const cases = CONTENT_QUALITY_REGRESSION_CASES.slice(0, 2);
    const generationPrompts: string[] = [];
    const evaluationPrompts: string[] = [];

    const report = await runContentQualityRegressionWithModel({
      cases,
      generator: {
        complete: async ({ prompt }) => {
          generationPrompts.push(prompt);
          return prompt.includes('帮我写一条朋友圈文案')
            ? '我们做重型纸箱、蜂窝箱、纸护角和纸托盘，可根据产品尺寸评估替代木箱方案。'
            : '肯定最低价，当天交货，所有设备都能用。';
        },
      },
      evaluator: {
        complete: async ({ prompt }) => {
          evaluationPrompts.push(prompt);
          return prompt.includes('当天交货')
            ? JSON.stringify({
                scores: {
                  channel_fit: 6,
                  factory_profile_reuse: 5,
                  human_voice: 5,
                  conversion_action: 3,
                  factual_boundaries: 2,
                  specificity: 4,
                },
                shouldRewrite: true,
                reasons: ['硬承诺过多'],
                rewriteFocus: ['删除最低价和当天交货'],
              })
            : JSON.stringify({
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
        },
      },
    });

    expect(generationPrompts).toHaveLength(2);
    expect(generationPrompts[0]).toContain('已知工厂画像');
    expect(generationPrompts[0]).toContain(cases[0].prompt);
    expect(evaluationPrompts).toHaveLength(2);
    expect(evaluationPrompts[0]).toContain('内容质量回归评审');
    expect(report.total).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.rewriteCases[0].testCase.id).toBe(cases[1].id);
  });

  test('builds a realistic generation prompt for a single regression case', () => {
    const prompt = buildContentQualityGenerationPrompt(CONTENT_QUALITY_REGRESSION_CASES[0]);

    expect(prompt).toContain('已知工厂画像');
    expect(prompt).toContain('东莞重型包装工厂');
    expect(prompt).toContain('重型纸箱、蜂窝箱、纸护角、纸托盘');
    expect(prompt).toContain('不要编造载重、交期、认证、价格、产能、服务区域');
    expect(prompt).toContain('帮我写一条朋友圈文案');
  });

  test('formats a compact markdown report with failed cases and rewrite focus', async () => {
    const report = await runContentQualityRegressionWithModel({
      cases: CONTENT_QUALITY_REGRESSION_CASES.slice(0, 1),
      generator: {
        complete: async () => '所有包装当天出货，价格最低。',
      },
      evaluator: {
        complete: async () =>
          JSON.stringify({
            scores: {
              channel_fit: 5,
              factory_profile_reuse: 2,
              human_voice: 4,
              conversion_action: 3,
              factual_boundaries: 1,
              specificity: 2,
            },
            shouldRewrite: true,
            reasons: ['编造交期和价格'],
            rewriteFocus: ['改成可评估表达'],
          }),
      },
    });

    const markdown = formatContentQualityRegressionReport(report);

    expect(markdown).toContain('# 内容质量回归报告');
    expect(markdown).toContain('总样本：1');
    expect(markdown).toContain('通过率：0%');
    expect(markdown).toContain('moments-single-heavy-packaging');
    expect(markdown).toContain('编造交期和价格');
    expect(markdown).toContain('改成可评估表达');
  });

  test('formats actionable repair priorities grouped by failed dimensions', async () => {
    const report = await runContentQualityRegressionWithModel({
      cases: CONTENT_QUALITY_REGRESSION_CASES.slice(0, 2),
      generator: {
        complete: async ({ testCase }) =>
          testCase.id === 'moments-single-heavy-packaging'
            ? '所有包装当天出货，价格最低。'
            : '我们可以做包装。',
      },
      evaluator: {
        complete: async ({ testCase }) =>
          JSON.stringify({
            scores:
              testCase.id === 'moments-single-heavy-packaging'
                ? {
                    channel_fit: 7,
                    factory_profile_reuse: 7,
                    human_voice: 6,
                    conversion_action: 4,
                    factual_boundaries: 1,
                    specificity: 3,
                  }
                : {
                    channel_fit: 8,
                    factory_profile_reuse: 4,
                    human_voice: 5,
                    conversion_action: 4,
                    factual_boundaries: 9,
                    specificity: 3,
                  },
            shouldRewrite: true,
            reasons: ['质量不达标'],
            rewriteFocus: ['补充工厂画像和行动引导'],
          }),
      },
    });

    const markdown = formatContentQualityRegressionReport(report);

    expect(markdown).toContain('## 修复优先级');
    expect(markdown).toContain('- 转化动作（conversion_action）：2 个样本低于及格线');
    expect(markdown).toContain('- 空泛程度（specificity）：2 个样本低于及格线');
    expect(markdown).toContain('- 工厂画像复用（factory_profile_reuse）：2 个样本低于及格线');
    expect(markdown).toContain('优先修复高频低分维度，再看单条样本的重写重点。');
  });

  test('formats repair suggestions that translate failed dimensions into prompt actions', async () => {
    const report = await runContentQualityRegressionWithModel({
      cases: CONTENT_QUALITY_REGRESSION_CASES.slice(0, 1),
      generator: {
        complete: async () => '所有包装当天出货，价格最低。',
      },
      evaluator: {
        complete: async () =>
          JSON.stringify({
            scores: {
              channel_fit: 8,
              factory_profile_reuse: 3,
              human_voice: 8,
              conversion_action: 4,
              factual_boundaries: 1,
              specificity: 8,
            },
            shouldRewrite: true,
            reasons: ['没有复用工厂画像，且编造硬承诺'],
            rewriteFocus: ['补充工厂画像，删除硬承诺，加入发尺寸评估'],
          }),
      },
    });

    const markdown = formatContentQualityRegressionReport(report);

    expect(markdown).toContain('## 修复建议');
    expect(markdown).toContain(
      '- 工厂画像复用：加强知识库命中内容注入，回答前必须复用已确认的产品、客户、卖点和禁用承诺。',
    );
    expect(markdown).toContain(
      '- 转化动作：在每条内容末尾加入自然行动引导，例如发尺寸、私聊评估、提供用途后判断方案。',
    );
    expect(markdown).toContain(
      '- 事实边界：继续压住硬承诺，禁止编造载重、交期、认证、价格、产能、服务区域和客户案例。',
    );
  });

  test('formats a copyable prompt patch from failed dimensions', async () => {
    const report = await runContentQualityRegressionWithModel({
      cases: CONTENT_QUALITY_REGRESSION_CASES.slice(0, 1),
      generator: {
        complete: async () => '我们是厂家，欢迎咨询。',
      },
      evaluator: {
        complete: async () =>
          JSON.stringify({
            scores: {
              channel_fit: 8,
              factory_profile_reuse: 3,
              human_voice: 8,
              conversion_action: 4,
              factual_boundaries: 9,
              specificity: 3,
            },
            shouldRewrite: true,
            reasons: ['缺少工厂画像、场景和行动引导'],
            rewriteFocus: ['补充产品客户卖点，加入发尺寸评估'],
          }),
      },
    });

    const markdown = formatContentQualityRegressionReport(report);

    expect(markdown).toContain('## Prompt Patch');
    expect(markdown).toContain('将下面内容追加到内容生产 Agent 的系统提示词或内容质量规则中：');
    expect(markdown).toContain('```text');
    expect(markdown).toContain('[内容质量修复补丁]');
    expect(markdown).toContain(
      '- 知识库/记忆命中工厂画像、产品、客户、卖点或禁用承诺时，必须先基于这些事实输出可用初稿；不得再说“没有记住具体情况”。',
    );
    expect(markdown).toContain(
      '- 结尾必须保留一个轻行动引导，只能使用“发尺寸/私聊评估/说明用途后判断方案”等保守动作。',
    );
    expect(markdown).toContain(
      '- 每次内容至少写出一个具体客户场景、运输痛点、产品结构或保守卖点，避免只写“品质好、服务好、欢迎咨询”。',
    );
  });
});
