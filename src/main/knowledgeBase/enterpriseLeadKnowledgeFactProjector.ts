import Database from 'better-sqlite3';

import type { EnterpriseLeadWorkspaceProfile } from '../../shared/enterpriseLeadWorkspace/types';
import {
  KNOWLEDGE_EVIDENCE_PREVIEW_MAX_CHARS,
  KnowledgeBaseErrorCode,
  KnowledgeFactArchiveProjectionDecision,
  type KnowledgeFactArchiveProjectionDecision as KnowledgeFactArchiveProjectionDecisionValue,
  KnowledgeFactDomain,
  type KnowledgeFactDomain as KnowledgeFactDomainValue,
  KnowledgeFactDomains,
  KnowledgeFactProfileProjectionAction,
  KnowledgeFactProjectionConflictKind,
  KnowledgeFactProjectionOperation,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
} from '../../shared/knowledgeBase/constants';
import {
  appendEnterpriseProfileArrayValue,
  buildEnterpriseKnowledgeKey,
  confirmEnterpriseProfileKnowledgeKey,
  getChangedEnterpriseProfileFields,
  getEnterpriseProfileFieldValue,
  ignoreEnterpriseProfileKnowledgeKey,
  normalizeEnterpriseKnowledgeValue,
  removeEnterpriseProfileKnowledgeKey,
} from '../../shared/knowledgeBase/enterpriseLeadProfileKnowledge';
import type {
  KnowledgeFactArchiveResult,
  KnowledgeFactEvidenceSummary,
  KnowledgeFactProjectionConflict,
  KnowledgeFactReviewResult,
  KnowledgeFactSummary,
} from '../../shared/knowledgeBase/types';
import {
  type EnterpriseLeadWorkspaceProfileRevisionStore,
  validateEnterpriseLeadWorkspaceProfileRequest,
} from '../enterpriseLeadWorkspace/profileRevisionStore';
import {
  isTransientSqliteBusyError,
  runTransientSqliteWriteTransaction,
} from '../libs/sqliteTransactionRetry';
import type { KnowledgeFact } from './knowledgeEnrichmentTypes';
import {
  type KnowledgeFactProfileProjectionLedger,
  KnowledgeFactProjectionStore,
  KnowledgeFactProjectionStoreError,
} from './knowledgeFactProjectionStore';
import { KnowledgeFactStateError, KnowledgeFactStore } from './knowledgeFactStore';

type ProjectorErrorCode =
  | typeof KnowledgeBaseErrorCode.InvalidRequest
  | typeof KnowledgeBaseErrorCode.FactEvidenceStale
  | typeof KnowledgeBaseErrorCode.FactRevisionConflict
  | typeof KnowledgeBaseErrorCode.EnrichmentPersistenceFailed;

export interface ConfirmKnowledgeFactInput {
  factId: string;
  expectedRevision: number;
  replaceExisting?: boolean;
  expectedFieldRevision?: number;
}

export interface RejectKnowledgeFactInput {
  factId: string;
  expectedRevision: number;
}

export interface ArchiveKnowledgeFactInput {
  factId: string;
  expectedRevision: number;
  projectionDecision?: KnowledgeFactArchiveProjectionDecisionValue;
  expectedFieldRevision?: number;
}

export const KnowledgeFactProjectorStage = {
  AfterRevalidationBeforeFirstWrite: 'after_revalidation_before_first_write',
  AfterProfileChange: 'after_profile_change',
  AfterProjectionChange: 'after_projection_change',
  AfterFactTransition: 'after_fact_transition',
  AfterRequestRecalculation: 'after_request_recalculation',
} as const;
export type KnowledgeFactProjectorStage =
  (typeof KnowledgeFactProjectorStage)[keyof typeof KnowledgeFactProjectorStage];

export interface EnterpriseLeadKnowledgeFactProjectorOptions {
  clock?: () => string;
  onStage?: (stage: KnowledgeFactProjectorStage) => void;
  onTrustedRefreshCommitted?: (workspaceId: string) => void;
}

type CurrentProfileSnapshot = {
  profile: EnterpriseLeadWorkspaceProfile;
  profileRevision: number;
  fieldRevision: number;
};

type ConfirmProjectionPlan = {
  action: typeof KnowledgeFactProfileProjectionAction[keyof typeof KnowledgeFactProfileProjectionAction];
  appliedValue: string | string[];
  priorValue: string | string[];
  key: string;
  nextProfile: EnterpriseLeadWorkspaceProfile;
  priorConfirmedKeyPresent: boolean;
  priorIgnoredKeyPresent: boolean;
};

