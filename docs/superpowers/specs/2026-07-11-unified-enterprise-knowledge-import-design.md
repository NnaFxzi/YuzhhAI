# Unified Enterprise Knowledge Import Design

Date: 2026-07-11
Status: Approved for implementation

## 1. Purpose

Complete the missed workspace-creation cutover from the approved local enterprise knowledge-base
design. Files selected while creating a workspace and files selected from the knowledge-base page
must enter the same normalized document/version/job pipeline, use the same managed local storage,
and expose the same document lifecycle.

This design is an addendum to:

- `docs/superpowers/specs/2026-07-11-local-enterprise-knowledge-base-design.md`;
- `docs/superpowers/specs/2026-07-11-local-enterprise-knowledge-base-stage-2-design.md`.

It does not make the legacy `extraction_sources` JSON authoritative again.

## 2. Confirmed Product Semantics

- The user-visible product is one workspace knowledge base with two views: source documents and
  derived AI knowledge.
- "Local document library" is an implementation detail, not a separate destination.
- Every imported file is copied into managed local storage, parsed locally, and made locally
  searchable when text is available.
- Structured knowledge extraction is a separate downstream action. It produces pending candidates;
  it does not silently confirm facts or overwrite confirmed profile values.
- Sending document text to a configured remote model requires an explicit user action or an already
  recorded workspace authorization. Local import, parsing, OCR, and indexing do not imply that
  authorization.
- A document remains valid when indexing or knowledge extraction fails. Those failures have their
  own retryable state.

## 3. Root Cause Being Removed

The workspace-creation material flow still reads absolute paths, text, and OCR results in the
renderer, writes a complete legacy `extractionSources` array, and starts work by `sourceIndex`.
The knowledge-base page uses an owner-bound selection token and normalized
`knowledge_documents`/`knowledge_document_versions`/`knowledge_ingestion_jobs` rows.

The result is two source-of-truth models and two different meanings for the same upload action.
Startup-only legacy migration cannot close that gap because a completed workspace migration skips
new legacy sources created later in the same process.

## 4. Target Boundaries

```text
Workspace creation picker ----+
                               |
Knowledge-base picker ---------+--> KnowledgeDocumentService
                               |      |-- managed content-addressed blob
Future sync/import adapters ---+      |-- stable document + immutable version
                                      `-- durable local ingestion job
                                                |
                                                +--> local parser / OCR
                                                +--> local chunk index
                                                `--> authorized enrichment job
                                                          |
                                                          `--> pending facts + evidence
                                                                    |
                                                                    `--> confirmed profile projection
```

`KnowledgeDocumentService` remains domain-neutral. Workspace creation may use an application-layer
orchestrator, but the orchestrator only coordinates workspace creation and the existing normalized
import API; it does not persist documents itself.

## 5. Secure Selection and Creation Flow

The creation renderer stores only display-safe selection data:

- `selectionToken`;
- `itemId`;
- display name;
- file size;
- a display-only kind inferred from the file name.

It never receives or reads the absolute path or extracted text. Multiple picker invocations are
represented as multiple token groups. Removing a selected row sends only its opaque item ID; import
may consume a validated subset of a token. Every requested item ID must belong to that token and
WebContents owner.

Creation proceeds as a saga rather than a false cross-filesystem transaction:

1. Validate the material selection and create the workspace shell without legacy sources.
2. Consume each owner-bound selection token through `KnowledgeDocumentService.importSelection`.
3. Publish each document/version/job independently, preserving partial success.
4. Return or display an aggregate import result.
5. Keep the created workspace when one document fails; failed items can be selected again without
   rolling back successful siblings.

Selection tokens remain short-lived. Expiry produces a localized request to reselect files and never
falls back to renderer path access.

## 6. Canonical Documents and Compatibility

`knowledge_documents` and `knowledge_document_versions` are authoritative for all new file imports.
The compatibility adapter may project identity, display metadata, and processing state to legacy
workspace consumers. It must remain one-way and main-process-owned.

New code must not:

- submit a replacement `extractionSources` collection from the renderer;
- identify background work by array index;
- duplicate normalized extracted text into workspace JSON;
- use the original local path as document identity.

Legacy source migration becomes reconciliation rather than a one-shot count check. A completed
migration can still discover previously unseen stable legacy source IDs, while normalized imports
are excluded from reverse migration to prevent duplicate documents.

