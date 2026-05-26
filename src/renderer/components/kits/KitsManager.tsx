import { ArrowDownTrayIcon, ArrowLeftIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useState } from 'react';

import { i18nService } from '../../services/i18n';
import { kitService } from '../../services/kit';
import { resolveLocalizedText } from '../../services/skill';
import type { MarketplaceKit } from '../../types/kit';
import SearchIcon from '../icons/SearchIcon';
import SidebarKitsIcon from '../icons/SidebarKitsIcon';

const KitsManager: React.FC = () => {
  const [kits, setKits] = useState<MarketplaceKit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKit, setSelectedKit] = useState<MarketplaceKit | null>(null);

  useEffect(() => {
    setIsLoading(true);
    kitService.fetchMarketplaceKits().then((result) => {
      setKits(result);
      setIsLoading(false);
    });
  }, []);

  const filteredKits = useMemo(() => {
    if (!searchQuery.trim()) return kits;
    const q = searchQuery.toLowerCase();
    return kits.filter((kit) => {
      const name = kit.name.toLowerCase();
      const desc = resolveLocalizedText(kit.description).toLowerCase();
      return name.includes(q) || desc.includes(q);
    });
  }, [kits, searchQuery]);

  // Detail view
  if (selectedKit) {
    return (
      <div className="space-y-6">
        {/* Back button */}
        <button
          type="button"
          onClick={() => setSelectedKit(null)}
          className="inline-flex items-center gap-1.5 text-sm text-secondary hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          {i18nService.t('kitBack')}
        </button>

        {/* Kit header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-surface-raised flex items-center justify-center flex-shrink-0">
              <SidebarKitsIcon className="h-6 w-6 text-secondary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">{selectedKit.name}</h2>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors"
          >
            <ArrowDownTrayIcon className="h-3.5 w-3.5" />
            {i18nService.t('kitInstall')}
          </button>
        </div>

        {/* Description */}
        <p className="text-sm text-secondary leading-relaxed">
          {resolveLocalizedText(selectedKit.description)}
        </p>

        {/* Try asking */}
        {selectedKit.tryAsking && selectedKit.tryAsking.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">
              {i18nService.t('kitTryAsking')}
            </h3>
            <div className="space-y-2">
              {selectedKit.tryAsking.map((prompt, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border bg-surface hover:border-primary/50 transition-colors cursor-pointer"
                >
                  <span className="text-sm text-foreground">{prompt}</span>
                  <ArrowLeftIcon className="h-3.5 w-3.5 text-secondary rotate-180 flex-shrink-0" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Skills list */}
        {selectedKit.skills && selectedKit.skills.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">
              {i18nService.t('kitSkills')} {selectedKit.skills.length}
            </h3>
            <div className="flex flex-wrap gap-2">
              {selectedKit.skills.map((skill) => (
                <span
                  key={skill.id}
                  className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-lg bg-surface-raised text-secondary border border-border"
                >
                  {skill.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={i18nService.t('kitSearchPlaceholder')}
          className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface text-foreground placeholder:text-secondary/60 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-secondary hover:text-foreground transition-colors"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Kit grid */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-secondary">
          {i18nService.t('kitLoading')}
        </div>
      ) : filteredKits.length === 0 ? (
        <div className="text-center py-12 text-sm text-secondary">
          {i18nService.t('kitEmpty')}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filteredKits.map((kit) => (
            <div
              key={kit.id}
              className="rounded-xl border border-border bg-surface p-3 transition-colors hover:border-primary cursor-pointer"
              onClick={() => setSelectedKit(kit)}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-surface-raised flex items-center justify-center flex-shrink-0">
                    <SidebarKitsIcon className="h-4 w-4 text-secondary" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-foreground truncate block">
                      {kit.name}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); }}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors flex-shrink-0"
                >
                  <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                  {kit.downloadCount ? `↓${kit.downloadCount}` : i18nService.t('kitInstall')}
                </button>
              </div>

              <p className="text-xs text-secondary line-clamp-2">
                {resolveLocalizedText(kit.description)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default KitsManager;
