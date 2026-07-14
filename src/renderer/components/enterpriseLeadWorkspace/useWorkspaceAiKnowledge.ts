import { useEffect, useLayoutEffect, useMemo, useState } from 'react';

import type { EnterpriseLeadWorkspaceProfile } from '../../../shared/enterpriseLeadWorkspace/types';
import {
  KNOWLEDGE_FACT_EVIDENCE_PAGE_DEFAULT_LIMIT,
  KNOWLEDGE_FACT_LIST_DEFAULT_LIMIT,
  KnowledgeBaseErrorCode,
  type KnowledgeBaseErrorCode as KnowledgeBaseErrorCodeValue,
  KnowledgeDocumentVisibility,
  type KnowledgeEnrichmentStatus,
  KnowledgeEnrichmentStatus as KnowledgeEnrichmentStatuses,
  KnowledgeFactArchiveProjectionDecision,
  type KnowledgeFactArchiveProjectionDecision as KnowledgeFactArchiveProjectionDecisionValue,
  KnowledgeFactDomain,
  type KnowledgeFactDomain as KnowledgeFactDomainValue,
  KnowledgeFactEvidenceState,
  type KnowledgeFactEvidenceState as KnowledgeFactEvidenceStateValue,
  KnowledgeFactListView,
  type KnowledgeFactListView as KnowledgeFactListViewValue,
  KnowledgeFactProjectionConflictKind,
  KnowledgeFactProjectionOperation,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewDecision,
  type KnowledgeFactReviewDecision as KnowledgeFactReviewDecisionValue,
  KnowledgeFactReviewStatus,
  type KnowledgeFactReviewStatus as KnowledgeFactReviewStatusValue,
  KnowledgeFactSourceKind,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeArchiveFactRequest,
  KnowledgeDocumentListItem,
  KnowledgeFactArchiveResult,
  KnowledgeFactEvidencePageRequest,
  KnowledgeFactEvidencePageResult,
  KnowledgeFactEvidenceSummary,
  KnowledgeFactMetrics,
  KnowledgeFactProjectionConflict,
  KnowledgeFactReviewResult,
  KnowledgeFactSummary,
  KnowledgeListFactsRequest,
  KnowledgeReviewFactRequest,
} from '../../../shared/knowledgeBase/types';
import { knowledgeBaseService, KnowledgeBaseServiceError } from '../../services/knowledgeBase';
import { shouldPollKnowledgeDocuments } from './knowledgeDocumentPresentation';
import { mergeKnowledgeDocumentListItems } from './useWorkspaceKnowledgeDocuments';
import {
  composeWorkspaceAiKnowledgeRows,
  type WorkspaceAiKnowledgeRow,
} from './workspaceAiKnowledgeRows';
import {
  buildWorkspaceAiKnowledgeFilterKey,
  createWorkspaceAiKnowledgeState,
  hasPendingWorkspaceAiKnowledgeTrailingRefresh,
  type WorkspaceAiKnowledgeAction,
  WorkspaceAiKnowledgeActionType,
  type WorkspaceAiKnowledgeFilters,
  WorkspaceAiKnowledgeListMode,
  WorkspaceAiKnowledgeMutationKind,
  workspaceAiKnowledgeReducer,
  type WorkspaceAiKnowledgeState,
} from './workspaceAiKnowledgeState';

export interface WorkspaceAiKnowledgeCanonicalFilters {
  view: KnowledgeFactListViewValue;
  reviewStatuses: KnowledgeFactReviewStatusValue[];
  evidenceState: KnowledgeFactEvidenceStateValue;
}

export const canonicalizeWorkspaceAiKnowledgeFilters = (
  filters: WorkspaceAiKnowledgeFilters = {},
): WorkspaceAiKnowledgeCanonicalFilters => {
  const requestedStatuses = new Set(filters.reviewStatuses ?? []);
  return {
    view: filters.view ?? KnowledgeFactListView.Active,
    reviewStatuses: Object.values(KnowledgeFactReviewStatus).filter(status =>
      requestedStatuses.has(status),
    ),
    evidenceState: filters.evidenceState ?? KnowledgeFactEvidenceState.Any,
  };
};

export const buildWorkspaceAiKnowledgeListRequest = (
  workspaceId: string,
  filters: WorkspaceAiKnowledgeFilters = {},
  cursor?: string,
): KnowledgeListFactsRequest => {
  const canonicalFilters = canonicalizeWorkspaceAiKnowledgeFilters(filters);
  return {
    workspaceId,
    view: canonicalFilters.view,
    reviewStatuses: [...canonicalFilters.reviewStatuses],
    evidenceState: canonicalFilters.evidenceState,
    limit: KNOWLEDGE_FACT_LIST_DEFAULT_LIMIT,
    ...(cursor ? { cursor } : {}),
  };
};

export interface WorkspaceReviewRequiredTransition {
  requestId: string;
  status: KnowledgeEnrichmentStatus;
}

export interface WorkspaceReviewRequiredTransitionCollector {
  collect: (items: readonly WorkspaceReviewRequiredTransition[]) => boolean;
  reset: () => void;
}

export const createWorkspaceReviewRequiredTransitionCollector =
  (): WorkspaceReviewRequiredTransitionCollector => {
    const statuses = new Map<string, KnowledgeEnrichmentStatus>();
    return {
      collect: items => {
        let enteredReviewRequired = false;
        for (const item of items) {
          const previousStatus = statuses.get(item.requestId);
          if (
            item.status === KnowledgeEnrichmentStatuses.ReviewRequired &&
            previousStatus !== KnowledgeEnrichmentStatuses.ReviewRequired
          ) {
            enteredReviewRequired = true;
          }
          statuses.set(item.requestId, item.status);
        }
        return enteredReviewRequired;
      },
      reset: () => {
        statuses.clear();
      },
    };
  };

const compareSafeTimestamp = (left: string, right: string): number => {
  const leftTimestamp = Date.parse(left);
  const rightTimestamp = Date.parse(right);
  if (Number.isNaN(leftTimestamp) || Number.isNaN(rightTimestamp)) {
    return left.localeCompare(right);
  }
  return leftTimestamp - rightTimestamp;
};

const isIncomingDocumentNewer = (
  current: KnowledgeDocumentListItem,
  incoming: KnowledgeDocumentListItem,
): boolean => {
  if (incoming.revision !== current.revision) {
    return incoming.revision > current.revision;
  }
  const updatedComparison = compareSafeTimestamp(incoming.updatedAt, current.updatedAt);
  if (updatedComparison !== 0) {
    return updatedComparison > 0;
  }
  return false;
};

export const deduplicateWorkspaceKnowledgeDocuments = (
  documents: readonly KnowledgeDocumentListItem[],
): KnowledgeDocumentListItem[] => {
  const deduplicated: KnowledgeDocumentListItem[] = [];
  const indexes = new Map<string, number>();
  for (const document of documents) {
    const index = indexes.get(document.id);
    if (index === undefined) {
      indexes.set(document.id, deduplicated.length);
      deduplicated.push(document);
      continue;
    }
    if (isIncomingDocumentNewer(deduplicated[index], document)) {
      deduplicated[index] = document;
    }
  }
  return deduplicated;
};

export interface WorkspaceAiKnowledgeDocumentPollingController {
  start: () => Promise<void>;
  refresh: () => Promise<void>;
  updateWorkspace: (workspaceId: string) => Promise<void>;
  getDocuments: () => readonly KnowledgeDocumentListItem[];
  dispose: () => void;
}

export const createWorkspaceAiKnowledgeDocumentPollingController = (options: {
  workspaceId: string;
  listDocuments: WorkspaceAiKnowledgeService['listDocuments'];
  onReviewRequired: () => Promise<void> | void;
  intervalMs?: number;
}): WorkspaceAiKnowledgeDocumentPollingController => {
  let currentWorkspaceId = options.workspaceId;
  let workspaceGeneration = 1;
  let documents: KnowledgeDocumentListItem[] = [];
  let disposed = false;
  let started = false;
  let inFlight: Promise<void> | null = null;
  let trailingRefresh = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let forceRetry = false;
  const pendingPollableAbsences = new Set<string>();
  const intervalMs = options.intervalMs ?? 2_000;
  const transitions = createWorkspaceReviewRequiredTransitionCollector();

  const clearTimer = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = (): void => {
    clearTimer();
    if (
      disposed ||
      inFlight ||
      (!forceRetry && !shouldPollKnowledgeDocuments(documents))
    ) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      void refresh();
    }, intervalMs);
  };

  const waitForIdle = async (): Promise<void> => {
    while (inFlight) {
      const current = inFlight;
      await current;
      await Promise.resolve();
    }
  };

  const runRefresh = (): Promise<void> => {
    if (disposed) {
      return Promise.resolve();
    }
    if (inFlight) {
      trailingRefresh = true;
      return waitForIdle();
    }
    clearTimer();
    const ownedWorkspaceGeneration = workspaceGeneration;
    const requestWorkspaceId = currentWorkspaceId;
    let request!: Promise<void>;
    request = Promise.resolve().then(async () => {
      try {
        if (
          disposed ||
          inFlight !== request ||
          workspaceGeneration !== ownedWorkspaceGeneration ||
          currentWorkspaceId !== requestWorkspaceId
        ) {
          return;
        }
        const [activeResult, deletedResult] = await Promise.allSettled([
          Promise.resolve().then(() =>
            options.listDocuments(
              requestWorkspaceId,
              KnowledgeDocumentVisibility.Active,
            ),
          ),
          Promise.resolve().then(() =>
            options.listDocuments(
              requestWorkspaceId,
              KnowledgeDocumentVisibility.Deleted,
            ),
          ),
        ]);
        if (
          disposed ||
          inFlight !== request ||
          workspaceGeneration !== ownedWorkspaceGeneration ||
          currentWorkspaceId !== requestWorkspaceId
        ) {
          return;
        }
        if (activeResult.status === 'rejected' || deletedResult.status === 'rejected') {
          forceRetry = true;
          return;
        }
        forceRetry = false;
        const incomingDocuments = deduplicateWorkspaceKnowledgeDocuments([
          ...activeResult.value,
          ...deletedResult.value,
        ]);
        const incomingIds = new Set(incomingDocuments.map(document => document.id));
        const stabilizedDocuments = [...incomingDocuments];
        for (const document of documents) {
          if (incomingIds.has(document.id)) {
            pendingPollableAbsences.delete(document.id);
            continue;
          }
          if (!shouldPollKnowledgeDocuments([document])) {
            pendingPollableAbsences.delete(document.id);
            continue;
          }
          if (pendingPollableAbsences.has(document.id)) {
            pendingPollableAbsences.delete(document.id);
            continue;
          }
          pendingPollableAbsences.add(document.id);
          stabilizedDocuments.push(document);
          forceRetry = true;
        }
        const mergedDocuments = mergeKnowledgeDocumentListItems(
          documents,
          stabilizedDocuments,
        );
        documents = mergedDocuments;
        const enteredReviewRequired = transitions.collect(
          mergedDocuments.flatMap(document => {
            const currentEnrichment =
              document.enrichment?.documentVersionId === document.currentVersionId
                ? document.enrichment
                : null;
            return currentEnrichment
              ? [
                  {
                    requestId: currentEnrichment.requestId,
                    status: currentEnrichment.status,
                  },
                ]
              : [];
          }),
        );
        if (enteredReviewRequired) {
          await options.onReviewRequired();
        }
      } catch {
        // Polling is best-effort. The fact list keeps its last accepted display-safe state.
      } finally {
        if (inFlight === request) {
          inFlight = null;
          if (trailingRefresh && !disposed) {
            trailingRefresh = false;
            void runRefresh();
          } else {
            schedule();
          }
        }
      }
    });
    inFlight = request;
    return request;
  };

  const refresh = async (): Promise<void> => {
    await runRefresh();
    await waitForIdle();
  };

  return {
    start: async () => {
      if (started) {
        await waitForIdle();
        return;
      }
      started = true;
      await refresh();
    },
    refresh,
    updateWorkspace: async workspaceId => {
      if (disposed || workspaceId === currentWorkspaceId) {
        return;
      }
      currentWorkspaceId = workspaceId;
      workspaceGeneration += 1;
      documents = [];
      transitions.reset();
      pendingPollableAbsences.clear();
      forceRetry = false;
      clearTimer();
      if (!started) {
        return;
      }
      if (inFlight) {
        trailingRefresh = true;
        await waitForIdle();
        return;
      }
      await refresh();
    },
    getDocuments: () => documents,
    dispose: () => {
      disposed = true;
      trailingRefresh = false;
      clearTimer();
      transitions.reset();
      pendingPollableAbsences.clear();
      forceRetry = false;
    },
  };
};

