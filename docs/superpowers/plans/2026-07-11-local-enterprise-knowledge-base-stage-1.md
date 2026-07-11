# Local Enterprise Knowledge Base Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add normalized local document/version storage, content-addressed managed files, durable
ingestion jobs, and non-destructive legacy migration without changing the current knowledge-base UI
or OpenClaw behavior.

**Architecture:** Add a domain-neutral `src/main/knowledgeBase/` subsystem backed by the existing
SQLite database. Stage 1 runs as an additive shadow migration: legacy `extraction_sources` remains
readable and unchanged while new normalized rows and managed blobs are created idempotently.

**Tech Stack:** TypeScript, Electron main process, better-sqlite3, Node.js filesystem/crypto APIs,
Vitest.

## Global Constraints

- Node.js remains `>=24.15.0 <25`.
- Do not add a new runtime dependency.
- Use 2-space indentation, single quotes, and semicolons.
- Use shared `as const` objects for statuses, modes, and stable error codes.
- Parsing, OCR, indexing, and managed storage remain local by default.
- Stage 1 must not change renderer behavior, OpenClaw runtime behavior, or existing IPC contracts.
- Do not remove, rewrite, or truncate legacy `extraction_sources` data.
- Preserve the user's current uncommitted OCR/upload changes and avoid unrelated formatting churn.
- Do not create commits until the user has tested and explicitly confirmed, per repository policy.
- Each production behavior change must follow red-green-refactor TDD.
- Changed TypeScript files must pass repository changed-file ESLint with zero warnings.

---

## File Structure

### New shared files

- `src/shared/knowledgeBase/constants.ts`: source modes, document/job/migration states, error codes,
  and capacity defaults.
- `src/shared/knowledgeBase/types.ts`: stable document, version, job, attempt, migration, and input
  contracts.
- `src/shared/knowledgeBase/contracts.test.ts`: contract-value and transition-invariant tests.

### New main-process files

- `src/main/knowledgeBase/knowledgeDocumentStore.ts`: document/version schema and CRUD.
- `src/main/knowledgeBase/knowledgeDocumentStore.test.ts`: version, revision, tombstone, and listing
  tests.
- `src/main/knowledgeBase/knowledgeManagedFileStore.ts`: safe content-addressed blob import.
- `src/main/knowledgeBase/knowledgeManagedFileStore.test.ts`: hashing, deduplication, and traversal
  tests.
- `src/main/knowledgeBase/knowledgeIngestionJobStore.ts`: durable job/attempt state machine.
- `src/main/knowledgeBase/knowledgeIngestionJobStore.test.ts`: claim, heartbeat, retry, cancellation,
  and recovery tests.
- `src/main/knowledgeBase/knowledgeMigrationStore.ts`: migration checkpoint persistence.
- `src/main/knowledgeBase/knowledgeMigrationStore.test.ts`: checkpoint and retry tests.
- `src/main/knowledgeBase/knowledgeMigrationService.ts`: idempotent legacy source migration.
- `src/main/knowledgeBase/knowledgeMigrationService.test.ts`: file-backed, text-only, metadata-only,
  and failure tests.
- `src/main/knowledgeBase/knowledgeBaseFoundation.ts`: dependency composition and non-blocking shadow
  migration entrypoint.
- `src/main/knowledgeBase/knowledgeBaseFoundation.test.ts`: one-shot startup and non-fatal failure
  behavior.

### Existing files modified only at the integration edge

- `src/main/main.ts`: construct and start the shadow migration after handler registration without
  blocking app startup.

---

## Task 1: Shared Knowledge-Base Contracts

**Files:**

- Create: `src/shared/knowledgeBase/constants.ts`
- Create: `src/shared/knowledgeBase/types.ts`
- Create: `src/shared/knowledgeBase/contracts.test.ts`

**Interfaces:**

