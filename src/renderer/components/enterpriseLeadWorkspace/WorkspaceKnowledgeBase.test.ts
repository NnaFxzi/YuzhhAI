import fs from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  EnterpriseLeadDocumentExtractionStatus,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadImageAttachmentExtensions,
  EnterpriseLeadKnowledgeIndexStatus,
  EnterpriseLeadSourceDocumentFileFilterExtensions,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import type { EnterpriseLeadExtractionSource } from '../../../shared/enterpriseLeadWorkspace/types';
import {
  EnterpriseLeadKnowledgeItemKind,
  EnterpriseLeadKnowledgeSection,
} from './enterpriseLeadWorkspaceUi';
import {
  canPreviewEnterpriseLeadOriginalDocument,
  canRetryEnterpriseLeadDocumentProcessing,
  confirmEnterpriseLeadKnowledgeItemInProfile,
  confirmEnterpriseLeadKnowledgeItemsInProfile,
  confirmEnterpriseLeadKnowledgeValueInProfile,
  doesEnterpriseLeadKnowledgeDocumentMatchQuery,
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
  enterpriseLeadKnowledgeRowArchiveActionClassName,
  enterpriseLeadKnowledgeTableColumnClassNames,
  enterpriseLeadKnowledgeVectorIndexStatusClassNames,
  enterpriseLeadReadableDocumentExtensions,
  getEnterpriseLeadKnowledgeConfirmationKey,
  getEnterpriseLeadKnowledgeDeletionKeys,
  getEnterpriseLeadKnowledgeDocumentStatusDescription,
  getEnterpriseLeadKnowledgeMessageAutoDismissMs,
  getEnterpriseLeadKnowledgeMessageRole,
  getEnterpriseLeadKnowledgeMetricFilter,
  getEnterpriseLeadKnowledgePendingItemCount,
  getEnterpriseLeadKnowledgePendingItems,
  getEnterpriseLeadKnowledgeSelectedDeletionKeys,
  getEnterpriseLeadKnowledgeSelectedItemIdAfterViewChange,
  getEnterpriseLeadKnowledgeToolbarGridClassName,
  getEnterpriseLeadKnowledgeVectorIndexStatus,
  getEnterpriseLeadKnowledgeVectorIndexSummary,
  getEnterpriseLeadNewExtractedKnowledgeKeys,
  ignoreEnterpriseLeadKnowledgeItemInProfile,
  isEnterpriseLeadDocumentProcessing,
  isEnterpriseLeadKnowledgeItemConfirmed,
  isEnterpriseLeadKnowledgeItemIgnored,
  isEnterpriseLeadKnowledgeSectionShownInAiKnowledgeTable,
  removeEnterpriseLeadKnowledgeKeysFromProfile,
  shouldShowEnterpriseLeadKnowledgeBatchConfirmAction,
  shouldShowEnterpriseLeadKnowledgeDetailPanel,
  shouldShowEnterpriseLeadKnowledgeSelectionToolbar,
  shouldShowEnterpriseLeadKnowledgeToolbarAddAction,
} from './WorkspaceKnowledgeBase';

