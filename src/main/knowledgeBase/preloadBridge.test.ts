import { describe, expect, test, vi } from 'vitest';

import { KnowledgeBaseIpc, KnowledgeDocumentVisibility, } from '../../shared/knowledgeBase/constants';
import { createKnowledgeBasePreloadBridge } from './preloadBridge';

describe('createKnowledgeBasePreloadBridge', () => {
  test('routes all document operations through stable channels and request objects', async () => {
    const invoke = vi.fn(async () => ({ success: true, data: null }));
    const bridge = createKnowledgeBasePreloadBridge(invoke);

    await bridge.selectFiles();
    await bridge.importSelection({
      workspaceId: 'workspace-a',
      selectionToken: 'token-a',
      itemIds: ['item-a'],
    });
    await bridge.listDocuments({
      workspaceId: 'workspace-a',
      visibility: KnowledgeDocumentVisibility.Active,
    });
    await bridge.getDocumentDetails({ documentId: 'document-a' });
    await bridge.deleteDocument({ documentId: 'document-a', expectedRevision: 1 });
    await bridge.restoreDocument({ documentId: 'document-a', expectedRevision: 2 });
    await bridge.retryDocument({ documentId: 'document-a', documentVersionId: 'version-a' });

    expect(invoke.mock.calls).toEqual([
      [KnowledgeBaseIpc.SelectFiles],
      [
        KnowledgeBaseIpc.ImportSelection,
        {
          workspaceId: 'workspace-a',
          selectionToken: 'token-a',
          itemIds: ['item-a'],
        },
      ],
      [
        KnowledgeBaseIpc.ListDocuments,
        { workspaceId: 'workspace-a', visibility: KnowledgeDocumentVisibility.Active },
      ],
      [KnowledgeBaseIpc.GetDocumentDetails, { documentId: 'document-a' }],
      [KnowledgeBaseIpc.DeleteDocument, { documentId: 'document-a', expectedRevision: 1 }],
      [KnowledgeBaseIpc.RestoreDocument, { documentId: 'document-a', expectedRevision: 2 }],
      [
        KnowledgeBaseIpc.RetryDocument,
        { documentId: 'document-a', documentVersionId: 'version-a' },
      ],
    ]);
  });

  test('keeps full-selection imports backward compatible when item ids are omitted', async () => {
    const invoke = vi.fn(async () => ({ success: true, data: null }));
    const bridge = createKnowledgeBasePreloadBridge(invoke);

    await bridge.importSelection({ workspaceId: 'workspace-a', selectionToken: 'token-a' });

    expect(invoke).toHaveBeenCalledWith(KnowledgeBaseIpc.ImportSelection, {
      workspaceId: 'workspace-a',
      selectionToken: 'token-a',
    });
  });

  test('preload invokes the dedicated local-index retry channel', async () => {
    const invoke = vi.fn(async () => ({ success: true, data: null }));
    const bridge = createKnowledgeBasePreloadBridge(invoke);

    await bridge.retryLocalIndex({
      documentId: 'document-a',
      documentVersionId: 'version-a',
    });

    expect(invoke).toHaveBeenCalledWith(KnowledgeBaseIpc.RetryLocalIndex, {
      documentId: 'document-a',
      documentVersionId: 'version-a',
    });
  });
});