- Produces value objects: `KnowledgeDocumentSourceMode`, `KnowledgeDocumentStatus`,
  `KnowledgeIngestionStage`, `KnowledgeIngestionJobStatus`, `KnowledgeIngestionAttemptOutcome`,
  `KnowledgeMigrationStatus`, and `KnowledgeBaseErrorCode`.
- Produces limits: `KNOWLEDGE_MAX_FILE_BYTES`, `KNOWLEDGE_MAX_SELECTION_FILES`,
  `KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES`, `KNOWLEDGE_GENERAL_JOB_CONCURRENCY`, and
  `KNOWLEDGE_OCR_JOB_CONCURRENCY`.
- Produces TypeScript interfaces consumed by all later tasks.

- [ ] **Step 1: Write the failing contract test**

```ts
import { describe, expect, test } from 'vitest';

import {
  KNOWLEDGE_GENERAL_JOB_CONCURRENCY,
  KNOWLEDGE_MAX_FILE_BYTES,
  KNOWLEDGE_MAX_SELECTION_FILES,
  KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES,
  KNOWLEDGE_OCR_JOB_CONCURRENCY,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeIngestionAttemptOutcome,
  KnowledgeIngestionJobStatus,
  KnowledgeIngestionStage,
  KnowledgeMigrationStatus,
} from './constants';

describe('knowledge base contracts', () => {
  test('publishes stable local-enterprise status values', () => {
    expect(KnowledgeDocumentSourceMode).toEqual({ Managed: 'managed', Linked: 'linked' });
    expect(KnowledgeDocumentStatus.CompletedWithoutText).toBe('completed_without_text');
    expect(KnowledgeIngestionJobStatus).toEqual({
      Queued: 'queued',
      Running: 'running',
      Completed: 'completed',
      Failed: 'failed',
      Cancelled: 'cancelled',
    });
    expect(KnowledgeIngestionAttemptOutcome.Abandoned).toBe('abandoned');
    expect(KnowledgeIngestionStage.FactExtraction).toBe('fact_extraction');
    expect(KnowledgeMigrationStatus.Completed).toBe('completed');
  });

  test('publishes the approved capacity defaults', () => {
    expect(KNOWLEDGE_MAX_FILE_BYTES).toBe(50 * 1024 * 1024);
    expect(KNOWLEDGE_MAX_SELECTION_FILES).toBe(100);
    expect(KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES).toBe(20 * 1024 * 1024 * 1024);
    expect(KNOWLEDGE_GENERAL_JOB_CONCURRENCY).toBe(2);
    expect(KNOWLEDGE_OCR_JOB_CONCURRENCY).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- src/shared/knowledgeBase/contracts.test.ts
```

Expected: FAIL because `./constants` does not exist.

- [ ] **Step 3: Add the shared constants and types**

`constants.ts` must define every discriminant as an `as const` object and derive its matching type.
The document statuses are `pending`, `processing`, `ready`, `completed_without_text`, and `failed`.
The ingestion stages are `queued`, `parsing`, `ocr`, `chunking`, `indexing`, and
`fact_extraction`. The migration statuses are `pending`, `running`, `completed`, and `failed`.
`KnowledgeBaseErrorCode` must contain these exact stable values:

```ts
export const KnowledgeBaseErrorCode = {
  RevisionConflict: 'revision_conflict',
  InvalidManagedPath: 'invalid_managed_path',
  FileTooLarge: 'file_too_large',
  JobStateConflict: 'job_state_conflict',
  MigrationFailed: 'migration_failed',
} as const;
```

`types.ts` must export these exact public shapes:

```ts
export interface KnowledgeDocument {
  id: string;
  workspaceId: string;
  legacySourceId: string | null;
  displayName: string;
  sourceMode: KnowledgeDocumentSourceMode;
  originalPath: string | null;
  currentVersionId: string;
  revision: number;
  status: KnowledgeDocumentStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface KnowledgeDocumentSummary extends KnowledgeDocument {
  fileSize: number | null;
  mimeType: string | null;
  contentHash: string | null;
}

export interface KnowledgeDocumentVersion {
  id: string;
  documentId: string;
  contentHash: string | null;
  managedPath: string | null;
  mimeType: string | null;
  fileSize: number | null;
  sourceMtime: number | null;
  parser: string | null;
  extractedText: string | null;
  extractionPartial: boolean;
  createdAt: string;
}

export interface CreateKnowledgeDocumentInput {
  workspaceId: string;
  legacySourceId?: string;
  displayName: string;
  sourceMode: KnowledgeDocumentSourceMode;
  originalPath?: string;
  status: KnowledgeDocumentStatus;
  version: Omit<KnowledgeDocumentVersion, 'id' | 'documentId' | 'createdAt'>;
}
```

Also define exact row-facing interfaces for `KnowledgeIngestionJob`,
`KnowledgeIngestionJobAttempt`, and `KnowledgeMigrationState` matching the approved design.

- [ ] **Step 4: Run the contract test and verify GREEN**

Run the Task 1 test command. Expected: 2 tests pass.

- [ ] **Step 5: Run changed-file lint and review the diff**

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/shared/knowledgeBase/constants.ts \
  src/shared/knowledgeBase/types.ts \
  src/shared/knowledgeBase/contracts.test.ts
```

Expected: exit code 0. Do not commit; record this as the first review checkpoint.

---

## Task 2: Document and Immutable Version Store

**Files:**

- Create: `src/main/knowledgeBase/knowledgeDocumentStore.ts`
- Create: `src/main/knowledgeBase/knowledgeDocumentStore.test.ts`

**Interfaces:**

- Consumes Task 1 document types and constants.
- Produces class `KnowledgeDocumentStore` with:

```ts
constructor(db: Database.Database)
createDocumentWithVersion(input: CreateKnowledgeDocumentInput): {
  document: KnowledgeDocument;
  version: KnowledgeDocumentVersion;
}
getDocument(documentId: string): KnowledgeDocument | null
getVersion(versionId: string): KnowledgeDocumentVersion | null
findByLegacySourceId(workspaceId: string, legacySourceId: string): KnowledgeDocument | null
listDocuments(workspaceId: string, options?: { includeDeleted?: boolean }): KnowledgeDocumentSummary[]
updateDocumentMetadata(documentId: string, expectedRevision: number, patch: {
  displayName?: string;
  status?: KnowledgeDocumentStatus;
}): KnowledgeDocument
addVersion(documentId: string, expectedRevision: number, version: CreateKnowledgeDocumentInput['version']): {
  document: KnowledgeDocument;
  version: KnowledgeDocumentVersion;
}
softDeleteDocument(documentId: string, expectedRevision: number): KnowledgeDocument
restoreDocument(documentId: string, expectedRevision: number): KnowledgeDocument
```

- Produces `KnowledgeDocumentRevisionConflictError`, including the current document.

- [ ] **Step 1: Write failing revision and version tests**

```ts
test('creates an immutable version and rejects stale metadata revisions', () => {
  const created = store.createDocumentWithVersion(createInput());

  const renamed = store.updateDocumentMetadata(created.document.id, 1, {
    displayName: '新版产品手册',
  });
  expect(renamed.revision).toBe(2);
  expect(() =>
    store.updateDocumentMetadata(created.document.id, 1, { displayName: '旧页面覆盖' }),
  ).toThrow(KnowledgeDocumentRevisionConflictError);
  expect(store.getVersion(created.version.id)?.extractedText).toBe('原始资料文本');
});

