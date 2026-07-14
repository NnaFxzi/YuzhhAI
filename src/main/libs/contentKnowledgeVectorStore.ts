import Database from 'better-sqlite3';
import crypto from 'crypto';

import {
  buildEnterpriseLeadWorkspaceKnowledgeScopeId,
  EnterpriseLeadKnowledgeScope,
} from '../../shared/enterpriseLeadWorkspace/constants';
import {
  KNOWLEDGE_DOCUMENT_LEGACY_SOURCE_PREFIX,
  KnowledgeDocumentStatus,
} from '../../shared/knowledgeBase/constants';
import {
  buildContentKnowledgeIndex,
  CONTENT_KNOWLEDGE_EMBEDDING_VERSION,
  type ContentKnowledgeChunk,
  type ContentKnowledgeEvidenceTier,
  type ContentKnowledgeRetrievalResult,
  type ContentKnowledgeRetrieverInput,
  type ContentKnowledgeSearchOptions,
  type ContentKnowledgeSource,
  ContentKnowledgeSourceType,
  searchContentKnowledgeIndex,
} from './contentKnowledgeRetrieval';
import { runTransientSqliteWriteTransaction } from './sqliteTransactionRetry';

const CONTENT_KNOWLEDGE_SOURCE_PARTITION_ERROR = 'Invalid content knowledge source partition';
const CONTENT_KNOWLEDGE_DELETE_BATCH_SIZE = 400;
const ENTERPRISE_WORKSPACE_SCOPE_PREFIX = `${EnterpriseLeadKnowledgeScope.Workspace}:`;
const RAW_WORKSPACE_SOURCE_TYPES = [ContentKnowledgeSourceType.WorkspaceDocument] as const;
const TRUSTED_WORKSPACE_SOURCE_TYPES = [
  ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
  ContentKnowledgeSourceType.WorkspaceRule,
] as const;

export type ContentKnowledgeSourceSyncResult = {
  sourceId: string;
  chunkCount: number;
};

export type ContentKnowledgeScopeSyncResult = {
  scopeId: string;
  sourceResults: ContentKnowledgeSourceSyncResult[];
  totalChunkCount: number;
};

type ContentKnowledgeChunkRow = {
  id: string;
  source_id: string;
  source_type: string;
  source_label: string;
  chunk_index: number;
  content: string;
  checksum: string;
  embedding_version: string;
  embedding_json: string;
  tokens_json: string;
  signals_json: string;
  business_signals_json: string;
  business_signal_count: number;
  source_priority: number | null;
  verified_by_user: number | null;
  evidence_tier: ContentKnowledgeEvidenceTier | null;
};

const parseJsonArray = <T>(value: string, fallback: T[]): T[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
};

const buildStoredChunkId = (scopeId: string, chunkId: string): string =>
  crypto.createHash('sha1').update(scopeId).update('\0').update(chunkId).digest('hex');

const mapRowToChunk = (row: ContentKnowledgeChunkRow): ContentKnowledgeChunk => ({
  id: row.id,
  sourceId: row.source_id,
  sourceType: row.source_type,
  sourceLabel: row.source_label,
  chunkIndex: row.chunk_index,
  text: row.content,
  checksum: row.checksum,
  embeddingVersion: row.embedding_version,
  embedding: parseJsonArray<number>(row.embedding_json, []),
  tokens: parseJsonArray<string>(row.tokens_json, []),
  signals: parseJsonArray<string>(row.signals_json, []),
  businessSignals: parseJsonArray<string>(row.business_signals_json, []),
  businessSignalCount: row.business_signal_count,
  sourcePriority: row.source_priority ?? 0,
  verifiedByUser: row.verified_by_user === 1,
  evidenceTier: row.evidence_tier ?? undefined,
});

type TableInfoRow = {
  name: string;
};

type PreparedContentKnowledgeSource = {
  source: ContentKnowledgeSource;
  chunks: ContentKnowledgeChunk[];
};

export const ContentKnowledgeLeaseStage = {
  AfterRawRevalidationBeforeFirstWrite:
    'after_raw_lease_revalidation_before_first_write',
  AfterTrustedRevalidationBeforeFirstWrite:
    'after_trusted_lease_revalidation_before_first_write',
} as const;
export type ContentKnowledgeLeaseStage =
  (typeof ContentKnowledgeLeaseStage)[keyof typeof ContentKnowledgeLeaseStage];

type ContentKnowledgeVectorStoreOptions = {
  onLeaseStage?: (stage: ContentKnowledgeLeaseStage) => void;
};

