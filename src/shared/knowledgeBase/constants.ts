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

export const KnowledgeEnrichmentStatus = {
  Queued: 'queued',
  Running: 'running',
  ReviewRequired: 'review_required',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Stale: 'stale',
} as const;
export type KnowledgeEnrichmentStatus =
  (typeof KnowledgeEnrichmentStatus)[keyof typeof KnowledgeEnrichmentStatus];

export const KnowledgeEnrichmentAttemptOutcome = {
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Abandoned: 'abandoned',
} as const;
export type KnowledgeEnrichmentAttemptOutcome =
  (typeof KnowledgeEnrichmentAttemptOutcome)[keyof typeof KnowledgeEnrichmentAttemptOutcome];

export const KnowledgeEnrichmentPartialReason = {
  ChunkLimit: 'chunk_limit',
  CandidateLimit: 'candidate_limit',
} as const;
export type KnowledgeEnrichmentPartialReason =
  (typeof KnowledgeEnrichmentPartialReason)[keyof typeof KnowledgeEnrichmentPartialReason];

export const KnowledgeFactReviewStatus = {
  Pending: 'pending',
  Confirmed: 'confirmed',
  Rejected: 'rejected',
} as const;
export type KnowledgeFactReviewStatus =
  (typeof KnowledgeFactReviewStatus)[keyof typeof KnowledgeFactReviewStatus];

export const KnowledgeFactSourceKind = {
  Extracted: 'extracted',
  Manual: 'manual',
  Imported: 'imported',
} as const;
export type KnowledgeFactSourceKind =
  (typeof KnowledgeFactSourceKind)[keyof typeof KnowledgeFactSourceKind];

export const KnowledgeFactProjectionState = {
  None: 'none',
  Active: 'active',
  Conflict: 'conflict',
  Reversed: 'reversed',
} as const;
export type KnowledgeFactProjectionState =
  (typeof KnowledgeFactProjectionState)[keyof typeof KnowledgeFactProjectionState];

export const KnowledgeFactProfileProjectionAction = {
  Inserted: 'inserted',
  PreexistingSupport: 'preexisting_support',
  ReplacedSingle: 'replaced_single',
} as const;
export type KnowledgeFactProfileProjectionAction =
  (typeof KnowledgeFactProfileProjectionAction)[keyof typeof KnowledgeFactProfileProjectionAction];

export const KnowledgeFactProjectionOperation = {
  Confirm: 'confirm',
  Archive: 'archive',
} as const;
export type KnowledgeFactProjectionOperation =
  (typeof KnowledgeFactProjectionOperation)[keyof typeof KnowledgeFactProjectionOperation];

export const KnowledgeFactProjectionConflictKind = {
  CompanySummaryReplacement: 'company_summary_replacement',
  ArchiveFieldChanged: 'archive_field_changed',
} as const;
export type KnowledgeFactProjectionConflictKind =
  (typeof KnowledgeFactProjectionConflictKind)[keyof typeof KnowledgeFactProjectionConflictKind];

export const KnowledgeFactReviewDecision = {
  Confirm: 'confirm',
  Reject: 'reject',
} as const;
export type KnowledgeFactReviewDecision =
  (typeof KnowledgeFactReviewDecision)[keyof typeof KnowledgeFactReviewDecision];

export const KnowledgeFactArchiveProjectionDecision = {
  KeepCurrent: 'keep_current',
  RemoveCurrent: 'remove_current',
} as const;
export type KnowledgeFactArchiveProjectionDecision =
  (typeof KnowledgeFactArchiveProjectionDecision)[keyof typeof KnowledgeFactArchiveProjectionDecision];

export const KnowledgeTrustedIndexRefreshStatus = {
  Queued: 'queued',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
} as const;
export type KnowledgeTrustedIndexRefreshStatus =
  (typeof KnowledgeTrustedIndexRefreshStatus)[keyof typeof KnowledgeTrustedIndexRefreshStatus];

export const KnowledgeTrustedIndexRefreshAttemptOutcome = {
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Abandoned: 'abandoned',
} as const;
export type KnowledgeTrustedIndexRefreshAttemptOutcome =
  (typeof KnowledgeTrustedIndexRefreshAttemptOutcome)[keyof typeof KnowledgeTrustedIndexRefreshAttemptOutcome];

export const KnowledgeTrustedProfileIndexErrorCode = {
  RefreshFailed: 'trusted_profile_index_refresh_failed',
  RefreshAbandoned: 'trusted_profile_index_refresh_abandoned',
} as const;
export type KnowledgeTrustedProfileIndexErrorCode =
  (typeof KnowledgeTrustedProfileIndexErrorCode)[keyof typeof KnowledgeTrustedProfileIndexErrorCode];

