import { describe, expect, test, vi } from 'vitest';

import {
  createConfiguredIndustryModelClient,
  createOpenAICompatibleModelClient,
  resolveChatCompletionsEndpoint,
} from './modelClientAdapter';

describe('resolveChatCompletionsEndpoint', () => {
  test('normalizes OpenAI-compatible base URLs', () => {
    expect(resolveChatCompletionsEndpoint('https://example.test')).toBe(
      'https://example.test/v1/chat/completions',
    );
    expect(resolveChatCompletionsEndpoint('https://example.test/v1/')).toBe(
      'https://example.test/v1/chat/completions',
    );
    expect(resolveChatCompletionsEndpoint('https://example.test/v1/chat/completions')).toBe(
      'https://example.test/v1/chat/completions',
    );
  });
});

describe('createOpenAICompatibleModelClient', () => {
  test('throws a clear error when the provider response is not JSON', async () => {
    const client = createOpenAICompatibleModelClient({
      endpoint: 'https://example.test/v1/chat/completions',
      model: 'example-model',
      fetchImpl: async () => new Response('<html>bad gateway</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    });

    await expect(client.generate({ prompt: 'hello' }))
      .rejects
      .toThrow('OpenAI-compatible model response was not valid JSON');
  });
});

describe('createConfiguredIndustryModelClient', () => {
  test('uses the current OpenAI-compatible API config for generation', async () => {
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://example.test/v1/chat/completions');
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer sk-test',
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'example-model',
        messages: [{ role: 'user', content: 'hello' }],
      });
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
      }), { status: 200 });
    };
    const client = createConfiguredIndustryModelClient({
      resolveApiConfig: () => ({
        config: {
          apiKey: 'sk-test',
          baseURL: 'https://example.test/v1',
          model: 'example-model',
          apiType: 'openai',
        },
      }),
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(client.generate({ prompt: 'hello' })).resolves.toEqual({
      text: 'ok',
      raw: { choices: [{ message: { content: 'ok' } }] },
    });
  });

  test('throws a clear error for Anthropic API config during generation', async () => {
    const client = createConfiguredIndustryModelClient({
      resolveApiConfig: () => ({
        config: {
          apiKey: 'sk-test',
          baseURL: 'https://example.test',
          model: 'claude-test',
          apiType: 'anthropic',
        },
      }),
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    await expect(client.generate({ prompt: 'hello' }))
      .rejects
      .toThrow('Industry marketing generation requires an OpenAI-compatible API configuration.');
  });
});
