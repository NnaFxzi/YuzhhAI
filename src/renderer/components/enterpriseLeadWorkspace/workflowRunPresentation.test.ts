import { describe, expect, test } from 'vitest';

import { EnterpriseLeadRunStatus } from '../../../shared/enterpriseLeadWorkspace/constants';
import { WorkflowOptionalNode } from '../../../shared/enterpriseLeadWorkspace/workflowContracts';
import { i18nService } from '../../services/i18n';
import {
  getWorkflowControllerSummaryKey,
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

  test('derives controller copy from structured run status and maps legacy stored display text', () => {
    expect(getWorkflowControllerSummaryKey(EnterpriseLeadRunStatus.Running)).toBe(
      'enterpriseLeadWorkflowSummaryRunning',
    );
    expect(getWorkflowControllerSummaryKey(EnterpriseLeadRunStatus.Completed)).toBe(
      'enterpriseLeadWorkflowSummaryCompleted',
    );
    expect(getWorkflowControllerSummaryKey(
      EnterpriseLeadRunStatus.AwaitingApproval,
      'Workflow requires manual attention.',
    )).toBe('enterpriseLeadWorkflowSummaryManualAttention');
  });

  test('localizes controller summary keys and every legacy controller summary in both supported languages', () => {
    const previousLanguage = i18nService.getLanguage();
    const summaryKey = getWorkflowControllerSummaryKey(EnterpriseLeadRunStatus.AwaitingApproval);
    const legacySummaries = [
      {
        status: EnterpriseLeadRunStatus.Running,
        value: 'Promotion workflow is processing ready tasks.',
        zh: '推广工作流正在处理任务。',
        en: 'Promotion workflow is processing tasks.',
      },
      {
        status: EnterpriseLeadRunStatus.AwaitingApproval,
        value: 'Workflow requires manual attention.',
        zh: '工作流需要人工处理。',
        en: 'Workflow requires human attention.',
      },
      {
        status: EnterpriseLeadRunStatus.Completed,
        value: 'Promotion workflow completed with draft-only outputs.',
        zh: '推广工作流已完成，结果仅为草稿。',
        en: 'Promotion workflow completed with draft-only outputs.',
      },
    ];

    try {
      i18nService.setLanguage('zh', { persist: false });
      expect(i18nService.t(summaryKey)).toBe('工作流正在等待人工审批。');
      legacySummaries.forEach(legacy => {
        expect(i18nService.t(getWorkflowControllerSummaryKey(legacy.status, legacy.value))).toBe(legacy.zh);
      });

      i18nService.setLanguage('en', { persist: false });
      expect(i18nService.t(summaryKey)).toBe('Workflow is awaiting human approval.');
      legacySummaries.forEach(legacy => {
        expect(i18nService.t(getWorkflowControllerSummaryKey(legacy.status, legacy.value))).toBe(legacy.en);
      });
    } finally {
      i18nService.setLanguage(previousLanguage, { persist: false });
    }
  });
});
