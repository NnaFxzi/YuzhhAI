import {
  buildDefaultDomesticResearchConfig,
  DomesticResearchMode,
  DomesticResearchSourceId,
  DomesticResearchSourceIds,
  normalizeDomesticResearchConfig,
} from '../agent/domesticResearch';
import {
  AgentExternalResearchMode,
  buildDefaultExternalResearchConfig,
  ExternalResearchProviderId,
  normalizeExternalResearchConfig,
} from '../agent/externalResearch';
import { ApiFormat, ProviderAuthType, type ProviderConfig } from '../providers';
import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadContentDeliveryMode,
  EnterpriseLeadContentOutputLengthPolicy,
  EnterpriseLeadContentOutputPlatformId,
  EnterpriseLeadContentOutputPlatformIds,
  EnterpriseLeadContentPlatformId,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadResearchCapabilityId,
  EnterpriseLeadRiskLevel,
  EnterpriseLeadSkillCapabilityIds,
  EnterpriseLeadTaskStatus,
  EnterpriseLeadTodoKind,
  EnterpriseLeadWorkspaceAgentSource,
  EnterpriseLeadWorkspaceType,
} from './constants';
import type {
  EnterpriseLeadAgentTaskResult,
  EnterpriseLeadExtractionSource,
  EnterpriseLeadRiskReviewOutput,
  EnterpriseLeadTodoInput,
  EnterpriseLeadWorkspaceAgentBinding,
  EnterpriseLeadWorkspaceAgentOverrides,
  EnterpriseLeadWorkspaceChatResearchIntent,
  EnterpriseLeadWorkspaceContentOutputRules,
  EnterpriseLeadWorkspaceContentPlatformConfig,
  EnterpriseLeadWorkspaceContentPlatformSettings,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceModelSettings,
  EnterpriseLeadWorkspaceNormalizedSettingsUpdate,
  EnterpriseLeadWorkspaceProfile,
  EnterpriseLeadWorkspaceRunAgentSnapshot,
  EnterpriseLeadWorkspaceSettings,
} from './types';

export const MAX_WORKSPACE_CHAT_QUERY_LENGTH = 500;
export const MAX_WORKSPACE_CHAT_EXTRACT_URLS = 10;
const MAX_WORKSPACE_OUTPUT_PREFERENCE_INSTRUCTIONS = 12;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const cleanText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const cleanOptionalText = (value: unknown): string | undefined => {
  const text = cleanText(value);
  return text || undefined;
};

const cleanTextList = (value: unknown): string[] =>
  Array.isArray(value) ? Array.from(new Set(value.map(cleanText).filter(Boolean))) : [];

const cleanSkillIds = (value: unknown): string[] => cleanTextList(value);

const readRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const hasOwn = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

const defaultProfile = (): EnterpriseLeadWorkspaceProfile => ({
  companySummary: '',
  productList: [],
  productCapabilities: [],
  targetCustomers: [],
  applicationScenarios: [],
  sellingPoints: [],
  channelPreferences: [],
  prohibitedClaims: [],
  contactRules: [],
  missingInfo: [],
});

const readBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const readOptionalBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const readPositiveNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

const isHttpUrl = (value: unknown): value is string => {
  const url = cleanText(value);
  if (!url) return false;
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
};

const normalizeResearchProvider = (value: unknown): 'auto' | 'tavily' | 'firecrawl' => {
  if (value === 'tavily' || value === 'firecrawl') {
    return value;
  }
  return 'auto';
};

const normalizeDomesticResearchSourceIds = (value: unknown): DomesticResearchSourceId[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map(cleanText))).filter(
    (sourceId): sourceId is DomesticResearchSourceId =>
      DomesticResearchSourceIds.includes(sourceId as DomesticResearchSourceId),
  );
};

const normalizeWorkspaceAgentOverrides = (
  value: unknown,
  directValue?: unknown,
): EnterpriseLeadWorkspaceAgentOverrides => {
  const directRecord = readRecord(directValue);
  const overrideRecord = readRecord(value);
  const record = {
    ...directRecord,
    ...overrideRecord,
  };
  const overrides: EnterpriseLeadWorkspaceAgentOverrides = {};
  const name = cleanOptionalText(record.name);
  const description = cleanOptionalText(record.description);
  const identity = cleanOptionalText(record.identity);
  const systemPrompt = cleanOptionalText(record.systemPrompt);
  const icon = cleanOptionalText(record.icon);
  const model = cleanOptionalText(record.model);
  const skillIds = cleanSkillIds(record.skillIds);

  if (name) overrides.name = name;
  if (description) overrides.description = description;
  if (identity) overrides.identity = identity;
  if (systemPrompt) overrides.systemPrompt = systemPrompt;
  if (icon) overrides.icon = icon;
  if (model) overrides.model = model;
  if (skillIds.length > 0) overrides.skillIds = skillIds;

  return overrides;
};

