import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { EnterpriseLeadDocumentExtractionStatus } from '../../shared/enterpriseLeadWorkspace/constants';
import {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentIndexTokenizer,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeIngestionAttemptOutcome,
  KnowledgeIngestionJobStatus,
} from '../../shared/knowledgeBase/constants';
import { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import { applySqliteConnectionPolicy } from '../libs/sqliteConnectionPolicy';
import { EnterpriseLeadKnowledgeCompatibilityAdapter } from './enterpriseLeadKnowledgeCompatibilityAdapter';
import { KnowledgeDocumentIndexStore } from './knowledgeDocumentIndexStore';
import { KnowledgeDocumentService } from './knowledgeDocumentService';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';
import { KnowledgeIngestionJobStore } from './knowledgeIngestionJobStore';
import { KnowledgeIngestionService } from './knowledgeIngestionService';
import { KnowledgeManagedFileStore } from './knowledgeManagedFileStore';
import { KnowledgeSelectionTokenStore } from './knowledgeSelectionTokenStore';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(innerResolve => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};

const ensureIngestionWorkspace = (db: Database.Database): void => {
  new EnterpriseLeadWorkspaceStore(db);
  db.prepare(`
    INSERT INTO enterprise_lead_workspaces (
      id, name, type, profile, extraction_sources, risk_rules,
      enabled_agent_roles, settings, workspace_agents, recent_run_id,
      created_at, updated_at
    ) VALUES (
      'workspace-a', 'workspace-a', 'enterprise_lead', '{}', '[]', '[]',
      '[]', NULL, NULL, NULL, '2026-07-11T00:00:00.000Z',
      '2026-07-11T00:00:00.000Z'
    )
  `).run();
};

const createQueuedDocumentForStores = async (input: {
  documentStore: KnowledgeDocumentStore;
  jobStore: KnowledgeIngestionJobStore;
  managedFileStore: KnowledgeManagedFileStore;
  displayName: string;
  createdAt?: string;
}) => {
  const blob = await input.managedFileStore.importTextSnapshot(`bytes:${input.displayName}`);
  const created = input.documentStore.createDocumentWithVersion({
    workspaceId: 'workspace-a',
    displayName: input.displayName,
    sourceMode: KnowledgeDocumentSourceMode.Managed,
    status: KnowledgeDocumentStatus.Pending,
    version: {
      contentHash: blob.contentHash,
      managedPath: blob.managedPath,
      mimeType: input.displayName.endsWith('.png') ? 'image/png' : 'application/pdf',
      fileSize: blob.fileSize,
      sourceMtime: 100,
      parser: null,
      extractedText: null,
      extractionPartial: false,
    },
  });
  const job = input.jobStore.createJob(
    {
      workspaceId: 'workspace-a',
      documentId: created.document.id,
      documentVersionId: created.version.id,
    },
    input.createdAt,
  );
  return { ...created, job };
};

const createFileBackedIngestionFixture = async () => {
  const tempDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'knowledge-ingestion-contention-'),
  );
  const databasePath = path.join(tempDirectory, 'knowledge.sqlite');
  const db = new Database(databasePath);
  applySqliteConnectionPolicy(db);
  ensureIngestionWorkspace(db);
  const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
  const documentStore = new KnowledgeDocumentStore(db);
  const indexStore = new KnowledgeDocumentIndexStore(db, {
    resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
  });
  const jobStore = new KnowledgeIngestionJobStore(db);
  const managedFileStore = new KnowledgeManagedFileStore(
    path.join(tempDirectory, 'managed'),
  );
  db.exec(`
    CREATE TABLE ingestion_contention_probe (value INTEGER NOT NULL);
    INSERT INTO ingestion_contention_probe (value) VALUES (0);
  `);
  const competingDb = new Database(databasePath);
  applySqliteConnectionPolicy(competingDb);
  competingDb.pragma('busy_timeout = 0');
  const updateProbe = competingDb.prepare(
    'UPDATE ingestion_contention_probe SET value = value + 1',
  );
  return {
    db,
    workspaceStore,
    documentStore,
    indexStore,
    jobStore,
    managedFileStore,
    updateProbe,
    close: async (): Promise<void> => {
      competingDb.close();
      db.close();
      await fs.rm(tempDirectory, { recursive: true, force: true });
    },
  };
};

