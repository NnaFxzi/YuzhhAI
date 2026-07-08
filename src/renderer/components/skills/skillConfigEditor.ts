import type { SkillConfigSchema, SkillConfigText } from '../../../shared/skills/config';

export type SkillConfigLanguage = 'zh' | 'en';

export const resolveSkillConfigText = (
  value: SkillConfigText | undefined,
  language: SkillConfigLanguage,
): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return (language === 'zh' ? value.zh || value.en : value.en || value.zh) ?? '';
};

export const buildSkillConfigDraft = (
  schema: SkillConfigSchema | undefined,
  existingConfig: Record<string, string>,
): Record<string, string> => {
  const draft: Record<string, string> = {};
  for (const field of schema?.fields ?? []) {
    draft[field.key] = existingConfig[field.key] ?? field.defaultValue ?? '';
  }
  return draft;
};

export const getMissingRequiredSkillConfigFields = (
  schema: SkillConfigSchema | undefined,
  config: Record<string, string>,
): string[] => {
  return (schema?.fields ?? [])
    .filter(field => field.required && !(config[field.key] ?? '').trim())
    .map(field => field.key);
};
