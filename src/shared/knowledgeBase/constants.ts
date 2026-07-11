export const KnowledgeDocumentSourceMode = {
  Managed: 'managed',
  Linked: 'linked',
} as const;
export type KnowledgeDocumentSourceMode =
  (typeof KnowledgeDocumentSourceMode)[keyof typeof KnowledgeDocumentSourceMode];

export const KnowledgeDocumentStatus = {
  Pending: 'pending',
  Processing: 'processing',
  Ready: 'ready',
  CompletedWithoutText: 'completed_without_text',
  Failed: 'failed',
} as const;
export type KnowledgeDocumentStatus =
  (typeof KnowledgeDocumentStatus)[keyof typeof KnowledgeDocumentStatus];

export const KnowledgeIngestionStage = {
  Queued: 'queued',
  Parsing: 'parsing',
  Ocr: 'ocr',
  Chunking: 'chunking',
  Indexing: 'indexing',
  FactExtraction: 'fact_extraction',
} as const;
export type KnowledgeIngestionStage =
  (typeof KnowledgeIngestionStage)[keyof typeof KnowledgeIngestionStage];

export const KnowledgeIngestionJobStatus = {
  Queued: 'queued',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;
export type KnowledgeIngestionJobStatus =
  (typeof KnowledgeIngestionJobStatus)[keyof typeof KnowledgeIngestionJobStatus];

export const KnowledgeIngestionAttemptOutcome = {
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Abandoned: 'abandoned',
} as const;
export type KnowledgeIngestionAttemptOutcome =
  (typeof KnowledgeIngestionAttemptOutcome)[keyof typeof KnowledgeIngestionAttemptOutcome];

export const KnowledgeMigrationStatus = {
  Pending: 'pending',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
} as const;
export type KnowledgeMigrationStatus =
  (typeof KnowledgeMigrationStatus)[keyof typeof KnowledgeMigrationStatus];

export const KnowledgeBaseErrorCode = {
  InvalidRequest: 'invalid_request',
  InvalidSelectionToken: 'invalid_selection_token',
  RevisionConflict: 'revision_conflict',
  InvalidManagedPath: 'invalid_managed_path',
  FileTooLarge: 'file_too_large',
  TooManyFiles: 'too_many_files',
  UnsupportedFileType: 'unsupported_file_type',
  SelectedFileMissing: 'selected_file_missing',
  SelectedFileChanged: 'selected_file_changed',
  WorkspaceQuotaExceeded: 'workspace_quota_exceeded',
  WorkspaceNotFound: 'workspace_not_found',
  DocumentNotFound: 'document_not_found',
  IngestionFailed: 'ingestion_failed',
  PersistenceFailed: 'persistence_failed',
  JobStateConflict: 'job_state_conflict',
  MigrationFailed: 'migration_failed',
} as const;
export type KnowledgeBaseErrorCode =
  (typeof KnowledgeBaseErrorCode)[keyof typeof KnowledgeBaseErrorCode];

export const KNOWLEDGE_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const KNOWLEDGE_MAX_SELECTION_FILES = 100;
export const KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES = 20 * 1024 * 1024 * 1024;
export const KNOWLEDGE_GENERAL_JOB_CONCURRENCY = 2;
export const KNOWLEDGE_OCR_JOB_CONCURRENCY = 1;
export const KNOWLEDGE_SELECTION_TOKEN_TTL_MS = 5 * 60_000;
export const KNOWLEDGE_DOCUMENT_LEGACY_SOURCE_PREFIX = 'knowledge-document:';

export const KnowledgeDocumentVisibility = {
  Active: 'active',
  Deleted: 'deleted',
} as const;
export type KnowledgeDocumentVisibility =
  (typeof KnowledgeDocumentVisibility)[keyof typeof KnowledgeDocumentVisibility];

export const KnowledgeBaseIpc = {
  DeleteDocument: 'knowledgeBase:documents:delete',
  GetDocumentDetails: 'knowledgeBase:documents:getDetails',
  ImportSelection: 'knowledgeBase:documents:importSelection',
  ListDocuments: 'knowledgeBase:documents:list',
  RestoreDocument: 'knowledgeBase:documents:restore',
  RetryDocument: 'knowledgeBase:documents:retry',
  RetryLocalIndex: 'knowledgeBase:documents:retryLocalIndex',
  SelectFiles: 'knowledgeBase:files:select',
} as const;
export type KnowledgeBaseIpc = (typeof KnowledgeBaseIpc)[keyof typeof KnowledgeBaseIpc];

export const KnowledgeDocumentIndexStatus = {
  Pending: 'pending',
  Indexing: 'indexing',
  Indexed: 'indexed',
  NotApplicable: 'not_applicable',
  Failed: 'failed',
} as const;
export type KnowledgeDocumentIndexStatus =
  (typeof KnowledgeDocumentIndexStatus)[keyof typeof KnowledgeDocumentIndexStatus];

export const KnowledgeDocumentIndexAttemptOutcome = {
  Running: 'running',
  Indexed: 'indexed',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Abandoned: 'abandoned',
} as const;
export type KnowledgeDocumentIndexAttemptOutcome =
  (typeof KnowledgeDocumentIndexAttemptOutcome)[keyof typeof KnowledgeDocumentIndexAttemptOutcome];

export const KnowledgeDocumentIndexTokenizer = {
  TrigramV1: 'fts5_trigram_v1',
  CjkBigramV1: 'unicode61_cjk_bigram_v1',
} as const;
export type KnowledgeDocumentIndexTokenizer =
  (typeof KnowledgeDocumentIndexTokenizer)[keyof typeof KnowledgeDocumentIndexTokenizer];

export const KnowledgeDocumentIndexErrorCode = {
  ProcessingFailed: 'index_processing_failed',
  WorkerUnavailable: 'index_worker_unavailable',
  StateConflict: 'index_state_conflict',
} as const;
export type KnowledgeDocumentIndexErrorCode =
  (typeof KnowledgeDocumentIndexErrorCode)[keyof typeof KnowledgeDocumentIndexErrorCode];

export const KNOWLEDGE_CHUNK_TARGET_CHARS = 18_000;
export const KNOWLEDGE_CHUNK_OVERLAP_CHARS = 800;
export const KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS = 8;
export const KNOWLEDGE_INDEX_WORKER_WRITE_BATCH_CHUNKS = 8;
export const KNOWLEDGE_INDEX_WORKER_WRITER_YIELD_MS = 1;
export const KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS = 64;
export const KNOWLEDGE_INDEX_WORKER_CLEANUP_BATCH_ROWS = 64;
export const KNOWLEDGE_INDEX_WORKER_CLEANUP_YIELD_MS = 105;
