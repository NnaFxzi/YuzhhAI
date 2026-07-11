import {
  type KnowledgeBaseErrorCode,
  KnowledgeBaseErrorCode as KnowledgeBaseErrorCodes,
  type KnowledgeDocumentIndexStatus,
  KnowledgeDocumentIndexStatus as KnowledgeDocumentIndexStatuses,
  type KnowledgeDocumentStatus,
  KnowledgeDocumentStatus as KnowledgeDocumentStatuses,
  KnowledgeIngestionJobStatus,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeDocumentListItem,
  KnowledgeImportBatchResult,
} from '../../../shared/knowledgeBase/types';

export type KnowledgeDocumentStatusFilter = 'all' | KnowledgeDocumentStatus;

export interface KnowledgeImportBatchSummary {
  key: string;
  values: {
    imported: number;
    failed: number;
  };
}

const statusKeys: Record<KnowledgeDocumentStatus, string> = {
  [KnowledgeDocumentStatuses.Pending]: 'enterpriseKnowledgeDocumentStatusPending',
  [KnowledgeDocumentStatuses.Processing]: 'enterpriseKnowledgeDocumentStatusProcessing',
  [KnowledgeDocumentStatuses.Ready]: 'enterpriseKnowledgeDocumentStatusReady',
  [KnowledgeDocumentStatuses.CompletedWithoutText]:
    'enterpriseKnowledgeDocumentStatusSavedNotSearchable',
  [KnowledgeDocumentStatuses.Failed]: 'enterpriseKnowledgeDocumentStatusFailed',
};

const indexStatusKeys: Record<KnowledgeDocumentIndexStatus, string> = {
  [KnowledgeDocumentIndexStatuses.Pending]: 'enterpriseKnowledgeLocalIndexStatusPending',
  [KnowledgeDocumentIndexStatuses.Indexing]: 'enterpriseKnowledgeLocalIndexStatusIndexing',
  [KnowledgeDocumentIndexStatuses.Indexed]: 'enterpriseKnowledgeLocalIndexStatusIndexed',
  [KnowledgeDocumentIndexStatuses.NotApplicable]:
    'enterpriseKnowledgeLocalIndexStatusNotApplicable',
  [KnowledgeDocumentIndexStatuses.Failed]: 'enterpriseKnowledgeLocalIndexStatusFailed',
};

const errorKeys: Partial<Record<KnowledgeBaseErrorCode, string>> = {
  [KnowledgeBaseErrorCodes.InvalidRequest]: 'enterpriseKnowledgeErrorPersistence',
  [KnowledgeBaseErrorCodes.InvalidSelectionToken]: 'enterpriseKnowledgeErrorInvalidSelection',
  [KnowledgeBaseErrorCodes.TooManyFiles]: 'enterpriseKnowledgeErrorTooManyFiles',
  [KnowledgeBaseErrorCodes.FileTooLarge]: 'enterpriseKnowledgeErrorFileTooLarge',
  [KnowledgeBaseErrorCodes.UnsupportedFileType]: 'enterpriseKnowledgeErrorUnsupportedType',
  [KnowledgeBaseErrorCodes.SelectedFileMissing]: 'enterpriseKnowledgeErrorFileChanged',
  [KnowledgeBaseErrorCodes.SelectedFileChanged]: 'enterpriseKnowledgeErrorFileChanged',
  [KnowledgeBaseErrorCodes.WorkspaceQuotaExceeded]: 'enterpriseKnowledgeErrorQuotaExceeded',
  [KnowledgeBaseErrorCodes.WorkspaceNotFound]: 'enterpriseKnowledgeErrorPersistence',
  [KnowledgeBaseErrorCodes.DocumentNotFound]: 'enterpriseKnowledgeErrorPersistence',
  [KnowledgeBaseErrorCodes.RevisionConflict]: 'enterpriseKnowledgeRevisionConflict',
  [KnowledgeBaseErrorCodes.JobStateConflict]: 'enterpriseKnowledgeErrorPersistence',
  [KnowledgeBaseErrorCodes.IngestionFailed]: 'enterpriseKnowledgeImportFailed',
  [KnowledgeBaseErrorCodes.PersistenceFailed]: 'enterpriseKnowledgeErrorPersistence',
};

export const getKnowledgeDocumentStatusKey = (status: KnowledgeDocumentStatus): string =>
  statusKeys[status];

export const getKnowledgeDocumentIndexStatusKey = (
  status: KnowledgeDocumentIndexStatus,
): string => indexStatusKeys[status];

export const getKnowledgeDocumentErrorKey = (code: KnowledgeBaseErrorCode): string =>
  errorKeys[code] ?? 'enterpriseKnowledgeErrorPersistence';

export const summarizeKnowledgeImportBatch = (
  result: KnowledgeImportBatchResult,
): KnowledgeImportBatchSummary => ({
  key:
    result.importedCount > 0
      ? result.failedCount > 0
        ? 'enterpriseKnowledgeImportPartialSuccess'
        : 'enterpriseKnowledgeImportSuccess'
      : 'enterpriseKnowledgeImportFailed',
  values: {
    imported: result.importedCount,
    failed: result.failedCount,
  },
});

export const shouldPollKnowledgeDocuments = (
  documents: KnowledgeDocumentListItem[],
): boolean =>
  documents.some(
    document =>
      document.currentJob?.status === KnowledgeIngestionJobStatus.Queued ||
      document.currentJob?.status === KnowledgeIngestionJobStatus.Running ||
      document.localIndex?.status === KnowledgeDocumentIndexStatuses.Pending ||
      document.localIndex?.status === KnowledgeDocumentIndexStatuses.Indexing,
  );

export const canRetryKnowledgeDocumentIndex = (
  document: KnowledgeDocumentListItem,
): boolean =>
  !document.deletedAt &&
  document.localIndex?.status === KnowledgeDocumentIndexStatuses.Failed &&
  document.localIndex.documentVersionId === document.currentVersionId;

export const filterKnowledgeDocuments = (
  documents: KnowledgeDocumentListItem[],
  query: string,
  status: KnowledgeDocumentStatusFilter,
): KnowledgeDocumentListItem[] => {
  const normalizedQuery = query.trim().toLowerCase();
  return documents.filter(document => {
    const matchesStatus = status === 'all' || document.status === status;
    const matchesQuery =
      !normalizedQuery ||
      [document.displayName, document.mimeType ?? '']
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    return matchesStatus && matchesQuery;
  });
};
