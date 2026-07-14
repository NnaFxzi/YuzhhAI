import { XMarkIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useId, useLayoutEffect, useRef } from 'react';

import type { KnowledgeBaseErrorCode } from '../../../shared/knowledgeBase/constants';
import {
  KnowledgeFactDomain,
  type KnowledgeFactDomain as KnowledgeFactDomainValue,
} from '../../../shared/knowledgeBase/constants';
import type { KnowledgeFactSummary } from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import type { WorkspaceAiKnowledgeEvidenceState } from './workspaceAiKnowledgeState';
import WorkspaceKnowledgeFactEvidence from './WorkspaceKnowledgeFactEvidence';

const FOCUSABLE_ELEMENT_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

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

export interface WorkspaceKnowledgeFactEvidenceDrawerProps {
  drawerId: string;
  fact: KnowledgeFactSummary | null;
  evidence: WorkspaceAiKnowledgeEvidenceState;
  hasLoadedFirstPage: boolean;
  errorCode: KnowledgeBaseErrorCode | null;
  returnFocusElement: HTMLElement | null;
  restoreFocusOnClose?: boolean;
  onClose: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

export const WorkspaceKnowledgeFactEvidenceDrawer = ({
  drawerId,
  fact,
  evidence,
  hasLoadedFirstPage,
  errorCode,
  returnFocusElement,
  restoreFocusOnClose = true,
  onClose,
  onLoadMore,
  onRetry,
}: WorkspaceKnowledgeFactEvidenceDrawerProps): React.ReactElement | null => {
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const returnFocusElementRef = useRef<HTMLElement | null>(null);
  const restoreFocusOnCloseRef = useRef(restoreFocusOnClose);
  const titleId = useId();
  const isOpen = fact !== null;

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    restoreFocusOnCloseRef.current = restoreFocusOnClose;
    if (isOpen) {
      returnFocusElementRef.current = returnFocusElement;
    }
  }, [isOpen, onClose, restoreFocusOnClose, returnFocusElement]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const drawer = drawerRef.current;
      if (!drawer) {
        return;
      }
      const focusableElements = Array.from(
        drawer.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENT_SELECTOR),
      );
      const firstFocusableElement = focusableElements[0];
      const lastFocusableElement =
        focusableElements[focusableElements.length - 1];
      if (!firstFocusableElement || !lastFocusableElement) {
        event.preventDefault();
        return;
      }
      const activeElement = document.activeElement;
      const focusIsInside =
        activeElement !== null && drawer.contains(activeElement);
      if (
        event.shiftKey &&
        (!focusIsInside || activeElement === firstFocusableElement)
      ) {
        event.preventDefault();
        lastFocusableElement.focus();
        return;
      }
      if (
        !event.shiftKey &&
        (!focusIsInside || activeElement === lastFocusableElement)
      ) {
        event.preventDefault();
        firstFocusableElement.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (!restoreFocusOnCloseRef.current) {
        return;
      }
      const latestReturnFocusElement = returnFocusElementRef.current;
      if (latestReturnFocusElement?.isConnected) {
        latestReturnFocusElement.focus();
      }
    };
  }, [isOpen]);

  if (!fact) {
    return null;
  }

  return (
    <>
      <div
        data-evidence-drawer-backdrop
        aria-hidden="true"
        className="absolute inset-0 z-20 bg-background/70"
      />
      <aside
        ref={drawerRef}
        id={drawerId}
        data-evidence-drawer
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-y-0 right-0 z-30 flex w-[min(420px,calc(100%-1rem))] flex-col border-l border-border bg-background shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-primary">
              {i18nService.t(domainKeys[fact.domain])}
            </p>
            <h3
              id={titleId}
              className="mt-1 line-clamp-2 text-sm font-semibold text-foreground"
            >
              {fact.value}
            </h3>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label={i18nService.t('enterpriseAiKnowledgeEvidenceDrawerClose')}
            className="rounded-md p-1.5 text-secondary hover:bg-surface-raised hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            onClick={onClose}
          >
            <XMarkIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <WorkspaceKnowledgeFactEvidence
            fact={fact}
            evidence={evidence}
            hasLoadedFirstPage={hasLoadedFirstPage}
            errorCode={errorCode}
            onLoadMore={onLoadMore}
            onRetry={onRetry}
          />
        </div>
      </aside>
    </>
  );
};

export default WorkspaceKnowledgeFactEvidenceDrawer;
