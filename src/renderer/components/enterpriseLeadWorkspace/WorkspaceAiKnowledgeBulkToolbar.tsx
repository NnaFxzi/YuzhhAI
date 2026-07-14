import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  KnowledgeFactBatchAction,
  type KnowledgeFactBatchAction as KnowledgeFactBatchActionValue,
  KnowledgeFactBatchSkipReason,
  KnowledgeFactBatchTaskStatus,
} from '../../../shared/knowledgeBase/constants';
import type { KnowledgeFactBatchReviewTask } from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import {
  type WorkspaceAiKnowledgeBatchReviewViewModel,
} from './useWorkspaceAiKnowledgeBatchReview';
import {
  WorkspaceAiKnowledgeBulkReviewDialog,
} from './WorkspaceAiKnowledgeBulkReviewDialog';

const DETAIL_SAMPLE_LIMIT = 5;

const replaceCount = (key: string, count: number): string =>
  i18nService.t(key).replace('{count}', String(count));

const replaceProgress = (
  key: string,
  processedCount: number,
  totalCount: number,
): string =>
  i18nService.t(key)
    .replace('{processed}', String(processedCount))
    .replace('{total}', String(totalCount));

const isTaskActive = (task: KnowledgeFactBatchReviewTask | null): boolean =>
  task?.status === KnowledgeFactBatchTaskStatus.Queued
  || task?.status === KnowledgeFactBatchTaskStatus.Running;

const getDetailLabel = (code: string): string => {
  if (code === KnowledgeFactBatchSkipReason.NoActiveEvidence) {
    return i18nService.t('enterpriseAiKnowledgeBatchDetailNoActiveEvidence');
  }
  if (code === KnowledgeFactBatchSkipReason.RevisionConflict) {
    return i18nService.t('enterpriseAiKnowledgeBatchDetailRevisionConflict');
  }
  if (code === KnowledgeFactBatchSkipReason.ProjectionConflict) {
    return i18nService.t('enterpriseAiKnowledgeBatchDetailProjectionConflict');
  }
  if (code === KnowledgeFactBatchSkipReason.AlreadyProcessed) {
    return i18nService.t('enterpriseAiKnowledgeBatchDetailAlreadyProcessed');
  }
  if (code === KnowledgeFactBatchSkipReason.NotFound) {
    return i18nService.t('enterpriseAiKnowledgeBatchDetailNotFound');
  }
  return i18nService.t('enterpriseAiKnowledgeBatchDetailUnknownError');
};

const getActionLabel = (
  action: KnowledgeFactBatchActionValue,
  selectedCount: number,
  selectionMode: 'page' | 'matching' | null,
): string => {
  if (selectionMode === 'matching') {
    if (action === KnowledgeFactBatchAction.Reject) {
      return i18nService.t('enterpriseAiKnowledgeBatchRejectMatchingAction');
    }
    if (action === KnowledgeFactBatchAction.Archive) {
      return i18nService.t('enterpriseAiKnowledgeBatchArchiveMatchingAction');
    }
    return i18nService.t('enterpriseAiKnowledgeBatchConfirmMatchingAction');
  }
  if (action === KnowledgeFactBatchAction.Reject) {
    return replaceCount('enterpriseAiKnowledgeBatchRejectAction', selectedCount);
  }
  if (action === KnowledgeFactBatchAction.Archive) {
    return replaceCount('enterpriseAiKnowledgeBatchArchiveAction', selectedCount);
  }
  return replaceCount('enterpriseAiKnowledgeBatchConfirmAction', selectedCount);
};

export interface WorkspaceAiKnowledgeBulkToolbarProps {
  viewModel: WorkspaceAiKnowledgeBatchReviewViewModel;
  showArchiveAction?: boolean;
}

