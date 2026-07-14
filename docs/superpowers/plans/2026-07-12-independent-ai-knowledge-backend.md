# Independent AI Knowledge Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Build Plan 2 of the approved derived-AI-knowledge design: an explicitly authorized,
durable, single-document enrichment backend that validates model output into normalized facts and
evidence, supports safe review operations, and projects only confirmed facts into trusted Agent
knowledge.

**Architecture:** Keep local ingestion/indexing and remote AI enrichment as separate state machines.
An owner-bound, two-minute in-memory authorization descriptor locks one exact document version and
one exact workspace model route; a single-concurrency durable worker reads only published versioned
chunks, calls that route with an abortable strict-JSON prompt, and atomically publishes validated
facts/evidence. Fact review uses optimistic revisions, an auditable Profile projection ledger, and a
durable trusted-index refresh outbox whose revision gate fails closed in Agent retrieval.

**Tech Stack:** TypeScript, Electron main/preload, better-sqlite3 with WAL, React service boundary,
OpenAI-compatible HTTP model adapter, Vitest.

## Global Constraints

- This is Plan 2 of 3. Plan 1 delivered the versioned local chunk/FTS foundation. Plan 3 adds the
  extraction authorization UI, document-row extraction controls, normalized fact-review UI, and
  bilingual visible copy.
- Node.js remains `>=24.15.0 <25`; do not add a runtime dependency.
- Do not add new normalized-enrichment IPC channels or new visual UI in this plan. Expose a tested
  main-internal backend façade that Plan 3 will wrap with IPC/preload/renderer code.
- The existing manual Profile-edit IPC may change only as required to carry optimistic
  `expectedProfileRevision` and explicit touched fields; do not redesign the page.
- Do not stage, commit, merge, or push Plan 2 changes before the user completes the later manual
  acceptance. Subagent task boundaries use diff packages and `.superpowers/sdd/progress.md` instead
  of commits.
- Because the work remains unstaged, do not use a `BASE..HEAD` package that omits working-tree
  changes. For each task, write `git diff --no-ext-diff --unified=80 HEAD -- <task files>` to a unique
  `.superpowers/sdd/reviews/task-N.diff`; the final package is the complete `git diff HEAD` plus
  `git status --short` and untracked-file contents. Record the package path in the progress ledger.
- Every production behavior change follows red-green-refactor TDD. Every task receives an
  independent specification and code-quality review before the next task begins.
- Import, parsing, OCR, chunking, indexing, deletion, restoration, ordinary retry, and startup
  reconciliation never call a model.
- The normalized backend never invokes legacy `processDocumentSource` and never uses
  `KnowledgeIngestionStage.FactExtraction`.
- The first model route supports only workspace configurations that resolve strictly to
  OpenAI-compatible HTTP with a stable credential identity. Anthropic-format routes, MiniMax OAuth,
  OpenAI Codex OAuth, GitHub Copilot's dynamic token exchange, and the dynamically tokenized
  `lobsterai-server` route return
  `unsupported_model_provider`; no provider/model fallback is allowed.
- Every model call receives the exact locked `apiConfig`, a real `AbortSignal`, and a 180-second
  timeout. Cancellation, timeout, route change, document/version change, and lost attempt ownership
  prevent publication even if the provider returns late.
- The routing fingerprint is SHA-256 over an explicit versioned payload containing provider ID,
  model ID, API type, normalized endpoint, auth type, coding-plan flag, and a one-way credential
  identity digest. The only credential-digest helper is
  `sha256("knowledge-enrichment-credential-v1\0" + stableCredentialIdentity)`: API-key routes use
  the effective API key; unauthenticated loopback routes use the fixed sentinel `no-auth-local`.
  Empty-key remote routes, non-HTTP(S) endpoints, and endpoints containing URL credentials are
  configuration errors.
  Rotating access tokens are never a stable identity, which is why `lobsterai-server` is unsupported
  in Plan 2. Only the final routing fingerprint is persisted or exposed internally outside the
  resolver; intermediate credential digests are never persisted, logged, or returned.
- Authorization descriptors are main-memory only, owner-bound, single-success-consumption, and
  expire after exactly 120,000 ms. A successful receipt remains until the original expiry and
  returns the same request ID to an immediate duplicate call. Consumption revalidates owner,
  expiry, workspace/document/current version/index, exact provider/model, and routing fingerprint
  inside the request-creation callback before any durable request or wake is allowed.
- Enrichment concurrency is exactly one. Each request covers at most 30 published chunks in ordinal
  order; each call explicitly requests at most 4,096 model output tokens and accepts at most
  1,048,576 response bytes; each response contributes at most 50 candidates; one request publishes
  at most 200 unique candidates.
- Fact values are at most 2,000 characters; evidence quotes are at most 1,000 characters; confidence
  is a finite number in the inclusive range 0–1.
- The model envelope must be strict JSON shaped as `{ "facts": [...] }`. Do not reuse the legacy
  fence/substring-tolerant JSON parser or its permissive confidence normalization.
- Raw prompts, raw responses, chunk text, extracted text, credentials, authorization tokens,
  absolute paths, managed paths, provider headers, SQLite messages, and stack traces are never
  persisted or returned in display-safe DTOs.
- Request status and `active_attempt_id` CAS guard heartbeat, failure, cancellation, and final
  publication. Attempt outcomes are exactly `running`, `completed`, `failed`, `cancelled`, and
  `abandoned`.
- User cancellation produces request status `cancelled`. Document deletion/version replacement
  produces `stale` and cancels any running attempt. Startup converts every abandoned running request
  to `failed` with `authorization_required`; it never automatically replays content.
- Initial workspace `profileRevision` and all ten Profile field revisions are 1. Every user-visible
  Profile mutation increments the global revision; explicitly touched fields increment even when a
  user saves the same normalized text.
- Fact, Profile, projection ledger/group, and trusted-index outbox updates commit atomically.
  Pending/rejected facts never change Profile or trusted Agent sources.
- Trusted Profile/rule retrieval is fail-closed whenever the current Profile revision differs from
  the last successfully indexed revision. Raw workspace-document retrieval remains available.
- One workspace targets roughly 100–1,000 documents. Fact listing is cursor-paginated at 50 by
  default and 100 maximum, metrics cover the full workspace, and list projections must avoid N+1
  queries.
- Every touched TypeScript/TSX file must pass changed-file ESLint with zero warnings. Main/preload
  work must pass `npm run compile:electron`; renderer-bound type/service work must pass
  `npm run build`.

---

## Scope Boundary

This plan delivers the complete non-visual backend required by Plan 3:

- shared enrichment/fact constants and safe DTOs;
- strict workspace model resolution and authorization descriptor storage;
- durable enrichment request/attempt queue and one-concurrency worker;
- strict prompt/response validation and atomic facts/evidence publication;
- Profile global/field revision CAS for every existing writer;
- confirm, reject, archive, projection-conflict, and stale-evidence backend operations;
- durable trusted-index refresh and fail-closed Agent retrieval;
- document/workspace lifecycle integration, recovery, cleanup, and backend verification.

It deliberately does not render extraction actions, authorization/review dialogs, enrichment
progress, fact lists, evidence panels, metrics, history filters, or conflict-resolution UI. It also
does not add batch extraction, automatic extraction, semantic embeddings, direct Agent retrieval
from normalized chunks/facts, server synchronization, or legacy-field removal.

## File Structure

### Shared contracts and pure Profile knowledge

- Modify `src/shared/knowledgeBase/constants.ts`: enrichment/fact/review/projection/outbox statuses,
  error codes, domain whitelist, and exact limits.
- Modify `src/shared/knowledgeBase/types.ts`: safe enrichment summaries, authorization descriptor,
  fact/evidence summaries, list/metrics, and review/archive backend request/result types.
- Modify `src/shared/knowledgeBase/contracts.test.ts`: stable values and no-sensitive-field contract.
- Create `src/shared/knowledgeBase/enterpriseLeadProfileKnowledge.ts`: Profile domain mapping,
  normalization, confirmation-key transforms, deduplicating array projection, and touched-field
  helpers shared by main and the existing renderer.
- Create `src/shared/knowledgeBase/enterpriseLeadProfileKnowledge.test.ts`.
- Modify `src/shared/enterpriseLeadWorkspace/types.ts` in Task 8: required `profileRevision` and
  stable display-safe Profile conflict result types.

### Model authorization and durable enrichment

- Create `src/main/knowledgeBase/knowledgeEnrichmentTypes.ts`: internal rows, claims, locked routes,
  validated candidates, publication inputs, and worker results.
- Create `src/main/knowledgeBase/knowledgeEnrichmentModelResolver.ts` and test: strict workspace route
  selection, safe descriptor metadata, and versioned route fingerprint.
- Create `src/main/knowledgeBase/knowledgeExtractionAuthorizationStore.ts` and test: owner/TTL,
  callback-based successful consumption, receipt replay, and cleanup.
- Modify `src/main/industryPack/modelClientAdapter.ts` and test: pass `AbortSignal` to fetch, bound
  response-body streaming by bytes, and never fall back when an explicit `apiConfig` is supplied.
- Modify `src/main/libs/claudeSettings.ts` and test: remove/redact OAuth secrets from config logs.
- Create `src/main/knowledgeBase/knowledgeEnrichmentRequestStore.ts` and test: request/attempt DDL,
  CAS state machine, cancel/retry/stale/recovery, and safe summaries.
- Create `src/main/libs/sqliteTransactionRetry.ts` and test; modify current index/document/ingestion
  imports: move the already verified generic whole-transaction BUSY retry out of the index store
  without changing its retry/backoff behavior.
- Create `src/main/knowledgeBase/knowledgeEnrichmentCandidateValidator.ts` and test: strict envelope,
  prompt-injection boundary, candidate validation, deterministic caps, and partial reasons.
- Create `src/main/knowledgeBase/knowledgeFactStore.ts` and test: normalized facts, evidence,
  request membership, stale lifecycle, and internal review primitives.
- Create `src/main/knowledgeBase/knowledgeFactQueryService.ts` and test: cursor-safe active/history
  projections, bounded evidence previews, full-workspace metrics, and legacy Profile deduplication.
- Create `src/main/knowledgeBase/knowledgeEnrichmentPublicationStore.ts` and test: atomic
  facts/evidence/request-membership publication and deduplication.
- Create `src/main/knowledgeBase/knowledgeEnrichmentService.ts` and test: authorization façade,
  one-concurrency drain, timeout/abort/heartbeat, route revalidation, and safe failure.

### Profile projection and trusted-index safety

- Create `src/main/enterpriseLeadWorkspace/profileRevisionStore.ts` and test: schema backfill,
  Profile global/field CAS, explicit touched fields, and latest-workspace conflicts.
- Modify `src/main/enterpriseLeadWorkspace/store.ts`, `service.ts`, and their tests: delegate every
  Profile writer to the revision store and semantically retry legacy async extraction.
- Modify existing enterprise workspace IPC/preload/renderer service/type call sites and tests to pass
  `expectedProfileRevision` plus exact touched fields without changing layout.
- Create `src/main/knowledgeBase/knowledgeFactProjectionStore.ts` and test: projection groups,
  immutable ledgers, support counts, and reversal metadata.
- Create `src/main/knowledgeBase/enterpriseLeadKnowledgeFactProjector.ts` and test: confirm/reject,
  company-summary conflict, archive/reversal decisions, evidence revalidation, and atomic outbox.
- Create `src/main/knowledgeBase/knowledgeTrustedProfileIndexStore.ts` and test: durable refresh jobs,
  indexed revision, recovery, retry, and reconciliation.
- Create `src/main/knowledgeBase/knowledgeTrustedProfileIndexService.ts` and test: bounded refresh
  drain and source rebuilding from the current workspace snapshot.
- Create `src/main/enterpriseLeadWorkspace/trustedKnowledgeSources.ts` and test: pure construction of
  confirmed Profile/rule sources owned by the trusted refresh worker.
- Modify `src/main/libs/contentKnowledgeVectorStore.ts` and test: provide source-type-scoped
  `replaceWorkspaceDocumentSources`, `deleteWorkspaceDocumentSources`, and
  `replaceTrustedSources`, and filter Profile/rule chunks in the same SQLite read snapshot when the
  revision gate is absent or lagging.

### Composition and lifecycle

- Modify `src/main/knowledgeBase/knowledgeDocumentService.ts` and test: mark requests/evidence stale
  in the same delete/version-replacement transaction; restoration never reactivates evidence.
- Modify `src/main/knowledgeBase/knowledgeBaseFoundation.ts` and test: construct all Plan 2 stores and
  services, recover before wake, reconcile trusted revisions, stop abortable work, and delete in
  explicit dependency order.
- Modify `src/main/main.ts`: inject strict model resolver/client and trusted vector refresh callback;
  shutdown enrichment before closing SQLite.

---

### Task 1: Freeze Shared Backend Contracts and Profile Knowledge Pure Functions

**Files:**

- Modify: `src/shared/knowledgeBase/constants.ts`
- Modify: `src/shared/knowledgeBase/types.ts`
- Modify: `src/shared/knowledgeBase/contracts.test.ts`
- Create: `src/shared/knowledgeBase/enterpriseLeadProfileKnowledge.ts`
- Create: `src/shared/knowledgeBase/enterpriseLeadProfileKnowledge.test.ts`

**Interfaces:**

- Produces the value objects and derived types `KnowledgeEnrichmentStatus`,
  `KnowledgeEnrichmentAttemptOutcome`, `KnowledgeEnrichmentPartialReason`,
  `KnowledgeFactReviewStatus`, `KnowledgeFactSourceKind`, `KnowledgeFactProjectionState`,
  `KnowledgeFactProfileProjectionAction`, `KnowledgeFactReviewDecision`,
  `KnowledgeFactArchiveProjectionDecision`, `KnowledgeTrustedIndexRefreshStatus`,
  `KnowledgeTrustedIndexRefreshAttemptOutcome`, `KnowledgeFactDomain`, and the exact limits named in
  Global Constraints.
- Produces safe DTOs used by all later tasks: `KnowledgeEnrichmentSummary`,
  `KnowledgeExtractionAuthorizationDescriptor`, `KnowledgeExtractionAuthorizationPreparation`,
  `KnowledgeFactSummary`, `KnowledgeFactEvidenceSummary`, `KnowledgeFactMetrics`,
  `KnowledgeListFactsRequest`, `KnowledgeFactListResult`, `KnowledgeReviewFactRequest`,
  `KnowledgeFactReviewResult`, `KnowledgeArchiveFactRequest`, and `KnowledgeFactArchiveResult`.
- Produces shared pure functions `normalizeEnterpriseKnowledgeValue`,
  `buildEnterpriseKnowledgeKey`, `appendEnterpriseProfileArrayValue`,
  `confirmEnterpriseProfileKnowledgeKey`, `ignoreEnterpriseProfileKnowledgeKey`,
  `removeEnterpriseProfileKnowledgeKey`, `getEnterpriseProfileFieldValue`, and
  `getChangedEnterpriseProfileFields`.

- [ ] **Step 1: Write failing shared-contract tests**

Add assertions that lock every stable value and numeric limit. Include this representative contract
and enumerate the remaining values in the same test instead of comparing loose snapshots:

```ts
expect(KnowledgeEnrichmentStatus).toEqual({
  Queued: 'queued',
  Running: 'running',
  ReviewRequired: 'review_required',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Stale: 'stale',
});
expect(KnowledgeEnrichmentAttemptOutcome).toEqual({
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Abandoned: 'abandoned',
});
expect(KNOWLEDGE_EXTRACTION_AUTHORIZATION_TTL_MS).toBe(120_000);
expect(KNOWLEDGE_ENRICHMENT_MAX_CHUNKS).toBe(30);
expect(KNOWLEDGE_ENRICHMENT_MAX_CANDIDATES_PER_CALL).toBe(50);
expect(KNOWLEDGE_ENRICHMENT_MAX_CANDIDATES_PER_REQUEST).toBe(200);
expect(KNOWLEDGE_ENRICHMENT_MODEL_MAX_TOKENS).toBe(4_096);
expect(KNOWLEDGE_ENRICHMENT_MODEL_MAX_RESPONSE_BYTES).toBe(1_048_576);
expect(KNOWLEDGE_ENRICHMENT_MODEL_TIMEOUT_MS).toBe(180_000);
expect(KNOWLEDGE_ENRICHMENT_HEARTBEAT_INTERVAL_MS).toBe(15_000);
expect(KNOWLEDGE_ENRICHMENT_CONCURRENCY).toBe(1);
expect(KNOWLEDGE_FACT_MAX_VALUE_CHARS).toBe(2_000);
expect(KNOWLEDGE_EVIDENCE_MAX_QUOTE_CHARS).toBe(1_000);
expect(KNOWLEDGE_EVIDENCE_PREVIEW_MAX_CHARS).toBe(240);
expect(KNOWLEDGE_FACT_LIST_DEFAULT_LIMIT).toBe(50);
expect(KNOWLEDGE_FACT_LIST_MAX_LIMIT).toBe(100);
expect(KNOWLEDGE_ENRICHMENT_SAFE_ERROR_MAX_CHARS).toBe(240);
expect(KnowledgeFactProjectionState).toEqual({
  None: 'none',
  Active: 'active',
  Conflict: 'conflict',
  Reversed: 'reversed',
});
```

Assert summary/list/fact DTO JSON does not contain `content`, `chunkText`, `extractedText`, `apiKey`,
`baseURL`, `routingFingerprint`, `authorizationToken`, `managedPath`, `absolutePath`, `rawResponse`,
or `errorMessage`. The one-shot `KnowledgeExtractionAuthorizationPreparation` intentionally contains
only its opaque token plus the safe descriptor.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm test -- src/shared/knowledgeBase/contracts.test.ts \
  src/shared/knowledgeBase/enterpriseLeadProfileKnowledge.test.ts
```

Expected: FAIL because the new constants, DTOs, and pure-function module do not exist.

- [ ] **Step 3: Implement the centralized constants and types**

Use `as const` objects and derived union types. Add all design errors to
`KnowledgeBaseErrorCode`, including:

```ts
DocumentNotReady: 'document_not_ready',
LocalIndexNotReady: 'local_index_not_ready',
ExplicitConsentRequired: 'explicit_consent_required',
ModelConfigurationUnavailable: 'model_configuration_unavailable',
ModelConfigurationChanged: 'model_configuration_changed',
InvalidExtractionAuthorization: 'invalid_extraction_authorization',
ExpiredExtractionAuthorization: 'expired_extraction_authorization',
ConsumedExtractionAuthorization: 'consumed_extraction_authorization',
ForeignExtractionAuthorizationOwner: 'foreign_extraction_authorization_owner',
UnsupportedModelProvider: 'unsupported_model_provider',
EnrichmentAlreadyActive: 'enrichment_already_active',
EnrichmentRequestNotFound: 'enrichment_request_not_found',
EnrichmentRequestStale: 'enrichment_request_stale',
InvalidModelResponse: 'invalid_model_response',
EvidenceValidationFailed: 'evidence_validation_failed',
FactEvidenceStale: 'fact_evidence_stale',
FactRevisionConflict: 'fact_revision_conflict',
FactProjectionConflict: 'fact_projection_conflict',
ProfileRevisionConflict: 'profile_revision_conflict',
EnrichmentPersistenceFailed: 'enrichment_persistence_failed',
AuthorizationRequired: 'authorization_required',
```

Represent `KnowledgeExtractionAuthorizationDescriptor` without its opaque token in reusable safe
metadata; Plan 3 adds the token only to the prepare-operation response. Keep `routingFingerprint`
internal.

- [ ] **Step 4: Implement and test shared Profile knowledge functions**

The domain whitelist is exactly:

```ts
export const KnowledgeFactDomain = {
  CompanySummary: 'companySummary',
  ProductList: 'productList',
  ProductCapabilities: 'productCapabilities',
  TargetCustomers: 'targetCustomers',
  ApplicationScenarios: 'applicationScenarios',
  SellingPoints: 'sellingPoints',
  ChannelPreferences: 'channelPreferences',
  ProhibitedClaims: 'prohibitedClaims',
  ContactRules: 'contactRules',
  MissingInfo: 'missingInfo',
} as const;
```

`normalizeEnterpriseKnowledgeValue(value)` returns `{ displayValue, normalizedValue }`: preserve
`value.trim()` exactly for display, while comparison applies `trim()`, internal whitespace collapse,
and lower-casing. `buildEnterpriseKnowledgeKey(domain, value)` uses the normalized value.
`appendEnterpriseProfileArrayValue(profile, arrayDomain, value)` returns a cloned Profile, appends
the display value only when its normalized value is not already present, and never accepts
`companySummary`.

The key transforms are immutable and have distinct semantics: `confirm` adds the canonical key to
confirmed and removes it from ignored; `ignore` adds it to ignored and removes it from confirmed;
`remove` clears it from both sets so projection reversal can restore prior trust state explicitly.
`getChangedEnterpriseProfileFields(previous, next)` compares normalized field values plus canonical
confirmed/ignored key membership by domain; it returns a deduplicated domain list and ignores mere
ordering of trust-key sets. Malformed/unknown changed trust keys are not silently assigned to a
domain—Task 8 rejects them as invalid input.

Tests must prove Chinese text, case-insensitive Latin deduplication, display preservation,
confirmed/ignored/neutral key movement, array append deduplication, `companySummary` access, value
field diffs, trust-key-domain diffs, and no diff for trust-key ordering alone.

- [ ] **Step 5: Verify shared contracts GREEN**

Do not change required `EnterpriseLeadWorkspace` or `KnowledgeDocumentListItem` production shapes in
this task. Their required fields and all affected constructors/fixtures move atomically with the
corresponding production behavior in Tasks 8 and 11.

Run the targeted tests from Step 2 plus:

```bash
npm test -- src/shared/enterpriseLeadWorkspace \
  src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run changed-file ESLint and create the task review package**

Run changed-file ESLint with zero warnings and `git diff --check`. Do not stage or commit. Generate a
task-scoped diff package and request independent specification and code-quality review.

---

### Task 2: Add Abortable Explicit Model Calls and Strict Workspace Route Resolution

**Files:**

- Modify: `src/main/industryPack/modelClientAdapter.ts`
- Modify: `src/main/industryPack/modelClientAdapter.test.ts`
- Modify: `src/main/libs/claudeSettings.ts`
- Modify: `src/main/libs/claudeSettings.test.ts`
- Create: `src/main/knowledgeBase/knowledgeEnrichmentModelResolver.ts`
- Create: `src/main/knowledgeBase/knowledgeEnrichmentModelResolver.test.ts`
- Create: `src/main/knowledgeBase/knowledgeEnrichmentTypes.ts`

**Interfaces:**

