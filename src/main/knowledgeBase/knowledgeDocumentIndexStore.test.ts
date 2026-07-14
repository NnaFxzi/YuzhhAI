import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import {
  KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS,
  KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS,
  KnowledgeBaseErrorCode,
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
  buildKnowledgeChunkId,
  chunkKnowledgeDocumentVersion,
} from './knowledgeDocumentChunker';
import {
  KnowledgeDocumentIndexStateError,
  KnowledgeDocumentIndexStore,
} from './knowledgeDocumentIndexStore';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';

const ensureWorkspace = (db: Database.Database, workspaceId: string): void => {
  new EnterpriseLeadWorkspaceStore(db);
  const now = '2026-07-11T00:00:00.000Z';
  db.prepare(`
    INSERT OR IGNORE INTO enterprise_lead_workspaces (
      id, name, type, profile, extraction_sources, risk_rules,
      enabled_agent_roles, settings, workspace_agents, recent_run_id,
      created_at, updated_at
    ) VALUES (?, ?, 'enterprise_lead', '{}', '[]', '[]', '[]', NULL, NULL, NULL, ?, ?)
  `).run(workspaceId, workspaceId, now, now);
};

const probeRuntimeTrigramAvailability = (db: Database.Database): boolean => {
  const tableName = `temp.test_trigram_capability_${randomUUID().replace(/-/g, '')}`;
  let available = false;
  try {
    db.exec(`CREATE VIRTUAL TABLE ${tableName} USING fts5(value, tokenize='trigram')`);
    available = true;
  } catch {
    available = false;
  } finally {
    db.exec(`DROP TABLE IF EXISTS ${tableName}`);
  }
  return available;
};

const createReadyDocument = (
  documents: KnowledgeDocumentStore,
  workspaceId: string,
  extractedText: string | null,
) => {
  const created = documents.createDocumentWithVersion({
    workspaceId,
    displayName: `${randomUUID()}.txt`,
    sourceMode: KnowledgeDocumentSourceMode.Managed,
    status: extractedText
      ? KnowledgeDocumentStatus.Ready
      : KnowledgeDocumentStatus.CompletedWithoutText,
    version: {
      contentHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
      managedPath: `blobs/test/${randomUUID()}`,
      mimeType: 'text/plain',
      fileSize: extractedText?.length ?? 0,
      sourceMtime: null,
      parser: 'text',
      extractedText,
      extractionPartial: false,
    },
  });
  return { ...created, text: extractedText ?? '' };
};

const createScheduledIndexStore = () => {
  const db = new Database(':memory:');
  ensureWorkspace(db, 'workspace-a');
  const documents = new KnowledgeDocumentStore(db);
  const target = createReadyDocument(documents, 'workspace-a', 'searchable target text');
  const store = new KnowledgeDocumentIndexStore(db, {
    resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
  });
  store.scheduleCurrentVersion({
    workspaceId: target.document.workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
  });
  return { db, documents, store, target };
};

const createStageContentionFixture = () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-stage-contention-'));
  const databasePath = path.join(tempDirectory, 'knowledge.sqlite');
  let db: Database.Database | null = null;
  let competingDb: Database.Database | null = null;

  try {
    db = new Database(databasePath);
    applySqliteConnectionPolicy(db);
    ensureWorkspace(db, 'workspace-a');
    const documents = new KnowledgeDocumentStore(db);
    const target = createReadyDocument(documents, 'workspace-a', 'contention target');
    const store = new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });
    store.scheduleCurrentVersion({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
    });
    const claim = store.claimNext()!;
    const chunks = chunkKnowledgeDocumentVersion({
      documentVersionId: target.version.id,
      text: target.text,
    });
    db.exec('CREATE TABLE stage_contention_probe (value INTEGER NOT NULL)');
    db.prepare('INSERT INTO stage_contention_probe (value) VALUES (0)').run();

    competingDb = new Database(databasePath);
    applySqliteConnectionPolicy(competingDb);
    competingDb.pragma('busy_timeout = 0');
    const updateProbe = competingDb.prepare(
      'UPDATE stage_contention_probe SET value = value + 1',
    );
    const originalPrepare = db.prepare.bind(db);
    let leaseReadCount = 0;
    let chunkInsertCount = 0;
    let purgeReadCount = 0;
    let onLeaseRead: (count: number) => void = () => undefined;
    let onPurgeRead: (count: number) => void = () => undefined;
    let runChunkInsert = (_count: number, run: () => unknown): unknown => run();
    Object.defineProperty(db, 'prepare', {
      configurable: true,
      value: (source: string) => {
        const statement = originalPrepare(source);
        if (source.includes('SELECT\n        state.status')) {
          return new Proxy(statement, {
            get(targetStatement, property) {
              if (property !== 'get') {
                return Reflect.get(targetStatement, property, targetStatement);
              }
              return (...parameters: unknown[]) => {
                const row = targetStatement.get(...parameters);
                leaseReadCount += 1;
                onLeaseRead(leaseReadCount);
                return row;
              };
            },
          });
        }
        if (source.includes('INSERT INTO knowledge_document_chunks (')) {
          return new Proxy(statement, {
            get(targetStatement, property) {
              if (property !== 'run') {
                return Reflect.get(targetStatement, property, targetStatement);
              }
              return (...parameters: unknown[]) => {
                chunkInsertCount += 1;
                return runChunkInsert(
                  chunkInsertCount,
                  () => targetStatement.run(...parameters),
                );
              };
            },
          });
        }
        if (source.includes('SELECT chunk.storage_id')) {
          return new Proxy(statement, {
            get(targetStatement, property) {
              if (property !== 'all') {
                return Reflect.get(targetStatement, property, targetStatement);
              }
              return (...parameters: unknown[]) => {
                const rows = targetStatement.all(...parameters);
                purgeReadCount += 1;
                onPurgeRead(purgeReadCount);
                return rows;
              };
            },
          });
        }
        return statement;
      },
    });

    return {
      db,
      store,
      target,
      claim,
      chunks,
      competingDb,
      updateProbe,
      getChunkInsertCount: (): number => chunkInsertCount,
      getLeaseReadCount: (): number => leaseReadCount,
      getPurgeReadCount: (): number => purgeReadCount,
      setChunkInsertRunner: (
        listener: (count: number, run: () => unknown) => unknown,
      ): void => {
        runChunkInsert = listener;
      },
      setOnLeaseRead: (listener: (count: number) => void): void => {
        onLeaseRead = listener;
      },
      setOnPurgeRead: (listener: (count: number) => void): void => {
        onPurgeRead = listener;
      },
      close: (): void => {
        try {
          competingDb?.close();
        } finally {
          try {
            db?.close();
          } finally {
            fs.rmSync(tempDirectory, { recursive: true, force: true });
          }
        }
      },
    };
  } catch (error) {
    try {
      competingDb?.close();
    } finally {
      try {
        db?.close();
      } finally {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
      }
    }
    throw error;
  }
};

const createClaimContentionFixture = () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-claim-contention-'));
  const databasePath = path.join(tempDirectory, 'knowledge.sqlite');
  let db: Database.Database | null = null;
  let competingDb: Database.Database | null = null;

  try {
    db = new Database(databasePath);
    applySqliteConnectionPolicy(db);
    ensureWorkspace(db, 'workspace-a');
    const documents = new KnowledgeDocumentStore(db);
    const target = createReadyDocument(documents, 'workspace-a', 'claim contention target');
    const store = new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });
    store.scheduleCurrentVersion({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
    });
    db.exec('CREATE TABLE claim_contention_probe (value INTEGER NOT NULL)');
    db.prepare('INSERT INTO claim_contention_probe (value) VALUES (0)').run();

    competingDb = new Database(databasePath);
    applySqliteConnectionPolicy(competingDb);
    const updateProbe = competingDb.prepare(
      'UPDATE claim_contention_probe SET value = value + 1',
    );
    const originalPrepare = db.prepare.bind(db);
    let pendingReadCount = 0;
    Object.defineProperty(db, 'prepare', {
      configurable: true,
      value: (source: string) => {
        const statement = originalPrepare(source);
        if (!source.includes('SELECT state.document_version_id')) {
          return statement;
        }
        return new Proxy(statement, {
          get(targetStatement, property) {
            if (property !== 'get') {
              return Reflect.get(targetStatement, property, targetStatement);
            }
            return (...parameters: unknown[]) => {
              const row = targetStatement.get(...parameters);
              pendingReadCount += 1;
              if (pendingReadCount === 1) {
                updateProbe.run();
              }
              return row;
            };
          },
        });
      },
    });

    return {
      db,
      store,
      target,
      getPendingReadCount: (): number => pendingReadCount,
      close: (): void => {
        try {
          competingDb?.close();
        } finally {
          try {
            db?.close();
          } finally {
            fs.rmSync(tempDirectory, { recursive: true, force: true });
          }
        }
      },
    };
  } catch (error) {
    try {
      competingDb?.close();
    } finally {
      try {
        db?.close();
      } finally {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
      }
    }
    throw error;
  }
};

