import { readFileSync } from 'node:fs';

import Database from 'better-sqlite3';
import { describe, expect, test, vi } from 'vitest';

import {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeEnrichmentStatus,
  KnowledgeFactDomain,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
} from '../../shared/knowledgeBase/constants';
import { normalizeEnterpriseKnowledgeValue } from '../../shared/knowledgeBase/enterpriseLeadProfileKnowledge';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';
import { KnowledgeEnrichmentRequestStore } from './knowledgeEnrichmentRequestStore';
import {
  KnowledgeFactStateError,
  KnowledgeFactStore,
  REVIEWABLE_PENDING_SQL,
} from './knowledgeFactStore';

const NOW_1 = '2026-07-12T01:00:00.000Z';
const NOW_2 = '2026-07-12T01:01:00.000Z';
const NOW_3 = '2026-07-12T01:02:00.000Z';
const ROUTING_FINGERPRINT = 'a'.repeat(64);

type RawFact = {
  id: string;
  originating_request_id: string | null;
  workspace_id: string;
  domain: string;
  value: string;
  normalized_value: string;
  review_status: string;
  source_kind: string;
  revision: number;
  conflict_group_key: string | null;
  projection_state: string;
  created_at: string;
  reviewed_at: string | null;
  updated_at: string;
  tombstoned_at: string | null;
};

type RawEvidence = {
  id: string;
  workspace_id: string;
  fact_id: string;
  request_id: string;
  document_id: string;
  document_version_id: string;
  chunk_id: string;
  quote: string;
  confidence: number;
  extractor_provider_id: string;
  extractor_model_id: string;
  created_at: string;
  stale_at: string | null;
};

const createFixture = () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  let requestUuid = 0;
  const requestStore = new KnowledgeEnrichmentRequestStore(db, {
    uuidFactory: () => `request-${++requestUuid}`,
    clock: () => NOW_1,
  });
  const documentStore = new KnowledgeDocumentStore(db);
  const factStore = new KnowledgeFactStore(db, {
    requestStore,
    clock: () => NOW_1,
  });
  return { db, documentStore, factStore, requestStore };
};

const createDocument = (
  documentStore: KnowledgeDocumentStore,
  workspaceId: string,
  text = 'The factory builds industrial robots for integrators.',
) => documentStore.createDocumentWithVersion({
  workspaceId,
  displayName: `${workspaceId}.txt`,
  sourceMode: KnowledgeDocumentSourceMode.Managed,
  status: KnowledgeDocumentStatus.Ready,
  version: {
    contentHash: 'f'.repeat(64),
    managedPath: `blobs/${workspaceId}`,
    mimeType: 'text/plain',
    fileSize: text.length,
    sourceMtime: null,
    parser: 'text',
    extractedText: text,
    extractionPartial: false,
  },
});

