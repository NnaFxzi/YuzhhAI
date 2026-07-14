import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import type { EnterpriseLeadWorkspaceProfile } from '../../../shared/enterpriseLeadWorkspace/types';
import {
  KnowledgeBaseErrorCode,
  type KnowledgeBaseErrorCode as KnowledgeBaseErrorCodeValue,
  KnowledgeFactDomain,
  type KnowledgeFactDomain as KnowledgeFactDomainValue,
  type KnowledgeFactEvidenceState as KnowledgeFactEvidenceStateValue,
  KnowledgeFactListView,
  type KnowledgeFactListView as KnowledgeFactListViewValue,
  KnowledgeFactReviewDecision,
  type KnowledgeFactReviewDecision as KnowledgeFactReviewDecisionValue,
  KnowledgeFactReviewStatus,
  type KnowledgeFactReviewStatus as KnowledgeFactReviewStatusValue,
  KnowledgeFactSourceKind,
  type KnowledgeFactSourceKind as KnowledgeFactSourceKindValue,
} from '../../../shared/knowledgeBase/constants';
import type { KnowledgeFactMetrics, KnowledgeFactSummary } from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import {
  useWorkspaceAiKnowledge,
  type WorkspaceAiKnowledgeCanonicalFilters,
  type WorkspaceAiKnowledgeMutationFeedback,
  WorkspaceAiKnowledgeMutationFeedbackStatus,
  type WorkspaceAiKnowledgeProjectionDialogState,
  type WorkspaceAiKnowledgeProjectionRefreshHandler,
  type WorkspaceAiKnowledgeSnapshot,
} from './useWorkspaceAiKnowledge';
import WorkspaceAiKnowledgeFilters from './WorkspaceAiKnowledgeFilters';
import type { WorkspaceAiKnowledgeRow } from './workspaceAiKnowledgeRows';
import type { WorkspaceAiKnowledgeState } from './workspaceAiKnowledgeState';
import WorkspaceKnowledgeFactDialogs from './WorkspaceKnowledgeFactDialogs';
import WorkspaceKnowledgeFactEvidenceDrawer from './WorkspaceKnowledgeFactEvidenceDrawer';

const domainKeys: Record<KnowledgeFactDomainValue, string> = {
  [KnowledgeFactDomain.CompanySummary]: 'enterpriseAiKnowledgeDomainCompanySummary',
  [KnowledgeFactDomain.ProductList]: 'enterpriseAiKnowledgeDomainProductList',
  [KnowledgeFactDomain.ProductCapabilities]: 'enterpriseAiKnowledgeDomainProductCapabilities',
  [KnowledgeFactDomain.TargetCustomers]: 'enterpriseAiKnowledgeDomainTargetCustomers',
  [KnowledgeFactDomain.ApplicationScenarios]: 'enterpriseAiKnowledgeDomainApplicationScenarios',
  [KnowledgeFactDomain.SellingPoints]: 'enterpriseAiKnowledgeDomainSellingPoints',
  [KnowledgeFactDomain.ChannelPreferences]: 'enterpriseAiKnowledgeDomainChannelPreferences',
  [KnowledgeFactDomain.ProhibitedClaims]: 'enterpriseAiKnowledgeDomainProhibitedClaims',
  [KnowledgeFactDomain.ContactRules]: 'enterpriseAiKnowledgeDomainContactRules',
  [KnowledgeFactDomain.MissingInfo]: 'enterpriseAiKnowledgeDomainMissingInfo',
};

const reviewStatusKeys: Record<KnowledgeFactReviewStatusValue, string> = {
  [KnowledgeFactReviewStatus.Pending]: 'enterpriseAiKnowledgeStatusPending',
  [KnowledgeFactReviewStatus.Confirmed]: 'enterpriseAiKnowledgeStatusConfirmed',
  [KnowledgeFactReviewStatus.Rejected]: 'enterpriseAiKnowledgeStatusRejected',
};

