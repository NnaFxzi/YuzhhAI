# Knowledge Document List Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify the knowledge document list to a single top toolbar with an upload action, remove document search, and keep trash navigation as a low-emphasis footer action.

**Architecture:** Keep the existing document state, visibility switching, status popovers, extraction actions, and deletion flows unchanged. Narrow the panel view API by removing the now-unused query state and render a compact header with the file count and upload button; retain the existing footer trash toggle and import result feedback.

**Tech Stack:** React, TypeScript, Tailwind utility classes, Vitest, ESLint, Vite/Electron.

## Global Constraints

- Do not change document ingestion, local-index, AI extraction, detail-panel, restore, or delete behavior.
- Do not add a replacement search or status filter.
- Keep all user-visible strings in `src/renderer/services/i18n.ts` with both Chinese and English translations.
- Preserve the existing compact row status controls and clickable status detail popovers.
- Do not commit changes until the user has tested the UI.

---

### Task 1: Update renderer tests for the simplified toolbar

**Files:**
- Modify: `/Users/lijiahao/yuzhh-ai-assistant/src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts`

**Interfaces:**
- Consumes: `WorkspaceKnowledgeDocumentsPanelView` and the existing `renderView` helper.
- Produces: Assertions that describe the final toolbar contract: upload remains, search is absent, the document count remains, and trash remains at the bottom.

- [ ] **Step 1: Replace the search-oriented header assertions with failure cases for the new design**

Update the existing header test to assert:

```ts
test('renders a compact document list header and bottom trash entry', () => {
  const html = renderView(createState({ documents: [createDocument()] }));

  expect(html).toContain(i18nService.t('enterpriseKnowledgeFileListTitle'));
  expect(html).toContain('data-document-count="1"');
  expect(html).toContain('data-testid="knowledge-upload"');
  expect(html).toContain('data-testid="knowledge-trash-entry"');
  expect(html).not.toContain('data-testid="knowledge-search-toggle"');
  expect(html).not.toContain('data-testid="knowledge-search-input"');
  expect(html).not.toContain(i18nService.t('enterpriseKnowledgeActiveDocuments'));
});
```

Remove the test that expects a search input for lists with eight documents. Add an assertion that a larger list also has no search control:

```ts
test('keeps the toolbar search-free for larger document lists', () => {
  const html = renderView(
    createState({
      documents: Array.from({ length: 8 }, (_, index) =>
        createDocument({ id: `document-${index}` }),
      ),
    }),
  );

  expect(html).toContain('data-testid="knowledge-upload"');
  expect(html).not.toContain('data-testid="knowledge-search-toggle"');
  expect(html).not.toContain('data-testid="knowledge-search-input"');
});
```

- [ ] **Step 2: Remove query plumbing from the test render helper**

Delete the `query: ''` and `onQueryChange: vi.fn()` props from `renderView`. This makes the test compile only after the component API is simplified.

- [ ] **Step 3: Run the focused test and verify it fails for the expected missing search removal**

Run:

```bash
npx vitest run src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts
```

Expected: FAIL because the current component still renders search controls and still requires the query props.

---

### Task 2: Remove search from the knowledge document panel

**Files:**
- Modify: `/Users/lijiahao/yuzhh-ai-assistant/src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx`

**Interfaces:**
- Consumes: Existing document visibility and state APIs.
- Produces: `WorkspaceKnowledgeDocumentsPanelViewProps` without `query` or `onQueryChange`; the panel still exposes upload, visibility, document actions, and detail/extraction callbacks.

- [ ] **Step 1: Remove search-only imports, props, state, and filter computation**

Make these exact changes:

```ts
// Remove MagnifyingGlassIcon from the Heroicons import.
// Remove filterKnowledgeDocuments from the knowledgeDocumentPresentation import.
```

Remove these props from `WorkspaceKnowledgeDocumentsPanelViewProps` and the destructuring list:

```ts
query: string;
onQueryChange: (query: string) => void;
```

Replace the current source/rows/search setup with:

```ts
const sourceRows =
  visibility === KnowledgeDocumentVisibilities.Active ? state.documents : state.deletedDocuments;
const rows = sourceRows;
```

Remove `showSearch` and `searchOpen` state.

- [ ] **Step 2: Replace the header controls with the final compact toolbar**

Keep the existing list title and count badge, and replace the right side of the header with only the upload button:

```tsx
<div className="flex min-w-0 items-center gap-2">
  <button
    type="button"
    data-testid="knowledge-upload"
    disabled={state.isMutating}
    className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
    onClick={onUpload}
  >
    <ArrowUpTrayIcon className="h-4 w-4" />
    {i18nService.t('enterpriseKnowledgeUploadFiles')}
  </button>
</div>
```

The resulting header must not render search icons, search inputs, or the old current-document segmented control.

- [ ] **Step 3: Remove query state and callbacks from the container**

Delete:

```ts
const [query, setQuery] = useState('');
```

Remove `setQuery('')` from the workspace reset effect, and remove `query={query}` and `onQueryChange={setQuery}` from the `WorkspaceKnowledgeDocumentsPanelView` call.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
npx vitest run src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts
```

Expected: the focused panel test file passes, including the unchanged status-popover and extraction behavior tests.

---

### Task 3: Remove obsolete search translations and validate the renderer

**Files:**
- Modify: `/Users/lijiahao/yuzhh-ai-assistant/src/renderer/services/i18n.ts`

**Interfaces:**
- Consumes: Existing translation keys used by the document panel.
- Produces: No user-visible search copy in the document panel; other shared translation keys remain untouched unless no renderer consumer remains.

- [ ] **Step 1: Remove the document-panel-only search placeholder translations**

Remove the Chinese and English entries for `enterpriseKnowledgeSearchPlaceholder` only after confirming there are no remaining consumers:

```bash
rg -n "enterpriseKnowledgeSearchPlaceholder" src/renderer
```

If the search key has no remaining consumer, remove it from both language dictionaries. Leave status filter translation keys alone if they are still referenced elsewhere or retained for compatibility.

- [ ] **Step 2: Run focused related tests**

Run:

```bash
npx vitest run \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeExtractionStatus.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts
```

Expected: all related tests pass.

- [ ] **Step 3: Run lint for all touched TypeScript files**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts \
  src/renderer/services/i18n.ts
```

Expected: exit code 0 with no warnings or errors.

- [ ] **Step 4: Build the renderer bundle**

Run:

```bash
npx vite build
```

Expected: renderer, Electron main/preload, and knowledge-index worker bundles complete successfully.

- [ ] **Step 5: Manually verify the live Electron screen**

Open the knowledge base screen and verify:

1. The header shows only `文件列表` with its count on the left and `上传文件` on the right.
2. No search icon, search input, or current-document segmented tab appears.
3. File rows still show clickable parsing/local-index/AI status controls.
4. AI extraction action and loading state remain available where applicable.
5. The footer shows the low-emphasis `回收站` entry on the left and the trash view can return to `文件列表`.
6. The upload button still opens the existing file picker flow.

Do not commit; leave the changes available for the user to test.