const isEnterpriseLeadAgentRole = (value: string): value is EnterpriseLeadAgentRole =>
  Object.values(EnterpriseLeadAgentRole).includes(value as EnterpriseLeadAgentRole);

const normalizeWorkspaceAgentSource = (
  value: unknown,
  agentId: string,
): EnterpriseLeadWorkspaceAgentSource => {
  if (
    value === EnterpriseLeadWorkspaceAgentSource.SystemTemplate ||
    value === EnterpriseLeadWorkspaceAgentSource.WorkspaceCreated
  ) {
    return value;
  }

  return isEnterpriseLeadAgentRole(agentId)
    ? EnterpriseLeadWorkspaceAgentSource.SystemTemplate
    : EnterpriseLeadWorkspaceAgentSource.WorkspaceCreated;
};

export function normalizeEnterpriseLeadRunAgentSnapshot(
  value: unknown,
): EnterpriseLeadWorkspaceRunAgentSnapshot | null {
  const record = readRecord(value);
  const agentId = cleanText(record.agentId);
  if (!agentId) return null;

  return {
    agentId,
    name: cleanText(record.name) || agentId,
    description: cleanText(record.description),
    identity: cleanText(record.identity),
    systemPrompt: cleanText(record.systemPrompt),
    icon: cleanText(record.icon),
    model: cleanText(record.model),
    skillIds: cleanSkillIds(record.skillIds),
  };
}

export function normalizeEnterpriseLeadWorkspaceAgents(
  value: unknown,
): EnterpriseLeadWorkspaceAgentBinding[] {
  if (!Array.isArray(value)) return [];

  const bindingsByAgentId = new Map<
    string,
    {
      binding: EnterpriseLeadWorkspaceAgentBinding;
      index: number;
    }
  >();

  value.forEach((item, index) => {
    const record = readRecord(item);
    const agentId = cleanText(record.agentId);
    if (!agentId) return;
    const order =
      typeof record.order === 'number' && Number.isFinite(record.order)
        ? Math.max(0, Math.floor(record.order))
        : index;

    bindingsByAgentId.set(agentId, {
      binding: {
        agentId,
        source: normalizeWorkspaceAgentSource(record.source, agentId),
        enabled: record.enabled !== false,
        order,
        overrides: normalizeWorkspaceAgentOverrides(record.overrides, record),
      },
      index,
    });
  });

  return Array.from(bindingsByAgentId.values())
    .sort((left, right) => left.binding.order - right.binding.order || left.index - right.index)
    .map((item, order) => ({
      ...item.binding,
      ...(item.binding.source === EnterpriseLeadWorkspaceAgentSource.SystemTemplate
        ? {
            templateId:
              cleanOptionalText(readRecord(value[item.index]).templateId) ?? item.binding.agentId,
          }
        : {}),
      order,
    }));
}

export function normalizeWorkspaceChatResearchIntent(
  value: unknown,
): EnterpriseLeadWorkspaceChatResearchIntent {
  const record = readRecord(value);
  const kind = cleanText(record.kind);

  if (kind === 'domestic_status') {
    return { kind: 'domestic_status' };
  }

  if (kind === 'search') {
    const query = cleanText(record.query).slice(0, MAX_WORKSPACE_CHAT_QUERY_LENGTH);
    if (!query) return { kind: 'none' };
    return {
      kind: 'search',
      query,
      provider: normalizeResearchProvider(record.provider),
    };
  }

  if (kind === 'extract') {
    const urls = Array.isArray(record.urls)
      ? Array.from(new Set(record.urls.map(cleanText).filter(isHttpUrl))).slice(
          0,
          MAX_WORKSPACE_CHAT_EXTRACT_URLS,
        )
      : [];
    if (urls.length === 0) return { kind: 'none' };
    const query = cleanOptionalText(
      cleanText(record.query).slice(0, MAX_WORKSPACE_CHAT_QUERY_LENGTH),
    );

    return {
      kind: 'extract',
      urls,
      ...(query ? { query } : {}),
      provider: normalizeResearchProvider(record.provider),
    };
  }

  if (kind === 'domestic_search') {
    const query = cleanText(record.query).slice(0, MAX_WORKSPACE_CHAT_QUERY_LENGTH);
    if (!query) return { kind: 'none' };
    return {
      kind: 'domestic_search',
      query,
      sourceIds: normalizeDomesticResearchSourceIds(record.sourceIds),
    };
  }

  return { kind: 'none' };
}

const normalizeApiFormat = (
  value: unknown,
  fallback?: ProviderConfig['apiFormat'],
): ProviderConfig['apiFormat'] => {
  if (value === ApiFormat.OpenAI || value === ApiFormat.Anthropic || value === ApiFormat.Gemini) {
    return value;
  }
  return fallback;
};

