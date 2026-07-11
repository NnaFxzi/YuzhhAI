import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { KNOWLEDGE_MAX_FILE_BYTES } from '../../shared/knowledgeBase/constants';
import { KnowledgeManagedFileStore } from './knowledgeManagedFileStore';

describe('KnowledgeManagedFileStore', () => {
  let tempDir: string;
  let sourceDir: string;
  let store: KnowledgeManagedFileStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-knowledge-files-'));
    sourceDir = path.join(tempDir, 'sources');
    await fs.mkdir(sourceDir, { recursive: true });
    store = new KnowledgeManagedFileStore(path.join(tempDir, 'managed'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('stores identical bytes once and returns a relative managed path', async () => {
    const firstPath = path.join(sourceDir, 'first.txt');
    const secondPath = path.join(sourceDir, 'second.txt');
    await fs.writeFile(firstPath, 'same bytes');
    await fs.writeFile(secondPath, 'same bytes');

    const first = await store.importFile(firstPath);
    const second = await store.importFile(secondPath);

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.managedPath).toBe(second.managedPath);
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(path.isAbsolute(first.managedPath)).toBe(false);
    expect(await fs.readFile(store.resolveManagedPath(first.managedPath), 'utf8')).toBe(
      'same bytes',
    );
  });

  test('imports text snapshots through the same content-addressed storage', async () => {
    const first = await store.importTextSnapshot('本地知识快照');
    const second = await store.importTextSnapshot('本地知识快照');

    expect(first.contentHash).toBe(second.contentHash);
    expect(second.reused).toBe(true);
    expect(await fs.readFile(store.resolveManagedPath(first.managedPath), 'utf8')).toBe(
      '本地知识快照',
    );
  });

  test('rejects managed paths outside the blob root', () => {
    expect(() => store.resolveManagedPath('../secrets.txt')).toThrow(
      'Invalid managed blob path',
    );
    expect(() => store.resolveManagedPath(`blobs/aa/${'A'.repeat(64)}`)).toThrow(
      'Invalid managed blob path',
    );
  });

  test('rejects files over the approved size limit without leaving temporary files', async () => {
    const largePath = path.join(sourceDir, 'large.bin');
    await fs.writeFile(largePath, 'x');
    await fs.truncate(largePath, KNOWLEDGE_MAX_FILE_BYTES + 1);

    await expect(store.importFile(largePath)).rejects.toThrow('Knowledge file is too large');
    await expect(fs.readdir(path.join(tempDir, 'managed', 'tmp'))).resolves.toEqual([]);
  });

  test('cleans temporary files when the source cannot be read', async () => {
    await expect(store.importFile(path.join(sourceDir, 'missing.txt'))).rejects.toThrow();
    await expect(fs.readdir(path.join(tempDir, 'managed', 'tmp'))).resolves.toEqual([]);
  });

  test('sweeps only old crash-leftover temporary blobs', async () => {
    await store.importTextSnapshot('initialize directories');
    const temporaryDir = path.join(tempDir, 'managed', 'tmp');
    const abandonedName = '11111111-1111-4111-8111-111111111111.tmp';
    const recentName = '22222222-2222-4222-8222-222222222222.tmp';
    const unrelatedName = 'keep-me.tmp';
    await Promise.all([
      fs.writeFile(path.join(temporaryDir, abandonedName), 'abandoned'),
      fs.writeFile(path.join(temporaryDir, recentName), 'recent'),
      fs.writeFile(path.join(temporaryDir, unrelatedName), 'unrelated'),
    ]);
    const nowMs = Date.parse('2026-07-11T02:00:00.000Z');
    const oldDate = new Date(nowMs - 2 * 60 * 60_000);
    const recentDate = new Date(nowMs - 5 * 60_000);
    await fs.utimes(path.join(temporaryDir, abandonedName), oldDate, oldDate);
    await fs.utimes(path.join(temporaryDir, recentName), recentDate, recentDate);

    await expect(store.cleanupAbandonedTemporaryFiles(nowMs)).resolves.toBe(1);
    expect((await fs.readdir(temporaryDir)).sort()).toEqual(
      [unrelatedName, recentName].sort(),
    );
  });
});
