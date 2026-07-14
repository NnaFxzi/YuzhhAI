import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EnterpriseLeadRunStatus } from '../../../shared/enterpriseLeadWorkspace/constants';
import { PROMOTION_WORKFLOW_GRAPH } from '../../../shared/enterpriseLeadWorkspace/promotionWorkflowGraph';
import type { EnterpriseLeadAgentTask, EnterpriseLeadWorkspace, EnterpriseLeadWorkspaceSnapshot } from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import { startCreatedWorkflowRun } from './workflowRunLifecycle';
import { getWorkflowEventLabelKey, getWorkflowStartOptionsForMode, WorkflowRunMode, workflowRunModeOptions } from './workflowRunPresentation';
import { createWorkflowRunState, recoverWorkflowRunState, reduceWorkflowRunState, setWorkflowRunSnapshot } from './workflowRunState';
import { createWorkflowSnapshotRefreshGate } from './workflowSnapshotRefresh';
import WorkflowTaskCard from './WorkflowTaskCard';

interface WorkflowRunViewProps {
  workspace: EnterpriseLeadWorkspace;
  onOpenCowork: () => void;
}

const countEnabledAgents = (workspace: EnterpriseLeadWorkspace): number =>
  workspace.workspaceAgents.filter(agent => agent.enabled).length || workspace.enabledAgentRoles.length;

