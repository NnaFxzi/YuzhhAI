# Independent AI Knowledge Plan 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the verified Plan 2 AI-knowledge backend through a narrow Electron bridge and deliver the local workspace UI for explicit extraction, fact review/archive, pagination, and evidence inspection.

**Architecture:** One shared renderer API contract drives main IPC, preload, renderer typing, and the renderer service. Main handlers await the shared Foundation readiness Promise and bind authorization ownership to WebContents. Renderer behavior is split into a pure row/state layer, a workspace-scoped hook, focused extraction/fact/evidence components, and a thin integration into the existing knowledge page.

**Tech Stack:** Electron IPC/contextBridge, TypeScript, React hooks/reducer, Tailwind, Vitest, Testing Library, SQLite-backed Plan 2 services.

## Global Constraints

- Bridge exactly nine Plan 3 operations: `prepareExtractionAuthorization`, `retryLocalIndex`, `requestExtraction`, `retryExtraction`, `cancelExtraction`, `listFacts`, `reviewFact`, `archiveFact`, and `getFactEvidence`.
- Do not expose `wake`, `shutdown`, abort controllers, store primitives, API/provider configuration, credentials, raw routes, or routing fingerprints.
- Main derives `ownerId` only from `event.sender.id`; renderer/preload request types never include it.
- All IPC inputs must be plain own data with exact operation key allowlists; extra or illegal field combinations return fixed `invalid_request`.
- All knowledge operations await the same Foundation `whenReady()` Promise.
- Normalized facts use only single-row review/archive/evidence operations. Legacy Profile rows are read-only and remain editable only through company-data maintenance.
- Parsing, local index, and paid enrichment are independent states and retries.
- Fact metrics always come from backend full-workspace metrics; never sum pages or derive them from rendered rows/Profile.
- Evidence is loaded only for one explicitly expanded row, one request per page action, guarded by fact ID and revision.
- All visible copy must exist centrally in both `zh` and `en`; no hardcoded user-visible strings or key echo.
- Dialogs require accessible title/description, `role="dialog"`, `aria-modal`, safe initial focus, focus trap/restoration, and Escape behavior.
- Authorization tokens, credentials, endpoints, routing fingerprints, paths, SQL, stacks, causes, source text, and model traffic must not enter renderer persistence, DOM, URLs, logs, or display errors.
- Follow strict RED → GREEN → focused regression for every behavior. No production code before a failing test.
- Keep changes scoped; do not broadly rewrite `WorkspaceKnowledgeBase.tsx`.
- Do not stage, commit, merge, or push before user manual acceptance. Per-task review packages replace commit checkpoints.

## Execution bookkeeping

Before Task 1, the controller creates `.superpowers/sdd/plan-3-start`,
`.superpowers/sdd/plan-3-progress.md`, `.superpowers/sdd/plan-3/reports/`, and
`.superpowers/sdd/plan-3/reviews/`. The marker is created before any Plan 3 source/test edit and is
used only to construct the changed-file lint manifest. The progress ledger records one row per task,
its report/package paths, and separate specification/code-review verdicts. These ignored artifacts are
never staged or committed.

---

### Task 1: Freeze the Shared Renderer API and IPC Channels

**Files:**
- Modify: `src/shared/knowledgeBase/constants.ts`
- Modify: `src/shared/knowledgeBase/types.ts`
- Modify: `src/shared/knowledgeBase/contracts.test.ts`

**Interfaces:**
- Consumes: Plan 2 request/result DTOs in `src/shared/knowledgeBase/types.ts`.
- Produces: `KnowledgeBaseRendererApi`, extended `KnowledgeBaseIpcError`, and stable channel constants used by Tasks 2–3.

- [ ] **Step 1: Write failing contract tests for the eight new channels and shared API**

Add exact assertions to `contracts.test.ts`:

```ts
expect(KnowledgeBaseIpc).toEqual({
  DeleteDocument: 'knowledgeBase:documents:delete',
  GetDocumentDetails: 'knowledgeBase:documents:getDetails',
  ImportSelection: 'knowledgeBase:documents:importSelection',
  ListDocuments: 'knowledgeBase:documents:list',
  RestoreDocument: 'knowledgeBase:documents:restore',
  RetryDocument: 'knowledgeBase:documents:retry',
  RetryLocalIndex: 'knowledgeBase:documents:retryLocalIndex',
  SelectFiles: 'knowledgeBase:files:select',
  PrepareExtractionAuthorization: 'knowledgeBase:extraction:prepareAuthorization',
  RequestExtraction: 'knowledgeBase:extraction:request',
  RetryExtraction: 'knowledgeBase:extraction:retry',
  CancelExtraction: 'knowledgeBase:extraction:cancel',
  ListFacts: 'knowledgeBase:facts:list',
  ReviewFact: 'knowledgeBase:facts:review',
  ArchiveFact: 'knowledgeBase:facts:archive',
  GetFactEvidence: 'knowledgeBase:facts:getEvidence',
});
```

Construct a compile-time `KnowledgeBaseRendererApi` fixture whose methods accept the exact shared
requests and return `Promise<KnowledgeBaseIpcResult<...>>`. Assert a projection error serializes only
`code` and `projectionConflict` with the exact conflict DTO keys.

- [ ] **Step 2: Run the shared test and verify RED**

Run:

```bash
npm test -- src/shared/knowledgeBase/contracts.test.ts
```

Expected: FAIL because the channels, shared API, and safe conflict field do not exist.

- [ ] **Step 3: Add the channel constants and shared contract**

Extend `KnowledgeBaseIpc` with the exact strings from Step 1. Extend the error and define the one API:

```ts
export interface KnowledgeBaseIpcError {
  code: KnowledgeBaseErrorCode;
  fileName?: string;
  latestDocument?: KnowledgeDocumentListItem;
  projectionConflict?: KnowledgeFactProjectionConflict;
}

export interface KnowledgePrepareExtractionAuthorizationRequest {
  documentId: string;
  documentVersionId: string;
}

export interface KnowledgeRequestExtractionRequest {
  authorizationToken: string;
}

export interface KnowledgeRetryExtractionRequest {
  requestId: string;
  authorizationToken: string;
}

export interface KnowledgeCancelExtractionRequest {
  requestId: string;
  expectedRevision: number;
}

export interface KnowledgeBaseRendererApi {
  selectFiles(): Promise<KnowledgeBaseIpcResult<KnowledgeFileSelection | null>>;
  importSelection(input: KnowledgeImportSelectionRequest): Promise<KnowledgeBaseIpcResult<KnowledgeImportBatchResult>>;
  listDocuments(input: KnowledgeListDocumentsRequest): Promise<KnowledgeBaseIpcResult<KnowledgeDocumentListItem[]>>;
  getDocumentDetails(input: KnowledgeDocumentDetailsRequest): Promise<KnowledgeBaseIpcResult<KnowledgeDocumentDetails>>;
  deleteDocument(input: KnowledgeDocumentRevisionRequest): Promise<KnowledgeBaseIpcResult<KnowledgeDocumentListItem>>;
  restoreDocument(input: KnowledgeDocumentRevisionRequest): Promise<KnowledgeBaseIpcResult<KnowledgeDocumentListItem>>;
  retryDocument(input: KnowledgeRetryDocumentRequest): Promise<KnowledgeBaseIpcResult<KnowledgeDocumentListItem>>;
  retryLocalIndex(input: KnowledgeRetryLocalIndexRequest): Promise<KnowledgeBaseIpcResult<KnowledgeDocumentListItem>>;
  prepareExtractionAuthorization(input: KnowledgePrepareExtractionAuthorizationRequest): Promise<KnowledgeBaseIpcResult<KnowledgeExtractionAuthorizationPreparation>>;
  requestExtraction(input: KnowledgeRequestExtractionRequest): Promise<KnowledgeBaseIpcResult<KnowledgeEnrichmentSummary>>;
  retryExtraction(input: KnowledgeRetryExtractionRequest): Promise<KnowledgeBaseIpcResult<KnowledgeEnrichmentSummary>>;
  cancelExtraction(input: KnowledgeCancelExtractionRequest): Promise<KnowledgeBaseIpcResult<KnowledgeEnrichmentSummary>>;
  listFacts(input: KnowledgeListFactsRequest): Promise<KnowledgeBaseIpcResult<KnowledgeFactListResult>>;
  reviewFact(input: KnowledgeReviewFactRequest): Promise<KnowledgeBaseIpcResult<KnowledgeFactReviewResult>>;
  archiveFact(input: KnowledgeArchiveFactRequest): Promise<KnowledgeBaseIpcResult<KnowledgeFactArchiveResult>>;
  getFactEvidence(input: KnowledgeFactEvidencePageRequest): Promise<KnowledgeBaseIpcResult<KnowledgeFactEvidencePageResult>>;
}
```