const createRecoveryContentionFixture = () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-recovery-contention-'));
  const databasePath = path.join(tempDirectory, 'knowledge.sqlite');
  let db: Database.Database | null = null;
  let competingDb: Database.Database | null = null;

  try {
    db = new Database(databasePath);
    applySqliteConnectionPolicy(db);
    ensureWorkspace(db, 'workspace-a');
    const documents = new KnowledgeDocumentStore(db);
    const target = createReadyDocument(documents, 'workspace-a', 'recovery contention target');
    const store = new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });
    store.scheduleCurrentVersion({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
    });
    const claim = store.claimNext('2026-07-11T00:10:00.000Z')!;
    db.exec('CREATE TABLE recovery_contention_probe (value INTEGER NOT NULL)');
    db.prepare('INSERT INTO recovery_contention_probe (value) VALUES (0)').run();

    competingDb = new Database(databasePath);
    applySqliteConnectionPolicy(competingDb);
    competingDb.pragma('busy_timeout = 0');
    const updateProbe = competingDb.prepare(
      'UPDATE recovery_contention_probe SET value = value + 1',
    );
    const originalPrepare = db.prepare.bind(db);
    let recoveryReadCount = 0;
    Object.defineProperty(db, 'prepare', {
      configurable: true,
      value: (source: string) => {
        const statement = originalPrepare(source);
        if (!source.includes('state.active_attempt_id\n          FROM knowledge_document_index_state')) {
          return statement;
        }
        return new Proxy(statement, {
          get(targetStatement, property) {
            if (property !== 'all') {
              return Reflect.get(targetStatement, property, targetStatement);
            }
            return (...parameters: unknown[]) => {
              const rows = targetStatement.all(...parameters);
              recoveryReadCount += 1;
              if (recoveryReadCount === 1) {
                updateProbe.run();
              }
              return rows;
            };
          },
        });
      },
    });

    return {
      db,
      store,
      target,
      claim,
      getRecoveryReadCount: (): number => recoveryReadCount,
      close: (): void => {
        try {
          competingDb?.close();
        } finally {
          try {
            db?.close();
          } finally {
            fs.rmSync(tempDirectory, { recursive: true, force: true });
          }
        }
      },
    };
  } catch (error) {
    try {
      competingDb?.close();
    } finally {
      try {
        db?.close();
      } finally {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
      }
    }
    throw error;
  }
};

const scheduleText = (
  documents: KnowledgeDocumentStore,
  store: KnowledgeDocumentIndexStore,
  workspaceId: string,
  text: string,
) => {
  const target = createReadyDocument(documents, workspaceId, text);
  store.scheduleCurrentVersion({
    workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
  });
  return target;
};

const publishTarget = (
  store: KnowledgeDocumentIndexStore,
  target: ReturnType<typeof createReadyDocument>,
) => {
  const claim = store.claimNext();
  if (!claim || claim.state.documentVersionId !== target.version.id) {
    throw new Error('Expected the target version to be the next index claim');
  }
  const chunks = chunkKnowledgeDocumentVersion({
    documentVersionId: target.version.id,
    text: target.text,
  });
  for (let offset = 0; offset < chunks.length; offset += KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS) {
    store.stageVersionBatch({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: claim.attempt.id,
      chunks: chunks.slice(offset, offset + KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS),
    });
  }
  return store.publishVersion({
    workspaceId: target.document.workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
    attemptId: claim.attempt.id,
    chunkCount: chunks.length,
  });
};

const createIndexStoreWithTokenizer = (tokenizer: KnowledgeDocumentIndexTokenizer) => {
  const db = new Database(':memory:');
  ensureWorkspace(db, 'workspace-a');
  ensureWorkspace(db, 'workspace-b');
  const documents = new KnowledgeDocumentStore(db);
  const store = new KnowledgeDocumentIndexStore(db, {
    resolveTokenizer: () => tokenizer,
  });
  return { db, documents, store };
};

const publishText = (
  documents: KnowledgeDocumentStore,
  store: KnowledgeDocumentIndexStore,
  workspaceId: string,
  text: string,
) => publishTarget(store, scheduleText(documents, store, workspaceId, text));