- Extends `ModelGenerationInput` with `signal?: AbortSignal` and `maxResponseBytes?: number`; passes
  the exact signal to `fetch` and reads a configured response body with an accumulated byte limit.
- Produces `KnowledgeEnrichmentLockedRoute` with internal `apiConfig`, provider/model identifiers,
  safe labels, API type, and routing fingerprint.
- Produces `KnowledgeEnrichmentModelResolver.resolveForWorkspace(workspaceId)` and
  `.resolveExact(requestRoute)`; neither method falls back.

- [ ] **Step 1: Write failing AbortSignal, bounded-response, and redaction tests**

Test that the exact signal reaches fetch and abort rejects the request. Spy on configuration logging
with a provider containing `apiKey`, `oauthAccessToken`, and `oauthRefreshToken`; assert none of the
secret values occur in serialized log arguments. Add adapter tests for an oversized truthful
`Content-Length`, a missing/false `Content-Length`, and a chunked stream that crosses the configured
byte limit. The adapter must cancel the response reader on overflow, throw a typed/safely mappable
error without retaining the partial body, and never log it. A body exactly at the limit remains
valid. Also cover invalid limits before fetch, empty body, stream read/cancel failures, abort during
body read, non-2xx bodies, and reader lock release. JSON/read errors use fixed safe errors with no raw
parser/transport cause or response snippet.

- [ ] **Step 2: Write failing strict-route tests**

Build workspaces with: an exact OpenAI-compatible route, a missing preferred model, a disabled
provider, an Anthropic route, MiniMax OAuth, OpenAI Codex OAuth, GitHub Copilot,
native Gemini (`apiFormat: gemini`), `lobsterai-server`, and two providers sharing a model ID. Assert only the exact supported
OpenAI-compatible route succeeds and no alternate provider is selected.

Reject non-HTTP(S) schemes, URL-embedded username/password, and a remote empty-key route. Accept an
empty-key route only for loopback hosts (`localhost`/`.localhost`, `127.0.0.0/8`, or `::1`) and use
the sentinel there. Test an unsupported empty-key Anthropic route with server fallback both present
and absent; it must always return `unsupported_model_provider` and never resolve the fallback.

The fingerprint test uses this exact canonical payload order:

```ts
const payload = {
  version: 1,
  providerId,
  modelId,
  apiType,
  normalizedEndpoint,
  authType: authType ?? '',
  codingPlanEnabled,
  credentialIdentityHash,
};
```

Assert credential rotation changes the final fingerprint without exposing either credential.
Lock the credential identity rule with tests for API-key rotation, unauthenticated local routes using
the stable `no-auth-local` sentinel, stability across fresh resolver instances/application restart,
and rejection of dynamically rotating access-token routes. No persisted/request/DTO/log value may
contain the intermediate credential identity digest.

- [ ] **Step 3: Run the tests and verify RED**

Run:

```bash
npm test -- src/main/industryPack/modelClientAdapter.test.ts \
  src/main/libs/claudeSettings.test.ts \
  src/main/knowledgeBase/knowledgeEnrichmentModelResolver.test.ts
```

Expected: FAIL for missing signal propagation, unsafe log redaction, and missing strict resolver.

- [ ] **Step 4: Implement signal propagation and secret-safe logging**

Add `signal?: AbortSignal` and `maxResponseBytes?: number` to the adapter input and
`signal: input.signal` to fetch options. For bounded calls, reject a trustworthy `Content-Length`
that already exceeds the cap, otherwise consume `response.body` with a reader while counting encoded
bytes and cancel the reader immediately on overflow before JSON parsing. Do not call `response.json()`
or `response.text()` on the bounded path. When an explicit `apiConfig` is present, never call the
default resolver. Replace the current expanded provider-config log with an allowlisted diagnostic
containing provider name, model ID, API type, and booleans such as `hasApiKey`; use `console.debug`
because Task 7 revalidates per chunk, and do not log an arbitrary provider object. Validate limits
before fetch; always release a reader lock in `finally`; cancel non-2xx bodies. Discard JSON parser
and non-abort stream error causes so response snippets cannot enter logs, while preserving a real
`AbortError`.

- [ ] **Step 5: Implement the strict resolver and versioned fingerprint**

Read the workspace's explicit default provider/model, narrow the input config to that one route,
call `resolveRawApiConfigFromAppConfig`, and then verify the returned provider/model again. Reject
all non-OpenAI API types, OAuth variants, GitHub Copilot, and `lobsterai-server` listed in Global
Constraints.
Implement one pure credential helper with the exact domain separator
`knowledge-enrichment-credential-v1\0`; use the effective API key or `no-auth-local`, never a
short-lived access token. Add a no-server-fallback strict option to the existing raw resolver (default
behavior for old callers remains unchanged), use it here, and pre-reject an explicitly unsupported
format so its error code cannot depend on unrelated global server state. Normalize only valid
credential-free HTTP(S) endpoints for hashing; never return an endpoint in safe metadata.

Do not inherit the legacy resolver's forced mapping of native Gemini to OpenAI: a Gemini provider is
eligible only when this workspace explicitly configures `apiFormat: openai` with a compatible base
URL. Native `apiFormat: gemini` is unsupported in Plan 2.

- [ ] **Step 6: Verify GREEN and review**

Run the targeted tests, changed-file ESLint, and `git diff --check`. Assert logs contain no token-like
values with a targeted `rg` search. Do not stage or commit; generate the review package.

---

### Task 3: Build the Owner-Bound Extraction Authorization Store

**Files:**

- Create: `src/main/knowledgeBase/knowledgeExtractionAuthorizationStore.ts`
- Create: `src/main/knowledgeBase/knowledgeExtractionAuthorizationStore.test.ts`

**Interfaces:**

- Produces `KnowledgeExtractionAuthorizationStore.issue(input)` returning opaque token plus safe
  descriptor metadata. Input contains owner/workspace/document/version/display name, the internal
  Task 2 locked route, planned call count, and partial flag; the store—not the caller—sets issuance
  and exact expiry from an injected/default clock.
- Produces async
  `consume(token, ownerId, createRequest: (context) => string | Promise<string>): Promise<string>`.
  The callback receives the internal exact document/version/locked-route context and returns only a
  committed request ID. The store records a receipt only after success and returns the same request
  ID on immediate replay; Task 7 rereads the display-safe request summary by ID.
- Produces `clearOwner(ownerId)` and `clearWorkspace(workspaceId)`.
- Descriptor, in-flight, and receipt records all retain internal `workspaceId`, `ownerId`, original
  expiry, and owner/workspace invalidation generations. None of those internal records is serialized
  as a display DTO.
- Produces a typed authorization error carrying only a stable `KnowledgeBaseErrorCode`, and an
  internal callback-failure class/discriminant with exactly `retryable_persistence_failure` or
  `invalidate_authorization`. Raw callback/SQLite messages are never copied into the public error.

- [ ] **Step 1: Write failing authorization lifecycle tests**

Cover: owner binding; exact 120,000 ms expiry; foreign owner; successful single consumption;
same-owner receipt replay; a classified retryable persistence rejection leaving the unexpired
descriptor available; every target/route invalidation deleting it; concurrent duplicate consumption
sharing one callback; cleanup by owner/workspace; and JSON output that omits fingerprint and internal
route data. Add both races: callback pending -> `clearWorkspace`, and callback pending ->
`clearOwner`; callback completion must neither return success nor insert/reinsert a receipt.

Use an injected clock and token generator. Test the millisecond immediately before expiry and the
exact expiry boundary; expired descriptors/receipts are pruned. Test invalid, expired, consumed or
invalidated, and foreign-owner errors by stable code only, with no token, route, credential, path, or
callback message in serialized errors. The internal callback context contains the locked route, but
the returned Preparation/receipt result never does.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- src/main/knowledgeBase/knowledgeExtractionAuthorizationStore.test.ts
```

Expected: FAIL because the store is absent.

- [ ] **Step 3: Implement callback-based consumption**

Use separate in-memory maps for descriptors, in-flight callback promises, successful receipts, and
owner/workspace invalidation generations. Validate owner, expiry, and the captured generations before
invoking the callback. A success may delete the descriptor and retain
`{ requestId, expiresAt, ownerId, workspaceId, ownerGeneration, workspaceGeneration }` only after
rechecking both generations. `clearOwner`/`clearWorkspace` increment the matching generation and
remove descriptors and receipts before returning.

Generate an unguessable opaque token with `randomUUID`/cryptographic randomness in production and a
test-only injected generator. Validate/prune against `now >= expiresAt`; a duplicate at the exact
expiry must not replay. Receipt replay is owner-bound and returns only its request ID.

Classify callback failures explicitly. Only `retryable_persistence_failure` may retain an unexpired
descriptor. Owner/expiry/document/current-version/index/provider/model/fingerprint changes delete the
descriptor, create no receipt, and require a fresh prepare operation. Unknown callback failures fail
closed and invalidate the token. Concurrent same-token calls by the rightful owner await the same
promise and observe the same final result.

- [ ] **Step 4: Verify GREEN and review**

Run the targeted test, changed-file ESLint, and `git diff --check`. Do not stage or commit; generate
the review package.

---

### Task 4: Implement the Durable Enrichment Request and Attempt State Machine

**Files:**

- Create: `src/main/knowledgeBase/knowledgeEnrichmentRequestStore.ts`
- Create: `src/main/knowledgeBase/knowledgeEnrichmentRequestStore.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeEnrichmentTypes.ts`
- Create: `src/main/libs/sqliteTransactionRetry.ts`
- Create: `src/main/libs/sqliteTransactionRetry.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentIndexStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentIndexStore.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentIndexWorker.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentIndexRunner.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentIndexExecutor.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentService.ts`
- Modify: `src/main/knowledgeBase/knowledgeIngestionService.ts`
- Modify: `src/shared/knowledgeBase/constants.ts`
- Modify: `src/shared/knowledgeBase/contracts.test.ts`

**Interfaces:**

- Produces `KnowledgeEnrichmentRequestStore` methods:

```ts
createOrGetAuthorizedRequest(input: CreateAuthorizedEnrichmentRequestInput):
  KnowledgeEnrichmentRequest;
createOrGetAuthorizedRequestInCurrentTransaction(input: CreateAuthorizedEnrichmentRequestInput):
  KnowledgeEnrichmentAuthorizedTransition;
getRequest(requestId: string): KnowledgeEnrichmentRequest | null;
getSummary(requestId: string): KnowledgeEnrichmentSummary | null;
getActiveRequestForVersion(documentVersionId: string): KnowledgeEnrichmentRequest | null;
listWorkspaceSummaries(workspaceId: string): KnowledgeEnrichmentSummary[];
listLatestSummariesForVersions(
  workspaceId: string,
  documentVersionIds: readonly string[],
): Map<string, KnowledgeEnrichmentSummary>;
claimNext(now?: string): KnowledgeEnrichmentClaim | null;
heartbeat(requestId: string, attemptId: string, progress: number, now?: string): boolean;
completeEmpty(requestId: string, attemptId: string, input: EmptyCompletionCounts): boolean;
failAttempt(requestId: string, attemptId: string, input: SafeFailure): boolean;
cancel(requestId: string, expectedRevision: number, now?: string): KnowledgeEnrichmentRequest;
retryFailedWithAuthorization(input: RetryAuthorizedEnrichmentRequestInput):
  KnowledgeEnrichmentRequest;
retryFailedWithAuthorizationInCurrentTransaction(input: RetryAuthorizedEnrichmentRequestInput):
  KnowledgeEnrichmentAuthorizedTransition;
recoverAbandonedRunning(now?: string): number;
markVersionStale(documentVersionId: string, now?: string): number;
markWorkspaceStale(workspaceId: string, now?: string): number;
deleteWorkspaceRequests(workspaceId: string): void;
listAttempts(requestId: string): KnowledgeEnrichmentAttempt[];
```

Lock the internal Task 4 types in `knowledgeEnrichmentTypes.ts`:

```ts
interface CreateAuthorizedEnrichmentRequestInput {
  workspaceId: string;
  documentId: string;
  documentVersionId: string;
  providerId: string;
  modelId: string;
  routingFingerprint: string;
  now?: string;
}

interface RetryAuthorizedEnrichmentRequestInput
  extends CreateAuthorizedEnrichmentRequestInput {
  requestId: string;
}

interface KnowledgeEnrichmentAuthorizedTransition {
  request: KnowledgeEnrichmentRequest;
  queuedTransition: boolean;
}

interface EmptyCompletionCounts {
  validCandidateCount: 0;
  discardedCandidateCount: 0;
  partialReasons: readonly KnowledgeEnrichmentPartialReason[];
  now?: string;
}

type KnowledgeEnrichmentSafeFailureCode =
  | typeof KnowledgeBaseErrorCode.ModelConfigurationUnavailable
  | typeof KnowledgeBaseErrorCode.ModelConfigurationChanged
  | typeof KnowledgeBaseErrorCode.UnsupportedModelProvider
  | typeof KnowledgeBaseErrorCode.ModelRequestFailed
  | typeof KnowledgeBaseErrorCode.ModelRequestTimeout
  | typeof KnowledgeBaseErrorCode.InvalidModelResponse
  | typeof KnowledgeBaseErrorCode.EvidenceValidationFailed
  | typeof KnowledgeBaseErrorCode.EnrichmentPersistenceFailed
  | typeof KnowledgeBaseErrorCode.AuthorizationRequired;

interface SafeFailure {
  code: KnowledgeEnrichmentSafeFailureCode;
  now?: string;
}

