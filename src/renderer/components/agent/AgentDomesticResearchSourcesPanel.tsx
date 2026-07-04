import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import {
  createDefaultDomesticResearchCustomSource,
  type DomesticResearchConfig,
  type DomesticResearchCustomSourceConfig,
  DomesticResearchMode,
  type DomesticResearchMode as DomesticResearchModeValue,
  type DomesticResearchSourceId as DomesticResearchSourceIdValue,
  DomesticResearchSourceIds,
  type DomesticResearchSourceStatus,
  type DomesticResearchStatus as DomesticResearchStatusValue,
  type DomesticResearchStatusMap,
  getDomesticResearchSourceStatuses,
} from '@shared/agent/domesticResearch';
import React from 'react';

import { i18nService } from '../../services/i18n';
import {
  applyDomesticResearchBulkAction,
  DomesticResearchBulkAction,
  getDomesticResearchSourceCount,
} from './agentDomesticResearchUi';

interface AgentDomesticResearchSourcesPanelProps {
  value: DomesticResearchConfig;
  statuses?: DomesticResearchStatusMap | null;
  onChange: (value: DomesticResearchConfig) => void;
}

const sourceLabelKeys: Record<DomesticResearchSourceIdValue, string> = {
  xiaohongshu: 'agentDomesticResearchSourceXiaohongshu',
  douyin: 'agentDomesticResearchSourceDouyin',
  kuaishou: 'agentDomesticResearchSourceKuaishou',
  wechat_channels: 'agentDomesticResearchSourceWeChatChannels',
  bilibili: 'agentDomesticResearchSourceBilibili',
  wechat_official_accounts: 'agentDomesticResearchSourceWeChatOfficialAccounts',
};

const statusLabelKeys: Record<DomesticResearchStatusValue, string> = {
  available: 'agentDomesticResearchStatusAvailable',
  link_import_only: 'agentDomesticResearchStatusLinkImportOnly',
  needs_login: 'agentDomesticResearchStatusNeedsLogin',
  limited: 'agentDomesticResearchStatusLimited',
  unsupported: 'agentDomesticResearchStatusUnsupported',
};

const modeLabelKeys: Record<DomesticResearchModeValue, string> = {
  search: 'agentDomesticResearchModeSearch',
  url_import: 'agentDomesticResearchModeUrlImport',
};

const statusTone = (status: DomesticResearchStatusValue): string => {
  if (status === 'available') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'link_import_only') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return 'border-border bg-surface-raised text-secondary';
};

