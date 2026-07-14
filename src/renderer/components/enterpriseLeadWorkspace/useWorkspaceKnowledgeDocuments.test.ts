import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeEnrichmentStatus,
  KnowledgeIngestionJobStatus,
  KnowledgeIngestionStage,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeDocumentIndexSummary,
  KnowledgeDocumentListItem,
  KnowledgeEnrichmentSummary,
  KnowledgeExtractionAuthorizationPreparation,
} from '../../../shared/knowledgeBase/types';
import { KnowledgeBaseServiceError } from '../../services/knowledgeBase';
import {
  applyCurrentKnowledgeDocumentExtractionResult,
  applyKnowledgeDocumentEnrichmentSummary,
  cancelKnowledgeDocumentExtraction,
  createKnowledgeDocumentPollingController,
  createKnowledgeDocumentRequestSequencer,
  mergeKnowledgeDocumentListItems,
  prepareCurrentKnowledgeDocumentExtractionAuthorization,
  prepareKnowledgeDocumentExtractionAuthorization,
  requestKnowledgeDocumentExtraction,
  retryKnowledgeDocumentExtraction,
  retryKnowledgeDocumentLocalIndex,
  runKnowledgeDocumentExtractionMutationTask,
  runKnowledgeDocumentGenerationTask,
  toKnowledgeDocumentServiceError,
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
  enrichment: null,
  hasStalePriorVersionExtraction: false,
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

const createEnrichmentSummary = (
  status: KnowledgeEnrichmentStatus,
  overrides: Partial<KnowledgeEnrichmentSummary> = {},
): KnowledgeEnrichmentSummary => ({
  requestId: 'request-a',
  documentId: 'document-1',
  documentVersionId: 'version-1',
  status,
  progress: 0.5,
  revision: 1,
  attemptCount: 1,
  validCandidateCount: 2,
  discardedCandidateCount: 0,
  pendingFactCount: 2,
  partialReasons: [],
  errorCode: null,
  createdAt: '2026-07-11T01:00:00.000Z',
  updatedAt: '2026-07-11T01:01:00.000Z',
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

  test('coalesces refreshes during an active load into exactly one trailing refresh', async () => {
    const first = deferred<KnowledgeDocumentListItem[]>();
    const second = deferred<KnowledgeDocumentListItem[]>();
    const loadDocuments = vi
      .fn<() => Promise<KnowledgeDocumentListItem[]>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const controller = createKnowledgeDocumentPollingController({
      loadDocuments,
      onDocuments: vi.fn(),
      onError: vi.fn(),
    });

    const active = controller.refresh();
    void controller.refresh();
    void controller.refresh();
    expect(loadDocuments).toHaveBeenCalledTimes(1);

    first.resolve([]);
    await active;
    await Promise.resolve();
    expect(loadDocuments).toHaveBeenCalledTimes(2);

    second.resolve([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(loadDocuments).toHaveBeenCalledTimes(2);
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

  test('notifies once when a current extraction enters review required', async () => {
    const queued = documentItem(KnowledgeIngestionJobStatus.Completed, {
      currentJob: null,
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Queued, {
        updatedAt: '2026-07-11T02:00:00.000Z',
      }),
    });
    const reviewRequired = {
      ...queued,
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.ReviewRequired, {
        updatedAt: '2026-07-11T02:01:00.000Z',
      }),
    };
    const staleRunningSnapshot = {
      ...queued,
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Running, {
        updatedAt: '2026-07-11T02:00:30.000Z',
      }),
    };
    const loadDocuments = vi
      .fn<() => Promise<KnowledgeDocumentListItem[]>>()
      .mockResolvedValueOnce([queued])
      .mockResolvedValueOnce([reviewRequired])
      .mockResolvedValueOnce([staleRunningSnapshot])
      .mockResolvedValueOnce([reviewRequired]);
    const onReviewRequired = vi.fn();
    const controller = createKnowledgeDocumentPollingController({
      loadDocuments,
      onDocuments: vi.fn(),
      onError: vi.fn(),
      onReviewRequired,
    });

    await controller.refresh();
    await controller.refresh();
    await controller.refresh();
    await controller.refresh();

    expect(onReviewRequired).toHaveBeenCalledTimes(1);
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

describe('knowledge document extraction generation ownership', () => {
  test('clears the owned mutation slot when a document version changes without applying the result', async () => {
    const request = deferred<string>();
    let resultIsCurrent = true;
    const onCurrentSuccess = vi.fn();
    const onOwnedSettled = vi.fn();
    const task = runKnowledgeDocumentExtractionMutationTask({
      operation: () => request.promise,
      isCurrentResult: () => resultIsCurrent,
      isCurrentOperation: () => true,
      onCurrentSuccess,
      onOwnedSettled,
    });

    resultIsCurrent = false;
    request.resolve('old-version-result');

    await expect(task).resolves.toBe('old-version-result');
    expect(onCurrentSuccess).not.toHaveBeenCalled();
    expect(onOwnedSettled).toHaveBeenCalledTimes(1);
  });

  test('does not clear the mutation slot owned by a newer same-document operation', async () => {
    const request = deferred<string>();
    let operationIsCurrent = true;
    const onOwnedSettled = vi.fn();
    const task = runKnowledgeDocumentExtractionMutationTask({
      operation: () => request.promise,
      isCurrentResult: () => operationIsCurrent,
      isCurrentOperation: () => operationIsCurrent,
      onOwnedSettled,
    });

    operationIsCurrent = false;
    request.resolve('superseded-result');

    await expect(task).resolves.toBe('superseded-result');
    expect(onOwnedSettled).not.toHaveBeenCalled();
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

describe('knowledge document enrichment merge precedence', () => {
  test('preserves a newer operation summary while accepting independent list fields', () => {
    const current = documentItem(KnowledgeIngestionJobStatus.Completed, {
      currentJob: null,
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Pending, {
        documentVersionId: 'version-1',
      }),
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Cancelled, {
        revision: 3,
        updatedAt: '2026-07-11T03:00:00.000Z',
      }),
    });
    const staleListItem = documentItem(KnowledgeIngestionJobStatus.Completed, {
      currentJob: null,
      localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed, {
        documentVersionId: 'version-1',
        chunkCount: 9,
      }),
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Running, {
        revision: 2,
        updatedAt: '2026-07-11T02:00:00.000Z',
      }),
      updatedAt: '2026-07-11T04:00:00.000Z',
    });

    const merged = mergeKnowledgeDocumentListItems([current], [staleListItem]);

    expect(merged[0].localIndex?.status).toBe(KnowledgeDocumentIndexStatus.Indexed);
    expect(merged[0].localIndex?.chunkCount).toBe(9);
    expect(merged[0].enrichment).toEqual(current.enrichment);
    expect(merged[0].updatedAt).toBe(staleListItem.updatedAt);
  });

  test('chooses the demonstrably newer current-version request and never carries across versions', () => {
    const current = documentItem(KnowledgeIngestionJobStatus.Completed, {
      currentJob: null,
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Queued, {
        requestId: 'request-new',
        revision: 1,
        updatedAt: '2026-07-11T05:00:00.000Z',
      }),
    });
    const oldTerminal = documentItem(KnowledgeIngestionJobStatus.Completed, {
      currentJob: null,
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Completed, {
        requestId: 'request-old',
        revision: 9,
        updatedAt: '2026-07-11T04:00:00.000Z',
      }),
    });
    const newVersion = documentItem(KnowledgeIngestionJobStatus.Completed, {
      currentVersionId: 'version-2',
      currentJob: null,
      enrichment: null,
      hasStalePriorVersionExtraction: true,
    });

    expect(mergeKnowledgeDocumentListItems([current], [oldTerminal])[0].enrichment).toEqual(
      current.enrichment,
    );
    expect(mergeKnowledgeDocumentListItems([current], [newVersion])[0]).toEqual(newVersion);
  });

  test('accepts a higher revision and does not mutate frozen inputs', () => {
    const current = documentItem(KnowledgeIngestionJobStatus.Completed, {
      currentJob: null,
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Running, { revision: 1 }),
    });
    const incoming = documentItem(KnowledgeIngestionJobStatus.Completed, {
      currentJob: null,
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.ReviewRequired, {
        revision: 2,
      }),
    });
    const currentSnapshot = JSON.stringify(current);
    const incomingSnapshot = JSON.stringify(incoming);
    Object.freeze(current.enrichment);
    Object.freeze(incoming.enrichment);
    Object.freeze(current);
    Object.freeze(incoming);

    const currentDocuments = Object.freeze([current]);
    const incomingDocuments = Object.freeze([incoming]);
    const merged = mergeKnowledgeDocumentListItems(currentDocuments, incomingDocuments);

    expect(merged[0].enrichment).toBe(incoming.enrichment);
    expect(JSON.stringify(current)).toBe(currentSnapshot);
    expect(JSON.stringify(incoming)).toBe(incomingSnapshot);
  });

  test('advances one request through same-revision worker lifecycle updates', () => {
    const queued = documentItem(KnowledgeIngestionJobStatus.Completed, {
      currentJob: null,
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Queued, {
        revision: 1,
        updatedAt: '2026-07-11T02:00:00.000Z',
      }),
    });
    const running = {
      ...queued,
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Running, {
        revision: 1,
        updatedAt: '2026-07-11T02:01:00.000Z',
      }),
    };
    const failed = {
      ...queued,
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Failed, {
        revision: 1,
        errorCode: KnowledgeBaseErrorCode.InvalidModelResponse,
        updatedAt: '2026-07-11T02:02:00.000Z',
        completedAt: '2026-07-11T02:02:00.000Z',
      }),
    };

    const runningDocuments = mergeKnowledgeDocumentListItems([queued], [running]);
    const failedDocuments = mergeKnowledgeDocumentListItems(runningDocuments, [failed]);

    expect(runningDocuments[0].enrichment).toBe(running.enrichment);
    expect(failedDocuments[0].enrichment).toBe(failed.enrichment);
  });

  test('compares same-request revisions before timestamps and resolves different requests deterministically', () => {
    const current = documentItem(KnowledgeIngestionJobStatus.Completed, {
      currentJob: null,
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Running, {
        requestId: 'request-current',
        revision: 3,
        createdAt: '2026-07-11T01:00:00.000Z',
        updatedAt: '2026-07-11T02:00:00.000Z',
      }),
    });
    const equalRevision = {
      ...current,
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Completed, {
        requestId: 'request-current',
        revision: 3,
        createdAt: '2026-07-11T01:00:00.000Z',
        updatedAt: '2026-07-11T03:00:00.000Z',
      }),
    };
    const lowerRevision = {
      ...current,
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Completed, {
        requestId: 'request-current',
        revision: 2,
        createdAt: '2026-07-11T01:00:00.000Z',
        updatedAt: '2026-07-11T04:00:00.000Z',
      }),
    };
    const differentRequestTie = {
      ...current,
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.ReviewRequired, {
        requestId: 'request-next',
        revision: 4,
        createdAt: '2026-07-11T01:00:00.000Z',
        updatedAt: '2026-07-11T02:00:00.000Z',
      }),
    };

    expect(mergeKnowledgeDocumentListItems([current], [equalRevision])[0].enrichment).toBe(
      equalRevision.enrichment,
    );
    expect(mergeKnowledgeDocumentListItems([current], [lowerRevision])[0].enrichment).toBe(
      current.enrichment,
    );
    expect(mergeKnowledgeDocumentListItems([current], [differentRequestTie])[0].enrichment).toBe(
      differentRequestTie.enrichment,
    );
  });

  test('applies operation summaries only to the exact current document version', () => {
    const current = documentItem(KnowledgeIngestionJobStatus.Completed, { currentJob: null });
    const summary = createEnrichmentSummary(KnowledgeEnrichmentStatus.Queued);

    expect(applyKnowledgeDocumentEnrichmentSummary([current], summary)[0].enrichment).toBe(summary);
    expect(
      applyKnowledgeDocumentEnrichmentSummary(
        [current],
        { ...summary, documentId: 'other-document' },
      ),
    ).toEqual([current]);
    expect(
      applyKnowledgeDocumentEnrichmentSummary(
        [current],
        { ...summary, documentVersionId: 'old-version' },
      ),
    ).toEqual([current]);
  });

  test('commits an exact-version operation summary before one trailing refresh', async () => {
    const current = documentItem(KnowledgeIngestionJobStatus.Completed, { currentJob: null });
    const otherVersion = documentItem(KnowledgeIngestionJobStatus.Completed, {
      id: 'document-2',
      currentVersionId: 'version-2',
      currentJob: null,
    });
    const summary = Object.freeze(createEnrichmentSummary(KnowledgeEnrichmentStatus.Queued));
    const frozenDocuments = Object.freeze([Object.freeze(current), Object.freeze(otherVersion)]);
    let committed: KnowledgeDocumentListItem[] = [];
    const events: string[] = [];
    const refresh = vi.fn(async () => {
      events.push('refresh');
    });

    await applyCurrentKnowledgeDocumentExtractionResult({
      summary,
      getDocuments: () => frozenDocuments,
      commitDocuments: nextDocuments => {
        events.push('commit');
        committed = nextDocuments;
      },
      refresh,
    });

    expect(committed[0].enrichment).toBe(summary);
    expect(committed[1]).toBe(otherVersion);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['commit', 'refresh']);
  });
});

