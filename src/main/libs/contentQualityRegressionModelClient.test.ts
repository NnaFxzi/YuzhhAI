import { describe, expect, test, vi } from 'vitest';

import { createContentQualityRegressionModelClient } from './contentQualityRegressionModelClient';

describe('createContentQualityRegressionModelClient', () => {
  test('uses deterministic generation settings for evaluation prompts', async () => {
    const modelClient = {
      generate: vi.fn(async () => ({ text: 'ok' })),
    };
    const client = createContentQualityRegressionModelClient(modelClient);

    await expect(
      client.complete({
        prompt: 'evaluate this',
        purpose: 'evaluation',
        testCase: {
          id: 'case-1',
          category: 'wechat_moments',
          prompt: '帮我写一条朋友圈文案',
          targetChannel: '朋友圈',
          expectedOutput: '朋友圈正文',
          requiredSignals: [],
          forbiddenSignals: [],
        },
      }),
    ).resolves.toBe('ok');

    expect(modelClient.generate).toHaveBeenCalledWith({
      prompt: 'evaluate this',
      temperature: 0,
      maxTokens: 1800,
    });
  });

  test('uses a slightly warmer setting for content generation prompts', async () => {
    const modelClient = {
      generate: vi.fn(async () => ({ text: '朋友圈文案' })),
    };
    const client = createContentQualityRegressionModelClient(modelClient);

    await client.complete({
      prompt: 'generate this',
      purpose: 'generation',
      testCase: {
        id: 'case-2',
        category: 'sales_conversion',
        prompt: '客户说太贵了怎么回',
        targetChannel: '销售转化',
        expectedOutput: '销售话术',
        requiredSignals: [],
        forbiddenSignals: [],
      },
    });

    expect(modelClient.generate).toHaveBeenCalledWith({
      prompt: 'generate this',
      temperature: 0.35,
      maxTokens: 2600,
    });
  });
});
