import { useEffect, useMemo, useRef, useState } from 'react';

import {
  KnowledgeFactBatchAction,
  type KnowledgeFactBatchAction as KnowledgeFactBatchActionValue,
  KnowledgeFactBatchTaskStatus,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeFactBatchReviewRequest,
  KnowledgeFactBatchReviewTask,
  KnowledgeFactSummary,
} from '../../../shared/knowledgeBase/types';
import { knowledgeBaseService } from '../../services/knowledgeBase';
import type { WorkspaceAiKnowledgeCanonicalFilters } from './useWorkspaceAiKnowledge';
import type { WorkspaceAiKnowledgeRow } from './workspaceAiKnowledgeRows';
import { buildWorkspaceAiKnowledgeFilterKey } from './workspaceAiKnowledgeState';

const BATCH_REVIEW_STORAGE_KEY_PREFIX = 'ai-knowledge-batch-review:';
const BATCH_REVIEW_POLL_INTERVAL_MS = 750;

type WorkspaceAiKnowledgeBatchSelectionMode = 'page' | 'matching' | null;

interface SelectedKnowledgeFact {
  fact: KnowledgeFactSummary;
  expectedRevision: number;
}

interface StoredBatchReviewTaskHandle {
  taskId: string;
  action?: KnowledgeFactBatchActionValue;
  rejectReason?: string;
}

export interface UseWorkspaceAiKnowledgeBatchReviewInput {
  workspaceId: string;
  rows: readonly WorkspaceAiKnowledgeRow[];
  filters: WorkspaceAiKnowledgeCanonicalFilters;
  nextCursor: string | null;
  onRefresh: () => Promise<readonly WorkspaceAiKnowledgeRow[]> | readonly WorkspaceAiKnowledgeRow[];
}

export interface WorkspaceAiKnowledgeBatchReviewViewModel {
  selectedFacts: ReadonlyMap<string, KnowledgeFactSummary>;
  selectionMode: 'page' | 'matching' | null;
  selectedCount: number;
  visibleSelectableCount: number;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
  /** Whether the current filters can be submitted as a full matching selection. */
  canSelectAllMatching: boolean;
  /** Whether a fully selected page can be expanded to all matching results. */
  canExpandToMatching: boolean;
  task: KnowledgeFactBatchReviewTask | null;
  isStarting: boolean;
  toggleFact: (fact: KnowledgeFactSummary) => void;
  toggleVisible: () => void;
  selectMatching: () => void;
  clearSelection: () => void;
  start: (action: KnowledgeFactBatchActionValue, reason?: string) => Promise<void>;
  retryFailed: () => Promise<void>;
  dismissTask: () => void;
}

const isBatchReviewTaskTerminal = (task: KnowledgeFactBatchReviewTask | null): boolean =>
  task?.status === KnowledgeFactBatchTaskStatus.Completed
  || task?.status === KnowledgeFactBatchTaskStatus.Failed;

const isBatchReviewTaskActive = (task: KnowledgeFactBatchReviewTask | null): boolean =>
  task?.status === KnowledgeFactBatchTaskStatus.Queued
  || task?.status === KnowledgeFactBatchTaskStatus.Running;

const getBatchReviewStorageKey = (workspaceId: string): string =>
  `${BATCH_REVIEW_STORAGE_KEY_PREFIX}${workspaceId}`;

const cloneBatchReviewFilters = (
  filters: WorkspaceAiKnowledgeCanonicalFilters,
): WorkspaceAiKnowledgeCanonicalFilters => ({
  view: filters.view,
  reviewStatuses: [...filters.reviewStatuses],
  evidenceState: filters.evidenceState,
});

const areSelectedFactMapsEqual = (
  left: ReadonlyMap<string, SelectedKnowledgeFact>,
  right: ReadonlyMap<string, SelectedKnowledgeFact>,
): boolean => {
  if (left.size !== right.size) {
    return false;
  }
  for (const [factId, leftEntry] of left) {
    const rightEntry = right.get(factId);
    if (!rightEntry || rightEntry.expectedRevision !== leftEntry.expectedRevision) {
      return false;
    }
  }
  return true;
};

