import { randomUUID } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';

import Database from 'better-sqlite3';

import {
  KNOWLEDGE_ENRICHMENT_SAFE_ERROR_MAX_CHARS,
  type KnowledgeBaseErrorCode,
  KnowledgeBaseErrorCode as KnowledgeBaseErrorCodes,
  type KnowledgeEnrichmentAttemptOutcome,
  KnowledgeEnrichmentAttemptOutcome as KnowledgeEnrichmentAttemptOutcomes,
  type KnowledgeEnrichmentPartialReason,
  KnowledgeEnrichmentPartialReason as KnowledgeEnrichmentPartialReasons,
  type KnowledgeEnrichmentStatus,
  KnowledgeEnrichmentStatus as KnowledgeEnrichmentStatuses,
} from '../../shared/knowledgeBase/constants';
import type { KnowledgeEnrichmentSummary } from '../../shared/knowledgeBase/types';
import {
  isTransientSqliteBusyError,
  runTransientSqliteWriteTransaction,
} from '../libs/sqliteTransactionRetry';
import type {
  CreateAuthorizedEnrichmentRequestInput,
  EmptyCompletionCounts,
  FinalizeKnowledgeEnrichmentPublicationInput,
  KnowledgeEnrichmentAttempt,
  KnowledgeEnrichmentAuthorizedTransition,
  KnowledgeEnrichmentClaim,
  KnowledgeEnrichmentRequest,
  KnowledgeEnrichmentSafeFailureCode,
  RetryAuthorizedEnrichmentRequestInput,
  SafeFailure,
} from './knowledgeEnrichmentTypes';
import { REVIEWABLE_PENDING_SQL } from './knowledgeFactStore';

type KnowledgeEnrichmentRequestRow = {
  id: unknown;
  workspace_id: unknown;
  document_id: unknown;
  document_version_id: unknown;
  status: unknown;
  consent_mode: unknown;
  provider_id: unknown;
  model_id: unknown;
  routing_fingerprint: unknown;
  revision: unknown;
  progress: unknown;
  attempt_count: unknown;
  active_attempt_id: unknown;
  error_code: unknown;
  error_message: unknown;
  valid_candidate_count: unknown;
  discarded_candidate_count: unknown;
  partial_reasons_json: unknown;
  requested_at: unknown;
  started_at: unknown;
  heartbeat_at: unknown;
  completed_at: unknown;
  updated_at: unknown;
  active_running_attempt_count: unknown;
  running_attempt_count: unknown;
  pending_fact_count: unknown;
};

type KnowledgeEnrichmentAttemptRow = {
  id: unknown;
  request_id: unknown;
  attempt_number: unknown;
  started_at: unknown;
  heartbeat_at: unknown;
  finished_at: unknown;
  outcome: unknown;
  error_code: unknown;
  error_message: unknown;
};

type NormalizedAuthorizedInput = Omit<CreateAuthorizedEnrichmentRequestInput, 'now'> & {
  now: string;
};

type NormalizedEmptyCompletion = {
  validCandidateCount: 0;
  discardedCandidateCount: 0;
  partialReasons: readonly KnowledgeEnrichmentPartialReason[];
  now: string;
};

type NormalizedSafeFailure = {
  code: KnowledgeEnrichmentSafeFailureCode;
  now: string;
};

type PlainRecord = Record<string, unknown>;

type ActiveTransitionRow = {
  id: string;
  revision: number;
  status: KnowledgeEnrichmentStatus;
  active_attempt_id: string | null;
};

class KnowledgeEnrichmentCasRetryError extends Error {}

const claimCasRetry = Symbol('knowledge-enrichment-claim-cas-retry');

type KnowledgeEnrichmentTransientSqliteCode = 'SQLITE_BUSY' | 'SQLITE_BUSY_SNAPSHOT';

export interface KnowledgeEnrichmentRequestStoreOptions {
  uuidFactory?: () => string;
  clock?: () => string;
  afterSelect?: () => void;
}

const requestBaseSelectColumns = (alias: string): string => `
  ${alias}.id AS id,
  ${alias}.workspace_id AS workspace_id,
  ${alias}.document_id AS document_id,
  ${alias}.document_version_id AS document_version_id,
  ${alias}.status AS status,
  ${alias}.consent_mode AS consent_mode,
  ${alias}.provider_id AS provider_id,
  ${alias}.model_id AS model_id,
  ${alias}.routing_fingerprint AS routing_fingerprint,
  ${alias}.revision AS revision,
  ${alias}.progress AS progress,
  ${alias}.attempt_count AS attempt_count,
  ${alias}.active_attempt_id AS active_attempt_id,
  ${alias}.error_code AS error_code,
  ${alias}.error_message AS error_message,
  ${alias}.valid_candidate_count AS valid_candidate_count,
  ${alias}.discarded_candidate_count AS discarded_candidate_count,
  ${alias}.partial_reasons_json AS partial_reasons_json,
  ${alias}.requested_at AS requested_at,
  ${alias}.started_at AS started_at,
  ${alias}.heartbeat_at AS heartbeat_at,
  ${alias}.completed_at AS completed_at,
  ${alias}.updated_at AS updated_at
`;

const ATTEMPT_SELECT_COLUMNS = `
  id,
  request_id,
  attempt_number,
  started_at,
  heartbeat_at,
  finished_at,
  outcome,
  error_code,
  error_message
`;

const KNOWLEDGE_ENRICHMENT_CONSENT_MODE = 'explicit' as const;

const requestAggregatedSelectColumns = (alias: string): string => `
  ${requestBaseSelectColumns(alias)},
  (
    SELECT COUNT(*)
    FROM knowledge_enrichment_attempts AS active_attempt
    WHERE
      active_attempt.request_id = ${alias}.id
      AND active_attempt.id = ${alias}.active_attempt_id
      AND active_attempt.outcome = '${KnowledgeEnrichmentAttemptOutcomes.Running}'
  ) AS active_running_attempt_count,
  (
    SELECT COUNT(*)
    FROM knowledge_enrichment_attempts AS running_attempt
    WHERE
      running_attempt.request_id = ${alias}.id
      AND running_attempt.outcome = '${KnowledgeEnrichmentAttemptOutcomes.Running}'
  ) AS running_attempt_count,
  COALESCE(pending_fact_counts.pending_fact_count, 0) AS pending_fact_count
`;

const buildMappedRequestQuery = (
  selectedRequestSql: string,
  orderBySql = '',
): string => `
  WITH
  selected_request AS (
    ${selectedRequestSql}
  ),
  pending_fact_counts AS (
    SELECT
      membership.request_id,
      COUNT(DISTINCT membership.fact_id) AS pending_fact_count
    FROM selected_request
    JOIN knowledge_enrichment_request_facts AS membership
      ON membership.request_id = selected_request.id
    JOIN knowledge_facts AS fact ON fact.id = membership.fact_id
    WHERE ${REVIEWABLE_PENDING_SQL}
    GROUP BY membership.request_id
  )
  SELECT ${requestAggregatedSelectColumns('selected_request')}
  FROM selected_request
  LEFT JOIN pending_fact_counts
    ON pending_fact_counts.request_id = selected_request.id
  ${orderBySql}
`;

const activeStatuses = [
  KnowledgeEnrichmentStatuses.Queued,
  KnowledgeEnrichmentStatuses.Running,
  KnowledgeEnrichmentStatuses.ReviewRequired,
] as const;
const ACTIVE_REQUEST_STATUS_SQL = activeStatuses
  .map(status => `'${status}'`)
  .join(', ');

const requestStatusSet = new Set<string>(Object.values(KnowledgeEnrichmentStatuses));
const attemptOutcomeSet = new Set<string>(Object.values(KnowledgeEnrichmentAttemptOutcomes));
const partialReasonSet = new Set<string>(Object.values(KnowledgeEnrichmentPartialReasons));
const partialReasonOrder: readonly KnowledgeEnrichmentPartialReason[] = [
  KnowledgeEnrichmentPartialReasons.ChunkLimit,
  KnowledgeEnrichmentPartialReasons.CandidateLimit,
];

const safeFailureMessages: Record<KnowledgeEnrichmentSafeFailureCode, string> = {
  [KnowledgeBaseErrorCodes.ModelConfigurationUnavailable]:
    'Model configuration is unavailable',
  [KnowledgeBaseErrorCodes.ModelConfigurationChanged]:
    'Model configuration changed',
  [KnowledgeBaseErrorCodes.UnsupportedModelProvider]:
    'Model provider is unsupported',
  [KnowledgeBaseErrorCodes.ModelRequestFailed]: 'Model request failed',
  [KnowledgeBaseErrorCodes.ModelRequestTimeout]: 'Model request timed out',
  [KnowledgeBaseErrorCodes.InvalidModelResponse]: 'Model response is invalid',
  [KnowledgeBaseErrorCodes.EvidenceValidationFailed]: 'Evidence validation failed',
  [KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed]: 'Enrichment persistence failed',
  [KnowledgeBaseErrorCodes.AuthorizationRequired]: 'Authorization is required',
};

const staleErrorMessage = 'Enrichment request is stale';
const persistedErrorCodes = new Set<string>([
  ...Object.keys(safeFailureMessages),
  KnowledgeBaseErrorCodes.EnrichmentRequestStale,
]);

const fixedPersistedErrorMessage = (code: KnowledgeBaseErrorCode): string => {
  if (code === KnowledgeBaseErrorCodes.EnrichmentRequestStale) {
    return staleErrorMessage;
  }
  const message = safeFailureMessages[code as KnowledgeEnrichmentSafeFailureCode];
  if (!message) {
    return throwCorruptState();
  }
  return message;
};