describe('knowledge document safe error normalization', () => {
  test('preserves typed errors and replaces unsafe failures with a fixed code only', () => {
    const typed = new KnowledgeBaseServiceError(KnowledgeBaseErrorCode.RevisionConflict);
    expect(toKnowledgeDocumentServiceError(typed)).toBe(typed);

    const normalized = toKnowledgeDocumentServiceError(
      new Error('unsafe /private/path SELECT * provider-route stack'),
    );
    expect(normalized).toMatchObject({ code: KnowledgeBaseErrorCode.PersistenceFailed });
    expect(JSON.stringify(normalized)).not.toMatch(/private|SELECT|provider-route|stack/i);
  });
});

describe('knowledge document paid extraction service calls', () => {
  const readyDocument = documentItem(KnowledgeIngestionJobStatus.Completed, {
    currentJob: null,
    status: KnowledgeDocumentStatus.Ready,
    localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed, {
      documentVersionId: 'version-1',
    }),
    enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Failed, {
      requestId: 'request-failed',
      revision: 4,
    }),
  });

  test('uses exact prepare, first request, retry, and cancel request objects', async () => {
    const preparation: KnowledgeExtractionAuthorizationPreparation = {
      authorizationToken: 'secret-token',
      descriptor: {
        workspaceId: 'workspace-a',
        documentId: 'document-1',
        documentVersionId: 'version-1',
        documentDisplayName: 'manual.pdf',
        providerId: 'provider-a',
        providerLabel: 'Provider A',
        modelId: 'model-a',
        modelLabel: 'Model A',
        plannedModelCalls: 2,
        partial: false,
        expiresAt: '2026-07-11T02:00:00.000Z',
      },
    };
    const prepareExtractionAuthorization = vi.fn(async () => preparation);
    const requestExtraction = vi.fn(async () =>
      createEnrichmentSummary(KnowledgeEnrichmentStatus.Queued),
    );
    const retryExtraction = vi.fn(async () =>
      createEnrichmentSummary(KnowledgeEnrichmentStatus.Queued, { requestId: 'request-new' }),
    );
    const cancelExtraction = vi.fn(async () =>
      createEnrichmentSummary(KnowledgeEnrichmentStatus.Cancelled, { revision: 5 }),
    );
    const service = {
      prepareExtractionAuthorization,
      requestExtraction,
      retryExtraction,
      cancelExtraction,
    };
    const runningDocument = {
      ...readyDocument,
      enrichment: createEnrichmentSummary(KnowledgeEnrichmentStatus.Running, {
        requestId: 'request-running',
        revision: 4,
      }),
    };

    await prepareKnowledgeDocumentExtractionAuthorization(service, readyDocument);
    await requestKnowledgeDocumentExtraction(service, 'secret-token');
    await retryKnowledgeDocumentExtraction(service, readyDocument, 'fresh-token');
    await cancelKnowledgeDocumentExtraction(service, runningDocument);

    expect(prepareExtractionAuthorization).toHaveBeenCalledWith({
      documentId: 'document-1',
      documentVersionId: 'version-1',
    });
    expect(requestExtraction).toHaveBeenCalledWith({ authorizationToken: 'secret-token' });
    expect(retryExtraction).toHaveBeenCalledWith({
      requestId: 'request-failed',
      authorizationToken: 'fresh-token',
    });
    expect(cancelExtraction).toHaveBeenCalledWith({
      requestId: 'request-running',
      expectedRevision: 4,
    });
  });

  test('discards a prepared token when workspace or document-version ownership changes', async () => {
    const authorization = deferred<KnowledgeExtractionAuthorizationPreparation>();
    const prepareExtractionAuthorization = vi.fn(() => authorization.promise);
    let isCurrent = true;
    const task = prepareCurrentKnowledgeDocumentExtractionAuthorization({
      service: { prepareExtractionAuthorization },
      document: readyDocument,
      workspaceId: 'workspace-a',
      isCurrent: () => isCurrent,
    });

    isCurrent = false;
    authorization.resolve({
      authorizationToken: 'stale-secret-token',
      descriptor: {
        workspaceId: 'workspace-a',
        documentId: readyDocument.id,
        documentVersionId: readyDocument.currentVersionId,
        documentDisplayName: readyDocument.displayName,
        providerId: 'provider-a',
        providerLabel: 'Provider A',
        modelId: 'model-a',
        modelLabel: 'Model A',
        plannedModelCalls: 1,
        partial: false,
        expiresAt: '2026-07-11T02:00:00.000Z',
      },
    });

    await expect(task).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.InvalidRequest });
  });

  test('rejects a preparation descriptor that does not match the locked intent', async () => {
    const prepareExtractionAuthorization = vi.fn(async () => ({
      authorizationToken: 'mismatched-secret-token',
      descriptor: {
        workspaceId: 'workspace-b',
        documentId: readyDocument.id,
        documentVersionId: readyDocument.currentVersionId,
        documentDisplayName: readyDocument.displayName,
        providerId: 'provider-a',
        providerLabel: 'Provider A',
        modelId: 'model-a',
        modelLabel: 'Model A',
        plannedModelCalls: 1,
        partial: false,
        expiresAt: '2026-07-11T02:00:00.000Z',
      },
    }));

    await expect(
      prepareCurrentKnowledgeDocumentExtractionAuthorization({
        service: { prepareExtractionAuthorization },
        document: readyDocument,
        workspaceId: 'workspace-a',
        isCurrent: () => true,
      }),
    ).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.InvalidRequest });
  });

  test('rejects retry or cancel driven by a missing/stale current enrichment', async () => {
    const service = {
      retryExtraction: vi.fn(),
      cancelExtraction: vi.fn(),
    };
    const withoutEnrichment = { ...readyDocument, enrichment: null };
    const staleVersion = {
      ...readyDocument,
      enrichment: { ...readyDocument.enrichment!, documentVersionId: 'old-version' },
    };

    await expect(
      retryKnowledgeDocumentExtraction(service, withoutEnrichment, 'token'),
    ).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.InvalidRequest });
    await expect(cancelKnowledgeDocumentExtraction(service, staleVersion)).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.InvalidRequest,
    });
    expect(service.retryExtraction).not.toHaveBeenCalled();
    expect(service.cancelExtraction).not.toHaveBeenCalled();
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
