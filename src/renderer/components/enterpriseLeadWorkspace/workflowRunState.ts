import type { EnterpriseLeadWorkspaceSnapshot } from '../../../shared/enterpriseLeadWorkspace/types';
import type { WorkflowEventProjection } from '../../../shared/enterpriseLeadWorkspace/workflowContracts';

export interface WorkflowRunState {
  runId: string;
  snapshot: EnterpriseLeadWorkspaceSnapshot | null;
  events: WorkflowEventProjection[];
  lastEvent: WorkflowEventProjection | null;
  lastSequence: number;
  snapshotSequence: number;
  recoverySequence: number;
  needsSnapshotRecovery: boolean;
}

export const createWorkflowRunState = (runId: string): WorkflowRunState => ({
  runId,
  snapshot: null,
  events: [],
  lastEvent: null,
  lastSequence: 0,
  snapshotSequence: 0,
  recoverySequence: 0,
  needsSnapshotRecovery: false,
});

export const reduceWorkflowRunState = (
  state: WorkflowRunState,
  event: WorkflowEventProjection | null,
): WorkflowRunState => {
  if (!event || event.runId !== state.runId || !Number.isInteger(event.sequence) || event.sequence < 1) {
    return state;
  }

  if (event.sequence <= state.lastSequence) {
    return state;
  }

  if (state.needsSnapshotRecovery) {
    return {
      ...state,
      recoverySequence: Math.max(state.recoverySequence, event.sequence),
    };
  }

  if (event.sequence !== state.lastSequence + 1) {
    return {
      ...state,
      needsSnapshotRecovery: true,
      recoverySequence: Math.max(state.recoverySequence, event.sequence),
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
): WorkflowRunState => {
  const historyEvents = snapshot?.workflowHistory?.events ?? [];
  const historyLastEvent = historyEvents[historyEvents.length - 1] ?? null;
  const historyLastSequence = historyLastEvent?.sequence ?? 0;
  const recoverySequence = Math.max(
    state.recoverySequence,
    Number.isInteger(recoveredSequence) ? recoveredSequence : 0,
  );
  if (historyLastSequence < state.snapshotSequence || historyLastSequence < recoverySequence) {
    return {
      ...state,
      lastSequence: Math.max(state.lastSequence, recoverySequence),
      needsSnapshotRecovery: state.needsSnapshotRecovery || historyLastSequence < recoverySequence,
      recoverySequence,
    };
  }
  return {
    ...state,
    snapshot,
    events: historyEvents,
    lastEvent: historyLastEvent,
    lastSequence: Math.max(
      state.lastSequence,
      historyLastSequence,
      recoverySequence,
    ),
    snapshotSequence: historyLastSequence,
    recoverySequence: 0,
    needsSnapshotRecovery: false,
  };
};

export const setWorkflowRunSnapshot = (
  state: WorkflowRunState,
  snapshot: EnterpriseLeadWorkspaceSnapshot | null,
): WorkflowRunState => {
  if (!snapshot?.workflowHistory) return { ...state, snapshot };
  return recoverWorkflowRunState(state, snapshot);
};