const throwCorruptState = (): never => {
  throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.JobStateConflict);
};

const requireNonEmptyString = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return throwCorruptState();
  }
  return value;
};

const requireNullableNonEmptyString = (value: unknown): string | null => {
  if (value === null) {
    return null;
  }
  return requireNonEmptyString(value);
};

const isCanonicalTimestamp = (value: string): boolean => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const requireTimestamp = (value: unknown): string => {
  if (typeof value !== 'string' || !isCanonicalTimestamp(value)) {
    return throwCorruptState();
  }
  return value;
};

const requireNullableTimestamp = (value: unknown): string | null => {
  if (value === null) {
    return null;
  }
  return requireTimestamp(value);
};

const requireInteger = (
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return throwCorruptState();
  }
  return value as number;
};

const requireRequestStatus = (value: unknown): KnowledgeEnrichmentStatus => {
  if (typeof value !== 'string' || !requestStatusSet.has(value)) {
    return throwCorruptState();
  }
  return value as KnowledgeEnrichmentStatus;
};

const requireAttemptOutcome = (value: unknown): KnowledgeEnrichmentAttemptOutcome => {
  if (typeof value !== 'string' || !attemptOutcomeSet.has(value)) {
    return throwCorruptState();
  }
  return value as KnowledgeEnrichmentAttemptOutcome;
};

const requireRoutingFingerprint = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    return throwCorruptState();
  }
  return value;
};

const requirePersistedErrorCode = (value: unknown): KnowledgeBaseErrorCode | null => {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || !persistedErrorCodes.has(value)) {
    return throwCorruptState();
  }
  return value as KnowledgeBaseErrorCode;
};

const requirePersistedErrorMessage = (value: unknown): string | null => {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== 'string' ||
    value.length > KNOWLEDGE_ENRICHMENT_SAFE_ERROR_MAX_CHARS
  ) {
    return throwCorruptState();
  }
  return value;
};

const parsePartialReasons = (value: unknown): KnowledgeEnrichmentPartialReason[] => {
  if (typeof value !== 'string') {
    return throwCorruptState();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return throwCorruptState();
  }
  if (!Array.isArray(parsed)) {
    return throwCorruptState();
  }
  const reasons = parsed.map(reason => {
    if (typeof reason !== 'string' || !partialReasonSet.has(reason)) {
      return throwCorruptState();
    }
    return reason as KnowledgeEnrichmentPartialReason;
  });
  if (new Set(reasons).size !== reasons.length) {
    return throwCorruptState();
  }
  return partialReasonOrder.filter(reason => reasons.includes(reason));
};

const mapRequestRow = (row: KnowledgeEnrichmentRequestRow): KnowledgeEnrichmentRequest => {
  const status = requireRequestStatus(row.status);
  const activeAttemptId = requireNullableNonEmptyString(row.active_attempt_id);
  const activeRunningAttemptCount = requireInteger(row.active_running_attempt_count, 0);
  const runningAttemptCount = requireInteger(row.running_attempt_count, 0);
  if (
    (status === KnowledgeEnrichmentStatuses.Running && activeAttemptId === null) ||
    (status !== KnowledgeEnrichmentStatuses.Running && activeAttemptId !== null) ||
    (
      status === KnowledgeEnrichmentStatuses.Running &&
      (activeRunningAttemptCount !== 1 || runningAttemptCount !== 1)
    ) ||
    (
      status !== KnowledgeEnrichmentStatuses.Running &&
      (activeRunningAttemptCount !== 0 || runningAttemptCount !== 0)
    )
  ) {
    return throwCorruptState();
  }
  if (row.consent_mode !== KNOWLEDGE_ENRICHMENT_CONSENT_MODE) {
    return throwCorruptState();
  }
  const errorCode = requirePersistedErrorCode(row.error_code);
  const errorMessage = requirePersistedErrorMessage(row.error_message);
  if ((errorCode === null) !== (errorMessage === null)) {
    return throwCorruptState();
  }
  if (errorCode !== null && errorMessage !== fixedPersistedErrorMessage(errorCode)) {
    return throwCorruptState();
  }
  return {
    id: requireNonEmptyString(row.id),
    workspaceId: requireNonEmptyString(row.workspace_id),
    documentId: requireNonEmptyString(row.document_id),
    documentVersionId: requireNonEmptyString(row.document_version_id),
    status,
    consentMode: KNOWLEDGE_ENRICHMENT_CONSENT_MODE,
    providerId: requireNonEmptyString(row.provider_id),
    modelId: requireNonEmptyString(row.model_id),
    routingFingerprint: requireRoutingFingerprint(row.routing_fingerprint),
    revision: requireInteger(row.revision, 1),
    progress: requireInteger(row.progress, 0, 100),
    attemptCount: requireInteger(row.attempt_count, 0),
    activeAttemptId,
    errorCode,
    errorMessage,
    validCandidateCount: requireInteger(row.valid_candidate_count, 0),
    discardedCandidateCount: requireInteger(row.discarded_candidate_count, 0),
    partialReasons: parsePartialReasons(row.partial_reasons_json),
    requestedAt: requireTimestamp(row.requested_at),
    startedAt: requireNullableTimestamp(row.started_at),
    heartbeatAt: requireNullableTimestamp(row.heartbeat_at),
    completedAt: requireNullableTimestamp(row.completed_at),
    updatedAt: requireTimestamp(row.updated_at),
  };
};

const mapAttemptRow = (row: KnowledgeEnrichmentAttemptRow): KnowledgeEnrichmentAttempt => {
  const outcome = requireAttemptOutcome(row.outcome);
  const finishedAt = requireNullableTimestamp(row.finished_at);
  if (
    (outcome === KnowledgeEnrichmentAttemptOutcomes.Running && finishedAt !== null) ||
    (outcome !== KnowledgeEnrichmentAttemptOutcomes.Running && finishedAt === null)
  ) {
    return throwCorruptState();
  }
  const errorCode = requirePersistedErrorCode(row.error_code);
  const errorMessage = requirePersistedErrorMessage(row.error_message);
  if ((errorCode === null) !== (errorMessage === null)) {
    return throwCorruptState();
  }
  if (errorCode !== null && errorMessage !== fixedPersistedErrorMessage(errorCode)) {
    return throwCorruptState();
  }
  return {
    id: requireNonEmptyString(row.id),
    requestId: requireNonEmptyString(row.request_id),
    attemptNumber: requireInteger(row.attempt_number, 1),
    startedAt: requireTimestamp(row.started_at),
    heartbeatAt: requireTimestamp(row.heartbeat_at),
    finishedAt,
    outcome,
    errorCode,
    errorMessage,
  };
};

const toSummary = (
  request: KnowledgeEnrichmentRequest,
  pendingFactCount = 0,
): KnowledgeEnrichmentSummary => ({
  requestId: request.id,
  documentId: request.documentId,
  documentVersionId: request.documentVersionId,
  status: request.status,
  progress: request.progress,
  revision: request.revision,
  attemptCount: request.attemptCount,
  validCandidateCount: request.validCandidateCount,
  discardedCandidateCount: request.discardedCandidateCount,
  pendingFactCount,
  partialReasons: [...request.partialReasons],
  errorCode: request.errorCode,
  createdAt: request.requestedAt,
  updatedAt: request.updatedAt,
  completedAt: request.completedAt,
});

const mapSummaryRow = (row: KnowledgeEnrichmentRequestRow): KnowledgeEnrichmentSummary =>
  toSummary(mapRequestRow(row), requireInteger(row.pending_fact_count, 0));

const matchesRoute = (
  request: KnowledgeEnrichmentRequest,
  input: Omit<NormalizedAuthorizedInput, 'now'>,
): boolean =>
  request.workspaceId === input.workspaceId &&
  request.documentId === input.documentId &&
  request.documentVersionId === input.documentVersionId &&
  request.providerId === input.providerId &&
  request.modelId === input.modelId &&
  request.routingFingerprint === input.routingFingerprint;

const isSqliteConstraintError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof error.code === 'string' &&
  error.code.startsWith('SQLITE_CONSTRAINT');

const isSqliteError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof error.code === 'string' &&
  error.code.startsWith('SQLITE_');

export class KnowledgeEnrichmentRevisionConflictError extends Error {
  readonly code = KnowledgeBaseErrorCodes.RevisionConflict;

  constructor(readonly latestSummary: KnowledgeEnrichmentSummary) {
    super(KnowledgeBaseErrorCodes.RevisionConflict);
    this.name = 'KnowledgeEnrichmentRevisionConflictError';
    delete this.stack;
  }
}

export class KnowledgeEnrichmentRequestStateError extends Error {
  constructor(readonly code: KnowledgeBaseErrorCode) {
    super(code);
    this.name = 'KnowledgeEnrichmentRequestStateError';
    delete this.stack;
  }
}

export class KnowledgeEnrichmentTransientSqliteError extends Error {
  constructor(readonly code: KnowledgeEnrichmentTransientSqliteCode) {
    super('knowledge_enrichment_transient_sqlite_busy');
    this.name = 'KnowledgeEnrichmentTransientSqliteError';
    delete this.stack;
  }
}

export class KnowledgeEnrichmentRequestStore {
  private readonly uuidFactory: () => string;

  private readonly clock: () => string;

  constructor(
    private readonly db: Database.Database,
    private readonly options: KnowledgeEnrichmentRequestStoreOptions = {},
  ) {
    this.uuidFactory = options.uuidFactory ?? randomUUID;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.initialize();
  }

  getDatabaseForInternalUse(): Database.Database {
    return this.db;
  }

