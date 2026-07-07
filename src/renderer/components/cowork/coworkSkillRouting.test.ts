import { describe, expect, test } from 'vitest';

import { buildCoworkRuntimeSkillSelection } from './coworkSkillRouting';

const skill = (id: string, options: { enabled?: boolean; skillPath?: string } = {}) => ({
  id,
  enabled: options.enabled ?? true,
  skillPath: options.skillPath ?? `/skills/${id}/SKILL.md`,
});

describe('buildCoworkRuntimeSkillSelection', () => {
  test('routes manually selected skills in normal chat', () => {
    expect(
      buildCoworkRuntimeSkillSelection({
        selectedSkillIds: ['web-search'],
        kitSkillIds: [],
        skills: [skill('web-search'), skill('docx')],
      }),
    ).toEqual({
      directSkillIds: ['web-search'],
      runtimeSkillIds: ['web-search'],
    });
  });

  test('does not route every enabled skill by default inside an enterprise workspace', () => {
    expect(
      buildCoworkRuntimeSkillSelection({
        selectedSkillIds: [],
        kitSkillIds: [],
        skills: [
          skill('web-search'),
          skill('docx'),
          skill('disabled-skill', { enabled: false }),
          skill('missing-path', { skillPath: ' ' }),
        ],
      }),
    ).toEqual({
      directSkillIds: [],
      runtimeSkillIds: [],
    });
  });

  test('deduplicates selected, kit, and default runtime skills', () => {
    expect(
      buildCoworkRuntimeSkillSelection({
        selectedSkillIds: ['docx', 'web-search'],
        kitSkillIds: ['web-search', 'xlsx'],
        skills: [skill('web-search'), skill('docx'), skill('xlsx')],
      }),
    ).toEqual({
      directSkillIds: ['docx', 'web-search'],
      runtimeSkillIds: ['docx', 'web-search', 'xlsx'],
    });
  });
});
