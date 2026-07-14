# AI Knowledge Bulk Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe, asynchronous bulk review actions so users can process thousands of AI knowledge items without confirming them one by one.

**Architecture:** Add a main-process batch review service backed by the existing fact query service and fact projector. The service owns an in-memory task map, processes facts in bounded sequential batches, and exposes start/status IPC methods. The renderer adds selection state, “select all matching results”, a bulk toolbar, confirmation/result dialogs, and polling; existing single-row actions remain unchanged.

**Tech Stack:** Electron IPC, React + TypeScript, Vitest, existing SQLite-backed knowledge fact query/projector services, Tailwind utility classes, renderer i18n.

## Global Constraints

- Keep the feature scoped to AI knowledge; do not modify the knowledge documents UI.
- Do not call the existing single-fact IPC in a renderer loop for bulk operations.
- Confirm actions only succeed when the existing projector validates active evidence, revision, and projection state.
- Batch failures are partial: successful facts stay committed, skipped/failed facts are reported separately.
- Use shared constants/types for IPC channels, task statuses, actions, and skip reasons.
- Add both Chinese and English renderer translations for every new user-visible string.
- Preserve current single-row confirm, reject, archive, evidence drawer, and conflict dialog behavior.
- Run targeted Vitest and changed-file ESLint after each implementation task; do not commit until the user has tested and confirmed the result.

---

## File Map

Create:

- `src/main/knowledgeBase/knowledgeFactBatchReviewService.ts` — main-process task manager and bounded batch executor.
- `src/main/knowledgeBase/knowledgeFactBatchReviewService.test.ts` — batch task lifecycle, paging, partial failure, and retry data tests.
- `src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledgeBatchReview.ts` — renderer selection state, task polling, and retry helpers.
- `src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledgeBatchReview.test.ts` — selection eligibility, selection modes, polling, and refresh behavior.
- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeBulkToolbar.tsx` — selection summary, select-all banner, bulk action buttons, progress/result summary.
- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeBulkReviewDialog.tsx` — bulk confirm/reject/archive confirmation and reject-reason input.
- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeBulkToolbar.test.ts` — static rendering and accessible action states.

Modify:

- `src/shared/knowledgeBase/constants.ts` — batch IPC channels, action/status/skip-reason constants.
- `src/shared/knowledgeBase/types.ts` — batch selection, request, task, and renderer API method types.
- `src/shared/knowledgeBase/contracts.test.ts` — renderer API contract fixture and channel assertions.
- `src/main/knowledgeBase/knowledgeBaseFoundation.ts` — construct, expose, and shut down the batch service.
- `src/main/knowledgeBase/ipcHandlers.ts` — validate batch start/status inputs and register handlers.
- `src/main/knowledgeBase/ipcHandlers.test.ts` — handler delegation, validation, and failure mapping.
- `src/main/knowledgeBase/preloadBridge.ts` — expose batch start/status through the isolated preload API.
- `src/main/knowledgeBase/preloadBridge.test.ts` — verify new channel forwarding.
- `src/renderer/services/knowledgeBase.ts` — renderer service wrappers for batch start/status.
- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.tsx` — pass batch state, render bulk toolbar, and add row/header selection cells.
- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts` — verify selection column and bulk toolbar integration while preserving row actions.
- `src/renderer/services/i18n.ts` — Chinese and English batch-review copy.

---

## Task 1: Add shared batch-review contracts

**Files:**

- Modify: `src/shared/knowledgeBase/constants.ts`
- Modify: `src/shared/knowledgeBase/types.ts`
- Test: `src/shared/knowledgeBase/contracts.test.ts`

**Interfaces:**

- Produces `KnowledgeFactBatchAction`, `KnowledgeFactBatchTaskStatus`, and `KnowledgeFactBatchSkipReason` constants and derived types.
- Produces `KnowledgeFactBatchReviewRequest`, `KnowledgeFactBatchReviewTask`, `KnowledgeFactBatchReviewDetail`, and `KnowledgeFactBatchReviewSelection`.
- Extends `KnowledgeBaseRendererApi` with `startBatchReview()` and `getBatchReviewStatus()`.

- [ ] **Step 1: Write the contract tests first.** Add assertions that `KnowledgeBaseIpc` contains:

```ts
StartBatchReview: 'knowledgeBase:facts:batchReview:start',
GetBatchReviewStatus: 'knowledgeBase:facts:batchReview:getStatus',
```

Add a `satisfies KnowledgeBaseRendererApi` fixture with these exact method shapes:

```ts
startBatchReview(
  input: KnowledgeFactBatchReviewRequest,
): Promise<KnowledgeBaseIpcResult<KnowledgeFactBatchReviewTask>>;
getBatchReviewStatus(
  input: KnowledgeFactBatchReviewStatusRequest,
): Promise<KnowledgeBaseIpcResult<KnowledgeFactBatchReviewTask | null>>;
```

- [ ] **Step 2: Run the shared contract test to verify it fails.**

Run:

```bash
npx vitest run src/shared/knowledgeBase/contracts.test.ts
```

Expected: FAIL because the new constants and renderer API methods do not exist.

- [ ] **Step 3: Add shared constants and types.** Use these discriminants and fields:

```ts
export const KnowledgeFactBatchAction = {
  Confirm: 'confirm',
  Reject: 'reject',
  Archive: 'archive',
} as const;
export type KnowledgeFactBatchAction =
  (typeof KnowledgeFactBatchAction)[keyof typeof KnowledgeFactBatchAction];

