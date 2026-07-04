import {
  buildDefaultDomesticResearchConfig,
  DomesticResearchMode,
  DomesticResearchSourceIds,
} from '@shared/agent/domesticResearch';
import { describe, expect, test } from 'vitest';

import {
  applyDomesticResearchBulkAction,
  DomesticResearchBulkAction,
  getDomesticResearchSourceCount,
} from './agentDomesticResearchUi';

describe('agent domestic research UI helpers', () => {
  test('counts enabled built-in and custom sources', () => {
    const config = buildDefaultDomesticResearchConfig();
    config.sources.xiaohongshu.enabled = false;
    config.customSources = [{
      id: 'custom-1',
      name: '竞品案例',
      enabled: true,
      modes: ['url_import'],
      urls: [],
    }];

    expect(getDomesticResearchSourceCount(config)).toEqual({
      enabled: DomesticResearchSourceIds.length,
      total: DomesticResearchSourceIds.length + config.customSources.length,
    });
  });

  test('handles configs without custom sources', () => {
    const config = {
      sources: buildDefaultDomesticResearchConfig().sources,
    } as ReturnType<typeof buildDefaultDomesticResearchConfig>;

    expect(getDomesticResearchSourceCount(config)).toEqual({
      enabled: DomesticResearchSourceIds.length,
      total: DomesticResearchSourceIds.length,
    });

    const disabled = applyDomesticResearchBulkAction(config, DomesticResearchBulkAction.DisableAll);
    expect(disabled.customSources).toEqual([]);
    expect(Object.values(disabled.sources).every(source => !source.enabled)).toBe(true);
  });

  test('enables recommended searchable sources and leaves custom sources unchanged', () => {
    const config = buildDefaultDomesticResearchConfig();
    config.customSources = [{
      id: 'custom-1',
      name: '竞品案例',
      enabled: false,
      modes: ['url_import'],
      urls: ['https://example.com/research'],
    }];
    const originalConfig = structuredClone(config);

    const next = applyDomesticResearchBulkAction(config, DomesticResearchBulkAction.Recommended);

    for (const sourceId of DomesticResearchSourceIds) {
      expect(next.sources[sourceId].enabled).toBe(config.sources[sourceId].modes.includes(DomesticResearchMode.Search));
    }
    expect(next.customSources).toEqual([{
      id: 'custom-1',
      name: '竞品案例',
      enabled: false,
      modes: ['url_import'],
      urls: ['https://example.com/research'],
    }]);
    expect(config).toEqual(originalConfig);
  });

  test('enables and disables all built-in and custom sources', () => {
    const config = buildDefaultDomesticResearchConfig();
    config.customSources = [{
      id: 'custom-1',
      name: '竞品案例',
      enabled: false,
      modes: ['url_import'],
      urls: [],
    }];

    const allEnabled = applyDomesticResearchBulkAction(config, DomesticResearchBulkAction.EnableAll);
    expect(Object.values(allEnabled.sources).every(source => source.enabled)).toBe(true);
    expect(allEnabled.customSources[0].enabled).toBe(true);

    const allDisabled = applyDomesticResearchBulkAction(allEnabled, DomesticResearchBulkAction.DisableAll);
    expect(Object.values(allDisabled.sources).every(source => !source.enabled)).toBe(true);
    expect(allDisabled.customSources[0].enabled).toBe(false);
  });
});
