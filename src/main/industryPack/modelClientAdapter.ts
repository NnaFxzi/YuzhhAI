import { type ApiConfigResolution, resolveRawApiConfig } from '../libs/claudeSettings';
import type { CoworkApiConfig } from '../libs/coworkConfigStore';

export interface ModelGenerationInput {
  prompt: string;
  systemPrompt?: string;
  apiConfig?: CoworkApiConfig;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: ModelGenerationResponseFormat;
  thinkingMode?: ModelGenerationThinkingMode;
  signal?: AbortSignal;
  maxResponseBytes?: number;
}

export const ModelGenerationResponseFormat = {
  JsonObject: 'json_object',
} as const;
export type ModelGenerationResponseFormat =
  typeof ModelGenerationResponseFormat[keyof typeof ModelGenerationResponseFormat];

export const ModelGenerationThinkingMode = {
  Disabled: 'disabled',
} as const;
export type ModelGenerationThinkingMode =
  typeof ModelGenerationThinkingMode[keyof typeof ModelGenerationThinkingMode];

export const ModelGenerationFinishReason = {
  Length: 'length',
  Stop: 'stop',
} as const;
export type ModelGenerationFinishReason =
  typeof ModelGenerationFinishReason[keyof typeof ModelGenerationFinishReason];

export interface ModelGenerationResult {
  text: string;
  finishReason?: ModelGenerationFinishReason;
  raw?: unknown;
}

export interface ModelClientAdapter {
  generate(input: ModelGenerationInput): Promise<ModelGenerationResult>;
}

interface OpenAICompatibleModelClientOptions {
  endpoint: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

interface ConfiguredIndustryModelClientOptions {
  resolveApiConfig?: () => ApiConfigResolution;
  fetchImpl?: typeof fetch;
}

interface OpenAICompatibleMessage {
  role: 'system' | 'user';
  content: string;
}

interface OpenAICompatibleChoice {
  finish_reason?: unknown;
  message?: {
    content?: unknown;
  };
  text?: unknown;
}

interface OpenAICompatibleResponse {
  choices?: OpenAICompatibleChoice[];
  output_text?: unknown;
}

export const ModelClientErrorCode = {
  InvalidContent: 'model_response_invalid_content',
  InvalidJson: 'model_response_invalid_json',
  ReadFailed: 'model_response_read_failed',
  ResponseTooLarge: 'model_response_too_large',
} as const;

export class ModelResponseInvalidContentError extends Error {
  readonly code = ModelClientErrorCode.InvalidContent;

  constructor() {
    super('OpenAI-compatible model response did not contain supported text content');
    this.name = 'ModelResponseInvalidContentError';
  }
}

export class ModelResponseInvalidJsonError extends Error {
  readonly code = ModelClientErrorCode.InvalidJson;

  constructor() {
    super('OpenAI-compatible model response was not valid JSON');
    this.name = 'ModelResponseInvalidJsonError';
  }
}

export class ModelResponseReadError extends Error {
  readonly code = ModelClientErrorCode.ReadFailed;

  constructor() {
    super('OpenAI-compatible model response could not be read');
    this.name = 'ModelResponseReadError';
  }
}

export class ModelResponseTooLargeError extends Error {
  readonly code = ModelClientErrorCode.ResponseTooLarge;

  constructor(readonly maxResponseBytes: number) {
    super('OpenAI-compatible model response exceeded the configured byte limit');
    this.name = 'ModelResponseTooLargeError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getResponseText(value: unknown): string {
  if (!isRecord(value)) {
    throw new ModelResponseInvalidContentError();
  }

  const response = value as OpenAICompatibleResponse;
  const choice = response.choices?.[0];
  const messageContent = choice?.message?.content;

  if (typeof messageContent === 'string') return messageContent;
  if (typeof choice?.text === 'string') return choice.text;
  if (typeof response.output_text === 'string') return response.output_text;

  throw new ModelResponseInvalidContentError();
}

function getFinishReason(value: unknown): ModelGenerationFinishReason | undefined {
  if (!isRecord(value)) return undefined;
  const finishReason = (value as OpenAICompatibleResponse).choices?.[0]?.finish_reason;
  if (finishReason === ModelGenerationFinishReason.Length) {
    return ModelGenerationFinishReason.Length;
  }
  if (finishReason === ModelGenerationFinishReason.Stop) {
    return ModelGenerationFinishReason.Stop;
  }
  return undefined;
}

export function resolveChatCompletionsEndpoint(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // The caller's stable error remains authoritative when transport cancellation fails.
  }
}

function hasOversizedContentLength(response: Response, maxResponseBytes: number): boolean {
  const rawContentLength = response.headers.get('Content-Length')?.trim();
  if (!rawContentLength || !/^\d+$/.test(rawContentLength)) return false;

  try {
    return BigInt(rawContentLength) > BigInt(maxResponseBytes);
  } catch {
    return false;
  }
}

function validateMaxResponseBytes(maxResponseBytes: number): void {
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 0) {
    throw new RangeError('maxResponseBytes must be a non-negative safe integer');
  }
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'AbortError';
}