## 7. Local Indexing

After parsing/OCR yields non-empty text, the ingestion pipeline chunks and indexes the active
document version locally. The index source identity includes the stable document and version IDs.
Replacing a version or deleting a document removes only that source's chunks.

Local document chunks must coexist with legacy workspace/profile sources. Synchronizing legacy
sources must not delete normalized document chunks. The compatibility keyword-hash index may be used
for this batch, but the storage API must update a bounded source set rather than replace unrelated
sources in the workspace scope.

The document row exposes local processing separately from enrichment:

- document processing: pending, processing, ready, completed without text, failed;
- local search: pending, indexed, failed/not applicable;
- AI knowledge: not requested, pending, extracting, review required, completed, failed.

## 8. Authorized AI Knowledge Extraction

Knowledge extraction targets `documentId + documentVersionId`, never a legacy source index. It reads
the active normalized version in the main process and records:

- consent mode;
- provider and model identifiers without credentials;
- request and completion timestamps;
- sanitized error state;
- extracted pending facts and their evidence location.

An explicit user action is sufficient authorization for that request. A future persisted workspace
policy may authorize automatic extraction, but local import alone never does.

Model-derived facts start as `pending`. Only confirmed facts are projected into the trusted
enterprise profile and high-trust Agent knowledge. Rejecting a candidate does not delete the source
document. Updating or deleting a version marks its extracted evidence stale without silently
deleting manually confirmed facts.

The first compatibility delivery may continue displaying the existing profile-backed candidate UI,
but all new extraction work must be keyed by normalized document/version identity. The normalized
fact/evidence tables replace that projection in the following delivery without changing the import
API.

## 9. UI Semantics

- Rename the implementation-facing "local document library" title to "Source documents" / “资料文档”.
- Explain that every upload entry adds files to the same workspace knowledge base and processes them
  locally.
- Show document processing and AI knowledge status independently.
- Creation-page selection and knowledge-page selection use the same supported file types, limits,
  error codes, and batch-result wording.
- Partial success is explicit: for example, “Imported 8 files; 2 need to be selected again.”
- A remote extraction action states that document content may be sent to the configured model before
  the user confirms it.

## 10. Local-First and Future Sync Constraints

Stable document IDs, immutable version IDs, content hashes, revisions, and tombstones are sync-safe.
Absolute original paths, managed paths, picker tokens, parser heartbeats, and local migration state
remain device-local.

Before multi-device sync, domain revisions must be separated from device-local processing state.
Sync sends normalized aggregates and blobs by hash; it never sends the legacy `extraction_sources`
array or derives remote identity from `sourceIndex`/`filePath`.

## 11. Delivery Batches

### Batch A: Unified import cutover

- reuse the knowledge-base picker and token boundary from workspace creation;
- support validated token subsets;
- create the workspace shell and import through the normalized service;
- remove renderer path reads/OCR/model extraction from the creation material flow;
- reconcile new legacy sources even after a prior completed migration;
- preserve the existing compatibility projection and startup-order fix.

### Batch B: Local searchable documents

- index normalized active versions incrementally;
- retain provenance by document/version;
- remove a document's chunks on soft deletion and restore/retry deterministically;
- display local search state separately from document parsing.

### Batch C: Derived knowledge and evidence

- add version-addressed enrichment requests and explicit remote authorization;
- persist facts/evidence and review state;
- project confirmed facts into the enterprise profile;
- expose retry and stale-evidence behavior.

### Batch D: Legacy retirement and sync port

- switch all Agent retrieval to normalized chunks/facts;
- make the compatibility projection read-only for one release cycle, then remove it;
- add transactional sync outbox/inbox and device-local path bindings.

## 12. Acceptance Criteria

- Uploading the same supported file from either entry creates the same normalized document/version
  and uses managed local storage.
- Workspace creation code contains no renderer path read, renderer OCR, or `sourceIndex` processing.
- Both entry points show their documents in the same source-document list without an app restart.
- Parsing and local indexing work without a model provider or network.
- Remote extraction never occurs from import alone and produces pending, reviewable knowledge.
- A failed import, parse, index, or enrichment operation does not roll back successful documents.
- Newly added legacy sources reconcile idempotently without duplicating normalized imports.
- Targeted tests, full Vitest, changed-file ESLint, Electron compilation, and renderer build pass.
