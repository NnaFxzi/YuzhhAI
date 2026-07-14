import { randomUUID } from 'node:crypto';

import {
  KNOWLEDGE_ENRICHMENT_MAX_CHUNKS,
  KNOWLEDGE_EXTRACTION_AUTHORIZATION_TTL_MS,
  type KnowledgeBaseErrorCode,
  KnowledgeBaseErrorCode as KnowledgeBaseErrorCodes,
} from '../../shared/knowledgeBase/constants';
import type {
  KnowledgeExtractionAuthorizationPreparation,
} from '../../shared/knowledgeBase/types';
import type { KnowledgeEnrichmentLockedRoute } from './knowledgeEnrichmentTypes';

export const KnowledgeExtractionAuthorizationCallbackDisposition = {
  RetryablePersistenceFailure: 'retryable_persistence_failure',
  InvalidateAuthorization: 'invalidate_authorization',
} as const;
export type KnowledgeExtractionAuthorizationCallbackDisposition =
  (typeof KnowledgeExtractionAuthorizationCallbackDisposition)[keyof typeof KnowledgeExtractionAuthorizationCallbackDisposition];

export type KnowledgeExtractionAuthorizationInvalidationCode =
  | typeof KnowledgeBaseErrorCodes.WorkspaceNotFound
  | typeof KnowledgeBaseErrorCodes.DocumentNotFound
  | typeof KnowledgeBaseErrorCodes.DocumentNotReady
  | typeof KnowledgeBaseErrorCodes.LocalIndexNotReady
  | typeof KnowledgeBaseErrorCodes.ModelConfigurationUnavailable
  | typeof KnowledgeBaseErrorCodes.ModelConfigurationChanged
  | typeof KnowledgeBaseErrorCodes.UnsupportedModelProvider
  | typeof KnowledgeBaseErrorCodes.EnrichmentRequestNotFound
  | typeof KnowledgeBaseErrorCodes.EnrichmentRequestStale
  | typeof KnowledgeBaseErrorCodes.EnrichmentAlreadyActive;

export type KnowledgeExtractionAuthorizationCallbackFailureCode =
  | KnowledgeExtractionAuthorizationInvalidationCode
  | typeof KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed;

const authorizationInvalidationCodes = new Set<KnowledgeBaseErrorCode>([
  KnowledgeBaseErrorCodes.WorkspaceNotFound,
  KnowledgeBaseErrorCodes.DocumentNotFound,
  KnowledgeBaseErrorCodes.DocumentNotReady,
  KnowledgeBaseErrorCodes.LocalIndexNotReady,
  KnowledgeBaseErrorCodes.ModelConfigurationUnavailable,
  KnowledgeBaseErrorCodes.ModelConfigurationChanged,
  KnowledgeBaseErrorCodes.UnsupportedModelProvider,
  KnowledgeBaseErrorCodes.EnrichmentRequestNotFound,
  KnowledgeBaseErrorCodes.EnrichmentRequestStale,
  KnowledgeBaseErrorCodes.EnrichmentAlreadyActive,
]);

export interface KnowledgeExtractionAuthorizationIssueInput {
  ownerId: number;
  workspaceId: string;
  documentId: string;
  documentVersionId: string;
  publishedGenerationId: string;
  documentDisplayName: string;
  lockedRoute: KnowledgeEnrichmentLockedRoute;
  plannedModelCalls: number;
  partial: boolean;
}

export interface KnowledgeExtractionAuthorizationContext {
  ownerId: number;
  workspaceId: string;
  documentId: string;
  documentVersionId: string;
  publishedGenerationId: string;
  documentDisplayName: string;
  lockedRoute: KnowledgeEnrichmentLockedRoute;
  plannedModelCalls: number;
  partial: boolean;
}