The four named extraction request interfaces are the only renderer-visible extraction inputs; none
contains an owner, route, provider configuration, or credential field.

- [ ] **Step 4: Run shared contracts and strict lint**

```bash
npm test -- src/shared/knowledgeBase/contracts.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/shared/knowledgeBase/constants.ts \
  src/shared/knowledgeBase/types.ts \
  src/shared/knowledgeBase/contracts.test.ts
```

Expected: PASS, zero warnings.

- [ ] **Step 5: Create the Task 1 report and review package**

Record RED/GREEN output, exact public types, and changed files under
`.superpowers/sdd/plan-3/reports/task-1.md`. Generate a task-scoped package under
`.superpowers/sdd/plan-3/reviews/` without staging or committing.

---

### Task 2: Implement the Owner-Bound Main IPC Adapter

**Files:**
- Modify: `src/main/knowledgeBase/ipcHandlers.ts`
- Modify: `src/main/knowledgeBase/ipcHandlers.test.ts`
- Modify: `src/main/main.ts`

**Interfaces:**
- Consumes: `KnowledgeBaseRendererApi`, `KnowledgeBaseIpc`, and the composed `KnowledgeBaseFoundation`.
- Produces: all nine ready-gated renderer operations and safe error mapping.

- [ ] **Step 1: Write failing handler tests for shared readiness and exact validation**

Create a Foundation mock containing `whenReady`, document/selection/authorization/enrichment/fact
services, and the fact projector. Test that every handler awaits one unresolved readiness Promise
before invoking its backend operation. Add table-driven rejection tests for non-object input,
prototype/accessor input, extra fields, empty IDs, invalid revisions/enums/filters, duplicate filter
values, `ownerId` spoofing, and every illegal review/archive optional-field combination.

Use tests shaped like:

```ts
const ready = deferred<void>();
const invocation = invoke(KnowledgeBaseIpc.ListFacts, {
  workspaceId: 'workspace-a',
  view: KnowledgeFactListView.Active,
});
expect(foundation.factQueryService.listFacts).not.toHaveBeenCalled();
ready.resolve();
await expect(invocation).resolves.toMatchObject({ success: true });
```

- [ ] **Step 2: Write failing owner cleanup and race tests**

Assert exactly one `destroyed` listener per WebContents. Preparing, requesting, or retrying extraction
registers it. Destruction clears `selectionTokenStore.clearOwner(ownerId)` and
`authorizationStore.clearOwner(ownerId)` once. Cover destruction during prepare and authorization
consume, late callbacks, receipt replay, and an already committed durable request remaining present.

- [ ] **Step 3: Write failing safe error tests**

Throw each typed backend error through a handler and assert the renderer result includes only fixed
codes, safe file/document fields, or the allowlisted projection conflict. Secret path/token/endpoint/
route/SQL/stack/cause sentinels must be absent from serialized results and logs.

- [ ] **Step 4: Run the main handler test and verify RED**

```bash
npm test -- src/main/knowledgeBase/ipcHandlers.test.ts
```

Expected: FAIL because the adapter still checks immediate `isReady`, exposes only document handlers,
and clears selection tokens only.

- [ ] **Step 5: Implement exact plain-own-data readers and safe error mapping**

