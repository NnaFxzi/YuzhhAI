# Local Enterprise Knowledge Base Design

Date: 2026-07-11
Status: Approved for implementation planning

## 1. Purpose

Build a production-grade, single-machine knowledge base for LobsterAI's Electron desktop app.
The first release targets 100–1,000 documents per workspace and remains fully usable without a
server. The data model must also preserve stable identities, versions, and deletion semantics so a
later local-first synchronization layer can be added without redesigning the local domain.

This design replaces the current model incrementally. It does not rewrite the whole workspace UI,
OpenClaw runtime, or existing OCR feature in one change.

## 2. Confirmed Product Decisions

- The first release is a single-machine enterprise edition using Electron and local SQLite.
- A workspace supports 100–1,000 documents.
- Imported files are copied into LobsterAI-managed storage by default.
- An advanced linked-file mode remains available for users who intentionally want to follow an
  external file.
- Parsing, OCR, chunking, indexing, and retrieval run locally by default.
- Sending document text to a cloud model for structured fact extraction requires explicit user
  authorization. A workspace can be configured as local-only.
- Existing `extractionSources` data must migrate automatically without destructive changes.
- Migration failures remain retryable and must not prevent legacy data from being read.
- The implementation uses a gradual replacement approach rather than a big-bang rewrite.

## 3. Current Problems Being Addressed

The current implementation stores document metadata, raw text, extraction state, and index state in
the workspace's `extraction_sources` JSON field. Updates replace the complete array. Background work
identifies sources by array index. Raw text is duplicated in the workspace JSON and
`content_knowledge_chunks`. Index synchronization deletes and rebuilds the complete workspace scope,
and retrieval loads every chunk in a scope before scoring.

Consequences include:

- concurrent updates can overwrite newer document state;
- adding or deleting a source can make an index-based job target the wrong source;
- moving or modifying an original local file can make previews disagree with the indexed snapshot;
- application restarts lose the in-memory processing queue;
- minor edits rebuild the complete index;
- facts cannot reliably retain multiple evidence sources;
- untrusted document instructions can enter model context without an explicit trust boundary;
- 100–1,000 document workspaces would create excessive renderer payloads and main-process work.

## 4. Delivery Strategy

Use a strangler migration with four independently testable stages.

### Stage 1: Document infrastructure

Create normalized document, version, and ingestion-job stores; managed blob storage; stable IDs;
optimistic revisions; and a resumable local job foundation. Preserve the existing renderer and
agent behavior through an adapter and legacy compatibility mirror.

### Stage 2: Upload and file-management cutover

Introduce document-level IPC operations and move the workspace creation and knowledge-base upload
flows to them. Replace `sourceIndex` jobs with document/version IDs. Add batch status, cancel, retry,
version, and explicit no-text behavior.

### Stage 3: Incremental retrieval and fact evidence

Add FTS5 retrieval, incremental chunk updates, optional local semantic embeddings, structured facts,
evidence links, and citations. Remove whole-scope index rebuilding and full-scope in-memory scoring.

### Stage 4: Legacy field retirement

Stop storing raw text in `extraction_sources`. Derive the enterprise workspace profile from confirmed
facts. Keep a read-only compatibility path for one release cycle before removing obsolete data.

## 5. Domain Boundaries

Create a domain-neutral `src/main/knowledgeBase/` boundary. Enterprise-lead behavior consumes this
domain through an adapter rather than owning document persistence.

Planned modules:

- `knowledgeDocumentStore.ts`: document and document-version persistence.
- `knowledgeManagedFileStore.ts`: hashing, deduplicated blob storage, atomic import, and safe release.
- `knowledgeIngestionJobStore.ts`: durable job and attempt state, claims, heartbeat, retry, and
  cancellation.
- `knowledgeIngestionService.ts`: bounded scheduling and stage orchestration.
- `knowledgeMigrationStore.ts`: per-workspace migration checkpoints and diagnostics.
- `knowledgeMigrationService.ts`: idempotent legacy migration orchestration.
- `enterpriseLeadKnowledgeAdapter.ts`: compatibility projection for existing workspace types.

Stable shared discriminants, types, IPC channels, and limits live under
`src/shared/knowledgeBase/`. Implementations remain in the main process.

## 6. Storage Model

### 6.1 `knowledge_documents`

