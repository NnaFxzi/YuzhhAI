import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeDocumentVisibility,
} from '../../shared/knowledgeBase/constants';
import type { KnowledgeDocumentListItem } from '../../shared/knowledgeBase/types';
import { knowledgeBaseService, KnowledgeBaseServiceError } from './knowledgeBase';

const documentItem = (): KnowledgeDocumentListItem => ({
  id: 'document-1',
  displayName: 'manual.pdf',
  sourceMode: KnowledgeDocumentSourceMode.Managed,
  currentVersionId: 'version-1',
  revision: 1,
  status: KnowledgeDocumentStatus.Ready,
  fileSize: 100,
  mimeType: 'application/pdf',
  contentHash: 'a'.repeat(64),
  currentJob: null,
  localIndex: null,
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  deletedAt: null,
});

const installApi = (api: Partial<Window['electron']['knowledgeBase']>): void => {
  vi.stubGlobal('window', { electron: { knowledgeBase: api } });
};

describe('knowledgeBaseService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('unwraps successful list responses with request objects', async () => {
    const listDocuments = vi.fn(async () => ({
      success: true as const,
      data: [documentItem()],
    }));
    installApi({ listDocuments });

    await expect(
      knowledgeBaseService.listDocuments('workspace-a', KnowledgeDocumentVisibility.Active),
    ).resolves.toEqual([documentItem()]);
    expect(listDocuments).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      visibility: KnowledgeDocumentVisibility.Active,
    });
  });

  test('unwraps selection, import, details, and mutation operations', async () => {
    const selection = { selectionToken: 'token-1', files: [] };
    const api = {
      selectFiles: vi.fn(async () => ({ success: true as const, data: selection })),
      importSelection: vi.fn(async () => ({
        success: true as const,
        data: { importedCount: 0, failedCount: 0, items: [] },
      })),
      getDocumentDetails: vi.fn(async () => ({
        success: true as const,
        data: {
          document: documentItem(),
          activeVersion: {
            id: 'version-1',
            parser: 'pdf',
            extractedText: 'local text',
            extractionPartial: false,
            createdAt: '2026-07-11T00:00:00.000Z',
          },
        },
      })),
      deleteDocument: vi.fn(async () => ({ success: true as const, data: documentItem() })),
      restoreDocument: vi.fn(async () => ({ success: true as const, data: documentItem() })),
      retryDocument: vi.fn(async () => ({ success: true as const, data: documentItem() })),
    };
    installApi(api);

    await expect(knowledgeBaseService.selectFiles()).resolves.toEqual(selection);
    await knowledgeBaseService.importSelection('workspace-a', 'token-1', ['item-2']);
    await knowledgeBaseService.getDocumentDetails('document-1');
    await knowledgeBaseService.deleteDocument('document-1', 1);
    await knowledgeBaseService.restoreDocument('document-1', 2);
    await knowledgeBaseService.retryDocument('document-1', 'version-1');

    expect(api.importSelection).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      selectionToken: 'token-1',
      itemIds: ['item-2'],
    });
    expect(api.deleteDocument).toHaveBeenCalledWith({
      documentId: 'document-1',
      expectedRevision: 1,
    });
    expect(api.retryDocument).toHaveBeenCalledWith({
      documentId: 'document-1',
      documentVersionId: 'version-1',
    });
  });

  test('throws a typed stable error with latest conflict metadata', async () => {
    installApi({
      deleteDocument: vi.fn(async () => ({
        success: false as const,
        error: {
          code: KnowledgeBaseErrorCode.RevisionConflict,
          latestDocument: documentItem(),
        },
      })),
    });

    let caught: unknown;
    try {
      await knowledgeBaseService.deleteDocument('document-1', 1);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(KnowledgeBaseServiceError);
    expect(caught).toMatchObject({
      code: KnowledgeBaseErrorCode.RevisionConflict,
      latestDocument: documentItem(),
    });
  });

  test('omits item ids for backward-compatible full-selection imports', async () => {
    const importSelection = vi.fn(async () => ({
      success: true as const,
      data: { importedCount: 0, failedCount: 0, items: [] },
    }));
    installApi({ importSelection });

    await knowledgeBaseService.importSelection('workspace-a', 'token-1');

    expect(importSelection).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      selectionToken: 'token-1',
    });
  });

  test('uses a stable persistence error when the preload bridge is unavailable', async () => {
    vi.stubGlobal('window', { electron: {} });

    await expect(
      knowledgeBaseService.listDocuments('workspace-a', KnowledgeDocumentVisibility.Active),
    ).rejects.toMatchObject({ code: KnowledgeBaseErrorCode.PersistenceFailed });
  });

  test('renderer service unwraps local-index retry without using ingestion retry', async () => {
    const retryLocalIndex = vi.fn(async () => ({
      success: true as const,
      data: documentItem(),
    }));
    const retryDocument = vi.fn();
    installApi({ retryLocalIndex, retryDocument });

    await expect(
      knowledgeBaseService.retryLocalIndex('document-a', 'version-a'),
    ).resolves.toEqual(documentItem());

    expect(retryLocalIndex).toHaveBeenCalledWith({
      documentId: 'document-a',
      documentVersionId: 'version-a',
    });
    expect(retryDocument).not.toHaveBeenCalled();
  });
});
