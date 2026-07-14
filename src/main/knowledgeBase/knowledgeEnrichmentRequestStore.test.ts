import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  KNOWLEDGE_ENRICHMENT_SAFE_ERROR_MAX_CHARS,
  KnowledgeBaseErrorCode,
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
import { applySqliteConnectionPolicy } from '../libs/sqliteConnectionPolicy';
import { runTransientSqliteWriteTransaction } from '../libs/sqliteTransactionRetry';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';
import {
  KnowledgeEnrichmentRequestStateError,
  KnowledgeEnrichmentRequestStore,
  KnowledgeEnrichmentRevisionConflictError,
} from './knowledgeEnrichmentRequestStore';
import type {
  CreateAuthorizedEnrichmentRequestInput,
  EmptyCompletionCounts,
  KnowledgeEnrichmentRequest,
} from './knowledgeEnrichmentTypes';
import { KnowledgeFactStore } from './knowledgeFactStore';

const NOW_1 = '2026-07-12T01:00:00.000Z';
const NOW_2 = '2026-07-12T01:01:00.000Z';
const NOW_3 = '2026-07-12T01:02:00.000Z';
const NOW_4 = '2026-07-12T01:03:00.000Z';
const ROUTING_FINGERPRINT = 'a'.repeat(64);
const OTHER_ROUTING_FINGERPRINT = 'b'.repeat(64);

let rawRequestCounter = 0;
let rawAttemptCounter = 0;
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop()!, { force: true, recursive: true });
  }
});

const authorizedInput = (
  overrides: Partial<CreateAuthorizedEnrichmentRequestInput> = {},
): CreateAuthorizedEnrichmentRequestInput => ({
  workspaceId: 'workspace-a',
  documentId: 'document-a',
  documentVersionId: 'version-a',
  providerId: 'provider-a',
  modelId: 'model-a',
  routingFingerprint: ROUTING_FINGERPRINT,
  now: NOW_1,
  ...overrides,
});

const createMemoryFixture = (
  options: {
    uuidPrefix?: string;
    clock?: () => string;
    afterSelect?: () => void;
  } = {},
) => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  let uuidCounter = 0;
  const store = new KnowledgeEnrichmentRequestStore(db, {
    uuidFactory: () => `${options.uuidPrefix ?? 'generated'}-${++uuidCounter}`,
    clock: options.clock ?? (() => NOW_1),
    afterSelect: options.afterSelect,
  });
  const documentStore = new KnowledgeDocumentStore(db);
  const factStore = new KnowledgeFactStore(db, {
    requestStore: store,
    clock: options.clock ?? (() => NOW_1),
  });
  return { db, documentStore, factStore, store };
};

const initializeTask6FactSchema = (
  db: Database.Database,
  store: KnowledgeEnrichmentRequestStore,
): void => {
  new KnowledgeDocumentStore(db);
  new KnowledgeFactStore(db, { requestStore: store, clock: () => NOW_1 });
};

type RawRequestRow = {
  id: string;
  workspace_id: string;
  document_id: string;
  document_version_id: string;
  status: string;
  consent_mode: string;
  provider_id: string;
  model_id: string;
  routing_fingerprint: string;
  revision: number;
  progress: number;
  attempt_count: number;
  active_attempt_id: string | null;
  error_code: string | null;
  error_message: string | null;
  valid_candidate_count: number;
  discarded_candidate_count: number;
  partial_reasons_json: string;
  requested_at: string;
  started_at: string | null;
  heartbeat_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

const rawRequest = (overrides: Partial<RawRequestRow> = {}): RawRequestRow => ({
  id: `raw-request-${++rawRequestCounter}`,
  workspace_id: 'workspace-a',
  document_id: 'document-a',
  document_version_id: `raw-version-${rawRequestCounter}`,
  status: KnowledgeEnrichmentStatus.Completed,
  consent_mode: 'explicit',
  provider_id: 'provider-a',
  model_id: 'model-a',
  routing_fingerprint: ROUTING_FINGERPRINT,
  revision: 1,
  progress: 100,
  attempt_count: 0,
  active_attempt_id: null,
  error_code: null,
  error_message: null,
  valid_candidate_count: 0,
  discarded_candidate_count: 0,
  partial_reasons_json: '[]',
  requested_at: NOW_1,
  started_at: null,
  heartbeat_at: null,
  completed_at: NOW_2,
  updated_at: NOW_2,
  ...overrides,
});

const insertRawRequest = (
  db: Database.Database,
  overrides: Partial<RawRequestRow> = {},
): RawRequestRow => {
  const row = rawRequest(overrides);
  db.prepare(`
    INSERT INTO knowledge_enrichment_requests (
      id, workspace_id, document_id, document_version_id, status, consent_mode,
      provider_id, model_id, routing_fingerprint, revision, progress, attempt_count,
      active_attempt_id, error_code, error_message, valid_candidate_count,
      discarded_candidate_count, partial_reasons_json, requested_at, started_at,
      heartbeat_at, completed_at, updated_at
    ) VALUES (
      @id, @workspace_id, @document_id, @document_version_id, @status, @consent_mode,
      @provider_id, @model_id, @routing_fingerprint, @revision, @progress, @attempt_count,
      @active_attempt_id, @error_code, @error_message, @valid_candidate_count,
      @discarded_candidate_count, @partial_reasons_json, @requested_at, @started_at,
      @heartbeat_at, @completed_at, @updated_at
    )
  `).run(row);
  return row;
};

type RawAttemptRow = {
  id: string;
  request_id: string;
  attempt_number: number;
  started_at: string;
  heartbeat_at: string;
  finished_at: string | null;
  outcome: string;
  error_code: string | null;
  error_message: string | null;
};

const rawAttempt = (
  requestId: string,
  overrides: Partial<RawAttemptRow> = {},
): RawAttemptRow => ({
  id: `raw-attempt-${++rawAttemptCounter}`,
  request_id: requestId,
  attempt_number: 1,
  started_at: NOW_1,
  heartbeat_at: NOW_1,
  finished_at: null,
  outcome: KnowledgeEnrichmentAttemptOutcome.Running,
  error_code: null,
  error_message: null,
  ...overrides,
});

const insertRawAttempt = (
  db: Database.Database,
  requestId: string,
  overrides: Partial<RawAttemptRow> = {},
): RawAttemptRow => {
  const row = rawAttempt(requestId, overrides);
  db.prepare(`
    INSERT INTO knowledge_enrichment_attempts (
      id, request_id, attempt_number, started_at, heartbeat_at,
      finished_at, outcome, error_code, error_message
    ) VALUES (
      @id, @request_id, @attempt_number, @started_at, @heartbeat_at,
      @finished_at, @outcome, @error_code, @error_message
    )
  `).run(row);
  return row;
};

const failNewRequest = (
  store: KnowledgeEnrichmentRequestStore,
  input: CreateAuthorizedEnrichmentRequestInput = authorizedInput(),
): KnowledgeEnrichmentRequest => {
  const request = store.createOrGetAuthorizedRequest(input);
  const claim = store.claimNext(NOW_2)!;
  expect(claim.request.id).toBe(request.id);
  expect(store.failAttempt(request.id, claim.attempt.id, {
    code: KnowledgeBaseErrorCode.ModelRequestFailed,
    now: NOW_3,
  })).toBe(true);
  return store.getRequest(request.id)!;
};

const expectStateCode = (
  operation: () => unknown,
  code: string,
): KnowledgeEnrichmentRequestStateError => {
  let thrown: unknown = null;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(KnowledgeEnrichmentRequestStateError);
  expect(thrown).toMatchObject({ code, message: code });
  expect(thrown).not.toHaveProperty('cause');
  expect(thrown).not.toHaveProperty('stack');
  return thrown as KnowledgeEnrichmentRequestStateError;
};

const createWalConnections = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-enrichment-wal-'));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, 'knowledge.sqlite');
  const dbA = new Database(databasePath);
  const dbB = new Database(databasePath);
  applySqliteConnectionPolicy(dbA);
  applySqliteConnectionPolicy(dbB);
  dbA.pragma('busy_timeout = 0');
  dbB.pragma('busy_timeout = 0');
  return { dbA, dbB };
};

