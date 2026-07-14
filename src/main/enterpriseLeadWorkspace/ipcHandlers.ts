import { ipcMain } from 'electron';

import {
  EnterpriseLeadWorkflowIpc,
  EnterpriseLeadWorkspaceIpc,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadExtractionSource,
  EnterpriseLeadIpcResult,
  EnterpriseLeadPendingVersion,
  EnterpriseLeadWorkflowEvent,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
  EnterpriseLeadWorkspaceAgentCalibrationRequest,
  EnterpriseLeadWorkspaceAgentCalibrationResponse,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceProfile,
  EnterpriseLeadWorkspaceRunSummary,
  EnterpriseLeadWorkspaceSettingsUpdate,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../shared/enterpriseLeadWorkspace/types';
import {
  normalizeEnterpriseLeadExtractionSources,
  normalizeWorkspaceProfile,
} from '../../shared/enterpriseLeadWorkspace/validation';
import {
  WorkflowOptionalNode,
  type WorkflowOptionalNode as WorkflowOptionalNodeType,
  type WorkflowStartOptions,
} from '../../shared/enterpriseLeadWorkspace/workflowContracts';

export interface EnterpriseLeadWorkspaceHandlerDeps {
  service: {
    listWorkspaces: () => EnterpriseLeadWorkspace[] | Promise<EnterpriseLeadWorkspace[]>;
    getWorkspace: (
      id: string,
    ) => EnterpriseLeadWorkspace | null | Promise<EnterpriseLeadWorkspace | null>;
    extractDraftFromConversation: (text: string) => Promise<EnterpriseLeadWorkspaceDraft>;
    createWorkspace: (
      draft: EnterpriseLeadWorkspaceDraft,
    ) => EnterpriseLeadWorkspace | Promise<EnterpriseLeadWorkspace>;
    deleteWorkspace: (workspaceId: string) => boolean | Promise<boolean>;
    updateWorkspaceProfile: (
      workspaceId: string,
      profile: EnterpriseLeadWorkspaceProfile,
    ) => EnterpriseLeadWorkspace | Promise<EnterpriseLeadWorkspace>;
    updateWorkspaceSources: (
      workspaceId: string,
      sources: EnterpriseLeadExtractionSource[],
    ) => EnterpriseLeadWorkspace | Promise<EnterpriseLeadWorkspace>;
    enqueueWorkspaceDocumentProcessing: (
      workspaceId: string,
      sources: EnterpriseLeadExtractionSource[],
      sourceIndex: number,
    ) => EnterpriseLeadWorkspace | Promise<EnterpriseLeadWorkspace>;
    updateWorkspaceSettings: (
      workspaceId: string,
      input: EnterpriseLeadWorkspaceSettingsUpdate,
    ) => EnterpriseLeadWorkspace | Promise<EnterpriseLeadWorkspace>;
    updateWorkspaceAgents: (
      workspaceId: string,
      agents: EnterpriseLeadWorkspaceAgentBinding[],
    ) => EnterpriseLeadWorkspace | Promise<EnterpriseLeadWorkspace>;
    listRuns: (
      workspaceId: string,
    ) => EnterpriseLeadWorkspaceRunSummary[] | Promise<EnterpriseLeadWorkspaceRunSummary[]>;
    testWorkspaceAgent: (
      workspaceId: string,
      request: EnterpriseLeadWorkspaceAgentCalibrationRequest,
    ) =>
      | EnterpriseLeadWorkspaceAgentCalibrationResponse
      | Promise<EnterpriseLeadWorkspaceAgentCalibrationResponse>;
    createRun: (
      workspaceId: string,
      userGoal: string,
    ) => EnterpriseLeadWorkspaceSnapshot | Promise<EnterpriseLeadWorkspaceSnapshot>;
    getSnapshot: (
      workspaceId: string,
      runId?: string,
    ) => EnterpriseLeadWorkspaceSnapshot | Promise<EnterpriseLeadWorkspaceSnapshot>;
    runWorkflow: (
      workspaceId: string,
      runId: string,
    ) => EnterpriseLeadWorkspaceSnapshot | Promise<EnterpriseLeadWorkspaceSnapshot>;
    runTask: (taskId: string) => EnterpriseLeadAgentTask | Promise<EnterpriseLeadAgentTask>;
    rerunTask: (taskId: string) => EnterpriseLeadAgentTask | Promise<EnterpriseLeadAgentTask>;
    createPendingVersionFromChat: (
      taskId: string,
      message: string,
    ) => EnterpriseLeadPendingVersion | Promise<EnterpriseLeadPendingVersion>;
    applyPendingVersion: (
      pendingVersionId: string,
    ) => EnterpriseLeadWorkspaceSnapshot | Promise<EnterpriseLeadWorkspaceSnapshot>;
    archiveRun: (
      workspaceId: string,
      runId: string,
    ) => EnterpriseLeadWorkspaceSnapshot | Promise<EnterpriseLeadWorkspaceSnapshot>;
    startWorkflow: (
      workspaceId: string,
      runId: string,
      options: WorkflowStartOptions,
    ) => EnterpriseLeadWorkspaceSnapshot | Promise<EnterpriseLeadWorkspaceSnapshot>;
    markRunErrorOnce: (
      workspaceId: string,
      runId: string,
      error: string,
    ) =>
      | { transitioned: boolean; event?: EnterpriseLeadWorkflowEvent }
      | Promise<{ transitioned: boolean; event?: EnterpriseLeadWorkflowEvent }>;
    resumeRun: (
      workspaceId: string,
      runId: string,
    ) => EnterpriseLeadWorkspaceSnapshot | Promise<EnterpriseLeadWorkspaceSnapshot>;
    cancelRun: (
      workspaceId: string,
      runId: string,
    ) => EnterpriseLeadWorkspaceSnapshot | Promise<EnterpriseLeadWorkspaceSnapshot>;
    approveTask: (
      workspaceId: string,
      runId: string,
      taskId: string,
    ) => EnterpriseLeadWorkspaceSnapshot | Promise<EnterpriseLeadWorkspaceSnapshot>;
    rejectTask: (
      workspaceId: string,
      runId: string,
      taskId: string,
    ) => EnterpriseLeadWorkspaceSnapshot | Promise<EnterpriseLeadWorkspaceSnapshot>;
  };
  listWorkflowEvents: (runId: string) => EnterpriseLeadWorkflowEvent[];
}

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown enterprise lead workspace error';

const requireNonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
};