type WorkspaceAiKnowledgeRequiredService = Pick<
  typeof knowledgeBaseService,
  'listFacts' | 'listDocuments' | 'reviewFact' | 'archiveFact' | 'getFactEvidence'
>;

type WorkspaceAiKnowledgeService = Pick<
  WorkspaceAiKnowledgeRequiredService,
  'listFacts' | 'listDocuments'
> &
  Partial<
    Pick<
      WorkspaceAiKnowledgeRequiredService,
      'reviewFact' | 'archiveFact' | 'getFactEvidence'
    >
  >;

export type WorkspaceAiKnowledgeProjectionRefreshHandler = (input: {
  workspaceId: string;
  profileRevision: number;
}) => Promise<void> | void;

export const WorkspaceAiKnowledgeMutationFeedbackStatus = {
  Submitting: 'submitting',
  Succeeded: 'succeeded',
  Failed: 'failed',
} as const;
export type WorkspaceAiKnowledgeMutationFeedbackStatus =
  (typeof WorkspaceAiKnowledgeMutationFeedbackStatus)[keyof typeof WorkspaceAiKnowledgeMutationFeedbackStatus];

export interface WorkspaceAiKnowledgeMutationFeedback {
  status: WorkspaceAiKnowledgeMutationFeedbackStatus;
  errorCode: KnowledgeBaseErrorCodeValue | null;
}

export interface WorkspaceAiKnowledgeMutationAnnouncement {
  status: typeof WorkspaceAiKnowledgeMutationFeedbackStatus.Succeeded;
  generation: number;
}

export const WorkspaceAiKnowledgeProjectionDialogKind = {
  CompanyReplacement: 'company_replacement',
  ArchiveConflict: 'archive_conflict',
  ArchiveLedgerless: 'archive_ledgerless',
} as const;
export type WorkspaceAiKnowledgeProjectionDialogKind =
  (typeof WorkspaceAiKnowledgeProjectionDialogKind)[keyof typeof WorkspaceAiKnowledgeProjectionDialogKind];

export interface WorkspaceAiKnowledgeProjectionDialogState {
  kind: WorkspaceAiKnowledgeProjectionDialogKind;
  dialogGeneration: number;
  workspaceGeneration: number;
  factId: string;
  factRevision: number;
  domain: KnowledgeFactDomainValue;
  currentFieldValue: string | string[] | null;
  fieldRevision: number | null;
  isSubmitting: boolean;
  errorCode: KnowledgeBaseErrorCodeValue | null;
}

export interface CreateWorkspaceAiKnowledgeControllerInput {
  workspaceId: string;
  profileRevision: number;
  profile: EnterpriseLeadWorkspaceProfile;
  service?: WorkspaceAiKnowledgeService;
  onProjectionRefresh?: WorkspaceAiKnowledgeProjectionRefreshHandler;
}

export interface DeferredWorkspaceAiKnowledgeControllerLease {
  acquire: () => () => void;
}

export const createDeferredWorkspaceAiKnowledgeControllerLease = (options: {
  dispose: () => void;
  schedule?: (callback: () => void) => void;
}): DeferredWorkspaceAiKnowledgeControllerLease => {
  const schedule = options.schedule ?? (callback => setTimeout(callback, 0));
  let acquisitionCount = 0;
  let releaseGeneration = 0;
  let disposed = false;

  return {
    acquire: () => {
      if (disposed) {
        return () => undefined;
      }
      acquisitionCount += 1;
      releaseGeneration += 1;
      let released = false;
      return () => {
        if (released || disposed) {
          return;
        }
        released = true;
        acquisitionCount = Math.max(0, acquisitionCount - 1);
        if (acquisitionCount !== 0) {
          return;
        }
        releaseGeneration += 1;
        const ownedReleaseGeneration = releaseGeneration;
        schedule(() => {
          if (
            disposed ||
            acquisitionCount !== 0 ||
            releaseGeneration !== ownedReleaseGeneration
          ) {
            return;
          }
          disposed = true;
          options.dispose();
        });
      };
    },
  };
};

export interface WorkspaceAiKnowledgeSnapshot {
  workspaceId: string;
  profileRevision: number;
  facts: WorkspaceAiKnowledgeState['items'];
  rows: WorkspaceAiKnowledgeRow[];
  metrics: KnowledgeFactMetrics;
  filters: WorkspaceAiKnowledgeCanonicalFilters;
  nextCursor: string | null;
  hasMore: boolean;
  isInitialLoading: boolean;
  isLoadingMore: boolean;
  errorCode: KnowledgeBaseErrorCodeValue | null;
  partialErrorCode: KnowledgeBaseErrorCodeValue | null;
  metricsAcceptanceGeneration: number;
  contextGeneration: number;
  mutations: WorkspaceAiKnowledgeState['mutations'];
  mutationFeedback: Record<string, WorkspaceAiKnowledgeMutationFeedback>;
  mutationAnnouncement: WorkspaceAiKnowledgeMutationAnnouncement | null;
  projectionDialog: WorkspaceAiKnowledgeProjectionDialogState | null;
  evidence: WorkspaceAiKnowledgeState['evidence'];
  evidenceErrorCode: KnowledgeBaseErrorCodeValue | null;
  evidenceHasLoadedFirstPage: boolean;
}

export interface WorkspaceAiKnowledgeContextInput {
  workspaceId: string;
  profileRevision: number;
  profile: EnterpriseLeadWorkspaceProfile;
}

export interface WorkspaceAiKnowledgeController {
  start: () => Promise<void>;
  getSnapshot: () => WorkspaceAiKnowledgeSnapshot;
  subscribe: (listener: () => void) => () => void;
  subscribeAcceptedMetrics: (listener: (metrics: KnowledgeFactMetrics) => void) => () => void;
  retryInitial: () => Promise<void>;
  loadMore: () => Promise<void>;
  retryPartial: () => Promise<void>;
  refreshAfterMutation: () => Promise<WorkspaceAiKnowledgeRow[]>;
  reviewFact: (
    fact: KnowledgeFactSummary,
    decision: KnowledgeFactReviewDecisionValue,
  ) => Promise<void>;
  archiveFact: (fact: KnowledgeFactSummary) => Promise<void>;
  resolveCompanyReplacement: () => Promise<void>;
  resolveArchiveKeepCurrent: () => Promise<void>;
  resolveArchiveRemoveCurrent: () => Promise<void>;
  dismissProjectionConflict: () => void;
  expandEvidence: (fact: KnowledgeFactSummary) => Promise<void>;
  collapseEvidence: () => void;
  loadMoreEvidence: () => Promise<void>;
  retryEvidence: () => Promise<void>;
  setProjectionRefreshHandler: (
    handler?: WorkspaceAiKnowledgeProjectionRefreshHandler,
  ) => void;
  updateContext: (input: WorkspaceAiKnowledgeContextInput) => Promise<void>;
  setView: (view: KnowledgeFactListViewValue) => Promise<void>;
  setReviewStatuses: (statuses: readonly KnowledgeFactReviewStatusValue[]) => Promise<void>;
  setEvidenceState: (state: KnowledgeFactEvidenceStateValue) => Promise<void>;
  dispose: () => void;
}

const createEmptyKnowledgeFactMetrics = (): KnowledgeFactMetrics => ({
  activePendingCount: 0,
  activeConfirmedCount: 0,
  staleConfirmedCount: 0,
  rejectedHistoryCount: 0,
  archivedHistoryCount: 0,
  unduplicatedLegacyConfirmedCount: 0,
  totalAiKnowledgeCount: 0,
});

export const selectWorkspaceAiKnowledgeDisplaySnapshot = (
  snapshot: WorkspaceAiKnowledgeSnapshot,
  input: WorkspaceAiKnowledgeContextInput,
): WorkspaceAiKnowledgeSnapshot => {
  if (
    snapshot.workspaceId === input.workspaceId &&
    snapshot.profileRevision === input.profileRevision
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    workspaceId: input.workspaceId,
    profileRevision: input.profileRevision,
    facts: [],
    rows: composeWorkspaceAiKnowledgeRows({ facts: [], profile: input.profile }),
    metrics: createEmptyKnowledgeFactMetrics(),
    nextCursor: null,
    hasMore: false,
    isInitialLoading: true,
    isLoadingMore: false,
    errorCode: null,
    partialErrorCode: null,
    metricsAcceptanceGeneration: 0,
    contextGeneration: 0,
    mutations: {},
    mutationFeedback: {},
    mutationAnnouncement: null,
    projectionDialog: null,
    evidence: {
      expandedFactId: null,
      factRevision: null,
      items: [],
      nextCursor: null,
      isLoading: false,
      requestGeneration: 0,
      activeRequest: null,
    },
    evidenceErrorCode: null,
    evidenceHasLoadedFirstPage: false,
  };
};

