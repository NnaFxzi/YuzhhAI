import { describe, expect, test, vi } from 'vitest';

import {
  KNOWLEDGE_CHUNK_OVERLAP_CHARS,
  KNOWLEDGE_CHUNK_TARGET_CHARS,
  KnowledgeDocumentIndexAttemptOutcome,
  KnowledgeDocumentIndexErrorCode,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentIndexTokenizer,
} from '../../shared/knowledgeBase/constants';
import {
  KnowledgeDocumentIndexRunnerLogCode,
  KnowledgeDocumentIndexRunnerLogStage,
  runKnowledgeDocumentIndexUntilIdle,
} from './knowledgeDocumentIndexRunner';
import type { KnowledgeDocumentIndexStore } from './knowledgeDocumentIndexStore';
import type { KnowledgeDocumentIndexClaim } from './knowledgeDocumentIndexTypes';

const createClaim = (
  extractedText = 'runner searchable text',
): KnowledgeDocumentIndexClaim => ({
  state: {
    documentVersionId: 'version-a',
    workspaceId: 'workspace-a',
    documentId: 'document-a',
    status: KnowledgeDocumentIndexStatus.Indexing,
    tokenizerVersion: KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    chunkCount: 0,
    attemptCount: 1,
    activeAttemptId: 'attempt-a',
    publishedGenerationId: null,
    errorCode: null,
    requestedAt: '2026-07-12T00:00:00.000Z',
    startedAt: '2026-07-12T00:00:00.000Z',
    heartbeatAt: '2026-07-12T00:00:00.000Z',
    completedAt: null,
    updatedAt: '2026-07-12T00:00:00.000Z',
  },
  attempt: {
    id: 'attempt-a',
    documentVersionId: 'version-a',
    attemptNumber: 1,
    tokenizerVersion: KnowledgeDocumentIndexTokenizer.CjkBigramV1,
    startedAt: '2026-07-12T00:00:00.000Z',
    finishedAt: null,
    outcome: KnowledgeDocumentIndexAttemptOutcome.Running,
    errorCode: null,
  },
  extractedText,
});

const createRunnerStore = (overrides: Record<string, unknown> = {}) => ({
  recoverAbandonedIndexing: vi.fn(() => 0),
  purgeInactiveGenerationBatch: vi.fn(() => 0),
  claimNext: vi.fn(() => null),
  heartbeat: vi.fn(() => true),
  stageVersionBatch: vi.fn(() => 1),
  publishVersion: vi.fn(),
  failAttempt: vi.fn(),
  ...overrides,
}) as unknown as KnowledgeDocumentIndexStore;

const createSensitiveFailure = (label: string): Error => Object.assign(
  new Error(`${label} SECRET SELECT * FROM private_table /private/company.pdf`),
  {
    stack: `${label} STACK SECRET /private/stack.ts:42`,
    cause: new Error(`${label} CAUSE SECRET api-key-value`),
  },
);

