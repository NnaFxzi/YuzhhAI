import Database from 'better-sqlite3';
import { describe, expect, test, vi } from 'vitest';

import {
  buildEnterpriseLeadWorkspaceKnowledgeScopeId,
  EnterpriseLeadWorkspaceType,
} from '../../shared/enterpriseLeadWorkspace/constants';
import {
  KnowledgeDocumentIndexTokenizer,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeEnrichmentStatus,
  KnowledgeFactDomain,
  KnowledgeFactProfileProjectionAction,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
} from '../../shared/knowledgeBase/constants';
import { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import { ContentKnowledgeSourceType } from '../libs/contentKnowledgeRetrieval';
import { ContentKnowledgeVectorStore } from '../libs/contentKnowledgeVectorStore';
import { KnowledgeDocumentIndexStore } from './knowledgeDocumentIndexStore';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';
import { KnowledgeEnrichmentRequestStore } from './knowledgeEnrichmentRequestStore';
import { KnowledgeExtractionAuthorizationStore } from './knowledgeExtractionAuthorizationStore';
import { KnowledgeFactProjectionStore } from './knowledgeFactProjectionStore';
import { KnowledgeFactStore } from './knowledgeFactStore';
import { KnowledgeIngestionJobStore } from './knowledgeIngestionJobStore';
import { KnowledgeMigrationStore } from './knowledgeMigrationStore';
import {
  KnowledgeWorkspaceCleanupCoordinator,
  KnowledgeWorkspaceCleanupStage,
} from './knowledgeWorkspaceCleanupCoordinator';

const emptyProfile = {
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
};

const countRows = (db: Database.Database, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;

const cleanupInventoryTables = [
  'knowledge_trusted_profile_index_attempts',
  'knowledge_trusted_profile_index_jobs',
  'knowledge_trusted_profile_index_state',
  'knowledge_fact_profile_projection_ledger',
  'knowledge_fact_projection_support_group_roots',
  'knowledge_fact_projection_support_groups',
  'knowledge_enrichment_request_facts',
  'knowledge_fact_evidence',
  'knowledge_facts',
  'knowledge_enrichment_attempts',
  'knowledge_enrichment_requests',
  'knowledge_document_index_attempts',
  'knowledge_document_index_state',
  'knowledge_document_chunks_fts',
  'knowledge_document_chunks',
  'knowledge_ingestion_job_attempts',
  'knowledge_ingestion_jobs',
  'knowledge_document_versions',
  'knowledge_documents',
  'knowledge_migration_state',
  'enterprise_lead_workspace_profile_field_revisions',
  'enterprise_lead_workspaces',
  'content_knowledge_chunks',
] as const;

const snapshotInventory = (db: Database.Database): Record<string, unknown[]> =>
  Object.fromEntries(cleanupInventoryTables.map(table => [
    table,
    db.prepare(`SELECT * FROM ${table}`).all(),
  ]));

const createFixture = (options: {
  onStage?: (stage: string) => void;
} = {}) => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
  const workspace = workspaceStore.createWorkspace({
    name: 'cleanup workspace',
    type: EnterpriseLeadWorkspaceType.EnterpriseLead,
    profile: emptyProfile,
    extractionSources: [],
    enabledAgentRoles: [],
  });
  const documentStore = new KnowledgeDocumentStore(db);
  const indexStore = new KnowledgeDocumentIndexStore(db, {
    resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
  });
  const ingestionJobStore = new KnowledgeIngestionJobStore(db);
  const migrationStore = new KnowledgeMigrationStore(db);
  const enrichmentRequestStore = new KnowledgeEnrichmentRequestStore(db);
  const factStore = new KnowledgeFactStore(db, { requestStore: enrichmentRequestStore });
  const projectionStore = new KnowledgeFactProjectionStore(db);
  const vectorStore = new ContentKnowledgeVectorStore(db);
  const authorizationStore = new KnowledgeExtractionAuthorizationStore();
  const lifecycleEvents: string[] = [];
  const enrichmentService = {
    abortActiveAttemptForWorkspace: vi.fn(() => {
      expect(db.inTransaction).toBe(false);
      lifecycleEvents.push('abort-enrichment');
    }),
  };
  const trustedIndexingService = {
    abortActiveAttemptForWorkspace: vi.fn(() => {
      expect(db.inTransaction).toBe(false);
      lifecycleEvents.push('abort-trusted');
    }),
  };
  const stages: string[] = [];
  const coordinator = new KnowledgeWorkspaceCleanupCoordinator({
    db,
    workspaceStore,
    trustedIndexStore: workspaceStore.getTrustedProfileIndexStore(),
    projectionStore,
    factStore,
    enrichmentRequestStore,
    documentIndexStore: indexStore,
    ingestionJobStore,
    documentStore,
    migrationStore,
    profileRevisionStore: workspaceStore.getProfileRevisionStore(),
    contentKnowledgeVectorStore: vectorStore,
    authorizationStore,
    enrichmentService,
    trustedIndexingService,
    onStage: stage => {
      stages.push(stage);
      lifecycleEvents.push(`stage:${stage}`);
      options.onStage?.(stage);
    },
  });
  return {
    authorizationStore,
    coordinator,
    db,
    documentStore,
    enrichmentRequestStore,
    enrichmentService,
    factStore,
    indexStore,
    ingestionJobStore,
    lifecycleEvents,
    migrationStore,
    projectionStore,
    stages,
    trustedIndexingService,
    vectorStore,
    workspace,
    workspaceStore,
  };
};

const seedDocumentRoots = (fixture: ReturnType<typeof createFixture>) => {
  const created = fixture.documentStore.createDocumentWithVersion({
    workspaceId: fixture.workspace.id,
    displayName: 'cleanup.txt',
    sourceMode: KnowledgeDocumentSourceMode.Managed,
    status: KnowledgeDocumentStatus.Ready,
    version: {
      contentHash: 'c'.repeat(64),
      managedPath: 'blobs/cleanup',
      mimeType: 'text/plain',
      fileSize: 7,
      sourceMtime: null,
      parser: 'text',
      extractedText: 'cleanup',
      extractionPartial: false,
    },
  });
  fixture.ingestionJobStore.createJob({
    workspaceId: fixture.workspace.id,
    documentId: created.document.id,
    documentVersionId: created.version.id,
  });
  fixture.ingestionJobStore.claimNextJob('2026-07-13T00:00:01.000Z');
  fixture.indexStore.scheduleCurrentVersion({
    workspaceId: fixture.workspace.id,
    documentId: created.document.id,
    documentVersionId: created.version.id,
  });
  const indexClaim = fixture.indexStore.claimNext('2026-07-13T00:00:02.000Z');
  if (!indexClaim) throw new Error('Expected index cleanup claim');
  fixture.db.prepare(`
    INSERT INTO knowledge_document_chunks (
      storage_id, id, index_generation_id, workspace_id, document_id,
      document_version_id, ordinal, content, start_offset, end_offset,
      page_number, sheet_name, slide_number, heading_path_json, checksum, created_at
    ) VALUES ('cleanup-storage', 'cleanup-chunk', ?, ?, ?, ?, 0, 'cleanup', 0, 7,
      NULL, NULL, NULL, NULL, ?, '2026-07-13T00:00:02.000Z')
  `).run(
    indexClaim.attempt.id,
    fixture.workspace.id,
    created.document.id,
    created.version.id,
    'a'.repeat(64),
  );
  fixture.db.prepare(`
    INSERT INTO knowledge_document_chunks_fts (
      storage_id, chunk_id, index_generation_id, workspace_id,
      document_id, document_version_id, search_text
    ) VALUES ('cleanup-storage', 'cleanup-chunk', ?, ?, ?, ?, 'cleanup')
  `).run(
    indexClaim.attempt.id,
    fixture.workspace.id,
    created.document.id,
    created.version.id,
  );
  fixture.migrationStore.begin(fixture.workspace.id, 1, 1);
  const trustedClaim = fixture.workspaceStore.getTrustedProfileIndexStore().claimNext(
    '2026-07-13T00:00:03.000Z',
  );
  if (!trustedClaim) throw new Error('Expected trusted cleanup claim');
  fixture.workspaceStore.getTrustedProfileIndexStore().completeAttempt(
    trustedClaim.job.id,
    trustedClaim.attempt.id,
    '2026-07-13T00:00:04.000Z',
  );

  const factDocument = fixture.documentStore.createDocumentWithVersion({
    workspaceId: fixture.workspace.id,
    displayName: 'fact-cleanup.txt',
    sourceMode: KnowledgeDocumentSourceMode.Managed,
    status: KnowledgeDocumentStatus.Ready,
    version: {
      contentHash: 'f'.repeat(64),
      managedPath: 'blobs/fact-cleanup',
      mimeType: 'text/plain',
      fileSize: 12,
      sourceMtime: null,
      parser: 'text',
      extractedText: 'fact cleanup',
      extractionPartial: false,
    },
  });
  const runningRequest = fixture.enrichmentRequestStore.createOrGetAuthorizedRequest({
    workspaceId: fixture.workspace.id,
    documentId: created.document.id,
    documentVersionId: created.version.id,
    providerId: 'provider-cleanup',
    modelId: 'model-cleanup',
    routingFingerprint: '1'.repeat(64),
    now: '2026-07-13T00:00:05.000Z',
  });
  const runningClaim = fixture.enrichmentRequestStore.claimNext(
    '2026-07-13T00:00:06.000Z',
  );
  if (!runningClaim || runningClaim.request.id !== runningRequest.id) {
    throw new Error('Expected enrichment cleanup claim');
  }
  const requestId = 'request-fact-cleanup';
  const factId = 'fact-cleanup';
  const now = '2026-07-13T00:00:07.000Z';
  fixture.db.prepare(`
    INSERT INTO knowledge_enrichment_requests (
      id, workspace_id, document_id, document_version_id, status, consent_mode,
      provider_id, model_id, routing_fingerprint, revision, progress, attempt_count,
      active_attempt_id, error_code, error_message, valid_candidate_count,
      discarded_candidate_count, partial_reasons_json, requested_at, started_at,
      heartbeat_at, completed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'explicit', 'provider-cleanup', 'model-cleanup', ?,
      1, 100, 0, NULL, NULL, NULL, 1, 0, '[]', ?, NULL, NULL, NULL, ?)
  `).run(
    requestId,
    fixture.workspace.id,
    factDocument.document.id,
    factDocument.version.id,
    KnowledgeEnrichmentStatus.ReviewRequired,
    '2'.repeat(64),
    now,
    now,
  );
  fixture.db.prepare(`
    INSERT INTO knowledge_facts (
      id, originating_request_id, workspace_id, domain, value, normalized_value,
      review_status, source_kind, revision, conflict_group_key, projection_state,
      created_at, reviewed_at, updated_at, tombstoned_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL)
  `).run(
    factId,
    requestId,
    fixture.workspace.id,
    KnowledgeFactDomain.ProductList,
    'Industrial robots',
    'industrial robots',
    KnowledgeFactReviewStatus.Confirmed,
    KnowledgeFactSourceKind.Extracted,
    [fixture.workspace.id, KnowledgeFactDomain.ProductList, 'industrial robots'].join('\0'),
    KnowledgeFactProjectionState.Active,
    now,
    now,
    now,
  );
  fixture.db.prepare(`
    INSERT INTO knowledge_enrichment_request_facts (request_id, fact_id)
    VALUES (?, ?)
  `).run(requestId, factId);
  fixture.db.prepare(`
    INSERT INTO knowledge_fact_evidence (
      id, workspace_id, fact_id, request_id, document_id, document_version_id,
      chunk_id, quote, confidence, extractor_provider_id, extractor_model_id,
      created_at, stale_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.9, 'provider-cleanup', 'model-cleanup', ?, NULL)
  `).run(
    '3'.repeat(64),
    fixture.workspace.id,
    factId,
    requestId,
    factDocument.document.id,
    factDocument.version.id,
    'chunk-cleanup',
    'builds industrial robots',
    now,
  );
  fixture.db.prepare(`
    INSERT INTO knowledge_fact_projection_support_groups (
      workspace_id, domain, normalized_value, active_support_count
    ) VALUES (?, ?, ?, 1)
  `).run(fixture.workspace.id, KnowledgeFactDomain.ProductList, 'industrial robots');
  fixture.db.prepare(`
    INSERT INTO knowledge_fact_profile_projection_ledger (
      fact_id, workspace_id, domain, normalized_value, cycle_root_fact_id, action,
      applied_value_json, prior_value_json, applied_profile_revision,
      applied_field_revision, prior_confirmed_key_present, prior_ignored_key_present,
      applied_at, reversed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0, 0, ?, NULL)
  `).run(
    factId,
    fixture.workspace.id,
    KnowledgeFactDomain.ProductList,
    'industrial robots',
    factId,
    KnowledgeFactProfileProjectionAction.Inserted,
    JSON.stringify(['Industrial robots']),
    JSON.stringify([]),
    now,
  );
  fixture.db.prepare(`
    INSERT INTO knowledge_fact_projection_support_group_roots (
      workspace_id, domain, normalized_value, root_fact_id
    ) VALUES (?, ?, ?, ?)
  `).run(
    fixture.workspace.id,
    KnowledgeFactDomain.ProductList,
    'industrial robots',
    factId,
  );
  const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(fixture.workspace.id);
  fixture.vectorStore.replaceWorkspaceDocumentSources(scopeId, [{
    sourceId: 'raw-cleanup',
    sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
    label: 'raw',
    content: 'raw cleanup',
  }]);
  fixture.vectorStore.replaceTrustedSources(scopeId, [{
    sourceId: 'trusted-cleanup',
    sourceType: ContentKnowledgeSourceType.WorkspaceRule,
    label: 'trusted',
    content: 'trusted cleanup',
  }]);
  return { created, factDocument, factId, requestId, runningRequest };
};

describe('KnowledgeWorkspaceCleanupCoordinator', () => {
  test('is the sole normal deletion transaction and removes every workspace root in locked order', () => {
    const fixture = createFixture();
    seedDocumentRoots(fixture);
    const clearWorkspace = vi.spyOn(fixture.authorizationStore, 'clearWorkspace');
    clearWorkspace.mockImplementation(() => {
      expect(fixture.db.inTransaction).toBe(false);
      fixture.lifecycleEvents.push('clear-authorization');
    });

    expect(fixture.coordinator.prepareWorkspaceDeletion(fixture.workspace.id)).toBe(true);

    expect(clearWorkspace).toHaveBeenCalledTimes(1);
    expect(fixture.workspaceStore.getWorkspace(fixture.workspace.id)).toBeNull();
    for (const table of cleanupInventoryTables.filter(table =>
      table !== 'enterprise_lead_workspaces')) {
      expect(countRows(fixture.db, table), table).toBe(0);
    }
    expect(fixture.stages).toEqual([
      KnowledgeWorkspaceCleanupStage.TrustedIndex,
      KnowledgeWorkspaceCleanupStage.Projections,
      KnowledgeWorkspaceCleanupStage.Facts,
      KnowledgeWorkspaceCleanupStage.EnrichmentRequests,
      KnowledgeWorkspaceCleanupStage.DocumentIndex,
      KnowledgeWorkspaceCleanupStage.IngestionJobs,
      KnowledgeWorkspaceCleanupStage.Documents,
      KnowledgeWorkspaceCleanupStage.Migration,
      KnowledgeWorkspaceCleanupStage.ProfileFieldRevisions,
      KnowledgeWorkspaceCleanupStage.WorkspaceRow,
      KnowledgeWorkspaceCleanupStage.VectorScope,
    ]);
    expect(fixture.enrichmentService.abortActiveAttemptForWorkspace).toHaveBeenCalledTimes(1);
    expect(fixture.trustedIndexingService.abortActiveAttemptForWorkspace).toHaveBeenCalledTimes(1);
    expect(fixture.lifecycleEvents[0]).toBe('clear-authorization');
    expect(fixture.lifecycleEvents.slice(-2)).toEqual(['abort-enrichment', 'abort-trusted']);
    fixture.db.close();
  });

  test.each([
    ['trusted index', (fixture: ReturnType<typeof createFixture>) =>
      fixture.workspaceStore.getTrustedProfileIndexStore()
        .deleteWorkspaceTrustedIndexInCurrentTransaction(fixture.workspace.id)],
    ['projection', (fixture: ReturnType<typeof createFixture>) =>
      fixture.projectionStore.deleteWorkspaceProjectionsInCurrentTransaction(fixture.workspace.id)],
    ['facts', (fixture: ReturnType<typeof createFixture>) =>
      fixture.factStore.deleteWorkspaceFactsInCurrentTransaction(fixture.workspace.id)],
    ['enrichment', (fixture: ReturnType<typeof createFixture>) =>
      fixture.enrichmentRequestStore.deleteWorkspaceRequestsInCurrentTransaction(
        fixture.workspace.id,
      )],
    ['document index', (fixture: ReturnType<typeof createFixture>) =>
      fixture.indexStore.deleteWorkspaceIndexInCurrentTransaction(fixture.workspace.id)],
    ['ingestion', (fixture: ReturnType<typeof createFixture>) =>
      fixture.ingestionJobStore.deleteWorkspaceJobsInCurrentTransaction(fixture.workspace.id)],
    ['documents', (fixture: ReturnType<typeof createFixture>) =>
      fixture.documentStore.deleteWorkspaceDocumentsInCurrentTransaction(fixture.workspace.id)],
    ['migration', (fixture: ReturnType<typeof createFixture>) =>
      fixture.migrationStore.deleteWorkspaceMigrationInCurrentTransaction(fixture.workspace.id)],
    ['Profile field revisions', (fixture: ReturnType<typeof createFixture>) =>
      fixture.workspaceStore.getProfileRevisionStore()
        .deleteWorkspaceFieldRevisionsInCurrentTransaction(fixture.workspace.id)],
    ['workspace vector scope', (fixture: ReturnType<typeof createFixture>) =>
      fixture.vectorStore.deleteEnterpriseWorkspaceScopeInCurrentTransaction(fixture.workspace.id)],
    ['workspace row', (fixture: ReturnType<typeof createFixture>) =>
      fixture.workspaceStore.deleteWorkspaceRowInCurrentTransaction(fixture.workspace.id)],
  ] as const)(
    'keeps the %s cleanup primitive transaction-neutral and outer-rollback-safe',
    (_label, cleanup) => {
      const fixture = createFixture();
      seedDocumentRoots(fixture);
      fixture.db.pragma('foreign_keys = OFF');
      const before = snapshotInventory(fixture.db);

      expect(() => cleanup(fixture)).toThrow();
      expect(snapshotInventory(fixture.db)).toEqual(before);

      expect(() => fixture.db.transaction(() => {
        cleanup(fixture);
        throw new Error('outer rollback sentinel');
      })()).toThrow('outer rollback sentinel');
      expect(snapshotInventory(fixture.db)).toEqual(before);
      fixture.db.close();
    },
  );

  test.each([
    ['trusted index', [
      'knowledge_trusted_profile_index_attempts',
      'knowledge_trusted_profile_index_jobs',
      'knowledge_trusted_profile_index_state',
    ], (fixture: ReturnType<typeof createFixture>) => fixture.workspaceStore
      .getTrustedProfileIndexStore()
      .deleteWorkspaceTrustedIndexInCurrentTransaction(fixture.workspace.id)],
    ['projection', [
      'knowledge_fact_profile_projection_ledger',
      'knowledge_fact_projection_support_group_roots',
      'knowledge_fact_projection_support_groups',
    ], (fixture: ReturnType<typeof createFixture>) =>
      fixture.projectionStore.deleteWorkspaceProjectionsInCurrentTransaction(fixture.workspace.id)],
    ['facts', [
      'knowledge_enrichment_request_facts',
      'knowledge_fact_evidence',
      'knowledge_facts',
    ], (fixture: ReturnType<typeof createFixture>) =>
      fixture.factStore.deleteWorkspaceFactsInCurrentTransaction(fixture.workspace.id)],
    ['enrichment', [
      'knowledge_enrichment_attempts',
      'knowledge_enrichment_requests',
    ], (fixture: ReturnType<typeof createFixture>) =>
      fixture.enrichmentRequestStore.deleteWorkspaceRequestsInCurrentTransaction(
        fixture.workspace.id,
      )],
    ['document index', [
      'knowledge_document_index_attempts',
      'knowledge_document_index_state',
      'knowledge_document_chunks_fts',
      'knowledge_document_chunks',
    ], (fixture: ReturnType<typeof createFixture>) =>
      fixture.indexStore.deleteWorkspaceIndexInCurrentTransaction(fixture.workspace.id)],
    ['ingestion', [
      'knowledge_ingestion_job_attempts',
      'knowledge_ingestion_jobs',
    ], (fixture: ReturnType<typeof createFixture>) =>
      fixture.ingestionJobStore.deleteWorkspaceJobsInCurrentTransaction(fixture.workspace.id)],
    ['documents', ['knowledge_document_versions', 'knowledge_documents'],
      (fixture: ReturnType<typeof createFixture>) =>
        fixture.documentStore.deleteWorkspaceDocumentsInCurrentTransaction(fixture.workspace.id)],
    ['migration', ['knowledge_migration_state'], (fixture: ReturnType<typeof createFixture>) =>
      fixture.migrationStore.deleteWorkspaceMigrationInCurrentTransaction(fixture.workspace.id)],
    ['field revisions', ['enterprise_lead_workspace_profile_field_revisions'],
      (fixture: ReturnType<typeof createFixture>) => fixture.workspaceStore
        .getProfileRevisionStore()
        .deleteWorkspaceFieldRevisionsInCurrentTransaction(fixture.workspace.id)],
    ['vector scope', ['content_knowledge_chunks'], (fixture: ReturnType<typeof createFixture>) =>
      fixture.vectorStore.deleteEnterpriseWorkspaceScopeInCurrentTransaction(fixture.workspace.id)],
    ['workspace row', ['enterprise_lead_workspaces'], (fixture: ReturnType<typeof createFixture>) =>
      fixture.workspaceStore.deleteWorkspaceRowInCurrentTransaction(fixture.workspace.id)],
  ] as const)('commits %s cleanup against only its owned tables with no worker wake', (
    _label,
    ownedTables,
    cleanup,
  ) => {
    const fixture = createFixture();
    seedDocumentRoots(fixture);
    fixture.db.pragma('foreign_keys = OFF');
    const before = snapshotInventory(fixture.db);

    fixture.db.transaction(() => cleanup(fixture))();

    const after = snapshotInventory(fixture.db);
    const changedTables = cleanupInventoryTables.filter(table =>
      JSON.stringify(before[table]) !== JSON.stringify(after[table]));
    expect(new Set(changedTables)).toEqual(new Set(ownedTables));
    expect(fixture.enrichmentService.abortActiveAttemptForWorkspace).not.toHaveBeenCalled();
    expect(fixture.trustedIndexingService.abortActiveAttemptForWorkspace).not.toHaveBeenCalled();
    fixture.db.close();
  });

  test('exposes transaction-neutral set-based parentless sweeps on every child owner', () => {
    const fixture = createFixture();
    const sweeps = [
      () => fixture.workspaceStore.getTrustedProfileIndexStore()
        .deleteParentlessTrustedIndexInCurrentTransaction(),
      () => fixture.projectionStore.deleteParentlessProjectionsInCurrentTransaction(
        '2026-07-13T00:00:00.000Z',
      ),
      () => fixture.factStore.deleteParentlessFactChildrenInCurrentTransaction(),
      () => fixture.enrichmentRequestStore.deleteParentlessEnrichmentInCurrentTransaction(),
      () => fixture.indexStore.deleteParentlessIndexInCurrentTransaction(),
      () => fixture.ingestionJobStore.deleteParentlessIngestionInCurrentTransaction(),
      () => fixture.documentStore.deleteParentlessVersionsInCurrentTransaction(),
    ];
    for (const sweep of sweeps) {
      expect(() => sweep()).toThrow();
    }
    const results = fixture.db.transaction(() => sweeps.map(sweep => sweep()))();
    expect(results).toHaveLength(sweeps.length);
    expect(results.every(result => Number.isSafeInteger(result) && result >= 0)).toBe(true);
    fixture.db.close();
  });

  test('rolls back every SQLite stage and emits no post-commit abort when final vector cleanup fails', () => {
    const fixture = createFixture();
    const { created } = seedDocumentRoots(fixture);
    fixture.db.exec(`
      CREATE TRIGGER fail_vector_cleanup
      BEFORE DELETE ON content_knowledge_chunks
      BEGIN
        SELECT RAISE(ABORT, 'SECRET vector SQL /private/path');
      END;
    `);

    expect(() => fixture.coordinator.prepareWorkspaceDeletion(fixture.workspace.id)).toThrow();

    expect(fixture.workspaceStore.getWorkspace(fixture.workspace.id)).not.toBeNull();
    expect(fixture.documentStore.getDocument(created.document.id)).not.toBeNull();
    expect(countRows(fixture.db, 'content_knowledge_chunks')).toBe(2);
    expect(fixture.enrichmentService.abortActiveAttemptForWorkspace).not.toHaveBeenCalled();
    expect(fixture.trustedIndexingService.abortActiveAttemptForWorkspace).not.toHaveBeenCalled();
    fixture.db.close();
  });

  test('clears authorization once outside a whole-transaction SQLITE_BUSY_SNAPSHOT retry', () => {
    let injectedBusy = false;
    const fixture = createFixture({
      onStage: stage => {
        if (stage === KnowledgeWorkspaceCleanupStage.TrustedIndex && !injectedBusy) {
          injectedBusy = true;
          throw Object.assign(new Error('SECRET retry SQL /private/path'), {
            code: 'SQLITE_BUSY_SNAPSHOT',
          });
        }
      },
    });
    seedDocumentRoots(fixture);
    const clearWorkspace = vi.spyOn(fixture.authorizationStore, 'clearWorkspace');
    clearWorkspace.mockImplementation(() => {
      expect(fixture.db.inTransaction).toBe(false);
      fixture.lifecycleEvents.push('clear-authorization');
    });

    expect(fixture.coordinator.prepareWorkspaceDeletion(fixture.workspace.id)).toBe(true);

    expect(injectedBusy).toBe(true);
    expect(clearWorkspace).toHaveBeenCalledTimes(1);
    expect(fixture.workspaceStore.getWorkspace(fixture.workspace.id)).toBeNull();
    expect(fixture.enrichmentService.abortActiveAttemptForWorkspace).toHaveBeenCalledTimes(1);
    expect(fixture.trustedIndexingService.abortActiveAttemptForWorkspace).toHaveBeenCalledTimes(1);
    expect(fixture.lifecycleEvents.filter(event => event === 'clear-authorization')).toHaveLength(1);
    expect(fixture.lifecycleEvents.slice(-2)).toEqual(['abort-enrichment', 'abort-trusted']);
    fixture.db.close();
  });

  test.each([
    ['trusted refresh', 'knowledge_trusted_profile_index_attempts'],
    ['projection', 'knowledge_fact_profile_projection_ledger'],
    ['request-fact membership', 'knowledge_enrichment_request_facts'],
    ['evidence', 'knowledge_fact_evidence'],
    ['facts', 'knowledge_facts'],
    ['enrichment attempts', 'knowledge_enrichment_attempts'],
    ['enrichment requests', 'knowledge_enrichment_requests'],
    ['local index', 'knowledge_document_index_attempts'],
    ['ingestion', 'knowledge_ingestion_job_attempts'],
    ['documents', 'knowledge_document_versions'],
    ['migration', 'knowledge_migration_state'],
    ['profile field revisions', 'enterprise_lead_workspace_profile_field_revisions'],
    ['workspace row', 'enterprise_lead_workspaces'],
    ['enterprise vector scope', 'content_knowledge_chunks'],
  ] as const)('rolls back the complete normal deletion when %s stage fails', (_stage, table) => {
    const fixture = createFixture();
    const seeded = seedDocumentRoots(fixture);
    expect(countRows(fixture.db, table)).toBeGreaterThan(0);
    fixture.db.exec(`
      CREATE TRIGGER fail_task11_stage
      BEFORE DELETE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, 'SECRET stage SQL /private/path');
      END;
    `);

    expect(() => fixture.coordinator.prepareWorkspaceDeletion(fixture.workspace.id)).toThrow();

    expect(fixture.workspaceStore.getWorkspace(fixture.workspace.id)).not.toBeNull();
    expect(fixture.documentStore.getDocument(seeded.created.document.id)).not.toBeNull();
    expect(fixture.documentStore.getDocument(seeded.factDocument.document.id)).not.toBeNull();
    expect(countRows(fixture.db, table)).toBeGreaterThan(0);
    expect(fixture.enrichmentService.abortActiveAttemptForWorkspace).not.toHaveBeenCalled();
    expect(fixture.trustedIndexingService.abortActiveAttemptForWorkspace).not.toHaveBeenCalled();
    fixture.db.close();
  });

  test.each([
    KnowledgeWorkspaceCleanupStage.TrustedIndex,
    KnowledgeWorkspaceCleanupStage.Projections,
    KnowledgeWorkspaceCleanupStage.Facts,
    KnowledgeWorkspaceCleanupStage.EnrichmentRequests,
    KnowledgeWorkspaceCleanupStage.DocumentIndex,
    KnowledgeWorkspaceCleanupStage.IngestionJobs,
    KnowledgeWorkspaceCleanupStage.Documents,
    KnowledgeWorkspaceCleanupStage.Migration,
    KnowledgeWorkspaceCleanupStage.ProfileFieldRevisions,
    KnowledgeWorkspaceCleanupStage.WorkspaceRow,
    KnowledgeWorkspaceCleanupStage.VectorScope,
  ])('restores the byte-for-byte inventory when an after-stage hook fails at %s', faultStage => {
    const fixture = createFixture({
      onStage: stage => {
        if (stage === faultStage) {
          throw Object.assign(new Error('SECRET after-stage SQL /private/path'), {
            code: 'SQLITE_IOERR',
          });
        }
      },
    });
    seedDocumentRoots(fixture);
    const before = snapshotInventory(fixture.db);

    expect(() => fixture.coordinator.prepareWorkspaceDeletion(fixture.workspace.id)).toThrow();

    expect(snapshotInventory(fixture.db)).toEqual(before);
    expect(fixture.enrichmentService.abortActiveAttemptForWorkspace).not.toHaveBeenCalled();
    expect(fixture.trustedIndexingService.abortActiveAttemptForWorkspace).not.toHaveBeenCalled();
    fixture.db.close();
  });

  test.each([
    ['trusted job', (fixture: ReturnType<typeof createFixture>, orphanId: string) => {
      fixture.workspaceStore.getTrustedProfileIndexStore().enqueue({
        workspaceId: orphanId,
        profileRevision: 1,
      });
    }],
    ['trusted state', (fixture: ReturnType<typeof createFixture>, orphanId: string) => {
      fixture.db.prepare(`
        INSERT INTO knowledge_trusted_profile_index_state (
          workspace_id, scope_id, indexed_profile_revision, indexed_at
        ) VALUES (?, ?, 1, '2026-07-13T01:00:00.000Z')
      `).run(orphanId, buildEnterpriseLeadWorkspaceKnowledgeScopeId(orphanId));
    }],
    ['projection root', (fixture: ReturnType<typeof createFixture>, orphanId: string) => {
      fixture.db.prepare(`
        INSERT INTO knowledge_fact_projection_support_groups (
          workspace_id, domain, normalized_value, active_support_count
        ) VALUES (?, ?, 'orphan-value', 0)
      `).run(orphanId, KnowledgeFactDomain.ProductList);
    }],
    ['fact', (fixture: ReturnType<typeof createFixture>, orphanId: string) => {
      fixture.db.prepare(`
        INSERT INTO knowledge_facts (
          id, originating_request_id, workspace_id, domain, value, normalized_value,
          review_status, source_kind, revision, conflict_group_key, projection_state,
          created_at, reviewed_at, updated_at, tombstoned_at
        ) VALUES (?, NULL, ?, ?, 'orphan', 'orphan', ?, ?, 1, NULL, ?,
          '2026-07-13T01:00:00.000Z', NULL, '2026-07-13T01:00:00.000Z', NULL)
      `).run(
        `fact-${orphanId}`,
        orphanId,
        KnowledgeFactDomain.ProductList,
        KnowledgeFactReviewStatus.Pending,
        KnowledgeFactSourceKind.Manual,
        KnowledgeFactProjectionState.None,
      );
    }],
    ['enrichment request', (fixture: ReturnType<typeof createFixture>, orphanId: string) => {
      fixture.enrichmentRequestStore.createOrGetAuthorizedRequest({
        workspaceId: orphanId,
        documentId: `document-${orphanId}`,
        documentVersionId: `version-${orphanId}`,
        providerId: 'provider-orphan',
        modelId: 'model-orphan',
        routingFingerprint: '4'.repeat(64),
      });
    }],
    ['index state', (fixture: ReturnType<typeof createFixture>, orphanId: string) => {
      fixture.db.pragma('foreign_keys = OFF');
      fixture.db.prepare(`
        INSERT INTO knowledge_document_index_state (
          document_version_id, workspace_id, document_id, status, tokenizer_version,
          chunk_count, attempt_count, active_attempt_id, published_generation_id,
          error_code, requested_at, started_at, heartbeat_at, completed_at, updated_at
        ) VALUES (?, ?, ?, 'pending', ?, 0, 0, NULL, NULL, NULL,
          '2026-07-13T01:00:00.000Z', NULL, NULL, NULL, '2026-07-13T01:00:00.000Z')
      `).run(
        `version-${orphanId}`,
        orphanId,
        `document-${orphanId}`,
        KnowledgeDocumentIndexTokenizer.CjkBigramV1,
      );
    }],
    ['index chunk', (fixture: ReturnType<typeof createFixture>, orphanId: string) => {
      fixture.db.pragma('foreign_keys = OFF');
      fixture.db.prepare(`
        INSERT INTO knowledge_document_chunks (
          storage_id, id, index_generation_id, workspace_id, document_id,
          document_version_id, ordinal, content, start_offset, end_offset,
          page_number, sheet_name, slide_number, heading_path_json, checksum, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 'orphan chunk', 0, 12,
          NULL, NULL, NULL, NULL, ?, '2026-07-13T01:00:00.000Z')
      `).run(
        `storage-${orphanId}`,
        `chunk-${orphanId}`,
        `generation-${orphanId}`,
        orphanId,
        `document-${orphanId}`,
        `version-${orphanId}`,
        '5'.repeat(64),
      );
    }],
    ['ingestion job', (fixture: ReturnType<typeof createFixture>, orphanId: string) => {
      fixture.ingestionJobStore.createJob({
        workspaceId: orphanId,
        documentId: `document-${orphanId}`,
        documentVersionId: `version-${orphanId}`,
      });
    }],
    ['document', (fixture: ReturnType<typeof createFixture>, orphanId: string) => {
      fixture.documentStore.createDocumentWithVersion({
        workspaceId: orphanId,
        displayName: 'orphan.txt',
        sourceMode: KnowledgeDocumentSourceMode.Managed,
        status: KnowledgeDocumentStatus.Ready,
        version: {
          contentHash: '6'.repeat(64),
          managedPath: 'blobs/orphan',
          mimeType: 'text/plain',
          fileSize: 6,
          sourceMtime: null,
          parser: 'text',
          extractedText: 'orphan',
          extractionPartial: false,
        },
      });
    }],
    ['migration', (fixture: ReturnType<typeof createFixture>, orphanId: string) => {
      fixture.migrationStore.begin(orphanId, 1, 1);
    }],
    ['field revision', (fixture: ReturnType<typeof createFixture>, orphanId: string) => {
      fixture.db.prepare(`
        INSERT INTO enterprise_lead_workspace_profile_field_revisions (
          workspace_id, field, revision
        ) VALUES (?, ?, 1)
      `).run(orphanId, KnowledgeFactDomain.ProductList);
    }],
    ['vector scope', (fixture: ReturnType<typeof createFixture>, orphanId: string) => {
      fixture.vectorStore.upsertSources(
        buildEnterpriseLeadWorkspaceKnowledgeScopeId(orphanId),
        [{
          sourceId: 'vector-orphan',
          sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
          label: 'orphan',
          content: 'orphan',
        }],
      );
    }],
  ] as const)('discovers a workspace once when %s is its sole surviving root', (_label, seed) => {
    const fixture = createFixture();
    const orphanId = `orphan-${String(_label).replace(/\s+/g, '-')}`;
    seed(fixture, orphanId);
    const list = fixture.db.transaction(() =>
      fixture.coordinator.listOrphanedWorkspaceIdsInCurrentTransaction());

    expect(list()).toEqual([orphanId]);
    expect(list()).toEqual([orphanId]);
    fixture.db.close();
  });

  test('deduplicates one orphan workspace discovered from every root inventory', () => {
    const fixture = createFixture();
    const orphanId = 'orphan-many-roots';
    fixture.documentStore.createDocumentWithVersion({
      workspaceId: orphanId,
      displayName: 'orphan.txt',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: {
        contentHash: '8'.repeat(64), managedPath: 'blobs/orphan-many', mimeType: 'text/plain',
        fileSize: 6, sourceMtime: null, parser: 'text', extractedText: 'orphan',
        extractionPartial: false,
      },
    });
    fixture.migrationStore.begin(orphanId, 1, 1);
    fixture.db.prepare(`
      INSERT INTO enterprise_lead_workspace_profile_field_revisions (workspace_id, field, revision)
      VALUES (?, ?, 1)
    `).run(orphanId, KnowledgeFactDomain.ProductList);
    fixture.vectorStore.upsertSources(buildEnterpriseLeadWorkspaceKnowledgeScopeId(orphanId), [{
      sourceId: 'many-root-vector',
      sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
      label: 'orphan',
      content: 'orphan',
    }]);

    const list = fixture.db.transaction(() =>
      fixture.coordinator.listOrphanedWorkspaceIdsInCurrentTransaction())();
    expect(list).toEqual([orphanId]);
    fixture.db.close();
  });

  test('deletes every parentless child in one startup transaction without inventing a workspace', () => {
    const fixture = createFixture();
    const now = '2026-07-13T02:00:00.000Z';
    fixture.db.pragma('foreign_keys = OFF');
    fixture.db.prepare(`
      INSERT INTO knowledge_trusted_profile_index_attempts (
        id, job_id, attempt_number, started_at, finished_at, outcome, error_code
      ) VALUES ('orphan-trusted-attempt', 'missing-job', 1, ?, ?, 'completed', NULL)
    `).run(now, now);
    fixture.db.prepare(`
      INSERT INTO knowledge_fact_profile_projection_ledger (
        fact_id, workspace_id, domain, normalized_value, cycle_root_fact_id, action,
        applied_value_json, prior_value_json, applied_profile_revision,
        applied_field_revision, prior_confirmed_key_present, prior_ignored_key_present,
        applied_at, reversed_at
      ) VALUES ('missing-fact', 'child-only-workspace', ?, 'child-only', 'missing-fact', ?,
        '[]', '[]', 1, 1, 0, 0, ?, NULL)
    `).run(KnowledgeFactDomain.ProductList, KnowledgeFactProfileProjectionAction.Inserted, now);
    fixture.db.prepare(`
      INSERT INTO knowledge_fact_projection_support_group_roots (
        workspace_id, domain, normalized_value, root_fact_id
      ) VALUES ('child-only-workspace', ?, 'child-only', 'missing-fact')
    `).run(KnowledgeFactDomain.ProductList);
    fixture.db.prepare(`
      INSERT INTO knowledge_enrichment_request_facts (request_id, fact_id)
      VALUES ('missing-request', 'missing-fact')
    `).run();
    fixture.db.prepare(`
      INSERT INTO knowledge_fact_evidence (
        id, workspace_id, fact_id, request_id, document_id, document_version_id,
        chunk_id, quote, confidence, extractor_provider_id, extractor_model_id,
        created_at, stale_at
      ) VALUES (?, 'child-only-workspace', 'missing-fact', 'missing-request',
        'missing-document', 'missing-version', 'missing-chunk', 'child-only quote', 0.5,
        'provider', 'model', ?, NULL)
    `).run('7'.repeat(64), now);
    fixture.db.prepare(`
      INSERT INTO knowledge_enrichment_attempts (
        id, request_id, attempt_number, started_at, heartbeat_at, finished_at,
        outcome, error_code, error_message
      ) VALUES ('orphan-enrichment-attempt', 'missing-request', 1, ?, ?, ?,
        'completed', NULL, NULL)
    `).run(now, now, now);
    fixture.db.prepare(`
      INSERT INTO knowledge_document_index_attempts (
        id, document_version_id, attempt_number, tokenizer_version, started_at,
        finished_at, outcome, error_code
      ) VALUES ('orphan-index-attempt', 'missing-version', 1, ?, ?, ?, 'indexed', NULL)
    `).run(KnowledgeDocumentIndexTokenizer.CjkBigramV1, now, now);
    fixture.db.prepare(`
      INSERT INTO knowledge_document_chunks_fts (
        storage_id, chunk_id, index_generation_id, workspace_id,
        document_id, document_version_id, search_text
      ) VALUES ('orphan-storage', 'orphan-chunk', 'missing-generation',
        'child-only-workspace', 'missing-document', 'missing-version', 'child only')
    `).run();
    fixture.db.prepare(`
      INSERT INTO knowledge_ingestion_job_attempts (
        id, job_id, attempt_number, started_at, finished_at, outcome,
        error_code, error_message
      ) VALUES ('orphan-ingestion-attempt', 'missing-job', 1, ?, ?, 'completed', NULL, NULL)
    `).run(now, now);
    fixture.db.prepare(`
      INSERT INTO knowledge_document_versions (
        id, document_id, content_hash, managed_path, mime_type, file_size,
        source_mtime, parser, extracted_text, extraction_partial, created_at
      ) VALUES ('orphan-version', 'missing-document', NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, 0, ?)
    `).run(now);
    const list = fixture.db.transaction(() =>
      fixture.coordinator.listOrphanedWorkspaceIdsInCurrentTransaction());
    expect(list()).toEqual([]);

    fixture.coordinator.cleanupOrphansAtStartup();

    expect(fixture.workspaceStore.getWorkspace(fixture.workspace.id)).not.toBeNull();
    for (const table of [
      'knowledge_trusted_profile_index_attempts',
      'knowledge_fact_profile_projection_ledger',
      'knowledge_fact_projection_support_group_roots',
      'knowledge_enrichment_request_facts',
      'knowledge_fact_evidence',
      'knowledge_enrichment_attempts',
      'knowledge_document_index_attempts',
      'knowledge_document_chunks_fts',
      'knowledge_ingestion_job_attempts',
      'knowledge_document_versions',
    ]) {
      expect(countRows(fixture.db, table), table).toBe(0);
    }
    fixture.db.close();
  });

  test('removes complete invalid index and ingestion parent chains in one startup sweep', () => {
    const fixture = createFixture();
    const now = '2026-07-13T02:30:00.000Z';
    fixture.db.pragma('foreign_keys = OFF');
    fixture.db.prepare(`
      INSERT INTO knowledge_document_index_state (
        document_version_id, workspace_id, document_id, status, tokenizer_version,
        chunk_count, attempt_count, active_attempt_id, published_generation_id,
        error_code, requested_at, started_at, heartbeat_at, completed_at, updated_at
      ) VALUES ('missing-chain-version', ?, 'missing-chain-document', 'indexing', ?,
        1, 1, 'missing-chain-attempt', NULL, NULL, ?, ?, ?, NULL, ?)
    `).run(
      fixture.workspace.id,
      KnowledgeDocumentIndexTokenizer.CjkBigramV1,
      now,
      now,
      now,
      now,
    );
    fixture.db.prepare(`
      INSERT INTO knowledge_document_index_attempts (
        id, document_version_id, attempt_number, tokenizer_version,
        started_at, finished_at, outcome, error_code
      ) VALUES ('missing-chain-attempt', 'missing-chain-version', 1, ?, ?, NULL,
        'running', NULL)
    `).run(KnowledgeDocumentIndexTokenizer.CjkBigramV1, now);
    fixture.db.prepare(`
      INSERT INTO knowledge_document_chunks (
        storage_id, id, index_generation_id, workspace_id, document_id,
        document_version_id, ordinal, content, start_offset, end_offset,
        page_number, sheet_name, slide_number, heading_path_json, checksum, created_at
      ) VALUES ('missing-chain-storage', 'missing-chain-chunk', 'missing-chain-attempt', ?,
        'missing-chain-document', 'missing-chain-version', 0, 'chain', 0, 5,
        NULL, NULL, NULL, NULL, ?, ?)
    `).run(fixture.workspace.id, 'b'.repeat(64), now);
    fixture.db.prepare(`
      INSERT INTO knowledge_document_chunks_fts (
        storage_id, chunk_id, index_generation_id, workspace_id,
        document_id, document_version_id, search_text
      ) VALUES ('missing-chain-storage', 'missing-chain-chunk', 'missing-chain-attempt', ?,
        'missing-chain-document', 'missing-chain-version', 'chain')
    `).run(fixture.workspace.id);
    const ingestion = fixture.ingestionJobStore.createJob({
      workspaceId: fixture.workspace.id,
      documentId: 'missing-chain-document',
      documentVersionId: 'missing-chain-version',
    }, now);
    fixture.ingestionJobStore.claimNextJob(now);

    fixture.coordinator.cleanupOrphansAtStartup();

    for (const table of [
      'knowledge_document_index_attempts',
      'knowledge_document_index_state',
      'knowledge_document_chunks_fts',
      'knowledge_document_chunks',
    ]) {
      expect(countRows(fixture.db, table), table).toBe(0);
    }
    expect(fixture.ingestionJobStore.getJob(ingestion.id)).toBeNull();
    fixture.db.close();
  });

  test('uses the shared ordered inventory for a row-missing full Plan 2 orphan', () => {
    const fixture = createFixture();
    seedDocumentRoots(fixture);
    fixture.db.pragma('foreign_keys = OFF');
    fixture.db.prepare('DELETE FROM enterprise_lead_workspaces WHERE id = ?')
      .run(fixture.workspace.id);
    fixture.stages.splice(0);

    fixture.coordinator.cleanupOrphansAtStartup();

    for (const table of cleanupInventoryTables) {
      expect(countRows(fixture.db, table), table).toBe(0);
    }
    expect(fixture.stages).toEqual([
      KnowledgeWorkspaceCleanupStage.TrustedIndex,
      KnowledgeWorkspaceCleanupStage.Projections,
      KnowledgeWorkspaceCleanupStage.Facts,
      KnowledgeWorkspaceCleanupStage.EnrichmentRequests,
      KnowledgeWorkspaceCleanupStage.DocumentIndex,
      KnowledgeWorkspaceCleanupStage.IngestionJobs,
      KnowledgeWorkspaceCleanupStage.Documents,
      KnowledgeWorkspaceCleanupStage.Migration,
      KnowledgeWorkspaceCleanupStage.ProfileFieldRevisions,
      KnowledgeWorkspaceCleanupStage.VectorScope,
    ]);
    fixture.db.close();
  });

  test('fails closed on a noncanonical orphan id before mutating canonical workspace data', () => {
    const fixture = createFixture();
    fixture.db.prepare(`
      UPDATE enterprise_lead_workspaces
      SET id = 'workspace-a'
      WHERE id = ?
    `).run(fixture.workspace.id);
    const canonical = fixture.documentStore.createDocumentWithVersion({
      workspaceId: 'workspace-a',
      displayName: 'canonical.txt',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: {
        contentHash: 'd'.repeat(64),
        managedPath: 'blobs/canonical',
        mimeType: 'text/plain',
        fileSize: 9,
        sourceMtime: null,
        parser: 'text',
        extractedText: 'canonical',
        extractionPartial: false,
      },
    });
    fixture.indexStore.scheduleCurrentVersion({
      workspaceId: 'workspace-a',
      documentId: canonical.document.id,
      documentVersionId: canonical.version.id,
    });
    const canonicalScope = buildEnterpriseLeadWorkspaceKnowledgeScopeId('workspace-a');
    fixture.vectorStore.upsertSources(canonicalScope, [{
      sourceId: 'canonical-source',
      sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
      label: 'canonical',
      content: 'canonical content',
    }]);

    fixture.db.pragma('foreign_keys = OFF');
    fixture.db.prepare(`
      INSERT INTO knowledge_documents (
        id, workspace_id, legacy_source_id, legacy_source_snapshot_json,
        display_name, source_mode, original_path, current_version_id,
        revision, status, created_at, updated_at, deleted_at
      ) VALUES (
        'noncanonical-orphan-document', 'workspace-a ', NULL, NULL,
        'noncanonical-orphan.txt', ?, NULL, 'noncanonical-orphan-version',
        1, ?, '2026-07-13T04:00:00.000Z', '2026-07-13T04:00:00.000Z', NULL
      )
    `).run(KnowledgeDocumentSourceMode.Managed, KnowledgeDocumentStatus.Ready);

    const readCanonicalInventory = () => ({
      workspace: fixture.db.prepare(`
        SELECT * FROM enterprise_lead_workspaces WHERE id = 'workspace-a'
      `).get(),
      documents: fixture.db.prepare(`
        SELECT * FROM knowledge_documents WHERE workspace_id = 'workspace-a' ORDER BY id
      `).all(),
      index: fixture.db.prepare(`
        SELECT * FROM knowledge_document_index_state
        WHERE workspace_id = 'workspace-a'
        ORDER BY document_version_id
      `).all(),
      vectors: fixture.db.prepare(`
        SELECT * FROM content_knowledge_chunks WHERE scope_id = ? ORDER BY id
      `).all(canonicalScope),
    });
    const fullBefore = snapshotInventory(fixture.db);
    const canonicalBefore = readCanonicalInventory();

    expect(() => fixture.coordinator.cleanupOrphansAtStartup()).toThrowError(
      expect.objectContaining({ code: 'workspace_cleanup_failed' }),
    );

    expect(snapshotInventory(fixture.db)).toEqual(fullBefore);
    expect(readCanonicalInventory()).toEqual(canonicalBefore);
    expect(fixture.stages).toEqual([]);
    fixture.db.close();
  });

  test('fails closed on malformed reserved scopes, then discovers and cleans a vector-only orphan once', () => {
    const fixture = createFixture();
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const orphanId = 'vector-only-orphan';
    const orphanScope = buildEnterpriseLeadWorkspaceKnowledgeScopeId(orphanId);
    fixture.vectorStore.upsertSources(orphanScope, [{
      sourceId: 'orphan-source',
      sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
      label: 'orphan',
      content: 'orphan content',
    }]);
    fixture.vectorStore.upsertSources('enterprise-workspace:', [{
      sourceId: 'malformed-source',
      sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
      label: 'malformed',
      content: 'must survive',
    }]);
    const readOrphans = fixture.db.transaction(() =>
      fixture.coordinator.listOrphanedWorkspaceIdsInCurrentTransaction());
    expect(() => fixture.coordinator.listOrphanedWorkspaceIdsInCurrentTransaction()).toThrow();
    expect(() => readOrphans()).toThrowError(
      expect.objectContaining({ code: 'workspace_cleanup_failed' }),
    );

    let malformedError: unknown;
    try {
      fixture.coordinator.cleanupOrphansAtStartup();
    } catch (error) {
      malformedError = error;
    }
    expect(malformedError).toMatchObject({ code: 'workspace_cleanup_failed' });
    expect(JSON.stringify(malformedError)).not.toMatch(/must survive|SQL|private|path/i);
    expect(fixture.stages).toEqual([]);
    expect(fixture.workspaceStore.getWorkspace(fixture.workspace.id)).not.toBeNull();
    expect(fixture.db.prepare(`
      SELECT COUNT(*) AS count FROM content_knowledge_chunks WHERE scope_id = ?
    `).get(orphanScope)).toEqual({ count: 1 });
    expect(fixture.db.prepare(`
      SELECT COUNT(*) AS count FROM content_knowledge_chunks WHERE scope_id = 'enterprise-workspace:'
    `).get()).toEqual({ count: 1 });

    fixture.vectorStore.deleteScope('enterprise-workspace:');
    expect(readOrphans()).toContain(orphanId);
    expect(readOrphans().filter(id => id === orphanId)).toHaveLength(1);
    fixture.coordinator.cleanupOrphansAtStartup();

    expect(fixture.db.prepare(`
      SELECT COUNT(*) AS count FROM content_knowledge_chunks WHERE scope_id = ?
    `).get(orphanScope)).toEqual({ count: 0 });
    expect(fixture.db.prepare(`
      SELECT COUNT(*) AS count FROM content_knowledge_chunks WHERE scope_id = 'enterprise-workspace:'
    `).get()).toEqual({ count: 0 });
    const loggedValues = [...consoleWarn.mock.calls, ...consoleError.mock.calls].flat();
    expect(loggedValues.some(value => value instanceof Error)).toBe(false);
    expect(JSON.stringify(loggedValues)).not.toMatch(/must survive|SECRET|SQL|private|path/i);
    consoleWarn.mockRestore();
    consoleError.mockRestore();
    fixture.db.close();
  });
});