export const WorkspaceAiKnowledgeBulkToolbar = ({
  viewModel,
  showArchiveAction = false,
}: WorkspaceAiKnowledgeBulkToolbarProps): React.ReactElement | null => {
  const [dialogAction, setDialogAction] = useState<KnowledgeFactBatchActionValue | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const visibleCheckboxRef = useRef<HTMLInputElement>(null);
  const task = viewModel.task;
  const taskIsActive = isTaskActive(task);
  const shouldRender = viewModel.selectedCount > 0 || task !== null;

  useEffect(() => {
    if (!visibleCheckboxRef.current) {
      return;
    }
    visibleCheckboxRef.current.indeterminate =
      viewModel.someVisibleSelected && !viewModel.allVisibleSelected;
  }, [viewModel.allVisibleSelected, viewModel.someVisibleSelected]);

  const disableSelectionActions = viewModel.isStarting || taskIsActive;
  const detailSamples = useMemo(
    () => task?.details.slice(0, DETAIL_SAMPLE_LIMIT) ?? [],
    [task],
  );
  const retryableDetailCount = useMemo(
    () => task?.details.filter(detail => detail.retryable).length ?? 0,
    [task],
  );
  const retryableCount = task
    ? Math.max(task.retryableCount, retryableDetailCount)
    : 0;
  const disableTerminalActions = viewModel.isStarting;
  const isMatchingSelection = viewModel.selectionMode === 'matching';

  if (!shouldRender) {
    return null;
  }

  const openDialog = (action: KnowledgeFactBatchActionValue): void => {
    if (disableSelectionActions || viewModel.selectedCount === 0) {
      return;
    }
    setDialogAction(action);
  };

  const closeDialog = (): void => {
    if (viewModel.isStarting) {
      return;
    }
    setDialogAction(null);
    setRejectReason('');
  };

  const submitDialog = async (): Promise<void> => {
    if (!dialogAction) {
      return;
    }
    const nextReason =
      dialogAction === KnowledgeFactBatchAction.Reject ? rejectReason.trim() : undefined;
    await viewModel.start(dialogAction, nextReason);
    closeDialog();
  };

  const handleRetryFailed = (): void => {
    if (disableTerminalActions) {
      return;
    }
    void viewModel.retryFailed();
  };

  const handleDismissTask = (): void => {
    if (disableTerminalActions) {
      return;
    }
    viewModel.dismissTask();
  };

  const progressPercent =
    task && task.totalCount > 0
      ? Math.max(0, Math.min(100, Math.round((task.processedCount / task.totalCount) * 100)))
      : 0;
  const activeStatusKey =
    task?.status === KnowledgeFactBatchTaskStatus.Queued
      ? 'enterpriseAiKnowledgeBatchQueuedStatus'
      : 'enterpriseAiKnowledgeBatchRunningStatus';
  const resultTitleKey =
    task?.status === KnowledgeFactBatchTaskStatus.Failed
      ? 'enterpriseAiKnowledgeBatchFailedTitle'
      : 'enterpriseAiKnowledgeBatchCompletedTitle';

  return (
    <>
      <section
        data-ai-knowledge-bulk-toolbar
        className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/80 p-3 dark:border-sky-400/30 dark:bg-sky-400/10"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <input
                ref={visibleCheckboxRef}
                type="checkbox"
                aria-label={i18nService.t('enterpriseAiKnowledgeBatchToggleVisibleLabel')}
                aria-checked={
                  viewModel.someVisibleSelected && !viewModel.allVisibleSelected
                    ? 'mixed'
                    : viewModel.allVisibleSelected
                }
                checked={viewModel.allVisibleSelected}
                disabled={disableSelectionActions || viewModel.visibleSelectableCount === 0}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                onChange={() => viewModel.toggleVisible()}
              />
              <span>
                {isMatchingSelection
                  ? i18nService.t('enterpriseAiKnowledgeBatchMatchingSelectionSummary')
                  : replaceCount('enterpriseAiKnowledgeBatchSelectedCount', viewModel.selectedCount)}
              </span>
            </label>

            {isMatchingSelection ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-secondary">
                <span>{i18nService.t('enterpriseAiKnowledgeBatchMatchingSelectionHint')}</span>
              </div>
            ) : viewModel.canExpandToMatching ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-secondary">
                <span>{i18nService.t('enterpriseAiKnowledgeBatchSelectAllMatchingPrompt')}</span>
                <button
                  type="button"
                  data-bulk-review-select-matching
                  disabled={disableSelectionActions}
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={viewModel.selectMatching}
                >
                  {i18nService.t('enterpriseAiKnowledgeBatchSelectAllMatchingAction')}
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-bulk-review-trigger="confirm"
              disabled={disableSelectionActions || viewModel.selectedCount === 0}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => openDialog(KnowledgeFactBatchAction.Confirm)}
            >
              {getActionLabel(
                KnowledgeFactBatchAction.Confirm,
                viewModel.selectedCount,
                viewModel.selectionMode,
              )}
            </button>
            <button
              type="button"
              data-bulk-review-trigger="reject"
              disabled={disableSelectionActions || viewModel.selectedCount === 0}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => openDialog(KnowledgeFactBatchAction.Reject)}
            >
              {getActionLabel(
                KnowledgeFactBatchAction.Reject,
                viewModel.selectedCount,
                viewModel.selectionMode,
              )}
            </button>
            {showArchiveAction ? (
              <button
                type="button"
                data-bulk-review-trigger="archive"
                disabled={disableSelectionActions || viewModel.selectedCount === 0}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => openDialog(KnowledgeFactBatchAction.Archive)}
              >
                {getActionLabel(
                  KnowledgeFactBatchAction.Archive,
                  viewModel.selectedCount,
                  viewModel.selectionMode,
                )}
              </button>
            ) : null}
            <button
              type="button"
              data-bulk-review-clear-selection
              disabled={disableSelectionActions || viewModel.selectedCount === 0}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={viewModel.clearSelection}
            >
              {i18nService.t('enterpriseAiKnowledgeBatchClearSelection')}
            </button>
          </div>
        </div>

        {taskIsActive && task ? (
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="space-y-2 rounded-lg border border-border bg-background/80 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium text-foreground">
                {replaceProgress(activeStatusKey, task.processedCount, task.totalCount)}
              </span>
              <span className="text-secondary">
                {task.processedCount} / {task.totalCount}
              </span>
            </div>
            <div
              aria-hidden="true"
              className="h-2 overflow-hidden rounded-full bg-surface-raised"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-secondary">
              <span>{replaceCount('enterpriseAiKnowledgeBatchSuccessCount', task.successCount)}</span>
              <span>{replaceCount('enterpriseAiKnowledgeBatchSkippedCount', task.skippedCount)}</span>
              <span>{replaceCount('enterpriseAiKnowledgeBatchFailedCount', task.failedCount)}</span>
            </div>
          </div>
        ) : null}

        {!taskIsActive && task ? (
          <div className="space-y-3 rounded-lg border border-border bg-background/80 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  {i18nService.t(resultTitleKey)}
                </p>
                <div className="flex flex-wrap gap-3 text-xs text-secondary">
                  <span>{replaceCount('enterpriseAiKnowledgeBatchSuccessCount', task.successCount)}</span>
                  <span>{replaceCount('enterpriseAiKnowledgeBatchSkippedCount', task.skippedCount)}</span>
                  <span>{replaceCount('enterpriseAiKnowledgeBatchFailedCount', task.failedCount)}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {retryableCount > 0 ? (
                  <button
                    type="button"
                    data-bulk-review-retry
                    disabled={disableTerminalActions}
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={handleRetryFailed}
                  >
                    {replaceCount('enterpriseAiKnowledgeBatchRetryFailed', retryableCount)}
                  </button>
                ) : null}
                <button
                  type="button"
                  data-bulk-review-dismiss
                  disabled={disableTerminalActions}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleDismissTask}
                >
                  {i18nService.t('enterpriseAiKnowledgeBatchDismissResult')}
                </button>
              </div>
            </div>

            {detailSamples.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-secondary">
                  {i18nService.t('enterpriseAiKnowledgeBatchDetailHeading')}
                </p>
                <ul className="space-y-2 text-xs text-secondary">
                  {detailSamples.map(detail => (
                    <li
                      key={`${detail.factId}:${detail.code}`}
                      className="rounded-md bg-surface-raised/70 px-3 py-2"
                    >
                      <p className="font-medium text-foreground">
                        {detail.valuePreview || detail.factId}
                      </p>
                      <p className="mt-1">
                        {getDetailLabel(detail.code)}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <WorkspaceAiKnowledgeBulkReviewDialog
        action={dialogAction ?? KnowledgeFactBatchAction.Confirm}
        isOpen={dialogAction !== null}
        selectedCount={viewModel.selectedCount}
        selectionMode={viewModel.selectionMode}
        isSubmitting={viewModel.isStarting}
        reason={rejectReason}
        onCancel={closeDialog}
        onConfirm={submitDialog}
        onReasonChange={setRejectReason}
      />
    </>
  );
};

export default WorkspaceAiKnowledgeBulkToolbar;