describe('KnowledgeIngestionService', () => {
  let db: Database.Database;
  let documentStore: KnowledgeDocumentStore;
  let indexStore: KnowledgeDocumentIndexStore;
  let jobStore: KnowledgeIngestionJobStore;
  let managedFileStore: KnowledgeManagedFileStore;
  let managedRoot: string;

  beforeEach(() => {
    db = new Database(':memory:');
    ensureIngestionWorkspace(db);
    documentStore = new KnowledgeDocumentStore(db);
    indexStore = new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });
    jobStore = new KnowledgeIngestionJobStore(db);
    managedRoot = path.join(os.tmpdir(), `knowledge-ingestion-${randomUUID()}`);
    managedFileStore = new KnowledgeManagedFileStore(managedRoot);
  });

  afterEach(async () => {
    db.close();
    await fs.rm(managedRoot, { recursive: true, force: true });
  });

  const createQueuedDocument = async (
    displayName: string,
    createdAt = '2026-07-11T01:00:00.000Z',
  ) => createQueuedDocumentForStores({
    documentStore,
    jobStore,
    managedFileStore,
    displayName,
    createdAt,
  });

  test('drains a queued job and commits local text to the exact current version', async () => {
    const created = await createQueuedDocument('manual.pdf');
    const extractDocumentText = vi.fn().mockResolvedValue({
      content: 'local text',
      parser: 'pdf',
      truncated: true,
    });
    const updateCompatibilityProjectionInCurrentTransaction = vi.fn(() => {
      expect(db.inTransaction).toBe(true);
    });
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      indexStore,
      extractDocumentText,
      updateCompatibilityProjectionInCurrentTransaction,
    });

    service.wake();
    await service.waitForIdle();

    expect(extractDocumentText).toHaveBeenCalledWith(
      expect.stringContaining(created.version.managedPath!),
      expect.objectContaining({ extensionHint: '.pdf' }),
    );
    expect(documentStore.getVersion(created.version.id)).toMatchObject({
      extractedText: 'local text',
      extractionPartial: true,
      parser: 'pdf',
    });
    expect(documentStore.getDocument(created.document.id)?.status).toBe(
      KnowledgeDocumentStatus.Ready,
    );
    expect(jobStore.getJob(created.job.id)?.status).toBe(
      KnowledgeIngestionJobStatus.Completed,
    );
    expect(updateCompatibilityProjectionInCurrentTransaction).toHaveBeenCalledWith(
      'workspace-a',
      created.document.id,
    );
  });

  test('publishes ready raw sources with one targeted post-commit callback per ingestion job', async () => {
    const targets = [];
    for (let index = 0; index < 1_000; index += 1) {
      targets.push(await createQueuedDocument(`linear-${index}.pdf`, new Date(
        Date.parse('2026-07-11T01:00:00.000Z') + index,
      ).toISOString()));
    }
    const replaceWorkspaceDocumentSource = vi.fn(() => {
      expect(db.inTransaction).toBe(false);
    });
    const replaceWorkspaceDocumentSources = vi.fn();
    const onIndexQueued = vi.fn(() => expect(db.inTransaction).toBe(false));
    const prepare = vi.spyOn(db, 'prepare');
    let eventLoopYielded = false;
    setTimeout(() => {
      eventLoopYielded = true;
    }, 0);
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      indexStore,
      extractDocumentText: vi.fn(async managedPath => ({
        content: `ready:${managedPath}`,
        parser: 'pdf',
        truncated: false,
      })),
      replaceWorkspaceDocumentSource,
      replaceWorkspaceDocumentSources,
      onIndexQueued,
    });

    service.wake();
    await service.waitForIdle();

    expect(replaceWorkspaceDocumentSource).toHaveBeenCalledTimes(1_000);
    expect(new Set(replaceWorkspaceDocumentSource.mock.calls.map(call => call[1])).size).toBe(1_000);
    expect(replaceWorkspaceDocumentSource.mock.calls.every(call => call[0] === 'workspace-a'))
      .toBe(true);
    expect(replaceWorkspaceDocumentSources).not.toHaveBeenCalled();
    expect(prepare.mock.calls.length).toBeLessThanOrEqual((80 * targets.length) + 200);
    expect(onIndexQueued).toHaveBeenCalledTimes(1);
    expect(eventLoopYielded).toBe(true);
    expect(targets.every(target =>
      documentStore.getDocument(target.document.id)?.status === KnowledgeDocumentStatus.Ready))
      .toBe(true);
  }, 30_000);

  test('commits extraction, job, local index, and compatibility projection in one transaction', async () => {
    const created = await createQueuedDocument('compatibility-atomic.pdf');
    const updateCompatibilityProjectionInCurrentTransaction = vi.fn(() => {
      expect(db.inTransaction).toBe(true);
      throw new Error('SECRET compatibility SQL /private/path');
    });
    const replaceWorkspaceDocumentSource = vi.fn();
    const onIndexQueued = vi.fn();
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      indexStore,
      extractDocumentText: vi.fn().mockResolvedValue({
        content: 'must not partially publish',
        parser: 'pdf',
        truncated: false,
      }),
      updateCompatibilityProjectionInCurrentTransaction,
      replaceWorkspaceDocumentSource,
      onIndexQueued,
    } as ConstructorParameters<typeof KnowledgeIngestionService>[0]);

    service.wake();
    await service.waitForIdle();

    expect(updateCompatibilityProjectionInCurrentTransaction).toHaveBeenCalledTimes(2);
    expect(documentStore.getVersion(created.version.id)).toMatchObject({
      extractedText: null,
      parser: null,
    });
    expect(documentStore.getDocument(created.document.id)?.status).toBe(
      KnowledgeDocumentStatus.Failed,
    );
    expect(jobStore.getJob(created.job.id)?.status).toBe(KnowledgeIngestionJobStatus.Failed);
    expect(indexStore.getState(created.version.id)).toBeNull();
    expect(replaceWorkspaceDocumentSource).not.toHaveBeenCalled();
    expect(onIndexQueued).not.toHaveBeenCalled();
  });

  test('seals ingestion synchronously and shares shutdown while active extraction settles durably', async () => {
    const created = await createQueuedDocument('shutdown-active.pdf');
    const extraction = deferred<{
      content: string;
      parser: string;
      truncated: boolean;
    }>();
    const replaceWorkspaceDocumentSource = vi.fn();
    const onIndexQueued = vi.fn();
    const extractDocumentText = vi.fn(() => extraction.promise);
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      indexStore,
      extractDocumentText,
      replaceWorkspaceDocumentSource,
      onIndexQueued,
    });
    service.wake();
    for (let attempt = 0; attempt < 20 && extractDocumentText.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(extractDocumentText).toHaveBeenCalledTimes(1);

    const firstShutdown = service.shutdown();
    const secondShutdown = service.shutdown();
    expect(secondShutdown).toBe(firstShutdown);
    service.wake();
    extraction.resolve({ content: 'late content', parser: 'pdf', truncated: false });
    await firstShutdown;

    expect(jobStore.getJob(created.job.id)).toMatchObject({
      status: KnowledgeIngestionJobStatus.Running,
    });
    expect(replaceWorkspaceDocumentSource).not.toHaveBeenCalled();
    expect(onIndexQueued).not.toHaveBeenCalled();
    expect(indexStore.getState(created.version.id)).toBeNull();
  });

  test('shutdown aborts claim BUSY backoff and permits no database access after close', async () => {
    const claimNext = vi.spyOn(jobStore, 'claimNextJob').mockImplementation(() => {
      throw Object.assign(new Error('SECRET busy SQL'), { code: 'SQLITE_BUSY' });
    });
    const retrySignals: AbortSignal[] = [];
    const busyRetryDelay = vi.fn((_delayMs: number, signal?: AbortSignal) => {
      if (signal) retrySignals.push(signal);
      return new Promise<void>((resolve, reject) => {
        if (!signal) return;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        if (signal.aborted) reject(signal.reason);
        void resolve;
      });
    });
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      indexStore,
      extractDocumentText: vi.fn(),
      busyRetryDelay,
    } as ConstructorParameters<typeof KnowledgeIngestionService>[0]);
    service.wake();
    for (let attempt = 0; attempt < 50 && busyRetryDelay.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(busyRetryDelay.mock.calls.length).toBeGreaterThan(0);

    const first = service.shutdown();
    const second = service.shutdown();
    expect(second).toBe(first);
    expect(retrySignals.length).toBeGreaterThan(0);
    expect(retrySignals.every(signal => signal.aborted)).toBe(true);
    await first;
    const claimCountAtShutdown = claimNext.mock.calls.length;
    db.close();
    service.wake();
    await service.waitForIdle();
    expect(claimNext).toHaveBeenCalledTimes(claimCountAtShutdown);
    db = new Database(':memory:');
  });

  test('default BUSY backoff removes listeners and timers across consecutive retries', async () => {
    vi.useFakeTimers();
    try {
      const service = new KnowledgeIngestionService({
        db,
        documentStore,
        jobStore,
        managedFileStore,
        indexStore,
        extractDocumentText: vi.fn(),
      });
      const internal = service as unknown as {
        shutdownController: AbortController;
        waitForBusyRetry(delayMs: number): Promise<void>;
      };
      const addListener = vi.spyOn(internal.shutdownController.signal, 'addEventListener');
      const removeListener = vi.spyOn(internal.shutdownController.signal, 'removeEventListener');
      const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
      const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});

      for (let retry = 0; retry < 12; retry += 1) {
        const pending = internal.waitForBusyRetry(25);
        await vi.advanceTimersByTimeAsync(25);
        await pending;
      }

      expect(addListener).toHaveBeenCalledTimes(12);
      expect(removeListener).toHaveBeenCalledTimes(12);
      expect(clearTimer).toHaveBeenCalledTimes(12);
      expect(emitWarning).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  test('default BUSY backoff shutdown clears its timer and listener exactly once', async () => {
    vi.useFakeTimers();
    try {
      const service = new KnowledgeIngestionService({
        db,
        documentStore,
        jobStore,
        managedFileStore,
        indexStore,
        extractDocumentText: vi.fn(),
      });
      const internal = service as unknown as {
        shutdownController: AbortController;
        waitForBusyRetry(delayMs: number): Promise<void>;
      };
      const removeListener = vi.spyOn(internal.shutdownController.signal, 'removeEventListener');
      const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
      const pending = internal.waitForBusyRetry(1_000);

      const shutdown = service.shutdown();
      await expect(pending).rejects.toBeDefined();
      await shutdown;

      expect(removeListener).toHaveBeenCalledTimes(1);
      expect(clearTimer).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  test('shutdown leaves OCR waiters durable and never starts the next queued image', async () => {
    const first = await createQueuedDocument('shutdown-first.png', '2026-07-11T01:00:00.000Z');
    const second = await createQueuedDocument('shutdown-second.png', '2026-07-11T01:00:01.000Z');
    const extraction = deferred<{ content: string; parser: string; truncated: boolean }>();
    const extractDocumentText = vi.fn(() => extraction.promise);
    const replaceWorkspaceDocumentSource = vi.fn();
    const onIndexQueued = vi.fn();
    const claimNext = vi.spyOn(jobStore, 'claimNextJob');
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      indexStore,
      extractDocumentText,
      replaceWorkspaceDocumentSource,
      onIndexQueued,
    } as ConstructorParameters<typeof KnowledgeIngestionService>[0]);
    service.wake();
    for (let attempt = 0; attempt < 50 && extractDocumentText.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(extractDocumentText).toHaveBeenCalledTimes(1);

    const shutdown = service.shutdown();
    const claimCountAtShutdown = claimNext.mock.calls.length;
    extraction.resolve({ content: 'late OCR', parser: 'ocr', truncated: false });
    await shutdown;

    expect(extractDocumentText).toHaveBeenCalledTimes(1);
    expect(jobStore.getJob(first.job.id)?.status).toBe(KnowledgeIngestionJobStatus.Running);
    expect([
      KnowledgeIngestionJobStatus.Queued,
      KnowledgeIngestionJobStatus.Running,
    ]).toContain(jobStore.getJob(second.job.id)?.status);
    expect(documentStore.getVersion(second.version.id)?.extractedText).toBeNull();
    expect(indexStore.getState(first.version.id)).toBeNull();
    expect(indexStore.getState(second.version.id)).toBeNull();
    expect(replaceWorkspaceDocumentSource).not.toHaveBeenCalled();
    expect(onIndexQueued).not.toHaveBeenCalled();
    expect(claimNext).toHaveBeenCalledTimes(claimCountAtShutdown);
  });

  test('awaits an already-started raw publication but suppresses every later wake while closing', async () => {
    const created = await createQueuedDocument('shutdown-vector.pdf');
    const vectorGate = deferred<void>();
    const replaceWorkspaceDocumentSource = vi.fn(() => {
      expect(db.inTransaction).toBe(false);
      return vectorGate.promise;
    });
    const onIndexQueued = vi.fn(() => expect(db.inTransaction).toBe(false));
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      indexStore,
      extractDocumentText: vi.fn().mockResolvedValue({
        content: 'ready before vector gate',
        parser: 'pdf',
        truncated: false,
      }),
      replaceWorkspaceDocumentSource,
      onIndexQueued,
    } as ConstructorParameters<typeof KnowledgeIngestionService>[0]);
    service.wake();
    await vi.waitFor(() => expect(replaceWorkspaceDocumentSource).toHaveBeenCalledTimes(1));
    expect(jobStore.getJob(created.job.id)?.status).toBe(KnowledgeIngestionJobStatus.Completed);
    expect(indexStore.getState(created.version.id)?.status).toBe(KnowledgeDocumentIndexStatus.Pending);

    let shutdownCompleted = false;
    const shutdown = service.shutdown();
    void shutdown.then(() => { shutdownCompleted = true; });
    await Promise.resolve();
    expect(shutdownCompleted).toBe(false);
    expect(onIndexQueued).not.toHaveBeenCalled();

    vectorGate.resolve();
    await shutdown;
    expect(onIndexQueued).not.toHaveBeenCalled();
  });

  test('marks an empty successful parse as completed without text', async () => {
    const created = await createQueuedDocument('empty.pdf');
    const replaceWorkspaceDocumentSource = vi.fn();
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      indexStore,
      extractDocumentText: vi.fn().mockResolvedValue({
        content: '   ',
        parser: 'pdf',
        truncated: false,
      }),
      replaceWorkspaceDocumentSource,
    });

    service.wake();
    await service.waitForIdle();

    expect(documentStore.getDocument(created.document.id)?.status).toBe(
      KnowledgeDocumentStatus.CompletedWithoutText,
    );
    expect(jobStore.getJob(created.job.id)?.status).toBe(
      KnowledgeIngestionJobStatus.Completed,
    );
    expect(replaceWorkspaceDocumentSource).not.toHaveBeenCalled();
  });

  test('stores only a stable sanitized failure when local extraction throws', async () => {
    const created = await createQueuedDocument('broken.pdf');
    const replaceWorkspaceDocumentSource = vi.fn();
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      indexStore,
      extractDocumentText: vi.fn().mockRejectedValue(
        new Error('/private/customer/secret.pdf parser stack detail'),
      ),
      replaceWorkspaceDocumentSource,
    });

    service.wake();
    await service.waitForIdle();

    expect(documentStore.getDocument(created.document.id)?.status).toBe(
      KnowledgeDocumentStatus.Failed,
    );
    expect(jobStore.getJob(created.job.id)).toMatchObject({
      errorCode: KnowledgeBaseErrorCode.IngestionFailed,
      errorMessage: 'Local document extraction failed',
      status: KnowledgeIngestionJobStatus.Failed,
    });
    expect(replaceWorkspaceDocumentSource).not.toHaveBeenCalled();
  });

  test('does not commit output after the document is deleted during extraction', async () => {
    const created = await createQueuedDocument('deleted.pdf');
    const extraction = deferred<{ content: string; parser: string; truncated: boolean }>();
    const extractDocumentText = vi.fn(() => extraction.promise);
    const replaceWorkspaceDocumentSource = vi.fn();
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      indexStore,
      extractDocumentText,
      replaceWorkspaceDocumentSource,
    });

    service.wake();
    await vi.waitFor(() => expect(extractDocumentText).toHaveBeenCalledTimes(1));
    expect(replaceWorkspaceDocumentSource).not.toHaveBeenCalled();
    const processing = documentStore.getDocument(created.document.id)!;
    documentStore.softDeleteDocument(processing.id, processing.revision);
    extraction.resolve({ content: 'stale text', parser: 'pdf', truncated: false });
    await service.waitForIdle();

    expect(documentStore.getVersion(created.version.id)?.extractedText).toBeNull();
    expect(jobStore.getJob(created.job.id)?.status).toBe(
      KnowledgeIngestionJobStatus.Cancelled,
    );
  });

  test('runs at most two general jobs concurrently', async () => {
    const jobs = await Promise.all([
      createQueuedDocument('one.pdf', '2026-07-11T01:00:00.000Z'),
      createQueuedDocument('two.pdf', '2026-07-11T01:01:00.000Z'),
      createQueuedDocument('three.pdf', '2026-07-11T01:02:00.000Z'),
      createQueuedDocument('four.pdf', '2026-07-11T01:03:00.000Z'),
    ]);
    let active = 0;
    let maxActive = 0;
    const gates = jobs.map(() => deferred<void>());
    let callIndex = 0;
    const extractDocumentText = vi.fn(async () => {
      const index = callIndex;
      callIndex += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gates[index]!.promise;
      active -= 1;
      return { content: `text-${index}`, parser: 'pdf', truncated: false };
    });
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      indexStore,
      extractDocumentText,
    });

    service.wake();
    await vi.waitFor(() => expect(extractDocumentText).toHaveBeenCalledTimes(2));
    expect(jobStore.listCurrentJobs('workspace-a').filter(job => job.status === 'running')).toHaveLength(2);
    gates[0]!.resolve();
    gates[1]!.resolve();
    await vi.waitFor(() => expect(extractDocumentText).toHaveBeenCalledTimes(4));
    gates[2]!.resolve();
    gates[3]!.resolve();
    await service.waitForIdle();

    expect(maxActive).toBe(2);
  });

  test('defers one index wake until every concurrent ingestion worker is idle', async () => {
    const first = await createQueuedDocument(
      'first.pdf',
      '2026-07-11T01:00:00.000Z',
    );
    const second = await createQueuedDocument(
      'second.pdf',
      '2026-07-11T01:01:00.000Z',
    );
    const secondExtraction = deferred<{
      content: string;
      parser: string;
      truncated: boolean;
    }>();
    let extractionCount = 0;
    const extractDocumentText = vi.fn(() => {
      extractionCount += 1;
      if (extractionCount === 1) {
        return Promise.resolve({ content: 'first text', parser: 'pdf', truncated: false });
      }
      return secondExtraction.promise;
    });
    const onIndexQueued = vi.fn();
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      indexStore,
      extractDocumentText,
      onIndexQueued,
    });

    service.wake();
    await vi.waitFor(() => {
      expect(jobStore.getJob(first.job.id)?.status).toBe(
        KnowledgeIngestionJobStatus.Completed,
      );
    });

    expect(jobStore.getJob(second.job.id)?.status).toBe(
      KnowledgeIngestionJobStatus.Running,
    );
    service.wake();
    expect(onIndexQueued).not.toHaveBeenCalled();

    secondExtraction.resolve({ content: 'second text', parser: 'pdf', truncated: false });
    await service.waitForIdle();

    expect(jobStore.getJob(second.job.id)?.status).toBe(
      KnowledgeIngestionJobStatus.Completed,
    );
    expect(onIndexQueued).toHaveBeenCalledTimes(1);
  });

  test('serializes OCR extraction while keeping both jobs durably claimed', async () => {
    await createQueuedDocument('one.png', '2026-07-11T01:00:00.000Z');
    await createQueuedDocument('two.png', '2026-07-11T01:01:00.000Z');
    const firstGate = deferred<void>();
    const secondGate = deferred<void>();
    const extractDocumentText = vi.fn(async () => {
      const gate = extractDocumentText.mock.calls.length === 1 ? firstGate : secondGate;
      await gate.promise;
      return { content: 'ocr text', parser: 'image', truncated: false };
    });
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      indexStore,
      extractDocumentText,
    });

    service.wake();
    await vi.waitFor(() => {
      expect(jobStore.listCurrentJobs('workspace-a').filter(job => job.status === 'running'))
        .toHaveLength(2);
    });
    await vi.waitFor(() => expect(extractDocumentText).toHaveBeenCalledTimes(1));
    firstGate.resolve();
    await vi.waitFor(() => expect(extractDocumentText).toHaveBeenCalledTimes(2));
    secondGate.resolve();
    await service.waitForIdle();
  });

  test('retries the whole completion transaction from a fresh WAL snapshot', async () => {
    const fixture = await createFileBackedIngestionFixture();
    try {
      const created = await createQueuedDocumentForStores({
        documentStore: fixture.documentStore,
        jobStore: fixture.jobStore,
        managedFileStore: fixture.managedFileStore,
        displayName: 'snapshot-completion.pdf',
      });
      const originalPrepare = fixture.db.prepare.bind(fixture.db);
      let completionArmed = false;
      let activeVersionReadCount = 0;
      Object.defineProperty(fixture.db, 'prepare', {
        configurable: true,
        value: (source: string) => {
          const statement = originalPrepare(source);
          if (
            !source.includes('SELECT 1') ||
            !source.includes('FROM knowledge_documents') ||
            !source.includes('current_version_id = ?')
          ) {
            return statement;
          }
          return new Proxy(statement, {
            get(targetStatement, property) {
              if (property !== 'get') {
                return Reflect.get(targetStatement, property, targetStatement);
              }
              return (...parameters: unknown[]) => {
                const row = targetStatement.get(...parameters);
                if (completionArmed) {
                  activeVersionReadCount += 1;
                  if (activeVersionReadCount <= 4) {
                    fixture.updateProbe.run();
                  }
                }
                return row;
              };
            },
          });
        },
      });
      const busyRetryDelay = vi.fn(async () => undefined);
      const serviceOptions = {
        db: fixture.db,
        documentStore: fixture.documentStore,
        jobStore: fixture.jobStore,
        managedFileStore: fixture.managedFileStore,
        indexStore: fixture.indexStore,
        extractDocumentText: vi.fn().mockImplementation(async () => {
          completionArmed = true;
          return { content: 'searchable text', parser: 'pdf', truncated: false };
        }),
        busyRetryDelay,
      };
      const service = new KnowledgeIngestionService(serviceOptions);

      service.wake();
      await service.waitForIdle();

      expect(activeVersionReadCount).toBe(5);
      expect(busyRetryDelay).toHaveBeenCalledWith(25, expect.any(AbortSignal));
      expect(fixture.documentStore.getDocument(created.document.id)?.status).toBe(
        KnowledgeDocumentStatus.Ready,
      );
      expect(fixture.jobStore.getJob(created.job.id)?.status).toBe(
        KnowledgeIngestionJobStatus.Completed,
      );
      expect(fixture.jobStore.listAttempts(created.job.id)).toEqual([
        expect.objectContaining({
          outcome: KnowledgeIngestionAttemptOutcome.Completed,
          finishedAt: expect.any(String),
        }),
      ]);
      expect(fixture.indexStore.getState(created.version.id)?.status).toBe(
        KnowledgeDocumentIndexStatus.Pending,
      );
    } finally {
      await fixture.close();
    }
  });

  test('retries failure persistence from a fresh WAL snapshot without a running lease', async () => {
    const fixture = await createFileBackedIngestionFixture();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const created = await createQueuedDocumentForStores({
        documentStore: fixture.documentStore,
        jobStore: fixture.jobStore,
        managedFileStore: fixture.managedFileStore,
        displayName: 'snapshot-failure.pdf',
      });
      const originalPrepare = fixture.db.prepare.bind(fixture.db);
      let failureArmed = false;
      let failureJobReadCount = 0;
      Object.defineProperty(fixture.db, 'prepare', {
        configurable: true,
        value: (source: string) => {
          const statement = originalPrepare(source);
          if (
            !source.includes('FROM knowledge_ingestion_jobs') ||
            !source.includes('WHERE id = ?') ||
            !source.includes('LIMIT 1')
          ) {
            return statement;
          }
          return new Proxy(statement, {
            get(targetStatement, property) {
              if (property !== 'get') {
                return Reflect.get(targetStatement, property, targetStatement);
              }
              return (...parameters: unknown[]) => {
                const row = targetStatement.get(...parameters);
                if (failureArmed) {
                  failureJobReadCount += 1;
                  if (failureJobReadCount <= 4) {
                    fixture.updateProbe.run();
                  }
                }
                return row;
              };
            },
          });
        },
      });
      const busyRetryDelay = vi.fn(async () => undefined);
      const serviceOptions = {
        db: fixture.db,
        documentStore: fixture.documentStore,
        jobStore: fixture.jobStore,
        managedFileStore: fixture.managedFileStore,
        indexStore: fixture.indexStore,
        extractDocumentText: vi.fn().mockImplementation(async () => {
          failureArmed = true;
          throw new Error('forced local parser failure');
        }),
        busyRetryDelay,
      };
      const service = new KnowledgeIngestionService(serviceOptions);

      service.wake();
      await service.waitForIdle();

      expect(failureJobReadCount).toBeGreaterThan(4);
      expect(busyRetryDelay).toHaveBeenCalledWith(25, expect.any(AbortSignal));
      expect(fixture.documentStore.getDocument(created.document.id)?.status).toBe(
        KnowledgeDocumentStatus.Failed,
      );
      expect(fixture.jobStore.getJob(created.job.id)).toMatchObject({
        status: KnowledgeIngestionJobStatus.Failed,
        errorCode: KnowledgeBaseErrorCode.IngestionFailed,
      });
      expect(fixture.jobStore.listAttempts(created.job.id)).toEqual([
        expect.objectContaining({
          outcome: KnowledgeIngestionAttemptOutcome.Failed,
          finishedAt: expect.any(String),
        }),
      ]);
    } finally {
      consoleError.mockRestore();
      await fixture.close();
    }
  });

  test.each([
    {
      outcome: 'ready',
      expectedDocumentStatus: KnowledgeDocumentStatus.Ready,
      expectedProjectionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
    },
    {
      outcome: 'failed',
      expectedDocumentStatus: KnowledgeDocumentStatus.Failed,
      expectedProjectionStatus: EnterpriseLeadDocumentExtractionStatus.Failed,
    },
  ])('retries the whole $outcome commit with its compatibility projection after a busy snapshot', async testCase => {
    const fixture = await createFileBackedIngestionFixture();
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const created = await createQueuedDocumentForStores({
        documentStore: fixture.documentStore,
        jobStore: fixture.jobStore,
        managedFileStore: fixture.managedFileStore,
        displayName: `projection-${testCase.outcome}.pdf`,
      });
      const compatibilityAdapter = new EnterpriseLeadKnowledgeCompatibilityAdapter(
        fixture.workspaceStore,
      );
      const documentService = new KnowledgeDocumentService({
        db: fixture.db,
        documentStore: fixture.documentStore,
        indexStore: fixture.indexStore,
        jobStore: fixture.jobStore,
        managedFileStore: fixture.managedFileStore,
        selectionTokenStore: new KnowledgeSelectionTokenStore(),
        compatibilityAdapter,
        workspaceExists: id => Boolean(fixture.workspaceStore.getWorkspace(id)),
      });
      const originalPrepare = fixture.db.prepare.bind(fixture.db);
      let projectionArmed = false;
      let projectionReadCount = 0;
      Object.defineProperty(fixture.db, 'prepare', {
        configurable: true,
        value: (source: string) => {
          const statement = originalPrepare(source);
          if (
            !source.includes('FROM enterprise_lead_workspaces') ||
            !source.includes('WHERE id = ?')
          ) {
            return statement;
          }
          return new Proxy(statement, {
            get(targetStatement, property) {
              if (property !== 'get') {
                return Reflect.get(targetStatement, property, targetStatement);
              }
              return (...parameters: unknown[]) => {
                const row = targetStatement.get(...parameters);
                if (projectionArmed) {
                  projectionReadCount += 1;
                  if (projectionReadCount <= 4) {
                    fixture.updateProbe.run();
                  }
                }
                return row;
              };
            },
          });
        },
      });
      const busyRetryDelay = vi.fn(async () => undefined);
      const updateCompatibilityProjectionInCurrentTransaction = (
        workspaceId: string,
        documentId: string,
      ): void => {
        expect(fixture.db.inTransaction).toBe(true);
        const document = fixture.documentStore.getDocument(documentId);
        if (!document) {
          throw new Error('/private/customer/document-disappeared.pdf');
        }
        projectionArmed = true;
        try {
          (compatibilityAdapter as EnterpriseLeadKnowledgeCompatibilityAdapter & {
            upsertDocumentInCurrentTransaction: typeof compatibilityAdapter.upsertDocument;
          }).upsertDocumentInCurrentTransaction(
            workspaceId,
            documentService.getDocumentDetails({ documentId }).document,
            {
              legacySourceId: document.legacySourceId,
              legacySourceSnapshotJson:
                fixture.documentStore.getLegacySourceSnapshotJson(document.id),
            },
          );
        } finally {
          projectionArmed = false;
        }
      };
      const serviceOptions = {
        db: fixture.db,
        documentStore: fixture.documentStore,
        jobStore: fixture.jobStore,
        managedFileStore: fixture.managedFileStore,
        indexStore: fixture.indexStore,
        extractDocumentText: testCase.outcome === 'ready'
          ? vi.fn().mockResolvedValue({
              content: 'projection ready text',
              parser: 'pdf',
              truncated: false,
            })
          : vi.fn().mockRejectedValue(
              new Error('/private/customer/projection-failed.pdf parser detail'),
            ),
        updateCompatibilityProjectionInCurrentTransaction,
        busyRetryDelay,
      };
      const service = new KnowledgeIngestionService(serviceOptions);

      service.wake();
      await service.waitForIdle();

      expect(projectionReadCount).toBeGreaterThan(4);
      expect(busyRetryDelay).toHaveBeenCalledWith(25, expect.any(AbortSignal));
      expect(fixture.documentStore.getDocument(created.document.id)?.status).toBe(
        testCase.expectedDocumentStatus,
      );
      const source = fixture.workspaceStore
        .getWorkspace('workspace-a')
        ?.extractionSources.find(item => item.fileName === created.document.displayName);
      expect(source?.extractionStatus).toBe(testCase.expectedProjectionStatus);
      const logged = consoleWarn.mock.calls.flat().map(value => String(value)).join('\n');
      expect(logged).not.toContain('database is locked');
      expect(logged).not.toContain('/private/customer');
      expect(consoleWarn.mock.calls.flat().some(value => value instanceof Error)).toBe(false);
    } finally {
      consoleWarn.mockRestore();
      await fixture.close();
    }
  });

  test('keeps one drain and two workers while a claim exhausts one busy retry round', async () => {
    const fixture = await createFileBackedIngestionFixture();
    const extractionRelease = deferred<void>();
    let initialIdleError: unknown = null;
    let initialIdle: Promise<void> | null = null;
    let service: KnowledgeIngestionService | null = null;
    try {
      const created = await Promise.all(
        ['first.pdf', 'second.pdf', 'third.pdf'].map((displayName, index) =>
          createQueuedDocumentForStores({
            documentStore: fixture.documentStore,
            jobStore: fixture.jobStore,
            managedFileStore: fixture.managedFileStore,
            displayName,
            createdAt: `2026-07-11T01:0${index}:00.000Z`,
          }),
        ),
      );
      const originalPrepare = fixture.db.prepare.bind(fixture.db);
      let queuedReadCount = 0;
      Object.defineProperty(fixture.db, 'prepare', {
        configurable: true,
        value: (source: string) => {
          const statement = originalPrepare(source);
          if (
            !source.includes('SELECT id') ||
            !source.includes('FROM knowledge_ingestion_jobs') ||
            !source.includes('WHERE status = ?')
          ) {
            return statement;
          }
          return new Proxy(statement, {
            get(targetStatement, property) {
              if (property !== 'get') {
                return Reflect.get(targetStatement, property, targetStatement);
              }
              return (...parameters: unknown[]) => {
                const row = targetStatement.get(...parameters);
                queuedReadCount += 1;
                if (queuedReadCount >= 2 && queuedReadCount <= 5) {
                  fixture.updateProbe.run();
                }
                return row;
              };
            },
          });
        },
      });
      let activeExtractions = 0;
      let maxActiveExtractions = 0;
      const extractDocumentText = vi.fn(async () => {
        activeExtractions += 1;
        maxActiveExtractions = Math.max(maxActiveExtractions, activeExtractions);
        await extractionRelease.promise;
        activeExtractions -= 1;
        return { content: 'claimed exactly once', parser: 'pdf', truncated: false };
      });
      const busyRetryDelay = vi.fn(async () => undefined);
      const onIndexQueued = vi.fn();
      const serviceOptions = {
        db: fixture.db,
        documentStore: fixture.documentStore,
        jobStore: fixture.jobStore,
        managedFileStore: fixture.managedFileStore,
        indexStore: fixture.indexStore,
        extractDocumentText,
        busyRetryDelay,
        onIndexQueued,
      };
      service = new KnowledgeIngestionService(serviceOptions);

      service.wake();
      initialIdle = service.waitForIdle().catch(error => {
        initialIdleError = error;
      });
      await vi.waitFor(() => expect(queuedReadCount).toBeGreaterThanOrEqual(5));
      await Promise.resolve();
      await Promise.resolve();
      service.wake();
      await vi.waitFor(() => expect(extractDocumentText).toHaveBeenCalledTimes(2));

      expect(initialIdleError).toBeNull();
      expect(maxActiveExtractions).toBeLessThanOrEqual(2);
      expect(busyRetryDelay).toHaveBeenCalledWith(25, expect.any(AbortSignal));

      extractionRelease.resolve();
      await initialIdle;
      await service.waitForIdle();

      expect(maxActiveExtractions).toBeLessThanOrEqual(2);
      expect(onIndexQueued).toHaveBeenCalledTimes(1);
      created.forEach(target => {
        expect(fixture.jobStore.getJob(target.job.id)).toMatchObject({
          status: KnowledgeIngestionJobStatus.Completed,
          attemptCount: 1,
        });
        expect(fixture.jobStore.listAttempts(target.job.id)).toEqual([
          expect.objectContaining({
            attemptNumber: 1,
            outcome: KnowledgeIngestionAttemptOutcome.Completed,
            finishedAt: expect.any(String),
          }),
        ]);
      });
    } finally {
      extractionRelease.resolve();
      await initialIdle?.catch(() => undefined);
      await service?.waitForIdle().catch(() => undefined);
      await fixture.close();
    }
  });

  test('atomically commits parsed text, ingestion completion, and pending index state', async () => {
    const created = await createQueuedDocument('atomic.pdf');
    const indexStore = new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });
    const extractDocumentText = vi.fn().mockResolvedValue({
      content: 'normalized searchable text',
      parser: 'text',
      truncated: false,
    });
    const onIndexQueued = vi.fn();
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      indexStore,
      extractDocumentText,
      onIndexQueued,
    });

    service.wake();
    await service.waitForIdle();

    expect(jobStore.getJob(created.job.id)?.status).toBe(
      KnowledgeIngestionJobStatus.Completed,
    );
    expect(indexStore.getState(created.version.id)?.status).toBe(
      KnowledgeDocumentIndexStatus.Pending,
    );
    expect(onIndexQueued).toHaveBeenCalledTimes(1);
  });

  test('commits not-applicable index state for empty extracted text', async () => {
    const created = await createQueuedDocument('empty-index.pdf');
    const indexStore = new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });
    const onIndexQueued = vi.fn();
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      indexStore,
      extractDocumentText: vi.fn().mockResolvedValue({
        content: '   ',
        parser: 'text',
        truncated: false,
      }),
      onIndexQueued,
    });

    service.wake();
    await service.waitForIdle();

    expect(indexStore.getState(created.version.id)?.status).toBe(
      KnowledgeDocumentIndexStatus.NotApplicable,
    );
    expect(onIndexQueued).not.toHaveBeenCalled();
  });

  test('rolls back extraction and completion when index scheduling fails', async () => {
    const created = await createQueuedDocument('schedule-failure.pdf');
    const onIndexQueued = vi.fn();
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      extractDocumentText: vi.fn().mockResolvedValue({
        content: 'must roll back',
        parser: 'text',
        truncated: false,
      }),
      indexStore: {
        scheduleCurrentVersionInCurrentTransaction: vi.fn(() => {
          throw new Error('forced scheduling failure');
        }),
      },
      onIndexQueued,
    });

    service.wake();
    await service.waitForIdle();

    expect(documentStore.getVersion(created.version.id)?.extractedText).toBeNull();
    expect(jobStore.getJob(created.job.id)?.status).toBe(
      KnowledgeIngestionJobStatus.Failed,
    );
    expect(onIndexQueued).not.toHaveBeenCalled();
  });

  test('contains a synchronous index wake failure after pending ingestion commits', async () => {
    const created = await createQueuedDocument('wake-failure.pdf');
    const onIndexQueued = vi.fn(() => {
      throw new Error('SECRET forced wake SQL /private/path');
    });
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const service = new KnowledgeIngestionService({
        db,
        documentStore,
        jobStore,
        managedFileStore,
        indexStore,
        extractDocumentText: vi.fn().mockResolvedValue({
          content: 'committed despite wake failure',
          parser: 'text',
          truncated: false,
        }),
        onIndexQueued,
      });

      service.wake();
      await service.waitForIdle();

      expect(documentStore.getDocument(created.document.id)?.status).toBe(
        KnowledgeDocumentStatus.Ready,
      );
      expect(jobStore.getJob(created.job.id)?.status).toBe(
        KnowledgeIngestionJobStatus.Completed,
      );
      expect(documentStore.getVersion(created.version.id)?.extractedText).toBe(
        'committed despite wake failure',
      );
      expect(indexStore.getState(created.version.id)?.status).toBe(
        KnowledgeDocumentIndexStatus.Pending,
      );
      expect(onIndexQueued).toHaveBeenCalledTimes(1);
      expect(consoleWarn).toHaveBeenCalledWith(
        '[KnowledgeIngestion]',
        { code: 'index_worker_wake_failed' },
      );
      expect(consoleWarn.mock.calls.flat().some(value => value instanceof Error)).toBe(false);
      expect(JSON.stringify(consoleWarn.mock.calls)).not.toMatch(/SECRET|SQL|private|path/i);
    } finally {
      consoleWarn.mockRestore();
    }
  });
});
