import { createHash, randomUUID } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';

import Database from 'better-sqlite3';

import {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentIndexStatus,
  KnowledgeEnrichmentPartialReason,
  KnowledgeEnrichmentStatus,
  KnowledgeFactDomain,
} from '../../shared/knowledgeBase/constants';
import { normalizeEnterpriseKnowledgeValue } from '../../shared/knowledgeBase/enterpriseLeadProfileKnowledge';
import { runTransientSqliteWriteTransaction } from '../libs/sqliteTransactionRetry';
import { normalizeKnowledgeEvidenceQuote } from './knowledgeEnrichmentCandidateValidator';
import {
  KnowledgeEnrichmentModelResolutionError,
  KnowledgeEnrichmentModelResolver,
} from './knowledgeEnrichmentModelResolver';
import type { KnowledgeEnrichmentRequestStore } from './knowledgeEnrichmentRequestStore';
import type {
  KnowledgeEnrichmentPublicationCandidate,
  KnowledgeEnrichmentPublicationResult,
  KnowledgeEnrichmentRouteReference,
  KnowledgeEnrichmentSelectedEvidence,
  KnowledgeEnrichmentWorkspaceRouteSource,
  KnowledgeFactEvidence,
  PublishValidatedCandidatesInput,
} from './knowledgeEnrichmentTypes';
import type { KnowledgeFactStore } from './knowledgeFactStore';

export const KnowledgeEnrichmentPublicationStage = {
  AfterRevalidationBeforeFirstWrite: 'after_revalidation_before_first_write',
  AfterFacts: 'after_facts',
  AfterEvidence: 'after_evidence',
  AfterMembership: 'after_membership',
  AfterAttemptFinalized: 'after_attempt_finalized',
  AfterRequestFinalized: 'after_request_finalized',
} as const;
export type KnowledgeEnrichmentPublicationStage =
  (typeof KnowledgeEnrichmentPublicationStage)[keyof typeof KnowledgeEnrichmentPublicationStage];

type PublicationErrorCode =
  | typeof KnowledgeBaseErrorCode.EvidenceValidationFailed
  | typeof KnowledgeBaseErrorCode.EnrichmentRequestStale
  | typeof KnowledgeBaseErrorCode.ModelConfigurationUnavailable
  | typeof KnowledgeBaseErrorCode.ModelConfigurationChanged
  | typeof KnowledgeBaseErrorCode.UnsupportedModelProvider
  | typeof KnowledgeBaseErrorCode.EnrichmentPersistenceFailed;

const publicationErrorCodeSet = new Set<string>([
  KnowledgeBaseErrorCode.EvidenceValidationFailed,
  KnowledgeBaseErrorCode.EnrichmentRequestStale,
  KnowledgeBaseErrorCode.ModelConfigurationUnavailable,
  KnowledgeBaseErrorCode.ModelConfigurationChanged,
  KnowledgeBaseErrorCode.UnsupportedModelProvider,
  KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
]);

export interface KnowledgeEnrichmentPublicationStoreOptions {
  loadWorkspaceRouteSourceInCurrentTransaction: (
    db: Database.Database,
    workspaceId: string,
  ) => KnowledgeEnrichmentWorkspaceRouteSource | null;
  resolveExactRouteFromSource?: (
    source: KnowledgeEnrichmentWorkspaceRouteSource,
    requestRoute: KnowledgeEnrichmentRouteReference,
  ) => KnowledgeEnrichmentRouteReference;
  uuidFactory?: () => string;
  clock?: () => string;
  onStage?: (stage: KnowledgeEnrichmentPublicationStage) => void;
}

type PlainRecord = Record<string, unknown>;
type ValidatedSelection = {
  candidates: KnowledgeEnrichmentPublicationCandidate[];
  parsedCandidateCount: number;
  validCandidateCount: number;
  discardedCandidateCount: number;
  partialReasons: Array<
    (typeof KnowledgeEnrichmentPartialReason)[keyof typeof KnowledgeEnrichmentPartialReason]
  >;
};
type NormalizedPublicationInput = {
  requestId: string;
  attemptId: string;
  expectedPublishedGenerationId: string;
  expectedIndexedChunkCount: number;
  selection: ValidatedSelection;
  now: string;
};
type RevalidatedContext = {
  requestId: string;
  attemptId: string;
  workspaceId: string;
  documentId: string;
  documentVersionId: string;
  providerId: string;
  modelId: string;
  publishedGenerationId: string;
};
type PublicationAssignment = {
  candidate: KnowledgeEnrichmentPublicationCandidate;
  factId: string;
  existing: boolean;
};

