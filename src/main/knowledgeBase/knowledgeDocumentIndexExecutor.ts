import { randomUUID } from 'node:crypto';
import { Worker, type WorkerOptions } from 'node:worker_threads';

import { KnowledgeDocumentIndexErrorCode } from '../../shared/knowledgeBase/constants';
import { runKnowledgeDocumentIndexUntilIdle } from './knowledgeDocumentIndexRunner';
import {
  isTransientSqliteBusyError,
  type KnowledgeDocumentIndexStore,
} from './knowledgeDocumentIndexStore';
import {
  type KnowledgeDocumentIndexRunResult,
  KnowledgeDocumentIndexWorkerMessage,
  type KnowledgeDocumentIndexWorkerRequest,
  type KnowledgeDocumentIndexWorkerResponse,
} from './knowledgeDocumentIndexTypes';

export interface KnowledgeDocumentIndexExecutor {
  runUntilIdle(): Promise<KnowledgeDocumentIndexRunResult>;
  shutdown(): Promise<void>;
}

export class KnowledgeDocumentIndexBusyError extends Error {
  constructor() {
    super('knowledge_document_index_busy');
    this.name = 'KnowledgeDocumentIndexBusyError';
  }
}

export class KnowledgeDocumentIndexUnavailableError extends Error {
  constructor() {
    super(KnowledgeDocumentIndexErrorCode.WorkerUnavailable);
    this.name = 'KnowledgeDocumentIndexUnavailableError';
  }
}

export class InlineKnowledgeDocumentIndexExecutor implements KnowledgeDocumentIndexExecutor {
  private closed = false;

  constructor(private readonly store: KnowledgeDocumentIndexStore) {}

  async runUntilIdle(): Promise<KnowledgeDocumentIndexRunResult> {
    if (this.closed) {
      throw new KnowledgeDocumentIndexUnavailableError();
    }
    try {
      return runKnowledgeDocumentIndexUntilIdle(this.store);
    } catch (error) {
      if (isTransientSqliteBusyError(error)) {
        throw new KnowledgeDocumentIndexBusyError();
      }
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.closed = true;
  }
}

type KnowledgeDocumentIndexWorkerFactory = (
  filename: string,
  options: WorkerOptions,
) => Worker;

interface WorkerKnowledgeDocumentIndexExecutorOptions {
  databasePath: string;
  workerScriptPath: string;
  workerFactory?: KnowledgeDocumentIndexWorkerFactory;
}

interface QueuedRun {
  requestId: string;
  settled: boolean;
  promise: Promise<KnowledgeDocumentIndexRunResult>;
  resolve: (result: KnowledgeDocumentIndexRunResult) => void;
  reject: (error: Error) => void;
}

interface StopWaiter {
  requestId: string;
  worker: Worker;
  resolve: () => void;
}

const WORKER_SHUTDOWN_TIMEOUT_MS = 5_000;

const createWorkerUnavailableError = (): Error =>
  new KnowledgeDocumentIndexUnavailableError();

const defaultWorkerFactory: KnowledgeDocumentIndexWorkerFactory = (filename, options) =>
  new Worker(filename, options);

export class WorkerKnowledgeDocumentIndexExecutor implements KnowledgeDocumentIndexExecutor {
  private worker: Worker | null = null;

  private readonly queuedRuns = new Set<QueuedRun>();

  private readonly pendingRuns = new Map<string, QueuedRun>();

  private runTail: Promise<void> = Promise.resolve();

  private stopWaiter: StopWaiter | null = null;

  private shutdownPromise: Promise<void> | null = null;

  private closed = false;

  constructor(private readonly options: WorkerKnowledgeDocumentIndexExecutorOptions) {}

  runUntilIdle(): Promise<KnowledgeDocumentIndexRunResult> {
    if (this.closed) {
      return Promise.reject(createWorkerUnavailableError());
    }

    const requestId = randomUUID();
    let resolve!: (result: KnowledgeDocumentIndexRunResult) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<KnowledgeDocumentIndexRunResult>((innerResolve, innerReject) => {
      resolve = innerResolve;
      reject = innerReject;
    });
    const run: QueuedRun = {
      requestId,
      settled: false,
      promise,
      resolve,
      reject,
    };
    this.queuedRuns.add(run);
    this.runTail = this.runTail.then(() => this.dispatchRun(run));
    return promise;
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }
    this.closed = true;
    this.shutdownPromise = this.shutdownWorker();
    return this.shutdownPromise;
  }

