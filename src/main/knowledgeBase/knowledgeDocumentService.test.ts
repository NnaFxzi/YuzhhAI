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
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeDocumentVisibility,
  KnowledgeIngestionJobStatus,
} from '../../shared/knowledgeBase/constants';
import type { CreateKnowledgeDocumentInput } from '../../shared/knowledgeBase/types';
import { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import { EnterpriseLeadKnowledgeCompatibilityAdapter } from './enterpriseLeadKnowledgeCompatibilityAdapter';
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
  let jobStore: KnowledgeIngestionJobStore;
  let managedFileStore: KnowledgeManagedFileStore;
  let selectionTokenStore: KnowledgeSelectionTokenStore;
  let compatibilityAdapter: EnterpriseLeadKnowledgeCompatibilityAdapter;
  let onJobsQueued: ReturnType<typeof vi.fn>;
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
    jobStore = new KnowledgeIngestionJobStore(db);
    managedFileStore = new KnowledgeManagedFileStore(path.join(tempDir, 'managed'));
    selectionTokenStore = new KnowledgeSelectionTokenStore();
    compatibilityAdapter = new EnterpriseLeadKnowledgeCompatibilityAdapter(workspaceStore);
    onJobsQueued = vi.fn();
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
      jobStore,
      managedFileStore,
      selectionTokenStore,
      compatibilityAdapter,
      workspaceExists: id => Boolean(workspaceStore.getWorkspace(id)),
      onJobsQueued,
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
    expect(jobStore.listCurrentJobs(workspaceId)).toEqual([]);
    expect(onJobsQueued).not.toHaveBeenCalled();
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
