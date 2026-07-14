import Database from 'better-sqlite3';

import {
  KnowledgeBaseErrorCode,
  type KnowledgeBaseErrorCode as KnowledgeBaseErrorCodeValue,
  KnowledgeFactDomain,
  KnowledgeFactEvidenceState,
  KnowledgeFactListView,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
} from '../../shared/knowledgeBase/constants';
import { normalizeEnterpriseKnowledgeValue } from '../../shared/knowledgeBase/enterpriseLeadProfileKnowledge';
import {
  isTransientSqliteBusyError,
  runTransientSqliteWriteTransaction,
} from '../libs/sqliteTransactionRetry';
import type {
  KnowledgeEnrichmentClaim,
  KnowledgeEvidenceStaleResult,
  KnowledgeFact,
  KnowledgeFactCleanupResult,
  KnowledgeFactEvidence,
} from './knowledgeEnrichmentTypes';

type FactRow = {
  id: unknown;
  originating_request_id: unknown;
  workspace_id: unknown;
  domain: unknown;
  value: unknown;
  normalized_value: unknown;
  review_status: unknown;
  source_kind: unknown;
  revision: unknown;
  conflict_group_key: unknown;
  projection_state: unknown;
  created_at: unknown;
  reviewed_at: unknown;
  updated_at: unknown;
  tombstoned_at: unknown;
};

type EvidenceRow = {
  id: unknown;
  workspace_id: unknown;
  fact_id: unknown;
  request_id: unknown;
  document_id: unknown;
  document_version_id: unknown;
  chunk_id: unknown;
  quote: unknown;
  confidence: unknown;
  extractor_provider_id: unknown;
  extractor_model_id: unknown;
  created_at: unknown;
  stale_at: unknown;
};

type EvidenceOwnershipRow = EvidenceRow & {
  owner_fact_id: unknown;
  fact_originating_request_id: unknown;
  fact_workspace_id: unknown;
  fact_domain: unknown;
  fact_value: unknown;
  fact_normalized_value: unknown;
  fact_review_status: unknown;
  fact_source_kind: unknown;
  fact_revision: unknown;
  fact_conflict_group_key: unknown;
  fact_projection_state: unknown;
  fact_created_at: unknown;
  fact_reviewed_at: unknown;
  fact_updated_at: unknown;
  fact_tombstoned_at: unknown;
  request_workspace_id: unknown;
  request_document_id: unknown;
  request_document_version_id: unknown;
  request_provider_id: unknown;
  request_model_id: unknown;
  document_workspace_id: unknown;
  document_display_name: unknown;
  version_document_id: unknown;
  membership_present: unknown;
};

type EvidencePreviewRow = EvidenceOwnershipRow & {
  query_fact_id: unknown;
  active_evidence_count: unknown;
  stale_evidence_count: unknown;
  invalid_evidence_count: unknown;
};

type EvidenceDetailRow = EvidenceOwnershipRow;

type MetricsRow = {
  active_pending_count: unknown;
  active_confirmed_count: unknown;
  stale_confirmed_count: unknown;
  rejected_history_count: unknown;
  archived_history_count: unknown;
  unduplicated_legacy_confirmed_count: unknown;
  corrupt_evidence_count: unknown;
};

type ReviewFactRow = FactRow & {
  has_active_current_evidence: unknown;
};

interface RequestStorePrimitives {
  getDatabaseForInternalUse(): Database.Database;
  getRunningLeaseInCurrentTransaction(
    requestId: string,
    attemptId: string,
  ): KnowledgeEnrichmentClaim | null;
  completeReviewRequiredRequestsInCurrentTransaction(
    requestIds: readonly string[],
    now: string,
  ): number;
}

export interface KnowledgeFactStoreOptions {
  requestStore: RequestStorePrimitives;
  clock?: () => string;
}

export interface KnowledgePublicationFactIdentity {
  domain: KnowledgeFact['domain'];
  normalizedValue: string;
}

export interface InsertKnowledgePublicationFactInput {
  id: string;
  originatingRequestId: string;
  workspaceId: string;
  domain: KnowledgeFact['domain'];
  value: string;
  normalizedValue: string;
  now: string;
}

export type InsertKnowledgePublicationEvidenceInput = Omit<
  KnowledgeFactEvidence,
  'staleAt'
>;

export interface KnowledgeFactQueryCursor {
  updatedAt: string;
  id: string;
}

export interface KnowledgeFactPageQueryInput {
  workspaceId: string;
  view: KnowledgeFactListView;
  reviewStatuses: readonly KnowledgeFactReviewStatus[];
  evidenceState: KnowledgeFactEvidenceState;
  cursor: KnowledgeFactQueryCursor | null;
  limit: number;
}

export interface KnowledgeFactEvidenceQueryRecord {
  evidence: KnowledgeFactEvidence;
  documentDisplayName: string;
}

export interface KnowledgeFactEvidencePageQueryCursor {
  stale: boolean;
  confidence: number;
  createdAt: string;
  id: string;
}

export interface KnowledgeFactEvidencePageQueryInput {
  factId: string;
  expectedRevision: number;
  cursor: KnowledgeFactEvidencePageQueryCursor | null;
  limit: number;
}

export interface KnowledgeFactEvidencePageQueryResult<Result> {
  factId: string;
  factRevision: number;
  items: Result[];
  hasMore: boolean;
}

export interface KnowledgeFactEvidencePreviewQueryRecord {
  factId: string;
  activeEvidenceCount: number;
  staleEvidenceCount: number;
  preview: KnowledgeFactEvidenceQueryRecord | null;
}

export interface KnowledgeFactMetricsQueryRecord {
  activePendingCount: number;
  activeConfirmedCount: number;
  staleConfirmedCount: number;
  rejectedHistoryCount: number;
  archivedHistoryCount: number;
  unduplicatedLegacyConfirmedCount: number;
}

export interface GetReviewFactInput {
  factId: string;
  expectedRevision: number;
  requireActiveCurrentEvidence: boolean;
}

export interface ConfirmKnowledgeFactInCurrentTransactionInput {
  factId: string;
  expectedRevision: number;
  conflictGroupKey: string;
  now: string;
}

export interface RejectKnowledgeFactInCurrentTransactionInput {
  factId: string;
  expectedRevision: number;
  now: string;
}

export interface ArchiveKnowledgeFactInCurrentTransactionInput {
  factId: string;
  expectedRevision: number;
  projectionState: KnowledgeFact['projectionState'];
  now: string;
}

const FACT_SELECT_COLUMNS = `
  id,
  originating_request_id,
  workspace_id,
  domain,
  value,
  normalized_value,
  review_status,
  source_kind,
  revision,
  conflict_group_key,
  projection_state,
  created_at,
  reviewed_at,
  updated_at,
  tombstoned_at
`;

const EVIDENCE_OWNERSHIP_SELECT_COLUMNS = `
  evidence.id,
  evidence.workspace_id,
  evidence.fact_id,
  evidence.request_id,
  evidence.document_id,
  evidence.document_version_id,
  evidence.chunk_id,
  evidence.quote,
  evidence.confidence,
  evidence.extractor_provider_id,
  evidence.extractor_model_id,
  evidence.created_at,
  evidence.stale_at,
  fact.id AS owner_fact_id,
  fact.originating_request_id AS fact_originating_request_id,
  fact.workspace_id AS fact_workspace_id,
  fact.domain AS fact_domain,
  fact.value AS fact_value,
  fact.normalized_value AS fact_normalized_value,
  fact.review_status AS fact_review_status,
  fact.source_kind AS fact_source_kind,
  fact.revision AS fact_revision,
  fact.conflict_group_key AS fact_conflict_group_key,
  fact.projection_state AS fact_projection_state,
  fact.created_at AS fact_created_at,
  fact.reviewed_at AS fact_reviewed_at,
  fact.updated_at AS fact_updated_at,
  fact.tombstoned_at AS fact_tombstoned_at,
  request.workspace_id AS request_workspace_id,
  request.document_id AS request_document_id,
  request.document_version_id AS request_document_version_id,
  request.provider_id AS request_provider_id,
  request.model_id AS request_model_id,
  document.workspace_id AS document_workspace_id,
  document.display_name AS document_display_name,
  version.document_id AS version_document_id,
  EXISTS (
    SELECT 1
    FROM knowledge_enrichment_request_facts AS evidence_membership
    WHERE evidence_membership.request_id = evidence.request_id
      AND evidence_membership.fact_id = evidence.fact_id
  ) AS membership_present
`;

const KnowledgeFactSqlFunction = {
  NormalizeValue: 'knowledge_normalize_value_v1',
} as const;

export const REVIEWABLE_PENDING_SQL = `
  fact.review_status = '${KnowledgeFactReviewStatus.Pending}'
  AND fact.tombstoned_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM knowledge_fact_evidence AS reviewable_evidence
    WHERE reviewable_evidence.fact_id = fact.id
      AND reviewable_evidence.stale_at IS NULL
  )
`;

