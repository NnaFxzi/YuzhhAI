import { describe, expect, test } from 'vitest';

import { createWorkflowSnapshotRefreshGate } from './workflowSnapshotRefresh';

describe('workflow snapshot refresh gate', () => {
  test('rejects an older event refresh after a newer refresh has started', () => {
    const gate = createWorkflowSnapshotRefreshGate();
    const eventRefresh = gate.nextGeneration();
    const newerRefresh = gate.nextGeneration();

    expect(gate.isCurrentGeneration(eventRefresh)).toBe(false);
    expect(gate.isCurrentGeneration(newerRefresh)).toBe(true);
  });
});