interface AuthorizationDescriptorEntry {
  ownerId: number;
  workspaceId: string;
  documentId: string;
  documentVersionId: string;
  publishedGenerationId: string;
  documentDisplayName: string;
  lockedRoute: KnowledgeEnrichmentLockedRoute;
  plannedModelCalls: number;
  partial: boolean;
  issuedAt: number;
  expiresAt: number;
  ownerGeneration: number;
  workspaceGeneration: number;
}

interface AuthorizationInFlightEntry {
  ownerId: number;
  workspaceId: string;
  expiresAt: number;
  ownerGeneration: number;
  workspaceGeneration: number;
  descriptor: AuthorizationDescriptorEntry;
  promise: Promise<string>;
}

interface AuthorizationReceiptEntry {
  requestId: string;
  ownerId: number;
  workspaceId: string;
  expiresAt: number;
  ownerGeneration: number;
  workspaceGeneration: number;
}

interface KnowledgeExtractionAuthorizationStoreOptions {
  now?: () => number;
  tokenGenerator?: () => string;
}

function safeAuthorizationMessage(code: KnowledgeBaseErrorCode): string {
  switch (code) {
    case KnowledgeBaseErrorCodes.InvalidRequest:
      return 'The extraction authorization request is invalid.';
    case KnowledgeBaseErrorCodes.ExpiredExtractionAuthorization:
      return 'The extraction authorization has expired.';
    case KnowledgeBaseErrorCodes.ConsumedExtractionAuthorization:
      return 'The extraction authorization was already consumed.';
    case KnowledgeBaseErrorCodes.ForeignExtractionAuthorizationOwner:
      return 'The extraction authorization belongs to a different owner.';
    case KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed:
      return 'The extraction request could not be persisted.';
    case KnowledgeBaseErrorCodes.InvalidExtractionAuthorization:
      return 'The extraction authorization is invalid.';
    default:
      return 'The knowledge authorization operation failed.';
  }
}

export class KnowledgeExtractionAuthorizationError extends Error {
  constructor(readonly code: KnowledgeBaseErrorCode) {
    super(safeAuthorizationMessage(code));
    this.name = 'KnowledgeExtractionAuthorizationError';
  }

  toJSON(): { code: KnowledgeBaseErrorCode; message: string } {
    return {
      code: this.code,
      message: this.message,
    };
  }
}

export class KnowledgeExtractionAuthorizationCallbackFailure extends Error {
  readonly disposition: KnowledgeExtractionAuthorizationCallbackDisposition;

  readonly code: KnowledgeExtractionAuthorizationCallbackFailureCode;

  constructor(
    disposition: KnowledgeExtractionAuthorizationCallbackDisposition,
    code: KnowledgeExtractionAuthorizationCallbackFailureCode,
  ) {
    super('The extraction authorization callback failed.');
    Object.defineProperty(this, 'name', {
      configurable: true,
      value: 'KnowledgeExtractionAuthorizationCallbackFailure',
    });
    const valid = disposition
      === KnowledgeExtractionAuthorizationCallbackDisposition.RetryablePersistenceFailure
      ? code === KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed
      : disposition === KnowledgeExtractionAuthorizationCallbackDisposition.InvalidateAuthorization
        && authorizationInvalidationCodes.has(code);
    if (!valid) {
      throw new TypeError('The extraction authorization callback failure is invalid.');
    }
    this.disposition = disposition;
    this.code = code;
    delete this.stack;
  }
}

