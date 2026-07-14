import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import {
  KnowledgeFactDomain,
  KnowledgeFactProfileProjectionAction,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
} from '../../shared/knowledgeBase/constants';
import {
  KnowledgeFactProjectionStore,
  KnowledgeFactProjectionStoreError,
  KnowledgeFactProjectionStoreStage,
} from './knowledgeFactProjectionStore';

const NOW_1 = '2026-07-12T02:00:00.000Z';
const NOW_2 = '2026-07-12T02:01:00.000Z';
const NOW_3 = '2026-07-12T02:02:00.000Z';
const NOW_4 = '2026-07-12T02:03:00.000Z';
const NOW_5 = '2026-07-12T02:04:00.000Z';
const NOW_6 = '2026-07-12T02:05:00.000Z';

const createFixture = (options: {
  onStage?: (stage: KnowledgeFactProjectionStoreStage) => void;
} = {}) => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE knowledge_facts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT '${KnowledgeFactDomain.ProductList}',
      normalized_value TEXT NOT NULL DEFAULT 'industrial robots',
      review_status TEXT NOT NULL DEFAULT '${KnowledgeFactReviewStatus.Pending}',
      projection_state TEXT NOT NULL DEFAULT '${KnowledgeFactProjectionState.None}',
      revision INTEGER NOT NULL DEFAULT 1,
      conflict_group_key TEXT,
      updated_at TEXT NOT NULL DEFAULT '${NOW_1}',
      tombstoned_at TEXT
    );
  `);
  const store = new KnowledgeFactProjectionStore(db, options);
  return { db, store };
};

const insertFact = (
  db: Database.Database,
  factId: string,
  workspaceId = 'workspace-a',
): void => {
  db.prepare(`
    INSERT INTO knowledge_facts (id, workspace_id)
    VALUES (?, ?)
  `).run(factId, workspaceId);
};

const applyProjection = (
  db: Database.Database,
  store: KnowledgeFactProjectionStore,
  overrides: Partial<Parameters<
    KnowledgeFactProjectionStore['applyProjectionInCurrentTransaction']
  >[0]> = {},
) => {
  const input = {
    factId: 'fact-a',
    workspaceId: 'workspace-a',
    domain: KnowledgeFactDomain.ProductList,
    normalizedValue: 'industrial robots',
    action: KnowledgeFactProfileProjectionAction.Inserted,
    appliedValue: ['Industrial robots'],
    priorValue: [],
    appliedProfileRevision: 2,
    appliedFieldRevision: 2,
    priorConfirmedKeyPresent: false,
    priorIgnoredKeyPresent: true,
    appliedAt: NOW_1,
    ...overrides,
  };
  return db.transaction(() => {
    const result = store.applyProjectionInCurrentTransaction(input);
    db.prepare(`
      UPDATE knowledge_facts
      SET
        workspace_id = ?,
        domain = ?,
        normalized_value = ?,
        review_status = ?,
        projection_state = ?,
        revision = revision + 1,
        conflict_group_key = ?,
        updated_at = ?,
        tombstoned_at = NULL
      WHERE id = ?
    `).run(
      input.workspaceId,
      input.domain,
      input.normalizedValue,
      KnowledgeFactReviewStatus.Confirmed,
      KnowledgeFactProjectionState.Active,
      [input.workspaceId, input.domain, input.normalizedValue].join('\0'),
      input.appliedAt,
      input.factId,
    );
    return result;
  })();
};

const reverseProjection = (
  db: Database.Database,
  store: KnowledgeFactProjectionStore,
  factId: string,
  reversedAt: string,
) => db.transaction(() => {
  const result = store.reverseProjectionInCurrentTransaction(factId, reversedAt);
  db.prepare(`
    UPDATE knowledge_facts
    SET
      projection_state = ?,
      revision = revision + 1,
      updated_at = ?,
      tombstoned_at = ?
    WHERE id = ?
  `).run(
    KnowledgeFactProjectionState.Reversed,
    reversedAt,
    reversedAt,
    factId,
  );
  return result;
})();

const dropCycleMetadataColumnWhenPresent = (db: Database.Database): void => {
  const hasCycleMetadata = (db.prepare(`
    PRAGMA table_info(knowledge_fact_profile_projection_ledger)
  `).all() as Array<{ name: string }>).some(column =>
    column.name === 'cycle_root_fact_id');
  if (hasCycleMetadata) {
    db.exec(`
      ALTER TABLE knowledge_fact_profile_projection_ledger
      DROP COLUMN cycle_root_fact_id;
    `);
  }
};

describe('KnowledgeFactProjectionStore schema and immutable audit', () => {
  test('creates the ledger and support-group schema with exact ownership and checks', () => {
    const { db } = createFixture();
    const schema = new Map(
      (db.prepare(`
        SELECT name, sql
        FROM sqlite_master
        WHERE name IN (
          'knowledge_fact_projection_support_groups',
          'knowledge_fact_projection_support_group_roots',
          'knowledge_fact_profile_projection_ledger',
          'idx_knowledge_fact_projection_ledger_workspace'
        )
      `).all() as Array<{ name: string; sql: string }>).map(row => [row.name, row.sql]),
    );

    expect([...schema.keys()].sort()).toEqual([
      'idx_knowledge_fact_projection_ledger_workspace',
      'knowledge_fact_profile_projection_ledger',
      'knowledge_fact_projection_support_group_roots',
      'knowledge_fact_projection_support_groups',
    ].sort());
    const groupSql = schema.get('knowledge_fact_projection_support_groups')!;
    expect(groupSql).toContain('PRIMARY KEY (workspace_id, domain, normalized_value)');
    expect(groupSql).toContain('TYPEOF(active_support_count) = \'integer\'');
    expect(groupSql).toContain('active_support_count >= 0');
    expect(groupSql).not.toContain('cycle_root_fact_id');
    expect(groupSql).toContain('WITHOUT ROWID');
    const rootSql = schema.get('knowledge_fact_projection_support_group_roots')!;
    expect(rootSql).toContain('PRIMARY KEY (workspace_id, domain, normalized_value)');
    expect(rootSql).toContain('root_fact_id');
    expect(rootSql).toContain(
      'FOREIGN KEY(workspace_id, domain, normalized_value)',
    );
    expect(rootSql).toContain('FOREIGN KEY(root_fact_id) REFERENCES knowledge_facts(id)');
    expect(rootSql).not.toContain('REFERENCES knowledge_fact_profile_projection_ledger');
    expect(rootSql).toContain('WITHOUT ROWID');
    const ledgerSql = schema.get('knowledge_fact_profile_projection_ledger')!;
    for (const column of [
      'fact_id',
      'workspace_id',
      'domain',
      'normalized_value',
      'cycle_root_fact_id',
      'action',
      'applied_value_json',
      'prior_value_json',
      'applied_profile_revision',
      'applied_field_revision',
      'prior_confirmed_key_present',
      'prior_ignored_key_present',
      'applied_at',
      'reversed_at',
    ]) {
      expect(ledgerSql).toContain(column);
    }
    expect(ledgerSql).toContain("action IN ('inserted','preexisting_support','replaced_single')");
    expect(ledgerSql).toContain('JSON_VALID(applied_value_json)');
    expect(ledgerSql).toContain('JSON_VALID(prior_value_json)');
    expect(ledgerSql).toContain('FOREIGN KEY(fact_id) REFERENCES knowledge_facts(id)');
    expect(db.prepare(`
      PRAGMA index_info(idx_knowledge_fact_projection_ledger_workspace)
    `).all()).toEqual([
      expect.objectContaining({ seqno: 0, name: 'workspace_id' }),
      expect.objectContaining({ seqno: 1, name: 'fact_id' }),
    ]);
    db.close();
  });

  test('records immutable applied/prior audit state and increments active support once', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    const result = applyProjection(db, store);

    expect(result).toEqual({
      ledger: {
        factId: 'fact-a',
        workspaceId: 'workspace-a',
        domain: KnowledgeFactDomain.ProductList,
        normalizedValue: 'industrial robots',
        cycleRootFactId: 'fact-a',
        action: KnowledgeFactProfileProjectionAction.Inserted,
        appliedValue: ['Industrial robots'],
        priorValue: [],
        appliedProfileRevision: 2,
        appliedFieldRevision: 2,
        priorConfirmedKeyPresent: false,
        priorIgnoredKeyPresent: true,
        appliedAt: NOW_1,
        reversedAt: null,
      },
      activeSupportCount: 1,
    });
    expect(store.getLedger('fact-a')).toEqual(result.ledger);
    expect(store.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )).toEqual({
      workspaceId: 'workspace-a',
      domain: KnowledgeFactDomain.ProductList,
      normalizedValue: 'industrial robots',
      activeSupportCount: 1,
    });
    expect(store.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )).toEqual(result.ledger);
    expect(() => applyProjection(db, store, {
      appliedValue: ['Secret replacement'],
    })).toThrow(KnowledgeFactProjectionStoreError);
    expect(store.getLedger('fact-a')).toEqual(result.ledger);
    expect(store.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.activeSupportCount).toBe(1);
    db.close();
  });

  test('rejects sparse/inherited projection arrays before the first SQL write', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    const sparse = new Array<string>(1);
    const inherited = new Array<string>(1);
    Object.defineProperty(Object.getPrototypeOf(inherited), '0', {
      configurable: true,
      value: 'Inherited secret value',
    });
    const originalPrepare = db.prepare.bind(db);
    let writeStatementCount = 0;
    Object.defineProperty(db, 'prepare', {
      configurable: true,
      value: (source: string) => {
        if (/^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(source)) {
          writeStatementCount += 1;
        }
        return originalPrepare(source);
      },
    });
    try {
      for (const appliedValue of [sparse, inherited]) {
        expect(() => applyProjection(db, store, { appliedValue }))
          .toThrow(KnowledgeFactProjectionStoreError);
      }
    } finally {
      delete (Object.getPrototypeOf(inherited) as { 0?: string })[0];
      Object.defineProperty(db, 'prepare', {
        configurable: true,
        value: originalPrepare,
      });
    }
    expect(writeStatementCount).toBe(0);
    expect(store.getLedger('fact-a')).toBeNull();
    expect(store.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )).toBeNull();
    db.close();
  });

  test('retains the ledger after one-way reversal and never underflows support', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    applyProjection(db, store);

    const reversed = reverseProjection(db, store, 'fact-a', NOW_2);
    expect(reversed).toEqual({
      ledger: expect.objectContaining({
        factId: 'fact-a',
        appliedAt: NOW_1,
        reversedAt: NOW_2,
      }),
      activeSupportCount: 0,
    });
    expect(store.getLedger('fact-a')).toEqual(reversed.ledger);
    expect(store.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.activeSupportCount).toBe(0);
    expect(store.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.factId).toBe('fact-a');

    expect(() => reverseProjection(db, store, 'fact-a', NOW_2))
      .toThrow(KnowledgeFactProjectionStoreError);
    expect(store.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.activeSupportCount).toBe(0);
    db.close();
  });

  test('keeps a cycle root after root-first reversal and replaces it only on the next 0-to-1 edge', () => {
    const { db, store } = createFixture();
    for (const factId of ['fact-a', 'fact-b', 'fact-c']) {
      insertFact(db, factId);
    }
    applyProjection(db, store);
    applyProjection(db, store, {
      factId: 'fact-b',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_2,
    });
    reverseProjection(db, store, 'fact-a', NOW_2);
    expect(store.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.factId).toBe('fact-a');
    reverseProjection(db, store, 'fact-b', NOW_3);

    applyProjection(db, store, {
      factId: 'fact-c',
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_3,
    });
    expect(store.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.factId).toBe('fact-c');
    db.close();
  });

  test('backfills a unique active root atomically when opening an old projection schema', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    applyProjection(db, store);
    dropCycleMetadataColumnWhenPresent(db);
    db.exec('DROP TABLE knowledge_fact_projection_support_group_roots');

    const restarted = new KnowledgeFactProjectionStore(db);
    expect(restarted.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.factId).toBe('fact-a');
    db.close();
  });

  test('uses an existing legacy root as authority for completed projection history', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    applyProjection(db, store);
    reverseProjection(db, store, 'fact-a', NOW_2);
    dropCycleMetadataColumnWhenPresent(db);

    const restarted = new KnowledgeFactProjectionStore(db);
    expect(restarted.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.activeSupportCount).toBe(0);
    expect(restarted.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.factId).toBe('fact-a');
    expect(restarted.getLedger('fact-a')?.cycleRootFactId).toBe('fact-a');
    db.close();
  });

  test('binds every completed legacy support after an existing root to that cycle', () => {
    const { db, store } = createFixture();
    for (const factId of ['fact-a', 'fact-b', 'fact-c']) {
      insertFact(db, factId);
    }
    applyProjection(db, store);
    applyProjection(db, store, {
      factId: 'fact-b',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_2,
    });
    reverseProjection(db, store, 'fact-a', NOW_3);
    reverseProjection(db, store, 'fact-b', NOW_4);
    dropCycleMetadataColumnWhenPresent(db);

    const restarted = new KnowledgeFactProjectionStore(db);
    expect(restarted.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.factId).toBe('fact-a');
    expect(restarted.getLedger('fact-a')?.cycleRootFactId).toBe('fact-a');
    expect(restarted.getLedger('fact-b')?.cycleRootFactId).toBe('fact-a');

    applyProjection(db, restarted, {
      factId: 'fact-c',
      appliedAt: NOW_5,
    });
    expect(restarted.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.factId).toBe('fact-c');
    expect(restarted.getLedger('fact-c')?.cycleRootFactId).toBe('fact-c');
    expect(restarted.getLedger('fact-a')?.cycleRootFactId).toBe('fact-a');
    expect(restarted.getLedger('fact-b')?.cycleRootFactId).toBe('fact-a');
    db.close();
  });

  test('binds reversed bridge supports to an existing active legacy root', () => {
    const { db, store } = createFixture();
    for (const factId of ['fact-a', 'fact-b', 'fact-c', 'fact-d']) {
      insertFact(db, factId);
    }
    applyProjection(db, store);
    for (const [factId, appliedAt] of [
      ['fact-b', NOW_2],
      ['fact-c', NOW_3],
    ] as const) {
      applyProjection(db, store, {
        factId,
        action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
        priorValue: ['Industrial robots'],
        priorConfirmedKeyPresent: true,
        priorIgnoredKeyPresent: false,
        appliedAt,
      });
    }
    reverseProjection(db, store, 'fact-b', NOW_4);
    reverseProjection(db, store, 'fact-c', NOW_5);
    applyProjection(db, store, {
      factId: 'fact-d',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_6,
    });
    dropCycleMetadataColumnWhenPresent(db);

    const restarted = new KnowledgeFactProjectionStore(db);
    expect(restarted.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.factId).toBe('fact-a');
    for (const factId of ['fact-a', 'fact-b', 'fact-c', 'fact-d']) {
      expect(restarted.getLedger(factId)?.cycleRootFactId).toBe('fact-a');
    }
    db.close();
  });

  test('never repairs a missing cycle identity in an already migrated schema', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    insertFact(db, 'fact-b');
    applyProjection(db, store);
    applyProjection(db, store, {
      factId: 'fact-b',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_2,
    });
    db.prepare(`
      UPDATE knowledge_fact_profile_projection_ledger
      SET cycle_root_fact_id = NULL
      WHERE fact_id = 'fact-b'
    `).run();
    const beforeLedgers = db.prepare(`
      SELECT * FROM knowledge_fact_profile_projection_ledger ORDER BY fact_id
    `).all();
    expect(() => store.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )).toThrow(KnowledgeFactProjectionStoreError);

    let thrown: unknown;
    try {
      new KnowledgeFactProjectionStore(db);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KnowledgeFactProjectionStoreError);
    expect(JSON.parse(JSON.stringify(thrown))).toEqual({
      code: 'job_state_conflict',
      message: 'Knowledge fact projection state is invalid',
    });
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_profile_projection_ledger ORDER BY fact_id
    `).all()).toEqual(beforeLedgers);
    db.close();
  });

  test('never repairs a missing active root row in an already migrated schema', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    applyProjection(db, store);
    db.prepare(`
      DELETE FROM knowledge_fact_projection_support_group_roots
      WHERE workspace_id = 'workspace-a'
    `).run();
    expect(() => store.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )).toThrow(KnowledgeFactProjectionStoreError);

    expect(() => new KnowledgeFactProjectionStore(db))
      .toThrow(KnowledgeFactProjectionStoreError);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_fact_projection_support_group_roots
    `).get()).toEqual({ count: 0 });
    db.close();
  });

  test('never recreates a missing roots table beside an already migrated ledger', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    applyProjection(db, store);
    db.exec('DROP TABLE knowledge_fact_projection_support_group_roots');
    const beforeLedgers = db.prepare(`
      SELECT * FROM knowledge_fact_profile_projection_ledger ORDER BY fact_id
    `).all();

    expect(() => new KnowledgeFactProjectionStore(db))
      .toThrow(KnowledgeFactProjectionStoreError);
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE name = 'knowledge_fact_projection_support_group_roots'
    `).get()).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_profile_projection_ledger ORDER BY fact_id
    `).all()).toEqual(beforeLedgers);
    db.close();
  });

  test('fails rootless legacy clock regression closed and rolls migration DDL back', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    insertFact(db, 'fact-b');
    applyProjection(db, store, { appliedAt: NOW_3 });
    applyProjection(db, store, {
      factId: 'fact-b',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_1,
    });
    dropCycleMetadataColumnWhenPresent(db);
    db.exec('DROP TABLE knowledge_fact_projection_support_group_roots');
    const beforeLedgers = db.prepare(`
      SELECT * FROM knowledge_fact_profile_projection_ledger ORDER BY rowid
    `).all();

    let thrown: unknown;
    try {
      new KnowledgeFactProjectionStore(db);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KnowledgeFactProjectionStoreError);
    expect(JSON.parse(JSON.stringify(thrown))).toEqual({
      code: 'job_state_conflict',
      message: 'Knowledge fact projection state is invalid',
    });
    expect((db.prepare(`
      PRAGMA table_info(knowledge_fact_profile_projection_ledger)
    `).all() as Array<{ name: string }>).some(column =>
      column.name === 'cycle_root_fact_id')).toBe(false);
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE name = 'knowledge_fact_projection_support_group_roots'
    `).get()).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_profile_projection_ledger ORDER BY rowid
    `).all()).toEqual(beforeLedgers);
    db.close();
  });

  test('fails rootless legacy active state with reversed history closed despite clock rollback', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    insertFact(db, 'fact-b');
    applyProjection(db, store);
    applyProjection(db, store, {
      factId: 'fact-b',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_3,
    });
    reverseProjection(db, store, 'fact-a', NOW_2);
    dropCycleMetadataColumnWhenPresent(db);
    db.exec('DROP TABLE knowledge_fact_projection_support_group_roots');
    const beforeLedgers = db.prepare(`
      SELECT * FROM knowledge_fact_profile_projection_ledger ORDER BY rowid
    `).all();

    let thrown: unknown;
    try {
      new KnowledgeFactProjectionStore(db);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KnowledgeFactProjectionStoreError);
    expect(JSON.parse(JSON.stringify(thrown))).toEqual({
      code: 'job_state_conflict',
      message: 'Knowledge fact projection state is invalid',
    });
    expect((db.prepare(`
      PRAGMA table_info(knowledge_fact_profile_projection_ledger)
    `).all() as Array<{ name: string }>).some(column =>
      column.name === 'cycle_root_fact_id')).toBe(false);
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE name = 'knowledge_fact_projection_support_group_roots'
    `).get()).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_profile_projection_ledger ORDER BY rowid
    `).all()).toEqual(beforeLedgers);
    db.close();
  });

  test('fails rootless legacy completed state closed and rolls migration DDL back', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    applyProjection(db, store);
    reverseProjection(db, store, 'fact-a', NOW_2);
    dropCycleMetadataColumnWhenPresent(db);
    db.exec('DROP TABLE knowledge_fact_projection_support_group_roots');
    const beforeLedgers = db.prepare(`
      SELECT * FROM knowledge_fact_profile_projection_ledger ORDER BY rowid
    `).all();

    let thrown: unknown;
    try {
      new KnowledgeFactProjectionStore(db);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KnowledgeFactProjectionStoreError);
    expect(JSON.parse(JSON.stringify(thrown))).toEqual({
      code: 'job_state_conflict',
      message: 'Knowledge fact projection state is invalid',
    });
    expect((db.prepare(`
      PRAGMA table_info(knowledge_fact_profile_projection_ledger)
    `).all() as Array<{ name: string }>).some(column =>
      column.name === 'cycle_root_fact_id')).toBe(false);
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE name = 'knowledge_fact_projection_support_group_roots'
    `).get()).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_profile_projection_ledger ORDER BY rowid
    `).all()).toEqual(beforeLedgers);
    db.close();
  });

  test('requires a persisted root for fully migrated completed projection history', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    applyProjection(db, store);
    reverseProjection(db, store, 'fact-a', NOW_2);
    db.prepare(`
      DELETE FROM knowledge_fact_projection_support_group_roots
      WHERE workspace_id = 'workspace-a'
    `).run();
    const beforeGroup = db.prepare(`
      SELECT * FROM knowledge_fact_projection_support_groups
    `).get();
    const beforeLedger = db.prepare(`
      SELECT * FROM knowledge_fact_profile_projection_ledger
    `).get();

    expect(() => store.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )).toThrow(KnowledgeFactProjectionStoreError);
    expect(() => store.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )).toThrow(KnowledgeFactProjectionStoreError);

    let thrown: unknown;
    try {
      new KnowledgeFactProjectionStore(db);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KnowledgeFactProjectionStoreError);
    expect(JSON.parse(JSON.stringify(thrown))).toEqual({
      code: 'job_state_conflict',
      message: 'Knowledge fact projection state is invalid',
    });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_fact_projection_support_group_roots
    `).get()).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_projection_support_groups
    `).get()).toEqual(beforeGroup);
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_profile_projection_ledger
    `).get()).toEqual(beforeLedger);
    db.close();
  });

  test('rejects a support group without projection history or a persisted root', () => {
    const { db, store } = createFixture();
    db.prepare(`
      INSERT INTO knowledge_fact_projection_support_groups (
        workspace_id, domain, normalized_value, active_support_count
      ) VALUES (?, ?, ?, 0)
    `).run(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    );

    expect(() => store.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )).toThrow(KnowledgeFactProjectionStoreError);
    expect(() => new KnowledgeFactProjectionStore(db))
      .toThrow(KnowledgeFactProjectionStoreError);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_fact_projection_support_group_roots
    `).get()).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_fact_projection_support_groups
    `).get()).toEqual({ count: 1 });
    db.close();
  });

  test('fails closed and rolls schema creation back when old ledger timing makes root backfill ambiguous', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    insertFact(db, 'fact-b');
    applyProjection(db, store);
    applyProjection(db, store, {
      factId: 'fact-b',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_2,
    });
    reverseProjection(db, store, 'fact-a', NOW_2);
    dropCycleMetadataColumnWhenPresent(db);
    db.exec('DROP TABLE knowledge_fact_projection_support_group_roots');

    expect(() => new KnowledgeFactProjectionStore(db))
      .toThrow(KnowledgeFactProjectionStoreError);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE name = 'knowledge_fact_projection_support_group_roots'
    `).get()).toEqual({ count: 0 });
    db.close();
  });

  test.each([
    KnowledgeFactProjectionStoreStage.AfterSupportIncrement,
    KnowledgeFactProjectionStoreStage.AfterLedgerInsert,
    KnowledgeFactProjectionStoreStage.AfterRootInsert,
  ])('rolls apply back after internal stage %s', faultStage => {
    const { db, store } = createFixture({
      onStage: stage => {
        if (stage === faultStage) {
          throw new Error('raw secret projection apply fault');
        }
      },
    });
    insertFact(db, 'fact-a');
    expect(() => applyProjection(db, store)).toThrow(KnowledgeFactProjectionStoreError);
    expect(store.getLedger('fact-a')).toBeNull();
    expect(store.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )).toBeNull();
    db.close();
  });

  test('rolls a new-cycle root replacement back with its group and ledger changes', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    insertFact(db, 'fact-b');
    applyProjection(db, store);
    reverseProjection(db, store, 'fact-a', NOW_2);
    const faultStore = new KnowledgeFactProjectionStore(db, {
      onStage: stage => {
        if (stage === KnowledgeFactProjectionStoreStage.AfterRootReplace) {
          throw new Error('raw secret root replacement fault');
        }
      },
    });

    expect(() => applyProjection(db, faultStore, {
      factId: 'fact-b',
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_3,
    })).toThrow(KnowledgeFactProjectionStoreError);
    expect(store.getLedger('fact-b')).toBeNull();
    expect(store.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.activeSupportCount).toBe(0);
    expect(store.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.factId).toBe('fact-a');
    db.close();
  });

  test('rolls root backfill schema changes back after an injected fault', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    applyProjection(db, store);
    dropCycleMetadataColumnWhenPresent(db);
    db.exec('DROP TABLE knowledge_fact_projection_support_group_roots');

    expect(() => new KnowledgeFactProjectionStore(db, {
      onStage: stage => {
        if (stage === KnowledgeFactProjectionStoreStage.AfterRootBackfill) {
          throw new Error('raw secret root backfill fault');
        }
      },
    })).toThrow(KnowledgeFactProjectionStoreError);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE name = 'knowledge_fact_projection_support_group_roots'
    `).get()).toEqual({ count: 0 });
    expect(new KnowledgeFactProjectionStore(db).getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.factId).toBe('fact-a');
    db.close();
  });

  test.each([
    KnowledgeFactProjectionStoreStage.AfterSupportDecrement,
    KnowledgeFactProjectionStoreStage.AfterLedgerReverse,
  ])('rolls reversal back after internal stage %s', faultStage => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    applyProjection(db, store);
    const faultStore = new KnowledgeFactProjectionStore(db, {
      onStage: stage => {
        if (stage === faultStage) {
          throw new Error('raw secret projection reversal fault');
        }
      },
    });
    expect(() => db.transaction(() =>
      faultStore.reverseProjectionInCurrentTransaction('fact-a', NOW_2))())
      .toThrow(KnowledgeFactProjectionStoreError);
    expect(store.getLedger('fact-a')?.reversedAt).toBeNull();
    expect(store.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.activeSupportCount).toBe(1);
    db.close();
  });

  test('requires an outer transaction and performs explicit workspace cleanup in ledger-first order', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    applyProjection(db, store);

    expect(() => store.applyProjectionInCurrentTransaction({} as never))
      .toThrow(KnowledgeFactProjectionStoreError);
    expect(() => store.reverseProjectionInCurrentTransaction('fact-a', NOW_2))
      .toThrow(KnowledgeFactProjectionStoreError);
    expect(() => store.deleteWorkspaceProjectionsInCurrentTransaction('workspace-a'))
      .toThrow(KnowledgeFactProjectionStoreError);

    const cleanup = db.transaction(() =>
      store.deleteWorkspaceProjectionsInCurrentTransaction('workspace-a'))();
    expect(cleanup).toEqual({
      deletedLedgerCount: 1,
      deletedRootCount: 1,
      deletedSupportGroupCount: 1,
    });
    expect(store.getLedger('fact-a')).toBeNull();
    expect(store.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )).toBeNull();
    db.close();
  });

  test('startup cleanup removes a ledger whose support group disappeared before deferred validation', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    insertFact(db, 'fact-b', 'workspace-b');
    applyProjection(db, store);
    applyProjection(db, store, {
      factId: 'fact-b',
      workspaceId: 'workspace-b',
    });
    db.pragma('foreign_keys = OFF');
    db.prepare(`
      DELETE FROM knowledge_fact_projection_support_groups
      WHERE workspace_id = 'workspace-a'
    `).run();
    db.pragma('foreign_keys = ON');
    const deferredStore = new KnowledgeFactProjectionStore(db, {
      deferInitialization: true,
    });

    const firstDeletedCount = db.transaction(() =>
      deferredStore.deleteParentlessProjectionsInCurrentTransaction(NOW_6))();
    const secondDeletedCount = db.transaction(() =>
      deferredStore.deleteParentlessProjectionsInCurrentTransaction(NOW_6))();
    expect(() => deferredStore.initializeAfterCleanup()).not.toThrow();

    expect(firstDeletedCount).toBe(2);
    expect(secondDeletedCount).toBe(0);
    expect(deferredStore.getLedger('fact-a')).toBeNull();
    expect(db.prepare(`SELECT * FROM knowledge_facts WHERE id = 'fact-a'`).get())
      .toMatchObject({
        review_status: KnowledgeFactReviewStatus.Confirmed,
        projection_state: KnowledgeFactProjectionState.Conflict,
        revision: 3,
        updated_at: NOW_6,
        tombstoned_at: null,
      });
    expect(deferredStore.getLedger('fact-b')).not.toBeNull();
    expect(db.prepare(`SELECT * FROM knowledge_facts WHERE id = 'fact-b'`).get())
      .toMatchObject({
        projection_state: KnowledgeFactProjectionState.Active,
        revision: 2,
        updated_at: NOW_1,
      });
    expect(deferredStore.getSupportGroup(
      'workspace-b',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.activeSupportCount).toBe(1);
    db.close();
  });

  test('startup cleanup closes a missing-fact ledger root and active support-group chain', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    insertFact(db, 'fact-b', 'workspace-b');
    applyProjection(db, store);
    applyProjection(db, store, {
      factId: 'fact-b',
      workspaceId: 'workspace-b',
    });
    db.pragma('foreign_keys = OFF');
    db.prepare(`DELETE FROM knowledge_facts WHERE id = 'fact-a'`).run();
    db.pragma('foreign_keys = ON');
    const deferredStore = new KnowledgeFactProjectionStore(db, {
      deferInitialization: true,
    });

    const firstDeletedCount = db.transaction(() =>
      deferredStore.deleteParentlessProjectionsInCurrentTransaction(NOW_6))();
    const secondDeletedCount = db.transaction(() =>
      deferredStore.deleteParentlessProjectionsInCurrentTransaction(NOW_6))();
    expect(() => deferredStore.initializeAfterCleanup()).not.toThrow();

    expect(firstDeletedCount).toBe(3);
    expect(secondDeletedCount).toBe(0);
    expect(deferredStore.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )).toBeNull();
    expect(deferredStore.getLedger('fact-b')).not.toBeNull();
    expect(db.prepare(`SELECT * FROM knowledge_facts WHERE id = 'fact-b'`).get())
      .toMatchObject({
        projection_state: KnowledgeFactProjectionState.Active,
        revision: 2,
        updated_at: NOW_1,
      });
    expect(deferredStore.getSupportGroup(
      'workspace-b',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.activeSupportCount).toBe(1);
    db.close();
  });

  test('startup cleanup reconciles only the affected group after one support fact disappears', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    insertFact(db, 'fact-b');
    insertFact(db, 'fact-c', 'workspace-b');
    applyProjection(db, store);
    applyProjection(db, store, {
      factId: 'fact-b',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_2,
    });
    applyProjection(db, store, {
      factId: 'fact-c',
      workspaceId: 'workspace-b',
    });
    db.pragma('foreign_keys = OFF');
    db.prepare(`DELETE FROM knowledge_facts WHERE id = 'fact-b'`).run();
    db.pragma('foreign_keys = ON');
    const deferredStore = new KnowledgeFactProjectionStore(db, {
      deferInitialization: true,
    });

    const deletedCount = db.transaction(() =>
      deferredStore.deleteParentlessProjectionsInCurrentTransaction(NOW_6))();
    expect(() => deferredStore.initializeAfterCleanup()).not.toThrow();

    expect(deletedCount).toBe(1);
    expect(deferredStore.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.activeSupportCount).toBe(1);
    expect(deferredStore.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.factId).toBe('fact-a');
    expect(db.prepare(`SELECT * FROM knowledge_facts WHERE id = 'fact-a'`).get())
      .toMatchObject({
        projection_state: KnowledgeFactProjectionState.Active,
        revision: 2,
        updated_at: NOW_1,
      });
    expect(deferredStore.getSupportGroup(
      'workspace-b',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.activeSupportCount).toBe(1);
    db.close();
  });

  test('startup cleanup drops the whole group when its root fact and ledger disappeared', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    insertFact(db, 'fact-b');
    insertFact(db, 'fact-c', 'workspace-b');
    applyProjection(db, store);
    applyProjection(db, store, {
      factId: 'fact-b',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_2,
    });
    applyProjection(db, store, {
      factId: 'fact-c',
      workspaceId: 'workspace-b',
    });
    db.pragma('foreign_keys = OFF');
    db.prepare(`DELETE FROM knowledge_facts WHERE id = 'fact-a'`).run();
    db.prepare(`
      DELETE FROM knowledge_fact_profile_projection_ledger
      WHERE fact_id = 'fact-a'
    `).run();
    db.pragma('foreign_keys = ON');
    const deferredStore = new KnowledgeFactProjectionStore(db, {
      deferInitialization: true,
    });

    const firstDeletedCount = db.transaction(() =>
      deferredStore.deleteParentlessProjectionsInCurrentTransaction(NOW_6))();
    const secondDeletedCount = db.transaction(() =>
      deferredStore.deleteParentlessProjectionsInCurrentTransaction(NOW_6))();
    expect(() => deferredStore.initializeAfterCleanup()).not.toThrow();

    expect(firstDeletedCount).toBe(3);
    expect(secondDeletedCount).toBe(0);
    expect(deferredStore.getLedger('fact-b')).toBeNull();
    expect(db.prepare(`SELECT * FROM knowledge_facts WHERE id = 'fact-b'`).get())
      .toMatchObject({
        review_status: KnowledgeFactReviewStatus.Confirmed,
        projection_state: KnowledgeFactProjectionState.Conflict,
        revision: 3,
        updated_at: NOW_6,
        tombstoned_at: null,
      });
    expect(deferredStore.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )).toBeNull();
    expect(deferredStore.getLedger('fact-c')).not.toBeNull();
    expect(db.prepare(`SELECT * FROM knowledge_facts WHERE id = 'fact-c'`).get())
      .toMatchObject({
        projection_state: KnowledgeFactProjectionState.Active,
        revision: 2,
        updated_at: NOW_1,
      });
    expect(deferredStore.getSupportGroup(
      'workspace-b',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.activeSupportCount).toBe(1);
    db.close();
  });

  test('startup cleanup recovers both active owners when only the root ledger disappeared', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    insertFact(db, 'fact-b');
    applyProjection(db, store);
    applyProjection(db, store, {
      factId: 'fact-b',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_2,
    });
    db.pragma('foreign_keys = OFF');
    db.prepare(`
      DELETE FROM knowledge_fact_profile_projection_ledger
      WHERE fact_id = 'fact-a'
    `).run();
    db.pragma('foreign_keys = ON');
    const deferredStore = new KnowledgeFactProjectionStore(db, {
      deferInitialization: true,
    });

    const firstDeletedCount = db.transaction(() =>
      deferredStore.deleteParentlessProjectionsInCurrentTransaction(NOW_6))();
    const secondDeletedCount = db.transaction(() =>
      deferredStore.deleteParentlessProjectionsInCurrentTransaction(NOW_6))();
    expect(() => deferredStore.initializeAfterCleanup()).not.toThrow();

    expect(firstDeletedCount).toBe(3);
    expect(secondDeletedCount).toBe(0);
    for (const factId of ['fact-a', 'fact-b']) {
      expect(db.prepare(`SELECT * FROM knowledge_facts WHERE id = ?`).get(factId))
        .toMatchObject({
          review_status: KnowledgeFactReviewStatus.Confirmed,
          projection_state: KnowledgeFactProjectionState.Conflict,
          revision: 3,
          updated_at: NOW_6,
          tombstoned_at: null,
        });
    }
    db.close();
  });

  test('startup cleanup preserves a reversed owner while closing its invalid root group', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    insertFact(db, 'fact-b');
    applyProjection(db, store);
    applyProjection(db, store, {
      factId: 'fact-b',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_2,
    });
    reverseProjection(db, store, 'fact-b', NOW_3);
    const reversedBefore = db.prepare(`
      SELECT * FROM knowledge_facts WHERE id = 'fact-b'
    `).get();
    db.pragma('foreign_keys = OFF');
    db.prepare(`DELETE FROM knowledge_facts WHERE id = 'fact-a'`).run();
    db.prepare(`
      DELETE FROM knowledge_fact_profile_projection_ledger
      WHERE fact_id = 'fact-a'
    `).run();
    db.pragma('foreign_keys = ON');
    const deferredStore = new KnowledgeFactProjectionStore(db, {
      deferInitialization: true,
    });

    const deletedCount = db.transaction(() =>
      deferredStore.deleteParentlessProjectionsInCurrentTransaction(NOW_6))();
    expect(() => deferredStore.initializeAfterCleanup()).not.toThrow();

    expect(deletedCount).toBe(3);
    expect(deferredStore.getLedger('fact-b')).toBeNull();
    expect(db.prepare(`SELECT * FROM knowledge_facts WHERE id = 'fact-b'`).get())
      .toEqual(reversedBefore);
    db.close();
  });

  test('startup cleanup fails closed before writes for mismatched surviving ledger ownership', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    applyProjection(db, store);
    db.pragma('foreign_keys = OFF');
    db.prepare(`
      DELETE FROM knowledge_fact_projection_support_groups
      WHERE workspace_id = 'workspace-a'
    `).run();
    db.prepare(`
      UPDATE knowledge_facts SET workspace_id = 'workspace-b'
      WHERE id = 'fact-a'
    `).run();
    db.pragma('foreign_keys = ON');
    const before = {
      facts: db.prepare(`SELECT * FROM knowledge_facts ORDER BY id`).all(),
      ledgers: db.prepare(`
        SELECT * FROM knowledge_fact_profile_projection_ledger ORDER BY fact_id
      `).all(),
      roots: db.prepare(`
        SELECT * FROM knowledge_fact_projection_support_group_roots
        ORDER BY workspace_id, domain, normalized_value
      `).all(),
    };
    const deferredStore = new KnowledgeFactProjectionStore(db, {
      deferInitialization: true,
    });

    expect(() => db.transaction(() =>
      deferredStore.deleteParentlessProjectionsInCurrentTransaction(NOW_6))())
      .toThrow(KnowledgeFactProjectionStoreError);

    expect(db.prepare(`SELECT * FROM knowledge_facts ORDER BY id`).all())
      .toEqual(before.facts);
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_profile_projection_ledger ORDER BY fact_id
    `).all()).toEqual(before.ledgers);
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_projection_support_group_roots
      ORDER BY workspace_id, domain, normalized_value
    `).all()).toEqual(before.roots);
    db.close();
  });

  test('startup cleanup fails closed before writes for a corrupted surviving cycle root', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    insertFact(db, 'fact-b');
    applyProjection(db, store);
    applyProjection(db, store, {
      factId: 'fact-b',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_2,
    });
    db.prepare(`
      UPDATE knowledge_fact_profile_projection_ledger
      SET cycle_root_fact_id = 'fact-b'
      WHERE fact_id = 'fact-b'
    `).run();
    db.pragma('foreign_keys = OFF');
    db.prepare(`DELETE FROM knowledge_facts WHERE id = 'fact-a'`).run();
    db.prepare(`
      DELETE FROM knowledge_fact_profile_projection_ledger
      WHERE fact_id = 'fact-a'
    `).run();
    db.pragma('foreign_keys = ON');
    const before = {
      facts: db.prepare(`SELECT * FROM knowledge_facts ORDER BY id`).all(),
      groups: db.prepare(`
        SELECT * FROM knowledge_fact_projection_support_groups
        ORDER BY workspace_id, domain, normalized_value
      `).all(),
      ledgers: db.prepare(`
        SELECT * FROM knowledge_fact_profile_projection_ledger ORDER BY fact_id
      `).all(),
      roots: db.prepare(`
        SELECT * FROM knowledge_fact_projection_support_group_roots
        ORDER BY workspace_id, domain, normalized_value
      `).all(),
    };
    const deferredStore = new KnowledgeFactProjectionStore(db, {
      deferInitialization: true,
    });

    expect(() => db.transaction(() =>
      deferredStore.deleteParentlessProjectionsInCurrentTransaction(NOW_6))())
      .toThrow(KnowledgeFactProjectionStoreError);

    expect(db.prepare(`SELECT * FROM knowledge_facts ORDER BY id`).all())
      .toEqual(before.facts);
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_projection_support_groups
      ORDER BY workspace_id, domain, normalized_value
    `).all()).toEqual(before.groups);
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_profile_projection_ledger ORDER BY fact_id
    `).all()).toEqual(before.ledgers);
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_projection_support_group_roots
      ORDER BY workspace_id, domain, normalized_value
    `).all()).toEqual(before.roots);
    db.close();
  });

  test('startup cleanup rolls fact recovery and projection deletion back together', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    insertFact(db, 'fact-b');
    applyProjection(db, store);
    applyProjection(db, store, {
      factId: 'fact-b',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_2,
    });
    db.pragma('foreign_keys = OFF');
    db.prepare(`DELETE FROM knowledge_facts WHERE id = 'fact-a'`).run();
    db.prepare(`
      DELETE FROM knowledge_fact_profile_projection_ledger
      WHERE fact_id = 'fact-a'
    `).run();
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TRIGGER fail_parentless_root_cleanup
      BEFORE DELETE ON knowledge_fact_projection_support_group_roots
      BEGIN
        SELECT RAISE(ABORT, 'SECRET cleanup rollback /private/path SELECT');
      END;
    `);
    const before = {
      facts: db.prepare(`SELECT * FROM knowledge_facts ORDER BY id`).all(),
      groups: db.prepare(`
        SELECT * FROM knowledge_fact_projection_support_groups
        ORDER BY workspace_id, domain, normalized_value
      `).all(),
      ledgers: db.prepare(`
        SELECT * FROM knowledge_fact_profile_projection_ledger ORDER BY fact_id
      `).all(),
      roots: db.prepare(`
        SELECT * FROM knowledge_fact_projection_support_group_roots
        ORDER BY workspace_id, domain, normalized_value
      `).all(),
    };
    const deferredStore = new KnowledgeFactProjectionStore(db, {
      deferInitialization: true,
    });

    expect(() => db.transaction(() =>
      deferredStore.deleteParentlessProjectionsInCurrentTransaction(NOW_6))())
      .toThrow(KnowledgeFactProjectionStoreError);

    expect(db.prepare(`SELECT * FROM knowledge_facts ORDER BY id`).all())
      .toEqual(before.facts);
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_projection_support_groups
      ORDER BY workspace_id, domain, normalized_value
    `).all()).toEqual(before.groups);
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_profile_projection_ledger ORDER BY fact_id
    `).all()).toEqual(before.ledgers);
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_projection_support_group_roots
      ORDER BY workspace_id, domain, normalized_value
    `).all()).toEqual(before.roots);
    db.close();
  });

  test('rolls root cleanup back without deleting ledger or group ownership', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    applyProjection(db, store);
    const faultStore = new KnowledgeFactProjectionStore(db, {
      onStage: stage => {
        if (stage === KnowledgeFactProjectionStoreStage.AfterRootCleanup) {
          throw new Error('raw secret root cleanup fault');
        }
      },
    });

    expect(() => db.transaction(() =>
      faultStore.deleteWorkspaceProjectionsInCurrentTransaction('workspace-a'))())
      .toThrow(KnowledgeFactProjectionStoreError);
    expect(store.getLedger('fact-a')).not.toBeNull();
    expect(store.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.factId).toBe('fact-a');
    expect(store.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.activeSupportCount).toBe(1);
    db.close();
  });

  test('fails closed when the persisted root does not own a matching ledger', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    insertFact(db, 'fact-b');
    applyProjection(db, store);
    db.prepare(`
      UPDATE knowledge_fact_projection_support_group_roots
      SET root_fact_id = 'fact-b'
      WHERE workspace_id = 'workspace-a'
    `).run();

    expect(() => store.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )).toThrow(KnowledgeFactProjectionStoreError);
    expect(() => store.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )).toThrow(KnowledgeFactProjectionStoreError);
    db.close();
  });

  test('fails closed when the persisted root belongs to an earlier completed cycle', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    insertFact(db, 'fact-b');
    applyProjection(db, store);
    reverseProjection(db, store, 'fact-a', NOW_2);
    applyProjection(db, store, {
      factId: 'fact-b',
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_3,
    });
    db.prepare(`
      UPDATE knowledge_fact_projection_support_group_roots
      SET root_fact_id = 'fact-a'
      WHERE workspace_id = 'workspace-a'
    `).run();

    expect(() => store.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )).toThrow(KnowledgeFactProjectionStoreError);
    expect(() => store.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )).toThrow(KnowledgeFactProjectionStoreError);
    db.close();
  });

  test('rejects a later support corrupted into the root on getter and restart without writes', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    insertFact(db, 'fact-b');
    applyProjection(db, store);
    applyProjection(db, store, {
      factId: 'fact-b',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_2,
    });
    reverseProjection(db, store, 'fact-a', NOW_3);
    db.prepare(`
      UPDATE knowledge_fact_projection_support_group_roots
      SET root_fact_id = 'fact-b'
      WHERE workspace_id = 'workspace-a'
    `).run();
    const before = {
      groups: db.prepare(`
        SELECT * FROM knowledge_fact_projection_support_groups
        ORDER BY workspace_id, domain, normalized_value
      `).all(),
      roots: db.prepare(`
        SELECT * FROM knowledge_fact_projection_support_group_roots
        ORDER BY workspace_id, domain, normalized_value
      `).all(),
      ledgers: db.prepare(`
        SELECT * FROM knowledge_fact_profile_projection_ledger
        ORDER BY fact_id
      `).all(),
    };
    for (const operation of [
      () => store.getSupportGroupRoot(
        'workspace-a',
        KnowledgeFactDomain.ProductList,
        'industrial robots',
      ),
      () => new KnowledgeFactProjectionStore(db),
    ]) {
      let thrown: unknown;
      try {
        operation();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(KnowledgeFactProjectionStoreError);
      expect(JSON.parse(JSON.stringify(thrown))).toEqual({
        code: 'job_state_conflict',
        message: 'Knowledge fact projection state is invalid',
      });
      expect(thrown).not.toHaveProperty('cause');
      expect(thrown).not.toHaveProperty('stack');
    }
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_projection_support_groups
      ORDER BY workspace_id, domain, normalized_value
    `).all()).toEqual(before.groups);
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_projection_support_group_roots
      ORDER BY workspace_id, domain, normalized_value
    `).all()).toEqual(before.roots);
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_profile_projection_ledger
      ORDER BY fact_id
    `).all()).toEqual(before.ledgers);
    db.close();
  });

  test('keeps one cycle through a reversed-root and active-support bridge across restart', () => {
    const { db, store } = createFixture();
    for (const factId of ['fact-a', 'fact-b', 'fact-c']) {
      insertFact(db, factId);
    }
    applyProjection(db, store);
    applyProjection(db, store, {
      factId: 'fact-b',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_2,
    });
    reverseProjection(db, store, 'fact-a', NOW_3);
    applyProjection(db, store, {
      factId: 'fact-c',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_4,
    });

    const restarted = new KnowledgeFactProjectionStore(db);
    expect(reverseProjection(db, restarted, 'fact-b', NOW_5))
      .toMatchObject({ activeSupportCount: 1 });
    expect(restarted.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.factId).toBe('fact-a');
    expect(reverseProjection(db, restarted, 'fact-c', NOW_6))
      .toMatchObject({ activeSupportCount: 0 });
    expect(restarted.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.factId).toBe('fact-a');
    db.close();
  });

  test('fails a rootless completed support bridge closed without reversal ordering', () => {
    const { db, store } = createFixture();
    for (const factId of ['fact-a', 'fact-b', 'fact-c']) {
      insertFact(db, factId);
    }
    applyProjection(db, store);
    applyProjection(db, store, {
      factId: 'fact-b',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_2,
    });
    reverseProjection(db, store, 'fact-a', NOW_3);
    applyProjection(db, store, {
      factId: 'fact-c',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_4,
    });
    db.transaction(() => {
      db.prepare(`
        UPDATE knowledge_fact_profile_projection_ledger
        SET reversed_at = ?
        WHERE fact_id = 'fact-b'
      `).run(NOW_5);
      db.prepare(`
        UPDATE knowledge_fact_projection_support_groups
        SET active_support_count = 1
        WHERE workspace_id = 'workspace-a'
      `).run();
      db.prepare(`
        UPDATE knowledge_facts
        SET projection_state = ?, tombstoned_at = ?
        WHERE id = 'fact-b'
      `).run(KnowledgeFactProjectionState.Reversed, NOW_5);
    })();
    dropCycleMetadataColumnWhenPresent(db);
    db.exec('DROP TABLE knowledge_fact_projection_support_group_roots');

    expect(() => new KnowledgeFactProjectionStore(db))
      .toThrow(KnowledgeFactProjectionStoreError);
    expect((db.prepare(`
      PRAGMA table_info(knowledge_fact_profile_projection_ledger)
    `).all() as Array<{ name: string }>).some(column =>
      column.name === 'cycle_root_fact_id')).toBe(false);
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE name = 'knowledge_fact_projection_support_group_roots'
    `).get()).toEqual({ count: 0 });
    db.close();
  });

  test('uses explicit cycle identity when a later support clock regresses before the root', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    insertFact(db, 'fact-b');
    applyProjection(db, store, { appliedAt: NOW_3 });
    expect(applyProjection(db, store, {
      factId: 'fact-b',
      action: KnowledgeFactProfileProjectionAction.PreexistingSupport,
      priorValue: ['Industrial robots'],
      priorConfirmedKeyPresent: true,
      priorIgnoredKeyPresent: false,
      appliedAt: NOW_1,
    })).toMatchObject({ activeSupportCount: 2 });

    const restarted = new KnowledgeFactProjectionStore(db);
    expect(restarted.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.factId).toBe('fact-a');
    expect(reverseProjection(db, restarted, 'fact-b', NOW_4))
      .toMatchObject({ activeSupportCount: 1 });
    expect(reverseProjection(db, restarted, 'fact-a', NOW_5))
      .toMatchObject({ activeSupportCount: 0 });
    db.close();
  });

  test.each([
    {
      label: 'missing fact',
      corrupt: (db: Database.Database) => {
        db.pragma('foreign_keys = OFF');
        db.prepare(`DELETE FROM knowledge_facts WHERE id = 'fact-a'`).run();
        db.pragma('foreign_keys = ON');
      },
    },
    {
      label: 'foreign workspace identity',
      corrupt: (db: Database.Database) => db.prepare(`
        UPDATE knowledge_facts SET workspace_id = 'workspace-b' WHERE id = 'fact-a'
      `).run(),
    },
    {
      label: 'pending review status',
      corrupt: (db: Database.Database) => db.prepare(`
        UPDATE knowledge_facts SET review_status = ? WHERE id = 'fact-a'
      `).run(KnowledgeFactReviewStatus.Pending),
    },
    {
      label: 'inactive projection state',
      corrupt: (db: Database.Database) => db.prepare(`
        UPDATE knowledge_facts SET projection_state = ? WHERE id = 'fact-a'
      `).run(KnowledgeFactProjectionState.None),
    },
    {
      label: 'unexpected tombstone',
      corrupt: (db: Database.Database) => db.prepare(`
        UPDATE knowledge_facts SET tombstoned_at = ? WHERE id = 'fact-a'
      `).run(NOW_2),
    },
  ])('rejects active ledger ownership corruption: $label', ({ corrupt }) => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    applyProjection(db, store);
    corrupt(db);
    const before = {
      facts: db.prepare(`SELECT * FROM knowledge_facts ORDER BY id`).all(),
      groups: db.prepare(`
        SELECT * FROM knowledge_fact_projection_support_groups
        ORDER BY workspace_id, domain, normalized_value
      `).all(),
      roots: db.prepare(`
        SELECT * FROM knowledge_fact_projection_support_group_roots
        ORDER BY workspace_id, domain, normalized_value
      `).all(),
      ledgers: db.prepare(`
        SELECT * FROM knowledge_fact_profile_projection_ledger
        ORDER BY fact_id
      `).all(),
    };

    for (const operation of [
      () => store.getSupportGroup(
        'workspace-a',
        KnowledgeFactDomain.ProductList,
        'industrial robots',
      ),
      () => store.getSupportGroupRoot(
        'workspace-a',
        KnowledgeFactDomain.ProductList,
        'industrial robots',
      ),
      () => new KnowledgeFactProjectionStore(db),
    ]) {
      let thrown: unknown;
      try {
        operation();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(KnowledgeFactProjectionStoreError);
      expect(JSON.parse(JSON.stringify(thrown))).toEqual({
        code: 'job_state_conflict',
        message: 'Knowledge fact projection state is invalid',
      });
      expect(thrown).not.toHaveProperty('cause');
      expect(thrown).not.toHaveProperty('stack');
    }
    expect(db.prepare(`SELECT * FROM knowledge_facts ORDER BY id`).all())
      .toEqual(before.facts);
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_projection_support_groups
      ORDER BY workspace_id, domain, normalized_value
    `).all()).toEqual(before.groups);
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_projection_support_group_roots
      ORDER BY workspace_id, domain, normalized_value
    `).all()).toEqual(before.roots);
    expect(db.prepare(`
      SELECT * FROM knowledge_fact_profile_projection_ledger
      ORDER BY fact_id
    `).all()).toEqual(before.ledgers);
    db.close();
  });

  test.each([
    {
      label: 'active projection state',
      corrupt: (db: Database.Database) => db.prepare(`
        UPDATE knowledge_facts SET projection_state = ? WHERE id = 'fact-a'
      `).run(KnowledgeFactProjectionState.Active),
    },
    {
      label: 'missing tombstone',
      corrupt: (db: Database.Database) => db.prepare(`
        UPDATE knowledge_facts SET tombstoned_at = NULL WHERE id = 'fact-a'
      `).run(),
    },
  ])('rejects reversed ledger fact corruption: $label', ({ corrupt }) => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    applyProjection(db, store);
    reverseProjection(db, store, 'fact-a', NOW_2);
    corrupt(db);

    expect(() => store.getSupportGroup(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )).toThrow(KnowledgeFactProjectionStoreError);
    expect(() => store.getSupportGroupRoot(
      'workspace-a',
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )).toThrow(KnowledgeFactProjectionStoreError);
    expect(() => new KnowledgeFactProjectionStore(db))
      .toThrow(KnowledgeFactProjectionStoreError);
    db.close();
  });

  test('maps corrupt rows and raw SQLite failures to one fixed safe error', () => {
    const { db, store } = createFixture();
    insertFact(db, 'fact-a');
    applyProjection(db, store);
    db.pragma('ignore_check_constraints = ON');
    db.prepare(`
      UPDATE knowledge_fact_projection_support_groups
      SET active_support_count = -1
      WHERE workspace_id = 'workspace-a'
    `).run();
    db.pragma('ignore_check_constraints = OFF');

    let thrown: unknown;
    try {
      store.getSupportGroup(
        'workspace-a',
        KnowledgeFactDomain.ProductList,
        'industrial robots',
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KnowledgeFactProjectionStoreError);
    expect(JSON.parse(JSON.stringify(thrown))).toEqual({
      code: 'job_state_conflict',
      message: 'Knowledge fact projection state is invalid',
    });
    expect(thrown).not.toHaveProperty('cause');
    expect(thrown).not.toHaveProperty('stack');
    expect(JSON.stringify(thrown)).not.toContain('knowledge_fact_projection_support_groups');
    db.close();
  });
});
