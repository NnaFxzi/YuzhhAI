import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadRunStatus,
  EnterpriseLeadTaskStatus,
} from '../../shared/enterpriseLeadWorkspace/constants';
import { getPromotionWorkflowArtifactKind } from '../../shared/enterpriseLeadWorkspace/promotionContracts';
import type { PromotionTaskResult } from '../../shared/enterpriseLeadWorkspace/promotionTaskContracts';
import { PROMOTION_WORKFLOW_GRAPH } from '../../shared/enterpriseLeadWorkspace/promotionWorkflowGraph';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadAgentTaskResult,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../shared/enterpriseLeadWorkspace/types';
import {
  normalizeWorkflowReviewFeedback,
  normalizeWorkflowStartOptions,
  type WorkflowArtifactRef,
  WorkflowExecutionMode,
  type WorkflowStartOptions,
} from '../../shared/enterpriseLeadWorkspace/workflowContracts';
import type { CreateEnterpriseLeadTaskInput, EnterpriseLeadWorkspaceStore } from './store';
import type { WorkflowArtifactStore } from './workflowArtifactStore';
import type { WorkflowExecutionAdapter } from './workflowExecutionAdapter';
import { isWorkflowRunTerminal } from './workflowRunState';

export interface EnterpriseLeadWorkflowOrchestratorOptions {
  store: EnterpriseLeadWorkspaceStore;
  artifactStore: WorkflowArtifactStore;
  executionAdapter: WorkflowExecutionAdapter;
  buildWorkflowTasks?: (
    workspaceId: string,
    options: WorkflowStartOptions,
  ) => CreateEnterpriseLeadTaskInput[];
}

const isCompleted = (task: EnterpriseLeadAgentTask): boolean =>
  task.status === EnterpriseLeadTaskStatus.Completed && !task.stale;

const isRunnable = (task: EnterpriseLeadAgentTask): boolean =>
  task.status === EnterpriseLeadTaskStatus.Ready ||
  task.status === EnterpriseLeadTaskStatus.Error ||
  task.status === EnterpriseLeadTaskStatus.Stale;

const dedupeWorkflowArtifactRefs = (artifactRefs: WorkflowArtifactRef[]): WorkflowArtifactRef[] =>
  Array.from(new Map(artifactRefs.map(artifact => [artifact.id, artifact])).values());

const EMPTY_WORKFLOW_CONTROLLER_SUMMARY = '';

const withPerformanceReviewKnowledgeConfirmation = (
  task: EnterpriseLeadAgentTask,
  result: PromotionTaskResult,
): PromotionTaskResult => {
  if (task.role !== EnterpriseLeadAgentRole.PromotionPerformanceReview) return result;
  if (result.status !== EnterpriseLeadTaskStatus.Completed) return result;
  const outputs = result.outputs as Record<string, unknown>;
  const proposedKnowledge = Array.isArray(outputs.proposedKnowledge)
    ? outputs.proposedKnowledge.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0,
      )
    : [];
  if (proposedKnowledge.length === 0) return result;
  return {
    ...result,
    status: EnterpriseLeadTaskStatus.AwaitingApproval,
  };
};

export class EnterpriseLeadWorkflowOrchestrator {
  private readonly activeRuns = new Map<string, Promise<EnterpriseLeadWorkspaceSnapshot>>();
  private readonly cancelledRuns = new Set<string>();
  private readonly runGenerations = new Map<string, number>();
  private nextRunGeneration = 0;

  constructor(private readonly options: EnterpriseLeadWorkflowOrchestratorOptions) {}

  async startRun(
    workspaceId: string,
    runId: string,
    options?: WorkflowStartOptions,
  ): Promise<EnterpriseLeadWorkspaceSnapshot> {
    const active = this.activeRuns.get(runId);
    if (active) return active;

    this.assertRunWorkspace(workspaceId, runId);
    const startOptions = normalizeWorkflowStartOptions(options);
    const existingTasks = this.options.store.listTasks(runId);
    if (existingTasks.length > 0) {
      if (existingTasks.every(task => task.status === EnterpriseLeadTaskStatus.Waiting)) {
        this.options.store.replaceUnstartedWorkflowRun(
          runId,
          this.resolveWorkflowTasks(workspaceId, startOptions),
          startOptions,
        );
        return this.schedule(workspaceId, runId);
      }
      return this.getSnapshot(workspaceId, runId);
    }

    this.options.store.initializeWorkflowRun(
      runId,
      this.resolveWorkflowTasks(workspaceId, startOptions),
      startOptions,
    );
    this.options.artifactStore.appendEvent({ runId, type: 'run_started' });
    return this.schedule(workspaceId, runId);
  }

