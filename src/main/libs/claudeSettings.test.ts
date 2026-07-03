import { expect, test } from 'vitest';

import {
  resolveCurrentApiConfig,
  resolveModelConfigReadiness,
  setStoreGetter,
} from './claudeSettings';

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
