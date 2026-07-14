import type { EnterpriseLeadWorkspaceProfile } from '../../../shared/enterpriseLeadWorkspace/types';
import {
  type KnowledgeFactDomain,
  KnowledgeFactDomains,
  KnowledgeFactReviewStatus,
} from '../../../shared/knowledgeBase/constants';
import {
  buildEnterpriseKnowledgeKey,
  getEnterpriseProfileFieldValue,
  normalizeEnterpriseKnowledgeValue,
} from '../../../shared/knowledgeBase/enterpriseLeadProfileKnowledge';
import type { KnowledgeFactSummary } from '../../../shared/knowledgeBase/types';

export interface LegacyProfileKnowledgeSummary {
  id: string;
  domain: KnowledgeFactDomain;
  value: string;
  knowledgeKey: string;
}

export type WorkspaceAiKnowledgeRow =
  | { kind: 'normalized_fact'; fact: KnowledgeFactSummary }
  | { kind: 'legacy_profile'; item: LegacyProfileKnowledgeSummary };

export interface ComposeWorkspaceAiKnowledgeRowsInput {
  facts: readonly KnowledgeFactSummary[];
  profile: EnterpriseLeadWorkspaceProfile;
}

const collectConfirmedFactKeys = (facts: readonly KnowledgeFactSummary[]): Set<string> =>
  new Set(
    facts.flatMap(fact => {
      if (fact.reviewStatus !== KnowledgeFactReviewStatus.Confirmed) {
        return [];
      }
      const key = buildEnterpriseKnowledgeKey(fact.domain, fact.value);
      return key ? [key] : [];
    }),
  );

export const composeWorkspaceAiKnowledgeRows = ({
  facts,
  profile,
}: ComposeWorkspaceAiKnowledgeRowsInput): WorkspaceAiKnowledgeRow[] => {
  const rows: WorkspaceAiKnowledgeRow[] = facts.map(fact => ({
    kind: 'normalized_fact',
    fact,
  }));
  const confirmedFactKeys = collectConfirmedFactKeys(facts);
  const emittedLegacyKeys = new Set<string>();

  for (const domain of KnowledgeFactDomains) {
    const fieldValue = getEnterpriseProfileFieldValue(profile, domain);
    const values = typeof fieldValue === 'string' ? [fieldValue] : fieldValue;
    for (const rawValue of values) {
      const { displayValue } = normalizeEnterpriseKnowledgeValue(rawValue);
      const knowledgeKey = buildEnterpriseKnowledgeKey(domain, displayValue);
      if (
        !knowledgeKey ||
        emittedLegacyKeys.has(knowledgeKey) ||
        confirmedFactKeys.has(knowledgeKey)
      ) {
        continue;
      }
      emittedLegacyKeys.add(knowledgeKey);
      rows.push({
        kind: 'legacy_profile',
        item: {
          id: `legacy-profile:${knowledgeKey}`,
          domain,
          value: displayValue,
          knowledgeKey,
        },
      });
    }
  }

  return rows;
};
