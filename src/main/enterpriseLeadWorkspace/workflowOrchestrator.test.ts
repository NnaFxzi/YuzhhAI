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

  constructor(
    private readonly results: Partial<Record<string, TaskResultOverride | TaskResultOverride[]>> = {},
  ) {}

  async execute(context: Parameters<WorkflowExecutionAdapter['execute']>[0]): Promise<PromotionTaskResult> {
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
