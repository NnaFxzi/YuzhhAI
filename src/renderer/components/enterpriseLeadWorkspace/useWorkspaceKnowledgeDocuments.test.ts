import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeIngestionJobStatus,
  KnowledgeIngestionStage,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeDocumentIndexSummary,
  KnowledgeDocumentListItem,
} from '../../../shared/knowledgeBase/types';
import {
  createKnowledgeDocumentPollingController,
  createKnowledgeDocumentRequestSequencer,
  retryKnowledgeDocumentLocalIndex,
  runKnowledgeDocumentGenerationTask,
} from './useWorkspaceKnowledgeDocuments';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
};

const documentItem = (
  jobStatus: KnowledgeIngestionJobStatus,
  overrides: Partial<KnowledgeDocumentListItem> = {},
): KnowledgeDocumentListItem => ({
  id: 'document-1',
  displayName: 'manual.pdf',
  sourceMode: KnowledgeDocumentSourceMode.Managed,
  currentVersionId: 'version-1',
  revision: 1,
  status:
    jobStatus === KnowledgeIngestionJobStatus.Completed
      ? KnowledgeDocumentStatus.Ready
      : KnowledgeDocumentStatus.Processing,
  fileSize: 100,
  mimeType: 'application/pdf',
  contentHash: 'a'.repeat(64),
  currentJob: {
    id: 'job-1',
    documentVersionId: 'version-1',
    stage: KnowledgeIngestionStage.Parsing,
    status: jobStatus,
    progress: 0.5,
    errorCode: null,
    updatedAt: '2026-07-11T00:00:00.000Z',
  },
  localIndex: null,
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  deletedAt: null,
  ...overrides,
});

const createIndexSummary = (
  status: KnowledgeDocumentIndexStatus,
  overrides: Partial<KnowledgeDocumentIndexSummary> = {},
): KnowledgeDocumentIndexSummary => ({
  documentVersionId: 'version-a',
  status,
  chunkCount: 0,
  attemptCount: 1,
  errorCode: null,
  updatedAt: '2026-07-11T00:00:00.000Z',
  completedAt: null,
  ...overrides,
});

describe('knowledge document polling controller', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('runs one request at a time and stops when work completes', async () => {
    vi.useFakeTimers();
    const first = deferred<KnowledgeDocumentListItem[]>();
    const loadDocuments = vi.fn(() => first.promise);
    const onDocuments = vi.fn();
    const controller = createKnowledgeDocumentPollingController({
      loadDocuments,
      onDocuments,
      onError: vi.fn(),
    });

    const initial = controller.refresh();
    controller.update([documentItem(KnowledgeIngestionJobStatus.Queued)]);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(loadDocuments).toHaveBeenCalledTimes(1);
    first.resolve([documentItem(KnowledgeIngestionJobStatus.Completed)]);
    await initial;
    await vi.advanceTimersByTimeAsync(4_000);

    expect(onDocuments).toHaveBeenCalledWith([
      documentItem(KnowledgeIngestionJobStatus.Completed),
    ]);
    expect(loadDocuments).toHaveBeenCalledTimes(1);
  });

  test('polls again after two seconds while active work remains', async () => {
    vi.useFakeTimers();
    const loadDocuments = vi
      .fn()
      .mockResolvedValueOnce([documentItem(KnowledgeIngestionJobStatus.Running)])
      .mockResolvedValueOnce([documentItem(KnowledgeIngestionJobStatus.Completed)]);
    const controller = createKnowledgeDocumentPollingController({
      loadDocuments,
      onDocuments: vi.fn(),
      onError: vi.fn(),
    });

    await controller.refresh();
    expect(loadDocuments).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(loadDocuments).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(loadDocuments).toHaveBeenCalledTimes(2);
  });

  test.each([
    KnowledgeDocumentIndexStatus.Pending,
    KnowledgeDocumentIndexStatus.Indexing,
  ])('polls again while local indexing remains %s', async status => {
    vi.useFakeTimers();
    const localIndex = createIndexSummary(status, { documentVersionId: 'version-1' });
    const loadDocuments = vi
      .fn()
      .mockResolvedValueOnce([
        documentItem(KnowledgeIngestionJobStatus.Completed, {
          currentJob: null,
          localIndex,
        }),
      ])
      .mockResolvedValueOnce([
        documentItem(KnowledgeIngestionJobStatus.Completed, {
          currentJob: null,
          localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed, {
            documentVersionId: 'version-1',
          }),
        }),
      ]);
    const controller = createKnowledgeDocumentPollingController({
      loadDocuments,
      onDocuments: vi.fn(),
      onError: vi.fn(),
    });

    await controller.refresh();
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(4_000);

    expect(loadDocuments).toHaveBeenCalledTimes(2);
  });

  test.each([
    KnowledgeDocumentIndexStatus.Indexed,
    KnowledgeDocumentIndexStatus.NotApplicable,
    KnowledgeDocumentIndexStatus.Failed,
  ])('does not poll again when local indexing is terminal: %s', async status => {
    vi.useFakeTimers();
    const loadDocuments = vi.fn().mockResolvedValue([
      documentItem(KnowledgeIngestionJobStatus.Completed, {
        currentJob: null,
        localIndex: createIndexSummary(status, { documentVersionId: 'version-1' }),
      }),
    ]);
    const controller = createKnowledgeDocumentPollingController({
      loadDocuments,
      onDocuments: vi.fn(),
      onError: vi.fn(),
    });

    await controller.refresh();
    await vi.advanceTimersByTimeAsync(4_000);

    expect(loadDocuments).toHaveBeenCalledTimes(1);
  });

  test('ignores an old workspace response after disposal', async () => {
    const request = deferred<KnowledgeDocumentListItem[]>();
    const onDocuments = vi.fn();
    const controller = createKnowledgeDocumentPollingController({
      loadDocuments: () => request.promise,
      onDocuments,
      onError: vi.fn(),
    });

    const refresh = controller.refresh();
    controller.dispose();
    request.resolve([documentItem(KnowledgeIngestionJobStatus.Completed)]);
    await refresh;

    expect(onDocuments).not.toHaveBeenCalled();
  });

  test('preserves active polling after a transient error', async () => {
    vi.useFakeTimers();
    const transient = new Error('transient');
    const loadDocuments = vi
      .fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce([documentItem(KnowledgeIngestionJobStatus.Completed)]);
    const onError = vi.fn();
    const controller = createKnowledgeDocumentPollingController({
      loadDocuments,
      onDocuments: vi.fn(),
      onError,
    });
    controller.update([documentItem(KnowledgeIngestionJobStatus.Running)]);

    await expect(controller.refresh()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(transient);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(loadDocuments).toHaveBeenCalledTimes(2);
  });

  test('continues polling when only a deleted document still has active work', async () => {
    vi.useFakeTimers();
    const deletedRunning = {
      ...documentItem(KnowledgeIngestionJobStatus.Running),
      deletedAt: '2026-07-11T01:00:00.000Z',
    };
    const deletedCompleted = {
      ...documentItem(KnowledgeIngestionJobStatus.Completed),
      deletedAt: '2026-07-11T01:00:00.000Z',
    };
    const loadDocuments = vi
      .fn()
      .mockResolvedValueOnce([deletedRunning])
      .mockResolvedValueOnce([deletedCompleted]);
    const controller = createKnowledgeDocumentPollingController({
      loadDocuments,
      onDocuments: vi.fn(),
      onError: vi.fn(),
    });

    await controller.refresh();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(loadDocuments).toHaveBeenCalledTimes(2);
  });
});

