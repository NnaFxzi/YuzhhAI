import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentIndexTokenizer,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeEnrichmentAttemptOutcome,
  KnowledgeEnrichmentPartialReason,
  KnowledgeEnrichmentStatus,
  KnowledgeFactDomain,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
} from '../../shared/knowledgeBase/constants';
import { normalizeEnterpriseKnowledgeValue } from '../../shared/knowledgeBase/enterpriseLeadProfileKnowledge';
import type { ProviderConfig } from '../../shared/providers/types';
import { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import { applySqliteConnectionPolicy } from '../libs/sqliteConnectionPolicy';
import { chunkKnowledgeDocumentVersion } from './knowledgeDocumentChunker';
import { KnowledgeDocumentIndexStore } from './knowledgeDocumentIndexStore';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';
import {
  normalizeKnowledgeEvidenceQuote,
} from './knowledgeEnrichmentCandidateValidator';
import {
  KnowledgeEnrichmentModelResolver,
} from './knowledgeEnrichmentModelResolver';
import {
  buildKnowledgeEvidenceId,
  KnowledgeEnrichmentPublicationError,
  KnowledgeEnrichmentPublicationStage,
  type KnowledgeEnrichmentPublicationStage as KnowledgeEnrichmentPublicationStageValue,
  KnowledgeEnrichmentPublicationStore,
} from './knowledgeEnrichmentPublicationStore';
import { KnowledgeEnrichmentRequestStore } from './knowledgeEnrichmentRequestStore';
import type {
  KnowledgeEnrichmentCandidateSelection,
  KnowledgeEnrichmentPublicationCandidate,
  KnowledgeEnrichmentRouteReference,
  KnowledgeEnrichmentWorkspaceRouteSource,
} from './knowledgeEnrichmentTypes';
import { KnowledgeFactStore } from './knowledgeFactStore';

const NOW_1 = '2026-07-12T01:00:00.000Z';
const NOW_2 = '2026-07-12T01:01:00.000Z';
const NOW_3 = '2026-07-12T01:02:00.000Z';
const MODEL_ID = 'model-a';
const PROVIDER_ID = 'provider-a';
const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop()!, { force: true, recursive: true });
  }
});

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const providerConfig = (apiKey = 'sk-task-6-secret'): ProviderConfig => ({
  enabled: true,
  apiKey,
  baseUrl: 'https://provider-a.example/v1',
  apiFormat: 'openai',
  displayName: 'Provider A',
  models: [{ id: MODEL_ID, name: 'Model A' }],
});

const routeSource = (apiKey = 'sk-task-6-secret'): KnowledgeEnrichmentWorkspaceRouteSource => ({
  id: 'workspace-a',
  settings: {
    model: {
      defaultModel: MODEL_ID,
      defaultModelProvider: PROVIDER_ID,
      providers: {
        [PROVIDER_ID]: providerConfig(apiKey),
      },
    },
  },
});

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
  const settings = JSON.stringify({ model: source.settings.model });
  db.prepare(`
    INSERT INTO enterprise_lead_workspaces (
      id, name, type, profile, extraction_sources, risk_rules,
      enabled_agent_roles, settings, workspace_agents, recent_run_id,
      created_at, updated_at
    ) VALUES (
      ?, 'Workspace A', 'enterprise_lead', ?, '[]', '[]',
      '[]', ?, NULL, NULL, ?, ?
    )
  `).run(source.id, JSON.stringify(emptyProfile()), settings, NOW_1, NOW_1);
};

const readRouteSourceInCurrentTransaction = (
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
  if (!row?.settings) {
    return null;
  }
  const settings = JSON.parse(row.settings) as KnowledgeEnrichmentWorkspaceRouteSource['settings'];
  return { id: row.id, settings };
};

const createReadyIndexedDocument = (
  db: Database.Database,
  text: string,
) => {
  const documentStore = new KnowledgeDocumentStore(db);
  const target = documentStore.createDocumentWithVersion({
    workspaceId: 'workspace-a',
    displayName: 'publication-source.txt',
    sourceMode: KnowledgeDocumentSourceMode.Managed,
    status: KnowledgeDocumentStatus.Ready,
    version: {
      contentHash: sha256(text),
      managedPath: 'blobs/publication-source',
      mimeType: 'text/plain',
      fileSize: text.length,
      sourceMtime: null,
      parser: 'text',
      extractedText: text,
      extractionPartial: false,
    },
  });
  const indexStore = new KnowledgeDocumentIndexStore(db, {
    resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
  });
  indexStore.scheduleCurrentVersion({
    workspaceId: target.document.workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
  }, NOW_1);
  const claim = indexStore.claimNext(NOW_1)!;
  const chunks = chunkKnowledgeDocumentVersion({
    documentVersionId: target.version.id,
    text,
  });
  indexStore.stageVersionBatch({
    workspaceId: target.document.workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
    attemptId: claim.attempt.id,
    chunks,
  }, NOW_1);
  const state = indexStore.publishVersion({
    workspaceId: target.document.workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
    attemptId: claim.attempt.id,
    chunkCount: chunks.length,
  }, NOW_1);
  return { chunks, documentStore, indexStore, state, target };
};

type FixtureOptions = {
  db?: Database.Database;
  onStage?: (stage: KnowledgeEnrichmentPublicationStageValue) => void;
  uuidFactory?: () => string;
  text?: string;
  routeLoader?: (
    db: Database.Database,
    workspaceId: string,
  ) => KnowledgeEnrichmentWorkspaceRouteSource | null;
  routeResolver?: (
    source: KnowledgeEnrichmentWorkspaceRouteSource,
    requestRoute: KnowledgeEnrichmentRouteReference,
  ) => KnowledgeEnrichmentRouteReference;
};

