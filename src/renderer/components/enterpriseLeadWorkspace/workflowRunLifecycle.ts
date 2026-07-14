import type { EnterpriseLeadWorkspaceSnapshot } from '../../../shared/enterpriseLeadWorkspace/types';
import type { WorkflowStartOptions } from '../../../shared/enterpriseLeadWorkspace/workflowContracts';

interface StartCreatedWorkflowRunInput {
  workspaceId: string;
  userGoal: string;
  options: WorkflowStartOptions;
  createRun: (workspaceId: string, userGoal: string) => Promise<EnterpriseLeadWorkspaceSnapshot | null>;
  startWorkflow: (
    workspaceId: string,
    runId: string,
    options: WorkflowStartOptions,
  ) => Promise<EnterpriseLeadWorkspaceSnapshot | null>;
  activateRun: (runId: string, snapshot: EnterpriseLeadWorkspaceSnapshot) => void;
  reconcileRun: (runId: string) => Promise<void>;
}

export interface StartCreatedWorkflowRunResult {
  runId: string | null;
  error: Error | null;
}

export const startCreatedWorkflowRun = async ({
  workspaceId,
  userGoal,
  options,
  createRun,
  startWorkflow,
  activateRun,
  reconcileRun,
}: StartCreatedWorkflowRunInput): Promise<StartCreatedWorkflowRunResult> => {
  const created = await createRun(workspaceId, userGoal);
  const runId = created?.currentRun?.id;
  if (!created || !runId) {
    return { runId: null, error: new Error('missing workflow run') };
  }

  activateRun(runId, created);
  try {
    await startWorkflow(workspaceId, runId, options);
    return { runId, error: null };
  } catch (error) {
    return { runId, error: error instanceof Error ? error : new Error('workflow start failed') };
  } finally {
    await reconcileRun(runId);
  }
};
