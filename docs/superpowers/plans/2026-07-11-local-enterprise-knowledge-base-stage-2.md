# Local Enterprise Knowledge Base Stage 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut enterprise workspace document upload and file management over to secure managed local
storage, stable document/version identities, durable local ingestion, and document-level IPC without
breaking legacy enterprise-agent consumers.

**Architecture:** A domain-neutral `KnowledgeDocumentService` owns document operations and composes
the Stage 1 stores, a short-lived selection-token store, a bounded local ingestion worker, and a
temporary enterprise compatibility adapter. Renderer code uses a dedicated `knowledgeBase` preload
bridge and a focused document panel; it never submits arbitrary paths or replaces a complete source
array.

**Tech Stack:** TypeScript, Electron main/preload, React, better-sqlite3, Node.js filesystem/crypto,
existing local document/OCR extractors, Vitest.

## Global Constraints

- Node.js remains `>=24.15.0 <25`.
- Do not add a runtime dependency.
- Work only in the existing isolated worktree on branch `feat/local-enterprise-knowledge-base`.
- Do not create commits until the user has tested and explicitly confirmed.
- Every production behavior change follows red-green-refactor TDD.
- Managed imports use opaque, owner-bound, five-minute, single-use selection tokens.
- Limits remain 50 MiB per file, 100 files per selection, and 20 GiB logical managed bytes per
  workspace.
- Local ingestion concurrency remains two general jobs and one OCR job.
- New normalized-document ingestion never invokes a cloud model or writes raw text to
  `extractionSources`.
- New jobs and mutations target stable `documentId + documentVersionId`, never `sourceIndex`.
- IPC responses never expose absolute paths, managed paths, stack traces, SQLite messages, API keys,
  or unsanitized internal errors.
- Keep the legacy `extraction_sources` field non-destructive until Stage 4.
- Do not broadly refactor `WorkspaceKnowledgeBase.tsx`; extract only its document-management
  responsibility into focused files.
- Add Chinese and English translations for every new visible string.
- Every touched TypeScript/TSX file must pass changed-file ESLint with zero warnings.
- Main/preload work must pass `npm run compile:electron`; renderer work must pass `npm run build`.

---

## File Structure

### Shared knowledge-base boundary

- Modify `src/shared/knowledgeBase/constants.ts`: IPC channels, visibility, stable errors, token TTL.
- Modify `src/shared/knowledgeBase/types.ts`: safe renderer DTOs, requests, batch results, IPC union.
- Modify `src/shared/knowledgeBase/contracts.test.ts`: stable-value and no-path contract tests.

### Main-process domain

- Create `src/main/knowledgeBase/knowledgeSelectionTokenStore.ts`: owner-bound token lifecycle.
- Create `src/main/knowledgeBase/knowledgeSelectionTokenStore.test.ts`: token security tests.
- Create `src/main/knowledgeBase/knowledgeFileInspection.ts`: supported extension, MIME, and header
  validation.
- Create `src/main/knowledgeBase/knowledgeFileInspection.test.ts`: disguised-file and no-text tests.
- Modify `src/main/knowledgeBase/knowledgeDocumentStore.ts`: visibility, quota, worker commits.
- Modify `src/main/knowledgeBase/knowledgeDocumentStore.test.ts`: SQL and active-version invariants.
- Modify `src/main/knowledgeBase/knowledgeIngestionJobStore.ts`: document/version job queries and
  queued cancellation.
- Modify `src/main/knowledgeBase/knowledgeIngestionJobStore.test.ts`: lifecycle query tests.
- Create `src/main/knowledgeBase/enterpriseLeadKnowledgeCompatibilityAdapter.ts`: stable-ID legacy
  projection without raw text.
- Create `src/main/knowledgeBase/enterpriseLeadKnowledgeCompatibilityAdapter.test.ts`: merge/remove
  projection tests.
- Modify `src/main/enterpriseLeadWorkspace/store.ts`: atomic source upsert/remove by stable source ID.
- Modify `src/main/enterpriseLeadWorkspace/store.test.ts`: preserve unrelated legacy entries.
- Create `src/main/knowledgeBase/knowledgeDocumentService.ts`: import/list/details/delete/restore/retry.
- Create `src/main/knowledgeBase/knowledgeDocumentService.test.ts`: service transaction and error tests.
- Create `src/main/knowledgeBase/knowledgeIngestionService.ts`: bounded local queue worker.
- Create `src/main/knowledgeBase/knowledgeIngestionService.test.ts`: concurrency and commit tests.
- Modify `src/main/libs/documentTextExtractor.ts`: extension hint for extensionless managed blobs.
- Modify `src/main/libs/documentTextExtractor.test.ts`: managed-blob parser selection test.
- Create `src/main/knowledgeBase/ipcHandlers.ts`: validated safe IPC handlers.
- Create `src/main/knowledgeBase/ipcHandlers.test.ts`: handler/result mapping tests.
- Modify `src/main/knowledgeBase/knowledgeBaseFoundation.ts`: compose Stage 2 services.
- Modify `src/main/knowledgeBase/knowledgeBaseFoundation.test.ts`: startup worker and cleanup behavior.
- Modify `src/main/main.ts`: register IPC and inject Electron dialog/OCR dependencies.

### Preload and renderer

- Modify `src/main/preload.ts`: expose the dedicated `knowledgeBase` bridge.
- Modify `src/renderer/types/electron.d.ts`: type the bridge without filesystem paths.
- Create `src/renderer/services/knowledgeBase.ts`: typed renderer request wrapper.
- Create `src/renderer/services/knowledgeBase.test.ts`: success and stable-error behavior.
- Create `src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.ts`: pure status,
  filtering, and batch-summary helpers.
- Create `src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts`:
  status and localized-message-key tests.
- Create `src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.ts`: list,
  mutation, details, and single-flight polling state.
- Create `src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.test.ts`:
  polling lifecycle tests.
- Create `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx`:
  managed document UI.
- Create `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts`:
  upload, partial success, delete/restore/retry tests.
- Modify `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.tsx`: mount the focused
  panel for the documents view and remove the renderer path-reading upload flow from that view.
- Modify `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.test.ts`: cutover
  contract test.
- Modify `src/renderer/services/i18n.ts`: Chinese and English document-management strings.

---

### Task 1: Shared IPC and Safe DTO Contracts

**Files:**

- Modify: `src/shared/knowledgeBase/constants.ts`
- Modify: `src/shared/knowledgeBase/types.ts`
- Modify: `src/shared/knowledgeBase/contracts.test.ts`

**Interfaces:**

- Produces `KnowledgeBaseIpc`, `KnowledgeDocumentVisibility`, and expanded
  `KnowledgeBaseErrorCode`.
- Produces `KnowledgeBaseIpcResult<T>`, `KnowledgeDocumentListItem`,
  `KnowledgeDocumentDetails`, selection/import request and result types.
- All later main/preload/renderer tasks consume these exact shared contracts.

- [ ] **Step 1: Write failing stable-contract tests**

```ts
test('publishes stable Stage 2 IPC channels and visibility values', () => {
  expect(KnowledgeBaseIpc).toEqual({
    DeleteDocument: 'knowledgeBase:documents:delete',
    GetDocumentDetails: 'knowledgeBase:documents:getDetails',
    ImportSelection: 'knowledgeBase:documents:importSelection',
    ListDocuments: 'knowledgeBase:documents:list',
    RestoreDocument: 'knowledgeBase:documents:restore',
    RetryDocument: 'knowledgeBase:documents:retry',
    SelectFiles: 'knowledgeBase:files:select',
  });
  expect(KnowledgeDocumentVisibility).toEqual({ Active: 'active', Deleted: 'deleted' });
  expect(KNOWLEDGE_SELECTION_TOKEN_TTL_MS).toBe(5 * 60_000);
});

test('keeps renderer document DTOs display-safe', () => {
  const item: KnowledgeDocumentListItem = createKnowledgeDocumentListItem();
  expect(item).not.toHaveProperty('originalPath');
  expect(item).not.toHaveProperty('legacySourceId');
  expect(item).not.toHaveProperty('extractedText');
  expect(item).not.toHaveProperty('managedPath');
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
npm test -- src/shared/knowledgeBase/contracts.test.ts
```

Expected: FAIL because Stage 2 constants and DTOs do not exist.