  private async dispatchRun(run: QueuedRun): Promise<void> {
    if (run.settled) {
      return;
    }
    if (this.closed) {
      this.rejectRun(run, createWorkerUnavailableError());
      return;
    }

    let worker: Worker | null = null;
    try {
      worker = this.ensureWorker();
      this.pendingRuns.set(run.requestId, run);
      const request: KnowledgeDocumentIndexWorkerRequest = {
        requestId: run.requestId,
        kind: KnowledgeDocumentIndexWorkerMessage.Run,
      };
      worker.postMessage(request);
    } catch {
      const failedWorker = worker ?? this.worker;
      if (failedWorker) {
        this.handleWorkerFailure(failedWorker);
      } else {
        this.rejectAllRuns(createWorkerUnavailableError());
      }
    }

    await run.promise.catch((): undefined => undefined);
  }

  private ensureWorker(): Worker {
    if (this.closed) {
      throw createWorkerUnavailableError();
    }
    if (this.worker) {
      return this.worker;
    }

    const factory = this.options.workerFactory ?? defaultWorkerFactory;
    const worker = factory(this.options.workerScriptPath, {
      workerData: { databasePath: this.options.databasePath },
    });
    this.worker = worker;
    worker.on('message', (response: KnowledgeDocumentIndexWorkerResponse) => {
      this.handleWorkerMessage(worker, response);
    });
    worker.on('error', () => {
      this.handleWorkerFailure(worker);
    });
    worker.on('exit', () => {
      this.handleWorkerExit(worker);
    });
    return worker;
  }

  private handleWorkerMessage(
    worker: Worker,
    response: KnowledgeDocumentIndexWorkerResponse,
  ): void {
    if (this.worker !== worker) {
      return;
    }
    if (response.kind === KnowledgeDocumentIndexWorkerMessage.Stopped) {
      if (
        this.stopWaiter?.worker === worker &&
        this.stopWaiter.requestId === response.requestId
      ) {
        const waiter = this.stopWaiter;
        this.stopWaiter = null;
        waiter.resolve();
      }
      return;
    }

    const run = this.pendingRuns.get(response.requestId);
    if (!run) {
      return;
    }
    if (response.kind === KnowledgeDocumentIndexWorkerMessage.Result) {
      this.resolveRun(run, response.result);
      return;
    }
    if (response.kind === KnowledgeDocumentIndexWorkerMessage.Busy) {
      this.rejectRun(run, new KnowledgeDocumentIndexBusyError());
    }
  }

  private handleWorkerFailure(worker: Worker): void {
    if (this.worker !== worker) {
      return;
    }
    this.worker = null;
    this.resolveStopWaiter(worker);
    this.rejectAllRuns(createWorkerUnavailableError());
  }

  private handleWorkerExit(worker: Worker): void {
    if (this.worker !== worker) {
      return;
    }
    this.worker = null;
    this.resolveStopWaiter(worker);
    if (!this.closed) {
      this.rejectAllRuns(createWorkerUnavailableError());
    }
  }

  private resolveRun(run: QueuedRun, result: KnowledgeDocumentIndexRunResult): void {
    if (run.settled) {
      return;
    }
    run.settled = true;
    this.pendingRuns.delete(run.requestId);
    this.queuedRuns.delete(run);
    run.resolve(result);
  }

  private rejectRun(run: QueuedRun, error: Error): void {
    if (run.settled) {
      return;
    }
    run.settled = true;
    this.pendingRuns.delete(run.requestId);
    this.queuedRuns.delete(run);
    run.reject(error);
  }

  private rejectAllRuns(error: Error): void {
    for (const run of [...this.queuedRuns]) {
      this.rejectRun(run, error);
    }
  }

  private resolveStopWaiter(worker: Worker): void {
    if (this.stopWaiter?.worker !== worker) {
      return;
    }
    const waiter = this.stopWaiter;
    this.stopWaiter = null;
    waiter.resolve();
  }

  private async shutdownWorker(): Promise<void> {
    this.rejectAllRuns(createWorkerUnavailableError());
    const worker = this.worker;
    if (!worker) {
      return;
    }

    const requestId = randomUUID();
    let resolveStopped!: () => void;
    const stopped = new Promise<void>(resolve => {
      resolveStopped = resolve;
    });
    this.stopWaiter = { requestId, worker, resolve: resolveStopped };
    try {
      const request: KnowledgeDocumentIndexWorkerRequest = {
        requestId,
        kind: KnowledgeDocumentIndexWorkerMessage.Shutdown,
      };
      worker.postMessage(request);
    } catch {
      this.resolveStopWaiter(worker);
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      stopped,
      new Promise<void>(resolve => {
        timeout = setTimeout(resolve, WORKER_SHUTDOWN_TIMEOUT_MS);
      }),
    ]);
    if (timeout) {
      clearTimeout(timeout);
    }
    this.resolveStopWaiter(worker);
    if (this.worker === worker) {
      this.worker = null;
    }
    await worker.terminate();
  }
}