const publicationErrorMessages: Record<PublicationErrorCode, string> = {
  [KnowledgeBaseErrorCode.EvidenceValidationFailed]: 'Knowledge evidence validation failed',
  [KnowledgeBaseErrorCode.EnrichmentRequestStale]: 'Knowledge enrichment request is stale',
  [KnowledgeBaseErrorCode.ModelConfigurationUnavailable]:
    'Knowledge enrichment model configuration is unavailable',
  [KnowledgeBaseErrorCode.ModelConfigurationChanged]:
    'Knowledge enrichment model configuration changed',
  [KnowledgeBaseErrorCode.UnsupportedModelProvider]:
    'Knowledge enrichment model provider is unsupported',
  [KnowledgeBaseErrorCode.EnrichmentPersistenceFailed]:
    'Knowledge enrichment publication failed',
};

export class KnowledgeEnrichmentPublicationError extends Error {
  readonly code: PublicationErrorCode;

  constructor(inputCode: PublicationErrorCode) {
    const code = publicationErrorCodeSet.has(inputCode)
      ? inputCode
      : KnowledgeBaseErrorCode.EnrichmentPersistenceFailed;
    super(publicationErrorMessages[code]);
    this.name = 'KnowledgeEnrichmentPublicationError';
    this.code = code;
    delete this.stack;
  }

  toJSON(): { code: PublicationErrorCode; message: string } {
    return { code: this.code, message: this.message };
  }
}

const fail = (code: PublicationErrorCode): never => {
  throw new KnowledgeEnrichmentPublicationError(code);
};
const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const isSqliteError = (error: unknown): boolean => {
  try {
    return typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string' &&
      error.code.startsWith('SQLITE_');
  } catch {
    return false;
  }
};

export const buildKnowledgeEvidenceId = (input: {
  requestId: string;
  factId: string;
  documentVersionId: string;
  chunkId: string;
  normalizedQuote: string;
}): string => sha256([
  'knowledge-evidence-v1',
  input.requestId,
  input.factId,
  input.documentVersionId,
  input.chunkId,
  sha256(input.normalizedQuote),
].join('\0'));

const domainSet = new Set<string>(Object.values(KnowledgeFactDomain));
const partialReasonOrder = [
  KnowledgeEnrichmentPartialReason.ChunkLimit,
  KnowledgeEnrichmentPartialReason.CandidateLimit,
] as const;
const partialReasonSet = new Set<string>(partialReasonOrder);

const readExactPlainRecord = (
  value: unknown,
  expectedKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): PlainRecord => {
  try {
    if (
      typeof value !== 'object' || value === null || Array.isArray(value) ||
      nodeUtilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort();
    const required = expectedKeys.filter(key => !optionalKeys.includes(key));
    if (
      required.some(key => !keys.includes(key)) ||
      keys.some(key => !expectedKeys.includes(key))
    ) {
      return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
    }
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !('value' in descriptor)) {
        return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
      }
    }
    return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
  } catch (error) {
    if (error instanceof KnowledgeEnrichmentPublicationError) throw error;
    return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
  }
};

const copyDenseArray = (
  value: unknown,
  maximumLength = Number.MAX_SAFE_INTEGER,
): unknown[] => {
  try {
    if (
      !Array.isArray(value) || nodeUtilTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
    }
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      !length ||
      !('value' in length) ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0 ||
      length.value > maximumLength
    ) {
      return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
    }
    const result: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor)) {
        return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
      }
      result.push(descriptor.value);
    }
    return result;
  } catch (error) {
    if (error instanceof KnowledgeEnrichmentPublicationError) throw error;
    return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
  }
};

const requireSafeCount = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
  }
  return value;
};

