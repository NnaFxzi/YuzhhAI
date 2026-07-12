import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import { WorkflowExecutionMode } from '../../shared/enterpriseLeadWorkspace/workflowContracts';
import { createWorkflowArtifactStore, WorkflowArtifactStore } from './workflowArtifactStore';

describe('WorkflowArtifactStore', () => {
  let database: Database.Database | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  test('stores artifact lineage and returns events in sequence order', () => {
    const store = createWorkflowArtifactStore(':memory:');

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

  test('round trips artifacts, events, and task attempts through JSON storage', () => {
    const store = createWorkflowArtifactStore(':memory:');
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

  test('initializes new tables alongside legacy workspace data', () => {
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
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const store = new WorkflowArtifactStore(database);

    expect(store.listRunArtifacts('legacy-run')).toEqual([]);
    expect(store.listEvents('legacy-run')).toEqual([]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM enterprise_lead_workspaces').get()).toEqual({
      count: 0,
    });
  });
});
