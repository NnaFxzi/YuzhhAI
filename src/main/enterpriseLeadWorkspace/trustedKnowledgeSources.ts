import type { EnterpriseLeadWorkspaceProfile } from '../../shared/enterpriseLeadWorkspace/types';
import {
  KnowledgeFactDomain,
  type KnowledgeFactDomain as KnowledgeFactDomainValue,
  KnowledgeFactDomains,
} from '../../shared/knowledgeBase/constants';
import {
  buildEnterpriseKnowledgeKey,
  hasCanonicalEnterpriseProfileKnowledgeTrustOverlap,
} from '../../shared/knowledgeBase/enterpriseLeadProfileKnowledge';
import {
  type ContentKnowledgeSource,
  ContentKnowledgeSourceType,
} from '../libs/contentKnowledgeRetrieval';
import { EnterpriseLeadProfileInvalidRequestError } from './profileRevisionStore';

export interface BuildEnterpriseTrustedKnowledgeSourcesInput {
  workspaceId: string;
  profile: EnterpriseLeadWorkspaceProfile;
}

type EnterpriseLeadProfileArrayField = Exclude<
  KnowledgeFactDomainValue,
  typeof KnowledgeFactDomain.CompanySummary
>;

const enterpriseLeadProfileArrayFields = KnowledgeFactDomains.filter(
  (field): field is EnterpriseLeadProfileArrayField =>
    field !== KnowledgeFactDomain.CompanySummary,
);

const enterpriseLeadProfileFactFieldLabels: Record<KnowledgeFactDomainValue, string> = {
  [KnowledgeFactDomain.CompanySummary]: '公司概况',
  [KnowledgeFactDomain.ProductList]: '产品',
  [KnowledgeFactDomain.ProductCapabilities]: '产品能力',
  [KnowledgeFactDomain.TargetCustomers]: '目标客户',
  [KnowledgeFactDomain.ApplicationScenarios]: '应用场景',
  [KnowledgeFactDomain.SellingPoints]: '卖点',
  [KnowledgeFactDomain.ChannelPreferences]: '渠道偏好',
  [KnowledgeFactDomain.ProhibitedClaims]: '禁用承诺',
  [KnowledgeFactDomain.ContactRules]: '联系规则',
  [KnowledgeFactDomain.MissingInfo]: '缺失信息',
};

const normalizeWorkspaceKnowledgeKeyText = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();

const normalizeWorkspaceKnowledgeKey = (value: string): string => {
  const separatorIndex = value.indexOf(':');
  if (separatorIndex === -1) return normalizeWorkspaceKnowledgeKeyText(value);

  const field = value.slice(0, separatorIndex).trim();
  const text = normalizeWorkspaceKnowledgeKeyText(value.slice(separatorIndex + 1));
  return field && text ? `${field}:${text}` : '';
};

const buildConfirmedProfileContent = (profile: EnterpriseLeadWorkspaceProfile): string => {
  const confirmedKeys = new Set(
    (profile.confirmedKnowledgeKeys ?? []).map(normalizeWorkspaceKnowledgeKey).filter(Boolean),
  );
  if (confirmedKeys.size === 0) return '';

  const lines: string[] = [];
  const addConfirmedFact = (field: KnowledgeFactDomainValue, value: string): void => {
    const text = value.trim();
    const key = buildEnterpriseKnowledgeKey(field, text);
    if (!text || !confirmedKeys.has(key)) return;
    lines.push(`${enterpriseLeadProfileFactFieldLabels[field]}：${text}`);
  };

  addConfirmedFact(KnowledgeFactDomain.CompanySummary, profile.companySummary);
  for (const field of enterpriseLeadProfileArrayFields) {
    for (const value of profile[field]) addConfirmedFact(field, value);
  }
  return lines.join('\n');
};

const buildRuleContent = (profile: EnterpriseLeadWorkspaceProfile): string => [
  ...profile.prohibitedClaims
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => `禁用承诺：${value}`),
  ...profile.contactRules
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => `联系规则：${value}`),
].join('\n');

export const buildEnterpriseTrustedKnowledgeSources = (
  input: BuildEnterpriseTrustedKnowledgeSourcesInput,
): ContentKnowledgeSource[] => {
  if (
    typeof input.workspaceId !== 'string'
    || input.workspaceId.trim().length === 0
    || hasCanonicalEnterpriseProfileKnowledgeTrustOverlap(input.profile)
  ) {
    throw new EnterpriseLeadProfileInvalidRequestError();
  }

  const sources: ContentKnowledgeSource[] = [];
  const confirmedContent = buildConfirmedProfileContent(input.profile);
  if (confirmedContent.trim()) {
    sources.push({
      sourceId: `profile-confirmed:${input.workspaceId}`,
      sourceType: ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
      label: '已确认业务知识',
      content: confirmedContent,
      priority: 0.18,
      verifiedByUser: true,
      evidenceTier: 'internal',
    });
  }

  const ruleContent = buildRuleContent(input.profile);
  if (ruleContent.trim()) {
    sources.push({
      sourceId: `workspace-rules:${input.workspaceId}`,
      sourceType: ContentKnowledgeSourceType.WorkspaceRule,
      label: '硬性规则',
      content: ruleContent,
      priority: 0.2,
      verifiedByUser: true,
      evidenceTier: 'internal',
    });
  }
  return sources;
};
