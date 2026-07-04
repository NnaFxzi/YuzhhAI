export const DomesticResearchSourceId = {
  Xiaohongshu: 'xiaohongshu',
  Douyin: 'douyin',
  Kuaishou: 'kuaishou',
  WeChatChannels: 'wechat_channels',
  Bilibili: 'bilibili',
  WeChatOfficialAccounts: 'wechat_official_accounts',
} as const;

export type DomesticResearchSourceId =
  typeof DomesticResearchSourceId[keyof typeof DomesticResearchSourceId];

export const DomesticResearchSourceIds = [
  DomesticResearchSourceId.Xiaohongshu,
  DomesticResearchSourceId.Douyin,
  DomesticResearchSourceId.Kuaishou,
  DomesticResearchSourceId.WeChatChannels,
  DomesticResearchSourceId.Bilibili,
  DomesticResearchSourceId.WeChatOfficialAccounts,
] as const;

export const DomesticResearchMode = {
  Search: 'search',
  UrlImport: 'url_import',
} as const;

export type DomesticResearchMode =
  typeof DomesticResearchMode[keyof typeof DomesticResearchMode];

export const DomesticResearchStatus = {
  Available: 'available',
  LinkImportOnly: 'link_import_only',
  NeedsLogin: 'needs_login',
  Limited: 'limited',
  Unsupported: 'unsupported',
} as const;

export type DomesticResearchStatus =
  typeof DomesticResearchStatus[keyof typeof DomesticResearchStatus];

export interface DomesticResearchSourceConfig {
  enabled: boolean;
  modes: DomesticResearchMode[];
  urls: string[];
}

export interface DomesticResearchCustomSourceConfig extends DomesticResearchSourceConfig {
  id: string;
  name: string;
}

export interface DomesticResearchConfig {
  sources: Record<DomesticResearchSourceId, DomesticResearchSourceConfig>;
  customSources: DomesticResearchCustomSourceConfig[];
}

export interface DomesticResearchSourceStatus {
  sourceId: DomesticResearchSourceId;
  enabled: boolean;
  status: DomesticResearchStatus;
  modes: DomesticResearchMode[];
  limitations: string[];
}

export type DomesticResearchStatusMap =
  Record<DomesticResearchSourceId, DomesticResearchSourceStatus>;

const DEFAULT_SOURCE_CONFIGS: Record<DomesticResearchSourceId, DomesticResearchSourceConfig> = {
  [DomesticResearchSourceId.Xiaohongshu]: {
    enabled: true,
    modes: [DomesticResearchMode.UrlImport],
    urls: [],
  },
  [DomesticResearchSourceId.Douyin]: {
    enabled: true,
    modes: [DomesticResearchMode.UrlImport],
    urls: [],
  },
  [DomesticResearchSourceId.Kuaishou]: {
    enabled: true,
    modes: [DomesticResearchMode.UrlImport],
    urls: [],
  },
  [DomesticResearchSourceId.WeChatChannels]: {
    enabled: true,
    modes: [DomesticResearchMode.UrlImport],
    urls: [],
  },
  [DomesticResearchSourceId.Bilibili]: {
    enabled: true,
    modes: [DomesticResearchMode.Search, DomesticResearchMode.UrlImport],
    urls: [],
  },
  [DomesticResearchSourceId.WeChatOfficialAccounts]: {
    enabled: true,
    modes: [DomesticResearchMode.Search, DomesticResearchMode.UrlImport],
    urls: [],
  },
};

