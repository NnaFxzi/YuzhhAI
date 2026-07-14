import { buildEnterpriseLeadWorkspaceKnowledgeScopeId } from '../../shared/enterpriseLeadWorkspace/constants';
import type { EnterpriseLeadWorkspace } from '../../shared/enterpriseLeadWorkspace/types';
import { KnowledgeTrustedProfileIndexErrorCode } from '../../shared/knowledgeBase/constants';
import { buildEnterpriseTrustedKnowledgeSources } from '../enterpriseLeadWorkspace/trustedKnowledgeSources';
import type { ContentKnowledgeSource } from '../libs/contentKnowledgeRetrieval';
import { isTransientSqliteBusyError } from '../libs/sqliteTransactionRetry';
import type {
  KnowledgeTrustedProfileIndexClaim,
  KnowledgeTrustedProfileIndexStore,
} from './knowledgeTrustedProfileIndexStore';
import { KnowledgeTrustedProfileIndexRetryRequiredError } from './knowledgeTrustedProfileIndexStore';

type TrustedProfileIndexGateway = Pick<
  KnowledgeTrustedProfileIndexStore,
  | 'claimNext'
  | 'completeAttempt'
  | 'failAttempt'
  | 'getState'
  | 'reconcileAll'
  | 'recoverAbandonedRunning'
  | 'retryFailed'
>;

export interface KnowledgeTrustedProfileIndexLogEvent {
  module: '[KnowledgeTrustedProfileIndex]';
  workspaceId: string;
  jobId: string;
  attemptId: string;
  code: typeof KnowledgeTrustedProfileIndexErrorCode.RefreshFailed;
}

export interface KnowledgeTrustedProfileIndexServiceOptions {
  indexStore: TrustedProfileIndexGateway;
  loadWorkspace: (workspaceId: string) => EnterpriseLeadWorkspace | null;
  replaceTrustedSources: (
    scopeId: string,
    sources: ContentKnowledgeSource[],
  ) => unknown | Promise<unknown>;
  clock?: () => string;
  busyRetryDelay?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  logError?: (event: KnowledgeTrustedProfileIndexLogEvent) => void;
  autoStart?: boolean;
}

const ClaimAbortReason = Symbol('trusted-profile-index-claim-abort');
const TRANSIENT_BUSY_RETRY_BASE_DELAY_MS = 25;
const TRANSIENT_BUSY_RETRY_MAX_DELAY_MS = 250;