const readSettingsUpdate = (value: unknown): EnterpriseLeadWorkspaceSettingsUpdate => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as EnterpriseLeadWorkspaceSettingsUpdate;
};

const readWorkspaceProfile = (value: unknown): EnterpriseLeadWorkspaceProfile =>
  normalizeWorkspaceProfile(value);

const readWorkspaceSources = (value: unknown): EnterpriseLeadExtractionSource[] => {
  if (!Array.isArray(value)) {
    throw new Error('Workspace sources are required');
  }
  return normalizeEnterpriseLeadExtractionSources(value);
};

const requireNonNegativeInteger = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readWorkflowStartOptions = (value: unknown): WorkflowStartOptions => {
  if (!isPlainObject(value)) {
    throw new Error('Workflow start options are required');
  }
  if (!Array.isArray(value.enabledOptionalNodes)) {
    throw new Error('Workflow optional nodes are required');
  }
  const allowedNodes = new Set<string>(Object.values(WorkflowOptionalNode));
  if (
    !value.enabledOptionalNodes.every(
      (node): node is WorkflowOptionalNodeType =>
        typeof node === 'string' && allowedNodes.has(node),
    )
  ) {
    throw new Error('Workflow optional node is invalid');
  }
  if (
    typeof value.maxConcurrency !== 'number' ||
    !Number.isInteger(value.maxConcurrency) ||
    value.maxConcurrency < 1 ||
    value.maxConcurrency > 3
  ) {
    throw new Error('Workflow max concurrency must be an integer from 1 to 3');
  }
  return {
    enabledOptionalNodes: Array.from(new Set(value.enabledOptionalNodes)),
    maxConcurrency: value.maxConcurrency,
  };
};