export const KnowledgeFactBatchTaskStatus = {
  Queued: 'queued',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
} as const;
export type KnowledgeFactBatchTaskStatus =
  (typeof KnowledgeFactBatchTaskStatus)[keyof typeof KnowledgeFactBatchTaskStatus];

export const KnowledgeFactBatchSkipReason = {
  NoActiveEvidence: 'no_active_evidence',
  RevisionConflict: 'revision_conflict',
  ProjectionConflict: 'projection_conflict',
  AlreadyProcessed: 'already_processed',
  NotFound: 'not_found',
} as const;
export type KnowledgeFactBatchSkipReason =
  (typeof KnowledgeFactBatchSkipReason)[keyof typeof KnowledgeFactBatchSkipReason];

export const KNOWLEDGE_FACT_BATCH_REJECT_REASON_MAX_CHARS = 240;

export interface KnowledgeFactBatchReviewDetail {
  factId: string;
  valuePreview: string | null;
  code: string;
  retryable: boolean;
}

export type KnowledgeFactBatchReviewSelection =
  | {
      kind: 'fact_ids';
      items: Array<{ factId: string; expectedRevision: number }>;
    }
  | {
      kind: 'matching_filters';
      filters: Pick<KnowledgeListFactsRequest, 'view' | 'reviewStatuses' | 'evidenceState'>;
    };

export interface KnowledgeFactBatchReviewRequest {
  workspaceId: string;
  action: KnowledgeFactBatchAction;
  selection: KnowledgeFactBatchReviewSelection;
  reason?: string;
}

export interface KnowledgeFactBatchReviewStatusRequest {
  taskId: string;
}

