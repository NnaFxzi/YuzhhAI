import type {
  KnowledgeDocumentIndexAttemptOutcome,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentIndexTokenizer,
} from '../../shared/knowledgeBase/constants';

export interface KnowledgeDocumentChunkDraft {
  id: string;
  ordinal: number;
  content: string;
  startOffset: number;
  endOffset: number;
  checksum: string;
  pageNumber: number | null;
  sheetName: string | null;
  slideNumber: number | null;
  headingPath: string[] | null;
}

export interface KnowledgeDocumentChunk extends KnowledgeDocumentChunkDraft {
  storageId: string;
  indexGenerationId: string;
  workspaceId: string;
  documentId: string;
  documentVersionId: string;
  createdAt: string;
}

export interface KnowledgeDocumentIndexState {
  documentVersionId: string;
  workspaceId: string;
  documentId: string;
  status: KnowledgeDocumentIndexStatus;
  tokenizerVersion: KnowledgeDocumentIndexTokenizer;
  chunkCount: number;
  attemptCount: number;
  activeAttemptId: string | null;
  publishedGenerationId: string | null;
  errorCode: string | null;
  requestedAt: string;
  startedAt: string | null;
  heartbeatAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface KnowledgeDocumentIndexAttempt {
  id: string;
  documentVersionId: string;
  attemptNumber: number;
  tokenizerVersion: KnowledgeDocumentIndexTokenizer;
  startedAt: string;
  finishedAt: string | null;
  outcome: KnowledgeDocumentIndexAttemptOutcome;
  errorCode: string | null;
}

export interface KnowledgeDocumentIndexClaim {
  state: KnowledgeDocumentIndexState;
  attempt: KnowledgeDocumentIndexAttempt;
  extractedText: string;
}

export interface KnowledgeDocumentChunkSearchHit {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  ordinal: number;
  content: string;
  startOffset: number;
  endOffset: number;
  rank: number;
}

export interface KnowledgeDocumentIndexRunResult {
  indexedCount: number;
  failedCount: number;
}

export const KnowledgeDocumentIndexWorkerMessage = {
  Run: 'run',
  Shutdown: 'shutdown',
  Result: 'result',
  Busy: 'busy',
  Stopped: 'stopped',
} as const;
export type KnowledgeDocumentIndexWorkerMessage =
  (typeof KnowledgeDocumentIndexWorkerMessage)[keyof typeof KnowledgeDocumentIndexWorkerMessage];

export type KnowledgeDocumentIndexWorkerRequest =
  | { requestId: string; kind: typeof KnowledgeDocumentIndexWorkerMessage.Run }
  | { requestId: string; kind: typeof KnowledgeDocumentIndexWorkerMessage.Shutdown };

export type KnowledgeDocumentIndexWorkerResponse =
  | {
      requestId: string;
      kind: typeof KnowledgeDocumentIndexWorkerMessage.Result;
      result: KnowledgeDocumentIndexRunResult;
    }
  | {
      requestId: string;
      kind: typeof KnowledgeDocumentIndexWorkerMessage.Busy;
    }
  | { requestId: string; kind: typeof KnowledgeDocumentIndexWorkerMessage.Stopped };
