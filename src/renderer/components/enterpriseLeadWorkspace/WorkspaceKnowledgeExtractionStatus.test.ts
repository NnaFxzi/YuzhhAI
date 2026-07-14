import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  KnowledgeEnrichmentStatus,
  type KnowledgeEnrichmentStatus as KnowledgeEnrichmentStatusValue,
} from '../../../shared/knowledgeBase/constants';
import { i18nService } from '../../services/i18n';
import type { KnowledgeDocumentExtractionPresentation } from './knowledgeDocumentPresentation';
import { WorkspaceKnowledgeExtractionStatus } from './WorkspaceKnowledgeExtractionStatus';

const statusKeys: Record<KnowledgeEnrichmentStatusValue, string> = {
  [KnowledgeEnrichmentStatus.Queued]: 'enterpriseKnowledgeAiExtractionStatusQueued',
  [KnowledgeEnrichmentStatus.Running]: 'enterpriseKnowledgeAiExtractionStatusRunning',
  [KnowledgeEnrichmentStatus.ReviewRequired]:
    'enterpriseKnowledgeAiExtractionStatusReviewRequired',
  [KnowledgeEnrichmentStatus.Completed]: 'enterpriseKnowledgeAiExtractionStatusCompleted',
  [KnowledgeEnrichmentStatus.Failed]: 'enterpriseKnowledgeAiExtractionStatusFailed',
  [KnowledgeEnrichmentStatus.Cancelled]: 'enterpriseKnowledgeAiExtractionStatusCancelled',
  [KnowledgeEnrichmentStatus.Stale]: 'enterpriseKnowledgeAiExtractionStatusStale',
};

const renderStatus = (status: KnowledgeEnrichmentStatusValue): string => {
  const presentation: KnowledgeDocumentExtractionPresentation = {
    status,
    statusKey: statusKeys[status],
    progress: 0,
    pendingFactCount: 3,
    errorKey: null,
    canPrepare: false,
    canRetry: false,
    canCancel:
      status === KnowledgeEnrichmentStatus.Queued ||
      status === KnowledgeEnrichmentStatus.Running,
    showsStalePriorVersion: false,
  };

  return renderToStaticMarkup(
    React.createElement(WorkspaceKnowledgeExtractionStatus, {
      presentation,
      isMutating: false,
      onCancel: vi.fn(),
      onRetry: vi.fn(),
    }),
  );
};

describe('WorkspaceKnowledgeExtractionStatus', () => {
  beforeEach(() => {
    i18nService.setLanguage('zh', { persist: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    i18nService.setLanguage('zh', { persist: false });
  });

  test('renders queued extraction as honest indeterminate progress', () => {
    const html = renderStatus(KnowledgeEnrichmentStatus.Queued);

    expect(html).toContain('data-extraction-indeterminate');
    expect(html).toContain(
      i18nService.t('enterpriseKnowledgeAiExtractionStatusQueued'),
    );
    expect(html).toContain(
      i18nService.t('enterpriseKnowledgeAiExtractionQueuedDescription'),
    );
    expect(html).not.toContain('0%');
    expect(html).not.toContain('data-extraction-status-label');
  });

  test('announces running extraction and respects reduced motion', () => {
    const html = renderStatus(KnowledgeEnrichmentStatus.Running);

    expect(html).toContain('role="status"');
    expect(html).toContain('motion-reduce:animate-none');
    expect(html).toContain(
      i18nService.t('enterpriseKnowledgeAiExtractionRunningTitle'),
    );
    expect(html).toContain(
      i18nService.t('enterpriseKnowledgeAiExtractionRunningDescription'),
    );
    expect(html).not.toContain('data-extraction-status-label');
  });

  test('renders review summary without an active extraction animation', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    expect(renderStatus(KnowledgeEnrichmentStatus.ReviewRequired)).toContain(
      'enterpriseKnowledgeAiExtractionReviewSummary',
    );
    expect(renderStatus(KnowledgeEnrichmentStatus.ReviewRequired)).not.toContain(
      'data-extraction-indeterminate',
    );
  });
});