  async resumeRun(workspaceId: string, runId: string): Promise<EnterpriseLeadWorkspaceSnapshot> {
    const active = this.activeRuns.get(runId);
    if (active) return active;

    const run = this.assertRunWorkspace(workspaceId, runId);
    if (run.archiveStatus === 'archived' || run.status === EnterpriseLeadRunStatus.Archived) {
      return this.getSnapshot(workspaceId, runId);
    }
    if (run.status === EnterpriseLeadRunStatus.Error) {
      if (!this.options.artifactStore.retryRunOnce(runId).transitioned) {
        return this.getSnapshot(workspaceId, runId);
      }
    } else if (isWorkflowRunTerminal(run.status)) {
      return this.getSnapshot(workspaceId, runId);
    }
    const tasks = this.options.store.listTasks(runId);
    this.recoverInterruptedTasks(runId, tasks);
    const recoveredTasks = this.options.store.listTasks(runId);
    if (recoveredTasks.some(task => task.status === EnterpriseLeadTaskStatus.AwaitingApproval)) {
      return this.getSnapshot(workspaceId, runId);
    }
    if (recoveredTasks.some(task => task.status === EnterpriseLeadTaskStatus.NeedsInput)) {
      return this.getSnapshot(workspaceId, runId);
    }
    return this.schedule(workspaceId, runId);
  }

  async cancelRun(workspaceId: string, runId: string): Promise<EnterpriseLeadWorkspaceSnapshot> {
    this.assertRunWorkspace(workspaceId, runId);
    const unfinishedTasks = this.options.store
      .listTasks(runId)
      .filter(
        task =>
          task.status !== EnterpriseLeadTaskStatus.Completed &&
          task.status !== EnterpriseLeadTaskStatus.Cancelled,
      );
    if (!this.options.store.cancelWorkflowRun(runId)) {
      return this.getSnapshot(workspaceId, runId);
    }
    if (this.activeRuns.has(runId)) this.cancelledRuns.add(runId);
    unfinishedTasks.forEach(task => {
      this.options.artifactStore.appendEvent({
        runId,
        type: 'task_cancelled',
        taskId: task.id,
        role: task.role,
        summary: 'Task cancelled before completion.',
      });
    });
    this.options.artifactStore.appendEvent({ runId, type: 'run_cancelled' });
    return this.getSnapshot(workspaceId, runId);
  }

  async approveTask(
    workspaceId: string,
    runId: string,
    taskId: string,
  ): Promise<EnterpriseLeadWorkspaceSnapshot> {
    this.assertRunWorkspace(workspaceId, runId);
    const task = this.requireApprovalTask(runId, taskId);
    this.options.store.updateWorkflowTaskStatus(task.id, EnterpriseLeadTaskStatus.Completed);
    this.options.artifactStore.appendEvent({
      runId,
      type: 'task_completed',
      taskId: task.id,
      role: task.role,
      summary: 'Approved for downstream workflow execution.',
    });
    return this.getSnapshot(workspaceId, runId);
  }

  async rejectTask(
    workspaceId: string,
    runId: string,
    taskId: string,
    feedback: string,
  ): Promise<EnterpriseLeadWorkspaceSnapshot> {
    this.assertRunWorkspace(workspaceId, runId);
    const normalizedFeedback = normalizeWorkflowReviewFeedback(feedback);
    if (!normalizedFeedback) {
      throw new Error('Workflow review feedback is required and must be within the allowed length');
    }
    const task = this.requireApprovalTask(runId, taskId);
    this.options.store.updateWorkflowTaskStatus(task.id, EnterpriseLeadTaskStatus.Stale, {
      summary: `${task.summary} Rejected and queued for revision.`,
    });
    this.options.artifactStore.appendEvent({
      runId,
      type: 'approval_rejected',
      taskId: task.id,
      role: task.role,
      summary: 'Approval rejected; task can be retried on resume.',
      payload: { feedback: normalizedFeedback },
    });
    return this.getSnapshot(workspaceId, runId);
  }

