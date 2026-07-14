import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadRunStatus,
  EnterpriseLeadTaskStatus,
  EnterpriseLeadWorkspaceType,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type { PromotionTaskResult } from '../../shared/enterpriseLeadWorkspace/promotionTaskContracts';
import { WorkflowExecutionMode } from '../../shared/enterpriseLeadWorkspace/workflowContracts';
import { EnterpriseLeadWorkspaceStore } from './store';
import { WorkflowArtifactStore } from './workflowArtifactStore';
import type { WorkflowExecutionAdapter } from './workflowExecutionAdapter';
import { EnterpriseLeadWorkflowOrchestrator } from './workflowOrchestrator';

type TaskResultOverride = Partial<PromotionTaskResult>;

class FakeWorkflowExecutionAdapter implements WorkflowExecutionAdapter {
  active = 0;
  maxConcurrent = 0;
  readonly calls = new Map<string, number>();
  readonly contexts: Array<Parameters<WorkflowExecutionAdapter['execute']>[0]> = [];

  constructor(
    private readonly results: Partial<Record<string, TaskResultOverride | TaskResultOverride[]>> = {},
  ) {}

  async execute(context: Parameters<WorkflowExecutionAdapter['execute']>[0]): Promise<PromotionTaskResult> {
    this.contexts.push(context);
    this.active += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.active);
    this.calls.set(context.role, (this.calls.get(context.role) ?? 0) + 1);
    await Promise.resolve();
    this.active -= 1;

    const configured = this.results[context.role];
    const override = Array.isArray(configured)
      ? configured[Math.min((this.calls.get(context.role) ?? 1) - 1, configured.length - 1)]
      : configured;
    return {
      role: context.role,
      status: EnterpriseLeadTaskStatus.Completed,
      summary: `${context.role} completed`,
      outputs: { role: context.role },
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
      artifactRefs: [],
      ...override,
    } as PromotionTaskResult;
  }
}

const profile = {
  companySummary: 'Industrial packaging supplier',
  productList: [],
  productCapabilities: [],
  targetCustomers: [],
  applicationScenarios: [],
  sellingPoints: [],
  channelPreferences: [],
  prohibitedClaims: [],
  contactRules: [],
  missingInfo: [],
};

const setup = (adapter = new FakeWorkflowExecutionAdapter()) => {
  const database = new Database(':memory:');
  const store = new EnterpriseLeadWorkspaceStore(database);
  const artifacts = new WorkflowArtifactStore(database);
  const workspace = store.createWorkspace({
    name: 'Promotion workspace',
    type: EnterpriseLeadWorkspaceType.EnterpriseLead,
    profile,
    extractionSources: [],
    enabledAgentRoles: [],
  });
  const run = store.createRun({ workspaceId: workspace.id, userGoal: 'Create promotion drafts' });
  const orchestrator = new EnterpriseLeadWorkflowOrchestrator({
    store,
    artifactStore: artifacts,
    executionAdapter: adapter,
  });

  return { adapter, artifacts, database, orchestrator, run, store, workspace };
};

