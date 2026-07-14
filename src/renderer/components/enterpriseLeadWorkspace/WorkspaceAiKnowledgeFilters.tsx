import { CheckIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useId, useRef, useState } from 'react';

import {
  KnowledgeFactEvidenceState,
  type KnowledgeFactEvidenceState as KnowledgeFactEvidenceStateValue,
  KnowledgeFactListView,
  type KnowledgeFactListView as KnowledgeFactListViewValue,
  KnowledgeFactReviewStatus,
  type KnowledgeFactReviewStatus as KnowledgeFactReviewStatusValue,
} from '../../../shared/knowledgeBase/constants';
import { i18nService } from '../../services/i18n';
import type { WorkspaceAiKnowledgeCanonicalFilters } from './useWorkspaceAiKnowledge';

const reviewStatusKeys: Record<KnowledgeFactReviewStatusValue, string> = {
  [KnowledgeFactReviewStatus.Pending]: 'enterpriseAiKnowledgeStatusPending',
  [KnowledgeFactReviewStatus.Confirmed]: 'enterpriseAiKnowledgeStatusConfirmed',
  [KnowledgeFactReviewStatus.Rejected]: 'enterpriseAiKnowledgeStatusRejected',
};

const reviewStatuses = Object.values(KnowledgeFactReviewStatus);

const controlClassName =
  'h-9 w-full min-w-[160px] rounded-lg border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20';

const labelClassName =
  'flex min-w-[160px] flex-1 flex-col gap-1.5 text-xs font-medium text-secondary';

export interface WorkspaceAiKnowledgeFiltersProps {
  filters: WorkspaceAiKnowledgeCanonicalFilters;
  onViewChange: (view: KnowledgeFactListViewValue) => void;
  onReviewStatusesChange: (statuses: KnowledgeFactReviewStatusValue[]) => void;
  onEvidenceStateChange: (state: KnowledgeFactEvidenceStateValue) => void;
}

