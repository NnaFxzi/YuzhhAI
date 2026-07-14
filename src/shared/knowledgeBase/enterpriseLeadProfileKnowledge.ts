import type { EnterpriseLeadWorkspaceProfile } from '../enterpriseLeadWorkspace/types';
import { KnowledgeFactDomain, type KnowledgeFactDomain as KnowledgeFactDomainValue } from './constants';

export type EnterpriseProfileArrayKnowledgeDomain = Exclude<
  KnowledgeFactDomainValue,
  typeof KnowledgeFactDomain.CompanySummary
>;

export interface NormalizedEnterpriseKnowledgeValue {
  displayValue: string;
  normalizedValue: string;
}

const enterpriseKnowledgeDomains = Object.values(KnowledgeFactDomain);
const enterpriseKnowledgeDomainSet = new Set<KnowledgeFactDomainValue>(enterpriseKnowledgeDomains);

const cloneEnterpriseProfile = (
  profile: EnterpriseLeadWorkspaceProfile,
): EnterpriseLeadWorkspaceProfile => ({
  ...profile,
  companySummary: profile.companySummary,
  productList: [...profile.productList],
  productCapabilities: [...profile.productCapabilities],
  targetCustomers: [...profile.targetCustomers],
  applicationScenarios: [...profile.applicationScenarios],
  sellingPoints: [...profile.sellingPoints],
  channelPreferences: [...profile.channelPreferences],
  prohibitedClaims: [...profile.prohibitedClaims],
  contactRules: [...profile.contactRules],
  missingInfo: [...profile.missingInfo],
  ...(profile.confirmedKnowledgeKeys
    ? { confirmedKnowledgeKeys: [...profile.confirmedKnowledgeKeys] }
    : {}),
  ...(profile.ignoredKnowledgeKeys
    ? { ignoredKnowledgeKeys: [...profile.ignoredKnowledgeKeys] }
    : {}),
});

export const normalizeEnterpriseKnowledgeValue = (
  value: string,
): NormalizedEnterpriseKnowledgeValue => {
  const displayValue = value.trim();
  return {
    displayValue,
    normalizedValue: displayValue.replace(/\s+/g, ' ').toLowerCase(),
  };
};

export const buildEnterpriseKnowledgeKey = (
  domain: KnowledgeFactDomainValue,
  value: string,
): string => {
  const { normalizedValue } = normalizeEnterpriseKnowledgeValue(value);
  return normalizedValue ? `${domain}:${normalizedValue}` : '';
};

const getCanonicalEnterpriseKnowledgeKeyDomain = (key: string): KnowledgeFactDomainValue => {
  const separatorIndex = key.indexOf(':');
  if (separatorIndex <= 0) {
    throw new Error('Invalid enterprise knowledge key');
  }
  const domain = key.slice(0, separatorIndex) as KnowledgeFactDomainValue;
  const value = key.slice(separatorIndex + 1);
  if (
    !enterpriseKnowledgeDomainSet.has(domain) ||
    buildEnterpriseKnowledgeKey(domain, value) !== key
  ) {
    throw new Error('Invalid enterprise knowledge key');
  }
  return domain;
};

export const hasCanonicalEnterpriseProfileKnowledgeTrustOverlap = (
  profile: EnterpriseLeadWorkspaceProfile,
): boolean => {
  const ignoredKeys = new Set(profile.ignoredKnowledgeKeys ?? []);
  return (profile.confirmedKnowledgeKeys ?? []).some(key => {
    if (!ignoredKeys.has(key)) {
      return false;
    }
    try {
      getCanonicalEnterpriseKnowledgeKeyDomain(key);
      return true;
    } catch {
      return false;
    }
  });
};

export const appendEnterpriseProfileArrayValue = (
  profile: EnterpriseLeadWorkspaceProfile,
  domain: EnterpriseProfileArrayKnowledgeDomain,
  value: string,
): EnterpriseLeadWorkspaceProfile => {
  const nextProfile = cloneEnterpriseProfile(profile);
  const { displayValue, normalizedValue } = normalizeEnterpriseKnowledgeValue(value);
  if (!normalizedValue) {
    return nextProfile;
  }
  const alreadyPresent = nextProfile[domain].some(
    existingValue =>
      normalizeEnterpriseKnowledgeValue(existingValue).normalizedValue === normalizedValue,
  );
  if (!alreadyPresent) {
    nextProfile[domain].push(displayValue);
  }
  return nextProfile;
};

const setOptionalKnowledgeKeys = (
  profile: EnterpriseLeadWorkspaceProfile,
  field: 'confirmedKnowledgeKeys' | 'ignoredKnowledgeKeys',
  keys: string[],
): void => {
  if (keys.length > 0) {
    profile[field] = keys;
  } else {
    delete profile[field];
  }
};

const addKnowledgeKey = (keys: readonly string[] | undefined, key: string): string[] =>
  Array.from(new Set([...(keys ?? []), key]));

const removeKnowledgeKey = (keys: readonly string[] | undefined, key: string): string[] =>
  (keys ?? []).filter(existingKey => existingKey !== key);

