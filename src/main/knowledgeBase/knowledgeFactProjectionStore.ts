import Database from 'better-sqlite3';

import {
  KnowledgeBaseErrorCode,
  KnowledgeFactDomain,
  type KnowledgeFactDomain as KnowledgeFactDomainValue,
  KnowledgeFactDomains,
  KnowledgeFactProfileProjectionAction,
  type KnowledgeFactProfileProjectionAction as KnowledgeFactProfileProjectionActionValue,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
} from '../../shared/knowledgeBase/constants';
import {
  isTransientSqliteBusyError,
  runTransientSqliteWriteTransaction,
} from '../libs/sqliteTransactionRetry';

const MAX_SAFE_SQLITE_INTEGER = Number.MAX_SAFE_INTEGER;

type ProjectionFieldValue = string | string[];

export interface KnowledgeFactProfileProjectionLedger {
  factId: string;
  workspaceId: string;
  domain: KnowledgeFactDomainValue;
  normalizedValue: string;
  cycleRootFactId: string;
  action: KnowledgeFactProfileProjectionActionValue;
  appliedValue: ProjectionFieldValue;
  priorValue: ProjectionFieldValue;
  appliedProfileRevision: number;
  appliedFieldRevision: number;
  priorConfirmedKeyPresent: boolean;
  priorIgnoredKeyPresent: boolean;
  appliedAt: string;
  reversedAt: string | null;
}

export interface KnowledgeFactProjectionSupportGroup {
  workspaceId: string;
  domain: KnowledgeFactDomainValue;
  normalizedValue: string;
  activeSupportCount: number;
}

export interface ApplyKnowledgeFactProjectionInput {
  factId: string;
  workspaceId: string;
  domain: KnowledgeFactDomainValue;
  normalizedValue: string;
  action: KnowledgeFactProfileProjectionActionValue;
  appliedValue: ProjectionFieldValue;
  priorValue: ProjectionFieldValue;
  appliedProfileRevision: number;
  appliedFieldRevision: number;
  priorConfirmedKeyPresent: boolean;
  priorIgnoredKeyPresent: boolean;
  appliedAt: string;
}

export interface KnowledgeFactProjectionMutationResult {
  ledger: KnowledgeFactProfileProjectionLedger;
  activeSupportCount: number;
}

export interface KnowledgeFactProjectionCleanupResult {
  deletedLedgerCount: number;
  deletedRootCount: number;
  deletedSupportGroupCount: number;
}

export const KnowledgeFactProjectionStoreStage = {
  AfterSupportIncrement: 'after_support_increment',
  AfterLedgerInsert: 'after_ledger_insert',
  AfterRootInsert: 'after_root_insert',
  AfterRootReplace: 'after_root_replace',
  AfterRootBackfill: 'after_root_backfill',
  AfterSupportDecrement: 'after_support_decrement',
  AfterLedgerReverse: 'after_ledger_reverse',
  AfterRootCleanup: 'after_root_cleanup',
} as const;
export type KnowledgeFactProjectionStoreStage =
  (typeof KnowledgeFactProjectionStoreStage)[keyof typeof KnowledgeFactProjectionStoreStage];

export interface KnowledgeFactProjectionStoreOptions {
  deferInitialization?: boolean;
  onStage?: (stage: KnowledgeFactProjectionStoreStage) => void;
}

type LedgerRow = {
  fact_id: unknown;
  workspace_id: unknown;
  domain: unknown;
  normalized_value: unknown;
  cycle_root_fact_id: unknown;
  action: unknown;
  applied_value_json: unknown;
  prior_value_json: unknown;
  applied_profile_revision: unknown;
  applied_field_revision: unknown;
  prior_confirmed_key_present: unknown;
  prior_ignored_key_present: unknown;
  applied_at: unknown;
  reversed_at: unknown;
};

type SupportGroupRow = {
  workspace_id: unknown;
  domain: unknown;
  normalized_value: unknown;
  active_support_count: unknown;
};

type SupportGroupRootRow = {
  workspace_id: unknown;
  domain: unknown;
  normalized_value: unknown;
  root_fact_id: unknown;
};

type LedgerMigrationRow = LedgerRow & {
  row_id: unknown;
};

type LedgerStateRow = LedgerMigrationRow & {
  owner_fact_id: unknown;
  owner_workspace_id: unknown;
  owner_domain: unknown;
  owner_normalized_value: unknown;
  owner_review_status: unknown;
  owner_projection_state: unknown;
  owner_tombstoned_at: unknown;
};

type ParentlessCleanupLedgerOwnerRow = LedgerStateRow & {
  delete_whole_group: unknown;
  persisted_root_fact_id: unknown;
  owner_revision: unknown;
  owner_updated_at: unknown;
};

type ParentlessCleanupRootOwnerRow = {
  workspace_id: unknown;
  domain: unknown;
  normalized_value: unknown;
  root_fact_id: unknown;
  matching_root_ledger_id: unknown;
  mismatched_root_ledger_id: unknown;
  owner_fact_id: unknown;
  owner_workspace_id: unknown;
  owner_domain: unknown;
  owner_normalized_value: unknown;
  owner_review_status: unknown;
  owner_projection_state: unknown;
  owner_revision: unknown;
  owner_updated_at: unknown;
  owner_tombstoned_at: unknown;
};

type ParentlessCleanupFactTransition = {
  factId: string;
  workspaceId: string;
  domain: KnowledgeFactDomainValue;
  normalizedValue: string;
  revision: number;
};

type LedgerWithRowId = {
  ledger: KnowledgeFactProfileProjectionLedger;
  rowId: number;
};

type ValidatedSupportGroupState = {
  group: KnowledgeFactProjectionSupportGroup | null;
  rootLedger: KnowledgeFactProfileProjectionLedger | null;
};

type AllowedFactTransition = {
  factId: string;
  kind: 'confirm_after_apply' | 'archive_after_reverse';
};

type LedgerCycleComponent = {
  members: LedgerWithRowId[];
  coverageEnd: string | null;
  ambiguousStart: boolean;
};

type ProjectionSchemaMigrationState = {
  ledgerTableExisted: boolean;
  cycleColumnAdded: boolean;
  rootTableCreated: boolean;
};

const domainSet = new Set<string>(KnowledgeFactDomains);
const actionSet = new Set<string>(Object.values(KnowledgeFactProfileProjectionAction));

const sqlStringList = (values: readonly string[]): string =>
  values.map(value => `'${value.replaceAll("'", "''")}'`).join(',');

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

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

const isNullableCanonicalTimestamp = (value: unknown): value is string | null =>
  value === null || isCanonicalTimestamp(value);

const isSafePositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

const cloneValidatedFieldValue = (
  domain: KnowledgeFactDomainValue,
  value: unknown,
): ProjectionFieldValue => {
  if (domain === KnowledgeFactDomain.CompanySummary) {
    if (typeof value !== 'string') {
      throw new KnowledgeFactProjectionStoreError();
    }
    return value;
  }
  if (!Array.isArray(value)) {
    throw new KnowledgeFactProjectionStoreError();
  }
  const length = value.length;
  const cloned: string[] = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new KnowledgeFactProjectionStoreError();
    }
    const item: unknown = value[index];
    if (typeof item !== 'string') {
      throw new KnowledgeFactProjectionStoreError();
    }
    cloned.push(item);
  }
  return cloned;
};

const parseFieldValue = (
  domain: KnowledgeFactDomainValue,
  value: unknown,
): ProjectionFieldValue => {
  if (typeof value !== 'string') {
    throw new KnowledgeFactProjectionStoreError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new KnowledgeFactProjectionStoreError();
  }
  return cloneValidatedFieldValue(domain, parsed);
};