- [ ] **Step 3: Add exact shared constants**

```ts
export const KnowledgeBaseIpc = {
  DeleteDocument: 'knowledgeBase:documents:delete',
  GetDocumentDetails: 'knowledgeBase:documents:getDetails',
  ImportSelection: 'knowledgeBase:documents:importSelection',
  ListDocuments: 'knowledgeBase:documents:list',
  RestoreDocument: 'knowledgeBase:documents:restore',
  RetryDocument: 'knowledgeBase:documents:retry',
  SelectFiles: 'knowledgeBase:files:select',
} as const;
export type KnowledgeBaseIpc = (typeof KnowledgeBaseIpc)[keyof typeof KnowledgeBaseIpc];

export const KnowledgeDocumentVisibility = {
  Active: 'active',
  Deleted: 'deleted',
} as const;
export type KnowledgeDocumentVisibility =
  (typeof KnowledgeDocumentVisibility)[keyof typeof KnowledgeDocumentVisibility];

export const KNOWLEDGE_SELECTION_TOKEN_TTL_MS = 5 * 60_000;
```

Extend `KnowledgeBaseErrorCode` with:

```ts
InvalidSelectionToken: 'invalid_selection_token',
InvalidRequest: 'invalid_request',
TooManyFiles: 'too_many_files',
UnsupportedFileType: 'unsupported_file_type',
SelectedFileMissing: 'selected_file_missing',
SelectedFileChanged: 'selected_file_changed',
WorkspaceQuotaExceeded: 'workspace_quota_exceeded',
WorkspaceNotFound: 'workspace_not_found',
DocumentNotFound: 'document_not_found',
IngestionFailed: 'ingestion_failed',
PersistenceFailed: 'persistence_failed',
```

- [ ] **Step 4: Add safe DTO and result shapes**

```ts
export interface KnowledgeIngestionJobSummary {
  id: string;
  documentVersionId: string;
  stage: KnowledgeIngestionStage;
  status: KnowledgeIngestionJobStatus;
  progress: number;
  errorCode: string | null;
  updatedAt: string;
}

export interface KnowledgeDocumentListItem {
  id: string;
  displayName: string;
  sourceMode: KnowledgeDocumentSourceMode;
  currentVersionId: string;
  revision: number;
  status: KnowledgeDocumentStatus;
  fileSize: number | null;
  mimeType: string | null;
  contentHash: string | null;
  currentJob: KnowledgeIngestionJobSummary | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface KnowledgeDocumentDetails {
  document: KnowledgeDocumentListItem;
  activeVersion: {
    id: string;
    parser: string | null;
    extractedText: string | null;
    extractionPartial: boolean;
    createdAt: string;
  };
}

export interface KnowledgeSelectedFile {
  itemId: string;
  displayName: string;
  fileSize: number;
}

export interface KnowledgeFileSelection {
  selectionToken: string;
  files: KnowledgeSelectedFile[];
}

export type KnowledgeImportItemResult =
  | { success: true; itemId: string; document: KnowledgeDocumentListItem }
  | { success: false; itemId: string; fileName: string; errorCode: KnowledgeBaseErrorCode };

export interface KnowledgeImportBatchResult {
  importedCount: number;
  failedCount: number;
  items: KnowledgeImportItemResult[];
}

export interface KnowledgeBaseIpcError {
  code: KnowledgeBaseErrorCode;
  fileName?: string;
  latestDocument?: KnowledgeDocumentListItem;
}

export type KnowledgeBaseIpcResult<T> =
  | { success: true; data: T }
  | { success: false; error: KnowledgeBaseIpcError };
```

Add these exact request objects:

```ts
export interface KnowledgeImportSelectionRequest {
  workspaceId: string;
  selectionToken: string;
}

export interface KnowledgeListDocumentsRequest {
  workspaceId: string;
  visibility: KnowledgeDocumentVisibility;
}

export interface KnowledgeDocumentDetailsRequest {
  documentId: string;
}

export interface KnowledgeDocumentRevisionRequest {
  documentId: string;
  expectedRevision: number;
}

export interface KnowledgeRetryDocumentRequest {
  documentId: string;
  documentVersionId: string;
}
```

- [ ] **Step 5: Run contract tests and strict lint**

```bash
npm test -- src/shared/knowledgeBase/contracts.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/knowledgeBase/constants.ts src/shared/knowledgeBase/types.ts src/shared/knowledgeBase/contracts.test.ts
```

Expected: PASS with zero warnings.

---

### Task 2: Owner-Bound Selection Tokens and File Inspection

**Files:**

- Create: `src/main/knowledgeBase/knowledgeSelectionTokenStore.ts`
- Create: `src/main/knowledgeBase/knowledgeSelectionTokenStore.test.ts`
- Create: `src/main/knowledgeBase/knowledgeFileInspection.ts`
- Create: `src/main/knowledgeBase/knowledgeFileInspection.test.ts`

**Interfaces:**

- Consumes the shared 100-file limit and five-minute TTL.
- Produces `KnowledgeSelectionTokenStore.issue`, `consume`, and `clearOwner`.
- Internal token entries retain absolute paths only in the main process.
- Produces `inspectKnowledgeFile` with extension/header validation and extractable/no-text metadata.

- [ ] **Step 1: Write failing security tests**

```ts
test('issues an owner-bound token and consumes it once', () => {
  const store = createStoreAt(1_000);
  const issued = store.issue(7, [selected('/private/a.pdf', 10, 100)]);
  expect(store.consume(issued.selectionToken, 7)).toHaveLength(1);
  expect(() => store.consume(issued.selectionToken, 7)).toThrowError(
    expect.objectContaining({ code: KnowledgeBaseErrorCode.InvalidSelectionToken }),
  );
});

test('rejects foreign and expired token use without exposing token state', () => {
  let now = 1_000;
  const store = new KnowledgeSelectionTokenStore({ now: () => now });
  const foreign = store.issue(7, [selected('/private/a.pdf', 10, 100)]);
  expect(() => store.consume(foreign.selectionToken, 8)).toThrowError(
    expect.objectContaining({ code: KnowledgeBaseErrorCode.InvalidSelectionToken }),
  );
  const expired = store.issue(7, [selected('/private/b.pdf', 10, 100)]);
  now += KNOWLEDGE_SELECTION_TOKEN_TTL_MS + 1;
  expect(() => store.consume(expired.selectionToken, 7)).toThrowError(
    expect.objectContaining({ code: KnowledgeBaseErrorCode.InvalidSelectionToken }),
  );
});

test('clears tokens when their WebContents owner is destroyed', () => {
  const store = createStoreAt(1_000);
  const issued = store.issue(7, [selected('/private/a.pdf', 10, 100)]);
  store.clearOwner(7);
  expect(() => store.consume(issued.selectionToken, 7)).toThrow();
});
```

- [ ] **Step 2: Run the token test and verify RED**

```bash
npm test -- src/main/knowledgeBase/knowledgeSelectionTokenStore.test.ts
```

Expected: FAIL because the token store module does not exist.

- [ ] **Step 3: Implement the in-memory token store**

```ts
export interface SelectedKnowledgeFileEntry {
  itemId: string;
  absolutePath: string;
  displayName: string;
  fileSize: number;
  sourceMtime: number;
}

export class KnowledgeSelectionTokenError extends Error {
  readonly code = KnowledgeBaseErrorCode.InvalidSelectionToken;
}

export class KnowledgeSelectionTokenStore {
  private readonly entries = new Map<string, {
    ownerId: number;
    expiresAt: number;
    files: SelectedKnowledgeFileEntry[];
  }>();

  constructor(private readonly options: { now?: () => number } = {}) {}

  issue(ownerId: number, files: SelectedKnowledgeFileEntry[]): KnowledgeFileSelection;
  consume(token: string, ownerId: number): SelectedKnowledgeFileEntry[];
  clearOwner(ownerId: number): void;
}
```

`issue` rejects empty selections and more than 100 files, clones entries, uses `randomUUID`, and
returns display-safe metadata. `consume` deletes the entry before returning files so failures during
import cannot make the token reusable. Owner mismatch and expiry both throw the same stable code.

- [ ] **Step 4: Write failing file-inspection tests**

