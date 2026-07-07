import { ipcMain } from 'electron';

import { EnterpriseLeadWorkspaceIpc } from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadExtractionSource,
  EnterpriseLeadIpcResult,
  EnterpriseLeadPendingVersion,
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
  };
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
}