export const WorkspaceAiKnowledgeFilters = ({
  filters,
  onViewChange,
  onReviewStatusesChange,
  onEvidenceStateChange,
}: WorkspaceAiKnowledgeFiltersProps): React.ReactElement => {
  const [isReviewMenuOpen, setIsReviewMenuOpen] = useState(false);
  const reviewControlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const initialFocusIndexRef = useRef(0);
  const reactId = useId();
  const menuId = `enterprise-ai-knowledge-review-status-${reactId}`;
  const labelId = `enterprise-ai-knowledge-review-label-${reactId}`;
  const summaryId = `enterprise-ai-knowledge-review-summary-${reactId}`;

  useEffect(() => {
    if (!isReviewMenuOpen) {
      return undefined;
    }

    menuItemRefs.current[initialFocusIndexRef.current]?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsReviewMenuOpen(false);
        triggerRef.current?.focus();
        return;
      }

      const items = menuItemRefs.current.filter(
        (item): item is HTMLButtonElement => item !== null,
      );
      const activeIndex = items.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      if (event.key === 'Tab') {
        if (activeIndex >= 0) {
          setIsReviewMenuOpen(false);
        }
        return;
      }
      if (activeIndex < 0) {
        return;
      }
      let nextIndex: number | null = null;
      if (event.key === 'ArrowDown') {
        nextIndex = (activeIndex + 1) % items.length;
      } else if (event.key === 'ArrowUp') {
        nextIndex = (activeIndex - 1 + items.length) % items.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = items.length - 1;
      }
      if (nextIndex === null || items.length === 0) {
        return;
      }
      event.preventDefault();
      items[nextIndex]?.focus();
    };
    const handlePointerDown = (event: PointerEvent): void => {
      if (!reviewControlRef.current?.contains(event.target as Node)) {
        setIsReviewMenuOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isReviewMenuOpen]);

  const selectedStatuses = new Set(filters.reviewStatuses);
  const reviewSummary =
    filters.reviewStatuses.length === 0
      ? i18nService.t('enterpriseAiKnowledgeReviewFilterAll')
      : reviewStatuses
        .filter(status => selectedStatuses.has(status))
        .map(status => i18nService.t(reviewStatusKeys[status]))
        .join(', ');

  const toggleReviewStatus = (status: KnowledgeFactReviewStatusValue): void => {
    const nextStatuses = new Set(filters.reviewStatuses);
    if (nextStatuses.has(status)) {
      nextStatuses.delete(status);
    } else {
      nextStatuses.add(status);
    }
    onReviewStatusesChange(
      reviewStatuses.filter(candidate => nextStatuses.has(candidate)),
    );
  };

  const toggleReviewMenu = (): void => {
    if (!isReviewMenuOpen) {
      const selectedIndex = reviewStatuses.findIndex(status =>
        selectedStatuses.has(status),
      );
      initialFocusIndexRef.current = selectedIndex < 0 ? 0 : selectedIndex;
    }
    setIsReviewMenuOpen(current => !current);
  };

  return (
    <div
      data-ai-knowledge-filters
      className="flex flex-wrap items-end gap-3"
    >
      <label className={labelClassName}>
        <span>{i18nService.t('enterpriseAiKnowledgeViewLabel')}</span>
        <select
          aria-label={i18nService.t('enterpriseAiKnowledgeViewLabel')}
          className={controlClassName}
          value={filters.view}
          onChange={event =>
            onViewChange(event.currentTarget.value as KnowledgeFactListViewValue)
          }
        >
          <option value={KnowledgeFactListView.Active}>
            {i18nService.t('enterpriseAiKnowledgeViewActive')}
          </option>
          <option value={KnowledgeFactListView.History}>
            {i18nService.t('enterpriseAiKnowledgeViewHistory')}
          </option>
        </select>
      </label>

      <div ref={reviewControlRef} className={`${labelClassName} relative`}>
        <span id={labelId}>
          {i18nService.t('enterpriseAiKnowledgeReviewFilterLabel')}
        </span>
        <button
          ref={triggerRef}
          type="button"
          data-review-status-trigger
          aria-labelledby={`${labelId} ${summaryId}`}
          aria-haspopup="menu"
          aria-expanded={isReviewMenuOpen}
          aria-controls={menuId}
          className={`${controlClassName} inline-flex items-center justify-between gap-2 text-left font-normal`}
          onClick={toggleReviewMenu}
        >
          <span id={summaryId} className="truncate">
            {reviewSummary}
          </span>
          <ChevronDownIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
        {isReviewMenuOpen ? (
          <div
            id={menuId}
            role="menu"
            aria-labelledby={labelId}
            className="absolute left-0 top-full z-20 mt-1 min-w-full space-y-1 rounded-lg border border-border bg-surface p-1.5 shadow-lg"
          >
            {reviewStatuses.map((status, index) => (
              <button
                key={status}
                ref={element => {
                  menuItemRefs.current[index] = element;
                }}
                type="button"
                role="menuitemcheckbox"
                aria-checked={selectedStatuses.has(status)}
                tabIndex={-1}
                value={status}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-normal text-foreground hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/20"
                onClick={() => toggleReviewStatus(status)}
              >
                <span
                  aria-hidden="true"
                  className="grid h-4 w-4 shrink-0 place-items-center rounded border border-border bg-background text-primary"
                >
                  {selectedStatuses.has(status) ? (
                    <CheckIcon className="h-3 w-3" />
                  ) : null}
                </span>
                <span>{i18nService.t(reviewStatusKeys[status])}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <label className={labelClassName}>
        <span>{i18nService.t('enterpriseAiKnowledgeEvidenceFilterLabel')}</span>
        <select
          aria-label={i18nService.t('enterpriseAiKnowledgeEvidenceFilterLabel')}
          className={controlClassName}
          value={filters.evidenceState}
          onChange={event =>
            onEvidenceStateChange(
              event.currentTarget.value as KnowledgeFactEvidenceStateValue,
            )
          }
        >
          <option value={KnowledgeFactEvidenceState.Any}>
            {i18nService.t('enterpriseAiKnowledgeEvidenceAny')}
          </option>
          <option value={KnowledgeFactEvidenceState.Active}>
            {i18nService.t('enterpriseAiKnowledgeEvidenceActive')}
          </option>
          <option value={KnowledgeFactEvidenceState.Stale}>
            {i18nService.t('enterpriseAiKnowledgeEvidenceStale')}
          </option>
        </select>
      </label>
    </div>
  );
};

export default WorkspaceAiKnowledgeFilters;
