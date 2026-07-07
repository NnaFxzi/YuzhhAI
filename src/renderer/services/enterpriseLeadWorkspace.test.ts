import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  EnterpriseLeadChatProgressPhase,
  EnterpriseLeadChatProgressStatus,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type { EnterpriseLeadWorkspaceChatProgressEvent } from '../../shared/enterpriseLeadWorkspace/types';
import { buildDefaultEnterpriseLeadWorkspaceSettings } from '../../shared/enterpriseLeadWorkspace/validation';
import { enterpriseLeadWorkspaceService } from './enterpriseLeadWorkspace';

const createWindowWithEnterpriseLeadWorkspace = (
  api: Partial<Window['electron']['enterpriseLeadWorkspace']>,
): void => {
  vi.stubGlobal('window', {
    electron: {
      enterpriseLeadWorkspace: api,
    },
  });
};

describe('enterpriseLeadWorkspaceService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('propagates historical workspace list failures', async () => {
    createWindowWithEnterpriseLeadWorkspace({
      listWorkspaces: async () => ({
        success: false,
        error: 'database unavailable',
      }),
    });

    await expect(enterpriseLeadWorkspaceService.listWorkspaces()).rejects.toThrow(
      'database unavailable',
    );
  });

  test('saves workspace settings through the enterprise lead workspace API', async () => {
    const updateWorkspaceSettings = vi.fn(async () => ({
      success: true as const,
    }));
    createWindowWithEnterpriseLeadWorkspace({ updateWorkspaceSettings });

    await enterpriseLeadWorkspaceService.updateWorkspaceSettings('workspace-1', {
      enabledAgentRoles: ['content_planning'],
      settings: {
        model: {
          defaultModel: 'gpt-4.1',
          defaultModelProvider: 'openai',
          providers: {
            openai: {
              enabled: true,
              apiKey: 'sk-workspace',
              baseUrl: 'https://api.openai.com/v1',
              apiFormat: 'openai',
              models: [{ id: 'gpt-4.1', name: 'GPT-4.1' }],
            },
          },
        },
      },
    });

    expect(updateWorkspaceSettings).toHaveBeenCalledWith('workspace-1', {
      enabledAgentRoles: ['content_planning'],
      settings: {
        model: {
          defaultModel: 'gpt-4.1',
          defaultModelProvider: 'openai',
          providers: {
            openai: {
              enabled: true,
              apiKey: 'sk-workspace',
              baseUrl: 'https://api.openai.com/v1',
              apiFormat: 'openai',
              models: [{ id: 'gpt-4.1', name: 'GPT-4.1' }],
            },
          },
        },
      },
    });
  });

  test('updates workspace agent bindings through bridge', async () => {
    const binding = {
      agentId: 'agent-a',
      enabled: true,
      order: 0,
      overrides: { name: 'Workspace Writer' },
    };
    const workspace = {
      id: 'workspace-1',
      name: 'Workspace 1',
      type: 'enterprise_lead',
      profile: {
        companySummary: '',
        productList: [],
        productCapabilities: [],
        targetCustomers: [],
        applicationScenarios: [],
        sellingPoints: [],
        channelPreferences: [],
        prohibitedClaims: [],
        contactRules: [],
        missingInfo: [],
      },
      extractionSources: [],
      riskRules: [],
      enabledAgentRoles: [],
      workspaceAgents: [binding],
      settings: buildDefaultEnterpriseLeadWorkspaceSettings(),
      recentRunId: null,
      createdAt: '2026-07-05T00:00:00.000Z',
      updatedAt: '2026-07-05T00:00:00.000Z',
    };
    const updateWorkspaceAgents = vi.fn(async () => ({
      success: true as const,
      data: workspace,
    }));
    createWindowWithEnterpriseLeadWorkspace({ updateWorkspaceAgents });

    const result = await enterpriseLeadWorkspaceService.updateWorkspaceAgents('workspace-1', [binding]);

    expect(updateWorkspaceAgents).toHaveBeenCalledWith('workspace-1', [binding]);
    expect(result?.workspaceAgents).toEqual([binding]);
  });

  test('deletes a workspace through bridge', async () => {
    const deleteWorkspace = vi.fn(async () => ({
      success: true as const,
      data: true,
    }));
    createWindowWithEnterpriseLeadWorkspace({ deleteWorkspace });

    const result = await enterpriseLeadWorkspaceService.deleteWorkspace('workspace-1');

    expect(deleteWorkspace).toHaveBeenCalledWith('workspace-1');
    expect(result).toBe(true);
  });

  test('lists workspace runs through bridge', async () => {
    const listRuns = vi.fn(async () => ({
      success: true as const,
      data: [],
    }));
    createWindowWithEnterpriseLeadWorkspace({ listRuns });

    const result = await enterpriseLeadWorkspaceService.listRuns('workspace-1');

    expect(listRuns).toHaveBeenCalledWith('workspace-1');
    expect(result).toEqual([]);
  });

  test('lists workspace chat sessions through bridge', async () => {
    const listChatSessions = vi.fn(async () => ({
      success: true as const,
      data: [
        {
          id: 'chat-1',
          workspaceId: 'workspace-1',
          title: '安装 oh-my-claudecode skill',
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-05T00:00:00.000Z',
          messageCount: 2,
        },
      ],
    }));
    createWindowWithEnterpriseLeadWorkspace({ listChatSessions });

    const result = await enterpriseLeadWorkspaceService.listChatSessions('workspace-1');

    expect(listChatSessions).toHaveBeenCalledWith('workspace-1');
    expect(result[0]?.title).toBe('安装 oh-my-claudecode skill');
  });

  test('loads a workspace chat session through bridge', async () => {
    const getChatSession = vi.fn(async () => ({
      success: true as const,
      data: {
        id: 'chat-1',
        workspaceId: 'workspace-1',
        title: '安装 oh-my-claudecode skill',
        createdAt: '2026-07-04T00:00:00.000Z',
        updatedAt: '2026-07-05T00:00:00.000Z',
        messageCount: 2,
        messages: [
          {
            id: 'user-1',
            role: 'user' as const,
            content: '安装 oh-my-claudecode skill',
            createdAt: '2026-07-04T00:00:00.000Z',
          },
        ],
      },
    }));
    createWindowWithEnterpriseLeadWorkspace({ getChatSession });

    const result = await enterpriseLeadWorkspaceService.getChatSession('workspace-1', 'chat-1');

    expect(getChatSession).toHaveBeenCalledWith('workspace-1', 'chat-1');
    expect(result?.messages[0]?.content).toBe('安装 oh-my-claudecode skill');
  });

  test('deletes a workspace chat session through bridge', async () => {
    const deleteChatSession = vi.fn(async () => ({
      success: true as const,
      data: true,
    }));
    createWindowWithEnterpriseLeadWorkspace({ deleteChatSession });

    const serviceWithDelete =
      enterpriseLeadWorkspaceService as typeof enterpriseLeadWorkspaceService & {
        deleteChatSession?: (workspaceId: string, sessionId: string) => Promise<boolean>;
      };
    expect(typeof serviceWithDelete.deleteChatSession).toBe('function');

    const result = await serviceWithDelete.deleteChatSession?.('workspace-1', 'chat-1');

    expect(deleteChatSession).toHaveBeenCalledWith('workspace-1', 'chat-1');
    expect(result).toBe(true);
  });

  test('sends workspace chat messages through bridge', async () => {
    const chat = vi.fn(async () => ({
      success: true as const,
      data: {
        message: {
          id: 'assistant-1',
          role: 'assistant' as const,
          content: '可以，这是基于当前空间资料的回答。',
          createdAt: '2026-07-05T00:00:00.000Z',
        },
      },
    }));
    createWindowWithEnterpriseLeadWorkspace({ chat });

    const result = await enterpriseLeadWorkspaceService.chat('workspace-1', {
      message: '帮我写一段跟进话术',
    });

    expect(chat).toHaveBeenCalledWith('workspace-1', { message: '帮我写一段跟进话术' });
    expect(result?.message.content).toContain('当前空间资料');
  });

  test('subscribes to workspace chat progress through bridge', () => {
    const cleanup = vi.fn();
    const callback = vi.fn();
    const onChatProgress = vi.fn(
      (_requestId: string, _callback: (event: EnterpriseLeadWorkspaceChatProgressEvent) => void) =>
        cleanup,
    );
    createWindowWithEnterpriseLeadWorkspace({ onChatProgress });

    const unsubscribe = enterpriseLeadWorkspaceService.onChatProgress('request-1', callback);
    const event = {
      requestId: 'request-1',
      stepId: 'routing',
      phase: EnterpriseLeadChatProgressPhase.Routing,
      status: EnterpriseLeadChatProgressStatus.Running,
      title: '正在分析任务和选择 Agent',
      timestamp: 1,
    };

    expect(onChatProgress).toHaveBeenCalledWith('request-1', callback);
    const registeredCallback = onChatProgress.mock.calls[0]?.[1];
    registeredCallback?.(event);
    expect(callback).toHaveBeenCalledWith(event);
    unsubscribe();
    expect(cleanup).toHaveBeenCalled();
  });

  test('tests workspace Agent drafts through bridge', async () => {
    const testWorkspaceAgent = vi.fn(async () => ({
      success: true as const,
      data: {
        content: '客户优先级：高',
        checks: [{ id: 'priority' as const, passed: true }],
      },
    }));
    createWindowWithEnterpriseLeadWorkspace({ testWorkspaceAgent });

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

    const result = await enterpriseLeadWorkspaceService.testWorkspaceAgent('workspace-1', request);

    expect(testWorkspaceAgent).toHaveBeenCalledWith('workspace-1', request);
    expect(result?.content).toContain('客户优先级');
  });
});