const readWorkspaceAgents = (value: unknown): EnterpriseLeadWorkspaceAgentBinding[] => {
  if (!Array.isArray(value)) {
    throw new Error('Workspace agents are required');
  }
  return value as EnterpriseLeadWorkspaceAgentBinding[];
};

const readOptionalString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const readStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((item): item is string => typeof item === 'string')
            .map(item => item.trim())
            .filter(Boolean),
        ),
      )
    : [];

const readWorkspaceAgentCalibrationRequest = (
  value: unknown,
): EnterpriseLeadWorkspaceAgentCalibrationRequest => {
  if (!isPlainObject(value) || !isPlainObject(value.agent) || !isPlainObject(value.example)) {
    throw new Error('Workspace Agent calibration request is required');
  }

  return {
    ...(typeof value.agentId === 'string' && value.agentId.trim()
      ? { agentId: value.agentId.trim() }
      : {}),
    agent: {
      name: requireNonEmptyString(value.agent.name, 'Agent name').trim(),
      description: readOptionalString(value.agent.description),
      identity: readOptionalString(value.agent.identity),
      systemPrompt: readOptionalString(value.agent.systemPrompt),
      icon: readOptionalString(value.agent.icon),
      model: readOptionalString(value.agent.model),
      skillIds: readStringList(value.agent.skillIds),
    },
    example: {
      sampleInput: requireNonEmptyString(value.example.sampleInput, 'Example input').trim(),
      expectedPriority: readOptionalString(value.example.expectedPriority),
      expectedReason: readOptionalString(value.example.expectedReason),
      expectedMissing: readOptionalString(value.example.expectedMissing),
      expectedNextStep: readOptionalString(value.example.expectedNextStep),
    },
  };
};

const ok = <T>(data: T): EnterpriseLeadIpcResult<T> => ({
  success: true,
  data,
});

const fail = <T>(error: unknown): EnterpriseLeadIpcResult<T> => ({
  success: false,
  error: toErrorMessage(error),
});

type WorkflowEventSender = {
  send: (channel: string, payload: EnterpriseLeadWorkflowEvent) => void;
  isDestroyed?: () => boolean;
  once?: (event: 'destroyed', listener: () => void) => unknown;
  removeListener?: (event: 'destroyed', listener: () => void) => unknown;
};

const workflowEventCursors = new WeakMap<WorkflowEventSender, Map<string, number>>();
interface WorkflowEventStream {
  sender: WorkflowEventSender;
  interval: ReturnType<typeof setInterval> | undefined;
  disposed: boolean;
  destroyedListener: (() => void) | undefined;
  execution: WorkflowRunExecution | undefined;
}

const workflowEventStreams = new WeakMap<WorkflowEventSender, Map<string, WorkflowEventStream>>();

interface WorkflowRunExecution {
  execution: Promise<EnterpriseLeadWorkspaceSnapshot>;
  streams: Set<WorkflowEventStream>;
}

const workflowRunExecutions = new Map<string, Map<string, WorkflowRunExecution>>();

const getWorkflowEventCursor = (sender: WorkflowEventSender, runId: string): number | undefined =>
  workflowEventCursors.get(sender)?.get(runId);

const setWorkflowEventCursor = (sender: WorkflowEventSender, runId: string, sequence: number): void => {
  const cursors = workflowEventCursors.get(sender) ?? new Map<string, number>();
  cursors.set(runId, sequence);
  workflowEventCursors.set(sender, cursors);
};

