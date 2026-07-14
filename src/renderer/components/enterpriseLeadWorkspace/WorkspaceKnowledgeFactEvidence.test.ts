import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  KnowledgeBaseErrorCode,
  KnowledgeFactDomain,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeFactEvidenceSummary,
  KnowledgeFactSummary,
} from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import { WorkspaceKnowledgeFactEvidence } from './WorkspaceKnowledgeFactEvidence';

const evidence = (
  id: string,
  overrides: Partial<KnowledgeFactEvidenceSummary> = {},
): KnowledgeFactEvidenceSummary => ({
  id,
  factId: 'private-fact-id',
  documentId: 'private-document-id',
  documentVersionId: 'private-version-id',
  documentDisplayName: `${id}.pdf`,
  quote: `Bounded quote ${id}`,
  confidence: 0.875,
  stale: false,
  createdAt: '2026-07-13T08:30:00.000Z',
  ...overrides,
});

const fact = (overrides: Partial<KnowledgeFactSummary> = {}): KnowledgeFactSummary => ({
  id: 'private-fact-id',
  domain: KnowledgeFactDomain.ProductList,
  value: 'Safe product',
  reviewStatus: KnowledgeFactReviewStatus.Pending,
  sourceKind: KnowledgeFactSourceKind.Extracted,
  revision: 2,
  projectionState: KnowledgeFactProjectionState.None,
  activeEvidenceCount: 1,
  staleEvidenceCount: 1,
  evidencePreview: evidence('preview'),
  createdAt: '2026-07-13T00:00:00.000Z',
  reviewedAt: null,
  updatedAt: '2026-07-13T00:00:00.000Z',
  archivedAt: null,
  ...overrides,
});

const renderEvidence = (
  overrides: Partial<React.ComponentProps<typeof WorkspaceKnowledgeFactEvidence>> = {},
): string =>
  renderToStaticMarkup(
    React.createElement(WorkspaceKnowledgeFactEvidence, {
      fact: fact(),
      evidence: {
        expandedFactId: 'private-fact-id',
        factRevision: 2,
        items: [evidence('active')],
        nextCursor: null,
        isLoading: false,
        requestGeneration: 1,
        activeRequest: null,
      },
      hasLoadedFirstPage: false,
      errorCode: null,
      onLoadMore: vi.fn(),
      onRetry: vi.fn(),
      ...overrides,
    }),
  );

describe('WorkspaceKnowledgeFactEvidence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('renders evidence content without owning disclosure or preview semantics', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const html = renderEvidence();

    expect(html).not.toContain('aria-expanded');
    expect(html).not.toContain('enterpriseAiKnowledgeEvidencePreview');
    expect(html).toContain('enterpriseAiKnowledgeEvidenceConfidence');
    expect(html).toContain('active.pdf');
    expect(html).toContain('Bounded quote active');
    expect(html).toContain('<blockquote');
    expect(html).toContain('enterpriseAiKnowledgeEvidenceActiveState');
    expect(html).toContain('dateTime="2026-07-13T08:30:00.000Z"');
    expect(html).not.toContain('private-fact-id');
    expect(html).not.toContain('private-document-id');
    expect(html).not.toContain('private-version-id');
  });

  test('renders active and stale paged evidence with confidence and bounded safe fields only', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    const html = renderEvidence({
      hasLoadedFirstPage: true,
      evidence: {
        expandedFactId: 'private-fact-id',
        factRevision: 2,
        items: [
          evidence('active'),
          evidence('stale', { stale: true, confidence: 0.5 }),
        ],
        nextCursor: 'private-opaque-cursor',
        isLoading: false,
        requestGeneration: 2,
        activeRequest: null,
      },
    });

    expect(html).not.toContain('aria-expanded');
    expect(html).not.toContain('enterpriseAiKnowledgeEvidencePreview');
    expect(html).toContain('active.pdf');
    expect(html).toContain('stale.pdf');
    expect(html).toContain('enterpriseAiKnowledgeEvidenceActiveState');
    expect(html).toContain('enterpriseAiKnowledgeEvidenceStaleState');
    expect(html).toContain('enterpriseAiKnowledgeEvidenceConfidence');
    expect(html).toContain('88%');
    expect(html).toContain('50%');
    expect(html).toContain('data-evidence-load-more');
    expect(html).not.toContain('private-opaque-cursor');
    expect(html).not.toContain('private-document-id');
    expect(html).not.toContain('private-version-id');
  });

  test('never renders malformed createdAt diagnostics from evidence content', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    const privateCreatedAt =
      '/Users/private/customer.sqlite SELECT secret\nError: stack at worker.ts:19';
    const unsafeEvidence = evidence('unsafe-time', { createdAt: privateCreatedAt });
    const html = renderEvidence({
      hasLoadedFirstPage: true,
      evidence: {
        expandedFactId: 'private-fact-id',
        factRevision: 2,
        items: [unsafeEvidence],
        nextCursor: null,
        isLoading: false,
        requestGeneration: 2,
        activeRequest: null,
      },
    });

    expect(html).toContain('enterpriseAiKnowledgeEvidenceUnknownTime');
    expect(html).not.toContain('dateTime=');
    expect(html).not.toContain('/Users/private');
    expect(html).not.toContain('SELECT secret');
    expect(html).not.toContain('stack at worker');
  });

  test('distinguishes loading, empty, fixed error/retry, pagination, and end states', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    const baseEvidence = {
      expandedFactId: 'private-fact-id',
      factRevision: 2,
      items: [],
      nextCursor: null,
      isLoading: false,
      requestGeneration: 1,
      activeRequest: null,
    };
    const loading = renderEvidence({
      evidence: { ...baseEvidence, isLoading: true },
    });
    const empty = renderEvidence({
      evidence: baseEvidence,
      hasLoadedFirstPage: true,
    });
    const failed = renderEvidence({
      evidence: baseEvidence,
      errorCode: KnowledgeBaseErrorCode.PersistenceFailed,
    });
    const ended = renderEvidence({
      evidence: { ...baseEvidence, items: [evidence('only')] },
      hasLoadedFirstPage: true,
    });

    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-live="polite"');
    expect(loading).toContain('enterpriseAiKnowledgeEvidenceLoading');
    expect(loading).not.toContain('enterpriseAiKnowledgeEvidenceCollapse');
    expect(empty).toContain('enterpriseAiKnowledgeEvidenceEmpty');
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('enterpriseAiKnowledgeEvidenceLoadFailed');
    expect(failed).toContain('data-evidence-retry');
    expect(failed).not.toContain(KnowledgeBaseErrorCode.PersistenceFailed);
    expect(ended).toContain('enterpriseAiKnowledgeEvidenceEnd');
    expect(ended).not.toContain('data-evidence-load-more');
  });
});
