import { createHash, randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';

import {
  KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS,
  KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS,
  KnowledgeBaseErrorCode,
  type KnowledgeDocumentIndexAttemptOutcome,
  KnowledgeDocumentIndexAttemptOutcome as KnowledgeDocumentIndexAttemptOutcomes,
  type KnowledgeDocumentIndexErrorCode,
  KnowledgeDocumentIndexErrorCode as KnowledgeDocumentIndexErrorCodes,
  type KnowledgeDocumentIndexStatus,
  KnowledgeDocumentIndexStatus as KnowledgeDocumentIndexStatuses,
  type KnowledgeDocumentIndexTokenizer,
  KnowledgeDocumentIndexTokenizer as KnowledgeDocumentIndexTokenizers,
  KnowledgeDocumentStatus as KnowledgeDocumentStatuses,
} from '../../shared/knowledgeBase/constants';
import type { KnowledgeDocumentIndexSummary } from '../../shared/knowledgeBase/types';
import { runTransientSqliteWriteTransaction } from '../libs/sqliteTransactionRetry';
import {
  buildKnowledgeChunkId,
  buildKnowledgeFtsMatchQuery,
  buildKnowledgeFtsSearchText,
} from './knowledgeDocumentChunker';
import type {
  KnowledgeDocumentChunk,
  KnowledgeDocumentChunkDraft,
  KnowledgeDocumentChunkSearchHit,
  KnowledgeDocumentIndexAttempt,
  KnowledgeDocumentIndexClaim,
  KnowledgeDocumentIndexState,
} from './knowledgeDocumentIndexTypes';

type TokenizerResolver = (db: Database.Database) => KnowledgeDocumentIndexTokenizer;

type KnowledgeDocumentIndexStateRow = {
  document_version_id: string;
  workspace_id: string;
  document_id: string;
  status: KnowledgeDocumentIndexStatus;
  tokenizer_version: KnowledgeDocumentIndexTokenizer;
  chunk_count: number;
  attempt_count: number;
  active_attempt_id: string | null;
  published_generation_id: string | null;
  error_code: string | null;
  requested_at: string;
  started_at: string | null;
  heartbeat_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

type KnowledgeDocumentIndexAttemptRow = {
  id: string;
  document_version_id: string;
  attempt_number: number;
  tokenizer_version: KnowledgeDocumentIndexTokenizer;
  started_at: string;
  finished_at: string | null;
  outcome: KnowledgeDocumentIndexAttemptOutcome;
  error_code: string | null;
};

type KnowledgeDocumentChunkRow = {
  storage_id: string;
  id: string;
  index_generation_id: string;
  workspace_id: string;
  document_id: string;
  document_version_id: string;
  ordinal: number;
  content: string;
  start_offset: number;
  end_offset: number;
  page_number: number | null;
  sheet_name: string | null;
  slide_number: number | null;
  heading_path_json: string | null;
  checksum: string;
  created_at: string;
};

type KnowledgeDocumentChunkSearchHitRow = {
  chunk_id: string;
  document_id: string;
  document_version_id: string;
  ordinal: number;
  content: string;
  start_offset: number;
  end_offset: number;
  rank: number;
};

type KnowledgeDocumentIndexTargetRow = {
  status: KnowledgeDocumentIndexStatus;
  active_attempt_id: string | null;
  deleted_at: string | null;
  current_version_id: string;
};

type PreparedKnowledgeDocumentChunk = KnowledgeDocumentChunkDraft & {
  storageId: string;
  headingPathJson: string | null;
  searchText: string;
};

const mapStateRow = (row: KnowledgeDocumentIndexStateRow): KnowledgeDocumentIndexState => ({
  documentVersionId: row.document_version_id,
  workspaceId: row.workspace_id,
  documentId: row.document_id,
  status: row.status,
  tokenizerVersion: row.tokenizer_version,
  chunkCount: row.chunk_count,
  attemptCount: row.attempt_count,
  activeAttemptId: row.active_attempt_id,
  publishedGenerationId: row.published_generation_id,
  errorCode: row.error_code,
  requestedAt: row.requested_at,
  startedAt: row.started_at,
  heartbeatAt: row.heartbeat_at,
  completedAt: row.completed_at,
  updatedAt: row.updated_at,
});

const mapAttemptRow = (
  row: KnowledgeDocumentIndexAttemptRow,
): KnowledgeDocumentIndexAttempt => ({
  id: row.id,
  documentVersionId: row.document_version_id,
  attemptNumber: row.attempt_number,
  tokenizerVersion: row.tokenizer_version,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  outcome: row.outcome,
  errorCode: row.error_code,
});

const mapChunkRow = (row: KnowledgeDocumentChunkRow): KnowledgeDocumentChunk => ({
  storageId: row.storage_id,
  id: row.id,
  indexGenerationId: row.index_generation_id,
  workspaceId: row.workspace_id,
  documentId: row.document_id,
  documentVersionId: row.document_version_id,
  ordinal: row.ordinal,
  content: row.content,
  startOffset: row.start_offset,
  endOffset: row.end_offset,
  pageNumber: row.page_number,
  sheetName: row.sheet_name,
  slideNumber: row.slide_number,
  headingPath: row.heading_path_json
    ? JSON.parse(row.heading_path_json) as string[]
    : null,
  checksum: row.checksum,
  createdAt: row.created_at,
});

const mapSearchHitRow = (
  row: KnowledgeDocumentChunkSearchHitRow,
): KnowledgeDocumentChunkSearchHit => ({
  chunkId: row.chunk_id,
  documentId: row.document_id,
  documentVersionId: row.document_version_id,
  ordinal: row.ordinal,
  content: row.content,
  startOffset: row.start_offset,
  endOffset: row.end_offset,
  rank: row.rank,
});

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const normalizeSearchQuery = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

const clampResultLimit = (value: number | undefined, fallback: number): number => {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(100, Math.max(1, Math.trunc(value)));
};

const stableIndexErrorCodes = new Set<string>(
  Object.values(KnowledgeDocumentIndexErrorCodes),
);

const requireStableIndexErrorCode = (
  errorCode: KnowledgeDocumentIndexErrorCode,
): KnowledgeDocumentIndexErrorCode => {
  if (!stableIndexErrorCodes.has(errorCode)) {
    throw new Error('Knowledge document index error code is not stable');
  }
  return errorCode;
};

const isInvalidFtsMatchError = (error: unknown): boolean =>
  error instanceof Error && (
    /fts5:\s*syntax error/i.test(error.message) ||
    /malformed match expression/i.test(error.message) ||
    /unterminated string/i.test(error.message)
  );

const probeTrigram = (db: Database.Database): boolean => {
  const tableName = `temp.knowledge_trigram_probe_${randomUUID().replace(/-/g, '')}`;
  try {
    db.exec(`CREATE VIRTUAL TABLE ${tableName} USING fts5(value, tokenize='trigram')`);
    db.exec(`DROP TABLE ${tableName}`);
    return true;
  } catch {
    try {
      db.exec(`DROP TABLE IF EXISTS ${tableName}`);
    } catch {
      return false;
    }
    return false;
  }
};

export class KnowledgeDocumentIndexStateError extends Error {
  readonly code = KnowledgeBaseErrorCode.JobStateConflict;

  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeDocumentIndexStateError';
  }
}

export class KnowledgeDocumentIndexStore {
  private tokenizer!: KnowledgeDocumentIndexTokenizer;

  constructor(
    private readonly db: Database.Database,
    options: { resolveTokenizer?: TokenizerResolver } = {},
  ) {
    this.initialize(options.resolveTokenizer);
  }

  getTokenizer(): KnowledgeDocumentIndexTokenizer {
    return this.tokenizer;
  }

  getState(documentVersionId: string): KnowledgeDocumentIndexState | null {
    const row = this.db
      .prepare(
        `
        SELECT
          document_version_id,
          workspace_id,
          document_id,
          status,
          tokenizer_version,
          chunk_count,
          attempt_count,
          active_attempt_id,
          published_generation_id,
          error_code,
          requested_at,
          started_at,
          heartbeat_at,
          completed_at,
          updated_at
        FROM knowledge_document_index_state
        WHERE document_version_id = ?
        LIMIT 1
      `,
      )
      .get(documentVersionId.trim()) as KnowledgeDocumentIndexStateRow | undefined;
    return row ? mapStateRow(row) : null;
  }

  listStates(workspaceId: string): KnowledgeDocumentIndexState[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          document_version_id,
          workspace_id,
          document_id,
          status,
          tokenizer_version,
          chunk_count,
          attempt_count,
          active_attempt_id,
          published_generation_id,
          error_code,
          requested_at,
          started_at,
          heartbeat_at,
          completed_at,
          updated_at
        FROM knowledge_document_index_state
        WHERE workspace_id = ?
        ORDER BY requested_at ASC, document_version_id ASC
      `,
      )
      .all(workspaceId.trim()) as KnowledgeDocumentIndexStateRow[];
    return rows.map(mapStateRow);
  }

  getSummary(documentVersionId: string): KnowledgeDocumentIndexSummary | null {
    const state = this.getState(documentVersionId);
    if (!state) {
      return null;
    }
    return {
      documentVersionId: state.documentVersionId,
      status: state.status,
      chunkCount: state.chunkCount,
      attemptCount: state.attemptCount,
      errorCode: state.errorCode,
      updatedAt: state.updatedAt,
      completedAt: state.completedAt,
    };
  }

  listAttempts(documentVersionId: string): KnowledgeDocumentIndexAttempt[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          id,
          document_version_id,
          attempt_number,
          tokenizer_version,
          started_at,
          finished_at,
          outcome,
          error_code
        FROM knowledge_document_index_attempts
        WHERE document_version_id = ?
        ORDER BY attempt_number ASC
      `,
      )
      .all(documentVersionId.trim()) as KnowledgeDocumentIndexAttemptRow[];
    return rows.map(mapAttemptRow);
  }

  scheduleCurrentVersion(
    input: {
      workspaceId: string;
      documentId: string;
      documentVersionId: string;
    },
    now = new Date().toISOString(),
  ): KnowledgeDocumentIndexState {
    const transaction = this.db.transaction(() =>
      this.scheduleCurrentVersionInCurrentTransaction(input, now));
    return transaction();
  }

  scheduleCurrentVersionInCurrentTransaction(
    input: {
      workspaceId: string;
      documentId: string;
      documentVersionId: string;
    },
    now = new Date().toISOString(),
  ): KnowledgeDocumentIndexState {
    this.assertCurrentTransaction();
    const workspaceId = input.workspaceId.trim();
    const documentId = input.documentId.trim();
    const documentVersionId = input.documentVersionId.trim();
      const target = this.db
        .prepare(
          `
          SELECT version.extracted_text
          FROM enterprise_lead_workspaces AS workspace
          JOIN knowledge_documents AS document
            ON document.workspace_id = workspace.id
          JOIN knowledge_document_versions AS version
            ON version.id = document.current_version_id
            AND version.document_id = document.id
          WHERE
            workspace.id = ?
            AND document.id = ?
            AND version.id = ?
            AND document.deleted_at IS NULL
          LIMIT 1
        `,
        )
        .get(workspaceId, documentId, documentVersionId) as {
          extracted_text: string | null;
        } | undefined;
      if (!target) {
        throw new KnowledgeDocumentIndexStateError(
          'Knowledge document index target is not an active current version',
        );
      }

      const hasText = (target.extracted_text ?? '').trim().length > 0;
      const status = hasText
        ? KnowledgeDocumentIndexStatuses.Pending
        : KnowledgeDocumentIndexStatuses.NotApplicable;
      const completedAt = hasText ? null : now;
      this.db
        .prepare(
          `
          INSERT INTO knowledge_document_index_state (
            document_version_id, workspace_id, document_id, status, tokenizer_version,
            chunk_count, attempt_count, active_attempt_id, published_generation_id,
            error_code, requested_at, started_at, heartbeat_at, completed_at, updated_at
          )
          VALUES (
            ?, ?, ?, ?, ?, 0,
            COALESCE((
              SELECT MAX(attempt_number)
              FROM knowledge_document_index_attempts
              WHERE document_version_id = ?
            ), 0),
            NULL, NULL, NULL, ?, NULL, NULL, ?, ?
          )
          ON CONFLICT(document_version_id) DO UPDATE SET
            workspace_id = excluded.workspace_id,
            document_id = excluded.document_id,
            status = excluded.status,
            tokenizer_version = excluded.tokenizer_version,
            chunk_count = 0,
            active_attempt_id = NULL,
            published_generation_id = NULL,
            error_code = NULL,
            requested_at = excluded.requested_at,
            started_at = NULL,
            heartbeat_at = NULL,
            completed_at = excluded.completed_at,
            updated_at = excluded.updated_at
        `,
        )
        .run(
          documentVersionId,
          workspaceId,
          documentId,
          status,
          this.tokenizer,
          documentVersionId,
          now,
          completedAt,
          now,
        );
    return this.requireState(documentVersionId);
  }

  claimNext(now = new Date().toISOString()): KnowledgeDocumentIndexClaim | null {
    const transaction = this.db.transaction(() => {
      const pending = this.db
        .prepare(
          `
          SELECT state.document_version_id
          FROM knowledge_document_index_state AS state
          JOIN enterprise_lead_workspaces AS workspace
            ON workspace.id = state.workspace_id
          JOIN knowledge_documents AS document
            ON document.id = state.document_id
            AND document.workspace_id = state.workspace_id
            AND document.current_version_id = state.document_version_id
            AND document.deleted_at IS NULL
          JOIN knowledge_document_versions AS version
            ON version.id = state.document_version_id
            AND version.document_id = state.document_id
          WHERE state.status = ? AND TRIM(COALESCE(version.extracted_text, '')) <> ''
          ORDER BY state.requested_at ASC, state.document_version_id ASC
          LIMIT 1
        `,
        )
        .get(KnowledgeDocumentIndexStatuses.Pending) as {
          document_version_id: string;
        } | undefined;
      if (!pending) {
        return null;
      }

      const attemptId = randomUUID();
      const updated = this.db
        .prepare(
          `
          UPDATE knowledge_document_index_state
          SET
            status = ?,
            attempt_count = attempt_count + 1,
            active_attempt_id = ?,
            error_code = NULL,
            started_at = ?,
            heartbeat_at = ?,
            completed_at = NULL,
            updated_at = ?
          WHERE document_version_id = ? AND status = ?
        `,
        )
        .run(
          KnowledgeDocumentIndexStatuses.Indexing,
          attemptId,
          now,
          now,
          now,
          pending.document_version_id,
          KnowledgeDocumentIndexStatuses.Pending,
        );
      if (updated.changes === 0) {
        return null;
      }

      const state = this.requireState(pending.document_version_id);
      this.db
        .prepare(
          `
          INSERT INTO knowledge_document_index_attempts (
            id,
            document_version_id,
            attempt_number,
            tokenizer_version,
            started_at,
            finished_at,
            outcome,
            error_code
          )
          VALUES (?, ?, ?, ?, ?, NULL, ?, NULL)
        `,
        )
        .run(
          attemptId,
          state.documentVersionId,
          state.attemptCount,
          this.tokenizer,
          now,
          KnowledgeDocumentIndexAttemptOutcomes.Running,
        );
      const extracted = this.db
        .prepare(
          `
          SELECT version.extracted_text
          FROM knowledge_document_index_state AS state
          JOIN enterprise_lead_workspaces AS workspace
            ON workspace.id = state.workspace_id
          JOIN knowledge_documents AS document
            ON document.id = state.document_id
            AND document.workspace_id = state.workspace_id
            AND document.current_version_id = state.document_version_id
            AND document.deleted_at IS NULL
          JOIN knowledge_document_versions AS version
            ON version.id = state.document_version_id
            AND version.document_id = state.document_id
          WHERE state.document_version_id = ?
          LIMIT 1
        `,
        )
        .get(state.documentVersionId) as { extracted_text: string | null } | undefined;
      if (!extracted || extracted.extracted_text === null) {
        throw new KnowledgeDocumentIndexStateError(
          'Claimed knowledge document index text is unavailable',
        );
      }

      return {
        state,
        attempt: this.requireAttempt(attemptId),
        extractedText: extracted.extracted_text,
      };
    });
    return runTransientSqliteWriteTransaction(transaction);
  }

  heartbeat(
    input: {
      documentVersionId: string;
      attemptId: string;
    },
    now = new Date().toISOString(),
  ): boolean {
    const transaction = this.db.transaction(() => this.db
      .prepare(
        `
        UPDATE knowledge_document_index_state
        SET heartbeat_at = ?, updated_at = ?
        WHERE
          document_version_id = ?
          AND status = ?
          AND active_attempt_id = ?
          AND EXISTS (
            SELECT 1
            FROM knowledge_document_index_attempts AS attempt
            WHERE
              attempt.id = ?
              AND attempt.document_version_id = knowledge_document_index_state.document_version_id
              AND attempt.outcome = ?
          )
      `,
      )
      .run(
        now,
        now,
        input.documentVersionId.trim(),
        KnowledgeDocumentIndexStatuses.Indexing,
        input.attemptId.trim(),
        input.attemptId.trim(),
        KnowledgeDocumentIndexAttemptOutcomes.Running,
      ).changes > 0);
    return transaction();
  }

  recoverAbandonedIndexing(
    staleBefore: string,
    now = new Date().toISOString(),
  ): number {
    const transaction = this.db.transaction(() => {
      const staleStates = this.db
        .prepare(
          `
          SELECT
            state.document_version_id,
            state.active_attempt_id
          FROM knowledge_document_index_state AS state
          JOIN knowledge_document_index_attempts AS attempt
            ON attempt.id = state.active_attempt_id
            AND attempt.document_version_id = state.document_version_id
            AND attempt.outcome = ?
          WHERE
            state.status = ?
            AND (state.heartbeat_at IS NULL OR state.heartbeat_at < ?)
          ORDER BY state.document_version_id ASC
        `,
        )
        .all(
          KnowledgeDocumentIndexAttemptOutcomes.Running,
          KnowledgeDocumentIndexStatuses.Indexing,
          staleBefore,
        ) as Array<{
          document_version_id: string;
          active_attempt_id: string;
        }>;
      const requeueState = this.db.prepare(`
        UPDATE knowledge_document_index_state
        SET
          status = ?,
          active_attempt_id = NULL,
          error_code = NULL,
          started_at = NULL,
          heartbeat_at = NULL,
          completed_at = NULL,
          updated_at = ?
        WHERE
          document_version_id = ?
          AND status = ?
          AND active_attempt_id = ?
          AND (heartbeat_at IS NULL OR heartbeat_at < ?)
      `);
      const abandonAttempt = this.db.prepare(`
        UPDATE knowledge_document_index_attempts
        SET outcome = ?, finished_at = ?
        WHERE
          id = ?
          AND document_version_id = ?
          AND outcome = ?
      `);
      let recoveredCount = 0;
      staleStates.forEach(state => {
        const requeued = requeueState.run(
          KnowledgeDocumentIndexStatuses.Pending,
          now,
          state.document_version_id,
          KnowledgeDocumentIndexStatuses.Indexing,
          state.active_attempt_id,
          staleBefore,
        );
        if (requeued.changes === 0) {
          return;
        }
        const abandoned = abandonAttempt.run(
          KnowledgeDocumentIndexAttemptOutcomes.Abandoned,
          now,
          state.active_attempt_id,
          state.document_version_id,
          KnowledgeDocumentIndexAttemptOutcomes.Running,
        );
        if (abandoned.changes === 0) {
          throw new KnowledgeDocumentIndexStateError(
            'Knowledge document index attempt lease changed during recovery',
          );
        }
        recoveredCount += 1;
      });
      return recoveredCount;
    });
    return runTransientSqliteWriteTransaction(transaction);
  }

  reconcileMissingStates(now = new Date().toISOString()): {
    pendingCount: number;
    notApplicableCount: number;
  } {
    const transaction = this.db.transaction(() => {
      const missing = this.db
        .prepare(
          `
          SELECT
            document.workspace_id,
            document.id AS document_id,
            version.id AS document_version_id
          FROM enterprise_lead_workspaces AS workspace
          JOIN knowledge_documents AS document
            ON document.workspace_id = workspace.id
            AND document.deleted_at IS NULL
          JOIN knowledge_document_versions AS version
            ON version.id = document.current_version_id
            AND version.document_id = document.id
          LEFT JOIN knowledge_document_index_state AS state
            ON state.document_version_id = version.id
          WHERE
            document.status IN (?, ?)
            AND state.document_version_id IS NULL
          ORDER BY document.workspace_id ASC, document.id ASC
        `,
        )
        .all(
          KnowledgeDocumentStatuses.Ready,
          KnowledgeDocumentStatuses.CompletedWithoutText,
        ) as Array<{
          workspace_id: string;
          document_id: string;
          document_version_id: string;
        }>;
      let pendingCount = 0;
      let notApplicableCount = 0;
      missing.forEach(target => {
        const state = this.scheduleCurrentVersion({
          workspaceId: target.workspace_id,
          documentId: target.document_id,
          documentVersionId: target.document_version_id,
        }, now);
        if (state.status === KnowledgeDocumentIndexStatuses.Pending) {
          pendingCount += 1;
        } else if (state.status === KnowledgeDocumentIndexStatuses.NotApplicable) {
          notApplicableCount += 1;
        }
      });
      return { pendingCount, notApplicableCount };
    });
    return transaction();
  }

  stageVersionBatch(
    input: {
      workspaceId: string;
      documentId: string;
      documentVersionId: string;
      attemptId: string;
      chunks: KnowledgeDocumentChunkDraft[];
    },
    now = new Date().toISOString(),
  ): number {
    if (input.chunks.length === 0) {
      throw new Error('Knowledge document index batch must contain at least one chunk');
    }
    if (input.chunks.length > KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS) {
      throw new Error(
        `Knowledge document index batch may contain at most ${KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS} chunks`,
      );
    }

    const workspaceId = input.workspaceId.trim();
    const documentId = input.documentId.trim();
    const documentVersionId = input.documentVersionId.trim();
    const attemptId = input.attemptId.trim();
    const chunks = input.chunks.map<PreparedKnowledgeDocumentChunk>(chunk => {
      if (
        !Number.isInteger(chunk.ordinal) ||
        !Number.isInteger(chunk.startOffset) ||
        !Number.isInteger(chunk.endOffset) ||
        chunk.ordinal < 0 ||
        chunk.startOffset < 0 ||
        chunk.endOffset < 0
      ) {
        throw new Error(
          'Knowledge document chunk ordinal and offsets must be non-negative integers',
        );
      }
      if (chunk.endOffset < chunk.startOffset) {
        throw new Error('Knowledge document chunk end offset precedes its start offset');
      }
      if (chunk.endOffset - chunk.startOffset !== chunk.content.length) {
        throw new Error('Knowledge document chunk offsets do not match its content length');
      }
      const checksum = sha256(chunk.content);
      if (checksum !== chunk.checksum) {
        throw new Error('Knowledge document chunk checksum does not match its content');
      }
      const logicalChunkId = buildKnowledgeChunkId({
        documentVersionId,
        ordinal: chunk.ordinal,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        checksum,
      });
      if (logicalChunkId !== chunk.id) {
        throw new Error('Knowledge document logical chunk id does not match its content');
      }
      return {
        ...chunk,
        storageId: sha256(`${attemptId}\0${chunk.id}`),
        headingPathJson: chunk.headingPath === null
          ? null
          : JSON.stringify(chunk.headingPath),
        searchText: buildKnowledgeFtsSearchText(chunk.content, this.tokenizer),
      };
    });
    const insertChunk = this.db.prepare(`
      INSERT INTO knowledge_document_chunks (
        storage_id, id, index_generation_id, workspace_id, document_id,
        document_version_id, ordinal, content, start_offset, end_offset,
        page_number, sheet_name, slide_number, heading_path_json, checksum, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = this.db.prepare(`
      INSERT INTO knowledge_document_chunks_fts (
        storage_id, chunk_id, index_generation_id, workspace_id,
        document_id, document_version_id, search_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const transaction = this.db.transaction(() => {
      this.requireActiveIndexTarget({
        workspaceId,
        documentId,
        documentVersionId,
        attemptId,
      });
      chunks.forEach(chunk => {
        insertChunk.run(
          chunk.storageId,
          chunk.id,
          attemptId,
          workspaceId,
          documentId,
          documentVersionId,
          chunk.ordinal,
          chunk.content,
          chunk.startOffset,
          chunk.endOffset,
          chunk.pageNumber,
          chunk.sheetName,
          chunk.slideNumber,
          chunk.headingPathJson,
          chunk.checksum,
          now,
        );
        insertFts.run(
          chunk.storageId,
          chunk.id,
          attemptId,
          workspaceId,
          documentId,
          documentVersionId,
          chunk.searchText,
        );
      });
      return chunks.length;
    });
    return runTransientSqliteWriteTransaction(transaction);
  }

  publishVersion(
    input: {
      workspaceId: string;
      documentId: string;
      documentVersionId: string;
      attemptId: string;
      chunkCount: number;
    },
    now = new Date().toISOString(),
  ): KnowledgeDocumentIndexState {
    if (!Number.isInteger(input.chunkCount) || input.chunkCount < 1) {
      throw new KnowledgeDocumentIndexStateError(
        'Knowledge document index publication requires a positive chunk count',
      );
    }
    const workspaceId = input.workspaceId.trim();
    const documentId = input.documentId.trim();
    const documentVersionId = input.documentVersionId.trim();
    const attemptId = input.attemptId.trim();
    const transaction = this.db.transaction(() => {
      this.requireActiveIndexTarget({
        workspaceId,
        documentId,
        documentVersionId,
        attemptId,
      });
      const staged = this.db.prepare(`
        SELECT
          COUNT(*) AS chunk_count,
          COUNT(DISTINCT id) AS distinct_chunk_count,
          MIN(ordinal) AS min_ordinal,
          MAX(ordinal) AS max_ordinal
        FROM knowledge_document_chunks
        WHERE
          workspace_id = ?
          AND document_id = ?
          AND document_version_id = ?
          AND index_generation_id = ?
      `).get(
        workspaceId,
        documentId,
        documentVersionId,
        attemptId,
      ) as {
        chunk_count: number;
        distinct_chunk_count: number;
        min_ordinal: number | null;
        max_ordinal: number | null;
      };
      if (
        staged.chunk_count !== input.chunkCount ||
        staged.distinct_chunk_count !== input.chunkCount ||
        staged.min_ordinal !== 0 ||
        staged.max_ordinal !== input.chunkCount - 1
      ) {
        throw new KnowledgeDocumentIndexStateError(
          'Knowledge document index staged generation is incomplete',
        );
      }

      const completedAttempt = this.db.prepare(`
        UPDATE knowledge_document_index_attempts
        SET outcome = ?, finished_at = ?, error_code = NULL
        WHERE id = ? AND document_version_id = ? AND outcome = ?
      `).run(
        KnowledgeDocumentIndexAttemptOutcomes.Indexed,
        now,
        attemptId,
        documentVersionId,
        KnowledgeDocumentIndexAttemptOutcomes.Running,
      );
      if (completedAttempt.changes === 0) {
        throw new KnowledgeDocumentIndexStateError(
          'Knowledge document index attempt lease changed before publication',
        );
      }
      const activatedState = this.db.prepare(`
        UPDATE knowledge_document_index_state
        SET
          status = ?,
          chunk_count = ?,
          active_attempt_id = NULL,
          published_generation_id = ?,
          error_code = NULL,
          heartbeat_at = NULL,
          completed_at = ?,
          updated_at = ?
        WHERE
          document_version_id = ?
          AND status = ?
          AND active_attempt_id = ?
      `).run(
        KnowledgeDocumentIndexStatuses.Indexed,
        input.chunkCount,
        attemptId,
        now,
        now,
        documentVersionId,
        KnowledgeDocumentIndexStatuses.Indexing,
        attemptId,
      );
      if (activatedState.changes === 0) {
        throw new KnowledgeDocumentIndexStateError(
          'Knowledge document index state lease changed during publication',
        );
      }
      return this.requireState(documentVersionId);
    });
    return runTransientSqliteWriteTransaction(transaction);
  }

  failAttempt(
    input: {
      documentVersionId: string;
      attemptId: string;
      errorCode: KnowledgeDocumentIndexErrorCode;
    },
    now = new Date().toISOString(),
  ): KnowledgeDocumentIndexState {
    const errorCode = requireStableIndexErrorCode(input.errorCode);
    const documentVersionId = input.documentVersionId.trim();
    const attemptId = input.attemptId.trim();
    const transaction = this.db.transaction(() => {
      const failedAttempt = this.db.prepare(`
        UPDATE knowledge_document_index_attempts
        SET outcome = ?, finished_at = ?, error_code = ?
        WHERE id = ? AND document_version_id = ? AND outcome = ?
      `).run(
        KnowledgeDocumentIndexAttemptOutcomes.Failed,
        now,
        errorCode,
        attemptId,
        documentVersionId,
        KnowledgeDocumentIndexAttemptOutcomes.Running,
      );
      if (failedAttempt.changes === 0) {
        throw new KnowledgeDocumentIndexStateError(
          'Knowledge document index attempt is not the active running attempt',
        );
      }
      const failedState = this.db.prepare(`
        UPDATE knowledge_document_index_state
        SET
          status = ?,
          chunk_count = 0,
          active_attempt_id = NULL,
          published_generation_id = NULL,
          error_code = ?,
          heartbeat_at = NULL,
          completed_at = ?,
          updated_at = ?
        WHERE document_version_id = ? AND status = ? AND active_attempt_id = ?
      `).run(
        KnowledgeDocumentIndexStatuses.Failed,
        errorCode,
        now,
        now,
        documentVersionId,
        KnowledgeDocumentIndexStatuses.Indexing,
        attemptId,
      );
      if (failedState.changes === 0) {
        throw new KnowledgeDocumentIndexStateError(
          'Knowledge document index state lease changed while recording failure',
        );
      }
      return this.requireState(documentVersionId);
    });
    return transaction();
  }

  failRunnableStates(
    errorCode: KnowledgeDocumentIndexErrorCode,
    now = new Date().toISOString(),
  ): number {
    const stableErrorCode = requireStableIndexErrorCode(errorCode);
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE knowledge_document_index_attempts
        SET outcome = ?, finished_at = ?, error_code = ?
        WHERE outcome = ?
      `).run(
        KnowledgeDocumentIndexAttemptOutcomes.Failed,
        now,
        stableErrorCode,
        KnowledgeDocumentIndexAttemptOutcomes.Running,
      );
      return this.db.prepare(`
        UPDATE knowledge_document_index_state
        SET
          status = ?,
          chunk_count = 0,
          active_attempt_id = NULL,
          published_generation_id = NULL,
          error_code = ?,
          heartbeat_at = NULL,
          completed_at = ?,
          updated_at = ?
        WHERE status IN (?, ?)
      `).run(
        KnowledgeDocumentIndexStatuses.Failed,
        stableErrorCode,
        now,
        now,
        KnowledgeDocumentIndexStatuses.Pending,
        KnowledgeDocumentIndexStatuses.Indexing,
      ).changes;
    });
    return transaction();
  }

  retryFailedVersion(
    input: {
      documentId: string;
      documentVersionId: string;
    },
    now = new Date().toISOString(),
  ): KnowledgeDocumentIndexState {
    const documentId = input.documentId.trim();
    const documentVersionId = input.documentVersionId.trim();
    const transaction = this.db.transaction(() => {
      const retried = this.db.prepare(`
        UPDATE knowledge_document_index_state AS state
        SET
          status = ?,
          chunk_count = 0,
          active_attempt_id = NULL,
          published_generation_id = NULL,
          error_code = NULL,
          requested_at = ?,
          started_at = NULL,
          heartbeat_at = NULL,
          completed_at = NULL,
          updated_at = ?
        WHERE
          state.document_id = ?
          AND state.document_version_id = ?
          AND state.status = ?
          AND EXISTS (
            SELECT 1
            FROM enterprise_lead_workspaces AS workspace
            JOIN knowledge_documents AS document
              ON document.workspace_id = workspace.id
            WHERE
              workspace.id = state.workspace_id
              AND document.id = state.document_id
              AND document.current_version_id = state.document_version_id
              AND document.deleted_at IS NULL
          )
      `).run(
        KnowledgeDocumentIndexStatuses.Pending,
        now,
        now,
        documentId,
        documentVersionId,
        KnowledgeDocumentIndexStatuses.Failed,
      );
      if (retried.changes === 0) {
        throw new KnowledgeDocumentIndexStateError(
          'Knowledge document index retry target is not a failed active current version',
        );
      }
      return this.requireState(documentVersionId);
    });
    return transaction();
  }

  deactivateVersion(
    input: {
      workspaceId: string;
      documentId: string;
      documentVersionId: string;
    },
    now = new Date().toISOString(),
  ): void {
    const workspaceId = input.workspaceId.trim();
    const documentId = input.documentId.trim();
    const documentVersionId = input.documentVersionId.trim();
    const transaction = this.db.transaction(() =>
      this.deactivateVersionInCurrentTransaction({
        workspaceId,
        documentId,
        documentVersionId,
      }, now));
    transaction();
  }

  deactivateVersionInCurrentTransaction(
    input: {
      workspaceId: string;
      documentId: string;
      documentVersionId: string;
    },
    _now = new Date().toISOString(),
  ): void {
    this.assertCurrentTransaction();
    const workspaceId = input.workspaceId.trim();
    const documentId = input.documentId.trim();
    const documentVersionId = input.documentVersionId.trim();
    const target = this.db.prepare(`
      SELECT 1
      FROM knowledge_document_index_state
      WHERE workspace_id = ? AND document_id = ? AND document_version_id = ?
      LIMIT 1
    `).get(workspaceId, documentId, documentVersionId);
    if (!target) {
      throw new KnowledgeDocumentIndexStateError(
        'Knowledge document index deactivation target does not match its state',
      );
    }
    this.db.prepare(`
      DELETE FROM knowledge_document_chunks_fts WHERE document_version_id = ?
    `).run(documentVersionId);
    this.db.prepare(`
      DELETE FROM knowledge_document_chunks WHERE document_version_id = ?
    `).run(documentVersionId);
    this.db.prepare(`
      DELETE FROM knowledge_document_index_attempts WHERE document_version_id = ?
    `).run(documentVersionId);
    const deleted = this.db.prepare(`
      DELETE FROM knowledge_document_index_state WHERE document_version_id = ?
    `).run(documentVersionId);
    if (deleted.changes === 0) {
      throw new KnowledgeDocumentIndexStateError(
        'Knowledge document index state changed during deactivation',
      );
    }
  }

  listVersionChunks(
    documentVersionId: string,
    options: {
      afterOrdinal?: number;
      limit?: number;
    } = {},
  ): KnowledgeDocumentChunk[] {
    const afterOrdinal = options.afterOrdinal === undefined ||
      !Number.isFinite(options.afterOrdinal)
      ? -1
      : Math.trunc(options.afterOrdinal);
    const limit = clampResultLimit(options.limit, 100);
    const rows = this.db.prepare(`
      SELECT
        chunk.storage_id,
        chunk.id,
        chunk.index_generation_id,
        chunk.workspace_id,
        chunk.document_id,
        chunk.document_version_id,
        chunk.ordinal,
        chunk.content,
        chunk.start_offset,
        chunk.end_offset,
        chunk.page_number,
        chunk.sheet_name,
        chunk.slide_number,
        chunk.heading_path_json,
        chunk.checksum,
        chunk.created_at
      FROM knowledge_document_chunks AS chunk
      JOIN knowledge_document_index_state AS state
        ON state.document_version_id = chunk.document_version_id
        AND state.status = ?
        AND state.published_generation_id = chunk.index_generation_id
      WHERE chunk.document_version_id = ? AND chunk.ordinal > ?
      ORDER BY chunk.ordinal ASC
      LIMIT ?
    `).all(
      KnowledgeDocumentIndexStatuses.Indexed,
      documentVersionId.trim(),
      afterOrdinal,
      limit,
    ) as KnowledgeDocumentChunkRow[];
    return rows.map(mapChunkRow);
  }

  searchWorkspace(input: {
    workspaceId: string;
    query: string;
    limit?: number;
  }): KnowledgeDocumentChunkSearchHit[] {
    const query = normalizeSearchQuery(input.query);
    if (!query) {
      return [];
    }
    const workspaceId = input.workspaceId.trim();
    const limit = clampResultLimit(input.limit, 20);
    const minimumFtsCodePoints = this.tokenizer === KnowledgeDocumentIndexTokenizers.TrigramV1
      ? 3
      : 2;
    if (Array.from(query).length < minimumFtsCodePoints) {
      const rows = this.db.prepare(`
        SELECT
          chunk.id AS chunk_id,
          chunk.document_id,
          chunk.document_version_id,
          chunk.ordinal,
          chunk.content,
          chunk.start_offset,
          chunk.end_offset,
          0 AS rank
        FROM knowledge_document_chunks AS chunk
        JOIN knowledge_document_index_state AS state
          ON state.document_version_id = chunk.document_version_id
          AND state.status = ?
          AND state.published_generation_id = chunk.index_generation_id
        JOIN knowledge_documents AS document
          ON document.id = chunk.document_id
          AND document.current_version_id = chunk.document_version_id
          AND document.deleted_at IS NULL
        WHERE chunk.workspace_id = ? AND instr(lower(chunk.content), lower(?)) > 0
        ORDER BY chunk.document_id ASC, chunk.ordinal ASC
        LIMIT ?
      `).all(
        KnowledgeDocumentIndexStatuses.Indexed,
        workspaceId,
        query,
        limit,
      ) as KnowledgeDocumentChunkSearchHitRow[];
      return rows.map(mapSearchHitRow);
    }

    const matchQuery = buildKnowledgeFtsMatchQuery(query, this.tokenizer);
    if (!matchQuery) {
      return [];
    }
    try {
      const rows = this.db.prepare(`
        SELECT
          chunk.id AS chunk_id,
          chunk.document_id,
          chunk.document_version_id,
          chunk.ordinal,
          chunk.content,
          chunk.start_offset,
          chunk.end_offset,
          bm25(knowledge_document_chunks_fts) AS rank
        FROM knowledge_document_chunks_fts
        JOIN knowledge_document_chunks AS chunk
          ON chunk.storage_id = knowledge_document_chunks_fts.storage_id
        JOIN knowledge_document_index_state AS state
          ON state.document_version_id = chunk.document_version_id
          AND state.status = ?
          AND state.published_generation_id = chunk.index_generation_id
        JOIN knowledge_documents AS document
          ON document.id = chunk.document_id
          AND document.current_version_id = chunk.document_version_id
          AND document.deleted_at IS NULL
        WHERE
          knowledge_document_chunks_fts.workspace_id = ?
          AND knowledge_document_chunks_fts MATCH ?
        ORDER BY rank ASC, chunk.document_id ASC, chunk.ordinal ASC
        LIMIT ?
      `).all(
        KnowledgeDocumentIndexStatuses.Indexed,
        workspaceId,
        matchQuery,
        limit,
      ) as KnowledgeDocumentChunkSearchHitRow[];
      return rows.map(mapSearchHitRow);
    } catch (error) {
      if (isInvalidFtsMatchError(error)) {
        return [];
      }
      throw error;
    }
  }

  purgeInactiveGenerationBatch(limit = KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS): number {
    const batchLimit = Math.min(
      KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS,
      Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS),
    );
    const transaction = this.db.transaction(() => {
      const rows = this.db.prepare(`
        SELECT chunk.storage_id
        FROM knowledge_document_chunks AS chunk
        WHERE NOT EXISTS (
          SELECT 1
          FROM knowledge_document_index_state AS state
          WHERE
            state.document_version_id = chunk.document_version_id
            AND (
              state.active_attempt_id = chunk.index_generation_id
              OR state.published_generation_id = chunk.index_generation_id
            )
        )
        ORDER BY chunk.storage_id ASC
        LIMIT ?
      `).all(batchLimit) as Array<{ storage_id: string }>;
      if (rows.length === 0) {
        return 0;
      }
      const storageIds = rows.map(row => row.storage_id);
      const placeholders = storageIds.map(() => '?').join(', ');
      this.db.prepare(`
        DELETE FROM knowledge_document_chunks_fts
        WHERE storage_id IN (${placeholders})
      `).run(...storageIds);
      return this.db.prepare(`
        DELETE FROM knowledge_document_chunks
        WHERE storage_id IN (${placeholders})
      `).run(...storageIds).changes;
    });
    return runTransientSqliteWriteTransaction(transaction);
  }

  deleteWorkspaceIndex(workspaceId: string): void {
    const normalizedWorkspaceId = workspaceId.trim();
    const transaction = this.db.transaction(() =>
      this.deleteWorkspaceIndexInCurrentTransaction(normalizedWorkspaceId));
    transaction();
  }

  deleteWorkspaceIndexInCurrentTransaction(workspaceId: string): number {
    this.assertCurrentTransaction();
    const normalizedWorkspaceId = workspaceId.trim();
    let deletedCount = 0;
    deletedCount += this.db.prepare(`
      DELETE FROM knowledge_document_index_attempts
      WHERE EXISTS (
        SELECT 1 FROM knowledge_document_index_state AS state
        WHERE state.document_version_id = knowledge_document_index_attempts.document_version_id
          AND state.workspace_id = ?
      ) OR EXISTS (
        SELECT 1
        FROM knowledge_document_versions AS version
        JOIN knowledge_documents AS document ON document.id = version.document_id
        WHERE version.id = knowledge_document_index_attempts.document_version_id
          AND document.workspace_id = ?
      )
    `).run(normalizedWorkspaceId, normalizedWorkspaceId).changes;
    deletedCount += this.db.prepare(`
      DELETE FROM knowledge_document_index_state WHERE workspace_id = ?
    `).run(normalizedWorkspaceId).changes;
    deletedCount += this.db.prepare(`
      DELETE FROM knowledge_document_chunks_fts WHERE workspace_id = ?
    `).run(normalizedWorkspaceId).changes;
    deletedCount += this.db.prepare(`
      DELETE FROM knowledge_document_chunks WHERE workspace_id = ?
    `).run(normalizedWorkspaceId).changes;
    return deletedCount;
  }

  deleteParentlessIndexInCurrentTransaction(): number {
    this.assertCurrentTransaction();
    let deletedCount = 0;
    deletedCount += this.db.prepare(`
      DELETE FROM knowledge_document_chunks_fts
      WHERE NOT EXISTS (
        SELECT 1
        FROM knowledge_document_chunks AS chunk
        JOIN knowledge_document_index_state AS state
          ON state.document_version_id = chunk.document_version_id
        JOIN knowledge_document_versions AS version
          ON version.id = state.document_version_id
        WHERE chunk.storage_id = knowledge_document_chunks_fts.storage_id
      )
    `).run().changes;
    deletedCount += this.db.prepare(`
      DELETE FROM knowledge_document_index_attempts
      WHERE NOT EXISTS (
        SELECT 1
        FROM knowledge_document_index_state AS state
        JOIN knowledge_document_versions AS version
          ON version.id = state.document_version_id
        WHERE state.document_version_id = knowledge_document_index_attempts.document_version_id
      )
    `).run().changes;
    deletedCount += this.db.prepare(`
      DELETE FROM knowledge_document_chunks
      WHERE NOT EXISTS (
        SELECT 1
        FROM knowledge_document_index_state AS state
        JOIN knowledge_document_versions AS version
          ON version.id = state.document_version_id
        WHERE state.document_version_id = knowledge_document_chunks.document_version_id
      )
    `).run().changes;
    deletedCount += this.db.prepare(`
      DELETE FROM knowledge_document_index_state
      WHERE NOT EXISTS (
        SELECT 1 FROM knowledge_document_versions AS version
        WHERE version.id = knowledge_document_index_state.document_version_id
      )
    `).run().changes;
    return deletedCount;
  }

  private assertCurrentTransaction(): void {
    if (!this.db.inTransaction) {
      throw new KnowledgeDocumentIndexStateError(
        'Knowledge document index transaction required',
      );
    }
  }

  private requireActiveIndexTarget(input: {
    workspaceId: string;
    documentId: string;
    documentVersionId: string;
    attemptId: string;
  }): void {
    const target = this.db.prepare(`
      SELECT
        state.status,
        state.active_attempt_id,
        document.deleted_at,
        document.current_version_id
      FROM knowledge_document_index_state AS state
      JOIN enterprise_lead_workspaces AS workspace
        ON workspace.id = state.workspace_id
      JOIN knowledge_documents AS document
        ON document.id = state.document_id
        AND document.workspace_id = state.workspace_id
      WHERE
        state.workspace_id = ?
        AND state.document_id = ?
        AND state.document_version_id = ?
      LIMIT 1
    `).get(
      input.workspaceId,
      input.documentId,
      input.documentVersionId,
    ) as KnowledgeDocumentIndexTargetRow | undefined;
    if (
      !target ||
      target.deleted_at !== null ||
      target.current_version_id !== input.documentVersionId ||
      target.status !== KnowledgeDocumentIndexStatuses.Indexing ||
      target.active_attempt_id !== input.attemptId
    ) {
      throw new KnowledgeDocumentIndexStateError(
        'Knowledge document index target does not own the active current-version lease',
      );
    }
  }

  private initialize(resolveTokenizer?: TokenizerResolver): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_document_index_config (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        schema_version INTEGER NOT NULL,
        tokenizer_mode TEXT NOT NULL,
        tokenizer_version TEXT NOT NULL,
        trigram_available INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_document_index_state (
        document_version_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN (
            '${KnowledgeDocumentIndexStatuses.Pending}',
            '${KnowledgeDocumentIndexStatuses.Indexing}',
            '${KnowledgeDocumentIndexStatuses.Indexed}',
            '${KnowledgeDocumentIndexStatuses.NotApplicable}',
            '${KnowledgeDocumentIndexStatuses.Failed}'
          )
        ),
        tokenizer_version TEXT NOT NULL,
        chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        active_attempt_id TEXT,
        published_generation_id TEXT,
        error_code TEXT,
        requested_at TEXT NOT NULL,
        started_at TEXT,
        heartbeat_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (document_version_id)
          REFERENCES knowledge_document_versions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_document_index_queue
      ON knowledge_document_index_state(status, requested_at, document_version_id);

      CREATE INDEX IF NOT EXISTS idx_knowledge_document_index_workspace
      ON knowledge_document_index_state(workspace_id, document_id, document_version_id);

      CREATE TABLE IF NOT EXISTS knowledge_document_index_attempts (
        id TEXT PRIMARY KEY,
        document_version_id TEXT NOT NULL,
        attempt_number INTEGER NOT NULL,
        tokenizer_version TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        outcome TEXT NOT NULL CHECK (
          outcome IN (
            '${KnowledgeDocumentIndexAttemptOutcomes.Running}',
            '${KnowledgeDocumentIndexAttemptOutcomes.Indexed}',
            '${KnowledgeDocumentIndexAttemptOutcomes.Failed}',
            '${KnowledgeDocumentIndexAttemptOutcomes.Cancelled}',
            '${KnowledgeDocumentIndexAttemptOutcomes.Abandoned}'
          )
        ),
        error_code TEXT,
        UNIQUE(document_version_id, attempt_number),
        FOREIGN KEY (document_version_id)
          REFERENCES knowledge_document_versions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_document_index_attempts_version
      ON knowledge_document_index_attempts(document_version_id, attempt_number);

      CREATE TABLE IF NOT EXISTS knowledge_document_chunks (
        storage_id TEXT PRIMARY KEY,
        id TEXT NOT NULL,
        index_generation_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        document_version_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        content TEXT NOT NULL,
        start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
        end_offset INTEGER NOT NULL CHECK (end_offset >= start_offset),
        page_number INTEGER,
        sheet_name TEXT,
        slide_number INTEGER,
        heading_path_json TEXT,
        checksum TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(index_generation_id, id),
        UNIQUE(index_generation_id, ordinal),
        FOREIGN KEY (document_version_id)
          REFERENCES knowledge_document_versions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_document_chunks_workspace
      ON knowledge_document_chunks(
        workspace_id, document_version_id, index_generation_id, ordinal
      );
    `);
    this.initializeTokenizer(resolveTokenizer);
  }

  private initializeTokenizer(resolveTokenizer?: TokenizerResolver): void {
    const existing = this.db
      .prepare(
        'SELECT tokenizer_version FROM knowledge_document_index_config WHERE singleton_id = 1',
      )
      .get() as { tokenizer_version: KnowledgeDocumentIndexTokenizer } | undefined;
    if (existing) {
      this.tokenizer = existing.tokenizer_version;
      this.ensureFtsTable(existing.tokenizer_version);
      return;
    }

    const trigramAvailable = probeTrigram(this.db);
    const selected = resolveTokenizer?.(this.db) ?? (
      trigramAvailable
        ? KnowledgeDocumentIndexTokenizers.TrigramV1
        : KnowledgeDocumentIndexTokenizers.CjkBigramV1
    );
    this.ensureFtsTable(selected);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO knowledge_document_index_config (
        singleton_id, schema_version, tokenizer_mode, tokenizer_version,
        trigram_available, updated_at
      ) VALUES (1, 1, ?, ?, ?, ?)
    `).run(selected, selected, trigramAvailable ? 1 : 0, now);
    this.tokenizer = selected;
  }

  private ensureFtsTable(tokenizer: KnowledgeDocumentIndexTokenizer): void {
    const tokenize = tokenizer === KnowledgeDocumentIndexTokenizers.TrigramV1
      ? 'trigram'
      : 'unicode61 remove_diacritics 2';
    const existing = this.db.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type = 'table' AND name = 'knowledge_document_chunks_fts'
    `).get() as { sql: string } | undefined;
    if (existing && !existing.sql.toLowerCase().includes(`tokenize='${tokenize}'`)) {
      throw new Error('Persisted knowledge index tokenizer does not match the FTS table');
    }
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_document_chunks_fts USING fts5(
        storage_id UNINDEXED,
        chunk_id UNINDEXED,
        index_generation_id UNINDEXED,
        workspace_id UNINDEXED,
        document_id UNINDEXED,
        document_version_id UNINDEXED,
        search_text,
        tokenize='${tokenize}'
      )
    `);
  }

  private requireState(documentVersionId: string): KnowledgeDocumentIndexState {
    const state = this.getState(documentVersionId);
    if (!state) {
      throw new KnowledgeDocumentIndexStateError(
        'Knowledge document index state was not persisted',
      );
    }
    return state;
  }

  private requireAttempt(attemptId: string): KnowledgeDocumentIndexAttempt {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          document_version_id,
          attempt_number,
          tokenizer_version,
          started_at,
          finished_at,
          outcome,
          error_code
        FROM knowledge_document_index_attempts
        WHERE id = ?
        LIMIT 1
      `,
      )
      .get(attemptId) as KnowledgeDocumentIndexAttemptRow | undefined;
    if (!row) {
      throw new KnowledgeDocumentIndexStateError(
        'Knowledge document index attempt was not persisted',
      );
    }
    return mapAttemptRow(row);
  }
}