test('lists 1000 document summaries without exposing extracted text', () => {
  for (let index = 0; index < 1000; index += 1) {
    store.createDocumentWithVersion(createInput({
      displayName: `资料-${index}`,
      legacySourceId: `legacy-${index}`,
    }));
  }

  const documents = store.listDocuments('workspace-a');
  expect(documents).toHaveLength(1000);
  expect(documents[0]).not.toHaveProperty('extractedText');
});
```

Add focused tests for `addVersion`, `softDeleteDocument`, `restoreDocument`, and the unique
`(workspace_id, legacy_source_id)` idempotency constraint.

- [ ] **Step 2: Run the store test and verify RED**

```bash
npm test -- src/main/knowledgeBase/knowledgeDocumentStore.test.ts
```

Expected: FAIL because the store module does not exist.

- [ ] **Step 3: Implement schema initialization and row mapping**

Create `knowledge_documents` and `knowledge_document_versions` exactly as specified. Use a partial
unique index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_documents_legacy_source
ON knowledge_documents(workspace_id, legacy_source_id)
WHERE legacy_source_id IS NOT NULL;
```

Use explicit SELECT column lists. `listDocuments` joins only the active version metadata and never
selects `extracted_text`.

- [ ] **Step 4: Implement transactional CRUD and optimistic revisions**

`createDocumentWithVersion` and `addVersion` run inside better-sqlite3 transactions. Revision updates
must use `WHERE id = ? AND revision = ?`; zero changed rows trigger a fresh read and throw
`KnowledgeDocumentRevisionConflictError`.

- [ ] **Step 5: Run tests and lint**

Run the Task 2 test, the Task 1 contract test, and changed-file ESLint for both Task 2 files. Expected:
all pass with no warnings. Do not commit.

---

## Task 3: Content-Addressed Managed File Store

**Files:**

- Create: `src/main/knowledgeBase/knowledgeManagedFileStore.ts`
- Create: `src/main/knowledgeBase/knowledgeManagedFileStore.test.ts`

**Interfaces:**

```ts
export interface ImportedKnowledgeBlob {
  contentHash: string;
  fileSize: number;
  managedPath: string;
  reused: boolean;
}

export class KnowledgeManagedFileStore {
  constructor(rootDir: string)
  importFile(sourcePath: string): Promise<ImportedKnowledgeBlob>
  importTextSnapshot(text: string): Promise<ImportedKnowledgeBlob>
  resolveManagedPath(managedPath: string): string
}
```

- [ ] **Step 1: Write failing deduplication and traversal tests**

```ts
test('stores identical bytes once and returns a relative managed path', async () => {
  await fs.writeFile(firstPath, 'same bytes');
  await fs.writeFile(secondPath, 'same bytes');

  const first = await store.importFile(firstPath);
  const second = await store.importFile(secondPath);

  expect(first.contentHash).toBe(second.contentHash);
  expect(first.managedPath).toBe(second.managedPath);
  expect(first.reused).toBe(false);
  expect(second.reused).toBe(true);
  expect(path.isAbsolute(first.managedPath)).toBe(false);
});

test('rejects managed paths outside the blob root', () => {
  expect(() => store.resolveManagedPath('../secrets.txt')).toThrow('Invalid managed blob path');
});
```

Also test `importTextSnapshot`, source-file size enforcement, and temporary-file cleanup when a read
fails.

- [ ] **Step 2: Run the file-store test and verify RED**

Run `npm test -- src/main/knowledgeBase/knowledgeManagedFileStore.test.ts`. Expected: missing module.

- [ ] **Step 3: Implement atomic SHA-256 import**

Stream the source into `<root>/tmp/<uuid>.tmp` while updating a SHA-256 hash and byte count. Reject
files over `KNOWLEDGE_MAX_FILE_BYTES`. Fsync and close the temporary file, create the two-character
hash-prefix directory, and rename to `blobs/<prefix>/<hash>`. If the target already exists, delete the
temporary file and return `reused: true`.

`resolveManagedPath` accepts only `blobs/<two lowercase hex>/<64 lowercase hex>` and verifies that the
resolved path remains under `rootDir`.

- [ ] **Step 4: Run tests and lint**

