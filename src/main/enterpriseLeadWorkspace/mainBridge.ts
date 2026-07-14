import type { EnterpriseLeadWorkspaceService } from './service';

export const createEnterpriseLeadWorkflowHandlerDeps = (
  getService: () => Pick<EnterpriseLeadWorkspaceService, 'startWorkflow' | 'markRunErrorOnce'>,
) => ({
  startWorkflow: (workspaceId: string, runId: string, options: Parameters<EnterpriseLeadWorkspaceService['startWorkflow']>[2]) =>
    getService().startWorkflow(workspaceId, runId, options),
  markRunErrorOnce: (workspaceId: string, runId: string, error: string) =>
    getService().markRunErrorOnce(workspaceId, runId, error),
});
