import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import { buildEnterpriseLeadWorkspaceKnowledgeScopeId } from '../../shared/enterpriseLeadWorkspace/constants';
import {
  KnowledgeTrustedIndexRefreshAttemptOutcome,
  KnowledgeTrustedIndexRefreshStatus,
  KnowledgeTrustedProfileIndexErrorCode,
} from '../../shared/knowledgeBase/constants';
import {
  KnowledgeTrustedProfileIndexCorruptionError,
  KnowledgeTrustedProfileIndexStore,
} from './knowledgeTrustedProfileIndexStore';

const databases: Database.Database[] = [];
const temporaryDirectories: string[] = [];

const openDatabase = (databasePath = ':memory:'): Database.Database => {
  const db = new Database(databasePath);
  databases.push(db);
  return db;
};

const createWorkspaceRevisionTable = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS enterprise_lead_workspaces (
      id TEXT PRIMARY KEY,
      profile TEXT NOT NULL DEFAULT '{}',
      profile_revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
};

const seedWorkspaceRevision = (
  db: Database.Database,
  workspaceId: string,
  profileRevision: number,
): void => {
  db.prepare(`
    INSERT INTO enterprise_lead_workspaces (
      id, profile, profile_revision, updated_at
    ) VALUES (?, '{}', ?, ?)
  `).run(workspaceId, profileRevision, '2026-07-13T00:00:00.000Z');
};

interface AttemptSeed {
  id: string;
  jobId: string;
  attemptNumber: number;
  outcome: typeof KnowledgeTrustedIndexRefreshAttemptOutcome[
    keyof typeof KnowledgeTrustedIndexRefreshAttemptOutcome
  ];
}

