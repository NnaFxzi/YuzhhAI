import { describe, expect, test } from 'vitest';

import {
  KNOWLEDGE_EXTRACTION_AUTHORIZATION_TTL_MS,
  KnowledgeBaseErrorCode,
} from '../../shared/knowledgeBase/constants';
import type { KnowledgeEnrichmentLockedRoute } from './knowledgeEnrichmentTypes';
import {
  KnowledgeExtractionAuthorizationCallbackDisposition,
  KnowledgeExtractionAuthorizationCallbackFailure,
  KnowledgeExtractionAuthorizationError,
  type KnowledgeExtractionAuthorizationIssueInput,
  KnowledgeExtractionAuthorizationStore,
} from './knowledgeExtractionAuthorizationStore';

const OWNER_ID = 7;
const OTHER_OWNER_ID = 8;
const WORKSPACE_ID = 'workspace-1';
const DOCUMENT_ID = 'document-1';
const DOCUMENT_VERSION_ID = 'version-1';
const PUBLISHED_GENERATION_ID = 'generation-1';
const API_KEY = 'secret-api-key-value';
const ROUTING_FINGERPRINT = 'secret-routing-fingerprint';
const BASE_URL = 'https://private-model.example.test/v1';

function createLockedRoute(
  overrides: Partial<KnowledgeEnrichmentLockedRoute> = {},
): KnowledgeEnrichmentLockedRoute {
  return {
    workspaceId: WORKSPACE_ID,
    providerId: 'openai-compatible',
    providerLabel: 'Enterprise model',
    modelId: 'enterprise-model-v1',
    modelLabel: 'Enterprise Model V1',
    apiType: 'openai',
    apiConfig: {
      apiKey: API_KEY,
      baseURL: BASE_URL,
      model: 'enterprise-model-v1',
      apiType: 'openai',
    },
    routingFingerprint: ROUTING_FINGERPRINT,
    ...overrides,
  };
}

function createIssueInput(
  overrides: Partial<KnowledgeExtractionAuthorizationIssueInput> = {},
): KnowledgeExtractionAuthorizationIssueInput {
  return {
    ownerId: OWNER_ID,
    workspaceId: WORKSPACE_ID,
    documentId: DOCUMENT_ID,
    documentVersionId: DOCUMENT_VERSION_ID,
    publishedGenerationId: PUBLISHED_GENERATION_ID,
    documentDisplayName: 'Private source.docx',
    lockedRoute: createLockedRoute(),
    plannedModelCalls: 3,
    partial: false,
    ...overrides,
  };
}

function createTokenGenerator(tokens: readonly string[]): () => string {
  let index = 0;
  return () => tokens[index++] ?? `token-${index}`;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function captureAuthorizationError(promise: Promise<unknown>): Promise<KnowledgeExtractionAuthorizationError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeExtractionAuthorizationError);
    return error as KnowledgeExtractionAuthorizationError;
  }
  throw new Error('Expected authorization operation to reject.');
}

