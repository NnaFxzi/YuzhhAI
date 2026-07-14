import {
  KnowledgeBaseErrorCode,
  type KnowledgeBaseErrorCode as KnowledgeBaseErrorCodeValue,
  KnowledgeFactEvidenceState,
  type KnowledgeFactEvidenceState as KnowledgeFactEvidenceStateValue,
  KnowledgeFactListView,
  type KnowledgeFactListView as KnowledgeFactListViewValue,
  KnowledgeFactReviewStatus,
  type KnowledgeFactReviewStatus as KnowledgeFactReviewStatusValue,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeFactEvidencePageResult,
  KnowledgeFactEvidenceSummary,
  KnowledgeFactListResult,
  KnowledgeFactMetrics,
  KnowledgeFactSummary,
} from '../../../shared/knowledgeBase/types';

export interface WorkspaceAiKnowledgeFilters {
  view?: KnowledgeFactListViewValue;
  reviewStatuses?: readonly KnowledgeFactReviewStatusValue[];
  evidenceState?: KnowledgeFactEvidenceStateValue;
}

export const WorkspaceAiKnowledgeListMode = {
  Replace: 'replace',
  Append: 'append',
} as const;
export type WorkspaceAiKnowledgeListMode =
  (typeof WorkspaceAiKnowledgeListMode)[keyof typeof WorkspaceAiKnowledgeListMode];

export const WorkspaceAiKnowledgeMutationKind = {
  Review: 'review',
  Archive: 'archive',
} as const;
export type WorkspaceAiKnowledgeMutationKind =
  (typeof WorkspaceAiKnowledgeMutationKind)[keyof typeof WorkspaceAiKnowledgeMutationKind];

export const WorkspaceAiKnowledgeActionType = {
  ContextReset: 'context_reset',
  ListRequestStarted: 'list_request_started',
  ListRequestSucceeded: 'list_request_succeeded',
  ListRequestFailed: 'list_request_failed',
  RefreshRequested: 'refresh_requested',
  TrailingRefreshStarted: 'trailing_refresh_started',
  MutationStarted: 'mutation_started',
  MutationSucceeded: 'mutation_succeeded',
  MutationFailed: 'mutation_failed',
  EvidenceExpanded: 'evidence_expanded',
  EvidenceCollapsed: 'evidence_collapsed',
  EvidenceRequestStarted: 'evidence_request_started',
  EvidenceRequestSucceeded: 'evidence_request_succeeded',
  EvidenceRequestFailed: 'evidence_request_failed',
} as const;
export type WorkspaceAiKnowledgeActionType =
  (typeof WorkspaceAiKnowledgeActionType)[keyof typeof WorkspaceAiKnowledgeActionType];

export interface WorkspaceAiKnowledgeListRequestState {
  requestGeneration: number;
  mode: WorkspaceAiKnowledgeListMode;
}

export interface WorkspaceAiKnowledgeMutationState {
  workspaceGeneration: number;
  requestGeneration: number;
  kind: WorkspaceAiKnowledgeMutationKind;
}

export interface WorkspaceAiKnowledgeEvidenceRequestState {
  requestGeneration: number;
  factId: string;
  factRevision: number;
  mode: WorkspaceAiKnowledgeListMode;
}

export interface WorkspaceAiKnowledgeEvidenceState {
  expandedFactId: string | null;
  factRevision: number | null;
  items: KnowledgeFactEvidenceSummary[];
  nextCursor: string | null;
  isLoading: boolean;
  requestGeneration: number;
  activeRequest: WorkspaceAiKnowledgeEvidenceRequestState | null;
}

export interface WorkspaceAiKnowledgeState {
  workspaceId: string;
  workspaceGeneration: number;
  filterKey: string;
  items: KnowledgeFactSummary[];
  nextCursor: string | null;
  metrics: KnowledgeFactMetrics;
  isInitialLoading: boolean;
  isLoadingMore: boolean;
  listRequestGeneration: number;
  activeListRequest: WorkspaceAiKnowledgeListRequestState | null;
  trailingRefresh: boolean;
  mutations: Record<string, WorkspaceAiKnowledgeMutationState>;
  evidence: WorkspaceAiKnowledgeEvidenceState;
}

