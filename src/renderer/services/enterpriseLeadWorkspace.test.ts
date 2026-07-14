import { afterEach, describe, expect, test, vi } from 'vitest';

import type { EnterpriseLeadWorkflowEvent } from '../../shared/enterpriseLeadWorkspace/types';
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

    const result = await enterpriseLeadWorkspaceService.updateWorkspaceAgents('workspace-1', [
      binding,
    ]);

    expect(updateWorkspaceAgents).toHaveBeenCalledWith('workspace-1', [binding]);
    expect(result?.workspaceAgents).toEqual([binding]);
  });

  test('queues document source processing through bridge', async () => {
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
      extractionSources: [
        {
          kind: 'file',
          label: '工厂资料',
          text: '主营精密五金加工。',
        },
      ],
      riskRules: [],
      enabledAgentRoles: [],
      workspaceAgents: [],
      settings: buildDefaultEnterpriseLeadWorkspaceSettings(),
      recentRunId: null,
      createdAt: '2026-07-05T00:00:00.000Z',
      updatedAt: '2026-07-05T00:00:00.000Z',
    };
    const processDocumentSource = vi.fn(async () => ({
      success: true as const,
      data: workspace,
    }));
    createWindowWithEnterpriseLeadWorkspace({ processDocumentSource });

    const result = await enterpriseLeadWorkspaceService.processDocumentSource(
      'workspace-1',
      workspace.extractionSources,
      0,
    );

    expect(processDocumentSource).toHaveBeenCalledWith(
      'workspace-1',
      workspace.extractionSources,
      0,
    );
    expect(result?.extractionSources[0]?.label).toBe('工厂资料');
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

  test('filters workflow events by run and unsubscribes the preload listener', () => {
    let preloadListener: ((event: EnterpriseLeadWorkflowEvent) => void) | undefined;
    const unsubscribe = vi.fn();
    const onEvent = vi.fn((listener: (event: EnterpriseLeadWorkflowEvent) => void) => {
      preloadListener = listener;
      return unsubscribe;
    });
    const listener = vi.fn();
    createWindowWithEnterpriseLeadWorkspace({ onEvent });

    const stop = enterpriseLeadWorkspaceService.onWorkflowEvent('run-1', listener);
    preloadListener?.({
      runId: 'run-2',
      sequence: 1,
      type: 'task_started',
      payload: {},
      createdAt: '2026-07-14T00:00:00.000Z',
    });
    preloadListener?.({
      runId: 'run-1',
      sequence: 2,
      type: 'task_completed',
      payload: {},
      createdAt: '2026-07-14T00:00:01.000Z',
    });
    stop();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      runId: 'run-1',
      sequence: 2,
      type: 'task_completed',
      payload: {},
      createdAt: '2026-07-14T00:00:01.000Z',
    });
    expect(unsubscribe).toHaveBeenCalledOnce();
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
