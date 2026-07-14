# Local Enterprise Knowledge Base: Derived AI Knowledge Design

Date: 2026-07-11
Status: Approved for implementation planning

## 1. Purpose

Deliver the first safe, end-to-end derived AI knowledge flow for the single-machine Electron
enterprise edition. A user explicitly requests extraction for one normalized source document, the
main process sends only that immutable document version to the configured model service, and the
result becomes reviewable facts with evidence. No model-generated fact enters the trusted workspace
profile or Agent context before a user confirms it.

This delivery includes the minimum Batch B versioned-chunk/index foundation required by the already
approved Batch C facts/evidence model. It builds on:

- `2026-07-11-local-enterprise-knowledge-base-design.md`;
- `2026-07-11-local-enterprise-knowledge-base-stage-2-design.md`;
- `2026-07-11-unified-enterprise-knowledge-import-design.md`.

The release remains local-first: document storage, parsing, OCR, chunking, indexing, fact storage,
review, and profile projection work locally. A remote model call occurs only after a document-level
explicit authorization action.

## 2. Confirmed Product Decisions

- The first extraction UI operates on one document at a time. Batch extraction is deferred to avoid
  accidental cost and broad content disclosure.
- A source document must be active, locally parsed, and contain non-empty text before extraction is
  available.
- Clicking “Extract AI knowledge” opens an authorization dialog before any request is created.
- Main issues a short-lived, owner-bound authorization descriptor. The dialog identifies the exact
  provider/model and estimated bounded model calls from that descriptor and explains that parsed
  document content may be sent to that model service.
- The action authorizes only the selected `documentId + documentVersionId`. It does not persist an
  automatic workspace-wide authorization policy.
- Local import, parsing, OCR, chunking, indexing, deletion, restoration, and ordinary retry never
  invoke a model.
- Model output is stored as normalized pending facts and evidence. It is never written into
  `workspace.profile` as a temporary compatibility shortcut.
- Confirming a fact is the only operation that may project it into the trusted enterprise profile.
  Rejecting a fact does not modify the profile or source document.
- Document processing, local indexing, and AI enrichment have independent statuses and retry paths.
- The current AI knowledge table layout may be reused, but normalized facts become the source of
  truth for newly extracted candidates.

## 3. Considered Approaches

### 3.1 Chosen: versioned chunks plus normalized enrichment and facts

Build a stable document-version chunk store first, then add a separate durable enrichment queue,
fact/evidence stores, review operations, and profile projection. This requires more work but meets
the approved evidence and trust boundaries without a later data migration.

### 3.2 Rejected: extracted-text offsets without a chunk store

Storing only offsets into `knowledge_document_versions.extracted_text` is faster, but evidence
identity would change when chunking and retrieval are introduced. It would require a second evidence
migration and cannot provide the approved stable chunk provenance.

### 3.3 Rejected: reuse legacy `processDocumentSource`

The legacy path uses `sourceIndex`, renderer-submitted source arrays, and an in-memory queue. It also
merges model output directly into `workspace.profile`, allowing pending rules to reach Agent context.
It cannot be part of the normalized extraction flow.

## 4. Architecture

```text
Normalized active document version
        |
        | local only
        v
KnowledgeDocumentChunkStore + FTS5
        |
        | explicit single-document authorization
        v
KnowledgeEnrichmentService
        |
        v
KnowledgeEnrichmentWorker ----> configured workspace model
        |
        v
KnowledgeFactStore
  |-- pending facts
  `-- versioned chunk evidence
        |
        | confirm / reject
        v
EnterpriseLeadKnowledgeFactProjector
        |
        `-- confirmed facts only -> workspace.profile -> trusted Agent context
```

The local parsing worker and AI enrichment worker remain separate. `knowledge_ingestion_jobs`
continues to represent local document processing only. AI work uses dedicated enrichment request and
attempt tables so it cannot change document parsing status or `retryDocument` behavior.

## 5. Batch B Prerequisite: Versioned Local Chunks

### 5.1 Chunk identity

Add `knowledge_document_chunks`. Every row belongs to one immutable normalized document version and
contains:

- stable ID derived from `documentVersionId`, ordinal, offsets, and content checksum;
- workspace, document, and document-version IDs;
- zero-based ordinal;
- text content;
- start and end character offsets into the version text;
- optional page, sheet, slide, and heading-path metadata when a parser supplies it later;
- checksum and timestamps.