  createOrGetAuthorizedRequest(
    input: CreateAuthorizedEnrichmentRequestInput,
  ): KnowledgeEnrichmentRequest {
    const normalized = this.normalizeAuthorizedInput(input);
    const transaction = this.db.transaction(() =>
      this.createOrGetAuthorizedRequestInCurrentTransaction(normalized));
    try {
      return this.runWriteTransaction(transaction).request;
    } catch (error) {
      this.rethrowSafeWriteError(error);
    }
  }

  createOrGetAuthorizedRequestInCurrentTransaction(
    input: CreateAuthorizedEnrichmentRequestInput,
  ): KnowledgeEnrichmentAuthorizedTransition {
    this.assertCurrentTransaction();
    const normalized = this.normalizeAuthorizedInput(input);
    try {
      const active = this.selectActiveRequest(normalized.documentVersionId);
      if (active) {
        this.options.afterSelect?.();
        return { request: active, queuedTransition: false };
      }
      const latest = this.selectLatestRequest(
        normalized.workspaceId,
        normalized.documentVersionId,
      );
      this.options.afterSelect?.();
      if (
        latest?.status === KnowledgeEnrichmentStatuses.Failed &&
        matchesRoute(latest, normalized)
      ) {
        return { request: latest, queuedTransition: false };
      }

      const requestId = this.nextUuid();
      this.db.prepare(`
        INSERT INTO knowledge_enrichment_requests (
          id, workspace_id, document_id, document_version_id, status, consent_mode,
          provider_id, model_id, routing_fingerprint, revision, progress, attempt_count,
          active_attempt_id, error_code, error_message, valid_candidate_count,
          discarded_candidate_count, partial_reasons_json, requested_at, started_at,
          heartbeat_at, completed_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, '${KNOWLEDGE_ENRICHMENT_CONSENT_MODE}',
          ?, ?, ?, 1, 0, 0,
          NULL, NULL, NULL, 0,
          0, '[]', ?, NULL,
          NULL, NULL, ?
        )
      `).run(
        requestId,
        normalized.workspaceId,
        normalized.documentId,
        normalized.documentVersionId,
        KnowledgeEnrichmentStatuses.Queued,
        normalized.providerId,
        normalized.modelId,
        normalized.routingFingerprint,
        normalized.now,
        normalized.now,
      );
      return {
        request: this.requireRequest(requestId),
        queuedTransition: true,
      };
    } catch (error) {
      if (isSqliteConstraintError(error)) {
        try {
          const winner = this.selectActiveRequest(normalized.documentVersionId);
          if (winner) {
            return { request: winner, queuedTransition: false };
          }
        } catch (resolutionError) {
          this.rethrowSafeWriteError(resolutionError);
        }
        throw new KnowledgeEnrichmentRequestStateError(
          KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
        );
      }
      this.rethrowSafeWriteError(error);
    }
  }

  getRequest(requestId: string): KnowledgeEnrichmentRequest | null {
    const normalizedRequestId = this.normalizeIdentifier(requestId);
    const row = this.db.prepare(buildMappedRequestQuery(`
      SELECT ${requestBaseSelectColumns('request')}
      FROM knowledge_enrichment_requests AS request
      WHERE request.id = ?
      LIMIT 1
    `)).get(normalizedRequestId) as KnowledgeEnrichmentRequestRow | undefined;
    return row ? mapRequestRow(row) : null;
  }

  getSummary(requestId: string): KnowledgeEnrichmentSummary | null {
    const normalizedRequestId = this.normalizeIdentifier(requestId);
    const row = this.db.prepare(buildMappedRequestQuery(`
      SELECT ${requestBaseSelectColumns('request')}
      FROM knowledge_enrichment_requests AS request
      WHERE request.id = ?
      LIMIT 1
    `)).get(normalizedRequestId) as KnowledgeEnrichmentRequestRow | undefined;
    return row ? mapSummaryRow(row) : null;
  }

  getRunningLeaseInCurrentTransaction(
    requestId: string,
    attemptId: string,
  ): KnowledgeEnrichmentClaim | null {
    this.assertCurrentTransaction();
    const normalizedRequestId = this.normalizeIdentifier(requestId);
    const normalizedAttemptId = this.normalizeIdentifier(attemptId);
    const request = this.getRequest(normalizedRequestId);
    if (
      !request ||
      request.status !== KnowledgeEnrichmentStatuses.Running ||
      request.activeAttemptId !== normalizedAttemptId
    ) {
      return null;
    }
    const row = this.db.prepare(`
      SELECT ${ATTEMPT_SELECT_COLUMNS}
      FROM knowledge_enrichment_attempts
      WHERE id = ? AND request_id = ? AND outcome = ?
      LIMIT 1
    `).get(
      normalizedAttemptId,
      normalizedRequestId,
      KnowledgeEnrichmentAttemptOutcomes.Running,
    ) as KnowledgeEnrichmentAttemptRow | undefined;
    return row ? { request, attempt: mapAttemptRow(row) } : null;
  }