const SOURCE_LIMITATIONS: Record<DomesticResearchSourceId, string[]> = {
  [DomesticResearchSourceId.Xiaohongshu]: [
    'Search requires a working logged-in backend; first version always supports pasted note links.',
  ],
  [DomesticResearchSourceId.Douyin]: [
    'First version supports pasted video, account, or search-page links; automatic search is not promised.',
  ],
  [DomesticResearchSourceId.Kuaishou]: [
    'First version supports pasted video, account, or search-page links; automatic search is not promised.',
  ],
  [DomesticResearchSourceId.WeChatChannels]: [
    'First version supports pasted links or copied text when available; automatic search is not promised.',
  ],
  [DomesticResearchSourceId.Bilibili]: [
    'Search and URL import are available for public content.',
  ],
  [DomesticResearchSourceId.WeChatOfficialAccounts]: [
    'Discovery uses web search and article URL import for public articles.',
  ],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readModes = (
  value: unknown,
  fallback: DomesticResearchMode[],
): DomesticResearchMode[] => {
  if (!Array.isArray(value)) return [...fallback];
  const modes = value.filter((mode): mode is DomesticResearchMode =>
    mode === DomesticResearchMode.Search || mode === DomesticResearchMode.UrlImport);
  return modes.length > 0 ? Array.from(new Set(modes)) : [...fallback];
};

const readTrimmedString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const readUrls = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const item of value) {
    const url = readTrimmedString(item);
    if (!url || seen.has(url) || !isHttpUrl(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
};

export const createDefaultDomesticResearchCustomSource = (
  id: string,
): DomesticResearchCustomSourceConfig => ({
  id,
  name: '',
  enabled: true,
  modes: [DomesticResearchMode.UrlImport],
  urls: [],
});

export const buildDefaultDomesticResearchConfig = (): DomesticResearchConfig => ({
  sources: DomesticResearchSourceIds.reduce((sources, sourceId) => ({
    ...sources,
    [sourceId]: {
      enabled: DEFAULT_SOURCE_CONFIGS[sourceId].enabled,
      modes: [...DEFAULT_SOURCE_CONFIGS[sourceId].modes],
      urls: [...DEFAULT_SOURCE_CONFIGS[sourceId].urls],
    },
  }), {} as Record<DomesticResearchSourceId, DomesticResearchSourceConfig>),
  customSources: [],
});

export const normalizeDomesticResearchConfig = (value: unknown): DomesticResearchConfig => {
  const raw = isRecord(value) ? value : {};
  const rawSources = isRecord(raw.sources) ? raw.sources : {};
  const rawCustomSources = Array.isArray(raw.customSources) ? raw.customSources : [];
  const defaults = buildDefaultDomesticResearchConfig();

  return {
    sources: DomesticResearchSourceIds.reduce((sources, sourceId) => {
      const rawSource = isRecord(rawSources[sourceId]) ? rawSources[sourceId] : {};
      const fallback = defaults.sources[sourceId];
      return {
        ...sources,
        [sourceId]: {
          enabled: typeof rawSource.enabled === 'boolean' ? rawSource.enabled : fallback.enabled,
          modes: readModes(rawSource.modes, fallback.modes),
          urls: readUrls(rawSource.urls),
        },
      };
    }, {} as Record<DomesticResearchSourceId, DomesticResearchSourceConfig>),
    customSources: rawCustomSources
      .map((rawCustomSource): DomesticResearchCustomSourceConfig | null => {
        const customSource = isRecord(rawCustomSource) ? rawCustomSource : {};
        const id = readTrimmedString(customSource.id);
        if (!id) return null;
        return {
          id,
          name: readTrimmedString(customSource.name),
          enabled: typeof customSource.enabled === 'boolean' ? customSource.enabled : true,
          modes: readModes(customSource.modes, [DomesticResearchMode.UrlImport])
            .filter(mode => mode === DomesticResearchMode.UrlImport),
          urls: readUrls(customSource.urls),
        };
      })
      .filter((source): source is DomesticResearchCustomSourceConfig => Boolean(source))
      .map(source => ({
        ...source,
        modes: source.modes.length > 0 ? source.modes : [DomesticResearchMode.UrlImport],
      })),
  };
};

export const getDomesticResearchSourceStatuses = (
  config: DomesticResearchConfig,
): DomesticResearchStatusMap => {
  const normalized = normalizeDomesticResearchConfig(config);
  return DomesticResearchSourceIds.reduce((statuses, sourceId) => {
    const source = normalized.sources[sourceId];
    const hasSearch = source.modes.includes(DomesticResearchMode.Search);
    const hasUrlImport = source.modes.includes(DomesticResearchMode.UrlImport);
    return {
      ...statuses,
      [sourceId]: {
        sourceId,
        enabled: source.enabled,
        status: !source.enabled
          ? DomesticResearchStatus.Unsupported
          : hasSearch
            ? DomesticResearchStatus.Available
            : hasUrlImport
              ? DomesticResearchStatus.LinkImportOnly
              : DomesticResearchStatus.Unsupported,
        modes: [...source.modes],
        limitations: [...SOURCE_LIMITATIONS[sourceId]],
      },
    };
  }, {} as DomesticResearchStatusMap);
};