const factDomainSet = new Set<string>(Object.values(KnowledgeFactDomain));
const factViewSet = new Set<string>(Object.values(KnowledgeFactListView));
const evidenceStateSet = new Set<string>(Object.values(KnowledgeFactEvidenceState));
const reviewStatusSet = new Set<string>(Object.values(KnowledgeFactReviewStatus));
const sourceKindSet = new Set<string>(Object.values(KnowledgeFactSourceKind));
const projectionStateSet = new Set<string>(Object.values(KnowledgeFactProjectionState));

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isNullableNonEmptyString = (value: unknown): value is string | null =>
  value === null || isNonEmptyString(value);

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

type KnowledgeFactErrorCode =
  | typeof KnowledgeBaseErrorCode.InvalidRequest
  | typeof KnowledgeBaseErrorCode.JobStateConflict
  | typeof KnowledgeBaseErrorCode.FactEvidenceStale
  | typeof KnowledgeBaseErrorCode.FactRevisionConflict;

const factErrorCodeSet = new Set<string>([
  KnowledgeBaseErrorCode.InvalidRequest,
  KnowledgeBaseErrorCode.JobStateConflict,
  KnowledgeBaseErrorCode.FactEvidenceStale,
  KnowledgeBaseErrorCode.FactRevisionConflict,
]);

const factMessage = (code: KnowledgeFactErrorCode): string => {
  if (code === KnowledgeBaseErrorCode.InvalidRequest) {
    return 'Knowledge fact request is invalid';
  }
  if (code === KnowledgeBaseErrorCode.FactEvidenceStale) {
    return 'Knowledge fact evidence is stale';
  }
  if (code === KnowledgeBaseErrorCode.FactRevisionConflict) {
    return 'Knowledge fact revision conflict';
  }
  return 'Knowledge fact state is invalid';
};

export class KnowledgeFactStateError extends Error {
  readonly code: KnowledgeFactErrorCode;

  constructor(inputCode: KnowledgeBaseErrorCodeValue) {
    const code = factErrorCodeSet.has(inputCode)
      ? inputCode as KnowledgeFactErrorCode
      : KnowledgeBaseErrorCode.JobStateConflict;
    super(factMessage(code));
    this.name = 'KnowledgeFactStateError';
    this.code = code;
    delete this.stack;
  }

  toJSON(): { code: KnowledgeFactErrorCode; message: string } {
    return { code: this.code, message: this.message };
  }
}

const invalidState = (): KnowledgeFactStateError =>
  new KnowledgeFactStateError(KnowledgeBaseErrorCode.JobStateConflict);

const invalidRequest = (): KnowledgeFactStateError =>
  new KnowledgeFactStateError(KnowledgeBaseErrorCode.InvalidRequest);

const factEvidenceStale = (): KnowledgeFactStateError =>
  new KnowledgeFactStateError(KnowledgeBaseErrorCode.FactEvidenceStale);

const factRevisionConflict = (): KnowledgeFactStateError =>
  new KnowledgeFactStateError(KnowledgeBaseErrorCode.FactRevisionConflict);

const mapFact = (row: FactRow): KnowledgeFact => {
  if (
    !isNonEmptyString(row.id) ||
    !isNullableNonEmptyString(row.originating_request_id) ||
    !isNonEmptyString(row.workspace_id) ||
    typeof row.domain !== 'string' || !factDomainSet.has(row.domain) ||
    !isNonEmptyString(row.value) || row.value.length > 2_000 ||
    !isNonEmptyString(row.normalized_value) ||
    normalizeEnterpriseKnowledgeValue(row.value).normalizedValue !== row.normalized_value ||
    typeof row.review_status !== 'string' || !reviewStatusSet.has(row.review_status) ||
    typeof row.source_kind !== 'string' || !sourceKindSet.has(row.source_kind) ||
    !isSafePositiveInteger(row.revision) ||
    !isNullableNonEmptyString(row.conflict_group_key) ||
    typeof row.projection_state !== 'string' || !projectionStateSet.has(row.projection_state) ||
    !isCanonicalTimestamp(row.created_at) ||
    !isNullableCanonicalTimestamp(row.reviewed_at) ||
    !isCanonicalTimestamp(row.updated_at) ||
    !isNullableCanonicalTimestamp(row.tombstoned_at) ||
    (row.source_kind === KnowledgeFactSourceKind.Extracted && row.originating_request_id === null)
  ) {
    throw invalidState();
  }
  return {
    id: row.id,
    originatingRequestId: row.originating_request_id,
    workspaceId: row.workspace_id,
    domain: row.domain as KnowledgeFact['domain'],
    value: row.value,
    normalizedValue: row.normalized_value,
    reviewStatus: row.review_status as KnowledgeFact['reviewStatus'],
    sourceKind: row.source_kind as KnowledgeFact['sourceKind'],
    revision: row.revision,
    conflictGroupKey: row.conflict_group_key,
    projectionState: row.projection_state as KnowledgeFact['projectionState'],
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    updatedAt: row.updated_at,
    tombstonedAt: row.tombstoned_at,
  };
};

const mapEvidence = (row: EvidenceRow): KnowledgeFactEvidence => {
  if (
    typeof row.id !== 'string' || !/^[0-9a-f]{64}$/.test(row.id) ||
    !isNonEmptyString(row.workspace_id) ||
    !isNonEmptyString(row.fact_id) ||
    !isNonEmptyString(row.request_id) ||
    !isNonEmptyString(row.document_id) ||
    !isNonEmptyString(row.document_version_id) ||
    !isNonEmptyString(row.chunk_id) ||
    !isNonEmptyString(row.quote) || row.quote.length > 1_000 ||
    typeof row.confidence !== 'number' || !Number.isFinite(row.confidence) ||
    row.confidence < 0 || row.confidence > 1 ||
    !isNonEmptyString(row.extractor_provider_id) ||
    !isNonEmptyString(row.extractor_model_id) ||
    !isCanonicalTimestamp(row.created_at) ||
    !isNullableCanonicalTimestamp(row.stale_at)
  ) {
    throw invalidState();
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    factId: row.fact_id,
    requestId: row.request_id,
    documentId: row.document_id,
    documentVersionId: row.document_version_id,
    chunkId: row.chunk_id,
    quote: row.quote,
    confidence: row.confidence,
    extractorProviderId: row.extractor_provider_id,
    extractorModelId: row.extractor_model_id,
    createdAt: row.created_at,
    staleAt: row.stale_at,
  };
};

const requireSafeCount = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalidState();
  }
  return value;
};

const mapEvidenceOwnerFact = (row: EvidenceOwnershipRow): KnowledgeFact =>
  mapFact({
    id: row.owner_fact_id,
    originating_request_id: row.fact_originating_request_id,
    workspace_id: row.fact_workspace_id,
    domain: row.fact_domain,
    value: row.fact_value,
    normalized_value: row.fact_normalized_value,
    review_status: row.fact_review_status,
    source_kind: row.fact_source_kind,
    revision: row.fact_revision,
    conflict_group_key: row.fact_conflict_group_key,
    projection_state: row.fact_projection_state,
    created_at: row.fact_created_at,
    reviewed_at: row.fact_reviewed_at,
    updated_at: row.fact_updated_at,
    tombstoned_at: row.fact_tombstoned_at,
  });

const hasValidEvidenceOwnership = (
  row: EvidenceOwnershipRow,
  fact: KnowledgeFact,
): boolean =>
  isNonEmptyString(row.request_workspace_id) &&
  isNonEmptyString(row.request_document_id) &&
  isNonEmptyString(row.request_document_version_id) &&
  isNonEmptyString(row.request_provider_id) &&
  isNonEmptyString(row.request_model_id) &&
  isNonEmptyString(row.document_workspace_id) &&
  isNonEmptyString(row.document_display_name) &&
  isNonEmptyString(row.version_document_id) &&
  row.membership_present === 1 &&
  row.fact_id === fact.id &&
  row.workspace_id === fact.workspaceId &&
  row.request_workspace_id === fact.workspaceId &&
  row.request_document_id === row.document_id &&
  row.request_document_version_id === row.document_version_id &&
  row.request_provider_id === row.extractor_provider_id &&
  row.request_model_id === row.extractor_model_id &&
  row.document_workspace_id === fact.workspaceId &&
  row.version_document_id === row.document_id;

const mapEvidenceQueryRecord = (
  row: EvidenceOwnershipRow,
): KnowledgeFactEvidenceQueryRecord => {
  const fact = mapEvidenceOwnerFact(row);
  if (!hasValidEvidenceOwnership(row, fact)) {
    throw invalidState();
  }
  const evidence = mapEvidence(row);
  return {
    evidence,
    documentDisplayName: row.document_display_name as string,
  };
};

