# Versioned Local Document Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the versioned, device-local chunk and FTS index that makes each active normalized
document independently searchable and supplies stable evidence identities for the later AI knowledge
extraction flow.

**Architecture:** Parsing remains owned by `KnowledgeIngestionService`; after parsed text and the
ingestion attempt commit atomically, a separate index state machine schedules the exact immutable
document version. Production indexing runs in one persistent Node worker thread with its own SQLite
connection, while deterministic tests inject an inline executor that uses the same runner and store
logic. The renderer receives only a safe per-document index summary and exposes an independent retry
path; it never receives chunks, raw errors, leases, tokenizer details, or filesystem paths.

**Tech Stack:** TypeScript, Electron main/preload, Node.js `worker_threads`, better-sqlite3 with WAL
and FTS5, React, Tailwind CSS, Vitest, Vite, electron-builder.

## Global Constraints

- This is Plan 1 of 3 for the approved derived AI knowledge design. Plan 2 adds enrichment/facts
  backend; Plan 3 adds authorization and fact-review UI.
- Node.js remains `>=24.15.0 <25`.
- Do not add a runtime dependency.
- Preserve all existing dirty-worktree changes; do not reformat, revert, or edit unrelated files.
- Do not run `git add`, create commits, or push until the user has manually tested and explicitly
  confirmed the implementation.
- Every production behavior change follows red-green-refactor TDD.
- Local parsing, OCR, chunking, indexing, deletion, restoration, reconciliation, and retry never call
  a model client or depend on OpenClaw.
- One workspace is expected to contain roughly 100–1000 documents; list projection must use one
  bulk index-state query and must not issue a query per document.
- Managed file limits remain 50 MiB per file, 100 files per selection, and 20 GiB logical managed
  bytes per workspace.
- Chunking uses a target of 18,000 JavaScript UTF-16 code units and 800 code units of overlap.
- Chunk boundaries must not split a UTF-16 surrogate pair; offsets use the same code-unit convention
  as `String.prototype.slice`.
- Production indexing concurrency is exactly one persistent worker thread.
- The worker uses an independent SQLite connection with WAL, `synchronous=NORMAL`, an 8 MiB cache,
  `wal_autocheckpoint=1000`, and `busy_timeout=5000`.
- Production must fail safely when the worker cannot start; it must never fall back to 50 MiB
  chunking or FTS publication on Electron's main event loop.
- FTS5 `trigram` is primary. A runtime table-creation probe selects and persists an explicit CJK
  bigram fallback using `unicode61 remove_diacritics 2`; tokenizer mode must never switch silently
  after data exists.
- Every `MATCH` expression is produced by a local pure function and passed as a bound parameter;
  renderer input is never interpolated into SQL.
- Worker writes are staged in invisible generations in batches of at most 8 chunks. A short final
  SQLite transaction guarded by workspace existence, active-document, current-version, and
  active-attempt checks atomically activates the complete chunk/FTS generation, attempt outcome,
  and `indexed` state; partial generations are never searchable.
- Local index status and retry remain independent from `KnowledgeDocumentStatus`,
  `knowledge_ingestion_jobs`, legacy workspace projection, and document revision.
- IPC responses never expose chunk content, extracted text, absolute paths, managed paths, attempt
  IDs, heartbeat/lease values, tokenizer mode, stack traces, SQLite messages, or raw internal errors.
- Deleted documents cannot be indexed or retried. Late workers cannot republish a deleted, replaced,
  or workspace-deleted target.
- Add Chinese and English translations for every new visible string.
- Every touched TypeScript/TSX file must pass changed-file ESLint with zero warnings.
- Main/preload work must pass `npm run compile:electron`; renderer work must pass `npm run build`.

---

## Scope Boundary

This plan delivers a complete local-search foundation and UI status flow. It deliberately does not
create `knowledge_enrichment_requests`, model authorization descriptors, provider calls, normalized
facts/evidence, profile projection, or AI-knowledge review operations. Those are Plans 2 and 3 and
will consume the stable chunks created here.

## File Structure

### Shared boundary

- Modify `src/shared/knowledgeBase/constants.ts`: stable index status, attempt outcome, tokenizer,
  error codes, chunk limits, and retry IPC channel.
- Modify `src/shared/knowledgeBase/types.ts`: safe index summary and retry request; add
  `localIndex` to the document DTO.
- Modify `src/shared/knowledgeBase/contracts.test.ts`: stable values and safe DTO contract.

### Main-process index domain

- Create `src/main/knowledgeBase/knowledgeDocumentIndexTypes.ts`: internal rows, claims, chunks,
  search hits, executor result, and worker protocol.
- Create `src/main/knowledgeBase/knowledgeDocumentChunker.ts`: deterministic UTF-16-safe chunking,
  stable IDs, trigram query construction, and CJK bigram normalization.
- Create `src/main/knowledgeBase/knowledgeDocumentChunker.test.ts`: chunk and query unit tests.
- Create `src/main/knowledgeBase/knowledgeDocumentIndexStore.ts`: DDL, tokenizer probe/config,
  queue/attempt state machine, atomic publication, FTS search, recovery, and cleanup.
- Create `src/main/knowledgeBase/knowledgeDocumentIndexStore.test.ts`: SQLite state, FTS, lifecycle,
  CAS, injection, and atomicity tests.
- Create `src/main/knowledgeBase/knowledgeDocumentIndexRunner.ts`: claim/read/chunk/publish loop used
  by production worker and inline tests.
- Create `src/main/knowledgeBase/knowledgeDocumentIndexExecutor.ts`: executor contract, inline
  executor, worker executor, and single-flight lifecycle.
- Create `src/main/knowledgeBase/knowledgeDocumentIndexExecutor.test.ts`: inline and worker executor
  behavior.
- Create `src/main/knowledgeBase/knowledgeDocumentIndexWorker.ts`: worker entry and independent DB
  connection.
- Create `src/main/knowledgeBase/knowledgeDocumentIndexWorkerPath.ts`: pure dev/packaged path
  resolution.
- Create `src/main/knowledgeBase/knowledgeDocumentIndexWorkerPath.test.ts`: path contract tests.
- Create `src/main/knowledgeBase/knowledgeDocumentIndexService.ts`: wake coalescing, idle wait, and
  shutdown façade.
- Create `src/main/knowledgeBase/knowledgeDocumentIndexService.test.ts`: coalescing and shutdown.
- Create `src/main/libs/sqliteConnectionPolicy.ts`: reusable connection pragmas.
- Create `src/main/libs/sqliteConnectionPolicy.test.ts`: two-connection policy test.
- Modify `src/main/libs/sqliteBackup/sqliteBackupManager.ts`: consume the shared policy.

### Composition and document lifecycle

- Modify `src/main/knowledgeBase/knowledgeIngestionService.ts`: atomically schedule index state after
  parsing and wake only after commit.
- Modify `src/main/knowledgeBase/knowledgeIngestionService.test.ts`: pending/not-applicable and
  rollback behavior.
- Modify `src/main/knowledgeBase/knowledgeBaseFoundation.ts`: construct/recover/reconcile/start/stop
  index components and delete index data before documents.
- Modify `src/main/knowledgeBase/knowledgeBaseFoundation.test.ts`: startup, cleanup, inline executor,
  and shutdown tests.
- Modify `src/main/knowledgeBase/knowledgeBaseStartupOrder.test.ts`: startup ordering contract.
- Modify `src/main/knowledgeBase/knowledgeDocumentService.ts`: bulk summary projection,
  import/delete/restore lifecycle, and independent retry.
- Modify `src/main/knowledgeBase/knowledgeDocumentService.test.ts`: lifecycle and no-N+1 tests.
- Modify `src/main/main.ts`: pass the real database path and stop the worker before closing SQLite.

### Worker build and packaging

- Modify `vite.config.mts`: build `knowledge-index-worker.js` as an independent CJS Electron entry.
- Modify `electron-builder.json`: unpack the worker bundle from ASAR.
- Modify `package.json`: wait for both main and worker readiness during development.
- Create `src/main/knowledgeBase/knowledgeDocumentIndexBuildContract.test.ts`: source-level worker
  output, development wait target, and ASAR contract.

### IPC and renderer

- Modify `src/main/knowledgeBase/ipcHandlers.ts` and its test: validate/register retry-local-index.
- Modify `src/main/knowledgeBase/preloadBridge.ts` and its test: expose typed retry-local-index.
- Modify `src/renderer/types/electron.d.ts`: share the new request/result type.
- Modify `src/renderer/services/knowledgeBase.ts` and its test: renderer wrapper.
- Modify `src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.ts` and its
  test: local-index status keys, retry predicate, and polling rule.
- Modify `src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.ts` and its
  test: independent retry mutation.
- Modify `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx` and
  its test: separate parse/index status and retry control.
- Modify `src/renderer/services/i18n.ts`: Chinese and English local-index strings.
- Update every existing `KnowledgeDocumentListItem` test fixture to include `localIndex: null`.

---

### Task 1: Freeze Shared Index Contracts

**Files:**

- Modify: `src/shared/knowledgeBase/constants.ts`
- Modify: `src/shared/knowledgeBase/types.ts`
- Modify: `src/shared/knowledgeBase/contracts.test.ts`
- Modify fixture call sites returned by:
  `rg -l "KnowledgeDocumentListItem" src --glob '*.test.ts'`

**Interfaces:**

- Produces `KnowledgeDocumentIndexStatus`, `KnowledgeDocumentIndexAttemptOutcome`,
  `KnowledgeDocumentIndexTokenizer`, `KnowledgeDocumentIndexErrorCode`,
  `KNOWLEDGE_CHUNK_TARGET_CHARS`, `KNOWLEDGE_CHUNK_OVERLAP_CHARS`,
  `KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS`, and `KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS`.
- Produces `KnowledgeDocumentIndexSummary` and `KnowledgeRetryLocalIndexRequest`.
- Extends `KnowledgeDocumentListItem` with required `localIndex` and `KnowledgeBaseIpc` with
  `RetryLocalIndex`.
- All later tasks import these values and types instead of duplicating status strings.

- [ ] **Step 1: Write the failing shared-contract tests**

Add these assertions to `contracts.test.ts` and update its DTO factory with `localIndex: null`:

```ts
test('publishes stable local-index constants and retry channel', () => {
  expect(KnowledgeDocumentIndexStatus).toEqual({
    Pending: 'pending',
    Indexing: 'indexing',
    Indexed: 'indexed',
    NotApplicable: 'not_applicable',
    Failed: 'failed',
  });
  expect(KnowledgeDocumentIndexAttemptOutcome).toEqual({
    Running: 'running',
    Indexed: 'indexed',
    Failed: 'failed',
    Cancelled: 'cancelled',
    Abandoned: 'abandoned',
  });
  expect(KnowledgeDocumentIndexTokenizer).toEqual({
    TrigramV1: 'fts5_trigram_v1',
    CjkBigramV1: 'unicode61_cjk_bigram_v1',
  });
  expect(KnowledgeBaseIpc).toEqual({
    DeleteDocument: 'knowledgeBase:documents:delete',
    GetDocumentDetails: 'knowledgeBase:documents:getDetails',
    ImportSelection: 'knowledgeBase:documents:importSelection',
    ListDocuments: 'knowledgeBase:documents:list',
    RestoreDocument: 'knowledgeBase:documents:restore',
    RetryDocument: 'knowledgeBase:documents:retry',
    RetryLocalIndex: 'knowledgeBase:documents:retryLocalIndex',
    SelectFiles: 'knowledgeBase:files:select',
  });
  expect(KNOWLEDGE_CHUNK_TARGET_CHARS).toBe(18_000);
  expect(KNOWLEDGE_CHUNK_OVERLAP_CHARS).toBe(800);
  expect(KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS).toBe(8);
  expect(KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS).toBe(64);
});

test('keeps local-index document summaries display-safe', () => {
  const item: KnowledgeDocumentListItem = {
    id: 'document-a',
    displayName: 'manual.pdf',
    sourceMode: KnowledgeDocumentSourceMode.Managed,
    currentVersionId: 'version-a',
    revision: 1,
    status: KnowledgeDocumentStatus.Ready,
    fileSize: 100,
    mimeType: 'application/pdf',
    contentHash: 'a'.repeat(64),
    currentJob: null,
    localIndex: {
      documentVersionId: 'version-a',
      status: KnowledgeDocumentIndexStatus.Indexed,
      chunkCount: 4,
      attemptCount: 1,
      errorCode: null,
      updatedAt: '2026-07-11T00:00:00.000Z',
      completedAt: '2026-07-11T00:00:01.000Z',
    },
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:01.000Z',
    deletedAt: null,
  };

  expect(item.localIndex).not.toHaveProperty('activeAttemptId');
  expect(item.localIndex).not.toHaveProperty('heartbeatAt');
  expect(item.localIndex).not.toHaveProperty('tokenizerVersion');
  expect(item.localIndex).not.toHaveProperty('content');
  expect(item.localIndex).not.toHaveProperty('managedPath');
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
npm test -- src/shared/knowledgeBase/contracts.test.ts
```

Expected: FAIL because the index constants, DTO, and IPC channel do not exist.

- [ ] **Step 3: Add exact shared constants**

Append these single sources of truth to `constants.ts` and add `RetryLocalIndex` to the existing
`KnowledgeBaseIpc` object:

```ts
export const KnowledgeDocumentIndexStatus = {
  Pending: 'pending',
  Indexing: 'indexing',
  Indexed: 'indexed',
  NotApplicable: 'not_applicable',
  Failed: 'failed',
} as const;
export type KnowledgeDocumentIndexStatus =
  (typeof KnowledgeDocumentIndexStatus)[keyof typeof KnowledgeDocumentIndexStatus];

export const KnowledgeDocumentIndexAttemptOutcome = {
  Running: 'running',
  Indexed: 'indexed',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Abandoned: 'abandoned',
} as const;
export type KnowledgeDocumentIndexAttemptOutcome =
  (typeof KnowledgeDocumentIndexAttemptOutcome)[keyof typeof KnowledgeDocumentIndexAttemptOutcome];

export const KnowledgeDocumentIndexTokenizer = {
  TrigramV1: 'fts5_trigram_v1',
  CjkBigramV1: 'unicode61_cjk_bigram_v1',
} as const;
export type KnowledgeDocumentIndexTokenizer =
  (typeof KnowledgeDocumentIndexTokenizer)[keyof typeof KnowledgeDocumentIndexTokenizer];

export const KnowledgeDocumentIndexErrorCode = {
  ProcessingFailed: 'index_processing_failed',
  WorkerUnavailable: 'index_worker_unavailable',
  StateConflict: 'index_state_conflict',
} as const;
export type KnowledgeDocumentIndexErrorCode =
  (typeof KnowledgeDocumentIndexErrorCode)[keyof typeof KnowledgeDocumentIndexErrorCode];

export const KNOWLEDGE_CHUNK_TARGET_CHARS = 18_000;
export const KNOWLEDGE_CHUNK_OVERLAP_CHARS = 800;
export const KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS = 8;
export const KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS = 64;
```

The IPC object must contain this exact member:

```ts
RetryLocalIndex: 'knowledgeBase:documents:retryLocalIndex',
```

- [ ] **Step 4: Add exact safe types**

Import `KnowledgeDocumentIndexStatus` into `types.ts`, add these interfaces, and make
`localIndex` required on `KnowledgeDocumentListItem`:

```ts
export interface KnowledgeDocumentIndexSummary {
  documentVersionId: string;
  status: KnowledgeDocumentIndexStatus;
  chunkCount: number;
  attemptCount: number;
  errorCode: string | null;
  updatedAt: string;
  completedAt: string | null;
}

export interface KnowledgeRetryLocalIndexRequest {
  documentId: string;
  documentVersionId: string;
}
```

```ts
export interface KnowledgeDocumentListItem {
  id: string;
  displayName: string;
  sourceMode: KnowledgeDocumentSourceMode;
  currentVersionId: string;
  revision: number;
  status: KnowledgeDocumentStatus;
  fileSize: number | null;
  mimeType: string | null;
  contentHash: string | null;
  currentJob: KnowledgeIngestionJobSummary | null;
  localIndex: KnowledgeDocumentIndexSummary | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
```

- [ ] **Step 5: Update all existing DTO fixtures mechanically**

Run the read-only locator first:

```bash
rg -n "currentJob:" src --glob '*.test.ts'
```

For each actual `KnowledgeDocumentListItem` fixture, insert this exact sibling field after
`currentJob`; do not alter production DTO constructors in this step:

```ts
localIndex: null,
```

- [ ] **Step 6: Run contract coverage and task lint**

Run:

```bash
npm test -- src/shared/knowledgeBase/contracts.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/shared/knowledgeBase/constants.ts \
  src/shared/knowledgeBase/types.ts \
  src/shared/knowledgeBase/contracts.test.ts
```

Expected: both commands PASS. Do not stage or commit the files.

---

### Task 2: Deterministic Chunking and Safe Search Normalization

**Files:**

- Create: `src/main/knowledgeBase/knowledgeDocumentIndexTypes.ts`
- Create: `src/main/knowledgeBase/knowledgeDocumentChunker.ts`
- Create: `src/main/knowledgeBase/knowledgeDocumentChunker.test.ts`

**Interfaces:**

- Consumes the shared tokenizer and 18,000/800 limits from Task 1.
- Produces `KnowledgeDocumentChunkDraft`, internal index row/claim/search types, worker protocol, and
  `chunkKnowledgeDocumentVersion`, `buildKnowledgeChunkId`, `buildKnowledgeFtsSearchText`, and
  `buildKnowledgeFtsMatchQuery`.
- Task 3 persists the returned chunks; Task 5 invokes the same chunker in inline and worker modes.

- [ ] **Step 1: Define internal types used by every main-process index component**

Create `knowledgeDocumentIndexTypes.ts` with these exact public shapes:

```ts
import type {
  KnowledgeDocumentIndexAttemptOutcome,
  KnowledgeDocumentIndexErrorCode,
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
  Failed: 'failed',
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
      kind: typeof KnowledgeDocumentIndexWorkerMessage.Failed;
      errorCode: KnowledgeDocumentIndexErrorCode;
    }
  | { requestId: string; kind: typeof KnowledgeDocumentIndexWorkerMessage.Stopped };
```

- [ ] **Step 2: Write failing chunk and query tests**

Create tests for defaults, overlap, deterministic IDs, Unicode safety, bigrams, and query escaping:

```ts
import { describe, expect, test } from 'vitest';

import { KnowledgeDocumentIndexTokenizer } from '../../shared/knowledgeBase/constants';
import {
  buildKnowledgeFtsMatchQuery,
  buildKnowledgeFtsSearchText,
  chunkKnowledgeDocumentVersion,
} from './knowledgeDocumentChunker';

describe('chunkKnowledgeDocumentVersion', () => {
  test('uses deterministic 18,000 character chunks with 800 character overlap', () => {
    const text = 'a'.repeat(36_500);
    const first = chunkKnowledgeDocumentVersion({ documentVersionId: 'version-a', text });
    const retry = chunkKnowledgeDocumentVersion({ documentVersionId: 'version-a', text });

    expect(first.map(chunk => [chunk.startOffset, chunk.endOffset])).toEqual([
      [0, 18_000],
      [17_200, 35_200],
      [34_400, 36_500],
    ]);
    expect(retry.map(chunk => chunk.id)).toEqual(first.map(chunk => chunk.id));
  });

  test('does not split a UTF-16 surrogate pair', () => {
    const text = `${'a'.repeat(9)}😀${'b'.repeat(20)}`;
    const chunks = chunkKnowledgeDocumentVersion({
      documentVersionId: 'version-emoji',
      text,
      targetChars: 10,
      overlapChars: 2,
    });

    const splitsSurrogatePair = (value: string, offset: number): boolean =>
      offset > 0 &&
      offset < value.length &&
      value.charCodeAt(offset - 1) >= 0xd800 &&
      value.charCodeAt(offset - 1) <= 0xdbff &&
      value.charCodeAt(offset) >= 0xdc00 &&
      value.charCodeAt(offset) <= 0xdfff;

    expect(chunks.every(chunk =>
      !splitsSurrogatePair(text, chunk.startOffset) &&
      !splitsSurrogatePair(text, chunk.endOffset),
    )).toBe(true);
    expect(chunks.map(chunk => text.slice(chunk.startOffset, chunk.endOffset))).toEqual(
      chunks.map(chunk => chunk.content),
    );

    const overlapText = `${'a'.repeat(8)}😀${'b'.repeat(8)}`;
    const overlapChunks = chunkKnowledgeDocumentVersion({
      documentVersionId: 'version-overlap-emoji',
      text: overlapText,
      targetChars: 12,
      overlapChars: 3,
    });
    expect(overlapChunks.every(chunk =>
      !splitsSurrogatePair(overlapText, chunk.startOffset) &&
      !splitsSurrogatePair(overlapText, chunk.endOffset),
    )).toBe(true);

    expect(chunkKnowledgeDocumentVersion({
      documentVersionId: 'version-single-emoji',
      text: '😀x',
      targetChars: 1,
      overlapChars: 0,
    }).map(chunk => chunk.content)).toEqual(['😀', 'x']);
  });
});

describe('local FTS normalization', () => {
  test('builds deterministic CJK bigram text', () => {
    expect(
      buildKnowledgeFtsSearchText(
        '企业知识库 AI',
        KnowledgeDocumentIndexTokenizer.CjkBigramV1,
      ),
    ).toBe('企业 业知 知识 识库 ai');
  });

  test('preserves source order across CJK and Latin token boundaries', () => {
    expect(
      buildKnowledgeFtsSearchText(
        '预算AI2026',
        KnowledgeDocumentIndexTokenizer.CjkBigramV1,
      ),
    ).toBe('预算 ai2026');
    expect(
      buildKnowledgeFtsSearchText(
        '支持 AI 问答',
        KnowledgeDocumentIndexTokenizer.CjkBigramV1,
      ),
    ).toBe('支持 ai 问答');
    expect(
      buildKnowledgeFtsSearchText(
        'AI预算',
        KnowledgeDocumentIndexTokenizer.CjkBigramV1,
      ),
    ).toBe('ai 预算');
    expect(
      buildKnowledgeFtsSearchText(
        '预算AI知识',
        KnowledgeDocumentIndexTokenizer.CjkBigramV1,
      ),
    ).toBe('预算 ai 知识');
  });

  test('quotes trigram terms without exposing MATCH syntax', () => {
    expect(
      buildKnowledgeFtsMatchQuery(
        '预算 "2026" OR secret:*',
        KnowledgeDocumentIndexTokenizer.TrigramV1,
      ),
    ).toBe('"预算 ""2026"" or secret:*"');
  });

  test('returns null for an empty query', () => {
    expect(
      buildKnowledgeFtsMatchQuery('   ', KnowledgeDocumentIndexTokenizer.TrigramV1),
    ).toBeNull();
  });
});
```