Run Task 3 tests plus Task 1 contracts, then changed-file ESLint. Expected: all pass. Do not commit.

---

## Task 4: Durable Ingestion Job and Attempt Store

**Files:**

- Create: `src/main/knowledgeBase/knowledgeIngestionJobStore.ts`
- Create: `src/main/knowledgeBase/knowledgeIngestionJobStore.test.ts`

**Interfaces:**

```ts
createJob(input: {
  workspaceId: string;
  documentId: string;
  documentVersionId: string;
}): KnowledgeIngestionJob
getJob(jobId: string): KnowledgeIngestionJob | null
claimNextJob(now?: string): {
  job: KnowledgeIngestionJob;
  attempt: KnowledgeIngestionJobAttempt;
} | null
heartbeat(jobId: string, attemptId: string, progress: number, now?: string): KnowledgeIngestionJob
complete(jobId: string, attemptId: string, now?: string): KnowledgeIngestionJob
fail(jobId: string, attemptId: string, error: {
  code: string;
  message: string;
}, now?: string): KnowledgeIngestionJob
cancel(jobId: string, now?: string): KnowledgeIngestionJob
retry(jobId: string, now?: string): KnowledgeIngestionJob
recoverAbandonedJobs(staleBefore: string, now?: string): number
listAttempts(jobId: string): KnowledgeIngestionJobAttempt[]
```

- [ ] **Step 1: Write failing lifecycle tests**

```ts
test('claims a queued job and records a running attempt', () => {
  const job = store.createJob(jobInput());
  const claim = store.claimNextJob('2026-07-11T01:00:00.000Z');

  expect(claim?.job.id).toBe(job.id);
  expect(claim?.job.status).toBe(KnowledgeIngestionJobStatus.Running);
  expect(claim?.attempt.attemptNumber).toBe(1);
  expect(store.listAttempts(job.id)[0].outcome).toBe(
    KnowledgeIngestionAttemptOutcome.Running,
  );
});

test('recovers stale running jobs without erasing the abandoned attempt', () => {
  const job = store.createJob(jobInput());
  store.claimNextJob('2026-07-11T01:00:00.000Z');

  expect(
    store.recoverAbandonedJobs(
      '2026-07-11T01:05:00.000Z',
      '2026-07-11T01:10:00.000Z',
    ),
  ).toBe(1);
  expect(store.getJob(job.id)?.status).toBe(KnowledgeIngestionJobStatus.Queued);
  expect(store.listAttempts(job.id)[0].outcome).toBe(
    KnowledgeIngestionAttemptOutcome.Abandoned,
  );
});
```

Add tests for heartbeat clamping, completion, failure, cancellation, retry, and preventing more than
one active job per document version.

- [ ] **Step 2: Run tests and verify RED**

Run the Task 4 test file. Expected: missing module.

- [ ] **Step 3: Implement transactional job state transitions**

Create `knowledge_ingestion_jobs` and `knowledge_ingestion_job_attempts`. Every transition validates
the current status and attempt ID. `claimNextJob` selects the oldest queued job and changes the job
plus inserts the attempt in one transaction. Recovery marks the running attempt abandoned before
requeueing its job.

- [ ] **Step 4: Run tests and lint**

Run Task 4 and Task 1 tests plus changed-file ESLint. Expected: all pass. Do not commit.

---

## Task 5: Migration Checkpoint Store

**Files:**

- Create: `src/main/knowledgeBase/knowledgeMigrationStore.ts`
- Create: `src/main/knowledgeBase/knowledgeMigrationStore.test.ts`

**Interfaces:**

```ts
getState(workspaceId: string): KnowledgeMigrationState | null
begin(workspaceId: string, version: number, sourceCount: number, now?: string): KnowledgeMigrationState
recordProgress(workspaceId: string, migratedCount: number, lastSourceId: string, now?: string): KnowledgeMigrationState
complete(workspaceId: string, diagnostics: string[], now?: string): KnowledgeMigrationState
fail(workspaceId: string, diagnostics: string[], now?: string): KnowledgeMigrationState
```

