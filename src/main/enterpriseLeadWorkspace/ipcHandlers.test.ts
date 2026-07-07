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
  EnterpriseLeadWorkspaceAgentCalibrationResponse,
  EnterpriseLeadWorkspaceChatProgressEvent,
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
  const calibrationResponse: EnterpriseLeadWorkspaceAgentCalibrationResponse = {
    content: '客户优先级：高',
    checks: [{ id: 'priority', passed: true }],
  };
  const service: EnterpriseLeadWorkspaceHandlerDeps['service'] = {
    listWorkspaces: vi.fn(() => []),
    getWorkspace: vi.fn(() => workspace),
    extractDraftFromConversation: vi.fn(),
    createWorkspace: vi.fn(() => workspace),
    deleteWorkspace: vi.fn(() => true),
    updateWorkspaceProfile: vi.fn(() => workspace),
    updateWorkspaceSources: vi.fn(() => workspace),
    updateWorkspaceSettings: vi.fn(() => workspace),
    updateWorkspaceAgents: vi.fn(() => workspace),
    listRuns: vi.fn(() => []),
    listChatSessions: vi.fn(() => []),
    getChatSession: vi.fn(() => null),
    deleteChatSession: vi.fn(() => true),
    chat: vi.fn(() => chatResponse),
    testWorkspaceAgent: vi.fn(() => calibrationResponse),
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

  test('deletes a workspace chat session through the chat session delete channel', async () => {
    const { deps, service } = makeDeps();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.DeleteChatSession);
    expect(handler).toBeDefined();

    const result = await handler?.(undefined, {
      workspaceId: 'workspace-1',
      sessionId: 'chat-1',
    });

    expect(service.deleteChatSession).toHaveBeenCalledWith('workspace-1', 'chat-1');
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

  test('forwards real chat progress events to the invoking renderer', async () => {
    const { deps, service } = makeDeps();
    const progressEvent: EnterpriseLeadWorkspaceChatProgressEvent = {
      requestId: 'request-1',
      stepId: 'routing',
      phase: 'routing',
      status: 'running',
      title: '正在分析任务和选择 Agent',
      timestamp: 1,
    };
    vi.mocked(service.chat).mockImplementation((_workspaceId, _request, progressSink) => {
      progressSink?.(progressEvent);
      return {
        message: {
          id: 'assistant-1',
          role: 'assistant',
          content: 'ok',
          createdAt: '2026-07-05T00:00:00.000Z',
        },
      };
    });
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.Chat);
    expect(handler).toBeDefined();

    const sender = { send: vi.fn() };
    const result = await handler?.(
      { sender },
      {
        workspaceId: 'workspace-1',
        request: {
          requestId: 'request-1',
          message: '帮我判断这批客户谁更值得优先跟进',
        },
      },
    );

    expect(service.chat).toHaveBeenCalledWith(
      'workspace-1',
      {
        requestId: 'request-1',
        message: '帮我判断这批客户谁更值得优先跟进',
      },
      expect.any(Function),
    );
    expect(sender.send).toHaveBeenCalledWith(
      EnterpriseLeadWorkspaceIpc.ChatProgress,
      progressEvent,
    );
    expect(result).toEqual({
      success: true,
      data: {
        message: {
          id: 'assistant-1',
          role: 'assistant',
          content: 'ok',
          createdAt: '2026-07-05T00:00:00.000Z',
        },
      },
    });
  });

  test('routes workspace Agent calibration requests through the test channel', async () => {
    const { deps, service } = makeDeps();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.TestWorkspaceAgent);
    expect(handler).toBeDefined();

    const request = {
      agentId: 'agent-opportunity',
      agent: {
        name: '商机雷达 Agent',
        description: '判断客户方向、采购信号、商机评分和跟进优先级。',
        identity: '',
        systemPrompt: '按固定结构输出。',
        icon: '商',
        model: '',
        skillIds: [],
      },
      example: {
        sampleInput: '客户来自汽车零部件行业。',
        expectedPriority: '高',
        expectedReason: '行业匹配。',
        expectedMissing: '目标价格。',
        expectedNextStep: '安排技术评估。',
      },
    };
    const result = await handler?.(undefined, {
      workspaceId: 'workspace-1',
      request,
    });

    expect(service.testWorkspaceAgent).toHaveBeenCalledWith('workspace-1', request);
    expect(result).toEqual({
      success: true,
      data: {
        content: '客户优先级：高',
        checks: [{ id: 'priority', passed: true }],
      },
    });
  });
});
