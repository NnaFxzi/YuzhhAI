import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import {
  buildEnterpriseLeadWorkspaceKnowledgeScopeId,
  EnterpriseLeadWorkspaceType,
} from '../../shared/enterpriseLeadWorkspace/constants';
import {
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeEnrichmentStatus,
  KnowledgeFactDomain,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
  KnowledgeTrustedIndexRefreshStatus,
} from '../../shared/knowledgeBase/constants';
import { normalizeEnterpriseKnowledgeValue } from '../../shared/knowledgeBase/enterpriseLeadProfileKnowledge';
import { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import { buildEnterpriseTrustedKnowledgeSources } from '../enterpriseLeadWorkspace/trustedKnowledgeSources';
import { buildKnowledgeDocumentLegacySourceId } from '../knowledgeBase/enterpriseLeadKnowledgeCompatibilityAdapter';
import { EnterpriseLeadKnowledgeFactProjector } from '../knowledgeBase/enterpriseLeadKnowledgeFactProjector';
import { KnowledgeDocumentStore } from '../knowledgeBase/knowledgeDocumentStore';
import { KnowledgeEnrichmentRequestStore } from '../knowledgeBase/knowledgeEnrichmentRequestStore';
import { KnowledgeFactProjectionStore } from '../knowledgeBase/knowledgeFactProjectionStore';
import { KnowledgeFactStore } from '../knowledgeBase/knowledgeFactStore';
import {
  type ContentKnowledgeSource,
  ContentKnowledgeSourceType,
} from './contentKnowledgeRetrieval';
import { ContentKnowledgeVectorStore } from './contentKnowledgeVectorStore';

const databases: Database.Database[] = [];
const temporaryDirectories: string[] = [];

const openDatabase = (databasePath = ':memory:'): Database.Database => {
  const db = new Database(databasePath);
  databases.push(db);
  return db;
};

const rawSource = (sourceId: string, content = `原始资料 ${sourceId}`): ContentKnowledgeSource => ({
  sourceId,
  sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
  label: `原始资料 ${sourceId}`,
  content,
});

const confirmedSource = (
  workspaceId: string,
  content = '已确认：主营工业包装服务',
): ContentKnowledgeSource => ({
  sourceId: `profile-confirmed:${workspaceId}`,
  sourceType: ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
  label: '已确认业务知识',
  content,
  priority: 0.18,
  verifiedByUser: true,
  evidenceTier: 'internal',
});

const ruleSource = (
  workspaceId: string,
  content = '禁用承诺：绝对防损',
): ContentKnowledgeSource => ({
  sourceId: `workspace-rules:${workspaceId}`,
  sourceType: ContentKnowledgeSourceType.WorkspaceRule,
  label: '硬性规则',
  content,
  priority: 0.2,
  verifiedByUser: true,
  evidenceTier: 'internal',
});

const readPartition = (
  db: Database.Database,
  scopeId: string,
  sourceTypes: readonly string[],
): unknown[] => {
  const placeholders = sourceTypes.map(() => '?').join(', ');
  return db.prepare(`
    SELECT *
    FROM content_knowledge_chunks
    WHERE scope_id = ? AND source_type IN (${placeholders})
    ORDER BY source_type, source_id, chunk_index
  `).all(scopeId, ...sourceTypes);
};

const readCandidateSourceTypes = (
  result: ReturnType<ContentKnowledgeVectorStore['search']>,
): string[] => [...result.hits, ...result.rejectedHits]
  .map(hit => hit.chunk.sourceType)
  .sort();

const searchAll = (
  store: ContentKnowledgeVectorStore,
  scopeId: string,
): ReturnType<ContentKnowledgeVectorStore['search']> => store.search(
  scopeId,
  '工业包装规则资料',
  { hitThreshold: 0, maxHits: 20, minBusinessSignals: 0 },
);

const retrieveAll = (
  store: ContentKnowledgeVectorStore,
  sharedScopeId: string,
): ReturnType<ContentKnowledgeVectorStore['retrieveFromSources']> => store.retrieveFromSources({
  scopeId: 'agent:main:/tmp/task10-gate',
  sharedScopeIds: [sharedScopeId],
  prompt: '工业包装规则资料',
  sources: [],
  options: { hitThreshold: 0, maxHits: 20, minBusinessSignals: 0 },
});

const createGateTables = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE enterprise_lead_workspaces (
      id TEXT PRIMARY KEY,
      profile_revision INTEGER NOT NULL
    );
    CREATE TABLE knowledge_trusted_profile_index_state (
      workspace_id TEXT PRIMARY KEY,
      scope_id TEXT NOT NULL UNIQUE,
      indexed_profile_revision INTEGER NOT NULL,
      indexed_at TEXT NOT NULL
    ) WITHOUT ROWID;
  `);
};

const seedPendingProductFact = (input: {
  db: Database.Database;
  workspaceId: string;
  documentStore: KnowledgeDocumentStore;
}): void => {
  const document = input.documentStore.createDocumentWithVersion({
    workspaceId: input.workspaceId,
    displayName: 'task10-fact.txt',
    sourceMode: KnowledgeDocumentSourceMode.Managed,
    status: KnowledgeDocumentStatus.Ready,
    version: {
      contentHash: 'f'.repeat(64),
      managedPath: `blobs/ff/${'f'.repeat(64)}`,
      mimeType: 'text/plain',
      fileSize: 64,
      sourceMtime: null,
      parser: 'text',
      extractedText: 'Industrial robots source evidence',
      extractionPartial: false,
    },
  });
  input.db.prepare(`
    INSERT INTO knowledge_enrichment_requests (
      id, workspace_id, document_id, document_version_id, status, consent_mode,
      provider_id, model_id, routing_fingerprint, revision, progress, attempt_count,
      active_attempt_id, error_code, error_message, valid_candidate_count,
      discarded_candidate_count, partial_reasons_json, requested_at, started_at,
      heartbeat_at, completed_at, updated_at
    ) VALUES (
      'request-task10', ?, ?, ?, ?, 'explicit', 'provider-task10', 'model-task10', ?,
      1, 100, 1, NULL, NULL, NULL, 1, 0, '[]', ?, ?, NULL, NULL, ?
    )
  `).run(
    input.workspaceId,
    document.document.id,
    document.version.id,
    KnowledgeEnrichmentStatus.ReviewRequired,
    'a'.repeat(64),
    '2026-07-13T00:00:00.000Z',
    '2026-07-13T00:00:00.000Z',
    '2026-07-13T00:00:00.000Z',
  );
  input.db.prepare(`
    INSERT INTO knowledge_facts (
      id, originating_request_id, workspace_id, domain, value, normalized_value,
      review_status, source_kind, revision, conflict_group_key, projection_state,
      created_at, reviewed_at, updated_at, tombstoned_at
    ) VALUES (
      'fact-task10', 'request-task10', ?, ?, 'Industrial robots', ?, ?, ?, 1,
      NULL, ?, ?, NULL, ?, NULL
    )
  `).run(
    input.workspaceId,
    KnowledgeFactDomain.ProductList,
    normalizeEnterpriseKnowledgeValue('Industrial robots').normalizedValue,
    KnowledgeFactReviewStatus.Pending,
    KnowledgeFactSourceKind.Extracted,
    KnowledgeFactProjectionState.None,
    '2026-07-13T00:00:00.000Z',
    '2026-07-13T00:00:00.000Z',
  );
  input.db.prepare(`
    INSERT INTO knowledge_enrichment_request_facts (request_id, fact_id)
    VALUES ('request-task10', 'fact-task10')
  `).run();
  input.db.prepare(`
    INSERT INTO knowledge_fact_evidence (
      id, workspace_id, fact_id, request_id, document_id, document_version_id,
      chunk_id, quote, confidence, extractor_provider_id, extractor_model_id,
      created_at, stale_at
    ) VALUES (?, ?, 'fact-task10', 'request-task10', ?, ?, ?, ?, 0.9, ?, ?, ?, NULL)
  `).run(
    '1'.repeat(64),
    input.workspaceId,
    document.document.id,
    document.version.id,
    'chunk-task10',
    'Industrial robots evidence',
    'provider-task10',
    'model-task10',
    '2026-07-13T00:00:00.000Z',
  );
};

afterEach(() => {
  while (databases.length > 0) {
    const db = databases.pop();
    if (db?.open) db.close();
  }
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('ContentKnowledgeVectorStore Task 10 partitions', () => {
  test('interleaves raw and trusted replacement without mutating the other partition byte-for-byte', () => {
    const db = openDatabase();
    const store = new ContentKnowledgeVectorStore(db);
    const scopeId = 'agent:workspace-1';

    store.replaceWorkspaceDocumentSources(scopeId, [rawSource('raw-a'), rawSource('raw-b')]);
    const rawBeforeTrusted = readPartition(db, scopeId, [
      ContentKnowledgeSourceType.WorkspaceDocument,
    ]);
    store.replaceTrustedSources(scopeId, [
      confirmedSource('workspace-1'),
      ruleSource('workspace-1'),
    ]);
    const rawAfterTrusted = readPartition(db, scopeId, [
      ContentKnowledgeSourceType.WorkspaceDocument,
    ]);
    const trustedBeforeRaw = readPartition(db, scopeId, [
      ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
      ContentKnowledgeSourceType.WorkspaceRule,
    ]);

    store.replaceWorkspaceDocumentSources(scopeId, [
      rawSource('raw-c', '更新后的工业包装原始资料'),
    ]);

    expect(rawAfterTrusted).toEqual(rawBeforeTrusted);
    expect(readPartition(db, scopeId, [
      ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
      ContentKnowledgeSourceType.WorkspaceRule,
    ])).toEqual(trustedBeforeRaw);
    expect(readPartition(db, scopeId, [
      ContentKnowledgeSourceType.WorkspaceDocument,
    ])).not.toEqual(rawBeforeTrusted);
  });

  test('rejects every source outside the called partition before changing any chunk', () => {
    const db = openDatabase();
    const store = new ContentKnowledgeVectorStore(db);
    const scopeId = 'agent:workspace-types';
    store.replaceWorkspaceDocumentSources(scopeId, [rawSource('raw-a')]);
    store.replaceTrustedSources(scopeId, [confirmedSource('workspace-types')]);
    const before = db.prepare(`
      SELECT * FROM content_knowledge_chunks ORDER BY id
    `).all();

    expect(() => store.replaceWorkspaceDocumentSources(scopeId, [
      rawSource('raw-new'),
      confirmedSource('workspace-types'),
    ])).toThrow('Invalid content knowledge source partition');
    expect(() => store.replaceTrustedSources(scopeId, [
      ruleSource('workspace-types'),
      rawSource('raw-new'),
    ])).toThrow('Invalid content knowledge source partition');
    expect(db.prepare('SELECT * FROM content_knowledge_chunks ORDER BY id').all()).toEqual(before);
  });

  test('targeted raw deletion preserves unrelated raw, trusted, and other-scope chunks and joins outer rollback', () => {
    const db = openDatabase();
    const store = new ContentKnowledgeVectorStore(db);
    const scopeId = 'agent:workspace-delete';
    const otherScopeId = 'agent:workspace-other';
    store.replaceWorkspaceDocumentSources(scopeId, [
      rawSource('raw-a'),
      rawSource('raw-b'),
      rawSource('raw-c'),
    ]);
    store.replaceTrustedSources(scopeId, [
      confirmedSource('workspace-delete'),
      ruleSource('workspace-delete'),
    ]);
    store.replaceWorkspaceDocumentSources(otherScopeId, [rawSource('raw-a')]);
    const trustedBefore = readPartition(db, scopeId, [
      ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
      ContentKnowledgeSourceType.WorkspaceRule,
    ]);
    const otherBefore = readPartition(db, otherScopeId, [
      ContentKnowledgeSourceType.WorkspaceDocument,
    ]);

    expect(store.deleteWorkspaceDocumentSources(scopeId, ['raw-a', 'raw-c'])).toBeGreaterThan(0);
    expect(readPartition(db, scopeId, [ContentKnowledgeSourceType.WorkspaceDocument]))
      .toEqual(expect.arrayContaining([expect.objectContaining({ source_id: 'raw-b' })]));
    expect(JSON.stringify(readPartition(db, scopeId, [
      ContentKnowledgeSourceType.WorkspaceDocument,
    ]))).not.toContain('raw-a');
    expect(JSON.stringify(readPartition(db, scopeId, [
      ContentKnowledgeSourceType.WorkspaceDocument,
    ]))).not.toContain('raw-c');
    expect(readPartition(db, scopeId, [
      ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
      ContentKnowledgeSourceType.WorkspaceRule,
    ])).toEqual(trustedBefore);
    expect(readPartition(db, otherScopeId, [
      ContentKnowledgeSourceType.WorkspaceDocument,
    ])).toEqual(otherBefore);

    db.exec('CREATE TABLE task10_outer_marker (id TEXT PRIMARY KEY)');
    db.exec(`
      CREATE TRIGGER task10_fail_raw_delete
      BEFORE DELETE ON content_knowledge_chunks
      WHEN OLD.scope_id = '${scopeId}' AND OLD.source_id = 'raw-b'
      BEGIN
        SELECT RAISE(ABORT, 'injected delete failure');
      END;
    `);
    const outer = db.transaction(() => {
      db.prepare('INSERT INTO task10_outer_marker (id) VALUES (?)').run('must-rollback');
      store.deleteWorkspaceDocumentSources(scopeId, ['raw-b']);
    });

    expect(() => outer.immediate()).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS count FROM task10_outer_marker').get())
      .toEqual({ count: 0 });
    expect(readPartition(db, scopeId, [ContentKnowledgeSourceType.WorkspaceDocument]))
      .toEqual(expect.arrayContaining([expect.objectContaining({ source_id: 'raw-b' })]));
  });

  test('keeps partition ownership under interleaved file-backed WAL connections', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'content-knowledge-task10-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'knowledge.sqlite');
    const firstDb = openDatabase(databasePath);
    firstDb.pragma('journal_mode = WAL');
    const first = new ContentKnowledgeVectorStore(firstDb);
    const secondDb = openDatabase(databasePath);
    secondDb.pragma('journal_mode = WAL');
    const second = new ContentKnowledgeVectorStore(secondDb);
    const scopeId = 'agent:partition-wal';

    first.replaceWorkspaceDocumentSources(scopeId, [rawSource('raw-a')]);
    second.replaceTrustedSources(scopeId, [confirmedSource('workspace-wal')]);
    first.replaceWorkspaceDocumentSources(scopeId, [rawSource('raw-b')]);
    second.replaceTrustedSources(scopeId, [
      confirmedSource('workspace-wal', '已确认：主营重型工业包装'),
      ruleSource('workspace-wal'),
    ]);

    expect(readPartition(firstDb, scopeId, [ContentKnowledgeSourceType.WorkspaceDocument]))
      .toEqual(expect.arrayContaining([expect.objectContaining({ source_id: 'raw-b' })]));
    expect(readPartition(firstDb, scopeId, [
      ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
      ContentKnowledgeSourceType.WorkspaceRule,
    ])).toHaveLength(2);
  });
});

describe('ContentKnowledgeVectorStore Task 11 workspace leases', () => {
  test('rejects leading and trailing whitespace aliases for every reserved scope', () => {
    const db = openDatabase();
    createGateTables(db);
    const store = new ContentKnowledgeVectorStore(db);
    const workspaceId = 'raw-scope-alias';
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId);
    db.prepare(`
      INSERT INTO enterprise_lead_workspaces (id, profile_revision) VALUES (?, 1)
    `).run(workspaceId);

    expect(() => store.replaceWorkspaceDocumentSources(
      ` ${scopeId}`,
      [rawSource('raw-leading-alias')],
    )).toThrow('Invalid content knowledge source partition');
    expect(() => store.replaceWorkspaceDocumentSources(
      `${scopeId} `,
      [rawSource('raw-trailing-alias')],
    )).toThrow('Invalid content knowledge source partition');
    expect(() => store.replaceLegacyWorkspaceDocumentSources(
      ` ${scopeId}`,
      [rawSource('legacy-leading-alias')],
    )).toThrow('Invalid content knowledge source partition');
    expect(() => store.replaceLegacyWorkspaceDocumentSources(
      `${scopeId} `,
      [rawSource('legacy-trailing-alias')],
    )).toThrow('Invalid content knowledge source partition');
    expect(() => store.replaceTrustedSources(
      ` ${scopeId}`,
      [ruleSource('trusted-leading-alias')],
    )).toThrow('Invalid content knowledge source partition');
    expect(() => store.replaceTrustedSources(
      `${scopeId} `,
      [ruleSource('trusted-trailing-alias')],
    )).toThrow('Invalid content knowledge source partition');
    expect(readPartition(db, scopeId, [ContentKnowledgeSourceType.WorkspaceDocument])).toEqual([]);
    expect(readPartition(db, scopeId, [ContentKnowledgeSourceType.WorkspaceRule])).toEqual([]);
  });

  test('fails closed for full reserved raw replacement without schema or an exact workspace', () => {
    const schemaAbsentDb = openDatabase();
    const schemaAbsentStore = new ContentKnowledgeVectorStore(schemaAbsentDb);
    const schemaAbsentScope = buildEnterpriseLeadWorkspaceKnowledgeScopeId('schema-absent-raw');

    expect(schemaAbsentStore.replaceWorkspaceDocumentSources(
      schemaAbsentScope,
      [rawSource('raw-schema-absent')],
    )).toEqual({
      scopeId: schemaAbsentScope,
      sourceResults: [],
      totalChunkCount: 0,
    });
    expect(schemaAbsentStore.replaceWorkspaceDocumentSources(
      'agent:generic-raw',
      [rawSource('raw-generic')],
    ).totalChunkCount).toBeGreaterThan(0);
    expect(schemaAbsentStore.replaceLegacyWorkspaceDocumentSources(
      schemaAbsentScope,
      [rawSource('legacy-schema-absent')],
    )).toEqual({
      scopeId: schemaAbsentScope,
      sourceResults: [],
      totalChunkCount: 0,
    });

    const db = openDatabase();
    createGateTables(db);
    const store = new ContentKnowledgeVectorStore(db);
    const workspaceId = 'missing-full-raw-workspace';
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId);
    db.prepare(`
      INSERT INTO enterprise_lead_workspaces (id, profile_revision) VALUES (?, 1)
    `).run(workspaceId);
    store.replaceTrustedSources(scopeId, [ruleSource(workspaceId)]);
    const trustedBefore = readPartition(db, scopeId, [ContentKnowledgeSourceType.WorkspaceRule]);
    db.prepare('DELETE FROM enterprise_lead_workspaces WHERE id = ?').run(workspaceId);

    expect(store.replaceWorkspaceDocumentSources(scopeId, [rawSource('raw-missing')]))
      .toEqual({ scopeId, sourceResults: [], totalChunkCount: 0 });
    expect(store.replaceLegacyWorkspaceDocumentSources(scopeId, [rawSource('legacy-missing')]))
      .toEqual({ scopeId, sourceResults: [], totalChunkCount: 0 });
    expect(readPartition(db, scopeId, [ContentKnowledgeSourceType.WorkspaceDocument])).toEqual([]);
    expect(readPartition(db, scopeId, [ContentKnowledgeSourceType.WorkspaceRule]))
      .toEqual(trustedBefore);
  });

  test('keeps full reserved raw replacement empty in both two-WAL cleanup/refresh commit orders', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'task11-full-raw-orders-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'knowledge.sqlite');
    const cleanupDb = openDatabase(databasePath);
    cleanupDb.pragma('journal_mode = WAL');
    createGateTables(cleanupDb);
    const cleanupStore = new ContentKnowledgeVectorStore(cleanupDb);
    const refreshDb = openDatabase(databasePath);
    refreshDb.pragma('journal_mode = WAL');
    const refreshStore = new ContentKnowledgeVectorStore(refreshDb);
    const createWorkspace = (workspaceId: string): string => {
      cleanupDb.prepare(`
        INSERT INTO enterprise_lead_workspaces (id, profile_revision) VALUES (?, 1)
      `).run(workspaceId);
      return buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId);
    };
    const cleanup = (workspaceId: string, scopeId: string): void => cleanupDb.transaction(() => {
      cleanupDb.prepare('DELETE FROM enterprise_lead_workspaces WHERE id = ?').run(workspaceId);
      cleanupStore.deleteScope(scopeId);
    }).immediate();

    const refreshFirstId = 'full-raw-refresh-first';
    const refreshFirstScope = createWorkspace(refreshFirstId);
    expect(refreshStore.replaceWorkspaceDocumentSources(
      refreshFirstScope,
      [rawSource('raw-refresh-first')],
    ).totalChunkCount).toBeGreaterThan(0);
    cleanup(refreshFirstId, refreshFirstScope);
    expect(readPartition(cleanupDb, refreshFirstScope, [
      ContentKnowledgeSourceType.WorkspaceDocument,
    ])).toEqual([]);

    const cleanupFirstId = 'full-raw-cleanup-first';
    const cleanupFirstScope = createWorkspace(cleanupFirstId);
    cleanup(cleanupFirstId, cleanupFirstScope);
    expect(refreshStore.replaceWorkspaceDocumentSources(
      cleanupFirstScope,
      [rawSource('raw-cleanup-first')],
    )).toEqual({ scopeId: cleanupFirstScope, sourceResults: [], totalChunkCount: 0 });
    expect(readPartition(cleanupDb, cleanupFirstScope, [
      ContentKnowledgeSourceType.WorkspaceDocument,
    ])).toEqual([]);
  });

  test('publishes exactly one ready current normalized document from a fresh transaction snapshot', () => {
    const db = openDatabase();
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspace = workspaceStore.createWorkspace({
      name: 'raw lease workspace',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile: {
        companySummary: '', productList: [], productCapabilities: [], targetCustomers: [],
        applicationScenarios: [], sellingPoints: [], channelPreferences: [], prohibitedClaims: [],
        contactRules: [], missingInfo: [],
      },
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const documentStore = new KnowledgeDocumentStore(db);
    const document = documentStore.createDocumentWithVersion({
      workspaceId: workspace.id,
      legacySourceId: 'legacy-ready-source',
      displayName: 'ready.txt',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: {
        contentHash: 'd'.repeat(64),
        managedPath: 'blobs/ready',
        mimeType: 'text/plain',
        fileSize: 18,
        sourceMtime: null,
        parser: 'text',
        extractedText: 'fresh ready content',
        extractionPartial: false,
      },
    });
    const vectorStore = new ContentKnowledgeVectorStore(db);
    vectorStore.replaceTrustedSources(
      buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspace.id),
      [ruleSource(workspace.id)],
    );

    expect((vectorStore as ContentKnowledgeVectorStore & {
      replaceWorkspaceDocumentSource(workspaceId: string, documentId: string): boolean;
    }).replaceWorkspaceDocumentSource(workspace.id, document.document.id)).toBe(true);

    const rows = readPartition(
      db,
      buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspace.id),
      [ContentKnowledgeSourceType.WorkspaceDocument],
    );
    expect(rows).toEqual([
      expect.objectContaining({
        source_id: 'legacy-ready-source',
        content: 'fresh ready content',
      }),
    ]);
  });

  test('does not resurrect raw or trusted vectors after workspace cleanup wins the lease', () => {
    const db = openDatabase();
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspace = workspaceStore.createWorkspace({
      name: 'deleted lease workspace',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile: {
        companySummary: '', productList: [], productCapabilities: [], targetCustomers: [],
        applicationScenarios: [], sellingPoints: [], channelPreferences: [], prohibitedClaims: [],
        contactRules: [], missingInfo: [],
      },
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const documentStore = new KnowledgeDocumentStore(db);
    const document = documentStore.createDocumentWithVersion({
      workspaceId: workspace.id,
      displayName: 'deleted.txt',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: {
        contentHash: 'e'.repeat(64),
        managedPath: 'blobs/deleted',
        mimeType: 'text/plain',
        fileSize: 18,
        sourceMtime: null,
        parser: 'text',
        extractedText: 'deleted ready content',
        extractionPartial: false,
      },
    });
    const vectorStore = new ContentKnowledgeVectorStore(db);
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspace.id);
    db.prepare('DELETE FROM enterprise_lead_workspaces WHERE id = ?').run(workspace.id);

    expect((vectorStore as ContentKnowledgeVectorStore & {
      replaceWorkspaceDocumentSource(workspaceId: string, documentId: string): boolean;
    }).replaceWorkspaceDocumentSource(workspace.id, document.document.id)).toBe(false);
    expect(vectorStore.replaceTrustedSources(scopeId, [ruleSource(workspace.id)]))
      .toMatchObject({ totalChunkCount: 0 });
    expect(readPartition(db, scopeId, [
      ContentKnowledgeSourceType.WorkspaceDocument,
      ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
      ContentKnowledgeSourceType.WorkspaceRule,
    ])).toEqual([]);
    expect(buildKnowledgeDocumentLegacySourceId(document.document.id)).toContain(
      document.document.id,
    );
  });

  test.each([
    [KnowledgeDocumentStatus.Pending, 'pending text'],
    [KnowledgeDocumentStatus.Processing, 'processing text'],
    [KnowledgeDocumentStatus.Failed, 'failed text'],
    [KnowledgeDocumentStatus.CompletedWithoutText, null],
    [KnowledgeDocumentStatus.Ready, '   '],
  ] as const)('refuses reserved raw publication for %s or blank document content', (
    status,
    extractedText,
  ) => {
    const db = openDatabase();
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspace = workspaceStore.createWorkspace({
      name: `raw matrix ${status}`,
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile: {
        companySummary: '', productList: [], productCapabilities: [], targetCustomers: [],
        applicationScenarios: [], sellingPoints: [], channelPreferences: [], prohibitedClaims: [],
        contactRules: [], missingInfo: [],
      },
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const target = new KnowledgeDocumentStore(db).createDocumentWithVersion({
      workspaceId: workspace.id,
      displayName: `${status}.txt`,
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status,
      version: {
        contentHash: '7'.repeat(64), managedPath: `blobs/${status}`, mimeType: 'text/plain',
        fileSize: 8, sourceMtime: null, parser: 'text', extractedText,
        extractionPartial: false,
      },
    });
    const vectorStore = new ContentKnowledgeVectorStore(db);
    const published = (vectorStore as ContentKnowledgeVectorStore & {
      replaceWorkspaceDocumentSource(workspaceId: string, documentId: string): boolean;
    }).replaceWorkspaceDocumentSource(workspace.id, target.document.id);

    expect(published).toBe(false);
    expect(readPartition(db, buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspace.id), [
      ContentKnowledgeSourceType.WorkspaceDocument,
    ])).toEqual([]);
  });

  test('keeps raw and trusted scopes empty in both two-WAL cleanup/refresh commit orders', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'content-knowledge-task11-lease-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'knowledge.sqlite');
    const cleanupDb = openDatabase(databasePath);
    cleanupDb.pragma('journal_mode = WAL');
    const workspaceStore = new EnterpriseLeadWorkspaceStore(cleanupDb);
    const documentStore = new KnowledgeDocumentStore(cleanupDb);
    const cleanupVectorStore = new ContentKnowledgeVectorStore(cleanupDb);
    const refreshDb = openDatabase(databasePath);
    refreshDb.pragma('journal_mode = WAL');
    const refreshVectorStore = new ContentKnowledgeVectorStore(refreshDb);
    const createTarget = (name: string) => {
      const workspace = workspaceStore.createWorkspace({
        name,
        type: EnterpriseLeadWorkspaceType.EnterpriseLead,
        profile: {
          companySummary: '', productList: [], productCapabilities: [], targetCustomers: [],
          applicationScenarios: [], sellingPoints: [], channelPreferences: [], prohibitedClaims: [],
          contactRules: [], missingInfo: [],
        },
        extractionSources: [],
        enabledAgentRoles: [],
      });
      const document = documentStore.createDocumentWithVersion({
        workspaceId: workspace.id,
        displayName: `${name}.txt`,
        sourceMode: KnowledgeDocumentSourceMode.Managed,
        status: KnowledgeDocumentStatus.Ready,
        version: {
          contentHash: '9'.repeat(64),
          managedPath: `blobs/${name}`,
          mimeType: 'text/plain',
          fileSize: 9,
          sourceMtime: null,
          parser: 'text',
          extractedText: `${name} ready text`,
          extractionPartial: false,
        },
      });
      return { document, scopeId: buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspace.id), workspace };
    };
    const replaceRaw = (workspaceId: string, documentId: string): boolean =>
      (refreshVectorStore as ContentKnowledgeVectorStore & {
        replaceWorkspaceDocumentSource(workspaceId: string, documentId: string): boolean;
      }).replaceWorkspaceDocumentSource(workspaceId, documentId);
    const cleanup = (workspaceId: string, scopeId: string): void => cleanupDb.transaction(() => {
      cleanupDb.prepare('DELETE FROM enterprise_lead_workspaces WHERE id = ?').run(workspaceId);
      cleanupVectorStore.deleteScope(scopeId);
    }).immediate();

    const refreshFirst = createTarget('refresh-first');
    expect(replaceRaw(refreshFirst.workspace.id, refreshFirst.document.document.id)).toBe(true);
    expect(refreshVectorStore.replaceTrustedSources(
      refreshFirst.scopeId,
      [ruleSource(refreshFirst.workspace.id)],
    ).totalChunkCount).toBeGreaterThan(0);
    cleanup(refreshFirst.workspace.id, refreshFirst.scopeId);
    expect(readPartition(cleanupDb, refreshFirst.scopeId, [
      ContentKnowledgeSourceType.WorkspaceDocument,
      ContentKnowledgeSourceType.WorkspaceRule,
    ])).toEqual([]);

    const cleanupFirst = createTarget('cleanup-first');
    cleanup(cleanupFirst.workspace.id, cleanupFirst.scopeId);
    expect(replaceRaw(cleanupFirst.workspace.id, cleanupFirst.document.document.id)).toBe(false);
    expect(refreshVectorStore.replaceLegacyWorkspaceDocumentSources(
      cleanupFirst.scopeId,
      [rawSource('legacy-after-cleanup')],
    )).toMatchObject({ totalChunkCount: 0 });
    expect(refreshVectorStore.replaceTrustedSources(
      cleanupFirst.scopeId,
      [ruleSource(cleanupFirst.workspace.id)],
    )).toMatchObject({ totalChunkCount: 0 });
    expect(readPartition(cleanupDb, cleanupFirst.scopeId, [
      ContentKnowledgeSourceType.WorkspaceDocument,
      ContentKnowledgeSourceType.WorkspaceRule,
    ])).toEqual([]);
  });

  test.each([
    ['raw', 'after_raw_lease_revalidation_before_first_write'],
    ['legacy', 'after_raw_lease_revalidation_before_first_write'],
    ['trusted', 'after_trusted_lease_revalidation_before_first_write'],
  ] as const)(
    'restarts the final %s lease from a fresh snapshot when cleanup commits at its write hook',
    (partition, expectedStage) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), `task11-${partition}-lease-race-`));
      temporaryDirectories.push(directory);
      const databasePath = path.join(directory, 'knowledge.sqlite');
      const cleanupDb = openDatabase(databasePath);
      cleanupDb.pragma('journal_mode = WAL');
      cleanupDb.pragma('busy_timeout = 0');
      const workspaceStore = new EnterpriseLeadWorkspaceStore(cleanupDb);
      const workspace = workspaceStore.createWorkspace({
        name: `${partition} lease race`,
        type: EnterpriseLeadWorkspaceType.EnterpriseLead,
        profile: {
          companySummary: '', productList: [], productCapabilities: [], targetCustomers: [],
          applicationScenarios: [], sellingPoints: [], channelPreferences: [], prohibitedClaims: [],
          contactRules: [], missingInfo: [],
        },
        extractionSources: [],
        enabledAgentRoles: [],
      });
      const document = new KnowledgeDocumentStore(cleanupDb).createDocumentWithVersion({
        workspaceId: workspace.id,
        displayName: `${partition}.txt`,
        sourceMode: KnowledgeDocumentSourceMode.Managed,
        status: KnowledgeDocumentStatus.Ready,
        version: {
          contentHash: '4'.repeat(64),
          managedPath: `blobs/${partition}`,
          mimeType: 'text/plain',
          fileSize: 12,
          sourceMtime: null,
          parser: 'text',
          extractedText: `${partition} lease content`,
          extractionPartial: false,
        },
      });
      const cleanupVectorStore = new ContentKnowledgeVectorStore(cleanupDb);
      const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspace.id);
      const otherWorkspace = workspaceStore.createWorkspace({
        name: `${partition} other partition owner`,
        type: EnterpriseLeadWorkspaceType.EnterpriseLead,
        profile: {
          companySummary: '', productList: [], productCapabilities: [], targetCustomers: [],
          applicationScenarios: [], sellingPoints: [], channelPreferences: [], prohibitedClaims: [],
          contactRules: [], missingInfo: [],
        },
        extractionSources: [],
        enabledAgentRoles: [],
      });
      const otherScopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(otherWorkspace.id);
      cleanupVectorStore.replaceWorkspaceDocumentSources(otherScopeId, [
        rawSource(`other-raw-${partition}`),
      ]);
      cleanupVectorStore.replaceTrustedSources(otherScopeId, [
        ruleSource(otherWorkspace.id, `other trusted ${partition}`),
      ]);
      const otherRawBefore = readPartition(cleanupDb, otherScopeId, [
        ContentKnowledgeSourceType.WorkspaceDocument,
      ]);
      const otherTrustedBefore = readPartition(cleanupDb, otherScopeId, [
        ContentKnowledgeSourceType.WorkspaceRule,
      ]);
      const refreshDb = openDatabase(databasePath);
      refreshDb.pragma('journal_mode = WAL');
      refreshDb.pragma('busy_timeout = 0');
      let cleanupCommitted = false;
      let leaseAttempts = 0;
      const refreshVectorStore = new ContentKnowledgeVectorStore(refreshDb, {
        onLeaseStage: (stage: string) => {
          if (stage !== expectedStage) return;
          leaseAttempts += 1;
          if (cleanupCommitted) return;
          cleanupDb.transaction(() => {
            cleanupDb.prepare('DELETE FROM enterprise_lead_workspaces WHERE id = ?')
              .run(workspace.id);
            cleanupVectorStore.deleteScope(scopeId);
          }).immediate();
          cleanupCommitted = true;
        },
      } as never);

      const refreshPartition = () => {
        if (partition === 'raw') {
          return (refreshVectorStore as ContentKnowledgeVectorStore & {
              replaceWorkspaceDocumentSource(workspaceId: string, documentId: string): boolean;
            }).replaceWorkspaceDocumentSource(workspace.id, document.document.id);
        }
        if (partition === 'legacy') {
          return refreshVectorStore.replaceLegacyWorkspaceDocumentSources(
            scopeId,
            [rawSource('legacy-race')],
          );
        }
        return refreshVectorStore.replaceTrustedSources(scopeId, [ruleSource(workspace.id)]);
      };
      const result = refreshPartition();

      expect(cleanupCommitted).toBe(true);
      expect(leaseAttempts).toBe(2);
      if (partition === 'raw') {
        expect(result).toBe(false);
      } else {
        expect(result).toMatchObject({ totalChunkCount: 0 });
      }
      expect(readPartition(cleanupDb, scopeId, [
        ContentKnowledgeSourceType.WorkspaceDocument,
        ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
        ContentKnowledgeSourceType.WorkspaceRule,
      ])).toEqual([]);
      expect(readPartition(cleanupDb, otherScopeId, [
        ContentKnowledgeSourceType.WorkspaceDocument,
      ])).toEqual(otherRawBefore);
      expect(readPartition(cleanupDb, otherScopeId, [
        ContentKnowledgeSourceType.WorkspaceRule,
      ])).toEqual(otherTrustedBefore);
      refreshDb.close();
      cleanupDb.close();
    },
  );
});

describe('ContentKnowledgeVectorStore Task 10 trusted revision gate', () => {
  test('keeps generic stores usable without enterprise schemas while reserved data fails closed', () => {
    const db = openDatabase();
    const store = new ContentKnowledgeVectorStore(db);
    const reservedScopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId('schema-absent');
    store.replaceWorkspaceDocumentSources(reservedScopeId, [
      rawSource('raw-schema-absent', '工业包装原始资料'),
    ]);
    store.replaceTrustedSources(reservedScopeId, [
      confirmedSource('schema-absent'),
      ruleSource('schema-absent'),
    ]);

    expect(readPartition(db, reservedScopeId, [
      ContentKnowledgeSourceType.WorkspaceDocument,
      ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
      ContentKnowledgeSourceType.WorkspaceRule,
    ])).toEqual([]);

    expect(() => searchAll(store, reservedScopeId)).not.toThrow();
    expect(readCandidateSourceTypes(searchAll(store, reservedScopeId))).toEqual([]);
    expect(() => retrieveAll(store, reservedScopeId)).not.toThrow();
    expect(readCandidateSourceTypes(retrieveAll(store, reservedScopeId) as ReturnType<
      ContentKnowledgeVectorStore['search']
    >)).toEqual([]);

    const genericScopeId = 'agent:legacy-trusted';
    store.replaceTrustedSources(genericScopeId, [confirmedSource('legacy')]);
    expect(() => searchAll(store, genericScopeId)).not.toThrow();
    expect(readCandidateSourceTypes(searchAll(store, genericScopeId))).toEqual([
      ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
    ]);
  });

  test('gates trusted chunks in the same SELECT while preserving raw and non-enterprise behavior', () => {
    const db = openDatabase();
    createGateTables(db);
    const store = new ContentKnowledgeVectorStore(db);
    const workspaceId = 'workspace-gate';
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId);
    db.prepare(`
      INSERT INTO enterprise_lead_workspaces (id, profile_revision) VALUES (?, 1)
    `).run(workspaceId);
    store.replaceWorkspaceDocumentSources(scopeId, [
      rawSource('raw-gate', '工业包装原始资料'),
    ]);
    store.replaceTrustedSources(scopeId, [
      confirmedSource(workspaceId),
      ruleSource(workspaceId),
    ]);

    expect(readCandidateSourceTypes(searchAll(store, scopeId))).toEqual([
      ContentKnowledgeSourceType.WorkspaceDocument,
    ]);

    db.prepare(`
      INSERT INTO knowledge_trusted_profile_index_state (
        workspace_id, scope_id, indexed_profile_revision, indexed_at
      ) VALUES (?, ?, 1, ?)
    `).run(workspaceId, scopeId, '2026-07-13T00:00:00.000Z');
    expect(readCandidateSourceTypes(searchAll(store, scopeId))).toEqual([
      ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
      ContentKnowledgeSourceType.WorkspaceDocument,
      ContentKnowledgeSourceType.WorkspaceRule,
    ].sort());

    db.prepare(`
      UPDATE enterprise_lead_workspaces SET profile_revision = 2 WHERE id = ?
    `).run(workspaceId);
    expect(readCandidateSourceTypes(searchAll(store, scopeId))).toEqual([
      ContentKnowledgeSourceType.WorkspaceDocument,
    ]);

    const retrieved = store.retrieveFromSources({
      scopeId: 'agent:main:/tmp/workspace-main',
      sharedScopeIds: [scopeId],
      prompt: '工业包装规则资料',
      sources: [{
        sourceId: 'USER.md',
        sourceType: ContentKnowledgeSourceType.UserProfile,
        label: 'USER.md',
        content: '工业包装用户资料',
      }],
      options: { hitThreshold: 0, maxHits: 20, minBusinessSignals: 0 },
    });
    expect([...retrieved.hits, ...retrieved.rejectedHits].map(hit => hit.chunk.sourceType))
      .toEqual(expect.arrayContaining([
        ContentKnowledgeSourceType.UserProfile,
        ContentKnowledgeSourceType.WorkspaceDocument,
      ]));
    expect([...retrieved.hits, ...retrieved.rejectedHits].map(hit => hit.chunk.sourceType))
      .not.toEqual(expect.arrayContaining([
        ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
        ContentKnowledgeSourceType.WorkspaceRule,
      ]));

    db.prepare(`
      UPDATE enterprise_lead_workspaces SET profile_revision = 1 WHERE id = ?
    `).run(workspaceId);
    db.prepare(`
      UPDATE knowledge_trusted_profile_index_state SET scope_id = ? WHERE workspace_id = ?
    `).run('enterprise-workspace:scope-mismatch', workspaceId);
    expect(readCandidateSourceTypes(searchAll(store, scopeId))).toEqual([
      ContentKnowledgeSourceType.WorkspaceDocument,
    ]);
    expect(readCandidateSourceTypes(retrieveAll(store, scopeId) as ReturnType<
      ContentKnowledgeVectorStore['search']
    >)).toEqual(expect.arrayContaining([
      ContentKnowledgeSourceType.WorkspaceDocument,
    ]));
    expect(readCandidateSourceTypes(retrieveAll(store, scopeId) as ReturnType<
      ContentKnowledgeVectorStore['search']
    >)).not.toEqual(expect.arrayContaining([
      ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
      ContentKnowledgeSourceType.WorkspaceRule,
    ]));

    const nonEnterpriseScope = 'agent:trusted-legacy';
    store.replaceTrustedSources(nonEnterpriseScope, [confirmedSource('legacy')]);
    expect(readCandidateSourceTypes(searchAll(store, nonEnterpriseScope))).toEqual([
      ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
    ]);

    db.prepare(`
      UPDATE knowledge_trusted_profile_index_state SET scope_id = ? WHERE workspace_id = ?
    `).run(scopeId, workspaceId);
    db.prepare('DELETE FROM enterprise_lead_workspaces WHERE id = ?').run(workspaceId);
    expect(readCandidateSourceTypes(searchAll(store, scopeId))).toEqual([
      ContentKnowledgeSourceType.WorkspaceDocument,
    ]);
    expect(readCandidateSourceTypes(retrieveAll(store, scopeId) as ReturnType<
      ContentKnowledgeVectorStore['search']
    >)).toEqual(expect.arrayContaining([
      ContentKnowledgeSourceType.WorkspaceDocument,
    ]));
    expect(readCandidateSourceTypes(retrieveAll(store, scopeId) as ReturnType<
      ContentKnowledgeVectorStore['search']
    >)).not.toEqual(expect.arrayContaining([
      ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
      ContentKnowledgeSourceType.WorkspaceRule,
    ]));
  });

  test('hides old trusted chunks immediately after fact confirmation and after failed archive refresh', () => {
    const db = openDatabase();
    db.pragma('foreign_keys = ON');
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspace = workspaceStore.createWorkspace({
      name: 'Task 10 fact gate',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile: {
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
      },
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const vectorStore = new ContentKnowledgeVectorStore(db);
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspace.id);
    vectorStore.replaceWorkspaceDocumentSources(scopeId, [
      rawSource('raw-fact-gate', 'Industrial robots raw source'),
    ]);
    vectorStore.replaceTrustedSources(scopeId, [
      ruleSource(workspace.id, '禁用承诺：旧规则'),
    ]);
    const indexStore = workspaceStore.getTrustedProfileIndexStore();
    const initialClaim = indexStore.claimNext('2026-07-13T00:01:00.000Z')!;
    expect(indexStore.completeAttempt(
      initialClaim.job.id,
      initialClaim.attempt.id,
      '2026-07-13T00:02:00.000Z',
    )).toBe(true);
    expect(readCandidateSourceTypes(searchAll(vectorStore, scopeId)))
      .toEqual(expect.arrayContaining([
        ContentKnowledgeSourceType.WorkspaceDocument,
        ContentKnowledgeSourceType.WorkspaceRule,
      ]));

    const requestStore = new KnowledgeEnrichmentRequestStore(db, {
      clock: () => '2026-07-13T00:03:00.000Z',
    });
    const documentStore = new KnowledgeDocumentStore(db);
    const factStore = new KnowledgeFactStore(db, {
      requestStore,
      clock: () => '2026-07-13T00:03:00.000Z',
    });
    const projectionStore = new KnowledgeFactProjectionStore(db);
    const projector = new EnterpriseLeadKnowledgeFactProjector(
      db,
      factStore,
      projectionStore,
      workspaceStore.getProfileRevisionStore(),
      { clock: () => '2026-07-13T00:04:00.000Z' },
    );
    seedPendingProductFact({ db, workspaceId: workspace.id, documentStore });

    const confirmed = projector.confirmFact({
      factId: 'fact-task10',
      expectedRevision: 1,
    });
    expect(confirmed.profileRevision).toBe(2);
    expect(readCandidateSourceTypes(searchAll(vectorStore, scopeId))).toEqual([
      ContentKnowledgeSourceType.WorkspaceDocument,
    ]);

    const confirmedWorkspace = workspaceStore.getWorkspace(workspace.id)!;
    const confirmedClaim = indexStore.claimNext('2026-07-13T00:05:00.000Z')!;
    vectorStore.replaceTrustedSources(
      scopeId,
      buildEnterpriseTrustedKnowledgeSources({
        workspaceId: confirmedWorkspace.id,
        profile: confirmedWorkspace.profile,
      }),
    );
    expect(indexStore.completeAttempt(
      confirmedClaim.job.id,
      confirmedClaim.attempt.id,
      '2026-07-13T00:06:00.000Z',
    )).toBe(true);
    expect(readCandidateSourceTypes(searchAll(vectorStore, scopeId)))
      .toEqual(expect.arrayContaining([
        ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
        ContentKnowledgeSourceType.WorkspaceDocument,
      ]));

    const archived = projector.archiveFact({
      factId: 'fact-task10',
      expectedRevision: 2,
    });
    expect(archived.profileRevision).toBe(3);
    const archiveClaim = indexStore.claimNext('2026-07-13T00:07:00.000Z')!;
    expect(indexStore.failAttempt(
      archiveClaim.job.id,
      archiveClaim.attempt.id,
      '2026-07-13T00:08:00.000Z',
    )).toBe(true);
    expect(indexStore.getJob(workspace.id, 3)).toMatchObject({
      status: KnowledgeTrustedIndexRefreshStatus.Failed,
    });
    expect(readCandidateSourceTypes(searchAll(vectorStore, scopeId))).toEqual([
      ContentKnowledgeSourceType.WorkspaceDocument,
    ]);
  });
});