describe('knowledge document generation task', () => {
  test('ignores success callbacks after the workspace generation changes', async () => {
    const request = deferred<string>();
    let generation = 1;
    const onCurrentSuccess = vi.fn();
    const onCurrentSettled = vi.fn();
    const task = runKnowledgeDocumentGenerationTask({
      operation: () => request.promise,
      isCurrent: () => generation === 1,
      onCurrentSuccess,
      onCurrentSettled,
    });

    generation = 2;
    request.resolve('old workspace result');

    await expect(task).resolves.toBe('old workspace result');
    expect(onCurrentSuccess).not.toHaveBeenCalled();
    expect(onCurrentSettled).not.toHaveBeenCalled();
  });

  test('ignores error callbacks after the workspace generation changes', async () => {
    const request = deferred<string>();
    let generation = 1;
    const onCurrentError = vi.fn();
    const onCurrentSettled = vi.fn();
    const task = runKnowledgeDocumentGenerationTask({
      operation: () => request.promise,
      isCurrent: () => generation === 1,
      onCurrentError,
      onCurrentSettled,
    });

    generation = 2;
    request.reject(new Error('old workspace failure'));

    await expect(task).rejects.toThrow('old workspace failure');
    expect(onCurrentError).not.toHaveBeenCalled();
    expect(onCurrentSettled).not.toHaveBeenCalled();
  });
});

describe('knowledge document local-index retry', () => {
  test('retries local indexing with the exact document and version', async () => {
    const document = documentItem(KnowledgeIngestionJobStatus.Completed, {
      id: 'document-a',
      currentVersionId: 'version-a',
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Failed),
    });
    const retryLocalIndex = vi.fn(async () => document);
    const retryDocument = vi.fn(async () => document);

    await retryKnowledgeDocumentLocalIndex({ retryLocalIndex }, document);

    expect(retryLocalIndex).toHaveBeenCalledWith('document-a', 'version-a');
    expect(retryDocument).not.toHaveBeenCalled();
  });
});

describe('knowledge document request sequencer', () => {
  test('accepts only the latest detail request and supports invalidation', () => {
    const sequencer = createKnowledgeDocumentRequestSequencer();
    const first = sequencer.next();
    const second = sequencer.next();

    expect(sequencer.isCurrent(first)).toBe(false);
    expect(sequencer.isCurrent(second)).toBe(true);

    sequencer.invalidate();
    expect(sequencer.isCurrent(second)).toBe(false);
  });
});
