import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  isTransientSqliteBusyError,
  runTransientSqliteWriteTransaction,
  runTransientSqliteWriteTransactionUntilSuccess,
} from './sqliteTransactionRetry';

describe('SQLite transaction retry helpers', () => {
  test('identifies only raw transient SQLite busy result codes', () => {
    expect(isTransientSqliteBusyError({ code: 'SQLITE_BUSY' })).toBe(true);
    expect(isTransientSqliteBusyError({ code: 'SQLITE_BUSY_SNAPSHOT' })).toBe(true);
    expect(isTransientSqliteBusyError({ code: 'SQLITE_CONSTRAINT' })).toBe(false);
    expect(isTransientSqliteBusyError(new Error('database is locked'))).toBe(false);
    expect(isTransientSqliteBusyError(null)).toBe(false);
  });

  test('runs at most four attempts in one synchronous retry round', () => {
    const busyError = Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' });
    let attempts = 0;

    expect(() => runTransientSqliteWriteTransaction(() => {
      attempts += 1;
      throw busyError;
    })).toThrow(busyError);
    expect(attempts).toBe(4);
  });

  test('retries busy snapshots but immediately preserves non-busy failures', () => {
    let busyAttempts = 0;
    expect(runTransientSqliteWriteTransaction(() => {
      busyAttempts += 1;
      if (busyAttempts < 3) {
        throw Object.assign(new Error('snapshot'), { code: 'SQLITE_BUSY_SNAPSHOT' });
      }
      return 'committed';
    })).toBe('committed');
    expect(busyAttempts).toBe(3);

    const constraintError = Object.assign(new Error('constraint'), {
      code: 'SQLITE_CONSTRAINT',
    });
    let constraintAttempts = 0;
    expect(() => runTransientSqliteWriteTransaction(() => {
      constraintAttempts += 1;
      throw constraintError;
    })).toThrow(constraintError);
    expect(constraintAttempts).toBe(1);
  });

  test('uses capped cross-round backoff until a fresh retry round succeeds', async () => {
    const expectedDelays = [25, 50, 100, 200, 250, 250];
    const observedDelays: number[] = [];
    let attempts = 0;

    const result = await runTransientSqliteWriteTransactionUntilSuccess(
      () => {
        attempts += 1;
        if (attempts <= expectedDelays.length * 4) {
          throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' });
        }
        return 'committed';
      },
      async delayMs => {
        observedDelays.push(delayMs);
      },
    );

    expect(result).toBe('committed');
    expect(attempts).toBe(25);
    expect(observedDelays).toEqual(expectedDelays);
  });

  test('keeps generic SQLite retry helpers out of knowledge index dependencies', () => {
    const consumerPaths = [
      'src/main/knowledgeBase/knowledgeDocumentIndexStore.ts',
      'src/main/knowledgeBase/knowledgeDocumentIndexWorker.ts',
      'src/main/knowledgeBase/knowledgeDocumentIndexRunner.ts',
      'src/main/knowledgeBase/knowledgeDocumentIndexExecutor.ts',
      'src/main/knowledgeBase/knowledgeDocumentService.ts',
      'src/main/knowledgeBase/knowledgeIngestionService.ts',
      'src/main/knowledgeBase/knowledgeEnrichmentRequestStore.ts',
    ];
    const genericHelperNames = [
      'TransientSqliteBusyRetryDelay',
      'isTransientSqliteBusyError',
      'runTransientSqliteWriteTransaction',
      'runTransientSqliteWriteTransactionUntilSuccess',
    ];

    for (const consumerPath of consumerPaths) {
      const absoluteConsumerPath = path.resolve(consumerPath);
      if (!fs.existsSync(absoluteConsumerPath)) {
        continue;
      }
      const source = fs.readFileSync(absoluteConsumerPath, 'utf8');
      const indexStoreImports = source.match(
        /import[^;]+from\s+['"]\.\/knowledgeDocumentIndexStore['"];?/g,
      ) ?? [];
      for (const indexStoreImport of indexStoreImports) {
        for (const helperName of genericHelperNames) {
          expect(indexStoreImport).not.toContain(helperName);
        }
      }
    }
  });
});
