import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT,
  KNOWLEDGE_FACT_LIST_MAX_LIMIT,
  KnowledgeBaseErrorCode,
  KnowledgeBaseIpc,
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
  KnowledgeFactReviewDecision,
  KnowledgeFactReviewStatus,
} from '../../shared/knowledgeBase/constants';
import type {
  KnowledgeDocumentListItem,
  KnowledgeEnrichmentSummary,
} from '../../shared/knowledgeBase/types';
import {
  KnowledgeFactProjectionConflictError,
  KnowledgeFactProjectorError,
} from './enterpriseLeadKnowledgeFactProjector';
import { type KnowledgeBaseHandlerDeps, registerKnowledgeBaseHandlers } from './ipcHandlers';
import { KnowledgeDocumentServiceError } from './knowledgeDocumentService';
import {
  KnowledgeEnrichmentRequestStateError,
  KnowledgeEnrichmentRevisionConflictError,
  KnowledgeEnrichmentTransientSqliteError,
} from './knowledgeEnrichmentRequestStore';
import {
  KnowledgeExtractionAuthorizationCallbackDisposition,
  KnowledgeExtractionAuthorizationCallbackFailure,
  KnowledgeExtractionAuthorizationError,
  KnowledgeExtractionAuthorizationStore,
} from './knowledgeExtractionAuthorizationStore';
import { KnowledgeFactStateError } from './knowledgeFactStore';
import {
  KnowledgeSelectionTokenError,
  KnowledgeSelectionTokenStore,
} from './knowledgeSelectionTokenStore';

