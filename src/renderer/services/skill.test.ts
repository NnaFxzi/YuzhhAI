import { describe, expect, test } from 'vitest';

import { resolveSkillDescriptionForDisplay } from './skill';

describe('skill display helpers', () => {
  test('uses Chinese fallback copy for known English skill descriptions in Chinese UI', () => {
    const description = resolveSkillDescriptionForDisplay({
      fallback: 'Create distinctive, production-grade frontend interfaces with high design quality.',
      language: 'zh',
      skillId: 'frontend-design',
      skillName: 'frontend-design',
    });

    expect(description).toContain('前端');
    expect(description).toContain('界面');
  });

  test('keeps custom skill descriptions when no Chinese fallback is known', () => {
    const description = resolveSkillDescriptionForDisplay({
      fallback: 'My private workflow',
      language: 'zh',
      skillId: 'private-workflow',
      skillName: 'private-workflow',
    });

    expect(description).toBe('My private workflow');
  });
});