const insertRequest = (
  db: Database.Database,
  input: {
    id: string;
    workspaceId?: string;
    documentId: string;
    documentVersionId: string;
    status?: string;
  },
): void => {
  const status = input.status ?? KnowledgeEnrichmentStatus.ReviewRequired;
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
      NULL, NULL, NULL, 1,
      0, '[]', ?, ?,
      NULL, NULL, ?
    )
  `).run(
    input.id,
    input.workspaceId ?? 'workspace-a',
    input.documentId,
    input.documentVersionId,
    status,
    ROUTING_FINGERPRINT,
    NOW_1,
    NOW_1,
    NOW_1,
  );
};

const buildFact = (overrides: Partial<RawFact> = {}): RawFact => {
  const value = overrides.value ?? 'Industrial robots';
  return {
    id: overrides.id ?? 'fact-a',
    originating_request_id: overrides.originating_request_id ?? null,
    workspace_id: overrides.workspace_id ?? 'workspace-a',
    domain: overrides.domain ?? KnowledgeFactDomain.ProductList,
    value,
    normalized_value: overrides.normalized_value ??
      normalizeEnterpriseKnowledgeValue(value).normalizedValue,
    review_status: overrides.review_status ?? KnowledgeFactReviewStatus.Pending,
    source_kind: overrides.source_kind ?? KnowledgeFactSourceKind.Manual,
    revision: overrides.revision ?? 1,
    conflict_group_key: overrides.conflict_group_key ?? null,
    projection_state: overrides.projection_state ?? KnowledgeFactProjectionState.None,
    created_at: overrides.created_at ?? NOW_1,
    reviewed_at: overrides.reviewed_at ?? null,
    updated_at: overrides.updated_at ?? NOW_1,
    tombstoned_at: overrides.tombstoned_at ?? null,
  };
};

const insertFact = (db: Database.Database, overrides: Partial<RawFact> = {}): RawFact => {
  const fact = buildFact(overrides);
  db.prepare(`
    INSERT INTO knowledge_facts (
      id, originating_request_id, workspace_id, domain, value, normalized_value,
      review_status, source_kind, revision, conflict_group_key, projection_state,
      created_at, reviewed_at, updated_at, tombstoned_at
    ) VALUES (
      @id, @originating_request_id, @workspace_id, @domain, @value, @normalized_value,
      @review_status, @source_kind, @revision, @conflict_group_key, @projection_state,
      @created_at, @reviewed_at, @updated_at, @tombstoned_at
    )
  `).run(fact);
  return fact;
};

const buildEvidence = (
  document: ReturnType<typeof createDocument>,
  overrides: Partial<RawEvidence> = {},
): RawEvidence => ({
  id: overrides.id ?? '1'.repeat(64),
  workspace_id: overrides.workspace_id ?? document.document.workspaceId,
  fact_id: overrides.fact_id ?? 'fact-a',
  request_id: overrides.request_id ?? 'request-a',
  document_id: overrides.document_id ?? document.document.id,
  document_version_id: overrides.document_version_id ?? document.version.id,
  chunk_id: overrides.chunk_id ?? 'chunk-a',
  quote: overrides.quote ?? 'builds industrial robots',
  confidence: overrides.confidence ?? 0.9,
  extractor_provider_id: overrides.extractor_provider_id ?? 'provider-a',
  extractor_model_id: overrides.extractor_model_id ?? 'model-a',
  created_at: overrides.created_at ?? NOW_1,
  stale_at: overrides.stale_at ?? null,
});

const insertEvidence = (
  db: Database.Database,
  document: ReturnType<typeof createDocument>,
  overrides: Partial<RawEvidence> = {},
): RawEvidence => {
  const evidence = buildEvidence(document, overrides);
  db.prepare(`
    INSERT INTO knowledge_fact_evidence (
      id, workspace_id, fact_id, request_id, document_id, document_version_id,
      chunk_id, quote, confidence, extractor_provider_id, extractor_model_id,
      created_at, stale_at
    ) VALUES (
      @id, @workspace_id, @fact_id, @request_id, @document_id, @document_version_id,
      @chunk_id, @quote, @confidence, @extractor_provider_id, @extractor_model_id,
      @created_at, @stale_at
    )
  `).run(evidence);
  return evidence;
};

const linkRequestFact = (db: Database.Database, requestId: string, factId: string): void => {
  db.prepare(`
    INSERT INTO knowledge_enrichment_request_facts (request_id, fact_id)
    VALUES (?, ?)
  `).run(requestId, factId);
};

const expectFactStateError = (operation: () => unknown): KnowledgeFactStateError => {
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
  expect(thrown).not.toHaveProperty('cause');
  expect(thrown).not.toHaveProperty('stack');
  expect(JSON.parse(JSON.stringify(thrown))).toEqual({
    code: KnowledgeBaseErrorCode.JobStateConflict,
    message: 'Knowledge fact state is invalid',
  });
  return thrown as KnowledgeFactStateError;
};

describe('KnowledgeFactStore schema and safe mapping', () => {
  test('does not expose an unbounded production evidence-array read API', () => {
    const source = readFileSync(new URL('./knowledgeFactStore.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\blistEvidenceRecords\s*\(/);

    const { db, factStore } = createFixture();
    expect(factStore).not.toHaveProperty('listEvidenceRecords');
    db.close();
  });

  test('keeps the shared reviewable predicate exact and independent of corrupt ownership', () => {
    expect(REVIEWABLE_PENDING_SQL.replace(/\s+/g, ' ').trim()).toBe(
      "fact.review_status = 'pending' AND fact.tombstoned_at IS NULL " +
      'AND EXISTS ( SELECT 1 FROM knowledge_fact_evidence AS reviewable_evidence ' +
      'WHERE reviewable_evidence.fact_id = fact.id ' +
      'AND reviewable_evidence.stale_at IS NULL )',
    );

    const { db, documentStore, factStore, requestStore } = createFixture();
    const documentA = createDocument(documentStore, 'workspace-a');
    const documentB = createDocument(documentStore, 'workspace-b');
    insertRequest(db, {
      id: 'request-a',
      documentId: documentA.document.id,
      documentVersionId: documentA.version.id,
    });
    insertRequest(db, {
      id: 'request-b',
      workspaceId: 'workspace-b',
      documentId: documentB.document.id,
      documentVersionId: documentB.version.id,
    });
    insertFact(db, { id: 'fact-a', workspace_id: 'workspace-a' });
    linkRequestFact(db, 'request-a', 'fact-a');
    linkRequestFact(db, 'request-b', 'fact-a');
    insertEvidence(db, documentB, {
      id: 'f'.repeat(64),
      workspace_id: 'workspace-a',
      fact_id: 'fact-a',
      request_id: 'request-b',
    });

    const readReviewable = db.transaction(() =>
      factStore.hasReviewablePublicationFactsInCurrentTransaction('request-a'));
    expect(readReviewable()).toBe(true);
    expect(requestStore.getSummary('request-a')?.pendingFactCount).toBe(1);
    db.close();
  });

  test('rejects a request-store primitive bound to another database connection', () => {
    const dbA = new Database(':memory:');
    const dbB = new Database(':memory:');
    new KnowledgeEnrichmentRequestStore(dbA);
    const requestStoreB = new KnowledgeEnrichmentRequestStore(dbB);
    expectFactStateError(() => new KnowledgeFactStore(dbA, {
      requestStore: requestStoreB,
      clock: () => NOW_1,
    }));
    dbA.close();
    dbB.close();
  });

  test('translates schema initialization failures to the fixed state error', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const requestStore = new KnowledgeEnrichmentRequestStore(db);
    db.exec('CREATE TABLE knowledge_facts (id TEXT PRIMARY KEY)');
    const error = expectFactStateError(() => new KnowledgeFactStore(db, {
      requestStore,
      clock: () => NOW_1,
    }));
    expect(JSON.stringify(error)).not.toContain('workspace_id');
    expect(JSON.stringify(error)).not.toContain('knowledge_facts');
    db.close();
  });

  test('exposes publication primitives that require the caller outer transaction', () => {
    const { db, factStore } = createFixture();
    const calls: Array<[string, readonly unknown[]]> = [
      ['findPublicationFactsInCurrentTransaction', ['workspace-a', []]],
      ['findPublicationEvidenceInCurrentTransaction', [[]]],
      ['insertPublicationFactInCurrentTransaction', [{}]],
      ['insertPublicationEvidenceInCurrentTransaction', [{}]],
      ['revisePublicationFactsInCurrentTransaction', [[], NOW_1]],
      ['insertPublicationMembershipsInCurrentTransaction', ['request-a', []]],
      ['hasReviewablePublicationFactsInCurrentTransaction', ['request-a']],
      ['getReviewFactInCurrentTransaction', [{}]],
      ['confirmFactInCurrentTransaction', [{}]],
      ['rejectFactInCurrentTransaction', [{}]],
      ['archiveFactInCurrentTransaction', [{}]],
    ];
    const primitives = factStore as unknown as Record<string, unknown>;
    const missing = calls
      .map(([name]) => name)
      .filter(name => typeof primitives[name] !== 'function');
    if (missing.length > 0) {
      db.close();
      expect(missing).toEqual([]);
      return;
    }
    for (const [name, args] of calls) {
      expectFactStateError(() => Reflect.apply(
        primitives[name] as (...values: unknown[]) => unknown,
        factStore,
        args,
      ));
    }
    db.close();
  });

  test('sanitizes non-allowlisted fact state error codes at runtime', () => {
    const error = new KnowledgeFactStateError('raw-secret-code' as never);
    expect(error).toMatchObject({
      code: KnowledgeBaseErrorCode.JobStateConflict,
      message: 'Knowledge fact state is invalid',
    });
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      code: KnowledgeBaseErrorCode.JobStateConflict,
      message: 'Knowledge fact state is invalid',
    });
  });

  test('creates the complete fact, evidence, membership schema and indexes', () => {
    const { db } = createFixture();
    const schema = new Map(
      (db.prepare(`
        SELECT name, sql
        FROM sqlite_master
        WHERE name IN (
          'knowledge_facts',
          'knowledge_fact_evidence',
          'knowledge_enrichment_request_facts',
          'idx_knowledge_facts_active_value',
          'idx_knowledge_facts_workspace_page',
          'idx_knowledge_facts_workspace_metrics',
          'idx_knowledge_fact_evidence_fact_state',
          'idx_knowledge_fact_evidence_fact_page',
          'idx_knowledge_fact_evidence_version_state',
          'idx_knowledge_fact_evidence_workspace',
          'idx_knowledge_fact_evidence_request',
          'idx_knowledge_enrichment_request_facts_fact'
        )
      `).all() as Array<{ name: string; sql: string }>).map(row => [row.name, row.sql]),
    );

    expect([...schema.keys()].sort()).toEqual([
      'knowledge_facts',
      'knowledge_fact_evidence',
      'knowledge_enrichment_request_facts',
      'idx_knowledge_facts_active_value',
      'idx_knowledge_facts_workspace_page',
      'idx_knowledge_facts_workspace_metrics',
      'idx_knowledge_fact_evidence_fact_state',
      'idx_knowledge_fact_evidence_fact_page',
      'idx_knowledge_fact_evidence_version_state',
      'idx_knowledge_fact_evidence_workspace',
      'idx_knowledge_fact_evidence_request',
      'idx_knowledge_enrichment_request_facts_fact',
    ].sort());
    const factSql = schema.get('knowledge_facts')!;
    const evidenceSql = schema.get('knowledge_fact_evidence')!;
    const membershipSql = schema.get('knowledge_enrichment_request_facts')!;
    expect(factSql).toContain("review_status IN ('pending','confirmed','rejected')");
    expect(factSql).toContain("source_kind IN ('extracted','manual','imported')");
    expect(factSql).toContain("projection_state IN ('none','active','conflict','reversed')");
    expect(factSql).toContain("TYPEOF(revision) = 'integer'");
    expect(factSql).toContain('LENGTH(value) <= 2000');
    expect(factSql).not.toContain('LENGTH(normalized_value)');
    expect(factSql).toContain("source_kind <> 'extracted' OR originating_request_id IS NOT NULL");
    expect(evidenceSql).toContain('LENGTH(id) = 64');
    expect(evidenceSql).toContain("id NOT GLOB '*[^0-9a-f]*'");
    expect(evidenceSql).toContain('LENGTH(quote) <= 1000');
    expect(evidenceSql).toContain('confidence BETWEEN 0 AND 1');
    expect(evidenceSql).not.toContain('storage_id');
    expect(evidenceSql).not.toContain('index_generation_id');
    expect(membershipSql).toContain('PRIMARY KEY(request_id, fact_id)');
    expect(schema.get('idx_knowledge_facts_active_value')).toContain(
      "WHERE tombstoned_at IS NULL AND review_status IN ('pending', 'confirmed')",
    );
    const expectedIndexColumns: Record<string, Array<string | null>> = {
      idx_knowledge_facts_active_value: ['workspace_id', 'domain', 'normalized_value'],
      idx_knowledge_facts_workspace_page: ['workspace_id', 'updated_at', 'id'],
      idx_knowledge_facts_workspace_metrics: [
        'workspace_id',
        'review_status',
        'tombstoned_at',
        'domain',
        'normalized_value',
      ],
      idx_knowledge_fact_evidence_fact_state: [
        'fact_id',
        'stale_at',
        'confidence',
        'created_at',
        'id',
      ],
      idx_knowledge_fact_evidence_fact_page: [
        'fact_id',
        null,
        'confidence',
        'created_at',
        'id',
      ],
      idx_knowledge_fact_evidence_version_state: [
        'document_version_id',
        'stale_at',
        'fact_id',
      ],
      idx_knowledge_fact_evidence_workspace: ['workspace_id', 'fact_id', 'id'],
      idx_knowledge_fact_evidence_request: ['request_id', 'fact_id', 'id'],
      idx_knowledge_enrichment_request_facts_fact: ['fact_id', 'request_id'],
    };
    for (const [indexName, columns] of Object.entries(expectedIndexColumns)) {
      expect((db.prepare(`PRAGMA index_info(${indexName})`).all() as Array<{
        name: string | null;
      }>)
        .map(row => row.name)).toEqual(columns);
    }
    expect(schema.get('idx_knowledge_fact_evidence_fact_page')?.replace(/\s+/g, ' '))
      .toContain(
        'fact_id, (stale_at IS NOT NULL) ASC, confidence DESC, created_at ASC, id ASC',
      );
    const evidencePageIndex = db.prepare(`
      PRAGMA index_xinfo(idx_knowledge_fact_evidence_fact_page)
    `).all() as Array<{ cid: number; desc: number; key: number }>;
    expect(evidencePageIndex.filter(column => column.key === 1).map(column => ({
      cid: column.cid,
      desc: column.desc,
    }))).toEqual([
      { cid: 2, desc: 0 },
      { cid: -2, desc: 0 },
      { cid: 8, desc: 1 },
      { cid: 11, desc: 0 },
      { cid: 0, desc: 0 },
    ]);
    expect((db.prepare(`PRAGMA index_list(knowledge_facts)`).all() as Array<{
      name: string;
      unique: number;
      partial: number;
    }>).find(index => index.name === 'idx_knowledge_facts_active_value')).toMatchObject({
      unique: 1,
      partial: 1,
    });
    const foreignKeys = (table: string): string[] =>
      (db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
        from: string;
        table: string;
        to: string;
      }>).map(row => `${row.from}->${row.table}.${row.to}`).sort();
    expect(foreignKeys('knowledge_facts')).toEqual([
      'originating_request_id->knowledge_enrichment_requests.id',
    ]);
    expect(foreignKeys('knowledge_fact_evidence')).toEqual([
      'document_id->knowledge_documents.id',
      'document_version_id->knowledge_document_versions.id',
      'fact_id->knowledge_facts.id',
      'request_id->knowledge_enrichment_requests.id',
    ]);
    expect(foreignKeys('knowledge_enrichment_request_facts')).toEqual([
      'fact_id->knowledge_facts.id',
      'request_id->knowledge_enrichment_requests.id',
    ]);
    db.close();
  });

  test('enforces active identity, extracted origin, value, evidence id, quote, and confidence constraints', () => {
    const { db, documentStore } = createFixture();
    const document = createDocument(documentStore, 'workspace-a');
    insertRequest(db, {
      id: 'request-a',
      documentId: document.document.id,
      documentVersionId: document.version.id,
    });
    insertFact(db, { id: 'fact-a', value: 'Robots' });

    expect(() => insertFact(db, { id: 'fact-duplicate', value: ' robots ' })).toThrow();
    expect(() => insertFact(db, {
      id: 'fact-rejected',
      value: ' robots ',
      review_status: KnowledgeFactReviewStatus.Rejected,
    })).not.toThrow();
    expect(() => insertFact(db, {
      id: 'fact-origin-missing',
      value: 'Origin missing',
      source_kind: KnowledgeFactSourceKind.Extracted,
      originating_request_id: null,
    })).toThrow();
    expect(() => insertFact(db, {
      id: 'fact-too-long',
      value: 'x'.repeat(2_001),
    })).toThrow();
    for (const overrides of [
      { id: '' },
      { id: 'fact-bad-domain', domain: 'unknown-domain' },
      { id: 'fact-bad-review', review_status: 'unknown-review' },
      { id: 'fact-bad-source', source_kind: 'unknown-source' },
      { id: 'fact-bad-projection', projection_state: 'unknown-projection' },
      { id: 'fact-zero-revision', revision: 0 },
      { id: 'fact-fractional-revision', revision: 1.5 },
      { id: 'fact-empty-conflict', conflict_group_key: '   ' },
    ]) {
      expect(() => insertFact(db, {
        value: `Invalid ${JSON.stringify(overrides)}`,
        ...overrides,
      })).toThrow();
    }
    expect(() => insertEvidence(db, document, {
      id: 'not-a-hash',
      fact_id: 'fact-a',
      request_id: 'request-a',
    })).toThrow();
    expect(() => insertEvidence(db, document, {
      id: '2'.repeat(64),
      fact_id: 'fact-a',
      request_id: 'request-a',
      quote: 'q'.repeat(1_001),
    })).toThrow();
    expect(() => insertEvidence(db, document, {
      id: '3'.repeat(64),
      fact_id: 'fact-a',
      request_id: 'request-a',
      confidence: 1.01,
    })).toThrow();
    expect(() => insertEvidence(db, document, {
      id: '4'.repeat(64),
      fact_id: 'missing-fact',
      request_id: 'request-a',
    })).toThrow();
    expect(() => insertEvidence(db, document, {
      id: '5'.repeat(64),
      fact_id: 'fact-a',
      request_id: 'missing-request',
    })).toThrow();
    linkRequestFact(db, 'request-a', 'fact-a');
    expect(() => linkRequestFact(db, 'request-a', 'fact-a')).toThrow();
    expect(() => linkRequestFact(db, 'missing-request', 'fact-a')).toThrow();
    expect(() => linkRequestFact(db, 'request-a', 'missing-fact')).toThrow();
    db.close();
  });

  test('rejects cross-workspace publication evidence on both insert and idempotent reuse', () => {
    const { db, documentStore, factStore } = createFixture();
    const foreignDocument = createDocument(documentStore, 'workspace-b');
    insertRequest(db, {
      id: 'request-b',
      workspaceId: 'workspace-b',
      documentId: foreignDocument.document.id,
      documentVersionId: foreignDocument.version.id,
    });
    insertFact(db, { id: 'fact-a', workspace_id: 'workspace-a' });

    const insertCrossWorkspace = db.transaction(() =>
      factStore.insertPublicationEvidenceInCurrentTransaction({
        id: 'a'.repeat(64),
        workspaceId: 'workspace-a',
        factId: 'fact-a',
        requestId: 'request-b',
        documentId: foreignDocument.document.id,
        documentVersionId: foreignDocument.version.id,
        chunkId: 'foreign-chunk',
        quote: 'workspace-b-private-quote',
        confidence: 0.9,
        extractorProviderId: 'provider-a',
        extractorModelId: 'model-a',
        createdAt: NOW_1,
      }));
    const insertError = expectFactStateError(insertCrossWorkspace);
    expect(JSON.stringify(insertError)).not.toContain('workspace-b-private-quote');
    expect(db.prepare('SELECT COUNT(*) AS count FROM knowledge_fact_evidence').get())
      .toEqual({ count: 0 });

    insertEvidence(db, foreignDocument, {
      id: 'b'.repeat(64),
      workspace_id: 'workspace-a',
      fact_id: 'fact-a',
      request_id: 'request-b',
      quote: 'workspace-b-private-quote',
    });
    const findCrossWorkspace = db.transaction(() =>
      factStore.findPublicationEvidenceInCurrentTransaction(['b'.repeat(64)]));
    const reuseError = expectFactStateError(findCrossWorkspace);
    expect(JSON.stringify(reuseError)).not.toContain('workspace-b-private-quote');
    expect(JSON.stringify(reuseError)).not.toContain('workspace-b.txt');
    db.close();
  });

  test('maps every evidence column and fails every corrupt evidence field closed', () => {
    const { db, documentStore, factStore } = createFixture();
    const document = createDocument(documentStore, 'workspace-a');
    const valid = buildEvidence(document, {
      id: 'a'.repeat(64),
      stale_at: NOW_2,
    });
    expect(factStore.mapEvidenceRowForInternalUse(valid)).toEqual({
      id: valid.id,
      workspaceId: valid.workspace_id,
      factId: valid.fact_id,
      requestId: valid.request_id,
      documentId: valid.document_id,
      documentVersionId: valid.document_version_id,
      chunkId: valid.chunk_id,
      quote: valid.quote,
      confidence: valid.confidence,
      extractorProviderId: valid.extractor_provider_id,
      extractorModelId: valid.extractor_model_id,
      createdAt: valid.created_at,
      staleAt: valid.stale_at,
    });
    const corruptRows: RawEvidence[] = [
      { ...valid, id: 'A'.repeat(64) },
      { ...valid, workspace_id: '' },
      { ...valid, fact_id: '' },
      { ...valid, request_id: '' },
      { ...valid, document_id: '' },
      { ...valid, document_version_id: '' },
      { ...valid, chunk_id: '' },
      { ...valid, quote: ' ' },
      { ...valid, quote: 'q'.repeat(1_001) },
      { ...valid, confidence: Number.NaN },
      { ...valid, confidence: -0.01 },
      { ...valid, extractor_provider_id: '' },
      { ...valid, extractor_model_id: '' },
      { ...valid, created_at: 'not-a-time' },
      { ...valid, stale_at: 'not-a-time' },
    ];
    for (const row of corruptRows) {
      expectFactStateError(() => factStore.mapEvidenceRowForInternalUse(row));
    }
    db.close();
  });

  test('maps every column, permits expanding normalization, and fails corrupt rows closed', () => {
    const { db, factStore } = createFixture();
    const value = 'İ'.repeat(2_000);
    const normalizedValue = normalizeEnterpriseKnowledgeValue(value).normalizedValue;
    expect(normalizedValue.length).toBeGreaterThan(2_000);
    insertFact(db, {
      id: 'fact-expanding',
      value,
      normalized_value: normalizedValue,
      review_status: KnowledgeFactReviewStatus.Confirmed,
      source_kind: KnowledgeFactSourceKind.Imported,
      revision: 7,
      conflict_group_key: 'group-a',
      projection_state: KnowledgeFactProjectionState.Active,
      reviewed_at: NOW_2,
      updated_at: NOW_2,
      tombstoned_at: NOW_3,
    });
    expect(factStore.getFact('fact-expanding')).toEqual({
      id: 'fact-expanding',
      originatingRequestId: null,
      workspaceId: 'workspace-a',
      domain: KnowledgeFactDomain.ProductList,
      value,
      normalizedValue,
      reviewStatus: KnowledgeFactReviewStatus.Confirmed,
      sourceKind: KnowledgeFactSourceKind.Imported,
      revision: 7,
      conflictGroupKey: 'group-a',
      projectionState: KnowledgeFactProjectionState.Active,
      createdAt: NOW_1,
      reviewedAt: NOW_2,
      updatedAt: NOW_2,
      tombstonedAt: NOW_3,
    });

    db.prepare(`
      UPDATE knowledge_facts
      SET normalized_value = 'corrupt-normalization'
      WHERE id = 'fact-expanding'
    `).run();
    expectFactStateError(() => factStore.getFact('fact-expanding'));
    db.prepare(`
      UPDATE knowledge_facts
      SET normalized_value = ?, updated_at = 'not-a-time'
      WHERE id = 'fact-expanding'
    `).run(normalizedValue);
    expectFactStateError(() => factStore.getFact('fact-expanding'));
    db.close();
  });
});

describe('KnowledgeFactStore stale recalculation and cleanup', () => {
  test('retries transient neutral failures but sanitizes a public retry exhaustion', () => {
    const retryFixture = createFixture();
    const original = retryFixture.factStore.markVersionEvidenceStaleInCurrentTransaction
      .bind(retryFixture.factStore);
    let retryCallCount = 0;
    vi.spyOn(
      retryFixture.factStore,
      'markVersionEvidenceStaleInCurrentTransaction',
    ).mockImplementation((versionId, now) => {
      retryCallCount += 1;
      if (retryCallCount === 1) {
        throw Object.assign(new Error('raw-transient-secret'), {
          code: 'SQLITE_BUSY_SNAPSHOT',
        });
      }
      return original(versionId, now);
    });
    expect(retryFixture.factStore.markVersionEvidenceStale('version-a', NOW_2)).toEqual({
      staleEvidenceCount: 0,
      revisedFactCount: 0,
      completedRequestCount: 0,
    });
    expect(retryCallCount).toBe(2);
    retryFixture.db.close();

    const exhaustedFixture = createFixture();
    let exhaustedCallCount = 0;
    vi.spyOn(
      exhaustedFixture.factStore,
      'markVersionEvidenceStaleInCurrentTransaction',
    ).mockImplementation(() => {
      exhaustedCallCount += 1;
      throw Object.assign(new Error('raw-exhausted-secret /private/knowledge.sqlite'), {
        code: 'SQLITE_BUSY',
      });
    });
    const error = expectFactStateError(() =>
      exhaustedFixture.factStore.markVersionEvidenceStale('version-a', NOW_2));
    expect(exhaustedCallCount).toBe(4);
    expect(JSON.stringify(error)).not.toContain('raw-exhausted-secret');
    exhaustedFixture.db.close();
  });

  test('stales active evidence, bumps each fact once at exact now, and completes only exhausted requests', () => {
    const { db, documentStore, factStore, requestStore } = createFixture();
    const documentA = createDocument(documentStore, 'workspace-a', 'Version A evidence');
    const documentB = createDocument(documentStore, 'workspace-a', 'Version B evidence');
    insertRequest(db, {
      id: 'request-a',
      documentId: documentA.document.id,
      documentVersionId: documentA.version.id,
    });
    insertRequest(db, {
      id: 'request-b',
      documentId: documentB.document.id,
      documentVersionId: documentB.version.id,
    });
    insertFact(db, {
      id: 'fact-a',
      value: 'Fact A',
      source_kind: KnowledgeFactSourceKind.Extracted,
      originating_request_id: 'request-a',
    });
    insertFact(db, {
      id: 'fact-b',
      value: 'Fact B',
      source_kind: KnowledgeFactSourceKind.Extracted,
      originating_request_id: 'request-b',
    });
    linkRequestFact(db, 'request-a', 'fact-a');
    linkRequestFact(db, 'request-b', 'fact-a');
    linkRequestFact(db, 'request-b', 'fact-b');
    insertEvidence(db, documentA, {
      id: '1'.repeat(64),
      fact_id: 'fact-a',
      request_id: 'request-a',
      chunk_id: 'chunk-a-1',
    });
    insertEvidence(db, documentA, {
      id: '2'.repeat(64),
      fact_id: 'fact-a',
      request_id: 'request-a',
      chunk_id: 'chunk-a-2',
    });
    insertEvidence(db, documentB, {
      id: '3'.repeat(64),
      fact_id: 'fact-b',
      request_id: 'request-b',
      chunk_id: 'chunk-b-1',
    });

    expect(requestStore.getSummary('request-a')?.pendingFactCount).toBe(1);
    expect(requestStore.getSummary('request-b')?.pendingFactCount).toBe(2);
    expect(factStore.markVersionEvidenceStale(documentA.version.id, NOW_2)).toEqual({
      staleEvidenceCount: 2,
      revisedFactCount: 1,
      completedRequestCount: 1,
    });
    expect(factStore.getFact('fact-a')).toMatchObject({
      reviewStatus: KnowledgeFactReviewStatus.Pending,
      revision: 2,
      updatedAt: NOW_2,
      tombstonedAt: null,
    });
    expect(requestStore.getRequest('request-a')).toMatchObject({
      status: KnowledgeEnrichmentStatus.Completed,
      updatedAt: NOW_2,
      completedAt: NOW_2,
      revision: 1,
      validCandidateCount: 1,
    });
    expect(requestStore.getRequest('request-b')?.status).toBe(
      KnowledgeEnrichmentStatus.ReviewRequired,
    );
    expect(factStore.markVersionEvidenceStale(documentA.version.id, NOW_3)).toEqual({
      staleEvidenceCount: 0,
      revisedFactCount: 0,
      completedRequestCount: 0,
    });
    expect(factStore.getFact('fact-a')).toMatchObject({ revision: 2, updatedAt: NOW_2 });

    db.prepare(`
      UPDATE knowledge_facts
      SET review_status = ?, reviewed_at = ?, updated_at = ?
      WHERE id = 'fact-b'
    `).run(KnowledgeFactReviewStatus.Rejected, NOW_3, NOW_3);
    expect(factStore.recalculateLinkedRequests('fact-b', NOW_3)).toBe(1);
    expect(requestStore.getRequest('request-b')).toMatchObject({
      status: KnowledgeEnrichmentStatus.Completed,
      completedAt: NOW_3,
      revision: 1,
    });
    db.close();
  });

  test('keeps a request reviewable when another version still supports the same fact', () => {
    const { db, documentStore, factStore, requestStore } = createFixture();
    const documentA = createDocument(documentStore, 'workspace-a', 'Version A evidence');
    const documentB = createDocument(documentStore, 'workspace-a', 'Version B evidence');
    insertRequest(db, {
      id: 'request-a',
      documentId: documentA.document.id,
      documentVersionId: documentA.version.id,
    });
    insertRequest(db, {
      id: 'request-b',
      documentId: documentB.document.id,
      documentVersionId: documentB.version.id,
    });
    insertFact(db, {
      id: 'fact-a',
      source_kind: KnowledgeFactSourceKind.Extracted,
      originating_request_id: 'request-a',
    });
    linkRequestFact(db, 'request-a', 'fact-a');
    insertEvidence(db, documentA, {
      id: '1'.repeat(64),
      fact_id: 'fact-a',
      request_id: 'request-a',
      chunk_id: 'chunk-a-active',
    });
    insertEvidence(db, documentA, {
      id: '2'.repeat(64),
      fact_id: 'fact-a',
      request_id: 'request-a',
      chunk_id: 'chunk-a-already-stale',
      stale_at: NOW_1,
    });
    insertEvidence(db, documentB, {
      id: '3'.repeat(64),
      fact_id: 'fact-a',
      request_id: 'request-b',
      chunk_id: 'chunk-b-active',
    });

    expect(factStore.markVersionEvidenceStale(documentA.version.id, NOW_2)).toEqual({
      staleEvidenceCount: 1,
      revisedFactCount: 1,
      completedRequestCount: 0,
    });
    expect(requestStore.getRequest('request-a')?.status).toBe(
      KnowledgeEnrichmentStatus.ReviewRequired,
    );
    expect(factStore.getFact('fact-a')).toMatchObject({ revision: 2, updatedAt: NOW_2 });
    expect(db.prepare(`
      SELECT id, stale_at
      FROM knowledge_fact_evidence
      WHERE fact_id = 'fact-a'
      ORDER BY id
    `).all()).toEqual([
      { id: '1'.repeat(64), stale_at: NOW_2 },
      { id: '2'.repeat(64), stale_at: NOW_1 },
      { id: '3'.repeat(64), stale_at: null },
    ]);
    db.close();
  });

  test('preserves confirmed projection state and request-stale ordering wins over recalculation', () => {
    const { db, documentStore, factStore, requestStore } = createFixture();
    const document = createDocument(documentStore, 'workspace-a');
    insertRequest(db, {
      id: 'request-a',
      documentId: document.document.id,
      documentVersionId: document.version.id,
    });
    insertFact(db, {
      id: 'fact-confirmed',
      value: 'Confirmed value',
      review_status: KnowledgeFactReviewStatus.Confirmed,
      source_kind: KnowledgeFactSourceKind.Extracted,
      originating_request_id: 'request-a',
      projection_state: KnowledgeFactProjectionState.Active,
      reviewed_at: NOW_1,
    });
    linkRequestFact(db, 'request-a', 'fact-confirmed');
    insertEvidence(db, document, {
      id: '4'.repeat(64),
      fact_id: 'fact-confirmed',
      request_id: 'request-a',
    });

    const transition = db.transaction(() => {
      expect(requestStore.markVersionStaleInCurrentTransaction(document.version.id, NOW_2)).toBe(1);
      return factStore.markVersionEvidenceStaleInCurrentTransaction(document.version.id, NOW_2);
    });
    expect(transition()).toEqual({
      staleEvidenceCount: 1,
      revisedFactCount: 1,
      completedRequestCount: 0,
    });
    expect(requestStore.getRequest('request-a')?.status).toBe(KnowledgeEnrichmentStatus.Stale);
    expect(factStore.getFact('fact-confirmed')).toMatchObject({
      reviewStatus: KnowledgeFactReviewStatus.Confirmed,
      projectionState: KnowledgeFactProjectionState.Active,
      tombstonedAt: null,
      revision: 2,
      updatedAt: NOW_2,
    });
    db.close();
  });

  test('uses a fixed set-based stale/recalculation statement count for 100 linked facts', () => {
    const { db, documentStore, factStore } = createFixture();
    const document = createDocument(documentStore, 'workspace-a');
    insertRequest(db, {
      id: 'request-bulk',
      documentId: document.document.id,
      documentVersionId: document.version.id,
    });
    const insertMany = db.transaction(() => {
      for (let index = 0; index < 100; index += 1) {
        const factId = `fact-${index}`;
        insertFact(db, {
          id: factId,
          value: `Value ${index}`,
          source_kind: KnowledgeFactSourceKind.Extracted,
          originating_request_id: 'request-bulk',
        });
        linkRequestFact(db, 'request-bulk', factId);
        insertEvidence(db, document, {
          id: index.toString(16).padStart(64, '0'),
          fact_id: factId,
          request_id: 'request-bulk',
          chunk_id: `chunk-${index}`,
        });
      }
    });
    insertMany();

    const originalPrepare = db.prepare.bind(db);
    let statementCount = 0;
    Object.defineProperty(db, 'prepare', {
      configurable: true,
      value: (source: string) => {
        statementCount += 1;
        return originalPrepare(source);
      },
    });
    try {
      expect(factStore.markVersionEvidenceStale(document.version.id, NOW_2)).toEqual({
        staleEvidenceCount: 100,
        revisedFactCount: 100,
        completedRequestCount: 1,
      });
      expect(statementCount).toBeLessThanOrEqual(6);
    } finally {
      Object.defineProperty(db, 'prepare', {
        configurable: true,
        value: originalPrepare,
      });
    }
    db.close();
  });

  test('cleans membership then evidence then facts, is transaction-neutral, and rolls back failures', () => {
    const { db, documentStore, factStore } = createFixture();
    const document = createDocument(documentStore, 'workspace-a');
    insertRequest(db, {
      id: 'request-a',
      documentId: document.document.id,
      documentVersionId: document.version.id,
    });
    insertFact(db, { id: 'fact-a', value: 'Workspace A value' });
    linkRequestFact(db, 'request-a', 'fact-a');
    insertEvidence(db, document, {
      id: '5'.repeat(64),
      fact_id: 'fact-a',
      request_id: 'request-a',
    });
    insertFact(db, {
      id: 'fact-foreign',
      workspace_id: 'workspace-b',
      value: 'Workspace B value',
    });

    expectFactStateError(() => factStore.deleteWorkspaceFactsInCurrentTransaction('workspace-a'));
    db.exec(`
      CREATE TRIGGER fail_evidence_delete
      BEFORE DELETE ON knowledge_fact_evidence
      BEGIN
        SELECT RAISE(ABORT, 'raw-secret-trigger-message');
      END;
    `);
    const failingCleanup = db.transaction(() =>
      factStore.deleteWorkspaceFactsInCurrentTransaction('workspace-a'));
    expectFactStateError(failingCleanup);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_enrichment_request_facts
      WHERE fact_id = 'fact-a'
    `).get()).toEqual({ count: 1 });
    expect(factStore.getFact('fact-a')).not.toBeNull();

    db.exec('DROP TRIGGER fail_evidence_delete');
    const originalPrepare = db.prepare.bind(db);
    const preparedSql: string[] = [];
    Object.defineProperty(db, 'prepare', {
      configurable: true,
      value: (source: string) => {
        preparedSql.push(source);
        return originalPrepare(source);
      },
    });
    const cleanup = db.transaction(() =>
      factStore.deleteWorkspaceFactsInCurrentTransaction('workspace-a'));
    try {
      expect(cleanup()).toEqual({
        deletedMembershipCount: 1,
        deletedEvidenceCount: 1,
        deletedFactCount: 1,
      });
    } finally {
      Object.defineProperty(db, 'prepare', {
        configurable: true,
        value: originalPrepare,
      });
    }
    expect(preparedSql).toHaveLength(3);
    expect(preparedSql.map(source => source.match(/DELETE FROM ([a-z_]+)/)?.[1])).toEqual([
      'knowledge_enrichment_request_facts',
      'knowledge_fact_evidence',
      'knowledge_facts',
    ]);
    expect(factStore.getFact('fact-a')).toBeNull();
    expect(factStore.getFact('fact-foreign')).not.toBeNull();
    expect(cleanup()).toEqual({
      deletedMembershipCount: 0,
      deletedEvidenceCount: 0,
      deletedFactCount: 0,
    });
    db.close();
  });

  test('cleans corrupted membership and evidence when either ownership side targets workspace', () => {
    const { db, documentStore, factStore } = createFixture();
    const documentA = createDocument(documentStore, 'workspace-a');
    const documentB = createDocument(documentStore, 'workspace-b');
    insertRequest(db, {
      id: 'request-owned-a',
      workspaceId: 'workspace-a',
      documentId: documentA.document.id,
      documentVersionId: documentA.version.id,
    });
    insertRequest(db, {
      id: 'request-owned-b',
      workspaceId: 'workspace-b',
      documentId: documentB.document.id,
      documentVersionId: documentB.version.id,
    });
    insertFact(db, {
      id: 'fact-owned-b',
      workspace_id: 'workspace-b',
      value: 'Foreign surviving fact',
    });
    linkRequestFact(db, 'request-owned-a', 'fact-owned-b');
    insertEvidence(db, documentB, {
      id: '9'.repeat(64),
      workspace_id: 'workspace-a',
      fact_id: 'fact-owned-b',
      request_id: 'request-owned-b',
    });

    const cleanup = db.transaction(() =>
      factStore.deleteWorkspaceFactsInCurrentTransaction('workspace-a'));
    expect(cleanup()).toEqual({
      deletedMembershipCount: 1,
      deletedEvidenceCount: 1,
      deletedFactCount: 0,
    });
    expect(factStore.getFact('fact-owned-b')).not.toBeNull();
    db.close();
  });

  test('revalidates an exact fact revision against active evidence on the active document version', () => {
    const { db, documentStore, factStore } = createFixture();
    const document = createDocument(documentStore, 'workspace-a');
    insertRequest(db, {
      id: 'request-a',
      documentId: document.document.id,
      documentVersionId: document.version.id,
    });
    insertFact(db, { id: 'fact-a', originating_request_id: 'request-a' });
    linkRequestFact(db, 'request-a', 'fact-a');
    insertEvidence(db, document, {
      fact_id: 'fact-a',
      request_id: 'request-a',
    });

    const read = db.transaction((requireActiveCurrentEvidence: boolean) =>
      factStore.getReviewFactInCurrentTransaction({
        factId: 'fact-a',
        expectedRevision: 1,
        requireActiveCurrentEvidence,
      }));
    expect(read(true)).toMatchObject({ id: 'fact-a', revision: 1 });

    const expectCode = (
      code: typeof KnowledgeBaseErrorCode.FactRevisionConflict |
        typeof KnowledgeBaseErrorCode.FactEvidenceStale,
      operation: () => unknown,
    ): void => {
      let thrown: unknown;
      try {
        operation();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(KnowledgeFactStateError);
      expect(thrown).toMatchObject({ code });
      expect(thrown).not.toHaveProperty('stack');
      expect(JSON.stringify(thrown)).not.toContain('builds industrial robots');
    };

    expectCode(KnowledgeBaseErrorCode.FactRevisionConflict, () =>
      db.transaction(() => factStore.getReviewFactInCurrentTransaction({
        factId: 'fact-a',
        expectedRevision: 2,
        requireActiveCurrentEvidence: true,
      }))());

    db.prepare(`
      UPDATE knowledge_documents
      SET deleted_at = ?
      WHERE id = ?
    `).run(NOW_2, document.document.id);
    expectCode(KnowledgeBaseErrorCode.FactEvidenceStale, () => read(true));
    expect(read(false)).toMatchObject({ id: 'fact-a' });

    db.prepare(`
      UPDATE knowledge_documents
      SET deleted_at = NULL, current_version_id = 'replacement-version'
      WHERE id = ?
    `).run(document.document.id);
    expectCode(KnowledgeBaseErrorCode.FactEvidenceStale, () => read(true));
    db.prepare(`
      UPDATE knowledge_documents
      SET current_version_id = ?
      WHERE id = ?
    `).run(document.version.id, document.document.id);
    db.prepare(`
      UPDATE knowledge_fact_evidence
      SET stale_at = ?
      WHERE fact_id = 'fact-a'
    `).run(NOW_2);
    expectCode(KnowledgeBaseErrorCode.FactEvidenceStale, () => read(true));
    db.close();
  });

  test('applies exact review/archive transitions and completes linked review requests in the caller transaction', () => {
    const { db, documentStore, factStore, requestStore } = createFixture();
    const document = createDocument(documentStore, 'workspace-a');
    const rejectDocument = createDocument(
      documentStore,
      'workspace-a',
      'A second document supplies rejection evidence.',
    );
    insertRequest(db, {
      id: 'request-confirm',
      documentId: document.document.id,
      documentVersionId: document.version.id,
    });
    insertRequest(db, {
      id: 'request-reject',
      documentId: rejectDocument.document.id,
      documentVersionId: rejectDocument.version.id,
    });
    insertFact(db, {
      id: 'fact-confirm',
      originating_request_id: 'request-confirm',
      value: 'Confirm me',
    });
    insertFact(db, {
      id: 'fact-reject',
      originating_request_id: 'request-reject',
      value: 'Reject me',
    });
    linkRequestFact(db, 'request-confirm', 'fact-confirm');
    linkRequestFact(db, 'request-reject', 'fact-reject');
    insertEvidence(db, document, {
      id: '2'.repeat(64),
      fact_id: 'fact-confirm',
      request_id: 'request-confirm',
    });
    insertEvidence(db, rejectDocument, {
      id: '3'.repeat(64),
      fact_id: 'fact-reject',
      request_id: 'request-reject',
    });

    const apply = db.transaction(() => {
      const confirmed = factStore.confirmFactInCurrentTransaction({
        factId: 'fact-confirm',
        expectedRevision: 1,
        conflictGroupKey: 'workspace-a\0productList\0confirm me',
        now: NOW_2,
      });
      const completedConfirmRequests = factStore
        .recalculateLinkedRequestsInCurrentTransaction('fact-confirm', NOW_2);
      const rejected = factStore.rejectFactInCurrentTransaction({
        factId: 'fact-reject',
        expectedRevision: 1,
        now: NOW_2,
      });
      const completedRejectRequests = factStore
        .recalculateLinkedRequestsInCurrentTransaction('fact-reject', NOW_2);
      const archived = factStore.archiveFactInCurrentTransaction({
        factId: 'fact-confirm',
        expectedRevision: 2,
        projectionState: KnowledgeFactProjectionState.Reversed,
        now: NOW_3,
      });
      return {
        archived,
        completedConfirmRequests,
        completedRejectRequests,
        confirmed,
        rejected,
      };
    });
    const result = apply();
    expect(result.confirmed).toMatchObject({
      reviewStatus: KnowledgeFactReviewStatus.Confirmed,
      projectionState: KnowledgeFactProjectionState.Active,
      revision: 2,
      reviewedAt: NOW_2,
      updatedAt: NOW_2,
    });
    expect(result.rejected).toMatchObject({
      reviewStatus: KnowledgeFactReviewStatus.Rejected,
      projectionState: KnowledgeFactProjectionState.None,
      revision: 2,
      reviewedAt: NOW_2,
      updatedAt: NOW_2,
    });
    expect(result.archived).toMatchObject({
      id: 'fact-confirm',
      reviewStatus: KnowledgeFactReviewStatus.Confirmed,
      projectionState: KnowledgeFactProjectionState.Reversed,
      revision: 3,
      tombstonedAt: NOW_3,
      updatedAt: NOW_3,
    });
    expect(result.completedConfirmRequests).toBe(1);
    expect(result.completedRejectRequests).toBe(1);
    expect(requestStore.getSummary('request-confirm')?.status)
      .toBe(KnowledgeEnrichmentStatus.Completed);
    expect(requestStore.getSummary('request-reject')?.status)
      .toBe(KnowledgeEnrichmentStatus.Completed);

    expect(() => db.transaction(() => factStore.confirmFactInCurrentTransaction({
      factId: 'fact-confirm',
      expectedRevision: 2,
      conflictGroupKey: 'workspace-a\0productList\0confirm me',
      now: NOW_3,
    }))()).toThrow(KnowledgeFactStateError);
    db.close();
  });
});
