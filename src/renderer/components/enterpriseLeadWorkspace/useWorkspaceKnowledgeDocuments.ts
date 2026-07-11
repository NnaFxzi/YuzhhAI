import { useCallback, useEffect, useRef, useState } from 'react';

import {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentVisibility as KnowledgeDocumentVisibilities,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeDocumentDetails,
  KnowledgeDocumentListItem,
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

export const createKnowledgeDocumentPollingController = (options: {
  loadDocuments: () => Promise<KnowledgeDocumentListItem[]>;
  onDocuments: (documents: KnowledgeDocumentListItem[]) => void;
  onError: (error: unknown) => void;
  intervalMs?: number;
}): KnowledgeDocumentPollingController => {
  let disposed = false;
  let documents: KnowledgeDocumentListItem[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  const intervalMs = options.intervalMs ?? KNOWLEDGE_DOCUMENT_POLL_INTERVAL_MS;

  const clearTimer = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = (): void => {
    clearTimer();
    if (disposed || !shouldPollKnowledgeDocuments(documents)) {
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
      return inFlight;
    }
    clearTimer();
    let request!: Promise<void>;
    request = (async () => {
      try {
        const nextDocuments = await options.loadDocuments();
        if (!disposed) {
          documents = nextDocuments;
          options.onDocuments(nextDocuments);
        }
      } catch (error) {
        if (!disposed) {
          options.onError(error);
        }
      } finally {
        if (inFlight === request) {
          inFlight = null;
          schedule();
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
  error: KnowledgeBaseServiceError | null;
  clearError: () => void;
  refresh: () => Promise<void>;
  selectAndImport: () => Promise<KnowledgeImportBatchResult | null>;
  deleteDocument: (document: KnowledgeDocumentListItem) => Promise<void>;
  restoreDocument: (document: KnowledgeDocumentListItem) => Promise<void>;
  retryDocument: (document: KnowledgeDocumentListItem) => Promise<void>;
  retryLocalIndex: (document: KnowledgeDocumentListItem) => Promise<void>;
  loadDetails: (documentId: string) => Promise<void>;
}

export const useWorkspaceKnowledgeDocuments = (
  workspaceId: string,
  initialImportResult?: KnowledgeImportBatchResult,
  service: KnowledgeBaseServiceApi = knowledgeBaseService,
): WorkspaceKnowledgeDocumentsState => {
  const [documents, setDocuments] = useState<KnowledgeDocumentListItem[]>([]);
  const [deletedDocuments, setDeletedDocuments] = useState<KnowledgeDocumentListItem[]>([]);
  const [selectedDetails, setSelectedDetails] = useState<KnowledgeDocumentDetails | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [lastImportResult, setLastImportResult] = useState<KnowledgeImportBatchResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<KnowledgeBaseServiceError | null>(null);
  const pollerRef = useRef<KnowledgeDocumentPollingController | null>(null);
  const generationRef = useRef(0);
  const workspaceIdRef = useRef(workspaceId);
  const detailsRequestSequencerRef = useRef<KnowledgeDocumentRequestSequencer | null>(null);
  if (!detailsRequestSequencerRef.current) {
    detailsRequestSequencerRef.current = createKnowledgeDocumentRequestSequencer();
  }
  workspaceIdRef.current = workspaceId;

  const toServiceError = useCallback((caught: unknown): KnowledgeBaseServiceError => {
    return caught instanceof KnowledgeBaseServiceError
      ? caught
      : new KnowledgeBaseServiceError(KnowledgeBaseErrorCode.PersistenceFailed);
  }, []);

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
    detailsRequestSequencerRef.current?.invalidate();
    setSelectedDetails(null);
    setSelectedDocumentId(null);
    setIsDetailsLoading(false);
    setLastImportResult(initialImportResult ?? null);
    setError(null);
    setIsLoading(true);
    setIsMutating(false);
    const poller = createKnowledgeDocumentPollingController({
      loadDocuments: loadVisibleDocuments,
      onDocuments: nextDocuments => {
        if (generationRef.current === generation && workspaceIdRef.current === workspaceId) {
          setDocuments(nextDocuments.filter(document => !document.deletedAt));
          setDeletedDocuments(nextDocuments.filter(document => Boolean(document.deletedAt)));
        }
      },
      onError: caught => {
        if (generationRef.current === generation && workspaceIdRef.current === workspaceId) {
          setError(toServiceError(caught));
        }
      },
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

  return {
    documents,
    deletedDocuments,
    selectedDetails,
    selectedDocumentId,
    lastImportResult,
    isLoading,
    isDetailsLoading,
    isMutating,
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