const mapLedger = (
  row: LedgerRow,
  allowMissingCycleRoot = false,
): KnowledgeFactProfileProjectionLedger => {
  const reversedAt = row.reversed_at;
  const cycleRootFactId = row.cycle_root_fact_id;
  if (
    !isNonEmptyString(row.fact_id) ||
    !isNonEmptyString(row.workspace_id) ||
    typeof row.domain !== 'string' || !domainSet.has(row.domain) ||
    !isNonEmptyString(row.normalized_value) ||
    (!allowMissingCycleRoot && !isNonEmptyString(cycleRootFactId)) ||
    (
      cycleRootFactId !== null &&
      cycleRootFactId !== undefined &&
      !isNonEmptyString(cycleRootFactId)
    ) ||
    typeof row.action !== 'string' || !actionSet.has(row.action) ||
    !isSafePositiveInteger(row.applied_profile_revision) ||
    !isSafePositiveInteger(row.applied_field_revision) ||
    (row.prior_confirmed_key_present !== 0 && row.prior_confirmed_key_present !== 1) ||
    (row.prior_ignored_key_present !== 0 && row.prior_ignored_key_present !== 1) ||
    row.prior_confirmed_key_present + row.prior_ignored_key_present > 1 ||
    !isCanonicalTimestamp(row.applied_at) ||
    !isNullableCanonicalTimestamp(reversedAt) ||
    (
      row.action === KnowledgeFactProfileProjectionAction.ReplacedSingle &&
      row.domain !== KnowledgeFactDomain.CompanySummary
    )
  ) {
    throw new KnowledgeFactProjectionStoreError();
  }
  const domain = row.domain as KnowledgeFactDomainValue;
  const appliedValue = parseFieldValue(domain, row.applied_value_json);
  const priorValue = parseFieldValue(domain, row.prior_value_json);
  return {
    factId: row.fact_id,
    workspaceId: row.workspace_id,
    domain,
    normalizedValue: row.normalized_value,
    cycleRootFactId: typeof cycleRootFactId === 'string' ? cycleRootFactId : '',
    action: row.action as KnowledgeFactProfileProjectionActionValue,
    appliedValue,
    priorValue,
    appliedProfileRevision: row.applied_profile_revision,
    appliedFieldRevision: row.applied_field_revision,
    priorConfirmedKeyPresent: row.prior_confirmed_key_present === 1,
    priorIgnoredKeyPresent: row.prior_ignored_key_present === 1,
    appliedAt: row.applied_at,
    reversedAt,
  };
};

const mapLedgerWithRowId = (
  row: LedgerMigrationRow,
  allowMissingCycleRoot = false,
): LedgerWithRowId => {
  if (!isSafePositiveInteger(row.row_id)) {
    throw new KnowledgeFactProjectionStoreError();
  }
  return { ledger: mapLedger(row, allowMissingCycleRoot), rowId: row.row_id };
};

const compareLedgerAppliedOrder = (
  left: LedgerWithRowId,
  right: LedgerWithRowId,
): number => left.ledger.appliedAt.localeCompare(right.ledger.appliedAt) ||
  left.rowId - right.rowId;

const extendCoverageEnd = (
  current: string | null,
  candidate: string | null,
): string | null => {
  if (current === null || candidate === null) {
    return null;
  }
  return candidate > current ? candidate : current;
};

const collectExplicitCycleMembers = (
  ledgers: LedgerWithRowId[],
  root: LedgerWithRowId,
): LedgerWithRowId[] => {
  const ordered = [...ledgers].sort(compareLedgerAppliedOrder);
  const rootIndex = ordered.findIndex(item => item.ledger.factId === root.ledger.factId);
  if (rootIndex < 0 || ordered.slice(0, rootIndex).some(item =>
    item.ledger.reversedAt === null ||
    item.ledger.reversedAt > root.ledger.appliedAt)) {
    throw new KnowledgeFactProjectionStoreError();
  }
  const members = [root];
  let coverageEnd = root.ledger.reversedAt;
  for (const item of ordered.slice(rootIndex + 1)) {
    if (coverageEnd !== null && item.ledger.appliedAt > coverageEnd) {
      break;
    }
    members.push(item);
    coverageEnd = extendCoverageEnd(coverageEnd, item.ledger.reversedAt);
  }
  return members;
};

const buildStrictCycleComponents = (
  ledgers: LedgerWithRowId[],
): LedgerCycleComponent[] => {
  const components: LedgerCycleComponent[] = [];
  const ordered = [...ledgers].sort((left, right) => left.rowId - right.rowId);
  if (ordered.some((item, index) =>
    index > 0 && item.ledger.appliedAt < ordered[index - 1].ledger.appliedAt)) {
    throw new KnowledgeFactProjectionStoreError();
  }
  for (const item of ordered) {
    const current = components.at(-1);
    if (
      !current ||
      (
        current.coverageEnd !== null &&
        item.ledger.appliedAt >= current.coverageEnd
      )
    ) {
      components.push({
        members: [item],
        coverageEnd: item.ledger.reversedAt,
        ambiguousStart: Boolean(
          current && current.coverageEnd === item.ledger.appliedAt,
        ),
      });
      continue;
    }
    current.members.push(item);
    current.coverageEnd = extendCoverageEnd(
      current.coverageEnd,
      item.ledger.reversedAt,
    );
  }
  return components;
};

const mapSupportGroup = (row: SupportGroupRow): KnowledgeFactProjectionSupportGroup => {
  if (
    !isNonEmptyString(row.workspace_id) ||
    typeof row.domain !== 'string' || !domainSet.has(row.domain) ||
    !isNonEmptyString(row.normalized_value) ||
    typeof row.active_support_count !== 'number' ||
    !Number.isSafeInteger(row.active_support_count) ||
    row.active_support_count < 0
  ) {
    throw new KnowledgeFactProjectionStoreError();
  }
  return {
    workspaceId: row.workspace_id,
    domain: row.domain as KnowledgeFactDomainValue,
    normalizedValue: row.normalized_value,
    activeSupportCount: row.active_support_count,
  };
};

const validateApplyInput = (
  input: ApplyKnowledgeFactProjectionInput,
): ApplyKnowledgeFactProjectionInput => {
  if (!input || typeof input !== 'object') {
    throw new KnowledgeFactProjectionStoreError();
  }
  const factId = input.factId;
  const workspaceId = input.workspaceId;
  const domain = input.domain;
  const normalizedValue = input.normalizedValue;
  const action = input.action;
  const rawAppliedValue = input.appliedValue;
  const rawPriorValue = input.priorValue;
  const appliedProfileRevision = input.appliedProfileRevision;
  const appliedFieldRevision = input.appliedFieldRevision;
  const priorConfirmedKeyPresent = input.priorConfirmedKeyPresent;
  const priorIgnoredKeyPresent = input.priorIgnoredKeyPresent;
  const appliedAt = input.appliedAt;
  if (
    !isNonEmptyString(factId) ||
    !isNonEmptyString(workspaceId) ||
    !domainSet.has(domain) ||
    !isNonEmptyString(normalizedValue) ||
    !actionSet.has(action) ||
    !isSafePositiveInteger(appliedProfileRevision) ||
    !isSafePositiveInteger(appliedFieldRevision) ||
    typeof priorConfirmedKeyPresent !== 'boolean' ||
    typeof priorIgnoredKeyPresent !== 'boolean' ||
    (priorConfirmedKeyPresent && priorIgnoredKeyPresent) ||
    !isCanonicalTimestamp(appliedAt) ||
    (
      action === KnowledgeFactProfileProjectionAction.ReplacedSingle &&
      domain !== KnowledgeFactDomain.CompanySummary
    )
  ) {
    throw new KnowledgeFactProjectionStoreError();
  }
  return {
    factId,
    workspaceId,
    domain,
    normalizedValue,
    action,
    appliedValue: cloneValidatedFieldValue(domain, rawAppliedValue),
    priorValue: cloneValidatedFieldValue(domain, rawPriorValue),
    appliedProfileRevision,
    appliedFieldRevision,
    priorConfirmedKeyPresent,
    priorIgnoredKeyPresent,
    appliedAt,
  };
};

export class KnowledgeFactProjectionStoreError extends Error {
  readonly code = KnowledgeBaseErrorCode.JobStateConflict;