const normalizeProviderAuthType = (
  value: unknown,
  fallback?: ProviderConfig['authType'],
): ProviderConfig['authType'] | undefined => {
  if (value === ProviderAuthType.ApiKey || value === ProviderAuthType.OAuth) {
    return value;
  }
  return fallback;
};

const normalizeProviderModels = (
  value: unknown,
  fallback: ProviderConfig['models'] = [],
): NonNullable<ProviderConfig['models']> => {
  const source = Array.isArray(value) ? value : (fallback ?? []);
  return source
    .map(item => {
      const record = readRecord(item);
      const id = cleanText(record.id);
      if (!id) return null;
      const model: NonNullable<ProviderConfig['models']>[number] = {
        id,
        name: cleanText(record.name) || id,
      };
      const supportsImage = readOptionalBoolean(record.supportsImage);
      const supportsThinking = readOptionalBoolean(record.supportsThinking);
      const contextWindow = readPositiveNumber(record.contextWindow);
      const customParams = readRecord(record.customParams);
      if (supportsImage !== undefined) model.supportsImage = supportsImage;
      if (supportsThinking !== undefined) model.supportsThinking = supportsThinking;
      if (contextWindow !== undefined) model.contextWindow = contextWindow;
      if (Object.keys(customParams).length > 0) model.customParams = customParams;
      return model;
    })
    .filter((model): model is NonNullable<ProviderConfig['models']>[number] => Boolean(model));
};

const normalizeProviderConfig = (value: unknown, fallback?: ProviderConfig): ProviderConfig => {
  const record = readRecord(value);
  const base = fallback ?? {
    enabled: false,
    apiKey: '',
    baseUrl: '',
    models: [],
  };
  const normalized: ProviderConfig = {
    enabled: readBoolean(record.enabled, base.enabled),
    apiKey: hasOwn(record, 'apiKey') ? cleanText(record.apiKey) : base.apiKey,
    baseUrl: hasOwn(record, 'baseUrl') ? cleanText(record.baseUrl) : base.baseUrl,
    models: normalizeProviderModels(record.models, base.models),
  };

  const apiFormat = normalizeApiFormat(record.apiFormat, base.apiFormat);
  const displayName = hasOwn(record, 'displayName')
    ? cleanText(record.displayName)
    : base.displayName;
  const codingPlanEnabled = readOptionalBoolean(record.codingPlanEnabled) ?? base.codingPlanEnabled;
  const authType = normalizeProviderAuthType(record.authType, base.authType);
  const oauthAccessToken = hasOwn(record, 'oauthAccessToken')
    ? cleanText(record.oauthAccessToken)
    : base.oauthAccessToken;
  const oauthBaseUrl = hasOwn(record, 'oauthBaseUrl')
    ? cleanText(record.oauthBaseUrl)
    : base.oauthBaseUrl;
  const oauthRefreshToken = hasOwn(record, 'oauthRefreshToken')
    ? cleanText(record.oauthRefreshToken)
    : base.oauthRefreshToken;
  const oauthTokenExpiresAt =
    readPositiveNumber(record.oauthTokenExpiresAt) ?? base.oauthTokenExpiresAt;

  if (apiFormat) normalized.apiFormat = apiFormat;
  if (displayName) normalized.displayName = displayName;
  if (codingPlanEnabled !== undefined) normalized.codingPlanEnabled = codingPlanEnabled;
  if (authType) normalized.authType = authType;
  if (oauthAccessToken) normalized.oauthAccessToken = oauthAccessToken;
  if (oauthBaseUrl) normalized.oauthBaseUrl = oauthBaseUrl;
  if (oauthRefreshToken) normalized.oauthRefreshToken = oauthRefreshToken;
  if (oauthTokenExpiresAt) normalized.oauthTokenExpiresAt = oauthTokenExpiresAt;

  return normalized;
};

const normalizeModelSettings = (
  value: unknown,
  fallback?: EnterpriseLeadWorkspaceModelSettings,
): EnterpriseLeadWorkspaceModelSettings => {
  const record = readRecord(value);
  const fallbackModel = fallback ?? {
    defaultModel: '',
    defaultModelProvider: '',
    providers: {},
  };
  const rawProviders = readRecord(record.providers);
  const providerKeys = Array.from(
    new Set([...Object.keys(fallbackModel.providers), ...Object.keys(rawProviders)]),
  );

  return {
    defaultModel: hasOwn(record, 'defaultModel')
      ? cleanText(record.defaultModel)
      : fallbackModel.defaultModel,
    defaultModelProvider: hasOwn(record, 'defaultModelProvider')
      ? cleanText(record.defaultModelProvider)
      : fallbackModel.defaultModelProvider,
    providers: Object.fromEntries(
      providerKeys.map(providerKey => [
        providerKey,
        normalizeProviderConfig(rawProviders[providerKey], fallbackModel.providers[providerKey]),
      ]),
    ),
  };
};

