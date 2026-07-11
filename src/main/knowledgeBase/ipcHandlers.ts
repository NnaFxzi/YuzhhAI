import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';

import {
  KNOWLEDGE_MAX_SELECTION_FILES,
  KnowledgeBaseErrorCode as KnowledgeBaseErrorCodes,
  KnowledgeBaseIpc,
  KnowledgeDocumentVisibility,
} from '../../shared/knowledgeBase/constants';
import type {
  KnowledgeBaseIpcError,
  KnowledgeBaseIpcResult,
  KnowledgeDocumentDetailsRequest,
  KnowledgeDocumentRevisionRequest,
  KnowledgeImportSelectionRequest,
  KnowledgeListDocumentsRequest,
  KnowledgeRetryDocumentRequest,
} from '../../shared/knowledgeBase/types';
import {
  KnowledgeDocumentService,
  KnowledgeDocumentServiceError,
} from './knowledgeDocumentService';
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
>;

export interface KnowledgeBaseHandlerDeps {
  documentService: KnowledgeDocumentServiceApi;
  selectionTokenStore: KnowledgeSelectionTokenStore;
  showOpenDialog: (
    event: IpcMainInvokeEvent,
  ) => Promise<{ canceled: boolean; filePaths: string[] }>;
  statSelectedFile: (absolutePath: string) => Promise<SelectedKnowledgeFileInput>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const requireString = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.InvalidRequest);
  }
  return value.trim();
};

const requireRevision = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.InvalidRequest);
  }
  return value;
};

const readOptionalItemIds = (value: unknown): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > KNOWLEDGE_MAX_SELECTION_FILES) {
    throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.InvalidRequest);
  }
  const itemIds = Array.from(value, itemId => requireString(itemId));
  if (new Set(itemIds).size !== itemIds.length) {
    throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.InvalidRequest);
  }
  return itemIds;
};

const readImportInput = (
  event: IpcMainInvokeEvent,
  value: unknown,
): KnowledgeImportSelectionRequest & { ownerId: number } => {
  if (!isRecord(value)) {
    throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.InvalidRequest);
  }
  return {
    ownerId: event.sender.id,
    workspaceId: requireString(value.workspaceId),
    selectionToken: requireString(value.selectionToken),
    ...(value.itemIds === undefined ? {} : { itemIds: readOptionalItemIds(value.itemIds) }),
  };
};

const readListInput = (value: unknown): KnowledgeListDocumentsRequest => {
  if (!isRecord(value)) {
    throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.InvalidRequest);
  }
  if (
    value.visibility !== KnowledgeDocumentVisibility.Active &&
    value.visibility !== KnowledgeDocumentVisibility.Deleted
  ) {
    throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.InvalidRequest);
  }
  return {
    workspaceId: requireString(value.workspaceId),
    visibility: value.visibility,
  };
};

const readDetailsInput = (value: unknown): KnowledgeDocumentDetailsRequest => {
  if (!isRecord(value)) {
    throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.InvalidRequest);
  }
  return { documentId: requireString(value.documentId) };
};

const readRevisionInput = (value: unknown): KnowledgeDocumentRevisionRequest => {
  if (!isRecord(value)) {
    throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.InvalidRequest);
  }
  return {
    documentId: requireString(value.documentId),
    expectedRevision: requireRevision(value.expectedRevision),
  };
};

const readRetryInput = (value: unknown): KnowledgeRetryDocumentRequest => {
  if (!isRecord(value)) {
    throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.InvalidRequest);
  }
  return {
    documentId: requireString(value.documentId),
    documentVersionId: requireString(value.documentVersionId),
  };
};

const toIpcError = (error: unknown): KnowledgeBaseIpcError => {
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
  return { code: KnowledgeBaseErrorCodes.PersistenceFailed };
};

const invokeSafely = async <T>(
  operation: () => T | Promise<T>,
): Promise<KnowledgeBaseIpcResult<T>> => {
  try {
    return { success: true, data: await operation() };
  } catch (error) {
    return { success: false, error: toIpcError(error) };
  }
};

export const registerKnowledgeBaseHandlers = (deps: KnowledgeBaseHandlerDeps): void => {
  const ownerCleanupRegistered = new Set<number>();

  const registerOwnerCleanup = (event: IpcMainInvokeEvent): void => {
    const ownerId = event.sender.id;
    if (ownerCleanupRegistered.has(ownerId)) {
      return;
    }
    ownerCleanupRegistered.add(ownerId);
    event.sender.once('destroyed', () => {
      deps.selectionTokenStore.clearOwner(ownerId);
      ownerCleanupRegistered.delete(ownerId);
    });
  };

  ipcMain.handle(KnowledgeBaseIpc.SelectFiles, async event =>
    invokeSafely(async () => {
      registerOwnerCleanup(event);
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
      const selection = deps.selectionTokenStore.issue(event.sender.id, selectedFiles);
      return selection;
    }),
  );

  ipcMain.handle(KnowledgeBaseIpc.ImportSelection, async (event, input: unknown) =>
    invokeSafely(() => deps.documentService.importSelection(readImportInput(event, input))),
  );
  ipcMain.handle(KnowledgeBaseIpc.ListDocuments, async (_event, input: unknown) =>
    invokeSafely(() => deps.documentService.listDocuments(readListInput(input))),
  );
  ipcMain.handle(KnowledgeBaseIpc.GetDocumentDetails, async (_event, input: unknown) =>
    invokeSafely(() => deps.documentService.getDocumentDetails(readDetailsInput(input))),
  );
  ipcMain.handle(KnowledgeBaseIpc.DeleteDocument, async (_event, input: unknown) =>
    invokeSafely(() => deps.documentService.deleteDocument(readRevisionInput(input))),
  );
  ipcMain.handle(KnowledgeBaseIpc.RestoreDocument, async (_event, input: unknown) =>
    invokeSafely(() => deps.documentService.restoreDocument(readRevisionInput(input))),
  );
  ipcMain.handle(KnowledgeBaseIpc.RetryDocument, async (_event, input: unknown) =>
    invokeSafely(() => deps.documentService.retryDocument(readRetryInput(input))),
  );
};
