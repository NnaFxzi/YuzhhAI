import Database from 'better-sqlite3';

import { buildEnterpriseLeadWorkspaceKnowledgeScopeId } from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceProfile,
} from '../../shared/enterpriseLeadWorkspace/types';
import { normalizeWorkspaceProfile } from '../../shared/enterpriseLeadWorkspace/validation';
import {
  KnowledgeFactDomain,
  type KnowledgeFactDomain as KnowledgeFactDomainValue,
  KnowledgeFactDomains,
} from '../../shared/knowledgeBase/constants';
import {
  buildEnterpriseKnowledgeKey,
  getChangedEnterpriseProfileFields,
  hasCanonicalEnterpriseProfileKnowledgeTrustOverlap,
} from '../../shared/knowledgeBase/enterpriseLeadProfileKnowledge';
import type { KnowledgeTrustedProfileIndexStore } from '../knowledgeBase/knowledgeTrustedProfileIndexStore';
import { runTransientSqliteWriteTransaction } from '../libs/sqliteTransactionRetry';

const MAX_SAFE_SQLITE_INTEGER = Number.MAX_SAFE_INTEGER;
const PROFILE_PERSISTENCE_STATE_CONFLICT = 'Workspace profile persistence state conflict';
const TRUSTED_PROFILE_INDEX_PERSISTENCE_STATE_CONFLICT =
  'Trusted profile index persistence state conflict';
const PROFILE_INVALID_REQUEST_MESSAGE = 'Invalid workspace profile request';

const sqlStringList = (values: readonly string[]): string =>
  values.map(value => `'${value.replaceAll("'", "''")}'`).join(', ');

const profileDomainSet = new Set<string>(KnowledgeFactDomains);

export const EnterpriseLeadWorkspaceProfilePersistenceStage = {
  AfterWorkspaceInsert: 'after_workspace_insert',
  AfterFieldInitialization: 'after_field_initialization',
  AfterInitialOutboxInsert: 'after_initial_outbox_insert',
  AfterProfileUpdate: 'after_profile_update',
  AfterFieldRevisionUpdate: 'after_field_revision_update',
  AfterProfileOutboxInsert: 'after_profile_outbox_insert',
} as const;
export type EnterpriseLeadWorkspaceProfilePersistenceStage =
  (typeof EnterpriseLeadWorkspaceProfilePersistenceStage)[keyof typeof EnterpriseLeadWorkspaceProfilePersistenceStage];

export interface EnterpriseLeadWorkspaceProfilePersistenceFaultDetails {
  field?: KnowledgeFactDomainValue;
  workspaceId?: string;
}

export type EnterpriseLeadWorkspaceProfilePersistenceFault = (
  stage: EnterpriseLeadWorkspaceProfilePersistenceStage,
  details: EnterpriseLeadWorkspaceProfilePersistenceFaultDetails,
) => void;

export interface CompareAndSwapWorkspaceProfileInput {
  workspaceId: string;
  expectedProfileRevision: number;
  nextProfile: EnterpriseLeadWorkspaceProfile;
  touchedFields: KnowledgeFactDomainValue[];
  now?: string;
}

export interface EnterpriseLeadWorkspaceProfileCasResult {
  workspace: EnterpriseLeadWorkspace;
  previousProfileRevision: number;
  profileRevision: number;
  touchedFieldRevisions: Partial<Record<KnowledgeFactDomainValue, number>>;
}

export interface EnterpriseLeadProfileConflictSnapshot {
  id: string;
  profile: EnterpriseLeadWorkspaceProfile;
  profileRevision: number;
  updatedAt: string;
}

export class EnterpriseLeadProfileRevisionConflictError extends Error {
  public readonly latestProfile: EnterpriseLeadProfileConflictSnapshot;

  constructor(latestProfile: unknown) {
    super('Workspace profile revision conflict');
    this.name = 'EnterpriseLeadProfileRevisionConflictError';
    this.latestProfile = cloneEnterpriseLeadProfileConflictSnapshot(latestProfile);
  }
}

