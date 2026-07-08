import { describe, expect, test } from 'vitest';

import {
  getExternalResearchCapabilityConfigStatus,
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
    expect(cards[0].configSchema?.fields.map(field => field.key)).toEqual([
      'TAVILY_API_KEY',
      'FIRECRAWL_API_KEY',
    ]);
    expect(cards[0].actionLabelKey).toBe('skillsResearchExternalAction');
    expect(cards[0].actionTarget).toBe('external-research-settings');
    expect(cards[1].toolNames).toEqual(['browser']);
    expect(cards[1].actionTarget).toBe(SkillsResearchCapabilityActionTarget.BrowserSettings);
  });

  test('reports external research key configuration status from masked app defaults', () => {
    expect(getExternalResearchCapabilityConfigStatus(null)).toEqual({
      configuredCount: 0,
      enabledCount: 0,
      totalCount: 2,
      configured: false,
    });

    expect(
      getExternalResearchCapabilityConfigStatus({
        mode: 'override',
        providers: {
          tavily: { enabled: true, hasApiKey: true, apiKeyPreview: 'tvly...test' },
          firecrawl: { enabled: false, hasApiKey: false, apiKeyPreview: '' },
        },
      }),
    ).toEqual({
      configuredCount: 1,
      enabledCount: 1,
      totalCount: 2,
      configured: true,
    });

    expect(
      getExternalResearchCapabilityConfigStatus({
        mode: 'override',
        providers: {
          tavily: { enabled: false, hasApiKey: true, apiKeyPreview: 'tvly...test' },
          firecrawl: { enabled: false, hasApiKey: false, apiKeyPreview: '' },
        },
      }),
    ).toEqual({
      configuredCount: 1,
      enabledCount: 0,
      totalCount: 2,
      configured: false,
    });
  });
});