describe('EnterpriseLeadWorkflowOrchestrator', () => {
  const databases: Database.Database[] = [];

  afterEach(() => {
    databases.splice(0).forEach(database => database.close());
  });

  test('runs independent insight tasks in parallel after cleaning completes', async () => {
    const setupResult = setup();
    databases.push(setupResult.database);

    const snapshot = await setupResult.orchestrator.startRun(
      setupResult.workspace.id,
      setupResult.run.id,
    );

    expect(setupResult.adapter.maxConcurrent).toBe(2);
    expect(snapshot.tasks.find(task => task.role === EnterpriseLeadAgentRole.PromotionCompetitorInsight)?.status)
      .toBe(EnterpriseLeadTaskStatus.Completed);
    expect(snapshot.tasks.find(task => task.role === EnterpriseLeadAgentRole.PromotionLeadScoring)?.status)
      .toBe(EnterpriseLeadTaskStatus.Completed);
    expect(setupResult.artifacts.listEvents(setupResult.run.id).map(event => event.type)).toContain(
      'task_ready',
    );
    expect(setupResult.artifacts.listRunArtifacts(setupResult.run.id)).not.toHaveLength(0);
    expect(snapshot.currentRun?.controllerSummary).toBe('');
  });

  test('pauses downstream tasks when a worker needs input', async () => {
    const adapter = new FakeWorkflowExecutionAdapter({
      [EnterpriseLeadAgentRole.PromotionDataCleaning]: {
        status: EnterpriseLeadTaskStatus.NeedsInput,
        summary: 'Need deduplication rules',
      },
    });
    const setupResult = setup(adapter);
    databases.push(setupResult.database);

    const snapshot = await setupResult.orchestrator.startRun(
      setupResult.workspace.id,
      setupResult.run.id,
    );

    expect(snapshot.currentRun?.status).toBe(EnterpriseLeadRunStatus.NeedsInput);
    expect(snapshot.currentRun?.controllerSummary).toBe('');
    expect(snapshot.tasks.find(task => task.role === EnterpriseLeadAgentRole.PromotionCompetitorInsight)?.status)
      .toBe(EnterpriseLeadTaskStatus.Waiting);
  });

  test('requires an explicit approval decision before it runs downstream tasks', async () => {
    const adapter = new FakeWorkflowExecutionAdapter({
      [EnterpriseLeadAgentRole.PromotionDataCleaning]: {
        status: EnterpriseLeadTaskStatus.AwaitingApproval,
        summary: 'Review cleaned leads',
      },
    });
    const setupResult = setup(adapter);
    databases.push(setupResult.database);

    const paused = await setupResult.orchestrator.startRun(setupResult.workspace.id, setupResult.run.id);
    const task = paused.tasks.find(item => item.role === EnterpriseLeadAgentRole.PromotionDataCleaning);
    expect(paused.currentRun?.status).toBe(EnterpriseLeadRunStatus.AwaitingApproval);
    expect(task?.status).toBe(EnterpriseLeadTaskStatus.AwaitingApproval);

    const approved = await setupResult.orchestrator.approveTask(
      setupResult.workspace.id,
      setupResult.run.id,
      task!.id,
    );
    expect(approved.tasks.find(item => item.id === task!.id)?.status).toBe(
      EnterpriseLeadTaskStatus.Completed,
    );

    const resumed = await setupResult.orchestrator.resumeRun(setupResult.workspace.id, setupResult.run.id);
    expect(resumed.currentRun?.status).toBe(EnterpriseLeadRunStatus.Completed);
  });

  test('persists bounded rejection feedback as a durable approval event', async () => {
    const adapter = new FakeWorkflowExecutionAdapter({
      [EnterpriseLeadAgentRole.PromotionDataCleaning]: {
        status: EnterpriseLeadTaskStatus.AwaitingApproval,
        summary: 'Review cleaned leads',
      },
    });
    const setupResult = setup(adapter);
    databases.push(setupResult.database);

    const paused = await setupResult.orchestrator.startRun(setupResult.workspace.id, setupResult.run.id);
    const task = paused.tasks.find(item => item.role === EnterpriseLeadAgentRole.PromotionDataCleaning);
    if (!task) throw new Error('Expected approval task');

    await expect(
      setupResult.orchestrator.rejectTask(
        setupResult.workspace.id,
        setupResult.run.id,
        task.id,
        ' ',
      ),
    ).rejects.toThrow('Workflow review feedback is required');

    await setupResult.orchestrator.rejectTask(
      setupResult.workspace.id,
      setupResult.run.id,
      task.id,
      '  Please add source links.  ',
    );

    expect(setupResult.artifacts.listEvents(setupResult.run.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'approval_rejected',
          payload: { feedback: 'Please add source links.' },
        }),
      ]),
    );
  });

  test('retries errors on resume without rerunning completed tasks', async () => {
    const adapter = new FakeWorkflowExecutionAdapter({
      [EnterpriseLeadAgentRole.PromotionDataCleaning]: [
        { status: EnterpriseLeadTaskStatus.Error, summary: 'temporary failure' },
        { status: EnterpriseLeadTaskStatus.Completed },
      ],
    });
    const setupResult = setup(adapter);
    databases.push(setupResult.database);

    const failed = await setupResult.orchestrator.startRun(setupResult.workspace.id, setupResult.run.id);
    expect(failed.currentRun?.status).toBe(EnterpriseLeadRunStatus.Error);
    const controllerCalls = setupResult.adapter.calls.get(EnterpriseLeadAgentRole.PromotionController);

    const resumed = await setupResult.orchestrator.resumeRun(setupResult.workspace.id, setupResult.run.id);
    expect(resumed.currentRun?.status).toBe(EnterpriseLeadRunStatus.Completed);
    expect(setupResult.adapter.calls.get(EnterpriseLeadAgentRole.PromotionDataCleaning)).toBe(2);
    expect(setupResult.adapter.calls.get(EnterpriseLeadAgentRole.PromotionController)).toBe(controllerCalls);
    expect(setupResult.artifacts.listEvents(setupResult.run.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'run_retrying' })]),
    );
  });

  test('does not resume completed, cancelled, or archived runs or append terminal events', async () => {
    const completedSetup = setup();
    const cancelledSetup = setup();
    const archivedSetup = setup();
    databases.push(completedSetup.database, cancelledSetup.database, archivedSetup.database);

    await completedSetup.orchestrator.startRun(completedSetup.workspace.id, completedSetup.run.id);
    const completedEvents = completedSetup.artifacts.listEvents(completedSetup.run.id);
    const completedSnapshot = await completedSetup.orchestrator.resumeRun(
      completedSetup.workspace.id,
      completedSetup.run.id,
    );

    await cancelledSetup.orchestrator.cancelRun(cancelledSetup.workspace.id, cancelledSetup.run.id);
    const cancelledEvents = cancelledSetup.artifacts.listEvents(cancelledSetup.run.id);
    const cancelledSnapshot = await cancelledSetup.orchestrator.resumeRun(
      cancelledSetup.workspace.id,
      cancelledSetup.run.id,
    );

    archivedSetup.store.updateRunProgress({
      runId: archivedSetup.run.id,
      status: EnterpriseLeadRunStatus.Completed,
      currentRole: null,
      controllerSummary: 'Completed for archive.',
    });
    archivedSetup.store.archiveRun(archivedSetup.workspace.id, archivedSetup.run.id);
    const archivedEvents = archivedSetup.artifacts.listEvents(archivedSetup.run.id);
    const archivedSnapshot = await archivedSetup.orchestrator.resumeRun(
      archivedSetup.workspace.id,
      archivedSetup.run.id,
    );

    expect(completedSnapshot.currentRun?.status).toBe(EnterpriseLeadRunStatus.Completed);
    expect(completedSetup.artifacts.listEvents(completedSetup.run.id)).toEqual(completedEvents);
    expect(cancelledSnapshot.currentRun?.status).toBe(EnterpriseLeadRunStatus.Cancelled);
    expect(cancelledSetup.artifacts.listEvents(cancelledSetup.run.id)).toEqual(cancelledEvents);
    expect(archivedSnapshot.currentRun?.status).toBe(EnterpriseLeadRunStatus.Archived);
    expect(archivedSetup.artifacts.listEvents(archivedSetup.run.id)).toEqual(archivedEvents);
  });

  test('does not initialize or replace terminal runs when Start is requested', async () => {
    const zeroTaskSetup = setup();
    const waitingTaskSetup = setup();
    databases.push(zeroTaskSetup.database, waitingTaskSetup.database);

    zeroTaskSetup.store.updateRunProgress({
      runId: zeroTaskSetup.run.id,
      status: EnterpriseLeadRunStatus.Completed,
      currentRole: null,
      controllerSummary: 'Completed before workflow initialization.',
    });
    waitingTaskSetup.store.initializeWorkflowRun(
      waitingTaskSetup.run.id,
      [{ role: EnterpriseLeadAgentRole.PromotionController, nodeId: 'controller' }],
      { enabledOptionalNodes: [], maxConcurrency: 1 },
    );
    const waitingTask = waitingTaskSetup.store.listTasks(waitingTaskSetup.run.id)[0];
    waitingTaskSetup.store.updateRunProgress({
      runId: waitingTaskSetup.run.id,
      status: EnterpriseLeadRunStatus.Completed,
      currentRole: null,
      controllerSummary: 'Completed before workflow replacement.',
    });

    await expect(
      zeroTaskSetup.orchestrator.startRun(zeroTaskSetup.workspace.id, zeroTaskSetup.run.id),
    ).rejects.toThrow('Enterprise lead run is terminal');
    await expect(
      waitingTaskSetup.orchestrator.startRun(waitingTaskSetup.workspace.id, waitingTaskSetup.run.id),
    ).rejects.toThrow('Enterprise lead run is terminal');

    expect(zeroTaskSetup.store.listTasks(zeroTaskSetup.run.id)).toEqual([]);
    expect(zeroTaskSetup.artifacts.listEvents(zeroTaskSetup.run.id)).toEqual([]);
    expect(waitingTaskSetup.store.listTasks(waitingTaskSetup.run.id)).toEqual([
      expect.objectContaining({ id: waitingTask.id, status: EnterpriseLeadTaskStatus.Waiting }),
    ]);
    expect(waitingTaskSetup.artifacts.listEvents(waitingTaskSetup.run.id)).toEqual([]);
  });

  test('retains own task artifacts after result persistence and on retry without model echo', async () => {
    const taskArtifact = {
      id: 'task-artifact',
      kind: 'draft',
      schemaVersion: 1,
      summary: 'Persisted task context',
      producerTaskId: 'controller-task',
      evidenceIds: [],
    };
    const adapter = new FakeWorkflowExecutionAdapter({
      [EnterpriseLeadAgentRole.PromotionController]: [
        { status: EnterpriseLeadTaskStatus.Error },
        { status: EnterpriseLeadTaskStatus.Completed },
      ],
    });
    const setupResult = setup(adapter);
    databases.push(setupResult.database);

    setupResult.store.initializeWorkflowRun(
      setupResult.run.id,
      [{ role: EnterpriseLeadAgentRole.PromotionController, nodeId: 'controller' }],
      { enabledOptionalNodes: [], maxConcurrency: 1 },
    );
    const controllerTask = setupResult.store.listTasks(setupResult.run.id)[0];
    setupResult.database.prepare(`
      UPDATE enterprise_lead_agent_tasks
      SET artifact_refs = ?
      WHERE id = ?
    `).run(JSON.stringify([taskArtifact]), controllerTask.id);

    const failed = await setupResult.orchestrator.resumeRun(
      setupResult.workspace.id,
      setupResult.run.id,
    );
    expect(failed.currentRun?.status).toBe(EnterpriseLeadRunStatus.Error);
    expect(setupResult.store.getTask(controllerTask.id)?.artifactRefs).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: taskArtifact.id })]),
    );

    const resumed = await setupResult.orchestrator.resumeRun(setupResult.workspace.id, setupResult.run.id);
    expect(resumed.currentRun?.status).toBe(EnterpriseLeadRunStatus.Completed);

    const controllerContexts = adapter.contexts.filter(
      context => context.role === EnterpriseLeadAgentRole.PromotionController,
    );
    expect(controllerContexts).toHaveLength(2);
    controllerContexts.forEach(context => {
      expect(context.inputArtifacts).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: taskArtifact.id })]),
      );
      expect(context.inputArtifacts.filter(artifact => artifact.id === taskArtifact.id)).toHaveLength(1);
    });
  });

  test('recovers persisted running tasks on resume without rerunning completed work', async () => {
    const firstAdapter = new FakeWorkflowExecutionAdapter({
      [EnterpriseLeadAgentRole.PromotionDataCleaning]: {
        status: EnterpriseLeadTaskStatus.Error,
        summary: 'temporary failure',
      },
    });
    const setupResult = setup(firstAdapter);
    databases.push(setupResult.database);

    const interrupted = await setupResult.orchestrator.startRun(
      setupResult.workspace.id,
      setupResult.run.id,
    );
    const cleaningTask = interrupted.tasks.find(
      task => task.role === EnterpriseLeadAgentRole.PromotionDataCleaning,
    );
    if (!cleaningTask) throw new Error('Expected data cleaning task');

    expect(setupResult.artifacts.retryRunOnce(setupResult.run.id).transitioned).toBe(true);
    const orphanedAttempt = (cleaningTask.attempt ?? 0) + 1;
    setupResult.store.updateWorkflowTaskStatus(cleaningTask.id, EnterpriseLeadTaskStatus.Running, {
      attempt: orphanedAttempt,
    });
    setupResult.artifacts.createAttempt({
      taskId: cleaningTask.id,
      attempt: orphanedAttempt,
      executionMode: WorkflowExecutionMode.Inline,
    });

    const restartedAdapter = new FakeWorkflowExecutionAdapter();
    const restartedOrchestrator = new EnterpriseLeadWorkflowOrchestrator({
      store: setupResult.store,
      artifactStore: setupResult.artifacts,
      executionAdapter: restartedAdapter,
    });
    const resumed = await restartedOrchestrator.resumeRun(
      setupResult.workspace.id,
      setupResult.run.id,
    );

    expect(resumed.currentRun?.status).toBe(EnterpriseLeadRunStatus.Completed);
    expect(restartedAdapter.calls.get(EnterpriseLeadAgentRole.PromotionController)).toBeUndefined();
    expect(restartedAdapter.calls.get(EnterpriseLeadAgentRole.PromotionDataCleaning)).toBe(1);
    expect(setupResult.artifacts.listEvents(setupResult.run.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'task_failed',
          taskId: cleaningTask.id,
          summary: 'Workflow task was interrupted by process restart.',
        }),
        expect.objectContaining({ type: 'task_retrying', taskId: cleaningTask.id }),
      ]),
    );
    const attempts = setupResult.database
      .prepare(
        'SELECT attempt, status FROM enterprise_lead_task_attempts WHERE task_id = ? ORDER BY attempt ASC, rowid ASC',
      )
      .all(cleaningTask.id) as Array<{ attempt: number; status: string }>;
    expect(attempts).toEqual(
      expect.arrayContaining([
        { attempt: orphanedAttempt, status: EnterpriseLeadTaskStatus.Error },
        { attempt: orphanedAttempt + 1, status: EnterpriseLeadTaskStatus.Completed },
      ]),
    );
  });

  test('persists normalized start options and does not enable new optional nodes on resume', async () => {
    const setupResult = setup();
    databases.push(setupResult.database);

    await setupResult.orchestrator.startRun(setupResult.workspace.id, setupResult.run.id, {
      enabledOptionalNodes: ['sales_handoff_requested', 'not_a_node'],
      maxConcurrency: 99,
    });
    const options = setupResult.store.getWorkflowStartOptions(setupResult.run.id);

    expect(options).toEqual({
      enabledOptionalNodes: ['sales_handoff_requested'],
      maxConcurrency: 3,
    });
    expect(setupResult.store.listTasks(setupResult.run.id).some(task => task.role === EnterpriseLeadAgentRole.SalesHandoff))
      .toBe(true);
    expect(setupResult.store.listTasks(setupResult.run.id).some(task => task.role === EnterpriseLeadAgentRole.PromotionAccountMonitoring))
      .toBe(false);
  });

  test('cancels every unfinished task while preserving produced artifacts', async () => {
    const adapter = new FakeWorkflowExecutionAdapter({
      [EnterpriseLeadAgentRole.PromotionDataCleaning]: {
        status: EnterpriseLeadTaskStatus.NeedsInput,
      },
    });
    const setupResult = setup(adapter);
    databases.push(setupResult.database);

    await setupResult.orchestrator.startRun(setupResult.workspace.id, setupResult.run.id);
    const artifactCount = setupResult.artifacts.listRunArtifacts(setupResult.run.id).length;
    const cancelled = await setupResult.orchestrator.cancelRun(setupResult.workspace.id, setupResult.run.id);

    expect(cancelled.currentRun?.status).toBe(EnterpriseLeadRunStatus.Cancelled);
    expect(cancelled.currentRun?.controllerSummary).toBe('');
    expect(cancelled.tasks.filter(task => task.status !== EnterpriseLeadTaskStatus.Completed))
      .toEqual(expect.arrayContaining([expect.objectContaining({ status: EnterpriseLeadTaskStatus.Cancelled })]));
    expect(setupResult.artifacts.listRunArtifacts(setupResult.run.id)).toHaveLength(artifactCount);
    const cancelledTaskIds = cancelled.tasks
      .filter(task => task.status === EnterpriseLeadTaskStatus.Cancelled)
      .map(task => task.id);
    const events = setupResult.artifacts.listEvents(setupResult.run.id);
    expect(events.filter(event => event.type === 'task_cancelled').map(event => event.taskId)).toEqual(
      expect.arrayContaining(cancelledTaskIds),
    );
    expect(events.map(event => event.type)).toContain('run_cancelled');
  });

  test('does not cancel a completed run or append cancellation events', async () => {
    const setupResult = setup();
    databases.push(setupResult.database);

    const completed = await setupResult.orchestrator.startRun(
      setupResult.workspace.id,
      setupResult.run.id,
    );
    const eventsBeforeCancel = setupResult.artifacts.listEvents(setupResult.run.id);

    const afterCancel = await setupResult.orchestrator.cancelRun(
      setupResult.workspace.id,
      setupResult.run.id,
    );

    expect(completed.currentRun?.status).toBe(EnterpriseLeadRunStatus.Completed);
    expect(afterCancel.currentRun?.status).toBe(EnterpriseLeadRunStatus.Completed);
    expect(afterCancel.tasks).toEqual(completed.tasks);
    expect(setupResult.artifacts.listEvents(setupResult.run.id)).toEqual(eventsBeforeCancel);
  });

  test('clears a cancellation marker after the active run settles', async () => {
    let releaseExecution: (() => void) | undefined;
    const adapter: WorkflowExecutionAdapter = {
      async execute(context) {
        await new Promise<void>(resolve => {
          releaseExecution = resolve;
        });
        return {
          role: context.role,
          status: EnterpriseLeadTaskStatus.Completed,
          summary: `${context.role} completed`,
          outputs: { role: context.role },
          missingInfo: [],
          todos: [],
          risks: [],
          handoffContext: {},
          artifactRefs: [],
        } as PromotionTaskResult;
      },
    };
    const setupResult = setup(adapter);
    databases.push(setupResult.database);

    const activeRun = setupResult.orchestrator.startRun(setupResult.workspace.id, setupResult.run.id);
    await Promise.resolve();
    await setupResult.orchestrator.cancelRun(setupResult.workspace.id, setupResult.run.id);
    releaseExecution?.();
    await activeRun;

    expect((setupResult.orchestrator as unknown as { cancelledRuns: Set<string> }).cancelledRuns.has(
      setupResult.run.id,
    )).toBe(false);
  });

  test('settles the remaining parallel task when another task fails', async () => {
    const adapter: WorkflowExecutionAdapter = {
      async execute(context) {
        if (context.role === EnterpriseLeadAgentRole.PromotionCompetitorInsight) {
          throw new Error('competitor source unavailable');
        }
        return {
          role: context.role,
          status: EnterpriseLeadTaskStatus.Completed,
          summary: `${context.role} completed`,
          outputs: { role: context.role },
          missingInfo: [],
          todos: [],
          risks: [],
          handoffContext: {},
          artifactRefs: [],
        } as PromotionTaskResult;
      },
    };
    const setupResult = setup(adapter);
    databases.push(setupResult.database);

    const snapshot = await setupResult.orchestrator.startRun(
      setupResult.workspace.id,
      setupResult.run.id,
    );

    expect(snapshot.currentRun?.status).toBe(EnterpriseLeadRunStatus.Error);
    expect(snapshot.tasks.find(task => task.role === EnterpriseLeadAgentRole.PromotionCompetitorInsight)?.status)
      .toBe(EnterpriseLeadTaskStatus.Error);
    expect(snapshot.tasks.find(task => task.role === EnterpriseLeadAgentRole.PromotionLeadScoring)?.status)
      .toBe(EnterpriseLeadTaskStatus.Completed);
  });

  test('returns the single active run for duplicate starts', async () => {
    const setupResult = setup();
    databases.push(setupResult.database);

    const [first, duplicate] = await Promise.all([
      setupResult.orchestrator.startRun(setupResult.workspace.id, setupResult.run.id),
      setupResult.orchestrator.startRun(setupResult.workspace.id, setupResult.run.id),
    ]);

    expect(duplicate).toEqual(first);
    expect(setupResult.adapter.calls.get(EnterpriseLeadAgentRole.PromotionController)).toBe(1);
  });
});
