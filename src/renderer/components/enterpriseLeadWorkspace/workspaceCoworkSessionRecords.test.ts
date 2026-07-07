import { describe, expect, test } from 'vitest';

import { CoworkSessionStatusValue, type CoworkSessionSummary } from '../../types/cowork';
import {
  mapCoworkSessionsToWorkspaceConversationRecords,
  type WorkspaceConversationRecord,
} from './workspaceCoworkSessionRecords';

const createCoworkSession = (
  overrides: Partial<CoworkSessionSummary> = {},
): CoworkSessionSummary => ({
  id: 'cowork-session-1',
  title: 'Cowork 获客对话',
  status: CoworkSessionStatusValue.Completed,
  pinned: false,
  pinOrder: null,
  agentId: 'main',
  parentSessionId: null,
  forkedAt: null,
  createdAt: Date.UTC(2026, 1, 1, 0, 0, 0),
  updatedAt: Date.UTC(2026, 1, 1, 0, 1, 0),
  ...overrides,
});

describe('mapCoworkSessionsToWorkspaceConversationRecords', () => {
  test('maps Cowork sessions into workspace sidebar conversation records', () => {
    const records: WorkspaceConversationRecord[] = mapCoworkSessionsToWorkspaceConversationRecords([
      createCoworkSession(),
    ]);

    expect(records).toEqual([
      {
        id: 'cowork-session-1',
        title: 'Cowork 获客对话',
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:01:00.000Z',
        messageCount: 0,
      },
    ]);
  });

  test('uses a fallback title for blank Cowork session titles', () => {
    const records = mapCoworkSessionsToWorkspaceConversationRecords([
      createCoworkSession({ title: '   ' }),
    ]);

    expect(records[0].title).toBe('新对话');
  });
});