describe('WorkspaceKnowledgeBase layout', () => {
  test('mounts normalized document management without renderer path reads', () => {
    const source = fs.readFileSync(
      new URL('./WorkspaceKnowledgeBase.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('WorkspaceKnowledgeDocumentsPanel');
    expect(source).toContain(
      '<WorkspaceKnowledgeDocumentsPanel workspaceId={currentWorkspace.id}',
    );
    expect(source).not.toContain('resolveEnterpriseLeadKnowledgeDocumentUpload');
    expect(source).not.toContain('window.electron.dialog');
  });

  const getPercent = (className: string): number => {
    const match = /^w-\[(\d+)%\]$/.exec(className);
    return match ? Number.parseInt(match[1] ?? '0', 10) : 0;
  };

  test('allocates a stable expanded action column for the AI knowledge table', () => {
    expect(Object.keys(enterpriseLeadKnowledgeTableColumnClassNames)).toEqual([
      'knowledge',
      'category',
      'status',
      'actions',
    ]);

    const widths = Object.values(enterpriseLeadKnowledgeTableColumnClassNames).map(getPercent);

    expect(enterpriseLeadKnowledgeTableColumnClassNames.knowledge).toBe('w-[50%]');
    expect(enterpriseLeadKnowledgeTableColumnClassNames.category).toBe('w-[18%]');
    expect(enterpriseLeadKnowledgeTableColumnClassNames.status).toBe('w-[16%]');
    expect(enterpriseLeadKnowledgeTableColumnClassNames.actions).toBe('w-[16%]');
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

  test('keeps add document as a single top-level action on the document view', () => {
    expect(shouldShowEnterpriseLeadKnowledgeToolbarAddAction('documents')).toBe(false);
    expect(shouldShowEnterpriseLeadKnowledgeToolbarAddAction('knowledge')).toBe(true);
    expect(getEnterpriseLeadKnowledgeToolbarGridClassName('documents')).toContain(
      'md:grid-cols-[minmax(0,1fr)_180px]',
    );
    expect(getEnterpriseLeadKnowledgeToolbarGridClassName('knowledge')).toContain(
      'md:grid-cols-[minmax(0,1fr)_180px_auto_auto]',
    );
  });

  test('matches document search against source file metadata and extracted body', () => {
    const item = {
      id: 'source-0',
      kind: EnterpriseLeadKnowledgeItemKind.Source,
      metaText: '本地文件',
      secondaryText: '启盛制造',
      text: '客户资料',
    };
    const source = {
      kind: 'file',
      label: '客户资料',
      fileName: 'OEM-pricing.pdf',
      filePath: '/Users/demo/Documents/OEM-pricing.pdf',
      summary: '华东客户年度报价资料',
      text: '最小起订量 5000 件',
    };

    expect(doesEnterpriseLeadKnowledgeDocumentMatchQuery(item, source, 'oem-pricing')).toBe(true);
    expect(doesEnterpriseLeadKnowledgeDocumentMatchQuery(item, source, '华东客户')).toBe(true);
    expect(doesEnterpriseLeadKnowledgeDocumentMatchQuery(item, source, '5000')).toBe(true);
    expect(doesEnterpriseLeadKnowledgeDocumentMatchQuery(item, source, '不存在')).toBe(false);
  });

  test('previews rich source files as original documents when a local path exists', () => {
    expect(
      canPreviewEnterpriseLeadOriginalDocument({
        filePath: '/Users/demo/Documents/product.docx',
      }),
    ).toBe(true);
    expect(
      canPreviewEnterpriseLeadOriginalDocument({
        fileName: '手动资料.docx',
      }),
    ).toBe(false);
  });

  test('previews image source files when a local path exists', () => {
    expect(
      canPreviewEnterpriseLeadOriginalDocument({
        filePath: '/Users/demo/Documents/product.png',
      }),
    ).toBe(true);
    expect(
      canPreviewEnterpriseLeadOriginalDocument({
        filePath: '/Users/demo/Documents/photo.JPG',
      }),
    ).toBe(true);
    expect(
      canPreviewEnterpriseLeadOriginalDocument({
        fileName: 'logo.svg',
      }),
    ).toBe(false);
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

  test('keeps an edited AI knowledge value confirmed after save', () => {
    const profile = {
      companySummary: '',
      productList: ['蜂窝纸板'],
      productCapabilities: [],
      targetCustomers: [],
      applicationScenarios: [],
      sellingPoints: [],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
    };
    const editedItem = {
      id: 'product-0',
      kind: EnterpriseLeadKnowledgeItemKind.Product,
      text: '蜂窝纸板',
    };

    expect(getEnterpriseLeadKnowledgePendingItemCount(profile, [editedItem])).toBe(1);

    const confirmedProfile = confirmEnterpriseLeadKnowledgeValueInProfile(
      profile,
      'productList',
      '蜂窝纸板',
    );

    expect(isEnterpriseLeadKnowledgeItemConfirmed(confirmedProfile, editedItem)).toBe(true);
    expect(getEnterpriseLeadKnowledgePendingItemCount(confirmedProfile, [editedItem])).toBe(0);
  });

  test('ignores an AI knowledge item and removes it from the maintained profile', () => {
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
      confirmedKnowledgeKeys: ['productList:重型纸箱'],
    };
    const item = {
      id: 'product-0',
      kind: EnterpriseLeadKnowledgeItemKind.Product,
      text: '重型纸箱',
    };

    const ignoredProfile = ignoreEnterpriseLeadKnowledgeItemInProfile(profile, item);

    expect(ignoredProfile.productList).toEqual([]);
    expect(ignoredProfile.confirmedKnowledgeKeys).toBeUndefined();
    expect(ignoredProfile.ignoredKnowledgeKeys).toEqual([
      getEnterpriseLeadKnowledgeConfirmationKey(item),
    ]);
    expect(isEnterpriseLeadKnowledgeItemIgnored(ignoredProfile, item)).toBe(true);
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

  test('builds batch delete keys only for maintainable AI knowledge items', () => {
    const items = [
      {
        id: 'product-0',
        kind: EnterpriseLeadKnowledgeItemKind.Product,
        text: '重型纸箱',
      },
      {
        id: 'source-0',
        kind: EnterpriseLeadKnowledgeItemKind.Source,
        text: '客户访谈原文',
      },
      {
        id: 'selling-point-0',
        kind: EnterpriseLeadKnowledgeItemKind.SellingPoint,
        text: '防破损',
      },
    ];

    expect(getEnterpriseLeadKnowledgeDeletionKeys(items)).toEqual([
      'productList:重型纸箱',
      'sellingPoints:防破损',
    ]);
  });

  test('builds batch delete keys only from selected maintainable AI knowledge items', () => {
    const items = [
      {
        id: 'product-0',
        kind: EnterpriseLeadKnowledgeItemKind.Product,
        text: '重型纸箱',
      },
      {
        id: 'source-0',
        kind: EnterpriseLeadKnowledgeItemKind.Source,
        text: '客户访谈原文',
      },
      {
        id: 'selling-point-0',
        kind: EnterpriseLeadKnowledgeItemKind.SellingPoint,
        text: '防破损',
      },
    ];

    expect(getEnterpriseLeadKnowledgeSelectedDeletionKeys(items, ['product-0'])).toEqual([
      'productList:重型纸箱',
    ]);
    expect(
      getEnterpriseLeadKnowledgeSelectedDeletionKeys(items, ['source-0', 'selling-point-0']),
    ).toEqual(['sellingPoints:防破损']);
  });

  test('shows selected action toolbar only after AI knowledge is selected', () => {
    expect(shouldShowEnterpriseLeadKnowledgeSelectionToolbar(0)).toBe(false);
    expect(shouldShowEnterpriseLeadKnowledgeSelectionToolbar(1)).toBe(true);
  });

  test('hides no-op confirmation controls', () => {
    expect(shouldShowEnterpriseLeadKnowledgeBatchConfirmAction(0)).toBe(false);
    expect(shouldShowEnterpriseLeadKnowledgeBatchConfirmAction(1)).toBe(true);
  });

  test('keeps row ignore as a secondary hover action', () => {
    expect(enterpriseLeadKnowledgeRowArchiveActionClassName).toContain('opacity-0');
    expect(enterpriseLeadKnowledgeRowArchiveActionClassName).toContain('group-hover:opacity-100');
  });

  test('maps top metrics to knowledge table filters', () => {
    expect(getEnterpriseLeadKnowledgeMetricFilter('documents')).toMatchObject({
      activeView: 'documents',
      documentStatusFilter: 'all',
    });
    expect(getEnterpriseLeadKnowledgeMetricFilter('knowledge_all')).toMatchObject({
      activeView: 'knowledge',
      statusFilter: 'all',
    });
    expect(getEnterpriseLeadKnowledgeMetricFilter('knowledge_pending')).toMatchObject({
      activeView: 'knowledge',
      statusFilter: 'pending',
    });
    expect(getEnterpriseLeadKnowledgeMetricFilter('knowledge_readonly')).toMatchObject({
      activeView: 'knowledge',
      statusFilter: 'readonly',
    });
  });

  test('does not open a detail panel from AI knowledge table selection', () => {
    expect(shouldShowEnterpriseLeadKnowledgeDetailPanel('documents', 'source-0')).toBe(false);
    expect(shouldShowEnterpriseLeadKnowledgeDetailPanel('knowledge', '')).toBe(false);
    expect(shouldShowEnterpriseLeadKnowledgeDetailPanel('knowledge', 'product-0')).toBe(false);
  });

  test('hides recent deliverables and archives from the AI knowledge table', () => {
    expect(
      isEnterpriseLeadKnowledgeSectionShownInAiKnowledgeTable(
        EnterpriseLeadKnowledgeSection.Deliverables,
      ),
    ).toBe(false);
    expect(
      isEnterpriseLeadKnowledgeSectionShownInAiKnowledgeTable(
        EnterpriseLeadKnowledgeSection.Archives,
      ),
    ).toBe(false);
    expect(
      isEnterpriseLeadKnowledgeSectionShownInAiKnowledgeTable(
        EnterpriseLeadKnowledgeSection.Products,
      ),
    ).toBe(true);
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
        extractionStatus: 'extracting',
        vectorIndexStatus: 'indexing',
      }),
    ).toBe(false);
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

  test('guards retry and mutation actions while documents are processing', () => {
    expect(
      canRetryEnterpriseLeadDocumentProcessing({
        text: '企业资料正文',
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Pending,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
      }),
    ).toBe(true);
    expect(
      canRetryEnterpriseLeadDocumentProcessing({
        text: '企业资料正文',
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Failed,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Failed,
      }),
    ).toBe(true);
    expect(
      canRetryEnterpriseLeadDocumentProcessing({
        text: '企业资料正文',
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Failed,
      }),
    ).toBe(true);
    expect(
      canRetryEnterpriseLeadDocumentProcessing({
        text: '企业资料正文',
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexed,
      }),
    ).toBe(false);
    expect(
      canRetryEnterpriseLeadDocumentProcessing({
        text: '企业资料正文',
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracting,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexing,
      }),
    ).toBe(false);
    expect(
      canRetryEnterpriseLeadDocumentProcessing({
        text: '   ',
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Failed,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Failed,
      }),
    ).toBe(false);
    const pendingImageWithoutText: EnterpriseLeadExtractionSource = {
      kind: EnterpriseLeadExtractionSourceKind.Image,
      label: '旧图片资料',
      filePath: '/tmp/legacy-image.png',
      extractionStatus: EnterpriseLeadDocumentExtractionStatus.Pending,
      vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
    };
    expect(canRetryEnterpriseLeadDocumentProcessing(pendingImageWithoutText)).toBe(true);
    expect(
      isEnterpriseLeadDocumentProcessing({
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracting,
      }),
    ).toBe(true);
    expect(
      isEnterpriseLeadDocumentProcessing({
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexing,
      }),
    ).toBe(true);
    expect(
      isEnterpriseLeadDocumentProcessing({
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Failed,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Failed,
      }),
    ).toBe(false);
  });

  test('describes chunk extraction progress for large document processing', () => {
    expect(
      getEnterpriseLeadKnowledgeDocumentStatusDescription({
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracting,
        extractionStage: 'extracting_chunks',
        extractionProgressCurrent: 3,
        extractionProgressTotal: 12,
      }),
    ).toContain('3/12');
    expect(
      getEnterpriseLeadKnowledgeDocumentStatusDescription({
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracting,
        extractionStage: 'merging',
      }),
    ).toContain('合并');
    expect(
      getEnterpriseLeadKnowledgeDocumentStatusDescription({
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
        extractionPartial: true,
      }),
    ).toContain('大文件');
  });

  test('treats rich document uploads as readable knowledge sources', () => {
    expect(enterpriseLeadReadableDocumentExtensions.has('pdf')).toBe(true);
    expect(enterpriseLeadReadableDocumentExtensions.has('docx')).toBe(true);
    expect(enterpriseLeadReadableDocumentExtensions.has('xlsx')).toBe(true);
    expect(enterpriseLeadReadableDocumentExtensions.has('xls')).toBe(true);
    expect(enterpriseLeadReadableDocumentExtensions.has('pptx')).toBe(true);
    expect(enterpriseLeadReadableDocumentExtensions.has('doc')).toBe(false);
  });

  test('allows image uploads as attachable knowledge sources without marking them readable', () => {
    expect(EnterpriseLeadImageAttachmentExtensions).toContain('png');
    expect(EnterpriseLeadImageAttachmentExtensions).toContain('jpg');
    expect(EnterpriseLeadImageAttachmentExtensions).toContain('webp');
    expect(EnterpriseLeadSourceDocumentFileFilterExtensions).toContain('png');
    expect(EnterpriseLeadSourceDocumentFileFilterExtensions).toContain('jpg');
    expect(EnterpriseLeadSourceDocumentFileFilterExtensions).toContain('webp');
    expect(enterpriseLeadReadableDocumentExtensions.has('png')).toBe(false);
  });
});