- [ ] **Step 1: Write failing checkpoint tests**

```ts
test('persists progress and restarts a failed migration without losing its checkpoint', () => {
  store.begin('workspace-a', 1, 3, '2026-07-11T01:00:00.000Z');
  store.recordProgress('workspace-a', 1, 'legacy-1', '2026-07-11T01:01:00.000Z');
  store.fail('workspace-a', ['source 2 unavailable'], '2026-07-11T01:02:00.000Z');

  const restarted = store.begin('workspace-a', 1, 3, '2026-07-11T01:03:00.000Z');
  expect(restarted.status).toBe(KnowledgeMigrationStatus.Running);
  expect(restarted.migratedCount).toBe(1);
  expect(restarted.lastSourceId).toBe('legacy-1');
});
```

Also test diagnostic truncation and completed-state idempotency.

- [ ] **Step 2: Run tests and verify RED**

Run the Task 5 test file. Expected: missing module.

- [ ] **Step 3: Implement checkpoint persistence**

Create `knowledge_migration_state` with workspace primary key. Bound diagnostics to 50 entries and
500 characters per entry. `begin` preserves a same-version failed checkpoint, resets a different
version, and returns a completed same-version state unchanged.

- [ ] **Step 4: Run tests and lint**

Run Task 5 and Task 1 tests plus changed-file ESLint. Expected: all pass. Do not commit.

---

## Task 6: Idempotent Legacy Migration Service

**Files:**

- Create: `src/main/knowledgeBase/knowledgeMigrationService.ts`
- Create: `src/main/knowledgeBase/knowledgeMigrationService.test.ts`

**Interfaces:**

```ts
export interface LegacyKnowledgeWorkspace {
  id: string;
  extractionSources: EnterpriseLeadExtractionSource[];
}

export interface KnowledgeMigrationResult {
  workspaceId: string;
  sourceCount: number;
  migratedCount: number;
  skippedCount: number;
  status: KnowledgeMigrationStatus;
  diagnostics: string[];
}

migrateWorkspace(workspace: LegacyKnowledgeWorkspace): Promise<KnowledgeMigrationResult>
```

Construct the service with explicit dependencies so the database portion can be atomic:

```ts
constructor(options: {
  db: Database.Database;
  documentStore: KnowledgeDocumentStore;
  managedFileStore: KnowledgeManagedFileStore;
  jobStore: KnowledgeIngestionJobStore;
  migrationStore: KnowledgeMigrationStore;
  fileExists?: (filePath: string) => Promise<boolean>;
})
```

- [ ] **Step 1: Write failing migration tests**

```ts
test('migrates file-backed, text-only, and metadata-only legacy sources idempotently', async () => {
  const result = await service.migrateWorkspace({
    id: 'workspace-a',
    extractionSources: [fileSource, textOnlySource, metadataOnlySource],
  });

  expect(result.status).toBe(KnowledgeMigrationStatus.Completed);
  expect(documentStore.listDocuments('workspace-a')).toHaveLength(3);
  expect(documentStore.findByLegacySourceId('workspace-a', fileSource.id!)).not.toBeNull();
  expect(
    documentStore.findByLegacySourceId('workspace-a', metadataOnlySource.id!)?.status,
  ).toBe(KnowledgeDocumentStatus.CompletedWithoutText);

  await service.migrateWorkspace({
    id: 'workspace-a',
    extractionSources: [fileSource, textOnlySource, metadataOnlySource],
  });
  expect(documentStore.listDocuments('workspace-a')).toHaveLength(3);
});
```

Add tests proving that a missing file falls back to saved text, a source without file or text becomes
metadata-only, a managed-file failure records a failed checkpoint without changing the input object,
and deterministic fallback legacy IDs remain stable.

