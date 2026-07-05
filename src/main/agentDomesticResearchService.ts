import {
  type DomesticResearchConfig,
  DomesticResearchSourceId,
  type DomesticResearchSourceId as DomesticResearchSourceIdValue,
  type DomesticResearchStatusMap,
  getDomesticResearchSourceStatuses,
  normalizeDomesticResearchConfig,
} from '../shared/agent/domesticResearch';

interface StoreLike {
  getAgentSettings(agentId: string): DomesticResearchConfig;
  saveAgentSettings(agentId: string, config: DomesticResearchConfig): DomesticResearchConfig;
}

export interface DomesticResearchStatusPayload {
  settings: DomesticResearchConfig;
  statuses: DomesticResearchStatusMap;
}

export const DomesticResearchSearchStatus = {
  Completed: 'completed',
  SearchUrlOnly: 'search_url_only',
  LinkImportOnly: 'link_import_only',
} as const;
export type DomesticResearchSearchStatus =
  typeof DomesticResearchSearchStatus[keyof typeof DomesticResearchSearchStatus];

interface DomesticResearchSearchResultItem {
  title: string;
  url: string;
  author?: string;
  description?: string;
  publishedAt?: string;
}

export type DomesticResearchSearchPayload =
  | {
    sourceId: DomesticResearchSourceIdValue;
    query: string;
    status: typeof DomesticResearchSearchStatus.Completed;
    searchUrl: string;
    results: DomesticResearchSearchResultItem[];
  }
  | {
    sourceId: DomesticResearchSourceIdValue;
    query: string;
    maxResults: number;
    status: typeof DomesticResearchSearchStatus.SearchUrlOnly;
    searchUrl: string;
  }
  | {
    sourceId: string;
    query: string;
    maxResults: number;
    status: typeof DomesticResearchSearchStatus.LinkImportOnly;
  };

type FetchLike = typeof fetch;

const BILIBILI_SEARCH_ENDPOINT = 'https://api.bilibili.com/x/web-interface/search/type';
const WECHAT_OFFICIAL_SEARCH_ENDPOINT = 'https://weixin.sogou.com/weixin';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) LobsterAI/1.0 Safari/537.36';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const cleanText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const cleanHtmlText = (value: unknown): string =>
  cleanText(value)
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const clampMaxResults = (maxResults: number): number =>
  Math.min(Math.max(Math.floor(maxResults) || 5, 1), 20);

const buildBilibiliSearchUrl = (query: string, maxResults: number): string => {
  const url = new URL(BILIBILI_SEARCH_ENDPOINT);
  url.searchParams.set('search_type', 'video');
  url.searchParams.set('keyword', query);
  url.searchParams.set('page', '1');
  url.searchParams.set('page_size', String(clampMaxResults(maxResults)));
  return url.toString();
};

const buildWeChatOfficialSearchUrl = (query: string): string => {
  const url = new URL(WECHAT_OFFICIAL_SEARCH_ENDPOINT);
  url.searchParams.set('type', '2');
  url.searchParams.set('query', query);
  return url.toString();
};

export class AgentDomesticResearchService {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: { store: StoreLike; fetch?: FetchLike }) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  getSettings(agentId: string): DomesticResearchConfig {
    return this.options.store.getAgentSettings(agentId);
  }

  saveSettings(agentId: string, config: unknown): DomesticResearchConfig {
    const normalized = normalizeDomesticResearchConfig(config);
    return this.options.store.saveAgentSettings(agentId, normalized);
  }

  getStatusPayload(agentId: string): DomesticResearchStatusPayload {
    const settings = this.getSettings(agentId);
    return {
      settings,
      statuses: getDomesticResearchSourceStatuses(settings),
    };
  }

  async domesticSearch(
    sourceId: string,
    query: string,
    maxResults = 5,
  ): Promise<DomesticResearchSearchPayload> {
    const trimmedQuery = query.trim();
    if (sourceId === DomesticResearchSourceId.Bilibili) {
      return this.searchBilibili(trimmedQuery, maxResults);
    }
    if (sourceId === DomesticResearchSourceId.WeChatOfficialAccounts) {
      return {
        sourceId,
        query: trimmedQuery,
        maxResults,
        status: DomesticResearchSearchStatus.SearchUrlOnly,
        searchUrl: buildWeChatOfficialSearchUrl(trimmedQuery),
      };
    }
    return {
      sourceId,
      query: trimmedQuery,
      maxResults,
      status: DomesticResearchSearchStatus.LinkImportOnly,
    };
  }

  private async searchBilibili(
    query: string,
    maxResults: number,
  ): Promise<DomesticResearchSearchPayload> {
    const searchUrl = buildBilibiliSearchUrl(query, maxResults);
    const response = await this.fetchImpl(searchUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': DEFAULT_USER_AGENT,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${BILIBILI_SEARCH_ENDPOINT} HTTP ${response.status}: ${text.trim() || response.statusText}`);
    }
    const payload = text.trim() ? JSON.parse(text) as unknown : {};
    const data = isRecord(payload) ? payload.data : undefined;
    const rawResults = isRecord(data) && Array.isArray(data.result) ? data.result : [];
    return {
      sourceId: DomesticResearchSourceId.Bilibili,
      query,
      status: DomesticResearchSearchStatus.Completed,
      searchUrl,
      results: rawResults
        .slice(0, clampMaxResults(maxResults))
        .map(item => this.toBilibiliResultItem(item))
        .filter((item): item is DomesticResearchSearchResultItem => Boolean(item)),
    };
  }

  private toBilibiliResultItem(value: unknown): DomesticResearchSearchResultItem | null {
    const record = isRecord(value) ? value : {};
    const title = cleanHtmlText(record.title);
    const url = cleanText(record.arcurl) || cleanText(record.url);
    if (!title || !url) {
      return null;
    }
    const author = cleanText(record.author);
    const description = cleanHtmlText(record.description);
    const pubdate = typeof record.pubdate === 'number' && Number.isFinite(record.pubdate)
      ? record.pubdate
      : undefined;
    return {
      title,
      url,
      ...(author ? { author } : {}),
      ...(description ? { description } : {}),
      ...(pubdate ? { publishedAt: new Date(pubdate * 1000).toISOString() } : {}),
    };
  }
}