const parseLegacyModelRef = (
  modelRef: unknown,
): Pick<EnterpriseLeadWorkspaceModelSettings, 'defaultModel' | 'defaultModelProvider'> => {
  const value = cleanText(modelRef);
  if (!value) return { defaultModel: '', defaultModelProvider: '' };
  const slashIndex = value.indexOf('/');
  if (slashIndex <= 0 || slashIndex === value.length - 1) {
    return { defaultModel: value, defaultModelProvider: '' };
  }
  return {
    defaultModelProvider: value.slice(0, slashIndex),
    defaultModel: value.slice(slashIndex + 1),
  };
};

const legacySkillIdsFromCapabilities = (value: unknown): string[] => {
  const capabilities = readRecord(value);
  return EnterpriseLeadSkillCapabilityIds.filter(
    capabilityId => readRecord(capabilities[capabilityId]).enabled === true,
  );
};

const legacyExternalResearchFromCapabilities = (
  value: unknown,
): EnterpriseLeadWorkspaceSettings['externalResearch'] => {
  const capabilities = readRecord(value);
  const webSearchEnabled =
    readRecord(capabilities[EnterpriseLeadResearchCapabilityId.WebSearch]).enabled === true;
  return {
    ...buildDefaultExternalResearchConfig(AgentExternalResearchMode.Override),
    providers: {
      [ExternalResearchProviderId.Tavily]: {
        enabled: webSearchEnabled,
        apiKey: '',
      },
      [ExternalResearchProviderId.Firecrawl]: {
        enabled: false,
        apiKey: '',
      },
    },
  };
};

const legacyDomesticResearchFromPlatforms = (
  value: unknown,
): EnterpriseLeadWorkspaceSettings['domesticResearch'] => {
  const platforms = readRecord(value);
  const domesticResearch = buildDefaultDomesticResearchConfig();
  const applyEnabled = (
    platformId: EnterpriseLeadContentPlatformId,
    sourceId: DomesticResearchSourceId,
  ): void => {
    const platform = readRecord(platforms[platformId]);
    if (hasOwn(platform, 'enabled')) {
      domesticResearch.sources[sourceId].enabled = platform.enabled === true;
    }
  };

  applyEnabled(EnterpriseLeadContentPlatformId.Xiaohongshu, DomesticResearchSourceId.Xiaohongshu);
  applyEnabled(EnterpriseLeadContentPlatformId.Douyin, DomesticResearchSourceId.Douyin);
  applyEnabled(EnterpriseLeadContentPlatformId.Kuaishou, DomesticResearchSourceId.Kuaishou);
  applyEnabled(
    EnterpriseLeadContentPlatformId.WechatOfficial,
    DomesticResearchSourceId.WeChatOfficialAccounts,
  );

  if (readRecord(platforms[EnterpriseLeadContentPlatformId.Wecom]).enabled === true) {
    domesticResearch.customSources.push({
      id: 'wecom',
      name: '企业微信',
      enabled: true,
      modes: [DomesticResearchMode.UrlImport],
      urls: [],
    });
  }

  return normalizeDomesticResearchConfig(domesticResearch);
};

const buildDefaultContentPlatformConfig = (
  id: EnterpriseLeadContentOutputPlatformId,
): EnterpriseLeadWorkspaceContentPlatformConfig => {
  const defaults: Record<
    EnterpriseLeadContentOutputPlatformId,
    Omit<EnterpriseLeadWorkspaceContentPlatformConfig, 'id'>
  > = {
    [EnterpriseLeadContentOutputPlatformId.XiaohongshuDraft]: {
      enabled: true,
      deliveryMode: EnterpriseLeadContentDeliveryMode.DraftOnly,
      account: '',
      endpoint: '',
      token: '',
      appId: '',
      payloadFormat: 'markdown',
    },
    [EnterpriseLeadContentOutputPlatformId.SalesMessage]: {
      enabled: true,
      deliveryMode: EnterpriseLeadContentDeliveryMode.SmsTemplate,
      account: '',
      endpoint: '',
      token: '',
      appId: '',
      payloadFormat: 'text',
    },
    [EnterpriseLeadContentOutputPlatformId.WechatArticle]: {
      enabled: false,
      deliveryMode: EnterpriseLeadContentDeliveryMode.WechatDraft,
      account: '',
      endpoint: '',
      token: '',
      appId: '',
      payloadFormat: 'markdown',
    },
    [EnterpriseLeadContentOutputPlatformId.CustomWebhook]: {
      enabled: false,
      deliveryMode: EnterpriseLeadContentDeliveryMode.Webhook,
      account: '',
      endpoint: '',
      token: '',
      appId: '',
      payloadFormat: 'json',
    },
  };

  return {
    id,
    ...defaults[id],
  };
};

