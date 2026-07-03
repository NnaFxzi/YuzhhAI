import { afterEach, expect, test, vi } from 'vitest';

import { store } from '../store';
import { setSessions } from '../store/slices/coworkSlice';
import { CoworkSessionStatusValue, type CoworkSessionSummary } from '../types/cowork';
import { coworkService } from './cowork';

const makeSession = (id: string, agentId = 'main'): CoworkSessionSummary => ({
  id,
  title: id,
  status: CoworkSessionStatusValue.Completed,
  pinned: false,
  pinOrder: null,
  agentId,
  createdAt: 1,
  updatedAt: 1,
});

afterEach(() => {
  vi.unstubAllGlobals();
  store.dispatch(setSessions([]));
});

test('listRecentSessions fetches global sessions without replacing the Redux session list', async () => {
  const existingSession = makeSession('existing-session');
  const recentSession = makeSession('recent-agent-session', 'agent-1');
  const listSessions = vi.fn().mockResolvedValue({
    success: true,
    sessions: [recentSession],
    hasMore: false,
  });
  store.dispatch(setSessions([existingSession]));
  vi.stubGlobal('window', {
    electron: {
      cowork: {
        listSessions,
      },
    },
  });

  const result = await coworkService.listRecentSessions(6);

  expect(listSessions).toHaveBeenCalledWith({ limit: 6, offset: 0 });
  expect(result.sessions).toEqual([recentSession]);
  expect(store.getState().cowork.sessions).toEqual([existingSession]);
});
