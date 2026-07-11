# Local Enterprise Knowledge Base Stage 2 Design

Date: 2026-07-11
Status: Approved for implementation planning

## 1. Purpose

Cut the enterprise workspace upload and document-management flow over to the normalized local
knowledge-base foundation delivered in Stage 1. This stage provides the first user-visible vertical
slice for managed file import, metadata-only document listing, soft deletion, restoration, failed-job
retry, and processing-status refresh while preserving current enterprise-agent behavior through a
temporary legacy compatibility projection.

The release remains a single-machine Electron application. It targets 100–1,000 documents per
workspace and keeps parsing, OCR, storage, and processing local by default.

## 2. Confirmed Scope

Stage 2 includes:

- main-process file selection using short-lived opaque selection tokens;
- managed, content-addressed multi-file import;
- document-level IPC for list, details, import, delete, restore, and failed-job retry;
- partial-success batch results;
- durable jobs addressed by stable document and document-version IDs;
- a bounded local ingestion worker that parses managed files and runs OCR without a cloud model;
- renderer status refresh through bounded short polling;
- a temporary `extractionSources` compatibility projection for existing extraction, indexing, and
  agent consumers;
- localized user-visible errors and status labels.

Stage 2 does not include:

- version-history UI;
- cancellation of a currently running ingestion attempt;
- FTS5 or semantic retrieval cutover;
- fact/evidence normalization;
- removal of the legacy `extraction_sources` column;
- blob garbage collection;
- a new renderer event bus or synchronization server.

Those capabilities remain assigned to later delivery batches.

## 3. Chosen Architecture

Use a domain-neutral `KnowledgeDocumentService` and dedicated knowledge-base IPC boundary. Do not
add document persistence responsibilities to `EnterpriseLeadWorkspaceService`.

```text
WorkspaceKnowledgeBase
        |
        | document-level IPC
        v
KnowledgeDocumentService
        |-- KnowledgeDocumentStore
        |-- KnowledgeManagedFileStore
        |-- KnowledgeIngestionJobStore
        |-- KnowledgeSelectionTokenStore
        |-- KnowledgeIngestionService
        `-- EnterpriseLeadKnowledgeCompatibilityAdapter
                    |
                    `-- extractionSources compatibility projection
```

The normalized document, version, and job tables are authoritative. The compatibility adapter is a
downstream projection for code that has not yet moved to the new retrieval boundary. Renderer code
never submits a replacement document collection.

This design rejects two alternatives:

- extending `EnterpriseLeadWorkspaceService` directly, because that would couple generic document
  storage to enterprise-lead business logic and make later local-first synchronization harder;
- removing `extractionSources` in one change, because current extraction, vector indexing, prompt
  construction, and workspace tests still consume it.

## 4. Shared Contracts

Add stable knowledge-base IPC channel constants and request/result types under
`src/shared/knowledgeBase/`.

The public document operations are:

- `selectFiles`: opens the native picker and returns a token plus display-safe selected-file
  metadata;
- `importSelection`: consumes a selection token and imports its files into one workspace;
- `listDocuments`: returns current document summaries without extracted text;
- `getDocumentDetails`: returns one document, its active version, and its current job summary;
- `deleteDocument`: applies a soft-delete tombstone with `expectedRevision`;
- `restoreDocument`: clears the tombstone with `expectedRevision`;
- `retryDocument`: creates or requeues a failed ingestion attempt for the active version.

Every IPC response uses a discriminated result shape with a stable `KnowledgeBaseErrorCode`. Internal
paths, stack traces, SQLite messages, API keys, and raw document content are never included in error
payloads.

## 5. Selection-Token Security Boundary

Renderer code must not provide arbitrary file paths to import IPC.

The main process owns an in-memory selection-token store with these rules:

- tokens use cryptographically strong random identifiers;
- a token belongs to the requesting `WebContents.id`;
- a token contains only files returned by that picker invocation;
- directories are rejected;
- at most 100 files are accepted per selection;
- tokens expire after five minutes;
- import consumes a token once, even when some files fail;
- token entries are removed when their owning WebContents is destroyed;
- a forged, expired, already-consumed, or foreign-owner token returns a stable invalid-token error.

The renderer may display file names and sizes returned by selection, but it does not receive a new
general-purpose filesystem-read capability.