| Column                      | Meaning                                                             |
|-----------------------------|---------------------------------------------------------------------|
| `id`                        | Stable UUID. Never derived from array order or local path.          |
| `workspace_id`              | Owning enterprise workspace.                                        |
| `legacy_source_id`          | Nullable legacy source identity used only for idempotent migration. |
| `display_name`              | User-visible document name.                                         |
| `source_mode`               | `managed` or `linked`.                                              |
| `original_path`             | Original import path for diagnostics and linked mode.               |
| `current_version_id`        | Active immutable content version.                                   |
| `revision`                  | Monotonic integer for optimistic concurrency.                       |
| `status`                    | User-facing aggregate document state.                               |
| `created_at` / `updated_at` | ISO timestamps.                                                     |
| `deleted_at`                | Tombstone timestamp for future synchronization.                     |

Indexes:

- `(workspace_id, deleted_at, updated_at)` for document listing;
- `(workspace_id, current_version_id)` for active-version joins.
- unique `(workspace_id, legacy_source_id)` when `legacy_source_id` is not null, for idempotent
  migration.

### 6.2 `knowledge_document_versions`

| Column               | Meaning                                               |
|----------------------|-------------------------------------------------------|
| `id`                 | Stable UUID for an immutable content version.         |
| `document_id`        | Parent document.                                      |
| `content_hash`       | SHA-256 of imported bytes.                            |
| `managed_path`       | Blob-relative path for managed content.               |
| `mime_type`          | Detected MIME type, not only the extension.           |
| `file_size`          | Imported byte count.                                  |
| `source_mtime`       | Original file mtime when available.                   |
| `parser`             | Parser selected for this version.                     |
| `extracted_text`     | Local extracted text during the compatibility stages. |
| `extraction_partial` | Whether extraction intentionally omitted content.     |
| `created_at`         | Immutable version creation time.                      |

Indexes:

- `(document_id, created_at)` for version history;
- `(content_hash)` for blob reuse and duplicate diagnostics.

The first stage stores extracted text in SQLite for compatibility. Stage 3 may move large text into a
separate content table without changing the document/version identities.

### 6.3 `knowledge_ingestion_jobs`

| Column                                | Meaning                                    |
|---------------------------------------|--------------------------------------------|
| `id`                                  | Stable UUID.                               |
| `workspace_id`                        | Workspace scope.                           |
| `document_id` / `document_version_id` | Exact immutable processing target.         |
| `stage`                               | Current ingestion stage.                   |
| `status`                              | Queue state.                               |
| `progress`                            | Normalized 0–1 progress.                   |
| `attempt_count`                       | Number of claimed attempts.                |
| `error_code` / `error_message`        | Stable machine code plus sanitized detail. |
| `heartbeat_at`                        | Lease recovery timestamp.                  |
| `created_at` / `updated_at`           | Job timestamps.                            |

Only one active ingestion job may exist for a document version. A partial unique index enforces the
active statuses supported by SQLite.

### 6.4 `knowledge_ingestion_job_attempts`

| Column                         | Meaning                                                        |
|--------------------------------|----------------------------------------------------------------|
| `id`                           | Stable UUID for one claimed execution attempt.                 |
| `job_id`                       | Parent ingestion job.                                          |
| `attempt_number`               | Monotonic attempt number within the job.                       |
| `started_at` / `finished_at`   | Attempt timing.                                                |
| `outcome`                      | `running`, `completed`, `failed`, `cancelled`, or `abandoned`. |
| `error_code` / `error_message` | Sanitized failure detail for this attempt.                     |

Restart recovery marks the interrupted attempt `abandoned` before returning the parent job to the
queue. A retry therefore preserves prior outcomes rather than overwriting them.

### 6.5 `knowledge_migration_state`

| Column                                       | Meaning                                         |
|----------------------------------------------|-------------------------------------------------|
| `workspace_id`                               | Primary key and migration scope.                |
| `version`                                    | Target migration version.                       |
| `status`                                     | `pending`, `running`, `completed`, or `failed`. |
| `source_count` / `migrated_count`            | Checkpoint counters.                            |
| `last_source_id`                             | Stable resume cursor when one exists.           |
| `diagnostics_json`                           | Bounded, sanitized migration diagnostics.       |
| `started_at` / `updated_at` / `completed_at` | Migration timing.                               |

The migration store never contains raw document text. Diagnostics are capped and omit API keys,
stack traces, and managed-file contents.

## 7. Managed File Storage

Managed content lives under:

```text
<Electron userData>/knowledge-base/blobs/<sha256-prefix>/<sha256>
```

Import behavior:

