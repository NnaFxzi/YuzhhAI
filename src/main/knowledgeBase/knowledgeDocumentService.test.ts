import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadWorkspaceType,
} from '../../shared/enterpriseLeadWorkspace/constants';
import {
  KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES,
  KnowledgeBaseErrorCode,
  KnowledgeDocumentIndexErrorCode,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentIndexTokenizer,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeDocumentVisibility,
  KnowledgeIngestionJobStatus,
} from '../../shared/knowledgeBase/constants';
import type { CreateKnowledgeDocumentInput } from '../../shared/knowledgeBase/types';
import { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import { applySqliteConnectionPolicy } from '../libs/sqliteConnectionPolicy';
import { EnterpriseLeadKnowledgeCompatibilityAdapter } from './enterpriseLeadKnowledgeCompatibilityAdapter';
import { runKnowledgeDocumentIndexUntilIdle } from './knowledgeDocumentIndexRunner';
import { KnowledgeDocumentIndexStore } from './knowledgeDocumentIndexStore';
import {
  KnowledgeDocumentService,
  KnowledgeDocumentServiceError,
} from './knowledgeDocumentService';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';
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
  let onJobsQueued: ReturnType<typeof vi.fn>;
  let onIndexQueued: ReturnType<typeof vi.fn>;
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
    managedFileStore = new KnowledgeManagedFileStore(path.join(tempDir, 'managed'));
    selectionTokenStore = new KnowledgeSelectionTokenStore();
    compatibilityAdapter = new EnterpriseLeadKnowledgeCompatibilityAdapter(workspaceStore);
    onJobsQueued = vi.fn();
    onIndexQueued = vi.fn();
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
    const scheduleCurrentVersion = indexStore.scheduleCurrentVersion.bind(indexStore);
    vi.spyOn(indexStore, 'scheduleCurrentVersion').mockImplementation(input => {
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
      throw new Error('forced wake failure');
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
        '[KnowledgeBase] Failed to wake local index worker:',
        expect.objectContaining({ message: 'forced wake failure' }),
      );
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
