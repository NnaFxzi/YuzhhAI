import { createHash } from 'crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { KnowledgeBaseErrorCode } from '../../shared/knowledgeBase/constants';
import { ProviderName } from '../../shared/providers/constants';
import type { ProviderConfig } from '../../shared/providers/types';
import {
  setAuthTokensGetter,
  setServerBaseUrlGetter,
} from '../libs/claudeSettings';
import {
  KnowledgeEnrichmentModelResolutionError,
  KnowledgeEnrichmentModelResolver,
} from './knowledgeEnrichmentModelResolver';
import type {
  KnowledgeEnrichmentRouteReference,
  KnowledgeEnrichmentWorkspaceRouteSource,
} from './knowledgeEnrichmentTypes';

const MODEL_ID = 'shared-model';

const buildProvider = (
  overrides: Partial<ProviderConfig> = {},
): ProviderConfig => ({
  enabled: true,
  apiKey: 'sk-provider-a',
  baseUrl: 'https://provider-a.example/v1',
  apiFormat: 'openai',
  displayName: 'Provider A',
  models: [{ id: MODEL_ID, name: 'Shared Model' }],
  ...overrides,
});

const buildWorkspace = (input: {
  providerId?: string;
  modelId?: string;
  providers?: Record<string, ProviderConfig>;
} = {}): KnowledgeEnrichmentWorkspaceRouteSource => {
  const providerId = input.providerId ?? 'provider-a';
  const modelId = input.modelId ?? MODEL_ID;
  return {
    id: 'workspace-a',
    settings: {
      model: {
        defaultModelProvider: providerId,
        defaultModel: modelId,
        providers: input.providers ?? {
          [providerId]: buildProvider(),
        },
      },
    },
  };
};

const createResolver = (
  readWorkspace: () => KnowledgeEnrichmentWorkspaceRouteSource | null,
): KnowledgeEnrichmentModelResolver => new KnowledgeEnrichmentModelResolver({
  getWorkspace: workspaceId => {
    const workspace = readWorkspace();
    return workspace?.id === workspaceId ? workspace : null;
  },
});

const expectResolutionError = (
  action: () => unknown,
  code: string,
): KnowledgeEnrichmentModelResolutionError => {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(KnowledgeEnrichmentModelResolutionError);
  expect(thrown).toMatchObject({ code });
  return thrown as KnowledgeEnrichmentModelResolutionError;
};

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const expectedFingerprint = (input: {
  providerId: string;
  modelId: string;
  apiType: 'openai';
  normalizedEndpoint: string;
  authType?: string;
  codingPlanEnabled: boolean;
  credential: string;
}): string => {
  const credentialIdentityHash = sha256(
    `knowledge-enrichment-credential-v1\0${input.credential}`,
  );
  const payload = {
    version: 1,
    providerId: input.providerId,
    modelId: input.modelId,
    apiType: input.apiType,
    normalizedEndpoint: input.normalizedEndpoint,
    authType: input.authType ?? '',
    codingPlanEnabled: input.codingPlanEnabled,
    credentialIdentityHash,
  };
  return sha256(JSON.stringify(payload));
};

afterEach(() => {
  setAuthTokensGetter(() => null);
  setServerBaseUrlGetter(() => null);
  vi.restoreAllMocks();
});

