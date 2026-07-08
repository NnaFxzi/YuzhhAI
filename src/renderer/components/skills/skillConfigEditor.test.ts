import { describe, expect, test } from 'vitest';

import { SkillConfigFieldType, type SkillConfigSchema } from '../../../shared/skills/config';
import {
  buildSkillConfigDraft,
  getMissingRequiredSkillConfigFields,
  resolveSkillConfigText,
} from './skillConfigEditor';

const schema: SkillConfigSchema = {
  fields: [
    {
      key: 'ARK_API_KEY',
      type: SkillConfigFieldType.Secret,
      required: true,
      label: { zh: '火山方舟 API Key', en: 'Volcengine Ark API Key' },
      defaultValue: '',
    },
    {
      key: 'OPTIONAL_BASE_URL',
      type: SkillConfigFieldType.Url,
      required: false,
      defaultValue: 'https://ark.cn-beijing.volces.com/api/v3',
    },
  ],
};

describe('skill config editor helpers', () => {
  test('builds a draft from existing config and schema defaults', () => {
    expect(buildSkillConfigDraft(schema, { ARK_API_KEY: 'sk-live' })).toEqual({
      ARK_API_KEY: 'sk-live',
      OPTIONAL_BASE_URL: 'https://ark.cn-beijing.volces.com/api/v3',
    });
  });

  test('finds missing required fields from whitespace values', () => {
    expect(getMissingRequiredSkillConfigFields(schema, { ARK_API_KEY: ' ' })).toEqual([
      'ARK_API_KEY',
    ]);
  });

  test('resolves localized text with language fallback', () => {
    expect(resolveSkillConfigText({ zh: '中文', en: 'English' }, 'zh')).toBe('中文');
    expect(resolveSkillConfigText({ en: 'English' }, 'zh')).toBe('English');
    expect(resolveSkillConfigText('Plain', 'en')).toBe('Plain');
  });
});
