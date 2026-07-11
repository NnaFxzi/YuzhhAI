import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  KnowledgeDocumentIndexAttemptOutcome,
  KnowledgeDocumentIndexErrorCode,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentIndexTokenizer,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
} from '../../shared/knowledgeBase/constants';
import { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import { applySqliteConnectionPolicy } from '../libs/sqliteConnectionPolicy';
import {
  InlineKnowledgeDocumentIndexExecutor,
  KnowledgeDocumentIndexBusyError,
  KnowledgeDocumentIndexUnavailableError,
  WorkerKnowledgeDocumentIndexExecutor,
} from './knowledgeDocumentIndexExecutor';
import { KnowledgeDocumentIndexService } from './knowledgeDocumentIndexService';
import { KnowledgeDocumentIndexStore } from './knowledgeDocumentIndexStore';
import { KnowledgeDocumentIndexWorkerMessage } from './knowledgeDocumentIndexTypes';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';

const ensureWorkerTestWorkspace = (db: Database.Database): void => {
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

const createStoreWithPendingVersions = (count: number) => {
  const db = new Database(':memory:');
  ensureWorkerTestWorkspace(db);
  const documents = new KnowledgeDocumentStore(db);
  const store = new KnowledgeDocumentIndexStore(db, {
    resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
  });
  for (let index = 0; index < count; index += 1) {
    const created = documents.createDocumentWithVersion({
      workspaceId: 'workspace-a',
      displayName: `document-${index}.txt`,
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: {
        contentHash: String(index).padStart(64, '0'),
        managedPath: `blobs/test/${index}`,
        mimeType: 'text/plain',
        fileSize: 20,
        sourceMtime: null,
        parser: 'text',
        extractedText: `searchable text ${index}`,
        extractionPartial: false,
      },
    });
    store.scheduleCurrentVersion({
      workspaceId: created.document.workspaceId,
      documentId: created.document.id,
      documentVersionId: created.version.id,
    });
  }
  return { db, store };
};

const workerScriptPath = path.resolve('dist-electron/knowledge-index-worker.js');
const runtimeTest = fs.existsSync(workerScriptPath) ? test : test.skip;

describe('KnowledgeDocumentIndexExecutor', () => {
  let tempDirectory: string;

  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-index-executor-'));
  });

  afterEach(() => {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  test('inline executor drains every pending version through the shared runner', async () => {
    const { db, store } = createStoreWithPendingVersions(3);
    const executor = new InlineKnowledgeDocumentIndexExecutor(store);

    await expect(executor.runUntilIdle()).resolves.toEqual({
      indexedCount: 3,
      failedCount: 0,
    });
    expect(store.listStates('workspace-a').every(
      state => state.status === KnowledgeDocumentIndexStatus.Indexed,
    )).toBe(true);
    db.close();
  });

  test('inline executor rejects work after shutdown', async () => {
    const { db, store } = createStoreWithPendingVersions(0);
    const executor = new InlineKnowledgeDocumentIndexExecutor(store);

    await executor.shutdown();

    await expect(executor.runUntilIdle()).rejects.toThrow(
      KnowledgeDocumentIndexErrorCode.WorkerUnavailable,
    );
    db.close();
  });

  test('inline executor maps a raw SQLite busy result to the dedicated busy error', async () => {
    const busy = Object.assign(new Error('database is locked'), {
      code: 'SQLITE_BUSY_SNAPSHOT',
    });
    const store = {
      recoverAbandonedIndexing: () => {
        throw busy;
      },
    } as unknown as KnowledgeDocumentIndexStore;
    const executor = new InlineKnowledgeDocumentIndexExecutor(store);

    await expect(executor.runUntilIdle()).rejects.toBeInstanceOf(
      KnowledgeDocumentIndexBusyError,
    );
    await executor.shutdown();
  });

  runtimeTest('indexes a file-backed database through the compiled worker', async () => {
    const databasePath = path.join(tempDirectory, 'worker.sqlite');
    const db = new Database(databasePath);
    applySqliteConnectionPolicy(db);
    ensureWorkerTestWorkspace(db);
    const documents = new KnowledgeDocumentStore(db);
    const indexStore = new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });
    const target = documents.createDocumentWithVersion({
      workspaceId: 'workspace-a',
      displayName: 'worker.txt',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: {
        contentHash: 'e'.repeat(64),
        managedPath: 'blobs/test/worker',
        mimeType: 'text/plain',
        fileSize: 16,
        sourceMtime: null,
        parser: 'text',
        extractedText: 'worker searchable text',
        extractionPartial: false,
      },
    });
    indexStore.scheduleCurrentVersion({
      workspaceId: 'workspace-a',
      documentId: target.document.id,
      documentVersionId: target.version.id,
    });
    const abandonedClaim = indexStore.claimNext();
    expect(abandonedClaim).not.toBeNull();
    const executor = new WorkerKnowledgeDocumentIndexExecutor({
      databasePath,
      workerScriptPath,
    });

    await expect(executor.runUntilIdle()).resolves.toEqual({
      indexedCount: 1,
      failedCount: 0,
    });
    expect(indexStore.getState(target.version.id)?.status).toBe(
      KnowledgeDocumentIndexStatus.Indexed,
    );
    expect(indexStore.listAttempts(target.version.id)).toEqual([
      expect.objectContaining({
        id: abandonedClaim!.attempt.id,
        outcome: KnowledgeDocumentIndexAttemptOutcome.Abandoned,
      }),
      expect.objectContaining({
        attemptNumber: 2,
        outcome: KnowledgeDocumentIndexAttemptOutcome.Indexed,
      }),
    ]);

    await executor.shutdown();
    db.close();
  });

  runtimeTest('does not create a database when the worker receives a wrong path', async () => {
    const missingPath = path.join(tempDirectory, 'missing', 'knowledge.sqlite');
    const executor = new WorkerKnowledgeDocumentIndexExecutor({
      databasePath: missingPath,
      workerScriptPath,
    });
    await expect(executor.runUntilIdle()).rejects.toThrow('index_worker_unavailable');
    expect(fs.existsSync(missingPath)).toBe(false);
    await executor.shutdown().catch(() => undefined);
  });

  test('maps a startup worker error to the stable unavailable code', async () => {
    const executor = new WorkerKnowledgeDocumentIndexExecutor({
      databasePath: path.join(tempDirectory, 'startup.sqlite'),
      workerScriptPath,
      workerFactory: () => new Worker('throw new Error("startup failed")', { eval: true }),
    });

    await expect(executor.runUntilIdle()).rejects.toBeInstanceOf(
      KnowledgeDocumentIndexUnavailableError,
    );

    await executor.shutdown().catch(() => undefined);
  });

  test('settles a synchronous worker construction failure', async () => {
    const executor = new WorkerKnowledgeDocumentIndexExecutor({
      databasePath: path.join(tempDirectory, 'construction.sqlite'),
      workerScriptPath,
      workerFactory: () => {
        throw new Error('construction failed');
      },
    });

    await expect(Promise.race([
      executor.runUntilIdle(),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('startup did not settle')), 100);
      }),
    ])).rejects.toThrow(KnowledgeDocumentIndexErrorCode.WorkerUnavailable);

    await executor.shutdown();
  });

  test('settles queued runs without respawning after an unexpected mid-run exit', async () => {
    let constructionCount = 0;
    const executor = new WorkerKnowledgeDocumentIndexExecutor({
      databasePath: path.join(tempDirectory, 'exit.sqlite'),
      workerScriptPath,
      workerFactory: () => {
        constructionCount += 1;
        return new Worker(`
          const { parentPort } = require('node:worker_threads');
          parentPort.once('message', () => process.exit(1));
        `, { eval: true });
      },
    });

    const results = await Promise.allSettled([
      executor.runUntilIdle(),
      executor.runUntilIdle(),
    ]);

    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      expect((result as PromiseRejectedResult).reason).toMatchObject({
        message: KnowledgeDocumentIndexErrorCode.WorkerUnavailable,
      });
    }
    expect(constructionCount).toBe(1);
    await executor.shutdown().catch(() => undefined);
  });

  test('reuses one persistent worker and serializes successful concurrent runs', async () => {
    const counters = new Int32Array(
      new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 3),
    );
    let constructionCount = 0;
    let controlledWorker: Worker | null = null;
    const executor = new WorkerKnowledgeDocumentIndexExecutor({
      databasePath: path.join(tempDirectory, 'serialized.sqlite'),
      workerScriptPath,
      workerFactory: () => {
        constructionCount += 1;
        controlledWorker = new Worker(`
          const { parentPort, workerData } = require('node:worker_threads');
          const counters = new Int32Array(workerData.counters);
          const pending = [];
          let ordinal = 0;
          parentPort.on('message', message => {
            if (message.kind === '${KnowledgeDocumentIndexWorkerMessage.Run}') {
              ordinal += 1;
              const inFlight = Atomics.add(counters, 1, 1) + 1;
              Atomics.add(counters, 0, 1);
              Atomics.store(counters, 2, Math.max(Atomics.load(counters, 2), inFlight));
              pending.push({ ...message, ordinal });
              return;
            }
            if (message.kind === 'test-release') {
              const request = pending.shift();
              if (!request) return;
              Atomics.sub(counters, 1, 1);
              parentPort.postMessage({
                requestId: request.requestId,
                kind: '${KnowledgeDocumentIndexWorkerMessage.Result}',
                result: { indexedCount: request.ordinal, failedCount: 0 },
              });
              return;
            }
            if (message.kind === '${KnowledgeDocumentIndexWorkerMessage.Shutdown}') {
              parentPort.postMessage({
                requestId: message.requestId,
                kind: '${KnowledgeDocumentIndexWorkerMessage.Stopped}',
              });
              parentPort.close();
            }
          });
        `, {
          eval: true,
          workerData: { counters: counters.buffer },
        });
        return controlledWorker;
      },
    });
    const resolutionOrder: string[] = [];
    const firstRun = executor.runUntilIdle().then(result => {
      resolutionOrder.push('first');
      return result;
    });
    const secondRun = executor.runUntilIdle().then(result => {
      resolutionOrder.push('second');
      return result;
    });
    void firstRun.catch(() => undefined);
    void secondRun.catch(() => undefined);
    const waitForArrivalCount = async (expected: number): Promise<void> => {
      const deadline = Date.now() + 1_000;
      while (Atomics.load(counters, 0) < expected) {
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for ${expected} worker requests`);
        }
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    };

    try {
      await waitForArrivalCount(1);
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(Atomics.load(counters, 0)).toBe(1);
      expect(Atomics.load(counters, 1)).toBe(1);
      expect(constructionCount).toBe(1);

      controlledWorker?.postMessage({ kind: 'test-release' });
      await expect(firstRun).resolves.toEqual({ indexedCount: 1, failedCount: 0 });
      await waitForArrivalCount(2);
      expect(Atomics.load(counters, 1)).toBe(1);

      controlledWorker?.postMessage({ kind: 'test-release' });
      await expect(secondRun).resolves.toEqual({ indexedCount: 2, failedCount: 0 });
      expect(Atomics.load(counters, 2)).toBe(1);
      expect(resolutionOrder).toEqual(['first', 'second']);
      expect(constructionCount).toBe(1);

      await executor.shutdown();
      await expect(executor.runUntilIdle()).rejects.toThrow(
        KnowledgeDocumentIndexErrorCode.WorkerUnavailable,
      );
      expect(constructionCount).toBe(1);
    } finally {
      await executor.shutdown().catch(() => undefined);
      await Promise.allSettled([firstRun, secondRun]);
    }
  });

  test('rejects only a busy run and reuses the same persistent worker for the next run', async () => {
    let constructionCount = 0;
    const executor = new WorkerKnowledgeDocumentIndexExecutor({
      databasePath: path.join(tempDirectory, 'busy.sqlite'),
      workerScriptPath,
      workerFactory: () => {
        constructionCount += 1;
        return new Worker(`
          const { parentPort } = require('node:worker_threads');
          let runCount = 0;
          parentPort.on('message', message => {
            if (message.kind === '${KnowledgeDocumentIndexWorkerMessage.Run}') {
              runCount += 1;
              if (runCount === 1) {
                parentPort.postMessage({
                  requestId: message.requestId,
                  kind: '${KnowledgeDocumentIndexWorkerMessage.Busy}',
                });
              } else {
                parentPort.postMessage({
                  requestId: message.requestId,
                  kind: '${KnowledgeDocumentIndexWorkerMessage.Result}',
                  result: { indexedCount: 1, failedCount: 0 },
                });
              }
              return;
            }
            if (message.kind === '${KnowledgeDocumentIndexWorkerMessage.Shutdown}') {
              parentPort.postMessage({
                requestId: message.requestId,
                kind: '${KnowledgeDocumentIndexWorkerMessage.Stopped}',
              });
              parentPort.close();
            }
          });
        `, { eval: true });
      },
    });

    try {
      await expect(executor.runUntilIdle()).rejects.toBeInstanceOf(
        KnowledgeDocumentIndexBusyError,
      );
      await expect(executor.runUntilIdle()).resolves.toEqual({
        indexedCount: 1,
        failedCount: 0,
      });
      expect(constructionCount).toBe(1);
    } finally {
      await executor.shutdown().catch(() => undefined);
    }
  });

  runtimeTest('keeps the real worker after an exhausted BEGIN IMMEDIATE lock and succeeds after release', async () => {
    const databasePath = path.join(tempDirectory, 'real-worker-busy.sqlite');
    const db = new Database(databasePath);
    applySqliteConnectionPolicy(db);
    ensureWorkerTestWorkspace(db);
    const documents = new KnowledgeDocumentStore(db);
    const indexStore = new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });
    let constructionCount = 0;
    const executor = new WorkerKnowledgeDocumentIndexExecutor({
      databasePath,
      workerScriptPath,
      workerFactory: (filename, options) => {
        constructionCount += 1;
        return new Worker(filename, options);
      },
    });
    let lockDb: Database.Database | null = null;
    let lockHeld = false;

    try {
      await expect(executor.runUntilIdle()).resolves.toEqual({
        indexedCount: 0,
        failedCount: 0,
      });
      const target = documents.createDocumentWithVersion({
        workspaceId: 'workspace-a',
        displayName: 'real-worker-busy.txt',
        sourceMode: KnowledgeDocumentSourceMode.Managed,
        status: KnowledgeDocumentStatus.Ready,
        version: {
          contentHash: '9'.repeat(64),
          managedPath: 'blobs/test/real-worker-busy',
          mimeType: 'text/plain',
          fileSize: 22,
          sourceMtime: null,
          parser: 'text',
          extractedText: 'busy then searchable text',
          extractionPartial: false,
        },
      });
      indexStore.scheduleCurrentVersion({
        workspaceId: target.document.workspaceId,
        documentId: target.document.id,
        documentVersionId: target.version.id,
      });

      lockDb = new Database(databasePath);
      applySqliteConnectionPolicy(lockDb);
      lockDb.exec('BEGIN IMMEDIATE');
      lockHeld = true;
      await expect(executor.runUntilIdle()).rejects.toBeInstanceOf(
        KnowledgeDocumentIndexBusyError,
      );
      lockDb.exec('ROLLBACK');
      lockHeld = false;

      await expect(executor.runUntilIdle()).resolves.toEqual({
        indexedCount: 1,
        failedCount: 0,
      });
      expect(constructionCount).toBe(1);
      expect(indexStore.getState(target.version.id)?.status).toBe(
        KnowledgeDocumentIndexStatus.Indexed,
      );
    } finally {
      if (lockHeld) {
        lockDb?.exec('ROLLBACK');
      }
      lockDb?.close();
      await executor.shutdown().catch(() => undefined);
      db.close();
    }
  }, 35_000);

  runtimeTest('surfaces a non-transient real-worker drain defect through error and exit', async () => {
    const databasePath = path.join(tempDirectory, 'real-worker-fatal.sqlite');
    const db = new Database(databasePath);
    applySqliteConnectionPolicy(db);
    ensureWorkerTestWorkspace(db);
    const documents = new KnowledgeDocumentStore(db);
    new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });
    let constructionCount = 0;
    const executor = new WorkerKnowledgeDocumentIndexExecutor({
      databasePath,
      workerScriptPath,
      workerFactory: (filename, options) => {
        constructionCount += 1;
        return new Worker(filename, options);
      },
    });

    try {
      await expect(executor.runUntilIdle()).resolves.toEqual({
        indexedCount: 0,
        failedCount: 0,
      });
      const target = documents.createDocumentWithVersion({
        workspaceId: 'workspace-a',
        displayName: 'fatal-worker.txt',
        sourceMode: KnowledgeDocumentSourceMode.Managed,
        status: KnowledgeDocumentStatus.Ready,
        version: {
          contentHash: '8'.repeat(64),
          managedPath: 'blobs/test/fatal-worker',
          mimeType: 'text/plain',
          fileSize: 6,
          sourceMtime: null,
          parser: 'text',
          extractedText: 'orphan',
          extractionPartial: false,
        },
      });
      db.exec('DROP TABLE knowledge_document_chunks_fts');
      db.prepare(`
        INSERT INTO knowledge_document_chunks (
          storage_id, id, index_generation_id, workspace_id, document_id,
          document_version_id, ordinal, content, start_offset, end_offset,
          page_number, sheet_name, slide_number, heading_path_json, checksum, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, 6, NULL, NULL, NULL, NULL, ?, ?)
      `).run(
        'orphan-storage',
        'orphan-chunk',
        'orphan-generation',
        target.document.workspaceId,
        target.document.id,
        target.version.id,
        'orphan',
        'orphan-checksum',
        '2026-07-12T00:00:00.000Z',
      );

      await expect(executor.runUntilIdle()).rejects.toBeInstanceOf(
        KnowledgeDocumentIndexUnavailableError,
      );
      await expect(executor.runUntilIdle()).resolves.toEqual({
        indexedCount: 0,
        failedCount: 0,
      });
      expect(constructionCount).toBe(2);
    } finally {
      await executor.shutdown().catch(() => undefined);
      db.close();
    }
  });

  test('shuts down an active service drain with a non-responsive worker within six seconds', async () => {
    const databasePath = path.join(tempDirectory, 'hanging.sqlite');
    const db = new Database(databasePath);
    new EnterpriseLeadWorkspaceStore(db);
    new KnowledgeDocumentStore(db);
    const indexStore = new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });
    const executor = new WorkerKnowledgeDocumentIndexExecutor({
      databasePath,
      workerScriptPath,
      workerFactory: () => new Worker('while (true) {}', { eval: true }),
    });
    const service = new KnowledgeDocumentIndexService(executor, indexStore);
    service.wake();
    await new Promise(resolve => setTimeout(resolve, 50));
    const startedAt = performance.now();
    await service.shutdown();
    expect(performance.now() - startedAt).toBeLessThan(6_000);
    expect(() => db.close()).not.toThrow();
  }, 7_000);

  runtimeTest('recreates a dead worker only after explicit retry', async () => {
    const databasePath = path.join(tempDirectory, 'restart.sqlite');
    const db = new Database(databasePath);
    applySqliteConnectionPolicy(db);
    ensureWorkerTestWorkspace(db);
    const documents = new KnowledgeDocumentStore(db);
    const indexStore = new KnowledgeDocumentIndexStore(db);
    const target = documents.createDocumentWithVersion({
      workspaceId: 'workspace-a',
      displayName: 'restart.txt',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: {
        contentHash: 'f'.repeat(64),
        managedPath: 'blobs/test/restart',
        mimeType: 'text/plain',
        fileSize: 12,
        sourceMtime: null,
        parser: 'text',
        extractedText: 'restart text',
        extractionPartial: false,
      },
    });
    indexStore.scheduleCurrentVersion({
      workspaceId: 'workspace-a',
      documentId: target.document.id,
      documentVersionId: target.version.id,
    });
    let constructionCount = 0;
    const executor = new WorkerKnowledgeDocumentIndexExecutor({
      databasePath,
      workerScriptPath,
      workerFactory: (filename, options) => {
        constructionCount += 1;
        if (constructionCount === 1) {
          return new Worker(`
            const { parentPort } = require('node:worker_threads');
            parentPort.once('message', () => process.exit(1));
          `, { eval: true });
        }
        return new Worker(filename, options);
      },
    });
    const service = new KnowledgeDocumentIndexService(executor, indexStore);

    try {
      service.wake();
      service.wake();
      await service.waitForIdle();
      expect(indexStore.getState(target.version.id)).toMatchObject({
        status: KnowledgeDocumentIndexStatus.Failed,
        errorCode: KnowledgeDocumentIndexErrorCode.WorkerUnavailable,
      });
      expect(constructionCount).toBe(1);
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(constructionCount).toBe(1);

      indexStore.retryFailedVersion({
        documentId: target.document.id,
        documentVersionId: target.version.id,
      });
      service.wake();
      await service.waitForIdle();
      expect(constructionCount).toBe(2);
      expect(indexStore.getState(target.version.id)?.status).toBe(
        KnowledgeDocumentIndexStatus.Indexed,
      );
    } finally {
      await service.shutdown().catch(() => undefined);
      db.close();
    }
  });
});
