import Database from 'better-sqlite3';

import {
  buildContentKnowledgeIndex,
  CONTENT_KNOWLEDGE_EMBEDDING_VERSION,
  type ContentKnowledgeChunk,
  type ContentKnowledgeRetrievalResult,
  type ContentKnowledgeRetrieverInput,
  type ContentKnowledgeSearchOptions,
  type ContentKnowledgeSource,
  searchContentKnowledgeIndex,
} from './contentKnowledgeRetrieval';

const SHARED_WORKSPACE_KNOWLEDGE_SCOPE_PATTERN = 'enterprise-workspace:%';

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
};

const parseJsonArray = <T>(value: string, fallback: T[]): T[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
};

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
});

export class ContentKnowledgeVectorStore {
  constructor(private readonly db: Database.Database) {
    this.initialize();
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
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_content_knowledge_chunks_scope
      ON content_knowledge_chunks(scope_id);

      CREATE INDEX IF NOT EXISTS idx_content_knowledge_chunks_source
      ON content_knowledge_chunks(scope_id, source_id);
    `);
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
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      let chunkCount = 0;
      for (const source of sources) {
        deleteSource.run(normalizedScopeId, source.sourceId);
        const index = buildContentKnowledgeIndex([source]);
        for (const chunk of index.chunks) {
          insertChunk.run(
            chunk.id,
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
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            chunk.id,
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
          business_signal_count
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
          business_signal_count
        FROM content_knowledge_chunks
        WHERE scope_id = ? OR scope_id LIKE ?
        ORDER BY scope_id, source_label, chunk_index
      `,
      )
      .all(
        normalizedScopeId,
        SHARED_WORKSPACE_KNOWLEDGE_SCOPE_PATTERN,
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
}
