# Independent AI Knowledge Plan 3 Design

Date: 2026-07-13
Branch: `feat/independent-ai-knowledge-backend`
Depends on: Plan 2 backend verification report and its locked handoff contract

## Goal

Expose the verified local AI-knowledge backend through a narrow Electron IPC/preload boundary and
deliver the end-to-end workspace UI for paid extraction, fact review, archive, pagination, and
evidence inspection. The result remains local-first and single-workspace; it introduces no server
synchronization, semantic embedding, automatic extraction, or batch fact mutation.

## Chosen approach

Use a focused module extraction around the existing 2,704-line
`WorkspaceKnowledgeBase.tsx`. The parent continues to own page navigation, company-data maintenance,
the document/AI tab switch, and top-level composition. A new AI-knowledge panel owns normalized fact
state and renders legacy Profile compatibility rows read-only.

Rejected alternatives:

- Extending the existing component inline is initially faster but would combine document ingestion,
  Profile editing, paid model authorization, fact pagination, evidence state, and accessible dialogs
  in one file.
- A new Redux slice would make the state globally durable even though it is scoped to one mounted
  workspace page. Local reducer/hooks with explicit workspace generations provide the required race
  safety without adding global lifecycle complexity.

## Architecture and module boundaries

### Shared renderer contract

Create one shared `KnowledgeBaseRendererApi` contract and use it from main IPC, the preload bridge,
`electron.d.ts`, and the renderer service. Existing document operations remain in the same contract;
the AI surface adds exactly these operations:

| Operation | Renderer request | Display-safe success |
| --- | --- | --- |
| `prepareExtractionAuthorization` | `{ documentId, documentVersionId }` | `KnowledgeExtractionAuthorizationPreparation` |
| `retryLocalIndex` | `{ documentId, documentVersionId }` | `KnowledgeDocumentListItem` |
| `requestExtraction` | `{ authorizationToken }` | `KnowledgeEnrichmentSummary` |
| `retryExtraction` | `{ requestId, authorizationToken }` | `KnowledgeEnrichmentSummary` |
| `cancelExtraction` | `{ requestId, expectedRevision }` | `KnowledgeEnrichmentSummary` |
| `listFacts` | `KnowledgeListFactsRequest` | `KnowledgeFactListResult` |
| `reviewFact` | `KnowledgeReviewFactRequest` | `KnowledgeFactReviewResult` |
| `archiveFact` | `KnowledgeArchiveFactRequest` | `KnowledgeFactArchiveResult` |
| `getFactEvidence` | `KnowledgeFactEvidencePageRequest` | `KnowledgeFactEvidencePageResult` |

No renderer bridge may expose `wake`, `shutdown`, abort controllers, stores, provider/API config,
credentials, raw route data, or routing fingerprints. `KnowledgeBaseIpcError` may add only the
allowlisted projection-conflict DTO already defined in shared types.

### Main-process adapter

`registerKnowledgeBaseHandlers` will depend on the composed Plan 2 foundation rather than separate
uncoordinated readiness flags. All document and AI operations await the same idempotent `whenReady()`
Promise before reading state, mutating facts, issuing authorization, or starting a model request.

Runtime validation accepts plain own data only. Each operation uses an exact key allowlist and rejects
arrays, class instances, accessors/proxies that cannot be safely read, unknown keys, invalid enums,
empty identifiers, invalid revisions, duplicate/malformed filter values, and illegal optional-field
combinations. `ownerId` is always derived from `event.sender.id`; an input containing `ownerId` is an
`invalid_request`.

One idempotent WebContents `destroyed` listener clears both selection tokens and unconsumed extraction
authorizations. File selection plus prepare/request/retry paths ensure it is registered. A window
closing after a request is durably committed does not delete or cancel that request.

Legal review combinations are exact:

- Reject accepts neither `replaceExisting` nor `expectedFieldRevision`.
- Ordinary confirm rejects `expectedFieldRevision`; company replacement requires both
  `replaceExisting=true` and `expectedFieldRevision`.
- `KeepCurrent` rejects `expectedFieldRevision`.
- `RemoveCurrent` requires `expectedFieldRevision`.
- Missing optional fields stay absent and are never silently defaulted by the IPC adapter.

