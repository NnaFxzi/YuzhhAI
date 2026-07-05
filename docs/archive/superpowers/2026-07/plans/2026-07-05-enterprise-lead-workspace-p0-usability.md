# Enterprise Lead Workspace P0 Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the lead workspace workbench usable as a real task surface by exposing task execution with the right side
panel and by making dynamic Agent names consistent across pages.

**Architecture:** Reuse the existing `AgentWorkspaceConsole` and `WorkspaceSidePanel` instead of creating a new
execution UI. Centralize workspace Agent label resolution in `enterpriseLeadWorkspaceUi.ts`, then consume it from AI
chat, task views, and future workbench surfaces.

**Tech Stack:** React, Redux Toolkit, TypeScript, Vitest, Electron IPC wrappers.

---

### Task 1: Shared Workspace Agent Label Resolution

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx`

- [ ] Add a failing Vitest case proving a workspace Agent without an override name displays the global Agent name
  instead of its raw id.
- [ ] Add `getWorkspaceAgentDisplayName()` or reuse `getEffectiveWorkspaceAgent()` as the shared resolver for
  `override name -> global name -> agentId`.
- [ ] Load global Agents in `WorkspaceAiChat` the same way `WorkspaceWorkbench` does, then use the shared resolver for
  the target Agent dropdown.
- [ ] Run `npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`.

### Task 2: Workbench Task Execution Entry

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Modify: `src/renderer/services/i18n.ts`

- [ ] Add a failing render test proving the workbench exposes the execution console entry text and the existing
  start-task control.
- [ ] Render `AgentWorkspaceConsole` inside the workbench behind a local segmented control with `任务执行` and
  `Agent 管理`.
- [ ] Keep Agent management as an adjacent mode, preserving create/add/edit/remove flows.
- [ ] Add Chinese and English i18n strings for the workbench mode labels.
- [ ] Run the targeted renderer tests.

### Task 3: Verification

**Files:**

- Verify touched TypeScript and TSX files.

- [ ] Run targeted Vitest coverage for enterprise lead workspace UI.
- [ ] Run ESLint on touched TS/TSX files.
- [ ] Run type checking or Electron compile if UI type changes cross renderer boundaries.
- [ ] Re-open the local Electron UI and confirm: workbench default execution surface is reachable, Agent management
  still shows `LobsterAI`, and AI chat target uses `LobsterAI`.