const normalizeNow = (value: string | undefined, clock: () => string): string => {
  const now = value === undefined ? clock() : value;
  if (!isCanonicalTimestamp(now)) {
    throw invalidRequest();
  }
  return now;
};

const normalizeId = (value: unknown): string => {
  if (!isNonEmptyString(value)) {
    throw invalidRequest();
  }
  return value;
};

export class KnowledgeFactStore {
  private readonly clock: () => string;

  constructor(
    private readonly db: Database.Database,
    private readonly options: KnowledgeFactStoreOptions,
  ) {
    this.clock = options.clock ?? (() => new Date().toISOString());
    try {
      if (options.requestStore.getDatabaseForInternalUse() !== db) {
        throw invalidState();
      }
      this.registerQueryFunctions();
      this.initialize();
    } catch {
      throw invalidState();
    }
  }

  getDatabaseForInternalUse(): Database.Database {
    return this.db;
  }

  mapFactRowForInternalUse(row: FactRow): KnowledgeFact {
    return mapFact(row);
  }

  mapEvidenceRowForInternalUse(row: EvidenceRow): KnowledgeFactEvidence {
    return mapEvidence(row);
  }

  findPublicationFactsInCurrentTransaction(
    workspaceId: string,
    identities: readonly KnowledgePublicationFactIdentity[],
  ): KnowledgeFact[] {
    this.assertCurrentTransaction();
    const normalizedWorkspaceId = normalizeId(workspaceId);
    try {
      const normalizedIdentities = identities.map(identity => {
        if (
          typeof identity !== 'object' ||
          identity === null ||
          typeof identity.domain !== 'string' ||
          !factDomainSet.has(identity.domain) ||
          !isNonEmptyString(identity.normalizedValue)
        ) {
          throw invalidState();
        }
        return {
          domain: identity.domain,
          normalizedValue: identity.normalizedValue,
        };
      });
      if (normalizedIdentities.length === 0) {
        return [];
      }
      return (this.db.prepare(`
        WITH candidate_identity AS (
          SELECT
            JSON_EXTRACT(value, '$.domain') AS domain,
            JSON_EXTRACT(value, '$.normalizedValue') AS normalized_value
          FROM JSON_EACH(?)
        )
        SELECT fact.*
        FROM knowledge_facts AS fact
        JOIN candidate_identity AS candidate
          ON candidate.domain = fact.domain
          AND candidate.normalized_value = fact.normalized_value
        WHERE
          fact.workspace_id = ?
          AND fact.tombstoned_at IS NULL
          AND fact.review_status IN (?, ?)
        ORDER BY fact.domain, fact.normalized_value, fact.id
      `).all(
        JSON.stringify(normalizedIdentities),
        normalizedWorkspaceId,
        KnowledgeFactReviewStatus.Pending,
        KnowledgeFactReviewStatus.Confirmed,
      ) as FactRow[]).map(mapFact);
    } catch (error) {
      this.rethrow(error);
    }
  }

  findPublicationEvidenceInCurrentTransaction(
    evidenceIds: readonly string[],
  ): KnowledgeFactEvidence[] {
    this.assertCurrentTransaction();
    try {
      const ids = [...new Set(evidenceIds.map(normalizeId))].sort();
      if (ids.length === 0) {
        return [];
      }
      return (this.db.prepare(`
        SELECT ${EVIDENCE_OWNERSHIP_SELECT_COLUMNS}
        FROM knowledge_fact_evidence AS evidence
        LEFT JOIN knowledge_facts AS fact ON fact.id = evidence.fact_id
        LEFT JOIN knowledge_enrichment_requests AS request ON request.id = evidence.request_id
        LEFT JOIN knowledge_documents AS document ON document.id = evidence.document_id
        LEFT JOIN knowledge_document_versions AS version
          ON version.id = evidence.document_version_id
        WHERE evidence.id IN (SELECT value FROM JSON_EACH(?))
        ORDER BY evidence.id
      `).all(JSON.stringify(ids)) as EvidenceOwnershipRow[])
        .map(mapEvidenceQueryRecord)
        .map(record => record.evidence);
    } catch (error) {
      this.rethrow(error);
    }
  }

  insertPublicationFactInCurrentTransaction(
    input: InsertKnowledgePublicationFactInput,
  ): void {
    this.assertCurrentTransaction();
    try {
      const fact = mapFact({
        id: input.id,
        originating_request_id: input.originatingRequestId,
        workspace_id: input.workspaceId,
        domain: input.domain,
        value: input.value,
        normalized_value: input.normalizedValue,
        review_status: KnowledgeFactReviewStatus.Pending,
        source_kind: KnowledgeFactSourceKind.Extracted,
        revision: 1,
        conflict_group_key: null,
        projection_state: KnowledgeFactProjectionState.None,
        created_at: input.now,
        reviewed_at: null,
        updated_at: input.now,
        tombstoned_at: null,
      });
      this.db.prepare(`
        INSERT INTO knowledge_facts (
          id, originating_request_id, workspace_id, domain, value, normalized_value,
          review_status, source_kind, revision, conflict_group_key, projection_state,
          created_at, reviewed_at, updated_at, tombstoned_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, NULL, ?, NULL)
      `).run(
        fact.id,
        fact.originatingRequestId,
        fact.workspaceId,
        fact.domain,
        fact.value,
        fact.normalizedValue,
        fact.reviewStatus,
        fact.sourceKind,
        fact.projectionState,
        fact.createdAt,
        fact.updatedAt,
      );
    } catch (error) {
      this.rethrow(error);
    }
  }

  insertPublicationEvidenceInCurrentTransaction(
    input: InsertKnowledgePublicationEvidenceInput,
  ): void {
    this.assertCurrentTransaction();
    try {
      const evidence = mapEvidence({
        id: input.id,
        workspace_id: input.workspaceId,
        fact_id: input.factId,
        request_id: input.requestId,
        document_id: input.documentId,
        document_version_id: input.documentVersionId,
        chunk_id: input.chunkId,
        quote: input.quote,
        confidence: input.confidence,
        extractor_provider_id: input.extractorProviderId,
        extractor_model_id: input.extractorModelId,
        created_at: input.createdAt,
        stale_at: null,
      });
      const changed = this.db.prepare(`
        WITH candidate(
          id, workspace_id, fact_id, request_id, document_id, document_version_id,
          chunk_id, quote, confidence, extractor_provider_id, extractor_model_id,
          created_at
        ) AS (
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        )
        INSERT INTO knowledge_fact_evidence (
          id, workspace_id, fact_id, request_id, document_id, document_version_id,
          chunk_id, quote, confidence, extractor_provider_id, extractor_model_id,
          created_at, stale_at
        )
        SELECT
          candidate.id,
          candidate.workspace_id,
          candidate.fact_id,
          candidate.request_id,
          candidate.document_id,
          candidate.document_version_id,
          candidate.chunk_id,
          candidate.quote,
          candidate.confidence,
          candidate.extractor_provider_id,
          candidate.extractor_model_id,
          candidate.created_at,
          NULL
        FROM candidate
        JOIN knowledge_facts AS fact ON fact.id = candidate.fact_id
        JOIN knowledge_enrichment_requests AS request ON request.id = candidate.request_id
        JOIN knowledge_documents AS document ON document.id = candidate.document_id
        JOIN knowledge_document_versions AS version
          ON version.id = candidate.document_version_id
        WHERE
          fact.workspace_id = candidate.workspace_id
          AND request.workspace_id = candidate.workspace_id
          AND request.document_id = candidate.document_id
          AND request.document_version_id = candidate.document_version_id
          AND request.provider_id = candidate.extractor_provider_id
          AND request.model_id = candidate.extractor_model_id
          AND document.workspace_id = candidate.workspace_id
          AND version.document_id = candidate.document_id
      `).run(
        evidence.id,
        evidence.workspaceId,
        evidence.factId,
        evidence.requestId,
        evidence.documentId,
        evidence.documentVersionId,
        evidence.chunkId,
        evidence.quote,
        evidence.confidence,
        evidence.extractorProviderId,
        evidence.extractorModelId,
        evidence.createdAt,
      ).changes;
      if (changed !== 1) {
        throw invalidState();
      }
    } catch (error) {
      this.rethrow(error);
    }
  }

  revisePublicationFactsInCurrentTransaction(
    factIds: readonly string[],
    now: string,
  ): number {
    this.assertCurrentTransaction();
    const normalizedNow = normalizeNow(now, this.clock);
    try {
      const ids = [...new Set(factIds.map(normalizeId))].sort();
      if (ids.length === 0) {
        return 0;
      }
      const changed = this.db.prepare(`
        UPDATE knowledge_facts
        SET revision = revision + 1, updated_at = ?
        WHERE id IN (SELECT value FROM JSON_EACH(?))
      `).run(normalizedNow, JSON.stringify(ids)).changes;
      if (changed !== ids.length) {
        throw invalidState();
      }
      return changed;
    } catch (error) {
      this.rethrow(error);
    }
  }