export function buildDefaultContentPlatformSettings(): EnterpriseLeadWorkspaceContentPlatformSettings {
  return {
    platforms: Object.fromEntries(
      EnterpriseLeadContentOutputPlatformIds.map(platformId => [
        platformId,
        buildDefaultContentPlatformConfig(platformId),
      ]),
    ),
    outputRules: {
      defaultPlatformId: EnterpriseLeadContentOutputPlatformId.SalesMessage,
      lengthPolicy: EnterpriseLeadContentOutputLengthPolicy.Compress,
      riskCheckBeforeExport: true,
      variablePlaceholders: ['客户名', '行业', '痛点', '卖点'],
      archiveOutputs: true,
    },
  };
}

const normalizeContentOutputLengthPolicy = (value: unknown, fallback: string): string => {
  const policy = cleanText(value);
  return Object.values(EnterpriseLeadContentOutputLengthPolicy).includes(
    policy as EnterpriseLeadContentOutputLengthPolicy,
  )
    ? policy
    : fallback;
};

const normalizeContentPlatformConfig = (
  platformId: string,
  value: unknown,
  fallback?: EnterpriseLeadWorkspaceContentPlatformConfig,
): EnterpriseLeadWorkspaceContentPlatformConfig => {
  const record = readRecord(value);
  const base = fallback ?? {
    id: platformId,
    enabled: false,
    deliveryMode: '',
    account: '',
    endpoint: '',
    token: '',
    appId: '',
    payloadFormat: '',
  };

  return {
    id: cleanText(record.id) || base.id || platformId,
    enabled: readBoolean(record.enabled, base.enabled),
    deliveryMode: cleanText(record.deliveryMode) || base.deliveryMode,
    account: hasOwn(record, 'account') ? cleanText(record.account) : base.account,
    endpoint: hasOwn(record, 'endpoint') ? cleanText(record.endpoint) : base.endpoint,
    token: hasOwn(record, 'token') ? cleanText(record.token) : base.token,
    appId: hasOwn(record, 'appId') ? cleanText(record.appId) : base.appId,
    payloadFormat: cleanText(record.payloadFormat) || base.payloadFormat,
  };
};

const normalizeContentOutputRules = (
  value: unknown,
  fallback: EnterpriseLeadWorkspaceContentOutputRules,
  platforms: Record<string, EnterpriseLeadWorkspaceContentPlatformConfig>,
): EnterpriseLeadWorkspaceContentOutputRules => {
  const record = readRecord(value);
  const defaultPlatformId = cleanText(record.defaultPlatformId) || fallback.defaultPlatformId;
  return {
    defaultPlatformId: platforms[defaultPlatformId]
      ? defaultPlatformId
      : fallback.defaultPlatformId,
    lengthPolicy: normalizeContentOutputLengthPolicy(record.lengthPolicy, fallback.lengthPolicy),
    riskCheckBeforeExport: readBoolean(
      record.riskCheckBeforeExport,
      fallback.riskCheckBeforeExport,
    ),
    variablePlaceholders: hasOwn(record, 'variablePlaceholders')
      ? cleanTextList(record.variablePlaceholders)
      : [...fallback.variablePlaceholders],
    archiveOutputs: readBoolean(record.archiveOutputs, fallback.archiveOutputs),
  };
};

const normalizeContentPlatformSettings = (
  value: unknown,
  fallback?: EnterpriseLeadWorkspaceContentPlatformSettings,
): EnterpriseLeadWorkspaceContentPlatformSettings => {
  const record = readRecord(value);
  const base = fallback ?? buildDefaultContentPlatformSettings();
  const rawPlatforms = readRecord(record.platforms);
  const platformIds = Array.from(
    new Set([
      ...EnterpriseLeadContentOutputPlatformIds,
      ...Object.keys(base.platforms),
      ...Object.keys(rawPlatforms),
    ]),
  );
  const platforms = Object.fromEntries(
    platformIds.map(platformId => [
      platformId,
      normalizeContentPlatformConfig(
        platformId,
        rawPlatforms[platformId],
        base.platforms[platformId] ?? {
          ...buildDefaultContentPlatformConfig(
            EnterpriseLeadContentOutputPlatformIds.includes(
              platformId as EnterpriseLeadContentOutputPlatformId,
            )
              ? (platformId as EnterpriseLeadContentOutputPlatformId)
              : EnterpriseLeadContentOutputPlatformId.CustomWebhook,
          ),
          id: platformId,
        },
      ),
    ]),
  );

  return {
    platforms,
    outputRules: normalizeContentOutputRules(record.outputRules, base.outputRules, platforms),
  };
};

