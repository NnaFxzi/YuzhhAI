# Workspace Creation Material Upload — Multi-File + Mainstream Formats

Date: 2026-07-10
Status: Approved (brainstorming)

## 1. Problem

`WorkspaceCreate.tsx` ("Create with material") accepts only **one file at a time** and only **readable text/rich
document** extensions (`pdf/docx/xls/xlsx/pptx/txt/md/csv/...`). It does not accept images (`png/jpg/...`) at all, and
there is no client-side size validation. The data model already supports
`extractionSources: EnterpriseLeadExtractionSource[]`, so this is a UI and wiring gap.

Goal: let users drop or select multiple mainstream files (images, PDFs, spreadsheets, documents, plain text) when
seeding a workspace, with sensible size limits and per-source processing.

## 2. Goals

- Accept multi-file selection (Electron multi-select dialog with browser fallback)
- Accept all currently-shipping formats:
  - Plain text: `txt md csv tsv json jsonl html xml yaml yml log`
  - Rich documents: `pdf docx xls xlsx pptx`
  - Attachment-only documents: `doc ppt` (stored, not parsed — parity with knowledge base)
  - Images: `png jpg jpeg webp gif bmp tif tiff heic heif` (stored as `Image` source, no OCR)
- Enforce 50 MB per-file client-side (matches `MAX_RICH_DOCUMENT_BYTES` in `src/main/libs/documentTextExtractor.ts`)
- Each file becomes its own `extractionSource` so failures are isolated and the existing per-source processing pipeline
  can be reused
- Keep `WorkspaceCreate.tsx` from growing past ~1000 lines by extracting a focused sub-component

## 3. Non-Goals

- OCR for images or scanned PDFs (no new dependency)
- Drag-and-drop reordering of selected files (YAGNI; can be added later if users want)
- File-level preview before submit in the create flow (the existing `WorkspaceKnowledgeBase.tsx` already wires
  `DocumentRenderer` for saved documents; pre-submit preview can be a follow-up)
- Changes to `WorkspaceKnowledgeBase.tsx` "Add document" flow (it already supports images + multi-format; this spec is
  scoped to creation)

## 4. Design

### 4.1 New files

**`src/renderer/components/enterpriseLeadWorkspace/WorkspaceMaterialUpload.tsx`**

Controlled component that owns:

- The dropzone button
- The hidden `<input type="file" multiple accept=...>`
- The compact file list rendering
- Per-file validation (size, extension)
- Calls `dialogApi.selectFiles` first; falls back to browser `<input>` if dialog is unavailable

Public props:

```ts
interface WorkspaceMaterialUploadProps {
  items: MaterialUploadItem[];
  onItemsChange: (items: MaterialUploadItem[]) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}
```

Behavior:

- Click dropzone → try `dialogApi.selectFiles({ title, filters })` → on success iterate `result.paths`, validate each,
  append to list
- If `dialogApi.selectFiles` is missing → click dropzone triggers the hidden input (`multiple`)
- Each appended item is `{ id, filePath, fileName, fileSize, kind, text?, truncated? }`
- Removal is per-row (`onItemsChange(items.filter(...))`)
- A "+ 添加更多文件" affordance re-opens the picker

**`src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`** (extend)

Add:

```ts
export interface MaterialUploadItem {
  id: string;
  filePath: string;
  fileName: string;
  fileSize: number | null;
  kind: typeof EnterpriseLeadExtractionSourceKind.File
      | typeof EnterpriseLeadExtractionSourceKind.Image;
  text?: string;
  truncated?: boolean;
}

export const MAX_MATERIAL_UPLOAD_BYTES = 50 * 1024 * 1024; // mirrors MAX_RICH_DOCUMENT_BYTES

export const ENTERPRISE_LEAD_MATERIAL_ACCEPT_EXTENSIONS: readonly string[];
export const ENTERPRISE_LEAD_MATERIAL_DIALOG_FILTERS: readonly { name: string; extensions: string[] }[];

export async function createWorkspaceFromUploadedMaterials(input: {
  workspaceName: string;
  items: MaterialUploadItem[];
  settings?: EnterpriseLeadWorkspaceSettings;
  onCreated: (workspaceId: string) => void;
  service?: UploadedMaterialWorkspaceService;
}): Promise<EnterpriseLeadWorkspace | null>;
```

Re-export `MAX_MATERIAL_UPLOAD_BYTES` from `documentTextExtractor.ts` if convenient, or import directly.

### 4.2 Modified files

**`src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx`**

- Replace `materialText/loadedFileName/loadedFileSize` state with `materials: MaterialUploadItem[]`
- In `renderMaterialStep`, swap the manual dropzone/file-input markup for
  `<WorkspaceMaterialUpload items={materials} onItemsChange={setMaterials} onError={setError} disabled={isBusy} />`
- Update `handleCreateFromMaterial` to call
  `createWorkspaceFromUploadedMaterials({ workspaceName: workspaceDisplayName, items: materials, ... })`
- Keep `createWorkspaceFromUploadedMaterial` (singular) as a thin compatibility wrapper that delegates to the new plural
  function with `items: [{ ... singleMaterialItem }]`

### 4.3 Constants and acceptance filter

Combined `accept` value:

```ts
const ACCEPTED_MATERIAL_FILE_TYPES = [
  ...EnterpriseLeadReadableDocumentAcceptTypes,
  ...EnterpriseLeadImageAttachmentExtensions.map(ext => `.${ext}`),
].join(',');
```

Electron dialog filters:

