import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  KnowledgeBaseErrorCode,
  KnowledgeBaseIpc,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeDocumentVisibility,
} from '../../shared/knowledgeBase/constants';
import type { KnowledgeDocumentListItem } from '../../shared/knowledgeBase/types';
import { type KnowledgeBaseHandlerDeps, registerKnowledgeBaseHandlers } from './ipcHandlers';
import { KnowledgeDocumentServiceError } from './knowledgeDocumentService';
import { KnowledgeSelectionTokenStore } from './knowledgeSelectionTokenStore';

const { registeredHandlers } = vi.hoisted(() => ({
  registeredHandlers: new Map<string, (...args: any[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

const documentItem = (): KnowledgeDocumentListItem => ({
  id: 'document-1',
  displayName: 'manual.pdf',
  sourceMode: KnowledgeDocumentSourceMode.Managed,
  currentVersionId: 'version-1',
  revision: 2,
  status: KnowledgeDocumentStatus.Ready,
  fileSize: 100,
  mimeType: 'application/pdf',
  contentHash: 'a'.repeat(64),
  currentJob: null,
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  deletedAt: null,
});

const createEvent = (senderId = 7) => {
  const destroyedListeners: Array<() => void> = [];
  let destroyed = false;
  return {
    event: {
      sender: {
        id: senderId,
        isDestroyed: vi.fn(() => destroyed),
        once: vi.fn((eventName: string, listener: () => void) => {
          if (eventName === 'destroyed') destroyedListeners.push(listener);
        }),
      },
    },
    destroy: () => {
      destroyed = true;
      destroyedListeners.forEach(listener => listener());
    },
  };
};

const makeDeps = (): {
  deps: KnowledgeBaseHandlerDeps;
  documentService: KnowledgeBaseHandlerDeps['documentService'];
  selectionTokenStore: KnowledgeSelectionTokenStore;
} => {
  const selectionTokenStore = new KnowledgeSelectionTokenStore({ now: () => 1_000 });
  const documentService: KnowledgeBaseHandlerDeps['documentService'] = {
    importSelection: vi.fn(async () => ({ importedCount: 0, failedCount: 0, items: [] })),
    listDocuments: vi.fn(() => [documentItem()]),
    getDocumentDetails: vi.fn(),
    deleteDocument: vi.fn(() => documentItem()),
    restoreDocument: vi.fn(() => documentItem()),
    retryDocument: vi.fn(() => documentItem()),
  };
  return {
    deps: {
      documentService,
      selectionTokenStore,
      showOpenDialog: vi.fn(async () => ({
        canceled: false,
        filePaths: ['/private/customer/manual.pdf'],
      })),
      statSelectedFile: vi.fn(async absolutePath => ({
        absolutePath,
        displayName: 'manual.pdf',
        fileSize: 100,
        sourceMtime: 200,
      })),
    },
    documentService,
    selectionTokenStore,
  };
};

beforeEach(() => {
  registeredHandlers.clear();
});

describe('registerKnowledgeBaseHandlers', () => {
  test('selects files in main, binds the token to sender id, and returns no paths', async () => {
    const { deps, selectionTokenStore } = makeDeps();
    registerKnowledgeBaseHandlers(deps);
    const sender = createEvent(7);

    const result = await registeredHandlers.get(KnowledgeBaseIpc.SelectFiles)?.(sender.event);

    expect(result).toMatchObject({
      success: true,
      data: {
        selectionToken: expect.any(String),
        files: [{ displayName: 'manual.pdf', fileSize: 100, itemId: expect.any(String) }],
      },
    });
    expect(JSON.stringify(result)).not.toContain('/private/customer');
    const selectionToken = (result as any).data.selectionToken as string;
    expect(selectionTokenStore.consume(selectionToken, 7)[0]?.absolutePath).toBe(
      '/private/customer/manual.pdf',
    );
  });

  test('clears owner tokens when the sending WebContents is destroyed', async () => {
    const { deps, selectionTokenStore } = makeDeps();
    registerKnowledgeBaseHandlers(deps);
    const sender = createEvent(7);
    const result = await registeredHandlers.get(KnowledgeBaseIpc.SelectFiles)?.(sender.event);
    const selectionToken = (result as any).data.selectionToken as string;

    sender.destroy();

    expect(() => selectionTokenStore.consume(selectionToken, 7)).toThrowError(
      expect.objectContaining({ code: KnowledgeBaseErrorCode.InvalidSelectionToken }),
    );
  });

  test('does not issue a token when WebContents is destroyed during file inspection', async () => {
    const { deps } = makeDeps();
    let resolveStat!: (value: {
      absolutePath: string;
      displayName: string;
      fileSize: number;
      sourceMtime: number;
    }) => void;
    deps.statSelectedFile = vi.fn(
      absolutePath =>
        new Promise(resolve => {
          resolveStat = value => resolve({ ...value, absolutePath });
        }),
    );
    registerKnowledgeBaseHandlers(deps);
    const sender = createEvent(7);

    const resultPromise = registeredHandlers.get(KnowledgeBaseIpc.SelectFiles)?.(sender.event);
    await vi.waitFor(() => expect(deps.statSelectedFile).toHaveBeenCalledTimes(1));
    sender.destroy();
    resolveStat({
      absolutePath: '',
      displayName: 'manual.pdf',
      fileSize: 100,
      sourceMtime: 200,
    });

    await expect(resultPromise).resolves.toEqual({ success: true, data: null });
  });

  test('returns a successful null selection when the picker is cancelled', async () => {
    const { deps } = makeDeps();
    deps.showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: [] }));
    registerKnowledgeBaseHandlers(deps);

    const result = await registeredHandlers.get(KnowledgeBaseIpc.SelectFiles)?.(
      createEvent().event,
    );

    expect(result).toEqual({ success: true, data: null });
  });

  test('rejects oversized picker batches before statting any selected path', async () => {
    const { deps } = makeDeps();
    deps.showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: Array.from({ length: 101 }, (_, index) => `/private/file-${index}.txt`),
    }));
    registerKnowledgeBaseHandlers(deps);

    const result = await registeredHandlers.get(KnowledgeBaseIpc.SelectFiles)?.(
      createEvent().event,
    );

    expect(result).toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.TooManyFiles },
    });
    expect(deps.statSelectedFile).not.toHaveBeenCalled();
  });

  test('passes sender ownership and selected item ids into import', async () => {
    const { deps, documentService } = makeDeps();
    registerKnowledgeBaseHandlers(deps);
    const sender = createEvent(9);

    await registeredHandlers.get(KnowledgeBaseIpc.ImportSelection)?.(sender.event, {
      workspaceId: 'workspace-a',
      selectionToken: 'selection-a',
      itemIds: ['item-b'],
    });
    await registeredHandlers.get(KnowledgeBaseIpc.ListDocuments)?.(sender.event, {
      workspaceId: 'workspace-a',
      visibility: KnowledgeDocumentVisibility.Deleted,
    });

    expect(documentService.importSelection).toHaveBeenCalledWith({
      ownerId: 9,
      workspaceId: 'workspace-a',
      selectionToken: 'selection-a',
      itemIds: ['item-b'],
    });
    expect(documentService.listDocuments).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      visibility: KnowledgeDocumentVisibility.Deleted,
    });
  });

  test.each([
    { name: 'empty', itemIds: [] },
    { name: 'blank', itemIds: [''] },
    { name: 'duplicate', itemIds: ['item-a', 'item-a'] },
    { name: 'non-string', itemIds: [7] },
  ])('rejects $name import item ids with a stable code', async ({ itemIds }) => {
    const { deps, documentService } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    const result = await registeredHandlers.get(KnowledgeBaseIpc.ImportSelection)?.(
      createEvent().event,
      {
        workspaceId: 'workspace-a',
        selectionToken: 'selection-a',
        itemIds,
      },
    );

    expect(documentService.importSelection).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.InvalidRequest },
    });
  });

  test('rejects sparse import item ids with a stable code', async () => {
    const { deps, documentService } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    const result = await registeredHandlers.get(KnowledgeBaseIpc.ImportSelection)?.(
      createEvent().event,
      {
        workspaceId: 'workspace-a',
        selectionToken: 'selection-a',
        itemIds: Array<string>(1),
      },
    );

    expect(documentService.importSelection).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.InvalidRequest },
    });
  });

  test('rejects malformed mutation payloads with a stable code', async () => {
    const { deps, documentService } = makeDeps();
    registerKnowledgeBaseHandlers(deps);

    const result = await registeredHandlers.get(KnowledgeBaseIpc.DeleteDocument)?.(
      createEvent().event,
      { documentId: '', expectedRevision: -1 },
    );

    expect(documentService.deleteDocument).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.InvalidRequest },
    });
  });

  test('returns the latest display-safe document on revision conflict', async () => {
    const { deps, documentService } = makeDeps();
    documentService.deleteDocument = vi.fn(() => {
      throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCode.RevisionConflict, {
        latestDocument: documentItem(),
      });
    });
    registerKnowledgeBaseHandlers(deps);

    const result = await registeredHandlers.get(KnowledgeBaseIpc.DeleteDocument)?.(
      createEvent().event,
      { documentId: 'document-1', expectedRevision: 1 },
    );

    expect(result).toEqual({
      success: false,
      error: {
        code: KnowledgeBaseErrorCode.RevisionConflict,
        latestDocument: documentItem(),
      },
    });
    expect(JSON.stringify(result)).not.toContain('originalPath');
  });

  test('does not expose internal exception messages', async () => {
    const { deps, documentService } = makeDeps();
    documentService.retryDocument = vi.fn(() => {
      throw new Error('/private/customer/secret.pdf SQLITE_BUSY');
    });
    registerKnowledgeBaseHandlers(deps);

    const result = await registeredHandlers.get(KnowledgeBaseIpc.RetryDocument)?.(
      createEvent().event,
      { documentId: 'document-1', documentVersionId: 'version-1' },
    );

    expect(result).toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.PersistenceFailed },
    });
    expect(JSON.stringify(result)).not.toContain('/private/customer');
    expect(JSON.stringify(result)).not.toContain('SQLITE_BUSY');
  });
});
