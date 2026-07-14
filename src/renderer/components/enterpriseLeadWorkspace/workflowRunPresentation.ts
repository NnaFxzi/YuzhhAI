import {
  EnterpriseLeadRunStatus,
  type EnterpriseLeadRunStatus as EnterpriseLeadRunStatusValue,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import {
  DEFAULT_WORKFLOW_START_OPTIONS,
  WorkflowEventType,
  type WorkflowEventType as WorkflowEventTypeValue,
  WorkflowOptionalNode,
  type WorkflowStartOptions,
} from '../../../shared/enterpriseLeadWorkspace/workflowContracts';

export const WorkflowRunMode = {
  Core: 'core',
  Full: 'full',
} as const;
export type WorkflowRunMode = (typeof WorkflowRunMode)[keyof typeof WorkflowRunMode];

export const workflowRunModeOptions: Array<{
  id: WorkflowRunMode;
  labelKey: string;
  descriptionKey: string;
}> = [
  { id: WorkflowRunMode.Core, labelKey: 'enterpriseLeadWorkflowModeCore', descriptionKey: 'enterpriseLeadWorkflowModeCoreDescription' },
  { id: WorkflowRunMode.Full, labelKey: 'enterpriseLeadWorkflowModeFull', descriptionKey: 'enterpriseLeadWorkflowModeFullDescription' },
];

export const getWorkflowStartOptionsForMode = (mode: WorkflowRunMode): WorkflowStartOptions => ({
  ...DEFAULT_WORKFLOW_START_OPTIONS,
  enabledOptionalNodes: mode === WorkflowRunMode.Full ? Object.values(WorkflowOptionalNode) : [],
});

const workflowEventLabelKeys: Record<WorkflowEventTypeValue, string> = {
  [WorkflowEventType.RunStarted]: 'enterpriseLeadWorkflowEventRunStarted',
  [WorkflowEventType.RunRetrying]: 'enterpriseLeadWorkflowEventRunRetrying',
  [WorkflowEventType.TaskReady]: 'enterpriseLeadWorkflowEventTaskReady',
  [WorkflowEventType.TaskStarted]: 'enterpriseLeadWorkflowEventTaskStarted',
  [WorkflowEventType.TaskRetrying]: 'enterpriseLeadWorkflowEventTaskRetrying',
  [WorkflowEventType.TaskCompleted]: 'enterpriseLeadWorkflowEventTaskCompleted',
  [WorkflowEventType.TaskFailed]: 'enterpriseLeadWorkflowEventTaskFailed',
  [WorkflowEventType.TaskBlocked]: 'enterpriseLeadWorkflowEventTaskBlocked',
  [WorkflowEventType.TaskCancelled]: 'enterpriseLeadWorkflowEventTaskCancelled',
  [WorkflowEventType.ApprovalRequired]: 'enterpriseLeadWorkflowEventApprovalRequired',
  [WorkflowEventType.ApprovalRejected]: 'enterpriseLeadWorkflowEventApprovalRejected',
  [WorkflowEventType.RunCompleted]: 'enterpriseLeadWorkflowEventRunCompleted',
  [WorkflowEventType.RunCancelled]: 'enterpriseLeadWorkflowEventRunCancelled',
  [WorkflowEventType.RunError]: 'enterpriseLeadWorkflowEventRunError',
};

const workflowControllerSummaryKeys: Record<EnterpriseLeadRunStatusValue, string> = {
  [EnterpriseLeadRunStatus.Draft]: 'enterpriseLeadWorkflowSummaryDraft',
  [EnterpriseLeadRunStatus.Running]: 'enterpriseLeadWorkflowSummaryRunning',
  [EnterpriseLeadRunStatus.NeedsInput]: 'enterpriseLeadWorkflowSummaryNeedsInput',
  [EnterpriseLeadRunStatus.AwaitingApproval]: 'enterpriseLeadWorkflowSummaryAwaitingApproval',
  [EnterpriseLeadRunStatus.Blocked]: 'enterpriseLeadWorkflowSummaryBlocked',
  [EnterpriseLeadRunStatus.Completed]: 'enterpriseLeadWorkflowSummaryCompleted',
  [EnterpriseLeadRunStatus.Cancelled]: 'enterpriseLeadWorkflowSummaryCancelled',
  [EnterpriseLeadRunStatus.Archived]: 'enterpriseLeadWorkflowSummaryArchived',
  [EnterpriseLeadRunStatus.Error]: 'enterpriseLeadWorkflowSummaryError',
};

const legacyWorkflowControllerSummaryKeys: Record<string, string> = {
  'Promotion workflow is processing ready tasks.': 'enterpriseLeadWorkflowSummaryRunning',
  'Workflow requires manual attention.': 'enterpriseLeadWorkflowSummaryManualAttention',
  'Promotion workflow completed with draft-only outputs.': 'enterpriseLeadWorkflowSummaryCompleted',
};

export const getWorkflowEventLabelKey = (type: string): string =>
  workflowEventLabelKeys[type as WorkflowEventTypeValue] ?? 'enterpriseLeadWorkflowEventUnknown';

export const getWorkflowControllerSummaryKey = (
  status: EnterpriseLeadRunStatusValue,
  legacyControllerSummary?: string,
): string => legacyWorkflowControllerSummaryKeys[legacyControllerSummary ?? ''] ?? workflowControllerSummaryKeys[status];