export const confirmEnterpriseProfileKnowledgeKey = (
  profile: EnterpriseLeadWorkspaceProfile,
  key: string,
): EnterpriseLeadWorkspaceProfile => {
  if (!key) {
    return cloneEnterpriseProfile(profile);
  }
  getCanonicalEnterpriseKnowledgeKeyDomain(key);
  const nextProfile = cloneEnterpriseProfile(profile);
  setOptionalKnowledgeKeys(
    nextProfile,
    'confirmedKnowledgeKeys',
    addKnowledgeKey(nextProfile.confirmedKnowledgeKeys, key),
  );
  setOptionalKnowledgeKeys(
    nextProfile,
    'ignoredKnowledgeKeys',
    removeKnowledgeKey(nextProfile.ignoredKnowledgeKeys, key),
  );
  return nextProfile;
};

export const ignoreEnterpriseProfileKnowledgeKey = (
  profile: EnterpriseLeadWorkspaceProfile,
  key: string,
): EnterpriseLeadWorkspaceProfile => {
  if (!key) {
    return cloneEnterpriseProfile(profile);
  }
  getCanonicalEnterpriseKnowledgeKeyDomain(key);
  const nextProfile = cloneEnterpriseProfile(profile);
  setOptionalKnowledgeKeys(
    nextProfile,
    'confirmedKnowledgeKeys',
    removeKnowledgeKey(nextProfile.confirmedKnowledgeKeys, key),
  );
  setOptionalKnowledgeKeys(
    nextProfile,
    'ignoredKnowledgeKeys',
    addKnowledgeKey(nextProfile.ignoredKnowledgeKeys, key),
  );
  return nextProfile;
};

export const removeEnterpriseProfileKnowledgeKey = (
  profile: EnterpriseLeadWorkspaceProfile,
  key: string,
): EnterpriseLeadWorkspaceProfile => {
  if (!key) {
    return cloneEnterpriseProfile(profile);
  }
  getCanonicalEnterpriseKnowledgeKeyDomain(key);
  const nextProfile = cloneEnterpriseProfile(profile);
  setOptionalKnowledgeKeys(
    nextProfile,
    'confirmedKnowledgeKeys',
    removeKnowledgeKey(nextProfile.confirmedKnowledgeKeys, key),
  );
  setOptionalKnowledgeKeys(
    nextProfile,
    'ignoredKnowledgeKeys',
    removeKnowledgeKey(nextProfile.ignoredKnowledgeKeys, key),
  );
  return nextProfile;
};

export const getEnterpriseProfileFieldValue = (
  profile: EnterpriseLeadWorkspaceProfile,
  domain: KnowledgeFactDomainValue,
): string | string[] => {
  if (domain === KnowledgeFactDomain.CompanySummary) {
    return profile.companySummary;
  }
  return [...profile[domain]];
};

const normalizeArrayField = (values: readonly string[]): Set<string> =>
  new Set(
    values
      .map(value => normalizeEnterpriseKnowledgeValue(value).normalizedValue)
      .filter(Boolean),
  );

const areSetsEqual = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
  left.size === right.size && Array.from(left).every(value => right.has(value));

const collectChangedTrustKeys = (
  previousKeys: readonly string[] | undefined,
  nextKeys: readonly string[] | undefined,
): string[] => {
  const previousSet = new Set(previousKeys ?? []);
  const nextSet = new Set(nextKeys ?? []);
  return [
    ...Array.from(previousSet).filter(key => !nextSet.has(key)),
    ...Array.from(nextSet).filter(key => !previousSet.has(key)),
  ];
};

export const getChangedEnterpriseProfileFields = (
  previous: EnterpriseLeadWorkspaceProfile,
  next: EnterpriseLeadWorkspaceProfile,
): KnowledgeFactDomainValue[] => {
  const changedDomains = new Set<KnowledgeFactDomainValue>();
  for (const domain of enterpriseKnowledgeDomains) {
    const previousValue = getEnterpriseProfileFieldValue(previous, domain);
    const nextValue = getEnterpriseProfileFieldValue(next, domain);
    if (typeof previousValue === 'string' && typeof nextValue === 'string') {
      if (
        normalizeEnterpriseKnowledgeValue(previousValue).normalizedValue !==
        normalizeEnterpriseKnowledgeValue(nextValue).normalizedValue
      ) {
        changedDomains.add(domain);
      }
      continue;
    }
    if (
      Array.isArray(previousValue) &&
      Array.isArray(nextValue) &&
      !areSetsEqual(normalizeArrayField(previousValue), normalizeArrayField(nextValue))
    ) {
      changedDomains.add(domain);
    }
  }

  const changedTrustKeys = [
    ...collectChangedTrustKeys(previous.confirmedKnowledgeKeys, next.confirmedKnowledgeKeys),
    ...collectChangedTrustKeys(previous.ignoredKnowledgeKeys, next.ignoredKnowledgeKeys),
  ];
  for (const key of changedTrustKeys) {
    changedDomains.add(getCanonicalEnterpriseKnowledgeKeyDomain(key));
  }
  return enterpriseKnowledgeDomains.filter(domain => changedDomains.has(domain));
};
