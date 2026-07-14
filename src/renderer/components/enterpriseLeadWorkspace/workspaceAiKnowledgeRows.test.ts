import { describe, expect, test } from 'vitest';

import type { EnterpriseLeadWorkspaceProfile } from '../../../shared/enterpriseLeadWorkspace/types';
import {
  KnowledgeFactDomain,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
} from '../../../shared/knowledgeBase/constants';
import { buildEnterpriseKnowledgeKey } from '../../../shared/knowledgeBase/enterpriseLeadProfileKnowledge';
import type { KnowledgeFactSummary } from '../../../shared/knowledgeBase/types';
import {
  composeWorkspaceAiKnowledgeRows,
  type LegacyProfileKnowledgeSummary,
} from './workspaceAiKnowledgeRows';

const profile = (
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

const fact = (
  id: string,
  domain: KnowledgeFactSummary['domain'],
  value: string,
  reviewStatus: KnowledgeFactSummary['reviewStatus'],
  revision = 1,
): KnowledgeFactSummary => ({
  id,
  domain,
  value,
  reviewStatus,
  sourceKind: KnowledgeFactSourceKind.Extracted,
  revision,
  projectionState: KnowledgeFactProjectionState.None,
  activeEvidenceCount: 1,
  staleEvidenceCount: 0,
  evidencePreview: null,
  createdAt: '2026-07-13T00:00:00.000Z',
  reviewedAt: null,
  updatedAt: '2026-07-13T00:00:00.000Z',
  archivedAt: null,
});

const legacyItems = (
  rows: ReturnType<typeof composeWorkspaceAiKnowledgeRows>,
): LegacyProfileKnowledgeSummary[] =>
  rows.flatMap(row => (row.kind === 'legacy_profile' ? [row.item] : []));

describe('composeWorkspaceAiKnowledgeRows', () => {
  test('composes every Profile domain in stable order and canonicalizes legacy identities', () => {
    const currentProfile = profile({
      companySummary: '  ACME   Factory  ',
      productList: [' Lead Radar ', ' lead   radar ', '', 'Export Kit'],
      productCapabilities: [' Small batch '],
      targetCustomers: [' Distributors '],
      applicationScenarios: [' Overseas launch '],
      sellingPoints: [' Fast delivery '],
      channelPreferences: [' Email '],
      prohibitedClaims: [' Never guarantee revenue '],
      contactRules: [' Contact once per week '],
      missingInfo: [' Target price '],
    });
    const normalizedFacts = [
      fact(
        'fact-confirmed-product',
        KnowledgeFactDomain.ProductList,
        '  LEAD radar ',
        KnowledgeFactReviewStatus.Confirmed,
      ),
      fact(
        'fact-pending-selling-point',
        KnowledgeFactDomain.SellingPoints,
        'FAST DELIVERY',
        KnowledgeFactReviewStatus.Pending,
      ),
      fact(
        'fact-rejected-contact-rule',
        KnowledgeFactDomain.ContactRules,
        'contact once per week',
        KnowledgeFactReviewStatus.Rejected,
      ),
    ];

    const rows = composeWorkspaceAiKnowledgeRows({
      facts: normalizedFacts,
      profile: currentProfile,
    });

    expect(rows.slice(0, 3)).toEqual(
      normalizedFacts.map(currentFact => ({ kind: 'normalized_fact', fact: currentFact })),
    );
    const legacy = legacyItems(rows);
    expect(legacy.map(item => [item.domain, item.value])).toEqual([
      [KnowledgeFactDomain.CompanySummary, 'ACME   Factory'],
      [KnowledgeFactDomain.ProductList, 'Export Kit'],
      [KnowledgeFactDomain.ProductCapabilities, 'Small batch'],
      [KnowledgeFactDomain.TargetCustomers, 'Distributors'],
      [KnowledgeFactDomain.ApplicationScenarios, 'Overseas launch'],
      [KnowledgeFactDomain.SellingPoints, 'Fast delivery'],
      [KnowledgeFactDomain.ChannelPreferences, 'Email'],
      [KnowledgeFactDomain.ProhibitedClaims, 'Never guarantee revenue'],
      [KnowledgeFactDomain.ContactRules, 'Contact once per week'],
      [KnowledgeFactDomain.MissingInfo, 'Target price'],
    ]);
    expect(legacy.map(item => item.knowledgeKey)).toEqual(
      legacy.map(item => buildEnterpriseKnowledgeKey(item.domain, item.value)),
    );
    expect(legacy.map(item => item.id)).toEqual(
      legacy.map(item => `legacy-profile:${item.knowledgeKey}`),
    );
    expect(new Set(legacy.map(item => item.id)).size).toBe(legacy.length);
  });

  test('only confirmed normalized facts suppress legacy rows and inputs remain immutable', () => {
    const currentProfile = profile({
      companySummary: ' Factory profile ',
      productList: ['Alpha', ' alpha ', '  ', 'Beta'],
      sellingPoints: ['Reliable'],
    });
    const normalizedFacts = [
      fact(
        'pending-company',
        KnowledgeFactDomain.CompanySummary,
        'factory profile',
        KnowledgeFactReviewStatus.Pending,
      ),
      fact(
        'rejected-selling',
        KnowledgeFactDomain.SellingPoints,
        ' reliable ',
        KnowledgeFactReviewStatus.Rejected,
      ),
      fact(
        'confirmed-alpha',
        KnowledgeFactDomain.ProductList,
        ' ALPHA ',
        KnowledgeFactReviewStatus.Confirmed,
      ),
    ];
    const profileSnapshot = JSON.stringify(currentProfile);
    const factsSnapshot = JSON.stringify(normalizedFacts);
    Object.values(currentProfile).forEach(value => {
      if (Array.isArray(value)) {
        Object.freeze(value);
      }
    });
    Object.freeze(currentProfile);
    normalizedFacts.forEach(Object.freeze);
    Object.freeze(normalizedFacts);

    const first = composeWorkspaceAiKnowledgeRows({
      facts: normalizedFacts,
      profile: currentProfile,
    });
    const second = composeWorkspaceAiKnowledgeRows({
      facts: normalizedFacts,
      profile: currentProfile,
    });

    expect(legacyItems(first).map(item => [item.domain, item.value])).toEqual([
      [KnowledgeFactDomain.CompanySummary, 'Factory profile'],
      [KnowledgeFactDomain.ProductList, 'Beta'],
      [KnowledgeFactDomain.SellingPoints, 'Reliable'],
    ]);
    expect(second).toEqual(first);
    expect(JSON.stringify(currentProfile)).toBe(profileSnapshot);
    expect(JSON.stringify(normalizedFacts)).toBe(factsSnapshot);
    expect(first.every(row => row.kind === 'normalized_fact' || row.kind === 'legacy_profile')).toBe(
      true,
    );
    expect(
      legacyItems(first).every(item => Object.keys(item).sort().join(',') === 'domain,id,knowledgeKey,value'),
    ).toBe(true);
  });
});
