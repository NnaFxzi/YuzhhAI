# 资料文档列表栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 重做资料文档列表栏，让上传位于顶部、列表标题和数量更清晰、搜索按需展开、回收站固定在左下角。

**Architecture:** 在现有 `WorkspaceKnowledgeDocumentsPanelView` 内管理搜索展开状态和当前视图标题，继续使用现有 `query` / `onQueryChange` 过滤逻辑。回收站仍然通过 `onVisibilityChange` 切换，只改变入口位置，不改变数据源和文档业务动作。

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest, i18n service。

## Global Constraints

- 不修改文档导入、解析、本地索引、AI 提取或 IPC 逻辑。
- 不修改外层知识库页面和 AI 知识视图。
- 不增加状态筛选、排序或批量操作。
- 触及的 TypeScript/TSX 文件必须通过 CI 同等规则的 ESLint 检查。
- 所有新增用户可见文案必须同时提供 `zh` 和 `en` 翻译。
- 不创建提交，等待用户完成调试验证后再决定是否提交。

---

### Task 1: 锁定列表栏视觉契约

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts`

**Interfaces:**
- Consumes: `WorkspaceKnowledgeDocumentsPanelView` 静态渲染入口和已有文档测试工厂。
- Produces: 列表标题、数量、搜索按需显示、回收站底部入口的测试约束。

- [ ] **Step 1: Add failing source-contract tests**

新增断言：

```ts
test('renders a compact document list header and bottom trash entry', () => {
  const html = renderView(createState({ documents: [createDocument()] }));

  expect(html).toContain(i18nService.t('enterpriseKnowledgeFileListTitle'));
  expect(html).toContain('data-document-count="1"');
  expect(html).toContain('data-testid="knowledge-search-toggle"');
  expect(html).toContain('data-testid="knowledge-trash-entry"');
  expect(html).not.toContain(i18nService.t('enterpriseKnowledgeActiveDocuments'));
});

test('shows the search field directly for larger document lists', () => {
  const html = renderView(
    createState({
      documents: Array.from({ length: 8 }, (_, index) =>
        createDocument({ id: `document-${index}` }),
      ),
    }),
  );

  expect(html).toContain('data-testid="knowledge-search-input"');
  expect(html).not.toContain('data-testid="knowledge-search-toggle"');
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

```bash
npm test -- --run src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts
```

Expected: FAIL because the current view still renders the current/trash segmented control and has no list-header data attributes.

### Task 2: Implement the list header and footer navigation

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx`
- Modify: `src/renderer/services/i18n.ts`

**Interfaces:**
- Consumes: Existing `visibility`, `query`, `onQueryChange`, `onVisibilityChange`, and upload callback.
- Produces: A compact list header with `data-document-count`, `data-testid="knowledge-search-toggle"`, `data-testid="knowledge-search-input"`, and `data-testid="knowledge-trash-entry"`.

- [ ] **Step 1: Add bilingual translations**

Add these keys to both language dictionaries:

```ts
enterpriseKnowledgeFileListTitle: '文件列表',
enterpriseKnowledgeFileCount: '共 {count} 个文件',
```

Use the equivalent English values in the English dictionary.

- [ ] **Step 2: Add search expansion state**

Inside `WorkspaceKnowledgeDocumentsPanelView`, add:

```ts
const [searchOpen, setSearchOpen] = useState(false);
const searchVisible = showSearch || searchOpen;
```

Keep `showSearch = sourceRows.length >= 8 || query.trim().length > 0` so a query always keeps its input visible.

- [ ] **Step 3: Replace the top segmented control**

Render a single top row with:

```tsx
<div className="flex flex-wrap items-center justify-between gap-3">
  <div className="flex min-w-0 items-center gap-2">
    <h2>{visibility === KnowledgeDocumentVisibilities.Active ? fileListTitle : trashTitle}</h2>
    <span data-document-count={sourceRows.length}>{sourceRows.length}</span>
  </div>
  <div className="flex items-center gap-2">
    {searchVisible ? <input data-testid="knowledge-search-input" /> : <button data-testid="knowledge-search-toggle" />}
    {/* existing upload button */}
  </div>
</div>
```

The search icon opens the input and the compact close control clears the query and collapses it when it was manually opened. Keep existing i18n placeholders and callbacks.

- [ ] **Step 4: Move trash navigation to the bottom**

After the scrollable document content, add a shrink-to-content footer:

```tsx
<footer className="shrink-0 border-t border-border px-5 py-2.5">
  <button data-testid="knowledge-trash-entry" onClick={() => onVisibilityChange(KnowledgeDocumentVisibilities.Deleted)}>
    <TrashIcon />
    {i18nService.t('enterpriseKnowledgeDeletedDocuments')} ({state.deletedDocuments.length})
  </button>
</footer>
```

Use a muted visual style, with an active style while viewing the trash. Do not change the document source rows or restore action.

- [ ] **Step 5: Run focused tests and lint**

```bash
npm test -- --run src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts \
  src/renderer/services/i18n.ts
```

Expected: all focused tests pass and ESLint reports no errors or warnings.

### Task 3: Verify the renderer and live debug session

**Files:**
- No additional source files.

**Interfaces:**
- Consumes: Tasks 1–2’s list-header and footer navigation behavior.
- Produces: A verified renderer build and a running Electron debug window from `/Users/lijiahao/yuzhh-ai-assistant`.

- [ ] **Step 1: Run related tests**

```bash
npm test -- --run \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeExtractionStatus.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts
```

- [ ] **Step 2: Build the renderer**

```bash
npx vite build
```

- [ ] **Step 3: Confirm the existing Electron debug session receives the HMR update**

Check the running session output for a Vite HMR update and the renderer initialization log. If a full restart is needed, keep the Electron native dependencies intact and use:

```bash
npx concurrently "vite --force --port 5175" "wait-on -v -t 120000 -d 20000 http://localhost:5175 dist-electron/.electron-ready dist-electron/knowledge-index-worker.js && npm run start:electron"
```