const isKnowledgeBaseErrorCode = (
  value: unknown,
): value is KnowledgeBaseErrorCodeValue =>
  typeof value === 'string' &&
  Object.values(KnowledgeBaseErrorCode).includes(
    value as KnowledgeBaseErrorCodeValue,
  );

const toSafeErrorCode = (caught: unknown): KnowledgeBaseErrorCodeValue =>
  caught instanceof KnowledgeBaseServiceError && isKnowledgeBaseErrorCode(caught.code)
    ? caught.code
    : KnowledgeBaseErrorCode.PersistenceFailed;

type WorkspaceAiKnowledgeListStartAction = Extract<
  WorkspaceAiKnowledgeAction,
  {
    type:
      | typeof WorkspaceAiKnowledgeActionType.ListRequestStarted
      | typeof WorkspaceAiKnowledgeActionType.TrailingRefreshStarted;
  }
>;

interface WorkspaceAiKnowledgeMutationOwner {
  workspaceId: string;
  workspaceGeneration: number;
  factId: string;
  factRevision: number;
  domain: KnowledgeFactDomainValue;
  requestGeneration: number;
  kind: WorkspaceAiKnowledgeMutationKind;
  projectionKind: WorkspaceAiKnowledgeProjectionDialogKind | null;
  projectionDialogGeneration: number | null;
  acceptedFactIdentity: WorkspaceAiKnowledgeAcceptedFactIdentity;
  promise: Promise<void>;
  serviceInvoked: boolean;
}

interface WorkspaceAiKnowledgeProjectionDialogOwner {
  kind: WorkspaceAiKnowledgeProjectionDialogKind;
  dialogGeneration: number;
  workspaceGeneration: number;
  factId: string;
  factRevision: number;
  domain: KnowledgeFactDomainValue;
  fieldRevision: number | null;
  acceptedFactIdentity: WorkspaceAiKnowledgeAcceptedFactIdentity;
}

type WorkspaceAiKnowledgeMutationResult =
  | KnowledgeFactReviewResult
  | KnowledgeFactArchiveResult;

interface WorkspaceAiKnowledgeEvidenceOwner {
  workspaceId: string;
  workspaceGeneration: number;
  factId: string;
  factRevision: number;
  domain: KnowledgeFactDomainValue;
  requestGeneration: number;
  mode: WorkspaceAiKnowledgeListMode;
  cursor: string | null;
  promise: Promise<void>;
}

type WorkspaceAiKnowledgeAcceptedFactIdentity = Pick<
  KnowledgeFactSummary,
  'revision' | 'domain' | 'reviewStatus' | 'projectionState' | 'archivedAt'
>;

interface WorkspaceAiKnowledgeExpandedEvidenceIdentity {
  factId: string;
  factRevision: number;
  domain: KnowledgeFactDomainValue;
}

const acceptedFactIdentityMatches = (
  left: WorkspaceAiKnowledgeAcceptedFactIdentity,
  right: WorkspaceAiKnowledgeAcceptedFactIdentity,
): boolean =>
  left.revision === right.revision &&
  left.domain === right.domain &&
  left.reviewStatus === right.reviewStatus &&
  left.projectionState === right.projectionState &&
  left.archivedAt === right.archivedAt;

const isSafePositiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

const isSafeNonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const SAFE_EVIDENCE_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const isSafeEvidenceTimestamp = (value: unknown): value is string => {
  if (
    typeof value !== 'string' ||
    value.length > 64 ||
    !SAFE_EVIDENCE_TIMESTAMP_PATTERN.test(value)
  ) {
    return false;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  try {
    return Number.isFinite(new Date(timestamp).getTime());
  } catch {
    return false;
  }
};

const isKnowledgeFactEvidenceSummary = (
  value: unknown,
): value is KnowledgeFactEvidenceSummary => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.factId === 'string' &&
    item.factId.length > 0 &&
    typeof item.documentId === 'string' &&
    item.documentId.length > 0 &&
    typeof item.documentVersionId === 'string' &&
    item.documentVersionId.length > 0 &&
    typeof item.documentDisplayName === 'string' &&
    typeof item.quote === 'string' &&
    typeof item.confidence === 'number' &&
    Number.isFinite(item.confidence) &&
    item.confidence >= 0 &&
    item.confidence <= 1 &&
    typeof item.stale === 'boolean' &&
    isSafeEvidenceTimestamp(item.createdAt)
  );
};

const isKnowledgeFactSummary = (value: unknown): value is KnowledgeFactSummary => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Record<string, unknown>;
  const preview = item.evidencePreview;
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    Object.values(KnowledgeFactDomain).includes(item.domain as KnowledgeFactDomainValue) &&
    typeof item.value === 'string' &&
    Object.values(KnowledgeFactReviewStatus).includes(
      item.reviewStatus as KnowledgeFactReviewStatusValue,
    ) &&
    Object.values(KnowledgeFactSourceKind).includes(
      item.sourceKind as (typeof KnowledgeFactSourceKind)[keyof typeof KnowledgeFactSourceKind],
    ) &&
    isSafePositiveInteger(item.revision) &&
    Object.values(KnowledgeFactProjectionState).includes(
      item.projectionState as (typeof KnowledgeFactProjectionState)[keyof typeof KnowledgeFactProjectionState],
    ) &&
    isSafeNonNegativeInteger(item.activeEvidenceCount) &&
    isSafeNonNegativeInteger(item.staleEvidenceCount) &&
    (preview === null ||
      (isKnowledgeFactEvidenceSummary(preview) && preview.factId === item.id)) &&
    typeof item.createdAt === 'string' &&
    isNullableString(item.reviewedAt) &&
    typeof item.updatedAt === 'string' &&
    isNullableString(item.archivedAt)
  );
};

const isWorkspaceAiKnowledgeMutationResult = (
  value: unknown,
): value is WorkspaceAiKnowledgeMutationResult => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    isKnowledgeFactSummary(result.fact) &&
    typeof result.profileChanged === 'boolean' &&
    (result.profileRevision === null || isSafePositiveInteger(result.profileRevision)) &&
    (result.profileChanged === false || isSafePositiveInteger(result.profileRevision)) &&
    (result.fieldRevision === null || isSafePositiveInteger(result.fieldRevision))
  );
};

const isKnowledgeFactEvidencePageResult = (
  value: unknown,
): value is KnowledgeFactEvidencePageResult => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const page = value as Record<string, unknown>;
  return (
    typeof page.factId === 'string' &&
    page.factId.length > 0 &&
    isSafePositiveInteger(page.factRevision) &&
    Array.isArray(page.items) &&
    [...page.items].every(isKnowledgeFactEvidenceSummary) &&
    (page.nextCursor === null ||
      (typeof page.nextCursor === 'string' && page.nextCursor.length > 0))
  );
};

