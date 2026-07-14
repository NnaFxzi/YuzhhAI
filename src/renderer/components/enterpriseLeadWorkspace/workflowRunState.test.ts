import { describe, expect, test } from 'vitest';

import type { EnterpriseLeadWorkspaceSnapshot } from '../../../shared/enterpriseLeadWorkspace/types';
import type { WorkflowEvent } from '../../../shared/enterpriseLeadWorkspace/workflowContracts';
import {
  createWorkflowRunState,
  recoverWorkflowRunState,
  reduceWorkflowRunState,
  setWorkflowRunSnapshot,
} from './workflowRunState';

const createEvent = (overrides: Partial<WorkflowEvent> = {}): WorkflowEvent => ({
  runId: 'run-1',
  sequence: 1,
  type: 'task_started',
  taskId: 'task-1',
  createdAt: '2026-07-12T00:00:00.000Z',
  ...overrides,
});

describe('workflowRunState', () => {
  test('ignores duplicate and foreign run events', () => {
    const initial = createWorkflowRunState('run-1');
    const afterForeign = reduceWorkflowRunState(initial, createEvent({ runId: 'run-2' }));
    const afterStarted = reduceWorkflowRunState(initial, createEvent());

    expect(afterForeign).toEqual(initial);
    expect(reduceWorkflowRunState(afterStarted, afterStarted.lastEvent)).toEqual(afterStarted);
  });

  test('marks a sequence gap for snapshot recovery without applying the event', () => {
    const started = reduceWorkflowRunState(createWorkflowRunState('run-1'), createEvent());
    const afterGap = reduceWorkflowRunState(
      started,
      createEvent({ sequence: 3, type: 'task_completed' }),
    );

    expect(afterGap.events).toEqual(started.events);
    expect(afterGap.needsSnapshotRecovery).toBe(true);
  });

  test('keeps recovery pending through a later terminal event until a snapshot reaches its sequence', () => {
    const started = reduceWorkflowRunState(createWorkflowRunState('run-1'), createEvent());
    const afterGap = reduceWorkflowRunState(started, createEvent({ sequence: 3 }));
    const afterTerminal = reduceWorkflowRunState(
      afterGap,
      createEvent({ sequence: 4, type: 'run_completed' }),
    );
    const firstGapSnapshot = {
      workflowHistory: {
        events: [createEvent({ sequence: 3 })],
        attempts: [],
      },
    } as unknown as EnterpriseLeadWorkspaceSnapshot;
    const finalSnapshot = {
      workflowHistory: {
        events: [createEvent({ sequence: 4, type: 'run_completed' })],
        attempts: [],
      },
    } as unknown as EnterpriseLeadWorkspaceSnapshot;

    const afterFirstRefresh = recoverWorkflowRunState(afterTerminal, firstGapSnapshot, 3);
    const finalRefresh = recoverWorkflowRunState(afterFirstRefresh, finalSnapshot, 4);

    expect(afterTerminal.recoverySequence).toBe(4);
    expect(afterFirstRefresh.needsSnapshotRecovery).toBe(true);
    expect(afterFirstRefresh.recoverySequence).toBe(4);
    expect(finalRefresh.needsSnapshotRecovery).toBe(false);
    expect(finalRefresh.lastSequence).toBe(4);
  });

  test('uses a recovered snapshot as the authoritative state after a sequence gap', () => {
    const afterGap = reduceWorkflowRunState(
      createWorkflowRunState('run-1'),
      createEvent({ sequence: 3 }),
    );

    const recovered = recoverWorkflowRunState(afterGap, null, 3);

    expect(recovered.needsSnapshotRecovery).toBe(true);
    expect(recovered.lastSequence).toBe(3);
    expect(recovered.events).toEqual([]);
  });

  test('does not let an older snapshot replace newer terminal state or clear a gap recovery', () => {
    const terminalSnapshot = {
      currentRun: { id: 'run-1', status: 'completed' },
      workflowHistory: {
        events: [
          { id: 'event-5', runId: 'run-1', sequence: 5, type: 'run_completed', createdAt: '2026-07-14T00:00:05.000Z' },
        ],
        attempts: [],
      },
    } as unknown as EnterpriseLeadWorkspaceSnapshot;
    const staleSnapshot = {
      currentRun: { id: 'run-1', status: 'running' },
      workflowHistory: {
        events: [
          { id: 'event-2', runId: 'run-1', sequence: 2, type: 'task_started', createdAt: '2026-07-14T00:00:02.000Z' },
        ],
        attempts: [],
      },
    } as unknown as EnterpriseLeadWorkspaceSnapshot;

    const terminal = recoverWorkflowRunState(createWorkflowRunState('run-1'), terminalSnapshot, 5);
    const afterStaleRefresh = recoverWorkflowRunState(terminal, staleSnapshot, 3);
    const afterGap = reduceWorkflowRunState(terminal, createEvent({ sequence: 7 }));
    const staleRecovery = recoverWorkflowRunState(afterGap, staleSnapshot, 7);

    expect(afterStaleRefresh.snapshot?.currentRun?.status).toBe('completed');
    expect(afterStaleRefresh.events).toEqual(terminal.events);
    expect(afterStaleRefresh.lastSequence).toBe(5);
    expect(staleRecovery.needsSnapshotRecovery).toBe(true);
    expect(staleRecovery.snapshot?.currentRun?.status).toBe('completed');
  });

  test('hydrates persisted history during snapshot recovery and resumes after its last sequence', () => {
    const snapshot = {
      workflowHistory: {
        events: [
          {
            id: 'event-4',
            runId: 'run-1',
            sequence: 4,
            type: 'approval_rejected',
            feedback: 'Add sources.',
            createdAt: '2026-07-14T00:00:00.000Z',
          },
        ],
        attempts: [],
      },
    } as unknown as EnterpriseLeadWorkspaceSnapshot;
    const history = snapshot.workflowHistory!;

    const recovered = recoverWorkflowRunState(createWorkflowRunState('run-1'), snapshot, 3);
    const next = reduceWorkflowRunState(recovered, createEvent({ sequence: 5 }));

    expect(recovered.events).toEqual(history.events);
    expect(recovered.lastSequence).toBe(4);
    expect(next.lastSequence).toBe(5);
    expect(setWorkflowRunSnapshot(next, snapshot).events).toEqual(next.events);
  });
});