describe('KnowledgeEnrichmentModelResolver', () => {
  test('resolves a caller-loaded route source without consulting the workspace getter', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const workspace = buildWorkspace();
    const getWorkspace = vi.fn(() => null);
    const resolver = new KnowledgeEnrichmentModelResolver({ getWorkspace });

    const route = resolver.resolveRouteSource(workspace.id, workspace);

    expect(route).toMatchObject({
      workspaceId: workspace.id,
      providerId: 'provider-a',
      modelId: MODEL_ID,
    });
    expect(getWorkspace).not.toHaveBeenCalled();
  });

  test('resolveForWorkspace delegates the loaded snapshot to resolveRouteSource', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const workspace = buildWorkspace();
    const resolver = createResolver(() => workspace);
    const resolveRouteSource = vi.spyOn(resolver, 'resolveRouteSource');

    resolver.resolveForWorkspace(workspace.id);

    expect(resolveRouteSource).toHaveBeenCalledOnce();
    expect(resolveRouteSource).toHaveBeenCalledWith(workspace.id, workspace);
  });

  test('resolves only the workspace explicit OpenAI-compatible provider and model', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const workspace = buildWorkspace({
      providers: {
        'provider-a': buildProvider({
          displayName: 'Workspace Provider',
          models: [{ id: MODEL_ID, name: 'Workspace Model' }],
        }),
      },
    });
    const route = createResolver(() => workspace).resolveForWorkspace(workspace.id);

    expect(route).toMatchObject({
      workspaceId: workspace.id,
      providerId: 'provider-a',
      providerLabel: 'Workspace Provider',
      modelId: MODEL_ID,
      modelLabel: 'Workspace Model',
      apiType: 'openai',
    });
    expect(route.apiConfig).toEqual({
      apiKey: 'sk-provider-a',
      baseURL: 'https://provider-a.example/v1',
      model: MODEL_ID,
      apiType: 'openai',
    });
    expect(route.routingFingerprint).toBe(expectedFingerprint({
      providerId: 'provider-a',
      modelId: MODEL_ID,
      apiType: 'openai',
      normalizedEndpoint: 'https://provider-a.example/v1',
      codingPlanEnabled: false,
      credential: 'sk-provider-a',
    }));
    expect(route).not.toHaveProperty('credentialIdentityHash');
  });

  test('does not fall back when the preferred provider lacks the selected model', () => {
    const workspace = buildWorkspace({
      providerId: 'selected',
      providers: {
        selected: buildProvider({
          models: [{ id: 'different-model', name: 'Different' }],
        }),
        alternate: buildProvider({
          apiKey: 'sk-alternate',
          baseUrl: 'https://alternate.example/v1',
        }),
      },
    });

    expectResolutionError(
      () => createResolver(() => workspace).resolveForWorkspace(workspace.id),
      KnowledgeBaseErrorCode.ModelConfigurationUnavailable,
    );
  });

  test('does not fall back from a disabled preferred provider', () => {
    const workspace = buildWorkspace({
      providerId: 'selected',
      providers: {
        selected: buildProvider({ enabled: false }),
        alternate: buildProvider({
          apiKey: 'sk-alternate',
          baseUrl: 'https://alternate.example/v1',
        }),
      },
    });

    expectResolutionError(
      () => createResolver(() => workspace).resolveForWorkspace(workspace.id),
      KnowledgeBaseErrorCode.ModelConfigurationUnavailable,
    );
  });

  test.each([
    [
      'Anthropic routes',
      'custom-anthropic',
      buildProvider({ apiFormat: 'anthropic' }),
    ],
    [
      'MiniMax OAuth routes',
      ProviderName.Minimax,
      buildProvider({
        authType: 'oauth',
        oauthAccessToken: 'minimax-access-token',
        oauthRefreshToken: 'minimax-refresh-token',
      }),
    ],
    [
      'OpenAI Codex OAuth routes',
      ProviderName.OpenAI,
      buildProvider({
        authType: 'oauth',
        apiKey: '',
        oauthAccessToken: 'codex-access-token',
      }),
    ],
    [
      'dynamically rotating access-token routes',
      'custom-oauth',
      buildProvider({
        authType: 'oauth',
        oauthAccessToken: 'rotating-access-token',
      }),
    ],
    [
      'GitHub Copilot routes',
      ProviderName.Copilot,
      buildProvider({ apiKey: '' }),
    ],
    [
      'native Gemini routes',
      ProviderName.Gemini,
      buildProvider({
        apiFormat: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      }),
    ],
    [
      'lobsterai-server routes',
      ProviderName.LobsteraiServer,
      buildProvider(),
    ],
  ])('rejects unsupported %s', (_label, providerId, provider) => {
    const workspace = buildWorkspace({
      providerId,
      providers: { [providerId]: provider },
    });

    expectResolutionError(
      () => createResolver(() => workspace).resolveForWorkspace(workspace.id),
      KnowledgeBaseErrorCode.UnsupportedModelProvider,
    );
  });

  test('keeps identical model IDs pinned to the explicitly selected provider', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const workspace = buildWorkspace({
      providerId: 'provider-b',
      providers: {
        'provider-a': buildProvider(),
        'provider-b': buildProvider({
          apiKey: 'sk-provider-b',
          baseUrl: 'https://provider-b.example/v1',
          displayName: 'Provider B',
        }),
      },
    });

    const route = createResolver(() => workspace).resolveForWorkspace(workspace.id);

    expect(route.providerId).toBe('provider-b');
    expect(route.apiConfig.apiKey).toBe('sk-provider-b');
    expect(route.apiConfig.baseURL).toBe('https://provider-b.example/v1');
  });

  test('accepts Gemini only when the workspace explicitly selects its OpenAI-compatible route', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const workspace = buildWorkspace({
      providerId: ProviderName.Gemini,
      providers: {
        [ProviderName.Gemini]: buildProvider({
          apiFormat: 'openai',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          displayName: 'Gemini OpenAI Compatibility',
        }),
      },
    });

    const route = createResolver(() => workspace).resolveForWorkspace(workspace.id);

    expect(route).toMatchObject({
      providerId: ProviderName.Gemini,
      providerLabel: 'Gemini OpenAI Compatibility',
      apiType: 'openai',
      apiConfig: {
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiType: 'openai',
      },
    });
  });

  test.each([
    ['remote empty-key route', 'https://remote.example/v1'],
    ['lookalike localhost route', 'https://localhost.evil.example/v1'],
    ['non-HTTP route', 'ftp://127.0.0.1/v1'],
    ['URL username', 'https://user@127.0.0.1/v1'],
    ['URL password', 'https://user:password@127.0.0.1/v1'],
  ])('rejects an unsafe %s', (_label, baseUrl) => {
    const workspace = buildWorkspace({
      providerId: 'unsafe-provider',
      providers: {
        'unsafe-provider': buildProvider({ apiKey: '', baseUrl }),
      },
    });

    expectResolutionError(
      () => createResolver(() => workspace).resolveForWorkspace(workspace.id),
      KnowledgeBaseErrorCode.ModelConfigurationUnavailable,
    );
  });

  test.each([
    'http://localhost:11434/v1',
    'https://agent.localhost/v1',
    'http://127.82.10.9:11434/v1',
    'http://[::1]:11434/v1',
  ])('accepts no-auth loopback endpoint %s', baseUrl => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const workspace = buildWorkspace({
      providerId: 'local-provider',
      providers: {
        'local-provider': buildProvider({ apiKey: '', baseUrl }),
      },
    });

    expect(createResolver(() => workspace).resolveForWorkspace(workspace.id))
      .toMatchObject({ providerId: 'local-provider', apiType: 'openai' });
  });

  test.each([false, true])(
    'pre-rejects empty-key Anthropic without server fallback (server configured=%s)',
    serverConfigured => {
      const authTokensGetter = vi.fn(() => serverConfigured
        ? { accessToken: 'server-access-token', refreshToken: 'server-refresh-token' }
        : null);
      const serverBaseUrlGetter = vi.fn(() => 'https://server.example');
      setAuthTokensGetter(authTokensGetter);
      setServerBaseUrlGetter(serverBaseUrlGetter);
      const workspace = buildWorkspace({
        providerId: 'custom-anthropic',
        providers: {
          'custom-anthropic': buildProvider({
            apiKey: '',
            apiFormat: 'anthropic',
          }),
        },
      });

      expectResolutionError(
        () => createResolver(() => workspace).resolveForWorkspace(workspace.id),
        KnowledgeBaseErrorCode.UnsupportedModelProvider,
      );
      expect(authTokensGetter).not.toHaveBeenCalled();
      expect(serverBaseUrlGetter).not.toHaveBeenCalled();
    },
  );

  test('uses the effective API key identity and changes only the final fingerprint on rotation', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    let workspace = buildWorkspace({
      providers: {
        'provider-a': buildProvider({ apiKey: 'sk-first-secret' }),
      },
    });
    const resolver = createResolver(() => workspace);
    const first = resolver.resolveForWorkspace(workspace.id);
    const firstAgain = createResolver(() => workspace).resolveForWorkspace(workspace.id);

    workspace = buildWorkspace({
      providers: {
        'provider-a': buildProvider({ apiKey: 'sk-second-secret' }),
      },
    });
    const second = resolver.resolveForWorkspace(workspace.id);

    expect(first.routingFingerprint).toBe(firstAgain.routingFingerprint);
    expect(second.routingFingerprint).not.toBe(first.routingFingerprint);
    expect(first.routingFingerprint).not.toContain('sk-first-secret');
    expect(second.routingFingerprint).not.toContain('sk-second-secret');
    expect(first).not.toHaveProperty('credentialIdentityHash');
    expect(second).not.toHaveProperty('credentialIdentityHash');
  });

  test('uses a stable no-auth-local credential sentinel in the canonical payload', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const workspace = buildWorkspace({
      providerId: 'local-openai',
      providers: {
        'local-openai': buildProvider({
          apiKey: '',
          baseUrl: 'HTTP://127.0.0.1:11434/v1/',
          displayName: 'Local OpenAI',
        }),
      },
    });

    const route = createResolver(() => workspace).resolveForWorkspace(workspace.id);

    expect(route.routingFingerprint).toBe(expectedFingerprint({
      providerId: 'local-openai',
      modelId: MODEL_ID,
      apiType: 'openai',
      normalizedEndpoint: 'http://127.0.0.1:11434/v1',
      codingPlanEnabled: false,
      credential: 'no-auth-local',
    }));
  });

  test('resolveExact rejects a route whose final fingerprint is no longer current', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    let workspace = buildWorkspace();
    const resolver = createResolver(() => workspace);
    const initial = resolver.resolveForWorkspace(workspace.id);
    const requestRoute: KnowledgeEnrichmentRouteReference = {
      workspaceId: initial.workspaceId,
      providerId: initial.providerId,
      modelId: initial.modelId,
      routingFingerprint: initial.routingFingerprint,
    };

    workspace = buildWorkspace({
      providers: {
        'provider-a': buildProvider({ apiKey: 'sk-rotated' }),
      },
    });

    expectResolutionError(
      () => resolver.resolveExact(requestRoute),
      KnowledgeBaseErrorCode.ModelConfigurationChanged,
    );
  });
});
