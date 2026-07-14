import type { EnterpriseLeadWorkspaceService } from './service';

export const createEnterpriseLeadWorkflowHandlerDeps = (
  getService: () => Pick<EnterpriseLeadWorkspaceService, 'startWorkflow' | 'markRunError'>,
) => ({
  startWorkflow: (workspaceId: string, runId: string, options: Parameters<EnterpriseLeadWorkspaceService['startWorkflow']>[2]) =>
    getService().startWorkflow(workspaceId, runId, options),
  markRunError: (workspaceId: string, runId: string, error: string) =>
    getService().markRunError(workspaceId, runId, error),
});
