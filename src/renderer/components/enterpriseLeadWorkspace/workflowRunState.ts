import type { EnterpriseLeadWorkspaceSnapshot } from '../../../shared/enterpriseLeadWorkspace/types';
import type { WorkflowEvent } from '../../../shared/enterpriseLeadWorkspace/workflowContracts';

export interface WorkflowRunState {
  runId: string;
  snapshot: EnterpriseLeadWorkspaceSnapshot | null;
  events: WorkflowEvent[];
  lastEvent: WorkflowEvent | null;
  lastSequence: number;
  needsSnapshotRecovery: boolean;
}

export const createWorkflowRunState = (runId: string): WorkflowRunState => ({
  runId,
  snapshot: null,
  events: [],
  lastEvent: null,
  lastSequence: 0,
  needsSnapshotRecovery: false,
});

export const reduceWorkflowRunState = (
  state: WorkflowRunState,
  event: WorkflowEvent | null,
): WorkflowRunState => {
  if (!event || event.runId !== state.runId || !Number.isInteger(event.sequence) || event.sequence < 1) {
    return state;
  }

  if (event.sequence <= state.lastSequence || state.needsSnapshotRecovery) {
    return state;
  }

  if (event.sequence !== state.lastSequence + 1) {
    return {
      ...state,
      needsSnapshotRecovery: true,
    };
  }

  return {
    ...state,
    events: [...state.events, event],
    lastEvent: event,
    lastSequence: event.sequence,
  };
};

export const recoverWorkflowRunState = (
  state: WorkflowRunState,
  snapshot: EnterpriseLeadWorkspaceSnapshot | null,
  recoveredSequence: number = state.lastSequence,
): WorkflowRunState => ({
  ...state,
  snapshot,
  events: [],
  lastEvent: null,
  lastSequence:
    Number.isInteger(recoveredSequence) && recoveredSequence >= state.lastSequence
      ? recoveredSequence
      : state.lastSequence,
  needsSnapshotRecovery: false,
});

export const setWorkflowRunSnapshot = (
  state: WorkflowRunState,
  snapshot: EnterpriseLeadWorkspaceSnapshot | null,
): WorkflowRunState => ({
  ...state,
  snapshot,
});
