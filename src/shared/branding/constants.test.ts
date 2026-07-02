import { describe, expect, test } from 'vitest';

import {
  DistributionBrand,
  ProductBrand,
  RuntimeBrand,
} from './constants';

describe('branding constants', () => {
  test('uses Yuzhh product and company identity', () => {
    expect(ProductBrand.NameZh).toBe('宇智汇和 AI 助手');
    expect(ProductBrand.CompanyNameZh).toBe('宇智汇和（东莞）科技有限公司');
    expect(ProductBrand.AppId).toBe('com.yuzhh.ai-assistant');
    expect(ProductBrand.Protocol).toBe('yuzhhai');
  });

  test('uses Yuzhh Runtime as the packaged runtime identity', () => {
    expect(RuntimeBrand.DisplayNameZh).toBe('宇智汇和运行时');
    expect(RuntimeBrand.DisplayNameEn).toBe('Yuzhh Runtime');
    expect(RuntimeBrand.BundleDirName).toBe('yuzhh-runtime');
    expect(RuntimeBrand.LegacyBundleDirName).toBe('cfmind');
    expect(RuntimeBrand.UpstreamName).toBe('OpenClaw');
  });

  test('keeps manual download as the first release update strategy', () => {
    expect(DistributionBrand.AutomaticUpdatesEnabled).toBe(false);
    expect(DistributionBrand.DownloadUrl).toBe('https://www.yuzhh.com/download');
  });
});