- [ ] **Step 3: Run the chunker test and verify RED**

Run:

```bash
npm test -- src/main/knowledgeBase/knowledgeDocumentChunker.test.ts
```

Expected: FAIL because `knowledgeDocumentChunker.ts` does not exist.

- [ ] **Step 4: Implement stable IDs and UTF-16-safe boundaries**

Use SHA-256 over the exact NUL-delimited identity input, and move a boundary left when it would
separate a high and low surrogate:

```ts
import { createHash } from 'node:crypto';

import {
  KNOWLEDGE_CHUNK_OVERLAP_CHARS,
  KNOWLEDGE_CHUNK_TARGET_CHARS,
  type KnowledgeDocumentIndexTokenizer,
  KnowledgeDocumentIndexTokenizer as KnowledgeDocumentIndexTokenizers,
} from '../../shared/knowledgeBase/constants';
import type { KnowledgeDocumentChunkDraft } from './knowledgeDocumentIndexTypes';

const isHighSurrogate = (value: number): boolean => value >= 0xd800 && value <= 0xdbff;
const isLowSurrogate = (value: number): boolean => value >= 0xdc00 && value <= 0xdfff;

const safeBoundary = (text: string, offset: number): number => {
  if (
    offset > 0 &&
    offset < text.length &&
    isHighSurrogate(text.charCodeAt(offset - 1)) &&
    isLowSurrogate(text.charCodeAt(offset))
  ) {
    return offset - 1;
  }
  return offset;
};

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

export const buildKnowledgeChunkId = (input: {
  documentVersionId: string;
  ordinal: number;
  startOffset: number;
  endOffset: number;
  checksum: string;
}): string =>
  sha256(
    [
      input.documentVersionId,
      input.ordinal,
      input.startOffset,
      input.endOffset,
      input.checksum,
    ].join('\0'),
  );
```

The chunk loop must use these exact guards so an invalid overlap cannot create an infinite loop:

```ts
export const chunkKnowledgeDocumentVersion = (input: {
  documentVersionId: string;
  text: string;
  targetChars?: number;
  overlapChars?: number;
  onProgress?: (progress: number) => void;
}): KnowledgeDocumentChunkDraft[] => {
  const targetChars = input.targetChars ?? KNOWLEDGE_CHUNK_TARGET_CHARS;
  const overlapChars = input.overlapChars ?? KNOWLEDGE_CHUNK_OVERLAP_CHARS;
  if (!Number.isInteger(targetChars) || targetChars < 1) {
    throw new Error('Knowledge chunk target must be a positive integer');
  }
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= targetChars) {
    throw new Error('Knowledge chunk overlap must be smaller than the target');
  }

  const chunks: KnowledgeDocumentChunkDraft[] = [];
  let startOffset = 0;
  while (startOffset < input.text.length) {
    const candidateEnd = safeBoundary(
      input.text,
      Math.min(input.text.length, startOffset + targetChars),
    );
    const endOffset = candidateEnd > startOffset
      ? candidateEnd
      : Math.min(input.text.length, startOffset + 2);
    const content = input.text.slice(startOffset, endOffset);
    const checksum = sha256(content);
    const ordinal = chunks.length;
    chunks.push({
      id: buildKnowledgeChunkId({
        documentVersionId: input.documentVersionId,
        ordinal,
        startOffset,
        endOffset,
        checksum,
      }),
      ordinal,
      content,
      startOffset,
      endOffset,
      checksum,
      pageNumber: null,
      sheetName: null,
      slideNumber: null,
      headingPath: null,
    });
    input.onProgress?.(endOffset / input.text.length);
    if (endOffset === input.text.length) {
      break;
    }
    const nextOffset = safeBoundary(input.text, endOffset - overlapChars);
    startOffset = nextOffset > startOffset ? nextOffset : endOffset;
  }
  return chunks;
};
```

- [ ] **Step 5: Implement deterministic search text and parameter value construction**

Use Unicode-aware lowercasing, collapse whitespace, scan CJK and non-CJK letter/number runs from
left to right, generate adjacent pairs inside each CJK run, retain normalized non-CJK tokens in
source order, and quote the entire query as one FTS phrase:

```ts
const CJK_CHARACTER =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;
const LETTER_OR_NUMBER_CHARACTER = /^[\p{Letter}\p{Number}]$/u;

const normalizeSearchText = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

const toCjkBigramTokens = (value: string): string[] => {
  const tokens: string[] = [];
  const characters = Array.from(value);
  if (characters.length === 1) {
    return characters;
  }
  for (let index = 0; index < characters.length - 1; index += 1) {
    tokens.push(`${characters[index]}${characters[index + 1]}`);
  }
  return tokens;
};

const tokenizeCjkBigramText = (value: string): string[] => {
  const tokens: string[] = [];
  let run = '';
  let runIsCjk: boolean | null = null;
  const flush = (): void => {
    if (!run) {
      return;
    }
    if (runIsCjk === true) {
      tokens.push(...toCjkBigramTokens(run));
    } else {
      tokens.push(run);
    }
    run = '';
    runIsCjk = null;
  };

  for (const character of value) {
    const isCjk = CJK_CHARACTER.test(character);
    if (!isCjk && !LETTER_OR_NUMBER_CHARACTER.test(character)) {
      flush();
      continue;
    }
    if (run && runIsCjk !== isCjk) {
      flush();
    }
    run += character;
    runIsCjk = isCjk;
  }
  flush();
  return tokens;
};

export const buildKnowledgeFtsSearchText = (
  content: string,
  tokenizer: KnowledgeDocumentIndexTokenizer,
): string => {
  const normalized = normalizeSearchText(content);
  if (tokenizer === KnowledgeDocumentIndexTokenizers.TrigramV1) {
    return normalized;
  }
  return tokenizeCjkBigramText(normalized).join(' ');
};

export const buildKnowledgeFtsMatchQuery = (
  query: string,
  tokenizer: KnowledgeDocumentIndexTokenizer,
): string | null => {
  const searchText = buildKnowledgeFtsSearchText(query, tokenizer).trim();
  return searchText ? `"${searchText.replace(/"/g, '""')}"` : null;
};
```

Both character classifiers are deliberately non-global so repeated `test()` calls are stateless.

- [ ] **Step 6: Run focused tests and task lint**

Run:

```bash
npm test -- src/main/knowledgeBase/knowledgeDocumentChunker.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/main/knowledgeBase/knowledgeDocumentIndexTypes.ts \
  src/main/knowledgeBase/knowledgeDocumentChunker.ts \
  src/main/knowledgeBase/knowledgeDocumentChunker.test.ts
```

Expected: both commands PASS. Do not stage or commit the files.

---

### Task 3: SQLite Schema, Tokenizer Selection, and Queue State Machine

**Files:**

- Create: `src/main/knowledgeBase/knowledgeDocumentIndexStore.ts`
- Create: `src/main/knowledgeBase/knowledgeDocumentIndexStore.test.ts`

**Interfaces:**

- Consumes the Task 1 constants and Task 2 internal types.
- Produces `KnowledgeDocumentIndexStateError`, `KnowledgeDocumentIndexStore` construction, tokenizer
  persistence, state reads, scheduling, claim, heartbeat, attempt reads, abandoned recovery, and
  startup reconciliation.
- Task 4 adds publication/search/lifecycle methods to the same focused store.

- [ ] **Step 1: Write failing schema and scheduling tests**

Use a real in-memory `KnowledgeDocumentStore`. Add these local helpers at the top of the new test
file; they create normalized rows through production stores rather than duplicating DDL:

```ts
const ensureWorkspace = (db: Database.Database, workspaceId: string): void => {
  new EnterpriseLeadWorkspaceStore(db);
  const now = '2026-07-11T00:00:00.000Z';
  db.prepare(`
    INSERT OR IGNORE INTO enterprise_lead_workspaces (
      id, name, type, profile, extraction_sources, risk_rules,
      enabled_agent_roles, settings, workspace_agents, recent_run_id,
      created_at, updated_at
    ) VALUES (?, ?, 'enterprise_lead', '{}', '[]', '[]', '[]', NULL, NULL, NULL, ?, ?)
  `).run(workspaceId, workspaceId, now, now);
};

const createReadyDocument = (
  documents: KnowledgeDocumentStore,
  workspaceId: string,
  extractedText: string | null,
) => {
  const created = documents.createDocumentWithVersion({
    workspaceId,
    displayName: `${randomUUID()}.txt`,
    sourceMode: KnowledgeDocumentSourceMode.Managed,
    status: extractedText
      ? KnowledgeDocumentStatus.Ready
      : KnowledgeDocumentStatus.CompletedWithoutText,
    version: {
      contentHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
      managedPath: `blobs/test/${randomUUID()}`,
      mimeType: 'text/plain',
      fileSize: extractedText?.length ?? 0,
      sourceMtime: null,
      parser: 'text',
      extractedText,
      extractionPartial: false,
    },
  });
  return { ...created, text: extractedText ?? '' };
};

const createScheduledIndexStore = () => {
  const db = new Database(':memory:');
  ensureWorkspace(db, 'workspace-a');
  const documents = new KnowledgeDocumentStore(db);
  const target = createReadyDocument(documents, 'workspace-a', 'searchable target text');
  const store = new KnowledgeDocumentIndexStore(db, {
    resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
  });
  store.scheduleCurrentVersion({
    workspaceId: target.document.workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
  });
  return { db, documents, store, target };
};
```

Then assert exact state behavior:

```ts
test('persists one tokenizer choice and schedules text or not-applicable state', () => {
  const db = new Database(':memory:');
  ensureWorkspace(db, 'workspace-a');
  const documents = new KnowledgeDocumentStore(db);
  const withText = createReadyDocument(documents, 'workspace-a', '可搜索正文');
  const withoutText = createReadyDocument(documents, 'workspace-a', null);
  const store = new KnowledgeDocumentIndexStore(db, {
    resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
  });

  expect(store.scheduleCurrentVersion({
    workspaceId: withText.document.workspaceId,
    documentId: withText.document.id,
    documentVersionId: withText.version.id,
  }).status).toBe(KnowledgeDocumentIndexStatus.Pending);
  expect(store.scheduleCurrentVersion({
    workspaceId: withoutText.document.workspaceId,
    documentId: withoutText.document.id,
    documentVersionId: withoutText.version.id,
  }).status).toBe(KnowledgeDocumentIndexStatus.NotApplicable);
  expect(store.getTokenizer()).toBe(KnowledgeDocumentIndexTokenizer.CjkBigramV1);
  db.close();
});

test('claims pending state and creates one immutable running attempt', () => {
  const { db, store, target } = createScheduledIndexStore();
  const claim = store.claimNext('2026-07-11T00:01:00.000Z');

  expect(claim?.state.status).toBe(KnowledgeDocumentIndexStatus.Indexing);
  expect(claim?.state.attemptCount).toBe(1);
  expect(claim?.attempt.outcome).toBe(KnowledgeDocumentIndexAttemptOutcome.Running);
  expect(claim?.extractedText).toBe(target.text);
  expect(store.claimNext()).toBeNull();
  db.close();
});

test('does not claim deleted or non-current versions', () => {
  const { db, documents, store, target } = createScheduledIndexStore();
  documents.softDeleteDocument(target.document.id, target.document.revision);
  expect(store.claimNext()).toBeNull();
  db.close();
});

test('keeps the persisted tokenizer when a later runtime resolver disagrees', () => {
  const db = new Database(':memory:');
  ensureWorkspace(db, 'workspace-a');
  const first = new KnowledgeDocumentIndexStore(db, {
    resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
  });
  expect(first.getTokenizer()).toBe(KnowledgeDocumentIndexTokenizer.CjkBigramV1);

  const reopened = new KnowledgeDocumentIndexStore(db, {
    resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.TrigramV1,
  });
  expect(reopened.getTokenizer()).toBe(KnowledgeDocumentIndexTokenizer.CjkBigramV1);
  db.close();
});
```

Also cover these default-path and trim regressions with real SQLite behavior:

- Construct the store without `resolveTokenizer`, independently probe whether this runtime can
  create a temporary trigram FTS5 table, and assert `trigram_available` plus the persisted tokenizer
  match that observed capability. Assert `sqlite_temp_master` contains no
  `knowledge_trigram_probe_%` table after construction.
- Schedule a current version whose extracted text is exactly `'   '` and assert the resulting state
  is `not_applicable` with a completion timestamp.

- [ ] **Step 2: Run the store test and verify RED**

Run:

```bash
npm test -- src/main/knowledgeBase/knowledgeDocumentIndexStore.test.ts
```

Expected: FAIL because `KnowledgeDocumentIndexStore` does not exist.

- [ ] **Step 3: Initialize exact durable tables and indexes**

The store constructor calls `initialize()`. `initialize()` executes this schema before resolving
the tokenizer:

In the TypeScript template, interpolate every CHECK value from the Task 1 constant objects (for
example `${KnowledgeDocumentIndexStatus.Pending}`) rather than duplicating status literals; the SQL
below shows the resulting persisted schema.

```sql
CREATE TABLE IF NOT EXISTS knowledge_document_index_config (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  schema_version INTEGER NOT NULL,
  tokenizer_mode TEXT NOT NULL,
  tokenizer_version TEXT NOT NULL,
  trigram_available INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_document_index_state (
  document_version_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'indexing', 'indexed', 'not_applicable', 'failed')
  ),
  tokenizer_version TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  active_attempt_id TEXT,
  published_generation_id TEXT,
  error_code TEXT,
  requested_at TEXT NOT NULL,
  started_at TEXT,
  heartbeat_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_version_id)
    REFERENCES knowledge_document_versions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_document_index_queue
ON knowledge_document_index_state(status, requested_at, document_version_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_document_index_workspace
ON knowledge_document_index_state(workspace_id, document_id, document_version_id);

CREATE TABLE IF NOT EXISTS knowledge_document_index_attempts (
  id TEXT PRIMARY KEY,
  document_version_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  tokenizer_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('running', 'indexed', 'failed', 'cancelled', 'abandoned')
  ),
  error_code TEXT,
  UNIQUE(document_version_id, attempt_number),
  FOREIGN KEY (document_version_id)
    REFERENCES knowledge_document_versions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_document_index_attempts_version
ON knowledge_document_index_attempts(document_version_id, attempt_number);

CREATE TABLE IF NOT EXISTS knowledge_document_chunks (
  storage_id TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  index_generation_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  content TEXT NOT NULL,
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK (end_offset >= start_offset),
  page_number INTEGER,
  sheet_name TEXT,
  slide_number INTEGER,
  heading_path_json TEXT,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(index_generation_id, id),
  UNIQUE(index_generation_id, ordinal),
  FOREIGN KEY (document_version_id)
    REFERENCES knowledge_document_versions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_document_chunks_workspace
ON knowledge_document_chunks(
  workspace_id, document_version_id, index_generation_id, ordinal
);
```

- [ ] **Step 4: Probe and persist one tokenizer mode**

Implement a default resolver that attempts actual trigram table creation rather than inspecting
compile flags:

```ts
const probeTrigram = (db: Database.Database): boolean => {
  const tableName = `temp.knowledge_trigram_probe_${randomUUID().replace(/-/g, '')}`;
  try {
    db.exec(`CREATE VIRTUAL TABLE ${tableName} USING fts5(value, tokenize='trigram')`);
    db.exec(`DROP TABLE ${tableName}`);
    return true;
  } catch {
    try {
      db.exec(`DROP TABLE IF EXISTS ${tableName}`);
    } catch {
      return false;
    }
    return false;
  }
};
```

Then use this exact persisted-choice rule:

```ts
private initializeTokenizer(resolveTokenizer?: TokenizerResolver): void {
  const existing = this.db
    .prepare('SELECT tokenizer_version FROM knowledge_document_index_config WHERE singleton_id = 1')
    .get() as { tokenizer_version: KnowledgeDocumentIndexTokenizer } | undefined;
  if (existing) {
    this.tokenizer = existing.tokenizer_version;
    this.ensureFtsTable(existing.tokenizer_version);
    return;
  }

  const trigramAvailable = probeTrigram(this.db);
  const selected = resolveTokenizer?.(this.db) ?? (
    trigramAvailable
      ? KnowledgeDocumentIndexTokenizers.TrigramV1
      : KnowledgeDocumentIndexTokenizers.CjkBigramV1
  );
  this.ensureFtsTable(selected);
  const now = new Date().toISOString();
  this.db.prepare(`
    INSERT INTO knowledge_document_index_config (
      singleton_id, schema_version, tokenizer_mode, tokenizer_version,
      trigram_available, updated_at
    ) VALUES (1, 1, ?, ?, ?, ?)
  `).run(selected, selected, trigramAvailable ? 1 : 0, now);
  this.tokenizer = selected;
}
```

`ensureFtsTable` creates one contentful table and throws if an existing table disagrees with the
persisted config instead of deleting/rebuilding it silently:

```ts
private ensureFtsTable(tokenizer: KnowledgeDocumentIndexTokenizer): void {
  const tokenize = tokenizer === KnowledgeDocumentIndexTokenizers.TrigramV1
    ? 'trigram'
    : 'unicode61 remove_diacritics 2';
  const existing = this.db.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = 'knowledge_document_chunks_fts'
  `).get() as { sql: string } | undefined;
  if (existing && !existing.sql.toLowerCase().includes(`tokenize='${tokenize}'`)) {
    throw new Error('Persisted knowledge index tokenizer does not match the FTS table');
  }
  this.db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_document_chunks_fts USING fts5(
      storage_id UNINDEXED,
      chunk_id UNINDEXED,
      index_generation_id UNINDEXED,
      workspace_id UNINDEXED,
      document_id UNINDEXED,
      document_version_id UNINDEXED,
      search_text,
      tokenize='${tokenize}'
    )
  `);
}
```

Only the locally selected constant reaches `tokenize`; no renderer value enters this SQL.

- [ ] **Step 5: Implement exact read and schedule APIs**

Define the stable state-conflict error in this store module:

```ts
export class KnowledgeDocumentIndexStateError extends Error {
  readonly code = KnowledgeBaseErrorCode.JobStateConflict;

  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeDocumentIndexStateError';
  }
}
```

Expose these signatures:

```ts
getTokenizer(): KnowledgeDocumentIndexTokenizer;
getState(documentVersionId: string): KnowledgeDocumentIndexState | null;
listStates(workspaceId: string): KnowledgeDocumentIndexState[];
getSummary(documentVersionId: string): KnowledgeDocumentIndexSummary | null;
listAttempts(documentVersionId: string): KnowledgeDocumentIndexAttempt[];
scheduleCurrentVersion(input: {
  workspaceId: string;
  documentId: string;
  documentVersionId: string;
}, now?: string): KnowledgeDocumentIndexState;
claimNext(now?: string): KnowledgeDocumentIndexClaim | null;
heartbeat(input: {
  documentVersionId: string;
  attemptId: string;
}, now?: string): boolean;
recoverAbandonedIndexing(staleBefore: string, now?: string): number;
reconcileMissingStates(now?: string): {
  pendingCount: number;
  notApplicableCount: number;
};
```

`scheduleCurrentVersion` must read the version, active document, and existing
`enterprise_lead_workspaces` row in the same connection; callers do not pass `hasText` or body
content. Its upsert is:

```sql
INSERT INTO knowledge_document_index_state (
  document_version_id, workspace_id, document_id, status, tokenizer_version,
  chunk_count, attempt_count, active_attempt_id, published_generation_id,
  error_code, requested_at, started_at, heartbeat_at, completed_at, updated_at
)
VALUES (
  ?, ?, ?, ?, ?, 0,
  COALESCE((
    SELECT MAX(attempt_number)
    FROM knowledge_document_index_attempts
    WHERE document_version_id = ?
  ), 0),
  NULL, NULL, NULL, ?, NULL, NULL, ?, ?
)
ON CONFLICT(document_version_id) DO UPDATE SET
  workspace_id = excluded.workspace_id,
  document_id = excluded.document_id,
  status = excluded.status,
  tokenizer_version = excluded.tokenizer_version,
  chunk_count = 0,
  active_attempt_id = NULL,
  published_generation_id = NULL,
  error_code = NULL,
  requested_at = excluded.requested_at,
  started_at = NULL,
  heartbeat_at = NULL,
  completed_at = excluded.completed_at,
  updated_at = excluded.updated_at
```

Use `pending` with `completed_at = NULL` for non-empty trimmed text and `not_applicable` with
`completed_at = now` for empty/null text. Reject a workspace/document/version mismatch or deleted
document with `KnowledgeDocumentIndexStateError` (defined in this store module) so the service layer
maps it to `JobStateConflict` without leaking SQL details.

- [ ] **Step 6: Implement claim, heartbeat, recovery, and reconciliation transactions**

The claim selector must join the active current version:

```sql
SELECT state.document_version_id
FROM knowledge_document_index_state AS state
JOIN enterprise_lead_workspaces AS workspace
  ON workspace.id = state.workspace_id
JOIN knowledge_documents AS document
  ON document.id = state.document_id
  AND document.workspace_id = state.workspace_id
  AND document.current_version_id = state.document_version_id
  AND document.deleted_at IS NULL
JOIN knowledge_document_versions AS version
  ON version.id = state.document_version_id
  AND version.document_id = state.document_id
