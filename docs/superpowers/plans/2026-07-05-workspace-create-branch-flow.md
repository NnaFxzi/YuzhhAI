# Workspace Create Branch Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved lightweight workspace creation flow with three distinct follow-up screens for file material, pasted content, and blank creation.

**Architecture:** Keep the flow inside `WorkspaceCreate.tsx` and reuse the existing `extractDraft` and `createWorkspace` renderer service calls. Add small pure helpers to `enterpriseLeadWorkspaceUi.ts` for start-mode routing and blank/manual draft construction so the behavior is testable without rendering Electron UI.

**Tech Stack:** React, TypeScript, Tailwind, Vitest, existing `i18nService`, existing Enterprise Lead workspace IPC service.

---

### Task 1: Add Pure Creation Flow Helpers

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [x] Add a `WorkspaceCreateStartMode` constant with `Material`, `Paste`, and `Blank`.
- [x] Add `getWorkspaceCreateBranchScreen(mode)` to map a selected mode to a branch screen id.
- [x] Add `buildEmptyEnterpriseLeadWorkspaceProfile()`.
- [x] Add `buildManualEnterpriseLeadWorkspaceDraft(input)` for blank/manual creation.
- [x] Cover the mode routing and blank draft defaults in Vitest.

### Task 2: Replace WorkspaceCreate With the Approved Flow

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [x] Convert `WorkspaceCreate` into a two-step state machine: details step, then one of three branch screens.
- [x] Implement the material branch with file upload, supported type chips, and create action.
- [x] Implement the paste branch with a large text area, sample-fill action, and create action.
- [x] Implement the blank branch with a confirmation summary and create action.
- [x] Add zh/en i18n strings for all new visible text.
- [x] Preserve existing extraction behavior for material and paste flows, then override the workspace name and source metadata before creation.
- [x] Use a manual blank draft for blank creation.

### Task 3: Verify Focused Behavior

**Files:**
- Test: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Verify touched files with ESLint.

- [x] Run the targeted Vitest file for enterprise lead UI helpers.
- [x] Run ESLint on the changed TS/TSX files.
