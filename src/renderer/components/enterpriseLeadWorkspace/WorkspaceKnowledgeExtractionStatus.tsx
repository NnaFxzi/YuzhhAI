import { ArrowPathIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import React from 'react';

import { KnowledgeEnrichmentStatus } from '../../../shared/knowledgeBase/constants';
import { i18nService } from '../../services/i18n';
import type { KnowledgeDocumentExtractionPresentation } from './knowledgeDocumentPresentation';

export interface WorkspaceKnowledgeExtractionStatusProps {
  presentation: KnowledgeDocumentExtractionPresentation;
  isMutating: boolean;
  onCancel: () => void;
  onRetry: () => void;
}

export const WorkspaceKnowledgeExtractionStatus = ({
  presentation,
  isMutating,
  onCancel,
  onRetry,
}: WorkspaceKnowledgeExtractionStatusProps): React.ReactElement => {
  const isActive =
    presentation.status === KnowledgeEnrichmentStatus.Queued ||
    presentation.status === KnowledgeEnrichmentStatus.Running;
  const isReviewRequired =
    presentation.status === KnowledgeEnrichmentStatus.ReviewRequired;
  const showsCompletionIcon =
    isReviewRequired || presentation.status === KnowledgeEnrichmentStatus.Completed;
  const activeTitle =
    presentation.status === KnowledgeEnrichmentStatus.Running
      ? i18nService.t('enterpriseKnowledgeAiExtractionRunningTitle')
      : i18nService.t(presentation.statusKey);
  const activeDescription = i18nService.t(
    presentation.status === KnowledgeEnrichmentStatus.Running
      ? 'enterpriseKnowledgeAiExtractionRunningDescription'
      : 'enterpriseKnowledgeAiExtractionQueuedDescription',
  );
  const terminalLabel = isReviewRequired
    ? i18nService
        .t('enterpriseKnowledgeAiExtractionReviewSummary')
        .replace('{pendingFactCount}', String(presentation.pendingFactCount))
    : i18nService.t(presentation.statusKey);
  const terminalContent = (
    <>
      <span className="flex items-center gap-2 text-secondary">
        {showsCompletionIcon ? (
          <CheckCircleIcon aria-hidden="true" className="h-4 w-4 text-emerald-500" />
        ) : null}
        <span>
          {terminalLabel}
          {presentation.errorKey ? (
            <span className="ml-2">{i18nService.t(presentation.errorKey)}</span>
          ) : null}
        </span>
      </span>
      {presentation.canRetry ? (
        <button
          type="button"
          data-extraction-action="retry"
          disabled={isMutating}
          className="h-8 rounded-md border border-primary/20 bg-primary/10 px-2.5 font-semibold text-primary disabled:opacity-45"
          onClick={onRetry}
        >
          {i18nService.t('enterpriseKnowledgeRetryAiExtraction')}
        </button>
      ) : null}
    </>
  );

  return (
    <div
      {...(isActive ? { role: 'status', 'aria-live': 'polite' as const } : {})}
      className={
        isActive
          ? 'rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5'
          : 'flex flex-wrap items-center justify-between gap-3'
      }
    >
      {isActive ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <ArrowPathIcon
                aria-hidden="true"
                className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none"
              />
              <div>
                <p className="text-sm font-medium text-foreground">{activeTitle}</p>
                <p className="text-xs text-secondary">{activeDescription}</p>
              </div>
            </div>
            {presentation.canCancel ? (
              <button
                type="button"
                data-extraction-action="cancel"
                disabled={isMutating}
                className="h-8 rounded-md border border-border px-2.5 font-semibold text-secondary disabled:opacity-45"
                onClick={onCancel}
              >
                {i18nService.t('enterpriseKnowledgeCancelAiExtraction')}
              </button>
            ) : null}
          </div>
          <div
            className="h-1 overflow-hidden rounded-full bg-primary/10"
            aria-hidden="true"
          >
            <div
              data-extraction-indeterminate
              className="h-full w-1/3 animate-shimmer rounded-full bg-primary motion-reduce:animate-none"
            />
          </div>
        </div>
      ) : (
        terminalContent
      )}
    </div>
  );
};