```ts
test('accepts a PDF only when its header matches the selected extension', async () => {
  const pdf = await writeFile('manual.pdf', Buffer.from('%PDF-1.7\n'));
  await expect(inspectKnowledgeFile(pdf)).resolves.toMatchObject({
    canExtractText: true,
    extension: '.pdf',
    mimeType: 'application/pdf',
  });
  const disguised = await writeFile('fake.pdf', Buffer.from('not a pdf'));
  await expect(inspectKnowledgeFile(disguised)).rejects.toMatchObject({
    code: KnowledgeBaseErrorCode.UnsupportedFileType,
  });
});

test('keeps legacy DOC and PPT files as explicit no-text attachments', async () => {
  const oleHeader = Buffer.from('d0cf11e0a1b11ae1', 'hex');
  const document = await writeFile('legacy.doc', oleHeader);
  await expect(inspectKnowledgeFile(document)).resolves.toMatchObject({
    canExtractText: false,
    extension: '.doc',
    mimeType: 'application/msword',
  });
});

test('rejects binary bytes disguised as a plain-text extension', async () => {
  const disguised = await writeFile('fake.md', Buffer.from([0, 1, 2, 3]));
  await expect(inspectKnowledgeFile(disguised)).rejects.toMatchObject({
    code: KnowledgeBaseErrorCode.UnsupportedFileType,
  });
});
```

- [ ] **Step 5: Run file-inspection tests and verify RED**

```bash
npm test -- src/main/knowledgeBase/knowledgeFileInspection.test.ts
```

Expected: FAIL because the inspection module does not exist.

- [ ] **Step 6: Implement the inspection contract**

```ts
export interface KnowledgeFileInspection {
  absolutePath: string;
  displayName: string;
  extension: string;
  mimeType: string;
  fileSize: number;
  sourceMtime: number;
  canExtractText: boolean;
}

export const inspectKnowledgeFile = async (
  absolutePath: string,
): Promise<KnowledgeFileInspection> => {
  const resolvedPath = path.resolve(absolutePath);
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile()) throw unsupportedType();
  if (stat.size > KNOWLEDGE_MAX_FILE_BYTES) throw fileTooLarge();
  const extension = path.extname(resolvedPath).toLowerCase();
  const header = await readHeader(resolvedPath, 512);
  const definition = requireMatchingDefinition(extension, header);
  return {
    absolutePath: resolvedPath,
    displayName: path.basename(resolvedPath),
    extension,
    mimeType: definition.mimeType,
    fileSize: stat.size,
    sourceMtime: stat.mtimeMs,
    canExtractText: definition.canExtractText,
  };
};
```

Definitions validate PDF, ZIP-based Office, OLE Office, PNG, JPEG, GIF, BMP, TIFF, WebP, and
HEIC/HEIF signatures. Plain-text formats reject NUL bytes in the inspected prefix. DOC/PPT are valid
managed attachments with `canExtractText: false`; every other accepted format is locally extractable.

- [ ] **Step 7: Run Task 2 tests and lint**

```bash
npm test -- src/main/knowledgeBase/knowledgeSelectionTokenStore.test.ts src/main/knowledgeBase/knowledgeFileInspection.test.ts
npx eslint --ext ts --report-unused-disable-directives --max-warnings 0 src/main/knowledgeBase/knowledgeSelectionTokenStore.ts src/main/knowledgeBase/knowledgeSelectionTokenStore.test.ts src/main/knowledgeBase/knowledgeFileInspection.ts src/main/knowledgeBase/knowledgeFileInspection.test.ts
```

Expected: PASS.

---

### Task 3: Document and Job Store Stage 2 Operations

**Files:**

- Modify: `src/main/knowledgeBase/knowledgeDocumentStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeDocumentStore.test.ts`
- Modify: `src/main/knowledgeBase/knowledgeIngestionJobStore.ts`
- Modify: `src/main/knowledgeBase/knowledgeIngestionJobStore.test.ts`

**Interfaces:**

- Produces visibility-aware listing, active logical-byte sum, active-version guarded worker commits,
  current-job queries, and queued cancellation by document.
- `KnowledgeDocumentService` and `KnowledgeIngestionService` consume these methods.

- [ ] **Step 1: Add failing document-store tests**

```ts
test('lists active and deleted documents separately', () => {
  const created = store.createDocumentWithVersion(createInput());
  store.softDeleteDocument(created.document.id, created.document.revision);
  expect(store.listDocuments('workspace-a', { visibility: KnowledgeDocumentVisibility.Active }))
    .toEqual([]);
  expect(store.listDocuments('workspace-a', { visibility: KnowledgeDocumentVisibility.Deleted }))
    .toHaveLength(1);
});

test('sums only active managed current-version bytes for quota', () => {
  createManagedDocument(10);
  const deleted = createManagedDocument(20);
  createLinkedDocument(30);
  store.softDeleteDocument(deleted.document.id, deleted.document.revision);
  expect(store.getActiveManagedBytes('workspace-a')).toBe(10);
});

test('commits extraction only for an active current version', () => {
  const created = store.createDocumentWithVersion(createInput());
  expect(store.applyExtractionResult({
    documentId: created.document.id,
    documentVersionId: created.version.id,
    extractedText: 'local text',
    extractionPartial: false,
    parser: 'pdf',
    status: KnowledgeDocumentStatus.Ready,
  })).toBe(true);
  expect(store.getVersion(created.version.id)?.extractedText).toBe('local text');
});
```

- [ ] **Step 2: Add failing job-store tests**

```ts
test('returns one latest job per active document version', () => {
  const job = store.createJob(createJobInput());
  expect(store.listCurrentJobs('workspace-a')).toEqual([job]);
  expect(store.getCurrentJob(job.documentId, job.documentVersionId)?.id).toBe(job.id);
});

test('cancels queued jobs for one document without cancelling running attempts', () => {
  const queued = store.createJob(createJobInput());
  expect(store.cancelQueuedJobsForDocument(queued.documentId)).toBe(1);
  expect(store.getJob(queued.id)?.status).toBe(KnowledgeIngestionJobStatus.Cancelled);
});
```

- [ ] **Step 3: Run both store tests and verify RED**

```bash
npm test -- src/main/knowledgeBase/knowledgeDocumentStore.test.ts src/main/knowledgeBase/knowledgeIngestionJobStore.test.ts
```

Expected: FAIL on missing Stage 2 methods/options.

- [ ] **Step 4: Implement exact document-store API**

```ts
listDocuments(
  workspaceId: string,
  options: { visibility?: KnowledgeDocumentVisibility } = {},
): KnowledgeDocumentSummary[];

getActiveManagedBytes(workspaceId: string): number;

applyExtractionResult(input: {
  documentId: string;
  documentVersionId: string;
  parser: string;
  extractedText: string | null;
  extractionPartial: boolean;
  status: KnowledgeDocumentStatus;
}): boolean;

setDocumentStatusIfCurrentVersion(input: {
  documentId: string;
  documentVersionId: string;
  status: KnowledgeDocumentStatus;
}): boolean;
```

The extraction update transaction first verifies `current_version_id`, `deleted_at IS NULL`, then
updates derived version fields and increments document revision/status. It returns `false` for stale
or deleted targets and never commits stale worker output.

- [ ] **Step 5: Implement exact job-store API**

```ts
getCurrentJob(documentId: string, documentVersionId: string): KnowledgeIngestionJob | null;
listCurrentJobs(workspaceId: string): KnowledgeIngestionJob[];
cancelQueuedJobsForDocument(documentId: string, now?: string): number;
```

Use one window-function or `NOT EXISTS` SQL query for current jobs; do not issue one query per
document. Queued cancellation updates only `status = queued` rows.

- [ ] **Step 6: Run store regressions and lint**

```bash
npm test -- src/main/knowledgeBase/knowledgeDocumentStore.test.ts src/main/knowledgeBase/knowledgeIngestionJobStore.test.ts
npx eslint --ext ts --report-unused-disable-directives --max-warnings 0 src/main/knowledgeBase/knowledgeDocumentStore.ts src/main/knowledgeBase/knowledgeDocumentStore.test.ts src/main/knowledgeBase/knowledgeIngestionJobStore.ts src/main/knowledgeBase/knowledgeIngestionJobStore.test.ts
```

Expected: PASS, including the existing 1,000-document no-text test.

---

### Task 4: Stable Legacy Compatibility Projection

**Files:**