describe('runKnowledgeDocumentIndexUntilIdle', () => {
  test('recovers any previous lease one millisecond past the captured drain time before cleanup', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'));
    const store = createRunnerStore();

    try {
      expect(runKnowledgeDocumentIndexUntilIdle(store)).toEqual({
        indexedCount: 0,
        failedCount: 0,
      });
      expect(store.recoverAbandonedIndexing).toHaveBeenCalledWith(
        '2026-07-12T00:00:00.001Z',
        '2026-07-12T00:00:00.000Z',
      );
      expect(
        vi.mocked(store.recoverAbandonedIndexing).mock.invocationCallOrder[0],
      ).toBeLessThan(
        vi.mocked(store.purgeInactiveGenerationBatch).mock.invocationCallOrder[0],
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test('runs the cleanup fairness hook immediately after every successful startup purge batch but not the terminal zero', () => {
    const events: string[] = [];
    const purgeInactiveGenerationBatch = vi.fn()
      .mockImplementationOnce(() => {
        events.push('purge:2');
        return 2;
      })
      .mockImplementationOnce(() => {
        events.push('purge:1');
        return 1;
      })
      .mockImplementationOnce(() => {
        events.push('purge:0');
        return 0;
      });
    const store = createRunnerStore({
      purgeInactiveGenerationBatch,
    });

    expect(runKnowledgeDocumentIndexUntilIdle(store, {
      afterSuccessfulCleanupBatch: () => {
        events.push('cleanup-yield');
      },
    })).toEqual({
      indexedCount: 0,
      failedCount: 0,
    });
    expect(events).toEqual([
      'purge:2',
      'cleanup-yield',
      'purge:1',
      'cleanup-yield',
      'purge:0',
    ]);
    expect(purgeInactiveGenerationBatch).toHaveBeenNthCalledWith(1, 64);
    expect(purgeInactiveGenerationBatch).toHaveBeenNthCalledWith(2, 64);
    expect(purgeInactiveGenerationBatch).toHaveBeenNthCalledWith(3, 64);
  });

  test('runs the cleanup fairness hook after every post-document purge batch before claiming the next document', () => {
    const events: string[] = [];
    const claim = createClaim();
    const purgeInactiveGenerationBatch = vi.fn()
      .mockImplementationOnce(() => {
        events.push('purge:0');
        return 0;
      })
      .mockImplementationOnce(() => {
        events.push('purge:2');
        return 2;
      })
      .mockImplementationOnce(() => {
        events.push('purge:1');
        return 1;
      })
      .mockImplementationOnce(() => {
        events.push('purge:0');
        return 0;
      });
    const store = createRunnerStore({
      purgeInactiveGenerationBatch,
      claimNext: vi.fn()
        .mockImplementationOnce(() => {
          events.push('claim:document');
          return claim;
        })
        .mockImplementationOnce(() => {
          events.push('claim:none');
          return null;
        }),
      stageVersionBatch: vi.fn(() => {
        events.push('stage:1');
        return 1;
      }),
      publishVersion: vi.fn(() => {
        events.push('publish');
      }),
    });

    expect(runKnowledgeDocumentIndexUntilIdle(store, {
      afterSuccessfulWriteBatch: () => {
        events.push('write-yield');
      },
      afterSuccessfulCleanupBatch: () => {
        events.push('cleanup-yield');
      },
    })).toEqual({
      indexedCount: 1,
      failedCount: 0,
    });
    expect(events).toEqual([
      'purge:0',
      'claim:document',
      'stage:1',
      'write-yield',
      'publish',
      'purge:2',
      'cleanup-yield',
      'purge:1',
      'cleanup-yield',
      'purge:0',
      'claim:none',
    ]);
    expect(purgeInactiveGenerationBatch).toHaveBeenCalledTimes(4);
    purgeInactiveGenerationBatch.mock.calls.forEach(call => {
      expect(call).toEqual([64]);
    });
  });

  test('does not run the cleanup fairness hook when startup purge throws SQLite busy', () => {
    const busy = Object.assign(new Error('database is locked'), {
      code: 'SQLITE_BUSY',
    });
    const afterSuccessfulCleanupBatch = vi.fn();
    const store = createRunnerStore({
      purgeInactiveGenerationBatch: vi.fn(() => {
        throw busy;
      }),
    });

    expect(() => runKnowledgeDocumentIndexUntilIdle(store, {
      afterSuccessfulCleanupBatch,
    })).toThrow(busy);
    expect(afterSuccessfulCleanupBatch).not.toHaveBeenCalled();
  });

  test('yields after every successful eight-chunk write batch before continuing or publishing', () => {
    const seventeenChunkTextLength = KNOWLEDGE_CHUNK_TARGET_CHARS
      + (16 * (KNOWLEDGE_CHUNK_TARGET_CHARS - KNOWLEDGE_CHUNK_OVERLAP_CHARS));
    const claim = createClaim('x'.repeat(seventeenChunkTextLength));
    const events: string[] = [];
    const store = createRunnerStore({
      claimNext: vi.fn()
        .mockReturnValueOnce(claim)
        .mockReturnValueOnce(null),
      stageVersionBatch: vi.fn((input: { chunks: unknown[] }) => {
        events.push(`stage:${input.chunks.length}`);
        return input.chunks.length;
      }),
      publishVersion: vi.fn(() => {
        events.push('publish');
      }),
    });

    expect(runKnowledgeDocumentIndexUntilIdle(store, {
      afterSuccessfulWriteBatch: () => {
        events.push('yield');
      },
    })).toEqual({
      indexedCount: 1,
      failedCount: 0,
    });
    expect(events).toEqual([
      'stage:8',
      'yield',
      'stage:8',
      'yield',
      'stage:1',
      'yield',
      'publish',
    ]);
  });

  test('rethrows stage busy without recording a permanent attempt failure', () => {
    const busy = Object.assign(new Error('database is locked'), {
      code: 'SQLITE_BUSY_SNAPSHOT',
    });
    const claim = createClaim();
    const failAttempt = vi.fn();
    const afterSuccessfulWriteBatch = vi.fn();
    const store = createRunnerStore({
      claimNext: vi.fn()
        .mockReturnValueOnce(claim)
        .mockReturnValueOnce(null),
      stageVersionBatch: vi.fn(() => {
        throw busy;
      }),
      failAttempt,
    });

    expect(() => runKnowledgeDocumentIndexUntilIdle(store, {
      afterSuccessfulWriteBatch,
    })).toThrow(busy);
    expect(failAttempt).not.toHaveBeenCalled();
    expect(afterSuccessfulWriteBatch).not.toHaveBeenCalled();
  });

  test('records a write-batch hook failure instead of publishing or silently continuing', () => {
    const hookFailure = createSensitiveFailure('processing');
    const claim = createClaim();
    const failAttempt = vi.fn();
    const publishVersion = vi.fn();
    const store = createRunnerStore({
      claimNext: vi.fn()
        .mockReturnValueOnce(claim)
        .mockReturnValueOnce(null),
      publishVersion,
      failAttempt,
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      expect(runKnowledgeDocumentIndexUntilIdle(store, {
        afterSuccessfulWriteBatch: () => {
          throw hookFailure;
        },
      })).toEqual({
        indexedCount: 0,
        failedCount: 1,
      });
      expect(errorLog).toHaveBeenCalledWith('[KnowledgeDocumentIndex]', {
        workspaceId: claim.state.workspaceId,
        documentId: claim.state.documentId,
        documentVersionId: claim.state.documentVersionId,
        attemptId: claim.attempt.id,
        stage: KnowledgeDocumentIndexRunnerLogStage.ProcessClaim,
        code: KnowledgeDocumentIndexErrorCode.ProcessingFailed,
      });
      const serializedLogs = JSON.stringify(errorLog.mock.calls);
      expect(serializedLogs).not.toContain(hookFailure.message);
      expect(serializedLogs).not.toContain(hookFailure.stack);
      expect(serializedLogs).not.toContain('api-key-value');
      expect(serializedLogs).not.toContain('/private/company.pdf');
      expect(failAttempt).toHaveBeenCalledTimes(1);
      expect(publishVersion).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });

  test('rethrows busy while persisting a genuine per-document failure', () => {
    const processingFailure = new Error('chunk processing failed');
    const busy = Object.assign(new Error('database is locked'), {
      code: 'SQLITE_BUSY',
    });
    const claim = createClaim();
    const failAttempt = vi.fn(() => {
      throw busy;
    });
    const store = createRunnerStore({
      claimNext: vi.fn()
        .mockReturnValueOnce(claim)
        .mockReturnValueOnce(null),
      stageVersionBatch: vi.fn(() => {
        throw processingFailure;
      }),
      failAttempt,
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warningLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      expect(() => runKnowledgeDocumentIndexUntilIdle(store)).toThrow(busy);
      expect(failAttempt).toHaveBeenCalledTimes(1);
    } finally {
      errorLog.mockRestore();
      warningLog.mockRestore();
    }
  });

  test('does not expose a persistence Error while recording a local index failure', () => {
    const processingFailure = createSensitiveFailure('processing');
    const persistFailure = createSensitiveFailure('persist');
    const claim = createClaim();
    const store = createRunnerStore({
      claimNext: vi.fn()
        .mockReturnValueOnce(claim)
        .mockReturnValueOnce(null),
      stageVersionBatch: vi.fn(() => {
        throw processingFailure;
      }),
      failAttempt: vi.fn(() => {
        throw persistFailure;
      }),
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warningLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      expect(runKnowledgeDocumentIndexUntilIdle(store)).toEqual({
        indexedCount: 0,
        failedCount: 1,
      });
      expect(warningLog).toHaveBeenCalledWith('[KnowledgeDocumentIndex]', {
        workspaceId: claim.state.workspaceId,
        documentId: claim.state.documentId,
        documentVersionId: claim.state.documentVersionId,
        attemptId: claim.attempt.id,
        stage: KnowledgeDocumentIndexRunnerLogStage.PersistAttemptFailure,
        code: KnowledgeDocumentIndexRunnerLogCode.FailurePersistenceFailed,
      });
      const serializedLogs = JSON.stringify([
        ...errorLog.mock.calls,
        ...warningLog.mock.calls,
      ]);
      for (const failure of [processingFailure, persistFailure]) {
        expect(serializedLogs).not.toContain(failure.message);
        expect(serializedLogs).not.toContain(failure.stack);
      }
      expect(serializedLogs).not.toContain('api-key-value');
      expect(serializedLogs).not.toContain('/private/company.pdf');
    } finally {
      errorLog.mockRestore();
      warningLog.mockRestore();
    }
  });
});