export class EnterpriseLeadProfileInvalidRequestError extends Error {
  constructor() {
    super(PROFILE_INVALID_REQUEST_MESSAGE);
    this.name = 'EnterpriseLeadProfileInvalidRequestError';
  }
}

export interface EnterpriseLeadWorkspaceProfileRevisionStoreOptions {
  db: Database.Database;
  trustedProfileIndexStore: KnowledgeTrustedProfileIndexStore;
  loadWorkspace: (workspaceId: string) => EnterpriseLeadWorkspace | null;
  faultInjector?: EnterpriseLeadWorkspaceProfilePersistenceFault;
}

interface CurrentWorkspaceProfileRow {
  id: unknown;
  profile: unknown;
  profileRevision: unknown;
  updatedAt: unknown;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const cloneDenseStringArray = (
  value: unknown,
  invalid: () => never,
): string[] => {
  if (!Array.isArray(value)) {
    return invalid();
  }
  const length = value.length;
  const cloned: string[] = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      return invalid();
    }
    const item = value[index] as unknown;
    if (typeof item !== 'string') {
      return invalid();
    }
    cloned.push(item);
  }
  return cloned;
};

const validateRawProfile = (
  value: unknown,
  invalid: () => never,
): EnterpriseLeadWorkspaceProfile => {
  try {
    if (!isPlainObject(value) || !hasOwn(value, KnowledgeFactDomain.CompanySummary)) {
      return invalid();
    }
    const allowedKeys = new Set<string>([
      ...KnowledgeFactDomains,
      'confirmedKnowledgeKeys',
      'ignoredKnowledgeKeys',
    ]);
    if (Object.keys(value).some(key => !allowedKeys.has(key))) {
      return invalid();
    }
    const companySummary = value.companySummary;
    if (typeof companySummary !== 'string') {
      return invalid();
    }
    const cloneRequiredArrayField = (
      domain: Exclude<
        KnowledgeFactDomainValue,
        typeof KnowledgeFactDomain.CompanySummary
      >,
    ): string[] => {
      if (!hasOwn(value, domain)) {
        return invalid();
      }
      const source = value[domain];
      return cloneDenseStringArray(source, invalid);
    };
    const productList = cloneRequiredArrayField(KnowledgeFactDomain.ProductList);
    const productCapabilities = cloneRequiredArrayField(KnowledgeFactDomain.ProductCapabilities);
    const targetCustomers = cloneRequiredArrayField(KnowledgeFactDomain.TargetCustomers);
    const applicationScenarios = cloneRequiredArrayField(
      KnowledgeFactDomain.ApplicationScenarios,
    );
    const sellingPoints = cloneRequiredArrayField(KnowledgeFactDomain.SellingPoints);
    const channelPreferences = cloneRequiredArrayField(KnowledgeFactDomain.ChannelPreferences);
    const prohibitedClaims = cloneRequiredArrayField(KnowledgeFactDomain.ProhibitedClaims);
    const contactRules = cloneRequiredArrayField(KnowledgeFactDomain.ContactRules);
    const missingInfo = cloneRequiredArrayField(KnowledgeFactDomain.MissingInfo);
    const cloneOptionalTrustKeys = (
      field: 'confirmedKnowledgeKeys' | 'ignoredKnowledgeKeys',
    ): string[] | undefined => {
      if (!hasOwn(value, field)) {
        return undefined;
      }
      const source = value[field];
      return cloneDenseStringArray(source, invalid);
    };
    const confirmedKnowledgeKeys = cloneOptionalTrustKeys('confirmedKnowledgeKeys');
    const ignoredKnowledgeKeys = cloneOptionalTrustKeys('ignoredKnowledgeKeys');
    return {
      companySummary,
      productList,
      productCapabilities,
      targetCustomers,
      applicationScenarios,
      sellingPoints,
      channelPreferences,
      prohibitedClaims,
      contactRules,
      missingInfo,
      ...(confirmedKnowledgeKeys !== undefined ? { confirmedKnowledgeKeys } : {}),
      ...(ignoredKnowledgeKeys !== undefined ? { ignoredKnowledgeKeys } : {}),
    };
  } catch {
    return invalid();
  }
};

