import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  KnowledgeFactDomain,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
} from '../../../shared/knowledgeBase/constants';
import type { KnowledgeFactSummary } from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import { WorkspaceKnowledgeFactEvidenceDrawer } from './WorkspaceKnowledgeFactEvidenceDrawer';

const fact = (): KnowledgeFactSummary => ({
  id: 'private-fact-id',
  domain: KnowledgeFactDomain.ProductList,
  value: 'Safe product',
  reviewStatus: KnowledgeFactReviewStatus.Pending,
  sourceKind: KnowledgeFactSourceKind.Extracted,
  revision: 2,
  projectionState: KnowledgeFactProjectionState.None,
  activeEvidenceCount: 1,
  staleEvidenceCount: 0,
  evidencePreview: null,
  createdAt: '2026-07-13T00:00:00.000Z',
  reviewedAt: null,
  updatedAt: '2026-07-13T00:00:00.000Z',
  archivedAt: null,
});

const renderDrawer = (
  currentFact: KnowledgeFactSummary | null,
): string =>
  renderToStaticMarkup(
    React.createElement(WorkspaceKnowledgeFactEvidenceDrawer, {
      drawerId: 'test-evidence-drawer',
      fact: currentFact,
      evidence: {
        expandedFactId: currentFact?.id ?? null,
        factRevision: currentFact?.revision ?? null,
        items: [],
        nextCursor: null,
        isLoading: false,
        requestGeneration: 1,
        activeRequest: null,
      },
      hasLoadedFirstPage: true,
      errorCode: null,
      returnFocusElement: null,
      onClose: vi.fn(),
      onLoadMore: vi.fn(),
      onRetry: vi.fn(),
    }),
  );

describe('WorkspaceKnowledgeFactEvidenceDrawer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('renders an accessible panel-local evidence dialog when a fact is open', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const openHtml = renderDrawer(fact());

    expect(openHtml).toContain('role="dialog"');
    expect(openHtml).toContain('aria-modal="true"');
    expect(openHtml).toContain('aria-labelledby=');
    expect(openHtml).toContain('data-evidence-drawer');
    expect(openHtml).toContain('id="test-evidence-drawer"');
    expect(openHtml).toContain('data-evidence-drawer-backdrop');
    expect(openHtml).toContain('enterpriseAiKnowledgeDomainProductList');
    expect(openHtml).toContain('Safe product');
    expect(openHtml).toContain(
      'aria-label="enterpriseAiKnowledgeEvidenceDrawerClose"',
    );
    expect(openHtml).not.toContain('private-fact-id');
  });

  test('renders nothing when no fact owns the drawer', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const closedHtml = renderDrawer(null);

    expect(closedHtml).toBe('');
  });
});
