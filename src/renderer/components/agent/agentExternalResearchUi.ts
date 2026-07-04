import {
  AgentExternalResearchMode,
  type ExternalResearchEditConfig,
  ExternalResearchProviderIds,
  ExternalResearchSecretEditAction,
  type MaskedExternalResearchConfig,
} from '@shared/agent/externalResearch';

export type ExternalResearchTestResult = {
  ok: boolean;
  message: string;
};

export type ExternalResearchTestFeedback = {
  icon: 'success' | 'error';
  labelKey: 'agentExternalResearchTestSuccess' | 'agentExternalResearchTestFailed';
  message: string;
  toneClassName: string;
};

export interface ExternalResearchSummary {
  mode: ExternalResearchEditConfig['mode'];
  providers: {
    configured: number;
    enabled: number;
    total: number;
  };
}

export const getExternalResearchSummary = (
  value: ExternalResearchEditConfig,
  appDefaults: MaskedExternalResearchConfig | null,
): ExternalResearchSummary => {
  if (value.mode === AgentExternalResearchMode.Disabled) {
    return {
      mode: value.mode,
      providers: {
        configured: 0,
        enabled: 0,
        total: ExternalResearchProviderIds.length,
      },
    };
  }

  const providers = ExternalResearchProviderIds.map(providerId => {
    if (value.mode === AgentExternalResearchMode.Inherit) {
      const provider = appDefaults?.providers[providerId];
      return {
        configured: Boolean(provider?.hasApiKey),
        enabled: Boolean(provider?.enabled),
      };
    }
    const provider = value.providers[providerId];
    return {
      configured: provider.apiKeyAction === ExternalResearchSecretEditAction.Preserve
        || provider.apiKey.trim().length > 0,
      enabled: provider.enabled,
    };
  });

  return {
    mode: value.mode,
    providers: {
      configured: providers.filter(provider => provider.configured).length,
      enabled: providers.filter(provider => provider.enabled).length,
      total: providers.length,
    },
  };
};

export const getExternalResearchTestFeedback = (
  result: ExternalResearchTestResult,
): ExternalResearchTestFeedback => {
  if (result.ok) {
    return {
      icon: 'success',
      labelKey: 'agentExternalResearchTestSuccess',
      message: result.message,
      toneClassName: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    };
  }

  return {
    icon: 'error',
    labelKey: 'agentExternalResearchTestFailed',
    message: result.message,
    toneClassName: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  };
};
