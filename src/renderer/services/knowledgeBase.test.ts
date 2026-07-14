import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeDocumentVisibility,
  KnowledgeEnrichmentStatus,
  KnowledgeFactArchiveProjectionDecision,
  KnowledgeFactDomain,
  KnowledgeFactEvidenceState,
  KnowledgeFactListView,
  KnowledgeFactProjectionConflictKind,
  KnowledgeFactProjectionOperation,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewDecision,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
} from '../../shared/knowledgeBase/constants';
import type {
  KnowledgeArchiveFactRequest,
  KnowledgeCancelExtractionRequest,
  KnowledgeDocumentListItem,
  KnowledgeEnrichmentSummary,
  KnowledgeExtractionAuthorizationPreparation,
  KnowledgeFactArchiveResult,
  KnowledgeFactEvidencePageRequest,
  KnowledgeFactEvidencePageResult,
  KnowledgeFactListResult,
  KnowledgeFactProjectionConflict,
  KnowledgeFactReviewResult,
  KnowledgeFactSummary,
  KnowledgeListFactsRequest,
  KnowledgePrepareExtractionAuthorizationRequest,
  KnowledgeRequestExtractionRequest,
  KnowledgeRetryExtractionRequest,
  KnowledgeReviewFactRequest,
} from '../../shared/knowledgeBase/types';
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
  enrichment: null,
  hasStalePriorVersionExtraction: false,
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  deletedAt: null,
});

const enrichmentSummary = (): KnowledgeEnrichmentSummary => ({
  requestId: 'request-1',
  documentId: 'document-1',
  documentVersionId: 'version-1',
  status: KnowledgeEnrichmentStatus.ReviewRequired,
  progress: 100,
  revision: 3,
  attemptCount: 1,
  validCandidateCount: 2,
  discardedCandidateCount: 0,
  pendingFactCount: 2,
  partialReasons: [],
  errorCode: null,
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:01:00.000Z',
  completedAt: '2026-07-11T00:01:00.000Z',
});

const factItem = (): KnowledgeFactSummary => ({
  id: 'fact-1',
  domain: KnowledgeFactDomain.CompanySummary,
  value: 'Safe company summary',
  reviewStatus: KnowledgeFactReviewStatus.Pending,
  sourceKind: KnowledgeFactSourceKind.Extracted,
  revision: 4,
  projectionState: KnowledgeFactProjectionState.None,
  activeEvidenceCount: 1,
  staleEvidenceCount: 0,
  evidencePreview: null,
  createdAt: '2026-07-11T00:00:00.000Z',
  reviewedAt: null,
  updatedAt: '2026-07-11T00:01:00.000Z',
  archivedAt: null,
});

const captureRejection = async (operation: () => Promise<unknown>): Promise<unknown> => {
  try {
    await operation();
    return undefined;
  } catch (error) {
    return error;
  }
};

const installApi = (api: Partial<Window['electron']['knowledgeBase']>): void => {
  vi.stubGlobal('window', { electron: { knowledgeBase: api } });
};

