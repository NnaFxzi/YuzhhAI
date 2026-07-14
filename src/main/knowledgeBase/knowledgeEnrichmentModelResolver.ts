import { createHash } from 'crypto';

import { KnowledgeBaseErrorCode } from '../../shared/knowledgeBase/constants';
import { ProviderName } from '../../shared/providers/constants';
import type { ProviderConfig } from '../../shared/providers/types';
import { resolveRawApiConfigFromAppConfig } from '../libs/claudeSettings';
import type {
  KnowledgeEnrichmentLockedRoute,
  KnowledgeEnrichmentRouteReference,
  KnowledgeEnrichmentWorkspaceRouteSource,
} from './knowledgeEnrichmentTypes';

type KnowledgeEnrichmentModelResolutionErrorCode =
  | typeof KnowledgeBaseErrorCode.WorkspaceNotFound
  | typeof KnowledgeBaseErrorCode.ModelConfigurationUnavailable
  | typeof KnowledgeBaseErrorCode.ModelConfigurationChanged
  | typeof KnowledgeBaseErrorCode.UnsupportedModelProvider;

interface KnowledgeEnrichmentModelResolverOptions {
  getWorkspace: (workspaceId: string) => KnowledgeEnrichmentWorkspaceRouteSource | null;
}

const ROUTING_FINGERPRINT_VERSION = 1;
const CREDENTIAL_IDENTITY_DOMAIN = 'knowledge-enrichment-credential-v1\0';
const NO_AUTH_LOCAL_CREDENTIAL_IDENTITY = 'no-auth-local';
const FORCED_OPENAI_PROVIDER_IDS = new Set<string>([
  ProviderName.OpenAI,
  ProviderName.StepFun,
  ProviderName.Youdaozhiyun,
]);

export class KnowledgeEnrichmentModelResolutionError extends Error {
  constructor(
    readonly code: KnowledgeEnrichmentModelResolutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'KnowledgeEnrichmentModelResolutionError';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashCredentialIdentity(credentialIdentity: string): string {
  return sha256(`${CREDENTIAL_IDENTITY_DOMAIN}${credentialIdentity}`);
}

function normalizeEndpointForFingerprint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) {
    throw new KnowledgeEnrichmentModelResolutionError(
      KnowledgeBaseErrorCode.ModelConfigurationUnavailable,
      'The selected model provider is missing its endpoint.',
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new KnowledgeEnrichmentModelResolutionError(
      KnowledgeBaseErrorCode.ModelConfigurationUnavailable,
      'The selected model provider endpoint is invalid.',
    );
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username !== ''
    || url.password !== ''
  ) {
    throw new KnowledgeEnrichmentModelResolutionError(
      KnowledgeBaseErrorCode.ModelConfigurationUnavailable,
      'The selected model provider endpoint is not allowed.',
    );
  }

  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  const normalized = url.toString();
  return url.pathname === '/' && !url.search
    ? normalized.replace(/\/$/, '')
    : normalized;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  if (normalized === '[::1]' || normalized === '::1') return true;

  const octets = normalized.split('.');
  if (octets.length !== 4 || octets[0] !== '127') return false;
  return octets.every(octet => {
    if (!/^\d{1,3}$/.test(octet)) return false;
    const value = Number(octet);
    return value >= 0 && value <= 255;
  });
}

function isExplicitlyOpenAICompatible(providerId: string, provider: ProviderConfig): boolean {
  if (FORCED_OPENAI_PROVIDER_IDS.has(providerId)) return true;
  if (providerId === ProviderName.Anthropic) return false;
  return provider.apiFormat === 'openai';
}

function isUnsupportedDynamicRoute(providerId: string, provider: ProviderConfig): boolean {
  return providerId === ProviderName.LobsteraiServer
    || providerId === ProviderName.Copilot
    || provider.authType === 'oauth'
    || Boolean(provider.oauthAccessToken?.trim())
    || Boolean(provider.oauthRefreshToken?.trim());
}

function buildRoutingFingerprint(input: {
  providerId: string;
  modelId: string;
  apiType: 'openai';
  normalizedEndpoint: string;
  authType?: ProviderConfig['authType'];
  codingPlanEnabled: boolean;
  credentialIdentity: string;
}): string {
  const credentialIdentityHash = hashCredentialIdentity(input.credentialIdentity);
  const payload = {
    version: ROUTING_FINGERPRINT_VERSION,
    providerId: input.providerId,
    modelId: input.modelId,
    apiType: input.apiType,
    normalizedEndpoint: input.normalizedEndpoint,
    authType: input.authType ?? '',
    codingPlanEnabled: input.codingPlanEnabled,
    credentialIdentityHash,
  };
  return sha256(JSON.stringify(payload));
}

export class KnowledgeEnrichmentModelResolver {
  constructor(private readonly options: KnowledgeEnrichmentModelResolverOptions) {}

  resolveForWorkspace(workspaceId: string): KnowledgeEnrichmentLockedRoute {
    const workspace = this.options.getWorkspace(workspaceId);
    if (!workspace) {
      throw new KnowledgeEnrichmentModelResolutionError(
        KnowledgeBaseErrorCode.WorkspaceNotFound,
        'The knowledge workspace was not found.',
      );
    }

    return this.resolveRouteSource(workspaceId, workspace);
  }