type WorkspaceDocumentLeaseRow = {
  workspace_id: string;
  document_id: string;
  legacy_source_id: string | null;
  display_name: string;
  status: string;
  deleted_at: string | null;
  current_version_id: string;
  extracted_text: string | null;
};

const clonePartitionSources = (
  sources: ContentKnowledgeSource[],
  allowedSourceTypes: ReadonlySet<string>,
): ContentKnowledgeSource[] => {
  if (!Array.isArray(sources)) throw new Error(CONTENT_KNOWLEDGE_SOURCE_PARTITION_ERROR);
  const cloned: ContentKnowledgeSource[] = [];
  const sourceIds = new Set<string>();
  for (let index = 0; index < sources.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(sources, index)) {
      throw new Error(CONTENT_KNOWLEDGE_SOURCE_PARTITION_ERROR);
    }
    const source = sources[index];
    if (!source || typeof source !== 'object') {
      throw new Error(CONTENT_KNOWLEDGE_SOURCE_PARTITION_ERROR);
    }
    const sourceId = source.sourceId;
    const sourceType = source.sourceType;
    const label = source.label;
    const content = source.content;
    const updatedAt = source.updatedAt;
    const priority = source.priority;
    const verifiedByUser = source.verifiedByUser;
    const evidenceTier = source.evidenceTier;
    if (
      typeof sourceId !== 'string'
      || sourceId.trim().length === 0
      || sourceIds.has(sourceId)
      || typeof sourceType !== 'string'
      || !allowedSourceTypes.has(sourceType)
      || typeof label !== 'string'
      || typeof content !== 'string'
    ) {
      throw new Error(CONTENT_KNOWLEDGE_SOURCE_PARTITION_ERROR);
    }
    sourceIds.add(sourceId);
    cloned.push({
      sourceId,
      sourceType,
      label,
      content,
      ...(updatedAt !== undefined ? { updatedAt } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(verifiedByUser !== undefined ? { verifiedByUser } : {}),
      ...(evidenceTier !== undefined ? { evidenceTier } : {}),
    });
  }
  return cloned;
};

const readTargetSourceIds = (sourceIds: readonly string[]): string[] => {
  if (!Array.isArray(sourceIds)) throw new Error(CONTENT_KNOWLEDGE_SOURCE_PARTITION_ERROR);
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < sourceIds.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(sourceIds, index)) {
      throw new Error(CONTENT_KNOWLEDGE_SOURCE_PARTITION_ERROR);
    }
    const sourceId = sourceIds[index];
    if (typeof sourceId !== 'string' || sourceId.trim().length === 0) {
      throw new Error(CONTENT_KNOWLEDGE_SOURCE_PARTITION_ERROR);
    }
    if (!seen.has(sourceId)) {
      seen.add(sourceId);
      normalized.push(sourceId);
    }
  }
  return normalized;
};

export class ContentKnowledgeVectorStore {
  constructor(
    private readonly db: Database.Database,
    private readonly options: ContentKnowledgeVectorStoreOptions = {},
  ) {
    this.initialize();
  }

