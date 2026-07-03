import type { IndustryGenerationRequest } from '../../shared/industryPack/types';
import { normalizeGenerationRequest } from '../../shared/industryPack/validation';
import { planGenerationItems } from './generationPlanner';
import type { LoadedIndustryPack } from './industryPackLoader';

interface PackObjectWithId {
  id: string;
}

interface PackTask extends PackObjectWithId {
  name?: string;
  description?: string;
  outputSchema?: string;
}

interface PackTheme extends PackObjectWithId {
  name?: string;
  angle?: string;
}

interface PackTone extends PackObjectWithId {
  name?: string;
  style?: string;
}

const IndustryOutputSchemaId = {
  ChannelAsset: 'channel-asset',
  ContentCalendar: 'content-calendar',
  ContentPackage: 'content-package',
} as const;
type IndustryOutputSchemaId = typeof IndustryOutputSchemaId[keyof typeof IndustryOutputSchemaId];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasId(value: unknown): value is PackObjectWithId {
  return isRecord(value) && typeof value.id === 'string' && value.id.trim().length > 0;
}

function findPackObject<T extends PackObjectWithId>(value: unknown, id: string): T | undefined {
  if (!Array.isArray(value)) return undefined;

  return value.find((item): item is T => hasId(item) && item.id === id);
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function renderTaskSection(pack: LoadedIndustryPack, request: IndustryGenerationRequest): string {
  const task = findPackObject<PackTask>(pack.tasks, String(request.taskId));

  return [
    `Task id: ${request.taskId}`,
    task?.name ? `Task name: ${task.name}` : '',
    task?.description ? `Task description: ${task.description}` : '',
  ].filter(Boolean).join('\n');
}

function renderSelectedThemes(pack: LoadedIndustryPack, request: IndustryGenerationRequest): string {
  const themeLines = request.themes.map(themeId => {
    const theme = findPackObject<PackTheme>(pack.themes, String(themeId));

    return [
      `- ${themeId}`,
      theme?.name ? `name: ${theme.name}` : '',
      theme?.angle ? `angle: ${theme.angle}` : '',
    ].filter(Boolean).join('; ');
  });

  return themeLines.length > 0 ? themeLines.join('\n') : '- none selected';
}

function renderSelectedTone(pack: LoadedIndustryPack, request: IndustryGenerationRequest): string {
  const tone = findPackObject<PackTone>(pack.tones, String(request.tone));

  return [
    `Tone id: ${request.tone}`,
    tone?.name ? `Tone name: ${tone.name}` : '',
    tone?.style ? `Tone style: ${tone.style}` : '',
  ].filter(Boolean).join('\n');
}

function renderSelectedChannelRules(
  pack: LoadedIndustryPack,
  request: IndustryGenerationRequest,
): string {
  return request.channels
    .map(channel => {
      const channelId = String(channel);
      const rules = pack.channels[channelId] ?? 'No channel rules found in this industry pack.';

      return `## Channel: ${channelId}\n${rules}`;
    })
    .join('\n\n');
}

function getOutputSchemaId(pack: LoadedIndustryPack, request: IndustryGenerationRequest): string {
  const task = findPackObject<PackTask>(pack.tasks, String(request.taskId));

  return task?.outputSchema ?? pack.manifest.defaultOutputSchemas[0] ?? 'content-package';
}

function renderOutputSchema(pack: LoadedIndustryPack, schemaId: string): string {
  const schema = pack.outputSchemas[schemaId];

  if (!schema) return `Output schema id: ${schemaId}`;

  return `Output schema id: ${schemaId}\n${stringifyJson(schema)}`;
}

function renderOutputInstruction(schemaId: string): string {
  if (schemaId === IndustryOutputSchemaId.ContentCalendar) {
    return [
      'Return only JSON with a "days" array.',
      'Each daily item must match the loaded content-calendar schema and include dateOffset, channel, theme, title, brief, and cta.',
    ].join(' ');
  }

  if (schemaId === IndustryOutputSchemaId.ChannelAsset) {
    return 'Return only JSON with a single top-level asset object. The object must include channel, theme, title, body, keywords, and cta.';
  }

  if (schemaId === IndustryOutputSchemaId.ContentPackage) {
    return 'Return only JSON with an "assets" array. Each asset must include channel, theme, title, body, keywords, and cta.';
  }

  return 'Return only JSON that matches the loaded output schema exactly.';
}

export function renderIndustryPrompt(
  pack: LoadedIndustryPack,
  request: IndustryGenerationRequest,
): string {
  const normalizedRequest = normalizeGenerationRequest(request);
  const plannedItems = planGenerationItems(normalizedRequest);
  const outputSchemaId = getOutputSchemaId(pack, normalizedRequest);

  return [
    'You are a manufacturing marketing content strategist.',
    'Generate Chinese domestic customer-acquisition content for the selected industry.',
    'Do not invent certifications, customer names, exact load guarantees, or cost savings not provided by the user.',
    `Industry pack: ${pack.manifest.name}`,
    renderTaskSection(pack, normalizedRequest),
    renderSelectedTone(pack, normalizedRequest),
    `Period JSON:\n${stringifyJson(normalizedRequest.period)}`,
    `Selected themes:\n${renderSelectedThemes(pack, normalizedRequest)}`,
    `Factory profile JSON:\n${stringifyJson(normalizedRequest.profile)}`,
    normalizedRequest.supplementalText
      ? `Supplemental information:\n${normalizedRequest.supplementalText}`
      : '',
    `Selected channel rules:\n${renderSelectedChannelRules(pack, normalizedRequest)}`,
    `Planned items JSON:\n${stringifyJson(plannedItems)}`,
    `Output schema:\n${renderOutputSchema(pack, outputSchemaId)}`,
    renderOutputInstruction(outputSchemaId),
  ].filter(Boolean).join('\n\n');
}
