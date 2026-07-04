import { SparklesIcon } from '@heroicons/react/24/outline';
import React from 'react';

import { i18nService } from '../../services/i18n';
import type { MarketingRewriteAction } from './marketingRewriteActions';

interface MarketingRewriteChipsProps {
  actions: MarketingRewriteAction[];
  onSelect: (action: MarketingRewriteAction) => void;
  pendingActionId?: MarketingRewriteAction['id'] | null;
  disabled?: boolean;
}

const MarketingRewriteChips: React.FC<MarketingRewriteChipsProps> = ({
  actions,
  onSelect,
  pendingActionId = null,
  disabled = false,
}) => {
  if (actions.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1.5 pr-1 font-medium text-muted">
        <SparklesIcon className="h-3.5 w-3.5" aria-hidden="true" />
        {i18nService.t('marketingRewriteTitle')}
      </span>
      {actions.map(action => (
        <button
          key={action.id}
          type="button"
          disabled={disabled}
          aria-busy={pendingActionId === action.id}
          onClick={() => onSelect(action)}
          className="inline-flex h-7 items-center rounded-full border border-border bg-surface-raised px-2.5 text-[12px] font-medium leading-none text-secondary transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-surface-raised disabled:hover:text-secondary"
        >
          {pendingActionId === action.id
            ? i18nService.t('marketingRewriteSubmitting')
            : i18nService.t(action.labelKey)}
        </button>
      ))}
    </div>
  );
};

export default MarketingRewriteChips;