const legacyContentPlatformSettingsFromPlatforms = (
  value: unknown,
): EnterpriseLeadWorkspaceContentPlatformSettings => {
  const platforms = readRecord(value);
  const settings = buildDefaultContentPlatformSettings();
  const applyLegacyPlatform = (
    legacyPlatformId: EnterpriseLeadContentPlatformId,
    outputPlatformId: EnterpriseLeadContentOutputPlatformId,
  ): void => {
    const legacyPlatform = readRecord(platforms[legacyPlatformId]);
    if (!Object.keys(legacyPlatform).length) return;
    settings.platforms[outputPlatformId] = {
      ...settings.platforms[outputPlatformId],
      enabled: hasOwn(legacyPlatform, 'enabled')
        ? legacyPlatform.enabled === true
        : settings.platforms[outputPlatformId].enabled,
      account: cleanText(legacyPlatform.account) || settings.platforms[outputPlatformId].account,
    };
  };

  applyLegacyPlatform(
    EnterpriseLeadContentPlatformId.Xiaohongshu,
    EnterpriseLeadContentOutputPlatformId.XiaohongshuDraft,
  );
  applyLegacyPlatform(
    EnterpriseLeadContentPlatformId.WechatOfficial,
    EnterpriseLeadContentOutputPlatformId.WechatArticle,
  );
  applyLegacyPlatform(
    EnterpriseLeadContentPlatformId.Wecom,
    EnterpriseLeadContentOutputPlatformId.SalesMessage,
  );

  return normalizeContentPlatformSettings(settings);
};

const normalizeOutputPreferences = (
  value: unknown,
  fallback?: EnterpriseLeadWorkspaceSettings['outputPreferences'],
): EnterpriseLeadWorkspaceSettings['outputPreferences'] => {
  const record = readRecord(value);
  const base = fallback ?? { instructions: [] };

  return {
    instructions: hasOwn(record, 'instructions')
      ? cleanTextList(record.instructions).slice(0, MAX_WORKSPACE_OUTPUT_PREFERENCE_INSTRUCTIONS)
      : cleanTextList(base.instructions).slice(0, MAX_WORKSPACE_OUTPUT_PREFERENCE_INSTRUCTIONS),
  };
};

const mergeExternalResearchConfigInput = (
  value: unknown,
  fallback: EnterpriseLeadWorkspaceSettings['externalResearch'],
): EnterpriseLeadWorkspaceSettings['externalResearch'] => {
  const record = readRecord(value);
  const base = normalizeExternalResearchConfig(fallback);
  const providers = readRecord(record.providers);

  return normalizeExternalResearchConfig({
    mode: hasOwn(record, 'mode') ? record.mode : base.mode,
    providers: {
      [ExternalResearchProviderId.Tavily]: {
        ...base.providers[ExternalResearchProviderId.Tavily],
        ...readRecord(providers[ExternalResearchProviderId.Tavily]),
      },
      [ExternalResearchProviderId.Firecrawl]: {
        ...base.providers[ExternalResearchProviderId.Firecrawl],
        ...readRecord(providers[ExternalResearchProviderId.Firecrawl]),
      },
    },
  });
};

const mergeDomesticResearchConfigInput = (
  value: unknown,
  fallback: EnterpriseLeadWorkspaceSettings['domesticResearch'],
): EnterpriseLeadWorkspaceSettings['domesticResearch'] => {
  const record = readRecord(value);
  const base = normalizeDomesticResearchConfig(fallback);
  const sources = readRecord(record.sources);

  return normalizeDomesticResearchConfig({
    sources: DomesticResearchSourceIds.reduce(
      (mergedSources, sourceId) => ({
        ...mergedSources,
        [sourceId]: hasOwn(sources, sourceId)
          ? {
              ...base.sources[sourceId],
              ...readRecord(sources[sourceId]),
            }
          : base.sources[sourceId],
      }),
      {},
    ),
    customSources: hasOwn(record, 'customSources') ? record.customSources : base.customSources,
  });
};

export function normalizeWorkspaceProfile(value: unknown): EnterpriseLeadWorkspaceProfile {
  const record = readRecord(value);
  const confirmedKnowledgeKeys = cleanTextList(record.confirmedKnowledgeKeys);
  return {
    ...defaultProfile(),
    companySummary: cleanText(record.companySummary),
    productList: cleanTextList(record.productList),
    productCapabilities: cleanTextList(record.productCapabilities),
    targetCustomers: cleanTextList(record.targetCustomers),
    applicationScenarios: cleanTextList(record.applicationScenarios),
    sellingPoints: cleanTextList(record.sellingPoints),
    channelPreferences: cleanTextList(record.channelPreferences),
    prohibitedClaims: cleanTextList(record.prohibitedClaims),
    contactRules: cleanTextList(record.contactRules),
    missingInfo: cleanTextList(record.missingInfo),
    ...(confirmedKnowledgeKeys.length > 0 ? { confirmedKnowledgeKeys } : {}),
  };
}