- Modify: `src/main/enterpriseLeadWorkspace/store.ts`
- Modify: `src/main/enterpriseLeadWorkspace/store.test.ts`
- Create: `src/main/knowledgeBase/enterpriseLeadKnowledgeCompatibilityAdapter.ts`
- Create: `src/main/knowledgeBase/enterpriseLeadKnowledgeCompatibilityAdapter.test.ts`

**Interfaces:**

- Produces atomic `upsertWorkspaceSourceById` and `removeWorkspaceSourceById` store operations.
- Produces adapter methods `upsertDocument`, `removeDocument`, and `updateDocumentStatus`.
- Projection IDs use `knowledge-document:<documentId>` and never depend on array order.

- [ ] **Step 1: Write failing atomic-merge tests**

```ts
test('upserts one stable source without replacing unrelated legacy entries', () => {
  const workspace = createWorkspaceWithSources([{ id: 'legacy-a', kind: 'file', label: 'A' }]);
  store.upsertWorkspaceSourceById(workspace.id, {
    id: 'knowledge-document:doc-1',
    kind: EnterpriseLeadExtractionSourceKind.File,
    label: 'Managed.pdf',
  });
  expect(store.getWorkspace(workspace.id)?.extractionSources.map(source => source.id)).toEqual([
    'legacy-a',
    'knowledge-document:doc-1',
  ]);
});

test('removes only the matching projected source', () => {
  const workspace = createWorkspaceWithSources(projectedAndLegacySources());
  store.removeWorkspaceSourceById(workspace.id, 'knowledge-document:doc-1');
  expect(store.getWorkspace(workspace.id)?.extractionSources).toEqual([
    expect.objectContaining({ id: 'legacy-a' }),
  ]);
});
```

- [ ] **Step 2: Write failing adapter no-raw-text test**

```ts
test('projects display metadata and status without raw text or local path', () => {
  adapter.upsertDocument(documentListItem({ id: 'doc-1', status: KnowledgeDocumentStatus.Pending }));
  const projected = workspaceStore.getWorkspace('workspace-a')?.extractionSources[0];
  expect(projected).toMatchObject({
    id: 'knowledge-document:doc-1',
    extractionStatus: EnterpriseLeadDocumentExtractionStatus.Pending,
    label: 'Managed.pdf',
  });
  expect(projected).not.toHaveProperty('text');
  expect(projected).not.toHaveProperty('filePath');
});
```

- [ ] **Step 3: Run tests and verify RED**

```bash
npm test -- src/main/enterpriseLeadWorkspace/store.test.ts src/main/knowledgeBase/enterpriseLeadKnowledgeCompatibilityAdapter.test.ts
```

Expected: FAIL because stable projection methods do not exist.

- [ ] **Step 4: Implement store and adapter contracts**

```ts
export const buildKnowledgeDocumentLegacySourceId = (documentId: string): string =>
  `knowledge-document:${documentId}`;

export class EnterpriseLeadKnowledgeCompatibilityAdapter {
  constructor(private readonly workspaceStore: Pick<
    EnterpriseLeadWorkspaceStore,
    'getWorkspace' | 'removeWorkspaceSourceById' | 'upsertWorkspaceSourceById'
  >) {}

  upsertDocument(workspaceId: string, document: KnowledgeDocumentListItem): void;
  removeDocument(workspaceId: string, documentId: string): void;
}
```

Map normalized statuses with this total mapping, omit `text`, `filePath`, and internal errors, and do
not call `EnterpriseLeadWorkspaceService.updateWorkspaceSources`:

```ts
const legacyExtractionStatusByDocumentStatus: Record<
  KnowledgeDocumentStatus,
  EnterpriseLeadDocumentExtractionStatus
> = {
  [KnowledgeDocumentStatus.Pending]: EnterpriseLeadDocumentExtractionStatus.Pending,
  [KnowledgeDocumentStatus.Processing]: EnterpriseLeadDocumentExtractionStatus.Extracting,
  [KnowledgeDocumentStatus.Ready]: EnterpriseLeadDocumentExtractionStatus.Extracted,
  [KnowledgeDocumentStatus.CompletedWithoutText]: EnterpriseLeadDocumentExtractionStatus.Extracted,
  [KnowledgeDocumentStatus.Failed]: EnterpriseLeadDocumentExtractionStatus.Failed,
};
```

Set compatibility vector status to failed only for normalized failures and pending for every other
state. This projection is transitional metadata, not a claim that Stage 3 retrieval is complete.

- [ ] **Step 5: Run tests and lint**

```bash
npm test -- src/main/enterpriseLeadWorkspace/store.test.ts src/main/knowledgeBase/enterpriseLeadKnowledgeCompatibilityAdapter.test.ts
npx eslint --ext ts --report-unused-disable-directives --max-warnings 0 src/main/enterpriseLeadWorkspace/store.ts src/main/enterpriseLeadWorkspace/store.test.ts src/main/knowledgeBase/enterpriseLeadKnowledgeCompatibilityAdapter.ts src/main/knowledgeBase/enterpriseLeadKnowledgeCompatibilityAdapter.test.ts
```

Expected: PASS.

---

### Task 5: Knowledge Document Service

**Files:**

- Create: `src/main/knowledgeBase/knowledgeDocumentService.ts`
- Create: `src/main/knowledgeBase/knowledgeDocumentService.test.ts`

**Interfaces:**

- Consumes the token, document, managed-file, job, compatibility, and workspace stores.
- Produces all seven IPC-facing operations except the native dialog itself.
- Accepts injected `statFile` and file-type resolution for deterministic tests.

- [ ] **Step 1: Write failing partial-success import tests**

```ts
test('imports valid siblings when one selected file fails', async () => {
  const selection = tokenStore.issue(7, [
    selected('/tmp/good.pdf', 10, 100),
    selected('/tmp/missing.pdf', 20, 100),
  ]);
  const result = await service.importSelection({
    ownerId: 7,
    workspaceId: 'workspace-a',
    selectionToken: selection.selectionToken,
  });
  expect(result.importedCount).toBe(1);
  expect(result.failedCount).toBe(1);
  expect(documentStore.listDocuments('workspace-a')).toHaveLength(1);
  expect(jobStore.listCurrentJobs('workspace-a')).toHaveLength(1);
});

test('rejects changed selected files and consumed-token replay', async () => {
  const selection = tokenStore.issue(7, [selected('/tmp/a.pdf', 10, 100)]);
  statFile.mockResolvedValue({ isFile: true, size: 11, mtimeMs: 100 });
  const first = await service.importSelection(importRequest(selection.selectionToken));
  expect(first.items[0]).toMatchObject({
    success: false,
    errorCode: KnowledgeBaseErrorCode.SelectedFileChanged,
  });
  await expect(service.importSelection(importRequest(selection.selectionToken))).rejects.toMatchObject({
    code: KnowledgeBaseErrorCode.InvalidSelectionToken,
  });
});

test('enforces logical workspace quota before persistence', async () => {
  vi.spyOn(documentStore, 'getActiveManagedBytes')
    .mockReturnValue(KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES - 5);
  const result = await importOneSelectedFile({ size: 10 });
  expect(result.items[0]).toMatchObject({
    success: false,
    errorCode: KnowledgeBaseErrorCode.WorkspaceQuotaExceeded,
  });
});
```

- [ ] **Step 2: Write failing list/details/lifecycle tests**

```ts
test('returns display-safe lists and loads extracted text only in details', () => {
  const list = service.listDocuments({ workspaceId: 'workspace-a', visibility: 'active' });
  expect(list[0]).not.toHaveProperty('extractedText');
  expect(list[0]).not.toHaveProperty('originalPath');
  expect(service.getDocumentDetails({ documentId: list[0].id }).activeVersion.extractedText)
    .toBe('stored text');
});

test('soft deletes with queued cancellation, restores, and retries the exact active version', () => {
  const deleted = service.deleteDocument({ documentId: 'doc-1', expectedRevision: 1 });
  expect(deleted.deletedAt).not.toBeNull();
  expect(jobStore.getCurrentJob('doc-1', 'version-1')?.status).toBe('cancelled');
  const restored = service.restoreDocument({
    documentId: 'doc-1',
    expectedRevision: deleted.revision,
  });
  expect(restored.deletedAt).toBeNull();
  expect(service.retryDocument({ documentId: 'doc-1', documentVersionId: 'version-1' })
    .currentJob?.status).toBe('queued');
});
```