### Preload and renderer service

`createKnowledgeBasePreloadBridge` is the only channel-to-method mapper. The renderer service imports
the same shared API type and converts failed IPC results into `KnowledgeBaseServiceError`. The error
contains only the fixed code, optional safe file/document fields, and optional projection-conflict
DTO. It never logs or rethrows an untyped bridge error message, stack, path, provider endpoint, token,
route, SQL, source text, or model traffic.

### Renderer components

Add these focused modules under
`src/renderer/components/enterpriseLeadWorkspace/`:

- `WorkspaceAiKnowledgePanel.tsx`: table, filters, pagination controls, row actions, empty/loading/
  partial states, and composition of dialogs/evidence.
- `useWorkspaceAiKnowledge.ts`: normalized fact loader, pagination, mutations, trailing refresh,
  polling, evidence request ownership, and workspace/generation guards.
- `workspaceAiKnowledgeRows.ts`: pure composition of normalized facts with deduplicated legacy
  Profile rows plus display/status helpers.
- `WorkspaceKnowledgeExtractionDialog.tsx`: authorization disclosure and explicit paid send/cancel.
- `WorkspaceKnowledgeFactDialogs.tsx`: company replacement and archive keep/remove confirmation.
- `WorkspaceKnowledgeFactEvidence.tsx`: one-row evidence disclosure and page append behavior.

`WorkspaceKnowledgeBase.tsx` replaces only its AI-tab branch with the new panel and receives metrics
through a callback. It does not undergo a broad page rewrite. `WorkspaceKnowledgeDocumentsPanel`
adds document-level extraction/retry/cancel actions while keeping document parsing, local indexing,
and paid enrichment as three independently rendered states.

## Renderer data model

The AI table uses this discriminated union:

```ts
type WorkspaceAiKnowledgeRow =
  | { kind: 'normalized_fact'; fact: KnowledgeFactSummary }
  | { kind: 'legacy_profile'; item: LegacyProfileKnowledgeSummary };
```

Normalized rows support only single-row review, archive, and evidence actions. They never call the
legacy Profile save path directly and never participate in checkbox or batch-Profile helpers. Legacy
Profile rows are confirmed, read-only, and deduplicated against normalized confirmed facts; editing
remains available through “维护公司资料”. Source documents, run snapshots, deliverables, and archives
never masquerade as facts.

Normalized search is hidden because the backend does not implement whole-workspace search. Filters
are backend-backed: list view, review status, and evidence state. Legacy compatibility rows are
composed after each normalized page result without altering backend metrics.

## State and race rules

Document loading and fact loading use independent monotonic workspace generations. Every response is
accepted only if its workspace and generation are current.

Fact pagination follows these rules:

- Workspace, filter, or mutation changes clear items/cursor and invalidate prior load-more requests.
- Pages append by fact ID; a greater revision replaces an older item.
- `nextCursor=null` ends pagination.
- Metrics are replaced from every backend response because they cover the full workspace; pages are
  never summed and metrics are never recomputed from rendered rows or Profile.
- If a refresh is requested while a load is active, a trailing-refresh latch guarantees one fresh
  load after the active request settles.

Document enrichment follows the current-version summary in `KnowledgeDocumentListItem.enrichment`.
A current queued/running/review/terminal summary always wins. The stale-prior-version marker offers
“提取当前版本” only when current enrichment is `null`; it never creates a duplicate paid action.
Request, retry, cancel, and `review_required` refreshes cannot be overwritten by older terminal list
responses.

At most one fact row is expanded for evidence. Expansion fetches the first page; “加载更多” performs
exactly one additional request and deduplicates by evidence ID. Requests carry `expectedRevision` and
are accepted only when response fact ID/revision still match the expanded row. Collapse, workspace
change, fact revision change, review/archive, and `job_state_conflict` clear and invalidate evidence.

## User flows

### Paid extraction

1. A ready and locally indexed current document exposes “提取 AI 知识”.
2. Renderer calls `prepareExtractionAuthorization`; this creates no durable request/model call.
3. A modal names the document, provider/model, planned calls, partial-input warning, and expiry.
4. Cancel closes the dialog with zero request. Explicit send consumes the authorization once.
5. The send button is guarded against double activation; backend idempotency remains authoritative.
6. Retry first obtains a new authorization, then calls `retryExtraction`.
7. Queued/running work shows live progress and an explicit cancel action.

