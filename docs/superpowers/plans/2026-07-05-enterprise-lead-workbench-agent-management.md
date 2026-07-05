# Enterprise Lead Workbench Agent Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the workspace workbench focus on configuring the current workspace's Agents, with task execution results moved out of the workbench homepage.

**Architecture:** Keep the existing workspace shell and page routing. Refactor `WorkspaceWorkbench` so it renders Agent management directly instead of a nested execution/Agent tab switch, and replace inline Agent editing with a modal dialog that saves the same workspace-scoped Agent data.

**Tech Stack:** React, TypeScript, Tailwind, Vitest, existing `enterpriseLeadWorkspaceService` IPC wrapper.

---

### Task 1: Lock The New Workbench Contract With Tests

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [ ] **Step 1: Add tests for the new workbench shape**

Add coverage that renders `WorkspaceWorkbench` and asserts:
- The workbench shows `工作区 Agent 管理` by default.
- The nested `任务执行 / Agent 管理` switch is not rendered.
- Clicking an Agent's edit button opens a modal-style editor.
- The old inline editor does not appear as a regular section under the card grid.

- [ ] **Step 2: Run the focused test file and confirm the new assertions fail before implementation**

Run:

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected before implementation: the new tests fail because the nested switch and inline editor still exist.

### Task 2: Refactor Workbench To Agent Management First

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Remove the nested workbench mode state**

Remove `activeMode`, `setActiveMode`, the segmented `任务执行 / Agent 管理` control, and the default rendering of `AgentWorkspaceConsole`.

- [ ] **Step 2: Render Agent management as the workbench body**

Keep the current Agent management header, Agent count, creation panel, Agent cards, and settings summary. The page should open directly on Agent management.

- [ ] **Step 3: Keep task execution out of the workbench homepage**

Do not render execution cards, right-side task artifacts, single-Agent execution chat, or run details in `WorkspaceWorkbench`. Task execution results remain accessible from Creation Records.

### Task 3: Move Agent Editing Into A Modal

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Replace inline override editor with a dialog overlay**

Use the existing `editingAgentId` and `overrideDraft` state. When an Agent is selected, render a fixed overlay with a centered modal panel. The modal contains the same fields and save/cancel behavior.

- [ ] **Step 2: Make cancellation predictable**

Clicking cancel closes the modal and resets draft state through the existing `editingBinding` effect. Saving persists through `saveWorkspaceAgents` and closes the modal on success.

- [ ] **Step 3: Keep keyboard and screen-reader basics**

Set `role="dialog"`, `aria-modal="true"`, and a labelled title. The close button must have an accessible label.

### Task 4: Verify

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
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/services/i18n.ts
```

- [ ] **Step 3: Run type and build checks**

```bash
npx tsc --noEmit --pretty false
git diff --check
npm run build
```