The stable chunk ID is the logical evidence identity. The local index may use a separate
attempt-generation storage key so a complete replacement generation can be staged invisibly; facts
and evidence never persist that device-local generation key.

The first delivery chunks normalized plain text deterministically with bounded size and overlap.
Immutable version text produces identical chunk IDs when indexing is retried.

### 5.2 Local index state

Add a device-local `knowledge_document_index_state` row per document version with:

- `pending`, `indexing`, `indexed`, `not_applicable`, or `failed` status;
- chunk count;
- sanitized error code;
- attempt count, lease heartbeat, and recovery metadata;
- requested, started, and completed timestamps.

This state is device-local processing metadata and is not part of the future synchronized domain
revision.

Add immutable local-index attempt rows. The index worker transactionally claims pending state,
heartbeats while working, preserves failed attempts, and requeues abandoned indexing after restart.

### 5.3 FTS index

Add an FTS5 index over normalized chunk text. The chunk store updates one version at a time and never
deletes unrelated workspace sources. FTS5 is the complete supported local retrieval mode; optional
semantic embeddings remain a later enhancement.

Chinese retrieval cannot rely on default `unicode61` word boundaries. Startup probes FTS5
`trigram` support and records a tokenizer version. The primary index uses `trigram`; when the bundled
SQLite lacks it, the store uses an explicitly generated CJK bigram search column with `unicode61`
rather than silently indexing Chinese as whole sentences. Search normalizes and escapes untrusted
query text, uses parameter binding, and never interpolates MATCH expressions.

To keep Electron main-connection write latency bounded while indexing a 50 MiB document, the worker
writes chunk and FTS rows into an attempt-owned, non-queryable generation in small transactions.
Search and evidence lookup join only the generation named by the index state, so incomplete, failed,
or cancelled generations are invisible. A short final SQLite transaction validates the staged row
count and ordinal continuity, then atomically activates that complete generation together with the
successful attempt and index-state transition. Obsolete generations are reclaimed by the worker in
bounded batches. This final activation is the publication boundary; no partial chunk/FTS set can
become visible.

Every staging transaction and the final activation first verify the workspace still exists, the
document is not deleted, the document still points to the claimed version, and the index attempt
still owns the lease. A failed condition prevents activation and leaves staged rows invisible,
preventing a workspace delete, document delete, or version change from being resurrected by a late
worker.

### 5.4 Processing lifecycle

- After parsing/OCR yields text, the local worker advances through chunking and indexing before the
  document becomes fully searchable.
- Committing parsed text, completing the ingestion attempt, and creating `pending` index state occur
  in one transaction. Empty text atomically creates `not_applicable` state instead.
- Empty extracted text creates `not_applicable` index state and no chunks.
- Index failure leaves the managed document and extracted text valid and retryable.
- Soft deletion removes that document’s active chunks and marks any related enrichment evidence
  stale.
- Restoration requeues deterministic indexing for the same active version. Stale enrichment
  evidence is not silently reactivated; the user explicitly extracts again.
- A version replacement indexes the new immutable version and marks prior-version evidence stale.
- Startup reconciliation creates pending index state for every active ready version with text but no
  index state, and requeues abandoned `indexing` leases. Failed index state remains failed until the
  user retries it.

### 5.5 Execution isolation

Production chunk generation and FTS publication do not run on Electron’s main event loop. A Node
worker thread opens its own SQLite connection to the same application database, uses the configured
journal/busy-timeout policy, reads the target version by ID, computes chunks, and performs the atomic
active-version-checked publication transaction. The main process exchanges only IDs and bounded
progress/result summaries with the worker.

Stores accept an injected inline executor for deterministic in-memory tests, but production never
falls back to synchronous 50 MiB chunk/FTS work on the main thread. Verification includes a maximum
size document and queued multi-document responsiveness benchmark that samples main-loop delay.

## 6. Enrichment Request Storage

Add `knowledge_enrichment_requests` with:

- stable request ID;
- workspace, document, and exact document-version IDs;
- status;
- explicit consent mode;
- provider and model identifiers captured at request time;
- optimistic request revision;
- progress and attempt count;
- requested, started, updated, and completed timestamps;
- stable error code and sanitized error message;
- valid and discarded candidate counts;
- partial reasons: `chunk_limit` and/or `candidate_limit`;
- a non-reversible configuration fingerprint used to prevent routing to a different model endpoint.

