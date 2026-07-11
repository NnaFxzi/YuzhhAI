# Unified Enterprise Knowledge Import Batch A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workspace-creation uploads and knowledge-base uploads create the same normalized managed documents
without renderer path reads, while preserving partial-success feedback and reconciling legacy sources safely.

**Architecture:** Reuse the existing owner-bound knowledge-base selection token and
`KnowledgeDocumentService.importSelection` API. Extend token consumption with a validated item subset, add a focused
renderer creation orchestrator, and make legacy migration a repeatable reconciliation that ignores normalized
compatibility projections.

**Tech Stack:** Electron main/preload IPC, React, TypeScript, SQLite/better-sqlite3, Vitest, Tailwind, existing
knowledge-base services.

## Global Constraints

- Target one Electron-local workspace with 100–1,000 documents and managed local storage.
- Renderer code must never receive or submit an absolute file path or extracted document text.
- Selection tokens remain owner-bound, single-use, limited to 100 files, and expire after five minutes.
- `knowledge_documents` and immutable `knowledge_document_versions` are authoritative for all new imports.
- Do not add document persistence to `EnterpriseLeadWorkspaceService` and do not submit a replacement
  `extractionSources` array.
- Workspace creation and per-file import form a saga with partial success; successful files are never rolled back
  because a sibling fails.
- Remote/model fact extraction is not triggered by import in this batch.
- Preserve the existing dirty startup-order correction in `src/main/main.ts` and its regression test.
- Do not broadly refactor oversized workspace components.
- Add both Chinese and English translations for every user-visible string.
- Do not commit until the user has manually tested and confirmed the result.

---

### Task 1: Secure Selection Subset Contract

**Files:**

- Modify: `src/shared/knowledgeBase/types.ts`
- Modify: `src/main/knowledgeBase/knowledgeSelectionTokenStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentService.ts`
- Modify: `src/main/knowledgeBase/ipcHandlers.ts`
- Modify: `src/renderer/services/knowledgeBase.ts`
- Test: `src/main/knowledgeBase/knowledgeSelectionTokenStore.test.ts`
- Test: `src/main/knowledgeBase/knowledgeDocumentService.test.ts`
- Test: `src/main/knowledgeBase/ipcHandlers.test.ts`
- Test: `src/main/knowledgeBase/preloadBridge.test.ts`
- Test: `src/renderer/services/knowledgeBase.test.ts`

**Interfaces:**

- Consumes: existing `KnowledgeFileSelection`, owner-bound tokens, and full-token import behavior.
- Produces: `KnowledgeImportSelectionRequest.itemIds?: string[]` and subset-aware `importSelection`.

- [ ] **Step 1: Write failing token-subset tests**

Add tests proving a subset is returned in original picker order, unknown/duplicate/empty subsets are rejected without
consuming the valid token, and a successful subset consumes the full token:

```ts
test('consumes only a validated item subset in picker order', () => {
  const store = new KnowledgeSelectionTokenStore({ now: () => 1_000 });
  const issued = store.issue(7, [selected('a.pdf'), selected('b.pdf'), selected('c.pdf')]);
  const firstId = issued.files[0]!.itemId;
  const thirdId = issued.files[2]!.itemId;

  expect(store.consume(issued.selectionToken, 7, [thirdId, firstId]).map(file => file.itemId))
    .toEqual([firstId, thirdId]);
  expect(() => store.consume(issued.selectionToken, 7)).toThrowError(
    expect.objectContaining({ code: KnowledgeBaseErrorCode.InvalidSelectionToken }),
  );
});

test.each([
  [],
  ['unknown-item'],
])('rejects an invalid subset without consuming the token', itemIds => {
  const store = new KnowledgeSelectionTokenStore({ now: () => 1_000 });
  const issued = store.issue(7, [selected('a.pdf')]);

  expect(() => store.consume(issued.selectionToken, 7, itemIds)).toThrowError(
    expect.objectContaining({ code: KnowledgeBaseErrorCode.InvalidRequest }),
  );
  expect(store.consume(issued.selectionToken, 7)).toHaveLength(1);
});
```

- [ ] **Step 2: Run the token tests and verify RED**

Run:

```bash
npm test -- knowledgeSelectionTokenStore
```