### Review and archive

- Pending fact confirm/reject uses current fact revision.
- Company-summary replacement first surfaces the safe current value/field revision conflict, then
  requires explicit replacement confirmation.
- Confirmed fact archive follows backend conflict semantics. `KeepCurrent` preserves Profile;
  `RemoveCurrent` requires the displayed field revision. A ledgerless recovery conflict exposes only
  `KeepCurrent`.
- Successful mutations refresh facts and workspace/Profile independently; a stale response cannot
  overwrite either result.

### Evidence

The row preview uses only the backend-provided preview. Expansion loads the first evidence page on
demand and shows document name, bounded quote, confidence, active/stale status, and time. No evidence
request is issued for collapsed rows or as part of table rendering.

## Accessibility and internationalization

All new visible copy is added centrally in both Chinese and English. Missing-key fallback, key echo,
and hardcoded visible strings are test failures.

Authorization, evidence, company conflict, and archive dialogs provide `role="dialog"`,
`aria-modal="true"`, labelled title/description, safe initial focus, Tab/Shift+Tab trapping, Escape,
and focus restoration. The paid send button is not the accidental default focus. Buttons have
accessible names and visible disabled reasons. Progress and mutation feedback use live regions and
text/icon cues rather than color alone.

## Error and privacy behavior

Renderer messages map fixed safe error codes to localized copy. A projection conflict may display
only its allowlisted DTO. `job_state_conflict` invalidates stale row/evidence state and forces refresh.
Unknown errors become a fixed generic failure.

Tests and manual DevTools inspection must prove that authorization tokens, credentials, provider
endpoints, route fingerprints, raw source text, paths, SQL, stacks, and causes never enter DOM text,
URLs, renderer persistence, logs, or IPC errors. Authorization tokens exist only in transient
component state until send/cancel/unmount and are never persisted.

## Testing strategy

Implementation is test-first and task-scoped:

- Shared contract tests lock channels, exact DTO keys, operation types, and safe error serialization.
- Main IPC tests cover readiness awaiting, allowlist validation, owner spoofing, destruction races,
  replay/idempotency, legal decision combinations, and error privacy.
- Preload/service tests prove exact channel/request mapping and typed safe failures.
- Pure row/state tests cover legacy dedup, filters, metrics replacement, pagination merge, stale
  generation rejection, trailing refresh, and current-version enrichment priority.
- Component tests cover extraction cancel/double-click/retry, independent statuses, fact review and
  archive conflicts, evidence pagination/no N+1, keyboard/focus/dialog/live-region behavior, and both
  locales.
- Final verification includes focused Vitest, repeated race cases, full `npm test`, changed-file
  strict ESLint, `npm run build`, `npm run compile:electron`, diff checks, independent whole-diff
  review, and the manual Electron checklist.

## Manual acceptance

- Cancel at authorization confirmation creates zero durable request/model call.
- Double-click send is idempotent; retry requires a fresh authorization.
- Parsing, local index, and enrichment statuses/retries remain independent.
- Pending/confirmed/rejected/archived/stale facts and active/stale/any evidence filters are correct.
- Company replacement and archive keep/remove conflicts are revision-safe.
- Pagination, deduplication, full-workspace metrics, evidence load-more, and no N+1 behavior remain
  correct with 100–1,000 documents.
- Request/retry/cancel/review trailing refreshes defeat stale responses.
- Stale prior-version extraction never overrides or duplicates the current-version action.
- Chinese/English copy and keyboard/focus/dialog/live-region behavior pass.
- Privacy inspection finds none of the forbidden values in renderer-visible or persisted surfaces.

## Out of scope

- Enterprise server synchronization or multi-device collaboration.
- Semantic/vector embedding changes.
- Automatic, batch, or background paid extraction without explicit authorization.
- Backend whole-workspace free-text fact search.
- Batch mutation of normalized facts.
- Retirement or migration of legacy Profile knowledge fields.
- Git staging, commits, merges, pushes, or release packaging before user acceptance.
