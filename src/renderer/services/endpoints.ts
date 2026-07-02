/**
 * 集中管理所有业务 API 端点。
 * 后续新增的业务接口也应在此文件中配置。
 */

import {
  isLegacyCloudEnabled,
  LocalIndependentCloud,
} from '../../shared/cloudCapabilities/constants';
import { configService } from './config';

export const isTestModeEnabled = () => {
  return configService.getConfig().app?.testMode === true;
};

export { isLegacyCloudEnabled };

// 自动更新
export const getUpdateCheckUrl = () => LocalIndependentCloud.DisabledEndpoint;

// 手动检查更新
export const getManualUpdateCheckUrl = () => LocalIndependentCloud.DisabledEndpoint;

export const getFallbackDownloadUrl = () => LocalIndependentCloud.DownloadUrl;

// Skill 商店
export const getSkillStoreUrl = () => LocalIndependentCloud.DisabledEndpoint;

// Kit 商店
export const getKitStoreUrl = () => LocalIndependentCloud.DisabledEndpoint;

// 登录地址
export const getLoginOvermindUrl = () => LocalIndependentCloud.DisabledEndpoint;

export const PortalPricingKeyfrom = {
  HtmlShare: 'html_share',
} as const;

export type PortalPricingKeyfrom =
  (typeof PortalPricingKeyfrom)[keyof typeof PortalPricingKeyfrom];

const appendKeyfrom = (url: string, keyfrom?: string): string =>
  keyfrom ? `${url}?keyfrom=${encodeURIComponent(keyfrom)}` : url;

export const getPortalLoginUrl = () => LocalIndependentCloud.AccountUrl;
export const getPortalPricingUrl = (keyfrom?: PortalPricingKeyfrom) => (
  appendKeyfrom(LocalIndependentCloud.PricingUrl, keyfrom)
);
export const getPortalProfileUrl = () => LocalIndependentCloud.AccountUrl;
export const getPortalRechargeUrl = () => LocalIndependentCloud.PricingUrl;
export const getPortalInvitationUrl = () => LocalIndependentCloud.CommunityUrl;
export const getPortalCreditsResetActivityUrl = () => LocalIndependentCloud.PricingUrl;