Expected: the new tests fail because `consume` ignores the subset argument.

- [ ] **Step 3: Implement subset validation**

Extend the shared request:

```ts
export interface KnowledgeImportSelectionRequest {
  workspaceId: string;
  selectionToken: string;
  itemIds?: string[];
}
```

Change the store signature to:

```ts
consume(
  selectionToken
:
string,
  ownerId
:
number,
  itemIds ? : readonly
string[],
):
SelectedKnowledgeFileEntry[]
```

Validate before deleting the token: supplied IDs must be a non-empty unique list no longer than
`KNOWLEDGE_MAX_SELECTION_FILES`, and every ID must belong to the entry. Filter `entry.files` so the
result preserves picker order. Delete the entry only after validation succeeds.

- [ ] **Step 4: Add RED tests through service, IPC, preload, and renderer wrapper**

Assert that the service passes `itemIds` into `consume`, the IPC injects `ownerId` and rejects
malformed lists, the preload bridge passes the request unchanged, and the renderer builds:

```ts
{
  workspaceId: 'workspace-a',
    selectionToken
:
  'token-1',
    itemIds
:
  ['item-2'],
}
```

- [ ] **Step 5: Run the boundary tests and verify RED**

Run:

```bash
npm test -- knowledgeDocumentService ipcHandlers preloadBridge knowledgeBaseService
```

Expected: subset forwarding assertions fail.

- [ ] **Step 6: Implement boundary forwarding and validation**

Update `KnowledgeDocumentService.importSelection` to accept `itemIds?: string[]` and call:

```ts
this.options.selectionTokenStore.consume(
  input.selectionToken,
  input.ownerId,
  input.itemIds,
);
```

In `readImportInput`, accept omitted `itemIds`; otherwise require a non-empty unique string list of
at most `KNOWLEDGE_MAX_SELECTION_FILES`. Update the renderer method signature to:

```ts
importSelection(
  workspaceId
:
string,
  selectionToken
:
string,
  itemIds ? : string[],
):
Promise<KnowledgeImportBatchResult>
```

Omit `itemIds` from the request when undefined so the existing knowledge-page contract is unchanged.

- [ ] **Step 7: Run all Task 1 tests and strict lint**

Run:

```bash
npm test -- knowledgeSelectionTokenStore knowledgeDocumentService ipcHandlers preloadBridge knowledgeBaseService
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/knowledgeBase/types.ts src/main/knowledgeBase/knowledgeSelectionTokenStore.ts src/main/knowledgeBase/knowledgeSelectionTokenStore.test.ts src/main/knowledgeBase/knowledgeDocumentService.ts src/main/knowledgeBase/knowledgeDocumentService.test.ts src/main/knowledgeBase/ipcHandlers.ts src/main/knowledgeBase/ipcHandlers.test.ts src/main/knowledgeBase/preloadBridge.test.ts src/renderer/services/knowledgeBase.ts src/renderer/services/knowledgeBase.test.ts
```

Expected: PASS with zero warnings.

---

### Task 2: Focused Workspace-Creation Import Orchestrator

**Files:**

- Create: `src/renderer/components/enterpriseLeadWorkspace/workspaceCreationKnowledgeImport.ts`
- Create: `src/renderer/components/enterpriseLeadWorkspace/workspaceCreationKnowledgeImport.test.ts`

**Interfaces:**

- Consumes: `EnterpriseLeadWorkspaceDraft`, `KnowledgeSelectedFile`, `createWorkspace`, and subset-aware
  `importSelection`.
- Produces: `WorkspaceMaterialSelectionItem`, `createWorkspaceWithKnowledgeImports`, and an aggregate import result.

- [ ] **Step 1: Write RED orchestration tests**

Define safe selection items with no path/text fields:

```ts
export interface WorkspaceMaterialSelectionItem extends KnowledgeSelectedFile {
  selectionToken: string;
}
```

Test that the desired function creates one empty-source workspace before importing grouped tokens,
imports only retained item IDs, combines fulfilled batches, converts a rejected token group into
safe failed items, and never invokes imports when workspace creation fails.

Use the desired signature:

```ts
createWorkspaceWithKnowledgeImports({
  draft,
  items,
  createWorkspace,
  importSelection,
})
:
Promise<{
  workspace: EnterpriseLeadWorkspace;
  importResult: KnowledgeImportBatchResult;
} | null>
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
npm test -- workspaceCreationKnowledgeImport
```

