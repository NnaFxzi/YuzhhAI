import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadRunStatus,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { getWorkflowRunActions } from './WorkflowRunView';

const createWorkspace = (): EnterpriseLeadWorkspace => ({
  id: 'workspace-1',
  name: 'Workspace 1',
  type: 'enterprise_lead',
  profile: {
    companySummary: '',
    productList: [],
    productCapabilities: [],
    targetCustomers: [],
    applicationScenarios: [],
    sellingPoints: [],
    channelPreferences: [],
    prohibitedClaims: [],
    contactRules: [],
    missingInfo: [],
  },
  extractionSources: [],
  riskRules: [],
  enabledAgentRoles: [],
  settings: {} as EnterpriseLeadWorkspace['settings'],
  workspaceAgents: [],
  recentRunId: 'run-1',
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
});

const createSnapshot = (
  workspace: EnterpriseLeadWorkspace,
  overrides: Partial<NonNullable<EnterpriseLeadWorkspaceSnapshot['currentRun']>> = {},
): EnterpriseLeadWorkspaceSnapshot => ({
  workspace,
  currentRun: {
    id: 'run-1',
    workspaceId: workspace.id,
    userGoal: 'Recover the workflow view',
    status: EnterpriseLeadRunStatus.Running,
    currentRole: EnterpriseLeadAgentRole.PromotionController,
    controllerSummary: 'Provider error',
    archiveStatus: 'not_archived',
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  },
  tasks: [],
  pendingVersions: [],
  deliverables: [],
  todos: [],
  archives: [],
});

const createApprovalTask = (): EnterpriseLeadAgentTask => ({
  id: 'task-1',
  runId: 'run-1',
  role: EnterpriseLeadAgentRole.ContentPlanning,
  workspaceAgentId: null,
  agentSnapshot: null,
  status: 'awaiting_approval',
  inputPayload: {},
  outputPayload: {},
  summary: '',
  missingInfo: [],
  todos: [],
  risks: [],
  handoffContext: {},
  error: '',
  stale: false,
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
});

const renderWorkflowRun = async (snapshot: EnterpriseLeadWorkspaceSnapshot): Promise<{
  markup: string;
  t: (key: string) => string;
}> => {
  await vi.resetModules();
  vi.doMock('./workflowRunState', async () => {
    const actual = await vi.importActual<typeof import('./workflowRunState')>('./workflowRunState');
    return {
      ...actual,
      createWorkflowRunState: () => ({
        ...actual.createWorkflowRunState('run-1'),
        snapshot,
      }),
    };
  });

  const { i18nService } = await import('../../services/i18n');
  const { WorkflowRunView } = await import('./WorkflowRunView');
  const markup = renderToStaticMarkup(
    React.createElement(WorkflowRunView, { workspace: snapshot.workspace, onOpenCowork: vi.fn() }),
  );

  vi.doUnmock('./workflowRunState');
  return { markup, t: key => i18nService.t(key) };
};