const primeWorkflowEventCursor = (
  sender: WorkflowEventSender,
  runId: string,
  listWorkflowEvents: (runId: string) => EnterpriseLeadWorkflowEvent[],
): void => {
  if (getWorkflowEventCursor(sender, runId) !== undefined) return;
  const latestSequence = listWorkflowEvents(runId).reduce(
    (sequence, workflowEvent) => Math.max(sequence, workflowEvent.sequence),
    0,
  );
  setWorkflowEventCursor(sender, runId, latestSequence);
};

const sendNewWorkflowEvents = (
  sender: WorkflowEventSender,
  runId: string,
  listWorkflowEvents: (runId: string) => EnterpriseLeadWorkflowEvent[],
): void => {
  if (sender.isDestroyed?.()) return;
  const cursor = getWorkflowEventCursor(sender, runId) ?? 0;
  const events = listWorkflowEvents(runId)
    .filter(workflowEvent => workflowEvent.sequence > cursor)
    .sort((left, right) => left.sequence - right.sequence);
  events.forEach(workflowEvent => {
    sender.send(EnterpriseLeadWorkflowIpc.Event, workflowEvent);
    setWorkflowEventCursor(sender, runId, workflowEvent.sequence);
  });
};

const sendWorkflowEvent = (
  sender: WorkflowEventSender,
  workflowEvent: EnterpriseLeadWorkflowEvent,
): void => {
  if (sender.isDestroyed?.()) return;
  sender.send(EnterpriseLeadWorkflowIpc.Event, workflowEvent);
  setWorkflowEventCursor(sender, workflowEvent.runId, workflowEvent.sequence);
};

const getWorkflowEventStream = (
  sender: WorkflowEventSender,
  runId: string,
): WorkflowEventStream | undefined => workflowEventStreams.get(sender)?.get(runId);

const setWorkflowEventStream = (
  sender: WorkflowEventSender,
  runId: string,
  stream: WorkflowEventStream,
): void => {
  const streams = workflowEventStreams.get(sender) ?? new Map<string, WorkflowEventStream>();
  streams.set(runId, stream);
  workflowEventStreams.set(sender, streams);
};

const clearWorkflowEventStream = (
  sender: WorkflowEventSender,
  runId: string,
  stream: WorkflowEventStream,
): void => {
  if (stream.disposed) return;
  stream.disposed = true;
  if (stream.interval) clearInterval(stream.interval);
  if (stream.destroyedListener) {
    sender.removeListener?.('destroyed', stream.destroyedListener);
    stream.destroyedListener = undefined;
  }
  stream.execution?.streams.delete(stream);
  stream.execution = undefined;

  const streams = workflowEventStreams.get(sender);
  if (streams?.get(runId) !== stream) return;
  streams.delete(runId);
  if (streams.size === 0) workflowEventStreams.delete(sender);
};

const getWorkflowRunExecution = (
  workspaceId: string,
  runId: string,
): WorkflowRunExecution | undefined => workflowRunExecutions.get(workspaceId)?.get(runId);

const setWorkflowRunExecution = (
  workspaceId: string,
  runId: string,
  execution: WorkflowRunExecution,
): void => {
  const executions = workflowRunExecutions.get(workspaceId) ?? new Map<string, WorkflowRunExecution>();
  executions.set(runId, execution);
  workflowRunExecutions.set(workspaceId, executions);
};

const clearWorkflowRunExecution = (
  workspaceId: string,
  runId: string,
  execution: WorkflowRunExecution,
): void => {
  const executions = workflowRunExecutions.get(workspaceId);
  if (executions?.get(runId) !== execution) return;
  executions.delete(runId);
  if (executions.size === 0) workflowRunExecutions.delete(workspaceId);
};