Add `knowledge_enrichment_attempts` with one immutable row per claim, including attempt number,
start/finish time, heartbeat, outcome, and sanitized error fields. The request stores
`active_attempt_id`; heartbeat, completion, failure, and result publication all use
`status = running AND active_attempt_id = ?` compare-and-swap so a stale worker cannot publish.

Stable statuses are:

- `queued`;
- `running`;
- `review_required`;
- `completed`;
- `failed`;
- `cancelled`;
- `stale`.

Queued or running requests may be cancelled explicitly. Cancellation increments request revision,
invalidates the active attempt lease, aborts the in-process provider call when supported, and causes
every late heartbeat/publication CAS to fail. Cancelled requests never resume automatically;
extracting again requires a fresh authorization descriptor.

“Not requested” is a renderer-derived state when no request exists. “Pending” maps to `queued`, and
“Extracting” maps to `running`.

A partial unique index permits only one active request for a document version while its status is
`queued`, `running`, or `review_required`. Repeated clicks return the existing display-safe request
instead of creating duplicate model calls.

Startup may resume an authorized request only while it is still `queued`, because no content has
been sent. Every abandoned `running` attempt becomes `failed` with `authorization_required`; it is
never automatically replayed, regardless of its last recorded progress. A user must review a fresh
authorization descriptor before any retry sends content again.

## 7. Fact and Evidence Storage

### 7.1 Facts

Add `knowledge_facts` with:

- stable fact ID and originating enrichment request ID;
- workspace scope;
- domain field;
- text value and normalized value;
- review status: `pending`, `confirmed`, or `rejected`;
- source kind: `extracted`, `manual`, or `imported`;
- optimistic revision;
- optional conflict-group key and projection state;
- created, reviewed, updated, and tombstone timestamps.

Add `knowledge_fact_profile_projections` as an audit ledger for confirmed facts applied to the
compatibility profile. It records the field, applied value, prior single-value state where relevant,
application revision, prior confirmed/ignored key state, projection action (`inserted`,
`preexisting_support`, or `replaced_single`), and reversal timestamp. This enables a confirmed fact
to be removed from the trusted profile without deleting its audit history or overwriting a manual or
legacy value. A projection group keyed by workspace, field, and normalized value tracks active
normalized-fact support without claiming ownership of preexisting profile values.

The first extraction schema supports the enterprise profile fields:

- `companySummary`;
- `productList`;
- `productCapabilities`;
- `targetCustomers`;
- `applicationScenarios`;
- `sellingPoints`;
- `channelPreferences`;
- `prohibitedClaims`;
- `contactRules`;
- `missingInfo`.

Each array value is stored as one fact. `companySummary` is a single-value domain.

### 7.2 Evidence

Add `knowledge_fact_evidence` with:

- stable evidence ID and fact ID;
- enrichment request, document, document-version, and chunk IDs;
- supporting quote;
- confidence in the inclusive range 0–1;
- extractor provider/model identity;
- created and stale timestamps.

One fact may have multiple evidence rows. Matching active, non-tombstoned pending or confirmed facts
with the same workspace, domain, and normalized value may gain additional evidence instead of
creating duplicate visible knowledge. Rejected and archived facts are never dedupe targets; new
corrected evidence creates a separately reviewable fact identity.

Add `knowledge_enrichment_request_facts` as the explicit many-to-many membership table between
requests and facts. A request enters `review_required` only when at least one linked fact is pending
with active evidence. Linking an already confirmed matching fact does not reopen it for review.
Reviewing or archiving a fact recalculates every linked request; a request completes when none of its
linked facts remain reviewable pending candidates.

## 8. Explicit Request Flow

1. Renderer calls `prepareExtractionAuthorization` for one document/version.
2. Main verifies the target and model capability, then issues an opaque descriptor token bound to
   the requesting `WebContents`, workspace, document/version, provider/model, non-secret routing
   fingerprint, estimated model-call count, partial flag, and a two-minute expiry.
3. Renderer displays only the descriptor’s safe document/provider/model/cost summary. The renderer
   is the trusted product authorization surface; untrusted document text is never rendered as
   executable HTML or allowed to invoke this action.
4. Cancel discards the descriptor client-side and creates no request. Confirm sends only the opaque
   descriptor token.
5. Main consumes the token once and atomically revalidates owner, expiry, active document/version,
   index state, provider/model, and routing fingerprint. Any change requires a new descriptor and
   another user confirmation.
6. Main records consent mode `explicit`, the provider/model IDs, and the non-reversible routing
   fingerprint. It never stores credentials or complete provider configuration.