export function buildDefaultEnterpriseLeadWorkspaceSettings(): EnterpriseLeadWorkspaceSettings {
  return {
    model: {
      defaultModel: '',
      defaultModelProvider: '',
      providers: {},
    },
    skillIds: [],
    externalResearch: buildDefaultExternalResearchConfig(AgentExternalResearchMode.Override),
    domesticResearch: buildDefaultDomesticResearchConfig(),
    contentPlatforms: buildDefaultContentPlatformSettings(),
    outputPreferences: {
      instructions: [],
    },
  };
}

export function normalizeEnterpriseLeadWorkspaceSettings(
  value: unknown,
  baseSettings?: EnterpriseLeadWorkspaceSettings,
): EnterpriseLeadWorkspaceSettings {
  const record = readRecord(value);
  const fallback = baseSettings ?? buildDefaultEnterpriseLeadWorkspaceSettings();
  const contentPlatformsRecord = readRecord(record.contentPlatforms);
  const hasNewContentPlatformsShape =
    isRecord(contentPlatformsRecord.platforms) || isRecord(contentPlatformsRecord.outputRules);
  const hasNewShape =
    isRecord(record.model) ||
    Array.isArray(record.skillIds) ||
    isRecord(record.externalResearch) ||
    isRecord(record.domesticResearch) ||
    hasNewContentPlatformsShape ||
    isRecord(record.outputPreferences);
  const legacyModel = parseLegacyModelRef(record.modelRef);

  return {
    model: normalizeModelSettings(
      hasNewShape ? record.model : { ...legacyModel, providers: {} },
      fallback.model,
    ),
    skillIds:
      hasNewShape && hasOwn(record, 'skillIds')
        ? cleanTextList(record.skillIds)
        : hasNewShape
          ? [...fallback.skillIds]
          : legacySkillIdsFromCapabilities(record.skillCapabilities),
    externalResearch:
      hasNewShape && hasOwn(record, 'externalResearch')
        ? mergeExternalResearchConfigInput(record.externalResearch, fallback.externalResearch)
        : hasNewShape
          ? normalizeExternalResearchConfig(fallback.externalResearch)
          : legacyExternalResearchFromCapabilities(record.researchCapabilities),
    domesticResearch:
      hasNewShape && hasOwn(record, 'domesticResearch')
        ? mergeDomesticResearchConfigInput(record.domesticResearch, fallback.domesticResearch)
        : hasNewShape
          ? normalizeDomesticResearchConfig(fallback.domesticResearch)
          : legacyDomesticResearchFromPlatforms(record.contentPlatforms),
    contentPlatforms:
      hasNewShape && hasOwn(record, 'contentPlatforms')
        ? normalizeContentPlatformSettings(record.contentPlatforms, fallback.contentPlatforms)
        : hasNewShape
          ? normalizeContentPlatformSettings(fallback.contentPlatforms)
          : legacyContentPlatformSettingsFromPlatforms(record.contentPlatforms),
    outputPreferences:
      hasNewShape && hasOwn(record, 'outputPreferences')
        ? normalizeOutputPreferences(record.outputPreferences, fallback.outputPreferences)
        : normalizeOutputPreferences(fallback.outputPreferences),
  };
}

export function normalizeEnterpriseLeadWorkspaceSettingsUpdate(
  value: unknown,
  currentSettings: EnterpriseLeadWorkspaceSettings,
): EnterpriseLeadWorkspaceNormalizedSettingsUpdate {
  const record = readRecord(value);
  const normalized: EnterpriseLeadWorkspaceNormalizedSettingsUpdate = {};
  if (Array.isArray(record.enabledAgentRoles)) {
    normalized.enabledAgentRoles = Array.from(
      new Set(record.enabledAgentRoles.map(cleanText).filter(Boolean)),
    );
  }
  if (hasOwn(record, 'workspaceAgents')) {
    normalized.workspaceAgents = normalizeEnterpriseLeadWorkspaceAgents(record.workspaceAgents);
  }
  if (isRecord(record.settings)) {
    normalized.settings = normalizeEnterpriseLeadWorkspaceSettings(
      record.settings,
      currentSettings,
    );
  }

  return normalized;
}

