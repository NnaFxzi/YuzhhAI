import { readFileSync } from 'node:fs';

import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import type { EnterpriseLeadWorkspaceProfile } from '../../shared/enterpriseLeadWorkspace/types';
import {
  KNOWLEDGE_FACT_EVIDENCE_PAGE_DEFAULT_LIMIT,
  KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT,
  KnowledgeBaseErrorCode,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeEnrichmentStatus,
  KnowledgeFactDomain,
  KnowledgeFactEvidenceState,
  KnowledgeFactListView,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
} from '../../shared/knowledgeBase/constants';
import { normalizeEnterpriseKnowledgeValue } from '../../shared/knowledgeBase/enterpriseLeadProfileKnowledge';
import type {
  KnowledgeFactEvidencePageRequest,
  KnowledgeFactEvidencePageResult,
} from '../../shared/knowledgeBase/types';
import { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';
import { KnowledgeEnrichmentRequestStore } from './knowledgeEnrichmentRequestStore';
import {
  KnowledgeFactQueryService,
} from './knowledgeFactQueryService';
import {
  KnowledgeFactStateError,
  KnowledgeFactStore,
} from './knowledgeFactStore';

const NOW_1 = '2026-07-12T01:00:00.000Z';
const NOW_2 = '2026-07-12T02:00:00.000Z';
const NOW_3 = '2026-07-12T03:00:00.000Z';
const NOW_4 = '2026-07-12T04:00:00.000Z';
const NOW_5 = '2026-07-12T05:00:00.000Z';
const NOW_6 = '2026-07-12T06:00:00.000Z';
const NOW_7 = '2026-07-12T07:00:00.000Z';
const NOW_8 = '2026-07-12T08:00:00.000Z';
const ROUTING_FINGERPRINT = 'a'.repeat(64);

const getFactEvidencePage = (
  service: KnowledgeFactQueryService,
  input: KnowledgeFactEvidencePageRequest,
): KnowledgeFactEvidencePageResult => (
  service.getFactEvidence as unknown as (
    request: KnowledgeFactEvidencePageRequest,
  ) => KnowledgeFactEvidencePageResult
)(input);

const encodeRawCursorJson = (json: string): string =>
  Buffer.from(json, 'utf8').toString('base64url');

const makeNonCanonicalBase64urlAlias = (token: string): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const byteRemainder = Buffer.from(token, 'base64url').length % 3;
  const unusedBitMask = byteRemainder === 1 ? 0b1111 : 0b11;
  const finalIndex = alphabet.indexOf(token.at(-1)!);
  return `${token.slice(0, -1)}${alphabet[finalIndex | (unusedBitMask & 1)]}`;
};

const evidenceCursorJson = (overrides: Partial<{
  v: number;
  factId: string;
  factRevision: number;
  stale: boolean;
  confidence: number;
  createdAt: string;
  id: string;
}> = {}): string => JSON.stringify({
  v: 1,
  factId: 'fact-confirmed-active',
  factRevision: 1,
  stale: false,
  confidence: 0.5,
  createdAt: NOW_2,
  id: '2'.repeat(64),
  ...overrides,
});