const validateEvidence = (value: unknown): KnowledgeEnrichmentSelectedEvidence => {
  const record = readExactPlainRecord(value, [
    'chunkId', 'chunkOrdinal', 'quote', 'normalizedQuote', 'confidence',
  ]);
  if (
    typeof record.chunkId !== 'string' || record.chunkId.trim().length === 0 ||
    typeof record.chunkOrdinal !== 'number' ||
    !Number.isSafeInteger(record.chunkOrdinal) || record.chunkOrdinal < 0 ||
    typeof record.quote !== 'string' || record.quote.length === 0 ||
    record.quote.length > 1_000 || record.quote.trim() !== record.quote ||
    typeof record.normalizedQuote !== 'string' || record.normalizedQuote.length === 0 ||
    normalizeKnowledgeEvidenceQuote(record.quote) !== record.normalizedQuote ||
    typeof record.confidence !== 'number' || !Number.isFinite(record.confidence) ||
    record.confidence < 0 || record.confidence > 1
  ) {
    return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
  }
  return {
    chunkId: record.chunkId,
    chunkOrdinal: record.chunkOrdinal,
    quote: record.quote,
    normalizedQuote: record.normalizedQuote,
    confidence: record.confidence,
  };
};

const validateCandidate = (
  value: unknown,
  maximumEvidenceCount = 1_500,
): KnowledgeEnrichmentPublicationCandidate => {
  const record = readExactPlainRecord(value, ['domain', 'value', 'normalizedValue', 'evidence']);
  if (
    typeof record.domain !== 'string' || !domainSet.has(record.domain) ||
    typeof record.value !== 'string' || record.value.length === 0 || record.value.length > 2_000 ||
    typeof record.normalizedValue !== 'string' || record.normalizedValue.length === 0
  ) {
    return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
  }
  const normalized = normalizeEnterpriseKnowledgeValue(record.value);
  if (normalized.displayValue !== record.value || normalized.normalizedValue !== record.normalizedValue) {
    return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
  }
  const evidence = copyDenseArray(record.evidence, maximumEvidenceCount).map(validateEvidence);
  if (evidence.length === 0) {
    return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
  }
  return {
    domain: record.domain as KnowledgeEnrichmentPublicationCandidate['domain'],
    value: record.value,
    normalizedValue: record.normalizedValue,
    evidence,
  };
};

const validateSelection = (value: unknown): ValidatedSelection => {
  const record = readExactPlainRecord(value, [
    'candidates', 'parsedCandidateCount', 'validCandidateCount',
    'discardedCandidateCount', 'partialReasons',
  ]);
  const candidates: KnowledgeEnrichmentPublicationCandidate[] = [];
  let remainingEvidenceCount = 1_500;
  for (const rawCandidate of copyDenseArray(record.candidates, 200)) {
    const candidate = validateCandidate(rawCandidate, remainingEvidenceCount);
    candidates.push(candidate);
    remainingEvidenceCount -= candidate.evidence.length;
  }
  const parsedCandidateCount = requireSafeCount(record.parsedCandidateCount);
  const validCandidateCount = requireSafeCount(record.validCandidateCount);
  const discardedCandidateCount = requireSafeCount(record.discardedCandidateCount);
  const partialReasons = copyDenseArray(
    record.partialReasons,
    partialReasonOrder.length,
  ).map(reason => {
    if (typeof reason !== 'string' || !partialReasonSet.has(reason)) {
      return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
    }
    return reason as ValidatedSelection['partialReasons'][number];
  });
  const canonicalReasons = partialReasonOrder.filter(reason => partialReasons.includes(reason));
  if (
    new Set(partialReasons).size !== partialReasons.length ||
    canonicalReasons.some((reason, index) => reason !== partialReasons[index]) ||
    candidates.length !== validCandidateCount || validCandidateCount > 200 ||
    discardedCandidateCount > parsedCandidateCount
  ) {
    return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
  }
  const selectedEvidenceCount = candidates.reduce((sum, item) => sum + item.evidence.length, 0);
  const distinctChunks = new Set(candidates.flatMap(item => item.evidence.map(row => row.chunkId)));
  if (
    selectedEvidenceCount > 1_500 || distinctChunks.size > 30 ||
    selectedEvidenceCount < validCandidateCount ||
    selectedEvidenceCount + discardedCandidateCount > parsedCandidateCount
  ) {
    return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
  }
  if (
    candidates.length === 0 &&
    (parsedCandidateCount !== 0 || validCandidateCount !== 0 || discardedCandidateCount !== 0 ||
      !(partialReasons.length === 0 ||
        (partialReasons.length === 1 && partialReasons[0] === KnowledgeEnrichmentPartialReason.ChunkLimit)))
  ) {
    return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
  }
  return {
    candidates,
    parsedCandidateCount,
    validCandidateCount,
    discardedCandidateCount,
    partialReasons,
  };
};