## 6. Managed Batch Import

`KnowledgeDocumentService.importSelection` processes selected files independently and returns one
result item per file. One invalid file must not roll back successful siblings.

For each file:

1. Confirm the workspace still exists.
2. Resolve the selected path from the consumed token.
3. Read fresh file metadata and reject directories, missing files, unsupported types, and files over
   50 MiB.
4. Validate the logical workspace quota before publishing the version. The default quota is 20 GiB
   across active managed document versions.
5. Stream the file into managed content-addressed storage while calculating SHA-256.
6. In one SQLite transaction, create the document, immutable version, initial ingestion job, and
   compatibility projection entry.
7. Return a document summary and job summary.

The service uses the managed-file store's existing deduplication. Identical bytes reuse one physical
blob but still count toward each workspace's logical quota.

Repeated invocation with the same consumed token fails instead of creating duplicate documents. A
later explicit import of the same physical file is allowed and creates another document identity;
blob storage remains deduplicated.

## 7. Local Ingestion Worker

Stage 2 includes the minimum worker required to make durable jobs operational. It reuses the current
main-process `documentTextExtractor` for plain text, DOCX, XLS/XLSX, PDF, PPTX, and image OCR. It does
not call the enterprise workspace model client, extract structured facts, or send document text to a
cloud provider.

The worker follows these rules:

- at most two general jobs run concurrently;
- at most one OCR job runs concurrently;
- every claim and commit uses `documentId + documentVersionId`;
- the worker resolves only the managed blob path stored for that version;
- parser selection uses the original display-name extension as a hint because managed blob names do
  not retain extensions;
- heartbeats update progress while OCR is running;
- before committing extracted text, the worker verifies that the document is not deleted and still
  points to the claimed version;
- extracted text, parser identity, and partial state are stored on the normalized version;
- non-empty local text produces `ready`;
- a successful parse with no text produces `completed_without_text`;
- parser failure produces `failed` with a stable sanitized error code;
- startup recovery and each successful import wake the same bounded queue drain.

The existing cloud-backed enterprise fact extraction remains unchanged for legacy sources but is not
invoked for newly imported normalized documents. Stage 3 adds local retrieval over the normalized
text and an explicit-consent fact-extraction boundary.

## 8. Document Listing and Details

`listDocuments` returns only fields required by the table:

- stable document ID;
- display name;
- source mode;
- current version ID;
- optimistic revision;
- aggregate status;
- file size, MIME type, and content hash;
- created, updated, and deleted timestamps;
- compact current-job status, stage, progress, and sanitized error code.

It never selects or serializes `extracted_text`.

`getDocumentDetails` loads one active version on demand. The first Stage 2 UI uses it only when a
document is opened. Raw extracted text is not returned to the list view and remains behind the
document-specific IPC boundary.

## 9. Delete, Restore, and Retry

Deletion is optimistic and non-destructive:

- `deleteDocument(documentId, expectedRevision)` sets `deleted_at` and increments the revision;
- queued ingestion jobs for the document are cancelled in the same transaction;
- a running attempt is not force-killed in this batch, but its worker must verify the active document
  and version before committing future results;
- deleted documents are absent from the default list and available through an explicit deleted
  filter for restoration;
- the compatibility projection removes the document from active legacy consumers.

Restoration clears `deleted_at` and increments the revision. It does not silently retry a failed or
cancelled job. The user invokes retry explicitly.

Retry always targets the current `documentId + documentVersionId`. It preserves prior attempt rows
and creates a new queued attempt transition. No new Stage 2 code locates a document by
`sourceIndex`.

If `expectedRevision` is stale, the service returns a revision-conflict result containing the latest
display-safe document metadata. It never auto-merges or overwrites the newer state.

## 10. Status Refresh

The renderer performs short polling only while at least one visible document is pending, processing,
or retrying.

- Poll interval: two seconds while active work exists.
- Polling stops when the view unmounts, the workspace changes, or no visible document is active.
- Only one list request may be in flight for a component instance.
- Poll failures use bounded UI messaging and do not clear the last successful document list.

This batch intentionally avoids a new event bus. A later ingestion-service batch may add push events
without changing the document service contract.

## 11. Legacy Compatibility Projection

