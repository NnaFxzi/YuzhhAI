import { describe, expect, test } from 'vitest';

import {
  getSkillConfigCompletion,
  normalizeSkillConfigSchema,
  normalizeSkillConfigSchemaFromSkillFrontmatter,
  SkillConfigFieldType,
} from './config';

describe('skill config schema', () => {
  test('normalizes safe environment variable fields from skill defaults', () => {
    const schema = normalizeSkillConfigSchema({
      helpUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apikey',
      fields: [
        {
          key: 'ARK_API_KEY',
          type: 'secret',
          required: true,
          label: { zh: '火山方舟 API Key', en: 'Volcengine Ark API Key' },
          description: { zh: '用于图片和视频生成。', en: 'Used for image and video generation.' },
        },
        {
          key: 'bad-key',
          type: 'secret',
          required: true,
        },
        {
          key: 'OPTIONAL_BASE_URL',
          type: 'unsupported',
          required: false,
        },
      ],
    });

    expect(schema).toEqual({
      helpUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apikey',
      fields: [
        {
          key: 'ARK_API_KEY',
          type: SkillConfigFieldType.Secret,
          required: true,
          label: { zh: '火山方舟 API Key', en: 'Volcengine Ark API Key' },
          description: { zh: '用于图片和视频生成。', en: 'Used for image and video generation.' },
        },
        {
          key: 'OPTIONAL_BASE_URL',
          type: SkillConfigFieldType.Text,
          required: false,
        },
      ],
    });
  });

  test('normalizes OpenClaw skill metadata env declarations as config fields', () => {
    const schema = normalizeSkillConfigSchemaFromSkillFrontmatter({
      metadata: {
        openclaw: {
          requires: {
            env: ['MAXHUB_API_KEY'],
          },
          env: [
            {
              name: 'MAXHUB_API_KEY',
              description: 'API key for MaxHub data APIs. Get one at https://www.aconfig.cn',
              required: true,
              sensitive: true,
            },
          ],
        },
      },
    });

    expect(schema).toEqual({
      fields: [
        {
          key: 'MAXHUB_API_KEY',
          type: SkillConfigFieldType.Secret,
          required: true,
          label: 'MAXHUB_API_KEY',
          description: 'API key for MaxHub data APIs. Get one at https://www.aconfig.cn',
        },
      ],
    });
  });

  test('reports missing required keys without counting whitespace values', () => {
    const schema = normalizeSkillConfigSchema({
      fields: [
        { key: 'ARK_API_KEY', type: 'secret', required: true },
        { key: 'OPTIONAL_BASE_URL', type: 'url', required: false },
      ],
    });

    expect(getSkillConfigCompletion(schema, { ARK_API_KEY: '   ' })).toEqual({
      hasFields: true,
      configured: false,
      missingRequiredKeys: ['ARK_API_KEY'],
    });
    expect(getSkillConfigCompletion(schema, { ARK_API_KEY: 'sk-live' })).toEqual({
      hasFields: true,
      configured: true,
      missingRequiredKeys: [],
    });
  });
});