function parseSafeJson(encoded: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(encoded)) as unknown;
  } catch {
    throw new ModelResponseInvalidJsonError();
  }
}

async function readBoundedJson(response: Response, maxResponseBytes: number): Promise<unknown> {
  if (hasOversizedContentLength(response, maxResponseBytes)) {
    await cancelResponseBody(response);
    throw new ModelResponseTooLargeError(maxResponseBytes);
  }

  if (!response.body) {
    throw new ModelResponseInvalidJsonError();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxResponseBytes) {
        try {
          await reader.cancel();
        } catch {
          // The stable size-limit error must not be replaced by a cancel failure.
        }
        throw new ModelResponseTooLargeError(maxResponseBytes);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ModelResponseTooLargeError || isAbortError(error)) {
      throw error;
    }
    throw new ModelResponseReadError();
  } finally {
    reader.releaseLock();
  }

  const encoded = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    encoded.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return parseSafeJson(encoded);
}

export function createOpenAICompatibleModelClient(
  options: OpenAICompatibleModelClientOptions,
): ModelClientAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async generate(input) {
      if (input.maxResponseBytes !== undefined) {
        validateMaxResponseBytes(input.maxResponseBytes);
      }

      const messages: OpenAICompatibleMessage[] = [];
      if (input.systemPrompt) {
        messages.push({ role: 'system', content: input.systemPrompt });
      }
      messages.push({ role: 'user', content: input.prompt });

      const response = await fetchImpl(options.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
          ...options.headers,
        },
        body: JSON.stringify({
          model: input.model ?? options.model,
          messages,
          temperature: input.temperature ?? options.temperature,
          max_tokens: input.maxTokens ?? options.maxTokens,
          ...(input.responseFormat === ModelGenerationResponseFormat.JsonObject
            ? { response_format: { type: ModelGenerationResponseFormat.JsonObject } }
            : {}),
          ...(input.thinkingMode === ModelGenerationThinkingMode.Disabled
            ? { thinking: { type: ModelGenerationThinkingMode.Disabled } }
            : {}),
        }),
        signal: input.signal,
      });

      if (!response.ok) {
        await cancelResponseBody(response);
        throw new Error(
          `OpenAI-compatible model request failed with status ${response.status}`,
        );
      }

      let raw: unknown;
      if (input.maxResponseBytes !== undefined) {
        raw = await readBoundedJson(response, input.maxResponseBytes);
      } else {
        try {
          raw = await response.json() as unknown;
        } catch (error) {
          if (isAbortError(error)) throw error;
          throw new ModelResponseInvalidJsonError();
        }
      }

      const finishReason = getFinishReason(raw);
      return {
        text: getResponseText(raw),
        ...(finishReason === undefined ? {} : { finishReason }),
        raw,
      };
    },
  };
}

export function createConfiguredIndustryModelClient(
  options: ConfiguredIndustryModelClientOptions = {},
): ModelClientAdapter {
  const resolveApiConfig = options.resolveApiConfig ?? resolveRawApiConfig;

  return {
    async generate(input) {
      const config = input.apiConfig ?? resolveApiConfig().config;
      if (!config) {
        throw new Error('Industry marketing generation requires an API configuration.');
      }
      if (config.apiType !== 'openai') {
        throw new Error(
          'Industry marketing generation requires an OpenAI-compatible API configuration.',
        );
      }

      return createOpenAICompatibleModelClient({
        endpoint: resolveChatCompletionsEndpoint(config.baseURL),
        apiKey: config.apiKey,
        model: config.model,
        fetchImpl: options.fetchImpl,
      }).generate(input);
    },
  };
}
