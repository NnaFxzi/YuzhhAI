import { ipcMain } from 'electron';

import { EnterpriseLeadWorkspaceIpc } from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadIpcResult,
  EnterpriseLeadPendingVersion,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
  EnterpriseLeadWorkspaceChatMessage,
  EnterpriseLeadWorkspaceChatRequest,
  EnterpriseLeadWorkspaceChatResearchResult,
  EnterpriseLeadWorkspaceChatResponse,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceProfile,
  EnterpriseLeadWorkspaceRunSummary,
  EnterpriseLeadWorkspaceSettingsUpdate,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../shared/enterpriseLeadWorkspace/types';
import {
  normalizeWorkspaceChatResearchIntent,
  normalizeWorkspaceProfile,
} from '../../shared/enterpriseLeadWorkspace/validation';

export interface EnterpriseLeadWorkspaceHandlerDeps {
  service: {
    listWorkspaces: () => EnterpriseLeadWorkspace[] | Promise<EnterpriseLeadWorkspace[]>;
    getWorkspace: (id: string) => EnterpriseLeadWorkspace | null | Promise<EnterpriseLeadWorkspace | null>;
    extractDraftFromConversation: (text: string) => Promise<EnterpriseLeadWorkspaceDraft>;
    createWorkspace: (draft: EnterpriseLeadWorkspaceDraft) => EnterpriseLeadWorkspace | Promise<EnterpriseLeadWorkspace>;
    deleteWorkspace: (workspaceId: string) => boolean | Promise<boolean>;
    updateWorkspaceProfile: (
      workspaceId: string,
      profile: EnterpriseLeadWorkspaceProfile,
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
    chat: (
      workspaceId: string,
      request: EnterpriseLeadWorkspaceChatRequest,
    ) => EnterpriseLeadWorkspaceChatResponse | Promise<EnterpriseLeadWorkspaceChatResponse>;
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

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isChatResearchStatus = (
  value: unknown,
): value is EnterpriseLeadWorkspaceChatResearchResult['status'] =>
  value === 'skipped' || value === 'completed' || value === 'failed';

const isChatResearchProvider = (
  value: unknown,
): value is NonNullable<EnterpriseLeadWorkspaceChatResearchResult['provider']> =>
  value === 'tavily' || value === 'firecrawl' || value === 'domestic';

const readRecentMessageResearch = (
  value: unknown,
): EnterpriseLeadWorkspaceChatResearchResult | undefined => {
  if (!isPlainObject(value) || !isChatResearchStatus(value.status)) {
    return undefined;
  }

  const research: EnterpriseLeadWorkspaceChatResearchResult = {
    intent: normalizeWorkspaceChatResearchIntent(value.intent),
    status: value.status,
    summary: typeof value.summary === 'string' ? value.summary.slice(0, 1_000) : '',
  };
  if (isChatResearchProvider(value.provider)) {
    research.provider = value.provider;
  }
  return research;
};

const readWorkspaceAgents = (value: unknown): EnterpriseLeadWorkspaceAgentBinding[] => {
  if (!Array.isArray(value)) {
    throw new Error('Workspace agents are required');
  }
  return value as EnterpriseLeadWorkspaceAgentBinding[];
};

const readRecentChatMessages = (value: unknown): EnterpriseLeadWorkspaceChatMessage[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .filter((item): item is EnterpriseLeadWorkspaceChatMessage => {
      if (!isPlainObject(item)) {
        return false;
      }
      const hasValidRole = item.role === 'user' || item.role === 'assistant';
      return typeof item.id === 'string'
        && hasValidRole
        && typeof item.content === 'string'
        && typeof item.createdAt === 'string';
    })
    .map(item => {
      const message: EnterpriseLeadWorkspaceChatMessage = {
        id: item.id,
        role: item.role,
        content: item.content,
        createdAt: item.createdAt,
      };
      const research = readRecentMessageResearch(item.research);
      if (research) {
        message.research = research;
      }
      return message;
    });
};

const readChatRequest = (value: unknown): EnterpriseLeadWorkspaceChatRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Chat request is required');
  }

  const input = value as {
    message?: unknown;
    targetAgentId?: unknown;
    recentMessages?: unknown;
  };
  const request: EnterpriseLeadWorkspaceChatRequest = {
    message: requireNonEmptyString(input.message, 'Message'),
  };

  if (typeof input.targetAgentId === 'string') {
    request.targetAgentId = input.targetAgentId;
  }

  const recentMessages = readRecentChatMessages(input.recentMessages);
  if (recentMessages) {
    request.recentMessages = recentMessages;
  }

  return request;
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

  ipcMain.handle(EnterpriseLeadWorkspaceIpc.DeleteWorkspace, async (_event, workspaceId: unknown) => {
    try {
      return ok(await deps.service.deleteWorkspace(
        requireNonEmptyString(workspaceId, 'Workspace id'),
      ));
    } catch (error) {
      return fail<boolean>(error);
    }
  });

  ipcMain.handle(
    EnterpriseLeadWorkspaceIpc.UpdateWorkspaceProfile,
    async (_event, input: { workspaceId?: unknown; profile?: unknown }) => {
      try {
        const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
        return ok(await deps.service.updateWorkspaceProfile(
          workspaceId,
          readWorkspaceProfile(input?.profile),
        ));
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
        return ok(await deps.service.updateWorkspaceSettings(
          workspaceId,
          readSettingsUpdate(input?.settings),
        ));
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
    EnterpriseLeadWorkspaceIpc.Chat,
    async (_event, input: { workspaceId?: unknown; request?: unknown }) => {
      try {
        const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
        return ok(await deps.service.chat(workspaceId, readChatRequest(input?.request)));
      } catch (error) {
        return fail<EnterpriseLeadWorkspaceChatResponse>(error);
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
        return ok(await deps.service.applyPendingVersion(
          requireNonEmptyString(pendingVersionId, 'Pending version id'),
        ));
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
