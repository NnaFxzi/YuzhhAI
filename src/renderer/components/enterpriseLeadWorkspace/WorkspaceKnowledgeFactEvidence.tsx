import React from 'react';

import type { KnowledgeBaseErrorCode } from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeFactEvidenceSummary,
  KnowledgeFactSummary,
} from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import type { WorkspaceAiKnowledgeEvidenceState } from './workspaceAiKnowledgeState';

export interface WorkspaceKnowledgeFactEvidenceProps {
  fact: KnowledgeFactSummary;
  evidence: WorkspaceAiKnowledgeEvidenceState;
  hasLoadedFirstPage: boolean;
  errorCode: KnowledgeBaseErrorCode | null;
  onLoadMore: () => void;
  onRetry: () => void;
}

const locale = (): string =>
  i18nService.getLanguage() === 'zh' ? 'zh-CN' : 'en-US';

const formatConfidence = (confidence: number): string =>
  new Intl.NumberFormat(locale(), {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(Math.min(1, Math.max(0, confidence)));

const SAFE_EVIDENCE_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const normalizeCreatedAt = (createdAt: string): string | null => {
  if (
    createdAt.length > 64 ||
    !SAFE_EVIDENCE_TIMESTAMP_PATTERN.test(createdAt)
  ) {
    return null;
  }
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
};

const formatCreatedAt = (normalizedCreatedAt: string | null): string => {
  if (normalizedCreatedAt === null) {
    return i18nService.t('enterpriseAiKnowledgeEvidenceUnknownTime');
  }
  return new Intl.DateTimeFormat(locale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(Date.parse(normalizedCreatedAt));
};

const EvidenceItem = ({
  item,
}: {
  item: KnowledgeFactEvidenceSummary;
}): React.ReactElement => {
  const normalizedCreatedAt = normalizeCreatedAt(item.createdAt);
  return (
    <article className="space-y-2 rounded-lg border border-border p-3">
      <p className="break-words text-sm font-medium">{item.documentDisplayName}</p>
      <blockquote className="break-words border-l-2 border-border pl-3 text-sm text-secondary">
        {item.quote}
      </blockquote>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
        <div className="flex gap-1">
          <dt>{i18nService.t('enterpriseAiKnowledgeEvidenceConfidence')}</dt>
          <dd>{formatConfidence(item.confidence)}</dd>
        </div>
        <div>
          {i18nService.t(
            item.stale
              ? 'enterpriseAiKnowledgeEvidenceStaleState'
              : 'enterpriseAiKnowledgeEvidenceActiveState',
          )}
        </div>
        <div>
          <time {...(normalizedCreatedAt ? { dateTime: normalizedCreatedAt } : {})}>
            {formatCreatedAt(normalizedCreatedAt)}
          </time>
        </div>
      </dl>
    </article>
  );
};

export const WorkspaceKnowledgeFactEvidence = ({
  fact,
  evidence,
  hasLoadedFirstPage,
  errorCode,
  onLoadMore,
  onRetry,
}: WorkspaceKnowledgeFactEvidenceProps): React.ReactElement => {
  const currentEvidence =
    evidence.expandedFactId === fact.id &&
    evidence.factRevision === fact.revision
      ? evidence
      : null;

  return (
    <div className="space-y-3">
      {currentEvidence?.items.map(item => (
        <EvidenceItem key={item.id} item={item} />
      ))}
      {currentEvidence?.isLoading ? (
        <p
          role="status"
          aria-live="polite"
          aria-label={i18nService.t('enterpriseAiKnowledgeEvidenceLoadingStatus')}
        >
          {i18nService.t('enterpriseAiKnowledgeEvidenceLoading')}
        </p>
      ) : null}
      {errorCode ? (
        <div role="alert" className="space-y-2">
          <p>{i18nService.t('enterpriseAiKnowledgeEvidenceLoadFailed')}</p>
          <button type="button" data-evidence-retry onClick={onRetry}>
            {i18nService.t('enterpriseAiKnowledgeEvidenceRetry')}
          </button>
        </div>
      ) : null}
      {hasLoadedFirstPage &&
      !currentEvidence?.isLoading &&
      !errorCode &&
      currentEvidence?.items.length === 0 ? (
        <p>{i18nService.t('enterpriseAiKnowledgeEvidenceEmpty')}</p>
      ) : null}
      {currentEvidence?.nextCursor && !errorCode ? (
        <button
          type="button"
          data-evidence-load-more
          disabled={currentEvidence.isLoading}
          onClick={onLoadMore}
        >
          {i18nService.t(
            currentEvidence.isLoading
              ? 'enterpriseAiKnowledgeEvidenceLoadingMore'
              : 'enterpriseAiKnowledgeEvidenceLoadMore',
          )}
        </button>
      ) : null}
      {hasLoadedFirstPage &&
      !currentEvidence?.isLoading &&
      !errorCode &&
      currentEvidence?.items.length !== 0 &&
      currentEvidence?.nextCursor === null ? (
        <p>{i18nService.t('enterpriseAiKnowledgeEvidenceEnd')}</p>
      ) : null}
    </div>
  );
};

export default WorkspaceKnowledgeFactEvidence;
