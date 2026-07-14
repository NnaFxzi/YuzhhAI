import { describe, expect, test } from 'vitest';

import {
  KNOWLEDGE_CHUNK_OVERLAP_CHARS,
  KNOWLEDGE_CHUNK_TARGET_CHARS,
  KNOWLEDGE_DOCUMENT_LEGACY_SOURCE_PREFIX,
  KNOWLEDGE_ENRICHMENT_CONCURRENCY,
  KNOWLEDGE_ENRICHMENT_HEARTBEAT_INTERVAL_MS,
  KNOWLEDGE_ENRICHMENT_MAX_CANDIDATES_PER_CALL,
  KNOWLEDGE_ENRICHMENT_MAX_CANDIDATES_PER_REQUEST,
  KNOWLEDGE_ENRICHMENT_MAX_CHUNKS,
  KNOWLEDGE_ENRICHMENT_MODEL_MAX_RESPONSE_BYTES,
  KNOWLEDGE_ENRICHMENT_MODEL_MAX_TOKENS,
  KNOWLEDGE_ENRICHMENT_MODEL_TIMEOUT_MS,
  KNOWLEDGE_ENRICHMENT_SAFE_ERROR_MAX_CHARS,
  KNOWLEDGE_EVIDENCE_MAX_QUOTE_CHARS,
  KNOWLEDGE_EVIDENCE_PREVIEW_MAX_CHARS,
  KNOWLEDGE_EXTRACTION_AUTHORIZATION_TTL_MS,
  KNOWLEDGE_FACT_BATCH_REJECT_REASON_MAX_CHARS,
  KNOWLEDGE_FACT_EVIDENCE_PAGE_DEFAULT_LIMIT,
  KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT,
  KNOWLEDGE_FACT_LIST_DEFAULT_LIMIT,
  KNOWLEDGE_FACT_LIST_MAX_LIMIT,
  KNOWLEDGE_FACT_MAX_VALUE_CHARS,
  KNOWLEDGE_GENERAL_JOB_CONCURRENCY,
  KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS,
  KNOWLEDGE_INDEX_WORKER_CLEANUP_BATCH_ROWS,
  KNOWLEDGE_INDEX_WORKER_CLEANUP_YIELD_MS,
  KNOWLEDGE_INDEX_WORKER_WRITE_BATCH_CHUNKS,
  KNOWLEDGE_INDEX_WORKER_WRITER_YIELD_MS,
  KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS,
  KNOWLEDGE_MAX_FILE_BYTES,
  KNOWLEDGE_MAX_SELECTION_FILES,
  KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES,
  KNOWLEDGE_OCR_JOB_CONCURRENCY,
  KNOWLEDGE_SELECTION_TOKEN_TTL_MS,
  KnowledgeBaseErrorCode,
  KnowledgeBaseIpc,
  KnowledgeDocumentIndexAttemptOutcome,
  KnowledgeDocumentIndexErrorCode,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentIndexTokenizer,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeDocumentVisibility,
  KnowledgeEnrichmentAttemptOutcome,
  KnowledgeEnrichmentPartialReason,
  KnowledgeEnrichmentStatus,
  KnowledgeFactArchiveProjectionDecision,
  KnowledgeFactBatchAction,
  KnowledgeFactBatchSkipReason,
  KnowledgeFactBatchTaskStatus,
  KnowledgeFactDomain,
  KnowledgeFactDomains,
  KnowledgeFactEvidenceState,
  KnowledgeFactListView,
  KnowledgeFactProfileProjectionAction,
  KnowledgeFactProjectionConflictKind,
  KnowledgeFactProjectionOperation,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewDecision,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
  KnowledgeIngestionAttemptOutcome,
  KnowledgeIngestionJobStatus,
  KnowledgeIngestionStage,
  KnowledgeMigrationStatus,
  KnowledgeTrustedIndexRefreshAttemptOutcome,
  KnowledgeTrustedIndexRefreshStatus,
  KnowledgeTrustedProfileIndexErrorCode,
} from './constants';
import type {
  KnowledgeArchiveFactRequest,
  KnowledgeBaseIpcError,
  KnowledgeBaseIpcResult,
  KnowledgeBaseRendererApi,
  KnowledgeCancelExtractionRequest,
  KnowledgeDocumentDetails,
  KnowledgeDocumentDetailsRequest,
  KnowledgeDocumentListItem,
  KnowledgeDocumentRevisionRequest,
  KnowledgeEnrichmentSummary,
  KnowledgeExtractionAuthorizationDescriptor,
  KnowledgeExtractionAuthorizationPreparation,
  KnowledgeFactArchiveResult,
  KnowledgeFactBatchReviewDetail,
  KnowledgeFactBatchReviewRequest,
  KnowledgeFactBatchReviewSelection,
  KnowledgeFactBatchReviewStatusRequest,
  KnowledgeFactBatchReviewTask,
  KnowledgeFactEvidencePageRequest,
  KnowledgeFactEvidencePageResult,
  KnowledgeFactEvidenceSummary,
  KnowledgeFactListResult,
  KnowledgeFactMetrics,
  KnowledgeFactProjectionConflict,
  KnowledgeFactReviewResult,
  KnowledgeFactSummary,
  KnowledgeFileSelection,
  KnowledgeImportBatchResult,
  KnowledgeImportSelectionRequest,
  KnowledgeListDocumentsRequest,
  KnowledgeListFactsRequest,
  KnowledgePrepareExtractionAuthorizationRequest,
  KnowledgeRequestExtractionRequest,
  KnowledgeRetryDocumentRequest,
  KnowledgeRetryExtractionRequest,
  KnowledgeRetryLocalIndexRequest,
  KnowledgeReviewFactRequest,
} from './types';