const sourceKindKeys: Record<KnowledgeFactSourceKindValue, string> = {
  [KnowledgeFactSourceKind.Extracted]: 'enterpriseAiKnowledgeSourceExtracted',
  [KnowledgeFactSourceKind.Manual]: 'enterpriseAiKnowledgeSourceManual',
  [KnowledgeFactSourceKind.Imported]: 'enterpriseAiKnowledgeSourceImported',
};

export interface WorkspaceAiKnowledgePanelViewProps {
  rows: WorkspaceAiKnowledgeRow[];
  metrics: KnowledgeFactMetrics;
  filters: WorkspaceAiKnowledgeCanonicalFilters;
  nextCursor: string | null;
  isInitialLoading: boolean;
  isLoadingMore: boolean;
  errorCode: KnowledgeBaseErrorCodeValue | null;
  partialErrorCode: KnowledgeBaseErrorCodeValue | null;
  mutations: WorkspaceAiKnowledgeState['mutations'];
  mutationFeedback: Record<string, WorkspaceAiKnowledgeMutationFeedback>;
  mutationAnnouncement: WorkspaceAiKnowledgeSnapshot['mutationAnnouncement'];
  projectionDialog: WorkspaceAiKnowledgeProjectionDialogState | null;
  evidence: WorkspaceAiKnowledgeState['evidence'];
  evidenceErrorCode: KnowledgeBaseErrorCodeValue | null;
  evidenceHasLoadedFirstPage: boolean;
  onViewChange: (view: KnowledgeFactListViewValue) => void;
  onReviewStatusesChange: (statuses: KnowledgeFactReviewStatusValue[]) => void;
  onEvidenceStateChange: (state: KnowledgeFactEvidenceStateValue) => void;
  onRetryInitial: () => void;
  onRetryPartial: () => void;
  onLoadMore: () => void;
  onMaintainCompany: () => void;
  onReviewFact: (
    fact: KnowledgeFactSummary,
    decision: KnowledgeFactReviewDecisionValue,
  ) => void;
  onArchiveFact: (fact: KnowledgeFactSummary) => void;
  onToggleEvidence: (fact: KnowledgeFactSummary) => void;
  onLoadMoreEvidence: () => void;
  onRetryEvidence: () => void;
  onDismissProjectionConflict: () => void;
  onResolveCompanyReplacement: () => Promise<void> | void;
  onResolveArchiveKeepCurrent: () => Promise<void> | void;
  onResolveArchiveRemoveCurrent: () => Promise<void> | void;
  focusAnchorRef?: React.RefObject<HTMLDivElement>;
}

const getReviewStatusKey = (fact: KnowledgeFactSummary): string =>
  fact.archivedAt
    ? 'enterpriseAiKnowledgeStatusArchived'
    : reviewStatusKeys[fact.reviewStatus];

const renderMutationFeedback = (
  feedback: WorkspaceAiKnowledgeMutationFeedback | undefined,
): React.ReactElement | null => {
  if (!feedback) {
    return null;
  }
  if (feedback.status === WorkspaceAiKnowledgeMutationFeedbackStatus.Failed) {
    const stale =
      feedback.errorCode === KnowledgeBaseErrorCode.FactRevisionConflict ||
      feedback.errorCode === KnowledgeBaseErrorCode.FactEvidenceStale;
    return (
      <p role="alert" className="text-xs text-red-600 dark:text-red-300">
        {i18nService.t(
          stale
            ? 'enterpriseAiKnowledgeMutationStale'
            : 'enterpriseAiKnowledgeMutationFailed',
        )}
      </p>
    );
  }
  return (
    <p role="status" aria-live="polite" className="text-xs text-secondary">
      {i18nService.t(
        feedback.status === WorkspaceAiKnowledgeMutationFeedbackStatus.Submitting
          ? 'enterpriseAiKnowledgeMutationSubmitting'
          : 'enterpriseAiKnowledgeMutationSucceeded',
      )}
    </p>
  );
};

export const subscribeWorkspaceAiKnowledgeMetrics = (
  subscribe: (
    listener: (metrics: KnowledgeFactMetrics) => void,
  ) => () => void,
  callbackRef: { current?: (metrics: KnowledgeFactMetrics) => void },
): (() => void) => subscribe(metrics => callbackRef.current?.(metrics));

