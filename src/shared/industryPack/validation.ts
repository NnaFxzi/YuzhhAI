import type {
  GenerationPeriod,
  IndustryGenerationRequest,
  IndustryPackManifest,
  ValidationResult,
} from './types';

const MAX_CUSTOM_PERIOD_DAYS = 30;

const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const addRequiredTextError = (
  errors: string[],
  value: unknown,
  fieldName: string,
): void => {
  if (!hasText(value)) errors.push(`${fieldName} is required`);
};

const addRequiredListError = (
  errors: string[],
  value: unknown,
  fieldName: string,
  itemName: string,
): void => {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${fieldName} must include at least one ${itemName}`);
    return;
  }

  if (!value.every(hasText)) {
    errors.push(`${fieldName} must contain only non-empty strings`);
  }
};

const addOptionalStringError = (
  errors: string[],
  value: unknown,
  fieldName: string,
): void => {
  if (value !== undefined && typeof value !== 'string') {
    errors.push(`${fieldName} must be a string`);
  }
};

export function validateIndustryPackManifest(value: unknown): ValidationResult {
  const errors: string[] = [];
  const manifest = value as Partial<IndustryPackManifest> | null;

  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: ['manifest must be an object'] };
  }

  addRequiredTextError(errors, manifest.id, 'manifest.id');
  addRequiredTextError(errors, manifest.name, 'manifest.name');
  addRequiredTextError(errors, manifest.version, 'manifest.version');
  addRequiredTextError(errors, manifest.category, 'manifest.category');
  addRequiredTextError(errors, manifest.description, 'manifest.description');
  addRequiredTextError(errors, manifest.locale, 'manifest.locale');
  addRequiredListError(errors, manifest.entryTasks, 'manifest.entryTasks', 'task');
  addRequiredListError(errors, manifest.supportedChannels, 'manifest.supportedChannels', 'channel');
  addRequiredListError(errors, manifest.supportedThemes, 'manifest.supportedThemes', 'value');
  addRequiredListError(errors, manifest.supportedTones, 'manifest.supportedTones', 'value');
  addRequiredListError(
    errors,
    manifest.defaultOutputSchemas,
    'manifest.defaultOutputSchemas',
    'schema',
  );

  return { ok: errors.length === 0, errors };
}

export function validateGenerationRequest(value: unknown): ValidationResult {
  const errors: string[] = [];
  const request = value as Partial<IndustryGenerationRequest> | null;

  if (!request || typeof request !== 'object') {
    return { ok: false, errors: ['request must be an object'] };
  }

  addRequiredTextError(errors, request.packId, 'request.packId');
  addRequiredTextError(errors, request.taskId, 'request.taskId');
  addRequiredListError(errors, request.channels, 'request.channels', 'channel');
  addRequiredListError(errors, request.themes, 'request.themes', 'theme');
  addRequiredTextError(errors, request.tone, 'request.tone');
  addOptionalStringError(errors, request.productProfileId, 'request.productProfileId');
  addOptionalStringError(errors, request.caseProfileId, 'request.caseProfileId');
  addOptionalStringError(errors, request.supplementalText, 'request.supplementalText');

  if (!request.period || typeof request.period !== 'object') {
    errors.push('request.period is required');
  } else {
    const period = request.period as Partial<GenerationPeriod>;
    if (period.kind !== 'today' && period.kind !== 'preset' && period.kind !== 'custom') {
      errors.push('request.period.kind must be today, preset, or custom');
    }
    if (typeof period.days !== 'number' || !Number.isFinite(period.days)) {
      errors.push('request.period.days must be a number');
    } else if (period.days < 1) {
      errors.push('request.period.days must be at least 1');
    }
  }

  if (!request.profile || typeof request.profile !== 'object' || Array.isArray(request.profile)) {
    errors.push('request.profile must be an object');
  }

  return { ok: errors.length === 0, errors };
}

function normalizePeriod(period: GenerationPeriod): GenerationPeriod {
  if (period.kind === 'today') return { kind: 'today', days: 1 };
  if (period.kind === 'custom') {
    return {
      kind: 'custom',
      days: Math.min(Math.max(Math.floor(period.days || 1), 1), MAX_CUSTOM_PERIOD_DAYS),
    };
  }

  return {
    kind: 'preset',
    days: Math.min(Math.max(Math.floor(period.days || 1), 1), MAX_CUSTOM_PERIOD_DAYS),
  };
}

export function normalizeGenerationRequest(
  request: IndustryGenerationRequest,
): IndustryGenerationRequest {
  return {
    ...request,
    period: normalizePeriod(request.period),
    channels: Array.from(new Set(request.channels)),
    themes: Array.from(new Set(request.themes)),
    supplementalText: request.supplementalText?.trim() || undefined,
  };
}
