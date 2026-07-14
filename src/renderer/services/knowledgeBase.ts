import {
  type KnowledgeBaseErrorCode,
  KnowledgeBaseErrorCode as KnowledgeBaseErrorCodes,
  type KnowledgeDocumentVisibility,
} from '../../shared/knowledgeBase/constants';
import type {
  KnowledgeArchiveFactRequest,
  KnowledgeBaseIpcResult,
  KnowledgeBaseRendererApi,
  KnowledgeCancelExtractionRequest,
  KnowledgeDocumentDetails,
  KnowledgeDocumentListItem,
  KnowledgeEnrichmentSummary,
  KnowledgeExtractionAuthorizationPreparation,
  KnowledgeFactArchiveResult,
  KnowledgeFactEvidencePageRequest,
  KnowledgeFactEvidencePageResult,
  KnowledgeFactListResult,
  KnowledgeFactProjectionConflict,
  KnowledgeFactReviewResult,
  KnowledgeFileSelection,
  KnowledgeImportBatchResult,
  KnowledgeListFactsRequest,
  KnowledgePrepareExtractionAuthorizationRequest,
  KnowledgeRequestExtractionRequest,
  KnowledgeRetryExtractionRequest,
  KnowledgeReviewFactRequest,
} from '../../shared/knowledgeBase/types';

export class KnowledgeBaseServiceError extends Error {
  declare readonly fileName?: string;

  declare readonly latestDocument?: KnowledgeDocumentListItem;

  declare readonly projectionConflict?: KnowledgeFactProjectionConflict;

  constructor(
    readonly code: KnowledgeBaseErrorCode,
    options: {
      fileName?: string;
      latestDocument?: KnowledgeDocumentListItem;
      projectionConflict?: KnowledgeFactProjectionConflict;
    } = {},
  ) {
    super(code);
    Object.defineProperty(this, 'name', {
      configurable: true,
      value: 'KnowledgeBaseServiceError',
    });
    if (options.fileName !== undefined) {
      this.fileName = options.fileName;
    }
    if (options.latestDocument !== undefined) {
      this.latestDocument = options.latestDocument;
    }
    if (options.projectionConflict !== undefined) {
      this.projectionConflict = options.projectionConflict;
    }
  }
}

const getApi = (): KnowledgeBaseRendererApi | null => window.electron?.knowledgeBase ?? null;

const request = async <T>(
  invoke: (api: KnowledgeBaseRendererApi) => Promise<KnowledgeBaseIpcResult<T>>,
): Promise<T> => {
  const api = getApi();
  if (!api) {
    throw new KnowledgeBaseServiceError(KnowledgeBaseErrorCodes.PersistenceFailed);
  }
  let result: KnowledgeBaseIpcResult<T>;
  try {
    result = await invoke(api);
  } catch {
    throw new KnowledgeBaseServiceError(KnowledgeBaseErrorCodes.PersistenceFailed);
  }
  if (result.success) {
    return result.data;
  }
  throw new KnowledgeBaseServiceError(result.error.code, {
    fileName: result.error.fileName,
    latestDocument: result.error.latestDocument,
    projectionConflict: result.error.projectionConflict,
  });
};

export const knowledgeBaseService = {
  selectFiles: (): Promise<KnowledgeFileSelection | null> => request(api => api.selectFiles()),
  importSelection: (
    workspaceId: string,
    selectionToken: string,
    itemIds?: string[],
  ): Promise<KnowledgeImportBatchResult> =>
    request(api =>
      api.importSelection({
        workspaceId,
        selectionToken,
        ...(itemIds === undefined ? {} : { itemIds }),
      }),
    ),
  listDocuments: (
    workspaceId: string,
    visibility: KnowledgeDocumentVisibility,
  ): Promise<KnowledgeDocumentListItem[]> =>
    request(api => api.listDocuments({ workspaceId, visibility })),
  getDocumentDetails: (documentId: string): Promise<KnowledgeDocumentDetails> =>
    request(api => api.getDocumentDetails({ documentId })),
  deleteDocument: (
    documentId: string,
    expectedRevision: number,
  ): Promise<KnowledgeDocumentListItem> =>
    request(api => api.deleteDocument({ documentId, expectedRevision })),
  restoreDocument: (
    documentId: string,
    expectedRevision: number,
  ): Promise<KnowledgeDocumentListItem> =>
    request(api => api.restoreDocument({ documentId, expectedRevision })),
  retryDocument: (
    documentId: string,
    documentVersionId: string,
  ): Promise<KnowledgeDocumentListItem> =>
    request(api => api.retryDocument({ documentId, documentVersionId })),
  retryLocalIndex: (
    documentId: string,
    documentVersionId: string,
  ): Promise<KnowledgeDocumentListItem> =>
    request(api => api.retryLocalIndex({ documentId, documentVersionId })),
  prepareExtractionAuthorization: (
    input: KnowledgePrepareExtractionAuthorizationRequest,
  ): Promise<KnowledgeExtractionAuthorizationPreparation> =>
    request(api => api.prepareExtractionAuthorization(input)),
  requestExtraction: (
    input: KnowledgeRequestExtractionRequest,
  ): Promise<KnowledgeEnrichmentSummary> => request(api => api.requestExtraction(input)),
  retryExtraction: (
    input: KnowledgeRetryExtractionRequest,
  ): Promise<KnowledgeEnrichmentSummary> => request(api => api.retryExtraction(input)),
  cancelExtraction: (
    input: KnowledgeCancelExtractionRequest,
  ): Promise<KnowledgeEnrichmentSummary> => request(api => api.cancelExtraction(input)),
  listFacts: (input: KnowledgeListFactsRequest): Promise<KnowledgeFactListResult> =>
    request(api => api.listFacts(input)),
  reviewFact: (input: KnowledgeReviewFactRequest): Promise<KnowledgeFactReviewResult> =>
    request(api => api.reviewFact(input)),
  archiveFact: (input: KnowledgeArchiveFactRequest): Promise<KnowledgeFactArchiveResult> =>
    request(api => api.archiveFact(input)),
  getFactEvidence: (
    input: KnowledgeFactEvidencePageRequest,
  ): Promise<KnowledgeFactEvidencePageResult> => request(api => api.getFactEvidence(input)),
};