const settleWorkflowRunExecution = async (
  deps: EnterpriseLeadWorkspaceHandlerDeps,
  workspaceId: string,
  runId: string,
  runExecution: WorkflowRunExecution,
): Promise<void> => {
  try {
    await runExecution.execution;
  } catch (error) {
    const message = toErrorMessage(error);
    const result = await deps.service.markRunErrorOnce(workspaceId, runId, message);
    if (result.transitioned && result.event) {
      runExecution.streams.forEach(stream => {
        if (!stream.disposed) sendWorkflowEvent(stream.sender, result.event!);
      });
    }
  } finally {
    [...runExecution.streams].forEach(stream => {
      if (!stream.disposed) {
        sendNewWorkflowEvents(stream.sender, runId, deps.listWorkflowEvents);
        clearWorkflowEventStream(stream.sender, runId, stream);
      }
    });
    clearWorkflowRunExecution(workspaceId, runId, runExecution);
  }
};

const getOrStartWorkflowRunExecution = (
  deps: EnterpriseLeadWorkspaceHandlerDeps,
  workspaceId: string,
  runId: string,
  execute: () => EnterpriseLeadWorkspaceSnapshot | Promise<EnterpriseLeadWorkspaceSnapshot>,
): WorkflowRunExecution => {
  const existingExecution = getWorkflowRunExecution(workspaceId, runId);
  if (existingExecution) return existingExecution;

  const runExecution: WorkflowRunExecution = {
    execution: Promise.resolve({} as EnterpriseLeadWorkspaceSnapshot),
    streams: new Set<WorkflowEventStream>(),
  };
  setWorkflowRunExecution(workspaceId, runId, runExecution);
  try {
    runExecution.execution = Promise.resolve(execute());
  } catch (error) {
    runExecution.execution = Promise.reject(error);
  }
  void settleWorkflowRunExecution(deps, workspaceId, runId, runExecution);
  return runExecution;
};

const startWorkflowEventStream = (
  deps: EnterpriseLeadWorkspaceHandlerDeps,
  sender: WorkflowEventSender,
  workspaceId: string,
  runId: string,
  execute: () => EnterpriseLeadWorkspaceSnapshot | Promise<EnterpriseLeadWorkspaceSnapshot>,
): void => {
  if (getWorkflowEventStream(sender, runId)) return;

  const stream: WorkflowEventStream = {
    sender,
    interval: undefined,
    disposed: false,
    destroyedListener: undefined,
    execution: undefined,
  };
  setWorkflowEventStream(sender, runId, stream);
  const runExecution = getOrStartWorkflowRunExecution(deps, workspaceId, runId, execute);
  stream.execution = runExecution;
  runExecution.streams.add(stream);
  const cleanup = () => clearWorkflowEventStream(sender, runId, stream);
  stream.destroyedListener = cleanup;
  if (sender.isDestroyed?.()) {
    cleanup();
    return;
  }

  sendNewWorkflowEvents(sender, runId, deps.listWorkflowEvents);
  stream.interval = setInterval(
    () => {
      if (sender.isDestroyed?.()) {
        cleanup();
        return;
      }
      sendNewWorkflowEvents(sender, runId, deps.listWorkflowEvents);
    },
    50,
  );
  sender.once?.('destroyed', cleanup);
};