Expected: module resolution fails because the orchestrator does not exist.

- [ ] **Step 3: Implement grouping and partial-success aggregation**

Group items by token in first-seen order. Create the workspace first. Use `Promise.allSettled` over
token groups. Merge successful results and synthesize failures for a rejected group using only its
display-safe item IDs/names and `KnowledgeBaseErrorCode` from `KnowledgeBaseServiceError`, falling
back to `PersistenceFailed`.

Build counts from the final item array:

```ts
const importedCount = items.filter(item => item.success).length;
return {
  workspace,
  importResult: {
    importedCount,
    failedCount: items.length - importedCount,
    items,
  },
};
```

- [ ] **Step 4: Run Task 2 tests and strict lint**

Run:

```bash
npm test -- workspaceCreationKnowledgeImport
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/workspaceCreationKnowledgeImport.ts src/renderer/components/enterpriseLeadWorkspace/workspaceCreationKnowledgeImport.test.ts
```

Expected: PASS with zero warnings.

---

### Task 3: Replace Renderer Path/OCR Material Selection

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceMaterialUpload.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceMaterialUpload.test.tsx`
- Modify: `src/renderer/services/i18n.ts`

**Interfaces:**

- Consumes: `knowledgeBaseService.selectFiles()` and `WorkspaceMaterialSelectionItem`.
- Produces: a display-only selected-file list for workspace creation.

- [ ] **Step 1: Write RED component tests**

Render the component with a stubbed knowledge-base service and assert:

- picker results append display name/size/token metadata;
- the token and any fake absolute path never appear in rendered text/attributes;
- removing one selected row keeps sibling rows;
- cancelling the picker leaves state unchanged;
- more than `KNOWLEDGE_MAX_SELECTION_FILES` across multiple selections is rejected;
- legacy `window.electron.dialog.readTextFile`, `statFile`, and `extractImageText` are never called.

- [ ] **Step 2: Run the component test and verify RED**

Run:

```bash
npm test -- WorkspaceMaterialUpload
```

Expected: the old component calls the generic dialog/path APIs and fails the new assertions.

- [ ] **Step 3: Implement the display-only picker**

Replace the path builder and hidden file input with `knowledgeBaseService.selectFiles()`. Map each
result to:

```ts
{
  itemId: file.itemId,
    displayName
:
  file.displayName,
    fileSize
:
  file.fileSize,
    selectionToken
:
  selection.selectionToken,
}
```

Infer icons only from `displayName`. Enforce the shared total count limit in renderer for feedback;
the main process remains authoritative. Preserve request sequencing so a stale picker resolution
cannot overwrite a newer list.

Add localized bridge-unavailable, too-many-files, and safe picker-failure messages in both languages.

- [ ] **Step 4: Run Task 3 tests and strict lint**

Run:

```bash
npm test -- WorkspaceMaterialUpload
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/WorkspaceMaterialUpload.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceMaterialUpload.test.tsx src/renderer/services/i18n.ts
```

Expected: PASS with zero warnings.

---

### Task 4: Cut Workspace Creation Over to Normalized Import

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`
- Modify: `src/renderer/services/i18n.ts`

**Interfaces:**

- Consumes: Task 2 orchestrator and Task 3 safe selection items.
- Produces: one creation path that creates an empty-source workspace and normalized managed documents.

- [ ] **Step 1: Write RED cutover tests**

Replace legacy helper tests with assertions that material creation:

- uses `buildManualEnterpriseLeadWorkspaceDraft` with an empty/blank source shell;
- calls normalized imports after workspace creation;
- never calls `processDocumentSource`, renderer OCR, `readTextFile`, or `updateWorkspaceSources`;
- calls `onCreated` only after all token import promises settle;
- preserves and returns partial-success details.

Add a source-boundary assertion that the material branch contains no `filePath`, `ocrService`, or
`processDocumentSource` reference.

- [ ] **Step 2: Run the renderer tests and verify RED**

Run:

```bash
npm test -- enterpriseLeadWorkspaceUi WorkspaceCreate EnterpriseLeadWorkspaceView
```