const normalizeInput = (
  input: PublishValidatedCandidatesInput,
  clock: () => string,
): NormalizedPublicationInput => {
  const record = readExactPlainRecord(
    input,
    [
      'requestId', 'attemptId', 'expectedPublishedGenerationId',
      'expectedIndexedChunkCount', 'selection', 'now',
    ],
    ['now'],
  );
  if (
    typeof record.requestId !== 'string' || record.requestId.trim().length === 0 ||
    typeof record.attemptId !== 'string' || record.attemptId.trim().length === 0 ||
    typeof record.expectedPublishedGenerationId !== 'string' ||
    record.expectedPublishedGenerationId.trim().length === 0 ||
    record.expectedPublishedGenerationId.trim() !== record.expectedPublishedGenerationId ||
    typeof record.expectedIndexedChunkCount !== 'number' ||
    !Number.isSafeInteger(record.expectedIndexedChunkCount) ||
    record.expectedIndexedChunkCount < 1
  ) {
    return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
  }
  const now = record.now === undefined ? clock() : record.now;
  if (typeof now !== 'string') return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
  try {
    if (new Date(now).toISOString() !== now) {
      return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
    }
  } catch {
    return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
  }
  return {
    requestId: record.requestId.trim(),
    attemptId: record.attemptId.trim(),
    expectedPublishedGenerationId: record.expectedPublishedGenerationId,
    expectedIndexedChunkCount: record.expectedIndexedChunkCount,
    selection: validateSelection(record.selection),
    now,
  };
};

const identityKey = (domain: string, normalizedValue: string): string =>
  domain + '\0' + normalizedValue;
const defaultResolveExactRoute = (
  source: KnowledgeEnrichmentWorkspaceRouteSource,
  requestRoute: KnowledgeEnrichmentRouteReference,
): KnowledgeEnrichmentRouteReference => {
  const route = new KnowledgeEnrichmentModelResolver({
    getWorkspace: workspaceId => workspaceId === source.id ? source : null,
  }).resolveExact(requestRoute);
  return {
    workspaceId: route.workspaceId,
    providerId: route.providerId,
    modelId: route.modelId,
    routingFingerprint: route.routingFingerprint,
  };
};

export class KnowledgeEnrichmentPublicationStore {
  private readonly uuidFactory: () => string;

  private readonly clock: () => string;