```ts
[
  { name: 'Documents', extensions: [...EnterpriseLeadReadableDocumentExtensions] },
  { name: 'Images', extensions: [...EnterpriseLeadImageAttachmentExtensions] },
  { name: 'All files', extensions: ['*'] },
]
```

Per-file validation (in `WorkspaceMaterialUpload`):

1. `extension` ∈
   `EnterpriseLeadReadableDocumentExtensions ∪ EnterpriseLeadImageAttachmentExtensions ∪ EnterpriseLeadAttachmentOnlyDocumentExtensions` (
   string values, lowercased). If not → reject + toast.
2. `fileSize ≤ MAX_MATERIAL_UPLOAD_BYTES` (from `documentTextExtractor.ts`). If not → reject + toast.
3. Dispatch by extension family:
  - `EnterpriseLeadReadableDocumentExtensions` (text + rich): call `dialogApi.readTextFile(path)` → set `text`,
    `kind = File`, surface `truncated`
  - `EnterpriseLeadImageAttachmentExtensions`: `kind = Image`, no text
  - `EnterpriseLeadAttachmentOnlyDocumentExtensions` (doc/ppt): `kind = File`, no text (parity with knowledge base —
    stored but not parsed)

### 4.4 Data flow

```
[User picks files]
   ↓
WorkspaceMaterialUpload validates each path
   ↓
onItemsChange(items) → WorkspaceCreate state
   ↓
[User clicks "Enter workspace"]
   ↓
createWorkspaceFromUploadedMaterials
   ↓
buildManualEnterpriseLeadWorkspaceDraft (existing)
   ↓
service.createWorkspace({ ..., extractionSources: items.map(toExtractionSource) })
   ↓
For each source with text:
  service.processDocumentSource(workspace.id, extractionSources, i).catch(warn)
   ↓
onCreated(workspace.id)
```

### 4.5 Error handling

| Scenario                                   | UI feedback                                                        |
|--------------------------------------------|--------------------------------------------------------------------|
| Single file >50 MB                         | Toast: `文件超过 50MB 上限：<filename>`                                   |
| Unsupported extension                      | Toast: `不支持的文件类型：.xxx`                                             |
| Single file `readTextFile` fails           | Skip that file, toast: `读取失败：<filename>`                           |
| All files rejected                         | Dropzone shows empty state hint                                    |
| Partial rejections                         | List shows accepted files; toast lists all rejections              |
| `createWorkspace` rejects                  | Toast: `创建失败` (existing i18n key)                                  |
| Per-source `processDocumentSource` rejects | `console.warn` only; UI does not block (matches existing behavior) |

### 4.6 UI

Compact list, matching the existing workspace table density:

```
┌──────────────────────────────────────────────────┐
│ 已选择 3 个文件                                    │
├──────────────────────────────────────────────────┤
│ 📄 产品手册.pdf                1.2 MB     ✕      │
│ 🖼️ 聊天截图.png                340 KB     ✕      │
│ 📊 客户名单.xlsx               87 KB      ✕      │
└──────────────────────────────────────────────────┘
[ + 添加更多文件 ]
```

Use existing Heroicons (`DocumentIcon`, `PhotoIcon`, `TableCellsIcon`, etc.) already imported in workspace components.

## 5. Test Plan

Vitest, colocated with source files. Existing pattern: `enterpriseLeadWorkspace.test.ts` mocks
`enterpriseLeadWorkspaceService`.

| File                                                 | Coverage                                                                                                                                          |
|------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|
| `enterpriseLeadWorkspaceUi.test.ts` (extend)         | `createWorkspaceFromUploadedMaterials`: empty list, single item, multiple items, mixed File + Image, `processDocumentSource` failure is swallowed |
| `WorkspaceMaterialUpload.test.tsx` (new)             | Renders list, add via mock selectFiles, add via mock input change, remove row, rejects oversize, rejects bad extension                            |
| `WorkspaceCreate.test.tsx` (new or extend if exists) | Integration: pick two files → submit → assert `service.createWorkspace` was called with two `extractionSources` and each had its expected `kind`  |

Mock fixtures:

- `window.electron.dialog.selectFiles` returns `{ success: true, paths: [...] }`
- `window.electron.dialog.readTextFile` returns `{ success: true, content: '...' }`
- `window.electron.dialog.statFile` returns `{ success: true, size: 1234 }`

## 6. Risk and Mitigation

- **Risk:** `WorkspaceCreate.tsx` grows even with extraction if the new component needs lots of inline sub-components.
  **Mitigation:** Cap extracted sub-component at ~250 lines; further sub-extraction is out of scope for this spec.

- **Risk:** Per-source `processDocumentSource` failure leaves workspace in a half-processed state.
  **Mitigation:** Existing behavior is "warn and continue". This spec preserves it. Surface a status badge later if user
  feedback warrants.

- **Risk:** Browser fallback path with multiple files uses `<input type="file" multiple>`, which has weaker extension
  filtering than Electron dialog.
  **Mitigation:** Explicit extension validation in `WorkspaceMaterialUpload` after read; matches Electron path.

- **Risk:** i18n keys for new strings are not yet defined.
  **Mitigation:** Add new keys under `enterpriseLeadCreateMaterial*` namespace in both `zh` and `en` dictionaries.

## 7. Out of Scope (explicit)

- OCR for images / scanned PDFs
- Pre-submit per-file preview
- Drag-and-drop reordering of selected files
- Changes to "Add document" in `WorkspaceKnowledgeBase.tsx`
- Changes to image-handling downstream (still attachment-only)