const enrichmentSummaryKeys = {
  requestId: true,
  documentId: true,
  documentVersionId: true,
  status: true,
  progress: true,
  revision: true,
  attemptCount: true,
  validCandidateCount: true,
  discardedCandidateCount: true,
  pendingFactCount: true,
  partialReasons: true,
  errorCode: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
} satisfies Record<keyof KnowledgeEnrichmentSummary, true>;

const authorizationDescriptorKeys = {
  workspaceId: true,
  documentId: true,
  documentVersionId: true,
  documentDisplayName: true,
  providerId: true,
  providerLabel: true,
  modelId: true,
  modelLabel: true,
  plannedModelCalls: true,
  partial: true,
  expiresAt: true,
} satisfies Record<keyof KnowledgeExtractionAuthorizationDescriptor, true>;

const authorizationPreparationKeys = {
  authorizationToken: true,
  descriptor: true,
} satisfies Record<keyof KnowledgeExtractionAuthorizationPreparation, true>;

const prepareExtractionAuthorizationRequestKeys = {
  documentId: true,
  documentVersionId: true,
} satisfies Record<keyof KnowledgePrepareExtractionAuthorizationRequest, true>;

const requestExtractionRequestKeys = {
  authorizationToken: true,
} satisfies Record<keyof KnowledgeRequestExtractionRequest, true>;

const retryExtractionRequestKeys = {
  requestId: true,
  authorizationToken: true,
} satisfies Record<keyof KnowledgeRetryExtractionRequest, true>;

const cancelExtractionRequestKeys = {
  requestId: true,
  expectedRevision: true,
} satisfies Record<keyof KnowledgeCancelExtractionRequest, true>;

const factEvidenceSummaryKeys = {
  id: true,
  factId: true,
  documentId: true,
  documentVersionId: true,
  documentDisplayName: true,
  quote: true,
  confidence: true,
  stale: true,
  createdAt: true,
} satisfies Record<keyof KnowledgeFactEvidenceSummary, true>;

const factEvidencePageRequestKeys = {
  factId: true,
  expectedRevision: true,
  cursor: true,
  limit: true,
} satisfies Record<keyof KnowledgeFactEvidencePageRequest, true>;

const factEvidencePageResultKeys = {
  factId: true,
  factRevision: true,
  items: true,
  nextCursor: true,
} satisfies Record<keyof KnowledgeFactEvidencePageResult, true>;

const factSummaryKeys = {
  id: true,
  domain: true,
  value: true,
  reviewStatus: true,
  sourceKind: true,
  revision: true,
  projectionState: true,
  activeEvidenceCount: true,
  staleEvidenceCount: true,
  evidencePreview: true,
  createdAt: true,
  reviewedAt: true,
  updatedAt: true,
  archivedAt: true,
} satisfies Record<keyof KnowledgeFactSummary, true>;

const factMetricsKeys = {
  activePendingCount: true,
  activeConfirmedCount: true,
  staleConfirmedCount: true,
  rejectedHistoryCount: true,
  archivedHistoryCount: true,
  unduplicatedLegacyConfirmedCount: true,
  totalAiKnowledgeCount: true,
} satisfies Record<keyof KnowledgeFactMetrics, true>;

const listFactsRequestKeys = {
  workspaceId: true,
  view: true,
  reviewStatuses: true,
  evidenceState: true,
  cursor: true,
  limit: true,
} satisfies Record<keyof KnowledgeListFactsRequest, true>;

const factListResultKeys = {
  items: true,
  nextCursor: true,
  metrics: true,
} satisfies Record<keyof KnowledgeFactListResult, true>;

const reviewFactRequestKeys = {
  factId: true,
  expectedRevision: true,
  decision: true,
  replaceExisting: true,
  expectedFieldRevision: true,
} satisfies Record<keyof KnowledgeReviewFactRequest, true>;

const batchReviewDetailKeys = {
  factId: true,
  valuePreview: true,
  code: true,
  retryable: true,
} satisfies Record<keyof KnowledgeFactBatchReviewDetail, true>;

const batchReviewRequestKeys = {
  workspaceId: true,
  action: true,
  selection: true,
  reason: true,
} satisfies Record<keyof KnowledgeFactBatchReviewRequest, true>;

const batchReviewStatusRequestKeys = {
  taskId: true,
} satisfies Record<keyof KnowledgeFactBatchReviewStatusRequest, true>;

const batchReviewTaskKeys = {
  taskId: true,
  workspaceId: true,
  action: true,
  status: true,
  totalCount: true,
  processedCount: true,
  successCount: true,
  skippedCount: true,
  failedCount: true,
  skippedByReason: true,
  details: true,
  createdAt: true,
  startedAt: true,
  updatedAt: true,
  completedAt: true,
} satisfies Record<keyof KnowledgeFactBatchReviewTask, true>;

const factProjectionConflictKeys = {
  operation: true,
  kind: true,
  factId: true,
  factRevision: true,
  domain: true,
  currentFieldValue: true,
  fieldRevision: true,
} satisfies Record<keyof KnowledgeFactProjectionConflict, true>;

const factReviewResultKeys = {
  fact: true,
  profileChanged: true,
  profileRevision: true,
  fieldRevision: true,
} satisfies Record<keyof KnowledgeFactReviewResult, true>;

const archiveFactRequestKeys = {
  factId: true,
  expectedRevision: true,
  projectionDecision: true,
  expectedFieldRevision: true,
} satisfies Record<keyof KnowledgeArchiveFactRequest, true>;

