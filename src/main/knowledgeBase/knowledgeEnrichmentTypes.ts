import {
  KnowledgeBaseErrorCode,
  type KnowledgeEnrichmentAttemptOutcome,
  type KnowledgeEnrichmentPartialReason,
  type KnowledgeEnrichmentStatus,
  KnowledgeEnrichmentStatus as KnowledgeEnrichmentStatuses,
  type KnowledgeFactDomain,
  type KnowledgeFactProjectionState,
  type KnowledgeFactReviewStatus,
  type KnowledgeFactSourceKind,
} from '../../shared/knowledgeBase/constants';
import type { KnowledgeEnrichmentSummary } from '../../shared/knowledgeBase/types';
import type { ProviderConfig } from '../../shared/providers/types';
import type { CoworkApiConfig } from '../libs/coworkConfigStore';

export interface KnowledgeEnrichmentWorkspaceRouteSource {
  id: string;
  settings: {
    model: {
      defaultModel: string;
      defaultModelProvider: string;
      providers: Record<string, ProviderConfig>;
    };
  };
}

export interface KnowledgeEnrichmentRouteReference {
  workspaceId: string;
  providerId: string;
  modelId: string;
  routingFingerprint: string;
}

/**
 * Main-process-only route lock. `apiConfig` contains credentials and must not
 * be persisted, logged, or mapped into renderer-facing DTOs.
 */
export interface KnowledgeEnrichmentLockedRoute extends KnowledgeEnrichmentRouteReference {
  apiConfig: CoworkApiConfig & { apiType: 'openai' };
  providerLabel: string;
  modelLabel: string;
  apiType: 'openai';
}

export interface KnowledgeEnrichmentChunkInput {
  id: string;
  ordinal: number;
  content: string;
}

export interface KnowledgeEnrichmentPrompt {
  systemPrompt: string;
  prompt: string;
}

export interface ValidateKnowledgeEnrichmentResponseInput {
  responseText: string;
  chunk: KnowledgeEnrichmentChunkInput;
}

export interface KnowledgeEnrichmentValidatedCandidate {
  domain: KnowledgeFactDomain;
  value: string;
  normalizedValue: string;
  chunkId: string;
  chunkOrdinal: number;
  quote: string;
  normalizedQuote: string;
  confidence: number;
}

export interface KnowledgeEnrichmentResponseValidationResult {
  parsedCandidateCount: number;
  discardedCandidateCount: number;
  candidates: readonly KnowledgeEnrichmentValidatedCandidate[];
}

export interface KnowledgeEnrichmentSelectedEvidence {
  chunkId: string;
  chunkOrdinal: number;
  quote: string;
  normalizedQuote: string;
  confidence: number;
}

export interface KnowledgeEnrichmentPublicationCandidate {
  domain: KnowledgeFactDomain;
  value: string;
  normalizedValue: string;
  evidence: readonly KnowledgeEnrichmentSelectedEvidence[];
}

export interface SelectKnowledgeEnrichmentCandidatesInput {
  responses: readonly KnowledgeEnrichmentResponseValidationResult[];
  totalIndexedChunkCount: number;
}

export interface KnowledgeEnrichmentCandidateSelection {
  candidates: readonly KnowledgeEnrichmentPublicationCandidate[];
  parsedCandidateCount: number;
  validCandidateCount: number;
  discardedCandidateCount: number;
  partialReasons: readonly KnowledgeEnrichmentPartialReason[];
}

export type KnowledgeEnrichmentValidationErrorCode =
  | typeof KnowledgeBaseErrorCode.InvalidModelResponse
  | typeof KnowledgeBaseErrorCode.EvidenceValidationFailed;

export interface CreateAuthorizedEnrichmentRequestInput {
  workspaceId: string;
  documentId: string;
  documentVersionId: string;
  providerId: string;
  modelId: string;
  routingFingerprint: string;
  now?: string;
}

export interface RetryAuthorizedEnrichmentRequestInput
  extends CreateAuthorizedEnrichmentRequestInput {
  requestId: string;
}

export interface KnowledgeEnrichmentAuthorizedTransition {
  request: KnowledgeEnrichmentRequest;
  queuedTransition: boolean;
}

