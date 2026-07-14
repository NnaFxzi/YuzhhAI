import type {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeDocumentVisibility,
  KnowledgeEnrichmentPartialReason,
  KnowledgeEnrichmentStatus,
  KnowledgeFactArchiveProjectionDecision,
  KnowledgeFactDomain,
  KnowledgeFactEvidenceState,
  KnowledgeFactListView,
  KnowledgeFactProjectionConflictKind,
  KnowledgeFactProjectionOperation,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewDecision,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
  KnowledgeIngestionAttemptOutcome,
  KnowledgeIngestionJobStatus,
  KnowledgeIngestionStage,
  KnowledgeMigrationStatus,
} from './constants';

export interface KnowledgeDocument {
  id: string;
  workspaceId: string;
  legacySourceId: string | null;
  displayName: string;
  sourceMode: KnowledgeDocumentSourceMode;
  originalPath: string | null;
  currentVersionId: string;
  revision: number;
  status: KnowledgeDocumentStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface KnowledgeDocumentSummary extends KnowledgeDocument {
  fileSize: number | null;
  mimeType: string | null;
  contentHash: string | null;
}

export interface KnowledgeDocumentVersion {
  id: string;
  documentId: string;
  contentHash: string | null;
  managedPath: string | null;
  mimeType: string | null;
  fileSize: number | null;
  sourceMtime: number | null;
  parser: string | null;
  extractedText: string | null;
  extractionPartial: boolean;
  createdAt: string;
}

export interface CreateKnowledgeDocumentInput {
  workspaceId: string;
  legacySourceId?: string;
  displayName: string;
  sourceMode: KnowledgeDocumentSourceMode;
  originalPath?: string;
  status: KnowledgeDocumentStatus;
  version: Omit<KnowledgeDocumentVersion, 'id' | 'documentId' | 'createdAt'>;
}

export interface KnowledgeIngestionJob {
  id: string;
  workspaceId: string;
  documentId: string;
  documentVersionId: string;
  stage: KnowledgeIngestionStage;
  status: KnowledgeIngestionJobStatus;
  progress: number;
  attemptCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  heartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeIngestionJobAttempt {
  id: string;
  jobId: string;
  attemptNumber: number;
  startedAt: string;
  finishedAt: string | null;
  outcome: KnowledgeIngestionAttemptOutcome;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface KnowledgeMigrationState {
  workspaceId: string;
  version: number;
  status: KnowledgeMigrationStatus;
  sourceCount: number;
  migratedCount: number;
  lastSourceId: string | null;
  diagnostics: string[];
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface KnowledgeIngestionJobSummary {
  id: string;
  documentVersionId: string;
  stage: KnowledgeIngestionStage;
  status: KnowledgeIngestionJobStatus;
  progress: number;
  errorCode: string | null;
  updatedAt: string;
}

export interface KnowledgeDocumentIndexSummary {
  documentVersionId: string;
  status: KnowledgeDocumentIndexStatus;
  chunkCount: number;
  attemptCount: number;
  errorCode: string | null;
  updatedAt: string;
  completedAt: string | null;
}

export interface KnowledgeDocumentListItem {
  id: string;
  displayName: string;
  sourceMode: KnowledgeDocumentSourceMode;
  currentVersionId: string;
  revision: number;
  status: KnowledgeDocumentStatus;
  fileSize: number | null;
  mimeType: string | null;
  contentHash: string | null;
  currentJob: KnowledgeIngestionJobSummary | null;
  localIndex: KnowledgeDocumentIndexSummary | null;
  enrichment: KnowledgeEnrichmentSummary | null;
  hasStalePriorVersionExtraction: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface KnowledgeDocumentDetails {
  document: KnowledgeDocumentListItem;
  activeVersion: {
    id: string;
    parser: string | null;
    extractedText: string | null;
    extractionPartial: boolean;
    createdAt: string;
  };
}

export interface KnowledgeSelectedFile {
  itemId: string;
  displayName: string;
  fileSize: number;
}

export interface KnowledgeFileSelection {
  selectionToken: string;
  files: KnowledgeSelectedFile[];
}

export type KnowledgeImportItemResult =
  | {
      success: true;
      itemId: string;
      document: KnowledgeDocumentListItem;
    }
  | {
      success: false;
      itemId: string;
      fileName: string;
      errorCode: KnowledgeBaseErrorCode;
    };

export interface KnowledgeImportBatchResult {
  importedCount: number;
  failedCount: number;
  items: KnowledgeImportItemResult[];
}

export interface KnowledgeBaseIpcError {
  code: KnowledgeBaseErrorCode;
  fileName?: string;
  latestDocument?: KnowledgeDocumentListItem;
  projectionConflict?: KnowledgeFactProjectionConflict;
}

export type KnowledgeBaseIpcResult<T> =
  { success: true; data: T } | { success: false; error: KnowledgeBaseIpcError };

export interface KnowledgeImportSelectionRequest {
  workspaceId: string;
  selectionToken: string;
  itemIds?: string[];
}

export interface KnowledgeListDocumentsRequest {
  workspaceId: string;
  visibility: KnowledgeDocumentVisibility;
}

export interface KnowledgeDocumentDetailsRequest {
  documentId: string;
}

export interface KnowledgeDocumentRevisionRequest {
  documentId: string;
  expectedRevision: number;
}

export interface KnowledgeRetryDocumentRequest {
  documentId: string;
  documentVersionId: string;
}

export interface KnowledgeRetryLocalIndexRequest {
  documentId: string;
  documentVersionId: string;
}

export interface KnowledgePrepareExtractionAuthorizationRequest {
  documentId: string;
  documentVersionId: string;
}

export interface KnowledgeRequestExtractionRequest {
  authorizationToken: string;
}

export interface KnowledgeRetryExtractionRequest {
  requestId: string;
  authorizationToken: string;
}

export interface KnowledgeCancelExtractionRequest {
  requestId: string;
  expectedRevision: number;
}

export interface KnowledgeEnrichmentSummary {
  requestId: string;
  documentId: string;
  documentVersionId: string;
  status: KnowledgeEnrichmentStatus;
  progress: number;
  revision: number;
  attemptCount: number;
  validCandidateCount: number;
  discardedCandidateCount: number;
  pendingFactCount: number;
  partialReasons: KnowledgeEnrichmentPartialReason[];
  errorCode: KnowledgeBaseErrorCode | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface KnowledgeExtractionAuthorizationDescriptor {
  workspaceId: string;
  documentId: string;
  documentVersionId: string;
  documentDisplayName: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  plannedModelCalls: number;
  partial: boolean;
  expiresAt: string;
}

export interface KnowledgeExtractionAuthorizationPreparation {
  authorizationToken: string;
  descriptor: KnowledgeExtractionAuthorizationDescriptor;
}

export interface KnowledgeFactEvidenceSummary {
  id: string;
  factId: string;
  documentId: string;
  documentVersionId: string;
  documentDisplayName: string;
  quote: string;
  confidence: number;
  stale: boolean;
  createdAt: string;
}

export interface KnowledgeFactEvidencePageRequest {
  factId: string;
  expectedRevision: number;
  cursor?: string;
  limit?: number;
}

export interface KnowledgeFactEvidencePageResult {
  factId: string;
  factRevision: number;
  items: KnowledgeFactEvidenceSummary[];
  nextCursor: string | null;
}

export interface KnowledgeFactSummary {
  id: string;
  domain: KnowledgeFactDomain;
  value: string;
  reviewStatus: KnowledgeFactReviewStatus;
  sourceKind: KnowledgeFactSourceKind;
  revision: number;
  projectionState: KnowledgeFactProjectionState;
  activeEvidenceCount: number;
  staleEvidenceCount: number;
  evidencePreview: KnowledgeFactEvidenceSummary | null;
  createdAt: string;
  reviewedAt: string | null;
  updatedAt: string;
  archivedAt: string | null;
}

export interface KnowledgeFactMetrics {
  activePendingCount: number;
  activeConfirmedCount: number;
  staleConfirmedCount: number;
  rejectedHistoryCount: number;
  archivedHistoryCount: number;
  unduplicatedLegacyConfirmedCount: number;
  totalAiKnowledgeCount: number;
}

export interface KnowledgeListFactsRequest {
  workspaceId: string;
  view?: KnowledgeFactListView;
  reviewStatuses?: KnowledgeFactReviewStatus[];
  evidenceState?: KnowledgeFactEvidenceState;
  cursor?: string;
  limit?: number;
}

export interface KnowledgeFactListResult {
  items: KnowledgeFactSummary[];
  nextCursor: string | null;
  metrics: KnowledgeFactMetrics;
}

export interface KnowledgeReviewFactRequest {
  factId: string;
  expectedRevision: number;
  decision: KnowledgeFactReviewDecision;
  replaceExisting?: boolean;
  expectedFieldRevision?: number;
}

export interface KnowledgeFactProjectionConflict {
  operation: KnowledgeFactProjectionOperation;
  kind: KnowledgeFactProjectionConflictKind;
  factId: string;
  factRevision: number;
  domain: KnowledgeFactDomain;
  currentFieldValue: string | string[];
  fieldRevision: number;
}

export interface KnowledgeFactReviewResult {
  fact: KnowledgeFactSummary;
  profileChanged: boolean;
  profileRevision: number | null;
  fieldRevision: number | null;
}

export interface KnowledgeArchiveFactRequest {
  factId: string;
  expectedRevision: number;
  projectionDecision?: KnowledgeFactArchiveProjectionDecision;
  expectedFieldRevision?: number;
}

export interface KnowledgeFactArchiveResult {
  fact: KnowledgeFactSummary;
  profileChanged: boolean;
  profileRevision: number | null;
  fieldRevision: number | null;
}

export interface KnowledgeBaseRendererApi {
  selectFiles(): Promise<KnowledgeBaseIpcResult<KnowledgeFileSelection | null>>;
  importSelection(
    input: KnowledgeImportSelectionRequest,
  ): Promise<KnowledgeBaseIpcResult<KnowledgeImportBatchResult>>;
  listDocuments(
    input: KnowledgeListDocumentsRequest,
  ): Promise<KnowledgeBaseIpcResult<KnowledgeDocumentListItem[]>>;
  getDocumentDetails(
    input: KnowledgeDocumentDetailsRequest,
  ): Promise<KnowledgeBaseIpcResult<KnowledgeDocumentDetails>>;
  deleteDocument(
    input: KnowledgeDocumentRevisionRequest,
  ): Promise<KnowledgeBaseIpcResult<KnowledgeDocumentListItem>>;
  restoreDocument(
    input: KnowledgeDocumentRevisionRequest,
  ): Promise<KnowledgeBaseIpcResult<KnowledgeDocumentListItem>>;
  retryDocument(
    input: KnowledgeRetryDocumentRequest,
  ): Promise<KnowledgeBaseIpcResult<KnowledgeDocumentListItem>>;
  retryLocalIndex(
    input: KnowledgeRetryLocalIndexRequest,
  ): Promise<KnowledgeBaseIpcResult<KnowledgeDocumentListItem>>;
  prepareExtractionAuthorization(
    input: KnowledgePrepareExtractionAuthorizationRequest,
  ): Promise<KnowledgeBaseIpcResult<KnowledgeExtractionAuthorizationPreparation>>;
  requestExtraction(
    input: KnowledgeRequestExtractionRequest,
  ): Promise<KnowledgeBaseIpcResult<KnowledgeEnrichmentSummary>>;
  retryExtraction(
    input: KnowledgeRetryExtractionRequest,
  ): Promise<KnowledgeBaseIpcResult<KnowledgeEnrichmentSummary>>;
  cancelExtraction(
    input: KnowledgeCancelExtractionRequest,
  ): Promise<KnowledgeBaseIpcResult<KnowledgeEnrichmentSummary>>;
  listFacts(
    input: KnowledgeListFactsRequest,
  ): Promise<KnowledgeBaseIpcResult<KnowledgeFactListResult>>;
  reviewFact(
    input: KnowledgeReviewFactRequest,
  ): Promise<KnowledgeBaseIpcResult<KnowledgeFactReviewResult>>;
  archiveFact(
    input: KnowledgeArchiveFactRequest,
  ): Promise<KnowledgeBaseIpcResult<KnowledgeFactArchiveResult>>;
  getFactEvidence(
    input: KnowledgeFactEvidencePageRequest,
  ): Promise<KnowledgeBaseIpcResult<KnowledgeFactEvidencePageResult>>;
}