export interface CreateWorkspaceAiKnowledgeStateInput {
  workspaceId: string;
  workspaceGeneration: number;
  filters?: WorkspaceAiKnowledgeFilters;
}

const emptyMetrics = (): KnowledgeFactMetrics => ({
  activePendingCount: 0,
  activeConfirmedCount: 0,
  staleConfirmedCount: 0,
  rejectedHistoryCount: 0,
  archivedHistoryCount: 0,
  unduplicatedLegacyConfirmedCount: 0,
  totalAiKnowledgeCount: 0,
});

const createEmptyEvidenceState = (requestGeneration = 0): WorkspaceAiKnowledgeEvidenceState => ({
  expandedFactId: null,
  factRevision: null,
  items: [],
  nextCursor: null,
  isLoading: false,
  requestGeneration,
  activeRequest: null,
});

export const buildWorkspaceAiKnowledgeFilterKey = (
  filters: WorkspaceAiKnowledgeFilters = {},
): string => {
  const selectedStatuses = new Set(filters.reviewStatuses ?? []);
  const orderedStatuses = Object.values(KnowledgeFactReviewStatus).filter(status =>
    selectedStatuses.has(status),
  );
  return [
    filters.view ?? KnowledgeFactListView.Active,
    orderedStatuses.join(','),
    filters.evidenceState ?? KnowledgeFactEvidenceState.Any,
  ].join('|');
};

export const createWorkspaceAiKnowledgeState = ({
  workspaceId,
  workspaceGeneration,
  filters,
}: CreateWorkspaceAiKnowledgeStateInput): WorkspaceAiKnowledgeState => ({
  workspaceId,
  workspaceGeneration,
  filterKey: buildWorkspaceAiKnowledgeFilterKey(filters),
  items: [],
  nextCursor: null,
  metrics: emptyMetrics(),
  isInitialLoading: false,
  isLoadingMore: false,
  listRequestGeneration: 0,
  activeListRequest: null,
  trailingRefresh: false,
  mutations: {},
  evidence: createEmptyEvidenceState(),
});

export const hasPendingWorkspaceAiKnowledgeTrailingRefresh = (
  state: WorkspaceAiKnowledgeState,
): boolean => state.trailingRefresh && state.activeListRequest === null;

export type WorkspaceAiKnowledgeAction =
  | {
      type: typeof WorkspaceAiKnowledgeActionType.ContextReset;
      workspaceId: string;
      workspaceGeneration: number;
      filters?: WorkspaceAiKnowledgeFilters;
    }
  | {
      type: typeof WorkspaceAiKnowledgeActionType.ListRequestStarted;
      workspaceGeneration: number;
      requestGeneration: number;
      mode: WorkspaceAiKnowledgeListMode;
    }
  | {
      type: typeof WorkspaceAiKnowledgeActionType.ListRequestSucceeded;
      workspaceGeneration: number;
      requestGeneration: number;
      result: KnowledgeFactListResult;
    }
  | {
      type: typeof WorkspaceAiKnowledgeActionType.ListRequestFailed;
      workspaceGeneration: number;
      requestGeneration: number;
    }
  | { type: typeof WorkspaceAiKnowledgeActionType.RefreshRequested }
  | {
      type: typeof WorkspaceAiKnowledgeActionType.TrailingRefreshStarted;
      workspaceGeneration: number;
      requestGeneration: number;
    }
  | {
      type: typeof WorkspaceAiKnowledgeActionType.MutationStarted;
      workspaceGeneration: number;
      factId: string;
      requestGeneration: number;
      kind: WorkspaceAiKnowledgeMutationKind;
    }
  | {
      type: typeof WorkspaceAiKnowledgeActionType.MutationSucceeded;
      workspaceGeneration: number;
      factId: string;
      requestGeneration: number;
      fact: KnowledgeFactSummary;
    }
  | {
      type: typeof WorkspaceAiKnowledgeActionType.MutationFailed;
      workspaceGeneration: number;
      factId: string;
      requestGeneration: number;
      errorCode?: KnowledgeBaseErrorCodeValue;
    }
  | {
      type: typeof WorkspaceAiKnowledgeActionType.EvidenceExpanded;
      factId: string;
      factRevision: number;
    }
  | { type: typeof WorkspaceAiKnowledgeActionType.EvidenceCollapsed }
  | {
      type: typeof WorkspaceAiKnowledgeActionType.EvidenceRequestStarted;
      workspaceGeneration: number;
      requestGeneration: number;
      factId: string;
      factRevision: number;
      mode: WorkspaceAiKnowledgeListMode;
    }
  | {
      type: typeof WorkspaceAiKnowledgeActionType.EvidenceRequestSucceeded;
      workspaceGeneration: number;
      requestGeneration: number;
      result: KnowledgeFactEvidencePageResult;
    }
  | {
      type: typeof WorkspaceAiKnowledgeActionType.EvidenceRequestFailed;
      workspaceGeneration: number;
      requestGeneration: number;
      errorCode?: KnowledgeBaseErrorCodeValue;
    };