  insertPublicationMembershipsInCurrentTransaction(
    requestId: string,
    factIds: readonly string[],
  ): number {
    this.assertCurrentTransaction();
    const normalizedRequestId = normalizeId(requestId);
    try {
      const ids = [...new Set(factIds.map(normalizeId))].sort();
      if (ids.length === 0) {
        return 0;
      }
      return this.db.prepare(`
        INSERT OR IGNORE INTO knowledge_enrichment_request_facts (request_id, fact_id)
        SELECT ?, value
        FROM JSON_EACH(?)
      `).run(normalizedRequestId, JSON.stringify(ids)).changes;
    } catch (error) {
      this.rethrow(error);
    }
  }

  hasReviewablePublicationFactsInCurrentTransaction(requestId: string): boolean {
    this.assertCurrentTransaction();
    const normalizedRequestId = normalizeId(requestId);
    try {
      const row = this.db.prepare(`
        SELECT EXISTS (
          SELECT 1
          FROM knowledge_enrichment_request_facts AS membership
          JOIN knowledge_facts AS fact ON fact.id = membership.fact_id
          WHERE
            membership.request_id = ?
            AND (${REVIEWABLE_PENDING_SQL})
        ) AS reviewable
      `).get(normalizedRequestId) as { reviewable: unknown };
      if (row.reviewable !== 0 && row.reviewable !== 1) {
        throw invalidState();
      }
      return row.reviewable === 1;
    } catch (error) {
      this.rethrow(error);
    }
  }

  getWorkspaceProfileForQuery(workspaceId: string): unknown {
    const id = normalizeId(workspaceId);
    try {
      const row = this.db.prepare(`
        SELECT profile
        FROM enterprise_lead_workspaces
        WHERE id = ?
        LIMIT 1
      `).get(id) as { profile: unknown } | undefined;
      return row?.profile;
    } catch (error) {
      this.rethrowAtPublicBoundary(error);
    }
  }

  listFactPageForQuery(input: KnowledgeFactPageQueryInput): KnowledgeFact[] {
    try {
      if (
        !isNonEmptyString(input.workspaceId) ||
        !factViewSet.has(input.view) ||
        !evidenceStateSet.has(input.evidenceState) ||
        !Array.isArray(input.reviewStatuses) ||
        input.reviewStatuses.some(status => !reviewStatusSet.has(status)) ||
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 100 ||
        (
          input.cursor !== null &&
          (
            !isNonEmptyString(input.cursor.id) ||
            !isCanonicalTimestamp(input.cursor.updatedAt)
          )
        )
      ) {
        throw invalidState();
      }
      const activePredicate = `
        fact.tombstoned_at IS NULL
        AND (
          fact.review_status = '${KnowledgeFactReviewStatus.Confirmed}'
          OR (${REVIEWABLE_PENDING_SQL})
        )
      `;
      const where: string[] = ['fact.workspace_id = ?'];
      const params: unknown[] = [input.workspaceId];
      where.push(input.view === KnowledgeFactListView.Active
        ? `(${activePredicate})`
        : `NOT (${activePredicate})`);
      if (input.reviewStatuses.length > 0) {
        where.push(`fact.review_status IN (${input.reviewStatuses.map(() => '?').join(', ')})`);
        params.push(...input.reviewStatuses);
      }
      if (input.evidenceState === KnowledgeFactEvidenceState.Active) {
        where.push(`EXISTS (
          SELECT 1
          FROM knowledge_fact_evidence AS state_evidence
          WHERE state_evidence.fact_id = fact.id
            AND state_evidence.stale_at IS NULL
        )`);
      } else if (input.evidenceState === KnowledgeFactEvidenceState.Stale) {
        where.push(`EXISTS (
          SELECT 1
          FROM knowledge_fact_evidence AS state_evidence
          WHERE state_evidence.fact_id = fact.id
            AND state_evidence.stale_at IS NOT NULL
        )`);
      }
      if (input.cursor) {
        where.push('(fact.updated_at < ? OR (fact.updated_at = ? AND fact.id < ?))');
        params.push(input.cursor.updatedAt, input.cursor.updatedAt, input.cursor.id);
      }
      params.push(input.limit + 1);
      return (this.db.prepare(`
        SELECT ${FACT_SELECT_COLUMNS}
        FROM knowledge_facts AS fact
        WHERE ${where.join('\n AND ')}
        ORDER BY fact.updated_at DESC, fact.id DESC
        LIMIT ?
      `).all(...params) as FactRow[]).map(mapFact);
    } catch (error) {
      this.rethrowAtPublicBoundary(error);
    }
  }

  listFactEvidencePreviewsForQuery(
    factIds: readonly string[],
  ): KnowledgeFactEvidencePreviewQueryRecord[] {
    try {
      if (
        !Array.isArray(factIds) ||
        factIds.length > 100 ||
        factIds.some(factId => !isNonEmptyString(factId)) ||
        new Set(factIds).size !== factIds.length
      ) {
        throw invalidState();
      }
      const rows = this.db.prepare(`
        WITH query_fact(fact_id) AS (
          SELECT value
          FROM JSON_EACH(?)
        ),
        evidence_rollup AS (
          SELECT
            query_fact.fact_id AS query_fact_id,
            (
              SELECT COUNT(*)
              FROM knowledge_fact_evidence AS active_evidence
              WHERE active_evidence.fact_id = query_fact.fact_id
                AND active_evidence.stale_at IS NULL
            ) AS active_evidence_count,
            (
              SELECT COUNT(*)
              FROM knowledge_fact_evidence AS stale_evidence
              WHERE stale_evidence.fact_id = query_fact.fact_id
                AND stale_evidence.stale_at IS NOT NULL
            ) AS stale_evidence_count,
            (
              SELECT candidate.id
              FROM knowledge_fact_evidence AS candidate
              WHERE
                candidate.fact_id = query_fact.fact_id
                AND NOT EXISTS (
                  SELECT 1
                  FROM knowledge_fact_evidence AS better
                  WHERE
                    better.fact_id = candidate.fact_id
                    AND (
                      (
                        better.stale_at IS NULL
                        AND candidate.stale_at IS NOT NULL
                      )
                      OR (
                        (
                          (better.stale_at IS NULL AND candidate.stale_at IS NULL)
                          OR (
                            better.stale_at IS NOT NULL
                            AND candidate.stale_at IS NOT NULL
                          )
                        )
                        AND (
                          better.confidence > candidate.confidence
                          OR (
                            better.confidence = candidate.confidence
                            AND better.created_at < candidate.created_at
                          )
                          OR (
                            better.confidence = candidate.confidence
                            AND better.created_at = candidate.created_at
                            AND better.id < candidate.id
                          )
                        )
                      )
                    )
                )
              LIMIT 1
            ) AS preview_evidence_id,
            (
              SELECT COUNT(*)
              FROM knowledge_fact_evidence AS integrity_evidence
              LEFT JOIN knowledge_facts AS integrity_fact
                ON integrity_fact.id = integrity_evidence.fact_id
              LEFT JOIN knowledge_enrichment_requests AS integrity_request
                ON integrity_request.id = integrity_evidence.request_id
              LEFT JOIN knowledge_documents AS integrity_document
                ON integrity_document.id = integrity_evidence.document_id
              LEFT JOIN knowledge_document_versions AS integrity_version
                ON integrity_version.id = integrity_evidence.document_version_id
              WHERE
                integrity_evidence.fact_id = query_fact.fact_id
                AND (
                  integrity_fact.id IS NULL
                  OR integrity_request.id IS NULL
                  OR integrity_document.id IS NULL
                  OR integrity_version.id IS NULL
                  OR integrity_evidence.workspace_id <> integrity_fact.workspace_id
                  OR integrity_request.workspace_id <> integrity_fact.workspace_id
                  OR integrity_request.document_id <> integrity_evidence.document_id
                  OR integrity_request.document_version_id <>
                    integrity_evidence.document_version_id
                  OR integrity_request.provider_id <>
                    integrity_evidence.extractor_provider_id
                  OR integrity_request.model_id <> integrity_evidence.extractor_model_id
                  OR integrity_document.workspace_id <> integrity_fact.workspace_id
                  OR integrity_version.document_id <> integrity_evidence.document_id
                  OR NOT EXISTS (
                    SELECT 1
                    FROM knowledge_enrichment_request_facts AS integrity_membership
                    WHERE integrity_membership.request_id = integrity_evidence.request_id
                      AND integrity_membership.fact_id = integrity_evidence.fact_id
                  )
                )
            ) AS invalid_evidence_count
          FROM query_fact
        )
        SELECT
          evidence_rollup.query_fact_id,
          evidence_rollup.active_evidence_count,
          evidence_rollup.stale_evidence_count,
          evidence_rollup.invalid_evidence_count,
          ${EVIDENCE_OWNERSHIP_SELECT_COLUMNS}
        FROM evidence_rollup
        LEFT JOIN knowledge_fact_evidence AS evidence
          ON evidence.id = evidence_rollup.preview_evidence_id
          AND evidence_rollup.invalid_evidence_count = 0
        LEFT JOIN knowledge_facts AS fact ON fact.id = evidence.fact_id
        LEFT JOIN knowledge_enrichment_requests AS request ON request.id = evidence.request_id
        LEFT JOIN knowledge_documents AS document ON document.id = evidence.document_id
        LEFT JOIN knowledge_document_versions AS version
          ON version.id = evidence.document_version_id
      `).all(JSON.stringify(factIds)) as EvidencePreviewRow[];
      if (rows.length !== factIds.length) {
        throw invalidState();
      }
      const seenFactIds = new Set<string>();
      return rows.map(row => {
        if (!isNonEmptyString(row.query_fact_id) || seenFactIds.has(row.query_fact_id)) {
          throw invalidState();
        }
        seenFactIds.add(row.query_fact_id);
        const activeEvidenceCount = requireSafeCount(row.active_evidence_count);
        const staleEvidenceCount = requireSafeCount(row.stale_evidence_count);
        if (requireSafeCount(row.invalid_evidence_count) !== 0) {
          throw invalidState();
        }
        if (row.id === null) {
          if (activeEvidenceCount !== 0 || staleEvidenceCount !== 0) {
            throw invalidState();
          }
          return {
            factId: row.query_fact_id,
            activeEvidenceCount,
            staleEvidenceCount,
            preview: null,
          };
        }
        const preview = mapEvidenceQueryRecord(row);
        if (
          preview.evidence.factId !== row.query_fact_id ||
          activeEvidenceCount + staleEvidenceCount < 1
        ) {
          throw invalidState();
        }
        return {
          factId: row.query_fact_id,
          activeEvidenceCount,
          staleEvidenceCount,
          preview,
        };
      });
    } catch (error) {
      this.rethrowAtPublicBoundary(error);
    }
  }