7. Main creates or returns the idempotent enrichment request and wakes the independent worker.
8. The renderer refreshes the document list and polls only while enrichment is queued or running.

Unconsumed tokens and short-lived consumed-token receipts exist only in main-process memory and are
removed when their owner `WebContents` is destroyed. The first successful consumption records the
resulting request ID on the receipt; an immediate duplicate call from the same owner returns that
same request instead of a second model job. A new valid descriptor for a version that already has an
active request likewise returns the active request.

The worker resolves credentials only for the provider/model recorded on the request and requires the
current routing fingerprint to match. If that configuration is no longer available or has changed,
the request fails; it never falls back to a different provider or model.

Retrying a failed request sends content again, so the retry action opens a fresh authorization
dialog and consumes a new descriptor. It may add an attempt to the same request only when the exact
document/version/provider/model/fingerprint still match. Re-extraction after completion or a version
change always creates a new request with new authorization.

The first implementation supports the same model-provider capability currently available to
enterprise workspace generation. Unsupported provider formats return a stable error instead of
silently falling back to another provider.

## 9. Enrichment Worker and Prompt Boundary

The worker is bounded to one concurrent model extraction. It uses durable claims, attempts,
heartbeats, restart recovery, and retry semantics modeled after the local ingestion job store, but
does not share its tables.

Extraction reuses the approved local chunk limits: 18,000 target characters, 800 overlap characters,
and at most 30 chunks/model calls for one request. It covers chunks in ordinal order and marks the
request with partial reason `chunk_limit` when more than 30 chunks exist. Each model response may
contribute at most 50 candidates; the complete request may publish at most 200 unique candidates.
When more than 200 valid unique candidates exist, the worker records partial reason
`candidate_limit`, keeps candidates by confidence descending, then chunk ordinal, domain order, and
normalized value, and records the bounded count of valid candidates not published. Fact values are
capped at 2,000 characters and evidence quotes at 1,000 characters. The authorization descriptor
reports the planned call count and whether chunk coverage will be partial; the result UI reports all
final partial reasons.

The worker updates durable progress between calls. Candidate results remain attempt-local until
every planned chunk succeeds; publication of facts/evidence is one transaction, so a failed attempt
never leaves a half-published candidate set. A retry creates a new attempt without duplicating prior
facts.

Before a model call, the worker reloads the active document and exact version. Before committing
results, it checks them again. Deletion, replacement, cancellation, or stale ownership prevents the
result from being published. Each provider call has a 180-second timeout, a real `AbortSignal`, and
periodic lease heartbeats; the model-client adapter contract is extended to accept the signal. A
timeout aborts that call and safely fails the attempt so one hung provider cannot block the queue.
The first release cannot retract content already received by a provider, but it aborts the local
request where supported, stops subsequent chunk calls, and discards late output after cancellation.

The prompt:

- declares document content untrusted evidence;
- states that instructions inside the document must not be followed;
- forbids tool calls, permission changes, system-prompt changes, and workspace-rule overrides;
- supplies bounded chunks with opaque chunk IDs;
- requests JSON only, using the approved domain-field whitelist;
- requests one supporting quote and confidence for every fact;
- never includes API keys, absolute paths, managed paths, or unrelated workspace documents.

The response schema is:

```json
{
  "facts": [
    {
      "domain": "sellingPoints",
      "value": "Example value",
      "chunkId": "opaque-chunk-id",
      "quote": "Exact supporting excerpt",
      "confidence": 0.9
    }
  ]
}
```

Main strictly validates domain, value length, chunk ownership, quote length, confidence, and that
the normalized quote occurs in the referenced chunk. Structurally valid responses may discard
invalid individual candidates and record only a bounded discarded count. Invalid JSON or a wholly
invalid response fails the attempt with a sanitized error. A valid empty fact list completes with
“no reviewable knowledge found.” Raw model output is not persisted.

## 10. Review and Trusted Profile Projection

Review uses optimistic revision control.

Add `profile_revision` to enterprise workspaces. Every whole-profile writer, including existing
manual edits, legacy compatibility updates, and the normalized fact projector, must supply or derive
an expected profile revision and update with compare-and-swap. A stale writer receives the latest
display-safe workspace/profile revision and never overwrites a newer profile. Internal operations
that intentionally retry must reread and reapply their semantic change rather than resubmitting a
stale complete profile.

