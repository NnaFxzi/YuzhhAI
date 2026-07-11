import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  EnterpriseLeadDocumentExtractionStatus,
  EnterpriseLeadExtractionSourceKind,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type { EnterpriseLeadExtractionSource } from '../../shared/enterpriseLeadWorkspace/types';
import {
  KnowledgeDocumentStatus,
  KnowledgeMigrationStatus,
} from '../../shared/knowledgeBase/constants';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';
import { KnowledgeIngestionJobStore } from './knowledgeIngestionJobStore';
import { KnowledgeManagedFileStore } from './knowledgeManagedFileStore';
import { KnowledgeMigrationService } from './knowledgeMigrationService';
import { KnowledgeMigrationStore } from './knowledgeMigrationStore';

describe('KnowledgeMigrationService', () => {
  let db: Database.Database;
  let tempDir: string;
  let documentStore: KnowledgeDocumentStore;
  let jobStore: KnowledgeIngestionJobStore;
  let managedFileStore: KnowledgeManagedFileStore;
  let migrationStore: KnowledgeMigrationStore;

  beforeEach(async () => {
    db = new Database(':memory:');
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-knowledge-migration-'));
    documentStore = new KnowledgeDocumentStore(db);
    jobStore = new KnowledgeIngestionJobStore(db);
    managedFileStore = new KnowledgeManagedFileStore(path.join(tempDir, 'managed'));
    migrationStore = new KnowledgeMigrationStore(db);
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const createService = (
    overrides: Partial<ConstructorParameters<typeof KnowledgeMigrationService>[0]> = {},
  ): KnowledgeMigrationService =>
    new KnowledgeMigrationService({
      db,
      documentStore,
      managedFileStore,
      jobStore,
      migrationStore,
      ...overrides,
    });

  test('migrates file-backed, text-only, and metadata-only legacy sources idempotently', async () => {
    const sourcePath = path.join(tempDir, 'manual.txt');
    await fs.writeFile(sourcePath, 'file-backed source');
    const sources: EnterpriseLeadExtractionSource[] = [
      {
        id: 'legacy-file',
        kind: EnterpriseLeadExtractionSourceKind.File,
        label: '产品手册',
        filePath: sourcePath,
        text: '已经解析的产品手册',
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'legacy-text',
        kind: EnterpriseLeadExtractionSourceKind.Manual,
        label: '访谈纪要',
        text: '客户重视交付稳定性',
      },
      {
        id: 'legacy-metadata',
        kind: EnterpriseLeadExtractionSourceKind.File,
        label: '旧版附件',
        filePath: path.join(tempDir, 'missing.doc'),
      },
    ];
    const originalSources = structuredClone(sources);
    const service = createService();

    const result = await service.migrateWorkspace({ id: 'workspace-a', extractionSources: sources });

    expect(result.status).toBe(KnowledgeMigrationStatus.Completed);
    expect(documentStore.listDocuments('workspace-a')).toHaveLength(3);
    expect(documentStore.findByLegacySourceId('workspace-a', 'legacy-file')).not.toBeNull();
    const migratedLegacyFile = documentStore.findByLegacySourceId(
      'workspace-a',
      'legacy-file',
    );
    expect(
      JSON.parse(documentStore.getLegacySourceSnapshotJson(migratedLegacyFile!.id) ?? '{}'),
    ).toMatchObject({
      id: 'legacy-file',
      label: '产品手册',
      filePath: sourcePath,
      text: '已经解析的产品手册',
    });
    expect(
      documentStore.findByLegacySourceId('workspace-a', 'legacy-metadata')?.status,
    ).toBe(KnowledgeDocumentStatus.CompletedWithoutText);
    expect(sources).toEqual(originalSources);

    await service.migrateWorkspace({ id: 'workspace-a', extractionSources: sources });
    expect(documentStore.listDocuments('workspace-a')).toHaveLength(3);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM knowledge_ingestion_jobs').get(),
    ).toEqual({ count: 0 });
  });

  test('keeps a parseable extension when an unprocessed file label has none', async () => {
    const sourcePath = path.join(tempDir, 'catalog.txt');
    await fs.writeFile(sourcePath, 'file-backed source');

    await createService().migrateWorkspace({
      id: 'workspace-a',
      extractionSources: [
        {
          id: 'legacy-unprocessed-file',
          kind: EnterpriseLeadExtractionSourceKind.File,
          label: '产品目录',
          filePath: sourcePath,
        },
      ],
    });

    const document = documentStore.findByLegacySourceId(
      'workspace-a',
      'legacy-unprocessed-file',
    );
    expect(document?.displayName).toBe('catalog.txt');
    expect(document?.status).toBe(KnowledgeDocumentStatus.Pending);
    expect(jobStore.listCurrentJobs('workspace-a')).toHaveLength(1);
  });

  test('falls back to saved text when the original file is missing', async () => {
    const service = createService();
    await service.migrateWorkspace({
      id: 'workspace-a',
      extractionSources: [
        {
          id: 'legacy-text-fallback',
          kind: EnterpriseLeadExtractionSourceKind.File,
          label: '已删除原文件',
          filePath: path.join(tempDir, 'missing.pdf'),
          text: '数据库中保留的文本快照',
        },
      ],
    });

    const document = documentStore.findByLegacySourceId('workspace-a', 'legacy-text-fallback');
    expect(document).not.toBeNull();
    expect(documentStore.getVersion(document!.currentVersionId)?.extractedText).toBe(
      '数据库中保留的文本快照',
    );
  });

  test('uses a deterministic identity for legacy sources without ids', async () => {
    const service = createService();
    const workspace = {
      id: 'workspace-a',
      extractionSources: [
        {
          kind: EnterpriseLeadExtractionSourceKind.Manual,
          label: '无 ID 资料',
          text: '稳定迁移内容',
        },
      ],
    };

    await service.migrateWorkspace(workspace);
    const first = documentStore.listDocuments('workspace-a')[0];
    await service.migrateWorkspace(workspace);
    const second = documentStore.listDocuments('workspace-a')[0];

    expect(second?.id).toBe(first?.id);
    expect(second?.legacySourceId).toBe(first?.legacySourceId);
  });

  test('records failure without mutating legacy data when managed import fails', async () => {
    const source: EnterpriseLeadExtractionSource = {
      id: 'legacy-file',
      kind: EnterpriseLeadExtractionSourceKind.File,
      label: '不可读文件',
      filePath: path.join(tempDir, 'unreadable.pdf'),
    };
    const importFile = vi.fn(async () => {
      throw new Error('read denied');
    });
    const service = createService({
      managedFileStore: {
        importFile,
        importTextSnapshot: managedFileStore.importTextSnapshot.bind(managedFileStore),
      },
      fileExists: async () => true,
    });
    const original = structuredClone(source);

    const result = await service.migrateWorkspace({
      id: 'workspace-a',
      extractionSources: [source],
    });

    expect(result.status).toBe(KnowledgeMigrationStatus.Failed);
    expect(documentStore.listDocuments('workspace-a')).toEqual([]);
    expect(source).toEqual(original);
    expect(migrationStore.getState('workspace-a')?.status).toBe(
      KnowledgeMigrationStatus.Failed,
    );
  });

  test('rolls back document creation when job creation fails', async () => {
    const sourcePath = path.join(tempDir, 'atomic.txt');
    await fs.writeFile(sourcePath, '需要原子迁移');
    const service = createService({
      jobStore: {
        createJob: () => {
          throw new Error('job insert failed');
        },
      },
    });

    const result = await service.migrateWorkspace({
      id: 'workspace-a',
      extractionSources: [
        {
          id: 'legacy-text',
          kind: EnterpriseLeadExtractionSourceKind.File,
          label: '文本资料',
          filePath: sourcePath,
        },
      ],
    });

    expect(result.status).toBe(KnowledgeMigrationStatus.Failed);
    expect(documentStore.listDocuments('workspace-a')).toEqual([]);
  });

  test('does not double count checkpointed sources when a failed migration resumes', async () => {
    const firstPath = path.join(tempDir, 'first.txt');
    const secondPath = path.join(tempDir, 'second.txt');
    await fs.writeFile(firstPath, '第一份文本');
    await fs.writeFile(secondPath, '第二份文本');
    let createJobCalls = 0;
    const failingService = createService({
      jobStore: {
        createJob: (input, now) => {
          createJobCalls += 1;
          if (createJobCalls === 2) {
            throw new Error('second job insert failed');
          }
          return jobStore.createJob(input, now);
        },
      },
    });
    const workspace = {
      id: 'workspace-a',
      extractionSources: [
        {
          id: 'legacy-first',
          kind: EnterpriseLeadExtractionSourceKind.File,
          label: '第一份资料',
          filePath: firstPath,
        },
        {
          id: 'legacy-second',
          kind: EnterpriseLeadExtractionSourceKind.File,
          label: '第二份资料',
          filePath: secondPath,
        },
      ],
    };

    const failed = await failingService.migrateWorkspace(workspace);
    expect(failed.migratedCount).toBe(1);

    const resumed = await createService().migrateWorkspace(workspace);
    expect(resumed.status).toBe(KnowledgeMigrationStatus.Completed);
    expect(resumed.migratedCount).toBe(2);
    expect(documentStore.listDocuments('workspace-a')).toHaveLength(2);
  });
});
