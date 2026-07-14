import { describe, expect, test, vi } from 'vitest';

import {
  KnowledgeDocumentIndexErrorCode,
} from '../../shared/knowledgeBase/constants';
import {
  KnowledgeDocumentIndexBusyError,
  type KnowledgeDocumentIndexExecutor,
  KnowledgeDocumentIndexUnavailableError,
} from './knowledgeDocumentIndexExecutor';
import {
  KnowledgeDocumentIndexService,
  KnowledgeDocumentIndexServiceLogCode,
  KnowledgeDocumentIndexServiceLogStage,
} from './knowledgeDocumentIndexService';
import type { KnowledgeDocumentIndexRunResult } from './knowledgeDocumentIndexTypes';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(innerResolve => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};

const waitForCondition = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for test condition');
    }
    await new Promise(resolve => setTimeout(resolve, 1));
  }
};

const createSensitiveFailure = (label: string): Error => Object.assign(
  new Error(`${label} SECRET SELECT * FROM private_table /private/company.pdf`),
  {
    stack: `${label} STACK SECRET /private/stack.ts:42`,
    cause: new Error(`${label} CAUSE SECRET api-key-value`),
  },
);

describe('KnowledgeDocumentIndexService', () => {
  test('coalesces repeated wake calls and shuts down its executor once', async () => {
    const run = deferred<KnowledgeDocumentIndexRunResult>();
    const executor = {
      runUntilIdle: vi.fn(() => run.promise),
      shutdown: vi.fn(async () => undefined),
    } satisfies KnowledgeDocumentIndexExecutor;
    const failRunnableStates = vi.fn(() => 0);
    const service = new KnowledgeDocumentIndexService(executor, { failRunnableStates });

    service.wake();
    service.wake();
    expect(executor.runUntilIdle).toHaveBeenCalledTimes(1);
    run.resolve({ indexedCount: 0, failedCount: 0 });
    await service.waitForIdle();
    await service.shutdown();
    expect(executor.shutdown).toHaveBeenCalledTimes(1);
  });

  test('converges a dedicated unavailable executor failure to durable retryable state', async () => {
    const executor = {
      runUntilIdle: vi.fn(async () => {
        throw new KnowledgeDocumentIndexUnavailableError();
      }),
      shutdown: vi.fn(async () => undefined),
    } satisfies KnowledgeDocumentIndexExecutor;
    const failRunnableStates = vi.fn(() => 2);
    const service = new KnowledgeDocumentIndexService(executor, { failRunnableStates });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    service.wake();
    await expect(service.waitForIdle()).resolves.toBeUndefined();

    expect(failRunnableStates).toHaveBeenCalledWith(
      KnowledgeDocumentIndexErrorCode.WorkerUnavailable,
    );
    errorLog.mockRestore();
  });

  test('does not replay a coalesced wake after an executor failure', async () => {
    let rejectRun!: (error: Error) => void;
    const run = new Promise<KnowledgeDocumentIndexRunResult>((_resolve, reject) => {
      rejectRun = reject;
    });
    const executor = {
      runUntilIdle: vi.fn(() => run),
      shutdown: vi.fn(async () => undefined),
    } satisfies KnowledgeDocumentIndexExecutor;
    const failRunnableStates = vi.fn(() => 1);
    const service = new KnowledgeDocumentIndexService(executor, { failRunnableStates });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      service.wake();
      service.wake();
      rejectRun(new KnowledgeDocumentIndexUnavailableError());
      await service.waitForIdle();

      expect(executor.runUntilIdle).toHaveBeenCalledTimes(1);
      expect(failRunnableStates).toHaveBeenCalledTimes(1);
    } finally {
      await service.shutdown();
      errorLog.mockRestore();
    }
  });

  test('contains durable failure persistence errors inside the drain', async () => {
    const executor = {
      runUntilIdle: vi.fn(async () => {
        throw new KnowledgeDocumentIndexUnavailableError();
      }),
      shutdown: vi.fn(async () => undefined),
    } satisfies KnowledgeDocumentIndexExecutor;
    const persistFailure = createSensitiveFailure('persist');
    const failRunnableStates = vi.fn(() => {
      throw persistFailure;
    });
    const service = new KnowledgeDocumentIndexService(executor, { failRunnableStates });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      service.wake();

      await expect(service.waitForIdle()).resolves.toBeUndefined();
      expect(failRunnableStates).toHaveBeenCalledWith(
        KnowledgeDocumentIndexErrorCode.WorkerUnavailable,
      );
      expect(executor.runUntilIdle).toHaveBeenCalledTimes(1);
      const serializedLogs = JSON.stringify(errorLog.mock.calls);
      expect(serializedLogs).not.toContain(persistFailure.message);
      expect(serializedLogs).not.toContain(persistFailure.stack);
      expect(serializedLogs).not.toContain('api-key-value');
      expect(serializedLogs).not.toContain('/private/company.pdf');
    } finally {
      await service.shutdown();
      errorLog.mockRestore();
    }
  });

  test('starts bounded executor shutdown before waiting for an active drain', async () => {
    const run = deferred<KnowledgeDocumentIndexRunResult>();
    const executor = {
      runUntilIdle: vi.fn(() => run.promise),
      shutdown: vi.fn(async () => {
        run.resolve({ indexedCount: 0, failedCount: 0 });
      }),
    } satisfies KnowledgeDocumentIndexExecutor;
    const service = new KnowledgeDocumentIndexService(executor, {
      failRunnableStates: vi.fn(() => 0),
    });
    service.wake();

    await service.shutdown();

    expect(executor.shutdown).toHaveBeenCalledTimes(1);
  });

  test('retries busy drains with injected capped exponential backoff without bulk failure', async () => {
    let runCount = 0;
    const executor = {
      runUntilIdle: vi.fn(async () => {
        runCount += 1;
        if (runCount <= 6) {
          throw new KnowledgeDocumentIndexBusyError();
        }
        return { indexedCount: 1, failedCount: 0 };
      }),
      shutdown: vi.fn(async () => undefined),
    } satisfies KnowledgeDocumentIndexExecutor;
    const failRunnableStates = vi.fn(() => 0);
    const delays: number[] = [];
    const service = new KnowledgeDocumentIndexService(
      executor,
      { failRunnableStates },
      {
        busyRetryDelay: async delayMs => {
          delays.push(delayMs);
        },
      },
    );

    service.wake();
    await service.waitForIdle();

    expect(executor.runUntilIdle).toHaveBeenCalledTimes(7);
    expect(delays).toEqual([25, 50, 100, 200, 250, 250]);
    expect(failRunnableStates).not.toHaveBeenCalled();
    await service.shutdown();
  });

  test('stops a pending busy retry after shutdown without bulk failure', async () => {
    const retryDelay = deferred<void>();
    const executor = {
      runUntilIdle: vi.fn(async () => {
        throw new KnowledgeDocumentIndexBusyError();
      }),
      shutdown: vi.fn(async () => undefined),
    } satisfies KnowledgeDocumentIndexExecutor;
    const failRunnableStates = vi.fn(() => 0);
    const busyRetryDelay = vi.fn(() => retryDelay.promise);
    const service = new KnowledgeDocumentIndexService(
      executor,
      { failRunnableStates },
      { busyRetryDelay },
    );

    service.wake();
    await waitForCondition(() => busyRetryDelay.mock.calls.length === 1);
    const shutdown = service.shutdown();
    retryDelay.resolve(undefined);
    await shutdown;

    expect(executor.runUntilIdle).toHaveBeenCalledTimes(1);
    expect(failRunnableStates).not.toHaveBeenCalled();
  });

  test('logs a generic executor failure and stops without bulk failure', async () => {
    const failure = createSensitiveFailure('drain');
    const executor = {
      runUntilIdle: vi.fn(async () => {
        throw failure;
      }),
      shutdown: vi.fn(async () => undefined),
    } satisfies KnowledgeDocumentIndexExecutor;
    const failRunnableStates = vi.fn(() => 0);
    const service = new KnowledgeDocumentIndexService(executor, { failRunnableStates });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      service.wake();
      await service.waitForIdle();

      expect(failRunnableStates).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledWith('[KnowledgeDocumentIndex]', {
        stage: KnowledgeDocumentIndexServiceLogStage.Drain,
        code: KnowledgeDocumentIndexServiceLogCode.DrainFailed,
      });
      const serializedLogs = JSON.stringify(errorLog.mock.calls);
      expect(serializedLogs).not.toContain(failure.message);
      expect(serializedLogs).not.toContain(failure.stack);
      expect(serializedLogs).not.toContain('api-key-value');
      expect(serializedLogs).not.toContain('/private/company.pdf');
    } finally {
      await service.shutdown();
      errorLog.mockRestore();
    }
  });

  test('shares one pending shutdown until executor and active drain both settle', async () => {
    const run = deferred<KnowledgeDocumentIndexRunResult>();
    const executorShutdown = deferred<void>();
    const executor = {
      runUntilIdle: vi.fn(() => run.promise),
      shutdown: vi.fn(() => executorShutdown.promise),
    } satisfies KnowledgeDocumentIndexExecutor;
    const service = new KnowledgeDocumentIndexService(executor, {
      failRunnableStates: vi.fn(() => 0),
    });
    service.wake();

    const firstShutdown = service.shutdown();
    const secondShutdown = service.shutdown();
    let firstSettled = false;
    let secondSettled = false;
    void firstShutdown.then(() => {
      firstSettled = true;
    });
    void secondShutdown.then(() => {
      secondSettled = true;
    });

    expect(firstShutdown).toBe(secondShutdown);
    await Promise.resolve();
    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);

    executorShutdown.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);

    run.resolve({ indexedCount: 0, failedCount: 0 });
    await expect(Promise.all([firstShutdown, secondShutdown])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(executor.shutdown).toHaveBeenCalledTimes(1);
    expect(firstSettled).toBe(true);
    expect(secondSettled).toBe(true);
  });
});
