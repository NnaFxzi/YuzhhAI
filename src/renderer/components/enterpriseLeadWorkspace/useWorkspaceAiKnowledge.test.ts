import { afterEach, describe, expect, test, vi } from 'vitest';

import type { EnterpriseLeadWorkspaceProfile } from '../../../shared/enterpriseLeadWorkspace/types';
import {
  KNOWLEDGE_FACT_EVIDENCE_PAGE_DEFAULT_LIMIT,
  KnowledgeBaseErrorCode,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeDocumentVisibility,
  KnowledgeEnrichmentStatus,
  KnowledgeFactArchiveProjectionDecision,
  KnowledgeFactDomain,
  KnowledgeFactEvidenceState,
  KnowledgeFactListView,
  KnowledgeFactProjectionConflictKind,
  KnowledgeFactProjectionOperation,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewDecision,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeDocumentListItem,
  KnowledgeEnrichmentSummary,
  KnowledgeFactEvidencePageResult,
  KnowledgeFactEvidenceSummary,
  KnowledgeFactListResult,
  KnowledgeFactMetrics,
  KnowledgeFactProjectionConflict,
  KnowledgeFactReviewResult,
  KnowledgeFactSummary,
  KnowledgeListFactsRequest,
} from '../../../shared/knowledgeBase/types';
import { KnowledgeBaseServiceError } from '../../services/knowledgeBase';
import {
  buildWorkspaceAiKnowledgeListRequest,
  createDeferredWorkspaceAiKnowledgeControllerLease,
  createWorkspaceAiKnowledgeController,
  createWorkspaceAiKnowledgeDocumentPollingController,
  createWorkspaceReviewRequiredTransitionCollector,
  deduplicateWorkspaceKnowledgeDocuments,
  selectWorkspaceAiKnowledgeDisplaySnapshot,
  useWorkspaceAiKnowledge,
} from './useWorkspaceAiKnowledge';

type WorkspaceAiKnowledgeRefreshPromise = ReturnType<
  ReturnType<typeof createWorkspaceAiKnowledgeController>['refreshAfterMutation']
>;

const profile = (
  overrides: Partial<EnterpriseLeadWorkspaceProfile> = {},
): EnterpriseLeadWorkspaceProfile => ({
  companySummary: '',
  productList: [],
  productCapabilities: [],
  targetCustomers: [],
  applicationScenarios: [],
  sellingPoints: [],
  channelPreferences: [],
  prohibitedClaims: [],
  contactRules: [],
  missingInfo: [],
  ...overrides,
});

const metrics = (seed = 0): KnowledgeFactMetrics => ({
  activePendingCount: seed + 1,
  activeConfirmedCount: seed + 2,
  staleConfirmedCount: seed + 3,
  rejectedHistoryCount: seed + 4,
  archivedHistoryCount: seed + 5,
  unduplicatedLegacyConfirmedCount: seed + 6,
  totalAiKnowledgeCount: seed + 7,
});

const fact = (id: string, revision = 1): KnowledgeFactSummary => ({
  id,
  domain: KnowledgeFactDomain.ProductList,
  value: `${id}-value`,
  reviewStatus: KnowledgeFactReviewStatus.Pending,
  sourceKind: KnowledgeFactSourceKind.Extracted,
  revision,
  projectionState: KnowledgeFactProjectionState.None,
  activeEvidenceCount: 1,
  staleEvidenceCount: 0,
  evidencePreview: null,
  createdAt: '2026-07-13T00:00:00.000Z',
  reviewedAt: null,
  updatedAt: '2026-07-13T00:00:00.000Z',
  archivedAt: null,
});

const enrichment = (
  status: KnowledgeEnrichmentStatus,
  overrides: Partial<KnowledgeEnrichmentSummary> = {},
): KnowledgeEnrichmentSummary => ({
  requestId: 'request-a',
  documentId: 'document-a',
  documentVersionId: 'version-a',
  status,
  progress: 0.5,
  revision: 1,
  attemptCount: 1,
  validCandidateCount: 1,
  discardedCandidateCount: 0,
  pendingFactCount: 1,
  partialReasons: [],
  errorCode: null,
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:01:00.000Z',
  completedAt: null,
  ...overrides,
});

const documentItem = (
  overrides: Partial<KnowledgeDocumentListItem> = {},
): KnowledgeDocumentListItem => ({
  id: 'document-a',
  displayName: 'document-a.pdf',
  sourceMode: KnowledgeDocumentSourceMode.Managed,
  currentVersionId: 'version-a',
  revision: 1,
  status: KnowledgeDocumentStatus.Ready,
  fileSize: 100,
  mimeType: 'application/pdf',
  contentHash: 'safe-hash',
  currentJob: null,
  localIndex: null,
  enrichment: null,
  hasStalePriorVersionExtraction: false,
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:01:00.000Z',
  deletedAt: null,
  ...overrides,
});

const result = (
  items: KnowledgeFactSummary[] = [],
  nextCursor: string | null = null,
  nextMetrics = metrics(),
): KnowledgeFactListResult => ({ items, nextCursor, metrics: nextMetrics });

const reviewResult = (
  nextFact: KnowledgeFactSummary,
  overrides: Partial<KnowledgeFactReviewResult> = {},
): KnowledgeFactReviewResult => ({
  fact: nextFact,
  profileChanged: false,
  profileRevision: null,
  fieldRevision: null,
  ...overrides,
});

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const deepFreeze = <Value>(value: Value): Value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
};

afterEach(() => {
  vi.useRealTimers();
});

describe('workspace AI knowledge request construction', () => {
  test('builds an exact immutable request from canonical backend filters', () => {
    const reviewStatuses = Object.freeze([
      KnowledgeFactReviewStatus.Confirmed,
      KnowledgeFactReviewStatus.Pending,
      KnowledgeFactReviewStatus.Confirmed,
      KnowledgeFactReviewStatus.Rejected,
    ]);
    const filters = Object.freeze({
      view: KnowledgeFactListView.History,
      reviewStatuses,
      evidenceState: KnowledgeFactEvidenceState.Stale,
    });

    const request = buildWorkspaceAiKnowledgeListRequest(
      'workspace-a',
      filters,
      'cursor-2',
    );

    expect(request).toEqual({
      workspaceId: 'workspace-a',
      view: KnowledgeFactListView.History,
      reviewStatuses: [
        KnowledgeFactReviewStatus.Pending,
        KnowledgeFactReviewStatus.Confirmed,
        KnowledgeFactReviewStatus.Rejected,
      ],
      evidenceState: KnowledgeFactEvidenceState.Stale,
      limit: 50,
      cursor: 'cursor-2',
    });
    expect(Object.keys(request)).toEqual([
      'workspaceId',
      'view',
      'reviewStatuses',
      'evidenceState',
      'limit',
      'cursor',
    ]);
    expect(request.reviewStatuses).not.toBe(reviewStatuses);
    expect(request).not.toHaveProperty('search');
    expect(request).not.toHaveProperty('query');
    expect(filters.reviewStatuses).toEqual(reviewStatuses);
  });

  test('uses the exact default Active/Any request without a cursor', () => {
    const request = buildWorkspaceAiKnowledgeListRequest('workspace-a', {});

    expect(request).toEqual({
      workspaceId: 'workspace-a',
      view: KnowledgeFactListView.Active,
      reviewStatuses: [],
      evidenceState: KnowledgeFactEvidenceState.Any,
      limit: 50,
    });
  });
});

