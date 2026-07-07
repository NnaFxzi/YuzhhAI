import { describe, expect, test } from 'vitest';

import {
  getDefaultSkillsManagerTab,
  getSkillsManagerTabLabelKey,
  getSkillsManagerTabs,
  SkillsManagerTab,
} from './skillsManagerTabs';

describe('skills manager tabs', () => {
  test('places built-in research tools after regular skill tabs', () => {
    expect(getSkillsManagerTabs()).toEqual([
      SkillsManagerTab.Installed,
      SkillsManagerTab.Marketplace,
      SkillsManagerTab.Research,
    ]);
    expect(getDefaultSkillsManagerTab()).toBe(SkillsManagerTab.Installed);
    expect(getSkillsManagerTabLabelKey(SkillsManagerTab.Research)).toBe(
      'skillsResearchCapabilitiesTitle',
    );
  });
});