- [ ] **Step 2: Run tests and verify RED**

Run the Task 6 test file. Expected: missing module.

- [ ] **Step 3: Implement deterministic legacy identity and source mapping**

Preserve non-empty `source.id`. Otherwise compute:

```ts
crypto
  .createHash('sha256')
  .update(workspaceId)
  .update('\0')
  .update(String(sourceIndex))
  .update('\0')
  .update(source.label ?? '')
  .update('\0')
  .update(source.filePath ?? '')
  .update('\0')
  .update(source.createdAt ?? '')
  .digest('hex');
```

Use `findByLegacySourceId` before importing. Existing migrated rows count as skipped and advance the
checkpoint.

- [ ] **Step 4: Implement the migration fallback order**

For each source:

1. If `filePath` is an existing file, call `importFile` and create a managed version.
2. Otherwise, if trimmed `text` exists, call `importTextSnapshot` and store the legacy text as the
   version's extracted text.
3. Otherwise create a metadata-only version and mark the document `completed_without_text`.
4. Create an ingestion job only when the migrated version has managed content or extracted text.
5. After asynchronous blob import completes, wrap document/version creation, optional job creation,
   and checkpoint advancement in one outer `db.transaction`. Store-local transactions execute as
   nested savepoints. A job or checkpoint failure must roll back the new document and version.

Do not mutate the legacy source array or write `extraction_sources`.

- [ ] **Step 5: Run tests and lint**

Run Tasks 1–6 targeted tests and changed-file ESLint for Task 6. Expected: all pass. Do not commit.

---

## Task 7: Foundation Composition and Non-Blocking Shadow Startup

**Files:**

- Create: `src/main/knowledgeBase/knowledgeBaseFoundation.ts`
- Create: `src/main/knowledgeBase/knowledgeBaseFoundation.test.ts`
- Modify: `src/main/main.ts`

**Interfaces:**

```ts
export interface KnowledgeBaseFoundation {
  documentStore: KnowledgeDocumentStore;
  jobStore: KnowledgeIngestionJobStore;
  migrationStore: KnowledgeMigrationStore;
  migrationService: KnowledgeMigrationService;
  recoverAndMigrate(workspaces: LegacyKnowledgeWorkspace[]): Promise<void>;
}

export const createKnowledgeBaseFoundation = (options: {
  db: Database.Database;
  userDataPath: string;
}): KnowledgeBaseFoundation;

export const recoverAndMigrateKnowledgeBase = (options: {
  jobStore: Pick<KnowledgeIngestionJobStore, 'recoverAbandonedJobs'>;
  migrationService: Pick<KnowledgeMigrationService, 'migrateWorkspace'>;
  workspaces: LegacyKnowledgeWorkspace[];
  staleBefore: string;
  now: string;
  onMigrationError?: (workspaceId: string, error: unknown) => void;
}): Promise<void>;
```

- [ ] **Step 1: Write failing foundation tests**

```ts
test('recovers abandoned jobs before migrating workspaces', async () => {
  const events: string[] = [];
  await recoverAndMigrateKnowledgeBase({
    jobStore: {
      recoverAbandonedJobs: () => {
        events.push('recover-jobs');
        return 0;
      },
    },
    migrationService: {
      migrateWorkspace: async workspace => {
        events.push(`migrate:${workspace.id}`);
        return completedMigrationResult(workspace.id);
      },
    },
    workspaces: [{ id: 'workspace-a', extractionSources: [] }],
    staleBefore: '2026-07-11T00:50:00.000Z',
    now: '2026-07-11T01:00:00.000Z',
  });

  expect(events).toEqual(['recover-jobs', 'migrate:workspace-a']);
});

test('continues migrating later workspaces after one migration fails', async () => {
  const migrated: string[] = [];
  const errors: string[] = [];
  await expect(
    recoverAndMigrateKnowledgeBase({
      jobStore: { recoverAbandonedJobs: () => 0 },
      migrationService: {
        migrateWorkspace: async workspace => {
          if (workspace.id === 'workspace-a') throw new Error('broken legacy source');
          migrated.push(workspace.id);
          return completedMigrationResult(workspace.id);
        },
      },
      workspaces: [
        { id: 'workspace-a', extractionSources: [] },
        { id: 'workspace-b', extractionSources: [] },
      ],
      staleBefore: '2026-07-11T00:50:00.000Z',
      now: '2026-07-11T01:00:00.000Z',
      onMigrationError: workspaceId => errors.push(workspaceId),
    }),
  ).resolves.toBeUndefined();
  expect(errors).toEqual(['workspace-a']);
  expect(migrated).toEqual(['workspace-b']);
});
```

