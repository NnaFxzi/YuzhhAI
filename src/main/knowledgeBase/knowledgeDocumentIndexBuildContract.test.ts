import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

describe('knowledge document index worker build contract', () => {
  test('builds, unpacks, and waits for the fixed worker artifact', () => {
    const viteConfig = fs.readFileSync(path.resolve('vite.config.mts'), 'utf8');
    const builderConfig = JSON.parse(
      fs.readFileSync(path.resolve('electron-builder.json'), 'utf8'),
    ) as { asarUnpack?: string[] };
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve('package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    const runner = fs.readFileSync(
      path.resolve('src/main/knowledgeBase/knowledgeDocumentIndexRunner.ts'),
      'utf8',
    );
    const worker = fs.readFileSync(
      path.resolve('src/main/knowledgeBase/knowledgeDocumentIndexWorker.ts'),
      'utf8',
    );
    const executor = fs.readFileSync(
      path.resolve('src/main/knowledgeBase/knowledgeDocumentIndexExecutor.ts'),
      'utf8',
    );
    const responsivenessTest = fs.readFileSync(
      path.resolve('src/main/knowledgeBase/knowledgeDocumentIndexResponsiveness.test.ts'),
      'utf8',
    );
    const inlineExecutorStart = executor.indexOf(
      'export class InlineKnowledgeDocumentIndexExecutor',
    );
    const inlineExecutorEnd = executor.indexOf(
      '\ntype KnowledgeDocumentIndexWorkerFactory',
      inlineExecutorStart,
    );
    const inlineExecutor = executor.slice(inlineExecutorStart, inlineExecutorEnd);

    expect(viteConfig).toContain(
      "entry: 'src/main/knowledgeBase/knowledgeDocumentIndexWorker.ts'",
    );
    expect(viteConfig).toContain("entryFileNames: 'knowledge-index-worker.js'");
    expect(viteConfig).toContain('emptyOutDir: false');
    expect(viteConfig).toContain("external: ['better-sqlite3']");
    expect(viteConfig).not.toContain('knowledge-index-worker-ready');
    const workerEntryStart = viteConfig.indexOf(
      "entry: 'src/main/knowledgeBase/knowledgeDocumentIndexWorker.ts'",
    );
    const workerEntryEnd = viteConfig.indexOf('\n    ])', workerEntryStart);
    expect(viteConfig.slice(workerEntryStart, workerEntryEnd)).toContain('onstart() {}');

    expect(builderConfig.asarUnpack).toContain('dist-electron/knowledge-index-worker.js');
    expect(builderConfig.asarUnpack).toContain('node_modules/better-sqlite3/**');

    expect(packageJson.scripts?.['electron:dev']).toContain(
      'http://localhost:5175 dist-electron/.electron-ready dist-electron/knowledge-index-worker.js',
    );
    expect(runner).toContain('offset += KNOWLEDGE_INDEX_WORKER_WRITE_BATCH_CHUNKS');
    expect(runner).toContain(
      'chunks.slice(offset, offset + KNOWLEDGE_INDEX_WORKER_WRITE_BATCH_CHUNKS)',
    );
    expect(runner).toContain(
      'purgeInactiveGenerationBatch(KNOWLEDGE_INDEX_WORKER_CLEANUP_BATCH_ROWS)',
    );
    expect(worker).toContain('const knowledgeDocumentIndexWriterYieldArray = new Int32Array(');
    expect(worker).toContain('new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)');
    expect(worker.match(/new SharedArrayBuffer/g)).toHaveLength(1);
    expect(worker).toContain('Atomics.wait(');
    expect(worker).toContain('KNOWLEDGE_INDEX_WORKER_WRITER_YIELD_MS');
    expect(worker).toContain('KNOWLEDGE_INDEX_WORKER_CLEANUP_YIELD_MS');
    expect(worker).toContain(
      'afterSuccessfulWriteBatch: yieldAfterSuccessfulWriteBatch',
    );
    expect(worker).toContain(
      'afterSuccessfulCleanupBatch: yieldAfterSuccessfulCleanupBatch',
    );
    expect(inlineExecutorStart).toBeGreaterThanOrEqual(0);
    expect(inlineExecutorEnd).toBeGreaterThan(inlineExecutorStart);
    expect(inlineExecutor).not.toContain('afterSuccessfulWriteBatch');
    expect(inlineExecutor).not.toContain('afterSuccessfulCleanupBatch');
    expect(responsivenessTest).toContain('workerScriptPath: workerPath');
    expect(responsivenessTest).toContain('indexedCount: 5');
    expect(responsivenessTest).toContain('failedCount: 0');
    expect(responsivenessTest).toContain('expect(maxTimerDriftMs).toBeLessThan(250)');
    expect(responsivenessTest).toContain('expect(maxMainWriteMs).toBeLessThan(250)');
  });
});
