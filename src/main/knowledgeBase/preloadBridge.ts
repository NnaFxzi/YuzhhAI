import { KnowledgeBaseIpc } from '../../shared/knowledgeBase/constants';
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
} from '../../shared/knowledgeBase/types';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

export interface KnowledgeBasePreloadBridge {
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
}

export const createKnowledgeBasePreloadBridge = (
  invoke: Invoke,
): KnowledgeBasePreloadBridge => ({
  selectFiles: () =>
    invoke(KnowledgeBaseIpc.SelectFiles) as Promise<
      KnowledgeBaseIpcResult<KnowledgeFileSelection | null>
    >,
  importSelection: input =>
    invoke(KnowledgeBaseIpc.ImportSelection, input) as Promise<
      KnowledgeBaseIpcResult<KnowledgeImportBatchResult>
    >,
  listDocuments: input =>
    invoke(KnowledgeBaseIpc.ListDocuments, input) as Promise<
      KnowledgeBaseIpcResult<KnowledgeDocumentListItem[]>
    >,
  getDocumentDetails: input =>
    invoke(KnowledgeBaseIpc.GetDocumentDetails, input) as Promise<
      KnowledgeBaseIpcResult<KnowledgeDocumentDetails>
    >,
  deleteDocument: input =>
    invoke(KnowledgeBaseIpc.DeleteDocument, input) as Promise<
      KnowledgeBaseIpcResult<KnowledgeDocumentListItem>
    >,
  restoreDocument: input =>
    invoke(KnowledgeBaseIpc.RestoreDocument, input) as Promise<
      KnowledgeBaseIpcResult<KnowledgeDocumentListItem>
    >,
  retryDocument: input =>
    invoke(KnowledgeBaseIpc.RetryDocument, input) as Promise<
      KnowledgeBaseIpcResult<KnowledgeDocumentListItem>
    >,
});