export function registerEnterpriseLeadWorkspaceHandlers(
  deps: EnterpriseLeadWorkspaceHandlerDeps,
): void {
  ipcMain.handle(EnterpriseLeadWorkspaceIpc.ListWorkspaces, async () => {
    try {
      return ok(await deps.service.listWorkspaces());
    } catch (error) {
      return fail<EnterpriseLeadWorkspace[]>(error);
    }
  });

  ipcMain.handle(EnterpriseLeadWorkspaceIpc.GetWorkspace, async (_event, id: string) => {
    try {
      return ok(await deps.service.getWorkspace(requireNonEmptyString(id, 'Workspace id')));
    } catch (error) {
      return fail<EnterpriseLeadWorkspace | null>(error);
    }
  });

  ipcMain.handle(
    EnterpriseLeadWorkspaceIpc.ExtractDraft,
    async (_event, input: { text?: unknown }) => {
      try {
        const text = requireNonEmptyString(input?.text, 'Conversation text');
        return ok(await deps.service.extractDraftFromConversation(text));
      } catch (error) {
        return fail<EnterpriseLeadWorkspaceDraft>(error);
      }
    },
  );

  ipcMain.handle(
    EnterpriseLeadWorkspaceIpc.CreateWorkspace,
    async (_event, draft: EnterpriseLeadWorkspaceDraft) => {
      try {
        return ok(await deps.service.createWorkspace(draft));
      } catch (error) {
        return fail<EnterpriseLeadWorkspace>(error);
      }
    },
  );

  ipcMain.handle(
    EnterpriseLeadWorkspaceIpc.DeleteWorkspace,
    async (_event, workspaceId: unknown) => {
      try {
        return ok(
          await deps.service.deleteWorkspace(requireNonEmptyString(workspaceId, 'Workspace id')),
        );
      } catch (error) {
        return fail<boolean>(error);
      }
    },
  );

  ipcMain.handle(
    EnterpriseLeadWorkspaceIpc.UpdateWorkspaceProfile,
    async (_event, input: { workspaceId?: unknown; profile?: unknown }) => {
      try {
        const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
        return ok(
          await deps.service.updateWorkspaceProfile(
            workspaceId,
            readWorkspaceProfile(input?.profile),
          ),
        );
      } catch (error) {
        return fail<EnterpriseLeadWorkspace>(error);
      }
    },
  );

  ipcMain.handle(
    EnterpriseLeadWorkspaceIpc.UpdateWorkspaceSources,
    async (_event, input: { workspaceId?: unknown; sources?: unknown }) => {
      try {
        const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
        return ok(
          await deps.service.updateWorkspaceSources(
            workspaceId,
            readWorkspaceSources(input?.sources),
          ),
        );
      } catch (error) {
        return fail<EnterpriseLeadWorkspace>(error);
      }
    },
  );

  ipcMain.handle(
    EnterpriseLeadWorkspaceIpc.ProcessDocumentSource,
    async (_event, input: { workspaceId?: unknown; sources?: unknown; sourceIndex?: unknown }) => {
      try {
        const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
        return ok(
          await deps.service.enqueueWorkspaceDocumentProcessing(
            workspaceId,
            readWorkspaceSources(input?.sources),
            requireNonNegativeInteger(input?.sourceIndex, 'Document source index'),
          ),
        );
      } catch (error) {
        return fail<EnterpriseLeadWorkspace>(error);
      }
    },
  );

  ipcMain.handle(
    EnterpriseLeadWorkspaceIpc.UpdateWorkspaceSettings,
    async (_event, input: { workspaceId?: unknown; settings?: unknown }) => {
      try {
        const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
        return ok(
          await deps.service.updateWorkspaceSettings(
            workspaceId,
            readSettingsUpdate(input?.settings),
          ),
        );
      } catch (error) {
        return fail<EnterpriseLeadWorkspace>(error);
      }
    },
  );

  ipcMain.handle(
    EnterpriseLeadWorkspaceIpc.UpdateWorkspaceAgents,
    async (_event, input: { workspaceId?: unknown; agents?: unknown }) => {
      try {
        const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
        const agents = readWorkspaceAgents(input?.agents);
        return ok(await deps.service.updateWorkspaceAgents(workspaceId, agents));
      } catch (error) {
        return fail<EnterpriseLeadWorkspace>(error);
      }
    },
  );

  ipcMain.handle(EnterpriseLeadWorkspaceIpc.ListRuns, async (_event, workspaceId: unknown) => {
    try {
      return ok(await deps.service.listRuns(requireNonEmptyString(workspaceId, 'Workspace id')));
    } catch (error) {
      return fail<EnterpriseLeadWorkspaceRunSummary[]>(error);
    }
  });

  ipcMain.handle(
    EnterpriseLeadWorkspaceIpc.CreateRun,
    async (_event, input: { workspaceId?: unknown; userGoal?: unknown }) => {
      try {
        const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
        const userGoal = requireNonEmptyString(input?.userGoal, 'User goal');
        return ok(await deps.service.createRun(workspaceId, userGoal));
      } catch (error) {
        return fail<EnterpriseLeadWorkspaceSnapshot>(error);
      }
    },
  );

  ipcMain.handle(
    EnterpriseLeadWorkspaceIpc.GetRun,
    async (_event, input: { workspaceId?: unknown; runId?: unknown }) => {
      try {
        const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
        const runId = typeof input?.runId === 'string' ? input.runId : undefined;
        return ok(await deps.service.getSnapshot(workspaceId, runId));
      } catch (error) {
        return fail<EnterpriseLeadWorkspaceSnapshot>(error);
      }
    },
  );

  ipcMain.handle(
    EnterpriseLeadWorkspaceIpc.RunWorkflow,
    async (_event, input: { workspaceId?: unknown; runId?: unknown }) => {
      try {
        const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
        const runId = requireNonEmptyString(input?.runId, 'Run id');
        return ok(await deps.service.runWorkflow(workspaceId, runId));
      } catch (error) {
        return fail<EnterpriseLeadWorkspaceSnapshot>(error);
      }
    },
  );

  ipcMain.handle(
    EnterpriseLeadWorkspaceIpc.TestWorkspaceAgent,
    async (_event, input: { workspaceId?: unknown; request?: unknown }) => {
      try {
        const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
        return ok(
          await deps.service.testWorkspaceAgent(
            workspaceId,
            readWorkspaceAgentCalibrationRequest(input?.request),
          ),
        );
      } catch (error) {
        return fail<EnterpriseLeadWorkspaceAgentCalibrationResponse>(error);
      }
    },
  );

  ipcMain.handle(EnterpriseLeadWorkspaceIpc.RunTask, async (_event, taskId: unknown) => {
    try {
      return ok(await deps.service.runTask(requireNonEmptyString(taskId, 'Task id')));
    } catch (error) {
      return fail<EnterpriseLeadAgentTask>(error);
    }
  });

  ipcMain.handle(
    EnterpriseLeadWorkspaceIpc.RerunTask,
    async (_event, input: { taskId?: unknown }) => {
      try {
        const taskId = requireNonEmptyString(input?.taskId, 'Task id');
        return ok(await deps.service.rerunTask(taskId));
      } catch (error) {
        return fail<EnterpriseLeadAgentTask>(error);
      }
    },
  );

  ipcMain.handle(
    EnterpriseLeadWorkspaceIpc.CreatePendingVersion,
    async (_event, input: { taskId?: unknown; message?: unknown }) => {
      try {
        const taskId = requireNonEmptyString(input?.taskId, 'Task id');
        const message = requireNonEmptyString(input?.message, 'Message');
        return ok(await deps.service.createPendingVersionFromChat(taskId, message));
      } catch (error) {
        return fail<EnterpriseLeadPendingVersion>(error);
      }
    },
  );

  ipcMain.handle(
    EnterpriseLeadWorkspaceIpc.ApplyPendingVersion,
    async (_event, pendingVersionId: unknown) => {
      try {
        return ok(
          await deps.service.applyPendingVersion(
            requireNonEmptyString(pendingVersionId, 'Pending version id'),
          ),
        );
      } catch (error) {
        return fail<EnterpriseLeadWorkspaceSnapshot>(error);
      }
    },
  );

  ipcMain.handle(
    EnterpriseLeadWorkspaceIpc.ArchiveRun,
    async (_event, input: { workspaceId?: unknown; runId?: unknown }) => {
      try {
        const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
        const runId = requireNonEmptyString(input?.runId, 'Run id');
        return ok(await deps.service.archiveRun(workspaceId, runId));
      } catch (error) {
        return fail<EnterpriseLeadWorkspaceSnapshot>(error);
      }
    },
  );

  ipcMain.handle(
    EnterpriseLeadWorkflowIpc.Start,
    async (event, input: { workspaceId?: unknown; runId?: unknown; options?: unknown }) => {
      try {
        const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
        const runId = requireNonEmptyString(input?.runId, 'Run id');
        const options = readWorkflowStartOptions(input?.options);
        const snapshot = await deps.service.getSnapshot(workspaceId, runId);
        primeWorkflowEventCursor(event.sender, runId, deps.listWorkflowEvents);
        startWorkflowEventStream(deps, event.sender, workspaceId, runId, () =>
          deps.service.startWorkflow(workspaceId, runId, options),
        );

        return ok(snapshot);
      } catch (error) {
        return fail<EnterpriseLeadWorkspaceSnapshot>(error);
      }
    },
  );

  ipcMain.handle(
    EnterpriseLeadWorkflowIpc.Resume,
    async (event, input: { workspaceId?: unknown; runId?: unknown }) => {
      try {
        const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
        const runId = requireNonEmptyString(input?.runId, 'Run id');
        const snapshot = await deps.service.getSnapshot(workspaceId, runId);
        primeWorkflowEventCursor(event.sender, runId, deps.listWorkflowEvents);
        startWorkflowEventStream(deps, event.sender, workspaceId, runId, () =>
          deps.service.resumeRun(workspaceId, runId),
        );
        return ok(snapshot);
      } catch (error) {
        return fail<EnterpriseLeadWorkspaceSnapshot>(error);
      }
    },
  );

  ipcMain.handle(
    EnterpriseLeadWorkflowIpc.Cancel,
    async (event, input: { workspaceId?: unknown; runId?: unknown }) => {
      try {
        const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
        const runId = requireNonEmptyString(input?.runId, 'Run id');
        primeWorkflowEventCursor(event.sender, runId, deps.listWorkflowEvents);
        const snapshot = await deps.service.cancelRun(workspaceId, runId);
        sendNewWorkflowEvents(event.sender, runId, deps.listWorkflowEvents);
        return ok(snapshot);
      } catch (error) {
        return fail<EnterpriseLeadWorkspaceSnapshot>(error);
      }
    },
  );

  ipcMain.handle(
    EnterpriseLeadWorkflowIpc.ApproveTask,
    async (event, input: { workspaceId?: unknown; runId?: unknown; taskId?: unknown }) => {
      try {
        const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
        const runId = requireNonEmptyString(input?.runId, 'Run id');
        const taskId = requireNonEmptyString(input?.taskId, 'Task id');
        primeWorkflowEventCursor(event.sender, runId, deps.listWorkflowEvents);
        const snapshot = await deps.service.approveTask(workspaceId, runId, taskId);
        sendNewWorkflowEvents(event.sender, runId, deps.listWorkflowEvents);
        return ok(snapshot);
      } catch (error) {
        return fail<EnterpriseLeadWorkspaceSnapshot>(error);
      }
    },
  );

  ipcMain.handle(
    EnterpriseLeadWorkflowIpc.RejectTask,
    async (event, input: { workspaceId?: unknown; runId?: unknown; taskId?: unknown }) => {
      try {
        const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
        const runId = requireNonEmptyString(input?.runId, 'Run id');
        const taskId = requireNonEmptyString(input?.taskId, 'Task id');
        primeWorkflowEventCursor(event.sender, runId, deps.listWorkflowEvents);
        const snapshot = await deps.service.rejectTask(workspaceId, runId, taskId);
        sendNewWorkflowEvents(event.sender, runId, deps.listWorkflowEvents);
        return ok(snapshot);
      } catch (error) {
        return fail<EnterpriseLeadWorkspaceSnapshot>(error);
      }
    },
  );
}
