import {
  type ExternalResearchConfig,
  type ExternalResearchEditConfig,
  type ExternalResearchProviderConfig,
  ExternalResearchProviderId,
  type ExternalResearchProviderId as ExternalResearchProviderIdValue,
  type ExternalResearchProviderTestInput,
  type MaskedExternalResearchConfig,
  redactExternalResearchSecret,
} from '../shared/agent/externalResearch';

interface StoreLike {
  getAppDefaults(): ExternalResearchConfig;
  getEffectiveSettings(agentId: string): ExternalResearchConfig;
  getMaskedAgentSettings(agentId: string): MaskedExternalResearchConfig;
  getMaskedAppDefaults(): MaskedExternalResearchConfig;
  saveAgentSettingsEdit(
    agentId: string,
    config: ExternalResearchEditConfig,
  ): ExternalResearchConfig;
  saveAppDefaultsEdit(config: ExternalResearchEditConfig): ExternalResearchConfig;
}

export interface TestProviderResult {
  ok: boolean;
  message: string;
}

interface AvailabilityProviderSummary {
  enabled: boolean;
  configured: boolean;
  available: boolean;
}

export interface ExternalResearchAvailability {
  providers: Record<ExternalResearchProviderIdValue, AvailabilityProviderSummary>;
}

type FetchLike = typeof fetch;

export class AgentExternalResearchService {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: { store: StoreLike; fetch?: FetchLike }) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  getMaskedAppDefaults(): MaskedExternalResearchConfig {
    return this.options.store.getMaskedAppDefaults();
  }

  getMaskedAgentSettings(agentId: string): MaskedExternalResearchConfig {
    return this.options.store.getMaskedAgentSettings(agentId);
  }

  saveAppDefaults(config: ExternalResearchEditConfig): MaskedExternalResearchConfig {
    this.options.store.saveAppDefaultsEdit(config);
    return this.getMaskedAppDefaults();
  }

  saveAgentSettings(
    agentId: string,
    config: ExternalResearchEditConfig,
  ): MaskedExternalResearchConfig {
    this.options.store.saveAgentSettingsEdit(agentId, config);
    return this.getMaskedAgentSettings(agentId);
  }

  getEffectiveSettings(agentId: string): ExternalResearchConfig {
    return this.options.store.getEffectiveSettings(agentId);
  }

  getAvailability(agentId: string): ExternalResearchAvailability {
    const effective = this.getEffectiveSettings(agentId);
    return {
      providers: {
        tavily: this.toProviderAvailability(effective.providers.tavily),
        firecrawl: this.toProviderAvailability(effective.providers.firecrawl),
      },
    };
  }

  async testProvider(input: ExternalResearchProviderTestInput): Promise<TestProviderResult> {
    const apiKey = this.resolveProviderTestApiKey(input);
    if (!apiKey) {
      return { ok: false, message: 'API key is empty.' };
    }

    try {
      if (input.providerId === ExternalResearchProviderId.Tavily) {
        await this.postJson('https://api.tavily.com/search', apiKey, {
          query: 'LobsterAI connection test',
          search_depth: 'basic',
          max_results: 1,
          include_answer: false,
        });
      } else {
        await this.postJson('https://api.firecrawl.dev/v2/search', apiKey, {
          query: 'LobsterAI connection test',
          limit: 1,
          sources: ['web'],
          timeout: 30_000,
        });
      }
      return { ok: true, message: 'Connection successful.' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: redactExternalResearchSecret(message, [apiKey]) };
    }
  }

  private resolveProviderTestApiKey(input: ExternalResearchProviderTestInput): string {
    if (input.useSavedKey) {
      const settings = input.agentId
        ? this.options.store.getEffectiveSettings(input.agentId)
        : this.options.store.getAppDefaults();
      return settings.providers[input.providerId].apiKey.trim();
    }
    return (input.apiKey ?? '').trim();
  }

  async tavilySearch(agentId: string, query: string, maxResults = 5): Promise<unknown> {
    const config = this.getEffectiveSettings(agentId).providers.tavily;
    return this.tavilySearchWithConfig(config, query, maxResults);
  }

  async tavilySearchWithConfig(
    config: ExternalResearchProviderConfig,
    query: string,
    maxResults = 5,
  ): Promise<unknown> {
    this.assertProviderReady(ExternalResearchProviderId.Tavily, config.enabled, config.apiKey);
    return this.postJson('https://api.tavily.com/search', config.apiKey, {
      query,
      search_depth: 'advanced',
      chunks_per_source: 3,
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
      country: 'china',
    });
  }

  async tavilyExtract(agentId: string, urls: string[], query?: string): Promise<unknown> {
    const config = this.getEffectiveSettings(agentId).providers.tavily;
    return this.tavilyExtractWithConfig(config, urls, query);
  }

  async tavilyExtractWithConfig(
    config: ExternalResearchProviderConfig,
    urls: string[],
    query?: string,
  ): Promise<unknown> {
    this.assertProviderReady(ExternalResearchProviderId.Tavily, config.enabled, config.apiKey);
    return this.postJson('https://api.tavily.com/extract', config.apiKey, {
      urls,
      ...(query ? { query, chunks_per_source: 3 } : {}),
      extract_depth: 'basic',
    });
  }

  async firecrawlSearch(agentId: string, query: string, limit = 5): Promise<unknown> {
    const config = this.getEffectiveSettings(agentId).providers.firecrawl;
    return this.firecrawlSearchWithConfig(config, query, limit);
  }

  async firecrawlSearchWithConfig(
    config: ExternalResearchProviderConfig,
    query: string,
    maxResults = 5,
  ): Promise<unknown> {
    this.assertProviderReady(ExternalResearchProviderId.Firecrawl, config.enabled, config.apiKey);
    return this.postJson('https://api.firecrawl.dev/v2/search', config.apiKey, {
      query,
      limit: maxResults,
      sources: ['web'],
      country: 'CN',
      timeout: 60_000,
    });
  }

  async firecrawlScrape(agentId: string, url: string): Promise<unknown> {
    const config = this.getEffectiveSettings(agentId).providers.firecrawl;
    return this.firecrawlScrapeWithConfig(config, url);
  }

  async firecrawlScrapeWithConfig(
    config: ExternalResearchProviderConfig,
    url: string,
  ): Promise<unknown> {
    this.assertProviderReady(ExternalResearchProviderId.Firecrawl, config.enabled, config.apiKey);
    return this.postJson('https://api.firecrawl.dev/v2/scrape', config.apiKey, {
      url,
      formats: ['markdown'],
      onlyMainContent: true,
      timeout: 60_000,
    });
  }

  private toProviderAvailability(provider: {
    enabled: boolean;
    apiKey: string;
  }): AvailabilityProviderSummary {
    const configured = provider.apiKey.trim().length > 0;
    return { enabled: provider.enabled, configured, available: provider.enabled && configured };
  }

  private assertProviderReady(
    providerId: ExternalResearchProviderIdValue,
    enabled: boolean,
    apiKey: string,
  ): void {
    if (!enabled || !apiKey.trim()) {
      throw new Error(
        `${providerId} is not configured. Open the agent external research settings to enable it.`,
      );
    }
  }

  private async postJson(
    url: string,
    apiKey: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      const message = `${url} HTTP ${response.status}: ${text.trim() || response.statusText}`;
      throw new Error(redactExternalResearchSecret(message, [apiKey]));
    }
    return text.trim() ? (JSON.parse(text) as unknown) : {};
  }
}