Replace permissive record readers with a helper that verifies `Object.getPrototypeOf(value)` is
`Object.prototype` or `null`, reads own data properties only, and compares `Object.keys` to an exact
allowlist. Implement operation-specific readers that preserve absent optional fields.

Map only these typed families: document/selection, authorization, enrichment request, fact state,
fact projector, and projection conflict. A `KnowledgeFactProjectionConflictError` returns:

```ts
{
  code: KnowledgeBaseErrorCode.FactProjectionConflict,
  projectionConflict: error.conflict,
}
```

Unknown errors return `{ code: KnowledgeBaseErrorCode.PersistenceFailed }` and log only a fixed module
tag/code, never the raw error.

- [ ] **Step 6: Register all nine ready-gated handlers**

Use one async wrapper:

```ts
const invokeWhenReady = async <T>(operation: () => T | Promise<T>) => {
  try {
    await deps.foundation.whenReady();
    return { success: true as const, data: await operation() };
  } catch (error) {
    return { success: false as const, error: toIpcError(error) };
  }
};
```

Prepare/request/retry pass `ownerId: event.sender.id`; cancel/list/review/archive/evidence never accept
or inject owner IDs. Register cleanup before issuing or consuming authorization.

- [ ] **Step 7: Wire the composed Foundation in main**

Change registration from separate `isReady`/document/token dependencies to:

```ts
registerKnowledgeBaseHandlers({
  foundation: knowledgeBase,
  showOpenDialog,
  statSelectedFile,
});
```

Keep dialog/file inspection behavior unchanged.

- [ ] **Step 8: Run focused tests, build, and strict lint**

```bash
npm test -- \
  src/main/knowledgeBase/ipcHandlers.test.ts \
  src/main/knowledgeBase/knowledgeBaseFoundation.test.ts
npm run build
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/main/knowledgeBase/ipcHandlers.ts \
  src/main/knowledgeBase/ipcHandlers.test.ts \
  src/main/main.ts
```

Expected: PASS, zero warnings.

- [ ] **Step 9: Create the Task 2 report and review package**

Record readiness, owner-race, validation, and privacy evidence in
`.superpowers/sdd/plan-3/reports/task-2.md`; generate an unstaged task package for independent review.

---

### Task 3: Unify Preload, Electron Typing, and Renderer Service

**Files:**
- Modify: `src/main/knowledgeBase/preloadBridge.ts`
- Modify: `src/main/knowledgeBase/preloadBridge.test.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Modify: `src/renderer/services/knowledgeBase.ts`
- Modify: `src/renderer/services/knowledgeBase.test.ts`

**Interfaces:**
- Consumes: Task 1 `KnowledgeBaseRendererApi` and Task 2 channels.
- Produces: typed renderer methods used by document and AI hooks.

- [ ] **Step 1: Write failing exact-channel preload tests**

For every AI method, invoke the bridge with a representative request and assert exactly one call to
the matching `KnowledgeBaseIpc` channel with the same object identity/keys. Assert no extra bridge
method exists for wake/shutdown/store/config/credential/route operations.

- [ ] **Step 2: Write failing renderer service tests**

Test success passthrough for all AI methods. Test a safe projection conflict becomes a
`KnowledgeBaseServiceError` containing only `code` and `projectionConflict`. Throw an untyped bridge
error with secret message/stack and assert the service throws a fixed generic error and emits no raw
diagnostic.

- [ ] **Step 3: Run the preload/service tests and verify RED**

```bash
npm test -- \
  src/main/knowledgeBase/preloadBridge.test.ts \
  src/renderer/services/knowledgeBase.test.ts