const projectorErrorMessages: Record<ProjectorErrorCode, string> = {
  [KnowledgeBaseErrorCode.InvalidRequest]: 'Knowledge fact request is invalid',
  [KnowledgeBaseErrorCode.FactEvidenceStale]: 'Knowledge fact evidence is stale',
  [KnowledgeBaseErrorCode.FactRevisionConflict]: 'Knowledge fact revision conflict',
  [KnowledgeBaseErrorCode.EnrichmentPersistenceFailed]: 'Knowledge fact review failed',
};

const projectorErrorCodeSet = new Set<string>(Object.keys(projectorErrorMessages));
const archiveDecisionSet = new Set<string>(Object.values(KnowledgeFactArchiveProjectionDecision));
const projectionOperationSet = new Set<string>(Object.values(KnowledgeFactProjectionOperation));
const projectionConflictKindSet = new Set<string>(
  Object.values(KnowledgeFactProjectionConflictKind),
);
const projectionDomainSet = new Set<string>(KnowledgeFactDomains);

export class KnowledgeFactProjectorError extends Error {
  readonly code: ProjectorErrorCode;

  constructor(inputCode: ProjectorErrorCode) {
    const code = projectorErrorCodeSet.has(inputCode)
      ? inputCode
      : KnowledgeBaseErrorCode.EnrichmentPersistenceFailed;
    super(projectorErrorMessages[code]);
    this.name = 'KnowledgeFactProjectorError';
    this.code = code;
    delete this.stack;
  }

  toJSON(): { code: ProjectorErrorCode; message: string } {
    return { code: this.code, message: this.message };
  }
}

const cloneConflictFieldValue = (value: unknown): string | string[] => {
  if (typeof value === 'string') {
    return value;
  }
  if (!Array.isArray(value)) {
    throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
  }
  const cloned: string[] = [];
  const length = value.length;
  for (let index = 0; index < length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new KnowledgeFactProjectorError(
        KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
      );
    }
    const item: unknown = value[index];
    if (typeof item !== 'string') {
      throw new KnowledgeFactProjectorError(
        KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
      );
    }
    cloned.push(item);
  }
  return cloned;
};

const cloneProjectionConflict = (
  conflict: unknown,
): KnowledgeFactProjectionConflict => {
  if (!isPlainObject(conflict)) {
    throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
  }
  const operation = conflict.operation;
  const kind = conflict.kind;
  const factId = conflict.factId;
  const factRevision = conflict.factRevision;
  const domain = conflict.domain;
  const rawCurrentFieldValue = conflict.currentFieldValue;
  const fieldRevision = conflict.fieldRevision;
  if (
    typeof operation !== 'string' || !projectionOperationSet.has(operation) ||
    typeof kind !== 'string' || !projectionConflictKindSet.has(kind) ||
    !isNonEmptyString(factId) ||
    !isSafePositiveInteger(factRevision) ||
    typeof domain !== 'string' || !projectionDomainSet.has(domain) ||
    !isSafePositiveInteger(fieldRevision) ||
    (
      kind === KnowledgeFactProjectionConflictKind.CompanySummaryReplacement &&
      domain !== KnowledgeFactDomain.CompanySummary
    )
  ) {
    throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
  }
  const currentFieldValue = cloneConflictFieldValue(rawCurrentFieldValue);
  if (
    (domain === KnowledgeFactDomain.CompanySummary && typeof currentFieldValue !== 'string') ||
    (domain !== KnowledgeFactDomain.CompanySummary && !Array.isArray(currentFieldValue))
  ) {
    throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
  }
  return {
    operation: operation as KnowledgeFactProjectionConflict['operation'],
    kind: kind as KnowledgeFactProjectionConflict['kind'],
    factId,
    factRevision,
    domain: domain as KnowledgeFactDomainValue,
    currentFieldValue,
    fieldRevision,
  };
};

export class KnowledgeFactProjectionConflictError extends Error {
  readonly code = KnowledgeBaseErrorCode.FactProjectionConflict;

  readonly conflict: KnowledgeFactProjectionConflict;

  constructor(conflict: unknown) {
    super('Knowledge fact projection conflict');
    this.name = 'KnowledgeFactProjectionConflictError';
    this.conflict = cloneProjectionConflict(conflict);
    delete this.stack;
  }

  toJSON(): {
    code: typeof KnowledgeBaseErrorCode.FactProjectionConflict;
    conflict: KnowledgeFactProjectionConflict;
  } {
    return { code: this.code, conflict: cloneProjectionConflict(this.conflict) };
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasExactOwnKeys = (
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
): boolean => {
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const keys = Object.keys(value);
  return requiredKeys.every(key => Object.prototype.hasOwnProperty.call(value, key)) &&
    keys.every(key => allowed.has(key));
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isSafePositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

const isCanonicalTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    return false;
  }
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};

const invalidRequest = (): never => {
  throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.InvalidRequest);
};

