# Workbench Command Center Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the workbench home content feel intentionally aligned and visually cohesive inside the full-screen dark
workspace.

**Architecture:** Keep the existing home view and workflow selection behavior. Adjust `CoworkView` spacing/alignment so
title, templates, and prompt input share one stable left edge and width system. Adjust `WorkbenchWorkflowGrid` from
large saturated blocks into compact, low-noise template entries.

**Tech Stack:** React, TypeScript, Tailwind, Vitest with `react-dom/server` for lightweight rendering checks.

---

### Task 1: Aligned Command Center Layout

**Files:**

- Modify: `src/renderer/components/cowork/CoworkView.tsx`
- Modify: `src/renderer/components/workbench/WorkbenchWorkflowGrid.tsx`
- Test: `src/renderer/components/workbench/WorkbenchWorkflowGrid.test.ts`

- [ ] **Step 1: Add a focused rendering test**

Add a Vitest test that renders `WorkbenchWorkflowGrid` with sample quick actions and asserts the component uses the
compact aligned layout marker.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- WorkbenchWorkflowGrid`

Expected: fail because the new aligned layout marker is not present yet.

- [ ] **Step 3: Update `WorkbenchWorkflowGrid`**

Change the section to expose `data-layout="aligned-template-list"`, reduce card height, lower background saturation, use
smaller icons, and keep color as accent rather than full card fill.

- [ ] **Step 4: Update `CoworkView` home layout**

Keep the left-aligned command center, reduce hero scale, align prompt input with the same content width, and move the
prompt input above the workflow grid so the main action comes first.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- WorkbenchWorkflowGrid
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/cowork/CoworkView.tsx src/renderer/components/workbench/WorkbenchWorkflowGrid.tsx src/renderer/components/workbench/WorkbenchWorkflowGrid.test.ts
```

Expected: tests and lint pass.

Do not commit. Repository instructions require waiting for user testing and confirmation before committing.