```

Expected: FAIL because the shared contract is not implemented across preload/service.

- [ ] **Step 4: Make the preload bridge implement the shared API**

Declare:

```ts
export type KnowledgeBasePreloadBridge = KnowledgeBaseRendererApi;
```

Map each shared API method to its exact channel. Keep `src/main/preload.ts` exposing only
`createKnowledgeBasePreloadBridge(...)` under `window.electron.knowledgeBase`.

- [ ] **Step 5: Remove handwritten Electron and renderer API variants**

In `electron.d.ts`, type `knowledgeBase` as `KnowledgeBaseRendererApi`. In the renderer service,
delete its local `KnowledgeBaseApi` and import the shared interface. Add service methods with the exact
shared request/result types. Preserve safe optional fields on `KnowledgeBaseServiceError`:

```ts
readonly projectionConflict?: KnowledgeFactProjectionConflict;
```

- [ ] **Step 6: Run focused tests, build, and strict lint**

```bash
npm test -- \
  src/main/knowledgeBase/preloadBridge.test.ts \
  src/renderer/services/knowledgeBase.test.ts \
  src/shared/knowledgeBase/contracts.test.ts
npm run build
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/main/knowledgeBase/preloadBridge.ts \
  src/main/knowledgeBase/preloadBridge.test.ts \
  src/main/preload.ts \
  src/renderer/types/electron.d.ts \
  src/renderer/services/knowledgeBase.ts \
  src/renderer/services/knowledgeBase.test.ts
```

- [ ] **Step 7: Create the Task 3 report and review package**

Record exact method/channel mapping and safe-error evidence in
`.superpowers/sdd/plan-3/reports/task-3.md`; generate an unstaged review package.

---

### Task 4: Build the Pure AI Row and Workspace State Model

**Files:**
- Create: `src/renderer/components/enterpriseLeadWorkspace/workspaceAiKnowledgeRows.ts`
- Create: `src/renderer/components/enterpriseLeadWorkspace/workspaceAiKnowledgeRows.test.ts`
- Create: `src/renderer/components/enterpriseLeadWorkspace/workspaceAiKnowledgeState.ts`
- Create: `src/renderer/components/enterpriseLeadWorkspace/workspaceAiKnowledgeState.test.ts`

**Interfaces:**
- Consumes: `KnowledgeFactSummary`, `KnowledgeFactMetrics`, Profile fields, and Plan 2 enums.
- Produces: `WorkspaceAiKnowledgeRow`, `LegacyProfileKnowledgeSummary`, row composition, reducer state,
  pagination/evidence guards used by Tasks 5–7.

- [ ] **Step 1: Write failing legacy composition tests**

Define wished-for types:

```ts
export interface LegacyProfileKnowledgeSummary {
  id: string;
  domain: KnowledgeFactDomain;
  value: string;
  knowledgeKey: string;
}

export type WorkspaceAiKnowledgeRow =
  | { kind: 'normalized_fact'; fact: KnowledgeFactSummary }
  | { kind: 'legacy_profile'; item: LegacyProfileKnowledgeSummary };
```

Test all Profile domains, canonical whitespace/case deduplication, self-deduplication, exclusion of
empty values, exclusion when a normalized confirmed fact has the same key, stable IDs, and no source/
run/deliverable rows. Assert legacy rows are always read-only.

- [ ] **Step 2: Write failing pagination and metrics reducer tests**

Use a reducer whose state includes workspace generation, filter key, items, cursor, metrics,
loading/mutating flags, request generation, and trailing refresh. Test reset on workspace/filter,
append-by-ID, newer-revision wins, older-revision ignored, `nextCursor=null`, stale generation ignored,
and metrics replaced rather than summed.

- [ ] **Step 3: Write failing evidence ownership tests**

State supports one expanded fact with items/cursor/loading/request generation. Test first-page replace,
load-more dedup by evidence ID, stale fact/revision response ignored, and invalidation on collapse,
workspace change, fact revision mutation, review/archive, and `job_state_conflict`.

- [ ] **Step 4: Run the pure tests and verify RED**

```bash
npm test -- \
  src/renderer/components/enterpriseLeadWorkspace/workspaceAiKnowledgeRows.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/workspaceAiKnowledgeState.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 5: Implement the minimal pure modules**

Use `buildEnterpriseKnowledgeKey` for identities. Keep state transitions as pure functions with
explicit action payloads; never read `window`, call services, translate copy, or mutate Profile.
Normalized free-text search is absent from state.