export function normalizeEnterpriseLeadExtractionSource(
  value: unknown,
): EnterpriseLeadExtractionSource {
  const record = readRecord(value);
  const kind = cleanText(record.kind) || EnterpriseLeadExtractionSourceKind.Manual;
  const label =
    cleanText(record.label) ||
    cleanText(record.filePath) ||
    cleanText(record.text).slice(0, 40) ||
    '未命名资料';

  return {
    kind,
    label,
    filePath: cleanOptionalText(record.filePath),
    fileName: cleanOptionalText(record.fileName),
    fileSize: readPositiveNumber(record.fileSize),
    text: cleanOptionalText(record.text),
    summary: cleanOptionalText(record.summary),
    extractionStatus: cleanOptionalText(record.extractionStatus),
    extractionError: cleanOptionalText(record.extractionError),
    lastExtractedAt: cleanOptionalText(record.lastExtractedAt),
    vectorIndexStatus: cleanOptionalText(record.vectorIndexStatus),
    vectorIndexError: cleanOptionalText(record.vectorIndexError),
    vectorIndexedAt: cleanOptionalText(record.vectorIndexedAt),
    vectorChunkCount:
      typeof record.vectorChunkCount === 'number' &&
      Number.isFinite(record.vectorChunkCount) &&
      record.vectorChunkCount >= 0
        ? Math.floor(record.vectorChunkCount)
        : undefined,
    vectorEmbeddingVersion: cleanOptionalText(record.vectorEmbeddingVersion),
    extractedKnowledgeKeys: cleanTextList(record.extractedKnowledgeKeys),
    createdAt: cleanOptionalText(record.createdAt),
    updatedAt: cleanOptionalText(record.updatedAt),
  };
}

export function normalizeEnterpriseLeadExtractionSources(
  value: unknown,
): EnterpriseLeadExtractionSource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeEnterpriseLeadExtractionSource);
}

export function normalizeWorkspaceDraftInput(value: unknown): EnterpriseLeadWorkspaceDraft {
  const record = readRecord(value);
  const name = cleanText(record.name);
  if (!name) throw new Error('workspace draft name is required');

  const source = readRecord(record.source);
  const sourceKind = cleanText(source.kind) || EnterpriseLeadExtractionSourceKind.Conversation;

  return {
    name,
    type: EnterpriseLeadWorkspaceType.EnterpriseLead,
    profile: normalizeWorkspaceProfile(record.profile),
    source: {
      kind: sourceKind,
      label: cleanText(source.label) || '用户输入',
      filePath: cleanText(source.filePath) || undefined,
      text: cleanText(source.text) || undefined,
      createdAt: cleanText(source.createdAt) || undefined,
      updatedAt: cleanText(source.updatedAt) || undefined,
    },
    enabledAgentRoles: Object.values(EnterpriseLeadAgentRole),
    workspaceAgents: normalizeEnterpriseLeadWorkspaceAgents(record.workspaceAgents),
    ...(isRecord(record.settings)
      ? { settings: normalizeEnterpriseLeadWorkspaceSettings(record.settings) }
      : {}),
  };
}

const normalizeTodo = (value: unknown): EnterpriseLeadTodoInput => {
  const record = readRecord(value);
  return {
    kind: cleanText(record.kind) || EnterpriseLeadTodoKind.MissingInfo,
    title: cleanText(record.title) || '待处理事项',
    description: cleanText(record.description),
    role: cleanText(record.role) || undefined,
    deliverableId: cleanText(record.deliverableId) || undefined,
  };
};

export function normalizeAgentTaskResultInput(value: unknown): EnterpriseLeadAgentTaskResult {
  const record = readRecord(value);
  const role = cleanText(record.role);
  if (!role) throw new Error('agent task result role is required');
  const summary = cleanText(record.summary);
  if (!summary) throw new Error('agent task result summary is required');

  return {
    role,
    summary,
    outputs: readRecord(record.outputs),
    missingInfo: cleanTextList(record.missingInfo),
    todos: Array.isArray(record.todos) ? record.todos.map(normalizeTodo) : [],
    risks: Array.isArray(record.risks)
      ? record.risks.map(item => {
          const risk = readRecord(item);
          return {
            level: cleanText(risk.level) || EnterpriseLeadRiskLevel.Low,
            title: cleanText(risk.title) || '风险提示',
            description: cleanText(risk.description),
            role: cleanText(risk.role) || undefined,
          };
        })
      : [],
    handoffContext: readRecord(record.handoffContext),
    status: cleanText(record.status) || EnterpriseLeadTaskStatus.Completed,
  };
}

export function normalizeRiskReviewOutput(value: unknown): EnterpriseLeadRiskReviewOutput {
  const record = readRecord(value);
  const riskLevel = cleanText(record.riskLevel) as EnterpriseLeadRiskLevel;
  const normalizedLevel = Object.values(EnterpriseLeadRiskLevel).includes(riskLevel)
    ? riskLevel
    : EnterpriseLeadRiskLevel.Medium;
  const blockingIssues = cleanTextList(record.blockingIssues);

  return {
    riskLevel: normalizedLevel,
    blockingIssues,
    warnings: cleanTextList(record.warnings),
    requiredRevisions: cleanTextList(record.requiredRevisions),
    approvalTodos: Array.isArray(record.approvalTodos)
      ? record.approvalTodos.map(normalizeTodo)
      : [],
    draftOnlyConfirmed: record.draftOnlyConfirmed === true,
    canArchive:
      normalizedLevel === EnterpriseLeadRiskLevel.High ? false : record.canArchive !== false,
  };
}