export const createWorkspaceAiKnowledgeController = ({
  workspaceId,
  profileRevision,
  profile,
  service: injectedService = knowledgeBaseService,
  onProjectionRefresh,
}: CreateWorkspaceAiKnowledgeControllerInput): WorkspaceAiKnowledgeController => {
  const service: WorkspaceAiKnowledgeRequiredService = {
    listFacts: injectedService.listFacts,
    listDocuments: injectedService.listDocuments,
    reviewFact: injectedService.reviewFact ?? knowledgeBaseService.reviewFact,
    archiveFact: injectedService.archiveFact ?? knowledgeBaseService.archiveFact,
    getFactEvidence:
      injectedService.getFactEvidence ?? knowledgeBaseService.getFactEvidence,
  };
  let currentWorkspaceId = workspaceId;
  let currentProfileRevision = profileRevision;
  let filters = canonicalizeWorkspaceAiKnowledgeFilters();
  let contextKey = `${currentWorkspaceId}\u0000${currentProfileRevision}\u0000${buildWorkspaceAiKnowledgeFilterKey(filters)}`;
  let workspaceGeneration = 1;
  let state = createWorkspaceAiKnowledgeState({
    workspaceId: currentWorkspaceId,
    workspaceGeneration,
    filters,
  });
  let currentProfile = profile;
  let errorCode: KnowledgeBaseErrorCodeValue | null = null;
  let partialErrorCode: KnowledgeBaseErrorCodeValue | null = null;
  let disposed = false;
  let hasStarted = false;
  let requestGeneration = 0;
  let metricsAcceptanceGeneration = 0;
  let partialRetry: {
    mode: WorkspaceAiKnowledgeListMode;
    cursor: string | null;
  } | null = null;
  let listInFlight: Promise<void> | null = null;
  let mutationRequestGeneration = 0;
  let mutationFeedback: Record<string, WorkspaceAiKnowledgeMutationFeedback> = {};
  let mutationAnnouncement: WorkspaceAiKnowledgeMutationAnnouncement | null = null;
  let mutationAnnouncementGeneration = 0;
  let projectionRefreshHandler = onProjectionRefresh;
  let projectionDialogGeneration = 0;
  let projectionDialog: WorkspaceAiKnowledgeProjectionDialogState | null = null;
  let projectionDialogOwner: WorkspaceAiKnowledgeProjectionDialogOwner | null = null;
  let evidenceRequestGeneration = 0;
  let evidenceOwner: WorkspaceAiKnowledgeEvidenceOwner | null = null;
  let evidenceErrorCode: KnowledgeBaseErrorCodeValue | null = null;
  let evidenceHasLoadedFirstPage = false;
  let acceptedFactIdentities = new Map<
    string,
    WorkspaceAiKnowledgeAcceptedFactIdentity
  >();
  let expandedEvidenceIdentity: WorkspaceAiKnowledgeExpandedEvidenceIdentity | null = null;
  const mutationOwners = new Map<string, WorkspaceAiKnowledgeMutationOwner>();
  const listeners = new Set<() => void>();
  const metricsListeners = new Set<(metrics: KnowledgeFactMetrics) => void>();
  let documentPolling: WorkspaceAiKnowledgeDocumentPollingController | null = null;

  const createSnapshot = (): WorkspaceAiKnowledgeSnapshot => ({
    workspaceId: currentWorkspaceId,
    profileRevision: currentProfileRevision,
    facts: state.items,
    rows: composeWorkspaceAiKnowledgeRows({ facts: state.items, profile: currentProfile }),
    metrics: state.metrics,
    filters,
    nextCursor: state.nextCursor,
    hasMore: state.nextCursor !== null,
    isInitialLoading: state.isInitialLoading,
    isLoadingMore: state.isLoadingMore,
    errorCode,
    partialErrorCode,
    metricsAcceptanceGeneration,
    contextGeneration: state.workspaceGeneration,
    mutations: state.mutations,
    mutationFeedback,
    mutationAnnouncement,
    projectionDialog,
    evidence: state.evidence,
    evidenceErrorCode,
    evidenceHasLoadedFirstPage,
  });
  let snapshot = createSnapshot();

  const publish = (): void => {
    if (disposed) {
      return;
    }
    snapshot = createSnapshot();
    listeners.forEach(listener => listener());
  };

  const reduce = (action: Parameters<typeof workspaceAiKnowledgeReducer>[1]): boolean => {
    const nextState = workspaceAiKnowledgeReducer(state, action);
    if (nextState === state) {
      return false;
    }
    state = nextState;
    return true;
  };

  const recordAcceptedFactIdentities = (): void => {
    acceptedFactIdentities = new Map(
      state.items.map(item => [
        item.id,
        {
          revision: item.revision,
          domain: item.domain,
          reviewStatus: item.reviewStatus,
          projectionState: item.projectionState,
          archivedAt: item.archivedAt,
        },
      ]),
    );
  };

  const acceptedIdentityMatchesMutationOwner = (
    owner: WorkspaceAiKnowledgeMutationOwner,
  ): boolean => {
    const acceptedIdentity = acceptedFactIdentities.get(owner.factId);
    return Boolean(
      acceptedIdentity &&
      acceptedFactIdentityMatches(
        acceptedIdentity,
        owner.acceptedFactIdentity,
      ),
    );
  };

  const revokeInvalidMutationOwners = (): void => {
    let nextFeedback: Record<string, WorkspaceAiKnowledgeMutationFeedback> | null = null;
    for (const [factId, owner] of mutationOwners) {
      if (acceptedIdentityMatchesMutationOwner(owner)) {
        continue;
      }
      if (mutationOwners.get(factId) === owner) {
        mutationOwners.delete(factId);
      }
      if (Object.prototype.hasOwnProperty.call(mutationFeedback, factId)) {
        nextFeedback ??= { ...mutationFeedback };
        delete nextFeedback[factId];
      }
      const mutation = state.mutations[factId];
      if (
        mutation?.workspaceGeneration === owner.workspaceGeneration &&
        mutation.requestGeneration === owner.requestGeneration &&
        mutation.kind === owner.kind
      ) {
        reduce({
          type: WorkspaceAiKnowledgeActionType.MutationFailed,
          workspaceGeneration: owner.workspaceGeneration,
          factId,
          requestGeneration: owner.requestGeneration,
          errorCode: KnowledgeBaseErrorCode.FactRevisionConflict,
        });
      }
    }
    if (nextFeedback) {
      mutationFeedback = nextFeedback;
    }
  };

  const acceptedIdentityMatchesProjectionDialog = (
    owner: WorkspaceAiKnowledgeProjectionDialogOwner,
  ): boolean => {
    const acceptedIdentity = acceptedFactIdentities.get(owner.factId);
    if (
      !acceptedIdentity ||
      !acceptedFactIdentityMatches(
        acceptedIdentity,
        owner.acceptedFactIdentity,
      ) ||
      acceptedIdentity.revision !== owner.factRevision ||
      acceptedIdentity.domain !== owner.domain ||
      acceptedIdentity.archivedAt !== null
    ) {
      return false;
    }
    if (owner.kind === WorkspaceAiKnowledgeProjectionDialogKind.CompanyReplacement) {
      return acceptedIdentity.reviewStatus === KnowledgeFactReviewStatus.Pending;
    }
    if (acceptedIdentity.reviewStatus !== KnowledgeFactReviewStatus.Confirmed) {
      return false;
    }
    return owner.kind === WorkspaceAiKnowledgeProjectionDialogKind.ArchiveLedgerless
      ? acceptedIdentity.projectionState === KnowledgeFactProjectionState.Conflict
      : acceptedIdentity.projectionState !== KnowledgeFactProjectionState.Conflict;
  };

  const acceptedIdentityMatchesExpandedEvidence = (): boolean => {
    if (!expandedEvidenceIdentity) {
      return false;
    }
    const acceptedIdentity = acceptedFactIdentities.get(
      expandedEvidenceIdentity.factId,
    );
    return Boolean(
      acceptedIdentity &&
      acceptedIdentity.revision === expandedEvidenceIdentity.factRevision &&
      acceptedIdentity.domain === expandedEvidenceIdentity.domain,
    );
  };

  const clearProjectionDialog = (): void => {
    projectionDialog = null;
    projectionDialogOwner = null;
  };

  const dispatch = (action: Parameters<typeof workspaceAiKnowledgeReducer>[1]): boolean => {
    if (!reduce(action)) {
      return false;
    }
    publish();
    return true;
  };

  const isOwnedRequest = (workspaceGeneration: number, ownedRequestGeneration: number): boolean =>
    !disposed &&
    state.workspaceGeneration === workspaceGeneration &&
    state.activeListRequest?.requestGeneration === ownedRequestGeneration;

  const waitForFactIdle = async (): Promise<void> => {
    while (listInFlight) {
      const current = listInFlight;
      await current;
      await Promise.resolve();
    }
  };

  const startListRequest = (
    action: WorkspaceAiKnowledgeListStartAction,
    mode: WorkspaceAiKnowledgeListMode,
    cursor?: string,
  ): Promise<void> => {
    if (listInFlight || disposed) {
      return listInFlight ?? Promise.resolve();
    }
    const workspaceGeneration = action.workspaceGeneration;
    const ownedRequestGeneration = action.requestGeneration;
    const hadAcceptedRows = snapshot.rows.length > 0;
    const requestInput = buildWorkspaceAiKnowledgeListRequest(
      currentWorkspaceId,
      filters,
      cursor,
    );

    let started = false;
    let request!: Promise<void>;
    request = Promise.resolve().then(async () => {
      try {
        if (
          !started ||
          listInFlight !== request ||
          !isOwnedRequest(workspaceGeneration, ownedRequestGeneration)
        ) {
          return;
        }
        const result = await service.listFacts(requestInput);
        if (!isOwnedRequest(workspaceGeneration, ownedRequestGeneration)) {
          return;
        }
        const accepted = reduce({
          type: WorkspaceAiKnowledgeActionType.ListRequestSucceeded,
          workspaceGeneration,
          requestGeneration: ownedRequestGeneration,
          result,
        });
        if (!accepted) {
          return;
        }
        recordAcceptedFactIdentities();
        revokeInvalidMutationOwners();
        if (
          state.evidence.expandedFactId !== null &&
          !acceptedIdentityMatchesExpandedEvidence()
        ) {
          evidenceOwner = null;
          expandedEvidenceIdentity = null;
          evidenceErrorCode = null;
          evidenceHasLoadedFirstPage = false;
          reduce({
            type: WorkspaceAiKnowledgeActionType.EvidenceCollapsed,
          });
        }
        if (state.evidence.expandedFactId === null) {
          evidenceOwner = null;
          expandedEvidenceIdentity = null;
          if (evidenceErrorCode !== KnowledgeBaseErrorCode.JobStateConflict) {
            evidenceErrorCode = null;
          }
          evidenceHasLoadedFirstPage = false;
        }
        metricsAcceptanceGeneration += 1;
        errorCode = null;
        partialErrorCode = null;
        partialRetry = null;
        if (
          projectionDialog &&
          (!projectionDialogOwner ||
            !acceptedIdentityMatchesProjectionDialog(projectionDialogOwner))
        ) {
          clearProjectionDialog();
        }
        publish();
        [...metricsListeners].forEach(listener => {
          try {
            listener(result.metrics);
          } catch {
            // Renderer callbacks cannot invalidate an already accepted backend page.
          }
        });
      } catch (caught) {
        if (!isOwnedRequest(workspaceGeneration, ownedRequestGeneration)) {
          return;
        }
        const accepted = reduce({
          type: WorkspaceAiKnowledgeActionType.ListRequestFailed,
          workspaceGeneration,
          requestGeneration: ownedRequestGeneration,
        });
        if (!accepted) {
          return;
        }
        const safeCode = toSafeErrorCode(caught);
        if (mode === WorkspaceAiKnowledgeListMode.Append || hadAcceptedRows) {
          partialErrorCode = safeCode;
          partialRetry = {
            mode,
            cursor: mode === WorkspaceAiKnowledgeListMode.Append ? cursor ?? null : null,
          };
        } else {
          errorCode = safeCode;
        }
        publish();
      } finally {
        if (listInFlight === request) {
          listInFlight = null;
          void drainTrailingRefresh();
        }
      }
    });
    listInFlight = request;
    started = dispatch(action);
    if (
      started &&
      listInFlight === request &&
      isOwnedRequest(workspaceGeneration, ownedRequestGeneration)
    ) {
      if (mode === WorkspaceAiKnowledgeListMode.Replace) {
        errorCode = null;
      }
      partialErrorCode = null;
      publish();
    }
    return request;
  };

  const startInitialRequest = (): Promise<void> => {
    if (disposed || listInFlight) {
      return listInFlight ?? Promise.resolve();
    }
    requestGeneration += 1;
    const ownedRequestGeneration = requestGeneration;
    const workspaceGeneration = state.workspaceGeneration;
    return startListRequest(
      {
        type: WorkspaceAiKnowledgeActionType.ListRequestStarted,
        workspaceGeneration,
        requestGeneration: ownedRequestGeneration,
        mode: WorkspaceAiKnowledgeListMode.Replace,
      },
      WorkspaceAiKnowledgeListMode.Replace,
    );
  };

  const drainTrailingRefresh = (): Promise<void> => {
    if (
      disposed ||
      listInFlight ||
      !hasPendingWorkspaceAiKnowledgeTrailingRefresh(state)
    ) {
      return listInFlight ?? Promise.resolve();
    }
    requestGeneration += 1;
    const ownedRequestGeneration = requestGeneration;
    const workspaceGeneration = state.workspaceGeneration;
    return startListRequest(
      {
        type: WorkspaceAiKnowledgeActionType.TrailingRefreshStarted,
        workspaceGeneration,
        requestGeneration: ownedRequestGeneration,
      },
      WorkspaceAiKnowledgeListMode.Replace,
    );
  };

  const startAppendRequest = (cursor: string | null): Promise<void> => {
    if (disposed || !cursor) {
      return Promise.resolve();
    }
    if (listInFlight) {
      return waitForFactIdle();
    }
    requestGeneration += 1;
    const ownedRequestGeneration = requestGeneration;
    const workspaceGeneration = state.workspaceGeneration;
    return startListRequest(
      {
        type: WorkspaceAiKnowledgeActionType.ListRequestStarted,
        workspaceGeneration,
        requestGeneration: ownedRequestGeneration,
        mode: WorkspaceAiKnowledgeListMode.Append,
      },
      WorkspaceAiKnowledgeListMode.Append,
      cursor,
    );
  };

  const requestRefresh = async (): Promise<WorkspaceAiKnowledgeRow[]> => {
    if (disposed) {
      return [];
    }
    dispatch({ type: WorkspaceAiKnowledgeActionType.RefreshRequested });
    void drainTrailingRefresh();
    await waitForFactIdle();
    return snapshot.rows;
  };

  const isOwnedWorkspaceContext = (
    ownedWorkspaceId: string,
    ownedWorkspaceGeneration: number,
  ): boolean =>
    !disposed &&
    currentWorkspaceId === ownedWorkspaceId &&
    state.workspaceId === ownedWorkspaceId &&
    state.workspaceGeneration === ownedWorkspaceGeneration;

  const isCurrentMutationOwner = (
    owner: WorkspaceAiKnowledgeMutationOwner,
  ): boolean => mutationOwners.get(owner.factId) === owner && !disposed;

  const isCurrentFactForMutationOwner = (
    owner: WorkspaceAiKnowledgeMutationOwner,
  ): boolean => acceptedIdentityMatchesMutationOwner(owner);

  const isCurrentMutationRecord = (
    owner: WorkspaceAiKnowledgeMutationOwner,
  ): boolean => {
    const mutation = state.mutations[owner.factId];
    return (
      isCurrentMutationOwner(owner) &&
      currentWorkspaceId === owner.workspaceId &&
      state.workspaceGeneration === owner.workspaceGeneration &&
      mutation?.workspaceGeneration === owner.workspaceGeneration &&
      mutation.requestGeneration === owner.requestGeneration &&
      mutation.kind === owner.kind
    );
  };

  const isCurrentMutationReducerState = (
    owner: WorkspaceAiKnowledgeMutationOwner,
  ): boolean =>
    isCurrentMutationRecord(owner) && isCurrentFactForMutationOwner(owner);

  const clearStaleMutationRecord = (
    owner: WorkspaceAiKnowledgeMutationOwner,
  ): boolean => {
    if (
      !isCurrentMutationRecord(owner) ||
      isCurrentFactForMutationOwner(owner)
    ) {
      return false;
    }
    const nextFeedback = { ...mutationFeedback };
    delete nextFeedback[owner.factId];
    mutationFeedback = nextFeedback;
    return dispatch({
      type: WorkspaceAiKnowledgeActionType.MutationFailed,
      workspaceGeneration: owner.workspaceGeneration,
      factId: owner.factId,
      requestGeneration: owner.requestGeneration,
      errorCode: KnowledgeBaseErrorCode.FactRevisionConflict,
    });
  };

  const setMutationFeedback = (
    factId: string,
    feedback: WorkspaceAiKnowledgeMutationFeedback,
  ): void => {
    mutationFeedback = {
      ...mutationFeedback,
      [factId]: feedback,
    };
  };

  const validateProjectionConflict = (
    owner: WorkspaceAiKnowledgeMutationOwner,
    caught: unknown,
  ): KnowledgeFactProjectionConflict | null => {
    if (
      !(caught instanceof KnowledgeBaseServiceError) ||
      caught.code !== KnowledgeBaseErrorCode.FactProjectionConflict ||
      !caught.projectionConflict
    ) {
      return null;
    }
    const conflict = caught.projectionConflict;
    const matchesCompany =
      owner.projectionKind === WorkspaceAiKnowledgeProjectionDialogKind.CompanyReplacement &&
      owner.kind === WorkspaceAiKnowledgeMutationKind.Review &&
      owner.domain === KnowledgeFactDomain.CompanySummary &&
      conflict.operation === KnowledgeFactProjectionOperation.Confirm &&
      conflict.kind === KnowledgeFactProjectionConflictKind.CompanySummaryReplacement &&
      conflict.domain === KnowledgeFactDomain.CompanySummary;
    const matchesArchive =
      owner.projectionKind === WorkspaceAiKnowledgeProjectionDialogKind.ArchiveConflict &&
      owner.kind === WorkspaceAiKnowledgeMutationKind.Archive &&
      conflict.operation === KnowledgeFactProjectionOperation.Archive &&
      conflict.kind === KnowledgeFactProjectionConflictKind.ArchiveFieldChanged &&
      conflict.domain === owner.domain;
    const currentFieldValueIsSafe =
      typeof conflict.currentFieldValue === 'string' ||
      (Array.isArray(conflict.currentFieldValue) &&
        [...conflict.currentFieldValue].every(value => typeof value === 'string'));
    if (
      (!matchesCompany && !matchesArchive) ||
      conflict.factId !== owner.factId ||
      conflict.factRevision !== owner.factRevision ||
      !isSafePositiveInteger(conflict.fieldRevision) ||
      !currentFieldValueIsSafe
    ) {
      return null;
    }
    return {
      ...conflict,
      currentFieldValue: Array.isArray(conflict.currentFieldValue)
        ? [...conflict.currentFieldValue]
        : conflict.currentFieldValue,
    };
  };

  const showProjectionConflict = (
    owner: WorkspaceAiKnowledgeMutationOwner,
    conflict: KnowledgeFactProjectionConflict,
  ): void => {
    projectionDialogGeneration += 1;
    const kind =
      owner.projectionKind === WorkspaceAiKnowledgeProjectionDialogKind.CompanyReplacement
        ? WorkspaceAiKnowledgeProjectionDialogKind.CompanyReplacement
        : WorkspaceAiKnowledgeProjectionDialogKind.ArchiveConflict;
    projectionDialogOwner = {
      kind,
      dialogGeneration: projectionDialogGeneration,
      workspaceGeneration: owner.workspaceGeneration,
      factId: conflict.factId,
      factRevision: conflict.factRevision,
      domain: conflict.domain,
      fieldRevision: conflict.fieldRevision,
      acceptedFactIdentity: { ...owner.acceptedFactIdentity },
    };
    projectionDialog = {
      kind,
      dialogGeneration: projectionDialogGeneration,
      workspaceGeneration: owner.workspaceGeneration,
      factId: conflict.factId,
      factRevision: conflict.factRevision,
      domain: conflict.domain,
      currentFieldValue: Array.isArray(conflict.currentFieldValue)
        ? [...conflict.currentFieldValue]
        : conflict.currentFieldValue,
      fieldRevision: conflict.fieldRevision,
      isSubmitting: false,
      errorCode: null,
    };
  };

  const getCurrentFactForAction = (
    fact: KnowledgeFactSummary,
  ): KnowledgeFactSummary | null => {
    if (!isKnowledgeFactSummary(fact)) {
      return null;
    }
    const current = state.items.find(item => item.id === fact.id);
    return current &&
      current.revision === fact.revision &&
      current.domain === fact.domain &&
      current.reviewStatus === fact.reviewStatus &&
      current.projectionState === fact.projectionState &&
      current.archivedAt === fact.archivedAt
      ? current
      : null;
  };

  const reconcileCommittedMutation = async (
    owner: WorkspaceAiKnowledgeMutationOwner,
    result: WorkspaceAiKnowledgeMutationResult,
  ): Promise<void> => {
    if (disposed || currentWorkspaceId !== owner.workspaceId) {
      return;
    }

    const factRefresh = requestRefresh();
    const profileRefresh = Promise.resolve()
      .then(async () => {
        if (
          disposed ||
          currentWorkspaceId !== owner.workspaceId ||
          result.profileChanged !== true ||
          !isSafePositiveInteger(result.profileRevision)
        ) {
          return;
        }
        await projectionRefreshHandler?.({
          workspaceId: owner.workspaceId,
          profileRevision: result.profileRevision as number,
        });
      })
      .catch(() => {
        // Projection refresh is independent from the accepted fact refresh.
      });

    await Promise.all([factRefresh, profileRefresh]);
  };

  const failMutation = async (
    owner: WorkspaceAiKnowledgeMutationOwner,
    errorCode: KnowledgeBaseErrorCodeValue,
  ): Promise<void> => {
    if (!isCurrentMutationOwner(owner)) {
      return;
    }
    if (!isCurrentMutationReducerState(owner)) {
      clearStaleMutationRecord(owner);
      return;
    }
    let acceptedCurrentFailure = false;
    if (errorCode === KnowledgeBaseErrorCode.JobStateConflict) {
      clearProjectionDialog();
      evidenceOwner = null;
      expandedEvidenceIdentity = null;
      evidenceErrorCode = null;
      evidenceHasLoadedFirstPage = false;
    } else if (
      owner.projectionDialogGeneration !== null &&
      projectionDialog?.dialogGeneration === owner.projectionDialogGeneration
    ) {
      projectionDialog = {
        ...projectionDialog,
        isSubmitting: false,
        errorCode,
      };
    }
    setMutationFeedback(owner.factId, {
      status: WorkspaceAiKnowledgeMutationFeedbackStatus.Failed,
      errorCode,
    });
    acceptedCurrentFailure = dispatch({
      type: WorkspaceAiKnowledgeActionType.MutationFailed,
      workspaceGeneration: owner.workspaceGeneration,
      factId: owner.factId,
      requestGeneration: owner.requestGeneration,
      errorCode,
    });
    if (
      errorCode === KnowledgeBaseErrorCode.JobStateConflict &&
      acceptedCurrentFailure &&
      isOwnedWorkspaceContext(owner.workspaceId, owner.workspaceGeneration)
    ) {
      await requestRefresh();
    }
  };

  const startMutation = (
    fact: Pick<KnowledgeFactSummary, 'id' | 'revision' | 'domain'>,
    kind: WorkspaceAiKnowledgeMutationKind,
    invoke: () => Promise<WorkspaceAiKnowledgeMutationResult>,
    options: {
      projectionKind?: WorkspaceAiKnowledgeProjectionDialogKind;
      preserveProjectionDialog?: boolean;
    } = {},
  ): Promise<void> => {
    if (disposed || !fact.id || !isSafePositiveInteger(fact.revision)) {
      return Promise.resolve();
    }
    const acceptedFactIdentity = acceptedFactIdentities.get(fact.id);
    if (
      !acceptedFactIdentity ||
      acceptedFactIdentity.revision !== fact.revision ||
      acceptedFactIdentity.domain !== fact.domain
    ) {
      return Promise.resolve();
    }
    const existingOwner = mutationOwners.get(fact.id);
    if (
      existingOwner &&
      existingOwner.workspaceId === currentWorkspaceId &&
      (existingOwner.serviceInvoked ||
        existingOwner.workspaceGeneration === state.workspaceGeneration)
    ) {
      return existingOwner.promise;
    }

    mutationRequestGeneration += 1;
    const owner: WorkspaceAiKnowledgeMutationOwner = {
      workspaceId: currentWorkspaceId,
      workspaceGeneration: state.workspaceGeneration,
      factId: fact.id,
      factRevision: fact.revision,
      domain: fact.domain,
      requestGeneration: mutationRequestGeneration,
      kind,
      projectionKind: options.projectionKind ?? null,
      projectionDialogGeneration:
        options.preserveProjectionDialog && projectionDialog
          ? projectionDialog.dialogGeneration
          : null,
      acceptedFactIdentity: { ...acceptedFactIdentity },
      promise: Promise.resolve(),
      serviceInvoked: false,
    };

    let request!: Promise<void>;
    request = Promise.resolve().then(async () => {
      try {
        if (!isCurrentMutationReducerState(owner)) {
          clearStaleMutationRecord(owner);
          return;
        }
        owner.serviceInvoked = true;
        const result = await invoke();
        if (
          !isWorkspaceAiKnowledgeMutationResult(result) ||
          result.fact.id !== owner.factId ||
          result.fact.domain !== owner.domain ||
          result.fact.revision <= owner.factRevision
        ) {
          if (isCurrentMutationOwner(owner)) {
            await failMutation(owner, KnowledgeBaseErrorCode.JobStateConflict);
          }
          return;
        }

        if (isCurrentMutationReducerState(owner)) {
          if (state.evidence.expandedFactId === owner.factId) {
            evidenceOwner = null;
            expandedEvidenceIdentity = null;
            evidenceErrorCode = null;
            evidenceHasLoadedFirstPage = false;
          }
          if (projectionDialog?.factId === owner.factId) {
            clearProjectionDialog();
          }
          setMutationFeedback(owner.factId, {
            status: WorkspaceAiKnowledgeMutationFeedbackStatus.Succeeded,
            errorCode: null,
          });
          const accepted = reduce({
            type: WorkspaceAiKnowledgeActionType.MutationSucceeded,
            workspaceGeneration: owner.workspaceGeneration,
            factId: owner.factId,
            requestGeneration: owner.requestGeneration,
            fact: result.fact,
          });
          if (accepted) {
            if (mutationOwners.get(owner.factId) === owner) {
              mutationOwners.delete(owner.factId);
            }
            mutationAnnouncementGeneration += 1;
            mutationAnnouncement = {
              status: WorkspaceAiKnowledgeMutationFeedbackStatus.Succeeded,
              generation: mutationAnnouncementGeneration,
            };
            publish();
          }
        } else {
          clearStaleMutationRecord(owner);
        }
        await reconcileCommittedMutation(owner, result);
      } catch (caught) {
        const conflict = validateProjectionConflict(owner, caught);
        if (conflict && isCurrentMutationReducerState(owner)) {
          showProjectionConflict(owner, conflict);
          setMutationFeedback(owner.factId, {
            status: WorkspaceAiKnowledgeMutationFeedbackStatus.Failed,
            errorCode: KnowledgeBaseErrorCode.FactProjectionConflict,
          });
          dispatch({
            type: WorkspaceAiKnowledgeActionType.MutationFailed,
            workspaceGeneration: owner.workspaceGeneration,
            factId: owner.factId,
            requestGeneration: owner.requestGeneration,
            errorCode: KnowledgeBaseErrorCode.FactProjectionConflict,
          });
        } else {
          const safeCode =
            caught instanceof KnowledgeBaseServiceError &&
            caught.code === KnowledgeBaseErrorCode.FactProjectionConflict
              ? KnowledgeBaseErrorCode.PersistenceFailed
              : toSafeErrorCode(caught);
          await failMutation(owner, safeCode);
        }
      } finally {
        if (mutationOwners.get(owner.factId) === owner) {
          mutationOwners.delete(owner.factId);
        }
      }
    });
    owner.promise = request;
    mutationOwners.set(owner.factId, owner);
    mutationAnnouncement = null;
    if (
      options.preserveProjectionDialog &&
      projectionDialog?.dialogGeneration === owner.projectionDialogGeneration
    ) {
      projectionDialog = {
        ...projectionDialog,
        isSubmitting: true,
        errorCode: null,
      };
    } else {
      clearProjectionDialog();
    }
    setMutationFeedback(owner.factId, {
      status: WorkspaceAiKnowledgeMutationFeedbackStatus.Submitting,
      errorCode: null,
    });
    const started = dispatch({
      type: WorkspaceAiKnowledgeActionType.MutationStarted,
      workspaceGeneration: owner.workspaceGeneration,
      factId: owner.factId,
      requestGeneration: owner.requestGeneration,
      kind: owner.kind,
    });
    if (!started && mutationOwners.get(owner.factId) === owner) {
      mutationOwners.delete(owner.factId);
    }
    return request;
  };

  const reviewFact = (
    fact: KnowledgeFactSummary,
    decision: KnowledgeFactReviewDecisionValue,
  ): Promise<void> => {
    const currentFact = getCurrentFactForAction(fact);
    if (
      !currentFact ||
      currentFact.reviewStatus !== KnowledgeFactReviewStatus.Pending ||
      currentFact.archivedAt !== null ||
      (decision === KnowledgeFactReviewDecision.Confirm &&
        currentFact.activeEvidenceCount <= 0) ||
      (decision !== KnowledgeFactReviewDecision.Confirm &&
        decision !== KnowledgeFactReviewDecision.Reject)
    ) {
      return Promise.resolve();
    }
    const request: KnowledgeReviewFactRequest = {
      factId: currentFact.id,
      expectedRevision: currentFact.revision,
      decision,
    };
    return startMutation(
      currentFact,
      WorkspaceAiKnowledgeMutationKind.Review,
      () => service.reviewFact(request),
      {
        projectionKind:
          decision === KnowledgeFactReviewDecision.Confirm &&
          currentFact.domain === KnowledgeFactDomain.CompanySummary
            ? WorkspaceAiKnowledgeProjectionDialogKind.CompanyReplacement
            : undefined,
      },
    );
  };

  const archiveFact = (fact: KnowledgeFactSummary): Promise<void> => {
    const currentFact = getCurrentFactForAction(fact);
    if (
      !currentFact ||
      currentFact.reviewStatus !== KnowledgeFactReviewStatus.Confirmed ||
      currentFact.archivedAt !== null
    ) {
      return Promise.resolve();
    }
    if (currentFact.projectionState === KnowledgeFactProjectionState.Conflict) {
      projectionDialogGeneration += 1;
      mutationAnnouncement = null;
      projectionDialogOwner = {
        kind: WorkspaceAiKnowledgeProjectionDialogKind.ArchiveLedgerless,
        dialogGeneration: projectionDialogGeneration,
        workspaceGeneration: state.workspaceGeneration,
        factId: currentFact.id,
        factRevision: currentFact.revision,
        domain: currentFact.domain,
        fieldRevision: null,
        acceptedFactIdentity: {
          revision: currentFact.revision,
          domain: currentFact.domain,
          reviewStatus: currentFact.reviewStatus,
          projectionState: currentFact.projectionState,
          archivedAt: currentFact.archivedAt,
        },
      };
      projectionDialog = {
        kind: WorkspaceAiKnowledgeProjectionDialogKind.ArchiveLedgerless,
        dialogGeneration: projectionDialogGeneration,
        workspaceGeneration: state.workspaceGeneration,
        factId: currentFact.id,
        factRevision: currentFact.revision,
        domain: currentFact.domain,
        currentFieldValue: null,
        fieldRevision: null,
        isSubmitting: false,
        errorCode: null,
      };
      publish();
      return Promise.resolve();
    }
    const request: KnowledgeArchiveFactRequest = {
      factId: currentFact.id,
      expectedRevision: currentFact.revision,
    };
    return startMutation(
      currentFact,
      WorkspaceAiKnowledgeMutationKind.Archive,
      () => service.archiveFact(request),
      { projectionKind: WorkspaceAiKnowledgeProjectionDialogKind.ArchiveConflict },
    );
  };

  const getCurrentProjectionDialogOwnership = (): {
    dialog: WorkspaceAiKnowledgeProjectionDialogState;
    owner: WorkspaceAiKnowledgeProjectionDialogOwner;
  } | null => {
    if (
      disposed ||
      !projectionDialog ||
      !projectionDialogOwner ||
      projectionDialog.workspaceGeneration !== state.workspaceGeneration ||
      projectionDialogOwner.workspaceGeneration !== state.workspaceGeneration ||
      projectionDialogOwner.dialogGeneration !== projectionDialog.dialogGeneration ||
      projectionDialogOwner.kind !== projectionDialog.kind ||
      projectionDialogOwner.factId !== projectionDialog.factId ||
      projectionDialogOwner.factRevision !== projectionDialog.factRevision ||
      projectionDialogOwner.domain !== projectionDialog.domain ||
      projectionDialogOwner.fieldRevision !== projectionDialog.fieldRevision
    ) {
      return null;
    }
    const ownedDialog = projectionDialog;
    const ownedDialogOwner = projectionDialogOwner;
    if (!acceptedIdentityMatchesProjectionDialog(ownedDialogOwner)) {
      return null;
    }
    return { dialog: ownedDialog, owner: ownedDialogOwner };
  };

  const resolveCompanyReplacement = (): Promise<void> => {
    const ownership = getCurrentProjectionDialogOwnership();
    const dialog = ownership?.dialog;
    const dialogOwner = ownership?.owner;
    if (
      !dialog ||
      !dialogOwner ||
      dialog.kind !== WorkspaceAiKnowledgeProjectionDialogKind.CompanyReplacement ||
      dialogOwner.kind !== WorkspaceAiKnowledgeProjectionDialogKind.CompanyReplacement ||
      dialogOwner.fieldRevision === null ||
      dialog.isSubmitting
    ) {
      return Promise.resolve();
    }
    const request: KnowledgeReviewFactRequest = {
      factId: dialogOwner.factId,
      expectedRevision: dialogOwner.factRevision,
      decision: KnowledgeFactReviewDecision.Confirm,
      replaceExisting: true,
      expectedFieldRevision: dialogOwner.fieldRevision,
    };
    return startMutation(
      {
        id: dialogOwner.factId,
        revision: dialogOwner.factRevision,
        domain: dialogOwner.domain,
      },
      WorkspaceAiKnowledgeMutationKind.Review,
      () => service.reviewFact(request),
      {
        projectionKind: WorkspaceAiKnowledgeProjectionDialogKind.CompanyReplacement,
        preserveProjectionDialog: true,
      },
    );
  };

  const resolveArchiveProjection = (
    decision: KnowledgeFactArchiveProjectionDecisionValue,
  ): Promise<void> => {
    const ownership = getCurrentProjectionDialogOwnership();
    const dialog = ownership?.dialog;
    const dialogOwner = ownership?.owner;
    if (
      !dialog ||
      !dialogOwner ||
      dialog.kind === WorkspaceAiKnowledgeProjectionDialogKind.CompanyReplacement ||
      dialog.isSubmitting ||
      (decision === KnowledgeFactArchiveProjectionDecision.RemoveCurrent &&
        (dialogOwner.kind !== WorkspaceAiKnowledgeProjectionDialogKind.ArchiveConflict ||
          dialogOwner.fieldRevision === null))
    ) {
      return Promise.resolve();
    }
    const request: KnowledgeArchiveFactRequest = {
      factId: dialogOwner.factId,
      expectedRevision: dialogOwner.factRevision,
      projectionDecision: decision,
      ...(decision === KnowledgeFactArchiveProjectionDecision.RemoveCurrent
        ? { expectedFieldRevision: dialogOwner.fieldRevision as number }
        : {}),
    };
    return startMutation(
      {
        id: dialogOwner.factId,
        revision: dialogOwner.factRevision,
        domain: dialogOwner.domain,
      },
      WorkspaceAiKnowledgeMutationKind.Archive,
      () => service.archiveFact(request),
      {
        projectionKind: dialogOwner.kind,
        preserveProjectionDialog: true,
      },
    );
  };

  const dismissProjectionConflict = (): void => {
    if (!projectionDialog || projectionDialog.isSubmitting) {
      return;
    }
    clearProjectionDialog();
    publish();
  };

  const isCurrentEvidenceOwner = (
    owner: WorkspaceAiKnowledgeEvidenceOwner,
  ): boolean => {
    const activeRequest = state.evidence.activeRequest;
    return (
      !disposed &&
      evidenceOwner === owner &&
      currentWorkspaceId === owner.workspaceId &&
      state.workspaceId === owner.workspaceId &&
      state.workspaceGeneration === owner.workspaceGeneration &&
      expandedEvidenceIdentity?.factId === owner.factId &&
      expandedEvidenceIdentity.factRevision === owner.factRevision &&
      expandedEvidenceIdentity.domain === owner.domain &&
      acceptedIdentityMatchesExpandedEvidence() &&
      state.evidence.expandedFactId === owner.factId &&
      state.evidence.factRevision === owner.factRevision &&
      activeRequest?.requestGeneration === owner.requestGeneration &&
      activeRequest.factId === owner.factId &&
      activeRequest.factRevision === owner.factRevision &&
      activeRequest.mode === owner.mode
    );
  };

  const failEvidence = async (
    owner: WorkspaceAiKnowledgeEvidenceOwner,
    safeCode: KnowledgeBaseErrorCodeValue,
  ): Promise<void> => {
    if (!isCurrentEvidenceOwner(owner)) {
      return;
    }
    if (safeCode === KnowledgeBaseErrorCode.JobStateConflict) {
      clearProjectionDialog();
    }
    evidenceErrorCode = safeCode;
    const accepted = reduce({
      type: WorkspaceAiKnowledgeActionType.EvidenceRequestFailed,
      workspaceGeneration: owner.workspaceGeneration,
      requestGeneration: owner.requestGeneration,
      errorCode: safeCode,
    });
    if (!accepted) {
      return;
    }
    if (safeCode === KnowledgeBaseErrorCode.JobStateConflict) {
      evidenceOwner = null;
      expandedEvidenceIdentity = null;
      evidenceHasLoadedFirstPage = false;
    }
    publish();
    if (
      safeCode === KnowledgeBaseErrorCode.JobStateConflict &&
      isOwnedWorkspaceContext(owner.workspaceId, owner.workspaceGeneration)
    ) {
      await requestRefresh();
    }
  };

  const startEvidenceRequest = (
    factId: string,
    factRevision: number,
    domain: KnowledgeFactDomainValue,
    mode: WorkspaceAiKnowledgeListMode,
    cursor: string | null,
    expandFirst: boolean,
  ): Promise<void> => {
    if (
      disposed ||
      !factId ||
      !isSafePositiveInteger(factRevision) ||
      !Object.values(KnowledgeFactDomain).includes(domain) ||
      (mode === WorkspaceAiKnowledgeListMode.Append && !cursor)
    ) {
      return Promise.resolve();
    }
    const acceptedIdentity = acceptedFactIdentities.get(factId);
    if (
      !acceptedIdentity ||
      acceptedIdentity.revision !== factRevision ||
      acceptedIdentity.domain !== domain
    ) {
      return Promise.resolve();
    }
    if (evidenceOwner) {
      return evidenceOwner.promise;
    }

    let expandedChanged = false;
    if (expandFirst) {
      expandedEvidenceIdentity = {
        factId,
        factRevision,
        domain,
      };
      expandedChanged = reduce({
        type: WorkspaceAiKnowledgeActionType.EvidenceExpanded,
        factId,
        factRevision,
      });
    }
    if (
      state.evidence.expandedFactId !== factId ||
      state.evidence.factRevision !== factRevision ||
      expandedEvidenceIdentity?.domain !== domain ||
      !acceptedIdentityMatchesExpandedEvidence()
    ) {
      expandedEvidenceIdentity = null;
      if (expandedChanged) {
        publish();
      }
      return Promise.resolve();
    }

    evidenceRequestGeneration += 1;
    const requestGeneration = evidenceRequestGeneration;
    const workspaceGeneration = state.workspaceGeneration;
    const requestInput: KnowledgeFactEvidencePageRequest = {
      factId,
      expectedRevision: factRevision,
      ...(mode === WorkspaceAiKnowledgeListMode.Append && cursor
        ? { cursor }
        : {}),
      limit: KNOWLEDGE_FACT_EVIDENCE_PAGE_DEFAULT_LIMIT,
    };
    const owner = {
      workspaceId: currentWorkspaceId,
      workspaceGeneration,
      factId,
      factRevision,
      domain,
      requestGeneration,
      mode,
      cursor,
      promise: Promise.resolve(),
    } satisfies WorkspaceAiKnowledgeEvidenceOwner;
    let request!: Promise<void>;
    request = Promise.resolve().then(async () => {
      try {
        if (!isCurrentEvidenceOwner(owner)) {
          return;
        }
        const page: unknown = await service.getFactEvidence(requestInput);
        if (!isCurrentEvidenceOwner(owner)) {
          return;
        }
        if (
          !isKnowledgeFactEvidencePageResult(page) ||
          page.factId !== owner.factId ||
          page.factRevision !== owner.factRevision ||
          page.items.some(item => item.factId !== owner.factId)
        ) {
          await failEvidence(owner, KnowledgeBaseErrorCode.JobStateConflict);
          return;
        }
        const accepted = reduce({
          type: WorkspaceAiKnowledgeActionType.EvidenceRequestSucceeded,
          workspaceGeneration: owner.workspaceGeneration,
          requestGeneration: owner.requestGeneration,
          result: page,
        });
        if (!accepted) {
          return;
        }
        if (owner.mode === WorkspaceAiKnowledgeListMode.Replace) {
          evidenceHasLoadedFirstPage = true;
        }
        evidenceErrorCode = null;
        publish();
      } catch (caught) {
        await failEvidence(owner, toSafeErrorCode(caught));
      } finally {
        if (evidenceOwner === owner) {
          evidenceOwner = null;
        }
      }
    });
    owner.promise = request;
    evidenceOwner = owner;
    evidenceErrorCode = null;
    const started = reduce({
      type: WorkspaceAiKnowledgeActionType.EvidenceRequestStarted,
      workspaceGeneration,
      requestGeneration,
      factId,
      factRevision,
      mode,
    });
    if (!started && evidenceOwner === owner) {
      evidenceOwner = null;
    }
    if (expandedChanged || started) {
      publish();
    }
    return request;
  };

  const expandEvidence = (fact: KnowledgeFactSummary): Promise<void> => {
    const currentFact = getCurrentFactForAction(fact);
    if (!currentFact) {
      return Promise.resolve();
    }
    if (
      state.evidence.expandedFactId === currentFact.id &&
      state.evidence.factRevision === currentFact.revision &&
      expandedEvidenceIdentity?.factId === currentFact.id &&
      expandedEvidenceIdentity.factRevision === currentFact.revision &&
      expandedEvidenceIdentity.domain === currentFact.domain
    ) {
      if (evidenceOwner) {
        return evidenceOwner.promise;
      }
      if (evidenceHasLoadedFirstPage || evidenceErrorCode !== null) {
        return Promise.resolve();
      }
    } else {
      evidenceOwner = null;
      expandedEvidenceIdentity = null;
      evidenceErrorCode = null;
      evidenceHasLoadedFirstPage = false;
    }
    return startEvidenceRequest(
      currentFact.id,
      currentFact.revision,
      currentFact.domain,
      WorkspaceAiKnowledgeListMode.Replace,
      null,
      true,
    );
  };

  const collapseEvidence = (): void => {
    const hadControllerState =
      evidenceOwner !== null ||
      expandedEvidenceIdentity !== null ||
      evidenceErrorCode !== null ||
      evidenceHasLoadedFirstPage;
    evidenceOwner = null;
    expandedEvidenceIdentity = null;
    evidenceErrorCode = null;
    evidenceHasLoadedFirstPage = false;
    const collapsed = reduce({
      type: WorkspaceAiKnowledgeActionType.EvidenceCollapsed,
    });
    if (collapsed || hadControllerState) {
      publish();
    }
  };

  const loadMoreEvidence = (): Promise<void> => {
    if (
      evidenceOwner ||
      expandedEvidenceIdentity === null ||
      state.evidence.expandedFactId === null ||
      state.evidence.factRevision === null ||
      state.evidence.nextCursor === null
    ) {
      return evidenceOwner?.promise ?? Promise.resolve();
    }
    const cursor = state.evidence.nextCursor;
    return startEvidenceRequest(
      state.evidence.expandedFactId,
      state.evidence.factRevision,
      expandedEvidenceIdentity.domain,
      WorkspaceAiKnowledgeListMode.Append,
      cursor,
      false,
    );
  };

  const retryEvidence = (): Promise<void> => {
    if (
      evidenceOwner ||
      expandedEvidenceIdentity === null ||
      state.evidence.expandedFactId === null ||
      state.evidence.factRevision === null
    ) {
      return evidenceOwner?.promise ?? Promise.resolve();
    }
    return startEvidenceRequest(
      state.evidence.expandedFactId,
      state.evidence.factRevision,
      expandedEvidenceIdentity.domain,
      WorkspaceAiKnowledgeListMode.Replace,
      null,
      false,
    );
  };

  const updateContext = async (input: WorkspaceAiKnowledgeContextInput): Promise<void> => {
    if (disposed) {
      return;
    }
    const nextContextKey = `${input.workspaceId}\u0000${input.profileRevision}\u0000${buildWorkspaceAiKnowledgeFilterKey(filters)}`;
    currentProfile = input.profile;
    if (nextContextKey === contextKey) {
      publish();
      await waitForFactIdle();
      return;
    }

    const workspaceChanged = input.workspaceId !== currentWorkspaceId;
    currentWorkspaceId = input.workspaceId;
    currentProfileRevision = input.profileRevision;
    contextKey = nextContextKey;
    workspaceGeneration += 1;
    errorCode = null;
    partialErrorCode = null;
    partialRetry = null;
    mutationFeedback = {};
    mutationAnnouncement = null;
    clearProjectionDialog();
    evidenceOwner = null;
    expandedEvidenceIdentity = null;
    evidenceErrorCode = null;
    evidenceHasLoadedFirstPage = false;
    acceptedFactIdentities.clear();
    mutationOwners.clear();
    dispatch({
      type: WorkspaceAiKnowledgeActionType.ContextReset,
      workspaceId: currentWorkspaceId,
      workspaceGeneration,
      filters,
    });
    const pollingContextUpdate = workspaceChanged
      ? documentPolling?.updateWorkspace(currentWorkspaceId)
      : Promise.resolve();
    if (hasStarted) {
      dispatch({ type: WorkspaceAiKnowledgeActionType.RefreshRequested });
      void drainTrailingRefresh();
      await Promise.all([
        waitForFactIdle(),
        pollingContextUpdate,
      ]);
      await waitForFactIdle();
    } else {
      await pollingContextUpdate;
    }
  };

  const updateFilters = async (
    nextFilters: WorkspaceAiKnowledgeFilters,
  ): Promise<void> => {
    if (disposed) {
      return;
    }
    const canonicalFilters = canonicalizeWorkspaceAiKnowledgeFilters(nextFilters);
    const nextFilterKey = buildWorkspaceAiKnowledgeFilterKey(canonicalFilters);
    if (nextFilterKey === buildWorkspaceAiKnowledgeFilterKey(filters)) {
      return;
    }
    filters = canonicalFilters;
    const nextContextKey = `${currentWorkspaceId}\u0000${currentProfileRevision}\u0000${nextFilterKey}`;
    contextKey = nextContextKey;
    workspaceGeneration += 1;
    errorCode = null;
    partialErrorCode = null;
    partialRetry = null;
    mutationFeedback = {};
    mutationAnnouncement = null;
    clearProjectionDialog();
    evidenceOwner = null;
    expandedEvidenceIdentity = null;
    evidenceErrorCode = null;
    evidenceHasLoadedFirstPage = false;
    acceptedFactIdentities.clear();
    mutationOwners.clear();
    dispatch({
      type: WorkspaceAiKnowledgeActionType.ContextReset,
      workspaceId: currentWorkspaceId,
      workspaceGeneration,
      filters,
    });
    if (hasStarted) {
      dispatch({ type: WorkspaceAiKnowledgeActionType.RefreshRequested });
      void drainTrailingRefresh();
      await waitForFactIdle();
    }
  };

  documentPolling = createWorkspaceAiKnowledgeDocumentPollingController({
    workspaceId: currentWorkspaceId,
    listDocuments: service.listDocuments,
    onReviewRequired: async (): Promise<void> => {
      await requestRefresh();
    },
  });

  return {
    start: async () => {
      if (hasStarted) {
        await waitForFactIdle();
        return;
      }
      hasStarted = true;
      await Promise.all([startInitialRequest(), documentPolling?.start()]);
      await waitForFactIdle();
    },
    getSnapshot: () => snapshot,
    subscribe: listener => {
      if (disposed) {
        return () => undefined;
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeAcceptedMetrics: listener => {
      if (disposed) {
        return () => undefined;
      }
      metricsListeners.add(listener);
      return () => {
        metricsListeners.delete(listener);
      };
    },
    retryInitial: async () => {
      await requestRefresh();
    },
    loadMore: async () => {
      const cursor = state.nextCursor;
      await startAppendRequest(cursor);
      await waitForFactIdle();
    },
    retryPartial: async () => {
      const retry = partialRetry;
      if (!retry) {
        return;
      }
      if (retry.mode === WorkspaceAiKnowledgeListMode.Replace) {
        await requestRefresh();
      } else {
        await startAppendRequest(retry.cursor);
        await waitForFactIdle();
      }
    },
    refreshAfterMutation: requestRefresh,
    reviewFact,
    archiveFact,
    resolveCompanyReplacement,
    resolveArchiveKeepCurrent: () =>
      resolveArchiveProjection(KnowledgeFactArchiveProjectionDecision.KeepCurrent),
    resolveArchiveRemoveCurrent: () =>
      resolveArchiveProjection(KnowledgeFactArchiveProjectionDecision.RemoveCurrent),
    dismissProjectionConflict,
    expandEvidence,
    collapseEvidence,
    loadMoreEvidence,
    retryEvidence,
    setProjectionRefreshHandler: handler => {
      projectionRefreshHandler = handler;
    },
    updateContext,
    setView: view => updateFilters({ ...filters, view }),
    setReviewStatuses: reviewStatuses => updateFilters({ ...filters, reviewStatuses }),
    setEvidenceState: evidenceState => updateFilters({ ...filters, evidenceState }),
    dispose: () => {
      disposed = true;
      mutationOwners.clear();
      mutationAnnouncement = null;
      clearProjectionDialog();
      evidenceOwner = null;
      expandedEvidenceIdentity = null;
      evidenceErrorCode = null;
      evidenceHasLoadedFirstPage = false;
      acceptedFactIdentities.clear();
      state = workspaceAiKnowledgeReducer(state, {
        type: WorkspaceAiKnowledgeActionType.EvidenceCollapsed,
      });
      snapshot = createSnapshot();
      projectionRefreshHandler = undefined;
      documentPolling?.dispose();
      listeners.clear();
      metricsListeners.clear();
    },
  };
};

export type UseWorkspaceAiKnowledgeInput = CreateWorkspaceAiKnowledgeControllerInput;

export interface UseWorkspaceAiKnowledgeResult extends WorkspaceAiKnowledgeSnapshot {
  setView: WorkspaceAiKnowledgeController['setView'];
  setReviewStatuses: WorkspaceAiKnowledgeController['setReviewStatuses'];
  setEvidenceState: WorkspaceAiKnowledgeController['setEvidenceState'];
  loadMore: WorkspaceAiKnowledgeController['loadMore'];
  retryInitial: WorkspaceAiKnowledgeController['retryInitial'];
  retryPartial: WorkspaceAiKnowledgeController['retryPartial'];
  refreshAfterMutation: WorkspaceAiKnowledgeController['refreshAfterMutation'];
  reviewFact: WorkspaceAiKnowledgeController['reviewFact'];
  archiveFact: WorkspaceAiKnowledgeController['archiveFact'];
  resolveCompanyReplacement: WorkspaceAiKnowledgeController['resolveCompanyReplacement'];
  resolveArchiveKeepCurrent: WorkspaceAiKnowledgeController['resolveArchiveKeepCurrent'];
  resolveArchiveRemoveCurrent: WorkspaceAiKnowledgeController['resolveArchiveRemoveCurrent'];
  dismissProjectionConflict: WorkspaceAiKnowledgeController['dismissProjectionConflict'];
  expandEvidence: WorkspaceAiKnowledgeController['expandEvidence'];
  collapseEvidence: WorkspaceAiKnowledgeController['collapseEvidence'];
  loadMoreEvidence: WorkspaceAiKnowledgeController['loadMoreEvidence'];
  retryEvidence: WorkspaceAiKnowledgeController['retryEvidence'];
  subscribeAcceptedMetrics: WorkspaceAiKnowledgeController['subscribeAcceptedMetrics'];
}

interface WorkspaceAiKnowledgeControllerHolder {
  service: WorkspaceAiKnowledgeService;
  controller: WorkspaceAiKnowledgeController;
  lease: DeferredWorkspaceAiKnowledgeControllerLease;
}

interface WorkspaceAiKnowledgeHookState {
  holder: WorkspaceAiKnowledgeControllerHolder;
  snapshot: WorkspaceAiKnowledgeSnapshot;
}

export const useWorkspaceAiKnowledge = (
  input: UseWorkspaceAiKnowledgeInput,
): UseWorkspaceAiKnowledgeResult => {
  const service = input.service ?? knowledgeBaseService;
  const holder = useMemo<WorkspaceAiKnowledgeControllerHolder>(() => {
    const controller = createWorkspaceAiKnowledgeController({
      ...input,
      service,
      onProjectionRefresh: undefined,
    });
    return {
      service,
      controller,
      lease: createDeferredWorkspaceAiKnowledgeControllerLease({
        dispose: controller.dispose,
      }),
    };
    // The controller lifetime is service-scoped; semantic input changes flow through updateContext.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service]);
  const [hookState, setHookState] = useState<WorkspaceAiKnowledgeHookState>(() => ({
    holder,
    snapshot: holder.controller.getSnapshot(),
  }));
  const snapshot =
    hookState.holder === holder
      ? hookState.snapshot
      : holder.controller.getSnapshot();

  useLayoutEffect(() => {
    void holder.controller.updateContext({
      workspaceId: input.workspaceId,
      profileRevision: input.profileRevision,
      profile: input.profile,
    });
  }, [holder, input.profile, input.profileRevision, input.workspaceId]);

  useLayoutEffect(() => {
    holder.controller.setProjectionRefreshHandler(input.onProjectionRefresh);
    return () => {
      holder.controller.setProjectionRefreshHandler(undefined);
    };
  }, [holder, input.onProjectionRefresh]);

  useEffect(() => {
    const release = holder.lease.acquire();
    const unsubscribe = holder.controller.subscribe(() => {
      setHookState({ holder, snapshot: holder.controller.getSnapshot() });
    });
    setHookState({ holder, snapshot: holder.controller.getSnapshot() });
    void holder.controller.start();
    return () => {
      unsubscribe();
      release();
    };
  }, [holder]);

  const displaySnapshot = selectWorkspaceAiKnowledgeDisplaySnapshot(snapshot, input);

  return {
    ...displaySnapshot,
    setView: holder.controller.setView,
    setReviewStatuses: holder.controller.setReviewStatuses,
    setEvidenceState: holder.controller.setEvidenceState,
    loadMore: holder.controller.loadMore,
    retryInitial: holder.controller.retryInitial,
    retryPartial: holder.controller.retryPartial,
    refreshAfterMutation: holder.controller.refreshAfterMutation,
    reviewFact: holder.controller.reviewFact,
    archiveFact: holder.controller.archiveFact,
    resolveCompanyReplacement: holder.controller.resolveCompanyReplacement,
    resolveArchiveKeepCurrent: holder.controller.resolveArchiveKeepCurrent,
    resolveArchiveRemoveCurrent: holder.controller.resolveArchiveRemoveCurrent,
    dismissProjectionConflict: holder.controller.dismissProjectionConflict,
    expandEvidence: holder.controller.expandEvidence,
    collapseEvidence: holder.controller.collapseEvidence,
    loadMoreEvidence: holder.controller.loadMoreEvidence,
    retryEvidence: holder.controller.retryEvidence,
    subscribeAcceptedMetrics: holder.controller.subscribeAcceptedMetrics,
  };
};