export interface EmptyCompletionCounts {
  validCandidateCount: 0;
  discardedCandidateCount: 0;
  partialReasons: readonly KnowledgeEnrichmentPartialReason[];
  now?: string;
}

export type KnowledgeEnrichmentSafeFailureCode =
  | typeof KnowledgeBaseErrorCode.ModelConfigurationUnavailable
  | typeof KnowledgeBaseErrorCode.ModelConfigurationChanged
  | typeof KnowledgeBaseErrorCode.UnsupportedModelProvider
  | typeof KnowledgeBaseErrorCode.ModelRequestFailed
  | typeof KnowledgeBaseErrorCode.ModelRequestTimeout
  | typeof KnowledgeBaseErrorCode.InvalidModelResponse
  | typeof KnowledgeBaseErrorCode.EvidenceValidationFailed
  | typeof KnowledgeBaseErrorCode.EnrichmentPersistenceFailed
  | typeof KnowledgeBaseErrorCode.AuthorizationRequired;

export interface SafeFailure {
  code: KnowledgeEnrichmentSafeFailureCode;
  now?: string;
}

export interface KnowledgeEnrichmentRequest {
  id: string;
  workspaceId: string;
  documentId: string;
  documentVersionId: string;
  status: KnowledgeEnrichmentStatus;
  consentMode: 'explicit';
  providerId: string;
  modelId: string;
  routingFingerprint: string;
  revision: number;
  progress: number;
  attemptCount: number;
  activeAttemptId: string | null;
  errorCode: KnowledgeBaseErrorCode | null;
  errorMessage: string | null;
  validCandidateCount: number;
  discardedCandidateCount: number;
  partialReasons: KnowledgeEnrichmentPartialReason[];
  requestedAt: string;
  startedAt: string | null;
  heartbeatAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface KnowledgeEnrichmentAttempt {
  id: string;
  requestId: string;
  attemptNumber: number;
  startedAt: string;
  heartbeatAt: string;
  finishedAt: string | null;
  outcome: KnowledgeEnrichmentAttemptOutcome;
  errorCode: KnowledgeBaseErrorCode | null;
  errorMessage: string | null;
}

export interface KnowledgeEnrichmentClaim {
  request: KnowledgeEnrichmentRequest;
  attempt: KnowledgeEnrichmentAttempt;
}

export interface KnowledgeFact {
  id: string;
  originatingRequestId: string | null;
  workspaceId: string;
  domain: KnowledgeFactDomain;
  value: string;
  normalizedValue: string;
  reviewStatus: KnowledgeFactReviewStatus;
  sourceKind: KnowledgeFactSourceKind;
  revision: number;
  conflictGroupKey: string | null;
  projectionState: KnowledgeFactProjectionState;
  createdAt: string;
  reviewedAt: string | null;
  updatedAt: string;
  tombstonedAt: string | null;
}

export interface KnowledgeFactEvidence {
  id: string;
  workspaceId: string;
  factId: string;
  requestId: string;
  documentId: string;
  documentVersionId: string;
  chunkId: string;
  quote: string;
  confidence: number;
  extractorProviderId: string;
  extractorModelId: string;
  createdAt: string;
  staleAt: string | null;
}

export interface PublishValidatedCandidatesInput {
  requestId: string;
  attemptId: string;
  expectedPublishedGenerationId: string;
  expectedIndexedChunkCount: number;
  selection: KnowledgeEnrichmentCandidateSelection;
  now?: string;
}

export interface KnowledgeEnrichmentPublicationResult {
  summary: KnowledgeEnrichmentSummary;
  factIds: readonly string[];
}

export interface FinalizeKnowledgeEnrichmentPublicationInput {
  requestId: string;
  attemptId: string;
  status:
    | typeof KnowledgeEnrichmentStatuses.ReviewRequired
    | typeof KnowledgeEnrichmentStatuses.Completed;
  validCandidateCount: number;
  discardedCandidateCount: number;
  partialReasons: readonly KnowledgeEnrichmentPartialReason[];
  now: string;
}

export interface KnowledgeEvidenceStaleResult {
  staleEvidenceCount: number;
  revisedFactCount: number;
  completedRequestCount: number;
}

export interface KnowledgeFactCleanupResult {
  deletedMembershipCount: number;
  deletedEvidenceCount: number;
  deletedFactCount: number;
}