- [ ] **Step 6: Run pure tests and strict lint**

```bash
npm test -- \
  src/renderer/components/enterpriseLeadWorkspace/workspaceAiKnowledgeRows.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/workspaceAiKnowledgeState.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/renderer/components/enterpriseLeadWorkspace/workspaceAiKnowledgeRows.ts \
  src/renderer/components/enterpriseLeadWorkspace/workspaceAiKnowledgeRows.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/workspaceAiKnowledgeState.ts \
  src/renderer/components/enterpriseLeadWorkspace/workspaceAiKnowledgeState.test.ts
```

- [ ] **Step 7: Create the Task 4 report and review package**

Record dedup, pagination, metrics, and evidence ownership matrices in
`.superpowers/sdd/plan-3/reports/task-4.md`; generate an unstaged review package.

---

### Task 5: Add Document Extraction Authorization and Independent Status Controls

**Files:**
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeExtractionDialog.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeExtractionDialog.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts`

**Interfaces:**
- Consumes: Task 3 renderer service and `KnowledgeDocumentListItem.enrichment`.
- Produces: prepare/send/retry/cancel document actions and an accessible authorization dialog.

- [ ] **Step 1: Write failing presentation tests for three independent states**

Create test cases where parsing fails but local index/enrichment do not, local index fails while the
document remains parsed, and enrichment is queued/running/review/failed/cancelled independently.
Assert current-version enrichment always wins. `hasStalePriorVersionExtraction` offers “extract
current version” only when `enrichment === null`.

- [ ] **Step 2: Write failing authorization dialog accessibility tests**

Render a descriptor and assert document/provider/model/planned-call/partial/expiry text, dialog
semantics, labelled title/description, initial focus on cancel or close rather than paid send, focus
trap, Escape, and restoration. Cancel must not call request. Rapid double activation must call send
once.

- [ ] **Step 3: Write failing document action/race tests**

Test prepare → cancel creates no request, prepare → explicit send updates enrichment, retry always
prepares a fresh token before `retryExtraction`, cancel uses current request revision, and stale list
responses cannot replace a newer request/retry/cancel result. A mutation during load schedules one
trailing refresh.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
npm test -- \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeExtractionDialog.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts
```

- [ ] **Step 5: Implement extraction actions and dialog**

Keep the authorization token only in mounted dialog state. Disable paid send while consuming. Clear
the token on cancel, success, Escape, and unmount. Apply returned summaries/documents only through the
current workspace/document generation, then force a trailing document refresh.

- [ ] **Step 6: Render separate status rows and controls**

The document card/table must retain distinct “文档解析”, “本地搜索索引”, and “AI 知识提取” rows.
Each row displays its own progress/error/retry action; no combined generic status or retry is added.

- [ ] **Step 7: Run focused tests, build, and strict lint**

```bash
npm test -- \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeExtractionDialog.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts
npm run build
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeExtractionDialog.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeExtractionDialog.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.ts \
  src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts
```

- [ ] **Step 8: Create the Task 5 report and review package**

Record authorization lifecycle, independent-state, race, and accessibility evidence in
`.superpowers/sdd/plan-3/reports/task-5.md`; generate an unstaged review package.

---

### Task 6: Implement the Workspace Fact Hook and AI Knowledge Panel

**Files:**
- Create: `src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledge.ts`
- Create: `src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledge.test.ts`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4 service/state/row modules and current workspace/Profile.
- Produces: normalized/legacy list UI, backend filters, metrics callback, pagination, polling, and
  mutation refresh entry points used by Task 7.

- [ ] **Step 1: Write failing hook tests for initial load, filters, and pagination**

Test active/history views, pending/confirmed/rejected/archived states, active/stale/any evidence
filtering, initial and load-more cursors, append dedup, metrics replacement, workspace/filter reset,
latest-request-wins, and trailing refresh after a mutation during load.

- [ ] **Step 2: Write failing polling and current-generation tests**

