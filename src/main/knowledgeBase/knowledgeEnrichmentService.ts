import Database from 'better-sqlite3';

import {
  KNOWLEDGE_ENRICHMENT_HEARTBEAT_INTERVAL_MS,
  KNOWLEDGE_ENRICHMENT_MAX_CHUNKS,
  KNOWLEDGE_ENRICHMENT_MODEL_MAX_RESPONSE_BYTES,
  KNOWLEDGE_ENRICHMENT_MODEL_MAX_TOKENS,
  KNOWLEDGE_ENRICHMENT_MODEL_TIMEOUT_MS,
  KnowledgeBaseErrorCode,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentStatus,
} from '../../shared/knowledgeBase/constants';
import type { KnowledgeEnrichmentSummary } from '../../shared/knowledgeBase/types';
import { ProviderName } from '../../shared/providers/constants';
import {
  type ModelClientAdapter,
  ModelGenerationFinishReason,
  ModelGenerationResponseFormat,
  ModelGenerationThinkingMode,
  ModelResponseInvalidContentError,
  ModelResponseInvalidJsonError,
  ModelResponseReadError,
  ModelResponseTooLargeError,
} from '../industryPack/modelClientAdapter';
import {
  isTransientSqliteBusyError,
  runTransientSqliteWriteTransaction,
  runTransientSqliteWriteTransactionUntilSuccess,
} from '../libs/sqliteTransactionRetry';
import type { KnowledgeDocumentChunk } from './knowledgeDocumentIndexTypes';
import {
  buildKnowledgeEnrichmentPrompt,
  KnowledgeEnrichmentValidationError,
  selectKnowledgeEnrichmentCandidates,
  validateKnowledgeEnrichmentResponse,
} from './knowledgeEnrichmentCandidateValidator';
import {
  KnowledgeEnrichmentModelResolutionError,
  type KnowledgeEnrichmentModelResolver,
} from './knowledgeEnrichmentModelResolver';
import {
  KnowledgeEnrichmentPublicationError,
  type KnowledgeEnrichmentPublicationStore,
} from './knowledgeEnrichmentPublicationStore';
import {
  KnowledgeEnrichmentRequestStateError,
  type KnowledgeEnrichmentRequestStore,
} from './knowledgeEnrichmentRequestStore';
import type {
  KnowledgeEnrichmentChunkInput,
  KnowledgeEnrichmentClaim,
  KnowledgeEnrichmentLockedRoute,
  KnowledgeEnrichmentRequest,
  KnowledgeEnrichmentResponseValidationResult,
  KnowledgeEnrichmentSafeFailureCode,
  KnowledgeEnrichmentWorkspaceRouteSource,
} from './knowledgeEnrichmentTypes';
import {
  KnowledgeExtractionAuthorizationCallbackDisposition,
  KnowledgeExtractionAuthorizationCallbackFailure,
  type KnowledgeExtractionAuthorizationContext,
  KnowledgeExtractionAuthorizationError,
  type KnowledgeExtractionAuthorizationStore,
} from './knowledgeExtractionAuthorizationStore';

type AuthorizationGateway = Pick<KnowledgeExtractionAuthorizationStore, 'consume' | 'issue'>;
type RequestGateway = Pick<
  KnowledgeEnrichmentRequestStore,
  | 'cancel'
  | 'claimNext'
  | 'createOrGetAuthorizedRequestInCurrentTransaction'
  | 'failAttempt'
  | 'getDatabaseForInternalUse'
  | 'getRunningLeaseInCurrentTransaction'
  | 'getSummary'
  | 'heartbeat'
  | 'retryFailedWithAuthorizationInCurrentTransaction'
>;
type PublicationGateway = Pick<KnowledgeEnrichmentPublicationStore, 'publishValidatedCandidates'>;
type RouteResolver = Pick<KnowledgeEnrichmentModelResolver, 'resolveRouteSource'>;

export interface KnowledgeEnrichmentPublishedChunkReader {
  listPublishedChunks(documentVersionId: string): readonly KnowledgeDocumentChunk[];
}

export type KnowledgeEnrichmentBusyRetryDelay = (
  delayMs: number,
  signal: AbortSignal,
) => Promise<void>;

export interface KnowledgeEnrichmentServiceOptions {
  db: Database.Database;
  authorizationStore: AuthorizationGateway;
  requestStore: RequestGateway;
  publicationStore: PublicationGateway;
  modelResolver: RouteResolver;
  modelClient: Pick<ModelClientAdapter, 'generate'>;
  publishedChunkReader?: KnowledgeEnrichmentPublishedChunkReader;
  loadWorkspaceRouteSourceInCurrentTransaction: (
    db: Database.Database,
    workspaceId: string,
  ) => KnowledgeEnrichmentWorkspaceRouteSource | null;
  busyRetryDelay?: KnowledgeEnrichmentBusyRetryDelay;
  clock?: () => string;
  logError?: (event: {
    module: '[KnowledgeEnrichment]';
    requestId: string;
    attemptId: string;
    code: KnowledgeEnrichmentSafeFailureCode;
  }) => void;
}

type AuthorizedTargetSnapshot = {
  workspaceId: string;
  documentId: string;
  documentVersionId: string;
  documentDisplayName: string;
  publishedGenerationId: string;
  totalIndexedChunkCount: number;
  plannedModelCalls: number;
  partial: boolean;
  route: KnowledgeEnrichmentLockedRoute;
};

type ClaimedSnapshot = {
  requestId: string;
  attemptId: string;
  workspaceId: string;
  documentId: string;
  documentVersionId: string;
  publishedGenerationId: string;
  totalIndexedChunkCount: number;
  modelCallCount: number;
};

type ActiveAbortKind =
  | 'cancel'
  | 'heartbeat_failure'
  | 'lifecycle'
  | 'lost_lease'
  | 'shutdown'
  | 'timeout';

type ActiveAttempt = {
  requestId: string;
  attemptId: string;
  workspaceId: string;
  documentVersionId: string;
  controller: AbortController;
  abortKind: ActiveAbortKind | null;
};

