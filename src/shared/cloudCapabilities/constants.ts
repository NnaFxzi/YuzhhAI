export const LocalIndependentCloud = {
  LegacyCloudEnabled: false,
  DisabledEndpoint: '',
  DisabledAnalyticsEndpoint: 'https://www.yuzhh.com/analytics-disabled',
  PublicBaseUrl: 'https://www.yuzhh.com',
  DownloadUrl: 'https://www.yuzhh.com/download',
  AccountUrl: 'https://www.yuzhh.com/account',
  PricingUrl: 'https://www.yuzhh.com/pricing',
  CommunityUrl: 'https://www.yuzhh.com/community',
  DisabledMessage: '本地独立版未启用云服务，请配置自己的模型或服务。',
} as const;

export const isLegacyCloudEnabled = (): boolean => LocalIndependentCloud.LegacyCloudEnabled;

export const isCloudEndpointEnabled = (url?: string | null): boolean =>
  isLegacyCloudEnabled() && Boolean(url?.trim());
