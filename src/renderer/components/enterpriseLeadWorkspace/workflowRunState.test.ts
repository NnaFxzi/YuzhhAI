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

  test('uses a recovered snapshot as the authoritative state after a sequence gap', () => {
    const afterGap = reduceWorkflowRunState(
      createWorkflowRunState('run-1'),
      createEvent({ sequence: 3 }),
    );

    const recovered = recoverWorkflowRunState(afterGap, null, 3);

    expect(recovered.needsSnapshotRecovery).toBe(false);
    expect(recovered.lastSequence).toBe(3);
    expect(recovered.events).toEqual([]);
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
    expect(setWorkflowRunSnapshot(next, snapshot).events).toEqual(history.events);
  });
});