  finalizePublicationInCurrentTransaction(
    input: FinalizeKnowledgeEnrichmentPublicationInput,
    afterAttemptFinalized?: () => void,
  ): KnowledgeEnrichmentRequest | null {
    this.assertCurrentTransaction();
    const requestId = this.normalizeIdentifier(input.requestId);
    const attemptId = this.normalizeIdentifier(input.attemptId);
    const now = this.normalizeNow(input.now);
    if (
      input.status !== KnowledgeEnrichmentStatuses.ReviewRequired &&
      input.status !== KnowledgeEnrichmentStatuses.Completed
    ) {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    const validCandidateCount = requireInteger(input.validCandidateCount, 0, 200);
    const discardedCandidateCount = requireInteger(input.discardedCandidateCount, 0);
    const partialReasons = this.normalizeOwnDataArray(input.partialReasons, reason => {
      if (typeof reason !== 'string' || !partialReasonSet.has(reason)) {
        throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
      }
      return reason as KnowledgeEnrichmentPartialReason;
    });
    if (new Set(partialReasons).size !== partialReasons.length) {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    const canonicalPartialReasons = partialReasonOrder.filter(reason =>
      partialReasons.includes(reason));
    if (canonicalPartialReasons.some((reason, index) => reason !== partialReasons[index])) {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    const attemptUpdated = this.db.prepare(`
      UPDATE knowledge_enrichment_attempts
      SET
        outcome = ?,
        finished_at = ?,
        error_code = NULL,
        error_message = NULL
      WHERE id = ? AND request_id = ? AND outcome = ?
    `).run(
      KnowledgeEnrichmentAttemptOutcomes.Completed,
      now,
      attemptId,
      requestId,
      KnowledgeEnrichmentAttemptOutcomes.Running,
    );
    if (attemptUpdated.changes === 0) {
      return null;
    }
    if (attemptUpdated.changes !== 1) {
      throw new KnowledgeEnrichmentRequestStateError(
        KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
      );
    }
    afterAttemptFinalized?.();
    const completedAt = input.status === KnowledgeEnrichmentStatuses.Completed ? now : null;
    const requestUpdated = this.db.prepare(`
      UPDATE knowledge_enrichment_requests
      SET
        status = ?,
        progress = 100,
        active_attempt_id = NULL,
        error_code = NULL,
        error_message = NULL,
        valid_candidate_count = ?,
        discarded_candidate_count = ?,
        partial_reasons_json = ?,
        heartbeat_at = NULL,
        completed_at = ?,
        updated_at = ?
      WHERE id = ? AND status = ? AND active_attempt_id = ?
    `).run(
      input.status,
      validCandidateCount,
      discardedCandidateCount,
      JSON.stringify(canonicalPartialReasons),
      completedAt,
      now,
      requestId,
      KnowledgeEnrichmentStatuses.Running,
      attemptId,
    );
    if (requestUpdated.changes !== 1) {
      throw new KnowledgeEnrichmentRequestStateError(
        KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
      );
    }
    return this.requireRequest(requestId);
  }

  getSummaryInCurrentTransaction(requestId: string): KnowledgeEnrichmentSummary | null {
    this.assertCurrentTransaction();
    return this.getSummary(requestId);
  }

  completeReviewRequiredRequestsInCurrentTransaction(
    requestIds: readonly string[],
    now: string,
  ): number {
    this.assertCurrentTransaction();
    const normalizedNow = this.normalizeNow(now);
    const ids = [...new Set(this.normalizeOwnDataArray(
      requestIds,
      requestId => this.normalizeIdentifier(requestId),
    ))].sort();
    if (ids.length === 0) {
      return 0;
    }
    return this.db.prepare(`
      UPDATE knowledge_enrichment_requests AS request
      SET status = ?, completed_at = ?, updated_at = ?
      WHERE
        request.status = ?
        AND request.id IN (SELECT value FROM JSON_EACH(?))
        AND NOT EXISTS (
          SELECT 1
          FROM knowledge_enrichment_request_facts AS membership
          JOIN knowledge_facts AS fact ON fact.id = membership.fact_id
          WHERE
            membership.request_id = request.id
            AND (${REVIEWABLE_PENDING_SQL})
        )
    `).run(
      KnowledgeEnrichmentStatuses.Completed,
      normalizedNow,
      normalizedNow,
      KnowledgeEnrichmentStatuses.ReviewRequired,
      JSON.stringify(ids),
    ).changes;
  }

  getActiveRequestForVersion(documentVersionId: string): KnowledgeEnrichmentRequest | null {
    const normalizedVersionId = this.normalizeIdentifier(documentVersionId);
    return this.selectActiveRequest(normalizedVersionId);
  }

  listWorkspaceSummaries(workspaceId: string): KnowledgeEnrichmentSummary[] {
    const normalizedWorkspaceId = this.normalizeIdentifier(workspaceId);
    const rows = this.db.prepare(buildMappedRequestQuery(`
      WITH ranked_requests AS (
        SELECT
          ${requestBaseSelectColumns('request')},
          ROW_NUMBER() OVER (
            PARTITION BY request.document_version_id
            ORDER BY request.requested_at DESC, request.id DESC
          ) AS latest_rank
        FROM knowledge_enrichment_requests AS request
        WHERE request.workspace_id = ?
      )
      SELECT ${requestBaseSelectColumns('ranked_request')}
      FROM ranked_requests AS ranked_request
      WHERE ranked_request.latest_rank = 1
    `, 'ORDER BY selected_request.requested_at DESC, selected_request.id DESC'))
      .all(normalizedWorkspaceId) as KnowledgeEnrichmentRequestRow[];
    return rows.map(mapSummaryRow);
  }

  listLatestSummariesForVersions(
    workspaceId: string,
    documentVersionIds: readonly string[],
  ): Map<string, KnowledgeEnrichmentSummary> {
    const normalizedWorkspaceId = this.normalizeIdentifier(workspaceId);
    const normalizedVersionIds = this.normalizeOwnDataArray(
      documentVersionIds,
      documentVersionId => this.normalizeIdentifier(documentVersionId),
    );
    if (normalizedVersionIds.length === 0) {
      return new Map();
    }
    const rows = this.db.prepare(buildMappedRequestQuery(`
      WITH
      requested_versions AS (
        SELECT DISTINCT requested.value AS document_version_id
        FROM json_each(?) AS requested
        WHERE requested.type = 'text'
      ),
      ranked_requests AS (
        SELECT
          ${requestBaseSelectColumns('request')},
          ROW_NUMBER() OVER (
            PARTITION BY request.document_version_id
            ORDER BY request.requested_at DESC, request.id DESC
          ) AS latest_rank
        FROM knowledge_enrichment_requests AS request
        JOIN requested_versions AS requested_version
          ON requested_version.document_version_id = request.document_version_id
        WHERE request.workspace_id = ?
      )
      SELECT ${requestBaseSelectColumns('ranked_request')}
      FROM ranked_requests AS ranked_request
      WHERE ranked_request.latest_rank = 1
    `)).all(
      JSON.stringify(normalizedVersionIds),
      normalizedWorkspaceId,
    ) as KnowledgeEnrichmentRequestRow[];
    return new Map(rows.map(row => {
      const summary = mapSummaryRow(row);
      return [summary.documentVersionId, summary];
    }));
  }

  listDocumentIdsWithStalePriorVersionExtraction(workspaceId: string): Set<string> {
    const normalizedWorkspaceId = this.normalizeIdentifier(workspaceId);
    const rows = this.db.prepare(`
      SELECT DISTINCT request.document_id AS document_id
      FROM knowledge_enrichment_requests AS request
      JOIN knowledge_documents AS document
        ON document.id = request.document_id
        AND document.workspace_id = request.workspace_id
      WHERE
        request.workspace_id = ?
        AND request.status = '${KnowledgeEnrichmentStatuses.Stale}'
        AND request.document_version_id <> document.current_version_id
      ORDER BY request.document_id ASC
    `).all(normalizedWorkspaceId) as Array<{ document_id: string }>;
    return new Set(rows.map(row => row.document_id));
  }

  claimNext(now = this.clock()): KnowledgeEnrichmentClaim | null {
    const normalizedNow = this.normalizeNow(now);
    while (true) {
      const transaction = this.db.transaction((): KnowledgeEnrichmentClaim | null |
        typeof claimCasRetry => {
        const queued = this.db.prepare(`
          SELECT id
          FROM knowledge_enrichment_requests
          WHERE status = ?
          ORDER BY updated_at ASC, id ASC
          LIMIT 1
        `).get(KnowledgeEnrichmentStatuses.Queued) as { id: string } | undefined;
        this.options.afterSelect?.();
        if (!queued) {
          return null;
        }

        const attemptId = this.nextUuid();
        const updated = this.db.prepare(`
          UPDATE knowledge_enrichment_requests
          SET
            status = ?,
            attempt_count = attempt_count + 1,
            active_attempt_id = ?,
            error_code = NULL,
            error_message = NULL,
            started_at = ?,
            heartbeat_at = ?,
            completed_at = NULL,
            updated_at = ?
          WHERE id = ? AND status = ? AND active_attempt_id IS NULL
          RETURNING attempt_count
        `).get(
          KnowledgeEnrichmentStatuses.Running,
          attemptId,
          normalizedNow,
          normalizedNow,
          normalizedNow,
          queued.id,
          KnowledgeEnrichmentStatuses.Queued,
        ) as { attempt_count: unknown } | undefined;
        if (!updated) {
          return claimCasRetry;
        }
        const attemptNumber = requireInteger(updated.attempt_count, 1);
        this.db.prepare(`
          INSERT INTO knowledge_enrichment_attempts (
            id, request_id, attempt_number, started_at, heartbeat_at,
            finished_at, outcome, error_code, error_message
          ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL)
        `).run(
          attemptId,
          queued.id,
          attemptNumber,
          normalizedNow,
          normalizedNow,
          KnowledgeEnrichmentAttemptOutcomes.Running,
        );
        const request = this.requireRequest(queued.id);
        return {
          request,
          attempt: this.requireAttempt(attemptId),
        };
      });
      try {
        const result = this.runWriteTransaction(transaction);
        if (result === claimCasRetry) {
          continue;
        }
        return result;
      } catch (error) {
        if (isSqliteConstraintError(error)) {
          throw new KnowledgeEnrichmentRequestStateError(
            KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
          );
        }
        this.rethrowSafeWriteError(error);
      }
    }
  }

  heartbeat(
    requestId: string,
    attemptId: string,
    progress: number,
    now = this.clock(),
  ): boolean {
    const normalizedRequestId = this.normalizeIdentifier(requestId);
    const normalizedAttemptId = this.normalizeIdentifier(attemptId);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    const normalizedNow = this.normalizeNow(now);
    const transaction = this.db.transaction(() => {
      const attemptUpdated = this.db.prepare(`
        UPDATE knowledge_enrichment_attempts AS attempt
        SET heartbeat_at = ?
        WHERE
          attempt.id = ?
          AND attempt.request_id = ?
          AND attempt.outcome = ?
          AND EXISTS (
            SELECT 1
            FROM knowledge_enrichment_requests AS request
            WHERE
              request.id = attempt.request_id
              AND request.status = ?
              AND request.active_attempt_id = attempt.id
          )
      `).run(
        normalizedNow,
        normalizedAttemptId,
        normalizedRequestId,
        KnowledgeEnrichmentAttemptOutcomes.Running,
        KnowledgeEnrichmentStatuses.Running,
      );
      if (attemptUpdated.changes === 0) {
        return false;
      }
      const requestUpdated = this.db.prepare(`
        UPDATE knowledge_enrichment_requests AS request
        SET
          progress = MAX(progress, ?),
          heartbeat_at = ?,
          updated_at = ?
        WHERE
          request.id = ?
          AND request.status = ?
          AND request.active_attempt_id = ?
          AND EXISTS (
            SELECT 1
            FROM knowledge_enrichment_attempts AS attempt
            WHERE
              attempt.id = request.active_attempt_id
              AND attempt.request_id = request.id
              AND attempt.outcome = ?
          )
      `).run(
        progress,
        normalizedNow,
        normalizedNow,
        normalizedRequestId,
        KnowledgeEnrichmentStatuses.Running,
        normalizedAttemptId,
        KnowledgeEnrichmentAttemptOutcomes.Running,
      );
      if (requestUpdated.changes === 0) {
        throw new KnowledgeEnrichmentRequestStateError(
          KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
        );
      }
      return true;
    });
    try {
      return this.runWriteTransaction(transaction);
    } catch (error) {
      this.rethrowSafeWriteError(error);
    }
  }

  completeEmpty(
    requestId: string,
    attemptId: string,
    input: EmptyCompletionCounts,
  ): boolean {
    const normalizedInput = this.normalizeEmptyCompletion(input);
    const normalizedRequestId = this.normalizeIdentifier(requestId);
    const normalizedAttemptId = this.normalizeIdentifier(attemptId);
    const normalizedNow = normalizedInput.now;
    const partialReasonsJson = JSON.stringify(normalizedInput.partialReasons);
    const transaction = this.db.transaction(() => {
      const attemptUpdated = this.db.prepare(`
        UPDATE knowledge_enrichment_attempts AS attempt
        SET
          outcome = ?,
          finished_at = ?,
          error_code = NULL,
          error_message = NULL
        WHERE
          attempt.id = ?
          AND attempt.request_id = ?
          AND attempt.outcome = ?
          AND EXISTS (
            SELECT 1
            FROM knowledge_enrichment_requests AS request
            WHERE
              request.id = attempt.request_id
              AND request.status = ?
              AND request.active_attempt_id = attempt.id
          )
      `).run(
        KnowledgeEnrichmentAttemptOutcomes.Completed,
        normalizedNow,
        normalizedAttemptId,
        normalizedRequestId,
        KnowledgeEnrichmentAttemptOutcomes.Running,
        KnowledgeEnrichmentStatuses.Running,
      );
      if (attemptUpdated.changes === 0) {
        return false;
      }
      const requestUpdated = this.db.prepare(`
        UPDATE knowledge_enrichment_requests AS request
        SET
          status = ?,
          progress = 100,
          active_attempt_id = NULL,
          error_code = NULL,
          error_message = NULL,
          valid_candidate_count = 0,
          discarded_candidate_count = 0,
          partial_reasons_json = ?,
          heartbeat_at = NULL,
          completed_at = ?,
          updated_at = ?
        WHERE
          request.id = ?
          AND request.status = ?
          AND request.active_attempt_id = ?
          AND EXISTS (
            SELECT 1
            FROM knowledge_enrichment_attempts AS attempt
            WHERE
              attempt.id = ?
              AND attempt.request_id = request.id
              AND attempt.outcome = ?
              AND attempt.finished_at = ?
          )
      `).run(
        KnowledgeEnrichmentStatuses.Completed,
        partialReasonsJson,
        normalizedNow,
        normalizedNow,
        normalizedRequestId,
        KnowledgeEnrichmentStatuses.Running,
        normalizedAttemptId,
        normalizedAttemptId,
        KnowledgeEnrichmentAttemptOutcomes.Completed,
        normalizedNow,
      );
      if (requestUpdated.changes === 0) {
        throw new KnowledgeEnrichmentRequestStateError(
          KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
        );
      }
      return true;
    });
    try {
      return this.runWriteTransaction(transaction);
    } catch (error) {
      this.rethrowSafeWriteError(error);
    }
  }

  failAttempt(requestId: string, attemptId: string, input: SafeFailure): boolean {
    const normalizedInput = this.normalizeSafeFailure(input);
    const errorMessage = safeFailureMessages[normalizedInput.code];
    const normalizedRequestId = this.normalizeIdentifier(requestId);
    const normalizedAttemptId = this.normalizeIdentifier(attemptId);
    const normalizedNow = normalizedInput.now;
    const transaction = this.db.transaction(() => {
      const attemptUpdated = this.db.prepare(`
        UPDATE knowledge_enrichment_attempts AS attempt
        SET
          outcome = ?,
          finished_at = ?,
          error_code = ?,
          error_message = ?
        WHERE
          attempt.id = ?
          AND attempt.request_id = ?
          AND attempt.outcome = ?
          AND EXISTS (
            SELECT 1
            FROM knowledge_enrichment_requests AS request
            WHERE
              request.id = attempt.request_id
              AND request.status = ?
              AND request.active_attempt_id = attempt.id
          )
      `).run(
        KnowledgeEnrichmentAttemptOutcomes.Failed,
        normalizedNow,
        normalizedInput.code,
        errorMessage,
        normalizedAttemptId,
        normalizedRequestId,
        KnowledgeEnrichmentAttemptOutcomes.Running,
        KnowledgeEnrichmentStatuses.Running,
      );
      if (attemptUpdated.changes === 0) {
        return false;
      }
      const requestUpdated = this.db.prepare(`
        UPDATE knowledge_enrichment_requests AS request
        SET
          status = ?,
          active_attempt_id = NULL,
          error_code = ?,
          error_message = ?,
          heartbeat_at = NULL,
          completed_at = ?,
          updated_at = ?
        WHERE
          request.id = ?
          AND request.status = ?
          AND request.active_attempt_id = ?
          AND EXISTS (
            SELECT 1
            FROM knowledge_enrichment_attempts AS attempt
            WHERE
              attempt.id = ?
              AND attempt.request_id = request.id
              AND attempt.outcome = ?
              AND attempt.finished_at = ?
          )
      `).run(
        KnowledgeEnrichmentStatuses.Failed,
        normalizedInput.code,
        errorMessage,
        normalizedNow,
        normalizedNow,
        normalizedRequestId,
        KnowledgeEnrichmentStatuses.Running,
        normalizedAttemptId,
        normalizedAttemptId,
        KnowledgeEnrichmentAttemptOutcomes.Failed,
        normalizedNow,
      );
      if (requestUpdated.changes === 0) {
        throw new KnowledgeEnrichmentRequestStateError(
          KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
        );
      }
      return true;
    });
    try {
      return this.runWriteTransaction(transaction);
    } catch (error) {
      this.rethrowSafeWriteError(error);
    }
  }

  cancel(
    requestId: string,
    expectedRevision: number,
    now = this.clock(),
  ): KnowledgeEnrichmentRequest {
    const normalizedRequestId = this.normalizeIdentifier(requestId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    const normalizedNow = this.normalizeNow(now);
    const transaction = this.db.transaction(() => {
      const current = this.getRequest(normalizedRequestId);
      if (!current) {
        throw new KnowledgeEnrichmentRequestStateError(
          KnowledgeBaseErrorCodes.EnrichmentRequestNotFound,
        );
      }
      if (current.revision !== expectedRevision) {
        const latestSummary = this.getSummary(current.id);
        if (!latestSummary) {
          throw new KnowledgeEnrichmentRequestStateError(
            KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
          );
        }
        throw new KnowledgeEnrichmentRevisionConflictError(latestSummary);
      }
      if (
        current.status !== KnowledgeEnrichmentStatuses.Queued &&
        current.status !== KnowledgeEnrichmentStatuses.Running
      ) {
        throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.JobStateConflict);
      }

      if (current.status === KnowledgeEnrichmentStatuses.Running) {
        const attemptUpdated = this.db.prepare(`
          UPDATE knowledge_enrichment_attempts AS attempt
          SET
            outcome = ?,
            finished_at = ?,
            error_code = NULL,
            error_message = NULL
          WHERE
            attempt.id = ?
            AND attempt.request_id = ?
            AND attempt.outcome = ?
            AND EXISTS (
              SELECT 1
              FROM knowledge_enrichment_requests AS request
              WHERE
                request.id = attempt.request_id
                AND request.revision = ?
                AND request.status = ?
                AND request.active_attempt_id = attempt.id
            )
        `).run(
          KnowledgeEnrichmentAttemptOutcomes.Cancelled,
          normalizedNow,
          current.activeAttemptId,
          normalizedRequestId,
          KnowledgeEnrichmentAttemptOutcomes.Running,
          expectedRevision,
          KnowledgeEnrichmentStatuses.Running,
        );
        if (attemptUpdated.changes === 0) {
          throw new KnowledgeEnrichmentCasRetryError();
        }
      }

      const requestUpdated = this.db.prepare(`
        UPDATE knowledge_enrichment_requests
        SET
          status = ?,
          revision = revision + 1,
          active_attempt_id = NULL,
          error_code = NULL,
          error_message = NULL,
          heartbeat_at = NULL,
          completed_at = ?,
          updated_at = ?
        WHERE
          id = ?
          AND revision = ?
          AND status IN (?, ?)
      `).run(
        KnowledgeEnrichmentStatuses.Cancelled,
        normalizedNow,
        normalizedNow,
        normalizedRequestId,
        expectedRevision,
        KnowledgeEnrichmentStatuses.Queued,
        KnowledgeEnrichmentStatuses.Running,
      );
      if (requestUpdated.changes === 0) {
        throw new KnowledgeEnrichmentCasRetryError();
      }
      return this.requireRequest(normalizedRequestId);
    });
    try {
      return this.runWriteTransaction(transaction);
    } catch (error) {
      if (error instanceof KnowledgeEnrichmentCasRetryError) {
        return this.resolveCancelConflict(normalizedRequestId, expectedRevision);
      }
      this.rethrowSafeWriteError(error);
    }
  }

  retryFailedWithAuthorization(
    input: RetryAuthorizedEnrichmentRequestInput,
  ): KnowledgeEnrichmentRequest {
    const normalized = this.normalizeRetryInput(input);
    const transaction = this.db.transaction(() =>
      this.retryFailedWithAuthorizationInCurrentTransaction(normalized));
    try {
      return this.runWriteTransaction(transaction).request;
    } catch (error) {
      this.rethrowSafeWriteError(error);
    }
  }

  retryFailedWithAuthorizationInCurrentTransaction(
    input: RetryAuthorizedEnrichmentRequestInput,
  ): KnowledgeEnrichmentAuthorizedTransition {
    this.assertCurrentTransaction();
    const normalized = this.normalizeRetryInput(input);
    try {
      const active = this.selectActiveRequest(normalized.documentVersionId);
      if (active) {
        this.options.afterSelect?.();
        if (active.id !== normalized.requestId) {
          throw new KnowledgeEnrichmentRequestStateError(
            KnowledgeBaseErrorCodes.EnrichmentAlreadyActive,
          );
        }
        if (!matchesRoute(active, normalized)) {
          throw new KnowledgeEnrichmentRequestStateError(
            KnowledgeBaseErrorCodes.EnrichmentRequestStale,
          );
        }
        return { request: active, queuedTransition: false };
      }

      const target = this.getRequest(normalized.requestId);
      const latest = this.selectLatestRequest(
        normalized.workspaceId,
        normalized.documentVersionId,
      );
      this.options.afterSelect?.();
      if (!target) {
        throw new KnowledgeEnrichmentRequestStateError(
          KnowledgeBaseErrorCodes.EnrichmentRequestNotFound,
        );
      }
      if (!matchesRoute(target, normalized) || latest?.id !== target.id) {
        throw new KnowledgeEnrichmentRequestStateError(
          KnowledgeBaseErrorCodes.EnrichmentRequestStale,
        );
      }
      if (target.status !== KnowledgeEnrichmentStatuses.Failed) {
        throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.JobStateConflict);
      }

      const updated = this.db.prepare(`
        UPDATE knowledge_enrichment_requests
        SET
          status = ?,
          revision = revision + 1,
          progress = 0,
          active_attempt_id = NULL,
          error_code = NULL,
          error_message = NULL,
          valid_candidate_count = 0,
          discarded_candidate_count = 0,
          partial_reasons_json = '[]',
          started_at = NULL,
          heartbeat_at = NULL,
          completed_at = NULL,
          updated_at = ?
        WHERE id = ? AND revision = ? AND status = ?
      `).run(
        KnowledgeEnrichmentStatuses.Queued,
        normalized.now,
        target.id,
        target.revision,
        KnowledgeEnrichmentStatuses.Failed,
      );
      if (updated.changes === 0) {
        return {
          request: this.resolveRetryRace(normalized),
          queuedTransition: false,
        };
      }
      return {
        request: this.requireRequest(target.id),
        queuedTransition: true,
      };
    } catch (error) {
      if (isSqliteConstraintError(error)) {
        try {
          return {
            request: this.resolveRetryRace(normalized),
            queuedTransition: false,
          };
        } catch (resolutionError) {
          this.rethrowSafeWriteError(resolutionError);
        }
      }
      this.rethrowSafeWriteError(error);
    }
  }

  recoverAbandonedRunning(now = this.clock()): number {
    const normalizedNow = this.normalizeNow(now);
    const errorCode = KnowledgeBaseErrorCodes.AuthorizationRequired;
    const errorMessage = safeFailureMessages[errorCode];
    const transaction = this.db.transaction(() => {
      const rows = this.db.prepare(`
        SELECT
          request.id,
          request.active_attempt_id,
          attempt.id AS attempt_id,
          attempt.request_id AS attempt_request_id,
          attempt.outcome AS attempt_outcome,
          (
            SELECT COUNT(*)
            FROM knowledge_enrichment_attempts AS running_attempt
            WHERE
              running_attempt.request_id = request.id
              AND running_attempt.outcome = '${KnowledgeEnrichmentAttemptOutcomes.Running}'
          ) AS running_attempt_count
        FROM knowledge_enrichment_requests AS request
        LEFT JOIN knowledge_enrichment_attempts AS attempt
          ON attempt.id = request.active_attempt_id
        WHERE request.status = '${KnowledgeEnrichmentStatuses.Running}'
        ORDER BY request.id ASC
      `).all() as Array<{
        id: unknown;
        active_attempt_id: unknown;
        attempt_id: unknown;
        attempt_request_id: unknown;
        attempt_outcome: unknown;
        running_attempt_count: unknown;
      }>;
      let recoveredCount = 0;
      for (const row of rows) {
        const requestId = requireNonEmptyString(row.id);
        const attemptId = requireNonEmptyString(row.active_attempt_id);
        if (
          row.attempt_id !== attemptId ||
          row.attempt_request_id !== requestId ||
          row.attempt_outcome !== KnowledgeEnrichmentAttemptOutcomes.Running ||
          requireInteger(row.running_attempt_count, 0) !== 1
        ) {
          return throwCorruptState();
        }
        const attemptUpdated = this.db.prepare(`
          UPDATE knowledge_enrichment_attempts AS attempt
          SET
            outcome = ?,
            finished_at = ?,
            error_code = ?,
            error_message = ?
          WHERE
            attempt.id = ?
            AND attempt.request_id = ?
            AND attempt.outcome = ?
            AND EXISTS (
              SELECT 1
              FROM knowledge_enrichment_requests AS request
              WHERE
                request.id = attempt.request_id
                AND request.status = ?
                AND request.active_attempt_id = attempt.id
            )
        `).run(
          KnowledgeEnrichmentAttemptOutcomes.Abandoned,
          normalizedNow,
          errorCode,
          errorMessage,
          attemptId,
          requestId,
          KnowledgeEnrichmentAttemptOutcomes.Running,
          KnowledgeEnrichmentStatuses.Running,
        );
        if (attemptUpdated.changes === 0) {
          throw new KnowledgeEnrichmentRequestStateError(
            KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
          );
        }
        const requestUpdated = this.db.prepare(`
          UPDATE knowledge_enrichment_requests AS request
          SET
            status = ?,
            active_attempt_id = NULL,
            error_code = ?,
            error_message = ?,
            heartbeat_at = NULL,
            completed_at = ?,
            updated_at = ?
          WHERE
            request.id = ?
            AND request.status = ?
            AND request.active_attempt_id = ?
            AND EXISTS (
              SELECT 1
              FROM knowledge_enrichment_attempts AS attempt
              WHERE
                attempt.id = ?
                AND attempt.request_id = request.id
                AND attempt.outcome = ?
                AND attempt.finished_at = ?
            )
        `).run(
          KnowledgeEnrichmentStatuses.Failed,
          errorCode,
          errorMessage,
          normalizedNow,
          normalizedNow,
          requestId,
          KnowledgeEnrichmentStatuses.Running,
          attemptId,
          attemptId,
          KnowledgeEnrichmentAttemptOutcomes.Abandoned,
          normalizedNow,
        );
        if (requestUpdated.changes === 0) {
          throw new KnowledgeEnrichmentRequestStateError(
            KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
          );
        }
        recoveredCount += 1;
      }
      return recoveredCount;
    });
    try {
      return this.runWriteTransaction(transaction);
    } catch (error) {
      this.rethrowSafeWriteError(error);
    }
  }

  markVersionStale(documentVersionId: string, now = this.clock()): number {
    const normalizedVersionId = this.normalizeIdentifier(documentVersionId);
    const normalizedNow = this.normalizeNow(now);
    const transaction = this.db.transaction(() =>
      this.markVersionStaleInCurrentTransaction(normalizedVersionId, normalizedNow));
    try {
      return this.runWriteTransaction(transaction);
    } catch (error) {
      this.rethrowSafeWriteError(error);
    }
  }

  markWorkspaceStale(workspaceId: string, now = this.clock()): number {
    const normalizedWorkspaceId = this.normalizeIdentifier(workspaceId);
    const normalizedNow = this.normalizeNow(now);
    const transaction = this.db.transaction(() =>
      this.markWorkspaceStaleInCurrentTransaction(normalizedWorkspaceId, normalizedNow));
    try {
      return this.runWriteTransaction(transaction);
    } catch (error) {
      this.rethrowSafeWriteError(error);
    }
  }

  markVersionStaleInCurrentTransaction(documentVersionId: string, now: string): number {
    this.assertCurrentTransaction();
    const normalizedVersionId = this.normalizeIdentifier(documentVersionId);
    const normalizedNow = this.normalizeNow(now);
    const rows = this.db.prepare(`
      SELECT id, revision, status, active_attempt_id
      FROM knowledge_enrichment_requests
      WHERE
        document_version_id = ?
        AND status IN (${ACTIVE_REQUEST_STATUS_SQL})
      ORDER BY id ASC
    `).all(normalizedVersionId) as ActiveTransitionRow[];
    const completedRows = this.db.prepare(`
      SELECT id, revision, status, active_attempt_id
      FROM knowledge_enrichment_requests
      WHERE document_version_id = ? AND status = ?
      ORDER BY id ASC
    `).all(
      normalizedVersionId,
      KnowledgeEnrichmentStatuses.Completed,
    ) as ActiveTransitionRow[];
    return this.transitionActiveRowsToStale([...rows, ...completedRows], normalizedNow);
  }

  markWorkspaceStaleInCurrentTransaction(workspaceId: string, now: string): number {
    this.assertCurrentTransaction();
    const normalizedWorkspaceId = this.normalizeIdentifier(workspaceId);
    const normalizedNow = this.normalizeNow(now);
    const rows = this.db.prepare(`
      SELECT id, revision, status, active_attempt_id
      FROM knowledge_enrichment_requests
      WHERE workspace_id = ? AND status IN (?, ?, ?)
      ORDER BY id ASC
    `).all(
      normalizedWorkspaceId,
      ...activeStatuses,
    ) as ActiveTransitionRow[];
    return this.transitionActiveRowsToStale(rows, normalizedNow);
  }

  deleteWorkspaceRequestsInCurrentTransaction(workspaceId: string): number {
    this.assertCurrentTransaction();
    const normalizedWorkspaceId = this.normalizeIdentifier(workspaceId);
    const deletedAttemptCount = this.db.prepare(`
      DELETE FROM knowledge_enrichment_attempts
      WHERE request_id IN (
        SELECT id FROM knowledge_enrichment_requests WHERE workspace_id = ?
      )
    `).run(normalizedWorkspaceId).changes;
    const deletedRequestCount = this.db.prepare(`
      DELETE FROM knowledge_enrichment_requests WHERE workspace_id = ?
    `).run(normalizedWorkspaceId).changes;
    return deletedAttemptCount + deletedRequestCount;
  }

  deleteParentlessEnrichmentInCurrentTransaction(): number {
    this.assertCurrentTransaction();
    const deletedAttempts = this.db.prepare(`
      DELETE FROM knowledge_enrichment_attempts
      WHERE NOT EXISTS (
        SELECT 1 FROM knowledge_enrichment_requests AS request
        WHERE request.id = knowledge_enrichment_attempts.request_id
      )
    `).run().changes;
    return deletedAttempts;
  }

  /** Task 11 coordinator owns cross-store deletion ordering. */
  deleteWorkspaceRequests(workspaceId: string): void {
    const normalizedWorkspaceId = this.normalizeIdentifier(workspaceId);
    const transaction = this.db.transaction(() =>
      this.deleteWorkspaceRequestsInCurrentTransaction(normalizedWorkspaceId));
    try {
      this.runWriteTransaction(transaction);
    } catch (error) {
      this.rethrowSafeWriteError(error);
    }
  }

  listAttempts(requestId: string): KnowledgeEnrichmentAttempt[] {
    const normalizedRequestId = this.normalizeIdentifier(requestId);
    const rows = this.db.prepare(`
      SELECT ${ATTEMPT_SELECT_COLUMNS}
      FROM knowledge_enrichment_attempts
      WHERE request_id = ?
      ORDER BY attempt_number ASC
    `).all(normalizedRequestId) as KnowledgeEnrichmentAttemptRow[];
    return rows.map(mapAttemptRow);
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_enrichment_requests (
        id TEXT PRIMARY KEY CHECK (TRIM(id) <> ''),
        workspace_id TEXT NOT NULL CHECK (TRIM(workspace_id) <> ''),
        document_id TEXT NOT NULL CHECK (TRIM(document_id) <> ''),
        document_version_id TEXT NOT NULL CHECK (TRIM(document_version_id) <> ''),
        status TEXT NOT NULL CHECK (
          status IN (
            '${KnowledgeEnrichmentStatuses.Queued}',
            '${KnowledgeEnrichmentStatuses.Running}',
            '${KnowledgeEnrichmentStatuses.ReviewRequired}',
            '${KnowledgeEnrichmentStatuses.Completed}',
            '${KnowledgeEnrichmentStatuses.Failed}',
            '${KnowledgeEnrichmentStatuses.Cancelled}',
            '${KnowledgeEnrichmentStatuses.Stale}'
          )
        ),
        consent_mode TEXT NOT NULL DEFAULT '${KNOWLEDGE_ENRICHMENT_CONSENT_MODE}'
          CHECK (consent_mode = '${KNOWLEDGE_ENRICHMENT_CONSENT_MODE}'),
        provider_id TEXT NOT NULL CHECK (TRIM(provider_id) <> ''),
        model_id TEXT NOT NULL CHECK (TRIM(model_id) <> ''),
        routing_fingerprint TEXT NOT NULL CHECK (
          LENGTH(routing_fingerprint) = 64
          AND routing_fingerprint NOT GLOB '*[^0-9a-f]*'
        ),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (
          TYPEOF(revision) = 'integer' AND revision >= 1
        ),
        progress INTEGER NOT NULL DEFAULT 0 CHECK (
          TYPEOF(progress) = 'integer' AND progress BETWEEN 0 AND 100
        ),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (
          TYPEOF(attempt_count) = 'integer' AND attempt_count >= 0
        ),
        active_attempt_id TEXT,
        error_code TEXT,
        error_message TEXT CHECK (
          error_message IS NULL OR LENGTH(error_message) <= 240
        ),
        valid_candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (
          TYPEOF(valid_candidate_count) = 'integer'
          AND valid_candidate_count >= 0
        ),
        discarded_candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (
          TYPEOF(discarded_candidate_count) = 'integer'
          AND discarded_candidate_count >= 0
        ),
        partial_reasons_json TEXT NOT NULL DEFAULT '[]' CHECK (
          JSON_VALID(partial_reasons_json)
          AND JSON_TYPE(partial_reasons_json) = 'array'
        ),
        requested_at TEXT NOT NULL,
        started_at TEXT,
        heartbeat_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        CHECK (active_attempt_id IS NULL OR TRIM(active_attempt_id) <> ''),
        CHECK (
          (status = '${KnowledgeEnrichmentStatuses.Running}' AND active_attempt_id IS NOT NULL)
          OR (status <> '${KnowledgeEnrichmentStatuses.Running}' AND active_attempt_id IS NULL)
        )
      );

      CREATE TABLE IF NOT EXISTS knowledge_enrichment_attempts (
        id TEXT PRIMARY KEY CHECK (TRIM(id) <> ''),
        request_id TEXT NOT NULL CHECK (TRIM(request_id) <> ''),
        attempt_number INTEGER NOT NULL CHECK (
          TYPEOF(attempt_number) = 'integer' AND attempt_number >= 1
        ),
        started_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        finished_at TEXT,
        outcome TEXT NOT NULL CHECK (
          outcome IN (
            '${KnowledgeEnrichmentAttemptOutcomes.Running}',
            '${KnowledgeEnrichmentAttemptOutcomes.Completed}',
            '${KnowledgeEnrichmentAttemptOutcomes.Failed}',
            '${KnowledgeEnrichmentAttemptOutcomes.Cancelled}',
            '${KnowledgeEnrichmentAttemptOutcomes.Abandoned}'
          )
        ),
        error_code TEXT,
        error_message TEXT CHECK (
          error_message IS NULL OR LENGTH(error_message) <= 240
        ),
        UNIQUE(request_id, attempt_number),
        FOREIGN KEY(request_id) REFERENCES knowledge_enrichment_requests(id),
        CHECK (
          (outcome = '${KnowledgeEnrichmentAttemptOutcomes.Running}' AND finished_at IS NULL)
          OR (outcome <> '${KnowledgeEnrichmentAttemptOutcomes.Running}' AND finished_at IS NOT NULL)
        )
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_enrichment_one_active_version
      ON knowledge_enrichment_requests(document_version_id)
      WHERE status IN (${ACTIVE_REQUEST_STATUS_SQL});

      CREATE INDEX IF NOT EXISTS idx_knowledge_enrichment_queue
      ON knowledge_enrichment_requests(status, updated_at, id);

      CREATE INDEX IF NOT EXISTS idx_knowledge_enrichment_workspace_latest
      ON knowledge_enrichment_requests(
        workspace_id, document_version_id, requested_at DESC, id DESC
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_enrichment_failed_route
      ON knowledge_enrichment_requests(
        workspace_id, document_version_id, status,
        provider_id, model_id, routing_fingerprint,
        requested_at DESC, id DESC
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_enrichment_attempts_request
      ON knowledge_enrichment_attempts(request_id, attempt_number);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_enrichment_one_running_attempt
      ON knowledge_enrichment_attempts(request_id)
      WHERE outcome = '${KnowledgeEnrichmentAttemptOutcomes.Running}';
    `);
  }

  private normalizeAuthorizedInput(
    input: CreateAuthorizedEnrichmentRequestInput,
  ): NormalizedAuthorizedInput {
    const record = this.requirePlainRecord(input);
    const normalized = {
      workspaceId: this.normalizeIdentifier(this.requireOwnString(record, 'workspaceId')),
      documentId: this.normalizeIdentifier(this.requireOwnString(record, 'documentId')),
      documentVersionId: this.normalizeIdentifier(
        this.requireOwnString(record, 'documentVersionId'),
      ),
      providerId: this.normalizeIdentifier(this.requireOwnString(record, 'providerId')),
      modelId: this.normalizeIdentifier(this.requireOwnString(record, 'modelId')),
      routingFingerprint: this.normalizeIdentifier(
        this.requireOwnString(record, 'routingFingerprint'),
      ),
      now: this.normalizeNow(this.readOptionalNow(record)),
    };
    if (
      !normalized.workspaceId ||
      !normalized.documentId ||
      !normalized.documentVersionId ||
      !normalized.providerId ||
      !normalized.modelId ||
      !/^[0-9a-f]{64}$/.test(normalized.routingFingerprint)
    ) {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    return normalized;
  }

  private normalizeRetryInput(
    input: RetryAuthorizedEnrichmentRequestInput,
  ): NormalizedAuthorizedInput & { requestId: string } {
    const record = this.requirePlainRecord(input);
    return {
      ...this.normalizeAuthorizedInput(input),
      requestId: this.normalizeIdentifier(this.requireOwnString(record, 'requestId')),
    };
  }

  private normalizeEmptyCompletion(input: EmptyCompletionCounts): NormalizedEmptyCompletion {
    const record = this.requirePlainRecord(input);
    const validCandidateCount = this.requireOwnValue(record, 'validCandidateCount');
    const discardedCandidateCount = this.requireOwnValue(record, 'discardedCandidateCount');
    const partialReasons = this.requireOwnValue(record, 'partialReasons');
    const normalizedReasons = this.normalizeOwnDataArray(partialReasons, reason => {
      if (typeof reason !== 'string') {
        throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
      }
      return reason;
    });
    const normalizedPartialReasons: KnowledgeEnrichmentPartialReason[] | null =
      normalizedReasons.length === 0
        ? []
        : normalizedReasons.length === 1 &&
            normalizedReasons[0] === KnowledgeEnrichmentPartialReasons.ChunkLimit
          ? [KnowledgeEnrichmentPartialReasons.ChunkLimit]
          : null;
    if (
      validCandidateCount !== 0 ||
      discardedCandidateCount !== 0 ||
      normalizedPartialReasons === null
    ) {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    return {
      validCandidateCount: 0,
      discardedCandidateCount: 0,
      partialReasons: normalizedPartialReasons,
      now: this.normalizeNow(this.readOptionalNow(record)),
    };
  }

  private normalizeSafeFailure(input: SafeFailure): NormalizedSafeFailure {
    const record = this.requirePlainRecord(input);
    const code = this.requireOwnString(record, 'code');
    if (!Object.prototype.hasOwnProperty.call(safeFailureMessages, code)) {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    return {
      code: code as KnowledgeEnrichmentSafeFailureCode,
      now: this.normalizeNow(this.readOptionalNow(record)),
    };
  }

  private requirePlainRecord(value: unknown): PlainRecord {
    if (typeof value !== 'object' || value === null) {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    let isProxy = false;
    try {
      isProxy = nodeUtilTypes.isProxy(value);
    } catch {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    if (isProxy) {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    let isArray = false;
    let prototype: object | null = null;
    try {
      isArray = Array.isArray(value);
      prototype = Object.getPrototypeOf(value);
    } catch {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    if (
      isArray || (prototype !== Object.prototype && prototype !== null)
    ) {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    return value as PlainRecord;
  }

  private normalizeOwnDataArray<T>(
    value: unknown,
    normalizeElement: (element: unknown, index: number) => T,
  ): T[] {
    try {
      if (
        nodeUtilTypes.isProxy(value) ||
        !Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Array.prototype
      ) {
        throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (
        !lengthDescriptor ||
        !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0
      ) {
        throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
      }
      const normalized: T[] = [];
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          !descriptor ||
          !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ) {
          throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
        }
        normalized.push(normalizeElement(descriptor.value, index));
      }
      return normalized;
    } catch (error) {
      if (error instanceof KnowledgeEnrichmentRequestStateError) {
        throw error;
      }
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
  }

  private readOwnDataProperty(
    record: PlainRecord,
    key: string,
  ): { exists: boolean; value: unknown } {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(record, key);
    } catch {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    if (!descriptor) {
      return { exists: false, value: undefined };
    }
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    return { exists: true, value: descriptor.value };
  }

  private requireOwnValue(record: PlainRecord, key: string): unknown {
    const property = this.readOwnDataProperty(record, key);
    if (!property.exists) {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    return property.value;
  }

  private requireOwnString(record: PlainRecord, key: string): string {
    const value = this.requireOwnValue(record, key);
    if (typeof value !== 'string') {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    return value;
  }

  private readOptionalNow(record: PlainRecord): unknown {
    const property = this.readOwnDataProperty(record, 'now');
    return !property.exists || property.value === undefined
      ? this.clock()
      : property.value;
  }

  private normalizeIdentifier(value: unknown): string {
    if (typeof value !== 'string') {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    const normalized = value.trim();
    if (!normalized) {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    return normalized;
  }

  private normalizeNow(value: unknown): string {
    if (typeof value !== 'string' || !isCanonicalTimestamp(value)) {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    return value;
  }

  private nextUuid(): string {
    const value = this.uuidFactory();
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new KnowledgeEnrichmentRequestStateError(
        KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
      );
    }
    return value.trim();
  }

  private selectActiveRequest(documentVersionId: string): KnowledgeEnrichmentRequest | null {
    const row = this.db.prepare(buildMappedRequestQuery(`
      SELECT ${requestBaseSelectColumns('request')}
      FROM knowledge_enrichment_requests AS request
      WHERE
        request.document_version_id = ?
        AND request.status IN (${ACTIVE_REQUEST_STATUS_SQL})
      ORDER BY request.requested_at DESC, request.id DESC
      LIMIT 1
    `)).get(documentVersionId) as KnowledgeEnrichmentRequestRow | undefined;
    return row ? mapRequestRow(row) : null;
  }

  private selectLatestRequest(
    workspaceId: string,
    documentVersionId: string,
  ): KnowledgeEnrichmentRequest | null {
    const row = this.db.prepare(buildMappedRequestQuery(`
      SELECT ${requestBaseSelectColumns('request')}
      FROM knowledge_enrichment_requests AS request
      WHERE request.workspace_id = ? AND request.document_version_id = ?
      ORDER BY request.requested_at DESC, request.id DESC
      LIMIT 1
    `)).get(workspaceId, documentVersionId) as KnowledgeEnrichmentRequestRow | undefined;
    return row ? mapRequestRow(row) : null;
  }

  private requireRequest(requestId: string): KnowledgeEnrichmentRequest {
    const request = this.getRequest(requestId);
    if (!request) {
      throw new KnowledgeEnrichmentRequestStateError(
        KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
      );
    }
    return request;
  }

  private requireAttempt(attemptId: string): KnowledgeEnrichmentAttempt {
    const row = this.db.prepare(`
      SELECT ${ATTEMPT_SELECT_COLUMNS}
      FROM knowledge_enrichment_attempts
      WHERE id = ?
      LIMIT 1
    `).get(attemptId) as KnowledgeEnrichmentAttemptRow | undefined;
    if (!row) {
      throw new KnowledgeEnrichmentRequestStateError(
        KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
      );
    }
    return mapAttemptRow(row);
  }

  private transitionActiveRowsToStale(
    rows: ActiveTransitionRow[],
    now: string,
  ): number {
    let transitionedCount = 0;
    for (const row of rows) {
      const requestId = requireNonEmptyString(row.id);
      const revision = requireInteger(row.revision, 1);
      const status = requireRequestStatus(row.status);
      const activeAttemptId = requireNullableNonEmptyString(row.active_attempt_id);
      if (
        (status === KnowledgeEnrichmentStatuses.Running && activeAttemptId === null) ||
        (status !== KnowledgeEnrichmentStatuses.Running && activeAttemptId !== null)
      ) {
        return throwCorruptState();
      }
      if (status === KnowledgeEnrichmentStatuses.Running) {
        const attemptUpdated = this.db.prepare(`
          UPDATE knowledge_enrichment_attempts AS attempt
          SET
            outcome = ?,
            finished_at = ?,
            error_code = ?,
            error_message = ?
          WHERE
            attempt.id = ?
            AND attempt.request_id = ?
            AND attempt.outcome = ?
            AND EXISTS (
              SELECT 1
              FROM knowledge_enrichment_requests AS request
              WHERE
                request.id = attempt.request_id
                AND request.revision = ?
                AND request.status = ?
                AND request.active_attempt_id = attempt.id
            )
        `).run(
          KnowledgeEnrichmentAttemptOutcomes.Cancelled,
          now,
          KnowledgeBaseErrorCodes.EnrichmentRequestStale,
          staleErrorMessage,
          activeAttemptId,
          requestId,
          KnowledgeEnrichmentAttemptOutcomes.Running,
          revision,
          KnowledgeEnrichmentStatuses.Running,
        );
        if (attemptUpdated.changes === 0) {
          throw new KnowledgeEnrichmentRequestStateError(
            KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
          );
        }
      }

      const requestUpdated = this.db.prepare(`
        UPDATE knowledge_enrichment_requests
        SET
          status = ?,
          revision = revision + 1,
          active_attempt_id = NULL,
          error_code = ?,
          error_message = ?,
          heartbeat_at = NULL,
          completed_at = ?,
          updated_at = ?
        WHERE
          id = ?
          AND revision = ?
          AND status = ?
          AND (
            (? IS NULL AND active_attempt_id IS NULL)
            OR active_attempt_id = ?
          )
      `).run(
        KnowledgeEnrichmentStatuses.Stale,
        KnowledgeBaseErrorCodes.EnrichmentRequestStale,
        staleErrorMessage,
        now,
        now,
        requestId,
        revision,
        status,
        activeAttemptId,
        activeAttemptId,
      );
      if (requestUpdated.changes === 0) {
        throw new KnowledgeEnrichmentRequestStateError(
          KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
        );
      }
      transitionedCount += 1;
    }
    return transitionedCount;
  }

  private resolveCancelConflict(
    requestId: string,
    expectedRevision: number,
  ): KnowledgeEnrichmentRequest {
    const current = this.getRequest(requestId);
    if (!current) {
      throw new KnowledgeEnrichmentRequestStateError(
        KnowledgeBaseErrorCodes.EnrichmentRequestNotFound,
      );
    }
    if (current.revision !== expectedRevision) {
      const latestSummary = this.getSummary(current.id);
      if (!latestSummary) {
        throw new KnowledgeEnrichmentRequestStateError(
          KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
        );
      }
      throw new KnowledgeEnrichmentRevisionConflictError(latestSummary);
    }
    if (
      current.status !== KnowledgeEnrichmentStatuses.Queued &&
      current.status !== KnowledgeEnrichmentStatuses.Running
    ) {
      throw new KnowledgeEnrichmentRequestStateError(KnowledgeBaseErrorCodes.JobStateConflict);
    }
    throw new KnowledgeEnrichmentRequestStateError(
      KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
    );
  }

  private resolveRetryRace(
    input: NormalizedAuthorizedInput & { requestId: string },
  ): KnowledgeEnrichmentRequest {
    const active = this.selectActiveRequest(input.documentVersionId);
    if (!active) {
      throw new KnowledgeEnrichmentRequestStateError(
        KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
      );
    }
    if (active.id !== input.requestId) {
      throw new KnowledgeEnrichmentRequestStateError(
        KnowledgeBaseErrorCodes.EnrichmentAlreadyActive,
      );
    }
    if (!matchesRoute(active, input)) {
      throw new KnowledgeEnrichmentRequestStateError(
        KnowledgeBaseErrorCodes.EnrichmentRequestStale,
      );
    }
    return active;
  }

  private assertCurrentTransaction(): void {
    if (!this.db.inTransaction) {
      throw new KnowledgeEnrichmentRequestStateError(
        KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
      );
    }
  }

  private runWriteTransaction<T>(transaction: () => T): T {
    try {
      if (this.db.inTransaction) {
        return transaction();
      }
      return runTransientSqliteWriteTransaction(transaction);
    } catch (error) {
      if (isTransientSqliteBusyError(error)) {
        const code = (error as { code: KnowledgeEnrichmentTransientSqliteCode }).code;
        throw new KnowledgeEnrichmentTransientSqliteError(code);
      }
      throw error;
    }
  }

  private rethrowSafeWriteError(error: unknown): never {
    if (
      error instanceof KnowledgeEnrichmentRequestStateError ||
      error instanceof KnowledgeEnrichmentRevisionConflictError ||
      error instanceof KnowledgeEnrichmentTransientSqliteError
    ) {
      throw error;
    }
    if (isTransientSqliteBusyError(error)) {
      const code = (error as { code: KnowledgeEnrichmentTransientSqliteCode }).code;
      throw new KnowledgeEnrichmentTransientSqliteError(code);
    }
    if (isSqliteError(error)) {
      throw new KnowledgeEnrichmentRequestStateError(
        KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
      );
    }
    throw new KnowledgeEnrichmentRequestStateError(
      KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
    );
  }
}
