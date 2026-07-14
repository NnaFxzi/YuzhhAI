import { ipcMain } from 'electron';

import { CoworkIpcChannel } from '../../../shared/cowork/constants';

export interface CoworkSubagentRuntimeAdapter {
  getSubTaskHistory: (
    parentSessionId: string,
    runId: string,
    sessionKey?: string,
  ) => Promise<unknown>;
  listSubagentRuns: (parentSessionId: string) => unknown[];
}

export interface CoworkSubagentEngineRouter {
  getWorkflowTaskSubagentSession: (
    parentSessionId: string,
    workflowRunId: string,
    taskId: string,
  ) => unknown | null;
  deleteSubagentSession: (parentSessionId: string, runId: string) => Promise<boolean>;
}

export interface CoworkSubagentHandlerDeps {
  getOpenClawRuntimeAdapter: () => CoworkSubagentRuntimeAdapter | null;
  getCoworkEngineRouter: () => CoworkSubagentEngineRouter;
}

export function registerCoworkSubagentHandlers(deps: CoworkSubagentHandlerDeps): void {
  const { getOpenClawRuntimeAdapter, getCoworkEngineRouter } = deps;

  ipcMain.handle(
    CoworkIpcChannel.SubTaskHistory,
    async (
      _event,
      options: {
        parentSessionId: string;
        runId: string;
        sessionKey?: string;
      },
    ) => {
      const adapter = getOpenClawRuntimeAdapter();
      if (!adapter) {
        return { success: false, error: 'Runtime adapter not available' };
      }
      try {
        const messages = await adapter.getSubTaskHistory(
          options.parentSessionId,
          options.runId,
          options.sessionKey,
        );
        return { success: true, messages };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch subagent history',
        };
      }
    },
  );

  ipcMain.handle(CoworkIpcChannel.SubagentList, async (_event, options: { parentSessionId: string }) => {
    const adapter = getOpenClawRuntimeAdapter();
    if (!adapter) return { success: true, runs: [] };
    const runs = adapter.listSubagentRuns(options.parentSessionId);
    return { success: true, runs };
  });

  ipcMain.handle(
    CoworkIpcChannel.SubagentWorkflowTaskGet,
    async (_event, options: { parentSessionId: string; workflowRunId: string; taskId: string }) => {
      const parentSessionId = options?.parentSessionId?.trim();
      const workflowRunId = options?.workflowRunId?.trim();
      const taskId = options?.taskId?.trim();
      if (!parentSessionId || !workflowRunId || !taskId) {
        return { success: false, error: 'Workflow task lookup requires parentSessionId, workflowRunId, and taskId' };
      }
      const run = getCoworkEngineRouter().getWorkflowTaskSubagentSession(
        parentSessionId,
        workflowRunId,
        taskId,
      );
      return { success: true, run };
    },
  );

  ipcMain.handle(
    CoworkIpcChannel.SubagentDelete,
    async (_event, options: { parentSessionId: string; runId: string }) => {
      const adapter = getOpenClawRuntimeAdapter();
      if (!adapter) {
        return { success: false, error: 'Runtime adapter not available' };
      }
      try {
        const deleted = await getCoworkEngineRouter().deleteSubagentSession(
          options.parentSessionId,
          options.runId,
        );
        return { success: true, deleted };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete subagent session',
        };
      }
    },
  );
}
