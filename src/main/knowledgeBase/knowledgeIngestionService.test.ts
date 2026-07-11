import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeIngestionJobStatus,
} from '../../shared/knowledgeBase/constants';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';
import { KnowledgeIngestionJobStore } from './knowledgeIngestionJobStore';
import { KnowledgeIngestionService } from './knowledgeIngestionService';
import { KnowledgeManagedFileStore } from './knowledgeManagedFileStore';

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

describe('KnowledgeIngestionService', () => {
  let db: Database.Database;
  let documentStore: KnowledgeDocumentStore;
  let jobStore: KnowledgeIngestionJobStore;
  let managedFileStore: KnowledgeManagedFileStore;
  let managedRoot: string;

  beforeEach(() => {
    db = new Database(':memory:');
    documentStore = new KnowledgeDocumentStore(db);
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
  ) => {
    const blob = await managedFileStore.importTextSnapshot(`bytes:${displayName}`);
    const created = documentStore.createDocumentWithVersion({
      workspaceId: 'workspace-a',
      displayName,
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Pending,
      version: {
        contentHash: blob.contentHash,
        managedPath: blob.managedPath,
        mimeType: displayName.endsWith('.png') ? 'image/png' : 'application/pdf',
        fileSize: blob.fileSize,
        sourceMtime: 100,
        parser: null,
        extractedText: null,
        extractionPartial: false,
      },
    });
    const job = jobStore.createJob(
      {
        workspaceId: 'workspace-a',
        documentId: created.document.id,
        documentVersionId: created.version.id,
      },
      createdAt,
    );
    return { ...created, job };
  };

  test('drains a queued job and commits local text to the exact current version', async () => {
    const created = await createQueuedDocument('manual.pdf');
    const extractDocumentText = vi.fn().mockResolvedValue({
      content: 'local text',
      parser: 'pdf',
      truncated: true,
    });
    const onDocumentUpdated = vi.fn();
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      extractDocumentText,
      onDocumentUpdated,
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
    expect(onDocumentUpdated).toHaveBeenCalledWith('workspace-a', created.document.id);
  });

  test('marks an empty successful parse as completed without text', async () => {
    const created = await createQueuedDocument('empty.pdf');
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      extractDocumentText: vi.fn().mockResolvedValue({
        content: '   ',
        parser: 'pdf',
        truncated: false,
      }),
    });

    service.wake();
    await service.waitForIdle();

    expect(documentStore.getDocument(created.document.id)?.status).toBe(
      KnowledgeDocumentStatus.CompletedWithoutText,
    );
    expect(jobStore.getJob(created.job.id)?.status).toBe(
      KnowledgeIngestionJobStatus.Completed,
    );
  });

  test('stores only a stable sanitized failure when local extraction throws', async () => {
    const created = await createQueuedDocument('broken.pdf');
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      extractDocumentText: vi.fn().mockRejectedValue(
        new Error('/private/customer/secret.pdf parser stack detail'),
      ),
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
  });

  test('does not commit output after the document is deleted during extraction', async () => {
    const created = await createQueuedDocument('deleted.pdf');
    const extraction = deferred<{ content: string; parser: string; truncated: boolean }>();
    const extractDocumentText = vi.fn(() => extraction.promise);
    const service = new KnowledgeIngestionService({
      db,
      documentStore,
      jobStore,
      managedFileStore,
      extractDocumentText,
    });

    service.wake();
    await vi.waitFor(() => expect(extractDocumentText).toHaveBeenCalledTimes(1));
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
      extractDocumentText,
    });

    service.wake();
    await vi.waitFor(() => {
      expect(jobStore.listCurrentJobs('workspace-a').filter(job => job.status === 'running'))
        .toHaveLength(2);
    });
    expect(extractDocumentText).toHaveBeenCalledTimes(1);
    firstGate.resolve();
    await vi.waitFor(() => expect(extractDocumentText).toHaveBeenCalledTimes(2));
    secondGate.resolve();
    await service.waitForIdle();
  });
});
