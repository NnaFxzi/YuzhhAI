import { types as nodeUtilTypes } from 'node:util';

import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';

import {
  KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT,
  KNOWLEDGE_FACT_LIST_MAX_LIMIT,
  KNOWLEDGE_MAX_SELECTION_FILES,
  KnowledgeBaseErrorCode as KnowledgeBaseErrorCodes,
  KnowledgeBaseIpc,
  KnowledgeDocumentVisibility,
  KnowledgeFactArchiveProjectionDecision,
  KnowledgeFactEvidenceState,
  KnowledgeFactListView,
  KnowledgeFactReviewDecision,
  KnowledgeFactReviewStatus,
} from '../../shared/knowledgeBase/constants';
import type {
  KnowledgeArchiveFactRequest,
  KnowledgeBaseIpcError,
  KnowledgeBaseIpcResult,
  KnowledgeCancelExtractionRequest,
  KnowledgeDocumentDetailsRequest,
  KnowledgeDocumentRevisionRequest,
  KnowledgeFactEvidencePageRequest,
  KnowledgeImportSelectionRequest,
  KnowledgeListDocumentsRequest,
  KnowledgeListFactsRequest,
  KnowledgePrepareExtractionAuthorizationRequest,
  KnowledgeRequestExtractionRequest,
  KnowledgeRetryDocumentRequest,
  KnowledgeRetryExtractionRequest,
  KnowledgeRetryLocalIndexRequest,
  KnowledgeReviewFactRequest,
} from '../../shared/knowledgeBase/types';
import {
  KnowledgeFactProjectionConflictError,
  KnowledgeFactProjectorError,
} from './enterpriseLeadKnowledgeFactProjector';
import type { KnowledgeBaseFoundation } from './knowledgeBaseFoundation';
import {
  KnowledgeDocumentService,
  KnowledgeDocumentServiceError,
} from './knowledgeDocumentService';
import {
  KnowledgeEnrichmentRequestStateError,
  KnowledgeEnrichmentRevisionConflictError,
} from './knowledgeEnrichmentRequestStore';
import { KnowledgeExtractionAuthorizationError } from './knowledgeExtractionAuthorizationStore';
import { KnowledgeFactStateError } from './knowledgeFactStore';
import type { SelectedKnowledgeFileInput } from './knowledgeSelectionTokenStore';
import {
  KnowledgeSelectionTokenError,
  KnowledgeSelectionTokenStore,
} from './knowledgeSelectionTokenStore';

type KnowledgeDocumentServiceApi = Pick<
  KnowledgeDocumentService,
  | 'deleteDocument'
  | 'getDocumentDetails'
  | 'importSelection'
  | 'listDocuments'
  | 'restoreDocument'
  | 'retryDocument'
  | 'retryLocalIndex'
>;

export interface KnowledgeBaseHandlerDeps {
  foundation: Pick<
    KnowledgeBaseFoundation,
    | 'authorizationStore'
    | 'documentService'
    | 'enrichmentService'
    | 'factProjector'
    | 'factQueryService'
    | 'selectionTokenStore'
    | 'whenReady'
  > & {
    documentService: KnowledgeDocumentServiceApi;
    selectionTokenStore: KnowledgeSelectionTokenStore;
  };
  showOpenDialog: (
    event: IpcMainInvokeEvent,
  ) => Promise<{ canceled: boolean; filePaths: string[] }>;
  statSelectedFile: (absolutePath: string) => Promise<SelectedKnowledgeFileInput>;
}

const invalidRequest = (): never => {
  throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.InvalidRequest);
};

const requireRecord = (
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> => {
  try {
    if (
      !value
      || typeof value !== 'object'
      || nodeUtilTypes.isProxy(value)
      || Array.isArray(value)
    ) {
      return invalidRequest();
    }
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidRequest();
    }
    const input: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !allowedKeys.includes(key)) {
        return invalidRequest();
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        return invalidRequest();
      }
      input[key] = descriptor.value;
    }
    return input;
  } catch {
    return invalidRequest();
  }
};

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const requireString = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.InvalidRequest);
  }
  return value.trim();
};

const requireRevision = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return invalidRequest();
  }
  return value;
};

const requireLimit = (value: unknown, maximum: number): number => {
  const limit = requireRevision(value);
  if (limit > maximum) {
    return invalidRequest();
  }
  return limit;
};

