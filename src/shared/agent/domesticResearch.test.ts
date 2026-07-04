import { describe, expect, test } from 'vitest';

import {
  buildDefaultDomesticResearchConfig,
  createDefaultDomesticResearchCustomSource,
  DomesticResearchSourceId,
  DomesticResearchStatus,
  getDomesticResearchSourceStatuses,
  normalizeDomesticResearchConfig,
} from './domesticResearch';

describe('domestic research settings', () => {
  test('builds stable default source capabilities', () => {
    const config = buildDefaultDomesticResearchConfig();

    expect(config.sources[DomesticResearchSourceId.Douyin].enabled).toBe(true);
    expect(config.sources[DomesticResearchSourceId.Douyin].modes).toEqual(['url_import']);
    expect(config.sources[DomesticResearchSourceId.Douyin].urls).toEqual([]);
    expect(config.sources[DomesticResearchSourceId.Bilibili].modes).toEqual(['search', 'url_import']);
  });

  test('normalizes unknown source data while preserving known toggles', () => {
    const config = normalizeDomesticResearchConfig({
      sources: {
        douyin: { enabled: false },
        bilibili: { enabled: true },
        unknown: { enabled: true },
      },
    });

    expect(config.sources.douyin.enabled).toBe(false);
    expect(config.sources.bilibili.enabled).toBe(true);
    expect(Object.keys(config.sources)).not.toContain('unknown');
  });

  test('normalizes custom link-import sources', () => {
    const config = normalizeDomesticResearchConfig({
      customSources: [
        {
          id: 'custom-factory-forum',
          name: '行业论坛',
          enabled: true,
          urls: [
            ' https://example.com/topic ',
            '',
            'https://example.com/topic',
            'not-a-url',
          ],
        },
      ],
    });

    expect(config.customSources).toEqual([
      {
        id: 'custom-factory-forum',
        name: '行业论坛',
        enabled: true,
        modes: ['url_import'],
        urls: ['https://example.com/topic'],
      },
    ]);
  });

  test('normalizes built-in source links for link import', () => {
    const config = normalizeDomesticResearchConfig({
      sources: {
        xiaohongshu: {
          enabled: true,
          modes: ['url_import'],
          urls: [
            ' https://www.xiaohongshu.com/explore/abc ',
            'https://www.xiaohongshu.com/explore/abc',
            'not-a-url',
            'ftp://example.com/file',
          ],
        },
      },
    });

    expect(config.sources.xiaohongshu.urls).toEqual([
      'https://www.xiaohongshu.com/explore/abc',
    ]);
  });

  test('creates a blank custom source for link import', () => {
    expect(createDefaultDomesticResearchCustomSource('custom-1')).toEqual({
      id: 'custom-1',
      name: '',
      enabled: true,
      modes: ['url_import'],
      urls: [],
    });
  });

  test('returns user-facing status summaries', () => {
    const statuses = getDomesticResearchSourceStatuses(buildDefaultDomesticResearchConfig());

    expect(statuses.douyin.status).toBe(DomesticResearchStatus.LinkImportOnly);
    expect(statuses.bilibili.status).toBe(DomesticResearchStatus.Available);
  });
});