When a document request reaches `review_required`, trigger exactly one fresh fact load. Old terminal
responses cannot stop polling for a current queued/running request. Workspace changes stop old polling
and invalidate list/evidence responses.

- [ ] **Step 3: Write failing panel tests for normalized and legacy rows**

Assert normalized rows have no checkbox/edit/batch-Profile actions. Legacy rows are labelled read-only
and link only to company maintenance. Search input is absent. Empty/loading/error/partial states and
load-more controls have accessible names. Top metrics use the backend metrics callback, not DOM counts.

- [ ] **Step 4: Run hook/panel tests and verify RED**

```bash
npm test -- \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledge.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts
```

- [ ] **Step 5: Implement the hook with reducer-owned request generations**

The hook exposes rows, metrics, filters, loading/error/partial state, `loadMore`, `refreshAfterMutation`,
and row mutation/evidence entry points. It never persists renderer state and never directly writes
Profile.

- [ ] **Step 6: Implement the table and backend filters**

Render one table with discriminated rows. Normalized status/action cells derive from shared enums;
legacy cells are confirmed/read-only. Hide free-text search. Use backend-provided `nextCursor` and
full-workspace metrics.

- [ ] **Step 7: Run focused tests, build, and strict lint**

```bash
npm test -- \
  src/renderer/components/enterpriseLeadWorkspace/workspaceAiKnowledgeRows.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/workspaceAiKnowledgeState.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledge.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts
npm run build
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledge.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledge.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts
```

- [ ] **Step 8: Create the Task 6 report and review package**

Record filter/pagination/metrics/polling/race matrices in
`.superpowers/sdd/plan-3/reports/task-6.md`; generate an unstaged review package.

---

### Task 7: Add Fact Review, Archive Conflict, and Evidence UI

**Files:**
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactDialogs.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactDialogs.test.ts`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidence.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidence.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledge.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledge.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts`

**Interfaces:**
- Consumes: Task 6 hook/panel and Task 3 review/archive/evidence service methods.
- Produces: complete normalized fact mutation and evidence workflows.

- [ ] **Step 1: Write failing review/archive tests**

Test ordinary confirm/reject, company replacement conflict followed by revision-aware retry, archive
default conflict, KeepCurrent, RemoveCurrent with exact field revision, and ledgerless conflict showing
KeepCurrent only. Assert successful mutation clears evidence, invalidates old responses, refreshes
facts, and invokes workspace/Profile refresh only when `profileChanged=true`.

- [ ] **Step 2: Write failing evidence tests**

Expansion loads one first page only. “Load more” makes one request per action, deduplicates by ID, and
stops at null cursor. Test active/stale indicators, preview reuse without extra request, fact/revision
response validation, collapse/workspace/mutation/job-state invalidation, and no N+1 requests while
rendering many rows.

- [ ] **Step 3: Write failing dialog and keyboard tests**

Cover title/description labels, `role="dialog"`, `aria-modal`, safe initial focus, focus trap, Escape,
focus restoration, named buttons, visible disabled reasons, and live mutation feedback. Ensure
Enter/Space cannot accidentally choose paid/removal actions from the wrong control.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
npm test -- \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactDialogs.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidence.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledge.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts
```

- [ ] **Step 5: Implement review/archive orchestration**

Use the row revision captured at action time. Projection conflicts open a dialog from the safe DTO;
retry sends only legal fields. On `job_state_conflict` clear row evidence and force a list refresh.
Unknown errors map to generic localized feedback.

- [ ] **Step 6: Implement evidence disclosure and page ownership**

Render only the expanded row's state. Send `expectedRevision` for every page. Verify response fact ID
and revision before replacing/appending. Keep document name, bounded quote, confidence, stale state,
and created time display-safe.

- [ ] **Step 7: Run focused tests, build, and strict lint**

```bash
npm test -- \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactDialogs.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidence.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledge.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts
npm run build
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactDialogs.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactDialogs.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidence.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidence.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledge.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledge.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts
```

- [ ] **Step 8: Create the Task 7 report and review package**

Record conflict, evidence, no-N+1, and keyboard evidence in
`.superpowers/sdd/plan-3/reports/task-7.md`; generate an unstaged review package.

---

### Task 8: Integrate the Page, Add zh/en Copy, and Complete Plan 3 Verification

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/index.ts`
- Modify: `src/renderer/services/i18n.ts`
- Create: `.superpowers/sdd/plan-3/reports/final-verification.md`

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces: the end-to-end Plan 3 workspace experience and final acceptance evidence.