const requireDenseOwnDataArray = <T>(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
  readItem: (item: unknown) => T,
): T[] => {
  try {
    if (
      !value
      || typeof value !== 'object'
      || nodeUtilTypes.isProxy(value)
      || !Array.isArray(value)
      || Reflect.getPrototypeOf(value) !== Array.prototype
    ) {
      return invalidRequest();
    }
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
    if (
      !lengthDescriptor
      || lengthDescriptor.enumerable
      || !('value' in lengthDescriptor)
      || typeof lengthDescriptor.value !== 'number'
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < minimumLength
      || lengthDescriptor.value > maximumLength
    ) {
      return invalidRequest();
    }
    const length = lengthDescriptor.value;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || !keys.includes('length')) {
      return invalidRequest();
    }
    const result: T[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        return invalidRequest();
      }
      result.push(readItem(descriptor.value));
    }
    return result;
  } catch {
    return invalidRequest();
  }
};

const readItemIds = (value: unknown): string[] => {
  const itemIds = requireDenseOwnDataArray(
    value,
    1,
    KNOWLEDGE_MAX_SELECTION_FILES,
    requireString,
  );
  if (new Set(itemIds).size !== itemIds.length) {
    return invalidRequest();
  }
  return itemIds;
};

const requireFactListView = (value: unknown): KnowledgeFactListView => {
  if (value !== KnowledgeFactListView.Active && value !== KnowledgeFactListView.History) {
    return invalidRequest();
  }
  return value;
};

const requireFactEvidenceState = (value: unknown): KnowledgeFactEvidenceState => {
  if (
    value !== KnowledgeFactEvidenceState.Active
    && value !== KnowledgeFactEvidenceState.Stale
    && value !== KnowledgeFactEvidenceState.Any
  ) {
    return invalidRequest();
  }
  return value;
};

const requireFactReviewStatus = (value: unknown): KnowledgeFactReviewStatus => {
  if (
    value !== KnowledgeFactReviewStatus.Pending
    && value !== KnowledgeFactReviewStatus.Confirmed
    && value !== KnowledgeFactReviewStatus.Rejected
  ) {
    return invalidRequest();
  }
  return value;
};

const requireFactReviewStatuses = (value: unknown): KnowledgeFactReviewStatus[] => {
  const statuses = requireDenseOwnDataArray(value, 0, 3, requireFactReviewStatus);
  if (new Set(statuses).size !== statuses.length) {
    return invalidRequest();
  }
  return statuses;
};

const requireBoolean = (value: unknown): boolean => {
  if (typeof value !== 'boolean') {
    return invalidRequest();
  }
  return value;
};

const readImportInput = (
  event: IpcMainInvokeEvent,
  value: unknown,
): KnowledgeImportSelectionRequest & { ownerId: number } => {
  const input = requireRecord(value, ['workspaceId', 'selectionToken', 'itemIds']);
  const itemIds = hasOwn(input, 'itemIds') ? readItemIds(input.itemIds) : undefined;
  return {
    ownerId: event.sender.id,
    workspaceId: requireString(input.workspaceId),
    selectionToken: requireString(input.selectionToken),
    ...(itemIds === undefined ? {} : { itemIds }),
  };
};

const readListInput = (value: unknown): KnowledgeListDocumentsRequest => {
  const input = requireRecord(value, ['workspaceId', 'visibility']);
  if (
    input.visibility !== KnowledgeDocumentVisibility.Active &&
    input.visibility !== KnowledgeDocumentVisibility.Deleted
  ) {
    throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.InvalidRequest);
  }
  return {
    workspaceId: requireString(input.workspaceId),
    visibility: input.visibility,
  };
};

const readDetailsInput = (value: unknown): KnowledgeDocumentDetailsRequest => {
  const input = requireRecord(value, ['documentId']);
  return { documentId: requireString(input.documentId) };
};

const readRevisionInput = (value: unknown): KnowledgeDocumentRevisionRequest => {
  const input = requireRecord(value, ['documentId', 'expectedRevision']);
  return {
    documentId: requireString(input.documentId),
    expectedRevision: requireRevision(input.expectedRevision),
  };
};

const readRetryInput = (value: unknown): KnowledgeRetryDocumentRequest => {
  const input = requireRecord(value, ['documentId', 'documentVersionId']);
  return {
    documentId: requireString(input.documentId),
    documentVersionId: requireString(input.documentVersionId),
  };
};

const readRetryLocalIndexInput = (value: unknown): KnowledgeRetryLocalIndexRequest => {
  const input = requireRecord(value, ['documentId', 'documentVersionId']);
  return {
    documentId: requireString(input.documentId),
    documentVersionId: requireString(input.documentVersionId),
  };
};