interface KnowledgeEnrichmentClaim {
  request: KnowledgeEnrichmentRequest;
  attempt: KnowledgeEnrichmentAttempt;
}
```

Add centralized stable codes `model_request_failed` and `model_request_timeout` to
`KnowledgeBaseErrorCode` and the shared contract allowlist. Network/HTTP transport failures map to
`model_request_failed`; the 180-second model deadline maps to `model_request_timeout`; response
overflow/malformed output maps to `invalid_model_response`; `enrichment_persistence_failed` remains
reserved for local durable-write failures. No transport error text is persisted or serialized.

`KnowledgeEnrichmentRequest` mirrors every request column below and keeps provider/model/fingerprint,
active attempt, and safe error message main-internal. `KnowledgeEnrichmentAttempt` mirrors every
attempt column. The public mapper returns the existing Task 1 `KnowledgeEnrichmentSummary`, excludes
all internal route/error text, and uses `pendingFactCount: 0` until Task 6 adds membership aggregation.
Store options may inject UUID and clock factories for deterministic tests.

`getSummary` is the only public single-request summary projection and uses that same safe mapper;
facades never reconstruct a summary from an internal request. The two `*InCurrentTransaction`
primitives assert `db.inTransaction`, execute exactly once without opening a savepoint or retry loop,
and return `queuedTransition: true` only when this invocation inserted a new queued request or changed
the exact failed request to queued. Ordinary create returns false for an existing active request or
the dormant exact-route failed row; retry returns false only when the same request is already
queued/running/review-required, while a failed-to-queued mutation returns true.
The existing wrapper methods own/retry their outer transaction and return only `.request` for Task 4
compatibility. Task 7 owns the complete authorization-revalidation transaction and uses the
transaction-neutral primitives so a poisoned snapshot is retried as a whole.

Produce `KnowledgeEnrichmentRevisionConflictError` with stable `revision_conflict` and only the latest
`KnowledgeEnrichmentSummary`, plus a fixed-message `KnowledgeEnrichmentRequestStateError` carrying
only a stable `KnowledgeBaseErrorCode`. Never attach SQLite/parser messages, paths, route metadata, or
stack/cause to a display-safe result.

- All mutating attempt operations compare `status = running`, `active_attempt_id`, and attempt
  `outcome = running` in the same transaction.

- Moves the complete neutral retry family—`TransientSqliteBusyRetryDelay`,
  `isTransientSqliteBusyError`, `runTransientSqliteWriteTransaction`, and
  `runTransientSqliteWriteTransactionUntilSuccess`—with the existing four attempts per round and
  cross-round 25, 50, 100, 200, 250 ms capped backoff. Index store/worker/runner/executor plus
  document and ingestion services import from the neutral module; no behavior changes or
  compatibility re-export remains.

- [ ] **Step 1: Write failing DDL and mapping tests**

First move the existing SQLite retry tests to the neutral module and add an import-boundary test that
the document/import/ingestion/enrichment code no longer imports a generic helper from
`knowledgeDocumentIndexStore`. Run the moved tests before editing production and verify they pass as
a characterization baseline; then change their import to the new absent module and verify RED.

Lock the request and attempt schema to the following logical DDL. The implementation may only vary
whitespace and idempotent `IF NOT EXISTS` clauses:

```sql
CREATE TABLE knowledge_enrichment_requests (
  id TEXT PRIMARY KEY CHECK (TRIM(id) <> ''),
  workspace_id TEXT NOT NULL CHECK (TRIM(workspace_id) <> ''),
  document_id TEXT NOT NULL CHECK (TRIM(document_id) <> ''),
  document_version_id TEXT NOT NULL CHECK (TRIM(document_version_id) <> ''),
  status TEXT NOT NULL CHECK (
    status IN (
      'queued','running','review_required','completed',
      'failed','cancelled','stale'
    )
  ),
  consent_mode TEXT NOT NULL DEFAULT 'explicit'
    CHECK (consent_mode = 'explicit'),
  provider_id TEXT NOT NULL CHECK (TRIM(provider_id) <> ''),
  model_id TEXT NOT NULL CHECK (TRIM(model_id) <> ''),
  routing_fingerprint TEXT NOT NULL CHECK (
    LENGTH(routing_fingerprint) = 64
    AND routing_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (
    TYPEOF(revision) = 'integer' AND revision >= 1
  ),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (
    TYPEOF(progress) = 'integer' AND progress BETWEEN 0 AND 100
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (
    TYPEOF(attempt_count) = 'integer' AND attempt_count >= 0
  ),
  active_attempt_id TEXT,
  error_code TEXT,
  error_message TEXT CHECK (
    error_message IS NULL OR LENGTH(error_message) <= 240
  ),
  valid_candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (
    TYPEOF(valid_candidate_count) = 'integer'
    AND valid_candidate_count >= 0
  ),
  discarded_candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (
    TYPEOF(discarded_candidate_count) = 'integer'
    AND discarded_candidate_count >= 0
  ),
  partial_reasons_json TEXT NOT NULL DEFAULT '[]' CHECK (
    JSON_VALID(partial_reasons_json)
    AND JSON_TYPE(partial_reasons_json) = 'array'
  ),
  requested_at TEXT NOT NULL,
  started_at TEXT,
  heartbeat_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (active_attempt_id IS NULL OR TRIM(active_attempt_id) <> ''),
  CHECK (
    (status = 'running' AND active_attempt_id IS NOT NULL)
    OR (status <> 'running' AND active_attempt_id IS NULL)
  )
);

CREATE TABLE knowledge_enrichment_attempts (
  id TEXT PRIMARY KEY CHECK (TRIM(id) <> ''),
  request_id TEXT NOT NULL CHECK (TRIM(request_id) <> ''),
  attempt_number INTEGER NOT NULL CHECK (
    TYPEOF(attempt_number) = 'integer' AND attempt_number >= 1
  ),
  started_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('running','completed','failed','cancelled','abandoned')
  ),
  error_code TEXT,
  error_message TEXT CHECK (
    error_message IS NULL OR LENGTH(error_message) <= 240
  ),
  UNIQUE(request_id, attempt_number),
  FOREIGN KEY(request_id) REFERENCES knowledge_enrichment_requests(id),
  CHECK (
    (outcome = 'running' AND finished_at IS NULL)
    OR (outcome <> 'running' AND finished_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_knowledge_enrichment_one_active_version
ON knowledge_enrichment_requests(document_version_id)
WHERE status IN ('queued','running','review_required');

CREATE INDEX idx_knowledge_enrichment_queue
ON knowledge_enrichment_requests(status, updated_at, id);

CREATE INDEX idx_knowledge_enrichment_workspace_latest
ON knowledge_enrichment_requests(
  workspace_id, document_version_id, requested_at DESC, id DESC
);

CREATE INDEX idx_knowledge_enrichment_failed_route
ON knowledge_enrichment_requests(
  workspace_id, document_version_id, status,
  provider_id, model_id, routing_fingerprint,
  requested_at DESC, id DESC
);

CREATE INDEX idx_knowledge_enrichment_attempts_request
ON knowledge_enrichment_attempts(request_id, attempt_number);

CREATE UNIQUE INDEX idx_knowledge_enrichment_one_running_attempt
ON knowledge_enrichment_attempts(request_id)
WHERE outcome = 'running';
```

Assert exact integer, fingerprint, JSON-array, active-attempt, error-length, uniqueness, foreign-key,
and terminal-attempt constraints. Assert a second running attempt for one request is rejected, while
a later attempt is permitted after the earlier attempt becomes terminal. Row mapping must validate
every `partial_reasons_json` element against `KnowledgeEnrichmentPartialReason`, reject duplicates,
and emit the centralized order (`chunk_limit`, then `candidate_limit`); malformed or unknown
persisted values throw the fixed internal state error without exposing the raw JSON/parser message.
Assert persisted rows and public summaries never contain credentials or route endpoints, and map
summary `createdAt` from request `requested_at`.

- [ ] **Step 2: Write failing transition and contention tests**

Cover all of these independently:

- create initializes `queued`, revision 1, progress 0, attempt count 0, empty counts/reasons, and no
  attempt, with `requested_at = updated_at = now`; two authorized creates for one version return the
  same active request instead of leaking a partial-index error;
- the partial unique index blocks a second `queued`, `running`, or `review_required` row;
- only the latest request for a document version participates in ordinary-create/retry handling:
  - latest `failed` plus exact workspace/document/version/provider/model/fingerprint makes ordinary
    create return that unchanged failed request, with no revision change, wake, or attempt;
  - only `retryFailedWithAuthorization` may requeue that latest failed request;
  - a route mismatch after latest failed permits a new request;
  - latest `completed`, `cancelled`, or `stale` permits a new request, so an older failed audit row
    never blocks future extraction;
  - retrying a non-latest failed request returns `enrichment_request_stale`;
- claim uses `updated_at ASC, id ASC` FIFO, atomically creates one running attempt, increments
  `attemptCount` exactly once, sets request `started_at = heartbeat_at = updated_at = now` and
  attempt `started_at = heartbeat_at = now`, and does not increment request revision;
- heartbeat changes both request and active-attempt heartbeats, accepts only integer 0-100 progress,
  makes progress monotonic nondecreasing, sets request `heartbeat_at = updated_at = now` and attempt
  `heartbeat_at = now` even when progress is unchanged, and does not increment revision;
- `completeEmpty` accepts only both candidate counts equal to zero, sets request completed/progress
  100 and attempt completed, clears active/heartbeat, sets request `updated_at = completed_at = now`
  and attempt `finished_at = now`, and preserves revision; its reasons are either empty or exactly
  `[chunk_limit]`—`candidate_limit` is invalid for a zero-candidate completion;
- failure sets request and attempt failed, preserves current progress, clears active/heartbeat, stores
  only the fixed safe message for the stable error code, sets `updated_at`, request `completed_at`,
  and attempt `finished_at` to `now`, and preserves revision and attempt count;
- cancellation is valid only for queued/running, increments revision once, and marks a running
  attempt cancelled in the same transaction; it preserves progress/counts/reasons, sets
  `updated_at/completed_at` and attempt `finished_at` to `now`, clears active/heartbeat, and leaves
  request/attempt error fields null;
- stale cancel revision returns the latest safe summary in `KnowledgeEnrichmentRevisionConflictError`;
- late heartbeat/completion/failure after cancellation or invalidation returns false and changes no
  row;
- retry increments revision once, uses its `now` as the new FIFO `updated_at`, and clears progress,
  errors, start/heartbeat/completion, candidate counts, reasons, and active attempt while retaining
  original `requested_at` and all attempt history; it creates no attempt until claimed;
- two fresh authorizations concurrently retrying the same latest failed request are idempotent: one
  transition increments revision and the loser rereads/returns that same queued, running, or
  review-required request without another increment; if another request ID becomes active, retry fails with the fixed
  `enrichment_already_active` code and never exposes a unique-constraint error;
- the transaction-neutral create/retry primitives reject calls outside a transaction, never retry a
  caller-owned poisoned snapshot, and report `queuedTransition=true` only for their own insert/requeue;
  two valid authorizations converging on one existing queued row therefore produce one true and one
  false result;
- startup changes every running attempt to `abandoned` and its request to `failed` with
  `authorization_required`; it preserves revision, progress, and attempt count, sets
  `updated_at/completed_at` and attempt `finished_at` to `now`, clears active/heartbeat, writes the
  same fixed safe code/message on request and attempt, returns the number of requests transitioned,
  and never requeues or replays, while queued requests remain queued;
- document invalidation changes only `queued`/`running`/`review_required` requests to `stale`,
  increments revision, preserves progress/counts/reasons, sets `updated_at/completed_at` and running
  attempt `finished_at` to `now`, writes fixed `enrichment_request_stale` on the request and
  lifecycle-cancelled attempt, and changes that attempt to `cancelled` first in the same transaction;
- workspace invalidation applies the same transition to every active request and leaves all terminal
  audit rows unchanged;
- `listWorkspaceSummaries` returns only the latest request for each document version using
  `requested_at DESC, id DESC`; `listLatestSummariesForVersions` does one workspace-level latest
  query (or fixed-size batches), never per-version SQL, and covers empty input, duplicate IDs,
  foreign-workspace IDs, deterministic ties, and 1,000 IDs with a statement-count assertion;
- Task 4 summaries hardcode `pendingFactCount: 0` until Task 6 adds one aggregate membership query;
- `listAttempts` preserves attempt-number ordering; workspace cleanup explicitly deletes attempts
  before requests and never relies on cascade;
- fixed safe error messages are bounded before persistence and display-safe errors contain no
  provider, fingerprint, endpoint, raw SQLite/parser text, or filesystem path.

Use a real file-backed WAL database for contention tests. Open two connections and apply
`applySqliteConnectionPolicy` to both. Use a deferred transaction plus a narrow after-select test hook
to pause connection A between candidate selection and CAS while connection B creates/claims; do not
use `BEGIN IMMEDIATE` for this interleaving because it preclaims the write lock. Assert the final
database contains exactly one active/running request, one running attempt, and `attemptCount = 1`,
with no half-written loser rows. In a separate busy-lock test, `BEGIN IMMEDIATE` may hold the writer;
add a `SQLITE_BUSY_SNAPSHOT` case proving the transaction helper retries from a fresh transaction/
snapshot rather than reusing the poisoned one.

- [ ] **Step 3: Run the tests and verify RED**

Run:

```bash
npm test -- src/main/knowledgeBase/knowledgeEnrichmentRequestStore.test.ts
```

Expected: FAIL because the store and schema are missing.

- [ ] **Step 4: Implement schema, mapping, and the active-request index**

Move the generic retry helper without altering retry counts, raw BUSY detection, or backoff. Update
all consumers: index store, index worker, index runner, index executor, document service, ingestion
service, and their tests. Move only pure helper characterization into the neutral test; retain
index-specific WAL behavior tests beside the index store. Remove the old index-store exports only
after an `rg` call-site check proves no production/test import remains. Do not leave compatibility
re-exports that preserve the wrong dependency direction. Run index worker/runner/executor, document,
ingestion, and neutral helper regression tests before implementing enrichment schema.

Create the exact request/attempt tables and indexes from Step 1. Use only centralized status,
outcome, partial-reason, and error-code values in TypeScript. Persist `progress` as an integer
percentage. Validate every mapped integer, timestamp/null shape, route fingerprint, safe error code,
and partial reason; corrupted data throws the fixed internal state error. Map public summaries via a
single safe mapper and hardcode `pendingFactCount: 0` for this task. Expose `getSummary(requestId)`
through that mapper and add a raw-row fixture containing sentinel route/error text to prove the
serialized result cannot expose it.

`listWorkspaceSummaries` must select one latest request per document version, with deterministic
`requested_at DESC, id DESC` precedence. `listLatestSummariesForVersions` must reuse one
workspace-level latest result or a fixed number of batched statements and then filter in memory; it
must not interpolate an unbounded `IN` list or execute N statements for N versions.

Put the create state-machine body in `createOrGetAuthorizedRequestInCurrentTransaction`; assert an
active caller-owned transaction and do not create another transaction or retry there. The wrapper
opens/retries the outer transaction and returns the transition's request. Within the create
transaction, first return an existing active request. Otherwise inspect only the latest audit row for
that document version. If it is failed and its full route tuple matches, return
it unchanged; if its route differs or latest status is any other terminal state, insert a new queued
request. On a concurrent partial-index conflict, reread and return the winner instead of exposing the
SQLite error. Never create or wake an attempt from this method.

- [ ] **Step 5: Implement claim and CAS terminal transitions**

Follow the proven local-index transaction shape: in a retryable transaction select one queued row by
`updated_at ASC, id ASC`, allocate the next attempt, CAS-update it to running, insert the running
attempt, then reread the claim. A lost CAS restarts from a fresh transaction; it never leaves an
attempt row. Claim updates start/heartbeat/active-attempt and increments attempt count, but not
revision; it sets request `started_at = heartbeat_at = updated_at = now` and attempt
`started_at = heartbeat_at = now`.

Heartbeat uses a request-and-attempt running predicate, updates both heartbeat columns, and writes
`MAX(current_progress, input_progress)` plus request `heartbeat_at = updated_at = now`; attempt
`heartbeat_at = now` and request `updated_at` advance even if progress does not. Completion/failure/
cancel/stale operations update attempt and request together and clear request active-attempt/heartbeat.
`completeEmpty` rejects any nonzero count and sets request `updated_at/completed_at` plus attempt
`finished_at` to `now`. `failAttempt` accepts only `SafeFailure.code` and maps it to a fixed message
no longer than `KNOWLEDGE_ENRICHMENT_SAFE_ERROR_MAX_CHARS`; it must not accept a caller-provided
message or cause.

`cancel` is one transaction and one CAS over id, expected revision, and active status. For a running
request, update its exact running attempt to cancelled first; then CAS the request to cancelled and
increment revision. Any failure rolls back both. A failed CAS rereads the request and throws either a
fixed not-found/state error or `KnowledgeEnrichmentRevisionConflictError`, whose only payload is the
latest safe summary. Resolve a failed CAS in this exact order: missing request returns
`enrichment_request_not_found`; any revision mismatch always returns the typed revision conflict even
when the latest row is now cancelled/stale; matching revision with a non-queued/non-running status
returns the fixed state error; an otherwise unchanged active row is an internal persistence failure.
Never include internal route/error fields. User cancellation preserves progress/counts/reasons,
clears active/heartbeat, writes null request/attempt errors, and sets request `updated_at/completed_at`
plus running attempt `finished_at` to `now`.

`markVersionStale` and `markWorkspaceStale` operate in one transaction per call: first cancel every
matching running attempt, then CAS only queued/running/review-required requests to stale, clear
active-attempt/heartbeat, set request `updated_at/completed_at` and attempt `finished_at`, write fixed
`enrichment_request_stale` request/attempt errors, preserve progress/counts/reasons, and increment
revision. If either update fails, roll back the whole transition. Terminal requests and terminal
attempts remain immutable.

- [ ] **Step 6: Implement authorized retry and restart recovery**

Put retry mutation in `retryFailedWithAuthorizationInCurrentTransaction` with the same caller-owned
transaction assertion and no nested retry; the wrapper owns/retries the outer transaction and returns
the transition's request. Retry only the latest failed row for its document version and require the
exact workspace/document/version/provider/model/fingerprint tuple. A non-latest failed id returns
`enrichment_request_stale`; any target or route mismatch fails closed. The retry CAS increments
revision, sets `updated_at` to the new enqueue time, and clears progress, errors, start/heartbeat/
completion, candidate counts, partial reasons, and active attempt while preserving `requested_at`
and immutable attempt history. It creates no attempt until claim.

At the start of the retry transaction, inspect the active request for the version. If it is the same
request ID with the exact target/route, a concurrent retry already won: idempotently return that
queued/running/review-required request without changing revision or attempt count. If another request ID is active,
throw fixed `enrichment_already_active`. If a partial-index race still occurs, roll back and reread
the winner in a fresh transaction; return only the same exact request or the fixed active error, and
never leak `SQLITE_CONSTRAINT`.

Restart recovery updates every running attempt to abandoned and its request to failed with the fixed
`authorization_required` code/message in the same transaction. It preserves request revision,
progress, and attempt count; sets request `updated_at/completed_at` and attempt `finished_at` to
`now`; clears active/heartbeat; returns the successfully transitioned request count; never uses a
heartbeat threshold; never requeues running work; and leaves queued work unchanged.

`deleteWorkspaceRequests` runs one explicit transaction: delete attempts whose parent belongs to the
workspace, then delete requests. Do not rely on cascade. Its contract states that Task 11 must first
clear future request-fact membership rows; expose `listAttempts` so retention can be verified without
test-only raw SQL.

- [ ] **Step 7: Verify GREEN, two-connection behavior, and review**

Run the targeted request and neutral retry tests repeatedly under real file-backed WAL connections,
including the controlled two-connection create/claim race, a Task 7-shaped caller-owned outer
authorization transaction, and `SQLITE_BUSY_SNAPSHOT` whole-transaction fresh-snapshot case. Also
run index store/worker/runner/executor, document, and ingestion retry regressions,
changed-file ESLint, Electron compilation, and `git diff --check`. Finish with `rg` proving no old
generic-helper imports/re-exports remain. Do not stage or commit; generate the review package.

---

### Task 5: Build the Strict Prompt and Candidate Validator

**Files:**

- Create: `src/main/knowledgeBase/knowledgeEnrichmentCandidateValidator.ts`
- Create: `src/main/knowledgeBase/knowledgeEnrichmentCandidateValidator.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeEnrichmentTypes.ts`

**Interfaces:**

- Lock these main-internal types in `knowledgeEnrichmentTypes.ts`:

```ts
interface KnowledgeEnrichmentChunkInput {
  id: string;
  ordinal: number;
  content: string;
}

interface KnowledgeEnrichmentPrompt {
  systemPrompt: string;
  prompt: string;
}

interface ValidateKnowledgeEnrichmentResponseInput {
  responseText: string;
  chunk: KnowledgeEnrichmentChunkInput;
}

interface KnowledgeEnrichmentValidatedCandidate {
  domain: KnowledgeFactDomain;
  value: string;
  normalizedValue: string;
  chunkId: string;
  chunkOrdinal: number;
  quote: string;
  normalizedQuote: string;
  confidence: number;
}

interface KnowledgeEnrichmentResponseValidationResult {
  parsedCandidateCount: number;
  discardedCandidateCount: number;
  candidates: readonly KnowledgeEnrichmentValidatedCandidate[];
}

interface KnowledgeEnrichmentSelectedEvidence {
  chunkId: string;
  chunkOrdinal: number;
  quote: string;
  normalizedQuote: string;
  confidence: number;
}

interface KnowledgeEnrichmentPublicationCandidate {
  domain: KnowledgeFactDomain;
  value: string;
  normalizedValue: string;
  evidence: readonly KnowledgeEnrichmentSelectedEvidence[];
}

interface SelectKnowledgeEnrichmentCandidatesInput {
  responses: readonly KnowledgeEnrichmentResponseValidationResult[];
  totalIndexedChunkCount: number;
}

interface KnowledgeEnrichmentCandidateSelection {
  candidates: readonly KnowledgeEnrichmentPublicationCandidate[];
  parsedCandidateCount: number;
  validCandidateCount: number;
  discardedCandidateCount: number;
  partialReasons: readonly KnowledgeEnrichmentPartialReason[];
}

type KnowledgeEnrichmentValidationErrorCode =
  | typeof KnowledgeBaseErrorCode.InvalidModelResponse
  | typeof KnowledgeBaseErrorCode.EvidenceValidationFailed;
```

- Produces these exact signatures:

```ts
buildKnowledgeEnrichmentPrompt(
  chunk: KnowledgeEnrichmentChunkInput,
): KnowledgeEnrichmentPrompt;
normalizeKnowledgeEvidenceQuote(value: string): string;
validateKnowledgeEnrichmentResponse(
  input: ValidateKnowledgeEnrichmentResponseInput,
): KnowledgeEnrichmentResponseValidationResult;
selectKnowledgeEnrichmentCandidates(
  input: SelectKnowledgeEnrichmentCandidatesInput,
): KnowledgeEnrichmentCandidateSelection;
```

- Produces `KnowledgeEnrichmentValidationError` with only the typed code, a fixed generic message,
  and a safe `{ code, message }` JSON form. It has no cause, response, prompt, parsed candidate, or
  model/provider metadata.

- [ ] **Step 1: Write failing prompt-boundary tests**

Assert the system prompt states that document text is untrusted evidence; forbids following document
instructions, tool calls, permission/system-prompt/workspace-rule changes; lists only the ten domains;
and requests strict JSON. Assert the user prompt contains only opaque logical chunk ID plus bounded
chunk content and contains no path, provider config, credential, unrelated workspace text, storage
ID, or index-generation ID.

The system prompt is one static byte-identical string. The user prompt is exactly
`JSON.stringify({ chunkId: chunk.id, content: chunk.content })`; trusted `ordinal` is used only for
selection order and never sent to the model. Reject an empty ID/content, a non-safe/non-negative
integer ordinal, or `content.length > KNOWLEDGE_CHUNK_TARGET_CHARS` before building either prompt.
Test that malicious instructions change only the escaped JSON user message while the system prompt
remains byte-identical.

- [ ] **Step 2: Write failing strict-envelope and candidate tests**

Test that only a direct non-array JSON object whose own enumerable keys are exactly `facts` and whose
value is an array is accepted. Extra root keys, code fences, leading/trailing prose, arrays, null,
missing/non-array facts, and non-JSON fail the whole response with `invalid_model_response`.

For each fact, require exactly these semantic fields:

```ts
{
  domain: KnowledgeFactDomain;
  value: string;
  chunkId: string;
  quote: string;
  confidence: number;
}
```

Each candidate must be a non-array object whose own keys are exactly those five names. Extra/missing
keys, null, and array candidates are invalid individual candidates. `chunkId` must byte-equal this
call's exact `input.chunk.id`—never trim or normalize it—and output must use the trusted input ID and
ordinal, so one response cannot claim another request chunk.

Normalize fact values only through Task 1's `normalizeEnterpriseKnowledgeValue`; require non-empty
`displayValue` and `normalizedValue`, and apply the 2,000-character bound to `displayValue.length`
using JavaScript UTF-16 code units. Define evidence comparison separately:

```ts
normalizeKnowledgeEvidenceQuote(value) =
  value.normalize('NFKC').replace(/\s+/g, ' ').trim();
```

Require the trimmed display quote and normalized quote to be non-empty; apply the 1,000-character
bound to trimmed display quote `.length`; and accept ownership only when
`normalizeKnowledgeEvidenceQuote(input.chunk.content).includes(normalizedQuote)`. Do not lowercase, remove
punctuation, strip zero-width characters, or reuse the fact normalizer for quotes.
Set validated output `value = displayValue` and `quote = trimmedDisplayQuote`; never return the
pre-trim model strings. Test leading/trailing whitespace on both fields and assert only bounded,
trimmed display text reaches the validation result.

Invalid individual candidates are discarded when the envelope is valid. Test: every structural
case above; unknown domain; empty/overlong value; foreign chunk; empty/overlong quote;
non-finite/out-of-range confidence; NFKC and whitespace-equivalent ownership; case, punctuation, and
zero-width mismatches; exact length boundary and one code unit over; and quote not present.

Lock the three empty/invalid outcomes separately: raw `facts.length === 0` is a valid empty result;
`facts.length > 0` with at least one valid candidate publishes the valid subset and counts the rest
as discarded; `facts.length > 0` with zero valid candidates fails the whole response with
`evidence_validation_failed` and must not be reported as “no knowledge found.”

`KnowledgeEnrichmentValidationError` maps parse/root/envelope errors to `invalid_model_response` and
the nonempty-wholly-invalid case to `evidence_validation_failed`. Its two fixed messages are
`Knowledge enrichment response was invalid` and
`Knowledge enrichment evidence validation failed`; it has no cause or raw fields. Assert
`String(error)`, `JSON.stringify(error)`, validation results, and selection results do not contain a
secret response sentinel or keys named `responseText`, `raw`, `prompt`, or `systemPrompt`.

- [ ] **Step 3: Write failing deterministic-limit tests**

Accept at most 30 response groups and require `totalIndexedChunkCount` to be a non-negative safe
integer not smaller than the number of groups. Within each response, first merge exact evidence
identity `(domain, normalizedValue, chunkId, normalizedQuote)` and retain the comparator-first item;
an exact duplicate is neither published twice nor counted discarded. The same normalized fact with
a different chunk or normalized quote remains independent evidence.

Before sorting, validate the trusted chunk identity globally across all surviving candidates:
`chunkOrdinal → chunkId` and `chunkId → chunkOrdinal` must each be one-to-one. Repeating the same exact
pair is valid; either conflicting mapping fails closed with typed `invalid_model_response`. Add
reversed/shuffled collision tests. This admissibility invariant makes the comparator below a true
total order without letting opaque chunk IDs influence normal business ordering.

Use this total comparator everywhere: `confidence DESC`, trusted `chunkOrdinal ASC`, explicit
ten-domain whitelist rank, `normalizedValue`, `normalizedQuote`, `value`, then `quote`. Compare
strings with `<`/`>` code-unit order, never locale-sensitive `localeCompare`. Sort each response and
retain at most 50 distinct evidence candidates. Every valid distinct candidate beyond 50 increments
discarded once and sets `candidate_limit`, even when another evidence item keeps the same fact; this
hard-bounds final evidence to `30 * 50`.

After per-response caps, merge any exact evidence identity repeated across response groups and keep
the comparator-first item without incrementing discarded. Then merge surviving evidence into fact
groups keyed by `(domain, normalizedValue)`. The comparator-first item is the representative and
supplies the display `value`; keep all surviving distinct evidence for a selected group in comparator
order. Sort groups by their representative and retain at most 200 groups. Every surviving evidence
candidate in an omitted group increments discarded once and sets `candidate_limit`.

Define `validCandidateCount` as the final selected fact-group count. Define
`discardedCandidateCount` as invalid individual count plus per-call omitted distinct evidence plus
request-cap omitted evidence, with no candidate counted twice and final
`Math.min(sum, total parsedCandidateCount)`. Exact duplicates collapsed before caps do not increment
discarded. Return `parsedCandidateCount` as the safe-integer sum of every response's raw facts-array
length so publication can revalidate the bounded counts without retaining raw responses. Set
`chunk_limit` exactly when `totalIndexedChunkCount > 30`. Emit partial reasons only in central order:
`chunk_limit`, then `candidate_limit`.

Test 50/51 per-call and 200/201 group boundaries; one fact with two distinct quotes; 51 distinct
evidence rows for one fact; exact duplicate quote collapse; a per-call-omitted evidence whose fact is
still selected through another evidence; all comparator tie-breakers; reversed/shuffled inputs
producing byte-identical output; no double count; discarded never exceeding parsed total; and the
hard evidence-row bound.

- [ ] **Step 4: Run tests and verify RED**

Run:

```bash
npm test -- src/main/knowledgeBase/knowledgeEnrichmentCandidateValidator.test.ts
```

Expected: FAIL because the pure module is missing.

- [ ] **Step 5: Implement strict parsing and normalized evidence validation**

Call `JSON.parse(responseText.trim())` directly; do not call `parseModelJsonObject`. Normalize only
for comparisons and keep bounded display text. Catch every parser exception and replace it with the
typed fixed `invalid_model_response` error; never attach the `SyntaxError`. Bind validation only to
the exact safe `KnowledgeEnrichmentChunkInput`, never to a complete persistence chunk, so storage/
generation identities cannot enter output. Throw typed `evidence_validation_failed` when a non-empty
`facts` array yields no valid candidates; preserve partial publication only for a mixed valid/invalid
array. Neither the validator nor selector returns the response or prompts.

- [ ] **Step 6: Implement deterministic selection and verify GREEN**

Run the targeted test, changed-file ESLint, and `git diff --check`. Add a test whose document text
contains malicious instructions and prove it is passed only as user evidence, not interpreted by
the validator. Do not stage or commit; generate the review package.

---

### Task 6: Atomically Publish Facts, Evidence, Membership, and Safe Queries

**Files:**

- Create: `src/main/knowledgeBase/knowledgeFactStore.ts`
- Create: `src/main/knowledgeBase/knowledgeFactStore.test.ts`
- Create: `src/main/knowledgeBase/knowledgeFactQueryService.ts`
- Create: `src/main/knowledgeBase/knowledgeFactQueryService.test.ts`
- Create: `src/main/knowledgeBase/knowledgeEnrichmentPublicationStore.ts`
- Create: `src/main/knowledgeBase/knowledgeEnrichmentPublicationStore.test.ts`
- Modify: `src/shared/knowledgeBase/constants.ts`
- Modify: `src/shared/knowledgeBase/types.ts`
- Modify: `src/shared/knowledgeBase/contracts.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeEnrichmentRequestStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeEnrichmentRequestStore.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeEnrichmentTypes.ts`

**Interfaces:**

- `KnowledgeEnrichmentPublicationStore.publishValidatedCandidates(input)` owns the single outer
  transaction spanning facts, evidence, request membership, request terminal status, and attempt
  terminal outcome.
- Lock these main-internal types in `knowledgeEnrichmentTypes.ts`; `KnowledgeFact` and
  `KnowledgeFactEvidence` mirror every column from Step 1 exactly:

```ts
interface KnowledgeFact {
  id: string;
  originatingRequestId: string | null;
  workspaceId: string;
  domain: KnowledgeFactDomain;
  value: string;
  normalizedValue: string;
  reviewStatus: KnowledgeFactReviewStatus;
  sourceKind: KnowledgeFactSourceKind;
  revision: number;
  conflictGroupKey: string | null;
  projectionState: KnowledgeFactProjectionState;
  createdAt: string;
  reviewedAt: string | null;
  updatedAt: string;
  tombstonedAt: string | null;
}

interface KnowledgeFactEvidence {
  id: string;
  workspaceId: string;
  factId: string;
  requestId: string;
  documentId: string;
  documentVersionId: string;
  chunkId: string;
  quote: string;
  confidence: number;
  extractorProviderId: string;
  extractorModelId: string;
  createdAt: string;
  staleAt: string | null;
}

interface PublishValidatedCandidatesInput {
  requestId: string;
  attemptId: string;
  expectedPublishedGenerationId: string;
  expectedIndexedChunkCount: number;
  selection: KnowledgeEnrichmentCandidateSelection;
  now?: string;
}

interface KnowledgeEnrichmentPublicationResult {
  summary: KnowledgeEnrichmentSummary;
  factIds: readonly string[];
}

interface FinalizeKnowledgeEnrichmentPublicationInput {
  requestId: string;
  attemptId: string;
  status:
    | typeof KnowledgeEnrichmentStatus.ReviewRequired
    | typeof KnowledgeEnrichmentStatus.Completed;
  validCandidateCount: number;
  discardedCandidateCount: number;
  partialReasons: readonly KnowledgeEnrichmentPartialReason[];
  now: string;
}

interface KnowledgeEvidenceStaleResult {
  staleEvidenceCount: number;
  revisedFactCount: number;
  completedRequestCount: number;
}

interface KnowledgeFactCleanupResult {
  deletedMembershipCount: number;
  deletedEvidenceCount: number;
  deletedFactCount: number;
}
```

- `KnowledgeEnrichmentPublicationStoreOptions` injects a synchronous
  `loadWorkspaceRouteSourceInCurrentTransaction(db, workspaceId)` bound to the same connection, an
  optional pure `resolveExactRouteFromSource(source, requestRoute)` callback, UUID factory, clock,
  and stage fault hook. It must not accept a preconstructed resolver whose private workspace getter
  could use another connection. The default creates/uses the strict Task 2 resolver only against the
  already-loaded source (and Task 7 later delegates to its pure source entry). The loader is
  invoked only while `db.inTransaction` and returns only the workspace route source; no async or
  second-connection lookup is permitted.

  The stage hook includes `after_revalidation_before_first_write` in addition to fact/evidence/
  membership/finalization stages. WAL tests pause at that exact seam so connection B can cancel,
  delete, replace version, invalidate index, or change route; connection A must receive/retry the
  whole `SQLITE_BUSY_SNAPSHOT` transaction and re-run every validation.
- `KnowledgeFactStore` produces transaction-neutral fact/evidence/membership primitives for the
  publication coordinator and these lifecycle methods:

```ts
markVersionEvidenceStale(
  documentVersionId: string,
  now?: string,
): KnowledgeEvidenceStaleResult;
markVersionEvidenceStaleInCurrentTransaction(
  documentVersionId: string,
  now: string,
): KnowledgeEvidenceStaleResult;
recalculateLinkedRequests(factId: string, now?: string): number;
recalculateLinkedRequestsInCurrentTransaction(factId: string, now: string): number;
deleteWorkspaceFactsInCurrentTransaction(
  workspaceId: string,
): KnowledgeFactCleanupResult;
```

- Task 6 adds transaction-neutral request-store primitives used only under the publication/fact
  outer transaction: lease read, publication finalization, linked-request completion, and safe
  summary mapping with membership aggregation. These primitives assert `db.inTransaction` and never
  start their own transaction or BUSY retry. In particular:

```ts
getRunningLeaseInCurrentTransaction(
  requestId: string,
  attemptId: string,
): KnowledgeEnrichmentClaim | null;
finalizePublicationInCurrentTransaction(
  input: FinalizeKnowledgeEnrichmentPublicationInput,
  afterAttemptFinalized?: () => void,
): KnowledgeEnrichmentRequest | null;
getSummaryInCurrentTransaction(requestId: string): KnowledgeEnrichmentSummary | null;
completeReviewRequiredRequestsInCurrentTransaction(
  requestIds: readonly string[],
  now: string,
): number;
markVersionStaleInCurrentTransaction(documentVersionId: string, now: string): number;
markWorkspaceStaleInCurrentTransaction(workspaceId: string, now: string): number;
```

The fact store's set-based recalculation may call a request-store completion primitive, but it passes
only normalized, deduplicated stable IDs/timestamps and the request store owns request
status/timestamp mutation. Linked completion uses one set-based UPDATE (for example one `json_each`
array parameter), never one call/query per request. Public Task 4 stale wrappers own their outer
transaction/retry and delegate to the new `...InCurrentTransaction` forms; callers already inside a
lifecycle transaction use only the neutral forms.

`finalizePublicationInCurrentTransaction` owns both terminal writes. It invokes the optional internal
`afterAttemptFinalized` callback exactly after the attempt CAS and before the request CAS; production
publication passes its stage-fault hook through this seam. Any callback exception escapes to the one
outer transaction and rolls back both rows. The callback is main-internal/test-only, never persisted,
serialized, logged, awaited, or exposed through IPC.
- `KnowledgeFactQueryService` produces display-safe query operations:

```ts
interface KnowledgeFactEvidencePageRequest {
  factId: string;
  expectedRevision: number;
  cursor?: string;
  limit?: number;
}

interface KnowledgeFactEvidencePageResult {
  factId: string;
  factRevision: number;
  items: KnowledgeFactEvidenceSummary[];
  nextCursor: string | null;
}

listFacts(input: KnowledgeListFactsRequest): KnowledgeFactListResult;
getFactEvidence(input: KnowledgeFactEvidencePageRequest): KnowledgeFactEvidencePageResult;
```

`KnowledgeFactListResult.items` and its cursor contain only real normalized `knowledge_facts` rows.
Legacy Profile-only values remain separate read-only compatibility rows composed by Plan 3 from an
already loaded `workspace.profile`; they never receive synthetic fact IDs/revisions/timestamps,
never enter `getFactEvidence`, review, or archive calls, and never affect normalized pagination.
Task 6 reads only the workspace `profile` JSON (and `updated_at` if needed for diagnostics) to compute
legacy metrics—never the full workspace, settings, sources, paths, or provider data.

Produce fixed-message, no-stack/no-cause `KnowledgeFactStateError` and
`KnowledgeEnrichmentPublicationError` carrying only allowlisted `KnowledgeBaseErrorCode` values.
They do not attach enumerable `stack`/`cause`, and their JSON form contains only stable code/message.
Constraint/parser/route-loader exceptions are translated at the boundary; state/publication error
JSON never contains SQL, paths, chunks, quotes, provider IDs, fingerprints, Profile JSON, or raw
candidates. Fact/evidence DTOs may expose only their explicitly declared, bounded `quote` preview or
full-evidence field; no other raw text is allowed.
Map invalid selection, foreign/missing chunk, ordinal, or quote ownership to
`evidence_validation_failed`; lost request/document/version/index lifecycle ownership to
`enrichment_request_stale`; missing current route to
`model_configuration_unavailable`, route tuple/fingerprint change to `model_configuration_changed`,
newly unsupported current provider to `unsupported_model_provider`, and SQLite/fault persistence to
`enrichment_persistence_failed`. Task 7 treats stale/lost lease as a late-result discard, but safely
fails a still-owned attempt for the other stable codes.

- [ ] **Step 1: Write failing facts/evidence schema tests**

Lock the logical schema below; implementation may vary only whitespace and idempotent
`IF NOT EXISTS` clauses:

```sql
CREATE TABLE knowledge_facts (
  id TEXT PRIMARY KEY CHECK (TRIM(id) <> ''),
  originating_request_id TEXT,
  workspace_id TEXT NOT NULL CHECK (TRIM(workspace_id) <> ''),
  domain TEXT NOT NULL CHECK (domain IN (
    'companySummary','productList','productCapabilities','targetCustomers',
    'applicationScenarios','sellingPoints','channelPreferences',
    'prohibitedClaims','contactRules','missingInfo'
  )),
  value TEXT NOT NULL CHECK (TRIM(value) <> '' AND LENGTH(value) <= 2000),
  normalized_value TEXT NOT NULL CHECK (TRIM(normalized_value) <> ''),
  review_status TEXT NOT NULL CHECK (
    review_status IN ('pending','confirmed','rejected')
  ),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('extracted','manual','imported')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (
    TYPEOF(revision) = 'integer' AND revision >= 1
  ),
  conflict_group_key TEXT CHECK (
    conflict_group_key IS NULL OR TRIM(conflict_group_key) <> ''
  ),
  projection_state TEXT NOT NULL DEFAULT 'none' CHECK (
    projection_state IN ('none','active','conflict','reversed')
  ),
  created_at TEXT NOT NULL CHECK (TRIM(created_at) <> ''),
  reviewed_at TEXT,
  updated_at TEXT NOT NULL CHECK (TRIM(updated_at) <> ''),
  tombstoned_at TEXT,
  FOREIGN KEY(originating_request_id) REFERENCES knowledge_enrichment_requests(id),
  CHECK (source_kind <> 'extracted' OR originating_request_id IS NOT NULL)
);

CREATE TABLE knowledge_fact_evidence (
  id TEXT PRIMARY KEY CHECK (
    LENGTH(id) = 64 AND id NOT GLOB '*[^0-9a-f]*'
  ),
  workspace_id TEXT NOT NULL CHECK (TRIM(workspace_id) <> ''),
  fact_id TEXT NOT NULL CHECK (TRIM(fact_id) <> ''),
  request_id TEXT NOT NULL CHECK (TRIM(request_id) <> ''),
  document_id TEXT NOT NULL CHECK (TRIM(document_id) <> ''),
  document_version_id TEXT NOT NULL CHECK (TRIM(document_version_id) <> ''),
  chunk_id TEXT NOT NULL CHECK (TRIM(chunk_id) <> ''),
  quote TEXT NOT NULL CHECK (TRIM(quote) <> '' AND LENGTH(quote) <= 1000),
  confidence REAL NOT NULL CHECK (
    TYPEOF(confidence) IN ('integer','real') AND confidence BETWEEN 0 AND 1
  ),
  extractor_provider_id TEXT NOT NULL CHECK (TRIM(extractor_provider_id) <> ''),
  extractor_model_id TEXT NOT NULL CHECK (TRIM(extractor_model_id) <> ''),
  created_at TEXT NOT NULL CHECK (TRIM(created_at) <> ''),
  stale_at TEXT,
  FOREIGN KEY(fact_id) REFERENCES knowledge_facts(id),
  FOREIGN KEY(request_id) REFERENCES knowledge_enrichment_requests(id),
  FOREIGN KEY(document_id) REFERENCES knowledge_documents(id),
  FOREIGN KEY(document_version_id) REFERENCES knowledge_document_versions(id)
);

CREATE TABLE knowledge_enrichment_request_facts (
  request_id TEXT NOT NULL CHECK (TRIM(request_id) <> ''),
  fact_id TEXT NOT NULL CHECK (TRIM(fact_id) <> ''),
  PRIMARY KEY(request_id, fact_id),
  FOREIGN KEY(request_id) REFERENCES knowledge_enrichment_requests(id),
  FOREIGN KEY(fact_id) REFERENCES knowledge_facts(id)
);

CREATE UNIQUE INDEX idx_knowledge_facts_active_value
ON knowledge_facts(workspace_id, domain, normalized_value)
WHERE tombstoned_at IS NULL AND review_status IN ('pending', 'confirmed');

CREATE INDEX idx_knowledge_facts_workspace_page
ON knowledge_facts(workspace_id, updated_at DESC, id DESC);

CREATE INDEX idx_knowledge_facts_workspace_metrics
ON knowledge_facts(
  workspace_id, review_status, tombstoned_at, domain, normalized_value
);

CREATE INDEX idx_knowledge_fact_evidence_fact_state
ON knowledge_fact_evidence(
  fact_id, stale_at, confidence DESC, created_at, id
);

CREATE INDEX idx_knowledge_fact_evidence_fact_page
ON knowledge_fact_evidence(
  fact_id,
  (stale_at IS NOT NULL) ASC,
  confidence DESC,
  created_at ASC,
  id ASC
);

CREATE INDEX idx_knowledge_fact_evidence_version_state
ON knowledge_fact_evidence(document_version_id, stale_at, fact_id);

CREATE INDEX idx_knowledge_fact_evidence_workspace
ON knowledge_fact_evidence(workspace_id, fact_id, id);

CREATE INDEX idx_knowledge_fact_evidence_request
ON knowledge_fact_evidence(request_id, fact_id, id);

CREATE INDEX idx_knowledge_enrichment_request_facts_fact
ON knowledge_enrichment_request_facts(fact_id, request_id);
```

The deliberate absence of a chunk foreign key lets index generations be removed while evidence audit
survives; publication still validates logical chunks against the currently published generation.
Assert exact enum/integer/length/null/FK/partial-unique constraints and all indexes. Evidence stores
logical `chunk_id`, never `storage_id` or `index_generation_id`, and enforces confidence 0–1.
Fact/evidence mappers validate canonical timestamps/nulls, enums, safe integers, fixed lengths, and
fact normalization; `normalized_value` is recomputed and must match byte-for-byte. Do not impose the
display-value 2,000-code-unit SQL bound on normalized text because Unicode lowercase may expand
(`İ` → `i̇`); test a legal 2,000-code-unit expanding value. Corrupt rows throw a fixed state error
without raw SQLite/parser text.

- [ ] **Step 2: Write failing atomic-publication tests**

Cover:

- valid new candidates create pending facts, evidence, and membership;
- matching pending/confirmed active facts gain evidence without a duplicate visible fact; preserve
  existing value/origin/review/projection state, insert membership for every request, and increment
  existing fact revision/updatedAt exactly once only when at least one new evidence row is inserted;
- matching confirmed fact is not reopened for review; rejected or tombstoned identity is never a
  deduplication target; new facts are random persistent IDs at revision 1, pending/extracted/none;
- zero candidates completes the request only with `parsed=valid=discarded=0` and reasons empty or
  `[chunk_limit]`;
- any reviewable pending fact produces `review_required`;
- validate `candidates.length === validCandidateCount`, `0..200` valid facts, safe parsed/discarded
  counts, at least one evidence per nonempty candidate, at most `30*50` total evidence, canonical
  partial reasons, and Task 5 normalized value/quote integrity; with `selectedEvidenceCount` equal to
  the sum of publication evidence rows, require
  `selectedEvidenceCount >= validCandidateCount`, `discardedCandidateCount <= parsedCandidateCount`,
  and `selectedEvidenceCount + discardedCandidateCount <= parsedCandidateCount`;
- fault injection after fact, evidence, membership, attempt-finalize, or request-finalize rolls back
  all rows and leaves the original request/attempt running;
- cancellation, deletion, version replacement, unindexed target, foreign chunk, or stale attempt
  rejects the entire publication;
- provider/model/API-key rotation after the final model call but before commit fails current-route
  revalidation and publishes no row;
- final request/attempt candidate counts and partial reasons are atomic with facts;
- raw response and prompt never appear in any persisted text column.

Lock finalization: attempt CAS uses exact `id + request_id + outcome=running`, sets outcome completed,
`finished_at=now`, and keeps errors null. Request CAS uses exact
`id + status=running + active_attempt_id`, writes progress 100/counts/reasons, clears active attempt,
heartbeat and errors, and preserves revision. If any linked fact satisfies the shared reviewable
predicate, request becomes `review_required`, `updated_at=now`, and `completed_at=NULL`; otherwise it
becomes `completed` with `updated_at=completed_at=now`. Any affected-row count other than one rolls
back the whole transaction.

Use real two-connection WAL interleavings for cancel, document deletion/version replacement, index
invalidation, and route change between publication read and write. A BUSY snapshot restarts the
entire outer transaction and revalidates every condition; no inner savepoint/retry may reuse the old
snapshot.

- [ ] **Step 3: Write failing cursor, metrics, and evidence-query tests**

Use one shared `reviewablePending` predicate everywhere:

```text
fact.review_status = pending
AND fact.tombstoned_at IS NULL
AND EXISTS evidence for fact WHERE stale_at IS NULL
```

Active view is non-tombstoned confirmed facts (including stale-only confirmed) plus
`reviewablePending`. History view is the complement: rejected, tombstoned, and non-tombstoned pending
with no active evidence. Optional review-status filters intersect the chosen view.
`evidenceState=active` means at least one active evidence; `stale` means at least one stale evidence
(a mixed fact may match both); `any` adds no evidence predicate.
Default view is `active` and default evidence state is `any`.

Lock the opaque fact-list cursor to strict base64url JSON with exactly
`{ v: 1, updatedAt: canonicalIsoTimestamp, id: nonEmptyString }`. Reject extra/missing keys, invalid
base64/JSON, noncanonical time, empty ID, token length over 2,048, or any limit for which
`!Number.isSafeInteger(limit) || limit < 1 || limit > 100` with fixed `invalid_request`; tests must
include negative integers such as `-1` and `-5` so SQLite's `LIMIT -N` unlimited behavior cannot
bypass the hard maximum. Query by:

```sql
updated_at < ? OR (updated_at = ? AND id < ?)
ORDER BY updated_at DESC, id DESC
LIMIT limit + 1
```

Default limit is 50. A normalized list row contains one preview at most, chosen with active evidence
first, then `confidence DESC, created_at ASC, id ASC`; quote is sliced to 240 JavaScript UTF-16 code
units.

Full evidence is returned only through bounded keyset pages from `getFactEvidence`. Export shared
constants `KNOWLEDGE_FACT_EVIDENCE_PAGE_DEFAULT_LIMIT = 50` and
`KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT = 100`. Reject any evidence-page limit for which
`!Number.isSafeInteger(limit) || limit < 1 || limit > 100` with fixed `invalid_request`; include
negative, fractional, zero, unsafe-integer, and over-maximum tests. Require `expectedRevision` to be
a safe positive integer.

Lock the opaque evidence cursor to strict base64url JSON with exactly
`{ v: 1, factId: nonEmptyString, factRevision: safePositiveInteger, stale: boolean,
confidence: finiteNumberBetweenZeroAndOne, createdAt: canonicalIsoTimestamp,
id: 64LowercaseHexEvidenceId }`. Reject extra/missing keys, invalid/canonicality-changing
base64 or UTF-8/JSON, token length over 2,048, noncanonical timestamps, invalid numeric values,
or a cursor whose `factId`/`factRevision` differs from the request's
`factId`/`expectedRevision`. The encoder writes fields in the exact order
`v,factId,factRevision,stale,confidence,createdAt,id`; after type/value validation the decoder
re-encodes the parsed object and requires byte-identical base64url. Reject duplicate keys, key-order
or whitespace variants, equivalent escape spellings, `-0`, and exponent-form numbers.

The first and every later page queries the owner fact by exact `factId + expectedRevision` in the
same statement. Missing/deleted fact or revision mismatch returns fixed `job_state_conflict`.
Every result echoes the observed `factId` and `factRevision`, including an empty final/first page;
the consumer verifies both before replacing or appending items. The cursor also binds every later
page to that revision, so any mutation discards accumulated evidence and restarts from page one.

Evidence order is exactly active before stale, then `confidence DESC, created_at ASC, id ASC`.
After a cursor, query by the lexicographic continuation of:

```sql
WHERE
  (stale_at IS NOT NULL) > @stale
  OR (
    (stale_at IS NOT NULL) = @stale
    AND (
      confidence < @confidence
      OR (
        confidence = @confidence
        AND (
          created_at > @createdAt
          OR (created_at = @createdAt AND id > @id)
        )
      )
    )
  )
ORDER BY
  (stale_at IS NOT NULL) ASC,
  confidence DESC,
  created_at ASC,
  id ASC
```

Bind `@stale` explicitly as integer `0` or `1` and use `LIMIT limit + 1`. The exact order expression
must use `idx_knowledge_fact_evidence_fact_page` without a temporary sort. Each result contains at
most `limit` full-evidence DTOs and derives
`nextCursor` from the last returned row only when another row exists. Tests page across active/stale
boundaries and complete ordering ties without duplicate or omitted IDs, prove 50/100 bounds, reject
cross-fact and stale-revision cursors, and show a fact revision change between pages fails closed.
`listFacts` uses at most four fixed SQL statements (page, page-scoped preview/count aggregation,
full-workspace fact metrics, Profile-only legacy metric input), each `getFactEvidence` page uses one
statement, and request-summary projection uses one statement—never one statement per
fact/request/evidence row.

Metrics ignore cursor, page size, view, and filters and use exactly:

```text
activePendingCount = non-tombstoned pending with active evidence
staleConfirmedCount = non-tombstoned confirmed with zero active and >=1 stale evidence
activeConfirmedCount = every other non-tombstoned confirmed fact
  (active evidence or zero evidence, including future manual/imported normalized facts)
rejectedHistoryCount = non-tombstoned rejected
archivedHistoryCount = all tombstoned facts
unduplicatedLegacyConfirmedCount = non-empty Profile domain/value identities,
  Task1-normalized and self-deduplicated, minus non-tombstoned confirmed fact identities
totalAiKnowledgeCount = activePendingCount + activeConfirmedCount + staleConfirmedCount
  + unduplicatedLegacyConfirmedCount
```

Pending/rejected/tombstoned facts do not suppress a legacy Profile identity. Query only the Profile
JSON column, validate its ten fields fail-closed, and never expose full workspace/settings. Assert
legacy values affect metrics but never `items` or `nextCursor`; pending normalized facts never use
Profile as storage. Add a confirmed manual/imported normalized fact with zero evidence and assert it
is visible in Active view, counted in `activeConfirmedCount` and total, and not stale-confirmed.

Replace Task 4's hardcoded pending count with `COUNT(DISTINCT membership.fact_id)` using the exact
shared `reviewablePending` predicate. Apply it to workspace latest lists, version maps,
revision-conflict/latest-summary mapping, and publication results in one aggregate query. Cover
multiple requests, shared facts, multiple evidence rows (no overcount), rejected/confirmed/
tombstoned/stale-only facts, and 1,000 summaries with one statement.

- [ ] **Step 4: Run tests and verify RED**

Run:

```bash
npm test -- src/main/knowledgeBase/knowledgeFactStore.test.ts \
  src/main/knowledgeBase/knowledgeFactQueryService.test.ts \
  src/main/knowledgeBase/knowledgeEnrichmentPublicationStore.test.ts \
  src/main/knowledgeBase/knowledgeEnrichmentRequestStore.test.ts
```

Expected: FAIL because the fact store, query service, and publication store are missing.

- [ ] **Step 5: Implement schema and publication coordinator**

`publishValidatedCandidates` is the only
`runTransientSqliteWriteTransaction(db.transaction(...))` boundary. Fact/evidence/membership and
request finalization methods called beneath it are `...InCurrentTransaction` primitives with no
nested BUSY retry; a BUSY snapshot restarts the complete outer callback.

Initialization order is request store first, then fact store/schema, then publication/query services;
Task 6 updates request-store fixtures accordingly before any membership-aware summary query. Task 11
uses the same order in production composition.

Before the first write, using that same connection and snapshot, synchronously revalidate: workspace
exists; document belongs to it, is not deleted, and still points to the exact request version;
version belongs to document; index state is `indexed` with a published generation; request is exact
running lease with active attempt; attempt is running; and the Task 2 strict current workspace route
resolves to the request's provider/model/fingerprint. Reduce the route immediately to
`KnowledgeEnrichmentRouteReference`; never persist, return, or log credentials/intermediate digests.
The current published generation ID and persisted indexed `chunk_count` must equal
`expectedPublishedGenerationId` and `expectedIndexedChunkCount` from the publication input in this
same transaction; mismatch maps to fixed `enrichment_request_stale` and writes no durable result.

Collect every distinct evidence chunk ID first; if the count exceeds 30, reject with
`evidence_validation_failed`—never truncate or `slice`. Validate all distinct IDs in one query against
the current published generation. Every trusted ordinal must match, and the Task 5 exported
`normalizeKnowledgeEvidenceQuote` must reproduce each supplied normalized quote and still find it in
current chunk content. Route unavailability/change, foreign/missing chunk, deleted/replaced document,
invalid index, or lost lease throws a fixed no-cause publication error before any durable result.

Build evidence IDs with this exact fixed-domain algorithm:

```ts
sha256([
  'knowledge-evidence-v1',
  requestId,
  factId,
  documentVersionId,
  chunkId,
  sha256(normalizedQuote),
].join('\0'))
```

Add fixed-vector, restart-stability, candidate-order, normalization-equivalent quote, and changed
request/chunk tests. Verify any existing hash row has the exact identity before treating it as
idempotent; a collision/mismatch fails closed.

Batch-load active pending/confirmed dedup targets by workspace/domain/normalized value, not one query
per candidate. Use random persistent fact IDs for new identities. Rejected/tombstoned rows never
match. Insert all request memberships. Preserve matching fact value/origin/review/projection state;
if one or more genuinely new evidence rows are added to an existing fact, increment its revision and
updatedAt once for the publication, never once per evidence. Then compute the current request's
reviewable predicate and call the transaction-neutral request finalizer from Step 2. Return only the
safe summary plus ordered linked fact IDs.

- [ ] **Step 6: Implement bounded list/evidence projections and stale marking**

Keep SQL/persistence in `KnowledgeFactStore` and compatibility/DTO composition in
`KnowledgeFactQueryService`. Fetch normalized page rows, first evidence previews, metrics, and the
current Profile in bounded queries; never query once per fact.

Update request-summary mapping to join/aggregate membership and facts in bulk so every returned
summary has the real active pending-fact count. The request store remains the owner of summary
projection; it must not call `KnowledgeFactStore` once per request.

Stale marking timestamps active evidence and updates each affected fact exactly once per transaction:
`revision += 1, updated_at = now`. `markVersionEvidenceStale` updates only `stale_at IS NULL`;
select/update distinct fact IDs as a set so multiple evidence rows for one version cause exactly one
revision bump and one exact `updated_at = now` assignment; repeat calls are fully idempotent and
change neither revision nor timestamp. Add a same-version/multiple-evidence assertion for the
one-bump/exact-now behavior. It never tombstones a confirmed fact or reverses Profile projection. Pending
stale-only facts remain history-visible and rejectable but non-confirmable.

After stale updates, use one set-based request recalculation for all affected facts. The same shared
reviewable predicate may only transition linked `review_required` requests to `completed` when none
of their memberships remain reviewable; preserve progress/counts/reasons/revision, set
`updated_at=completed_at=now`, and never reopen completed/failed/cancelled/stale or touch
queued/running. Return exact `{ staleEvidenceCount, revisedFactCount, completedRequestCount }`.
`recalculateLinkedRequests(factId)` uses the same one-way set transition and returns transitioned
request count; shared facts across requests and requests with another still-pending fact are covered.

Workspace fact cleanup is transaction-neutral for Task 11 and explicitly deletes membership first,
then evidence, then facts; it never relies on cascade and returns all three row counts. Request/
attempt deletion occurs only afterward in the lifecycle coordinator. Add rollback fault tests and
prove no per-fact/per-request SQL loop.

Lifecycle callers must invoke request-store `markVersionStaleInCurrentTransaction` (or workspace
equivalent) before evidence stale/recalculation in the same outer transaction. Public Task 4 wrappers
delegate to these transaction-neutral primitives. Add an ordering test where a review-required
request would otherwise become completed; the required final state is stale, never completed.

- [ ] **Step 7: Verify GREEN and review**

Run targeted tests, changed-file ESLint, `npm run compile:electron`, and `git diff --check`. Inspect
DTO serialization for paths, text, secrets, and raw errors. Do not stage or commit; generate the
review package.

---

### Task 7: Run the One-Concurrency Enrichment Service and Backend Authorization Façade

**Files:**

- Create: `src/main/knowledgeBase/knowledgeEnrichmentService.ts`
- Create: `src/main/knowledgeBase/knowledgeEnrichmentService.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeEnrichmentTypes.ts`
- Modify: `src/main/knowledgeBase/knowledgeEnrichmentModelResolver.ts`
- Modify: `src/main/knowledgeBase/knowledgeEnrichmentModelResolver.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeExtractionAuthorizationStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeExtractionAuthorizationStore.test.ts`
- Modify: `src/main/industryPack/modelClientAdapter.ts`
- Modify: `src/main/industryPack/modelClientAdapter.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeEnrichmentPublicationStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeEnrichmentPublicationStore.test.ts`

**Interfaces:**

- Produces main-internal operations for Plan 3:

```ts
prepareExtractionAuthorization(input: {
  ownerId: number;
  documentId: string;
  documentVersionId: string;
}): KnowledgeExtractionAuthorizationPreparation;
requestExtraction(input: { ownerId: number; authorizationToken: string }):
  Promise<KnowledgeEnrichmentSummary>;
retryExtraction(input: {
  ownerId: number;
  requestId: string;
  authorizationToken: string;
}): Promise<KnowledgeEnrichmentSummary>;
cancelExtraction(input: { requestId: string; expectedRevision: number }):
  KnowledgeEnrichmentSummary;
abortActiveAttemptForVersion(documentVersionId: string): void;
abortActiveAttemptForWorkspace(workspaceId: string): void;
wake(): void;
waitForIdle(): Promise<void>;
shutdown(): Promise<void>;
```

The service owns the same `Database.Database` connection used by the request, document, index, and
workspace stores. Its dependencies include
`loadWorkspaceRouteSourceInCurrentTransaction(db, workspaceId)`, which asserts
`db.inTransaction` and reads from that exact connection/snapshot. Extend the Task 2 resolver with a
pure `resolveRouteSource(workspaceId, source)` entry; `resolveForWorkspace` delegates to it, while
Task 7 loads the source inside its own transaction and never calls an unrelated connection-backed
getter during authorization revalidation.

Every authorization-critical document/version/index/chunk read in prepare and consume must execute
directly against the service-owned `db` (or a current-transaction reader that accepts that exact
object); do not depend on injected document/index store instances whose private connection identity
cannot be proven. The constructor rejects a request store bound to another object, and its public
dependency surface must not permit a type-correct document/index store to silently read another
connection. Tests pass stores/connections backed by a different database and require fail-closed
construction or prove they are not part of the authorization read path.

Extend the authorization callback failure with an allowlisted invalidation code. The exact safe
codes are `workspace_not_found`, `document_not_found`, `document_not_ready`,
`local_index_not_ready`, `model_configuration_unavailable`, `model_configuration_changed`,
`unsupported_model_provider`, `enrichment_request_not_found`, `enrichment_request_stale`, and
`enrichment_already_active`. Retryable persistence failure remains
`enrichment_persistence_failed`. The callback failure object carries only disposition and code; the
authorization store first invalidates the token and then throws a fixed-message
`KnowledgeExtractionAuthorizationError` with that code. Arbitrary codes/messages are rejected.

Task 7 also extends the main-internal authorization issue/context with
`publishedGenerationId: string`. It is stored only in the in-memory descriptor and never appears in
`KnowledgeExtractionAuthorizationPreparation`, summaries, IPC DTOs, logs, or SQLite. The existing
`plannedModelCalls` and `partial` descriptor fields are consent-critical, not advisory.

- [ ] **Step 1: Write failing authorization-preparation tests**

Reject deleted, stale-version, processing, failed, empty-text, and unindexed documents. For a ready
indexed version, read the published index state and exact persisted `chunkCount` in the same snapshot,
load at most 31 chunk summaries as a bounded consistency check, and derive
`plannedModelCalls = min(chunkCount, 30)` plus `partial = chunkCount > 30`. Lock the exact strict
model route plus exact `publishedGenerationId` and issue a descriptor without invoking the model. Never substitute loaded/response
array length for the indexed total.

- [ ] **Step 2: Write failing request/retry/idempotency tests**

Assert the authorization callback records the Task 4 transaction primitive's `queuedTransition` in
invocation-local state. Only a consume whose callback actually inserts/requeues and returns
`queuedTransition=true` calls `wake()` once after commit. A second valid token converging on the same
already-queued row, receipt replay, and callbacks that return running/review-required/exact-latest-
failed rows never wake. An immediate duplicate token submission returns the receipt request through
the request store's sole safe `getSummary` projection. An ordinary request that meets the exact latest failed route
returns its failed summary unchanged and directs the caller through fresh-authorized retry. Retry
requires a new token and an exact failed request route; completed/cancelled/stale re-extraction
creates a new request. Local document/index methods never invoke the injected model client.

After preparing a descriptor, independently replace the current version, delete the document,
invalidate its local index, switch provider, switch model, and rotate the effective API key. Every
consume must invalidate the old token and assert zero request rows, zero wake calls, and zero model
calls. Assert each mutation produces its dedicated allowlisted safe code—not a generic authorization
error—and serialized errors contain no credential, route fingerprint, raw message, or path. Add the
same assertions for owner/workspace cleanup racing an in-flight consume.

Also republish the same still-current version as another ready index generation with chunk counts
changing 1→30 and 30→31, plus the same count under a different generation. Consumption recomputes
current `plannedModelCalls`/`partial` and compares both plus generation byte-for-byte with the
authorization context. Any change invalidates with fixed `local_index_not_ready` and produces zero
request rows, wakes, or model calls.

Use two WAL connections and a hook between revalidation reads and request mutation to force
`SQLITE_BUSY_SNAPSHOT`. The entire outer transaction must restart on a fresh snapshot, repeat target
and route revalidation, and either commit exactly one request or invalidate with the newly observed
safe code. The current-transaction request primitive must execute once per outer attempt and never
retry the poisoned snapshot internally.

- [ ] **Step 3: Write failing worker tests**

Use deferred model promises and fake timers to prove:

- exactly one request/model call is active at a time;
- transient claim BUSY/BUSY_SNAPSHOT lasting beyond the four immediate attempts uses injected
  25/50/100/200/250 ms capped backoff until one claim succeeds, then performs one model call; a
  permanent claim error becomes one stable-code log and never an unhandled drain rejection;
- chunks are processed in ordinal order, max 30;
- a 31-chunk published generation makes exactly 30 calls, passes
  `totalIndexedChunkCount=31` to Task 5 selection, and persists exact
  `partialReasons=['chunk_limit']`, including when all 30 responses are valid empty results;
- each call receives explicit locked API config and a real signal;
- each call receives `maxTokens = 4_096` and `maxResponseBytes = 1_048_576`;
- valid outer provider JSON with an invalid content envelope maps through a typed adapter error to
  `invalid_model_response`, never by inspecting an error message;
- immediately before every call, one same-connection read transaction revalidates the exact running
  request/attempt lease, active document and current version, ready document state, exact published
  index generation, next chunk ownership, and strict route fingerprint; no check may use a cached
  workspace/document/index object or a different database connection;
- route is strictly re-resolved before every call and fingerprint change fails without fallback;
- deletion/version replacement/index invalidation before the first call or between two chunks sends
  neither that call nor any later chunk to the model; a lifecycle abort that happened just before
  fetch is observed through the already-owned signal;
- durable progress and heartbeat update between calls;
- a false heartbeat or any lost request/attempt lease stops immediately, aborts the controller, and
  never calls `failAttempt` against the new owner/state;
- 180-second timeout aborts the signal and fails safely;
- queued/running cancellation aborts the active call and a late result cannot publish;
- deletion/version replacement/lost lease prevents final publication;
- republishing the same version as a new generation after the service's final read check but before
  the publication write transaction prevents publication, including a valid empty selection;
- after the caller has transactionally marked a version/workspace stale,
  `abortActiveAttemptForVersion`/`abortActiveAttemptForWorkspace` abort only the matching in-memory
  controller and never perform a second database transition;
- a valid empty result completes without facts;
- a non-empty response whose candidates are all invalid fails with
  `evidence_validation_failed` instead of completing as empty;
- invalid envelope fails with a safe code and no raw output persisted;
- a wake arriving after an empty `claimNext()` but before `drainPromise` is cleared is not lost and
  starts another drain;
- shutdown aborts only the local controller, performs no failure/cancel CAS, leaves the durable
  request/attempt running for startup recovery, and then resolves after the drain is idle.
- wake before, during, or after shutdown never starts a new/replacement drain; shutdown interrupts
  claim BUSY backoff, sends no new model call, and leaves an unclaimed queued row durable for the
  next startup.

- [ ] **Step 4: Run tests and verify RED**

Run:

```bash
npm test -- src/main/knowledgeBase/knowledgeEnrichmentService.test.ts
```

Expected: FAIL because the service is missing.

- [ ] **Step 5: Implement atomic consume revalidation and the coalesced single drain**

The authorization callback must be synchronous and wrap one `db.transaction(...)` with
`runTransientSqliteWriteTransaction`; no `await` is permitted. On every outer retry it rereads
workspace/document/current version/index state from the same connection, loads the workspace route
source through `loadWorkspaceRouteSourceInCurrentTransaction`, resolves the exact provider/model,
compares every descriptor target plus routing fingerprint, and only then calls the Task 4
`*InCurrentTransaction` request primitive. It must never call a wrapper that owns a nested
transaction. Any target/route mismatch throws the authorization store's allowlisted invalidation
failure with its dedicated safe code. Only exhausted retryable SQLite persistence failure may
preserve the descriptor. The retried transaction callback returns `{ requestId, queuedTransition }`;
never mutate a shared flag from an attempt that may roll back, and use only the final value returned
by `runTransientSqliteWriteTransaction`. After `consume()` returns the committed request ID, resolve
it through `getSummary`; a missing row maps to fixed `enrichment_request_not_found`. Call `wake()`
only when the committed transition flag is true; receipt replay and unchanged
queued/running/review-required/failed results do not wake. This
is the consumption-time guard; prepare-time checks and worker-time checks do not replace it.

Use one `drainPromise` and one active attempt `AbortController`; repeated `wake()` only sets a wake
flag. Before a claim exists, call Task 4's `runTransientSqliteWriteTransactionUntilSuccess` around
`claimNext`, with an injected abortable delay using the exact 25/50/100/200/250 ms capped sequence.
Shutdown aborts that delay and exits without treating it as a job failure. Claim one request and,
from one same-connection snapshot, capture both the published index
generation and exact `totalIndexedChunkCount`. Immediately before every model
call, use the same connection in one read transaction to revalidate the exact running lease, active
document/current version, ready index generation, next chunk identity/content, and freshly resolved
route fingerprint; use only the chunk returned by that snapshot. If lease validation or heartbeat
returns false, abort and stop without writing a failure over the newer state. Iterate at most 30
chunks, validate each response in memory, and pass the captured indexed total—not descriptor partial
or response count—to Task 5 selection before calling the publication store once. Pass both captured
`publishedGenerationId` and `totalIndexedChunkCount` into publication; Task 6 compares them inside
its own outer write transaction before any fact/evidence/finalization write, closing the final-read/
publication TOCTOU window. Each call passes the
locked explicit API config, `maxTokens`, `maxResponseBytes`, and attempt signal. Use a 15,000 ms
heartbeat interval and clear every timer in `finally`.

The drain loop clears its wake flag before each claim. If claim returns null, it checks the flag again
before exiting; `finally` clears `drainPromise` and synchronously starts a replacement drain whenever
a wake arrived in the empty-claim/cleanup window. `wake()`, every loop/backoff continuation, and the
replacement path must first require `!shuttingDown`; once shutdown begins a wake leaves the durable
queued row untouched for the next startup. Repeated wakes still coalesce into one running drain.

Retain the active claim's workspace and document-version IDs beside its controller. The two targeted
abort methods compare those IDs synchronously and abort only on an exact match. They are lifecycle
notifications after request-store lease invalidation; request/attempt CAS remains authoritative.

- [ ] **Step 6: Implement safe failure and cancellation ordering**

Persist cancellation before aborting. Timeout aborts before marking failure. Shutdown is different:
set the shutdown flag, abort only the local controller, do not run failure/cancel/stale CAS, and leave
the running request/attempt durable for `recoverAbandonedRunning` at next startup; wait until the
drain settles. All late outputs still
pass request/attempt publication CAS. Before any catch writes failure, reread the exact running lease;
lost lease, user/lifecycle abort, or shutdown exits without `failAttempt`. Map owned internal errors to stable codes and a bounded generic
message: timeout to `model_request_timeout`; network or HTTP transport failure to
`model_request_failed`; response-byte overflow/malformed JSON to `invalid_model_response`; local
transaction failure to `enrichment_persistence_failed`; configuration mismatch/unavailability to
their dedicated codes. Log only module tag, request ID, attempt ID, and stable code; never persist or
log the transport message/body.

Extend the Task 2 adapter with typed, fixed-message, no-cause
`ModelResponseInvalidContentError`/`model_response_invalid_content` for valid JSON whose outer object
has no supported text field or is not an object. The service mapping matrix is exact: response too
large, invalid outer JSON, invalid provider content, or Task 5 invalid envelope →
`invalid_model_response`; wholly invalid evidence → `evidence_validation_failed`; bounded-read,
network, or HTTP failure → `model_request_failed`; only the service deadline's owned abort →
`model_request_timeout`; user/lifecycle abort follows cancellation/stale CAS and records no model
failure. Never classify by error message. Destructure only `{ text }` from adapter results; never pass
`ModelGenerationResult.raw`, prompt, or system prompt to a store or logger.

- [ ] **Step 7: Verify GREEN, leak searches, and review**

Run the targeted service plus Tasks 2–6 tests, changed-file ESLint, `npm run compile:electron`, and
`git diff --check`. Search logs/tests for prompt, response, credential, fingerprint, and local-path
leakage. Do not stage or commit; generate the review package.

---

### Task 8: Add Profile Global/Field Revisions and Migrate Every Existing Writer

**Files:**

- Create: `src/main/enterpriseLeadWorkspace/profileRevisionStore.ts`
- Create: `src/main/enterpriseLeadWorkspace/profileRevisionStore.test.ts`
- Create: `src/main/knowledgeBase/knowledgeTrustedProfileIndexStore.ts`
- Create: `src/main/knowledgeBase/knowledgeTrustedProfileIndexStore.test.ts`
- Modify: `src/shared/knowledgeBase/constants.ts`
- Modify: `src/shared/knowledgeBase/contracts.test.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/constants.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/types.ts`
- Modify fixtures returned by:
  `rg -l "EnterpriseLeadWorkspace" src --glob '*.test.ts' --glob '*.test.tsx'`
- Modify: `src/main/enterpriseLeadWorkspace/store.ts`
- Modify: `src/main/enterpriseLeadWorkspace/store.test.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.test.ts`
- Modify: `src/main/enterpriseLeadWorkspace/ipcHandlers.ts`
- Modify: `src/main/enterpriseLeadWorkspace/ipcHandlers.test.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Modify: `src/renderer/services/enterpriseLeadWorkspace.ts`
- Modify: `src/renderer/services/enterpriseLeadWorkspace.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.test.ts`

**Interfaces:**

- Produces this exact Profile revision boundary; the store and trusted refresh store hold the same
  `Database.Database` connection:

```ts
interface EnterpriseLeadWorkspaceProfileCasResult {
  workspace: EnterpriseLeadWorkspace;
  previousProfileRevision: number;
  profileRevision: number;
  touchedFieldRevisions: Partial<Record<KnowledgeFactDomain, number>>;
}

getFieldRevision(workspaceId: string, field: KnowledgeFactDomain): number;
compareAndSwapProfile(
  input: CompareAndSwapWorkspaceProfileInput,
): EnterpriseLeadWorkspaceProfileCasResult;
compareAndSwapProfileInCurrentTransaction(
  input: CompareAndSwapWorkspaceProfileInput,
): EnterpriseLeadWorkspaceProfileCasResult;
initializeWorkspaceProfileInCurrentTransaction(input: {
  workspaceId: string;
  now: string;
}): void;
```

  `compareAndSwapProfile` rejects invocation while `db.inTransaction`, owns one outer
  better-sqlite3 transaction, and retries the whole transaction with
  `runTransientSqliteWriteTransaction`. `compareAndSwapProfileInCurrentTransaction` and initializer
  assert `db.inTransaction` and never open/retry a nested transaction, wake, or await. Task 9 uses
  only the neutral primitive inside the projector's outer transaction.
- Extends `EnterpriseLeadWorkspace` with required `profileRevision: number`; all constructors,
  persistence mappings, and fixtures add initial revision `1` in this task.
- Produces `EnterpriseLeadProfileRevisionConflictError` carrying only a dedicated display-safe
  conflict snapshot `{ id, profile, profileRevision, updatedAt }`. It must never carry the complete
  workspace or its `settings`, provider configuration, source internals, or paths.
- Produces this Task 8 trusted refresh outbox boundary; Task 10 adds claim/execution methods:

```ts
interface EnqueueTrustedProfileRefreshInput {
  workspaceId: string;
  profileRevision: number;
  now?: string;
}

interface KnowledgeTrustedProfileIndexEnqueueResult {
  job: KnowledgeTrustedProfileIndexJob;
  inserted: boolean;
}

enqueue(input: EnqueueTrustedProfileRefreshInput): KnowledgeTrustedProfileIndexEnqueueResult;
enqueueInCurrentTransaction(
  input: EnqueueTrustedProfileRefreshInput,
): KnowledgeTrustedProfileIndexEnqueueResult;
getJob(workspaceId: string, profileRevision: number): KnowledgeTrustedProfileIndexJob | null;
getState(workspaceId: string): KnowledgeTrustedProfileIndexState | null;
listAttempts(jobId: string): KnowledgeTrustedProfileIndexAttempt[];
```

  The store derives `scopeId` internally with
  `buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId)` and never trusts a caller-supplied
  scope. `(workspaceId, profileRevision)` is the idempotency key. Generic reconciliation may return
  `inserted:false` without changing the row; Profile CAS/create must require `inserted:true`, or roll
  back the whole transaction as a fixed persistence-state conflict. No store method wakes inside a
  transaction; only the outer caller may wake after commit.
- Changes existing manual Profile updates to require `expectedProfileRevision` and a non-empty,
  deduplicated list of exact touched Profile fields.
- Before any write, derives semantic changed domains with the Task 1 shared helper and requires every
  changed value/trust-key domain to be present in `touchedFields`. Callers may explicitly touch an
  unchanged field, but may never change an undeclared field.
- Adds centralized fixed codes `trusted_profile_index_refresh_failed` and
  `trusted_profile_index_refresh_abandoned`; outbox rows never persist arbitrary messages, causes,
  SQL errors, provider configuration, paths, source content, or credentials.

- [ ] **Step 1: Write failing migration/backfill tests**

Create a legacy workspace table without revision columns, initialize the new stores, and assert:

- `profile_revision INTEGER NOT NULL DEFAULT 1` is added and old rows read as revision 1;
- exactly ten `enterprise_lead_workspace_profile_field_revisions` rows are backfilled per workspace,
  each at revision 1;
- new workspaces start at global/field revision 1;
- initialization is repeatable without resetting revisions.

Lock this logical schema; implementation may vary only idempotent guards and whitespace. Production
DDL, comparisons, switches, and tests interpolate the centralized ten-domain whitelist, trusted
refresh status, attempt outcome, and fixed error-code constants—these literals appear below only to
state the resulting SQL:

```sql
ALTER TABLE enterprise_lead_workspaces
ADD COLUMN profile_revision INTEGER NOT NULL DEFAULT 1
CHECK (
  TYPEOF(profile_revision) = 'integer'
  AND profile_revision BETWEEN 1 AND 9007199254740991
);

CREATE TABLE IF NOT EXISTS enterprise_lead_workspace_profile_field_revisions (
  workspace_id TEXT NOT NULL CHECK (TRIM(workspace_id) <> ''),
  field TEXT NOT NULL CHECK (field IN (
    'companySummary','productList','productCapabilities','targetCustomers',
    'applicationScenarios','sellingPoints','channelPreferences',
    'prohibitedClaims','contactRules','missingInfo'
  )),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (
    TYPEOF(revision) = 'integer'
    AND revision BETWEEN 1 AND 9007199254740991
  ),
  PRIMARY KEY (workspace_id, field)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS knowledge_trusted_profile_index_jobs (
  id TEXT PRIMARY KEY CHECK (TRIM(id) <> ''),
  workspace_id TEXT NOT NULL CHECK (TRIM(workspace_id) <> ''),
  scope_id TEXT NOT NULL CHECK (TRIM(scope_id) <> ''),
  profile_revision INTEGER NOT NULL CHECK (
    TYPEOF(profile_revision) = 'integer'
    AND profile_revision BETWEEN 1 AND 9007199254740991
  ),
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (
    TYPEOF(attempt_count) = 'integer'
    AND attempt_count BETWEEN 0 AND 9007199254740991
  ),
  active_attempt_id TEXT CHECK (
    active_attempt_id IS NULL OR TRIM(active_attempt_id) <> ''
  ),
  error_code TEXT,
  requested_at TEXT NOT NULL CHECK (TRIM(requested_at) <> ''),
  updated_at TEXT NOT NULL CHECK (TRIM(updated_at) <> ''),
  CHECK (
    (status = 'queued' AND active_attempt_id IS NULL AND error_code IS NULL)
    OR (status = 'running' AND active_attempt_id IS NOT NULL AND error_code IS NULL)
    OR (status = 'completed' AND active_attempt_id IS NULL AND error_code IS NULL)
    OR (status = 'failed' AND active_attempt_id IS NULL
        AND error_code IS NOT NULL
        AND error_code IN ('trusted_profile_index_refresh_failed',
                           'trusted_profile_index_refresh_abandoned'))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_profile_index_job_revision
ON knowledge_trusted_profile_index_jobs(workspace_id, profile_revision);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_profile_index_active_attempt
ON knowledge_trusted_profile_index_jobs(active_attempt_id)
WHERE active_attempt_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_profile_index_one_running_job
ON knowledge_trusted_profile_index_jobs(status) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_trusted_profile_index_queue
ON knowledge_trusted_profile_index_jobs(updated_at, profile_revision, id)
WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_trusted_profile_index_workspace
ON knowledge_trusted_profile_index_jobs(workspace_id, profile_revision DESC);

CREATE TABLE IF NOT EXISTS knowledge_trusted_profile_index_attempts (
  id TEXT PRIMARY KEY CHECK (TRIM(id) <> ''),
  job_id TEXT NOT NULL CHECK (TRIM(job_id) <> ''),
  attempt_number INTEGER NOT NULL CHECK (
    TYPEOF(attempt_number) = 'integer'
    AND attempt_number BETWEEN 1 AND 9007199254740991
  ),
  started_at TEXT NOT NULL CHECK (TRIM(started_at) <> ''),
  finished_at TEXT CHECK (finished_at IS NULL OR TRIM(finished_at) <> ''),
  outcome TEXT NOT NULL CHECK (outcome IN ('running','completed','failed','abandoned')),
  error_code TEXT,
  UNIQUE (job_id, attempt_number),
  FOREIGN KEY (job_id) REFERENCES knowledge_trusted_profile_index_jobs(id),
  CHECK (
    (outcome = 'running' AND finished_at IS NULL AND error_code IS NULL)
    OR (outcome = 'completed' AND finished_at IS NOT NULL AND error_code IS NULL)
    OR (outcome = 'failed' AND finished_at IS NOT NULL
        AND error_code = 'trusted_profile_index_refresh_failed')
    OR (outcome = 'abandoned' AND finished_at IS NOT NULL
        AND error_code = 'trusted_profile_index_refresh_abandoned')
  )
);
CREATE INDEX IF NOT EXISTS idx_trusted_profile_index_attempts_job
ON knowledge_trusted_profile_index_attempts(job_id, attempt_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_profile_index_one_running_attempt
ON knowledge_trusted_profile_index_attempts(job_id) WHERE outcome = 'running';

CREATE TABLE IF NOT EXISTS knowledge_trusted_profile_index_state (
  workspace_id TEXT PRIMARY KEY CHECK (TRIM(workspace_id) <> ''),
  scope_id TEXT NOT NULL UNIQUE CHECK (TRIM(scope_id) <> ''),
  indexed_profile_revision INTEGER NOT NULL CHECK (
    TYPEOF(indexed_profile_revision) = 'integer'
    AND indexed_profile_revision BETWEEN 1 AND 9007199254740991
  ),
  indexed_at TEXT NOT NULL CHECK (TRIM(indexed_at) <> '')
) WITHOUT ROWID;
```

Use `PRAGMA table_info` before conditional `ADD COLUMN`. Run schema change plus a ten-domain
set-based `INSERT OR IGNORE ... SELECT` backfill in one whole-transaction retry: fill missing rows at
1 and never reset an existing revision above 1. Deliberately omit workspace cascade/FK from field,
job, and state ownership; Task 11 explicitly deletes attempts → jobs → state → field rows. Reopen a
file-backed legacy database and reinitialize to prove the column, exactly ten rows, outbox/state/
attempt values, and revisions persist; missing field rows are repaired without resetting existing
ones, and invalid domains/non-safe revisions fail DDL constraints.

Creation, migration, initialization, and Profile CAS must never insert or advance
`knowledge_trusted_profile_index_state`; assert `getState(workspaceId) === null`. Only Task 10 may
create/advance successful state after `replaceTrustedSources` succeeds. Legacy migration may defer
job creation to Task 10 reconciliation, but it must never fabricate indexed success.

- [ ] **Step 2: Write failing CAS and touched-field tests**

Test that a successful write with expected revision 1 produces revision 2, increments only explicitly
touched field rows, and enqueues refresh revision 2 atomically. Saving the same normalized value still
increments explicitly touched fields. A stale expected revision throws a typed conflict containing
the latest display-safe snapshot and writes neither Profile, field revisions, nor outbox.

Test whole-Profile payload integrity: changing a value field without declaring it, or moving a
confirmed/ignored key without declaring that key's domain, returns `invalid_request` and writes
nothing. Changed malformed/unknown trust keys are also rejected rather than escaping field revision
tracking. Extra declared fields whose normalized value is unchanged remain valid and increment their
field revision, preserving explicit same-value user saves.

Use this input contract:

```ts
interface CompareAndSwapWorkspaceProfileInput {
  workspaceId: string;
  expectedProfileRevision: number;
  nextProfile: EnterpriseLeadWorkspaceProfile;
  touchedFields: KnowledgeFactDomain[];
  now?: string;
}
```

The CAS result reports previous/new global revision and the exact new revisions for every touched
field. The public wrapper rejects nested use; the current-transaction primitive rejects use outside
a transaction. Use stage fault hooks to prove rollback after Profile update, each field update, and
outbox insert; use the same explicit `now` for Profile and job. A preexisting colliding revision job
must make CAS fail closed and roll back Profile/field changes rather than returning idempotent success.

Cover `createWorkspace` with faults after workspace insert, field initialization, and revision-1 job
insert; every fault leaves zero rows in all three ownership areas. With two file-backed WAL
connections, prove two manual saves yield one success and one typed conflict without raw BUSY, and a
Task 9-shaped outer transaction using `compareAndSwapProfileInCurrentTransaction` restarts the whole
snapshot after `SQLITE_BUSY_SNAPSHOT` with no partial Profile/field/outbox commit.

- [ ] **Step 3: Write failing existing-writer race tests**

Cover manual IPC writes and legacy model extraction. Start a deferred legacy model request, perform a
manual edit while it is in flight, then resolve the model. The legacy path retries typed Profile
conflicts at most three times; on each attempt it rereads latest Profile, reapplies only its semantic
merge, and derives exact changed domains, so it cannot lose the manual edit. If changed domains are
empty it returns a no-op without incrementing global/field revision or enqueuing a job. Exhaustion
returns a fixed safe failure. A second concurrent whole-Profile manual save must receive
`profile_revision_conflict` and the latest display-safe Profile snapshot.

Lock the enterprise IPC failure shape without changing successful payloads:

```ts
const EnterpriseLeadIpcErrorCode = {
  InvalidRequest: 'invalid_request',
  ProfileRevisionConflict: 'profile_revision_conflict',
  OperationFailed: 'operation_failed',
} as const;
type EnterpriseLeadIpcErrorCode =
  typeof EnterpriseLeadIpcErrorCode[keyof typeof EnterpriseLeadIpcErrorCode];

type EnterpriseLeadIpcError = {
  code: EnterpriseLeadIpcErrorCode;
  message: string;
  latestProfile?: {
    id: string;
    profile: EnterpriseLeadWorkspaceProfile;
    profileRevision: number;
    updatedAt: string;
  };
};

type EnterpriseLeadIpcResult<T> =
  | { success: true; data: T }
  | { success: false; error: EnterpriseLeadIpcError };
```

The main handler supplies only the stable code and latest display-safe Profile snapshot for revision
conflicts; it never forwards SQLite/error stack text. Build a fixture containing an API key, OAuth
access/refresh tokens, endpoint, paths, and source internals; serialized IPC errors must contain none
of them.

At the IPC boundary require a plain own-property object, safe integer revision at least 1, a validated
Profile, and 1–10 exact centralized fields; reject duplicates, arrays, inherited keys, unknown fields,
and malformed nested values as `invalid_request`. Generic dependencies must actually throw an Error
whose message, cause, stack, and custom fields contain API key/OAuth tokens/endpoint/path/source/SQL
sentinels; the handler returns only a fixed non-user-facing generic `operation_failed` message and
the renderer continues to show the existing bilingual save-failure key. Serialized output contains
none of the sentinels. Do not call the existing raw `toErrorMessage(error)` path.

The renderer service must preserve this structure rather than collapsing it to a string. Rename the
existing API-unavailable code object from `EnterpriseLeadWorkspaceServiceError` to
`EnterpriseLeadWorkspaceServiceErrorCode` and update its two consumers/tests, then add the typed
`EnterpriseLeadWorkspaceServiceError` class carrying `code` and optional `latestProfile`. Make the
throwing unwrap path create it from `result.error` and use that path for Profile updates. Every
`requestOrThrow`/generic catch logs only `error.message`, never the Error object or complete payload.

- [ ] **Step 4: Run tests and verify RED**

Run:

```bash
npm test -- src/main/enterpriseLeadWorkspace/profileRevisionStore.test.ts \
  src/main/knowledgeBase/knowledgeTrustedProfileIndexStore.test.ts \
  src/main/enterpriseLeadWorkspace/store.test.ts \
  src/main/enterpriseLeadWorkspace/service.test.ts \
  src/main/enterpriseLeadWorkspace/ipcHandlers.test.ts \
  src/renderer/services/enterpriseLeadWorkspace.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.test.ts
```

Expected: FAIL for absent schema, CAS, and request fields.

- [ ] **Step 5: Implement the revision store and trusted-refresh enqueue primitive**

The Profile CAS transaction must:

1. read and verify current global revision;
2. validate raw current/proposed Profile shape without destructively normalizing trust arrays; diff
   their raw trust-key sets first, reject every added/removed/moved noncanonical key, and preserve
   byte-for-byte any unchanged malformed historical entry. Only afterward normalize value fields and
   canonical keys, derive semantic changed domains, and reject unless `changedDomains` is a subset of
   the deduplicated non-empty `touchedFields`. An unrelated field save must preserve the malformed key
   exactly and increment only that unrelated field revision;
3. update `enterprise_lead_workspaces` with `WHERE profile_revision = ?`;
4. increment every explicit field revision even if text is unchanged;
5. call `enqueueInCurrentTransaction({ workspaceId, profileRevision: nextProfileRevision, now })`,
   require `inserted=true`, and verify the internally derived scope;
6. return the result with latest workspace, previous/new global revision, and exact touched-field
   revisions.

The trusted refresh store defines durable refresh statuses `queued`, `running`, `completed`, and
`failed`, immutable attempt rows, and separate `knowledge_trusted_profile_index_state` with the last
successfully indexed revision. Task 8 implements schema, strict corruption-safe mappers, idempotent
`enqueue`, and query behavior only; `enqueue` uses `INSERT ... ON CONFLICT(workspace_id,
profile_revision) DO NOTHING` and never reopens an existing job. Validate scope, statuses, safe
integers/timestamps, active-attempt shape, fixed error codes, attempt relation, and state monotonic
shape on every read without exposing corrupt values. Task 10 owns transitions but inherits these
locked invariants: claim inserts one running attempt while atomically incrementing job attempt count;
attempt rows change only once from running to a terminal outcome and then remain immutable except
explicit workspace deletion; `attempt_count` equals the greatest allocated attempt number; indexed
state never decreases.

- [ ] **Step 6: Delegate the workspace store and migrate main/service writers**

Delete the unsafe two-argument `updateWorkspaceProfile(workspaceId, profile)` signature—do not keep an
overload. Replace it with the complete CAS object so TypeScript forces every writer migration; only
the successful return shape remains compatible. Delegate to the focused revision store.
Main/store construction order is fixed: initialize the base `enterprise_lead_workspaces` schema
first, then trusted outbox schema, then Profile column/field backfill. Inject singleton base/outbox/
revision stores sharing the exact same `Database.Database` connection before any create/update call;
raw-SQL tests that exercise Profile logic must either use the real create path or seed all ten field
rows plus the revision job.
`createWorkspace` owns one whole-transaction retry and calls
`initializeWorkspaceProfileInCurrentTransaction` so workspace row, exactly ten field rows, and
revision-1 refresh job share one commit. The legacy async extraction path uses the bounded semantic
retry/no-op behavior above rather than replaying a stale full Profile.

- [ ] **Step 7: Migrate existing IPC/preload/renderer calls without visual redesign**

Change the manual update request to:

```ts
{
  workspaceId: string;
  profile: EnterpriseLeadWorkspaceProfile;
  expectedProfileRevision: number;
  touchedFields: KnowledgeFactDomain[];
}
```

Validate all fields against the centralized whitelist. In the existing page, pass exact item fields;
for batch actions deduplicate selected item fields. The company-maintenance form tracks an actual
user-touched `Set<KnowledgeFactDomain>`: editing and then restoring the original value remains touched,
untouched fields are never sent, zero touched fields disable/no-op save, and success or conflict
refresh resets the set. On a conflict, apply the latest returned Profile snapshot and show the
existing safe save failure feedback—Plan 3 may add specialized conflict presentation.

In the same renderer change, delete the component-local Profile value/key normalization and
confirmed/ignored-key mutation helpers, import the Task 1 shared pure functions instead, and preserve
the characterized Chinese/case/whitespace behavior with focused equivalence tests. No renderer and
main copy of this trust logic may remain after Task 8.

Update the `src/main/main.ts` IPC dependency adapter in this task (currently a two-argument profile
callback) to forward the full object contract: `workspaceId`, `profile`,
`expectedProfileRevision`, and `touchedFields`. Do not defer this compile-critical call site to Task
11. The renderer reconstructs its local workspace only from the safe conflict snapshot plus its
already-held non-sensitive fields; the error never transports provider settings.

In both single and batch save catches, recognize the typed `profile_revision_conflict`, merge only
`id/profile/profileRevision/updatedAt` from `latestProfile` into the renderer's already-held workspace,
refresh the company draft and parent callback from that reconstructed local object, then show the
existing safe failure feedback. Add service and component tests proving the structured error survives
preload/unwrap and refreshes the Profile without replacing or exposing local `settings`. Before any
merge require `latestProfile.id === submittedWorkspaceId === currentWorkspaceRef.id` and
`latestProfile.profileRevision >= currentWorkspaceRef.profileRevision`; ignore a late response from a
previous workspace or lower revision so parallel saves/navigation cannot corrupt current UI state.

- [ ] **Step 8: Verify GREEN and review**

Run the Task 8 tests, all enterprise workspace tests, changed-file ESLint, `npm run build`,
`npm run compile:electron`, and `git diff --check`. Do not stage or commit; generate the review
package.

---

### Task 9: Implement Fact Review, Profile Projection Ledger, and Safe Reversal

**Files:**

- Create: `src/main/knowledgeBase/knowledgeFactProjectionStore.ts`
- Create: `src/main/knowledgeBase/knowledgeFactProjectionStore.test.ts`
- Create: `src/main/knowledgeBase/enterpriseLeadKnowledgeFactProjector.ts`
- Create: `src/main/knowledgeBase/enterpriseLeadKnowledgeFactProjector.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeFactStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeFactStore.test.ts`
- Modify: `src/shared/knowledgeBase/constants.ts`
- Modify: `src/shared/knowledgeBase/types.ts`
- Modify: `src/shared/knowledgeBase/contracts.test.ts`

**Interfaces:**

- Produces immutable projection ledger actions `inserted`, `preexisting_support`, and
  `replaced_single`, plus support groups keyed by workspace/domain/normalized value.
- Produces backend operations:

```ts
confirmFact(input: {
  factId: string;
  expectedRevision: number;
  replaceExisting?: boolean;
  expectedFieldRevision?: number;
}): KnowledgeFactReviewResult;
rejectFact(input: {
  factId: string;
  expectedRevision: number;
}): KnowledgeFactReviewResult;
archiveFact(input: {
  factId: string;
  expectedRevision: number;
  projectionDecision?: KnowledgeFactArchiveProjectionDecision;
  expectedFieldRevision?: number;
}): KnowledgeFactArchiveResult;
```

- Adds centralized projection conflict discriminants and this display-safe DTO:

```ts
const KnowledgeFactProjectionOperation = {
  Confirm: 'confirm',
  Archive: 'archive',
} as const;
type KnowledgeFactProjectionOperation =
  typeof KnowledgeFactProjectionOperation[keyof typeof KnowledgeFactProjectionOperation];

const KnowledgeFactProjectionConflictKind = {
  CompanySummaryReplacement: 'company_summary_replacement',
  ArchiveFieldChanged: 'archive_field_changed',
} as const;
type KnowledgeFactProjectionConflictKind =
  typeof KnowledgeFactProjectionConflictKind[keyof typeof KnowledgeFactProjectionConflictKind];

interface KnowledgeFactProjectionConflict {
  operation: KnowledgeFactProjectionOperation;
  kind: KnowledgeFactProjectionConflictKind;
  factId: string;
  factRevision: number;
  domain: KnowledgeFactDomain;
  currentFieldValue: string | string[];
  fieldRevision: number;
}
```

  `KnowledgeFactProjectionConflictError` carries only fixed
  `fact_projection_conflict` plus this DTO and emits the exact safe JSON shape. It never carries a
  complete workspace, settings/provider/source/path, evidence/chunk text, SQL/raw cause, stack, or
  ledger internals. `replaceExisting:true` and archive `remove_current` require the exact displayed
  `expectedFieldRevision`; stale decisions return a refreshed conflict with no write. IPC/service in
  Plan 3 may serialize only this allowlisted DTO.

- [ ] **Step 1: Write failing projection schema tests**

Lock ledger fields for applied/prior values, applied global/field revisions, prior confirmed/ignored
key presence, action, applied/reversed timestamps, and fact/workspace/domain identity. Lock the support
group composite key and non-negative active-support count. Assert ledger audit rows are retained after
reversal and workspace cleanup is explicit.

- [ ] **Step 2: Write failing confirm/reject tests**

Confirm must revalidate fact revision plus at least one active evidence row whose document is active
and still points to the evidence version. Test array insertion/deduplication, confirmed-key addition,
ignored-key removal, global/field revision updates, support count, ledger, and trusted outbox in one
transaction. Reject changes only fact/request state and creates no Profile/outbox row.

Test a forced exception after each transaction stage and assert complete rollback.

- [ ] **Step 3: Write failing company-summary conflict tests**

An empty/equal current summary confirms normally. A different non-empty summary returns a safe
projection conflict without changing fact/Profile. `replaceExisting: true` records
`replaced_single`, prior value/key state, and the new field revision only when the submitted displayed
field revision still matches. Assert the conflict contains current safe value/revision and fact
revision, survives restart/first request without renderer-cached workspace state, and serializes none
of secret settings/path/source/SQL/evidence sentinels.

- [ ] **Step 4: Write failing archive/reversal tests**

Cover:

- `preexisting_support` never removes manual/legacy Profile value;
- `inserted` removes only when no other active confirmed support exists and target field revision is
  unchanged;
- `replaced_single` restores prior value only when current value is still the applied value;
- a later unrelated-field edit does not block safe reversal;
- a same-field edit returns conflict and preserves current Profile;
- `keep_current` tombstones the fact, reverses ledger support, preserves current value, and restores
  prior key trust state;
- `remove_current` requires the displayed expected field revision and a second CAS;
- all archive choices preserve fact/evidence history;
- linked requests become completed when no active reviewable pending facts remain.

For same-field archive conflict, assert no fact/ledger/Profile/outbox write and return current safe
field value/revision. Exercise keep-current, remove-current with the displayed revision, cancel/no-op,
and a second concurrent same-field write that makes the displayed revision stale and returns a fresh
conflict. Unrelated global revision changes still allow removal after the target field check.

- [ ] **Step 5: Run tests and verify RED**

Run:

```bash
npm test -- src/main/knowledgeBase/knowledgeFactProjectionStore.test.ts \
  src/main/knowledgeBase/enterpriseLeadKnowledgeFactProjector.test.ts \
  src/main/knowledgeBase/knowledgeFactStore.test.ts
```

Expected: FAIL because projection storage and projector are absent.

- [ ] **Step 6: Implement the projection store and atomic projector**

Use one outer better-sqlite3 transaction per confirm/reject/archive and wrap the entire transaction
in `runTransientSqliteWriteTransaction`. On every whole-transaction attempt reread fact/evidence,
current Profile global revision, and target field revision from the same connection/snapshot; call
only `compareAndSwapProfileInCurrentTransaction`, whose transaction-neutral body also enqueues the
trusted refresh. Never call public Profile CAS/enqueue wrappers below this boundary.

For archive/reversal, the UI's `expectedFieldRevision` protects the target field, while
`expectedProfileRevision` passed to CAS is the freshly reread current global revision on each retry,
not the stale displayed global revision. Thus an unrelated-field concurrent write does not block a
safe target-field reversal, while a same-field write still conflicts. Use the shared Profile
knowledge pure functions; do not duplicate renderer normalization. Increment fact revision on every
review or archive transition. Enqueue trusted refresh only when Profile/trust changes.

- [ ] **Step 7: Verify GREEN and review**

Run targeted tests and a two-connection stale-revision test, changed-file ESLint, and
`git diff --check`. Inspect every conflict DTO for paths/content/secrets. Do not stage or commit;
generate the review package.

---

### Task 10: Refresh Trusted Profile Index Durably and Fail Closed on Revision Lag

**Files:**

- Create: `src/main/enterpriseLeadWorkspace/trustedKnowledgeSources.ts`
- Create: `src/main/enterpriseLeadWorkspace/trustedKnowledgeSources.test.ts`
- Create: `src/main/knowledgeBase/knowledgeTrustedProfileIndexService.ts`
- Create: `src/main/knowledgeBase/knowledgeTrustedProfileIndexService.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeTrustedProfileIndexStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeTrustedProfileIndexStore.test.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.test.ts`
- Modify: `src/main/libs/contentKnowledgeVectorStore.ts`
- Modify: `src/main/libs/contentKnowledgeVectorStore.test.ts`

**Interfaces:**

- Produces pure `buildEnterpriseTrustedKnowledgeSources({ workspaceId, profile })` for only
  `WorkspaceConfirmedProfile` and `WorkspaceRule` sources.
- Adds `ContentKnowledgeVectorStore.replaceWorkspaceDocumentSources(scopeId, sources)` and
  `.replaceTrustedSources(scopeId, sources)`, plus targeted
  `.deleteWorkspaceDocumentSources(scopeId, sourceIds)`. Each method transactionally mutates only its
  owned source-type partition; none may delete or rebuild the other partition. The targeted delete is
  cheap enough to join a normalized document lifecycle transaction and is the fail-closed removal
  primitive.
- Produces `KnowledgeTrustedProfileIndexService.wake()`, `.waitForIdle()`, `.retryFailed()`, and
  `.shutdown()` with one coalesced drain.
- Extends `KnowledgeTrustedProfileIndexStore` with these exact Task 10 operations:

```ts
claimNext(now?: string): KnowledgeTrustedProfileIndexClaim | null;
completeAttempt(jobId: string, attemptId: string, now?: string): boolean;
failAttempt(jobId: string, attemptId: string, now?: string): boolean;
recoverAbandonedRunning(now?: string): number;
retryFailed(now?: string): number;
reconcileWorkspace(
  workspaceId: string,
  now?: string,
): KnowledgeTrustedProfileIndexEnqueueResult | null;
reconcileAll(now?: string): number;
```
- Extends content-knowledge reads with an in-query trusted-source revision gate.

- [ ] **Step 1: Write failing trusted-source extraction tests**

Move confirmed Profile/rule source construction out of the oversized service file without changing
content, labels, priorities, evidence tiers, or source IDs. Test that only confirmed Profile keys are
included in the confirmed source and current prohibited/contact rules are included in the rule source.
The builder accepts only `{ workspaceId, profile }` (or an equivalent exact Pick), never the complete
provider-bearing workspace. Destructure before calling and use a secret-filled settings fixture to
prove sources, jobs, state, and logs contain no settings/credential/endpoint sentinel.

Add scoped replacement tests that interleave raw-document and trusted-source refreshes on the same
scope. A trusted refresh must preserve raw source IDs, contents, and chunk counts byte-for-byte; a raw
document refresh must preserve trusted source IDs, contents, and chunk counts. Reject a source whose
type does not belong to the called method.

Test targeted raw deletion by one or many source IDs: only matching `WorkspaceDocument` chunks in
the scope disappear; unrelated raw sources, trusted sources, and other scopes remain byte-for-byte
unchanged. An injected SQL failure rolls back the caller's surrounding transaction.

- [ ] **Step 2: Write failing outbox worker tests**

Cover FIFO claim, immutable attempt, one-concurrency drain, refresh failure/retry, restart recovery,
and startup reconciliation of every workspace whose `profileRevision` is newer than indexed revision.
Assert indexed revision advances only after `replaceTrustedSources` succeeds. A crash/failure after
trusted vector replacement but before state completion must leave the gate closed, not falsely current.

Lock the state machine:

1. enqueue is idempotent and never reopens an existing revision row;
2. claim FIFO is `updatedAt ASC, profileRevision ASC, id ASC`; queued→running, global one-running-job
   constraint, `attemptCount + 1`, active attempt, and attempt insert are one transaction; WAL losers
   retry/reread and never expose UNIQUE/BUSY text;
3. an attempt is inserted running and may transition once to completed/failed/abandoned; terminal
   rows are immutable except explicit workspace cleanup;
4. after `replaceTrustedSources`, completion in one transaction verifies the exact job/attempt,
   current workspace/scope, and `job.profileRevision <= currentProfileRevision`, terminalizes the
   attempt, monotonically upserts state, then completes/clears the job. State advances to
   `max(existing, jobRevision)`, never to a newer Profile revision merely read to build sources and
   never backwards; when an older/equal job completes, preserve the existing `indexedAt` rather than
   stamping a false later success time;
5. a newer queued revision remains runnable. If revision R builds current Profile C where C>R, state
   records only R so the gate stays closed until C succeeds;
6. refresh failure terminalizes attempt+job with only the fixed failure code and continues draining
   newer jobs. No arbitrary message/cause/source/path/provider/credential is persisted;
7. startup first marks every running attempt abandoned and its job failed with the fixed abandoned
   code, then reconciles. Only a failed job for the workspace's exact current revision whose state is
   missing/behind is requeued; older failed audit rows never replay after a newer success;
8. reconcile reads current Profile revision and derives scope inside its own retried transaction—it
   never trusts a pre-read revision argument. It is no-op when state equals current and scope matches;
   enqueues a missing current job when state is absent/behind; leaves current queued/running; requeues
   current failed at most once per startup; and exceptionally changes current completed→queued for a
   repair attempt when state is still behind, preserving immutable prior attempts and never fabricating
   state. Only state ahead or scope mismatch is hard corruption/fail-closed;
9. a crash after vector replacement but before state/job commit leaves running/state-behind; recovery
   abandons/requeues and idempotently rebuilds, so the gate never falsely reports current;
10. no transaction wakes the service; only an outer committed insert/requeue may wake it.

- [ ] **Step 3: Write failing fail-closed retrieval tests**

Prepare one scope with `WorkspaceDocument`, `WorkspaceConfirmedProfile`, and `WorkspaceRule` chunks.
Assert:

- no state row: only raw document chunks are returned;
- indexed revision behind workspace revision: only raw document chunks are returned;
- equal revision: all eligible chunks are returned;
- confirming a fact immediately increments Profile revision and hides old trusted chunks until
  refresh success;
- archiving a fact hides old trusted chunks even when refresh fails;
- unrelated non-enterprise scopes retain existing behavior.

- [ ] **Step 4: Run tests and verify RED**

Run:

```bash
npm test -- src/main/enterpriseLeadWorkspace/trustedKnowledgeSources.test.ts \
  src/main/knowledgeBase/knowledgeTrustedProfileIndexStore.test.ts \
  src/main/knowledgeBase/knowledgeTrustedProfileIndexService.test.ts \
  src/main/libs/contentKnowledgeVectorStore.test.ts
```

Expected: FAIL because the service and revision gate are absent.

- [ ] **Step 5: Implement refresh worker and source reuse**

For each job, first require the workspace exists, job/state scope matches the internally derived
scope, and `job.profileRevision <= workspace.profileRevision`; if state is ahead of current Profile,
fail closed as corruption. Only after those checks, if indexed state already equals/exceeds the
claimed older revision, terminalize that audit attempt/job without rebuilding or changing state or
`indexedAt`. Otherwise pass only `{ workspaceId, profile }` to the trusted-source builder, call
`replaceTrustedSources`, then CAS-complete only the exact claim. State becomes
`max(existingIndexedRevision, job.profileRevision)`—never the newer revision merely observed while
building. A newer queued revision remains runnable. Sanitize failures and never persist source
content in job rows. Worker failure logs contain only module tag, job/attempt/workspace IDs, and the
fixed code—never Profile/source text or raw Error/cause. After a job failure continue the drain so a newer revision can succeed; e.g.
revision 2 failed then revision 3 succeeded leaves state 3 and never auto-retries revision 2.

Migrate the legacy enterprise document sync path to call `replaceWorkspaceDocumentSources` with only
`WorkspaceDocument` inputs. It must no longer call full-scope `replaceSources` or construct trusted
Profile/rule sources. Trusted source changes flow only through the revision outbox worker. Keep the
generic full-scope method for unrelated existing callers, but do not use it for an enterprise
workspace scope after this task.

Remove raw-vector synchronization from every Profile-only writer. `updateWorkspaceProfile`, fact
confirm/archive, and legacy Profile merge only enqueue trusted refresh through Profile CAS; they do
not reread or re-chunk workspace documents. Only source/document create, update, delete, migration,
or recovery paths may call `replaceWorkspaceDocumentSources`. Add spies proving one Profile CAS
produces trusted enqueue with raw replacements `0`, while one source update produces raw replacements
`1` and trusted replacements `0` (the outbox worker performs trusted replacement separately).

- [ ] **Step 6: Implement the SQLite snapshot gate**

Store `scope_id` on trusted-index state. In `search` and `retrieveFromSources`, filter only
reserved enterprise scopes; unrelated scopes retain existing behavior. The exact predicate is:
non-trusted source type **OR** scope does not start with the reserved `enterprise-workspace:` prefix
**OR** an `EXISTS` subquery joins state and workspace and proves all of
`state.scope_id = chunk.scope_id`, `state.scope_id = 'enterprise-workspace:' || workspace.id`, and
`state.indexed_profile_revision = workspace.profile_revision`. For a reserved scope, missing
workspace/state/scope match is fail-closed, which also hides stale trusted chunks after workspace
deletion. Keep the gate in the same SELECT snapshot to avoid a check/query TOCTOU window.

- [ ] **Step 7: Verify GREEN and review**

Run Task 10 tests plus OpenClaw knowledge-bridge tests, changed-file ESLint, and `git diff --check`.
Repeat the interleaving test under two WAL connections. Do not stage or commit; generate the review
package.

---

### Task 11: Integrate Document Lifecycles, Recovery, Composition, and Shutdown

**Files:**

- Modify: `src/shared/knowledgeBase/types.ts`
- Modify: `src/shared/knowledgeBase/contracts.test.ts`
- Modify fixtures returned by:
  `rg -l "KnowledgeDocumentListItem" src --glob '*.test.ts' --glob '*.test.tsx'`
- Modify: `src/main/knowledgeBase/knowledgeDocumentService.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentService.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeIngestionService.ts`
- Modify: `src/main/knowledgeBase/knowledgeIngestionService.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeIngestionJobStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeIngestionJobStore.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentStore.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentIndexStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentIndexStore.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeMigrationStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeMigrationStore.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeEnrichmentRequestStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeEnrichmentRequestStore.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeFactStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeFactStore.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeFactProjectionStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeFactProjectionStore.test.ts`
- Modify: `src/main/knowledgeBase/enterpriseLeadKnowledgeFactProjector.ts`
- Modify: `src/main/knowledgeBase/enterpriseLeadKnowledgeFactProjector.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeTrustedProfileIndexStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeTrustedProfileIndexStore.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeTrustedProfileIndexService.ts`
- Modify: `src/main/knowledgeBase/knowledgeTrustedProfileIndexService.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeBaseFoundation.ts`
- Modify: `src/main/knowledgeBase/knowledgeBaseFoundation.test.ts`
- Create: `src/main/knowledgeBase/knowledgeWorkspaceCleanupCoordinator.ts`
- Create: `src/main/knowledgeBase/knowledgeWorkspaceCleanupCoordinator.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeBaseStartupOrder.test.ts`
- Modify: `src/main/enterpriseLeadWorkspace/profileRevisionStore.ts`
- Modify: `src/main/enterpriseLeadWorkspace/profileRevisionStore.test.ts`
- Modify: `src/main/enterpriseLeadWorkspace/store.ts`
- Modify: `src/main/enterpriseLeadWorkspace/store.test.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.test.ts`
- Modify: `src/main/libs/contentKnowledgeVectorStore.ts`
- Modify: `src/main/libs/contentKnowledgeVectorStore.test.ts`
- Modify: `src/main/main.ts`

**Interfaces:**

- Extends `KnowledgeBaseFoundation` with `enrichmentService`, `enrichmentRequestStore`, `factStore`,
  `factQueryService`, `factProjector`, `authorizationStore`, `trustedIndexStore`, and
  `trustedIndexingService`.
- Produces the sole public normal-deletion entry `prepareWorkspaceDeletion(workspaceId): boolean` as
  an exact staged coordinator: synchronously call
  `authorizationStore.clearWorkspace`; in one outer transaction mark requests/attempts stale, run
  ordered cleanup, and delete the workspace row; only after commit abort matching enrichment/trusted
  controllers. A failed transaction neither aborts controllers nor leaves requests stale.
- Keeps `deleteWorkspaceDataInCurrentTransaction(workspaceId, deleteWorkspaceRow)` as the private
  dependency-ordered routine shared by normal deletion and startup orphan cleanup.
- Produces `deleteWorkspaceFieldRevisions(workspaceId)` and includes deletion of the enterprise
  content-knowledge scope (all raw and trusted chunks) in normal and orphan cleanup.
- Injects a narrow workspace-vector lifecycle boundary:
  `deleteWorkspaceDocumentSources(workspaceId, sourceIds)` for synchronous fail-closed removal and
  `replaceWorkspaceDocumentSource(workspaceId, documentId)` for targeted post-commit publication of
  ready local content. A coalesced per-workspace drain/batch refresh is permitted only with the locked
  linear callback/SQL bound; per-document full-workspace refresh is forbidden.
- Extends the existing document list projection with one bulk enrichment-summary query; it must not
  issue one request query per document.
- Extends `KnowledgeDocumentListItem` with required
  `enrichment: KnowledgeEnrichmentSummary | null` plus
  `hasStalePriorVersionExtraction: boolean`, and updates every production constructor and test fixture
  atomically in this task. `enrichment` may only reference the exact current version. The boolean is a
  safe action marker computed from an older-version stale request for the same document; it exposes no
  old request ID/route/error and lets Plan 3 show “Document changed; extract current version.”

Every store owns a transaction-neutral cleanup primitive on the same connection:

```ts
trustedIndexStore.deleteWorkspaceTrustedIndexInCurrentTransaction(workspaceId): void;
projectionStore.deleteWorkspaceProjectionsInCurrentTransaction(workspaceId): void;
factStore.deleteWorkspaceFactsInCurrentTransaction(workspaceId): KnowledgeFactCleanupResult;
enrichmentRequestStore.deleteWorkspaceRequestsInCurrentTransaction(workspaceId): void;
documentIndexStore.deleteWorkspaceIndexInCurrentTransaction(workspaceId): void;
ingestionJobStore.deleteWorkspaceJobsInCurrentTransaction(workspaceId): void;
documentStore.deleteWorkspaceDocumentsInCurrentTransaction(workspaceId): void;
migrationStore.deleteWorkspaceMigrationInCurrentTransaction(workspaceId): void;
profileRevisionStore.deleteWorkspaceFieldRevisionsInCurrentTransaction(workspaceId): void;
contentKnowledgeVectorStore.deleteEnterpriseWorkspaceScopeInCurrentTransaction(workspaceId): number;
workspaceStore.deleteWorkspaceRowInCurrentTransaction(workspaceId): boolean;
```

Each primitive asserts `db.inTransaction`, performs only its owned table mutation, never opens/retries
a nested transaction, never wakes a worker, and never relies on cascade. Public wrappers, where still
needed, delegate from their own whole-transaction retry. `prepareWorkspaceDeletion` is the only public
normal entry and wraps `deleteWorkspaceDataInCurrentTransaction(..., true)` in one
`runTransientSqliteWriteTransaction`; startup step 0 calls the same internal routine with `false` for
each already-missing orphan. `EnterpriseLeadWorkspaceService.deleteWorkspace` calls the public entry
exactly once; main only injects it and never invokes a second cleanup. Remove the service's early
standalone `deleteScope` call.

`KnowledgeWorkspaceCleanupCoordinator` exposes
`listOrphanedWorkspaceIdsInCurrentTransaction(): string[]` and the shared ordered cleanup routine.
Discovery runs inside the startup step-0 transaction and unions distinct workspace ownership from
every workspace-bearing Plan 2 root table: trusted jobs/state, projection roots, facts, enrichment
requests, index state/chunks, ingestion jobs, documents, migration, field revisions, and reserved
`content_knowledge_chunks` scopes. It left-joins the base workspace table, strictly parses only scope
IDs produced by `buildEnterpriseLeadWorkspaceKnowledgeScopeId`, rejects malformed reserved scopes,
and returns each missing workspace once. A workspace left in only one root table—or only the vector
scope—must still be found and cleaned. It never pretends to infer workspace identity from a child-only
row whose parent is missing.

Each child-owning store also exposes a transaction-neutral parentless sweep, for example attempts
without jobs/requests/versions, request-fact memberships without either parent, evidence without a
fact, document versions without a document, and projection ledger rows without their fact/group.
These `deleteParentless...InCurrentTransaction` methods assert the shared transaction, use set-based
`NOT EXISTS`, never wake/retry, and return row counts. Startup step 0 first cleans every discoverable
orphan workspace, then runs all parentless sweeps in dependency order in the same outer transaction.

- [ ] **Step 1: Write failing document delete/version replacement tests**

In the existing document-service transaction tests, create active enrichment requests and evidence.
Assert:

- soft delete marks current-version evidence stale, increments affected fact revisions, changes
  active requests to stale, cancels running attempt, and removes local chunks atomically;
- parsed-version replacement marks only old-version evidence/requests stale before activating the new
  version;
- restoration requeues local indexing but never clears `stale_at`, reopens facts, or queues model
  work;
- a forced stale-marking failure rolls back document/index deletion or replacement;
- a review-required target is marked request-stale before evidence recalculation and therefore ends
  `stale`, never transiently/finally `completed`;
- delete/version replacement aborts the matching in-process model call after commit and late output
  cannot publish.
- soft delete synchronously removes the target legacy `WorkspaceDocument` source from
  `content_knowledge_chunks`; unrelated raw sources and trusted sources remain byte-for-byte intact;
- version replacement removes old raw content before the new version becomes externally searchable;
  restoration/new versions republish raw vector content only after the active parsed version is
  locally ready (a local-search-index failure does not by itself invalidate parsed raw content);
- a raw refresh failure records/logs only a stable safe code and leaves the deleted/old source absent
  rather than exposing stale content.

Use two file-backed WAL connections and deterministic hooks for publication/confirmation racing
delete and version replacement. The lifecycle operation owns one outer
`runTransientSqliteWriteTransaction`; every internal stale/evidence/vector/index/document primitive
executes once per outer attempt. Prove both legal commit orders: publication/confirm first is then
staled/cleaned by the fresh retry, while deletion/replacement first makes the late publication CAS
fail. No partial state or raw BUSY escapes, and abort/wake/vector publication occurs only after the
final successful commit.

Raw-vector publication is targeted or drain-coalesced, never a full-workspace rebuild after every
document completion. Prefer `replaceWorkspaceDocumentSource(workspaceId, documentId)` plus targeted
delete; at minimum one ingestion drain/batch triggers one workspace refresh. A 1,000-job test locks a
linear callback/SQL bound and event-loop responsiveness instead of rebuilding 1+2+...+1,000 sources.
Version replacement and restoration schedule targeted/coalesced raw publication only after commit;
rollback schedules none. Restore never clears evidence staleness, reopens facts, or queues model work.

Add a 1,000-document projection test that spies on the request store and proves
`listLatestSummariesForVersions` is called once while every `KnowledgeDocumentListItem` receives the
latest exact-version `enrichment` summary or `null`. Assert no fact/evidence/chunk text enters the
document list payload. In the same fixed-number bulk projection, an older-version stale request sets
only `hasStalePriorVersionExtraction=true`; it never becomes the current summary and never exposes its
request ID. No stale history yields false.
The stale-marker lookup is at most one additional workspace-level query (or one combined query),
never one query per document and never an unbounded interpolated `IN` list.

- [ ] **Step 2: Write failing foundation recovery/order tests**

Lock this startup order:

0. run one explicit whole-transaction orphan cleanup before any recover/reconcile/wake;
1. recover abandoned local ingestion;
2. recover abandoned local indexing;
3. recover abandoned enrichment to failed/authorization-required;
4. recover trusted refresh attempts;
5. migrate/reconcile normalized documents;
6. reconcile missing local index states;
7. reconcile trusted Profile revisions;
8. wake ingestion, local index, enrichment queued requests, then trusted refresh.

Assert queued enrichment resumes, running enrichment never auto-replays, and no model is called before
recovery/reconciliation completes. Seed an orphan with queued/running ingestion, index, enrichment,
and trusted jobs; startup must delete it before any claim and must not recreate state or vectors.
Parameterize orphan discovery so each workspace-bearing root table is the sole surviving row in turn,
plus a vector-only reserved scope; every case is found once. Separately seed each child-only table with
its parent absent and prove the global parentless sweep deletes it without needing a workspace ID. A
malformed reserved scope fails closed without deleting another workspace.
Foundation stores the single startup Promise; concurrent readiness callers share it, IPC remains
backend-not-ready until it settles, and shutdown prevents all later wake/reconcile stages.

Use deferred ingestion extraction/OCR, claim BUSY backoff, migration, legacy model work, and startup
reconciliation to test shutdown. After the closing gate, no new claim/model/index/vector call starts;
all owned promises settle or remain durably recoverable before SQLite close, no callback touches the
closed database, and repeated/signal-driven shutdown returns the same completion.

- [ ] **Step 3: Write failing workspace cleanup and late-worker tests**

For the normal path, populate every Plan 2 table while the workspace row still exists, then call the
sole public `prepareWorkspaceDeletion` once. Assert order and zero rows across:

1. trusted refresh attempts/jobs/state;
2. projection groups/ledgers;
3. request/fact membership;
4. evidence;
5. facts;
6. enrichment attempts;
7. enrichment requests;
8. local index attempts/state/FTS/chunks;
9. ingestion attempts/jobs;
10. document versions/documents;
11. migration state;
12. enterprise Profile field revisions;
13. workspace row on the ordinary deletion path (already absent for orphan cleanup);
14. enterprise `content_knowledge_chunks` for the workspace scope (raw and trusted), last.

Do not rely on foreign-key cascade. Simulate a late enrichment/trusted worker and prove workspace
existence/CAS prevents recreation. In separate orphan cases, preseed the workspace row as already
missing (never expect rollback to restore it), then prove startup cleanup removes remaining knowledge
data, field revisions, and the full enterprise vector scope. Assert normal deletion and orphan cleanup
share the one internal dependency-order routine so the two inventories cannot drift.

Every numbered SQLite stage uses its store-owned `...InCurrentTransaction` primitive under the one
outer retry. For the normal row-present case, add a fault after every stage and prove full rollback,
including preservation of the workspace row and vector scope. A late trusted worker paused between preflight and vector replacement
must revalidate workspace existence and deterministic scope inside the vector write transaction; if
cleanup commits first it writes zero rows, while if it commits first cleanup's fresh snapshot removes
those rows. Repeat the same two-WAL hook for raw refresh between ready-document preflight and
replacement, requiring exact current-version revalidation and zero raw/trusted rows after cleanup.
No trusted/raw vector may be recreated after cleanup.

- [ ] **Step 4: Run tests and verify RED**

Run:

```bash
npm test -- src/main/knowledgeBase/knowledgeDocumentService.test.ts \
  src/main/knowledgeBase/knowledgeIngestionService.test.ts \
  src/main/knowledgeBase/knowledgeBaseFoundation.test.ts \
  src/main/knowledgeBase/knowledgeBaseStartupOrder.test.ts \
  src/main/knowledgeBase/knowledgeWorkspaceCleanupCoordinator.test.ts \
  src/main/knowledgeBase/enterpriseLeadKnowledgeFactProjector.test.ts \
  src/main/knowledgeBase/knowledgeTrustedProfileIndexService.test.ts \
  src/main/libs/contentKnowledgeVectorStore.test.ts \
  src/main/enterpriseLeadWorkspace/service.test.ts
```

Expected: FAIL because Plan 2 lifecycle dependencies are not wired.

- [ ] **Step 5: Integrate lifecycle stores in existing transactions**

Inject narrow store interfaces rather than constructing stores inside document service. Mark stale
and call targeted workspace-document vector deletion inside the same shared-SQLite transaction before
removing index state or switching the active version. The mutation order is strict: first call
request-store `markVersionStaleInCurrentTransaction` to stale request/cancel attempt; then call
`markVersionEvidenceStaleInCurrentTransaction`, which may one-way-complete only other still-
review-required linked requests; then delete raw vector/index data and mutate the document/version.
Reversing the first two is forbidden because recalculation could complete the target request and make
its stale CAS ineligible. If any step fails, roll back the whole lifecycle transition. Notify the
enrichment service to abort only after the transaction commits; database CAS remains the final
late-output guard.

Delete, version replacement, and restore each wrap their complete SQLite mutation in one outer
`runTransientSqliteWriteTransaction`. All nested store calls are transaction-neutral and never retry
independently. On `SQLITE_BUSY_SNAPSHOT`, restart every read/check/write from a fresh snapshot. Record
post-commit notifications locally and invoke abort, raw-vector refresh, and worker wake only from the
final committed result; a rolled-back attempt produces none.

After ingestion has atomically published a ready local version and compatibility projection, invoke
the targeted/coalesced raw-source refresh post-commit. Version replacement and restore use the same
post-commit path; restore does not clear stale evidence/facts/requests. Startup reconciliation performs the same refresh for
ready active versions. Never refresh on processing/failed/empty-text data, and never call a model.
Sanitize refresh failures; because old content was synchronously removed, failure is unavailable but
fail-closed rather than stale-visible.

Project enrichment summaries beside the existing bulk job/index maps. Match only
`document.currentVersionId`; a completed/stale request for an older version must never become the
current row summary. Project older-version stale history only into the safe boolean marker, using the
fixed-number bulk lookup above.

- [ ] **Step 6: Compose Plan 2 services and strict model dependencies**

Construct stores once per foundation over the shared SQLite connection. Inject the existing
workspace store, strict model resolver, explicit configured model client, published chunk reader,
and trusted vector refresh callback. Return the backend façade for Plan 3 tests, but register no new
IPC handlers in Plan 2.

Wire post-commit trusted refresh wake at every outbox-producing runtime entry: workspace creation,
manual Profile save, bounded legacy merge, fact confirm, fact archive/reversal, and explicit
reconciliation repair. Wake exactly once only when that committed operation inserted/requeued a job;
no-op, reject, conflict, failed CAS, and rollback wake zero times. Add spies for every entry.

For fact confirm/archive specifically, the projector's retried transaction returns an internal
`trustedRefreshQueued` flag with its safe result. Only after `runTransientSqliteWriteTransaction`
returns the final committed attempt does the projector invoke an injected
`onTrustedRefreshCommitted()` callback once; the flag/callback is never part of renderer DTOs and is
never fired inside a transaction attempt. Add rollback, retry, conflict, reject, and no-op assertions.

For reserved enterprise scopes, `replaceTrustedSources` revalidates the workspace row and exact
derived scope inside its own vector write transaction immediately before delete/insert. This is the
final anti-resurrection lease: a worker whose earlier preflight races workspace cleanup cannot recreate
trusted vectors after deletion.

Apply the same final lease to reserved raw replacement. Inside its own whole-transaction fresh-
snapshot retry, `replaceWorkspaceDocumentSource` must revalidate workspace existence, deterministic
scope, active document ownership, exact current version, ready parsed state, and that the supplied
source was built from that version before deleting/inserting. A cleanup committed between raw
preflight and replacement therefore writes zero rows; no cached source may resurrect raw vectors.

- [ ] **Step 7: Wire startup, workspace deletion, and shutdown in main**

`EnterpriseLeadWorkspaceService.deleteWorkspace` calls `prepareWorkspaceDeletion` exactly once. That
entry synchronously clears workspace authorization tokens, runs the one outer cleanup transaction
(stale active requests first, full ordered cleanup, workspace-row delete), commits, and only then
aborts matching in-memory enrichment/trusted controllers. Main only injects the entry. On failure, no
post-commit notification runs and the workspace remains intact.

Add `KnowledgeIngestionService.shutdown()`: synchronously set a closing gate; make `wake()` and drain
replacement no-op; stop/abort claim BUSY backoff and cooperatively abort or await active extraction/
OCR/commit; leave an interrupted durable running attempt for startup recovery; and prohibit late
index/raw-vector wake. Foundation keeps its startup/recovery Promise plus any legacy model/migration
queue Promise. App cleanup first seals every service against new wake, then awaits shutdown in this
order: enrichment → ingestion → trusted refresh → local index → startup/recovery and legacy queues,
and only then closes SQLite. `before-quit`, SIGINT, and SIGTERM share the same idempotent Promise.

All lifecycle/startup/orphan/migration/refresh/shutdown logs use an allowlist of module tag, stable
workspace/document/request/job/attempt IDs, stage, and fixed error code. Sanitize or omit raw Error,
cause, SQL, source/Profile text, provider config, credentials, and local paths; inject all sentinels in
tests and assert log spies contain none.

- [ ] **Step 8: Verify GREEN and review**

Run Tasks 4–11 tests, changed-file ESLint, `npm run compile:electron`, and `git diff --check`. Do not
stage or commit; generate the review package.

---

### Task 12: Complete Plan 2 Regression, Security, and Handoff Verification

**Files:**

- Modify tests only when a failing gate identifies a real Plan 2 regression.
- Create no production behavior in this task without first adding a reproducing failing test.

**Interfaces:**

- Produces the complete automated backend verification report and Plan 3 handoff inventory.
- Writes the durable result to `.superpowers/sdd/reports/plan-2-final-verification.md`, including the
  canonical file manifest, exact commands/results, reviewer verdicts, known provider limits, security
  assertions, and the exact Plan 3 IPC/renderer handoff below.
- Leaves all source changes unstaged/uncommitted for user acceptance.

- [ ] **Step 1: Run the focused Plan 2 suite**

Run all new/modified domain tests explicitly:

```bash
npm test -- \
  src/shared/knowledgeBase \
  src/shared/enterpriseLeadWorkspace \
  src/main/knowledgeBase \
  src/main/enterpriseLeadWorkspace \
  src/main/industryPack/modelClientAdapter.test.ts \
  src/main/libs/claudeSettings.test.ts \
  src/main/libs/contentKnowledgeVectorStore.test.ts \
  src/renderer/services/enterpriseLeadWorkspace.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.test.ts
```

Expected: PASS with no unhandled rejection, leaked timer, warning, or skipped Plan 2 test.

- [ ] **Step 2: Run the full repository quality gates**

Run:

```bash
npm test
npm run build
npm run compile:electron
```

Run changed-file ESLint exactly as CI does, with `--max-warnings 0`, then run `git diff --check`.
Report unrelated legacy lint failures separately; do not broaden cleanup.

Build one canonical Plan 2 manifest from both tracked changes (`git diff --name-only <feature-base>`)
and untracked production/test files (`git ls-files --others --exclude-standard`), explicitly excluding
only documented setup symlinks and ignored SDD reports. Use this manifest for ESLint, leak searches,
whole-diff review, and scope accounting; never assume `BASE..HEAD` contains unstaged/untracked work.

- [ ] **Step 3: Run security-boundary searches**

Inspect production diffs and persistence/logging call sites. Verify:

- no normalized path calls `processDocumentSource` or schedules `FactExtraction` ingestion stage;
- no request/fact/outbox table contains credential, prompt, raw-response, path, chunk-text, or
  extracted-text columns;
- the opaque `authorizationToken` appears only in the prepare success response and subsequent
  request/retry input. It never appears in descriptor metadata, summary/list/evidence/error payload,
  URL, DOM attribute, renderer persistence, log, or SQLite; routing fingerprint and internal error
  message appear in no external DTO;
- no model call omits explicit locked config, signal, output-token cap, or response-byte cap;
- no provider/model fallback exists in strict resolver;
- no authorization consume creates a request before synchronous target/route/fingerprint
  revalidation, and invalidation/cleanup races cannot recreate receipts;
- no config log spreads raw provider configuration;
- no conflict IPC payload contains workspace settings, credentials, endpoints, paths, or source
  internals;
- no pending/rejected fact code path invokes Profile CAS or trusted refresh;
- no enterprise workspace path uses full-scope vector replacement, and raw/trusted source partitions
  cannot delete one another;
- every final publication/review/archive path checks revision/attempt/evidence ownership.

Do not rely on grep alone. Serialize safe success/error/conflict DTOs and spy every relevant logger
with sentinels for absolute paths, document/chunk/source text, API/OAuth credentials, endpoint/header,
prompt/response, SQL, stack, and cause. Assert none escape, while explicitly permitting only the
bounded fact display value/evidence quote in their approved DTOs and full text from a separately
authorized document-details endpoint. Scan every canonical-manifest production file.

- [ ] **Step 4: Exercise recovery and race suites repeatedly**

Run the request-store two-connection tests, enrichment cancellation/timeout tests, Profile CAS tests,
projector rollback tests, trusted revision-gate tests, document lifecycle tests, and foundation
recovery tests at least three consecutive times. Record exact commands and results.

The repeated set must also include ingestion/enrichment/trusted/index claim backoff, wake-vs-shutdown,
startup readiness, idempotent shared shutdown, `before-quit`/SIGINT/SIGTERM, and zero DB calls after
close. Record one exact focused command and run it in a fail-fast three-iteration shell loop; preserve
all three test counts/durations in the report. Then perform one no-network Electron
launch→recovery→quit→relaunch smoke with model calls stubbed and verify no late write/unhandled rejection.

- [ ] **Step 5: Request independent whole-diff review**

Generate one review package from the feature baseline to the current unstaged worktree, explicitly
including untracked Plan 2 source/test files rather than relying on `git diff BASE HEAD`. Ask a fresh
reviewer to assess specification compliance, trust boundary, SQL/state-machine correctness,
concurrency/cancellation, data privacy, compatibility, performance at 1,000 documents, test quality,
and Plan 3 readiness. Fix every Critical and Important finding through a test-first subagent and
re-review until clean when production behavior changes. Documentation/report/command-only findings
are corrected directly and re-reviewed without inventing a failing code test; record unresolved Minor
findings in the progress ledger.

- [ ] **Step 6: Prepare Plan 3 handoff and user report**

Report:

- implemented stores/services and exact internal façade signatures;
- complete test/build/lint/compile results;
- provider support limitations and security guarantees;
- remaining reviewer Minors;
- the fact/authorization operations Plan 3 may expose through IPC;
- a manual UI acceptance checklist deferred until Plan 3 renders the workflow.

Lock the Plan 3 IPC/preload/renderer adapter table to exactly these nine operations—no `wake`,
`shutdown`, abort, store primitive, API config, credential, or routing-fingerprint bridge:

| Operation | Renderer request | Display-safe success |
| --- | --- | --- |
| `prepareExtractionAuthorization` | `{ documentId, documentVersionId }` | `KnowledgeExtractionAuthorizationPreparation` |
| `retryLocalIndex` | `{ documentId, documentVersionId }` | `KnowledgeDocumentListItem` |
| `requestExtraction` | `{ authorizationToken }` | `KnowledgeEnrichmentSummary` |
| `retryExtraction` | `{ requestId, authorizationToken }` | `KnowledgeEnrichmentSummary` |
| `cancelExtraction` | `{ requestId, expectedRevision }` | `KnowledgeEnrichmentSummary` |
| `listFacts` | `KnowledgeListFactsRequest` | `KnowledgeFactListResult` |
| `reviewFact` | `{ factId, expectedRevision, decision, replaceExisting?, expectedFieldRevision? }` | `KnowledgeFactReviewResult` or safe projection conflict |
| `archiveFact` | `{ factId, expectedRevision, projectionDecision?, expectedFieldRevision? }` | `KnowledgeFactArchiveResult` or safe projection conflict |
| `getFactEvidence` | `KnowledgeFactEvidencePageRequest` | `KnowledgeFactEvidencePageResult` |

Define one shared `KnowledgeBaseRendererApi` request/result/error contract imported by main IPC,
preload, `electron.d.ts`, and renderer service; no four handwritten variants. Runtime validation is
plain-own-data/allowlist based and rejects extra fields. `ownerId` is always `event.sender.id` in main
and never exists in renderer/preload input; spoofed owner fields fail. One idempotent WebContents
`destroyed` listener clears both selection-token and extraction-authorization stores, and
prepare/request/retry ensure it is registered. Tests cover destruction during prepare/consume, late
callback, replay, and confirm that an already committed durable request is not deleted merely because
the window closes. All nine operations await the same shared foundation readiness Promise; recovery
and reconciliation finish before any read, review mutation, retry, or model call.

Validation also enforces legal decision combinations: Reject accepts neither replacement nor field-
revision fields; company replacement and archive `RemoveCurrent` require `expectedFieldRevision`;
ordinary confirm and `KeepCurrent` reject meaningless field revisions; absent optional fields remain
absent rather than being silently ignored. Unknown/extra combinations return fixed `invalid_request`.

Lock Plan 3 renderer state to discriminated AI rows:

```ts
type WorkspaceAiKnowledgeRow =
  | { kind: 'normalized_fact'; fact: KnowledgeFactSummary }
  | { kind: 'legacy_profile'; item: LegacyProfileKnowledgeSummary };
```

Normalized facts use only single-row `reviewFact`, `archiveFact`, and paged `getFactEvidence`;
disable and
delete the existing edit/checkbox/batch-Profile helpers for this kind. Legacy Profile rows are
read-only confirmed/deduplicated compatibility rows in the AI table and remain editable only through
the separate company-data entry. Run snapshots, source documents, and deliverables never masquerade
as normalized facts. Pending normalized facts never call Profile save directly or enter Agent context.

Document processing, local index, and enrichment keep three independent states/retries. Document and
fact loaders each use independent latest-request-wins workspace/generation guards. If a mutation calls
refresh while a list request is in flight, set a trailing-refresh latch (or apply the mutation result
then force one load); on settle perform at least one fresh load unless workspace/generation was
invalidated. Cover request/retry/cancel and the one-time `review_required` fact refresh so old terminal
responses cannot stop polling and hide a running paid model request.

For fact pagination, workspace/filter/mutation changes clear items/cursor and invalidate old load-more;
append by fact ID with newer revision winning, and stop on `nextCursor=null`. Replace metrics on every
response with backend full-workspace metrics—never sum pages or recompute from DOM/Profile. Lock the
pending/confirmed/history plus active/stale/any evidence matrix, rejected/archived/stale-only pending
empty states, partial reasons, legacy dedup, company/archive conflicts, and `hasStalePriorVersionExtraction`.
When a current-version `enrichment` summary exists it always wins display priority; the old-version
marker may prompt “extract current version” only when `enrichment === null`, never over a current
queued/running/review/terminal state and never as a duplicate paid action.
List rows carry at most one preview. Explicit expansion loads the first evidence page only; a visible
“load more” action appends by evidence ID until `nextCursor=null`. Workspace/fact collapse, fact
revision change, review/archive mutation, or fixed `job_state_conflict` clears evidence items/cursor
and invalidates late page responses. Every request sends the expanded row's revision as
`expectedRevision`; before replace/append, verify response `factId`/`factRevision` still match the
currently expanded row. Do not mix pages from different fact revisions. Evidence loads
remain one backend request per user page action with no N+1.
Normalized search must not claim whole-workspace coverage while filtering only loaded pages: hide it
until a separately approved backend search exists, or label it explicitly as current-page filtering.

List every new copy/error/status/action/filter/empty/loading/partial/conflict key centrally and test
both zh/en with no fallback, key echo, or hardcoded user string. Authorization/evidence/company/archive
dialogs require `role="dialog"`, `aria-modal`, labelled title/description, initial focus, Tab trap,
Escape, and focus restoration; the paid send action is not the accidental default. Buttons have
accessible names and visible disabled reasons; progress/status use a live region and not color alone;
keyboard-only tests cover pagination, evidence, keep/remove/cancel, and confirmation.

The manual Plan 3 checklist covers authorization cancel=zero request, double-click idempotency, fresh
retry authorization, the three independent document states, all fact/history/evidence/conflict states,
pagination/full metrics, trailing-refresh races, stale-current-version action, zh/en, keyboard/focus,
and privacy inspection.

Do not claim the independent AI-knowledge feature complete, stage files, commit, merge, or push. Plan
2 is accepted as a backend milestone only after the user reviews the report; the end-to-end product
claim waits for Plan 3 manual Electron verification.

---

## Definition of Done

- An exact ready/indexed document version can receive a two-minute owner-bound authorization
  descriptor without creating a database request or calling a model.
- Successful descriptor consumption creates one durable queued request for the locked
  provider/model/fingerprint; duplicate submission is idempotent.
- The one-concurrency worker reads at most 30 published logical chunks, calls only the locked
  OpenAI-compatible route with a real signal/timeout, and persists no raw traffic or secrets.
- Strict validation and deterministic caps produce an atomic fact/evidence/membership publication or
  no publication at all.
- Cancellation, restart recovery, document deletion/replacement, route changes, and stale attempts
  cannot publish late results or invalidate the source document/local index.
- Fact queries are display-safe, cursor-bounded, metric-correct, and practical for 1,000 documents.
- Every Profile writer uses global CAS plus exact touched-field revisions; legacy async extraction no
  longer overwrites concurrent manual edits.
- Pending/rejected facts never enter Profile or Agent context. Confirmation/rejection/archive and
  projection reversal preserve evidence/audit history and obey support/field-revision rules.
- Trusted Profile/rule retrieval remains closed until the exact current Profile revision is
  successfully refreshed; raw document retrieval continues.
- Workspace/document lifecycle cleanup is explicit, deterministic, restart-safe, and rejects late
  worker publication.
- Targeted tests, repeated race/recovery tests, full tests, strict changed-file lint, renderer build,
  Electron compile, diff checks, security searches, and independent whole-diff review pass.
- No Plan 3 UI/IPC scope, server synchronization, semantic embedding, automatic/batch extraction, or
  legacy-field retirement is introduced.