describe('KnowledgeExtractionAuthorizationStore', () => {
  test('issues an opaque owner-bound preparation with an exact safe expiry', () => {
    const now = 1_000;
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => now,
      tokenGenerator: () => 'opaque-authorization-token',
    });

    const preparation = store.issue(createIssueInput());

    expect(preparation).toEqual({
      authorizationToken: 'opaque-authorization-token',
      descriptor: {
        workspaceId: WORKSPACE_ID,
        documentId: DOCUMENT_ID,
        documentVersionId: DOCUMENT_VERSION_ID,
        documentDisplayName: 'Private source.docx',
        providerId: 'openai-compatible',
        providerLabel: 'Enterprise model',
        modelId: 'enterprise-model-v1',
        modelLabel: 'Enterprise Model V1',
        plannedModelCalls: 3,
        partial: false,
        expiresAt: new Date(now + KNOWLEDGE_EXTRACTION_AUTHORIZATION_TTL_MS).toISOString(),
      },
    });
    const serialized = JSON.stringify(preparation);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain(BASE_URL);
    expect(serialized).not.toContain(ROUTING_FINGERPRINT);
    expect(serialized).not.toContain('apiConfig');
    expect(serialized).not.toContain('ownerId');
    expect(serialized).not.toContain(PUBLISHED_GENERATION_ID);
  });

  test('passes an isolated exact internal context to a synchronous request callback', async () => {
    const lockedRoute = createLockedRoute();
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => 1_000,
      tokenGenerator: () => 'context-token',
    });
    const preparation = store.issue(createIssueInput({ lockedRoute }));
    let callbackContext: unknown;

    const requestId = await store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      context => {
        callbackContext = context;
        context.lockedRoute.apiConfig.apiKey = 'callback-mutation';
        return 'request-1';
      },
    );

    expect(requestId).toBe('request-1');
    expect(callbackContext).toEqual(expect.objectContaining({
      ownerId: OWNER_ID,
      workspaceId: WORKSPACE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: DOCUMENT_VERSION_ID,
      publishedGenerationId: PUBLISHED_GENERATION_ID,
      documentDisplayName: 'Private source.docx',
      plannedModelCalls: 3,
      partial: false,
      lockedRoute: expect.objectContaining({
        routingFingerprint: ROUTING_FINGERPRINT,
        apiConfig: expect.objectContaining({ apiKey: 'callback-mutation' }),
      }),
    }));
    expect(lockedRoute.apiConfig.apiKey).toBe(API_KEY);
    expect(JSON.stringify(requestId)).not.toContain(API_KEY);
    expect(JSON.stringify(requestId)).not.toContain(ROUTING_FINGERPRINT);
  });

  test('accepts consumption one millisecond before expiry', async () => {
    let now = 5_000;
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => now,
      tokenGenerator: () => 'before-expiry-token',
    });
    const preparation = store.issue(createIssueInput());
    now += KNOWLEDGE_EXTRACTION_AUTHORIZATION_TTL_MS - 1;

    await expect(store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      () => 'request-before-expiry',
    )).resolves.toBe('request-before-expiry');
  });

  test('expires a descriptor at the exact expiry boundary without invoking the callback', async () => {
    let now = 5_000;
    let callbackCalls = 0;
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => now,
      tokenGenerator: () => 'exact-expiry-token',
    });
    const preparation = store.issue(createIssueInput());
    now += KNOWLEDGE_EXTRACTION_AUTHORIZATION_TTL_MS;

    const error = await captureAuthorizationError(store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      () => {
        callbackCalls += 1;
        return 'request-must-not-exist';
      },
    ));

    expect(error.code).toBe(KnowledgeBaseErrorCode.ExpiredExtractionAuthorization);
    expect(callbackCalls).toBe(0);
  });

  test('rejects a foreign owner without damaging the rightful owner authorization', async () => {
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => 1_000,
      tokenGenerator: () => 'owner-bound-token',
    });
    const preparation = store.issue(createIssueInput());
    let foreignCallbackCalls = 0;

    const foreignError = await captureAuthorizationError(store.consume(
      preparation.authorizationToken,
      OTHER_OWNER_ID,
      () => {
        foreignCallbackCalls += 1;
        return 'foreign-request';
      },
    ));

    expect(foreignError.code).toBe(KnowledgeBaseErrorCode.ForeignExtractionAuthorizationOwner);
    expect(foreignCallbackCalls).toBe(0);
    await expect(store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      () => 'rightful-request',
    )).resolves.toBe('rightful-request');
  });

  test('replays a successful receipt to the same owner without invoking another callback', async () => {
    let now = 1_000;
    let callbackCalls = 0;
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => now,
      tokenGenerator: () => 'receipt-token',
    });
    const preparation = store.issue(createIssueInput());
    const createRequest = () => {
      callbackCalls += 1;
      return 'committed-request';
    };

    await expect(store.consume(preparation.authorizationToken, OWNER_ID, createRequest)).resolves.toBe(
      'committed-request',
    );
    now += KNOWLEDGE_EXTRACTION_AUTHORIZATION_TTL_MS - 1;
    await expect(store.consume(preparation.authorizationToken, OWNER_ID, createRequest)).resolves.toBe(
      'committed-request',
    );
    expect(callbackCalls).toBe(1);

    now += 1;
    const expiredReceiptError = await captureAuthorizationError(
      store.consume(preparation.authorizationToken, OWNER_ID, createRequest),
    );
    expect(expiredReceiptError.code).toBe(KnowledgeBaseErrorCode.ExpiredExtractionAuthorization);
    expect(callbackCalls).toBe(1);
  });

  test('does not let a foreign owner damage a successful receipt replay', async () => {
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => 1_000,
      tokenGenerator: () => 'receipt-owner-token',
    });
    const preparation = store.issue(createIssueInput());
    await store.consume(preparation.authorizationToken, OWNER_ID, () => 'receipt-request');

    const error = await captureAuthorizationError(
      store.consume(preparation.authorizationToken, OTHER_OWNER_ID, () => 'foreign-request'),
    );

    expect(error.code).toBe(KnowledgeBaseErrorCode.ForeignExtractionAuthorizationOwner);
    await expect(
      store.consume(preparation.authorizationToken, OWNER_ID, () => 'duplicate-request'),
    ).resolves.toBe('receipt-request');
  });

  test('shares one in-flight promise and invokes the callback exactly once', async () => {
    const request = deferred<string>();
    let callbackCalls = 0;
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => 1_000,
      tokenGenerator: () => 'concurrent-token',
    });
    const preparation = store.issue(createIssueInput());
    const createRequest = () => {
      callbackCalls += 1;
      return request.promise;
    };

    const first = store.consume(preparation.authorizationToken, OWNER_ID, createRequest);
    const second = store.consume(preparation.authorizationToken, OWNER_ID, createRequest);

    expect(first).toBe(second);
    await Promise.resolve();
    expect(callbackCalls).toBe(1);
    request.resolve('shared-request');
    await expect(first).resolves.toBe('shared-request');
    await expect(second).resolves.toBe('shared-request');
  });

  test('registers in-flight state before a reentrant callback can consume again', async () => {
    let nestedCallbackCalls = 0;
    let nestedConsumption: Promise<string> | undefined;
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => 1_000,
      tokenGenerator: () => 'reentrant-token',
    });
    const preparation = store.issue(createIssueInput());

    const result = store.consume(preparation.authorizationToken, OWNER_ID, () => {
      nestedConsumption = store.consume(preparation.authorizationToken, OWNER_ID, () => {
        nestedCallbackCalls += 1;
        return 'nested-request';
      });
      return 'outer-request';
    });

    await expect(result).resolves.toBe('outer-request');
    await expect(nestedConsumption).resolves.toBe('outer-request');
    expect(nestedCallbackCalls).toBe(0);
  });

  test('retains an unexpired descriptor only for a classified retryable persistence failure', async () => {
    let callbackCalls = 0;
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => 1_000,
      tokenGenerator: () => 'retryable-token',
    });
    const preparation = store.issue(createIssueInput());

    const firstError = await captureAuthorizationError(store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      () => {
        callbackCalls += 1;
        throw new KnowledgeExtractionAuthorizationCallbackFailure(
          KnowledgeExtractionAuthorizationCallbackDisposition.RetryablePersistenceFailure,
          KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
        );
      },
    ));

    expect(firstError.code).toBe(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
    await expect(store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      () => {
        callbackCalls += 1;
        return 'retry-request';
      },
    )).resolves.toBe('retry-request');
    expect(callbackCalls).toBe(2);
  });

  test.each([
    KnowledgeBaseErrorCode.WorkspaceNotFound,
    KnowledgeBaseErrorCode.DocumentNotFound,
    KnowledgeBaseErrorCode.DocumentNotReady,
    KnowledgeBaseErrorCode.LocalIndexNotReady,
    KnowledgeBaseErrorCode.ModelConfigurationUnavailable,
    KnowledgeBaseErrorCode.ModelConfigurationChanged,
    KnowledgeBaseErrorCode.UnsupportedModelProvider,
    KnowledgeBaseErrorCode.EnrichmentRequestNotFound,
    KnowledgeBaseErrorCode.EnrichmentRequestStale,
    KnowledgeBaseErrorCode.EnrichmentAlreadyActive,
  ])('invalidates the token with exact allowlisted code %s', async code => {
    let callbackCalls = 0;
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => 1_000,
      tokenGenerator: () => 'invalidated-token',
    });
    const preparation = store.issue(createIssueInput());

    const firstError = await captureAuthorizationError(store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      () => {
        callbackCalls += 1;
        throw new KnowledgeExtractionAuthorizationCallbackFailure(
          KnowledgeExtractionAuthorizationCallbackDisposition.InvalidateAuthorization,
          code,
        );
      },
    ));
    const secondError = await captureAuthorizationError(store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      () => {
        callbackCalls += 1;
        return 'must-not-be-created';
      },
    ));

    expect(firstError.code).toBe(code);
    expect(secondError.code).toBe(KnowledgeBaseErrorCode.InvalidExtractionAuthorization);
    expect(callbackCalls).toBe(1);
  });

  test('rejects arbitrary callback codes and retains no caller-controlled message', () => {
    let error: unknown;
    try {
      new KnowledgeExtractionAuthorizationCallbackFailure(
        KnowledgeExtractionAuthorizationCallbackDisposition.InvalidateAuthorization,
        'secret-callback-code /private/database.sqlite' as KnowledgeBaseErrorCode,
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('secret-callback-code');
    expect(String(error)).not.toContain('/private/database.sqlite');
  });

  test('callback failures expose only disposition and an allowlisted code as data', () => {
    const failure = new KnowledgeExtractionAuthorizationCallbackFailure(
      KnowledgeExtractionAuthorizationCallbackDisposition.InvalidateAuthorization,
      KnowledgeBaseErrorCode.DocumentNotReady,
    );

    expect(Object.keys(failure).sort()).toEqual(['code', 'disposition']);
    expect(failure).not.toHaveProperty('cause');
  });

  test('fails closed and invalidates the token after an unknown callback error', async () => {
    let callbackCalls = 0;
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => 1_000,
      tokenGenerator: () => 'unknown-failure-token',
    });
    const preparation = store.issue(createIssueInput());

    const firstError = await captureAuthorizationError(store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      () => {
        callbackCalls += 1;
        throw new Error('SQLITE_BUSY /private/database.sqlite secret-api-key-value');
      },
    ));
    const secondError = await captureAuthorizationError(store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      () => {
        callbackCalls += 1;
        return 'must-not-be-created';
      },
    ));

    expect(firstError.code).toBe(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
    expect(secondError.code).toBe(KnowledgeBaseErrorCode.InvalidExtractionAuthorization);
    expect(callbackCalls).toBe(1);
  });

  test('clears descriptors and receipts for one owner without affecting another owner', async () => {
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => 1_000,
      tokenGenerator: createTokenGenerator(['owner-descriptor', 'owner-receipt', 'other-owner']),
    });
    const ownerDescriptor = store.issue(createIssueInput());
    const ownerReceipt = store.issue(createIssueInput({ documentId: 'document-2' }));
    const otherOwner = store.issue(createIssueInput({
      ownerId: OTHER_OWNER_ID,
      documentId: 'document-3',
    }));
    await store.consume(ownerReceipt.authorizationToken, OWNER_ID, () => 'owner-receipt-request');

    store.clearOwner(OWNER_ID);

    await expect(store.consume(
      ownerDescriptor.authorizationToken,
      OWNER_ID,
      () => 'cleared-descriptor-request',
    )).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization });
    await expect(store.consume(
      ownerReceipt.authorizationToken,
      OWNER_ID,
      () => 'cleared-receipt-request',
    )).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization });
    await expect(store.consume(
      otherOwner.authorizationToken,
      OTHER_OWNER_ID,
      () => 'other-owner-request',
    )).resolves.toBe('other-owner-request');
  });

  test('clears descriptors and receipts for one workspace without affecting another workspace', async () => {
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => 1_000,
      tokenGenerator: createTokenGenerator(['workspace-descriptor', 'workspace-receipt', 'other-workspace']),
    });
    const workspaceDescriptor = store.issue(createIssueInput());
    const workspaceReceipt = store.issue(createIssueInput({ documentId: 'document-2' }));
    const otherWorkspace = store.issue(createIssueInput({
      workspaceId: 'workspace-2',
      documentId: 'document-3',
      lockedRoute: createLockedRoute({ workspaceId: 'workspace-2' }),
    }));
    await store.consume(
      workspaceReceipt.authorizationToken,
      OWNER_ID,
      () => 'workspace-receipt-request',
    );

    store.clearWorkspace(WORKSPACE_ID);

    await expect(store.consume(
      workspaceDescriptor.authorizationToken,
      OWNER_ID,
      () => 'cleared-descriptor-request',
    )).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization });
    await expect(store.consume(
      workspaceReceipt.authorizationToken,
      OWNER_ID,
      () => 'cleared-receipt-request',
    )).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization });
    await expect(store.consume(
      otherWorkspace.authorizationToken,
      OWNER_ID,
      () => 'other-workspace-request',
    )).resolves.toBe('other-workspace-request');
  });

  test('does not return success or revive a receipt when clearWorkspace races a callback', async () => {
    const request = deferred<string>();
    let callbackCalls = 0;
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => 1_000,
      tokenGenerator: () => 'workspace-race-token',
    });
    const preparation = store.issue(createIssueInput());
    const consuming = store.consume(preparation.authorizationToken, OWNER_ID, () => {
      callbackCalls += 1;
      return request.promise;
    });
    await Promise.resolve();

    store.clearWorkspace(WORKSPACE_ID);
    request.resolve('late-workspace-request');

    await expect(consuming).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization,
    });
    await expect(store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      () => {
        callbackCalls += 1;
        return 'revived-workspace-request';
      },
    )).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization });
    expect(callbackCalls).toBe(1);
  });

  test('does not invoke the callback when clearWorkspace runs in the same tick', async () => {
    let callbackCalls = 0;
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => 1_000,
      tokenGenerator: () => 'same-tick-workspace-clear-token',
    });
    const preparation = store.issue(createIssueInput());

    const consuming = store.consume(preparation.authorizationToken, OWNER_ID, () => {
      callbackCalls += 1;
      return 'must-not-be-created';
    });
    store.clearWorkspace(WORKSPACE_ID);

    await expect(consuming).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization,
    });
    await expect(store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      () => {
        callbackCalls += 1;
        return 'must-not-be-revived';
      },
    )).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization });
    expect(callbackCalls).toBe(0);
  });

  test('does not return success or revive a receipt when clearOwner races a callback', async () => {
    const request = deferred<string>();
    let callbackCalls = 0;
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => 1_000,
      tokenGenerator: () => 'owner-race-token',
    });
    const preparation = store.issue(createIssueInput());
    const consuming = store.consume(preparation.authorizationToken, OWNER_ID, () => {
      callbackCalls += 1;
      return request.promise;
    });
    await Promise.resolve();

    store.clearOwner(OWNER_ID);
    request.resolve('late-owner-request');

    await expect(consuming).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization,
    });
    await expect(store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      () => {
        callbackCalls += 1;
        return 'revived-owner-request';
      },
    )).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization });
    expect(callbackCalls).toBe(1);
  });

  test('does not invoke the callback when clearOwner runs in the same tick', async () => {
    let callbackCalls = 0;
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => 1_000,
      tokenGenerator: () => 'same-tick-owner-clear-token',
    });
    const preparation = store.issue(createIssueInput());

    const consuming = store.consume(preparation.authorizationToken, OWNER_ID, () => {
      callbackCalls += 1;
      return 'must-not-be-created';
    });
    store.clearOwner(OWNER_ID);

    await expect(consuming).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization,
    });
    await expect(store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      () => {
        callbackCalls += 1;
        return 'must-not-be-revived';
      },
    )).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization });
    expect(callbackCalls).toBe(0);
  });

  test('does not invoke the callback when exact expiry occurs in the same tick', async () => {
    let now = 1_000;
    let callbackCalls = 0;
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => now,
      tokenGenerator: () => 'same-tick-expiry-token',
    });
    const preparation = store.issue(createIssueInput());

    const consuming = store.consume(preparation.authorizationToken, OWNER_ID, () => {
      callbackCalls += 1;
      return 'must-not-be-created';
    });
    now += KNOWLEDGE_EXTRACTION_AUTHORIZATION_TTL_MS;

    await expect(consuming).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.ExpiredExtractionAuthorization,
    });
    await expect(store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      () => {
        callbackCalls += 1;
        return 'must-not-be-revived';
      },
    )).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization });
    expect(callbackCalls).toBe(0);
  });

  test('returns a committed request when TTL crosses only after the callback starts', async () => {
    let now = 1_000;
    let callbackCalls = 0;
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => now,
      tokenGenerator: () => 'commit-crosses-expiry-token',
    });
    const preparation = store.issue(createIssueInput());

    const requestId = await store.consume(preparation.authorizationToken, OWNER_ID, () => {
      callbackCalls += 1;
      now += KNOWLEDGE_EXTRACTION_AUTHORIZATION_TTL_MS;
      return 'committed-before-expiry-gate';
    });

    expect(requestId).toBe('committed-before-expiry-gate');
    await expect(store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      () => {
        callbackCalls += 1;
        return 'must-not-replay';
      },
    )).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.ExpiredExtractionAuthorization });
    expect(callbackCalls).toBe(1);
  });

  test('keeps an expired running authorization reserved until its own promise settles', async () => {
    let now = 1_000;
    let callbackCalls = 0;
    const request = deferred<string>();
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => now,
      tokenGenerator: () => 'running-expiry-token',
    });
    const preparation = store.issue(createIssueInput());
    const firstConsumption = store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      () => {
        callbackCalls += 1;
        return request.promise;
      },
    );
    await Promise.resolve();
    now += KNOWLEDGE_EXTRACTION_AUTHORIZATION_TTL_MS;

    await expect(store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      () => {
        callbackCalls += 1;
        return 'duplicate-request';
      },
    )).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.ExpiredExtractionAuthorization });
    expect(() => store.issue(createIssueInput({ documentId: 'replacement-document' }))).toThrowError(
      expect.objectContaining({ code: KnowledgeBaseErrorCode.InvalidRequest }),
    );

    request.resolve('original-committed-request');
    await expect(firstConsumption).resolves.toBe('original-committed-request');
    expect(callbackCalls).toBe(1);

    const replacement = store.issue(createIssueInput({ documentId: 'replacement-document' }));
    expect(replacement.authorizationToken).toBe('running-expiry-token');
  });

  test('does not retain a retryable descriptor when workspace cleanup races the callback', async () => {
    const request = deferred<string>();
    let callbackCalls = 0;
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => 1_000,
      tokenGenerator: () => 'retryable-race-token',
    });
    const preparation = store.issue(createIssueInput());
    const consuming = store.consume(preparation.authorizationToken, OWNER_ID, () => {
      callbackCalls += 1;
      return request.promise;
    });
    await Promise.resolve();

    store.clearWorkspace(WORKSPACE_ID);
    request.reject(new KnowledgeExtractionAuthorizationCallbackFailure(
      KnowledgeExtractionAuthorizationCallbackDisposition.RetryablePersistenceFailure,
      KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
    ));

    await expect(consuming).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization,
    });
    await expect(store.consume(
      preparation.authorizationToken,
      OWNER_ID,
      () => {
        callbackCalls += 1;
        return 'must-not-retry';
      },
    )).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization });
    expect(callbackCalls).toBe(1);
  });

  test('lazily prunes expired descriptors and receipts', async () => {
    let now = 1_000;
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => now,
      tokenGenerator: createTokenGenerator(['expired-descriptor', 'expired-receipt', 'prune-trigger']),
    });
    const descriptor = store.issue(createIssueInput());
    const receipt = store.issue(createIssueInput({ documentId: 'document-2' }));
    await store.consume(receipt.authorizationToken, OWNER_ID, () => 'expired-receipt-request');
    now += KNOWLEDGE_EXTRACTION_AUTHORIZATION_TTL_MS;

    store.issue(createIssueInput({ documentId: 'document-3' }));

    await expect(store.consume(
      descriptor.authorizationToken,
      OWNER_ID,
      () => 'expired-descriptor-request',
    )).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization });
    await expect(store.consume(
      receipt.authorizationToken,
      OWNER_ID,
      () => 'expired-receipt-replay',
    )).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization });
  });

  test('serializes only stable public codes and fixed safe messages', async () => {
    let now = 1_000;
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => now,
      tokenGenerator: createTokenGenerator([
        'expired-sensitive-token',
        'foreign-sensitive-token',
        'callback-sensitive-token',
      ]),
    });
    const expired = store.issue(createIssueInput());
    now += KNOWLEDGE_EXTRACTION_AUTHORIZATION_TTL_MS;
    const expiredError = await captureAuthorizationError(store.consume(
      expired.authorizationToken,
      OWNER_ID,
      () => 'never-created',
    ));

    now = 1_000;
    const foreign = store.issue(createIssueInput());
    const foreignError = await captureAuthorizationError(store.consume(
      foreign.authorizationToken,
      OTHER_OWNER_ID,
      () => 'never-created',
    ));

    const callback = store.issue(createIssueInput());
    const callbackError = await captureAuthorizationError(store.consume(
      callback.authorizationToken,
      OWNER_ID,
      () => {
        throw new Error(
          `SQLITE_BUSY ${API_KEY} ${BASE_URL} ${ROUTING_FINGERPRINT} /private/database.sqlite`,
        );
      },
    ));

    const errors = [
      new KnowledgeExtractionAuthorizationError(
        KnowledgeBaseErrorCode.InvalidExtractionAuthorization,
      ),
      expiredError,
      foreignError,
      callbackError,
    ];
    const serialized = JSON.stringify(errors);
    expect(errors.map(error => error.code)).toEqual([
      KnowledgeBaseErrorCode.InvalidExtractionAuthorization,
      KnowledgeBaseErrorCode.ExpiredExtractionAuthorization,
      KnowledgeBaseErrorCode.ForeignExtractionAuthorizationOwner,
      KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
    ]);
    for (const secret of [
      'expired-sensitive-token',
      'foreign-sensitive-token',
      'callback-sensitive-token',
      API_KEY,
      BASE_URL,
      ROUTING_FINGERPRINT,
      '/private/database.sqlite',
      'SQLITE_BUSY',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(JSON.parse(serialized)).toEqual(errors.map(error => ({
      code: error.code,
      message: error.message,
    })));
  });

  test('rejects invalid issuance input without exposing route data', () => {
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => 1_000,
      tokenGenerator: () => 'invalid-issue-token',
    });

    let error: unknown;
    try {
      store.issue(createIssueInput({
        workspaceId: 'workspace-mismatch',
        plannedModelCalls: 0,
      }));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(KnowledgeExtractionAuthorizationError);
    expect(error).toMatchObject({ code: KnowledgeBaseErrorCode.InvalidRequest });
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain(BASE_URL);
    expect(serialized).not.toContain(ROUTING_FINGERPRINT);
  });

  test.each([
    {
      name: 'workspace id',
      mutate: (input: KnowledgeExtractionAuthorizationIssueInput) => {
        (input as unknown as { workspaceId: number }).workspaceId = 42;
      },
    },
    {
      name: 'route workspace id',
      mutate: (input: KnowledgeExtractionAuthorizationIssueInput) => {
        (input.lockedRoute as unknown as { workspaceId: { secret: string } }).workspaceId = {
          secret: API_KEY,
        };
      },
    },
    {
      name: 'route model id',
      mutate: (input: KnowledgeExtractionAuthorizationIssueInput) => {
        (input.lockedRoute.apiConfig as unknown as { model: string[] }).model = [API_KEY];
      },
    },
  ])('rejects a malformed runtime $name with a fixed safe error', ({ mutate }) => {
    const store = new KnowledgeExtractionAuthorizationStore({
      now: () => 1_000,
      tokenGenerator: () => 'malformed-issue-token',
    });
    const input = createIssueInput();
    mutate(input);

    let error: unknown;
    try {
      store.issue(input);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(KnowledgeExtractionAuthorizationError);
    expect(error).toMatchObject({ code: KnowledgeBaseErrorCode.InvalidRequest });
    expect(JSON.stringify(error)).not.toContain(API_KEY);
  });

  test('rejects a malformed clearWorkspace value with a fixed safe error', () => {
    const store = new KnowledgeExtractionAuthorizationStore({ now: () => 1_000 });

    let error: unknown;
    try {
      store.clearWorkspace(42 as unknown as string);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(KnowledgeExtractionAuthorizationError);
    expect(error).toMatchObject({ code: KnowledgeBaseErrorCode.InvalidRequest });
    expect(JSON.stringify(error)).toEqual(JSON.stringify({
      code: KnowledgeBaseErrorCode.InvalidRequest,
      message: 'The extraction authorization request is invalid.',
    }));
  });
});