- [ ] **Step 3: Run the service test and verify RED**

```bash
npm test -- src/main/knowledgeBase/knowledgeDocumentService.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 4: Implement service dependencies and safe mapping**

```ts
export interface KnowledgeDocumentServiceOptions {
  db: Database.Database;
  documentStore: KnowledgeDocumentStore;
  jobStore: KnowledgeIngestionJobStore;
  managedFileStore: KnowledgeManagedFileStore;
  selectionTokenStore: KnowledgeSelectionTokenStore;
  compatibilityAdapter: EnterpriseLeadKnowledgeCompatibilityAdapter;
  workspaceExists: (workspaceId: string) => boolean;
  inspectFile?: (absolutePath: string) => Promise<KnowledgeFileInspection>;
  onJobsQueued?: () => void;
}

export class KnowledgeDocumentService {
  importSelection(input: {
    ownerId: number;
    workspaceId: string;
    selectionToken: string;
  }): Promise<KnowledgeImportBatchResult>;
  listDocuments(input: KnowledgeListDocumentsRequest): KnowledgeDocumentListItem[];
  getDocumentDetails(input: KnowledgeDocumentDetailsRequest): KnowledgeDocumentDetails;
  deleteDocument(input: KnowledgeDocumentRevisionRequest): KnowledgeDocumentListItem;
  restoreDocument(input: KnowledgeDocumentRevisionRequest): KnowledgeDocumentListItem;
  retryDocument(input: KnowledgeRetryDocumentRequest): KnowledgeDocumentListItem;
}
```

Each file imports independently. The per-file database transaction creates document/version/job and
the projection together. `onJobsQueued` runs once after the batch if at least one item succeeded.
Safe mapping joins current jobs in memory from one `listCurrentJobs` query.

- [ ] **Step 5: Implement stable service error classes and mapping inputs**

Service exceptions carry only a `KnowledgeBaseErrorCode`, optional safe file name, and optional
current document. They never embed absolute paths. Revision conflicts preserve the latest safe DTO.

- [ ] **Step 6: Run service and Stage 1 regressions**

```bash
npm test -- src/main/knowledgeBase/knowledgeDocumentService.test.ts src/main/knowledgeBase/knowledgeDocumentStore.test.ts src/main/knowledgeBase/knowledgeIngestionJobStore.test.ts src/main/knowledgeBase/knowledgeManagedFileStore.test.ts
npx eslint --ext ts --report-unused-disable-directives --max-warnings 0 src/main/knowledgeBase/knowledgeDocumentService.ts src/main/knowledgeBase/knowledgeDocumentService.test.ts
```

Expected: PASS.

---

### Task 6: Extension-Hinted Local Ingestion Worker

**Files:**

- Modify: `src/main/libs/documentTextExtractor.ts`
- Modify: `src/main/libs/documentTextExtractor.test.ts`
- Create: `src/main/knowledgeBase/knowledgeIngestionService.ts`
- Create: `src/main/knowledgeBase/knowledgeIngestionService.test.ts`

**Interfaces:**

- Adds `extensionHint?: string` to local extractor options so extensionless managed blobs parse by
  the original display-name extension.
- Produces `KnowledgeIngestionService.wake()` and `waitForIdle()`.
- Consumes no model client and has no cloud dependency.

- [ ] **Step 1: Write failing extension-hint test**

```ts
test('parses an extensionless managed blob using an extension hint', async () => {
  const blobPath = await writeFixture('managed-blob', '# Local knowledge');
  const result = await extractDocumentTextFromFile(blobPath, { extensionHint: '.md' });
  expect(result).toMatchObject({ content: '# Local knowledge', parser: 'text' });
});
```

- [ ] **Step 2: Run extractor test and verify RED**

```bash
npm test -- src/main/libs/documentTextExtractor.test.ts
```

Expected: FAIL because `extensionHint` is ignored or not typed.

- [ ] **Step 3: Implement extension-hint parser selection**

```ts
export interface ExtractDocumentTextOptions {
  extensionHint?: string;
  image?: ExtractImageTextOptions;
}

const normalizeExtensionHint = (value?: string): string => {
  const trimmed = value?.trim().toLowerCase() ?? '';
  if (!trimmed) return '';
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
};
```

Use the hint only for parser selection; continue reading bytes from the resolved managed path. Pass
the same hint into the image extractor so OCR does not re-derive an empty extension.

- [ ] **Step 4: Write failing worker behavior and concurrency tests**

```ts
test('drains a queued job and commits local text to the exact current version', async () => {
  ingestion.wake();
  await ingestion.waitForIdle();
  expect(extractDocumentText).toHaveBeenCalledWith(managedBlobPath, {
    extensionHint: '.pdf',
    onProgress: expect.any(Function),
  });
  expect(documentStore.getVersion('version-1')?.extractedText).toBe('local text');
  expect(documentStore.getDocument('doc-1')?.status).toBe(KnowledgeDocumentStatus.Ready);
  expect(jobStore.getJob('job-1')?.status).toBe(KnowledgeIngestionJobStatus.Completed);
});

test('limits general work to two jobs and OCR to one job', async () => {
  await runFourControlledJobs({ imageJobs: 2 });
  expect(maxObservedGeneralConcurrency).toBe(2);
  expect(maxObservedOcrConcurrency).toBe(1);
});

test('does not commit output after deletion or active-version replacement', async () => {
  const extraction = holdExtraction();
  ingestion.wake();
  softDeleteOrReplaceActiveVersion();
  extraction.resolve(localExtraction('stale text'));
  await ingestion.waitForIdle();
  expect(documentStore.getVersion('version-1')?.extractedText).toBeNull();
});

test('never requires or calls a cloud model', async () => {
  expect(Object.keys(ingestionDependencies)).not.toContain('modelClient');
});
```

- [ ] **Step 5: Run worker test and verify RED**

```bash
npm test -- src/main/knowledgeBase/knowledgeIngestionService.test.ts
```

Expected: FAIL because the worker does not exist.

- [ ] **Step 6: Implement the bounded worker API**

```ts
export interface KnowledgeIngestionServiceOptions {
  documentStore: KnowledgeDocumentStore;
  jobStore: KnowledgeIngestionJobStore;
  managedFileStore: KnowledgeManagedFileStore;
  extractDocumentText: (
    managedPath: string,
    options: { extensionHint: string; onProgress?: (progress: number) => void },
  ) => Promise<{ content: string; parser: string; truncated: boolean }>;
  onDocumentUpdated?: (workspaceId: string, documentId: string) => void;
}

export class KnowledgeIngestionService {
  wake(): void;
  waitForIdle(): Promise<void>;
}
```

Use a two-worker drain loop and an internal one-permit OCR semaphore. Claim jobs through the durable
store, set document processing state, heartbeat OCR progress, sanitize failures to stable codes,
and call `applyExtractionResult` before completing the attempt. If the active-version guard returns
false, cancel the claimed attempt without committing text.

- [ ] **Step 7: Run local ingestion regressions and lint**

```bash
npm test -- src/main/libs/documentTextExtractor.test.ts src/main/knowledgeBase/knowledgeIngestionService.test.ts src/main/knowledgeBase/knowledgeDocumentStore.test.ts src/main/knowledgeBase/knowledgeIngestionJobStore.test.ts
npx eslint --ext ts --report-unused-disable-directives --max-warnings 0 src/main/libs/documentTextExtractor.ts src/main/libs/documentTextExtractor.test.ts src/main/knowledgeBase/knowledgeIngestionService.ts src/main/knowledgeBase/knowledgeIngestionService.test.ts
```

Expected: PASS.

---

### Task 7: Knowledge-Base IPC, Preload, and Renderer Service

**Files:**

- Create: `src/main/knowledgeBase/ipcHandlers.ts`
- Create: `src/main/knowledgeBase/ipcHandlers.test.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Create: `src/renderer/services/knowledgeBase.ts`
- Create: `src/renderer/services/knowledgeBase.test.ts`

**Interfaces:**

- Main handler receives an injected picker and `KnowledgeDocumentService`.
- Preload exposes a sibling `window.electron.knowledgeBase` object.
- Renderer service unwraps `KnowledgeBaseIpcResult` and throws a typed safe error.

- [ ] **Step 1: Write failing handler tests**