export const WorkflowRunView: React.FC<WorkflowRunViewProps> = ({ workspace, onOpenCowork }) => {
  const [runId, setRunId] = useState<string | null>(workspace.recentRunId);
  const [state, setState] = useState(() => createWorkflowRunState(workspace.recentRunId ?? ''));
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<WorkflowRunMode>(WorkflowRunMode.Core);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const stateRef = useRef(state);
  const snapshotRefreshGateRef = useRef(createWorkflowSnapshotRefreshGate());
  const workflowSubscriptionRef = useRef<(() => void) | null>(null);
  const subscribedRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refreshSnapshot = useCallback(async (
    targetRunId: string,
    sequence?: number,
    reportError = true,
  ): Promise<void> => {
    const generation = snapshotRefreshGateRef.current.nextGeneration();
    try {
      const snapshot = await enterpriseLeadWorkspaceService.getRun(workspace.id, targetRunId);
      setState(previous => {
        if (!snapshotRefreshGateRef.current.isCurrentGeneration(generation) || previous.runId !== targetRunId) return previous;
        const next = sequence === undefined
          ? setWorkflowRunSnapshot(previous, snapshot)
          : recoverWorkflowRunState(previous, snapshot, sequence);
        stateRef.current = next;
        return next;
      });
    } catch {
      if (snapshotRefreshGateRef.current.isCurrentGeneration(generation) && reportError) {
        setError(i18nService.t('enterpriseLeadWorkflowLoadFailed'));
      }
    }
  }, [workspace.id]);

  const handleWorkflowEvent = useCallback((targetRunId: string, event: Parameters<typeof reduceWorkflowRunState>[1]): void => {
    const next = reduceWorkflowRunState(stateRef.current, event);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
    if (next.needsSnapshotRecovery) {
      void refreshSnapshot(targetRunId, next.recoverySequence);
    }
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
    setRunId(nextRunId);
    const nextState = createWorkflowRunState(nextRunId ?? '');
    stateRef.current = nextState;
    setState(nextState);
    if (nextRunId) void refreshSnapshot(nextRunId);
  }, [refreshSnapshot, workspace.id, workspace.recentRunId]);

  useEffect(() => {
    if (runId) ensureWorkflowSubscription(runId);
    else clearWorkflowSubscription();
  }, [clearWorkflowSubscription, ensureWorkflowSubscription, runId]);

  useEffect(() => clearWorkflowSubscription, [clearWorkflowSubscription]);

  const snapshot = state.snapshot;
  const currentRun = snapshot?.currentRun ?? null;
  const metrics = useMemo(() => ({
    artifacts: snapshot?.deliverables.length ?? 0,
    risks: snapshot?.tasks.reduce((count, task) => count + task.risks.length, 0) ?? 0,
    todos: snapshot?.todos.length ?? 0,
  }), [snapshot]);

  const applySnapshot = (nextSnapshot: EnterpriseLeadWorkspaceSnapshot | null): void => {
    setState(previous => {
      const next = setWorkflowRunSnapshot(previous, nextSnapshot);
      stateRef.current = next;
      return next;
    });
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
          const nextState = recoverWorkflowRunState(createWorkflowRunState(createdRunId), created, 0);
          stateRef.current = nextState;
          setRunId(createdRunId);
          setState(nextState);
          ensureWorkflowSubscription(createdRunId);
        },
        reconcileRun: createdRunId => refreshSnapshot(createdRunId, undefined, false),
      });
      if (result.error) throw result.error;
    } catch {
      setError(i18nService.t('enterpriseLeadWorkflowStartFailed'));
    } finally { setIsSaving(false); }
  };

  const perform = async (action: (activeRunId: string) => Promise<EnterpriseLeadWorkspaceSnapshot | null>): Promise<void> => {
    if (!runId || isSaving) return;
    setIsSaving(true); setError('');
    try { applySnapshot(await action(runId)); } catch { setError(i18nService.t('enterpriseLeadWorkflowActionFailed')); } finally { setIsSaving(false); }
  };
  const approve = (task: EnterpriseLeadAgentTask): void => void perform(activeRunId => enterpriseLeadWorkspaceService.approveWorkflowTask(workspace.id, activeRunId, task.id));
  const reject = (task: EnterpriseLeadAgentTask, feedback: string): void => void perform(
    activeRunId => enterpriseLeadWorkspaceService.rejectWorkflowTask(workspace.id, activeRunId, task.id, feedback),
  );
  const isArchived = currentRun?.status === EnterpriseLeadRunStatus.Archived;
  const workflowHistory = snapshot?.workflowHistory;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5 lg:px-7">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-primary">{i18nService.t('enterpriseLeadWorkbenchNavWorkflow')}</p><h1 className="mt-1 text-xl font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowTitle')}</h1></div><button type="button" onClick={onOpenCowork} className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowOpenCowork')}</button></header>
      {error ? <p className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      {!currentRun ? <section className="mt-5 max-w-3xl rounded-lg border border-border bg-surface p-5"><p className="text-sm text-secondary">{i18nService.t('enterpriseLeadWorkflowReadiness').replace('{count}', String(workspace.extractionSources.length))}</p><p className="mt-1 text-sm text-secondary">{i18nService.t('enterpriseLeadWorkflowAgentCount').replace('{count}', String(countEnabledAgents(workspace)))}</p><p className="mt-1 text-sm text-secondary">{i18nService.t('enterpriseLeadWorkflowRunnableNodes').replace('{count}', String(PROMOTION_WORKFLOW_GRAPH.length))}</p>{workspace.extractionSources.length === 0 ? <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">{i18nService.t('enterpriseLeadWorkflowMissingPrerequisite')}</p> : null}<label className="mt-5 block text-sm font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowGoal')}</label><textarea value={goal} onChange={event => setGoal(event.target.value)} className="mt-2 min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" placeholder={i18nService.t('enterpriseLeadWorkflowGoalPlaceholder')} /><div className="mt-4 grid gap-2 sm:grid-cols-2">{workflowRunModeOptions.map(option => <button key={option.id} type="button" onClick={() => setMode(option.id)} className={`rounded-md border px-3 py-2 text-left text-xs font-semibold ${mode === option.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground'}`}><span className="block">{i18nService.t(option.labelKey)}</span><span className="mt-1 block font-normal text-secondary">{i18nService.t(option.descriptionKey)}</span></button>)}</div><p className="mt-4 text-xs leading-5 text-amber-800 dark:text-amber-200">{i18nService.t('enterpriseLeadWorkflowDraftOnlyNotice')}</p><button type="button" disabled={!goal.trim() || workspace.extractionSources.length === 0 || isSaving} onClick={() => void start()} className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60">{i18nService.t('enterpriseLeadWorkflowStart')}</button></section> : <><section className="mt-5 rounded-lg border border-border bg-surface p-4"><p className="text-sm font-semibold text-foreground">{currentRun.userGoal}</p><p className="mt-1 text-sm text-secondary">{currentRun.controllerSummary}</p><div className="mt-4 grid grid-cols-3 gap-3 text-center text-xs text-secondary"><span>{i18nService.t('enterpriseLeadWorkflowArtifactCount').replace('{count}', String(metrics.artifacts))}</span><span>{i18nService.t('enterpriseLeadWorkflowRiskCount').replace('{count}', String(metrics.risks))}</span><span>{i18nService.t('enterpriseLeadWorkflowTodoCount').replace('{count}', String(metrics.todos))}</span></div><div className="mt-4 flex flex-wrap gap-2">{!isArchived && <button type="button" disabled={isSaving} onClick={() => void perform(activeRunId => enterpriseLeadWorkspaceService.resumeWorkflow(workspace.id, activeRunId))} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowResume')}</button>}{!isArchived && <button type="button" disabled={isSaving} onClick={() => void perform(activeRunId => enterpriseLeadWorkspaceService.cancelWorkflow(workspace.id, activeRunId))} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowCancel')}</button>}{currentRun.status === EnterpriseLeadRunStatus.Error && <button type="button" disabled={isSaving} onClick={() => void perform(activeRunId => enterpriseLeadWorkspaceService.resumeWorkflow(workspace.id, activeRunId))} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowRetry')}</button>}</div></section>{state.events.length > 0 ? <section className="mt-4 rounded-lg border border-border bg-surface p-3 text-xs text-secondary"><p className="font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowEventSummary')}</p>{state.events.slice(-5).map(event => <p key={event.sequence} className="mt-1">{i18nService.t(getWorkflowEventLabelKey(event.type))}</p>)}</section> : null}{workflowHistory && (workflowHistory.events.length > 0 || workflowHistory.attempts.length > 0) ? <section className="mt-4 rounded-lg border border-border bg-surface p-3 text-xs text-secondary"><p className="font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowHistoryTimeline')}</p>{workflowHistory.events.map(event => <div key={event.id} className="mt-2"><p>{i18nService.t(getWorkflowEventLabelKey(event.type))}</p>{event.feedback ? <p className="mt-1 text-foreground">{i18nService.t('enterpriseLeadWorkflowHistoryFeedback').replace('{feedback}', event.feedback)}</p> : null}</div>)}{workflowHistory.attempts.map(attempt => <p key={attempt.id} className="mt-2">{i18nService.t('enterpriseLeadWorkflowHistoryAttempt').replace('{count}', String(attempt.attempt)).replace('{status}', attempt.status)}</p>)}</section> : null}<section className="mt-5 grid gap-3">{snapshot?.tasks.map(task => <WorkflowTaskCard key={task.id} task={task} disabled={isSaving || isArchived} onApprove={approve} onReject={reject} />)}</section></>}
    </div>
  );
};

export default WorkflowRunView;
