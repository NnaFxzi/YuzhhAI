import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  CoworkWorkspaceAgentMode,
  type CoworkWorkspaceAgentSelection,
} from '../../shared/cowork/workspaceAgentSelection';
import { store } from '../store';
import { setCurrentSession, setStreaming } from '../store/slices/coworkSlice';
import { type CoworkSession, CoworkSessionStatusValue } from '../types/cowork';
import { coworkService } from './cowork';

const makeSession = (): CoworkSession => ({
  id: 'session-1',
  title: 'Session 1',
  claudeSessionId: null,
  status: CoworkSessionStatusValue.Running,
  pinned: false,
  pinOrder: null,
  cwd: '/tmp',
  systemPrompt: '',
  modelOverride: '',
  executionMode: 'local',
  activeSkillIds: [],
  agentId: 'main',
  messages: [],
  messagesOffset: 0,
  totalMessages: 0,
  createdAt: 1,
  updatedAt: 1,
});

const workspaceAgentSelection: CoworkWorkspaceAgentSelection = {
  workspaceId: 'workspace-1',
  mode: CoworkWorkspaceAgentMode.Manual,
  agentId: 'risk_review',
};

describe('coworkService workspace Agent team selection forwarding', () => {
  beforeEach(() => {
    store.dispatch(setCurrentSession(null));
    store.dispatch(setStreaming(false));
  });

  test('forwards workspace Agent selection when starting a session', async () => {
    const startSession = vi.fn().mockResolvedValue({
      success: true,
      session: makeSession(),
    });
    vi.stubGlobal('window', {
      electron: {
        cowork: {
          startSession,
        },
      },
      dispatchEvent: vi.fn(),
    });

    await coworkService.startSession({
      prompt: 'draft',
      workspaceAgentSelection,
    });

    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceAgentSelection,
      }),
    );
  });

  test('forwards workspace Agent selection when continuing a session', async () => {
    const continueSession = vi.fn().mockResolvedValue({
      success: true,
      session: makeSession(),
    });
    vi.stubGlobal('window', {
      electron: {
        cowork: {
          continueSession,
        },
      },
      dispatchEvent: vi.fn(),
    });

    await coworkService.continueSession({
      sessionId: 'session-1',
      prompt: 'next draft',
      workspaceAgentSelection,
    });

    expect(continueSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceAgentSelection,
      }),
    );
  });
});