const normalizeConfirmInput = (input: ConfirmKnowledgeFactInput): ConfirmKnowledgeFactInput => {
  if (!isPlainObject(input) || !hasExactOwnKeys(
    input,
    ['factId', 'expectedRevision'],
    ['replaceExisting', 'expectedFieldRevision'],
  )) {
    return invalidRequest();
  }
  const factId = input.factId;
  const expectedRevision = input.expectedRevision;
  const replaceExisting = input.replaceExisting;
  const expectedFieldRevision = input.expectedFieldRevision;
  if (
    !isNonEmptyString(factId) ||
    !isSafePositiveInteger(expectedRevision) ||
    (replaceExisting !== undefined && typeof replaceExisting !== 'boolean') ||
    (expectedFieldRevision !== undefined && !isSafePositiveInteger(expectedFieldRevision)) ||
    (replaceExisting === true && expectedFieldRevision === undefined) ||
    (replaceExisting !== true && expectedFieldRevision !== undefined)
  ) {
    return invalidRequest();
  }
  return {
    factId,
    expectedRevision,
    ...(replaceExisting !== undefined ? { replaceExisting } : {}),
    ...(expectedFieldRevision !== undefined ? { expectedFieldRevision } : {}),
  };
};

const normalizeRejectInput = (input: RejectKnowledgeFactInput): RejectKnowledgeFactInput => {
  if (
    !isPlainObject(input) ||
    !hasExactOwnKeys(input, ['factId', 'expectedRevision'], [])
  ) {
    return invalidRequest();
  }
  const factId = input.factId;
  const expectedRevision = input.expectedRevision;
  if (!isNonEmptyString(factId) || !isSafePositiveInteger(expectedRevision)) {
    return invalidRequest();
  }
  return { factId, expectedRevision };
};

const normalizeArchiveInput = (input: ArchiveKnowledgeFactInput): ArchiveKnowledgeFactInput => {
  if (!isPlainObject(input) || !hasExactOwnKeys(
    input,
    ['factId', 'expectedRevision'],
    ['projectionDecision', 'expectedFieldRevision'],
  )) {
    return invalidRequest();
  }
  const factId = input.factId;
  const expectedRevision = input.expectedRevision;
  const projectionDecision = input.projectionDecision;
  const expectedFieldRevision = input.expectedFieldRevision;
  if (
    !isNonEmptyString(factId) ||
    !isSafePositiveInteger(expectedRevision) ||
    (
      projectionDecision !== undefined &&
      !archiveDecisionSet.has(projectionDecision)
    ) ||
    (expectedFieldRevision !== undefined && !isSafePositiveInteger(expectedFieldRevision)) ||
    (
      projectionDecision === KnowledgeFactArchiveProjectionDecision.RemoveCurrent &&
      expectedFieldRevision === undefined
    ) ||
    (
      projectionDecision !== KnowledgeFactArchiveProjectionDecision.RemoveCurrent &&
      expectedFieldRevision !== undefined
    )
  ) {
    return invalidRequest();
  }
  return {
    factId,
    expectedRevision,
    ...(projectionDecision !== undefined ? { projectionDecision } : {}),
    ...(expectedFieldRevision !== undefined ? { expectedFieldRevision } : {}),
  };
};

const cloneProfile = (
  profile: EnterpriseLeadWorkspaceProfile,
): EnterpriseLeadWorkspaceProfile => validateEnterpriseLeadWorkspaceProfileRequest(profile);

const setProfileFieldValue = (
  profile: EnterpriseLeadWorkspaceProfile,
  domain: KnowledgeFactDomainValue,
  value: string | string[],
): EnterpriseLeadWorkspaceProfile => {
  const next = cloneProfile(profile);
  if (domain === KnowledgeFactDomain.CompanySummary) {
    if (typeof value !== 'string') {
      throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
    }
    next.companySummary = value;
    return next;
  }
  if (!Array.isArray(value)) {
    throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
  }
  next[domain] = [...value];
  return next;
};

const valuesExactlyEqual = (
  left: string | string[],
  right: string | string[],
): boolean => {
  if (typeof left === 'string' || typeof right === 'string') {
    return typeof left === 'string' && typeof right === 'string' && left === right;
  }
  return left.length === right.length && left.every((value, index) => value === right[index]);
};

const restoreKnowledgeKeyState = (
  profile: EnterpriseLeadWorkspaceProfile,
  key: string,
  ledger: KnowledgeFactProfileProjectionLedger,
): EnterpriseLeadWorkspaceProfile => {
  if (ledger.priorConfirmedKeyPresent) {
    return confirmEnterpriseProfileKnowledgeKey(profile, key);
  }
  if (ledger.priorIgnoredKeyPresent) {
    return ignoreEnterpriseProfileKnowledgeKey(profile, key);
  }
  return removeEnterpriseProfileKnowledgeKey(profile, key);
};