  listFactEvidenceForQuery<Result>(
    input: KnowledgeFactEvidencePageQueryInput,
    project: (record: KnowledgeFactEvidenceQueryRecord) => Result,
  ): KnowledgeFactEvidencePageQueryResult<Result> {
    try {
      if (typeof input !== 'object' || input === null) {
        throw invalidState();
      }
      const factId = normalizeId(input.factId);
      if (
        !isSafePositiveInteger(input.expectedRevision) ||
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 100 ||
        typeof project !== 'function'
      ) {
        throw invalidState();
      }
      const cursor = input.cursor;
      if (
        cursor !== null &&
        (
          typeof cursor !== 'object' ||
          typeof cursor.stale !== 'boolean' ||
          typeof cursor.confidence !== 'number' ||
          !Number.isFinite(cursor.confidence) ||
          cursor.confidence < 0 ||
          cursor.confidence > 1 ||
          !isCanonicalTimestamp(cursor.createdAt) ||
          typeof cursor.id !== 'string' ||
          !/^[0-9a-f]{64}$/.test(cursor.id)
        )
      ) {
        throw invalidState();
      }
      const keysetSql = cursor === null
        ? ''
        : `
          AND (
            (evidence.stale_at IS NOT NULL) > @stale
            OR (
              (evidence.stale_at IS NOT NULL) = @stale
              AND (
                evidence.confidence < @confidence
                OR (
                  evidence.confidence = @confidence
                  AND (
                    evidence.created_at > @createdAt
                    OR (
                      evidence.created_at = @createdAt
                      AND evidence.id > @evidenceId
                    )
                  )
                )
              )
            )
          )
        `;
      const statement = this.db.prepare(`
        SELECT
          ${EVIDENCE_OWNERSHIP_SELECT_COLUMNS}
        FROM knowledge_facts AS fact
        LEFT JOIN knowledge_fact_evidence AS evidence
          INDEXED BY idx_knowledge_fact_evidence_fact_page
          ON evidence.fact_id = fact.id
          ${keysetSql}
        LEFT JOIN knowledge_enrichment_requests AS request ON request.id = evidence.request_id
        LEFT JOIN knowledge_documents AS document ON document.id = evidence.document_id
        LEFT JOIN knowledge_document_versions AS version
          ON version.id = evidence.document_version_id
        WHERE fact.id = @factId
          AND fact.revision = @expectedRevision
        ORDER BY
          (evidence.stale_at IS NOT NULL) ASC,
          evidence.confidence DESC,
          evidence.created_at ASC,
          evidence.id ASC
        LIMIT @rowLimit
      `);
      const query = {
        factId,
        expectedRevision: input.expectedRevision,
        stale: cursor?.stale === true ? 1 : 0,
        confidence: cursor?.confidence ?? 0,
        createdAt: cursor?.createdAt ?? '',
        evidenceId: cursor?.id ?? '',
        rowLimit: input.limit + 1,
      };
      const records: KnowledgeFactEvidenceQueryRecord[] = [];
      let ownerFact: KnowledgeFact | null = null;
      let sawEmptyEvidenceRow = false;
      for (const row of statement.iterate(query) as IterableIterator<EvidenceDetailRow>) {
        const fact = mapEvidenceOwnerFact(row);
        if (fact.id !== factId || fact.revision !== input.expectedRevision) {
          throw invalidState();
        }
        if (
          ownerFact !== null &&
          (fact.id !== ownerFact.id || fact.revision !== ownerFact.revision)
        ) {
          throw invalidState();
        }
        ownerFact = fact;
        if (row.fact_id === null) {
          if (records.length !== 0 || sawEmptyEvidenceRow) {
            throw invalidState();
          }
          sawEmptyEvidenceRow = true;
          continue;
        }
        if (sawEmptyEvidenceRow) {
          throw invalidState();
        }
        const record = mapEvidenceQueryRecord(row);
        if (record.evidence.factId !== factId) {
          throw invalidState();
        }
        records.push(record);
      }
      if (ownerFact === null || records.length > input.limit + 1) {
        throw invalidState();
      }
      const hasMore = records.length > input.limit;
      return {
        factId: ownerFact.id,
        factRevision: ownerFact.revision,
        items: records.slice(0, input.limit).map(project),
        hasMore,
      };
    } catch (error) {
      this.rethrowAtPublicBoundary(error);
    }
  }

