import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createConfiguredIndustryModelClient,
  createOpenAICompatibleModelClient,
  ModelGenerationResponseFormat,
  ModelGenerationThinkingMode,
  ModelResponseInvalidContentError,
  ModelResponseInvalidJsonError,
  ModelResponseReadError,
  ModelResponseTooLargeError,
  resolveChatCompletionsEndpoint,
} from './modelClientAdapter';

const buildModelResponse = (content: string): string => JSON.stringify({
  choices: [{ message: { content } }],
});

const buildChunkedResponse = (
  chunks: Uint8Array[],
  options: {
    cancelError?: Error;
    contentLength?: string;
    keepOpen?: boolean;
    onCancel?: () => void;
    status?: number;
  } = {},
): Response => {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        if (!options.keepOpen) controller.close();
        return;
      }
      controller.enqueue(chunks[index]);
      index += 1;
    },
    cancel() {
      options.onCancel?.();
      if (options.cancelError) return Promise.reject(options.cancelError);
    },
  });

  return new Response(stream, {
    status: options.status ?? 200,
    headers: options.contentLength === undefined
      ? undefined
      : { 'Content-Length': options.contentLength },
  });
};

const captureError = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('Expected promise to reject');
};

afterEach(() => {
  vi.restoreAllMocks();
});

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
  test('serializes explicitly requested JSON-object response format and disabled thinking', async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        model: 'example-model',
        messages: [{ role: 'user', content: 'hello' }],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
      });
      return Promise.resolve(new Response(buildModelResponse('ok'), { status: 200 }));
    });
    const client = createOpenAICompatibleModelClient({
      endpoint: 'https://example.test/v1/chat/completions',
      model: 'example-model',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(client.generate({
      prompt: 'hello',
      responseFormat: ModelGenerationResponseFormat.JsonObject,
      thinkingMode: ModelGenerationThinkingMode.Disabled,
    })).resolves.toMatchObject({ text: 'ok' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test('omits response format and thinking mode when the caller does not request them', async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        model: 'example-model',
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(body).not.toHaveProperty('response_format');
      expect(body).not.toHaveProperty('thinking');
      return Promise.resolve(new Response(buildModelResponse('ok'), { status: 200 }));
    });
    const client = createOpenAICompatibleModelClient({
      endpoint: 'https://example.test/v1/chat/completions',
      model: 'example-model',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(client.generate({ prompt: 'hello' })).resolves.toMatchObject({ text: 'ok' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid maxResponseBytes=%s before fetch',
    async maxResponseBytes => {
      const fetchImpl = vi.fn();
      const client = createOpenAICompatibleModelClient({
        endpoint: 'https://example.test/v1/chat/completions',
        model: 'example-model',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      await expect(client.generate({ prompt: 'hello', maxResponseBytes }))
        .rejects
        .toThrow('maxResponseBytes must be a non-negative safe integer');
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  test('passes the exact AbortSignal to fetch and preserves abort rejection', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        }, { once: true });
      });
    });
    const client = createOpenAICompatibleModelClient({
      endpoint: 'https://example.test/v1/chat/completions',
      model: 'example-model',
      fetchImpl: fetchImpl as typeof fetch,
    });

    const generation = client.generate({ prompt: 'hello', signal: controller.signal });
    controller.abort();

    await expect(generation).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test('rejects an oversized truthful Content-Length without retaining response bytes', async () => {
    const cancel = vi.fn();
    const response = buildChunkedResponse(
      [new TextEncoder().encode(buildModelResponse('too large'))],
      { contentLength: '101', onCancel: cancel },
    );
    const json = vi.spyOn(response, 'json');
    const text = vi.spyOn(response, 'text');
    const client = createOpenAICompatibleModelClient({
      endpoint: 'https://example.test/v1/chat/completions',
      model: 'example-model',
      fetchImpl: async () => response,
    });

    const rejection = client.generate({ prompt: 'hello', maxResponseBytes: 100 });

    await expect(rejection).rejects.toBeInstanceOf(ModelResponseTooLargeError);
    await expect(rejection).rejects.toMatchObject({
      code: 'model_response_too_large',
      maxResponseBytes: 100,
    });
    await expect(rejection).rejects.not.toHaveProperty('partialBody');
    expect(cancel).toHaveBeenCalledOnce();
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(response.body?.locked).toBe(false);
  });

  test.each([
    ['missing Content-Length', undefined],
    ['falsely small Content-Length', '1'],
  ])('counts streamed bytes when %s and cancels immediately on overflow', async (_label, contentLength) => {
    const cancel = vi.fn();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const response = buildChunkedResponse([
      new TextEncoder().encode('{"choices":['),
      new TextEncoder().encode('{"message":{"content":"secret-partial-body"}}]}'),
    ], { contentLength, keepOpen: true, onCancel: cancel });
    const json = vi.spyOn(response, 'json');
    const text = vi.spyOn(response, 'text');
    const client = createOpenAICompatibleModelClient({
      endpoint: 'https://example.test/v1/chat/completions',
      model: 'example-model',
      fetchImpl: async () => response,
    });

    const rejection = client.generate({ prompt: 'hello', maxResponseBytes: 20 });

    await expect(rejection).rejects.toBeInstanceOf(ModelResponseTooLargeError);
    expect(cancel).toHaveBeenCalledOnce();
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(JSON.stringify([...log.mock.calls, ...debug.mock.calls]))
      .not.toContain('secret-partial-body');
    expect(response.body?.locked).toBe(false);
  });

  test('keeps overflow errors stable when reader cancellation rejects', async () => {
    const cancel = vi.fn();
    const response = buildChunkedResponse([
      new TextEncoder().encode('oversized-secret-response'),
    ], {
      cancelError: new Error('secret-cancel-failure'),
      keepOpen: true,
      onCancel: cancel,
    });
    const client = createOpenAICompatibleModelClient({
      endpoint: 'https://example.test/v1/chat/completions',
      model: 'example-model',
      fetchImpl: async () => response,
    });

    const error = await captureError(client.generate({ prompt: 'hello', maxResponseBytes: 5 }));

    expect(error).toBeInstanceOf(ModelResponseTooLargeError);
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).not.toContain('secret-cancel-failure');
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  test('allows a streamed JSON response exactly at the configured byte limit', async () => {
    const body = buildModelResponse('exact');
    const encoded = new TextEncoder().encode(body);
    const response = buildChunkedResponse([
      encoded.slice(0, 5),
      encoded.slice(5),
    ]);
    const json = vi.spyOn(response, 'json');
    const text = vi.spyOn(response, 'text');
    const client = createOpenAICompatibleModelClient({
      endpoint: 'https://example.test/v1/chat/completions',
      model: 'example-model',
      fetchImpl: async () => response,
    });

    await expect(client.generate({
      prompt: 'hello',
      maxResponseBytes: encoded.byteLength,
    })).resolves.toEqual({
      text: 'exact',
      raw: { choices: [{ message: { content: 'exact' } }] },
    });
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(response.body?.locked).toBe(false);
  });

  test.each([
    ['stop', 'stop'],
    ['length', 'length'],
  ])('returns the allowlisted first-choice finish reason %s', async (_label, finishReason) => {
    const client = createOpenAICompatibleModelClient({
      endpoint: 'https://example.test/v1/chat/completions',
      model: 'example-model',
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{
          finish_reason: finishReason,
          message: { content: 'safe response' },
        }],
      }), { status: 200 }),
    });

    await expect(client.generate({ prompt: 'hello' })).resolves.toMatchObject({
      text: 'safe response',
      finishReason,
    });
  });

  test.each([
    ['missing', undefined],
    ['null', null],
    ['unknown string', 'secret-provider-finish-reason'],
    ['non-string', { secret: 'provider-object' }],
  ])('omits an unsafe first-choice finish reason for %s', async (_label, finishReason) => {
    const client = createOpenAICompatibleModelClient({
      endpoint: 'https://example.test/v1/chat/completions',
      model: 'example-model',
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{
          ...(finishReason === undefined ? {} : { finish_reason: finishReason }),
          message: { content: 'safe response' },
        }],
      }), { status: 200 }),
    });

    const result = await client.generate({ prompt: 'hello' });

    expect(result.text).toBe('safe response');
    expect(result.finishReason).toBeUndefined();
  });

  test.each([
    ['unbounded response.json', undefined],
    ['bounded JSON.parse', 1_000],
  ])('returns a fixed safe invalid-JSON error for %s', async (_label, maxResponseBytes) => {
    const secret = 'secret-invalid-json-sentinel';
    const response = new Response(`${secret}{`, { status: 200 });
    const client = createOpenAICompatibleModelClient({
      endpoint: 'https://example.test/v1/chat/completions',
      model: 'example-model',
      fetchImpl: async () => response,
    });

    const error = await captureError(client.generate({
      prompt: 'hello',
      ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
    }));

    expect(error).toBeInstanceOf(ModelResponseInvalidJsonError);
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(String(error)).not.toContain(secret);
    if (maxResponseBytes !== undefined) {
      expect(response.body?.locked).toBe(false);
    }
  });

  test('returns a fixed safe invalid-JSON error for an empty response body', async () => {
    const client = createOpenAICompatibleModelClient({
      endpoint: 'https://example.test/v1/chat/completions',
      model: 'example-model',
      fetchImpl: async () => new Response(null, { status: 200 }),
    });

    const error = await captureError(client.generate({ prompt: 'hello' }));

    expect(error).toBeInstanceOf(ModelResponseInvalidJsonError);
    expect(error).not.toHaveProperty('cause');
  });

  test.each([
    ['non-object JSON', JSON.stringify(['secret-array-content'])],
    ['missing supported text field', JSON.stringify({ secret: 'secret-object-content' })],
    ['non-string supported text field', JSON.stringify({
      choices: [{ message: { content: { secret: 'secret-nested-content' } } }],
    })],
  ])('returns a typed fixed invalid-content error for %s', async (_label, body) => {
    const client = createOpenAICompatibleModelClient({
      endpoint: 'https://example.test/v1/chat/completions',
      model: 'example-model',
      fetchImpl: async () => new Response(body, { status: 200 }),
    });

    const error = await captureError(client.generate({ prompt: 'hello' }));

    expect(error).toBeInstanceOf(ModelResponseInvalidContentError);
    expect(error).toMatchObject({ code: 'model_response_invalid_content' });
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).not.toContain('secret-');
    expect(JSON.stringify(error)).not.toContain('secret-');
  });

  test('discards non-abort stream read errors and releases the reader lock', async () => {
    const secret = 'secret-stream-read-failure';
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() {
        throw new Error(secret);
      },
    }), { status: 200 });
    const client = createOpenAICompatibleModelClient({
      endpoint: 'https://example.test/v1/chat/completions',
      model: 'example-model',
      fetchImpl: async () => response,
    });

    const error = await captureError(client.generate({ prompt: 'hello', maxResponseBytes: 100 }));

    expect(error).toBeInstanceOf(ModelResponseReadError);
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(String(error)).not.toContain(secret);
    expect(response.body?.locked).toBe(false);
  });

  test('preserves AbortError during a bounded body read and releases the reader lock', async () => {
    const controller = new AbortController();
    let markPullStarted: (() => void) | undefined;
    const pullStarted = new Promise<void>(resolve => {
      markPullStarted = resolve;
    });
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() {
        markPullStarted?.();
        return new Promise<void>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
            once: true,
          });
        });
      },
    }), { status: 200 });
    const client = createOpenAICompatibleModelClient({
      endpoint: 'https://example.test/v1/chat/completions',
      model: 'example-model',
      fetchImpl: async () => response,
    });

    const generation = client.generate({
      prompt: 'hello',
      maxResponseBytes: 100,
      signal: controller.signal,
    });
    await pullStarted;
    controller.abort();
    const error = await captureError(generation);

    expect(error).toBe(controller.signal.reason);
    expect(error.name).toBe('AbortError');
    expect(response.body?.locked).toBe(false);
  });

  test('cancels a keep-open non-2xx body before throwing the status error', async () => {
    const cancel = vi.fn();
    const response = buildChunkedResponse([], {
      cancelError: new Error('secret-http-cancel-failure'),
      keepOpen: true,
      onCancel: cancel,
      status: 503,
    });
    const client = createOpenAICompatibleModelClient({
      endpoint: 'https://example.test/v1/chat/completions',
      model: 'example-model',
      fetchImpl: async () => response,
    });

    const error = await captureError(client.generate({ prompt: 'hello' }));

    expect(error.message).toBe('OpenAI-compatible model request failed with status 503');
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).not.toContain('secret-http-cancel-failure');
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

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
  test('forwards the exact signal and response-byte limit through the configured client', async () => {
    const controller = new AbortController();
    const resolveApiConfig = vi.fn();
    const response = buildChunkedResponse([
      new TextEncoder().encode('response-over-limit'),
    ], { keepOpen: true });
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return Promise.resolve(response);
    });
    const client = createConfiguredIndustryModelClient({
      resolveApiConfig,
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(client.generate({
      prompt: 'hello',
      signal: controller.signal,
      maxResponseBytes: 5,
      apiConfig: {
        apiKey: 'sk-workspace',
        baseURL: 'https://workspace.example/v1',
        model: 'workspace-model',
        apiType: 'openai',
      },
    })).rejects.toBeInstanceOf(ModelResponseTooLargeError);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(resolveApiConfig).not.toHaveBeenCalled();
    expect(response.body?.locked).toBe(false);
  });

  test('uses per-request API config before the global resolver', async () => {
    const resolveApiConfig = vi.fn(() => ({
      config: {
        apiKey: 'sk-global',
        baseURL: 'https://global.example/v1',
        model: 'global-model',
        apiType: 'openai' as const,
      },
    }));
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://workspace.example/v1/chat/completions');
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer sk-workspace',
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'workspace-model',
        messages: [{ role: 'user', content: 'hello' }],
      });
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'workspace ok' } }],
      }), { status: 200 });
    };
    const client = createConfiguredIndustryModelClient({
      resolveApiConfig,
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(client.generate({
      prompt: 'hello',
      apiConfig: {
        apiKey: 'sk-workspace',
        baseURL: 'https://workspace.example/v1',
        model: 'workspace-model',
        apiType: 'openai',
      },
    })).resolves.toEqual({
      text: 'workspace ok',
      raw: { choices: [{ message: { content: 'workspace ok' } }] },
    });
    expect(resolveApiConfig).not.toHaveBeenCalled();
  });

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
