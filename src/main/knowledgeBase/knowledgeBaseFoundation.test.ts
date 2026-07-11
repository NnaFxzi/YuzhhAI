import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeMigrationStatus,
} from '../../shared/knowledgeBase/constants';
import { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import {
  createKnowledgeBaseFoundation,
  recoverAndMigrateKnowledgeBase,
} from './knowledgeBaseFoundation';
import type {
  KnowledgeMigrationResult,
  LegacyKnowledgeWorkspace,
} from './knowledgeMigrationService';

const completedMigrationResult = (workspaceId: string): KnowledgeMigrationResult => ({
  workspaceId,
  sourceCount: 0,
  migratedCount: 0,
  skippedCount: 0,
  status: KnowledgeMigrationStatus.Completed,
  diagnostics: [],
});

describe('knowledge base foundation', () => {
  const databases: Database.Database[] = [];
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    databases.splice(0).forEach(database => database.close());
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map(directory => fs.rm(directory, { recursive: true, force: true })),
    );
  });

  test('recovers abandoned jobs before migrating workspaces', async () => {
    const events: string[] = [];
    await recoverAndMigrateKnowledgeBase({
      jobStore: {
        recoverAbandonedJobs: () => {
          events.push('recover-jobs');
          return 0;
        },
      },
      migrationService: {
        migrateWorkspace: async workspace => {
          events.push(`migrate:${workspace.id}`);
          return completedMigrationResult(workspace.id);
        },
      },
      workspaces: [{ id: 'workspace-a', extractionSources: [] }],
      staleBefore: '2026-07-11T00:50:00.000Z',
      now: '2026-07-11T01:00:00.000Z',
      onReady: () => events.push('wake'),
    });

    expect(events).toEqual(['recover-jobs', 'migrate:workspace-a', 'wake']);
  });

  test('continues migrating later workspaces after one migration fails', async () => {
    const migrated: string[] = [];
    const errors: string[] = [];
    const workspaces: LegacyKnowledgeWorkspace[] = [
      { id: 'workspace-a', extractionSources: [] },
      { id: 'workspace-b', extractionSources: [] },
    ];

    await expect(
      recoverAndMigrateKnowledgeBase({
        jobStore: { recoverAbandonedJobs: () => 0 },
        migrationService: {
          migrateWorkspace: async workspace => {
            if (workspace.id === 'workspace-a') throw new Error('broken legacy source');
            migrated.push(workspace.id);
            return completedMigrationResult(workspace.id);
          },
        },
        workspaces,
        staleBefore: '2026-07-11T00:50:00.000Z',
        now: '2026-07-11T01:00:00.000Z',
        onMigrationError: workspaceId => errors.push(workspaceId),
      }),
    ).resolves.toBeUndefined();
    expect(errors).toEqual(['workspace-a']);
    expect(migrated).toEqual(['workspace-b']);
  });

  test('composes real stores and completes an empty shadow migration', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-foundation-'));
    temporaryDirectories.push(userDataPath);
    const foundation = createKnowledgeBaseFoundation({ db, userDataPath });

    await foundation.recoverMigrateAndStart(
      [{ id: 'workspace-a', extractionSources: [] }],
      '2026-07-11T01:00:00.000Z',
    );

    expect(foundation.migrationStore.getState('workspace-a')?.status).toBe(
      KnowledgeMigrationStatus.Completed,
    );
  });

  test('persists deterministic ids for idless legacy sources before migration', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-foundation-'));
    temporaryDirectories.push(userDataPath);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspace = workspaceStore.createWorkspace({
      name: '旧知识库',
      type: 'enterprise_lead',
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
      extractionSources: [
        {
          kind: 'manual',
          label: '无 ID 旧资料',
          text: '需要稳定身份',
        },
      ],
      enabledAgentRoles: [],
    });
    const foundation = createKnowledgeBaseFoundation({ db, userDataPath, workspaceStore });

    await foundation.recoverMigrateAndStart([workspace]);

    const migrated = foundation.documentStore.listDocuments(workspace.id)[0];
    const persistedSource = workspaceStore.getWorkspace(workspace.id)?.extractionSources[0];
    expect(migrated?.legacySourceId).toBeTruthy();
    expect(persistedSource?.id).toBe(migrated?.legacySourceId);
  });

  test('reconciles sources added after a completed startup pass', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-foundation-'));
    temporaryDirectories.push(userDataPath);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspace = workspaceStore.createWorkspace({
      name: '持续迁移知识库',
      type: 'enterprise_lead',
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
      extractionSources: [
        {
          id: 'legacy-first',
          kind: 'manual',
          label: '首批资料',
          text: '首批正文',
        },
      ],
      enabledAgentRoles: [],
    });
    const foundation = createKnowledgeBaseFoundation({ db, userDataPath, workspaceStore });

    await foundation.recoverMigrateAndStart([workspace]);
    const updatedWorkspace = workspaceStore.updateWorkspaceSources(workspace.id, [
      ...workspaceStore.getWorkspace(workspace.id)!.extractionSources,
      {
        kind: 'manual',
        label: '后续资料',
        text: '后续正文',
      },
    ]);
    await foundation.recoverMigrateAndStart([updatedWorkspace]);

    expect(foundation.documentStore.listDocuments(workspace.id)).toHaveLength(2);
    expect(workspaceStore.getWorkspace(workspace.id)?.extractionSources[1]?.id).toBeTruthy();
    expect(foundation.migrationStore.getState(workspace.id)?.version).toBe(2);
  });

  test('migrates an unprocessed legacy file through the real worker boundary', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-foundation-'));
    temporaryDirectories.push(userDataPath);
    const sourcePath = path.join(userDataPath, 'catalog.txt');
    await fs.writeFile(sourcePath, '旧目录正文');
    const extractDocumentText = vi.fn().mockResolvedValue({
      content: '已由本地 worker 解析',
      parser: 'text',
      truncated: false,
    });
    const foundation = createKnowledgeBaseFoundation({
      db,
      userDataPath,
      extractDocumentText,
    });

    await foundation.recoverMigrateAndStart([
      {
        id: 'workspace-a',
        extractionSources: [
          {
            id: 'legacy-catalog',
            kind: 'file',
            label: '产品目录',
            filePath: sourcePath,
          },
        ],
      },
    ]);
    await foundation.ingestionService.waitForIdle();

    expect(extractDocumentText).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ extensionHint: '.txt' }),
    );
    expect(foundation.documentStore.listDocuments('workspace-a')[0]?.status).toBe(
      KnowledgeDocumentStatus.Ready,
    );
  });

  test('recovers a recently running job left by the previous app process', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-foundation-'));
    temporaryDirectories.push(userDataPath);
    const extractDocumentText = vi.fn().mockResolvedValue({
      content: 'recovered local text',
      parser: 'text',
      truncated: false,
    });
    const foundation = createKnowledgeBaseFoundation({
      db,
      userDataPath,
      extractDocumentText,
    });
    const blob = await foundation.managedFileStore.importTextSnapshot('managed bytes');
    const created = foundation.documentStore.createDocumentWithVersion({
      workspaceId: 'workspace-a',
      displayName: 'recovered.txt',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Pending,
      version: {
        contentHash: blob.contentHash,
        managedPath: blob.managedPath,
        mimeType: 'text/plain',
        fileSize: blob.fileSize,
        sourceMtime: null,
        parser: null,
        extractedText: null,
        extractionPartial: false,
      },
    });
    const job = foundation.jobStore.createJob(
      {
        workspaceId: 'workspace-a',
        documentId: created.document.id,
        documentVersionId: created.version.id,
      },
      '2026-07-11T00:00:00.000Z',
    );
    foundation.jobStore.claimNextJob('2026-07-11T00:59:59.000Z');

    await foundation.recoverMigrateAndStart([], '2026-07-11T01:00:00.000Z');
    await foundation.ingestionService.waitForIdle();

    expect(extractDocumentText).toHaveBeenCalledTimes(1);
    expect(foundation.jobStore.getJob(job.id)?.status).toBe('completed');
    expect(foundation.documentStore.getVersion(created.version.id)?.extractedText).toBe(
      'recovered local text',
    );
  });

  test('deletes normalized workspace data without leaving text or job attempts', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-foundation-'));
    temporaryDirectories.push(userDataPath);
    const foundation = createKnowledgeBaseFoundation({ db, userDataPath });
    const created = foundation.documentStore.createDocumentWithVersion({
      workspaceId: 'workspace-a',
      displayName: '待删除资料',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Pending,
      version: {
        contentHash: 'a'.repeat(64),
        managedPath: `blobs/aa/${'a'.repeat(64)}`,
        mimeType: 'text/plain',
        fileSize: 12,
        sourceMtime: null,
        parser: 'text',
        extractedText: '需要被清理的正文',
        extractionPartial: false,
      },
    });
    const job = foundation.jobStore.createJob({
      workspaceId: 'workspace-a',
      documentId: created.document.id,
      documentVersionId: created.version.id,
    });
    foundation.jobStore.claimNextJob();
    foundation.migrationStore.begin('workspace-a', 1, 1);

    foundation.deleteWorkspaceData('workspace-a');

    expect(foundation.documentStore.listDocuments('workspace-a', { includeDeleted: true })).toEqual(
      [],
    );
    expect(foundation.jobStore.getJob(job.id)).toBeNull();
    expect(foundation.migrationStore.getState('workspace-a')).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS count FROM knowledge_document_versions').get()).toEqual({
      count: 0,
    });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM knowledge_ingestion_job_attempts').get(),
    ).toEqual({ count: 0 });
  });
});