const invalidateEvidence = (
  evidence: WorkspaceAiKnowledgeEvidenceState,
): WorkspaceAiKnowledgeEvidenceState => createEmptyEvidenceState(evidence.requestGeneration);

const mergeFactsByRevision = (
  currentItems: readonly KnowledgeFactSummary[],
  incomingItems: readonly KnowledgeFactSummary[],
  mode: WorkspaceAiKnowledgeListMode,
): KnowledgeFactSummary[] => {
  const merged = mode === WorkspaceAiKnowledgeListMode.Replace ? [] : [...currentItems];
  const previousById = new Map(currentItems.map(item => [item.id, item]));
  const indexes = new Map(merged.map((item, index) => [item.id, index]));
  for (const incomingItem of incomingItems) {
    const previousItem = previousById.get(incomingItem.id);
    const item =
      mode === WorkspaceAiKnowledgeListMode.Replace &&
      previousItem &&
      previousItem.revision >= incomingItem.revision
        ? previousItem
        : incomingItem;
    const currentIndex = indexes.get(incomingItem.id);
    if (currentIndex === undefined) {
      indexes.set(item.id, merged.length);
      merged.push(item);
      continue;
    }
    if (item.revision > merged[currentIndex].revision) {
      merged[currentIndex] = item;
    }
  }
  return merged;
};

const mergeEvidenceById = (
  currentItems: readonly KnowledgeFactEvidenceSummary[],
  incomingItems: readonly KnowledgeFactEvidenceSummary[],
  mode: WorkspaceAiKnowledgeListMode,
): KnowledgeFactEvidenceSummary[] => {
  const merged = mode === WorkspaceAiKnowledgeListMode.Replace ? [] : [...currentItems];
  const ids = new Set(merged.map(item => item.id));
  for (const item of incomingItems) {
    if (!ids.has(item.id)) {
      ids.add(item.id);
      merged.push(item);
    }
  }
  return merged;
};

const reconcileEvidenceWithFacts = (
  evidence: WorkspaceAiKnowledgeEvidenceState,
  facts: readonly KnowledgeFactSummary[],
): WorkspaceAiKnowledgeEvidenceState => {
  if (evidence.expandedFactId === null) {
    return evidence;
  }
  const currentFact = facts.find(fact => fact.id === evidence.expandedFactId);
  return currentFact && currentFact.revision === evidence.factRevision
    ? evidence
    : invalidateEvidence(evidence);
};

const isCurrentListResponse = (
  state: WorkspaceAiKnowledgeState,
  workspaceGeneration: number,
  requestGeneration: number,
): boolean =>
  workspaceGeneration === state.workspaceGeneration &&
  state.activeListRequest?.requestGeneration === requestGeneration;

const withoutMutation = (
  mutations: Readonly<Record<string, WorkspaceAiKnowledgeMutationState>>,
  factId: string,
): Record<string, WorkspaceAiKnowledgeMutationState> => {
  const nextMutations = { ...mutations };
  delete nextMutations[factId];
  return nextMutations;
};