describe('KnowledgeEnrichmentRequestStore schema and mapping', () => {
  test('creates the request and attempt tables with every required index', () => {
    const { db } = createMemoryFixture();
    const schema = new Map(
      (db.prepare(`
        SELECT name, sql
        FROM sqlite_master
        WHERE name IN (
          'knowledge_enrichment_requests',
          'knowledge_enrichment_attempts',
          'idx_knowledge_enrichment_attempts_request',
          'idx_knowledge_enrichment_failed_route',
          'idx_knowledge_enrichment_one_active_version',
          'idx_knowledge_enrichment_one_running_attempt',
          'idx_knowledge_enrichment_queue',
          'idx_knowledge_enrichment_workspace_latest'
        )
      `).all() as Array<{ name: string; sql: string }>).map(row => [row.name, row.sql]),
    );

    expect([...schema.keys()].sort()).toEqual([
      'knowledge_enrichment_attempts',
      'knowledge_enrichment_requests',
    ].concat([
      'idx_knowledge_enrichment_attempts_request',
      'idx_knowledge_enrichment_failed_route',
      'idx_knowledge_enrichment_one_active_version',
      'idx_knowledge_enrichment_one_running_attempt',
      'idx_knowledge_enrichment_queue',
      'idx_knowledge_enrichment_workspace_latest',
    ]).sort());
    const requestSql = schema.get('knowledge_enrichment_requests')!;
    const attemptSql = schema.get('knowledge_enrichment_attempts')!;
    expect(requestSql).toContain("TYPEOF(revision) = 'integer'");
    expect(requestSql).toContain("TYPEOF(progress) = 'integer'");
    expect(requestSql).toContain("TYPEOF(attempt_count) = 'integer'");
    expect(requestSql).toContain('LENGTH(routing_fingerprint) = 64');
    expect(requestSql).toContain("routing_fingerprint NOT GLOB '*[^0-9a-f]*'");
    expect(requestSql).toContain('JSON_VALID(partial_reasons_json)');
    expect(requestSql).toContain("JSON_TYPE(partial_reasons_json) = 'array'");
    expect(requestSql).toContain("status = 'running' AND active_attempt_id IS NOT NULL");
    expect(attemptSql).toContain("TYPEOF(attempt_number) = 'integer'");
    expect(attemptSql).toContain("outcome = 'running' AND finished_at IS NULL");
    expect(attemptSql).toContain('FOREIGN KEY(request_id)');
    db.close();
  });

  test('uses the partial active index and workspace-latest index without a temp sort', () => {
    const { db, store } = createMemoryFixture();
    const preparedSql: string[] = [];
    const originalPrepare = db.prepare.bind(db);
    Object.defineProperty(db, 'prepare', {
      configurable: true,
      value: (source: string) => {
        preparedSql.push(source);
        return originalPrepare(source);
      },
    });
    try {
      store.createOrGetAuthorizedRequest(authorizedInput());
    } finally {
      Object.defineProperty(db, 'prepare', {
        configurable: true,
        value: originalPrepare,
      });
    }

    const activeSql = preparedSql.find(source =>
      source.includes('request.document_version_id = ?') &&
      source.includes('request.status IN'),
    );
    const latestSql = preparedSql.find(source =>
      source.includes('request.workspace_id = ?') &&
      source.includes('request.document_version_id = ?') &&
      source.includes('ORDER BY request.requested_at DESC'));
    expect(activeSql).toBeDefined();
    expect(latestSql).toBeDefined();
    expect(activeSql?.match(/\?/g)).toHaveLength(1);
    expect(latestSql?.match(/\?/g)).toHaveLength(2);

    const activePlan = db.prepare(`EXPLAIN QUERY PLAN ${activeSql}`).all(
      'version-a',
    ) as Array<{ detail: string }>;
    const latestPlan = db.prepare(`EXPLAIN QUERY PLAN ${latestSql}`).all(
      'workspace-a',
      'version-a',
    ) as Array<{ detail: string }>;
    const activeDetails = activePlan.map(row => row.detail).join('\n');
    const latestDetails = latestPlan.map(row => row.detail).join('\n');
    expect(activeDetails).toContain('idx_knowledge_enrichment_one_active_version');
    expect(activeDetails).not.toContain('USE TEMP B-TREE');
    expect(latestDetails).toContain('idx_knowledge_enrichment_workspace_latest');
    expect(latestDetails).not.toContain('USE TEMP B-TREE');
    db.close();
  });

  test('uses the active-version partial index for version invalidation without a temp sort', () => {
    const { db, store } = createMemoryFixture();
    const preparedSql: string[] = [];
    const originalPrepare = db.prepare.bind(db);
    Object.defineProperty(db, 'prepare', {
      configurable: true,
      value: (source: string) => {
        preparedSql.push(source);
        return originalPrepare(source);
      },
    });
    try {
      expect(store.markVersionStale('missing-version', NOW_2)).toBe(0);
    } finally {
      Object.defineProperty(db, 'prepare', {
        configurable: true,
        value: originalPrepare,
      });
    }

    const staleSelectSql = preparedSql.find(source =>
      source.includes('SELECT id, revision, status, active_attempt_id') &&
      source.includes('document_version_id = ?') &&
      source.includes('status IN'));
    expect(staleSelectSql).toBeDefined();
    const placeholderCount = staleSelectSql?.match(/\?/g)?.length ?? 0;
    const bindings = placeholderCount === 1
      ? ['missing-version']
      : [
          'missing-version',
          KnowledgeEnrichmentStatus.Queued,
          KnowledgeEnrichmentStatus.Running,
          KnowledgeEnrichmentStatus.ReviewRequired,
        ];
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${staleSelectSql}`).all(...bindings) as
      Array<{ detail: string }>;
    const details = plan.map(row => row.detail).join('\n');
    expect(placeholderCount).toBe(1);
    expect(details).toContain('idx_knowledge_enrichment_one_active_version');
    expect(details).not.toContain('USE TEMP B-TREE');
    db.close();
  });

  test('enforces exact request integer, fingerprint, JSON, active, and error constraints', () => {
    const { db } = createMemoryFixture();
    const invalidRows: Array<Partial<RawRequestRow>> = [
      { id: '   ' },
      { workspace_id: '' },
      { document_id: '' },
      { document_version_id: '' },
      { status: 'secret-status' },
      { consent_mode: 'implicit' },
      { routing_fingerprint: 'a'.repeat(63) },
      { routing_fingerprint: 'A'.repeat(64) },
      { revision: 0 },
      { revision: 1.5 },
      { progress: -1 },
      { progress: 101 },
      { progress: 1.5 },
      { attempt_count: -1 },
      { attempt_count: 1.5 },
      { status: KnowledgeEnrichmentStatus.Running, active_attempt_id: null },
      { status: KnowledgeEnrichmentStatus.Queued, active_attempt_id: 'attempt-a' },
      { error_message: 'x'.repeat(KNOWLEDGE_ENRICHMENT_SAFE_ERROR_MAX_CHARS + 1) },
      { valid_candidate_count: -1 },
      { valid_candidate_count: 1.5 },
      { discarded_candidate_count: -1 },
      { discarded_candidate_count: 1.5 },
      { partial_reasons_json: 'not-json' },
      { partial_reasons_json: '{}' },
    ];
    invalidRows.forEach(overrides => {
      expect(() => insertRawRequest(db, overrides)).toThrow();
    });
    db.close();
  });

  test('enforces active-version uniqueness for queued, running, and review-required rows', () => {
    const { db } = createMemoryFixture();
    for (const [index, status] of [
      KnowledgeEnrichmentStatus.Queued,
      KnowledgeEnrichmentStatus.Running,
      KnowledgeEnrichmentStatus.ReviewRequired,
    ].entries()) {
      const versionId = `active-version-${index}`;
      insertRawRequest(db, {
        document_version_id: versionId,
        status,
        active_attempt_id: status === KnowledgeEnrichmentStatus.Running
          ? `running-${index}`
          : null,
        progress: 0,
        completed_at: null,
      });
      expect(() => insertRawRequest(db, {
        document_version_id: versionId,
        status: KnowledgeEnrichmentStatus.Queued,
        progress: 0,
        completed_at: null,
      })).toThrow();
    }
    db.close();
  });

  test('enforces attempt integer, uniqueness, foreign-key, error, and terminal constraints', () => {
    const { db } = createMemoryFixture();
    const request = insertRawRequest(db);
    const invalidAttempts: Array<Partial<RawAttemptRow>> = [
      { id: '' },
      { request_id: '' },
      { request_id: 'missing-request' },
      { attempt_number: 0 },
      { attempt_number: 1.5 },
      { outcome: 'secret-outcome' },
      { outcome: KnowledgeEnrichmentAttemptOutcome.Running, finished_at: NOW_2 },
      { outcome: KnowledgeEnrichmentAttemptOutcome.Completed, finished_at: null },
      { error_message: 'x'.repeat(KNOWLEDGE_ENRICHMENT_SAFE_ERROR_MAX_CHARS + 1) },
    ];
    invalidAttempts.forEach(overrides => {
      expect(() => insertRawAttempt(db, request.id, overrides)).toThrow();
    });

    const first = insertRawAttempt(db, request.id);
    expect(() => insertRawAttempt(db, request.id, { attempt_number: 1 })).toThrow();
    expect(() => insertRawAttempt(db, request.id, { attempt_number: 2 })).toThrow();
    db.prepare(`
      UPDATE knowledge_enrichment_attempts
      SET outcome = ?, finished_at = ?
      WHERE id = ?
    `).run(KnowledgeEnrichmentAttemptOutcome.Failed, NOW_2, first.id);
    expect(() => insertRawAttempt(db, request.id, { attempt_number: 2 })).not.toThrow();
    db.close();
  });

  test('maps every request column and emits one display-safe summary', () => {
    const { db, store } = createMemoryFixture();
    const request = store.createOrGetAuthorizedRequest(authorizedInput());

    expect(request).toEqual({
      id: 'generated-1',
      workspaceId: 'workspace-a',
      documentId: 'document-a',
      documentVersionId: 'version-a',
      status: KnowledgeEnrichmentStatus.Queued,
      consentMode: 'explicit',
      providerId: 'provider-a',
      modelId: 'model-a',
      routingFingerprint: ROUTING_FINGERPRINT,
      revision: 1,
      progress: 0,
      attemptCount: 0,
      activeAttemptId: null,
      errorCode: null,
      errorMessage: null,
      validCandidateCount: 0,
      discardedCandidateCount: 0,
      partialReasons: [],
      requestedAt: NOW_1,
      startedAt: null,
      heartbeatAt: null,
      completedAt: null,
      updatedAt: NOW_1,
    });
    expect(store.getRequest(request.id)).toEqual(request);
    expect(store.getActiveRequestForVersion(request.documentVersionId)).toEqual(request);
    const summary = store.listWorkspaceSummaries('workspace-a')[0];
    expect(summary).toEqual({
      requestId: request.id,
      documentId: request.documentId,
      documentVersionId: request.documentVersionId,
      status: request.status,
      progress: 0,
      revision: 1,
      attemptCount: 0,
      validCandidateCount: 0,
      discardedCandidateCount: 0,
      pendingFactCount: 0,
      partialReasons: [],
      errorCode: null,
      createdAt: NOW_1,
      updatedAt: NOW_1,
      completedAt: null,
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('provider-a');
    expect(serialized).not.toContain('model-a');
    expect(serialized).not.toContain(ROUTING_FINGERPRINT);
    expect(serialized).not.toContain('errorMessage');
    const persistedColumns = (db.pragma(
      'table_info(knowledge_enrichment_requests)',
    ) as Array<{ name: string }>).map(column => column.name);
    expect(persistedColumns).not.toContain('api_key');
    expect(persistedColumns).not.toContain('base_url');
    expect(persistedColumns).not.toContain('endpoint');
    db.close();
  });

  test('ignores runtime credential and endpoint fields instead of persisting them', () => {
    const { db, store } = createMemoryFixture();
    const secretSentinels = {
      apiKey: 'secret-api-key-sentinel',
      baseUrl: 'https://secret-base-url.example/v1',
      endpoint: 'https://secret-endpoint.example/models',
    };
    const request = store.createOrGetAuthorizedRequest({
      ...authorizedInput(),
      ...secretSentinels,
    } as CreateAuthorizedEnrichmentRequestInput);
    const rawRow = db.prepare(`
      SELECT *
      FROM knowledge_enrichment_requests
      WHERE id = ?
    `).get(request.id);
    const serializedRow = JSON.stringify(rawRow);
    for (const sentinel of Object.values(secretSentinels)) {
      expect(serializedRow).not.toContain(sentinel);
    }
    expect(Object.keys(rawRow as object)).not.toEqual(
      expect.arrayContaining(['api_key', 'base_url', 'endpoint']),
    );
    db.close();
  });

  test('returns a single request only through the safe summary mapper', () => {
    const { db, store } = createMemoryFixture();
    const providerSentinel = 'provider-secret-summary-sentinel';
    const fingerprintSentinel = OTHER_ROUTING_FINGERPRINT;
    const row = insertRawRequest(db, {
      status: KnowledgeEnrichmentStatus.Failed,
      provider_id: providerSentinel,
      routing_fingerprint: fingerprintSentinel,
      error_code: KnowledgeBaseErrorCode.ModelRequestFailed,
      error_message: 'Model request failed',
    });

    const summary = store.getSummary(row.id);
    expect(summary).toEqual(store.listWorkspaceSummaries(row.workspace_id)[0]);
    expect(summary).toMatchObject({
      requestId: row.id,
      errorCode: KnowledgeBaseErrorCode.ModelRequestFailed,
      pendingFactCount: 0,
    });
    expect(store.getSummary('missing-request')).toBeNull();
    const serializedSummary = JSON.stringify(summary);
    expect(serializedSummary).not.toContain(providerSentinel);
    expect(serializedSummary).not.toContain(fingerprintSentinel);
    expect(serializedSummary).not.toContain('Model request failed');
    expect(serializedSummary).not.toContain('activeAttemptId');
    expect(serializedSummary).not.toContain('errorMessage');

    const errorSentinel = 'https://secret-provider.example /private/knowledge.sqlite';
    db.prepare(`
      UPDATE knowledge_enrichment_requests
      SET error_message = ?
      WHERE id = ?
    `).run(errorSentinel, row.id);
    const error = expectStateCode(
      () => store.getSummary(row.id),
      KnowledgeBaseErrorCode.JobStateConflict,
    );
    expect(JSON.stringify(error)).not.toContain(errorSentinel);
    db.close();
  });

  test('normalizes persisted partial reasons to centralized order and rejects corruption safely', () => {
    const { db, store } = createMemoryFixture();
    const ordered = insertRawRequest(db, {
      partial_reasons_json: JSON.stringify([
        KnowledgeEnrichmentPartialReason.CandidateLimit,
        KnowledgeEnrichmentPartialReason.ChunkLimit,
      ]),
    });
    expect(store.getRequest(ordered.id)?.partialReasons).toEqual([
      KnowledgeEnrichmentPartialReason.ChunkLimit,
      KnowledgeEnrichmentPartialReason.CandidateLimit,
    ]);

    const corruptValues = [
      JSON.stringify([
        KnowledgeEnrichmentPartialReason.ChunkLimit,
        KnowledgeEnrichmentPartialReason.ChunkLimit,
      ]),
      JSON.stringify(['https://secret-provider.example/v1']),
      'not-json /private/knowledge.sqlite',
    ];
    for (const corruptValue of corruptValues) {
      const row = insertRawRequest(db);
      db.pragma('ignore_check_constraints = ON');
      db.prepare(`
        UPDATE knowledge_enrichment_requests
        SET partial_reasons_json = ?
        WHERE id = ?
      `).run(corruptValue, row.id);
      db.pragma('ignore_check_constraints = OFF');
      const error = expectStateCode(
        () => store.getRequest(row.id),
        KnowledgeBaseErrorCode.JobStateConflict,
      );
      expect(JSON.stringify(error)).not.toContain(corruptValue);
      expect(error.message).not.toContain('JSON');
      expect(error).not.toHaveProperty('cause');
    }
    db.close();
  });

  test('rejects corrupted statuses, routes, integers, timestamps, and error codes with one fixed error', () => {
    const corruptions: Array<{ column: string; value: string | number }> = [
      { column: 'status', value: 'unknown-status' },
      { column: 'consent_mode', value: 'implicit' },
      { column: 'routing_fingerprint', value: 'secret-fingerprint' },
      { column: 'revision', value: 1.5 },
      { column: 'progress', value: 1.5 },
      { column: 'attempt_count', value: 1.5 },
      { column: 'valid_candidate_count', value: 1.5 },
      { column: 'discarded_candidate_count', value: 1.5 },
      { column: 'requested_at', value: '/private/knowledge.sqlite' },
      { column: 'updated_at', value: 'not-a-timestamp' },
      { column: 'error_code', value: 'SQLITE_CONSTRAINT secret-provider' },
    ];
    for (const corruption of corruptions) {
      const { db, store } = createMemoryFixture();
      const row = insertRawRequest(db);
      db.pragma('ignore_check_constraints = ON');
      db.prepare(`UPDATE knowledge_enrichment_requests SET ${corruption.column} = ? WHERE id = ?`)
        .run(corruption.value, row.id);
      db.pragma('ignore_check_constraints = OFF');
      const error = expectStateCode(
        () => store.getRequest(row.id),
        KnowledgeBaseErrorCode.JobStateConflict,
      );
      expect(JSON.stringify(error)).not.toContain(String(corruption.value));
      db.close();
    }
  });

  test('rejects caller-controlled persisted error messages instead of mapping them back out', () => {
    const { db, store } = createMemoryFixture();
    const row = insertRawRequest(db, {
      status: KnowledgeEnrichmentStatus.Failed,
      error_code: KnowledgeBaseErrorCode.ModelRequestFailed,
      error_message: 'https://secret-provider.example /private/knowledge.sqlite',
    });

    const error = expectStateCode(
      () => store.getRequest(row.id),
      KnowledgeBaseErrorCode.JobStateConflict,
    );
    expect(JSON.stringify(error)).not.toContain('secret-provider');
    db.close();
  });

  test('validates every mapped attempt field and hides the corrupted value', () => {
    const corruptions: Array<{ column: string; value: string | number }> = [
      { column: 'attempt_number', value: 1.5 },
      { column: 'started_at', value: '/private/knowledge.sqlite' },
      { column: 'heartbeat_at', value: 'not-a-timestamp' },
      { column: 'finished_at', value: NOW_2 },
      { column: 'outcome', value: 'unknown-outcome' },
      { column: 'error_code', value: 'SQLITE_BUSY secret-provider' },
    ];
    for (const corruption of corruptions) {
      const { db, store } = createMemoryFixture();
      const request = store.createOrGetAuthorizedRequest(authorizedInput());
      const claim = store.claimNext(NOW_2)!;
      db.pragma('ignore_check_constraints = ON');
      db.prepare(`UPDATE knowledge_enrichment_attempts SET ${corruption.column} = ? WHERE id = ?`)
        .run(corruption.value, claim.attempt.id);
      db.pragma('ignore_check_constraints = OFF');
      const error = expectStateCode(
        () => store.listAttempts(request.id),
        KnowledgeBaseErrorCode.JobStateConflict,
      );
      expect(JSON.stringify(error)).not.toContain(String(corruption.value));
      db.close();
    }
  });

  test('fails every stable request read closed when the active running attempt is missing or wrong', () => {
    const corruptions: Array<(
      db: Database.Database,
      request: KnowledgeEnrichmentRequest,
      attemptId: string,
    ) => void> = [
      (db, _request, attemptId) => {
        db.prepare('DELETE FROM knowledge_enrichment_attempts WHERE id = ?').run(attemptId);
      },
      (db, _request, attemptId) => {
        db.prepare(`
          UPDATE knowledge_enrichment_attempts
          SET outcome = ?, finished_at = ?
          WHERE id = ?
        `).run(KnowledgeEnrichmentAttemptOutcome.Completed, NOW_3, attemptId);
      },
      (db, request) => {
        db.prepare(`
          UPDATE knowledge_enrichment_requests
          SET active_attempt_id = ?
          WHERE id = ?
        `).run('missing-active-attempt', request.id);
      },
    ];

    for (const corrupt of corruptions) {
      const { db, store } = createMemoryFixture();
      const request = store.createOrGetAuthorizedRequest(authorizedInput());
      const claim = store.claimNext(NOW_2)!;
      corrupt(db, request, claim.attempt.id);
      const stableReads: Array<() => unknown> = [
        () => store.getRequest(request.id),
        () => store.getActiveRequestForVersion(request.documentVersionId),
        () => store.listWorkspaceSummaries(request.workspaceId),
        () => store.listLatestSummariesForVersions(
          request.workspaceId,
          [request.documentVersionId],
        ),
      ];
      for (const stableRead of stableReads) {
        expectStateCode(stableRead, KnowledgeBaseErrorCode.JobStateConflict);
      }
      db.close();
    }
  });
});

describe('KnowledgeEnrichmentRequestStore transitions', () => {
  test('current-transaction authorization primitives report only real queue transitions', () => {
    const { db, store } = createMemoryFixture({ uuidPrefix: 'transition' });
    const retryInput = (requestId: string) => ({
      ...authorizedInput({ now: NOW_4 }),
      requestId,
    });
    expectStateCode(
      () => store.createOrGetAuthorizedRequestInCurrentTransaction(authorizedInput()),
      KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
    );
    expectStateCode(
      () => store.retryFailedWithAuthorizationInCurrentTransaction(
        retryInput('missing-request'),
      ),
      KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
    );

    const createInTransaction = db.transaction(() =>
      store.createOrGetAuthorizedRequestInCurrentTransaction(authorizedInput()));
    const first = createInTransaction();
    expect(first).toMatchObject({
      queuedTransition: true,
      request: {
        id: 'transition-1',
        status: KnowledgeEnrichmentStatus.Queued,
      },
    });
    expect(createInTransaction()).toEqual({
      request: first.request,
      queuedTransition: false,
    });

    const claim = store.claimNext(NOW_2)!;
    expect(createInTransaction()).toEqual({
      request: claim.request,
      queuedTransition: false,
    });
    expect(store.failAttempt(first.request.id, claim.attempt.id, {
      code: KnowledgeBaseErrorCode.ModelRequestFailed,
      now: NOW_3,
    })).toBe(true);
    const failed = store.getRequest(first.request.id)!;
    expect(createInTransaction()).toEqual({
      request: failed,
      queuedTransition: false,
    });

    const retryInTransaction = db.transaction(() =>
      store.retryFailedWithAuthorizationInCurrentTransaction(
        retryInput(first.request.id),
      ));
    const retried = retryInTransaction();
    expect(retried).toMatchObject({
      queuedTransition: true,
      request: {
        id: first.request.id,
        status: KnowledgeEnrichmentStatus.Queued,
        revision: 2,
      },
    });
    expect(retryInTransaction()).toEqual({
      request: retried.request,
      queuedTransition: false,
    });
    db.close();

    const reviewFixture = createMemoryFixture();
    const review = insertRawRequest(reviewFixture.db, {
      id: 'review-transition-request',
      document_version_id: 'version-a',
      status: KnowledgeEnrichmentStatus.ReviewRequired,
      progress: 100,
      completed_at: null,
    });
    const inspectReview = reviewFixture.db.transaction(() => ({
      create: reviewFixture.store.createOrGetAuthorizedRequestInCurrentTransaction(
        authorizedInput(),
      ),
      retry: reviewFixture.store.retryFailedWithAuthorizationInCurrentTransaction({
        ...authorizedInput(),
        requestId: review.id,
      }),
    }));
    const reviewTransitions = inspectReview();
    expect(reviewTransitions.create).toMatchObject({
      queuedTransition: false,
      request: { id: review.id, status: KnowledgeEnrichmentStatus.ReviewRequired },
    });
    expect(reviewTransitions.retry).toEqual(reviewTransitions.create);
    reviewFixture.db.close();
  });

  test('current-transaction primitives never open a nested transaction or retry themselves', () => {
    let afterSelectCount = 0;
    const { db, store } = createMemoryFixture({
      afterSelect: () => {
        afterSelectCount += 1;
      },
    });
    const outer = db.transaction(() =>
      store.createOrGetAuthorizedRequestInCurrentTransaction(authorizedInput()));
    const originalTransaction = db.transaction.bind(db);
    Object.defineProperty(db, 'transaction', {
      configurable: true,
      value: () => {
        throw new Error('nested transaction attempted');
      },
    });
    try {
      expect(outer()).toMatchObject({ queuedTransition: true });
      expect(afterSelectCount).toBe(1);
    } finally {
      Object.defineProperty(db, 'transaction', {
        configurable: true,
        value: originalTransaction,
      });
    }
    db.close();
  });

  test('current-transaction retry also executes once without opening a savepoint', () => {
    let afterSelectCount = 0;
    const { db, store } = createMemoryFixture({
      afterSelect: () => {
        afterSelectCount += 1;
      },
    });
    const failed = failNewRequest(store);
    afterSelectCount = 0;
    const outer = db.transaction(() =>
      store.retryFailedWithAuthorizationInCurrentTransaction({
        ...authorizedInput({ now: NOW_4 }),
        requestId: failed.id,
      }));
    const originalTransaction = db.transaction.bind(db);
    Object.defineProperty(db, 'transaction', {
      configurable: true,
      value: () => {
        throw new Error('nested transaction attempted');
      },
    });
    try {
      expect(outer()).toMatchObject({ queuedTransition: true });
      expect(afterSelectCount).toBe(1);
    } finally {
      Object.defineProperty(db, 'transaction', {
        configurable: true,
        value: originalTransaction,
      });
    }
    db.close();
  });

  test('create constraint loser rereads the queued winner with a false transition', () => {
    let db!: Database.Database;
    let store!: KnowledgeEnrichmentRequestStore;
    let hookEntered = false;
    let innerTransition: ReturnType<KnowledgeEnrichmentRequestStore[
      'createOrGetAuthorizedRequestInCurrentTransaction'
    ]> | null = null;
    ({ db, store } = createMemoryFixture({
      uuidPrefix: 'constraint-race',
      afterSelect: () => {
        if (hookEntered) {
          return;
        }
        hookEntered = true;
        innerTransition = db.transaction(() =>
          store.createOrGetAuthorizedRequestInCurrentTransaction(authorizedInput()))();
      },
    }));

    const outerTransition = db.transaction(() =>
      store.createOrGetAuthorizedRequestInCurrentTransaction(authorizedInput()))();

    expect(innerTransition).toMatchObject({
      queuedTransition: true,
      request: { id: 'constraint-race-1' },
    });
    expect(outerTransition).toEqual({
      request: innerTransition!.request,
      queuedTransition: false,
    });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_enrichment_requests
    `).get()).toEqual({ count: 1 });
    db.close();
  });

  test('retry CAS loser rereads the same queued request without a second revision', () => {
    let db!: Database.Database;
    let store!: KnowledgeEnrichmentRequestStore;
    let raceEnabled = false;
    let hookEntered = false;
    let failed!: KnowledgeEnrichmentRequest;
    let innerTransition: ReturnType<KnowledgeEnrichmentRequestStore[
      'retryFailedWithAuthorizationInCurrentTransaction'
    ]> | null = null;
    ({ db, store } = createMemoryFixture({
      afterSelect: () => {
        if (!raceEnabled || hookEntered) {
          return;
        }
        hookEntered = true;
        innerTransition = db.transaction(() =>
          store.retryFailedWithAuthorizationInCurrentTransaction({
            ...authorizedInput({ now: NOW_4 }),
            requestId: failed.id,
          }))();
      },
    }));
    failed = failNewRequest(store);
    raceEnabled = true;

    const outerTransition = db.transaction(() =>
      store.retryFailedWithAuthorizationInCurrentTransaction({
        ...authorizedInput({ now: NOW_4 }),
        requestId: failed.id,
      }))();

    expect(innerTransition).toMatchObject({
      queuedTransition: true,
      request: { id: failed.id, revision: 2 },
    });
    expect(outerTransition).toEqual({
      request: innerTransition!.request,
      queuedTransition: false,
    });
    expect(store.getRequest(failed.id)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Queued,
      revision: 2,
    });
    db.close();
  });

  test('returns one active request for repeated authorization without revision or attempt changes', () => {
    const { db, store } = createMemoryFixture();
    const first = store.createOrGetAuthorizedRequest(authorizedInput());
    const second = store.createOrGetAuthorizedRequest(authorizedInput({ now: NOW_2 }));

    expect(second).toEqual(first);
    expect(second).toMatchObject({
      status: KnowledgeEnrichmentStatus.Queued,
      revision: 1,
      progress: 0,
      attemptCount: 0,
      requestedAt: NOW_1,
      updatedAt: NOW_1,
    });
    expect(store.listAttempts(first.id)).toEqual([]);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_enrichment_requests
      WHERE document_version_id = ?
    `).get(first.documentVersionId)).toEqual({ count: 1 });
    db.close();
  });

  test('leaves the latest exact-route failure dormant until an authorized retry', () => {
    const { db, store } = createMemoryFixture();
    const failed = failNewRequest(store);
    const ordinaryCreate = store.createOrGetAuthorizedRequest(authorizedInput({ now: NOW_4 }));

    expect(ordinaryCreate).toEqual(failed);
    expect(ordinaryCreate).toMatchObject({
      status: KnowledgeEnrichmentStatus.Failed,
      revision: 1,
      attemptCount: 1,
      updatedAt: NOW_3,
    });
    expect(store.listAttempts(failed.id)).toHaveLength(1);

    const retried = store.retryFailedWithAuthorization({
      ...authorizedInput({ now: NOW_4 }),
      requestId: failed.id,
    });
    expect(retried).toMatchObject({
      id: failed.id,
      status: KnowledgeEnrichmentStatus.Queued,
      revision: 2,
      progress: 0,
      attemptCount: 1,
      activeAttemptId: null,
      errorCode: null,
      errorMessage: null,
      validCandidateCount: 0,
      discardedCandidateCount: 0,
      partialReasons: [],
      requestedAt: NOW_1,
      startedAt: null,
      heartbeatAt: null,
      completedAt: null,
      updatedAt: NOW_4,
    });
    expect(store.listAttempts(failed.id)).toHaveLength(1);
    expect(store.retryFailedWithAuthorization({
      ...authorizedInput({ now: '2026-07-12T01:04:00.000Z' }),
      requestId: failed.id,
    })).toEqual(retried);
    db.close();
  });

  test('creates a new request after route mismatch or the latest terminal audit row', () => {
    const routeFixture = createMemoryFixture({ uuidPrefix: 'route' });
    const failed = failNewRequest(routeFixture.store);
    const changedRoute = routeFixture.store.createOrGetAuthorizedRequest(authorizedInput({
      providerId: 'provider-b',
      modelId: 'model-b',
      routingFingerprint: OTHER_ROUTING_FINGERPRINT,
      now: NOW_4,
    }));
    expect(changedRoute.id).not.toBe(failed.id);
    expect(changedRoute).toMatchObject({
      status: KnowledgeEnrichmentStatus.Queued,
      providerId: 'provider-b',
      requestedAt: NOW_4,
    });
    routeFixture.db.close();

    const terminalKinds = [
      KnowledgeEnrichmentStatus.Completed,
      KnowledgeEnrichmentStatus.Cancelled,
      KnowledgeEnrichmentStatus.Stale,
    ] as const;
    for (const terminalKind of terminalKinds) {
      const { db, store } = createMemoryFixture({ uuidPrefix: terminalKind });
      const initial = store.createOrGetAuthorizedRequest(authorizedInput());
      if (terminalKind === KnowledgeEnrichmentStatus.Completed) {
        const claim = store.claimNext(NOW_2)!;
        expect(store.completeEmpty(initial.id, claim.attempt.id, {
          validCandidateCount: 0,
          discardedCandidateCount: 0,
          partialReasons: [],
          now: NOW_3,
        })).toBe(true);
      } else if (terminalKind === KnowledgeEnrichmentStatus.Cancelled) {
        store.cancel(initial.id, initial.revision, NOW_3);
      } else {
        expect(store.markVersionStale(initial.documentVersionId, NOW_3)).toBe(1);
      }
      const next = store.createOrGetAuthorizedRequest(authorizedInput({ now: NOW_4 }));
      expect(next.id).not.toBe(initial.id);
      expect(next.status).toBe(KnowledgeEnrichmentStatus.Queued);
      expect(next.requestedAt).toBe(NOW_4);
      db.close();
    }
  });

  test('uses only the latest audit row when deciding create and retry eligibility', () => {
    const { db, store } = createMemoryFixture({ uuidPrefix: 'latest' });
    const olderFailed = failNewRequest(store);
    const latestFailed = failNewRequest(store, authorizedInput({
      providerId: 'provider-b',
      modelId: 'model-b',
      routingFingerprint: OTHER_ROUTING_FINGERPRINT,
      now: NOW_4,
    }));

    expectStateCode(
      () => store.retryFailedWithAuthorization({
        ...authorizedInput({ now: '2026-07-12T01:05:00.000Z' }),
        requestId: olderFailed.id,
      }),
      KnowledgeBaseErrorCode.EnrichmentRequestStale,
    );
    expect(store.createOrGetAuthorizedRequest(authorizedInput({
      now: '2026-07-12T01:05:00.000Z',
    }))).toMatchObject({
      status: KnowledgeEnrichmentStatus.Queued,
      requestedAt: '2026-07-12T01:05:00.000Z',
    });
    expect(store.getRequest(latestFailed.id)?.status).toBe(KnowledgeEnrichmentStatus.Failed);
    db.close();
  });

  test('claims by updated-at then id FIFO and creates one atomic running attempt', () => {
    const { db, store } = createMemoryFixture({ uuidPrefix: 'fifo' });
    const later = store.createOrGetAuthorizedRequest(authorizedInput({
      documentId: 'document-later',
      documentVersionId: 'version-later',
      now: NOW_2,
    }));
    const firstTie = store.createOrGetAuthorizedRequest(authorizedInput({
      documentId: 'document-tie-a',
      documentVersionId: 'version-tie-a',
      now: NOW_1,
    }));
    const secondTie = store.createOrGetAuthorizedRequest(authorizedInput({
      documentId: 'document-tie-b',
      documentVersionId: 'version-tie-b',
      now: NOW_1,
    }));

    const firstClaim = store.claimNext(NOW_3)!;
    expect(firstClaim.request.id).toBe(firstTie.id);
    expect(firstClaim.request).toMatchObject({
      status: KnowledgeEnrichmentStatus.Running,
      revision: 1,
      progress: 0,
      attemptCount: 1,
      activeAttemptId: firstClaim.attempt.id,
      startedAt: NOW_3,
      heartbeatAt: NOW_3,
      updatedAt: NOW_3,
    });
    expect(firstClaim.attempt).toEqual({
      id: firstClaim.request.activeAttemptId,
      requestId: firstTie.id,
      attemptNumber: 1,
      startedAt: NOW_3,
      heartbeatAt: NOW_3,
      finishedAt: null,
      outcome: KnowledgeEnrichmentAttemptOutcome.Running,
      errorCode: null,
      errorMessage: null,
    });
    const secondClaim = store.claimNext(NOW_4)!;
    expect(secondClaim.request.id).toBe(secondTie.id);
    expect(store.claimNext('2026-07-12T01:04:00.000Z')?.request.id).toBe(later.id);
    expect(store.listAttempts(firstTie.id)).toEqual([firstClaim.attempt]);
    db.close();
  });

  test('rereads the complete request-attempt relationship after claim insertion and rolls back corruption', () => {
    const { db, store } = createMemoryFixture();
    const request = store.createOrGetAuthorizedRequest(authorizedInput());
    db.exec(`
      CREATE TRIGGER corrupt_claim_attempt_after_insert
      AFTER INSERT ON knowledge_enrichment_attempts
      BEGIN
        UPDATE knowledge_enrichment_attempts
        SET
          outcome = '${KnowledgeEnrichmentAttemptOutcome.Completed}',
          finished_at = '${NOW_3}'
        WHERE id = NEW.id;
      END;
    `);

    expectStateCode(
      () => store.claimNext(NOW_2),
      KnowledgeBaseErrorCode.JobStateConflict,
    );
    expect(store.getRequest(request.id)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Queued,
      activeAttemptId: null,
      attemptCount: 0,
    });
    expect(store.listAttempts(request.id)).toEqual([]);
    db.close();
  });

  test('heartbeats both rows with monotonic integer progress and no revision change', () => {
    const { db, store } = createMemoryFixture();
    const request = store.createOrGetAuthorizedRequest(authorizedInput());
    const claim = store.claimNext(NOW_2)!;

    for (const invalidProgress of [-1, 101, 1.5, Number.NaN]) {
      expectStateCode(
        () => store.heartbeat(request.id, claim.attempt.id, invalidProgress, NOW_3),
        KnowledgeBaseErrorCode.InvalidRequest,
      );
    }
    expect(store.heartbeat(request.id, claim.attempt.id, 60, NOW_3)).toBe(true);
    expect(store.heartbeat(request.id, claim.attempt.id, 40, NOW_4)).toBe(true);
    expect(store.getRequest(request.id)).toMatchObject({
      progress: 60,
      revision: 1,
      heartbeatAt: NOW_4,
      updatedAt: NOW_4,
    });
    expect(store.listAttempts(request.id)[0]).toMatchObject({ heartbeatAt: NOW_4 });
    db.close();
  });

  test('completes only an empty result with no reason or exactly chunk-limit', () => {
    const { db, store } = createMemoryFixture();
    const request = store.createOrGetAuthorizedRequest(authorizedInput());
    const claim = store.claimNext(NOW_2)!;
    const invalidCounts = {
      validCandidateCount: 1,
      discardedCandidateCount: 0,
      partialReasons: [],
      now: NOW_3,
    } as unknown as EmptyCompletionCounts;
    expectStateCode(
      () => store.completeEmpty(request.id, claim.attempt.id, invalidCounts),
      KnowledgeBaseErrorCode.InvalidRequest,
    );
    expectStateCode(
      () => store.completeEmpty(request.id, claim.attempt.id, {
        validCandidateCount: 0,
        discardedCandidateCount: 0,
        partialReasons: [KnowledgeEnrichmentPartialReason.CandidateLimit],
        now: NOW_3,
      }),
      KnowledgeBaseErrorCode.InvalidRequest,
    );
    expect(store.completeEmpty(request.id, claim.attempt.id, {
      validCandidateCount: 0,
      discardedCandidateCount: 0,
      partialReasons: [KnowledgeEnrichmentPartialReason.ChunkLimit],
      now: NOW_3,
    })).toBe(true);
    expect(store.getRequest(request.id)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Completed,
      progress: 100,
      revision: 1,
      attemptCount: 1,
      activeAttemptId: null,
      heartbeatAt: null,
      validCandidateCount: 0,
      discardedCandidateCount: 0,
      partialReasons: [KnowledgeEnrichmentPartialReason.ChunkLimit],
      updatedAt: NOW_3,
      completedAt: NOW_3,
    });
    expect(store.listAttempts(request.id)[0]).toMatchObject({
      outcome: KnowledgeEnrichmentAttemptOutcome.Completed,
      finishedAt: NOW_3,
    });
    db.close();
  });

  test('persists only bounded fixed messages for every safe failure code', () => {
    const { db, store } = createMemoryFixture({ uuidPrefix: 'failure' });
    const safeCodes = [
      KnowledgeBaseErrorCode.ModelConfigurationUnavailable,
      KnowledgeBaseErrorCode.ModelConfigurationChanged,
      KnowledgeBaseErrorCode.UnsupportedModelProvider,
      KnowledgeBaseErrorCode.ModelRequestFailed,
      KnowledgeBaseErrorCode.ModelRequestTimeout,
      KnowledgeBaseErrorCode.InvalidModelResponse,
      KnowledgeBaseErrorCode.EvidenceValidationFailed,
      KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
      KnowledgeBaseErrorCode.AuthorizationRequired,
    ];
    safeCodes.forEach((code, index) => {
      const request = store.createOrGetAuthorizedRequest(authorizedInput({
        documentId: `failure-document-${index}`,
        documentVersionId: `failure-version-${index}`,
        now: `2026-07-12T02:${String(index).padStart(2, '0')}:00.000Z`,
      }));
      const claim = store.claimNext(`2026-07-12T03:${String(index).padStart(2, '0')}:00.000Z`)!;
      expect(claim.request.id).toBe(request.id);
      expect(store.heartbeat(request.id, claim.attempt.id, 37, NOW_2)).toBe(true);
      expect(store.failAttempt(request.id, claim.attempt.id, { code, now: NOW_3 })).toBe(true);
      const failed = store.getRequest(request.id)!;
      const attempt = store.listAttempts(request.id)[0];
      expect(failed).toMatchObject({
        status: KnowledgeEnrichmentStatus.Failed,
        progress: 37,
        revision: 1,
        attemptCount: 1,
        activeAttemptId: null,
        heartbeatAt: null,
        errorCode: code,
        updatedAt: NOW_3,
        completedAt: NOW_3,
      });
      expect(failed.errorMessage).toBe(attempt.errorMessage);
      expect(failed.errorMessage).toBeTruthy();
      expect(failed.errorMessage!.length).toBeLessThanOrEqual(
        KNOWLEDGE_ENRICHMENT_SAFE_ERROR_MAX_CHARS,
      );
      expect(attempt).toMatchObject({
        outcome: KnowledgeEnrichmentAttemptOutcome.Failed,
        errorCode: code,
        finishedAt: NOW_3,
      });
      const serialized = JSON.stringify({ failed, attempt });
      expect(serialized).not.toContain('https://');
      expect(serialized).not.toContain('/private/');
      expect(serialized).not.toContain('SQLITE_');
    });
    db.close();
  });

  test('rolls back the attempt update when the request failure transition is rejected', () => {
    const { db, store } = createMemoryFixture();
    const request = store.createOrGetAuthorizedRequest(authorizedInput());
    const claim = store.claimNext(NOW_2)!;
    db.exec(`
      CREATE TRIGGER reject_request_failure
      BEFORE UPDATE OF status ON knowledge_enrichment_requests
      WHEN
        OLD.status = '${KnowledgeEnrichmentStatus.Running}'
        AND NEW.status = '${KnowledgeEnrichmentStatus.Failed}'
      BEGIN
        SELECT RAISE(ABORT, 'request failure rejected');
      END;
    `);

    expectStateCode(
      () => store.failAttempt(request.id, claim.attempt.id, {
        code: KnowledgeBaseErrorCode.ModelRequestFailed,
        now: NOW_3,
      }),
      KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
    );
    expect(store.getRequest(request.id)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Running,
      activeAttemptId: claim.attempt.id,
      errorCode: null,
      completedAt: null,
    });
    expect(store.listAttempts(request.id)[0]).toMatchObject({
      outcome: KnowledgeEnrichmentAttemptOutcome.Running,
      finishedAt: null,
      errorCode: null,
    });
    db.close();
  });

  test('rejects prototype and unknown failure codes before persistence', () => {
    const { db, store } = createMemoryFixture();
    const request = store.createOrGetAuthorizedRequest(authorizedInput());
    const claim = store.claimNext(NOW_2)!;
    const invalidFailures = [
      { code: 'toString', now: NOW_3 },
      { code: 'SQLITE_BUSY /private/secret.sqlite', now: NOW_3 },
    ];

    for (const invalidFailure of invalidFailures) {
      expectStateCode(
        () => store.failAttempt(
          request.id,
          claim.attempt.id,
          invalidFailure as Parameters<KnowledgeEnrichmentRequestStore['failAttempt']>[2],
        ),
        KnowledgeBaseErrorCode.InvalidRequest,
      );
    }
    expect(store.getRequest(request.id)?.status).toBe(KnowledgeEnrichmentStatus.Running);
    expect(store.listAttempts(request.id)[0].outcome).toBe(
      KnowledgeEnrichmentAttemptOutcome.Running,
    );
    db.close();
  });

  test('cancels queued or running work in one revisioned transition', () => {
    const queuedFixture = createMemoryFixture({ uuidPrefix: 'queued-cancel' });
    const queued = queuedFixture.store.createOrGetAuthorizedRequest(authorizedInput());
    expect(queuedFixture.store.cancel(queued.id, 1, NOW_2)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Cancelled,
      revision: 2,
      progress: 0,
      attemptCount: 0,
      activeAttemptId: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: NOW_2,
      completedAt: NOW_2,
    });
    queuedFixture.db.close();

    const runningFixture = createMemoryFixture({ uuidPrefix: 'running-cancel' });
    const running = runningFixture.store.createOrGetAuthorizedRequest(authorizedInput());
    const claim = runningFixture.store.claimNext(NOW_2)!;
    runningFixture.store.heartbeat(running.id, claim.attempt.id, 41, NOW_3);
    const cancelled = runningFixture.store.cancel(running.id, 1, NOW_4);
    expect(cancelled).toMatchObject({
      status: KnowledgeEnrichmentStatus.Cancelled,
      revision: 2,
      progress: 41,
      attemptCount: 1,
      activeAttemptId: null,
      heartbeatAt: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: NOW_4,
      completedAt: NOW_4,
    });
    expect(runningFixture.store.listAttempts(running.id)[0]).toMatchObject({
      outcome: KnowledgeEnrichmentAttemptOutcome.Cancelled,
      finishedAt: NOW_4,
      errorCode: null,
      errorMessage: null,
    });
    runningFixture.db.close();
  });

  test('prioritizes revision conflict over terminal state and exposes only a safe latest summary', () => {
    const { db, store } = createMemoryFixture();
    const request = store.createOrGetAuthorizedRequest(authorizedInput());
    store.cancel(request.id, 1, NOW_2);

    let conflict: unknown = null;
    try {
      store.cancel(request.id, 1, NOW_3);
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(KnowledgeEnrichmentRevisionConflictError);
    expect(conflict).not.toHaveProperty('cause');
    expect(conflict).not.toHaveProperty('stack');
    expect(conflict).toMatchObject({
      code: KnowledgeBaseErrorCode.RevisionConflict,
      message: KnowledgeBaseErrorCode.RevisionConflict,
      latestSummary: {
        requestId: request.id,
        status: KnowledgeEnrichmentStatus.Cancelled,
        revision: 2,
        pendingFactCount: 0,
      },
    });
    const serialized = JSON.stringify(conflict);
    expect(serialized).not.toContain('provider-a');
    expect(serialized).not.toContain(ROUTING_FINGERPRINT);
    expect(serialized).not.toContain('errorMessage');

    expectStateCode(
      () => store.cancel(request.id, 2, NOW_3),
      KnowledgeBaseErrorCode.JobStateConflict,
    );
    expectStateCode(
      () => store.cancel('missing-request', 1, NOW_3),
      KnowledgeBaseErrorCode.EnrichmentRequestNotFound,
    );
    db.close();
  });

  test('makes late heartbeat, completion, and failure no-ops after cancellation', () => {
    const { db, store } = createMemoryFixture();
    const request = store.createOrGetAuthorizedRequest(authorizedInput());
    const claim = store.claimNext(NOW_2)!;
    store.cancel(request.id, 1, NOW_3);
    const requestBefore = store.getRequest(request.id);
    const attemptsBefore = store.listAttempts(request.id);

    expect(store.heartbeat(request.id, claim.attempt.id, 99, NOW_4)).toBe(false);
    expect(store.completeEmpty(request.id, claim.attempt.id, {
      validCandidateCount: 0,
      discardedCandidateCount: 0,
      partialReasons: [],
      now: NOW_4,
    })).toBe(false);
    expect(store.failAttempt(request.id, claim.attempt.id, {
      code: KnowledgeBaseErrorCode.ModelRequestFailed,
      now: NOW_4,
    })).toBe(false);
    expect(store.getRequest(request.id)).toEqual(requestBefore);
    expect(store.listAttempts(request.id)).toEqual(attemptsBefore);
    db.close();
  });

  test('finds stale prior-version extraction markers with one workspace-bounded query', () => {
    const { db, documentStore, store } = createMemoryFixture({ uuidPrefix: 'prior-version' });
    const createDocument = (displayName: string) => documentStore.createDocumentWithVersion({
      workspaceId: 'workspace-a',
      displayName,
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: {
        contentHash: 'a'.repeat(64),
        managedPath: `blobs/${displayName}`,
        mimeType: 'text/plain',
        fileSize: 7,
        sourceMtime: null,
        parser: 'text',
        extractedText: 'current',
        extractionPartial: false,
      },
    });
    const prior = createDocument('prior.txt');
    const priorRequest = store.createOrGetAuthorizedRequest(authorizedInput({
      documentId: prior.document.id,
      documentVersionId: prior.version.id,
    }));
    store.markVersionStale(prior.version.id, NOW_2);
    documentStore.addVersion(
      prior.document.id,
      prior.document.revision,
      {
        contentHash: 'b'.repeat(64),
        managedPath: 'blobs/current',
        mimeType: 'text/plain',
        fileSize: 7,
        sourceMtime: null,
        parser: 'text',
        extractedText: 'current',
        extractionPartial: false,
      },
      KnowledgeDocumentStatus.Ready,
    );
    const currentOnly = createDocument('current-only.txt');
    const currentRequest = store.createOrGetAuthorizedRequest(authorizedInput({
      documentId: currentOnly.document.id,
      documentVersionId: currentOnly.version.id,
      now: NOW_2,
    }));
    store.markVersionStale(currentOnly.version.id, NOW_3);
    const originalPrepare = db.prepare.bind(db);
    let statementCount = 0;
    let capturedSql = '';
    let capturedBindings: unknown[] = [];
    Object.defineProperty(db, 'prepare', {
      configurable: true,
      value: (source: string) => {
        statementCount += 1;
        capturedSql = source;
        const statement = originalPrepare(source);
        return new Proxy(statement, {
          get(target, property) {
            if (property !== 'all') return Reflect.get(target, property, target);
            return (...bindings: unknown[]) => {
              capturedBindings = bindings;
              return target.all(...bindings);
            };
          },
        });
      },
    });
    try {
      const documentIds = (store as KnowledgeEnrichmentRequestStore & {
        listDocumentIdsWithStalePriorVersionExtraction(workspaceId: string): Set<string>;
      }).listDocumentIdsWithStalePriorVersionExtraction('workspace-a');
      expect(documentIds).toEqual(new Set([prior.document.id]));
      expect(statementCount).toBe(1);
      expect(capturedSql).toMatch(/workspace_id\s*=\s*\?/i);
      expect(capturedSql).not.toMatch(/\bIN\s*\(/i);
      expect(capturedSql).not.toContain(prior.document.id);
      expect(capturedSql).not.toContain(currentOnly.document.id);
      expect(capturedBindings).toEqual(['workspace-a']);
      expect(JSON.stringify([...documentIds])).not.toContain(priorRequest.id);
      expect(JSON.stringify([...documentIds])).not.toContain(currentRequest.id);
    } finally {
      Object.defineProperty(db, 'prepare', {
        configurable: true,
        value: originalPrepare,
      });
      db.close();
    }
  });
});

describe('KnowledgeEnrichmentRequestStore recovery, invalidation, and queries', () => {
  test('recovers every running attempt as failed authorization-required without replaying queued work', () => {
    const { db, store } = createMemoryFixture({ uuidPrefix: 'recovery' });
    const first = store.createOrGetAuthorizedRequest(authorizedInput({
      documentId: 'document-running-a',
      documentVersionId: 'version-running-a',
    }));
    const second = store.createOrGetAuthorizedRequest(authorizedInput({
      documentId: 'document-running-b',
      documentVersionId: 'version-running-b',
      now: NOW_2,
    }));
    const queued = store.createOrGetAuthorizedRequest(authorizedInput({
      documentId: 'document-queued',
      documentVersionId: 'version-queued',
      now: NOW_3,
    }));
    const firstClaim = store.claimNext(NOW_2)!;
    const secondClaim = store.claimNext(NOW_3)!;
    expect(new Set([firstClaim.request.id, secondClaim.request.id])).toEqual(
      new Set([first.id, second.id]),
    );
    store.heartbeat(firstClaim.request.id, firstClaim.attempt.id, 44, NOW_3);

    expect(store.recoverAbandonedRunning(NOW_4)).toBe(2);
    for (const claim of [firstClaim, secondClaim]) {
      const recovered = store.getRequest(claim.request.id)!;
      const attempt = store.listAttempts(claim.request.id)[0];
      expect(recovered).toMatchObject({
        status: KnowledgeEnrichmentStatus.Failed,
        revision: 1,
        attemptCount: 1,
        activeAttemptId: null,
        heartbeatAt: null,
        errorCode: KnowledgeBaseErrorCode.AuthorizationRequired,
        updatedAt: NOW_4,
        completedAt: NOW_4,
      });
      expect(attempt).toMatchObject({
        outcome: KnowledgeEnrichmentAttemptOutcome.Abandoned,
        errorCode: KnowledgeBaseErrorCode.AuthorizationRequired,
        finishedAt: NOW_4,
      });
      expect(attempt.errorMessage).toBe(recovered.errorMessage);
    }
    expect(store.getRequest(first.id)?.progress).toBe(44);
    expect(store.getRequest(queued.id)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Queued,
      attemptCount: 0,
      updatedAt: NOW_3,
    });
    expect(store.recoverAbandonedRunning('2026-07-12T01:04:00.000Z')).toBe(0);
    db.close();
  });

  test('fails recovery closed instead of silently skipping a missing or mismatched active attempt', () => {
    const corruptions: Array<(
      db: Database.Database,
      requestId: string,
      attemptId: string,
    ) => void> = [
      (db, _requestId, attemptId) => {
        db.prepare('DELETE FROM knowledge_enrichment_attempts WHERE id = ?').run(attemptId);
      },
      (db, _requestId, attemptId) => {
        db.prepare(`
          UPDATE knowledge_enrichment_attempts
          SET outcome = ?, finished_at = ?
          WHERE id = ?
        `).run(KnowledgeEnrichmentAttemptOutcome.Completed, NOW_3, attemptId);
      },
      (db, requestId) => {
        db.prepare(`
          UPDATE knowledge_enrichment_requests
          SET active_attempt_id = ?
          WHERE id = ?
        `).run('missing-active-attempt', requestId);
      },
    ];

    for (const corrupt of corruptions) {
      const { db, store } = createMemoryFixture();
      const request = store.createOrGetAuthorizedRequest(authorizedInput());
      const claim = store.claimNext(NOW_2)!;
      corrupt(db, request.id, claim.attempt.id);
      expectStateCode(
        () => store.recoverAbandonedRunning(NOW_4),
        KnowledgeBaseErrorCode.JobStateConflict,
      );
      db.close();
    }
  });

  test('marks a running version stale and lifecycle-cancels its exact attempt first', () => {
    const { db, store } = createMemoryFixture();
    const request = store.createOrGetAuthorizedRequest(authorizedInput());
    const claim = store.claimNext(NOW_2)!;
    store.heartbeat(request.id, claim.attempt.id, 63, NOW_3);

    expect(store.markVersionStale(request.documentVersionId, NOW_4)).toBe(1);
    expect(store.getRequest(request.id)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Stale,
      revision: 2,
      progress: 63,
      attemptCount: 1,
      activeAttemptId: null,
      heartbeatAt: null,
      errorCode: KnowledgeBaseErrorCode.EnrichmentRequestStale,
      updatedAt: NOW_4,
      completedAt: NOW_4,
    });
    const attempt = store.listAttempts(request.id)[0];
    expect(attempt).toMatchObject({
      outcome: KnowledgeEnrichmentAttemptOutcome.Cancelled,
      errorCode: KnowledgeBaseErrorCode.EnrichmentRequestStale,
      finishedAt: NOW_4,
    });
    expect(attempt.errorMessage).toBe(store.getRequest(request.id)?.errorMessage);
    expect(store.markVersionStale(request.documentVersionId, NOW_4)).toBe(0);
    db.close();
  });

  test('invalidates every active workspace request and leaves terminal audit rows immutable', () => {
    const { db, store } = createMemoryFixture({ uuidPrefix: 'workspace-stale' });
    const queued = store.createOrGetAuthorizedRequest(authorizedInput({
      documentId: 'queued-document',
      documentVersionId: 'queued-version',
    }));
    const running = store.createOrGetAuthorizedRequest(authorizedInput({
      documentId: 'running-document',
      documentVersionId: 'running-version',
      now: NOW_2,
    }));
    const runningClaim = store.claimNext(NOW_3)!;
    expect(runningClaim.request.id).toBe(queued.id);
    const review = insertRawRequest(db, {
      id: 'review-request',
      workspace_id: 'workspace-a',
      document_id: 'review-document',
      document_version_id: 'review-version',
      status: KnowledgeEnrichmentStatus.ReviewRequired,
      progress: 100,
      completed_at: null,
      updated_at: NOW_3,
    });
    const terminal = insertRawRequest(db, {
      id: 'terminal-request',
      workspace_id: 'workspace-a',
      document_id: 'terminal-document',
      document_version_id: 'terminal-version',
      status: KnowledgeEnrichmentStatus.Failed,
      error_code: KnowledgeBaseErrorCode.ModelRequestFailed,
      error_message: 'Model request failed',
      progress: 17,
      completed_at: NOW_3,
      updated_at: NOW_3,
    });
    const foreign = store.createOrGetAuthorizedRequest(authorizedInput({
      workspaceId: 'workspace-b',
      documentId: 'foreign-document',
      documentVersionId: 'foreign-version',
      now: NOW_4,
    }));

    expect(store.markWorkspaceStale('workspace-a', NOW_4)).toBe(3);
    for (const requestId of [queued.id, running.id, review.id]) {
      expect(store.getRequest(requestId)).toMatchObject({
        status: KnowledgeEnrichmentStatus.Stale,
        revision: 2,
        errorCode: KnowledgeBaseErrorCode.EnrichmentRequestStale,
        updatedAt: NOW_4,
        completedAt: NOW_4,
      });
    }
    expect(store.getRequest(terminal.id)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Failed,
      revision: 1,
      updatedAt: NOW_3,
    });
    expect(store.getRequest(foreign.id)?.status).toBe(KnowledgeEnrichmentStatus.Queued);
    expect(store.listAttempts(runningClaim.request.id)[0]).toMatchObject({
      outcome: KnowledgeEnrichmentAttemptOutcome.Cancelled,
      errorCode: KnowledgeBaseErrorCode.EnrichmentRequestStale,
      finishedAt: NOW_4,
    });
    db.close();
  });

  test('returns only the deterministic latest summary for each workspace version', () => {
    const { db, store } = createMemoryFixture();
    insertRawRequest(db, {
      id: 'version-a-older',
      document_id: 'document-a',
      document_version_id: 'version-a',
      requested_at: NOW_1,
      updated_at: NOW_1,
    });
    insertRawRequest(db, {
      id: 'version-a-latest',
      document_id: 'document-a',
      document_version_id: 'version-a',
      requested_at: NOW_2,
      updated_at: NOW_2,
    });
    insertRawRequest(db, {
      id: 'version-b-a',
      document_id: 'document-b',
      document_version_id: 'version-b',
      requested_at: NOW_2,
      updated_at: NOW_2,
    });
    insertRawRequest(db, {
      id: 'version-b-z',
      document_id: 'document-b',
      document_version_id: 'version-b',
      requested_at: NOW_2,
      updated_at: NOW_2,
    });
    insertRawRequest(db, {
      id: 'foreign-latest',
      workspace_id: 'workspace-b',
      document_id: 'document-a',
      document_version_id: 'version-a',
      requested_at: NOW_4,
      updated_at: NOW_4,
    });

    const summaries = store.listWorkspaceSummaries('workspace-a');
    expect(new Map(summaries.map(summary => [summary.documentVersionId, summary.requestId])))
      .toEqual(new Map([
        ['version-a', 'version-a-latest'],
        ['version-b', 'version-b-z'],
      ]));
    expect(summaries.find(summary => summary.requestId === 'version-a-latest')).toMatchObject({
      createdAt: NOW_2,
      pendingFactCount: 0,
    });
    db.close();
  });

  test('bulk-aggregates 1,000 real summaries with one workspace-level latest query', () => {
    const { db, store } = createMemoryFixture();
    db.transaction(() => {
      for (let index = 0; index < 1_000; index += 1) {
        insertRawRequest(db, {
          id: `batch-request-${index}`,
          document_id: `batch-document-${index}`,
          document_version_id: `batch-version-${index}`,
          requested_at: NOW_2,
          updated_at: NOW_2,
        });
      }
    })();
    insertRawRequest(db, {
      id: 'foreign-batch-request',
      workspace_id: 'workspace-b',
      document_id: 'batch-document-0',
      document_version_id: 'batch-version-0',
      requested_at: NOW_4,
      updated_at: NOW_4,
    });
    const requestedIds = Array.from({ length: 1_000 }, (_, index) => `batch-version-${index}`);
    requestedIds.push('batch-version-0', 'batch-version-0');
    const originalPrepare = db.prepare.bind(db);
    const preparedSql: string[] = [];
    const workspaceScan = vi.spyOn(store, 'listWorkspaceSummaries');
    Object.defineProperty(db, 'prepare', {
      configurable: true,
      value: (source: string) => {
        preparedSql.push(source);
        return originalPrepare(source);
      },
    });
    try {
      const result = store.listLatestSummariesForVersions('workspace-a', requestedIds);
      expect(result.size).toBe(1_000);
      expect(result.get('batch-version-0')?.requestId).toBe('batch-request-0');
      expect(result.get('batch-version-999')?.requestId).toBe('batch-request-999');
      expect(workspaceScan).not.toHaveBeenCalled();
      expect(preparedSql).toHaveLength(1);
      expect(preparedSql[0]).toMatch(/json_each\s*\(\s*\?\s*\)/i);
      expect(preparedSql[0]).toContain('requested_versions');
      expect(preparedSql[0]).toContain('pending_fact_counts AS');
      expect(preparedSql[0]).not.toMatch(/\(\s*SELECT COUNT\(DISTINCT membership\.fact_id\)/);
      preparedSql.length = 0;
      expect(store.listLatestSummariesForVersions('workspace-a', [])).toEqual(new Map());
      expect(preparedSql).toHaveLength(0);
    } finally {
      Object.defineProperty(db, 'prepare', {
        configurable: true,
        value: originalPrepare,
      });
    }
    db.close();
  });

  test('orders immutable attempts and explicitly deletes attempts before workspace requests', () => {
    const { db, store } = createMemoryFixture({ uuidPrefix: 'cleanup' });
    const failed = failNewRequest(store);
    const retried = store.retryFailedWithAuthorization({
      ...authorizedInput({ now: NOW_4 }),
      requestId: failed.id,
    });
    const secondClaim = store.claimNext('2026-07-12T01:04:00.000Z')!;
    store.failAttempt(retried.id, secondClaim.attempt.id, {
      code: KnowledgeBaseErrorCode.ModelRequestTimeout,
      now: '2026-07-12T01:05:00.000Z',
    });
    const foreign = store.createOrGetAuthorizedRequest(authorizedInput({
      workspaceId: 'workspace-b',
      documentId: 'foreign-document',
      documentVersionId: 'foreign-version',
      now: NOW_4,
    }));
    expect(store.listAttempts(failed.id).map(attempt => attempt.attemptNumber)).toEqual([1, 2]);

    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TRIGGER require_attempt_cleanup_before_request_delete
      BEFORE DELETE ON knowledge_enrichment_requests
      WHEN EXISTS (
        SELECT 1
        FROM knowledge_enrichment_attempts
        WHERE request_id = OLD.id
      )
      BEGIN
        SELECT RAISE(ABORT, 'attempts must be deleted first');
      END;
    `);
    store.deleteWorkspaceRequests('workspace-a');
    expect(store.getRequest(failed.id)).toBeNull();
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_enrichment_attempts
      WHERE request_id = ?
    `).get(failed.id)).toEqual({ count: 0 });
    expect(store.getRequest(foreign.id)).not.toBeNull();
    db.close();
  });
});

describe('KnowledgeEnrichmentRequestStore real WAL contention', () => {
  test('retries the complete caller-owned authorization transaction around the neutral primitive', () => {
    const { dbA, dbB } = createWalConnections();
    dbA.exec(`
      CREATE TEMP TABLE task7_authorization_probe (value INTEGER NOT NULL);
      INSERT INTO task7_authorization_probe (value) VALUES (0);
    `);
    let storeB!: KnowledgeEnrichmentRequestStore;
    let winner: KnowledgeEnrichmentRequest | null = null;
    let winningTransition: ReturnType<KnowledgeEnrichmentRequestStore[
      'createOrGetAuthorizedRequestInCurrentTransaction'
    ]> | null = null;
    let primitiveAttemptCount = 0;
    let firstTransientCode: unknown = null;
    const storeA = new KnowledgeEnrichmentRequestStore(dbA, {
      uuidFactory: () => 'task7-request-a',
      clock: () => NOW_1,
      afterSelect: () => {
        primitiveAttemptCount += 1;
        if (!winner) {
          winningTransition = dbB.transaction(() =>
            storeB.createOrGetAuthorizedRequestInCurrentTransaction(authorizedInput()))();
          winner = winningTransition.request;
        }
      },
    });
    initializeTask6FactSchema(dbA, storeA);
    storeB = new KnowledgeEnrichmentRequestStore(dbB, {
      uuidFactory: () => 'task7-request-b',
      clock: () => NOW_1,
    });
    let outerAttemptCount = 0;
    const outerAuthorizationTransaction = dbA.transaction(() => {
      outerAttemptCount += 1;
      dbA.prepare(`
        UPDATE task7_authorization_probe
        SET value = value + 1
      `).run();
      try {
        return storeA.createOrGetAuthorizedRequestInCurrentTransaction(authorizedInput());
      } catch (error) {
        firstTransientCode ??= (error as { code?: unknown }).code;
        throw error;
      }
    });

    const result = runTransientSqliteWriteTransaction(outerAuthorizationTransaction);

    expect(firstTransientCode).toBe('SQLITE_BUSY_SNAPSHOT');
    expect(winningTransition).toMatchObject({ queuedTransition: true });
    expect(result).toEqual({ request: winner, queuedTransition: false });
    expect(result.request.id).toBe('task7-request-b');
    expect(outerAttemptCount).toBe(2);
    expect(primitiveAttemptCount).toBe(2);
    expect(dbA.prepare(`
      SELECT value FROM task7_authorization_probe
    `).get()).toEqual({ value: 1 });
    expect(dbA.prepare(`
      SELECT COUNT(*) AS count FROM knowledge_enrichment_requests
    `).get()).toEqual({ count: 1 });
    dbA.close();
    dbB.close();
  });

  test('retries a poisoned snapshot only at the caller-owned outer transaction boundary', () => {
    const { dbA, dbB } = createWalConnections();
    dbA.exec(`
      CREATE TEMP TABLE authorization_transaction_probe (value INTEGER NOT NULL);
      INSERT INTO authorization_transaction_probe (value) VALUES (0);
    `);
    let storeB!: KnowledgeEnrichmentRequestStore;
    let winner: KnowledgeEnrichmentRequest | null = null;
    let afterSelectCount = 0;
    const storeA = new KnowledgeEnrichmentRequestStore(dbA, {
      uuidFactory: () => 'outer-request-a',
      clock: () => NOW_1,
      afterSelect: () => {
        afterSelectCount += 1;
        if (!winner) {
          winner = storeB.createOrGetAuthorizedRequest(authorizedInput());
        }
      },
    });
    initializeTask6FactSchema(dbA, storeA);
    storeB = new KnowledgeEnrichmentRequestStore(dbB, {
      uuidFactory: () => 'outer-request-b',
      clock: () => NOW_1,
    });
    let outerAttemptCount = 0;
    const outerAuthorizationTransaction = dbA.transaction(() => {
      outerAttemptCount += 1;
      dbA.prepare(`
        UPDATE authorization_transaction_probe
        SET value = value + 1
      `).run();
      return storeA.createOrGetAuthorizedRequest(authorizedInput());
    });

    const result = runTransientSqliteWriteTransaction(outerAuthorizationTransaction);

    expect(result).toEqual(winner);
    expect(result.id).toBe('outer-request-b');
    expect(outerAttemptCount).toBe(2);
    expect(afterSelectCount).toBe(2);
    expect(dbA.prepare(`
      SELECT value FROM authorization_transaction_probe
    `).get()).toEqual({ value: 1 });
    expect(dbA.prepare(`
      SELECT COUNT(*) AS count FROM knowledge_enrichment_requests
    `).get()).toEqual({ count: 1 });
    dbA.close();
    dbB.close();
  });

  test('concurrent authorized creates converge on one active request from a fresh snapshot', () => {
    const { dbA, dbB } = createWalConnections();
    let storeB!: KnowledgeEnrichmentRequestStore;
    let winner: KnowledgeEnrichmentRequest | null = null;
    let selectedCount = 0;
    const storeA = new KnowledgeEnrichmentRequestStore(dbA, {
      uuidFactory: () => 'request-from-a',
      clock: () => NOW_1,
      afterSelect: () => {
        selectedCount += 1;
        if (!winner) {
          winner = storeB.createOrGetAuthorizedRequest(authorizedInput());
        }
      },
    });
    initializeTask6FactSchema(dbA, storeA);
    storeB = new KnowledgeEnrichmentRequestStore(dbB, {
      uuidFactory: () => 'request-from-b',
      clock: () => NOW_1,
    });

    const result = storeA.createOrGetAuthorizedRequest(authorizedInput());
    expect(result.id).toBe('request-from-b');
    expect(result).toEqual(winner);
    expect(selectedCount).toBe(2);
    expect(dbA.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_enrichment_requests
      WHERE document_version_id = ?
        AND status IN (?, ?, ?)
    `).get(
      'version-a',
      KnowledgeEnrichmentStatus.Queued,
      KnowledgeEnrichmentStatus.Running,
      KnowledgeEnrichmentStatus.ReviewRequired,
    )).toEqual({ count: 1 });
    dbA.close();
    dbB.close();
  });

  test('concurrent claims leave exactly one running attempt and one attempt-count increment', () => {
    const { dbA, dbB } = createWalConnections();
    const storeB = new KnowledgeEnrichmentRequestStore(dbB, {
      uuidFactory: (() => {
        let counter = 0;
        return () => `from-b-${++counter}`;
      })(),
      clock: () => NOW_1,
    });
    initializeTask6FactSchema(dbB, storeB);
    const request = storeB.createOrGetAuthorizedRequest(authorizedInput());
    let winner = storeB.getRequest(request.id);
    let winningClaim: ReturnType<KnowledgeEnrichmentRequestStore['claimNext']> = null;
    let hookCalled = false;
    const storeA = new KnowledgeEnrichmentRequestStore(dbA, {
      uuidFactory: () => 'attempt-from-a',
      clock: () => NOW_2,
      afterSelect: () => {
        if (!hookCalled) {
          hookCalled = true;
          winningClaim = storeB.claimNext(NOW_2);
          winner = storeB.getRequest(request.id);
        }
      },
    });

    expect(storeA.claimNext(NOW_2)).toBeNull();
    expect(winningClaim).not.toBeNull();
    expect(winner).toMatchObject({
      status: KnowledgeEnrichmentStatus.Running,
      attemptCount: 1,
      revision: 1,
    });
    expect(dbA.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_enrichment_attempts
      WHERE request_id = ? AND outcome = ?
    `).get(request.id, KnowledgeEnrichmentAttemptOutcome.Running)).toEqual({ count: 1 });
    expect(dbA.prepare(`
      SELECT attempt_count
      FROM knowledge_enrichment_requests
      WHERE id = ?
    `).get(request.id)).toEqual({ attempt_count: 1 });
    dbA.close();
    dbB.close();
  });

  test('concurrent retries are idempotent and increment revision only once', () => {
    const { dbA, dbB } = createWalConnections();
    const setupStore = new KnowledgeEnrichmentRequestStore(dbB, {
      uuidFactory: (() => {
        let counter = 0;
        return () => `setup-${++counter}`;
      })(),
      clock: () => NOW_1,
    });
    initializeTask6FactSchema(dbB, setupStore);
    const failed = failNewRequest(setupStore);
    let storeB = setupStore;
    let winningRetry: KnowledgeEnrichmentRequest | null = null;
    let hookCalled = false;
    const storeA = new KnowledgeEnrichmentRequestStore(dbA, {
      uuidFactory: () => 'unused-a-id',
      clock: () => NOW_4,
      afterSelect: () => {
        if (!hookCalled) {
          hookCalled = true;
          winningRetry = storeB.retryFailedWithAuthorization({
            ...authorizedInput({ now: NOW_4 }),
            requestId: failed.id,
          });
        }
      },
    });

    const result = storeA.retryFailedWithAuthorization({
      ...authorizedInput({ now: NOW_4 }),
      requestId: failed.id,
    });
    expect(result).toEqual(winningRetry);
    expect(result).toMatchObject({
      id: failed.id,
      status: KnowledgeEnrichmentStatus.Queued,
      revision: 2,
      attemptCount: 1,
      updatedAt: NOW_4,
    });
    expect(dbA.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_enrichment_requests
      WHERE document_version_id = ?
        AND status IN (?, ?, ?)
    `).get(
      failed.documentVersionId,
      KnowledgeEnrichmentStatus.Queued,
      KnowledgeEnrichmentStatus.Running,
      KnowledgeEnrichmentStatus.ReviewRequired,
    )).toEqual({ count: 1 });
    dbA.close();
    dbB.close();
  });

  test('keeps BEGIN IMMEDIATE only for the independent busy-lock case', () => {
    const { dbA, dbB } = createWalConnections();
    let selectCount = 0;
    const storeA = new KnowledgeEnrichmentRequestStore(dbA, {
      uuidFactory: () => 'busy-request',
      clock: () => NOW_1,
      afterSelect: () => {
        selectCount += 1;
      },
    });
    initializeTask6FactSchema(dbA, storeA);
    new KnowledgeEnrichmentRequestStore(dbB);
    dbB.exec('BEGIN IMMEDIATE');
    try {
      let thrown: unknown = null;
      try {
        storeA.createOrGetAuthorizedRequest(authorizedInput());
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).toMatchObject({
        code: 'SQLITE_BUSY',
        message: 'knowledge_enrichment_transient_sqlite_busy',
      });
      expect(thrown).not.toHaveProperty('cause');
      expect(thrown).not.toHaveProperty('stack');
      const serialized = JSON.stringify(thrown);
      expect(serialized).not.toContain('database is locked');
      expect(serialized).not.toContain('/private/');
      expect(serialized).not.toContain('knowledge.sqlite');
      expect(selectCount).toBe(4);
      expect(dbA.prepare(`
        SELECT COUNT(*) AS count FROM knowledge_enrichment_requests
      `).get()).toEqual({ count: 0 });
    } finally {
      dbB.exec('ROLLBACK');
      dbA.close();
      dbB.close();
    }
  });
});