WHERE state.status = ? AND TRIM(COALESCE(version.extracted_text, '')) <> ''
ORDER BY state.requested_at ASC, state.document_version_id ASC
LIMIT 1
```

Inside one transaction, update `pending -> indexing` with a status CAS, increment attempt count,
set `active_attempt_id`, insert one `running` attempt, then return the exact extracted text. Heartbeat
must update only when both state and attempt still own the lease:

```sql
UPDATE knowledge_document_index_state
SET heartbeat_at = ?, updated_at = ?
WHERE document_version_id = ? AND status = ? AND active_attempt_id = ?
```

Recovery must mark each running attempt `abandoned` and requeue its state to `pending` only when
`heartbeat_at IS NULL OR heartbeat_at < staleBefore`. Reconciliation must select active current
versions whose `workspace_id` still exists in `enterprise_lead_workspaces`, with document status
`ready` or `completed_without_text` and no state, then call `scheduleCurrentVersion` inside one outer
transaction.

- [ ] **Step 7: Run queue/store tests and task lint**

Run:

```bash
npm test -- src/main/knowledgeBase/knowledgeDocumentIndexStore.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/main/knowledgeBase/knowledgeDocumentIndexStore.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexStore.test.ts
```

Expected: schema, persisted tokenizer, schedule, claim, heartbeat, recovery, and reconciliation tests
PASS. Do not stage or commit the files.

---

### Task 4: Atomic Publication, FTS Retrieval, Retry, and Cleanup

**Files:**

- Modify: `src/main/knowledgeBase/knowledgeDocumentIndexStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentIndexStore.test.ts`

**Interfaces:**

- Consumes the claimed state and chunks from Tasks 2–3.
- Completes `KnowledgeDocumentIndexStore` with `publishVersion`, `failAttempt`,
  `retryFailedVersion`, `deactivateVersion`, `listVersionChunks`, `searchWorkspace`, and
  `deleteWorkspaceIndex`.
- Tasks 5–7 rely on the active-attempt CAS and lifecycle methods defined here.

- [ ] **Step 1: Write failing atomic-publication tests**

Add these local helpers to the same store test file:

```ts
const scheduleText = (
  documents: KnowledgeDocumentStore,
  store: KnowledgeDocumentIndexStore,
  workspaceId: string,
  text: string,
) => {
  const target = createReadyDocument(documents, workspaceId, text);
  store.scheduleCurrentVersion({
    workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
  });
  return target;
};

const publishTarget = (
  store: KnowledgeDocumentIndexStore,
  target: ReturnType<typeof createReadyDocument>,
) => {
  const claim = store.claimNext();
  if (!claim || claim.state.documentVersionId !== target.version.id) {
    throw new Error('Expected the target version to be the next index claim');
  }
  const chunks = chunkKnowledgeDocumentVersion({
    documentVersionId: target.version.id,
    text: target.text,
  });
  for (let offset = 0; offset < chunks.length; offset += KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS) {
    store.stageVersionBatch({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: claim.attempt.id,
      chunks: chunks.slice(offset, offset + KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS),
    });
  }
  return store.publishVersion({
    workspaceId: target.document.workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
    attemptId: claim.attempt.id,
    chunkCount: chunks.length,
  });
};

const createIndexStoreWithTokenizer = (tokenizer: KnowledgeDocumentIndexTokenizer) => {
  const db = new Database(':memory:');
  ensureWorkspace(db, 'workspace-a');
  ensureWorkspace(db, 'workspace-b');
  const documents = new KnowledgeDocumentStore(db);
  const store = new KnowledgeDocumentIndexStore(db, {
    resolveTokenizer: () => tokenizer,
  });
  return { db, documents, store };
};

const publishText = (
  documents: KnowledgeDocumentStore,
  store: KnowledgeDocumentIndexStore,
  workspaceId: string,
  text: string,
) => publishTarget(store, scheduleText(documents, store, workspaceId, text));
```

Add tests that claim two documents, publish only one, reject a late worker, and prove unrelated
chunks survive:

```ts
test('publishes chunks, FTS rows, attempt, and state atomically for one version', () => {
  const { db, documents, store } = createIndexStoreWithTokenizer(
    KnowledgeDocumentIndexTokenizer.CjkBigramV1,
  );
  const other = scheduleText(documents, store, 'workspace-a', 'other searchable text');
  publishTarget(store, other);
  const target = scheduleText(
    documents,
    store,
    'workspace-a',
    'target searchable text '.repeat(2_000),
  );

  const claim = store.claimNext('2026-07-11T00:00:02.000Z');
  const chunks = chunkKnowledgeDocumentVersion({
    documentVersionId: target.version.id,
    text: target.text,
  });
  for (let offset = 0; offset < chunks.length; offset += KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS) {
    store.stageVersionBatch({
      workspaceId: target.document.workspaceId,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      attemptId: claim!.attempt.id,
      chunks: chunks.slice(offset, offset + KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS),
    });
  }
  expect(store.listVersionChunks(target.version.id)).toEqual([]);
  expect(store.searchWorkspace({
    workspaceId: target.document.workspaceId,
    query: 'target searchable',
  })).toEqual([]);
  const indexed = store.publishVersion({
    workspaceId: target.document.workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
    attemptId: claim!.attempt.id,
    chunkCount: chunks.length,
  });

  expect(indexed.status).toBe(KnowledgeDocumentIndexStatus.Indexed);
  expect(indexed.chunkCount).toBe(chunks.length);
  expect(store.searchWorkspace({
    workspaceId: target.document.workspaceId,
    query: 'target searchable',
  }).length).toBeGreaterThan(0);
  expect(store.listVersionChunks(other.version.id)).toHaveLength(1);
  expect(store.listAttempts(target.version.id).at(-1)?.outcome).toBe(
    KnowledgeDocumentIndexAttemptOutcome.Indexed,
  );
  db.close();
});

test('rolls back a late publication after document deletion', () => {
  const { db, documents, store, target } = createScheduledIndexStore();
  const claim = store.claimNext()!;
  const chunks = chunkKnowledgeDocumentVersion({
    documentVersionId: target.version.id,
    text: target.text,
  });
  store.stageVersionBatch({
    workspaceId: target.document.workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
    attemptId: claim.attempt.id,
    chunks,
  });
  documents.softDeleteDocument(target.document.id, target.document.revision);

  expect(() => store.publishVersion({
    workspaceId: target.document.workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
    attemptId: claim.attempt.id,
    chunkCount: chunks.length,
  })).toThrow(KnowledgeDocumentIndexStateError);
  expect(store.listVersionChunks(target.version.id)).toEqual([]);
  db.close();
});

test('rejects an old-version publication and indexes only the replacement version', () => {
  const { db, documents, store, target } = createScheduledIndexStore();
  const oldClaim = store.claimNext()!;
  const oldChunks = chunkKnowledgeDocumentVersion({
    documentVersionId: target.version.id,
    text: target.text,
  });
  store.stageVersionBatch({
    workspaceId: target.document.workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
    attemptId: oldClaim.attempt.id,
    chunks: oldChunks,
  });
  const replacement = documents.addVersion(target.document.id, target.document.revision, {
    contentHash: 'b'.repeat(64),
    managedPath: 'blobs/bb/replacement',
    mimeType: 'text/plain',
    fileSize: 16,
    sourceMtime: null,
    parser: 'text',
    extractedText: 'replacement searchable text',
    extractionPartial: false,
  });

  expect(() => store.publishVersion({
    workspaceId: target.document.workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
    attemptId: oldClaim.attempt.id,
    chunkCount: oldChunks.length,
  })).toThrow(KnowledgeDocumentIndexStateError);
  store.deactivateVersion({
    workspaceId: target.document.workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
  });
  store.scheduleCurrentVersion({
    workspaceId: replacement.document.workspaceId,
    documentId: replacement.document.id,
    documentVersionId: replacement.version.id,
  });
  publishTarget(store, { ...replacement, text: 'replacement searchable text' });
  expect(store.listVersionChunks(target.version.id)).toEqual([]);
  expect(store.listVersionChunks(replacement.version.id)).toHaveLength(1);
  db.close();
});

test('rejects publication when the owning workspace no longer exists', () => {
  const { db, store, target } = createScheduledIndexStore();
  const claim = store.claimNext()!;
  const chunks = chunkKnowledgeDocumentVersion({
    documentVersionId: target.version.id,
    text: target.text,
  });
  store.stageVersionBatch({
    workspaceId: target.document.workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
    attemptId: claim.attempt.id,
    chunks,
  });
  db.prepare('DELETE FROM enterprise_lead_workspaces WHERE id = ?')
    .run(target.document.workspaceId);

  expect(() => store.publishVersion({
    workspaceId: target.document.workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
    attemptId: claim.attempt.id,
    chunkCount: chunks.length,
  })).toThrow(KnowledgeDocumentIndexStateError);
  expect(store.listVersionChunks(target.version.id)).toEqual([]);
  db.close();
});

test('rolls back all inserts when an invalid chunk violates publication', () => {
  const { db, store, target } = createScheduledIndexStore();
  const claim = store.claimNext()!;
  const duplicateChunks = chunkKnowledgeDocumentVersion({
    documentVersionId: target.version.id,
    text: target.text,
    targetChars: 4,
    overlapChars: 1,
  });
  duplicateChunks[1] = { ...duplicateChunks[1], id: duplicateChunks[0].id };

  expect(() => store.stageVersionBatch({
    workspaceId: target.document.workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
    attemptId: claim.attempt.id,
    chunks: duplicateChunks,
  })).toThrow();
  expect(store.listVersionChunks(target.version.id)).toEqual([]);
  expect(store.getState(target.version.id)?.status).toBe(
    KnowledgeDocumentIndexStatus.Indexing,
  );
  db.close();
});

test('converges pending and indexing states when the worker becomes unavailable', () => {
  const { db, documents, store, target } = createScheduledIndexStore();
  const runningClaim = store.claimNext()!;
  const pending = scheduleText(documents, store, 'workspace-a', 'pending text');

  expect(store.failRunnableStates(KnowledgeDocumentIndexErrorCode.WorkerUnavailable))
    .toBe(2);
  expect(store.getState(target.version.id)).toMatchObject({
    status: KnowledgeDocumentIndexStatus.Failed,
    errorCode: KnowledgeDocumentIndexErrorCode.WorkerUnavailable,
    activeAttemptId: null,
  });
  expect(store.getState(pending.version.id)?.status).toBe(
    KnowledgeDocumentIndexStatus.Failed,
  );
  expect(store.listAttempts(target.version.id)).toContainEqual(
    expect.objectContaining({
      id: runningClaim.attempt.id,
      outcome: KnowledgeDocumentIndexAttemptOutcome.Failed,
    }),
  );
  db.close();
});

