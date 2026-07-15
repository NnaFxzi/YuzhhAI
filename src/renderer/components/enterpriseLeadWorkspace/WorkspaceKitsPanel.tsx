import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { EnterpriseLeadWorkspace } from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import { kitService } from '../../services/kit';
import type { InstalledKit, MarketplaceKit } from '../../types/kit';
import KitIcon from '../kits/KitIcon';
import { getWorkspaceDefaultKitIds } from './workspaceKitSelection';

interface WorkspaceKitsPanelProps {
  workspace: EnterpriseLeadWorkspace;
  onWorkspaceUpdated?: (workspace: EnterpriseLeadWorkspace) => void;
  onShowKits?: () => void;
}

export interface WorkspaceKitItem {
  id: string;
  name: string;
  description: string;
  icon?: string;
  installed: boolean;
  selected: boolean;
  isDefault: boolean;
  missing: boolean;
  skillCount: number;
}

export const buildWorkspaceKitItems = (
  workspace: Pick<EnterpriseLeadWorkspace, 'settings'>,
  installedKits: Record<string, InstalledKit>,
  marketplaceKits: MarketplaceKit[],
  selectedKitIds: string[] = getWorkspaceDefaultKitIds(workspace),
  language = i18nService.getLanguage(),
): WorkspaceKitItem[] => {
  const defaultKitIds = getWorkspaceDefaultKitIds(workspace);
  const kitIds = Array.from(new Set([...defaultKitIds, ...Object.keys(installedKits)]));
  const defaultKitIdSet = new Set(defaultKitIds);
  const selectedKitIdSet = new Set(selectedKitIds);
  const resolveKitText = (text: MarketplaceKit['name']): string =>
    typeof text === 'string' ? text : text[language] || text.en || '';

  return kitIds.map(kitId => {
    const installedKit = installedKits[kitId];
    const marketplaceKit = marketplaceKits.find(kit => kit.id === kitId);
    const missing = defaultKitIdSet.has(kitId) && !installedKit;
    const marketplaceSkillCount = marketplaceKit?.skills?.list.length ?? 0;
    const installedSkillCount = installedKit?.skills?.skillIds.length ?? 0;

    return {
      id: kitId,
      name: marketplaceKit ? resolveKitText(marketplaceKit.name) : kitId,
      description: marketplaceKit
        ? resolveKitText(marketplaceKit.description)
        : i18nService.t(
            missing
              ? 'enterpriseLeadWorkspaceKitsMissingDescription'
              : 'enterpriseLeadWorkspaceKitsMetadataUnavailable',
          ),
      icon: marketplaceKit?.icon,
      installed: Boolean(installedKit),
      selected: selectedKitIdSet.has(kitId),
      isDefault: defaultKitIdSet.has(kitId),
      missing,
      skillCount: installedSkillCount || marketplaceSkillCount,
    };
  });
};

export const saveWorkspaceKitSelection = (
  workspaceId: string,
  kitIds: string[],
): Promise<EnterpriseLeadWorkspace | null> =>
  enterpriseLeadWorkspaceService.updateWorkspaceSettings(workspaceId, {
    settings: { kitIds },
  });

interface WorkspaceKitsPanelContentProps {
  items: WorkspaceKitItem[];
  isLoading?: boolean;
  savingKitId: string | null;
  saveError: string;
  onToggle: (kitId: string) => void;
  onShowKits?: () => void;
}

const renderKitSkillCount = (count: number): string =>
  i18nService.t('kitSkillCount').replace('{count}', String(count));