describe('workspace AI knowledge controller', () => {
  test('exports the public React hook and survives a StrictMode-style deferred release replay', () => {
    const scheduled: Array<() => void> = [];
    const dispose = vi.fn();
    const lease = createDeferredWorkspaceAiKnowledgeControllerLease({
      dispose,
      schedule: callback => {
        scheduled.push(callback);
      },
    });

    const firstRelease = lease.acquire();
    firstRelease();
    expect(scheduled).toHaveLength(1);

    const replayRelease = lease.acquire();
    scheduled.shift()?.();
    expect(dispose).not.toHaveBeenCalled();
    expect(useWorkspaceAiKnowledge).toBeTypeOf('function');

    replayRelease();
    replayRelease();
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test('publishes fact request ownership before invoking the service', async () => {
    const listFacts = vi.fn(async () => result([fact('fact-a')], null, metrics(1)));
    const controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });

    const started = controller.start();

    expect(listFacts).not.toHaveBeenCalled();
    await started;
    expect(listFacts).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  test('installs the fact-flight owner before the initial Started publish can synchronously refresh', async () => {
    let controller!: ReturnType<typeof createWorkspaceAiKnowledgeController>;
    let publishCount = 0;
    let refresh: WorkspaceAiKnowledgeRefreshPromise | null = null;
    let refreshSettled = false;
    const firstPage = deferred<KnowledgeFactListResult>();
    const secondPage = deferred<KnowledgeFactListResult>();
    const listFacts = vi
      .fn()
      .mockImplementationOnce(() => firstPage.promise)
      .mockImplementationOnce(() => secondPage.promise);
    controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });
    const unsubscribe = controller.subscribe(() => {
      publishCount += 1;
      if (publishCount === 1) {
        refresh = controller.refreshAfterMutation();
      }
    });

    const start = controller.start();
    const pendingRefresh = refresh!;
    void pendingRefresh.then(() => {
      refreshSettled = true;
    });
    await flushMicrotasks();

    expect(listFacts).toHaveBeenCalledTimes(1);
    expect(refreshSettled).toBe(false);

    firstPage.resolve(result([fact('page-1')], null, metrics(1)));
    await flushMicrotasks();

    expect(listFacts).toHaveBeenCalledTimes(2);
    expect(refreshSettled).toBe(false);

    secondPage.resolve(result([fact('page-2')], null, metrics(2)));
    await Promise.all([start, pendingRefresh]);

    expect(listFacts).toHaveBeenCalledTimes(2);
    expect(listFacts.mock.calls[0][0]).not.toHaveProperty('cursor');
    expect(listFacts.mock.calls[1][0]).not.toHaveProperty('cursor');
    expect(refreshSettled).toBe(true);
    expect(controller.getSnapshot().facts.map(item => item.id)).toEqual(['page-2']);
    unsubscribe();
    controller.dispose();
  });

  test('installs the fact-flight owner before the Append Started publish can synchronously refresh', async () => {
    let controller!: ReturnType<typeof createWorkspaceAiKnowledgeController>;
    let publishCount = 0;
    let refresh: WorkspaceAiKnowledgeRefreshPromise | null = null;
    let refreshSettled = false;
    const appendPage = deferred<KnowledgeFactListResult>();
    const trailingPage = deferred<KnowledgeFactListResult>();
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(result([fact('page-1')], 'cursor-2', metrics(1)))
      .mockImplementationOnce(() => appendPage.promise)
      .mockImplementationOnce(() => trailingPage.promise);
    controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });
    await controller.start();
    const unsubscribe = controller.subscribe(() => {
      publishCount += 1;
      if (publishCount === 1) {
        refresh = controller.refreshAfterMutation();
      }
    });

    const loadMore = controller.loadMore();
    const pendingRefresh = refresh!;
    void pendingRefresh.then(() => {
      refreshSettled = true;
    });
    await flushMicrotasks();

    expect(listFacts).toHaveBeenCalledTimes(2);
    expect(refreshSettled).toBe(false);

    appendPage.resolve(result([fact('page-2')], null, metrics(2)));
    await flushMicrotasks();

    expect(listFacts).toHaveBeenCalledTimes(3);
    expect(refreshSettled).toBe(false);

    trailingPage.resolve(result([fact('page-3')], null, metrics(3)));
    await Promise.all([loadMore, pendingRefresh]);

    expect(listFacts).toHaveBeenCalledTimes(3);
    expect(listFacts.mock.calls[1][0]).toMatchObject({ cursor: 'cursor-2' });
    expect(listFacts.mock.calls[2][0]).not.toHaveProperty('cursor');
    expect(refreshSettled).toBe(true);
    expect(controller.getSnapshot().facts.map(item => item.id)).toEqual(['page-3']);
    unsubscribe();
    controller.dispose();
  });

  test('installs the fact-flight owner before the Trailing Started publish can synchronously refresh', async () => {
    let controller!: ReturnType<typeof createWorkspaceAiKnowledgeController>;
    let requestedFromStartedPublish = false;
    let nestedRefresh: WorkspaceAiKnowledgeRefreshPromise | null = null;
    let nestedRefreshSettled = false;
    const firstRefreshPage = deferred<KnowledgeFactListResult>();
    const trailingRefreshPage = deferred<KnowledgeFactListResult>();
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(result([fact('page-1')], null, metrics(1)))
      .mockImplementationOnce(() => firstRefreshPage.promise)
      .mockImplementationOnce(() => trailingRefreshPage.promise);
    controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });
    await controller.start();
    const unsubscribe = controller.subscribe(() => {
      if (!requestedFromStartedPublish && controller.getSnapshot().isInitialLoading) {
        requestedFromStartedPublish = true;
        nestedRefresh = controller.refreshAfterMutation();
      }
    });

    const refresh = controller.refreshAfterMutation();
    const pendingNestedRefresh = nestedRefresh!;
    void pendingNestedRefresh.then(() => {
      nestedRefreshSettled = true;
    });
    await flushMicrotasks();

    expect(requestedFromStartedPublish).toBe(true);
    expect(listFacts).toHaveBeenCalledTimes(2);
    expect(nestedRefreshSettled).toBe(false);

    firstRefreshPage.resolve(result([fact('page-2')], null, metrics(2)));
    await flushMicrotasks();

    expect(listFacts).toHaveBeenCalledTimes(3);
    expect(nestedRefreshSettled).toBe(false);

    trailingRefreshPage.resolve(result([fact('page-3')], null, metrics(3)));
    await Promise.all([refresh, pendingNestedRefresh]);

    expect(listFacts).toHaveBeenCalledTimes(3);
    expect(listFacts.mock.calls[1][0]).not.toHaveProperty('cursor');
    expect(listFacts.mock.calls[2][0]).not.toHaveProperty('cursor');
    expect(nestedRefreshSettled).toBe(true);
    expect(controller.getSnapshot().facts.map(item => item.id)).toEqual(['page-3']);
    unsubscribe();
    controller.dispose();
  });

  test('installs the fact-flight owner before the error-clear publish can switch workspace', async () => {
    let controller!: ReturnType<typeof createWorkspaceAiKnowledgeController>;
    let publishCount = 0;
    let contextChange: Promise<void> | null = null;
    const listFacts = vi.fn(async (request: KnowledgeListFactsRequest) =>
      result([fact(request.workspaceId)], null, metrics(1)),
    );
    controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });
    const unsubscribe = controller.subscribe(() => {
      publishCount += 1;
      if (publishCount === 2) {
        contextChange = controller.updateContext({
          workspaceId: 'workspace-b',
          profileRevision: 2,
          profile: profile(),
        });
      }
    });

    await controller.start();
    await contextChange;

    expect(listFacts.mock.calls.map(([request]) => request.workspaceId)).toEqual([
      'workspace-b',
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      workspaceId: 'workspace-b',
      profileRevision: 2,
      isInitialLoading: false,
    });
    expect(controller.getSnapshot().facts.map(item => item.id)).toEqual(['workspace-b']);
    unsubscribe();
    controller.dispose();
  });

  test('keeps one owner when the error-clear publish synchronously requests refresh', async () => {
    let controller!: ReturnType<typeof createWorkspaceAiKnowledgeController>;
    let publishCount = 0;
    let refresh: WorkspaceAiKnowledgeRefreshPromise | null = null;
    let refreshSettled = false;
    const firstPage = deferred<KnowledgeFactListResult>();
    const secondPage = deferred<KnowledgeFactListResult>();
    const listFacts = vi
      .fn()
      .mockImplementationOnce(() => firstPage.promise)
      .mockImplementationOnce(() => secondPage.promise);
    controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });
    const unsubscribe = controller.subscribe(() => {
      publishCount += 1;
      if (publishCount === 2) {
        refresh = controller.refreshAfterMutation();
      }
    });

    const start = controller.start();
    const pendingRefresh = refresh!;
    void pendingRefresh.then(() => {
      refreshSettled = true;
    });
    await flushMicrotasks();

    expect(listFacts).toHaveBeenCalledTimes(1);
    expect(refreshSettled).toBe(false);

    firstPage.resolve(result([fact('page-1')], null, metrics(1)));
    await flushMicrotasks();

    expect(listFacts).toHaveBeenCalledTimes(2);
    expect(refreshSettled).toBe(false);

    secondPage.resolve(result([fact('page-2')], null, metrics(2)));
    await Promise.all([start, pendingRefresh]);

    expect(listFacts).toHaveBeenCalledTimes(2);
    expect(refreshSettled).toBe(true);
    expect(controller.getSnapshot().facts.map(item => item.id)).toEqual(['page-2']);
    expect(controller.getSnapshot().isInitialLoading).toBe(false);
    unsubscribe();
    controller.dispose();
  });

  test('keeps one owner when the error-clear publish synchronously changes filters', async () => {
    let controller!: ReturnType<typeof createWorkspaceAiKnowledgeController>;
    let publishCount = 0;
    let filterChange: Promise<void> | null = null;
    const listFacts = vi.fn(async (request: KnowledgeListFactsRequest) =>
      result([fact(request.view ?? 'missing-view')], null, metrics(1)),
    );
    controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });
    const unsubscribe = controller.subscribe(() => {
      publishCount += 1;
      if (publishCount === 2) {
        filterChange = controller.setView(KnowledgeFactListView.History);
      }
    });

    await controller.start();
    await filterChange;

    expect(listFacts.mock.calls.map(([request]) => request.view)).toEqual([
      KnowledgeFactListView.History,
    ]);
    expect(controller.getSnapshot().facts.map(item => item.id)).toEqual([
      KnowledgeFactListView.History,
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      filters: { view: KnowledgeFactListView.History },
      isInitialLoading: false,
    });
    unsubscribe();
    controller.dispose();
  });

  test('serializes a synchronous fact-service context re-entry and rejects the old page', async () => {
    let controller!: ReturnType<typeof createWorkspaceAiKnowledgeController>;
    let contextChange: Promise<void> | null = null;
    let activeCalls = 0;
    let maximumActiveCalls = 0;
    let invocation = 0;
    const acceptedMetrics: KnowledgeFactMetrics[] = [];
    const currentMetrics = metrics(2);
    const listFacts = vi.fn((request: KnowledgeListFactsRequest) => {
      invocation += 1;
      activeCalls += 1;
      maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
      if (invocation === 1) {
        contextChange = controller.updateContext({
          workspaceId: 'workspace-b',
          profileRevision: 2,
          profile: profile(),
        });
      }
      return Promise.resolve().then(() => {
        activeCalls -= 1;
        return result(
          [fact(request.workspaceId)],
          null,
          request.workspaceId === 'workspace-b' ? currentMetrics : metrics(1),
        );
      });
    });
    controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });
    controller.subscribeAcceptedMetrics(value => acceptedMetrics.push(value));

    await controller.start();
    await contextChange;

    expect(maximumActiveCalls).toBe(1);
    expect(listFacts.mock.calls.map(([request]) => request.workspaceId)).toEqual([
      'workspace-a',
      'workspace-b',
    ]);
    expect(controller.getSnapshot().facts.map(item => item.id)).toEqual(['workspace-b']);
    expect(acceptedMetrics).toEqual([currentMetrics]);
    controller.dispose();
  });

  test('settles a synchronous fact-service throw and accepts a safe retry', async () => {
    const recoveredMetrics = metrics(3);
    const listFacts = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('private sync diagnostic');
      })
      .mockResolvedValueOnce(result([fact('recovered')], null, recoveredMetrics));
    const controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });

    await controller.start();
    expect(listFacts).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().errorCode).toBe(
      KnowledgeBaseErrorCode.PersistenceFailed,
    );

    await controller.retryInitial();

    expect(listFacts).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().facts.map(item => item.id)).toEqual(['recovered']);
    expect(controller.getSnapshot().metrics).toBe(recoveredMetrics);
    expect(controller.getSnapshot().errorCode).toBeNull();
    controller.dispose();
  });

  test('starts one Replace request and keeps refresh failures partial after accepted data', async () => {
    const acceptedMetrics = metrics(10);
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(result([fact('fact-a')], null, acceptedMetrics))
      .mockRejectedValueOnce(new Error('secret route /v1/private'))
      .mockRejectedValueOnce(
        new KnowledgeBaseServiceError(KnowledgeBaseErrorCode.BackendNotReady),
      );
    const controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile({ productList: ['Legacy product'] }),
      service: {
        listFacts,
        listDocuments: vi.fn(async () => []),
      },
    });

    await controller.start();

    expect(listFacts).toHaveBeenNthCalledWith(1, {
      workspaceId: 'workspace-a',
      view: KnowledgeFactListView.Active,
      reviewStatuses: [],
      evidenceState: KnowledgeFactEvidenceState.Any,
      limit: 50,
    });
    expect(controller.getSnapshot().facts.map(item => item.id)).toEqual(['fact-a']);
    expect(controller.getSnapshot().metrics).toBe(acceptedMetrics);
    expect(controller.getSnapshot().rows.map(row => row.kind)).toEqual([
      'normalized_fact',
      'legacy_profile',
    ]);

    await controller.refreshAfterMutation();
    expect(controller.getSnapshot().errorCode).toBeNull();
    expect(controller.getSnapshot().partialErrorCode).toBe(
      KnowledgeBaseErrorCode.PersistenceFailed,
    );
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('/v1/private');

    await controller.refreshAfterMutation();
    expect(controller.getSnapshot().errorCode).toBeNull();
    expect(controller.getSnapshot().partialErrorCode).toBe(
      KnowledgeBaseErrorCode.BackendNotReady,
    );
    controller.dispose();
  });

  test('keeps a legacy-only table visible when a Replace refresh fails', async () => {
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(result([], null, metrics(0)))
      .mockRejectedValueOnce(new Error('refresh failed'));
    const controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile({ productList: ['Legacy-only product'] }),
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });

    await controller.start();
    expect(controller.getSnapshot().facts).toEqual([]);
    expect(controller.getSnapshot().rows).toHaveLength(1);
    expect(controller.getSnapshot().rows[0]).toMatchObject({
      kind: 'legacy_profile',
      item: { value: 'Legacy-only product' },
    });

    await controller.refreshAfterMutation();

    expect(controller.getSnapshot().errorCode).toBeNull();
    expect(controller.getSnapshot().partialErrorCode).toBe(
      KnowledgeBaseErrorCode.PersistenceFailed,
    );
    expect(controller.getSnapshot().rows).toHaveLength(1);
    expect(controller.getSnapshot().rows[0]).toMatchObject({
      kind: 'legacy_profile',
      item: { value: 'Legacy-only product' },
    });
    controller.dispose();
  });

  test('normalizes an initial Replace failure to a fatal safe error code', async () => {
    const controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: {
        listFacts: vi.fn(async () => {
          throw new Error('secret stack and SQL');
        }),
        listDocuments: vi.fn(async () => []),
      },
    });

    await controller.start();

    expect(controller.getSnapshot().facts).toEqual([]);
    expect(controller.getSnapshot().errorCode).toBe(KnowledgeBaseErrorCode.PersistenceFailed);
    expect(controller.getSnapshot().partialErrorCode).toBeNull();
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('secret');
    controller.dispose();
  });

  test('retries an existing-data Replace refresh through the partial retry entry point', async () => {
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(result([fact('before-refresh')], null, metrics(1)))
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockResolvedValueOnce(result([fact('after-retry')], null, metrics(2)));
    const controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });

    await controller.start();
    await controller.refreshAfterMutation();
    expect(controller.getSnapshot().partialErrorCode).toBe(
      KnowledgeBaseErrorCode.PersistenceFailed,
    );

    await controller.retryPartial();

    expect(listFacts).toHaveBeenCalledTimes(3);
    expect(listFacts.mock.calls[2][0]).not.toHaveProperty('cursor');
    expect(controller.getSnapshot().facts.map(item => item.id)).toEqual(['after-retry']);
    expect(controller.getSnapshot().partialErrorCode).toBeNull();
    controller.dispose();
  });

  test('emits every accepted backend metrics object exactly once without subscription replay', async () => {
    const firstMetrics = metrics(1);
    const secondMetrics = metrics(2);
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(result([fact('first')], null, firstMetrics))
      .mockResolvedValueOnce(result([fact('second')], null, secondMetrics));
    const controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const unsubscribeFirst = controller.subscribeAcceptedMetrics(firstListener);

    expect(firstListener).not.toHaveBeenCalled();
    await controller.start();
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(firstListener.mock.calls[0][0]).toBe(firstMetrics);

    unsubscribeFirst();
    const unsubscribeSecond = controller.subscribeAcceptedMetrics(secondListener);
    expect(secondListener).not.toHaveBeenCalled();
    await controller.refreshAfterMutation();

    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(secondListener.mock.calls[0][0]).toBe(secondMetrics);
    unsubscribeSecond();
    controller.dispose();
  });

  test('snapshots accepted-metrics listeners before delivering each page', async () => {
    const firstMetrics = metrics(11);
    const secondMetrics = metrics(12);
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(result([fact('first')], null, firstMetrics))
      .mockResolvedValueOnce(result([fact('second')], null, secondMetrics));
    const controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });
    const secondListener = vi.fn();
    let unsubscribeFirst = (): void => undefined;
    const firstListener = vi.fn((value: KnowledgeFactMetrics) => {
      expect(value).toBe(firstMetrics);
      unsubscribeFirst();
      controller.subscribeAcceptedMetrics(secondListener);
    });
    unsubscribeFirst = controller.subscribeAcceptedMetrics(firstListener);

    await controller.start();

    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(firstListener.mock.calls[0][0]).toBe(firstMetrics);
    expect(secondListener).not.toHaveBeenCalled();

    await controller.refreshAfterMutation();

    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(secondListener.mock.calls[0][0]).toBe(secondMetrics);
    controller.dispose();
  });

  test('locks the cursor, appends through the reducer, and replaces backend metrics by identity', async () => {
    const firstMetrics = metrics(10);
    const secondMetrics = metrics(20);
    const secondPage = deepFreeze(
      result(
        [
          fact('fact-a', 1),
          fact('fact-b', 3),
          { ...fact('fact-b', 3), value: 'equal revision must not replace' },
          fact('fact-c', 1),
          fact('fact-c', 2),
        ],
        null,
        secondMetrics,
      ),
    );
    const secondPageSnapshot = JSON.stringify(secondPage);
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(
        result([fact('fact-a', 2), fact('fact-b', 1)], 'cursor-2', firstMetrics),
      )
      .mockResolvedValueOnce(secondPage);
    const controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });
    const acceptedMetrics = vi.fn();
    controller.subscribeAcceptedMetrics(acceptedMetrics);

    await controller.start();
    await controller.loadMore();

    expect(listFacts).toHaveBeenNthCalledWith(2, {
      workspaceId: 'workspace-a',
      view: KnowledgeFactListView.Active,
      reviewStatuses: [],
      evidenceState: KnowledgeFactEvidenceState.Any,
      limit: 50,
      cursor: 'cursor-2',
    });
    expect(controller.getSnapshot().facts.map(item => [item.id, item.revision])).toEqual([
      ['fact-a', 2],
      ['fact-b', 3],
      ['fact-c', 2],
    ]);
    expect(controller.getSnapshot().facts.find(item => item.id === 'fact-b')?.value).toBe(
      'fact-b-value',
    );
    expect(controller.getSnapshot().metrics).toBe(secondMetrics);
    expect(controller.getSnapshot().metricsAcceptanceGeneration).toBe(2);
    expect(acceptedMetrics).toHaveBeenCalledTimes(2);
    expect(acceptedMetrics.mock.calls[0][0]).toBe(firstMetrics);
    expect(acceptedMetrics.mock.calls[1][0]).toBe(secondMetrics);
    expect(controller.getSnapshot().hasMore).toBe(false);
    expect(JSON.stringify(secondPage)).toBe(secondPageSnapshot);

    await controller.loadMore();
    expect(listFacts).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  test('atomically coalesces duplicate load-more calls and retries the locked cursor after a partial failure', async () => {
    const append = deferred<KnowledgeFactListResult>();
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(result([fact('fact-a')], 'cursor-2', metrics(1)))
      .mockImplementationOnce(() => append.promise)
      .mockResolvedValueOnce(result([fact('fact-b')], null, metrics(2)));
    const controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });
    await controller.start();

    const firstLoadMore = controller.loadMore();
    const duplicateLoadMore = controller.loadMore();
    await flushMicrotasks();
    expect(listFacts).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().isLoadingMore).toBe(true);

    append.reject(new Error('private append diagnostic'));
    await Promise.all([firstLoadMore, duplicateLoadMore]);

    expect(controller.getSnapshot().facts.map(item => item.id)).toEqual(['fact-a']);
    expect(controller.getSnapshot().nextCursor).toBe('cursor-2');
    expect(controller.getSnapshot().errorCode).toBeNull();
    expect(controller.getSnapshot().partialErrorCode).toBe(
      KnowledgeBaseErrorCode.PersistenceFailed,
    );

    await controller.retryPartial();
    expect(listFacts).toHaveBeenNthCalledWith(3, {
      workspaceId: 'workspace-a',
      view: KnowledgeFactListView.Active,
      reviewStatuses: [],
      evidenceState: KnowledgeFactEvidenceState.Any,
      limit: 50,
      cursor: 'cursor-2',
    });
    expect(controller.getSnapshot().facts.map(item => item.id)).toEqual(['fact-a', 'fact-b']);
    expect(controller.getSnapshot().partialErrorCode).toBeNull();
    controller.dispose();
  });

  test('changes generation only for semantic workspace/profile/filter context and accepts only the latest request', async () => {
    const oldRequest = deferred<KnowledgeFactListResult>();
    const currentRequest = deferred<KnowledgeFactListResult>();
    const listFacts = vi
      .fn()
      .mockImplementationOnce(() => oldRequest.promise)
      .mockImplementationOnce(() => currentRequest.promise);
    const initialProfile = profile({ productList: ['Initial legacy'] });
    const controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: initialProfile,
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });
    const acceptedMetrics = vi.fn();
    controller.subscribeAcceptedMetrics(acceptedMetrics);

    const startPromise = controller.start();
    const duplicateStart = controller.start();
    const sameContext = controller.updateContext({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile({ productList: ['Updated legacy with same revision'] }),
    });
    await flushMicrotasks();

    expect(controller.getSnapshot().contextGeneration).toBe(1);
    expect(listFacts).toHaveBeenCalledTimes(1);

    const changedContext = controller.updateContext({
      workspaceId: 'workspace-b',
      profileRevision: 2,
      profile: profile({ productList: ['Current legacy'] }),
    });
    expect(controller.getSnapshot().contextGeneration).toBe(2);
    expect(controller.getSnapshot().facts).toEqual([]);
    expect(listFacts).toHaveBeenCalledTimes(1);

    oldRequest.resolve(result([fact('stale-workspace')], null, metrics(40)));
    await flushMicrotasks();
    expect(listFacts).toHaveBeenCalledTimes(2);
    expect(listFacts).toHaveBeenNthCalledWith(2, {
      workspaceId: 'workspace-b',
      view: KnowledgeFactListView.Active,
      reviewStatuses: [],
      evidenceState: KnowledgeFactEvidenceState.Any,
      limit: 50,
    });
    expect(controller.getSnapshot().facts).toEqual([]);
    expect(controller.getSnapshot().metricsAcceptanceGeneration).toBe(0);
    expect(acceptedMetrics).not.toHaveBeenCalled();

    const currentMetrics = metrics(50);
    currentRequest.resolve(result([fact('current-workspace')], null, currentMetrics));
    await Promise.all([startPromise, duplicateStart, sameContext, changedContext]);

    expect(controller.getSnapshot().facts.map(item => item.id)).toEqual(['current-workspace']);
    expect(controller.getSnapshot().metrics).toBe(currentMetrics);
    expect(controller.getSnapshot().metricsAcceptanceGeneration).toBe(1);
    expect(acceptedMetrics).toHaveBeenCalledTimes(1);
    expect(acceptedMetrics.mock.calls[0][0]).toBe(currentMetrics);
    controller.dispose();
  });

  test('uses a context updated before start for both fact and document requests', async () => {
    const listFacts = vi.fn(async (_request: KnowledgeListFactsRequest) =>
      result([], null, metrics(1)),
    );
    const listDocuments = vi.fn(async () => []);
    const controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments },
    });

    await controller.updateContext({
      workspaceId: 'workspace-b',
      profileRevision: 2,
      profile: profile(),
    });
    await controller.start();

    expect(listFacts.mock.calls[0][0].workspaceId).toBe('workspace-b');
    expect(listDocuments).toHaveBeenCalledWith(
      'workspace-b',
      KnowledgeDocumentVisibility.Active,
    );
    expect(listDocuments).toHaveBeenCalledWith(
      'workspace-b',
      KnowledgeDocumentVisibility.Deleted,
    );
    controller.dispose();
  });

  test('never pairs a new workspace/profile render with old facts, metrics, or legacy rows', async () => {
    const oldMetrics = metrics(30);
    const controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile({ productList: ['Old legacy'] }),
      service: {
        listFacts: vi.fn(async () => result([fact('old-fact')], null, oldMetrics)),
        listDocuments: vi.fn(async () => []),
      },
    });
    await controller.start();
    const oldSnapshot = controller.getSnapshot();
    const newProfile = profile({ productList: ['New legacy'] });

    expect(
      selectWorkspaceAiKnowledgeDisplaySnapshot(oldSnapshot, {
        workspaceId: 'workspace-a',
        profileRevision: 1,
        profile: profile({ productList: ['ignored matching input'] }),
      }),
    ).toBe(oldSnapshot);

    const guarded = selectWorkspaceAiKnowledgeDisplaySnapshot(oldSnapshot, {
      workspaceId: 'workspace-b',
      profileRevision: 2,
      profile: newProfile,
    });

    expect(guarded.workspaceId).toBe('workspace-b');
    expect(guarded.profileRevision).toBe(2);
    expect(guarded.facts).toEqual([]);
    expect(guarded.rows.map(row => row.kind)).toEqual(['legacy_profile']);
    expect(guarded.rows[0]).toMatchObject({
      kind: 'legacy_profile',
      item: { value: 'New legacy' },
    });
    expect(guarded.metrics).toEqual({
      activePendingCount: 0,
      activeConfirmedCount: 0,
      staleConfirmedCount: 0,
      rejectedHistoryCount: 0,
      archivedHistoryCount: 0,
      unduplicatedLegacyConfirmedCount: 0,
      totalAiKnowledgeCount: 0,
    });
    expect(guarded.isInitialLoading).toBe(true);
    expect(guarded.nextCursor).toBeNull();
    expect(guarded.errorCode).toBeNull();
    expect(JSON.stringify(guarded)).not.toContain('old-fact');
    expect(JSON.stringify(guarded)).not.toContain('Old legacy');
    expect(oldSnapshot.metrics).toBe(oldMetrics);
    controller.dispose();
  });

  test('invalidates an active Append on filter change and canonicalizes all backend filters', async () => {
    const staleAppend = deferred<KnowledgeFactListResult>();
    const currentReplace = deferred<KnowledgeFactListResult>();
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(result([fact('fact-a')], 'cursor-2', metrics(1)))
      .mockImplementationOnce(() => staleAppend.promise)
      .mockImplementationOnce(() => currentReplace.promise)
      .mockResolvedValueOnce(result([fact('confirmed')], null, metrics(3)))
      .mockResolvedValueOnce(result([fact('stale-evidence')], null, metrics(4)))
      .mockResolvedValueOnce(result([fact('new-profile')], null, metrics(5)));
    const controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });
    await controller.start();

    const appendPromise = controller.loadMore();
    await flushMicrotasks();
    const historyPromise = controller.setView(KnowledgeFactListView.History);
    expect(controller.getSnapshot().facts).toEqual([]);
    expect(controller.getSnapshot().contextGeneration).toBe(2);
    expect(listFacts).toHaveBeenCalledTimes(2);

    staleAppend.resolve(result([fact('stale-append')], null, metrics(20)));
    await flushMicrotasks();
    expect(listFacts).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot().facts).toEqual([]);
    currentReplace.resolve(result([fact('history')], null, metrics(2)));
    await Promise.all([appendPromise, historyPromise]);
    expect(controller.getSnapshot().facts.map(item => item.id)).toEqual(['history']);

    await controller.setReviewStatuses([
      KnowledgeFactReviewStatus.Confirmed,
      KnowledgeFactReviewStatus.Pending,
      KnowledgeFactReviewStatus.Confirmed,
    ]);
    expect(listFacts).toHaveBeenNthCalledWith(4, {
      workspaceId: 'workspace-a',
      view: KnowledgeFactListView.History,
      reviewStatuses: [
        KnowledgeFactReviewStatus.Pending,
        KnowledgeFactReviewStatus.Confirmed,
      ],
      evidenceState: KnowledgeFactEvidenceState.Any,
      limit: 50,
    });
    const generationAfterStatuses = controller.getSnapshot().contextGeneration;
    await controller.setReviewStatuses([
      KnowledgeFactReviewStatus.Pending,
      KnowledgeFactReviewStatus.Confirmed,
      KnowledgeFactReviewStatus.Pending,
    ]);
    expect(controller.getSnapshot().contextGeneration).toBe(generationAfterStatuses);
    expect(listFacts).toHaveBeenCalledTimes(4);

    await controller.setEvidenceState(KnowledgeFactEvidenceState.Stale);
    expect(listFacts).toHaveBeenNthCalledWith(5, {
      workspaceId: 'workspace-a',
      view: KnowledgeFactListView.History,
      reviewStatuses: [
        KnowledgeFactReviewStatus.Pending,
        KnowledgeFactReviewStatus.Confirmed,
      ],
      evidenceState: KnowledgeFactEvidenceState.Stale,
      limit: 50,
    });
    expect(listFacts.mock.calls[4][0]).not.toHaveProperty('archived');

    await controller.updateContext({
      workspaceId: 'workspace-a',
      profileRevision: 2,
      profile: profile(),
    });
    expect(listFacts).toHaveBeenCalledTimes(6);
    controller.dispose();
  });

  test('drains repeated active refreshes exactly once and starts an idle refresh immediately', async () => {
    const first = deferred<KnowledgeFactListResult>();
    const trailing = deferred<KnowledgeFactListResult>();
    const listFacts = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => trailing.promise)
      .mockResolvedValueOnce(result([fact('idle-refresh')], null, metrics(3)));
    const controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });

    const startPromise = controller.start();
    await flushMicrotasks();
    const firstRefresh = controller.refreshAfterMutation();
    const duplicateRefresh = controller.refreshAfterMutation();
    expect(listFacts).toHaveBeenCalledTimes(1);

    first.resolve(result([fact('first')], null, metrics(1)));
    await flushMicrotasks();
    expect(listFacts).toHaveBeenCalledTimes(2);
    trailing.resolve(result([fact('trailing')], null, metrics(2)));
    await Promise.all([startPromise, firstRefresh, duplicateRefresh]);
    expect(listFacts).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().facts.map(item => item.id)).toEqual(['trailing']);

    await controller.refreshAfterMutation();
    expect(listFacts).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot().facts.map(item => item.id)).toEqual(['idle-refresh']);
    controller.dispose();
  });

  test('disposal prevents stale response commits, trailing requests, and subscriber callbacks', async () => {
    const pending = deferred<KnowledgeFactListResult>();
    const listener = vi.fn();
    const listFacts = vi.fn(() => pending.promise);
    const controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments: vi.fn(async () => []) },
    });
    controller.subscribe(listener);

    const started = controller.start();
    await flushMicrotasks();
    controller.refreshAfterMutation();
    const callbackCountBeforeDispose = listener.mock.calls.length;
    controller.dispose();
    pending.resolve(result([fact('must-not-commit')], null, metrics(9)));
    await started;
    await flushMicrotasks();

    expect(listFacts).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(callbackCountBeforeDispose);
    expect(controller.getSnapshot().facts).toEqual([]);
    expect(controller.getSnapshot().metricsAcceptanceGeneration).toBe(0);

    const disposedSnapshot = controller.getSnapshot();
    await controller.setView(KnowledgeFactListView.History);
    await controller.setReviewStatuses([KnowledgeFactReviewStatus.Confirmed]);
    await controller.setEvidenceState(KnowledgeFactEvidenceState.Stale);
    await controller.updateContext({
      workspaceId: 'workspace-b',
      profileRevision: 2,
      profile: profile({ productList: ['must not appear'] }),
    });
    expect(controller.getSnapshot()).toBe(disposedSnapshot);
    expect(listFacts).toHaveBeenCalledTimes(1);
  });
});

