import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';

import {
  KnowledgeBaseErrorCode,
  KnowledgeIngestionAttemptOutcome,
  KnowledgeIngestionJobStatus,
  KnowledgeIngestionStage,
} from '../../shared/knowledgeBase/constants';
import type {
  KnowledgeIngestionJob,
  KnowledgeIngestionJobAttempt,
} from '../../shared/knowledgeBase/types';

type KnowledgeIngestionJobRow = {
  id: string;
  workspace_id: string;
  document_id: string;
  document_version_id: string;
  stage: KnowledgeIngestionJob['stage'];
  status: KnowledgeIngestionJob['status'];
  progress: number;
  attempt_count: number;
  error_code: string | null;
  error_message: string | null;
  heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
};

type KnowledgeIngestionAttemptRow = {
  id: string;
  job_id: string;
  attempt_number: number;
  started_at: string;
  finished_at: string | null;
  outcome: KnowledgeIngestionJobAttempt['outcome'];
  error_code: string | null;
  error_message: string | null;
};

const mapJobRow = (row: KnowledgeIngestionJobRow): KnowledgeIngestionJob => ({
  id: row.id,
  workspaceId: row.workspace_id,
  documentId: row.document_id,
  documentVersionId: row.document_version_id,
  stage: row.stage,
  status: row.status,
  progress: row.progress,
  attemptCount: row.attempt_count,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  heartbeatAt: row.heartbeat_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapAttemptRow = (row: KnowledgeIngestionAttemptRow): KnowledgeIngestionJobAttempt => ({
  id: row.id,
  jobId: row.job_id,
  attemptNumber: row.attempt_number,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  outcome: row.outcome,
  errorCode: row.error_code,
  errorMessage: row.error_message,
});

const cleanRequiredText = (value: string, label: string): string => {
  const cleaned = value.trim();
  if (!cleaned) {
    throw new Error(`${label} is required`);
  }
  return cleaned;
};

export class KnowledgeIngestionJobStateError extends Error {
  readonly code = KnowledgeBaseErrorCode.JobStateConflict;

  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeIngestionJobStateError';
  }
}

export class KnowledgeIngestionJobStore {
  constructor(private readonly db: Database.Database) {
    this.initialize();
  }

  createJob(
    input: {
      workspaceId: string;
      documentId: string;
      documentVersionId: string;
    },
    now = new Date().toISOString(),
  ): KnowledgeIngestionJob {
    const jobId = randomUUID();
    this.db
      .prepare(
        `
        INSERT INTO knowledge_ingestion_jobs (
          id,
          workspace_id,
          document_id,
          document_version_id,
          stage,
          status,
          progress,
          attempt_count,
          error_code,
          error_message,
          heartbeat_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, NULL, ?, ?)
      `,
      )
      .run(
        jobId,
        cleanRequiredText(input.workspaceId, 'Workspace id'),
        cleanRequiredText(input.documentId, 'Document id'),
        cleanRequiredText(input.documentVersionId, 'Document version id'),
        KnowledgeIngestionStage.Queued,
        KnowledgeIngestionJobStatus.Queued,
        now,
        now,
      );
    return this.requireJob(jobId);
  }

  getJob(jobId: string): KnowledgeIngestionJob | null {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          workspace_id,
          document_id,
          document_version_id,
          stage,
          status,
          progress,
          attempt_count,
          error_code,
          error_message,
          heartbeat_at,
          created_at,
          updated_at
        FROM knowledge_ingestion_jobs
        WHERE id = ?
        LIMIT 1
      `,
      )
      .get(jobId) as KnowledgeIngestionJobRow | undefined;
    return row ? mapJobRow(row) : null;
  }

  getCurrentJob(documentId: string, documentVersionId: string): KnowledgeIngestionJob | null {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          workspace_id,
          document_id,
          document_version_id,
          stage,
          status,
          progress,
          attempt_count,
          error_code,
          error_message,
          heartbeat_at,
          created_at,
          updated_at
        FROM knowledge_ingestion_jobs
        WHERE document_id = ? AND document_version_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1
      `,
      )
      .get(documentId.trim(), documentVersionId.trim()) as KnowledgeIngestionJobRow | undefined;
    return row ? mapJobRow(row) : null;
  }

  listCurrentJobs(workspaceId: string): KnowledgeIngestionJob[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          job.id,
          job.workspace_id,
          job.document_id,
          job.document_version_id,
          job.stage,
          job.status,
          job.progress,
          job.attempt_count,
          job.error_code,
          job.error_message,
          job.heartbeat_at,
          job.created_at,
          job.updated_at
        FROM knowledge_ingestion_jobs AS job
        WHERE
          job.workspace_id = ?
          AND NOT EXISTS (
            SELECT 1
            FROM knowledge_ingestion_jobs AS newer
            WHERE
              newer.workspace_id = job.workspace_id
              AND newer.document_id = job.document_id
              AND newer.document_version_id = job.document_version_id
              AND (
                newer.created_at > job.created_at
                OR (newer.created_at = job.created_at AND newer.rowid > job.rowid)
              )
          )
        ORDER BY job.updated_at DESC, job.id ASC
      `,
      )
      .all(workspaceId.trim()) as KnowledgeIngestionJobRow[];
    return rows.map(mapJobRow);
  }

  claimNextJob(now = new Date().toISOString()): {
    job: KnowledgeIngestionJob;
    attempt: KnowledgeIngestionJobAttempt;
  } | null {
    const transaction = this.db.transaction(() => {
      const queuedRow = this.db
        .prepare(
          `
          SELECT id
          FROM knowledge_ingestion_jobs
          WHERE status = ?
          ORDER BY created_at ASC, id ASC
          LIMIT 1
        `,
        )
        .get(KnowledgeIngestionJobStatus.Queued) as { id: string } | undefined;
      if (!queuedRow) {
        return null;
      }

      const update = this.db
        .prepare(
          `
          UPDATE knowledge_ingestion_jobs
          SET
            status = ?,
            attempt_count = attempt_count + 1,
            error_code = NULL,
            error_message = NULL,
            heartbeat_at = ?,
            updated_at = ?
          WHERE id = ? AND status = ?
        `,
        )
        .run(
          KnowledgeIngestionJobStatus.Running,
          now,
          now,
          queuedRow.id,
          KnowledgeIngestionJobStatus.Queued,
        );
      if (update.changes === 0) {
        return null;
      }

      const job = this.requireJob(queuedRow.id);
      const attemptId = randomUUID();
      this.db
        .prepare(
          `
          INSERT INTO knowledge_ingestion_job_attempts (
            id,
            job_id,
            attempt_number,
            started_at,
            finished_at,
            outcome,
            error_code,
            error_message
          )
          VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL)
        `,
        )
        .run(
          attemptId,
          job.id,
          job.attemptCount,
          now,
          KnowledgeIngestionAttemptOutcome.Running,
        );

      return {
        job,
        attempt: this.requireAttempt(attemptId),
      };
    });

    return transaction();
  }

  heartbeat(
    jobId: string,
    attemptId: string,
    progress: number,
    now = new Date().toISOString(),
  ): KnowledgeIngestionJob {
    this.requireRunningAttempt(jobId, attemptId);
    const normalizedProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    this.db
      .prepare(
        `
        UPDATE knowledge_ingestion_jobs
        SET progress = ?, heartbeat_at = ?, updated_at = ?
        WHERE id = ? AND status = ?
      `,
      )
      .run(normalizedProgress, now, now, jobId, KnowledgeIngestionJobStatus.Running);
    return this.requireJob(jobId);
  }

  updateStage(
    jobId: string,
    attemptId: string,
    stage: KnowledgeIngestionJob['stage'],
    now = new Date().toISOString(),
  ): KnowledgeIngestionJob {
    this.requireRunningAttempt(jobId, attemptId);
    this.db
      .prepare(
        `
        UPDATE knowledge_ingestion_jobs
        SET stage = ?, progress = 0, heartbeat_at = ?, updated_at = ?
        WHERE id = ? AND status = ?
      `,
      )
      .run(stage, now, now, jobId, KnowledgeIngestionJobStatus.Running);
    return this.requireJob(jobId);
  }

  complete(
    jobId: string,
    attemptId: string,
    now = new Date().toISOString(),
  ): KnowledgeIngestionJob {
    const transaction = this.db.transaction(() =>
      this.completeInCurrentTransaction(jobId, attemptId, now));
    return transaction();
  }

  completeInCurrentTransaction(
    jobId: string,
    attemptId: string,
    now = new Date().toISOString(),
  ): KnowledgeIngestionJob {
    this.assertCurrentTransaction();
    return this.finishRunningJobInCurrentTransaction({
      jobId,
      attemptId,
      jobStatus: KnowledgeIngestionJobStatus.Completed,
      attemptOutcome: KnowledgeIngestionAttemptOutcome.Completed,
      progress: 1,
      errorCode: null,
      errorMessage: null,
      now,
    });
  }

  fail(
    jobId: string,
    attemptId: string,
    error: { code: string; message: string },
    now = new Date().toISOString(),
  ): KnowledgeIngestionJob {
    const transaction = this.db.transaction(() =>
      this.failInCurrentTransaction(jobId, attemptId, error, now));
    return transaction();
  }

  failInCurrentTransaction(
    jobId: string,
    attemptId: string,
    error: { code: string; message: string },
    now = new Date().toISOString(),
  ): KnowledgeIngestionJob {
    this.assertCurrentTransaction();
    return this.finishRunningJobInCurrentTransaction({
      jobId,
      attemptId,
      jobStatus: KnowledgeIngestionJobStatus.Failed,
      attemptOutcome: KnowledgeIngestionAttemptOutcome.Failed,
      progress: this.requireJob(jobId).progress,
      errorCode: cleanRequiredText(error.code, 'Error code'),
      errorMessage: cleanRequiredText(error.message, 'Error message'),
      now,
    });
  }

  cancel(jobId: string, now = new Date().toISOString()): KnowledgeIngestionJob {
    const transaction = this.db.transaction(() =>
      this.cancelInCurrentTransaction(jobId, now));
    return transaction();
  }

  cancelInCurrentTransaction(
    jobId: string,
    now = new Date().toISOString(),
  ): KnowledgeIngestionJob {
    this.assertCurrentTransaction();
      const job = this.requireJob(jobId);
      if (
        job.status !== KnowledgeIngestionJobStatus.Queued &&
        job.status !== KnowledgeIngestionJobStatus.Running
      ) {
        throw new KnowledgeIngestionJobStateError(`Cannot cancel job in ${job.status} state`);
      }
      if (job.status === KnowledgeIngestionJobStatus.Running) {
        this.db
          .prepare(
            `
            UPDATE knowledge_ingestion_job_attempts
            SET outcome = ?, finished_at = ?
            WHERE job_id = ? AND outcome = ?
          `,
          )
          .run(
            KnowledgeIngestionAttemptOutcome.Cancelled,
            now,
            jobId,
            KnowledgeIngestionAttemptOutcome.Running,
          );
      }
      this.db
        .prepare(
          `
          UPDATE knowledge_ingestion_jobs
          SET status = ?, heartbeat_at = NULL, updated_at = ?
          WHERE id = ?
        `,
        )
        .run(KnowledgeIngestionJobStatus.Cancelled, now, jobId);
    return this.requireJob(jobId);
  }

  retry(jobId: string, now = new Date().toISOString()): KnowledgeIngestionJob {
    const job = this.requireJob(jobId);
    if (
      job.status !== KnowledgeIngestionJobStatus.Failed &&
      job.status !== KnowledgeIngestionJobStatus.Cancelled
    ) {
      throw new KnowledgeIngestionJobStateError(`Cannot retry job in ${job.status} state`);
    }
    this.db
      .prepare(
        `
        UPDATE knowledge_ingestion_jobs
        SET
          stage = ?,
          status = ?,
          progress = 0,
          error_code = NULL,
          error_message = NULL,
          heartbeat_at = NULL,
          updated_at = ?
        WHERE id = ?
      `,
      )
      .run(
        KnowledgeIngestionStage.Queued,
        KnowledgeIngestionJobStatus.Queued,
        now,
        jobId,
      );
    return this.requireJob(jobId);
  }

  cancelQueuedJobsForDocument(
    documentId: string,
    now = new Date().toISOString(),
  ): number {
    return this.db
      .prepare(
        `
        UPDATE knowledge_ingestion_jobs
        SET status = ?, heartbeat_at = NULL, updated_at = ?
        WHERE document_id = ? AND status = ?
      `,
      )
      .run(
        KnowledgeIngestionJobStatus.Cancelled,
        now,
        cleanRequiredText(documentId, 'Document id'),
        KnowledgeIngestionJobStatus.Queued,
      ).changes;
  }

  cancelJobsForVersionInCurrentTransaction(
    documentId: string,
    documentVersionId: string,
    now = new Date().toISOString(),
  ): number {
    this.assertCurrentTransaction();
    const normalizedDocumentId = cleanRequiredText(documentId, 'Document id');
    const normalizedVersionId = cleanRequiredText(documentVersionId, 'Document version id');
    this.db.prepare(`
      UPDATE knowledge_ingestion_job_attempts
      SET outcome = ?, finished_at = ?
      WHERE outcome = ? AND job_id IN (
        SELECT id FROM knowledge_ingestion_jobs
        WHERE document_id = ? AND document_version_id = ?
      )
    `).run(
      KnowledgeIngestionAttemptOutcome.Cancelled,
      now,
      KnowledgeIngestionAttemptOutcome.Running,
      normalizedDocumentId,
      normalizedVersionId,
    );
    return this.db.prepare(`
      UPDATE knowledge_ingestion_jobs
      SET status = ?, heartbeat_at = NULL, updated_at = ?
      WHERE document_id = ? AND document_version_id = ? AND status IN (?, ?)
    `).run(
      KnowledgeIngestionJobStatus.Cancelled,
      now,
      normalizedDocumentId,
      normalizedVersionId,
      KnowledgeIngestionJobStatus.Queued,
      KnowledgeIngestionJobStatus.Running,
    ).changes;
  }

  recoverAbandonedJobs(staleBefore: string, now = new Date().toISOString()): number {
    const transaction = this.db.transaction(() => {
      const staleJobs = this.db
        .prepare(
          `
          SELECT id
          FROM knowledge_ingestion_jobs
          WHERE
            status = ?
            AND (heartbeat_at IS NULL OR heartbeat_at < ?)
        `,
        )
        .all(KnowledgeIngestionJobStatus.Running, staleBefore) as Array<{ id: string }>;

      const abandonAttempt = this.db.prepare(`
        UPDATE knowledge_ingestion_job_attempts
        SET outcome = ?, finished_at = ?
        WHERE job_id = ? AND outcome = ?
      `);
      const requeueJob = this.db.prepare(`
        UPDATE knowledge_ingestion_jobs
        SET
          stage = ?,
          status = ?,
          progress = 0,
          heartbeat_at = NULL,
          updated_at = ?
        WHERE id = ? AND status = ?
      `);

      staleJobs.forEach(job => {
        abandonAttempt.run(
          KnowledgeIngestionAttemptOutcome.Abandoned,
          now,
          job.id,
          KnowledgeIngestionAttemptOutcome.Running,
        );
        requeueJob.run(
          KnowledgeIngestionStage.Queued,
          KnowledgeIngestionJobStatus.Queued,
          now,
          job.id,
          KnowledgeIngestionJobStatus.Running,
        );
      });
      return staleJobs.length;
    });
    return transaction();
  }

  listAttempts(jobId: string): KnowledgeIngestionJobAttempt[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          id,
          job_id,
          attempt_number,
          started_at,
          finished_at,
          outcome,
          error_code,
          error_message
        FROM knowledge_ingestion_job_attempts
        WHERE job_id = ?
        ORDER BY attempt_number ASC
      `,
      )
      .all(jobId) as KnowledgeIngestionAttemptRow[];
    return rows.map(mapAttemptRow);
  }

  deleteWorkspaceJobs(workspaceId: string): number {
    const normalizedWorkspaceId = cleanRequiredText(workspaceId, 'Workspace id');
    const transaction = this.db.transaction(() =>
      this.deleteWorkspaceJobsInCurrentTransaction(normalizedWorkspaceId));
    return transaction();
  }

  deleteWorkspaceJobsInCurrentTransaction(workspaceId: string): number {
    this.assertCurrentTransaction();
    const normalizedWorkspaceId = cleanRequiredText(workspaceId, 'Workspace id');
      this.db
        .prepare(
          `
          DELETE FROM knowledge_ingestion_job_attempts
          WHERE job_id IN (
            SELECT id FROM knowledge_ingestion_jobs WHERE workspace_id = ?
          )
        `,
        )
        .run(normalizedWorkspaceId);
    return this.db
        .prepare('DELETE FROM knowledge_ingestion_jobs WHERE workspace_id = ?')
        .run(normalizedWorkspaceId).changes;
  }

  deleteParentlessIngestionInCurrentTransaction(): number {
    this.assertCurrentTransaction();
    let deletedCount = this.db.prepare(`
      DELETE FROM knowledge_ingestion_job_attempts
      WHERE NOT EXISTS (
        SELECT 1
        FROM knowledge_ingestion_jobs AS job
        JOIN knowledge_documents AS document
          ON document.id = job.document_id
        JOIN knowledge_document_versions AS version
          ON version.id = job.document_version_id AND version.document_id = document.id
        WHERE job.id = knowledge_ingestion_job_attempts.job_id
      )
    `).run().changes;
    deletedCount += this.db.prepare(`
      DELETE FROM knowledge_ingestion_jobs
      WHERE NOT EXISTS (
        SELECT 1
        FROM knowledge_documents AS document
        JOIN knowledge_document_versions AS version
          ON version.document_id = document.id
        WHERE document.id = knowledge_ingestion_jobs.document_id
          AND version.id = knowledge_ingestion_jobs.document_version_id
      )
    `).run().changes;
    return deletedCount;
  }

  private assertCurrentTransaction(): void {
    if (!this.db.inTransaction) {
      throw new KnowledgeIngestionJobStateError('Knowledge ingestion transaction required');
    }
  }

  private finishRunningJobInCurrentTransaction(input: {
    jobId: string;
    attemptId: string;
    jobStatus: KnowledgeIngestionJob['status'];
    attemptOutcome: KnowledgeIngestionJobAttempt['outcome'];
    progress: number;
    errorCode: string | null;
    errorMessage: string | null;
    now: string;
  }): KnowledgeIngestionJob {
      this.assertCurrentTransaction();
      this.requireRunningAttempt(input.jobId, input.attemptId);
      this.db
        .prepare(
          `
          UPDATE knowledge_ingestion_job_attempts
          SET outcome = ?, finished_at = ?, error_code = ?, error_message = ?
          WHERE id = ? AND job_id = ? AND outcome = ?
        `,
        )
        .run(
          input.attemptOutcome,
          input.now,
          input.errorCode,
          input.errorMessage,
          input.attemptId,
          input.jobId,
          KnowledgeIngestionAttemptOutcome.Running,
        );
      this.db
        .prepare(
          `
          UPDATE knowledge_ingestion_jobs
          SET
            status = ?,
            progress = ?,
            error_code = ?,
            error_message = ?,
            heartbeat_at = NULL,
            updated_at = ?
          WHERE id = ? AND status = ?
        `,
        )
        .run(
          input.jobStatus,
          input.progress,
          input.errorCode,
          input.errorMessage,
          input.now,
          input.jobId,
          KnowledgeIngestionJobStatus.Running,
        );
    return this.requireJob(input.jobId);
  }

  private requireRunningAttempt(jobId: string, attemptId: string): void {
    const job = this.requireJob(jobId);
    const attempt = this.requireAttempt(attemptId);
    if (
      job.status !== KnowledgeIngestionJobStatus.Running ||
      attempt.jobId !== jobId ||
      attempt.outcome !== KnowledgeIngestionAttemptOutcome.Running
    ) {
      throw new KnowledgeIngestionJobStateError('Knowledge ingestion attempt is not active');
    }
  }

  private requireJob(jobId: string): KnowledgeIngestionJob {
    const job = this.getJob(jobId);
    if (!job) {
      throw new Error('Knowledge ingestion job not found');
    }
    return job;
  }

  private requireAttempt(attemptId: string): KnowledgeIngestionJobAttempt {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          job_id,
          attempt_number,
          started_at,
          finished_at,
          outcome,
          error_code,
          error_message
        FROM knowledge_ingestion_job_attempts
        WHERE id = ?
        LIMIT 1
      `,
      )
      .get(attemptId) as KnowledgeIngestionAttemptRow | undefined;
    if (!row) {
      throw new Error('Knowledge ingestion attempt not found');
    }
    return mapAttemptRow(row);
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_ingestion_jobs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        document_version_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        heartbeat_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_ingestion_job_attempts (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        attempt_number INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        outcome TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT,
        FOREIGN KEY (job_id) REFERENCES knowledge_ingestion_jobs(id) ON DELETE CASCADE,
        UNIQUE (job_id, attempt_number)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_ingestion_jobs_active_version
      ON knowledge_ingestion_jobs(document_version_id)
      WHERE status IN ('${KnowledgeIngestionJobStatus.Queued}', '${KnowledgeIngestionJobStatus.Running}');

      CREATE INDEX IF NOT EXISTS idx_knowledge_ingestion_jobs_queue
      ON knowledge_ingestion_jobs(status, created_at);

      CREATE INDEX IF NOT EXISTS idx_knowledge_ingestion_attempts_job
      ON knowledge_ingestion_job_attempts(job_id, attempt_number);
    `);
  }
}