const emptyProfile = (): EnterpriseLeadWorkspaceProfile => ({
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

const createFixture = () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  new EnterpriseLeadWorkspaceStore(db);
  db.prepare(`
    INSERT INTO enterprise_lead_workspaces (
      id, name, type, profile, extraction_sources, risk_rules,
      enabled_agent_roles, settings, workspace_agents, recent_run_id,
      created_at, updated_at
    ) VALUES (
      'workspace-a', 'Workspace A', 'enterprise_lead', ?, '[]', '[]',
      '[]', NULL, NULL, NULL, ?, ?
    )
  `).run(JSON.stringify(emptyProfile()), NOW_1, NOW_1);
  const requestStore = new KnowledgeEnrichmentRequestStore(db, {
    uuidFactory: () => 'unused-request-id',
    clock: () => NOW_1,
  });
  const documentStore = new KnowledgeDocumentStore(db);
  const factStore = new KnowledgeFactStore(db, { requestStore, clock: () => NOW_1 });
  const service = new KnowledgeFactQueryService(factStore);
  return { db, documentStore, factStore, requestStore, service };
};

const createDocument = (
  documentStore: KnowledgeDocumentStore,
  workspaceId = 'workspace-a',
  displayName = 'evidence-source.txt',
) =>
  documentStore.createDocumentWithVersion({
    workspaceId,
    displayName,
    sourceMode: KnowledgeDocumentSourceMode.Managed,
    status: KnowledgeDocumentStatus.Ready,
    version: {
      contentHash: 'f'.repeat(64),
      managedPath: 'blobs/evidence-source',
      mimeType: 'text/plain',
      fileSize: 100,
      sourceMtime: null,
      parser: 'text',
      extractedText: 'Evidence content',
      extractionPartial: false,
    },
  });

const insertRequest = (
  db: Database.Database,
  document: ReturnType<typeof createDocument>,
  input: {
    id?: string;
    workspaceId?: string;
  } = {},
): void => {
  db.prepare(`
    INSERT INTO knowledge_enrichment_requests (
      id, workspace_id, document_id, document_version_id, status, consent_mode,
      provider_id, model_id, routing_fingerprint, revision, progress, attempt_count,
      active_attempt_id, error_code, error_message, valid_candidate_count,
      discarded_candidate_count, partial_reasons_json, requested_at, started_at,
      heartbeat_at, completed_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, 'explicit',
      'provider-a', 'model-a', ?, 1, 100, 1,
      NULL, NULL, NULL, 7,
      0, '[]', ?, ?, NULL, NULL, ?
    )
  `).run(
    input.id ?? 'request-a',
    input.workspaceId ?? 'workspace-a',
    document.document.id,
    document.version.id,
    KnowledgeEnrichmentStatus.ReviewRequired,
    ROUTING_FINGERPRINT,
    NOW_1,
    NOW_1,
    NOW_1,
  );
};

const insertFact = (db: Database.Database, input: {
  id: string;
  value: string;
  reviewStatus: string;
  updatedAt: string;
  sourceKind?: string;
  tombstonedAt?: string | null;
  reviewedAt?: string | null;
}): void => {
  db.prepare(`
    INSERT INTO knowledge_facts (
      id, originating_request_id, workspace_id, domain, value, normalized_value,
      review_status, source_kind, revision, conflict_group_key, projection_state,
      created_at, reviewed_at, updated_at, tombstoned_at
    ) VALUES (
      ?, NULL, 'workspace-a', ?, ?, ?,
      ?, ?, 1, NULL, ?,
      ?, ?, ?, ?
    )
  `).run(
    input.id,
    KnowledgeFactDomain.ProductList,
    input.value,
    normalizeEnterpriseKnowledgeValue(input.value).normalizedValue,
    input.reviewStatus,
    input.sourceKind ?? KnowledgeFactSourceKind.Manual,
    KnowledgeFactProjectionState.None,
    NOW_1,
    input.reviewedAt ?? null,
    input.updatedAt,
    input.tombstonedAt ?? null,
  );
};

const insertEvidence = (
  db: Database.Database,
  document: ReturnType<typeof createDocument>,
  input: {
    idDigit?: string;
    id?: string;
    factId: string;
    quote: string;
    confidence: number;
    createdAt: string;
    stale?: boolean;
    requestId?: string;
    workspaceId?: string;
  },
): void => {
  const evidenceId = input.id ?? (input.idDigit ? input.idDigit.repeat(64) : '');
  db.prepare(`
    INSERT INTO knowledge_fact_evidence (
      id, workspace_id, fact_id, request_id, document_id, document_version_id,
      chunk_id, quote, confidence, extractor_provider_id, extractor_model_id,
      created_at, stale_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, 'provider-a', 'model-a', ?, ?
    )
  `).run(
    evidenceId,
    input.workspaceId ?? 'workspace-a',
    input.factId,
    input.requestId ?? 'request-a',
    document.document.id,
    document.version.id,
    `chunk-${input.idDigit ?? input.id}`,
    input.quote,
    input.confidence,
    input.createdAt,
    input.stale ? NOW_8 : null,
  );
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

const seedQueryMatrix = () => {
  const fixture = createFixture();
  const document = createDocument(fixture.documentStore);
  insertRequest(fixture.db, document);
  insertFact(fixture.db, {
    id: 'fact-pending-active',
    value: 'Pending value',
    reviewStatus: KnowledgeFactReviewStatus.Pending,
    updatedAt: NOW_8,
  });
  insertFact(fixture.db, {
    id: 'fact-confirmed-active',
    value: 'Confirmed active value',
    reviewStatus: KnowledgeFactReviewStatus.Confirmed,
    updatedAt: NOW_7,
    reviewedAt: NOW_7,
  });
  insertFact(fixture.db, {
    id: 'fact-confirmed-stale',
    value: 'Confirmed stale value',
    reviewStatus: KnowledgeFactReviewStatus.Confirmed,
    updatedAt: NOW_6,
    reviewedAt: NOW_6,
  });
  insertFact(fixture.db, {
    id: 'fact-confirmed-zero',
    value: 'Confirmed zero evidence',
    reviewStatus: KnowledgeFactReviewStatus.Confirmed,
    sourceKind: KnowledgeFactSourceKind.Imported,
    updatedAt: NOW_5,
    reviewedAt: NOW_5,
  });
  insertFact(fixture.db, {
    id: 'fact-pending-stale',
    value: 'Pending stale value',
    reviewStatus: KnowledgeFactReviewStatus.Pending,
    updatedAt: NOW_4,
  });
  insertFact(fixture.db, {
    id: 'fact-rejected',
    value: 'Rejected value',
    reviewStatus: KnowledgeFactReviewStatus.Rejected,
    updatedAt: NOW_3,
    reviewedAt: NOW_3,
  });
  insertFact(fixture.db, {
    id: 'fact-archived',
    value: 'Archived value',
    reviewStatus: KnowledgeFactReviewStatus.Confirmed,
    updatedAt: NOW_2,
    reviewedAt: NOW_2,
    tombstonedAt: NOW_2,
  });

  for (const factId of [
    'fact-pending-active',
    'fact-confirmed-active',
    'fact-confirmed-stale',
    'fact-pending-stale',
  ]) {
    linkRequestFact(fixture.db, 'request-a', factId);
  }

  insertEvidence(fixture.db, document, {
    idDigit: '1',
    factId: 'fact-pending-active',
    quote: 'pending active evidence',
    confidence: 0.7,
    createdAt: NOW_1,
  });
  insertEvidence(fixture.db, document, {
    idDigit: '2',
    factId: 'fact-confirmed-active',
    quote: 'x'.repeat(241),
    confidence: 0.5,
    createdAt: NOW_2,
  });
  insertEvidence(fixture.db, document, {
    idDigit: '3',
    factId: 'fact-confirmed-active',
    quote: 'stale but more confident',
    confidence: 0.99,
    createdAt: NOW_1,
    stale: true,
  });
  insertEvidence(fixture.db, document, {
    idDigit: '4',
    factId: 'fact-confirmed-stale',
    quote: 'confirmed stale evidence',
    confidence: 0.8,
    createdAt: NOW_1,
    stale: true,
  });
  insertEvidence(fixture.db, document, {
    idDigit: '5',
    factId: 'fact-pending-stale',
    quote: 'pending stale evidence',
    confidence: 0.8,
    createdAt: NOW_1,
    stale: true,
  });
  return { ...fixture, document };
};

const expectInvalidRequest = (operation: () => unknown): void => {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(KnowledgeFactStateError);
  expect(thrown).toMatchObject({
    code: KnowledgeBaseErrorCode.InvalidRequest,
    message: 'Knowledge fact request is invalid',
  });
  expect(thrown).not.toHaveProperty('stack');
  expect(thrown).not.toHaveProperty('cause');
};

const expectInvalidState = (operation: () => unknown): KnowledgeFactStateError => {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(KnowledgeFactStateError);
  expect(thrown).toMatchObject({
    code: KnowledgeBaseErrorCode.JobStateConflict,
    message: 'Knowledge fact state is invalid',
  });
  expect(thrown).not.toHaveProperty('stack');
  expect(thrown).not.toHaveProperty('cause');
  return thrown as KnowledgeFactStateError;
};

describe('KnowledgeFactQueryService filters, ordering, and cursor', () => {
  test('rejects proxy and accessor list inputs without invoking caller code', () => {
    const { db, service } = seedQueryMatrix();
    let trapCount = 0;
    const proxy = new Proxy({ workspaceId: 'workspace-a' }, {
      get() {
        trapCount += 1;
        throw new Error('raw-query-proxy-secret');
      },
    });
    const accessor = Object.defineProperty({}, 'workspaceId', {
      enumerable: true,
      get() {
        trapCount += 1;
        throw new Error('raw-query-accessor-secret');
      },
    });
    const proxiedStatuses = new Proxy([KnowledgeFactReviewStatus.Pending], {
      get() {
        trapCount += 1;
        throw new Error('raw-query-array-secret');
      },
    });

    expectInvalidRequest(() => service.listFacts(proxy));
    expectInvalidRequest(() => service.listFacts(
      accessor as { workspaceId: string },
    ));
    expectInvalidRequest(() => service.listFacts({
      workspaceId: 'workspace-a',
      reviewStatuses: proxiedStatuses,
    }));
    expect(trapCount).toBe(0);
    db.close();
  });

  test('implements active/history complements and intersecting status/evidence filters', () => {
    const { db, service } = seedQueryMatrix();
    expect(service.listFacts({ workspaceId: 'workspace-a' }).items.map(item => item.id)).toEqual([
      'fact-pending-active',
      'fact-confirmed-active',
      'fact-confirmed-stale',
      'fact-confirmed-zero',
    ]);
    expect(service.listFacts({
      workspaceId: 'workspace-a',
      view: KnowledgeFactListView.History,
    }).items.map(item => item.id)).toEqual([
      'fact-pending-stale',
      'fact-rejected',
      'fact-archived',
    ]);
    expect(service.listFacts({
      workspaceId: 'workspace-a',
      evidenceState: KnowledgeFactEvidenceState.Active,
    }).items.map(item => item.id)).toEqual([
      'fact-pending-active',
      'fact-confirmed-active',
    ]);
    expect(service.listFacts({
      workspaceId: 'workspace-a',
      evidenceState: KnowledgeFactEvidenceState.Stale,
      reviewStatuses: [KnowledgeFactReviewStatus.Confirmed],
    }).items.map(item => item.id)).toEqual([
      'fact-confirmed-active',
      'fact-confirmed-stale',
    ]);
    expect(service.listFacts({
      workspaceId: 'workspace-a',
      view: KnowledgeFactListView.History,
      evidenceState: KnowledgeFactEvidenceState.Stale,
      reviewStatuses: [KnowledgeFactReviewStatus.Pending],
    }).items.map(item => item.id)).toEqual(['fact-pending-stale']);
    db.close();
  });

  test('uses strict stable cursor pagination and rejects permissive SQLite limits', () => {
    const { db, service } = seedQueryMatrix();
    const first = service.listFacts({ workspaceId: 'workspace-a', limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = service.listFacts({
      workspaceId: 'workspace-a',
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(4);

    const invalidCursors = [
      '',
      'not+base64url',
      Buffer.from(JSON.stringify({ v: 1, updatedAt: NOW_1, id: 'fact-aa' })).toString('base64'),
      Buffer.from(JSON.stringify({ v: 1, updatedAt: NOW_1 })).toString('base64url'),
      Buffer.from(JSON.stringify({ v: 1, updatedAt: NOW_1, id: '' })).toString('base64url'),
      Buffer.from(JSON.stringify({
        v: 1,
        updatedAt: '2026-07-12T01:00:00Z',
        id: 'fact-a',
      })).toString('base64url'),
      Buffer.from(JSON.stringify({
        v: 1,
        updatedAt: NOW_1,
        id: 'fact-a',
        extra: true,
      })).toString('base64url'),
      'eyJ2IjoxLCJ1cGRhdGVkQXQiOiIyMDI2LTA3LTEyVDAxOjAwOjAwLjAwMFoiLCJpZCI6Iv8ifQ',
      'a'.repeat(2_049),
    ];
    for (const cursor of invalidCursors) {
      expectInvalidRequest(() => service.listFacts({ workspaceId: 'workspace-a', cursor }));
    }
    for (const limit of [-5, -1, 0, 1.5, 101, Number.NaN]) {
      expectInvalidRequest(() => service.listFacts({ workspaceId: 'workspace-a', limit }));
    }
    db.close();
  });

  test('selects one active-first preview and pages evidence in deterministic keyset order', () => {
    const { db, document, service } = seedQueryMatrix();
    for (const evidence of [
      { idDigit: '6', confidence: 0.9, createdAt: NOW_1 },
      { idDigit: '7', confidence: 0.9, createdAt: NOW_1 },
      { idDigit: '8', confidence: 0.9, createdAt: NOW_3 },
      { idDigit: '9', confidence: 1, createdAt: NOW_2, stale: true },
    ]) {
      insertEvidence(db, document, {
        ...evidence,
        factId: 'fact-confirmed-active',
        quote: `evidence-${evidence.idDigit}`,
      });
    }
    const active = service.listFacts({ workspaceId: 'workspace-a' });
    const fact = active.items.find(item => item.id === 'fact-confirmed-active')!;
    expect(fact).toMatchObject({
      activeEvidenceCount: 4,
      staleEvidenceCount: 2,
      archivedAt: null,
      evidencePreview: {
        stale: false,
        quote: 'evidence-6',
        documentDisplayName: 'evidence-source.txt',
      },
    });
    const pages: KnowledgeFactEvidencePageResult[] = [];
    let cursor: string | undefined;
    do {
      const page = getFactEvidencePage(service, {
        factId: 'fact-confirmed-active',
        expectedRevision: 1,
        cursor,
        limit: 2,
      });
      expect(page.factId).toBe('fact-confirmed-active');
      expect(page.factRevision).toBe(1);
      expect(page.items.length).toBeLessThanOrEqual(2);
      pages.push(page);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    expect(pages).toHaveLength(3);
    const evidence = pages.flatMap(page => page.items);
    expect(evidence.map(item => item.id)).toEqual([
      '6'.repeat(64),
      '7'.repeat(64),
      '8'.repeat(64),
      '2'.repeat(64),
      '9'.repeat(64),
      '3'.repeat(64),
    ]);
    expect(evidence.map(item => item.stale)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(evidence[3].quote).toBe('x'.repeat(241));
    expect(new Set(evidence.map(item => item.id)).size).toBe(evidence.length);

    const emptyPage = getFactEvidencePage(service, {
      factId: 'fact-confirmed-zero',
      expectedRevision: 1,
    });
    expect(emptyPage).toEqual({
      factId: 'fact-confirmed-zero',
      factRevision: 1,
      items: [],
      nextCursor: null,
    });
    expectInvalidState(() => getFactEvidencePage(service, {
      factId: 'legacy-profile:productList:fake',
      expectedRevision: 1,
    }));
    expectInvalidState(() => getFactEvidencePage(service, {
      factId: 'missing-fact',
      expectedRevision: 1,
    }));
    db.close();
  });

  test('validates evidence page requests and enforces the exact expected revision', () => {
    const { db, service } = seedQueryMatrix();
    const validRequest: KnowledgeFactEvidencePageRequest = {
      factId: 'fact-confirmed-active',
      expectedRevision: 1,
    };
    const firstPage = getFactEvidencePage(service, { ...validRequest, limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();

    const invalidRequests: unknown[] = [
      null,
      'fact-confirmed-active',
      [],
      {},
      { ...validRequest, factId: '' },
      { ...validRequest, factId: '   ' },
      { ...validRequest, expectedRevision: 0 },
      { ...validRequest, expectedRevision: -1 },
      { ...validRequest, expectedRevision: 1.5 },
      { ...validRequest, expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
      { ...validRequest, cursor: null },
      { ...validRequest, cursor: 42 },
      { ...validRequest, limit: -5 },
      { ...validRequest, limit: -1 },
      { ...validRequest, limit: -0 },
      { ...validRequest, limit: 0 },
      { ...validRequest, limit: 1.5 },
      { ...validRequest, limit: KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT + 1 },
      { ...validRequest, limit: Number.NaN },
      { ...validRequest, limit: Number.POSITIVE_INFINITY },
      { ...validRequest, unexpected: true },
    ];
    for (const input of invalidRequests) {
      expectInvalidRequest(() => getFactEvidencePage(
        service,
        input as KnowledgeFactEvidencePageRequest,
      ));
    }

    let trapCount = 0;
    const proxy = new Proxy(validRequest, {
      get() {
        trapCount += 1;
        throw new Error('raw-evidence-page-proxy-secret');
      },
    });
    const accessor = Object.defineProperty({}, 'factId', {
      enumerable: true,
      get() {
        trapCount += 1;
        throw new Error('raw-evidence-page-accessor-secret');
      },
    });
    expectInvalidRequest(() => getFactEvidencePage(service, proxy));
    expectInvalidRequest(() => getFactEvidencePage(
      service,
      accessor as KnowledgeFactEvidencePageRequest,
    ));
    expect(trapCount).toBe(0);

    expectInvalidState(() => getFactEvidencePage(service, {
      ...validRequest,
      expectedRevision: 2,
    }));
    db.prepare(`
      UPDATE knowledge_facts
      SET revision = revision + 1
      WHERE id = 'fact-confirmed-active'
    `).run();
    expectInvalidState(() => getFactEvidencePage(service, {
      ...validRequest,
      cursor: firstPage.nextCursor!,
    }));
    expectInvalidRequest(() => getFactEvidencePage(service, {
      ...validRequest,
      expectedRevision: 2,
      cursor: firstPage.nextCursor!,
    }));
    expect(getFactEvidencePage(service, {
      ...validRequest,
      expectedRevision: 2,
    })).toMatchObject({
      factId: 'fact-confirmed-active',
      factRevision: 2,
    });
    db.close();
  });

  test('uses the evidence page limit constants for default and maximum bounds', () => {
    const { db, document, service } = seedQueryMatrix();
    for (let index = 0; index < KNOWLEDGE_FACT_EVIDENCE_PAGE_DEFAULT_LIMIT; index += 1) {
      insertEvidence(db, document, {
        id: (index + 16).toString(16).padStart(64, '0'),
        factId: 'fact-confirmed-active',
        quote: `default-page-${index}`,
        confidence: 0.4,
        createdAt: NOW_3,
      });
    }
    const defaultPage = getFactEvidencePage(service, {
      factId: 'fact-confirmed-active',
      expectedRevision: 1,
    });
    expect(defaultPage.items).toHaveLength(KNOWLEDGE_FACT_EVIDENCE_PAGE_DEFAULT_LIMIT);
    expect(defaultPage.nextCursor).not.toBeNull();

    const maximumPage = getFactEvidencePage(service, {
      factId: 'fact-confirmed-active',
      expectedRevision: 1,
      limit: KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT,
    });
    expect(maximumPage.items).toHaveLength(
      KNOWLEDGE_FACT_EVIDENCE_PAGE_DEFAULT_LIMIT + 2,
    );
    expect(maximumPage.nextCursor).toBeNull();
    db.close();
  });

  test('emits the exact canonical evidence cursor and echoes an empty continuation page', () => {
    const { db, service } = seedQueryMatrix();
    const first = getFactEvidencePage(service, {
      factId: 'fact-confirmed-active',
      expectedRevision: 1,
      limit: 1,
    });
    expect(first.nextCursor).not.toBeNull();
    expect(Buffer.from(first.nextCursor!, 'base64url').toString('utf8')).toBe(
      evidenceCursorJson(),
    );

    const final = getFactEvidencePage(service, {
      factId: 'fact-confirmed-active',
      expectedRevision: 1,
      cursor: encodeRawCursorJson(evidenceCursorJson({
        stale: true,
        confidence: 0.99,
        createdAt: NOW_1,
        id: '3'.repeat(64),
      })),
      limit: 1,
    });
    expect(final).toEqual({
      factId: 'fact-confirmed-active',
      factRevision: 1,
      items: [],
      nextCursor: null,
    });
    db.close();
  });

  test('uses zero statements for invalid input and one for every evidence page outcome', () => {
    const { db, service } = seedQueryMatrix();
    const originalPrepare = db.prepare.bind(db);
    let prepareCount = 0;
    Object.defineProperty(db, 'prepare', {
      configurable: true,
      value: (source: string) => {
        prepareCount += 1;
        return originalPrepare(source);
      },
    });
    try {
      expectInvalidRequest(() => getFactEvidencePage(service, {
        factId: 'fact-confirmed-active',
        expectedRevision: 1,
        limit: 0,
      }));
      expect(prepareCount).toBe(0);

      expect(getFactEvidencePage(service, {
        factId: 'fact-confirmed-zero',
        expectedRevision: 1,
      }).items).toEqual([]);
      expect(prepareCount).toBe(1);

      prepareCount = 0;
      expect(getFactEvidencePage(service, {
        factId: 'fact-confirmed-active',
        expectedRevision: 1,
        cursor: encodeRawCursorJson(evidenceCursorJson({
          stale: true,
          confidence: 0.99,
          createdAt: NOW_1,
          id: '3'.repeat(64),
        })),
      }).items).toEqual([]);
      expect(prepareCount).toBe(1);

      prepareCount = 0;
      expectInvalidState(() => getFactEvidencePage(service, {
        factId: 'missing-fact',
        expectedRevision: 1,
      }));
      expect(prepareCount).toBe(1);

      prepareCount = 0;
      expectInvalidState(() => getFactEvidencePage(service, {
        factId: 'fact-confirmed-active',
        expectedRevision: 2,
      }));
      expect(prepareCount).toBe(1);
    } finally {
      Object.defineProperty(db, 'prepare', {
        configurable: true,
        value: originalPrepare,
      });
    }
    db.close();
  });

  test('emits exponent-free canonical confidence and never returns an oversized cursor', () => {
    const { db, document, service } = seedQueryMatrix();
    insertEvidence(db, document, {
      idDigit: '6',
      factId: 'fact-confirmed-active',
      quote: 'tiny confidence',
      confidence: 1e-7,
      createdAt: NOW_3,
    });
    const tinyConfidencePage = getFactEvidencePage(service, {
      factId: 'fact-confirmed-active',
      expectedRevision: 1,
      limit: 2,
    });
    expect(Buffer.from(tinyConfidencePage.nextCursor!, 'base64url').toString('utf8'))
      .toContain('"confidence":0.0000001');
    expect(getFactEvidencePage(service, {
      factId: 'fact-confirmed-active',
      expectedRevision: 1,
      cursor: tinyConfidencePage.nextCursor!,
      limit: 1,
    }).items.map(item => item.id)).toEqual(['3'.repeat(64)]);

    const oversizedFactId = `fact-${'x'.repeat(1_600)}`;
    insertFact(db, {
      id: oversizedFactId,
      value: 'Oversized cursor fact',
      reviewStatus: KnowledgeFactReviewStatus.Pending,
      updatedAt: NOW_8,
    });
    linkRequestFact(db, 'request-a', oversizedFactId);
    insertEvidence(db, document, {
      idDigit: '7',
      factId: oversizedFactId,
      quote: 'oversized cursor first evidence',
      confidence: 0.8,
      createdAt: NOW_1,
    });
    insertEvidence(db, document, {
      idDigit: '8',
      factId: oversizedFactId,
      quote: 'oversized cursor second evidence',
      confidence: 0.7,
      createdAt: NOW_2,
    });
    expectInvalidState(() => getFactEvidencePage(service, {
      factId: oversizedFactId,
      expectedRevision: 1,
      limit: 1,
    }));
    db.close();
  });

  test('preserves the exact nonempty fact id in SQL, results, and cursors', () => {
    const { db, document, service } = seedQueryMatrix();
    const factId = ' fact-with-significant-spaces ';
    insertFact(db, {
      id: factId,
      value: 'Exact fact ID value',
      reviewStatus: KnowledgeFactReviewStatus.Pending,
      updatedAt: NOW_8,
    });
    linkRequestFact(db, 'request-a', factId);
    insertEvidence(db, document, {
      idDigit: '6',
      factId,
      quote: 'exact id first evidence',
      confidence: 0.8,
      createdAt: NOW_1,
    });
    insertEvidence(db, document, {
      idDigit: '7',
      factId,
      quote: 'exact id second evidence',
      confidence: 0.7,
      createdAt: NOW_2,
    });

    const first = getFactEvidencePage(service, {
      factId,
      expectedRevision: 1,
      limit: 1,
    });
    expect(first.factId).toBe(factId);
    expect(Buffer.from(first.nextCursor!, 'base64url').toString('utf8'))
      .toContain(`"factId":${JSON.stringify(factId)}`);
    expect(getFactEvidencePage(service, {
      factId,
      expectedRevision: 1,
      cursor: first.nextCursor!,
      limit: 1,
    }).items.map(item => item.id)).toEqual(['7'.repeat(64)]);
    expectInvalidState(() => getFactEvidencePage(service, {
      factId: factId.trim(),
      expectedRevision: 1,
    }));
    db.close();
  });

  test.each([
    ['empty token', ''],
    ['invalid base64url alphabet', 'not+base64url'],
    ['base64url padding', `${encodeRawCursorJson(evidenceCursorJson())}=`],
    ['noncanonical base64url trailing bits', makeNonCanonicalBase64urlAlias(
      encodeRawCursorJson(evidenceCursorJson()),
    )],
    ['invalid UTF-8', Buffer.from([0xc0, 0xaf]).toString('base64url')],
    ['invalid JSON', encodeRawCursorJson('{')],
    ['non-object JSON', encodeRawCursorJson('[]')],
    ['missing key', encodeRawCursorJson(JSON.stringify({
      v: 1,
      factId: 'fact-confirmed-active',
      factRevision: 1,
      stale: false,
      confidence: 0.5,
      createdAt: NOW_2,
    }))],
    ['extra key', encodeRawCursorJson(evidenceCursorJson().replace(/}$/, ',"extra":true}'))],
    ['key-order variant', encodeRawCursorJson(
      `{"factId":"fact-confirmed-active","v":1,"factRevision":1,` +
      `"stale":false,"confidence":0.5,"createdAt":"${NOW_2}",` +
      `"id":"${'2'.repeat(64)}"}`,
    )],
    ['whitespace variant', encodeRawCursorJson(` ${evidenceCursorJson()}`)],
    ['duplicate key', encodeRawCursorJson(
      evidenceCursorJson().replace('"v":1', '"v":1,"v":1'),
    )],
    ['equivalent escaped key', encodeRawCursorJson(
      evidenceCursorJson().replace('"factId"', '"fact\\u0049d"'),
    )],
    ['equivalent escaped value', encodeRawCursorJson(
      evidenceCursorJson().replace('fact-confirmed-active', 'fact-confirmed-\\u0061ctive'),
    )],
    ['decimal cursor version', encodeRawCursorJson(
      evidenceCursorJson().replace('"v":1', '"v":1.0'),
    )],
    ['exponent cursor version', encodeRawCursorJson(
      evidenceCursorJson().replace('"v":1', '"v":1e0'),
    )],
    ['wrong cursor version', encodeRawCursorJson(evidenceCursorJson({ v: 2 }))],
    ['whitespace-only fact id', encodeRawCursorJson(evidenceCursorJson({ factId: '   ' }))],
    ['zero fact revision', encodeRawCursorJson(evidenceCursorJson({ factRevision: 0 }))],
    ['fractional fact revision', encodeRawCursorJson(evidenceCursorJson({ factRevision: 1.5 }))],
    ['unsafe fact revision', encodeRawCursorJson(
      evidenceCursorJson().replace('"factRevision":1', '"factRevision":9007199254740992'),
    )],
    ['non-boolean stale flag', encodeRawCursorJson(
      evidenceCursorJson().replace('"stale":false', '"stale":0'),
    )],
    ['negative zero confidence', encodeRawCursorJson(
      evidenceCursorJson().replace('"confidence":0.5', '"confidence":-0'),
    )],
    ['negative confidence', encodeRawCursorJson(evidenceCursorJson({ confidence: -0.1 }))],
    ['over-one confidence', encodeRawCursorJson(evidenceCursorJson({ confidence: 1.1 }))],
    ['string confidence', encodeRawCursorJson(
      evidenceCursorJson().replace('"confidence":0.5', '"confidence":"0.5"'),
    )],
    ['exponent confidence', encodeRawCursorJson(
      evidenceCursorJson().replace('"confidence":0.5', '"confidence":5e-1'),
    )],
    ['redundant decimal confidence', encodeRawCursorJson(
      evidenceCursorJson().replace('"confidence":0.5', '"confidence":0.50'),
    )],
    ['exponent fact revision', encodeRawCursorJson(
      evidenceCursorJson().replace('"factRevision":1', '"factRevision":1e0'),
    )],
    ['noncanonical timestamp', encodeRawCursorJson(evidenceCursorJson({
      createdAt: '2026-07-12T02:00:00Z',
    }))],
    ['offset timestamp', encodeRawCursorJson(evidenceCursorJson({
      createdAt: '2026-07-12T10:00:00.000+08:00',
    }))],
    ['uppercase evidence id', encodeRawCursorJson(evidenceCursorJson({
      id: 'A'.repeat(64),
    }))],
    ['short evidence id', encodeRawCursorJson(evidenceCursorJson({ id: '2' }))],
    ['nonhex evidence id', encodeRawCursorJson(evidenceCursorJson({ id: 'g'.repeat(64) }))],
    ['cross-fact cursor', encodeRawCursorJson(evidenceCursorJson({ factId: 'fact-other' }))],
    ['stale-revision cursor', encodeRawCursorJson(evidenceCursorJson({ factRevision: 2 }))],
    ['oversized token', 'a'.repeat(2_049)],
  ])('rejects noncanonical evidence cursor: %s', (_label, cursor) => {
    const { db, service } = seedQueryMatrix();
    expectInvalidRequest(() => getFactEvidencePage(service, {
      factId: 'fact-confirmed-active',
      expectedRevision: 1,
      cursor,
      limit: 1,
    }));
    db.close();
  });

  test('fails a corrupt evidence hash closed in list projections', () => {
    const { db, service } = seedQueryMatrix();
    db.pragma('ignore_check_constraints = ON');
    db.prepare(`
      UPDATE knowledge_fact_evidence
      SET id = 'corrupt-evidence-id'
      WHERE id = ?
    `).run('2'.repeat(64));
    expectInvalidState(() => service.listFacts({ workspaceId: 'workspace-a' }));
    db.close();
  });

  test('fails a real NULL evidence id closed instead of treating it as an empty-page sentinel', () => {
    const { db, document, service } = seedQueryMatrix();
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('ignore_check_constraints', { simple: true })).toBe(0);
    insertFact(db, {
      id: 'fact-null-id',
      value: 'NULL id evidence owner',
      reviewStatus: KnowledgeFactReviewStatus.Pending,
      updatedAt: NOW_8,
    });
    linkRequestFact(db, 'request-a', 'fact-null-id');
    db.prepare(`
      UPDATE knowledge_documents
      SET display_name = 'private-null-id-path.txt'
      WHERE id = ?
    `).run(document.document.id);
    expect(db.prepare(`
      INSERT INTO knowledge_fact_evidence (
        id, workspace_id, fact_id, request_id, document_id, document_version_id,
        chunk_id, quote, confidence, extractor_provider_id, extractor_model_id,
        created_at, stale_at
      ) VALUES (
        NULL, 'workspace-a', 'fact-null-id', 'request-a', ?, ?,
        'chunk-null-id', 'private-null-id-quote', 1, 'provider-a', 'model-a', ?, NULL
      )
    `).run(document.document.id, document.version.id, NOW_1).changes).toBe(1);

    const error = expectInvalidState(() => getFactEvidencePage(service, {
      factId: 'fact-null-id',
      expectedRevision: 1,
      limit: 1,
    }));
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain('private-null-id-quote');
    expect(serialized).not.toContain('private-null-id-path.txt');
    db.close();
  });

  test('keeps archived facts evidence-readable for audit history', () => {
    const { db, document, service } = seedQueryMatrix();
    linkRequestFact(db, 'request-a', 'fact-archived');
    insertEvidence(db, document, {
      idDigit: '6',
      factId: 'fact-archived',
      quote: 'archived audit evidence',
      confidence: 0.8,
      createdAt: NOW_1,
      stale: true,
    });

    expect(getFactEvidencePage(service, {
      factId: 'fact-archived',
      expectedRevision: 1,
    })).toMatchObject({
      factId: 'fact-archived',
      factRevision: 1,
      items: [{
        id: '6'.repeat(64),
        quote: 'archived audit evidence',
        stale: true,
      }],
      nextCursor: null,
    });
    db.close();
  });

  test('fails a corrupt stale timestamp closed in full evidence projections', () => {
    const { db, service } = seedQueryMatrix();
    db.pragma('ignore_check_constraints = ON');
    db.prepare(`
      UPDATE knowledge_fact_evidence
      SET stale_at = 'not-a-canonical-time'
      WHERE id = ?
    `).run('3'.repeat(64));
    expectInvalidState(() => getFactEvidencePage(service, {
      factId: 'fact-confirmed-active',
      expectedRevision: 1,
    }));
    db.close();
  });

  test('fails fully FK-valid cross-workspace evidence closed without exposing foreign text', () => {
    const { db, documentStore, service } = seedQueryMatrix();
    const foreignDocument = createDocument(
      documentStore,
      'workspace-b',
      'workspace-b-private-source.txt',
    );
    insertRequest(db, foreignDocument, {
      id: 'request-b',
      workspaceId: 'workspace-b',
    });
    linkRequestFact(db, 'request-b', 'fact-confirmed-active');
    insertEvidence(db, foreignDocument, {
      idDigit: '6',
      factId: 'fact-confirmed-active',
      requestId: 'request-b',
      workspaceId: 'workspace-a',
      quote: 'workspace-b-private-quote',
      confidence: 1,
      createdAt: NOW_1,
    });

    for (const operation of [
      () => service.listFacts({ workspaceId: 'workspace-a' }),
      () => getFactEvidencePage(service, {
        factId: 'fact-confirmed-active',
        expectedRevision: 1,
      }),
    ]) {
      const error = expectInvalidState(operation);
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain('workspace-b-private-quote');
      expect(serialized).not.toContain('workspace-b-private-source.txt');
    }
    db.close();
  });

  test('fails dangling evidence document and version ownership closed', () => {
    for (const danglingReference of ['document', 'version'] as const) {
      const { db, document, service } = seedQueryMatrix();
      db.pragma('foreign_keys = OFF');
      if (danglingReference === 'document') {
        db.prepare('DELETE FROM knowledge_documents WHERE id = ?').run(document.document.id);
      } else {
        db.prepare('DELETE FROM knowledge_document_versions WHERE id = ?').run(document.version.id);
      }
      db.pragma('foreign_keys = ON');

      expectInvalidState(() => service.listFacts({ workspaceId: 'workspace-a' }));
      expectInvalidState(() => getFactEvidencePage(service, {
        factId: 'fact-confirmed-active',
        expectedRevision: 1,
      }));
      db.close();
    }
  });

  test('fails fully FK-valid evidence without request-fact membership closed', () => {
    const { db, service } = seedQueryMatrix();
    db.prepare(`
      DELETE FROM knowledge_enrichment_request_facts
      WHERE request_id = 'request-a' AND fact_id = 'fact-confirmed-active'
    `).run();

    for (const operation of [
      () => service.listFacts({ workspaceId: 'workspace-a' }),
      () => getFactEvidencePage(service, {
        factId: 'fact-confirmed-active',
        expectedRevision: 1,
      }),
    ]) {
      const error = expectInvalidState(operation);
      expect(JSON.stringify(error)).not.toContain('Confirmed active value');
      expect(JSON.stringify(error)).not.toContain('evidence-source.txt');
    }
    db.close();
  });
});

describe('KnowledgeFactQueryService metrics, legacy isolation, and query bounds', () => {
  test('delegates every SQL query primitive to KnowledgeFactStore', () => {
    const queryServiceSource = readFileSync(
      new URL('./knowledgeFactQueryService.ts', import.meta.url),
      'utf8',
    );
    const factStoreSource = readFileSync(
      new URL('./knowledgeFactStore.ts', import.meta.url),
      'utf8',
    );
    expect(queryServiceSource).not.toContain('.prepare(');
    expect(queryServiceSource).not.toContain('getDatabaseForInternalUse');
    for (const primitiveName of [
      'listFactPageForQuery',
      'listFactEvidencePreviewsForQuery',
      'getFactMetricsForQuery',
      'getWorkspaceProfileForQuery',
      'listFactEvidenceForQuery',
    ]) {
      expect(queryServiceSource).toContain(`this.factStore.${primitiveName}`);
      expect(factStoreSource).toContain(primitiveName);
    }
  });

  test('computes full-workspace normalized and self-deduplicated legacy metrics', () => {
    const { db, service } = seedQueryMatrix();
    const profile: EnterpriseLeadWorkspaceProfile = {
      ...emptyProfile(),
      companySummary: 'Legacy Company',
      productList: [
        'Confirmed active value',
        'Confirmed stale value',
        'Confirmed zero evidence',
        'Legacy only',
        ' legacy   only ',
        'Pending value',
        'Rejected value',
        'Archived value',
      ],
    };
    db.prepare(`
      UPDATE enterprise_lead_workspaces
      SET profile = ?
      WHERE id = 'workspace-a'
    `).run(JSON.stringify(profile));

    const result = service.listFacts({
      workspaceId: 'workspace-a',
      limit: 1,
      reviewStatuses: [KnowledgeFactReviewStatus.Pending],
    });
    expect(result.items).toHaveLength(1);
    expect(result.metrics).toEqual({
      activePendingCount: 1,
      activeConfirmedCount: 2,
      staleConfirmedCount: 1,
      rejectedHistoryCount: 1,
      archivedHistoryCount: 1,
      unduplicatedLegacyConfirmedCount: 5,
      totalAiKnowledgeCount: 9,
    });
    expect(result.items.every(item => !item.id.startsWith('legacy'))).toBe(true);

    db.prepare(`
      UPDATE enterprise_lead_workspaces
      SET profile = '{"companySummary":42}'
      WHERE id = 'workspace-a'
    `).run();
    const corruptedProfileResult = service.listFacts({ workspaceId: 'workspace-a' });
    expect(corruptedProfileResult.items).toHaveLength(4);
    expect(corruptedProfileResult.metrics.unduplicatedLegacyConfirmedCount).toBe(0);
    expect(corruptedProfileResult.metrics.totalAiKnowledgeCount).toBe(4);
    db.close();
  });

  test('fails every malformed Profile knowledge field closed', () => {
    const { db, service } = seedQueryMatrix();
    const arrayDomains = [
      KnowledgeFactDomain.ProductList,
      KnowledgeFactDomain.ProductCapabilities,
      KnowledgeFactDomain.TargetCustomers,
      KnowledgeFactDomain.ApplicationScenarios,
      KnowledgeFactDomain.SellingPoints,
      KnowledgeFactDomain.ChannelPreferences,
      KnowledgeFactDomain.ProhibitedClaims,
      KnowledgeFactDomain.ContactRules,
      KnowledgeFactDomain.MissingInfo,
    ] as const;
    for (const domain of arrayDomains) {
      const profile = { ...emptyProfile(), companySummary: 'Legacy company' } as Record<
        string,
        unknown
      >;
      profile[domain] = ['valid', 42];
      db.prepare(`
        UPDATE enterprise_lead_workspaces SET profile = ? WHERE id = 'workspace-a'
      `).run(JSON.stringify(profile));
      expect(service.listFacts({ workspaceId: 'workspace-a' }).metrics)
        .toMatchObject({ unduplicatedLegacyConfirmedCount: 0 });
    }
    const missingField = emptyProfile() as Record<string, unknown>;
    delete missingField[KnowledgeFactDomain.ContactRules];
    db.prepare(`
      UPDATE enterprise_lead_workspaces SET profile = ? WHERE id = 'workspace-a'
    `).run(JSON.stringify(missingField));
    expect(service.listFacts({ workspaceId: 'workspace-a' }).metrics)
      .toMatchObject({ unduplicatedLegacyConfirmedCount: 0 });
    db.close();
  });

  test('counts more than ten Profile identities exactly without retaining a JS identity set', () => {
    const { db, service } = seedQueryMatrix();
    const profile: EnterpriseLeadWorkspaceProfile = {
      ...emptyProfile(),
      productList: Array.from({ length: 100 }, (_, index) => `Legacy identity ${index}`),
    };
    db.prepare(`
      UPDATE enterprise_lead_workspaces
      SET profile = ?
      WHERE id = 'workspace-a'
    `).run(JSON.stringify(profile));

    expect(service.listFacts({ workspaceId: 'workspace-a', limit: 1 }).metrics).toEqual({
      activePendingCount: 1,
      activeConfirmedCount: 2,
      staleConfirmedCount: 1,
      rejectedHistoryCount: 1,
      archivedHistoryCount: 1,
      unduplicatedLegacyConfirmedCount: 100,
      totalAiKnowledgeCount: 104,
    });
    db.close();
  });

  test('canonicalizes duplicate Profile keys to the validated JSON.parse result', () => {
    const { db, service } = seedQueryMatrix();
    const remainingFields = [
      '"productCapabilities":[]',
      '"targetCustomers":[]',
      '"applicationScenarios":[]',
      '"sellingPoints":[]',
      '"channelPreferences":[]',
      '"prohibitedClaims":[]',
      '"contactRules":[]',
      '"missingInfo":[]',
    ].join(',');
    const updateProfile = (profile: string): void => {
      db.prepare(`
        UPDATE enterprise_lead_workspaces
        SET profile = ?
        WHERE id = 'workspace-a'
      `).run(profile);
    };

    updateProfile(
      `{"companySummary":"","productList":42,` +
      `"productList":["Canonical duplicate legacy"],${remainingFields}}`,
    );
    expect(service.listFacts({ workspaceId: 'workspace-a' }).metrics)
      .toMatchObject({ unduplicatedLegacyConfirmedCount: 1 });

    updateProfile(
      `{"companySummary":"","productList":["Ignored duplicate legacy"],` +
      `"productList":42,${remainingFields}}`,
    );
    expect(service.listFacts({ workspaceId: 'workspace-a' }).metrics)
      .toMatchObject({ unduplicatedLegacyConfirmedCount: 0 });
    db.close();
  });

  test('keeps full-workspace metrics invariant across pagination, views, and filters', () => {
    const { db, service } = seedQueryMatrix();
    const first = service.listFacts({ workspaceId: 'workspace-a', limit: 1 });
    const variants = [
      service.listFacts({
        workspaceId: 'workspace-a',
        view: KnowledgeFactListView.History,
        limit: 100,
      }),
      service.listFacts({
        workspaceId: 'workspace-a',
        evidenceState: KnowledgeFactEvidenceState.Stale,
        reviewStatuses: [KnowledgeFactReviewStatus.Confirmed],
        limit: 2,
      }),
      service.listFacts({
        workspaceId: 'workspace-a',
        cursor: first.nextCursor!,
        limit: 1,
      }),
    ];
    for (const result of variants) {
      expect(result.metrics).toEqual(first.metrics);
    }
    db.close();
  });

  test('fails a corrupt displayed fact closed in list and full evidence projections', () => {
    const { db, service } = seedQueryMatrix();
    db.prepare(`
      UPDATE knowledge_facts
      SET normalized_value = 'corrupt-normalization'
      WHERE id = 'fact-confirmed-active'
    `).run();
    const listError = expectInvalidState(() => service.listFacts({
      workspaceId: 'workspace-a',
      reviewStatuses: [KnowledgeFactReviewStatus.Confirmed],
      limit: 1,
    }));
    const detailError = expectInvalidState(() => getFactEvidencePage(service, {
      factId: 'fact-confirmed-active',
      expectedRevision: 1,
    }));
    expect(JSON.stringify(listError)).not.toContain('Confirmed active value');
    expect(JSON.stringify(detailError)).not.toContain('Confirmed active value');
    db.close();
  });

  test('does not globally materialize an off-page fact value but detail maps its fact sentinel', () => {
    const { db, service } = seedQueryMatrix();
    db.prepare(`
      UPDATE knowledge_facts
      SET normalized_value = 'off-page-corrupt-normalization'
      WHERE id = 'fact-confirmed-zero'
    `).run();

    const page = service.listFacts({
      workspaceId: 'workspace-a',
      reviewStatuses: [KnowledgeFactReviewStatus.Pending],
      limit: 1,
    });
    expect(page.items.map(item => item.id)).toEqual(['fact-pending-active']);
    expectInvalidState(() => getFactEvidencePage(service, {
      factId: 'fact-confirmed-zero',
      expectedRevision: 1,
    }));
    db.close();
  });

  test('uses bounded scalar metrics and an index-backed preview for large shared evidence', () => {
    const { db, document, service } = seedQueryMatrix();
    const insertBulk = db.transaction(() => {
      for (let index = 0; index < 1_000; index += 1) {
        insertFact(db, {
          id: `bulk-${String(index).padStart(4, '0')}`,
          value: `${'x'.repeat(1_900)}${index}`,
          reviewStatus: KnowledgeFactReviewStatus.Confirmed,
          sourceKind: index % 2 === 0
            ? KnowledgeFactSourceKind.Manual
            : KnowledgeFactSourceKind.Imported,
          updatedAt: NOW_1,
          reviewedAt: NOW_1,
        });
      }
      for (let index = 0; index < 1_498; index += 1) {
        insertEvidence(db, document, {
          id: (index + 16).toString(16).padStart(64, '0'),
          factId: 'fact-confirmed-active',
          quote: 'q'.repeat(1_000),
          confidence: 0.4,
          createdAt: NOW_3,
        });
      }
    });
    insertBulk();

    const originalPrepare = db.prepare.bind(db);
    const preparedSql: string[] = [];
    let evidenceRowsRead = 0;
    Object.defineProperty(db, 'prepare', {
      configurable: true,
      value: (source: string) => {
        preparedSql.push(source);
        const statement = originalPrepare(source);
        if (!source.includes('fact.id = @factId')) {
          return statement;
        }
        return {
          iterate: (bindings: Record<string, unknown>) => {
            const rows = statement.iterate(bindings);
            return (function* countRows() {
              for (const row of rows) {
                evidenceRowsRead += 1;
                yield row;
              }
            }());
          },
        };
      },
    });
    try {
      const result = service.listFacts({ workspaceId: 'workspace-a', limit: 100 });
      expect(result.items).toHaveLength(100);
      expect(preparedSql).toHaveLength(4);
      const listSql = preparedSql.join('\n').toUpperCase();
      expect(listSql).not.toContain('JSON_GROUP_ARRAY');
      expect(listSql).not.toContain('ROW_NUMBER');
      expect(listSql).not.toContain(' OVER (');
      const profileSql = preparedSql.find(source =>
        source.includes('enterprise_lead_workspaces'))!;
      expect(profileSql).toContain('profile');
      expect(profileSql).not.toContain('settings');
      expect(profileSql).not.toContain('extraction_sources');
      const previewSql = preparedSql.find(source =>
        source.includes('knowledge_fact_evidence') &&
        source.includes('document_display_name'))!;
      const metricsSql = preparedSql.find(source =>
        source.includes('unduplicated_legacy_confirmed_count'))!;
      expect(metricsSql).not.toContain('fact.value');
      expect(metricsSql).not.toContain('integrity_evidence.quote');
      expect(metricsSql).not.toContain('integrity_document.display_name');
      expect(metricsSql).not.toContain('knowledge_is_valid_fact_v1');
      expect(metricsSql).not.toContain('knowledge_is_valid_evidence_v1');
      expect(metricsSql).toContain('knowledge_enrichment_request_facts');
      const metricsPlan = originalPrepare(`EXPLAIN QUERY PLAN ${metricsSql}`)
        .all('workspace-a', JSON.stringify(emptyProfile())) as Array<{ detail: string }>;
      expect(metricsPlan.map(row => row.detail).join('\n'))
        .not.toContain('USE TEMP B-TREE FOR ORDER BY');
      const queryPlan = originalPrepare(`EXPLAIN QUERY PLAN ${previewSql}`)
        .all(JSON.stringify(result.items.map(item => item.id))) as Array<{ detail: string }>;
      const queryPlanText = queryPlan.map(row => row.detail).join('\n');
      expect(queryPlanText).toContain('idx_knowledge_fact_evidence_fact_state');
      expect(queryPlanText).not.toContain('USE TEMP B-TREE FOR ORDER BY');

      preparedSql.length = 0;
      const firstEvidencePage = getFactEvidencePage(service, {
        factId: 'fact-confirmed-active',
        expectedRevision: 1,
        limit: KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT,
      });
      expect(firstEvidencePage.items).toHaveLength(KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT);
      expect(firstEvidencePage.items.filter(item => item.quote.length === 1_000)).toHaveLength(99);
      expect(firstEvidencePage.nextCursor).not.toBeNull();
      expect(preparedSql).toHaveLength(1);
      expect(evidenceRowsRead).toBe(KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT + 1);
      const firstEvidenceSql = preparedSql[0];
      expect(firstEvidenceSql).toContain('fact.id = @factId');
      expect(firstEvidenceSql).toContain('fact.revision = @expectedRevision');
      expect(firstEvidenceSql).toContain('LIMIT @rowLimit');
      expect(firstEvidenceSql.toUpperCase()).not.toContain('OFFSET');
      expect(firstEvidenceSql.toUpperCase()).not.toContain('ROW_NUMBER');
      expect(firstEvidenceSql.toUpperCase()).not.toContain('JSON_GROUP_ARRAY');
      const firstEvidencePlan = originalPrepare(`EXPLAIN QUERY PLAN ${firstEvidenceSql}`)
        .all({
          factId: 'fact-confirmed-active',
          expectedRevision: 1,
          rowLimit: KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT + 1,
        }) as Array<{ detail: string }>;
      const firstEvidencePlanText = firstEvidencePlan.map(row => row.detail).join('\n');
      expect(firstEvidencePlanText).toContain('idx_knowledge_fact_evidence_fact_page');
      expect(firstEvidencePlanText).not.toContain('USE TEMP B-TREE FOR ORDER BY');

      preparedSql.length = 0;
      evidenceRowsRead = 0;
      const secondEvidencePage = getFactEvidencePage(service, {
        factId: 'fact-confirmed-active',
        expectedRevision: 1,
        cursor: firstEvidencePage.nextCursor!,
        limit: KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT,
      });
      expect(secondEvidencePage.items).toHaveLength(KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT);
      expect(secondEvidencePage.items.every(item => item.quote.length === 1_000)).toBe(true);
      expect(preparedSql).toHaveLength(1);
      expect(evidenceRowsRead).toBe(KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT + 1);
      const continuationSql = preparedSql[0];
      expect(continuationSql).toContain('(evidence.stale_at IS NOT NULL) > @stale');
      expect(continuationSql).toContain('evidence.confidence < @confidence');
      expect(continuationSql).toContain('evidence.created_at > @createdAt');
      expect(continuationSql).toContain('evidence.id > @evidenceId');
      const continuationCursor = JSON.parse(
        Buffer.from(firstEvidencePage.nextCursor!, 'base64url').toString('utf8'),
      ) as {
        stale: boolean;
        confidence: number;
        createdAt: string;
        id: string;
      };
      const continuationPlan = originalPrepare(`EXPLAIN QUERY PLAN ${continuationSql}`)
        .all({
          factId: 'fact-confirmed-active',
          expectedRevision: 1,
          stale: continuationCursor.stale ? 1 : 0,
          confidence: continuationCursor.confidence,
          createdAt: continuationCursor.createdAt,
          evidenceId: continuationCursor.id,
          rowLimit: KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT + 1,
        }) as Array<{ detail: string }>;
      const continuationPlanText = continuationPlan.map(row => row.detail).join('\n');
      expect(continuationPlanText).toContain('idx_knowledge_fact_evidence_fact_page');
      expect(continuationPlanText).not.toContain('USE TEMP B-TREE FOR ORDER BY');
    } finally {
      Object.defineProperty(db, 'prepare', {
        configurable: true,
        value: originalPrepare,
      });
    }
    db.close();
  });
});