const removeProjectedArrayValue = (
  profile: EnterpriseLeadWorkspaceProfile,
  domain: Exclude<KnowledgeFactDomainValue, typeof KnowledgeFactDomain.CompanySummary>,
  normalizedValue: string,
): EnterpriseLeadWorkspaceProfile => setProfileFieldValue(
  profile,
  domain,
  profile[domain].filter(value =>
    normalizeEnterpriseKnowledgeValue(value).normalizedValue !== normalizedValue),
);

export class EnterpriseLeadKnowledgeFactProjector {
  private readonly clock: () => string;

  private readonly onStage?: (stage: KnowledgeFactProjectorStage) => void;

  private readonly onTrustedRefreshCommitted?: (workspaceId: string) => void;

  constructor(
    private readonly db: Database.Database,
    private readonly factStore: KnowledgeFactStore,
    private readonly projectionStore: KnowledgeFactProjectionStore,
    private readonly profileRevisionStore: EnterpriseLeadWorkspaceProfileRevisionStore,
    options: EnterpriseLeadKnowledgeFactProjectorOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.onStage = options.onStage;
    this.onTrustedRefreshCommitted = options.onTrustedRefreshCommitted;
    if (
      db.inTransaction ||
      factStore.getDatabaseForInternalUse() !== db ||
      projectionStore.getDatabaseForInternalUse() !== db ||
      profileRevisionStore.getDatabaseForInternalUse() !== db
    ) {
      throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
    }
  }

  confirmFact(input: ConfirmKnowledgeFactInput): KnowledgeFactReviewResult {
    return this.runMutation(() => {
      const normalized = normalizeConfirmInput(input);
      const now = this.readNow();
      const transaction = this.db.transaction(() => this.confirmInCurrentTransaction(
        normalized,
        now,
      ));
      const result = runTransientSqliteWriteTransaction(transaction);
      if (result.profileChanged) this.notifyTrustedRefresh(normalized.factId);
      return result;
    });
  }

  rejectFact(input: RejectKnowledgeFactInput): KnowledgeFactReviewResult {
    return this.runMutation(() => {
      const normalized = normalizeRejectInput(input);
      const now = this.readNow();
      const transaction = this.db.transaction(() => this.rejectInCurrentTransaction(
        normalized,
        now,
      ));
      return runTransientSqliteWriteTransaction(transaction);
    });
  }

  archiveFact(input: ArchiveKnowledgeFactInput): KnowledgeFactArchiveResult {
    return this.runMutation(() => {
      const normalized = normalizeArchiveInput(input);
      const now = this.readNow();
      const transaction = this.db.transaction(() => this.archiveInCurrentTransaction(
        normalized,
        now,
      ));
      const result = runTransientSqliteWriteTransaction(transaction);
      if (result.profileChanged) this.notifyTrustedRefresh(normalized.factId);
      return result;
    });
  }

  private notifyTrustedRefresh(factId: string): void {
    const workspaceId = this.factStore.getFact(factId)?.workspaceId;
    if (!workspaceId) return;
    try {
      this.onTrustedRefreshCommitted?.(workspaceId);
    } catch {
      console.warn('[KnowledgeFactProjector]', { code: 'trusted_refresh_wake_failed' });
    }
  }

  private confirmInCurrentTransaction(
    input: ConfirmKnowledgeFactInput,
    now: string,
  ): KnowledgeFactReviewResult {
    const latestFact = this.factStore.getFact(input.factId);
    if (latestFact && latestFact.revision !== input.expectedRevision) {
      this.emitStage(KnowledgeFactProjectorStage.AfterRevalidationBeforeFirstWrite);
      this.factStore.getReviewFactInCurrentTransaction({
        factId: input.factId,
        expectedRevision: latestFact.revision,
        requireActiveCurrentEvidence: true,
      });
      throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.FactRevisionConflict);
    }
    const fact = this.factStore.getReviewFactInCurrentTransaction({
      factId: input.factId,
      expectedRevision: input.expectedRevision,
      requireActiveCurrentEvidence: true,
    });
    const current = this.readCurrentProfile(fact.workspaceId, fact.domain);
    const plan = this.buildConfirmPlan(fact, current, input);
    this.emitStage(KnowledgeFactProjectorStage.AfterRevalidationBeforeFirstWrite);

