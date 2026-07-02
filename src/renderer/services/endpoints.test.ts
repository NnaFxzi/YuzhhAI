import { afterEach, expect, test, vi } from 'vitest';

import { configService } from './config';
import {
  getFallbackDownloadUrl,
  getKitStoreUrl,
  getLoginOvermindUrl,
  getPortalCreditsResetActivityUrl,
  getPortalInvitationUrl,
  getPortalPricingUrl,
  getPortalProfileUrl,
  getPortalRechargeUrl,
  getSkillStoreUrl,
  getUpdateCheckUrl,
  isLegacyCloudEnabled,
  PortalPricingKeyfrom,
} from './endpoints';

const mockTestMode = (testMode: boolean) => {
  vi.spyOn(configService, 'getConfig').mockReturnValue({
    app: { testMode },
  } as ReturnType<typeof configService.getConfig>);
};

afterEach(() => {
  vi.restoreAllMocks();
});

test('legacy cloud endpoints are disabled by default', () => {
  mockTestMode(false);

  expect(isLegacyCloudEnabled()).toBe(false);
  expect(getUpdateCheckUrl()).toBe('');
  expect(getLoginOvermindUrl()).toBe('');
  expect(getSkillStoreUrl()).toBe('');
  expect(getKitStoreUrl()).toBe('');
  expect(getFallbackDownloadUrl()).toBe('https://www.yuzhh.com/download');
});

test('portal account urls use public Yuzhh pages in local independent mode', () => {
  mockTestMode(true);

  expect(getPortalProfileUrl()).toBe('https://www.yuzhh.com/account');
  expect(getPortalRechargeUrl()).toBe('https://www.yuzhh.com/pricing');
  expect(getPortalInvitationUrl()).toBe('https://www.yuzhh.com/community');
  expect(getPortalCreditsResetActivityUrl()).toBe('https://www.yuzhh.com/pricing');
});

test('portal pricing url can include html share keyfrom', () => {
  mockTestMode(false);

  expect(getPortalPricingUrl(PortalPricingKeyfrom.HtmlShare)).toBe(
    'https://www.yuzhh.com/pricing?keyfrom=html_share',
  );
});