const readPrepareExtractionInput = (
  value: unknown,
): KnowledgePrepareExtractionAuthorizationRequest => {
  const input = requireRecord(value, ['documentId', 'documentVersionId']);
  return {
    documentId: requireString(input.documentId),
    documentVersionId: requireString(input.documentVersionId),
  };
};

const readRequestExtractionInput = (value: unknown): KnowledgeRequestExtractionRequest => {
  const input = requireRecord(value, ['authorizationToken']);
  return { authorizationToken: requireString(input.authorizationToken) };
};

const readRetryExtractionInput = (value: unknown): KnowledgeRetryExtractionRequest => {
  const input = requireRecord(value, ['requestId', 'authorizationToken']);
  return {
    requestId: requireString(input.requestId),
    authorizationToken: requireString(input.authorizationToken),
  };
};

const readCancelExtractionInput = (value: unknown): KnowledgeCancelExtractionRequest => {
  const input = requireRecord(value, ['requestId', 'expectedRevision']);
  return {
    requestId: requireString(input.requestId),
    expectedRevision: requireRevision(input.expectedRevision),
  };
};

const readListFactsInput = (value: unknown): KnowledgeListFactsRequest => {
  const input = requireRecord(value, [
    'workspaceId',
    'view',
    'reviewStatuses',
    'evidenceState',
    'cursor',
    'limit',
  ]);
  const view = hasOwn(input, 'view') ? requireFactListView(input.view) : undefined;
  const reviewStatuses = hasOwn(input, 'reviewStatuses')
    ? requireFactReviewStatuses(input.reviewStatuses)
    : undefined;
  const evidenceState = hasOwn(input, 'evidenceState')
    ? requireFactEvidenceState(input.evidenceState)
    : undefined;
  const cursor = hasOwn(input, 'cursor') ? requireString(input.cursor) : undefined;
  const limit = hasOwn(input, 'limit')
    ? requireLimit(input.limit, KNOWLEDGE_FACT_LIST_MAX_LIMIT)
    : undefined;
  return {
    workspaceId: requireString(input.workspaceId),
    ...(view === undefined ? {} : { view }),
    ...(reviewStatuses === undefined ? {} : { reviewStatuses }),
    ...(evidenceState === undefined ? {} : { evidenceState }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit }),
  };
};

const readReviewFactInput = (value: unknown): KnowledgeReviewFactRequest => {
  const input = requireRecord(value, [
    'factId',
    'expectedRevision',
    'decision',
    'replaceExisting',
    'expectedFieldRevision',
  ]);
  if (
    input.decision !== KnowledgeFactReviewDecision.Confirm
    && input.decision !== KnowledgeFactReviewDecision.Reject
  ) {
    return invalidRequest();
  }
  const base = {
    factId: requireString(input.factId),
    expectedRevision: requireRevision(input.expectedRevision),
    decision: input.decision,
  };
  const hasReplacement = hasOwn(input, 'replaceExisting');
  const hasFieldRevision = hasOwn(input, 'expectedFieldRevision');
  if (input.decision === KnowledgeFactReviewDecision.Reject) {
    if (hasReplacement || hasFieldRevision) {
      return invalidRequest();
    }
    return base;
  }
  if (!hasReplacement) {
    if (hasFieldRevision) {
      return invalidRequest();
    }
    return base;
  }
  const replaceExisting = requireBoolean(input.replaceExisting);
  if (!replaceExisting) {
    if (hasFieldRevision) {
      return invalidRequest();
    }
    return { ...base, replaceExisting };
  }
  if (!hasFieldRevision) {
    return invalidRequest();
  }
  return {
    ...base,
    replaceExisting,
    expectedFieldRevision: requireRevision(input.expectedFieldRevision),
  };
};

const readArchiveFactInput = (value: unknown): KnowledgeArchiveFactRequest => {
  const input = requireRecord(value, [
    'factId',
    'expectedRevision',
    'projectionDecision',
    'expectedFieldRevision',
  ]);
  const base = {
    factId: requireString(input.factId),
    expectedRevision: requireRevision(input.expectedRevision),
  };
  const hasProjectionDecision = hasOwn(input, 'projectionDecision');
  const hasFieldRevision = hasOwn(input, 'expectedFieldRevision');
  if (!hasProjectionDecision) {
    if (hasFieldRevision) {
      return invalidRequest();
    }
    return base;
  }
  if (input.projectionDecision === KnowledgeFactArchiveProjectionDecision.KeepCurrent) {
    if (hasFieldRevision) {
      return invalidRequest();
    }
    return { ...base, projectionDecision: input.projectionDecision };
  }
  if (input.projectionDecision !== KnowledgeFactArchiveProjectionDecision.RemoveCurrent) {
    return invalidRequest();
  }
  if (!hasFieldRevision) {
    return invalidRequest();
  }
  return {
    ...base,
    projectionDecision: input.projectionDecision,
    expectedFieldRevision: requireRevision(input.expectedFieldRevision),
  };
};

