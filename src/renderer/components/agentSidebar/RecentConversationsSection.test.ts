import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

import { CoworkSessionStatusValue, type CoworkSessionSummary } from '../../types/cowork';
import { RecentConversationRow } from './RecentConversationsSection';

const makeSession = (status: CoworkSessionSummary['status']): CoworkSessionSummary => ({
  id: `session-${status}`,
  title: `${status} session`,
  status,
  pinned: false,
  pinOrder: null,
  agentId: 'main',
  createdAt: 1,
  updatedAt: 1,
});

describe('RecentConversationRow', () => {
  test('shows the in-conversation status only for running sessions', () => {
    const runningHtml = renderToStaticMarkup(
      React.createElement(RecentConversationRow, {
        session: makeSession(CoworkSessionStatusValue.Running),
        isActive: false,
        agentBadge: null,
        onSelect: vi.fn(),
        onRequestDelete: vi.fn(),
      }),
    );
    const completedHtml = renderToStaticMarkup(
      React.createElement(RecentConversationRow, {
        session: makeSession(CoworkSessionStatusValue.Completed),
        isActive: false,
        agentBadge: null,
        onSelect: vi.fn(),
        onRequestDelete: vi.fn(),
      }),
    );

    expect(runningHtml).toContain('对话中');
    expect(completedHtml).not.toContain('对话中');
  });
});
