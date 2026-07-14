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
  EnterpriseLeadRunStatus,
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
    markRunErrorOnce: vi.fn(),
    resumeRun: vi.fn(),
    cancelRun: vi.fn(),
    approveTask: vi.fn(),
    rejectTask: vi.fn(),
  };

  return {
    deps: {
      service,
      listWorkflowEvents: vi.fn(() => []),
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

  test('rejects workflow options outside the supported promotion graph and concurrency range', async () => {
    const { deps, service } = makeDeps();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkflowIpc.Start);
    const event = { sender: { send: vi.fn() } };

    const unsupportedNode = await handler?.(event, {
      workspaceId: 'workspace-1',
      runId: 'run-1',
      options: { enabledOptionalNodes: ['any_node'], maxConcurrency: 1 },
    });
    const fractionalConcurrency = await handler?.(event, {
      workspaceId: 'workspace-1',
      runId: 'run-1',
      options: { enabledOptionalNodes: [], maxConcurrency: 1.5 },
    });
    const excessiveConcurrency = await handler?.(event, {
      workspaceId: 'workspace-1',
      runId: 'run-1',
      options: { enabledOptionalNodes: [], maxConcurrency: 4 },
    });

    expect(unsupportedNode).toEqual({
      success: false,
      error: 'Workflow optional node is invalid',
    });
    expect(fractionalConcurrency).toEqual({
      success: false,
      error: 'Workflow max concurrency must be an integer from 1 to 3',
    });
    expect(excessiveConcurrency).toEqual({
      success: false,
      error: 'Workflow max concurrency must be an integer from 1 to 3',
    });
    expect(service.startWorkflow).not.toHaveBeenCalled();
  });

  test('streams each new workflow event before background execution settles', async () => {
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
    let resolveWorkflow: (() => void) | undefined;
    const events: EnterpriseLeadWorkflowEvent[] = [];
    service.startWorkflow = vi.fn(() => {
      events.push({
        runId: 'run-1',
        sequence: 1,
        type: 'run_started',
        payload: {},
        createdAt: '2026-07-12T00:00:00.000Z',
      });
      return new Promise<EnterpriseLeadWorkspaceSnapshot>(resolve => {
        resolveWorkflow = () => resolve(snapshot);
      });
    });
    const listWorkflowEvents = vi.fn(() => events);
    deps.listWorkflowEvents = listWorkflowEvents;
    const send = vi.fn();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkflowIpc.Start);
    const result = await handler?.({ sender: { send } }, {
      workspaceId: 'workspace-1',
      runId: 'run-1',
      options,
    });

    expect(result).toEqual({ success: true, data: snapshot });
    expect(service.startWorkflow).toHaveBeenCalledWith('workspace-1', 'run-1', options);
    expect(send).toHaveBeenCalledWith(
      EnterpriseLeadWorkflowIpc.Event,
      expect.objectContaining({ runId: 'run-1', type: 'run_started' }),
    );

    resolveWorkflow?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(send).toHaveBeenCalledTimes(1);
  });

  test('subscribes Resume to newly produced events before the resumed workflow settles', async () => {
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
    const events: EnterpriseLeadWorkflowEvent[] = [];
    let resolveWorkflow: (() => void) | undefined;
    service.getSnapshot = vi.fn(() => snapshot);
    service.resumeRun = vi.fn(() => {
      events.push({
        runId: 'run-1',
        sequence: 2,
        type: 'task_started',
        payload: {},
        createdAt: '2026-07-14T00:00:00.000Z',
      });
      return new Promise<EnterpriseLeadWorkspaceSnapshot>(resolve => {
        resolveWorkflow = () => resolve(snapshot);
      });
    });
    deps.listWorkflowEvents = vi.fn(() => events);
    const send = vi.fn();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkflowIpc.Resume);
    const response = handler?.({ sender: { send } }, {
      workspaceId: 'workspace-1',
      runId: 'run-1',
    });
    await Promise.resolve();

    expect(send).toHaveBeenCalledWith(
      EnterpriseLeadWorkflowIpc.Event,
      expect.objectContaining({ sequence: 2, type: 'task_started' }),
    );
    expect(await response).toEqual({ success: true, data: snapshot });

    resolveWorkflow?.();
  });

  test('rejects archived Start and Resume snapshots before opening workflow streams', async () => {
    const { deps, service } = makeDeps();
    const archivedSnapshot = {
      workspace: { id: 'workspace-1' },
      currentRun: {
        id: 'run-1',
        status: EnterpriseLeadRunStatus.Archived,
        archiveStatus: 'archived',
      },
      tasks: [],
      pendingVersions: [],
      deliverables: [],
      todos: [],
      archives: [],
    } as EnterpriseLeadWorkspaceSnapshot;
    service.getSnapshot = vi.fn(() => archivedSnapshot);
    const startSend = vi.fn();
    const resumeSend = vi.fn();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const start = await registeredHandlers.get(EnterpriseLeadWorkflowIpc.Start)?.(
      { sender: { send: startSend } },
      {
        workspaceId: 'workspace-1',
        runId: 'run-1',
        options: { enabledOptionalNodes: [], maxConcurrency: 1 },
      },
    );
    const resume = await registeredHandlers.get(EnterpriseLeadWorkflowIpc.Resume)?.(
      { sender: { send: resumeSend } },
      { workspaceId: 'workspace-1', runId: 'run-1' },
    );

    expect(start).toEqual({ success: false, error: 'Enterprise lead run is archived' });
    expect(resume).toEqual({ success: false, error: 'Enterprise lead run is archived' });
    expect(service.startWorkflow).not.toHaveBeenCalled();
    expect(service.resumeRun).not.toHaveBeenCalled();
    expect(startSend).not.toHaveBeenCalled();
    expect(resumeSend).not.toHaveBeenCalled();
  });

  test('deduplicates Start streams for one sender and reports one rejected run error', async () => {
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
    let rejectWorkflow: ((error: Error) => void) | undefined;
    const runErrorEvent = {
      runId: 'run-1',
      sequence: 1,
      type: 'run_error',
      payload: {},
      createdAt: '2026-07-14T00:00:00.000Z',
    } satisfies EnterpriseLeadWorkflowEvent;
    service.getSnapshot = vi.fn(() => snapshot);
    service.startWorkflow = vi.fn(
      () =>
        new Promise<EnterpriseLeadWorkspaceSnapshot>((_resolve, reject) => {
          rejectWorkflow = reject;
        }),
    );
    service.markRunErrorOnce = vi.fn(() => ({ transitioned: true, event: runErrorEvent }));
    const send = vi.fn();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkflowIpc.Start);
    const event = { sender: { send } };
    const input = {
      workspaceId: 'workspace-1',
      runId: 'run-1',
      options: { enabledOptionalNodes: [], maxConcurrency: 1 },
    };
    await handler?.(event, input);
    await handler?.(event, input);
    rejectWorkflow?.(new Error('gateway unavailable'));
    await Promise.resolve();
    await Promise.resolve();

    expect(service.startWorkflow).toHaveBeenCalledTimes(1);
    expect(service.markRunErrorOnce).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(EnterpriseLeadWorkflowIpc.Event, runErrorEvent);
  });

  test('contains failure persistence errors after a concurrent terminal transition', async () => {
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
    let rejectWorkflow: ((error: Error) => void) | undefined;
    service.getSnapshot = vi.fn(() => snapshot);
    service.startWorkflow = vi.fn(
      () =>
        new Promise<EnterpriseLeadWorkspaceSnapshot>((_resolve, reject) => {
          rejectWorkflow = reject;
        }),
    );
    service.markRunErrorOnce = vi.fn(() => {
      throw new Error('Enterprise lead run is archived');
    });
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const response = await registeredHandlers.get(EnterpriseLeadWorkflowIpc.Start)?.(
      { sender: { send: vi.fn() } },
      {
        workspaceId: 'workspace-1',
        runId: 'run-1',
        options: { enabledOptionalNodes: [], maxConcurrency: 1 },
      },
    );
    rejectWorkflow?.(new Error('gateway unavailable'));
    await Promise.resolve();
    await Promise.resolve();

    expect(response).toEqual({ success: true, data: snapshot });
    expect(service.markRunErrorOnce).toHaveBeenCalledWith(
      'workspace-1',
      'run-1',
      'gateway unavailable',
    );
  });

  test('persists one rejected run error and notifies each live sender stream', async () => {
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
    let rejectWorkflow: ((error: Error) => void) | undefined;
    const runErrorEvent = {
      runId: 'run-1',
      sequence: 1,
      type: 'run_error',
      payload: {},
      createdAt: '2026-07-14T00:00:00.000Z',
    } satisfies EnterpriseLeadWorkflowEvent;
    service.getSnapshot = vi.fn(() => snapshot);
    service.startWorkflow = vi.fn(
      () =>
        new Promise<EnterpriseLeadWorkspaceSnapshot>((_resolve, reject) => {
          rejectWorkflow = reject;
        }),
    );
    service.markRunErrorOnce = vi.fn(() => ({ transitioned: true, event: runErrorEvent }));
    const firstSend = vi.fn();
    const secondSend = vi.fn();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkflowIpc.Start);
    const input = {
      workspaceId: 'workspace-1',
      runId: 'run-1',
      options: { enabledOptionalNodes: [], maxConcurrency: 1 },
    };
    await handler?.({ sender: { send: firstSend } }, input);
    await handler?.({ sender: { send: secondSend } }, input);
    rejectWorkflow?.(new Error('gateway unavailable'));
    await Promise.resolve();
    await Promise.resolve();

    expect(service.startWorkflow).toHaveBeenCalledTimes(1);
    expect(service.markRunErrorOnce).toHaveBeenCalledTimes(1);
    expect(firstSend).toHaveBeenCalledWith(EnterpriseLeadWorkflowIpc.Event, runErrorEvent);
    expect(secondSend).toHaveBeenCalledWith(EnterpriseLeadWorkflowIpc.Event, runErrorEvent);
  });

  test('keeps one durable run error across sequential failed Start and Resume executions', async () => {
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
    const events: EnterpriseLeadWorkflowEvent[] = [];
    const runErrorEvent = {
      runId: 'run-1',
      sequence: 1,
      type: 'run_error',
      payload: {},
      createdAt: '2026-07-14T00:00:00.000Z',
    } satisfies EnterpriseLeadWorkflowEvent;
    let rejectStart: ((error: Error) => void) | undefined;
    let rejectResume: ((error: Error) => void) | undefined;
    service.getSnapshot = vi.fn(() => snapshot);
    service.startWorkflow = vi.fn(
      () =>
        new Promise<EnterpriseLeadWorkspaceSnapshot>((_resolve, reject) => {
          rejectStart = reject;
        }),
    );
    service.resumeRun = vi.fn(
      () =>
        new Promise<EnterpriseLeadWorkspaceSnapshot>((_resolve, reject) => {
          rejectResume = reject;
        }),
    );
    service.markRunErrorOnce = vi.fn(() => {
      if (events.length > 0) return { transitioned: false };
      events.push(runErrorEvent);
      return { transitioned: true, event: runErrorEvent };
    });
    deps.listWorkflowEvents = vi.fn(() => events);
    const startSend = vi.fn();
    const resumeSend = vi.fn();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    await registeredHandlers.get(EnterpriseLeadWorkflowIpc.Start)?.({ sender: { send: startSend } }, {
      workspaceId: 'workspace-1',
      runId: 'run-1',
      options: { enabledOptionalNodes: [], maxConcurrency: 1 },
    });
    rejectStart?.(new Error('gateway unavailable'));
    await Promise.resolve();
    await Promise.resolve();

    await registeredHandlers.get(EnterpriseLeadWorkflowIpc.Resume)?.({ sender: { send: resumeSend } }, {
      workspaceId: 'workspace-1',
      runId: 'run-1',
    });
    rejectResume?.(new Error('gateway unavailable again'));
    await Promise.resolve();
    await Promise.resolve();

    expect(service.startWorkflow).toHaveBeenCalledTimes(1);
    expect(service.resumeRun).toHaveBeenCalledTimes(1);
    expect(service.markRunErrorOnce).toHaveBeenCalledTimes(2);
    expect(events).toEqual([runErrorEvent]);
    expect(startSend).toHaveBeenCalledWith(EnterpriseLeadWorkflowIpc.Event, runErrorEvent);
    expect(resumeSend).not.toHaveBeenCalledWith(EnterpriseLeadWorkflowIpc.Event, runErrorEvent);
  });

  test('deduplicates Resume streams for one sender and run', async () => {
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
    let resolveWorkflow: (() => void) | undefined;
    service.getSnapshot = vi.fn(() => snapshot);
    service.resumeRun = vi.fn(
      () =>
        new Promise<EnterpriseLeadWorkspaceSnapshot>(resolve => {
          resolveWorkflow = () => resolve(snapshot);
        }),
    );
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkflowIpc.Resume);
    const event = { sender: { send: vi.fn() } };
    const input = { workspaceId: 'workspace-1', runId: 'run-1' };
    await handler?.(event, input);
    await handler?.(event, input);

    expect(service.resumeRun).toHaveBeenCalledTimes(1);

    resolveWorkflow?.();
  });

  test('cleans a workflow stream when its renderer is destroyed', async () => {
    vi.useFakeTimers();
    try {
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
      service.getSnapshot = vi.fn(() => snapshot);
      let resolveWorkflow: (() => void) | undefined;
      service.startWorkflow = vi.fn(
        () =>
          new Promise<EnterpriseLeadWorkspaceSnapshot>(resolve => {
            resolveWorkflow = () => resolve(snapshot);
          }),
      );
      const destroyedListeners: Array<() => void> = [];
      const sender = {
        send: vi.fn(),
        once: vi.fn((_event: string, listener: () => void) => destroyedListeners.push(listener)),
        removeListener: vi.fn(),
      };
      registerEnterpriseLeadWorkspaceHandlers(deps);

      const handler = registeredHandlers.get(EnterpriseLeadWorkflowIpc.Start);
      await handler?.({ sender }, {
        workspaceId: 'workspace-1',
        runId: 'run-1',
        options: { enabledOptionalNodes: [], maxConcurrency: 1 },
      });
      expect(vi.getTimerCount()).toBe(1);

      destroyedListeners.forEach(listener => listener());

      expect(vi.getTimerCount()).toBe(0);
      expect(sender.once).toHaveBeenCalledWith('destroyed', expect.any(Function));

      resolveWorkflow?.();
      await Promise.resolve();
      await Promise.resolve();

      expect(sender.removeListener).toHaveBeenCalledWith('destroyed', destroyedListeners[0]);
    } finally {
      vi.useRealTimers();
    }
  });

  test('clears a settled sender cursor so Resume does not replay events from before it subscribed', async () => {
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
    const events: EnterpriseLeadWorkflowEvent[] = [
      { runId: 'run-1', sequence: 1, type: 'run_started', payload: {}, createdAt: '2026-07-14T00:00:00.000Z' },
    ];
    service.getSnapshot = vi.fn(() => snapshot);
    service.startWorkflow = vi.fn(async () => snapshot);
    service.resumeRun = vi.fn(async () => {
      events.push({
        runId: 'run-1', sequence: 3, type: 'task_started', payload: {}, createdAt: '2026-07-14T00:00:02.000Z',
      });
      return snapshot;
    });
    deps.listWorkflowEvents = vi.fn(() => events);
    const sender = { send: vi.fn() };
    registerEnterpriseLeadWorkspaceHandlers(deps);

    await registeredHandlers.get(EnterpriseLeadWorkflowIpc.Start)?.({ sender }, {
      workspaceId: 'workspace-1', runId: 'run-1', options: { enabledOptionalNodes: [], maxConcurrency: 1 },
    });
    await Promise.resolve();
    await Promise.resolve();
    events.push({
      runId: 'run-1', sequence: 2, type: 'task_ready', payload: {}, createdAt: '2026-07-14T00:00:01.000Z',
    });

    await registeredHandlers.get(EnterpriseLeadWorkflowIpc.Resume)?.({ sender }, {
      workspaceId: 'workspace-1', runId: 'run-1',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith(
      EnterpriseLeadWorkflowIpc.Event,
      expect.objectContaining({ sequence: 3, type: 'task_started' }),
    );
  });

  test('persists a run error after its only sender is destroyed', async () => {
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
    let rejectWorkflow: ((error: Error) => void) | undefined;
    const runErrorEvent = {
      runId: 'run-1',
      sequence: 1,
      type: 'run_error',
      payload: {},
      createdAt: '2026-07-14T00:00:00.000Z',
    } satisfies EnterpriseLeadWorkflowEvent;
    service.getSnapshot = vi.fn(() => snapshot);
    service.startWorkflow = vi.fn(
      () =>
        new Promise<EnterpriseLeadWorkspaceSnapshot>((_resolve, reject) => {
          rejectWorkflow = reject;
        }),
    );
    service.markRunErrorOnce = vi.fn(() => ({ transitioned: true, event: runErrorEvent }));
    const destroyedListeners: Array<() => void> = [];
    const send = vi.fn();
    const sender = {
      send,
      once: vi.fn((_event: string, listener: () => void) => destroyedListeners.push(listener)),
    };
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkflowIpc.Start);
    await handler?.({ sender }, {
      workspaceId: 'workspace-1',
      runId: 'run-1',
      options: { enabledOptionalNodes: [], maxConcurrency: 1 },
    });
    destroyedListeners.forEach(listener => listener());
    rejectWorkflow?.(new Error('gateway unavailable'));
    await Promise.resolve();
    await Promise.resolve();

    expect(service.markRunErrorOnce).toHaveBeenCalledWith(
      'workspace-1',
      'run-1',
      'gateway unavailable',
    );
    expect(send).not.toHaveBeenCalledWith(EnterpriseLeadWorkflowIpc.Event, runErrorEvent);
  });

  test('dispatches only newly produced control events without replaying run history', async () => {
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
    const events: EnterpriseLeadWorkflowEvent[] = [
      {
        runId: 'run-1',
        sequence: 1,
        type: 'run_started',
        payload: {},
        createdAt: '2026-07-12T00:00:00.000Z',
      },
    ];
    service.cancelRun = vi.fn(async () => {
      events.push({
        runId: 'run-1',
        sequence: 2,
        type: 'run_cancelled',
        payload: {},
        createdAt: '2026-07-12T00:00:01.000Z',
      });
      return snapshot;
    });
    deps.listWorkflowEvents = vi.fn(() => events);
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const event = { sender: { send: vi.fn() } };
    const input = { workspaceId: 'workspace-1', runId: 'run-1', taskId: 'task-1' };

    await registeredHandlers.get(EnterpriseLeadWorkflowIpc.Cancel)?.(event, input);
    await registeredHandlers.get(EnterpriseLeadWorkflowIpc.ApproveTask)?.(event, input);
    await registeredHandlers.get(EnterpriseLeadWorkflowIpc.RejectTask)?.(event, input);

    expect(service.cancelRun).toHaveBeenCalledWith('workspace-1', 'run-1');
    expect(service.approveTask).toHaveBeenCalledWith('workspace-1', 'run-1', 'task-1');
    expect(service.rejectTask).toHaveBeenCalledWith('workspace-1', 'run-1', 'task-1');
    expect(event.sender.send).toHaveBeenCalledTimes(1);
    expect(event.sender.send).toHaveBeenCalledWith(
      EnterpriseLeadWorkflowIpc.Event,
      expect.objectContaining({ sequence: 2, type: 'run_cancelled' }),
    );
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
    const callOrder: string[] = [];
    service.markRunErrorOnce = vi.fn(() => {
      callOrder.push('persist');
      callOrder.push('event');
      return { transitioned: true, event: runErrorEvent };
    });
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

    expect(service.markRunErrorOnce).toHaveBeenCalledWith(
      'workspace-1',
      'run-1',
      'gateway unavailable',
    );
    expect(callOrder).toEqual(['persist', 'event']);
    expect(send).toHaveBeenCalledWith(EnterpriseLeadWorkflowIpc.Event, runErrorEvent);
  });

  test('does not emit a run error when cancellation rejects a late workflow failure', async () => {
    const { deps, service } = makeDeps();
    const snapshot = {
      workspace: { id: 'workspace-1' },
      currentRun: { id: 'run-1', status: EnterpriseLeadRunStatus.Cancelled },
      tasks: [],
      pendingVersions: [],
      deliverables: [],
      todos: [],
      archives: [],
    } as EnterpriseLeadWorkspaceSnapshot;
    service.getSnapshot = vi.fn(() => snapshot);
    service.startWorkflow = vi.fn(async () => {
      throw new Error('gateway unavailable after cancellation');
    });
    service.markRunErrorOnce = vi.fn(() => ({ transitioned: false }));
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

    expect(service.markRunErrorOnce).toHaveBeenCalledWith(
      'workspace-1',
      'run-1',
      'gateway unavailable after cancellation',
    );
    expect(send).not.toHaveBeenCalledWith(
      EnterpriseLeadWorkflowIpc.Event,
      expect.objectContaining({ type: 'run_error' }),
    );
  });
});
