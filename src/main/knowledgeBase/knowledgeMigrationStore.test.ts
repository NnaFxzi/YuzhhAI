import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { KnowledgeMigrationStatus } from '../../shared/knowledgeBase/constants';
import { KnowledgeMigrationStore } from './knowledgeMigrationStore';

describe('KnowledgeMigrationStore', () => {
  let db: Database.Database;
  let store: KnowledgeMigrationStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new KnowledgeMigrationStore(db);
  });

  afterEach(() => {
    db.close();
  });

  test('persists progress and restarts a failed migration without losing its checkpoint', () => {
    store.begin('workspace-a', 1, 3, '2026-07-11T01:00:00.000Z');
    store.recordProgress('workspace-a', 1, 'legacy-1', '2026-07-11T01:01:00.000Z');
    store.fail('workspace-a', ['source 2 unavailable'], '2026-07-11T01:02:00.000Z');

    const restarted = store.begin('workspace-a', 1, 3, '2026-07-11T01:03:00.000Z');
    expect(restarted.status).toBe(KnowledgeMigrationStatus.Running);
    expect(restarted.migratedCount).toBe(1);
    expect(restarted.lastSourceId).toBe('legacy-1');
  });

  test('resets checkpoints when the migration version changes', () => {
    store.begin('workspace-a', 1, 3, '2026-07-11T01:00:00.000Z');
    store.recordProgress('workspace-a', 2, 'legacy-2', '2026-07-11T01:01:00.000Z');

    const upgraded = store.begin('workspace-a', 2, 4, '2026-07-11T02:00:00.000Z');
    expect(upgraded.version).toBe(2);
    expect(upgraded.migratedCount).toBe(0);
    expect(upgraded.lastSourceId).toBeNull();
  });

  test('keeps a completed migration idempotent', () => {
    store.begin('workspace-a', 1, 1, '2026-07-11T01:00:00.000Z');
    const completed = store.complete(
      'workspace-a',
      ['migrated successfully'],
      '2026-07-11T01:02:00.000Z',
    );

    const repeated = store.begin('workspace-a', 1, 1, '2026-07-11T03:00:00.000Z');
    expect(repeated).toEqual(completed);
  });

  test('bounds and sanitizes migration diagnostics', () => {
    store.begin('workspace-a', 1, 1, '2026-07-11T01:00:00.000Z');
    const failed = store.fail(
      'workspace-a',
      Array.from({ length: 60 }, (_value, index) => ` diagnostic-${index} ${'x'.repeat(600)} `),
      '2026-07-11T01:02:00.000Z',
    );

    expect(failed.diagnostics).toHaveLength(50);
    expect(failed.diagnostics[0]?.length).toBe(500);
    expect(failed.diagnostics[0]?.startsWith('diagnostic-0')).toBe(true);
  });
});
