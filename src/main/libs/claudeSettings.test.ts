import { afterEach, expect, test, vi } from 'vitest';

import {
  resolveCurrentApiConfig,
  resolveModelConfigReadiness,
  resolveRawApiConfigFromAppConfig,
  setAuthTokensGetter,
  setServerBaseUrlGetter,
  setStoreGetter,
} from './claudeSettings';

afterEach(() => {
  setAuthTokensGetter(() => null);
  setServerBaseUrlGetter(() => null);
  vi.restoreAllMocks();
});

test('resolved provider diagnostics never serialize provider credentials', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  const diagnostics = [
    log,
    debug,
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
  ];
  const secrets = {
    apiKey: 'sk-secret-provider-key',
    oauthAccessToken: 'oauth-secret-access-token',
    oauthRefreshToken: 'oauth-secret-refresh-token',
  };

  const resolution = resolveRawApiConfigFromAppConfig({
    model: {
      defaultModel: 'private-model',
      defaultModelProvider: 'custom-private',
    },
    providers: {
      'custom-private': {
        enabled: true,
        ...secrets,
        authType: 'apikey',
        baseUrl: 'https://private.example/v1',
        apiFormat: 'openai',
        models: [{ id: 'private-model', name: 'Private Model' }],
      },
    },
  });

  expect(resolution.config?.apiKey).toBe(secrets.apiKey);
  const serializedLogArguments = JSON.stringify(
    diagnostics.flatMap(diagnostic => diagnostic.mock.calls),
  );
  expect(serializedLogArguments).not.toContain(secrets.apiKey);
  expect(serializedLogArguments).not.toContain(secrets.oauthAccessToken);
  expect(serializedLogArguments).not.toContain(secrets.oauthRefreshToken);
  expect(serializedLogArguments).toContain('custom-private');
  expect(serializedLogArguments).toContain('private-model');
  expect(debug).toHaveBeenCalledOnce();
  expect(log).not.toHaveBeenCalled();
});

test('strict raw resolution disables lobsterai-server fallback without changing the default', () => {
  const diagnostics = [
    vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
  ];
  const endpointSecret = 'endpoint-query-secret';
  const serverBaseUrl = `https://server.example/private?api_key=${endpointSecret}`;
  const authTokensGetter = vi.fn(() => ({
    accessToken: 'server-access-token',
    refreshToken: 'server-refresh-token',
  }));
  const serverBaseUrlGetter = vi.fn(() => serverBaseUrl);
  setAuthTokensGetter(authTokensGetter);
  setServerBaseUrlGetter(serverBaseUrlGetter);
  const appConfig = {
    model: {
      defaultModel: 'anthropic-model',
      defaultModelProvider: 'custom-anthropic',
    },
    providers: {
      'custom-anthropic': {
        enabled: true,
        apiKey: '',
        baseUrl: 'https://anthropic.example/v1',
        apiFormat: 'anthropic' as const,
        models: [{ id: 'anthropic-model', name: 'Anthropic Model' }],
      },
    },
  };

  const strictResolution = resolveRawApiConfigFromAppConfig(appConfig, {
    allowServerFallback: false,
  });

  expect(strictResolution.config).toBeNull();
  expect(authTokensGetter).not.toHaveBeenCalled();
  expect(serverBaseUrlGetter).not.toHaveBeenCalled();

  const defaultResolution = resolveRawApiConfigFromAppConfig(appConfig);

  expect(defaultResolution.providerMetadata?.providerName).toBe('lobsterai-server');
  expect(defaultResolution.config).toMatchObject({
    apiKey: 'server-access-token',
    baseURL: `${serverBaseUrl}/api/proxy/v1`,
    model: 'anthropic-model',
  });
  expect(authTokensGetter).toHaveBeenCalled();
  expect(serverBaseUrlGetter).toHaveBeenCalled();
  const serializedDiagnostics = JSON.stringify({
    calls: diagnostics.flatMap(diagnostic => diagnostic.mock.calls),
    error: defaultResolution.error,
  });
  expect(serializedDiagnostics).not.toContain(serverBaseUrl);
  expect(serializedDiagnostics).not.toContain(endpointSecret);
  expect(serializedDiagnostics).not.toContain('server-access-token');
  expect(serializedDiagnostics).not.toContain('server-refresh-token');
  expect(serializedDiagnostics).toContain('lobsterai-server');
  expect(serializedDiagnostics).toContain('anthropic-model');
});

test('resolveModelConfigReadiness accepts OpenAI-compatible custom providers before the compat proxy starts', () => {
  setStoreGetter(() => ({
    get: (key: string) => {
      if (key !== 'app_config') return null;
      return {
        model: {
          defaultModel: 'qwen3.6-plus',
          defaultModelProvider: 'custom_0',
        },
        providers: {
          custom_0: {
            enabled: true,
            apiKey: 'sk-custom',
            baseUrl: 'https://custom.example.com/v1',
            apiFormat: 'openai',
            models: [
              {
                id: 'qwen3.6-plus',
                name: 'Qwen3.6 Plus',
              },
            ],
          },
        },
      };
    },
  }) as never);

  expect(resolveCurrentApiConfig().config).toBeNull();

  const readiness = resolveModelConfigReadiness();

  expect(readiness.hasConfig).toBe(true);
  expect(readiness.config?.model).toBe('qwen3.6-plus');
  expect(readiness.providerMetadata?.providerName).toBe('custom_0');
});
