import { type ApiConfigResolution, resolveRawApiConfig } from '../libs/claudeSettings';
import type { CoworkApiConfig } from '../libs/coworkConfigStore';

export interface ModelGenerationInput {
  prompt: string;
  systemPrompt?: string;
  apiConfig?: CoworkApiConfig;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ModelGenerationResult {
  text: string;
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
  message?: {
    content?: unknown;
  };
  text?: unknown;
}

interface OpenAICompatibleResponse {
  choices?: OpenAICompatibleChoice[];
  output_text?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getResponseText(value: unknown): string {
  if (!isRecord(value)) {
    throw new Error('OpenAI-compatible model response must be a JSON object');
  }

  const response = value as OpenAICompatibleResponse;
  const choice = response.choices?.[0];
  const messageContent = choice?.message?.content;

  if (typeof messageContent === 'string') return messageContent;
  if (typeof choice?.text === 'string') return choice.text;
  if (typeof response.output_text === 'string') return response.output_text;

  throw new Error('OpenAI-compatible model response did not include text content');
}

export function resolveChatCompletionsEndpoint(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

export function createOpenAICompatibleModelClient(
  options: OpenAICompatibleModelClientOptions,
): ModelClientAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async generate(input) {
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
        }),
      });

      if (!response.ok) {
        throw new Error(
          `OpenAI-compatible model request failed with status ${response.status}`,
        );
      }

      let raw: unknown;
      try {
        raw = await response.json() as unknown;
      } catch (error) {
        throw new Error(
          'OpenAI-compatible model response was not valid JSON',
          { cause: error },
        );
      }

      return {
        text: getResponseText(raw),
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
