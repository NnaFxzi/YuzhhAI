import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import { EnterpriseLeadWorkspaceType } from '../../shared/enterpriseLeadWorkspace/constants';
import {
  KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
} from '../../shared/knowledgeBase/constants';
import { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import { applySqliteConnectionPolicy } from '../libs/sqliteConnectionPolicy';
import { WorkerKnowledgeDocumentIndexExecutor } from './knowledgeDocumentIndexExecutor';
import { KnowledgeDocumentIndexStore } from './knowledgeDocumentIndexStore';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';

const createFileBackedIndexFixture = () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-index-runtime-'));
  const databasePath = path.join(tempDirectory, 'knowledge.sqlite');
  let db: Database.Database | null = null;

  try {
    db = new Database(databasePath);
    applySqliteConnectionPolicy(db);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspace = workspaceStore.createWorkspace({
      name: 'Responsiveness workspace',
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
    const documentStore = new KnowledgeDocumentStore(db);
    const indexStore = new KnowledgeDocumentIndexStore(db);
    let sequence = 0;

    return {
      db,
      databasePath,
      documentStore,
      indexStore,
      workspaceId: workspace.id,
      createPendingDocument: (text: string) => {
        sequence += 1;
        const created = documentStore.createDocumentWithVersion({
          workspaceId: workspace.id,
          displayName: `runtime-${sequence}.txt`,
          sourceMode: KnowledgeDocumentSourceMode.Managed,
          status: KnowledgeDocumentStatus.Ready,
          version: {
            contentHash: String(sequence).padStart(64, '0'),
            managedPath: `blobs/runtime/${sequence}`,
            mimeType: 'text/plain',
            fileSize: text.length,
            sourceMtime: null,
            parser: 'text',
            extractedText: text,
            extractionPartial: false,
          },
        });
        indexStore.scheduleCurrentVersion({
          workspaceId: workspace.id,
          documentId: created.document.id,
          documentVersionId: created.version.id,
        });
        return created;
      },
      close: (): void => {
        try {
          if (db?.open) {
            db.close();
          }
        } finally {
          fs.rmSync(tempDirectory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    try {
      if (db?.open) {
        db.close();
      }
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
    throw error;
  }
};

const workerPath = path.resolve('dist-electron/knowledge-index-worker.js');
const requireWorker = process.env.KNOWLEDGE_INDEX_REQUIRE_WORKER === '1';

if (requireWorker && !fs.existsSync(workerPath)) {
  throw new Error(`Required local-index worker is missing: ${workerPath}`);
}

const runtimeTest = fs.existsSync(workerPath) ? test : test.skip;

test('responsiveness sampler detects an intentional synchronous stall', async () => {
  const drifts: number[] = [];
  let expectedAt = performance.now() + 10;
  let timer: ReturnType<typeof setInterval> | null = null;

  try {
    timer = setInterval(() => {
      const now = performance.now();
      drifts.push(Math.max(0, now - expectedAt));
      expectedAt += 10;
    }, 10);
    await new Promise(resolve => setTimeout(resolve, 30));
    const blockedUntil = performance.now() + 300;
    while (performance.now() < blockedUntil) {
      // Negative control: deliberately block this test event loop.
    }
    await new Promise(resolve => setTimeout(resolve, 30));
  } finally {
    if (timer) {
      clearInterval(timer);
    }
  }

  expect(Math.max(0, ...drifts)).toBeGreaterThan(250);
});

runtimeTest(
  'keeps a Node host event-loop proxy responsive while indexing one 50 MiB and four queued documents',
  async () => {
    let fixture: ReturnType<typeof createFileBackedIndexFixture> | null = null;
    let executor: WorkerKnowledgeDocumentIndexExecutor | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const drifts: number[] = [];
    const mainWriteDurations: number[] = [];
    const probeErrors: unknown[] = [];

    try {
      fixture = createFileBackedIndexFixture();
      fixture.createPendingDocument('x'.repeat(50 * 1024 * 1024));
      for (let index = 0; index < 4; index += 1) {
        fixture.createPendingDocument(`企业知识库-${index}-`.repeat(20_000));
      }

      executor = new WorkerKnowledgeDocumentIndexExecutor({
        databasePath: fixture.databasePath,
        workerScriptPath: workerPath,
      });
      fixture.db.exec('CREATE TABLE responsiveness_probe (id INTEGER PRIMARY KEY, value INTEGER)');
      fixture.db.prepare('INSERT INTO responsiveness_probe (id, value) VALUES (1, 0)').run();
      const updateProbe = fixture.db.prepare(
        'UPDATE responsiveness_probe SET value = value + 1 WHERE id = 1',
      );
      let expectedAt = performance.now() + 25;
      timer = setInterval(() => {
        const writeStartedAt = performance.now();
        try {
          updateProbe.run();
        } catch (error) {
          probeErrors.push(error);
        }
        const now = performance.now();
        mainWriteDurations.push(now - writeStartedAt);
        drifts.push(Math.max(0, now - expectedAt));
        expectedAt = now + 25;
      }, 25);

      const result = await executor.runUntilIdle();
      expect(
        result,
        JSON.stringify(fixture.indexStore.listStates(fixture.workspaceId)),
      ).toEqual({
        indexedCount: 5,
        failedCount: 0,
      });
      await new Promise(resolve => setTimeout(resolve, 75));

      const maxTimerDriftMs = Math.max(0, ...drifts);
      const maxMainWriteMs = Math.max(0, ...mainWriteDurations);
      console.log('[KnowledgeBase] Node host event-loop proxy metrics:', {
        ...result,
        maxTimerDriftMs,
        maxMainWriteMs,
      });
      expect(probeErrors).toEqual([]);
      expect(drifts.length).toBeGreaterThanOrEqual(10);
      expect(maxTimerDriftMs).toBeLessThan(250);
      expect(maxMainWriteMs).toBeLessThan(250);
    } finally {
      if (timer) {
        clearInterval(timer);
      }
      if (executor) {
        await executor.shutdown().catch(() => undefined);
      }
      fixture?.close();
    }
  },
  180_000,
);

runtimeTest(
  'keeps the host responsive while a real worker purges a large inactive generation',
  async () => {
    let fixture: ReturnType<typeof createFileBackedIndexFixture> | null = null;
    let executor: WorkerKnowledgeDocumentIndexExecutor | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const drifts: number[] = [];
    const mainWriteDurations: number[] = [];
    const probeErrors: unknown[] = [];

    try {
      fixture = createFileBackedIndexFixture();
      const initial = fixture.createPendingDocument('x'.repeat(50 * 1024 * 1024));
      executor = new WorkerKnowledgeDocumentIndexExecutor({
        databasePath: fixture.databasePath,
        workerScriptPath: workerPath,
      });

      await expect(executor.runUntilIdle()).resolves.toEqual({
        indexedCount: 1,
        failedCount: 0,
      });
      expect(fixture.indexStore.getState(initial.version.id)?.status).toBe(
        KnowledgeDocumentIndexStatus.Indexed,
      );
      const oldChunkCount = (fixture.db.prepare(`
        SELECT COUNT(*) AS count
        FROM knowledge_document_chunks
        WHERE document_version_id = ?
      `).get(initial.version.id) as { count: number }).count;
      expect(oldChunkCount).toBeGreaterThan(KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS * 40);

      const replacementText = 'replacement searchable knowledge '.repeat(500);
      const replacement = fixture.db.transaction(() => {
        fixture!.indexStore.deactivateVersion({
          workspaceId: fixture!.workspaceId,
          documentId: initial.document.id,
          documentVersionId: initial.version.id,
        });
        const next = fixture!.documentStore.addVersion(
          initial.document.id,
          initial.document.revision,
          {
            contentHash: '2'.padStart(64, '0'),
            managedPath: 'blobs/runtime/replacement',
            mimeType: 'text/plain',
            fileSize: replacementText.length,
            sourceMtime: null,
            parser: 'text',
            extractedText: replacementText,
            extractionPartial: false,
          },
          KnowledgeDocumentStatus.Ready,
        );
        fixture!.indexStore.scheduleCurrentVersion({
          workspaceId: fixture!.workspaceId,
          documentId: next.document.id,
          documentVersionId: next.version.id,
        });
        return next;
      })();

      expect((fixture.db.prepare(`
        SELECT COUNT(*) AS count
        FROM knowledge_document_chunks
        WHERE document_version_id = ?
      `).get(initial.version.id) as { count: number }).count).toBe(oldChunkCount);
      fixture.db.exec('CREATE TABLE cleanup_responsiveness_probe (id INTEGER PRIMARY KEY, value INTEGER)');
      fixture.db.prepare(
        'INSERT INTO cleanup_responsiveness_probe (id, value) VALUES (1, 0)',
      ).run();
      const updateProbe = fixture.db.prepare(
        'UPDATE cleanup_responsiveness_probe SET value = value + 1 WHERE id = 1',
      );
      let expectedAt = performance.now() + 25;
      timer = setInterval(() => {
        const writeStartedAt = performance.now();
        try {
          updateProbe.run();
        } catch (error) {
          probeErrors.push(error);
        }
        const now = performance.now();
        mainWriteDurations.push(now - writeStartedAt);
        drifts.push(Math.max(0, now - expectedAt));
        expectedAt = now + 25;
      }, 25);

      const result = await executor.runUntilIdle();
      await new Promise(resolve => setTimeout(resolve, 75));
      clearInterval(timer);
      timer = null;

      const maxTimerDriftMs = Math.max(0, ...drifts);
      const maxMainWriteMs = Math.max(0, ...mainWriteDurations);
      console.log('[KnowledgeBase] Inactive-generation cleanup responsiveness metrics:', {
        oldChunkCount,
        ...result,
        maxTimerDriftMs,
        maxMainWriteMs,
      });
      expect(result).toEqual({
        indexedCount: 1,
        failedCount: 0,
      });
      expect(probeErrors).toEqual([]);
      expect(drifts.length).toBeGreaterThanOrEqual(10);
      expect(maxTimerDriftMs).toBeLessThan(250);
      expect(maxMainWriteMs).toBeLessThan(250);
      expect(fixture.indexStore.getState(initial.version.id)).toBeNull();
      expect(fixture.indexStore.getState(replacement.version.id)?.status).toBe(
        KnowledgeDocumentIndexStatus.Indexed,
      );
      expect((fixture.db.prepare(`
        SELECT COUNT(*) AS count
        FROM knowledge_document_chunks
        WHERE document_version_id = ?
      `).get(initial.version.id) as { count: number }).count).toBe(0);
      expect((fixture.db.prepare(`
        SELECT COUNT(*) AS count
        FROM knowledge_document_chunks_fts
        WHERE document_version_id = ?
      `).get(initial.version.id) as { count: number }).count).toBe(0);
    } finally {
      if (timer) {
        clearInterval(timer);
      }
      if (executor) {
        await executor.shutdown().catch(() => undefined);
      }
      fixture?.close();
    }
  },
  180_000,
);