export const useWorkspaceAiKnowledgeMetricsSubscription = (
  subscribe: (
    listener: (metrics: KnowledgeFactMetrics) => void,
  ) => () => void,
  onMetricsChange?: (metrics: KnowledgeFactMetrics) => void,
): void => {
  const metricsCallbackRef = useRef(onMetricsChange);

  useLayoutEffect(() => {
    metricsCallbackRef.current = onMetricsChange;
  }, [onMetricsChange]);

  useLayoutEffect(
    () => subscribeWorkspaceAiKnowledgeMetrics(subscribe, metricsCallbackRef),
    [subscribe],
  );
};

export const WorkspaceAiKnowledgePanelView = (
  props: WorkspaceAiKnowledgePanelViewProps,
): React.ReactElement => {
  const panelInstanceId = useId();
  const drawerId = `${panelInstanceId}-evidence-drawer`;
  const [evidenceReturnFocusElement, setEvidenceReturnFocusElement] =
    useState<HTMLElement | null>(null);
  const [expandedContentKeys, setExpandedContentKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const projectionDialog = props.projectionDialog;
  const onToggleEvidence = props.onToggleEvidence;
  const focusAnchorRef = props.focusAnchorRef;
  const toggleContent = (contentKey: string): void => {
    setExpandedContentKeys(currentKeys => {
      const nextKeys = new Set(currentKeys);
      if (nextKeys.has(contentKey)) {
        nextKeys.delete(contentKey);
      } else {
        nextKeys.add(contentKey);
      }
      return nextKeys;
    });
  };
  const drawerFact = props.rows.find(
    (row): row is Extract<WorkspaceAiKnowledgeRow, { kind: 'normalized_fact' }> =>
      row.kind === 'normalized_fact' &&
      row.fact.id === props.evidence.expandedFactId &&
      row.fact.revision === props.evidence.factRevision,
  )?.fact ?? null;
  const visibleDrawerFact = projectionDialog ? null : drawerFact;
  const modalPriorityCollapseKeyRef = useRef<string | null>(null);
  const modalPriorityFocusKeyRef = useRef<string | null>(null);
  const modalPriorityCollapseKey = projectionDialog && drawerFact
    ? JSON.stringify([
        projectionDialog.workspaceGeneration,
        projectionDialog.dialogGeneration,
        drawerFact.id,
        drawerFact.revision,
      ])
    : null;

  useLayoutEffect(() => {
    if (!projectionDialog) {
      modalPriorityFocusKeyRef.current = null;
      return;
    }
    if (
      !modalPriorityCollapseKey ||
      modalPriorityFocusKeyRef.current === modalPriorityCollapseKey
    ) {
      return;
    }
    modalPriorityFocusKeyRef.current = modalPriorityCollapseKey;
    focusAnchorRef?.current?.focus();
  }, [focusAnchorRef, modalPriorityCollapseKey, projectionDialog]);

  useEffect(() => {
    if (!projectionDialog) {
      modalPriorityCollapseKeyRef.current = null;
      return;
    }
    if (!modalPriorityCollapseKey || !drawerFact) {
      return;
    }
    if (modalPriorityCollapseKeyRef.current === modalPriorityCollapseKey) {
      return;
    }
    modalPriorityCollapseKeyRef.current = modalPriorityCollapseKey;
    onToggleEvidence(drawerFact);
  }, [
    drawerFact,
    modalPriorityCollapseKey,
    onToggleEvidence,
    projectionDialog,
  ]);

  const isBackgroundInert =
    visibleDrawerFact !== null || projectionDialog !== null;
  const table = props.rows.length > 0 ? (
    <div
      data-ai-knowledge-table-scroll
      className="overflow-x-auto rounded-xl border border-border"
    >
      <table className="w-full min-w-[1040px] table-fixed border-collapse text-left text-sm">
        <caption className="sr-only">
          {i18nService.t('enterpriseAiKnowledgeTableCaption')}
        </caption>
        <colgroup>
          <col className="w-[150px]" />
          <col className="w-[300px]" />
          <col className="w-[120px]" />
          <col className="w-[120px]" />
          <col className="w-[190px]" />
          <col className="w-[260px]" />
        </colgroup>
        <thead className="bg-surface-raised text-xs font-medium text-secondary">
          <tr>
            <th scope="col" className="px-4 py-3">
              {i18nService.t('enterpriseAiKnowledgeColumnDomain')}
            </th>
            <th scope="col" className="px-4 py-3">
              {i18nService.t('enterpriseAiKnowledgeColumnValue')}
            </th>
            <th scope="col" className="px-4 py-3">
              {i18nService.t('enterpriseAiKnowledgeColumnStatus')}
            </th>
            <th scope="col" className="px-4 py-3">
              {i18nService.t('enterpriseAiKnowledgeColumnSource')}
            </th>
            <th scope="col" className="px-4 py-3">
              {i18nService.t('enterpriseAiKnowledgeColumnEvidence')}
            </th>
            <th scope="col" className="px-4 py-3">
              {i18nService.t('enterpriseAiKnowledgeColumnActions')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {props.rows.map((row, rowIndex) =>
            row.kind === 'normalized_fact' ? (() => {
            const contentKey = `normalized:${row.fact.id}:${row.fact.revision}`;
            const contentId = `${panelInstanceId}-content-${rowIndex}`;
            const isContentExpanded = expandedContentKeys.has(contentKey);
            const mutation = props.mutations[row.fact.id];
            const feedback = props.mutationFeedback[row.fact.id];
            const isMutating = Boolean(mutation);
            const isExpanded =
              props.evidence.expandedFactId === row.fact.id &&
              props.evidence.factRevision === row.fact.revision;
            const isPending =
              row.fact.reviewStatus === KnowledgeFactReviewStatus.Pending &&
              row.fact.archivedAt === null;
            const isConfirmed =
              row.fact.reviewStatus === KnowledgeFactReviewStatus.Confirmed &&
              row.fact.archivedAt === null;
            return (
              <tr
                key={row.fact.id}
                data-normalized-fact-id={row.fact.id}
                className="align-top transition-colors hover:bg-surface-raised/50"
              >
                <td className="px-4 py-3">
                  <span className="inline-flex rounded-full bg-surface-raised px-2.5 py-1 text-xs font-medium text-secondary">
                    {i18nService.t(domainKeys[row.fact.domain])}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-1.5">
                    <p
                      id={contentId}
                      className={`${isContentExpanded ? '' : 'line-clamp-3 '}break-words text-foreground`}
                    >
                      {row.fact.value}
                    </p>
                    <button
                      type="button"
                      data-knowledge-content-toggle
                      aria-expanded={isContentExpanded}
                      aria-controls={contentId}
                      className="rounded text-xs font-medium text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary"
                      onClick={() => toggleContent(contentKey)}
                    >
                      {i18nService.t(
                        isContentExpanded
                          ? 'enterpriseAiKnowledgeContentCollapse'
                          : 'enterpriseAiKnowledgeContentExpand',
                      )}
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    data-knowledge-status-pill
                    className="inline-flex rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground"
                  >
                    {i18nService.t(getReviewStatusKey(row.fact))}
                  </span>
                </td>
                <td className="px-4 py-3 text-secondary">
                  {i18nService.t(sourceKindKeys[row.fact.sourceKind])}
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary">
                      <span>
                        {i18nService.t('enterpriseAiKnowledgeEvidenceActive')}{' '}
                        {row.fact.activeEvidenceCount}
                      </span>
                      <span>
                        {i18nService.t('enterpriseAiKnowledgeEvidenceStale')}{' '}
                        {row.fact.staleEvidenceCount}
                      </span>
                    </div>
                    <button
                      type="button"
                      data-evidence-trigger
                      aria-expanded={isExpanded}
                      aria-controls={drawerId}
                      className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                      onClick={event => {
                        setEvidenceReturnFocusElement(event.currentTarget);
                        props.onToggleEvidence(row.fact);
                      }}
                    >
                      {i18nService.t('enterpriseAiKnowledgeEvidenceExpand')}
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {isPending ? (
                      <>
                        <button
                          type="button"
                          data-confirm-fact
                          disabled={isMutating || row.fact.activeEvidenceCount <= 0}
                          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() =>
                            props.onReviewFact(
                              row.fact,
                              KnowledgeFactReviewDecision.Confirm,
                            )
                          }
                        >
                          {i18nService.t('enterpriseAiKnowledgeConfirm')}
                        </button>
                        <button
                          type="button"
                          data-reject-fact
                          disabled={isMutating}
                          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() =>
                            props.onReviewFact(
                              row.fact,
                              KnowledgeFactReviewDecision.Reject,
                            )
                          }
                        >
                          {i18nService.t('enterpriseAiKnowledgeReject')}
                        </button>
                      </>
                    ) : null}
                    {isConfirmed ? (
                      <button
                        type="button"
                        data-archive-fact
                        disabled={isMutating}
                        className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => props.onArchiveFact(row.fact)}
                      >
                        {i18nService.t('enterpriseAiKnowledgeArchive')}
                      </button>
                    ) : null}
                  </div>
                  {isPending && row.fact.activeEvidenceCount <= 0 ? (
                    <p className="mt-1 text-xs text-secondary">
                      {i18nService.t(
                        'enterpriseAiKnowledgeConfirmRequiresActiveEvidence',
                      )}
                    </p>
                  ) : null}
                  {isMutating ? (
                    <p className="mt-1 text-xs text-secondary">
                      {i18nService.t('enterpriseAiKnowledgeMutationDisabledReason')}
                    </p>
                  ) : null}
                  {renderMutationFeedback(feedback)}
                </td>
              </tr>
            );
            })() : (() => {
              const contentKey = `legacy:${row.item.id}`;
              const contentId = `${panelInstanceId}-content-${rowIndex}`;
              const isContentExpanded = expandedContentKeys.has(contentKey);
              return (
              <tr
                key={row.item.id}
                data-legacy-profile-id={row.item.id}
                className="align-top transition-colors hover:bg-surface-raised/50"
              >
                <td className="px-4 py-3">
                  <span className="inline-flex rounded-full bg-surface-raised px-2.5 py-1 text-xs font-medium text-secondary">
                    {i18nService.t(domainKeys[row.item.domain])}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-1.5">
                    <p
                      id={contentId}
                      className={`${isContentExpanded ? '' : 'line-clamp-3 '}break-words text-foreground`}
                    >
                      {row.item.value}
                    </p>
                    <button
                      type="button"
                      data-knowledge-content-toggle
                      aria-expanded={isContentExpanded}
                      aria-controls={contentId}
                      className="rounded text-xs font-medium text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary"
                      onClick={() => toggleContent(contentKey)}
                    >
                      {i18nService.t(
                        isContentExpanded
                          ? 'enterpriseAiKnowledgeContentCollapse'
                          : 'enterpriseAiKnowledgeContentExpand',
                      )}
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    data-knowledge-status-pill
                    className="inline-flex rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground"
                  >
                    {i18nService.t('enterpriseAiKnowledgeStatusConfirmed')}{' '}
                    {i18nService.t('enterpriseAiKnowledgeLegacyReadOnly')}
                  </span>
                </td>
                <td className="px-4 py-3 text-secondary">
                  {i18nService.t('enterpriseAiKnowledgeLegacySource')}
                </td>
                <td className="px-4 py-3 text-secondary">
                  {i18nService.t('enterpriseAiKnowledgeLegacyNoEvidence')}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    data-maintain-company
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                    onClick={props.onMaintainCompany}
                  >
                    {i18nService.t('enterpriseAiKnowledgeMaintainCompany')}
                  </button>
                </td>
              </tr>
              );
            })(),
          )}
        </tbody>
      </table>
    </div>
  ) : null;

  return (
    <section
      data-ai-knowledge-panel-viewport
      className="relative flex h-full min-h-0 max-h-[calc(100vh-8rem)] flex-col overflow-hidden"
    >
      <div
        ref={focusAnchorRef}
        tabIndex={-1}
        aria-label={i18nService.t('enterpriseAiKnowledgePanelFocusAnchor')}
        className="sr-only"
      />
      <div
        data-ai-knowledge-panel-background
        data-ai-knowledge-panel-scroll
        aria-hidden={isBackgroundInert ? true : undefined}
        {...(isBackgroundInert ? { inert: '' } : {})}
        className={`min-h-0 flex-1 space-y-4 overflow-y-auto ${isBackgroundInert ? 'pointer-events-none' : ''}`}
      >
      <WorkspaceAiKnowledgeFilters
        filters={props.filters}
        onViewChange={props.onViewChange}
        onReviewStatusesChange={props.onReviewStatusesChange}
        onEvidenceStateChange={props.onEvidenceStateChange}
      />
      {props.isInitialLoading ? (
        <p
          role="status"
          aria-live="polite"
          aria-label={i18nService.t('enterpriseAiKnowledgeLoadingStatus')}
        >
          {i18nService.t('enterpriseAiKnowledgeLoading')}
        </p>
      ) : null}
      {props.errorCode ? (
        <div role="alert" className="space-y-2">
          <p>{i18nService.t('enterpriseAiKnowledgeLoadFailed')}</p>
          <button
            type="button"
            data-retry-initial
            aria-label={i18nService.t('enterpriseAiKnowledgeRetryInitial')}
            onClick={props.onRetryInitial}
          >
            {i18nService.t('enterpriseAiKnowledgeRetryInitial')}
          </button>
        </div>
      ) : null}
      {!props.isInitialLoading && !props.errorCode && props.rows.length === 0 ? (
        <p>
          {i18nService.t(
            props.filters.view === KnowledgeFactListView.Active
              ? 'enterpriseAiKnowledgeEmptyActive'
              : 'enterpriseAiKnowledgeEmptyHistory',
          )}
        </p>
      ) : null}
      {table}
      {props.mutationAnnouncement ? (
        <p
          key={props.mutationAnnouncement.generation}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={i18nService.t('enterpriseAiKnowledgeMutationLiveStatus')}
          className="text-sm text-secondary"
        >
          {i18nService.t('enterpriseAiKnowledgeMutationSucceeded')}
        </p>
      ) : null}
      {props.evidenceErrorCode && props.evidence.expandedFactId === null ? (
        <p role="alert">
          {i18nService.t('enterpriseAiKnowledgeEvidenceStateConflict')}
        </p>
      ) : null}
      {props.partialErrorCode ? (
        <div role="alert" className="space-y-2">
          <p>{i18nService.t('enterpriseAiKnowledgePartialLoadFailed')}</p>
          <button
            type="button"
            data-retry-partial
            aria-label={i18nService.t('enterpriseAiKnowledgeRetryPartial')}
            onClick={props.onRetryPartial}
          >
            {i18nService.t('enterpriseAiKnowledgeRetryPartial')}
          </button>
        </div>
      ) : null}
      {props.rows.length > 0 && props.nextCursor ? (
        <button
          type="button"
          data-load-more
          disabled={props.isInitialLoading || props.isLoadingMore}
          aria-label={i18nService.t('enterpriseAiKnowledgeLoadMore')}
          onClick={props.onLoadMore}
        >
          {i18nService.t(
            props.isLoadingMore
              ? 'enterpriseAiKnowledgeLoadingMore'
              : 'enterpriseAiKnowledgeLoadMore',
          )}
        </button>
      ) : null}
      {props.rows.length > 0 && props.nextCursor === null ? (
        <p>{i18nService.t('enterpriseAiKnowledgeEndOfList')}</p>
      ) : null}
      </div>
      <WorkspaceKnowledgeFactEvidenceDrawer
        drawerId={drawerId}
        fact={visibleDrawerFact}
        evidence={props.evidence}
        hasLoadedFirstPage={props.evidenceHasLoadedFirstPage}
        errorCode={visibleDrawerFact ? props.evidenceErrorCode : null}
        returnFocusElement={evidenceReturnFocusElement}
        restoreFocusOnClose={!props.projectionDialog}
        onClose={() => {
          if (visibleDrawerFact) {
            props.onToggleEvidence(visibleDrawerFact);
          }
        }}
        onLoadMore={props.onLoadMoreEvidence}
        onRetry={props.onRetryEvidence}
      />
      <WorkspaceKnowledgeFactDialogs
        dialog={props.projectionDialog}
        onCancel={props.onDismissProjectionConflict}
        onReplace={props.onResolveCompanyReplacement}
        onKeepCurrent={props.onResolveArchiveKeepCurrent}
        onRemoveCurrent={props.onResolveArchiveRemoveCurrent}
        fallbackFocusRef={props.focusAnchorRef}
      />
    </section>
  );
};