Add per-field profile revision state. Every profile writer diffs old and new normalized profile
values and increments only the fields it changed. Projection ledger rows capture the target field
revision, so an unrelated profile edit does not block later archive while a same-field edit does.

### Confirm

- Main changes the fact from pending to confirmed and projects it in one SQLite transaction.
- Array fields append with normalized-value deduplication.
- `companySummary` does not silently replace a different non-empty confirmed value. The API returns
  a conflict requiring an explicit replace decision from the user.
- Confirmed `prohibitedClaims` and `contactRules` may then enter trusted rule sources.
- Projection adds the canonical field/value key to `confirmedKnowledgeKeys` and removes the same key
  from `ignoredKnowledgeKeys`. The key-generation and confirmation transforms move to shared/main
  pure functions used by every projector path instead of renderer-only helpers.
- After confirmation, the renderer refreshes both facts and the workspace projection.

For an array value already present before confirmation, the projection ledger records
`preexisting_support` and archive never removes that profile value. A newly inserted value records
`inserted`; archive may remove it only if no other active confirmed fact supports it and the profile
field revision has not changed since projection. Any later same-field manual write, even one
retaining the same text, prevents automatic removal and produces a projection conflict for user
review; unrelated field changes do not.

The fact, projection ledger, and compatibility profile commit atomically in SQLite. Trusted-index
refresh runs after commit, reads only confirmed profile values, and is independently retryable; an
index refresh failure can delay new trusted knowledge but cannot expose pending knowledge.

Add a durable trusted-profile-index refresh state/outbox keyed by `workspaceId + profileRevision`.
The projector enqueues it in the same transaction as the profile revision. A bounded worker marks
the revision indexed only after refresh succeeds; startup reconciliation enqueues any profile
revision newer than the last indexed revision. This closes the crash window between profile commit
and trusted-index refresh.

Trusted retrieval is fail-closed on revision lag. Before loading workspace profile/rule sources, the
retriever compares the current profile revision with the successfully indexed revision. If they
differ, it omits all trusted profile/rule chunks for that workspace until refresh succeeds. Ordinary
source-document retrieval may continue. This means an additive update can be temporarily absent,
but an archived or revoked fact can never remain available from a stale trusted index.

### Reject

- Main changes the fact from pending to rejected.
- The enterprise profile and trusted Agent index remain unchanged.
- The renderer refreshes facts only.

When no pending facts remain for a request, `review_required` advances to `completed`. Batch review,
manual normalized-fact creation, and editing a confirmed fact are deferred.

### Remove from trusted knowledge

- A confirmed fact exposes “Remove from trusted knowledge.”
- Main tombstones/archives the fact and reverses its profile projection in one transaction using the
  projection ledger.
- Array values are removed only when no other active confirmed fact supports the same normalized
  value, the ledger action was `inserted`, and the target field revision still matches the ledger.
- `preexisting_support` projections never remove an existing manual/legacy profile value.
- A single-value projection is restored only when the current profile still equals the value applied
  by that fact. A later manual edit produces a projection conflict and is never overwritten.
- The fact and evidence remain available in audit history.

On a same-field archive conflict, the API returns the current field value and revision. The UI offers
“Archive fact and keep current workspace value,” “Archive and remove current value,” and “Cancel.”
Keeping the value restores the ledger’s prior confirmed/ignored key state and treats the remaining
profile value according to that prior manual/legacy trust state. Removing it requires the displayed
field revision and a second compare-and-swap. Both choices preserve the fact/evidence audit record.

## 11. Stale Evidence and Document Lifecycle

- Soft deletion marks all evidence for the active document version stale, marks active enrichment
  requests stale/cancelled as appropriate, and removes local chunks.
- Restoration reindexes the current version but does not clear stale evidence or republish facts.
- A future version replacement marks old-version evidence and requests stale before publishing the
  new version.
- Pending facts backed only by stale evidence are non-reviewable.
- Rejected facts remain rejected.
- Confirmed facts and their profile projection are preserved when evidence becomes stale; the UI
  displays the stale-evidence warning and a “Remove from trusted knowledge” action.
- Workspace deletion first invalidates in-memory authorization descriptors and active worker leases,
  then explicitly removes trusted-index outbox/state, profile projection groups and ledgers,
  request-fact memberships, evidence, facts, enrichment attempts, enrichment requests, local-index
  attempts/state, FTS rows, chunks, and documents in dependency order. It does not rely on SQLite
  foreign-key cascade being globally enabled. Every worker rechecks workspace existence before final
  publication so deleted workspace data cannot be recreated by a late task.

