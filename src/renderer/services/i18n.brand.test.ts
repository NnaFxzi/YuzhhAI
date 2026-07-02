import { describe, expect, test } from 'vitest';

import {
  APP_ID,
  APP_NAME,
  APP_PROTOCOL,
  EXPORT_FORMAT_TYPE,
  EXPORT_PASSWORD,
} from '../constants/app';
import { i18nService } from './i18n';

const PRODUCT_NAME = '宇智汇和 AI 助手';
const COMPANY_NAME = '宇智汇和（东莞）科技有限公司';

describe('product branding translations', () => {
  test('uses the configured product name in core renderer labels', () => {
    i18nService.setLanguage('zh', { persist: false });
    expect(i18nService.t('cowork')).toBe(PRODUCT_NAME);
    expect(i18nService.t('coworkSettings')).toBe(`${PRODUCT_NAME} 设置`);
    expect(i18nService.t('coworkWelcome')).toBe(PRODUCT_NAME);

    i18nService.setLanguage('en', { persist: false });
    expect(i18nService.t('cowork')).toBe(PRODUCT_NAME);
    expect(i18nService.t('coworkSettings')).toBe(`${PRODUCT_NAME} Settings`);
    expect(i18nService.t('coworkWelcome')).toBe(PRODUCT_NAME);
  });

  test('uses the configured company name in legal and copyright labels', () => {
    i18nService.setLanguage('zh', { persist: false });
    expect(i18nService.t('aboutServiceTerms')).toContain(COMPANY_NAME);
    expect(i18nService.t('copyrightHolder')).toContain(COMPANY_NAME);
    expect(i18nService.t('privacyDialogTitle')).toContain(COMPANY_NAME);
    expect(i18nService.t('privacyDialogLinkText')).toContain(COMPANY_NAME);

    i18nService.setLanguage('en', { persist: false });
    expect(i18nService.t('aboutServiceTerms')).toContain(COMPANY_NAME);
    expect(i18nService.t('copyrightHolder')).toContain(COMPANY_NAME);
    expect(i18nService.t('privacyDialogTitle')).toContain(COMPANY_NAME);
    expect(i18nService.t('privacyDialogLinkText')).toContain(COMPANY_NAME);
  });

  test('uses the configured publish identifiers', () => {
    expect(APP_NAME).toBe('yuzhh-ai-assistant');
    expect(APP_ID).toBe('yuzhh-ai-assistant');
    expect(APP_PROTOCOL).toBe('yuzhhai');
    expect(EXPORT_FORMAT_TYPE).toBe('yuzhh-ai-assistant.providers');
    expect(EXPORT_PASSWORD).toBe('yuzhh-ai-assistant-APP');
  });
});