function cloneLockedRoute(route: KnowledgeEnrichmentLockedRoute): KnowledgeEnrichmentLockedRoute {
  return {
    workspaceId: route.workspaceId,
    providerId: route.providerId,
    providerLabel: route.providerLabel,
    modelId: route.modelId,
    modelLabel: route.modelLabel,
    routingFingerprint: route.routingFingerprint,
    apiType: 'openai',
    apiConfig: {
      apiKey: route.apiConfig.apiKey,
      baseURL: route.apiConfig.baseURL,
      model: route.apiConfig.model,
      apiType: 'openai',
    },
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeRequiredString(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class KnowledgeExtractionAuthorizationStore {
  private readonly descriptors = new Map<string, AuthorizationDescriptorEntry>();

  private readonly inFlight = new Map<string, AuthorizationInFlightEntry>();

  private readonly receipts = new Map<string, AuthorizationReceiptEntry>();

  private readonly ownerGenerations = new Map<number, number>();

  private readonly workspaceGenerations = new Map<string, number>();

  private readonly now: () => number;

  private readonly tokenGenerator: () => string;

  constructor(options: KnowledgeExtractionAuthorizationStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.tokenGenerator = options.tokenGenerator ?? randomUUID;
  }

  issue(
    input: KnowledgeExtractionAuthorizationIssueInput,
  ): KnowledgeExtractionAuthorizationPreparation {
    const issuedAt = this.readNow();
    this.pruneExpired(issuedAt);
    const normalized = this.normalizeIssueInput(input);
    const expiresAt = issuedAt + KNOWLEDGE_EXTRACTION_AUTHORIZATION_TTL_MS;
    if (!Number.isSafeInteger(expiresAt)) {
      throw new KnowledgeExtractionAuthorizationError(KnowledgeBaseErrorCodes.InvalidRequest);
    }

    const generatedToken = this.tokenGenerator();
    const authorizationToken = typeof generatedToken === 'string' ? generatedToken.trim() : '';
    if (
      !authorizationToken
      || this.descriptors.has(authorizationToken)
      || this.inFlight.has(authorizationToken)
      || this.receipts.has(authorizationToken)
    ) {
      throw new KnowledgeExtractionAuthorizationError(KnowledgeBaseErrorCodes.InvalidRequest);
    }

    const entry: AuthorizationDescriptorEntry = {
      ...normalized,
      issuedAt,
      expiresAt,
      ownerGeneration: this.ownerGeneration(normalized.ownerId),
      workspaceGeneration: this.workspaceGeneration(normalized.workspaceId),
    };
    this.descriptors.set(authorizationToken, entry);

    return {
      authorizationToken,
      descriptor: {
        workspaceId: entry.workspaceId,
        documentId: entry.documentId,
        documentVersionId: entry.documentVersionId,
        documentDisplayName: entry.documentDisplayName,
        providerId: entry.lockedRoute.providerId,
        providerLabel: entry.lockedRoute.providerLabel,
        modelId: entry.lockedRoute.modelId,
        modelLabel: entry.lockedRoute.modelLabel,
        plannedModelCalls: entry.plannedModelCalls,
        partial: entry.partial,
        expiresAt: new Date(entry.expiresAt).toISOString(),
      },
    };
  }

  consume(
    authorizationToken: string,
    ownerId: number,
    createRequest: (
      context: KnowledgeExtractionAuthorizationContext,
    ) => string | Promise<string>,
  ): Promise<string> {
    try {
      return this.consumeValidated(authorizationToken, ownerId, createRequest);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  clearOwner(ownerId: number): void {
    if (!Number.isInteger(ownerId) || ownerId < 0) return;
    const now = this.readNow();
    this.pruneExpired(now);
    this.ownerGenerations.set(ownerId, this.ownerGeneration(ownerId) + 1);

    const affectedWorkspaces = new Set<string>();
    for (const [token, entry] of this.descriptors) {
      if (entry.ownerId !== ownerId) continue;
      affectedWorkspaces.add(entry.workspaceId);
      this.descriptors.delete(token);
    }
    for (const [token, entry] of this.receipts) {
      if (entry.ownerId !== ownerId) continue;
      affectedWorkspaces.add(entry.workspaceId);
      this.receipts.delete(token);
    }

    this.maybeReleaseOwnerGeneration(ownerId);
    for (const workspaceId of affectedWorkspaces) {
      this.maybeReleaseWorkspaceGeneration(workspaceId);
    }
  }

  clearWorkspace(workspaceId: string): void {
    const normalizedWorkspaceId = normalizeRequiredString(workspaceId);
    if (!normalizedWorkspaceId) {
      throw new KnowledgeExtractionAuthorizationError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    const now = this.readNow();
    this.pruneExpired(now);
    this.workspaceGenerations.set(
      normalizedWorkspaceId,
      this.workspaceGeneration(normalizedWorkspaceId) + 1,
    );

    const affectedOwners = new Set<number>();
    for (const [token, entry] of this.descriptors) {
      if (entry.workspaceId !== normalizedWorkspaceId) continue;
      affectedOwners.add(entry.ownerId);
      this.descriptors.delete(token);
    }
    for (const [token, entry] of this.receipts) {
      if (entry.workspaceId !== normalizedWorkspaceId) continue;
      affectedOwners.add(entry.ownerId);
      this.receipts.delete(token);
    }

    this.maybeReleaseWorkspaceGeneration(normalizedWorkspaceId);
    for (const ownerId of affectedOwners) {
      this.maybeReleaseOwnerGeneration(ownerId);
    }
  }

  private consumeValidated(
    authorizationToken: string,
    ownerId: number,
    createRequest: (
      context: KnowledgeExtractionAuthorizationContext,
    ) => string | Promise<string>,
  ): Promise<string> {
    if (
      typeof authorizationToken !== 'string'
      || !Number.isInteger(ownerId)
      || ownerId < 0
      || typeof createRequest !== 'function'
    ) {
      throw new KnowledgeExtractionAuthorizationError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    const normalizedToken = authorizationToken.trim();
    if (!normalizedToken) {
      throw new KnowledgeExtractionAuthorizationError(
        KnowledgeBaseErrorCodes.InvalidExtractionAuthorization,
      );
    }

    const now = this.readNow();
    this.pruneExpired(now, normalizedToken);

    const receipt = this.receipts.get(normalizedToken);
    if (receipt) {
      this.assertOwner(receipt.ownerId, ownerId);
      if (now >= receipt.expiresAt) {
        this.deleteIdleAuthorization(normalizedToken);
        throw new KnowledgeExtractionAuthorizationError(
          KnowledgeBaseErrorCodes.ExpiredExtractionAuthorization,
        );
      }
      if (!this.generationsMatch(receipt)) {
        this.deleteIdleAuthorization(normalizedToken);
        throw new KnowledgeExtractionAuthorizationError(
          KnowledgeBaseErrorCodes.InvalidExtractionAuthorization,
        );
      }
      return Promise.resolve(receipt.requestId);
    }

    const active = this.inFlight.get(normalizedToken);
    if (active) {
      this.assertOwner(active.ownerId, ownerId);
      if (now >= active.expiresAt) {
        throw new KnowledgeExtractionAuthorizationError(
          KnowledgeBaseErrorCodes.ExpiredExtractionAuthorization,
        );
      }
      if (!this.generationsMatch(active)) {
        throw new KnowledgeExtractionAuthorizationError(
          KnowledgeBaseErrorCodes.InvalidExtractionAuthorization,
        );
      }
      return active.promise;
    }

    const entry = this.descriptors.get(normalizedToken);
    if (!entry) {
      throw new KnowledgeExtractionAuthorizationError(
        KnowledgeBaseErrorCodes.InvalidExtractionAuthorization,
      );
    }
    this.assertOwner(entry.ownerId, ownerId);
    if (now >= entry.expiresAt) {
      this.deleteIdleAuthorization(normalizedToken);
      throw new KnowledgeExtractionAuthorizationError(
        KnowledgeBaseErrorCodes.ExpiredExtractionAuthorization,
      );
    }
    if (!this.generationsMatch(entry)) {
      this.deleteIdleAuthorization(normalizedToken);
      throw new KnowledgeExtractionAuthorizationError(
        KnowledgeBaseErrorCodes.InvalidExtractionAuthorization,
      );
    }

    const context = this.createCallbackContext(entry);
    let promise!: Promise<string>;
    promise = Promise.resolve()
      .then(() => {
        this.assertCallbackMayStart(normalizedToken, entry);
        let result: string | Promise<string>;
        try {
          result = createRequest(context);
        } catch (error) {
          return this.handleCallbackFailure(normalizedToken, entry, error);
        }
        if (typeof result === 'string') {
          return this.finalizeSuccessfulConsumption(normalizedToken, entry, result);
        }
        return Promise.resolve(result).then(
          requestId => this.finalizeSuccessfulConsumption(normalizedToken, entry, requestId),
          error => this.handleCallbackFailure(normalizedToken, entry, error),
        );
      })
      .finally(() => {
        const activeEntry = this.inFlight.get(normalizedToken);
        if (activeEntry?.promise === promise && activeEntry.descriptor === entry) {
          this.inFlight.delete(normalizedToken);
        }
        this.maybeReleaseOwnerGeneration(entry.ownerId);
        this.maybeReleaseWorkspaceGeneration(entry.workspaceId);
      });

    this.inFlight.set(normalizedToken, {
      ownerId: entry.ownerId,
      workspaceId: entry.workspaceId,
      expiresAt: entry.expiresAt,
      ownerGeneration: entry.ownerGeneration,
      workspaceGeneration: entry.workspaceGeneration,
      descriptor: entry,
      promise,
    });
    return promise;
  }

  private assertCallbackMayStart(token: string, entry: AuthorizationDescriptorEntry): void {
    const now = this.readNow();
    if (now >= entry.expiresAt) {
      this.deleteDescriptorIfOwned(token, entry);
      throw new KnowledgeExtractionAuthorizationError(
        KnowledgeBaseErrorCodes.ExpiredExtractionAuthorization,
      );
    }
    const active = this.inFlight.get(token);
    if (
      this.descriptors.get(token) !== entry
      || active?.descriptor !== entry
      || !this.generationsMatch(entry)
    ) {
      this.deleteDescriptorIfOwned(token, entry);
      throw new KnowledgeExtractionAuthorizationError(
        KnowledgeBaseErrorCodes.InvalidExtractionAuthorization,
      );
    }
  }

  private finalizeSuccessfulConsumption(
    token: string,
    entry: AuthorizationDescriptorEntry,
    requestId: string,
  ): string {
    if (this.descriptors.get(token) !== entry || !this.generationsMatch(entry)) {
      this.deleteDescriptorIfOwned(token, entry);
      throw new KnowledgeExtractionAuthorizationError(
        KnowledgeBaseErrorCodes.InvalidExtractionAuthorization,
      );
    }
    if (!isNonEmptyString(requestId)) {
      this.deleteDescriptorIfOwned(token, entry);
      throw new KnowledgeExtractionAuthorizationError(
        KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
      );
    }

    const normalizedRequestId = requestId.trim();
    this.descriptors.delete(token);
    this.receipts.set(token, {
      requestId: normalizedRequestId,
      ownerId: entry.ownerId,
      workspaceId: entry.workspaceId,
      expiresAt: entry.expiresAt,
      ownerGeneration: entry.ownerGeneration,
      workspaceGeneration: entry.workspaceGeneration,
    });
    return normalizedRequestId;
  }

  private handleCallbackFailure(
    token: string,
    entry: AuthorizationDescriptorEntry,
    error: unknown,
  ): never {
    const now = this.readNow();
    if (
      error instanceof KnowledgeExtractionAuthorizationCallbackFailure
      && error.disposition
        === KnowledgeExtractionAuthorizationCallbackDisposition.RetryablePersistenceFailure
    ) {
      if (now >= entry.expiresAt) {
        this.deleteDescriptorIfOwned(token, entry);
        throw new KnowledgeExtractionAuthorizationError(
          KnowledgeBaseErrorCodes.ExpiredExtractionAuthorization,
        );
      }
      if (this.descriptors.get(token) === entry && this.generationsMatch(entry)) {
        throw new KnowledgeExtractionAuthorizationError(
          KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
        );
      }
      this.deleteDescriptorIfOwned(token, entry);
      throw new KnowledgeExtractionAuthorizationError(
        KnowledgeBaseErrorCodes.InvalidExtractionAuthorization,
      );
    }

    this.deleteDescriptorIfOwned(token, entry);
    if (error instanceof KnowledgeExtractionAuthorizationCallbackFailure) {
      throw new KnowledgeExtractionAuthorizationError(error.code);
    }
    throw new KnowledgeExtractionAuthorizationError(
      KnowledgeBaseErrorCodes.EnrichmentPersistenceFailed,
    );
  }

  private createCallbackContext(
    entry: AuthorizationDescriptorEntry,
  ): KnowledgeExtractionAuthorizationContext {
    return {
      ownerId: entry.ownerId,
      workspaceId: entry.workspaceId,
      documentId: entry.documentId,
      documentVersionId: entry.documentVersionId,
      publishedGenerationId: entry.publishedGenerationId,
      documentDisplayName: entry.documentDisplayName,
      lockedRoute: cloneLockedRoute(entry.lockedRoute),
      plannedModelCalls: entry.plannedModelCalls,
      partial: entry.partial,
    };
  }

  private normalizeIssueInput(
    input: KnowledgeExtractionAuthorizationIssueInput,
  ): Omit<AuthorizationDescriptorEntry, 'issuedAt' | 'expiresAt' | 'ownerGeneration' | 'workspaceGeneration'> {
    if (!isRecord(input)) {
      throw new KnowledgeExtractionAuthorizationError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    const workspaceId = normalizeRequiredString(input.workspaceId);
    const documentId = normalizeRequiredString(input.documentId);
    const documentVersionId = normalizeRequiredString(input.documentVersionId);
    const publishedGenerationId = normalizeRequiredString(input.publishedGenerationId);
    const documentDisplayName = normalizeRequiredString(input.documentDisplayName);
    const route = input.lockedRoute as unknown;
    if (
      !Number.isInteger(input.ownerId)
      || input.ownerId < 0
      || !workspaceId
      || !documentId
      || !documentVersionId
      || !publishedGenerationId
      || !documentDisplayName
      || !isRecord(route)
      || !Number.isInteger(input.plannedModelCalls)
      || input.plannedModelCalls < 1
      || input.plannedModelCalls > KNOWLEDGE_ENRICHMENT_MAX_CHUNKS
      || typeof input.partial !== 'boolean'
    ) {
      throw new KnowledgeExtractionAuthorizationError(KnowledgeBaseErrorCodes.InvalidRequest);
    }

    const routeWorkspaceId = normalizeRequiredString(route.workspaceId);
    const providerId = normalizeRequiredString(route.providerId);
    const providerLabel = normalizeRequiredString(route.providerLabel);
    const modelId = normalizeRequiredString(route.modelId);
    const modelLabel = normalizeRequiredString(route.modelLabel);
    const routingFingerprint = normalizeRequiredString(route.routingFingerprint);
    const apiConfig = route.apiConfig;
    if (
      routeWorkspaceId !== workspaceId
      || !providerId
      || !providerLabel
      || !modelId
      || !modelLabel
      || !routingFingerprint
      || route.apiType !== 'openai'
      || !isRecord(apiConfig)
      || apiConfig.apiType !== 'openai'
      || typeof apiConfig.apiKey !== 'string'
      || !isNonEmptyString(apiConfig.baseURL)
      || normalizeRequiredString(apiConfig.model) !== modelId
    ) {
      throw new KnowledgeExtractionAuthorizationError(KnowledgeBaseErrorCodes.InvalidRequest);
    }

    return {
      ownerId: input.ownerId,
      workspaceId,
      documentId,
      documentVersionId,
      publishedGenerationId,
      documentDisplayName,
      lockedRoute: {
        workspaceId,
        providerId,
        providerLabel,
        modelId,
        modelLabel,
        routingFingerprint,
        apiType: 'openai',
        apiConfig: {
          apiKey: apiConfig.apiKey,
          baseURL: apiConfig.baseURL,
          model: modelId,
          apiType: 'openai',
        },
      },
      plannedModelCalls: input.plannedModelCalls,
      partial: input.partial,
    };
  }

  private assertOwner(expectedOwnerId: number, actualOwnerId: number): void {
    if (expectedOwnerId === actualOwnerId) return;
    throw new KnowledgeExtractionAuthorizationError(
      KnowledgeBaseErrorCodes.ForeignExtractionAuthorizationOwner,
    );
  }

  private generationsMatch(entry: {
    ownerId: number;
    workspaceId: string;
    ownerGeneration: number;
    workspaceGeneration: number;
  }): boolean {
    return entry.ownerGeneration === this.ownerGeneration(entry.ownerId)
      && entry.workspaceGeneration === this.workspaceGeneration(entry.workspaceId);
  }

  private ownerGeneration(ownerId: number): number {
    return this.ownerGenerations.get(ownerId) ?? 0;
  }

  private workspaceGeneration(workspaceId: string): number {
    return this.workspaceGenerations.get(workspaceId) ?? 0;
  }

  private deleteIdleAuthorization(token: string): void {
    if (this.inFlight.has(token)) return;
    const descriptor = this.descriptors.get(token);
    const receipt = this.receipts.get(token);
    this.descriptors.delete(token);
    this.receipts.delete(token);

    const ownerIds = new Set<number>();
    const workspaceIds = new Set<string>();
    for (const entry of [descriptor, receipt]) {
      if (!entry) continue;
      ownerIds.add(entry.ownerId);
      workspaceIds.add(entry.workspaceId);
    }
    for (const ownerId of ownerIds) this.maybeReleaseOwnerGeneration(ownerId);
    for (const workspaceId of workspaceIds) this.maybeReleaseWorkspaceGeneration(workspaceId);
  }

  private deleteDescriptorIfOwned(token: string, entry: AuthorizationDescriptorEntry): void {
    if (this.descriptors.get(token) !== entry) return;
    this.descriptors.delete(token);
    this.maybeReleaseOwnerGeneration(entry.ownerId);
    this.maybeReleaseWorkspaceGeneration(entry.workspaceId);
  }

  private pruneExpired(now: number, skipToken?: string): void {
    const expiredTokens = new Set<string>();
    for (const [token, entry] of this.descriptors) {
      if (
        token !== skipToken
        && !this.inFlight.has(token)
        && now >= entry.expiresAt
      ) {
        expiredTokens.add(token);
      }
    }
    for (const [token, entry] of this.receipts) {
      if (
        token !== skipToken
        && !this.inFlight.has(token)
        && now >= entry.expiresAt
      ) {
        expiredTokens.add(token);
      }
    }
    for (const token of expiredTokens) this.deleteIdleAuthorization(token);
  }

  private maybeReleaseOwnerGeneration(ownerId: number): void {
    if (!this.ownerGenerations.has(ownerId)) return;
    if ([...this.descriptors.values()].some(entry => entry.ownerId === ownerId)) return;
    if ([...this.receipts.values()].some(entry => entry.ownerId === ownerId)) return;
    if ([...this.inFlight.values()].some(entry => entry.ownerId === ownerId)) return;
    this.ownerGenerations.delete(ownerId);
  }

  private maybeReleaseWorkspaceGeneration(workspaceId: string): void {
    if (!this.workspaceGenerations.has(workspaceId)) return;
    if ([...this.descriptors.values()].some(entry => entry.workspaceId === workspaceId)) return;
    if ([...this.receipts.values()].some(entry => entry.workspaceId === workspaceId)) return;
    if ([...this.inFlight.values()].some(entry => entry.workspaceId === workspaceId)) return;
    this.workspaceGenerations.delete(workspaceId);
  }

  private readNow(): number {
    const now = this.now();
    if (!Number.isSafeInteger(now)) {
      throw new KnowledgeExtractionAuthorizationError(KnowledgeBaseErrorCodes.InvalidRequest);
    }
    return now;
  }
}