Marking evidence stale increments every related fact revision. `reviewFact(confirm)` also revalidates
inside its commit transaction that at least one evidence row is active, its document is not deleted,
and the document still points to that evidence version. A stale confirmation returns a dedicated
error even if the renderer submitted an otherwise current fact revision. Reject remains available
for stale pending facts.

## 12. IPC and Renderer Contracts

Add centralized shared constants and display-safe DTOs for:

- `prepareExtractionAuthorization({ documentId, documentVersionId })`;
- `retryLocalIndex({ documentId, documentVersionId })`;
- `requestExtraction({ authorizationToken })`;
- `retryExtraction({ requestId, authorizationToken })`;
- `cancelExtraction({ requestId, expectedRevision })`;
- `listFacts({ workspaceId, view?, reviewStatuses?, evidenceState?, cursor?, limit? })`;
- `reviewFact({ factId, expectedRevision, decision, replaceExisting? })`;
- `archiveFact({ factId, expectedRevision, projectionDecision?, expectedFieldRevision? })`;
- `getFactEvidence({ factId })`.

`KnowledgeDocumentListItem` gains independent local-index and enrichment summaries. Document-list
responses never include extracted text, chunk text, evidence quotes, paths, credentials, or raw
errors.

`listFacts` returns `{ items, nextCursor, metrics }` and is cursor-paginated with a default of 50 and
hard maximum of 100 rows. `view` is `active` or `history`; active excludes rejected, archived, and
stale-only pending facts, while history can filter them. `evidenceState` is `active`, `stale`, or
`any`. Sorting is stable by `updatedAt DESC, id DESC`, and the opaque cursor encodes both values.

Metrics are computed in main over the full workspace, not the current page. They include active
pending, active confirmed, stale confirmed, rejected history, archived history, unduplicated legacy
confirmed, and the final deduplicated AI-knowledge total. A fact summary may include one bounded,
display-safe `evidencePreview` containing source document label, up to 240 characters of quote,
confidence, and stale state. Complete evidence and additional quotes are returned only from the
fact-specific evidence endpoint. This avoids N+1 IPC while keeping document metadata lists small.

IPC validation rejects unknown statuses, decisions, empty IDs, stale versions, and
malformed revisions. Authorization tokens are owner-bound, single-use, and expire after two minutes.
IPC rejects a request when the token target or routing fingerprint no longer matches current state.
Errors use stable knowledge-base error codes and localized renderer messages.

## 13. Renderer Experience

### Source documents

Every active row displays three independent concepts:

- local document processing;
- local search/index state;
- AI knowledge extraction state.

A failed local index exposes its own retry action. It does not reuse document parsing retry or AI
enrichment retry.

For a locally ready and indexed document:

- no request: “Extract AI knowledge”;
- queued/running: progress plus “Cancel extraction”;
- review required: pending count plus “Review AI knowledge”;
- completed: completion or “No reviewable knowledge found,” plus optional re-extract action;
- failed: safe error plus retry;
- cancelled: “Extraction cancelled,” plus extract-again action with fresh authorization;
- stale: “Document changed; extract current version.”

Cancellation is optimistic by request revision. It immediately disables further calls, aborts the
current call where supported, refreshes the row, and never reuses the cancelled request without a
new authorization descriptor.

Documents without text, deleted documents, and documents still processing cannot request extraction.

### Authorization dialog

The dialog states:

- the selected document’s parsed content will be read;
- content may be sent to the displayed provider/model service;
- results remain pending until reviewed;
- unconfirmed results are not available to Agents.

Cancel closes the dialog without creating a request.

### AI knowledge

The view loads normalized facts independently from `workspace.profile`. Each extracted fact shows:

- value and domain;
- review state;
- source document;
- first supporting quote;
- evidence-details action;
- confirm or reject actions when pending;
- stale/conflict indicators.

Pending facts with only stale evidence disable confirm but retain reject and history actions.
Requests with `chunk_limit` or `candidate_limit` display a clear “Results are partial” explanation;
they never use the same completed wording as full-coverage extraction.

Existing profile-backed/manual rows remain temporarily visible as legacy confirmed knowledge.
Confirmed normalized facts are deduplicated against those compatibility rows by domain and normalized
value. Newly extracted pending facts never use the profile as storage.

The top metrics use one fixed interpretation:

- “AI knowledge” counts unique reviewable pending facts with active evidence, active confirmed facts,
  and unduplicated legacy profile knowledge;
- “Pending review” counts only pending facts with active evidence;
- “Confirmed” counts active confirmed facts and unduplicated legacy profile knowledge, including
  stale-evidence confirmed facts with a warning;
- rejected and archived facts appear only in history filters and do not affect top metrics.
- stale pending facts appear only in history filters and do not affect top metrics.

For a conflicting `companySummary`, confirmation opens a comparison dialog showing the current
value, candidate value, and evidence. “Keep current” rejects the candidate, “Replace” confirms with
`replaceExisting`, and “Cancel” makes no change. A revision conflict refreshes both values and
requires the user to choose again.

## 14. Refresh and Race Handling

- Requesting or retrying extraction immediately refreshes the normalized document list.
- Document polling continues while local ingestion, local indexing, or enrichment is active.
- Polling stops after terminal states and ignores responses from an older workspace or component
  generation.
- Entering `review_required` refreshes the normalized fact list once.
- Confirm refreshes facts and then the protected workspace projection.
- Reject refreshes only facts.
- Concurrent fact loads and document loads use latest-request-wins guards consistent with the
  existing workspace projection refresh protection.

## 15. Error Handling and Privacy

Add stable errors for:

- document not ready;
- local index not ready;
- explicit consent required;
- model configuration unavailable;
- model configuration changed after authorization review;
- invalid, expired, consumed, or foreign-owner authorization descriptor;
- unsupported model provider;
- enrichment already active;
- enrichment request not found or stale;
- invalid model response;
- evidence validation failed;
- fact evidence became stale before review;
- fact revision conflict;
- fact projection conflict;
- stale workspace profile revision;
- enrichment persistence failure.

User-visible errors never include absolute paths, managed paths, SQLite text, stack traces, API keys,
provider headers, raw prompts, raw responses, or document content. Logs use concise module tags and
sanitized identifiers. Source-document validity is never changed by enrichment failure.

## 16. Compatibility and Local-First Constraints

- Normalized chunks, facts, evidence, revisions, and tombstones use stable identities suitable for
  later synchronization.
- Managed/original paths, parser heartbeats, local index state, model credentials, and picker tokens
  remain device-local.
- Enrichment request audit metadata may later synchronize, but credentials and raw model traffic do
  not.
- Agent retrieval remains on the current compatibility boundary for this delivery. Only confirmed
  fact projection changes Agent-visible knowledge.
- Legacy `processDocumentSource` remains available only to untouched legacy consumers and is never
  invoked by normalized document UI or IPC.

## 17. Testing Strategy

Every production behavior follows red-green-refactor TDD.

Required tests include:

- deterministic version chunk IDs, offsets, bounded overlap, FTS lookup, and per-version replacement;
- independent local-index status and restart recovery;
- trigram capability probing, Chinese retrieval, escaped MATCH input, deterministic bigram fallback,
  and atomic chunk/FTS/state publication;
- late index publication after deletion/version replacement being rejected by active lease and
  current-version validation;
- worker-thread index execution, complete workspace cleanup, late-worker workspace-existence checks,
  and bounded Electron main-loop delay for maximum-size and queued documents;
- atomic parsed-text/ingestion/index-state commit and startup reconciliation of missing state;
- deletion removing only target chunks and restoration reindexing deterministically;
- import, parsing, OCR, and indexing never calling the model client;
- request rejection for deleted, stale-version, unparsed, empty-text, and unindexed documents;
- explicit consent required before creating a request;
- capability provider/model display matching the provider/model used by the worker;
- configuration changes invalidating an earlier authorization dialog without fallback;
- owner binding, expiry, single consumption, retry authorization, and re-extraction authorization;
- queued/running cancellation, request-revision conflict, provider abort, and late-result rejection;
- provider/model audit storage without credentials;
- duplicate-click idempotency and one-worker concurrency;
- bounded ordinal chunk processing, partial extraction marking, progress, and atomic publication;
- deterministic candidate-limit retention and visible chunk/candidate partial reasons;
- abandoned-request recovery, attempt history, retry, and sanitized failure;
- abandoned running enrichment requiring fresh authorization without an automatic model replay;
- model-call timeout, abort, periodic heartbeat, and stale-attempt publish rejection;
- prompt-injection boundary text and bounded prompt contents;
- strict schema, field whitelist, chunk ownership, quote occurrence, confidence, and length validation;
- valid extraction creating pending facts while profile and trusted index remain unchanged;
- confirmation projecting only the selected fact with optimistic revision protection;
- profile-level compare-and-swap across manual, legacy, and normalized-fact writers;
- field-level revision allowing unrelated edits while protecting same-field archive conflicts;
- request-fact membership and completion recalculation when facts are shared across requests;
- rejection never changing profile;
- confirmed-fact archival reversing only its own unchanged projection and preserving audit history;
- projection-ledger behavior for preexisting manual/legacy values and later manual profile writes;
- durable trusted-index refresh outbox and startup profile-revision reconciliation;
- fail-closed trusted retrieval while indexed revision lags after confirm or archive;
- hard-rule facts remaining unavailable to Agents until confirmation;
- matching facts gaining evidence without reviving rejected identity;
- deletion/version replacement producing stale evidence while preserving confirmed profile values;
- stale-evidence publication incrementing fact revision and a concurrent stale confirmation failing
  main-process evidence revalidation;
