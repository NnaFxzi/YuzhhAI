import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadRunStatus,
  type EnterpriseLeadRunStatus as EnterpriseLeadRunStatusValue,
  EnterpriseLeadTaskStatus,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import { PROMOTION_WORKFLOW_GRAPH } from '../../../shared/enterpriseLeadWorkspace/promotionWorkflowGraph';
import type { EnterpriseLeadAgentTask, EnterpriseLeadWorkspace, EnterpriseLeadWorkspaceSnapshot } from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import { startCreatedWorkflowRun } from './workflowRunLifecycle';
import {
  getWorkflowAttemptStatusLabelKey,
  getWorkflowControllerSummaryKey,
  getWorkflowEventLabelKey,
  getWorkflowStartOptionsForMode,
  WorkflowRunMode,
  workflowRunModeOptions,
} from './workflowRunPresentation';
import { createWorkflowRunState, recoverWorkflowRunState, reduceWorkflowRunState, setWorkflowRunSnapshot } from './workflowRunState';
import {
  createWorkflowSnapshotRefreshGate,
  getWorkflowActionSnapshotRecoverySequence,
  isWorkflowRunSnapshotIdentityCurrent,
} from './workflowSnapshotRefresh';
import WorkflowTaskCard from './WorkflowTaskCard';

interface WorkflowRunViewProps {
  workspace: EnterpriseLeadWorkspace;
  onOpenCowork: () => void;
}

const countEnabledAgents = (workspace: EnterpriseLeadWorkspace): number =>
  workspace.workspaceAgents.filter(agent => agent.enabled).length || workspace.enabledAgentRoles.length;

export type WorkflowRunAction = 'resume' | 'cancel' | 'retry';

export const getWorkflowRunActions = (status: EnterpriseLeadRunStatusValue): WorkflowRunAction[] => {
  switch (status) {
    case EnterpriseLeadRunStatus.Draft:
      return ['resume', 'cancel'];
    case EnterpriseLeadRunStatus.Running:
    case EnterpriseLeadRunStatus.NeedsInput:
    case EnterpriseLeadRunStatus.AwaitingApproval:
    case EnterpriseLeadRunStatus.Blocked:
      return status === EnterpriseLeadRunStatus.AwaitingApproval
        ? ['resume', 'cancel']
        : ['cancel'];
    case EnterpriseLeadRunStatus.Error:
      return ['retry'];
    case EnterpriseLeadRunStatus.Completed:
    case EnterpriseLeadRunStatus.Cancelled:
    case EnterpriseLeadRunStatus.Archived:
      return [];
    default:
      return [];
  }
};