1. The main process opens a file selected through an authorized picker result.
2. It validates the file type, file header, per-file limit, and workspace quota.
3. It copies bytes into a temporary file inside the managed storage root while calculating SHA-256.
4. It fsyncs and atomically renames the temporary file to the content-addressed blob path.
5. Existing blobs with the same hash are reused.
6. It creates a document and immutable version in one SQLite transaction.
7. It creates the initial ingestion job in the same transaction.

The system does not delete shared blobs merely because one document is deleted. Blob garbage
collection is a separate, conservative maintenance operation that removes only unreferenced blobs
older than a safety window.

Linked files keep their original path and hash snapshot. A changed or missing linked file is surfaced
as a source-state warning and never silently changes the active version.

## 8. Upload Authorization and Limits

Renderer code must not request arbitrary path reads for the knowledge-base flow. The main process
returns a short-lived opaque selection token. Import IPC accepts this token and resolves the path in
the main process. Tokens are bound to the requesting WebContents, expire after use or a short timeout,
and cannot represent directories.

Initial default limits:

- 50 MiB per file;
- 100 files per selection;
- 20 GiB of managed bytes per workspace;
- configurable bounded ingestion concurrency: 2 general jobs;
- OCR concurrency: 1 worker.

The 20 GiB quota is the logical sum of active managed document versions owned by the workspace.
Content-addressed deduplication may reduce physical disk usage but does not increase the workspace's
logical allowance.

The limits are shared constants and are validated again in the main process. UI validation is only a
fast feedback path, not the security boundary.

## 9. Ingestion Pipeline

Stages:

```text
queued
  -> parsing
  -> ocr (only when required)
  -> chunking
  -> indexing
  -> fact_extraction (only when enabled and authorized)
  -> completed | completed_without_text | failed
```

Rules:

- Every stage reads the target by `documentId` and `documentVersionId`.
- Before committing results, the worker verifies the document still points to that version and is not
  deleted.
- Application startup requeues abandoned `running` jobs whose heartbeat has expired.
- A retry creates a new attempt record/state transition and preserves the previous error in logs.
- Deleting a document cancels queued jobs. Running jobs stop before committing results.
- One failed document never fails the rest of a batch.
- `completed_without_text` means the file is retained but cannot be searched. It must not be displayed
  as indexed.
- Cloud fact extraction records consent mode, provider, model, and request time, but never API keys.

## 10. Parser Isolation and Untrusted Content

Parsing must run outside the renderer and should be isolated from the Electron main event loop. The
parser boundary enforces:

- compressed and uncompressed byte limits;
- archive entry count and XML size limits;
- PDF page limits;
- execution timeout;
- bounded memory where the platform permits;
- MIME/header validation before parser selection.

Retrieved chunks are untrusted evidence. Prompt construction must explicitly state that instructions
inside evidence are data and must not be executed. Document text cannot grant permissions, change
system behavior, request tools, or override workspace rules.

## 11. Local Retrieval

Stage 3 uses hybrid local retrieval:

1. SQLite FTS5 provides BM25 keyword candidates.
2. A local embedding provider optionally provides semantic candidates.
3. Candidate IDs are merged and reranked using keyword score, semantic score, source trust, user
   review state, and freshness.
4. Only Top-K candidates are loaded into prompt construction.

If no local embedding model is available, FTS5 remains a complete supported mode. The current
keyword-hash representation is treated as a compatibility implementation, not as a production
semantic embedding.

Chunks retain provenance fields including document version, ordinal, page/sheet/slide, character
offsets, and heading path so answers can cite and navigate to the original location.

## 12. Facts and Evidence

### 12.1 `knowledge_facts`

Facts have stable UUIDs, workspace scope, domain field, value, normalized value, review status,
source kind, optimistic revision, timestamps, and tombstone state.

Review states are `pending`, `confirmed`, and `rejected`. Source kinds are `extracted`, `manual`, and
`imported`.

### 12.2 `knowledge_fact_evidence`

Each evidence row links a fact to a document version and chunk. It records a supporting quote,
confidence, extractor identity, and creation time.

Rules:

- One fact can have multiple evidence sources.
- Deleting a document removes or tombstones only its evidence links.
- A fact without remaining evidence becomes a cleanup candidate only when it was not manually
  created.
- Manual facts are confirmed immediately.
- Model-extracted facts begin as pending.
- Prohibited claims and contact rules become hard rules only after manual creation or confirmation.
- Conflicting facts coexist with a conflict marker; extraction never silently overwrites them.
- Rejections attach to fact/evidence identity and version, not only normalized text, so corrected
  future evidence can be reviewed.