export const WorkspaceKitsPanelContent: React.FC<WorkspaceKitsPanelContentProps> = ({
  items,
  isLoading = false,
  savingKitId,
  saveError,
  onToggle,
  onShowKits,
}) => (
  <div className="h-full min-h-0 overflow-y-auto px-6 py-8">
    <div className="mx-auto w-full max-w-5xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {i18nService.t('enterpriseLeadWorkspaceKitsTitle')}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">
          {i18nService.t('enterpriseLeadWorkspaceKitsDescription')}
        </p>
      </header>

      {saveError && (
        <p
          className="mt-5 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300"
          role="alert"
        >
          {saveError}
        </p>
      )}

      {isLoading ? (
        <div className="py-16 text-center text-sm text-secondary">
          {i18nService.t('kitLoading')}
        </div>
      ) : items.length === 0 ? (
        <section className="mt-8 rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
          <h2 className="text-base font-semibold text-foreground">
            {i18nService.t('enterpriseLeadWorkspaceKitsEmptyTitle')}
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-secondary">
            {i18nService.t('enterpriseLeadWorkspaceKitsEmptyDescription')}
          </p>
          {onShowKits && (
            <button
              type="button"
              onClick={onShowKits}
              className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
            >
              {i18nService.t('enterpriseLeadWorkspaceKitsManageAction')}
            </button>
          )}
        </section>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {items.map(item => {
            const status = (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {item.installed && (
                  <span className="rounded-full bg-surface-raised px-2 py-1 font-medium text-secondary">
                    {i18nService.t('kitInstalled')}
                  </span>
                )}
                {item.selected && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 font-medium text-primary">
                    <CheckCircleIcon className="h-3.5 w-3.5" />
                    {i18nService.t('enterpriseLeadWorkspaceKitsSelected')}
                  </span>
                )}
                {item.isDefault && (
                  <span className="rounded-full bg-primary-muted px-2 py-1 font-medium text-primary">
                    {i18nService.t('enterpriseLeadWorkspaceKitsDefault')}
                  </span>
                )}
                <span className="text-secondary">{renderKitSkillCount(item.skillCount)}</span>
              </div>
            );

            if (item.missing) {
              return (
                <article
                  key={item.id}
                  className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5"
                  data-workspace-kit-id={item.id}
                >
                  <div className="flex items-start gap-4">
                    <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300">
                      <ExclamationTriangleIcon className="h-6 w-6" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-base font-semibold text-foreground">
                        {item.name}
                      </h2>
                      <p className="mt-1 text-sm font-medium text-amber-700 dark:text-amber-300">
                        {i18nService.t('enterpriseLeadWorkspaceKitsMissing')}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-secondary">{item.description}</p>
                      {status}
                      <button
                        type="button"
                        data-workspace-kit-remove={item.id}
                        disabled={savingKitId !== null}
                        onClick={() => onToggle(item.id)}
                        className="mt-4 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-surface-raised disabled:cursor-wait disabled:opacity-70"
                      >
                        {i18nService.t('clearKit')}
                      </button>
                      {onShowKits && (
                        <button
                          type="button"
                          data-workspace-kit-manage="true"
                          onClick={onShowKits}
                          className="ml-2 mt-4 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-surface-raised"
                        >
                          {i18nService.t('enterpriseLeadWorkspaceKitsManageAction')}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            }

            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={item.selected}
                disabled={savingKitId !== null}
                onClick={() => onToggle(item.id)}
                data-workspace-kit-id={item.id}
                className={`rounded-xl border p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-wait disabled:opacity-70 ${
                  item.selected
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border bg-surface hover:border-primary/30 hover:bg-surface-raised'
                }`}
              >
                <div className="flex items-start gap-4">
                  <KitIcon icon={item.icon} className="h-14 w-14" />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-semibold text-foreground">
                      {item.name}
                    </h2>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-secondary">
                      {item.description}
                    </p>
                    {status}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  </div>
);

export const WorkspaceKitsPanel: React.FC<WorkspaceKitsPanelProps> = ({
  workspace,
  onWorkspaceUpdated,
  onShowKits,
}) => {
  const [installedKits, setInstalledKits] = useState<Record<string, InstalledKit>>({});
  const [marketplaceKits, setMarketplaceKits] = useState<MarketplaceKit[]>([]);
  const [selectedKitIds, setSelectedKitIds] = useState<string[]>(
    getWorkspaceDefaultKitIds(workspace),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [savingKitId, setSavingKitId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');
  const currentLanguage = useSyncExternalStore(
    listener => i18nService.subscribe(listener),
    () => i18nService.getLanguage(),
    () => i18nService.getLanguage(),
  );

  useEffect(() => {
    setSelectedKitIds(getWorkspaceDefaultKitIds(workspace));
    setSaveError('');
  }, [workspace]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);

    void Promise.all([
      kitService.fetchMarketplaceKits(),
      kitService.getInstalledKits(),
    ])
      .then(([nextMarketplaceKits, nextInstalledKits]) => {
        if (!active) return;
        setMarketplaceKits(nextMarketplaceKits);
        setInstalledKits(nextInstalledKits);
      })
      .catch(error => {
        console.error('[WorkspaceKitsPanel] Failed to load Kit data:', error);
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const items = useMemo(
    () =>
      buildWorkspaceKitItems(
        workspace,
        installedKits,
        marketplaceKits,
        selectedKitIds,
        currentLanguage,
      ),
    [currentLanguage, installedKits, marketplaceKits, selectedKitIds, workspace],
  );

  const handleToggle = async (kitId: string): Promise<void> => {
    if (savingKitId) return;

    const nextKitIds = selectedKitIds.includes(kitId)
      ? selectedKitIds.filter(id => id !== kitId)
      : [...selectedKitIds, kitId];

    setSavingKitId(kitId);
    setSaveError('');
    try {
      const updatedWorkspace = await saveWorkspaceKitSelection(workspace.id, nextKitIds);
      if (!updatedWorkspace) {
        setSaveError(i18nService.t('enterpriseLeadWorkspaceKitsSaveFailed'));
        return;
      }
      setSelectedKitIds(getWorkspaceDefaultKitIds(updatedWorkspace));
      onWorkspaceUpdated?.(updatedWorkspace);
    } catch {
      setSaveError(i18nService.t('enterpriseLeadWorkspaceKitsSaveFailed'));
    } finally {
      setSavingKitId(null);
    }
  };

  return (
    <WorkspaceKitsPanelContent
      items={items}
      isLoading={isLoading}
      savingKitId={savingKitId}
      saveError={saveError}
      onToggle={kitId => {
        void handleToggle(kitId);
      }}
      onShowKits={onShowKits}
    />
  );
};

export default WorkspaceKitsPanel;