describe('KnowledgeEnrichmentRequestStore safe retry errors', () => {
  test('rejects an active different request and route or target mismatches with fixed codes', () => {
    const { db, store } = createMemoryFixture({ uuidPrefix: 'retry-errors' });
    const failed = failNewRequest(store);
    const active = store.createOrGetAuthorizedRequest(authorizedInput({
      providerId: 'provider-b',
      modelId: 'model-b',
      routingFingerprint: OTHER_ROUTING_FINGERPRINT,
      now: NOW_4,
    }));
    expectStateCode(
      () => store.retryFailedWithAuthorization({
        ...authorizedInput({ now: '2026-07-12T01:04:00.000Z' }),
        requestId: failed.id,
      }),
      KnowledgeBaseErrorCode.EnrichmentAlreadyActive,
    );
    store.cancel(active.id, active.revision, '2026-07-12T01:04:00.000Z');
    expectStateCode(
      () => store.retryFailedWithAuthorization({
        ...authorizedInput({
          workspaceId: 'workspace-secret',
          now: '2026-07-12T01:05:00.000Z',
        }),
        requestId: failed.id,
      }),
      KnowledgeBaseErrorCode.EnrichmentRequestStale,
    );
    db.close();
  });

  test('validates create inputs before SQLite and never serializes caller data in state errors', () => {
    const { db, store } = createMemoryFixture();
    const invalidInputs = [
      authorizedInput({ providerId: '' }),
      authorizedInput({ routingFingerprint: '/private/secret-workspace.sqlite' }),
      authorizedInput({ routingFingerprint: 'https://provider.example/v1' }),
    ];
    invalidInputs.forEach(input => {
      const error = expectStateCode(
        () => store.createOrGetAuthorizedRequest(input),
        KnowledgeBaseErrorCode.InvalidRequest,
      );
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain(input.workspaceId);
      expect(serialized).not.toContain(input.routingFingerprint);
      expect(serialized).not.toContain('provider.example');
    });
    db.close();
  });
});

