import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentVisibility as KnowledgeDocumentVisibilities,
  KnowledgeEnrichmentStatus,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeDocumentDetails,
  KnowledgeDocumentListItem,
  KnowledgeEnrichmentSummary,
  KnowledgeExtractionAuthorizationPreparation,
  KnowledgeImportBatchResult,
} from '../../../shared/knowledgeBase/types';
import { knowledgeBaseService, KnowledgeBaseServiceError } from '../../services/knowledgeBase';
import { shouldPollKnowledgeDocuments } from './knowledgeDocumentPresentation';

const KNOWLEDGE_DOCUMENT_POLL_INTERVAL_MS = 2_000;

export interface KnowledgeDocumentPollingController {
  refresh: () => Promise<void>;
  update: (documents: KnowledgeDocumentListItem[]) => void;
  dispose: () => void;
}

const collectUnnotifiedKnowledgeReviewRequired = (
  notifiedRequestKeys: Set<string>,
  incomingDocuments: readonly KnowledgeDocumentListItem[],
): boolean => {
  let foundUnnotifiedRequest = false;
  incomingDocuments.forEach(document => {
    const enrichment = document.enrichment;
    if (
      enrichment?.documentVersionId === document.currentVersionId &&
      enrichment.status === KnowledgeEnrichmentStatus.ReviewRequired
    ) {
      const requestKey = JSON.stringify([
        document.id,
        document.currentVersionId,
        enrichment.requestId,
      ]);
      if (!notifiedRequestKeys.has(requestKey)) {
        notifiedRequestKeys.add(requestKey);
        foundUnnotifiedRequest = true;
      }
    }
  });
  return foundUnnotifiedRequest;
};

export const createKnowledgeDocumentPollingController = (options: {
  loadDocuments: () => Promise<KnowledgeDocumentListItem[]>;
  onDocuments: (documents: KnowledgeDocumentListItem[]) => void;
  onError: (error: unknown) => void;
  onReviewRequired?: () => Promise<void> | void;
  intervalMs?: number;
}): KnowledgeDocumentPollingController => {
  let disposed = false;
  let documents: KnowledgeDocumentListItem[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let trailingRefreshRequested = false;
  const notifiedReviewRequiredRequestKeys = new Set<string>();
  const intervalMs = options.intervalMs ?? KNOWLEDGE_DOCUMENT_POLL_INTERVAL_MS;

  const clearTimer = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = (): void => {
    clearTimer();
    if (disposed || inFlight || !shouldPollKnowledgeDocuments(documents)) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      void refresh();
    }, intervalMs);
  };

  const refresh = (): Promise<void> => {
    if (disposed) {
      return Promise.resolve();
    }
    if (inFlight) {
      trailingRefreshRequested = true;
      return inFlight;
    }
    clearTimer();
    let request!: Promise<void>;
    request = (async () => {
      try {
        const nextDocuments = await options.loadDocuments();
        if (!disposed) {
          const enteredReviewRequired = collectUnnotifiedKnowledgeReviewRequired(
            notifiedReviewRequiredRequestKeys,
            nextDocuments,
          );
          documents = nextDocuments;
          options.onDocuments(nextDocuments);
          if (enteredReviewRequired) {
            try {
              void Promise.resolve(options.onReviewRequired?.()).catch(() => undefined);
            } catch {
              // Metrics refresh is best-effort and cannot invalidate accepted document state.
            }
          }
        }
      } catch (error) {
        if (!disposed) {
          options.onError(error);
        }
      } finally {
        if (inFlight === request) {
          inFlight = null;
          if (trailingRefreshRequested && !disposed) {
            trailingRefreshRequested = false;
            void refresh();
          } else {
            schedule();
          }
        }
      }
    })();
    inFlight = request;
    return request;
  };

  return {
    refresh,
    update: nextDocuments => {
      documents = nextDocuments;
      schedule();
    },
    dispose: () => {
      disposed = true;
      trailingRefreshRequested = false;
      clearTimer();
    },
  };
};