const { registeredHandlers } = vi.hoisted(() => ({
  registeredHandlers: new Map<string, (...args: any[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

const documentItem = (): KnowledgeDocumentListItem => ({
  id: 'document-1',
  displayName: 'manual.pdf',
  sourceMode: KnowledgeDocumentSourceMode.Managed,
  currentVersionId: 'version-1',
  revision: 2,
  status: KnowledgeDocumentStatus.Ready,
  fileSize: 100,
  mimeType: 'application/pdf',
  contentHash: 'a'.repeat(64),
  currentJob: null,
  localIndex: null,
  enrichment: null,
  hasStalePriorVersionExtraction: false,
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  deletedAt: null,
});

const createEvent = (senderId = 7) => {
  const destroyedListeners: Array<() => void> = [];
  let destroyed = false;
  return {
    event: {
      sender: {
        id: senderId,
        isDestroyed: vi.fn(() => destroyed),
        once: vi.fn((eventName: string, listener: () => void) => {
          if (eventName === 'destroyed') destroyedListeners.push(listener);
        }),
      },
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      destroyedListeners.splice(0).forEach(listener => listener());
    },
    destroyedListenerCount: () => destroyedListeners.length,
  };
};

const enrichmentSummary = (requestId = 'request-1'): KnowledgeEnrichmentSummary => ({
  requestId,
  documentId: 'document-1',
  documentVersionId: 'version-1',
  status: KnowledgeEnrichmentStatus.Queued,
  progress: 0,
  revision: 1,
  attemptCount: 0,
  validCandidateCount: 0,
  discardedCandidateCount: 0,
  pendingFactCount: 0,
  partialReasons: [],
  errorCode: null,
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  completedAt: null,
});

const issueExtractionAuthorization = (
  store: KnowledgeExtractionAuthorizationStore,
  ownerId = 7,
) => store.issue({
  ownerId,
  workspaceId: 'workspace-a',
  documentId: 'document-1',
  documentVersionId: 'version-1',
  publishedGenerationId: 'generation-1',
  documentDisplayName: 'manual.pdf',
  lockedRoute: {
    workspaceId: 'workspace-a',
    providerId: 'provider-1',
    providerLabel: 'Provider',
    modelId: 'model-1',
    modelLabel: 'Model',
    routingFingerprint: 'routing-fingerprint-secret',
    apiType: 'openai',
    apiConfig: {
      apiKey: 'authorization-api-key-secret',
      baseURL: 'https://secret-provider.example/v1',
      model: 'model-1',
      apiType: 'openai',
    },
  },
  plannedModelCalls: 1,
  partial: false,
});

const privacySentinels = [
  '/private/customer/secret.pdf',
  'authorization-token-secret',
  'https://secret-provider.example/v1',
  'routing-fingerprint-secret',
  'SQLITE_BUSY_SECRET',
  'stack-secret',
  'cause-secret',
  'source-text-secret',
  'provider-secret',
  'model-traffic-secret',
];

const addPrivateErrorSentinels = <T extends Error>(error: T): T => {
  Object.assign(error, {
    path: privacySentinels[0],
    token: privacySentinels[1],
    endpoint: privacySentinels[2],
    route: privacySentinels[3],
    sql: privacySentinels[4],
    source: privacySentinels[7],
    provider: privacySentinels[8],
    modelTraffic: privacySentinels[9],
  });
  error.stack = privacySentinels[5];
  Object.defineProperty(error, 'cause', {
    configurable: true,
    enumerable: true,
    value: new Error(privacySentinels[6]),
  });
  return error;
};

const projectionConflict = {
  operation: KnowledgeFactProjectionOperation.Confirm,
  kind: KnowledgeFactProjectionConflictKind.CompanySummaryReplacement,
  factId: 'fact-1',
  factRevision: 2,
  domain: KnowledgeFactDomain.CompanySummary,
  currentFieldValue: 'Current company summary',
  fieldRevision: 3,
};

const makeDeps = () => {
  const selectionTokenStore = new KnowledgeSelectionTokenStore({ now: () => 1_000 });
  const authorizationStore = new KnowledgeExtractionAuthorizationStore({ now: () => 1_000 });
  const documentService = {
    importSelection: vi.fn(async () => ({ importedCount: 0, failedCount: 0, items: [] })),
    listDocuments: vi.fn(() => [documentItem()]),
    getDocumentDetails: vi.fn(),
    deleteDocument: vi.fn(() => documentItem()),
    restoreDocument: vi.fn(() => documentItem()),
    retryDocument: vi.fn(() => documentItem()),
    retryLocalIndex: vi.fn(() => documentItem()),
  };
  const foundation = {
    whenReady: vi.fn(async (): Promise<void> => undefined),
    documentService,
    selectionTokenStore,
    authorizationStore,
    enrichmentService: {
      prepareExtractionAuthorization: vi.fn(() => ({
        authorizationToken: 'authorization-token',
        descriptor: {
          workspaceId: 'workspace-a',
          documentId: 'document-1',
          documentVersionId: 'version-1',
          documentDisplayName: 'manual.pdf',
          providerId: 'provider-1',
          providerLabel: 'Provider',
          modelId: 'model-1',
          modelLabel: 'Model',
          plannedModelCalls: 1,
          partial: false,
          expiresAt: '2026-07-11T00:02:00.000Z',
        },
      })),
      requestExtraction: vi.fn(async () => enrichmentSummary()),
      retryExtraction: vi.fn(async () => enrichmentSummary()),
      cancelExtraction: vi.fn(() => enrichmentSummary()),
    },
    factQueryService: {
      listFacts: vi.fn(() => ({
        items: [],
        nextCursor: null,
        metrics: {
          activePendingCount: 0,
          activeConfirmedCount: 0,
          staleConfirmedCount: 0,
          rejectedHistoryCount: 0,
          archivedHistoryCount: 0,
          unduplicatedLegacyConfirmedCount: 0,
          totalAiKnowledgeCount: 0,
        },
      })),
      getFactEvidence: vi.fn(() => ({
        factId: 'fact-1',
        factRevision: 1,
        items: [],
        nextCursor: null,
      })),
    },
    factProjector: {
      confirmFact: vi.fn(),
      rejectFact: vi.fn(),
      archiveFact: vi.fn(),
    },
  };
  const showOpenDialog = vi.fn(async () => ({
    canceled: false,
    filePaths: ['/private/customer/manual.pdf'],
  }));
  const statSelectedFile = vi.fn(async (absolutePath: string) => ({
    absolutePath,
    displayName: 'manual.pdf',
    fileSize: 100,
    sourceMtime: 200,
  }));
  return {
    deps: { foundation, showOpenDialog, statSelectedFile } as unknown as KnowledgeBaseHandlerDeps,
    foundation,
    documentService,
    selectionTokenStore,
    authorizationStore,
  };
};

const invoke = (
  channel: string,
  event: ReturnType<typeof createEvent>['event'],
  input?: unknown,
): Promise<unknown> => {
  const handler = registeredHandlers.get(channel);
  if (!handler) throw new Error(`Missing test handler for ${channel}`);
  return Promise.resolve(input === undefined ? handler(event) : handler(event, input));
};

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  registeredHandlers.clear();
});

describe('registerKnowledgeBaseHandlers', () => {
  test('all document and AI handlers await the same Foundation readiness promise', async () => {
    const { deps, foundation } = makeDeps();
    const ready = deferred<void>();
    foundation.whenReady.mockReturnValue(ready.promise);
    registerKnowledgeBaseHandlers(deps);
    const event = createEvent().event;

    const invocations = [
      invoke(KnowledgeBaseIpc.SelectFiles, event),
      invoke(KnowledgeBaseIpc.ImportSelection, event, {
        workspaceId: 'workspace-a',
        selectionToken: 'selection-token',
      }),
      invoke(KnowledgeBaseIpc.ListDocuments, event, {
        workspaceId: 'workspace-a',
        visibility: KnowledgeDocumentVisibility.Active,
      }),
      invoke(KnowledgeBaseIpc.GetDocumentDetails, event, { documentId: 'document-1' }),
      invoke(KnowledgeBaseIpc.DeleteDocument, event, {
        documentId: 'document-1',
        expectedRevision: 1,
      }),
      invoke(KnowledgeBaseIpc.RestoreDocument, event, {
        documentId: 'document-1',
        expectedRevision: 1,
      }),
      invoke(KnowledgeBaseIpc.RetryDocument, event, {
        documentId: 'document-1',
        documentVersionId: 'version-1',
      }),
      invoke(KnowledgeBaseIpc.RetryLocalIndex, event, {
        documentId: 'document-1',
        documentVersionId: 'version-1',
      }),
      invoke(KnowledgeBaseIpc.PrepareExtractionAuthorization, event, {
        documentId: 'document-1',
        documentVersionId: 'version-1',
      }),
      invoke(KnowledgeBaseIpc.RequestExtraction, event, {
        authorizationToken: 'authorization-token',
      }),
      invoke(KnowledgeBaseIpc.RetryExtraction, event, {
        requestId: 'request-1',
        authorizationToken: 'authorization-token',
      }),
      invoke(KnowledgeBaseIpc.CancelExtraction, event, {
        requestId: 'request-1',
        expectedRevision: 1,
      }),
      invoke(KnowledgeBaseIpc.ListFacts, event, {
        workspaceId: 'workspace-a',
        view: KnowledgeFactListView.Active,
      }),
      invoke(KnowledgeBaseIpc.ReviewFact, event, {
        factId: 'fact-1',
        expectedRevision: 1,
        decision: KnowledgeFactReviewDecision.Confirm,
      }),
      invoke(KnowledgeBaseIpc.ArchiveFact, event, {
        factId: 'fact-1',
        expectedRevision: 1,
      }),
      invoke(KnowledgeBaseIpc.GetFactEvidence, event, {
        factId: 'fact-1',
        expectedRevision: 1,
      }),
    ];
    const backendOperations = [
      deps.showOpenDialog,
      foundation.documentService.importSelection,
      foundation.documentService.listDocuments,
      foundation.documentService.getDocumentDetails,
      foundation.documentService.deleteDocument,
      foundation.documentService.restoreDocument,
      foundation.documentService.retryDocument,
      foundation.documentService.retryLocalIndex,
      foundation.enrichmentService.prepareExtractionAuthorization,
      foundation.enrichmentService.requestExtraction,
      foundation.enrichmentService.retryExtraction,
      foundation.enrichmentService.cancelExtraction,
      foundation.factQueryService.listFacts,
      foundation.factProjector.confirmFact,
      foundation.factProjector.archiveFact,
      foundation.factQueryService.getFactEvidence,
    ];

    backendOperations.forEach(operation => expect(operation).not.toHaveBeenCalled());
    ready.resolve();
    await expect(Promise.all(invocations)).resolves.toHaveLength(16);
    backendOperations.forEach(operation => expect(operation).toHaveBeenCalledTimes(1));
    expect(foundation.whenReady).toHaveBeenCalledTimes(16);
  });
  test('selects files in main, binds the token to sender id, and returns no paths', async () => {
    const { deps, selectionTokenStore } = makeDeps();
    registerKnowledgeBaseHandlers(deps);
    const sender = createEvent(7);

    const result = await registeredHandlers.get(KnowledgeBaseIpc.SelectFiles)?.(sender.event);

    expect(result).toMatchObject({
      success: true,
      data: {
        selectionToken: expect.any(String),
        files: [{ displayName: 'manual.pdf', fileSize: 100, itemId: expect.any(String) }],
      },
    });
    expect(JSON.stringify(result)).not.toContain('/private/customer');
    const selectionToken = (result as any).data.selectionToken as string;
    expect(selectionTokenStore.consume(selectionToken, 7)[0]?.absolutePath).toBe(
      '/private/customer/manual.pdf',
    );
  });

  test('clears owner tokens when the sending WebContents is destroyed', async () => {
    const { deps, selectionTokenStore } = makeDeps();
    registerKnowledgeBaseHandlers(deps);
    const sender = createEvent(7);
    const result = await registeredHandlers.get(KnowledgeBaseIpc.SelectFiles)?.(sender.event);
    const selectionToken = (result as any).data.selectionToken as string;

    sender.destroy();

    expect(() => selectionTokenStore.consume(selectionToken, 7)).toThrowError(
      expect.objectContaining({ code: KnowledgeBaseErrorCode.InvalidSelectionToken }),
    );
  });

  test('shares one cleanup listener per WebContents identity and clears both owner stores once', async () => {
    const { deps, selectionTokenStore, authorizationStore } = makeDeps();
    const clearSelectionOwner = vi.spyOn(selectionTokenStore, 'clearOwner');
    const clearAuthorizationOwner = vi.spyOn(authorizationStore, 'clearOwner');
    registerKnowledgeBaseHandlers(deps);
    const firstSender = createEvent(7);

    await invoke(KnowledgeBaseIpc.SelectFiles, firstSender.event);
    await invoke(KnowledgeBaseIpc.PrepareExtractionAuthorization, firstSender.event, {
      documentId: 'document-1',
      documentVersionId: 'version-1',
    });
    await invoke(KnowledgeBaseIpc.RequestExtraction, firstSender.event, {
      authorizationToken: 'authorization-token',
    });
    await invoke(KnowledgeBaseIpc.RetryExtraction, firstSender.event, {
      requestId: 'request-1',
      authorizationToken: 'authorization-token',
    });
    const replacementSender = createEvent(7);
    await invoke(KnowledgeBaseIpc.PrepareExtractionAuthorization, replacementSender.event, {
      documentId: 'document-1',
      documentVersionId: 'version-1',
    });

    expect(firstSender.destroyedListenerCount()).toBe(1);
    expect(replacementSender.destroyedListenerCount()).toBe(1);
    firstSender.destroy();
    expect(clearSelectionOwner).toHaveBeenCalledTimes(1);
    expect(clearSelectionOwner).toHaveBeenLastCalledWith(7);
    expect(clearAuthorizationOwner).toHaveBeenCalledTimes(1);
    expect(clearAuthorizationOwner).toHaveBeenLastCalledWith(7);
    replacementSender.destroy();
    expect(clearSelectionOwner).toHaveBeenCalledTimes(2);
    expect(clearAuthorizationOwner).toHaveBeenCalledTimes(2);
  });

  test('registers cleanup before readiness and blocks late prepare after destruction', async () => {
    const { deps, foundation } = makeDeps();
    const ready = deferred<void>();
    foundation.whenReady.mockReturnValue(ready.promise);
    registerKnowledgeBaseHandlers(deps);
    const sender = createEvent(7);

    const preparing = invoke(KnowledgeBaseIpc.PrepareExtractionAuthorization, sender.event, {
      documentId: 'document-1',
      documentVersionId: 'version-1',
    });
    const listenerCountBeforeReady = sender.destroyedListenerCount();
    sender.destroy();
    ready.resolve();
    const result = await preparing;

    expect(listenerCountBeforeReady).toBe(1);
    expect(foundation.enrichmentService.prepareExtractionAuthorization).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization },
    });
  });

  test('destruction during authorization consume rejects a late callback and cannot revive receipt', async () => {
    const { deps, foundation, authorizationStore } = makeDeps();
    const preparation = issueExtractionAuthorization(authorizationStore);
    const requestId = deferred<string>();
    const createRequest = vi.fn(() => requestId.promise);
    foundation.enrichmentService.requestExtraction.mockImplementation(async () => {
      const committedRequestId = await authorizationStore.consume(
        preparation.authorizationToken,
        7,
        createRequest,
      );
      return enrichmentSummary(committedRequestId);
    });
    registerKnowledgeBaseHandlers(deps);
    const sender = createEvent(7);

    const consuming = invoke(KnowledgeBaseIpc.RequestExtraction, sender.event, {
      authorizationToken: preparation.authorizationToken,
    });
    await vi.waitFor(() => expect(createRequest).toHaveBeenCalledOnce());
    sender.destroy();
    requestId.resolve('late-request');

    await expect(consuming).resolves.toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization },
    });
    await expect(authorizationStore.consume(
      preparation.authorizationToken,
      7,
      () => 'revived-request',
    )).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization,
    });
    expect(createRequest).toHaveBeenCalledOnce();
  });

  test('replays a same-owner receipt before cleanup and preserves its durable request after destroy', async () => {
    const { deps, foundation, authorizationStore } = makeDeps();
    const preparation = issueExtractionAuthorization(authorizationStore);
    const durableRequests = new Set<string>();
    const createRequest = vi.fn(() => {
      durableRequests.add('durable-request');
      return 'durable-request';
    });
    foundation.enrichmentService.requestExtraction.mockImplementation(async () => {
      const requestId = await authorizationStore.consume(
        preparation.authorizationToken,
        7,
        createRequest,
      );
      return enrichmentSummary(requestId);
    });
    registerKnowledgeBaseHandlers(deps);
    const sender = createEvent(7);

    const first = await invoke(KnowledgeBaseIpc.RequestExtraction, sender.event, {
      authorizationToken: preparation.authorizationToken,
    });
    const replay = await invoke(KnowledgeBaseIpc.RequestExtraction, sender.event, {
      authorizationToken: preparation.authorizationToken,
    });

    expect(first).toEqual(replay);
    expect(createRequest).toHaveBeenCalledOnce();
    sender.destroy();
    expect(durableRequests).toEqual(new Set(['durable-request']));
    await expect(authorizationStore.consume(
      preparation.authorizationToken,
      7,
      () => 'must-not-recreate',
    )).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization,
    });
    expect(durableRequests).toEqual(new Set(['durable-request']));
  });

  test('does not issue a token when WebContents is destroyed during file inspection', async () => {
    const { deps } = makeDeps();
    let resolveStat!: (value: {
      absolutePath: string;
      displayName: string;
      fileSize: number;
      sourceMtime: number;
    }) => void;
    deps.statSelectedFile = vi.fn(
      absolutePath =>
        new Promise(resolve => {
          resolveStat = value => resolve({ ...value, absolutePath });
        }),
    );
    registerKnowledgeBaseHandlers(deps);
    const sender = createEvent(7);

    const resultPromise = registeredHandlers.get(KnowledgeBaseIpc.SelectFiles)?.(sender.event);
    await vi.waitFor(() => expect(deps.statSelectedFile).toHaveBeenCalledTimes(1));
    sender.destroy();
    resolveStat({
      absolutePath: '',
      displayName: 'manual.pdf',
      fileSize: 100,
      sourceMtime: 200,
    });

    await expect(resultPromise).resolves.toEqual({ success: true, data: null });
  });

  test('returns a successful null selection when the picker is cancelled', async () => {
    const { deps } = makeDeps();
    deps.showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: [] }));
    registerKnowledgeBaseHandlers(deps);

    const result = await registeredHandlers.get(KnowledgeBaseIpc.SelectFiles)?.(
      createEvent().event,
    );

    expect(result).toEqual({ success: true, data: null });
  });

  test('rejects oversized picker batches before statting any selected path', async () => {
    const { deps } = makeDeps();
    deps.showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: Array.from({ length: 101 }, (_, index) => `/private/file-${index}.txt`),
    }));
    registerKnowledgeBaseHandlers(deps);

    const result = await registeredHandlers.get(KnowledgeBaseIpc.SelectFiles)?.(
      createEvent().event,
    );

    expect(result).toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.TooManyFiles },
    });
    expect(deps.statSelectedFile).not.toHaveBeenCalled();
  });

  test('passes sender ownership and selected item ids into import', async () => {
    const { deps, documentService } = makeDeps();
    registerKnowledgeBaseHandlers(deps);
    const sender = createEvent(9);

    await registeredHandlers.get(KnowledgeBaseIpc.ImportSelection)?.(sender.event, {
      workspaceId: 'workspace-a',
      selectionToken: 'selection-a',
      itemIds: ['item-b'],
    });
    await registeredHandlers.get(KnowledgeBaseIpc.ListDocuments)?.(sender.event, {
      workspaceId: 'workspace-a',
      visibility: KnowledgeDocumentVisibility.Deleted,
    });

    expect(documentService.importSelection).toHaveBeenCalledWith({
      ownerId: 9,
      workspaceId: 'workspace-a',
      selectionToken: 'selection-a',
      itemIds: ['item-b'],
    });
    expect(documentService.listDocuments).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      visibility: KnowledgeDocumentVisibility.Deleted,
    });
  });

  test.each([
    { name: 'empty', itemIds: [] },
    { name: 'blank', itemIds: [''] },
    { name: 'duplicate', itemIds: ['item-a', 'item-a'] },
    { name: 'non-string', itemIds: [7] },
  ])('rejects $name import item ids with a stable code', async ({ itemIds }) => {
    const { deps, documentService } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    const result = await registeredHandlers.get(KnowledgeBaseIpc.ImportSelection)?.(
      createEvent().event,
      {
        workspaceId: 'workspace-a',
        selectionToken: 'selection-a',
        itemIds,
      },
    );

    expect(documentService.importSelection).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.InvalidRequest },
    });
  });

  test('rejects sparse import item ids with a stable code', async () => {
    const { deps, documentService } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    const result = await registeredHandlers.get(KnowledgeBaseIpc.ImportSelection)?.(
      createEvent().event,
      {
        workspaceId: 'workspace-a',
        selectionToken: 'selection-a',
        itemIds: Array<string>(1),
      },
    );

    expect(documentService.importSelection).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.InvalidRequest },
    });
  });

  test.each([
    {
      name: 'symbol extra key',
      input: Object.assign(
        { workspaceId: 'workspace-a' },
        { [Symbol('secret')]: 'not-allowed' },
      ),
    },
    {
      name: 'non-enumerable extra key',
      input: Object.defineProperty(
        { workspaceId: 'workspace-a' },
        'secret',
        { value: 'not-allowed', enumerable: false },
      ),
    },
    {
      name: 'non-enumerable allowed key',
      input: Object.defineProperty({}, 'workspaceId', {
        value: 'workspace-a',
        enumerable: false,
      }),
    },
    {
      name: 'foreign prototype',
      input: Object.assign(Object.create({ inherited: true }) as object, {
        workspaceId: 'workspace-a',
      }),
    },
    {
      name: 'accessor property',
      input: Object.defineProperty({}, 'workspaceId', {
        get: () => 'workspace-a',
        enumerable: true,
      }),
    },
    {
      name: 'transparent proxy',
      input: new Proxy({ workspaceId: 'workspace-a' }, {}),
    },
    {
      name: 'throwing ownKeys proxy trap',
      input: new Proxy(
        { workspaceId: 'workspace-a' },
        { ownKeys: () => { throw new Error('proxy trap'); } },
      ),
    },
    {
      name: 'throwing getPrototypeOf proxy trap',
      input: new Proxy(
        { workspaceId: 'workspace-a' },
        { getPrototypeOf: () => { throw new Error('proxy trap'); } },
      ),
    },
    {
      name: 'throwing descriptor proxy trap',
      input: new Proxy(
        { workspaceId: 'workspace-a' },
        { getOwnPropertyDescriptor: () => { throw new Error('proxy trap'); } },
      ),
    },
  ])('rejects $name root input before listing facts', async ({ input }) => {
    const { deps, foundation } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    await expect(
      invoke(KnowledgeBaseIpc.ListFacts, createEvent().event, input),
    ).resolves.toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.InvalidRequest },
    });
    expect(foundation.factQueryService.listFacts).not.toHaveBeenCalled();
  });

  test('accepts null-prototype root input as plain own data', async () => {
    const { deps, foundation } = makeDeps();
    registerKnowledgeBaseHandlers(deps);
    const input = Object.assign(Object.create(null) as object, {
      workspaceId: 'workspace-a',
    });

    await expect(
      invoke(KnowledgeBaseIpc.ListFacts, createEvent().event, input),
    ).resolves.toMatchObject({ success: true });
    expect(foundation.factQueryService.listFacts).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
    });
  });

  test.each([
    [KnowledgeBaseIpc.ImportSelection, {
      workspaceId: 'workspace-a', selectionToken: 'selection-token', itemIds: undefined,
    }],
    [KnowledgeBaseIpc.ListFacts, { workspaceId: 'workspace-a', view: undefined }],
    [KnowledgeBaseIpc.ListFacts, { workspaceId: 'workspace-a', reviewStatuses: undefined }],
    [KnowledgeBaseIpc.ListFacts, { workspaceId: 'workspace-a', evidenceState: undefined }],
    [KnowledgeBaseIpc.ListFacts, { workspaceId: 'workspace-a', cursor: undefined }],
    [KnowledgeBaseIpc.ListFacts, { workspaceId: 'workspace-a', limit: undefined }],
    [KnowledgeBaseIpc.ReviewFact, {
      factId: 'fact-1',
      expectedRevision: 1,
      decision: KnowledgeFactReviewDecision.Confirm,
      replaceExisting: undefined,
    }],
    [KnowledgeBaseIpc.ReviewFact, {
      factId: 'fact-1',
      expectedRevision: 1,
      decision: KnowledgeFactReviewDecision.Confirm,
      expectedFieldRevision: undefined,
    }],
    [KnowledgeBaseIpc.ArchiveFact, {
      factId: 'fact-1', expectedRevision: 1, projectionDecision: undefined,
    }],
    [KnowledgeBaseIpc.ArchiveFact, {
      factId: 'fact-1', expectedRevision: 1, expectedFieldRevision: undefined,
    }],
    [KnowledgeBaseIpc.GetFactEvidence, {
      factId: 'fact-1', expectedRevision: 1, cursor: undefined,
    }],
    [KnowledgeBaseIpc.GetFactEvidence, {
      factId: 'fact-1', expectedRevision: 1, limit: undefined,
    }],
  ])('rejects explicit undefined optional properties on %s', async (channel, input) => {
    const { deps } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    await expect(invoke(channel, createEvent().event, input)).resolves.toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.InvalidRequest },
    });
  });

  test.each([
    {
      name: 'accessor element',
      itemIds: Object.defineProperty(['item-a'], '0', {
        get: () => 'item-a',
        enumerable: true,
        configurable: true,
      }),
    },
    {
      name: 'non-enumerable element',
      itemIds: Object.defineProperty(['item-a'], '0', {
        value: 'item-a',
        enumerable: false,
        writable: true,
        configurable: true,
      }),
    },
    {
      name: 'foreign prototype',
      itemIds: Object.setPrototypeOf(['item-a'], Object.create(Array.prototype)) as string[],
    },
    {
      name: 'extra own property',
      itemIds: Object.assign(['item-a'], { extra: 'not-allowed' }),
    },
    {
      name: 'transparent proxy',
      itemIds: new Proxy(['item-a'], {}),
    },
    {
      name: 'throwing ownKeys proxy trap',
      itemIds: new Proxy(['item-a'], {
        ownKeys: () => { throw new Error('proxy trap'); },
      }),
    },
  ])('rejects import item id arrays with $name', async ({ itemIds }) => {
    const { deps, documentService } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    await expect(invoke(KnowledgeBaseIpc.ImportSelection, createEvent().event, {
      workspaceId: 'workspace-a',
      selectionToken: 'selection-token',
      itemIds,
    })).resolves.toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.InvalidRequest },
    });
    expect(documentService.importSelection).not.toHaveBeenCalled();
  });

  test.each([
    {
      name: 'omitted filters',
      input: { workspaceId: 'workspace-a' },
      expected: { workspaceId: 'workspace-a' },
    },
    {
      name: 'active view, empty statuses, active evidence, and lower limit',
      input: {
        workspaceId: ' workspace-a ',
        view: KnowledgeFactListView.Active,
        reviewStatuses: [],
        evidenceState: KnowledgeFactEvidenceState.Active,
        cursor: ' cursor-a ',
        limit: 1,
      },
      expected: {
        workspaceId: 'workspace-a',
        view: KnowledgeFactListView.Active,
        reviewStatuses: [],
        evidenceState: KnowledgeFactEvidenceState.Active,
        cursor: 'cursor-a',
        limit: 1,
      },
    },
    {
      name: 'history view, every unique status, stale evidence, and upper limit',
      input: {
        workspaceId: 'workspace-a',
        view: KnowledgeFactListView.History,
        reviewStatuses: [
          KnowledgeFactReviewStatus.Pending,
          KnowledgeFactReviewStatus.Confirmed,
          KnowledgeFactReviewStatus.Rejected,
        ],
        evidenceState: KnowledgeFactEvidenceState.Stale,
        cursor: 'cursor-b',
        limit: KNOWLEDGE_FACT_LIST_MAX_LIMIT,
      },
      expected: {
        workspaceId: 'workspace-a',
        view: KnowledgeFactListView.History,
        reviewStatuses: [
          KnowledgeFactReviewStatus.Pending,
          KnowledgeFactReviewStatus.Confirmed,
          KnowledgeFactReviewStatus.Rejected,
        ],
        evidenceState: KnowledgeFactEvidenceState.Stale,
        cursor: 'cursor-b',
        limit: KNOWLEDGE_FACT_LIST_MAX_LIMIT,
      },
    },
    {
      name: 'any evidence',
      input: {
        workspaceId: 'workspace-a',
        evidenceState: KnowledgeFactEvidenceState.Any,
      },
      expected: {
        workspaceId: 'workspace-a',
        evidenceState: KnowledgeFactEvidenceState.Any,
      },
    },
  ])('routes valid list-facts input with $name', async ({ input, expected }) => {
    const { deps, foundation } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    await expect(
      invoke(KnowledgeBaseIpc.ListFacts, createEvent().event, input),
    ).resolves.toMatchObject({ success: true });
    expect(foundation.factQueryService.listFacts).toHaveBeenCalledWith(expected);
  });

  test.each([
    ['blank workspace', { workspaceId: '   ' }],
    ['invalid view', { workspaceId: 'workspace-a', view: 'other' }],
    ['non-array statuses', { workspaceId: 'workspace-a', reviewStatuses: 'pending' }],
    ['invalid status', { workspaceId: 'workspace-a', reviewStatuses: ['other'] }],
    ['duplicate statuses', {
      workspaceId: 'workspace-a',
      reviewStatuses: [KnowledgeFactReviewStatus.Pending, KnowledgeFactReviewStatus.Pending],
    }],
    ['sparse statuses', {
      workspaceId: 'workspace-a', reviewStatuses: Array<string>(1),
    }],
    ['accessor status', {
      workspaceId: 'workspace-a',
      reviewStatuses: Object.defineProperty([KnowledgeFactReviewStatus.Pending], '0', {
        get: () => KnowledgeFactReviewStatus.Pending,
        enumerable: true,
        configurable: true,
      }),
    }],
    ['foreign-prototype statuses', {
      workspaceId: 'workspace-a',
      reviewStatuses: Object.setPrototypeOf(
        [KnowledgeFactReviewStatus.Pending],
        Object.create(Array.prototype),
      ),
    }],
    ['throwing ownKeys statuses proxy', {
      workspaceId: 'workspace-a',
      reviewStatuses: new Proxy([KnowledgeFactReviewStatus.Pending], {
        ownKeys: () => { throw new Error('proxy trap'); },
      }),
    }],
    ['invalid evidence state', { workspaceId: 'workspace-a', evidenceState: 'other' }],
    ['blank cursor', { workspaceId: 'workspace-a', cursor: '   ' }],
    ['non-string cursor', { workspaceId: 'workspace-a', cursor: 7 }],
    ['zero limit', { workspaceId: 'workspace-a', limit: 0 }],
    ['limit above maximum', {
      workspaceId: 'workspace-a', limit: KNOWLEDGE_FACT_LIST_MAX_LIMIT + 1,
    }],
    ['fractional limit', { workspaceId: 'workspace-a', limit: 1.5 }],
    ['unsafe integer limit', {
      workspaceId: 'workspace-a', limit: Number.MAX_SAFE_INTEGER + 1,
    }],
  ])('rejects list-facts input with %s', async (_name, input) => {
    const { deps, foundation } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    await expect(
      invoke(KnowledgeBaseIpc.ListFacts, createEvent().event, input),
    ).resolves.toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.InvalidRequest },
    });
    expect(foundation.factQueryService.listFacts).not.toHaveBeenCalled();
  });

  test.each([
    {
      name: 'omitted page options',
      input: { factId: ' fact-1 ', expectedRevision: 1 },
      expected: { factId: 'fact-1', expectedRevision: 1 },
    },
    {
      name: 'trimmed cursor and lower limit',
      input: { factId: 'fact-1', expectedRevision: 1, cursor: ' cursor-a ', limit: 1 },
      expected: { factId: 'fact-1', expectedRevision: 1, cursor: 'cursor-a', limit: 1 },
    },
    {
      name: 'upper limit',
      input: {
        factId: 'fact-1',
        expectedRevision: Number.MAX_SAFE_INTEGER,
        limit: KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT,
      },
      expected: {
        factId: 'fact-1',
        expectedRevision: Number.MAX_SAFE_INTEGER,
        limit: KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT,
      },
    },
  ])('routes valid evidence input with $name', async ({ input, expected }) => {
    const { deps, foundation } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    await expect(
      invoke(KnowledgeBaseIpc.GetFactEvidence, createEvent().event, input),
    ).resolves.toMatchObject({ success: true });
    expect(foundation.factQueryService.getFactEvidence).toHaveBeenCalledWith(expected);
  });

  test.each([
    ['blank fact id', { factId: '   ', expectedRevision: 1 }],
    ['zero revision', { factId: 'fact-1', expectedRevision: 0 }],
    ['fractional revision', { factId: 'fact-1', expectedRevision: 1.5 }],
    ['infinite revision', { factId: 'fact-1', expectedRevision: Number.POSITIVE_INFINITY }],
    ['unsafe revision', {
      factId: 'fact-1', expectedRevision: Number.MAX_SAFE_INTEGER + 1,
    }],
    ['blank cursor', { factId: 'fact-1', expectedRevision: 1, cursor: '   ' }],
    ['non-string cursor', { factId: 'fact-1', expectedRevision: 1, cursor: 7 }],
    ['zero limit', { factId: 'fact-1', expectedRevision: 1, limit: 0 }],
    ['limit above maximum', {
      factId: 'fact-1', expectedRevision: 1, limit: KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT + 1,
    }],
    ['fractional limit', { factId: 'fact-1', expectedRevision: 1, limit: 1.5 }],
    ['infinite limit', {
      factId: 'fact-1', expectedRevision: 1, limit: Number.POSITIVE_INFINITY,
    }],
    ['unsafe limit', {
      factId: 'fact-1', expectedRevision: 1, limit: Number.MAX_SAFE_INTEGER + 1,
    }],
  ])('rejects evidence input with %s', async (_name, input) => {
    const { deps, foundation } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    await expect(
      invoke(KnowledgeBaseIpc.GetFactEvidence, createEvent().event, input),
    ).resolves.toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.InvalidRequest },
    });
    expect(foundation.factQueryService.getFactEvidence).not.toHaveBeenCalled();
  });

  test.each([
    {
      name: 'Confirm with neither optional property',
      input: {
        factId: ' fact-1 ',
        expectedRevision: 1,
        decision: KnowledgeFactReviewDecision.Confirm,
      },
      expected: { factId: 'fact-1', expectedRevision: 1 },
    },
    {
      name: 'Confirm with replacement disabled only',
      input: {
        factId: 'fact-1',
        expectedRevision: 1,
        decision: KnowledgeFactReviewDecision.Confirm,
        replaceExisting: false,
      },
      expected: { factId: 'fact-1', expectedRevision: 1, replaceExisting: false },
    },
    {
      name: 'Confirm with replacement enabled and a field revision',
      input: {
        factId: 'fact-1',
        expectedRevision: Number.MAX_SAFE_INTEGER,
        decision: KnowledgeFactReviewDecision.Confirm,
        replaceExisting: true,
        expectedFieldRevision: Number.MAX_SAFE_INTEGER,
      },
      expected: {
        factId: 'fact-1',
        expectedRevision: Number.MAX_SAFE_INTEGER,
        replaceExisting: true,
        expectedFieldRevision: Number.MAX_SAFE_INTEGER,
      },
    },
  ])('routes legal review combination: $name', async ({ input, expected }) => {
    const { deps, foundation } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    await expect(
      invoke(KnowledgeBaseIpc.ReviewFact, createEvent().event, input),
    ).resolves.toMatchObject({ success: true });
    expect(foundation.factProjector.confirmFact).toHaveBeenCalledWith(expected);
    expect(foundation.factProjector.rejectFact).not.toHaveBeenCalled();
  });

  test('routes legal Reject review with no optional properties', async () => {
    const { deps, foundation } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    await expect(invoke(KnowledgeBaseIpc.ReviewFact, createEvent().event, {
      factId: 'fact-1',
      expectedRevision: 1,
      decision: KnowledgeFactReviewDecision.Reject,
    })).resolves.toMatchObject({ success: true });
    expect(foundation.factProjector.rejectFact).toHaveBeenCalledWith({
      factId: 'fact-1',
      expectedRevision: 1,
    });
    expect(foundation.factProjector.confirmFact).not.toHaveBeenCalled();
  });

  test.each([
    ['invalid decision', {
      factId: 'fact-1', expectedRevision: 1, decision: 'other',
    }],
    ['Confirm with replacement enabled only', {
      factId: 'fact-1',
      expectedRevision: 1,
      decision: KnowledgeFactReviewDecision.Confirm,
      replaceExisting: true,
    }],
    ['Confirm with a field revision only', {
      factId: 'fact-1',
      expectedRevision: 1,
      decision: KnowledgeFactReviewDecision.Confirm,
      expectedFieldRevision: 1,
    }],
    ['Confirm with replacement disabled and a field revision', {
      factId: 'fact-1',
      expectedRevision: 1,
      decision: KnowledgeFactReviewDecision.Confirm,
      replaceExisting: false,
      expectedFieldRevision: 1,
    }],
    ['Confirm with non-boolean replacement', {
      factId: 'fact-1',
      expectedRevision: 1,
      decision: KnowledgeFactReviewDecision.Confirm,
      replaceExisting: 'yes',
    }],
    ['Confirm with zero field revision', {
      factId: 'fact-1',
      expectedRevision: 1,
      decision: KnowledgeFactReviewDecision.Confirm,
      replaceExisting: true,
      expectedFieldRevision: 0,
    }],
    ['Confirm with unsafe field revision', {
      factId: 'fact-1',
      expectedRevision: 1,
      decision: KnowledgeFactReviewDecision.Confirm,
      replaceExisting: true,
      expectedFieldRevision: Number.MAX_SAFE_INTEGER + 1,
    }],
    ['Reject with replacement disabled only', {
      factId: 'fact-1',
      expectedRevision: 1,
      decision: KnowledgeFactReviewDecision.Reject,
      replaceExisting: false,
    }],
    ['Reject with replacement enabled only', {
      factId: 'fact-1',
      expectedRevision: 1,
      decision: KnowledgeFactReviewDecision.Reject,
      replaceExisting: true,
    }],
    ['Reject with a field revision only', {
      factId: 'fact-1',
      expectedRevision: 1,
      decision: KnowledgeFactReviewDecision.Reject,
      expectedFieldRevision: 1,
    }],
    ['Reject with replacement disabled and a field revision', {
      factId: 'fact-1',
      expectedRevision: 1,
      decision: KnowledgeFactReviewDecision.Reject,
      replaceExisting: false,
      expectedFieldRevision: 1,
    }],
    ['Reject with replacement enabled and a field revision', {
      factId: 'fact-1',
      expectedRevision: 1,
      decision: KnowledgeFactReviewDecision.Reject,
      replaceExisting: true,
      expectedFieldRevision: 1,
    }],
  ])('rejects illegal review combination: %s', async (_name, input) => {
    const { deps, foundation } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    await expect(
      invoke(KnowledgeBaseIpc.ReviewFact, createEvent().event, input),
    ).resolves.toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.InvalidRequest },
    });
    expect(foundation.factProjector.confirmFact).not.toHaveBeenCalled();
    expect(foundation.factProjector.rejectFact).not.toHaveBeenCalled();
  });

  test.each([
    {
      name: 'neither optional property',
      input: { factId: ' fact-1 ', expectedRevision: 1 },
      expected: { factId: 'fact-1', expectedRevision: 1 },
    },
    {
      name: 'KeepCurrent without a field revision',
      input: {
        factId: 'fact-1',
        expectedRevision: 1,
        projectionDecision: KnowledgeFactArchiveProjectionDecision.KeepCurrent,
      },
      expected: {
        factId: 'fact-1',
        expectedRevision: 1,
        projectionDecision: KnowledgeFactArchiveProjectionDecision.KeepCurrent,
      },
    },
    {
      name: 'RemoveCurrent with a positive field revision',
      input: {
        factId: 'fact-1',
        expectedRevision: Number.MAX_SAFE_INTEGER,
        projectionDecision: KnowledgeFactArchiveProjectionDecision.RemoveCurrent,
        expectedFieldRevision: Number.MAX_SAFE_INTEGER,
      },
      expected: {
        factId: 'fact-1',
        expectedRevision: Number.MAX_SAFE_INTEGER,
        projectionDecision: KnowledgeFactArchiveProjectionDecision.RemoveCurrent,
        expectedFieldRevision: Number.MAX_SAFE_INTEGER,
      },
    },
  ])('routes legal archive combination: $name', async ({ input, expected }) => {
    const { deps, foundation } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    await expect(
      invoke(KnowledgeBaseIpc.ArchiveFact, createEvent().event, input),
    ).resolves.toMatchObject({ success: true });
    expect(foundation.factProjector.archiveFact).toHaveBeenCalledWith(expected);
  });

  test.each([
    ['invalid projection decision', {
      factId: 'fact-1', expectedRevision: 1, projectionDecision: 'other',
    }],
    ['RemoveCurrent without a field revision', {
      factId: 'fact-1',
      expectedRevision: 1,
      projectionDecision: KnowledgeFactArchiveProjectionDecision.RemoveCurrent,
    }],
    ['a field revision without a projection decision', {
      factId: 'fact-1', expectedRevision: 1, expectedFieldRevision: 1,
    }],
    ['KeepCurrent with a field revision', {
      factId: 'fact-1',
      expectedRevision: 1,
      projectionDecision: KnowledgeFactArchiveProjectionDecision.KeepCurrent,
      expectedFieldRevision: 1,
    }],
    ['RemoveCurrent with zero field revision', {
      factId: 'fact-1',
      expectedRevision: 1,
      projectionDecision: KnowledgeFactArchiveProjectionDecision.RemoveCurrent,
      expectedFieldRevision: 0,
    }],
    ['RemoveCurrent with unsafe field revision', {
      factId: 'fact-1',
      expectedRevision: 1,
      projectionDecision: KnowledgeFactArchiveProjectionDecision.RemoveCurrent,
      expectedFieldRevision: Number.MAX_SAFE_INTEGER + 1,
    }],
  ])('rejects illegal archive combination: %s', async (_name, input) => {
    const { deps, foundation } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    await expect(
      invoke(KnowledgeBaseIpc.ArchiveFact, createEvent().event, input),
    ).resolves.toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.InvalidRequest },
    });
    expect(foundation.factProjector.archiveFact).not.toHaveBeenCalled();
  });

  test('rejects malformed mutation payloads with a stable code', async () => {
    const { deps, documentService } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    const result = await registeredHandlers.get(KnowledgeBaseIpc.DeleteDocument)?.(
      createEvent().event,
      { documentId: '', expectedRevision: -1 },
    );

    expect(documentService.deleteDocument).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.InvalidRequest },
    });
  });

  test('returns the latest display-safe document on revision conflict', async () => {
    const { deps, documentService } = makeDeps();
    documentService.deleteDocument = vi.fn(() => {
      throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCode.RevisionConflict, {
        latestDocument: documentItem(),
      });
    });
    registerKnowledgeBaseHandlers(deps);

    const result = await registeredHandlers.get(KnowledgeBaseIpc.DeleteDocument)?.(
      createEvent().event,
      { documentId: 'document-1', expectedRevision: 1 },
    );

    expect(result).toEqual({
      success: false,
      error: {
        code: KnowledgeBaseErrorCode.RevisionConflict,
        latestDocument: documentItem(),
      },
    });
    expect(JSON.stringify(result)).not.toContain('originalPath');
  });

  test.each([
    {
      name: 'document',
      error: addPrivateErrorSentinels(new KnowledgeDocumentServiceError(
        KnowledgeBaseErrorCode.SelectedFileMissing,
        { fileName: 'manual.pdf' },
      )),
      expected: {
        code: KnowledgeBaseErrorCode.SelectedFileMissing,
        fileName: 'manual.pdf',
      },
    },
    {
      name: 'selection',
      error: addPrivateErrorSentinels(
        new KnowledgeSelectionTokenError(KnowledgeBaseErrorCode.TooManyFiles),
      ),
      expected: { code: KnowledgeBaseErrorCode.TooManyFiles },
    },
    {
      name: 'authorization',
      error: addPrivateErrorSentinels(new KnowledgeExtractionAuthorizationError(
        KnowledgeBaseErrorCode.InvalidExtractionAuthorization,
      )),
      expected: { code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization },
    },
    {
      name: 'enrichment request state',
      error: addPrivateErrorSentinels(new KnowledgeEnrichmentRequestStateError(
        KnowledgeBaseErrorCode.EnrichmentRequestStale,
      )),
      expected: { code: KnowledgeBaseErrorCode.EnrichmentRequestStale },
    },
    {
      name: 'enrichment revision conflict without latest summary',
      error: addPrivateErrorSentinels(new KnowledgeEnrichmentRevisionConflictError(
        enrichmentSummary(privacySentinels[1]),
      )),
      expected: { code: KnowledgeBaseErrorCode.RevisionConflict },
    },
    {
      name: 'fact state',
      error: addPrivateErrorSentinels(new KnowledgeFactStateError(
        KnowledgeBaseErrorCode.FactEvidenceStale,
      )),
      expected: { code: KnowledgeBaseErrorCode.FactEvidenceStale },
    },
    {
      name: 'fact projector',
      error: addPrivateErrorSentinels(new KnowledgeFactProjectorError(
        KnowledgeBaseErrorCode.FactRevisionConflict,
      )),
      expected: { code: KnowledgeBaseErrorCode.FactRevisionConflict },
    },
    {
      name: 'projection conflict exact DTO',
      error: addPrivateErrorSentinels(
        new KnowledgeFactProjectionConflictError(projectionConflict),
      ),
      expected: {
        code: KnowledgeBaseErrorCode.FactProjectionConflict,
        projectionConflict,
      },
    },
  ])('maps the $name typed family without private fields or diagnostics', async ({
    error,
    expected,
  }) => {
    const { deps, foundation } = makeDeps();
    foundation.factQueryService.listFacts = vi.fn(() => { throw error; });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registerKnowledgeBaseHandlers(deps);

    const result = await invoke(KnowledgeBaseIpc.ListFacts, createEvent().event, {
      workspaceId: 'workspace-a',
    });
    const logCalls = [...log.mock.calls];
    log.mockRestore();

    expect(result).toEqual({ success: false, error: expected });
    expect(logCalls).toEqual([]);
    const serialized = JSON.stringify({ result, logCalls });
    privacySentinels.forEach(sentinel => expect(serialized).not.toContain(sentinel));
  });

  test.each([
    {
      name: 'unknown',
      error: addPrivateErrorSentinels(new Error(privacySentinels[0])),
    },
    {
      name: 'transient SQLite',
      error: addPrivateErrorSentinels(new KnowledgeEnrichmentTransientSqliteError('SQLITE_BUSY')),
    },
    {
      name: 'authorization callback',
      error: addPrivateErrorSentinels(new KnowledgeExtractionAuthorizationCallbackFailure(
        KnowledgeExtractionAuthorizationCallbackDisposition.RetryablePersistenceFailure,
        KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
      )),
    },
  ])('maps $name failures to one fixed persistence diagnostic', async ({ error }) => {
    const { deps, foundation } = makeDeps();
    foundation.factQueryService.listFacts = vi.fn(() => { throw error; });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registerKnowledgeBaseHandlers(deps);

    const result = await invoke(KnowledgeBaseIpc.ListFacts, createEvent().event, {
      workspaceId: 'workspace-a',
    });
    const logCalls = [...log.mock.calls];
    log.mockRestore();

    expect(result).toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.PersistenceFailed },
    });
    expect(logCalls).toEqual([
      ['[KnowledgeBase]', { code: 'ipc_operation_failed' }],
    ]);
    const serialized = JSON.stringify({ result, logCalls });
    privacySentinels.forEach(sentinel => expect(serialized).not.toContain(sentinel));
  });

  test('maps a hostile thrown proxy to one fixed persistence diagnostic', async () => {
    const hostileErrorSecret = 'hostile-error-secret';
    const hostileTrapSecret = 'hostile-getPrototypeOf-trap-secret';
    const getPrototypeOf = vi.fn(() => { throw new Error(hostileTrapSecret); });
    const hostileError = new Proxy(new Error(hostileErrorSecret), {
      getPrototypeOf,
    });
    const { deps, foundation } = makeDeps();
    foundation.factQueryService.listFacts = (() => {
      throw hostileError;
    }) as unknown as typeof foundation.factQueryService.listFacts;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registerKnowledgeBaseHandlers(deps);

    const outcome = await invoke(KnowledgeBaseIpc.ListFacts, createEvent().event, {
      workspaceId: 'workspace-a',
    }).then(
      value => ({ status: 'fulfilled' as const, value }),
      error => ({ status: 'rejected' as const, error }),
    );
    const logCalls = [...log.mock.calls];
    log.mockRestore();

    expect(outcome).toEqual({
      status: 'fulfilled',
      value: {
        success: false,
        error: { code: KnowledgeBaseErrorCode.PersistenceFailed },
      },
    });
    expect(getPrototypeOf).toHaveBeenCalledOnce();
    expect(logCalls).toEqual([
      ['[KnowledgeBase]', { code: 'ipc_operation_failed' }],
    ]);
    const serialized = JSON.stringify({ outcome, logCalls });
    expect(serialized).not.toContain(hostileErrorSecret);
    expect(serialized).not.toContain(hostileTrapSecret);
  });

  test('routes a validated local-index retry to the dedicated service method', async () => {
    const { deps, documentService } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    const result = await registeredHandlers.get(KnowledgeBaseIpc.RetryLocalIndex)?.(
      createEvent().event,
      { documentId: ' document-a ', documentVersionId: ' version-a ' },
    );

    expect(documentService.retryLocalIndex).toHaveBeenCalledWith({
      documentId: 'document-a',
      documentVersionId: 'version-a',
    });
    expect(result).toMatchObject({ success: true });
  });

  test.each([
    null,
    {},
    { documentId: '', documentVersionId: 'version-a' },
    { documentId: 'document-a', documentVersionId: '   ' },
    { documentId: 'document-a', documentVersionId: 7 },
  ])('rejects invalid local-index retry input without calling service', async input => {
    const { deps, documentService } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    await expect(
      registeredHandlers.get(KnowledgeBaseIpc.RetryLocalIndex)?.(createEvent().event, input),
    ).resolves.toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.InvalidRequest },
    });
    expect(documentService.retryLocalIndex).not.toHaveBeenCalled();
  });

  test('does not expose unknown local-index retry failures', async () => {
    const { deps, documentService } = makeDeps();
    documentService.retryLocalIndex = vi.fn(() => {
      throw new Error('/private/customer/secret.pdf SQLITE_BUSY');
    });
    registerKnowledgeBaseHandlers(deps);

    const result = await registeredHandlers.get(KnowledgeBaseIpc.RetryLocalIndex)?.(
      createEvent().event,
      { documentId: 'document-1', documentVersionId: 'version-1' },
    );

    expect(result).toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.PersistenceFailed },
    });
    expect(JSON.stringify(result)).not.toContain('/private/customer');
    expect(JSON.stringify(result)).not.toContain('SQLITE_BUSY');
  });

  test.each([
    [KnowledgeBaseIpc.ImportSelection, {
      workspaceId: 'workspace-a', selectionToken: 'selection-token', ownerId: 99,
    }],
    [KnowledgeBaseIpc.PrepareExtractionAuthorization, {
      documentId: 'document-1', documentVersionId: 'version-1', ownerId: 99,
    }],
    [KnowledgeBaseIpc.RequestExtraction, {
      authorizationToken: 'authorization-token', ownerId: 99,
    }],
    [KnowledgeBaseIpc.RetryExtraction, {
      requestId: 'request-1', authorizationToken: 'authorization-token', ownerId: 99,
    }],
    [KnowledgeBaseIpc.CancelExtraction, {
      requestId: 'request-1', expectedRevision: 1, ownerId: 99,
    }],
    [KnowledgeBaseIpc.ListFacts, { workspaceId: 'workspace-a', ownerId: 99 }],
    [KnowledgeBaseIpc.ReviewFact, {
      factId: 'fact-1',
      expectedRevision: 1,
      decision: KnowledgeFactReviewDecision.Confirm,
      ownerId: 99,
    }],
    [KnowledgeBaseIpc.ArchiveFact, {
      factId: 'fact-1', expectedRevision: 1, ownerId: 99,
    }],
    [KnowledgeBaseIpc.GetFactEvidence, {
      factId: 'fact-1', expectedRevision: 1, ownerId: 99,
    }],
  ])('rejects renderer owner spoofing on %s', async (channel, input) => {
    const { deps, documentService, foundation } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    await expect(invoke(channel, createEvent(7).event, input)).resolves.toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.InvalidRequest },
    });
    expect(documentService.importSelection).not.toHaveBeenCalled();
    expect(foundation.enrichmentService.prepareExtractionAuthorization).not.toHaveBeenCalled();
    expect(foundation.enrichmentService.requestExtraction).not.toHaveBeenCalled();
    expect(foundation.enrichmentService.retryExtraction).not.toHaveBeenCalled();
    expect(foundation.enrichmentService.cancelExtraction).not.toHaveBeenCalled();
    expect(foundation.factQueryService.listFacts).not.toHaveBeenCalled();
    expect(foundation.factQueryService.getFactEvidence).not.toHaveBeenCalled();
    expect(foundation.factProjector.confirmFact).not.toHaveBeenCalled();
    expect(foundation.factProjector.rejectFact).not.toHaveBeenCalled();
    expect(foundation.factProjector.archiveFact).not.toHaveBeenCalled();
  });
});
