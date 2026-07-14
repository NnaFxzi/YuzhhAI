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
  canSelectAllMatching: boolean;
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
  filters: cloneBatchReviewFilters(filters),
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

    let cancelled = false;
    void knowledgeBaseService.getBatchReviewStatus(storedTaskHandle.taskId)
      .then(restoredTask => {
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
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        taskHandleRef.current = null;
        setTask(null);
      });

    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!isBatchReviewTaskActive(task)) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void knowledgeBaseService.getBatchReviewStatus(task.taskId)
        .then(nextTask => {
          if (cancelled) {
            return;
          }
          if (!nextTask) {
            clearSessionStorageTaskId(storageKey);
            taskHandleRef.current = null;
            setTask(current => (current?.taskId === task.taskId ? null : current));
            return;
          }
          setTask(current => (current?.taskId === task.taskId || current === null ? nextTask : current));
        })
        .catch(() => {
          if (cancelled) {
            return;
          }
        });
    }, BATCH_REVIEW_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
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

  const startTask = async (request: KnowledgeFactBatchReviewRequest): Promise<void> => {
    setIsStarting(true);
    try {
      const nextTask = await knowledgeBaseService.startBatchReview(request);
      const nextTaskHandle: StoredBatchReviewTaskHandle = {
        taskId: nextTask.taskId,
        action: request.action,
        ...(request.action === KnowledgeFactBatchAction.Reject
          && typeof request.reason === 'string'
          ? { rejectReason: request.reason }
          : {}),
      };
      taskHandleRef.current = nextTaskHandle;
      taskRefreshHandledRef.current = null;
      writeSessionStorageTaskHandle(storageKey, nextTaskHandle);
      setTask(nextTask);
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
    if (!currentTask) {
      return;
    }
    const retryableFactIds = new Set(
      currentTask.details
        .filter(detail => detail.retryable)
        .map(detail => detail.factId),
    );
    if (retryableFactIds.size === 0) {
      return;
    }

    const refreshedVisibleFacts = collectWorkspaceAiKnowledgeBatchVisibleSelectableFacts(
      await Promise.resolve(onRefreshRef.current()),
    );
    const items = [...refreshedVisibleFacts.values()]
      .filter(entry => retryableFactIds.has(entry.fact.id))
      .map(entry => ({
        factId: entry.fact.id,
        expectedRevision: entry.expectedRevision,
      }));

    if (items.length === 0) {
      return;
    }

    const request: KnowledgeFactBatchReviewRequest = {
      workspaceId,
      action: currentTask.action,
      selection: {
        kind: 'fact_ids',
        items,
      },
    };

    if (currentTask.action === KnowledgeFactBatchAction.Reject) {
      if (typeof taskHandleRef.current?.rejectReason !== 'string') {
        return;
      }
      request.reason = taskHandleRef.current.rejectReason;
    }

    await startTask(request);
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