  getSnapshot(workspaceId: string, runId: string): EnterpriseLeadWorkspaceSnapshot {
    const run = this.assertRunWorkspace(workspaceId, runId);
    const workspace = this.options.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }
    return {
      workspace,
      currentRun: run,
      tasks: this.options.store.listTasks(runId),
      pendingVersions: this.options.store.listPendingVersions(runId),
      deliverables: [],
      todos: [],
      archives: [],
    };
  }

  private buildWorkflowTasks(startOptions: WorkflowStartOptions): CreateEnterpriseLeadTaskInput[] {
    const enabledNodes = new Set(startOptions.enabledOptionalNodes);
    const includedNodes = PROMOTION_WORKFLOW_GRAPH.filter(
      node => !node.optional || (node.enableWhen && enabledNodes.has(node.enableWhen)),
    );
    const taskIdByRole = new Map(includedNodes.map(node => [node.role, node.role]));

    return includedNodes.map(node => ({
      role: node.role,
      nodeId: node.role,
      dependsOnTaskIds: node.dependsOn
        .map(role => taskIdByRole.get(role))
        .filter((taskId): taskId is string => Boolean(taskId)),
      executionMode: node.executionMode,
    }));
  }

  private resolveWorkflowTasks(
    workspaceId: string,
    startOptions: WorkflowStartOptions,
  ): CreateEnterpriseLeadTaskInput[] {
    return (
      this.options.buildWorkflowTasks?.(workspaceId, startOptions) ??
      this.buildWorkflowTasks(startOptions)
    );
  }

  private schedule(workspaceId: string, runId: string): Promise<EnterpriseLeadWorkspaceSnapshot> {
    const active = this.activeRuns.get(runId);
    if (active) return active;

    this.cancelledRuns.delete(runId);
    const generation = ++this.nextRunGeneration;
    this.runGenerations.set(runId, generation);
    const promise = this.runSchedule(workspaceId, runId).finally(() => {
      if (this.activeRuns.get(runId) === promise) this.activeRuns.delete(runId);
      if (this.runGenerations.get(runId) === generation) {
        this.runGenerations.delete(runId);
        this.cancelledRuns.delete(runId);
      }
    });
    this.activeRuns.set(runId, promise);
    return promise;
  }

  private async runSchedule(
    workspaceId: string,
    runId: string,
  ): Promise<EnterpriseLeadWorkspaceSnapshot> {
    const startOptions = this.options.store.getWorkflowStartOptions(runId);
    while (!this.cancelledRuns.has(runId)) {
      const tasks = this.options.store.listTasks(runId);
      this.markReadyTasks(runId, tasks);
      const refreshedTasks = this.options.store.listTasks(runId);
      const taskById = new Map(refreshedTasks.map(task => [task.id, task]));
      const runnable = refreshedTasks
        .filter(
          task =>
            isRunnable(task) &&
            (task.dependsOnTaskIds ?? []).every(taskId => isCompleted(taskById.get(taskId) ?? task)),
        )
        .slice(0, startOptions.maxConcurrency);

      if (runnable.length === 0) {
        return this.finishRunIfSettled(workspaceId, runId, refreshedTasks);
      }

      this.options.store.updateRunProgress({
        runId,
        status: EnterpriseLeadRunStatus.Running,
        currentRole: runnable[0]?.role ?? null,
        controllerSummary: EMPTY_WORKFLOW_CONTROLLER_SUMMARY,
      });
      await Promise.allSettled(runnable.map(task => this.executeTask(runId, task, refreshedTasks)));

      const postBatchTasks = this.options.store.listTasks(runId);
      const runStatus = this.getPausedRunStatus(postBatchTasks);
      if (runStatus) {
        this.options.store.updateRunProgress({
          runId,
          status: runStatus.status,
          currentRole: runStatus.task.role,
          controllerSummary: EMPTY_WORKFLOW_CONTROLLER_SUMMARY,
        });
        return this.getSnapshot(workspaceId, runId);
      }
    }
    return this.getSnapshot(workspaceId, runId);
  }

  private markReadyTasks(runId: string, tasks: EnterpriseLeadAgentTask[]): void {
    const taskById = new Map(tasks.map(task => [task.id, task]));
    for (const task of tasks) {
      if (task.status !== EnterpriseLeadTaskStatus.Waiting) continue;
      const dependencies = task.dependsOnTaskIds ?? [];
      if (dependencies.every(taskId => isCompleted(taskById.get(taskId) ?? task))) {
        this.options.store.updateWorkflowTaskStatus(task.id, EnterpriseLeadTaskStatus.Ready);
        this.options.artifactStore.appendEvent({
          runId,
          type: 'task_ready',
          taskId: task.id,
          role: task.role,
        });
      }
    }
  }

  private recoverInterruptedTasks(runId: string, tasks: EnterpriseLeadAgentTask[]): void {
    const recoveryError = 'Workflow task was interrupted by process restart.';
    tasks
      .filter(task => task.status === EnterpriseLeadTaskStatus.Running)
      .forEach(task => {
        const hasAttempt = typeof task.attempt === 'number' && task.attempt > 0;
        const recoveredStatus = hasAttempt
          ? EnterpriseLeadTaskStatus.Error
          : EnterpriseLeadTaskStatus.Ready;
        this.options.store.updateWorkflowTaskStatus(task.id, recoveredStatus, {
          ...(hasAttempt ? { error: recoveryError } : {}),
          summary: hasAttempt ? recoveryError : task.summary,
        });
        if (hasAttempt) {
          this.options.artifactStore.recoverRunningAttempt(task.id, task.attempt!, recoveryError);
        }
        this.options.artifactStore.appendEvent({
          runId,
          type: hasAttempt ? 'task_failed' : 'task_ready',
          taskId: task.id,
          role: task.role,
          summary: hasAttempt ? recoveryError : 'Task is ready after process restart.',
        });
      });
  }

  private async executeTask(
    runId: string,
    task: EnterpriseLeadAgentTask,
    tasks: EnterpriseLeadAgentTask[],
  ): Promise<void> {
    const attempt = (task.attempt ?? 0) + 1;
    const upstreamTasks = (task.dependsOnTaskIds ?? [])
      .map(taskId => tasks.find(candidate => candidate.id === taskId))
      .filter((candidate): candidate is EnterpriseLeadAgentTask => Boolean(candidate));
    const inputArtifacts = dedupeWorkflowArtifactRefs([
      ...(task.artifactRefs ?? []),
      ...upstreamTasks.flatMap(upstream => upstream.artifactRefs ?? []),
    ]);
    const executionMode = task.executionMode ?? WorkflowExecutionMode.Inline;

    this.options.store.updateWorkflowTaskStatus(task.id, EnterpriseLeadTaskStatus.Running, { attempt });
    const taskAttempt = this.options.artifactStore.createAttempt({
      taskId: task.id,
      attempt,
      executionMode,
    });
    this.options.artifactStore.appendEvent({
      runId,
      type: task.status === EnterpriseLeadTaskStatus.Ready ? 'task_started' : 'task_retrying',
      taskId: task.id,
      role: task.role,
    });

    try {
      const result = await this.options.executionAdapter.execute({
        runId,
        taskId: task.id,
        role: task.role,
        userGoal: typeof task.inputPayload.userGoal === 'string' ? task.inputPayload.userGoal : '',
        inputArtifacts,
        acceptanceCriteria: [],
        executionMode,
      });
      if (this.cancelledRuns.has(runId)) {
        this.options.artifactStore.finishAttempt(taskAttempt.id, {
          status: EnterpriseLeadTaskStatus.Cancelled,
        });
        return;
      }

      const confirmedResult = withPerformanceReviewKnowledgeConfirmation(task, result);
      if (
        task.role === EnterpriseLeadAgentRole.PromotionPerformanceReview &&
        (task.status === EnterpriseLeadTaskStatus.Completed ||
          task.status === EnterpriseLeadTaskStatus.AwaitingApproval) &&
        confirmedResult.status !== EnterpriseLeadTaskStatus.Completed &&
        confirmedResult.status !== EnterpriseLeadTaskStatus.AwaitingApproval
      ) {
        if (task.status === EnterpriseLeadTaskStatus.AwaitingApproval) {
          this.restoreAwaitingPromotionReview(task);
        } else {
          this.options.store.updateWorkflowTaskStatus(task.id, EnterpriseLeadTaskStatus.Completed);
        }
        this.options.artifactStore.finishAttempt(taskAttempt.id, { status: confirmedResult.status });
        this.appendTaskResultEvent(runId, task, confirmedResult);
        return;
      }
      const taskResult = this.persistTaskResult(runId, task, inputArtifacts, confirmedResult);
      this.options.store.updateWorkflowTaskResult(task.id, taskResult, attempt);
      this.options.artifactStore.finishAttempt(taskAttempt.id, { status: taskResult.status });
      this.appendTaskResultEvent(runId, task, taskResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const preserveAwaitingApproval =
        task.role === EnterpriseLeadAgentRole.PromotionPerformanceReview &&
        task.status === EnterpriseLeadTaskStatus.AwaitingApproval;
      if (!this.cancelledRuns.has(runId)) {
        if (preserveAwaitingApproval) {
          this.restoreAwaitingPromotionReview(task);
        } else {
          this.options.store.updateWorkflowTaskStatus(task.id, EnterpriseLeadTaskStatus.Error, {
            error: message,
            attempt,
          });
        }
        this.options.artifactStore.appendEvent({
          runId,
          type: 'task_failed',
          taskId: task.id,
          role: task.role,
          summary: message,
        });
      }
      this.options.artifactStore.finishAttempt(taskAttempt.id, {
        status: this.cancelledRuns.has(runId) ? EnterpriseLeadTaskStatus.Cancelled : EnterpriseLeadTaskStatus.Error,
        error: message,
      });
    }
  }

  private restoreAwaitingPromotionReview(task: EnterpriseLeadAgentTask): void {
    this.options.store.updateWorkflowTaskResult(
      task.id,
      {
        role: task.role,
        status: EnterpriseLeadTaskStatus.AwaitingApproval,
        summary: task.summary,
        outputs: task.outputPayload,
        artifactRefs: task.artifactRefs,
        missingInfo: task.missingInfo,
        todos: task.todos,
        risks: task.risks,
        handoffContext: task.handoffContext,
      },
      task.attempt ?? 0,
    );
  }

  private persistTaskResult(
    runId: string,
    task: EnterpriseLeadAgentTask,
    inputArtifacts: WorkflowArtifactRef[],
    result: PromotionTaskResult,
  ): EnterpriseLeadAgentTaskResult {
    const invalidArtifactRefs = this.getInvalidTaskArtifactRefs(
      result.artifactRefs,
      inputArtifacts,
      runId,
      task.id,
    );
    const confirmedResult = invalidArtifactRefs.length > 0
      ? {
          ...result,
          status: EnterpriseLeadTaskStatus.NeedsInput,
          artifactRefs: [],
          missingInfo: Array.from(new Set([...result.missingInfo, 'verified workflow artifacts'])),
        }
      : result;
    if (
      confirmedResult.status !== EnterpriseLeadTaskStatus.Completed &&
      confirmedResult.status !== EnterpriseLeadTaskStatus.AwaitingApproval
    ) {
      return {
        ...confirmedResult,
        outputs: confirmedResult.outputs as Record<string, unknown>,
        artifactRefs: dedupeWorkflowArtifactRefs([
          ...inputArtifacts,
          ...(task.artifactRefs ?? []),
        ]),
      };
    }
    const evidenceIds = confirmedResult.artifactRefs.flatMap(artifact => artifact.evidenceIds);
    const artifact = this.options.artifactStore.createArtifactIfRunActive({
      runId,
      taskId: task.id,
      kind: getPromotionWorkflowArtifactKind(task.role),
      schemaVersion: 1,
      payload: {
        ...(confirmedResult.outputs as Record<string, unknown>),
        ...(task.role === EnterpriseLeadAgentRole.PromotionAccountMonitoring
          ? { scheduledPromotionMonitoring: task.inputPayload.scheduledPromotionMonitoring }
          : {}),
      },
      evidenceIds,
    });
    const outputArtifact: WorkflowArtifactRef = {
      id: artifact.id,
      kind: artifact.kind,
      schemaVersion: artifact.schemaVersion,
      summary: result.summary,
      producerTaskId: task.id,
      evidenceIds: artifact.evidenceIds,
    };
    return {
      ...confirmedResult,
      outputs: confirmedResult.outputs as Record<string, unknown>,
      artifactRefs: dedupeWorkflowArtifactRefs([
        ...inputArtifacts,
        ...(task.artifactRefs ?? []),
        ...confirmedResult.artifactRefs,
        outputArtifact,
      ]),
    };
  }

  private getInvalidTaskArtifactRefs(
    artifactRefs: WorkflowArtifactRef[],
    inputArtifacts: WorkflowArtifactRef[],
    runId: string,
    taskId: string,
  ): string[] {
    const allowedRefIds = new Set(inputArtifacts.map(artifact => artifact.id));
    return artifactRefs.flatMap(ref => {
      const artifact = this.options.artifactStore.getArtifact(ref.id);
      if (
        !artifact ||
        artifact.runId !== runId ||
        artifact.taskId !== ref.producerTaskId ||
        artifact.kind !== ref.kind ||
        !allowedRefIds.has(ref.id) ||
        artifact.taskId === taskId
      ) {
        return [ref.id];
      }
      return [];
    });
  }

  private appendTaskResultEvent(
    runId: string,
    task: EnterpriseLeadAgentTask,
    result: Pick<EnterpriseLeadAgentTaskResult, 'status' | 'summary'>,
  ): void {
    const eventType =
      result.status === EnterpriseLeadTaskStatus.Completed
        ? 'task_completed'
        : result.status === EnterpriseLeadTaskStatus.NeedsInput
          ? 'task_blocked'
          : result.status === EnterpriseLeadTaskStatus.AwaitingApproval
            ? 'approval_required'
            : result.status === EnterpriseLeadTaskStatus.Blocked
              ? 'task_blocked'
              : 'task_failed';
    this.options.artifactStore.appendEvent({
      runId,
      type: eventType,
      taskId: task.id,
      role: task.role,
      summary: result.summary,
    });
  }

  private getPausedRunStatus(tasks: EnterpriseLeadAgentTask[]): {
    status: typeof EnterpriseLeadRunStatus[keyof typeof EnterpriseLeadRunStatus];
    task: EnterpriseLeadAgentTask;
  } | null {
    const priority: Array<[
      EnterpriseLeadAgentTask['status'],
      typeof EnterpriseLeadRunStatus[keyof typeof EnterpriseLeadRunStatus],
    ]> = [
      [EnterpriseLeadTaskStatus.AwaitingApproval, EnterpriseLeadRunStatus.AwaitingApproval],
      [EnterpriseLeadTaskStatus.NeedsInput, EnterpriseLeadRunStatus.NeedsInput],
      [EnterpriseLeadTaskStatus.Blocked, EnterpriseLeadRunStatus.Blocked],
      [EnterpriseLeadTaskStatus.Error, EnterpriseLeadRunStatus.Error],
    ];
    for (const [taskStatus, runStatus] of priority) {
      const task = tasks.find(candidate => candidate.status === taskStatus);
      if (task) return { status: runStatus, task };
    }
    return null;
  }

  private finishRunIfSettled(
    workspaceId: string,
    runId: string,
    tasks: EnterpriseLeadAgentTask[],
  ): EnterpriseLeadWorkspaceSnapshot {
    const paused = this.getPausedRunStatus(tasks);
    if (paused) {
      this.options.store.updateRunProgress({
        runId,
        status: paused.status,
        currentRole: paused.task.role,
        controllerSummary: EMPTY_WORKFLOW_CONTROLLER_SUMMARY,
      });
      return this.getSnapshot(workspaceId, runId);
    }
    if (tasks.every(isCompleted)) {
      this.options.store.updateRunProgress({
        runId,
        status: EnterpriseLeadRunStatus.Completed,
        currentRole: null,
        controllerSummary: EMPTY_WORKFLOW_CONTROLLER_SUMMARY,
      });
      this.options.artifactStore.appendEvent({ runId, type: 'run_completed' });
    }
    return this.getSnapshot(workspaceId, runId);
  }

  private requireApprovalTask(runId: string, taskId: string): EnterpriseLeadAgentTask {
    const task = this.options.store.getTask(taskId);
    if (!task || task.runId !== runId) {
      throw new Error('Enterprise lead workflow task not found');
    }
    if (task.status !== EnterpriseLeadTaskStatus.AwaitingApproval) {
      throw new Error('Enterprise lead workflow task is not awaiting approval');
    }
    return task;
  }

  private assertRunWorkspace(workspaceId: string, runId: string) {
    const run = this.options.store.getRun(runId);
    if (!run) {
      throw new Error('Enterprise lead run not found');
    }
    if (run.workspaceId !== workspaceId) {
      throw new Error('Enterprise lead run does not belong to workspace');
    }
    return run;
  }
}