const factArchiveResultKeys = {
  fact: true,
  profileChanged: true,
  profileRevision: true,
  fieldRevision: true,
} satisfies Record<keyof KnowledgeFactArchiveResult, true>;

const failedRendererResult = <T>(): Promise<KnowledgeBaseIpcResult<T>> =>
  Promise.resolve({
    success: false,
    error: { code: KnowledgeBaseErrorCode.InvalidRequest },
  });

const rendererApiFixture = {
  selectFiles: () => failedRendererResult<KnowledgeFileSelection | null>(),
  importSelection: (input: KnowledgeImportSelectionRequest) => {
    void input;
    return failedRendererResult<KnowledgeImportBatchResult>();
  },
  listDocuments: (input: KnowledgeListDocumentsRequest) => {
    void input;
    return failedRendererResult<KnowledgeDocumentListItem[]>();
  },
  getDocumentDetails: (input: KnowledgeDocumentDetailsRequest) => {
    void input;
    return failedRendererResult<KnowledgeDocumentDetails>();
  },
  deleteDocument: (input: KnowledgeDocumentRevisionRequest) => {
    void input;
    return failedRendererResult<KnowledgeDocumentListItem>();
  },
  restoreDocument: (input: KnowledgeDocumentRevisionRequest) => {
    void input;
    return failedRendererResult<KnowledgeDocumentListItem>();
  },
  retryDocument: (input: KnowledgeRetryDocumentRequest) => {
    void input;
    return failedRendererResult<KnowledgeDocumentListItem>();
  },
  retryLocalIndex: (input: KnowledgeRetryLocalIndexRequest) => {
    void input;
    return failedRendererResult<KnowledgeDocumentListItem>();
  },
  prepareExtractionAuthorization: (input: KnowledgePrepareExtractionAuthorizationRequest) => {
    void input;
    return failedRendererResult<KnowledgeExtractionAuthorizationPreparation>();
  },
  requestExtraction: (input: KnowledgeRequestExtractionRequest) => {
    void input;
    return failedRendererResult<KnowledgeEnrichmentSummary>();
  },
  retryExtraction: (input: KnowledgeRetryExtractionRequest) => {
    void input;
    return failedRendererResult<KnowledgeEnrichmentSummary>();
  },
  cancelExtraction: (input: KnowledgeCancelExtractionRequest) => {
    void input;
    return failedRendererResult<KnowledgeEnrichmentSummary>();
  },
  listFacts: (input: KnowledgeListFactsRequest) => {
    void input;
    return failedRendererResult<KnowledgeFactListResult>();
  },
  reviewFact: (input: KnowledgeReviewFactRequest) => {
    void input;
    return failedRendererResult<KnowledgeFactReviewResult>();
  },
  archiveFact: (input: KnowledgeArchiveFactRequest) => {
    void input;
    return failedRendererResult<KnowledgeFactArchiveResult>();
  },
  getFactEvidence: (input: KnowledgeFactEvidencePageRequest) => {
    void input;
    return failedRendererResult<KnowledgeFactEvidencePageResult>();
  },
  startBatchReview: (input: KnowledgeFactBatchReviewRequest) => {
    void input;
    return failedRendererResult<KnowledgeFactBatchReviewTask>();
  },
  getBatchReviewStatus: (input: KnowledgeFactBatchReviewStatusRequest) => {
    void input;
    return failedRendererResult<KnowledgeFactBatchReviewTask | null>();
  },
} satisfies KnowledgeBaseRendererApi;

const expectExactDtoKeys = <T extends object>(
  value: T,
  allowedKeys: Record<keyof T, true>,
): void => {
  expect(Object.keys(value).sort()).toEqual(Object.keys(allowedKeys).sort());
};

