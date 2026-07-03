import { XMarkIcon } from '@heroicons/react/24/outline';
import React, { useEffect } from 'react';

import { i18nService } from '../../services/i18n';
import WorkbenchSidePanel, { type WorkbenchSidePanelProps } from './WorkbenchSidePanel';

interface WorkbenchDrawerProps extends WorkbenchSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const WorkbenchDrawer: React.FC<WorkbenchDrawerProps> = ({
  isOpen,
  onClose,
  ...sidePanelProps
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 transition ${
        isOpen ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      aria-hidden={!isOpen}
    >
      <button
        type="button"
        className={`absolute inset-0 bg-black/35 transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        aria-label={i18nService.t('workbenchCloseBasket')}
        onClick={onClose}
      />
      <aside
        className={`absolute bottom-0 right-0 top-0 flex w-[380px] max-w-[calc(100vw-24px)] flex-col border-l border-border bg-surface shadow-2xl transition-transform duration-200 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle px-4">
          <h2 className="text-sm font-semibold text-foreground">
            {i18nService.t('workbenchBasket')}
          </h2>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
            aria-label={i18nService.t('workbenchCloseBasket')}
            onClick={onClose}
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
        <WorkbenchSidePanel {...sidePanelProps} />
      </aside>
    </div>
  );
};

export default WorkbenchDrawer;
