import { describe, expect, test } from 'vitest';

import { EnterpriseLeadRunStatus } from '../../../shared/enterpriseLeadWorkspace/constants';
import type { EnterpriseLeadWorkspaceSnapshot } from '../../../shared/enterpriseLeadWorkspace/types';
import { WorkflowEventType } from '../../../shared/enterpriseLeadWorkspace/workflowContracts';
import {
  createWorkflowRunState,
  recoverWorkflowRunState,
  reduceWorkflowRunState,
} from './workflowRunState';
import { getWorkflowRunActions } from './WorkflowRunView';
import {
  createWorkflowSnapshotRefreshGate,
  getWorkflowActionSnapshotRecoverySequence,
  isWorkflowRunSnapshotIdentityCurrent,
} from './workflowSnapshotRefresh';

const createSnapshot = (
  status: EnterpriseLeadRunStatus,
  sequence: number,
): EnterpriseLeadWorkspaceSnapshot => ({
  currentRun: { id: 'run-1', status },
  tasks: [],
  workflowHistory: {
    events: [{
      id: `event-${sequence}`,
      runId: 'run-1',
      sequence,
      type: sequence === 3 ? WorkflowEventType.RunCompleted : WorkflowEventType.RunError,
      createdAt: `2026-07-14T00:00:0${sequence}.000Z`,
    }],
    attempts: [],
  },
} as unknown as EnterpriseLeadWorkspaceSnapshot);

describe('workflow snapshot refresh gate', () => {
  test('rejects an action response after navigation changes the active workspace or run', async () => {
    const actionIdentity = { workspaceId: 'workspace-1', runId: 'run-1' };
    let activeIdentity = actionIdentity;
    const pendingActionResponse = Promise.resolve().then(() =>
      isWorkflowRunSnapshotIdentityCurrent(activeIdentity, actionIdentity));

    activeIdentity = { workspaceId: 'workspace-2', runId: 'run-2' };
    expect(await pendingActionResponse).toBe(false);
    expect(isWorkflowRunSnapshotIdentityCurrent(
      { workspaceId: 'workspace-1', runId: 'run-2' },
      actionIdentity,
    )).toBe(false);
    expect(isWorkflowRunSnapshotIdentityCurrent(actionIdentity, actionIdentity)).toBe(true);
  });

  test('rejects an older event refresh after a newer request arrives', () => {
    const gate = createWorkflowSnapshotRefreshGate();
    gate.requestRefresh('run-1', { eventSequence: 1 });
    const eventRefresh = gate.takeNextRefresh();
    if (!eventRefresh) throw new Error('Expected the first event refresh');

    gate.requestRefresh('run-1', { eventSequence: 2 });

    expect(gate.isCurrentGeneration(eventRefresh.generation)).toBe(false);
  });

  test('coalesces live events and retries the highest unresolved recovery sequence in order', () => {
    const gate = createWorkflowSnapshotRefreshGate();

    gate.requestRefresh('run-1');
    const firstRefresh = gate.takeNextRefresh();
    if (!firstRefresh) throw new Error('Expected the initial refresh');

    gate.requestRefresh('run-1');
    gate.requestRefresh('run-1', { recoverySequence: 4 });
    gate.requestRefresh('run-1', { recoverySequence: 7 });

    expect(gate.takeNextRefresh()).toBeNull();

    gate.completeRefresh(firstRefresh);
    const coalescedRefresh = gate.takeNextRefresh();
    if (!coalescedRefresh) throw new Error('Expected the coalesced refresh');

    expect(coalescedRefresh).toMatchObject({ runId: 'run-1', recoverySequence: 7 });

    gate.completeRefresh(coalescedRefresh, 7);
    expect(gate.takeNextRefresh()).toMatchObject({ runId: 'run-1', recoverySequence: 7 });
    expect(gate.takeNextRefresh()).toBeNull();
  });

  test('coalesces contiguous live-event refreshes without turning them into recovery retries', () => {
    const gate = createWorkflowSnapshotRefreshGate();

    gate.requestRefresh('run-1', { eventSequence: 1 });
    const firstRefresh = gate.takeNextRefresh();
    if (!firstRefresh) throw new Error('Expected the first event refresh');

    gate.requestRefresh('run-1', { eventSequence: 2 });
    gate.requestRefresh('run-1', { eventSequence: 3 });

    expect(gate.isCurrentGeneration(firstRefresh.generation)).toBe(false);

    gate.completeRefresh(firstRefresh);
    expect(gate.takeNextRefresh()).toMatchObject({
      runId: 'run-1',
      eventSequence: 3,
      recoverySequence: undefined,
    });
  });

  test('requeues reconciliation when a retry response predates accepted terminal events', () => {
    const gate = createWorkflowSnapshotRefreshGate();
    const staleErrorSnapshot = createSnapshot(EnterpriseLeadRunStatus.Error, 1);
    const completedSnapshot = createSnapshot(EnterpriseLeadRunStatus.Completed, 3);
    let state = recoverWorkflowRunState(createWorkflowRunState('run-1'), staleErrorSnapshot, 1);

    state = reduceWorkflowRunState(state, {
      runId: 'run-1',
      sequence: 2,
      type: WorkflowEventType.RunRetrying,
      createdAt: '2026-07-14T00:00:02.000Z',
    });
    gate.requestRefresh('run-1', { eventSequence: 2 });
    const activeRefresh = gate.takeNextRefresh();
    if (!activeRefresh) throw new Error('Expected the retry refresh');

    state = reduceWorkflowRunState(state, {
      runId: 'run-1',
      sequence: 3,
      type: WorkflowEventType.RunCompleted,
      createdAt: '2026-07-14T00:00:03.000Z',
    });
    gate.requestRefresh('run-1', { eventSequence: 3 });

    const recoverySequence = getWorkflowActionSnapshotRecoverySequence(state, staleErrorSnapshot);

    expect(recoverySequence).toBe(3);

    gate.requestRefresh('run-1', { eventSequence: recoverySequence });
    gate.completeRefresh(activeRefresh);
    const reconciliationRefresh = gate.takeNextRefresh();
    if (!reconciliationRefresh) throw new Error('Expected a terminal reconciliation refresh');

    const finalState = recoverWorkflowRunState(
      state,
      completedSnapshot,
      reconciliationRefresh.eventSequence,
    );

    expect(finalState.snapshot?.currentRun?.status).toBe(EnterpriseLeadRunStatus.Completed);
    expect(getWorkflowRunActions(finalState.snapshot?.currentRun?.status ?? EnterpriseLeadRunStatus.Error)).toEqual([]);
  });
});