describe('knowledge base contracts', () => {
  test('publishes stable local-enterprise status values', () => {
    expect(KnowledgeDocumentSourceMode).toEqual({ Managed: 'managed', Linked: 'linked' });
    expect(KnowledgeDocumentStatus.CompletedWithoutText).toBe('completed_without_text');
    expect(KnowledgeIngestionJobStatus).toEqual({
      Queued: 'queued',
      Running: 'running',
      Completed: 'completed',
      Failed: 'failed',
      Cancelled: 'cancelled',
    });
    expect(KnowledgeIngestionAttemptOutcome.Abandoned).toBe('abandoned');
    expect(KnowledgeIngestionStage.FactExtraction).toBe('fact_extraction');
    expect(KnowledgeMigrationStatus.Completed).toBe('completed');
    expect(KnowledgeFactBatchAction).toEqual({
      Confirm: 'confirm',
      Reject: 'reject',
      Archive: 'archive',
    });
    expect(KnowledgeFactBatchTaskStatus).toEqual({
      Queued: 'queued',
      Running: 'running',
      Completed: 'completed',
      Failed: 'failed',
    });
    expect(KnowledgeFactBatchSkipReason).toEqual({
      NoActiveEvidence: 'no_active_evidence',
      RevisionConflict: 'revision_conflict',
      ProjectionConflict: 'projection_conflict',
      AlreadyProcessed: 'already_processed',
      NotFound: 'not_found',
    });
    expect(KNOWLEDGE_FACT_BATCH_REJECT_REASON_MAX_CHARS).toBe(240);
  });

  test('publishes the approved capacity defaults', () => {
    expect(KNOWLEDGE_MAX_FILE_BYTES).toBe(50 * 1024 * 1024);
    expect(KNOWLEDGE_MAX_SELECTION_FILES).toBe(100);
    expect(KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES).toBe(20 * 1024 * 1024 * 1024);
    expect(KNOWLEDGE_GENERAL_JOB_CONCURRENCY).toBe(2);
    expect(KNOWLEDGE_OCR_JOB_CONCURRENCY).toBe(1);
  });

  test('publishes stable knowledge-base IPC channels and visibility values', () => {
    expect(KnowledgeBaseErrorCode.BackendNotReady).toBe('backend_not_ready');
    expect(KnowledgeBaseIpc).toEqual({
      DeleteDocument: 'knowledgeBase:documents:delete',
      GetDocumentDetails: 'knowledgeBase:documents:getDetails',
      ImportSelection: 'knowledgeBase:documents:importSelection',
      ListDocuments: 'knowledgeBase:documents:list',
      RestoreDocument: 'knowledgeBase:documents:restore',
      RetryDocument: 'knowledgeBase:documents:retry',
      RetryLocalIndex: 'knowledgeBase:documents:retryLocalIndex',
      SelectFiles: 'knowledgeBase:files:select',
      PrepareExtractionAuthorization: 'knowledgeBase:extraction:prepareAuthorization',
      RequestExtraction: 'knowledgeBase:extraction:request',
      RetryExtraction: 'knowledgeBase:extraction:retry',
      CancelExtraction: 'knowledgeBase:extraction:cancel',
      ListFacts: 'knowledgeBase:facts:list',
      ReviewFact: 'knowledgeBase:facts:review',
      ArchiveFact: 'knowledgeBase:facts:archive',
      GetFactEvidence: 'knowledgeBase:facts:getEvidence',
      StartBatchReview: 'knowledgeBase:facts:batchReview:start',
      GetBatchReviewStatus: 'knowledgeBase:facts:batchReview:getStatus',
    });
    expect(KnowledgeDocumentVisibility).toEqual({ Active: 'active', Deleted: 'deleted' });
    expect(KNOWLEDGE_SELECTION_TOKEN_TTL_MS).toBe(5 * 60_000);
    expect(KNOWLEDGE_DOCUMENT_LEGACY_SOURCE_PREFIX).toBe('knowledge-document:');
  });

  test('publishes the exact safe renderer API and projection-conflict error', () => {
    const prepareRequest: KnowledgePrepareExtractionAuthorizationRequest = {
      documentId: 'document-1',
      documentVersionId: 'version-1',
    };
    const requestExtraction: KnowledgeRequestExtractionRequest = {
      authorizationToken: 'opaque-token',
    };
    const retryExtraction: KnowledgeRetryExtractionRequest = {
      requestId: 'request-1',
      authorizationToken: 'opaque-token',
    };
    const cancelExtraction: KnowledgeCancelExtractionRequest = {
      requestId: 'request-1',
      expectedRevision: 2,
    };
    const projectionConflict: KnowledgeFactProjectionConflict = {
      operation: KnowledgeFactProjectionOperation.Confirm,
      kind: KnowledgeFactProjectionConflictKind.CompanySummaryReplacement,
      factId: 'fact-1',
      factRevision: 3,
      domain: KnowledgeFactDomain.CompanySummary,
      currentFieldValue: 'Current safe summary',
      fieldRevision: 4,
    };
    const error: KnowledgeBaseIpcError = {
      code: KnowledgeBaseErrorCode.FactProjectionConflict,
      projectionConflict,
    };

    expect(Object.keys(rendererApiFixture)).toEqual([
      'selectFiles',
      'importSelection',
      'listDocuments',
      'getDocumentDetails',
      'deleteDocument',
      'restoreDocument',
      'retryDocument',
      'retryLocalIndex',
      'prepareExtractionAuthorization',
      'requestExtraction',
      'retryExtraction',
      'cancelExtraction',
      'listFacts',
      'reviewFact',
      'archiveFact',
      'getFactEvidence',
      'startBatchReview',
      'getBatchReviewStatus',
    ]);
    expectExactDtoKeys(prepareRequest, prepareExtractionAuthorizationRequestKeys);
    expectExactDtoKeys(requestExtraction, requestExtractionRequestKeys);
    expectExactDtoKeys(retryExtraction, retryExtractionRequestKeys);
    expectExactDtoKeys(cancelExtraction, cancelExtractionRequestKeys);
    expect(prepareRequest).toEqual({
      documentId: 'document-1',
      documentVersionId: 'version-1',
    });
    expect(requestExtraction).toEqual({ authorizationToken: 'opaque-token' });
    expect(retryExtraction).toEqual({
      requestId: 'request-1',
      authorizationToken: 'opaque-token',
    });
    expect(cancelExtraction).toEqual({ requestId: 'request-1', expectedRevision: 2 });
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      code: 'fact_projection_conflict',
      projectionConflict: {
        operation: 'confirm',
        kind: 'company_summary_replacement',
        factId: 'fact-1',
        factRevision: 3,
        domain: 'companySummary',
        currentFieldValue: 'Current safe summary',
        fieldRevision: 4,
      },
    });
    expectExactDtoKeys(error.projectionConflict!, factProjectionConflictKeys);
  });

  test('publishes the batch-review DTO contract', () => {
    const batchReviewDetail: KnowledgeFactBatchReviewDetail = {
      factId: 'fact-1',
      valuePreview: 'A'.repeat(240),
      code: 'revision_conflict',
      retryable: true,
    };
    const batchReviewSelectionByIds: KnowledgeFactBatchReviewSelection = {
      kind: 'fact_ids',
      items: [
        {
          factId: 'fact-1',
          expectedRevision: 1,
        },
      ],
    };
    const batchReviewSelectionByFilters: KnowledgeFactBatchReviewSelection = {
      kind: 'matching_filters',
      filters: {
        view: KnowledgeFactListView.Active,
        reviewStatuses: [KnowledgeFactReviewStatus.Pending],
        evidenceState: KnowledgeFactEvidenceState.Active,
      },
    };
    const batchReviewRequest: KnowledgeFactBatchReviewRequest = {
      workspaceId: 'workspace-1',
      action: KnowledgeFactBatchAction.Confirm,
      selection: batchReviewSelectionByIds,
      reason: 'Batch review request',
    };
    const batchReviewStatusRequest: KnowledgeFactBatchReviewStatusRequest = {
      taskId: 'task-1',
    };
    const batchReviewTask: KnowledgeFactBatchReviewTask = {
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      action: KnowledgeFactBatchAction.Confirm,
      status: KnowledgeFactBatchTaskStatus.Running,
      totalCount: 3,
      processedCount: 1,
      successCount: 1,
      skippedCount: 1,
      failedCount: 0,
      skippedByReason: {
        [KnowledgeFactBatchSkipReason.AlreadyProcessed]: 1,
      },
      details: [batchReviewDetail],
      createdAt: '2026-07-12T00:00:00.000Z',
      startedAt: '2026-07-12T00:00:01.000Z',
      updatedAt: '2026-07-12T00:00:02.000Z',
      completedAt: null,
    };

    expectExactDtoKeys(batchReviewDetail, batchReviewDetailKeys);
    expectExactDtoKeys(batchReviewRequest, batchReviewRequestKeys);
    expectExactDtoKeys(batchReviewStatusRequest, batchReviewStatusRequestKeys);
    expectExactDtoKeys(batchReviewTask, batchReviewTaskKeys);
    expect(Object.keys(batchReviewSelectionByIds).sort()).toEqual(['items', 'kind']);
    expect(Object.keys(batchReviewSelectionByFilters).sort()).toEqual(['filters', 'kind']);
    expect(JSON.parse(JSON.stringify(batchReviewSelectionByIds))).toEqual({
      kind: 'fact_ids',
      items: [{ factId: 'fact-1', expectedRevision: 1 }],
    });
    expect(JSON.parse(JSON.stringify(batchReviewSelectionByFilters))).toEqual({
      kind: 'matching_filters',
      filters: {
        view: 'active',
        reviewStatuses: ['pending'],
        evidenceState: 'active',
      },
    });
    expect(JSON.parse(JSON.stringify(batchReviewTask))).toEqual({
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      action: 'confirm',
      status: 'running',
      totalCount: 3,
      processedCount: 1,
      successCount: 1,
      skippedCount: 1,
      failedCount: 0,
      skippedByReason: {
        already_processed: 1,
      },
      details: [
        {
          factId: 'fact-1',
          valuePreview: 'A'.repeat(240),
          code: 'revision_conflict',
          retryable: true,
        },
      ],
      createdAt: '2026-07-12T00:00:00.000Z',
      startedAt: '2026-07-12T00:00:01.000Z',
      updatedAt: '2026-07-12T00:00:02.000Z',
      completedAt: null,
    });
  });

  test('keeps renderer document DTOs display-safe', () => {
    const item: KnowledgeDocumentListItem = {
      id: 'document-1',
      displayName: 'manual.pdf',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      currentVersionId: 'version-1',
      revision: 1,
      status: KnowledgeDocumentStatus.Pending,
      fileSize: 1024,
      mimeType: 'application/pdf',
      contentHash: 'hash',
      currentJob: null,
      localIndex: null,
      enrichment: null,
      hasStalePriorVersionExtraction: false,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
      deletedAt: null,
    };

    expect(item).not.toHaveProperty('originalPath');
    expect(item).not.toHaveProperty('legacySourceId');
    expect(item).not.toHaveProperty('extractedText');
    expect(item).not.toHaveProperty('managedPath');
    expect(item.enrichment).toBeNull();
    expect(item.hasStalePriorVersionExtraction).toBe(false);
  });

  test('publishes stable local-index constants and retry channel', () => {
    expect(KnowledgeDocumentIndexStatus).toEqual({
      Pending: 'pending',
      Indexing: 'indexing',
      Indexed: 'indexed',
      NotApplicable: 'not_applicable',
      Failed: 'failed',
    });
    expect(KnowledgeDocumentIndexAttemptOutcome).toEqual({
      Running: 'running',
      Indexed: 'indexed',
      Failed: 'failed',
      Cancelled: 'cancelled',
      Abandoned: 'abandoned',
    });
    expect(KnowledgeDocumentIndexTokenizer).toEqual({
      TrigramV1: 'fts5_trigram_v1',
      CjkBigramV1: 'unicode61_cjk_bigram_v1',
    });
    expect(KnowledgeDocumentIndexErrorCode).toEqual({
      ProcessingFailed: 'index_processing_failed',
      WorkerUnavailable: 'index_worker_unavailable',
      StateConflict: 'index_state_conflict',
    });
    expect(KnowledgeBaseIpc.RetryLocalIndex).toBe('knowledgeBase:documents:retryLocalIndex');
    expect(KNOWLEDGE_CHUNK_TARGET_CHARS).toBe(18_000);
    expect(KNOWLEDGE_CHUNK_OVERLAP_CHARS).toBe(800);
    expect(KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS).toBe(8);
    expect(KNOWLEDGE_INDEX_WORKER_WRITE_BATCH_CHUNKS).toBe(8);
    expect(KNOWLEDGE_INDEX_WORKER_WRITER_YIELD_MS).toBe(1);
    expect(KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS).toBe(64);
    expect(KNOWLEDGE_INDEX_WORKER_CLEANUP_BATCH_ROWS).toBe(64);
    expect(KNOWLEDGE_INDEX_WORKER_CLEANUP_YIELD_MS).toBe(105);
  });

  test('keeps local-index document summaries display-safe', () => {
    const item: KnowledgeDocumentListItem = {
      id: 'document-a',
      displayName: 'manual.pdf',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      currentVersionId: 'version-a',
      revision: 1,
      status: KnowledgeDocumentStatus.Ready,
      fileSize: 100,
      mimeType: 'application/pdf',
      contentHash: 'a'.repeat(64),
      currentJob: null,
      localIndex: {
        documentVersionId: 'version-a',
        status: KnowledgeDocumentIndexStatus.Indexed,
        chunkCount: 4,
        attemptCount: 1,
        errorCode: null,
        updatedAt: '2026-07-11T00:00:00.000Z',
        completedAt: '2026-07-11T00:00:01.000Z',
      },
      enrichment: null,
      hasStalePriorVersionExtraction: true,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:01.000Z',
      deletedAt: null,
    };
    expect(item.hasStalePriorVersionExtraction).toBe(true);

    expect(item.localIndex).not.toHaveProperty('activeAttemptId');
    expect(item.localIndex).not.toHaveProperty('heartbeatAt');
    expect(item.localIndex).not.toHaveProperty('tokenizerVersion');
    expect(item.localIndex).not.toHaveProperty('content');
    expect(item.localIndex).not.toHaveProperty('managedPath');
  });

  test('publishes stable enrichment, fact, projection, and trusted-index values', () => {
    expect(KnowledgeEnrichmentStatus).toEqual({
      Queued: 'queued',
      Running: 'running',
      ReviewRequired: 'review_required',
      Completed: 'completed',
      Failed: 'failed',
      Cancelled: 'cancelled',
      Stale: 'stale',
    });
    expect(KnowledgeEnrichmentAttemptOutcome).toEqual({
      Running: 'running',
      Completed: 'completed',
      Failed: 'failed',
      Cancelled: 'cancelled',
      Abandoned: 'abandoned',
    });
    expect(KnowledgeEnrichmentPartialReason).toEqual({
      ChunkLimit: 'chunk_limit',
      CandidateLimit: 'candidate_limit',
    });
    expect(KnowledgeFactReviewStatus).toEqual({
      Pending: 'pending',
      Confirmed: 'confirmed',
      Rejected: 'rejected',
    });
    expect(KnowledgeFactSourceKind).toEqual({
      Extracted: 'extracted',
      Manual: 'manual',
      Imported: 'imported',
    });
    expect(KnowledgeFactProjectionState).toEqual({
      None: 'none',
      Active: 'active',
      Conflict: 'conflict',
      Reversed: 'reversed',
    });
    expect(KnowledgeFactProfileProjectionAction).toEqual({
      Inserted: 'inserted',
      PreexistingSupport: 'preexisting_support',
      ReplacedSingle: 'replaced_single',
    });
    expect(KnowledgeFactProjectionOperation).toEqual({
      Confirm: 'confirm',
      Archive: 'archive',
    });
    expect(KnowledgeFactProjectionConflictKind).toEqual({
      CompanySummaryReplacement: 'company_summary_replacement',
      ArchiveFieldChanged: 'archive_field_changed',
    });
    expect(KnowledgeFactReviewDecision).toEqual({
      Confirm: 'confirm',
      Reject: 'reject',
    });
    expect(KnowledgeFactArchiveProjectionDecision).toEqual({
      KeepCurrent: 'keep_current',
      RemoveCurrent: 'remove_current',
    });
    expect(KnowledgeTrustedIndexRefreshStatus).toEqual({
      Queued: 'queued',
      Running: 'running',
      Completed: 'completed',
      Failed: 'failed',
    });
    expect(KnowledgeTrustedIndexRefreshAttemptOutcome).toEqual({
      Running: 'running',
      Completed: 'completed',
      Failed: 'failed',
      Abandoned: 'abandoned',
    });
    expect(KnowledgeFactDomain).toEqual({
      CompanySummary: 'companySummary',
      ProductList: 'productList',
      ProductCapabilities: 'productCapabilities',
      TargetCustomers: 'targetCustomers',
      ApplicationScenarios: 'applicationScenarios',
      SellingPoints: 'sellingPoints',
      ChannelPreferences: 'channelPreferences',
      ProhibitedClaims: 'prohibitedClaims',
      ContactRules: 'contactRules',
      MissingInfo: 'missingInfo',
    });
    expect(KnowledgeFactDomains).toEqual(Object.values(KnowledgeFactDomain));
    expect(new Set(KnowledgeFactDomains).size).toBe(10);
    expect(KnowledgeTrustedProfileIndexErrorCode).toEqual({
      RefreshFailed: 'trusted_profile_index_refresh_failed',
      RefreshAbandoned: 'trusted_profile_index_refresh_abandoned',
    });
    expect(KnowledgeFactListView).toEqual({ Active: 'active', History: 'history' });
    expect(KnowledgeFactEvidenceState).toEqual({
      Active: 'active',
      Stale: 'stale',
      Any: 'any',
    });
  });

  test('publishes the approved enrichment and fact limits', () => {
    expect(KNOWLEDGE_EXTRACTION_AUTHORIZATION_TTL_MS).toBe(120_000);
    expect(KNOWLEDGE_ENRICHMENT_MAX_CHUNKS).toBe(30);
    expect(KNOWLEDGE_ENRICHMENT_MAX_CANDIDATES_PER_CALL).toBe(50);
    expect(KNOWLEDGE_ENRICHMENT_MAX_CANDIDATES_PER_REQUEST).toBe(200);
    expect(KNOWLEDGE_ENRICHMENT_MODEL_MAX_TOKENS).toBe(4_096);
    expect(KNOWLEDGE_ENRICHMENT_MODEL_MAX_RESPONSE_BYTES).toBe(1_048_576);
    expect(KNOWLEDGE_ENRICHMENT_MODEL_TIMEOUT_MS).toBe(180_000);
    expect(KNOWLEDGE_ENRICHMENT_HEARTBEAT_INTERVAL_MS).toBe(15_000);
    expect(KNOWLEDGE_ENRICHMENT_CONCURRENCY).toBe(1);
    expect(KNOWLEDGE_FACT_MAX_VALUE_CHARS).toBe(2_000);
    expect(KNOWLEDGE_EVIDENCE_MAX_QUOTE_CHARS).toBe(1_000);
    expect(KNOWLEDGE_EVIDENCE_PREVIEW_MAX_CHARS).toBe(240);
    expect(KNOWLEDGE_FACT_EVIDENCE_PAGE_DEFAULT_LIMIT).toBe(50);
    expect(KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT).toBe(100);
    expect(KNOWLEDGE_FACT_LIST_DEFAULT_LIMIT).toBe(50);
    expect(KNOWLEDGE_FACT_LIST_MAX_LIMIT).toBe(100);
    expect(KNOWLEDGE_ENRICHMENT_SAFE_ERROR_MAX_CHARS).toBe(240);
  });

  test('publishes all stable independent-enrichment errors', () => {
    expect(KnowledgeBaseErrorCode).toEqual({
      BackendNotReady: 'backend_not_ready',
      InvalidRequest: 'invalid_request',
      InvalidSelectionToken: 'invalid_selection_token',
      RevisionConflict: 'revision_conflict',
      InvalidManagedPath: 'invalid_managed_path',
      FileTooLarge: 'file_too_large',
      TooManyFiles: 'too_many_files',
      UnsupportedFileType: 'unsupported_file_type',
      SelectedFileMissing: 'selected_file_missing',
      SelectedFileChanged: 'selected_file_changed',
      WorkspaceQuotaExceeded: 'workspace_quota_exceeded',
      WorkspaceNotFound: 'workspace_not_found',
      DocumentNotFound: 'document_not_found',
      IngestionFailed: 'ingestion_failed',
      PersistenceFailed: 'persistence_failed',
      JobStateConflict: 'job_state_conflict',
      MigrationFailed: 'migration_failed',
      DocumentNotReady: 'document_not_ready',
      LocalIndexNotReady: 'local_index_not_ready',
      ExplicitConsentRequired: 'explicit_consent_required',
      ModelConfigurationUnavailable: 'model_configuration_unavailable',
      ModelConfigurationChanged: 'model_configuration_changed',
      InvalidExtractionAuthorization: 'invalid_extraction_authorization',
      ExpiredExtractionAuthorization: 'expired_extraction_authorization',
      ConsumedExtractionAuthorization: 'consumed_extraction_authorization',
      ForeignExtractionAuthorizationOwner: 'foreign_extraction_authorization_owner',
      UnsupportedModelProvider: 'unsupported_model_provider',
      EnrichmentAlreadyActive: 'enrichment_already_active',
      EnrichmentRequestNotFound: 'enrichment_request_not_found',
      EnrichmentRequestStale: 'enrichment_request_stale',
      ModelRequestFailed: 'model_request_failed',
      ModelRequestTimeout: 'model_request_timeout',
      InvalidModelResponse: 'invalid_model_response',
      EvidenceValidationFailed: 'evidence_validation_failed',
      FactEvidenceStale: 'fact_evidence_stale',
      FactRevisionConflict: 'fact_revision_conflict',
      FactProjectionConflict: 'fact_projection_conflict',
      ProfileRevisionConflict: 'profile_revision_conflict',
      EnrichmentPersistenceFailed: 'enrichment_persistence_failed',
      AuthorizationRequired: 'authorization_required',
    });
  });

  test('keeps enrichment, fact, evidence, and list DTOs display-safe', () => {
    const authorizationDescriptor: KnowledgeExtractionAuthorizationDescriptor = {
      workspaceId: 'workspace-1',
      documentId: 'document-1',
      documentVersionId: 'version-1',
      documentDisplayName: 'factory.pdf',
      providerId: 'provider-1',
      providerLabel: 'OpenAI compatible',
      modelId: 'model-1',
      modelLabel: 'Model One',
      plannedModelCalls: 2,
      partial: false,
      expiresAt: '2026-07-12T00:02:00.000Z',
    };
    const enrichment: KnowledgeEnrichmentSummary = {
      requestId: 'request-1',
      documentId: 'document-1',
      documentVersionId: 'version-1',
      status: KnowledgeEnrichmentStatus.ReviewRequired,
      progress: 100,
      revision: 2,
      attemptCount: 1,
      validCandidateCount: 1,
      discardedCandidateCount: 0,
      pendingFactCount: 1,
      partialReasons: [],
      errorCode: null,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:01.000Z',
      completedAt: null,
    };
    const evidence: KnowledgeFactEvidenceSummary = {
      id: 'evidence-1',
      factId: 'fact-1',
      documentId: 'document-1',
      documentVersionId: 'version-1',
      documentDisplayName: 'factory.pdf',
      quote: '支持小批量精密加工。',
      confidence: 0.98,
      stale: false,
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    const fact: KnowledgeFactSummary = {
      id: 'fact-1',
      domain: KnowledgeFactDomain.ProductCapabilities,
      value: '小批量精密加工',
      reviewStatus: KnowledgeFactReviewStatus.Pending,
      sourceKind: KnowledgeFactSourceKind.Extracted,
      revision: 1,
      projectionState: KnowledgeFactProjectionState.None,
      activeEvidenceCount: 1,
      staleEvidenceCount: 0,
      evidencePreview: evidence,
      createdAt: '2026-07-12T00:00:00.000Z',
      reviewedAt: null,
      updatedAt: '2026-07-12T00:00:00.000Z',
      archivedAt: null,
    };
    const metrics: KnowledgeFactMetrics = {
      activePendingCount: 1,
      activeConfirmedCount: 0,
      staleConfirmedCount: 0,
      rejectedHistoryCount: 0,
      archivedHistoryCount: 0,
      unduplicatedLegacyConfirmedCount: 2,
      totalAiKnowledgeCount: 3,
    };
    const listRequest: KnowledgeListFactsRequest = {
      workspaceId: 'workspace-1',
      view: KnowledgeFactListView.Active,
      reviewStatuses: [KnowledgeFactReviewStatus.Pending],
      evidenceState: KnowledgeFactEvidenceState.Active,
      cursor: 'opaque-cursor',
      limit: 50,
    };
    const listResult: KnowledgeFactListResult = {
      items: [fact],
      nextCursor: null,
      metrics,
    };
    const evidencePageRequest: KnowledgeFactEvidencePageRequest = {
      factId: 'fact-1',
      expectedRevision: 1,
      cursor: 'opaque-evidence-cursor',
      limit: 50,
    };
    const evidencePageResult: KnowledgeFactEvidencePageResult = {
      factId: 'fact-1',
      factRevision: 1,
      items: [evidence],
      nextCursor: null,
    };
    const reviewRequest: KnowledgeReviewFactRequest = {
      factId: 'fact-1',
      expectedRevision: 1,
      decision: KnowledgeFactReviewDecision.Confirm,
      replaceExisting: false,
      expectedFieldRevision: 1,
    };
    const projectionConflict: KnowledgeFactProjectionConflict = {
      operation: KnowledgeFactProjectionOperation.Confirm,
      kind: KnowledgeFactProjectionConflictKind.CompanySummaryReplacement,
      factId: 'fact-1',
      factRevision: 1,
      domain: KnowledgeFactDomain.CompanySummary,
      currentFieldValue: 'Current safe summary',
      fieldRevision: 4,
    };
    const archiveRequest: KnowledgeArchiveFactRequest = {
      factId: 'fact-1',
      expectedRevision: 2,
      projectionDecision: KnowledgeFactArchiveProjectionDecision.KeepCurrent,
      expectedFieldRevision: 3,
    };
    const reviewResult: KnowledgeFactReviewResult = {
      fact,
      profileChanged: true,
      profileRevision: 2,
      fieldRevision: 2,
    };
    const archiveResult: KnowledgeFactArchiveResult = {
      fact: { ...fact, archivedAt: '2026-07-12T00:01:00.000Z' },
      profileChanged: false,
      profileRevision: 2,
      fieldRevision: 2,
    };

    expectExactDtoKeys(enrichment, enrichmentSummaryKeys);
    expectExactDtoKeys(authorizationDescriptor, authorizationDescriptorKeys);
    expectExactDtoKeys(evidence, factEvidenceSummaryKeys);
    expectExactDtoKeys(evidencePageRequest, factEvidencePageRequestKeys);
    expectExactDtoKeys(evidencePageResult, factEvidencePageResultKeys);
    expectExactDtoKeys(fact, factSummaryKeys);
    expectExactDtoKeys(metrics, factMetricsKeys);
    expectExactDtoKeys(listRequest, listFactsRequestKeys);
    expectExactDtoKeys(listResult, factListResultKeys);
    expectExactDtoKeys(reviewRequest, reviewFactRequestKeys);
    expectExactDtoKeys(projectionConflict, factProjectionConflictKeys);
    expectExactDtoKeys(reviewResult, factReviewResultKeys);
    expectExactDtoKeys(archiveRequest, archiveFactRequestKeys);
    expectExactDtoKeys(archiveResult, factArchiveResultKeys);

    const serialized = JSON.stringify({
      authorizationDescriptor,
      enrichment,
      evidence,
      evidencePageRequest,
      evidencePageResult,
      fact,
      metrics,
      listRequest,
      listResult,
      reviewRequest,
      projectionConflict,
      reviewResult,
      archiveRequest,
      archiveResult,
    });
    for (const forbiddenKey of [
      'content',
      'chunkText',
      'extractedText',
      'apiKey',
      'baseURL',
      'routingFingerprint',
      'authorizationToken',
      'managedPath',
      'absolutePath',
      'rawResponse',
      'errorMessage',
    ]) {
      expect(serialized).not.toContain(`\"${forbiddenKey}\"`);
    }
  });

  test('limits authorization preparation to an opaque token and safe descriptor', () => {
    const descriptor: KnowledgeExtractionAuthorizationDescriptor = {
      workspaceId: 'workspace-1',
      documentId: 'document-1',
      documentVersionId: 'version-1',
      documentDisplayName: 'factory.pdf',
      providerId: 'provider-1',
      providerLabel: 'OpenAI compatible',
      modelId: 'model-1',
      modelLabel: 'Model One',
      plannedModelCalls: 1,
      partial: false,
      expiresAt: '2026-07-12T00:02:00.000Z',
    };
    const preparation: KnowledgeExtractionAuthorizationPreparation = {
      authorizationToken: 'opaque-token',
      descriptor,
    };

    expectExactDtoKeys(preparation, authorizationPreparationKeys);
    expectExactDtoKeys(preparation.descriptor, authorizationDescriptorKeys);
    expect(preparation.descriptor).toEqual(descriptor);
    expect(JSON.stringify(preparation.descriptor)).not.toContain('authorizationToken');
  });
});