test('purges an invisible deactivated generation in bounded worker batches', () => {
  const { db, documents, store } = createIndexStoreWithTokenizer(
    KnowledgeDocumentIndexTokenizer.CjkBigramV1,
  );
  const target = scheduleText(
    documents,
    store,
    'workspace-a',
    'cleanup generation '.repeat(20_000),
  );
  publishTarget(store, target);
  store.deactivateVersion({
    workspaceId: target.document.workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
  });

  expect(store.listVersionChunks(target.version.id)).toEqual([]);
  const rowsBeforePurge = db.prepare(
    'SELECT COUNT(*) AS count FROM knowledge_document_chunks WHERE document_version_id = ?',
  ).get(target.version.id) as { count: number };
  expect(rowsBeforePurge.count).toBeGreaterThan(0);
  let deleted = 0;
  let batchCount = store.purgeInactiveGenerationBatch();
  while (batchCount > 0) {
    expect(batchCount).toBeLessThanOrEqual(KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS);
    deleted += batchCount;
    batchCount = store.purgeInactiveGenerationBatch();
  }
  expect(deleted).toBeGreaterThan(0);
  expect(db.prepare(
    'SELECT COUNT(*) AS count FROM knowledge_document_chunks WHERE document_version_id = ?',
  ).get(target.version.id)).toEqual({ count: 0 });
  db.close();
});
```

Also add guard-focused regressions that call `stageVersionBatch` after the document is deleted or
its current version is replaced, while the old index state and attempt lease still exist. Both stage
and publish must fail with `KnowledgeDocumentIndexStateError`; do not call `deactivateVersion` until
after those assertions. Add crafted chunks whose checksum and logical ID are recomputed around a
fractional ordinal or fractional offsets, proving transaction-external integer validation—not a
later checksum/ID or SQLite uniqueness failure—rejects them.

- [ ] **Step 2: Write failing FTS, fallback, injection, and short-query tests**

Force both tokenizer modes in separate databases and assert workspace scoping:

```ts
test.each([
  KnowledgeDocumentIndexTokenizer.TrigramV1,
  KnowledgeDocumentIndexTokenizer.CjkBigramV1,
])('searches Chinese text with %s and binds hostile MATCH text', tokenizer => {
  const { db, documents, store } = createIndexStoreWithTokenizer(tokenizer);
  publishText(documents, store, 'workspace-a', '企业知识库建设规范');
  publishText(documents, store, 'workspace-b', '企业知识库机密预算');

  expect(store.searchWorkspace({ workspaceId: 'workspace-a', query: '知识库' }))
    .toHaveLength(1);
  expect(store.searchWorkspace({
    workspaceId: 'workspace-a',
    query: '" OR workspace_id:* NOT "',
  })).toEqual([]);
  expect(store.searchWorkspace({ workspaceId: 'workspace-a', query: '企' }))
    .toHaveLength(1);
  db.close();
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npm test -- src/main/knowledgeBase/knowledgeDocumentIndexStore.test.ts
```

Expected: FAIL because publication, search, retry, and cleanup methods do not exist.

- [ ] **Step 4: Add publication and lifecycle signatures**

Use `KnowledgeDocumentIndexStateError` from Task 3 for every lease/current-version conflict. Add
these exact methods to the class:

```ts
stageVersionBatch(input: {
  workspaceId: string;
  documentId: string;
  documentVersionId: string;
  attemptId: string;
  chunks: KnowledgeDocumentChunkDraft[];
}, now?: string): number;

publishVersion(input: {
  workspaceId: string;
  documentId: string;
  documentVersionId: string;
  attemptId: string;
  chunkCount: number;
}, now?: string): KnowledgeDocumentIndexState;

failAttempt(input: {
  documentVersionId: string;
  attemptId: string;
  errorCode: KnowledgeDocumentIndexErrorCode;
}, now?: string): KnowledgeDocumentIndexState;

failRunnableStates(
  errorCode: KnowledgeDocumentIndexErrorCode,
  now?: string,
): number;

retryFailedVersion(input: {
  documentId: string;
  documentVersionId: string;
}, now?: string): KnowledgeDocumentIndexState;

deactivateVersion(input: {
  workspaceId: string;
  documentId: string;
  documentVersionId: string;
}, now?: string): void;

listVersionChunks(documentVersionId: string, options?: {
  afterOrdinal?: number;
  limit?: number;
}): KnowledgeDocumentChunk[];

searchWorkspace(input: {
  workspaceId: string;
  query: string;
  limit?: number;
}): KnowledgeDocumentChunkSearchHit[];

purgeInactiveGenerationBatch(limit?: number): number;

deleteWorkspaceIndex(workspaceId: string): void;
```

- [ ] **Step 5: Implement guarded batch staging and atomic generation activation**

At the start of every `stageVersionBatch` and `publishVersion` transaction, read a single target row
using this guard, including explicit workspace existence:

```sql
SELECT
  state.status,
  state.active_attempt_id,
  document.deleted_at,
  document.current_version_id
FROM knowledge_document_index_state AS state
JOIN enterprise_lead_workspaces AS workspace
  ON workspace.id = state.workspace_id
JOIN knowledge_documents AS document
  ON document.id = state.document_id
  AND document.workspace_id = state.workspace_id
WHERE
  state.workspace_id = ?
  AND state.document_id = ?
  AND state.document_version_id = ?
LIMIT 1
```

Throw `KnowledgeDocumentIndexStateError` unless the document is active, its current version equals
the target, state is `indexing`, and `active_attempt_id` equals the supplied attempt.

`stageVersionBatch` rejects an empty batch and any batch longer than
`KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS`. Before opening `db.transaction`, it derives each physical
storage ID as `sha256(attemptId + '\0' + chunk.id)` and computes every normalized `search_text` with
`buildKnowledgeFtsSearchText`; chunk hashing, normalization, and JSON serialization must not run
while the SQLite writer lock is held. It also recomputes each content checksum and logical chunk ID,
requires `ordinal`, `startOffset`, and `endOffset` to be non-negative integers,
requires `endOffset >= startOffset` and `endOffset - startOffset === content.length`, and rejects any
mismatch before writing. Do not rely on SQLite `INTEGER` affinity: these tables are not `STRICT` and
would otherwise accept fractional values. The short transaction then performs only the guard and
bound inserts, using
`index_generation_id = attemptId`:

```sql
INSERT INTO knowledge_document_chunks (
  storage_id, id, index_generation_id, workspace_id, document_id,
  document_version_id, ordinal, content, start_offset, end_offset,
  page_number, sheet_name, slide_number, heading_path_json, checksum, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
```

```sql
INSERT INTO knowledge_document_chunks_fts (
  storage_id, chunk_id, index_generation_id, workspace_id,
  document_id, document_version_id, search_text
) VALUES (?, ?, ?, ?, ?, ?, ?)
```

`search_text` must come only from
`buildKnowledgeFtsSearchText(chunk.content, this.tokenizer)`. Staged rows remain invisible because
all public list/search queries join the state's `published_generation_id`; a failed or half-written
generation therefore cannot leak partial results.

Before `publishVersion` activates a generation, query its staged rows and require exact
`COUNT(*) = chunkCount`, `COUNT(DISTINCT id) = chunkCount`, `MIN(ordinal) = 0`, and
`MAX(ordinal) = chunkCount - 1`; `chunkCount` must be positive because empty text is never claimed
and is represented by `not_applicable`. Complete the attempt with an active outcome CAS, then
atomically flip visibility with this short state CAS:

```sql
UPDATE knowledge_document_index_state
SET
  status = ?,
  chunk_count = ?,
  active_attempt_id = NULL,
  published_generation_id = ?,
  error_code = NULL,
  heartbeat_at = NULL,
  completed_at = ?,
  updated_at = ?
WHERE
  document_version_id = ?
  AND status = ?
  AND active_attempt_id = ?
```

If either attempt or state update changes zero rows, throw so the outer transaction rolls back all
state changes. Chunk/FTS rows were already staged in bounded transactions but stay invisible unless
this activation commits.

- [ ] **Step 6: Implement failure, explicit retry, deactivation, and workspace deletion**

`failAttempt` must update only the matching running attempt and active lease, store only one of the
stable `KnowledgeDocumentIndexErrorCode` values, clear the active attempt, and leave chunks at zero.
`retryFailedVersion` must join the active current non-deleted document and update only
`failed -> pending`; it does not touch document status, document revision, or ingestion jobs.

`failRunnableStates` is reserved for an unexpected worker startup/error/exit. In one transaction it
marks all running attempts `failed`, then changes every `pending` or `indexing` state to `failed`
with `index_worker_unavailable`, clears the active attempt, and leaves staged generations invisible.
Planned application shutdown must not call it; startup recovery will abandon/requeue an interrupted
shutdown attempt on the next launch.

`deactivateVersion` runs one transaction with these exact effects:

Bind `KnowledgeDocumentIndexAttemptOutcome.Cancelled` and
`KnowledgeDocumentIndexErrorCode.StateConflict` as parameters in production; the SQL below shows the
resulting values.

```sql
UPDATE knowledge_document_index_attempts
SET outcome = 'cancelled', finished_at = ?, error_code = 'index_state_conflict'
WHERE document_version_id = ? AND outcome = 'running';

DELETE FROM knowledge_document_index_state WHERE document_version_id = ?;
```

Removing the state makes every existing generation immediately invisible without a large
main-thread delete. `purgeInactiveGenerationBatch` runs only in the worker, selects at most
`KNOWLEDGE_INDEX_CLEANUP_BATCH_ROWS` physical rows whose generation is neither an active attempt nor
a published generation, deletes matching FTS rows and chunk rows in one short transaction, and
returns the deleted count so the runner can continue until zero.

Because attempts are retained, `scheduleCurrentVersion` from Task 3 must initialize a newly inserted
state's `attempt_count` from `COALESCE(MAX(attempt_number), 0)` for that version. This preserves the
unique attempt sequence after delete/restore.

`deleteWorkspaceIndex` explicitly deletes in this order inside its caller's outer transaction:

```sql
DELETE FROM knowledge_document_index_attempts
WHERE document_version_id IN (
  SELECT version.id
  FROM knowledge_document_versions AS version
  JOIN knowledge_documents AS document ON document.id = version.document_id
  WHERE document.workspace_id = ?
);
DELETE FROM knowledge_document_index_state WHERE workspace_id = ?;
DELETE FROM knowledge_document_chunks_fts WHERE workspace_id = ?;
DELETE FROM knowledge_document_chunks WHERE workspace_id = ?;
```

- [ ] **Step 7: Implement parameterized retrieval and the short-query fallback**

`listVersionChunks` must return only the generation referenced by the version state's
`published_generation_id`; it never returns staged, failed, cancelled, or obsolete generations.
Map physical `storage_id`/generation fields only to internal `KnowledgeDocumentChunk`, and return the
stable logical `id` as `chunkId` in search hits.

Clamp `limit` to 1–100. Compute the normalized query's Unicode code-point length with
`Array.from(query).length`. Use the workspace-bounded non-FTS query below for fewer than three code
points in trigram mode and fewer than two code points in CJK-bigram mode, because those tokenizers
cannot return shorter terms:

```sql
SELECT
  chunk.id AS chunk_id,
  chunk.document_id,
  chunk.document_version_id,
  chunk.ordinal,
  chunk.content,
  chunk.start_offset,
  chunk.end_offset,
  0 AS rank
FROM knowledge_document_chunks AS chunk
JOIN knowledge_document_index_state AS state
  ON state.document_version_id = chunk.document_version_id
  AND state.status = 'indexed'
  AND state.published_generation_id = chunk.index_generation_id
JOIN knowledge_documents AS document
  ON document.id = chunk.document_id
  AND document.current_version_id = chunk.document_version_id
  AND document.deleted_at IS NULL
WHERE chunk.workspace_id = ? AND instr(lower(chunk.content), lower(?)) > 0
ORDER BY chunk.document_id ASC, chunk.ordinal ASC
LIMIT ?
```

For other non-empty queries, call `buildKnowledgeFtsMatchQuery` and bind it as `?`:

```sql
SELECT
  chunk.id AS chunk_id,
  chunk.document_id,
  chunk.document_version_id,
  chunk.ordinal,
  chunk.content,
  chunk.start_offset,
  chunk.end_offset,
  bm25(knowledge_document_chunks_fts) AS rank
FROM knowledge_document_chunks_fts
JOIN knowledge_document_chunks AS chunk
  ON chunk.storage_id = knowledge_document_chunks_fts.storage_id
JOIN knowledge_document_index_state AS state
  ON state.document_version_id = chunk.document_version_id
  AND state.status = 'indexed'
  AND state.published_generation_id = chunk.index_generation_id
JOIN knowledge_documents AS document
  ON document.id = chunk.document_id
  AND document.current_version_id = chunk.document_version_id
  AND document.deleted_at IS NULL
WHERE
  knowledge_document_chunks_fts.workspace_id = ?
  AND knowledge_document_chunks_fts MATCH ?
ORDER BY rank ASC, chunk.document_id ASC, chunk.ordinal ASC
LIMIT ?
```

Catch only SQLite's invalid-MATCH error at the public search boundary and return an empty list;
rethrow persistence/corruption errors so they remain diagnosable in main-process logs.

- [ ] **Step 8: Run full store coverage and task lint**

Run:

```bash
npm test -- src/main/knowledgeBase/knowledgeDocumentIndexStore.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/main/knowledgeBase/knowledgeDocumentIndexStore.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexStore.test.ts
```

Expected: publication atomicity, unrelated-version preservation, both Chinese retrieval modes,
short query, hostile query, late-worker rejection, retry, deactivation, and workspace cleanup all
PASS. Do not stage or commit the files.

---

### Task 5: Independent SQLite Connection and Worker-Thread Execution

**Files:**

- Create: `src/main/libs/sqliteConnectionPolicy.ts`
- Create: `src/main/libs/sqliteConnectionPolicy.test.ts`
- Modify: `src/main/libs/sqliteBackup/sqliteBackupManager.ts`
- Create: `src/main/knowledgeBase/knowledgeDocumentIndexRunner.ts`
- Create: `src/main/knowledgeBase/knowledgeDocumentIndexExecutor.ts`
- Create: `src/main/knowledgeBase/knowledgeDocumentIndexExecutor.test.ts`
- Create: `src/main/knowledgeBase/knowledgeDocumentIndexWorker.ts`
- Create: `src/main/knowledgeBase/knowledgeDocumentIndexWorkerPath.ts`
- Create: `src/main/knowledgeBase/knowledgeDocumentIndexWorkerPath.test.ts`
- Create: `src/main/knowledgeBase/knowledgeDocumentIndexService.ts`
- Create: `src/main/knowledgeBase/knowledgeDocumentIndexService.test.ts`
- Create: `src/main/knowledgeBase/knowledgeDocumentIndexBuildContract.test.ts`
- Modify: `vite.config.mts`
- Modify: `electron-builder.json`
- Modify: `package.json`

**Interfaces:**

- Consumes the store and chunker from Tasks 2–4.
- Produces `applySqliteConnectionPolicy`, `runKnowledgeDocumentIndexUntilIdle`,
  `KnowledgeDocumentIndexExecutor`, `InlineKnowledgeDocumentIndexExecutor`,
  `WorkerKnowledgeDocumentIndexExecutor`, `KnowledgeDocumentIndexService`, and
  `resolveKnowledgeDocumentIndexWorkerPath`.
- Task 6 composes the worker executor in production and injects the inline executor in in-memory
  tests.

- [ ] **Step 1: Write a failing two-connection SQLite policy test**

Use a temporary file database, apply the policy to two independent handles, and verify exact values:

```ts
test('applies the same WAL and busy policy to independent connections', () => {
  const databasePath = path.join(tempDirectory, 'knowledge.sqlite');
  const mainDb = new Database(databasePath);
  const workerDb = new Database(databasePath);

  applySqliteConnectionPolicy(mainDb);
  applySqliteConnectionPolicy(workerDb);

  for (const db of [mainDb, workerDb]) {
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('synchronous', { simple: true })).toBe(1);
    expect(db.pragma('cache_size', { simple: true })).toBe(-8000);
    expect(db.pragma('wal_autocheckpoint', { simple: true })).toBe(1000);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
  }

  workerDb.close();
  mainDb.close();
});
```

- [ ] **Step 2: Run the policy test and verify RED**

Run:

```bash
npm test -- src/main/libs/sqliteConnectionPolicy.test.ts
```

Expected: FAIL because the shared connection policy does not exist.

- [ ] **Step 3: Extract the exact connection policy**

Create:

```ts
import Database from 'better-sqlite3';

export const applySqliteConnectionPolicy = (db: Database.Database): void => {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -8000');
  db.pragma('wal_autocheckpoint = 1000');
  db.pragma('busy_timeout = 5000');
};
```

Delete the private `applyRecommendedPragmas` from `sqliteBackupManager.ts`, import this function,
and replace both existing calls. Do not enable foreign keys globally because current workspace
deletion still uses explicit ordering.

- [ ] **Step 4: Write failing runner and service tests**

Add these exact local test helpers:

```ts
const ensureWorkerTestWorkspace = (db: Database.Database): void => {
  new EnterpriseLeadWorkspaceStore(db);
  db.prepare(`
    INSERT INTO enterprise_lead_workspaces (
      id, name, type, profile, extraction_sources, risk_rules,
      enabled_agent_roles, settings, workspace_agents, recent_run_id,
      created_at, updated_at
    ) VALUES (
      'workspace-a', 'workspace-a', 'enterprise_lead', '{}', '[]', '[]',
      '[]', NULL, NULL, NULL, '2026-07-11T00:00:00.000Z',
      '2026-07-11T00:00:00.000Z'
    )
  `).run();
};

const createStoreWithPendingVersions = (count: number) => {
  const db = new Database(':memory:');
  ensureWorkerTestWorkspace(db);
  const documents = new KnowledgeDocumentStore(db);
  const store = new KnowledgeDocumentIndexStore(db, {
    resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
  });
  for (let index = 0; index < count; index += 1) {
    const created = documents.createDocumentWithVersion({
      workspaceId: 'workspace-a',
      displayName: `document-${index}.txt`,
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: {
        contentHash: String(index).padStart(64, '0'),
        managedPath: `blobs/test/${index}`,
        mimeType: 'text/plain',
        fileSize: 20,
        sourceMtime: null,
        parser: 'text',
        extractedText: `searchable text ${index}`,
        extractionPartial: false,
      },
    });
    store.scheduleCurrentVersion({
      workspaceId: created.document.workspaceId,
      documentId: created.document.id,
      documentVersionId: created.version.id,
    });
  }
  return { db, store };
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(innerResolve => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};
```

Use the in-memory store for inline execution and a fake executor for wake coalescing:

```ts
test('inline executor drains every pending version through the shared runner', async () => {
  const { db, store } = createStoreWithPendingVersions(3);
  const executor = new InlineKnowledgeDocumentIndexExecutor(store);

  await expect(executor.runUntilIdle()).resolves.toEqual({
    indexedCount: 3,
    failedCount: 0,
  });
  expect(store.listStates('workspace-a').every(
    state => state.status === KnowledgeDocumentIndexStatus.Indexed,
  )).toBe(true);
  db.close();
});

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

test('converges an unexpected executor failure to durable retryable state', async () => {
  const executor = {
    runUntilIdle: vi.fn(async () => {
      throw new Error('worker exited');
    }),
    shutdown: vi.fn(async () => undefined),
  } satisfies KnowledgeDocumentIndexExecutor;
  const failRunnableStates = vi.fn(() => 2);
  const service = new KnowledgeDocumentIndexService(executor, { failRunnableStates });

  service.wake();
  await expect(service.waitForIdle()).resolves.toBeUndefined();

  expect(failRunnableStates).toHaveBeenCalledWith(
    KnowledgeDocumentIndexErrorCode.WorkerUnavailable,
  );
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
```

Also add two lifecycle regressions with real assertions:

- Reject the first active executor run after a second `wake()` has been coalesced. Assert
  `waitForIdle()` settles, the run/construction count remains one after a short observation window,
  and only a later explicit retry plus `wake()` starts the second run.
- Make `failRunnableStates` throw a SQLite-like persistence error while the executor is failing.
  Assert `waitForIdle()` still resolves without an unhandled rejection and the service does not
  start another run automatically.

- [ ] **Step 5: Implement the shared runner with stable failure handling**

Expose this exact executor contract:

```ts
export interface KnowledgeDocumentIndexExecutor {
  runUntilIdle(): Promise<KnowledgeDocumentIndexRunResult>;
  shutdown(): Promise<void>;
}
```

The runner loops synchronously inside its own execution context and never accepts document body from
the main process:

```ts
export const runKnowledgeDocumentIndexUntilIdle = (
  store: KnowledgeDocumentIndexStore,
): KnowledgeDocumentIndexRunResult => {
  let indexedCount = 0;
  let failedCount = 0;
  while (store.purgeInactiveGenerationBatch() > 0) {
    // Keep each write lock bounded while draining invisible generations.
  }
  let claim = store.claimNext();
  while (claim) {
    try {
      let lastHeartbeat = Date.now();
      const chunks = chunkKnowledgeDocumentVersion({
        documentVersionId: claim.state.documentVersionId,
        text: claim.extractedText,
        onProgress: () => {
          const now = Date.now();
          if (now - lastHeartbeat >= 10_000) {
            store.heartbeat({
              documentVersionId: claim!.state.documentVersionId,
              attemptId: claim!.attempt.id,
            });
            lastHeartbeat = now;
          }
        },
      });
      for (
        let offset = 0;
        offset < chunks.length;
        offset += KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS
      ) {
        store.stageVersionBatch({
          workspaceId: claim.state.workspaceId,
          documentId: claim.state.documentId,
          documentVersionId: claim.state.documentVersionId,
          attemptId: claim.attempt.id,
          chunks: chunks.slice(offset, offset + KNOWLEDGE_INDEX_WRITE_BATCH_CHUNKS),
        });
      }
      store.publishVersion({
        workspaceId: claim.state.workspaceId,
        documentId: claim.state.documentId,
        documentVersionId: claim.state.documentVersionId,
        attemptId: claim.attempt.id,
        chunkCount: chunks.length,
      });
      indexedCount += 1;
    } catch (error) {
      failedCount += 1;
      try {
        store.failAttempt({
          documentVersionId: claim.state.documentVersionId,
          attemptId: claim.attempt.id,
          errorCode: error instanceof KnowledgeDocumentIndexStateError
            ? KnowledgeDocumentIndexErrorCode.StateConflict
            : KnowledgeDocumentIndexErrorCode.ProcessingFailed,
        });
      } catch (persistError) {
        console.warn('[KnowledgeBase] Failed to persist local index attempt failure:', persistError);
      }
    }
    while (store.purgeInactiveGenerationBatch() > 0) {
      // Obsolete/failed generations remain invisible while physical rows are reclaimed.
    }
    claim = store.claimNext();
  }
  return { indexedCount, failedCount };
};
```

The inline executor calls this function and resolves; its `shutdown()` marks itself closed and later
`runUntilIdle()` calls reject with `KnowledgeDocumentIndexErrorCode.WorkerUnavailable`.

- [ ] **Step 6: Implement service single-flight semantics**

Mirror the existing ingestion service's coalescing behavior without copying ingestion state:

```ts
export class KnowledgeDocumentIndexService {
  private drainPromise: Promise<void> | null = null;
  private wakeRequested = false;
  private closed = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(
    private readonly executor: KnowledgeDocumentIndexExecutor,
    private readonly indexStore: Pick<KnowledgeDocumentIndexStore, 'failRunnableStates'>,
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
    await activeDrain?.catch(() => undefined);
    if (shutdownError) throw shutdownError;
  }

  private async drain(): Promise<void> {
    do {
      this.wakeRequested = false;
      try {
        await this.executor.runUntilIdle();
      } catch (error) {
        this.wakeRequested = false;
        if (!this.closed) {
          try {
            this.indexStore.failRunnableStates(
              KnowledgeDocumentIndexErrorCode.WorkerUnavailable,
            );
          } catch (persistError) {
            console.error(
              '[KnowledgeBase] Failed to persist unavailable local index worker state:',
              persistError,
            );
          }
          console.error('[KnowledgeBase] Local index worker became unavailable:', error);
        }
        return;
      }
    } while (this.wakeRequested && !this.closed);
  }
}
```

- [ ] **Step 7: Write failing worker path and real-worker smoke tests**

The pure path test must assert both layouts:

```ts
test('resolves development and packaged worker bundles', () => {
  expect(resolveKnowledgeDocumentIndexWorkerPath({
    isPackaged: false,
    moduleDirectory: '/repo/dist-electron',
    resourcesPath: '/Applications/LobsterAI.app/Contents/Resources',
  })).toBe('/repo/dist-electron/knowledge-index-worker.js');
  expect(resolveKnowledgeDocumentIndexWorkerPath({
    isPackaged: true,
    moduleDirectory: '/ignored',
    resourcesPath: '/Applications/LobsterAI.app/Contents/Resources',
  })).toBe(
    '/Applications/LobsterAI.app/Contents/Resources/app.asar.unpacked/dist-electron/knowledge-index-worker.js',
  );
});
```

In the executor test file, define `workerScriptPath` as
`path.resolve('dist-electron/knowledge-index-worker.js')`; create `tempDirectory` with
`fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-index-executor-'))` in `beforeEach` and remove it
recursively in `afterEach`. Define
`const runtimeTest = fs.existsSync(workerScriptPath) ? test : test.skip` for compiled-worker cases;
Task 10 reruns them after a mandatory build.

The executor smoke test uses a temporary file database, initializes document/index tables on the
main connection, launches `WorkerKnowledgeDocumentIndexExecutor` with the compiled fixture worker,
and asserts that the main connection observes `indexed` after `runUntilIdle()`. Skip only when the
compiled worker artifact is absent in an isolated unit-test invocation; the build-contract and final
verification steps make artifact presence mandatory.

Add these failure assertions around the same executor factory:

```ts
test('does not create a database when the worker receives a wrong path', async () => {
  const missingPath = path.join(tempDirectory, 'missing', 'knowledge.sqlite');
  const executor = new WorkerKnowledgeDocumentIndexExecutor({
    databasePath: missingPath,
    workerScriptPath,
  });
  await expect(executor.runUntilIdle()).rejects.toThrow('index_worker_unavailable');
  expect(fs.existsSync(missingPath)).toBe(false);
  await executor.shutdown().catch(() => undefined);
});

test('shuts down an active service drain with a non-responsive worker within six seconds', async () => {
  const databasePath = path.join(tempDirectory, 'hanging.sqlite');
  const db = new Database(databasePath);
  new EnterpriseLeadWorkspaceStore(db);
  new KnowledgeDocumentStore(db);
  const indexStore = new KnowledgeDocumentIndexStore(db, {
    resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
  });
  const executor = new WorkerKnowledgeDocumentIndexExecutor({
    databasePath,
    workerScriptPath,
    workerFactory: () => new Worker('while (true) {}', { eval: true }),
  });
  const service = new KnowledgeDocumentIndexService(executor, indexStore);
  service.wake();
  await new Promise(resolve => setTimeout(resolve, 50));
  const startedAt = performance.now();
  await service.shutdown();
  expect(performance.now() - startedAt).toBeLessThan(6_000);
  expect(() => db.close()).not.toThrow();
});
```

The test-only `workerFactory` option returns the supplied non-responsive Worker; production never
passes this option.

Add an artifact-gated recovery test: the factory returns an eval Worker that exits with code 1 on
the first `run` request and the real compiled worker on its second construction. Schedule one real
pending version, call `service.wake()`, and assert it becomes `failed` with
`index_worker_unavailable` while the factory count remains one. Then call
`retryFailedVersion`, call `service.wake()` explicitly, wait for idle, and assert the factory count
becomes two and the same version reaches `indexed`. Waiting before the explicit retry must not create
the second worker or replay the request.

```ts
runtimeTest('recreates a dead worker only after explicit retry', async () => {
  const databasePath = path.join(tempDirectory, 'restart.sqlite');
  const db = new Database(databasePath);
  ensureWorkerTestWorkspace(db);
  const documents = new KnowledgeDocumentStore(db);
  const indexStore = new KnowledgeDocumentIndexStore(db);
  const target = documents.createDocumentWithVersion({
    workspaceId: 'workspace-a',
    displayName: 'restart.txt',
    sourceMode: KnowledgeDocumentSourceMode.Managed,
    status: KnowledgeDocumentStatus.Ready,
    version: {
      contentHash: 'f'.repeat(64),
      managedPath: 'blobs/test/restart',
      mimeType: 'text/plain',
      fileSize: 12,
      sourceMtime: null,
      parser: 'text',
      extractedText: 'restart text',
      extractionPartial: false,
    },
  });
  indexStore.scheduleCurrentVersion({
    workspaceId: 'workspace-a',
    documentId: target.document.id,
    documentVersionId: target.version.id,
  });
  let constructionCount = 0;
  const executor = new WorkerKnowledgeDocumentIndexExecutor({
    databasePath,
    workerScriptPath,
    workerFactory: (filename, options) => {
      constructionCount += 1;
      if (constructionCount === 1) {
        return new Worker(`
          const { parentPort } = require('node:worker_threads');
          parentPort.once('message', () => process.exit(1));
        `, { eval: true });
      }
      return new Worker(filename, options);
    },
  });
  const service = new KnowledgeDocumentIndexService(executor, indexStore);

  service.wake();
  await service.waitForIdle();
  expect(indexStore.getState(target.version.id)).toMatchObject({
    status: KnowledgeDocumentIndexStatus.Failed,
    errorCode: KnowledgeDocumentIndexErrorCode.WorkerUnavailable,
  });
  expect(constructionCount).toBe(1);
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(constructionCount).toBe(1);

  indexStore.retryFailedVersion({
    documentId: target.document.id,
    documentVersionId: target.version.id,
  });
  service.wake();
  await service.waitForIdle();
  expect(constructionCount).toBe(2);
  expect(indexStore.getState(target.version.id)?.status).toBe(
    KnowledgeDocumentIndexStatus.Indexed,
  );

  await service.shutdown();
  db.close();
});
```

- [ ] **Step 8: Implement worker path, persistent worker protocol, and independent connection**

Implement the resolver exactly:

```ts
export const resolveKnowledgeDocumentIndexWorkerPath = (input: {
  isPackaged: boolean;
  moduleDirectory: string;
  resourcesPath: string;
}): string => input.isPackaged
  ? path.join(
      input.resourcesPath,
      'app.asar.unpacked',
      'dist-electron',
      'knowledge-index-worker.js',
    )
  : path.join(input.moduleDirectory, 'knowledge-index-worker.js');
```

`knowledgeDocumentIndexWorker.ts` reads only `{ databasePath }` from `workerData`, rejects an empty
or non-absolute path, and opens exactly
`new Database(databasePath, { fileMustExist: true })`. It applies
`applySqliteConnectionPolicy`, constructs the store, and handles `run` and `shutdown`. A wrong path
must fail without creating a new SQLite file. The worker sends only request ID, bounded counts,
stable failure code, and stopped acknowledgement; no text or chunk leaves the worker.

`WorkerKnowledgeDocumentIndexExecutor` maintains at most one live persistent Worker and serializes
`runUntilIdle()` calls. `ensureWorker()` lazily creates it on the first run. A worker `error` or
unexpected `exit` rejects and removes every pending request promise, clears the dead handle, and maps
the run to `KnowledgeDocumentIndexErrorCode.WorkerUnavailable`; it does not automatically respawn or
replay. The next explicit `runUntilIdle()`—which occurs only after a user retries a durable failed
state—calls `ensureWorker()` and creates a fresh Worker. `shutdown()` marks the executor permanently
closed, rejects all pending request promises, sends shutdown to a live worker, waits up to 5,000 ms
for `stopped`, then calls `terminate()` and awaits its exit as the cleanup fallback. A shutdown
executor never creates another Worker and never invokes the inline runner.

Add executor tests for a nonexistent database path, startup `error`, unexpected mid-run `exit`, and
a worker that never acknowledges shutdown. The first three must reject `runUntilIdle`; the service
test must then assert `failRunnableStates(WorkerUnavailable)`. The hanging-worker test must prove
`shutdown()` settles within 6,000 ms and the main test connection can immediately close afterward.

Add a controlled successful-worker regression for persistent reuse and serialization. Call
`runUntilIdle()` twice concurrently, hold the first response, and assert the second request has not
reached the Worker. Release the first and then the second; assert maximum in-flight requests is one,
the worker factory constructed exactly once, both runs resolve in order, and a post-shutdown run
rejects without constructing another Worker.

Add a concurrent service-shutdown regression with a deferred executor shutdown and active drain.
Two `service.shutdown()` calls must return the same pending Promise, neither may settle before both
executor shutdown and the captured drain settle, and the executor shutdown method runs exactly once.

- [ ] **Step 9: Add the independent Vite entry and ASAR/dev readiness contracts**

Add a third `electron([...])` entry in `vite.config.mts`:

```ts
      {
        entry: 'src/main/knowledgeBase/knowledgeDocumentIndexWorker.ts',
  vite: {
    build: {
      sourcemap: true,
      outDir: 'dist-electron',
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        external: ['better-sqlite3'],
        output: {
          entryFileNames: 'knowledge-index-worker.js',
          inlineDynamicImports: true,
            },
          },
        },
        onstart() {},
      },
},
```

Add this exact ASAR unpack entry:

```json
"dist-electron/knowledge-index-worker.js"
```

Change only the `wait-on` portion of `electron:dev` so it waits for:

```text
http://localhost:5175
dist-electron/.electron-ready
dist-electron/knowledge-index-worker.js
```

The build-contract test reads `vite.config.mts`, `electron-builder.json`, and `package.json` and
asserts the worker source path, fixed output filename, ASAR unpack entry, and actual worker-file
development wait target are all present. It also asserts the worker entry has an explicit no-op
`onstart() {}` so the plugin cannot invoke its default Electron startup, and that
`node_modules/better-sqlite3/**` remains in `asarUnpack`. Do not use an entry-specific `onstart`
marker: the installed
`vite-plugin-electron` shares completion state across entries and may call only the last entry's
callback.

- [ ] **Step 10: Run worker, policy, service, and build verification**

Run:

```bash
npm test -- \
  src/main/libs/sqliteConnectionPolicy.test.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexExecutor.test.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexWorkerPath.test.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexService.test.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexBuildContract.test.ts
npm run build
test -f dist-electron/knowledge-index-worker.js
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/main/libs/sqliteConnectionPolicy.ts \
  src/main/libs/sqliteConnectionPolicy.test.ts \
  src/main/libs/sqliteBackup/sqliteBackupManager.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexRunner.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexExecutor.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexExecutor.test.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexWorker.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexWorkerPath.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexWorkerPath.test.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexService.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexService.test.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexBuildContract.test.ts
```

Expected: focused tests and build PASS, and the worker bundle exists at the fixed path. Do not stage
or commit the files.

---

### Task 6: Atomically Hand Parsed Versions to the Index Worker

**Files:**

- Modify: `src/main/knowledgeBase/knowledgeIngestionService.ts`
- Modify: `src/main/knowledgeBase/knowledgeIngestionService.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentService.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentService.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeBaseFoundation.ts`
- Modify: `src/main/knowledgeBase/knowledgeBaseFoundation.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeBaseStartupOrder.test.ts`
- Modify: `src/main/main.ts`

**Interfaces:**

- Consumes `KnowledgeDocumentIndexStore`, `KnowledgeDocumentIndexService`, and executor types from
  Tasks 3–5.
- Produces a Foundation that exposes `indexStore`, `indexingService`, and asynchronous `shutdown()`.
- Makes parsed-text publication, ingestion completion, and local-index scheduling one transaction.
- Task 7 consumes the same composed index store/service for document lifecycle operations.

- [ ] **Step 1: Write failing ingestion atomicity tests**

Add this test-local helper, then call it immediately after opening `db` in the existing `beforeEach`
so the exact `workspace-a` owner used by `createQueuedDocument` exists:

```ts
const ensureIngestionWorkspace = (db: Database.Database): void => {
  new EnterpriseLeadWorkspaceStore(db);
  db.prepare(`
    INSERT INTO enterprise_lead_workspaces (
      id, name, type, profile, extraction_sources, risk_rules,
      enabled_agent_roles, settings, workspace_agents, recent_run_id,
      created_at, updated_at
    ) VALUES (
      'workspace-a', 'workspace-a', 'enterprise_lead', '{}', '[]', '[]',
      '[]', NULL, NULL, NULL, '2026-07-11T00:00:00.000Z',
      '2026-07-11T00:00:00.000Z'
    )
  `).run();
};
```

Then inject a real in-memory index store and a wake spy. Add these cases:

Add `let indexStore: KnowledgeDocumentIndexStore` beside the existing store fields, construct it in
`beforeEach` after `ensureIngestionWorkspace(db)`, and pass `indexStore` to every existing
`KnowledgeIngestionService` constructor call in this test file. Use the CJK-bigram resolver to keep
the unit suite independent of optional trigram support.

```ts
test('atomically commits parsed text, ingestion completion, and pending index state', async () => {
  const created = await createQueuedDocument('atomic.pdf');
  const indexStore = new KnowledgeDocumentIndexStore(db, {
    resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
  });
  const extractDocumentText = vi.fn().mockResolvedValue({
    content: 'normalized searchable text',
    parser: 'text',
    truncated: false,
  });
  const onIndexQueued = vi.fn();
  const service = new KnowledgeIngestionService({
    db,
    documentStore,
    jobStore,
    managedFileStore,
    indexStore,
    extractDocumentText,
    onIndexQueued,
  });

  service.wake();
  await service.waitForIdle();

  expect(jobStore.getJob(created.job.id)?.status).toBe(
    KnowledgeIngestionJobStatus.Completed,
  );
  expect(indexStore.getState(created.version.id)?.status).toBe(
    KnowledgeDocumentIndexStatus.Pending,
  );
  expect(onIndexQueued).toHaveBeenCalledTimes(1);
});

test('commits not-applicable index state for empty extracted text', async () => {
  const created = await createQueuedDocument('empty-index.pdf');
  const indexStore = new KnowledgeDocumentIndexStore(db, {
    resolveTokenizer: () => KnowledgeDocumentIndexTokenizer.CjkBigramV1,
  });
  const onIndexQueued = vi.fn();
  const service = new KnowledgeIngestionService({
    db,
    documentStore,
    jobStore,
    managedFileStore,
    indexStore,
    extractDocumentText: vi.fn().mockResolvedValue({
    content: '   ',
    parser: 'text',
    truncated: false,
    }),
    onIndexQueued,
  });

  service.wake();
  await service.waitForIdle();

  expect(indexStore.getState(created.version.id)?.status).toBe(
    KnowledgeDocumentIndexStatus.NotApplicable,
  );
  expect(onIndexQueued).not.toHaveBeenCalled();
});

test('rolls back extraction and completion when index scheduling fails', async () => {
  const created = await createQueuedDocument('schedule-failure.pdf');
  const onIndexQueued = vi.fn();
  const service = new KnowledgeIngestionService({
    db,
    documentStore,
    jobStore,
    managedFileStore,
    extractDocumentText: vi.fn().mockResolvedValue({
      content: 'must roll back',
      parser: 'text',
      truncated: false,
    }),
    indexStore: {
      scheduleCurrentVersion: vi.fn(() => {
        throw new Error('forced scheduling failure');
      }),
    },
    onIndexQueued,
  });

  service.wake();
  await service.waitForIdle();

  expect(documentStore.getVersion(created.version.id)?.extractedText).toBeNull();
  expect(jobStore.getJob(created.job.id)?.status).toBe(
    KnowledgeIngestionJobStatus.Failed,
  );
  expect(onIndexQueued).not.toHaveBeenCalled();
});

```

Also add a real regression for a pending extraction whose `onIndexQueued` callback throws
synchronously. Assert the document remains `ready`, the ingestion job remains `completed`, extracted
text and the `pending` index state remain committed, and the callback error is contained in a
warning. This test must contain those state and log assertions, not just callback-count assertions.

- [ ] **Step 2: Run ingestion tests and verify RED**

Run:

```bash
npm test -- src/main/knowledgeBase/knowledgeIngestionService.test.ts
```

Expected: FAIL because ingestion does not schedule or wake local indexing.

- [ ] **Step 3: Inject index dependencies and extend the existing commit transaction**

Add to `KnowledgeIngestionServiceOptions`:

```ts
indexStore: Pick<KnowledgeDocumentIndexStore, 'scheduleCurrentVersion'>;
onIndexQueued?: () => void;
```

Inside the existing successful transaction, call scheduling only after extraction and ingestion
completion have succeeded:

```ts
const committed = this.options.db.transaction(() => {
  const applied = this.options.documentStore.applyExtractionResult({
    documentId: document.id,
    documentVersionId: version.id,
    parser: extraction.parser,
    extractedText: extractedText || null,
    extractionPartial: extraction.truncated,
    status,
  });
  if (!applied) {
    this.options.jobStore.cancel(job.id);
    return null;
  }
  this.options.jobStore.complete(job.id, attempt.id);
  return this.options.indexStore.scheduleCurrentVersion({
    workspaceId: job.workspaceId,
    documentId: job.documentId,
    documentVersionId: job.documentVersionId,
  });
})();
if (committed) {
  this.notifyDocumentUpdated(job.workspaceId, job.documentId);
  if (committed.status === KnowledgeDocumentIndexStatus.Pending) {
    this.notifyIndexQueued();
  }
}
```

Add a private post-commit notifier that contains callback failures:

```ts
private notifyIndexQueued(): void {
  try {
    this.options.onIndexQueued?.();
  } catch (error) {
    console.warn('[KnowledgeBase] Failed to wake local index worker:', error);
  }
}
```

In `failClaim`, read the current job and return unless it is still `running` before calling
`setDocumentStatusIfCurrentVersion`. A post-commit or stale callback failure must never change an
already completed document to `failed`.

Do not set ingestion stage to legacy `Chunking` or `Indexing`; `currentJob` is complete before the
independent local index begins.

- [ ] **Step 4: Write failing Foundation recovery, cleanup, and shutdown tests**

Add this test helper inside the existing Foundation suite. It uses the suite's `databases` and
`temporaryDirectories` cleanup arrays and creates a real workspace row before normalized documents:

Add `randomUUID` from `node:crypto` and `EnterpriseLeadWorkspaceType` from the shared enterprise
workspace constants to the test imports.

```ts
const createFoundationFixture = async () => {
  const db = new Database(':memory:');
  databases.push(db);
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-foundation-index-'));
  temporaryDirectories.push(userDataPath);
  const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
  const workspace = workspaceStore.createWorkspace({
    name: 'Index test workspace',
    type: EnterpriseLeadWorkspaceType.EnterpriseLead,
    profile: {
      companySummary: '',
      productList: [],
      productCapabilities: [],
      targetCustomers: [],
      applicationScenarios: [],
      sellingPoints: [],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
    },
    extractionSources: [],
    enabledAgentRoles: [],
  });
  let executor!: InlineKnowledgeDocumentIndexExecutor;
  const foundation = createKnowledgeBaseFoundation({
    db,
    userDataPath,
    workspaceStore,
    indexExecutorFactory: ({ store }) => {
      executor = new InlineKnowledgeDocumentIndexExecutor(store);
      return executor;
    },
  });
  const createReadyDocument = (text: string) =>
    foundation.documentStore.createDocumentWithVersion({
      workspaceId: workspace.id,
      displayName: `${randomUUID()}.txt`,
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: {
        contentHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
        managedPath: `blobs/test/${randomUUID()}`,
        mimeType: 'text/plain',
        fileSize: text.length,
        sourceMtime: null,
        parser: 'text',
        extractedText: text,
        extractionPartial: false,
      },
    });
  const schedule = (target: ReturnType<typeof createReadyDocument>) =>
    foundation.indexStore.scheduleCurrentVersion({
      workspaceId: workspace.id,
      documentId: target.document.id,
      documentVersionId: target.version.id,
    });
  return { db, executor, foundation, workspace, createReadyDocument, schedule };
};
```

Then assert:

```ts
test('recovers, reconciles, and wakes ingestion before local indexing', async () => {
  const fixture = await createFoundationFixture();
  const ready = fixture.createReadyDocument('searchable');
  const running = fixture.createReadyDocument('recover me');
  fixture.schedule(running);
  fixture.foundation.indexStore.claimNext('2026-07-11T00:59:59.000Z');

  await fixture.foundation.recoverMigrateAndStart(
    [fixture.workspace],
    '2026-07-11T01:00:00.000Z',
  );
  await fixture.foundation.indexingService.waitForIdle();

  expect(fixture.foundation.indexStore.getState(ready.version.id)?.status).toBe(
    KnowledgeDocumentIndexStatus.Indexed,
  );
  expect(fixture.foundation.indexStore.listAttempts(running.version.id)[0].outcome).toBe(
    KnowledgeDocumentIndexAttemptOutcome.Abandoned,
  );
});

test('deletes index rows before normalized workspace documents', async () => {
  const fixture = await createFoundationFixture();
  const target = fixture.createReadyDocument('workspace text');
  fixture.schedule(target);
  await fixture.executor.runUntilIdle();

  fixture.foundation.deleteWorkspaceData(fixture.workspace.id);

  expect(fixture.foundation.indexStore.getState(target.version.id)).toBeNull();
  expect(fixture.foundation.indexStore.listVersionChunks(target.version.id)).toEqual([]);
  expect(fixture.foundation.documentStore.getDocument(target.document.id)).toBeNull();
});

test('shuts down the index executor before the database is closed', async () => {
  const fixture = await createFoundationFixture();
  await fixture.foundation.shutdown();
  await expect(fixture.executor.runUntilIdle()).rejects.toThrow('index_worker_unavailable');
});
```

- [ ] **Step 5: Expand the Foundation interface and factory options**

Use these exact public additions:

```ts
export interface KnowledgeBaseFoundation {
  documentService: KnowledgeDocumentService;
  documentStore: KnowledgeDocumentStore;
  ingestionService: KnowledgeIngestionService;
  indexingService: KnowledgeDocumentIndexService;
  indexStore: KnowledgeDocumentIndexStore;
  jobStore: KnowledgeIngestionJobStore;
  managedFileStore: KnowledgeManagedFileStore;
  migrationStore: KnowledgeMigrationStore;
  migrationService: KnowledgeMigrationService;
  selectionTokenStore: KnowledgeSelectionTokenStore;
  recoverMigrateAndStart: (workspaces: LegacyKnowledgeWorkspace[], now?: string) => Promise<void>;
  deleteWorkspaceData: (workspaceId: string) => void;
  shutdown: () => Promise<void>;
}

export interface KnowledgeDocumentIndexExecutorFactoryInput {
  store: KnowledgeDocumentIndexStore;
  databasePath: string | null;
}
```

Add these factory options:

```ts
databasePath?: string;
indexWorkerScriptPath?: string;
indexExecutorFactory?: (
  input: KnowledgeDocumentIndexExecutorFactoryInput,
) => KnowledgeDocumentIndexExecutor;
```

Tests pass:

```ts
indexExecutorFactory: ({ store }) => new InlineKnowledgeDocumentIndexExecutor(store),
```

Add this wrapper near the top of `knowledgeBaseFoundation.test.ts` and replace every existing plain
`createKnowledgeBaseFoundation` call in that file with `createTestFoundation`, except the
capture-specific fixture from Step 4:

Import `type KnowledgeBaseFoundation` from the Foundation module for the wrapper return type.

```ts
type FoundationOptions = Parameters<typeof createKnowledgeBaseFoundation>[0];

const createTestFoundation = (
  options: Omit<FoundationOptions, 'indexExecutorFactory'>,
): KnowledgeBaseFoundation => createKnowledgeBaseFoundation({
  ...options,
  indexExecutorFactory: ({ store }) => new InlineKnowledgeDocumentIndexExecutor(store),
});
```

For each existing test that passes a non-empty workspace array without first creating that workspace
through `EnterpriseLeadWorkspaceStore`, seed the ownership row before calling recovery:

```ts
const ensureTestWorkspace = (db: Database.Database, workspaceId: string): void => {
  const store = new EnterpriseLeadWorkspaceStore(db);
  if (store.getWorkspace(workspaceId)) return;
  const now = '2026-07-11T00:00:00.000Z';
  db.prepare(`
    INSERT INTO enterprise_lead_workspaces (
      id, name, type, profile, extraction_sources, risk_rules,
      enabled_agent_roles, settings, workspace_agents, recent_run_id,
      created_at, updated_at
    ) VALUES (?, ?, 'enterprise_lead', ?, '[]', '[]', '[]', NULL, NULL, NULL, ?, ?)
  `).run(workspaceId, workspaceId, JSON.stringify({
    companySummary: '', productList: [], productCapabilities: [], targetCustomers: [],
    applicationScenarios: [], sellingPoints: [], channelPreferences: [], prohibitedClaims: [],
    contactRules: [], missingInfo: [],
  }), now, now);
};
```

Use `rg -n "recoverMigrateAndStart\(" src/main/knowledgeBase/knowledgeBaseFoundation.test.ts` to
visit every recovery call; each non-empty workspace ID must already exist in the same database.

Before composing Foundation, add these required-but-not-yet-consumed fields to
`KnowledgeDocumentServiceOptions`; Task 7 adds their lifecycle behavior:

```ts
indexStore: Pick<KnowledgeDocumentIndexStore,
  | 'deactivateVersion'
  | 'getState'
  | 'listStates'
  | 'retryFailedVersion'
  | 'scheduleCurrentVersion'
>;
onIndexQueued?: () => void;
```

Update the existing `knowledgeDocumentService.test.ts` `beforeEach` to construct a real in-memory
`KnowledgeDocumentIndexStore` after `EnterpriseLeadWorkspaceStore` and pass it through
`createService()`. This keeps Task 6 compiling before Task 7 adds assertions.

In the existing production `KnowledgeDocumentListItem` mapper, add `localIndex: null` as the
temporary safe value required by the Task 1 contract. Task 7 replaces this placeholder with the
single bulk `listStates(workspaceId)` projection; do not add a per-document index query here.

When no factory is injected, Foundation must require both a non-empty `databasePath` and
`indexWorkerScriptPath`, then construct `WorkerKnowledgeDocumentIndexExecutor`. Throw during
Foundation creation if either is missing; do not silently choose inline execution.

- [ ] **Step 6: Compose deterministic startup, deletion, and shutdown order**

Construct `KnowledgeDocumentStore` before `KnowledgeDocumentIndexStore`, then create executor,
indexing service, document service, and ingestion service. Retain the existing late-bound
`let ingestionService: KnowledgeIngestionService` before constructing `documentService`, then use
these exact composition links:

```ts
const indexingService = new KnowledgeDocumentIndexService(indexExecutor, indexStore);

const documentService = new KnowledgeDocumentService({
  db: options.db,
  documentStore,
  jobStore,
  indexStore,
  managedFileStore,
  selectionTokenStore,
  compatibilityAdapter,
  workspaceExists: workspaceId => Boolean(workspaceStore.getWorkspace(workspaceId)),
  onJobsQueued: () => ingestionService.wake(),
  onIndexQueued: () => indexingService.wake(),
});
```

Pass `indexStore` and `onIndexQueued: () => indexingService.wake()` into
`KnowledgeIngestionService` as well. `recoverMigrateAndStart` must perform this sequence:

```ts
jobStore.recoverAbandonedJobs(staleBefore, now);
indexStore.recoverAbandonedIndexing(staleBefore, now);
for (const workspace of workspacesWithStableSourceIds) {
  await migrationService.migrateWorkspace(workspace);
}
indexStore.reconcileMissingStates(now);
ingestionService.wake();
indexingService.wake();
```

Extend the exported `recoverAndMigrateKnowledgeBase` helper options with:

```ts
indexStore: Pick<KnowledgeDocumentIndexStore,
  'recoverAbandonedIndexing' | 'reconcileMissingStates'
>;
```

Update its existing ordering test to expect:

```ts
expect(events).toEqual([
  'recover-jobs',
  'recover-index',
  'migrate:workspace-a',
  'reconcile-index',
  'wake',
]);
```

The helper calls `recoverAbandonedIndexing(staleBefore, now)` immediately after ingestion recovery
and `reconcileMissingStates(now)` only after all isolated workspace migration attempts finish.
Every direct helper test supplies this no-op baseline unless it is recording order:

```ts
indexStore: {
  recoverAbandonedIndexing: () => 0,
  reconcileMissingStates: () => ({ pendingCount: 0, notApplicableCount: 0 }),
},
```

Keep migration error isolation per workspace. The workspace deletion transaction must call:

```ts
indexStore.deleteWorkspaceIndex(workspaceId);
jobStore.deleteWorkspaceJobs(workspaceId);
documentStore.deleteWorkspaceDocuments(workspaceId);
migrationStore.deleteState(workspaceId);
```

Foundation shutdown is idempotent and exact:

```ts
shutdown: async (): Promise<void> => {
  await indexingService.shutdown();
},
```

- [ ] **Step 7: Pass production paths from main and stop before SQLite close**

In `getKnowledgeBaseFoundation()`, add:

```ts
databasePath: getStore().getDbPath(),
indexWorkerScriptPath: resolveKnowledgeDocumentIndexWorkerPath({
  isPackaged: app.isPackaged,
  moduleDirectory: __dirname,
  resourcesPath: process.resourcesPath,
}),
```

In `runAppCleanup`, immediately before the existing SQLite close block, add:

```ts
if (knowledgeBaseFoundation) {
  await knowledgeBaseFoundation.shutdown().catch(error => {
    console.error('[KnowledgeBase] Failed to stop local index worker:', error);
  });
}
```

Do not call `getKnowledgeBaseFoundation()` during cleanup because that would instantiate a worker
while quitting.

- [ ] **Step 8: Lock startup order with a source contract**

Extend `knowledgeBaseStartupOrder.test.ts` so it asserts the recovery call appears after handler
registration. Keep that assertion on the existing `initAppSource`. For shutdown, slice the separate
cleanup function from the full main source before comparing positions:

```ts
expect(initAppSource.indexOf('.recoverMigrateAndStart(')).toBeGreaterThan(
  initAppSource.indexOf('registerKnowledgeBaseHandlers('),
);

const cleanupStart = mainSource.indexOf('const runAppCleanup = async');
const cleanupEnd = mainSource.indexOf("app.on('before-quit'", cleanupStart);
expect(cleanupStart).toBeGreaterThanOrEqual(0);
expect(cleanupEnd).toBeGreaterThan(cleanupStart);
const cleanupSource = mainSource.slice(cleanupStart, cleanupEnd);
const shutdownIndex = cleanupSource.indexOf('knowledgeBaseFoundation.shutdown()');
const closeIndex = cleanupSource.indexOf('getStore().close()');
expect(shutdownIndex).toBeGreaterThanOrEqual(0);
expect(closeIndex).toBeGreaterThanOrEqual(0);
expect(shutdownIndex).toBeLessThan(closeIndex);
```

- [ ] **Step 9: Run integration tests, compile, and task lint**

Run:

```bash
npm test -- \
  src/main/knowledgeBase/knowledgeIngestionService.test.ts \
  src/main/knowledgeBase/knowledgeBaseFoundation.test.ts \
  src/main/knowledgeBase/knowledgeBaseStartupOrder.test.ts
npm run compile:electron
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/main/knowledgeBase/knowledgeIngestionService.ts \
  src/main/knowledgeBase/knowledgeIngestionService.test.ts \
  src/main/knowledgeBase/knowledgeDocumentService.ts \
  src/main/knowledgeBase/knowledgeDocumentService.test.ts \
  src/main/knowledgeBase/knowledgeBaseFoundation.ts \
  src/main/knowledgeBase/knowledgeBaseFoundation.test.ts \
  src/main/knowledgeBase/knowledgeBaseStartupOrder.test.ts \
  src/main/main.ts
```

Expected: tests, Electron compilation, and changed-file lint PASS. Do not stage or commit the files.

---

### Task 7: Project Safe Index State Through Document Lifecycle

**Files:**

- Modify: `src/main/knowledgeBase/knowledgeDocumentService.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentService.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentStore.test.ts`
- Modify: `src/main/knowledgeBase/enterpriseLeadKnowledgeCompatibilityAdapter.test.ts`
- Create: `src/main/knowledgeBase/knowledgeDocumentVersionLifecycle.test.ts`

**Interfaces:**

- Consumes the index store/service from Tasks 3–6.
- Produces `retryLocalIndex(input: KnowledgeRetryLocalIndexRequest)` and safe `localIndex` projection
  on every document DTO.
- Produces main-internal `replaceParsedDocumentVersion(...)` so every future local-first/sync version
  replacement is forced through old-generation deactivation and new-version scheduling.
- Contains every post-commit index wake failure so a committed lifecycle mutation is never reported
  as failed, and never re-enters a persistence failure path.
- Tasks 8–9 expose and render this independent operation.

- [ ] **Step 1: Write failing bulk-projection and lifecycle tests**

Task 6 already added `indexStore` and `onIndexQueued` to the existing `beforeEach`/`createService`
fixture. Add these local helpers:

```ts
const scheduleIndex = (target: ReturnType<typeof createStoredDocument>): void => {
  indexStore.scheduleCurrentVersion({
    workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
  });
};

const failIndex = (target: ReturnType<typeof createStoredDocument>): void => {
  scheduleIndex(target);
  const claim = indexStore.claimNext();
  if (!claim || claim.state.documentVersionId !== target.version.id) {
    throw new Error('Expected failed-index test target to be claimed');
  }
  indexStore.failAttempt({
    documentVersionId: target.version.id,
    attemptId: claim.attempt.id,
    errorCode: KnowledgeDocumentIndexErrorCode.ProcessingFailed,
  });
};
```

Add these behaviors to the service suite:

```ts
test('projects current-version index state with one workspace query', () => {
  const first = createStoredDocument({ displayName: 'first.txt' });
  const second = createStoredDocument({ displayName: 'second.txt' });
  scheduleIndex(first);
  scheduleIndex(second);
  runKnowledgeDocumentIndexUntilIdle(indexStore);
  const listStates = vi.spyOn(indexStore, 'listStates');
  const getState = vi.spyOn(indexStore, 'getState');

  const documents = service.listDocuments({
    workspaceId,
    visibility: KnowledgeDocumentVisibility.Active,
  });

  expect(listStates).toHaveBeenCalledTimes(1);
  expect(getState).not.toHaveBeenCalled();
  expect(documents.every(document => document.localIndex?.status === 'indexed')).toBe(true);
});

test('lists 1,000 document summaries without chunk payloads or N+1 state reads', () => {
  let indexedTarget: ReturnType<typeof createStoredDocument> | null = null;
  for (let index = 0; index < 1_000; index += 1) {
    const target = createStoredDocument({ displayName: `document-${index}.txt` });
    if (index === 0) indexedTarget = target;
  }
  if (!indexedTarget) throw new Error('Expected an indexed projection target');
  scheduleIndex(indexedTarget);
  runKnowledgeDocumentIndexUntilIdle(indexStore);
  const listStates = vi.spyOn(indexStore, 'listStates');
  const getState = vi.spyOn(indexStore, 'getState');

  const documents = service.listDocuments({
    workspaceId,
    visibility: KnowledgeDocumentVisibility.Active,
  });
  const payload = JSON.stringify(documents);

  expect(documents).toHaveLength(1_000);
  expect(
    documents.find(document => document.id === indexedTarget.document.id)?.localIndex?.status,
  ).toBe(KnowledgeDocumentIndexStatus.Indexed);
  expect(listStates).toHaveBeenCalledTimes(1);
  expect(getState).not.toHaveBeenCalled();
  expect(payload).not.toContain('extractedText');
  expect(payload).not.toContain('managedPath');
  expect(payload).not.toContain('activeAttemptId');
  expect(payload).not.toContain('heartbeatAt');
});

// Extend the existing "stores legacy DOC as completed without text" test with:
const imported = result.items[0];
expect(imported?.success).toBe(true);
if (imported?.success) {
  expect(imported.document.currentJob).toBeNull();
  expect(imported.document.localIndex?.status).toBe(
    KnowledgeDocumentIndexStatus.NotApplicable,
  );
}
expect(onIndexQueued).not.toHaveBeenCalled();

test('delete removes only target index data and restore requeues the same version', () => {
  const target = createStoredDocument({ displayName: 'target.txt' });
  const untouched = createStoredDocument({ displayName: 'untouched.txt' });
  scheduleIndex(target);
  scheduleIndex(untouched);
  runKnowledgeDocumentIndexUntilIdle(indexStore);
  const originalChunkIds = indexStore.listVersionChunks(target.version.id)
    .map(chunk => chunk.id);
  onIndexQueued.mockClear();

  const deleted = service.deleteDocument({
    documentId: target.document.id,
    expectedRevision: target.document.revision,
  });
  expect(deleted.localIndex).toBeNull();
  expect(indexStore.listVersionChunks(target.version.id)).toEqual([]);
  expect(indexStore.listVersionChunks(untouched.version.id)).toHaveLength(1);
  expect(onIndexQueued).toHaveBeenCalledTimes(1);
  onIndexQueued.mockClear();

  const restored = service.restoreDocument({
    documentId: deleted.id,
    expectedRevision: deleted.revision,
  });
  expect(restored.localIndex?.status).toBe(KnowledgeDocumentIndexStatus.Pending);
  expect(onIndexQueued).toHaveBeenCalledTimes(1);
  runKnowledgeDocumentIndexUntilIdle(indexStore);
  expect(indexStore.listVersionChunks(target.version.id).map(chunk => chunk.id)).toEqual(
    originalChunkIds,
  );
});

test('replaces a parsed version atomically and schedules only the new version', () => {
  const target = createStoredDocument({ displayName: 'replace.txt' });
  scheduleIndex(target);
  runKnowledgeDocumentIndexUntilIdle(indexStore);
  onIndexQueued.mockClear();

  const replaced = service.replaceParsedDocumentVersion({
    documentId: target.document.id,
    expectedRevision: target.document.revision,
    version: {
      ...createStoredDocumentInputVersion(),
      contentHash: 'b'.repeat(64),
      extractedText: 'replacement text',
    },
  });

  expect(indexStore.listVersionChunks(target.version.id)).toEqual([]);
  expect(replaced.currentVersionId).not.toBe(target.version.id);
  expect(replaced.localIndex?.status).toBe(KnowledgeDocumentIndexStatus.Pending);
  expect(onIndexQueued).toHaveBeenCalledTimes(1);
});

test('wakes physical cleanup when an indexed version is replaced by empty text', () => {
  const target = createStoredDocument({ displayName: 'replace-empty.txt' });
  scheduleIndex(target);
  runKnowledgeDocumentIndexUntilIdle(indexStore);
  expect(
    (db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks
      WHERE document_version_id = ?
    `).get(target.version.id) as { count: number }).count,
  ).toBeGreaterThan(0);
  onIndexQueued.mockImplementationOnce(() => {
    expect(db.inTransaction).toBe(false);
    runKnowledgeDocumentIndexUntilIdle(indexStore);
  });

  const replaced = service.replaceParsedDocumentVersion({
    documentId: target.document.id,
    expectedRevision: target.document.revision,
    version: {
      ...createStoredDocumentInputVersion(),
      contentHash: 'd'.repeat(64),
      extractedText: null,
    },
  });

  expect(replaced.localIndex?.status).toBe(KnowledgeDocumentIndexStatus.NotApplicable);
  expect(onIndexQueued).toHaveBeenCalledTimes(1);
  expect(
    (db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks
      WHERE document_version_id = ?
    `).get(target.version.id) as { count: number }).count,
  ).toBe(0);
  expect(
    (db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_document_chunks_fts
      WHERE document_version_id = ?
    `).get(target.version.id) as { count: number }).count,
  ).toBe(0);
});