export interface WorkspaceAiKnowledgePanelProps {
  workspaceId: string;
  profileRevision: number;
  profile: EnterpriseLeadWorkspaceProfile;
  onMetricsChange?: (metrics: KnowledgeFactMetrics) => void;
  onMaintainCompany: () => void;
  onProjectionRefresh?: WorkspaceAiKnowledgeProjectionRefreshHandler;
}

export const WorkspaceAiKnowledgePanel = ({
  workspaceId,
  profileRevision,
  profile,
  onMetricsChange,
  onMaintainCompany,
  onProjectionRefresh,
}: WorkspaceAiKnowledgePanelProps): React.ReactElement => {
  const focusAnchorRef = useRef<HTMLDivElement>(null);
  const state = useWorkspaceAiKnowledge({
    workspaceId,
    profileRevision,
    profile,
    onProjectionRefresh,
  });
  useWorkspaceAiKnowledgeMetricsSubscription(
    state.subscribeAcceptedMetrics,
    onMetricsChange,
  );

  return (
    <WorkspaceAiKnowledgePanelView
      key={workspaceId}
      rows={state.rows}
      metrics={state.metrics}
      filters={state.filters}
      nextCursor={state.nextCursor}
      isInitialLoading={state.isInitialLoading}
      isLoadingMore={state.isLoadingMore}
      errorCode={state.errorCode}
      partialErrorCode={state.partialErrorCode}
      mutations={state.mutations}
      mutationFeedback={state.mutationFeedback}
      mutationAnnouncement={state.mutationAnnouncement}
      projectionDialog={state.projectionDialog}
      evidence={state.evidence}
      evidenceErrorCode={state.evidenceErrorCode}
      evidenceHasLoadedFirstPage={state.evidenceHasLoadedFirstPage}
      onViewChange={view => {
        void state.setView(view);
      }}
      onReviewStatusesChange={statuses => {
        void state.setReviewStatuses(statuses);
      }}
      onEvidenceStateChange={evidenceState => {
        void state.setEvidenceState(evidenceState);
      }}
      onRetryInitial={() => {
        void state.retryInitial();
      }}
      onRetryPartial={() => {
        void state.retryPartial();
      }}
      onLoadMore={() => {
        void state.loadMore();
      }}
      onMaintainCompany={onMaintainCompany}
      onReviewFact={(fact, decision) => {
        void state.reviewFact(fact, decision);
      }}
      onArchiveFact={fact => {
        void state.archiveFact(fact);
      }}
      onToggleEvidence={fact => {
        if (
          state.evidence.expandedFactId === fact.id &&
          state.evidence.factRevision === fact.revision
        ) {
          state.collapseEvidence();
        } else {
          void state.expandEvidence(fact);
        }
      }}
      onLoadMoreEvidence={() => {
        void state.loadMoreEvidence();
      }}
      onRetryEvidence={() => {
        void state.retryEvidence();
      }}
      onDismissProjectionConflict={state.dismissProjectionConflict}
      onResolveCompanyReplacement={state.resolveCompanyReplacement}
      onResolveArchiveKeepCurrent={state.resolveArchiveKeepCurrent}
      onResolveArchiveRemoveCurrent={state.resolveArchiveRemoveCurrent}
      focusAnchorRef={focusAnchorRef}
    />
  );
};

export default WorkspaceAiKnowledgePanel;
