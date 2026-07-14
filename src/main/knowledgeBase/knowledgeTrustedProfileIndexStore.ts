import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';

import { buildEnterpriseLeadWorkspaceKnowledgeScopeId } from '../../shared/enterpriseLeadWorkspace/constants';
import {
  KnowledgeTrustedIndexRefreshAttemptOutcome,
  type KnowledgeTrustedIndexRefreshAttemptOutcome as KnowledgeTrustedIndexRefreshAttemptOutcomeValue,
  KnowledgeTrustedIndexRefreshStatus,
  type KnowledgeTrustedIndexRefreshStatus as KnowledgeTrustedIndexRefreshStatusValue,
  KnowledgeTrustedProfileIndexErrorCode,
  type KnowledgeTrustedProfileIndexErrorCode as KnowledgeTrustedProfileIndexErrorCodeValue,
} from '../../shared/knowledgeBase/constants';
import {
  isTransientSqliteBusyError,
  runTransientSqliteWriteTransaction,
} from '../libs/sqliteTransactionRetry';

const MAX_SAFE_SQLITE_INTEGER = Number.MAX_SAFE_INTEGER;
const TRUSTED_PROFILE_INDEX_PERSISTENCE_STATE_CONFLICT =
  'Trusted profile index persistence state conflict';
const TRUSTED_PROFILE_INDEX_CORRUPTION_MESSAGE = 'Trusted profile index data is corrupt';

const sqlStringList = (values: readonly string[]): string =>
  values.map(value => `'${value.replaceAll("'", "''")}'`).join(', ');

const trustedRefreshStatuses = Object.values(KnowledgeTrustedIndexRefreshStatus);
const trustedRefreshStatusSet = new Set<string>(trustedRefreshStatuses);
const trustedRefreshAttemptOutcomes = Object.values(KnowledgeTrustedIndexRefreshAttemptOutcome);
const trustedRefreshAttemptOutcomeSet = new Set<string>(trustedRefreshAttemptOutcomes);
const trustedRefreshErrorCodes = Object.values(KnowledgeTrustedProfileIndexErrorCode);
const trustedRefreshErrorCodeSet = new Set<string>(trustedRefreshErrorCodes);

export interface KnowledgeTrustedProfileIndexJob {
  id: string;
  workspaceId: string;
  scopeId: string;
  profileRevision: number;
  status: KnowledgeTrustedIndexRefreshStatusValue;
  attemptCount: number;
  activeAttemptId: string | null;
  errorCode: KnowledgeTrustedProfileIndexErrorCodeValue | null;
  requestedAt: string;
  updatedAt: string;
}

export interface KnowledgeTrustedProfileIndexAttempt {
  id: string;
  jobId: string;
  attemptNumber: number;
  startedAt: string;
  finishedAt: string | null;
  outcome: KnowledgeTrustedIndexRefreshAttemptOutcomeValue;
  errorCode: KnowledgeTrustedProfileIndexErrorCodeValue | null;
}

export interface KnowledgeTrustedProfileIndexState {
  workspaceId: string;
  scopeId: string;
  indexedProfileRevision: number;
  indexedAt: string;
}

export interface EnqueueTrustedProfileRefreshInput {
  workspaceId: string;
  profileRevision: number;
  now?: string;
}

export interface KnowledgeTrustedProfileIndexEnqueueResult {
  job: KnowledgeTrustedProfileIndexJob;
  inserted: boolean;
}

export interface KnowledgeTrustedProfileIndexClaim {
  job: KnowledgeTrustedProfileIndexJob;
  attempt: KnowledgeTrustedProfileIndexAttempt;
}

export interface KnowledgeTrustedProfileIndexStoreOptions {
  beforeClaimTransactionAttempt?: () => void;
}

interface KnowledgeTrustedProfileIndexJobRow {
  id: unknown;
  workspaceId: unknown;
  scopeId: unknown;
  profileRevision: unknown;
  status: unknown;
  attemptCount: unknown;
  activeAttemptId: unknown;
  errorCode: unknown;
  requestedAt: unknown;
  updatedAt: unknown;
}

interface KnowledgeTrustedProfileIndexAttemptRow {
  id: unknown;
  jobId: unknown;
  attemptNumber: unknown;
  startedAt: unknown;
  finishedAt: unknown;
  outcome: unknown;
  errorCode: unknown;
}

interface KnowledgeTrustedProfileIndexStateRow {
  workspaceId: unknown;
  scopeId: unknown;
  indexedProfileRevision: unknown;
  indexedAt: unknown;
}

interface KnowledgeTrustedProfileIndexJobAggregate {
  job: KnowledgeTrustedProfileIndexJob;
  attempts: KnowledgeTrustedProfileIndexAttempt[];
}

interface WorkspaceProfileRevisionRow {
  id: unknown;
  profileRevision: unknown;
}

export class KnowledgeTrustedProfileIndexCorruptionError extends Error {
  constructor() {
    super(TRUSTED_PROFILE_INDEX_CORRUPTION_MESSAGE);
    this.name = 'KnowledgeTrustedProfileIndexCorruptionError';
  }
}

export class KnowledgeTrustedProfileIndexRetryRequiredError extends Error {
  constructor() {
    super('Trusted profile index operation should be retried');
    this.name = 'KnowledgeTrustedProfileIndexRetryRequiredError';
    delete this.stack;
  }
}