const AgentDomesticResearchSourcesPanel: React.FC<AgentDomesticResearchSourcesPanelProps> = ({
  value,
  statuses,
  onChange,
}) => {
  const resolvedStatuses = statuses ?? getDomesticResearchSourceStatuses(value);
  const customSources = value.customSources ?? [];
  const [expandedLinkImports, setExpandedLinkImports] = React.useState<Set<DomesticResearchSourceIdValue>>(
    () => new Set(),
  );
  const sourceCount = getDomesticResearchSourceCount(value);

  const applyBulkAction = (action: DomesticResearchBulkAction) => {
    onChange(applyDomesticResearchBulkAction(value, action));
  };

  const updateEnabled = (sourceId: DomesticResearchSourceIdValue, enabled: boolean) => {
    onChange({
      ...value,
      sources: {
        ...value.sources,
        [sourceId]: {
          ...value.sources[sourceId],
          enabled,
        },
      },
    });
  };

  const updateSourceUrls = (sourceId: DomesticResearchSourceIdValue, urls: string[]) => {
    onChange({
      ...value,
      sources: {
        ...value.sources,
        [sourceId]: {
          ...value.sources[sourceId],
          urls,
        },
      },
    });
  };

  const toggleLinkImport = (sourceId: DomesticResearchSourceIdValue) => {
    setExpandedLinkImports(previous => {
      const next = new Set(previous);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
  };

  const updateCustomSource = (
    sourceId: string,
    patch: Partial<DomesticResearchCustomSourceConfig>,
  ) => {
    onChange({
      ...value,
      customSources: customSources.map(source => (
        source.id === sourceId
          ? { ...source, ...patch, modes: [DomesticResearchMode.UrlImport] }
          : source
      )),
    });
  };

  const addCustomSource = () => {
    const existingIds = new Set(customSources.map(source => source.id));
    let nextId = `custom-${Date.now().toString(36)}`;
    let suffix = 1;
    while (existingIds.has(nextId)) {
      nextId = `custom-${Date.now().toString(36)}-${suffix}`;
      suffix += 1;
    }
    onChange({
      ...value,
      customSources: [
        ...customSources,
        createDefaultDomesticResearchCustomSource(nextId),
      ],
    });
  };

  const removeCustomSource = (sourceId: string) => {
    onChange({
      ...value,
      customSources: customSources.filter(source => source.id !== sourceId),
    });
  };

  const readUrlsFromText = (text: string): string[] =>
    text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

  const renderSourceModes = (
    sourceId: DomesticResearchSourceIdValue,
    modes: DomesticResearchModeValue[],
    isLinkImportExpanded: boolean,
  ) => (
    <div className="flex flex-wrap gap-1.5">
      {modes.map(mode => {
        if (mode !== DomesticResearchMode.UrlImport) {
          return (
            <span
              key={mode}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-secondary"
            >
              {i18nService.t(modeLabelKeys[mode])}
            </span>
          );
        }
        return (
          <button
            key={mode}
            type="button"
            onClick={() => toggleLinkImport(sourceId)}
            aria-expanded={isLinkImportExpanded}
            aria-controls={`domestic-research-${sourceId}-urls`}
            className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
              isLinkImportExpanded
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-amber-300 bg-amber-50 text-amber-700 hover:border-primary/50 hover:text-primary dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-300'
            }`}
          >
            {i18nService.t(modeLabelKeys[mode])}
          </button>
        );
      })}
    </div>
  );

  const renderStatus = (status: DomesticResearchSourceStatus) => (
    <span className={`rounded-md border px-2 py-1 text-xs ${statusTone(status.status)}`}>
      {i18nService.t(statusLabelKeys[status.status])}
    </span>
  );

  const renderSwitch = (enabled: boolean) => (
    <span
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        enabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </span>
  );

  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {i18nService.t('agentDomesticResearchTitle')}
          </h3>
          <p className="mt-1 text-xs leading-5 text-secondary">
            {i18nService.t('agentDomesticResearchHint')}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <span className="rounded-md border border-border bg-surface-raised px-2.5 py-1 text-xs font-medium text-secondary">
            {i18nService.t('agentDomesticResearchSourceCount')
              .replace('{enabled}', String(sourceCount.enabled))
              .replace('{total}', String(sourceCount.total))}
          </span>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => applyBulkAction(DomesticResearchBulkAction.Recommended)}
              className="h-8 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
            >
              {i18nService.t('agentDomesticResearchBulkRecommended')}
            </button>
            <button
              type="button"
              onClick={() => applyBulkAction(DomesticResearchBulkAction.EnableAll)}
              className="h-8 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
            >
              {i18nService.t('agentDomesticResearchBulkAll')}
            </button>
            <button
              type="button"
              onClick={() => applyBulkAction(DomesticResearchBulkAction.DisableAll)}
              className="h-8 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
            >
              {i18nService.t('agentDomesticResearchBulkNone')}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {DomesticResearchSourceIds.map(sourceId => {
          const source = value.sources[sourceId];
          const status = resolvedStatuses[sourceId];
          const supportsSearch = source.modes.includes(DomesticResearchMode.Search);
          const supportsUrlImport = source.modes.includes(DomesticResearchMode.UrlImport);
          const isLinkImportExpanded = expandedLinkImports.has(sourceId);
          return (
            <div
              key={sourceId}
              className={`rounded-lg border p-3 text-left transition-colors hover:bg-surface-raised/60 ${
                source.enabled
                  ? 'border-primary/60 bg-primary/5'
                  : 'border-border bg-surface'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {i18nService.t(sourceLabelKeys[sourceId])}
                    </span>
                    {renderStatus(status)}
                  </div>
                  <div className="mt-2">
                    {renderSourceModes(sourceId, source.modes, isLinkImportExpanded)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => updateEnabled(sourceId, !source.enabled)}
                  aria-pressed={source.enabled}
                  className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-transparent px-2 text-xs text-secondary transition-colors hover:border-border hover:bg-surface"
                >
                  {i18nService.t('agentDomesticResearchEnabled')}
                  {renderSwitch(source.enabled)}
                </button>
              </div>
              <p className="mt-2 text-xs leading-5 text-secondary">
                {supportsSearch
                  ? i18nService.t('agentDomesticResearchSearchReadyHint')
                  : i18nService.t('agentDomesticResearchLinkImportHint')}
              </p>
              {supportsUrlImport && isLinkImportExpanded ? (
                <div className="mt-3 rounded-md border border-primary/20 bg-surface px-3 py-2">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">
                      {i18nService.t('agentDomesticResearchSourceUrlsTitle')}
                    </span>
                    <span className="text-xs text-secondary">
                      {i18nService.t('agentDomesticResearchSourceUrlsCount')
                        .replace('{count}', String(source.urls.length))}
                    </span>
                  </div>
                  <textarea
                    id={`domestic-research-${sourceId}-urls`}
                    value={source.urls.join('\n')}
                    onChange={event => updateSourceUrls(sourceId, readUrlsFromText(event.target.value))}
                    placeholder={i18nService.t('agentDomesticResearchSourceUrlsPlaceholder')}
                    className="min-h-[76px] w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm leading-5 text-foreground outline-none placeholder:text-secondary/45 focus:border-primary"
                  />
                  <p className="mt-2 text-xs leading-5 text-secondary">
                    {i18nService.t('agentDomesticResearchSourceUrlsHint')}
                  </p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-lg border border-border bg-surface-raised/30 px-3 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-foreground">
              {i18nService.t('agentDomesticResearchCustomTitle')}
            </h4>
            <p className="mt-1 text-xs leading-5 text-secondary">
              {i18nService.t('agentDomesticResearchCustomHint')}
            </p>
          </div>
          <button
            type="button"
            onClick={addCustomSource}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
          >
            <PlusIcon className="h-4 w-4" />
            {i18nService.t('agentDomesticResearchCustomAdd')}
          </button>
        </div>

        {customSources.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-border bg-surface px-3 py-4 text-center text-xs leading-5 text-secondary">
            {i18nService.t('agentDomesticResearchCustomEmpty')}
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {customSources.map(source => (
              <div key={source.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={source.name}
                    onChange={event => updateCustomSource(source.id, { name: event.target.value })}
                    placeholder={i18nService.t('agentDomesticResearchCustomNamePlaceholder')}
                    className="h-9 min-w-[180px] flex-1 rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none placeholder:text-secondary/45 focus:border-primary"
                  />
                  <span className="rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-secondary">
                    {i18nService.t('agentDomesticResearchModeUrlImport')}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateCustomSource(source.id, { enabled: !source.enabled })}
                    aria-pressed={source.enabled}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-2.5 text-xs text-secondary transition-colors hover:bg-surface-raised"
                  >
                    {i18nService.t('agentDomesticResearchEnabled')}
                    {renderSwitch(source.enabled)}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCustomSource(source.id)}
                    aria-label={i18nService.t('agentDomesticResearchCustomRemove')}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-secondary transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
                <textarea
                  value={source.urls.join('\n')}
                  onChange={event => updateCustomSource(source.id, { urls: readUrlsFromText(event.target.value) })}
                  placeholder={i18nService.t('agentDomesticResearchCustomUrlsPlaceholder')}
                  className="mt-3 min-h-[76px] w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm leading-5 text-foreground outline-none placeholder:text-secondary/45 focus:border-primary"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentDomesticResearchSourcesPanel;
