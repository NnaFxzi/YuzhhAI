import { describe, expect, test } from 'vitest';

import { EnterpriseLeadKnowledgeItemKind } from './enterpriseLeadWorkspaceUi';
import {
  confirmEnterpriseLeadKnowledgeItemInProfile,
  confirmEnterpriseLeadKnowledgeItemsInProfile,
  doesEnterpriseLeadKnowledgeSourceNeedVectorSync,
  enterpriseLeadKnowledgeActionButtonClassNames,
  enterpriseLeadKnowledgeConfirmBehavior,
  enterpriseLeadKnowledgeDocumentHeaderClassName,
  enterpriseLeadKnowledgeDocumentHeaderLastClassName,
  enterpriseLeadKnowledgeHeaderCellClassName,
  enterpriseLeadKnowledgeInitialSelectedItemId,
  enterpriseLeadKnowledgeMessageAnimationClassName,
  enterpriseLeadKnowledgeMessageAutoDismissMs,
  enterpriseLeadKnowledgeMessageSuccessAccentClassName,
  enterpriseLeadKnowledgeMessageToneClassNames,
  enterpriseLeadKnowledgeTableColumnClassNames,
  enterpriseLeadKnowledgeVectorIndexStatusClassNames,
  enterpriseLeadReadableDocumentExtensions,
  getEnterpriseLeadKnowledgeConfirmationKey,
  getEnterpriseLeadKnowledgeMessageAutoDismissMs,
  getEnterpriseLeadKnowledgeMessageRole,
  getEnterpriseLeadKnowledgePendingItemCount,
  getEnterpriseLeadKnowledgePendingItems,
  getEnterpriseLeadKnowledgeSelectedItemIdAfterViewChange,
  getEnterpriseLeadKnowledgeVectorIndexStatus,
  getEnterpriseLeadKnowledgeVectorIndexSummary,
  getEnterpriseLeadNewExtractedKnowledgeKeys,
  isEnterpriseLeadKnowledgeItemConfirmed,
  removeEnterpriseLeadKnowledgeKeysFromProfile,
} from './WorkspaceKnowledgeBase';

