# 资料文档轻量列表工具栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 精简资料文档面板工具栏，移除状态筛选并保留上传、名称搜索、回收站和现有文档状态交互。

**Architecture:** 在现有 `WorkspaceKnowledgeDocumentsPanel` 内收敛工具栏状态，只由视图切换和名称查询决定列表内容。状态图标弹窗、文档行操作和上传流程保持原有边界；通过静态渲染测试锁定工具栏契约。

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest, ESLint。

## Global Constraints

- 不修改知识库 IPC、SQLite、文档导入、解析、索引或 AI 提取服务。
- 不修改外层知识库页面的指标卡片和主视图切换。
- 触及的 TypeScript/TSX 文件必须通过 CI 同等规则的 ESLint 检查。
- 不硬编码新的用户可见文案；本次布局复用现有 i18n key。
- 不创建提交，等待用户完成调试验证后再决定是否提交。

---

### Task 1: 锁定轻量工具栏行为

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts`

**Interfaces:**
- Consumes: `WorkspaceKnowledgeDocumentsPanelView` 的静态渲染入口和已有 `createState` / `createDocument` 测试工厂。
- Produces: 对上传按钮、状态筛选移除和搜索显示阈值的可执行测试约束。

- [ ] **Step 1: 更新测试渲染参数**

从测试中的 `renderView` 调用移除 `statusFilter` 和 `onStatusFilterChange`，使测试契约与精简后的视图 props 一致。

- [ ] **Step 2: 添加失败测试**

新增以下断言：

```ts
test('keeps upload as the primary document action without a status filter', () => {
  const html = renderView(createState({ documents: [createDocument()] }));

  expect(html).toContain('data-testid="knowledge-upload"');
  expect(html).not.toContain('<select');
  expect(html).not.toContain(i18nService.t('enterpriseKnowledgeStatusFilter'));
});

test('shows name search only when the document list needs it', () => {
  const singleDocumentHtml = renderView(createState({ documents: [createDocument()] }));
  const manyDocumentsHtml = renderView(
    createState({
      documents: Array.from({ length: 8 }, (_, index) =>
        createDocument({ id: `document-${index}` }),
      ),
    }),
  );

  expect(singleDocumentHtml).not.toContain('type="search"');
  expect(manyDocumentsHtml).toContain('type="search"');
});
```

- [ ] **Step 3: Run the focused test and confirm it fails**

Run:

```bash
npm test -- --run src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts
```

Expected: FAIL because the current component still renders the status `<select>` and always renders the name search.

### Task 2: Implement the compact toolbar

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx`

**Interfaces:**
- Consumes: Existing `visibility`, `query`, upload callback, status popover components, and document list filtering helper.
- Produces: `WorkspaceKnowledgeDocumentsPanelView` without a status-filter prop and with a compact, conditional-search toolbar.

- [ ] **Step 1: Remove status-filter-only code**

Remove `KnowledgeDocumentStatusFilter` from the component import, remove `documentStatusOptions`, remove `statusFilter` and `onStatusFilterChange` from the view props and destructuring, and call `filterKnowledgeDocuments(sourceRows, query, 'all')`.

- [ ] **Step 2: Replace the duplicated panel header with a compact toolbar**

Keep the outer panel section and replace the local title/subtitle header content with:

```tsx
<header className="shrink-0 border-b border-border px-5 py-3">
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
      {/* existing active-document and trash buttons */}
    </div>
    <button>{/* existing upload action */}</button>
  </div>
  {showSearch ? (
    <label>{/* existing name search input */}</label>
  ) : null}
</header>
```

Set `showSearch` to `sourceRows.length >= 8 || query.trim().length > 0`. Keep the current upload callback, disabled state, icon, and i18n label unchanged. Keep the active/trash counts and callbacks unchanged, but use the compact single-row treatment.

- [ ] **Step 3: Remove parent plumbing for status filter**

Remove the panel’s `statusFilter` state, workspace-reset assignment, visibility-change reset, and `WorkspaceKnowledgeDocumentsPanelView` props. Do not change the independent AI knowledge status filters in `WorkspaceKnowledgeBase`.

- [ ] **Step 4: Run focused tests and lint**

Run:

```bash
npm test -- --run src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts
```

Expected: all focused tests pass and ESLint reports no errors or warnings.

### Task 3: Verify the renderer change and restart debug

**Files:**
- No additional source files.

**Interfaces:**
- Consumes: Tasks 1–2’s compact toolbar and existing portal status popovers.
- Produces: A buildable renderer and a running Electron debug session from `/Users/lijiahao/yuzhh-ai-assistant`.

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

- [ ] **Step 3: Restart the correct-root debug session with dependency re-optimization**

```bash
npx concurrently "vite --force --port 5175" "wait-on -v -t 120000 -d 20000 http://localhost:5175 dist-electron/.electron-ready dist-electron/knowledge-index-worker.js && npm run start:electron"
```

Confirm the Electron window loads from the current workspace and the document panel no longer shows the status filter.