const defaultBusyRetryDelay = (
  delayMs: number,
  signal: AbortSignal,
): Promise<void> => new Promise((resolve, reject) => {
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

export class KnowledgeTrustedProfileIndexService {
  private readonly clock: () => string;

  private readonly busyRetryDelay: (
    delayMs: number,
    signal: AbortSignal,
  ) => Promise<void>;

  private drainPromise: Promise<void> | null = null;

  private databaseRetryAbortController: AbortController | null = null;

  private activeClaimWorkspaceId: string | null = null;

  private wakeRequested = false;

  private shuttingDown = false;

  private started = false;

  private shutdownPromise: Promise<void> | null = null;

  private readonly abortedWorkspaceIds = new Set<string>();

  constructor(private readonly options: KnowledgeTrustedProfileIndexServiceOptions) {
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.busyRetryDelay = options.busyRetryDelay ?? defaultBusyRetryDelay;
    if (options.autoStart !== false) {
      this.options.indexStore.recoverAbandonedRunning(this.clock());
      this.options.indexStore.reconcileAll(this.clock());
      this.startAfterRecovery();
    }
  }

  startAfterRecovery(): void {
    if (this.started || this.shuttingDown) return;
    this.started = true;
    this.wake();
  }

  wake(): void {
    if (this.shuttingDown || !this.started) return;
    this.wakeRequested = true;
    if (!this.drainPromise) this.startDrain();
  }

  async waitForIdle(): Promise<void> {
    while (this.drainPromise) {
      const current = this.drainPromise;
      await current;
    }
  }

  retryFailed(): number {
    if (this.shuttingDown || !this.started) return 0;
    const retriedCount = this.options.indexStore.retryFailed(this.clock());
    if (retriedCount > 0) this.wake();
    return retriedCount;
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    this.wakeRequested = false;
    this.databaseRetryAbortController?.abort(ClaimAbortReason);
    this.shutdownPromise = this.waitForIdle();
    return this.shutdownPromise;
  }

  abortActiveAttemptForWorkspace(workspaceId: string): void {
    const normalizedWorkspaceId = workspaceId.trim();
    if (this.activeClaimWorkspaceId !== normalizedWorkspaceId) return;
    this.abortedWorkspaceIds.add(normalizedWorkspaceId);
    this.databaseRetryAbortController?.abort(ClaimAbortReason);
  }

  private startDrain(): void {
    if (this.shuttingDown || this.drainPromise) return;
    const drain = Promise.resolve().then(() => this.drainSafely());
    let tracked!: Promise<void>;
    tracked = drain.finally(() => {
      if (this.drainPromise === tracked) this.drainPromise = null;
      if (!this.shuttingDown && this.wakeRequested && !this.drainPromise) {
        this.startDrain();
      }
    });
    this.drainPromise = tracked;
  }

  private async drainSafely(): Promise<void> {
    while (!this.shuttingDown) {
      this.wakeRequested = false;
      let claim: KnowledgeTrustedProfileIndexClaim | null;
      try {
        claim = await this.claimNextUntilAvailable();
      } catch (error) {
        if (this.shuttingDown || error === ClaimAbortReason) return;
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

  private async claimNextUntilAvailable(): Promise<KnowledgeTrustedProfileIndexClaim | null> {
    return this.runTransientOperationUntilSuccess(() => {
      if (this.shuttingDown) throw ClaimAbortReason;
      return this.options.indexStore.claimNext(this.clock());
    });
  }

  private async runBusyDelay(delayMs: number, signal: AbortSignal): Promise<void> {
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

  private async runTransientOperationUntilSuccess<T>(operation: () => T | Promise<T>): Promise<T> {
    let retryRound = 0;
    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (
          !isTransientSqliteBusyError(error)
          && !(error instanceof KnowledgeTrustedProfileIndexRetryRequiredError)
        ) {
          throw error;
        }
        const controller = new AbortController();
        this.databaseRetryAbortController = controller;
        const delayMs = Math.min(
          TRANSIENT_BUSY_RETRY_MAX_DELAY_MS,
          TRANSIENT_BUSY_RETRY_BASE_DELAY_MS * (2 ** retryRound),
        );
        retryRound += 1;
        try {
          await this.runBusyDelay(delayMs, controller.signal);
        } finally {
          if (this.databaseRetryAbortController === controller) {
            this.databaseRetryAbortController = null;
          }
        }
      }
    }
  }

  private async processClaim(claim: KnowledgeTrustedProfileIndexClaim): Promise<void> {
    this.activeClaimWorkspaceId = claim.job.workspaceId;
    try {
      const workspace = this.options.loadWorkspace(claim.job.workspaceId);
      if (!workspace) throw new Error('trusted profile workspace unavailable');
      const { id: workspaceId, profile, profileRevision } = workspace;
      const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId);
      if (
        workspaceId !== claim.job.workspaceId
        || scopeId !== claim.job.scopeId
        || claim.job.profileRevision > profileRevision
      ) {
        throw new Error('trusted profile refresh claim invalid');
      }
      const state = this.options.indexStore.getState(workspaceId);
      if (
        state
        && (state.scopeId !== scopeId || state.indexedProfileRevision > profileRevision)
      ) {
        throw new Error('trusted profile index state invalid');
      }
      if (state && state.indexedProfileRevision >= claim.job.profileRevision) {
        await this.runTransientOperationUntilSuccess(
          () => this.options.indexStore.completeAttempt(
            claim.job.id,
            claim.attempt.id,
            this.clock(),
          ),
        );
        return;
      }

      const sources = buildEnterpriseTrustedKnowledgeSources({ workspaceId, profile });
      await this.runTransientOperationUntilSuccess(
        () => this.options.replaceTrustedSources(scopeId, sources),
      );
      if (this.abortedWorkspaceIds.has(workspaceId)) return;
      await this.runTransientOperationUntilSuccess(
        () => this.options.indexStore.completeAttempt(
          claim.job.id,
          claim.attempt.id,
          this.clock(),
        ),
      );
    } catch (error) {
      if (this.shuttingDown || error === ClaimAbortReason) return;
      await this.failClaim(claim);
    } finally {
      if (this.activeClaimWorkspaceId === claim.job.workspaceId) {
        this.abortedWorkspaceIds.delete(claim.job.workspaceId);
        this.activeClaimWorkspaceId = null;
      }
    }
  }

  private async failClaim(claim: KnowledgeTrustedProfileIndexClaim): Promise<void> {
    let failed = false;
    try {
      failed = await this.runTransientOperationUntilSuccess(
        () => this.options.indexStore.failAttempt(
          claim.job.id,
          claim.attempt.id,
          this.clock(),
        ),
      );
    } catch {
      return;
    }
    if (!failed) return;
    const event: KnowledgeTrustedProfileIndexLogEvent = {
      module: '[KnowledgeTrustedProfileIndex]',
      workspaceId: claim.job.workspaceId,
      jobId: claim.job.id,
      attemptId: claim.attempt.id,
      code: KnowledgeTrustedProfileIndexErrorCode.RefreshFailed,
    };
    try {
      if (this.options.logError) {
        this.options.logError(event);
        return;
      }
      console.error(
        event.module,
        `workspace=${event.workspaceId}`,
        `job=${event.jobId}`,
        `attempt=${event.attemptId}`,
        `code=${event.code}`,
      );
    } catch {
      return;
    }
  }
}
