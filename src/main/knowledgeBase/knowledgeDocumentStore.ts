import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';

import {
  KnowledgeDocumentSourceMode,
  type KnowledgeDocumentStatus,
  KnowledgeDocumentVisibility as KnowledgeDocumentVisibilities,
  type KnowledgeDocumentVisibility,
} from '../../shared/knowledgeBase/constants';
import type {
  CreateKnowledgeDocumentInput,
  KnowledgeDocument,
  KnowledgeDocumentSummary,
  KnowledgeDocumentVersion,
} from '../../shared/knowledgeBase/types';

type KnowledgeDocumentRow = {
  id: string;
  workspace_id: string;
  legacy_source_id: string | null;
  display_name: string;
  source_mode: KnowledgeDocument['sourceMode'];
  original_path: string | null;
  current_version_id: string;
  revision: number;
  status: KnowledgeDocument['status'];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type KnowledgeDocumentSummaryRow = KnowledgeDocumentRow & {
  file_size: number | null;
  mime_type: string | null;
  content_hash: string | null;
};

type KnowledgeDocumentVersionRow = {
  id: string;
  document_id: string;
  content_hash: string | null;
  managed_path: string | null;
  mime_type: string | null;
  file_size: number | null;
  source_mtime: number | null;
  parser: string | null;
  extracted_text: string | null;
  extraction_partial: number;
  created_at: string;
};

const mapDocumentRow = (row: KnowledgeDocumentRow): KnowledgeDocument => ({
  id: row.id,
  workspaceId: row.workspace_id,
  legacySourceId: row.legacy_source_id,
  displayName: row.display_name,
  sourceMode: row.source_mode,
  originalPath: row.original_path,
  currentVersionId: row.current_version_id,
  revision: row.revision,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
});

const mapDocumentSummaryRow = (row: KnowledgeDocumentSummaryRow): KnowledgeDocumentSummary => ({
  ...mapDocumentRow(row),
  fileSize: row.file_size,
  mimeType: row.mime_type,
  contentHash: row.content_hash,
});

const mapVersionRow = (row: KnowledgeDocumentVersionRow): KnowledgeDocumentVersion => ({
  id: row.id,
  documentId: row.document_id,
  contentHash: row.content_hash,
  managedPath: row.managed_path,
  mimeType: row.mime_type,
  fileSize: row.file_size,
  sourceMtime: row.source_mtime,
  parser: row.parser,
  extractedText: row.extracted_text,
  extractionPartial: row.extraction_partial === 1,
  createdAt: row.created_at,
});

const cleanRequiredText = (value: string, label: string): string => {
  const cleaned = value.trim();
  if (!cleaned) {
    throw new Error(`${label} is required`);
  }
  return cleaned;
};

const cleanOptionalText = (value?: string): string | null => {
  const cleaned = value?.trim() ?? '';
  return cleaned || null;
};

export class KnowledgeDocumentRevisionConflictError extends Error {
  readonly currentDocument: KnowledgeDocument;

  constructor(currentDocument: KnowledgeDocument) {
    super(`Knowledge document revision conflict: current revision is ${currentDocument.revision}`);
    this.name = 'KnowledgeDocumentRevisionConflictError';
    this.currentDocument = currentDocument;
  }
}

export class KnowledgeDocumentStore {
  constructor(private readonly db: Database.Database) {
    this.initialize();
  }

  createDocumentWithVersion(
    input: CreateKnowledgeDocumentInput & { legacySourceSnapshotJson?: string },
  ): {
    document: KnowledgeDocument;
    version: KnowledgeDocumentVersion;
  } {
    const transaction = this.db.transaction(() => {
      const now = new Date().toISOString();
      const documentId = randomUUID();
      const versionId = randomUUID();

      this.db
        .prepare(
          `
          INSERT INTO knowledge_documents (
            id,
            workspace_id,
            legacy_source_id,
            legacy_source_snapshot_json,
            display_name,
            source_mode,
            original_path,
            current_version_id,
            revision,
            status,
            created_at,
            updated_at,
            deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)
        `,
        )
        .run(
          documentId,
          cleanRequiredText(input.workspaceId, 'Workspace id'),
          cleanOptionalText(input.legacySourceId),
          cleanOptionalText(input.legacySourceSnapshotJson),
          cleanRequiredText(input.displayName, 'Document display name'),
          input.sourceMode,
          cleanOptionalText(input.originalPath),
          versionId,
          input.status,
          now,
          now,
        );

      this.insertVersion(documentId, versionId, input.version, now);

      return {
        document: this.requireDocument(documentId),
        version: this.requireVersion(versionId),
      };
    });

    return transaction();
  }

  getDocument(documentId: string): KnowledgeDocument | null {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          workspace_id,
          legacy_source_id,
          display_name,
          source_mode,
          original_path,
          current_version_id,
          revision,
          status,
          created_at,
          updated_at,
          deleted_at
        FROM knowledge_documents
        WHERE id = ?
        LIMIT 1
      `,
      )
      .get(documentId) as KnowledgeDocumentRow | undefined;

    return row ? mapDocumentRow(row) : null;
  }

  getVersion(versionId: string): KnowledgeDocumentVersion | null {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          document_id,
          content_hash,
          managed_path,
          mime_type,
          file_size,
          source_mtime,
          parser,
          extracted_text,
          extraction_partial,
          created_at
        FROM knowledge_document_versions
        WHERE id = ?
        LIMIT 1
      `,
      )
      .get(versionId) as KnowledgeDocumentVersionRow | undefined;

    return row ? mapVersionRow(row) : null;
  }

  getLegacySourceSnapshotJson(documentId: string): string | null {
    const row = this.db
      .prepare(
        `
        SELECT legacy_source_snapshot_json
        FROM knowledge_documents
        WHERE id = ?
        LIMIT 1
      `,
      )
      .get(documentId.trim()) as { legacy_source_snapshot_json: string | null } | undefined;
    return row?.legacy_source_snapshot_json ?? null;
  }

  findByLegacySourceId(workspaceId: string, legacySourceId: string): KnowledgeDocument | null {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          workspace_id,
          legacy_source_id,
          display_name,
          source_mode,
          original_path,
          current_version_id,
          revision,
          status,
          created_at,
          updated_at,
          deleted_at
        FROM knowledge_documents
        WHERE workspace_id = ? AND legacy_source_id = ?
        LIMIT 1
      `,
      )
      .get(workspaceId.trim(), legacySourceId.trim()) as KnowledgeDocumentRow | undefined;

    return row ? mapDocumentRow(row) : null;
  }

  listDocuments(
    workspaceId: string,
    options: {
      includeDeleted?: boolean;
      visibility?: KnowledgeDocumentVisibility;
    } = {},
  ): KnowledgeDocumentSummary[] {
    const visibility = options.visibility
      ? options.visibility
      : options.includeDeleted
        ? 'all'
        : KnowledgeDocumentVisibilities.Active;
    const rows = this.db
      .prepare(
        `
        SELECT
          document.id,
          document.workspace_id,
          document.legacy_source_id,
          document.display_name,
          document.source_mode,
          document.original_path,
          document.current_version_id,
          document.revision,
          document.status,
          document.created_at,
          document.updated_at,
          document.deleted_at,
          version.file_size,
          version.mime_type,
          version.content_hash
        FROM knowledge_documents AS document
        JOIN knowledge_document_versions AS version
          ON version.id = document.current_version_id
        WHERE
          document.workspace_id = ?
          AND (
            ? = 'all'
            OR (? = 'active' AND document.deleted_at IS NULL)
            OR (? = 'deleted' AND document.deleted_at IS NOT NULL)
          )
        ORDER BY document.updated_at DESC, document.id ASC
      `,
      )
      .all(workspaceId.trim(), visibility, visibility, visibility) as KnowledgeDocumentSummaryRow[];

    return rows.map(mapDocumentSummaryRow);
  }

  getActiveManagedBytes(workspaceId: string): number {
    const row = this.db
      .prepare(
        `
        SELECT COALESCE(SUM(version.file_size), 0) AS total
        FROM knowledge_documents AS document
        JOIN knowledge_document_versions AS version
          ON version.id = document.current_version_id
        WHERE
          document.workspace_id = ?
          AND document.deleted_at IS NULL
          AND document.source_mode = ?
      `,
      )
      .get(workspaceId.trim(), KnowledgeDocumentSourceMode.Managed) as { total: number };
    return Number.isFinite(row.total) ? row.total : 0;
  }

  applyExtractionResult(input: {
    documentId: string;
    documentVersionId: string;
    parser: string;
    extractedText: string | null;
    extractionPartial: boolean;
    status: KnowledgeDocument['status'];
  }): boolean {
    const transaction = this.db.transaction(() =>
      this.applyExtractionResultInCurrentTransaction(input));
    return transaction();
  }

  applyExtractionResultInCurrentTransaction(input: {
    documentId: string;
    documentVersionId: string;
    parser: string;
    extractedText: string | null;
    extractionPartial: boolean;
    status: KnowledgeDocument['status'];
  }): boolean {
    this.assertCurrentTransaction();
    if (!this.isActiveCurrentVersion(input.documentId, input.documentVersionId)) {
      return false;
    }
    const versionUpdate = this.db
      .prepare(
        `
          UPDATE knowledge_document_versions
          SET parser = ?, extracted_text = ?, extraction_partial = ?
          WHERE id = ? AND document_id = ?
      `,
      )
      .run(
        cleanRequiredText(input.parser, 'Parser'),
        input.extractedText,
        input.extractionPartial ? 1 : 0,
        input.documentVersionId,
        input.documentId,
      );
    if (versionUpdate.changes === 0) return false;
    return this.updateActiveCurrentVersionStatus(
      input.documentId,
      input.documentVersionId,
      input.status,
    );
  }

  setDocumentStatusIfCurrentVersion(input: {
    documentId: string;
    documentVersionId: string;
    status: KnowledgeDocument['status'];
  }): boolean {
    return this.updateActiveCurrentVersionStatus(
      input.documentId,
      input.documentVersionId,
      input.status,
    );
  }

  updateDocumentMetadata(
    documentId: string,
    expectedRevision: number,
    patch: {
      displayName?: string;
      status?: KnowledgeDocument['status'];
    },
  ): KnowledgeDocument {
    const current = this.requireExpectedRevision(documentId, expectedRevision);
    const now = new Date().toISOString();
    const displayName =
      patch.displayName === undefined
        ? current.displayName
        : cleanRequiredText(patch.displayName, 'Document display name');
    const status = patch.status ?? current.status;
    const result = this.db
      .prepare(
        `
        UPDATE knowledge_documents
        SET display_name = ?, status = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ?
      `,
      )
      .run(displayName, status, now, documentId, expectedRevision);

    this.throwIfRevisionUpdateMissed(documentId, result.changes);
    return this.requireDocument(documentId);
  }

  addVersion(
    documentId: string,
    expectedRevision: number,
    version: CreateKnowledgeDocumentInput['version'],
    status?: KnowledgeDocumentStatus,
  ): {
    document: KnowledgeDocument;
    version: KnowledgeDocumentVersion;
  } {
    const transaction = this.db.transaction(() =>
      this.addVersionInCurrentTransaction(documentId, expectedRevision, version, status));
    return transaction();
  }

  addVersionInCurrentTransaction(
    documentId: string,
    expectedRevision: number,
    version: CreateKnowledgeDocumentInput['version'],
    status?: KnowledgeDocumentStatus,
  ): { document: KnowledgeDocument; version: KnowledgeDocumentVersion } {
    this.assertCurrentTransaction();
    const current = this.requireExpectedRevision(documentId, expectedRevision);
    const now = new Date().toISOString();
    const versionId = randomUUID();
    this.insertVersion(documentId, versionId, version, now);
    const result = this.db
      .prepare(
        `
          UPDATE knowledge_documents
          SET current_version_id = ?, status = ?, revision = revision + 1, updated_at = ?
          WHERE id = ? AND revision = ?
      `,
      )
      .run(versionId, status ?? current.status, now, documentId, expectedRevision);
    this.throwIfRevisionUpdateMissed(documentId, result.changes);
    return {
      document: this.requireDocument(documentId),
      version: this.requireVersion(versionId),
    };
  }

  softDeleteDocument(documentId: string, expectedRevision: number): KnowledgeDocument {
    const transaction = this.db.transaction(() =>
      this.softDeleteDocumentInCurrentTransaction(documentId, expectedRevision));
    return transaction();
  }

  softDeleteDocumentInCurrentTransaction(
    documentId: string,
    expectedRevision: number,
  ): KnowledgeDocument {
    this.assertCurrentTransaction();
    return this.setDeletedAt(documentId, expectedRevision, new Date().toISOString());
  }

  restoreDocument(documentId: string, expectedRevision: number): KnowledgeDocument {
    const transaction = this.db.transaction(() =>
      this.restoreDocumentInCurrentTransaction(documentId, expectedRevision));
    return transaction();
  }

  restoreDocumentInCurrentTransaction(
    documentId: string,
    expectedRevision: number,
  ): KnowledgeDocument {
    this.assertCurrentTransaction();
    return this.setDeletedAt(documentId, expectedRevision, null);
  }

  deleteWorkspaceDocuments(workspaceId: string): number {
    const normalizedWorkspaceId = cleanRequiredText(workspaceId, 'Workspace id');
    const transaction = this.db.transaction(() =>
      this.deleteWorkspaceDocumentsInCurrentTransaction(normalizedWorkspaceId));
    return transaction();
  }

  deleteWorkspaceDocumentsInCurrentTransaction(workspaceId: string): number {
    this.assertCurrentTransaction();
    const normalizedWorkspaceId = cleanRequiredText(workspaceId, 'Workspace id');
      this.db
        .prepare(
          `
          DELETE FROM knowledge_document_versions
          WHERE document_id IN (
            SELECT id FROM knowledge_documents WHERE workspace_id = ?
          )
        `,
        )
        .run(normalizedWorkspaceId);
    return this.db
        .prepare('DELETE FROM knowledge_documents WHERE workspace_id = ?')
        .run(normalizedWorkspaceId).changes;
  }

  deleteParentlessVersionsInCurrentTransaction(): number {
    this.assertCurrentTransaction();
    return this.db.prepare(`
      DELETE FROM knowledge_document_versions
      WHERE NOT EXISTS (
        SELECT 1 FROM knowledge_documents AS document
        WHERE document.id = knowledge_document_versions.document_id
      )
    `).run().changes;
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        legacy_source_id TEXT,
        legacy_source_snapshot_json TEXT,
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

      CREATE TABLE IF NOT EXISTS knowledge_document_versions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        content_hash TEXT,
        managed_path TEXT,
        mime_type TEXT,
        file_size INTEGER,
        source_mtime REAL,
        parser TEXT,
        extracted_text TEXT,
        extraction_partial INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_documents_workspace
      ON knowledge_documents(workspace_id, deleted_at, updated_at);

      CREATE INDEX IF NOT EXISTS idx_knowledge_documents_current_version
      ON knowledge_documents(workspace_id, current_version_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_documents_legacy_source
      ON knowledge_documents(workspace_id, legacy_source_id)
      WHERE legacy_source_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_knowledge_document_versions_document
      ON knowledge_document_versions(document_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_knowledge_document_versions_hash
      ON knowledge_document_versions(content_hash);
    `);

    const documentColumns = this.db
      .prepare('PRAGMA table_info(knowledge_documents)')
      .all() as Array<{ name: string }>;
    if (!documentColumns.some(column => column.name === 'legacy_source_snapshot_json')) {
      this.db.exec(
        'ALTER TABLE knowledge_documents ADD COLUMN legacy_source_snapshot_json TEXT',
      );
    }
  }

  private isActiveCurrentVersion(documentId: string, documentVersionId: string): boolean {
    const row = this.db
      .prepare(
        `
        SELECT 1
        FROM knowledge_documents
        WHERE id = ? AND current_version_id = ? AND deleted_at IS NULL
        LIMIT 1
      `,
      )
      .get(documentId, documentVersionId);
    return Boolean(row);
  }

  private updateActiveCurrentVersionStatus(
    documentId: string,
    documentVersionId: string,
    status: KnowledgeDocument['status'],
  ): boolean {
    const result = this.db
      .prepare(
        `
        UPDATE knowledge_documents
        SET status = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND current_version_id = ? AND deleted_at IS NULL
      `,
      )
      .run(status, new Date().toISOString(), documentId, documentVersionId);
    return result.changes > 0;
  }

  private insertVersion(
    documentId: string,
    versionId: string,
    version: CreateKnowledgeDocumentInput['version'],
    createdAt: string,
  ): void {
    this.db
      .prepare(
        `
        INSERT INTO knowledge_document_versions (
          id,
          document_id,
          content_hash,
          managed_path,
          mime_type,
          file_size,
          source_mtime,
          parser,
          extracted_text,
          extraction_partial,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        versionId,
        documentId,
        version.contentHash,
        version.managedPath,
        version.mimeType,
        version.fileSize,
        version.sourceMtime,
        version.parser,
        version.extractedText,
        version.extractionPartial ? 1 : 0,
        createdAt,
      );
  }

  private setDeletedAt(
    documentId: string,
    expectedRevision: number,
    deletedAt: string | null,
  ): KnowledgeDocument {
    this.requireExpectedRevision(documentId, expectedRevision);
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `
        UPDATE knowledge_documents
        SET deleted_at = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ?
      `,
      )
      .run(deletedAt, now, documentId, expectedRevision);

    this.throwIfRevisionUpdateMissed(documentId, result.changes);
    return this.requireDocument(documentId);
  }

  private assertCurrentTransaction(): void {
    if (!this.db.inTransaction) {
      throw new Error('Knowledge document transaction required');
    }
  }

  private requireExpectedRevision(documentId: string, expectedRevision: number): KnowledgeDocument {
    const current = this.requireDocument(documentId);
    if (current.revision !== expectedRevision) {
      throw new KnowledgeDocumentRevisionConflictError(current);
    }
    return current;
  }

  private throwIfRevisionUpdateMissed(documentId: string, changes: number): void {
    if (changes > 0) {
      return;
    }
    throw new KnowledgeDocumentRevisionConflictError(this.requireDocument(documentId));
  }

  private requireDocument(documentId: string): KnowledgeDocument {
    const document = this.getDocument(documentId);
    if (!document) {
      throw new Error('Knowledge document not found');
    }
    return document;
  }

  private requireVersion(versionId: string): KnowledgeDocumentVersion {
    const version = this.getVersion(versionId);
    if (!version) {
      throw new Error('Knowledge document version not found');
    }
    return version;
  }
}