const readFactEvidenceInput = (value: unknown): KnowledgeFactEvidencePageRequest => {
  const input = requireRecord(value, [
    'factId',
    'expectedRevision',
    'cursor',
    'limit',
  ]);
  const cursor = hasOwn(input, 'cursor') ? requireString(input.cursor) : undefined;
  const limit = hasOwn(input, 'limit')
    ? requireLimit(input.limit, KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT)
    : undefined;
  return {
    factId: requireString(input.factId),
    expectedRevision: requireRevision(input.expectedRevision),
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit }),
  };
};

const persistenceFailureIpcError = (): KnowledgeBaseIpcError => {
  console.error('[KnowledgeBase]', { code: 'ipc_operation_failed' });
  return { code: KnowledgeBaseErrorCodes.PersistenceFailed };
};

const toIpcError = (error: unknown): KnowledgeBaseIpcError => {
  try {
    if (error instanceof KnowledgeDocumentServiceError) {
      return {
        code: error.code,
        ...(error.fileName ? { fileName: error.fileName } : {}),
        ...(error.latestDocument ? { latestDocument: error.latestDocument } : {}),
      };
    }
    if (error instanceof KnowledgeSelectionTokenError) {
      return { code: error.code };
    }
    if (error instanceof KnowledgeExtractionAuthorizationError) {
      return { code: error.code };
    }
    if (error instanceof KnowledgeEnrichmentRevisionConflictError) {
      return { code: KnowledgeBaseErrorCodes.RevisionConflict };
    }
    if (error instanceof KnowledgeEnrichmentRequestStateError) {
      return { code: error.code };
    }
    if (error instanceof KnowledgeFactStateError) {
      return { code: error.code };
    }
    if (error instanceof KnowledgeFactProjectionConflictError) {
      return {
        code: KnowledgeBaseErrorCodes.FactProjectionConflict,
        projectionConflict: error.conflict,
      };
    }
    if (error instanceof KnowledgeFactProjectorError) {
      return { code: error.code };
    }
  } catch {
    return persistenceFailureIpcError();
  }
  return persistenceFailureIpcError();
};