```ts
test('selects files in main, binds the token to sender id, and returns no paths', async () => {
  const handler = registered.get(KnowledgeBaseIpc.SelectFiles);
  const result = await handler?.(fakeEvent({ senderId: 7 }), undefined);
  expect(selectionTokenStore.issue).toHaveBeenCalledWith(7, expect.any(Array));
  expect(JSON.stringify(result)).not.toContain('/private/');
});

test('validates mutation payloads and maps internal errors to stable safe errors', async () => {
  const handler = registered.get(KnowledgeBaseIpc.DeleteDocument);
  expect(await handler?.(fakeEvent(), { documentId: '', expectedRevision: -1 })).toEqual({
    success: false,
    error: { code: KnowledgeBaseErrorCode.InvalidRequest },
  });
});

test('returns the latest display-safe document on revision conflict', async () => {
  documentService.deleteDocument.mockImplementation(() => {
    throw revisionConflict(displaySafeDocument());
  });
  const result = await invokeDelete();
  expect(result).toEqual({
    success: false,
    error: {
      code: KnowledgeBaseErrorCode.RevisionConflict,
      latestDocument: displaySafeDocument(),
    },
  });
});
```

- [ ] **Step 2: Run handler tests and verify RED**

```bash
ELECTRON_OVERRIDE_DIST_PATH=/Users/lijiahao/yuzhh-ai-assistant/node_modules/electron/dist npm test -- src/main/knowledgeBase/ipcHandlers.test.ts
```

Expected: FAIL because handlers do not exist.

- [ ] **Step 3: Implement handler registration**

```ts
export interface KnowledgeBaseHandlerDeps {
  documentService: KnowledgeDocumentService;
  selectionTokenStore: KnowledgeSelectionTokenStore;
  showOpenDialog: (event: IpcMainInvokeEvent) => Promise<{ canceled: boolean; filePaths: string[] }>;
  statSelectedFile: (absolutePath: string) => Promise<SelectedKnowledgeFileEntry>;
}

export const registerKnowledgeBaseHandlers = (deps: KnowledgeBaseHandlerDeps): void => {
  ipcMain.handle(KnowledgeBaseIpc.SelectFiles, async event => selectFiles(event, deps));
  ipcMain.handle(KnowledgeBaseIpc.ImportSelection, async (event, input) =>
    invokeSafely(() => deps.documentService.importSelection(readImportInput(event, input))),
  );
};
```

Register these remaining handlers in addition to the two shown above:

```ts
ipcMain.handle(KnowledgeBaseIpc.ListDocuments, async (_event, input) =>
  invokeSafely(() => deps.documentService.listDocuments(readListInput(input))),
);
ipcMain.handle(KnowledgeBaseIpc.GetDocumentDetails, async (_event, input) =>
  invokeSafely(() => deps.documentService.getDocumentDetails(readDetailsInput(input))),
);
ipcMain.handle(KnowledgeBaseIpc.DeleteDocument, async (_event, input) =>
  invokeSafely(() => deps.documentService.deleteDocument(readRevisionInput(input))),
);
ipcMain.handle(KnowledgeBaseIpc.RestoreDocument, async (_event, input) =>
  invokeSafely(() => deps.documentService.restoreDocument(readRevisionInput(input))),
);
ipcMain.handle(KnowledgeBaseIpc.RetryDocument, async (_event, input) =>
  invokeSafely(() => deps.documentService.retryDocument(readRetryInput(input))),
);
```

Attach one owner-destroyed listener per sender that calls
`selectionTokenStore.clearOwner(sender.id)`. Selection filters come from the main process and cap the
picker result before token issue.

- [ ] **Step 4: Add preload and window typing**

```ts
knowledgeBase: {
  selectFiles: () => ipcRenderer.invoke(KnowledgeBaseIpc.SelectFiles),
  importSelection: (input: KnowledgeImportSelectionRequest) =>
    ipcRenderer.invoke(KnowledgeBaseIpc.ImportSelection, input),
  listDocuments: (input: KnowledgeListDocumentsRequest) =>
    ipcRenderer.invoke(KnowledgeBaseIpc.ListDocuments, input),
  getDocumentDetails: (input: KnowledgeDocumentDetailsRequest) =>
    ipcRenderer.invoke(KnowledgeBaseIpc.GetDocumentDetails, input),
  deleteDocument: (input: KnowledgeDocumentRevisionRequest) =>
    ipcRenderer.invoke(KnowledgeBaseIpc.DeleteDocument, input),
  restoreDocument: (input: KnowledgeDocumentRevisionRequest) =>
    ipcRenderer.invoke(KnowledgeBaseIpc.RestoreDocument, input),
  retryDocument: (input: KnowledgeRetryDocumentRequest) =>
    ipcRenderer.invoke(KnowledgeBaseIpc.RetryDocument, input),
},
```

The declaration uses the same shared request/result types and contains no path parameter.

- [ ] **Step 5: Write failing renderer service tests**

```ts
test('unwraps successful list responses', async () => {
  api.listDocuments.mockResolvedValue({ success: true, data: [displaySafeDocument()] });
  await expect(knowledgeBaseService.listDocuments('workspace-a', 'active'))
    .resolves.toEqual([displaySafeDocument()]);
});

test('throws a typed safe error without internal messages', async () => {
  api.deleteDocument.mockResolvedValue({
    success: false,
    error: { code: KnowledgeBaseErrorCode.RevisionConflict, latestDocument: displaySafeDocument() },
  });
  await expect(knowledgeBaseService.deleteDocument('doc-1', 1)).rejects.toMatchObject({
    code: KnowledgeBaseErrorCode.RevisionConflict,
    latestDocument: displaySafeDocument(),
  });
});
```

- [ ] **Step 6: Implement renderer wrapper and run tests/lint**

```ts
export class KnowledgeBaseServiceError extends Error {
  constructor(
    readonly code: KnowledgeBaseErrorCode,
    readonly latestDocument?: KnowledgeDocumentListItem,
    readonly fileName?: string,
  ) {
    super(code);
    this.name = 'KnowledgeBaseServiceError';
  }
}
```

```bash
ELECTRON_OVERRIDE_DIST_PATH=/Users/lijiahao/yuzhh-ai-assistant/node_modules/electron/dist npm test -- src/main/knowledgeBase/ipcHandlers.test.ts src/renderer/services/knowledgeBase.test.ts
npx eslint --ext ts --report-unused-disable-directives --max-warnings 0 src/main/knowledgeBase/ipcHandlers.ts src/main/knowledgeBase/ipcHandlers.test.ts src/main/preload.ts src/renderer/types/electron.d.ts src/renderer/services/knowledgeBase.ts src/renderer/services/knowledgeBase.test.ts
```

Expected: PASS.

---

### Task 8: Foundation and Electron Lifecycle Wiring

**Files:**

- Modify: `src/main/knowledgeBase/knowledgeBaseFoundation.ts`
- Modify: `src/main/knowledgeBase/knowledgeBaseFoundation.test.ts`
- Modify: `src/main/main.ts`

**Interfaces:**

- Foundation exposes `documentService`, `ingestionService`, `selectionTokenStore`, and existing Stage
  1 stores/migration.
- Main registers handlers after enterprise workspace handlers and before shadow migration.
- Startup recovery wakes the worker only after stale running jobs are requeued.

- [ ] **Step 1: Write failing foundation integration test**

```ts
test('recovers stale jobs before waking local ingestion', async () => {
  await foundation.recoverMigrateAndStart([{ id: 'workspace-a', extractionSources: [] }], now);
  expect(events).toEqual(['recover', 'migrate:workspace-a', 'wake']);
});

test('workspace deletion clears normalized state and compatibility projection', () => {
  foundation.deleteWorkspaceData('workspace-a');
  expect(foundation.documentStore.listDocuments('workspace-a', { visibility: 'deleted' }))
    .toEqual([]);
  expect(workspaceStore.getWorkspace('workspace-a')?.extractionSources).not.toContainEqual(
    expect.objectContaining({ id: 'knowledge-document:doc-1' }),
  );
});
```

- [ ] **Step 2: Run foundation test and verify RED**

```bash
npm test -- src/main/knowledgeBase/knowledgeBaseFoundation.test.ts
```

Expected: FAIL on missing Stage 2 composition/start behavior.