    const changedFields = getChangedEnterpriseProfileFields(current.profile, plan.nextProfile);
    const profileChanged = changedFields.length > 0;
    let appliedProfileRevision = current.profileRevision;
    let appliedFieldRevision = current.fieldRevision;
    let appliedProfile = plan.nextProfile;
    if (profileChanged) {
      const cas = this.profileRevisionStore.compareAndSwapProfileInCurrentTransaction({
        workspaceId: fact.workspaceId,
        expectedProfileRevision: current.profileRevision,
        nextProfile: plan.nextProfile,
        touchedFields: [fact.domain],
        now,
      });
      appliedProfileRevision = cas.profileRevision;
      const fieldRevision = cas.touchedFieldRevisions[fact.domain];
      if (!isSafePositiveInteger(fieldRevision)) {
        throw new KnowledgeFactProjectorError(
          KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
        );
      }
      appliedFieldRevision = fieldRevision;
      appliedProfile = cas.workspace.profile;
    }
    this.emitStage(KnowledgeFactProjectorStage.AfterProfileChange);

    const appliedValue = getEnterpriseProfileFieldValue(appliedProfile, fact.domain);
    this.projectionStore.applyProjectionInCurrentTransaction({
      factId: fact.id,
      workspaceId: fact.workspaceId,
      domain: fact.domain,
      normalizedValue: fact.normalizedValue,
      action: plan.action,
      appliedValue,
      priorValue: plan.priorValue,
      appliedProfileRevision,
      appliedFieldRevision,
      priorConfirmedKeyPresent: plan.priorConfirmedKeyPresent,
      priorIgnoredKeyPresent: plan.priorIgnoredKeyPresent,
      appliedAt: now,
    });
    this.emitStage(KnowledgeFactProjectorStage.AfterProjectionChange);