describe('knowledgeBaseService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

  test('passes through every extraction and fact response using the original shared request', async () => {
    const prepareInput = {
      documentId: 'document-1',
      documentVersionId: 'version-1',
    } satisfies KnowledgePrepareExtractionAuthorizationRequest;
    const requestInput = {
      authorizationToken: 'authorization-1',
    } satisfies KnowledgeRequestExtractionRequest;
    const retryInput = {
      requestId: 'request-1',
      authorizationToken: 'authorization-2',
    } satisfies KnowledgeRetryExtractionRequest;
    const cancelInput = {
      requestId: 'request-1',
      expectedRevision: 3,
    } satisfies KnowledgeCancelExtractionRequest;
    const listInput = {
      workspaceId: 'workspace-1',
      view: KnowledgeFactListView.Active,
      reviewStatuses: [KnowledgeFactReviewStatus.Pending],
      evidenceState: KnowledgeFactEvidenceState.Active,
      cursor: 'cursor-1',
      limit: 25,
    } satisfies KnowledgeListFactsRequest;
    const reviewInput = {
      factId: 'fact-1',
      expectedRevision: 4,
      decision: KnowledgeFactReviewDecision.Confirm,
      replaceExisting: true,
      expectedFieldRevision: 2,
    } satisfies KnowledgeReviewFactRequest;
    const archiveInput = {
      factId: 'fact-1',
      expectedRevision: 5,
      projectionDecision: KnowledgeFactArchiveProjectionDecision.RemoveCurrent,
      expectedFieldRevision: 3,
    } satisfies KnowledgeArchiveFactRequest;
    const evidenceInput = {
      factId: 'fact-1',
      expectedRevision: 4,
      cursor: 'cursor-2',
      limit: 10,
    } satisfies KnowledgeFactEvidencePageRequest;
    const preparation = {
      authorizationToken: 'authorization-1',
      descriptor: {
        workspaceId: 'workspace-1',
        documentId: 'document-1',
        documentVersionId: 'version-1',
        documentDisplayName: 'manual.pdf',
        providerId: 'provider-1',
        providerLabel: 'Safe provider',
        modelId: 'model-1',
        modelLabel: 'Safe model',
        plannedModelCalls: 1,
        partial: false,
        expiresAt: '2026-07-11T00:02:00.000Z',
      },
    } satisfies KnowledgeExtractionAuthorizationPreparation;
    const summary = enrichmentSummary();
    const listResult = {
      items: [factItem()],
      nextCursor: 'cursor-2',
      metrics: {
        activePendingCount: 1,
        activeConfirmedCount: 2,
        staleConfirmedCount: 3,
        rejectedHistoryCount: 4,
        archivedHistoryCount: 5,
        unduplicatedLegacyConfirmedCount: 6,
        totalAiKnowledgeCount: 21,
      },
    } satisfies KnowledgeFactListResult;
    const reviewResult = {
      fact: factItem(),
      profileChanged: true,
      profileRevision: 3,
      fieldRevision: 2,
    } satisfies KnowledgeFactReviewResult;
    const archiveResult = {
      fact: factItem(),
      profileChanged: true,
      profileRevision: 4,
      fieldRevision: 3,
    } satisfies KnowledgeFactArchiveResult;
    const evidenceResult = {
      factId: 'fact-1',
      factRevision: 4,
      items: [],
      nextCursor: null,
    } satisfies KnowledgeFactEvidencePageResult;
    const api = {
      prepareExtractionAuthorization: vi.fn(async (
        _input: KnowledgePrepareExtractionAuthorizationRequest,
      ) => ({
        success: true as const,
        data: preparation,
      })),
      requestExtraction: vi.fn(async (_input: KnowledgeRequestExtractionRequest) => ({
        success: true as const,
        data: summary,
      })),
      retryExtraction: vi.fn(async (_input: KnowledgeRetryExtractionRequest) => ({
        success: true as const,
        data: summary,
      })),
      cancelExtraction: vi.fn(async (_input: KnowledgeCancelExtractionRequest) => ({
        success: true as const,
        data: summary,
      })),
      listFacts: vi.fn(async (_input: KnowledgeListFactsRequest) => ({
        success: true as const,
        data: listResult,
      })),
      reviewFact: vi.fn(async (_input: KnowledgeReviewFactRequest) => ({
        success: true as const,
        data: reviewResult,
      })),
      archiveFact: vi.fn(async (_input: KnowledgeArchiveFactRequest) => ({
        success: true as const,
        data: archiveResult,
      })),
      getFactEvidence: vi.fn(async (_input: KnowledgeFactEvidencePageRequest) => ({
        success: true as const,
        data: evidenceResult,
      })),
    };
    installApi(api);
    const cases = [
      {
        call: () => knowledgeBaseService.prepareExtractionAuthorization(prepareInput),
        invoke: api.prepareExtractionAuthorization,
        input: prepareInput,
        output: preparation,
      },
      {
        call: () => knowledgeBaseService.requestExtraction(requestInput),
        invoke: api.requestExtraction,
        input: requestInput,
        output: summary,
      },
      {
        call: () => knowledgeBaseService.retryExtraction(retryInput),
        invoke: api.retryExtraction,
        input: retryInput,
        output: summary,
      },
      {
        call: () => knowledgeBaseService.cancelExtraction(cancelInput),
        invoke: api.cancelExtraction,
        input: cancelInput,
        output: summary,
      },
      {
        call: () => knowledgeBaseService.listFacts(listInput),
        invoke: api.listFacts,
        input: listInput,
        output: listResult,
      },
      {
        call: () => knowledgeBaseService.reviewFact(reviewInput),
        invoke: api.reviewFact,
        input: reviewInput,
        output: reviewResult,
      },
      {
        call: () => knowledgeBaseService.archiveFact(archiveInput),
        invoke: api.archiveFact,
        input: archiveInput,
        output: archiveResult,
      },
      {
        call: () => knowledgeBaseService.getFactEvidence(evidenceInput),
        invoke: api.getFactEvidence,
        input: evidenceInput,
        output: evidenceResult,
      },
    ];

    for (const testCase of cases) {
      await expect(testCase.call()).resolves.toBe(testCase.output);
      expect(testCase.invoke).toHaveBeenCalledTimes(1);
      expect(testCase.invoke.mock.calls[0]?.[0]).toBe(testCase.input);
    }
  });

  test('keeps only the fixed code and safe projection conflict on typed failures', async () => {
    const conflict = {
      operation: KnowledgeFactProjectionOperation.Confirm,
      kind: KnowledgeFactProjectionConflictKind.CompanySummaryReplacement,
      factId: 'fact-1',
      factRevision: 4,
      domain: KnowledgeFactDomain.CompanySummary,
      currentFieldValue: 'Current safe summary',
      fieldRevision: 2,
    } satisfies KnowledgeFactProjectionConflict;
    installApi({
      reviewFact: vi.fn(async () => ({
        success: false as const,
        error: {
          code: KnowledgeBaseErrorCode.FactProjectionConflict,
          projectionConflict: conflict,
        },
      })),
    });

    const caught = await captureRejection(() =>
      knowledgeBaseService.reviewFact({
        factId: 'fact-1',
        expectedRevision: 4,
        decision: KnowledgeFactReviewDecision.Confirm,
      }),
    );

    expect(caught).toBeInstanceOf(KnowledgeBaseServiceError);
    expect(Object.keys(caught as object).sort()).toEqual(['code', 'projectionConflict']);
    expect(caught).toMatchObject({
      code: KnowledgeBaseErrorCode.FactProjectionConflict,
      projectionConflict: conflict,
    });
    expect(caught).not.toHaveProperty('fileName');
    expect(caught).not.toHaveProperty('latestDocument');
  });

  test('maps an untyped bridge failure to a fixed generic error without raw diagnostics', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const rawError = new Error('secret-token raw provider endpoint');
    rawError.stack = 'secret-stack /private/source/path.sql';
    installApi({
      listFacts: vi.fn(async () => {
        throw rawError;
      }),
    });

    const caught = await captureRejection(() =>
      knowledgeBaseService.listFacts({ workspaceId: 'workspace-1' }),
    );

    expect(caught).toBeInstanceOf(KnowledgeBaseServiceError);
    expect(Object.keys(caught as object)).toEqual(['code']);
    expect(caught).toMatchObject({
      code: KnowledgeBaseErrorCode.PersistenceFailed,
      message: KnowledgeBaseErrorCode.PersistenceFailed,
    });
    expect(caught).not.toHaveProperty('cause');
    expect(String((caught as Error).stack)).not.toContain('secret-stack');
    expect(JSON.stringify(caught)).not.toContain('secret-token');
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleDebug).not.toHaveBeenCalled();
  });
});