- [ ] **Step 3: Extend foundation composition**

```ts
export interface KnowledgeBaseFoundation {
  documentService: KnowledgeDocumentService;
  ingestionService: KnowledgeIngestionService;
  selectionTokenStore: KnowledgeSelectionTokenStore;
  documentStore: KnowledgeDocumentStore;
  jobStore: KnowledgeIngestionJobStore;
  migrationStore: KnowledgeMigrationStore;
  migrationService: KnowledgeMigrationService;
  recoverMigrateAndStart: (workspaces: LegacyKnowledgeWorkspace[], now?: string) => Promise<void>;
  deleteWorkspaceData: (workspaceId: string) => void;
}
```

Accept injected `workspaceStore`, `extractDocumentText`, and user-data path. Wire document-service
job wakeups to `ingestionService.wake` without creating a circular constructor dependency.

- [ ] **Step 4: Register main IPC and picker dependencies**

Register `registerKnowledgeBaseHandlers` immediately after enterprise workspace handlers. Use
`BrowserWindow.fromWebContents`, `dialog.showOpenDialog`, `fs.promises.stat`, `path.basename`, and
the current document filter extensions only inside main. Inject `extractDocumentTextFromFile` with
`workspaceOcrAssetPaths` into the ingestion service.

- [ ] **Step 5: Run main-process verification**

```bash
ELECTRON_OVERRIDE_DIST_PATH=/Users/lijiahao/yuzhh-ai-assistant/node_modules/electron/dist npm test -- src/main/knowledgeBase/knowledgeBaseFoundation.test.ts src/main/knowledgeBase/ipcHandlers.test.ts src/main/knowledgeBase/knowledgeDocumentService.test.ts src/main/knowledgeBase/knowledgeIngestionService.test.ts src/main/enterpriseLeadWorkspace/store.test.ts
npm run compile:electron
```

Expected: PASS.

---

### Task 9: Renderer Document State, Polling, and Presentation

**Files:**

- Create: `src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.ts`
- Create: `src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts`
- Create: `src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.ts`
- Create: `src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.test.ts`
- Modify: `src/renderer/services/i18n.ts`

**Interfaces:**

- Produces pure status/filter/batch helpers.
- Produces a hook with active/deleted lists, details, upload, delete, restore, retry, and two-second
  single-flight polling.
- The focused panel in Task 10 consumes this hook.

- [ ] **Step 1: Write failing pure presentation tests**

```ts
test('does not describe no-text completion as searchable success', () => {
  expect(getKnowledgeDocumentStatusKey(KnowledgeDocumentStatus.CompletedWithoutText))
    .toBe('enterpriseKnowledgeDocumentStatusSavedNotSearchable');
});

test('summarizes partial batch success without leaking paths', () => {
  expect(summarizeKnowledgeImportBatch({ importedCount: 8, failedCount: 2, items: [] })).toEqual({
    key: 'enterpriseKnowledgeImportPartialSuccess',
    values: { imported: 8, failed: 2 },
  });
});

test('polls only while a visible document has active work', () => {
  expect(shouldPollKnowledgeDocuments([documentWithJob('queued')])).toBe(true);
  expect(shouldPollKnowledgeDocuments([documentWithJob('running')])).toBe(true);
  expect(shouldPollKnowledgeDocuments([documentWithJob('completed')])).toBe(false);
});
```

- [ ] **Step 2: Run presentation tests and verify RED**

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts
```

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement pure helpers and both-language strings**

Add this complete key set to both `zh` and `en` dictionaries:

```ts
const knowledgeDocumentI18nKeys = [
  'enterpriseKnowledgeUploadFiles',
  'enterpriseKnowledgeActiveDocuments',
  'enterpriseKnowledgeDeletedDocuments',
  'enterpriseKnowledgeDeleteDocument',
  'enterpriseKnowledgeRestoreDocument',
  'enterpriseKnowledgeRetryDocument',
  'enterpriseKnowledgeDocumentStatusPending',
  'enterpriseKnowledgeDocumentStatusProcessing',
  'enterpriseKnowledgeDocumentStatusReady',
  'enterpriseKnowledgeDocumentStatusSavedNotSearchable',
  'enterpriseKnowledgeDocumentStatusFailed',
  'enterpriseKnowledgeDocumentStatusDeleted',
  'enterpriseKnowledgeImportSuccess',
  'enterpriseKnowledgeImportPartialSuccess',
  'enterpriseKnowledgeImportFailed',
  'enterpriseKnowledgeRevisionConflict',
  'enterpriseKnowledgeSelectionUnavailable',
  'enterpriseKnowledgeErrorInvalidSelection',
  'enterpriseKnowledgeErrorTooManyFiles',
  'enterpriseKnowledgeErrorFileTooLarge',
  'enterpriseKnowledgeErrorUnsupportedType',
  'enterpriseKnowledgeErrorFileChanged',
  'enterpriseKnowledgeErrorQuotaExceeded',
  'enterpriseKnowledgeErrorPersistence',
] as const;
```

Chinese copy must state “已保存，但不可搜索” for `completed_without_text`; English copy must state
“Saved, not searchable”.

- [ ] **Step 4: Write failing hook polling tests with fake timers**

```ts
test('runs one request at a time and stops polling when work completes', async () => {
  vi.useFakeTimers();
  const first = deferred<KnowledgeDocumentListItem[]>();
  api.listDocuments.mockReturnValueOnce(first.promise);
  const hook = renderKnowledgeDocumentsHook('workspace-a');
  await vi.advanceTimersByTimeAsync(4_000);
  expect(api.listDocuments).toHaveBeenCalledTimes(1);
  first.resolve([documentWithJob('completed')]);
  await hook.flush();
  await vi.advanceTimersByTimeAsync(4_000);
  expect(api.listDocuments).toHaveBeenCalledTimes(1);
});

test('stops old-workspace responses from replacing new-workspace state', async () => {
  const oldRequest = deferred<KnowledgeDocumentListItem[]>();
  api.listDocuments.mockReturnValueOnce(oldRequest.promise).mockResolvedValueOnce([newDocument()]);
  const hook = renderKnowledgeDocumentsHook('workspace-a');
  hook.rerender('workspace-b');
  oldRequest.resolve([oldDocument()]);
  await hook.flush();
  expect(hook.current.documents).toEqual([newDocument()]);
});
```

- [ ] **Step 5: Implement focused hook**

```ts
export interface WorkspaceKnowledgeDocumentsState {
  documents: KnowledgeDocumentListItem[];
  deletedDocuments: KnowledgeDocumentListItem[];
  selectedDetails: KnowledgeDocumentDetails | null;
  isLoading: boolean;
  isMutating: boolean;
  error: KnowledgeBaseServiceError | null;
  refresh: () => Promise<void>;
  selectAndImport: () => Promise<KnowledgeImportBatchResult | null>;
  deleteDocument: (document: KnowledgeDocumentListItem) => Promise<void>;
  restoreDocument: (document: KnowledgeDocumentListItem) => Promise<void>;
  retryDocument: (document: KnowledgeDocumentListItem) => Promise<void>;
  loadDetails: (documentId: string) => Promise<void>;
}
```

Use one request-generation ref, one in-flight ref, and a two-second timeout only while
`shouldPollKnowledgeDocuments` is true. Preserve the last successful list on polling errors.

- [ ] **Step 6: Run hook/presentation tests and lint**

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.ts src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.ts src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.test.ts src/renderer/services/i18n.ts
```

Expected: PASS.

---

### Task 10: Focused Document Panel and Existing UI Cutover

**Files:**

- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.test.ts`

**Interfaces:**

- Panel accepts `workspaceId` and owns only normalized document UI.
- Parent keeps profile/AI-knowledge editing and mounts the panel for `activeView === 'documents'`.
- The old renderer path-reading upload helper is no longer called from this page.

- [ ] **Step 1: Write failing panel interaction tests**

```ts
test('imports through the tokenized knowledge-base service and reports partial success', async () => {
  const state = panelState({
    importResult: { importedCount: 8, failedCount: 2, items: [] },
  });
  const view = renderPanel(state);
  await view.clickByTextKey('enterpriseKnowledgeUploadFiles');
  expect(state.selectAndImport).toHaveBeenCalledTimes(1);
  expect(view.text()).toContain(i18n('enterpriseKnowledgeImportPartialSuccess'));
});