export interface KnowledgeFactBatchReviewTask {
  taskId: string;
  workspaceId: string;
  action: KnowledgeFactBatchAction;
  status: KnowledgeFactBatchTaskStatus;
  totalCount: number;
  processedCount: number;
  successCount: number;
  skippedCount: number;
  failedCount: number;
  skippedByReason: Partial<Record<KnowledgeFactBatchSkipReason, number>>;
  details: KnowledgeFactBatchReviewDetail[];
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
}
```

`details` is capped by the service at 200 entries and contains only `factId`, a 240-character value preview when available, a safe reason/code, and `retryable`; aggregate counts remain authoritative for large batches.

- [ ] **Step 4: Run the contract test to verify it passes.**

Run:

```bash
npx vitest run src/shared/knowledgeBase/contracts.test.ts
```

Expected: PASS.

---

## Task 2: Implement the main-process batch executor

**Files:**

- Create: `src/main/knowledgeBase/knowledgeFactBatchReviewService.ts`
- Test: `src/main/knowledgeBase/knowledgeFactBatchReviewService.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeBaseFoundation.ts`

**Interfaces:**

- Consumes `KnowledgeFactQueryService.listFacts()` and `EnterpriseLeadKnowledgeFactProjector.confirmFact()`, `.rejectFact()`, and `.archiveFact()`.
- Produces `KnowledgeFactBatchReviewService.start(request)`, `.getStatus(taskId)`, and test-only `.waitForIdle(taskId)` for deterministic service tests.

- [ ] **Step 1: Write failing service tests.** Cover these cases with fake query/projector dependencies:

```ts
test('starts a queued task and processes matching-filter pages sequentially', async () => {
  const service = createKnowledgeFactBatchReviewService({
    queryService: { listFacts: vi.fn() },
    projector: { confirmFact: vi.fn(), rejectFact: vi.fn(), archiveFact: vi.fn() },
  });
  const task = service.start({
    workspaceId: 'workspace-a',
    action: KnowledgeFactBatchAction.Confirm,
    selection: { kind: 'matching_filters', filters: { view: 'active', reviewStatuses: ['pending'], evidenceState: 'any' } },
  });
  await service.waitForIdle(task.taskId);
  expect(service.getStatus(task.taskId)).toMatchObject({
    status: KnowledgeFactBatchTaskStatus.Completed,
    successCount: 2,
    failedCount: 0,
  });
});
```

Also test: `FactEvidenceStale` becomes a non-retryable skipped detail, `FactRevisionConflict` becomes retryable, projector failure does not undo prior successes, and `getStatus()` returns `null` for an unknown task.

- [ ] **Step 2: Run the service tests to verify they fail.**

Run:

```bash
npx vitest run src/main/knowledgeBase/knowledgeFactBatchReviewService.test.ts
```

Expected: FAIL because the service module and factory are not present.

- [ ] **Step 3: Implement the task manager.** Use a `Map<string, KnowledgeFactBatchReviewTask>` owned by the service. `start()` creates a UUID task with `queued` status, stores a cloned request internally, schedules `runTask()` without awaiting it, and returns a cloned task. `getStatus()` returns a cloned task or `null`.

`runTask()` must:

1. Mark the task `running` and set `startedAt`.
2. Materialize `fact_ids` directly from the request; materialize `matching_filters` by calling `listFacts` with `limit: KNOWLEDGE_FACT_LIST_MAX_LIMIT` until `nextCursor` is `null`.
3. Apply one projector call per fact in input order. Yield with `await new Promise(resolve => setImmediate(resolve))` after every 25 facts so the Electron main process remains responsive.
4. Map `FactEvidenceStale` to `no_active_evidence` and `FactRevisionConflict` to `revision_conflict`, both skipped; map projection conflicts to `projection_conflict`, skipped and non-retryable; map unknown projector failures to failed and retryable.
5. Increment `processedCount` after every item, update aggregate counters, append only the first 200 safe details, and finish as `completed` unless task-level paging or infrastructure failure prevents completion, in which case finish as `failed`.

The task map is intentionally main-process memory for this feature: it survives renderer unmounts and filter changes while the Electron process is running, and the renderer’s `sessionStorage` task ID reconnects on page re-entry. A later app-restart persistence layer is outside this change.

`applyFact()` must dispatch exactly as follows:

```ts
if (request.action === KnowledgeFactBatchAction.Confirm) {
  return projector.confirmFact({ factId, expectedRevision });
}
if (request.action === KnowledgeFactBatchAction.Reject) {
  return projector.rejectFact({ factId, expectedRevision });
}
return projector.archiveFact({ factId, expectedRevision });
```

Keep `reason` in the task’s internal request and task result metadata only; do not add a fact-table column in this feature.

- [ ] **Step 4: Wire the service into the foundation.** Construct it after `factQueryService` and `factProjector` exist, expose it as `batchReviewService` on `KnowledgeBaseFoundation`, and clear/stop accepting new work from `shutdown()`.

- [ ] **Step 5: Run the service tests to verify they pass.**

Run:

```bash
npx vitest run src/main/knowledgeBase/knowledgeFactBatchReviewService.test.ts
```

Expected: all service tests PASS.

---

## Task 3: Add IPC validation and preload access

**Files:**

- Modify: `src/main/knowledgeBase/ipcHandlers.ts`
- Modify: `src/main/knowledgeBase/ipcHandlers.test.ts`
- Modify: `src/main/knowledgeBase/preloadBridge.ts`
- Modify: `src/main/knowledgeBase/preloadBridge.test.ts`

**Interfaces:**

- Consumes `foundation.batchReviewService.start()` and `.getStatus()`.
- Produces `window.electron.knowledgeBase.startBatchReview()` and `.getBatchReviewStatus()`.

- [ ] **Step 1: Add failing handler and bridge tests.** Assert that:

  - valid start input delegates unchanged to `batchReviewService.start`;
  - valid status input delegates to `getStatus`;
  - an empty `fact_ids` list, more than 10,000 fact IDs, invalid revision, or unknown action/selection kind is rejected with `invalid_request`;
  - an unknown status task ID returns `{ success: true, data: null }`;
  - preload calls use `KnowledgeBaseIpc.StartBatchReview` and `KnowledgeBaseIpc.GetBatchReviewStatus`.

- [ ] **Step 2: Run the focused tests to verify they fail.**

Run:

```bash
npx vitest run src/main/knowledgeBase/ipcHandlers.test.ts src/main/knowledgeBase/preloadBridge.test.ts
```

Expected: FAIL because the new dependency, handlers, and bridge methods are absent.

 - [ ] **Step 3: Add strict input readers in `ipcHandlers.ts`.** Accept only the documented keys, require a non-empty workspace ID, limit `fact_ids` to 10,000 entries, require safe positive revisions, canonicalize filter arrays using the shared enum values, require a non-empty reject reason no longer than `KNOWLEDGE_FACT_BATCH_REJECT_REASON_MAX_CHARS` (240), and reject reasons on confirm/archive.

- [ ] **Step 4: Register both handlers.** Use the existing `invokeWhenReady()` wrapper:

```ts
ipcMain.handle(KnowledgeBaseIpc.StartBatchReview, async (_event, input: unknown) =>
  invokeWhenReady(() => deps.foundation.batchReviewService.start(readBatchReviewInput(input))),
);
ipcMain.handle(KnowledgeBaseIpc.GetBatchReviewStatus, async (_event, input: unknown) =>
  invokeWhenReady(() => deps.foundation.batchReviewService.getStatus(readBatchReviewStatusInput(input).taskId)),
);
```

- [ ] **Step 5: Add preload forwarding methods and run focused tests.**

Run:

```bash
npx vitest run src/main/knowledgeBase/ipcHandlers.test.ts src/main/knowledgeBase/preloadBridge.test.ts src/shared/knowledgeBase/contracts.test.ts
```

Expected: all focused IPC/contract tests PASS.

---

## Task 4: Add renderer service and selection/task state

**Files:**

- Modify: `src/renderer/services/knowledgeBase.ts`
- Create: `src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledgeBatchReview.ts`
- Create: `src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledgeBatchReview.test.ts`

**Interfaces:**

- Consumes `knowledgeBaseService.startBatchReview()` and `.getBatchReviewStatus()`.
- Produces `WorkspaceAiKnowledgeBatchReviewViewModel` with selection and task controls consumed by the toolbar and table.

The view model exposes this stable shape:

```ts
export interface WorkspaceAiKnowledgeBatchReviewViewModel {
  selectedFacts: ReadonlyMap<string, KnowledgeFactSummary>;
  selectionMode: 'page' | 'matching' | null;
  selectedCount: number;
  visibleSelectableCount: number;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
  canSelectAllMatching: boolean;
  task: KnowledgeFactBatchReviewTask | null;
  isStarting: boolean;
  toggleFact: (fact: KnowledgeFactSummary) => void;
  toggleVisible: () => void;
  selectMatching: () => void;
  clearSelection: () => void;
  start: (action: KnowledgeFactBatchAction, reason?: string) => Promise<void>;
  retryFailed: () => Promise<void>;
  dismissTask: () => void;
}
```

- [ ] **Step 1: Add failing pure-state and hook tests.** Cover:

  - only active, non-archived normalized pending facts with `activeEvidenceCount > 0` and non-conflict projection state are selectable;
  - toggling a fact adds/removes its ID and expected revision;
  - select-visible selects only eligible current-page facts and reports indeterminate state when partially selected;
  - select-matching switches selection mode without materializing 10,000 IDs in the renderer;
  - starting a task calls the service once with either `fact_ids` or `matching_filters`;
  - polling stops for completed/failed status and invokes the supplied refresh callback exactly once;
  - retry uses only refreshed rows whose IDs are marked retryable in the previous task result.

- [ ] **Step 2: Run the renderer state tests to verify they fail.**

Run:

```bash
npx vitest run src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledgeBatchReview.test.ts
```

Expected: FAIL because the service methods, hook, and view model are absent.

- [ ] **Step 3: Add `knowledgeBaseService` wrappers.** Implement:

```ts
startBatchReview: (
  input: KnowledgeFactBatchReviewRequest,
): Promise<KnowledgeFactBatchReviewTask> => request(api => api.startBatchReview(input)),
getBatchReviewStatus: (
  taskId: string,
): Promise<KnowledgeFactBatchReviewTask | null> =>
  request(api => api.getBatchReviewStatus({ taskId })),
