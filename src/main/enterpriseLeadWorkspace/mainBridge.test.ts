import { describe, expect, test, vi } from 'vitest';

import type { WorkflowStartOptions } from '../../shared/enterpriseLeadWorkspace/workflowContracts';
import { createEnterpriseLeadWorkflowHandlerDeps } from './mainBridge';

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
});
