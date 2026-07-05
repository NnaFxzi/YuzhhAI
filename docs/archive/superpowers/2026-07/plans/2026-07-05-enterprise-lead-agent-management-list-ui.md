# Enterprise Lead Agent Management List UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the workbench Agent card grid with a compact list-style Agent configuration center based on the
approved HTML prototype.

**Architecture:** Keep `WorkspaceWorkbench` as the page owner and preserve the existing workspace-scoped Agent
save/update flow. Change only the presentation layer: add a top configuration status strip, render Agents as rows, move
low-frequency actions into a per-row menu, and split the edit dialog into Basic Info, Execution Settings, and
Capabilities sections.

**Tech Stack:** React, TypeScript, Tailwind, Vitest static render tests, existing `enterpriseLeadWorkspaceService` APIs.

---

### Task 1: Lock The New Layout With Tests

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [ ] **Step 1: Add failing assertions for list layout**

Update the workbench render tests so they expect:

- A `role="table"` Agent list.
- Column labels for Agent, responsibility, model/skills, status, and actions.
- The old card-grid-only action buttons are not all visible at row level.

- [ ] **Step 2: Add failing assertions for low-frequency menu**

Render `WorkspaceAgentActionsMenu` directly and assert it includes enable/disable, move up, move down, and remove
actions, while the row markup keeps `编辑` as the primary visible action.

- [ ] **Step 3: Add failing assertions for edit dialog sections**

Update the edit dialog test to assert the section labels `基本信息`, `执行设定`, and `能力配置`.

- [ ] **Step 4: Run focused test file and confirm it fails**

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: tests fail because the React workbench still renders cards and the menu component/section labels do not exist
yet.

### Task 2: Implement The List UI

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Add i18n keys**

Add Chinese and English keys for the new title, subtitle, table columns, status strip, menu, and dialog section labels.

- [ ] **Step 2: Replace Agent card rendering with rows**

Introduce a list/table structure using semantic `role="table"`, `role="row"`, `role="columnheader"`, and `role="cell"`.
Preserve existing enable, move, remove, and edit callbacks.

- [ ] **Step 3: Add per-row action menu**

Track the open menu by Agent id. Keep `编辑` visible. Put enable/disable, move up, move down, and remove into the row
menu.

- [ ] **Step 4: Add status strip**

Move the four configuration states above the list as compact chips: model, skills, research, and platforms.

- [ ] **Step 5: Split the edit dialog into sections**

Group the existing fields into Basic Info, Execution Settings, and Capabilities. Keep the same save behavior and field
bindings.

### Task 3: Verify And Inspect

**Files:**

- Test: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Test: `src/main/enterpriseLeadWorkspace/service.test.ts`
- Test: `src/shared/enterpriseLeadWorkspace/validation.test.ts`

- [ ] **Step 1: Run focused tests**

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/main/enterpriseLeadWorkspace/service.test.ts src/shared/enterpriseLeadWorkspace/validation.test.ts
```

- [ ] **Step 2: Run changed-file lint**

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/services/i18n.ts
```

- [ ] **Step 3: Run type and build checks**

```bash
npx tsc --noEmit --pretty false
git diff --check
npm run build
```

- [ ] **Step 4: Manually inspect the UI**

Open the local Electron app, enter an existing workspace, and verify:

- Workbench uses list-style Agent rows.
- Only `编辑` is visible per row.
- The more menu opens and contains low-frequency actions.
- The edit dialog has the three sections from the prototype.