The normalized stores are authoritative after cutover. `EnterpriseLeadKnowledgeCompatibilityAdapter`
projects the minimum fields needed by current legacy consumers:

- stable legacy source ID derived from the document ID;
- label and source kind;
- file name and display-safe metadata;
- extraction and index status mappings;
- partial-extraction state and sanitized error summary where applicable.

The adapter does not write raw extracted text into `extractionSources` for newly imported documents.
It does not replace the complete source array from renderer input. Projection updates occur in the
main process after normalized state changes and preserve unrelated legacy entries during the
transition.

Existing extraction, vector indexing, and agent behavior may continue reading the compatibility
projection until Stage 3 supplies the new retrieval boundary. Legacy migration remains
non-destructive and retryable.

## 12. User Interface Cutover

The existing knowledge-base source table becomes a document table backed by `listDocuments`.

The first vertical slice exposes:

- multi-file upload;
- per-document status and progress;
- soft delete and a deleted-document view;
- restore;
- retry for failed documents;
- partial-success batch feedback such as “8 imported, 2 failed”.

`completed_without_text` is displayed as “Saved, not searchable” and must never use an indexed or
success-search status. All visible strings use renderer i18n with both Chinese and English entries.

The oversized `WorkspaceKnowledgeBase.tsx` component is not broadly refactored. New IPC and state
coordination logic belongs in focused services/hooks; component edits remain limited to replacing
the document-source data path and rendering the confirmed operations.

## 13. Error Handling

Stable error categories include:

- invalid or expired selection token;
- unauthorized token owner;
- too many selected files;
- unsupported file type;
- missing or changed selected file;
- per-file size limit exceeded;
- workspace logical quota exceeded;
- workspace or document not found;
- optimistic revision conflict;
- invalid job-state transition;
- managed-file import failure;
- database persistence failure.

The main process maps internal failures to these categories. User-facing messages contain the file
name and a safe recovery action where relevant, never an absolute path or internal exception text.

Temporary managed files are cleaned when import fails before publication. Once a content-addressed
blob is published, transaction rollback does not delete it because another document may reference
the same bytes. Conservative garbage collection remains a later maintenance feature.

## 14. Testing Strategy

Every production behavior follows red-green-refactor TDD.

Required tests cover:

- selection-token ownership, expiry, single consumption, WebContents cleanup, directory rejection,
  maximum selection count, and forged-token rejection;
- partial-success multi-file import;
- 50 MiB per-file and 20 GiB logical workspace limits;
- document/version/job atomic persistence and managed-blob reuse;
- consumed-token duplicate-click protection;
- 1,000-document listing without selecting extracted text;
- details loaded only on demand;
- soft delete, queued-job cancellation, deleted listing, restoration, and explicit retry;
- optimistic revision conflicts with latest safe metadata;
- retry preserving prior attempt history and targeting stable IDs;
- bounded local queue draining, OCR serialization, restart recovery, active-version checks, and
  no-cloud-model invocation;
- compatibility projection without raw text or array-index job targeting;
- IPC validation and stable error mapping;
- preload and renderer service contracts;
- renderer polling start/stop and partial-success presentation;
- localized Chinese and English strings.

Verification gates are:

- targeted Vitest tests for each TDD cycle;
- changed-file ESLint with zero warnings;
- `npm run compile:electron` for main/preload changes;
- `npm run build` for renderer and IPC type changes;
- complete `npm test` before handoff;
- final diff review for unrelated churn, raw-text leakage, path disclosure, and new `sourceIndex`
  dependencies.

## 15. Success Criteria

Stage 2's first vertical slice is complete when:

- the renderer imports selected files without sending arbitrary paths to document import IPC;
- a 100-file batch can partially succeed and report each failure safely;
- successful imports atomically create a document, immutable version, and durable job;
- the local worker advances queued imports to `ready`, `completed_without_text`, or `failed` without
  sending text to a cloud model;
- document lists do not load extracted text and remain practical at 1,000 rows;
- delete, deleted-list, restore, and failed-job retry work through document-level operations;
- retry and job processing use stable document/version IDs rather than array positions;
- legacy consumers continue functioning through a minimal no-raw-text compatibility projection;
- `completed_without_text` is visibly distinct from searchable success;
- targeted tests, full Vitest, changed-file ESLint, Electron compilation, and renderer build pass.