export const validateEnterpriseLeadWorkspaceProfileRequest = (
  value: unknown,
): EnterpriseLeadWorkspaceProfile =>
  validateRawProfile(value, () => {
    throw new EnterpriseLeadProfileInvalidRequestError();
  });

const parsePersistedProfile = (value: unknown): EnterpriseLeadWorkspaceProfile => {
  if (typeof value !== 'string') {
    throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
  }
  return validateRawProfile(parsed, () => {
    throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
  });
};

const cloneConflictProfile = (value: unknown): EnterpriseLeadWorkspaceProfile => {
  const invalid = (): never => {
    throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
  };
  if (!isPlainObject(value) || !hasOwn(value, KnowledgeFactDomain.CompanySummary)) {
    return invalid();
  }
  const companySummary = value.companySummary;
  if (typeof companySummary !== 'string') {
    return invalid();
  }
  const cloneRequiredArrayField = (
    domain: Exclude<
      KnowledgeFactDomainValue,
      typeof KnowledgeFactDomain.CompanySummary
    >,
  ): string[] => {
    if (!hasOwn(value, domain)) {
      return invalid();
    }
    const source = value[domain];
    return cloneDenseStringArray(source, invalid);
  };
  const productList = cloneRequiredArrayField(KnowledgeFactDomain.ProductList);
  const productCapabilities = cloneRequiredArrayField(KnowledgeFactDomain.ProductCapabilities);
  const targetCustomers = cloneRequiredArrayField(KnowledgeFactDomain.TargetCustomers);
  const applicationScenarios = cloneRequiredArrayField(KnowledgeFactDomain.ApplicationScenarios);
  const sellingPoints = cloneRequiredArrayField(KnowledgeFactDomain.SellingPoints);
  const channelPreferences = cloneRequiredArrayField(KnowledgeFactDomain.ChannelPreferences);
  const prohibitedClaims = cloneRequiredArrayField(KnowledgeFactDomain.ProhibitedClaims);
  const contactRules = cloneRequiredArrayField(KnowledgeFactDomain.ContactRules);
  const missingInfo = cloneRequiredArrayField(KnowledgeFactDomain.MissingInfo);
  const cloneOptionalTrustKeys = (
    field: 'confirmedKnowledgeKeys' | 'ignoredKnowledgeKeys',
  ): string[] | undefined => {
    if (!hasOwn(value, field)) {
      return undefined;
    }
    const source = value[field];
    return cloneDenseStringArray(source, invalid);
  };
  const confirmedKnowledgeKeys = cloneOptionalTrustKeys('confirmedKnowledgeKeys');
  const ignoredKnowledgeKeys = cloneOptionalTrustKeys('ignoredKnowledgeKeys');
  return {
    companySummary,
    productList,
    productCapabilities,
    targetCustomers,
    applicationScenarios,
    sellingPoints,
    channelPreferences,
    prohibitedClaims,
    contactRules,
    missingInfo,
    ...(confirmedKnowledgeKeys !== undefined ? { confirmedKnowledgeKeys } : {}),
    ...(ignoredKnowledgeKeys !== undefined ? { ignoredKnowledgeKeys } : {}),
  };
};