test('rejects restoring an active document without changing revision or index state', () => {
  const target = createStoredDocument({ displayName: 'already-active.txt' });
  scheduleIndex(target);
  runKnowledgeDocumentIndexUntilIdle(indexStore);
  const originalChunkIds = indexStore.listVersionChunks(target.version.id).map(chunk => chunk.id);
  onIndexQueued.mockClear();

  expect(() => service.restoreDocument({
    documentId: target.document.id,
    expectedRevision: target.document.revision,
  })).toThrowError(expect.objectContaining({ code: KnowledgeBaseErrorCode.JobStateConflict }));

  expect(documentStore.getDocument(target.document.id)).toMatchObject({
    deletedAt: null,
    revision: target.document.revision,
  });
  expect(indexStore.getState(target.version.id)?.status).toBe(
    KnowledgeDocumentIndexStatus.Indexed,
  );
  expect(indexStore.listVersionChunks(target.version.id).map(chunk => chunk.id)).toEqual(
    originalChunkIds,
  );
  expect(onIndexQueued).not.toHaveBeenCalled();
});

test('deletes a document before its first local-index state exists', () => {
  const target = createStoredDocument({
    displayName: 'queued-before-index.txt',
    status: KnowledgeDocumentStatus.Pending,
  });
  const job = jobStore.createJob({
    workspaceId,
    documentId: target.document.id,
    documentVersionId: target.version.id,
  });
  expect(indexStore.getState(target.version.id)).toBeNull();
  onIndexQueued.mockClear();

  const deleted = service.deleteDocument({
    documentId: target.document.id,
    expectedRevision: target.document.revision,
  });

  expect(deleted.deletedAt).not.toBeNull();
  expect(deleted.localIndex).toBeNull();
  expect(jobStore.getJob(job.id)?.status).toBe(KnowledgeIngestionJobStatus.Cancelled);
  expect(onIndexQueued).not.toHaveBeenCalled();
});