export const registerKnowledgeBaseHandlers = (deps: KnowledgeBaseHandlerDeps): void => {
  const ownerCleanupRegistered = new WeakSet<IpcMainInvokeEvent['sender']>();

  const invokeWhenReady = async <T>(
    operation: () => T | Promise<T>,
  ): Promise<KnowledgeBaseIpcResult<T>> => {
    try {
      await deps.foundation.whenReady();
      return { success: true, data: await operation() };
    } catch (error) {
      return { success: false, error: toIpcError(error) };
    }
  };

  const registerOwnerCleanup = (event: IpcMainInvokeEvent): void => {
    const ownerId = event.sender.id;
    if (ownerCleanupRegistered.has(event.sender)) {
      return;
    }
    ownerCleanupRegistered.add(event.sender);
    event.sender.once('destroyed', () => {
      deps.foundation.selectionTokenStore.clearOwner(ownerId);
      deps.foundation.authorizationStore.clearOwner(ownerId);
    });
  };

  const invokeOwnerBoundWhenReady = <T>(
    event: IpcMainInvokeEvent,
    operation: () => T | Promise<T>,
  ): Promise<KnowledgeBaseIpcResult<T>> => {
    registerOwnerCleanup(event);
    return invokeWhenReady(() => {
      if (event.sender.isDestroyed()) {
        throw new KnowledgeExtractionAuthorizationError(
          KnowledgeBaseErrorCodes.InvalidExtractionAuthorization,
        );
      }
      return operation();
    });
  };

  ipcMain.handle(KnowledgeBaseIpc.SelectFiles, async event => {
    registerOwnerCleanup(event);
    return invokeWhenReady(async () => {
      if (event.sender.isDestroyed()) {
        return null;
      }
      const result = await deps.showOpenDialog(event);
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      if (result.filePaths.length > KNOWLEDGE_MAX_SELECTION_FILES) {
        throw new KnowledgeSelectionTokenError(KnowledgeBaseErrorCodes.TooManyFiles);
      }
      if (event.sender.isDestroyed()) {
        return null;
      }
      const selectedFiles = await Promise.all(
        result.filePaths.map(filePath => deps.statSelectedFile(filePath)),
      );
      if (event.sender.isDestroyed()) {
        return null;
      }
      const selection = deps.foundation.selectionTokenStore.issue(event.sender.id, selectedFiles);
      return selection;
    });
  });

  ipcMain.handle(KnowledgeBaseIpc.ImportSelection, async (event, input: unknown) =>
    invokeWhenReady(() => deps.foundation.documentService.importSelection(readImportInput(event, input))),
  );
  ipcMain.handle(KnowledgeBaseIpc.ListDocuments, async (_event, input: unknown) =>
    invokeWhenReady(() => deps.foundation.documentService.listDocuments(readListInput(input))),
  );
  ipcMain.handle(KnowledgeBaseIpc.GetDocumentDetails, async (_event, input: unknown) =>
    invokeWhenReady(() => deps.foundation.documentService.getDocumentDetails(readDetailsInput(input))),
  );
  ipcMain.handle(KnowledgeBaseIpc.DeleteDocument, async (_event, input: unknown) =>
    invokeWhenReady(() => deps.foundation.documentService.deleteDocument(readRevisionInput(input))),
  );
  ipcMain.handle(KnowledgeBaseIpc.RestoreDocument, async (_event, input: unknown) =>
    invokeWhenReady(() => deps.foundation.documentService.restoreDocument(readRevisionInput(input))),
  );
  ipcMain.handle(KnowledgeBaseIpc.RetryDocument, async (_event, input: unknown) =>
    invokeWhenReady(() => deps.foundation.documentService.retryDocument(readRetryInput(input))),
  );
  ipcMain.handle(KnowledgeBaseIpc.RetryLocalIndex, async (_event, input: unknown) =>
    invokeWhenReady(() => deps.foundation.documentService.retryLocalIndex(
      readRetryLocalIndexInput(input),
    )),
  );
  ipcMain.handle(KnowledgeBaseIpc.PrepareExtractionAuthorization, async (event, input: unknown) =>
    invokeOwnerBoundWhenReady(event, () => {
      const request = readPrepareExtractionInput(input);
      return deps.foundation.enrichmentService.prepareExtractionAuthorization({
        ownerId: event.sender.id,
        ...request,
      });
    }),
  );
  ipcMain.handle(KnowledgeBaseIpc.RequestExtraction, async (event, input: unknown) =>
    invokeOwnerBoundWhenReady(event, () => {
      const request = readRequestExtractionInput(input);
      return deps.foundation.enrichmentService.requestExtraction({
        ownerId: event.sender.id,
        ...request,
      });
    }),
  );
  ipcMain.handle(KnowledgeBaseIpc.RetryExtraction, async (event, input: unknown) =>
    invokeOwnerBoundWhenReady(event, () => {
      const request = readRetryExtractionInput(input);
      return deps.foundation.enrichmentService.retryExtraction({
        ownerId: event.sender.id,
        ...request,
      });
    }),
  );
  ipcMain.handle(KnowledgeBaseIpc.CancelExtraction, async (_event, input: unknown) =>
    invokeWhenReady(() => deps.foundation.enrichmentService.cancelExtraction(
      readCancelExtractionInput(input),
    )),
  );
  ipcMain.handle(KnowledgeBaseIpc.ListFacts, async (_event, input: unknown) =>
    invokeWhenReady(() => deps.foundation.factQueryService.listFacts(readListFactsInput(input))),
  );
  ipcMain.handle(KnowledgeBaseIpc.ReviewFact, async (_event, input: unknown) =>
    invokeWhenReady(() => {
      const request = readReviewFactInput(input);
      if (request.decision === KnowledgeFactReviewDecision.Confirm) {
        const { decision: _decision, ...confirmInput } = request;
        return deps.foundation.factProjector.confirmFact(confirmInput);
      }
      return deps.foundation.factProjector.rejectFact({
        factId: request.factId,
        expectedRevision: request.expectedRevision,
      });
    }),
  );
  ipcMain.handle(KnowledgeBaseIpc.ArchiveFact, async (_event, input: unknown) =>
    invokeWhenReady(() => deps.foundation.factProjector.archiveFact(readArchiveFactInput(input))),
  );
  ipcMain.handle(KnowledgeBaseIpc.GetFactEvidence, async (_event, input: unknown) =>
    invokeWhenReady(() => deps.foundation.factQueryService.getFactEvidence(
      readFactEvidenceInput(input),
    )),
  );
};
