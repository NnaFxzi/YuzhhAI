import { beforeEach, describe, expect, test, vi } from 'vitest';

const { registeredHandlers } = vi.hoisted(() => ({
  registeredHandlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

import { EnterpriseLeadWorkspaceIpc } from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceChatResponse,
} from '../../shared/enterpriseLeadWorkspace/types';
import {
  type EnterpriseLeadWorkspaceHandlerDeps,
  registerEnterpriseLeadWorkspaceHandlers,
} from './ipcHandlers';

const makeDeps = (): {
  deps: EnterpriseLeadWorkspaceHandlerDeps;
  service: EnterpriseLeadWorkspaceHandlerDeps['service'];
} => {
  const workspace = {
    id: 'workspace-1',
    workspaceAgents: [],
  } as EnterpriseLeadWorkspace;
  const chatResponse: EnterpriseLeadWorkspaceChatResponse = {
    message: {
      id: 'assistant-1',
      role: 'assistant',
      content: 'ok',
      createdAt: '2026-07-05T00:00:00.000Z',
    },
  };
  const service: EnterpriseLeadWorkspaceHandlerDeps['service'] = {
    listWorkspaces: vi.fn(() => []),
    getWorkspace: vi.fn(() => workspace),
    extractDraftFromConversation: vi.fn(),
    createWorkspace: vi.fn(() => workspace),
    deleteWorkspace: vi.fn(() => true),
    updateWorkspaceProfile: vi.fn(() => workspace),
    updateWorkspaceSettings: vi.fn(() => workspace),
    updateWorkspaceAgents: vi.fn(() => workspace),
    listRuns: vi.fn(() => []),
    chat: vi.fn(() => chatResponse),
    createRun: vi.fn(),
    getSnapshot: vi.fn(),
    runWorkflow: vi.fn(),
    runTask: vi.fn(),
    rerunTask: vi.fn(),
    createPendingVersionFromChat: vi.fn(),
    applyPendingVersion: vi.fn(),
    archiveRun: vi.fn(),
  };

  return {
    deps: { service },
    service,
  };
};

beforeEach(() => {
  registeredHandlers.clear();
});

describe('registerEnterpriseLeadWorkspaceHandlers', () => {
  test('rejects malformed workspace agent payloads', async () => {
    const { deps, service } = makeDeps();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.UpdateWorkspaceAgents);
    expect(handler).toBeDefined();

    const result = await handler?.(undefined, {
      workspaceId: 'workspace-1',
    });

    expect(service.updateWorkspaceAgents).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: 'Workspace agents are required',
    });
  });

  test('deletes a workspace through the workspace delete channel', async () => {
    const { deps, service } = makeDeps();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.DeleteWorkspace);
    expect(handler).toBeDefined();

    const result = await handler?.(undefined, 'workspace-1');

    expect(service.deleteWorkspace).toHaveBeenCalledWith('workspace-1');
    expect(result).toEqual({
      success: true,
      data: true,
    });
  });

  test('drops malformed recent chat messages before calling the service', async () => {
    const { deps, service } = makeDeps();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.Chat);
    expect(handler).toBeDefined();

    await handler?.(undefined, {
      workspaceId: 'workspace-1',
      request: {
        message: '帮我写一段跟进话术',
        recentMessages: [
          {
            id: 'user-1',
            role: 'user',
            content: '历史问题',
            createdAt: '2026-07-05T00:00:00.000Z',
            research: { summary: 'pass-through' },
          },
          {
            id: 'assistant-bad',
            role: 'system',
            content: 'bad role',
            createdAt: '2026-07-05T00:00:00.000Z',
          },
          {
            id: 'assistant-2',
            role: 'assistant',
            content: 42,
            createdAt: '2026-07-05T00:00:00.000Z',
          },
          'bad',
        ],
      },
    });

    expect(service.chat).toHaveBeenCalledWith('workspace-1', {
      message: '帮我写一段跟进话术',
      recentMessages: [
        {
          id: 'user-1',
          role: 'user',
          content: '历史问题',
          createdAt: '2026-07-05T00:00:00.000Z',
        },
      ],
    });
  });
});