The test file defines `completedMigrationResult(workspaceId)` as a concrete
`KnowledgeMigrationResult` with zero counts, `KnowledgeMigrationStatus.Completed`, and empty
diagnostics.

- [ ] **Step 2: Run tests and verify RED**

Run the Task 7 test file. Expected: missing module.

- [ ] **Step 3: Implement foundation composition**

Construct all stores from one existing database connection and managed root
`<userDataPath>/knowledge-base`. `recoverAndMigrate` calls job recovery first, then migrates
workspaces sequentially. Log one concise warning per failed workspace and continue.

- [ ] **Step 4: Add minimal main-process startup wiring**

Add a lazy singleton beside the existing enterprise workspace store/service singletons. After
`registerEnterpriseLeadWorkspaceHandlers`, start migration without awaiting it:

```ts
void getKnowledgeBaseFoundation()
  .recoverAndMigrate(getEnterpriseLeadWorkspaceStore().listWorkspaces())
  .catch(error => {
    console.error('[KnowledgeBase] Shadow migration failed:', error);
  });
```

Use `app.getPath('userData')` only in the main-process composition function. Do not touch existing
OCR handler code or renderer contracts.

- [ ] **Step 5: Run tests, compile, and lint**

Run all Stage 1 targeted tests, existing enterprise workspace store/service tests,
`npm run compile:electron`, and changed-file ESLint including `src/main/main.ts`. Expected: all pass.
Do not commit.

---

## Task 8: Stage 1 Regression and Handoff Review

**Files:**

- Verify all Stage 1 files and the approved design/plan documents.

- [ ] **Step 1: Run the complete targeted test set**

```bash
npm test -- \
  src/shared/knowledgeBase/contracts.test.ts \
  src/main/knowledgeBase/knowledgeDocumentStore.test.ts \
  src/main/knowledgeBase/knowledgeManagedFileStore.test.ts \
  src/main/knowledgeBase/knowledgeIngestionJobStore.test.ts \
  src/main/knowledgeBase/knowledgeMigrationStore.test.ts \
  src/main/knowledgeBase/knowledgeMigrationService.test.ts \
  src/main/knowledgeBase/knowledgeBaseFoundation.test.ts \
  src/main/enterpriseLeadWorkspace/store.test.ts \
  src/main/enterpriseLeadWorkspace/service.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 2: Run compile and changed-file lint**

Run `npm run compile:electron`, then changed-file ESLint across every new or modified TypeScript file.
Expected: exit code 0 and zero warnings.

- [ ] **Step 3: Review schema and filesystem invariants**

Confirm from tests and diff that:

- list queries do not select `extracted_text`;
- legacy JSON is never updated by migration;
- managed paths are relative and traversal-safe;
- no API key or raw document text appears in migration diagnostics;
- every background target uses document/version IDs;
- current OCR/upload edits are unchanged except for non-overlapping main-process integration lines.

- [ ] **Step 4: Report for user testing**

Provide changed files, tests, compile/lint results, migration behavior, known Stage 2 omissions, and
manual inspection instructions. Do not stage or commit until the user confirms testing.