test('rolls back old-index deactivation and version replacement when scheduling fails', () => {
  const target = createStoredDocument({ displayName: 'replace-rollback.txt' });
  scheduleIndex(target);
  runKnowledgeDocumentIndexUntilIdle(indexStore);
  const originalChunkIds = indexStore.listVersionChunks(target.version.id).map(chunk => chunk.id);
  const scheduleCurrentVersion = indexStore.scheduleCurrentVersion.bind(indexStore);
  vi.spyOn(indexStore, 'scheduleCurrentVersion').mockImplementation(input => {
    const state = scheduleCurrentVersion(input);
    if (input.documentVersionId !== target.version.id) {
      throw new Error('forced post-schedule failure');
    }
    return state;
  });
  onIndexQueued.mockClear();

  expect(() => service.replaceParsedDocumentVersion({
    documentId: target.document.id,
    expectedRevision: target.document.revision,
    version: {
      ...createStoredDocumentInputVersion(),
      contentHash: 'c'.repeat(64),
      extractedText: 'must roll back',
    },
  })).toThrowError(expect.objectContaining({ code: KnowledgeBaseErrorCode.PersistenceFailed }));

  expect(documentStore.getDocument(target.document.id)).toMatchObject({
    currentVersionId: target.version.id,
    revision: target.document.revision,
  });
  expect(indexStore.getState(target.version.id)?.status).toBe(
    KnowledgeDocumentIndexStatus.Indexed,
  );
  expect(indexStore.listVersionChunks(target.version.id).map(chunk => chunk.id)).toEqual(
    originalChunkIds,
  );
  expect(onIndexQueued).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Write failing independent-retry tests**

```ts
test('retries only failed local indexing and wakes once after commit', () => {
  const target = createStoredDocument();
  failIndex(target);
  const retryDocument = vi.spyOn(jobStore, 'retry');
  const compatibilityUpdate = vi.spyOn(compatibilityAdapter, 'upsertDocument');
  onIndexQueued.mockClear();

  const result = service.retryLocalIndex({
    documentId: target.document.id,
    documentVersionId: target.version.id,
  });

  expect(result.localIndex?.status).toBe(KnowledgeDocumentIndexStatus.Pending);
  expect(result.status).toBe(target.document.status);
  expect(result.revision).toBe(target.document.revision);
  expect(retryDocument).not.toHaveBeenCalled();
  expect(onIndexQueued).toHaveBeenCalledTimes(1);
  expect(compatibilityUpdate).not.toHaveBeenCalled();
});

test('rejects deleted, stale-version, pending, and indexed retries without waking', () => {
  const indexed = createStoredDocument({ displayName: 'indexed.txt' });
  scheduleIndex(indexed);
  runKnowledgeDocumentIndexUntilIdle(indexStore);
  const wrongVersion = createStoredDocument({ displayName: 'wrong-version.txt' });
  failIndex(wrongVersion);
  const deletedTarget = createStoredDocument({ displayName: 'deleted.txt' });
  failIndex(deletedTarget);
  const pending = createStoredDocument({ displayName: 'pending.txt' });
  scheduleIndex(pending);
  const deleted = service.deleteDocument({
    documentId: deletedTarget.document.id,
    expectedRevision: deletedTarget.document.revision,
  });
  onIndexQueued.mockClear();

  const requests = [
    { documentId: deleted.id, documentVersionId: deleted.currentVersionId },
    { documentId: wrongVersion.document.id, documentVersionId: 'stale-version' },
    { documentId: pending.document.id, documentVersionId: pending.version.id },
    { documentId: indexed.document.id, documentVersionId: indexed.version.id },
  ];
  for (const request of requests) {
    expect(() => service.retryLocalIndex(request)).toThrowError(
      expect.objectContaining({ code: KnowledgeBaseErrorCode.JobStateConflict }),
    );
  }
  expect(onIndexQueued).not.toHaveBeenCalled();
});

test('contains a synchronous post-commit index wake failure', () => {
  const target = createStoredDocument({ displayName: 'wake-failure.txt' });
  failIndex(target);
  const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  onIndexQueued.mockImplementationOnce(() => {
    expect(db.inTransaction).toBe(false);
    throw new Error('forced wake failure');
  });

  try {
    const result = service.retryLocalIndex({
      documentId: target.document.id,
      documentVersionId: target.version.id,
    });
    expect(result.localIndex?.status).toBe(KnowledgeDocumentIndexStatus.Pending);
    expect(indexStore.getState(target.version.id)?.status).toBe(
      KnowledgeDocumentIndexStatus.Pending,
    );
    expect(consoleWarn).toHaveBeenCalledWith(
      '[KnowledgeBase] Failed to wake local index worker:',
      expect.objectContaining({ message: 'forced wake failure' }),
    );
  } finally {
    consoleWarn.mockRestore();
  }
});
```

- [ ] **Step 3: Run document service tests and verify RED**

Run:

```bash
npm test -- src/main/knowledgeBase/knowledgeDocumentService.test.ts
```

Expected: FAIL because document DTOs and mutations do not project or manage local index state.

- [ ] **Step 4: Consume the injected index dependencies and build safe summaries**

Task 6 already added these required fields to `KnowledgeDocumentServiceOptions`; keep their exact
type while implementing the lifecycle behavior:

```ts
indexStore: Pick<KnowledgeDocumentIndexStore,
  | 'deactivateVersion'
  | 'getState'
  | 'listStates'
  | 'retryFailedVersion'
  | 'scheduleCurrentVersion'
>;
onIndexQueued?: () => void;
```

Add a mapper that is the only internal-to-renderer projection:

```ts
private toIndexSummary(
  state: KnowledgeDocumentIndexState | null,
): KnowledgeDocumentIndexSummary | null {
  if (!state) return null;
  return {
    documentVersionId: state.documentVersionId,
    status: state.status,
    chunkCount: state.chunkCount,
    attemptCount: state.attemptCount,
    errorCode: state.errorCode,
    updatedAt: state.updatedAt,
    completedAt: state.completedAt,
  };
}
```

Change `toListItem` to accept an index state and set `localIndex`. In `listDocuments`, call
`listStates(workspaceId)` exactly once, build a Map keyed by `documentVersionId`, and pass only the
state matching each document's `currentVersionId`. Detail and single-document mutation responses may
use `getState(currentVersionId)`.

- [ ] **Step 5: Make import, delete, and restore transactions index-aware**

For `canExtractText: false`, schedule the new exact version in the same import transaction and
return `not_applicable`. For extractable imports, return `localIndex: null`; parsing owns the first
schedule.

Inside delete, after `softDeleteDocument` and queued-ingestion cancellation, first read the current
version's state. A newly imported extractable document legitimately has no local-index state until
ingestion publishes parsed text, so deletion must remain valid in that state. Deactivate only when
the state exists:

```ts
const hadIndexState = this.options.indexStore.getState(existing.currentVersionId) !== null;
if (hadIndexState) {
  this.options.indexStore.deactivateVersion({
    workspaceId: existing.workspaceId,
    documentId: existing.id,
    documentVersionId: existing.currentVersionId,
  });
}
```

Return `hadIndexState` with the private transaction result. After commit, notify indexing once only
when a state was deactivated so the worker physically purges the now-invisible generation in
bounded cleanup batches. Do not wake when no state existed or on a failed/revision-conflicted
delete.

Inside restore, call `scheduleCurrentVersion` after restoring but before compatibility projection.
Before quota calculation or any write, require `existing.deletedAt !== null`; restoring an already
active document is a `JobStateConflict`. This guard must preserve its revision, current index state,
visible chunks, and active attempt ownership, and must not wake indexing.
Return the scheduled state in a private transaction result, then notify indexing only after a
successful commit and only when status is `pending`. Compatibility projection behavior remains
unchanged for delete/restore because those operations still change document visibility.

All delete, restore, version-replacement, and retry wakeups must call one private contained notifier:

```ts
private notifyIndexQueued(): void {
  try {
    this.options.onIndexQueued?.();
  } catch (error) {
    console.warn('[KnowledgeBase] Failed to wake local index worker:', error);
  }
}
```

Never leave a direct `this.options.onIndexQueued?.()` call in these public mutation paths. A wake is
post-commit best effort; its exception must not turn a durable success into a caller-visible
`persistence_failed` response.

Extend `KnowledgeDocumentStore.addVersion` with a fourth `status` argument that defaults to the
current document status for existing store tests. Apply both `current_version_id` and the resolved
status in its existing single revision-CAS update; the production service below always passes the
new explicit status:

```ts
addVersion(
  documentId: string,
  expectedRevision: number,
  version: CreateKnowledgeDocumentInput['version'],
  status?: KnowledgeDocumentStatus,
): { document: KnowledgeDocument; version: KnowledgeDocumentVersion };
```

Add a store unit test that passes a changed status and asserts exactly one revision increment; keep
the existing three-argument tests and explicitly assert `next.document.status` still equals the
created document status to verify backward-compatible status preservation. Then add this
main-internal service operation; it is deliberately not exposed through IPC in Plan 1:

```ts
replaceParsedDocumentVersion(input: {
  documentId: string;
  expectedRevision: number;
  version: CreateKnowledgeDocumentInput['version'];
}): KnowledgeDocumentListItem {
  if (!input.version.parser?.trim()) {
    throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.InvalidRequest);
  }
  const transaction = this.options.db.transaction(() => {
    const existing = this.requireDocument(input.documentId);
    if (existing.deletedAt) {
      throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.JobStateConflict);
    }
    const hadPreviousIndexState =
      this.options.indexStore.getState(existing.currentVersionId) !== null;
    if (hadPreviousIndexState) {
      this.options.indexStore.deactivateVersion({
        workspaceId: existing.workspaceId,
        documentId: existing.id,
        documentVersionId: existing.currentVersionId,
      });
    }
    const status = input.version.extractedText?.trim()
      ? KnowledgeDocumentStatus.Ready
      : KnowledgeDocumentStatus.CompletedWithoutText;
    const replaced = this.options.documentStore.addVersion(
      existing.id,
      input.expectedRevision,
      input.version,
      status,
    );
    const indexState = this.options.indexStore.scheduleCurrentVersion({
      workspaceId: replaced.document.workspaceId,
      documentId: replaced.document.id,
      documentVersionId: replaced.version.id,
    });
    const item = this.toListItemFromDocument(replaced.document);
    this.options.compatibilityAdapter.upsertDocument(
      replaced.document.workspaceId,
      item,
      this.getCompatibilityProjectionOptions(replaced.document),
    );
    return { item, indexState, hadPreviousIndexState };
  });
  const result = transaction();
  if (
    result.hadPreviousIndexState ||
    result.indexState.status === KnowledgeDocumentIndexStatus.Pending
  ) {
    this.notifyIndexQueued();
  }
  return result.item;
}
```

Wrap the validation, transaction, and return path in `try/catch` and rethrow
`this.toServiceError(error)`, matching the existing delete/restore boundary. Revision conflicts and
post-schedule persistence failures must return safe service errors; no raw SQLite, index-store, or
adapter exception may escape. The contained post-commit notifier remains inside the successful path
and does not throw.

Create this source-contract test so any future sync/version writer fails CI until it uses the same
orchestration boundary:

```ts
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

test('routes every production version replacement through KnowledgeDocumentService', () => {
  const callers = globSync('src/main/**/*.ts')
    .filter(filePath => !filePath.endsWith('.test.ts'))
    .filter(filePath => readFileSync(filePath, 'utf8').includes('documentStore.addVersion('))
    .map(filePath => path.normalize(filePath));

  expect(callers).toEqual([
    path.normalize('src/main/knowledgeBase/knowledgeDocumentService.ts'),
  ]);
});
```

- [ ] **Step 6: Add independent local-index retry**

Expose:

```ts
retryLocalIndex(input: KnowledgeRetryLocalIndexRequest): KnowledgeDocumentListItem {
  try {
    const transaction = this.options.db.transaction(() => {
      const document = this.requireDocument(input.documentId);
      if (document.deletedAt || document.currentVersionId !== input.documentVersionId) {
        throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.JobStateConflict);
      }
      this.options.indexStore.retryFailedVersion({
        documentId: document.id,
        documentVersionId: document.currentVersionId,
      });
      return this.toListItemFromDocument(document);
    });
    const item = transaction();
    this.notifyIndexQueued();
    return item;
  } catch (error) {
    throw this.toServiceError(error);
  }
}
```

Map `KnowledgeDocumentIndexStateError` to `JobStateConflict` in `toServiceError`. Do not update
document status/revision, retry the ingestion job, or call the compatibility adapter.

- [ ] **Step 7: Run document lifecycle tests and task lint**

Run:

```bash
npm test -- \
  src/main/knowledgeBase/knowledgeDocumentStore.test.ts \
  src/main/knowledgeBase/knowledgeDocumentVersionLifecycle.test.ts \
  src/main/knowledgeBase/knowledgeDocumentService.test.ts \
  src/main/knowledgeBase/enterpriseLeadKnowledgeCompatibilityAdapter.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/main/knowledgeBase/knowledgeDocumentService.ts \
  src/main/knowledgeBase/knowledgeDocumentService.test.ts \
  src/main/knowledgeBase/knowledgeDocumentStore.ts \
  src/main/knowledgeBase/knowledgeDocumentStore.test.ts \
  src/main/knowledgeBase/knowledgeDocumentVersionLifecycle.test.ts \
  src/main/knowledgeBase/enterpriseLeadKnowledgeCompatibilityAdapter.test.ts
```

Expected: no-N+1 projection, non-extractable import, targeted delete, restore requeue, independent
retry, and compatibility behavior PASS. Do not stage or commit the files.

---

### Task 8: Expose a Dedicated Retry IPC Boundary

**Files:**

- Modify: `src/main/knowledgeBase/ipcHandlers.ts`
- Modify: `src/main/knowledgeBase/ipcHandlers.test.ts`
- Modify: `src/main/knowledgeBase/preloadBridge.ts`
- Modify: `src/main/knowledgeBase/preloadBridge.test.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Modify: `src/renderer/services/knowledgeBase.ts`
- Modify: `src/renderer/services/knowledgeBase.test.ts`

**Interfaces:**

- Consumes `KnowledgeRetryLocalIndexRequest` and the document service method from Task 7.
- Produces `window.electron.knowledgeBase.retryLocalIndex(input)` and
  `knowledgeBaseService.retryLocalIndex(documentId, documentVersionId)`.
- Task 9 uses only this wrapper; renderer components never call raw `ipcRenderer.invoke`.

- [ ] **Step 1: Write failing handler and validation tests**

Extend the existing `makeDeps()` document service mock with:

```ts
retryLocalIndex: vi.fn(() => documentItem()),
```

```ts
test('routes a validated local-index retry to the dedicated service method', async () => {
  const { deps, documentService } = makeDeps();
  registerKnowledgeBaseHandlers(deps);

  const result = await registeredHandlers.get(KnowledgeBaseIpc.RetryLocalIndex)?.(
    createEvent().event,
    { documentId: ' document-a ', documentVersionId: ' version-a ' },
  );

  expect(documentService.retryLocalIndex).toHaveBeenCalledWith({
    documentId: 'document-a',
    documentVersionId: 'version-a',
  });
  expect(result).toMatchObject({ success: true });
});

test.each([
  null,
  {},
  { documentId: '', documentVersionId: 'version-a' },
  { documentId: 'document-a', documentVersionId: 7 },
])('rejects invalid local-index retry input without calling service', async input => {
  const { deps, documentService } = makeDeps();
  registerKnowledgeBaseHandlers(deps);
  await expect(
    registeredHandlers.get(KnowledgeBaseIpc.RetryLocalIndex)?.(createEvent().event, input),
  ).resolves.toEqual({
      success: false,
      error: { code: KnowledgeBaseErrorCode.InvalidRequest },
    });
  expect(documentService.retryLocalIndex).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Write failing preload and renderer-service tests**

```ts
test('preload invokes the dedicated local-index retry channel', async () => {
  const invoke = vi.fn(async () => ({ success: true, data: null }));
  const bridge = createKnowledgeBasePreloadBridge(invoke);
  await bridge.retryLocalIndex({ documentId: 'document-a', documentVersionId: 'version-a' });
  expect(invoke).toHaveBeenCalledWith(KnowledgeBaseIpc.RetryLocalIndex, {
    documentId: 'document-a',
    documentVersionId: 'version-a',
  });
});

test('renderer service unwraps local-index retry without using ingestion retry', async () => {
  const retryLocalIndex = vi.fn(async () => ({
    success: true as const,
    data: documentItem(),
  }));
  installApi({ retryLocalIndex });

  await knowledgeBaseService.retryLocalIndex('document-a', 'version-a');

  expect(retryLocalIndex).toHaveBeenCalledWith({
    documentId: 'document-a',
    documentVersionId: 'version-a',
  });
});
```

- [ ] **Step 3: Run boundary tests and verify RED**

Run:

```bash
npm test -- \
  src/main/knowledgeBase/ipcHandlers.test.ts \
  src/main/knowledgeBase/preloadBridge.test.ts \
  src/renderer/services/knowledgeBase.test.ts
```

Expected: FAIL because the dedicated handler/bridge/wrapper methods do not exist.

- [ ] **Step 4: Register and validate the dedicated IPC operation**

Add `retryLocalIndex` to `KnowledgeDocumentServiceApi`. Parse the input with the same strict
non-empty-string rules as document retry but return the shared request type:

```ts
const readRetryLocalIndexInput = (value: unknown): KnowledgeRetryLocalIndexRequest => {
  if (!isRecord(value)) {
    throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.InvalidRequest);
  }
  return {
    documentId: requireString(value.documentId),
    documentVersionId: requireString(value.documentVersionId),
  };
};
```

Register:

```ts
ipcMain.handle(KnowledgeBaseIpc.RetryLocalIndex, async (_event, input: unknown) =>
  invokeSafely(() => deps.documentService.retryLocalIndex(readRetryLocalIndexInput(input))),
);
```

`invokeSafely` continues converting unknown failures to `PersistenceFailed`; never serialize the
caught error.

- [ ] **Step 5: Extend preload, Electron renderer types, and renderer service**

Add this identical signature to both `KnowledgeBasePreloadBridge` and
`window.electron.knowledgeBase`:

```ts
retryLocalIndex: (
  input: KnowledgeRetryLocalIndexRequest,
) => Promise<KnowledgeBaseIpcResult<KnowledgeDocumentListItem>>;
```

The bridge implementation is:

```ts
retryLocalIndex: input =>
  invoke(KnowledgeBaseIpc.RetryLocalIndex, input) as Promise<
    KnowledgeBaseIpcResult<KnowledgeDocumentListItem>
  >,
```

Add the same method to the renderer's internal `KnowledgeBaseApi`, then expose:

```ts
retryLocalIndex: (
  documentId: string,
  documentVersionId: string,
): Promise<KnowledgeDocumentListItem> =>
  request(api => api.retryLocalIndex({ documentId, documentVersionId })),
```

- [ ] **Step 6: Run boundary tests, compilation, and task lint**

Run:

```bash
npm test -- \
  src/main/knowledgeBase/ipcHandlers.test.ts \
  src/main/knowledgeBase/preloadBridge.test.ts \
  src/renderer/services/knowledgeBase.test.ts
npm run compile:electron
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/main/knowledgeBase/ipcHandlers.ts \
  src/main/knowledgeBase/ipcHandlers.test.ts \
  src/main/knowledgeBase/preloadBridge.ts \
  src/main/knowledgeBase/preloadBridge.test.ts \
  src/renderer/types/electron.d.ts \
  src/renderer/services/knowledgeBase.ts \
  src/renderer/services/knowledgeBase.test.ts
```

Expected: tests, Electron compilation, and lint PASS. Do not stage or commit the files.

---

### Task 9: Render and Poll Independent Local-Index State

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts`
- Modify: `src/renderer/services/i18n.ts`

**Interfaces:**

- Consumes the safe DTO and renderer service from Tasks 1 and 8.
- Produces independent local-index status presentation, polling, and retry action.
- Keeps parsing retry and local-index retry visually and behaviorally distinct.
- Preserves the existing single-flight polling controller and generation refs, and defers
  off-screen row rendering for the 100–1,000 document target without adding another data layer.

- [ ] **Step 1: Write failing presentation and polling tests**

In each touched renderer test file, keep its existing local DTO helper and add this safe summary
helper (rename only on a local collision):

```ts
const createIndexSummary = (
  status: KnowledgeDocumentIndexStatus,
  overrides: Partial<KnowledgeDocumentIndexSummary> = {},
): KnowledgeDocumentIndexSummary => ({
  documentVersionId: 'version-a',
  status,
  chunkCount: 0,
  attemptCount: 1,
  errorCode: null,
  updatedAt: '2026-07-11T00:00:00.000Z',
  completedAt: null,
  ...overrides,
});
```

Update the existing `documentItem`/`createDocument` helper to include `localIndex: null` and accept
`Partial<KnowledgeDocumentListItem>` overrides. In
`useWorkspaceKnowledgeDocuments.test.ts`, the exact signature becomes:

```ts
const documentItem = (
  jobStatus: KnowledgeIngestionJobStatus,
  overrides: Partial<KnowledgeDocumentListItem> = {},
): KnowledgeDocumentListItem => ({
  id: 'document-1',
  displayName: 'manual.pdf',
  sourceMode: KnowledgeDocumentSourceMode.Managed,
  currentVersionId: 'version-1',
  revision: 1,
  status: jobStatus === KnowledgeIngestionJobStatus.Completed
    ? KnowledgeDocumentStatus.Ready
    : KnowledgeDocumentStatus.Processing,
  fileSize: 100,
  mimeType: 'application/pdf',
  contentHash: 'a'.repeat(64),
  currentJob: {
    id: 'job-1',
    documentVersionId: 'version-1',
    stage: KnowledgeIngestionStage.Parsing,
    status: jobStatus,
    progress: 0.5,
    errorCode: null,
    updatedAt: '2026-07-11T00:00:00.000Z',
  },
  localIndex: null,
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  deletedAt: null,
  ...overrides,
});
```

That two-argument helper signature applies only to `useWorkspaceKnowledgeDocuments.test.ts`.
The presentation and panel suites keep their existing single optional-overrides helper, so adapt
the examples below to the local helper rather than copying the hook-suite call shape across files.

Then add exact status mapping, retry predicate, and terminal-state expectations:

```ts
test.each([
  [KnowledgeDocumentIndexStatus.Pending, 'enterpriseKnowledgeLocalIndexStatusPending'],
  [KnowledgeDocumentIndexStatus.Indexing, 'enterpriseKnowledgeLocalIndexStatusIndexing'],
  [KnowledgeDocumentIndexStatus.Indexed, 'enterpriseKnowledgeLocalIndexStatusIndexed'],
  [KnowledgeDocumentIndexStatus.NotApplicable, 'enterpriseKnowledgeLocalIndexStatusNotApplicable'],
  [KnowledgeDocumentIndexStatus.Failed, 'enterpriseKnowledgeLocalIndexStatusFailed'],
])('maps local-index status %s to %s', (status, key) => {
  expect(getKnowledgeDocumentIndexStatusKey(status)).toBe(key);
});

test.each([
  KnowledgeDocumentIndexStatus.Pending,
  KnowledgeDocumentIndexStatus.Indexing,
])('polls while local indexing is %s even after ingestion completes', status => {
  expect(shouldPollKnowledgeDocuments([
    documentItem({
      currentJob: null,
      localIndex: createIndexSummary(status),
    }),
  ])).toBe(true);
});

test.each([
  KnowledgeDocumentIndexStatus.Indexed,
  KnowledgeDocumentIndexStatus.NotApplicable,
  KnowledgeDocumentIndexStatus.Failed,
])('stops polling when local indexing is terminal: %s', status => {
  expect(shouldPollKnowledgeDocuments([
    documentItem({
      currentJob: null,
      localIndex: createIndexSummary(status),
    }),
  ])).toBe(false);
});

test('allows local-index retry only for an active failed current version', () => {
  const failed = documentItem({
    currentVersionId: 'version-a',
    deletedAt: null,
    localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Failed, {
      documentVersionId: 'version-a',
    }),
  });
  expect(canRetryKnowledgeDocumentIndex(failed)).toBe(true);
  expect(canRetryKnowledgeDocumentIndex({ ...failed, deletedAt: '2026-07-11T00:00:00.000Z' }))
    .toBe(false);
  expect(canRetryKnowledgeDocumentIndex({
    ...failed,
    localIndex: { ...failed.localIndex!, documentVersionId: 'old-version' },
  })).toBe(false);
});
```

- [ ] **Step 2: Implement presentation helpers and independent polling rule**

Add:

```ts
const indexStatusKeys: Record<KnowledgeDocumentIndexStatus, string> = {
  [KnowledgeDocumentIndexStatuses.Pending]: 'enterpriseKnowledgeLocalIndexStatusPending',
  [KnowledgeDocumentIndexStatuses.Indexing]: 'enterpriseKnowledgeLocalIndexStatusIndexing',
  [KnowledgeDocumentIndexStatuses.Indexed]: 'enterpriseKnowledgeLocalIndexStatusIndexed',
  [KnowledgeDocumentIndexStatuses.NotApplicable]:
    'enterpriseKnowledgeLocalIndexStatusNotApplicable',
  [KnowledgeDocumentIndexStatuses.Failed]: 'enterpriseKnowledgeLocalIndexStatusFailed',
};

export const getKnowledgeDocumentIndexStatusKey = (
  status: KnowledgeDocumentIndexStatus,
): string => indexStatusKeys[status];

export const canRetryKnowledgeDocumentIndex = (
  document: KnowledgeDocumentListItem,
): boolean =>
  !document.deletedAt &&
  document.localIndex?.status === KnowledgeDocumentIndexStatuses.Failed &&
  document.localIndex.documentVersionId === document.currentVersionId;
```

Extend polling without changing ingestion semantics:

```ts
export const shouldPollKnowledgeDocuments = (
  documents: KnowledgeDocumentListItem[],
): boolean => documents.some(document =>
  document.currentJob?.status === KnowledgeIngestionJobStatus.Queued ||
  document.currentJob?.status === KnowledgeIngestionJobStatus.Running ||
  document.localIndex?.status === KnowledgeDocumentIndexStatuses.Pending ||
  document.localIndex?.status === KnowledgeDocumentIndexStatuses.Indexing
);
```

- [ ] **Step 3: Write failing hook retry tests**

Because this repository does not depend on a hook-rendering test library, export and test a pure
operation helper, while the existing `runKnowledgeDocumentGenerationTask` tests continue covering
generation/disposal safety:

```ts
test('retries local indexing with the exact document and version', async () => {
  const document = documentItem(KnowledgeIngestionJobStatus.Completed, {
    id: 'document-a',
    currentVersionId: 'version-a',
    localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Failed),
  });
  const retryLocalIndex = vi.fn(async () => document);
  const retryDocument = vi.fn(async () => document);

  await retryKnowledgeDocumentLocalIndex({ retryLocalIndex }, document);

  expect(retryLocalIndex).toHaveBeenCalledWith('document-a', 'version-a');
  expect(retryDocument).not.toHaveBeenCalled();
});
```

Also update polling-controller tests so a pending/indexing local state schedules the next refresh,
while failed/indexed/not-applicable does not. Preserve the existing single-flight, disposal, and
workspace-generation assertions. In the pending/indexing-to-indexed case, advance timers for at
least one additional interval after the indexed response and assert no third request is scheduled.

Do not introduce SWR, another interval/effect, or a second request state. The repository's polling
controller already deduplicates in-flight reads; extend only its pure `shouldPollKnowledgeDocuments`
predicate and keep timer/generation values in their existing transient refs/controller closure.

- [ ] **Step 4: Add the hook mutation through the existing generation guard**

Extend `WorkspaceKnowledgeDocumentsState`:

```ts
retryLocalIndex: (document: KnowledgeDocumentListItem) => Promise<void>;
```

Update the existing panel test fixtures at the same time:

```ts
// In createState()
retryLocalIndex: vi.fn(async () => undefined),

// In renderView()'s WorkspaceKnowledgeDocumentsPanelView props
onRetryLocalIndex: vi.fn(),
```

Export the pure helper:

```ts
export const retryKnowledgeDocumentLocalIndex = async (
  service: Pick<KnowledgeBaseServiceApi, 'retryLocalIndex'>,
  document: KnowledgeDocumentListItem,
): Promise<void> => {
  await service.retryLocalIndex(document.id, document.currentVersionId);
};
```

Return this operation beside `retryDocument`:

```ts
retryLocalIndex: document =>
  runMutation(
    () => retryKnowledgeDocumentLocalIndex(service, document),
    refresh,
  ),
```

Do not create a second mutation state or bypass `runKnowledgeDocumentGenerationTask`; stale
workspace responses must remain ignored.

- [ ] **Step 5: Write failing panel/action tests**

Cover null, all five statuses, count, independent buttons, and projection callback isolation:

Add `afterEach(() => i18nService.setLanguage('zh', { persist: false }))` to the panel suite so the
English assertions cannot leak language state into later tests.

```ts
test.each([
  [null, 'enterpriseKnowledgeLocalIndexStatusNotStarted'],
  [KnowledgeDocumentIndexStatus.Pending, 'enterpriseKnowledgeLocalIndexStatusPending'],
  [KnowledgeDocumentIndexStatus.Indexing, 'enterpriseKnowledgeLocalIndexStatusIndexing'],
  [KnowledgeDocumentIndexStatus.Indexed, 'enterpriseKnowledgeLocalIndexStatusIndexed'],
  [
    KnowledgeDocumentIndexStatus.NotApplicable,
    'enterpriseKnowledgeLocalIndexStatusNotApplicable',
  ],
  [KnowledgeDocumentIndexStatus.Failed, 'enterpriseKnowledgeLocalIndexStatusFailed'],
])('renders active local-index state %s', (status, key) => {
  const document = createDocument({
    localIndex: status ? createIndexSummary(status) : null,
  });
  const html = renderView(createState({ documents: [document] }));
  expect(html).toContain(i18nService.t(key));
});

test('hides local-index status and retry controls in trash', () => {
  const deleted = createDocument({
    deletedAt: '2026-07-11T00:00:00.000Z',
    localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Failed),
  });
  const html = renderView(
    createState({ deletedDocuments: [deleted] }),
    KnowledgeDocumentVisibility.Deleted,
  );
  expect(html).not.toContain(i18nService.t('enterpriseKnowledgeLocalIndex'));
  expect(html).not.toContain(i18nService.t('enterpriseKnowledgeLocalIndexStatusFailed'));
  expect(html).not.toContain('data-retry-local-index-document-id');
});

test('renders parsing and local-index state independently', () => {
  const document = createDocument({
    status: KnowledgeDocumentStatus.Ready,
    currentJob: null,
    localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed, { chunkCount: 7 }),
  });
  const html = renderView(createState({ documents: [document] }));

  expect(html).toContain(i18nService.t('enterpriseKnowledgeDocumentParsing'));
  expect(html).toContain(i18nService.t('enterpriseKnowledgeLocalIndex'));
  expect(html).toContain(i18nService.t('enterpriseKnowledgeLocalIndexStatusIndexed'));
  expect(html).toContain('7');
});