  getFactMetricsForQuery(
    workspaceId: string,
    validProfileJson: string | null,
  ): KnowledgeFactMetricsQueryRecord {
    const id = normalizeId(workspaceId);
    try {
      if (validProfileJson !== null && typeof validProfileJson !== 'string') {
        throw invalidState();
      }
      const row = this.db.prepare(`
        WITH query_input(workspace_id, profile) AS (
          SELECT ?, JSON(?)
        ),
        legacy_value(domain, value) AS (
          SELECT
            '${KnowledgeFactDomain.CompanySummary}',
            JSON_EXTRACT(query_input.profile, '$.companySummary')
          FROM query_input
          WHERE query_input.profile IS NOT NULL

          UNION ALL
          SELECT '${KnowledgeFactDomain.ProductList}', item.value
          FROM query_input, JSON_EACH(query_input.profile, '$.productList') AS item

          UNION ALL
          SELECT '${KnowledgeFactDomain.ProductCapabilities}', item.value
          FROM query_input, JSON_EACH(query_input.profile, '$.productCapabilities') AS item

          UNION ALL
          SELECT '${KnowledgeFactDomain.TargetCustomers}', item.value
          FROM query_input, JSON_EACH(query_input.profile, '$.targetCustomers') AS item

          UNION ALL
          SELECT '${KnowledgeFactDomain.ApplicationScenarios}', item.value
          FROM query_input, JSON_EACH(query_input.profile, '$.applicationScenarios') AS item

          UNION ALL
          SELECT '${KnowledgeFactDomain.SellingPoints}', item.value
          FROM query_input, JSON_EACH(query_input.profile, '$.sellingPoints') AS item

          UNION ALL
          SELECT '${KnowledgeFactDomain.ChannelPreferences}', item.value
          FROM query_input, JSON_EACH(query_input.profile, '$.channelPreferences') AS item

          UNION ALL
          SELECT '${KnowledgeFactDomain.ProhibitedClaims}', item.value
          FROM query_input, JSON_EACH(query_input.profile, '$.prohibitedClaims') AS item

          UNION ALL
          SELECT '${KnowledgeFactDomain.ContactRules}', item.value
          FROM query_input, JSON_EACH(query_input.profile, '$.contactRules') AS item

          UNION ALL
          SELECT '${KnowledgeFactDomain.MissingInfo}', item.value
          FROM query_input, JSON_EACH(query_input.profile, '$.missingInfo') AS item
        ),
        normalized_legacy AS (
          SELECT
            domain,
            ${KnowledgeFactSqlFunction.NormalizeValue}(value) AS normalized_value
          FROM legacy_value
          WHERE TYPEOF(value) = 'text'
        ),
        legacy_identity AS (
          SELECT DISTINCT domain, normalized_value
          FROM normalized_legacy
          WHERE normalized_value IS NOT NULL AND normalized_value <> ''
        ),
        workspace_metrics AS (
          SELECT
            COALESCE(SUM(CASE WHEN
              ${REVIEWABLE_PENDING_SQL}
              THEN 1 ELSE 0 END), 0) AS active_pending_count,
            COALESCE(SUM(CASE WHEN
              fact.tombstoned_at IS NULL
              AND fact.review_status = '${KnowledgeFactReviewStatus.Confirmed}'
              AND NOT (
                NOT EXISTS (
                  SELECT 1
                  FROM knowledge_fact_evidence AS metric_active
                  WHERE metric_active.fact_id = fact.id
                    AND metric_active.stale_at IS NULL
                )
                AND EXISTS (
                  SELECT 1
                  FROM knowledge_fact_evidence AS metric_stale
                  WHERE metric_stale.fact_id = fact.id
                    AND metric_stale.stale_at IS NOT NULL
                )
              ) THEN 1 ELSE 0 END), 0) AS active_confirmed_count,
            COALESCE(SUM(CASE WHEN
              fact.tombstoned_at IS NULL
              AND fact.review_status = '${KnowledgeFactReviewStatus.Confirmed}'
              AND NOT EXISTS (
                SELECT 1
                FROM knowledge_fact_evidence AS metric_active
                WHERE metric_active.fact_id = fact.id
                  AND metric_active.stale_at IS NULL
              )
              AND EXISTS (
                SELECT 1
                FROM knowledge_fact_evidence AS metric_stale
                WHERE metric_stale.fact_id = fact.id
                  AND metric_stale.stale_at IS NOT NULL
              ) THEN 1 ELSE 0 END), 0) AS stale_confirmed_count,
            COALESCE(SUM(CASE WHEN
              fact.tombstoned_at IS NULL
              AND fact.review_status = '${KnowledgeFactReviewStatus.Rejected}'
              THEN 1 ELSE 0 END), 0) AS rejected_history_count,
            COALESCE(SUM(CASE WHEN fact.tombstoned_at IS NOT NULL THEN 1 ELSE 0 END), 0)
              AS archived_history_count
          FROM knowledge_facts AS fact
          WHERE fact.workspace_id = (SELECT workspace_id FROM query_input)
        ),
        legacy_metrics AS (
          SELECT COUNT(*) AS unduplicated_legacy_confirmed_count
          FROM legacy_identity AS legacy
          WHERE NOT EXISTS (
            SELECT 1
            FROM knowledge_facts AS confirmed
            WHERE confirmed.workspace_id = (SELECT workspace_id FROM query_input)
              AND confirmed.review_status = '${KnowledgeFactReviewStatus.Confirmed}'
              AND confirmed.tombstoned_at IS NULL
              AND confirmed.domain = legacy.domain
              AND confirmed.normalized_value = legacy.normalized_value
          )
        ),
        evidence_integrity AS (
          SELECT COUNT(*) AS corrupt_evidence_count
          FROM knowledge_fact_evidence AS integrity_evidence
          LEFT JOIN knowledge_facts AS integrity_fact
            ON integrity_fact.id = integrity_evidence.fact_id
          LEFT JOIN knowledge_enrichment_requests AS integrity_request
            ON integrity_request.id = integrity_evidence.request_id
          LEFT JOIN knowledge_documents AS integrity_document
            ON integrity_document.id = integrity_evidence.document_id
          LEFT JOIN knowledge_document_versions AS integrity_version
            ON integrity_version.id = integrity_evidence.document_version_id
          WHERE
            (
              integrity_evidence.workspace_id = (SELECT workspace_id FROM query_input)
              OR integrity_fact.workspace_id = (SELECT workspace_id FROM query_input)
            )
            AND (
              integrity_fact.id IS NULL
              OR integrity_request.id IS NULL
              OR integrity_document.id IS NULL
              OR integrity_version.id IS NULL
              OR integrity_evidence.workspace_id <> integrity_fact.workspace_id
              OR integrity_request.workspace_id <> integrity_fact.workspace_id
              OR integrity_request.document_id <> integrity_evidence.document_id
              OR integrity_request.document_version_id <>
                integrity_evidence.document_version_id
              OR integrity_request.provider_id <> integrity_evidence.extractor_provider_id
              OR integrity_request.model_id <> integrity_evidence.extractor_model_id
              OR integrity_document.workspace_id <> integrity_fact.workspace_id
              OR integrity_version.document_id <> integrity_evidence.document_id
              OR NOT EXISTS (
                SELECT 1
                FROM knowledge_enrichment_request_facts AS integrity_membership
                WHERE integrity_membership.request_id = integrity_evidence.request_id
                  AND integrity_membership.fact_id = integrity_evidence.fact_id
              )
            )
        )
        SELECT
          workspace_metrics.active_pending_count,
          workspace_metrics.active_confirmed_count,
          workspace_metrics.stale_confirmed_count,
          workspace_metrics.rejected_history_count,
          workspace_metrics.archived_history_count,
          legacy_metrics.unduplicated_legacy_confirmed_count,
          evidence_integrity.corrupt_evidence_count
        FROM workspace_metrics, legacy_metrics, evidence_integrity
      `).get(id, validProfileJson) as MetricsRow;
      if (
        requireSafeCount(row.corrupt_evidence_count) !== 0
      ) {
        throw invalidState();
      }
      return {
        activePendingCount: requireSafeCount(row.active_pending_count),
        activeConfirmedCount: requireSafeCount(row.active_confirmed_count),
        staleConfirmedCount: requireSafeCount(row.stale_confirmed_count),
        rejectedHistoryCount: requireSafeCount(row.rejected_history_count),
        archivedHistoryCount: requireSafeCount(row.archived_history_count),
        unduplicatedLegacyConfirmedCount: requireSafeCount(
          row.unduplicated_legacy_confirmed_count,
        ),
      };
    } catch (error) {
      this.rethrowAtPublicBoundary(error);
    }
  }

  getReviewFactInCurrentTransaction(input: GetReviewFactInput): KnowledgeFact {
    this.assertCurrentTransaction();
    try {
      if (
        !input || typeof input !== 'object' ||
        !isNonEmptyString(input.factId) ||
        !isSafePositiveInteger(input.expectedRevision) ||
        typeof input.requireActiveCurrentEvidence !== 'boolean'
      ) {
        throw invalidRequest();
      }
      const row = this.db.prepare(`
        SELECT
          ${FACT_SELECT_COLUMNS},
          EXISTS (
            SELECT 1
            FROM knowledge_fact_evidence AS evidence
            JOIN knowledge_enrichment_requests AS request
              ON request.id = evidence.request_id
            JOIN knowledge_enrichment_request_facts AS membership
              ON membership.request_id = evidence.request_id
              AND membership.fact_id = evidence.fact_id
            JOIN knowledge_documents AS document
              ON document.id = evidence.document_id
            JOIN knowledge_document_versions AS version
              ON version.id = evidence.document_version_id
            WHERE
              evidence.fact_id = knowledge_facts.id
              AND evidence.workspace_id = knowledge_facts.workspace_id
              AND evidence.stale_at IS NULL
              AND request.workspace_id = knowledge_facts.workspace_id
              AND request.document_id = evidence.document_id
              AND request.document_version_id = evidence.document_version_id
              AND request.provider_id = evidence.extractor_provider_id
              AND request.model_id = evidence.extractor_model_id
              AND document.workspace_id = knowledge_facts.workspace_id
              AND document.deleted_at IS NULL
              AND document.current_version_id = evidence.document_version_id
              AND version.document_id = document.id
            LIMIT 1
          ) AS has_active_current_evidence
        FROM knowledge_facts
        WHERE id = ? AND revision = ?
        LIMIT 1
      `).get(input.factId, input.expectedRevision) as ReviewFactRow | undefined;
      if (!row) {
        throw factRevisionConflict();
      }
      const fact = mapFact(row);
      if (
        fact.tombstonedAt !== null ||
        fact.reviewStatus !== KnowledgeFactReviewStatus.Pending
      ) {
        throw factRevisionConflict();
      }
      if (
        row.has_active_current_evidence !== 0 &&
        row.has_active_current_evidence !== 1
      ) {
        throw invalidState();
      }
      if (input.requireActiveCurrentEvidence && row.has_active_current_evidence !== 1) {
        throw factEvidenceStale();
      }
      return fact;
    } catch (error) {
      this.rethrow(error);
    }
  }

