import { describe, expect, test } from 'vitest';

import {
  CoworkPromptAddMenuItemId,
  getCoworkPromptAddMenuItemIds,
  isCoworkPromptSkillMenuEnabled,
} from './promptCapabilityMenu';

describe('prompt capability menu', () => {
  test('hides direct Skill selection from the Cowork prompt menu', () => {
    expect(isCoworkPromptSkillMenuEnabled()).toBe(false);
    expect(getCoworkPromptAddMenuItemIds()).toEqual([
      CoworkPromptAddMenuItemId.File,
      CoworkPromptAddMenuItemId.PlanMode,
    ]);
    expect(getCoworkPromptAddMenuItemIds()).not.toContain(CoworkPromptAddMenuItemId.Skill);
  });
});
