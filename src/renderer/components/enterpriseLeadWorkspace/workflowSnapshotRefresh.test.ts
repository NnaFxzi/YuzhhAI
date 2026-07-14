import { describe, expect, test } from 'vitest';

import { createWorkflowSnapshotRefreshGate } from './workflowSnapshotRefresh';

describe('workflow snapshot refresh gate', () => {
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
});
