import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';

import { EnterpriseLeadRunStatus } from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadTaskAttempt,
  EnterpriseLeadWorkflowArtifact,
  EnterpriseLeadWorkflowEvent,
} from '../../shared/enterpriseLeadWorkspace/types';
import type { WorkflowEvent, WorkflowExecutionMode } from '../../shared/enterpriseLeadWorkspace/workflowContracts';
import { EnterpriseLeadWorkspaceStore } from './store';

export interface CreateWorkflowArtifactInput {
  runId: string;
  taskId: string;
  kind: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
  evidenceIds: string[];
}

export type AppendWorkflowEventInput = Omit<WorkflowEvent, 'sequence' | 'createdAt'> & {
  payload?: Record<string, unknown>;
};

export interface MarkWorkflowRunErrorOnceResult {
  transitioned: boolean;
  event?: EnterpriseLeadWorkflowEvent;
}

export interface CreateTaskAttemptInput {
  taskId: string;
  attempt?: number;
  executionMode: WorkflowExecutionMode;
  status?: string;
}

export interface FinishTaskAttemptInput {
  status: string;
  error?: string;
}

type ArtifactRow = Omit<EnterpriseLeadWorkflowArtifact, 'runId' | 'taskId' | 'schemaVersion' | 'payload' | 'evidenceIds' | 'createdAt'> & {
  run_id: string;
  task_id: string;
  schema_version: number;
  payload: string;
  evidence_ids: string;
  created_at: string;
};

type EventRow = {
  id: string;
  run_id: string;
  sequence: number;
  type: WorkflowEvent['type'];
  task_id: string | null;
  role: string | null;
  summary: string | null;
  payload: string;
  created_at: string;
};

type AttemptRow = {
  id: string;
  task_id: string;
  attempt: number;
  execution_mode: WorkflowExecutionMode;
  status: string;
  error: string;
  started_at: string;
  ended_at: string | null;
};

const parseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const mapArtifact = (row: ArtifactRow): EnterpriseLeadWorkflowArtifact => ({
  id: row.id,
  runId: row.run_id,
  taskId: row.task_id,
  kind: row.kind,
  schemaVersion: row.schema_version,
  payload: parseJson(row.payload, {}),
  evidenceIds: parseJson(row.evidence_ids, []),
  createdAt: row.created_at,
});

const mapEvent = (row: EventRow): EnterpriseLeadWorkflowEvent => ({
  id: row.id,
  runId: row.run_id,
  sequence: row.sequence,
  type: row.type,
  ...(row.task_id ? { taskId: row.task_id } : {}),
  ...(row.role ? { role: row.role } : {}),
  ...(row.summary ? { summary: row.summary } : {}),
  payload: parseJson(row.payload, {}),
  createdAt: row.created_at,
});

const mapAttempt = (row: AttemptRow): EnterpriseLeadTaskAttempt => ({
  id: row.id,
  taskId: row.task_id,
  attempt: row.attempt,
  executionMode: row.execution_mode,
  status: row.status,
  error: row.error,
  startedAt: row.started_at,
  endedAt: row.ended_at,
});

export class WorkflowArtifactStore {
  constructor(
    private readonly db: Database.Database,
    private readonly ownsDatabase = false,
  ) {
    new EnterpriseLeadWorkspaceStore(db);
  }

  close(): void {
    if (this.ownsDatabase && this.db.open) {
      this.db.close();
    }
  }