describe('workspace AI knowledge fact mutation ownership', () => {
  type Task7Controller = ReturnType<typeof createWorkspaceAiKnowledgeController> & {
    reviewFact: (
      currentFact: KnowledgeFactSummary,
      decision: (typeof KnowledgeFactReviewDecision)[keyof typeof KnowledgeFactReviewDecision],
    ) => Promise<void>;
    archiveFact: (currentFact: KnowledgeFactSummary) => Promise<void>;
    resolveCompanyReplacement: () => Promise<void>;
    resolveArchiveKeepCurrent: () => Promise<void>;
    resolveArchiveRemoveCurrent: () => Promise<void>;
    dismissProjectionConflict: () => void;
    expandEvidence: (currentFact: KnowledgeFactSummary) => Promise<void>;
    collapseEvidence: () => void;
    loadMoreEvidence: () => Promise<void>;
    retryEvidence: () => Promise<void>;
    setProjectionRefreshHandler: (
      handler?: (input: { workspaceId: string; profileRevision: number }) => Promise<void> | void,
    ) => void;
    getSnapshot: () => ReturnType<
      ReturnType<typeof createWorkspaceAiKnowledgeController>['getSnapshot']
    > & {
      mutations: Record<string, unknown>;
      mutationFeedback: Record<
        string,
        { status: string; errorCode: string | null }
      >;
      projectionDialog: null | {
        kind: string;
        factId: string;
        factRevision: number;
        domain: string;
        currentFieldValue: string | string[] | null;
        fieldRevision: number | null;
        isSubmitting: boolean;
        errorCode: string | null;
        dialogGeneration: number;
      };
      evidence: {
        expandedFactId: string | null;
        factRevision: number | null;
        items: KnowledgeFactEvidenceSummary[];
        nextCursor: string | null;
        isLoading: boolean;
        requestGeneration: number;
        activeRequest: unknown;
      };
      evidenceErrorCode: string | null;
      evidenceHasLoadedFirstPage: boolean;
      mutationAnnouncement: null | {
        status: string;
        generation: number;
      };
    };
  };

  const createMutationController = (options: {
    initialFacts?: KnowledgeFactSummary[];
    listFacts?: (request: KnowledgeListFactsRequest) => Promise<KnowledgeFactListResult>;
    reviewFact?: (input: Record<string, unknown>) => Promise<KnowledgeFactReviewResult>;
    archiveFact?: (input: Record<string, unknown>) => Promise<KnowledgeFactReviewResult>;
    getFactEvidence?: (input: Record<string, unknown>) => Promise<KnowledgeFactEvidencePageResult>;
  } = {}): Task7Controller =>
    createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: {
        listFacts:
          options.listFacts ??
          vi.fn(async () => result(options.initialFacts ?? [], null, metrics(1))),
        listDocuments: vi.fn(async () => []),
        reviewFact:
          options.reviewFact ??
          vi.fn(async input =>
            reviewResult(fact(String(input.factId), Number(input.expectedRevision) + 1)),
          ),
        archiveFact:
          options.archiveFact ??
          vi.fn(async input =>
            reviewResult(
              fact(String(input.factId), Number(input.expectedRevision) + 1),
            ),
          ),
        getFactEvidence:
          options.getFactEvidence ??
          vi.fn(async input => ({
            factId: String(input.factId),
            factRevision: Number(input.expectedRevision),
            items: [],
            nextCursor: null,
          })),
      } as never,
    }) as Task7Controller;

  const projectionConflict = (
    overrides: Partial<KnowledgeFactProjectionConflict> = {},
  ): KnowledgeFactProjectionConflict => ({
    operation: KnowledgeFactProjectionOperation.Confirm,
    kind: KnowledgeFactProjectionConflictKind.CompanySummaryReplacement,
    factId: 'fact-company',
    factRevision: 3,
    domain: KnowledgeFactDomain.CompanySummary,
    currentFieldValue: 'Current company summary',
    fieldRevision: 11,
    ...overrides,
  });

  test('sends exact own keys for ordinary Confirm, Reject, and default Archive', async () => {
    const pendingConfirm = fact('fact-confirm', 3);
    const pendingReject = fact('fact-reject', 5);
    const confirmedArchive = {
      ...fact('fact-archive', 7),
      reviewStatus: KnowledgeFactReviewStatus.Confirmed,
      projectionState: KnowledgeFactProjectionState.Active,
    };
    const reviewFact = vi.fn(async input =>
      reviewResult(fact(String(input.factId), Number(input.expectedRevision) + 1)),
    );
    const archiveFact = vi.fn(async input =>
      reviewResult(fact(String(input.factId), Number(input.expectedRevision) + 1)),
    );
    const controller = createMutationController({
      initialFacts: [pendingConfirm, pendingReject, confirmedArchive],
      reviewFact,
      archiveFact,
    });
    await controller.start();

    await Promise.all([
      controller.reviewFact(pendingConfirm, KnowledgeFactReviewDecision.Confirm),
      controller.reviewFact(pendingReject, KnowledgeFactReviewDecision.Reject),
      controller.archiveFact(confirmedArchive),
    ]);

    expect(reviewFact).toHaveBeenCalledTimes(2);
    expect(reviewFact.mock.calls[0][0]).toEqual({
      factId: 'fact-confirm',
      expectedRevision: 3,
      decision: KnowledgeFactReviewDecision.Confirm,
    });
    expect(Object.keys(reviewFact.mock.calls[0][0])).toEqual([
      'factId',
      'expectedRevision',
      'decision',
    ]);
    expect(reviewFact.mock.calls[1][0]).toEqual({
      factId: 'fact-reject',
      expectedRevision: 5,
      decision: KnowledgeFactReviewDecision.Reject,
    });
    expect(Object.keys(reviewFact.mock.calls[1][0])).toEqual([
      'factId',
      'expectedRevision',
      'decision',
    ]);
    expect(archiveFact).toHaveBeenCalledTimes(1);
    expect(archiveFact.mock.calls[0][0]).toEqual({
      factId: 'fact-archive',
      expectedRevision: 7,
    });
    expect(Object.keys(archiveFact.mock.calls[0][0])).toEqual([
      'factId',
      'expectedRevision',
    ]);
    controller.dispose();
  });

  test('installs a per-fact Promise owner before publish re-entry and coalesces rapid activation', async () => {
    const pending = fact('fact-a', 1);
    const mutation = deferred<KnowledgeFactReviewResult>();
    const reviewFact = vi.fn(() => mutation.promise);
    const controller = createMutationController({ initialFacts: [pending], reviewFact });
    await controller.start();
    let nested: Promise<void> | null = null;
    const unsubscribe = controller.subscribe(() => {
      if (!nested && controller.getSnapshot().mutations[pending.id]) {
        nested = controller.reviewFact(pending, KnowledgeFactReviewDecision.Confirm);
      }
    });

    const first = controller.reviewFact(pending, KnowledgeFactReviewDecision.Confirm);
    const rapid = controller.reviewFact(pending, KnowledgeFactReviewDecision.Confirm);
    await flushMicrotasks();

    expect(reviewFact).toHaveBeenCalledTimes(1);
    mutation.resolve(reviewResult(fact('fact-a', 2)));
    await Promise.all([first, rapid, nested as unknown as Promise<void>]);
    expect(reviewFact).toHaveBeenCalledTimes(1);
    unsubscribe();
    controller.dispose();
  });

  test('rechecks the current row before IPC after synchronous publish re-entry removes it', async () => {
    const pending = fact('fact-publish-reentry', 1);
    const reviewFact = vi.fn(async () => reviewResult({ ...pending, revision: 2 }));
    let listInvocation = 0;
    const controller = createMutationController({
      listFacts: vi.fn(async () =>
        result(listInvocation++ === 0 ? [pending] : [], null, metrics(1)),
      ),
      reviewFact,
    });
    await controller.start();
    let contextChange: Promise<void> | null = null;
    const unsubscribe = controller.subscribe(() => {
      if (!contextChange && controller.getSnapshot().mutations[pending.id]) {
        contextChange = controller.setView(KnowledgeFactListView.History);
      }
    });

    const mutation = controller.reviewFact(
      pending,
      KnowledgeFactReviewDecision.Reject,
    );
    await Promise.all([mutation, contextChange as unknown as Promise<void>]);

    expect(reviewFact).not.toHaveBeenCalled();
    expect(controller.getSnapshot().mutations).toEqual({});
    unsubscribe();
    controller.dispose();
  });

  test('cancels before the service microtask on context change and suppresses an old workspace settlement', async () => {
    const pending = fact('fact-a', 1);
    const beforeInvokeReview = vi.fn(async () => reviewResult(fact('fact-a', 2)));
    const beforeInvokeController = createMutationController({
      initialFacts: [pending],
      reviewFact: beforeInvokeReview,
    });
    await beforeInvokeController.start();

    const cancelled = beforeInvokeController.reviewFact(
      pending,
      KnowledgeFactReviewDecision.Confirm,
    );
    const changedContext = beforeInvokeController.updateContext({
      workspaceId: 'workspace-a',
      profileRevision: 2,
      profile: profile(),
    });
    await Promise.all([cancelled, changedContext]);
    expect(beforeInvokeReview).not.toHaveBeenCalled();
    beforeInvokeController.dispose();

    const oldResult = deferred<KnowledgeFactReviewResult>();
    const oldReview = vi.fn(() => oldResult.promise);
    const controller = createMutationController({
      initialFacts: [pending],
      reviewFact: oldReview,
    });
    const projectionRefresh = vi.fn();
    controller.setProjectionRefreshHandler(projectionRefresh);
    await controller.start();
    const mutationPromise = controller.reviewFact(
      pending,
      KnowledgeFactReviewDecision.Confirm,
    );
    await flushMicrotasks();
    await controller.updateContext({
      workspaceId: 'workspace-b',
      profileRevision: 1,
      profile: profile(),
    });
    oldResult.resolve(
      reviewResult(fact('fact-a', 2), {
        profileChanged: true,
        profileRevision: 9,
      }),
    );
    await mutationPromise;

    expect(projectionRefresh).not.toHaveBeenCalled();
    expect(controller.getSnapshot().workspaceId).toBe('workspace-b');
    expect(controller.getSnapshot().mutationFeedback).toEqual({});
    controller.dispose();
  });

  test('reconciles a validated commit after same-workspace context change with the current callback', async () => {
    const pending = fact('fact-a', 2);
    const mutation = deferred<KnowledgeFactReviewResult>();
    const listFacts = vi.fn(async request =>
      result(
        request.reviewStatuses?.length
          ? [fact(`page-${request.workspaceId}-${request.reviewStatuses.join('-')}`)]
          : [pending],
        null,
        metrics(2),
      ),
    );
    const controller = createMutationController({
      listFacts,
      reviewFact: vi.fn(() => mutation.promise),
    });
    const oldCallback = vi.fn();
    const currentCallback = vi.fn();
    controller.setProjectionRefreshHandler(oldCallback);
    await controller.start();

    const mutationPromise = controller.reviewFact(
      pending,
      KnowledgeFactReviewDecision.Confirm,
    );
    await flushMicrotasks();
    await controller.setReviewStatuses([KnowledgeFactReviewStatus.Confirmed]);
    controller.setProjectionRefreshHandler(currentCallback);
    mutation.resolve(
      reviewResult(fact('fact-a', 3), {
        profileChanged: true,
        profileRevision: 12,
      }),
    );
    await mutationPromise;

    expect(oldCallback).not.toHaveBeenCalled();
    expect(currentCallback).toHaveBeenCalledTimes(1);
    expect(currentCallback).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      profileRevision: 12,
    });
    expect(listFacts).toHaveBeenCalledTimes(3);
    expect(listFacts.mock.calls[2][0].reviewStatuses).toEqual([
      KnowledgeFactReviewStatus.Confirmed,
    ]);
    expect(controller.getSnapshot().mutationFeedback).toEqual({});
    controller.dispose();
  });

  test('starts fact refresh independently from Profile callback success, false, and rejection', async () => {
    const initialFacts = [fact('fact-a', 1), fact('fact-b', 1)];
    let refreshCount = 0;
    const listFacts = vi.fn(async () =>
      result(refreshCount++ === 0 ? initialFacts : initialFacts, null, metrics(4)),
    );
    const reviewFact = vi
      .fn()
      .mockResolvedValueOnce(
        reviewResult(fact('fact-a', 2), {
          profileChanged: true,
          profileRevision: 4,
        }),
      )
      .mockResolvedValueOnce(
        reviewResult(fact('fact-b', 2), {
          profileChanged: false,
          profileRevision: 5,
        }),
      );
    const controller = createMutationController({ listFacts, reviewFact });
    const projectionRefresh = vi.fn(async () => {
      throw new Error('private callback failure');
    });
    controller.setProjectionRefreshHandler(projectionRefresh);
    await controller.start();

    await controller.reviewFact(fact('fact-a', 1), KnowledgeFactReviewDecision.Confirm);
    await controller.reviewFact(fact('fact-b', 1), KnowledgeFactReviewDecision.Reject);

    expect(projectionRefresh).toHaveBeenCalledTimes(1);
    expect(projectionRefresh).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      profileRevision: 4,
    });
    expect(listFacts).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('private callback');
    controller.dispose();
  });

  test('suppresses Profile refresh when a success publish synchronously switches workspace', async () => {
    const controller = createMutationController({
      initialFacts: [fact('fact-a', 1)],
      reviewFact: vi.fn(async () =>
        reviewResult(fact('fact-a', 2), {
          profileChanged: true,
          profileRevision: 8,
        }),
      ),
    });
    const projectionRefresh = vi.fn();
    controller.setProjectionRefreshHandler(projectionRefresh);
    await controller.start();
    let switched = false;
    const unsubscribe = controller.subscribe(() => {
      const feedback = controller.getSnapshot().mutationFeedback['fact-a'];
      if (!switched && feedback?.status === 'succeeded') {
        switched = true;
        void controller.updateContext({
          workspaceId: 'workspace-b',
          profileRevision: 1,
          profile: profile(),
        });
      }
    });

    await controller.reviewFact(fact('fact-a', 1), KnowledgeFactReviewDecision.Confirm);

    expect(switched).toBe(true);
    expect(projectionRefresh).not.toHaveBeenCalled();
    expect(controller.getSnapshot().workspaceId).toBe('workspace-b');
    unsubscribe();
    controller.dispose();
  });

  test('rejects malformed mutation results and normalizes unknown failures without diagnostics', async () => {
    const reviewFact = vi
      .fn()
      .mockResolvedValueOnce(reviewResult(fact('wrong-fact', 2)))
      .mockResolvedValueOnce(reviewResult(fact('fact-a', 1)))
      .mockRejectedValueOnce(new Error('SQL secret /private/path endpoint'));
    const controller = createMutationController({
      initialFacts: [fact('fact-a', 1)],
      reviewFact,
    });
    await controller.start();

    await controller.reviewFact(fact('fact-a', 1), KnowledgeFactReviewDecision.Confirm);
    expect(controller.getSnapshot().mutationFeedback['fact-a']?.errorCode).toBe(
      KnowledgeBaseErrorCode.JobStateConflict,
    );
    await controller.reviewFact(fact('fact-a', 1), KnowledgeFactReviewDecision.Confirm);
    expect(controller.getSnapshot().mutationFeedback['fact-a']?.errorCode).toBe(
      KnowledgeBaseErrorCode.JobStateConflict,
    );
    await controller.reviewFact(fact('fact-a', 1), KnowledgeFactReviewDecision.Confirm);
    expect(controller.getSnapshot().mutationFeedback['fact-a']?.errorCode).toBe(
      KnowledgeBaseErrorCode.PersistenceFailed,
    );
    const serialized = JSON.stringify(controller.getSnapshot());
    expect(serialized).not.toContain('SQL');
    expect(serialized).not.toContain('/private/path');
    expect(serialized).not.toContain('endpoint');
    controller.dispose();
  });

  test('invalidates an active Append and settles only after one trailing Replace', async () => {
    const append = deferred<KnowledgeFactListResult>();
    const trailing = deferred<KnowledgeFactListResult>();
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(result([fact('fact-a', 1)], 'cursor-2', metrics(1)))
      .mockImplementationOnce(() => append.promise)
      .mockImplementationOnce(() => trailing.promise);
    const controller = createMutationController({ listFacts });
    await controller.start();
    const loadingMore = controller.loadMore();
    await flushMicrotasks();
    let mutationSettled = false;
    const mutationPromise = controller
      .reviewFact(fact('fact-a', 1), KnowledgeFactReviewDecision.Confirm)
      .then(() => {
        mutationSettled = true;
      });
    await flushMicrotasks();

    expect(mutationSettled).toBe(false);
    expect(listFacts).toHaveBeenCalledTimes(2);
    append.resolve(result([fact('stale-append', 1)], null, metrics(2)));
    await flushMicrotasks();
    expect(listFacts).toHaveBeenCalledTimes(3);
    expect(mutationSettled).toBe(false);
    trailing.resolve(result([fact('fresh-after-mutation', 1)], null, metrics(3)));
    await Promise.all([loadingMore, mutationPromise]);

    expect(listFacts).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot().facts.map(item => item.id)).toEqual([
      'fresh-after-mutation',
    ]);
    controller.dispose();
  });

  test('validates a company conflict and retries replacement with only the displayed revision', async () => {
    const companyFact = {
      ...fact('fact-company', 3),
      domain: KnowledgeFactDomain.CompanySummary,
    };
    const firstConflict = projectionConflict();
    const updatedConflict = projectionConflict({
      currentFieldValue: 'Newer current company summary',
      fieldRevision: 12,
    });
    const reviewFact = vi
      .fn()
      .mockRejectedValueOnce(
        new KnowledgeBaseServiceError(KnowledgeBaseErrorCode.FactProjectionConflict, {
          projectionConflict: firstConflict,
        }),
      )
      .mockRejectedValueOnce(
        new KnowledgeBaseServiceError(KnowledgeBaseErrorCode.FactProjectionConflict, {
          projectionConflict: updatedConflict,
        }),
      )
      .mockResolvedValueOnce(reviewResult({ ...companyFact, revision: 4 }));
    const controller = createMutationController({
      initialFacts: [companyFact],
      reviewFact,
    });
    await controller.start();

    await controller.reviewFact(companyFact, KnowledgeFactReviewDecision.Confirm);
    expect(controller.getSnapshot().projectionDialog).toMatchObject({
      kind: 'company_replacement',
      factId: 'fact-company',
      factRevision: 3,
      domain: KnowledgeFactDomain.CompanySummary,
      currentFieldValue: 'Current company summary',
      fieldRevision: 11,
      isSubmitting: false,
    });

    await controller.resolveCompanyReplacement();
    expect(reviewFact.mock.calls[1][0]).toEqual({
      factId: 'fact-company',
      expectedRevision: 3,
      decision: KnowledgeFactReviewDecision.Confirm,
      replaceExisting: true,
      expectedFieldRevision: 11,
    });
    expect(Object.keys(reviewFact.mock.calls[1][0])).toEqual([
      'factId',
      'expectedRevision',
      'decision',
      'replaceExisting',
      'expectedFieldRevision',
    ]);
    expect(controller.getSnapshot().projectionDialog).toMatchObject({
      currentFieldValue: 'Newer current company summary',
      fieldRevision: 12,
      isSubmitting: false,
    });

    await controller.resolveCompanyReplacement();
    expect(reviewFact.mock.calls[2][0]).toMatchObject({
      expectedFieldRevision: 12,
    });
    expect(controller.getSnapshot().projectionDialog).toBeNull();
    controller.dispose();
  });

  test('rejects every mismatched company conflict DTO as fixed generic feedback', async () => {
    const companyFact = {
      ...fact('fact-company', 3),
      domain: KnowledgeFactDomain.CompanySummary,
    };
    const mismatches: KnowledgeFactProjectionConflict[] = [
      projectionConflict({ operation: KnowledgeFactProjectionOperation.Archive }),
      projectionConflict({ kind: KnowledgeFactProjectionConflictKind.ArchiveFieldChanged }),
      projectionConflict({ factId: 'fact-other' }),
      projectionConflict({ factRevision: 4 }),
      projectionConflict({ domain: KnowledgeFactDomain.ProductList }),
      projectionConflict({ fieldRevision: 0 }),
      projectionConflict({ fieldRevision: Number.MAX_SAFE_INTEGER + 1 }),
      projectionConflict({
        currentFieldValue: new Array(1) as string[],
      }),
    ];

    for (const mismatch of mismatches) {
      const controller = createMutationController({
        initialFacts: [companyFact],
        reviewFact: vi.fn(async () => {
          throw new KnowledgeBaseServiceError(
            KnowledgeBaseErrorCode.FactProjectionConflict,
            { projectionConflict: mismatch },
          );
        }),
      });
      await controller.start();
      await controller.reviewFact(companyFact, KnowledgeFactReviewDecision.Confirm);

      expect(controller.getSnapshot().projectionDialog).toBeNull();
      expect(controller.getSnapshot().mutationFeedback['fact-company']?.errorCode).toBe(
        KnowledgeBaseErrorCode.PersistenceFailed,
      );
      const unsafeDisplayValue = String(mismatch.currentFieldValue);
      if (unsafeDisplayValue) {
        expect(JSON.stringify(controller.getSnapshot())).not.toContain(
          unsafeDisplayValue,
        );
      }
      controller.dispose();
    }
  });

  test('sends exact archive KeepCurrent and RemoveCurrent conflict resolutions', async () => {
    const confirmed = {
      ...fact('fact-archive', 5),
      domain: KnowledgeFactDomain.SellingPoints,
      reviewStatus: KnowledgeFactReviewStatus.Confirmed,
      projectionState: KnowledgeFactProjectionState.Active,
    };
    const archiveConflict = projectionConflict({
      operation: KnowledgeFactProjectionOperation.Archive,
      kind: KnowledgeFactProjectionConflictKind.ArchiveFieldChanged,
      factId: 'fact-archive',
      factRevision: 5,
      domain: KnowledgeFactDomain.SellingPoints,
      currentFieldValue: ['Current selling point'],
      fieldRevision: 21,
    });

    for (const choice of ['keep', 'remove'] as const) {
      const archiveFact = vi
        .fn()
        .mockRejectedValueOnce(
          new KnowledgeBaseServiceError(
            KnowledgeBaseErrorCode.FactProjectionConflict,
            { projectionConflict: archiveConflict },
          ),
        )
        .mockResolvedValueOnce(reviewResult({ ...confirmed, revision: 6 }));
      const controller = createMutationController({
        initialFacts: [confirmed],
        archiveFact,
      });
      await controller.start();
      await controller.archiveFact(confirmed);
      expect(controller.getSnapshot().projectionDialog).toMatchObject({
        kind: 'archive_conflict',
        currentFieldValue: ['Current selling point'],
        fieldRevision: 21,
      });

      if (choice === 'keep') {
        await controller.resolveArchiveKeepCurrent();
        expect(archiveFact.mock.calls[1][0]).toEqual({
          factId: 'fact-archive',
          expectedRevision: 5,
          projectionDecision: KnowledgeFactArchiveProjectionDecision.KeepCurrent,
        });
        expect(Object.keys(archiveFact.mock.calls[1][0])).toEqual([
          'factId',
          'expectedRevision',
          'projectionDecision',
        ]);
      } else {
        await controller.resolveArchiveRemoveCurrent();
        expect(archiveFact.mock.calls[1][0]).toEqual({
          factId: 'fact-archive',
          expectedRevision: 5,
          projectionDecision: KnowledgeFactArchiveProjectionDecision.RemoveCurrent,
          expectedFieldRevision: 21,
        });
      }
      expect(controller.getSnapshot().projectionDialog).toBeNull();
      controller.dispose();
    }
  });

  test('clears an archive conflict when a transient empty state accepts a projection change', async () => {
    const siblingFact = fact('fact-archive-dialog-sibling', 1);
    const confirmed = {
      ...fact('fact-archive-dialog-owner', 5),
      domain: KnowledgeFactDomain.SellingPoints,
      reviewStatus: KnowledgeFactReviewStatus.Confirmed,
      projectionState: KnowledgeFactProjectionState.Active,
    };
    const changedProjection = {
      ...confirmed,
      projectionState: KnowledgeFactProjectionState.None,
    };
    const siblingResult = deferred<KnowledgeFactReviewResult>();
    const archiveConflictResult = deferred<KnowledgeFactReviewResult>();
    const trailingReplace = deferred<KnowledgeFactListResult>();
    const unexpectedResolution = deferred<KnowledgeFactReviewResult>();
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(
        result([siblingFact, confirmed], null, metrics(1)),
      )
      .mockImplementationOnce(() => trailingReplace.promise);
    const archiveFact = vi
      .fn()
      .mockImplementationOnce(() => archiveConflictResult.promise)
      .mockImplementationOnce(() => unexpectedResolution.promise);
    const controller = createMutationController({
      listFacts,
      archiveFact,
      reviewFact: vi.fn(() => siblingResult.promise),
    });
    await controller.start();

    const siblingMutation = controller.reviewFact(
      siblingFact,
      KnowledgeFactReviewDecision.Reject,
    );
    const archiveMutation = controller.archiveFact(confirmed);
    await flushMicrotasks();
    siblingResult.resolve(
      reviewResult({ ...siblingFact, revision: siblingFact.revision + 1 }),
    );
    await flushMicrotasks();
    expect(listFacts).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().facts).toEqual([]);
    archiveConflictResult.reject(
      new KnowledgeBaseServiceError(
        KnowledgeBaseErrorCode.FactProjectionConflict,
        {
          projectionConflict: projectionConflict({
            operation: KnowledgeFactProjectionOperation.Archive,
            kind: KnowledgeFactProjectionConflictKind.ArchiveFieldChanged,
            factId: confirmed.id,
            factRevision: confirmed.revision,
            domain: confirmed.domain,
            currentFieldValue: ['Current selling point'],
            fieldRevision: 21,
          }),
        },
      ),
    );
    await archiveMutation;
    expect(controller.getSnapshot().projectionDialog).toMatchObject({
      kind: 'archive_conflict',
      factId: confirmed.id,
    });
    trailingReplace.resolve(
      result(
        [
          { ...siblingFact, revision: siblingFact.revision + 1 },
          changedProjection,
        ],
        null,
        metrics(2),
      ),
    );
    await siblingMutation;

    expect(
      controller.getSnapshot().facts.find(item => item.id === confirmed.id)
        ?.projectionState,
    ).toBe(KnowledgeFactProjectionState.None);
    expect(controller.getSnapshot().projectionDialog).toBeNull();
    void controller.resolveArchiveKeepCurrent();
    await flushMicrotasks();
    expect(archiveFact).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  test('opens ledgerless archive recovery without a default call and invalidates dialog ownership', async () => {
    const ledgerless = {
      ...fact('fact-ledgerless', 9),
      reviewStatus: KnowledgeFactReviewStatus.Confirmed,
      projectionState: KnowledgeFactProjectionState.Conflict,
    };
    const archiveFact = vi.fn(async (_input: Record<string, unknown>) => {
      throw new KnowledgeBaseServiceError(
        KnowledgeBaseErrorCode.FactProjectionConflict,
        {
          projectionConflict: projectionConflict({
            operation: KnowledgeFactProjectionOperation.Archive,
            kind: KnowledgeFactProjectionConflictKind.ArchiveFieldChanged,
            factId: ledgerless.id,
            factRevision: ledgerless.revision,
            domain: ledgerless.domain,
            currentFieldValue: 'Must never be displayed',
            fieldRevision: 91,
          }),
        },
      );
    });
    const controller = createMutationController({
      initialFacts: [ledgerless],
      archiveFact,
    });
    await controller.start();

    await controller.archiveFact(ledgerless);
    expect(archiveFact).not.toHaveBeenCalled();
    expect(controller.getSnapshot().projectionDialog).toMatchObject({
      kind: 'archive_ledgerless',
      factId: 'fact-ledgerless',
      factRevision: 9,
      currentFieldValue: null,
      fieldRevision: null,
    });
    await controller.resolveArchiveRemoveCurrent();
    expect(archiveFact).not.toHaveBeenCalled();
    await controller.resolveArchiveKeepCurrent();
    expect(archiveFact).toHaveBeenCalledTimes(1);
    expect(archiveFact.mock.calls[0][0]).toEqual({
      factId: 'fact-ledgerless',
      expectedRevision: 9,
      projectionDecision: KnowledgeFactArchiveProjectionDecision.KeepCurrent,
    });
    expect(controller.getSnapshot().projectionDialog).toMatchObject({
      kind: 'archive_ledgerless',
      currentFieldValue: null,
      fieldRevision: null,
      errorCode: KnowledgeBaseErrorCode.PersistenceFailed,
    });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(
      'Must never be displayed',
    );

    controller.dismissProjectionConflict();
    expect(controller.getSnapshot().projectionDialog).toBeNull();
    await controller.archiveFact(ledgerless);
    expect(archiveFact).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().projectionDialog).toMatchObject({
      kind: 'archive_ledgerless',
    });
    await controller.setView(KnowledgeFactListView.History);
    expect(controller.getSnapshot().projectionDialog).toBeNull();
    controller.dispose();
  });

  test('rejects captured rows after an accepted context refresh without IPC or UI ownership changes', async () => {
    const pending = fact('stale-pending', 1);
    const ledgerless = {
      ...fact('stale-archive', 1),
      reviewStatus: KnowledgeFactReviewStatus.Confirmed,
      projectionState: KnowledgeFactProjectionState.Conflict,
    };
    const evidenceFact = fact('stale-evidence', 1);
    const currentRows = [pending, ledgerless, evidenceFact];
    const refreshedRows = currentRows.map(item => ({ ...item, revision: 2 }));
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(result(currentRows, null, metrics(1)))
      .mockResolvedValue(result(refreshedRows, null, metrics(2)));
    const reviewFact = vi.fn();
    const archiveFact = vi.fn();
    const getFactEvidence = vi.fn();
    const controller = createMutationController({
      listFacts,
      reviewFact: reviewFact as never,
      archiveFact: archiveFact as never,
      getFactEvidence: getFactEvidence as never,
    });
    await controller.start();

    await controller.setView(KnowledgeFactListView.History);
    await controller.reviewFact(pending, KnowledgeFactReviewDecision.Reject);
    await controller.archiveFact(ledgerless);
    await controller.expandEvidence(evidenceFact);

    expect(reviewFact).not.toHaveBeenCalled();
    expect(archiveFact).not.toHaveBeenCalled();
    expect(getFactEvidence).not.toHaveBeenCalled();
    expect(controller.getSnapshot().mutations).toEqual({});
    expect(controller.getSnapshot().projectionDialog).toBeNull();
    expect(controller.getSnapshot().evidence.expandedFactId).toBeNull();
    controller.dispose();
  });

  test('does not review an archived Pending fact through the public controller action', async () => {
    const archivedPending = {
      ...fact('archived-pending', 1),
      archivedAt: '2026-07-14T00:00:00.000Z',
    };
    const reviewFact = vi.fn();
    const controller = createMutationController({
      initialFacts: [archivedPending],
      reviewFact: reviewFact as never,
    });
    await controller.start();

    await controller.reviewFact(
      archivedPending,
      KnowledgeFactReviewDecision.Reject,
    );

    expect(reviewFact).not.toHaveBeenCalled();
    expect(controller.getSnapshot().mutations).toEqual({});
    controller.dispose();
  });

  test('rejects workspace-A captured rows after switching to workspace B', async () => {
    const pending = fact('workspace-a-pending', 1);
    const ledgerless = {
      ...fact('workspace-a-archive', 1),
      reviewStatus: KnowledgeFactReviewStatus.Confirmed,
      projectionState: KnowledgeFactProjectionState.Conflict,
    };
    const evidenceFact = fact('workspace-a-evidence', 1);
    const reviewFact = vi.fn();
    const archiveFact = vi.fn();
    const getFactEvidence = vi.fn();
    const controller = createMutationController({
      listFacts: vi.fn(async request =>
        result(
          request.workspaceId === 'workspace-a'
            ? [pending, ledgerless, evidenceFact]
            : [],
          null,
          metrics(1),
        ),
      ),
      reviewFact: reviewFact as never,
      archiveFact: archiveFact as never,
      getFactEvidence: getFactEvidence as never,
    });
    await controller.start();

    await controller.updateContext({
      workspaceId: 'workspace-b',
      profileRevision: 1,
      profile: profile(),
    });
    await controller.reviewFact(pending, KnowledgeFactReviewDecision.Reject);
    await controller.archiveFact(ledgerless);
    await controller.expandEvidence(evidenceFact);

    expect(reviewFact).not.toHaveBeenCalled();
    expect(archiveFact).not.toHaveBeenCalled();
    expect(getFactEvidence).not.toHaveBeenCalled();
    expect(controller.getSnapshot().projectionDialog).toBeNull();
    expect(controller.getSnapshot().evidence.expandedFactId).toBeNull();
    controller.dispose();
  });

  test('clears old mutation ownership when a same-generation refresh changes the row revision', async () => {
    const companyFact = {
      ...fact('fact-company-refresh', 1),
      domain: KnowledgeFactDomain.CompanySummary,
    };
    const refreshedFact = { ...companyFact, revision: 2 };

    for (const settlement of ['success', 'conflict'] as const) {
      const mutation = deferred<KnowledgeFactReviewResult>();
      let listInvocation = 0;
      const listFacts = vi.fn(async () =>
        result(listInvocation++ === 0 ? [companyFact] : [refreshedFact], null, metrics(1)),
      );
      const controller = createMutationController({
        listFacts,
        reviewFact: vi.fn(() => mutation.promise),
      });
      await controller.start();

      const pendingMutation = controller.reviewFact(
        companyFact,
        KnowledgeFactReviewDecision.Confirm,
      );
      await flushMicrotasks();
      await controller.refreshAfterMutation();
      if (settlement === 'success') {
        mutation.resolve(reviewResult(refreshedFact));
      } else {
        mutation.reject(
          new KnowledgeBaseServiceError(
            KnowledgeBaseErrorCode.FactProjectionConflict,
            {
              projectionConflict: projectionConflict({
                factId: companyFact.id,
                factRevision: companyFact.revision,
              }),
            },
          ),
        );
      }
      await pendingMutation;

      expect(controller.getSnapshot().mutations).toEqual({});
      expect(controller.getSnapshot().projectionDialog).toBeNull();
      expect(controller.getSnapshot().mutationAnnouncement).toBeNull();
      controller.dispose();
    }
  });

  for (const scenario of [
    { kind: 'missing', accepted: 'missing' },
    { kind: 'higher revision', accepted: 'revision' },
    { kind: 'higher revision with a different domain', accepted: 'domain' },
  ] as const) {
    test(`detaches an unresolved old owner after an accepted ${scenario.kind} row and preserves a newer owner during old-success reconciliation`, async () => {
      const oldFact = fact(`fact-old-owner-${scenario.accepted}`, 1);
      const currentFact =
        scenario.accepted === 'domain'
          ? {
              ...oldFact,
              revision: 2,
              domain: KnowledgeFactDomain.SellingPoints,
            }
          : { ...oldFact, revision: 2 };
      let currentRows: KnowledgeFactSummary[] = [oldFact];
      const oldMutation = deferred<KnowledgeFactReviewResult>();
      const newMutation = deferred<KnowledgeFactReviewResult>();
      const listFacts = vi.fn(async () =>
        result([...currentRows], null, metrics(1)),
      );
      const reviewFact = vi
        .fn()
        .mockImplementationOnce(() => oldMutation.promise)
        .mockImplementationOnce(() => newMutation.promise);
      const controller = createMutationController({ listFacts, reviewFact });
      await controller.start();

      const oldAction = controller.reviewFact(
        oldFact,
        KnowledgeFactReviewDecision.Reject,
      );
      await flushMicrotasks();
      expect(reviewFact).toHaveBeenCalledTimes(1);

      currentRows = scenario.accepted === 'missing' ? [] : [currentFact];
      await controller.refreshAfterMutation();
      expect(controller.getSnapshot().mutations).toEqual({});
      expect(controller.getSnapshot().mutationFeedback[oldFact.id]).toBeUndefined();

      let actionFact = currentFact;
      if (scenario.accepted === 'missing') {
        actionFact = currentFact;
        currentRows = [actionFact];
        await controller.refreshAfterMutation();
      }
      const newAction = controller.reviewFact(
        actionFact,
        KnowledgeFactReviewDecision.Reject,
      );
      await flushMicrotasks();
      expect(reviewFact).toHaveBeenCalledTimes(2);
      expect(controller.getSnapshot().mutationFeedback[actionFact.id]).toEqual({
        status: 'submitting',
        errorCode: null,
      });

      oldMutation.resolve(reviewResult({ ...oldFact, revision: 2 }));
      await oldAction;

      expect(controller.getSnapshot().mutations[actionFact.id]).toBeDefined();
      expect(controller.getSnapshot().mutationFeedback[actionFact.id]).toEqual({
        status: 'submitting',
        errorCode: null,
      });
      expect(controller.getSnapshot().mutationAnnouncement).toBeNull();
      expect(controller.getSnapshot().projectionDialog).toBeNull();

      const committedCurrentFact = {
        ...actionFact,
        revision: actionFact.revision + 1,
      };
      currentRows = [committedCurrentFact];
      newMutation.resolve(reviewResult(committedCurrentFact));
      await newAction;

      expect(controller.getSnapshot().mutationFeedback[actionFact.id]).toEqual({
        status: 'succeeded',
        errorCode: null,
      });
      controller.dispose();
    });
  }

  for (const incoming of [
    { label: 'lower revision', revision: 2 },
    { label: 'equal revision', revision: 3 },
  ] as const) {
    test(`keeps the reducer-retained mutation owner across a ${incoming.label} raw Replace`, async () => {
      const currentFact = fact(`fact-retained-owner-${incoming.revision}`, 3);
      const staleRawFact: KnowledgeFactSummary = {
        ...currentFact,
        revision: incoming.revision,
        domain: KnowledgeFactDomain.SellingPoints,
        reviewStatus: KnowledgeFactReviewStatus.Confirmed,
        projectionState: KnowledgeFactProjectionState.Active,
        archivedAt: '2026-07-14T01:00:00.000Z',
      };
      let currentRows: KnowledgeFactSummary[] = [currentFact];
      const mutation = deferred<KnowledgeFactReviewResult>();
      const reviewFact = vi.fn(() => mutation.promise);
      const controller = createMutationController({
        listFacts: vi.fn(async () => result([...currentRows], null, metrics(1))),
        reviewFact,
      });
      await controller.start();

      const pendingAction = controller.reviewFact(
        currentFact,
        KnowledgeFactReviewDecision.Reject,
      );
      await flushMicrotasks();
      currentRows = [staleRawFact];
      await controller.refreshAfterMutation();
      const repeatedAction = controller.reviewFact(
        currentFact,
        KnowledgeFactReviewDecision.Reject,
      );
      await flushMicrotasks();

      expect(controller.getSnapshot().facts).toEqual([currentFact]);
      expect(controller.getSnapshot().mutations[currentFact.id]).toBeDefined();
      expect(controller.getSnapshot().mutationFeedback[currentFact.id]).toEqual({
        status: 'submitting',
        errorCode: null,
      });
      expect(repeatedAction).toBe(pendingAction);
      expect(reviewFact).toHaveBeenCalledTimes(1);
      controller.dispose();
    });
  }

  for (const resetKind of ['profile revision', 'filter'] as const) {
    test(`detaches an unresolved owner on same-workspace ${resetKind} reset without letting its old success clear a newer owner`, async () => {
      const currentFact = fact(`fact-${resetKind.replace(' ', '-')}`, 1);
      let currentRows: KnowledgeFactSummary[] = [currentFact];
      const oldMutation = deferred<KnowledgeFactReviewResult>();
      const newMutation = deferred<KnowledgeFactReviewResult>();
      const reviewFact = vi
        .fn()
        .mockImplementationOnce(() => oldMutation.promise)
        .mockImplementationOnce(() => newMutation.promise);
      const controller = createMutationController({
        listFacts: vi.fn(async () => result([...currentRows], null, metrics(1))),
        reviewFact,
      });
      await controller.start();

      const oldAction = controller.reviewFact(
        currentFact,
        KnowledgeFactReviewDecision.Reject,
      );
      await flushMicrotasks();
      expect(reviewFact).toHaveBeenCalledTimes(1);

      if (resetKind === 'profile revision') {
        await controller.updateContext({
          workspaceId: 'workspace-a',
          profileRevision: 2,
          profile: profile(),
        });
      } else {
        await controller.setView(KnowledgeFactListView.History);
      }
      expect(controller.getSnapshot().mutations).toEqual({});
      expect(controller.getSnapshot().mutationFeedback).toEqual({});

      const newAction = controller.reviewFact(
        currentFact,
        KnowledgeFactReviewDecision.Reject,
      );
      await flushMicrotasks();
      expect(reviewFact).toHaveBeenCalledTimes(2);

      oldMutation.resolve(reviewResult({ ...currentFact, revision: 2 }));
      await oldAction;
      expect(controller.getSnapshot().mutations[currentFact.id]).toBeDefined();
      expect(controller.getSnapshot().mutationFeedback[currentFact.id]).toEqual({
        status: 'submitting',
        errorCode: null,
      });
      expect(controller.getSnapshot().mutationAnnouncement).toBeNull();

      const committedCurrentFact = { ...currentFact, revision: 2 };
      currentRows = [committedCurrentFact];
      newMutation.resolve(reviewResult(committedCurrentFact));
      await newAction;
      expect(controller.getSnapshot().mutationFeedback[currentFact.id]).toEqual({
        status: 'succeeded',
        errorCode: null,
      });
      controller.dispose();
    });
  }

  test('submits a company replacement while a sibling success Replace is still pending', async () => {
    const factA = fact('fact-a-pending-replace', 1);
    const companyFact = {
      ...fact('fact-company-pending-replace', 3),
      domain: KnowledgeFactDomain.CompanySummary,
    };
    const mutationA = deferred<KnowledgeFactReviewResult>();
    const companyConflict = deferred<KnowledgeFactReviewResult>();
    const companyReplacement = deferred<KnowledgeFactReviewResult>();
    const trailingReplace = deferred<KnowledgeFactListResult>();
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(result([factA, companyFact], null, metrics(1)))
      .mockImplementationOnce(() => trailingReplace.promise)
      .mockResolvedValueOnce(
        result(
          [
            { ...factA, revision: 2 },
            { ...companyFact, revision: 4 },
          ],
          null,
          metrics(3),
        ),
      );
    const reviewFact = vi.fn((input: Record<string, unknown>) => {
      if (input.factId === factA.id) {
        return mutationA.promise;
      }
      return input.replaceExisting === true
        ? companyReplacement.promise
        : companyConflict.promise;
    });
    const controller = createMutationController({ listFacts, reviewFact });
    await controller.start();

    const first = controller.reviewFact(factA, KnowledgeFactReviewDecision.Reject);
    const conflicted = controller.reviewFact(
      companyFact,
      KnowledgeFactReviewDecision.Confirm,
    );
    await flushMicrotasks();
    mutationA.resolve(reviewResult({ ...factA, revision: 2 }));
    await flushMicrotasks();
    expect(listFacts).toHaveBeenCalledTimes(2);

    companyConflict.reject(
      new KnowledgeBaseServiceError(
        KnowledgeBaseErrorCode.FactProjectionConflict,
        {
          projectionConflict: projectionConflict({
            factId: companyFact.id,
            factRevision: companyFact.revision,
          }),
        },
      ),
    );
    await conflicted;
    expect(controller.getSnapshot().projectionDialog).toMatchObject({
      kind: 'company_replacement',
      factId: companyFact.id,
    });

    const replacement = controller.resolveCompanyReplacement();
    await flushMicrotasks();
    const replacementRequestBeforeReplace = reviewFact.mock.calls[2]?.[0];
    companyReplacement.resolve(
      reviewResult({ ...companyFact, revision: 4 }),
    );
    await flushMicrotasks();
    trailingReplace.resolve(
      result(
        [{ ...factA, revision: 2 }, companyFact],
        null,
        metrics(2),
      ),
    );
    await Promise.all([first, replacement]);

    expect(replacementRequestBeforeReplace).toEqual({
      factId: companyFact.id,
      expectedRevision: companyFact.revision,
      decision: KnowledgeFactReviewDecision.Confirm,
      replaceExisting: true,
      expectedFieldRevision: 11,
    });
    expect(Object.keys(replacementRequestBeforeReplace ?? {})).toEqual([
      'factId',
      'expectedRevision',
      'decision',
      'replaceExisting',
      'expectedFieldRevision',
    ]);
    controller.dispose();
  });

  test('clears a projection dialog when an accepted higher revision changes its fact domain', async () => {
    const companyFact = {
      ...fact('fact-company-domain-change', 3),
      domain: KnowledgeFactDomain.CompanySummary,
    };
    let currentRows: KnowledgeFactSummary[] = [companyFact];
    const controller = createMutationController({
      listFacts: vi.fn(async () => result([...currentRows], null, metrics(1))),
      reviewFact: vi.fn(async () => {
        throw new KnowledgeBaseServiceError(
          KnowledgeBaseErrorCode.FactProjectionConflict,
          {
            projectionConflict: projectionConflict({
              factId: companyFact.id,
              factRevision: companyFact.revision,
            }),
          },
        );
      }),
    });
    await controller.start();
    await controller.reviewFact(
      companyFact,
      KnowledgeFactReviewDecision.Confirm,
    );
    expect(controller.getSnapshot().projectionDialog).not.toBeNull();

    currentRows = [
      {
        ...companyFact,
        revision: companyFact.revision + 1,
        domain: KnowledgeFactDomain.ProductList,
      },
    ];
    await controller.refreshAfterMutation();

    expect(controller.getSnapshot().projectionDialog).toBeNull();
    controller.dispose();
  });

  for (const incoming of [
    { label: 'lower revision', revision: 2 },
    { label: 'equal revision', revision: 3 },
  ] as const) {
    test(`keeps a company dialog and its action across a ${incoming.label} raw Replace`, async () => {
      const companyFact = {
        ...fact(`fact-company-retained-${incoming.revision}`, 3),
        domain: KnowledgeFactDomain.CompanySummary,
      };
      const staleRawFact: KnowledgeFactSummary = {
        ...companyFact,
        revision: incoming.revision,
        domain: KnowledgeFactDomain.ProductList,
        reviewStatus: KnowledgeFactReviewStatus.Confirmed,
        projectionState: KnowledgeFactProjectionState.Active,
        archivedAt: '2026-07-14T01:00:00.000Z',
      };
      let currentRows: KnowledgeFactSummary[] = [companyFact];
      const replacement = deferred<KnowledgeFactReviewResult>();
      const reviewFact = vi
        .fn()
        .mockRejectedValueOnce(
          new KnowledgeBaseServiceError(
            KnowledgeBaseErrorCode.FactProjectionConflict,
            {
              projectionConflict: projectionConflict({
                factId: companyFact.id,
                factRevision: companyFact.revision,
              }),
            },
          ),
        )
        .mockImplementationOnce(() => replacement.promise);
      const controller = createMutationController({
        listFacts: vi.fn(async () => result([...currentRows], null, metrics(1))),
        reviewFact,
      });
      await controller.start();
      await controller.reviewFact(
        companyFact,
        KnowledgeFactReviewDecision.Confirm,
      );
      const ownedDialog = controller.getSnapshot().projectionDialog;

      currentRows = [staleRawFact];
      await controller.refreshAfterMutation();

      expect(controller.getSnapshot().facts).toEqual([companyFact]);
      expect(controller.getSnapshot().projectionDialog).toEqual(ownedDialog);
      void controller.resolveCompanyReplacement();
      await flushMicrotasks();
      expect(reviewFact).toHaveBeenCalledTimes(2);
      expect(reviewFact.mock.calls[1][0]).toEqual({
        factId: companyFact.id,
        expectedRevision: companyFact.revision,
        decision: KnowledgeFactReviewDecision.Confirm,
        replaceExisting: true,
        expectedFieldRevision: 11,
      });
      controller.dispose();
    });
  }

  test('rejects unsafe revisions and malformed mutation response structures as JobStateConflict', async () => {
    const currentFact = fact('fact-a', 1);
    const malformedResults = [
      {},
      { fact: null, profileChanged: false, profileRevision: null, fieldRevision: null },
      reviewResult({ ...currentFact, revision: Number.NaN }),
      reviewResult({ ...currentFact, revision: Number.MAX_SAFE_INTEGER + 1 }),
      reviewResult({ ...currentFact, revision: 2 }, {
        profileChanged: true,
        profileRevision: null,
      }),
      reviewResult({
        ...currentFact,
        domain: KnowledgeFactDomain.SellingPoints,
        revision: 2,
      }),
    ];
    const reviewFact = vi.fn();
    for (const malformed of malformedResults) {
      reviewFact.mockResolvedValueOnce(malformed);
    }
    const controller = createMutationController({
      initialFacts: [currentFact],
      reviewFact: reviewFact as never,
    });
    await controller.start();

    for (const _malformed of malformedResults) {
      await controller.reviewFact(currentFact, KnowledgeFactReviewDecision.Reject);
      expect(controller.getSnapshot().mutationFeedback[currentFact.id]?.errorCode).toBe(
        KnowledgeBaseErrorCode.JobStateConflict,
      );
    }

    const unsafeFact = fact('unsafe-fact', Number.MAX_SAFE_INTEGER + 1);
    const unsafeReview = vi.fn();
    const unsafeController = createMutationController({
      initialFacts: [unsafeFact],
      reviewFact: unsafeReview as never,
    });
    await unsafeController.start();
    await unsafeController.reviewFact(unsafeFact, KnowledgeFactReviewDecision.Reject);
    expect(unsafeReview).not.toHaveBeenCalled();
    unsafeController.dispose();
    controller.dispose();
  });

  test('does not refresh the current filter for an old-generation JobStateConflict', async () => {
    const currentFact = fact('fact-a', 1);
    const failure = deferred<KnowledgeFactReviewResult>();
    const listFacts = vi.fn(async () => result([currentFact], null, metrics(1)));
    const controller = createMutationController({
      listFacts,
      reviewFact: vi.fn(() => failure.promise),
    });
    await controller.start();

    const mutation = controller.reviewFact(
      currentFact,
      KnowledgeFactReviewDecision.Reject,
    );
    await flushMicrotasks();
    await controller.setView(KnowledgeFactListView.History);
    failure.reject(
      new KnowledgeBaseServiceError(KnowledgeBaseErrorCode.JobStateConflict),
    );
    await mutation;

    expect(listFacts).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().mutationFeedback).toEqual({});
    controller.dispose();
  });

  test('does not append an old mutation refresh after failure publish synchronously switches filter generation', async () => {
    const currentFact = fact('fact-a', 1);
    const failure = deferred<KnowledgeFactReviewResult>();
    const currentFilterPage = deferred<KnowledgeFactListResult>();
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(result([currentFact], null, metrics(1)))
      .mockImplementationOnce(() => currentFilterPage.promise)
      .mockResolvedValue(result([currentFact], null, metrics(3)));
    const controller = createMutationController({
      listFacts,
      reviewFact: vi.fn(() => failure.promise),
    });
    await controller.start();
    let filterSwitch: Promise<void> | null = null;
    let switched = false;
    const unsubscribe = controller.subscribe(() => {
      if (
        !switched &&
        controller.getSnapshot().mutationFeedback['fact-a']?.errorCode ===
          KnowledgeBaseErrorCode.JobStateConflict
      ) {
        switched = true;
        filterSwitch = controller.setView(KnowledgeFactListView.History);
      }
    });

    const mutation = controller.reviewFact(
      currentFact,
      KnowledgeFactReviewDecision.Reject,
    );
    await flushMicrotasks();
    failure.reject(
      new KnowledgeBaseServiceError(KnowledgeBaseErrorCode.JobStateConflict),
    );
    await flushMicrotasks();

    expect(switched).toBe(true);
    expect(listFacts).toHaveBeenCalledTimes(2);
    currentFilterPage.resolve(result([currentFact], null, metrics(2)));
    await Promise.all([mutation, filterSwitch as unknown as Promise<void>]);
    await flushMicrotasks();
    expect(listFacts).toHaveBeenCalledTimes(2);
    expect(listFacts.mock.calls[1][0].view).toBe(KnowledgeFactListView.History);
    unsubscribe();
    controller.dispose();
  });

  test('turns JobStateConflict into one trailing Replace and clears projection state', async () => {
    const listFacts = vi.fn(async (_request: KnowledgeListFactsRequest) =>
      result([fact('fact-a', 1)], null, metrics(1)),
    );
    const reviewFact = vi.fn(async () => {
      throw new KnowledgeBaseServiceError(KnowledgeBaseErrorCode.JobStateConflict);
    });
    const controller = createMutationController({ listFacts, reviewFact });
    await controller.start();

    await controller.reviewFact(fact('fact-a', 1), KnowledgeFactReviewDecision.Confirm);

    expect(listFacts).toHaveBeenCalledTimes(2);
    expect(listFacts.mock.calls[1][0]).not.toHaveProperty('cursor');
    expect(controller.getSnapshot().projectionDialog).toBeNull();
    expect(controller.getSnapshot().mutationFeedback['fact-a']?.errorCode).toBe(
      KnowledgeBaseErrorCode.JobStateConflict,
    );
    controller.dispose();
  });

  test('keeps Archive success announced after row removal and clears it on context change', async () => {
    const confirmed = {
      ...fact('fact-archive-success', 1),
      reviewStatus: KnowledgeFactReviewStatus.Confirmed,
      projectionState: KnowledgeFactProjectionState.Active,
    };
    let listInvocation = 0;
    const listFacts = vi.fn(async () =>
      result(listInvocation++ === 0 ? [confirmed] : [], null, metrics(1)),
    );
    const controller = createMutationController({
      listFacts,
      archiveFact: vi.fn(async () =>
        reviewResult({
          ...confirmed,
          revision: 2,
          archivedAt: '2026-07-14T00:00:00.000Z',
        }),
      ),
    });
    await controller.start();

    await controller.archiveFact(confirmed);

    expect(controller.getSnapshot().facts).toEqual([]);
    expect(controller.getSnapshot().mutationAnnouncement).toEqual({
      status: 'succeeded',
      generation: 1,
    });
    await controller.updateContext({
      workspaceId: 'workspace-b',
      profileRevision: 1,
      profile: profile(),
    });
    expect(controller.getSnapshot().mutationAnnouncement).toBeNull();
    controller.dispose();
  });

  test('assigns a distinct live announcement generation to each accepted concurrent fact success', async () => {
    const factA = fact('fact-a', 1);
    const factB = fact('fact-b', 1);
    const resultA = deferred<KnowledgeFactReviewResult>();
    const resultB = deferred<KnowledgeFactReviewResult>();
    const listFacts = vi.fn(async () =>
      result([factA, factB], null, metrics(2)),
    );
    const reviewFact = vi.fn((input: Record<string, unknown>) =>
      input.factId === factA.id ? resultA.promise : resultB.promise,
    );
    const controller = createMutationController({ listFacts, reviewFact });
    await controller.start();
    const acceptedGenerations = new Set<number>();
    const unsubscribe = controller.subscribe(() => {
      const generation = controller.getSnapshot().mutationAnnouncement?.generation;
      if (typeof generation === 'number') {
        acceptedGenerations.add(generation);
      }
    });

    const first = controller.reviewFact(
      factA,
      KnowledgeFactReviewDecision.Confirm,
    );
    const second = controller.reviewFact(
      factB,
      KnowledgeFactReviewDecision.Reject,
    );
    await flushMicrotasks();
    resultA.resolve(reviewResult({ ...factA, revision: 2 }));
    await first;
    resultB.resolve(reviewResult({ ...factB, revision: 2 }));
    await second;

    expect([...acceptedGenerations]).toEqual([1, 2]);
    unsubscribe();
    controller.dispose();
  });

  test('settles a sibling success while the first mutation Replace is still pending', async () => {
    const factA = fact('fact-a', 1);
    const factB = fact('fact-b', 1);
    const mutationA = deferred<KnowledgeFactReviewResult>();
    const mutationB = deferred<KnowledgeFactReviewResult>();
    const trailingReplace = deferred<KnowledgeFactListResult>();
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(result([factA, factB], null, metrics(1)))
      .mockImplementationOnce(() => trailingReplace.promise)
      .mockResolvedValueOnce(
        result(
          [
            { ...factA, revision: 2 },
            { ...factB, revision: 2 },
          ],
          null,
          metrics(3),
        ),
      );
    const reviewFact = vi.fn((input: Record<string, unknown>) =>
      input.factId === factA.id ? mutationA.promise : mutationB.promise,
    );
    const controller = createMutationController({ listFacts, reviewFact });
    await controller.start();
    const announcementGenerations: number[] = [];
    let lastAnnouncementGeneration = 0;
    const unsubscribe = controller.subscribe(() => {
      const generation = controller.getSnapshot().mutationAnnouncement?.generation ?? 0;
      if (generation > lastAnnouncementGeneration) {
        lastAnnouncementGeneration = generation;
        announcementGenerations.push(generation);
      }
    });

    const first = controller.reviewFact(factA, KnowledgeFactReviewDecision.Reject);
    const sibling = controller.reviewFact(factB, KnowledgeFactReviewDecision.Reject);
    await flushMicrotasks();
    mutationA.resolve(reviewResult({ ...factA, revision: 2 }));
    await flushMicrotasks();
    const firstReplaceWasPending = listFacts.mock.calls.length === 2;

    mutationB.resolve(reviewResult({ ...factB, revision: 2 }));
    await flushMicrotasks();
    const siblingFeedbackBeforeReplace =
      controller.getSnapshot().mutationFeedback[factB.id];
    const announcementsBeforeReplace = [...announcementGenerations];

    trailingReplace.resolve(
      result(
        [
          { ...factA, revision: 2 },
          { ...factB, revision: 2 },
        ],
        null,
        metrics(2),
      ),
    );
    await Promise.all([first, sibling]);

    expect(firstReplaceWasPending).toBe(true);
    expect(siblingFeedbackBeforeReplace).toEqual({
      status: 'succeeded',
      errorCode: null,
    });
    expect(announcementsBeforeReplace).toEqual([1, 2]);
    expect(listFacts).toHaveBeenCalledTimes(3);
    unsubscribe();
    controller.dispose();
  });

  test('keeps a sibling ordinary failure while the first mutation Replace is still pending', async () => {
    const factA = fact('fact-a', 1);
    const factB = fact('fact-b', 1);
    const mutationA = deferred<KnowledgeFactReviewResult>();
    const mutationB = deferred<KnowledgeFactReviewResult>();
    const trailingReplace = deferred<KnowledgeFactListResult>();
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(result([factA, factB], null, metrics(1)))
      .mockImplementationOnce(() => trailingReplace.promise);
    const reviewFact = vi.fn((input: Record<string, unknown>) =>
      input.factId === factA.id ? mutationA.promise : mutationB.promise,
    );
    const controller = createMutationController({ listFacts, reviewFact });
    await controller.start();

    const first = controller.reviewFact(factA, KnowledgeFactReviewDecision.Reject);
    const sibling = controller.reviewFact(factB, KnowledgeFactReviewDecision.Reject);
    await flushMicrotasks();
    mutationA.resolve(reviewResult({ ...factA, revision: 2 }));
    await flushMicrotasks();
    const firstReplaceWasPending = listFacts.mock.calls.length === 2;

    mutationB.reject(new Error('private sibling stack and path'));
    await flushMicrotasks();
    const siblingFeedbackBeforeReplace =
      controller.getSnapshot().mutationFeedback[factB.id];

    trailingReplace.resolve(
      result([{ ...factA, revision: 2 }, factB], null, metrics(2)),
    );
    await Promise.all([first, sibling]);

    expect(firstReplaceWasPending).toBe(true);
    expect(siblingFeedbackBeforeReplace).toEqual({
      status: 'failed',
      errorCode: KnowledgeBaseErrorCode.PersistenceFailed,
    });
    expect(controller.getSnapshot().mutationFeedback[factB.id]).toEqual(
      siblingFeedbackBeforeReplace,
    );
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('private sibling');
    expect(listFacts).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  test('opens a sibling typed projection conflict while the first mutation Replace is still pending', async () => {
    const factA = fact('fact-a', 1);
    const factB = {
      ...fact('fact-company', 3),
      domain: KnowledgeFactDomain.CompanySummary,
    };
    const mutationA = deferred<KnowledgeFactReviewResult>();
    const mutationB = deferred<KnowledgeFactReviewResult>();
    const trailingReplace = deferred<KnowledgeFactListResult>();
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(result([factA, factB], null, metrics(1)))
      .mockImplementationOnce(() => trailingReplace.promise);
    const reviewFact = vi.fn((input: Record<string, unknown>) =>
      input.factId === factA.id ? mutationA.promise : mutationB.promise,
    );
    const controller = createMutationController({ listFacts, reviewFact });
    await controller.start();

    const first = controller.reviewFact(factA, KnowledgeFactReviewDecision.Reject);
    const sibling = controller.reviewFact(factB, KnowledgeFactReviewDecision.Confirm);
    await flushMicrotasks();
    mutationA.resolve(reviewResult({ ...factA, revision: 2 }));
    await flushMicrotasks();
    const firstReplaceWasPending = listFacts.mock.calls.length === 2;

    mutationB.reject(
      new KnowledgeBaseServiceError(
        KnowledgeBaseErrorCode.FactProjectionConflict,
        {
          projectionConflict: projectionConflict({
            factId: factB.id,
            factRevision: factB.revision,
          }),
        },
      ),
    );
    await flushMicrotasks();
    const dialogBeforeReplace = controller.getSnapshot().projectionDialog;

    trailingReplace.resolve(
      result([{ ...factA, revision: 2 }, factB], null, metrics(2)),
    );
    await Promise.all([first, sibling]);

    expect(firstReplaceWasPending).toBe(true);
    expect(dialogBeforeReplace).toMatchObject({
      kind: 'company_replacement',
      factId: factB.id,
      factRevision: factB.revision,
      errorCode: null,
    });
    expect(controller.getSnapshot().mutationFeedback[factB.id]).toEqual({
      status: 'failed',
      errorCode: KnowledgeBaseErrorCode.FactProjectionConflict,
    });
    expect(listFacts).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  test('normalizes an unknown runtime service error code to fixed generic feedback', async () => {
    const currentFact = fact('fact-unknown-error-code', 1);
    const privateCode = 'sqlite:///private/path stack SELECT secret';
    const controller = createMutationController({
      initialFacts: [currentFact],
      reviewFact: vi.fn(async () => {
        throw new KnowledgeBaseServiceError(privateCode as never);
      }),
    });
    await controller.start();

    await controller.reviewFact(
      currentFact,
      KnowledgeFactReviewDecision.Reject,
    );

    expect(controller.getSnapshot().mutationFeedback[currentFact.id]).toEqual({
      status: 'failed',
      errorCode: KnowledgeBaseErrorCode.PersistenceFailed,
    });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(privateCode);
    controller.dispose();
  });
});

describe('workspace AI knowledge evidence Promise ownership', () => {
  type EvidenceController = ReturnType<typeof createWorkspaceAiKnowledgeController> & {
    expandEvidence: (currentFact: KnowledgeFactSummary) => Promise<void>;
    collapseEvidence: () => void;
    loadMoreEvidence: () => Promise<void>;
    retryEvidence: () => Promise<void>;
    getSnapshot: () => ReturnType<
      ReturnType<typeof createWorkspaceAiKnowledgeController>['getSnapshot']
    > & {
      evidence: {
        expandedFactId: string | null;
        factRevision: number | null;
        items: KnowledgeFactEvidenceSummary[];
        nextCursor: string | null;
        isLoading: boolean;
      };
      evidenceErrorCode: string | null;
      evidenceHasLoadedFirstPage: boolean;
    };
  };

  const evidenceItem = (
    id: string,
    factId = 'fact-a',
  ): KnowledgeFactEvidenceSummary => ({
    id,
    factId,
    documentId: `document-${id}`,
    documentVersionId: `version-${id}`,
    documentDisplayName: `${id}.pdf`,
    quote: `quote-${id}`,
    confidence: 0.9,
    stale: false,
    createdAt: '2026-07-13T00:00:00.000Z',
  });

  const createEvidenceController = (options: {
    getFactEvidence: (input: Record<string, unknown>) => Promise<KnowledgeFactEvidencePageResult>;
    initialFacts?: KnowledgeFactSummary[];
    listFacts?: (input: KnowledgeListFactsRequest) => Promise<KnowledgeFactListResult>;
    reviewFact?: (input: Record<string, unknown>) => Promise<KnowledgeFactReviewResult>;
  }): EvidenceController =>
    createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: {
        listFacts:
          options.listFacts ??
          vi.fn(async () => result(options.initialFacts ?? [], null, metrics(1))),
        listDocuments: vi.fn(async () => []),
        reviewFact:
          options.reviewFact ??
          vi.fn(async input =>
            reviewResult(fact(String(input.factId), Number(input.expectedRevision) + 1)),
          ),
        archiveFact: vi.fn(),
        getFactEvidence: options.getFactEvidence,
      } as never,
    }) as EvidenceController;

  test('owns one first page and one captured-cursor Append with reducer ID deduplication', async () => {
    const firstPage = deferred<KnowledgeFactEvidencePageResult>();
    const appendPage = deferred<KnowledgeFactEvidencePageResult>();
    const getFactEvidence = vi
      .fn()
      .mockImplementationOnce(() => firstPage.promise)
      .mockImplementationOnce(() => appendPage.promise);
    const currentFact = fact('fact-a', 3);
    const controller = createEvidenceController({
      initialFacts: [currentFact],
      getFactEvidence,
    });
    await controller.start();
    let nested: Promise<void> | null = null;
    const unsubscribe = controller.subscribe(() => {
      if (!nested && controller.getSnapshot().evidence.isLoading) {
        nested = controller.expandEvidence(currentFact);
      }
    });

    const expansion = controller.expandEvidence(currentFact);
    const repeatedExpansion = controller.expandEvidence(currentFact);
    await flushMicrotasks();
    expect(getFactEvidence).toHaveBeenCalledTimes(1);
    expect(getFactEvidence.mock.calls[0][0]).toEqual({
      factId: 'fact-a',
      expectedRevision: 3,
      limit: KNOWLEDGE_FACT_EVIDENCE_PAGE_DEFAULT_LIMIT,
    });
    firstPage.resolve({
      factId: 'fact-a',
      factRevision: 3,
      items: [evidenceItem('evidence-a'), evidenceItem('evidence-b')],
      nextCursor: 'opaque-cursor-2',
    });
    await Promise.all([expansion, repeatedExpansion, nested as unknown as Promise<void>]);
    expect(controller.getSnapshot().evidenceHasLoadedFirstPage).toBe(true);

    const firstLoadMore = controller.loadMoreEvidence();
    const duplicateLoadMore = controller.loadMoreEvidence();
    await flushMicrotasks();
    expect(getFactEvidence).toHaveBeenCalledTimes(2);
    expect(getFactEvidence.mock.calls[1][0]).toEqual({
      factId: 'fact-a',
      expectedRevision: 3,
      cursor: 'opaque-cursor-2',
      limit: KNOWLEDGE_FACT_EVIDENCE_PAGE_DEFAULT_LIMIT,
    });
    appendPage.resolve({
      factId: 'fact-a',
      factRevision: 3,
      items: [evidenceItem('evidence-b'), evidenceItem('evidence-c')],
      nextCursor: null,
    });
    await Promise.all([firstLoadMore, duplicateLoadMore]);

    expect(controller.getSnapshot().evidence.items.map(item => item.id)).toEqual([
      'evidence-a',
      'evidence-b',
      'evidence-c',
    ]);
    await controller.loadMoreEvidence();
    expect(getFactEvidence).toHaveBeenCalledTimes(2);
    unsubscribe();
    controller.dispose();
  });

  test('treats top-level or item fact mismatch as JobStateConflict and forces one fact Replace', async () => {
    for (const malformed of [
      {
        factId: 'fact-other',
        factRevision: 2,
        items: [evidenceItem('evidence-a')],
        nextCursor: null,
      },
      {
        factId: 'fact-a',
        factRevision: 2,
        items: [evidenceItem('evidence-a', 'fact-other')],
        nextCursor: null,
      },
    ]) {
      const currentFact = fact('fact-a', 2);
      const listFacts = vi.fn(async () => result([currentFact], null, metrics(1)));
      const controller = createEvidenceController({
        listFacts,
        getFactEvidence: vi.fn(async () => malformed),
      });
      await controller.start();
      await controller.expandEvidence(currentFact);

      expect(controller.getSnapshot().evidence.expandedFactId).toBeNull();
      expect(controller.getSnapshot().evidence.items).toEqual([]);
      expect(controller.getSnapshot().evidenceErrorCode).toBe(
        KnowledgeBaseErrorCode.JobStateConflict,
      );
      expect(listFacts).toHaveBeenCalledTimes(2);
      controller.dispose();
    }
  });

  test('does not append an old evidence refresh after failure publish synchronously switches workspace', async () => {
    const workspaceAFact = fact('fact-a', 2);
    const workspaceBFact = fact('fact-b', 1);
    const workspaceBPage = deferred<KnowledgeFactListResult>();
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(result([workspaceAFact], null, metrics(1)))
      .mockImplementationOnce(() => workspaceBPage.promise)
      .mockResolvedValue(result([workspaceBFact], null, metrics(3)));
    const controller = createEvidenceController({
      listFacts,
      getFactEvidence: vi.fn(async () => ({
        factId: 'wrong-fact',
        factRevision: workspaceAFact.revision,
        items: [],
        nextCursor: null,
      })),
    });
    await controller.start();
    let workspaceSwitch: Promise<void> | null = null;
    let switched = false;
    const unsubscribe = controller.subscribe(() => {
      if (
        !switched &&
        controller.getSnapshot().evidenceErrorCode ===
          KnowledgeBaseErrorCode.JobStateConflict
      ) {
        switched = true;
        workspaceSwitch = controller.updateContext({
          workspaceId: 'workspace-b',
          profileRevision: 1,
          profile: profile(),
        });
      }
    });

    const expansion = controller.expandEvidence(workspaceAFact);
    await flushMicrotasks();
    expect(switched).toBe(true);
    expect(listFacts).toHaveBeenCalledTimes(2);
    workspaceBPage.resolve(result([workspaceBFact], null, metrics(2)));
    await Promise.all([expansion, workspaceSwitch as unknown as Promise<void>]);
    await flushMicrotasks();

    expect(listFacts).toHaveBeenCalledTimes(2);
    expect(listFacts.mock.calls[1][0].workspaceId).toBe('workspace-b');
    expect(controller.getSnapshot().workspaceId).toBe('workspace-b');
    unsubscribe();
    controller.dispose();
  });

  test('treats malformed evidence page structures as JobStateConflict instead of an ordinary failure', async () => {
    const malformedPages: unknown[] = [
      { factId: 'fact-a', factRevision: 2, items: null, nextCursor: null },
      { factId: 'fact-a', factRevision: 2, items: [null], nextCursor: null },
      {
        factId: 'fact-a',
        factRevision: 2,
        items: [evidenceItem('evidence-a')],
        nextCursor: 42,
      },
      {
        factId: 'fact-a',
        factRevision: Number.MAX_SAFE_INTEGER + 1,
        items: [],
        nextCursor: null,
      },
      {
        factId: 'fact-a',
        factRevision: 2,
        items: new Array(1),
        nextCursor: null,
      },
      {
        factId: 'fact-a',
        factRevision: 2,
        items: [],
        nextCursor: '',
      },
    ];

    for (const malformed of malformedPages) {
      const currentFact = fact('fact-a', 2);
      const listFacts = vi.fn(async () => result([currentFact], null, metrics(1)));
      const controller = createEvidenceController({
        listFacts,
        getFactEvidence: vi.fn(async () => malformed) as never,
      });
      await controller.start();
      await controller.expandEvidence(currentFact);

      expect(controller.getSnapshot().evidence.expandedFactId).toBeNull();
      expect(controller.getSnapshot().evidenceErrorCode).toBe(
        KnowledgeBaseErrorCode.JobStateConflict,
      );
      expect(listFacts).toHaveBeenCalledTimes(2);
      controller.dispose();
    }
  });

  test('rejects an evidence page whose createdAt contains private diagnostic text', async () => {
    const privateCreatedAt =
      '/Users/private/customer.sqlite SELECT secret\nError: stack at worker.ts:19';
    const currentFact = fact('fact-a', 2);
    const listFacts = vi.fn(async () => result([currentFact], null, metrics(1)));
    const controller = createEvidenceController({
      listFacts,
      getFactEvidence: vi.fn(async () => ({
        factId: currentFact.id,
        factRevision: currentFact.revision,
        items: [
          evidenceItem('unsafe-created-at', currentFact.id),
        ].map(item => ({ ...item, createdAt: privateCreatedAt })),
        nextCursor: null,
      })),
    });
    await controller.start();

    await controller.expandEvidence(currentFact);

    expect(controller.getSnapshot().evidence.items).toEqual([]);
    expect(controller.getSnapshot().evidenceErrorCode).toBe(
      KnowledgeBaseErrorCode.JobStateConflict,
    );
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(privateCreatedAt);
    expect(listFacts).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  test('invalidates collapse settlement and permits immediate re-expansion with a new owner', async () => {
    const oldPage = deferred<KnowledgeFactEvidencePageResult>();
    const currentPage = deferred<KnowledgeFactEvidencePageResult>();
    const getFactEvidence = vi
      .fn()
      .mockImplementationOnce(() => oldPage.promise)
      .mockImplementationOnce(() => currentPage.promise);
    const currentFact = fact('fact-a', 4);
    const controller = createEvidenceController({
      initialFacts: [currentFact],
      getFactEvidence,
    });
    await controller.start();

    const oldExpansion = controller.expandEvidence(currentFact);
    await flushMicrotasks();
    controller.collapseEvidence();
    const currentExpansion = controller.expandEvidence(currentFact);
    await flushMicrotasks();
    expect(getFactEvidence).toHaveBeenCalledTimes(2);

    oldPage.resolve({
      factId: 'fact-a',
      factRevision: 4,
      items: [evidenceItem('old-evidence')],
      nextCursor: null,
    });
    await oldExpansion;
    expect(controller.getSnapshot().evidence.items).toEqual([]);
    currentPage.resolve({
      factId: 'fact-a',
      factRevision: 4,
      items: [evidenceItem('current-evidence')],
      nextCursor: null,
    });
    await currentExpansion;
    expect(controller.getSnapshot().evidence.items.map(item => item.id)).toEqual([
      'current-evidence',
    ]);
    controller.dispose();
  });

  test('invalidates an old evidence owner when an accepted same-generation list changes the fact revision', async () => {
    const oldFact = fact('fact-a', 1);
    const revisedFact = fact('fact-a', 2);
    const listRefresh = deferred<KnowledgeFactListResult>();
    const oldPage = deferred<KnowledgeFactEvidencePageResult>();
    const revisedPage = deferred<KnowledgeFactEvidencePageResult>();
    const listFacts = vi
      .fn()
      .mockResolvedValueOnce(result([oldFact], null, metrics(1)))
      .mockImplementationOnce(() => listRefresh.promise);
    const getFactEvidence = vi
      .fn()
      .mockImplementationOnce(() => oldPage.promise)
      .mockImplementationOnce(() => revisedPage.promise);
    const controller = createEvidenceController({ listFacts, getFactEvidence });
    await controller.start();

    const oldExpansion = controller.expandEvidence(oldFact);
    await flushMicrotasks();
    const refresh = controller.refreshAfterMutation();
    await flushMicrotasks();
    listRefresh.resolve(result([revisedFact], null, metrics(2)));
    await refresh;
    expect(controller.getSnapshot().evidence.expandedFactId).toBeNull();

    const revisedExpansion = controller.expandEvidence(revisedFact);
    await flushMicrotasks();
    expect(getFactEvidence).toHaveBeenCalledTimes(2);
    oldPage.resolve({
      factId: oldFact.id,
      factRevision: oldFact.revision,
      items: [evidenceItem('old-revision-evidence')],
      nextCursor: null,
    });
    await oldExpansion;
    expect(controller.getSnapshot().evidence.items).toEqual([]);
    expect(controller.expandEvidence(revisedFact)).toBe(revisedExpansion);
    expect(getFactEvidence).toHaveBeenCalledTimes(2);

    revisedPage.resolve({
      factId: revisedFact.id,
      factRevision: revisedFact.revision,
      items: [evidenceItem('revised-evidence')],
      nextCursor: null,
    });
    await revisedExpansion;
    expect(controller.getSnapshot().evidence.items.map(item => item.id)).toEqual([
      'revised-evidence',
    ]);
    controller.dispose();
  });

  for (const incoming of [
    { label: 'lower revision', revision: 2 },
    { label: 'equal revision', revision: 3 },
  ] as const) {
    test(`keeps loaded evidence across a ${incoming.label} raw Replace retained by the reducer`, async () => {
      const currentFact = fact(`fact-loaded-retained-${incoming.revision}`, 3);
      const staleRawFact: KnowledgeFactSummary = {
        ...currentFact,
        revision: incoming.revision,
        domain: KnowledgeFactDomain.SellingPoints,
        reviewStatus: KnowledgeFactReviewStatus.Confirmed,
        projectionState: KnowledgeFactProjectionState.Active,
        archivedAt: '2026-07-14T01:00:00.000Z',
      };
      let currentRows: KnowledgeFactSummary[] = [currentFact];
      const getFactEvidence = vi.fn(async () => ({
        factId: currentFact.id,
        factRevision: currentFact.revision,
        items: [evidenceItem('retained-loaded-evidence', currentFact.id)],
        nextCursor: null,
      }));
      const controller = createEvidenceController({
        listFacts: vi.fn(async () => result([...currentRows], null, metrics(1))),
        getFactEvidence,
      });
      await controller.start();
      await controller.expandEvidence(currentFact);

      currentRows = [staleRawFact];
      await controller.refreshAfterMutation();

      expect(controller.getSnapshot().facts).toEqual([currentFact]);
      expect(controller.getSnapshot().evidence.expandedFactId).toBe(currentFact.id);
      expect(controller.getSnapshot().evidence.items.map(item => item.id)).toEqual([
        'retained-loaded-evidence',
      ]);
      expect(controller.getSnapshot().evidenceHasLoadedFirstPage).toBe(true);
      expect(getFactEvidence).toHaveBeenCalledTimes(1);
      controller.dispose();
    });

    test(`keeps in-flight evidence ownership across a ${incoming.label} raw Replace retained by the reducer`, async () => {
      const currentFact = fact(`fact-inflight-retained-${incoming.revision}`, 3);
      const staleRawFact: KnowledgeFactSummary = {
        ...currentFact,
        revision: incoming.revision,
        domain: KnowledgeFactDomain.SellingPoints,
        reviewStatus: KnowledgeFactReviewStatus.Confirmed,
        projectionState: KnowledgeFactProjectionState.Active,
        archivedAt: '2026-07-14T01:00:00.000Z',
      };
      let currentRows: KnowledgeFactSummary[] = [currentFact];
      const page = deferred<KnowledgeFactEvidencePageResult>();
      const getFactEvidence = vi.fn(() => page.promise);
      const controller = createEvidenceController({
        listFacts: vi.fn(async () => result([...currentRows], null, metrics(1))),
        getFactEvidence,
      });
      await controller.start();

      const expansion = controller.expandEvidence(currentFact);
      await flushMicrotasks();
      currentRows = [staleRawFact];
      await controller.refreshAfterMutation();
      const repeatedExpansion = controller.expandEvidence(currentFact);

      expect(controller.getSnapshot().facts).toEqual([currentFact]);
      expect(controller.getSnapshot().evidence.expandedFactId).toBe(currentFact.id);
      expect(controller.getSnapshot().evidence.isLoading).toBe(true);
      expect(repeatedExpansion).toBe(expansion);
      expect(getFactEvidence).toHaveBeenCalledTimes(1);

      page.resolve({
        factId: currentFact.id,
        factRevision: currentFact.revision,
        items: [evidenceItem('retained-inflight-evidence', currentFact.id)],
        nextCursor: null,
      });
      await expansion;
      expect(controller.getSnapshot().evidence.items.map(item => item.id)).toEqual([
        'retained-inflight-evidence',
      ]);
      controller.dispose();
    });
  }

  test('invalidates in-flight evidence when an accepted higher revision changes the expanded fact domain', async () => {
    const oldFact = fact('fact-domain-evidence', 2);
    const changedDomainFact = {
      ...oldFact,
      revision: oldFact.revision + 1,
      domain: KnowledgeFactDomain.SellingPoints,
    };
    let currentRows: KnowledgeFactSummary[] = [oldFact];
    const oldPage = deferred<KnowledgeFactEvidencePageResult>();
    const controller = createEvidenceController({
      listFacts: vi.fn(async () => result([...currentRows], null, metrics(1))),
      getFactEvidence: vi.fn(() => oldPage.promise),
    });
    await controller.start();

    const expansion = controller.expandEvidence(oldFact);
    await flushMicrotasks();
    expect(controller.getSnapshot().evidence.isLoading).toBe(true);
    currentRows = [changedDomainFact];
    await controller.refreshAfterMutation();
    const evidenceAfterDomainChange = controller.getSnapshot().evidence;

    oldPage.resolve({
      factId: oldFact.id,
      factRevision: oldFact.revision,
      items: [evidenceItem('old-domain-evidence', oldFact.id)],
      nextCursor: null,
    });
    await expansion;

    expect(evidenceAfterDomainChange.expandedFactId).toBeNull();
    expect(evidenceAfterDomainChange.items).toEqual([]);
    expect(controller.getSnapshot().evidence.items).toEqual([]);
    controller.dispose();
  });

  test('clears loaded evidence when an accepted higher revision changes the expanded fact domain', async () => {
    const oldFact = fact('fact-loaded-domain-evidence', 2);
    const changedDomainFact = {
      ...oldFact,
      revision: oldFact.revision + 1,
      domain: KnowledgeFactDomain.SellingPoints,
    };
    let currentRows: KnowledgeFactSummary[] = [oldFact];
    const controller = createEvidenceController({
      listFacts: vi.fn(async () => result([...currentRows], null, metrics(1))),
      getFactEvidence: vi.fn(async () => ({
        factId: oldFact.id,
        factRevision: oldFact.revision,
        items: [evidenceItem('loaded-domain-evidence', oldFact.id)],
        nextCursor: null,
      })),
    });
    await controller.start();
    await controller.expandEvidence(oldFact);
    expect(controller.getSnapshot().evidence.items).toHaveLength(1);

    currentRows = [changedDomainFact];
    await controller.refreshAfterMutation();

    expect(controller.getSnapshot().evidence.expandedFactId).toBeNull();
    expect(controller.getSnapshot().evidence.items).toEqual([]);
    expect(controller.getSnapshot().evidenceHasLoadedFirstPage).toBe(false);
    controller.dispose();
  });

  test('rejects a stale displayed-row evidence expansion after an accepted higher-revision domain change', async () => {
    const oldFact = fact('fact-stale-domain-expansion', 2);
    let currentRows: KnowledgeFactSummary[] = [oldFact];
    const getFactEvidence = vi.fn();
    const controller = createEvidenceController({
      listFacts: vi.fn(async () => result([...currentRows], null, metrics(1))),
      getFactEvidence: getFactEvidence as never,
    });
    await controller.start();
    currentRows = [
      {
        ...oldFact,
        revision: oldFact.revision + 1,
        domain: KnowledgeFactDomain.SellingPoints,
      },
    ];
    await controller.refreshAfterMutation();

    await controller.expandEvidence(oldFact);

    expect(getFactEvidence).not.toHaveBeenCalled();
    expect(controller.getSnapshot().evidence.expandedFactId).toBeNull();
    expect(controller.getSnapshot().evidence.items).toEqual([]);
    controller.dispose();
  });

  test('preserves accepted items on ordinary failure and retries an explicit first page', async () => {
    const getFactEvidence = vi
      .fn()
      .mockResolvedValueOnce({
        factId: 'fact-a',
        factRevision: 2,
        items: [evidenceItem('evidence-a')],
        nextCursor: 'cursor-2',
      })
      .mockRejectedValueOnce(new Error('private source path and stack'))
      .mockResolvedValueOnce({
        factId: 'fact-a',
        factRevision: 2,
        items: [evidenceItem('evidence-retried')],
        nextCursor: null,
      });
    const currentFact = fact('fact-a', 2);
    const controller = createEvidenceController({
      initialFacts: [currentFact],
      getFactEvidence,
    });
    await controller.start();
    await controller.expandEvidence(currentFact);

    await controller.loadMoreEvidence();
    expect(controller.getSnapshot().evidence.items.map(item => item.id)).toEqual([
      'evidence-a',
    ]);
    expect(controller.getSnapshot().evidenceErrorCode).toBe(
      KnowledgeBaseErrorCode.PersistenceFailed,
    );
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('private source');

    await controller.retryEvidence();
    expect(getFactEvidence.mock.calls[2][0]).toEqual({
      factId: 'fact-a',
      expectedRevision: 2,
      limit: KNOWLEDGE_FACT_EVIDENCE_PAGE_DEFAULT_LIMIT,
    });
    expect(controller.getSnapshot().evidence.items.map(item => item.id)).toEqual([
      'evidence-retried',
    ]);
    expect(controller.getSnapshot().evidenceErrorCode).toBeNull();
    controller.dispose();
  });

  test('clears evidence on context changes, same-fact mutation, and dispose but preserves it for another fact', async () => {
    const factA = fact('fact-a', 1);
    const factB = fact('fact-b', 1);
    const listFacts = vi.fn(async () => result([factA, factB], null, metrics(1)));
    const controller = createEvidenceController({
      listFacts,
      getFactEvidence: vi.fn(async () => ({
        factId: 'fact-a',
        factRevision: 1,
        items: [evidenceItem('evidence-a')],
        nextCursor: null,
      })),
    });
    await controller.start();
    await controller.expandEvidence(factA);

    await (controller as unknown as {
      reviewFact: (
        currentFact: KnowledgeFactSummary,
        decision: typeof KnowledgeFactReviewDecision.Confirm,
      ) => Promise<void>;
    }).reviewFact(factB, KnowledgeFactReviewDecision.Confirm);
    expect(controller.getSnapshot().evidence.expandedFactId).toBe('fact-a');
    expect(controller.getSnapshot().evidence.items).toHaveLength(1);

    await (controller as unknown as {
      reviewFact: (
        currentFact: KnowledgeFactSummary,
        decision: typeof KnowledgeFactReviewDecision.Confirm,
      ) => Promise<void>;
    }).reviewFact(factA, KnowledgeFactReviewDecision.Confirm);
    expect(controller.getSnapshot().evidence.expandedFactId).toBeNull();

    await controller.expandEvidence(factA);
    await controller.setEvidenceState(KnowledgeFactEvidenceState.Stale);
    expect(controller.getSnapshot().evidence.expandedFactId).toBeNull();
    await controller.expandEvidence(factA);
    await controller.updateContext({
      workspaceId: 'workspace-a',
      profileRevision: 2,
      profile: profile(),
    });
    expect(controller.getSnapshot().evidence.expandedFactId).toBeNull();
    await controller.expandEvidence(factA);
    controller.dispose();
    expect(controller.getSnapshot().evidence.expandedFactId).toBeNull();
  });
});

describe('review-required transition collection', () => {
  test('coalesces one transition per response and supports leave then re-entry', () => {
    const collector = createWorkspaceReviewRequiredTransitionCollector();

    expect(
      collector.collect([
        {
          requestId: 'request-a',
          status: KnowledgeEnrichmentStatus.ReviewRequired,
        },
        {
          requestId: 'request-b',
          status: KnowledgeEnrichmentStatus.ReviewRequired,
        },
      ]),
    ).toBe(true);
    expect(
      collector.collect([
        {
          requestId: 'request-a',
          status: KnowledgeEnrichmentStatus.ReviewRequired,
        },
        {
          requestId: 'request-b',
          status: KnowledgeEnrichmentStatus.ReviewRequired,
        },
      ]),
    ).toBe(false);
    expect(
      collector.collect([
        { requestId: 'request-a', status: KnowledgeEnrichmentStatus.Completed },
      ]),
    ).toBe(false);
    expect(
      collector.collect([
        {
          requestId: 'request-a',
          status: KnowledgeEnrichmentStatus.ReviewRequired,
        },
      ]),
    ).toBe(true);

    collector.reset();
    expect(
      collector.collect([
        {
          requestId: 'request-a',
          status: KnowledgeEnrichmentStatus.ReviewRequired,
        },
      ]),
    ).toBe(true);
  });
});

describe('workspace AI knowledge document polling', () => {
  test('publishes polling ownership before invoking either visibility service call', async () => {
    const listDocuments = vi.fn(async () => []);
    const polling = createWorkspaceAiKnowledgeDocumentPollingController({
      workspaceId: 'workspace-a',
      listDocuments,
      onReviewRequired: vi.fn(),
    });

    const started = polling.start();

    expect(listDocuments).not.toHaveBeenCalled();
    await started;
    expect(listDocuments).toHaveBeenCalledTimes(2);
    polling.dispose();
  });

  test('serializes a synchronous polling-service workspace re-entry', async () => {
    let polling!: ReturnType<typeof createWorkspaceAiKnowledgeDocumentPollingController>;
    let workspaceChange: Promise<void> | null = null;
    const activeWorkspaces = new Map<string, number>();
    let maximumActiveWorkspaceCount = 0;
    let invocation = 0;
    const listDocuments = vi.fn(
      (workspaceId: string, _visibility: KnowledgeDocumentVisibility) => {
        invocation += 1;
        activeWorkspaces.set(workspaceId, (activeWorkspaces.get(workspaceId) ?? 0) + 1);
        maximumActiveWorkspaceCount = Math.max(
          maximumActiveWorkspaceCount,
          activeWorkspaces.size,
        );
        if (invocation === 1) {
          workspaceChange = polling.updateWorkspace('workspace-b');
        }
        return Promise.resolve().then(() => {
          const remaining = (activeWorkspaces.get(workspaceId) ?? 1) - 1;
          if (remaining === 0) {
            activeWorkspaces.delete(workspaceId);
          } else {
            activeWorkspaces.set(workspaceId, remaining);
          }
          return [];
        });
      },
    );
    polling = createWorkspaceAiKnowledgeDocumentPollingController({
      workspaceId: 'workspace-a',
      listDocuments,
      onReviewRequired: vi.fn(),
    });

    await polling.start();
    await workspaceChange;

    expect(maximumActiveWorkspaceCount).toBe(1);
    expect(
      listDocuments.mock.calls.map(([workspaceId]) => workspaceId),
    ).toEqual([
      'workspace-a',
      'workspace-a',
      'workspace-b',
      'workspace-b',
    ]);
    polling.dispose();
  });

  test('settles a synchronous polling-service throw and accepts a later complete pair', async () => {
    const recovered = documentItem({ id: 'document-recovered' });
    let throwActive = true;
    const listDocuments = vi.fn(
      (_workspaceId: string, visibility: KnowledgeDocumentVisibility) => {
        if (visibility === KnowledgeDocumentVisibility.Active && throwActive) {
          throwActive = false;
          throw new Error('private sync diagnostic');
        }
        return Promise.resolve(
          visibility === KnowledgeDocumentVisibility.Active ? [recovered] : [],
        );
      },
    );
    const polling = createWorkspaceAiKnowledgeDocumentPollingController({
      workspaceId: 'workspace-a',
      listDocuments,
      onReviewRequired: vi.fn(),
      intervalMs: 60_000,
    });

    await polling.start();
    await polling.refresh();

    expect(
      listDocuments.mock.calls.filter(
        ([, visibility]) => visibility === KnowledgeDocumentVisibility.Active,
      ),
    ).toHaveLength(2);
    expect(polling.getDocuments().map(document => document.id)).toEqual([
      'document-recovered',
    ]);
    polling.dispose();
  });

  test('deduplicates Active and Deleted overlap by document revision then safe time without mutation', () => {
    const lowerRevision = documentItem({
      id: 'document-a',
      revision: 1,
      updatedAt: '2026-07-13T04:00:00.000Z',
    });
    const higherRevision = documentItem({
      id: 'document-a',
      revision: 2,
      updatedAt: '2026-07-13T03:00:00.000Z',
      deletedAt: '2026-07-13T03:00:00.000Z',
    });
    const earlierTie = documentItem({
      id: 'document-b',
      revision: 3,
      updatedAt: '2026-07-13T02:00:00.000Z',
    });
    const laterTie = documentItem({
      id: 'document-b',
      revision: 3,
      updatedAt: '2026-07-13T05:00:00.000Z',
      deletedAt: '2026-07-13T05:00:00.000Z',
    });
    const activeExactTie = documentItem({
      id: 'document-c',
      revision: 5,
      createdAt: '2026-07-13T01:00:00.000Z',
      updatedAt: '2026-07-13T05:00:00.000Z',
    });
    const deletedExactTie = documentItem({
      id: 'document-c',
      revision: 5,
      createdAt: '2026-07-13T06:00:00.000Z',
      updatedAt: '2026-07-13T05:00:00.000Z',
      deletedAt: '2026-07-13T05:00:00.000Z',
    });
    const frozen = deepFreeze([
      lowerRevision,
      earlierTie,
      activeExactTie,
      higherRevision,
      laterTie,
      deletedExactTie,
    ]);
    const snapshot = JSON.stringify(frozen);

    const deduplicated = deduplicateWorkspaceKnowledgeDocuments(frozen);

    expect(deduplicated).toEqual([higherRevision, laterTie, activeExactTie]);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  test('loads Active and Deleted, merges before current-version transition collection, and coalesces refreshes', async () => {
    const activeCycles: KnowledgeDocumentListItem[][] = [
      [
        documentItem({
          revision: 4,
          enrichment: enrichment(KnowledgeEnrichmentStatus.Running, {
            requestId: 'request-current',
            revision: 3,
            updatedAt: '2026-07-13T05:00:00.000Z',
          }),
        }),
      ],
      [
        documentItem({
          revision: 4,
          updatedAt: '2026-07-13T06:00:00.000Z',
          enrichment: enrichment(KnowledgeEnrichmentStatus.Completed, {
            requestId: 'request-old',
            revision: 9,
            updatedAt: '2026-07-13T04:00:00.000Z',
          }),
        }),
      ],
      [
        documentItem({
          revision: 4,
          enrichment: enrichment(KnowledgeEnrichmentStatus.ReviewRequired, {
            requestId: 'request-current',
            revision: 4,
            updatedAt: '2026-07-13T06:00:00.000Z',
          }),
        }),
      ],
      [
        documentItem({
          revision: 4,
          enrichment: enrichment(KnowledgeEnrichmentStatus.ReviewRequired, {
            requestId: 'request-current',
            revision: 4,
            updatedAt: '2026-07-13T06:00:00.000Z',
          }),
        }),
      ],
      [
        documentItem({
          revision: 4,
          enrichment: enrichment(KnowledgeEnrichmentStatus.Running, {
            requestId: 'request-current',
            revision: 5,
            updatedAt: '2026-07-13T07:00:00.000Z',
          }),
        }),
      ],
      [
        documentItem({
          revision: 4,
          enrichment: enrichment(KnowledgeEnrichmentStatus.ReviewRequired, {
            requestId: 'request-current',
            revision: 6,
            updatedAt: '2026-07-13T08:00:00.000Z',
          }),
        }),
      ],
    ];
    const deletedReview = documentItem({
      id: 'document-b',
      displayName: 'document-b.pdf',
      currentVersionId: 'version-b',
      deletedAt: '2026-07-13T02:00:00.000Z',
      enrichment: enrichment(KnowledgeEnrichmentStatus.ReviewRequired, {
        requestId: 'request-b',
        documentId: 'document-b',
        documentVersionId: 'version-b',
      }),
    });
    const oldVersionReview = documentItem({
      id: 'document-c',
      currentVersionId: 'version-c-current',
      deletedAt: '2026-07-13T02:00:00.000Z',
      enrichment: enrichment(KnowledgeEnrichmentStatus.ReviewRequired, {
        requestId: 'request-old-version',
        documentId: 'document-c',
        documentVersionId: 'version-c-old',
      }),
    });
    const deletedCycles = [
      [deletedReview, oldVersionReview],
      [deletedReview, oldVersionReview],
      [deletedReview, oldVersionReview],
      [deletedReview, oldVersionReview],
      [deletedReview, oldVersionReview],
      [deletedReview, oldVersionReview],
    ];
    let activeCycle = 0;
    let deletedCycle = 0;
    const listDocuments = vi.fn(
      async (_workspaceId: string, visibility: KnowledgeDocumentVisibility) =>
        visibility === KnowledgeDocumentVisibility.Active
          ? activeCycles[activeCycle++]
          : deletedCycles[deletedCycle++],
    );
    const onReviewRequired = vi.fn();
    const polling = createWorkspaceAiKnowledgeDocumentPollingController({
      workspaceId: 'workspace-a',
      listDocuments,
      onReviewRequired,
      intervalMs: 60_000,
    });

    await polling.start();
    expect(listDocuments).toHaveBeenNthCalledWith(
      1,
      'workspace-a',
      KnowledgeDocumentVisibility.Active,
    );
    expect(listDocuments).toHaveBeenNthCalledWith(
      2,
      'workspace-a',
      KnowledgeDocumentVisibility.Deleted,
    );
    expect(onReviewRequired).toHaveBeenCalledTimes(1);

    await polling.refresh();
    expect(
      polling.getDocuments().find(document => document.id === 'document-a')?.enrichment?.status,
    ).toBe(KnowledgeEnrichmentStatus.Running);
    expect(onReviewRequired).toHaveBeenCalledTimes(1);

    await polling.refresh();
    expect(
      polling.getDocuments().find(document => document.id === 'document-a')?.enrichment?.status,
    ).toBe(KnowledgeEnrichmentStatus.ReviewRequired);
    expect(onReviewRequired).toHaveBeenCalledTimes(2);
    expect(new Set(polling.getDocuments().map(document => document.id)).size).toBe(
      polling.getDocuments().length,
    );

    await polling.refresh();
    expect(onReviewRequired).toHaveBeenCalledTimes(2);
    await polling.refresh();
    expect(
      polling.getDocuments().find(document => document.id === 'document-a')?.enrichment?.status,
    ).toBe(KnowledgeEnrichmentStatus.Running);
    expect(onReviewRequired).toHaveBeenCalledTimes(2);
    await polling.refresh();
    expect(onReviewRequired).toHaveBeenCalledTimes(3);
    polling.dispose();
  });

  test('invalidates an in-flight workspace, resets transition memory only for the new workspace, and ignores same workspace updates', async () => {
    const oldActive = deferred<KnowledgeDocumentListItem[]>();
    const oldDeleted = deferred<KnowledgeDocumentListItem[]>();
    const currentActive = deferred<KnowledgeDocumentListItem[]>();
    const currentDeleted = deferred<KnowledgeDocumentListItem[]>();
    const review = documentItem({
      enrichment: enrichment(KnowledgeEnrichmentStatus.ReviewRequired, {
        requestId: 'request-shared',
      }),
    });
    const listDocuments = vi.fn(
      (workspaceId: string, visibility: KnowledgeDocumentVisibility) => {
        if (workspaceId === 'workspace-a') {
          return visibility === KnowledgeDocumentVisibility.Active
            ? oldActive.promise
            : oldDeleted.promise;
        }
        if (workspaceId === 'workspace-b') {
          return visibility === KnowledgeDocumentVisibility.Active
            ? currentActive.promise
            : currentDeleted.promise;
        }
        return Promise.resolve(
          visibility === KnowledgeDocumentVisibility.Active ? [review] : [],
        );
      },
    );
    const onReviewRequired = vi.fn();
    const polling = createWorkspaceAiKnowledgeDocumentPollingController({
      workspaceId: 'workspace-a',
      listDocuments,
      onReviewRequired,
      intervalMs: 60_000,
    });

    const start = polling.start();
    await flushMicrotasks();
    const changeWorkspace = polling.updateWorkspace('workspace-b');
    expect(listDocuments).toHaveBeenCalledTimes(2);

    oldActive.resolve([review]);
    oldDeleted.resolve([]);
    await flushMicrotasks();
    expect(onReviewRequired).not.toHaveBeenCalled();
    expect(listDocuments).toHaveBeenCalledTimes(4);
    expect(listDocuments).toHaveBeenNthCalledWith(
      3,
      'workspace-b',
      KnowledgeDocumentVisibility.Active,
    );

    currentActive.resolve([review]);
    currentDeleted.resolve([]);
    await Promise.all([start, changeWorkspace]);
    expect(onReviewRequired).toHaveBeenCalledTimes(1);

    await polling.updateWorkspace('workspace-b');
    expect(listDocuments).toHaveBeenCalledTimes(4);
    await polling.refresh();
    expect(onReviewRequired).toHaveBeenCalledTimes(1);

    await polling.updateWorkspace('workspace-c');
    expect(onReviewRequired).toHaveBeenCalledTimes(2);
    polling.dispose();
  });

  test('retries an initial partial visibility failure and observes the recovered ReviewRequired state', async () => {
    vi.useFakeTimers();
    const review = documentItem({
      enrichment: enrichment(KnowledgeEnrichmentStatus.ReviewRequired),
    });
    let activeAttempt = 0;
    const listDocuments = vi.fn(
      (_workspaceId: string, visibility: KnowledgeDocumentVisibility) => {
        if (visibility === KnowledgeDocumentVisibility.Deleted) {
          return Promise.resolve([]);
        }
        activeAttempt += 1;
        if (activeAttempt === 1) {
          throw new Error('temporary active visibility failure');
        }
        return Promise.resolve([review]);
      },
    );
    const onReviewRequired = vi.fn();
    const polling = createWorkspaceAiKnowledgeDocumentPollingController({
      workspaceId: 'workspace-a',
      listDocuments,
      onReviewRequired,
      intervalMs: 25,
    });

    await polling.start();
    expect(listDocuments).toHaveBeenCalledTimes(2);
    expect(polling.getDocuments()).toEqual([]);

    await vi.advanceTimersByTimeAsync(25);

    expect(listDocuments).toHaveBeenCalledTimes(4);
    expect(polling.getDocuments().map(document => document.id)).toEqual(['document-a']);
    expect(onReviewRequired).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(listDocuments).toHaveBeenCalledTimes(4);
    polling.dispose();
  });

  test('retains a pollable document across one complete visibility gap and observes its reappearance', async () => {
    vi.useFakeTimers();
    const running = documentItem({
      enrichment: enrichment(KnowledgeEnrichmentStatus.Running, { revision: 1 }),
    });
    const review = documentItem({
      enrichment: enrichment(KnowledgeEnrichmentStatus.ReviewRequired, {
        revision: 2,
        updatedAt: '2026-07-13T00:02:00.000Z',
      }),
    });
    const activeCycles: KnowledgeDocumentListItem[][] = [[running], [], [review]];
    const listDocuments = vi.fn(
      async (_workspaceId: string, visibility: KnowledgeDocumentVisibility) =>
        visibility === KnowledgeDocumentVisibility.Active
          ? activeCycles.shift() ?? []
          : [],
    );
    const onReviewRequired = vi.fn();
    const polling = createWorkspaceAiKnowledgeDocumentPollingController({
      workspaceId: 'workspace-a',
      listDocuments,
      onReviewRequired,
      intervalMs: 25,
    });

    await polling.start();
    await vi.advanceTimersByTimeAsync(25);
    expect(polling.getDocuments()[0]?.enrichment?.status).toBe(
      KnowledgeEnrichmentStatus.Running,
    );

    await vi.advanceTimersByTimeAsync(25);

    expect(listDocuments).toHaveBeenCalledTimes(6);
    expect(polling.getDocuments()[0]?.enrichment?.status).toBe(
      KnowledgeEnrichmentStatus.ReviewRequired,
    );
    expect(onReviewRequired).toHaveBeenCalledTimes(1);
    polling.dispose();
  });

  test('removes a pollable document only after a second complete visibility absence', async () => {
    vi.useFakeTimers();
    const running = documentItem({
      enrichment: enrichment(KnowledgeEnrichmentStatus.Running),
    });
    const activeCycles: KnowledgeDocumentListItem[][] = [[running], [], []];
    const listDocuments = vi.fn(
      async (_workspaceId: string, visibility: KnowledgeDocumentVisibility) =>
        visibility === KnowledgeDocumentVisibility.Active
          ? activeCycles.shift() ?? []
          : [],
    );
    const polling = createWorkspaceAiKnowledgeDocumentPollingController({
      workspaceId: 'workspace-a',
      listDocuments,
      onReviewRequired: vi.fn(),
      intervalMs: 25,
    });

    await polling.start();
    await vi.advanceTimersByTimeAsync(25);
    expect(polling.getDocuments().map(document => document.id)).toEqual(['document-a']);

    await vi.advanceTimersByTimeAsync(25);

    expect(listDocuments).toHaveBeenCalledTimes(6);
    expect(polling.getDocuments()).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(listDocuments).toHaveBeenCalledTimes(6);
    polling.dispose();
  });

  test('schedules only while current work is active and disposal cancels the timer', async () => {
    vi.useFakeTimers();
    const running = documentItem({
      enrichment: enrichment(KnowledgeEnrichmentStatus.Running),
    });
    const listDocuments = vi.fn(
      async (_workspaceId: string, visibility: KnowledgeDocumentVisibility) =>
        visibility === KnowledgeDocumentVisibility.Active ? [running] : [],
    );
    const polling = createWorkspaceAiKnowledgeDocumentPollingController({
      workspaceId: 'workspace-a',
      listDocuments,
      onReviewRequired: vi.fn(),
      intervalMs: 25,
    });

    await polling.start();
    expect(listDocuments).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(25);
    expect(listDocuments).toHaveBeenCalledTimes(4);

    polling.dispose();
    await vi.advanceTimersByTimeAsync(100);
    expect(listDocuments).toHaveBeenCalledTimes(4);
  });

  test('disposal rejects in-flight document responses before transition or state callbacks', async () => {
    const active = deferred<KnowledgeDocumentListItem[]>();
    const deleted = deferred<KnowledgeDocumentListItem[]>();
    const onReviewRequired = vi.fn();
    const listDocuments = vi.fn(
      (_workspaceId: string, visibility: KnowledgeDocumentVisibility) =>
        visibility === KnowledgeDocumentVisibility.Active ? active.promise : deleted.promise,
    );
    const polling = createWorkspaceAiKnowledgeDocumentPollingController({
      workspaceId: 'workspace-a',
      listDocuments,
      onReviewRequired,
    });

    const started = polling.start();
    polling.dispose();
    active.resolve([
      documentItem({
        enrichment: enrichment(KnowledgeEnrichmentStatus.ReviewRequired),
      }),
    ]);
    deleted.resolve([]);
    await started;

    expect(onReviewRequired).not.toHaveBeenCalled();
    expect(polling.getDocuments()).toEqual([]);
  });

  test('routes a merged ReviewRequired transition through the fact trailing-refresh owner', async () => {
    const review = documentItem({
      enrichment: enrichment(KnowledgeEnrichmentStatus.ReviewRequired),
    });
    const listFacts = vi.fn(async () => result([fact('fact-a')], null, metrics(1)));
    const listDocuments = vi.fn(
      async (_workspaceId: string, visibility: KnowledgeDocumentVisibility) =>
        visibility === KnowledgeDocumentVisibility.Active ? [review] : [],
    );
    const controller = createWorkspaceAiKnowledgeController({
      workspaceId: 'workspace-a',
      profileRevision: 1,
      profile: profile(),
      service: { listFacts, listDocuments },
    });

    await controller.start();

    expect(listDocuments).toHaveBeenCalledTimes(2);
    expect(listFacts).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().metricsAcceptanceGeneration).toBe(2);
    controller.dispose();
  });
});