test('renders a dedicated retry only for active failed local index', () => {
  const document = createDocument({
    currentJob: null,
    localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Failed, {
      errorCode: '/private/path SQLITE_BUSY stack',
    }),
  });
  const html = renderView(createState({ documents: [document] }));

  expect(html).toContain(`data-retry-local-index-document-id="${document.id}"`);
  expect(html).not.toContain(`data-retry-document-id="${document.id}"`);
  expect(html).not.toContain('/private/path');
  expect(html).not.toContain('SQLITE_BUSY');
});

test('announces dynamic local-index status without including the retry button', () => {
  const document = createDocument({
    localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Failed),
  });
  const html = renderView(createState({ documents: [document] }));
  const liveRegionStart = html.indexOf('role="status"');
  const retryButtonStart = html.indexOf('data-retry-local-index-document-id');

  expect(liveRegionStart).toBeGreaterThanOrEqual(0);
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain('aria-atomic="true"');
  expect(retryButtonStart).toBeGreaterThan(liveRegionStart);
});

test('local-index retry does not report a workspace projection change', async () => {
  const state = createState();
  const onWorkspaceProjectionChange = vi.fn();
  const actions = createWorkspaceKnowledgeDocumentsPanelActions(
    state,
    onWorkspaceProjectionChange,
  );
  const document = createDocument();

  await actions.retryLocalIndex(document);

  expect(state.retryLocalIndex).toHaveBeenCalledWith(document);
  expect(onWorkspaceProjectionChange).not.toHaveBeenCalled();
});