  upsertSources(scopeId: string, sources: ContentKnowledgeSource[]): number {
    const normalizedScopeId = scopeId.trim() || 'default';
    const now = Date.now();
    const deleteSource = this.db.prepare(`
      DELETE FROM content_knowledge_chunks
      WHERE scope_id = ? AND source_id = ?
    `);
    const insertChunk = this.db.prepare(`
      INSERT INTO content_knowledge_chunks (
        id,
        scope_id,
        source_type,
        source_id,
        source_label,
        chunk_index,
        content,
        checksum,
        embedding_version,
        embedding_json,
        tokens_json,
        signals_json,
        business_signals_json,
        business_signal_count,
        source_priority,
        verified_by_user,
        evidence_tier,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      let chunkCount = 0;
      for (const source of sources) {
        deleteSource.run(normalizedScopeId, source.sourceId);
        const index = buildContentKnowledgeIndex([source]);
        for (const chunk of index.chunks) {
          insertChunk.run(
            buildStoredChunkId(normalizedScopeId, chunk.id),
            normalizedScopeId,
            chunk.sourceType,
            chunk.sourceId,
            chunk.sourceLabel,
            chunk.chunkIndex,
            chunk.text,
            chunk.checksum,
            chunk.embeddingVersion,
            JSON.stringify(chunk.embedding),
            JSON.stringify(chunk.tokens),
            JSON.stringify(chunk.signals),
            JSON.stringify(chunk.businessSignals),
            chunk.businessSignalCount,
            chunk.sourcePriority ?? 0,
            chunk.verifiedByUser ? 1 : 0,
            chunk.evidenceTier ?? null,
            now,
          );
          chunkCount += 1;
        }
      }
      return chunkCount;
    });

    return transaction() as number;
  }

  replaceSources(
    scopeId: string,
    sources: ContentKnowledgeSource[],
  ): ContentKnowledgeScopeSyncResult {
    const normalizedScopeId = scopeId.trim() || 'default';
    const now = Date.now();
    const deleteScope = this.db.prepare(`
      DELETE FROM content_knowledge_chunks
      WHERE scope_id = ?
    `);
    const insertChunk = this.db.prepare(`
      INSERT INTO content_knowledge_chunks (
        id,
        scope_id,
        source_type,
        source_id,
        source_label,
        chunk_index,
        content,
        checksum,
        embedding_version,
        embedding_json,
        tokens_json,
        signals_json,
        business_signals_json,
        business_signal_count,
        source_priority,
        verified_by_user,
        evidence_tier,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((): ContentKnowledgeScopeSyncResult => {
      deleteScope.run(normalizedScopeId);
      const sourceResults: ContentKnowledgeSourceSyncResult[] = [];
      let totalChunkCount = 0;

      for (const source of sources) {
        const index = buildContentKnowledgeIndex([source]);
        sourceResults.push({
          sourceId: source.sourceId,
          chunkCount: index.chunks.length,
        });
        for (const chunk of index.chunks) {
          insertChunk.run(
            buildStoredChunkId(normalizedScopeId, chunk.id),
            normalizedScopeId,
            chunk.sourceType,
            chunk.sourceId,
            chunk.sourceLabel,
            chunk.chunkIndex,
            chunk.text,
            chunk.checksum,
            chunk.embeddingVersion,
            JSON.stringify(chunk.embedding),
            JSON.stringify(chunk.tokens),
            JSON.stringify(chunk.signals),
            JSON.stringify(chunk.businessSignals),
            chunk.businessSignalCount,
            chunk.sourcePriority ?? 0,
            chunk.verifiedByUser ? 1 : 0,
            chunk.evidenceTier ?? null,
            now,
          );
          totalChunkCount += 1;
        }
      }

      return {
        scopeId: normalizedScopeId,
        sourceResults,
        totalChunkCount,
      };
    });

    return transaction() as ContentKnowledgeScopeSyncResult;
  }

  replaceWorkspaceDocumentSources(
    scopeId: string,
    sources: ContentKnowledgeSource[],
  ): ContentKnowledgeScopeSyncResult {
    const normalizedScopeId = scopeId.trim() || 'default';
    if (!normalizedScopeId.startsWith(ENTERPRISE_WORKSPACE_SCOPE_PREFIX)) {
      return this.replaceSourcePartition(
        normalizedScopeId,
        sources,
        RAW_WORKSPACE_SOURCE_TYPES,
      );
    }
    const workspaceId = normalizedScopeId.slice(ENTERPRISE_WORKSPACE_SCOPE_PREFIX.length);
    if (
      scopeId !== normalizedScopeId
      || !workspaceId
      || workspaceId.trim() !== workspaceId
      || normalizedScopeId !== buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId)
    ) {
      throw new Error(CONTENT_KNOWLEDGE_SOURCE_PARTITION_ERROR);
    }
    return this.replaceSourcePartition(
      normalizedScopeId,
      sources,
      RAW_WORKSPACE_SOURCE_TYPES,
      () => {
        const workspaceExists = this.hasTable('enterprise_lead_workspaces') && Boolean(
          this.db.prepare(`
            SELECT 1 FROM enterprise_lead_workspaces WHERE id = ? LIMIT 1
          `).get(workspaceId),
        );
        this.options.onLeaseStage?.(
          ContentKnowledgeLeaseStage.AfterRawRevalidationBeforeFirstWrite,
        );
        return workspaceExists;
      },
    );
  }

  replaceLegacyWorkspaceDocumentSources(
    scopeId: string,
    sources: ContentKnowledgeSource[],
  ): ContentKnowledgeScopeSyncResult {
    const normalizedScopeId = scopeId.trim() || 'default';
    const workspaceId = normalizedScopeId.slice(ENTERPRISE_WORKSPACE_SCOPE_PREFIX.length);
    if (
      scopeId !== normalizedScopeId
      || !normalizedScopeId.startsWith(ENTERPRISE_WORKSPACE_SCOPE_PREFIX)
      || !workspaceId
      || workspaceId.trim() !== workspaceId
      || normalizedScopeId !== buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId)
    ) {
      throw new Error(CONTENT_KNOWLEDGE_SOURCE_PARTITION_ERROR);
    }
    const clonedSources = clonePartitionSources(
      sources,
      new Set<string>(RAW_WORKSPACE_SOURCE_TYPES),
    );
    if (!this.hasTable('enterprise_lead_workspaces')) {
      return { scopeId: normalizedScopeId, sourceResults: [], totalChunkCount: 0 };
    }
    const hasKnowledgeDocuments = this.hasTable('knowledge_documents');
    const preparedSources: PreparedContentKnowledgeSource[] = clonedSources.map(source => ({
      source,
      chunks: buildContentKnowledgeIndex([source]).chunks,
    }));
    const transaction = this.db.transaction((): ContentKnowledgeScopeSyncResult => {
      const workspaceExists = Boolean(this.db.prepare(`
        SELECT 1 FROM enterprise_lead_workspaces WHERE id = ? LIMIT 1
      `).get(workspaceId));
      const normalizedSourceRows = hasKnowledgeDocuments
        ? this.db.prepare(`
            SELECT id, legacy_source_id
            FROM knowledge_documents
            WHERE workspace_id = ? AND deleted_at IS NULL
          `).all(workspaceId) as Array<{ id: string; legacy_source_id: string | null }>
        : [];
      this.options.onLeaseStage?.(
        ContentKnowledgeLeaseStage.AfterRawRevalidationBeforeFirstWrite,
      );
      if (!workspaceExists) {
        return { scopeId: normalizedScopeId, sourceResults: [], totalChunkCount: 0 };
      }
      const normalizedSourceIds = new Set(normalizedSourceRows.map(row =>
        row.legacy_source_id?.trim()
        || `${KNOWLEDGE_DOCUMENT_LEGACY_SOURCE_PREFIX}${row.id}`));
      const normalizedChunkCounts = new Map<string, number>();
      if (normalizedSourceIds.size > 0) {
        const sourceIds = Array.from(normalizedSourceIds);
        const sourceIdsJson = JSON.stringify(sourceIds);
        const rows = this.db.prepare(`
          SELECT source_id, COUNT(*) AS chunk_count
          FROM content_knowledge_chunks
          WHERE scope_id = ?
            AND source_type = ?
            AND source_id IN (SELECT value FROM json_each(?))
          GROUP BY source_id
        `).all(
          normalizedScopeId,
          ContentKnowledgeSourceType.WorkspaceDocument,
          sourceIdsJson,
        ) as Array<{ source_id: string; chunk_count: number }>;
        rows.forEach(row => normalizedChunkCounts.set(row.source_id, row.chunk_count));
        this.db.prepare(`
          DELETE FROM content_knowledge_chunks
          WHERE scope_id = ?
            AND source_type = ?
            AND source_id NOT IN (SELECT value FROM json_each(?))
        `).run(
          normalizedScopeId,
          ContentKnowledgeSourceType.WorkspaceDocument,
          sourceIdsJson,
        );
      } else {
        this.db.prepare(`
          DELETE FROM content_knowledge_chunks
          WHERE scope_id = ? AND source_type = ?
        `).run(normalizedScopeId, ContentKnowledgeSourceType.WorkspaceDocument);
      }

      const insertChunk = this.prepareChunkInsert();
      const sourceResults: ContentKnowledgeSourceSyncResult[] = [];
      let totalChunkCount = 0;
      const now = Date.now();
      for (const prepared of preparedSources) {
        const sourceId = prepared.source.sourceId;
        const chunkCount = normalizedSourceIds.has(sourceId)
          ? (normalizedChunkCounts.get(sourceId) ?? 0)
          : prepared.chunks.length;
        sourceResults.push({ sourceId, chunkCount });
        totalChunkCount += chunkCount;
        if (normalizedSourceIds.has(sourceId)) continue;
        for (const chunk of prepared.chunks) {
          this.insertChunk(insertChunk, normalizedScopeId, chunk, now);
        }
      }
      return { scopeId: normalizedScopeId, sourceResults, totalChunkCount };
    });
    return runTransientSqliteWriteTransaction(() => transaction());
  }

