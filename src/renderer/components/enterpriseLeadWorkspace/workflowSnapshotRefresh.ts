import type { EnterpriseLeadWorkspaceSnapshot } from '../../../shared/enterpriseLeadWorkspace/types';
import type { WorkflowRunState } from './workflowRunState';

export interface WorkflowSnapshotRefreshRequest {
  generation: number;
  runId: string;
  eventSequence?: number;
  recoverySequence?: number;
  reportError: boolean;
}

export interface WorkflowSnapshotRefreshOptions {
  eventSequence?: number;
  recoverySequence?: number;
  reportError?: boolean;
}

export interface WorkflowRunSnapshotIdentity {
  workspaceId: string;
  runId: string;
}

export interface WorkflowSnapshotRefreshGate {
  isCurrentGeneration: (generation: number) => boolean;
  requestRefresh: (runId: string, options?: WorkflowSnapshotRefreshOptions) => void;
  takeNextRefresh: () => WorkflowSnapshotRefreshRequest | null;
  completeRefresh: (
    request: WorkflowSnapshotRefreshRequest,
    retryRecoverySequence?: number,
  ) => void;
  reset: () => void;
}

export const getWorkflowActionSnapshotRecoverySequence = (
  state: WorkflowRunState,
  snapshot: EnterpriseLeadWorkspaceSnapshot | null,
): number | undefined => {
  const snapshotSequence = snapshot?.workflowHistory?.events.reduce(
    (highestSequence, event) => Number.isInteger(event.sequence)
      ? Math.max(highestSequence, event.sequence)
      : highestSequence,
    0,
  ) ?? 0;

  return snapshotSequence < state.lastSequence ? state.lastSequence : undefined;
};

export const isWorkflowRunSnapshotIdentityCurrent = (
  current: WorkflowRunSnapshotIdentity,
  action: WorkflowRunSnapshotIdentity,
): boolean =>
  current.workspaceId === action.workspaceId && current.runId === action.runId;

export const createWorkflowSnapshotRefreshGate = (): WorkflowSnapshotRefreshGate => {
  let latestGeneration = 0;
  let activeRefresh: WorkflowSnapshotRefreshRequest | null = null;
  let pendingRefresh: WorkflowSnapshotRefreshRequest | null = null;

  const requestRefresh = (
    runId: string,
    options: WorkflowSnapshotRefreshOptions = {},
  ): void => {
    latestGeneration += 1;
    const refresh: WorkflowSnapshotRefreshRequest = {
      generation: latestGeneration,
      runId,
      eventSequence: options.eventSequence,
      recoverySequence: options.recoverySequence,
      reportError: options.reportError ?? true,
    };
    if (pendingRefresh?.runId === runId) {
      pendingRefresh = {
        ...pendingRefresh,
        generation: refresh.generation,
        eventSequence: Math.max(
          pendingRefresh.eventSequence ?? 0,
          refresh.eventSequence ?? 0,
        ) || undefined,
        recoverySequence: Math.max(
          pendingRefresh.recoverySequence ?? 0,
          refresh.recoverySequence ?? 0,
        ) || undefined,
        reportError: pendingRefresh.reportError || refresh.reportError,
      };
      return;
    }
    pendingRefresh = refresh;
  };

  return {
    isCurrentGeneration: generation => generation === latestGeneration,
    requestRefresh,
    takeNextRefresh: () => {
      if (activeRefresh || !pendingRefresh) return null;
      const refresh = pendingRefresh;
      pendingRefresh = null;
      activeRefresh = refresh;
      return refresh;
    },
    completeRefresh: (request, retryRecoverySequence) => {
      if (activeRefresh?.generation !== request.generation) return;
      activeRefresh = null;
      if (retryRecoverySequence !== undefined) {
        requestRefresh(request.runId, {
          eventSequence: retryRecoverySequence,
          recoverySequence: retryRecoverySequence,
          reportError: request.reportError,
        });
      }
    },
    reset: () => {
      latestGeneration += 1;
      activeRefresh = null;
      pendingRefresh = null;
    },
  };
};
