import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeDocumentVisibility,
} from '../../shared/knowledgeBase/constants';
import type { CreateKnowledgeDocumentInput } from '../../shared/knowledgeBase/types';
import {
  KnowledgeDocumentRevisionConflictError,
  KnowledgeDocumentStore,
} from './knowledgeDocumentStore';

const createInput = (
  overrides: Partial<CreateKnowledgeDocumentInput> = {},
): CreateKnowledgeDocumentInput => ({
  workspaceId: 'workspace-a',
  legacySourceId: 'legacy-source-a',
  displayName: '产品手册',
  sourceMode: KnowledgeDocumentSourceMode.Managed,
  originalPath: '/tmp/product-manual.pdf',
  status: KnowledgeDocumentStatus.Ready,
  version: {
    contentHash: 'a'.repeat(64),
    managedPath: `blobs/aa/${'a'.repeat(64)}`,
    mimeType: 'application/pdf',
    fileSize: 1024,
    sourceMtime: 1_720_000_000_000,
    parser: 'pdf',
    extractedText: '原始资料文本',
    extractionPartial: false,
  },
  ...overrides,
});

describe('KnowledgeDocumentStore', () => {
  let db: Database.Database;
  let store: KnowledgeDocumentStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new KnowledgeDocumentStore(db);
  });

  afterEach(() => {
    db.close();
  });

  test('creates an immutable version and rejects stale metadata revisions', () => {
    const created = store.createDocumentWithVersion(createInput());

    const renamed = store.updateDocumentMetadata(created.document.id, 1, {
      displayName: '新版产品手册',
    });

    expect(renamed.revision).toBe(2);
    expect(renamed.displayName).toBe('新版产品手册');
    expect(() =>
      store.updateDocumentMetadata(created.document.id, 1, { displayName: '旧页面覆盖' }),
    ).toThrow(KnowledgeDocumentRevisionConflictError);
    expect(store.getVersion(created.version.id)?.extractedText).toBe('原始资料文本');
  });

  test('adds a version without mutating the previous version', () => {
    const created = store.createDocumentWithVersion(createInput());
    const next = store.addVersion(created.document.id, 1, {
      ...createInput().version,
      contentHash: 'b'.repeat(64),
      managedPath: `blobs/bb/${'b'.repeat(64)}`,
      extractedText: '第二版资料文本',
    });

    expect(next.document.currentVersionId).toBe(next.version.id);
    expect(next.document.revision).toBe(2);
    expect(store.getVersion(created.version.id)?.extractedText).toBe('原始资料文本');
    expect(store.getVersion(next.version.id)?.extractedText).toBe('第二版资料文本');
  });

  test('soft deletes and restores documents with optimistic revisions', () => {
    const created = store.createDocumentWithVersion(createInput());
    const deleted = store.softDeleteDocument(created.document.id, 1);

    expect(deleted.deletedAt).not.toBeNull();
    expect(store.listDocuments('workspace-a')).toEqual([]);
    expect(store.listDocuments('workspace-a', { includeDeleted: true })).toHaveLength(1);

    const restored = store.restoreDocument(created.document.id, 2);
    expect(restored.deletedAt).toBeNull();
    expect(restored.revision).toBe(3);
    expect(store.listDocuments('workspace-a')).toHaveLength(1);
  });

  test('enforces one legacy source identity per workspace', () => {
    store.createDocumentWithVersion(createInput());

    expect(() =>
      store.createDocumentWithVersion(
        createInput({ displayName: '重复资料', legacySourceId: 'legacy-source-a' }),
      ),
    ).toThrow();
    expect(store.findByLegacySourceId('workspace-a', 'legacy-source-a')).not.toBeNull();
  });

  test('stores an internal legacy source snapshot without exposing it on document rows', () => {
    const legacySourceSnapshotJson = JSON.stringify({
      id: 'legacy-source-a',
      kind: 'manual',
      label: '旧资料',
      text: '不应进入列表 DTO 的原始正文',
    });
    const created = store.createDocumentWithVersion({
      ...createInput(),
      legacySourceSnapshotJson,
    });

    expect(store.getLegacySourceSnapshotJson(created.document.id)).toBe(
      legacySourceSnapshotJson,
    );
    expect(created.document).not.toHaveProperty('legacySourceSnapshotJson');
    expect(store.listDocuments('workspace-a')[0]).not.toHaveProperty(
      'legacySourceSnapshotJson',
    );
  });

  test('adds the legacy snapshot column when opening an existing normalized database', () => {
    db.close();
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE knowledge_documents (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        legacy_source_id TEXT,
        display_name TEXT NOT NULL,
        source_mode TEXT NOT NULL,
        original_path TEXT,
        current_version_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
    `);

    store = new KnowledgeDocumentStore(db);
    const columns = db.prepare('PRAGMA table_info(knowledge_documents)').all() as Array<{
      name: string;
    }>;
    expect(columns.map(column => column.name)).toContain('legacy_source_snapshot_json');

    const created = store.createDocumentWithVersion({
      ...createInput(),
      legacySourceSnapshotJson: '{"id":"legacy-source-a"}',
    });
    expect(store.getLegacySourceSnapshotJson(created.document.id)).toBe(
      '{"id":"legacy-source-a"}',
    );
  });

  test('lists 1000 document summaries without exposing extracted text', () => {
    for (let index = 0; index < 1000; index += 1) {
      store.createDocumentWithVersion(
        createInput({
          displayName: `资料-${index}`,
          legacySourceId: `legacy-${index}`,
        }),
      );
    }

    const documents = store.listDocuments('workspace-a');
    expect(documents).toHaveLength(1000);
    expect(documents[0]).not.toHaveProperty('extractedText');
    expect(documents[0]?.contentHash).toBe('a'.repeat(64));
  });

  test('lists active and deleted documents separately', () => {
    const active = store.createDocumentWithVersion(createInput());
    const deleted = store.createDocumentWithVersion(
      createInput({ displayName: '归档资料', legacySourceId: 'legacy-source-b' }),
    );
    store.softDeleteDocument(deleted.document.id, deleted.document.revision);

    expect(
      store
        .listDocuments('workspace-a', { visibility: KnowledgeDocumentVisibility.Active })
        .map(document => document.id),
    ).toEqual([active.document.id]);
    expect(
      store
        .listDocuments('workspace-a', { visibility: KnowledgeDocumentVisibility.Deleted })
        .map(document => document.id),
    ).toEqual([deleted.document.id]);
  });

  test('sums only active managed current-version bytes for workspace quota', () => {
    store.createDocumentWithVersion(
      createInput({
        legacySourceId: 'managed-active',
        version: { ...createInput().version, fileSize: 10 },
      }),
    );
    const deleted = store.createDocumentWithVersion(
      createInput({
        legacySourceId: 'managed-deleted',
        version: { ...createInput().version, fileSize: 20 },
      }),
    );
    store.softDeleteDocument(deleted.document.id, deleted.document.revision);
    store.createDocumentWithVersion(
      createInput({
        legacySourceId: 'linked-active',
        sourceMode: KnowledgeDocumentSourceMode.Linked,
        version: { ...createInput().version, fileSize: 30 },
      }),
    );
    const versioned = store.createDocumentWithVersion(
      createInput({
        legacySourceId: 'managed-versioned',
        version: { ...createInput().version, fileSize: 40 },
      }),
    );
    store.addVersion(versioned.document.id, versioned.document.revision, {
      ...createInput().version,
      contentHash: 'b'.repeat(64),
      fileSize: 50,
      managedPath: `blobs/bb/${'b'.repeat(64)}`,
    });
    store.createDocumentWithVersion(
      createInput({
        legacySourceId: 'other-workspace',
        workspaceId: 'workspace-b',
        version: { ...createInput().version, fileSize: 60 },
      }),
    );

    expect(store.getActiveManagedBytes('workspace-a')).toBe(60);
  });

  test('commits extraction only for an active current version', () => {
    const created = store.createDocumentWithVersion(
      createInput({
        status: KnowledgeDocumentStatus.Pending,
        version: {
          ...createInput().version,
          extractedText: null,
          extractionPartial: false,
          parser: null,
        },
      }),
    );

    expect(
      store.applyExtractionResult({
        documentId: created.document.id,
        documentVersionId: created.version.id,
        extractedText: 'local text',
        extractionPartial: true,
        parser: 'pdf',
        status: KnowledgeDocumentStatus.Ready,
      }),
    ).toBe(true);
    expect(store.getVersion(created.version.id)).toMatchObject({
      extractedText: 'local text',
      extractionPartial: true,
      parser: 'pdf',
    });
    expect(store.getDocument(created.document.id)).toMatchObject({
      revision: 2,
      status: KnowledgeDocumentStatus.Ready,
    });
  });

  test('rejects worker output for a replaced or deleted version', () => {
    const replaced = store.createDocumentWithVersion(
      createInput({ legacySourceId: 'replaced' }),
    );
    store.addVersion(replaced.document.id, replaced.document.revision, {
      ...createInput().version,
      contentHash: 'b'.repeat(64),
      managedPath: `blobs/bb/${'b'.repeat(64)}`,
    });
    expect(
      store.applyExtractionResult({
        documentId: replaced.document.id,
        documentVersionId: replaced.version.id,
        extractedText: 'stale text',
        extractionPartial: false,
        parser: 'pdf',
        status: KnowledgeDocumentStatus.Ready,
      }),
    ).toBe(false);

    const deleted = store.createDocumentWithVersion(
      createInput({ legacySourceId: 'deleted' }),
    );
    store.softDeleteDocument(deleted.document.id, deleted.document.revision);
    expect(
      store.setDocumentStatusIfCurrentVersion({
        documentId: deleted.document.id,
        documentVersionId: deleted.version.id,
        status: KnowledgeDocumentStatus.Processing,
      }),
    ).toBe(false);
  });
});
