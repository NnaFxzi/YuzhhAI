import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

import {
  type MarketingRewriteAction,
  MarketingRewriteActionId,
} from './marketingRewriteActions';
import MarketingRewriteChips from './MarketingRewriteChips';

const actions: MarketingRewriteAction[] = [
  {
    id: MarketingRewriteActionId.OwnerTone,
    labelKey: 'marketingRewriteOwnerTone',
    prompt: 'owner prompt',
  },
  {
    id: MarketingRewriteActionId.WeChatGroupShort,
    labelKey: 'marketingRewriteWeChatGroupShort',
    prompt: 'group prompt',
  },
];

describe('MarketingRewriteChips', () => {
  test('renders no markup when there are no actions', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketingRewriteChips, {
        actions: [],
        onSelect: vi.fn(),
      }),
    );

    expect(html).toBe('');
  });

  test('shows pending feedback and disables chips while a rewrite is being submitted', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketingRewriteChips, {
        actions,
        onSelect: vi.fn(),
        pendingActionId: MarketingRewriteActionId.OwnerTone,
        disabled: true,
      }),
    );

    expect(html).toContain('正在改写');
    expect(html).toContain('disabled=""');
  });
});