```

- [ ] **Step 4: Implement the hook.** Store selected facts in a `Map<string, { fact: KnowledgeFactSummary; expectedRevision: number }>` and a separate `selectionMode: 'page' | 'matching' | null`. Expose the exact methods `toggleFact`, `toggleVisible`, `selectMatching`, `clearSelection`, `start`, `retryFailed`, and `dismissTask`.

Store the active task ID in `sessionStorage` under `ai-knowledge-batch-review:${workspaceId}` so closing the panel or changing filters does not lose the task handle. On mount, restore that ID and query `getBatchReviewStatus()`; clear the storage entry when the task is unknown or the user dismisses its terminal result. Use a 750 ms polling timer only while the task is `queued` or `running`; clear it on terminal status and component unmount. After the first terminal status, call `onRefresh()` once and retain the task result for the summary panel.

- [ ] **Step 5: Run the renderer state tests to verify they pass.**

Run:

```bash
npx vitest run src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledgeBatchReview.test.ts
```

Expected: all state tests PASS.

---

## Task 5: Build the bulk toolbar and dialogs

**Files:**

- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeBulkToolbar.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeBulkReviewDialog.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeBulkToolbar.test.ts`
- Modify: `src/renderer/services/i18n.ts`

**Interfaces:**

- Consumes `WorkspaceAiKnowledgeBatchReviewViewModel`.
- Produces accessible toolbar controls, confirmation dialog, progress status, and result summary.

