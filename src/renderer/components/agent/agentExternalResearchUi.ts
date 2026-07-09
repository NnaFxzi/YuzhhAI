import {
  AgentExternalResearchMode,
  type ExternalResearchEditConfig,
  type ExternalResearchProviderEditConfig,
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

export interface ExternalResearchApiKeyInputState {
  isSavedSecret: boolean;
  inputType: 'password' | 'text';
  placeholderKey: 'agentExternalResearchApiKeySavedPlaceholder' | null;
  value: string;
  canToggleVisibility: boolean;
  canUseSavedKey: boolean;
}

export const SAVED_EXTERNAL_RESEARCH_SECRET_INPUT_VALUE = '************';

export const getExternalResearchApiKeyInputState = (
  provider: ExternalResearchProviderEditConfig,
  isShown: boolean,
  hasSavedSecret: boolean,
): ExternalResearchApiKeyInputState => {
  const isSavedSecret =
    hasSavedSecret &&
    provider.apiKeyAction === ExternalResearchSecretEditAction.Preserve &&
    provider.apiKey.trim().length === 0;
  const hasDraftSecret = provider.apiKey.length > 0;

  return {
    isSavedSecret,
    inputType: isShown && hasDraftSecret ? 'text' : 'password',
    placeholderKey: isSavedSecret ? 'agentExternalResearchApiKeySavedPlaceholder' : null,
    value: isSavedSecret ? SAVED_EXTERNAL_RESEARCH_SECRET_INPUT_VALUE : provider.apiKey,
    canToggleVisibility: hasDraftSecret,
    canUseSavedKey: isSavedSecret,
  };
};

export const getExternalResearchApiKeyDraftFromInput = (
  inputState: ExternalResearchApiKeyInputState,
  nextValue: string,
): string | null => {
  if (!inputState.isSavedSecret) {
    return nextValue;
  }
  if (nextValue === inputState.value || nextValue.length === 0 || /^\*+$/.test(nextValue)) {
    return null;
  }
  if (nextValue.startsWith(inputState.value)) {
    return nextValue.slice(inputState.value.length);
  }
  if (nextValue.endsWith(inputState.value)) {
    return nextValue.slice(0, -inputState.value.length);
  }
  return nextValue;
};

export const getExternalResearchSummary = (
  value: ExternalResearchEditConfig,
  appDefaults: MaskedExternalResearchConfig | null,
  savedConfig: MaskedExternalResearchConfig | null = null,
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
    const savedProvider =
      savedConfig?.mode === AgentExternalResearchMode.Override
        ? savedConfig.providers[providerId]
        : null;
    return {
      configured:
        provider.apiKey.trim().length > 0 ||
        (provider.apiKeyAction === ExternalResearchSecretEditAction.Preserve &&
          savedProvider?.hasApiKey === true),
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
      toneClassName:
        'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    };
  }

  return {
    icon: 'error',
    labelKey: 'agentExternalResearchTestFailed',
    message: result.message,
    toneClassName: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  };
};