export const isWorkspaceAiKnowledgeBatchSelectableFact = (
  fact: KnowledgeFactSummary,
): boolean =>
  fact.archivedAt === null
  && fact.reviewStatus === KnowledgeFactReviewStatus.Pending
  && fact.activeEvidenceCount > 0
  && fact.projectionState !== KnowledgeFactProjectionState.Conflict;

export const collectWorkspaceAiKnowledgeBatchVisibleSelectableFacts = (
  rows: readonly WorkspaceAiKnowledgeRow[],
): Map<string, SelectedKnowledgeFact> => {
  const selectedFacts = new Map<string, SelectedKnowledgeFact>();
  for (const row of rows) {
    if (
      row.kind !== 'normalized_fact'
      || !isWorkspaceAiKnowledgeBatchSelectableFact(row.fact)
    ) {
      continue;
    }
    selectedFacts.set(row.fact.id, {
      fact: row.fact,
      expectedRevision: row.fact.revision,
    });
  }
  return selectedFacts;
};

const projectSelectedFacts = (
  selectedFacts: ReadonlyMap<string, SelectedKnowledgeFact>,
): ReadonlyMap<string, KnowledgeFactSummary> =>
  new Map(
    [...selectedFacts.entries()].map(([factId, entry]) => [factId, entry.fact] as const),
  );

const buildFactIdSelectionItems = (
  selectedFacts: ReadonlyMap<string, SelectedKnowledgeFact>,
): Array<{ factId: string; expectedRevision: number }> =>
  [...selectedFacts.values()].map(entry => ({
    factId: entry.fact.id,
    expectedRevision: entry.expectedRevision,
  }));

const buildMatchingFiltersSelection = (
  filters: WorkspaceAiKnowledgeCanonicalFilters,
): Extract<KnowledgeFactBatchReviewRequest['selection'], { kind: 'matching_filters' }> => ({
  kind: 'matching_filters',
  filters: {
    ...cloneBatchReviewFilters(filters),
    // Batch review only operates on pending facts. Keep the full-scope action
    // from materializing confirmed rows when the list is showing all statuses.
    reviewStatuses: [KnowledgeFactReviewStatus.Pending],
  },
});

const updateSelectionForVisibleRows = (
  current: ReadonlyMap<string, SelectedKnowledgeFact>,
  visibleSelectableFacts: ReadonlyMap<string, SelectedKnowledgeFact>,
  selectionMode: WorkspaceAiKnowledgeBatchSelectionMode,
): ReadonlyMap<string, SelectedKnowledgeFact> => {
  if (selectionMode === 'matching') {
    return visibleSelectableFacts;
  }
  if (current.size === 0) {
    return current;
  }
  const next = new Map<string, SelectedKnowledgeFact>();
  for (const [factId] of current) {
    const visibleEntry = visibleSelectableFacts.get(factId);
    if (visibleEntry) {
      next.set(factId, visibleEntry);
    }
  }
  return next;
};

const isStoredBatchReviewTaskHandleAction = (
  value: unknown,
): value is KnowledgeFactBatchActionValue =>
  value === KnowledgeFactBatchAction.Confirm
  || value === KnowledgeFactBatchAction.Reject
  || value === KnowledgeFactBatchAction.Archive;

const readSessionStorageTaskHandle = (storageKey: string): StoredBatchReviewTaskHandle | null => {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return null;
  }
  const rawValue = window.sessionStorage.getItem(storageKey);
  if (!rawValue) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return { taskId: rawValue };
    }
    const taskId =
      typeof (parsed as { taskId?: unknown }).taskId === 'string'
        ? (parsed as { taskId: string }).taskId
        : null;
    if (!taskId) {
      return { taskId: rawValue };
    }
    const action = isStoredBatchReviewTaskHandleAction(
      (parsed as { action?: unknown }).action,
    )
      ? (parsed as { action: KnowledgeFactBatchActionValue }).action
      : undefined;
    const rejectReason =
      typeof (parsed as { rejectReason?: unknown }).rejectReason === 'string'
        ? (parsed as { rejectReason: string }).rejectReason
        : undefined;
    return {
      taskId,
      action,
      rejectReason,
    };
  } catch {
    return { taskId: rawValue };
  }
};

