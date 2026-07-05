# Workspace Exit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an obvious way to leave the current enterprise lead workspace and return to the workspace entry/list without deleting data.

**Architecture:** Reuse the existing screen state in `EnterpriseLeadWorkspaceView` by adding a small exit handler that clears the active workspace and returns to the entry screen. Surface that handler in `WorkspaceShell` as a persistent sidebar action, and in the collapsed title bar as a compact back button.

**Tech Stack:** React, TypeScript, Tailwind, Heroicons, Vitest static render tests, existing `i18nService`.

---

### Task 1: Add Regression Tests

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [ ] **Step 1: Add a failing static-render test for the workspace shell exit action**

Add this assertion near the existing `renders workspace shell as an in-space action sidebar` test:

```ts
  test('renders a persistent exit action in the workspace shell sidebar', () => {
    const workspace = createWorkspace('sidebar');

    const markup = renderEnterpriseLeadComponent(
      React.createElement(
        WorkspaceShell,
        {
          workspace,
          activePage: 'workbench',
          onPageChange: vi.fn(),
          onExitWorkspace: vi.fn(),
          children: React.createElement('div', null, 'Active page body'),
        },
      ),
    );

    expect(markup).toContain('返回空间列表');
    expect(markup).toContain('aria-label="返回空间列表"');
    expect(markup).toContain('shrink-0 border-t border-border pt-3');
  });
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run: `npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

Expected: FAIL because `WorkspaceShellProps` does not yet accept `onExitWorkspace` and the rendered markup does not contain the exit action.

### Task 2: Implement Workspace Sidebar Exit

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceShell.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Add localized labels**

Add `enterpriseLeadWorkspaceExitToList` to both `zh` and `en` dictionaries:

```ts
enterpriseLeadWorkspaceExitToList: '返回空间列表',
enterpriseLeadWorkspaceExitToList: 'Back to workspace list',
```

- [ ] **Step 2: Add an optional exit callback to the shell**

Update `WorkspaceShellProps`:

```ts
  onExitWorkspace?: () => void;
```

Render a bottom sidebar button after the record list/spacer:

```tsx
{onExitWorkspace && (
  <div className="shrink-0 border-t border-border pt-3">
    <button
      type="button"
      onClick={onExitWorkspace}
      className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
      aria-label={i18nService.t('enterpriseLeadWorkspaceExitToList')}
    >
      <ArrowLeftIcon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 truncate">
        {i18nService.t('enterpriseLeadWorkspaceExitToList')}
      </span>
    </button>
  </div>
)}
```

- [ ] **Step 3: Wire `EnterpriseLeadWorkspaceView` to return to entry**

Add:

```ts
const handleExitWorkspace = (): void => {
  navigationRevisionRef.current += 1;
  setActiveWorkspace(null);
  setActiveWorkspaceId(null);
  setWorkspaceError('');
  setSelectedCreationRecordId(null);
  setSidebarRunSummaries([]);
  setActiveInternalPage(getDefaultWorkspaceInternalPage());
  setScreen(EnterpriseLeadWorkspaceScreen.Entry);
};
```

Pass it to `WorkspaceShell` as `onExitWorkspace={handleExitWorkspace}`.

- [ ] **Step 4: Run targeted tests and verify they pass**

Run: `npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

Expected: PASS for the workspace UI suite.

### Task 3: Add Collapsed Header Back Button

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [ ] **Step 1: Add a static-render test for the collapsed title bar route**

Render `EnterpriseLeadWorkspaceView` with the workspace service mocked to return one workspace, then assert the collapsed workspace header includes a back control label after the workspace loads. If this is too brittle for the current static-render pattern, rely on the sidebar test plus ESLint for the title bar change.

- [ ] **Step 2: Add the compact header button**

In the collapsed header title row, render an icon button before the workspace title when `screen === EnterpriseLeadWorkspaceScreen.Workspace`:

```tsx
{screen === EnterpriseLeadWorkspaceScreen.Workspace && (
  <button
    type="button"
    onClick={handleExitWorkspace}
    className="non-draggable inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
    aria-label={i18nService.t('enterpriseLeadWorkspaceExitToList')}
  >
    <ArrowLeftIcon className="h-4 w-4" />
  </button>
)}
```

- [ ] **Step 3: Run targeted tests**

Run: `npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

Expected: PASS.

### Task 4: Lint and Review

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceShell.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Run changed-file lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/WorkspaceShell.tsx src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/services/i18n.ts
```

Expected: 0 errors and 0 warnings.

- [ ] **Step 2: Review the diff**

Run: `git diff -- src/renderer/components/enterpriseLeadWorkspace/WorkspaceShell.tsx src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/services/i18n.ts`

Expected: only scoped UI, i18n, and test changes.

- [ ] **Step 3: Do not commit**

This repository instructs agents not to create commits until the user has tested and confirmed.