export const cloneEnterpriseLeadProfileConflictSnapshot = (
  value: unknown,
): EnterpriseLeadProfileConflictSnapshot => {
  try {
    if (
      !isPlainObject(value) ||
      !hasOwn(value, 'id') ||
      !hasOwn(value, 'profile') ||
      !hasOwn(value, 'profileRevision') ||
      !hasOwn(value, 'updatedAt')
    ) {
      throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
    }
    const id = value.id;
    const profileSource = value.profile;
    const profileRevision = value.profileRevision;
    const updatedAt = value.updatedAt;
    if (
      typeof id !== 'string' ||
      !id.trim() ||
      !isSafeRevision(profileRevision) ||
      typeof updatedAt !== 'string' ||
      !updatedAt.trim() ||
      !Number.isFinite(Date.parse(updatedAt))
    ) {
      throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
    }
    const clonedProfile = cloneConflictProfile(profileSource);
    return {
      id,
      profile: clonedProfile,
      profileRevision,
      updatedAt,
    };
  } catch {
    throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
  }
};

const isSafeRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

const requireWorkspaceId = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new EnterpriseLeadProfileInvalidRequestError();
  }
  return value;
};

const requireTimestamp = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new EnterpriseLeadProfileInvalidRequestError();
  }
  return value;
};

const getCanonicalKnowledgeKeyDomain = (key: string): KnowledgeFactDomainValue | null => {
  const separatorIndex = key.indexOf(':');
  if (separatorIndex <= 0) {
    return null;
  }
  const domainText = key.slice(0, separatorIndex);
  if (!profileDomainSet.has(domainText)) {
    return null;
  }
  const domain = domainText as KnowledgeFactDomainValue;
  return buildEnterpriseKnowledgeKey(domain, key.slice(separatorIndex + 1)) === key
    ? domain
    : null;
};

const collectTrustMembership = (
  profile: EnterpriseLeadWorkspaceProfile,
): Map<string, number> => {
  const membership = new Map<string, number>();
  for (const key of profile.confirmedKnowledgeKeys ?? []) {
    membership.set(key, (membership.get(key) ?? 0) | 1);
  }
  for (const key of profile.ignoredKnowledgeKeys ?? []) {
    membership.set(key, (membership.get(key) ?? 0) | 2);
  }
  return membership;
};

const rejectChangedMalformedTrustKeys = (
  previous: EnterpriseLeadWorkspaceProfile,
  next: EnterpriseLeadWorkspaceProfile,
): void => {
  const previousMembership = collectTrustMembership(previous);
  const nextMembership = collectTrustMembership(next);
  const keys = new Set([...previousMembership.keys(), ...nextMembership.keys()]);
  for (const key of keys) {
    if (
      previousMembership.get(key) !== nextMembership.get(key) &&
      getCanonicalKnowledgeKeyDomain(key) === null
    ) {
      throw new EnterpriseLeadProfileInvalidRequestError();
    }
  }
};

const normalizeTrustKeysPreservingMalformed = (keys: readonly string[] | undefined): string[] => {
  const normalized: string[] = [];
  const canonicalSeen = new Set<string>();
  for (const key of keys ?? []) {
    if (getCanonicalKnowledgeKeyDomain(key) === null) {
      normalized.push(key);
      continue;
    }
    if (!canonicalSeen.has(key)) {
      canonicalSeen.add(key);
      normalized.push(key);
    }
  }
  return normalized;
};

const normalizeProfileForPersistence = (
  profile: EnterpriseLeadWorkspaceProfile,
): EnterpriseLeadWorkspaceProfile => {
  const normalizedValues = normalizeWorkspaceProfile(profile);
  const confirmedKnowledgeKeys = normalizeTrustKeysPreservingMalformed(
    profile.confirmedKnowledgeKeys,
  );
  const ignoredKnowledgeKeys = normalizeTrustKeysPreservingMalformed(profile.ignoredKnowledgeKeys);
  delete normalizedValues.confirmedKnowledgeKeys;
  delete normalizedValues.ignoredKnowledgeKeys;
  return {
    ...normalizedValues,
    ...(confirmedKnowledgeKeys.length > 0 ? { confirmedKnowledgeKeys } : {}),
    ...(ignoredKnowledgeKeys.length > 0 ? { ignoredKnowledgeKeys } : {}),
  };
};