- [ ] **Step 1: Write failing parent-integration tests**

Assert the AI tab mounts `WorkspaceAiKnowledgePanel`, the document tab retains
`WorkspaceKnowledgeDocumentsPanel`, top metrics receive backend counts, Profile refresh occurs after
projection-changing mutations, and old legacy checkbox/edit/batch controls are absent for normalized
rows. Verify company maintenance remains the only legacy edit path.

- [ ] **Step 2: Write failing bilingual copy tests**

Enumerate every new status/action/filter/dialog/error/empty/loading/partial/accessibility key and assert
both locales return non-empty translated text different from the key. Scan the new components for
hardcoded Chinese/English visible strings.

- [ ] **Step 3: Run integration/i18n tests and verify RED**

```bash
npm test -- \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts \
  src/renderer/services/i18n.brand.test.ts
```

- [ ] **Step 4: Replace only the AI branch and add copy**

Keep company/profile/document code in the parent. Replace the old AI table branch with the new panel,
pass workspace/Profile and explicit callbacks, and delete only now-unused normalized legacy batch/edit
state. Add every new key in both `zh` and `en` dictionaries.

- [ ] **Step 5: Run the complete focused Plan 3 suite**

```bash
npm test -- \
  src/shared/knowledgeBase/contracts.test.ts \
  src/main/knowledgeBase/ipcHandlers.test.ts \
  src/main/knowledgeBase/preloadBridge.test.ts \
  src/renderer/services/knowledgeBase.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/workspaceAiKnowledgeRows.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/workspaceAiKnowledgeState.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeExtractionDialog.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledge.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactDialogs.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidence.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.test.ts
```

Expected: all files and tests pass with zero unhandled warnings.

- [ ] **Step 6: Run repository and Electron gates**

Run serially, with Node tests before Electron native rebuild:

```bash
npm test
npm run build
find src/main/knowledgeBase src/renderer/components/enterpriseLeadWorkspace \
  src/renderer/services src/renderer/types src/shared/knowledgeBase \
  -type f \( -name '*.ts' -o -name '*.tsx' \) -newer .superpowers/sdd/plan-3-start \
  -print0 | xargs -0 npx eslint --ext ts,tsx \
  --report-unused-disable-directives --max-warnings 0
git diff --check
git diff --cached --check
npm run compile:electron
```

Expected: zero failures/warnings, no staged files. After `compile:electron`, do not run Node tests
without rebuilding the Node ABI.

- [ ] **Step 7: Perform manual Electron acceptance**

Run `npm run electron:dev` and validate the design document checklist: authorization cancel and
double-click, fresh retry authorization, three independent document states, every fact/history/
evidence/conflict state, pagination/metrics/no-N+1, trailing-refresh races, stale-current-version
action, zh/en, keyboard/focus/live regions, and DevTools privacy. Capture screenshots and exact
observations in the final report.

- [ ] **Step 8: Generate the final whole-diff package and independent review**

Create a package containing every Plan 3 source/test file relative to the frozen Plan 2 state. Verify
header equality and that no source is newer than the package. Dispatch a fresh broad reviewer and a
security/state reviewer. Fix every Critical/Important finding test-first and repeat the affected gates.

- [ ] **Step 9: Finalize the report without committing**

Write exact RED/GREEN, focused/full/build/lint/compile/manual/review evidence to
`.superpowers/sdd/plan-3/reports/final-verification.md`. Mark Plan 3 complete only after final review is
`C0 / I0`; keep every source unstaged, uncommitted, unmerged, and unpushed until user acceptance.