const throwCorruption = (): never => {
  throw new KnowledgeTrustedProfileIndexCorruptionError();
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isSafeIntegerAtLeast = (value: unknown, minimum: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;

const isTimestamp = (value: unknown): value is string =>
  isNonEmptyString(value) && Number.isFinite(Date.parse(value));

const isSqliteConstraintError = (error: unknown): boolean => {
  try {
    return typeof error === 'object'
      && error !== null
      && 'code' in error
      && typeof error.code === 'string'
      && error.code.startsWith('SQLITE_CONSTRAINT');
  } catch {
    return false;
  }
};

const requireWorkspaceId = (value: unknown): string => {
  if (!isNonEmptyString(value)) {
    throw new Error(TRUSTED_PROFILE_INDEX_PERSISTENCE_STATE_CONFLICT);
  }
  return value;
};

const requireProfileRevision = (value: unknown): number => {
  if (!isSafeIntegerAtLeast(value, 1)) {
    throw new Error(TRUSTED_PROFILE_INDEX_PERSISTENCE_STATE_CONFLICT);
  }
  return value;
};

const requireTimestamp = (value: unknown): string => {
  if (!isTimestamp(value)) {
    throw new Error(TRUSTED_PROFILE_INDEX_PERSISTENCE_STATE_CONFLICT);
  }
  return value;
};

const readNullableNonEmptyString = (value: unknown): string | null => {
  if (value === null) {
    return null;
  }
  return isNonEmptyString(value) ? value : throwCorruption();
};

const readNullableErrorCode = (value: unknown): KnowledgeTrustedProfileIndexErrorCodeValue | null => {
  if (value === null) {
    return null;
  }
  return typeof value === 'string' && trustedRefreshErrorCodeSet.has(value)
    ? value as KnowledgeTrustedProfileIndexErrorCodeValue
    : throwCorruption();
};

export class KnowledgeTrustedProfileIndexStore {
  constructor(
    private readonly db: Database.Database,
    private readonly options: KnowledgeTrustedProfileIndexStoreOptions = {},
  ) {
    this.initialize();
  }

  private initialize(): void {
    if (this.db.inTransaction) {
      throw new Error(TRUSTED_PROFILE_INDEX_PERSISTENCE_STATE_CONFLICT);
    }
    const initializeTransaction = this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_trusted_profile_index_jobs (
          id TEXT PRIMARY KEY CHECK (TRIM(id) <> ''),
          workspace_id TEXT NOT NULL CHECK (TRIM(workspace_id) <> ''),
          scope_id TEXT NOT NULL CHECK (TRIM(scope_id) <> ''),
          profile_revision INTEGER NOT NULL CHECK (
            TYPEOF(profile_revision) = 'integer'
            AND profile_revision BETWEEN 1 AND ${MAX_SAFE_SQLITE_INTEGER}
          ),
          status TEXT NOT NULL CHECK (status IN (${sqlStringList(trustedRefreshStatuses)})),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (
            TYPEOF(attempt_count) = 'integer'
            AND attempt_count BETWEEN 0 AND ${MAX_SAFE_SQLITE_INTEGER}
          ),
          active_attempt_id TEXT CHECK (
            active_attempt_id IS NULL OR TRIM(active_attempt_id) <> ''
          ),
          error_code TEXT,
          requested_at TEXT NOT NULL CHECK (TRIM(requested_at) <> ''),
          updated_at TEXT NOT NULL CHECK (TRIM(updated_at) <> ''),
          CHECK (
            (status = '${KnowledgeTrustedIndexRefreshStatus.Queued}'
              AND active_attempt_id IS NULL AND error_code IS NULL)
            OR (status = '${KnowledgeTrustedIndexRefreshStatus.Running}'
              AND active_attempt_id IS NOT NULL AND error_code IS NULL)
            OR (status = '${KnowledgeTrustedIndexRefreshStatus.Completed}'
              AND active_attempt_id IS NULL AND error_code IS NULL)
            OR (status = '${KnowledgeTrustedIndexRefreshStatus.Failed}'
              AND active_attempt_id IS NULL
              AND error_code IS NOT NULL
              AND error_code IN (${sqlStringList(trustedRefreshErrorCodes)}))
          )
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_profile_index_job_revision
        ON knowledge_trusted_profile_index_jobs(workspace_id, profile_revision);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_profile_index_active_attempt
        ON knowledge_trusted_profile_index_jobs(active_attempt_id)
        WHERE active_attempt_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_profile_index_one_running_job
        ON knowledge_trusted_profile_index_jobs(status)
        WHERE status = '${KnowledgeTrustedIndexRefreshStatus.Running}';
        CREATE INDEX IF NOT EXISTS idx_trusted_profile_index_queue
        ON knowledge_trusted_profile_index_jobs(updated_at, profile_revision, id)
        WHERE status = '${KnowledgeTrustedIndexRefreshStatus.Queued}';
        CREATE INDEX IF NOT EXISTS idx_trusted_profile_index_workspace
        ON knowledge_trusted_profile_index_jobs(workspace_id, profile_revision DESC);

        CREATE TABLE IF NOT EXISTS knowledge_trusted_profile_index_attempts (
          id TEXT PRIMARY KEY CHECK (TRIM(id) <> ''),
          job_id TEXT NOT NULL CHECK (TRIM(job_id) <> ''),
          attempt_number INTEGER NOT NULL CHECK (
            TYPEOF(attempt_number) = 'integer'
            AND attempt_number BETWEEN 1 AND ${MAX_SAFE_SQLITE_INTEGER}
          ),
          started_at TEXT NOT NULL CHECK (TRIM(started_at) <> ''),
          finished_at TEXT CHECK (finished_at IS NULL OR TRIM(finished_at) <> ''),
          outcome TEXT NOT NULL CHECK (
            outcome IN (${sqlStringList(trustedRefreshAttemptOutcomes)})
          ),
          error_code TEXT,
          UNIQUE (job_id, attempt_number),
          FOREIGN KEY (job_id) REFERENCES knowledge_trusted_profile_index_jobs(id),
          CHECK (
            (outcome = '${KnowledgeTrustedIndexRefreshAttemptOutcome.Running}'
              AND finished_at IS NULL AND error_code IS NULL)
            OR (outcome = '${KnowledgeTrustedIndexRefreshAttemptOutcome.Completed}'
              AND finished_at IS NOT NULL AND error_code IS NULL)
            OR (outcome = '${KnowledgeTrustedIndexRefreshAttemptOutcome.Failed}'
              AND finished_at IS NOT NULL
              AND error_code = '${KnowledgeTrustedProfileIndexErrorCode.RefreshFailed}')
            OR (outcome = '${KnowledgeTrustedIndexRefreshAttemptOutcome.Abandoned}'
              AND finished_at IS NOT NULL
              AND error_code = '${KnowledgeTrustedProfileIndexErrorCode.RefreshAbandoned}')
          )
        );
        CREATE INDEX IF NOT EXISTS idx_trusted_profile_index_attempts_job
        ON knowledge_trusted_profile_index_attempts(job_id, attempt_number);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_profile_index_one_running_attempt
        ON knowledge_trusted_profile_index_attempts(job_id)
        WHERE outcome = '${KnowledgeTrustedIndexRefreshAttemptOutcome.Running}';

        CREATE TABLE IF NOT EXISTS knowledge_trusted_profile_index_state (
          workspace_id TEXT PRIMARY KEY CHECK (TRIM(workspace_id) <> ''),
          scope_id TEXT NOT NULL UNIQUE CHECK (TRIM(scope_id) <> ''),
          indexed_profile_revision INTEGER NOT NULL CHECK (
            TYPEOF(indexed_profile_revision) = 'integer'
            AND indexed_profile_revision BETWEEN 1 AND ${MAX_SAFE_SQLITE_INTEGER}
          ),
          indexed_at TEXT NOT NULL CHECK (TRIM(indexed_at) <> '')
        ) WITHOUT ROWID;
      `);
    });
    this.runOwnedWrite(() => initializeTransaction.immediate());
  }

  enqueue(input: EnqueueTrustedProfileRefreshInput): KnowledgeTrustedProfileIndexEnqueueResult {
    if (this.db.inTransaction) {
      throw new Error(TRUSTED_PROFILE_INDEX_PERSISTENCE_STATE_CONFLICT);
    }
    const transaction = this.db.transaction(() => this.enqueueInCurrentTransaction(input));
    return this.runOwnedWrite(() => transaction.immediate());
  }

  enqueueInCurrentTransaction(
    input: EnqueueTrustedProfileRefreshInput,
  ): KnowledgeTrustedProfileIndexEnqueueResult {
    if (!this.db.inTransaction) {
      throw new Error(TRUSTED_PROFILE_INDEX_PERSISTENCE_STATE_CONFLICT);
    }
    const workspaceId = requireWorkspaceId(input.workspaceId);
    const profileRevision = requireProfileRevision(input.profileRevision);
    const now = requireTimestamp(input.now ?? new Date().toISOString());
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId);
    const id = randomUUID();
    const insertResult = this.db.prepare(`
      INSERT INTO knowledge_trusted_profile_index_jobs (
        id, workspace_id, scope_id, profile_revision, status, attempt_count,
        active_attempt_id, error_code, requested_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
      ON CONFLICT(workspace_id, profile_revision) DO NOTHING
    `).run(
      id,
      workspaceId,
      scopeId,
      profileRevision,
      KnowledgeTrustedIndexRefreshStatus.Queued,
      now,
      now,
    );
    const job = this.getJob(workspaceId, profileRevision);
    if (!job || job.scopeId !== scopeId) {
      throw new Error(TRUSTED_PROFILE_INDEX_PERSISTENCE_STATE_CONFLICT);
    }
    return {
      job,
      inserted: insertResult.changes === 1,
    };
  }

  claimNext(now?: string): KnowledgeTrustedProfileIndexClaim | null {
    this.assertOwnsOuterTransaction();
    const claimedAt = requireTimestamp(now ?? new Date().toISOString());
    const transaction = this.db.transaction((): KnowledgeTrustedProfileIndexClaim | null => {
      const runningRows = this.readJobRows(`
        WHERE status = '${KnowledgeTrustedIndexRefreshStatus.Running}'
        ORDER BY updated_at ASC, profile_revision ASC, id ASC
        LIMIT 2
      `);
      if (runningRows.length > 1) return throwCorruption();
      if (runningRows.length === 1) {
        this.mapJobAggregate(runningRows[0]);
        return null;
      }
      const queuedRow = this.readJobRows(`
        WHERE status = '${KnowledgeTrustedIndexRefreshStatus.Queued}'
        ORDER BY updated_at ASC, profile_revision ASC, id ASC
        LIMIT 1
      `)[0];
      if (!queuedRow) return null;
      const queued = this.mapJobAggregate(queuedRow).job;
      if (queued.attemptCount >= MAX_SAFE_SQLITE_INTEGER) return throwCorruption();
      const attemptId = randomUUID();
      const nextAttemptNumber = queued.attemptCount + 1;
      const updateResult = this.db.prepare(`
        UPDATE knowledge_trusted_profile_index_jobs
        SET
          status = ?,
          attempt_count = ?,
          active_attempt_id = ?,
          error_code = NULL,
          updated_at = ?
        WHERE id = ?
          AND status = ?
          AND attempt_count = ?
          AND active_attempt_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM knowledge_trusted_profile_index_jobs
            WHERE status = ?
          )
      `).run(
        KnowledgeTrustedIndexRefreshStatus.Running,
        nextAttemptNumber,
        attemptId,
        claimedAt,
        queued.id,
        KnowledgeTrustedIndexRefreshStatus.Queued,
        queued.attemptCount,
        KnowledgeTrustedIndexRefreshStatus.Running,
      );
      if (updateResult.changes !== 1) return null;
      this.db.prepare(`
        INSERT INTO knowledge_trusted_profile_index_attempts (
          id, job_id, attempt_number, started_at, finished_at, outcome, error_code
        ) VALUES (?, ?, ?, ?, NULL, ?, NULL)
      `).run(
        attemptId,
        queued.id,
        nextAttemptNumber,
        claimedAt,
        KnowledgeTrustedIndexRefreshAttemptOutcome.Running,
      );
      const aggregate = this.getJobAggregateById(queued.id);
      if (!aggregate) return throwCorruption();
      const attempt = aggregate.attempts.at(-1);
      if (!attempt || attempt.id !== attemptId) return throwCorruption();
      return { job: aggregate.job, attempt };
    });
    return this.runOwnedWrite(() => {
      this.options.beforeClaimTransactionAttempt?.();
      return transaction.immediate();
    });
  }

  completeAttempt(jobId: string, attemptId: string, now?: string): boolean {
    this.assertOwnsOuterTransaction();
    if (!isNonEmptyString(jobId) || !isNonEmptyString(attemptId)) {
      throw new Error(TRUSTED_PROFILE_INDEX_PERSISTENCE_STATE_CONFLICT);
    }
    const completedAt = requireTimestamp(now ?? new Date().toISOString());
    const transaction = this.db.transaction((): boolean => {
      const aggregate = this.getJobAggregateById(jobId);
      if (!aggregate) return false;
      const { job, attempts } = aggregate;
      if (
        job.status !== KnowledgeTrustedIndexRefreshStatus.Running
        || job.activeAttemptId !== attemptId
      ) {
        return false;
      }
      const activeAttempt = attempts.at(-1);
      if (
        !activeAttempt
        || activeAttempt.id !== attemptId
        || activeAttempt.outcome !== KnowledgeTrustedIndexRefreshAttemptOutcome.Running
      ) {
        return false;
      }
      const workspace = this.readWorkspaceRevision(job.workspaceId);
      const expectedScopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(job.workspaceId);
      if (
        !workspace
        || workspace.id !== job.workspaceId
        || job.scopeId !== expectedScopeId
        || job.profileRevision > workspace.profileRevision
      ) {
        return throwCorruption();
      }
      const state = this.getState(job.workspaceId);
      if (
        state
        && (state.scopeId !== expectedScopeId
          || state.indexedProfileRevision > workspace.profileRevision)
      ) {
        return throwCorruption();
      }
      const attemptUpdate = this.db.prepare(`
        UPDATE knowledge_trusted_profile_index_attempts
        SET finished_at = ?, outcome = ?, error_code = NULL
        WHERE id = ? AND job_id = ? AND outcome = ?
      `).run(
        completedAt,
        KnowledgeTrustedIndexRefreshAttemptOutcome.Completed,
        attemptId,
        jobId,
        KnowledgeTrustedIndexRefreshAttemptOutcome.Running,
      );
      if (attemptUpdate.changes !== 1) return false;

      if (!state) {
        this.db.prepare(`
          INSERT INTO knowledge_trusted_profile_index_state (
            workspace_id, scope_id, indexed_profile_revision, indexed_at
          ) VALUES (?, ?, ?, ?)
        `).run(job.workspaceId, expectedScopeId, job.profileRevision, completedAt);
      } else if (state.indexedProfileRevision < job.profileRevision) {
        const stateUpdate = this.db.prepare(`
          UPDATE knowledge_trusted_profile_index_state
          SET indexed_profile_revision = ?, indexed_at = ?
          WHERE workspace_id = ?
            AND scope_id = ?
            AND indexed_profile_revision = ?
        `).run(
          job.profileRevision,
          completedAt,
          job.workspaceId,
          expectedScopeId,
          state.indexedProfileRevision,
        );
        if (stateUpdate.changes !== 1) return throwCorruption();
      }

      const jobUpdate = this.db.prepare(`
        UPDATE knowledge_trusted_profile_index_jobs
        SET status = ?, active_attempt_id = NULL, error_code = NULL, updated_at = ?
        WHERE id = ? AND status = ? AND active_attempt_id = ?
      `).run(
        KnowledgeTrustedIndexRefreshStatus.Completed,
        completedAt,
        jobId,
        KnowledgeTrustedIndexRefreshStatus.Running,
        attemptId,
      );
      if (jobUpdate.changes !== 1) return throwCorruption();
      return true;
    });
    return this.runOwnedWrite(() => transaction.immediate());
  }

  failAttempt(jobId: string, attemptId: string, now?: string): boolean {
    this.assertOwnsOuterTransaction();
    if (!isNonEmptyString(jobId) || !isNonEmptyString(attemptId)) {
      throw new Error(TRUSTED_PROFILE_INDEX_PERSISTENCE_STATE_CONFLICT);
    }
    const failedAt = requireTimestamp(now ?? new Date().toISOString());
    const transaction = this.db.transaction((): boolean => {
      const aggregate = this.getJobAggregateById(jobId);
      if (!aggregate) return false;
      const { job, attempts } = aggregate;
      const activeAttempt = attempts.at(-1);
      if (
        job.status !== KnowledgeTrustedIndexRefreshStatus.Running
        || job.activeAttemptId !== attemptId
        || !activeAttempt
        || activeAttempt.id !== attemptId
        || activeAttempt.outcome !== KnowledgeTrustedIndexRefreshAttemptOutcome.Running
      ) {
        return false;
      }
      const attemptUpdate = this.db.prepare(`
        UPDATE knowledge_trusted_profile_index_attempts
        SET finished_at = ?, outcome = ?, error_code = ?
        WHERE id = ? AND job_id = ? AND outcome = ?
      `).run(
        failedAt,
        KnowledgeTrustedIndexRefreshAttemptOutcome.Failed,
        KnowledgeTrustedProfileIndexErrorCode.RefreshFailed,
        attemptId,
        jobId,
        KnowledgeTrustedIndexRefreshAttemptOutcome.Running,
      );
      if (attemptUpdate.changes !== 1) return false;
      const jobUpdate = this.db.prepare(`
        UPDATE knowledge_trusted_profile_index_jobs
        SET status = ?, active_attempt_id = NULL, error_code = ?, updated_at = ?
        WHERE id = ? AND status = ? AND active_attempt_id = ?
      `).run(
        KnowledgeTrustedIndexRefreshStatus.Failed,
        KnowledgeTrustedProfileIndexErrorCode.RefreshFailed,
        failedAt,
        jobId,
        KnowledgeTrustedIndexRefreshStatus.Running,
        attemptId,
      );
      if (jobUpdate.changes !== 1) return throwCorruption();
      return true;
    });
    return this.runOwnedWrite(() => transaction.immediate());
  }

  recoverAbandonedRunning(now?: string): number {
    this.assertOwnsOuterTransaction();
    const recoveredAt = requireTimestamp(now ?? new Date().toISOString());
    const transaction = this.db.transaction((): number => {
      const runningRows = this.readJobRows(`
        WHERE status = '${KnowledgeTrustedIndexRefreshStatus.Running}'
        ORDER BY updated_at ASC, profile_revision ASC, id ASC
      `);
      let recoveredCount = 0;
      for (const row of runningRows) {
        const aggregate = this.mapJobAggregate(row);
        const attempt = aggregate.attempts.at(-1);
        if (
          !attempt
          || attempt.id !== aggregate.job.activeAttemptId
          || attempt.outcome !== KnowledgeTrustedIndexRefreshAttemptOutcome.Running
        ) {
          return throwCorruption();
        }
        const attemptUpdate = this.db.prepare(`
          UPDATE knowledge_trusted_profile_index_attempts
          SET finished_at = ?, outcome = ?, error_code = ?
          WHERE id = ? AND job_id = ? AND outcome = ?
        `).run(
          recoveredAt,
          KnowledgeTrustedIndexRefreshAttemptOutcome.Abandoned,
          KnowledgeTrustedProfileIndexErrorCode.RefreshAbandoned,
          attempt.id,
          aggregate.job.id,
          KnowledgeTrustedIndexRefreshAttemptOutcome.Running,
        );
        if (attemptUpdate.changes !== 1) return throwCorruption();
        const jobUpdate = this.db.prepare(`
          UPDATE knowledge_trusted_profile_index_jobs
          SET status = ?, active_attempt_id = NULL, error_code = ?, updated_at = ?
          WHERE id = ? AND status = ? AND active_attempt_id = ?
        `).run(
          KnowledgeTrustedIndexRefreshStatus.Failed,
          KnowledgeTrustedProfileIndexErrorCode.RefreshAbandoned,
          recoveredAt,
          aggregate.job.id,
          KnowledgeTrustedIndexRefreshStatus.Running,
          attempt.id,
        );
        if (jobUpdate.changes !== 1) return throwCorruption();
        recoveredCount += 1;
      }
      return recoveredCount;
    });
    return this.runOwnedWrite(() => transaction.immediate());
  }

  retryFailed(now?: string): number {
    this.assertOwnsOuterTransaction();
    const retriedAt = requireTimestamp(now ?? new Date().toISOString());
    const transaction = this.db.transaction((): number => {
      const rows = this.db.prepare(`
        SELECT
          job.id,
          job.workspace_id AS workspaceId,
          job.scope_id AS scopeId,
          job.profile_revision AS profileRevision,
          job.status,
          job.attempt_count AS attemptCount,
          job.active_attempt_id AS activeAttemptId,
          job.error_code AS errorCode,
          job.requested_at AS requestedAt,
          job.updated_at AS updatedAt
        FROM knowledge_trusted_profile_index_jobs AS job
        JOIN enterprise_lead_workspaces AS workspace
          ON workspace.id = job.workspace_id
          AND workspace.profile_revision = job.profile_revision
        WHERE job.status = ?
        ORDER BY job.updated_at ASC, job.profile_revision ASC, job.id ASC
      `).all(KnowledgeTrustedIndexRefreshStatus.Failed) as KnowledgeTrustedProfileIndexJobRow[];
      let retriedCount = 0;
      for (const row of rows) {
        const job = this.mapJobAggregate(row).job;
        const workspace = this.readWorkspaceRevision(job.workspaceId);
        if (!workspace || workspace.profileRevision !== job.profileRevision) {
          return throwCorruption();
        }
        const expectedScopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(job.workspaceId);
        const state = this.getState(job.workspaceId);
        if (
          job.scopeId !== expectedScopeId
          || (state && (state.scopeId !== expectedScopeId
            || state.indexedProfileRevision > workspace.profileRevision))
        ) {
          return throwCorruption();
        }
        if (state?.indexedProfileRevision === workspace.profileRevision) continue;
        const updateResult = this.db.prepare(`
          UPDATE knowledge_trusted_profile_index_jobs
          SET status = ?, active_attempt_id = NULL, error_code = NULL, updated_at = ?
          WHERE id = ? AND status = ? AND profile_revision = ?
        `).run(
          KnowledgeTrustedIndexRefreshStatus.Queued,
          retriedAt,
          job.id,
          KnowledgeTrustedIndexRefreshStatus.Failed,
          workspace.profileRevision,
        );
        if (updateResult.changes !== 1) return throwCorruption();
        retriedCount += 1;
      }
      return retriedCount;
    });
    return this.runOwnedWrite(() => transaction.immediate());
  }

  reconcileWorkspace(
    workspaceId: string,
    now?: string,
  ): KnowledgeTrustedProfileIndexEnqueueResult | null {
    this.assertOwnsOuterTransaction();
    const validWorkspaceId = requireWorkspaceId(workspaceId);
    const reconciledAt = requireTimestamp(now ?? new Date().toISOString());
    const transaction = this.db.transaction(() =>
      this.reconcileWorkspaceInCurrentTransaction(validWorkspaceId, reconciledAt));
    return this.runOwnedWrite(() => transaction.immediate());
  }

  reconcileAll(now?: string): number {
    this.assertOwnsOuterTransaction();
    const reconciledAt = requireTimestamp(now ?? new Date().toISOString());
    const transaction = this.db.transaction((): number => {
      const rows = this.db.prepare(`
        SELECT id
        FROM enterprise_lead_workspaces
        ORDER BY id ASC
      `).all() as Array<{ id: unknown }>;
      let reconciledCount = 0;
      for (const row of rows) {
        if (!isNonEmptyString(row.id)) return throwCorruption();
        if (this.reconcileWorkspaceInCurrentTransaction(row.id, reconciledAt)) {
          reconciledCount += 1;
        }
      }
      return reconciledCount;
    });
    return this.runOwnedWrite(() => transaction.immediate());
  }

  private reconcileWorkspaceInCurrentTransaction(
    workspaceId: string,
    now: string,
  ): KnowledgeTrustedProfileIndexEnqueueResult | null {
    if (!this.db.inTransaction) {
      throw new Error(TRUSTED_PROFILE_INDEX_PERSISTENCE_STATE_CONFLICT);
    }
    const workspace = this.readWorkspaceRevision(workspaceId);
    if (!workspace) return null;
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId);
    const state = this.getState(workspaceId);
    if (
      state
      && (state.scopeId !== scopeId
        || state.indexedProfileRevision > workspace.profileRevision)
    ) {
      return throwCorruption();
    }
    if (state?.indexedProfileRevision === workspace.profileRevision) return null;
    const currentJob = this.getJob(workspaceId, workspace.profileRevision);
    if (!currentJob) {
      return this.enqueueInCurrentTransaction({
        workspaceId,
        profileRevision: workspace.profileRevision,
        now,
      });
    }
    if (currentJob.scopeId !== scopeId) return throwCorruption();
    if (
      currentJob.status === KnowledgeTrustedIndexRefreshStatus.Queued
      || currentJob.status === KnowledgeTrustedIndexRefreshStatus.Running
    ) {
      return null;
    }
    const updateResult = this.db.prepare(`
      UPDATE knowledge_trusted_profile_index_jobs
      SET status = ?, active_attempt_id = NULL, error_code = NULL, updated_at = ?
      WHERE id = ? AND status = ?
    `).run(
      KnowledgeTrustedIndexRefreshStatus.Queued,
      now,
      currentJob.id,
      currentJob.status,
    );
    if (updateResult.changes !== 1) return throwCorruption();
    const job = this.getJob(workspaceId, workspace.profileRevision);
    if (!job) return throwCorruption();
    return { job, inserted: false };
  }

  getJob(workspaceId: string, profileRevision: number): KnowledgeTrustedProfileIndexJob | null {
    const validWorkspaceId = requireWorkspaceId(workspaceId);
    const validProfileRevision = requireProfileRevision(profileRevision);
    const row = this.db.prepare(`
      SELECT
        id,
        workspace_id AS workspaceId,
        scope_id AS scopeId,
        profile_revision AS profileRevision,
        status,
        attempt_count AS attemptCount,
        active_attempt_id AS activeAttemptId,
        error_code AS errorCode,
        requested_at AS requestedAt,
        updated_at AS updatedAt
      FROM knowledge_trusted_profile_index_jobs
      WHERE workspace_id = ? AND profile_revision = ?
      LIMIT 1
    `).get(validWorkspaceId, validProfileRevision) as
      | KnowledgeTrustedProfileIndexJobRow
      | undefined;
    return row ? this.mapJobAggregate(row).job : null;
  }

  getState(workspaceId: string): KnowledgeTrustedProfileIndexState | null {
    const validWorkspaceId = requireWorkspaceId(workspaceId);
    const row = this.db.prepare(`
      SELECT
        workspace_id AS workspaceId,
        scope_id AS scopeId,
        indexed_profile_revision AS indexedProfileRevision,
        indexed_at AS indexedAt
      FROM knowledge_trusted_profile_index_state
      WHERE workspace_id = ?
      LIMIT 1
    `).get(validWorkspaceId) as KnowledgeTrustedProfileIndexStateRow | undefined;
    if (!row) {
      return null;
    }
    if (
      !isNonEmptyString(row.workspaceId) ||
      row.workspaceId !== validWorkspaceId ||
      !isNonEmptyString(row.scopeId) ||
      row.scopeId !== buildEnterpriseLeadWorkspaceKnowledgeScopeId(validWorkspaceId) ||
      !isSafeIntegerAtLeast(row.indexedProfileRevision, 1) ||
      !isTimestamp(row.indexedAt)
    ) {
      return throwCorruption();
    }
    const completedJob = this.getJob(validWorkspaceId, row.indexedProfileRevision);
    if (!completedJob || completedJob.status !== KnowledgeTrustedIndexRefreshStatus.Completed) {
      return throwCorruption();
    }
    return {
      workspaceId: row.workspaceId,
      scopeId: row.scopeId,
      indexedProfileRevision: row.indexedProfileRevision,
      indexedAt: row.indexedAt,
    };
  }

  listAttempts(jobId: string): KnowledgeTrustedProfileIndexAttempt[] {
    if (!isNonEmptyString(jobId)) {
      throw new Error(TRUSTED_PROFILE_INDEX_PERSISTENCE_STATE_CONFLICT);
    }
    const jobRow = this.db.prepare(`
      SELECT
        id,
        workspace_id AS workspaceId,
        scope_id AS scopeId,
        profile_revision AS profileRevision,
        status,
        attempt_count AS attemptCount,
        active_attempt_id AS activeAttemptId,
        error_code AS errorCode,
        requested_at AS requestedAt,
        updated_at AS updatedAt
      FROM knowledge_trusted_profile_index_jobs
      WHERE id = ?
      LIMIT 1
    `).get(jobId) as KnowledgeTrustedProfileIndexJobRow | undefined;
    if (jobRow) {
      return this.mapJobAggregate(jobRow).attempts;
    }
    const orphanAttempt = this.db.prepare(`
      SELECT 1
      FROM knowledge_trusted_profile_index_attempts
      WHERE job_id = ?
      LIMIT 1
    `).get(jobId);
    return orphanAttempt ? throwCorruption() : [];
  }

  deleteWorkspaceTrustedIndexInCurrentTransaction(workspaceId: string): number {
    this.assertCurrentTransaction();
    const normalizedWorkspaceId = requireWorkspaceId(workspaceId);
    let deletedCount = this.db.prepare(`
      DELETE FROM knowledge_trusted_profile_index_attempts
      WHERE job_id IN (
        SELECT id FROM knowledge_trusted_profile_index_jobs WHERE workspace_id = ?
      )
    `).run(normalizedWorkspaceId).changes;
    deletedCount += this.db.prepare(`
      DELETE FROM knowledge_trusted_profile_index_jobs WHERE workspace_id = ?
    `).run(normalizedWorkspaceId).changes;
    deletedCount += this.db.prepare(`
      DELETE FROM knowledge_trusted_profile_index_state WHERE workspace_id = ?
    `).run(normalizedWorkspaceId).changes;
    return deletedCount;
  }

  deleteParentlessTrustedIndexInCurrentTransaction(): number {
    this.assertCurrentTransaction();
    return this.db.prepare(`
      DELETE FROM knowledge_trusted_profile_index_attempts
      WHERE NOT EXISTS (
        SELECT 1 FROM knowledge_trusted_profile_index_jobs AS job
        WHERE job.id = knowledge_trusted_profile_index_attempts.job_id
      )
    `).run().changes;
  }

  private assertCurrentTransaction(): void {
    if (!this.db.inTransaction) {
      throw new Error(TRUSTED_PROFILE_INDEX_PERSISTENCE_STATE_CONFLICT);
    }
  }

  private assertOwnsOuterTransaction(): void {
    if (this.db.inTransaction) {
      throw new Error(TRUSTED_PROFILE_INDEX_PERSISTENCE_STATE_CONFLICT);
    }
  }

  private runOwnedWrite<T>(run: () => T): T {
    try {
      return runTransientSqliteWriteTransaction(run);
    } catch (error) {
      if (isTransientSqliteBusyError(error)) {
        throw new KnowledgeTrustedProfileIndexRetryRequiredError();
      }
      if (isSqliteConstraintError(error)) return throwCorruption();
      throw error;
    }
  }

  private readJobRows(whereSql: string): KnowledgeTrustedProfileIndexJobRow[] {
    return this.db.prepare(`
      SELECT
        id,
        workspace_id AS workspaceId,
        scope_id AS scopeId,
        profile_revision AS profileRevision,
        status,
        attempt_count AS attemptCount,
        active_attempt_id AS activeAttemptId,
        error_code AS errorCode,
        requested_at AS requestedAt,
        updated_at AS updatedAt
      FROM knowledge_trusted_profile_index_jobs
      ${whereSql}
    `).all() as KnowledgeTrustedProfileIndexJobRow[];
  }

  private getJobAggregateById(jobId: string): KnowledgeTrustedProfileIndexJobAggregate | null {
    const row = this.db.prepare(`
      SELECT
        id,
        workspace_id AS workspaceId,
        scope_id AS scopeId,
        profile_revision AS profileRevision,
        status,
        attempt_count AS attemptCount,
        active_attempt_id AS activeAttemptId,
        error_code AS errorCode,
        requested_at AS requestedAt,
        updated_at AS updatedAt
      FROM knowledge_trusted_profile_index_jobs
      WHERE id = ?
      LIMIT 1
    `).get(jobId) as KnowledgeTrustedProfileIndexJobRow | undefined;
    return row ? this.mapJobAggregate(row) : null;
  }

  private readWorkspaceRevision(workspaceId: string): {
    id: string;
    profileRevision: number;
  } | null {
    const row = this.db.prepare(`
      SELECT id, profile_revision AS profileRevision
      FROM enterprise_lead_workspaces
      WHERE id = ?
      LIMIT 1
    `).get(workspaceId) as WorkspaceProfileRevisionRow | undefined;
    if (!row) return null;
    if (row.id !== workspaceId || !isSafeIntegerAtLeast(row.profileRevision, 1)) {
      return throwCorruption();
    }
    return { id: workspaceId, profileRevision: row.profileRevision };
  }

  private readAttempts(jobId: string): KnowledgeTrustedProfileIndexAttempt[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        job_id AS jobId,
        attempt_number AS attemptNumber,
        started_at AS startedAt,
        finished_at AS finishedAt,
        outcome,
        error_code AS errorCode
      FROM knowledge_trusted_profile_index_attempts
      WHERE job_id = ?
      ORDER BY attempt_number ASC
    `).all(jobId) as KnowledgeTrustedProfileIndexAttemptRow[];
    return rows.map(row => this.mapAttempt(row, jobId));
  }

  private mapJobAggregate(
    row: KnowledgeTrustedProfileIndexJobRow,
  ): KnowledgeTrustedProfileIndexJobAggregate {
    const job = this.mapJobRow(row);
    const attempts = this.readAttempts(job.id);
    this.validateJobAttemptLifecycle(job, attempts);
    return { job, attempts };
  }

  private mapJobRow(row: KnowledgeTrustedProfileIndexJobRow): KnowledgeTrustedProfileIndexJob {
    if (
      !isNonEmptyString(row.id) ||
      !isNonEmptyString(row.workspaceId) ||
      !isNonEmptyString(row.scopeId) ||
      row.scopeId !== buildEnterpriseLeadWorkspaceKnowledgeScopeId(row.workspaceId) ||
      !isSafeIntegerAtLeast(row.profileRevision, 1) ||
      typeof row.status !== 'string' ||
      !trustedRefreshStatusSet.has(row.status) ||
      !isSafeIntegerAtLeast(row.attemptCount, 0) ||
      !isTimestamp(row.requestedAt) ||
      !isTimestamp(row.updatedAt)
    ) {
      return throwCorruption();
    }
    const status = row.status as KnowledgeTrustedIndexRefreshStatusValue;
    const activeAttemptId = readNullableNonEmptyString(row.activeAttemptId);
    const errorCode = readNullableErrorCode(row.errorCode);
    const shapeIsValid =
      (status === KnowledgeTrustedIndexRefreshStatus.Queued &&
        activeAttemptId === null && errorCode === null) ||
      (status === KnowledgeTrustedIndexRefreshStatus.Running &&
        activeAttemptId !== null && errorCode === null) ||
      (status === KnowledgeTrustedIndexRefreshStatus.Completed &&
        activeAttemptId === null && errorCode === null) ||
      (status === KnowledgeTrustedIndexRefreshStatus.Failed &&
        activeAttemptId === null && errorCode !== null);
    if (!shapeIsValid) {
      return throwCorruption();
    }
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      scopeId: row.scopeId,
      profileRevision: row.profileRevision,
      status,
      attemptCount: row.attemptCount,
      activeAttemptId,
      errorCode,
      requestedAt: row.requestedAt,
      updatedAt: row.updatedAt,
    };
  }

  private validateJobAttemptLifecycle(
    job: KnowledgeTrustedProfileIndexJob,
    attempts: readonly KnowledgeTrustedProfileIndexAttempt[],
  ): void {
    if (
      attempts.length !== job.attemptCount ||
      attempts.some((attempt, index) => attempt.attemptNumber !== index + 1)
    ) {
      return throwCorruption();
    }
    const runningAttempts = attempts.filter(
      attempt => attempt.outcome === KnowledgeTrustedIndexRefreshAttemptOutcome.Running,
    );
    const lastAttempt = attempts.at(-1) ?? null;
    if (
      job.status !== KnowledgeTrustedIndexRefreshStatus.Running &&
      runningAttempts.length !== 0
    ) {
      return throwCorruption();
    }
    if (job.status === KnowledgeTrustedIndexRefreshStatus.Queued) {
      if (
        lastAttempt !== null &&
        lastAttempt.outcome !== KnowledgeTrustedIndexRefreshAttemptOutcome.Completed &&
        lastAttempt.outcome !== KnowledgeTrustedIndexRefreshAttemptOutcome.Failed &&
        lastAttempt.outcome !== KnowledgeTrustedIndexRefreshAttemptOutcome.Abandoned
      ) {
        return throwCorruption();
      }
      return;
    }
    if (job.status === KnowledgeTrustedIndexRefreshStatus.Running) {
      if (
        runningAttempts.length !== 1 ||
        lastAttempt?.outcome !== KnowledgeTrustedIndexRefreshAttemptOutcome.Running ||
        lastAttempt.id !== job.activeAttemptId
      ) {
        return throwCorruption();
      }
      return;
    }
    if (job.status === KnowledgeTrustedIndexRefreshStatus.Completed) {
      if (lastAttempt?.outcome !== KnowledgeTrustedIndexRefreshAttemptOutcome.Completed) {
        return throwCorruption();
      }
      return;
    }
    const expectedErrorCode = lastAttempt?.outcome === KnowledgeTrustedIndexRefreshAttemptOutcome.Failed
      ? KnowledgeTrustedProfileIndexErrorCode.RefreshFailed
      : lastAttempt?.outcome === KnowledgeTrustedIndexRefreshAttemptOutcome.Abandoned
        ? KnowledgeTrustedProfileIndexErrorCode.RefreshAbandoned
        : null;
    if (expectedErrorCode === null || job.errorCode !== expectedErrorCode) {
      return throwCorruption();
    }
  }

  private mapAttempt(
    row: KnowledgeTrustedProfileIndexAttemptRow,
    expectedJobId: string,
  ): KnowledgeTrustedProfileIndexAttempt {
    const finishedAt = row.finishedAt === null
      ? null
      : isTimestamp(row.finishedAt)
        ? row.finishedAt
        : throwCorruption();
    if (
      !isNonEmptyString(row.id) ||
      !isNonEmptyString(row.jobId) ||
      row.jobId !== expectedJobId ||
      !isSafeIntegerAtLeast(row.attemptNumber, 1) ||
      !isTimestamp(row.startedAt) ||
      typeof row.outcome !== 'string' ||
      !trustedRefreshAttemptOutcomeSet.has(row.outcome)
    ) {
      return throwCorruption();
    }
    const outcome = row.outcome as KnowledgeTrustedIndexRefreshAttemptOutcomeValue;
    const errorCode = readNullableErrorCode(row.errorCode);
    const shapeIsValid =
      (outcome === KnowledgeTrustedIndexRefreshAttemptOutcome.Running &&
        finishedAt === null && errorCode === null) ||
      (outcome === KnowledgeTrustedIndexRefreshAttemptOutcome.Completed &&
        finishedAt !== null && errorCode === null) ||
      (outcome === KnowledgeTrustedIndexRefreshAttemptOutcome.Failed &&
        finishedAt !== null &&
        errorCode === KnowledgeTrustedProfileIndexErrorCode.RefreshFailed) ||
      (outcome === KnowledgeTrustedIndexRefreshAttemptOutcome.Abandoned &&
        finishedAt !== null &&
        errorCode === KnowledgeTrustedProfileIndexErrorCode.RefreshAbandoned);
    if (!shapeIsValid) {
      return throwCorruption();
    }
    return {
      id: row.id,
      jobId: row.jobId,
      attemptNumber: row.attemptNumber,
      startedAt: row.startedAt,
      finishedAt,
      outcome,
      errorCode,
    };
  }
}
