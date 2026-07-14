import { describe, expect, test } from 'vitest';

import type { EnterpriseLeadWorkspaceProfile } from '../enterpriseLeadWorkspace/types';
import { KnowledgeFactDomain } from './constants';
import {
  appendEnterpriseProfileArrayValue,
  buildEnterpriseKnowledgeKey,
  confirmEnterpriseProfileKnowledgeKey,
  getChangedEnterpriseProfileFields,
  getEnterpriseProfileFieldValue,
  ignoreEnterpriseProfileKnowledgeKey,
  normalizeEnterpriseKnowledgeValue,
  removeEnterpriseProfileKnowledgeKey,
} from './enterpriseLeadProfileKnowledge';

const createProfile = (
  overrides: Partial<EnterpriseLeadWorkspaceProfile> = {},
): EnterpriseLeadWorkspaceProfile => ({
  companySummary: '',
  productList: [],
  productCapabilities: [],
  targetCustomers: [],
  applicationScenarios: [],
  sellingPoints: [],
  channelPreferences: [],
  prohibitedClaims: [],
  contactRules: [],
  missingInfo: [],
  ...overrides,
});

describe('enterprise lead Profile knowledge', () => {
  test('preserves trimmed display text and normalizes comparison text', () => {
    expect(normalizeEnterpriseKnowledgeValue('  东莞\u3000 工厂  ')).toEqual({
      displayValue: '东莞\u3000 工厂',
      normalizedValue: '东莞 工厂',
    });
    expect(normalizeEnterpriseKnowledgeValue('  Lead   RADAR  ')).toEqual({
      displayValue: 'Lead   RADAR',
      normalizedValue: 'lead radar',
    });
    expect(normalizeEnterpriseKnowledgeValue(' \n\t ')).toEqual({
      displayValue: '',
      normalizedValue: '',
    });
  });

  test('builds canonical domain keys from normalized values', () => {
    expect(buildEnterpriseKnowledgeKey(KnowledgeFactDomain.ProductList, '  Lead   RADAR  ')).toBe(
      'productList:lead radar',
    );
    expect(buildEnterpriseKnowledgeKey(KnowledgeFactDomain.SellingPoints, ' 防破损 ')).toBe(
      'sellingPoints:防破损',
    );
    expect(buildEnterpriseKnowledgeKey(KnowledgeFactDomain.ProductList, '  ')).toBe('');
  });

  test('appends display values immutably with case-insensitive normalized deduplication', () => {
    const profile = createProfile({ productList: ['Lead Radar'] });
    const duplicate = appendEnterpriseProfileArrayValue(
      profile,
      KnowledgeFactDomain.ProductList,
      '  LEAD   RADAR ',
    );
    const appended = appendEnterpriseProfileArrayValue(
      duplicate,
      KnowledgeFactDomain.ProductList,
      '  蜂窝\u3000 纸板  ',
    );

    expect(duplicate).not.toBe(profile);
    expect(duplicate.productList).toEqual(['Lead Radar']);
    expect(appended.productList).toEqual(['Lead Radar', '蜂窝\u3000 纸板']);
    expect(profile.productList).toEqual(['Lead Radar']);
  });

  test('moves a canonical key between confirmed, ignored, and neutral states', () => {
    const key = buildEnterpriseKnowledgeKey(KnowledgeFactDomain.ProductList, 'Lead Radar');
    const profile = createProfile({
      confirmedKnowledgeKeys: ['sellingPoints:防破损'],
      ignoredKnowledgeKeys: [key, 'targetCustomers:汽配工厂'],
    });

    const confirmed = confirmEnterpriseProfileKnowledgeKey(profile, key);
    expect(confirmed.confirmedKnowledgeKeys).toEqual(['sellingPoints:防破损', key]);
    expect(confirmed.ignoredKnowledgeKeys).toEqual(['targetCustomers:汽配工厂']);

    const ignored = ignoreEnterpriseProfileKnowledgeKey(confirmed, key);
    expect(ignored.confirmedKnowledgeKeys).toEqual(['sellingPoints:防破损']);
    expect(ignored.ignoredKnowledgeKeys).toEqual(['targetCustomers:汽配工厂', key]);

    const neutral = removeEnterpriseProfileKnowledgeKey(ignored, key);
    expect(neutral.confirmedKnowledgeKeys).toEqual(['sellingPoints:防破损']);
    expect(neutral.ignoredKnowledgeKeys).toEqual(['targetCustomers:汽配工厂']);
    expect(profile.ignoredKnowledgeKeys).toContain(key);
  });

  test('omits empty trust-key collections after immutable transforms', () => {
    const key = 'productList:lead radar';
    const ignored = ignoreEnterpriseProfileKnowledgeKey(
      createProfile({ confirmedKnowledgeKeys: [key] }),
      key,
    );
    const neutral = removeEnterpriseProfileKnowledgeKey(ignored, key);

    expect(ignored.confirmedKnowledgeKeys).toBeUndefined();
    expect(ignored.ignoredKnowledgeKeys).toEqual([key]);
    expect(neutral.confirmedKnowledgeKeys).toBeUndefined();
    expect(neutral.ignoredKnowledgeKeys).toBeUndefined();
  });

  test('keeps an empty key as an immutable no-op', () => {
    const profile = createProfile({
      confirmedKnowledgeKeys: ['productList:lead radar'],
      ignoredKnowledgeKeys: ['sellingPoints:防破损'],
    });

    for (const transform of [
      confirmEnterpriseProfileKnowledgeKey,
      ignoreEnterpriseProfileKnowledgeKey,
      removeEnterpriseProfileKnowledgeKey,
    ]) {
      const nextProfile = transform(profile, '');
      expect(nextProfile).not.toBe(profile);
      expect(nextProfile).toEqual(profile);
    }
  });

  test('rejects every non-canonical non-empty key before changing trust state', () => {
    const profile = createProfile();
    const invalidKeys = [
      'unknownField:value',
      'productList',
      'productList:',
      'productList:Lead Radar',
      'productList:lead   radar',
    ];

    for (const transform of [
      confirmEnterpriseProfileKnowledgeKey,
      ignoreEnterpriseProfileKnowledgeKey,
      removeEnterpriseProfileKnowledgeKey,
    ]) {
      for (const invalidKey of invalidKeys) {
        expect(() => transform(profile, invalidKey)).toThrow('Invalid enterprise knowledge key');
      }
    }
    expect(profile.confirmedKnowledgeKeys).toBeUndefined();
    expect(profile.ignoredKnowledgeKeys).toBeUndefined();
  });

  test('preserves additional Profile properties while cloning mutable arrays', () => {
    const profile = Object.assign(createProfile({ productList: ['Lead Radar'] }), {
      futureAuditTag: 'keep-me',
    });

    const nextProfile = appendEnterpriseProfileArrayValue(
      profile,
      KnowledgeFactDomain.ProductList,
      'Account Briefs',
    ) as EnterpriseLeadWorkspaceProfile & { futureAuditTag: string };

    expect(nextProfile.futureAuditTag).toBe('keep-me');
    expect(nextProfile.productList).not.toBe(profile.productList);
  });

  test('reads companySummary and array fields through the domain whitelist', () => {
    const profile = createProfile({
      companySummary: '精密制造企业',
      productList: ['五轴加工'],
    });

    expect(getEnterpriseProfileFieldValue(profile, KnowledgeFactDomain.CompanySummary)).toBe(
      '精密制造企业',
    );
    expect(getEnterpriseProfileFieldValue(profile, KnowledgeFactDomain.ProductList)).toEqual([
      '五轴加工',
    ]);
  });

  test('reports only normalized semantic value changes', () => {
    const previous = createProfile({
      companySummary: 'Lead   Factory',
      productList: ['Lead Radar', '蜂窝纸板'],
    });
    const formattingOnly = createProfile({
      companySummary: ' lead factory ',
      productList: ['蜂窝纸板', 'LEAD   RADAR'],
    });
    const changed = createProfile({
      ...formattingOnly,
      productList: ['蜂窝纸板', 'Account Briefs'],
      sellingPoints: ['响应快'],
    });

    expect(getChangedEnterpriseProfileFields(previous, formattingOnly)).toEqual([]);
    expect(getChangedEnterpriseProfileFields(previous, changed)).toEqual([
      KnowledgeFactDomain.ProductList,
      KnowledgeFactDomain.SellingPoints,
    ]);
  });

  test('attributes canonical trust-key membership changes to their domains', () => {
    const previous = createProfile({
      confirmedKnowledgeKeys: ['productList:lead radar'],
      ignoredKnowledgeKeys: ['sellingPoints:防破损'],
    });
    const next = createProfile({
      confirmedKnowledgeKeys: ['sellingPoints:防破损', 'productList:lead radar'],
      ignoredKnowledgeKeys: ['contactRules:不要连续催促'],
    });

    expect(getChangedEnterpriseProfileFields(previous, next)).toEqual([
      KnowledgeFactDomain.SellingPoints,
      KnowledgeFactDomain.ContactRules,
    ]);
  });

  test('ignores trust-key ordering but rejects malformed changed keys', () => {
    const previous = createProfile({
      confirmedKnowledgeKeys: ['productList:lead radar', 'sellingPoints:防破损'],
    });
    const reordered = createProfile({
      confirmedKnowledgeKeys: ['sellingPoints:防破损', 'productList:lead radar'],
    });

    expect(getChangedEnterpriseProfileFields(previous, reordered)).toEqual([]);
    expect(() =>
      getChangedEnterpriseProfileFields(
        previous,
        createProfile({ confirmedKnowledgeKeys: ['unknownField:value'] }),
      ),
    ).toThrow();
  });
});
