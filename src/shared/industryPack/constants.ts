export const IndustryPackId = {
  HeavyPackaging: 'heavy-packaging',
} as const;
export type IndustryPackId = typeof IndustryPackId[keyof typeof IndustryPackId];

export const IndustryPackTask = {
  GenerateContentPackage: 'generate_content_package',
  GenerateCaseContent: 'generate_case_content',
  GenerateContentCalendar: 'generate_content_calendar',
} as const;
export type IndustryPackTask = typeof IndustryPackTask[keyof typeof IndustryPackTask];

export const IndustryPackChannel = {
  WechatMoments: 'wechat_moments',
  WechatGroup: 'wechat_group',
  Platform1688: '1688',
  BaiduSeo: 'baidu_seo',
  ShortVideo: 'short_video',
  Referral: 'referral',
} as const;
export type IndustryPackChannel = typeof IndustryPackChannel[keyof typeof IndustryPackChannel];

export const GeneratedAssetStatus = {
  Draft: 'draft',
  Exported: 'exported',
  Archived: 'archived',
} as const;
export type GeneratedAssetStatus = typeof GeneratedAssetStatus[keyof typeof GeneratedAssetStatus];

export const IndustryExportFormat = {
  Markdown: 'markdown',
  Excel: 'excel',
} as const;
export type IndustryExportFormat = typeof IndustryExportFormat[keyof typeof IndustryExportFormat];

export const IndustryMarketingIpc = {
  ListPacks: 'industryMarketing:packs:list',
  GetPack: 'industryMarketing:packs:get',
  GetWorkspace: 'industryMarketing:workspace:get',
  SaveFactoryProfile: 'industryMarketing:profile:saveFactory',
  SaveProductProfile: 'industryMarketing:profile:saveProduct',
  SaveCaseProfile: 'industryMarketing:profile:saveCase',
  Generate: 'industryMarketing:generate',
  ListAssets: 'industryMarketing:assets:list',
  UpdateAsset: 'industryMarketing:assets:update',
  ExportAsset: 'industryMarketing:assets:export',
} as const;
export type IndustryMarketingIpc = typeof IndustryMarketingIpc[keyof typeof IndustryMarketingIpc];