const writeSessionStorageTaskHandle = (
  storageKey: string,
  taskHandle: StoredBatchReviewTaskHandle,
): void => {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }
  window.sessionStorage.setItem(storageKey, JSON.stringify(taskHandle));
};

const clearSessionStorageTaskId = (storageKey: string): void => {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }
  window.sessionStorage.removeItem(storageKey);
};

export const useWorkspaceAiKnowledgeBatchReview = ({
  workspaceId,
  rows,
  filters,
  nextCursor,
  onRefresh,
}: UseWorkspaceAiKnowledgeBatchReviewInput): WorkspaceAiKnowledgeBatchReviewViewModel => {
  const storageKey = useMemo(() => getBatchReviewStorageKey(workspaceId), [workspaceId]);
  const filterKey = useMemo(() => buildWorkspaceAiKnowledgeFilterKey(filters), [filters]);
  const visibleSelectableFacts = useMemo(
    () => collectWorkspaceAiKnowledgeBatchVisibleSelectableFacts(rows),
    [rows],
  );
  const [selectedFactsState, setSelectedFactsState] = useState<Map<string, SelectedKnowledgeFact>>(
    () => new Map(),
  );
  const [selectionMode, setSelectionMode] =
    useState<WorkspaceAiKnowledgeBatchSelectionMode>(null);
  const [task, setTask] = useState<KnowledgeFactBatchReviewTask | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const taskHandleRef = useRef<StoredBatchReviewTaskHandle | null>(null);
  const taskRef = useRef<KnowledgeFactBatchReviewTask | null>(null);
  const filtersRef = useRef(filters);
  const onRefreshRef = useRef(onRefresh);
  const taskRefreshHandledRef = useRef<string | null>(null);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    setSelectedFactsState(new Map());
    setSelectionMode(null);
  }, [filterKey, workspaceId]);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  useEffect(() => {
    setSelectedFactsState(current => {
      const next = updateSelectionForVisibleRows(current, visibleSelectableFacts, selectionMode);
      return areSelectedFactMapsEqual(current, next) ? current : new Map(next);
    });
  }, [selectionMode, visibleSelectableFacts]);

  useEffect(() => {
    if (selectionMode === 'page' && selectedFactsState.size === 0) {
      setSelectionMode(null);
    }
  }, [selectedFactsState.size, selectionMode]);

  useEffect(() => {
    setSelectedFactsState(new Map());
    setSelectionMode(null);
    setIsStarting(false);
    setTask(null);
    taskRefreshHandledRef.current = null;
    taskHandleRef.current = null;

    const storedTaskHandle = readSessionStorageTaskHandle(storageKey);
    if (!storedTaskHandle) {
      return;
    }

    taskHandleRef.current = storedTaskHandle;
    let cancelled = false;
    let restoreTimer: ReturnType<typeof setTimeout> | null = null;
    let restoreInFlight = false;

    const clearRestoreTimer = (): void => {
      if (restoreTimer !== null) {
        clearTimeout(restoreTimer);
        restoreTimer = null;
      }
    };

    const scheduleRestoreRetry = (): void => {
      if (cancelled || restoreTimer !== null) {
        return;
      }
      restoreTimer = setTimeout(() => {
        restoreTimer = null;
        void restoreStoredTask();
      }, BATCH_REVIEW_POLL_INTERVAL_MS);
    };

    const restoreStoredTask = async (): Promise<void> => {
      if (cancelled || restoreInFlight) {
        return;
      }

      restoreInFlight = true;
      let shouldRetry = false;

      try {
        const restoredTask = await knowledgeBaseService.getBatchReviewStatus(storedTaskHandle.taskId);
        if (cancelled) {
          return;
        }
        if (!restoredTask) {
          clearSessionStorageTaskId(storageKey);
          taskHandleRef.current = null;
          setTask(null);
          return;
        }
        const restoredTaskHandle: StoredBatchReviewTaskHandle = {
          taskId: restoredTask.taskId,
          action: restoredTask.action,
          ...(storedTaskHandle.action === KnowledgeFactBatchAction.Reject
            && restoredTask.action === KnowledgeFactBatchAction.Reject
            && typeof storedTaskHandle.rejectReason === 'string'
            ? { rejectReason: storedTaskHandle.rejectReason }
            : {}),
        };
        taskHandleRef.current = restoredTaskHandle;
        writeSessionStorageTaskHandle(storageKey, restoredTaskHandle);
        setTask(restoredTask);
      } catch {
        if (cancelled) {
          return;
        }
        shouldRetry = true;
      } finally {
        restoreInFlight = false;
        if (shouldRetry) {
          scheduleRestoreRetry();
        }
      }
    };

    void restoreStoredTask();

    return () => {
      cancelled = true;
      clearRestoreTimer();
    };
  }, [storageKey]);

  useEffect(() => {
    if (!task || !isBatchReviewTaskActive(task)) {
      return;
    }

    const activeTaskId = task.taskId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearPollTimer = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const scheduleNextPoll = (): void => {
      clearPollTimer();
      timer = setTimeout(() => {
        timer = null;
        void knowledgeBaseService.getBatchReviewStatus(activeTaskId)
          .then(nextTask => {
            if (cancelled) {
              return;
            }
            if (!nextTask) {
              clearSessionStorageTaskId(storageKey);
              taskHandleRef.current = null;
              setTask(current => (current?.taskId === activeTaskId ? null : current));
              return;
            }
            setTask(current => (
              current?.taskId === activeTaskId || current === null ? nextTask : current
            ));
          })
          .catch(() => {
            if (cancelled) {
              return;
            }
          })
          .finally(() => {
            if (cancelled) {
              return;
            }
            const currentTask = taskRef.current;
            if (currentTask?.taskId !== activeTaskId || !isBatchReviewTaskActive(currentTask)) {
              return;
            }
            scheduleNextPoll();
          });
      }, BATCH_REVIEW_POLL_INTERVAL_MS);
    };

    scheduleNextPoll();

    return () => {
      cancelled = true;
      clearPollTimer();
    };
  }, [storageKey, task]);

  useEffect(() => {
    if (!task || !isBatchReviewTaskTerminal(task)) {
      return;
    }
    if (taskRefreshHandledRef.current === task.taskId) {
      return;
    }
    taskRefreshHandledRef.current = task.taskId;
    void Promise.resolve(onRefreshRef.current()).catch(() => undefined);
  }, [task]);

  const allVisibleSelected = useMemo(() => {
    if (visibleSelectableFacts.size === 0) {
      return false;
    }
    if (selectionMode === 'matching') {
      return true;
    }
    for (const factId of visibleSelectableFacts.keys()) {
      if (!selectedFactsState.has(factId)) {
        return false;
      }
    }
    return true;
  }, [selectionMode, selectedFactsState, visibleSelectableFacts]);

  const someVisibleSelected = useMemo(() => {
    if (allVisibleSelected) {
      return false;
    }
    for (const factId of visibleSelectableFacts.keys()) {
      if (selectedFactsState.has(factId)) {
        return true;
      }
    }
    return false;
  }, [allVisibleSelected, selectedFactsState, visibleSelectableFacts]);

  const selectedFacts = useMemo(
    () => projectSelectedFacts(selectionMode === 'matching'
      ? visibleSelectableFacts
      : selectedFactsState),
    [selectionMode, selectedFactsState, visibleSelectableFacts],
  );

  const canSelectAllMatching =
    visibleSelectableFacts.size > 0
    && selectionMode !== 'matching';

  const canExpandToMatching =
    nextCursor !== null
    && selectionMode === 'page'
    && allVisibleSelected
    && visibleSelectableFacts.size > 0;

  const clearSelection = (): void => {
    setSelectedFactsState(new Map());
    setSelectionMode(null);
  };

  const toggleFact = (fact: KnowledgeFactSummary): void => {
    if (!isWorkspaceAiKnowledgeBatchSelectableFact(fact)) {
      return;
    }
    setSelectedFactsState(current => {
      const base = selectionMode === 'matching'
        ? new Map(visibleSelectableFacts)
        : new Map(current);
      if (base.has(fact.id)) {
        base.delete(fact.id);
      } else {
        base.set(fact.id, {
          fact,
          expectedRevision: fact.revision,
        });
      }
      return base;
    });
    setSelectionMode('page');
  };

  const toggleVisible = (): void => {
    if (allVisibleSelected || selectionMode === 'matching') {
      clearSelection();
      return;
    }
    setSelectedFactsState(new Map(visibleSelectableFacts));
    setSelectionMode('page');
  };

  const selectMatching = (): void => {
    if (!canSelectAllMatching) {
      return;
    }
    setSelectedFactsState(new Map(visibleSelectableFacts));
    setSelectionMode('matching');
  };

  const trackTask = (nextTask: KnowledgeFactBatchReviewTask): void => {
    const nextTaskHandle: StoredBatchReviewTaskHandle = {
      taskId: nextTask.taskId,
      action: nextTask.action,
    };
    taskHandleRef.current = nextTaskHandle;
    taskRefreshHandledRef.current = null;
    writeSessionStorageTaskHandle(storageKey, nextTaskHandle);
    setTask(nextTask);
  };

  const startTask = async (request: KnowledgeFactBatchReviewRequest): Promise<void> => {
    setIsStarting(true);
    try {
      const nextTask = await knowledgeBaseService.startBatchReview(request);
      trackTask(nextTask);
      clearSelection();
    } finally {
      setIsStarting(false);
    }
  };

  const start = async (
    action: KnowledgeFactBatchActionValue,
    reason?: string,
  ): Promise<void> => {
    const request: KnowledgeFactBatchReviewRequest = {
      workspaceId,
      action,
      selection: selectionMode === 'matching'
        ? buildMatchingFiltersSelection(filtersRef.current)
        : {
            kind: 'fact_ids',
            items: buildFactIdSelectionItems(selectedFactsState),
          },
    };
    if (request.selection.kind === 'fact_ids' && request.selection.items.length === 0) {
      return;
    }
    if (action === KnowledgeFactBatchAction.Reject) {
      request.reason = reason;
    }
    await startTask(request);
  };

  const retryFailed = async (): Promise<void> => {
    const currentTask = taskRef.current;
    if (!currentTask || currentTask.retryableCount === 0) {
      return;
    }
    setIsStarting(true);
    try {
      const nextTask = await knowledgeBaseService.retryBatchReview(currentTask.taskId);
      if (!nextTask) {
        return;
      }
      trackTask(nextTask);
      clearSelection();
    } finally {
      setIsStarting(false);
    }
  };

  const dismissTask = (): void => {
    const currentTask = taskRef.current;
    if (!currentTask || !isBatchReviewTaskTerminal(currentTask)) {
      return;
    }
    clearSessionStorageTaskId(storageKey);
    taskHandleRef.current = null;
    setTask(null);
  };

  return {
    selectedFacts,
    selectionMode,
    selectedCount: selectedFacts.size,
    visibleSelectableCount: visibleSelectableFacts.size,
    allVisibleSelected,
    someVisibleSelected,
    canSelectAllMatching,
    canExpandToMatching,
    task,
    isStarting,
    toggleFact,
    toggleVisible,
    selectMatching,
    clearSelection,
    start,
    retryFailed,
    dismissTask,
  };
};

export default useWorkspaceAiKnowledgeBatchReview;