type AuthorizedTargetRow = {
  document_id: string;
  workspace_id: string;
  display_name: string;
  current_version_id: string;
  document_status: string;
  deleted_at: string | null;
  version_id: string | null;
  version_document_id: string | null;
  extracted_text: string | null;
  index_status: string | null;
  index_workspace_id: string | null;
  index_document_id: string | null;
  published_generation_id: string | null;
  chunk_count: number | null;
};

type AuthorizedChunkRow = {
  id: string;
  index_generation_id: string;
  workspace_id: string;
  document_id: string;
  document_version_id: string;
  ordinal: number;
  content: string;
};

type LifecycleRow = {
  document_id: string;
  workspace_id: string;
  current_version_id: string;
  document_status: string;
  deleted_at: string | null;
  version_document_id: string;
  extracted_text: string | null;
  index_status: string | null;
  index_workspace_id: string | null;
  index_document_id: string | null;
  published_generation_id: string | null;
  chunk_count: number | null;
};

type ChunkRow = LifecycleRow & {
  chunk_id: string | null;
  chunk_ordinal: number | null;
  chunk_content: string | null;
};

const ClaimAbortReason = Symbol('knowledge-enrichment-claim-abort');

class StopActiveAttemptError extends Error {
  constructor() {
    super('The active knowledge enrichment attempt stopped.');
    this.name = 'StopActiveAttemptError';
    delete this.stack;
  }
}

class WorkerFailureError extends Error {
  constructor(readonly code: KnowledgeEnrichmentSafeFailureCode) {
    super('The knowledge enrichment attempt failed.');
    this.name = 'WorkerFailureError';
    delete this.stack;
  }
}

const isSqliteError = (error: unknown): boolean => {
  try {
    return typeof error === 'object'
      && error !== null
      && 'code' in error
      && typeof error.code === 'string'
      && error.code.startsWith('SQLITE_');
  } catch {
    return false;
  }
};

const isThenable = (value: unknown): boolean =>
  typeof value === 'object'
  && value !== null
  && 'then' in value
  && typeof value.then === 'function';

const routesMatch = (
  route: KnowledgeEnrichmentLockedRoute,
  request: Pick<
    KnowledgeEnrichmentRequest,
    'modelId' | 'providerId' | 'routingFingerprint' | 'workspaceId'
  >,
): boolean => route.workspaceId === request.workspaceId
  && route.providerId === request.providerId
  && route.modelId === request.modelId
  && route.routingFingerprint === request.routingFingerprint;