describe('KnowledgeDocumentIndexStore', () => {
  test('persists one tokenizer choice and schedules text or not-applicable state', () => {
    const db = new Database(':memory:');
    ensureWorkspace(db, 'workspace-a');
    const documents = new KnowledgeDocumentStore(db);
    const withText = createReadyDocument(documents, 'workspace-a', '可搜索正文');
    const withoutText = createReadyDocument(documents, 'workspace-a', null);
    const store = new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });

    expect(store.scheduleCurrentVersion({
      workspaceId: withText.document.workspaceId,
      documentId: withText.document.id,
      documentVersionId: withText.version.id,
    }, '2026-07-11T00:01:00.000Z')).toMatchObject({
      status: KnowledgeDocumentIndexStatus.Pending,
      completedAt: null,
    });
    expect(store.scheduleCurrentVersion({
      workspaceId: withoutText.document.workspaceId,
      documentId: withoutText.document.id,
      documentVersionId: withoutText.version.id,
    }, '2026-07-11T00:02:00.000Z')).toMatchObject({
      status: KnowledgeDocumentIndexStatus.NotApplicable,
      completedAt: '2026-07-11T00:02:00.000Z',
    });
    expect(store.getTokenizer()).toBe(KnowledgeDocumentIndexTokenizer.CjkBigramV1);
    expect(db.prepare(`
      SELECT tokenizer_mode, tokenizer_version
      FROM knowledge_document_index_config
      WHERE singleton_id = 1
    `).get()).toEqual({
      tokenizer_mode: KnowledgeDocumentIndexTokenizer.CjkBigramV1,
      tokenizer_version: KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });
    db.close();
  });

  test('persists the runtime tokenizer capability and cleans up its temporary probe', () => {
    const db = new Database(':memory:');
    try {
      ensureWorkspace(db, 'workspace-a');
      const trigramAvailable = probeRuntimeTrigramAvailability(db);
      const expectedTokenizer = trigramAvailable
        ? KnowledgeDocumentIndexTokenizer.TrigramV1
        : KnowledgeDocumentIndexTokenizer.CjkBigramV1;
      const store = new KnowledgeDocumentIndexStore(db);

      expect(db.prepare(`
        SELECT trigram_available, tokenizer_version
        FROM knowledge_document_index_config
        WHERE singleton_id = 1
      `).get()).toEqual({
        trigram_available: trigramAvailable ? 1 : 0,
        tokenizer_version: expectedTokenizer,
      });
      expect(store.getTokenizer()).toBe(expectedTokenizer);
      expect(db.prepare(`
        SELECT name
        FROM sqlite_temp_master
        WHERE type = 'table' AND name GLOB 'knowledge_trigram_probe_*'
      `).all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  test('schedules whitespace-only extracted text as completed not-applicable state', () => {
    const db = new Database(':memory:');
    try {
      ensureWorkspace(db, 'workspace-a');
      const documents = new KnowledgeDocumentStore(db);
      const target = createReadyDocument(documents, 'workspace-a', '   ');
      const store = new KnowledgeDocumentIndexStore(db, {
        resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
      });
      const now = '2026-07-11T00:03:00.000Z';

      const state = store.scheduleCurrentVersion({
        workspaceId: target.document.workspaceId,
        documentId: target.document.id,
        documentVersionId: target.version.id,
      }, now);

      expect(state.status).toBe(KnowledgeDocumentIndexStatus.NotApplicable);
      expect(state.completedAt).toBe(now);
    } finally {
      db.close();
    }
  });

  test('claims pending state and creates one immutable running attempt', () => {
    const { db, store, target } = createScheduledIndexStore();
    const claim = store.claimNext('2026-07-11T00:01:00.000Z');

    expect(claim?.state).toMatchObject({
      status: KnowledgeDocumentIndexStatus.Indexing,
      attemptCount: 1,
      activeAttemptId: claim?.attempt.id,
      heartbeatAt: '2026-07-11T00:01:00.000Z',
    });
    expect(claim?.attempt).toMatchObject({
      attemptNumber: 1,
      outcome: KnowledgeDocumentIndexAttemptOutcome.Running,
      finishedAt: null,
    });
    expect(claim?.extractedText).toBe(target.text);
    expect(store.claimNext()).toBeNull();
    expect(store.listAttempts(target.version.id)).toEqual([claim?.attempt]);
    expect(store.getSummary(target.version.id)).toMatchObject({
      documentVersionId: target.version.id,
      status: KnowledgeDocumentIndexStatus.Indexing,
      attemptCount: 1,
    });
    db.close();
  });

  test('retries the whole claim transaction after a competing writer changes its snapshot', () => {
    const fixture = createClaimContentionFixture();
    try {
      const claim = fixture.store.claimNext('2026-07-11T00:01:00.000Z');

      expect(fixture.getPendingReadCount()).toBe(2);
      expect(claim).toMatchObject({
        state: {
          documentVersionId: fixture.target.version.id,
          status: KnowledgeDocumentIndexStatus.Indexing,
          attemptCount: 1,
        },
        attempt: {
          attemptNumber: 1,
          outcome: KnowledgeDocumentIndexAttemptOutcome.Running,
        },
        extractedText: fixture.target.text,
      });
      expect(fixture.store.listAttempts(fixture.target.version.id)).toEqual([
        claim?.attempt,
      ]);
    } finally {
      fixture.close();
    }
  });

  test('does not claim deleted, non-current, or workspace-orphaned versions', () => {
    const deletedSetup = createScheduledIndexStore();
    deletedSetup.documents.softDeleteDocument(
      deletedSetup.target.document.id,
      deletedSetup.target.document.revision,
    );
    expect(deletedSetup.store.claimNext()).toBeNull();
    deletedSetup.db.close();

    const nonCurrentSetup = createScheduledIndexStore();
    nonCurrentSetup.documents.addVersion(
      nonCurrentSetup.target.document.id,
      nonCurrentSetup.target.document.revision,
      {
        contentHash: 'b'.repeat(64),
        managedPath: `blobs/test/${randomUUID()}`,
        mimeType: 'text/plain',
        fileSize: 12,
        sourceMtime: null,
        parser: 'text',
        extractedText: 'newer text',
        extractionPartial: false,
      },
    );
    expect(nonCurrentSetup.store.claimNext()).toBeNull();
    nonCurrentSetup.db.close();

    const orphanedSetup = createScheduledIndexStore();
    new EnterpriseLeadWorkspaceStore(orphanedSetup.db).deleteWorkspace('workspace-a');
    expect(orphanedSetup.store.claimNext()).toBeNull();
    orphanedSetup.db.close();
  });

  test('keeps the persisted tokenizer when a later runtime resolver disagrees', () => {
    const db = new Database(':memory:');
    ensureWorkspace(db, 'workspace-a');
    const first = new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });
    expect(first.getTokenizer()).toBe(KnowledgeDocumentIndexTokenizer.CjkBigramV1);

    const reopened = new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.TrigramV1,
    });
    expect(reopened.getTokenizer()).toBe(KnowledgeDocumentIndexTokenizer.CjkBigramV1);
    db.close();
  });

  test('rejects a persisted tokenizer that disagrees with the existing FTS table', () => {
    const db = new Database(':memory:');
    ensureWorkspace(db, 'workspace-a');
    new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });
    db.exec(`
      DROP TABLE knowledge_document_chunks_fts;
      CREATE VIRTUAL TABLE knowledge_document_chunks_fts USING fts5(
        search_text,
        tokenize='unicode61'
      );
    `);

    expect(() => new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.TrigramV1,
    })).toThrow('Persisted knowledge index tokenizer does not match the FTS table');
    db.close();
  });

  test('rejects workspace, document, version, and deletion mismatches without creating state', () => {
    const db = new Database(':memory:');
    ensureWorkspace(db, 'workspace-a');
    ensureWorkspace(db, 'workspace-b');
    const documents = new KnowledgeDocumentStore(db);
    const first = createReadyDocument(documents, 'workspace-a', 'first');
    const second = createReadyDocument(documents, 'workspace-a', 'second');
    const store = new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });
    const expectConflict = (input: {
      workspaceId: string;
      documentId: string;
      documentVersionId: string;
    }): void => {
      expect(() => store.scheduleCurrentVersion(input)).toThrowError(
        expect.objectContaining({
          name: KnowledgeDocumentIndexStateError.name,
          code: KnowledgeBaseErrorCode.JobStateConflict,
        }),
      );
    };

    expectConflict({
      workspaceId: 'workspace-b',
      documentId: first.document.id,
      documentVersionId: first.version.id,
    });
    expectConflict({
      workspaceId: 'workspace-a',
      documentId: first.document.id,
      documentVersionId: second.version.id,
    });
    expectConflict({
      workspaceId: 'workspace-a',
      documentId: randomUUID(),
      documentVersionId: first.version.id,
    });
    new EnterpriseLeadWorkspaceStore(db).deleteWorkspace('workspace-b');
    expectConflict({
      workspaceId: 'workspace-b',
      documentId: first.document.id,
      documentVersionId: first.version.id,
    });
    documents.softDeleteDocument(first.document.id, first.document.revision);
    expectConflict({
      workspaceId: 'workspace-a',
      documentId: first.document.id,
      documentVersionId: first.version.id,
    });
    expect(store.listStates('workspace-a')).toEqual([]);
    db.close();
  });

  test('rejects scheduling a version after it stops being current', () => {
    const db = new Database(':memory:');
    ensureWorkspace(db, 'workspace-a');
    const documents = new KnowledgeDocumentStore(db);
    const first = createReadyDocument(documents, 'workspace-a', 'old text');
    documents.addVersion(first.document.id, first.document.revision, {
      contentHash: 'c'.repeat(64),
      managedPath: `blobs/test/${randomUUID()}`,
      mimeType: 'text/plain',
      fileSize: 8,
      sourceMtime: null,
      parser: 'text',
      extractedText: 'new text',
      extractionPartial: false,
    });
    const store = new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });

    expect(() => store.scheduleCurrentVersion({
      workspaceId: first.document.workspaceId,
      documentId: first.document.id,
      documentVersionId: first.version.id,
    })).toThrow(KnowledgeDocumentIndexStateError);
    expect(store.getState(first.version.id)).toBeNull();
    db.close();
  });

  test('heartbeats only while the state and running attempt own the lease', () => {
    const { db, store, target } = createScheduledIndexStore();
    const claim = store.claimNext('2026-07-11T00:01:00.000Z');
    expect(claim).not.toBeNull();

    expect(store.heartbeat({
      documentVersionId: target.version.id,
      attemptId: randomUUID(),
    }, '2026-07-11T00:02:00.000Z')).toBe(false);
    expect(store.heartbeat({
      documentVersionId: target.version.id,
      attemptId: claim!.attempt.id,
    }, '2026-07-11T00:03:00.000Z')).toBe(true);
    expect(store.getState(target.version.id)?.heartbeatAt).toBe(
      '2026-07-11T00:03:00.000Z',
    );

    db.prepare(`
      UPDATE knowledge_document_index_attempts
      SET outcome = ?, finished_at = ?
      WHERE id = ?
    `).run(
      KnowledgeDocumentIndexAttemptOutcome.Abandoned,
      '2026-07-11T00:04:00.000Z',
      claim!.attempt.id,
    );
    expect(store.heartbeat({
      documentVersionId: target.version.id,
      attemptId: claim!.attempt.id,
    }, '2026-07-11T00:05:00.000Z')).toBe(false);
    expect(store.getState(target.version.id)?.heartbeatAt).toBe(
      '2026-07-11T00:03:00.000Z',
    );
    db.close();
  });

  test('abandons only stale indexing attempts and reclaims with the next attempt number', () => {
    const { db, store, target } = createScheduledIndexStore();
    const firstClaim = store.claimNext('2026-07-11T00:10:00.000Z');
    expect(firstClaim).not.toBeNull();

    expect(store.recoverAbandonedIndexing(
      '2026-07-11T00:09:00.000Z',
      '2026-07-11T00:11:00.000Z',
    )).toBe(0);
    expect(store.recoverAbandonedIndexing(
      '2026-07-11T00:10:01.000Z',
      '2026-07-11T00:12:00.000Z',
    )).toBe(1);
    expect(store.getState(target.version.id)).toMatchObject({
      status: KnowledgeDocumentIndexStatus.Pending,
      attemptCount: 1,
      activeAttemptId: null,
      startedAt: null,
      heartbeatAt: null,
    });
    expect(store.listAttempts(target.version.id)[0]).toMatchObject({
      id: firstClaim!.attempt.id,
      outcome: KnowledgeDocumentIndexAttemptOutcome.Abandoned,
      finishedAt: '2026-07-11T00:12:00.000Z',
    });

    const secondClaim = store.claimNext('2026-07-11T00:13:00.000Z');
    expect(secondClaim?.attempt).toMatchObject({
      attemptNumber: 2,
      outcome: KnowledgeDocumentIndexAttemptOutcome.Running,
    });
    expect(store.listAttempts(target.version.id)).toHaveLength(2);
    db.close();
  });

  test('recovers an indexing attempt whose heartbeat is null', () => {
    const { db, store, target } = createScheduledIndexStore();
    store.claimNext('2026-07-11T00:10:00.000Z');
    db.prepare(`
      UPDATE knowledge_document_index_state
      SET heartbeat_at = NULL
      WHERE document_version_id = ?
    `).run(target.version.id);

    expect(store.recoverAbandonedIndexing(
      '2026-07-11T00:00:00.000Z',
      '2026-07-11T00:11:00.000Z',
    )).toBe(1);
    expect(store.getState(target.version.id)?.status).toBe(
      KnowledgeDocumentIndexStatus.Pending,
    );
    db.close();
  });

  test('retries abandoned-attempt recovery from a fresh snapshot after writer contention', () => {
    const fixture = createRecoveryContentionFixture();
    try {
      expect(fixture.store.recoverAbandonedIndexing(
        '2026-07-11T00:10:01.000Z',
        '2026-07-11T00:11:00.000Z',
      )).toBe(1);
      expect(fixture.getRecoveryReadCount()).toBe(2);
      expect(fixture.store.getState(fixture.target.version.id)).toMatchObject({
        status: KnowledgeDocumentIndexStatus.Pending,
        activeAttemptId: null,
      });
      expect(fixture.store.listAttempts(fixture.target.version.id)).toContainEqual(
        expect.objectContaining({
          id: fixture.claim.attempt.id,
          outcome: KnowledgeDocumentIndexAttemptOutcome.Abandoned,
        }),
      );
    } finally {
      fixture.close();
    }
  });

  test('reconciles only active current ready versions in existing workspaces', () => {
    const db = new Database(':memory:');
    ensureWorkspace(db, 'workspace-a');
    const documents = new KnowledgeDocumentStore(db);
    const withText = createReadyDocument(documents, 'workspace-a', 'reconcile me');
    const withoutText = createReadyDocument(documents, 'workspace-a', null);
    const deleted = createReadyDocument(documents, 'workspace-a', 'deleted');
    documents.softDeleteDocument(deleted.document.id, deleted.document.revision);
    const processing = createReadyDocument(documents, 'workspace-a', 'not ready');
    documents.updateDocumentMetadata(processing.document.id, processing.document.revision, {
      status: KnowledgeDocumentStatus.Processing,
    });
    const orphaned = createReadyDocument(documents, 'workspace-missing', 'orphaned');
    const versioned = createReadyDocument(documents, 'workspace-a', 'old version');
    const current = documents.addVersion(versioned.document.id, versioned.document.revision, {
      contentHash: 'd'.repeat(64),
      managedPath: `blobs/test/${randomUUID()}`,
      mimeType: 'text/plain',
      fileSize: 15,
      sourceMtime: null,
      parser: 'text',
      extractedText: 'current version',
      extractionPartial: false,
    });
    const store = new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });

    expect(store.reconcileMissingStates('2026-07-11T00:20:00.000Z')).toEqual({
      pendingCount: 2,
      notApplicableCount: 1,
    });
    expect(store.getState(withText.version.id)?.status).toBe(
      KnowledgeDocumentIndexStatus.Pending,
    );
    expect(store.getState(withoutText.version.id)?.status).toBe(
      KnowledgeDocumentIndexStatus.NotApplicable,
    );
    expect(store.getState(current.version.id)?.status).toBe(
      KnowledgeDocumentIndexStatus.Pending,
    );
    expect(store.getState(versioned.version.id)).toBeNull();
    expect(store.getState(deleted.version.id)).toBeNull();
    expect(store.getState(processing.version.id)).toBeNull();
    expect(store.getState(orphaned.version.id)).toBeNull();
    expect(store.listStates('workspace-a')).toHaveLength(3);
    expect(store.reconcileMissingStates('2026-07-11T00:21:00.000Z')).toEqual({
      pendingCount: 0,
      notApplicableCount: 0,
    });
    db.close();
  });

  test('publishes chunks, FTS rows, attempt, and state atomically for one version', () => {
    const { db, documents, store } = createIndexStoreWithTokenizer(
      KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    );
    const other = scheduleText(documents, store, 'workspace-a', 'other searchable text');
    publishTarget(store, other);
    const target = scheduleText(
      documents,
      store,
      'workspace-a',
      'target searchable text '.repeat(2_000),
    );

    const claim = store.claimNext('2026-07-11T00:00:02.000Z');
    const chunks = chunkKnowledgeDocumentVersion({
      documentVersionId: target.version.id,
      text: target.text,
    });
    for (let offset = 0; offset < chunks.length; offset += KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS) {
      store.stageVersionBatch({
        workspaceId: target.document.workspaceId,
        documentId: target.document.id,
        documentVersionId: target.version.id,
        attemptId: claim!.attempt.id,
        chunks: chunks.slice(offset, offset + KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS),
      });
    }

    expect(store.listVersionChunks(target.version.id)).toEqual([]);
    expect(store.searchWorkspace({
      workspaceId: target.document.workspaceId,
      query: 'target searchable',
    })).toEqual([]);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks
      WHERE document_version_id = ?
    `).get(target.version.id)).toEqual({ count: chunks.length });

    const indexed = store.publishVersion({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: claim!.attempt.id,
      chunkCount: chunks.length,
    });

    expect(indexed.status).toBe(KnowledgeDocumentIndexStatus.Indexed);
    expect(indexed.chunkCount).toBe(chunks.length);
    expect(indexed.publishedGenerationId).toBe(claim!.attempt.id);
    expect(store.searchWorkspace({
      workspaceId: target.document.workspaceId,
      query: 'target searchable',
    }).length).toBeGreaterThan(0);
    expect(store.listVersionChunks(other.version.id)).toHaveLength(1);
    expect(store.listAttempts(target.version.id).at(-1)?.outcome).toBe(
      KnowledgeDocumentIndexAttemptOutcome.Indexed,
    );
    db.close();
  });

  test('rejects empty, oversized, checksum, logical-id, and offset-invalid stage batches', () => {
    const { db, store, target } = createScheduledIndexStore();
    const claim = store.claimNext()!;
    const chunks = chunkKnowledgeDocumentVersion({
      documentVersionId: target.version.id,
      text: target.text,
      targetChars: 1,
      overlapChars: 0,
    });
    const input = {
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: claim.attempt.id,
    };

    expect(() => store.stageVersionBatch({ ...input, chunks: [] })).toThrow(/must contain/i);
    expect(() => store.stageVersionBatch({
      ...input,
      chunks: chunks.slice(0, KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS + 1),
    })).toThrow(/at most 8/i);
    expect(() => store.stageVersionBatch({
      ...input,
      chunks: [{ ...chunks[0], checksum: '0'.repeat(64) }],
    })).toThrow(/checksum/i);
    expect(() => store.stageVersionBatch({
      ...input,
      chunks: [{ ...chunks[0], id: '0'.repeat(64) }],
    })).toThrow(/logical chunk id/i);
    expect(() => store.stageVersionBatch({
      ...input,
      chunks: [{ ...chunks[0], endOffset: chunks[0].endOffset + 1 }],
    })).toThrow(/offset/i);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks
      WHERE document_version_id = ?
    `).get(target.version.id)).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks_fts
      WHERE document_version_id = ?
    `).get(target.version.id)).toEqual({ count: 0 });
    db.close();
  });

  test.each([
    [
      'fractional ordinal',
      (
        chunk: ReturnType<typeof chunkKnowledgeDocumentVersion>[number],
        checksum: string,
        documentVersionId: string,
      ) => {
        const ordinal = chunk.ordinal + 0.5;
        return {
          ...chunk,
          ordinal,
          checksum,
          id: buildKnowledgeChunkId({
            documentVersionId,
            ordinal,
            startOffset: chunk.startOffset,
            endOffset: chunk.endOffset,
            checksum,
          }),
        };
      },
    ],
    [
      'fractional offsets',
      (
        chunk: ReturnType<typeof chunkKnowledgeDocumentVersion>[number],
        checksum: string,
        documentVersionId: string,
      ) => {
        const startOffset = chunk.startOffset + 0.5;
        const endOffset = startOffset + chunk.content.length;
        return {
          ...chunk,
          startOffset,
          endOffset,
          checksum,
          id: buildKnowledgeChunkId({
            documentVersionId,
            ordinal: chunk.ordinal,
            startOffset,
            endOffset,
            checksum,
          }),
        };
      },
    ],
  ])('rejects %s before physical index writes', (_name, craftChunk) => {
    const { db, store, target } = createScheduledIndexStore();
    const claim = store.claimNext()!;
    const chunk = chunkKnowledgeDocumentVersion({
      documentVersionId: target.version.id,
      text: target.text,
    })[0];
    const checksum = createHash('sha256').update(chunk.content, 'utf8').digest('hex');
    const crafted = craftChunk(chunk, checksum, target.version.id);
    let thrown: unknown = null;
    try {
      store.stageVersionBatch({
        workspaceId: target.document.workspaceId,
        documentId: target.document.id,
        documentVersionId: target.version.id,
        attemptId: claim.attempt.id,
        chunks: [crafted],
      });
    } catch (error) {
      thrown = error;
    }

    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks
      WHERE document_version_id = ?
    `).get(target.version.id)).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks_fts
      WHERE document_version_id = ?
    `).get(target.version.id)).toEqual({ count: 0 });
    expect(thrown).toEqual(expect.objectContaining({
      message: expect.stringMatching(/non-negative integers/i),
    }));
    expect(store.getState(target.version.id)?.status).toBe(
      KnowledgeDocumentIndexStatus.Indexing,
    );
    db.close();
  });

  test('rolls back both physical tables when a duplicate staged chunk violates uniqueness', () => {
    const { db, store, target } = createScheduledIndexStore();
    const claim = store.claimNext()!;
    const chunk = chunkKnowledgeDocumentVersion({
      documentVersionId: target.version.id,
      text: target.text,
    })[0];

    expect(() => store.stageVersionBatch({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: claim.attempt.id,
      chunks: [chunk, chunk],
    })).toThrow(/unique constraint failed/i);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks
      WHERE document_version_id = ?
    `).get(target.version.id)).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks_fts
      WHERE document_version_id = ?
    `).get(target.version.id)).toEqual({ count: 0 });
    expect(store.getState(target.version.id)?.status).toBe(
      KnowledgeDocumentIndexStatus.Indexing,
    );
    db.close();
  });

  test('retries staging from a fresh snapshot after one competing writer commits', () => {
    const fixture = createStageContentionFixture();
    try {
      fixture.setOnLeaseRead(count => {
        if (count === 1) {
          fixture.updateProbe.run();
        }
      });

      expect(() => fixture.store.stageVersionBatch({
        workspaceId: fixture.target.document.workspaceId,
        documentId: fixture.target.document.id,
        documentVersionId: fixture.target.version.id,
        attemptId: fixture.claim.attempt.id,
        chunks: fixture.chunks,
      })).not.toThrow();
      expect(fixture.getLeaseReadCount()).toBe(2);
      expect(fixture.db.prepare(`
        SELECT COUNT(*) AS count
        FROM knowledge_document_chunks
        WHERE document_version_id = ?
      `).get(fixture.target.version.id)).toEqual({ count: fixture.chunks.length });
      expect(fixture.db.prepare(`
        SELECT COUNT(*) AS count
        FROM knowledge_document_chunks_fts
        WHERE document_version_id = ?
      `).get(fixture.target.version.id)).toEqual({ count: fixture.chunks.length });
    } finally {
      fixture.close();
    }
  });

  test('retries staging after an ordinary busy write-upgrade conflict', () => {
    const fixture = createStageContentionFixture();
    try {
      fixture.setChunkInsertRunner((count, run) => {
        if (count !== 1) {
          return run();
        }
        fixture.competingDb.exec('BEGIN IMMEDIATE');
        try {
          return run();
        } finally {
          fixture.competingDb.exec('COMMIT');
        }
      });

      expect(() => fixture.store.stageVersionBatch({
        workspaceId: fixture.target.document.workspaceId,
        documentId: fixture.target.document.id,
        documentVersionId: fixture.target.version.id,
        attemptId: fixture.claim.attempt.id,
        chunks: fixture.chunks,
      })).not.toThrow();
      expect(fixture.getLeaseReadCount()).toBe(2);
      expect(fixture.getChunkInsertCount()).toBe(2);
      expect(fixture.db.prepare(`
        SELECT COUNT(*) AS count
        FROM knowledge_document_chunks
        WHERE document_version_id = ?
      `).get(fixture.target.version.id)).toEqual({ count: fixture.chunks.length });
      expect(fixture.db.prepare(`
        SELECT COUNT(*) AS count
        FROM knowledge_document_chunks_fts
        WHERE document_version_id = ?
      `).get(fixture.target.version.id)).toEqual({ count: fixture.chunks.length });
    } finally {
      fixture.close();
    }
  });

  test('preserves the busy-snapshot error after the bounded stage retry limit', () => {
    const fixture = createStageContentionFixture();
    try {
      fixture.setOnLeaseRead(() => {
        fixture.updateProbe.run();
      });

      let thrown: unknown = null;
      try {
        fixture.store.stageVersionBatch({
          workspaceId: fixture.target.document.workspaceId,
          documentId: fixture.target.document.id,
          documentVersionId: fixture.target.version.id,
          attemptId: fixture.claim.attempt.id,
          chunks: fixture.chunks,
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toMatchObject({
        code: 'SQLITE_BUSY_SNAPSHOT',
        message: 'database is locked',
      });
      expect(fixture.getLeaseReadCount()).toBe(4);
      expect(fixture.db.prepare(`
        SELECT COUNT(*) AS count
        FROM knowledge_document_chunks
        WHERE document_version_id = ?
      `).get(fixture.target.version.id)).toEqual({ count: 0 });
      expect(fixture.db.prepare(`
        SELECT COUNT(*) AS count
        FROM knowledge_document_chunks_fts
        WHERE document_version_id = ?
      `).get(fixture.target.version.id)).toEqual({ count: 0 });
    } finally {
      fixture.close();
    }
  });

  test('retries the whole publish transaction after a competing writer changes its snapshot', () => {
    const fixture = createStageContentionFixture();
    try {
      fixture.store.stageVersionBatch({
        workspaceId: fixture.target.document.workspaceId,
        documentId: fixture.target.document.id,
        documentVersionId: fixture.target.version.id,
        attemptId: fixture.claim.attempt.id,
        chunks: fixture.chunks,
      });
      const leaseReadsBeforePublish = fixture.getLeaseReadCount();
      fixture.setOnLeaseRead(count => {
        if (count === leaseReadsBeforePublish + 1) {
          fixture.updateProbe.run();
        }
      });

      const published = fixture.store.publishVersion({
        workspaceId: fixture.target.document.workspaceId,
        documentId: fixture.target.document.id,
        documentVersionId: fixture.target.version.id,
        attemptId: fixture.claim.attempt.id,
        chunkCount: fixture.chunks.length,
      });

      expect(fixture.getLeaseReadCount()).toBe(leaseReadsBeforePublish + 2);
      expect(published).toMatchObject({
        status: KnowledgeDocumentIndexStatus.Indexed,
        chunkCount: fixture.chunks.length,
        activeAttemptId: null,
        publishedGenerationId: fixture.claim.attempt.id,
      });
      expect(fixture.store.listAttempts(fixture.target.version.id)).toEqual([
        expect.objectContaining({
          id: fixture.claim.attempt.id,
          outcome: KnowledgeDocumentIndexAttemptOutcome.Indexed,
        }),
      ]);
      expect(fixture.store.listVersionChunks(fixture.target.version.id))
        .toHaveLength(fixture.chunks.length);
    } finally {
      fixture.close();
    }
  });

  test('retries the whole purge transaction after a competing writer changes its snapshot', () => {
    const fixture = createStageContentionFixture();
    try {
      fixture.store.stageVersionBatch({
        workspaceId: fixture.target.document.workspaceId,
        documentId: fixture.target.document.id,
        documentVersionId: fixture.target.version.id,
        attemptId: fixture.claim.attempt.id,
        chunks: fixture.chunks,
      });
      fixture.store.failAttempt({
        documentVersionId: fixture.target.version.id,
        attemptId: fixture.claim.attempt.id,
        errorCode: KnowledgeDocumentIndexErrorCode.ProcessingFailed,
      });
      fixture.setOnPurgeRead(count => {
        if (count === 1) {
          fixture.updateProbe.run();
        }
      });

      expect(fixture.store.purgeInactiveGenerationBatch()).toBe(fixture.chunks.length);
      expect(fixture.getPurgeReadCount()).toBe(2);
      expect(fixture.db.prepare(`
        SELECT COUNT(*) AS count
        FROM knowledge_document_chunks
        WHERE document_version_id = ?
      `).get(fixture.target.version.id)).toEqual({ count: 0 });
      expect(fixture.db.prepare(`
        SELECT COUNT(*) AS count
        FROM knowledge_document_chunks_fts
        WHERE document_version_id = ?
      `).get(fixture.target.version.id)).toEqual({ count: 0 });
      expect(fixture.store.getState(fixture.target.version.id)).toMatchObject({
        status: KnowledgeDocumentIndexStatus.Failed,
        chunkCount: 0,
      });
    } finally {
      fixture.close();
    }
  });

  test('rejects non-positive, mismatched, and non-contiguous publication counts', () => {
    const { db, store, target } = createScheduledIndexStore();
    const claim = store.claimNext()!;
    const chunks = chunkKnowledgeDocumentVersion({
      documentVersionId: target.version.id,
      text: target.text,
      targetChars: 4,
      overlapChars: 0,
    });
    store.stageVersionBatch({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: claim.attempt.id,
      chunks: [chunks[1]],
    });
    const publish = (chunkCount: number) => store.publishVersion({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: claim.attempt.id,
      chunkCount,
    });

    expect(() => publish(0)).toThrow(KnowledgeDocumentIndexStateError);
    expect(() => publish(2)).toThrow(KnowledgeDocumentIndexStateError);
    expect(() => publish(1)).toThrow(KnowledgeDocumentIndexStateError);
    expect(store.listVersionChunks(target.version.id)).toEqual([]);
    expect(store.getState(target.version.id)).toMatchObject({
      status: KnowledgeDocumentIndexStatus.Indexing,
      activeAttemptId: claim.attempt.id,
      publishedGenerationId: null,
    });
    expect(store.listAttempts(target.version.id)[0].outcome).toBe(
      KnowledgeDocumentIndexAttemptOutcome.Running,
    );
    db.close();
  });

  test('rolls back attempt completion when the state activation CAS loses its lease', () => {
    const { db, store, target } = createScheduledIndexStore();
    const claim = store.claimNext()!;
    const chunks = chunkKnowledgeDocumentVersion({
      documentVersionId: target.version.id,
      text: target.text,
    });
    store.stageVersionBatch({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: claim.attempt.id,
      chunks,
    });
    db.exec(`
      CREATE TRIGGER test_steal_index_lease
      AFTER UPDATE OF outcome ON knowledge_document_index_attempts
      BEGIN
        UPDATE knowledge_document_index_state
        SET active_attempt_id = 'lost-lease'
        WHERE document_version_id = NEW.document_version_id;
      END;
    `);

    expect(() => store.publishVersion({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: claim.attempt.id,
      chunkCount: chunks.length,
    })).toThrow(KnowledgeDocumentIndexStateError);
    expect(store.listAttempts(target.version.id)[0].outcome).toBe(
      KnowledgeDocumentIndexAttemptOutcome.Running,
    );
    expect(store.getState(target.version.id)).toMatchObject({
      status: KnowledgeDocumentIndexStatus.Indexing,
      activeAttemptId: claim.attempt.id,
      publishedGenerationId: null,
    });
    expect(store.listVersionChunks(target.version.id)).toEqual([]);
    db.close();
  });

  test('rolls back a late publication after document deletion', () => {
    const { db, documents, store, target } = createScheduledIndexStore();
    const claim = store.claimNext()!;
    const chunks = chunkKnowledgeDocumentVersion({
      documentVersionId: target.version.id,
      text: target.text,
      targetChars: 4,
      overlapChars: 0,
    });
    store.stageVersionBatch({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: claim.attempt.id,
      chunks: [chunks[0]],
    });
    documents.softDeleteDocument(target.document.id, target.document.revision);

    expect(() => store.stageVersionBatch({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: claim.attempt.id,
      chunks: chunks.slice(1),
    })).toThrow(KnowledgeDocumentIndexStateError);
    expect(() => store.publishVersion({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: claim.attempt.id,
      chunkCount: chunks.length,
    })).toThrow(KnowledgeDocumentIndexStateError);
    expect(store.listVersionChunks(target.version.id)).toEqual([]);
    expect(store.getState(target.version.id)).toMatchObject({
      status: KnowledgeDocumentIndexStatus.Indexing,
      activeAttemptId: claim.attempt.id,
      publishedGenerationId: null,
    });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks
      WHERE document_version_id = ?
    `).get(target.version.id)).toEqual({ count: 1 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks_fts
      WHERE document_version_id = ?
    `).get(target.version.id)).toEqual({ count: 1 });
    store.deactivateVersion({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
    });
    db.close();
  });

  test('rejects an old-version publication and indexes only the replacement version', () => {
    const { db, documents, store, target } = createScheduledIndexStore();
    const oldClaim = store.claimNext()!;
    const oldChunks = chunkKnowledgeDocumentVersion({
      documentVersionId: target.version.id,
      text: target.text,
      targetChars: 4,
      overlapChars: 0,
    });
    store.stageVersionBatch({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: oldClaim.attempt.id,
      chunks: [oldChunks[0]],
    });
    const replacement = documents.addVersion(target.document.id, target.document.revision, {
      contentHash: 'b'.repeat(64),
      managedPath: 'blobs/bb/replacement',
      mimeType: 'text/plain',
      fileSize: 16,
      sourceMtime: null,
      parser: 'text',
      extractedText: 'replacement searchable text',
      extractionPartial: false,
    });

    expect(() => store.stageVersionBatch({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: oldClaim.attempt.id,
      chunks: oldChunks.slice(1),
    })).toThrow(KnowledgeDocumentIndexStateError);
    expect(() => store.publishVersion({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: oldClaim.attempt.id,
      chunkCount: oldChunks.length,
    })).toThrow(KnowledgeDocumentIndexStateError);
    expect(store.getState(target.version.id)).toMatchObject({
      status: KnowledgeDocumentIndexStatus.Indexing,
      activeAttemptId: oldClaim.attempt.id,
      publishedGenerationId: null,
    });
    expect(store.listVersionChunks(target.version.id)).toEqual([]);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks
      WHERE document_version_id = ?
    `).get(target.version.id)).toEqual({ count: 1 });
    store.deactivateVersion({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
    });
    store.scheduleCurrentVersion({
      workspaceId: replacement.document.workspaceId,
      documentId: replacement.document.id,
      documentVersionId: replacement.version.id,
    });
    publishTarget(store, { ...replacement, text: 'replacement searchable text' });
    expect(store.listVersionChunks(target.version.id)).toEqual([]);
    expect(store.listVersionChunks(replacement.version.id)).toHaveLength(1);
    db.close();
  });

  test('rejects staging and publication when the owning workspace no longer exists', () => {
    const stageSetup = createScheduledIndexStore();
    const stageClaim = stageSetup.store.claimNext()!;
    const stageChunks = chunkKnowledgeDocumentVersion({
      documentVersionId: stageSetup.target.version.id,
      text: stageSetup.target.text,
    });
    stageSetup.db.prepare('DELETE FROM enterprise_lead_workspaces WHERE id = ?')
      .run(stageSetup.target.document.workspaceId);
    expect(() => stageSetup.store.stageVersionBatch({
      workspaceId: stageSetup.target.document.workspaceId,
      documentId: stageSetup.target.document.id,
      documentVersionId: stageSetup.target.version.id,
      attemptId: stageClaim.attempt.id,
      chunks: stageChunks,
    })).toThrow(KnowledgeDocumentIndexStateError);
    stageSetup.db.close();

    const publishSetup = createScheduledIndexStore();
    const publishClaim = publishSetup.store.claimNext()!;
    const publishChunks = chunkKnowledgeDocumentVersion({
      documentVersionId: publishSetup.target.version.id,
      text: publishSetup.target.text,
    });
    publishSetup.store.stageVersionBatch({
      workspaceId: publishSetup.target.document.workspaceId,
      documentId: publishSetup.target.document.id,
      documentVersionId: publishSetup.target.version.id,
      attemptId: publishClaim.attempt.id,
      chunks: publishChunks,
    });
    publishSetup.db.prepare('DELETE FROM enterprise_lead_workspaces WHERE id = ?')
      .run(publishSetup.target.document.workspaceId);
    expect(() => publishSetup.store.publishVersion({
      workspaceId: publishSetup.target.document.workspaceId,
      documentId: publishSetup.target.document.id,
      documentVersionId: publishSetup.target.version.id,
      attemptId: publishClaim.attempt.id,
      chunkCount: publishChunks.length,
    })).toThrow(KnowledgeDocumentIndexStateError);
    expect(publishSetup.store.listVersionChunks(publishSetup.target.version.id)).toEqual([]);
    publishSetup.db.close();
  });

  test('fails only the active running attempt and validates stable error codes', () => {
    const { db, store, target } = createScheduledIndexStore();
    const claim = store.claimNext()!;

    expect(() => store.failAttempt({
      documentVersionId: target.version.id,
      attemptId: randomUUID(),
      errorCode: KnowledgeDocumentIndexErrorCode.ProcessingFailed,
    })).toThrow(KnowledgeDocumentIndexStateError);
    expect(() => store.failAttempt({
      documentVersionId: target.version.id,
      attemptId: claim.attempt.id,
      errorCode: 'not-stable' as KnowledgeDocumentIndexErrorCode,
    })).toThrow();
    expect(store.listAttempts(target.version.id)[0].outcome).toBe(
      KnowledgeDocumentIndexAttemptOutcome.Running,
    );

    const failed = store.failAttempt({
      documentVersionId: target.version.id,
      attemptId: claim.attempt.id,
      errorCode: KnowledgeDocumentIndexErrorCode.ProcessingFailed,
    }, '2026-07-11T01:00:00.000Z');
    expect(failed).toMatchObject({
      status: KnowledgeDocumentIndexStatus.Failed,
      chunkCount: 0,
      activeAttemptId: null,
      publishedGenerationId: null,
      errorCode: KnowledgeDocumentIndexErrorCode.ProcessingFailed,
      completedAt: '2026-07-11T01:00:00.000Z',
    });
    expect(store.listAttempts(target.version.id)[0]).toMatchObject({
      outcome: KnowledgeDocumentIndexAttemptOutcome.Failed,
      errorCode: KnowledgeDocumentIndexErrorCode.ProcessingFailed,
      finishedAt: '2026-07-11T01:00:00.000Z',
    });
    db.close();
  });

  test('retries a failed current version without changing document metadata', () => {
    const { db, documents, store, target } = createScheduledIndexStore();
    const firstClaim = store.claimNext()!;
    const chunks = chunkKnowledgeDocumentVersion({
      documentVersionId: target.version.id,
      text: target.text,
    });
    store.stageVersionBatch({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: firstClaim.attempt.id,
      chunks,
    });
    store.failAttempt({
      documentVersionId: target.version.id,
      attemptId: firstClaim.attempt.id,
      errorCode: KnowledgeDocumentIndexErrorCode.ProcessingFailed,
    });
    const documentBeforeRetry = documents.getDocument(target.document.id);

    expect(store.retryFailedVersion({
      documentId: target.document.id,
      documentVersionId: target.version.id,
    }, '2026-07-11T01:01:00.000Z')).toMatchObject({
      status: KnowledgeDocumentIndexStatus.Pending,
      attemptCount: 1,
      errorCode: null,
      requestedAt: '2026-07-11T01:01:00.000Z',
      completedAt: null,
    });
    expect(documents.getDocument(target.document.id)).toEqual(documentBeforeRetry);
    const secondClaim = store.claimNext()!;
    expect(secondClaim.attempt.attemptNumber).toBe(2);
    for (let offset = 0; offset < chunks.length; offset += KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS) {
      store.stageVersionBatch({
        workspaceId: target.document.workspaceId,
        documentId: target.document.id,
        documentVersionId: target.version.id,
        attemptId: secondClaim.attempt.id,
        chunks: chunks.slice(offset, offset + KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS),
      });
    }
    store.publishVersion({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: secondClaim.attempt.id,
      chunkCount: chunks.length,
    });
    expect(store.listVersionChunks(target.version.id)).toHaveLength(chunks.length);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks
      WHERE document_version_id = ?
    `).get(target.version.id)).toEqual({ count: chunks.length * 2 });
    db.close();
  });

  test('rejects retry after deletion, replacement, or workspace removal', () => {
    const deleted = createScheduledIndexStore();
    const deletedClaim = deleted.store.claimNext()!;
    deleted.store.failAttempt({
      documentVersionId: deleted.target.version.id,
      attemptId: deletedClaim.attempt.id,
      errorCode: KnowledgeDocumentIndexErrorCode.ProcessingFailed,
    });
    deleted.documents.softDeleteDocument(
      deleted.target.document.id,
      deleted.target.document.revision,
    );
    expect(() => deleted.store.retryFailedVersion({
      documentId: deleted.target.document.id,
      documentVersionId: deleted.target.version.id,
    })).toThrow(KnowledgeDocumentIndexStateError);
    deleted.db.close();

    const replaced = createScheduledIndexStore();
    const replacedClaim = replaced.store.claimNext()!;
    replaced.store.failAttempt({
      documentVersionId: replaced.target.version.id,
      attemptId: replacedClaim.attempt.id,
      errorCode: KnowledgeDocumentIndexErrorCode.ProcessingFailed,
    });
    replaced.documents.addVersion(replaced.target.document.id, replaced.target.document.revision, {
      contentHash: 'e'.repeat(64),
      managedPath: 'blobs/ee/replacement',
      mimeType: 'text/plain',
      fileSize: 11,
      sourceMtime: null,
      parser: 'text',
      extractedText: 'replacement',
      extractionPartial: false,
    });
    expect(() => replaced.store.retryFailedVersion({
      documentId: replaced.target.document.id,
      documentVersionId: replaced.target.version.id,
    })).toThrow(KnowledgeDocumentIndexStateError);
    replaced.db.close();

    const orphaned = createScheduledIndexStore();
    const orphanedClaim = orphaned.store.claimNext()!;
    orphaned.store.failAttempt({
      documentVersionId: orphaned.target.version.id,
      attemptId: orphanedClaim.attempt.id,
      errorCode: KnowledgeDocumentIndexErrorCode.ProcessingFailed,
    });
    orphaned.db.prepare('DELETE FROM enterprise_lead_workspaces WHERE id = ?')
      .run(orphaned.target.document.workspaceId);
    expect(() => orphaned.store.retryFailedVersion({
      documentId: orphaned.target.document.id,
      documentVersionId: orphaned.target.version.id,
    })).toThrow(KnowledgeDocumentIndexStateError);
    orphaned.db.close();
  });

  test('converges pending and indexing states when the worker becomes unavailable', () => {
    const { db, documents, store, target } = createScheduledIndexStore();
    const runningClaim = store.claimNext()!;
    const pending = scheduleText(documents, store, 'workspace-a', 'pending text');

    expect(store.failRunnableStates(
      KnowledgeDocumentIndexErrorCode.WorkerUnavailable,
      '2026-07-11T01:02:00.000Z',
    )).toBe(2);
    expect(store.getState(target.version.id)).toMatchObject({
      status: KnowledgeDocumentIndexStatus.Failed,
      errorCode: KnowledgeDocumentIndexErrorCode.WorkerUnavailable,
      activeAttemptId: null,
      completedAt: '2026-07-11T01:02:00.000Z',
    });
    expect(store.getState(pending.version.id)?.status).toBe(
      KnowledgeDocumentIndexStatus.Failed,
    );
    expect(store.listAttempts(target.version.id)).toContainEqual(
      expect.objectContaining({
        id: runningClaim.attempt.id,
        outcome: KnowledgeDocumentIndexAttemptOutcome.Failed,
        errorCode: KnowledgeDocumentIndexErrorCode.WorkerUnavailable,
      }),
    );
    db.close();
  });

  test('deactivates immediately and physically removes the old index generation', () => {
    const { db, store, target } = createScheduledIndexStore();
    const firstClaim = store.claimNext()!;
    const chunks = chunkKnowledgeDocumentVersion({
      documentVersionId: target.version.id,
      text: target.text,
    });
    store.stageVersionBatch({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: firstClaim.attempt.id,
      chunks,
    });

    store.deactivateVersion({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
    }, '2026-07-11T01:03:00.000Z');
    expect(store.getState(target.version.id)).toBeNull();
    expect(store.listVersionChunks(target.version.id)).toEqual([]);
    expect(store.listAttempts(target.version.id)).toEqual([]);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks
      WHERE document_version_id = ?
    `).get(target.version.id)).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks_fts
      WHERE document_version_id = ?
    `).get(target.version.id)).toEqual({ count: 0 });

    expect(store.scheduleCurrentVersion({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
    }).attemptCount).toBe(0);
    expect(store.claimNext()!.attempt.attemptNumber).toBe(1);
    db.close();
  });

  test('rejects deactivation when workspace, document, or version ownership mismatches', () => {
    const { db, store, target } = createScheduledIndexStore();
    ensureWorkspace(db, 'workspace-b');

    expect(() => store.deactivateVersion({
      workspaceId: 'workspace-b',
      documentId: target.document.id,
      documentVersionId: target.version.id,
    })).toThrow(KnowledgeDocumentIndexStateError);
    expect(() => store.deactivateVersion({
      workspaceId: target.document.workspaceId,
      documentId: randomUUID(),
      documentVersionId: target.version.id,
    })).toThrow(KnowledgeDocumentIndexStateError);
    expect(() => store.deactivateVersion({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: randomUUID(),
    })).toThrow(KnowledgeDocumentIndexStateError);
    expect(store.getState(target.version.id)).not.toBeNull();
    db.close();
  });

  test('purges an invisible deactivated generation in bounded worker batches', () => {
    const { db, documents, store } = createIndexStoreWithTokenizer(
      KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    );
    const target = scheduleText(
      documents,
      store,
      'workspace-a',
      'cleanup generation '.repeat(20),
    );
    const claim = store.claimNext()!;
    const chunks = chunkKnowledgeDocumentVersion({
      documentVersionId: target.version.id,
      text: target.text,
      targetChars: 4,
      overlapChars: 0,
    });
    expect(chunks.length).toBeGreaterThan(KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS);
    for (let offset = 0; offset < chunks.length; offset += KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS) {
      store.stageVersionBatch({
        workspaceId: target.document.workspaceId,
        documentId: target.document.id,
        documentVersionId: target.version.id,
        attemptId: claim.attempt.id,
        chunks: chunks.slice(offset, offset + KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS),
      });
    }
    store.publishVersion({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: claim.attempt.id,
      chunkCount: chunks.length,
    });
    expect(store.purgeInactiveGenerationBatch()).toBe(0);
    store.deactivateVersion({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
    });

    expect(store.listVersionChunks(target.version.id)).toEqual([]);
    let deleted = 0;
    let batchCount = store.purgeInactiveGenerationBatch(
      KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS + 100,
    );
    while (batchCount > 0) {
      expect(batchCount).toBeLessThanOrEqual(KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS);
      deleted += batchCount;
      batchCount = store.purgeInactiveGenerationBatch();
    }
    expect(deleted).toBe(0);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks
      WHERE document_version_id = ?
    `).get(target.version.id)).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks_fts
      WHERE document_version_id = ?
    `).get(target.version.id)).toEqual({ count: 0 });
    db.close();
  });

  test('lists only published logical chunks with bounded ordinal pagination', () => {
    const { db, store, target } = createScheduledIndexStore();
    const claim = store.claimNext()!;
    const chunks = chunkKnowledgeDocumentVersion({
      documentVersionId: target.version.id,
      text: target.text,
      targetChars: 4,
      overlapChars: 0,
    });
    for (let offset = 0; offset < chunks.length; offset += KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS) {
      store.stageVersionBatch({
        workspaceId: target.document.workspaceId,
        documentId: target.document.id,
        documentVersionId: target.version.id,
        attemptId: claim.attempt.id,
        chunks: chunks.slice(offset, offset + KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS),
      });
    }
    store.publishVersion({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: claim.attempt.id,
      chunkCount: chunks.length,
    });

    const first = store.listVersionChunks(target.version.id, { limit: 0 });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      id: chunks[0].id,
      storageId: expect.not.stringMatching(chunks[0].id),
      indexGenerationId: claim.attempt.id,
    });
    expect(store.listVersionChunks(target.version.id, {
      afterOrdinal: chunks[0].ordinal,
      limit: 1,
    })[0].id).toBe(chunks[1].id);
    db.close();
  });

  test.each([
    KnowledgeDocumentIndexTokenizer.TrigramV1,
    KnowledgeDocumentIndexTokenizer.CjkBigramV1,
  ])('searches Chinese text with %s and binds hostile MATCH text', tokenizer => {
    const { db, documents, store } = createIndexStoreWithTokenizer(tokenizer);
    publishText(documents, store, 'workspace-a', '企业知识库建设规范');
    publishText(documents, store, 'workspace-b', '企业知识库机密预算');

    expect(store.searchWorkspace({ workspaceId: 'workspace-a', query: '知识库' }))
      .toHaveLength(1);
    expect(store.searchWorkspace({
      workspaceId: 'workspace-a',
      query: '" OR workspace_id:* NOT "',
    })).toEqual([]);
    expect(store.searchWorkspace({ workspaceId: 'workspace-a', query: '企' }))
      .toHaveLength(1);
    expect(store.searchWorkspace({ workspaceId: 'workspace-b', query: '预算' }))
      .toHaveLength(1);
    expect(store.searchWorkspace({ workspaceId: 'workspace-a', query: '预算' }))
      .toEqual([]);
    db.close();
  });

  test('normalizes empty search and clamps search limits to one through one hundred', () => {
    const { db, documents, store } = createIndexStoreWithTokenizer(
      KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    );
    publishText(documents, store, 'workspace-a', 'alpha searchable first');
    publishText(documents, store, 'workspace-a', 'alpha searchable second');

    expect(store.searchWorkspace({ workspaceId: 'workspace-a', query: '  ' })).toEqual([]);
    expect(store.searchWorkspace({
      workspaceId: 'workspace-a',
      query: 'alpha',
      limit: 0,
    })).toHaveLength(1);
    expect(store.searchWorkspace({
      workspaceId: 'workspace-a',
      query: 'alpha',
      limit: 1_000,
    })).toHaveLength(2);
    db.close();
  });

  test('rethrows non-MATCH SQLite failures from search', () => {
    const { db, documents, store } = createIndexStoreWithTokenizer(
      KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    );
    publishText(documents, store, 'workspace-a', 'diagnosable persistence failure');
    db.exec('DROP TABLE knowledge_document_chunks');

    expect(() => store.searchWorkspace({
      workspaceId: 'workspace-a',
      query: 'diagnosable',
    })).toThrow(/no such table/i);
    db.close();
  });

  test('deletes one workspace index inside the caller transaction and preserves others', () => {
    const { db, documents, store } = createIndexStoreWithTokenizer(
      KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    );
    const workspaceA = scheduleText(
      documents,
      store,
      'workspace-a',
      'workspace alpha searchable',
    );
    publishTarget(store, workspaceA);
    const workspaceB = scheduleText(
      documents,
      store,
      'workspace-b',
      'workspace beta searchable',
    );
    publishTarget(store, workspaceB);

    const rollbackDelete = db.transaction(() => {
      store.deleteWorkspaceIndex('workspace-a');
      throw new Error('rollback workspace deletion');
    });
    expect(() => rollbackDelete()).toThrow('rollback workspace deletion');
    expect(store.searchWorkspace({ workspaceId: 'workspace-a', query: 'alpha' }))
      .toHaveLength(1);

    db.transaction(() => store.deleteWorkspaceIndex('workspace-a'))();
    expect(store.listStates('workspace-a')).toEqual([]);
    expect(store.listAttempts(workspaceA.version.id)).toEqual([]);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks
      WHERE workspace_id = ?
    `).get('workspace-a')).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks_fts
      WHERE workspace_id = ?
    `).get('workspace-a')).toEqual({ count: 0 });
    expect(store.searchWorkspace({ workspaceId: 'workspace-a', query: 'alpha' })).toEqual([]);
    expect(store.searchWorkspace({ workspaceId: 'workspace-b', query: 'beta' }))
      .toHaveLength(1);
    expect(store.listVersionChunks(workspaceB.version.id)).toHaveLength(1);
    expect(store.listAttempts(workspaceB.version.id)).toHaveLength(1);
    db.close();
  });
});
