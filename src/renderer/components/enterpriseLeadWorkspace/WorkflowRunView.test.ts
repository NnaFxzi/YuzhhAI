import { describe, expect, test } from 'vitest';

import { EnterpriseLeadRunStatus } from '../../../shared/enterpriseLeadWorkspace/constants';
import { getWorkflowRunActions } from './WorkflowRunView';

describe('getWorkflowRunActions', () => {
  test.each([
    [EnterpriseLeadRunStatus.Draft, ['resume', 'cancel']],
    [EnterpriseLeadRunStatus.Running, ['cancel']],
    [EnterpriseLeadRunStatus.NeedsInput, ['cancel']],
    [EnterpriseLeadRunStatus.AwaitingApproval, ['cancel']],
    [EnterpriseLeadRunStatus.Blocked, ['cancel']],
    [EnterpriseLeadRunStatus.Completed, []],
    [EnterpriseLeadRunStatus.Cancelled, []],
    [EnterpriseLeadRunStatus.Error, ['retry']],
    [EnterpriseLeadRunStatus.Archived, []],
  ] as const)('%s exposes only real transitions', (status, expected) => {
    expect(getWorkflowRunActions(status)).toEqual(expected);
  });
});