describe('KnowledgeEnrichmentRequestStore runtime input validation', () => {
  test('treats an own undefined optional now as omitted at every object input boundary', () => {
    const createFixture = createMemoryFixture({ clock: () => NOW_4 });
    const created = createFixture.store.createOrGetAuthorizedRequest(
      authorizedInput({ now: undefined }),
    );
    expect(created).toMatchObject({ requestedAt: NOW_4, updatedAt: NOW_4 });
    createFixture.db.close();

    const retryFixture = createMemoryFixture({ clock: () => NOW_4 });
    const failed = failNewRequest(retryFixture.store);
    const retried = retryFixture.store.retryFailedWithAuthorization({
      ...authorizedInput({ now: undefined }),
      requestId: failed.id,
    });
    expect(retried).toMatchObject({
      status: KnowledgeEnrichmentStatus.Queued,
      revision: 2,
      updatedAt: NOW_4,
    });
    retryFixture.db.close();

    const completionFixture = createMemoryFixture({ clock: () => NOW_4 });
    const completionRequest = completionFixture.store.createOrGetAuthorizedRequest(
      authorizedInput(),
    );
    const completionClaim = completionFixture.store.claimNext(NOW_2)!;
    expect(completionFixture.store.completeEmpty(
      completionRequest.id,
      completionClaim.attempt.id,
      {
        validCandidateCount: 0,
        discardedCandidateCount: 0,
        partialReasons: [],
        now: undefined,
      },
    )).toBe(true);
    expect(completionFixture.store.getRequest(completionRequest.id)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Completed,
      updatedAt: NOW_4,
      completedAt: NOW_4,
    });
    expect(completionFixture.store.listAttempts(completionRequest.id)[0].finishedAt).toBe(NOW_4);
    completionFixture.db.close();

    const failureFixture = createMemoryFixture({ clock: () => NOW_4 });
    const failureRequest = failureFixture.store.createOrGetAuthorizedRequest(authorizedInput());
    const failureClaim = failureFixture.store.claimNext(NOW_2)!;
    expect(failureFixture.store.failAttempt(
      failureRequest.id,
      failureClaim.attempt.id,
      {
        code: KnowledgeBaseErrorCode.ModelRequestFailed,
        now: undefined,
      },
    )).toBe(true);
    expect(failureFixture.store.getRequest(failureRequest.id)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Failed,
      updatedAt: NOW_4,
      completedAt: NOW_4,
    });
    expect(failureFixture.store.listAttempts(failureRequest.id)[0].finishedAt).toBe(NOW_4);
    failureFixture.db.close();
  });

  test('continues rejecting present null, empty, and non-string now values', () => {
    const invalidNowValues: unknown[] = [null, '', new String(NOW_4), 42];
    const createFixture = createMemoryFixture({ clock: () => NOW_4 });
    for (const now of invalidNowValues) {
      expectStateCode(
        () => createFixture.store.createOrGetAuthorizedRequest(
          authorizedInput({ now } as { now: string }),
        ),
        KnowledgeBaseErrorCode.InvalidRequest,
      );
    }
    createFixture.db.close();

    const retryFixture = createMemoryFixture({ clock: () => NOW_4 });
    const failed = failNewRequest(retryFixture.store);
    for (const now of invalidNowValues) {
      expectStateCode(
        () => retryFixture.store.retryFailedWithAuthorization({
          ...authorizedInput(),
          requestId: failed.id,
          now,
        } as Parameters<KnowledgeEnrichmentRequestStore[
          'retryFailedWithAuthorization'
        ]>[0]),
        KnowledgeBaseErrorCode.InvalidRequest,
      );
    }
    expect(retryFixture.store.getRequest(failed.id)?.status).toBe(
      KnowledgeEnrichmentStatus.Failed,
    );
    retryFixture.db.close();

    const attemptFixture = createMemoryFixture({ clock: () => NOW_4 });
    const request = attemptFixture.store.createOrGetAuthorizedRequest(authorizedInput());
    const claim = attemptFixture.store.claimNext(NOW_2)!;
    for (const now of invalidNowValues) {
      expectStateCode(
        () => attemptFixture.store.completeEmpty(request.id, claim.attempt.id, {
          validCandidateCount: 0,
          discardedCandidateCount: 0,
          partialReasons: [],
          now,
        } as unknown as EmptyCompletionCounts),
        KnowledgeBaseErrorCode.InvalidRequest,
      );
      expectStateCode(
        () => attemptFixture.store.failAttempt(request.id, claim.attempt.id, {
          code: KnowledgeBaseErrorCode.ModelRequestFailed,
          now,
        } as Parameters<KnowledgeEnrichmentRequestStore['failAttempt']>[2]),
        KnowledgeBaseErrorCode.InvalidRequest,
      );
    }
    expect(attemptFixture.store.getRequest(request.id)?.status).toBe(
      KnowledgeEnrichmentStatus.Running,
    );
    attemptFixture.db.close();
  });

  test('rejects proxy records without invoking prototype or descriptor side effects', () => {
    const { db, store } = createMemoryFixture();
    let trapCalls = 0;
    const persistSideEffect = () => {
      trapCalls += 1;
      db.exec('CREATE TABLE proxy_validation_side_effect (id TEXT PRIMARY KEY)');
    };
    const trappedInput = new Proxy(authorizedInput(), {
      getOwnPropertyDescriptor: (target, property) => {
        persistSideEffect();
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      getPrototypeOf: target => {
        persistSideEffect();
        return Reflect.getPrototypeOf(target);
      },
    });

    expectStateCode(
      () => store.createOrGetAuthorizedRequest(trappedInput),
      KnowledgeBaseErrorCode.InvalidRequest,
    );
    expect(trapCalls).toBe(0);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE type = 'table' AND name = 'proxy_validation_side_effect'
    `).get()).toEqual({ count: 0 });
    db.close();
  });

  test('rejects trapped, proxied, sparse, inherited, accessor, and non-string version arrays safely', () => {
    const { db, store } = createMemoryFixture();
    store.createOrGetAuthorizedRequest(authorizedInput());
    const secret = 'SECRET_VERSION_ARRAY_TRAP /private/knowledge.sqlite';
    const accessorArray = ['version-a'];
    Object.defineProperty(accessorArray, '0', {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error(`${secret}:accessor`);
      },
    });
    const inheritedArray = Array<string>(1);
    const inheritedPrototype = Object.create(Array.prototype) as string[];
    Object.defineProperty(inheritedPrototype, '0', {
      configurable: true,
      value: 'version-a',
    });
    Object.setPrototypeOf(inheritedArray, inheritedPrototype);
    const revoked = Proxy.revocable(['version-a'], {});
    revoked.revoke();
    const invalidArrays: unknown[] = [
      new Proxy(['version-a'], {
        get: (target, property, receiver) => {
          if (property === 'length') {
            throw new Error(`${secret}:length`);
          }
          return Reflect.get(target, property, receiver);
        },
      }),
      new Proxy(['version-a'], {
        get: (target, property, receiver) => {
          if (property === 'map') {
            throw new Error(`${secret}:map`);
          }
          return Reflect.get(target, property, receiver);
        },
      }),
      new Proxy(['version-a'], {
        get: (target, property, receiver) => {
          if (property === '0') {
            throw new Error(`${secret}:index`);
          }
          return Reflect.get(target, property, receiver);
        },
      }),
      new Proxy(['version-a'], {
        getOwnPropertyDescriptor: () => {
          throw new Error(`${secret}:descriptor`);
        },
      }),
      new Proxy(['version-a'], {}),
      revoked.proxy,
      Array(1),
      inheritedArray,
      accessorArray,
      [new String('version-a')],
      [42],
    ];

    for (const invalidArray of invalidArrays) {
      const error = expectStateCode(
        () => store.listLatestSummariesForVersions(
          'workspace-a',
          invalidArray as readonly string[],
        ),
        KnowledgeBaseErrorCode.InvalidRequest,
      );
      expect(JSON.stringify(error)).not.toContain(secret);
    }
    db.close();
  });

  test('rejects unsafe completion arrays and revoked request records with one fixed error', () => {
    const { db, store } = createMemoryFixture();
    const request = store.createOrGetAuthorizedRequest(authorizedInput());
    const claim = store.claimNext(NOW_2)!;
    const secret = 'SECRET_COMPLETION_ARRAY_TRAP /private/knowledge.sqlite';
    const accessorArray = [KnowledgeEnrichmentPartialReason.ChunkLimit];
    Object.defineProperty(accessorArray, '0', {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error(`${secret}:accessor`);
      },
    });
    const inheritedArray = Array<KnowledgeEnrichmentPartialReason>(1);
    const inheritedPrototype = Object.create(Array.prototype) as
      KnowledgeEnrichmentPartialReason[];
    Object.defineProperty(inheritedPrototype, '0', {
      configurable: true,
      value: KnowledgeEnrichmentPartialReason.ChunkLimit,
    });
    Object.setPrototypeOf(inheritedArray, inheritedPrototype);
    const revokedArray = Proxy.revocable(
      [KnowledgeEnrichmentPartialReason.ChunkLimit],
      {},
    );
    revokedArray.revoke();
    const unsafePartialReasons: unknown[] = [
      new Proxy([KnowledgeEnrichmentPartialReason.ChunkLimit], {
        get: (target, property, receiver) => {
          if (property === 'length' || property === '0' || property === 'every') {
            throw new Error(`${secret}:property`);
          }
          return Reflect.get(target, property, receiver);
        },
      }),
      new Proxy([KnowledgeEnrichmentPartialReason.ChunkLimit], {}),
      revokedArray.proxy,
      Array(1),
      inheritedArray,
      accessorArray,
      [new String(KnowledgeEnrichmentPartialReason.ChunkLimit)],
    ];
    const revokedRecord = Proxy.revocable(authorizedInput(), {});
    revokedRecord.revoke();
    const invalidCalls: Array<() => unknown> = unsafePartialReasons.map(partialReasons => () =>
      store.completeEmpty(request.id, claim.attempt.id, {
        validCandidateCount: 0,
        discardedCandidateCount: 0,
        partialReasons,
        now: NOW_3,
      } as unknown as EmptyCompletionCounts));
    invalidCalls.push(() => store.createOrGetAuthorizedRequest(
      revokedRecord.proxy as CreateAuthorizedEnrichmentRequestInput,
    ));

    for (const invalidCall of invalidCalls) {
      const error = expectStateCode(invalidCall, KnowledgeBaseErrorCode.InvalidRequest);
      expect(JSON.stringify(error)).not.toContain(secret);
    }
    expect(store.getRequest(request.id)?.status).toBe(KnowledgeEnrichmentStatus.Running);
    db.close();
  });

  test('converts caller accessor and proxy traps into a fixed invalid-request error', () => {
    const { db, store } = createMemoryFixture();
    const request = store.createOrGetAuthorizedRequest(authorizedInput());
    const claim = store.claimNext(NOW_2)!;
    const secret = 'https://secret-input.example /private/knowledge.sqlite';
    const throwingGetter = () => {
      throw new Error(secret);
    };
    const createWithGetter = { ...authorizedInput() };
    Object.defineProperty(createWithGetter, 'providerId', {
      enumerable: true,
      get: throwingGetter,
    });
    const completionWithGetter = {
      validCandidateCount: 0,
      discardedCandidateCount: 0,
      now: NOW_3,
    };
    Object.defineProperty(completionWithGetter, 'partialReasons', {
      enumerable: true,
      get: throwingGetter,
    });
    const failureWithGetter = { now: NOW_3 };
    Object.defineProperty(failureWithGetter, 'code', {
      enumerable: true,
      get: throwingGetter,
    });
    const trappedRecord = new Proxy({}, {
      getPrototypeOf: throwingGetter,
    });
    const invalidCalls: Array<() => unknown> = [
      () => store.createOrGetAuthorizedRequest(
        createWithGetter as CreateAuthorizedEnrichmentRequestInput,
      ),
      () => store.createOrGetAuthorizedRequest(
        trappedRecord as CreateAuthorizedEnrichmentRequestInput,
      ),
      () => store.completeEmpty(
        request.id,
        claim.attempt.id,
        completionWithGetter as unknown as EmptyCompletionCounts,
      ),
      () => store.failAttempt(
        request.id,
        claim.attempt.id,
        failureWithGetter as Parameters<KnowledgeEnrichmentRequestStore['failAttempt']>[2],
      ),
    ];

    for (const invalidCall of invalidCalls) {
      const error = expectStateCode(invalidCall, KnowledgeBaseErrorCode.InvalidRequest);
      expect(JSON.stringify(error)).not.toContain(secret);
    }
    expect(store.getRequest(request.id)?.status).toBe(KnowledgeEnrichmentStatus.Running);
    db.close();
  });

  test('rejects malformed values at every public method boundary without native errors', () => {
    const { db, store } = createMemoryFixture();
    const request = store.createOrGetAuthorizedRequest(authorizedInput());
    const claim = store.claimNext(NOW_2)!;
    const invalidCurrentCreate = db.transaction(() =>
      store.createOrGetAuthorizedRequestInCurrentTransaction(
        null as unknown as Parameters<KnowledgeEnrichmentRequestStore[
          'createOrGetAuthorizedRequestInCurrentTransaction'
        ]>[0],
      ));
    const invalidCurrentRetry = db.transaction(() =>
      store.retryFailedWithAuthorizationInCurrentTransaction(
        null as unknown as Parameters<KnowledgeEnrichmentRequestStore[
          'retryFailedWithAuthorizationInCurrentTransaction'
        ]>[0],
      ));
    const invalidCalls: Array<() => unknown> = [
      () => store.createOrGetAuthorizedRequest(
        null as unknown as Parameters<KnowledgeEnrichmentRequestStore[
          'createOrGetAuthorizedRequest'
        ]>[0],
      ),
      () => store.getRequest(null as unknown as string),
      () => store.getSummary(null as unknown as string),
      invalidCurrentCreate,
      invalidCurrentRetry,
      () => store.getActiveRequestForVersion(new String('version-a') as unknown as string),
      () => store.listWorkspaceSummaries(null as unknown as string),
      () => store.listLatestSummariesForVersions(
        'workspace-a',
        null as unknown as readonly string[],
      ),
      () => store.listLatestSummariesForVersions(
        'workspace-a',
        ['version-a', null] as unknown as readonly string[],
      ),
      () => store.claimNext(null as unknown as string),
      () => store.heartbeat(null as unknown as string, claim.attempt.id, 10, NOW_3),
      () => store.completeEmpty(
        request.id,
        claim.attempt.id,
        null as unknown as EmptyCompletionCounts,
      ),
      () => store.failAttempt(
        request.id,
        claim.attempt.id,
        null as unknown as Parameters<KnowledgeEnrichmentRequestStore['failAttempt']>[2],
      ),
      () => store.cancel(null as unknown as string, 1, NOW_3),
      () => store.retryFailedWithAuthorization(
        null as unknown as Parameters<KnowledgeEnrichmentRequestStore[
          'retryFailedWithAuthorization'
        ]>[0],
      ),
      () => store.recoverAbandonedRunning(null as unknown as string),
      () => store.markVersionStale(null as unknown as string, NOW_3),
      () => store.markWorkspaceStale(null as unknown as string, NOW_3),
      () => store.deleteWorkspaceRequests(null as unknown as string),
      () => store.listAttempts(null as unknown as string),
    ];

    for (const invalidCall of invalidCalls) {
      expectStateCode(invalidCall, KnowledgeBaseErrorCode.InvalidRequest);
    }
    expect(store.getRequest(request.id)?.status).toBe(KnowledgeEnrichmentStatus.Running);
    db.close();
  });

  test('requires own plain-record request and failure fields', () => {
    const { db, store } = createMemoryFixture();
    const request = store.createOrGetAuthorizedRequest(authorizedInput());
    const claim = store.claimNext(NOW_2)!;
    const inheritedCreate = Object.create(authorizedInput()) as CreateAuthorizedEnrichmentRequestInput;
    const inheritedRetry = Object.create({
      ...authorizedInput(),
      requestId: request.id,
    }) as Parameters<KnowledgeEnrichmentRequestStore['retryFailedWithAuthorization']>[0];
    const inheritedFailure = Object.create({
      code: KnowledgeBaseErrorCode.ModelRequestFailed,
      now: NOW_3,
    }) as Parameters<KnowledgeEnrichmentRequestStore['failAttempt']>[2];

    expectStateCode(
      () => store.createOrGetAuthorizedRequest(inheritedCreate),
      KnowledgeBaseErrorCode.InvalidRequest,
    );
    expectStateCode(
      () => store.retryFailedWithAuthorization(inheritedRetry),
      KnowledgeBaseErrorCode.InvalidRequest,
    );
    expectStateCode(
      () => store.failAttempt(request.id, claim.attempt.id, inheritedFailure),
      KnowledgeBaseErrorCode.InvalidRequest,
    );
    expect(store.getRequest(request.id)?.status).toBe(KnowledgeEnrichmentStatus.Running);
    db.close();
  });

  test('requires completion counts and partialReasons as own primitive fields and a real array', () => {
    const { db, store } = createMemoryFixture();
    const request = store.createOrGetAuthorizedRequest(authorizedInput());
    const claim = store.claimNext(NOW_2)!;
    const invalidCompletions = [
      {
        validCandidateCount: 0,
        discardedCandidateCount: 0,
        partialReasons: null,
        now: NOW_3,
      },
      {
        validCandidateCount: 0,
        discardedCandidateCount: 0,
        now: NOW_3,
      },
      {
        validCandidateCount: 0,
        discardedCandidateCount: 0,
        partialReasons: { length: 0 },
        now: NOW_3,
      },
    ];

    for (const invalidCompletion of invalidCompletions) {
      expectStateCode(
        () => store.completeEmpty(
          request.id,
          claim.attempt.id,
          invalidCompletion as unknown as EmptyCompletionCounts,
        ),
        KnowledgeBaseErrorCode.InvalidRequest,
      );
    }
    expect(store.getRequest(request.id)?.status).toBe(KnowledgeEnrichmentStatus.Running);
    db.close();
  });

  test('requires an existing outer transaction for every Task 6 neutral primitive', () => {
    const { db, store } = createMemoryFixture();
    const calls: Array<() => unknown> = [
      () => store.getRunningLeaseInCurrentTransaction('request-a', 'attempt-a'),
      () => store.finalizePublicationInCurrentTransaction({
        requestId: 'request-a',
        attemptId: 'attempt-a',
        status: KnowledgeEnrichmentStatus.Completed,
        validCandidateCount: 0,
        discardedCandidateCount: 0,
        partialReasons: [],
        now: NOW_3,
      }),
      () => store.getSummaryInCurrentTransaction('request-a'),
      () => store.completeReviewRequiredRequestsInCurrentTransaction([], NOW_3),
      () => store.markVersionStaleInCurrentTransaction('version-a', NOW_3),
      () => store.markWorkspaceStaleInCurrentTransaction('workspace-a', NOW_3),
    ];

    for (const call of calls) {
      expectStateCode(call, KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
    }
    db.close();
  });

  test('finalizes attempt before request and rolls both back when the internal seam throws', () => {
    const { db, store } = createMemoryFixture();
    const request = store.createOrGetAuthorizedRequest(authorizedInput());
    const claim = store.claimNext(NOW_2)!;
    let callbackCount = 0;

    expect(() => db.transaction(() => store.finalizePublicationInCurrentTransaction({
      requestId: request.id,
      attemptId: claim.attempt.id,
      status: KnowledgeEnrichmentStatus.Completed,
      validCandidateCount: 1,
      discardedCandidateCount: 2,
      partialReasons: [KnowledgeEnrichmentPartialReason.CandidateLimit],
      now: NOW_3,
    }, () => {
      callbackCount += 1;
      expect(store.listAttempts(request.id)[0].outcome).toBe(
        KnowledgeEnrichmentAttemptOutcome.Completed,
      );
      expect(db.prepare(`
        SELECT status FROM knowledge_enrichment_requests WHERE id = ?
      `).get(request.id)).toEqual({ status: KnowledgeEnrichmentStatus.Running });
      throw new Error('task-6-finalization-seam');
    }))()).toThrow('task-6-finalization-seam');

    expect(callbackCount).toBe(1);
    expect(store.getRequest(request.id)?.status).toBe(KnowledgeEnrichmentStatus.Running);
    expect(store.listAttempts(request.id)[0].outcome).toBe(
      KnowledgeEnrichmentAttemptOutcome.Running,
    );

    const finalized = db.transaction(() => store.finalizePublicationInCurrentTransaction({
      requestId: request.id,
      attemptId: claim.attempt.id,
      status: KnowledgeEnrichmentStatus.Completed,
      validCandidateCount: 1,
      discardedCandidateCount: 2,
      partialReasons: [KnowledgeEnrichmentPartialReason.CandidateLimit],
      now: NOW_3,
    }, () => {
      callbackCount += 1;
    }))();
    expect(callbackCount).toBe(2);
    expect(finalized).toMatchObject({
      id: request.id,
      status: KnowledgeEnrichmentStatus.Completed,
      revision: request.revision,
      progress: 100,
      activeAttemptId: null,
      heartbeatAt: null,
      validCandidateCount: 1,
      discardedCandidateCount: 2,
      partialReasons: [KnowledgeEnrichmentPartialReason.CandidateLimit],
      completedAt: NOW_3,
      updatedAt: NOW_3,
    });
    expect(store.listAttempts(request.id)[0]).toMatchObject({
      outcome: KnowledgeEnrichmentAttemptOutcome.Completed,
      errorCode: null,
      errorMessage: null,
      finishedAt: NOW_3,
    });
    db.close();
  });

  test('aggregates distinct reviewable memberships and completes linked review requests as a set', () => {
    const { db, documentStore, store } = createMemoryFixture();
    const target = documentStore.createDocumentWithVersion({
      workspaceId: 'workspace-a',
      displayName: 'facts.txt',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: {
        contentHash: 'f'.repeat(64),
        managedPath: 'blobs/facts',
        mimeType: 'text/plain',
        fileSize: 42,
        sourceMtime: null,
        parser: 'text',
        extractedText: 'The factory builds industrial robots.',
        extractionPartial: false,
      },
    });
    const secondTarget = documentStore.createDocumentWithVersion({
      workspaceId: 'workspace-a',
      displayName: 'facts-2.txt',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: {
        contentHash: 'e'.repeat(64),
        managedPath: 'blobs/facts-2',
        mimeType: 'text/plain',
        fileSize: 42,
        sourceMtime: null,
        parser: 'text',
        extractedText: 'The factory builds industrial robots.',
        extractionPartial: false,
      },
    });
    const first = store.createOrGetAuthorizedRequest(authorizedInput({
      documentId: target.document.id,
      documentVersionId: target.version.id,
    }));
    const firstClaim = store.claimNext(NOW_2)!;
    db.transaction(() => store.finalizePublicationInCurrentTransaction({
      requestId: first.id,
      attemptId: firstClaim.attempt.id,
      status: KnowledgeEnrichmentStatus.ReviewRequired,
      validCandidateCount: 1,
      discardedCandidateCount: 0,
      partialReasons: [],
      now: NOW_3,
    }))();
    const second = insertRawRequest(db, {
      id: 'task-6-second-request',
      document_id: secondTarget.document.id,
      document_version_id: secondTarget.version.id,
      status: KnowledgeEnrichmentStatus.ReviewRequired,
      valid_candidate_count: 1,
      completed_at: null,
      updated_at: NOW_3,
    });
    const value = 'Industrial robots';
    db.prepare(`
      INSERT INTO knowledge_facts (
        id, originating_request_id, workspace_id, domain, value, normalized_value,
        review_status, source_kind, revision, conflict_group_key, projection_state,
        created_at, reviewed_at, updated_at, tombstoned_at
      ) VALUES (?, ?, 'workspace-a', ?, ?, ?, ?, ?, 1, NULL, ?, ?, NULL, ?, NULL)
    `).run(
      'task-6-shared-fact',
      first.id,
      KnowledgeFactDomain.ProductList,
      value,
      normalizeEnterpriseKnowledgeValue(value).normalizedValue,
      KnowledgeFactReviewStatus.Pending,
      KnowledgeFactSourceKind.Extracted,
      KnowledgeFactProjectionState.None,
      NOW_1,
      NOW_1,
    );
    for (const [index, requestId] of [first.id, second.id].entries()) {
      const evidenceTarget = index === 0 ? target : secondTarget;
      db.prepare(`
        INSERT INTO knowledge_enrichment_request_facts (request_id, fact_id)
        VALUES (?, 'task-6-shared-fact')
      `).run(requestId);
      db.prepare(`
        INSERT INTO knowledge_fact_evidence (
          id, workspace_id, fact_id, request_id, document_id, document_version_id,
          chunk_id, quote, confidence, extractor_provider_id, extractor_model_id,
          created_at, stale_at
        ) VALUES (?, 'workspace-a', 'task-6-shared-fact', ?, ?, ?, ?, ?, ?,
          'provider-a', 'model-a', ?, NULL)
      `).run(
        String(index + 1).repeat(64),
        requestId,
        evidenceTarget.document.id,
        evidenceTarget.version.id,
        `chunk-${index + 1}`,
        'builds industrial robots',
        0.9 - index * 0.1,
        NOW_1,
      );
    }

    expect(store.getSummary(first.id)?.pendingFactCount).toBe(1);
    expect(store.getSummary(second.id)?.pendingFactCount).toBe(1);
    expect(db.transaction(() => store.getSummaryInCurrentTransaction(first.id))()
      ?.pendingFactCount).toBe(1);
    expect(store.listWorkspaceSummaries('workspace-a').find(
      summary => summary.requestId === first.id,
    )?.pendingFactCount).toBe(1);
    expect(store.listLatestSummariesForVersions('workspace-a', [
      target.version.id,
      secondTarget.version.id,
    ]).get(target.version.id)?.pendingFactCount).toBe(1);
    let revisionConflict: unknown;
    try {
      store.cancel(first.id, 2, NOW_4);
    } catch (error) {
      revisionConflict = error;
    }
    expect(revisionConflict).toBeInstanceOf(KnowledgeEnrichmentRevisionConflictError);
    expect(revisionConflict).toMatchObject({
      latestSummary: { requestId: first.id, pendingFactCount: 1 },
    });

    db.prepare(`
      UPDATE knowledge_fact_evidence
      SET stale_at = ?
      WHERE fact_id = 'task-6-shared-fact'
    `).run(NOW_4);
    const completed = db.transaction(() =>
      store.completeReviewRequiredRequestsInCurrentTransaction(
        [second.id, first.id, second.id],
        NOW_4,
      ))();
    expect(completed).toBe(2);
    for (const requestId of [first.id, second.id]) {
      expect(store.getRequest(requestId)).toMatchObject({
        status: KnowledgeEnrichmentStatus.Completed,
        revision: 1,
        progress: 100,
        completedAt: NOW_4,
        updatedAt: NOW_4,
      });
    }
    db.close();
  });
});
