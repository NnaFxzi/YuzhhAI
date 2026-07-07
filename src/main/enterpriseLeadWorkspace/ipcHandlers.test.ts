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
    enqueueWorkspaceDocumentProcessing: vi.fn(() => workspace),
    updateWorkspaceSettings: vi.fn(() => workspace),
    updateWorkspaceAgents: vi.fn(() => workspace),
    listRuns: vi.fn(() => []),
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

  test('queues workspace document processing through the document process channel', async () => {
    const { deps, service } = makeDeps();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.ProcessDocumentSource);
    expect(handler).toBeDefined();

    const sources = [
      {
        kind: 'file',
        label: '工厂资料',
        text: '主营精密五金加工。',
      },
    ];
    const result = await handler?.(undefined, {
      workspaceId: 'workspace-1',
      sources,
      sourceIndex: 0,
    });

    expect(service.enqueueWorkspaceDocumentProcessing).toHaveBeenCalledWith(
      'workspace-1',
      [expect.objectContaining(sources[0])],
      0,
    );
    expect(result).toEqual({
      success: true,
      data: {
        id: 'workspace-1',
        workspaceAgents: [],
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
