import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  AgentExternalResearchMode,
  ExternalResearchProviderId,
} from '../shared/agent/externalResearch';
import { AgentExternalResearchService } from './agentExternalResearchService';

const store = {
  getEffectiveSettings: vi.fn(),
  getMaskedAgentSettings: vi.fn(),
  getMaskedAppDefaults: vi.fn(),
  saveAgentSettingsEdit: vi.fn(),
  saveAppDefaultsEdit: vi.fn(),
};

beforeEach(() => {
  vi.restoreAllMocks();
  store.getEffectiveSettings.mockReset();
  store.getMaskedAgentSettings.mockReset();
  store.getMaskedAppDefaults.mockReset();
  store.saveAgentSettingsEdit.mockReset();
  store.saveAppDefaultsEdit.mockReset();
});

describe('AgentExternalResearchService', () => {
  test('tests Tavily with a search request and bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ results: [{ title: 'A', url: 'https://example.com', content: 'x' }] }),
    });
    const service = new AgentExternalResearchService({ store, fetch: fetchMock });

    const result = await service.testProvider({
      providerId: ExternalResearchProviderId.Tavily,
      apiKey: 'tvly-test',
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tvly-test' }),
      }),
    );
  });

  test('tests Firecrawl with a v2 search request and bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, data: { web: [] } }),
    });
    const service = new AgentExternalResearchService({ store, fetch: fetchMock });

    const result = await service.testProvider({
      providerId: ExternalResearchProviderId.Firecrawl,
      apiKey: 'fc-test',
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v2/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer fc-test' }),
      }),
    );
  });

  test('tests with the saved agent provider key when requested', async () => {
    store.getEffectiveSettings.mockReturnValue({
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: { enabled: true, apiKey: 'tvly-saved' },
        firecrawl: { enabled: false, apiKey: '' },
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ results: [] }),
    });
    const service = new AgentExternalResearchService({ store, fetch: fetchMock });

    const result = await service.testProvider({
      providerId: ExternalResearchProviderId.Tavily,
      agentId: 'agent-a',
      useSavedKey: true,
    });

    expect(result.ok).toBe(true);
    expect(store.getEffectiveSettings).toHaveBeenCalledWith('agent-a');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tvly-saved' }),
      }),
    );
  });

  test('redacts provider secrets from failed connection messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'invalid tvly-secret',
    });
    const service = new AgentExternalResearchService({ store, fetch: fetchMock });

    const result = await service.testProvider({
      providerId: ExternalResearchProviderId.Tavily,
      apiKey: 'tvly-secret',
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('[redacted]');
    expect(result.message).not.toContain('tvly-secret');
  });

  test('returns configured providers for agent without exposing api keys', () => {
    store.getEffectiveSettings.mockReturnValue({
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: { enabled: true, apiKey: 'tvly-secret' },
        firecrawl: { enabled: false, apiKey: '' },
      },
    });
    const service = new AgentExternalResearchService({ store, fetch: vi.fn() });

    const summary = service.getAvailability('agent-a');

    expect(summary.providers.tavily.available).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('tvly-secret');
  });

  test('uses Firecrawl scrape for selected urls when extracting through Firecrawl', async () => {
    store.getEffectiveSettings.mockReturnValue({
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: { enabled: false, apiKey: '' },
        firecrawl: { enabled: true, apiKey: 'fc-secret' },
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, data: { markdown: '# page' } }),
    });
    const service = new AgentExternalResearchService({ store, fetch: fetchMock });

    await service.firecrawlScrape('agent-a', 'https://example.com/page');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v2/scrape',
      expect.objectContaining({
        body: expect.stringContaining('https://example.com/page'),
      }),
    );
  });

  test('searches Tavily with a direct workspace provider config', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ results: [{ title: 'Lead', url: 'https://example.com' }] }),
    });
    const service = new AgentExternalResearchService({ store, fetch: fetchMock });

    const result = await service.tavilySearchWithConfig(
      { enabled: true, apiKey: 'tvly-workspace' },
      '重型纸箱 机械设备厂',
      3,
    );

    expect(result).toEqual({ results: [{ title: 'Lead', url: 'https://example.com' }] });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tvly-workspace' }),
        body: expect.stringContaining('"max_results":3'),
      }),
    );
  });

  test('extracts Tavily URLs with a direct workspace provider config', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ results: [{ url: 'https://example.com/a', raw_content: 'page' }] }),
    });
    const service = new AgentExternalResearchService({ store, fetch: fetchMock });

    await service.tavilyExtractWithConfig(
      { enabled: true, apiKey: 'tvly-workspace' },
      ['https://example.com/a'],
      '客户信息',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tavily.com/extract',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tvly-workspace' }),
        body: expect.stringContaining('"https://example.com/a"'),
      }),
    );
  });

  test('searches Firecrawl with a direct workspace provider config', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, data: { web: [] } }),
    });
    const service = new AgentExternalResearchService({ store, fetch: fetchMock });

    await service.firecrawlSearchWithConfig(
      { enabled: true, apiKey: 'fc-workspace' },
      '包装采购',
      2,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v2/search',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fc-workspace' }),
        body: expect.stringContaining('"limit":2'),
      }),
    );
  });

  test('scrapes Firecrawl with a direct workspace provider config', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, data: { markdown: '# page' } }),
    });
    const service = new AgentExternalResearchService({ store, fetch: fetchMock });

    await service.firecrawlScrapeWithConfig(
      { enabled: true, apiKey: 'fc-workspace' },
      'https://example.com/a',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v2/scrape',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fc-workspace' }),
        body: expect.stringContaining('"https://example.com/a"'),
      }),
    );
  });

  test('redacts direct workspace provider secrets from failed requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Authorization: Bearer tvly-workspace-secret apiKey=tvly-workspace-secret',
    });
    const service = new AgentExternalResearchService({ store, fetch: fetchMock });

    await expect(service.tavilySearchWithConfig(
      { enabled: true, apiKey: 'tvly-workspace-secret' },
      '包装采购',
    )).rejects.toThrow(/Bearer \[redacted\]/);
    await expect(service.tavilySearchWithConfig(
      { enabled: true, apiKey: 'tvly-workspace-secret' },
      '包装采购',
    )).rejects.not.toThrow('tvly-workspace-secret');
  });
});