export const runKnowledgeDocumentGenerationTask = async <T>(options: {
  operation: () => Promise<T>;
  isCurrent: () => boolean;
  onCurrentSuccess?: (value: T) => Promise<void> | void;
  onCurrentError?: (error: unknown) => Promise<void> | void;
  onCurrentSettled?: () => Promise<void> | void;
}): Promise<T> => {
  try {
    const value = await options.operation();
    if (options.isCurrent()) {
      await options.onCurrentSuccess?.(value);
    }
    return value;
  } catch (error) {
    if (options.isCurrent()) {
      await options.onCurrentError?.(error);
    }
    throw error;
  } finally {
    if (options.isCurrent()) {
      await options.onCurrentSettled?.();
    }
  }
};

export const runKnowledgeDocumentExtractionMutationTask = async <T>(options: {
  operation: () => Promise<T>;
  isCurrentResult: () => boolean;
  isCurrentOperation: () => boolean;
  onCurrentSuccess?: (value: T) => Promise<void> | void;
  onCurrentError?: (error: unknown) => Promise<void> | void;
  onOwnedSettled?: () => Promise<void> | void;
}): Promise<T> => {
  try {
    return await runKnowledgeDocumentGenerationTask({
      operation: options.operation,
      isCurrent: options.isCurrentResult,
      onCurrentSuccess: options.onCurrentSuccess,
      onCurrentError: options.onCurrentError,
    });
  } finally {
    if (options.isCurrentOperation()) {
      await options.onOwnedSettled?.();
    }
  }
};

export interface KnowledgeDocumentRequestSequencer {
  next: () => number;
  isCurrent: (requestId: number) => boolean;
  invalidate: () => void;
}

export const createKnowledgeDocumentRequestSequencer = (): KnowledgeDocumentRequestSequencer => {
  let currentRequestId = 0;
  return {
    next: () => {
      currentRequestId += 1;
      return currentRequestId;
    },
    isCurrent: requestId => requestId === currentRequestId,
    invalidate: () => {
      currentRequestId += 1;
    },
  };
};

type KnowledgeBaseServiceApi = typeof knowledgeBaseService;

export interface UseWorkspaceKnowledgeDocumentsOptions {
  service?: KnowledgeBaseServiceApi;
  onReviewRequired?: () => Promise<void> | void;
  refreshToken?: number;
}

export const toKnowledgeDocumentServiceError = (caught: unknown): KnowledgeBaseServiceError =>
  caught instanceof KnowledgeBaseServiceError
    ? caught
    : new KnowledgeBaseServiceError(KnowledgeBaseErrorCode.PersistenceFailed);

const getCurrentDocumentEnrichment = (
  document: KnowledgeDocumentListItem,
): KnowledgeEnrichmentSummary | null =>
  document.enrichment?.documentVersionId === document.currentVersionId
    ? document.enrichment
    : null;

const compareSafeTimestamp = (left: string, right: string): number => {
  const leftTimestamp = Date.parse(left);
  const rightTimestamp = Date.parse(right);
  if (Number.isNaN(leftTimestamp) || Number.isNaN(rightTimestamp)) {
    return left.localeCompare(right);
  }
  return leftTimestamp - rightTimestamp;
};

const selectNewerEnrichment = (
  current: KnowledgeEnrichmentSummary | null,
  incoming: KnowledgeEnrichmentSummary | null,
): KnowledgeEnrichmentSummary | null => {
  if (!current) {
    return incoming;
  }
  if (!incoming) {
    return current;
  }
  if (
    current.requestId === incoming.requestId &&
    current.revision !== incoming.revision
  ) {
    return incoming.revision > current.revision ? incoming : current;
  }
  const updatedComparison = compareSafeTimestamp(incoming.updatedAt, current.updatedAt);
  if (updatedComparison !== 0) {
    return updatedComparison > 0 ? incoming : current;
  }
  const createdComparison = compareSafeTimestamp(incoming.createdAt, current.createdAt);
  if (createdComparison !== 0) {
    return createdComparison > 0 ? incoming : current;
  }
  return incoming.revision > current.revision ? incoming : current;
};