export const WorkflowRunView: React.FC<WorkflowRunViewProps> = ({ workspace, onOpenCowork }) => {
  const [runId, setRunId] = useState<string | null>(workspace.recentRunId);
  const [state, setState] = useState(() => createWorkflowRunState(workspace.recentRunId ?? ''));
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<WorkflowRunMode>(WorkflowRunMode.Core);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const stateRef = useRef(state);
  const workspaceIdRef = useRef(workspace.id);
  const snapshotRefreshGateRef = useRef(createWorkflowSnapshotRefreshGate());
  const snapshotRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const workflowSubscriptionRef = useRef<(() => void) | null>(null);
  const subscribedRunIdRef = useRef<string | null>(null);

  workspaceIdRef.current = workspace.id;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refreshQueuedSnapshots = useCallback(async (): Promise<void> => {
    const refresh = snapshotRefreshGateRef.current.takeNextRefresh();
    if (!refresh) return;

    let retryRecoverySequence: number | undefined;
    try {
      const snapshot = await enterpriseLeadWorkspaceService.getRun(workspace.id, refresh.runId);
      if (
        snapshotRefreshGateRef.current.isCurrentGeneration(refresh.generation) &&
        stateRef.current.runId === refresh.runId
      ) {
        const expectedSequence = Math.max(
          refresh.eventSequence ?? 0,
          refresh.recoverySequence ?? 0,
        );
        const next = expectedSequence === 0
          ? setWorkflowRunSnapshot(stateRef.current, snapshot)
          : recoverWorkflowRunState(stateRef.current, snapshot, expectedSequence);
        stateRef.current = next;
        setState(next);
        retryRecoverySequence = next.needsSnapshotRecovery
          ? next.recoverySequence
          : undefined;
      }
    } catch {
      if (snapshotRefreshGateRef.current.isCurrentGeneration(refresh.generation) && refresh.reportError) {
        setError(i18nService.t('enterpriseLeadWorkflowLoadFailed'));
      }
    } finally {
      snapshotRefreshGateRef.current.completeRefresh(refresh, retryRecoverySequence);
    }

    await refreshQueuedSnapshots();
  }, [workspace.id]);

  const resetSnapshotRefreshes = useCallback((): void => {
    snapshotRefreshGateRef.current.reset();
    snapshotRefreshPromiseRef.current = null;
  }, []);

  const refreshSnapshot = useCallback((
    targetRunId: string,
    eventSequence?: number,
    recoverySequence?: number,
    reportError = true,
  ): Promise<void> => {
    snapshotRefreshGateRef.current.requestRefresh(targetRunId, {
      eventSequence,
      recoverySequence,
      reportError,
    });
    const currentRefresh = snapshotRefreshPromiseRef.current;
    if (currentRefresh) return currentRefresh;

    const refreshPromise = Promise.resolve().then(refreshQueuedSnapshots);
    snapshotRefreshPromiseRef.current = refreshPromise;
    void refreshPromise.finally(() => {
      if (snapshotRefreshPromiseRef.current === refreshPromise) {
        snapshotRefreshPromiseRef.current = null;
      }
    });
    return refreshPromise;
  }, [refreshQueuedSnapshots]);

  const handleWorkflowEvent = useCallback((targetRunId: string, event: Parameters<typeof reduceWorkflowRunState>[1]): void => {
    const next = reduceWorkflowRunState(stateRef.current, event);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
    void refreshSnapshot(
      targetRunId,
      event?.sequence,
      next.needsSnapshotRecovery ? next.recoverySequence : undefined,
    );
  }, [refreshSnapshot]);

  const clearWorkflowSubscription = useCallback((): void => {
    workflowSubscriptionRef.current?.();
    workflowSubscriptionRef.current = null;
    subscribedRunIdRef.current = null;
  }, []);

  const ensureWorkflowSubscription = useCallback((targetRunId: string): void => {
    if (subscribedRunIdRef.current === targetRunId) return;
    clearWorkflowSubscription();
    subscribedRunIdRef.current = targetRunId;
    workflowSubscriptionRef.current = enterpriseLeadWorkspaceService.onWorkflowEvent(
      targetRunId,
      event => handleWorkflowEvent(targetRunId, event),
    );
  }, [clearWorkflowSubscription, handleWorkflowEvent]);

  useEffect(() => {
    const nextRunId = workspace.recentRunId;
    resetSnapshotRefreshes();
    setRunId(nextRunId);
    const nextState = createWorkflowRunState(nextRunId ?? '');
    stateRef.current = nextState;
    setState(nextState);
    if (nextRunId) void refreshSnapshot(nextRunId);
  }, [refreshSnapshot, resetSnapshotRefreshes, workspace.id, workspace.recentRunId]);

  useEffect(() => {
    if (runId) ensureWorkflowSubscription(runId);
    else clearWorkflowSubscription();
  }, [clearWorkflowSubscription, ensureWorkflowSubscription, runId]);

  useEffect(() => clearWorkflowSubscription, [clearWorkflowSubscription]);

  const snapshot = state.snapshot;
  const storedCurrentRun = snapshot?.currentRun ?? null;
  const currentRun = storedCurrentRun
    ? {
      ...storedCurrentRun,
      controllerSummary: i18nService.t(getWorkflowControllerSummaryKey(
        storedCurrentRun.status,
        storedCurrentRun.controllerSummary,
      )),
    }
    : null;
  const metrics = useMemo(() => ({
    artifacts: snapshot?.deliverables.length ?? 0,
    risks: snapshot?.tasks.reduce((count, task) => count + task.risks.length, 0) ?? 0,
    todos: snapshot?.todos.length ?? 0,
  }), [snapshot]);

  const applySnapshot = (nextSnapshot: EnterpriseLeadWorkspaceSnapshot | null): void => {
    const recoverySequence = getWorkflowActionSnapshotRecoverySequence(stateRef.current, nextSnapshot);
    if (recoverySequence !== undefined) {
      void refreshSnapshot(stateRef.current.runId, recoverySequence);
      return;
    }
    resetSnapshotRefreshes();
    const next = setWorkflowRunSnapshot(stateRef.current, nextSnapshot);
    stateRef.current = next;
    setState(next);
  };

  const start = async (): Promise<void> => {
    if (!goal.trim() || workspace.extractionSources.length === 0 || isSaving) return;
    setIsSaving(true); setError('');
    try {
      const result = await startCreatedWorkflowRun({
        workspaceId: workspace.id,
        userGoal: goal.trim(),
        options: getWorkflowStartOptionsForMode(mode),
        createRun: enterpriseLeadWorkspaceService.createRun,
        startWorkflow: enterpriseLeadWorkspaceService.startWorkflow,
        activateRun: (createdRunId, created) => {
          resetSnapshotRefreshes();
          const nextState = recoverWorkflowRunState(createWorkflowRunState(createdRunId), created, 0);
          stateRef.current = nextState;
          setRunId(createdRunId);
          setState(nextState);
          ensureWorkflowSubscription(createdRunId);
        },
        reconcileRun: createdRunId => refreshSnapshot(createdRunId, undefined, undefined, false),
      });
      if (result.error) throw result.error;
    } catch {
      setError(i18nService.t('enterpriseLeadWorkflowStartFailed'));
    } finally { setIsSaving(false); }
  };

  const perform = async (action: (activeRunId: string) => Promise<EnterpriseLeadWorkspaceSnapshot | null>): Promise<void> => {
    if (!runId || isSaving) return;
    const actionIdentity = { workspaceId: workspace.id, runId };
    setIsSaving(true); setError('');
    try {
      const nextSnapshot = await action(runId);
      if (!isWorkflowRunSnapshotIdentityCurrent({
        workspaceId: workspaceIdRef.current,
        runId: stateRef.current.runId,
      }, actionIdentity)) return;
      applySnapshot(nextSnapshot);
    } catch { setError(i18nService.t('enterpriseLeadWorkflowActionFailed')); } finally { setIsSaving(false); }
  };
  const approve = (task: EnterpriseLeadAgentTask): void => void perform(activeRunId => enterpriseLeadWorkspaceService.approveWorkflowTask(workspace.id, activeRunId, task.id));
  const reject = (task: EnterpriseLeadAgentTask, feedback: string): void => void perform(
    activeRunId => enterpriseLeadWorkspaceService.rejectWorkflowTask(workspace.id, activeRunId, task.id, feedback),
  );
  const isArchived = currentRun?.status === EnterpriseLeadRunStatus.Archived ||
    currentRun?.archiveStatus === EnterpriseLeadRunStatus.Archived;
  const workflowRunActions = currentRun && !isArchived ? getWorkflowRunActions(currentRun.status) : [];
  const workflowHistory = snapshot?.workflowHistory;
  const monitoringTask = snapshot?.tasks.find(
    task => task.role === EnterpriseLeadAgentRole.PromotionAccountMonitoring,
  );
  const reviewTask = snapshot?.tasks.find(
    task => task.role === EnterpriseLeadAgentRole.PromotionPerformanceReview,
  );
  const monitoringStateKey =
    monitoringTask?.status === EnterpriseLeadTaskStatus.Completed
      ? 'enterpriseLeadWorkflowMonitoringReportReady'
      : monitoringTask?.status === EnterpriseLeadTaskStatus.NeedsInput
        ? 'enterpriseLeadWorkflowMonitoringNeedsInput'
        : 'enterpriseLeadWorkflowMonitoringPending';
  const reviewStateKey =
    reviewTask?.status === EnterpriseLeadTaskStatus.Completed
      ? 'enterpriseLeadWorkflowReviewReady'
      : reviewTask?.status === EnterpriseLeadTaskStatus.AwaitingApproval
        ? 'enterpriseLeadWorkflowReviewAwaitingConfirmation'
      : 'enterpriseLeadWorkflowReviewPending';
  const reviewNeedsKnowledgeConfirmation = Array.isArray(reviewTask?.outputPayload.proposedKnowledge) &&
    reviewTask.outputPayload.proposedKnowledge.length > 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5 lg:px-7">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-primary">{i18nService.t('enterpriseLeadWorkbenchNavWorkflow')}</p><h1 className="mt-1 text-xl font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowTitle')}</h1></div><button type="button" onClick={onOpenCowork} className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowOpenCowork')}</button></header>
      {error ? <p className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      {!currentRun ? <section className="mt-5 max-w-3xl rounded-lg border border-border bg-surface p-5"><p className="text-sm text-secondary">{i18nService.t('enterpriseLeadWorkflowReadiness').replace('{count}', String(workspace.extractionSources.length))}</p><p className="mt-1 text-sm text-secondary">{i18nService.t('enterpriseLeadWorkflowAgentCount').replace('{count}', String(countEnabledAgents(workspace)))}</p><p className="mt-1 text-sm text-secondary">{i18nService.t('enterpriseLeadWorkflowRunnableNodes').replace('{count}', String(PROMOTION_WORKFLOW_GRAPH.length))}</p>{workspace.extractionSources.length === 0 ? <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">{i18nService.t('enterpriseLeadWorkflowMissingPrerequisite')}</p> : null}<label className="mt-5 block text-sm font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowGoal')}</label><textarea value={goal} onChange={event => setGoal(event.target.value)} className="mt-2 min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" placeholder={i18nService.t('enterpriseLeadWorkflowGoalPlaceholder')} /><div className="mt-4 grid gap-2 sm:grid-cols-2">{workflowRunModeOptions.map(option => <button key={option.id} type="button" onClick={() => setMode(option.id)} className={`rounded-md border px-3 py-2 text-left text-xs font-semibold ${mode === option.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground'}`}><span className="block">{i18nService.t(option.labelKey)}</span><span className="mt-1 block font-normal text-secondary">{i18nService.t(option.descriptionKey)}</span></button>)}</div><p className="mt-4 text-xs leading-5 text-amber-800 dark:text-amber-200">{i18nService.t('enterpriseLeadWorkflowDraftOnlyNotice')}</p><button type="button" disabled={!goal.trim() || workspace.extractionSources.length === 0 || isSaving} onClick={() => void start()} className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60">{i18nService.t('enterpriseLeadWorkflowStart')}</button></section> : <><section className="mt-5 rounded-lg border border-border bg-surface p-4"><p className="text-sm font-semibold text-foreground">{currentRun.userGoal}</p><p className="mt-1 text-sm text-secondary">{currentRun.controllerSummary}</p><div className="mt-4 grid grid-cols-3 gap-3 text-center text-xs text-secondary"><span>{i18nService.t('enterpriseLeadWorkflowArtifactCount').replace('{count}', String(metrics.artifacts))}</span><span>{i18nService.t('enterpriseLeadWorkflowRiskCount').replace('{count}', String(metrics.risks))}</span><span>{i18nService.t('enterpriseLeadWorkflowTodoCount').replace('{count}', String(metrics.todos))}</span></div><div className="mt-4 flex flex-wrap gap-2">{workflowRunActions.includes('resume') && <button type="button" disabled={isSaving} onClick={() => void perform(activeRunId => enterpriseLeadWorkspaceService.resumeWorkflow(workspace.id, activeRunId))} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowResume')}</button>}{workflowRunActions.includes('cancel') && <button type="button" disabled={isSaving} onClick={() => void perform(activeRunId => enterpriseLeadWorkspaceService.cancelWorkflow(workspace.id, activeRunId))} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowCancel')}</button>}{workflowRunActions.includes('retry') && <button type="button" disabled={isSaving} onClick={() => void perform(activeRunId => enterpriseLeadWorkspaceService.resumeWorkflow(workspace.id, activeRunId))} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowRetry')}</button>}</div></section>{monitoringTask || reviewTask ? <section className="mt-4 rounded-lg border border-border bg-surface p-3 text-xs text-secondary"><p className="font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowMonitoringTitle')}</p>{monitoringTask ? <p className="mt-1">{i18nService.t(monitoringStateKey)}</p> : null}{reviewTask ? <p className="mt-1">{i18nService.t(reviewStateKey)}</p> : null}{reviewNeedsKnowledgeConfirmation ? <p className="mt-2 text-amber-800 dark:text-amber-200">{i18nService.t('enterpriseLeadWorkflowReviewKnowledgeConfirmation')}</p> : null}</section> : null}{state.events.length > 0 ? <section className="mt-4 rounded-lg border border-border bg-surface p-3 text-xs text-secondary"><p className="font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowEventSummary')}</p>{state.events.slice(-5).map(event => <p key={event.sequence} className="mt-1">{i18nService.t(getWorkflowEventLabelKey(event.type))}</p>)}</section> : null}{workflowHistory && (workflowHistory.events.length > 0 || workflowHistory.attempts.length > 0) ? <section className="mt-4 rounded-lg border border-border bg-surface p-3 text-xs text-secondary"><p className="font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowHistoryTimeline')}</p>{workflowHistory.events.map(event => <div key={event.id} className="mt-2"><p>{i18nService.t(getWorkflowEventLabelKey(event.type))}</p>{event.feedback ? <p className="mt-1 text-foreground">{i18nService.t('enterpriseLeadWorkflowHistoryFeedback').replace('{feedback}', event.feedback)}</p> : null}</div>)}{workflowHistory.attempts.map(attempt => <p key={attempt.id} className="mt-2">{i18nService.t('enterpriseLeadWorkflowHistoryAttempt').replace('{count}', String(attempt.attempt)).replace('{status}', i18nService.t(getWorkflowAttemptStatusLabelKey(attempt.status)))}</p>)}</section> : null}<section className="mt-5 grid gap-3">{snapshot?.tasks.map(task => <WorkflowTaskCard key={task.id} task={task} disabled={isSaving || isArchived} readOnly={isArchived} onApprove={approve} onReject={reject} />)}</section></>}
    </div>
  );
};

export default WorkflowRunView;