const defaultBusyRetryDelay: KnowledgeEnrichmentBusyRetryDelay = (delayMs, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(ClaimAbortReason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(ClaimAbortReason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

export class KnowledgeEnrichmentService {
  private readonly clock: () => string;

  private readonly busyRetryDelay: KnowledgeEnrichmentBusyRetryDelay;

  private drainPromise: Promise<void> | null = null;

  private claimAbortController: AbortController | null = null;

  private activeAttempt: ActiveAttempt | null = null;

  private wakeRequested = false;

  private shuttingDown = false;

  constructor(private readonly options: KnowledgeEnrichmentServiceOptions) {
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.busyRetryDelay = options.busyRetryDelay ?? defaultBusyRetryDelay;
    if (options.requestStore.getDatabaseForInternalUse() !== options.db) {
      throw new KnowledgeExtractionAuthorizationError(
        KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
      );
    }
  }

  prepareExtractionAuthorization(input: {
    ownerId: number;
    documentId: string;
    documentVersionId: string;
  }): ReturnType<AuthorizationGateway['issue']> {
    if (
      !Number.isInteger(input.ownerId)
      || input.ownerId < 0
      || typeof input.documentId !== 'string'
      || input.documentId.trim().length === 0
      || typeof input.documentVersionId !== 'string'
      || input.documentVersionId.trim().length === 0
    ) {
      throw new KnowledgeExtractionAuthorizationError(KnowledgeBaseErrorCode.InvalidRequest);
    }
    const documentId = input.documentId.trim();
    const documentVersionId = input.documentVersionId.trim();
    let snapshot: AuthorizedTargetSnapshot;
    try {
      snapshot = this.readTransaction(() => this.readAuthorizedTarget(
        documentId,
        documentVersionId,
      ));
    } catch (error) {
      this.rethrowPreparationError(error);
    }
    return this.options.authorizationStore.issue({
      ownerId: input.ownerId,
      workspaceId: snapshot.workspaceId,
      documentId: snapshot.documentId,
      documentVersionId: snapshot.documentVersionId,
      documentDisplayName: snapshot.documentDisplayName,
      publishedGenerationId: snapshot.publishedGenerationId,
      lockedRoute: snapshot.route,
      plannedModelCalls: snapshot.plannedModelCalls,
      partial: snapshot.partial,
    });
  }

  requestExtraction(input: {
    ownerId: number;
    authorizationToken: string;
  }): Promise<KnowledgeEnrichmentSummary> {
    return this.consumeAuthorization({
      ownerId: input.ownerId,
      authorizationToken: input.authorizationToken,
      requestId: null,
    });
  }

  retryExtraction(input: {
    ownerId: number;
    requestId: string;
    authorizationToken: string;
  }): Promise<KnowledgeEnrichmentSummary> {
    return this.consumeAuthorization({
      ownerId: input.ownerId,
      authorizationToken: input.authorizationToken,
      requestId: input.requestId,
    });
  }

  cancelExtraction(input: {
    requestId: string;
    expectedRevision: number;
  }): KnowledgeEnrichmentSummary {
    const cancelled = this.options.requestStore.cancel(
      input.requestId,
      input.expectedRevision,
      this.clock(),
    );
    const summary = this.options.requestStore.getSummary(cancelled.id);
    if (!summary) {
      throw new KnowledgeEnrichmentRequestStateError(
        KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
      );
    }
    const active = this.activeAttempt;
    if (active?.requestId === cancelled.id) {
      this.abortAttempt(active, 'cancel');
    }
    return summary;
  }

  abortActiveAttemptForVersion(documentVersionId: string): void {
    const active = this.activeAttempt;
    if (active && active.documentVersionId === documentVersionId) {
      this.abortAttempt(active, 'lifecycle');
    }
  }

  abortActiveAttemptForWorkspace(workspaceId: string): void {
    const active = this.activeAttempt;
    if (active && active.workspaceId === workspaceId) {
      this.abortAttempt(active, 'lifecycle');
    }
  }

  wake(): void {
    if (this.shuttingDown) return;
    this.wakeRequested = true;
    if (!this.drainPromise) {
      this.startDrain();
    }
  }

  async waitForIdle(): Promise<void> {
    while (this.drainPromise) {
      const current = this.drainPromise;
      await current;
    }
  }

  async shutdown(): Promise<void> {
    if (!this.shuttingDown) {
      this.shuttingDown = true;
      this.wakeRequested = false;
      this.claimAbortController?.abort(ClaimAbortReason);
      if (this.activeAttempt) {
        this.abortAttempt(this.activeAttempt, 'shutdown');
      }
    }
    await this.waitForIdle();
  }

  private async consumeAuthorization(input: {
    ownerId: number;
    authorizationToken: string;
    requestId: string | null;
  }): Promise<KnowledgeEnrichmentSummary> {
    let committedTransition: { requestId: string; queuedTransition: boolean } | null = null;
    const requestId = await this.options.authorizationStore.consume(
      input.authorizationToken,
      input.ownerId,
      context => {
        try {
          const transaction = this.options.db.transaction(() => {
            const snapshot = this.readAuthorizedTarget(
              context.documentId,
              context.documentVersionId,
            );
            this.assertAuthorizationContext(context, snapshot);
            const transition = input.requestId === null
              ? this.options.requestStore.createOrGetAuthorizedRequestInCurrentTransaction({
                  workspaceId: snapshot.workspaceId,
                  documentId: snapshot.documentId,
                  documentVersionId: snapshot.documentVersionId,
                  providerId: snapshot.route.providerId,
                  modelId: snapshot.route.modelId,
                  routingFingerprint: snapshot.route.routingFingerprint,
                  now: this.clock(),
                })
              : this.options.requestStore.retryFailedWithAuthorizationInCurrentTransaction({
                  requestId: input.requestId,
                  workspaceId: snapshot.workspaceId,
                  documentId: snapshot.documentId,
                  documentVersionId: snapshot.documentVersionId,
                  providerId: snapshot.route.providerId,
                  modelId: snapshot.route.modelId,
                  routingFingerprint: snapshot.route.routingFingerprint,
                  now: this.clock(),
                });
            this.assertAuthorizedTransition(context, transition.request, input.requestId);
            return {
              requestId: transition.request.id,
              queuedTransition: transition.queuedTransition,
            };
          });
          const transition = runTransientSqliteWriteTransaction(transaction);
          committedTransition = transition;
          return transition.requestId;
        } catch (error) {
          this.rethrowAuthorizationCallbackError(error);
        }
      },
    );
    let summary: KnowledgeEnrichmentSummary | null;
    try {
      summary = this.options.requestStore.getSummary(requestId);
    } catch {
      throw new KnowledgeExtractionAuthorizationError(
        KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
      );
    }
    if (!summary) {
      throw new KnowledgeExtractionAuthorizationError(
        KnowledgeBaseErrorCode.EnrichmentRequestNotFound,
      );
    }
    if (
      committedTransition?.requestId === requestId
      && committedTransition.queuedTransition
    ) {
      this.wake();
    }
    return summary;
  }

  private readAuthorizedTarget(
    documentId: string,
    documentVersionId: string,
  ): AuthorizedTargetSnapshot {
    const target = this.options.db.prepare(`
      SELECT
        document.id AS document_id,
        document.workspace_id,
        document.display_name,
        document.current_version_id,
        document.status AS document_status,
        document.deleted_at,
        version.id AS version_id,
        version.document_id AS version_document_id,
        version.extracted_text,
        index_state.status AS index_status,
        index_state.workspace_id AS index_workspace_id,
        index_state.document_id AS index_document_id,
        index_state.published_generation_id,
        index_state.chunk_count
      FROM knowledge_documents AS document
      LEFT JOIN knowledge_document_versions AS version ON version.id = ?
      LEFT JOIN knowledge_document_index_state AS index_state
        ON index_state.document_version_id = ?
      WHERE document.id = ?
      LIMIT 1
    `).get(documentVersionId, documentVersionId, documentId) as AuthorizedTargetRow | undefined;
    if (!target || target.deleted_at !== null) {
      throw new KnowledgeExtractionAuthorizationError(KnowledgeBaseErrorCode.DocumentNotFound);
    }
    if (
      target.current_version_id !== documentVersionId
      || target.document_status !== KnowledgeDocumentStatus.Ready
      || target.version_id !== documentVersionId
      || target.version_document_id !== target.document_id
      || (target.extracted_text ?? '').trim().length === 0
    ) {
      throw new KnowledgeExtractionAuthorizationError(KnowledgeBaseErrorCode.DocumentNotReady);
    }
    if (
      target.index_status !== KnowledgeDocumentIndexStatus.Indexed
      || target.index_workspace_id !== target.workspace_id
      || target.index_document_id !== target.document_id
      || !target.published_generation_id?.trim()
      || !Number.isSafeInteger(target.chunk_count)
      || target.chunk_count! < 1
    ) {
      throw new KnowledgeExtractionAuthorizationError(KnowledgeBaseErrorCode.LocalIndexNotReady);
    }
    const chunks = this.options.db.prepare(`
      SELECT
        id,
        index_generation_id,
        workspace_id,
        document_id,
        document_version_id,
        ordinal,
        content
      FROM knowledge_document_chunks
      WHERE document_version_id = ? AND index_generation_id = ?
      ORDER BY ordinal ASC
      LIMIT 31
    `).all(
      documentVersionId,
      target.published_generation_id,
    ) as AuthorizedChunkRow[];
    const expectedLoadedCount = Math.min(target.chunk_count!, 31);
    if (
      chunks.length !== expectedLoadedCount
      || chunks.some((chunk, ordinal) =>
        chunk.workspace_id !== target.workspace_id
        || chunk.document_id !== target.document_id
        || chunk.document_version_id !== target.version_id
        || chunk.index_generation_id !== target.published_generation_id
        || chunk.ordinal !== ordinal
        || typeof chunk.content !== 'string')
    ) {
      throw new KnowledgeExtractionAuthorizationError(KnowledgeBaseErrorCode.LocalIndexNotReady);
    }
    const source = this.loadRouteSource(target.workspace_id);
    const route = this.resolveRoute(target.workspace_id, source);
    return {
      workspaceId: target.workspace_id,
      documentId: target.document_id,
      documentVersionId: target.version_id,
      documentDisplayName: target.display_name,
      publishedGenerationId: target.published_generation_id,
      totalIndexedChunkCount: target.chunk_count!,
      plannedModelCalls: Math.min(target.chunk_count!, KNOWLEDGE_ENRICHMENT_MAX_CHUNKS),
      partial: target.chunk_count! > KNOWLEDGE_ENRICHMENT_MAX_CHUNKS,
      route,
    };
  }

  private assertAuthorizationContext(
    context: KnowledgeExtractionAuthorizationContext,
    snapshot: AuthorizedTargetSnapshot,
  ): void {
    if (
      context.workspaceId !== snapshot.workspaceId
      || context.documentId !== snapshot.documentId
      || context.documentVersionId !== snapshot.documentVersionId
      || context.documentDisplayName !== snapshot.documentDisplayName
    ) {
      throw new KnowledgeExtractionAuthorizationCallbackFailure(
        KnowledgeExtractionAuthorizationCallbackDisposition.InvalidateAuthorization,
        KnowledgeBaseErrorCode.DocumentNotReady,
      );
    }
    if (
      context.publishedGenerationId !== snapshot.publishedGenerationId
      || context.plannedModelCalls !== snapshot.plannedModelCalls
      || context.partial !== snapshot.partial
    ) {
      throw new KnowledgeExtractionAuthorizationCallbackFailure(
        KnowledgeExtractionAuthorizationCallbackDisposition.InvalidateAuthorization,
        KnowledgeBaseErrorCode.LocalIndexNotReady,
      );
    }
    if (
      context.lockedRoute.workspaceId !== snapshot.route.workspaceId
      || context.lockedRoute.providerId !== snapshot.route.providerId
      || context.lockedRoute.modelId !== snapshot.route.modelId
      || context.lockedRoute.routingFingerprint !== snapshot.route.routingFingerprint
    ) {
      throw new KnowledgeExtractionAuthorizationCallbackFailure(
        KnowledgeExtractionAuthorizationCallbackDisposition.InvalidateAuthorization,
        KnowledgeBaseErrorCode.ModelConfigurationChanged,
      );
    }
  }

  private assertAuthorizedTransition(
    context: KnowledgeExtractionAuthorizationContext,
    request: KnowledgeEnrichmentRequest,
    retryRequestId: string | null,
  ): void {
    if (
      request.workspaceId !== context.workspaceId
      || request.documentId !== context.documentId
      || request.documentVersionId !== context.documentVersionId
    ) {
      throw new KnowledgeExtractionAuthorizationCallbackFailure(
        KnowledgeExtractionAuthorizationCallbackDisposition.InvalidateAuthorization,
        retryRequestId === null
          ? KnowledgeBaseErrorCode.EnrichmentAlreadyActive
          : KnowledgeBaseErrorCode.EnrichmentRequestStale,
      );
    }
    if (!routesMatch(context.lockedRoute, request)) {
      throw new KnowledgeExtractionAuthorizationCallbackFailure(
        KnowledgeExtractionAuthorizationCallbackDisposition.InvalidateAuthorization,
        retryRequestId === null
          ? KnowledgeBaseErrorCode.EnrichmentAlreadyActive
          : KnowledgeBaseErrorCode.EnrichmentRequestStale,
      );
    }
    if (retryRequestId !== null && request.id !== retryRequestId) {
      throw new KnowledgeExtractionAuthorizationCallbackFailure(
        KnowledgeExtractionAuthorizationCallbackDisposition.InvalidateAuthorization,
        KnowledgeBaseErrorCode.EnrichmentAlreadyActive,
      );
    }
  }

  private rethrowAuthorizationCallbackError(error: unknown): never {
    if (error instanceof KnowledgeExtractionAuthorizationCallbackFailure) {
      throw error;
    }
    if (error instanceof KnowledgeExtractionAuthorizationError) {
      if (this.isAuthorizationInvalidationCode(error.code)) {
        throw new KnowledgeExtractionAuthorizationCallbackFailure(
          KnowledgeExtractionAuthorizationCallbackDisposition.InvalidateAuthorization,
          error.code,
        );
      }
      throw error;
    }
    if (error instanceof KnowledgeEnrichmentModelResolutionError) {
      throw new KnowledgeExtractionAuthorizationCallbackFailure(
        KnowledgeExtractionAuthorizationCallbackDisposition.InvalidateAuthorization,
        error.code,
      );
    }
    if (error instanceof KnowledgeEnrichmentRequestStateError) {
      const code = error.code === KnowledgeBaseErrorCode.JobStateConflict
        ? KnowledgeBaseErrorCode.EnrichmentRequestStale
        : error.code;
      if (this.isRequestInvalidationCode(code)) {
        throw new KnowledgeExtractionAuthorizationCallbackFailure(
          KnowledgeExtractionAuthorizationCallbackDisposition.InvalidateAuthorization,
          code,
        );
      }
    }
    if (isTransientSqliteBusyError(error)) {
      throw new KnowledgeExtractionAuthorizationCallbackFailure(
        KnowledgeExtractionAuthorizationCallbackDisposition.RetryablePersistenceFailure,
        KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
      );
    }
    throw error;
  }

  private isAuthorizationInvalidationCode(code: string): code is
    | typeof KnowledgeBaseErrorCode.WorkspaceNotFound
    | typeof KnowledgeBaseErrorCode.DocumentNotFound
    | typeof KnowledgeBaseErrorCode.DocumentNotReady
    | typeof KnowledgeBaseErrorCode.LocalIndexNotReady
    | typeof KnowledgeBaseErrorCode.ModelConfigurationUnavailable
    | typeof KnowledgeBaseErrorCode.ModelConfigurationChanged
    | typeof KnowledgeBaseErrorCode.UnsupportedModelProvider {
    return code === KnowledgeBaseErrorCode.WorkspaceNotFound
      || code === KnowledgeBaseErrorCode.DocumentNotFound
      || code === KnowledgeBaseErrorCode.DocumentNotReady
      || code === KnowledgeBaseErrorCode.LocalIndexNotReady
      || code === KnowledgeBaseErrorCode.ModelConfigurationUnavailable
      || code === KnowledgeBaseErrorCode.ModelConfigurationChanged
      || code === KnowledgeBaseErrorCode.UnsupportedModelProvider;
  }

  private isRequestInvalidationCode(code: string): code is
    | typeof KnowledgeBaseErrorCode.EnrichmentRequestNotFound
    | typeof KnowledgeBaseErrorCode.EnrichmentRequestStale
    | typeof KnowledgeBaseErrorCode.EnrichmentAlreadyActive {
    return code === KnowledgeBaseErrorCode.EnrichmentRequestNotFound
      || code === KnowledgeBaseErrorCode.EnrichmentRequestStale
      || code === KnowledgeBaseErrorCode.EnrichmentAlreadyActive;
  }

  private startDrain(): void {
    if (this.shuttingDown || this.drainPromise) return;
    const drain = Promise.resolve().then(() => this.drainSafely());
    let tracked!: Promise<void>;
    tracked = drain.finally(() => {
      if (this.drainPromise === tracked) {
        this.drainPromise = null;
      }
      if (!this.shuttingDown && this.wakeRequested && !this.drainPromise) {
        this.startDrain();
      }
    });
    this.drainPromise = tracked;
  }

  private async drainSafely(): Promise<void> {
    while (!this.shuttingDown) {
      this.wakeRequested = false;
      let claim: KnowledgeEnrichmentClaim | null;
      try {
        claim = await this.claimNextUntilAvailable();
      } catch (error) {
        if (this.shuttingDown || error === ClaimAbortReason) return;
        this.logFailure('unclaimed', 'unclaimed', KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
        return;
      }
      if (this.shuttingDown) return;
      if (!claim) {
        if (this.wakeRequested) continue;
        return;
      }
      await this.processClaim(claim);
    }
  }

  private async claimNextUntilAvailable(): Promise<KnowledgeEnrichmentClaim | null> {
    const controller = new AbortController();
    this.claimAbortController = controller;
    try {
      return await runTransientSqliteWriteTransactionUntilSuccess(
        () => {
          if (this.shuttingDown || controller.signal.aborted) throw ClaimAbortReason;
          return this.options.requestStore.claimNext(this.clock());
        },
        delayMs => this.runAbortableBusyDelay(delayMs, controller.signal),
      );
    } finally {
      if (this.claimAbortController === controller) {
        this.claimAbortController = null;
      }
    }
  }

  private async runAbortableBusyDelay(delayMs: number, signal: AbortSignal): Promise<void> {
    if (this.shuttingDown || signal.aborted) throw ClaimAbortReason;
    let removeAbortListener = (): void => undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = (): void => reject(ClaimAbortReason);
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    });
    try {
      await Promise.race([this.busyRetryDelay(delayMs, signal), aborted]);
      if (this.shuttingDown || signal.aborted) throw ClaimAbortReason;
    } finally {
      removeAbortListener();
    }
  }

  private async processClaim(claim: KnowledgeEnrichmentClaim): Promise<void> {
    const active: ActiveAttempt = {
      requestId: claim.request.id,
      attemptId: claim.attempt.id,
      workspaceId: claim.request.workspaceId,
      documentVersionId: claim.request.documentVersionId,
      controller: new AbortController(),
      abortKind: null,
    };
    this.activeAttempt = active;
    let heartbeatProgress = 0;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    try {
      const captured = this.readTransaction(() => this.captureClaimedSnapshot(claim));
      if (!captured) {
        this.abortAttempt(active, 'lost_lease');
        return;
      }
      heartbeatTimer = setInterval(() => {
        if (active.controller.signal.aborted) return;
        try {
          if (!this.options.requestStore.heartbeat(
            active.requestId,
            active.attemptId,
            heartbeatProgress,
            this.clock(),
          )) {
            this.abortAttempt(active, 'lost_lease');
          }
        } catch {
          this.abortAttempt(active, 'heartbeat_failure');
        }
      }, KNOWLEDGE_ENRICHMENT_HEARTBEAT_INTERVAL_MS);

      const responses: KnowledgeEnrichmentResponseValidationResult[] = [];
      for (let ordinal = 0; ordinal < captured.modelCallCount; ordinal += 1) {
        if (this.mustStop(active)) return;
        const call = this.readTransaction(() => this.revalidateModelCall(captured, ordinal));
        if (!call) {
          this.abortAttempt(active, 'lost_lease');
          return;
        }
        if (this.mustStop(active)) return;
        const prompt = buildKnowledgeEnrichmentPrompt(call.chunk);
        const text = await this.generateModelResponse(active, call.route, prompt);
        if (this.mustStop(active)) return;
        responses.push(validateKnowledgeEnrichmentResponse({
          responseText: text,
          chunk: call.chunk,
        }));
        heartbeatProgress = Math.min(
          99,
          Math.floor(((ordinal + 1) / captured.modelCallCount) * 100),
        );
        let heartbeatSucceeded: boolean;
        try {
          heartbeatSucceeded = this.options.requestStore.heartbeat(
            active.requestId,
            active.attemptId,
            heartbeatProgress,
            this.clock(),
          );
        } catch {
          throw new WorkerFailureError(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
        }
        if (!heartbeatSucceeded) {
          this.abortAttempt(active, 'lost_lease');
          return;
        }
      }
      const selection = selectKnowledgeEnrichmentCandidates({
        responses,
        totalIndexedChunkCount: captured.totalIndexedChunkCount,
      });
      if (!this.readTransaction(() => this.revalidateFinalPublication(captured))) {
        this.abortAttempt(active, 'lost_lease');
        return;
      }
      if (this.mustStop(active)) return;
      this.options.publicationStore.publishValidatedCandidates({
        requestId: active.requestId,
        attemptId: active.attemptId,
        expectedPublishedGenerationId: captured.publishedGenerationId,
        expectedIndexedChunkCount: captured.totalIndexedChunkCount,
        selection,
        now: this.clock(),
      });
    } catch (error) {
      await this.handleAttemptFailure(active, error);
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (this.activeAttempt === active) {
        this.activeAttempt = null;
      }
    }
  }

  private captureClaimedSnapshot(claim: KnowledgeEnrichmentClaim): ClaimedSnapshot | null {
    const lease = this.options.requestStore.getRunningLeaseInCurrentTransaction(
      claim.request.id,
      claim.attempt.id,
    );
    if (!lease || !this.sameClaim(lease, claim)) return null;
    const lifecycle = this.readLifecycle(claim.request.documentId, claim.request.documentVersionId);
    if (!this.lifecycleMatchesRequest(lifecycle, claim.request)) return null;
    return {
      requestId: claim.request.id,
      attemptId: claim.attempt.id,
      workspaceId: claim.request.workspaceId,
      documentId: claim.request.documentId,
      documentVersionId: claim.request.documentVersionId,
      publishedGenerationId: lifecycle.published_generation_id!,
      totalIndexedChunkCount: lifecycle.chunk_count!,
      modelCallCount: Math.min(lifecycle.chunk_count!, KNOWLEDGE_ENRICHMENT_MAX_CHUNKS),
    };
  }

  private revalidateModelCall(
    captured: ClaimedSnapshot,
    ordinal: number,
  ): { chunk: KnowledgeEnrichmentChunkInput; route: KnowledgeEnrichmentLockedRoute } | null {
    const lease = this.options.requestStore.getRunningLeaseInCurrentTransaction(
      captured.requestId,
      captured.attemptId,
    );
    if (!lease) return null;
    const row = this.options.db.prepare(`
      SELECT
        document.id AS document_id,
        document.workspace_id,
        document.current_version_id,
        document.status AS document_status,
        document.deleted_at,
        version.document_id AS version_document_id,
        version.extracted_text,
        index_state.status AS index_status,
        index_state.workspace_id AS index_workspace_id,
        index_state.document_id AS index_document_id,
        index_state.published_generation_id,
        index_state.chunk_count,
        chunk.id AS chunk_id,
        chunk.ordinal AS chunk_ordinal,
        chunk.content AS chunk_content
      FROM knowledge_documents AS document
      JOIN knowledge_document_versions AS version
        ON version.id = ? AND version.document_id = document.id
      LEFT JOIN knowledge_document_index_state AS index_state
        ON index_state.document_version_id = version.id
      LEFT JOIN knowledge_document_chunks AS chunk
        ON chunk.workspace_id = document.workspace_id
        AND chunk.document_id = document.id
        AND chunk.document_version_id = version.id
        AND chunk.index_generation_id = index_state.published_generation_id
        AND chunk.ordinal = ?
      WHERE document.id = ?
      LIMIT 1
    `).get(
      captured.documentVersionId,
      ordinal,
      captured.documentId,
    ) as ChunkRow | undefined;
    if (
      !this.lifecycleMatchesCaptured(row, captured)
      || typeof row.chunk_id !== 'string'
      || row.chunk_id.trim().length === 0
      || row.chunk_ordinal !== ordinal
      || typeof row.chunk_content !== 'string'
    ) {
      return null;
    }
    let chunk: KnowledgeEnrichmentChunkInput = {
      id: row.chunk_id,
      ordinal: row.chunk_ordinal,
      content: row.chunk_content,
    };
    if (this.options.publishedChunkReader) {
      const publishedChunk = this.options.publishedChunkReader
        .listPublishedChunks(captured.documentVersionId)[ordinal];
      if (
        !publishedChunk
        || publishedChunk.id !== row.chunk_id
        || publishedChunk.ordinal !== ordinal
        || publishedChunk.content !== row.chunk_content
        || publishedChunk.workspaceId !== captured.workspaceId
        || publishedChunk.documentId !== captured.documentId
        || publishedChunk.documentVersionId !== captured.documentVersionId
        || publishedChunk.indexGenerationId !== captured.publishedGenerationId
      ) {
        return null;
      }
      chunk = {
        id: publishedChunk.id,
        ordinal: publishedChunk.ordinal,
        content: publishedChunk.content,
      };
    }
    const source = this.loadRouteSource(captured.workspaceId);
    const route = this.resolveRoute(captured.workspaceId, source);
    if (!routesMatch(route, lease.request)) {
      throw new WorkerFailureError(KnowledgeBaseErrorCode.ModelConfigurationChanged);
    }
    return {
      chunk,
      route,
    };
  }

  private revalidateFinalPublication(captured: ClaimedSnapshot): boolean {
    const lease = this.options.requestStore.getRunningLeaseInCurrentTransaction(
      captured.requestId,
      captured.attemptId,
    );
    if (!lease) return false;
    const lifecycle = this.readLifecycle(captured.documentId, captured.documentVersionId);
    return this.lifecycleMatchesCaptured(lifecycle, captured);
  }

  private readLifecycle(documentId: string, documentVersionId: string): LifecycleRow | undefined {
    return this.options.db.prepare(`
      SELECT
        document.id AS document_id,
        document.workspace_id,
        document.current_version_id,
        document.status AS document_status,
        document.deleted_at,
        version.document_id AS version_document_id,
        version.extracted_text,
        index_state.status AS index_status,
        index_state.workspace_id AS index_workspace_id,
        index_state.document_id AS index_document_id,
        index_state.published_generation_id,
        index_state.chunk_count
      FROM knowledge_documents AS document
      JOIN knowledge_document_versions AS version
        ON version.id = ? AND version.document_id = document.id
      LEFT JOIN knowledge_document_index_state AS index_state
        ON index_state.document_version_id = version.id
      WHERE document.id = ?
      LIMIT 1
    `).get(documentVersionId, documentId) as LifecycleRow | undefined;
  }

  private lifecycleMatchesRequest(
    row: LifecycleRow | undefined,
    request: KnowledgeEnrichmentRequest,
  ): row is LifecycleRow & { published_generation_id: string; chunk_count: number } {
    return Boolean(
      row
      && row.document_id === request.documentId
      && row.workspace_id === request.workspaceId
      && row.current_version_id === request.documentVersionId
      && row.document_status === KnowledgeDocumentStatus.Ready
      && row.deleted_at === null
      && row.version_document_id === request.documentId
      && (row.extracted_text ?? '').trim().length > 0
      && row.index_status === KnowledgeDocumentIndexStatus.Indexed
      && row.index_workspace_id === request.workspaceId
      && row.index_document_id === request.documentId
      && typeof row.published_generation_id === 'string'
      && row.published_generation_id.trim().length > 0
      && Number.isSafeInteger(row.chunk_count)
      && row.chunk_count! > 0,
    );
  }

  private lifecycleMatchesCaptured(
    row: LifecycleRow | undefined,
    captured: ClaimedSnapshot,
  ): row is LifecycleRow & { published_generation_id: string; chunk_count: number } {
    return Boolean(
      row
      && row.document_id === captured.documentId
      && row.workspace_id === captured.workspaceId
      && row.current_version_id === captured.documentVersionId
      && row.document_status === KnowledgeDocumentStatus.Ready
      && row.deleted_at === null
      && row.version_document_id === captured.documentId
      && (row.extracted_text ?? '').trim().length > 0
      && row.index_status === KnowledgeDocumentIndexStatus.Indexed
      && row.index_workspace_id === captured.workspaceId
      && row.index_document_id === captured.documentId
      && row.published_generation_id === captured.publishedGenerationId
      && row.chunk_count === captured.totalIndexedChunkCount,
    );
  }

  private sameClaim(left: KnowledgeEnrichmentClaim, right: KnowledgeEnrichmentClaim): boolean {
    return left.request.id === right.request.id
      && left.request.activeAttemptId === right.attempt.id
      && left.attempt.id === right.attempt.id
      && left.attempt.requestId === right.request.id;
  }

  private async generateModelResponse(
    active: ActiveAttempt,
    route: KnowledgeEnrichmentLockedRoute,
    prompt: { prompt: string; systemPrompt: string },
  ): Promise<string> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let removeAbortListener = (): void => undefined;
    try {
      timeout = setTimeout(() => {
        this.abortAttempt(active, 'timeout');
      }, KNOWLEDGE_ENRICHMENT_MODEL_TIMEOUT_MS);
      const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = (): void => reject(new StopActiveAttemptError());
        if (active.controller.signal.aborted) {
          onAbort();
          return;
        }
        active.controller.signal.addEventListener('abort', onAbort, { once: true });
        removeAbortListener = () => {
          active.controller.signal.removeEventListener('abort', onAbort);
        };
      });
      const generation = this.options.modelClient.generate({
        prompt: prompt.prompt,
        systemPrompt: prompt.systemPrompt,
        apiConfig: route.apiConfig,
        model: route.modelId,
        temperature: 0,
        maxTokens: KNOWLEDGE_ENRICHMENT_MODEL_MAX_TOKENS,
        maxResponseBytes: KNOWLEDGE_ENRICHMENT_MODEL_MAX_RESPONSE_BYTES,
        signal: active.controller.signal,
        ...(route.providerId === ProviderName.DeepSeek ? {
          responseFormat: ModelGenerationResponseFormat.JsonObject,
          thinkingMode: ModelGenerationThinkingMode.Disabled,
        } : {}),
      });
      const { finishReason, text } = await Promise.race([generation, aborted]);
      if (active.controller.signal.aborted) {
        if (active.abortKind === 'timeout') {
          throw new WorkerFailureError(KnowledgeBaseErrorCode.ModelRequestTimeout);
        }
        if (active.abortKind === 'heartbeat_failure') {
          throw new WorkerFailureError(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
        }
        throw new StopActiveAttemptError();
      }
      if (finishReason === ModelGenerationFinishReason.Length) {
        throw new WorkerFailureError(KnowledgeBaseErrorCode.InvalidModelResponse);
      }
      return text;
    } catch (error) {
      if (active.controller.signal.aborted) {
        if (active.abortKind === 'timeout') {
          throw new WorkerFailureError(KnowledgeBaseErrorCode.ModelRequestTimeout);
        }
        if (active.abortKind === 'heartbeat_failure') {
          throw new WorkerFailureError(KnowledgeBaseErrorCode.EnrichmentPersistenceFailed);
        }
        throw new StopActiveAttemptError();
      }
      if (
        error instanceof WorkerFailureError
      ) {
        throw error;
      }
      if (
        error instanceof ModelResponseTooLargeError
        || error instanceof ModelResponseInvalidJsonError
        || error instanceof ModelResponseInvalidContentError
      ) {
        throw new WorkerFailureError(KnowledgeBaseErrorCode.InvalidModelResponse);
      }
      if (error instanceof ModelResponseReadError) {
        throw new WorkerFailureError(KnowledgeBaseErrorCode.ModelRequestFailed);
      }
      throw new WorkerFailureError(KnowledgeBaseErrorCode.ModelRequestFailed);
    } finally {
      if (timeout) clearTimeout(timeout);
      removeAbortListener();
    }
  }

  private async handleAttemptFailure(active: ActiveAttempt, error: unknown): Promise<void> {
    if (
      error instanceof KnowledgeEnrichmentPublicationError
      && error.code === KnowledgeBaseErrorCode.EnrichmentRequestStale
    ) {
      this.abortAttempt(active, 'lost_lease');
      return;
    }
    if (
      error instanceof StopActiveAttemptError
      || this.shuttingDown
      || active.abortKind === 'cancel'
      || active.abortKind === 'lifecycle'
      || active.abortKind === 'lost_lease'
      || active.abortKind === 'shutdown'
    ) {
      return;
    }
    const code = this.mapWorkerFailure(error);
    let ownsLease = false;
    try {
      ownsLease = this.readTransaction(() => Boolean(
        this.options.requestStore.getRunningLeaseInCurrentTransaction(
          active.requestId,
          active.attemptId,
        ),
      ));
    } catch {
      this.logFailure(
        active.requestId,
        active.attemptId,
        KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
      );
      return;
    }
    if (!ownsLease || this.shuttingDown) {
      this.abortAttempt(active, 'lost_lease');
      return;
    }
    try {
      if (!this.options.requestStore.failAttempt(
        active.requestId,
        active.attemptId,
        { code, now: this.clock() },
      )) {
        this.abortAttempt(active, 'lost_lease');
        return;
      }
      this.logFailure(active.requestId, active.attemptId, code);
    } catch {
      this.logFailure(
        active.requestId,
        active.attemptId,
        KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
      );
    }
  }

  private mapWorkerFailure(error: unknown): KnowledgeEnrichmentSafeFailureCode {
    if (error instanceof WorkerFailureError) return error.code;
    if (error instanceof KnowledgeEnrichmentValidationError) return error.code;
    if (error instanceof KnowledgeEnrichmentPublicationError) {
      if (
        error.code === KnowledgeBaseErrorCode.ModelConfigurationUnavailable
        || error.code === KnowledgeBaseErrorCode.ModelConfigurationChanged
        || error.code === KnowledgeBaseErrorCode.UnsupportedModelProvider
        || error.code === KnowledgeBaseErrorCode.EvidenceValidationFailed
      ) {
        return error.code;
      }
      if (error.code === KnowledgeBaseErrorCode.EnrichmentRequestStale) {
        return KnowledgeBaseErrorCode.EnrichmentPersistenceFailed;
      }
      return KnowledgeBaseErrorCode.EnrichmentPersistenceFailed;
    }
    if (error instanceof KnowledgeEnrichmentModelResolutionError) {
      if (error.code === KnowledgeBaseErrorCode.WorkspaceNotFound) {
        return KnowledgeBaseErrorCode.ModelConfigurationUnavailable;
      }
      return error.code;
    }
    return KnowledgeBaseErrorCode.EnrichmentPersistenceFailed;
  }

  private mustStop(active: ActiveAttempt): boolean {
    return this.shuttingDown || active.controller.signal.aborted;
  }

  private abortAttempt(active: ActiveAttempt, kind: ActiveAbortKind): void {
    if (
      active.abortKind === null
      || kind === 'cancel'
      || kind === 'lifecycle'
      || kind === 'shutdown'
    ) {
      active.abortKind = kind;
    }
    if (!active.controller.signal.aborted) {
      active.controller.abort();
    }
  }

  private loadRouteSource(workspaceId: string): KnowledgeEnrichmentWorkspaceRouteSource {
    let source: KnowledgeEnrichmentWorkspaceRouteSource | null;
    try {
      source = this.options.loadWorkspaceRouteSourceInCurrentTransaction(
        this.options.db,
        workspaceId,
      );
    } catch (error) {
      if (isSqliteError(error)) throw error;
      throw new KnowledgeEnrichmentModelResolutionError(
        KnowledgeBaseErrorCode.ModelConfigurationUnavailable,
        'The knowledge enrichment model configuration is unavailable.',
      );
    }
    if (!source) {
      throw new KnowledgeEnrichmentModelResolutionError(
        KnowledgeBaseErrorCode.WorkspaceNotFound,
        'The knowledge workspace was not found.',
      );
    }
    if (isThenable(source)) {
      throw new KnowledgeEnrichmentModelResolutionError(
        KnowledgeBaseErrorCode.ModelConfigurationUnavailable,
        'The knowledge enrichment model configuration is unavailable.',
      );
    }
    return source;
  }

  private resolveRoute(
    workspaceId: string,
    source: KnowledgeEnrichmentWorkspaceRouteSource,
  ): KnowledgeEnrichmentLockedRoute {
    try {
      return this.options.modelResolver.resolveRouteSource(workspaceId, source);
    } catch (error) {
      if (error instanceof KnowledgeEnrichmentModelResolutionError) throw error;
      throw new KnowledgeEnrichmentModelResolutionError(
        KnowledgeBaseErrorCode.ModelConfigurationUnavailable,
        'The knowledge enrichment model configuration is unavailable.',
      );
    }
  }

  private readTransaction<T>(read: () => T): T {
    const transaction = this.options.db.transaction(read);
    return transaction();
  }

  private rethrowPreparationError(error: unknown): never {
    if (error instanceof KnowledgeExtractionAuthorizationError) throw error;
    if (error instanceof KnowledgeEnrichmentModelResolutionError) {
      throw new KnowledgeExtractionAuthorizationError(error.code);
    }
    throw new KnowledgeExtractionAuthorizationError(
      KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
    );
  }

  private logFailure(
    requestId: string,
    attemptId: string,
    code: KnowledgeEnrichmentSafeFailureCode,
  ): void {
    if (this.options.logError) {
      this.options.logError({
        module: '[KnowledgeEnrichment]',
        requestId,
        attemptId,
        code,
      });
      return;
    }
    console.error('[KnowledgeEnrichment]', requestId, attemptId, code);
  }
}