    const transitioned = this.factStore.confirmFactInCurrentTransaction({
      factId: fact.id,
      expectedRevision: fact.revision,
      conflictGroupKey: [fact.workspaceId, fact.domain, fact.normalizedValue].join('\0'),
      now,
    });
    this.emitStage(KnowledgeFactProjectorStage.AfterFactTransition);
    this.factStore.recalculateLinkedRequestsInCurrentTransaction(fact.id, now);
    this.emitStage(KnowledgeFactProjectorStage.AfterRequestRecalculation);
    return {
      fact: this.projectFactSummary(transitioned),
      profileChanged,
      profileRevision: appliedProfileRevision,
      fieldRevision: appliedFieldRevision,
    };
  }

  private rejectInCurrentTransaction(
    input: RejectKnowledgeFactInput,
    now: string,
  ): KnowledgeFactReviewResult {
    const fact = this.factStore.getReviewFactInCurrentTransaction({
      factId: input.factId,
      expectedRevision: input.expectedRevision,
      requireActiveCurrentEvidence: false,
    });
    this.emitStage(KnowledgeFactProjectorStage.AfterRevalidationBeforeFirstWrite);
    const transitioned = this.factStore.rejectFactInCurrentTransaction({
      factId: fact.id,
      expectedRevision: fact.revision,
      now,
    });
    this.emitStage(KnowledgeFactProjectorStage.AfterFactTransition);
    this.factStore.recalculateLinkedRequestsInCurrentTransaction(fact.id, now);
    this.emitStage(KnowledgeFactProjectorStage.AfterRequestRecalculation);
    return {
      fact: this.projectFactSummary(transitioned),
      profileChanged: false,
      profileRevision: null,
      fieldRevision: null,
    };
  }

  private archiveInCurrentTransaction(
    input: ArchiveKnowledgeFactInput,
    now: string,
  ): KnowledgeFactArchiveResult {
    const fact = this.factStore.getFact(input.factId);
    if (!fact || fact.revision !== input.expectedRevision || fact.tombstonedAt !== null) {
      throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.FactRevisionConflict);
    }
    const ledger = this.projectionStore.getLedger(fact.id);
    if (!ledger) {
      const isUnprojectedArchive =
        fact.projectionState === KnowledgeFactProjectionState.None &&
        input.projectionDecision === undefined;
      const isRecoveredConflictArchive =
        fact.reviewStatus === KnowledgeFactReviewStatus.Confirmed &&
        fact.projectionState === KnowledgeFactProjectionState.Conflict &&
        input.projectionDecision === KnowledgeFactArchiveProjectionDecision.KeepCurrent;
      if (!isUnprojectedArchive && !isRecoveredConflictArchive) {
        throw new KnowledgeFactProjectorError(
          KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
        );
      }
      this.emitStage(KnowledgeFactProjectorStage.AfterRevalidationBeforeFirstWrite);
      const archived = this.factStore.archiveFactInCurrentTransaction({
        factId: fact.id,
        expectedRevision: fact.revision,
        projectionState: fact.projectionState,
        now,
      });
      this.emitStage(KnowledgeFactProjectorStage.AfterFactTransition);
      this.factStore.recalculateLinkedRequestsInCurrentTransaction(fact.id, now);
      this.emitStage(KnowledgeFactProjectorStage.AfterRequestRecalculation);
      return {
        fact: this.projectFactSummary(archived),
        profileChanged: false,
        profileRevision: null,
        fieldRevision: null,
      };
    }
    if (
      fact.reviewStatus !== KnowledgeFactReviewStatus.Confirmed ||
      fact.projectionState !== KnowledgeFactProjectionState.Active ||
      ledger.reversedAt !== null ||
      ledger.factId !== fact.id ||
      ledger.workspaceId !== fact.workspaceId ||
      ledger.domain !== fact.domain ||
      ledger.normalizedValue !== fact.normalizedValue
    ) {
      throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
    }
    const support = this.projectionStore.getSupportGroup(
      ledger.workspaceId,
      ledger.domain,
      ledger.normalizedValue,
    );
    if (!support || support.activeSupportCount < 1) {
      throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
    }
    const rootLedger = this.projectionStore.getSupportGroupRoot(
      ledger.workspaceId,
      ledger.domain,
      ledger.normalizedValue,
    );
    if (
      !rootLedger ||
      rootLedger.workspaceId !== ledger.workspaceId ||
      rootLedger.domain !== ledger.domain ||
      rootLedger.normalizedValue !== ledger.normalizedValue
    ) {
      throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
    }
    const current = this.readCurrentProfile(fact.workspaceId, fact.domain);
    const currentValue = getEnterpriseProfileFieldValue(current.profile, fact.domain);
    if (
      input.projectionDecision === undefined &&
      (
        current.fieldRevision !== rootLedger.appliedFieldRevision ||
        !valuesExactlyEqual(currentValue, rootLedger.appliedValue)
      )
    ) {
      this.throwProjectionConflict(
        KnowledgeFactProjectionOperation.Archive,
        KnowledgeFactProjectionConflictKind.ArchiveFieldChanged,
        fact,
        currentValue,
        current.fieldRevision,
      );
    }
    if (
      input.projectionDecision === KnowledgeFactArchiveProjectionDecision.RemoveCurrent &&
      input.expectedFieldRevision !== current.fieldRevision
    ) {
      this.throwProjectionConflict(
        KnowledgeFactProjectionOperation.Archive,
        KnowledgeFactProjectionConflictKind.ArchiveFieldChanged,
        fact,
        currentValue,
        current.fieldRevision,
      );
    }
    const remainingSupportCount = support.activeSupportCount - 1;
    const nextProfile = this.buildArchiveProfile(
      current.profile,
      fact,
      rootLedger,
      input.projectionDecision,
      remainingSupportCount,
    );
    this.emitStage(KnowledgeFactProjectorStage.AfterRevalidationBeforeFirstWrite);
    const changedFields = getChangedEnterpriseProfileFields(current.profile, nextProfile);
    const profileChanged = changedFields.length > 0;
    let profileRevision = current.profileRevision;
    let fieldRevision = current.fieldRevision;
    if (profileChanged) {
      const cas = this.profileRevisionStore.compareAndSwapProfileInCurrentTransaction({
        workspaceId: fact.workspaceId,
        expectedProfileRevision: current.profileRevision,
        nextProfile,
        touchedFields: [fact.domain],
        now,
      });
      profileRevision = cas.profileRevision;
      const touchedRevision = cas.touchedFieldRevisions[fact.domain];
      if (!isSafePositiveInteger(touchedRevision)) {
        throw new KnowledgeFactProjectorError(
          KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
        );
      }
      fieldRevision = touchedRevision;
    }
    this.emitStage(KnowledgeFactProjectorStage.AfterProfileChange);
    this.projectionStore.reverseProjectionInCurrentTransaction(fact.id, now);
    this.emitStage(KnowledgeFactProjectorStage.AfterProjectionChange);
    const archived = this.factStore.archiveFactInCurrentTransaction({
      factId: fact.id,
      expectedRevision: fact.revision,
      projectionState: KnowledgeFactProjectionState.Reversed,
      now,
    });
    this.emitStage(KnowledgeFactProjectorStage.AfterFactTransition);
    this.factStore.recalculateLinkedRequestsInCurrentTransaction(fact.id, now);
    this.emitStage(KnowledgeFactProjectorStage.AfterRequestRecalculation);
    return {
      fact: this.projectFactSummary(archived),
      profileChanged,
      profileRevision,
      fieldRevision,
    };
  }

  private buildConfirmPlan(
    fact: KnowledgeFact,
    current: CurrentProfileSnapshot,
    input: ConfirmKnowledgeFactInput,
  ): ConfirmProjectionPlan {
    const key = buildEnterpriseKnowledgeKey(fact.domain, fact.value);
    if (!key) {
      throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
    }
    const priorValue = getEnterpriseProfileFieldValue(current.profile, fact.domain);
    const priorConfirmedKeyPresent = current.profile.confirmedKnowledgeKeys?.includes(key) ?? false;
    const priorIgnoredKeyPresent = current.profile.ignoredKnowledgeKeys?.includes(key) ?? false;
    let action: ConfirmProjectionPlan['action'];
    let nextProfile: EnterpriseLeadWorkspaceProfile;
    if (fact.domain === KnowledgeFactDomain.CompanySummary) {
      if (
        input.replaceExisting === true &&
        input.expectedFieldRevision !== current.fieldRevision
      ) {
        this.throwProjectionConflict(
          KnowledgeFactProjectionOperation.Confirm,
          KnowledgeFactProjectionConflictKind.CompanySummaryReplacement,
          fact,
          current.profile.companySummary,
          current.fieldRevision,
        );
      }
      const currentNormalized = normalizeEnterpriseKnowledgeValue(
        current.profile.companySummary,
      ).normalizedValue;
      if (!currentNormalized) {
        action = KnowledgeFactProfileProjectionAction.Inserted;
        nextProfile = setProfileFieldValue(current.profile, fact.domain, fact.value.trim());
      } else if (currentNormalized === fact.normalizedValue) {
        action = KnowledgeFactProfileProjectionAction.PreexistingSupport;
        nextProfile = cloneProfile(current.profile);
      } else {
        if (input.replaceExisting !== true) {
          this.throwProjectionConflict(
            KnowledgeFactProjectionOperation.Confirm,
            KnowledgeFactProjectionConflictKind.CompanySummaryReplacement,
            fact,
            current.profile.companySummary,
            current.fieldRevision,
          );
        }
        action = KnowledgeFactProfileProjectionAction.ReplacedSingle;
        nextProfile = setProfileFieldValue(current.profile, fact.domain, fact.value.trim());
      }
    } else {
      if (input.replaceExisting === true || input.expectedFieldRevision !== undefined) {
        return invalidRequest();
      }
      const alreadyPresent = current.profile[fact.domain].some(value =>
        normalizeEnterpriseKnowledgeValue(value).normalizedValue === fact.normalizedValue);
      action = alreadyPresent
        ? KnowledgeFactProfileProjectionAction.PreexistingSupport
        : KnowledgeFactProfileProjectionAction.Inserted;
      nextProfile = appendEnterpriseProfileArrayValue(current.profile, fact.domain, fact.value);
    }
    nextProfile = confirmEnterpriseProfileKnowledgeKey(nextProfile, key);
    return {
      action,
      appliedValue: getEnterpriseProfileFieldValue(nextProfile, fact.domain),
      priorValue,
      key,
      nextProfile,
      priorConfirmedKeyPresent,
      priorIgnoredKeyPresent,
    };
  }

  private buildArchiveProfile(
    currentProfile: EnterpriseLeadWorkspaceProfile,
    fact: KnowledgeFact,
    ledger: KnowledgeFactProfileProjectionLedger,
    decision: KnowledgeFactArchiveProjectionDecisionValue | undefined,
    remainingSupportCount: number,
  ): EnterpriseLeadWorkspaceProfile {
    const key = buildEnterpriseKnowledgeKey(fact.domain, fact.value);
    let nextProfile = cloneProfile(currentProfile);
    if (remainingSupportCount > 0) {
      return confirmEnterpriseProfileKnowledgeKey(nextProfile, key);
    }
    if (decision !== KnowledgeFactArchiveProjectionDecision.KeepCurrent) {
      if (ledger.action === KnowledgeFactProfileProjectionAction.Inserted) {
        if (fact.domain === KnowledgeFactDomain.CompanySummary) {
          if (
            normalizeEnterpriseKnowledgeValue(currentProfile.companySummary).normalizedValue ===
            fact.normalizedValue
          ) {
            nextProfile = setProfileFieldValue(nextProfile, fact.domain, ledger.priorValue);
          }
        } else {
          nextProfile = removeProjectedArrayValue(
            nextProfile,
            fact.domain,
            fact.normalizedValue,
          );
        }
      } else if (
        ledger.action === KnowledgeFactProfileProjectionAction.ReplacedSingle &&
        valuesExactlyEqual(
          getEnterpriseProfileFieldValue(currentProfile, fact.domain),
          ledger.appliedValue,
        )
      ) {
        nextProfile = setProfileFieldValue(nextProfile, fact.domain, ledger.priorValue);
      }
    }
    return restoreKnowledgeKeyState(nextProfile, key, ledger);
  }

  private readCurrentProfile(
    workspaceId: string,
    domain: KnowledgeFactDomainValue,
  ): CurrentProfileSnapshot {
    const row = this.db.prepare(`
      SELECT profile, profile_revision AS profileRevision
      FROM enterprise_lead_workspaces
      WHERE id = ?
      LIMIT 1
    `).get(workspaceId) as { profile: unknown; profileRevision: unknown } | undefined;
    const fieldRow = this.db.prepare(`
      SELECT revision
      FROM enterprise_lead_workspace_profile_field_revisions
      WHERE workspace_id = ? AND field = ?
      LIMIT 1
    `).get(workspaceId, domain) as { revision: unknown } | undefined;
    if (
      !row ||
      typeof row.profile !== 'string' ||
      !isSafePositiveInteger(row.profileRevision) ||
      !fieldRow ||
      !isSafePositiveInteger(fieldRow.revision)
    ) {
      throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.profile) as unknown;
    } catch {
      throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
    }
    let profile: EnterpriseLeadWorkspaceProfile;
    try {
      profile = validateEnterpriseLeadWorkspaceProfileRequest(parsed);
    } catch {
      throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
    }
    return {
      profile,
      profileRevision: row.profileRevision,
      fieldRevision: fieldRow.revision,
    };
  }

  private projectFactSummary(fact: KnowledgeFact): KnowledgeFactSummary {
    const previewRecord = this.factStore.listFactEvidencePreviewsForQuery([fact.id])[0];
    if (!previewRecord || previewRecord.factId !== fact.id) {
      throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
    }
    let evidencePreview: KnowledgeFactEvidenceSummary | null = null;
    if (previewRecord.preview) {
      const { evidence, documentDisplayName } = previewRecord.preview;
      evidencePreview = {
        id: evidence.id,
        factId: evidence.factId,
        documentId: evidence.documentId,
        documentVersionId: evidence.documentVersionId,
        documentDisplayName,
        quote: evidence.quote.slice(0, KNOWLEDGE_EVIDENCE_PREVIEW_MAX_CHARS),
        confidence: evidence.confidence,
        stale: evidence.staleAt !== null,
        createdAt: evidence.createdAt,
      };
    }
    return {
      id: fact.id,
      domain: fact.domain,
      value: fact.value,
      reviewStatus: fact.reviewStatus,
      sourceKind: fact.sourceKind,
      revision: fact.revision,
      projectionState: fact.projectionState,
      activeEvidenceCount: previewRecord.activeEvidenceCount,
      staleEvidenceCount: previewRecord.staleEvidenceCount,
      evidencePreview,
      createdAt: fact.createdAt,
      reviewedAt: fact.reviewedAt,
      updatedAt: fact.updatedAt,
      archivedAt: fact.tombstonedAt,
    };
  }

  private throwProjectionConflict(
    operation: KnowledgeFactProjectionConflict['operation'],
    kind: KnowledgeFactProjectionConflict['kind'],
    fact: KnowledgeFact,
    currentFieldValue: string | string[],
    fieldRevision: number,
  ): never {
    throw new KnowledgeFactProjectionConflictError({
      operation,
      kind,
      factId: fact.id,
      factRevision: fact.revision,
      domain: fact.domain,
      currentFieldValue: cloneConflictFieldValue(currentFieldValue),
      fieldRevision,
    });
  }

  private emitStage(stage: KnowledgeFactProjectorStage): void {
    this.onStage?.(stage);
  }

  private readNow(): string {
    const now = this.clock();
    if (!isCanonicalTimestamp(now)) {
      return invalidRequest();
    }
    return now;
  }

  private runMutation<Result>(operation: () => Result): Result {
    try {
      if (this.db.inTransaction) {
        throw new KnowledgeFactProjectorError(
          KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
        );
      }
      return operation();
    } catch (error) {
      if (
        error instanceof KnowledgeFactProjectionConflictError ||
        error instanceof KnowledgeFactProjectorError
      ) {
        throw error;
      }
      if (error instanceof KnowledgeFactStateError) {
        if (
          error.code === KnowledgeBaseErrorCode.FactEvidenceStale ||
          error.code === KnowledgeBaseErrorCode.FactRevisionConflict ||
          error.code === KnowledgeBaseErrorCode.InvalidRequest
        ) {
          throw new KnowledgeFactProjectorError(error.code);
        }
      }
      if (isTransientSqliteBusyError(error)) {
        throw new KnowledgeFactProjectorError(
          KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
        );
      }
      if (error instanceof KnowledgeFactProjectionStoreError) {
        throw new KnowledgeFactProjectorError(
          KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
        );
      }
      throw new KnowledgeFactProjectorError(
        KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
      );
    }
  }
}