describe('getWorkflowRunActions', () => {
  test('does not render the removed workflow navigation label', async () => {
    const workspace = createWorkspace();
    const { markup } = await renderWorkflowRun(createSnapshot(workspace));

    expect(markup).not.toContain('enterpriseLeadWorkbenchNavWorkflow');
  });

  test.each([
    [EnterpriseLeadRunStatus.Draft, ['resume', 'cancel']],
    [EnterpriseLeadRunStatus.Running, ['cancel']],
    [EnterpriseLeadRunStatus.NeedsInput, ['cancel']],
    [EnterpriseLeadRunStatus.AwaitingApproval, ['resume', 'cancel']],
    [EnterpriseLeadRunStatus.Blocked, ['cancel']],
    [EnterpriseLeadRunStatus.Completed, []],
    [EnterpriseLeadRunStatus.Cancelled, []],
    [EnterpriseLeadRunStatus.Error, ['retry']],
    [EnterpriseLeadRunStatus.Archived, []],
  ] as const)('%s exposes only real transitions', (status, expected) => {
    expect(getWorkflowRunActions(status)).toEqual(expected);
  });

  test('renders Resume alongside Cancel while an approval decision awaits downstream continuation', async () => {
    const workspace = createWorkspace();
    const { markup, t } = await renderWorkflowRun(createSnapshot(workspace, {
      status: EnterpriseLeadRunStatus.AwaitingApproval,
    }));

    expect(markup).toContain(t('enterpriseLeadWorkflowResume'));
    expect(markup).toContain(t('enterpriseLeadWorkflowCancel'));
  });

  test('renders no workflow or approval controls when archive status is archived', async () => {
    const workspace = createWorkspace();
    const snapshot = createSnapshot(workspace, {
      status: EnterpriseLeadRunStatus.AwaitingApproval,
      archiveStatus: 'archived',
    });
    snapshot.tasks = [createApprovalTask()];

    const { markup, t } = await renderWorkflowRun(snapshot);

    expect(markup).not.toContain(t('enterpriseLeadWorkflowResume'));
    expect(markup).not.toContain(t('enterpriseLeadWorkflowCancel'));
    expect(markup).not.toContain(t('enterpriseLeadWorkflowRetry'));
    expect(markup).not.toContain(t('enterpriseLeadWorkflowApprove'));
    expect(markup).not.toContain(t('enterpriseLeadWorkflowReject'));
  });

  test('localizes known attempt statuses and hides unknown persisted attempt values', async () => {
    const workspace = createWorkspace();
    const snapshot = createSnapshot(workspace);
    snapshot.workflowHistory = {
      events: [],
      attempts: [
        {
          id: 'attempt-1',
          taskId: 'task-1',
          attempt: 1,
          executionMode: 'inline',
          status: 'completed',
          startedAt: '2026-07-14T00:00:00.000Z',
          endedAt: '2026-07-14T00:01:00.000Z',
        },
        {
          id: 'attempt-2',
          taskId: 'task-2',
          attempt: 2,
          executionMode: 'inline',
          status: 'provider_failure: api-key=secret',
          startedAt: '2026-07-14T00:01:00.000Z',
          endedAt: '2026-07-14T00:02:00.000Z',
        },
      ],
    };

    const { markup, t } = await renderWorkflowRun(snapshot);

    expect(markup).toContain(t('enterpriseLeadWorkflowHistoryAttempt')
      .replace('{count}', '1')
      .replace('{status}', t('enterpriseLeadAgentStatusCompleted')));
    expect(markup).toContain(t('enterpriseLeadWorkflowHistoryAttempt')
      .replace('{count}', '2')
      .replace('{status}', t('enterpriseLeadWorkflowSummaryManualAttention')));
    expect(markup).not.toContain('provider_failure: api-key=secret');
  });

  test('renders a safe fallback with no actions for an unknown persisted status', async () => {
    const workspace = createWorkspace();
    const { markup, t } = await renderWorkflowRun(createSnapshot(workspace, {
      status: 'provider_failure' as EnterpriseLeadRunStatus,
    }));

    expect(markup).toContain(t('enterpriseLeadWorkflowSummaryManualAttention'));
    expect(getWorkflowRunActions('provider_failure' as EnterpriseLeadRunStatus)).toEqual([]);
    expect(markup).not.toContain(t('enterpriseLeadWorkflowResume'));
    expect(markup).not.toContain(t('enterpriseLeadWorkflowCancel'));
    expect(markup).not.toContain(t('enterpriseLeadWorkflowRetry'));
  });

  test('localizes structured monitoring summaries instead of exposing service summary codes', async () => {
    const workspace = createWorkspace();
    const snapshot = createSnapshot(workspace, {
      status: EnterpriseLeadRunStatus.NeedsInput,
      controllerSummary: 'promotion_monitoring_review_blocked',
    });
    snapshot.tasks = [{
      ...createApprovalTask(),
      role: EnterpriseLeadAgentRole.PromotionAccountMonitoring,
      status: 'needs_input',
      summary: 'promotion_monitoring_needs_verified_input',
      missingInfo: ['metric_period', 'provider_failure: api-key=secret'],
    }];

    const { markup, t } = await renderWorkflowRun(snapshot);

    expect(markup).toContain(t('enterpriseLeadWorkflowMonitoringNeedsInput'));
    expect(markup).toContain(t('enterpriseLeadWorkflowMonitoringReviewBlocked'));
    expect(markup).not.toContain('promotion_monitoring_needs_verified_input');
    expect(markup).not.toContain('promotion_monitoring_review_blocked');
    expect(markup).not.toContain('metric_period');
    expect(markup).not.toContain('provider_failure: api-key=secret');
    expect(markup).toContain(t('enterpriseLeadWorkflowMonitoringReasonMetricPeriod'));
    expect(markup).toContain(t('enterpriseLeadWorkflowMonitoringReasonGeneric'));
  });

  test('describes an awaiting performance review as a user knowledge confirmation', async () => {
    const workspace = createWorkspace();
    const snapshot = createSnapshot(workspace, { status: EnterpriseLeadRunStatus.AwaitingApproval });
    snapshot.tasks = [{
      ...createApprovalTask(),
      role: EnterpriseLeadAgentRole.PromotionPerformanceReview,
      outputPayload: { proposedKnowledge: ['确认后写入长期知识'] },
    }];

    const { markup, t } = await renderWorkflowRun(snapshot);

    expect(markup).toContain(t('enterpriseLeadWorkflowReviewAwaitingConfirmation'));
    expect(markup).not.toContain(t('enterpriseLeadWorkflowReviewPending'));
  });
});