describe('WorkspaceKnowledgeBase layout', () => {
  const getPercent = (className: string): number => {
    const match = /^w-\[(\d+)%\]$/.exec(className);
    return match ? Number.parseInt(match[1] ?? '0', 10) : 0;
  };

  test('allocates a stable expanded action column for the AI knowledge table', () => {
    expect(Object.keys(enterpriseLeadKnowledgeTableColumnClassNames)).toEqual([
      'knowledge',
      'meta',
      'actions',
    ]);

    const widths = Object.values(enterpriseLeadKnowledgeTableColumnClassNames).map(getPercent);

    expect(enterpriseLeadKnowledgeTableColumnClassNames.knowledge).toBe('w-[54%]');
    expect(enterpriseLeadKnowledgeTableColumnClassNames.meta).toBe('w-[24%]');
    expect(enterpriseLeadKnowledgeTableColumnClassNames.actions).toBe('w-[22%]');
    expect(widths.reduce((total, width) => total + width, 0)).toBe(100);
  });

  test('uses compact expanded text action buttons in the AI knowledge table', () => {
    const actionButtonClassNames = Object.values(enterpriseLeadKnowledgeActionButtonClassNames);

    expect(actionButtonClassNames).toHaveLength(2);
    actionButtonClassNames.forEach(className => {
      expect(className).toContain('min-w-[54px]');
      expect(className).toContain('gap-1');
      expect(className).not.toContain('w-8 ');
    });
  });

  test('persists workspace profile when confirming AI knowledge into the library', () => {
    expect(enterpriseLeadKnowledgeConfirmBehavior.persistProfile).toBe(true);
    expect(enterpriseLeadKnowledgeConfirmBehavior.successMessageKey).toBe(
      'enterpriseLeadKnowledgeItemConfirmed',
    );
  });

  test('marks a confirmed AI knowledge item in profile and removes it from pending count', () => {
    const profile = {
      companySummary: '',
      productList: ['重型纸箱'],
      productCapabilities: [],
      targetCustomers: [],
      applicationScenarios: [],
      sellingPoints: [],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
    };
    const item = {
      id: 'product-0',
      kind: EnterpriseLeadKnowledgeItemKind.Product,
      text: '重型纸箱',
    };

    expect(getEnterpriseLeadKnowledgePendingItemCount(profile, [item])).toBe(1);

    const confirmedProfile = confirmEnterpriseLeadKnowledgeItemInProfile(profile, item);

    expect(confirmedProfile).not.toBe(profile);
    expect(confirmedProfile.confirmedKnowledgeKeys).toEqual([
      getEnterpriseLeadKnowledgeConfirmationKey(item),
    ]);
    expect(isEnterpriseLeadKnowledgeItemConfirmed(confirmedProfile, item)).toBe(true);
    expect(getEnterpriseLeadKnowledgePendingItemCount(confirmedProfile, [item])).toBe(0);
  });

  test('bulk confirms pending AI knowledge items while ignoring read-only source rows', () => {
    const profile = {
      companySummary: '',
      productList: ['重型纸箱'],
      productCapabilities: [],
      targetCustomers: ['汽配工厂'],
      applicationScenarios: [],
      sellingPoints: [],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
    };
    const items = [
      {
        id: 'product-0',
        kind: EnterpriseLeadKnowledgeItemKind.Product,
        text: '重型纸箱',
      },
      {
        id: 'customer-0',
        kind: EnterpriseLeadKnowledgeItemKind.Customer,
        text: '汽配工厂',
      },
      {
        id: 'source-0',
        kind: EnterpriseLeadKnowledgeItemKind.Source,
        text: '客户访谈原文',
      },
    ];

    expect(getEnterpriseLeadKnowledgePendingItems(profile, items)).toEqual(items.slice(0, 2));

    const confirmedProfile = confirmEnterpriseLeadKnowledgeItemsInProfile(profile, items);

    expect(confirmedProfile.confirmedKnowledgeKeys).toEqual([
      getEnterpriseLeadKnowledgeConfirmationKey(items[0]),
      getEnterpriseLeadKnowledgeConfirmationKey(items[1]),
    ]);
    expect(getEnterpriseLeadKnowledgePendingItemCount(confirmedProfile, items)).toBe(0);
  });

  test('tracks only newly contributed knowledge keys from document extraction', () => {
    const previousProfile = {
      companySummary: '东莞工厂',
      productList: ['重型纸箱'],
      productCapabilities: [],
      targetCustomers: [],
      applicationScenarios: [],
      sellingPoints: [],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
    };
    const extractedProfile = {
      companySummary: '东莞工厂',
      productList: ['重型纸箱', '蜂窝纸板'],
      productCapabilities: [],
      targetCustomers: ['机械设备厂'],
      applicationScenarios: [],
      sellingPoints: ['防破损'],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
    };
    const mergedProfile = {
      ...previousProfile,
      productList: ['重型纸箱', '蜂窝纸板'],
      targetCustomers: ['机械设备厂'],
      sellingPoints: ['防破损'],
    };

    expect(
      getEnterpriseLeadNewExtractedKnowledgeKeys(previousProfile, extractedProfile, mergedProfile),
    ).toEqual(['productList:蜂窝纸板', 'targetCustomers:机械设备厂', 'sellingPoints:防破损']);
  });

  test('removes only unpreserved source knowledge keys from profile and confirmations', () => {
    const profile = {
      companySummary: '东莞工厂',
      productList: ['重型纸箱', '蜂窝纸板'],
      productCapabilities: [],
      targetCustomers: ['机械设备厂'],
      applicationScenarios: [],
      sellingPoints: ['防破损'],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
      confirmedKnowledgeKeys: [
        'productList:蜂窝纸板',
        'targetCustomers:机械设备厂',
        'sellingPoints:防破损',
      ],
    };

    const nextProfile = removeEnterpriseLeadKnowledgeKeysFromProfile(
      profile,
      ['productList:蜂窝纸板', 'targetCustomers:机械设备厂'],
      ['targetCustomers:机械设备厂'],
    );

    expect(nextProfile.productList).toEqual(['重型纸箱']);
    expect(nextProfile.targetCustomers).toEqual(['机械设备厂']);
    expect(nextProfile.sellingPoints).toEqual(['防破损']);
    expect(nextProfile.confirmedKnowledgeKeys).toEqual([
      'targetCustomers:机械设备厂',
      'sellingPoints:防破损',
    ]);
  });

  test('left aligns document table headers and centers AI knowledge table headers', () => {
    expect(enterpriseLeadKnowledgeDocumentHeaderClassName).toContain('text-left');
    expect(enterpriseLeadKnowledgeDocumentHeaderClassName).not.toContain('text-center');
    expect(enterpriseLeadKnowledgeDocumentHeaderLastClassName).toContain('text-left');
    expect(enterpriseLeadKnowledgeDocumentHeaderLastClassName).not.toContain('text-center');
    expect(enterpriseLeadKnowledgeDocumentHeaderLastClassName).not.toContain('text-right');
    expect(enterpriseLeadKnowledgeHeaderCellClassName).toContain('text-center');
    expect(enterpriseLeadKnowledgeHeaderCellClassName).not.toContain('text-right');
  });

  test('clears selected rows when switching knowledge views', () => {
    expect(enterpriseLeadKnowledgeInitialSelectedItemId).toBe('');
    expect(getEnterpriseLeadKnowledgeSelectedItemIdAfterViewChange('knowledge')).toBe('');
    expect(getEnterpriseLeadKnowledgeSelectedItemIdAfterViewChange('documents')).toBe('');
  });

  test('classifies global knowledge messages by outcome tone', () => {
    expect(Object.keys(enterpriseLeadKnowledgeMessageToneClassNames)).toEqual([
      'success',
      'failure',
      'exception',
    ]);
    expect(enterpriseLeadKnowledgeMessageToneClassNames.success).toContain('border-emerald');
    expect(enterpriseLeadKnowledgeMessageToneClassNames.failure).toContain('border-red');
    expect(enterpriseLeadKnowledgeMessageToneClassNames.exception).toContain('border-amber');
    expect(getEnterpriseLeadKnowledgeMessageRole('success')).toBe('status');
    expect(getEnterpriseLeadKnowledgeMessageRole('failure')).toBe('alert');
    expect(getEnterpriseLeadKnowledgeMessageRole('exception')).toBe('alert');
  });

  test('animates global knowledge messages without animating reduced-motion users', () => {
    expect(enterpriseLeadKnowledgeMessageAnimationClassName).toContain(
      'animate-knowledge-message-in',
    );
    expect(enterpriseLeadKnowledgeMessageAnimationClassName).toContain(
      'motion-reduce:animate-none',
    );
    expect(enterpriseLeadKnowledgeMessageSuccessAccentClassName).toContain(
      'animate-knowledge-message-success-sheen',
    );
    expect(enterpriseLeadKnowledgeMessageSuccessAccentClassName).toContain('motion-reduce:hidden');
  });

  test('auto dismisses global knowledge messages after readable durations', () => {
    expect(Object.keys(enterpriseLeadKnowledgeMessageAutoDismissMs)).toEqual([
      'success',
      'failure',
      'exception',
    ]);
    expect(getEnterpriseLeadKnowledgeMessageAutoDismissMs('success')).toBe(3000);
    expect(getEnterpriseLeadKnowledgeMessageAutoDismissMs('failure')).toBe(5000);
    expect(getEnterpriseLeadKnowledgeMessageAutoDismissMs('exception')).toBe(6000);
    expect(getEnterpriseLeadKnowledgeMessageAutoDismissMs('success')).toBeLessThan(
      getEnterpriseLeadKnowledgeMessageAutoDismissMs('failure'),
    );
    expect(getEnterpriseLeadKnowledgeMessageAutoDismissMs('failure')).toBeLessThanOrEqual(
      getEnterpriseLeadKnowledgeMessageAutoDismissMs('exception'),
    );
  });

  test('maps document vector index status for knowledge base rows', () => {
    expect(Object.keys(enterpriseLeadKnowledgeVectorIndexStatusClassNames)).toEqual([
      'pending',
      'indexing',
      'indexed',
      'failed',
    ]);
    expect(enterpriseLeadKnowledgeVectorIndexStatusClassNames.indexed).toContain('emerald');
    expect(enterpriseLeadKnowledgeVectorIndexStatusClassNames.failed).toContain('red');
    expect(getEnterpriseLeadKnowledgeVectorIndexStatus()).toBe('pending');
    expect(getEnterpriseLeadKnowledgeVectorIndexStatus({ vectorIndexStatus: 'indexed' })).toBe(
      'indexed',
    );
    expect(
      getEnterpriseLeadKnowledgeVectorIndexSummary({
        vectorChunkCount: 12,
        vectorIndexStatus: 'indexed',
      }),
    ).toContain('12');
  });

  test('detects stale readable documents that still need vector sync', () => {
    expect(
      doesEnterpriseLeadKnowledgeSourceNeedVectorSync({
        text: '主营工业包装服务，客户是机械设备厂采购负责人。',
      }),
    ).toBe(true);
    expect(
      doesEnterpriseLeadKnowledgeSourceNeedVectorSync({
        text: '主营工业包装服务，客户是机械设备厂采购负责人。',
        vectorChunkCount: 4,
        vectorIndexStatus: 'indexed',
      }),
    ).toBe(false);
    expect(
      doesEnterpriseLeadKnowledgeSourceNeedVectorSync({
        text: '   ',
        vectorIndexStatus: 'pending',
      }),
    ).toBe(false);
  });

  test('treats rich document uploads as readable knowledge sources', () => {
    expect(enterpriseLeadReadableDocumentExtensions.has('pdf')).toBe(true);
    expect(enterpriseLeadReadableDocumentExtensions.has('docx')).toBe(true);
    expect(enterpriseLeadReadableDocumentExtensions.has('xlsx')).toBe(true);
    expect(enterpriseLeadReadableDocumentExtensions.has('xls')).toBe(true);
    expect(enterpriseLeadReadableDocumentExtensions.has('doc')).toBe(false);
  });
});