const readTouchedFields = (value: unknown): KnowledgeFactDomainValue[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > KnowledgeFactDomains.length) {
    throw new EnterpriseLeadProfileInvalidRequestError();
  }
  const touchedFields: KnowledgeFactDomainValue[] = [];
  const seen = new Set<string>();
  for (const field of value) {
    if (typeof field !== 'string' || !profileDomainSet.has(field) || seen.has(field)) {
      throw new EnterpriseLeadProfileInvalidRequestError();
    }
    seen.add(field);
    touchedFields.push(field as KnowledgeFactDomainValue);
  }
  return touchedFields;
};

export class EnterpriseLeadWorkspaceProfileRevisionStore {
  private readonly db: Database.Database;

  private readonly trustedProfileIndexStore: KnowledgeTrustedProfileIndexStore;

  private readonly loadWorkspace: (workspaceId: string) => EnterpriseLeadWorkspace | null;

  private readonly faultInjector?: EnterpriseLeadWorkspaceProfilePersistenceFault;

  constructor(options: EnterpriseLeadWorkspaceProfileRevisionStoreOptions) {
    this.db = options.db;
    this.trustedProfileIndexStore = options.trustedProfileIndexStore;
    this.loadWorkspace = options.loadWorkspace;
    this.faultInjector = options.faultInjector;
    this.initialize();
  }

  getDatabaseForInternalUse(): Database.Database {
    return this.db;
  }

  deleteWorkspaceFieldRevisionsInCurrentTransaction(workspaceId: string): number {
    if (!this.db.inTransaction) {
      throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
    }
    return this.db.prepare(`
      DELETE FROM enterprise_lead_workspace_profile_field_revisions
      WHERE workspace_id = ?
    `).run(requireWorkspaceId(workspaceId)).changes;
  }

