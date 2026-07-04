export const ExternalResearchProviderId = {
  Tavily: 'tavily',
  Firecrawl: 'firecrawl',
} as const;

export type ExternalResearchProviderId =
  typeof ExternalResearchProviderId[keyof typeof ExternalResearchProviderId];

export const ExternalResearchProviderIds = [
  ExternalResearchProviderId.Tavily,
  ExternalResearchProviderId.Firecrawl,
] as const;

export const AgentExternalResearchMode = {
  Inherit: 'inherit',
  Override: 'override',
  Disabled: 'disabled',
} as const;

export type AgentExternalResearchMode =
  typeof AgentExternalResearchMode[keyof typeof AgentExternalResearchMode];

export const ExternalResearchSettingsScope = {
  AppDefault: '__app_default__',
} as const;

export const ExternalResearchSecretEditAction = {
  Preserve: 'preserve',
  Replace: 'replace',
  Clear: 'clear',
} as const;

export type ExternalResearchSecretEditAction =
  typeof ExternalResearchSecretEditAction[keyof typeof ExternalResearchSecretEditAction];

export interface ExternalResearchProviderConfig {
  enabled: boolean;
  apiKey: string;
}

export interface ExternalResearchConfig {
  mode: AgentExternalResearchMode;
  providers: Record<ExternalResearchProviderId, ExternalResearchProviderConfig>;
}

export interface ExternalResearchProviderEditConfig {
  enabled: boolean;
  apiKeyAction: ExternalResearchSecretEditAction;
  apiKey: string;
}

export interface ExternalResearchEditConfig {
  mode: AgentExternalResearchMode;
  providers: Record<ExternalResearchProviderId, ExternalResearchProviderEditConfig>;
}

export interface ExternalResearchProviderTestInput {
  providerId: ExternalResearchProviderId;
  apiKey?: string;
  agentId?: string | null;
  useSavedKey?: boolean;
}

export interface MaskedExternalResearchProviderConfig {
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyPreview: string;
}

export interface MaskedExternalResearchConfig {
  mode: AgentExternalResearchMode;
  providers: Record<ExternalResearchProviderId, MaskedExternalResearchProviderConfig>;
}

export const buildDefaultExternalResearchConfig = (
  mode: AgentExternalResearchMode = AgentExternalResearchMode.Inherit,
): ExternalResearchConfig => ({
  mode,
  providers: {
    [ExternalResearchProviderId.Tavily]: { enabled: false, apiKey: '' },
    [ExternalResearchProviderId.Firecrawl]: { enabled: false, apiKey: '' },
  },
});

export const buildDefaultExternalResearchEditConfig = (
  mode: AgentExternalResearchMode = AgentExternalResearchMode.Inherit,
): ExternalResearchEditConfig => ({
  mode,
  providers: {
    [ExternalResearchProviderId.Tavily]: {
      enabled: false,
      apiKeyAction: ExternalResearchSecretEditAction.Preserve,
      apiKey: '',
    },
    [ExternalResearchProviderId.Firecrawl]: {
      enabled: false,
      apiKeyAction: ExternalResearchSecretEditAction.Preserve,
      apiKey: '',
    },
  },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readProvider = (value: unknown): ExternalResearchProviderConfig => {
  const raw = isRecord(value) ? value : {};
  return {
    enabled: raw.enabled === true,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '',
  };
};

export const normalizeExternalResearchConfig = (value: unknown): ExternalResearchConfig => {
  const raw = isRecord(value) ? value : {};
  const modeValues = Object.values(AgentExternalResearchMode);
  const mode = modeValues.includes(raw.mode as AgentExternalResearchMode)
    ? raw.mode as AgentExternalResearchMode
    : AgentExternalResearchMode.Inherit;
  const providers = isRecord(raw.providers) ? raw.providers : {};

  return {
    mode,
    providers: {
      [ExternalResearchProviderId.Tavily]: readProvider(providers[ExternalResearchProviderId.Tavily]),
      [ExternalResearchProviderId.Firecrawl]: readProvider(providers[ExternalResearchProviderId.Firecrawl]),
    },
  };
};

export const getEffectiveExternalResearchConfig = (
  agentConfig: ExternalResearchConfig,
  appDefaultConfig: ExternalResearchConfig,
): ExternalResearchConfig => {
  if (agentConfig.mode === AgentExternalResearchMode.Disabled) {
    return buildDefaultExternalResearchConfig(AgentExternalResearchMode.Disabled);
  }
  if (agentConfig.mode === AgentExternalResearchMode.Override) {
    return agentConfig;
  }
  return appDefaultConfig;
};

const previewSecret = (apiKey: string): string => {
  if (!apiKey) return '';
  if (apiKey.length <= 8) return '....';
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
};

export const maskExternalResearchConfig = (
  config: ExternalResearchConfig,
): MaskedExternalResearchConfig => ({
  mode: config.mode,
  providers: {
    [ExternalResearchProviderId.Tavily]: {
      enabled: config.providers.tavily.enabled,
      hasApiKey: config.providers.tavily.apiKey.length > 0,
      apiKeyPreview: previewSecret(config.providers.tavily.apiKey),
    },
    [ExternalResearchProviderId.Firecrawl]: {
      enabled: config.providers.firecrawl.enabled,
      hasApiKey: config.providers.firecrawl.apiKey.length > 0,
      apiKeyPreview: previewSecret(config.providers.firecrawl.apiKey),
    },
  },
});

const mergeProviderEdit = (
  existing: ExternalResearchProviderConfig,
  edit: ExternalResearchProviderEditConfig,
): ExternalResearchProviderConfig => ({
  enabled: edit.enabled,
  apiKey:
    edit.apiKeyAction === ExternalResearchSecretEditAction.Preserve
      ? existing.apiKey
      : edit.apiKeyAction === ExternalResearchSecretEditAction.Clear
        ? ''
        : edit.apiKey.trim(),
});

export const mergeExternalResearchEditConfig = (
  existing: ExternalResearchConfig,
  edit: ExternalResearchEditConfig,
): ExternalResearchConfig => ({
  mode: edit.mode,
  providers: {
    [ExternalResearchProviderId.Tavily]: mergeProviderEdit(
      existing.providers.tavily,
      edit.providers.tavily,
    ),
    [ExternalResearchProviderId.Firecrawl]: mergeProviderEdit(
      existing.providers.firecrawl,
      edit.providers.firecrawl,
    ),
  },
});

const maskedProviderToEdit = (
  provider: MaskedExternalResearchProviderConfig,
): ExternalResearchProviderEditConfig => ({
  enabled: provider.enabled,
  apiKeyAction: provider.hasApiKey
    ? ExternalResearchSecretEditAction.Preserve
    : ExternalResearchSecretEditAction.Clear,
  apiKey: '',
});

export const createExternalResearchEditConfigFromMasked = (
  masked: MaskedExternalResearchConfig,
): ExternalResearchEditConfig => ({
  mode: masked.mode,
  providers: {
    [ExternalResearchProviderId.Tavily]: maskedProviderToEdit(masked.providers.tavily),
    [ExternalResearchProviderId.Firecrawl]: maskedProviderToEdit(masked.providers.firecrawl),
  },
});

export const redactExternalResearchSecret = (message: string, secrets: string[]): string =>
  secrets
    .filter(secret => secret.trim().length > 0)
    .reduce((current, secret) => current.split(secret).join('[redacted]'), message);