- safe IPC, preload, renderer-service contracts without paths, text, or credentials;
- cursor pagination and bounded evidence previews without document-list payload leakage;
- full-workspace metrics and stable active/history/evidence filtering independent of page size;
- independent UI statuses, authorization copy, polling, review actions, race guards, and bilingual copy;
- metric counts for pending, confirmed, rejected, archived, stale, and legacy-deduplicated facts;
- company-summary conflict comparison, replacement, cancellation, and revision refresh;
- 1,000-document metadata listing remaining free of chunk/fact payloads.

Quality gates are targeted Vitest, full `npm test`, changed-file ESLint with zero warnings,
`npm run build`, `npm run compile:electron`, `git diff --check`, security-boundary searches, an
independent whole-diff review, and manual Electron testing.

## 18. Delivery Sequence

1. Shared constants, DTOs, and stable error contracts.
2. Versioned chunk/index schema, store, local indexing service, and document lifecycle integration.
3. Enrichment request/attempt schema and durable worker state machine.
4. Fact/evidence schema, model-output validation, and enrichment result publication.
5. Enterprise profile projector with confirm/reject and conflict handling.
6. IPC, preload bridge, renderer service, and secure model-resolution wiring.
7. Source-document extraction status/action/authorization UI.
8. Normalized AI knowledge list, evidence display, review actions, and compatibility deduplication.
9. Stale-evidence lifecycle, retry/recovery, complete verification, and manual-test handoff.

## 19. Non-Goals

- automatic extraction on import;
- persisted automatic workspace authorization;
- multi-document batch extraction;
- semantic embeddings;
- model-provider selection inside the extraction dialog;
- manual normalized-fact creation;
- editing confirmed fact values in place;
- version-history UI;
- Agent retrieval directly from normalized chunks/facts;
- server synchronization;
- legacy field removal.

## 20. Acceptance Criteria

- A ready normalized document can be explicitly submitted for AI extraction by exact document and
  version identity.
- No import or local-processing operation sends content to a model.
- The authorization dialog names the provider/model and cancel creates no request.
- The model route used by a request is exactly the route represented by its owner-bound, single-use
  authorization descriptor; retries and re-extraction require fresh authorization.
- Enrichment status remains independent from document and local-index status.
- Queued/running enrichment can be cancelled without a late result being published.
- Model output creates only pending normalized facts with validated versioned-chunk evidence.
- Chunk and candidate limits produce deterministic results and visible partial-reason warnings.
- Pending or rejected facts never enter `workspace.profile`, trusted rule sources, or Agent context.
- Confirmed facts project safely and revision conflicts cannot overwrite newer profile state.
- A confirmed fact can be removed from trusted knowledge without deleting its audit history or
  overwriting later manual profile changes.
- Trusted Agent retrieval omits stale profile/rule sources whenever its indexed revision lags the
  current profile revision, including after an archive refresh failure.
- Extraction failures and retries do not invalidate source documents or local search.
- Deletion and replacement mark evidence stale without silently deleting confirmed knowledge.
- Renderer list payloads remain display-safe and bounded for 1,000 documents.
- Maximum-size and queued-document indexing stays off the Electron main thread and within the
  documented responsiveness budget established by the implementation benchmark.
- AI knowledge, pending, and confirmed counts follow the documented deduplication and history rules.
- Targeted tests, full tests, strict lint, renderer build, Electron compile, diff checks, independent
  review, and manual Electron verification pass before handoff.
