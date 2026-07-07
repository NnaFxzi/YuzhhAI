import {
  CheckCircleIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import {
  AgentExternalResearchMode,
  type ExternalResearchEditConfig,
  ExternalResearchProviderId,
  type ExternalResearchProviderId as ExternalResearchProviderIdValue,
  type ExternalResearchProviderTestInput,
  ExternalResearchSecretEditAction,
  type MaskedExternalResearchConfig,
} from '@shared/agent/externalResearch';
import React, { useState } from 'react';

import { i18nService } from '../../services/i18n';
import {
  type ExternalResearchTestResult,
  getExternalResearchSummary,
  getExternalResearchTestFeedback,
} from './agentExternalResearchUi';

interface AgentExternalResearchPanelProps {
  value: ExternalResearchEditConfig;
  agentId?: string | null;
  appDefaults: MaskedExternalResearchConfig | null;
  availableModes?: readonly AgentExternalResearchMode[];
  onChange: (value: ExternalResearchEditConfig) => void;
  onTestProvider: (
    input: ExternalResearchProviderTestInput,
  ) => Promise<{ ok: boolean; message: string }>;
}

const providerLabelKeys = {
  [ExternalResearchProviderId.Tavily]: 'agentExternalResearchTavily',
  [ExternalResearchProviderId.Firecrawl]: 'agentExternalResearchFirecrawl',
} as const;

const providerPlaceholderKeys = {
  [ExternalResearchProviderId.Tavily]: 'agentExternalResearchApiKeyPlaceholderTavily',
  [ExternalResearchProviderId.Firecrawl]: 'agentExternalResearchApiKeyPlaceholderFirecrawl',
} as const;

const modeOptions = [
  AgentExternalResearchMode.Inherit,
  AgentExternalResearchMode.Override,
  AgentExternalResearchMode.Disabled,
] as const;

const modeHintKeys = {
  [AgentExternalResearchMode.Inherit]: 'agentExternalResearchUseDefaultHint',
  [AgentExternalResearchMode.Override]: 'agentExternalResearchOverrideHint',
  [AgentExternalResearchMode.Disabled]: 'agentExternalResearchDisabledHint',
} as const;

const modeShortLabelKeys = {
  [AgentExternalResearchMode.Inherit]: 'agentExternalResearchModeInheritShort',
  [AgentExternalResearchMode.Override]: 'agentExternalResearchModeOverrideShort',
  [AgentExternalResearchMode.Disabled]: 'agentExternalResearchModeDisabledShort',
} as const;

const replaceProviderName = (template: string, provider: string): string =>
  template.replace('{provider}', provider);

const replaceSummaryCounts = (
  template: string,
  counts: { configured: number; enabled: number; total: number },
): string => template
  .replace('{configured}', String(counts.configured))
  .replace('{total}', String(counts.total))
  .replace('{enabled}', String(counts.enabled));

const AgentExternalResearchPanel: React.FC<AgentExternalResearchPanelProps> = ({
  value,
  agentId,
  appDefaults,
  availableModes = modeOptions,
  onChange,
  onTestProvider,
}) => {
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<Record<string, ExternalResearchTestResult>>({});
  const summary = getExternalResearchSummary(value, appDefaults);

  const updateMode = (mode: ExternalResearchEditConfig['mode']) => onChange({ ...value, mode });

  const updateProvider = (
    providerId: ExternalResearchProviderIdValue,
    patch: Partial<ExternalResearchEditConfig['providers'][ExternalResearchProviderIdValue]>,
  ) =>
    onChange({
      ...value,
      providers: {
        ...value.providers,
        [providerId]: { ...value.providers[providerId], ...patch },
      },
    });

  const clearTestResult = (providerId: ExternalResearchProviderIdValue) => {
    setTestResult(prev => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
  };

  const updateProviderApiKey = (providerId: ExternalResearchProviderIdValue, apiKey: string) => {
    clearTestResult(providerId);
    updateProvider(providerId, {
      apiKey,
      apiKeyAction: apiKey.trim()
        ? ExternalResearchSecretEditAction.Replace
        : value.providers[providerId].apiKeyAction,
    });
  };

  const clearProviderApiKey = (providerId: ExternalResearchProviderIdValue) => {
    clearTestResult(providerId);
    updateProvider(providerId, {
      apiKey: '',
      apiKeyAction: ExternalResearchSecretEditAction.Clear,
    });
  };

  const testProvider = async (providerId: ExternalResearchProviderIdValue) => {
    setTesting(prev => ({ ...prev, [providerId]: true }));
    try {
      const provider = value.providers[providerId];
      const useSavedKey =
        Boolean(agentId) &&
        provider.apiKeyAction === ExternalResearchSecretEditAction.Preserve &&
        provider.apiKey.trim().length === 0;
      const result = await onTestProvider({
        providerId,
        agentId,
        apiKey: provider.apiKey,
        useSavedKey,
      });
      setTestResult(prev => ({ ...prev, [providerId]: result }));
    } catch {
      setTestResult(prev => ({
        ...prev,
        [providerId]: {
          ok: false,
          message: i18nService.t('agentExternalResearchTestUnexpectedError'),
        },
      }));
    } finally {
      setTesting(prev => ({ ...prev, [providerId]: false }));
    }
  };

  const renderDefaultSummary = () => {
    if (!appDefaults || value.mode !== AgentExternalResearchMode.Inherit) return null;
    const tavily = appDefaults.providers.tavily;
    const firecrawl = appDefaults.providers.firecrawl;
    return (
      <div className="rounded-lg border border-border bg-surface-raised/50 px-3.5 py-3">
        <div className="text-xs font-semibold text-foreground">
          {i18nService.t('agentExternalResearchDefaultSummary')}
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {[
            [
              i18nService.t('agentExternalResearchTavily'),
              tavily.hasApiKey ? tavily.apiKeyPreview : i18nService.t('agentIMNotConfigured'),
            ],
            [
              i18nService.t('agentExternalResearchFirecrawl'),
              firecrawl.hasApiKey ? firecrawl.apiKeyPreview : i18nService.t('agentIMNotConfigured'),
            ],
          ].map(([label, status]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface px-2.5 py-2"
            >
              <span className="text-xs font-medium text-foreground">{label}</span>
              <span className="truncate text-xs text-secondary">{status}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-4">
      <div className="space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {i18nService.t('agentExternalResearchTitle')}
          </h3>
          <p className="mt-1 text-xs leading-5 text-secondary">
            {i18nService.t('agentExternalResearchHint')}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-border-subtle bg-surface-raised/40 px-3 py-2.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-tertiary">
              {i18nService.t('agentExternalResearchSummaryMode')}
            </div>
            <div className="mt-1 text-sm font-semibold text-foreground">
              {i18nService.t(modeShortLabelKeys[summary.mode])}
            </div>
          </div>
          <div className="rounded-lg border border-border-subtle bg-surface-raised/40 px-3 py-2.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-tertiary">
              {i18nService.t('agentExternalResearchSummaryProviders')}
            </div>
            <div className="mt-1 text-sm font-semibold text-foreground">
              {replaceSummaryCounts(
                i18nService.t('agentExternalResearchSummaryProviderCount'),
                summary.providers,
              )}
            </div>
          </div>
        </div>

        {availableModes.length > 1 && (
          <div>
            <div className="grid gap-2 sm:grid-cols-3">
              {availableModes.map(mode => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={value.mode === mode}
                  onClick={() => updateMode(mode)}
                  className={`flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors ${
                    value.mode === mode
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-secondary hover:border-primary/40 hover:bg-surface-raised'
                  }`}
                >
                  {value.mode === mode && <CheckIcon className="h-3.5 w-3.5" />}
                  <span>{i18nService.t(modeShortLabelKeys[mode])}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-5 text-secondary">
              {i18nService.t(modeHintKeys[value.mode])}
            </p>
          </div>
        )}

        {renderDefaultSummary()}

        {value.mode === AgentExternalResearchMode.Override && (
          <div className="space-y-3">
            <div className="text-xs font-semibold text-foreground">
              {i18nService.t('agentExternalResearchProviderSettings')}
            </div>
            {ExternalResearchProviderIds.map(providerId => {
              const providerLabel = i18nService.t(providerLabelKeys[providerId]);
              const provider = value.providers[providerId];
              const isConfigured =
                provider.apiKeyAction === ExternalResearchSecretEditAction.Preserve ||
                provider.apiKey.trim().length > 0;
              const canUseSavedKey =
                Boolean(agentId) &&
                provider.apiKeyAction === ExternalResearchSecretEditAction.Preserve;
              const canTest = provider.apiKey.trim().length > 0 || canUseSavedKey;
              const isShown = shown[providerId] === true;
              return (
                <div
                  key={providerId}
                  className="rounded-lg border border-border bg-surface-raised/30 p-3"
                >
                  <label className="flex items-center justify-between gap-3 rounded-md">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{providerLabel}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          isConfigured
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-border-subtle bg-surface text-tertiary'
                        }`}
                      >
                        {i18nService.t(
                          isConfigured
                            ? 'agentExternalResearchConfigured'
                            : 'agentExternalResearchUnconfigured',
                        )}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-2 text-xs text-secondary">
                      {i18nService.t('agentExternalResearchEnabled')}
                      <input
                        type="checkbox"
                        checked={provider.enabled}
                        onChange={event =>
                          updateProvider(providerId, { enabled: event.target.checked })
                        }
                        className="h-4 w-4 accent-primary"
                      />
                    </span>
                  </label>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      type={isShown ? 'text' : 'password'}
                      value={provider.apiKey}
                      aria-label={i18nService.t(providerPlaceholderKeys[providerId])}
                      onChange={event => updateProviderApiKey(providerId, event.target.value)}
                      placeholder={i18nService.t(providerPlaceholderKeys[providerId])}
                      className="h-9 min-w-[180px] flex-1 rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      aria-label={replaceProviderName(
                        i18nService.t(
                          isShown ? 'agentExternalResearchHide' : 'agentExternalResearchShow',
                        ),
                        providerLabel,
                      )}
                      onClick={() => setShown(prev => ({ ...prev, [providerId]: !isShown }))}
                      className="h-9 w-9 rounded-lg border border-border text-secondary hover:bg-surface-raised"
                    >
                      {isShown ? (
                        <EyeSlashIcon className="mx-auto h-4 w-4" />
                      ) : (
                        <EyeIcon className="mx-auto h-4 w-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={replaceProviderName(
                        i18nService.t('agentExternalResearchClear'),
                        providerLabel,
                      )}
                      onClick={() => clearProviderApiKey(providerId)}
                      className="h-9 w-9 rounded-lg border border-border text-secondary hover:bg-surface-raised"
                    >
                      <TrashIcon className="mx-auto h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={testing[providerId] || !canTest}
                      onClick={() => void testProvider(providerId)}
                      className="h-9 rounded-lg border border-border px-3 text-sm text-foreground hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {testing[providerId]
                        ? i18nService.t('agentExternalResearchTesting')
                        : i18nService.t('agentExternalResearchTest')}
                    </button>
                  </div>
                  {testResult[providerId] &&
                    (() => {
                      const feedback = getExternalResearchTestFeedback(testResult[providerId]);
                      return (
                        <div
                          className={`mt-3 flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${feedback.toneClassName}`}
                        >
                          {feedback.icon === 'success' ? (
                            <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                          ) : (
                            <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="font-semibold">{i18nService.t(feedback.labelKey)}</div>
                            <div className="mt-0.5 break-words leading-5">{feedback.message}</div>
                          </div>
                        </div>
                      );
                    })()}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const ExternalResearchProviderIds = [
  ExternalResearchProviderId.Tavily,
  ExternalResearchProviderId.Firecrawl,
] as const;

export default AgentExternalResearchPanel;