export const mergeKnowledgeDocumentListItems = (
  currentDocuments: readonly KnowledgeDocumentListItem[],
  incomingDocuments: readonly KnowledgeDocumentListItem[],
): KnowledgeDocumentListItem[] => {
  const currentById = new Map(currentDocuments.map(document => [document.id, document]));
  return incomingDocuments.map(incoming => {
    const current = currentById.get(incoming.id);
    if (!current || current.currentVersionId !== incoming.currentVersionId) {
      return incoming;
    }
    const enrichment = selectNewerEnrichment(
      getCurrentDocumentEnrichment(current),
      getCurrentDocumentEnrichment(incoming),
    );
    if (
      enrichment === incoming.enrichment &&
      (!enrichment || !incoming.hasStalePriorVersionExtraction)
    ) {
      return incoming;
    }
    return {
      ...incoming,
      enrichment,
      hasStalePriorVersionExtraction: enrichment
        ? false
        : incoming.hasStalePriorVersionExtraction,
    };
  });
};

export const applyKnowledgeDocumentEnrichmentSummary = (
  documents: readonly KnowledgeDocumentListItem[],
  summary: KnowledgeEnrichmentSummary,
): KnowledgeDocumentListItem[] =>
  documents.map(document => {
    if (
      document.id !== summary.documentId ||
      document.currentVersionId !== summary.documentVersionId
    ) {
      return document;
    }
    const enrichment = selectNewerEnrichment(getCurrentDocumentEnrichment(document), summary);
    return enrichment === document.enrichment
      ? document
      : {
          ...document,
          enrichment,
          hasStalePriorVersionExtraction: false,
        };
  });

export const applyCurrentKnowledgeDocumentExtractionResult = async (options: {
  summary: KnowledgeEnrichmentSummary;
  getDocuments: () => readonly KnowledgeDocumentListItem[];
  commitDocuments: (documents: KnowledgeDocumentListItem[]) => void;
  refresh: () => Promise<void> | void;
}): Promise<void> => {
  const nextDocuments = applyKnowledgeDocumentEnrichmentSummary(
    options.getDocuments(),
    options.summary,
  );
  options.commitDocuments(nextDocuments);
  await options.refresh();
};

export const prepareKnowledgeDocumentExtractionAuthorization = (
  service: Pick<KnowledgeBaseServiceApi, 'prepareExtractionAuthorization'>,
  document: KnowledgeDocumentListItem,
): Promise<KnowledgeExtractionAuthorizationPreparation> =>
  service.prepareExtractionAuthorization({
    documentId: document.id,
    documentVersionId: document.currentVersionId,
  });

export const prepareCurrentKnowledgeDocumentExtractionAuthorization = async (options: {
  service: Pick<KnowledgeBaseServiceApi, 'prepareExtractionAuthorization'>;
  document: KnowledgeDocumentListItem;
  workspaceId: string;
  isCurrent: () => boolean;
}): Promise<KnowledgeExtractionAuthorizationPreparation> => {
  const preparation = await prepareKnowledgeDocumentExtractionAuthorization(
    options.service,
    options.document,
  );
  if (
    !options.isCurrent() ||
    preparation.descriptor.workspaceId !== options.workspaceId ||
    preparation.descriptor.documentId !== options.document.id ||
    preparation.descriptor.documentVersionId !== options.document.currentVersionId
  ) {
    throw new KnowledgeBaseServiceError(KnowledgeBaseErrorCode.InvalidRequest);
  }
  return preparation;
};

export const requestKnowledgeDocumentExtraction = (
  service: Pick<KnowledgeBaseServiceApi, 'requestExtraction'>,
  authorizationToken: string,
): Promise<KnowledgeEnrichmentSummary> =>
  service.requestExtraction({ authorizationToken });

const retryableExtractionStatuses = new Set<KnowledgeEnrichmentStatus>([
  KnowledgeEnrichmentStatus.Failed,
  KnowledgeEnrichmentStatus.Cancelled,
  KnowledgeEnrichmentStatus.Stale,
]);

const getRequiredCurrentEnrichment = (
  document: KnowledgeDocumentListItem,
  allowedStatuses: ReadonlySet<KnowledgeEnrichmentStatus>,
): KnowledgeEnrichmentSummary => {
  const enrichment = getCurrentDocumentEnrichment(document);
  if (!enrichment || !allowedStatuses.has(enrichment.status)) {
    throw new KnowledgeBaseServiceError(KnowledgeBaseErrorCode.InvalidRequest);
  }
  return enrichment;
};

export const retryKnowledgeDocumentExtraction = (
  service: Pick<KnowledgeBaseServiceApi, 'retryExtraction'>,
  document: KnowledgeDocumentListItem,
  authorizationToken: string,
): Promise<KnowledgeEnrichmentSummary> =>
  Promise.resolve().then(() => {
    const enrichment = getRequiredCurrentEnrichment(document, retryableExtractionStatuses);
    return service.retryExtraction({
      requestId: enrichment.requestId,
      authorizationToken,
    });
  });

const cancellableExtractionStatuses = new Set<KnowledgeEnrichmentStatus>([
  KnowledgeEnrichmentStatus.Queued,
  KnowledgeEnrichmentStatus.Running,
]);

export const cancelKnowledgeDocumentExtraction = (
  service: Pick<KnowledgeBaseServiceApi, 'cancelExtraction'>,
  document: KnowledgeDocumentListItem,
): Promise<KnowledgeEnrichmentSummary> =>
  Promise.resolve().then(() => {
    const enrichment = getRequiredCurrentEnrichment(document, cancellableExtractionStatuses);
    return service.cancelExtraction({
      requestId: enrichment.requestId,
      expectedRevision: enrichment.revision,
    });
  });

export const retryKnowledgeDocumentLocalIndex = async (
  service: Pick<KnowledgeBaseServiceApi, 'retryLocalIndex'>,
  document: KnowledgeDocumentListItem,
): Promise<void> => {
  await service.retryLocalIndex(document.id, document.currentVersionId);
};

export interface WorkspaceKnowledgeDocumentsState {
  documents: KnowledgeDocumentListItem[];
  deletedDocuments: KnowledgeDocumentListItem[];
  selectedDetails: KnowledgeDocumentDetails | null;
  selectedDocumentId: string | null;
  lastImportResult: KnowledgeImportBatchResult | null;
  isLoading: boolean;
  isDetailsLoading: boolean;
  isMutating: boolean;
  extractionMutatingDocumentIds: string[];
  error: KnowledgeBaseServiceError | null;
  clearError: () => void;
  refresh: () => Promise<void>;
  selectAndImport: () => Promise<KnowledgeImportBatchResult | null>;
  deleteDocument: (document: KnowledgeDocumentListItem) => Promise<void>;
  restoreDocument: (document: KnowledgeDocumentListItem) => Promise<void>;
  retryDocument: (document: KnowledgeDocumentListItem) => Promise<void>;
  retryLocalIndex: (document: KnowledgeDocumentListItem) => Promise<void>;
  prepareExtractionAuthorization: (
    document: KnowledgeDocumentListItem,
  ) => Promise<KnowledgeExtractionAuthorizationPreparation>;
  requestExtraction: (
    document: KnowledgeDocumentListItem,
    authorizationToken: string,
  ) => Promise<void>;
  retryExtraction: (
    document: KnowledgeDocumentListItem,
    authorizationToken: string,
  ) => Promise<void>;
  cancelExtraction: (document: KnowledgeDocumentListItem) => Promise<void>;
  loadDetails: (documentId: string) => Promise<void>;
}

export const useWorkspaceKnowledgeDocuments = (
  workspaceId: string,
  initialImportResult?: KnowledgeImportBatchResult,
  options: UseWorkspaceKnowledgeDocumentsOptions = {},
): WorkspaceKnowledgeDocumentsState => {
  const service = options.service ?? knowledgeBaseService;
  const refreshToken = options.refreshToken;
  const [documents, setDocuments] = useState<KnowledgeDocumentListItem[]>([]);
  const [deletedDocuments, setDeletedDocuments] = useState<KnowledgeDocumentListItem[]>([]);
  const [selectedDetails, setSelectedDetails] = useState<KnowledgeDocumentDetails | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [lastImportResult, setLastImportResult] = useState<KnowledgeImportBatchResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [extractionMutatingDocumentIds, setExtractionMutatingDocumentIds] = useState<string[]>([]);
  const [error, setError] = useState<KnowledgeBaseServiceError | null>(null);
  const pollerRef = useRef<KnowledgeDocumentPollingController | null>(null);
  const previousRefreshTokenRef = useRef(refreshToken);
  const generationRef = useRef(0);
  const workspaceIdRef = useRef(workspaceId);
  const documentsRef = useRef<KnowledgeDocumentListItem[]>([]);
  const deletedDocumentsRef = useRef<KnowledgeDocumentListItem[]>([]);
  const extractionOperationIdsRef = useRef(new Map<string, number>());
  const onReviewRequiredRef = useRef(options.onReviewRequired);
  const detailsRequestSequencerRef = useRef<KnowledgeDocumentRequestSequencer | null>(null);
  if (!detailsRequestSequencerRef.current) {
    detailsRequestSequencerRef.current = createKnowledgeDocumentRequestSequencer();
  }
  workspaceIdRef.current = workspaceId;
  documentsRef.current = documents;
  deletedDocumentsRef.current = deletedDocuments;

  useLayoutEffect(() => {
    onReviewRequiredRef.current = options.onReviewRequired;
  }, [options.onReviewRequired]);

  const toServiceError = useCallback(toKnowledgeDocumentServiceError, []);

  const loadVisibleDocuments = useCallback(async (): Promise<KnowledgeDocumentListItem[]> => {
    const [active, deleted] = await Promise.all([
      service.listDocuments(workspaceId, KnowledgeDocumentVisibilities.Active),
      service.listDocuments(workspaceId, KnowledgeDocumentVisibilities.Deleted),
    ]);
    return [...active, ...deleted];
  }, [service, workspaceId]);

  const refresh = useCallback(async (): Promise<void> => {
    const generation = generationRef.current;
    const requestWorkspaceId = workspaceIdRef.current;
    setIsLoading(true);
    try {
      await pollerRef.current?.refresh();
    } catch (caught) {
      if (generationRef.current === generation && workspaceIdRef.current === requestWorkspaceId) {
        setError(toServiceError(caught));
      }
    } finally {
      if (generationRef.current === generation && workspaceIdRef.current === requestWorkspaceId) {
        setIsLoading(false);
      }
    }
  }, [toServiceError]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    setDocuments([]);
    setDeletedDocuments([]);
    documentsRef.current = [];
    deletedDocumentsRef.current = [];
    extractionOperationIdsRef.current.clear();
    detailsRequestSequencerRef.current?.invalidate();
    setSelectedDetails(null);
    setSelectedDocumentId(null);
    setIsDetailsLoading(false);
    setLastImportResult(initialImportResult ?? null);
    setError(null);
    setIsLoading(true);
    setIsMutating(false);
    setExtractionMutatingDocumentIds([]);
    const poller = createKnowledgeDocumentPollingController({
      loadDocuments: loadVisibleDocuments,
      onDocuments: nextDocuments => {
        if (generationRef.current === generation && workspaceIdRef.current === workspaceId) {
          const nextActiveDocuments = nextDocuments.filter(document => !document.deletedAt);
          const nextDeletedDocuments = nextDocuments.filter(document => Boolean(document.deletedAt));
          setDocuments(current => {
            const merged = mergeKnowledgeDocumentListItems(current, nextActiveDocuments);
            documentsRef.current = merged;
            return merged;
          });
          setDeletedDocuments(current => {
            const merged = mergeKnowledgeDocumentListItems(current, nextDeletedDocuments);
            deletedDocumentsRef.current = merged;
            return merged;
          });
        }
      },
      onError: caught => {
        if (generationRef.current === generation && workspaceIdRef.current === workspaceId) {
          setError(toServiceError(caught));
        }
      },
      onReviewRequired: () => onReviewRequiredRef.current?.(),
    });
    pollerRef.current = poller;
    void poller.refresh().finally(() => {
      if (generationRef.current === generation && workspaceIdRef.current === workspaceId) {
        setIsLoading(false);
      }
    });
    return () => {
      poller.dispose();
      if (pollerRef.current === poller) {
        pollerRef.current = null;
      }
    };
  }, [initialImportResult, loadVisibleDocuments, toServiceError, workspaceId]);

  useEffect(() => {
    pollerRef.current?.update([...documents, ...deletedDocuments]);
  }, [deletedDocuments, documents]);

  useEffect(() => {
    if (previousRefreshTokenRef.current === refreshToken) {
      return;
    }
    previousRefreshTokenRef.current = refreshToken;
    void refresh();
  }, [refresh, refreshToken]);

  useEffect(() => {
    if (!selectedDetails) {
      return;
    }
    const currentDocument = [...documents, ...deletedDocuments].find(
      document => document.id === selectedDetails.document.id,
    );
    if (
      currentDocument &&
      currentDocument.currentVersionId === selectedDetails.document.currentVersionId &&
      currentDocument.status === selectedDetails.document.status &&
      currentDocument.updatedAt === selectedDetails.document.updatedAt &&
      currentDocument.deletedAt === selectedDetails.document.deletedAt
    ) {
      return;
    }
    detailsRequestSequencerRef.current?.invalidate();
    setSelectedDetails(null);
    setSelectedDocumentId(null);
    setIsDetailsLoading(false);
  }, [deletedDocuments, documents, selectedDetails]);

  const runMutation = useCallback(
    async <T>(
      operation: () => Promise<T>,
      onCurrentSuccess?: (value: T) => Promise<void> | void,
    ): Promise<T> => {
      const generation = generationRef.current;
      const operationWorkspaceId = workspaceIdRef.current;
      setIsMutating(true);
      setError(null);
      try {
        return await runKnowledgeDocumentGenerationTask({
          operation,
          isCurrent: () =>
            generationRef.current === generation && workspaceIdRef.current === operationWorkspaceId,
          onCurrentSuccess,
          onCurrentError: caught => {
            const serviceError = toServiceError(caught);
            setError(serviceError);
            if (serviceError.latestDocument) {
              setDocuments(current =>
                current.map(document =>
                  document.id === serviceError.latestDocument?.id
                    ? serviceError.latestDocument
                    : document,
                ),
              );
            }
          },
          onCurrentSettled: () => {
            setIsMutating(false);
          },
        });
      } catch (caught) {
        throw toServiceError(caught);
      }
    },
    [toServiceError],
  );

  const getCurrentActiveDocument = useCallback(
    (document: KnowledgeDocumentListItem): KnowledgeDocumentListItem => {
      const current = documentsRef.current.find(item => item.id === document.id);
      if (!current || current.currentVersionId !== document.currentVersionId) {
        throw new KnowledgeBaseServiceError(KnowledgeBaseErrorCode.InvalidRequest);
      }
      return current;
    },
    [],
  );

  const runExtractionMutation = useCallback(
    async (
      document: KnowledgeDocumentListItem,
      operation: (currentDocument: KnowledgeDocumentListItem) => Promise<KnowledgeEnrichmentSummary>,
    ): Promise<void> => {
      let currentDocument: KnowledgeDocumentListItem;
      try {
        currentDocument = getCurrentActiveDocument(document);
      } catch (caught) {
        throw toServiceError(caught);
      }
      const generation = generationRef.current;
      const operationWorkspaceId = workspaceIdRef.current;
      const operationId = (extractionOperationIdsRef.current.get(document.id) ?? 0) + 1;
      extractionOperationIdsRef.current.set(document.id, operationId);
      setExtractionMutatingDocumentIds(current =>
        current.includes(document.id) ? current : [...current, document.id],
      );
      setError(null);

      const isCurrentOperation = (): boolean =>
        generationRef.current === generation &&
        workspaceIdRef.current === operationWorkspaceId &&
        extractionOperationIdsRef.current.get(document.id) === operationId;
      const isCurrentResult = (): boolean =>
        isCurrentOperation() &&
        documentsRef.current.some(
          item =>
            item.id === document.id &&
            item.currentVersionId === currentDocument.currentVersionId,
        );

      try {
        await runKnowledgeDocumentExtractionMutationTask({
          operation: () => operation(currentDocument),
          isCurrentResult,
          isCurrentOperation,
          onCurrentSuccess: async summary => {
            await applyCurrentKnowledgeDocumentExtractionResult({
              summary,
              getDocuments: () => documentsRef.current,
              commitDocuments: next => {
                setDocuments(next);
                documentsRef.current = next;
              },
              refresh: () => pollerRef.current?.refresh() ?? Promise.resolve(),
            });
          },
          onCurrentError: caught => {
            setError(toServiceError(caught));
          },
          onOwnedSettled: () => {
            setExtractionMutatingDocumentIds(current =>
              current.filter(documentId => documentId !== document.id),
            );
          },
        });
      } catch (caught) {
        throw toServiceError(caught);
      }
    },
    [getCurrentActiveDocument, toServiceError],
  );

  return {
    documents,
    deletedDocuments,
    selectedDetails,
    selectedDocumentId,
    lastImportResult,
    isLoading,
    isDetailsLoading,
    isMutating,
    extractionMutatingDocumentIds,
    error,
    clearError: () => setError(null),
    refresh,
    selectAndImport: () =>
      runMutation(
        async () => {
          const selection = await service.selectFiles();
          if (!selection) {
            return null;
          }
          return service.importSelection(workspaceId, selection.selectionToken);
        },
        async result => {
          if (result) {
            setLastImportResult(result);
            await refresh();
          }
        },
      ),
    deleteDocument: document =>
      runMutation(
        () => service.deleteDocument(document.id, document.revision).then(() => undefined),
        refresh,
      ),
    restoreDocument: document =>
      runMutation(
        () => service.restoreDocument(document.id, document.revision).then(() => undefined),
        refresh,
      ),
    retryDocument: document =>
      runMutation(
        () => service.retryDocument(document.id, document.currentVersionId).then(() => undefined),
        refresh,
      ),
    retryLocalIndex: document =>
      runMutation(
        () => retryKnowledgeDocumentLocalIndex(service, document),
        refresh,
      ),
    prepareExtractionAuthorization: async document => {
      let currentDocument: KnowledgeDocumentListItem;
      try {
        currentDocument = getCurrentActiveDocument(document);
        const generation = generationRef.current;
        const operationWorkspaceId = workspaceIdRef.current;
        return await prepareCurrentKnowledgeDocumentExtractionAuthorization({
          service,
          document: currentDocument,
          workspaceId: operationWorkspaceId,
          isCurrent: () =>
            generationRef.current === generation &&
            workspaceIdRef.current === operationWorkspaceId &&
            documentsRef.current.some(
              item =>
                item.id === currentDocument.id &&
                item.currentVersionId === currentDocument.currentVersionId,
            ),
        });
      } catch (caught) {
        throw toServiceError(caught);
      }
    },
    requestExtraction: (document, authorizationToken) =>
      runExtractionMutation(document, () =>
        requestKnowledgeDocumentExtraction(service, authorizationToken),
      ),
    retryExtraction: (document, authorizationToken) =>
      runExtractionMutation(document, currentDocument =>
        retryKnowledgeDocumentExtraction(service, currentDocument, authorizationToken),
      ),
    cancelExtraction: document =>
      runExtractionMutation(document, currentDocument =>
        cancelKnowledgeDocumentExtraction(service, currentDocument),
      ),
    loadDetails: async documentId => {
      const generation = generationRef.current;
      const operationWorkspaceId = workspaceIdRef.current;
      const requestSequencer =
        detailsRequestSequencerRef.current ?? createKnowledgeDocumentRequestSequencer();
      detailsRequestSequencerRef.current = requestSequencer;
      const requestId = requestSequencer.next();
      setSelectedDocumentId(documentId);
      setSelectedDetails(null);
      setIsDetailsLoading(true);
      setError(null);
      try {
        await runKnowledgeDocumentGenerationTask({
          operation: () => service.getDocumentDetails(documentId),
          isCurrent: () =>
            generationRef.current === generation &&
            workspaceIdRef.current === operationWorkspaceId &&
            requestSequencer.isCurrent(requestId),
          onCurrentSuccess: setSelectedDetails,
          onCurrentError: caught => {
            setError(toServiceError(caught));
          },
          onCurrentSettled: () => {
            setIsDetailsLoading(false);
          },
        });
      } catch (caught) {
        throw toServiceError(caught);
      }
    },
  };
};