  constructor(
    private readonly db: Database.Database,
    private readonly factStore: KnowledgeFactStore,
    private readonly requestStore: KnowledgeEnrichmentRequestStore,
    private readonly options: KnowledgeEnrichmentPublicationStoreOptions,
  ) {
    this.uuidFactory = options.uuidFactory ?? randomUUID;
    this.clock = options.clock ?? (() => new Date().toISOString());
    if (
      factStore.getDatabaseForInternalUse() !== db ||
      requestStore.getDatabaseForInternalUse() !== db
    ) {
      fail(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
    }
  }

  publishValidatedCandidates(
    input: PublishValidatedCandidatesInput,
  ): KnowledgeEnrichmentPublicationResult {
    try {
      const normalized = normalizeInput(input, this.clock);
      if (this.db.inTransaction) {
        return fail(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
      }
      const transaction = this.db.transaction(() => this.publishInCurrentTransaction(normalized));
      return runTransientSqliteWriteTransaction(transaction);
    } catch (error) {
      this.rethrow(error);
    }
  }

  private publishInCurrentTransaction(
    input: NormalizedPublicationInput,
  ): KnowledgeEnrichmentPublicationResult {
    const context = this.revalidate(input);
    this.emitStage(KnowledgeEnrichmentPublicationStage.AfterRevalidationBeforeFirstWrite);
    const candidates = [...input.selection.candidates].sort((left, right) =>
      left.domain.localeCompare(right.domain) ||
      left.normalizedValue.localeCompare(right.normalizedValue) ||
      left.value.localeCompare(right.value));
    const seenIdentities = new Set<string>();
    for (const candidate of candidates) {
      const key = identityKey(candidate.domain, candidate.normalizedValue);
      if (seenIdentities.has(key)) {
        return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
      }
      seenIdentities.add(key);
    }
    const existingRows = this.factStore.findPublicationFactsInCurrentTransaction(
      context.workspaceId,
      candidates.map(candidate => ({
        domain: candidate.domain,
        normalizedValue: candidate.normalizedValue,
      })),
    );
    const existingByIdentity = new Map(existingRows.map(row => [
      identityKey(row.domain, row.normalizedValue),
      row.id,
    ]));
    const assignments: PublicationAssignment[] = [];
    for (const candidate of candidates) {
      const existingFactId = existingByIdentity.get(
        identityKey(candidate.domain, candidate.normalizedValue),
      );
      if (existingFactId) {
        assignments.push({ candidate, factId: existingFactId, existing: true });
        continue;
      }
      const factId = this.nextFactId();
      this.factStore.insertPublicationFactInCurrentTransaction({
        id: factId,
        originatingRequestId: context.requestId,
        workspaceId: context.workspaceId,
        domain: candidate.domain,
        value: candidate.value,
        normalizedValue: candidate.normalizedValue,
        now: input.now,
      });
      assignments.push({ candidate, factId, existing: false });
    }
    this.emitStage(KnowledgeEnrichmentPublicationStage.AfterFacts);

    const plannedEvidence = assignments.flatMap(assignment =>
      assignment.candidate.evidence.map(evidence => ({
        assignment,
        evidence,
        id: buildKnowledgeEvidenceId({
          requestId: context.requestId,
          factId: assignment.factId,
          documentVersionId: context.documentVersionId,
          chunkId: evidence.chunkId,
          normalizedQuote: evidence.normalizedQuote,
        }),
      })));
    const existingEvidenceRows = this.factStore.findPublicationEvidenceInCurrentTransaction(
      plannedEvidence.map(row => row.id),
    );
    const existingEvidenceById = new Map(existingEvidenceRows.map(row => [row.id, row]));
    const newlySupportedExistingFacts = new Set<string>();
    const insertedEvidenceIds = new Set<string>();
    for (const planned of plannedEvidence) {
      const existing = existingEvidenceById.get(planned.id);
      if (existing) {
        if (!this.evidenceIdentityMatches(existing, planned, context)) {
          return fail(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
        }
        continue;
      }
      if (insertedEvidenceIds.has(planned.id)) {
        continue;
      }
      this.factStore.insertPublicationEvidenceInCurrentTransaction({
        id: planned.id,
        workspaceId: context.workspaceId,
        factId: planned.assignment.factId,
        requestId: context.requestId,
        documentId: context.documentId,
        documentVersionId: context.documentVersionId,
        chunkId: planned.evidence.chunkId,
        quote: planned.evidence.quote,
        confidence: planned.evidence.confidence,
        extractorProviderId: context.providerId,
        extractorModelId: context.modelId,
        createdAt: input.now,
      });
      insertedEvidenceIds.add(planned.id);
      if (planned.assignment.existing) {
        newlySupportedExistingFacts.add(planned.assignment.factId);
      }
    }
    if (newlySupportedExistingFacts.size > 0) {
      this.factStore.revisePublicationFactsInCurrentTransaction(
        [...newlySupportedExistingFacts],
        input.now,
      );
    }
    this.emitStage(KnowledgeEnrichmentPublicationStage.AfterEvidence);

    this.factStore.insertPublicationMembershipsInCurrentTransaction(
      context.requestId,
      assignments.map(assignment => assignment.factId),
    );
    this.emitStage(KnowledgeEnrichmentPublicationStage.AfterMembership);

    const terminalStatus = this.factStore.hasReviewablePublicationFactsInCurrentTransaction(
      context.requestId,
    )
      ? KnowledgeEnrichmentStatus.ReviewRequired
      : KnowledgeEnrichmentStatus.Completed;
    const finalized = this.requestStore.finalizePublicationInCurrentTransaction({
      requestId: context.requestId,
      attemptId: context.attemptId,
      status: terminalStatus,
      validCandidateCount: input.selection.validCandidateCount,
      discardedCandidateCount: input.selection.discardedCandidateCount,
      partialReasons: input.selection.partialReasons,
      now: input.now,
    }, () => this.emitStage(KnowledgeEnrichmentPublicationStage.AfterAttemptFinalized));
    if (!finalized) {
      return fail(KnowledgeBaseErrorCode.EnrichmentRequestStale);
    }
    this.emitStage(KnowledgeEnrichmentPublicationStage.AfterRequestFinalized);
    const summary = this.requestStore.getSummaryInCurrentTransaction(context.requestId);
    if (!summary) {
      return fail(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
    }
    return {
      summary,
      factIds: assignments.map(assignment => assignment.factId),
    };
  }

  private revalidate(input: NormalizedPublicationInput): RevalidatedContext {
    const lease = this.requestStore.getRunningLeaseInCurrentTransaction(
      input.requestId,
      input.attemptId,
    );
    if (!lease) {
      return fail(KnowledgeBaseErrorCode.EnrichmentRequestStale);
    }
    const request = lease.request;
    const lifecycle = this.db.prepare(`
      SELECT
        document.id AS document_id,
        document.workspace_id,
        document.current_version_id,
        document.deleted_at,
        version.document_id AS version_document_id,
        index_state.status AS index_status,
        index_state.workspace_id AS index_workspace_id,
        index_state.document_id AS index_document_id,
        index_state.published_generation_id,
        index_state.chunk_count
      FROM knowledge_documents AS document
      JOIN knowledge_document_versions AS version ON version.id = ?
      LEFT JOIN knowledge_document_index_state AS index_state
        ON index_state.document_version_id = version.id
      WHERE document.id = ?
      LIMIT 1
    `).get(request.documentVersionId, request.documentId) as {
      document_id: string;
      workspace_id: string;
      current_version_id: string;
      deleted_at: string | null;
      version_document_id: string;
      index_status: string | null;
      index_workspace_id: string | null;
      index_document_id: string | null;
      published_generation_id: string | null;
      chunk_count: number | null;
    } | undefined;
    if (
      !lifecycle ||
      lifecycle.document_id !== request.documentId ||
      lifecycle.workspace_id !== request.workspaceId ||
      lifecycle.deleted_at !== null ||
      lifecycle.current_version_id !== request.documentVersionId ||
      lifecycle.version_document_id !== request.documentId ||
      lifecycle.index_status !== KnowledgeDocumentIndexStatus.Indexed ||
      lifecycle.index_workspace_id !== request.workspaceId ||
      lifecycle.index_document_id !== request.documentId ||
      typeof lifecycle.published_generation_id !== 'string' ||
      lifecycle.published_generation_id.trim().length === 0 ||
      !Number.isSafeInteger(lifecycle.chunk_count) ||
      lifecycle.chunk_count! < 1 ||
      lifecycle.published_generation_id !== input.expectedPublishedGenerationId ||
      lifecycle.chunk_count !== input.expectedIndexedChunkCount
    ) {
      return fail(KnowledgeBaseErrorCode.EnrichmentRequestStale);
    }
    let source: KnowledgeEnrichmentWorkspaceRouteSource | null;
    try {
      source = this.options.loadWorkspaceRouteSourceInCurrentTransaction(
        this.db,
        request.workspaceId,
      );
    } catch (error) {
      if (isSqliteError(error)) {
        throw error;
      }
      return fail(KnowledgeBaseErrorCode.ModelConfigurationUnavailable);
    }
    if (!source || typeof (source as unknown as { then?: unknown }).then === 'function') {
      return fail(KnowledgeBaseErrorCode.ModelConfigurationUnavailable);
    }
    const requestRoute: KnowledgeEnrichmentRouteReference = {
      workspaceId: request.workspaceId,
      providerId: request.providerId,
      modelId: request.modelId,
      routingFingerprint: request.routingFingerprint,
    };
    let route: KnowledgeEnrichmentRouteReference;
    try {
      route = (this.options.resolveExactRouteFromSource ?? defaultResolveExactRoute)(
        source,
        requestRoute,
      );
    } catch (error) {
      if (error instanceof KnowledgeEnrichmentModelResolutionError) {
        if (error.code === KnowledgeBaseErrorCode.UnsupportedModelProvider) {
          return fail(KnowledgeBaseErrorCode.UnsupportedModelProvider);
        }
        if (error.code === KnowledgeBaseErrorCode.ModelConfigurationChanged) {
          return fail(KnowledgeBaseErrorCode.ModelConfigurationChanged);
        }
      }
      return fail(KnowledgeBaseErrorCode.ModelConfigurationUnavailable);
    }
    if (
      route.workspaceId !== requestRoute.workspaceId ||
      route.providerId !== requestRoute.providerId ||
      route.modelId !== requestRoute.modelId ||
      route.routingFingerprint !== requestRoute.routingFingerprint
    ) {
      return fail(KnowledgeBaseErrorCode.ModelConfigurationChanged);
    }
    const chunkIds = [...new Set(input.selection.candidates.flatMap(candidate =>
      candidate.evidence.map(evidence => evidence.chunkId)))].sort();
    const chunkRows = this.db.prepare(`
      SELECT id, ordinal, content
      FROM knowledge_document_chunks
      WHERE
        workspace_id = ?
        AND document_id = ?
        AND document_version_id = ?
        AND index_generation_id = ?
        AND id IN (SELECT value FROM JSON_EACH(?))
      ORDER BY id
    `).all(
      request.workspaceId,
      request.documentId,
      request.documentVersionId,
      lifecycle.published_generation_id,
      JSON.stringify(chunkIds),
    ) as Array<{ id: string; ordinal: number; content: string }>;
    if (chunkRows.length !== chunkIds.length) {
      return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
    }
    const chunksById = new Map(chunkRows.map(chunk => [chunk.id, chunk]));
    for (const candidate of input.selection.candidates) {
      for (const evidence of candidate.evidence) {
        const chunk = chunksById.get(evidence.chunkId);
        if (
          !chunk ||
          chunk.ordinal !== evidence.chunkOrdinal ||
          !normalizeKnowledgeEvidenceQuote(chunk.content).includes(evidence.normalizedQuote)
        ) {
          return fail(KnowledgeBaseErrorCode.EvidenceValidationFailed);
        }
      }
    }
    return {
      requestId: request.id,
      attemptId: lease.attempt.id,
      workspaceId: request.workspaceId,
      documentId: request.documentId,
      documentVersionId: request.documentVersionId,
      providerId: route.providerId,
      modelId: route.modelId,
      publishedGenerationId: lifecycle.published_generation_id,
    };
  }

  private evidenceIdentityMatches(
    existing: KnowledgeFactEvidence,
    planned: {
      assignment: PublicationAssignment;
      evidence: KnowledgeEnrichmentSelectedEvidence;
    },
    context: RevalidatedContext,
  ): boolean {
    return (
      existing.workspaceId === context.workspaceId &&
      existing.factId === planned.assignment.factId &&
      existing.requestId === context.requestId &&
      existing.documentId === context.documentId &&
      existing.documentVersionId === context.documentVersionId &&
      existing.chunkId === planned.evidence.chunkId &&
      existing.extractorProviderId === context.providerId &&
      existing.extractorModelId === context.modelId &&
      normalizeKnowledgeEvidenceQuote(existing.quote) === planned.evidence.normalizedQuote
    );
  }

  private nextFactId(): string {
    let id: unknown;
    try {
      id = this.uuidFactory();
    } catch {
      return fail(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
    }
    if (typeof id !== 'string' || id.trim().length === 0) {
      return fail(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
    }
    return id.trim();
  }

  private emitStage(stage: KnowledgeEnrichmentPublicationStage): void {
    try {
      this.options.onStage?.(stage);
    } catch {
      fail(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
    }
  }

  private rethrow(error: unknown): never {
    if (error instanceof KnowledgeEnrichmentPublicationError) {
      throw error;
    }
    if (error instanceof KnowledgeEnrichmentModelResolutionError) {
      if (error.code === KnowledgeBaseErrorCode.ModelConfigurationChanged) {
        return fail(KnowledgeBaseErrorCode.ModelConfigurationChanged);
      }
      if (error.code === KnowledgeBaseErrorCode.UnsupportedModelProvider) {
        return fail(KnowledgeBaseErrorCode.UnsupportedModelProvider);
      }
      return fail(KnowledgeBaseErrorCode.ModelConfigurationUnavailable);
    }
    return fail(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
  }
}