test('shows active and deleted views and invokes optimistic mutations', async () => {
  const state = panelState({ documents: [activeDocument()], deletedDocuments: [deletedDocument()] });
  const view = renderPanel(state);
  await view.clickDelete(activeDocument().id);
  expect(state.deleteDocument).toHaveBeenCalledWith(activeDocument());
  await view.openDeleted();
  await view.clickRestore(deletedDocument().id);
  expect(state.restoreDocument).toHaveBeenCalledWith(deletedDocument());
});

test('shows retry only for failed current jobs and uses saved-not-searchable copy', () => {
  const view = renderPanel(panelState({
    documents: [failedDocument(), completedWithoutTextDocument()],
  }));
  expect(view.retryIds()).toEqual([failedDocument().id]);
  expect(view.text()).toContain(i18n('enterpriseKnowledgeDocumentStatusSavedNotSearchable'));
});
```

- [ ] **Step 2: Run panel tests and verify RED**

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts
```

Expected: FAIL because the panel does not exist.

- [ ] **Step 3: Implement the focused panel**

Use this component boundary; child row/detail components may remain private in the same file:

```tsx
export interface WorkspaceKnowledgeDocumentsPanelProps {
  workspaceId: string;
}

export default function WorkspaceKnowledgeDocumentsPanel({
  workspaceId,
}: WorkspaceKnowledgeDocumentsPanelProps): React.ReactElement {
  const state = useWorkspaceKnowledgeDocuments(workspaceId);
  const [visibility, setVisibility] = useState<KnowledgeDocumentVisibility>(
    KnowledgeDocumentVisibility.Active,
  );
  const rows = visibility === KnowledgeDocumentVisibility.Active
    ? state.documents
    : state.deletedDocuments;

  return (
    <section className="grid min-h-0 gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setVisibility(KnowledgeDocumentVisibility.Active)}>
            {i18nService.t('enterpriseKnowledgeActiveDocuments')}
          </button>
          <button type="button" onClick={() => setVisibility(KnowledgeDocumentVisibility.Deleted)}>
            {i18nService.t('enterpriseKnowledgeDeletedDocuments')}
          </button>
        </div>
        <button type="button" disabled={state.isMutating} onClick={() => void state.selectAndImport()}>
          {i18nService.t('enterpriseKnowledgeUploadFiles')}
        </button>
      </header>
      <div className="min-h-0 overflow-auto">
        {rows.map(document => (
          <KnowledgeDocumentRow
            key={document.id}
            document={document}
            visibility={visibility}
            onOpen={() => void state.loadDetails(document.id)}
            onDelete={() => void state.deleteDocument(document)}
            onRestore={() => void state.restoreDocument(document)}
            onRetry={() => void state.retryDocument(document)}
          />
        ))}
      </div>
    </section>
  );
}
```

Add search filtering, status/stage/progress, safe batch feedback, delete confirmation, and details
preview inside this boundary. Do not read `window.electron.dialog`, `filePath`, or
`extractionSources`.

- [ ] **Step 4: Write failing parent cutover test**

```ts
test('mounts normalized document management without renderer path reads', () => {
  const source = readWorkspaceKnowledgeBaseSource();
  expect(source).toContain('WorkspaceKnowledgeDocumentsPanel');
  expect(source).not.toContain('resolveEnterpriseLeadKnowledgeDocumentUpload(dialogApi');
});
```

- [ ] **Step 5: Replace only the documents branch in the parent**

Import the panel and make the documents branch mount only this boundary:

```tsx
import WorkspaceKnowledgeDocumentsPanel from './WorkspaceKnowledgeDocumentsPanel';

{activeView === 'documents' ? (
  <WorkspaceKnowledgeDocumentsPanel workspaceId={currentWorkspace.id} />
) : null}
```

Delete only the old document-source rows, document drafts, path-reading upload handler, document
preview/delete modal branches, and their now-unused imports. Keep company/profile knowledge behavior
byte-for-byte where practical and do not reformat unrelated sections of the 3,000+ line file.

- [ ] **Step 6: Run renderer regressions, lint, and build**

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.test.ts src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.test.ts src/renderer/services/knowledgeBase.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.test.ts
npm run build
```

Expected: PASS.

---

### Task 11: Full Verification and Security Invariant Review

**Files:**

- Review all Stage 1 and Stage 2 changed files.
- Update this plan's checkboxes and progress notes without creating a commit.

**Interfaces:**

- Produces the verified handoff for user testing.

- [ ] **Step 1: Run all targeted knowledge-base and enterprise regressions**

```bash
ELECTRON_OVERRIDE_DIST_PATH=/Users/lijiahao/yuzhh-ai-assistant/node_modules/electron/dist npm test -- src/shared/knowledgeBase/contracts.test.ts src/main/knowledgeBase src/main/libs/documentTextExtractor.test.ts src/main/enterpriseLeadWorkspace/store.test.ts src/main/enterpriseLeadWorkspace/service.test.ts src/renderer/services/knowledgeBase.test.ts src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run changed-file ESLint**

Run the repository's strict changed-file command over every modified TS/TSX file:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/knowledgeBase/constants.ts src/shared/knowledgeBase/types.ts src/shared/knowledgeBase/contracts.test.ts src/main/knowledgeBase/knowledgeSelectionTokenStore.ts src/main/knowledgeBase/knowledgeSelectionTokenStore.test.ts src/main/knowledgeBase/knowledgeFileInspection.ts src/main/knowledgeBase/knowledgeFileInspection.test.ts src/main/knowledgeBase/knowledgeDocumentStore.ts src/main/knowledgeBase/knowledgeDocumentStore.test.ts src/main/knowledgeBase/knowledgeIngestionJobStore.ts src/main/knowledgeBase/knowledgeIngestionJobStore.test.ts src/main/knowledgeBase/enterpriseLeadKnowledgeCompatibilityAdapter.ts src/main/knowledgeBase/enterpriseLeadKnowledgeCompatibilityAdapter.test.ts src/main/knowledgeBase/knowledgeDocumentService.ts src/main/knowledgeBase/knowledgeDocumentService.test.ts src/main/knowledgeBase/knowledgeIngestionService.ts src/main/knowledgeBase/knowledgeIngestionService.test.ts src/main/knowledgeBase/ipcHandlers.ts src/main/knowledgeBase/ipcHandlers.test.ts src/main/knowledgeBase/knowledgeBaseFoundation.ts src/main/knowledgeBase/knowledgeBaseFoundation.test.ts src/main/enterpriseLeadWorkspace/store.ts src/main/enterpriseLeadWorkspace/store.test.ts src/main/libs/documentTextExtractor.ts src/main/libs/documentTextExtractor.test.ts src/main/preload.ts src/main/main.ts src/renderer/types/electron.d.ts src/renderer/services/knowledgeBase.ts src/renderer/services/knowledgeBase.test.ts src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.ts src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.ts src/renderer/components/enterpriseLeadWorkspace/useWorkspaceKnowledgeDocuments.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.test.ts src/renderer/services/i18n.ts
```

Expected: zero errors and zero warnings.

- [ ] **Step 3: Run Electron and renderer builds**

```bash
npm run compile:electron
npm run build
```

Expected: both succeed.

- [ ] **Step 4: Run the complete official test suite**

```bash
ELECTRON_OVERRIDE_DIST_PATH=/Users/lijiahao/yuzhh-ai-assistant/node_modules/electron/dist npm test
```

Expected: all existing and new Vitest tests pass; existing intentional skips remain skipped.

- [ ] **Step 5: Review security and migration invariants**

Run focused searches and inspect every match:

```bash
rg -n "sourceIndex|extractionSources|filePath|managedPath|extractedText" src/main/knowledgeBase src/shared/knowledgeBase src/renderer/services/knowledgeBase.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx
git diff --check
git status --short
```

Confirm:

- no renderer import request accepts a path;
- list DTOs contain no raw text or paths;
- new jobs use document/version IDs;
- compatibility projection contains no raw text/path;
- worker has no model-client dependency;
- full-array legacy replacement is absent from new code;
- no unrelated or generated files are included.

- [ ] **Step 6: Hand off for user testing without committing**

Report the branch/worktree, feature scope, exact verification results, known Stage 3 boundary, and
manual Electron test steps. Wait for explicit user confirmation before staging or committing.