const createFixture = (options: FixtureOptions = {}) => {
  const db = options.db ?? new Database(':memory:');
  db.pragma('foreign_keys = ON');
  new EnterpriseLeadWorkspaceStore(db);
  const source = routeSource();
  writeWorkspace(db, source);
  const indexed = createReadyIndexedDocument(
    db,
    options.text ?? 'The factory builds industrial robots for system integrators.',
  );
  let requestUuid = 0;
  const requestStore = new KnowledgeEnrichmentRequestStore(db, {
    uuidFactory: () => `request-${++requestUuid}`,
    clock: () => NOW_1,
  });
  const factStore = new KnowledgeFactStore(db, { requestStore, clock: () => NOW_2 });
  const initialRoute = new KnowledgeEnrichmentModelResolver({
    getWorkspace: workspaceId => workspaceId === source.id ? source : null,
  }).resolveForWorkspace(source.id);
  const request = requestStore.createOrGetAuthorizedRequest({
    workspaceId: source.id,
    documentId: indexed.target.document.id,
    documentVersionId: indexed.target.version.id,
    providerId: initialRoute.providerId,
    modelId: initialRoute.modelId,
    routingFingerprint: initialRoute.routingFingerprint,
    now: NOW_1,
  });
  const claim = requestStore.claimNext(NOW_1)!;
  let factUuid = 0;
  const publicationStore = new KnowledgeEnrichmentPublicationStore(
    db,
    factStore,
    requestStore,
    {
      loadWorkspaceRouteSourceInCurrentTransaction:
        options.routeLoader ?? readRouteSourceInCurrentTransaction,
      resolveExactRouteFromSource: options.routeResolver,
      uuidFactory: options.uuidFactory ?? (() => `fact-${++factUuid}`),
      clock: () => NOW_2,
      onStage: options.onStage,
    },
  );
  return {
    ...indexed,
    claim,
    db,
    factStore,
    initialRoute,
    publicationStore,
    request,
    requestStore,
    source,
  };
};

const candidate = (
  fixture: ReturnType<typeof createFixture>,
  overrides: Partial<KnowledgeEnrichmentPublicationCandidate> = {},
): KnowledgeEnrichmentPublicationCandidate => {
  const value = overrides.value ?? 'Industrial robots';
  const quote = 'builds industrial robots';
  return {
    domain: overrides.domain ?? KnowledgeFactDomain.ProductList,
    value,
    normalizedValue: overrides.normalizedValue ??
      normalizeEnterpriseKnowledgeValue(value).normalizedValue,
    evidence: overrides.evidence ?? [{
      chunkId: fixture.chunks[0].id,
      chunkOrdinal: fixture.chunks[0].ordinal,
      quote,
      normalizedQuote: normalizeKnowledgeEvidenceQuote(quote),
      confidence: 0.91,
    }],
  };
};

const selection = (
  fixture: ReturnType<typeof createFixture>,
  candidates: readonly KnowledgeEnrichmentPublicationCandidate[] = [candidate(fixture)],
  overrides: Partial<KnowledgeEnrichmentCandidateSelection> = {},
): KnowledgeEnrichmentCandidateSelection => {
  const selectedEvidenceCount = candidates.reduce((sum, item) => sum + item.evidence.length, 0);
  return {
    candidates,
    parsedCandidateCount: selectedEvidenceCount,
    validCandidateCount: candidates.length,
    discardedCandidateCount: 0,
    partialReasons: [],
    ...overrides,
  };
};

const publish = (
  fixture: ReturnType<typeof createFixture>,
  candidateSelection = selection(fixture),
) => {
  return fixture.publicationStore.publishValidatedCandidates({
    requestId: fixture.request.id,
    attemptId: fixture.claim.attempt.id,
    expectedPublishedGenerationId: fixture.state.publishedGenerationId!,
    expectedIndexedChunkCount: fixture.state.chunkCount,
    selection: candidateSelection,
    now: NOW_2,
  });
};

const linkRequestFact = (
  db: Database.Database,
  requestId: string,
  factId: string,
): void => {
  db.prepare(`
    INSERT INTO knowledge_enrichment_request_facts (request_id, fact_id)
    VALUES (?, ?)
  `).run(requestId, factId);
};

const expectPublicationError = (
  operation: () => unknown,
  code: string,
): KnowledgeEnrichmentPublicationError => {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(KnowledgeEnrichmentPublicationError);
  expect(thrown).toMatchObject({ code });
  expect(thrown).not.toHaveProperty('stack');
  expect(thrown).not.toHaveProperty('cause');
  expect(Object.keys(JSON.parse(JSON.stringify(thrown)))).toEqual(['code', 'message']);
  return thrown as KnowledgeEnrichmentPublicationError;
};