- [ ] **Step 1: Write failing static-render tests.** Assert:

  - no toolbar renders for an empty selection;
  - selected count and “select all matching” prompt render with `data-ai-knowledge-bulk-toolbar`;
  - confirm is the primary action, reject/archive are secondary actions;
  - reject dialog requires a non-empty reason before submit;
  - running state disables action buttons and announces progress with `role="status"`;
  - completed state shows success, skipped, and failed counts and exposes retry only when retryable details exist.

- [ ] **Step 2: Run the toolbar tests to verify they fail.**

Run:

```bash
npx vitest run src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeBulkToolbar.test.ts
```

Expected: FAIL because the components and translation keys are absent.

- [ ] **Step 3: Add Chinese and English translations.** Add keys for selected count, select-all-matching prompt, batch confirm/reject/archive labels, confirmation descriptions, reject reason label/validation, queued/running progress, success/skipped/failed counts, failure details, retry, and clear selection in both translation dictionaries.

- [ ] **Step 4: Implement the dialog.** Use `role="dialog"`, `aria-modal`, labelled title/description, a textarea only for reject, disabled submit while empty or submitting, Escape/Cancel behavior, and a live status region. Confirm copy must say that invalid evidence, revision changes, and conflicts will be skipped.

- [ ] **Step 5: Implement the toolbar.** Render a selection count, an indeterminate select-visible checkbox, a “select all matching filters” banner when `nextCursor !== null`, action buttons wired to `start(action, reason)`, a progress bar with numeric counts, and a compact result summary. Keep result details capped to the task’s safe sample list.

- [ ] **Step 6: Run the toolbar tests to verify they pass.**

Run:

```bash
npx vitest run src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeBulkToolbar.test.ts
```

Expected: all toolbar tests PASS.

---

