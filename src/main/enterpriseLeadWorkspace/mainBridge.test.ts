import { describe, expect, test, vi } from 'vitest';

import type { EnterpriseLeadWorkflowEvent } from '../../shared/enterpriseLeadWorkspace/types';
import type { WorkflowStartOptions } from '../../shared/enterpriseLeadWorkspace/workflowContracts';
import {
  createEnterpriseLeadWorkflowEventDeps,
  createEnterpriseLeadWorkflowHandlerDeps,
} from './mainBridge';

describe('createEnterpriseLeadWorkflowHandlerDeps', () => {
  test('forwards requested start options to the graph-aware service method', async () => {
    const options: WorkflowStartOptions = {
      enabledOptionalNodes: ['sales_handoff_requested'],
      maxConcurrency: 2,
    };
    const service = {
      startWorkflow: vi.fn(),
      runWorkflow: vi.fn(),
      markRunError: vi.fn(),
    };
    const deps = createEnterpriseLeadWorkflowHandlerDeps(() => service);

    await deps.startWorkflow('workspace-1', 'run-1', options);

    expect(service.startWorkflow).toHaveBeenCalledWith('workspace-1', 'run-1', options);
    expect(service.runWorkflow).not.toHaveBeenCalled();
  });

  test('defers workflow artifact store initialization until events are requested', () => {
    const events: EnterpriseLeadWorkflowEvent[] = [{
      runId: 'run-1',
      sequence: 1,
      type: 'run_started',
      createdAt: '2026-07-14T00:00:00.000Z',
    }];
    const listEvents = vi.fn(() => events);
    const getArtifactStore = vi.fn(() => ({ listEvents }));

    const deps = createEnterpriseLeadWorkflowEventDeps(getArtifactStore);
    expect(getArtifactStore).not.toHaveBeenCalled();

    expect(deps.listWorkflowEvents('run-1')).toEqual(events);
    expect(getArtifactStore).toHaveBeenCalledTimes(1);
    expect(listEvents).toHaveBeenCalledWith('run-1');
  });
});