  constructor() {
    super('Knowledge fact projection state is invalid');
    this.name = 'KnowledgeFactProjectionStoreError';
    delete this.stack;
  }

  toJSON(): { code: typeof KnowledgeBaseErrorCode.JobStateConflict; message: string } {
    return { code: this.code, message: this.message };
  }
}

class KnowledgeFactProjectionBackendNotReadyError extends Error {
  readonly code = KnowledgeBaseErrorCode.BackendNotReady;

  constructor() {
    super('Knowledge base backend is not ready');
    this.name = 'KnowledgeFactProjectionBackendNotReadyError';
    delete this.stack;
  }
}

export class KnowledgeFactProjectionStore {
  private initialized = false;

  private deferredMigrationState: ProjectionSchemaMigrationState | null = null;

  constructor(
    private readonly db: Database.Database,
    private readonly options: KnowledgeFactProjectionStoreOptions = {},
  ) {
    try {
      if (options.deferInitialization) {
        const initializeSchema = this.db.transaction(() =>
          this.initializeSchemaInCurrentTransaction());
        this.deferredMigrationState = runTransientSqliteWriteTransaction(initializeSchema);
      } else {
        this.initialize();
        this.initialized = true;
      }
    } catch (error) {
      this.rethrow(error);
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  initializeAfterCleanup(): void {
    if (this.initialized) return;
    try {
      const migrationState = this.deferredMigrationState;
      if (!migrationState) throw new KnowledgeFactProjectionStoreError();
      const initializeDeferred = this.db.transaction(() => {
        this.backfillProjectionCyclesInCurrentTransaction(migrationState);
        this.validateAllProjectionStateInCurrentTransaction();
      });
      runTransientSqliteWriteTransaction(initializeDeferred);
      this.deferredMigrationState = null;
      this.initialized = true;
    } catch (error) {
      this.rethrow(error);
    }
  }

  getDatabaseForInternalUse(): Database.Database {
    return this.db;
  }

  getLedger(factId: string): KnowledgeFactProfileProjectionLedger | null {
    try {
      this.assertInitialized();
      if (!isNonEmptyString(factId)) {
        throw new KnowledgeFactProjectionStoreError();
      }
      const row = this.db.prepare(`
        SELECT
          fact_id, workspace_id, domain, normalized_value, cycle_root_fact_id, action,
          applied_value_json, prior_value_json, applied_profile_revision,
          applied_field_revision, prior_confirmed_key_present,
          prior_ignored_key_present, applied_at, reversed_at
        FROM knowledge_fact_profile_projection_ledger
        WHERE fact_id = ?
        LIMIT 1
      `).get(factId) as LedgerRow | undefined;
      return row ? mapLedger(row) : null;
    } catch (error) {
      this.rethrow(error);
    }
  }

  getSupportGroup(
    workspaceId: string,
    domain: KnowledgeFactDomainValue,
    normalizedValue: string,
  ): KnowledgeFactProjectionSupportGroup | null {
    try {
      this.assertInitialized();
      return this.readValidatedSupportGroupState(
        workspaceId,
        domain,
        normalizedValue,
      ).group;
    } catch (error) {
      this.rethrow(error);
    }
  }

  getSupportGroupRoot(
    workspaceId: string,
    domain: KnowledgeFactDomainValue,
    normalizedValue: string,
  ): KnowledgeFactProfileProjectionLedger | null {
    try {
      this.assertInitialized();
      return this.readValidatedSupportGroupState(
        workspaceId,
        domain,
        normalizedValue,
      ).rootLedger;
    } catch (error) {
      this.rethrow(error);
    }
  }

  applyProjectionInCurrentTransaction(
    rawInput: ApplyKnowledgeFactProjectionInput,
  ): KnowledgeFactProjectionMutationResult {
    this.assertCurrentTransaction();
    try {
      this.assertInitialized();
      const input = validateApplyInput(rawInput);
      const priorState = this.readValidatedSupportGroupState(
        input.workspaceId,
        input.domain,
        input.normalizedValue,
      );
      const startsNewCycle = !priorState.group || priorState.group.activeSupportCount === 0;
      const cycleRootFactId = startsNewCycle
        ? input.factId
        : priorState.rootLedger?.factId;
      if (!isNonEmptyString(cycleRootFactId)) {
        throw new KnowledgeFactProjectionStoreError();
      }
      const supportChange = this.db.prepare(`
        INSERT INTO knowledge_fact_projection_support_groups (
          workspace_id, domain, normalized_value, active_support_count
        ) VALUES (?, ?, ?, 1)
        ON CONFLICT(workspace_id, domain, normalized_value) DO UPDATE SET
          active_support_count = active_support_count + 1
        WHERE active_support_count < ?
      `).run(
        input.workspaceId,
        input.domain,
        input.normalizedValue,
        MAX_SAFE_SQLITE_INTEGER,
      );
      if (supportChange.changes !== 1) {
        throw new KnowledgeFactProjectionStoreError();
      }
      this.emitStage(KnowledgeFactProjectionStoreStage.AfterSupportIncrement);
      const ledgerChange = this.db.prepare(`
        INSERT INTO knowledge_fact_profile_projection_ledger (
          fact_id, workspace_id, domain, normalized_value, cycle_root_fact_id, action,
          applied_value_json, prior_value_json, applied_profile_revision,
          applied_field_revision, prior_confirmed_key_present,
          prior_ignored_key_present, applied_at, reversed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        input.factId,
        input.workspaceId,
        input.domain,
        input.normalizedValue,
        cycleRootFactId,
        input.action,
        JSON.stringify(input.appliedValue),
        JSON.stringify(input.priorValue),
        input.appliedProfileRevision,
        input.appliedFieldRevision,
        input.priorConfirmedKeyPresent ? 1 : 0,
        input.priorIgnoredKeyPresent ? 1 : 0,
        input.appliedAt,
      );
      if (ledgerChange.changes !== 1) {
        throw new KnowledgeFactProjectionStoreError();
      }
      this.emitStage(KnowledgeFactProjectionStoreStage.AfterLedgerInsert);
      if (startsNewCycle) {
        const rootChange = this.db.prepare(`
          INSERT INTO knowledge_fact_projection_support_group_roots (
            workspace_id, domain, normalized_value, root_fact_id
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(workspace_id, domain, normalized_value) DO UPDATE SET
            root_fact_id = excluded.root_fact_id
        `).run(
          input.workspaceId,
          input.domain,
          input.normalizedValue,
          input.factId,
        );
        if (rootChange.changes !== 1) {
          throw new KnowledgeFactProjectionStoreError();
        }
        this.emitStage(
          priorState.rootLedger
            ? KnowledgeFactProjectionStoreStage.AfterRootReplace
            : KnowledgeFactProjectionStoreStage.AfterRootInsert,
        );
      }
      const ledger = this.getLedger(input.factId);
      const state = this.readValidatedSupportGroupState(
        input.workspaceId,
        input.domain,
        input.normalizedValue,
        { factId: input.factId, kind: 'confirm_after_apply' },
      );
      if (!ledger || !state.group) {
        throw new KnowledgeFactProjectionStoreError();
      }
      return { ledger, activeSupportCount: state.group.activeSupportCount };
    } catch (error) {
      this.rethrow(error);
    }
  }

  reverseProjectionInCurrentTransaction(
    factId: string,
    reversedAt: string,
  ): KnowledgeFactProjectionMutationResult {
    this.assertCurrentTransaction();
    try {
      this.assertInitialized();
      if (!isNonEmptyString(factId) || !isCanonicalTimestamp(reversedAt)) {
        throw new KnowledgeFactProjectionStoreError();
      }
      const ledger = this.getLedger(factId);
      if (!ledger || ledger.reversedAt !== null) {
        throw new KnowledgeFactProjectionStoreError();
      }
      const priorState = this.readValidatedSupportGroupState(
        ledger.workspaceId,
        ledger.domain,
        ledger.normalizedValue,
      );
      if (!priorState.group || !priorState.rootLedger) {
        throw new KnowledgeFactProjectionStoreError();
      }
      const supportChange = this.db.prepare(`
        UPDATE knowledge_fact_projection_support_groups
        SET active_support_count = active_support_count - 1
        WHERE workspace_id = ? AND domain = ? AND normalized_value = ?
          AND active_support_count > 0
      `).run(ledger.workspaceId, ledger.domain, ledger.normalizedValue);
      if (supportChange.changes !== 1) {
        throw new KnowledgeFactProjectionStoreError();
      }
      this.emitStage(KnowledgeFactProjectionStoreStage.AfterSupportDecrement);
      const ledgerChange = this.db.prepare(`
        UPDATE knowledge_fact_profile_projection_ledger
        SET reversed_at = ?
        WHERE fact_id = ? AND reversed_at IS NULL
      `).run(reversedAt, factId);
      if (ledgerChange.changes !== 1) {
        throw new KnowledgeFactProjectionStoreError();
      }
      this.emitStage(KnowledgeFactProjectionStoreStage.AfterLedgerReverse);
      const reversedLedger = this.getLedger(factId);
      const state = this.readValidatedSupportGroupState(
        ledger.workspaceId,
        ledger.domain,
        ledger.normalizedValue,
        { factId, kind: 'archive_after_reverse' },
      );
      if (!reversedLedger || !state.group) {
        throw new KnowledgeFactProjectionStoreError();
      }
      return {
        ledger: reversedLedger,
        activeSupportCount: state.group.activeSupportCount,
      };
    } catch (error) {
      this.rethrow(error);
    }
  }

  deleteWorkspaceProjectionsInCurrentTransaction(
    workspaceId: string,
  ): KnowledgeFactProjectionCleanupResult {
    this.assertCurrentTransaction();
    try {
      if (!isNonEmptyString(workspaceId)) {
        throw new KnowledgeFactProjectionStoreError();
      }
      const deletedLedgerCount = this.db.prepare(`
        DELETE FROM knowledge_fact_profile_projection_ledger
        WHERE workspace_id = ?
      `).run(workspaceId).changes;
      const deletedRootCount = this.db.prepare(`
        DELETE FROM knowledge_fact_projection_support_group_roots
        WHERE workspace_id = ?
      `).run(workspaceId).changes;
      this.emitStage(KnowledgeFactProjectionStoreStage.AfterRootCleanup);
      const deletedSupportGroupCount = this.db.prepare(`
        DELETE FROM knowledge_fact_projection_support_groups
        WHERE workspace_id = ?
      `).run(workspaceId).changes;
      return { deletedLedgerCount, deletedRootCount, deletedSupportGroupCount };
    } catch (error) {
      this.rethrow(error);
    }
  }

  deleteParentlessProjectionsInCurrentTransaction(now: string): number {
    this.assertCurrentTransaction();
    try {
      if (!isCanonicalTimestamp(now)) {
        throw new KnowledgeFactProjectionStoreError();
      }
      const recoveryTransitions = this.collectParentlessCleanupFactTransitions();
      const recoverFact = this.db.prepare(`
        UPDATE knowledge_facts
        SET
          projection_state = ?,
          revision = revision + 1,
          updated_at = ?
        WHERE
          id = ?
          AND workspace_id = ?
          AND domain = ?
          AND normalized_value = ?
          AND revision = ?
          AND review_status = ?
          AND projection_state = ?
          AND tombstoned_at IS NULL
      `);
      for (const transition of recoveryTransitions) {
        const change = recoverFact.run(
          KnowledgeFactProjectionState.Conflict,
          now,
          transition.factId,
          transition.workspaceId,
          transition.domain,
          transition.normalizedValue,
          transition.revision,
          KnowledgeFactReviewStatus.Confirmed,
          KnowledgeFactProjectionState.Active,
        );
        if (change.changes !== 1) {
          throw new KnowledgeFactProjectionStoreError();
        }
      }
      let deletedCount = this.db.prepare(`
        DELETE FROM knowledge_fact_profile_projection_ledger
        WHERE EXISTS (
          SELECT 1
          FROM knowledge_fact_projection_support_group_roots AS root
          WHERE root.workspace_id = knowledge_fact_profile_projection_ledger.workspace_id
            AND root.domain = knowledge_fact_profile_projection_ledger.domain
            AND root.normalized_value =
              knowledge_fact_profile_projection_ledger.normalized_value
            AND (
              NOT EXISTS (
                SELECT 1 FROM knowledge_facts AS root_fact
                WHERE root_fact.id = root.root_fact_id
              ) OR NOT EXISTS (
                SELECT 1
                FROM knowledge_fact_profile_projection_ledger AS root_ledger
                WHERE root_ledger.fact_id = root.root_fact_id
                  AND root_ledger.workspace_id = root.workspace_id
                  AND root_ledger.domain = root.domain
                  AND root_ledger.normalized_value = root.normalized_value
              )
            )
        )
      `).run().changes;
      this.db.prepare(`
        UPDATE knowledge_fact_projection_support_groups AS support
        SET active_support_count = (
          SELECT COUNT(*)
          FROM knowledge_fact_profile_projection_ledger AS ledger
          WHERE ledger.workspace_id = support.workspace_id
            AND ledger.domain = support.domain
            AND ledger.normalized_value = support.normalized_value
            AND ledger.reversed_at IS NULL
            AND EXISTS (
              SELECT 1 FROM knowledge_facts AS fact
              WHERE fact.id = ledger.fact_id
            )
        )
        WHERE EXISTS (
          SELECT 1
          FROM knowledge_fact_profile_projection_ledger AS orphan_ledger
          WHERE orphan_ledger.workspace_id = support.workspace_id
            AND orphan_ledger.domain = support.domain
            AND orphan_ledger.normalized_value = support.normalized_value
            AND NOT EXISTS (
              SELECT 1 FROM knowledge_facts AS fact
              WHERE fact.id = orphan_ledger.fact_id
            )
        )
      `).run();
      deletedCount += this.db.prepare(`
        DELETE FROM knowledge_fact_profile_projection_ledger
        WHERE NOT EXISTS (
          SELECT 1 FROM knowledge_facts AS fact
          WHERE fact.id = knowledge_fact_profile_projection_ledger.fact_id
        ) OR NOT EXISTS (
          SELECT 1 FROM knowledge_fact_projection_support_groups AS support
          WHERE support.workspace_id = knowledge_fact_profile_projection_ledger.workspace_id
            AND support.domain = knowledge_fact_profile_projection_ledger.domain
            AND support.normalized_value =
              knowledge_fact_profile_projection_ledger.normalized_value
        )
      `).run().changes;
      deletedCount += this.db.prepare(`
        DELETE FROM knowledge_fact_projection_support_group_roots
        WHERE NOT EXISTS (
          SELECT 1 FROM knowledge_facts AS fact
          WHERE fact.id = knowledge_fact_projection_support_group_roots.root_fact_id
        ) OR NOT EXISTS (
          SELECT 1 FROM knowledge_fact_projection_support_groups AS support
          WHERE support.workspace_id = knowledge_fact_projection_support_group_roots.workspace_id
            AND support.domain = knowledge_fact_projection_support_group_roots.domain
            AND support.normalized_value =
              knowledge_fact_projection_support_group_roots.normalized_value
        ) OR NOT EXISTS (
          SELECT 1 FROM knowledge_fact_profile_projection_ledger AS ledger
          WHERE ledger.fact_id =
              knowledge_fact_projection_support_group_roots.root_fact_id
            AND ledger.workspace_id =
              knowledge_fact_projection_support_group_roots.workspace_id
            AND ledger.domain = knowledge_fact_projection_support_group_roots.domain
            AND ledger.normalized_value =
              knowledge_fact_projection_support_group_roots.normalized_value
        )
      `).run().changes;
      deletedCount += this.db.prepare(`
        DELETE FROM knowledge_fact_projection_support_groups
        WHERE NOT EXISTS (
          SELECT 1 FROM knowledge_fact_profile_projection_ledger AS ledger
          WHERE ledger.workspace_id = knowledge_fact_projection_support_groups.workspace_id
            AND ledger.domain = knowledge_fact_projection_support_groups.domain
            AND ledger.normalized_value =
              knowledge_fact_projection_support_groups.normalized_value
        )
      `).run().changes;
      return deletedCount;
    } catch (error) {
      this.rethrow(error);
    }
  }

  private collectParentlessCleanupFactTransitions(): ParentlessCleanupFactTransition[] {
    const ledgerRows = this.db.prepare(`
      WITH invalid_root_groups AS (
        SELECT root.workspace_id, root.domain, root.normalized_value
        FROM knowledge_fact_projection_support_group_roots AS root
        WHERE NOT EXISTS (
          SELECT 1 FROM knowledge_facts AS root_fact
          WHERE root_fact.id = root.root_fact_id
        ) OR NOT EXISTS (
          SELECT 1 FROM knowledge_fact_profile_projection_ledger AS root_ledger
          WHERE root_ledger.fact_id = root.root_fact_id
            AND root_ledger.workspace_id = root.workspace_id
            AND root_ledger.domain = root.domain
            AND root_ledger.normalized_value = root.normalized_value
        )
      ),
      missing_fact_groups AS (
        SELECT DISTINCT ledger.workspace_id, ledger.domain, ledger.normalized_value
        FROM knowledge_fact_profile_projection_ledger AS ledger
        WHERE NOT EXISTS (
          SELECT 1 FROM knowledge_facts AS fact
          WHERE fact.id = ledger.fact_id
        )
      )
      SELECT
        ledger.rowid AS row_id,
        ledger.fact_id,
        ledger.workspace_id,
        ledger.domain,
        ledger.normalized_value,
        ledger.cycle_root_fact_id,
        ledger.action,
        ledger.applied_value_json,
        ledger.prior_value_json,
        ledger.applied_profile_revision,
        ledger.applied_field_revision,
        ledger.prior_confirmed_key_present,
        ledger.prior_ignored_key_present,
        ledger.applied_at,
        ledger.reversed_at,
        CASE WHEN support.workspace_id IS NULL OR EXISTS (
          SELECT 1 FROM invalid_root_groups AS invalid_root
          WHERE invalid_root.workspace_id = ledger.workspace_id
            AND invalid_root.domain = ledger.domain
            AND invalid_root.normalized_value = ledger.normalized_value
        ) THEN 1 ELSE 0 END AS delete_whole_group,
        persisted_root.root_fact_id AS persisted_root_fact_id,
        fact.id AS owner_fact_id,
        fact.workspace_id AS owner_workspace_id,
        fact.domain AS owner_domain,
        fact.normalized_value AS owner_normalized_value,
        fact.review_status AS owner_review_status,
        fact.projection_state AS owner_projection_state,
        fact.revision AS owner_revision,
        fact.updated_at AS owner_updated_at,
        fact.tombstoned_at AS owner_tombstoned_at
      FROM knowledge_fact_profile_projection_ledger AS ledger
      LEFT JOIN knowledge_fact_projection_support_groups AS support
        ON support.workspace_id = ledger.workspace_id
        AND support.domain = ledger.domain
        AND support.normalized_value = ledger.normalized_value
      LEFT JOIN knowledge_facts AS fact ON fact.id = ledger.fact_id
      LEFT JOIN knowledge_fact_projection_support_group_roots AS persisted_root
        ON persisted_root.workspace_id = ledger.workspace_id
        AND persisted_root.domain = ledger.domain
        AND persisted_root.normalized_value = ledger.normalized_value
      WHERE support.workspace_id IS NULL
        OR EXISTS (
          SELECT 1 FROM invalid_root_groups AS invalid_root
          WHERE invalid_root.workspace_id = ledger.workspace_id
            AND invalid_root.domain = ledger.domain
            AND invalid_root.normalized_value = ledger.normalized_value
        )
        OR EXISTS (
          SELECT 1 FROM missing_fact_groups AS missing_fact
          WHERE missing_fact.workspace_id = ledger.workspace_id
            AND missing_fact.domain = ledger.domain
            AND missing_fact.normalized_value = ledger.normalized_value
        )
      ORDER BY ledger.workspace_id, ledger.domain, ledger.normalized_value, ledger.rowid
    `).all() as ParentlessCleanupLedgerOwnerRow[];
    const rootRows = this.db.prepare(`
      SELECT
        root.workspace_id,
        root.domain,
        root.normalized_value,
        root.root_fact_id,
        matching_root_ledger.fact_id AS matching_root_ledger_id,
        mismatched_root_ledger.fact_id AS mismatched_root_ledger_id,
        fact.id AS owner_fact_id,
        fact.workspace_id AS owner_workspace_id,
        fact.domain AS owner_domain,
        fact.normalized_value AS owner_normalized_value,
        fact.review_status AS owner_review_status,
        fact.projection_state AS owner_projection_state,
        fact.revision AS owner_revision,
        fact.updated_at AS owner_updated_at,
        fact.tombstoned_at AS owner_tombstoned_at
      FROM knowledge_fact_projection_support_group_roots AS root
      LEFT JOIN knowledge_facts AS fact ON fact.id = root.root_fact_id
      LEFT JOIN knowledge_fact_profile_projection_ledger AS matching_root_ledger
        ON matching_root_ledger.fact_id = root.root_fact_id
        AND matching_root_ledger.workspace_id = root.workspace_id
        AND matching_root_ledger.domain = root.domain
        AND matching_root_ledger.normalized_value = root.normalized_value
      LEFT JOIN knowledge_fact_profile_projection_ledger AS mismatched_root_ledger
        ON mismatched_root_ledger.fact_id = root.root_fact_id
        AND (
          mismatched_root_ledger.workspace_id <> root.workspace_id
          OR mismatched_root_ledger.domain <> root.domain
          OR mismatched_root_ledger.normalized_value <> root.normalized_value
        )
      WHERE fact.id IS NULL OR matching_root_ledger.fact_id IS NULL
      ORDER BY root.workspace_id, root.domain, root.normalized_value
    `).all() as ParentlessCleanupRootOwnerRow[];
    const transitions = new Map<string, ParentlessCleanupFactTransition>();
    const addTransition = (transition: ParentlessCleanupFactTransition): void => {
      if (transition.revision >= MAX_SAFE_SQLITE_INTEGER) {
        throw new KnowledgeFactProjectionStoreError();
      }
      const existing = transitions.get(transition.factId);
      if (existing && (
        existing.workspaceId !== transition.workspaceId ||
        existing.domain !== transition.domain ||
        existing.normalizedValue !== transition.normalizedValue ||
        existing.revision !== transition.revision
      )) {
        throw new KnowledgeFactProjectionStoreError();
      }
      transitions.set(transition.factId, transition);
    };
    for (const row of ledgerRows) {
      const ledger = mapLedgerWithRowId(row).ledger;
      if (row.delete_whole_group !== 0 && row.delete_whole_group !== 1) {
        throw new KnowledgeFactProjectionStoreError();
      }
      if (
        row.persisted_root_fact_id !== null &&
        !isNonEmptyString(row.persisted_root_fact_id)
      ) {
        throw new KnowledgeFactProjectionStoreError();
      }
      if (row.owner_fact_id === null) continue;
      if (
        row.owner_fact_id !== ledger.factId ||
        row.owner_workspace_id !== ledger.workspaceId ||
        row.owner_domain !== ledger.domain ||
        row.owner_normalized_value !== ledger.normalizedValue ||
        !isSafePositiveInteger(row.owner_revision) ||
        !isCanonicalTimestamp(row.owner_updated_at)
      ) {
        throw new KnowledgeFactProjectionStoreError();
      }
      const validActiveOwner =
        ledger.reversedAt === null &&
        row.owner_review_status === KnowledgeFactReviewStatus.Confirmed &&
        row.owner_projection_state === KnowledgeFactProjectionState.Active &&
        row.owner_tombstoned_at === null;
      const validReversedOwner =
        ledger.reversedAt !== null &&
        row.owner_review_status === KnowledgeFactReviewStatus.Confirmed &&
        row.owner_projection_state === KnowledgeFactProjectionState.Reversed &&
        row.owner_tombstoned_at === ledger.reversedAt;
      if (
        validActiveOwner &&
        typeof row.persisted_root_fact_id === 'string' &&
        ledger.cycleRootFactId !== row.persisted_root_fact_id
      ) {
        throw new KnowledgeFactProjectionStoreError();
      }
      if (!validActiveOwner && !validReversedOwner) {
        throw new KnowledgeFactProjectionStoreError();
      }
      if (validActiveOwner && row.delete_whole_group === 1) {
        addTransition({
          factId: ledger.factId,
          workspaceId: ledger.workspaceId,
          domain: ledger.domain,
          normalizedValue: ledger.normalizedValue,
          revision: row.owner_revision,
        });
      }
    }
    for (const row of rootRows) {
      if (
        !isNonEmptyString(row.workspace_id) ||
        typeof row.domain !== 'string' || !domainSet.has(row.domain) ||
        !isNonEmptyString(row.normalized_value) ||
        !isNonEmptyString(row.root_fact_id) ||
        row.mismatched_root_ledger_id !== null
      ) {
        throw new KnowledgeFactProjectionStoreError();
      }
      if (row.owner_fact_id === null || row.matching_root_ledger_id !== null) continue;
      if (
        row.owner_fact_id !== row.root_fact_id ||
        row.owner_workspace_id !== row.workspace_id ||
        row.owner_domain !== row.domain ||
        row.owner_normalized_value !== row.normalized_value ||
        !isSafePositiveInteger(row.owner_revision) ||
        !isCanonicalTimestamp(row.owner_updated_at)
      ) {
        throw new KnowledgeFactProjectionStoreError();
      }
      const validActiveOwner =
        row.owner_review_status === KnowledgeFactReviewStatus.Confirmed &&
        row.owner_projection_state === KnowledgeFactProjectionState.Active &&
        row.owner_tombstoned_at === null;
      const validReversedOwner =
        row.owner_review_status === KnowledgeFactReviewStatus.Confirmed &&
        row.owner_projection_state === KnowledgeFactProjectionState.Reversed &&
        isCanonicalTimestamp(row.owner_tombstoned_at);
      if (!validActiveOwner && !validReversedOwner) {
        throw new KnowledgeFactProjectionStoreError();
      }
      if (validActiveOwner) {
        addTransition({
          factId: row.root_fact_id,
          workspaceId: row.workspace_id,
          domain: row.domain as KnowledgeFactDomainValue,
          normalizedValue: row.normalized_value,
          revision: row.owner_revision,
        });
      }
    }
    return [...transitions.values()];
  }

  private initialize(): void {
    const initializeInCurrentTransaction = this.db.transaction(() => {
      const migrationState = this.initializeSchemaInCurrentTransaction();
      this.backfillProjectionCyclesInCurrentTransaction(migrationState);
      this.validateAllProjectionStateInCurrentTransaction();
    });
    runTransientSqliteWriteTransaction(initializeInCurrentTransaction);
  }

  private initializeSchemaInCurrentTransaction(): ProjectionSchemaMigrationState {
    const ledgerTableExisted = Boolean(this.db.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = 'knowledge_fact_profile_projection_ledger'
      LIMIT 1
    `).get());
    const rootTableExisted = Boolean(this.db.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = 'knowledge_fact_projection_support_group_roots'
      LIMIT 1
    `).get());
    const cycleColumnExisted = ledgerTableExisted && (this.db.prepare(`
      PRAGMA table_info(knowledge_fact_profile_projection_ledger)
    `).all() as Array<{ name: unknown }>).some(column =>
      column.name === 'cycle_root_fact_id');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_fact_projection_support_groups (
        workspace_id TEXT NOT NULL CHECK (TRIM(workspace_id) <> ''),
        domain TEXT NOT NULL CHECK (domain IN (${sqlStringList(KnowledgeFactDomains)})),
        normalized_value TEXT NOT NULL CHECK (TRIM(normalized_value) <> ''),
        active_support_count INTEGER NOT NULL DEFAULT 0 CHECK (
          TYPEOF(active_support_count) = 'integer'
          AND active_support_count >= 0
          AND active_support_count <= ${MAX_SAFE_SQLITE_INTEGER}
        ),
        PRIMARY KEY (workspace_id, domain, normalized_value)
      ) WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS knowledge_fact_profile_projection_ledger (
        fact_id TEXT PRIMARY KEY CHECK (TRIM(fact_id) <> ''),
        workspace_id TEXT NOT NULL CHECK (TRIM(workspace_id) <> ''),
        domain TEXT NOT NULL CHECK (domain IN (${sqlStringList(KnowledgeFactDomains)})),
        normalized_value TEXT NOT NULL CHECK (TRIM(normalized_value) <> ''),
        cycle_root_fact_id TEXT,
        action TEXT NOT NULL CHECK (
          action IN (${sqlStringList(Object.values(KnowledgeFactProfileProjectionAction))})
        ),
        applied_value_json TEXT NOT NULL CHECK (JSON_VALID(applied_value_json)),
        prior_value_json TEXT NOT NULL CHECK (JSON_VALID(prior_value_json)),
        applied_profile_revision INTEGER NOT NULL CHECK (
          TYPEOF(applied_profile_revision) = 'integer'
          AND applied_profile_revision BETWEEN 1 AND ${MAX_SAFE_SQLITE_INTEGER}
        ),
        applied_field_revision INTEGER NOT NULL CHECK (
          TYPEOF(applied_field_revision) = 'integer'
          AND applied_field_revision BETWEEN 1 AND ${MAX_SAFE_SQLITE_INTEGER}
        ),
        prior_confirmed_key_present INTEGER NOT NULL CHECK (
          prior_confirmed_key_present IN (0, 1)
        ),
        prior_ignored_key_present INTEGER NOT NULL CHECK (
          prior_ignored_key_present IN (0, 1)
        ),
        applied_at TEXT NOT NULL CHECK (TRIM(applied_at) <> ''),
        reversed_at TEXT,
        FOREIGN KEY(fact_id) REFERENCES knowledge_facts(id),
        FOREIGN KEY(workspace_id, domain, normalized_value)
          REFERENCES knowledge_fact_projection_support_groups(
            workspace_id, domain, normalized_value
          ),
        CHECK (
          prior_confirmed_key_present + prior_ignored_key_present <= 1
        ),
        CHECK (
          action <> '${KnowledgeFactProfileProjectionAction.ReplacedSingle}'
          OR domain = '${KnowledgeFactDomain.CompanySummary}'
        ),
        CHECK (
          (domain = '${KnowledgeFactDomain.CompanySummary}'
            AND JSON_TYPE(applied_value_json) = 'text'
            AND JSON_TYPE(prior_value_json) = 'text')
          OR
          (domain <> '${KnowledgeFactDomain.CompanySummary}'
            AND JSON_TYPE(applied_value_json) = 'array'
            AND JSON_TYPE(prior_value_json) = 'array')
        )
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_fact_projection_ledger_workspace
      ON knowledge_fact_profile_projection_ledger(workspace_id, fact_id);

      CREATE TABLE IF NOT EXISTS knowledge_fact_projection_support_group_roots (
        workspace_id TEXT NOT NULL CHECK (TRIM(workspace_id) <> ''),
        domain TEXT NOT NULL CHECK (domain IN (${sqlStringList(KnowledgeFactDomains)})),
        normalized_value TEXT NOT NULL CHECK (TRIM(normalized_value) <> ''),
        root_fact_id TEXT NOT NULL CHECK (TRIM(root_fact_id) <> ''),
        PRIMARY KEY (workspace_id, domain, normalized_value),
        FOREIGN KEY(workspace_id, domain, normalized_value)
          REFERENCES knowledge_fact_projection_support_groups(
            workspace_id, domain, normalized_value
          ),
        FOREIGN KEY(root_fact_id) REFERENCES knowledge_facts(id)
      ) WITHOUT ROWID;
    `);
    const ledgerColumns = this.db.prepare(`
      PRAGMA table_info(knowledge_fact_profile_projection_ledger)
    `).all() as Array<{ name: unknown }>;
    if (!ledgerColumns.some(column => column.name === 'cycle_root_fact_id')) {
      this.db.exec(`
        ALTER TABLE knowledge_fact_profile_projection_ledger
        ADD COLUMN cycle_root_fact_id TEXT;
      `);
    }
    return {
      ledgerTableExisted,
      cycleColumnAdded: ledgerTableExisted && !cycleColumnExisted,
      rootTableCreated: !rootTableExisted,
    };
  }

  private backfillProjectionCyclesInCurrentTransaction(
    migrationState: ProjectionSchemaMigrationState,
  ): void {
    if (
      migrationState.ledgerTableExisted &&
      migrationState.rootTableCreated &&
      !migrationState.cycleColumnAdded &&
      (
        this.db.prepare(`
          SELECT 1 FROM knowledge_fact_profile_projection_ledger LIMIT 1
        `).get() ||
        this.db.prepare(`
          SELECT 1 FROM knowledge_fact_projection_support_groups LIMIT 1
        `).get()
      )
    ) {
      throw new KnowledgeFactProjectionStoreError();
    }
    if (!migrationState.cycleColumnAdded && !migrationState.rootTableCreated) {
      return;
    }
    const rows = this.db.prepare(`
      SELECT workspace_id, domain, normalized_value, active_support_count
      FROM knowledge_fact_projection_support_groups
      ORDER BY workspace_id, domain, normalized_value
    `).all() as SupportGroupRow[];
    for (const row of rows) {
      const group = mapSupportGroup(row);
      const ledgers = this.readLedgerStatesForGroup(
        group.workspaceId,
        group.domain,
        group.normalizedValue,
        migrationState.cycleColumnAdded,
      );
      const activeLedgers = ledgers.filter(item => item.ledger.reversedAt === null);
      const hasCompleteCycleMetadata = ledgers.every(item =>
        isNonEmptyString(item.ledger.cycleRootFactId));
      if (activeLedgers.length !== group.activeSupportCount) {
        throw new KnowledgeFactProjectionStoreError();
      }
      const rootRow = this.db.prepare(`
        SELECT workspace_id, domain, normalized_value, root_fact_id
        FROM knowledge_fact_projection_support_group_roots
        WHERE workspace_id = ? AND domain = ? AND normalized_value = ?
        LIMIT 1
      `).get(
        group.workspaceId,
        group.domain,
        group.normalizedValue,
      ) as SupportGroupRootRow | undefined;
      let root: LedgerWithRowId | null = null;
      let currentCycleMembers: LedgerWithRowId[] = [];
      let insertedRoot = false;
      if (rootRow) {
        if (!isNonEmptyString(rootRow.root_fact_id)) {
          throw new KnowledgeFactProjectionStoreError();
        }
        root = ledgers.find(item => item.ledger.factId === rootRow.root_fact_id) ?? null;
        if (!root) {
          throw new KnowledgeFactProjectionStoreError();
        }
        currentCycleMembers = migrationState.cycleColumnAdded
          ? ledgers.filter(item => item.rowId >= root.rowId)
          : hasCompleteCycleMetadata
          ? ledgers.filter(item =>
            item.ledger.cycleRootFactId === root?.ledger.factId)
          : collectExplicitCycleMembers(ledgers, root);
      } else if (activeLedgers.length > 0) {
        if (!migrationState.rootTableCreated) {
          throw new KnowledgeFactProjectionStoreError();
        }
        const explicitRootIds = new Set(
          activeLedgers
            .map(item => item.ledger.cycleRootFactId)
            .filter(isNonEmptyString),
        );
        if (explicitRootIds.size > 1) {
          throw new KnowledgeFactProjectionStoreError();
        }
        if (explicitRootIds.size === 1) {
          const [rootFactId] = explicitRootIds;
          root = ledgers.find(item => item.ledger.factId === rootFactId) ?? null;
          if (!root || root.ledger.cycleRootFactId !== root.ledger.factId) {
            throw new KnowledgeFactProjectionStoreError();
          }
          currentCycleMembers = hasCompleteCycleMetadata
            ? ledgers.filter(item =>
              item.ledger.cycleRootFactId === root?.ledger.factId)
            : collectExplicitCycleMembers(ledgers, root);
        } else {
          const activeFactIds = new Set(
            activeLedgers.map(item => item.ledger.factId),
          );
          const components = buildStrictCycleComponents(ledgers);
          const activeComponents = components.filter(component =>
            component.members.some(item => activeFactIds.has(item.ledger.factId)));
          if (
            activeComponents.length !== 1 ||
            activeComponents[0].ambiguousStart ||
            !activeLedgers.every(item => activeComponents[0].members.includes(item)) ||
            ledgers.some(item => item.ledger.reversedAt !== null)
          ) {
            throw new KnowledgeFactProjectionStoreError();
          }
          currentCycleMembers = activeComponents[0].members;
          root = currentCycleMembers[0] ?? null;
        }
        if (!root) {
          throw new KnowledgeFactProjectionStoreError();
        }
        const change = this.db.prepare(`
          INSERT INTO knowledge_fact_projection_support_group_roots (
            workspace_id, domain, normalized_value, root_fact_id
          ) VALUES (?, ?, ?, ?)
        `).run(
          group.workspaceId,
          group.domain,
          group.normalizedValue,
          root.ledger.factId,
        );
        if (change.changes !== 1) {
          throw new KnowledgeFactProjectionStoreError();
        }
        insertedRoot = true;
      }
      const currentCycleFactIds = new Set(
        currentCycleMembers.map(item => item.ledger.factId),
      );
      let updatedCycleMetadata = false;
      for (const item of ledgers) {
        const desiredRootFactId = root && currentCycleFactIds.has(item.ledger.factId)
          ? root.ledger.factId
          : item.ledger.cycleRootFactId || item.ledger.factId;
        if (
          isNonEmptyString(item.ledger.cycleRootFactId) &&
          item.ledger.cycleRootFactId !== desiredRootFactId
        ) {
          throw new KnowledgeFactProjectionStoreError();
        }
        if (!isNonEmptyString(item.ledger.cycleRootFactId)) {
          const change = this.db.prepare(`
            UPDATE knowledge_fact_profile_projection_ledger
            SET cycle_root_fact_id = ?
            WHERE fact_id = ? AND cycle_root_fact_id IS NULL
          `).run(desiredRootFactId, item.ledger.factId);
          if (change.changes !== 1) {
            throw new KnowledgeFactProjectionStoreError();
          }
          updatedCycleMetadata = true;
        }
      }
      if (insertedRoot || updatedCycleMetadata) {
        this.emitStage(KnowledgeFactProjectionStoreStage.AfterRootBackfill);
      }
    }
  }

  private validateAllProjectionStateInCurrentTransaction(): void {
    const orphanRoot = this.db.prepare(`
      SELECT 1
      FROM knowledge_fact_projection_support_group_roots AS roots
      LEFT JOIN knowledge_fact_projection_support_groups AS groups
        ON groups.workspace_id = roots.workspace_id
        AND groups.domain = roots.domain
        AND groups.normalized_value = roots.normalized_value
      WHERE groups.workspace_id IS NULL
      LIMIT 1
    `).get();
    const orphanLedger = this.db.prepare(`
      SELECT 1
      FROM knowledge_fact_profile_projection_ledger AS ledger
      LEFT JOIN knowledge_fact_projection_support_groups AS groups
        ON groups.workspace_id = ledger.workspace_id
        AND groups.domain = ledger.domain
        AND groups.normalized_value = ledger.normalized_value
      WHERE groups.workspace_id IS NULL
      LIMIT 1
    `).get();
    if (orphanRoot || orphanLedger) {
      throw new KnowledgeFactProjectionStoreError();
    }
    const groups = this.db.prepare(`
      SELECT workspace_id, domain, normalized_value, active_support_count
      FROM knowledge_fact_projection_support_groups
      ORDER BY workspace_id, domain, normalized_value
    `).all() as SupportGroupRow[];
    for (const row of groups) {
      const group = mapSupportGroup(row);
      this.readValidatedSupportGroupState(
        group.workspaceId,
        group.domain,
        group.normalizedValue,
      );
    }
  }

  private readLedgerStatesForGroup(
    workspaceId: string,
    domain: KnowledgeFactDomainValue,
    normalizedValue: string,
    allowMissingCycleRoot = false,
    allowedTransition?: AllowedFactTransition,
  ): LedgerWithRowId[] {
    const rows = this.db.prepare(`
      SELECT
        ledger.rowid AS row_id,
        ledger.fact_id,
        ledger.workspace_id,
        ledger.domain,
        ledger.normalized_value,
        ledger.cycle_root_fact_id,
        ledger.action,
        ledger.applied_value_json,
        ledger.prior_value_json,
        ledger.applied_profile_revision,
        ledger.applied_field_revision,
        ledger.prior_confirmed_key_present,
        ledger.prior_ignored_key_present,
        ledger.applied_at,
        ledger.reversed_at,
        fact.id AS owner_fact_id,
        fact.workspace_id AS owner_workspace_id,
        fact.domain AS owner_domain,
        fact.normalized_value AS owner_normalized_value,
        fact.review_status AS owner_review_status,
        fact.projection_state AS owner_projection_state,
        fact.tombstoned_at AS owner_tombstoned_at
      FROM knowledge_fact_profile_projection_ledger AS ledger
      LEFT JOIN knowledge_facts AS fact ON fact.id = ledger.fact_id
      WHERE
        ledger.workspace_id = ?
        AND ledger.domain = ?
        AND ledger.normalized_value = ?
      ORDER BY ledger.applied_at, ledger.rowid
    `).all(workspaceId, domain, normalizedValue) as LedgerStateRow[];
    return rows.map(row => {
      const item = mapLedgerWithRowId(row, allowMissingCycleRoot);
      const ledger = item.ledger;
      if (
        row.owner_fact_id !== ledger.factId ||
        row.owner_workspace_id !== ledger.workspaceId ||
        row.owner_domain !== ledger.domain ||
        row.owner_normalized_value !== ledger.normalizedValue
      ) {
        throw new KnowledgeFactProjectionStoreError();
      }
      const isAllowedTransition = allowedTransition?.factId === ledger.factId;
      if (isAllowedTransition) {
        const validConfirmTransition =
          allowedTransition.kind === 'confirm_after_apply' &&
          ledger.reversedAt === null &&
          row.owner_review_status === KnowledgeFactReviewStatus.Pending &&
          row.owner_projection_state === KnowledgeFactProjectionState.None &&
          row.owner_tombstoned_at === null;
        const validArchiveTransition =
          allowedTransition.kind === 'archive_after_reverse' &&
          ledger.reversedAt !== null &&
          row.owner_review_status === KnowledgeFactReviewStatus.Confirmed &&
          row.owner_projection_state === KnowledgeFactProjectionState.Active &&
          row.owner_tombstoned_at === null;
        if (!validConfirmTransition && !validArchiveTransition) {
          throw new KnowledgeFactProjectionStoreError();
        }
        return item;
      }
      const validActiveOwner =
        ledger.reversedAt === null &&
        row.owner_review_status === KnowledgeFactReviewStatus.Confirmed &&
        row.owner_projection_state === KnowledgeFactProjectionState.Active &&
        row.owner_tombstoned_at === null;
      const validReversedOwner =
        ledger.reversedAt !== null &&
        row.owner_review_status === KnowledgeFactReviewStatus.Confirmed &&
        row.owner_projection_state === KnowledgeFactProjectionState.Reversed &&
        row.owner_tombstoned_at === ledger.reversedAt;
      if (!validActiveOwner && !validReversedOwner) {
        throw new KnowledgeFactProjectionStoreError();
      }
      return item;
    });
  }

  private readValidatedSupportGroupState(
    workspaceId: string,
    domain: KnowledgeFactDomainValue,
    normalizedValue: string,
    allowedTransition?: AllowedFactTransition,
  ): ValidatedSupportGroupState {
    if (
      !isNonEmptyString(workspaceId) ||
      !domainSet.has(domain) ||
      !isNonEmptyString(normalizedValue)
    ) {
      throw new KnowledgeFactProjectionStoreError();
    }
    const groupRow = this.db.prepare(`
      SELECT workspace_id, domain, normalized_value, active_support_count
      FROM knowledge_fact_projection_support_groups
      WHERE workspace_id = ? AND domain = ? AND normalized_value = ?
      LIMIT 1
    `).get(workspaceId, domain, normalizedValue) as SupportGroupRow | undefined;
    const rootRow = this.db.prepare(`
      SELECT workspace_id, domain, normalized_value, root_fact_id
      FROM knowledge_fact_projection_support_group_roots
      WHERE workspace_id = ? AND domain = ? AND normalized_value = ?
      LIMIT 1
    `).get(workspaceId, domain, normalizedValue) as SupportGroupRootRow | undefined;
    const group = groupRow ? mapSupportGroup(groupRow) : null;
    const ledgers = this.readLedgerStatesForGroup(
      workspaceId,
      domain,
      normalizedValue,
      false,
      allowedTransition,
    );
    if (!group) {
      if (rootRow || ledgers.length > 0) {
        throw new KnowledgeFactProjectionStoreError();
      }
      return { group: null, rootLedger: null };
    }
    const activeLedgers = ledgers.filter(item => item.ledger.reversedAt === null);
    const activeSupportCount = activeLedgers.length;
    if (activeSupportCount !== group.activeSupportCount) {
      throw new KnowledgeFactProjectionStoreError();
    }
    if (!rootRow) {
      throw new KnowledgeFactProjectionStoreError();
    }
    if (
      rootRow.workspace_id !== workspaceId ||
      rootRow.domain !== domain ||
      rootRow.normalized_value !== normalizedValue ||
      !isNonEmptyString(rootRow.root_fact_id)
    ) {
      throw new KnowledgeFactProjectionStoreError();
    }
    const root = ledgers.find(item => item.ledger.factId === rootRow.root_fact_id);
    if (
      !root ||
      root.ledger.cycleRootFactId !== root.ledger.factId
    ) {
      throw new KnowledgeFactProjectionStoreError();
    }
    for (const item of ledgers) {
      const cycleRoot = ledgers.find(candidate =>
        candidate.ledger.factId === item.ledger.cycleRootFactId);
      if (
        !cycleRoot ||
        cycleRoot.ledger.cycleRootFactId !== cycleRoot.ledger.factId
      ) {
        throw new KnowledgeFactProjectionStoreError();
      }
    }
    if (activeLedgers.some(item =>
      item.ledger.cycleRootFactId !== root.ledger.factId)) {
      throw new KnowledgeFactProjectionStoreError();
    }
    return { group, rootLedger: root.ledger };
  }

  private assertCurrentTransaction(): void {
    if (!this.db.inTransaction) {
      throw new KnowledgeFactProjectionStoreError();
    }
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new KnowledgeFactProjectionBackendNotReadyError();
  }

  private emitStage(stage: KnowledgeFactProjectionStoreStage): void {
    this.options.onStage?.(stage);
  }

  private rethrow(error: unknown): never {
    if (isTransientSqliteBusyError(error)) {
      throw error;
    }
    if (error instanceof KnowledgeFactProjectionStoreError) {
      throw error;
    }
    if (error instanceof KnowledgeFactProjectionBackendNotReadyError) {
      throw error;
    }
    throw new KnowledgeFactProjectionStoreError();
  }
}