## Task 6: Integrate selection into the AI knowledge table

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts`

**Interfaces:**

- Consumes the batch hook view model from `WorkspaceAiKnowledgePanel`.
- Produces table-level selection cells and preserves all existing row actions and evidence interactions.

- [ ] **Step 1: Add failing panel tests.** Extend the view fixture with a batch-review view model and assert:

  - the table has a selection header and selectable pending fact row;
  - legacy rows have no selectable checkbox;
  - selecting the header emits `toggleVisible`, selecting a row emits `toggleFact`;
  - the bulk toolbar renders between filters and table when selection exists;
  - existing confirm/reject/archive/evidence controls remain present.

- [ ] **Step 2: Run the panel tests to verify they fail.**

Run:

```bash
npx vitest run src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts
```

Expected: FAIL because the panel has no batch view model or selection column.

- [ ] **Step 3: Wire the hook in the stateful panel.** Call `useWorkspaceAiKnowledgeBatchReview({ workspaceId, rows: state.rows, filters: state.filters, nextCursor: state.nextCursor, onRefresh: state.refreshAfterMutation })` and pass the returned view model to `WorkspaceAiKnowledgePanelView`.

- [ ] **Step 4: Render selection cells in the table.** Add a sticky first header cell with an accessible checkbox. Add a checkbox cell only for normalized facts; disable it for archived, confirmed, rejected, conflict, or no-active-evidence rows. Use `aria-checked="mixed"` when some visible eligible rows are selected. Keep the current content/status/evidence/action columns and widths intact.

- [ ] **Step 5: Mount the toolbar and confirmation/result surfaces.** Place the toolbar immediately below `WorkspaceAiKnowledgeFilters`, before the table container. Keep batch dialogs inside the AI knowledge panel’s existing focus/overlay boundary so the evidence drawer and projection conflict dialog retain their current priority.

- [ ] **Step 6: Run the focused renderer tests.**

Run:

```bash
npx vitest run src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeFilters.test.ts src/renderer/components/enterpriseLeadWorkspace/workspaceAiKnowledgeRows.test.ts src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledgeBatchReview.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeBulkToolbar.test.ts
```

Expected: all focused renderer tests PASS.

---

## Task 7: End-to-end verification and handoff

**Files:**

- Verify all files listed above; no additional files should be modified unless a compiler error points directly to the batch feature.

- [ ] **Step 1: Run changed-file ESLint.**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/shared/knowledgeBase/constants.ts \
  src/shared/knowledgeBase/types.ts \
  src/shared/knowledgeBase/contracts.test.ts \
  src/main/knowledgeBase/knowledgeFactBatchReviewService.ts \
  src/main/knowledgeBase/knowledgeFactBatchReviewService.test.ts \
  src/main/knowledgeBase/knowledgeBaseFoundation.ts \
  src/main/knowledgeBase/ipcHandlers.ts \
  src/main/knowledgeBase/ipcHandlers.test.ts \
  src/main/knowledgeBase/preloadBridge.ts \
  src/main/knowledgeBase/preloadBridge.test.ts \
  src/renderer/services/knowledgeBase.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledgeBatchReview.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledgeBatchReview.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeBulkToolbar.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeBulkReviewDialog.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeBulkToolbar.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts \
  src/renderer/services/i18n.ts
```

Expected: exit code 0 with no warnings.

- [ ] **Step 2: Run the related Vitest suite.**

Run:

```bash
npx vitest run \
  src/shared/knowledgeBase/contracts.test.ts \
  src/main/knowledgeBase/knowledgeFactBatchReviewService.test.ts \
  src/main/knowledgeBase/ipcHandlers.test.ts \
  src/main/knowledgeBase/preloadBridge.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/useWorkspaceAiKnowledgeBatchReview.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeBulkToolbar.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts
```

Expected: 0 failed tests.

- [ ] **Step 3: Run `npm run build` and record unrelated baseline failures separately.**

The build must not introduce errors in the batch-review files. Existing unrelated TypeScript failures must be listed verbatim in the handoff if they remain.

- [ ] **Step 4: Run `git diff --check` and review status.** Confirm that only the scoped batch-review files plus the user’s pre-existing dirty files remain; do not stage or commit until the user tests the feature.
