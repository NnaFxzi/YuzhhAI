import { describe, expect, test, vi } from 'vitest';

import type { EnterpriseLeadWorkspaceSnapshot } from '../../../shared/enterpriseLeadWorkspace/types';
import { startCreatedWorkflowRun } from './workflowRunLifecycle';

const createdSnapshot = { currentRun: { id: 'run-1', status: 'draft' } } as EnterpriseLeadWorkspaceSnapshot;
const completedSnapshot = { currentRun: { id: 'run-1', status: 'completed' } } as EnterpriseLeadWorkspaceSnapshot;

describe('startCreatedWorkflowRun', () => {
  test('activates and subscribes to a created run before a rejected start, then reconciles it', async () => {
    const createRun = vi.fn(async () => createdSnapshot);
    const startWorkflow = vi.fn(async () => { throw new Error('gateway unavailable'); });
    const activateRun = vi.fn();
    const reconcileRun = vi.fn(async () => undefined);

    const result = await startCreatedWorkflowRun({
      createRun,
      startWorkflow,
      activateRun,
      reconcileRun,
      workspaceId: 'workspace-1',
      userGoal: 'Launch a campaign',
      options: { enabledOptionalNodes: [], maxConcurrency: 3 },
    });

    expect(activateRun).toHaveBeenCalledWith('run-1', createdSnapshot);
    expect(startWorkflow).toHaveBeenCalledWith('workspace-1', 'run-1', { enabledOptionalNodes: [], maxConcurrency: 3 });
    expect(activateRun.mock.invocationCallOrder[0]).toBeLessThan(startWorkflow.mock.invocationCallOrder[0]);
    expect(createRun).toHaveBeenCalledTimes(1);
    expect(reconcileRun).toHaveBeenCalledWith('run-1');
    expect(result).toEqual({ runId: 'run-1', error: expect.any(Error) });
  });

  test('reconciles a fast terminal event after start returns an earlier snapshot', async () => {
    let reconciledSnapshot: EnterpriseLeadWorkspaceSnapshot | null = null;
    const reconcileRun = vi.fn(async () => {
      reconciledSnapshot = completedSnapshot;
    });

    const result = await startCreatedWorkflowRun({
      createRun: vi.fn(async () => createdSnapshot),
      startWorkflow: vi.fn(async () => createdSnapshot),
      activateRun: vi.fn(),
      reconcileRun,
      workspaceId: 'workspace-1',
      userGoal: 'Launch a campaign',
      options: { enabledOptionalNodes: [], maxConcurrency: 3 },
    });

    expect(reconcileRun).toHaveBeenCalledWith('run-1');
    expect(reconciledSnapshot?.currentRun?.status).toBe('completed');
    expect(result).toEqual({ runId: 'run-1', error: null });
  });
});
