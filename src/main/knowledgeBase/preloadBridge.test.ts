import { describe, expect, test, vi } from 'vitest';

import {
  KnowledgeBaseIpc,
  KnowledgeDocumentVisibility,
  KnowledgeFactArchiveProjectionDecision,
  KnowledgeFactBatchAction,
  KnowledgeFactEvidenceState,
  KnowledgeFactListView,
  KnowledgeFactReviewDecision,
  KnowledgeFactReviewStatus,
} from '../../shared/knowledgeBase/constants';
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

  test('routes every AI operation once through its exact channel and allowlisted payload', async () => {
    const invoke = vi.fn(async () => ({ success: true, data: null }));
    const bridge = createKnowledgeBasePreloadBridge(invoke);

    const retryLocalIndexInput = {
      documentId: 'document-a',
      documentVersionId: 'version-a',
    };
    const prepareAuthorizationInput = {
      documentId: 'document-a',
      documentVersionId: 'version-a',
    };
    const requestExtractionInput = { authorizationToken: 'authorization-a' };
    const retryExtractionInput = {
      requestId: 'request-a',
      authorizationToken: 'authorization-b',
    };
    const cancelExtractionInput = { requestId: 'request-a', expectedRevision: 3 };
    const listFactsInput = {
      workspaceId: 'workspace-a',
      view: KnowledgeFactListView.Active,
      reviewStatuses: [KnowledgeFactReviewStatus.Pending],
      evidenceState: KnowledgeFactEvidenceState.Active,
      cursor: 'cursor-a',
      limit: 25,
    };
    const reviewFactInput = {
      factId: 'fact-a',
      expectedRevision: 4,
      decision: KnowledgeFactReviewDecision.Confirm,
      replaceExisting: true,
      expectedFieldRevision: 5,
    };
    const archiveFactInput = {
      factId: 'fact-a',
      expectedRevision: 6,
      projectionDecision: KnowledgeFactArchiveProjectionDecision.RemoveCurrent,
      expectedFieldRevision: 7,
    };
    const getFactEvidenceInput = {
      factId: 'fact-a',
      expectedRevision: 8,
      cursor: 'cursor-b',
      limit: 10,
    };
    const startBatchReviewInput = {
      workspaceId: 'workspace-a',
      action: KnowledgeFactBatchAction.Reject,
      selection: {
        kind: 'matching_filters' as const,
        filters: {
          view: KnowledgeFactListView.Active,
          reviewStatuses: [KnowledgeFactReviewStatus.Pending],
          evidenceState: KnowledgeFactEvidenceState.Active,
        },
      },
      reason: 'Needs correction',
    };
    const getBatchReviewStatusInput = { taskId: 'task-a' };
    const cases = [
      {
        channel: KnowledgeBaseIpc.RetryLocalIndex,
        expectedKeys: ['documentId', 'documentVersionId'],
        input: retryLocalIndexInput,
        call: () => bridge.retryLocalIndex(retryLocalIndexInput),
      },
      {
        channel: KnowledgeBaseIpc.PrepareExtractionAuthorization,
        expectedKeys: ['documentId', 'documentVersionId'],
        input: prepareAuthorizationInput,
        call: () => bridge.prepareExtractionAuthorization(prepareAuthorizationInput),
      },
      {
        channel: KnowledgeBaseIpc.RequestExtraction,
        expectedKeys: ['authorizationToken'],
        input: requestExtractionInput,
        call: () => bridge.requestExtraction(requestExtractionInput),
      },
      {
        channel: KnowledgeBaseIpc.RetryExtraction,
        expectedKeys: ['requestId', 'authorizationToken'],
        input: retryExtractionInput,
        call: () => bridge.retryExtraction(retryExtractionInput),
      },
      {
        channel: KnowledgeBaseIpc.CancelExtraction,
        expectedKeys: ['requestId', 'expectedRevision'],
        input: cancelExtractionInput,
        call: () => bridge.cancelExtraction(cancelExtractionInput),
      },
      {
        channel: KnowledgeBaseIpc.ListFacts,
        expectedKeys: [
          'workspaceId',
          'view',
          'reviewStatuses',
          'evidenceState',
          'cursor',
          'limit',
        ],
        input: listFactsInput,
        call: () => bridge.listFacts(listFactsInput),
      },
      {
        channel: KnowledgeBaseIpc.ReviewFact,
        expectedKeys: [
          'factId',
          'expectedRevision',
          'decision',
          'replaceExisting',
          'expectedFieldRevision',
        ],
        input: reviewFactInput,
        call: () => bridge.reviewFact(reviewFactInput),
      },
      {
        channel: KnowledgeBaseIpc.ArchiveFact,
        expectedKeys: [
          'factId',
          'expectedRevision',
          'projectionDecision',
          'expectedFieldRevision',
        ],
        input: archiveFactInput,
        call: () => bridge.archiveFact(archiveFactInput),
      },
      {
        channel: KnowledgeBaseIpc.GetFactEvidence,
        expectedKeys: ['factId', 'expectedRevision', 'cursor', 'limit'],
        input: getFactEvidenceInput,
        call: () => bridge.getFactEvidence(getFactEvidenceInput),
      },
      {
        channel: KnowledgeBaseIpc.StartBatchReview,
        expectedKeys: ['workspaceId', 'action', 'selection', 'reason'],
        input: startBatchReviewInput,
        call: () => bridge.startBatchReview(startBatchReviewInput),
      },
      {
        channel: KnowledgeBaseIpc.GetBatchReviewStatus,
        expectedKeys: ['taskId'],
        input: getBatchReviewStatusInput,
        call: () => bridge.getBatchReviewStatus(getBatchReviewStatusInput),
      },
    ];

    for (const testCase of cases) {
      invoke.mockClear();
      Object.freeze(testCase.input);
      const inputSnapshot = JSON.stringify(testCase.input);

      await testCase.call();

      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke.mock.calls[0]).toHaveLength(2);
      expect(invoke.mock.calls[0]?.[0]).toBe(testCase.channel);
      expect(invoke.mock.calls[0]?.[1]).toBe(testCase.input);
      expect(Object.keys(invoke.mock.calls[0]?.[1] as object)).toEqual(testCase.expectedKeys);
      expect(JSON.stringify(invoke.mock.calls[0]?.[1])).toBe(inputSnapshot);
      expect(Object.isFrozen(testCase.input)).toBe(true);
      expect(JSON.stringify(testCase.input)).toBe(inputSnapshot);
    }
  });

  test('exposes only the shared renderer operations', () => {
    const bridge = createKnowledgeBasePreloadBridge(async () => ({ success: true, data: null }));

    expect(Object.keys(bridge).sort()).toEqual(
      [
        'archiveFact',
        'cancelExtraction',
        'deleteDocument',
        'getDocumentDetails',
        'getBatchReviewStatus',
        'getFactEvidence',
        'importSelection',
        'listDocuments',
        'listFacts',
        'prepareExtractionAuthorization',
        'requestExtraction',
        'restoreDocument',
        'retryDocument',
        'retryExtraction',
        'retryLocalIndex',
        'reviewFact',
        'selectFiles',
        'startBatchReview',
      ].sort(),
    );
    expect(bridge).not.toHaveProperty('wake');
    expect(bridge).not.toHaveProperty('shutdown');
    expect(bridge).not.toHaveProperty('store');
    expect(bridge).not.toHaveProperty('config');
    expect(bridge).not.toHaveProperty('credentials');
    expect(bridge).not.toHaveProperty('routes');
  });
});