export const KnowledgeFactDomain = {
  CompanySummary: 'companySummary',
  ProductList: 'productList',
  ProductCapabilities: 'productCapabilities',
  TargetCustomers: 'targetCustomers',
  ApplicationScenarios: 'applicationScenarios',
  SellingPoints: 'sellingPoints',
  ChannelPreferences: 'channelPreferences',
  ProhibitedClaims: 'prohibitedClaims',
  ContactRules: 'contactRules',
  MissingInfo: 'missingInfo',
} as const;
export type KnowledgeFactDomain =
  (typeof KnowledgeFactDomain)[keyof typeof KnowledgeFactDomain];

export const KnowledgeFactDomains = Object.values(KnowledgeFactDomain) as KnowledgeFactDomain[];

export const KnowledgeFactListView = {
  Active: 'active',
  History: 'history',
} as const;
export type KnowledgeFactListView =
  (typeof KnowledgeFactListView)[keyof typeof KnowledgeFactListView];

export const KnowledgeFactEvidenceState = {
  Active: 'active',
  Stale: 'stale',
  Any: 'any',
} as const;
export type KnowledgeFactEvidenceState =
  (typeof KnowledgeFactEvidenceState)[keyof typeof KnowledgeFactEvidenceState];

export const KnowledgeBaseErrorCode = {
  BackendNotReady: 'backend_not_ready',
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
  DocumentNotReady: 'document_not_ready',
  LocalIndexNotReady: 'local_index_not_ready',
  ExplicitConsentRequired: 'explicit_consent_required',
  ModelConfigurationUnavailable: 'model_configuration_unavailable',
  ModelConfigurationChanged: 'model_configuration_changed',
  InvalidExtractionAuthorization: 'invalid_extraction_authorization',
  ExpiredExtractionAuthorization: 'expired_extraction_authorization',
  ConsumedExtractionAuthorization: 'consumed_extraction_authorization',
  ForeignExtractionAuthorizationOwner: 'foreign_extraction_authorization_owner',
  UnsupportedModelProvider: 'unsupported_model_provider',
  EnrichmentAlreadyActive: 'enrichment_already_active',
  EnrichmentRequestNotFound: 'enrichment_request_not_found',
  EnrichmentRequestStale: 'enrichment_request_stale',
  ModelRequestFailed: 'model_request_failed',
  ModelRequestTimeout: 'model_request_timeout',
  InvalidModelResponse: 'invalid_model_response',
  EvidenceValidationFailed: 'evidence_validation_failed',
  FactEvidenceStale: 'fact_evidence_stale',
  FactRevisionConflict: 'fact_revision_conflict',
  FactProjectionConflict: 'fact_projection_conflict',
  ProfileRevisionConflict: 'profile_revision_conflict',
  EnrichmentPersistenceFailed: 'enrichment_persistence_failed',
  AuthorizationRequired: 'authorization_required',
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
export const KNOWLEDGE_EXTRACTION_AUTHORIZATION_TTL_MS = 120_000;
export const KNOWLEDGE_ENRICHMENT_MAX_CHUNKS = 30;
export const KNOWLEDGE_ENRICHMENT_MAX_CANDIDATES_PER_CALL = 50;
export const KNOWLEDGE_ENRICHMENT_MAX_CANDIDATES_PER_REQUEST = 200;
export const KNOWLEDGE_ENRICHMENT_MODEL_MAX_TOKENS = 4_096;
export const KNOWLEDGE_ENRICHMENT_MODEL_MAX_RESPONSE_BYTES = 1_048_576;
export const KNOWLEDGE_ENRICHMENT_MODEL_TIMEOUT_MS = 180_000;
export const KNOWLEDGE_ENRICHMENT_HEARTBEAT_INTERVAL_MS = 15_000;
export const KNOWLEDGE_ENRICHMENT_CONCURRENCY = 1;
export const KNOWLEDGE_FACT_MAX_VALUE_CHARS = 2_000;
export const KNOWLEDGE_EVIDENCE_MAX_QUOTE_CHARS = 1_000;
export const KNOWLEDGE_EVIDENCE_PREVIEW_MAX_CHARS = 240;
export const KNOWLEDGE_FACT_EVIDENCE_PAGE_DEFAULT_LIMIT = 50;
export const KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT = 100;
export const KNOWLEDGE_FACT_LIST_DEFAULT_LIMIT = 50;
export const KNOWLEDGE_FACT_LIST_MAX_LIMIT = 100;
export const KNOWLEDGE_ENRICHMENT_SAFE_ERROR_MAX_CHARS = 240;

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
  PrepareExtractionAuthorization: 'knowledgeBase:extraction:prepareAuthorization',
  RequestExtraction: 'knowledgeBase:extraction:request',
  RetryExtraction: 'knowledgeBase:extraction:retry',
  CancelExtraction: 'knowledgeBase:extraction:cancel',
  ListFacts: 'knowledgeBase:facts:list',
  ReviewFact: 'knowledgeBase:facts:review',
  ArchiveFact: 'knowledgeBase:facts:archive',
  GetFactEvidence: 'knowledgeBase:facts:getEvidence',
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
