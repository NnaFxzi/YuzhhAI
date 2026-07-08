export const SkillConfigFieldType = {
  Text: 'text',
  Secret: 'secret',
  Url: 'url',
} as const;

export type SkillConfigFieldType = (typeof SkillConfigFieldType)[keyof typeof SkillConfigFieldType];

export type SkillConfigText =
  | string
  | {
      zh?: string;
      en?: string;
    };

export interface SkillConfigField {
  key: string;
  type: SkillConfigFieldType;
  required: boolean;
  label?: SkillConfigText;
  description?: SkillConfigText;
  placeholder?: SkillConfigText;
  defaultValue?: string;
}

export interface SkillConfigSchema {
  fields: SkillConfigField[];
  helpUrl?: string;
}

export interface SkillConfigCompletion {
  hasFields: boolean;
  configured: boolean;
  missingRequiredKeys: string[];
}

const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const SECRET_KEY_PATTERN = /(API_?KEY|TOKEN|SECRET|PASSWORD|PRIVATE_?KEY|ACCESS_?KEY)/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const readString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(readString).filter(Boolean) : [];

const normalizeText = (value: unknown): SkillConfigText | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const zh = typeof candidate.zh === 'string' ? candidate.zh.trim() : '';
  const en = typeof candidate.en === 'string' ? candidate.en.trim() : '';
  if (!zh && !en) return undefined;
  return {
    ...(zh ? { zh } : {}),
    ...(en ? { en } : {}),
  };
};

const normalizeFieldType = (value: unknown): SkillConfigFieldType => {
  if (value === SkillConfigFieldType.Secret || value === SkillConfigFieldType.Url) {
    return value;
  }
  return SkillConfigFieldType.Text;
};

export const normalizeSkillConfigSchema = (value: unknown): SkillConfigSchema | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.fields)) {
    return undefined;
  }

  const fields = candidate.fields
    .map((rawField): SkillConfigField | null => {
      if (!rawField || typeof rawField !== 'object' || Array.isArray(rawField)) {
        return null;
      }
      const field = rawField as Record<string, unknown>;
      const key = typeof field.key === 'string' ? field.key.trim().toUpperCase() : '';
      if (!ENV_KEY_PATTERN.test(key)) {
        return null;
      }

      const normalized: SkillConfigField = {
        key,
        type: normalizeFieldType(field.type),
        required: field.required === true,
      };
      const label = normalizeText(field.label);
      const description = normalizeText(field.description);
      const placeholder = normalizeText(field.placeholder);
      const defaultValue = typeof field.defaultValue === 'string' ? field.defaultValue : undefined;

      if (label) normalized.label = label;
      if (description) normalized.description = description;
      if (placeholder) normalized.placeholder = placeholder;
      if (defaultValue !== undefined) normalized.defaultValue = defaultValue;
      return normalized;
    })
    .filter((field): field is SkillConfigField => field !== null);

  if (fields.length === 0) {
    return undefined;
  }

  const helpUrl = typeof candidate.helpUrl === 'string' ? candidate.helpUrl.trim() : '';
  return {
    fields,
    ...(helpUrl ? { helpUrl } : {}),
  };
};

export const normalizeSkillConfigSchemaFromSkillFrontmatter = (
  frontmatter: Record<string, unknown>,
): SkillConfigSchema | undefined => {
  const directSchema = normalizeSkillConfigSchema(frontmatter.configSchema);
  if (directSchema) return directSchema;

  const metadata = readRecord(frontmatter.metadata);
  const metadataSchema = normalizeSkillConfigSchema(metadata.configSchema);
  if (metadataSchema) return metadataSchema;

  const openclaw = readRecord(metadata.openclaw);
  const requires = readRecord(openclaw.requires);
  const requiredKeys = new Set(
    [...readStringArray(requires.env), readString(openclaw.primaryEnv)]
      .filter(Boolean)
      .map(key => key.toUpperCase()),
  );

  const fieldsByKey = new Map<string, SkillConfigField>();
  const addKey = (keyValue: unknown, rawField?: Record<string, unknown>) => {
    const key = readString(keyValue).toUpperCase();
    if (!ENV_KEY_PATTERN.test(key)) return;

    const sensitive = rawField?.sensitive === true || SECRET_KEY_PATTERN.test(key);
    const required = rawField?.required === true || requiredKeys.has(key);
    const description = normalizeText(rawField?.description);
    fieldsByKey.set(key, {
      key,
      type: sensitive ? SkillConfigFieldType.Secret : SkillConfigFieldType.Text,
      required,
      label: key,
      ...(description ? { description } : {}),
    });
  };

  for (const rawEnv of readStringArray(requires.env)) {
    addKey(rawEnv);
  }
  const primaryEnv = readString(openclaw.primaryEnv);
  if (primaryEnv) {
    addKey(primaryEnv);
  }
  if (Array.isArray(openclaw.env)) {
    for (const rawEnvField of openclaw.env) {
      if (!isRecord(rawEnvField)) continue;
      addKey(rawEnvField.name ?? rawEnvField.key, rawEnvField);
    }
  }

  const fields = Array.from(fieldsByKey.values());
  if (fields.length === 0) return undefined;
  return { fields };
};

export const getSkillConfigCompletion = (
  schema: SkillConfigSchema | undefined,
  config: Record<string, string>,
): SkillConfigCompletion => {
  const fields = schema?.fields ?? [];
  const missingRequiredKeys = fields
    .filter(field => field.required && !(config[field.key] ?? '').trim())
    .map(field => field.key);

  return {
    hasFields: fields.length > 0,
    configured: fields.length > 0 && missingRequiredKeys.length === 0,
    missingRequiredKeys,
  };
};
