import {
  type KnowledgeBaseErrorCode,
  KnowledgeBaseErrorCode as KnowledgeBaseErrorCodes,
  type KnowledgeDocumentVisibility,
} from '../../shared/knowledgeBase/constants';
import type {
  KnowledgeBaseIpcResult,
  KnowledgeDocumentDetails,
  KnowledgeDocumentDetailsRequest,
  KnowledgeDocumentListItem,
  KnowledgeDocumentRevisionRequest,
  KnowledgeFileSelection,
  KnowledgeImportBatchResult,
  KnowledgeImportSelectionRequest,
  KnowledgeListDocumentsRequest,
  KnowledgeRetryDocumentRequest,
  KnowledgeRetryLocalIndexRequest,
} from '../../shared/knowledgeBase/types';

interface KnowledgeBaseApi {
  selectFiles: () => Promise<KnowledgeBaseIpcResult<KnowledgeFileSelection | null>>;
  importSelection: (
    input: KnowledgeImportSelectionRequest,
  ) => Promise<KnowledgeBaseIpcResult<KnowledgeImportBatchResult>>;
  listDocuments: (
    input: KnowledgeListDocumentsRequest,
  ) => Promise<KnowledgeBaseIpcResult<KnowledgeDocumentListItem[]>>;
  getDocumentDetails: (
    input: KnowledgeDocumentDetailsRequest,
  ) => Promise<KnowledgeBaseIpcResult<KnowledgeDocumentDetails>>;
  deleteDocument: (
    input: KnowledgeDocumentRevisionRequest,
  ) => Promise<KnowledgeBaseIpcResult<KnowledgeDocumentListItem>>;
  restoreDocument: (
    input: KnowledgeDocumentRevisionRequest,
  ) => Promise<KnowledgeBaseIpcResult<KnowledgeDocumentListItem>>;
  retryDocument: (
    input: KnowledgeRetryDocumentRequest,
  ) => Promise<KnowledgeBaseIpcResult<KnowledgeDocumentListItem>>;
  retryLocalIndex: (
    input: KnowledgeRetryLocalIndexRequest,
  ) => Promise<KnowledgeBaseIpcResult<KnowledgeDocumentListItem>>;
}

export class KnowledgeBaseServiceError extends Error {
  readonly fileName?: string;

  readonly latestDocument?: KnowledgeDocumentListItem;

  constructor(
    readonly code: KnowledgeBaseErrorCode,
    options: {
      fileName?: string;
      latestDocument?: KnowledgeDocumentListItem;
    } = {},
  ) {
    super(code);
    this.name = 'KnowledgeBaseServiceError';
    this.fileName = options.fileName;
    this.latestDocument = options.latestDocument;
  }
}

const getApi = (): KnowledgeBaseApi | null => {
  const electron = window.electron as typeof window.electron & { knowledgeBase?: KnowledgeBaseApi };
  return electron?.knowledgeBase ?? null;
};

const request = async <T>(
  invoke: (api: KnowledgeBaseApi) => Promise<KnowledgeBaseIpcResult<T>>,
): Promise<T> => {
  const api = getApi();
  if (!api) {
    throw new KnowledgeBaseServiceError(KnowledgeBaseErrorCodes.PersistenceFailed);
  }
  const result = await invoke(api);
  if (result.success) {
    return result.data;
  }
  throw new KnowledgeBaseServiceError(result.error.code, {
    fileName: result.error.fileName,
    latestDocument: result.error.latestDocument,
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
};
