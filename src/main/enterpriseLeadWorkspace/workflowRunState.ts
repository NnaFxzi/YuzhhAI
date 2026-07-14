import {
  EnterpriseLeadRunStatus,
  type EnterpriseLeadRunStatus as EnterpriseLeadRunStatusValue,
} from '../../shared/enterpriseLeadWorkspace/constants';

export const WorkflowRunActiveStatuses = [
  EnterpriseLeadRunStatus.Draft,
  EnterpriseLeadRunStatus.Running,
  EnterpriseLeadRunStatus.NeedsInput,
  EnterpriseLeadRunStatus.AwaitingApproval,
  EnterpriseLeadRunStatus.Blocked,
] as const satisfies readonly EnterpriseLeadRunStatusValue[];

export const WorkflowRunTerminalStatuses = [
  EnterpriseLeadRunStatus.Completed,
  EnterpriseLeadRunStatus.Cancelled,
  EnterpriseLeadRunStatus.Error,
  EnterpriseLeadRunStatus.Archived,
] as const satisfies readonly EnterpriseLeadRunStatusValue[];

export const isWorkflowRunActive = (status: EnterpriseLeadRunStatusValue): boolean =>
  (WorkflowRunActiveStatuses as readonly EnterpriseLeadRunStatusValue[]).includes(status);

export const isWorkflowRunTerminal = (status: EnterpriseLeadRunStatusValue): boolean =>
  (WorkflowRunTerminalStatuses as readonly EnterpriseLeadRunStatusValue[]).includes(status);

export const canProgressWorkflowRun = (
  currentStatus: EnterpriseLeadRunStatusValue,
  nextStatus: EnterpriseLeadRunStatusValue,
): boolean =>
  isWorkflowRunActive(currentStatus) && nextStatus !== EnterpriseLeadRunStatus.Archived;
