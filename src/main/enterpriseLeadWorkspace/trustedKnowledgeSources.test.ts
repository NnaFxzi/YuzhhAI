import { describe, expect, test } from 'vitest';

import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceProfile,
} from '../../shared/enterpriseLeadWorkspace/types';
import { buildDefaultEnterpriseLeadWorkspaceSettings } from '../../shared/enterpriseLeadWorkspace/validation';
import { ContentKnowledgeSourceType } from '../libs/contentKnowledgeRetrieval';
import { buildEnterpriseTrustedKnowledgeSources } from './trustedKnowledgeSources';

const buildProfile = (): EnterpriseLeadWorkspaceProfile => ({
  companySummary: '工业包装供应商',
  productList: ['重型纸箱', '蜂窝纸板'],
  productCapabilities: ['抗压设计'],
  targetCustomers: ['机械设备厂'],
  applicationScenarios: ['出口运输'],
  sellingPoints: ['可替代木箱'],
  channelPreferences: ['微信'],
  prohibitedClaims: ['绝对防损', '  '],
  contactRules: ['仅生成草稿', ''],
  missingInfo: ['案例图片'],
  confirmedKnowledgeKeys: [
    'companySummary:工业包装供应商',
    'productList:重型纸箱',
    'sellingPoints:可替代木箱',
  ],
  ignoredKnowledgeKeys: ['productList:蜂窝纸板'],
});

describe('buildEnterpriseTrustedKnowledgeSources', () => {
  test('builds only confirmed Profile facts plus current prohibited/contact rules', () => {
    const sources = buildEnterpriseTrustedKnowledgeSources({
      workspaceId: 'workspace-1',
      profile: buildProfile(),
    });

    expect(sources).toEqual([
      {
        sourceId: 'profile-confirmed:workspace-1',
        sourceType: ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
        label: '已确认业务知识',
        content: [
          '公司概况：工业包装供应商',
          '产品：重型纸箱',
          '卖点：可替代木箱',
        ].join('\n'),
        priority: 0.18,
        verifiedByUser: true,
        evidenceTier: 'internal',
      },
      {
        sourceId: 'workspace-rules:workspace-1',
        sourceType: ContentKnowledgeSourceType.WorkspaceRule,
        label: '硬性规则',
        content: ['禁用承诺：绝对防损', '联系规则：仅生成草稿'].join('\n'),
        priority: 0.2,
        verifiedByUser: true,
        evidenceTier: 'internal',
      },
    ]);
    expect(JSON.stringify(sources)).not.toContain('蜂窝纸板');
    expect(JSON.stringify(sources)).not.toContain('抗压设计');
    expect(JSON.stringify(sources)).not.toContain('案例图片');
  });

  test('accepts only the workspace identity and Profile projection, never provider-bearing settings', () => {
    const secret = 'TASK10_PROVIDER_SECRET_SENTINEL';
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.model.providers = {
      secretProvider: {
        enabled: true,
        apiKey: secret,
        baseUrl: `https://${secret}.example.invalid/v1`,
        apiFormat: 'openai',
        models: [{ id: secret, name: secret }],
      },
    };
    const workspace = {
      id: 'workspace-secret',
      profile: buildProfile(),
      settings,
      extractionSources: [{
        id: 'source-secret',
        kind: 'file',
        label: secret,
        filePath: `/private/${secret}`,
        text: secret,
      }],
    } as Pick<EnterpriseLeadWorkspace, 'id' | 'profile' | 'settings' | 'extractionSources'>;

    const { id: workspaceId, profile } = workspace;
    const sources = buildEnterpriseTrustedKnowledgeSources({ workspaceId, profile });

    expect(JSON.stringify(sources)).not.toContain(secret);
    expect(sources.every(source => Object.keys(source).sort().join(',') === [
      'content',
      'evidenceTier',
      'label',
      'priority',
      'sourceId',
      'sourceType',
      'verifiedByUser',
    ].sort().join(','))).toBe(true);
  });

  test('preserves legacy confirmed-key matching without trusting malformed keys', () => {
    const profile: EnterpriseLeadWorkspaceProfile = {
      ...buildProfile(),
      productList: ['Not Canonical'],
      prohibitedClaims: [],
      contactRules: [],
      confirmedKnowledgeKeys: [
        ' productList:  Not   Canonical  ',
        'unknown:Not Canonical',
        'Not Canonical',
      ],
    };

    expect(buildEnterpriseTrustedKnowledgeSources({
      workspaceId: 'workspace-legacy-key',
      profile,
    })).toEqual([{
      sourceId: 'profile-confirmed:workspace-legacy-key',
      sourceType: ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
      label: '已确认业务知识',
      content: '产品：Not Canonical',
      priority: 0.18,
      verifiedByUser: true,
      evidenceTier: 'internal',
    }]);
  });
});