const insertAttempt = (db: Database.Database, seed: AttemptSeed): void => {
  const isRunning = seed.outcome === KnowledgeTrustedIndexRefreshAttemptOutcome.Running;
  const errorCode = seed.outcome === KnowledgeTrustedIndexRefreshAttemptOutcome.Failed
    ? KnowledgeTrustedProfileIndexErrorCode.RefreshFailed
    : seed.outcome === KnowledgeTrustedIndexRefreshAttemptOutcome.Abandoned
      ? KnowledgeTrustedProfileIndexErrorCode.RefreshAbandoned
      : null;
  db.prepare(`
    INSERT INTO knowledge_trusted_profile_index_attempts (
      id, job_id, attempt_number, started_at, finished_at, outcome, error_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    seed.id,
    seed.jobId,
    seed.attemptNumber,
    '2026-07-12T01:00:10.000Z',
    isRunning ? null : '2026-07-12T01:01:00.000Z',
    seed.outcome,
    errorCode,
  );
};

interface JobLifecycleSeed {
  status: typeof KnowledgeTrustedIndexRefreshStatus[
    keyof typeof KnowledgeTrustedIndexRefreshStatus
  ];
  attemptCount: number;
  activeAttemptId?: string | null;
  errorCode?: typeof KnowledgeTrustedProfileIndexErrorCode[
    keyof typeof KnowledgeTrustedProfileIndexErrorCode
  ] | null;
}

const updateJobLifecycle = (
  db: Database.Database,
  jobId: string,
  seed: JobLifecycleSeed,
): void => {
  db.prepare(`
    UPDATE knowledge_trusted_profile_index_jobs
    SET status = ?, attempt_count = ?, active_attempt_id = ?, error_code = ?, updated_at = ?
    WHERE id = ?
  `).run(
    seed.status,
    seed.attemptCount,
    seed.activeAttemptId ?? null,
    seed.errorCode ?? null,
    '2026-07-12T01:01:00.000Z',
    jobId,
  );
};

const expectFixedCorruption = (read: () => unknown): void => {
  let thrown: unknown;
  try {
    read();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(KnowledgeTrustedProfileIndexCorruptionError);
  expect((thrown as Error).message).toBe('Trusted profile index data is corrupt');
};

afterEach(() => {
  while (databases.length > 0) {
    const db = databases.pop();
    if (db?.open) {
      db.close();
    }
  }
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) {
      fs.rmSync(directory, { force: true, recursive: true });
    }
  }
});

describe('KnowledgeTrustedProfileIndexStore', () => {
  test('creates the durable outbox, immutable attempt, and successful state schemas', () => {
    const db = openDatabase();
    new KnowledgeTrustedProfileIndexStore(db);

    const tables = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'knowledge_trusted_profile_index_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;
    expect(tables.map(row => row.name)).toEqual([
      'knowledge_trusted_profile_index_attempts',
      'knowledge_trusted_profile_index_jobs',
      'knowledge_trusted_profile_index_state',
    ]);

    const schema = db.prepare(`
      SELECT GROUP_CONCAT(sql, '\n') AS sql
      FROM sqlite_master
      WHERE name LIKE 'knowledge_trusted_profile_index_%'
    `).get() as { sql: string };
    for (const status of Object.values(KnowledgeTrustedIndexRefreshStatus)) {
      expect(schema.sql).toContain(`'${status}'`);
    }
    for (const outcome of Object.values(KnowledgeTrustedIndexRefreshAttemptOutcome)) {
      expect(schema.sql).toContain(`'${outcome}'`);
    }
    for (const errorCode of Object.values(KnowledgeTrustedProfileIndexErrorCode)) {
      expect(schema.sql).toContain(`'${errorCode}'`);
    }
  });

  test('derives scope internally and preserves an idempotent revision job unchanged', () => {
    const db = openDatabase();
    const store = new KnowledgeTrustedProfileIndexStore(db);
    const requestedAt = '2026-07-12T01:02:03.000Z';

    const first = store.enqueue({
      workspaceId: 'workspace-1',
      profileRevision: 2,
      now: requestedAt,
    });
    const second = store.enqueue({
      workspaceId: 'workspace-1',
      profileRevision: 2,
      now: '2026-07-12T09:09:09.000Z',
    });

    expect(first.inserted).toBe(true);
    expect(first.job).toEqual({
      id: expect.any(String),
      workspaceId: 'workspace-1',
      scopeId: buildEnterpriseLeadWorkspaceKnowledgeScopeId('workspace-1'),
      profileRevision: 2,
      status: KnowledgeTrustedIndexRefreshStatus.Queued,
      attemptCount: 0,
      activeAttemptId: null,
      errorCode: null,
      requestedAt,
      updatedAt: requestedAt,
    });
    expect(second).toEqual({ job: first.job, inserted: false });
    expect(store.getJob('workspace-1', 2)).toEqual(first.job);
    expect(store.listAttempts(first.job.id)).toEqual([]);
    expect(store.getState('workspace-1')).toBeNull();
  });

  test('persists valid attempts and indexed state across a file-backed reopen', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-profile-index-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'trusted.sqlite');
    const firstDb = openDatabase(databasePath);
    const firstStore = new KnowledgeTrustedProfileIndexStore(firstDb);
    const enqueued = firstStore.enqueue({
      workspaceId: 'workspace-1',
      profileRevision: 3,
      now: '2026-07-12T01:00:00.000Z',
    });
    firstDb.prepare(`
      UPDATE knowledge_trusted_profile_index_jobs
      SET status = ?, attempt_count = 1, updated_at = ?
      WHERE id = ?
    `).run(
      KnowledgeTrustedIndexRefreshStatus.Completed,
      '2026-07-12T01:01:00.000Z',
      enqueued.job.id,
    );
    firstDb.prepare(`
      INSERT INTO knowledge_trusted_profile_index_attempts (
        id, job_id, attempt_number, started_at, finished_at, outcome, error_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'attempt-1',
      enqueued.job.id,
      1,
      '2026-07-12T01:00:10.000Z',
      '2026-07-12T01:01:00.000Z',
      KnowledgeTrustedIndexRefreshAttemptOutcome.Completed,
      null,
    );
    firstDb.prepare(`
      INSERT INTO knowledge_trusted_profile_index_state (
        workspace_id, scope_id, indexed_profile_revision, indexed_at
      ) VALUES (?, ?, ?, ?)
    `).run(
      'workspace-1',
      buildEnterpriseLeadWorkspaceKnowledgeScopeId('workspace-1'),
      3,
      '2026-07-12T01:01:00.000Z',
    );
    firstDb.close();

    const secondDb = openDatabase(databasePath);
    const secondStore = new KnowledgeTrustedProfileIndexStore(secondDb);

    expect(secondStore.getJob('workspace-1', 3)).toMatchObject({
      id: enqueued.job.id,
      attemptCount: 1,
      status: KnowledgeTrustedIndexRefreshStatus.Completed,
    });
    expect(secondStore.listAttempts(enqueued.job.id)).toEqual([
      {
        id: 'attempt-1',
        jobId: enqueued.job.id,
        attemptNumber: 1,
        startedAt: '2026-07-12T01:00:10.000Z',
        finishedAt: '2026-07-12T01:01:00.000Z',
        outcome: KnowledgeTrustedIndexRefreshAttemptOutcome.Completed,
        errorCode: null,
      },
    ]);
    expect(secondStore.getState('workspace-1')).toEqual({
      workspaceId: 'workspace-1',
      scopeId: buildEnterpriseLeadWorkspaceKnowledgeScopeId('workspace-1'),
      indexedProfileRevision: 3,
      indexedAt: '2026-07-12T01:01:00.000Z',
    });
  });

  test('rejects non-safe revisions and invalid status/error shapes in SQL', () => {
    const db = openDatabase();
    const store = new KnowledgeTrustedProfileIndexStore(db);

    for (const invalidRevision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => store.enqueue({
        workspaceId: 'workspace-1',
        profileRevision: invalidRevision,
      })).toThrow();
    }
    expect(() => db.prepare(`
      INSERT INTO knowledge_trusted_profile_index_jobs (
        id, workspace_id, scope_id, profile_revision, status, attempt_count,
        active_attempt_id, error_code, requested_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'invalid-job',
      'workspace-1',
      buildEnterpriseLeadWorkspaceKnowledgeScopeId('workspace-1'),
      1,
      KnowledgeTrustedIndexRefreshStatus.Failed,
      0,
      null,
      'raw SQL or secret',
      '2026-07-12T01:00:00.000Z',
      '2026-07-12T01:00:00.000Z',
    )).toThrow();
  });

  test('maps corrupt rows to one fixed safe error without exposing their values', () => {
    const db = openDatabase();
    const store = new KnowledgeTrustedProfileIndexStore(db);
    db.pragma('ignore_check_constraints = ON');
    db.prepare(`
      INSERT INTO knowledge_trusted_profile_index_jobs (
        id, workspace_id, scope_id, profile_revision, status, attempt_count,
        active_attempt_id, error_code, requested_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'secret-job',
      'workspace-1',
      'scope-with-/private/path-and-sk-secret',
      1,
      'corrupt-status',
      0,
      null,
      null,
      '2026-07-12T01:00:00.000Z',
      '2026-07-12T01:00:00.000Z',
    );
    db.pragma('ignore_check_constraints = OFF');

    let thrown: unknown;
    try {
      store.getJob('workspace-1', 1);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KnowledgeTrustedProfileIndexCorruptionError);
    expect(JSON.stringify(thrown)).not.toContain('sk-secret');
    expect(String(thrown)).not.toContain('/private/path');
    expect(String(thrown)).not.toContain('corrupt-status');
  });

  test('rejects allocated attempts that are not exactly contiguous from one through attemptCount', () => {
    const db = openDatabase();
    const store = new KnowledgeTrustedProfileIndexStore(db);
    const { job } = store.enqueue({ workspaceId: 'workspace-gap', profileRevision: 1 });
    db.pragma('ignore_check_constraints = ON');
    insertAttempt(db, {
      id: 'attempt-zero-secret',
      jobId: job.id,
      attemptNumber: 0,
      outcome: KnowledgeTrustedIndexRefreshAttemptOutcome.Completed,
    });
    db.pragma('ignore_check_constraints = OFF');
    insertAttempt(db, {
      id: 'attempt-one',
      jobId: job.id,
      attemptNumber: 1,
      outcome: KnowledgeTrustedIndexRefreshAttemptOutcome.Completed,
    });
    updateJobLifecycle(db, job.id, {
      status: KnowledgeTrustedIndexRefreshStatus.Queued,
      attemptCount: 1,
    });

    expectFixedCorruption(() => store.getJob('workspace-gap', 1));
  });

  test('rejects a running attempt beneath a non-running job through both read APIs', () => {
    const db = openDatabase();
    const store = new KnowledgeTrustedProfileIndexStore(db);
    const { job } = store.enqueue({ workspaceId: 'workspace-queued-running', profileRevision: 1 });
    insertAttempt(db, {
      id: 'running-attempt-secret',
      jobId: job.id,
      attemptNumber: 1,
      outcome: KnowledgeTrustedIndexRefreshAttemptOutcome.Running,
    });
    updateJobLifecycle(db, job.id, {
      status: KnowledgeTrustedIndexRefreshStatus.Queued,
      attemptCount: 1,
    });

    expectFixedCorruption(() => store.getJob('workspace-queued-running', 1));
    expectFixedCorruption(() => store.listAttempts(job.id));
  });

  test('rejects a running job with more than one running attempt', () => {
    const db = openDatabase();
    const store = new KnowledgeTrustedProfileIndexStore(db);
    const { job } = store.enqueue({ workspaceId: 'workspace-multi-running', profileRevision: 1 });
    db.exec('DROP INDEX idx_trusted_profile_index_one_running_attempt');
    insertAttempt(db, {
      id: 'running-attempt-one',
      jobId: job.id,
      attemptNumber: 1,
      outcome: KnowledgeTrustedIndexRefreshAttemptOutcome.Running,
    });
    insertAttempt(db, {
      id: 'running-attempt-two',
      jobId: job.id,
      attemptNumber: 2,
      outcome: KnowledgeTrustedIndexRefreshAttemptOutcome.Running,
    });
    updateJobLifecycle(db, job.id, {
      status: KnowledgeTrustedIndexRefreshStatus.Running,
      attemptCount: 2,
      activeAttemptId: 'running-attempt-two',
    });

    expectFixedCorruption(() => store.getJob('workspace-multi-running', 1));
  });

  test('rejects a completed job whose last attempt is not completed', () => {
    const db = openDatabase();
    const store = new KnowledgeTrustedProfileIndexStore(db);
    const { job } = store.enqueue({ workspaceId: 'workspace-bad-completed', profileRevision: 1 });
    insertAttempt(db, {
      id: 'failed-attempt-secret',
      jobId: job.id,
      attemptNumber: 1,
      outcome: KnowledgeTrustedIndexRefreshAttemptOutcome.Failed,
    });
    updateJobLifecycle(db, job.id, {
      status: KnowledgeTrustedIndexRefreshStatus.Completed,
      attemptCount: 1,
    });

    expectFixedCorruption(() => store.getJob('workspace-bad-completed', 1));
  });

  test('rejects a failed job whose error code disagrees with its last terminal attempt', () => {
    const db = openDatabase();
    const store = new KnowledgeTrustedProfileIndexStore(db);
    const { job } = store.enqueue({ workspaceId: 'workspace-bad-failed', profileRevision: 1 });
    insertAttempt(db, {
      id: 'abandoned-attempt-secret',
      jobId: job.id,
      attemptNumber: 1,
      outcome: KnowledgeTrustedIndexRefreshAttemptOutcome.Abandoned,
    });
    updateJobLifecycle(db, job.id, {
      status: KnowledgeTrustedIndexRefreshStatus.Failed,
      attemptCount: 1,
      errorCode: KnowledgeTrustedProfileIndexErrorCode.RefreshFailed,
    });

    expectFixedCorruption(() => store.getJob('workspace-bad-failed', 1));
  });

  test('rejects indexed state when its completed job has a corrupt attempt lifecycle', () => {
    const db = openDatabase();
    const store = new KnowledgeTrustedProfileIndexStore(db);
    const { job } = store.enqueue({ workspaceId: 'workspace-bad-state', profileRevision: 1 });
    insertAttempt(db, {
      id: 'failed-state-attempt-secret',
      jobId: job.id,
      attemptNumber: 1,
      outcome: KnowledgeTrustedIndexRefreshAttemptOutcome.Failed,
    });
    updateJobLifecycle(db, job.id, {
      status: KnowledgeTrustedIndexRefreshStatus.Completed,
      attemptCount: 1,
    });
    db.prepare(`
      INSERT INTO knowledge_trusted_profile_index_state (
        workspace_id, scope_id, indexed_profile_revision, indexed_at
      ) VALUES (?, ?, ?, ?)
    `).run(
      'workspace-bad-state',
      buildEnterpriseLeadWorkspaceKnowledgeScopeId('workspace-bad-state'),
      1,
      '2026-07-12T01:01:00.000Z',
    );

    expectFixedCorruption(() => store.getState('workspace-bad-state'));
  });

  test.each([
    KnowledgeTrustedIndexRefreshAttemptOutcome.Completed,
    KnowledgeTrustedIndexRefreshAttemptOutcome.Failed,
    KnowledgeTrustedIndexRefreshAttemptOutcome.Abandoned,
  ])('accepts a queued repair or retry after a terminal %s attempt', outcome => {
    const db = openDatabase();
    const store = new KnowledgeTrustedProfileIndexStore(db);
    const workspaceId = `workspace-requeued-${outcome}`;
    const { job } = store.enqueue({ workspaceId, profileRevision: 1 });
    insertAttempt(db, {
      id: `terminal-${outcome}`,
      jobId: job.id,
      attemptNumber: 1,
      outcome,
    });
    updateJobLifecycle(db, job.id, {
      status: KnowledgeTrustedIndexRefreshStatus.Queued,
      attemptCount: 1,
    });

    expect(store.getJob(workspaceId, 1)).toMatchObject({
      status: KnowledgeTrustedIndexRefreshStatus.Queued,
      attemptCount: 1,
    });
    expect(store.listAttempts(job.id).at(-1)?.outcome).toBe(outcome);
  });

  test('claims FIFO with one global running attempt and terminalizes the exact immutable lease', () => {
    const db = openDatabase();
    createWorkspaceRevisionTable(db);
    seedWorkspaceRevision(db, 'workspace-a', 3);
    seedWorkspaceRevision(db, 'workspace-b', 2);
    const store = new KnowledgeTrustedProfileIndexStore(db);
    const firstJob = store.enqueue({
      workspaceId: 'workspace-a',
      profileRevision: 3,
      now: '2026-07-13T00:00:00.000Z',
    }).job;
    const secondJob = store.enqueue({
      workspaceId: 'workspace-b',
      profileRevision: 2,
      now: '2026-07-13T00:01:00.000Z',
    }).job;

    const firstClaim = store.claimNext('2026-07-13T01:00:00.000Z');

    expect(firstClaim).toMatchObject({
      job: {
        id: firstJob.id,
        status: KnowledgeTrustedIndexRefreshStatus.Running,
        attemptCount: 1,
      },
      attempt: {
        attemptNumber: 1,
        outcome: KnowledgeTrustedIndexRefreshAttemptOutcome.Running,
      },
    });
    expect(store.claimNext('2026-07-13T01:00:01.000Z')).toBeNull();
    expect(store.completeAttempt(
      firstJob.id,
      'not-the-active-attempt',
      '2026-07-13T01:01:00.000Z',
    )).toBe(false);
    expect(store.completeAttempt(
      firstJob.id,
      firstClaim!.attempt.id,
      '2026-07-13T01:01:00.000Z',
    )).toBe(true);
    const completedAttempt = store.listAttempts(firstJob.id)[0];
    expect(completedAttempt).toMatchObject({
      id: firstClaim!.attempt.id,
      outcome: KnowledgeTrustedIndexRefreshAttemptOutcome.Completed,
      finishedAt: '2026-07-13T01:01:00.000Z',
    });
    expect(store.failAttempt(
      firstJob.id,
      firstClaim!.attempt.id,
      '2026-07-13T01:02:00.000Z',
    )).toBe(false);
    expect(store.listAttempts(firstJob.id)[0]).toEqual(completedAttempt);
    expect(store.claimNext('2026-07-13T01:03:00.000Z')?.job.id).toBe(secondJob.id);
  });

  test('advances state only to the completed job revision and preserves indexedAt for older completion', () => {
    const db = openDatabase();
    createWorkspaceRevisionTable(db);
    seedWorkspaceRevision(db, 'workspace-revisions', 3);
    const store = new KnowledgeTrustedProfileIndexStore(db);
    store.enqueue({
      workspaceId: 'workspace-revisions',
      profileRevision: 2,
      now: '2026-07-13T00:00:00.000Z',
    });
    store.enqueue({
      workspaceId: 'workspace-revisions',
      profileRevision: 3,
      now: '2026-07-13T00:01:00.000Z',
    });
    store.enqueue({
      workspaceId: 'workspace-revisions',
      profileRevision: 1,
      now: '2026-07-13T00:02:00.000Z',
    });

    const revisionTwo = store.claimNext('2026-07-13T01:00:00.000Z')!;
    expect(revisionTwo.job.profileRevision).toBe(2);
    expect(store.completeAttempt(
      revisionTwo.job.id,
      revisionTwo.attempt.id,
      '2026-07-13T01:01:00.000Z',
    )).toBe(true);
    expect(store.getState('workspace-revisions')).toMatchObject({
      indexedProfileRevision: 2,
      indexedAt: '2026-07-13T01:01:00.000Z',
    });

    const revisionThree = store.claimNext('2026-07-13T01:02:00.000Z')!;
    expect(revisionThree.job.profileRevision).toBe(3);
    expect(store.completeAttempt(
      revisionThree.job.id,
      revisionThree.attempt.id,
      '2026-07-13T01:03:00.000Z',
    )).toBe(true);
    const currentState = store.getState('workspace-revisions');
    expect(currentState).toMatchObject({
      indexedProfileRevision: 3,
      indexedAt: '2026-07-13T01:03:00.000Z',
    });

    const olderRevision = store.claimNext('2026-07-13T01:04:00.000Z')!;
    expect(olderRevision.job.profileRevision).toBe(1);
    expect(store.completeAttempt(
      olderRevision.job.id,
      olderRevision.attempt.id,
      '2026-07-13T01:05:00.000Z',
    )).toBe(true);
    expect(store.getState('workspace-revisions')).toEqual(currentState);
  });

  test('fails with fixed codes, retries only failed current revisions, and never replays older audit rows', () => {
    const db = openDatabase();
    createWorkspaceRevisionTable(db);
    seedWorkspaceRevision(db, 'workspace-current-failure', 1);
    seedWorkspaceRevision(db, 'workspace-old-failure', 2);
    const store = new KnowledgeTrustedProfileIndexStore(db);
    const currentJob = store.enqueue({
      workspaceId: 'workspace-current-failure',
      profileRevision: 1,
      now: '2026-07-13T00:01:00.000Z',
    }).job;
    const oldJob = store.enqueue({
      workspaceId: 'workspace-old-failure',
      profileRevision: 1,
      now: '2026-07-13T00:00:00.000Z',
    }).job;
    store.enqueue({
      workspaceId: 'workspace-old-failure',
      profileRevision: 2,
      now: '2026-07-13T00:02:00.000Z',
    });

    const currentClaim = store.claimNext('2026-07-13T01:00:00.000Z')!;
    expect(currentClaim.job.id).toBe(oldJob.id);
    expect(store.failAttempt(
      currentClaim.job.id,
      currentClaim.attempt.id,
      '2026-07-13T01:01:00.000Z',
    )).toBe(true);
    const nextClaim = store.claimNext('2026-07-13T01:02:00.000Z')!;
    expect(nextClaim.job.id).toBe(currentJob.id);
    expect(store.failAttempt(
      nextClaim.job.id,
      nextClaim.attempt.id,
      '2026-07-13T01:03:00.000Z',
    )).toBe(true);

    expect(store.retryFailed('2026-07-13T02:00:00.000Z')).toBe(1);
    expect(store.getJob('workspace-current-failure', 1)).toMatchObject({
      status: KnowledgeTrustedIndexRefreshStatus.Queued,
      attemptCount: 1,
      errorCode: null,
    });
    expect(store.getJob('workspace-old-failure', 1)).toMatchObject({
      status: KnowledgeTrustedIndexRefreshStatus.Failed,
      errorCode: KnowledgeTrustedProfileIndexErrorCode.RefreshFailed,
    });
    expect(store.listAttempts(oldJob.id)).toEqual([
      expect.objectContaining({
        outcome: KnowledgeTrustedIndexRefreshAttemptOutcome.Failed,
        errorCode: KnowledgeTrustedProfileIndexErrorCode.RefreshFailed,
      }),
    ]);
  });

  test('recovers abandoned running work before reconciliation and repairs only the current revision', () => {
    const db = openDatabase();
    createWorkspaceRevisionTable(db);
    seedWorkspaceRevision(db, 'workspace-recover', 1);
    seedWorkspaceRevision(db, 'workspace-missing', 2);
    const store = new KnowledgeTrustedProfileIndexStore(db);
    const recoverJob = store.enqueue({
      workspaceId: 'workspace-recover',
      profileRevision: 1,
    }).job;
    const claim = store.claimNext('2026-07-13T01:00:00.000Z')!;
    expect(claim.job.id).toBe(recoverJob.id);

    expect(store.recoverAbandonedRunning('2026-07-13T01:01:00.000Z')).toBe(1);
    expect(store.getJob('workspace-recover', 1)).toMatchObject({
      status: KnowledgeTrustedIndexRefreshStatus.Failed,
      errorCode: KnowledgeTrustedProfileIndexErrorCode.RefreshAbandoned,
    });
    expect(store.listAttempts(recoverJob.id)).toEqual([
      expect.objectContaining({
        outcome: KnowledgeTrustedIndexRefreshAttemptOutcome.Abandoned,
        errorCode: KnowledgeTrustedProfileIndexErrorCode.RefreshAbandoned,
      }),
    ]);

    expect(store.reconcileAll('2026-07-13T01:02:00.000Z')).toBe(2);
    expect(store.getJob('workspace-recover', 1)).toMatchObject({
      status: KnowledgeTrustedIndexRefreshStatus.Queued,
      attemptCount: 1,
    });
    expect(store.getJob('workspace-missing', 2)).toMatchObject({
      status: KnowledgeTrustedIndexRefreshStatus.Queued,
      attemptCount: 0,
    });
    expect(store.reconcileWorkspace(
      'workspace-recover',
      '2026-07-13T01:03:00.000Z',
    )).toBeNull();
  });

  test('fails closed on indexed state ahead of the current Profile or on a scope mismatch', () => {
    const db = openDatabase();
    createWorkspaceRevisionTable(db);
    seedWorkspaceRevision(db, 'workspace-corrupt', 2);
    const store = new KnowledgeTrustedProfileIndexStore(db);
    store.enqueue({ workspaceId: 'workspace-corrupt', profileRevision: 2 });
    const claim = store.claimNext('2026-07-13T01:00:00.000Z')!;
    expect(store.completeAttempt(
      claim.job.id,
      claim.attempt.id,
      '2026-07-13T01:01:00.000Z',
    )).toBe(true);

    db.prepare(`
      UPDATE enterprise_lead_workspaces SET profile_revision = 1 WHERE id = ?
    `).run('workspace-corrupt');
    expectFixedCorruption(() => store.reconcileWorkspace('workspace-corrupt'));

    db.prepare(`
      UPDATE enterprise_lead_workspaces SET profile_revision = 2 WHERE id = ?
    `).run('workspace-corrupt');
    db.pragma('ignore_check_constraints = ON');
    db.prepare(`
      UPDATE knowledge_trusted_profile_index_state SET scope_id = ? WHERE workspace_id = ?
    `).run('enterprise-workspace:wrong', 'workspace-corrupt');
    db.pragma('ignore_check_constraints = OFF');
    expectFixedCorruption(() => store.reconcileWorkspace('workspace-corrupt'));
  });

  test('requeues completed current revisions only when state is missing or behind without rewriting history', () => {
    const db = openDatabase();
    createWorkspaceRevisionTable(db);
    seedWorkspaceRevision(db, 'workspace-behind', 3);
    seedWorkspaceRevision(db, 'workspace-missing-state', 1);
    const store = new KnowledgeTrustedProfileIndexStore(db);
    for (const revision of [1, 2, 3]) {
      store.enqueue({
        workspaceId: 'workspace-behind',
        profileRevision: revision,
        now: `2026-07-13T00:0${revision}:00.000Z`,
      });
    }
    for (const revision of [1, 2, 3]) {
      const claim = store.claimNext(`2026-07-13T01:0${revision}:00.000Z`)!;
      expect(claim.job.profileRevision).toBe(revision);
      expect(store.completeAttempt(
        claim.job.id,
        claim.attempt.id,
        `2026-07-13T02:0${revision}:00.000Z`,
      )).toBe(true);
    }
    const currentJob = store.getJob('workspace-behind', 3)!;
    const attemptsBefore = store.listAttempts(currentJob.id);
    db.prepare(`
      UPDATE knowledge_trusted_profile_index_state
      SET indexed_profile_revision = 2, indexed_at = ?
      WHERE workspace_id = ?
    `).run('2026-07-13T02:02:00.000Z', 'workspace-behind');

    expect(store.reconcileWorkspace(
      'workspace-behind',
      '2026-07-13T03:00:00.000Z',
    )).toMatchObject({
      inserted: false,
      job: {
        id: currentJob.id,
        status: KnowledgeTrustedIndexRefreshStatus.Queued,
        attemptCount: 1,
      },
    });
    expect(store.listAttempts(currentJob.id)).toEqual(attemptsBefore);
    expect(store.getState('workspace-behind')).toMatchObject({
      indexedProfileRevision: 2,
      indexedAt: '2026-07-13T02:02:00.000Z',
    });

    store.enqueue({
      workspaceId: 'workspace-missing-state',
      profileRevision: 1,
      now: '2026-07-13T02:59:00.000Z',
    });
    const missingClaim = store.claimNext('2026-07-13T03:01:00.000Z')!;
    expect(store.completeAttempt(
      missingClaim.job.id,
      missingClaim.attempt.id,
      '2026-07-13T03:02:00.000Z',
    )).toBe(true);
    const missingAttempts = store.listAttempts(missingClaim.job.id);
    db.prepare(`
      DELETE FROM knowledge_trusted_profile_index_state WHERE workspace_id = ?
    `).run('workspace-missing-state');
    expect(store.reconcileWorkspace(
      'workspace-missing-state',
      '2026-07-13T03:03:00.000Z',
    )).toMatchObject({
      inserted: false,
      job: { status: KnowledgeTrustedIndexRefreshStatus.Queued },
    });
    expect(store.listAttempts(missingClaim.job.id)).toEqual(missingAttempts);
    expect(store.getState('workspace-missing-state')).toBeNull();
  });

  test('rolls back every reconciliation when a later workspace transition fails', () => {
    const db = openDatabase();
    createWorkspaceRevisionTable(db);
    seedWorkspaceRevision(db, 'workspace-reconcile-a', 1);
    seedWorkspaceRevision(db, 'workspace-reconcile-b', 1);
    const store = new KnowledgeTrustedProfileIndexStore(db);
    for (const workspaceId of ['workspace-reconcile-a', 'workspace-reconcile-b']) {
      store.enqueue({ workspaceId, profileRevision: 1 });
      const claim = store.claimNext()!;
      expect(store.failAttempt(claim.job.id, claim.attempt.id)).toBe(true);
    }
    db.exec(`
      CREATE TRIGGER task10_fail_late_reconcile
      BEFORE UPDATE ON knowledge_trusted_profile_index_jobs
      WHEN OLD.workspace_id = 'workspace-reconcile-b' AND NEW.status = 'queued'
      BEGIN
        SELECT RAISE(ABORT, 'injected reconcile failure');
      END;
    `);

    expect(() => store.reconcileAll('2026-07-13T04:00:00.000Z')).toThrow();
    expect(store.getJob('workspace-reconcile-a', 1)?.status)
      .toBe(KnowledgeTrustedIndexRefreshStatus.Failed);
    expect(store.getJob('workspace-reconcile-b', 1)?.status)
      .toBe(KnowledgeTrustedIndexRefreshStatus.Failed);
  });

  test('completeAttempt hard-fails scope, state-ahead, and job-ahead corruption with zero writes', () => {
    const runCorruptionCase = (
      workspaceId: string,
      workspaceRevision: number,
      jobRevision: number,
      corrupt: (db: Database.Database, jobId: string) => void,
    ): void => {
      const db = openDatabase();
      createWorkspaceRevisionTable(db);
      seedWorkspaceRevision(db, workspaceId, workspaceRevision);
      const store = new KnowledgeTrustedProfileIndexStore(db);
      store.enqueue({ workspaceId, profileRevision: jobRevision });
      const claim = store.claimNext('2026-07-13T05:00:00.000Z')!;
      corrupt(db, claim.job.id);
      const before = {
        job: db.prepare(`
          SELECT * FROM knowledge_trusted_profile_index_jobs WHERE id = ?
        `).get(claim.job.id),
        attempt: db.prepare(`
          SELECT * FROM knowledge_trusted_profile_index_attempts WHERE id = ?
        `).get(claim.attempt.id),
        state: db.prepare(`
          SELECT * FROM knowledge_trusted_profile_index_state WHERE workspace_id = ?
        `).get(workspaceId),
      };

      expectFixedCorruption(() => store.completeAttempt(
        claim.job.id,
        claim.attempt.id,
        '2026-07-13T05:01:00.000Z',
      ));
      expect({
        job: db.prepare(`
          SELECT * FROM knowledge_trusted_profile_index_jobs WHERE id = ?
        `).get(claim.job.id),
        attempt: db.prepare(`
          SELECT * FROM knowledge_trusted_profile_index_attempts WHERE id = ?
        `).get(claim.attempt.id),
        state: db.prepare(`
          SELECT * FROM knowledge_trusted_profile_index_state WHERE workspace_id = ?
        `).get(workspaceId),
      }).toEqual(before);
    };

    runCorruptionCase('workspace-scope-corrupt', 1, 1, (db, jobId) => {
      db.prepare(`
        UPDATE knowledge_trusted_profile_index_jobs SET scope_id = ? WHERE id = ?
      `).run('enterprise-workspace:wrong', jobId);
    });
    runCorruptionCase('workspace-state-ahead', 2, 2, db => {
      db.prepare(`
        INSERT INTO knowledge_trusted_profile_index_state (
          workspace_id, scope_id, indexed_profile_revision, indexed_at
        ) VALUES (?, ?, 3, ?)
      `).run(
        'workspace-state-ahead',
        buildEnterpriseLeadWorkspaceKnowledgeScopeId('workspace-state-ahead'),
        '2026-07-13T04:00:00.000Z',
      );
    });
    runCorruptionCase('workspace-job-ahead', 1, 2, () => undefined);
  });

  test('keeps terminal job and attempt rows byte-stable across repeated terminal operations and recovery', () => {
    const db = openDatabase();
    createWorkspaceRevisionTable(db);
    seedWorkspaceRevision(db, 'workspace-terminal', 1);
    const store = new KnowledgeTrustedProfileIndexStore(db);
    store.enqueue({ workspaceId: 'workspace-terminal', profileRevision: 1 });
    const claim = store.claimNext('2026-07-13T06:00:00.000Z')!;
    expect(store.completeAttempt(
      claim.job.id,
      claim.attempt.id,
      '2026-07-13T06:01:00.000Z',
    )).toBe(true);
    const before = {
      job: db.prepare(`
        SELECT * FROM knowledge_trusted_profile_index_jobs WHERE id = ?
      `).get(claim.job.id),
      attempt: db.prepare(`
        SELECT * FROM knowledge_trusted_profile_index_attempts WHERE id = ?
      `).get(claim.attempt.id),
    };

    expect(store.completeAttempt(claim.job.id, claim.attempt.id)).toBe(false);
    expect(store.failAttempt(claim.job.id, claim.attempt.id)).toBe(false);
    expect(store.recoverAbandonedRunning()).toBe(0);
    expect({
      job: db.prepare(`
        SELECT * FROM knowledge_trusted_profile_index_jobs WHERE id = ?
      `).get(claim.job.id),
      attempt: db.prepare(`
        SELECT * FROM knowledge_trusted_profile_index_attempts WHERE id = ?
      `).get(claim.attempt.id),
    }).toEqual(before);
  });

  test('retries a WAL loser against a fresh snapshot without exposing busy or unique failures', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-profile-claim-wal-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'trusted.sqlite');
    const firstDb = openDatabase(databasePath);
    firstDb.pragma('journal_mode = WAL');
    createWorkspaceRevisionTable(firstDb);
    seedWorkspaceRevision(firstDb, 'workspace-wal-a', 1);
    seedWorkspaceRevision(firstDb, 'workspace-wal-b', 1);
    const first = new KnowledgeTrustedProfileIndexStore(firstDb);
    const secondDb = openDatabase(databasePath);
    secondDb.pragma('journal_mode = WAL');
    const second = new KnowledgeTrustedProfileIndexStore(secondDb);
    first.enqueue({
      workspaceId: 'workspace-wal-a',
      profileRevision: 1,
      now: '2026-07-13T00:00:00.000Z',
    });
    first.enqueue({
      workspaceId: 'workspace-wal-b',
      profileRevision: 1,
      now: '2026-07-13T00:01:00.000Z',
    });

    let transactionAttempts = 0;
    let winner: ReturnType<KnowledgeTrustedProfileIndexStore['claimNext']> = null;
    const contender = new KnowledgeTrustedProfileIndexStore(firstDb, {
      beforeClaimTransactionAttempt: () => {
        transactionAttempts += 1;
        if (transactionAttempts === 1) {
          winner = second.claimNext('2026-07-13T01:00:00.000Z');
          throw Object.assign(new Error('raw SQLITE_BUSY_SNAPSHOT secret'), {
            code: 'SQLITE_BUSY_SNAPSHOT',
          });
        }
      },
    } as never);
    let loserResult: unknown;
    let loserError: unknown;
    try {
      loserResult = contender.claimNext('2026-07-13T01:00:00.000Z');
    } catch (error) {
      loserError = error;
    }

    expect(winner).not.toBeNull();
    expect(loserResult).toBeNull();
    expect(loserError).toBeUndefined();
    expect(transactionAttempts).toBe(2);
    expect(JSON.stringify(loserResult)).not.toMatch(/BUSY|UNIQUE|SQLITE/i);
  });

  test('maps exhausted real WAL contention to one safe retry signal before a fresh claim', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-profile-real-lock-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'trusted.sqlite');
    const lockDb = openDatabase(databasePath);
    lockDb.pragma('journal_mode = WAL');
    lockDb.pragma('busy_timeout = 0');
    createWorkspaceRevisionTable(lockDb);
    seedWorkspaceRevision(lockDb, 'workspace-real-lock', 1);
    const lockStore = new KnowledgeTrustedProfileIndexStore(lockDb);
    lockStore.enqueue({ workspaceId: 'workspace-real-lock', profileRevision: 1 });
    const contenderDb = openDatabase(databasePath);
    contenderDb.pragma('journal_mode = WAL');
    contenderDb.pragma('busy_timeout = 0');
    const contender = new KnowledgeTrustedProfileIndexStore(contenderDb);
    let thrown: unknown;
    const holdLock = lockDb.transaction(() => {
      try {
        contender.claimNext('2026-07-13T07:00:00.000Z');
      } catch (error) {
        thrown = error;
      }
    });

    holdLock.immediate();

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe('KnowledgeTrustedProfileIndexRetryRequiredError');
    expect(String(thrown)).toBe(
      'KnowledgeTrustedProfileIndexRetryRequiredError: Trusted profile index operation should be retried',
    );
    expect(JSON.stringify(thrown)).not.toMatch(/SQLITE|BUSY|locked|UNIQUE|database is/i);
    expect(thrown).not.toHaveProperty('code');
    expect(thrown).not.toHaveProperty('cause');

    const freshClaim = contender.claimNext('2026-07-13T07:01:00.000Z');
    expect(freshClaim).not.toBeNull();
    expect(freshClaim?.job.workspaceId).toBe('workspace-real-lock');
  });
});
