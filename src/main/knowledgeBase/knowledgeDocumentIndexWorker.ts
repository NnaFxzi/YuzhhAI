import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

import Database from 'better-sqlite3';

import {
  KNOWLEDGE_INDEX_WORKER_CLEANUP_YIELD_MS,
  KNOWLEDGE_INDEX_WORKER_WRITER_YIELD_MS,
  KnowledgeDocumentIndexErrorCode,
} from '../../shared/knowledgeBase/constants';
import { applySqliteConnectionPolicy } from '../libs/sqliteConnectionPolicy';
import { isTransientSqliteBusyError } from '../libs/sqliteTransactionRetry';
import { runKnowledgeDocumentIndexUntilIdle } from './knowledgeDocumentIndexRunner';
import { KnowledgeDocumentIndexStore } from './knowledgeDocumentIndexStore';
import {
  KnowledgeDocumentIndexWorkerMessage,
  type KnowledgeDocumentIndexWorkerRequest,
  type KnowledgeDocumentIndexWorkerResponse,
} from './knowledgeDocumentIndexTypes';

const port = parentPort;
if (!port) {
  throw new Error(KnowledgeDocumentIndexErrorCode.WorkerUnavailable);
}

const data = workerData as { databasePath?: unknown } | null;
const databasePath = data?.databasePath;
if (
  typeof databasePath !== 'string' ||
  databasePath.trim().length === 0 ||
  !path.isAbsolute(databasePath)
) {
  throw new Error(KnowledgeDocumentIndexErrorCode.WorkerUnavailable);
}

let db: Database.Database | null = null;
try {
  db = new Database(databasePath, { fileMustExist: true });
  applySqliteConnectionPolicy(db);
} catch {
  try {
    db?.close();
  } catch {
    // Startup failure is surfaced through the worker error event.
  }
  throw new Error(KnowledgeDocumentIndexErrorCode.WorkerUnavailable);
}

const store = new KnowledgeDocumentIndexStore(db);
const knowledgeDocumentIndexWriterYieldArray = new Int32Array(
  new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
);

const waitForKnowledgeDocumentWriterFairness = (timeoutMs: number): void => {
  Atomics.wait(
    knowledgeDocumentIndexWriterYieldArray,
    0,
    0,
    timeoutMs,
  );
};

const yieldAfterSuccessfulWriteBatch = (): void => {
  waitForKnowledgeDocumentWriterFairness(KNOWLEDGE_INDEX_WORKER_WRITER_YIELD_MS);
};

const yieldAfterSuccessfulCleanupBatch = (): void => {
  waitForKnowledgeDocumentWriterFairness(KNOWLEDGE_INDEX_WORKER_CLEANUP_YIELD_MS);
};

const post = (response: KnowledgeDocumentIndexWorkerResponse): void => {
  port.postMessage(response);
};

port.on('message', (request: KnowledgeDocumentIndexWorkerRequest) => {
  if (request.kind === KnowledgeDocumentIndexWorkerMessage.Run) {
    try {
      const result = runKnowledgeDocumentIndexUntilIdle(store, {
        afterSuccessfulWriteBatch: yieldAfterSuccessfulWriteBatch,
        afterSuccessfulCleanupBatch: yieldAfterSuccessfulCleanupBatch,
      });
      post({
        requestId: request.requestId,
        kind: KnowledgeDocumentIndexWorkerMessage.Result,
        result,
      });
    } catch (error) {
      if (isTransientSqliteBusyError(error)) {
        post({
          requestId: request.requestId,
          kind: KnowledgeDocumentIndexWorkerMessage.Busy,
        });
        return;
      }
      throw error;
    }
    return;
  }

  if (request.kind === KnowledgeDocumentIndexWorkerMessage.Shutdown) {
    try {
      db?.close();
      db = null;
      post({
        requestId: request.requestId,
        kind: KnowledgeDocumentIndexWorkerMessage.Stopped,
      });
    } finally {
      port.close();
    }
  }
});