  replaceWorkspaceDocumentSource(workspaceId: string, documentId: string): boolean {
    const normalizedWorkspaceId = workspaceId.trim();
    const normalizedDocumentId = documentId.trim();
    if (!normalizedWorkspaceId || !normalizedDocumentId) {
      throw new Error(CONTENT_KNOWLEDGE_SOURCE_PARTITION_ERROR);
    }
    const capturedTarget = this.db.prepare(`
      SELECT current_version_id
      FROM knowledge_documents
      WHERE workspace_id = ? AND id = ?
      LIMIT 1
    `).get(normalizedWorkspaceId, normalizedDocumentId) as {
      current_version_id: string;
    } | undefined;
    if (!capturedTarget) return false;
    const expectedVersionId = capturedTarget.current_version_id;
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(normalizedWorkspaceId);
    const transaction = this.db.transaction((): boolean => {
      const target = this.db.prepare(`
        SELECT
          workspace.id AS workspace_id,
          document.id AS document_id,
          document.legacy_source_id,
          document.display_name,
          document.status,
          document.deleted_at,
          document.current_version_id,
          version.extracted_text
        FROM enterprise_lead_workspaces AS workspace
        LEFT JOIN knowledge_documents AS document
          ON document.workspace_id = workspace.id AND document.id = ?
        LEFT JOIN knowledge_document_versions AS version
          ON version.id = document.current_version_id
          AND version.document_id = document.id
        WHERE workspace.id = ?
        LIMIT 1
      `).get(normalizedDocumentId, normalizedWorkspaceId) as WorkspaceDocumentLeaseRow | undefined;
      this.options.onLeaseStage?.(
        ContentKnowledgeLeaseStage.AfterRawRevalidationBeforeFirstWrite,
      );
      if (!target?.document_id || target.current_version_id !== expectedVersionId) return false;

      const sourceId = target.legacy_source_id?.trim()
        || `${KNOWLEDGE_DOCUMENT_LEGACY_SOURCE_PREFIX}${normalizedDocumentId}`;
      this.db.prepare(`
        DELETE FROM content_knowledge_chunks
        WHERE scope_id = ? AND source_type = ? AND source_id = ?
      `).run(scopeId, ContentKnowledgeSourceType.WorkspaceDocument, sourceId);
      if (
        target.deleted_at !== null
        || target.status !== KnowledgeDocumentStatus.Ready
        || !target.extracted_text?.trim()
      ) {
        return false;
      }
      const prepared = buildContentKnowledgeIndex([{
        sourceId,
        sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
        label: target.display_name,
        content: target.extracted_text,
      }]).chunks;
      const insertChunk = this.prepareChunkInsert();
      const now = Date.now();
      for (const chunk of prepared) {
        this.insertChunk(insertChunk, scopeId, chunk, now);
      }
      return true;
    });
    return runTransientSqliteWriteTransaction(() => transaction());
  }