describe('KnowledgeEnrichmentPublicationStore atomic publication', () => {
  test('accepts the exact captured published generation and indexed count', () => {
    const fixture = createFixture();
    const indexState = fixture.indexStore.getState(fixture.target.version.id)!;

    const result = fixture.publicationStore.publishValidatedCandidates({
      requestId: fixture.request.id,
      attemptId: fixture.claim.attempt.id,
      expectedPublishedGenerationId: indexState.publishedGenerationId!,
      expectedIndexedChunkCount: indexState.chunkCount,
      selection: selection(fixture),
      now: NOW_2,
    });

    expect(result.summary.status).toBe(KnowledgeEnrichmentStatus.ReviewRequired);
  });

  test.each([
    ['generation', { expectedPublishedGenerationId: 'stale-generation' }],
    ['indexed count', { expectedIndexedChunkCount: 31 }],
  ])('rejects a stale expected %s before any durable publication write', (
    _label,
    overrides,
  ) => {
    const stages: KnowledgeEnrichmentPublicationStageValue[] = [];
    const fixture = createFixture({ onStage: stage => stages.push(stage) });
    const indexState = fixture.indexStore.getState(fixture.target.version.id)!;

    expectPublicationError(
      () => fixture.publicationStore.publishValidatedCandidates({
        requestId: fixture.request.id,
        attemptId: fixture.claim.attempt.id,
        expectedPublishedGenerationId: indexState.publishedGenerationId!,
        expectedIndexedChunkCount: indexState.chunkCount,
        selection: selection(fixture),
        now: NOW_2,
        ...overrides,
      }),
      KnowledgeBaseErrorCode.EnrichmentRequestStale,
    );

    expect(stages).toEqual([]);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM knowledge_facts').get())
      .toEqual({ count: 0 });
    expect(fixture.requestStore.getRequest(fixture.request.id)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Running,
      activeAttemptId: fixture.claim.attempt.id,
    });
    expect(fixture.requestStore.listAttempts(fixture.request.id)).toEqual([
      expect.objectContaining({
        id: fixture.claim.attempt.id,
        outcome: KnowledgeEnrichmentAttemptOutcome.Running,
      }),
    ]);
  });

  test('rejects a request store bound to another database connection', () => {
    const fixture = createFixture();
    const foreignDb = new Database(':memory:');
    const foreignRequestStore = new KnowledgeEnrichmentRequestStore(foreignDb);
    expectPublicationError(
      () => new KnowledgeEnrichmentPublicationStore(
        fixture.db,
        fixture.factStore,
        foreignRequestStore,
        { loadWorkspaceRouteSourceInCurrentTransaction: () => null },
      ),
      KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
    );
    foreignDb.close();
    fixture.db.close();
  });

  test('maps transaction-wrapper construction failures at the fixed publication boundary', () => {
    const fixture = createFixture();
    vi.spyOn(fixture.db, 'transaction').mockImplementation(() => {
      throw new Error('raw-transaction-wrapper-secret /private/knowledge.sqlite');
    });
    const error = expectPublicationError(
      () => publish(fixture),
      KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
    );
    expect(JSON.stringify(error)).not.toContain('raw-transaction-wrapper-secret');
    fixture.db.close();
  });

  test('delegates fact, evidence, membership, and reviewability writes to neutral fact primitives', () => {
    const fixture = createFixture();
    const primitiveNames = [
      'findPublicationFactsInCurrentTransaction',
      'findPublicationEvidenceInCurrentTransaction',
      'insertPublicationFactInCurrentTransaction',
      'insertPublicationEvidenceInCurrentTransaction',
      'insertPublicationMembershipsInCurrentTransaction',
      'hasReviewablePublicationFactsInCurrentTransaction',
    ] as const;
    const primitives = fixture.factStore as unknown as Record<
      string,
      (...args: never[]) => unknown
    >;
    const missing = primitiveNames.filter(name => typeof primitives[name] !== 'function');
    if (missing.length > 0) {
      fixture.db.close();
      expect(missing).toEqual([]);
      return;
    }
    const spies = primitiveNames.map(name => vi.spyOn(primitives, name));
    publish(fixture);
    for (const spy of spies) {
      expect(spy).toHaveBeenCalled();
    }
    fixture.db.close();
  });

  test('publishes pending facts, evidence, membership, attempt, request, and safe summary atomically', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const fixture = createFixture();
    const result = publish(fixture);
    expect(result.factIds).toEqual(['fact-1']);
    expect(result.summary).toMatchObject({
      requestId: fixture.request.id,
      status: KnowledgeEnrichmentStatus.ReviewRequired,
      progress: 100,
      validCandidateCount: 1,
      discardedCandidateCount: 0,
      pendingFactCount: 1,
      partialReasons: [],
      completedAt: null,
    });
    expect(fixture.factStore.getFact('fact-1')).toMatchObject({
      originatingRequestId: fixture.request.id,
      workspaceId: 'workspace-a',
      reviewStatus: KnowledgeFactReviewStatus.Pending,
      sourceKind: KnowledgeFactSourceKind.Extracted,
      revision: 1,
      projectionState: KnowledgeFactProjectionState.None,
    });
    const evidence = fixture.db.prepare(`
      SELECT
        id, workspace_id, fact_id, request_id, document_id, document_version_id,
        chunk_id, quote, confidence, extractor_provider_id, extractor_model_id,
        created_at, stale_at
      FROM knowledge_fact_evidence
      WHERE fact_id = 'fact-1'
      ORDER BY id
    `).all() as Array<Record<string, unknown>>;
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      workspace_id: 'workspace-a',
      fact_id: 'fact-1',
      request_id: fixture.request.id,
      document_id: fixture.target.document.id,
      document_version_id: fixture.target.version.id,
      chunk_id: fixture.chunks[0].id,
      quote: 'builds industrial robots',
      confidence: 0.91,
      extractor_provider_id: PROVIDER_ID,
      extractor_model_id: MODEL_ID,
      created_at: NOW_2,
      stale_at: null,
    });
    expect(fixture.db.prepare(`
      SELECT request_id, fact_id
      FROM knowledge_enrichment_request_facts
    `).all()).toEqual([{ request_id: fixture.request.id, fact_id: 'fact-1' }]);
    expect(fixture.requestStore.listAttempts(fixture.request.id)[0]).toMatchObject({
      outcome: 'completed',
      finishedAt: NOW_2,
      errorCode: null,
    });
    const serializedResult = JSON.stringify(result);
    expect(serializedResult).not.toContain('sk-task-6-secret');
    expect(serializedResult).not.toContain(fixture.initialRoute.routingFingerprint);
    expect(serializedResult).not.toContain('builds industrial robots');
    fixture.db.close();
  });

  test('allows evidence insertion before membership inside the owning publication transaction', () => {
    const db = new Database(':memory:');
    let observedIntermediateState = false;
    const fixture = createFixture({
      db,
      onStage: stage => {
        if (stage !== KnowledgeEnrichmentPublicationStage.AfterEvidence) {
          return;
        }
        observedIntermediateState = true;
        expect(db.prepare('SELECT COUNT(*) AS count FROM knowledge_fact_evidence').get())
          .toEqual({ count: 1 });
        expect(db.prepare('SELECT COUNT(*) AS count FROM knowledge_enrichment_request_facts').get())
          .toEqual({ count: 0 });
      },
    });

    publish(fixture);
    expect(observedIntermediateState).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS count FROM knowledge_enrichment_request_facts').get())
      .toEqual({ count: 1 });
    db.close();
  });

  test('completes a canonical empty selection without creating any publication row', () => {
    const fixture = createFixture();
    const result = publish(fixture, selection(fixture, [], {
      parsedCandidateCount: 0,
      validCandidateCount: 0,
      discardedCandidateCount: 0,
      partialReasons: [KnowledgeEnrichmentPartialReason.ChunkLimit],
    }));
    expect(result).toEqual({
      summary: expect.objectContaining({
        status: KnowledgeEnrichmentStatus.Completed,
        pendingFactCount: 0,
        validCandidateCount: 0,
        discardedCandidateCount: 0,
        partialReasons: [KnowledgeEnrichmentPartialReason.ChunkLimit],
        completedAt: NOW_2,
      }),
      factIds: [],
    });
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM knowledge_facts').get())
      .toEqual({ count: 0 });
    fixture.db.close();
  });

  test('atomically finalizes nonzero discarded counts and candidate-limit reason with facts', () => {
    const fixture = createFixture();
    const result = publish(fixture, selection(fixture, [candidate(fixture)], {
      parsedCandidateCount: 2,
      validCandidateCount: 1,
      discardedCandidateCount: 1,
      partialReasons: [KnowledgeEnrichmentPartialReason.CandidateLimit],
    }));
    expect(result).toMatchObject({
      factIds: ['fact-1'],
      summary: {
        status: KnowledgeEnrichmentStatus.ReviewRequired,
        validCandidateCount: 1,
        discardedCandidateCount: 1,
        partialReasons: [KnowledgeEnrichmentPartialReason.CandidateLimit],
        pendingFactCount: 1,
      },
    });
    expect(fixture.requestStore.getRequest(fixture.request.id)).toMatchObject({
      status: KnowledgeEnrichmentStatus.ReviewRequired,
      progress: 100,
      validCandidateCount: 1,
      discardedCandidateCount: 1,
      partialReasons: [KnowledgeEnrichmentPartialReason.CandidateLimit],
    });
    expect(fixture.factStore.getFact('fact-1')).not.toBeNull();
    fixture.db.close();
  });

  test('deduplicates active confirmed facts, preserves state, and bumps once for multiple new evidence rows', () => {
    const fixture = createFixture({
      text: 'The factory builds industrial robots and serves system integrators.',
    });
    const first = publish(fixture);
    const factId = first.factIds[0];
    fixture.db.prepare(`
      UPDATE knowledge_facts
      SET review_status = ?, projection_state = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      KnowledgeFactReviewStatus.Confirmed,
      KnowledgeFactProjectionState.Active,
      NOW_2,
      NOW_2,
      factId,
    );
    fixture.db.prepare(`
      UPDATE knowledge_enrichment_requests
      SET status = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(KnowledgeEnrichmentStatus.Completed, NOW_2, NOW_2, fixture.request.id);
    const secondRequest = fixture.requestStore.createOrGetAuthorizedRequest({
      workspaceId: 'workspace-a',
      documentId: fixture.target.document.id,
      documentVersionId: fixture.target.version.id,
      providerId: fixture.initialRoute.providerId,
      modelId: fixture.initialRoute.modelId,
      routingFingerprint: fixture.initialRoute.routingFingerprint,
      now: NOW_3,
    });
    const secondClaim = fixture.requestStore.claimNext(NOW_3)!;
    const secondQuote = 'serves system integrators';
    const secondSelection = selection(fixture, [candidate(fixture, {
      evidence: [
        candidate(fixture).evidence[0],
        {
          chunkId: fixture.chunks[0].id,
          chunkOrdinal: fixture.chunks[0].ordinal,
          quote: secondQuote,
          normalizedQuote: normalizeKnowledgeEvidenceQuote(secondQuote),
          confidence: 0.88,
        },
      ],
    })]);
    const result = fixture.publicationStore.publishValidatedCandidates({
      requestId: secondRequest.id,
      attemptId: secondClaim.attempt.id,
      expectedPublishedGenerationId:
        fixture.indexStore.getState(fixture.target.version.id)!.publishedGenerationId!,
      expectedIndexedChunkCount:
        fixture.indexStore.getState(fixture.target.version.id)!.chunkCount,
      selection: secondSelection,
      now: NOW_3,
    });

    expect(result.factIds).toEqual([factId]);
    expect(fixture.db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_facts
      WHERE normalized_value = 'industrial robots'
    `).get()).toEqual({ count: 1 });
    expect(fixture.factStore.getFact(factId)).toMatchObject({
      value: 'Industrial robots',
      originatingRequestId: fixture.request.id,
      reviewStatus: KnowledgeFactReviewStatus.Confirmed,
      projectionState: KnowledgeFactProjectionState.Active,
      revision: 2,
      updatedAt: NOW_3,
    });
    expect(fixture.db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_fact_evidence
      WHERE fact_id = ?
    `).get(factId)).toEqual({ count: 3 });
    expect(result.summary).toMatchObject({
      status: KnowledgeEnrichmentStatus.Completed,
      pendingFactCount: 0,
    });
    fixture.db.close();
  });

  test.each([
    ['rejected', KnowledgeFactReviewStatus.Rejected, null],
    ['tombstoned', KnowledgeFactReviewStatus.Confirmed, NOW_1],
  ])('never deduplicates against a %s identity', (_label, reviewStatus, tombstonedAt) => {
    const fixture = createFixture();
    fixture.db.prepare(`
      INSERT INTO knowledge_facts (
        id, originating_request_id, workspace_id, domain, value, normalized_value,
        review_status, source_kind, revision, conflict_group_key, projection_state,
        created_at, reviewed_at, updated_at, tombstoned_at
      ) VALUES (
        'old-fact', NULL, 'workspace-a', ?, 'Industrial robots', 'industrial robots',
        ?, ?, 1, NULL, ?, ?, ?, ?, ?
      )
    `).run(
      KnowledgeFactDomain.ProductList,
      reviewStatus,
      KnowledgeFactSourceKind.Manual,
      KnowledgeFactProjectionState.None,
      NOW_1,
      reviewStatus === KnowledgeFactReviewStatus.Rejected ? NOW_1 : null,
      NOW_1,
      tombstonedAt,
    );
    const result = publish(fixture);
    expect(result.factIds).toEqual(['fact-1']);
    expect(fixture.db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_facts
      WHERE normalized_value = 'industrial robots'
    `).get()).toEqual({ count: 2 });
    fixture.db.close();
  });

  test.each(Object.values(KnowledgeEnrichmentPublicationStage).filter(
    stage => stage !== KnowledgeEnrichmentPublicationStage.AfterRevalidationBeforeFirstWrite,
  ))('rolls back every row when the %s fault seam throws', stage => {
    let callbackCount = 0;
    const fixture = createFixture({
      onStage: currentStage => {
        if (currentStage === stage) {
          callbackCount += 1;
          throw new Error('raw-stage-secret /private/knowledge.sqlite');
        }
      },
    });
    const error = expectPublicationError(
      () => publish(fixture),
      KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
    );
    expect(callbackCount).toBe(1);
    expect(JSON.stringify(error)).not.toContain('raw-stage-secret');
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM knowledge_facts').get())
      .toEqual({ count: 0 });
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM knowledge_fact_evidence').get())
      .toEqual({ count: 0 });
    expect(fixture.db.prepare(`
      SELECT COUNT(*) AS count FROM knowledge_enrichment_request_facts
    `).get()).toEqual({ count: 0 });
    expect(fixture.requestStore.getRequest(fixture.request.id)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Running,
      activeAttemptId: fixture.claim.attempt.id,
      progress: 0,
      validCandidateCount: 0,
      discardedCandidateCount: 0,
      partialReasons: [],
    });
    expect(fixture.requestStore.listAttempts(fixture.request.id)[0].outcome).toBe('running');
    fixture.db.close();
  });
});

describe('KnowledgeEnrichmentPublicationStore selection and evidence identity', () => {
  test('rejects more than 200 candidates before reading any candidate record', () => {
    const fixture = createFixture();
    const candidates = Array.from({ length: 201 }, (_, index) => candidate(fixture, {
      value: `Candidate ${index}`,
      normalizedValue: `candidate ${index}`,
    }));
    const candidateSet = new Set<object>(candidates);
    const original = Object.getOwnPropertyDescriptors;
    let candidateReadCount = 0;
    vi.spyOn(Object, 'getOwnPropertyDescriptors').mockImplementation(value => {
      if (candidateSet.has(value)) {
        candidateReadCount += 1;
      }
      return original(value);
    });
    expectPublicationError(
      () => publish(fixture, selection(fixture, candidates)),
      KnowledgeBaseErrorCode.EvidenceValidationFailed,
    );
    expect(candidateReadCount).toBe(0);
    fixture.db.close();
  });

  test('rejects more than 1,500 evidence rows before reading any evidence record', () => {
    const fixture = createFixture();
    const evidence = Array.from({ length: 1_501 }, () => ({
      ...candidate(fixture).evidence[0],
    }));
    const evidenceSet = new Set<object>(evidence);
    const original = Object.getOwnPropertyDescriptors;
    let evidenceReadCount = 0;
    vi.spyOn(Object, 'getOwnPropertyDescriptors').mockImplementation(value => {
      if (evidenceSet.has(value)) {
        evidenceReadCount += 1;
      }
      return original(value);
    });
    expectPublicationError(
      () => publish(fixture, selection(fixture, [candidate(fixture, { evidence })])),
      KnowledgeBaseErrorCode.EvidenceValidationFailed,
    );
    expect(evidenceReadCount).toBe(0);
    fixture.db.close();
  });

  test('enforces the 1,500 evidence budget across candidates before reading overflow rows', () => {
    const fixture = createFixture();
    const repeatedEvidence = Array.from({ length: 1_500 }, () => ({
      ...candidate(fixture).evidence[0],
    }));
    const overflowEvidence = { ...candidate(fixture).evidence[0] };
    const original = Object.getOwnPropertyDescriptors;
    let overflowReadCount = 0;
    vi.spyOn(Object, 'getOwnPropertyDescriptors').mockImplementation(value => {
      if (value === overflowEvidence) {
        overflowReadCount += 1;
      }
      return original(value);
    });
    const candidates = [
      candidate(fixture, { evidence: repeatedEvidence }),
      candidate(fixture, {
        value: 'System integrators',
        normalizedValue: 'system integrators',
        evidence: [overflowEvidence],
      }),
    ];
    expectPublicationError(
      () => publish(fixture, selection(fixture, candidates)),
      KnowledgeBaseErrorCode.EvidenceValidationFailed,
    );
    expect(overflowReadCount).toBe(0);
    fixture.db.close();
  });

  test('rejects more than two partial reasons before reading any reason element', () => {
    const fixture = createFixture();
    const reasons = [
      KnowledgeEnrichmentPartialReason.ChunkLimit,
      KnowledgeEnrichmentPartialReason.CandidateLimit,
      KnowledgeEnrichmentPartialReason.ChunkLimit,
    ];
    const original = Object.getOwnPropertyDescriptor;
    let reasonElementReadCount = 0;
    vi.spyOn(Object, 'getOwnPropertyDescriptor').mockImplementation((value, key) => {
      if (value === reasons && key !== 'length') {
        reasonElementReadCount += 1;
      }
      return original(value, key);
    });
    expectPublicationError(
      () => publish(fixture, selection(fixture, [candidate(fixture)], {
        partialReasons: reasons,
      })),
      KnowledgeBaseErrorCode.EvidenceValidationFailed,
    );
    expect(reasonElementReadCount).toBe(0);
    fixture.db.close();
  });

  test.each([
    ['candidate count mismatch', (fixture: ReturnType<typeof createFixture>) =>
      selection(fixture, [candidate(fixture)], { validCandidateCount: 2 })],
    ['negative parsed count', (fixture: ReturnType<typeof createFixture>) =>
      selection(fixture, [candidate(fixture)], { parsedCandidateCount: -1 })],
    ['fractional discarded count', (fixture: ReturnType<typeof createFixture>) =>
      selection(fixture, [candidate(fixture)], { discardedCandidateCount: 0.5 })],
    ['unsafe parsed count', (fixture: ReturnType<typeof createFixture>) =>
      selection(fixture, [candidate(fixture)], {
        parsedCandidateCount: Number.MAX_SAFE_INTEGER + 1,
      })],
    ['discarded count beyond parsed count', (fixture: ReturnType<typeof createFixture>) =>
      selection(fixture, [candidate(fixture)], {
        parsedCandidateCount: 1,
        discardedCandidateCount: 2,
      })],
    ['selected plus discarded count beyond parsed count',
      (fixture: ReturnType<typeof createFixture>) => selection(
        fixture,
        [candidate(fixture)],
        { parsedCandidateCount: 1, discardedCandidateCount: 1 },
      )],
    ['duplicate partial reasons', (fixture: ReturnType<typeof createFixture>) =>
      selection(fixture, [candidate(fixture)], {
        partialReasons: [
          KnowledgeEnrichmentPartialReason.ChunkLimit,
          KnowledgeEnrichmentPartialReason.ChunkLimit,
        ],
      })],
    ['out-of-order partial reasons', (fixture: ReturnType<typeof createFixture>) =>
      selection(fixture, [candidate(fixture)], {
        partialReasons: [
          KnowledgeEnrichmentPartialReason.CandidateLimit,
          KnowledgeEnrichmentPartialReason.ChunkLimit,
        ],
      })],
    ['candidate-limit reason for an empty selection', (fixture: ReturnType<typeof createFixture>) =>
      selection(fixture, [], {
        parsedCandidateCount: 0,
        validCandidateCount: 0,
        discardedCandidateCount: 0,
        partialReasons: [KnowledgeEnrichmentPartialReason.CandidateLimit],
      })],
    ['nonzero counts for an empty selection', (fixture: ReturnType<typeof createFixture>) =>
      selection(fixture, [], {
        parsedCandidateCount: 1,
        validCandidateCount: 0,
        discardedCandidateCount: 1,
      })],
    ['candidate without evidence', (fixture: ReturnType<typeof createFixture>) =>
      selection(fixture, [candidate(fixture, { evidence: [] })], { parsedCandidateCount: 1 })],
    ['noncanonical value', (fixture: ReturnType<typeof createFixture>) =>
      selection(fixture, [candidate(fixture, { normalizedValue: 'wrong' })])],
    ['noncanonical quote', (fixture: ReturnType<typeof createFixture>) =>
      selection(fixture, [candidate(fixture, {
        evidence: [{
          ...candidate(fixture).evidence[0],
          normalizedQuote: 'wrong',
        }],
      })])],
    ['astral value beyond UTF-16 bound', (fixture: ReturnType<typeof createFixture>) => {
      const value = '😀'.repeat(1_001);
      return selection(fixture, [candidate(fixture, {
        value,
        normalizedValue: normalizeEnterpriseKnowledgeValue(value).normalizedValue,
      })]);
    }],
    ['astral quote beyond UTF-16 bound', (fixture: ReturnType<typeof createFixture>) => {
      const quote = '😀'.repeat(501);
      return selection(fixture, [candidate(fixture, {
        evidence: [{
          ...candidate(fixture).evidence[0],
          quote,
          normalizedQuote: normalizeKnowledgeEvidenceQuote(quote),
        }],
      })]);
    }],
    ['more than thirty distinct chunks', (fixture: ReturnType<typeof createFixture>) => {
      const evidence = Array.from({ length: 31 }, (_, index) => ({
        ...candidate(fixture).evidence[0],
        chunkId: `foreign-chunk-${index}`,
        chunkOrdinal: index,
      }));
      return selection(fixture, [candidate(fixture, { evidence })], {
        parsedCandidateCount: 31,
      });
    }],
  ])('rejects %s before durable publication', (_label, buildSelection) => {
    const fixture = createFixture();
    expectPublicationError(
      () => publish(fixture, buildSelection(fixture)),
      KnowledgeBaseErrorCode.EvidenceValidationFailed,
    );
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM knowledge_facts').get())
      .toEqual({ count: 0 });
    fixture.db.close();
  });

  test('locks the evidence hash vector, normalized quote stability, and request/chunk domain separation', () => {
    const input = {
      requestId: 'request-a',
      factId: 'fact-a',
      documentVersionId: 'version-a',
      chunkId: 'chunk-a',
      normalizedQuote: 'normalized quote',
    };
    const expected = '1d8fdebece2428d1b2f015ca76e6165fdcb5d9cd6580f1e483cf5cc0e6035a67';
    expect(buildKnowledgeEvidenceId(input)).toBe(expected);
    expect(buildKnowledgeEvidenceId({ ...input })).toBe(expected);
    expect(buildKnowledgeEvidenceId({
      ...input,
      normalizedQuote: normalizeKnowledgeEvidenceQuote(' normalized   quote '),
    })).toBe(expected);
    expect(buildKnowledgeEvidenceId({ ...input, requestId: 'request-b' })).not.toBe(expected);
    expect(buildKnowledgeEvidenceId({ ...input, chunkId: 'chunk-b' })).not.toBe(expected);
  });

  test('treats normalization-equivalent existing evidence as idempotent and preserves first display fields', () => {
    const fixture = createFixture();
    const incoming = candidate(fixture);
    const factId = 'existing-fact';
    fixture.db.prepare(`
      INSERT INTO knowledge_facts (
        id, originating_request_id, workspace_id, domain, value, normalized_value,
        review_status, source_kind, revision, conflict_group_key, projection_state,
        created_at, reviewed_at, updated_at, tombstoned_at
      ) VALUES (?, ?, 'workspace-a', ?, ?, ?, ?, ?, 1, NULL, ?, ?, NULL, ?, NULL)
    `).run(
      factId,
      fixture.request.id,
      incoming.domain,
      incoming.value,
      incoming.normalizedValue,
      KnowledgeFactReviewStatus.Pending,
      KnowledgeFactSourceKind.Extracted,
      KnowledgeFactProjectionState.None,
      NOW_1,
      NOW_1,
    );
    const normalizedQuote = incoming.evidence[0].normalizedQuote;
    const evidenceId = buildKnowledgeEvidenceId({
      requestId: fixture.request.id,
      factId,
      documentVersionId: fixture.target.version.id,
      chunkId: fixture.chunks[0].id,
      normalizedQuote,
    });
    fixture.db.prepare(`
      INSERT INTO knowledge_fact_evidence (
        id, workspace_id, fact_id, request_id, document_id, document_version_id,
        chunk_id, quote, confidence, extractor_provider_id, extractor_model_id,
        created_at, stale_at
      ) VALUES (?, 'workspace-a', ?, ?, ?, ?, ?, ?, 0.42, ?, ?, ?, NULL)
    `).run(
      evidenceId,
      factId,
      fixture.request.id,
      fixture.target.document.id,
      fixture.target.version.id,
      fixture.chunks[0].id,
      ' builds   industrial robots ',
      PROVIDER_ID,
      MODEL_ID,
      NOW_1,
    );
    linkRequestFact(fixture.db, fixture.request.id, factId);
    const result = publish(fixture);
    expect(result.factIds).toEqual([factId]);
    expect(fixture.factStore.getFact(factId)?.revision).toBe(1);
    expect(fixture.db.prepare(`
      SELECT quote, confidence
      FROM knowledge_fact_evidence
      WHERE id = ? AND fact_id = ?
    `).get(evidenceId, factId)).toMatchObject({
      quote: ' builds   industrial robots ',
      confidence: 0.42,
    });
    fixture.db.close();
  });

  test('fails a same-hash context collision closed', () => {
    const fixture = createFixture();
    const incoming = candidate(fixture);
    const factId = 'existing-fact';
    fixture.db.prepare(`
      INSERT INTO knowledge_facts (
        id, originating_request_id, workspace_id, domain, value, normalized_value,
        review_status, source_kind, revision, conflict_group_key, projection_state,
        created_at, reviewed_at, updated_at, tombstoned_at
      ) VALUES (?, ?, 'workspace-a', ?, ?, ?, ?, ?, 1, NULL, ?, ?, NULL, ?, NULL)
    `).run(
      factId,
      fixture.request.id,
      incoming.domain,
      incoming.value,
      incoming.normalizedValue,
      KnowledgeFactReviewStatus.Pending,
      KnowledgeFactSourceKind.Extracted,
      KnowledgeFactProjectionState.None,
      NOW_1,
      NOW_1,
    );
    const evidenceId = buildKnowledgeEvidenceId({
      requestId: fixture.request.id,
      factId,
      documentVersionId: fixture.target.version.id,
      chunkId: fixture.chunks[0].id,
      normalizedQuote: incoming.evidence[0].normalizedQuote,
    });
    fixture.db.prepare(`
      INSERT INTO knowledge_fact_evidence (
        id, workspace_id, fact_id, request_id, document_id, document_version_id,
        chunk_id, quote, confidence, extractor_provider_id, extractor_model_id,
        created_at, stale_at
      ) VALUES (?, 'workspace-a', ?, ?, ?, ?, ?, ?, 0.9, 'wrong-provider', ?, ?, NULL)
    `).run(
      evidenceId,
      factId,
      fixture.request.id,
      fixture.target.document.id,
      fixture.target.version.id,
      fixture.chunks[0].id,
      incoming.evidence[0].quote,
      MODEL_ID,
      NOW_1,
    );
    linkRequestFact(fixture.db, fixture.request.id, factId);
    expectPublicationError(
      () => publish(fixture),
      KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
    );
    expect(fixture.requestStore.getRequest(fixture.request.id)?.status).toBe(
      KnowledgeEnrichmentStatus.Running,
    );
    fixture.db.close();
  });

  test('canonicalizes candidate order before assigning persistent fact ids', () => {
    const first = createFixture();
    const second = createFixture();
    const buildCandidates = (fixture: ReturnType<typeof createFixture>) => [
      candidate(fixture, {
        domain: KnowledgeFactDomain.TargetCustomers,
        value: 'System integrators',
        normalizedValue: 'system integrators',
      }),
      candidate(fixture),
    ];
    const firstResult = publish(first, selection(first, buildCandidates(first)));
    const secondCandidates = buildCandidates(second).reverse();
    const secondResult = publish(second, selection(second, secondCandidates));
    expect(firstResult.factIds).toEqual(['fact-1', 'fact-2']);
    expect(secondResult.factIds).toEqual(firstResult.factIds);
    expect(firstResult.factIds.map(id => first.factStore.getFact(id)?.domain)).toEqual(
      secondResult.factIds.map(id => second.factStore.getFact(id)?.domain),
    );
    first.db.close();
    second.db.close();
  });
});

describe('KnowledgeEnrichmentPublicationStore lifecycle and WAL races', () => {
  test.each([
    ['missing route source', () => null],
    ['route source parser failure', () => {
      throw new SyntaxError('raw-route-profile-secret');
    }],
  ])('maps %s to model_configuration_unavailable', (_label, routeLoader) => {
    const fixture = createFixture({ routeLoader });
    const error = expectPublicationError(
      () => publish(fixture),
      KnowledgeBaseErrorCode.ModelConfigurationUnavailable,
    );
    expect(JSON.stringify(error)).not.toContain('raw-route-profile-secret');
    fixture.db.close();
  });

  test('maps a pure route tuple mismatch to model_configuration_changed', () => {
    const fixture = createFixture({
      routeResolver: (_source, requestRoute) => ({
        ...requestRoute,
        modelId: 'changed-model',
      }),
    });
    expectPublicationError(
      () => publish(fixture),
      KnowledgeBaseErrorCode.ModelConfigurationChanged,
    );
    fixture.db.close();
  });

  test('maps a newly unsupported current provider without publishing rows', () => {
    const fixture = createFixture();
    const unsupported = routeSource();
    unsupported.settings.model.providers[PROVIDER_ID] = {
      ...providerConfig(),
      apiFormat: 'anthropic',
    };
    fixture.db.prepare(`
      UPDATE enterprise_lead_workspaces
      SET settings = ?
      WHERE id = 'workspace-a'
    `).run(JSON.stringify({ model: unsupported.settings.model }));
    expectPublicationError(
      () => publish(fixture),
      KnowledgeBaseErrorCode.UnsupportedModelProvider,
    );
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM knowledge_facts').get())
      .toEqual({ count: 0 });
    fixture.db.close();
  });

  test('maps a wrong attempt lease to enrichment_request_stale', () => {
    const fixture = createFixture();
    expectPublicationError(
      () => fixture.publicationStore.publishValidatedCandidates({
        requestId: fixture.request.id,
        attemptId: 'wrong-attempt',
        expectedPublishedGenerationId:
          fixture.indexStore.getState(fixture.target.version.id)!.publishedGenerationId!,
        expectedIndexedChunkCount:
          fixture.indexStore.getState(fixture.target.version.id)!.chunkCount,
        selection: selection(fixture),
        now: NOW_2,
      }),
      KnowledgeBaseErrorCode.EnrichmentRequestStale,
    );
    fixture.db.close();
  });

  test('retries the whole transaction when the route-source loader reports SQLITE_BUSY', () => {
    let loaderCallCount = 0;
    const fixture = createFixture({
      routeLoader: (db, workspaceId) => {
        loaderCallCount += 1;
        if (loaderCallCount === 1) {
          throw Object.assign(new Error('raw-loader-busy-secret'), {
            code: 'SQLITE_BUSY',
          });
        }
        return readRouteSourceInCurrentTransaction(db, workspaceId);
      },
    });
    expect(publish(fixture).factIds).toEqual(['fact-1']);
    expect(loaderCallCount).toBe(2);
    fixture.db.close();
  });

  test('maps a nontransient SQLite route-loader error to persistence failure', () => {
    const fixture = createFixture({
      routeLoader: () => {
        throw Object.assign(new Error('raw-loader-io-secret /private/knowledge.sqlite'), {
          code: 'SQLITE_IOERR',
        });
      },
    });
    const error = expectPublicationError(
      () => publish(fixture),
      KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
    );
    expect(JSON.stringify(error)).not.toContain('raw-loader-io-secret');
    fixture.db.close();
  });

  test.each([
    ['cancelled request', (fixture: ReturnType<typeof createFixture>) => {
      fixture.requestStore.cancel(fixture.request.id, fixture.request.revision, NOW_2);
    }, KnowledgeBaseErrorCode.EnrichmentRequestStale],
    ['deleted document', (fixture: ReturnType<typeof createFixture>) => {
      fixture.db.prepare(`UPDATE knowledge_documents SET deleted_at = ? WHERE id = ?`)
        .run(NOW_2, fixture.target.document.id);
    }, KnowledgeBaseErrorCode.EnrichmentRequestStale],
    ['replaced version', (fixture: ReturnType<typeof createFixture>) => {
      fixture.db.prepare(`UPDATE knowledge_documents SET current_version_id = 'replacement' WHERE id = ?`)
        .run(fixture.target.document.id);
    }, KnowledgeBaseErrorCode.EnrichmentRequestStale],
    ['invalidated index', (fixture: ReturnType<typeof createFixture>) => {
      fixture.db.prepare(`
        UPDATE knowledge_document_index_state
        SET status = ?, published_generation_id = NULL
        WHERE document_version_id = ?
      `).run(KnowledgeDocumentIndexStatus.Failed, fixture.target.version.id);
    }, KnowledgeBaseErrorCode.EnrichmentRequestStale],
    ['rotated API key', (fixture: ReturnType<typeof createFixture>) => {
      const rotated = routeSource('sk-rotated');
      fixture.db.prepare(`UPDATE enterprise_lead_workspaces SET settings = ? WHERE id = 'workspace-a'`)
        .run(JSON.stringify({ model: rotated.settings.model }));
    }, KnowledgeBaseErrorCode.ModelConfigurationChanged],
  ])('rejects a %s before the first durable write', (_label, mutate, code) => {
    const fixture = createFixture();
    mutate(fixture);
    expectPublicationError(() => publish(fixture), code);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM knowledge_facts').get())
      .toEqual({ count: 0 });
    fixture.db.close();
  });

  test('rejects a foreign or ordinal-mismatched current-generation chunk', () => {
    const fixture = createFixture();
    const validEvidence = candidate(fixture).evidence[0];
    for (const evidence of [
      { ...validEvidence, chunkId: 'foreign-chunk' },
      { ...validEvidence, chunkOrdinal: validEvidence.chunkOrdinal + 1 },
      { ...validEvidence, quote: 'not owned', normalizedQuote: 'not owned' },
    ]) {
      expectPublicationError(
        () => publish(fixture, selection(fixture, [candidate(fixture, { evidence: [evidence] })])),
        KnowledgeBaseErrorCode.EvidenceValidationFailed,
      );
    }
    fixture.db.close();
  });

  test.each([
    ['cancel', (db: Database.Database, fixture: ReturnType<typeof createFixture>) => {
      new KnowledgeEnrichmentRequestStore(db).cancel(
        fixture.request.id,
        fixture.request.revision,
        NOW_3,
      );
    }, KnowledgeBaseErrorCode.EnrichmentRequestStale],
    ['delete', (db: Database.Database, fixture: ReturnType<typeof createFixture>) => {
      db.prepare(`UPDATE knowledge_documents SET deleted_at = ? WHERE id = ?`)
        .run(NOW_3, fixture.target.document.id);
    }, KnowledgeBaseErrorCode.EnrichmentRequestStale],
    ['replace', (db: Database.Database, fixture: ReturnType<typeof createFixture>) => {
      db.prepare(`UPDATE knowledge_documents SET current_version_id = 'replacement' WHERE id = ?`)
        .run(fixture.target.document.id);
    }, KnowledgeBaseErrorCode.EnrichmentRequestStale],
    ['invalidate index', (db: Database.Database, fixture: ReturnType<typeof createFixture>) => {
      db.prepare(`
        UPDATE knowledge_document_index_state
        SET status = ?, published_generation_id = NULL
        WHERE document_version_id = ?
      `).run(KnowledgeDocumentIndexStatus.Failed, fixture.target.version.id);
    }, KnowledgeBaseErrorCode.EnrichmentRequestStale],
    ['rotate route', (db: Database.Database) => {
      const rotated = routeSource('sk-raced-rotation');
      db.prepare(`UPDATE enterprise_lead_workspaces SET settings = ? WHERE id = 'workspace-a'`)
        .run(JSON.stringify({ model: rotated.settings.model }));
    }, KnowledgeBaseErrorCode.ModelConfigurationChanged],
  ])('retries the whole WAL snapshot after concurrent %s', (_label, mutate, code) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'task-6-publication-wal-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'knowledge.sqlite');
    const dbA = new Database(databasePath);
    applySqliteConnectionPolicy(dbA);
    dbA.pragma('busy_timeout = 0');
    let dbB: Database.Database | null = null;
    let mutated = false;
    let fixture!: ReturnType<typeof createFixture>;
    fixture = createFixture({
      db: dbA,
      onStage: stage => {
        if (
          stage !== KnowledgeEnrichmentPublicationStage.AfterRevalidationBeforeFirstWrite ||
          mutated
        ) {
          return;
        }
        mutated = true;
        dbB = new Database(databasePath);
        applySqliteConnectionPolicy(dbB);
        dbB.pragma('busy_timeout = 0');
        mutate(dbB, fixture);
      },
    });
    expectPublicationError(() => publish(fixture), code);
    expect(mutated).toBe(true);
    expect(dbA.prepare('SELECT COUNT(*) AS count FROM knowledge_facts').get())
      .toEqual({ count: 0 });
    expect(dbA.prepare('SELECT COUNT(*) AS count FROM knowledge_fact_evidence').get())
      .toEqual({ count: 0 });
    dbB?.close();
    dbA.close();
  });
});

describe('KnowledgeEnrichmentPublicationStore privacy boundary', () => {
  test('maps every stage-hook exception to the fixed persistence error', () => {
    const fixture = createFixture({
      onStage: stage => {
        if (stage === KnowledgeEnrichmentPublicationStage.AfterFacts) {
          throw new KnowledgeEnrichmentPublicationError(
            KnowledgeBaseErrorCode.EvidenceValidationFailed,
          );
        }
      },
    });
    expectPublicationError(
      () => publish(fixture),
      KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
    );
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM knowledge_facts').get())
      .toEqual({ count: 0 });
    fixture.db.close();
  });

  test('never logs a raw persistence exception even when a debug environment flag is present', () => {
    const previous = process.env.TASK6_PUBLICATION_DEBUG;
    process.env.TASK6_PUBLICATION_DEBUG = '1';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = createFixture({
      onStage: stage => {
        if (stage === KnowledgeEnrichmentPublicationStage.AfterFacts) {
          throw new Error('raw-publication-secret /private/knowledge.sqlite');
        }
      },
    });
    try {
      expectPublicationError(
        () => publish(fixture),
        KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
      );
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.TASK6_PUBLICATION_DEBUG;
      } else {
        process.env.TASK6_PUBLICATION_DEBUG = previous;
      }
      fixture.db.close();
    }
  });

  test('sanitizes non-allowlisted publication error codes at runtime', () => {
    const error = new KnowledgeEnrichmentPublicationError(
      'raw-secret-code' as never,
    );
    expect(error).toMatchObject({
      code: KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
      message: 'Knowledge enrichment publication failed',
    });
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      code: KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
      message: 'Knowledge enrichment publication failed',
    });
  });

  test('rejects accessor/extra raw payload data without serializing or persisting it', () => {
    const fixture = createFixture();
    const promptSentinel = 'PROMPT-SECRET-/Users/private/source.txt';
    const unsafeSelection = {
      ...selection(fixture),
      rawResponse: promptSentinel,
      candidates: selection(fixture).candidates.map(item => ({
        ...item,
        prompt: promptSentinel,
      })),
    } as unknown as KnowledgeEnrichmentCandidateSelection;
    const error = expectPublicationError(
      () => publish(fixture, unsafeSelection),
      KnowledgeBaseErrorCode.EvidenceValidationFailed,
    );
    expect(JSON.stringify(error)).not.toContain(promptSentinel);
    const persisted = fixture.db.prepare(`
      SELECT GROUP_CONCAT(value, '\n') AS value
      FROM (
        SELECT CAST(value AS TEXT) AS value
        FROM knowledge_facts
        UNION ALL
        SELECT quote FROM knowledge_fact_evidence
        UNION ALL
        SELECT error_message FROM knowledge_enrichment_requests
        UNION ALL
        SELECT error_message FROM knowledge_enrichment_attempts
      )
    `).get() as { value: string | null };
    expect(persisted.value ?? '').not.toContain(promptSentinel);
    expect(persisted.value ?? '').not.toContain('sk-task-6-secret');
    fixture.db.close();
  });
});