  confirmFactInCurrentTransaction(
    input: ConfirmKnowledgeFactInCurrentTransactionInput,
  ): KnowledgeFact {
    this.assertCurrentTransaction();
    try {
      if (
        !input || typeof input !== 'object' ||
        !isNonEmptyString(input.factId) ||
        !isSafePositiveInteger(input.expectedRevision) ||
        !isNonEmptyString(input.conflictGroupKey)
      ) {
        throw invalidRequest();
      }
      const now = normalizeNow(input.now, this.clock);
      const changed = this.db.prepare(`
        UPDATE knowledge_facts
        SET
          review_status = ?,
          revision = revision + 1,
          conflict_group_key = ?,
          projection_state = ?,
          reviewed_at = ?,
          updated_at = ?
        WHERE
          id = ?
          AND revision = ?
          AND review_status = ?
          AND tombstoned_at IS NULL
      `).run(
        KnowledgeFactReviewStatus.Confirmed,
        input.conflictGroupKey,
        KnowledgeFactProjectionState.Active,
        now,
        now,
        input.factId,
        input.expectedRevision,
        KnowledgeFactReviewStatus.Pending,
      ).changes;
      if (changed !== 1) {
        throw factRevisionConflict();
      }
      return this.requireFactInCurrentTransaction(input.factId);
    } catch (error) {
      this.rethrow(error);
    }
  }

  rejectFactInCurrentTransaction(
    input: RejectKnowledgeFactInCurrentTransactionInput,
  ): KnowledgeFact {
    this.assertCurrentTransaction();
    try {
      if (
        !input || typeof input !== 'object' ||
        !isNonEmptyString(input.factId) ||
        !isSafePositiveInteger(input.expectedRevision)
      ) {
        throw invalidRequest();
      }
      const now = normalizeNow(input.now, this.clock);
      const changed = this.db.prepare(`
        UPDATE knowledge_facts
        SET
          review_status = ?,
          revision = revision + 1,
          conflict_group_key = NULL,
          projection_state = ?,
          reviewed_at = ?,
          updated_at = ?
        WHERE
          id = ?
          AND revision = ?
          AND review_status = ?
          AND tombstoned_at IS NULL
      `).run(
        KnowledgeFactReviewStatus.Rejected,
        KnowledgeFactProjectionState.None,
        now,
        now,
        input.factId,
        input.expectedRevision,
        KnowledgeFactReviewStatus.Pending,
      ).changes;
      if (changed !== 1) {
        throw factRevisionConflict();
      }
      return this.requireFactInCurrentTransaction(input.factId);
    } catch (error) {
      this.rethrow(error);
    }
  }

  archiveFactInCurrentTransaction(
    input: ArchiveKnowledgeFactInCurrentTransactionInput,
  ): KnowledgeFact {
    this.assertCurrentTransaction();
    try {
      if (
        !input || typeof input !== 'object' ||
        !isNonEmptyString(input.factId) ||
        !isSafePositiveInteger(input.expectedRevision) ||
        !projectionStateSet.has(input.projectionState)
      ) {
        throw invalidRequest();
      }
      const now = normalizeNow(input.now, this.clock);
      const changed = this.db.prepare(`
        UPDATE knowledge_facts
        SET
          revision = revision + 1,
          projection_state = ?,
          updated_at = ?,
          tombstoned_at = ?
        WHERE id = ? AND revision = ? AND tombstoned_at IS NULL
      `).run(
        input.projectionState,
        now,
        now,
        input.factId,
        input.expectedRevision,
      ).changes;
      if (changed !== 1) {
        throw factRevisionConflict();
      }
      return this.requireFactInCurrentTransaction(input.factId);
    } catch (error) {
      this.rethrow(error);
    }
  }

  getFact(factId: string): KnowledgeFact | null {
    const id = normalizeId(factId);
    try {
      const row = this.db.prepare(`
        SELECT ${FACT_SELECT_COLUMNS}
        FROM knowledge_facts
        WHERE id = ?
        LIMIT 1
      `).get(id) as FactRow | undefined;
      return row ? mapFact(row) : null;
    } catch (error) {
      this.rethrowAtPublicBoundary(error);
    }
  }

  markVersionEvidenceStale(
    documentVersionId: string,
    now?: string,
  ): KnowledgeEvidenceStaleResult {
    const normalizedVersionId = normalizeId(documentVersionId);
    const normalizedNow = normalizeNow(now, this.clock);
    try {
      const transaction = this.db.transaction(() =>
        this.markVersionEvidenceStaleInCurrentTransaction(
          normalizedVersionId,
          normalizedNow,
        ));
      return runTransientSqliteWriteTransaction(transaction);
    } catch (error) {
      this.rethrowAtPublicBoundary(error);
    }
  }

  markVersionEvidenceStaleInCurrentTransaction(
    documentVersionId: string,
    now: string,
  ): KnowledgeEvidenceStaleResult {
    this.assertCurrentTransaction();
    const normalizedVersionId = normalizeId(documentVersionId);
    const normalizedNow = normalizeNow(now, this.clock);
    try {
      const aggregate = this.db.prepare(`
        SELECT COALESCE(JSON_GROUP_ARRAY(fact_id), '[]') AS fact_ids_json
        FROM (
          SELECT DISTINCT fact_id
          FROM knowledge_fact_evidence
          WHERE document_version_id = ? AND stale_at IS NULL
          ORDER BY fact_id
        )
      `).get(normalizedVersionId) as { fact_ids_json: string };
      const factIds = JSON.parse(aggregate.fact_ids_json) as string[];
      if (factIds.length === 0) {
        return { staleEvidenceCount: 0, revisedFactCount: 0, completedRequestCount: 0 };
      }
      const factIdsJson = JSON.stringify(factIds);
      const staleEvidenceCount = this.db.prepare(`
        UPDATE knowledge_fact_evidence
        SET stale_at = ?
        WHERE document_version_id = ? AND stale_at IS NULL
      `).run(normalizedNow, normalizedVersionId).changes;
      const revisedFactCount = this.db.prepare(`
        UPDATE knowledge_facts
        SET revision = revision + 1, updated_at = ?
        WHERE id IN (SELECT value FROM JSON_EACH(?))
      `).run(normalizedNow, factIdsJson).changes;
      if (revisedFactCount !== factIds.length) {
        throw invalidState();
      }
      const requestRows = this.db.prepare(`
        SELECT DISTINCT membership.request_id AS request_id
        FROM knowledge_enrichment_request_facts AS membership
        WHERE membership.fact_id IN (SELECT value FROM JSON_EACH(?))
        ORDER BY membership.request_id
      `).all(factIdsJson) as Array<{ request_id: string }>;
      const completedRequestCount = this.options.requestStore
        .completeReviewRequiredRequestsInCurrentTransaction(
          requestRows.map(row => row.request_id),
          normalizedNow,
        );
      return { staleEvidenceCount, revisedFactCount, completedRequestCount };
    } catch (error) {
      this.rethrow(error);
    }
  }

  recalculateLinkedRequests(factId: string, now?: string): number {
    const id = normalizeId(factId);
    const normalizedNow = normalizeNow(now, this.clock);
    try {
      const transaction = this.db.transaction(() =>
        this.recalculateLinkedRequestsInCurrentTransaction(id, normalizedNow));
      return runTransientSqliteWriteTransaction(transaction);
    } catch (error) {
      this.rethrowAtPublicBoundary(error);
    }
  }

  recalculateLinkedRequestsInCurrentTransaction(factId: string, now: string): number {
    this.assertCurrentTransaction();
    const id = normalizeId(factId);
    const normalizedNow = normalizeNow(now, this.clock);
    try {
      const requestRows = this.db.prepare(`
        SELECT request_id
        FROM knowledge_enrichment_request_facts
        WHERE fact_id = ?
        ORDER BY request_id
      `).all(id) as Array<{ request_id: string }>;
      return this.options.requestStore.completeReviewRequiredRequestsInCurrentTransaction(
        requestRows.map(row => row.request_id),
        normalizedNow,
      );
    } catch (error) {
      this.rethrow(error);
    }
  }

