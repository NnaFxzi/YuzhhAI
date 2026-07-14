import React from 'react';

import {
  KNOWLEDGE_FACT_BATCH_REJECT_REASON_MAX_CHARS,
  KnowledgeFactBatchAction,
  type KnowledgeFactBatchAction as KnowledgeFactBatchActionValue,
} from '../../../shared/knowledgeBase/constants';
import { i18nService } from '../../services/i18n';

export interface WorkspaceAiKnowledgeBulkReviewDialogProps {
  action: KnowledgeFactBatchActionValue;
  isOpen: boolean;
  selectedCount: number;
  isSubmitting: boolean;
  reason: string;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
  onReasonChange: (reason: string) => void;
}

const replaceCount = (key: string, count: number): string =>
  i18nService.t(key).replace('{count}', String(count));

const getDialogTitleKey = (action: KnowledgeFactBatchActionValue): string => {
  if (action === KnowledgeFactBatchAction.Reject) {
    return 'enterpriseAiKnowledgeBatchRejectTitle';
  }
  if (action === KnowledgeFactBatchAction.Archive) {
    return 'enterpriseAiKnowledgeBatchArchiveTitle';
  }
  return 'enterpriseAiKnowledgeBatchConfirmTitle';
};

const getDialogDescriptionKey = (action: KnowledgeFactBatchActionValue): string => {
  if (action === KnowledgeFactBatchAction.Reject) {
    return 'enterpriseAiKnowledgeBatchRejectDescription';
  }
  if (action === KnowledgeFactBatchAction.Archive) {
    return 'enterpriseAiKnowledgeBatchArchiveDescription';
  }
  return 'enterpriseAiKnowledgeBatchConfirmDescription';
};

const getSubmitLabelKey = (action: KnowledgeFactBatchActionValue): string => {
  if (action === KnowledgeFactBatchAction.Reject) {
    return 'enterpriseAiKnowledgeBatchSubmitReject';
  }
  if (action === KnowledgeFactBatchAction.Archive) {
    return 'enterpriseAiKnowledgeBatchSubmitArchive';
  }
  return 'enterpriseAiKnowledgeBatchSubmitConfirm';
};

export const WorkspaceAiKnowledgeBulkReviewDialog = ({
  action,
  isOpen,
  selectedCount,
  isSubmitting,
  reason,
  onCancel,
  onConfirm,
  onReasonChange,
}: WorkspaceAiKnowledgeBulkReviewDialogProps): React.ReactElement | null => {
  const dialogRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!isOpen || !dialogRef.current) {
      return;
    }
    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current.focus();
    return () => {
      if (previousActiveElement?.isConnected) {
        previousActiveElement.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const titleId = `enterprise-ai-knowledge-batch-dialog-title-${action}`;
  const descriptionId = `enterprise-ai-knowledge-batch-dialog-description-${action}`;
  const statusId = `enterprise-ai-knowledge-batch-dialog-status-${action}`;
  const validationId = `enterprise-ai-knowledge-batch-dialog-validation-${action}`;
  const trimmedReason = reason.trim();
  const reasonRequired = action === KnowledgeFactBatchAction.Reject;
  const reasonTooLong = reason.length > KNOWLEDGE_FACT_BATCH_REJECT_REASON_MAX_CHARS;
  const canSubmit =
    !isSubmitting
    && selectedCount > 0
    && !reasonTooLong
    && (!reasonRequired || trimmedReason.length > 0);
  const validationMessage = reasonRequired
    ? (reasonTooLong
        ? i18nService.t('enterpriseAiKnowledgeBatchRejectReasonTooLong')
          .replace('{max}', String(KNOWLEDGE_FACT_BATCH_REJECT_REASON_MAX_CHARS))
        : trimmedReason.length === 0
          ? i18nService.t('enterpriseAiKnowledgeBatchRejectReasonRequired')
          : null)
    : null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') {
      return;
    }
    if (isSubmitting) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    onCancel();
  };

  const handleSubmit = (): void => {
    if (!canSubmit) {
      return;
    }
    void onConfirm();
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 px-4 py-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={reasonRequired ? `${descriptionId} ${validationId}` : descriptionId}
        tabIndex={-1}
        className="w-full max-w-lg rounded-xl border border-border bg-background p-5 shadow-2xl"
        onKeyDown={handleKeyDown}
      >
        <h3 id={titleId} className="text-base font-semibold text-foreground">
          {replaceCount(getDialogTitleKey(action), selectedCount)}
        </h3>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-secondary">
          {replaceCount(getDialogDescriptionKey(action), selectedCount)}
        </p>

        {reasonRequired ? (
          <label className="mt-4 flex flex-col gap-2 text-sm font-medium text-foreground">
            <span>{i18nService.t('enterpriseAiKnowledgeBatchRejectReasonLabel')}</span>
            <textarea
              value={reason}
              required
              aria-required="true"
              aria-invalid={reasonTooLong}
              aria-describedby={validationId}
              disabled={isSubmitting}
              rows={4}
              className="min-h-28 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
              placeholder={i18nService.t('enterpriseAiKnowledgeBatchRejectReasonPlaceholder')}
              onChange={event => onReasonChange(event.currentTarget.value)}
            />
          </label>
        ) : null}

        <p id={validationId} className="mt-2 text-sm text-secondary">
          {validationMessage}
        </p>

        <div
          id={statusId}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={i18nService.t('enterpriseAiKnowledgeBatchLiveStatus')}
          className="mt-4 text-sm text-secondary"
        >
          {isSubmitting ? i18nService.t('enterpriseAiKnowledgeBatchSubmitting') : null}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            data-bulk-review-cancel
            disabled={isSubmitting}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onCancel}
          >
            {i18nService.t('enterpriseAiKnowledgeDialogCancel')}
          </button>
          <button
            type="button"
            data-bulk-review-confirm
            disabled={!canSubmit}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleSubmit}
          >
            {replaceCount(getSubmitLabelKey(action), selectedCount)}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkspaceAiKnowledgeBulkReviewDialog;
