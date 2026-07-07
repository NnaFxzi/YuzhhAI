import { describe, expect, test } from 'vitest';

import {
  getSkillsResearchCapabilityCards,
  SkillsResearchCapabilityActionTarget,
  SkillsResearchCapabilityKind,
} from './skillsResearchCapabilityCards';

describe('skills research capability cards', () => {
  test('surfaces research tools without treating them as deletable Skills', () => {
    const cards = getSkillsResearchCapabilityCards();

    expect(cards.map(card => card.kind)).toEqual([
      SkillsResearchCapabilityKind.ExternalResearch,
      SkillsResearchCapabilityKind.Browser,
    ]);
    expect(cards.every(card => card.managedAsSkill === false)).toBe(true);
    expect(cards.every(card => card.listCard === true)).toBe(true);
    expect(cards[0].toolNames).toEqual([
      'lobsterai_external_research_search',
      'lobsterai_external_research_extract',
    ]);
    expect(cards[0].actionLabelKey).toBe('skillsResearchExternalAction');
    expect(cards[0].actionTarget).toBe('external-research-settings');
    expect(cards[1].toolNames).toEqual(['browser']);
    expect(cards[1].actionTarget).toBe(SkillsResearchCapabilityActionTarget.BrowserSettings);
  });
});