  resolveRouteSource(
    workspaceId: string,
    workspace: KnowledgeEnrichmentWorkspaceRouteSource,
  ): KnowledgeEnrichmentLockedRoute {
    if (workspace.id !== workspaceId) {
      throw new KnowledgeEnrichmentModelResolutionError(
        KnowledgeBaseErrorCode.WorkspaceNotFound,
        'The knowledge workspace was not found.',
      );
    }

    const modelSettings = workspace.settings.model;
    const providerId = modelSettings.defaultModelProvider.trim();
    const modelId = modelSettings.defaultModel.trim();
    if (!providerId || !modelId) {
      throw new KnowledgeEnrichmentModelResolutionError(
        KnowledgeBaseErrorCode.ModelConfigurationUnavailable,
        'The workspace must select an explicit model provider and model.',
      );
    }

    const provider = modelSettings.providers[providerId];
    const selectedModel = provider?.models?.find(model => model.id.trim() === modelId);
    if (!provider?.enabled || !selectedModel || !provider.baseUrl.trim()) {
      throw new KnowledgeEnrichmentModelResolutionError(
        KnowledgeBaseErrorCode.ModelConfigurationUnavailable,
        'The workspace selected model route is unavailable.',
      );
    }
    if (isUnsupportedDynamicRoute(providerId, provider)) {
      throw new KnowledgeEnrichmentModelResolutionError(
        KnowledgeBaseErrorCode.UnsupportedModelProvider,
        'The workspace selected model provider cannot be used for knowledge extraction.',
      );
    }
    if (!isExplicitlyOpenAICompatible(providerId, provider)) {
      throw new KnowledgeEnrichmentModelResolutionError(
        KnowledgeBaseErrorCode.UnsupportedModelProvider,
        'The workspace selected model provider is not OpenAI-compatible.',
      );
    }

    const configuredEndpoint = normalizeEndpointForFingerprint(provider.baseUrl);
    if (!provider.apiKey.trim()) {
      const endpoint = new URL(configuredEndpoint);
      if (!isLoopbackHostname(endpoint.hostname)) {
        throw new KnowledgeEnrichmentModelResolutionError(
          KnowledgeBaseErrorCode.ModelConfigurationUnavailable,
          'The selected model provider requires a stable API key.',
        );
      }
    }

    const resolution = resolveRawApiConfigFromAppConfig({
      model: {
        defaultModel: modelId,
        defaultModelProvider: providerId,
      },
      providers: {
        [providerId]: {
          ...provider,
          models: [{ ...selectedModel, id: modelId }],
        },
      },
    }, { allowServerFallback: false });
    const config = resolution.config;
    if (!config) {
      throw new KnowledgeEnrichmentModelResolutionError(
        KnowledgeBaseErrorCode.ModelConfigurationUnavailable,
        'The workspace selected model route could not be resolved.',
      );
    }
    if (
      resolution.providerMetadata?.providerName !== providerId
      || config.model.trim() !== modelId
    ) {
      throw new KnowledgeEnrichmentModelResolutionError(
        KnowledgeBaseErrorCode.ModelConfigurationChanged,
        'The resolved model route did not match the workspace selection.',
      );
    }
    if (
      config.apiType !== 'openai'
      || resolution.providerMetadata.authType === 'oauth'
    ) {
      throw new KnowledgeEnrichmentModelResolutionError(
        KnowledgeBaseErrorCode.UnsupportedModelProvider,
        'The workspace selected model provider is not OpenAI-compatible.',
      );
    }

    const apiConfig = {
      ...config,
      apiType: 'openai' as const,
    };
    const normalizedEndpoint = normalizeEndpointForFingerprint(apiConfig.baseURL);
    if (!provider.apiKey.trim() && !isLoopbackHostname(new URL(normalizedEndpoint).hostname)) {
      throw new KnowledgeEnrichmentModelResolutionError(
        KnowledgeBaseErrorCode.ModelConfigurationUnavailable,
        'The resolved model provider requires a stable API key.',
      );
    }
    const credentialIdentity = provider.apiKey.trim()
      ? apiConfig.apiKey
      : NO_AUTH_LOCAL_CREDENTIAL_IDENTITY;
    const routingFingerprint = buildRoutingFingerprint({
      providerId,
      modelId,
      apiType: 'openai',
      normalizedEndpoint,
      authType: resolution.providerMetadata.authType ?? provider.authType,
      codingPlanEnabled: resolution.providerMetadata.codingPlanEnabled,
      credentialIdentity,
    });

    return {
      workspaceId: workspace.id,
      providerId,
      providerLabel: provider.displayName?.trim() || providerId,
      modelId,
      modelLabel: selectedModel.name?.trim() || modelId,
      apiType: 'openai',
      apiConfig,
      routingFingerprint,
    };
  }

  resolveExact(requestRoute: KnowledgeEnrichmentRouteReference): KnowledgeEnrichmentLockedRoute {
    const route = this.resolveForWorkspace(requestRoute.workspaceId);
    if (
      route.providerId !== requestRoute.providerId
      || route.modelId !== requestRoute.modelId
      || route.routingFingerprint !== requestRoute.routingFingerprint
    ) {
      throw new KnowledgeEnrichmentModelResolutionError(
        KnowledgeBaseErrorCode.ModelConfigurationChanged,
        'The workspace model route changed after extraction was authorized.',
      );
    }
    return route;
  }
}
