import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  buildDefaultDomesticResearchConfig,
  DomesticResearchSourceId,
  DomesticResearchStatus,
} from '../shared/agent/domesticResearch';
import { AgentDomesticResearchService } from './agentDomesticResearchService';

const store = {
  getAgentSettings: vi.fn(),
  saveAgentSettings: vi.fn(),
};

beforeEach(() => {
  vi.restoreAllMocks();
  store.getAgentSettings.mockReset();
  store.saveAgentSettings.mockReset();
});

describe('AgentDomesticResearchService', () => {
  test('returns source status payload for an agent', () => {
    store.getAgentSettings.mockReturnValue(buildDefaultDomesticResearchConfig());
    const service = new AgentDomesticResearchService({ store });

    const payload = service.getStatusPayload('agent-a');

    expect(payload.settings.sources.douyin.enabled).toBe(true);
    expect(payload.statuses.douyin.status).toBe(DomesticResearchStatus.LinkImportOnly);
    expect(payload.statuses.bilibili.status).toBe(DomesticResearchStatus.Available);
  });

  test('saves normalized source settings', () => {
    const saved = buildDefaultDomesticResearchConfig();
    store.saveAgentSettings.mockReturnValue(saved);
    const service = new AgentDomesticResearchService({ store });

    const result = service.saveSettings('agent-a', {
      sources: {
        douyin: { enabled: false },
        unknown: { enabled: true },
      },
    });

    expect(result.sources.douyin.enabled).toBe(true);
    expect(store.saveAgentSettings).toHaveBeenCalledWith('agent-a', expect.objectContaining({
      sources: expect.objectContaining({
        douyin: expect.objectContaining({ enabled: false }),
      }),
    }));
  });

  test('searches Bilibili through the public video search endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: {
          result: [
            {
              title: '<em class="keyword">自动化</em>设备厂案例',
              arcurl: 'https://www.bilibili.com/video/BV123',
              author: '工业观察',
              description: '精密支架生产线',
              pubdate: 1710000000,
            },
          ],
        },
      }),
    });
    const service = new AgentDomesticResearchService({ store, fetch: fetchMock });

    const result = await service.domesticSearch(
      DomesticResearchSourceId.Bilibili,
      '自动化设备厂 精密支架',
      2,
    );

    expect(result).toEqual({
      sourceId: DomesticResearchSourceId.Bilibili,
      query: '自动化设备厂 精密支架',
      status: 'completed',
      searchUrl: expect.stringContaining('search_type=video'),
      results: [
        {
          title: '自动化设备厂案例',
          url: 'https://www.bilibili.com/video/BV123',
          author: '工业观察',
          description: '精密支架生产线',
          publishedAt: '2024-03-09T16:00:00.000Z',
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://api.bilibili.com/x/web-interface/search/type'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.any(String),
        }),
      }),
    );
  });

  test('returns a public search URL for WeChat official account discovery', async () => {
    const fetchMock = vi.fn();
    const service = new AgentDomesticResearchService({ store, fetch: fetchMock });

    const result = await service.domesticSearch(
      DomesticResearchSourceId.WeChatOfficialAccounts,
      '自动化设备厂 精密支架',
      5,
    );

    expect(result).toEqual({
      sourceId: DomesticResearchSourceId.WeChatOfficialAccounts,
      query: '自动化设备厂 精密支架',
      maxResults: 5,
      status: 'search_url_only',
      searchUrl: expect.stringContaining('https://weixin.sogou.com/weixin'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
