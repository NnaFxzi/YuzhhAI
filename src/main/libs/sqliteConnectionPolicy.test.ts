import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { applySqliteConnectionPolicy } from './sqliteConnectionPolicy';

describe('applySqliteConnectionPolicy', () => {
  let tempDirectory: string;

  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-connection-policy-'));
  });

  afterEach(() => {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  test('applies the same WAL and busy policy to independent connections', () => {
    const databasePath = path.join(tempDirectory, 'knowledge.sqlite');
    const mainDb = new Database(databasePath);
    const workerDb = new Database(databasePath);

    applySqliteConnectionPolicy(mainDb);
    applySqliteConnectionPolicy(workerDb);

    for (const db of [mainDb, workerDb]) {
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(db.pragma('synchronous', { simple: true })).toBe(1);
      expect(db.pragma('cache_size', { simple: true })).toBe(-8000);
      expect(db.pragma('wal_autocheckpoint', { simple: true })).toBe(1000);
      expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    }

    workerDb.close();
    mainDb.close();
  });
});