  deleteWorkspaceFactsInCurrentTransaction(workspaceId: string): KnowledgeFactCleanupResult {
    this.assertCurrentTransaction();
    const id = normalizeId(workspaceId);
    try {
      const deletedMembershipCount = this.db.prepare(`
        DELETE FROM knowledge_enrichment_request_facts
        WHERE EXISTS (
          SELECT 1 FROM knowledge_facts AS fact
          WHERE fact.id = knowledge_enrichment_request_facts.fact_id
            AND fact.workspace_id = ?
        ) OR EXISTS (
          SELECT 1 FROM knowledge_enrichment_requests AS request
          WHERE request.id = knowledge_enrichment_request_facts.request_id
            AND request.workspace_id = ?
        )
      `).run(id, id).changes;
      const deletedEvidenceCount = this.db.prepare(`
        DELETE FROM knowledge_fact_evidence
        WHERE workspace_id = ? OR EXISTS (
          SELECT 1 FROM knowledge_facts AS fact
          WHERE fact.id = knowledge_fact_evidence.fact_id
            AND fact.workspace_id = ?
        )
      `).run(id, id).changes;
      const deletedFactCount = this.db.prepare(`
        DELETE FROM knowledge_facts
        WHERE workspace_id = ?
      `).run(id).changes;
      return { deletedMembershipCount, deletedEvidenceCount, deletedFactCount };
    } catch (error) {
      this.rethrow(error);
    }
  }

  deleteParentlessFactChildrenInCurrentTransaction(): number {
    this.assertCurrentTransaction();
    try {
      let deletedCount = this.db.prepare(`
        DELETE FROM knowledge_enrichment_request_facts
        WHERE NOT EXISTS (
          SELECT 1 FROM knowledge_enrichment_requests AS request
          WHERE request.id = knowledge_enrichment_request_facts.request_id
        ) OR NOT EXISTS (
          SELECT 1 FROM knowledge_facts AS fact
          WHERE fact.id = knowledge_enrichment_request_facts.fact_id
        )
      `).run().changes;
      deletedCount += this.db.prepare(`
        DELETE FROM knowledge_fact_evidence
        WHERE NOT EXISTS (
          SELECT 1 FROM knowledge_facts AS fact
          WHERE fact.id = knowledge_fact_evidence.fact_id
        ) OR NOT EXISTS (
          SELECT 1 FROM knowledge_enrichment_requests AS request
          WHERE request.id = knowledge_fact_evidence.request_id
        ) OR NOT EXISTS (
          SELECT 1 FROM knowledge_documents AS document
          WHERE document.id = knowledge_fact_evidence.document_id
        ) OR NOT EXISTS (
          SELECT 1 FROM knowledge_document_versions AS version
          WHERE version.id = knowledge_fact_evidence.document_version_id
        )
      `).run().changes;
      return deletedCount;
    } catch (error) {
      this.rethrow(error);
    }
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_facts (
        id TEXT PRIMARY KEY CHECK (TRIM(id) <> ''),
        originating_request_id TEXT,
        workspace_id TEXT NOT NULL CHECK (TRIM(workspace_id) <> ''),
        domain TEXT NOT NULL CHECK (domain IN (
          'companySummary','productList','productCapabilities','targetCustomers',
          'applicationScenarios','sellingPoints','channelPreferences',
          'prohibitedClaims','contactRules','missingInfo'
        )),
        value TEXT NOT NULL CHECK (TRIM(value) <> '' AND LENGTH(value) <= 2000),
        normalized_value TEXT NOT NULL CHECK (TRIM(normalized_value) <> ''),
        review_status TEXT NOT NULL CHECK (review_status IN ('pending','confirmed','rejected')),
        source_kind TEXT NOT NULL CHECK (source_kind IN ('extracted','manual','imported')),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (
          TYPEOF(revision) = 'integer' AND revision >= 1
        ),
        conflict_group_key TEXT CHECK (
          conflict_group_key IS NULL OR TRIM(conflict_group_key) <> ''
        ),
        projection_state TEXT NOT NULL DEFAULT 'none' CHECK (
          projection_state IN ('none','active','conflict','reversed')
        ),
        created_at TEXT NOT NULL CHECK (TRIM(created_at) <> ''),
        reviewed_at TEXT,
        updated_at TEXT NOT NULL CHECK (TRIM(updated_at) <> ''),
        tombstoned_at TEXT,
        FOREIGN KEY(originating_request_id) REFERENCES knowledge_enrichment_requests(id),
        CHECK (source_kind <> 'extracted' OR originating_request_id IS NOT NULL)
      );

      CREATE TABLE IF NOT EXISTS knowledge_fact_evidence (
        id TEXT PRIMARY KEY CHECK (
          LENGTH(id) = 64 AND id NOT GLOB '*[^0-9a-f]*'
        ),
        workspace_id TEXT NOT NULL CHECK (TRIM(workspace_id) <> ''),
        fact_id TEXT NOT NULL CHECK (TRIM(fact_id) <> ''),
        request_id TEXT NOT NULL CHECK (TRIM(request_id) <> ''),
        document_id TEXT NOT NULL CHECK (TRIM(document_id) <> ''),
        document_version_id TEXT NOT NULL CHECK (TRIM(document_version_id) <> ''),
        chunk_id TEXT NOT NULL CHECK (TRIM(chunk_id) <> ''),
        quote TEXT NOT NULL CHECK (TRIM(quote) <> '' AND LENGTH(quote) <= 1000),
        confidence REAL NOT NULL CHECK (
          TYPEOF(confidence) IN ('integer','real') AND confidence BETWEEN 0 AND 1
        ),
        extractor_provider_id TEXT NOT NULL CHECK (TRIM(extractor_provider_id) <> ''),
        extractor_model_id TEXT NOT NULL CHECK (TRIM(extractor_model_id) <> ''),
        created_at TEXT NOT NULL CHECK (TRIM(created_at) <> ''),
        stale_at TEXT,
        FOREIGN KEY(fact_id) REFERENCES knowledge_facts(id),
        FOREIGN KEY(request_id) REFERENCES knowledge_enrichment_requests(id),
        FOREIGN KEY(document_id) REFERENCES knowledge_documents(id),
        FOREIGN KEY(document_version_id) REFERENCES knowledge_document_versions(id)
      );

      CREATE TABLE IF NOT EXISTS knowledge_enrichment_request_facts (
        request_id TEXT NOT NULL CHECK (TRIM(request_id) <> ''),
        fact_id TEXT NOT NULL CHECK (TRIM(fact_id) <> ''),
        PRIMARY KEY(request_id, fact_id),
        FOREIGN KEY(request_id) REFERENCES knowledge_enrichment_requests(id),
        FOREIGN KEY(fact_id) REFERENCES knowledge_facts(id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_facts_active_value
      ON knowledge_facts(workspace_id, domain, normalized_value)
      WHERE tombstoned_at IS NULL AND review_status IN ('pending', 'confirmed');

      CREATE INDEX IF NOT EXISTS idx_knowledge_facts_workspace_page
      ON knowledge_facts(workspace_id, updated_at DESC, id DESC);

      CREATE INDEX IF NOT EXISTS idx_knowledge_facts_workspace_metrics
      ON knowledge_facts(
        workspace_id, review_status, tombstoned_at, domain, normalized_value
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_fact_evidence_fact_state
      ON knowledge_fact_evidence(
        fact_id, stale_at, confidence DESC, created_at, id
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_fact_evidence_fact_page
      ON knowledge_fact_evidence(
        fact_id,
        (stale_at IS NOT NULL) ASC,
        confidence DESC,
        created_at ASC,
        id ASC
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_fact_evidence_version_state
      ON knowledge_fact_evidence(document_version_id, stale_at, fact_id);

      CREATE INDEX IF NOT EXISTS idx_knowledge_fact_evidence_workspace
      ON knowledge_fact_evidence(workspace_id, fact_id, id);

      CREATE INDEX IF NOT EXISTS idx_knowledge_fact_evidence_request
      ON knowledge_fact_evidence(request_id, fact_id, id);

      CREATE INDEX IF NOT EXISTS idx_knowledge_enrichment_request_facts_fact
      ON knowledge_enrichment_request_facts(fact_id, request_id);
    `);
  }

  private registerQueryFunctions(): void {
    this.db.function(
      KnowledgeFactSqlFunction.NormalizeValue,
      { deterministic: true },
      (value: unknown) => typeof value === 'string'
        ? normalizeEnterpriseKnowledgeValue(value).normalizedValue
        : null,
    );
  }

  private requireFactInCurrentTransaction(factId: string): KnowledgeFact {
    this.assertCurrentTransaction();
    const row = this.db.prepare(`
      SELECT ${FACT_SELECT_COLUMNS}
      FROM knowledge_facts
      WHERE id = ?
      LIMIT 1
    `).get(factId) as FactRow | undefined;
    if (!row) {
      throw invalidState();
    }
    return mapFact(row);
  }

  private assertCurrentTransaction(): void {
    if (!this.db.inTransaction) {
      throw invalidState();
    }
  }

  private rethrow(error: unknown): never {
    if (isTransientSqliteBusyError(error)) {
      throw error;
    }
    this.rethrowAtPublicBoundary(error);
  }

  private rethrowAtPublicBoundary(error: unknown): never {
    if (error instanceof KnowledgeFactStateError) {
      throw error;
    }
    throw invalidState();
  }
}
