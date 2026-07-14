import { KnowledgeDocumentIndexErrorCode } from '../../shared/knowledgeBase/constants';
import {
  KnowledgeDocumentIndexBusyError,
  type KnowledgeDocumentIndexExecutor,
  KnowledgeDocumentIndexUnavailableError,
} from './knowledgeDocumentIndexExecutor';
import type { KnowledgeDocumentIndexStore } from './knowledgeDocumentIndexStore';

interface KnowledgeDocumentIndexServiceOptions {
  busyRetryDelay?: (delayMs: number) => Promise<void>;
}

const KNOWLEDGE_INDEX_BUSY_RETRY_BASE_DELAY_MS = 25;
const KNOWLEDGE_INDEX_BUSY_RETRY_MAX_DELAY_MS = 250;

export const KnowledgeDocumentIndexServiceLogStage = {
  Drain: 'drain',
  FailRunnableStates: 'fail_runnable_states',
} as const;

export const KnowledgeDocumentIndexServiceLogCode = {
  DrainFailed: 'index_worker_drain_failed',
  StatePersistenceFailed: 'index_worker_state_persistence_failed',
  WorkerUnavailable: KnowledgeDocumentIndexErrorCode.WorkerUnavailable,
} as const;

const defaultBusyRetryDelay = (delayMs: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, delayMs));

export class KnowledgeDocumentIndexService {
  private drainPromise: Promise<void> | null = null;

  private wakeRequested = false;

  private closed = false;

  private shutdownPromise: Promise<void> | null = null;

  constructor(
    private readonly executor: KnowledgeDocumentIndexExecutor,
    private readonly indexStore: Pick<KnowledgeDocumentIndexStore, 'failRunnableStates'>,
    private readonly options: KnowledgeDocumentIndexServiceOptions = {},
  ) {}

  wake(): void {
    if (this.closed) return;
    this.wakeRequested = true;
    if (this.drainPromise) return;
    const running = this.drain();
    let tracked!: Promise<void>;
    tracked = running.finally(() => {
      if (this.drainPromise !== tracked) return;
      this.drainPromise = null;
      if (this.wakeRequested && !this.closed) this.wake();
    });
    this.drainPromise = tracked;
  }

  async waitForIdle(): Promise<void> {
    while (this.drainPromise) await this.drainPromise;
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.closed = true;
    this.wakeRequested = false;
    const activeDrain = this.drainPromise;
    this.shutdownPromise = this.performShutdown(activeDrain);
    return this.shutdownPromise;
  }

  private async performShutdown(activeDrain: Promise<void> | null): Promise<void> {
    let shutdownError: unknown;
    try {
      await this.executor.shutdown();
    } catch (error) {
      shutdownError = error;
    }
    await activeDrain?.catch((): undefined => undefined);
    if (shutdownError) throw shutdownError;
  }

  private async drain(): Promise<void> {
    let busyRetryCount = 0;
    while (!this.closed) {
      this.wakeRequested = false;
      try {
        await this.executor.runUntilIdle();
      } catch (error) {
        this.wakeRequested = false;
        if (error instanceof KnowledgeDocumentIndexBusyError) {
          const delayMs = Math.min(
            KNOWLEDGE_INDEX_BUSY_RETRY_MAX_DELAY_MS,
            KNOWLEDGE_INDEX_BUSY_RETRY_BASE_DELAY_MS * (2 ** busyRetryCount),
          );
          busyRetryCount += 1;
          await (this.options.busyRetryDelay ?? defaultBusyRetryDelay)(delayMs);
          if (this.closed) return;
          continue;
        }
        if (!this.closed && error instanceof KnowledgeDocumentIndexUnavailableError) {
          try {
            this.indexStore.failRunnableStates(
              KnowledgeDocumentIndexErrorCode.WorkerUnavailable,
            );
          } catch {
            console.error(
              '[KnowledgeDocumentIndex]',
              {
                stage: KnowledgeDocumentIndexServiceLogStage.FailRunnableStates,
                code: KnowledgeDocumentIndexServiceLogCode.StatePersistenceFailed,
              },
            );
          }
          console.error('[KnowledgeDocumentIndex]', {
            stage: KnowledgeDocumentIndexServiceLogStage.Drain,
            code: KnowledgeDocumentIndexServiceLogCode.WorkerUnavailable,
          });
        } else if (!this.closed) {
          console.error('[KnowledgeDocumentIndex]', {
            stage: KnowledgeDocumentIndexServiceLogStage.Drain,
            code: KnowledgeDocumentIndexServiceLogCode.DrainFailed,
          });
        }
        return;
      }
      busyRetryCount = 0;
      if (!this.wakeRequested) return;
    }
  }
}
