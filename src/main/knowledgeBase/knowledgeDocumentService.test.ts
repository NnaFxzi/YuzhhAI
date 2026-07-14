import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadWorkspaceType,
} from '../../shared/enterpriseLeadWorkspace/constants';
import { buildEnterpriseLeadWorkspaceKnowledgeScopeId } from '../../shared/enterpriseLeadWorkspace/constants';
import {
  KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES,
  KnowledgeBaseErrorCode,
  KnowledgeDocumentIndexErrorCode,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentIndexTokenizer,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeDocumentVisibility,
  KnowledgeEnrichmentAttemptOutcome,
  KnowledgeEnrichmentStatus,
  KnowledgeFactDomain,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
  KnowledgeIngestionJobStatus,
} from '../../shared/knowledgeBase/constants';
import type { CreateKnowledgeDocumentInput } from '../../shared/knowledgeBase/types';
import { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import { ContentKnowledgeSourceType } from '../libs/contentKnowledgeRetrieval';
import { ContentKnowledgeVectorStore } from '../libs/contentKnowledgeVectorStore';
import { applySqliteConnectionPolicy } from '../libs/sqliteConnectionPolicy';
import {
  buildKnowledgeDocumentLegacySourceId,
  EnterpriseLeadKnowledgeCompatibilityAdapter,
} from './enterpriseLeadKnowledgeCompatibilityAdapter';
import {
  EnterpriseLeadKnowledgeFactProjector,
  KnowledgeFactProjectorStage,
} from './enterpriseLeadKnowledgeFactProjector';
import { runKnowledgeDocumentIndexUntilIdle } from './knowledgeDocumentIndexRunner';
import { KnowledgeDocumentIndexStore } from './knowledgeDocumentIndexStore';
import {
  KnowledgeDocumentService,
  KnowledgeDocumentServiceError,
} from './knowledgeDocumentService';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';
import { KnowledgeEnrichmentRequestStore } from './knowledgeEnrichmentRequestStore';
import { KnowledgeFactProjectionStore } from './knowledgeFactProjectionStore';
import { KnowledgeFactStore } from './knowledgeFactStore';
import { KnowledgeIngestionJobStore } from './knowledgeIngestionJobStore';
import { KnowledgeManagedFileStore } from './knowledgeManagedFileStore';
import {
  KnowledgeSelectionTokenStore,
  type SelectedKnowledgeFileInput,
} from './knowledgeSelectionTokenStore';

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

const Task11DocumentLifecycleStage = {
  AfterRevalidationBeforeFirstWrite: 'after_revalidation_before_first_write',
  AfterRequestsStale: 'after_requests_stale',
  AfterEvidenceStale: 'after_evidence_stale',
  AfterIngestionCancelled: 'after_ingestion_cancelled',
  AfterRawSourceDeleted: 'after_raw_source_deleted',
  AfterLocalIndexDeleted: 'after_local_index_deleted',
  AfterDocumentMutated: 'after_document_mutated',
  AfterLocalIndexScheduled: 'after_local_index_scheduled',
  AfterCompatibilityProjection: 'after_compatibility_projection',
} as const;

describe('KnowledgeDocumentService', () => {
  let db: Database.Database;
  let tempDir: string;
  let workspaceStore: EnterpriseLeadWorkspaceStore;
  let documentStore: KnowledgeDocumentStore;
  let indexStore: KnowledgeDocumentIndexStore;
  let jobStore: KnowledgeIngestionJobStore;
  let managedFileStore: KnowledgeManagedFileStore;
  let selectionTokenStore: KnowledgeSelectionTokenStore;
  let compatibilityAdapter: EnterpriseLeadKnowledgeCompatibilityAdapter;
  let enrichmentRequestStore: KnowledgeEnrichmentRequestStore;
  let factStore: KnowledgeFactStore;
  let vectorStore: ContentKnowledgeVectorStore;
  let onJobsQueued: ReturnType<typeof vi.fn>;
  let onIndexQueued: ReturnType<typeof vi.fn>;
  let abortActiveAttemptForVersion: ReturnType<typeof vi.fn>;
  let replaceWorkspaceDocumentSource: ReturnType<typeof vi.fn>;
  let service: KnowledgeDocumentService;
  let workspaceId: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-document-service-'));
    workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    workspaceId = workspaceStore.createWorkspace({
      name: '本地知识库',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile: emptyProfile,
      extractionSources: [],
      enabledAgentRoles: [],
    }).id;
    documentStore = new KnowledgeDocumentStore(db);
    indexStore = new KnowledgeDocumentIndexStore(db, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });
    jobStore = new KnowledgeIngestionJobStore(db);
    enrichmentRequestStore = new KnowledgeEnrichmentRequestStore(db);
    factStore = new KnowledgeFactStore(db, { requestStore: enrichmentRequestStore });
    vectorStore = new ContentKnowledgeVectorStore(db);
    managedFileStore = new KnowledgeManagedFileStore(path.join(tempDir, 'managed'));
    selectionTokenStore = new KnowledgeSelectionTokenStore();
    compatibilityAdapter = new EnterpriseLeadKnowledgeCompatibilityAdapter(workspaceStore);
    onJobsQueued = vi.fn(() => expect(db.inTransaction).toBe(false));
    onIndexQueued = vi.fn(() => expect(db.inTransaction).toBe(false));
    abortActiveAttemptForVersion = vi.fn(() => expect(db.inTransaction).toBe(false));
    replaceWorkspaceDocumentSource = vi.fn(() => expect(db.inTransaction).toBe(false));
    service = createService();
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const createService = (
    overrides: Partial<ConstructorParameters<typeof KnowledgeDocumentService>[0]> = {},
  ): KnowledgeDocumentService =>
    new KnowledgeDocumentService({
      db,
      documentStore,
      indexStore,
      jobStore,
      managedFileStore,
      selectionTokenStore,
      compatibilityAdapter,
      workspaceExists: id => Boolean(workspaceStore.getWorkspace(id)),
      enrichmentRequestStore,
      factStore,
      enrichmentLifecycle: { abortActiveAttemptForVersion },
      workspaceVectorLifecycle: {
        deleteWorkspaceDocumentSources: (targetWorkspaceId: string, sourceIds: readonly string[]) =>
          vectorStore.deleteWorkspaceDocumentSources(
            buildEnterpriseLeadWorkspaceKnowledgeScopeId(targetWorkspaceId),
            sourceIds,
          ),
        replaceWorkspaceDocumentSource,
      },
      onJobsQueued,
      onIndexQueued,
      ...overrides,
    });

  const writeFile = async (fileName: string, content: Buffer | string): Promise<string> => {
    const filePath = path.join(tempDir, fileName);
    await fs.writeFile(filePath, content);
    return filePath;
  };

  const selectedFile = async (filePath: string): Promise<SelectedKnowledgeFileInput> => {
    const stat = await fs.stat(filePath);
    return {
      absolutePath: filePath,
      displayName: path.basename(filePath),
      fileSize: stat.size,
      sourceMtime: stat.mtimeMs,
    };
  };

  const issueSelection = async (filePaths: string[]) =>
    selectionTokenStore.issue(
      7,
      await Promise.all(filePaths.map(filePath => selectedFile(filePath))),
    );

  const createStoredDocumentInputVersion = (): CreateKnowledgeDocumentInput['version'] => ({
    contentHash: 'a'.repeat(64),
    managedPath: `blobs/aa/${'a'.repeat(64)}`,
    mimeType: 'application/pdf',
    fileSize: 10,
    sourceMtime: 100,
    parser: 'pdf',
    extractedText: 'stored text',
    extractionPartial: false,
  });

  const createStoredDocument = (
    overrides: Partial<CreateKnowledgeDocumentInput & { legacySourceSnapshotJson: string }> = {},
  ) =>
    documentStore.createDocumentWithVersion({
      workspaceId,
      displayName: 'stored.pdf',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: createStoredDocumentInputVersion(),
      ...overrides,
    });

  const scheduleIndex = (target: ReturnType<typeof createStoredDocument>): void => {
    indexStore.scheduleCurrentVersion({
      workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
    });
  };

  const insertReviewRequiredFact = (target: ReturnType<typeof createStoredDocument>) => {
    const now = '2026-07-12T00:00:00.000Z';
    const request = enrichmentRequestStore.createOrGetAuthorizedRequest({
      workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      providerId: 'provider-a',
      modelId: 'model-a',
      routingFingerprint: 'f'.repeat(64),
      now,
    });
    const claim = enrichmentRequestStore.claimNext(now);
    if (!claim || claim.request.id !== request.id) {
      throw new Error('Expected active enrichment request');
    }
    const factId = 'fact-lifecycle';
    db.prepare(`
      INSERT INTO knowledge_facts (
        id, originating_request_id, workspace_id, domain, value, normalized_value,
        review_status, source_kind, revision, conflict_group_key, projection_state,
        created_at, reviewed_at, updated_at, tombstoned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, NULL, ?, NULL)
    `).run(
      factId,
      request.id,
      workspaceId,
      KnowledgeFactDomain.ProductList,
      'Industrial robots',
      'industrial robots',
      KnowledgeFactReviewStatus.Pending,
      KnowledgeFactSourceKind.Extracted,
      KnowledgeFactProjectionState.None,
      now,
      now,
    );
    db.prepare(`
      INSERT INTO knowledge_enrichment_request_facts (request_id, fact_id)
      VALUES (?, ?)
    `).run(request.id, factId);
    db.prepare(`
      INSERT INTO knowledge_fact_evidence (
        id, workspace_id, fact_id, request_id, document_id, document_version_id,
        chunk_id, quote, confidence, extractor_provider_id, extractor_model_id,
        created_at, stale_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      'e'.repeat(64),
      workspaceId,
      factId,
      request.id,
      target.document.id,
      target.version.id,
      'chunk-lifecycle',
      'builds industrial robots',
      0.9,
      'provider-a',
      'model-a',
      now,
    );
    return { attemptId: claim.attempt.id, factId, requestId: request.id };
  };

  const failIndex = (target: ReturnType<typeof createStoredDocument>): void => {
    scheduleIndex(target);
    const claim = indexStore.claimNext();
    if (!claim || claim.state.documentVersionId !== target.version.id) {
      throw new Error('Expected failed-index test target to be claimed');
    }
    indexStore.failAttempt({
      documentVersionId: target.version.id,
      attemptId: claim.attempt.id,
      errorCode: KnowledgeDocumentIndexErrorCode.ProcessingFailed,
    });
  };

  test('imports valid siblings when one selected file disappears', async () => {
    const goodPath = await writeFile('good.pdf', '%PDF-1.7\nlocal');
    const missingPath = await writeFile('missing.pdf', '%PDF-1.7\nmissing');
    const selection = await issueSelection([goodPath, missingPath]);
    await fs.rm(missingPath);

    const result = await service.importSelection({
      ownerId: 7,
      workspaceId,
      selectionToken: selection.selectionToken,
    });

    expect(result).toMatchObject({ importedCount: 1, failedCount: 1 });
    expect(result.items).toEqual([
      expect.objectContaining({ success: true, itemId: selection.files[0]?.itemId }),
      expect.objectContaining({
        success: false,
        itemId: selection.files[1]?.itemId,
        fileName: 'missing.pdf',
        errorCode: KnowledgeBaseErrorCode.SelectedFileMissing,
      }),
    ]);
    expect(documentStore.listDocuments(workspaceId)).toHaveLength(1);
    expect(jobStore.listCurrentJobs(workspaceId)).toHaveLength(1);
    expect(onJobsQueued).toHaveBeenCalledTimes(1);
    expect(workspaceStore.getWorkspace(workspaceId)?.extractionSources[0]).not.toHaveProperty(
      'text',
    );
  });

  test('imports only selected item ids from an authorized token', async () => {
    const firstPath = await writeFile('first.pdf', '%PDF-1.7\nfirst');
    const secondPath = await writeFile('second.pdf', '%PDF-1.7\nsecond');
    const selection = await issueSelection([firstPath, secondPath]);
    const secondItemId = selection.files[1]?.itemId;

    expect(secondItemId).toBeTruthy();

    const result = await service.importSelection({
      ownerId: 7,
      workspaceId,
      selectionToken: selection.selectionToken,
      itemIds: [secondItemId!],
    });

    expect(result).toMatchObject({ importedCount: 1, failedCount: 0 });
    expect(result.items).toEqual([
      expect.objectContaining({ success: true, itemId: secondItemId }),
    ]);
    expect(documentStore.listDocuments(workspaceId)).toEqual([
      expect.objectContaining({ displayName: 'second.pdf' }),
    ]);
    expect(jobStore.listCurrentJobs(workspaceId)).toHaveLength(1);
    expect(workspaceStore.getWorkspace(workspaceId)?.extractionSources).toEqual([
      expect.objectContaining({ fileName: 'second.pdf' }),
    ]);
  });

  test('rejects a changed selected file and consumed-token replay', async () => {
    const filePath = await writeFile('changed.pdf', '%PDF-1.7\nfirst');
    const selection = await issueSelection([filePath]);
    await fs.appendFile(filePath, '\nchanged');

    const first = await service.importSelection({
      ownerId: 7,
      workspaceId,
      selectionToken: selection.selectionToken,
    });

    expect(first.items[0]).toMatchObject({
      success: false,
      errorCode: KnowledgeBaseErrorCode.SelectedFileChanged,
    });
    await expect(
      service.importSelection({
        ownerId: 7,
        workspaceId,
        selectionToken: selection.selectionToken,
      }),
    ).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.InvalidSelectionToken });
  });

  test('enforces logical workspace quota before managed persistence', async () => {
    createStoredDocument({
      legacySourceId: 'quota-existing',
      version: {
        contentHash: 'q'.repeat(64),
        managedPath: `blobs/qq/${'q'.repeat(64)}`,
        mimeType: 'application/pdf',
        fileSize: KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES - 5,
        sourceMtime: 100,
        parser: 'pdf',
        extractedText: null,
        extractionPartial: false,
      },
    });
    const filePath = await writeFile('quota.pdf', '%PDF-1.7\n1234567890');
    const selection = await issueSelection([filePath]);

    const result = await service.importSelection({
      ownerId: 7,
      workspaceId,
      selectionToken: selection.selectionToken,
    });

    expect(result.items[0]).toMatchObject({
      success: false,
      errorCode: KnowledgeBaseErrorCode.WorkspaceQuotaExceeded,
    });
    expect(documentStore.listDocuments(workspaceId)).toHaveLength(1);
  });

  test('rechecks workspace quota atomically after the managed copy completes', async () => {
    const filePath = await writeFile('concurrent-quota.txt', '1234567890');
    const selection = await issueSelection([filePath]);
    const activeBytes = vi
      .spyOn(documentStore, 'getActiveManagedBytes')
      .mockReturnValueOnce(KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES - 10)
      .mockReturnValueOnce(KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES - 9);

    const result = await service.importSelection({
      ownerId: 7,
      workspaceId,
      selectionToken: selection.selectionToken,
    });

    expect(result.items[0]).toMatchObject({
      success: false,
      errorCode: KnowledgeBaseErrorCode.WorkspaceQuotaExceeded,
    });
    expect(activeBytes).toHaveBeenCalledTimes(2);
    expect(documentStore.listDocuments(workspaceId)).toEqual([]);
  });

  test('retries managed import publication from a fresh WAL snapshot exactly once', async () => {
    const databasePath = path.join(tempDir, 'import-contention.sqlite');
    const localDb = new Database(databasePath);
    let competingDb: Database.Database | null = null;
    try {
      applySqliteConnectionPolicy(localDb);
      const localWorkspaceStore = new EnterpriseLeadWorkspaceStore(localDb);
      const localWorkspaceId = localWorkspaceStore.createWorkspace({
        name: '并发导入知识库',
        type: EnterpriseLeadWorkspaceType.EnterpriseLead,
        profile: emptyProfile,
        extractionSources: [],
        enabledAgentRoles: [],
      }).id;
      const localDocumentStore = new KnowledgeDocumentStore(localDb);
      const localIndexStore = new KnowledgeDocumentIndexStore(localDb, {
        resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
      });
      const localJobStore = new KnowledgeIngestionJobStore(localDb);
      const localManagedFileStore = new KnowledgeManagedFileStore(
        path.join(tempDir, 'managed-contention'),
      );
      const localSelectionTokenStore = new KnowledgeSelectionTokenStore();
      const localCompatibilityAdapter = new EnterpriseLeadKnowledgeCompatibilityAdapter(
        localWorkspaceStore,
      );
      const localOnJobsQueued = vi.fn();
      const busyRetryDelay = vi.fn(async () => undefined);
      const localServiceOptions = {
        db: localDb,
        documentStore: localDocumentStore,
        indexStore: localIndexStore,
        jobStore: localJobStore,
        managedFileStore: localManagedFileStore,
        selectionTokenStore: localSelectionTokenStore,
        compatibilityAdapter: localCompatibilityAdapter,
        workspaceExists: id => Boolean(localWorkspaceStore.getWorkspace(id)),
        onJobsQueued: localOnJobsQueued,
        busyRetryDelay,
      };
      const localService = new KnowledgeDocumentService(localServiceOptions);
      localDb.exec(`
        CREATE TABLE import_contention_probe (value INTEGER NOT NULL);
        INSERT INTO import_contention_probe (value) VALUES (0);
      `);
      competingDb = new Database(databasePath);
      applySqliteConnectionPolicy(competingDb);
      competingDb.pragma('busy_timeout = 0');
      const updateProbe = competingDb.prepare(
        'UPDATE import_contention_probe SET value = value + 1',
      );
      const originalPrepare = localDb.prepare.bind(localDb);
      let quotaReadCount = 0;
      Object.defineProperty(localDb, 'prepare', {
        configurable: true,
        value: (source: string) => {
          const statement = originalPrepare(source);
          if (!source.includes('SUM(version.file_size)')) {
            return statement;
          }
          return new Proxy(statement, {
            get(targetStatement, property) {
              if (property !== 'get') {
                return Reflect.get(targetStatement, property, targetStatement);
              }
              return (...parameters: unknown[]) => {
                const row = targetStatement.get(...parameters);
                quotaReadCount += 1;
                if (quotaReadCount >= 2 && quotaReadCount <= 5) {
                  updateProbe.run();
                }
                return row;
              };
            },
          });
        },
      });
      const filePath = await writeFile('snapshot-import.pdf', '%PDF-1.7\ncontention');
      const selection = localSelectionTokenStore.issue(
        7,
        [await selectedFile(filePath)],
      );

      const result = await localService.importSelection({
        ownerId: 7,
        workspaceId: localWorkspaceId,
        selectionToken: selection.selectionToken,
      });

      expect(quotaReadCount).toBe(6);
      expect(busyRetryDelay).toHaveBeenCalledWith(25);
      expect(result).toMatchObject({ importedCount: 1, failedCount: 0 });
      expect(result.items[0]).toMatchObject({
        success: true,
        document: { displayName: 'snapshot-import.pdf' },
      });
      expect(localDocumentStore.listDocuments(localWorkspaceId)).toHaveLength(1);
      expect(localJobStore.listCurrentJobs(localWorkspaceId)).toHaveLength(1);
      expect(localWorkspaceStore.getWorkspace(localWorkspaceId)?.extractionSources).toHaveLength(1);
      expect(localOnJobsQueued).toHaveBeenCalledTimes(1);
    } finally {
      competingDb?.close();
      localDb.close();
    }
  });

  test('rejects a source that changes while it is copied into managed storage', async () => {
    const filePath = await writeFile('copy-race.txt', 'initial content');
    const selection = await issueSelection([filePath]);
    const importFile = managedFileStore.importFile.bind(managedFileStore);
    vi.spyOn(managedFileStore, 'importFile').mockImplementation(async absolutePath => {
      const blob = await importFile(absolutePath);
      await fs.appendFile(absolutePath, '\nchanged during copy');
      return blob;
    });

    const result = await service.importSelection({
      ownerId: 7,
      workspaceId,
      selectionToken: selection.selectionToken,
    });

    expect(result.items[0]).toMatchObject({
      success: false,
      errorCode: KnowledgeBaseErrorCode.SelectedFileChanged,
    });
    expect(documentStore.listDocuments(workspaceId)).toEqual([]);
  });

  test('stores legacy DOC as completed without text and does not queue extraction', async () => {
    const filePath = await writeFile('legacy.doc', Buffer.from('d0cf11e0a1b11ae1', 'hex'));
    const selection = await issueSelection([filePath]);

    const result = await service.importSelection({
      ownerId: 7,
      workspaceId,
      selectionToken: selection.selectionToken,
    });

    expect(result.items[0]).toMatchObject({
      success: true,
      document: {
        currentJob: null,
        status: KnowledgeDocumentStatus.CompletedWithoutText,
      },
    });
    const imported = result.items[0];
    expect(imported?.success).toBe(true);
    if (imported?.success) {
      expect(imported.document.currentJob).toBeNull();
      expect(imported.document.localIndex?.status).toBe(
        KnowledgeDocumentIndexStatus.NotApplicable,
      );
    }
    expect(jobStore.listCurrentJobs(workspaceId)).toEqual([]);
    expect(onJobsQueued).not.toHaveBeenCalled();
    expect(onIndexQueued).not.toHaveBeenCalled();
  });

  test('projects current-version index state with one workspace query', () => {
    const first = createStoredDocument({ displayName: 'first.txt' });
    const second = createStoredDocument({ displayName: 'second.txt' });
    scheduleIndex(first);
    scheduleIndex(second);
    runKnowledgeDocumentIndexUntilIdle(indexStore);
    const listStates = vi.spyOn(indexStore, 'listStates');
    const getState = vi.spyOn(indexStore, 'getState');

    const documents = service.listDocuments({
      workspaceId,
      visibility: KnowledgeDocumentVisibility.Active,
    });

    expect(listStates).toHaveBeenCalledTimes(1);
    expect(getState).not.toHaveBeenCalled();
    expect(
      documents.every(document => document.localIndex?.status === KnowledgeDocumentIndexStatus.Indexed),
    ).toBe(true);
  });

  test('lists 1,000 document summaries without chunk payloads or N+1 state reads', () => {
    let indexedTarget: ReturnType<typeof createStoredDocument> | null = null;
    for (let index = 0; index < 1_000; index += 1) {
      const target = createStoredDocument({ displayName: `document-${index}.txt` });
      if (index === 0) {
        indexedTarget = target;
      }
    }
    if (!indexedTarget) {
      throw new Error('Expected an indexed projection target');
    }
    scheduleIndex(indexedTarget);
    runKnowledgeDocumentIndexUntilIdle(indexStore);
    const listStates = vi.spyOn(indexStore, 'listStates');
    const getState = vi.spyOn(indexStore, 'getState');

    const documents = service.listDocuments({
      workspaceId,
      visibility: KnowledgeDocumentVisibility.Active,
    });
    const payload = JSON.stringify(documents);

    expect(documents).toHaveLength(1_000);
    expect(
      documents.find(document => document.id === indexedTarget.document.id)?.localIndex?.status,
    ).toBe(KnowledgeDocumentIndexStatus.Indexed);
    expect(listStates).toHaveBeenCalledTimes(1);
    expect(getState).not.toHaveBeenCalled();
    expect(payload).not.toContain('extractedText');
    expect(payload).not.toContain('managedPath');
    expect(payload).not.toContain('activeAttemptId');
    expect(payload).not.toContain('heartbeatAt');
  });

  test('projects exact-version enrichment and stale prior-version markers with fixed bulk reads', () => {
    const targets = Array.from({ length: 1_000 }, (_, index) =>
      createStoredDocument({ displayName: `enrichment-${index}.txt` }));
    const currentTarget = targets[0]!;
    const staleHistoryTarget = targets[1]!;
    insertReviewRequiredFact(targets[2]!);
    const currentRequest = enrichmentRequestStore.createOrGetAuthorizedRequest({
      workspaceId,
      documentId: currentTarget.document.id,
      documentVersionId: currentTarget.version.id,
      providerId: 'provider-a',
      modelId: 'model-a',
      routingFingerprint: 'a'.repeat(64),
    });
    const priorRequest = enrichmentRequestStore.createOrGetAuthorizedRequest({
      workspaceId,
      documentId: staleHistoryTarget.document.id,
      documentVersionId: staleHistoryTarget.version.id,
      providerId: 'provider-a',
      modelId: 'model-a',
      routingFingerprint: 'b'.repeat(64),
    });
    enrichmentRequestStore.markVersionStale(staleHistoryTarget.version.id);
    documentStore.addVersion(
      staleHistoryTarget.document.id,
      staleHistoryTarget.document.revision,
      {
        ...createStoredDocumentInputVersion(),
        contentHash: '9'.repeat(64),
        extractedText: 'current replacement text',
      },
      KnowledgeDocumentStatus.Ready,
    );
    const summaries = vi.spyOn(enrichmentRequestStore, 'listLatestSummariesForVersions');
    const staleHistory = vi.fn(() => new Set([staleHistoryTarget.document.id]));
    Object.assign(enrichmentRequestStore, {
      listDocumentIdsWithStalePriorVersionExtraction: staleHistory,
    });

    const documents = service.listDocuments({
      workspaceId,
      visibility: KnowledgeDocumentVisibility.Active,
    });
    const current = documents.find(item => item.id === currentTarget.document.id)!;
    const prior = documents.find(item => item.id === staleHistoryTarget.document.id)!;

    expect(documents).toHaveLength(1_000);
    expect(summaries).toHaveBeenCalledTimes(1);
    expect(staleHistory).toHaveBeenCalledTimes(1);
    expect(current.enrichment).toMatchObject({ requestId: currentRequest.id });
    expect(current.hasStalePriorVersionExtraction).toBe(false);
    expect(prior.enrichment).toBeNull();
    expect(prior.hasStalePriorVersionExtraction).toBe(true);
    expect(JSON.stringify(prior)).not.toContain(priorRequest.id);
    expect(JSON.stringify(documents)).not.toMatch(/quote|chunkId|evidencePreview|extractor/i);
    expect(JSON.stringify(documents)).not.toContain('builds industrial robots');
    expect(JSON.stringify(documents)).not.toContain('Industrial robots');
  });

  test('returns display-safe lists and loads extracted text only in details', () => {
    const created = createStoredDocument();
    jobStore.createJob({
      workspaceId,
      documentId: created.document.id,
      documentVersionId: created.version.id,
    });

    const listed = service.listDocuments({
      workspaceId,
      visibility: KnowledgeDocumentVisibility.Active,
    });
    const details = service.getDocumentDetails({ documentId: created.document.id });

    expect(listed[0]).toMatchObject({
      id: created.document.id,
      currentJob: expect.objectContaining({ documentVersionId: created.version.id }),
    });
    expect(listed[0]).not.toHaveProperty('extractedText');
    expect(listed[0]).not.toHaveProperty('originalPath');
    expect(listed[0]).not.toHaveProperty('managedPath');
    expect(listed[0]?.localIndex).toBeNull();
    expect(details.activeVersion).toMatchObject({ extractedText: 'stored text' });
    expect(details.activeVersion).not.toHaveProperty('managedPath');
  });

  test('soft deletes with queued cancellation, restores, and retries the active version', () => {
    const created = createStoredDocument({ status: KnowledgeDocumentStatus.Pending });
    const job = jobStore.createJob({
      workspaceId,
      documentId: created.document.id,
      documentVersionId: created.version.id,
    });
    compatibilityAdapter.upsertDocument(
      workspaceId,
      service.listDocuments({ workspaceId, visibility: KnowledgeDocumentVisibility.Active })[0]!,
    );

    const deleted = service.deleteDocument({
      documentId: created.document.id,
      expectedRevision: created.document.revision,
    });
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.currentJob?.status).toBe(KnowledgeIngestionJobStatus.Cancelled);
    expect(workspaceStore.getWorkspace(workspaceId)?.extractionSources).toEqual([]);

    const restored = service.restoreDocument({
      documentId: created.document.id,
      expectedRevision: deleted.revision,
    });
    expect(restored.deletedAt).toBeNull();

    const retried = service.retryDocument({
      documentId: created.document.id,
      documentVersionId: created.version.id,
    });
    expect(retried.status).toBe(KnowledgeDocumentStatus.Pending);
    expect(retried.currentJob?.id).toBe(job.id);
    expect(retried.currentJob?.status).toBe(KnowledgeIngestionJobStatus.Queued);
    expect(onJobsQueued).toHaveBeenCalledTimes(1);
  });

  test('stales model work and evidence before atomically soft deleting local and raw indexes', () => {
    const target = createStoredDocument({ displayName: 'lifecycle-delete.txt' });
    const { attemptId, factId, requestId } = insertReviewRequiredFact(target);
    scheduleIndex(target);
    runKnowledgeDocumentIndexUntilIdle(indexStore);
    const sourceId = buildKnowledgeDocumentLegacySourceId(target.document.id);
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId);
    vectorStore.replaceWorkspaceDocumentSources(scopeId, [{
      sourceId,
      sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
      label: target.document.displayName,
      content: 'legacy raw lifecycle content',
    }, {
      sourceId: 'unrelated-raw',
      sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
      label: 'unrelated',
      content: 'unrelated raw content',
    }]);
    vectorStore.replaceTrustedSources(scopeId, [{
      sourceId: 'trusted-profile',
      sourceType: ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
      label: 'trusted',
      content: 'trusted profile content',
    }]);
    const markRequestStale = vi.spyOn(
      enrichmentRequestStore,
      'markVersionStaleInCurrentTransaction',
    );
    const markEvidenceStale = vi.spyOn(factStore, 'markVersionEvidenceStaleInCurrentTransaction');
    const rawDelete = vi.spyOn(vectorStore, 'deleteWorkspaceDocumentSources');

    const deleted = service.deleteDocument({
      documentId: target.document.id,
      expectedRevision: target.document.revision,
    });

    expect(deleted.deletedAt).not.toBeNull();
    expect(markRequestStale).toHaveBeenCalledTimes(1);
    expect(markEvidenceStale).toHaveBeenCalledTimes(1);
    expect(markRequestStale.mock.invocationCallOrder[0]).toBeLessThan(
      markEvidenceStale.mock.invocationCallOrder[0]!,
    );
    expect(rawDelete).toHaveBeenCalledTimes(1);
    expect(enrichmentRequestStore.getSummary(requestId)).toMatchObject({
      status: KnowledgeEnrichmentStatus.Stale,
    });
    expect(enrichmentRequestStore.listAttempts(requestId)).toEqual([
      expect.objectContaining({ id: attemptId, outcome: KnowledgeEnrichmentAttemptOutcome.Cancelled }),
    ]);
    expect(factStore.getFact(factId)).toMatchObject({ revision: 2 });
    expect(db.prepare(`
      SELECT stale_at FROM knowledge_fact_evidence WHERE fact_id = ?
    `).get(factId)).toEqual({ stale_at: expect.any(String) });
    expect(indexStore.getState(target.version.id)).toBeNull();
    const vectorRows = db.prepare(`
      SELECT source_id, source_type, content
      FROM content_knowledge_chunks
      WHERE scope_id = ?
      ORDER BY source_id
    `).all(scopeId);
    expect(vectorRows).toEqual([
      expect.objectContaining({ source_id: 'trusted-profile' }),
      expect.objectContaining({ source_id: 'unrelated-raw' }),
    ]);
    expect(abortActiveAttemptForVersion).toHaveBeenCalledTimes(1);
    expect(abortActiveAttemptForVersion).toHaveBeenCalledWith(target.version.id);
  });

  test('deletes the exact persisted legacy raw source id and preserves generated decoys and trusted rows', () => {
    const target = createStoredDocument({
      displayName: 'legacy-id.txt',
      legacySourceId: 'persisted-legacy-source',
    });
    const generatedDecoy = buildKnowledgeDocumentLegacySourceId(target.document.id);
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId);
    vectorStore.replaceWorkspaceDocumentSources(scopeId, [{
      sourceId: 'persisted-legacy-source',
      sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
      label: 'target',
      content: 'target legacy raw',
    }, {
      sourceId: generatedDecoy,
      sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
      label: 'decoy',
      content: 'generated decoy raw',
    }]);
    vectorStore.replaceTrustedSources(scopeId, [{
      sourceId: 'trusted-legacy-neighbor',
      sourceType: ContentKnowledgeSourceType.WorkspaceRule,
      label: 'trusted',
      content: 'trusted neighbor',
    }]);

    service.deleteDocument({
      documentId: target.document.id,
      expectedRevision: target.document.revision,
    });

    expect(db.prepare(`
      SELECT source_id, content FROM content_knowledge_chunks
      WHERE scope_id = ? ORDER BY source_id
    `).all(scopeId)).toEqual([
      expect.objectContaining({ source_id: generatedDecoy, content: 'generated decoy raw' }),
      expect.objectContaining({ source_id: 'trusted-legacy-neighbor', content: 'trusted neighbor' }),
    ]);
  });

  test('rolls back delete and publishes no lifecycle notification when stale marking fails', () => {
    const target = createStoredDocument({ displayName: 'stale-failure.txt' });
    insertReviewRequiredFact(target);
    scheduleIndex(target);
    runKnowledgeDocumentIndexUntilIdle(indexStore);
    const sourceId = buildKnowledgeDocumentLegacySourceId(target.document.id);
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId);
    vectorStore.replaceWorkspaceDocumentSources(scopeId, [{
      sourceId,
      sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
      label: target.document.displayName,
      content: 'must survive rollback',
    }]);
    vi.spyOn(factStore, 'markVersionEvidenceStaleInCurrentTransaction').mockImplementation(() => {
      throw new Error('SECRET stale failure SQL /private/path');
    });

    expect(() => service.deleteDocument({
      documentId: target.document.id,
      expectedRevision: target.document.revision,
    })).toThrowError(expect.objectContaining({ code: KnowledgeBaseErrorCode.PersistenceFailed }));

    expect(documentStore.getDocument(target.document.id)).toMatchObject({
      deletedAt: null,
      revision: target.document.revision,
    });
    expect(indexStore.getState(target.version.id)?.status).toBe(KnowledgeDocumentIndexStatus.Indexed);
    expect(db.prepare(`
      SELECT content FROM content_knowledge_chunks
      WHERE scope_id = ? AND source_id = ?
    `).get(scopeId, sourceId)).toEqual({ content: 'must survive rollback' });
    expect(abortActiveAttemptForVersion).not.toHaveBeenCalled();
  });

  test.each(Object.values(Task11DocumentLifecycleStage).slice(1))(
    'rolls back replacement at lifecycle stage %s with no abort, wake, or raw publication',
    stageToFail => {
      const target = createStoredDocument({ displayName: `fault-${stageToFail}.txt` });
      const { requestId } = insertReviewRequiredFact(target);
      scheduleIndex(target);
      runKnowledgeDocumentIndexUntilIdle(indexStore);
      const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId);
      const sourceId = buildKnowledgeDocumentLegacySourceId(target.document.id);
      vectorStore.replaceWorkspaceDocumentSources(scopeId, [{
        sourceId,
        sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
        label: target.document.displayName,
        content: 'raw content must roll back',
      }]);
      onIndexQueued.mockClear();
      service = createService({
        onLifecycleStage: (stage: string) => {
          if (stage === stageToFail) {
            throw new Error('SECRET lifecycle stage SQL /private/path');
          }
        },
      } as Partial<ConstructorParameters<typeof KnowledgeDocumentService>[0]>);

      expect(() => service.replaceParsedDocumentVersion({
        documentId: target.document.id,
        expectedRevision: target.document.revision,
        version: {
          ...createStoredDocumentInputVersion(),
          contentHash: '6'.repeat(64),
          extractedText: 'replacement that must roll back',
        },
      })).toThrowError(expect.objectContaining({ code: KnowledgeBaseErrorCode.PersistenceFailed }));

      expect(documentStore.getDocument(target.document.id)).toMatchObject({
        currentVersionId: target.version.id,
        revision: target.document.revision,
      });
      expect(enrichmentRequestStore.getSummary(requestId)?.status).toBe(
        KnowledgeEnrichmentStatus.Running,
      );
      expect(indexStore.getState(target.version.id)?.status).toBe(
        KnowledgeDocumentIndexStatus.Indexed,
      );
      expect(db.prepare(`
        SELECT content FROM content_knowledge_chunks
        WHERE scope_id = ? AND source_id = ?
      `).get(scopeId, sourceId)).toEqual({ content: 'raw content must roll back' });
      expect(abortActiveAttemptForVersion).not.toHaveBeenCalled();
      expect(replaceWorkspaceDocumentSource).not.toHaveBeenCalled();
      expect(onIndexQueued).not.toHaveBeenCalled();
    },
  );

  test('stales only the replaced version before switching and publishes the ready current version after commit', () => {
    const target = createStoredDocument({ displayName: 'replace-lifecycle.txt' });
    const { factId, requestId } = insertReviewRequiredFact(target);
    scheduleIndex(target);
    runKnowledgeDocumentIndexUntilIdle(indexStore);
    const sourceId = buildKnowledgeDocumentLegacySourceId(target.document.id);
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId);
    vectorStore.replaceWorkspaceDocumentSources(scopeId, [{
      sourceId,
      sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
      label: target.document.displayName,
      content: 'old externally searchable content',
    }]);
    replaceWorkspaceDocumentSource.mockImplementation((targetWorkspaceId, documentId) => {
      expect(db.inTransaction).toBe(false);
      expect(targetWorkspaceId).toBe(workspaceId);
      expect(documentId).toBe(target.document.id);
      expect(db.prepare(`
        SELECT COUNT(*) AS count FROM content_knowledge_chunks
        WHERE scope_id = ? AND source_id = ?
      `).get(scopeId, sourceId)).toEqual({ count: 0 });
      const current = documentStore.getDocument(documentId)!;
      expect(documentStore.getVersion(current.currentVersionId)).toMatchObject({
        extractedText: 'new ready replacement',
      });
    });

    const replaced = service.replaceParsedDocumentVersion({
      documentId: target.document.id,
      expectedRevision: target.document.revision,
      version: {
        ...createStoredDocumentInputVersion(),
        contentHash: '8'.repeat(64),
        extractedText: 'new ready replacement',
      },
    });

    expect(replaced.currentVersionId).not.toBe(target.version.id);
    expect(enrichmentRequestStore.getSummary(requestId)?.status).toBe(
      KnowledgeEnrichmentStatus.Stale,
    );
    expect(factStore.getFact(factId)).toMatchObject({ revision: 2 });
    expect(abortActiveAttemptForVersion).toHaveBeenCalledWith(target.version.id);
    expect(replaceWorkspaceDocumentSource).toHaveBeenCalledTimes(1);
    expect(enrichmentRequestStore.listLatestSummariesForVersions(
      workspaceId,
      [replaced.currentVersionId],
    )).toEqual(new Map());
  });

  test('restore preserves stale knowledge history and schedules only local/raw indexing after commit', () => {
    const target = createStoredDocument({ displayName: 'restore-history.txt' });
    const { factId, requestId } = insertReviewRequiredFact(target);
    const deleted = service.deleteDocument({
      documentId: target.document.id,
      expectedRevision: target.document.revision,
    });
    const staleAt = (db.prepare(`
      SELECT stale_at FROM knowledge_fact_evidence WHERE fact_id = ?
    `).get(factId) as { stale_at: string }).stale_at;
    const factRevision = factStore.getFact(factId)!.revision;
    abortActiveAttemptForVersion.mockClear();
    replaceWorkspaceDocumentSource.mockClear();

    const restored = service.restoreDocument({
      documentId: deleted.id,
      expectedRevision: deleted.revision,
    });

    expect(restored.deletedAt).toBeNull();
    expect(enrichmentRequestStore.getSummary(requestId)?.status).toBe(
      KnowledgeEnrichmentStatus.Stale,
    );
    expect(factStore.getFact(factId)?.revision).toBe(factRevision);
    expect(db.prepare(`
      SELECT stale_at FROM knowledge_fact_evidence WHERE fact_id = ?
    `).get(factId)).toEqual({ stale_at: staleAt });
    expect(abortActiveAttemptForVersion).not.toHaveBeenCalled();
    expect(replaceWorkspaceDocumentSource).toHaveBeenCalledTimes(1);
    expect(onIndexQueued).toHaveBeenCalled();
  });

  test('publishes ready parsed raw content even when its later local index attempt fails', () => {
    const target = createStoredDocument({ displayName: 'raw-survives-index-failure.txt' });
    const replaced = service.replaceParsedDocumentVersion({
      documentId: target.document.id,
      expectedRevision: target.document.revision,
      version: {
        ...createStoredDocumentInputVersion(),
        contentHash: '3'.repeat(64),
        extractedText: 'ready parsed content independent of local index',
      },
    });
    expect(replaceWorkspaceDocumentSource).toHaveBeenCalledTimes(1);
    const claim = indexStore.claimNext();
    expect(claim?.state.documentVersionId).toBe(replaced.currentVersionId);
    indexStore.failAttempt({
      documentVersionId: replaced.currentVersionId,
      attemptId: claim!.attempt.id,
      errorCode: KnowledgeDocumentIndexErrorCode.ProcessingFailed,
    });

    expect(documentStore.getDocument(target.document.id)?.status).toBe(
      KnowledgeDocumentStatus.Ready,
    );
    expect(indexStore.getState(replaced.currentVersionId)?.status).toBe(
      KnowledgeDocumentIndexStatus.Failed,
    );
    expect(replaceWorkspaceDocumentSource).toHaveBeenCalledTimes(1);
  });

  test('contains raw publication failures with a stable code and never re-exposes old content', () => {
    const target = createStoredDocument({ displayName: 'raw-refresh-failure.txt' });
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId);
    const sourceId = buildKnowledgeDocumentLegacySourceId(target.document.id);
    vectorStore.replaceWorkspaceDocumentSources(scopeId, [{
      sourceId,
      sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
      label: 'old',
      content: 'old stale visible content',
    }]);
    replaceWorkspaceDocumentSource.mockImplementation(() => {
      throw new Error('SECRET raw refresh /private/path SQL apiKey');
    });
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const replaced = service.replaceParsedDocumentVersion({
        documentId: target.document.id,
        expectedRevision: target.document.revision,
        version: {
          ...createStoredDocumentInputVersion(),
          contentHash: '7'.repeat(64),
          extractedText: 'new unavailable content',
        },
      });
      expect(replaced.currentVersionId).not.toBe(target.version.id);
      expect(db.prepare(`
        SELECT COUNT(*) AS count FROM content_knowledge_chunks
        WHERE scope_id = ? AND source_id = ?
      `).get(scopeId, sourceId)).toEqual({ count: 0 });
      expect(consoleWarn).toHaveBeenCalledWith(
        '[KnowledgeDocumentLifecycle]',
        expect.objectContaining({ code: 'raw_source_refresh_failed' }),
      );
      expect(JSON.stringify(consoleWarn.mock.calls)).not.toMatch(/SECRET|private|SQL|apiKey/);
    } finally {
      consoleWarn.mockRestore();
    }
  });

  test('handles rejected asynchronous raw publication with only the fixed safe code', async () => {
    const target = createStoredDocument({ displayName: 'async-raw-refresh-failure.txt' });
    let rejectRefresh: ((reason?: unknown) => void) | undefined;
    const refreshPromise = new Promise<void>((_resolve, reject) => {
      rejectRefresh = reject;
    });
    replaceWorkspaceDocumentSource.mockReturnValue(refreshPromise);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unhandledRejection = vi.fn();
    process.on('unhandledRejection', unhandledRejection);
    try {
      const replaced = service.replaceParsedDocumentVersion({
        documentId: target.document.id,
        expectedRevision: target.document.revision,
        version: {
          ...createStoredDocumentInputVersion(),
          contentHash: '8'.repeat(64),
          extractedText: 'new content with async publication failure',
        },
      });
      const shutdownService = service as KnowledgeDocumentService & {
        shutdown(): Promise<void>;
      };
      const firstShutdown = shutdownService.shutdown();
      const secondShutdown = shutdownService.shutdown();
      expect(secondShutdown).toBe(firstShutdown);
      let shutdownCompleted = false;
      void firstShutdown.then(() => { shutdownCompleted = true; });
      await Promise.resolve();
      expect(shutdownCompleted).toBe(false);

      rejectRefresh?.(new Error(
        'SECRET async raw refresh SELECT * FROM private_table /private/company.pdf apiKey',
      ));
      await firstShutdown;

      expect(unhandledRejection).not.toHaveBeenCalled();
      expect(consoleWarn).toHaveBeenCalledTimes(1);
      expect(consoleWarn).toHaveBeenCalledWith(
        '[KnowledgeDocumentLifecycle]',
        { code: 'raw_source_refresh_failed' },
      );
      expect(JSON.stringify(consoleWarn.mock.calls)).not.toMatch(
        /SECRET|private_table|private\/company|apiKey/,
      );

      replaceWorkspaceDocumentSource.mockClear();
      service.replaceParsedDocumentVersion({
        documentId: replaced.id,
        expectedRevision: replaced.revision,
        version: {
          ...createStoredDocumentInputVersion(),
          contentHash: '9'.repeat(64),
          extractedText: 'post-seal content must not publish',
        },
      });
      expect(replaceWorkspaceDocumentSource).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandledRejection);
      consoleWarn.mockRestore();
    }
  });

  test('retries the complete lifecycle from a fresh WAL snapshot when raw publication commits first', () => {
    const databasePath = path.join(tempDir, 'document-lifecycle-wal.sqlite');
    const lifecycleDb = new Database(databasePath);
    applySqliteConnectionPolicy(lifecycleDb);
    lifecycleDb.pragma('journal_mode = WAL');
    lifecycleDb.pragma('busy_timeout = 0');
    const lifecycleWorkspaceStore = new EnterpriseLeadWorkspaceStore(lifecycleDb);
    const lifecycleWorkspace = lifecycleWorkspaceStore.createWorkspace({
      name: 'lifecycle WAL',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile: emptyProfile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const lifecycleDocumentStore = new KnowledgeDocumentStore(lifecycleDb);
    const lifecycleIndexStore = new KnowledgeDocumentIndexStore(lifecycleDb, {
      resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    });
    const lifecycleJobStore = new KnowledgeIngestionJobStore(lifecycleDb);
    const lifecycleRequestStore = new KnowledgeEnrichmentRequestStore(lifecycleDb);
    const lifecycleFactStore = new KnowledgeFactStore(lifecycleDb, {
      requestStore: lifecycleRequestStore,
    });
    const lifecycleVectorStore = new ContentKnowledgeVectorStore(lifecycleDb);
    const requestStalePrimitive = vi.spyOn(
      lifecycleRequestStore,
      'markVersionStaleInCurrentTransaction',
    );
    const evidenceStalePrimitive = vi.spyOn(
      lifecycleFactStore,
      'markVersionEvidenceStaleInCurrentTransaction',
    );
    const rawDeletePrimitive = vi.spyOn(
      lifecycleVectorStore,
      'deleteWorkspaceDocumentSources',
    );
    const indexDeletePrimitive = vi.spyOn(
      lifecycleIndexStore,
      'deactivateVersionInCurrentTransaction',
    );
    const documentDeletePrimitive = vi.spyOn(
      lifecycleDocumentStore,
      'softDeleteDocumentInCurrentTransaction',
    );
    const lifecycleTarget = lifecycleDocumentStore.createDocumentWithVersion({
      workspaceId: lifecycleWorkspace.id,
      displayName: 'race.txt',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: createStoredDocumentInputVersion(),
    });
    lifecycleRequestStore.createOrGetAuthorizedRequest({
      workspaceId: lifecycleWorkspace.id,
      documentId: lifecycleTarget.document.id,
      documentVersionId: lifecycleTarget.version.id,
      providerId: 'provider-lifecycle-wal',
      modelId: 'model-lifecycle-wal',
      routingFingerprint: 'e'.repeat(64),
    });
    lifecycleIndexStore.scheduleCurrentVersion({
      workspaceId: lifecycleWorkspace.id,
      documentId: lifecycleTarget.document.id,
      documentVersionId: lifecycleTarget.version.id,
    });
    runKnowledgeDocumentIndexUntilIdle(lifecycleIndexStore);
    const sourceId = buildKnowledgeDocumentLegacySourceId(lifecycleTarget.document.id);
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(lifecycleWorkspace.id);
    const lifecycleAbort = vi.fn();
    const lifecycleWake = vi.fn();
    let lifecycleAttempts = 0;
    const lifecycleStageCounts = new Map<string, number>();
    let publisherDb: Database.Database | null = null;
    const lifecycleService = new KnowledgeDocumentService({
      db: lifecycleDb,
      documentStore: lifecycleDocumentStore,
      indexStore: lifecycleIndexStore,
      jobStore: lifecycleJobStore,
      managedFileStore,
      selectionTokenStore,
      compatibilityAdapter: new EnterpriseLeadKnowledgeCompatibilityAdapter(
        lifecycleWorkspaceStore,
      ),
      workspaceExists: id => Boolean(lifecycleWorkspaceStore.getWorkspace(id)),
      enrichmentRequestStore: lifecycleRequestStore,
      factStore: lifecycleFactStore,
      enrichmentLifecycle: { abortActiveAttemptForVersion: lifecycleAbort },
      workspaceVectorLifecycle: {
        deleteWorkspaceDocumentSources: (_workspaceId: string, sourceIds: readonly string[]) =>
          lifecycleVectorStore.deleteWorkspaceDocumentSources(scopeId, sourceIds),
        replaceWorkspaceDocumentSource: vi.fn(),
      },
      onIndexQueued: lifecycleWake,
      onLifecycleStage: (stage: string) => {
        lifecycleStageCounts.set(stage, (lifecycleStageCounts.get(stage) ?? 0) + 1);
        if (stage !== Task11DocumentLifecycleStage.AfterRevalidationBeforeFirstWrite) return;
        lifecycleAttempts += 1;
        if (publisherDb) return;
        publisherDb = new Database(databasePath);
        applySqliteConnectionPolicy(publisherDb);
        publisherDb.pragma('journal_mode = WAL');
        publisherDb.pragma('busy_timeout = 0');
        new ContentKnowledgeVectorStore(publisherDb).replaceWorkspaceDocumentSources(scopeId, [{
          sourceId,
          sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
          label: 'concurrent raw',
          content: 'concurrent raw publication',
        }]);
      },
    } as ConstructorParameters<typeof KnowledgeDocumentService>[0]);

    const deleted = lifecycleService.deleteDocument({
      documentId: lifecycleTarget.document.id,
      expectedRevision: lifecycleTarget.document.revision,
    });

    expect(lifecycleAttempts).toBe(2);
    expect(lifecycleStageCounts.get(
      Task11DocumentLifecycleStage.AfterRevalidationBeforeFirstWrite,
    )).toBe(2);
    for (const stage of [
      Task11DocumentLifecycleStage.AfterRequestsStale,
      Task11DocumentLifecycleStage.AfterEvidenceStale,
      Task11DocumentLifecycleStage.AfterIngestionCancelled,
      Task11DocumentLifecycleStage.AfterRawSourceDeleted,
      Task11DocumentLifecycleStage.AfterLocalIndexDeleted,
      Task11DocumentLifecycleStage.AfterDocumentMutated,
      Task11DocumentLifecycleStage.AfterCompatibilityProjection,
    ]) {
      expect(lifecycleStageCounts.get(stage), stage).toBe(1);
    }
    expect(deleted.deletedAt).not.toBeNull();
    expect(lifecycleDb.prepare(`
      SELECT COUNT(*) AS count FROM content_knowledge_chunks
      WHERE scope_id = ? AND source_id = ?
    `).get(scopeId, sourceId)).toEqual({ count: 0 });
    expect(lifecycleAbort).toHaveBeenCalledTimes(1);
    expect(lifecycleWake).toHaveBeenCalledTimes(1);
    expect(requestStalePrimitive).toHaveBeenCalledTimes(2);
    expect(evidenceStalePrimitive).toHaveBeenCalledTimes(1);
    expect(rawDeletePrimitive).toHaveBeenCalledTimes(1);
    expect(indexDeletePrimitive).toHaveBeenCalledTimes(1);
    expect(documentDeletePrimitive).toHaveBeenCalledTimes(1);

    const lateTarget = lifecycleDocumentStore.createDocumentWithVersion({
      workspaceId: lifecycleWorkspace.id,
      displayName: 'late-publisher.txt',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: {
        ...createStoredDocumentInputVersion(),
        contentHash: '5'.repeat(64),
        extractedText: 'captured old late publication',
      },
    });
    let deleteCommittedAtLease = false;
    let lateLeaseAttempts = 0;
    const latePublisher = new ContentKnowledgeVectorStore(publisherDb!, {
      onLeaseStage: (stage: string) => {
        if (stage !== 'after_raw_lease_revalidation_before_first_write') return;
        lateLeaseAttempts += 1;
        if (deleteCommittedAtLease) return;
        lifecycleService.deleteDocument({
          documentId: lateTarget.document.id,
          expectedRevision: lateTarget.document.revision,
        });
        deleteCommittedAtLease = true;
      },
    } as never);
    const latePublished = (latePublisher as ContentKnowledgeVectorStore & {
      replaceWorkspaceDocumentSource(workspaceId: string, documentId: string): boolean;
    }).replaceWorkspaceDocumentSource(lifecycleWorkspace.id, lateTarget.document.id);

    expect(deleteCommittedAtLease).toBe(true);
    expect(lateLeaseAttempts).toBe(2);
    expect(latePublished).toBe(false);
    expect(lifecycleDb.prepare(`
      SELECT COUNT(*) AS count FROM content_knowledge_chunks
      WHERE scope_id = ? AND source_id = ?
    `).get(scopeId, buildKnowledgeDocumentLegacySourceId(lateTarget.document.id)))
      .toEqual({ count: 0 });

    const replaceTarget = lifecycleDocumentStore.createDocumentWithVersion({
      workspaceId: lifecycleWorkspace.id,
      displayName: 'replace-race.txt',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: {
        ...createStoredDocumentInputVersion(),
        contentHash: '4'.repeat(64),
        extractedText: 'old replace race content',
      },
    });
    const replaceSourceId = buildKnowledgeDocumentLegacySourceId(replaceTarget.document.id);
    let replacementPublicationCommitted = false;
    let replacementAttempts = 0;
    const replacementRawRefresh = vi.fn();
    const replacementAbort = vi.fn();
    const replacementService = new KnowledgeDocumentService({
      db: lifecycleDb,
      documentStore: lifecycleDocumentStore,
      indexStore: lifecycleIndexStore,
      jobStore: lifecycleJobStore,
      managedFileStore,
      selectionTokenStore,
      compatibilityAdapter: new EnterpriseLeadKnowledgeCompatibilityAdapter(
        lifecycleWorkspaceStore,
      ),
      workspaceExists: id => Boolean(lifecycleWorkspaceStore.getWorkspace(id)),
      enrichmentRequestStore: lifecycleRequestStore,
      factStore: lifecycleFactStore,
      enrichmentLifecycle: { abortActiveAttemptForVersion: replacementAbort },
      workspaceVectorLifecycle: {
        deleteWorkspaceDocumentSources: (_workspaceId: string, sourceIds: readonly string[]) =>
          lifecycleVectorStore.deleteWorkspaceDocumentSources(scopeId, sourceIds),
        replaceWorkspaceDocumentSource: replacementRawRefresh,
      },
      onIndexQueued: vi.fn(),
      onLifecycleStage: (stage: string) => {
        if (stage !== Task11DocumentLifecycleStage.AfterRevalidationBeforeFirstWrite) return;
        replacementAttempts += 1;
        if (replacementPublicationCommitted) return;
        new ContentKnowledgeVectorStore(publisherDb!).replaceWorkspaceDocumentSources(scopeId, [{
          sourceId: replaceSourceId,
          sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
          label: 'old concurrent replacement raw',
          content: 'old concurrent replacement raw',
        }]);
        replacementPublicationCommitted = true;
      },
    } as ConstructorParameters<typeof KnowledgeDocumentService>[0]);

    const replaced = replacementService.replaceParsedDocumentVersion({
      documentId: replaceTarget.document.id,
      expectedRevision: replaceTarget.document.revision,
      version: {
        ...createStoredDocumentInputVersion(),
        contentHash: '2'.repeat(64),
        extractedText: 'new replace race content',
      },
    });
    expect(replacementAttempts).toBe(2);
    expect(replaced.currentVersionId).not.toBe(replaceTarget.version.id);
    expect(lifecycleDb.prepare(`
      SELECT COUNT(*) AS count FROM content_knowledge_chunks
      WHERE scope_id = ? AND source_id = ?
    `).get(scopeId, replaceSourceId)).toEqual({ count: 0 });
    expect(replacementAbort).toHaveBeenCalledTimes(1);
    expect(replacementRawRefresh).toHaveBeenCalledTimes(1);

    const replaceFirstTarget = lifecycleDocumentStore.createDocumentWithVersion({
      workspaceId: lifecycleWorkspace.id,
      displayName: 'replace-first-race.txt',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: {
        ...createStoredDocumentInputVersion(),
        contentHash: '1'.repeat(64),
        extractedText: 'captured version before replace',
      },
    });
    let replacementCommittedAtLease = false;
    let replacementLeaseAttempts = 0;
    const replaceFirstPublisher = new ContentKnowledgeVectorStore(publisherDb!, {
      onLeaseStage: (stage: string) => {
        if (stage !== 'after_raw_lease_revalidation_before_first_write') return;
        replacementLeaseAttempts += 1;
        if (replacementCommittedAtLease) return;
        replacementService.replaceParsedDocumentVersion({
          documentId: replaceFirstTarget.document.id,
          expectedRevision: replaceFirstTarget.document.revision,
          version: {
            ...createStoredDocumentInputVersion(),
            contentHash: '0'.repeat(64),
            extractedText: 'replacement committed before old publisher',
          },
        });
        replacementCommittedAtLease = true;
      },
    } as never);
    const oldPublication = (replaceFirstPublisher as ContentKnowledgeVectorStore & {
      replaceWorkspaceDocumentSource(workspaceId: string, documentId: string): boolean;
    }).replaceWorkspaceDocumentSource(
      lifecycleWorkspace.id,
      replaceFirstTarget.document.id,
    );
    expect(replacementCommittedAtLease).toBe(true);
    expect(replacementLeaseAttempts).toBe(2);
    expect(oldPublication).toBe(false);

    const seedConfirmableFact = (
      suffix: string,
      domain: typeof KnowledgeFactDomain[keyof typeof KnowledgeFactDomain],
      value: string,
    ) => {
      const identityCharacter = suffix.startsWith('confirm') ? 'c' : 'd';
      const target = lifecycleDocumentStore.createDocumentWithVersion({
        workspaceId: lifecycleWorkspace.id,
        displayName: `confirm-${suffix}.txt`,
        sourceMode: KnowledgeDocumentSourceMode.Managed,
        status: KnowledgeDocumentStatus.Ready,
        version: {
          ...createStoredDocumentInputVersion(),
          contentHash: identityCharacter.repeat(64),
          extractedText: `evidence for ${value}`,
        },
      });
      const request = lifecycleRequestStore.createOrGetAuthorizedRequest({
        workspaceId: lifecycleWorkspace.id,
        documentId: target.document.id,
        documentVersionId: target.version.id,
        providerId: 'provider-wal',
        modelId: 'model-wal',
        routingFingerprint: identityCharacter.repeat(64),
      });
      lifecycleDb.prepare(`
        UPDATE knowledge_enrichment_requests
        SET status = ?, progress = 100, valid_candidate_count = 1
        WHERE id = ?
      `).run(KnowledgeEnrichmentStatus.ReviewRequired, request.id);
      const factId = `fact-${suffix}`;
      lifecycleDb.prepare(`
        INSERT INTO knowledge_facts (
          id, originating_request_id, workspace_id, domain, value, normalized_value,
          review_status, source_kind, revision, conflict_group_key, projection_state,
          created_at, reviewed_at, updated_at, tombstoned_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, NULL, ?, NULL)
      `).run(
        factId,
        request.id,
        lifecycleWorkspace.id,
        domain,
        value,
        value.toLocaleLowerCase(),
        KnowledgeFactReviewStatus.Pending,
        KnowledgeFactSourceKind.Extracted,
        KnowledgeFactProjectionState.None,
        '2026-07-13T03:00:00.000Z',
        '2026-07-13T03:00:00.000Z',
      );
      lifecycleDb.prepare(`
        INSERT INTO knowledge_enrichment_request_facts (request_id, fact_id) VALUES (?, ?)
      `).run(request.id, factId);
      lifecycleDb.prepare(`
        INSERT INTO knowledge_fact_evidence (
          id, workspace_id, fact_id, request_id, document_id, document_version_id,
          chunk_id, quote, confidence, extractor_provider_id, extractor_model_id,
          created_at, stale_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.9, 'provider-wal', 'model-wal', ?, NULL)
      `).run(
        createHash('sha256').update(suffix).digest('hex'),
        lifecycleWorkspace.id,
        factId,
        request.id,
        target.document.id,
        target.version.id,
        `chunk-${suffix}`,
        `evidence for ${value}`,
        '2026-07-13T03:00:00.000Z',
      );
      return { factId, requestId: request.id, target };
    };
    const publisherRequestStore = new KnowledgeEnrichmentRequestStore(publisherDb!);
    const publisherFactStore = new KnowledgeFactStore(publisherDb!, {
      requestStore: publisherRequestStore,
    });
    const publisherProjectionStore = new KnowledgeFactProjectionStore(publisherDb!);
    const publisherWorkspaceStore = new EnterpriseLeadWorkspaceStore(publisherDb!);
    const trustedWake = vi.fn();
    const publisherProjector = new EnterpriseLeadKnowledgeFactProjector(
      publisherDb!,
      publisherFactStore,
      publisherProjectionStore,
      publisherWorkspaceStore.getProfileRevisionStore(),
      { onTrustedRefreshCommitted: trustedWake },
    );
    const confirmFirst = seedConfirmableFact(
      'confirm-first',
      KnowledgeFactDomain.ProductList,
      'Concurrent confirmed product',
    );
    let confirmationCommitted = false;
    let confirmLifecycleAttempts = 0;
    const confirmLifecycleService = new KnowledgeDocumentService({
      db: lifecycleDb,
      documentStore: lifecycleDocumentStore,
      indexStore: lifecycleIndexStore,
      jobStore: lifecycleJobStore,
      managedFileStore,
      selectionTokenStore,
      compatibilityAdapter: new EnterpriseLeadKnowledgeCompatibilityAdapter(
        lifecycleWorkspaceStore,
      ),
      workspaceExists: id => Boolean(lifecycleWorkspaceStore.getWorkspace(id)),
      enrichmentRequestStore: lifecycleRequestStore,
      factStore: lifecycleFactStore,
      enrichmentLifecycle: { abortActiveAttemptForVersion: vi.fn() },
      workspaceVectorLifecycle: {
        deleteWorkspaceDocumentSources: (_workspaceId: string, sourceIds: readonly string[]) =>
          lifecycleVectorStore.deleteWorkspaceDocumentSources(scopeId, sourceIds),
        replaceWorkspaceDocumentSource: vi.fn(),
      },
      onIndexQueued: vi.fn(),
      onLifecycleStage: (stage: string) => {
        if (stage !== Task11DocumentLifecycleStage.AfterRevalidationBeforeFirstWrite) return;
        confirmLifecycleAttempts += 1;
        if (confirmationCommitted) return;
        publisherProjector.confirmFact({ factId: confirmFirst.factId, expectedRevision: 1 });
        confirmationCommitted = true;
      },
    } as ConstructorParameters<typeof KnowledgeDocumentService>[0]);
    confirmLifecycleService.deleteDocument({
      documentId: confirmFirst.target.document.id,
      expectedRevision: confirmFirst.target.document.revision,
    });
    expect(confirmLifecycleAttempts).toBe(2);
    expect(trustedWake).toHaveBeenCalledTimes(1);
    expect(lifecycleRequestStore.getSummary(confirmFirst.requestId)?.status).toBe(
      KnowledgeEnrichmentStatus.Stale,
    );
    expect(lifecycleDb.prepare(`
      SELECT stale_at FROM knowledge_fact_evidence WHERE fact_id = ?
    `).get(confirmFirst.factId)).toEqual({ stale_at: expect.any(String) });

    const deleteFirst = seedConfirmableFact(
      'delete-first',
      KnowledgeFactDomain.SellingPoints,
      'Must never project after delete',
    );
    let deleteWonProjectorLease = false;
    let projectorAttempts = 0;
    const deleteFirstProjector = new EnterpriseLeadKnowledgeFactProjector(
      publisherDb!,
      publisherFactStore,
      publisherProjectionStore,
      publisherWorkspaceStore.getProfileRevisionStore(),
      {
        onTrustedRefreshCommitted: trustedWake,
        onStage: stage => {
          if (stage !== KnowledgeFactProjectorStage.AfterRevalidationBeforeFirstWrite) return;
          projectorAttempts += 1;
          if (deleteWonProjectorLease) return;
          confirmLifecycleService.deleteDocument({
            documentId: deleteFirst.target.document.id,
            expectedRevision: deleteFirst.target.document.revision,
          });
          deleteWonProjectorLease = true;
        },
      },
    );
    expect(() => deleteFirstProjector.confirmFact({
      factId: deleteFirst.factId,
      expectedRevision: 1,
    })).toThrowError(expect.objectContaining({ code: KnowledgeBaseErrorCode.FactEvidenceStale }));
    expect(deleteWonProjectorLease).toBe(true);
    expect(projectorAttempts).toBe(2);
    expect(publisherWorkspaceStore.getWorkspace(lifecycleWorkspace.id)?.profile.sellingPoints)
      .not.toContain('Must never project after delete');

    const confirmBeforeReplace = seedConfirmableFact(
      'confirm-replace',
      KnowledgeFactDomain.ApplicationScenarios,
      'Concurrent confirmed replacement scenario',
    );
    let confirmBeforeReplaceCommitted = false;
    let confirmReplaceLifecycleAttempts = 0;
    const confirmReplaceAbort = vi.fn();
    const confirmReplaceRawRefresh = vi.fn();
    const confirmReplaceService = new KnowledgeDocumentService({
      db: lifecycleDb,
      documentStore: lifecycleDocumentStore,
      indexStore: lifecycleIndexStore,
      jobStore: lifecycleJobStore,
      managedFileStore,
      selectionTokenStore,
      compatibilityAdapter: new EnterpriseLeadKnowledgeCompatibilityAdapter(
        lifecycleWorkspaceStore,
      ),
      workspaceExists: id => Boolean(lifecycleWorkspaceStore.getWorkspace(id)),
      enrichmentRequestStore: lifecycleRequestStore,
      factStore: lifecycleFactStore,
      enrichmentLifecycle: { abortActiveAttemptForVersion: confirmReplaceAbort },
      workspaceVectorLifecycle: {
        deleteWorkspaceDocumentSources: (_workspaceId: string, sourceIds: readonly string[]) =>
          lifecycleVectorStore.deleteWorkspaceDocumentSources(scopeId, sourceIds),
        replaceWorkspaceDocumentSource: confirmReplaceRawRefresh,
      },
      onIndexQueued: vi.fn(),
      onLifecycleStage: (stage: string) => {
        if (stage !== Task11DocumentLifecycleStage.AfterRevalidationBeforeFirstWrite) return;
        confirmReplaceLifecycleAttempts += 1;
        if (confirmBeforeReplaceCommitted) return;
        publisherProjector.confirmFact({
          factId: confirmBeforeReplace.factId,
          expectedRevision: 1,
        });
        confirmBeforeReplaceCommitted = true;
      },
    } as ConstructorParameters<typeof KnowledgeDocumentService>[0]);
    confirmReplaceService.replaceParsedDocumentVersion({
      documentId: confirmBeforeReplace.target.document.id,
      expectedRevision: confirmBeforeReplace.target.document.revision,
      version: {
        ...createStoredDocumentInputVersion(),
        contentHash: '9'.repeat(64),
        extractedText: 'replacement after concurrent confirmation',
      },
    });
    expect(confirmReplaceLifecycleAttempts).toBe(2);
    expect(lifecycleRequestStore.getSummary(confirmBeforeReplace.requestId)?.status).toBe(
      KnowledgeEnrichmentStatus.Stale,
    );
    expect(lifecycleDb.prepare(`
      SELECT stale_at FROM knowledge_fact_evidence WHERE fact_id = ?
    `).get(confirmBeforeReplace.factId)).toEqual({ stale_at: expect.any(String) });
    expect(confirmReplaceAbort).toHaveBeenCalledTimes(1);
    expect(confirmReplaceRawRefresh).toHaveBeenCalledTimes(1);

    const replaceBeforeConfirm = seedConfirmableFact(
      'replace-confirm',
      KnowledgeFactDomain.ChannelPreferences,
      'Must never project after replacement',
    );
    let replaceWonProjectorLease = false;
    let replaceProjectorAttempts = 0;
    const replaceBeforeConfirmProjector = new EnterpriseLeadKnowledgeFactProjector(
      publisherDb!,
      publisherFactStore,
      publisherProjectionStore,
      publisherWorkspaceStore.getProfileRevisionStore(),
      {
        onTrustedRefreshCommitted: trustedWake,
        onStage: stage => {
          if (stage !== KnowledgeFactProjectorStage.AfterRevalidationBeforeFirstWrite) return;
          replaceProjectorAttempts += 1;
          if (replaceWonProjectorLease) return;
          confirmReplaceService.replaceParsedDocumentVersion({
            documentId: replaceBeforeConfirm.target.document.id,
            expectedRevision: replaceBeforeConfirm.target.document.revision,
            version: {
              ...createStoredDocumentInputVersion(),
              contentHash: '8'.repeat(64),
              extractedText: 'replacement wins before confirmation',
            },
          });
          replaceWonProjectorLease = true;
        },
      },
    );
    expect(() => replaceBeforeConfirmProjector.confirmFact({
      factId: replaceBeforeConfirm.factId,
      expectedRevision: 1,
    })).toThrowError(expect.objectContaining({ code: KnowledgeBaseErrorCode.FactEvidenceStale }));
    expect(replaceWonProjectorLease).toBe(true);
    expect(replaceProjectorAttempts).toBe(2);
    expect(publisherWorkspaceStore.getWorkspace(lifecycleWorkspace.id)?.profile.channelPreferences)
      .not.toContain('Must never project after replacement');
    publisherDb?.close();
    lifecycleDb.close();
  });

  test('delete removes only target index data and restore requeues the same version', () => {
    const target = createStoredDocument({ displayName: 'target.txt' });
    const untouched = createStoredDocument({ displayName: 'untouched.txt' });
    scheduleIndex(target);
    scheduleIndex(untouched);
    runKnowledgeDocumentIndexUntilIdle(indexStore);
    const originalChunkIds = indexStore.listVersionChunks(target.version.id)
      .map(chunk => chunk.id);
    onIndexQueued.mockClear();

    const deleted = service.deleteDocument({
      documentId: target.document.id,
      expectedRevision: target.document.revision,
    });
    expect(deleted.localIndex).toBeNull();
    expect(indexStore.listVersionChunks(target.version.id)).toEqual([]);
    expect(indexStore.listVersionChunks(untouched.version.id)).toHaveLength(1);
    expect(onIndexQueued).toHaveBeenCalledTimes(1);
    onIndexQueued.mockClear();

    const restored = service.restoreDocument({
      documentId: deleted.id,
      expectedRevision: deleted.revision,
    });
    expect(restored.localIndex?.status).toBe(KnowledgeDocumentIndexStatus.Pending);
    expect(onIndexQueued).toHaveBeenCalledTimes(1);
    runKnowledgeDocumentIndexUntilIdle(indexStore);
    expect(indexStore.listVersionChunks(target.version.id).map(chunk => chunk.id)).toEqual(
      originalChunkIds,
    );
  });

  test('replaces a parsed version atomically and schedules only the new version', () => {
    const target = createStoredDocument({ displayName: 'replace.txt' });
    scheduleIndex(target);
    runKnowledgeDocumentIndexUntilIdle(indexStore);
    onIndexQueued.mockClear();

    const replaced = service.replaceParsedDocumentVersion({
      documentId: target.document.id,
      expectedRevision: target.document.revision,
      version: {
        ...createStoredDocumentInputVersion(),
        contentHash: 'b'.repeat(64),
        extractedText: 'replacement text',
      },
    });

    expect(indexStore.listVersionChunks(target.version.id)).toEqual([]);
    expect(replaced.currentVersionId).not.toBe(target.version.id);
    expect(replaced.localIndex?.status).toBe(KnowledgeDocumentIndexStatus.Pending);
    expect(onIndexQueued).toHaveBeenCalledTimes(1);
  });

  test('wakes physical cleanup when an indexed version is replaced by empty text', () => {
    const target = createStoredDocument({ displayName: 'replace-empty.txt' });
    scheduleIndex(target);
    runKnowledgeDocumentIndexUntilIdle(indexStore);
    expect(
      (db.prepare(`
        SELECT COUNT(*) AS count
        FROM knowledge_document_chunks
        WHERE document_version_id = ?
      `).get(target.version.id) as { count: number }).count,
    ).toBeGreaterThan(0);
    onIndexQueued.mockImplementationOnce(() => {
      expect(db.inTransaction).toBe(false);
      runKnowledgeDocumentIndexUntilIdle(indexStore);
    });

    const replaced = service.replaceParsedDocumentVersion({
      documentId: target.document.id,
      expectedRevision: target.document.revision,
      version: {
        ...createStoredDocumentInputVersion(),
        contentHash: 'd'.repeat(64),
        extractedText: null,
      },
    });

    expect(replaced.localIndex?.status).toBe(KnowledgeDocumentIndexStatus.NotApplicable);
    expect(onIndexQueued).toHaveBeenCalledTimes(1);
    expect(
      (db.prepare(`
        SELECT COUNT(*) AS count
        FROM knowledge_document_chunks
        WHERE document_version_id = ?
      `).get(target.version.id) as { count: number }).count,
    ).toBe(0);
    expect(
      (db.prepare(`
        SELECT COUNT(*) AS count
        FROM knowledge_document_chunks_fts
        WHERE document_version_id = ?
      `).get(target.version.id) as { count: number }).count,
    ).toBe(0);
  });

  test('rejects restoring an active document without changing revision or index state', () => {
    const target = createStoredDocument({ displayName: 'already-active.txt' });
    scheduleIndex(target);
    runKnowledgeDocumentIndexUntilIdle(indexStore);
    const originalChunkIds = indexStore.listVersionChunks(target.version.id).map(chunk => chunk.id);
    onIndexQueued.mockClear();

    expect(() => service.restoreDocument({
      documentId: target.document.id,
      expectedRevision: target.document.revision,
    })).toThrowError(
      expect.objectContaining({ code: KnowledgeBaseErrorCode.JobStateConflict }),
    );

    expect(documentStore.getDocument(target.document.id)).toMatchObject({
      deletedAt: null,
      revision: target.document.revision,
    });
    expect(indexStore.getState(target.version.id)?.status).toBe(
      KnowledgeDocumentIndexStatus.Indexed,
    );
    expect(indexStore.listVersionChunks(target.version.id).map(chunk => chunk.id)).toEqual(
      originalChunkIds,
    );
    expect(onIndexQueued).not.toHaveBeenCalled();
  });

  test('deletes a document before its first local-index state exists', () => {
    const target = createStoredDocument({
      displayName: 'queued-before-index.txt',
      status: KnowledgeDocumentStatus.Pending,
    });
    const job = jobStore.createJob({
      workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
    });
    expect(indexStore.getState(target.version.id)).toBeNull();
    onIndexQueued.mockClear();

    const deleted = service.deleteDocument({
      documentId: target.document.id,
      expectedRevision: target.document.revision,
    });

    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.localIndex).toBeNull();
    expect(jobStore.getJob(job.id)?.status).toBe(KnowledgeIngestionJobStatus.Cancelled);
    expect(onIndexQueued).not.toHaveBeenCalled();
  });

  test('rolls back old-index deactivation and version replacement when scheduling fails', () => {
    const target = createStoredDocument({ displayName: 'replace-rollback.txt' });
    scheduleIndex(target);
    runKnowledgeDocumentIndexUntilIdle(indexStore);
    const originalChunkIds = indexStore.listVersionChunks(target.version.id).map(chunk => chunk.id);
    const scheduleCurrentVersion =
      indexStore.scheduleCurrentVersionInCurrentTransaction.bind(indexStore);
    vi.spyOn(indexStore, 'scheduleCurrentVersionInCurrentTransaction').mockImplementation(input => {
      const state = scheduleCurrentVersion(input);
      if (input.documentVersionId !== target.version.id) {
        throw new Error('forced post-schedule failure');
      }
      return state;
    });
    onIndexQueued.mockClear();

    expect(() => service.replaceParsedDocumentVersion({
      documentId: target.document.id,
      expectedRevision: target.document.revision,
      version: {
        ...createStoredDocumentInputVersion(),
        contentHash: 'c'.repeat(64),
        extractedText: 'must roll back',
      },
    })).toThrowError(
      expect.objectContaining({ code: KnowledgeBaseErrorCode.PersistenceFailed }),
    );

    expect(documentStore.getDocument(target.document.id)).toMatchObject({
      currentVersionId: target.version.id,
      revision: target.document.revision,
    });
    expect(indexStore.getState(target.version.id)?.status).toBe(
      KnowledgeDocumentIndexStatus.Indexed,
    );
    expect(indexStore.listVersionChunks(target.version.id).map(chunk => chunk.id)).toEqual(
      originalChunkIds,
    );
    expect(onIndexQueued).not.toHaveBeenCalled();
  });

  test('retries only failed local indexing and wakes once after commit', () => {
    const target = createStoredDocument();
    failIndex(target);
    const retryDocument = vi.spyOn(jobStore, 'retry');
    const compatibilityUpdate = vi.spyOn(compatibilityAdapter, 'upsertDocument');
    onIndexQueued.mockClear();

    const result = service.retryLocalIndex({
      documentId: target.document.id,
      documentVersionId: target.version.id,
    });

    expect(result.localIndex?.status).toBe(KnowledgeDocumentIndexStatus.Pending);
    expect(result.status).toBe(target.document.status);
    expect(result.revision).toBe(target.document.revision);
    expect(retryDocument).not.toHaveBeenCalled();
    expect(onIndexQueued).toHaveBeenCalledTimes(1);
    expect(compatibilityUpdate).not.toHaveBeenCalled();
  });

  test('rejects deleted, stale-version, pending, and indexed retries without waking', () => {
    const indexed = createStoredDocument({ displayName: 'indexed.txt' });
    scheduleIndex(indexed);
    runKnowledgeDocumentIndexUntilIdle(indexStore);
    const wrongVersion = createStoredDocument({ displayName: 'wrong-version.txt' });
    failIndex(wrongVersion);
    const deletedTarget = createStoredDocument({ displayName: 'deleted.txt' });
    failIndex(deletedTarget);
    const pending = createStoredDocument({ displayName: 'pending.txt' });
    scheduleIndex(pending);
    const deleted = service.deleteDocument({
      documentId: deletedTarget.document.id,
      expectedRevision: deletedTarget.document.revision,
    });
    onIndexQueued.mockClear();

    const requests = [
      { documentId: deleted.id, documentVersionId: deleted.currentVersionId },
      { documentId: wrongVersion.document.id, documentVersionId: 'stale-version' },
      { documentId: pending.document.id, documentVersionId: pending.version.id },
      { documentId: indexed.document.id, documentVersionId: indexed.version.id },
    ];
    for (const request of requests) {
      expect(() => service.retryLocalIndex(request)).toThrowError(
        expect.objectContaining({ code: KnowledgeBaseErrorCode.JobStateConflict }),
      );
    }
    expect(onIndexQueued).not.toHaveBeenCalled();
  });

  test('contains a synchronous post-commit index wake failure', () => {
    const target = createStoredDocument({ displayName: 'wake-failure.txt' });
    failIndex(target);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    onIndexQueued.mockImplementationOnce(() => {
      expect(db.inTransaction).toBe(false);
      throw new Error('SECRET forced wake SQL /private/path');
    });

    try {
      const result = service.retryLocalIndex({
        documentId: target.document.id,
        documentVersionId: target.version.id,
      });
      expect(result.localIndex?.status).toBe(KnowledgeDocumentIndexStatus.Pending);
      expect(indexStore.getState(target.version.id)?.status).toBe(
        KnowledgeDocumentIndexStatus.Pending,
      );
      expect(consoleWarn).toHaveBeenCalledWith(
        '[KnowledgeDocumentLifecycle]',
        { code: 'index_worker_wake_failed' },
      );
      expect(consoleWarn.mock.calls.flat().some(value => value instanceof Error)).toBe(false);
      expect(JSON.stringify(consoleWarn.mock.calls)).not.toMatch(/SECRET|SQL|private|path/i);
    } finally {
      consoleWarn.mockRestore();
    }
  });

  test('rejects restore when other active documents have consumed the freed quota', () => {
    const large = createStoredDocument({
      legacySourceId: 'restore-large',
      version: {
        ...createStoredDocumentInputVersion(),
        fileSize: KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES - 5,
      },
    });
    const deleted = documentStore.softDeleteDocument(large.document.id, large.document.revision);
    createStoredDocument({
      legacySourceId: 'restore-active',
      version: { ...createStoredDocumentInputVersion(), fileSize: 10 },
    });

    expect(() =>
      service.restoreDocument({
        documentId: deleted.id,
        expectedRevision: deleted.revision,
      }),
    ).toThrowError(
      expect.objectContaining({ code: KnowledgeBaseErrorCode.WorkspaceQuotaExceeded }),
    );
    expect(documentStore.getDocument(deleted.id)?.deletedAt).not.toBeNull();
  });

  test('returns the latest safe document with a revision conflict', () => {
    const created = createStoredDocument();
    documentStore.updateDocumentMetadata(created.document.id, created.document.revision, {
      displayName: 'renamed.pdf',
    });

    let caught: unknown;
    try {
      service.deleteDocument({
        documentId: created.document.id,
        expectedRevision: created.document.revision,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(KnowledgeDocumentServiceError);
    expect(caught).toMatchObject({
      code: KnowledgeBaseErrorCode.RevisionConflict,
      latestDocument: expect.objectContaining({ displayName: 'renamed.pdf', revision: 2 }),
    });
    expect((caught as KnowledgeDocumentServiceError).latestDocument).not.toHaveProperty(
      'originalPath',
    );
  });

  test('projects exact current enrichment and stale history in mutation and conflict DTOs', () => {
    const seedEnrichedHistory = (displayName: string, fingerprint: string) => {
      const created = createStoredDocument({ displayName });
      const priorRequest = enrichmentRequestStore.createOrGetAuthorizedRequest({
        workspaceId,
        documentId: created.document.id,
        documentVersionId: created.version.id,
        providerId: 'provider-a',
        modelId: 'model-a',
        routingFingerprint: fingerprint.repeat(64),
      });
      enrichmentRequestStore.markVersionStale(created.version.id);
      const current = documentStore.addVersion(
        created.document.id,
        created.document.revision,
        {
          ...createStoredDocumentInputVersion(),
          contentHash: fingerprint.repeat(64),
          extractedText: `current enriched version ${fingerprint}`,
        },
        KnowledgeDocumentStatus.Ready,
      );
      const currentRequest = enrichmentRequestStore.createOrGetAuthorizedRequest({
        workspaceId,
        documentId: current.document.id,
        documentVersionId: current.version.id,
        providerId: 'provider-a',
        modelId: 'model-a',
        routingFingerprint: fingerprint.repeat(64),
      });
      return { current, currentRequest, priorRequest };
    };
    const {
      current: replaced,
      currentRequest,
      priorRequest,
    } = seedEnrichedHistory('enriched-history.pdf', 'c');
    const initiallyDeleted = documentStore.softDeleteDocument(
      replaced.document.id,
      replaced.document.revision,
    );

    const restored = service.restoreDocument({
      documentId: initiallyDeleted.id,
      expectedRevision: initiallyDeleted.revision,
    });
    const listedAfterRestore = service.listDocuments({
      workspaceId,
      visibility: KnowledgeDocumentVisibility.Active,
    }).find(document => document.id === restored.id);

    expect(restored).toEqual(listedAfterRestore);
    expect(restored.enrichment).toMatchObject({ requestId: currentRequest.id });
    expect(restored.hasStalePriorVersionExtraction).toBe(true);
    expect(JSON.stringify(restored)).not.toContain(priorRequest.id);

    const latest = documentStore.updateDocumentMetadata(restored.id, restored.revision, {
      displayName: 'enriched-history-renamed.pdf',
    });
    let conflict: unknown;
    try {
      service.deleteDocument({
        documentId: latest.id,
        expectedRevision: restored.revision,
      });
    } catch (error) {
      conflict = error;
    }
    const listedLatest = service.listDocuments({
      workspaceId,
      visibility: KnowledgeDocumentVisibility.Active,
    }).find(document => document.id === latest.id);
    const conflictDocument = (conflict as KnowledgeDocumentServiceError).latestDocument;

    expect(conflict).toMatchObject({ code: KnowledgeBaseErrorCode.RevisionConflict });
    expect(conflictDocument).toEqual(listedLatest);
    expect(conflictDocument?.enrichment).toMatchObject({ requestId: currentRequest.id });
    expect(conflictDocument?.hasStalePriorVersionExtraction).toBe(true);
    expect(JSON.stringify(conflictDocument)).not.toContain(priorRequest.id);

    const deleted = service.deleteDocument({
      documentId: latest.id,
      expectedRevision: latest.revision,
    });
    const listedDeleted = service.listDocuments({
      workspaceId,
      visibility: KnowledgeDocumentVisibility.Deleted,
    }).find(document => document.id === latest.id);
    expect(deleted).toEqual(listedDeleted);
    expect(deleted.enrichment).toMatchObject({
      requestId: currentRequest.id,
      status: KnowledgeEnrichmentStatus.Stale,
    });
    expect(deleted.hasStalePriorVersionExtraction).toBe(true);

    const replacementTarget = seedEnrichedHistory('replace-dto.pdf', 'f');
    const replacement = service.replaceParsedDocumentVersion({
      documentId: replacementTarget.current.document.id,
      expectedRevision: replacementTarget.current.document.revision,
      version: {
        ...createStoredDocumentInputVersion(),
        contentHash: '1'.repeat(64),
        extractedText: 'replacement DTO text',
      },
    });
    const listedReplacement = service.listDocuments({
      workspaceId,
      visibility: KnowledgeDocumentVisibility.Active,
    }).find(document => document.id === replacement.id);
    expect(replacement).toEqual(listedReplacement);
    expect(replacement.enrichment).toBeNull();
    expect(replacement.hasStalePriorVersionExtraction).toBe(true);

    const ingestionRetryTarget = seedEnrichedHistory('ingestion-retry-dto.pdf', '2');
    documentStore.setDocumentStatusIfCurrentVersion({
      documentId: ingestionRetryTarget.current.document.id,
      documentVersionId: ingestionRetryTarget.current.version.id,
      status: KnowledgeDocumentStatus.Pending,
    });
    jobStore.createJob({
      workspaceId,
      documentId: ingestionRetryTarget.current.document.id,
      documentVersionId: ingestionRetryTarget.current.version.id,
    });
    const ingestionPending = documentStore.getDocument(
      ingestionRetryTarget.current.document.id,
    )!;
    const ingestionDeleted = service.deleteDocument({
      documentId: ingestionRetryTarget.current.document.id,
      expectedRevision: ingestionPending.revision,
    });
    service.restoreDocument({
      documentId: ingestionDeleted.id,
      expectedRevision: ingestionDeleted.revision,
    });
    const ingestionRetried = service.retryDocument({
      documentId: ingestionRetryTarget.current.document.id,
      documentVersionId: ingestionRetryTarget.current.version.id,
    });
    const listedIngestionRetry = service.listDocuments({
      workspaceId,
      visibility: KnowledgeDocumentVisibility.Active,
    }).find(document => document.id === ingestionRetried.id);
    expect(ingestionRetried).toEqual(listedIngestionRetry);
    expect(ingestionRetried.enrichment).toMatchObject({
      requestId: ingestionRetryTarget.currentRequest.id,
      status: KnowledgeEnrichmentStatus.Stale,
    });
    expect(ingestionRetried.hasStalePriorVersionExtraction).toBe(true);

    runKnowledgeDocumentIndexUntilIdle(indexStore);
    const indexRetryTarget = seedEnrichedHistory('index-retry-dto.pdf', '3');
    failIndex(indexRetryTarget.current);
    const indexRetried = service.retryLocalIndex({
      documentId: indexRetryTarget.current.document.id,
      documentVersionId: indexRetryTarget.current.version.id,
    });
    const listedIndexRetry = service.listDocuments({
      workspaceId,
      visibility: KnowledgeDocumentVisibility.Active,
    }).find(document => document.id === indexRetried.id);
    expect(indexRetried).toEqual(listedIndexRetry);
    expect(indexRetried.enrichment).toMatchObject({
      requestId: indexRetryTarget.currentRequest.id,
    });
    expect(indexRetried.hasStalePriorVersionExtraction).toBe(true);
  });

  test('deletes and restores a migrated document using its original legacy source id', () => {
    const legacySource = {
      id: 'legacy-source-a',
      kind: EnterpriseLeadExtractionSourceKind.Manual,
      label: '旧资料',
      text: '旧正文',
      summary: '旧摘要',
    };
    workspaceStore.upsertWorkspaceSourceById(workspaceId, legacySource);
    const created = createStoredDocument({
      legacySourceId: 'legacy-source-a',
      legacySourceSnapshotJson: JSON.stringify(legacySource),
    });

    const deleted = service.deleteDocument({
      documentId: created.document.id,
      expectedRevision: created.document.revision,
    });
    expect(workspaceStore.getWorkspace(workspaceId)?.extractionSources).toEqual([]);

    service.restoreDocument({
      documentId: created.document.id,
      expectedRevision: deleted.revision,
    });
    const restoredSources = workspaceStore.getWorkspace(workspaceId)?.extractionSources ?? [];
    expect(restoredSources).toHaveLength(1);
    expect(restoredSources[0]).toMatchObject({
      id: 'legacy-source-a',
      text: '旧正文',
      summary: '旧摘要',
    });
  });

  test('rolls back document and job rows when compatibility persistence fails', async () => {
    const filePath = await writeFile('rollback.pdf', '%PDF-1.7\nrollback');
    const selection = await issueSelection([filePath]);
    const failingService = createService({
      compatibilityAdapter: {
        removeDocument: vi.fn(),
        upsertDocument: vi.fn(() => {
          throw new Error('database detail must not escape');
        }),
      },
    });

    const result = await failingService.importSelection({
      ownerId: 7,
      workspaceId,
      selectionToken: selection.selectionToken,
    });

    expect(result.items[0]).toMatchObject({
      success: false,
      errorCode: KnowledgeBaseErrorCode.PersistenceFailed,
    });
    expect(JSON.stringify(result)).not.toContain('database detail');
    expect(documentStore.listDocuments(workspaceId)).toEqual([]);
    expect(jobStore.listCurrentJobs(workspaceId)).toEqual([]);
  });

  test('rejects unknown workspaces and stale retry version identities', async () => {
    const filePath = await writeFile('unknown.pdf', '%PDF-1.7\nunknown');
    const selection = await issueSelection([filePath]);
    await expect(
      service.importSelection({
        ownerId: 7,
        workspaceId: 'missing-workspace',
        selectionToken: selection.selectionToken,
      }),
    ).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.WorkspaceNotFound });

    const created = createStoredDocument();
    jobStore.createJob({
      workspaceId,
      documentId: created.document.id,
      documentVersionId: created.version.id,
    });
    expect(() =>
      service.retryDocument({
        documentId: created.document.id,
        documentVersionId: 'stale-version',
      }),
    ).toThrowError(expect.objectContaining({ code: KnowledgeBaseErrorCode.JobStateConflict }));
  });
});
