import { describe, expect, test } from 'vitest';

import { WorkflowOptionalNode } from '../../../shared/enterpriseLeadWorkspace/workflowContracts';
import {
  getWorkflowEventLabelKey,
  getWorkflowStartOptionsForMode,
  workflowRunModeOptions,
} from './workflowRunPresentation';

describe('workflow run presentation', () => {
  test('advertises only distinct supported workflow start modes', () => {
    expect(workflowRunModeOptions).toHaveLength(2);
    expect(getWorkflowStartOptionsForMode(workflowRunModeOptions[0].id).enabledOptionalNodes).toEqual([]);
    expect(getWorkflowStartOptionsForMode(workflowRunModeOptions[1].id).enabledOptionalNodes).toEqual(
      Object.values(WorkflowOptionalNode),
    );
  });

  test('maps every visible workflow event type to a localized label key with a safe fallback', () => {
    expect(getWorkflowEventLabelKey('run_retrying')).toBe('enterpriseLeadWorkflowEventRunRetrying');
    expect(getWorkflowEventLabelKey('approval_rejected')).toBe('enterpriseLeadWorkflowEventApprovalRejected');
    expect(getWorkflowEventLabelKey('unknown_event')).toBe('enterpriseLeadWorkflowEventUnknown');
  });
});
