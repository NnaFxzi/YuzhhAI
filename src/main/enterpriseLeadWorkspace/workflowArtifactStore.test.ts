import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import {
  EnterpriseLeadRunStatus,
  EnterpriseLeadWorkspaceType,
} from '../../shared/enterpriseLeadWorkspace/constants';
import { WorkflowExecutionMode } from '../../shared/enterpriseLeadWorkspace/workflowContracts';
import { EnterpriseLeadWorkspaceStore } from './store';
import { createWorkflowArtifactStore, WorkflowArtifactStore } from './workflowArtifactStore';

describe('WorkflowArtifactStore', () => {
  let database: Database.Database | undefined;
  const stores: WorkflowArtifactStore[] = [];

  afterEach(() => {
    stores.splice(0).forEach(store => store.close());
    database?.close();
    database = undefined;
  });

  const createStore = (): WorkflowArtifactStore => {
    const store = createWorkflowArtifactStore(':memory:');
    stores.push(store);
    return store;
  };

  test('stores artifact lineage and returns events in sequence order', () => {
    const store = createStore();

    const artifact = store.createArtifact({
      runId: 'run-1',
      taskId: 'task-1',
      kind: 'clean_lead_dataset',
      schemaVersion: 1,
      payload: { rows: 2 },
      evidenceIds: ['evidence-1'],
    });

    store.appendEvent({ runId: 'run-1', type: 'task_started', taskId: 'task-1' });
    store.appendEvent({ runId: 'run-1', type: 'task_completed', taskId: 'task-1' });

    expect(store.getArtifact(artifact.id)).toMatchObject({
      runId: 'run-1',
      taskId: 'task-1',
      kind: 'clean_lead_dataset',
    });
    expect(store.listEvents('run-1').map(event => event.sequence)).toEqual([1, 2]);
  });

  test('returns a bounded, sequence-stable event history for one run', () => {
    const store = createStore();

    store.appendEvent({ runId: 'run-1', type: 'run_started' });
    store.appendEvent({ runId: 'run-2', type: 'run_started' });
    store.appendEvent({ runId: 'run-1', type: 'task_ready', taskId: 'task-1' });
    store.appendEvent({ runId: 'run-1', type: 'task_started', taskId: 'task-1' });

    expect(store.listRecentEvents('run-1', 2).map(event => event.sequence)).toEqual([2, 3]);
    expect(store.listRecentEvents('run-1', 2)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ runId: 'run-2' })]),
    );
  });

  test('round trips artifacts, events, and task attempts through JSON storage', () => {
    const store = createStore();
    const artifact = store.createArtifact({
      runId: 'run-1',
      taskId: 'task-1',
      kind: 'scored_leads',
      schemaVersion: 2,
      payload: { rows: [{ score: 0.9 }] },
      evidenceIds: ['evidence-1', 'evidence-2'],
    });
    const event = store.appendEvent({
      runId: 'run-1',
      type: 'task_completed',
      taskId: 'task-1',
      role: 'promotion_data_cleaning',
      summary: 'finished',
      payload: { artifactId: artifact.id },
    });
    const attempt = store.createAttempt({
      taskId: 'task-1',
      attempt: 1,
      executionMode: WorkflowExecutionMode.Inline,
    });
    const finishedAttempt = store.finishAttempt(attempt.id, {
      status: 'completed',
      error: '',
    });

    expect(store.listRunArtifacts('run-1')).toEqual([artifact]);
    expect(store.listEvents('run-1')).toEqual([event]);
    expect(finishedAttempt).toMatchObject({
      id: attempt.id,
      taskId: 'task-1',
      attempt: 1,
      executionMode: WorkflowExecutionMode.Inline,
      status: 'completed',
      error: '',
      startedAt: attempt.startedAt,
      endedAt: expect.any(String),
    });
  });

  test('records an explicit retry attempt and keeps subsequent failures terminal without duplicate run errors', () => {
    database = new Database(':memory:');
    const workspaceStore = new EnterpriseLeadWorkspaceStore(database);
    const store = new WorkflowArtifactStore(database);
    const workspace = workspaceStore.createWorkspace({
      name: 'Promotion workspace',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
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
      enabledAgentRoles: [],
    });
    const run = workspaceStore.createRun({
      workspaceId: workspace.id,
      userGoal: 'Run promotion workflow',
      roles: [],
    });

    const firstFailure = store.markRunErrorOnce(run.id, 'first gateway failure');
    const retry = store.retryRunOnce(run.id);
    const resumedFailure = store.markRunErrorOnce(run.id, 'second gateway failure');

    expect(firstFailure).toMatchObject({ transitioned: true, event: { type: 'run_error' } });
    expect(retry).toMatchObject({ transitioned: true, event: { type: 'run_retrying' } });
    expect(resumedFailure).toEqual({ transitioned: true });
    expect(workspaceStore.getRun(run.id)).toMatchObject({
      status: EnterpriseLeadRunStatus.Error,
      controllerSummary: 'second gateway failure',
    });
    expect(store.listEvents(run.id).filter(event => event.type === 'run_error')).toEqual([
      expect.objectContaining({ summary: 'first gateway failure' }),
    ]);
    expect(store.listEvents(run.id).filter(event => event.type === 'run_retrying')).toHaveLength(1);
  });

  test('keeps a cancelled run unchanged when a late workflow rejection arrives', () => {
    database = new Database(':memory:');
    const workspaceStore = new EnterpriseLeadWorkspaceStore(database);
    const store = new WorkflowArtifactStore(database);
    const workspace = workspaceStore.createWorkspace({
      name: 'Promotion workspace',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
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
      enabledAgentRoles: [],
    });
    const run = workspaceStore.createRun({
      workspaceId: workspace.id,
      userGoal: 'Run promotion workflow',
      roles: [],
    });
    workspaceStore.cancelWorkflowRun(run.id);

    const result = store.markRunErrorOnce(run.id, 'late gateway failure');

    expect(result).toEqual({ transitioned: false });
    expect(workspaceStore.getRun(run.id)).toMatchObject({
      status: EnterpriseLeadRunStatus.Cancelled,
      controllerSummary: 'Workflow cancelled.',
    });
    expect(store.listEvents(run.id).filter(event => event.type === 'run_error')).toEqual([]);
  });

  test('closes string-path connections without closing caller-owned databases', () => {
    const store = createWorkflowArtifactStore(':memory:');
    expect(() => store.close()).not.toThrow();
    expect(() => store.listEvents('run-1')).toThrow();

    database = new Database(':memory:');
    const callerOwnedStore = new WorkflowArtifactStore(database);
    callerOwnedStore.close();
    expect(database.open).toBe(true);
  });

  test('initializes new tables while preserving legacy workspace, run, and task reads', () => {
    database = new Database(':memory:');
    database.exec(`
      CREATE TABLE enterprise_lead_workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        profile TEXT NOT NULL,
        extraction_sources TEXT NOT NULL,
        risk_rules TEXT NOT NULL,
        enabled_agent_roles TEXT NOT NULL,
        recent_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE enterprise_lead_runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_goal TEXT NOT NULL,
        status TEXT NOT NULL,
        current_role TEXT,
        controller_summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE enterprise_lead_agent_tasks (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        input_payload TEXT NOT NULL,
        output_payload TEXT NOT NULL,
        summary TEXT NOT NULL,
        missing_info TEXT NOT NULL,
        todos TEXT NOT NULL,
        risks TEXT NOT NULL,
        handoff_context TEXT NOT NULL,
        error TEXT NOT NULL,
        stale INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO enterprise_lead_workspaces VALUES (
        'legacy-workspace', 'Legacy workspace', 'enterprise_lead',
        '{"companySummary":"old company"}', '[]', '["no_real_publish"]',
        '["controller"]', 'legacy-run', '2026-01-01T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z'
      );
      INSERT INTO enterprise_lead_runs (
        id, workspace_id, user_goal, status, current_role, controller_summary,
        created_at, updated_at
      ) VALUES (
        'legacy-run', 'legacy-workspace', 'old goal', 'completed',
        'controller', 'old summary', '2026-01-01T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z'
      );
      INSERT INTO enterprise_lead_agent_tasks (
        id, run_id, role, status, input_payload, output_payload, summary,
        missing_info, todos, risks, handoff_context, error, stale, created_at,
        updated_at
      ) VALUES (
        'legacy-task', 'legacy-run', 'controller', 'completed', '{"input":1}',
        '{"output":2}', 'old task summary', '[]', '[]', '[]', '{}', '', 0,
        '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'
      );
    `);

    const store = new WorkflowArtifactStore(database);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(database);

    expect(store.listRunArtifacts('legacy-run')).toEqual([]);
    expect(store.listEvents('legacy-run')).toEqual([]);
    expect(workspaceStore.getWorkspace('legacy-workspace')).toMatchObject({
      id: 'legacy-workspace',
      name: 'Legacy workspace',
      profile: { companySummary: 'old company' },
    });
    expect(workspaceStore.getRun('legacy-run')).toMatchObject({
      id: 'legacy-run',
      workspaceId: 'legacy-workspace',
      userGoal: 'old goal',
      controllerSummary: 'old summary',
      archiveStatus: 'not_archived',
      completedAt: null,
    });
    expect(workspaceStore.getTask('legacy-task')).toMatchObject({
      id: 'legacy-task',
      runId: 'legacy-run',
      inputPayload: { input: 1 },
      outputPayload: { output: 2 },
      summary: 'old task summary',
      stale: false,
    });
  });
});
