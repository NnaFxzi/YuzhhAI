import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  KNOWLEDGE_ENRICHMENT_HEARTBEAT_INTERVAL_MS,
  KNOWLEDGE_ENRICHMENT_MODEL_MAX_RESPONSE_BYTES,
  KNOWLEDGE_ENRICHMENT_MODEL_MAX_TOKENS,
  KNOWLEDGE_ENRICHMENT_MODEL_TIMEOUT_MS,
  KnowledgeBaseErrorCode,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentIndexTokenizer,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeEnrichmentAttemptOutcome,
  KnowledgeEnrichmentPartialReason,
  KnowledgeEnrichmentStatus,
  KnowledgeFactDomain,
} from '../../shared/knowledgeBase/constants';
import { ProviderName } from '../../shared/providers/constants';
import type { ProviderConfig } from '../../shared/providers/types';
import { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import type {
  ModelClientAdapter,
  ModelGenerationInput,
  ModelGenerationResult,
} from '../industryPack/modelClientAdapter';
import {
  ModelGenerationResponseFormat,
  ModelGenerationThinkingMode,
  ModelResponseInvalidContentError,
  ModelResponseInvalidJsonError,
  ModelResponseReadError,
  ModelResponseTooLargeError,
} from '../industryPack/modelClientAdapter';
import { applySqliteConnectionPolicy } from '../libs/sqliteConnectionPolicy';
import { chunkKnowledgeDocumentVersion } from './knowledgeDocumentChunker';
import { KnowledgeDocumentIndexStore } from './knowledgeDocumentIndexStore';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';
import { KnowledgeEnrichmentModelResolver } from './knowledgeEnrichmentModelResolver';
import { KnowledgeEnrichmentPublicationStore } from './knowledgeEnrichmentPublicationStore';
import { KnowledgeEnrichmentRequestStore } from './knowledgeEnrichmentRequestStore';
import {
  KnowledgeEnrichmentService,
  type KnowledgeEnrichmentServiceOptions,
} from './knowledgeEnrichmentService';
import type {
  KnowledgeEnrichmentWorkspaceRouteSource,
} from './knowledgeEnrichmentTypes';
import {
  KnowledgeExtractionAuthorizationError,
  KnowledgeExtractionAuthorizationStore,
} from './knowledgeExtractionAuthorizationStore';
import { KnowledgeFactStore } from './knowledgeFactStore';

const OWNER_ID = 17;
const NOW_1 = '2026-07-12T01:00:00.000Z';
const NOW_2 = '2026-07-12T01:01:00.000Z';
const WORKSPACE_ID = 'workspace-a';
const PROVIDER_ID = 'provider-a';
const MODEL_ID = 'model-a';
const API_KEY = 'sk-task-7-secret';
const temporaryDirectories: string[] = [];
const openDatabases: Database.Database[] = [];

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const providerConfig = (
  overrides: Partial<ProviderConfig> = {},
): ProviderConfig => ({
  enabled: true,
  apiKey: API_KEY,
  baseUrl: 'https://provider-a.example/v1',
  apiFormat: 'openai',
  displayName: 'Provider A',
  models: [{ id: MODEL_ID, name: 'Model A' }],
  ...overrides,
});

const routeSource = (
  overrides: {
    modelId?: string;
    providerId?: string;
    providers?: Record<string, ProviderConfig>;
  } = {},
): KnowledgeEnrichmentWorkspaceRouteSource => {
  const providerId = overrides.providerId ?? PROVIDER_ID;
  const modelId = overrides.modelId ?? MODEL_ID;
  return {
    id: WORKSPACE_ID,
    settings: {
      model: {
        defaultModel: modelId,
        defaultModelProvider: providerId,
        providers: overrides.providers ?? { [providerId]: providerConfig() },
      },
    },
  };
};

const emptyProfile = () => ({
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
});

const writeWorkspace = (
  db: Database.Database,
  source: KnowledgeEnrichmentWorkspaceRouteSource,
): void => {
  db.prepare(`
    INSERT INTO enterprise_lead_workspaces (
      id, name, type, profile, extraction_sources, risk_rules,
      enabled_agent_roles, settings, workspace_agents, recent_run_id,
      created_at, updated_at
    ) VALUES (
      ?, 'Workspace A', 'enterprise_lead', ?, '[]', '[]',
      '[]', ?, NULL, NULL, ?, ?
    )
  `).run(
    source.id,
    JSON.stringify(emptyProfile()),
    JSON.stringify({ model: source.settings.model }),
    NOW_1,
    NOW_1,
  );
};

const updateWorkspaceRoute = (
  db: Database.Database,
  source: KnowledgeEnrichmentWorkspaceRouteSource,
): void => {
  db.prepare(`
    UPDATE enterprise_lead_workspaces
    SET settings = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify({ model: source.settings.model }), NOW_2, source.id);
};

const loadRouteSource = (
  db: Database.Database,
  workspaceId: string,
): KnowledgeEnrichmentWorkspaceRouteSource | null => {
  expect(db.inTransaction).toBe(true);
  const row = db.prepare(`
    SELECT id, settings
    FROM enterprise_lead_workspaces
    WHERE id = ?
    LIMIT 1
  `).get(workspaceId) as { id: string; settings: string | null } | undefined;
  if (!row?.settings) return null;
  const settings = JSON.parse(row.settings) as KnowledgeEnrichmentWorkspaceRouteSource['settings'];
  return { id: row.id, settings };
};

const openDatabase = (databasePath = ':memory:'): Database.Database => {
  const db = new Database(databasePath);
  applySqliteConnectionPolicy(db);
  db.pragma('foreign_keys = ON');
  openDatabases.push(db);
  return db;
};

const fixedChunkText = (ordinal: number): string =>
  `chunk-${String(ordinal).padStart(3, '0')} industrial robots `.padEnd(64, 'x');

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const waitUntil = async (condition: () => boolean, label: string): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

type IndexedDocument = ReturnType<typeof createIndexedDocument>;

const createIndexedDocument = (
  documentStore: KnowledgeDocumentStore,
  indexStore: KnowledgeDocumentIndexStore,
  chunkCount: number,
  displayName = `source-${chunkCount}.txt`,
) => {
  const text = Array.from({ length: chunkCount }, (_, ordinal) => fixedChunkText(ordinal)).join('');
  const target = documentStore.createDocumentWithVersion({
    workspaceId: WORKSPACE_ID,
    displayName,
    sourceMode: KnowledgeDocumentSourceMode.Managed,
    status: KnowledgeDocumentStatus.Ready,
    version: {
      contentHash: sha256(text),
      managedPath: `blobs/${displayName}`,
      mimeType: 'text/plain',
      fileSize: text.length,
      sourceMtime: null,
      parser: 'text',
      extractedText: text,
      extractionPartial: false,
    },
  });
  indexStore.scheduleCurrentVersion({
    workspaceId: WORKSPACE_ID,
    documentId: target.document.id,
    documentVersionId: target.version.id,
  }, NOW_1);
  const claim = indexStore.claimNext(NOW_1)!;
  const chunks = chunkKnowledgeDocumentVersion({
    documentVersionId: target.version.id,
    text,
    targetChars: 64,
    overlapChars: 0,
  });
  expect(chunks).toHaveLength(chunkCount);
  for (let offset = 0; offset < chunks.length; offset += 8) {
    indexStore.stageVersionBatch({
      workspaceId: WORKSPACE_ID,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: claim.attempt.id,
      chunks: chunks.slice(offset, offset + 8),
    }, NOW_1);
  }
  const state = indexStore.publishVersion({
    workspaceId: WORKSPACE_ID,
    documentId: target.document.id,
    documentVersionId: target.version.id,
    attemptId: claim.attempt.id,
    chunkCount,
  }, NOW_1);
  return { chunks, state, target };
};

const republishDocument = (
  fixture: Fixture,
  document: IndexedDocument,
  chunkCount: number,
  indexStore = fixture.indexStore,
): IndexedDocument => {
  indexStore.scheduleCurrentVersion({
    workspaceId: WORKSPACE_ID,
    documentId: document.target.document.id,
    documentVersionId: document.target.version.id,
  }, NOW_2);
  const claim = indexStore.claimNext(NOW_2)!;
  const text = Array.from({ length: chunkCount }, (_, ordinal) => fixedChunkText(ordinal)).join('');
  const chunks = chunkKnowledgeDocumentVersion({
    documentVersionId: document.target.version.id,
    text,
    targetChars: 64,
    overlapChars: 0,
  });
  for (let offset = 0; offset < chunks.length; offset += 8) {
    indexStore.stageVersionBatch({
      workspaceId: WORKSPACE_ID,
      documentId: document.target.document.id,
      documentVersionId: document.target.version.id,
      attemptId: claim.attempt.id,
      chunks: chunks.slice(offset, offset + 8),
    }, NOW_2);
  }
  const state = indexStore.publishVersion({
    workspaceId: WORKSPACE_ID,
    documentId: document.target.document.id,
    documentVersionId: document.target.version.id,
    attemptId: claim.attempt.id,
    chunkCount,
  }, NOW_2);
  return { chunks, state, target: document.target };
};

type FixtureOptions = {
  busyRetryDelay?: KnowledgeEnrichmentServiceOptions['busyRetryDelay'];
  databasePath?: string;
  modelGenerate?: (input: ModelGenerationInput) => Promise<ModelGenerationResult>;
  requestAfterSelect?: () => void;
};

const createFixture = (options: FixtureOptions = {}) => {
  const db = openDatabase(options.databasePath);
  new EnterpriseLeadWorkspaceStore(db);
  writeWorkspace(db, routeSource());
  const documentStore = new KnowledgeDocumentStore(db);
  const indexStore = new KnowledgeDocumentIndexStore(db, {
    resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
  });
  let requestId = 0;
  const requestStore = new KnowledgeEnrichmentRequestStore(db, {
    uuidFactory: () => `request-${++requestId}`,
    clock: () => NOW_2,
    afterSelect: options.requestAfterSelect,
  });
  const factStore = new KnowledgeFactStore(db, { requestStore, clock: () => NOW_2 });
  const publicationStore = new KnowledgeEnrichmentPublicationStore(
    db,
    factStore,
    requestStore,
    {
      loadWorkspaceRouteSourceInCurrentTransaction: loadRouteSource,
      uuidFactory: (() => {
        let factId = 0;
        return () => `fact-${++factId}`;
      })(),
      clock: () => NOW_2,
    },
  );
  let tokenId = 0;
  const authorizationStore = new KnowledgeExtractionAuthorizationStore({
    now: () => Date.parse(NOW_1),
    tokenGenerator: () => `authorization-${++tokenId}`,
  });
  const modelGenerate = vi.fn(options.modelGenerate ?? (async () => ({
    text: JSON.stringify({ facts: [] }),
    raw: { secret: 'raw-provider-output' },
  })));
  const modelClient: ModelClientAdapter = { generate: modelGenerate };
  const modelResolver = new KnowledgeEnrichmentModelResolver({
    getWorkspace: workspaceId => {
      const transaction = db.transaction(() => loadRouteSource(db, workspaceId));
      return transaction();
    },
  });
  const service = new KnowledgeEnrichmentService({
    authorizationStore,
    busyRetryDelay: options.busyRetryDelay,
    clock: () => NOW_2,
    db,
    loadWorkspaceRouteSourceInCurrentTransaction: loadRouteSource,
    modelClient,
    modelResolver,
    publicationStore,
    requestStore,
  });
  return {
    authorizationStore,
    db,
    documentStore,
    factStore,
    indexStore,
    modelClient,
    modelGenerate,
    modelResolver,
    publicationStore,
    requestStore,
    service,
  };
};

type Fixture = ReturnType<typeof createFixture>;

const prepare = (fixture: Fixture, document: IndexedDocument) =>
  fixture.service.prepareExtractionAuthorization({
    ownerId: OWNER_ID,
    documentId: document.target.document.id,
    documentVersionId: document.target.version.id,
  });

const captureAuthorizationError = async (
  operation: Promise<unknown>,
): Promise<KnowledgeExtractionAuthorizationError> => {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeExtractionAuthorizationError);
    return error as KnowledgeExtractionAuthorizationError;
  }
  throw new Error('Expected authorization operation to reject');
};

const requestWithoutDrain = async (fixture: Fixture, document: IndexedDocument) => {
  const wake = vi.spyOn(fixture.service, 'wake').mockImplementation(() => undefined);
  const authorization = prepare(fixture, document);
  const summary = await fixture.service.requestExtraction({
    ownerId: OWNER_ID,
    authorizationToken: authorization.authorizationToken,
  });
  return { authorization, summary, wake };
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (openDatabases.length > 0) {
    const db = openDatabases.pop()!;
    try {
      db.close();
    } catch {
      // A test may close a connection early to assert a persistence boundary.
    }
  }
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop()!, { force: true, recursive: true });
  }
});

describe('KnowledgeEnrichmentService authorization preparation', () => {
  test.each([
    [1, 1, false],
    [30, 30, false],
    [31, 30, true],
  ])('locks the indexed total for %i chunks without invoking the model', async (
    chunkCount,
    plannedModelCalls,
    partial,
  ) => {
    const fixture = createFixture();
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, chunkCount);
    const getDocument = vi.spyOn(fixture.documentStore, 'getDocument');
    const getVersion = vi.spyOn(fixture.documentStore, 'getVersion');
    const getState = vi.spyOn(fixture.indexStore, 'getState');
    const listChunks = vi.spyOn(fixture.indexStore, 'listVersionChunks');

    const authorization = prepare(fixture, document);
    let context: unknown;
    await fixture.authorizationStore.consume(
      authorization.authorizationToken,
      OWNER_ID,
      value => {
        context = value;
        return 'inspection-request';
      },
    );

    expect(authorization.descriptor).toMatchObject({ plannedModelCalls, partial });
    expect(context).toMatchObject({
      plannedModelCalls,
      partial,
      publishedGenerationId: document.state.publishedGenerationId,
    });
    expect(JSON.stringify(authorization)).not.toContain(document.state.publishedGenerationId!);
    expect(getDocument).not.toHaveBeenCalled();
    expect(getVersion).not.toHaveBeenCalled();
    expect(getState).not.toHaveBeenCalled();
    expect(listChunks).not.toHaveBeenCalled();
    expect(fixture.modelGenerate).not.toHaveBeenCalled();
  });

  test('ignores document and index stores backed by a different database connection', () => {
    const fixture = createFixture();
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const foreignDb = openDatabase(':memory:');
    new EnterpriseLeadWorkspaceStore(foreignDb);
    const foreignDocumentStore = new KnowledgeDocumentStore(foreignDb);
    const foreignIndexStore = new KnowledgeDocumentIndexStore(foreignDb, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });
    const foreignGetDocument = vi.spyOn(foreignDocumentStore, 'getDocument');
    const foreignGetVersion = vi.spyOn(foreignDocumentStore, 'getVersion');
    const foreignGetState = vi.spyOn(foreignIndexStore, 'getState');
    const foreignListChunks = vi.spyOn(foreignIndexStore, 'listVersionChunks');
    const legacyOptions = {
      authorizationStore: fixture.authorizationStore,
      clock: () => NOW_2,
      db: fixture.db,
      loadWorkspaceRouteSourceInCurrentTransaction: loadRouteSource,
      modelClient: fixture.modelClient,
      modelResolver: fixture.modelResolver,
      publicationStore: fixture.publicationStore,
      requestStore: fixture.requestStore,
      documentStore: foreignDocumentStore,
      indexStore: foreignIndexStore,
    } as KnowledgeEnrichmentServiceOptions & {
      documentStore: KnowledgeDocumentStore;
      indexStore: KnowledgeDocumentIndexStore;
    };
    const service = new KnowledgeEnrichmentService(legacyOptions);

    const authorization = service.prepareExtractionAuthorization({
      ownerId: OWNER_ID,
      documentId: document.target.document.id,
      documentVersionId: document.target.version.id,
    });

    expect(authorization.descriptor).toMatchObject({
      documentId: document.target.document.id,
      documentVersionId: document.target.version.id,
      plannedModelCalls: 1,
    });
    expect(foreignGetDocument).not.toHaveBeenCalled();
    expect(foreignGetVersion).not.toHaveBeenCalled();
    expect(foreignGetState).not.toHaveBeenCalled();
    expect(foreignListChunks).not.toHaveBeenCalled();
  });

  test.each([
    ['deleted document', (fixture: Fixture, document: IndexedDocument) => {
      fixture.documentStore.softDeleteDocument(
        document.target.document.id,
        document.target.document.revision,
      );
    }, KnowledgeBaseErrorCode.DocumentNotFound],
    ['stale version', (fixture: Fixture, document: IndexedDocument) => {
      fixture.documentStore.addVersion(
        document.target.document.id,
        document.target.document.revision,
        {
          contentHash: sha256('replacement'),
          managedPath: 'blobs/replacement',
          mimeType: 'text/plain',
          fileSize: 11,
          sourceMtime: null,
          parser: 'text',
          extractedText: 'replacement',
          extractionPartial: false,
        },
      );
    }, KnowledgeBaseErrorCode.DocumentNotReady],
    ['processing document', (fixture: Fixture, document: IndexedDocument) => {
      fixture.documentStore.updateDocumentMetadata(
        document.target.document.id,
        document.target.document.revision,
        { status: KnowledgeDocumentStatus.Processing },
      );
    }, KnowledgeBaseErrorCode.DocumentNotReady],
    ['failed document', (fixture: Fixture, document: IndexedDocument) => {
      fixture.documentStore.updateDocumentMetadata(
        document.target.document.id,
        document.target.document.revision,
        { status: KnowledgeDocumentStatus.Failed },
      );
    }, KnowledgeBaseErrorCode.DocumentNotReady],
    ['empty text', (fixture: Fixture, document: IndexedDocument) => {
      fixture.db.prepare(`
        UPDATE knowledge_document_versions SET extracted_text = '' WHERE id = ?
      `).run(document.target.version.id);
    }, KnowledgeBaseErrorCode.DocumentNotReady],
    ['unindexed document', (fixture: Fixture, document: IndexedDocument) => {
      fixture.db.prepare(`
        UPDATE knowledge_document_index_state SET status = ? WHERE document_version_id = ?
      `).run(KnowledgeDocumentIndexStatus.Failed, document.target.version.id);
    }, KnowledgeBaseErrorCode.LocalIndexNotReady],
  ])('rejects a %s with its stable code', (
    _label,
    mutate,
    code,
  ) => {
    const fixture = createFixture();
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    mutate(fixture, document);

    expect(() => prepare(fixture, document)).toThrowError(
      expect.objectContaining({ code }),
    );
    expect(fixture.modelGenerate).not.toHaveBeenCalled();
  });
});

describe('KnowledgeEnrichmentService authorized request façade', () => {
  test('wakes exactly once only for the committed queued transition', async () => {
    const fixture = createFixture();
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const wake = vi.spyOn(fixture.service, 'wake').mockImplementation(() => undefined);
    const firstAuthorization = prepare(fixture, document);

    const first = await fixture.service.requestExtraction({
      ownerId: OWNER_ID,
      authorizationToken: firstAuthorization.authorizationToken,
    });
    const receiptReplay = await fixture.service.requestExtraction({
      ownerId: OWNER_ID,
      authorizationToken: firstAuthorization.authorizationToken,
    });
    const convergedAuthorization = prepare(fixture, document);
    const converged = await fixture.service.requestExtraction({
      ownerId: OWNER_ID,
      authorizationToken: convergedAuthorization.authorizationToken,
    });

    expect(first.status).toBe(KnowledgeEnrichmentStatus.Queued);
    expect(receiptReplay).toEqual(first);
    expect(converged).toEqual(first);
    expect(wake).toHaveBeenCalledOnce();
    expect(fixture.modelGenerate).not.toHaveBeenCalled();
  });

  test('returns an unchanged running request without waking the worker', async () => {
    const fixture = createFixture();
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const first = await requestWithoutDrain(fixture, document);
    const claim = fixture.requestStore.claimNext(NOW_1)!;
    first.wake.mockClear();

    const converged = await fixture.service.requestExtraction({
      ownerId: OWNER_ID,
      authorizationToken: prepare(fixture, document).authorizationToken,
    });

    expect(converged).toEqual(fixture.requestStore.getSummary(first.summary.requestId));
    expect(converged.status).toBe(KnowledgeEnrichmentStatus.Running);
    expect(claim.request.id).toBe(first.summary.requestId);
    expect(first.wake).not.toHaveBeenCalled();
    expect(fixture.modelGenerate).not.toHaveBeenCalled();
  });

  test('returns an unchanged review-required request without waking the worker', async () => {
    const fixture = createFixture({
      modelGenerate: async input => {
        const { chunkId } = JSON.parse(input.prompt) as { chunkId: string };
        return {
          text: JSON.stringify({
            facts: [{
              domain: KnowledgeFactDomain.ProductList,
              value: 'Industrial robots',
              chunkId,
              quote: 'industrial robots',
              confidence: 0.91,
            }],
          }),
        };
      },
    });
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const first = await requestWithoutDrain(fixture, document);
    first.wake.mockRestore();
    fixture.service.wake();
    await fixture.service.waitForIdle();
    const reviewRequired = fixture.requestStore.getSummary(first.summary.requestId)!;
    const wake = vi.spyOn(fixture.service, 'wake').mockImplementation(() => undefined);

    const converged = await fixture.service.requestExtraction({
      ownerId: OWNER_ID,
      authorizationToken: prepare(fixture, document).authorizationToken,
    });

    expect(reviewRequired.status).toBe(KnowledgeEnrichmentStatus.ReviewRequired);
    expect(converged).toEqual(reviewRequired);
    expect(wake).not.toHaveBeenCalled();
    expect(fixture.modelGenerate).toHaveBeenCalledOnce();
  });

  test('returns an exact latest failed request unchanged and requeues it only with fresh retry consent', async () => {
    const fixture = createFixture();
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const first = await requestWithoutDrain(fixture, document);
    const claim = fixture.requestStore.claimNext(NOW_1)!;
    fixture.requestStore.failAttempt(first.summary.requestId, claim.attempt.id, {
      code: KnowledgeBaseErrorCode.ModelRequestFailed,
      now: NOW_2,
    });
    first.wake.mockClear();
    const ordinaryAuthorization = prepare(fixture, document);

    const unchanged = await fixture.service.requestExtraction({
      ownerId: OWNER_ID,
      authorizationToken: ordinaryAuthorization.authorizationToken,
    });
    const retryAuthorization = prepare(fixture, document);
    const retried = await fixture.service.retryExtraction({
      ownerId: OWNER_ID,
      requestId: first.summary.requestId,
      authorizationToken: retryAuthorization.authorizationToken,
    });

    expect(unchanged.status).toBe(KnowledgeEnrichmentStatus.Failed);
    expect(unchanged.errorCode).toBe(KnowledgeBaseErrorCode.ModelRequestFailed);
    expect(retried).toMatchObject({
      requestId: first.summary.requestId,
      status: KnowledgeEnrichmentStatus.Queued,
      revision: unchanged.revision + 1,
    });
    expect(first.wake).toHaveBeenCalledOnce();
  });

  test.each([
    ['current version replacement', (fixture: Fixture, document: IndexedDocument) => {
      fixture.documentStore.addVersion(
        document.target.document.id,
        document.target.document.revision,
        {
          contentHash: sha256('replacement'),
          managedPath: 'blobs/replacement',
          mimeType: 'text/plain',
          fileSize: 11,
          sourceMtime: null,
          parser: 'text',
          extractedText: 'replacement',
          extractionPartial: false,
        },
      );
    }, KnowledgeBaseErrorCode.DocumentNotReady],
    ['document deletion', (fixture: Fixture, document: IndexedDocument) => {
      fixture.documentStore.softDeleteDocument(
        document.target.document.id,
        document.target.document.revision,
      );
    }, KnowledgeBaseErrorCode.DocumentNotFound],
    ['local index invalidation', (fixture: Fixture, document: IndexedDocument) => {
      fixture.db.prepare(`
        UPDATE knowledge_document_index_state SET status = ? WHERE document_version_id = ?
      `).run(KnowledgeDocumentIndexStatus.Failed, document.target.version.id);
    }, KnowledgeBaseErrorCode.LocalIndexNotReady],
    ['provider switch', (fixture: Fixture) => {
      updateWorkspaceRoute(fixture.db, routeSource({
        providerId: 'provider-b',
        providers: { 'provider-b': providerConfig({ displayName: 'Provider B' }) },
      }));
    }, KnowledgeBaseErrorCode.ModelConfigurationChanged],
    ['model switch', (fixture: Fixture) => {
      updateWorkspaceRoute(fixture.db, routeSource({
        modelId: 'model-b',
        providers: {
          [PROVIDER_ID]: providerConfig({ models: [{ id: 'model-b', name: 'Model B' }] }),
        },
      }));
    }, KnowledgeBaseErrorCode.ModelConfigurationChanged],
    ['effective key rotation', (fixture: Fixture) => {
      updateWorkspaceRoute(fixture.db, routeSource({
        providers: { [PROVIDER_ID]: providerConfig({ apiKey: 'sk-rotated' }) },
      }));
    }, KnowledgeBaseErrorCode.ModelConfigurationChanged],
  ])('invalidates old consent after %s without a request, wake, or model call', async (
    _label,
    mutate,
    code,
  ) => {
    const fixture = createFixture();
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const authorization = prepare(fixture, document);
    const wake = vi.spyOn(fixture.service, 'wake').mockImplementation(() => undefined);
    mutate(fixture, document);

    const error = await captureAuthorizationError(fixture.service.requestExtraction({
      ownerId: OWNER_ID,
      authorizationToken: authorization.authorizationToken,
    }));

    expect(error.code).toBe(code);
    expect(JSON.stringify(error)).not.toContain(API_KEY);
    expect(JSON.stringify(error)).not.toContain('/private/');
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM knowledge_enrichment_requests')
      .get()).toEqual({ count: 0 });
    expect(wake).not.toHaveBeenCalled();
    expect(fixture.modelGenerate).not.toHaveBeenCalled();
    await expect(fixture.service.requestExtraction({
      ownerId: OWNER_ID,
      authorizationToken: authorization.authorizationToken,
    })).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization });
  });

  test.each([
    [1, 30],
    [30, 31],
    [30, 30],
  ])('invalidates consent when generation changes from %i to %i chunks', async (
    beforeCount,
    afterCount,
  ) => {
    const fixture = createFixture();
    const document = createIndexedDocument(
      fixture.documentStore,
      fixture.indexStore,
      beforeCount,
    );
    const authorization = prepare(fixture, document);
    const republished = republishDocument(fixture, document, afterCount);
    expect(republished.state.publishedGenerationId)
      .not.toBe(document.state.publishedGenerationId);

    const error = await captureAuthorizationError(fixture.service.requestExtraction({
      ownerId: OWNER_ID,
      authorizationToken: authorization.authorizationToken,
    }));

    expect(error.code).toBe(KnowledgeBaseErrorCode.LocalIndexNotReady);
    expect(fixture.requestStore.listWorkspaceSummaries(WORKSPACE_ID)).toEqual([]);
    expect(fixture.modelGenerate).not.toHaveBeenCalled();
  });

  test.each(['owner', 'workspace'])('cleanup of the %s wins before an in-flight consume starts', async kind => {
    const fixture = createFixture();
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const authorization = prepare(fixture, document);
    const consuming = fixture.service.requestExtraction({
      ownerId: OWNER_ID,
      authorizationToken: authorization.authorizationToken,
    });

    if (kind === 'owner') fixture.authorizationStore.clearOwner(OWNER_ID);
    else fixture.authorizationStore.clearWorkspace(WORKSPACE_ID);

    await expect(consuming).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.InvalidExtractionAuthorization,
    });
    expect(fixture.requestStore.listWorkspaceSummaries(WORKSPACE_ID)).toEqual([]);
    expect(fixture.modelGenerate).not.toHaveBeenCalled();
  });

  test.each([
    KnowledgeEnrichmentStatus.Completed,
    KnowledgeEnrichmentStatus.Cancelled,
    KnowledgeEnrichmentStatus.Stale,
  ])('ordinary fresh consent creates a new request after terminal status %s', async status => {
    const fixture = createFixture();
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const first = await requestWithoutDrain(fixture, document);
    if (status === KnowledgeEnrichmentStatus.Completed) {
      const claim = fixture.requestStore.claimNext(NOW_1)!;
      fixture.requestStore.completeEmpty(first.summary.requestId, claim.attempt.id, {
        validCandidateCount: 0,
        discardedCandidateCount: 0,
        partialReasons: [],
        now: NOW_2,
      });
    } else if (status === KnowledgeEnrichmentStatus.Cancelled) {
      fixture.requestStore.cancel(first.summary.requestId, first.summary.revision, NOW_2);
    } else {
      fixture.requestStore.markVersionStale(document.target.version.id, NOW_2);
    }
    first.wake.mockClear();

    const replacement = await fixture.service.requestExtraction({
      ownerId: OWNER_ID,
      authorizationToken: prepare(fixture, document).authorizationToken,
    });

    expect(replacement.requestId).not.toBe(first.summary.requestId);
    expect(replacement.status).toBe(KnowledgeEnrichmentStatus.Queued);
    expect(first.wake).toHaveBeenCalledOnce();
  });

  test('restarts the entire WAL transaction after BUSY_SNAPSHOT and executes one primitive per attempt', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-task7-busy-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'knowledge.sqlite');
    let writer: Database.Database;
    let hookCalls = 0;
    const fixture = createFixture({
      databasePath,
      requestAfterSelect: () => {
        hookCalls += 1;
        if (hookCalls === 1) {
          writer.prepare('UPDATE task7_busy_marker SET value = value + 1 WHERE id = 1').run();
        }
      },
    });
    fixture.db.exec('CREATE TABLE task7_busy_marker (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)');
    fixture.db.prepare('INSERT INTO task7_busy_marker (id, value) VALUES (1, 0)').run();
    writer = openDatabase(databasePath);
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const authorization = prepare(fixture, document);
    const primitive = vi.spyOn(
      fixture.requestStore,
      'createOrGetAuthorizedRequestInCurrentTransaction',
    );
    const wake = vi.spyOn(fixture.service, 'wake').mockImplementation(() => undefined);

    const summary = await fixture.service.requestExtraction({
      ownerId: OWNER_ID,
      authorizationToken: authorization.authorizationToken,
    });

    expect(summary.status).toBe(KnowledgeEnrichmentStatus.Queued);
    expect(primitive).toHaveBeenCalledTimes(2);
    expect(wake).toHaveBeenCalledOnce();
    expect(fixture.requestStore.listWorkspaceSummaries(WORKSPACE_ID)).toHaveLength(1);
  });

  test('a WAL snapshot retry observes a newly changed route and invalidates before mutation', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-task7-route-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'knowledge.sqlite');
    let writer: Database.Database;
    let hookCalls = 0;
    const fixture = createFixture({
      databasePath,
      requestAfterSelect: () => {
        hookCalls += 1;
        if (hookCalls === 1) {
          updateWorkspaceRoute(writer, routeSource({
            providers: { [PROVIDER_ID]: providerConfig({ apiKey: 'sk-raced-route' }) },
          }));
        }
      },
    });
    writer = openDatabase(databasePath);
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const authorization = prepare(fixture, document);
    const primitive = vi.spyOn(
      fixture.requestStore,
      'createOrGetAuthorizedRequestInCurrentTransaction',
    );

    const error = await captureAuthorizationError(fixture.service.requestExtraction({
      ownerId: OWNER_ID,
      authorizationToken: authorization.authorizationToken,
    }));

    expect(error.code).toBe(KnowledgeBaseErrorCode.ModelConfigurationChanged);
    expect(primitive).toHaveBeenCalledOnce();
    expect(fixture.requestStore.listWorkspaceSummaries(WORKSPACE_ID)).toEqual([]);
    expect(fixture.modelGenerate).not.toHaveBeenCalled();
  });
});

describe('KnowledgeEnrichmentService one-concurrency worker', () => {
  test('uses the locked DeepSeek provider id despite neutral endpoint and model metadata', async () => {
    const fixture = createFixture();
    updateWorkspaceRoute(fixture.db, routeSource({
      providerId: ProviderName.DeepSeek,
      modelId: 'neutral-model',
      providers: {
        [ProviderName.DeepSeek]: providerConfig({
          baseUrl: 'https://neutral-provider.example/v1',
          displayName: 'Neutral Provider',
          models: [{ id: 'neutral-model', name: 'Neutral Model' }],
        }),
      },
    }));
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();

    fixture.service.wake();
    await fixture.service.waitForIdle();

    expect(fixture.modelGenerate).toHaveBeenCalledOnce();
    expect(fixture.modelGenerate.mock.calls[0][0]).toMatchObject({
      responseFormat: ModelGenerationResponseFormat.JsonObject,
      thinkingMode: ModelGenerationThinkingMode.Disabled,
    });
  });

  test('ignores DeepSeek-like metadata when the locked provider id is not DeepSeek', async () => {
    const fixture = createFixture();
    updateWorkspaceRoute(fixture.db, routeSource({
      providerId: PROVIDER_ID,
      modelId: 'deepseek-v4-pro',
      providers: {
        [PROVIDER_ID]: providerConfig({
          baseUrl: 'https://api.deepseek.com',
          displayName: 'DeepSeek',
          models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }],
        }),
      },
    }));
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();

    fixture.service.wake();
    await fixture.service.waitForIdle();

    expect(fixture.modelGenerate).toHaveBeenCalledOnce();
    const input = fixture.modelGenerate.mock.calls[0][0];
    expect(input).not.toHaveProperty('responseFormat');
    expect(input).not.toHaveProperty('thinkingMode');
  });

  test('processes at most 30 chunks in ordinal order with locked limits and publishes chunk_limit', async () => {
    const fixture = createFixture();
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 31);
    const queued = await requestWithoutDrain(fixture, document);
    const publish = vi.spyOn(fixture.publicationStore, 'publishValidatedCandidates');
    queued.wake.mockRestore();

    fixture.service.wake();
    await fixture.service.waitForIdle();

    expect(fixture.modelGenerate).toHaveBeenCalledTimes(30);
    const ordinalByChunkId = new Map(document.chunks.map(chunk => [chunk.id, chunk.ordinal]));
    const ordinals = fixture.modelGenerate.mock.calls.map(([input]) => {
      const parsed = JSON.parse(input.prompt) as { chunkId: string };
      expect(input.apiConfig).toMatchObject({
        apiKey: API_KEY,
        apiType: 'openai',
        model: MODEL_ID,
      });
      expect(input.maxTokens).toBe(KNOWLEDGE_ENRICHMENT_MODEL_MAX_TOKENS);
      expect(input.maxResponseBytes).toBe(KNOWLEDGE_ENRICHMENT_MODEL_MAX_RESPONSE_BYTES);
      expect(input.temperature).toBe(0);
      expect(input.signal).toBeInstanceOf(AbortSignal);
      return ordinalByChunkId.get(parsed.chunkId);
    });
    expect(ordinals).toEqual(Array.from({ length: 30 }, (_, ordinal) => ordinal));
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      selection: expect.objectContaining({
        partialReasons: [KnowledgeEnrichmentPartialReason.ChunkLimit],
      }),
    }));
    expect(fixture.requestStore.getSummary(queued.summary.requestId)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Completed,
      partialReasons: [KnowledgeEnrichmentPartialReason.ChunkLimit],
      validCandidateCount: 0,
    });
  });

  test('rejects a length-truncated completion before validation or publication with one call', async () => {
    const fixture = createFixture({
      modelGenerate: async () => ({
        text: JSON.stringify({ facts: [{ nope: 'secret-truncated-candidate' }] }),
        finishReason: 'length',
      }),
    });
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    const publish = vi.spyOn(fixture.publicationStore, 'publishValidatedCandidates');
    queued.wake.mockRestore();

    fixture.service.wake();
    await fixture.service.waitForIdle();

    expect(fixture.modelGenerate).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
    expect(fixture.requestStore.getSummary(queued.summary.requestId)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Failed,
      errorCode: KnowledgeBaseErrorCode.InvalidModelResponse,
    });
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM knowledge_facts').get())
      .toEqual({ count: 0 });
    expect(JSON.stringify(fixture.requestStore.getRequest(queued.summary.requestId)))
      .not.toContain('secret-truncated-candidate');
  });

  test('publishes one bounded fact with two owned evidence rows from two model calls', async () => {
    const fixture = createFixture({
      modelGenerate: async input => {
        const { chunkId } = JSON.parse(input.prompt) as { chunkId: string };
        return {
          text: JSON.stringify({
            facts: [{
              domain: KnowledgeFactDomain.ProductList,
              value: 'Industrial robots',
              chunkId,
              quote: 'industrial robots',
              confidence: 0.9,
            }],
          }),
          finishReason: 'stop',
        };
      },
    });
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 2);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();

    fixture.service.wake();
    await fixture.service.waitForIdle();

    expect(fixture.modelGenerate).toHaveBeenCalledTimes(2);
    expect(fixture.requestStore.getSummary(queued.summary.requestId)).toMatchObject({
      status: KnowledgeEnrichmentStatus.ReviewRequired,
      validCandidateCount: 1,
    });
    expect(fixture.db.prepare(`
      SELECT domain, value
      FROM knowledge_facts
    `).all()).toEqual([{
      domain: KnowledgeFactDomain.ProductList,
      value: 'Industrial robots',
    }]);
    const evidenceRows = fixture.db.prepare(`
      SELECT chunk_id, quote, confidence
      FROM knowledge_fact_evidence
      ORDER BY chunk_id
    `).all();
    const expectedEvidenceRows = [...document.chunks]
      .sort((left, right) => {
        if (left.id < right.id) return -1;
        if (left.id > right.id) return 1;
        return 0;
      })
      .map(chunk => ({
        chunk_id: chunk.id,
        quote: 'industrial robots',
        confidence: 0.9,
      }));
    expect(evidenceRows).toHaveLength(2);
    expect(evidenceRows).toEqual(expectedEvidenceRows);
  });

  test('never has more than one request or model call active', async () => {
    const gates: Array<ReturnType<typeof createDeferred<void>>> = [];
    let active = 0;
    let maxActive = 0;
    const fixture = createFixture({
      modelGenerate: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const gate = createDeferred<void>();
        gates.push(gate);
        await gate.promise;
        active -= 1;
        return { text: JSON.stringify({ facts: [] }) };
      },
    });
    const firstDocument = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const secondDocument = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const wake = vi.spyOn(fixture.service, 'wake').mockImplementation(() => undefined);
    await fixture.service.requestExtraction({
      ownerId: OWNER_ID,
      authorizationToken: prepare(fixture, firstDocument).authorizationToken,
    });
    await fixture.service.requestExtraction({
      ownerId: OWNER_ID,
      authorizationToken: prepare(fixture, secondDocument).authorizationToken,
    });
    wake.mockRestore();

    fixture.service.wake();
    await waitUntil(() => gates.length === 1, 'first model call');
    expect(active).toBe(1);
    gates[0].resolve();
    await waitUntil(() => gates.length === 2, 'second model call');
    expect(active).toBe(1);
    gates[1].resolve();
    await fixture.service.waitForIdle();

    expect(maxActive).toBe(1);
    expect(fixture.modelGenerate).toHaveBeenCalledTimes(2);
  });

  test('uses capped 25/50/100/200/250 claim backoff after each four immediate BUSY attempts', async () => {
    const delays: number[] = [];
    const fixture = createFixture({
      busyRetryDelay: async delayMs => {
        delays.push(delayMs);
      },
    });
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();
    const originalClaimNext = fixture.requestStore.claimNext.bind(fixture.requestStore);
    let claimCalls = 0;
    vi.spyOn(fixture.requestStore, 'claimNext').mockImplementation(() => {
      claimCalls += 1;
      if (claimCalls <= 20) {
        throw Object.assign(new Error('secret-busy-path /private/database.sqlite'), {
          code: claimCalls % 2 === 0 ? 'SQLITE_BUSY_SNAPSHOT' : 'SQLITE_BUSY',
        });
      }
      return originalClaimNext();
    });

    fixture.service.wake();
    await fixture.service.waitForIdle();

    expect(delays).toEqual([25, 50, 100, 200, 250]);
    expect(claimCalls).toBe(22);
    expect(fixture.modelGenerate).toHaveBeenCalledOnce();
  });

  test('logs one stable code for a permanent claim error without rejecting the drain', async () => {
    const fixture = createFixture();
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();
    vi.spyOn(fixture.requestStore, 'claimNext').mockImplementation(() => {
      throw new Error('secret-claim-error /private/database.sqlite');
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    fixture.service.wake();
    await expect(fixture.service.waitForIdle()).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledOnce();
    expect(JSON.stringify(errorLog.mock.calls)).toContain(
      KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('secret-claim-error');
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('/private/database.sqlite');
  });

  test('strictly revalidates route and lease before every call and heartbeats between calls', async () => {
    const fixture = createFixture();
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 2);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();
    const resolveRouteSource = vi.spyOn(fixture.modelResolver, 'resolveRouteSource');
    const heartbeat = vi.spyOn(fixture.requestStore, 'heartbeat');

    fixture.service.wake();
    await fixture.service.waitForIdle();

    expect(fixture.modelGenerate).toHaveBeenCalledTimes(2);
    expect(resolveRouteSource).toHaveBeenCalledTimes(2);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    expect(heartbeat.mock.calls.map(call => call[2])).toEqual([50, 99]);
  });

  test.each([
    ['document deletion', (fixture: Fixture, document: IndexedDocument) => {
      fixture.db.prepare(`
        UPDATE knowledge_documents SET deleted_at = ? WHERE id = ?
      `).run(NOW_2, document.target.document.id);
    }],
    ['version replacement', (fixture: Fixture, document: IndexedDocument) => {
      fixture.documentStore.addVersion(
        document.target.document.id,
        document.target.document.revision,
        {
          contentHash: sha256('replacement-before-first-call'),
          managedPath: 'blobs/replacement-before-first-call',
          mimeType: 'text/plain',
          fileSize: 29,
          sourceMtime: null,
          parser: 'text',
          extractedText: 'replacement-before-first-call',
          extractionPartial: false,
        },
      );
    }],
    ['index invalidation', (fixture: Fixture, document: IndexedDocument) => {
      fixture.db.prepare(`
        UPDATE knowledge_document_index_state SET status = ? WHERE document_version_id = ?
      `).run(KnowledgeDocumentIndexStatus.Failed, document.target.version.id);
    }],
  ])('sends no model call when %s wins immediately after claim', async (_label, mutate) => {
    const fixture = createFixture();
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();
    const originalClaimNext = fixture.requestStore.claimNext.bind(fixture.requestStore);
    let mutated = false;
    vi.spyOn(fixture.requestStore, 'claimNext').mockImplementation(now => {
      const claim = originalClaimNext(now);
      if (claim && !mutated) {
        mutated = true;
        mutate(fixture, document);
      }
      return claim;
    });

    fixture.service.wake();
    await fixture.service.waitForIdle();

    expect(mutated).toBe(true);
    expect(fixture.modelGenerate).not.toHaveBeenCalled();
  });

  test.each([
    ['document deletion', (fixture: Fixture, document: IndexedDocument) => {
      fixture.db.prepare(`
        UPDATE knowledge_documents SET deleted_at = ? WHERE id = ?
      `).run(NOW_2, document.target.document.id);
    }],
    ['version replacement', (fixture: Fixture, document: IndexedDocument) => {
      fixture.documentStore.addVersion(
        document.target.document.id,
        document.target.document.revision,
        {
          contentHash: sha256('replacement'),
          managedPath: 'blobs/replacement',
          mimeType: 'text/plain',
          fileSize: 11,
          sourceMtime: null,
          parser: 'text',
          extractedText: 'replacement',
          extractionPartial: false,
        },
      );
    }],
    ['index invalidation', (fixture: Fixture, document: IndexedDocument) => {
      fixture.db.prepare(`
        UPDATE knowledge_document_index_state SET status = ? WHERE document_version_id = ?
      `).run(KnowledgeDocumentIndexStatus.Failed, document.target.version.id);
    }],
    ['route fingerprint change', (fixture: Fixture) => {
      updateWorkspaceRoute(fixture.db, routeSource({
        providers: { [PROVIDER_ID]: providerConfig({ apiKey: 'sk-between-calls' }) },
      }));
    }],
  ])('sends no later chunk after %s between calls', async (_label, mutate) => {
    let modelCalls = 0;
    let fixture!: Fixture;
    let document!: IndexedDocument;
    fixture = createFixture({
      modelGenerate: async () => {
        modelCalls += 1;
        if (modelCalls === 1) mutate(fixture, document);
        return { text: JSON.stringify({ facts: [] }) };
      },
    });
    document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 2);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();

    fixture.service.wake();
    await fixture.service.waitForIdle();

    expect(fixture.modelGenerate).toHaveBeenCalledOnce();
  });

  test('observes a lifecycle abort raised after revalidation but immediately before fetch', async () => {
    const fixture = createFixture();
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();
    const originalResolve = fixture.modelResolver.resolveRouteSource.bind(fixture.modelResolver);
    vi.spyOn(fixture.modelResolver, 'resolveRouteSource').mockImplementation((...args) => {
      const route = originalResolve(...args);
      fixture.service.abortActiveAttemptForVersion(document.target.version.id);
      return route;
    });

    fixture.service.wake();
    await fixture.service.waitForIdle();

    expect(fixture.modelGenerate).not.toHaveBeenCalled();
  });

  test('stops on a false heartbeat, aborts the signal, and never fails over a lost lease', async () => {
    let signal: AbortSignal | undefined;
    const fixture = createFixture({
      modelGenerate: async input => {
        signal = input.signal;
        return { text: JSON.stringify({ facts: [] }) };
      },
    });
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 2);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();
    vi.spyOn(fixture.requestStore, 'heartbeat').mockReturnValue(false);
    const failAttempt = vi.spyOn(fixture.requestStore, 'failAttempt');

    fixture.service.wake();
    await fixture.service.waitForIdle();

    expect(fixture.modelGenerate).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(true);
    expect(failAttempt).not.toHaveBeenCalled();
  });

  test('an interval heartbeat loss stops a pending model that ignores abort', async () => {
    vi.useFakeTimers();
    const response = createDeferred<ModelGenerationResult>();
    let signal: AbortSignal | undefined;
    const fixture = createFixture({
      modelGenerate: input => {
        signal = input.signal;
        return response.promise;
      },
    });
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();
    vi.spyOn(fixture.requestStore, 'heartbeat').mockReturnValue(false);
    const failAttempt = vi.spyOn(fixture.requestStore, 'failAttempt');
    fixture.service.wake();
    await vi.waitFor(() => expect(fixture.modelGenerate).toHaveBeenCalledOnce());
    let idleSettled = false;
    const idle = fixture.service.waitForIdle().then(() => {
      idleSettled = true;
    });

    await vi.advanceTimersByTimeAsync(KNOWLEDGE_ENRICHMENT_HEARTBEAT_INTERVAL_MS);
    await Promise.resolve();
    await Promise.resolve();
    const stoppedWithoutModelSettlement = idleSettled;
    if (!idleSettled) {
      response.resolve({ text: JSON.stringify({ facts: [] }) });
    }
    await idle;

    expect(stoppedWithoutModelSettlement).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(failAttempt).not.toHaveBeenCalled();
  });

  test.each([
    ['response byte overflow', () => new ModelResponseTooLargeError(10), KnowledgeBaseErrorCode.InvalidModelResponse],
    ['invalid outer JSON', () => new ModelResponseInvalidJsonError(), KnowledgeBaseErrorCode.InvalidModelResponse],
    ['invalid provider content', () => new ModelResponseInvalidContentError(), KnowledgeBaseErrorCode.InvalidModelResponse],
    ['bounded read failure', () => new ModelResponseReadError(), KnowledgeBaseErrorCode.ModelRequestFailed],
    ['network failure', () => new TypeError('secret-network-message'), KnowledgeBaseErrorCode.ModelRequestFailed],
  ])('maps %s to stable failure %s', async (_label, createError, expectedCode) => {
    const fixture = createFixture({
      modelGenerate: async () => Promise.reject(createError()),
    });
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();

    fixture.service.wake();
    await fixture.service.waitForIdle();

    const summary = fixture.requestStore.getSummary(queued.summary.requestId)!;
    expect(summary).toMatchObject({
      status: KnowledgeEnrichmentStatus.Failed,
      errorCode: expectedCode,
    });
    expect(JSON.stringify(summary)).not.toContain('secret-network-message');
  });

  test.each([
    ['invalid envelope', JSON.stringify({ nope: [] }), KnowledgeBaseErrorCode.InvalidModelResponse],
    ['wholly invalid evidence', JSON.stringify({ facts: [{ nope: 'secret-raw-output' }] }), KnowledgeBaseErrorCode.EvidenceValidationFailed],
  ])('maps %s without persisting raw output', async (_label, text, expectedCode) => {
    const fixture = createFixture({ modelGenerate: async () => ({ text }) });
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();

    fixture.service.wake();
    await fixture.service.waitForIdle();

    const summary = fixture.requestStore.getSummary(queued.summary.requestId)!;
    expect(summary.errorCode).toBe(expectedCode);
    expect(JSON.stringify(summary)).not.toContain('secret-raw-output');
    const persisted = fixture.db.prepare(`
      SELECT error_message FROM knowledge_enrichment_requests WHERE id = ?
    `).get(queued.summary.requestId);
    expect(JSON.stringify(persisted)).not.toContain('secret-raw-output');
  });

  test('a valid empty result completes through publication without facts or raw provider output', async () => {
    const fixture = createFixture();
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();
    const publish = vi.spyOn(fixture.publicationStore, 'publishValidatedCandidates');

    fixture.service.wake();
    await fixture.service.waitForIdle();

    expect(publish).toHaveBeenCalledOnce();
    expect(fixture.requestStore.getSummary(queued.summary.requestId)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Completed,
      validCandidateCount: 0,
    });
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM knowledge_facts').get())
      .toEqual({ count: 0 });
    expect(JSON.stringify(fixture.requestStore.getRequest(queued.summary.requestId)))
      .not.toContain('raw-provider-output');
  });

  test('rejects an empty G1 result when a second WAL connection republishes G2 before publication', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-task7-final-generation-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'knowledge.sqlite');
    const fixture = createFixture({ databasePath });
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const originalGenerationId = document.state.publishedGenerationId!;
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();
    const writer = openDatabase(databasePath);
    const writerIndexStore = new KnowledgeDocumentIndexStore(writer, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });
    const publishReal = fixture.publicationStore.publishValidatedCandidates.bind(
      fixture.publicationStore,
    );
    let republishedGenerationId: string | null = null;
    const publish = vi.spyOn(
      fixture.publicationStore,
      'publishValidatedCandidates',
    ).mockImplementation(input => {
      expect(input).toMatchObject({
        expectedPublishedGenerationId: originalGenerationId,
        expectedIndexedChunkCount: 1,
        selection: expect.objectContaining({ candidates: [] }),
      });
      republishedGenerationId = republishDocument(
        fixture,
        document,
        1,
        writerIndexStore,
      ).state.publishedGenerationId;
      return publishReal(input);
    });

    fixture.service.wake();
    await fixture.service.waitForIdle();

    expect(publish).toHaveBeenCalledOnce();
    expect(republishedGenerationId).not.toBe(originalGenerationId);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM knowledge_facts').get())
      .toEqual({ count: 0 });
    expect(fixture.requestStore.getRequest(queued.summary.requestId)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Running,
      activeAttemptId: expect.any(String),
    });
    expect(fixture.requestStore.listAttempts(queued.summary.requestId)).toEqual([
      expect.objectContaining({ outcome: KnowledgeEnrichmentAttemptOutcome.Running }),
    ]);
  });

  test('the owned 180-second deadline aborts before persisting model_request_timeout', async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const fixture = createFixture({
      modelGenerate: input => new Promise((_resolve, reject) => {
        observedSignal = input.signal;
        input.signal?.addEventListener('abort', () => reject(input.signal?.reason), { once: true });
      }),
    });
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();

    fixture.service.wake();
    await vi.waitFor(() => expect(fixture.modelGenerate).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(KNOWLEDGE_ENRICHMENT_MODEL_TIMEOUT_MS);
    await fixture.service.waitForIdle();

    expect(observedSignal?.aborted).toBe(true);
    expect(fixture.requestStore.getSummary(queued.summary.requestId)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Failed,
      errorCode: KnowledgeBaseErrorCode.ModelRequestTimeout,
    });
  });

  test('heartbeats at 15 seconds while a model call is pending', async () => {
    vi.useFakeTimers();
    const response = createDeferred<ModelGenerationResult>();
    const fixture = createFixture({ modelGenerate: () => response.promise });
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();
    const heartbeat = vi.spyOn(fixture.requestStore, 'heartbeat');

    fixture.service.wake();
    await vi.waitFor(() => expect(fixture.modelGenerate).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(KNOWLEDGE_ENRICHMENT_HEARTBEAT_INTERVAL_MS);

    expect(heartbeat).toHaveBeenCalledWith(
      queued.summary.requestId,
      expect.any(String),
      0,
      NOW_2,
    );
    response.resolve({ text: JSON.stringify({ facts: [] }) });
    await fixture.service.waitForIdle();
  });

  test('cancels queued work durably without a model call or spurious abort', async () => {
    const fixture = createFixture();
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    const abort = vi.spyOn(AbortController.prototype, 'abort');

    const cancelled = fixture.service.cancelExtraction({
      requestId: queued.summary.requestId,
      expectedRevision: queued.summary.revision,
    });

    expect(cancelled.status).toBe(KnowledgeEnrichmentStatus.Cancelled);
    expect(fixture.requestStore.getSummary(queued.summary.requestId)).toEqual(cancelled);
    expect(abort).not.toHaveBeenCalled();
    expect(fixture.modelGenerate).not.toHaveBeenCalled();
  });

  test('persists cancellation before abort and a late result cannot publish', async () => {
    const response = createDeferred<ModelGenerationResult>();
    let signal: AbortSignal | undefined;
    let statusObservedAtAbort: string | undefined;
    let fixture!: Fixture;
    let requestId = '';
    fixture = createFixture({
      modelGenerate: input => {
        signal = input.signal;
        input.signal?.addEventListener('abort', () => {
          statusObservedAtAbort = fixture.requestStore.getSummary(requestId)?.status;
        }, { once: true });
        return response.promise;
      },
    });
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    requestId = queued.summary.requestId;
    queued.wake.mockRestore();
    const publish = vi.spyOn(fixture.publicationStore, 'publishValidatedCandidates');
    fixture.service.wake();
    await waitUntil(() => fixture.modelGenerate.mock.calls.length === 1, 'active model call');
    const running = fixture.requestStore.getSummary(queued.summary.requestId)!;

    const cancelled = fixture.service.cancelExtraction({
      requestId: queued.summary.requestId,
      expectedRevision: running.revision,
    });

    expect(cancelled.status).toBe(KnowledgeEnrichmentStatus.Cancelled);
    expect(statusObservedAtAbort).toBe(KnowledgeEnrichmentStatus.Cancelled);
    expect(signal?.aborted).toBe(true);
    const idle = fixture.service.waitForIdle();
    const stoppedBeforeLateResult = await Promise.race([
      idle.then(() => true),
      new Promise<false>(resolve => setTimeout(() => resolve(false), 20)),
    ]);
    response.resolve({ text: JSON.stringify({ facts: [] }) });
    await idle;
    expect(stoppedBeforeLateResult).toBe(true);
    expect(publish).not.toHaveBeenCalled();
    expect(fixture.requestStore.getSummary(queued.summary.requestId)?.status)
      .toBe(KnowledgeEnrichmentStatus.Cancelled);
  });

  test.each(['version', 'workspace'] as const)(
    'targeted lifecycle aborts only the exact active %s after its transactional stale transition',
    async target => {
    const response = createDeferred<ModelGenerationResult>();
    let signal: AbortSignal | undefined;
    const fixture = createFixture({
      modelGenerate: input => {
        signal = input.signal;
        input.signal?.addEventListener('abort', () => response.reject(input.signal?.reason), {
          once: true,
        });
        return response.promise;
      },
    });
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();
    fixture.service.wake();
    await waitUntil(() => fixture.modelGenerate.mock.calls.length === 1, 'active model call');

    fixture.service.abortActiveAttemptForVersion('other-version');
    fixture.service.abortActiveAttemptForWorkspace('other-workspace');
    expect(signal?.aborted).toBe(false);
    if (target === 'version') {
      fixture.requestStore.markVersionStale(document.target.version.id, NOW_2);
      const transition = vi.spyOn(fixture.requestStore, 'markVersionStale');
      fixture.service.abortActiveAttemptForVersion(document.target.version.id);
      expect(transition).not.toHaveBeenCalled();
    } else {
      fixture.requestStore.markWorkspaceStale(WORKSPACE_ID, NOW_2);
      const transition = vi.spyOn(fixture.requestStore, 'markWorkspaceStale');
      fixture.service.abortActiveAttemptForWorkspace(WORKSPACE_ID);
      expect(transition).not.toHaveBeenCalled();
    }

    expect(signal?.aborted).toBe(true);
    await fixture.service.waitForIdle();
    expect(fixture.requestStore.getSummary(queued.summary.requestId)?.status)
      .toBe(KnowledgeEnrichmentStatus.Stale);
    },
  );

  test('publishes nothing when a lifecycle-staled model ignores abort and resolves late', async () => {
    const response = createDeferred<ModelGenerationResult>();
    let signal: AbortSignal | undefined;
    const fixture = createFixture({
      modelGenerate: input => {
        signal = input.signal;
        return response.promise;
      },
    });
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();
    const publish = vi.spyOn(fixture.publicationStore, 'publishValidatedCandidates');
    fixture.service.wake();
    await waitUntil(() => fixture.modelGenerate.mock.calls.length === 1, 'active late model call');

    fixture.requestStore.markVersionStale(document.target.version.id, NOW_2);
    fixture.service.abortActiveAttemptForVersion(document.target.version.id);
    expect(signal?.aborted).toBe(true);
    await fixture.service.waitForIdle();

    response.resolve({ text: JSON.stringify({ facts: [{ value: 'late secret' }] }) });
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
    expect(fixture.requestStore.getSummary(queued.summary.requestId)?.status).toBe(
      KnowledgeEnrichmentStatus.Stale,
    );
  });

  test('does not lose a wake queued after an empty claim and before cleanup', async () => {
    const fixture = createFixture();
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();
    const originalClaimNext = fixture.requestStore.claimNext.bind(fixture.requestStore);
    let calls = 0;
    vi.spyOn(fixture.requestStore, 'claimNext').mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        queueMicrotask(() => fixture.service.wake());
        return null;
      }
      return originalClaimNext();
    });

    fixture.service.wake();
    await fixture.service.waitForIdle();

    expect(fixture.modelGenerate).toHaveBeenCalledOnce();
    expect(fixture.requestStore.getSummary(queued.summary.requestId)?.status)
      .toBe(KnowledgeEnrichmentStatus.Completed);
  });

  test('publishes drain ownership before a synchronous wake reenters claimNext', async () => {
    const fixture = createFixture();
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();
    const originalClaimNext = fixture.requestStore.claimNext.bind(fixture.requestStore);
    let claimDepth = 0;
    let maximumClaimDepth = 0;
    let claimCalls = 0;
    vi.spyOn(fixture.requestStore, 'claimNext').mockImplementation(() => {
      claimDepth += 1;
      maximumClaimDepth = Math.max(maximumClaimDepth, claimDepth);
      claimCalls += 1;
      if (claimCalls === 1) fixture.service.wake();
      try {
        return originalClaimNext();
      } finally {
        claimDepth -= 1;
      }
    });

    fixture.service.wake();
    await fixture.service.waitForIdle();

    expect(maximumClaimDepth).toBe(1);
    expect(fixture.modelGenerate).toHaveBeenCalledOnce();
  });

  test('persists timeout when a model ignores abort and resolves late', async () => {
    vi.useFakeTimers();
    const response = createDeferred<ModelGenerationResult>();
    let signal: AbortSignal | undefined;
    const fixture = createFixture({
      modelGenerate: input => {
        signal = input.signal;
        return response.promise;
      },
    });
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();
    fixture.service.wake();
    await vi.waitFor(() => expect(fixture.modelGenerate).toHaveBeenCalledOnce());

    await vi.advanceTimersByTimeAsync(KNOWLEDGE_ENRICHMENT_MODEL_TIMEOUT_MS);
    expect(signal?.aborted).toBe(true);
    response.resolve({ text: JSON.stringify({ facts: [] }) });
    await fixture.service.waitForIdle();

    expect(fixture.requestStore.getSummary(queued.summary.requestId)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Failed,
      errorCode: KnowledgeBaseErrorCode.ModelRequestTimeout,
    });
  });

  test('shutdown aborts only the local controller and leaves the durable running lease for recovery', async () => {
    const response = createDeferred<ModelGenerationResult>();
    const fixture = createFixture({ modelGenerate: () => response.promise });
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();
    const failAttempt = vi.spyOn(fixture.requestStore, 'failAttempt');
    const cancel = vi.spyOn(fixture.requestStore, 'cancel');
    fixture.service.wake();
    await waitUntil(() => fixture.modelGenerate.mock.calls.length === 1, 'active model call');

    const shutdown = fixture.service.shutdown();
    fixture.service.wake();
    const stoppedWithoutModelSettlement = await Promise.race([
      shutdown.then(() => true),
      new Promise<false>(resolve => setTimeout(() => resolve(false), 20)),
    ]);
    if (!stoppedWithoutModelSettlement) {
      response.resolve({ text: JSON.stringify({ facts: [] }) });
    }
    await shutdown;
    fixture.service.wake();
    await fixture.service.waitForIdle();

    expect(failAttempt).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(stoppedWithoutModelSettlement).toBe(true);
    expect(fixture.modelGenerate).toHaveBeenCalledOnce();
    expect(fixture.requestStore.getSummary(queued.summary.requestId)?.status)
      .toBe(KnowledgeEnrichmentStatus.Running);
  });

  test('shutdown interrupts claim backoff and leaves queued work durable', async () => {
    let delaySignal: AbortSignal | undefined;
    const delayStarted = createDeferred<void>();
    const fixture = createFixture({
      busyRetryDelay: (_delayMs, signal) => {
        delaySignal = signal;
        delayStarted.resolve();
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    });
    const document = createIndexedDocument(fixture.documentStore, fixture.indexStore, 1);
    const queued = await requestWithoutDrain(fixture, document);
    queued.wake.mockRestore();
    const claimNext = vi.spyOn(fixture.requestStore, 'claimNext').mockImplementation(() => {
      throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' });
    });

    fixture.service.wake();
    await delayStarted.promise;
    const claimCallsAtShutdown = claimNext.mock.calls.length;
    const shutdown = fixture.service.shutdown();
    fixture.service.wake();
    await shutdown;
    fixture.service.wake();
    await fixture.service.waitForIdle();

    expect(delaySignal?.aborted).toBe(true);
    expect(claimNext).toHaveBeenCalledTimes(claimCallsAtShutdown);
    expect(fixture.modelGenerate).not.toHaveBeenCalled();
    expect(fixture.requestStore.getSummary(queued.summary.requestId)?.status)
      .toBe(KnowledgeEnrichmentStatus.Queued);
  });
});
