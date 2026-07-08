import Database from 'better-sqlite3';
import crypto from 'crypto';

import {
  buildContentKnowledgeIndex,
  CONTENT_KNOWLEDGE_EMBEDDING_VERSION,
  type ContentKnowledgeChunk,
  type ContentKnowledgeEvidenceTier,
  type ContentKnowledgeRetrievalResult,
  type ContentKnowledgeRetrieverInput,
  type ContentKnowledgeSearchOptions,
  type ContentKnowledgeSource,
  searchContentKnowledgeIndex,
} from './contentKnowledgeRetrieval';

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

export class ContentKnowledgeVectorStore {
  constructor(private readonly db: Database.Database) {
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
        FROM content_knowledge_chunks
        WHERE scope_id = ?
        ORDER BY source_label, chunk_index
      `,
      )
      .all(normalizedScopeId) as ContentKnowledgeChunkRow[];

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
        FROM content_knowledge_chunks
        WHERE scope_id IN (${placeholders})
        ORDER BY scope_id, source_label, chunk_index
      `,
      )
      .all(...scopeIds) as ContentKnowledgeChunkRow[];

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
