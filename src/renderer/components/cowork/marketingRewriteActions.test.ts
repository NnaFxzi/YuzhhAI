import { describe, expect, test } from 'vitest';

import {
  buildMarketingRewriteActions,
  MarketingRewriteActionId,
} from './marketingRewriteActions';

describe('buildMarketingRewriteActions', () => {
  test('returns no actions outside marketing-agent sessions', () => {
    const actions = buildMarketingRewriteActions({
      agentId: 'main',
      isBusy: false,
      latestAssistantContent: '朋友圈文案：正文',
    });

    expect(actions).toEqual([]);
  });

  test('returns no actions while a session is busy', () => {
    const actions = buildMarketingRewriteActions({
      agentId: 'marketing-agent',
      isBusy: true,
      latestAssistantContent: '朋友圈文案：正文',
    });

    expect(actions).toEqual([]);
  });

  test('returns no actions without assistant content to rewrite', () => {
    const actions = buildMarketingRewriteActions({
      agentId: 'marketing-agent',
      isBusy: false,
      latestAssistantContent: '   ',
    });

    expect(actions).toEqual([]);
  });

  test('builds focused rewrite prompts for the latest assistant output', () => {
    const actions = buildMarketingRewriteActions({
      agentId: 'marketing-agent',
      isBusy: false,
      latestAssistantContent: '朋友圈文案：正文',
    });

    expect(actions.map(action => action.id)).toEqual([
      MarketingRewriteActionId.OwnerTone,
      MarketingRewriteActionId.WeChatGroupShort,
      MarketingRewriteActionId.Alibaba1688Title,
      MarketingRewriteActionId.BaiduSeoLongForm,
    ]);
    expect(actions[0].prompt).toContain('基于你上一条输出');
    expect(actions[0].prompt).toContain('老板口吻');
    expect(actions[0].prompt).toContain('不要新增没有证据的硬事实');
  });
});
