import type {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeDocumentVisibility,
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
}

export type KnowledgeBaseIpcResult<T> =
  | { success: true; data: T }
  | { success: false; error: KnowledgeBaseIpcError };

export interface KnowledgeImportSelectionRequest {
  workspaceId: string;
  selectionToken: string;
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