- Agent prompts treat only confirmed facts as high-trust structured business knowledge.

During migration, the existing enterprise workspace `profile` is a compatibility projection of
confirmed facts. Stage 4 makes this projection the only writer of profile knowledge fields.

## 13. Legacy Migration

Migration is per workspace and checkpointed.

1. Read each legacy `extractionSources` item and assign or preserve a stable source ID.
   Sources without an ID receive a deterministic migration key derived from workspace ID, source
   position, label, path, and creation timestamp; the legacy JSON itself remains unchanged.
2. If the original file exists, import it as a managed snapshot.
3. If the original file is missing but stored text exists, create a text-only managed version from
   that snapshot.
4. If neither file nor text exists, create a metadata-only document with
   `completed_without_text`.
5. Preserve labels, timestamps, summary, partial state, and sanitized errors where representable.
6. Validate document count, hashes, extracted-text lengths, and status mapping.
7. Mark the workspace migrated only after validation succeeds.

Migration does not delete or truncate `extraction_sources`. Failed migration keeps legacy reads
available and is retried on a later startup. New writes after Stage 2 go through the new service and
produce a legacy compatibility mirror until Stage 4.

Migration diagnostics are local and read-only. Ambiguous items are reported rather than silently
rewritten.

## 14. Compatibility and Cutover

Stage 1 is additive. It creates new storage and can run migration in shadow mode while the existing UI
continues to use legacy sources.

Stage 2 introduces document-level IPC operations:

- list documents without raw text;
- import selected files;
- get document details/version text on demand;
- update display metadata using `expectedRevision`;
- delete/restore a document;
- cancel/retry ingestion;
- list version history.

The renderer never sends or replaces the complete document collection. The enterprise adapter
creates the legacy projection only for compatibility consumers.

OpenClaw runtime integration remains unchanged until Stage 3. The new retrieval service will continue
to satisfy the existing `ContentKnowledgeRetriever` boundary during cutover.

## 15. Error Handling

- Database errors use stable error codes at IPC boundaries.
- User-visible errors are localized and do not expose internal paths or stack traces.
- Managed-file import cleans temporary files on pre-commit failure.
- Once a database transaction references a blob, destructive rollback does not delete that blob;
  conservative garbage collection handles it later.
- Revision conflicts return the latest document metadata and do not auto-merge.
- Missing linked files do not erase the last indexed version.
- Index or fact-extraction failure does not invalidate the managed document snapshot.

## 16. Testing and Quality Gates

All behavior changes follow test-driven development.

Stage 1 requires tests for:

- document/version creation and optimistic revision conflicts;
- immutable version history;
- content-hash blob deduplication;
- atomic import cleanup;
- job claim, heartbeat, retry, cancellation, and restart recovery;
- no-text status semantics;
- legacy migration from file-backed, text-only, metadata-only, and failed sources;
- migration retry and idempotency;
- legacy data preservation when migration fails;
- 1,000-document metadata listing without loading extracted text;
- path traversal resistance for managed blob paths.

Later stages add tests for picker token authorization, bounded concurrency, parser limits, incremental
FTS indexing, evidence preservation, citations, prompt-injection boundaries, and full workspace
cutover.

Required verification for each implementation batch:

- targeted Vitest tests;
- changed-file ESLint with zero warnings;
- `npm run compile:electron` for main/preload changes;
- renderer build when IPC or renderer types change;
- diff review for unrelated churn and user-visible i18n strings.

## 17. Stage 1 Implementation Boundary

The first implementation plan is intentionally limited to foundational storage:

- shared knowledge-base constants and types;
- SQLite document, version, migration-state, and ingestion-job stores;
- managed blob storage;
- stable IDs and optimistic revisions;
- legacy migration service in shadow mode;
- unit and integration tests for those components.

Stage 1 does not switch the current UI, retrieval implementation, Agent prompts, or OpenClaw runtime.
It does not remove legacy JSON or refactor the oversized knowledge-base React component. Those changes
belong to separate reviewed plans.

## 18. Success Criteria

Stage 1 is complete when:

- a workspace can represent 1,000 document metadata rows without reading raw text;
- identical imported bytes reuse one managed blob;
- queued/running jobs recover after simulated restart;
- stale revisions cannot overwrite current document state;
- every job targets a stable document version rather than an array index;
- legacy migration is idempotent, retryable, and non-destructive;
- existing enterprise workspace behavior and targeted tests remain unchanged;
- no current user OCR/upload changes are reverted or reformatted.
