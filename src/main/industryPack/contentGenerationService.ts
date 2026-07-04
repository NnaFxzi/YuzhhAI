import type {
  GeneratedAsset,
  IndustryGenerationRequest,
} from '../../shared/industryPack/types';
import {
  normalizeGenerationRequest,
  validateGenerationRequest,
} from '../../shared/industryPack/validation';
import type { IndustryPackLoader, LoadedIndustryPack } from './industryPackLoader';
import type { IndustryPackStore } from './industryPackStore';
import type { ModelClientAdapter } from './modelClientAdapter';
import type { PositioningService } from './positioningService';
import { renderIndustryPrompt } from './templateRenderer';

interface IndustryWorkspace {
  id: string;
  packId: string;
  name: string;
}

interface ContentGenerationServiceOptions {
  loader: IndustryPackLoader;
  modelClient: ModelClientAdapter;
  store: IndustryPackStore;
  positioningService?: Pick<PositioningService, 'buildLatestPromptContext'>;
}

export interface ContentGenerationResult {
  workspace: IndustryWorkspace;
  assets: GeneratedAsset[];
}

interface GeneratedAssetPayload {
  channel: string;
  theme: string;
  title: string;
  body: string;
  keywords: string[];
  cta: string;
}

const REQUIRED_ASSET_FIELDS = ['channel', 'theme', 'title', 'body', 'keywords', 'cta'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanJsonText(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenceMatch) return fenceMatch[1].trim();

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function parseModelJson(text: string): unknown {
  try {
    return JSON.parse(cleanJsonText(text)) as unknown;
  } catch (error) {
    throw new Error('Industry generation model response was not valid JSON', { cause: error });
  }
}

function getRequiredString(
  value: Record<string, unknown>,
  fieldName: string,
  assetIndex: number,
): string {
  const fieldValue = value[fieldName];
  if (typeof fieldValue === 'string' && fieldValue.trim().length > 0) {
    return fieldValue;
  }

  throw new Error(`Generated asset ${assetIndex} is missing required string field "${fieldName}"`);
}

function getKeywords(value: Record<string, unknown>, assetIndex: number): string[] {
  const keywords = value.keywords;
  if (Array.isArray(keywords) && keywords.every(item => typeof item === 'string')) {
    return keywords;
  }

  throw new Error(`Generated asset ${assetIndex} must include a keywords string array`);
}

function normalizeGeneratedAssetPayload(
  value: unknown,
  assetIndex: number,
): GeneratedAssetPayload {
  if (!isRecord(value)) {
    throw new Error(`Generated asset ${assetIndex} must be an object`);
  }

  return {
    channel: getRequiredString(value, 'channel', assetIndex),
    theme: getRequiredString(value, 'theme', assetIndex),
    title: getRequiredString(value, 'title', assetIndex),
    body: getRequiredString(value, 'body', assetIndex),
    keywords: getKeywords(value, assetIndex),
    cta: getRequiredString(value, 'cta', assetIndex),
  };
}

function parseGeneratedAssetPayloads(text: string): GeneratedAssetPayload[] {
  const parsed = parseModelJson(text);
  if (!isRecord(parsed)) {
    throw new Error('Industry generation model response must be a JSON object');
  }

  if (Array.isArray(parsed.days)) {
    throw new Error(
      'Calendar generation responses are not supported for asset persistence yet',
    );
  }

  if (Array.isArray(parsed.assets)) {
    return parsed.assets.map((asset, index) => normalizeGeneratedAssetPayload(asset, index));
  }

  if (isRecord(parsed.asset)) {
    return [normalizeGeneratedAssetPayload(parsed.asset, 0)];
  }

  if (REQUIRED_ASSET_FIELDS.every(fieldName => fieldName in parsed)) {
    return [normalizeGeneratedAssetPayload(parsed, 0)];
  }

  throw new Error('Industry generation model response must include an assets array or asset object');
}

function assertIdInSet(
  value: string,
  allowedIds: Set<string>,
  valueLabel: string,
  scopeLabel: string,
): void {
  if (!allowedIds.has(value)) {
    throw new Error(`Invalid industry generation ${valueLabel} "${value}": not included in ${scopeLabel}`);
  }
}

function validateRequestAgainstPack(
  pack: LoadedIndustryPack,
  request: IndustryGenerationRequest,
): void {
  const supportedTasks = new Set(pack.manifest.entryTasks);
  const supportedChannels = new Set(pack.manifest.supportedChannels);
  const supportedThemes = new Set(pack.manifest.supportedThemes);
  const supportedTones = new Set(pack.manifest.supportedTones);

  assertIdInSet(String(request.taskId), supportedTasks, 'task', `pack "${pack.id}"`);
  assertIdInSet(String(request.tone), supportedTones, 'tone', `pack "${pack.id}"`);
  for (const channel of request.channels) {
    assertIdInSet(String(channel), supportedChannels, 'channel', `pack "${pack.id}"`);
  }
  for (const theme of request.themes) {
    assertIdInSet(String(theme), supportedThemes, 'theme', `pack "${pack.id}"`);
  }
}

function validatePayloadsAgainstRequest(
  payloads: GeneratedAssetPayload[],
  request: IndustryGenerationRequest,
): void {
  const selectedChannels = new Set(request.channels.map(String));
  const selectedThemes = new Set(request.themes.map(String));

  payloads.forEach((payload, index) => {
    assertIdInSet(
      payload.channel,
      selectedChannels,
      `asset ${index} channel`,
      'the selected request channels',
    );
    assertIdInSet(
      payload.theme,
      selectedThemes,
      `asset ${index} theme`,
      'the selected request themes',
    );
  });
}

export class ContentGenerationService {
  constructor(private readonly options: ContentGenerationServiceOptions) {}

  async generate(request: IndustryGenerationRequest): Promise<ContentGenerationResult> {
    const validation = validateGenerationRequest(request);
    if (!validation.ok) {
      throw new Error(`Invalid industry generation request: ${validation.errors.join('; ')}`);
    }

    const normalizedRequest = normalizeGenerationRequest(request);
    const pack = this.options.loader.getPack(String(normalizedRequest.packId));
    validateRequestAgainstPack(pack, normalizedRequest);
    const workspace = this.options.store.ensureWorkspace({
      packId: pack.id,
      name: `${pack.manifest.name}工作台`,
    });
    const basePrompt = renderIndustryPrompt(pack, normalizedRequest);
    const positioningContext = this.options.positioningService
      ?.buildLatestPromptContext(String(normalizedRequest.packId))
      .trim();
    const prompt = positioningContext
      ? `${basePrompt}\n\n${positioningContext}\n`
      : basePrompt;
    const modelResult = await this.options.modelClient.generate({ prompt });
    const payloads = parseGeneratedAssetPayloads(modelResult.text);
    validatePayloadsAgainstRequest(payloads, normalizedRequest);
    const assets = payloads.map(payload => this.options.store.createGeneratedAsset({
      workspaceId: workspace.id,
      taskId: String(normalizedRequest.taskId),
      packId: pack.id,
      channel: payload.channel,
      theme: payload.theme,
      tone: String(normalizedRequest.tone),
      title: payload.title,
      body: payload.body,
      keywords: payload.keywords,
      cta: payload.cta,
    }));

    return {
      workspace,
      assets,
    };
  }
}
