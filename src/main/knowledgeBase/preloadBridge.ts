import { KnowledgeBaseIpc } from '../../shared/knowledgeBase/constants';
import type { KnowledgeBaseRendererApi } from '../../shared/knowledgeBase/types';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

export type KnowledgeBasePreloadBridge = KnowledgeBaseRendererApi;

const invokeMethod = <Method extends keyof KnowledgeBaseRendererApi>(
  invoke: Invoke,
  channel: KnowledgeBaseIpc,
  ...args: Parameters<KnowledgeBaseRendererApi[Method]>
): ReturnType<KnowledgeBaseRendererApi[Method]> =>
  invoke(channel, ...args) as ReturnType<KnowledgeBaseRendererApi[Method]>;

export const createKnowledgeBasePreloadBridge = (
  invoke: Invoke,
): KnowledgeBasePreloadBridge => ({
  selectFiles: () => invokeMethod<'selectFiles'>(invoke, KnowledgeBaseIpc.SelectFiles),
  importSelection: input =>
    invokeMethod<'importSelection'>(invoke, KnowledgeBaseIpc.ImportSelection, input),
  listDocuments: input =>
    invokeMethod<'listDocuments'>(invoke, KnowledgeBaseIpc.ListDocuments, input),
  getDocumentDetails: input =>
    invokeMethod<'getDocumentDetails'>(invoke, KnowledgeBaseIpc.GetDocumentDetails, input),
  deleteDocument: input =>
    invokeMethod<'deleteDocument'>(invoke, KnowledgeBaseIpc.DeleteDocument, input),
  restoreDocument: input =>
    invokeMethod<'restoreDocument'>(invoke, KnowledgeBaseIpc.RestoreDocument, input),
  retryDocument: input =>
    invokeMethod<'retryDocument'>(invoke, KnowledgeBaseIpc.RetryDocument, input),
  retryLocalIndex: input =>
    invokeMethod<'retryLocalIndex'>(invoke, KnowledgeBaseIpc.RetryLocalIndex, input),
  prepareExtractionAuthorization: input =>
    invokeMethod<'prepareExtractionAuthorization'>(
      invoke,
      KnowledgeBaseIpc.PrepareExtractionAuthorization,
      input,
    ),
  requestExtraction: input =>
    invokeMethod<'requestExtraction'>(invoke, KnowledgeBaseIpc.RequestExtraction, input),
  retryExtraction: input =>
    invokeMethod<'retryExtraction'>(invoke, KnowledgeBaseIpc.RetryExtraction, input),
  cancelExtraction: input =>
    invokeMethod<'cancelExtraction'>(invoke, KnowledgeBaseIpc.CancelExtraction, input),
  listFacts: input => invokeMethod<'listFacts'>(invoke, KnowledgeBaseIpc.ListFacts, input),
  reviewFact: input => invokeMethod<'reviewFact'>(invoke, KnowledgeBaseIpc.ReviewFact, input),
  archiveFact: input => invokeMethod<'archiveFact'>(invoke, KnowledgeBaseIpc.ArchiveFact, input),
  getFactEvidence: input =>
    invokeMethod<'getFactEvidence'>(invoke, KnowledgeBaseIpc.GetFactEvidence, input),
  startBatchReview: input =>
    invokeMethod<'startBatchReview'>(invoke, KnowledgeBaseIpc.StartBatchReview, input),
  getBatchReviewStatus: input =>
    invokeMethod<'getBatchReviewStatus'>(invoke, KnowledgeBaseIpc.GetBatchReviewStatus, input),
  retryBatchReview: input =>
    invokeMethod<'retryBatchReview'>(invoke, KnowledgeBaseIpc.RetryBatchReview, input),
});
