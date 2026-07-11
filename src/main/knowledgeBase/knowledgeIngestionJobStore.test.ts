import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  KnowledgeIngestionAttemptOutcome,
  KnowledgeIngestionJobStatus,
  KnowledgeIngestionStage,
} from '../../shared/knowledgeBase/constants';
import { KnowledgeIngestionJobStore } from './knowledgeIngestionJobStore';

const jobInput = (documentVersionId = 'version-a') => ({
  workspaceId: 'workspace-a',
  documentId: 'document-a',
  documentVersionId,
});

describe('KnowledgeIngestionJobStore', () => {
  let db: Database.Database;
  let store: KnowledgeIngestionJobStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new KnowledgeIngestionJobStore(db);
  });

  afterEach(() => {
    db.close();
  });

  test('claims a queued job and records a running attempt', () => {
    const job = store.createJob(jobInput(), '2026-07-11T01:00:00.000Z');
    const claim = store.claimNextJob('2026-07-11T01:01:00.000Z');

    expect(claim?.job.id).toBe(job.id);
    expect(claim?.job.status).toBe(KnowledgeIngestionJobStatus.Running);
    expect(claim?.job.stage).toBe(KnowledgeIngestionStage.Queued);
    expect(claim?.attempt.attemptNumber).toBe(1);
    expect(store.listAttempts(job.id)[0]?.outcome).toBe(
      KnowledgeIngestionAttemptOutcome.Running,
    );
  });

  test('updates heartbeat progress and completes the active attempt', () => {
    const job = store.createJob(jobInput(), '2026-07-11T01:00:00.000Z');
    const claim = store.claimNextJob('2026-07-11T01:01:00.000Z');
    expect(claim).not.toBeNull();

    const heartbeat = store.heartbeat(
      job.id,
      claim!.attempt.id,
      1.8,
      '2026-07-11T01:02:00.000Z',
    );
    expect(heartbeat.progress).toBe(1);

    const completed = store.complete(
      job.id,
      claim!.attempt.id,
      '2026-07-11T01:03:00.000Z',
    );
    expect(completed.status).toBe(KnowledgeIngestionJobStatus.Completed);
    expect(store.listAttempts(job.id)[0]?.outcome).toBe(
      KnowledgeIngestionAttemptOutcome.Completed,
    );
  });

  test('updates the durable stage only for the active attempt', () => {
    const job = store.createJob(jobInput(), '2026-07-11T01:00:00.000Z');
    const claim = store.claimNextJob('2026-07-11T01:01:00.000Z');

    const parsing = store.updateStage(
      job.id,
      claim!.attempt.id,
      KnowledgeIngestionStage.Parsing,
      '2026-07-11T01:02:00.000Z',
    );

    expect(parsing).toMatchObject({
      progress: 0,
      stage: KnowledgeIngestionStage.Parsing,
      status: KnowledgeIngestionJobStatus.Running,
    });
  });

  test('fails, retries, and preserves prior attempt history', () => {
    const job = store.createJob(jobInput(), '2026-07-11T01:00:00.000Z');
    const firstClaim = store.claimNextJob('2026-07-11T01:01:00.000Z');
    expect(firstClaim).not.toBeNull();
    store.fail(
      job.id,
      firstClaim!.attempt.id,
      { code: 'parser_failed', message: 'Parser failed safely' },
      '2026-07-11T01:02:00.000Z',
    );

    store.retry(job.id, '2026-07-11T01:03:00.000Z');
    const secondClaim = store.claimNextJob('2026-07-11T01:04:00.000Z');

    expect(secondClaim?.attempt.attemptNumber).toBe(2);
    expect(store.listAttempts(job.id).map(attempt => attempt.outcome)).toEqual([
      KnowledgeIngestionAttemptOutcome.Failed,
      KnowledgeIngestionAttemptOutcome.Running,
    ]);
  });

  test('cancels a running job and its active attempt', () => {
    const job = store.createJob(jobInput(), '2026-07-11T01:00:00.000Z');
    store.claimNextJob('2026-07-11T01:01:00.000Z');

    const cancelled = store.cancel(job.id, '2026-07-11T01:02:00.000Z');

    expect(cancelled.status).toBe(KnowledgeIngestionJobStatus.Cancelled);
    expect(store.listAttempts(job.id)[0]?.outcome).toBe(
      KnowledgeIngestionAttemptOutcome.Cancelled,
    );
  });

  test('recovers stale running jobs without erasing the abandoned attempt', () => {
    const job = store.createJob(jobInput(), '2026-07-11T01:00:00.000Z');
    store.claimNextJob('2026-07-11T01:01:00.000Z');

    expect(
      store.recoverAbandonedJobs(
        '2026-07-11T01:05:00.000Z',
        '2026-07-11T01:10:00.000Z',
      ),
    ).toBe(1);
    expect(store.getJob(job.id)?.status).toBe(KnowledgeIngestionJobStatus.Queued);
    expect(store.listAttempts(job.id)[0]?.outcome).toBe(
      KnowledgeIngestionAttemptOutcome.Abandoned,
    );
  });

  test('prevents multiple active jobs for one document version', () => {
    store.createJob(jobInput(), '2026-07-11T01:00:00.000Z');

    expect(() =>
      store.createJob(jobInput(), '2026-07-11T01:01:00.000Z'),
    ).toThrow();
  });

  test('returns the latest job for each document version without N plus one queries', () => {
    const first = store.createJob(jobInput(), '2026-07-11T01:00:00.000Z');
    const claim = store.claimNextJob('2026-07-11T01:01:00.000Z');
    store.complete(first.id, claim!.attempt.id, '2026-07-11T01:02:00.000Z');
    const latest = store.createJob(jobInput(), '2026-07-11T01:03:00.000Z');
    const other = store.createJob(
      { ...jobInput('version-b'), documentId: 'document-b' },
      '2026-07-11T01:04:00.000Z',
    );
    store.createJob(
      {
        documentId: 'document-c',
        documentVersionId: 'version-c',
        workspaceId: 'workspace-b',
      },
      '2026-07-11T01:05:00.000Z',
    );

    expect(store.getCurrentJob('document-a', 'version-a')?.id).toBe(latest.id);
    expect(store.listCurrentJobs('workspace-a').map(job => job.id).sort()).toEqual(
      [latest.id, other.id].sort(),
    );
  });

  test('cancels only queued jobs for one document', () => {
    const queued = store.createJob(jobInput(), '2026-07-11T01:00:00.000Z');
    const running = store.createJob(
      { ...jobInput('version-b'), documentId: 'document-b' },
      '2026-07-11T01:01:00.000Z',
    );
    const runningClaim = store.claimNextJob('2026-07-11T01:02:00.000Z');
    expect(runningClaim?.job.id).toBe(queued.id);
    store.cancel(queued.id, '2026-07-11T01:03:00.000Z');
    const secondClaim = store.claimNextJob('2026-07-11T01:04:00.000Z');
    expect(secondClaim?.job.id).toBe(running.id);
    const nextQueued = store.createJob(
      { ...jobInput('version-c'), documentId: 'document-a' },
      '2026-07-11T01:05:00.000Z',
    );

    expect(store.cancelQueuedJobsForDocument('document-a', '2026-07-11T01:06:00.000Z')).toBe(1);
    expect(store.getJob(nextQueued.id)?.status).toBe(KnowledgeIngestionJobStatus.Cancelled);
    expect(store.getJob(running.id)?.status).toBe(KnowledgeIngestionJobStatus.Running);
    expect(store.listAttempts(running.id)[0]?.outcome).toBe(
      KnowledgeIngestionAttemptOutcome.Running,
    );
  });
});