const invalidateListForRefresh = (
  state: WorkspaceAiKnowledgeState,
): Pick<
  WorkspaceAiKnowledgeState,
  | 'items'
  | 'nextCursor'
  | 'isInitialLoading'
  | 'isLoadingMore'
  | 'activeListRequest'
  | 'listRequestGeneration'
  | 'trailingRefresh'
> => ({
  items: [],
  nextCursor: null,
  isInitialLoading: false,
  isLoadingMore: false,
  activeListRequest: null,
  listRequestGeneration: state.listRequestGeneration + 1,
  trailingRefresh: true,
});

export const workspaceAiKnowledgeReducer = (
  state: WorkspaceAiKnowledgeState,
  action: WorkspaceAiKnowledgeAction,
): WorkspaceAiKnowledgeState => {
  switch (action.type) {
    case WorkspaceAiKnowledgeActionType.ContextReset:
      if (action.workspaceGeneration <= state.workspaceGeneration) {
        return state;
      }
      return createWorkspaceAiKnowledgeState({
        workspaceId: action.workspaceId,
        workspaceGeneration: action.workspaceGeneration,
        filters: action.filters,
      });

    case WorkspaceAiKnowledgeActionType.ListRequestStarted:
      if (
        action.workspaceGeneration !== state.workspaceGeneration ||
        action.requestGeneration <= state.listRequestGeneration ||
        state.activeListRequest !== null ||
        (action.mode === WorkspaceAiKnowledgeListMode.Append && state.nextCursor === null)
      ) {
        return state;
      }
      return {
        ...state,
        listRequestGeneration: action.requestGeneration,
        activeListRequest: {
          requestGeneration: action.requestGeneration,
          mode: action.mode,
        },
        isInitialLoading: action.mode === WorkspaceAiKnowledgeListMode.Replace,
        isLoadingMore: action.mode === WorkspaceAiKnowledgeListMode.Append,
      };

    case WorkspaceAiKnowledgeActionType.ListRequestSucceeded: {
      if (!isCurrentListResponse(state, action.workspaceGeneration, action.requestGeneration)) {
        return state;
      }
      const mode = state.activeListRequest?.mode ?? WorkspaceAiKnowledgeListMode.Replace;
      const items = mergeFactsByRevision(state.items, action.result.items, mode);
      return {
        ...state,
        items,
        nextCursor: action.result.nextCursor,
        metrics: action.result.metrics,
        isInitialLoading: false,
        isLoadingMore: false,
        activeListRequest: null,
        evidence: reconcileEvidenceWithFacts(state.evidence, items),
      };
    }

    case WorkspaceAiKnowledgeActionType.ListRequestFailed:
      if (!isCurrentListResponse(state, action.workspaceGeneration, action.requestGeneration)) {
        return state;
      }
      return {
        ...state,
        isInitialLoading: false,
        isLoadingMore: false,
        activeListRequest: null,
      };

    case WorkspaceAiKnowledgeActionType.RefreshRequested:
      return state.trailingRefresh ? state : { ...state, trailingRefresh: true };

    case WorkspaceAiKnowledgeActionType.TrailingRefreshStarted:
      if (
        action.workspaceGeneration !== state.workspaceGeneration ||
        action.requestGeneration <= state.listRequestGeneration ||
        !hasPendingWorkspaceAiKnowledgeTrailingRefresh(state)
      ) {
        return state;
      }
      return {
        ...state,
        listRequestGeneration: action.requestGeneration,
        activeListRequest: {
          requestGeneration: action.requestGeneration,
          mode: WorkspaceAiKnowledgeListMode.Replace,
        },
        isInitialLoading: true,
        isLoadingMore: false,
        trailingRefresh: false,
      };

    case WorkspaceAiKnowledgeActionType.MutationStarted: {
      const currentMutation = state.mutations[action.factId];
      if (
        action.workspaceGeneration !== state.workspaceGeneration ||
        (currentMutation && action.requestGeneration <= currentMutation.requestGeneration)
      ) {
        return state;
      }
      return {
        ...state,
        mutations: {
          ...state.mutations,
          [action.factId]: {
            workspaceGeneration: action.workspaceGeneration,
            requestGeneration: action.requestGeneration,
            kind: action.kind,
          },
        },
      };
    }

    case WorkspaceAiKnowledgeActionType.MutationSucceeded: {
      const currentMutation = state.mutations[action.factId];
      if (
        action.workspaceGeneration !== state.workspaceGeneration ||
        currentMutation?.workspaceGeneration !== action.workspaceGeneration ||
        currentMutation.requestGeneration !== action.requestGeneration
      ) {
        return state;
      }
      return {
        ...state,
        ...invalidateListForRefresh(state),
        mutations: withoutMutation(state.mutations, action.factId),
        evidence:
          state.evidence.expandedFactId === action.factId
            ? invalidateEvidence(state.evidence)
            : state.evidence,
      };
    }

    case WorkspaceAiKnowledgeActionType.MutationFailed: {
      const currentMutation = state.mutations[action.factId];
      if (
        action.workspaceGeneration !== state.workspaceGeneration ||
        currentMutation?.workspaceGeneration !== action.workspaceGeneration ||
        currentMutation.requestGeneration !== action.requestGeneration
      ) {
        return state;
      }
      const mutations = withoutMutation(state.mutations, action.factId);
      if (action.errorCode !== KnowledgeBaseErrorCode.JobStateConflict) {
        return { ...state, mutations };
      }
      return {
        ...state,
        ...invalidateListForRefresh(state),
        mutations,
        evidence: invalidateEvidence(state.evidence),
      };
    }

    case WorkspaceAiKnowledgeActionType.EvidenceExpanded:
      if (
        state.evidence.expandedFactId === action.factId &&
        state.evidence.factRevision === action.factRevision
      ) {
        return state;
      }
      return {
        ...state,
        evidence: {
          ...createEmptyEvidenceState(state.evidence.requestGeneration),
          expandedFactId: action.factId,
          factRevision: action.factRevision,
        },
      };

    case WorkspaceAiKnowledgeActionType.EvidenceCollapsed:
      return state.evidence.expandedFactId === null
        ? state
        : { ...state, evidence: invalidateEvidence(state.evidence) };

    case WorkspaceAiKnowledgeActionType.EvidenceRequestStarted:
      if (
        action.workspaceGeneration !== state.workspaceGeneration ||
        state.evidence.expandedFactId !== action.factId ||
        state.evidence.factRevision !== action.factRevision ||
        state.evidence.activeRequest !== null ||
        action.requestGeneration <= state.evidence.requestGeneration ||
        (action.mode === WorkspaceAiKnowledgeListMode.Append &&
          state.evidence.nextCursor === null)
      ) {
        return state;
      }
      return {
        ...state,
        evidence: {
          ...state.evidence,
          isLoading: true,
          requestGeneration: action.requestGeneration,
          activeRequest: {
            requestGeneration: action.requestGeneration,
            factId: action.factId,
            factRevision: action.factRevision,
            mode: action.mode,
          },
        },
      };

    case WorkspaceAiKnowledgeActionType.EvidenceRequestSucceeded: {
      const request = state.evidence.activeRequest;
      if (
        action.workspaceGeneration !== state.workspaceGeneration ||
        request?.requestGeneration !== action.requestGeneration ||
        request.factId !== action.result.factId ||
        request.factRevision !== action.result.factRevision ||
        state.evidence.expandedFactId !== action.result.factId ||
        state.evidence.factRevision !== action.result.factRevision
      ) {
        return state;
      }
      return {
        ...state,
        evidence: {
          ...state.evidence,
          items: mergeEvidenceById(state.evidence.items, action.result.items, request.mode),
          nextCursor: action.result.nextCursor,
          isLoading: false,
          activeRequest: null,
        },
      };
    }

    case WorkspaceAiKnowledgeActionType.EvidenceRequestFailed: {
      const request = state.evidence.activeRequest;
      if (
        action.workspaceGeneration !== state.workspaceGeneration ||
        request?.requestGeneration !== action.requestGeneration
      ) {
        return state;
      }
      if (action.errorCode === KnowledgeBaseErrorCode.JobStateConflict) {
        return { ...state, evidence: invalidateEvidence(state.evidence) };
      }
      return {
        ...state,
        evidence: {
          ...state.evidence,
          isLoading: false,
          activeRequest: null,
        },
      };
    }
  }
};