test('marks document rows for deferred off-screen rendering', () => {
  const html = renderView(createState({ documents: [createDocument()] }));
  expect(html).toContain('[content-visibility:auto]');
  expect(html).toContain('[contain-intrinsic-size:auto_160px]');
});
```

- [ ] **Step 6: Add separate row rendering and action wiring**

Extend action and view contracts with `retryLocalIndex`. The action implementation is exact:

```ts
retryLocalIndex: async document => {
  await state.retryLocalIndex(document);
},
```

Pass `onRetryLocalIndex` into `KnowledgeDocumentRow`. Below the existing parsing job progress block,
render this index block only for active rows. Deleted rows have intentionally deactivated state and
must not be mislabeled as “not indexed yet”:

Add the static Tailwind arbitrary-property utilities
`[content-visibility:auto] [contain-intrinsic-size:auto_160px]` to the existing `<article>` row
class. This lets Chromium skip layout/paint for off-screen rows while retaining an intrinsic height
estimate; do not add row-level state, observers, or a virtualization dependency.

Keep one stable live region in every active row so polling and retry transitions are announced to
assistive technology. Put only the status text and indexed chunk count inside
`role="status" aria-live="polite" aria-atomic="true"`; keep the retry button as its sibling so the
button label/removal is not included in the announcement.

```tsx
{!isDeleted ? (
<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3 text-xs">
  <span className="font-medium text-secondary">
    {i18nService.t('enterpriseKnowledgeLocalIndex')}
  </span>
  <span className="flex items-center gap-2 text-secondary">
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex items-center gap-2"
    >
      <span>
        {document.localIndex
          ? i18nService.t(getKnowledgeDocumentIndexStatusKey(document.localIndex.status))
          : i18nService.t('enterpriseKnowledgeLocalIndexStatusNotStarted')}
      </span>
      {document.localIndex?.status === KnowledgeDocumentIndexStatuses.Indexed ? (
        <span>
          {formatTranslation('enterpriseKnowledgeLocalIndexChunkCount', {
            count: document.localIndex.chunkCount,
          })}
        </span>
      ) : null}
    </span>
    {canRetryKnowledgeDocumentIndex(document) ? (
      <button
        type="button"
        data-retry-local-index-document-id={document.id}
        disabled={disabled}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/20 bg-primary/10 px-2.5 font-semibold text-primary disabled:opacity-45"
        onClick={onRetryLocalIndex}
      >
        <ArrowPathIcon className="h-4 w-4" />
        {i18nService.t('enterpriseKnowledgeRetryLocalIndex')}
      </button>
    ) : null}
  </span>
</div>
) : null}
```

Prefix the existing document status badge with the visible label
`enterpriseKnowledgeDocumentParsing`. Do not render `localIndex.errorCode` anywhere. Keep the
existing ingestion retry button under `data-retry-document-id` and the new retry under
`data-retry-local-index-document-id`.

- [ ] **Step 7: Add exact Chinese and English strings**

Add both language entries:

```ts
enterpriseKnowledgeDocumentParsing: '文档解析',
enterpriseKnowledgeLocalIndex: '本地搜索索引',
enterpriseKnowledgeLocalIndexStatusNotStarted: '尚未建立',
enterpriseKnowledgeLocalIndexStatusPending: '等待建立',
enterpriseKnowledgeLocalIndexStatusIndexing: '建立中',
enterpriseKnowledgeLocalIndexStatusIndexed: '已就绪',
enterpriseKnowledgeLocalIndexStatusNotApplicable: '无可索引文本',
enterpriseKnowledgeLocalIndexStatusFailed: '建立失败',
enterpriseKnowledgeLocalIndexChunkCount: '{count} 个内容片段',
enterpriseKnowledgeRetryLocalIndex: '重试索引',
```

```ts
enterpriseKnowledgeDocumentParsing: 'Document parsing',
enterpriseKnowledgeLocalIndex: 'Local search index',
enterpriseKnowledgeLocalIndexStatusNotStarted: 'Not indexed yet',
enterpriseKnowledgeLocalIndexStatusPending: 'Waiting to index',
enterpriseKnowledgeLocalIndexStatusIndexing: 'Indexing',
enterpriseKnowledgeLocalIndexStatusIndexed: 'Ready',
enterpriseKnowledgeLocalIndexStatusNotApplicable: 'No indexable text',
enterpriseKnowledgeLocalIndexStatusFailed: 'Indexing failed',
enterpriseKnowledgeLocalIndexChunkCount: '{count} content chunk(s)',
enterpriseKnowledgeRetryLocalIndex: 'Retry indexing',
```

Add this exact bilingual regression test to `knowledgeDocumentPresentation.test.ts`:

```ts
test.each([
  {
    language: 'zh' as const,
    expected: [
      '文档解析', '本地搜索索引', '尚未建立', '等待建立', '建立中',
      '已就绪', '无可索引文本', '建立失败', '重试索引',
    ],
  },
  {
    language: 'en' as const,
    expected: [
      'Document parsing', 'Local search index', 'Not indexed yet', 'Waiting to index',
      'Indexing', 'Ready', 'No indexable text', 'Indexing failed', 'Retry indexing',
    ],
  },
])('publishes complete $language local-index copy', ({ language, expected }) => {
  i18nService.setLanguage(language, { persist: false });
  const keys = [
    'enterpriseKnowledgeDocumentParsing',
    'enterpriseKnowledgeLocalIndex',
    'enterpriseKnowledgeLocalIndexStatusNotStarted',
    'enterpriseKnowledgeLocalIndexStatusPending',
    'enterpriseKnowledgeLocalIndexStatusIndexing',
    'enterpriseKnowledgeLocalIndexStatusIndexed',
    'enterpriseKnowledgeLocalIndexStatusNotApplicable',
    'enterpriseKnowledgeLocalIndexStatusFailed',
    'enterpriseKnowledgeRetryLocalIndex',
  ];
  expect(keys.map(key => i18nService.t(key))).toEqual(expected);
});
```

Add this chunk-count assertion to the panel suite:

```ts
test.each([
  ['zh' as const, '7 个内容片段'],
  ['en' as const, '7 content chunk(s)'],
])('renders indexed chunk count in $0', (language, expected) => {
  i18nService.setLanguage(language, { persist: false });
  const document = createDocument({
    localIndex: createIndexSummary(KnowledgeDocumentIndexStatus.Indexed, { chunkCount: 7 }),
  });
  expect(renderView(createState({ documents: [document] }))).toContain(expected);
});
```

- [ ] **Step 8: Run renderer tests, build, and task lint**

Run:

```bash
npm test -- \
  src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/workspaceCreationKnowledgeImport.test.ts
npm run build
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.ts \
  src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/workspaceCreationKnowledgeImport.test.ts \
  src/renderer/services/i18n.ts
```

Expected: polling, generation safety, status rendering, retry isolation, translations, build, and
changed-file lint PASS. Do not stage or commit the files.

---

### Task 10: Runtime Responsiveness, Regression Verification, and Manual Handoff

**Files:**

- Create: `src/main/knowledgeBase/knowledgeDocumentIndexResponsiveness.test.ts`
- Create: `scripts/verify-packaged-knowledge-index-worker.cjs`
- Modify only when a test exposes a defect: files already listed in Tasks 1–9

**Interfaces:**

- Consumes the packaged worker contract and the complete Phase 1 flow.
- Produces objective evidence that maximum-size and queued multi-document indexing do not block a
  Node host event loop equivalent to Electron main's worker-thread boundary, plus a packaged
  Electron smoke and user-run UI handoff; it must not overclaim that Vitest itself is Electron main.
- Completes Plan 1 without staging or committing; Plan 2 begins only after manual acceptance.

- [ ] **Step 1: Add the opt-in real-worker responsiveness test**

The test must skip during ordinary `npm test` only when the worker artifact is absent, but fail when
`KNOWLEDGE_INDEX_REQUIRE_WORKER=1` is set. With a built worker, create one 50 MiB text version plus
four smaller queued versions in a temporary file database, sample a 25 ms timer while the worker
drains, and assert maximum drift stays below 250 ms:

```ts
const createFileBackedIndexFixture = () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-index-runtime-'));
  const databasePath = path.join(tempDirectory, 'knowledge.sqlite');
  const db = new Database(databasePath);
  applySqliteConnectionPolicy(db);
  const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
  const workspace = workspaceStore.createWorkspace({
    name: 'Responsiveness workspace',
    type: EnterpriseLeadWorkspaceType.EnterpriseLead,
    profile: {
      companySummary: '', productList: [], productCapabilities: [], targetCustomers: [],
      applicationScenarios: [], sellingPoints: [], channelPreferences: [], prohibitedClaims: [],
      contactRules: [], missingInfo: [],
    },
    extractionSources: [],
    enabledAgentRoles: [],
  });
  const documentStore = new KnowledgeDocumentStore(db);
  const indexStore = new KnowledgeDocumentIndexStore(db);
  let sequence = 0;
  return {
    db,
    databasePath,
    createPendingDocument: (text: string): void => {
      sequence += 1;
      const created = documentStore.createDocumentWithVersion({
        workspaceId: workspace.id,
        displayName: `runtime-${sequence}.txt`,
        sourceMode: KnowledgeDocumentSourceMode.Managed,
        status: KnowledgeDocumentStatus.Ready,
        version: {
          contentHash: String(sequence).padStart(64, '0'),
          managedPath: `blobs/runtime/${sequence}`,
          mimeType: 'text/plain',
          fileSize: text.length,
          sourceMtime: null,
          parser: 'text',
          extractedText: text,
          extractionPartial: false,
        },
      });
      indexStore.scheduleCurrentVersion({
        workspaceId: workspace.id,
        documentId: created.document.id,
        documentVersionId: created.version.id,
      });
    },
    close: (): void => {
      db.close();
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    },
  };
};

const workerPath = path.resolve('dist-electron/knowledge-index-worker.js');
const requireWorker = process.env.KNOWLEDGE_INDEX_REQUIRE_WORKER === '1';

if (requireWorker && !fs.existsSync(workerPath)) {
  throw new Error(`Required local-index worker is missing: ${workerPath}`);
}

const runtimeTest = fs.existsSync(workerPath) ? test : test.skip;

test('responsiveness sampler detects an intentional synchronous stall', async () => {
  const drifts: number[] = [];
  let expectedAt = performance.now() + 10;
  const timer = setInterval(() => {
    const now = performance.now();
    drifts.push(Math.max(0, now - expectedAt));
    expectedAt += 10;
  }, 10);
  await new Promise(resolve => setTimeout(resolve, 30));
  const blockedUntil = performance.now() + 300;
  while (performance.now() < blockedUntil) {
    // Negative control: deliberately block this test event loop.
  }
  await new Promise(resolve => setTimeout(resolve, 30));
  clearInterval(timer);
  expect(Math.max(...drifts)).toBeGreaterThan(250);
});

runtimeTest('indexes a 50 MiB document and queued documents off the host event loop', async () => {
  const fixture = createFileBackedIndexFixture();
  fixture.createPendingDocument('x'.repeat(50 * 1024 * 1024));
  for (let index = 0; index < 4; index += 1) {
    fixture.createPendingDocument(`企业知识库-${index}-`.repeat(20_000));
  }
  const executor = new WorkerKnowledgeDocumentIndexExecutor({
    databasePath: fixture.databasePath,
    workerScriptPath: workerPath,
  });

  const drifts: number[] = [];
  const mainWriteDurations: number[] = [];
  fixture.db.exec('CREATE TABLE responsiveness_probe (id INTEGER PRIMARY KEY, value INTEGER)');
  fixture.db.prepare('INSERT INTO responsiveness_probe (id, value) VALUES (1, 0)').run();
  const updateProbe = fixture.db.prepare(
    'UPDATE responsiveness_probe SET value = value + 1 WHERE id = 1',
  );
  let expectedAt = performance.now() + 25;
  const timer = setInterval(() => {
    const writeStartedAt = performance.now();
    updateProbe.run();
    const now = performance.now();
    mainWriteDurations.push(now - writeStartedAt);
    drifts.push(Math.max(0, now - expectedAt));
    expectedAt = now + 25;
  }, 25);

  try {
    await expect(executor.runUntilIdle()).resolves.toEqual({
      indexedCount: 5,
      failedCount: 0,
    });
    await new Promise(resolve => setTimeout(resolve, 75));
  } finally {
    clearInterval(timer);
    await executor.shutdown();
    fixture.close();
  }

  expect(drifts.length).toBeGreaterThanOrEqual(10);
  expect(Math.max(0, ...drifts)).toBeLessThan(250);
  expect(Math.max(0, ...mainWriteDurations)).toBeLessThan(250);
}, 180_000);
```

The fixture must apply the shared SQLite policy on the main connection and create targets through
`KnowledgeDocumentStore` plus `KnowledgeDocumentIndexStore`; it must not duplicate production DDL.
Wrap document creation, executor construction/use, timer cleanup, worker shutdown, DB close, and
temporary-directory removal in an outer `try/finally` so a setup assertion or worker-start failure
cannot leak the fixture. Give the negative-control interval the same `try/finally` cleanup. The
180-second timeout is only a cold-machine completion ceiling; the 250 ms drift/write thresholds are
the responsiveness assertions.

- [ ] **Step 2: Build and run the mandatory real-worker verification**

Run:

```bash
npm run build
KNOWLEDGE_INDEX_REQUIRE_WORKER=1 npm test -- \
  src/main/knowledgeBase/knowledgeDocumentIndexResponsiveness.test.ts
```

Expected: the worker indexes all five targets with zero failures and measured maximum timer drift is
below 250 ms.

- [ ] **Step 3: Run all knowledge-base regression tests together**

Run:

```bash
npm test -- \
  src/shared/knowledgeBase/contracts.test.ts \
  src/main/libs/sqliteConnectionPolicy.test.ts \
  src/main/knowledgeBase/knowledgeDocumentChunker.test.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexStore.test.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexExecutor.test.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexWorkerPath.test.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexService.test.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexBuildContract.test.ts \
  src/main/knowledgeBase/knowledgeIngestionService.test.ts \
  src/main/knowledgeBase/knowledgeDocumentStore.test.ts \
  src/main/knowledgeBase/knowledgeDocumentService.test.ts \
  src/main/knowledgeBase/knowledgeDocumentVersionLifecycle.test.ts \
  src/main/knowledgeBase/knowledgeBaseFoundation.test.ts \
  src/main/knowledgeBase/knowledgeBaseStartupOrder.test.ts \
  src/main/knowledgeBase/ipcHandlers.test.ts \
  src/main/knowledgeBase/preloadBridge.test.ts \
  src/main/knowledgeBase/enterpriseLeadKnowledgeCompatibilityAdapter.test.ts \
  src/renderer/services/knowledgeBase.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/workspaceCreationKnowledgeImport.test.ts
```

Expected: all targeted tests PASS.

- [ ] **Step 4: Run repository compilation and full official tests**

Run:

```bash
npm run compile:electron
npm run build
npm test
```

Expected: all three commands PASS. If full `npm test` exposes unrelated pre-existing failures,
record the exact failing test names and preserve the green targeted suite; do not modify unrelated
modules.

- [ ] **Step 5: Verify the unpacked packaged worker with Electron**

Before packaging, verify `vendor/openclaw-runtime/current` exists. In an isolated worktree where
the ignored runtime is absent, reuse the already-built runtime from the primary checkout through an
ignored `vendor/openclaw-runtime` symlink; do not copy, rebuild, edit, stage, or commit the 1.6 GiB
runtime. Fail with a clear prerequisite message if no complete runtime is available. Also disable
code-signing identity auto-discovery for this local unpacked smoke.

Create `scripts/verify-packaged-knowledge-index-worker.cjs` with this complete smoke flow:

```js
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { app } = require('electron');

const walk = (root, matches) => {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) walk(entryPath, matches);
    else matches.push(entryPath);
  }
};

const findOne = (files, suffix) => {
  const normalizedSuffix = path.normalize(suffix);
  const matches = files.filter(filePath => path.normalize(filePath).endsWith(normalizedSuffix));
  if (matches.length !== 1) {
    throw new Error(`Expected one packaged ${suffix}, found ${matches.length}`);
  }
  return matches[0];
};

const request = (worker, requestId, kind) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Worker ${kind} timed out`)), 10_000);
  const onError = error => {
    clearTimeout(timeout);
    reject(error);
  };
  const onMessage = message => {
    if (message?.requestId !== requestId) return;
    clearTimeout(timeout);
    worker.off('error', onError);
    worker.off('message', onMessage);
    resolve(message);
  };
  worker.once('error', onError);
  worker.on('message', onMessage);
  worker.postMessage({ requestId, kind });
});

app.whenReady().then(async () => {
  const releaseRoot = path.resolve(process.argv[2] || 'release');
  const files = [];
  walk(releaseRoot, files);
  const workerPath = findOne(
    files,
    path.join('app.asar.unpacked', 'dist-electron', 'knowledge-index-worker.js'),
  );
  const nativePath = findOne(
    files,
    path.join(
      'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build',
      'Release', 'better_sqlite3.node',
    ),
  );
  const packageRoot = nativePath.slice(0, nativePath.indexOf(`${path.sep}build${path.sep}Release`));
  const Database = require(packageRoot);
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-worker-package-'));
  const databasePath = path.join(tempDirectory, 'smoke.sqlite');
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE enterprise_lead_workspaces (id TEXT PRIMARY KEY);
    CREATE TABLE knowledge_documents (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, current_version_id TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE knowledge_document_versions (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, extracted_text TEXT
    );
  `);
  db.close();

  const worker = new Worker(workerPath, { workerData: { databasePath } });
  try {
    const result = await request(worker, 'smoke-run', 'run');
    if (
      result.kind !== 'result' ||
      result.result.indexedCount !== 0 ||
      result.result.failedCount !== 0
    ) {
      throw new Error(`Unexpected packaged worker result: ${JSON.stringify(result)}`);
    }
    const stopped = await request(worker, 'smoke-stop', 'shutdown');
    if (stopped.kind !== 'stopped') throw new Error('Packaged worker did not stop cleanly');
  } finally {
    await worker.terminate();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
  app.exit(0);
}).catch(error => {
  console.error(error);
  app.exit(1);
});
```

Build an unpacked application and execute the smoke with Electron's ABI/runtime:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir \
  --config scripts/electron-builder-config.cjs \
  --config.directories.output=release/knowledge-worker-smoke
./node_modules/.bin/electron scripts/verify-packaged-knowledge-index-worker.cjs \
  release/knowledge-worker-smoke
node --check scripts/verify-packaged-knowledge-index-worker.cjs
```

Expected: exactly one unpacked worker and native `better_sqlite3.node` are found; the packaged worker
opens the existing DB, returns `{ indexedCount: 0, failedCount: 0 }`, stops, and exits 0. This step is
mandatory on the current platform; source-string checks alone are not sufficient.

- [ ] **Step 6: Run CI-equivalent lint on the exact touched TypeScript files**

Run the CI-equivalent rule against the complete known touched-file set, including new untracked
files (which `git diff --name-only` alone would omit):

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/shared/knowledgeBase/constants.ts \
  src/shared/knowledgeBase/types.ts \
  src/shared/knowledgeBase/contracts.test.ts \
  src/main/libs/sqliteConnectionPolicy.ts \
  src/main/libs/sqliteConnectionPolicy.test.ts \
  src/main/libs/sqliteBackup/sqliteBackupManager.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexTypes.ts \
  src/main/knowledgeBase/knowledgeDocumentChunker.ts \
  src/main/knowledgeBase/knowledgeDocumentChunker.test.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexStore.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexStore.test.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexRunner.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexExecutor.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexExecutor.test.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexWorker.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexWorkerPath.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexWorkerPath.test.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexService.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexService.test.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexBuildContract.test.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexResponsiveness.test.ts \
  src/main/knowledgeBase/knowledgeIngestionService.ts \
  src/main/knowledgeBase/knowledgeIngestionService.test.ts \
  src/main/knowledgeBase/knowledgeBaseFoundation.ts \
  src/main/knowledgeBase/knowledgeBaseFoundation.test.ts \
  src/main/knowledgeBase/knowledgeBaseStartupOrder.test.ts \
  src/main/knowledgeBase/knowledgeDocumentStore.ts \
  src/main/knowledgeBase/knowledgeDocumentStore.test.ts \
  src/main/knowledgeBase/knowledgeDocumentService.ts \
  src/main/knowledgeBase/knowledgeDocumentService.test.ts \
  src/main/knowledgeBase/knowledgeDocumentVersionLifecycle.test.ts \
  src/main/knowledgeBase/enterpriseLeadKnowledgeCompatibilityAdapter.test.ts \
  src/main/knowledgeBase/ipcHandlers.ts \
  src/main/knowledgeBase/ipcHandlers.test.ts \
  src/main/knowledgeBase/preloadBridge.ts \
  src/main/knowledgeBase/preloadBridge.test.ts \
  src/main/main.ts \
  src/renderer/types/electron.d.ts \
  src/renderer/services/knowledgeBase.ts \
  src/renderer/services/knowledgeBase.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.ts \
  src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/workspaceCreationKnowledgeImport.test.ts \
  vite.config.mts \
  src/renderer/services/i18n.ts
```

Expected: PASS with zero warnings.

- [ ] **Step 7: Review whitespace, scope, generated output, and unsafe data exposure**

Run:

```bash
git diff --check
git status --short
git diff --stat
rg -n "localIndex\.errorCode|activeAttemptId|heartbeatAt|tokenizerVersion|managedPath" \
  src/renderer src/main/knowledgeBase/preloadBridge.ts src/shared/knowledgeBase/types.ts
if rg -n "modelClient|createConfiguredIndustryModelClient|OpenClaw" \
  src/main/knowledgeBase/knowledgeDocumentChunker.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexStore.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexRunner.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexExecutor.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexWorker.ts \
  src/main/knowledgeBase/knowledgeDocumentIndexService.ts; then exit 1; fi
```

Expected:

- `git diff --check` reports no whitespace errors.
- No generated `dist/` or `dist-electron/` file is added to Git.
- The worktree still contains the user's pre-existing changes; no unrelated file was reverted.
- Renderer/preload/shared DTO code does not render or expose internal lease, tokenizer, path, or raw
  failure data. The allowed shared `localIndex.errorCode` field remains a stable sanitized code and
  is not rendered by the panel.

- [ ] **Step 8: Perform Electron manual validation**

Safety gate: this app's `configureUserDataPath()` replaces Electron's default path with the real
`appData/yuzhh-ai-assistant` directory. Do **not** automatically launch `npm run electron:dev` from
the implementation agent, because it can migrate and write the user's real `lobsterai.sqlite`.
After every automated gate and packaged temp-DB smoke passes, hand the command and scenarios below
to the user for deliberate testing in a chosen workspace. Record them as pending until the user
reports the results; do not claim Plan 1 complete before that acceptance.

Run:

```bash
npm run electron:dev
```

Validate these exact scenarios in one workspace:

1. Upload two extractable files. Each first shows parsing activity, then independently shows
   “等待建立/建立中”, then “已就绪” with a non-zero chunk count.
2. Upload one supported attachment with no extractable text. It shows “无可索引文本” and never
   starts a model/network request.
3. Close the app while one index is active, reopen it, and confirm the abandoned attempt is retained
   while the version is requeued and reaches “已就绪”.
4. Delete one indexed document and confirm only its chunks disappear; another indexed document
   remains ready. Restore it and confirm deterministic reindexing.
5. Switch between active/trash lists and between workspaces while polling. Confirm stale responses do
   not overwrite the current workspace.
6. Quit the application and confirm logs contain no worker-after-database-close error.

The forced worker-start, worker-exit, failed-index retry, and raw-error-hiding cases are covered by
the deterministic automated tests because production UI has no supported control for intentionally
crashing its worker.

- [ ] **Step 9: Hand off for user acceptance without staging or committing**

Report:

- changed files grouped by shared/store/worker/lifecycle/IPC/UI;
- targeted tests, full test, build, compile, lint, responsiveness result, and manual scenarios run;
- any unrelated pre-existing failure with its exact command;
- the local database tables added and that no model call was introduced;
- confirmation that no files were staged or committed.

Wait for the user's manual acceptance before writing Plan 2 or creating any commit.

---

## Definition of Done

- Every active parsed document version has exactly one durable local index state.
- Empty/non-extractable versions are terminal `not_applicable`; non-empty versions become
  deterministically chunked and `indexed`.
- Chunk and FTS publication is atomic and version/lease guarded.
- Chinese text is retrievable under trigram and explicit bigram fallback modes.
- A deleted, replaced, or workspace-deleted target cannot be resurrected by a late worker.
- Production work runs in one persistent worker with an independent SQLite connection and no main
  thread fallback.
- Startup recovery, reconciliation, workspace deletion, and app shutdown are deterministic.
- The document list exposes safe current-version index summaries with no N+1 queries.
- Parsing retry and local-index retry remain independent in service, IPC, polling, and UI.
- All tests and quality gates in Task 10 pass, manual Electron validation is recorded, and the user
  receives the unstaged/uncommitted implementation for acceptance.
