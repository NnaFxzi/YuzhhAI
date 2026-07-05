# Workspace Start Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved post-creation start dashboard as the default workspace page while keeping existing agent
management available.

**Architecture:** Introduce a focused `WorkspaceStart` component for the first workspace screen. Keep
`WorkspaceWorkbench` as the agent-management surface and expose it through a separate internal navigation item. Add
small pure helpers in `enterpriseLeadWorkspaceUi.ts` so source/readiness status and action routing can be tested without
rendering.

**Tech Stack:** React, TypeScript, Tailwind, existing `i18nService`, Vitest.

---

### Task 1: Add Workspace Start Helpers

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [x] Add `EnterpriseLeadWorkspaceStartSourceState` with `Material`, `Paste`, and `Blank`.
- [x] Add `EnterpriseLeadWorkspaceStartAction` with `AddMaterial`, `ReviewProfile`, and `StartWorkflow`.
- [x] Add `getWorkspaceStartSourceState(workspace)` based on `workspace.source.kind`.
- [x] Add `getWorkspaceStartReadiness(workspace)` for material/profile/rules/settings readiness rows.
- [x] Add `getWorkspaceStartActionTarget(action, sourceState)` to route primary actions to internal pages.
- [x] Add Vitest coverage for material, paste, and blank workspaces.

### Task 2: Add Start Dashboard UI

**Files:**

- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceStart.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [x] Build a light workspace start page matching the approved HTML prototype style.
- [x] Show workspace source state, workspace title, contextual subtitle, next action cards, readiness list, and current
  material summary.
- [x] Route card clicks through callbacks provided by `EnterpriseLeadWorkspaceView`.
- [x] Add zh/en strings for every visible label.

### Task 3: Wire Navigation

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceShell.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/index.ts`
- Modify: `src/renderer/services/i18n.ts`

- [x] Keep `Workbench` as the default workspace page and render `WorkspaceStart` for it.
- [x] Add `AgentManagement` as a separate internal page that renders the existing `WorkspaceWorkbench`.
- [x] Add a sidebar icon and label for agent management.
- [x] Keep settings, knowledge base, chat, search, and creation records behavior unchanged.

### Task 4: Verify

**Files:**

- Test: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Verify touched TS/TSX files with ESLint.

- [x] Run the targeted Vitest file for enterprise lead UI helpers.
- [x] Run ESLint on changed TS/TSX files.
- [x] Run `npm run build`.
