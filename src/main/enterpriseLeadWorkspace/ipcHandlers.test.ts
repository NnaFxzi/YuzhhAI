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

import {
  EnterpriseLeadWorkflowIpc,
  EnterpriseLeadWorkspaceIpc,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadWorkflowEvent,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentCalibrationResponse,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../shared/enterpriseLeadWorkspace/types';
import type { WorkflowStartOptions } from '../../shared/enterpriseLeadWorkspace/workflowContracts';
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
    startWorkflow: vi.fn(),
    resumeRun: vi.fn(),
    cancelRun: vi.fn(),
    approveTask: vi.fn(),
    rejectTask: vi.fn(),
  };

  return {
    deps: {
      service,
      listWorkflowEvents: vi.fn(() => []),
      appendWorkflowEvent: vi.fn(),
    },
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

  test('rejects empty workflow workspace and run ids', async () => {
    const { deps, service } = makeDeps();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkflowIpc.Start);
    expect(handler).toBeDefined();

    const result = await handler?.({ sender: { send: vi.fn() } }, {
      workspaceId: ' ',
      runId: '',
      options: { enabledOptionalNodes: [], maxConcurrency: 1 },
    });

    expect(service.startWorkflow).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: 'Workspace id is required',
    });

    const missingRunResult = await handler?.({ sender: { send: vi.fn() } }, {
      workspaceId: 'workspace-1',
      runId: ' ',
      options: { enabledOptionalNodes: [], maxConcurrency: 1 },
    });

    expect(missingRunResult).toEqual({
      success: false,
      error: 'Run id is required',
    });
  });

  test('starts a workflow in the background and returns the current run snapshot', async () => {
    const { deps, service } = makeDeps();
    const snapshot = {
      workspace: { id: 'workspace-1' },
      currentRun: { id: 'run-1' },
      tasks: [],
      pendingVersions: [],
      deliverables: [],
      todos: [],
      archives: [],
    } as EnterpriseLeadWorkspaceSnapshot;
    const options: WorkflowStartOptions = { enabledOptionalNodes: [], maxConcurrency: 2 };
    service.getSnapshot = vi.fn(() => snapshot);
    service.startWorkflow = vi.fn(async () => snapshot);
    const listWorkflowEvents = vi.fn(() => [
      {
        runId: 'run-1',
        sequence: 1,
        type: 'run_started',
        payload: {},
        createdAt: '2026-07-12T00:00:00.000Z',
      } satisfies EnterpriseLeadWorkflowEvent,
    ]);
    deps.listWorkflowEvents = listWorkflowEvents;
    const send = vi.fn();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkflowIpc.Start);
    const result = await handler?.({ sender: { send } }, {
      workspaceId: 'workspace-1',
      runId: 'run-1',
      options,
    });
    await Promise.resolve();

    expect(result).toEqual({ success: true, data: snapshot });
    expect(service.startWorkflow).toHaveBeenCalledWith('workspace-1', 'run-1', options);
    expect(listWorkflowEvents).toHaveBeenCalledWith('run-1');
    expect(send).toHaveBeenCalledWith(
      EnterpriseLeadWorkflowIpc.Event,
      expect.objectContaining({ runId: 'run-1', type: 'run_started' }),
    );
  });

  test('dispatches cancel, approval, and rejection controls to the workflow service', async () => {
    const { deps, service } = makeDeps();
    const snapshot = {
      workspace: { id: 'workspace-1' },
      currentRun: { id: 'run-1' },
      tasks: [],
      pendingVersions: [],
      deliverables: [],
      todos: [],
      archives: [],
    } as EnterpriseLeadWorkspaceSnapshot;
    service.cancelRun = vi.fn(async () => snapshot);
    service.approveTask = vi.fn(async () => snapshot);
    service.rejectTask = vi.fn(async () => snapshot);
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const event = { sender: { send: vi.fn() } };
    const input = { workspaceId: 'workspace-1', runId: 'run-1', taskId: 'task-1' };

    await registeredHandlers.get(EnterpriseLeadWorkflowIpc.Cancel)?.(event, input);
    await registeredHandlers.get(EnterpriseLeadWorkflowIpc.ApproveTask)?.(event, input);
    await registeredHandlers.get(EnterpriseLeadWorkflowIpc.RejectTask)?.(event, input);

    expect(service.cancelRun).toHaveBeenCalledWith('workspace-1', 'run-1');
    expect(service.approveTask).toHaveBeenCalledWith('workspace-1', 'run-1', 'task-1');
    expect(service.rejectTask).toHaveBeenCalledWith('workspace-1', 'run-1', 'task-1');
  });

  test('persists and sends a run error when background workflow execution rejects', async () => {
    const { deps, service } = makeDeps();
    const snapshot = {
      workspace: { id: 'workspace-1' },
      currentRun: { id: 'run-1' },
      tasks: [],
      pendingVersions: [],
      deliverables: [],
      todos: [],
      archives: [],
    } as EnterpriseLeadWorkspaceSnapshot;
    const runErrorEvent = {
      runId: 'run-1',
      sequence: 2,
      type: 'run_error',
      summary: 'gateway unavailable',
      payload: {},
      createdAt: '2026-07-12T00:00:00.000Z',
    } satisfies EnterpriseLeadWorkflowEvent;
    service.getSnapshot = vi.fn(() => snapshot);
    service.startWorkflow = vi.fn(async () => {
      throw new Error('gateway unavailable');
    });
    deps.appendWorkflowEvent = vi.fn(() => runErrorEvent);
    const send = vi.fn();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkflowIpc.Start);
    await handler?.({ sender: { send } }, {
      workspaceId: 'workspace-1',
      runId: 'run-1',
      options: { enabledOptionalNodes: [], maxConcurrency: 1 },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.appendWorkflowEvent).toHaveBeenCalledWith({
      runId: 'run-1',
      type: 'run_error',
      summary: 'gateway unavailable',
    });
    expect(send).toHaveBeenCalledWith(EnterpriseLeadWorkflowIpc.Event, runErrorEvent);
  });
});