  private initialize(): void {
    if (this.db.inTransaction) {
      throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
    }
    const initializeTransaction = this.db.transaction(() => {
      const columns = this.db.pragma('table_info(enterprise_lead_workspaces)') as Array<{
        name: string;
      }>;
      if (!columns.some(column => column.name === 'profile_revision')) {
        this.db.exec(`
          ALTER TABLE enterprise_lead_workspaces
          ADD COLUMN profile_revision INTEGER NOT NULL DEFAULT 1
          CHECK (
            TYPEOF(profile_revision) = 'integer'
            AND profile_revision BETWEEN 1 AND ${MAX_SAFE_SQLITE_INTEGER}
          );
        `);
      }
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS enterprise_lead_workspace_profile_field_revisions (
          workspace_id TEXT NOT NULL CHECK (TRIM(workspace_id) <> ''),
          field TEXT NOT NULL CHECK (field IN (${sqlStringList(KnowledgeFactDomains)})),
          revision INTEGER NOT NULL DEFAULT 1 CHECK (
            TYPEOF(revision) = 'integer'
            AND revision BETWEEN 1 AND ${MAX_SAFE_SQLITE_INTEGER}
          ),
          PRIMARY KEY (workspace_id, field)
        ) WITHOUT ROWID;
      `);
      const domainSelect = KnowledgeFactDomains
        .map((_, index) => `${index === 0 ? 'SELECT' : 'UNION ALL SELECT'} ? AS field`)
        .join('\n');
      this.db.prepare(`
        INSERT OR IGNORE INTO enterprise_lead_workspace_profile_field_revisions (
          workspace_id, field, revision
        )
        SELECT workspace.id, domain.field, 1
        FROM enterprise_lead_workspaces AS workspace
        CROSS JOIN (${domainSelect}) AS domain
      `).run(...KnowledgeFactDomains);
    });
    runTransientSqliteWriteTransaction(() => initializeTransaction.immediate());
  }

  getFieldRevision(workspaceId: string, field: KnowledgeFactDomainValue): number {
    const validWorkspaceId = requireWorkspaceId(workspaceId);
    if (!profileDomainSet.has(field)) {
      throw new EnterpriseLeadProfileInvalidRequestError();
    }
    const row = this.db.prepare(`
      SELECT revision
      FROM enterprise_lead_workspace_profile_field_revisions
      WHERE workspace_id = ? AND field = ?
      LIMIT 1
    `).get(validWorkspaceId, field) as { revision: unknown } | undefined;
    if (!row || !isSafeRevision(row.revision)) {
      throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
    }
    return row.revision;
  }

  compareAndSwapProfile(
    input: CompareAndSwapWorkspaceProfileInput,
  ): EnterpriseLeadWorkspaceProfileCasResult {
    if (this.db.inTransaction) {
      throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
    }
    const transaction = this.db.transaction(() =>
      this.compareAndSwapProfileInCurrentTransaction(input));
    return runTransientSqliteWriteTransaction(() => transaction.immediate());
  }

  compareAndSwapProfileInCurrentTransaction(
    input: CompareAndSwapWorkspaceProfileInput,
  ): EnterpriseLeadWorkspaceProfileCasResult {
    if (!this.db.inTransaction) {
      throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
    }
    const workspaceId = requireWorkspaceId(input.workspaceId);
    if (!isSafeRevision(input.expectedProfileRevision)) {
      throw new EnterpriseLeadProfileInvalidRequestError();
    }
    const currentRow = this.readCurrentProfileRow(workspaceId);
    const currentProfile = parsePersistedProfile(currentRow.profile);
    if (currentRow.profileRevision !== input.expectedProfileRevision) {
      throw new EnterpriseLeadProfileRevisionConflictError({
        id: workspaceId,
        profile: currentProfile,
        profileRevision: currentRow.profileRevision,
        updatedAt: currentRow.updatedAt,
      });
    }
    const nextRawProfile = validateEnterpriseLeadWorkspaceProfileRequest(input.nextProfile);
    const touchedFields = readTouchedFields(input.touchedFields);
    if (hasCanonicalEnterpriseProfileKnowledgeTrustOverlap(nextRawProfile)) {
      throw new EnterpriseLeadProfileInvalidRequestError();
    }
    rejectChangedMalformedTrustKeys(currentProfile, nextRawProfile);
    const nextProfile = normalizeProfileForPersistence(nextRawProfile);
    let changedFields: KnowledgeFactDomainValue[];
    try {
      changedFields = getChangedEnterpriseProfileFields(currentProfile, nextProfile);
    } catch {
      throw new EnterpriseLeadProfileInvalidRequestError();
    }
    const touchedFieldSet = new Set(touchedFields);
    if (changedFields.some(field => !touchedFieldSet.has(field))) {
      throw new EnterpriseLeadProfileInvalidRequestError();
    }
    const nextProfileRevision = currentRow.profileRevision + 1;
    if (!isSafeRevision(nextProfileRevision)) {
      throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
    }
    const now = requireTimestamp(input.now ?? new Date().toISOString());
    const updateResult = this.db.prepare(`
      UPDATE enterprise_lead_workspaces
      SET profile = ?, profile_revision = ?, updated_at = ?
      WHERE id = ? AND profile_revision = ?
    `).run(
      JSON.stringify(nextProfile),
      nextProfileRevision,
      now,
      workspaceId,
      currentRow.profileRevision,
    );
    if (updateResult.changes !== 1) {
      throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
    }
    this.emitFault(EnterpriseLeadWorkspaceProfilePersistenceStage.AfterProfileUpdate, {
      workspaceId,
    });

    const touchedFieldRevisions: Partial<Record<KnowledgeFactDomainValue, number>> = {};
    for (const field of touchedFields) {
      const fieldUpdate = this.db.prepare(`
        UPDATE enterprise_lead_workspace_profile_field_revisions
        SET revision = revision + 1
        WHERE workspace_id = ? AND field = ? AND revision < ?
      `).run(workspaceId, field, MAX_SAFE_SQLITE_INTEGER);
      if (fieldUpdate.changes !== 1) {
        throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
      }
      touchedFieldRevisions[field] = this.getFieldRevision(workspaceId, field);
      this.emitFault(EnterpriseLeadWorkspaceProfilePersistenceStage.AfterFieldRevisionUpdate, {
        field,
        workspaceId,
      });
    }

    const enqueueResult = this.trustedProfileIndexStore.enqueueInCurrentTransaction({
      workspaceId,
      profileRevision: nextProfileRevision,
      now,
    });
    if (
      !enqueueResult.inserted ||
      enqueueResult.job.scopeId !== buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId)
    ) {
      throw new Error(TRUSTED_PROFILE_INDEX_PERSISTENCE_STATE_CONFLICT);
    }
    this.emitFault(EnterpriseLeadWorkspaceProfilePersistenceStage.AfterProfileOutboxInsert, {
      workspaceId,
    });

    const workspace = this.loadWorkspace(workspaceId);
    if (!workspace || workspace.profileRevision !== nextProfileRevision) {
      throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
    }
    return {
      workspace,
      previousProfileRevision: currentRow.profileRevision,
      profileRevision: nextProfileRevision,
      touchedFieldRevisions,
    };
  }

  initializeWorkspaceProfileInCurrentTransaction(input: {
    workspaceId: string;
    now: string;
  }): void {
    if (!this.db.inTransaction) {
      throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
    }
    const workspaceId = requireWorkspaceId(input.workspaceId);
    const now = requireTimestamp(input.now);
    const workspaceRow = this.db.prepare(`
      SELECT profile_revision AS profileRevision
      FROM enterprise_lead_workspaces
      WHERE id = ?
      LIMIT 1
    `).get(workspaceId) as { profileRevision: unknown } | undefined;
    if (!workspaceRow || workspaceRow.profileRevision !== 1) {
      throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
    }
    const insertField = this.db.prepare(`
      INSERT INTO enterprise_lead_workspace_profile_field_revisions (
        workspace_id, field, revision
      ) VALUES (?, ?, 1)
    `);
    for (const field of KnowledgeFactDomains) {
      insertField.run(workspaceId, field);
    }
    this.emitFault(EnterpriseLeadWorkspaceProfilePersistenceStage.AfterFieldInitialization, {
      workspaceId,
    });
    const enqueueResult = this.trustedProfileIndexStore.enqueueInCurrentTransaction({
      workspaceId,
      profileRevision: 1,
      now,
    });
    if (
      !enqueueResult.inserted ||
      enqueueResult.job.scopeId !== buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId)
    ) {
      throw new Error(TRUSTED_PROFILE_INDEX_PERSISTENCE_STATE_CONFLICT);
    }
    this.emitFault(EnterpriseLeadWorkspaceProfilePersistenceStage.AfterInitialOutboxInsert, {
      workspaceId,
    });
  }

  private readCurrentProfileRow(workspaceId: string): {
    id: string;
    profile: string;
    profileRevision: number;
    updatedAt: string;
  } {
    const row = this.db.prepare(`
      SELECT
        id,
        profile,
        profile_revision AS profileRevision,
        updated_at AS updatedAt
      FROM enterprise_lead_workspaces
      WHERE id = ?
      LIMIT 1
    `).get(workspaceId) as CurrentWorkspaceProfileRow | undefined;
    if (
      !row ||
      row.id !== workspaceId ||
      typeof row.profile !== 'string' ||
      !isSafeRevision(row.profileRevision) ||
      typeof row.updatedAt !== 'string' ||
      !row.updatedAt.trim() ||
      !Number.isFinite(Date.parse(row.updatedAt))
    ) {
      throw new Error(PROFILE_PERSISTENCE_STATE_CONFLICT);
    }
    return {
      id: row.id,
      profile: row.profile,
      profileRevision: row.profileRevision,
      updatedAt: row.updatedAt,
    };
  }

  private emitFault(
    stage: EnterpriseLeadWorkspaceProfilePersistenceStage,
    details: EnterpriseLeadWorkspaceProfilePersistenceFaultDetails,
  ): void {
    this.faultInjector?.(stage, details);
  }
}