  createArtifact(input: CreateWorkflowArtifactInput): EnterpriseLeadWorkflowArtifact {
    const artifact: EnterpriseLeadWorkflowArtifact = {
      id: randomUUID(),
      runId: input.runId,
      taskId: input.taskId,
      kind: input.kind,
      schemaVersion: input.schemaVersion,
      payload: input.payload,
      evidenceIds: [...input.evidenceIds],
      createdAt: new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT INTO enterprise_lead_workflow_artifacts
        (id, run_id, task_id, kind, schema_version, payload, evidence_ids, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      artifact.id,
      artifact.runId,
      artifact.taskId,
      artifact.kind,
      artifact.schemaVersion,
      JSON.stringify(artifact.payload),
      JSON.stringify(artifact.evidenceIds),
      artifact.createdAt,
    );
    return artifact;
  }

  getArtifact(id: string): EnterpriseLeadWorkflowArtifact | null {
    const row = this.db.prepare(`
      SELECT id, run_id, task_id, kind, schema_version, payload, evidence_ids, created_at
      FROM enterprise_lead_workflow_artifacts WHERE id = ? LIMIT 1
    `).get(id) as ArtifactRow | undefined;
    return row ? mapArtifact(row) : null;
  }

  listRunArtifacts(runId: string): EnterpriseLeadWorkflowArtifact[] {
    const rows = this.db.prepare(`
      SELECT id, run_id, task_id, kind, schema_version, payload, evidence_ids, created_at
      FROM enterprise_lead_workflow_artifacts
      WHERE run_id = ? ORDER BY created_at ASC, rowid ASC
    `).all(runId) as ArtifactRow[];
    return rows.map(mapArtifact);
  }

  appendEvent(input: AppendWorkflowEventInput): EnterpriseLeadWorkflowEvent {
    return this.db.transaction(() => this.appendEventUnsafe(input))();
  }

  markRunErrorOnce(runId: string, message: string): MarkWorkflowRunErrorOnceResult {
    const markError = this.db.transaction(() => {
      const now = new Date().toISOString();
      const update = this.db.prepare(`
        UPDATE enterprise_lead_runs
        SET status = ?, controller_summary = ?, updated_at = ?
        WHERE id = ?
          AND archive_status <> 'archived'
          AND status NOT IN (?, ?, ?, ?)
          AND NOT EXISTS (
            SELECT 1
            FROM enterprise_lead_workflow_events
            WHERE run_id = ? AND type = 'run_error'
          )
      `).run(
        EnterpriseLeadRunStatus.Error,
        message,
        now,
        runId,
        EnterpriseLeadRunStatus.Completed,
        EnterpriseLeadRunStatus.Cancelled,
        EnterpriseLeadRunStatus.Error,
        EnterpriseLeadRunStatus.Archived,
        runId,
      );
      if (update.changes === 0) return { transitioned: false };

      return {
        transitioned: true,
        event: this.appendEventUnsafe({
          runId,
          type: 'run_error',
          summary: message,
        }),
      };
    });
    return markError();
  }

  listEvents(runId: string): EnterpriseLeadWorkflowEvent[] {
    const rows = this.db.prepare(`
      SELECT id, run_id, sequence, type, task_id, role, summary, payload, created_at
      FROM enterprise_lead_workflow_events
      WHERE run_id = ? ORDER BY sequence ASC
    `).all(runId) as EventRow[];
    return rows.map(mapEvent);
  }

  createAttempt(input: CreateTaskAttemptInput): EnterpriseLeadTaskAttempt {
    const attemptNumber = input.attempt ?? (this.db.prepare(`
      SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt
      FROM enterprise_lead_task_attempts WHERE task_id = ?
    `).get(input.taskId) as { attempt: number }).attempt;
    const attempt: EnterpriseLeadTaskAttempt = {
      id: randomUUID(),
      taskId: input.taskId,
      attempt: attemptNumber,
      executionMode: input.executionMode,
      status: input.status ?? 'running',
      error: '',
      startedAt: new Date().toISOString(),
      endedAt: null,
    };
    this.db.prepare(`
      INSERT INTO enterprise_lead_task_attempts
        (id, task_id, attempt, execution_mode, status, error, started_at, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      attempt.id,
      attempt.taskId,
      attempt.attempt,
      attempt.executionMode,
      attempt.status,
      attempt.error,
      attempt.startedAt,
      attempt.endedAt,
    );
    return attempt;
  }

  finishAttempt(id: string, input: FinishTaskAttemptInput): EnterpriseLeadTaskAttempt {
    const endedAt = new Date().toISOString();
    this.db.prepare(`
      UPDATE enterprise_lead_task_attempts
      SET status = ?, error = ?, ended_at = ? WHERE id = ?
    `).run(input.status, input.error ?? '', endedAt, id);
    const row = this.db.prepare(`
      SELECT id, task_id, attempt, execution_mode, status, error, started_at, ended_at
      FROM enterprise_lead_task_attempts WHERE id = ? LIMIT 1
    `).get(id) as AttemptRow | undefined;
    if (!row) {
      throw new Error('Enterprise lead task attempt not found');
    }
    return mapAttempt(row);
  }

  recoverRunningAttempt(
    taskId: string,
    attempt: number,
    error: string,
  ): EnterpriseLeadTaskAttempt | null {
    const row = this.db.prepare(`
      SELECT id
      FROM enterprise_lead_task_attempts
      WHERE task_id = ? AND attempt = ? AND status = 'running'
      ORDER BY rowid DESC
      LIMIT 1
    `).get(taskId, attempt) as { id: string } | undefined;
    return row ? this.finishAttempt(row.id, { status: 'error', error }) : null;
  }

  private appendEventUnsafe(input: AppendWorkflowEventInput): EnterpriseLeadWorkflowEvent {
    const nextSequence = this.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
      FROM enterprise_lead_workflow_events WHERE run_id = ?
    `).get(input.runId) as { sequence: number };
    const event: EnterpriseLeadWorkflowEvent = {
      ...input,
      id: randomUUID(),
      sequence: nextSequence.sequence,
      payload: input.payload ?? {},
      createdAt: new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT INTO enterprise_lead_workflow_events
        (id, run_id, sequence, type, task_id, role, summary, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.runId,
      event.sequence,
      event.type,
      event.taskId ?? null,
      event.role ?? null,
      event.summary ?? null,
      JSON.stringify(event.payload),
      event.createdAt,
    );
    return event;
  }
}

export const createWorkflowArtifactStore = (
  databaseOrPath: Database.Database | string,
): WorkflowArtifactStore => {
  const database = typeof databaseOrPath === 'string' ? new Database(databaseOrPath) : databaseOrPath;
  return new WorkflowArtifactStore(database, typeof databaseOrPath === 'string');
};