  replaceTrustedSources(
    scopeId: string,
    sources: ContentKnowledgeSource[],
  ): ContentKnowledgeScopeSyncResult {
    const normalizedScopeId = scopeId.trim() || 'default';
    if (!normalizedScopeId.startsWith(ENTERPRISE_WORKSPACE_SCOPE_PREFIX)) {
      return this.replaceSourcePartition(
        normalizedScopeId,
        sources,
        TRUSTED_WORKSPACE_SOURCE_TYPES,
      );
    }
    if (scopeId !== normalizedScopeId) {
      throw new Error(CONTENT_KNOWLEDGE_SOURCE_PARTITION_ERROR);
    }
    const sourceTypeSet = new Set<string>(TRUSTED_WORKSPACE_SOURCE_TYPES);
    const clonedSources = clonePartitionSources(sources, sourceTypeSet);
    if (!this.hasTable('enterprise_lead_workspaces')) {
      return this.replaceSourcePartition(
        normalizedScopeId,
        [],
        TRUSTED_WORKSPACE_SOURCE_TYPES,
      );
    }
    const workspaceId = normalizedScopeId.slice(ENTERPRISE_WORKSPACE_SCOPE_PREFIX.length);
    if (!workspaceId || normalizedScopeId !== buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId)) {
      throw new Error(CONTENT_KNOWLEDGE_SOURCE_PARTITION_ERROR);
    }
    const preparedSources: PreparedContentKnowledgeSource[] = clonedSources.map(source => ({
      source,
      chunks: buildContentKnowledgeIndex([source]).chunks,
    }));
    const transaction = this.db.transaction((): ContentKnowledgeScopeSyncResult => {
      const workspaceExists = Boolean(this.db.prepare(`
        SELECT 1 FROM enterprise_lead_workspaces WHERE id = ? LIMIT 1
      `).get(workspaceId));
      this.options.onLeaseStage?.(
        ContentKnowledgeLeaseStage.AfterTrustedRevalidationBeforeFirstWrite,
      );
      if (!workspaceExists) {
        return { scopeId: normalizedScopeId, sourceResults: [], totalChunkCount: 0 };
      }
      const placeholders = TRUSTED_WORKSPACE_SOURCE_TYPES.map(() => '?').join(', ');
      this.db.prepare(`
        DELETE FROM content_knowledge_chunks
        WHERE scope_id = ? AND source_type IN (${placeholders})
      `).run(normalizedScopeId, ...TRUSTED_WORKSPACE_SOURCE_TYPES);
      const insertChunk = this.prepareChunkInsert();
      const sourceResults: ContentKnowledgeSourceSyncResult[] = [];
      let totalChunkCount = 0;
      const now = Date.now();
      for (const prepared of preparedSources) {
        sourceResults.push({
          sourceId: prepared.source.sourceId,
          chunkCount: prepared.chunks.length,
        });
        for (const chunk of prepared.chunks) {
          this.insertChunk(insertChunk, normalizedScopeId, chunk, now);
          totalChunkCount += 1;
        }
      }
      return { scopeId: normalizedScopeId, sourceResults, totalChunkCount };
    });
    return runTransientSqliteWriteTransaction(() => transaction());
  }

  deleteEnterpriseWorkspaceScopeInCurrentTransaction(workspaceId: string): number {
    if (!this.db.inTransaction) {
      throw new Error(CONTENT_KNOWLEDGE_SOURCE_PARTITION_ERROR);
    }
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId) {
      throw new Error(CONTENT_KNOWLEDGE_SOURCE_PARTITION_ERROR);
    }
    return this.db.prepare(`
      DELETE FROM content_knowledge_chunks WHERE scope_id = ?
    `).run(buildEnterpriseLeadWorkspaceKnowledgeScopeId(normalizedWorkspaceId)).changes;
  }

  deleteWorkspaceDocumentSources(scopeId: string, sourceIds: readonly string[]): number {
    const normalizedScopeId = scopeId.trim() || 'default';
    const normalizedSourceIds = readTargetSourceIds(sourceIds);
    if (normalizedSourceIds.length === 0) return 0;
    return this.runOwnedWrite(() => {
      let deletedCount = 0;
      for (
        let start = 0;
        start < normalizedSourceIds.length;
        start += CONTENT_KNOWLEDGE_DELETE_BATCH_SIZE
      ) {
        const batch = normalizedSourceIds.slice(
          start,
          start + CONTENT_KNOWLEDGE_DELETE_BATCH_SIZE,
        );
        const placeholders = batch.map(() => '?').join(', ');
        deletedCount += this.db.prepare(`
          DELETE FROM content_knowledge_chunks
          WHERE scope_id = ?
            AND source_type = ?
            AND source_id IN (${placeholders})
        `).run(
          normalizedScopeId,
          ContentKnowledgeSourceType.WorkspaceDocument,
          ...batch,
        ).changes;
      }
      return deletedCount;
    });
  }

  deleteScope(scopeId: string): number {
    const normalizedScopeId = scopeId.trim() || 'default';
    const result = this.db
      .prepare('DELETE FROM content_knowledge_chunks WHERE scope_id = ?')
      .run(normalizedScopeId);
    return result.changes;
  }

  search(
    scopeId: string,
    prompt: string,
    options: ContentKnowledgeSearchOptions = {},
  ): ContentKnowledgeRetrievalResult {
    const normalizedScopeId = scopeId.trim() || 'default';
    const gateSchemaAvailable = this.hasTrustedRevisionGateSchema();
    const trustedGate = gateSchemaAvailable
      ? `
        AND (
          chunk.source_type NOT IN (?, ?)
          OR instr(chunk.scope_id, ?) <> 1
          OR EXISTS (
            SELECT 1
            FROM knowledge_trusted_profile_index_state AS state
            JOIN enterprise_lead_workspaces AS workspace
              ON workspace.id = state.workspace_id
            WHERE state.scope_id = chunk.scope_id
              AND state.scope_id = ? || workspace.id
              AND state.indexed_profile_revision = workspace.profile_revision
          )
        )
      `
      : `
        AND (
          chunk.source_type NOT IN (?, ?)
          OR instr(chunk.scope_id, ?) <> 1
        )
      `;
    const rows = this.db
      .prepare(
        `
        SELECT
          id,
          source_id,
          source_type,
          source_label,
          chunk_index,
          content,
          checksum,
          embedding_version,
          embedding_json,
          tokens_json,
          signals_json,
          business_signals_json,
          business_signal_count,
          source_priority,
          verified_by_user,
          evidence_tier
        FROM content_knowledge_chunks AS chunk
        WHERE chunk.scope_id = ?
        ${trustedGate}
        ORDER BY chunk.source_label, chunk.chunk_index
      `,
      )
      .all(
        normalizedScopeId,
        ...this.getTrustedGateParameters(gateSchemaAvailable),
      ) as ContentKnowledgeChunkRow[];

    const chunks = rows.map(mapRowToChunk);
    return searchContentKnowledgeIndex(
      {
        chunks,
        embeddingVersion: chunks[0]?.embeddingVersion ?? CONTENT_KNOWLEDGE_EMBEDDING_VERSION,
        embeddingDimensions: chunks[0]?.embedding.length ?? 96,
      },
      prompt,
      options,
    );
  }

  retrieveFromSources(input: ContentKnowledgeRetrieverInput): ContentKnowledgeRetrievalResult {
    const normalizedScopeId = input.scopeId.trim() || 'default';
    this.upsertSources(normalizedScopeId, input.sources);
    const scopeIds = Array.from(
      new Set([
        normalizedScopeId,
        ...(input.sharedScopeIds ?? []).map(scopeId => scopeId.trim()).filter(Boolean),
      ]),
    );
    const placeholders = scopeIds.map(() => '?').join(', ');
    const gateSchemaAvailable = this.hasTrustedRevisionGateSchema();
    const trustedGate = gateSchemaAvailable
      ? `
        AND (
          chunk.source_type NOT IN (?, ?)
          OR instr(chunk.scope_id, ?) <> 1
          OR EXISTS (
            SELECT 1
            FROM knowledge_trusted_profile_index_state AS state
            JOIN enterprise_lead_workspaces AS workspace
              ON workspace.id = state.workspace_id
            WHERE state.scope_id = chunk.scope_id
              AND state.scope_id = ? || workspace.id
              AND state.indexed_profile_revision = workspace.profile_revision
          )
        )
      `
      : `
        AND (
          chunk.source_type NOT IN (?, ?)
          OR instr(chunk.scope_id, ?) <> 1
        )
      `;
    const rows = this.db
      .prepare(
        `
        SELECT
          id,
          source_id,
          source_type,
          source_label,
          chunk_index,
          content,
          checksum,
          embedding_version,
          embedding_json,
          tokens_json,
          signals_json,
          business_signals_json,
          business_signal_count,
          source_priority,
          verified_by_user,
          evidence_tier
        FROM content_knowledge_chunks AS chunk
        WHERE chunk.scope_id IN (${placeholders})
        ${trustedGate}
        ORDER BY chunk.scope_id, chunk.source_label, chunk.chunk_index
      `,
      )
      .all(
        ...scopeIds,
        ...this.getTrustedGateParameters(gateSchemaAvailable),
      ) as ContentKnowledgeChunkRow[];

    const chunks = rows.map(mapRowToChunk);
    return searchContentKnowledgeIndex(
      {
        chunks,
        embeddingVersion: chunks[0]?.embeddingVersion ?? CONTENT_KNOWLEDGE_EMBEDDING_VERSION,
        embeddingDimensions: chunks[0]?.embedding.length ?? 96,
      },
      input.prompt,
      input.options,
    );
  }

  private replaceSourcePartition(
    scopeId: string,
    sources: ContentKnowledgeSource[],
    allowedSourceTypes: readonly string[],
    leaseAllowsWrite?: () => boolean,
  ): ContentKnowledgeScopeSyncResult {
    const normalizedScopeId = scopeId.trim() || 'default';
    const sourceTypeSet = new Set<string>(allowedSourceTypes);
    const clonedSources = clonePartitionSources(sources, sourceTypeSet);
    const preparedSources: PreparedContentKnowledgeSource[] = clonedSources.map(source => ({
      source,
      chunks: buildContentKnowledgeIndex([source]).chunks,
    }));
    const now = Date.now();
    const operation = (): ContentKnowledgeScopeSyncResult => {
      if (leaseAllowsWrite && !leaseAllowsWrite()) {
        return { scopeId: normalizedScopeId, sourceResults: [], totalChunkCount: 0 };
      }
      const placeholders = allowedSourceTypes.map(() => '?').join(', ');
      this.db.prepare(`
        DELETE FROM content_knowledge_chunks
        WHERE scope_id = ? AND source_type IN (${placeholders})
      `).run(normalizedScopeId, ...allowedSourceTypes);
      const insertChunk = this.prepareChunkInsert();
      const sourceResults: ContentKnowledgeSourceSyncResult[] = [];
      let totalChunkCount = 0;
      for (const prepared of preparedSources) {
        sourceResults.push({
          sourceId: prepared.source.sourceId,
          chunkCount: prepared.chunks.length,
        });
        for (const chunk of prepared.chunks) {
          this.insertChunk(insertChunk, normalizedScopeId, chunk, now);
          totalChunkCount += 1;
        }
      }
      return {
        scopeId: normalizedScopeId,
        sourceResults,
        totalChunkCount,
      };
    };
    if (!leaseAllowsWrite) return this.runOwnedWrite(operation);
    if (this.db.inTransaction) return operation();
    const transaction = this.db.transaction(operation);
    return runTransientSqliteWriteTransaction(() => transaction());
  }

  private runOwnedWrite<T>(operation: () => T): T {
    if (this.db.inTransaction) return operation();
    const transaction = this.db.transaction(operation);
    return runTransientSqliteWriteTransaction(() => transaction.immediate());
  }

  private prepareChunkInsert(): Database.Statement {
    return this.db.prepare(`
      INSERT INTO content_knowledge_chunks (
        id,
        scope_id,
        source_type,
        source_id,
        source_label,
        chunk_index,
        content,
        checksum,
        embedding_version,
        embedding_json,
        tokens_json,
        signals_json,
        business_signals_json,
        business_signal_count,
        source_priority,
        verified_by_user,
        evidence_tier,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  private insertChunk(
    insertChunk: Database.Statement,
    scopeId: string,
    chunk: ContentKnowledgeChunk,
    now: number,
  ): void {
    insertChunk.run(
      buildStoredChunkId(scopeId, chunk.id),
      scopeId,
      chunk.sourceType,
      chunk.sourceId,
      chunk.sourceLabel,
      chunk.chunkIndex,
      chunk.text,
      chunk.checksum,
      chunk.embeddingVersion,
      JSON.stringify(chunk.embedding),
      JSON.stringify(chunk.tokens),
      JSON.stringify(chunk.signals),
      JSON.stringify(chunk.businessSignals),
      chunk.businessSignalCount,
      chunk.sourcePriority ?? 0,
      chunk.verifiedByUser ? 1 : 0,
      chunk.evidenceTier ?? null,
      now,
    );
  }

  private hasTrustedRevisionGateSchema(): boolean {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN (
          'enterprise_lead_workspaces',
          'knowledge_trusted_profile_index_state'
        )
    `).get() as { count: number };
    return row.count === 2;
  }

  private hasTable(tableName: string): boolean {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = ?
      LIMIT 1
    `).get(tableName));
  }

  private getTrustedGateParameters(gateSchemaAvailable: boolean): string[] {
    return [
      ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
      ContentKnowledgeSourceType.WorkspaceRule,
      ENTERPRISE_WORKSPACE_SCOPE_PREFIX,
      ...(gateSchemaAvailable ? [ENTERPRISE_WORKSPACE_SCOPE_PREFIX] : []),
    ];
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS content_knowledge_chunks (
        id TEXT PRIMARY KEY,
        scope_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_label TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        checksum TEXT NOT NULL,
        embedding_version TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        tokens_json TEXT NOT NULL,
        signals_json TEXT NOT NULL,
        business_signals_json TEXT NOT NULL,
        business_signal_count INTEGER NOT NULL,
        source_priority REAL DEFAULT 0,
        verified_by_user INTEGER DEFAULT 0,
        evidence_tier TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_content_knowledge_chunks_scope
      ON content_knowledge_chunks(scope_id);

      CREATE INDEX IF NOT EXISTS idx_content_knowledge_chunks_source
      ON content_knowledge_chunks(scope_id, source_id);
    `);
    this.ensureMetadataColumns();
  }

  private ensureMetadataColumns(): void {
    const columns = new Set(
      (this.db.prepare('PRAGMA table_info(content_knowledge_chunks)').all() as TableInfoRow[]).map(
        column => column.name,
      ),
    );
    if (!columns.has('source_priority')) {
      this.db.exec(
        'ALTER TABLE content_knowledge_chunks ADD COLUMN source_priority REAL DEFAULT 0',
      );
    }
    if (!columns.has('verified_by_user')) {
      this.db.exec(
        'ALTER TABLE content_knowledge_chunks ADD COLUMN verified_by_user INTEGER DEFAULT 0',
      );
    }
    if (!columns.has('evidence_tier')) {
      this.db.exec('ALTER TABLE content_knowledge_chunks ADD COLUMN evidence_tier TEXT');
    }
  }
}