Expected: old extraction-source/OCR tests or new boundary assertions fail.

- [ ] **Step 3: Integrate the orchestrator and delete obsolete material helpers**

In `WorkspaceCreate`, call `createWorkspaceWithKnowledgeImports` with an empty-source draft and the
safe selected items. Remove renderer OCR progress state and the legacy `createWorkspaceFromUploadedMaterial`
wrapper. In `enterpriseLeadWorkspaceUi.ts`, remove `MaterialUploadItem`, OCR service types, duplicate
upload limits/filters, and `createWorkspaceFromUploadedMaterials`.

Extend the creation callback to accept an optional aggregate result:

```ts
onCreated: (workspaceId: string, initialImportResult?: KnowledgeImportBatchResult) => void;
```

`EnterpriseLeadWorkspaceView` displays a localized toast when `failedCount > 0` and opens the
workspace knowledge-base document page so the user can review successful documents and reselect
failed files. A fully successful batch preserves the existing default destination.

- [ ] **Step 4: Update creation copy**

Replace promises that upload immediately generates a profile with copy that says all selected files
join the same workspace knowledge base and continue local parsing/OCR in the background. Keep AI
knowledge wording separate and state that it requires a later explicit extraction action.

- [ ] **Step 5: Run Task 4 tests and strict lint**

Run:

```bash
npm test -- enterpriseLeadWorkspaceUi WorkspaceCreate EnterpriseLeadWorkspaceView workspaceCreationKnowledgeImport WorkspaceMaterialUpload
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx src/renderer/services/i18n.ts
```

Expected: PASS with zero warnings.

---

### Task 5: Repeatable Legacy Reconciliation

**Files:**

- Modify: `src/main/knowledgeBase/legacyKnowledgeSourceIdentity.ts`
- Modify: `src/main/knowledgeBase/knowledgeMigrationStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeMigrationService.ts`
- Modify: `src/main/knowledgeBase/knowledgeBaseFoundation.ts`
- Modify: `src/main/knowledgeBase/knowledgeMigrationStore.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeMigrationService.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeBaseFoundation.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeBaseStartupOrder.test.ts`
- Preserve: `src/main/main.ts`

**Interfaces:**

- Consumes: stable legacy source IDs and normalized projection prefix `knowledge-document:`.
- Produces: migration version 2 as repeatable, idempotent reconciliation.

- [ ] **Step 1: Write RED reconciliation tests**

Add tests that:

- append a legacy source after a completed pass and migrate only the new source;
- ignore `knowledge-document:<documentId>` compatibility projections;
- do not duplicate or resurrect a soft-deleted migrated document;
- continue to a later source after one item fails;
- allow a completed same-version migration state to reopen for reconciliation;
- maintain startup ordering: store init, foundation creation, handler registration, recovery.

- [ ] **Step 2: Run migration tests and verify RED**

Run:

```bash
npm test -- knowledgeMigrationStore knowledgeMigrationService knowledgeBaseFoundation knowledgeBaseStartupOrder
```

Expected: appended-source and projection-ignore assertions fail against one-shot version 1 behavior.

- [ ] **Step 3: Implement migration v2 reconciliation**

Add a centralized helper:

```ts
export const isNormalizedKnowledgeProjectionSourceId = (sourceId?: string): boolean =>
  sourceId?.trim().startsWith(KNOWLEDGE_DOCUMENT_LEGACY_SOURCE_PREFIX) ?? false;
```

Increment the migration version. Make `KnowledgeMigrationStore.begin` reopen a completed state for
the same version while preserving durable document idempotency. Scan stable legacy IDs every pass,
skip normalized projection IDs, recheck `findByLegacySourceId` inside the publication transaction,
continue after individual failures, and finish with bounded diagnostics.

Do not move the existing `main.ts` knowledge-base startup block; only strengthen its test.

- [ ] **Step 4: Run Task 5 tests and strict lint**

Run:

```bash
npm test -- knowledgeMigrationStore knowledgeMigrationService knowledgeBaseFoundation knowledgeBaseStartupOrder enterpriseLeadKnowledgeCompatibilityAdapter knowledgeDocumentService
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/knowledgeBase/legacyKnowledgeSourceIdentity.ts src/main/knowledgeBase/knowledgeMigrationStore.ts src/main/knowledgeBase/knowledgeMigrationService.ts src/main/knowledgeBase/knowledgeBaseFoundation.ts src/main/knowledgeBase/knowledgeMigrationStore.test.ts src/main/knowledgeBase/knowledgeMigrationService.test.ts src/main/knowledgeBase/knowledgeBaseFoundation.test.ts src/main/knowledgeBase/knowledgeBaseStartupOrder.test.ts src/main/main.ts
```

Expected: PASS with zero warnings.

---

### Task 6: Unified Source-Document Terminology and Import Feedback

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.ts`
- Modify: corresponding colocated tests
- Modify: `src/renderer/services/i18n.ts`

**Interfaces:**

- Consumes: optional initial creation import result and normalized document list.
- Produces: one-time partial-success feedback and consistent “资料文档 / AI 知识” semantics.

- [ ] **Step 1: Write RED presentation tests**

Assert that an optional initial import result is shown once using the same summary/failure formatter
as knowledge-page uploads, survives the initial list refresh, and is cleared on workspace change.
Assert both language dictionaries use “资料文档” / “Source documents” instead of presenting “本地文档库” as a separate
destination.

- [ ] **Step 2: Run the renderer presentation tests and verify RED**

Run:

```bash
npm test -- WorkspaceKnowledgeBase WorkspaceKnowledgeDocumentsPanel useWorkspaceKnowledgeDocuments knowledgeDocumentPresentation
```

Expected: initial-result and terminology assertions fail.

- [ ] **Step 3: Implement one-time feedback and copy**

Thread `initialImportResult?: KnowledgeImportBatchResult` only through the workspace view/document
panel boundary. Initialize `lastImportResult` from it for the matching workspace, then clear it on a
new user import or workspace change. Reuse `summarizeKnowledgeImportBatch`; do not add a second error
formatter.

Update Chinese and English copy to say all entries add source documents to the same workspace
knowledge base and process them locally. Keep “AI knowledge” as the derived, reviewable view.

- [ ] **Step 4: Run Task 6 tests and strict lint**

Run:

```bash
npm test -- WorkspaceKnowledgeBase WorkspaceKnowledgeDocumentsPanel useWorkspaceKnowledgeDocuments knowledgeDocumentPresentation
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.ts src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.test.ts src/renderer/services/i18n.ts
```

Expected: PASS with zero warnings.

---

### Task 7: Full Verification and Review

**Files:**

- Review every file changed by Tasks 1–6 plus the approved design and this plan.

**Interfaces:**

- Produces: a verified, uncommitted handoff for manual Electron testing.

- [ ] **Step 1: Run targeted regressions**

```bash
npm test -- src/shared/knowledgeBase src/main/knowledgeBase src/main/enterpriseLeadWorkspace src/renderer/services/knowledgeBase.test.ts src/renderer/components/enterpriseLeadWorkspace
```

Expected: PASS.

- [ ] **Step 2: Run strict ESLint for every touched TypeScript/TSX file**

Use the repository changed-file command over the exact output of `git diff --name-only -- '*.ts' '*.tsx'`.

Expected: zero errors and zero warnings.

- [ ] **Step 3: Compile Electron and build renderer**

```bash
npm run compile:electron
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 4: Run the complete official test suite**

```bash
npm test
```

Expected: all Vitest files pass; the known intentional skip remains skipped. If loopback tests are
blocked by the sandbox, rerun the same command with approved elevated execution.

- [ ] **Step 5: Review security and cutover invariants**

```bash
rg -n "filePath|readTextFile|extractImageText|processDocumentSource|sourceIndex|extractionSources" src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceMaterialUpload.tsx src/renderer/components/enterpriseLeadWorkspace/workspaceCreationKnowledgeImport.ts
git diff --check
git status --short
```

Confirm no creation material flow receives a path/text, normalized imports are visible immediately,
projection IDs are never remigrated, user-visible strings exist in both languages, and unrelated
working-tree changes were not reverted.

- [ ] **Step 6: Independent code review and manual-test handoff**

Request a fresh whole-diff review focused on Electron IPC security, partial-success races, migration
idempotency, and renderer stale-result handling. Fix Critical/Important findings, rerun their covering
tests, then provide manual steps without staging or committing.
