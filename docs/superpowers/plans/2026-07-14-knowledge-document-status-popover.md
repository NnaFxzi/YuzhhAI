# Knowledge Document Status Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make document parsing, local-index, and AI-extraction status panels reliably clickable and visible above the document list without clipping.

**Architecture:** Keep the compact document row and its existing status model unchanged. Extract the status detail surface into a portal-backed popover that positions itself from the trigger button and owns outside-click/Escape behavior. The row remains responsible only for status presentation and actions.

**Tech Stack:** React, TypeScript, ReactDOM `createPortal`, Tailwind utility classes, Vitest.

## Global Constraints

- Keep the change scoped to `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx` and its tests.
- Do not change knowledge-base IPC, persistence, polling, or extraction authorization behavior.
- Preserve both Chinese and English existing translations; do not add hardcoded user-visible strings.
- Use 2-space indentation, single quotes, semicolons, and existing Tailwind patterns.
- Do not create a commit until the user has tested and confirmed the UI.

---

### Task 1: Add the portal positioning contract and regression coverage

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx`

**Interfaces:**
- Produce `KnowledgeDocumentStatusPopover` behavior that exposes a `data-status-popover-portal` marker when open.
- Produce a positioning helper with deterministic viewport-boundary calculations that can be unit tested without a browser layout engine.

- [ ] **Step 1: Write the failing tests**

Add tests for a popover opened near the bottom of the viewport selecting an above-trigger placement, and for the rendered status surface identifying itself as portal content. Keep the existing closed-popover assertions unchanged.

```ts
test('places an open status popover above a trigger near the viewport bottom', () => {
  expect(
    getKnowledgeDocumentStatusPopoverPlacement(
      { top: 740, bottom: 772, left: 1180, right: 1212, width: 32, height: 32 },
      { width: 320, height: 240 },
      { width: 1280, height: 800 },
    ),
  ).toEqual({ placement: 'above', top: 492, left: 892 });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- --run src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts
```

Expected: FAIL because the positioning helper and portal marker do not exist yet.

- [ ] **Step 3: Implement the minimal positioning contract**

Add a pure helper near the popover component:

```ts
export interface KnowledgeDocumentStatusPopoverRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface KnowledgeDocumentStatusPopoverSize {
  width: number;
  height: number;
}

export interface KnowledgeDocumentStatusPopoverViewport {
  width: number;
  height: number;
}

export const getKnowledgeDocumentStatusPopoverPlacement = (
  trigger: KnowledgeDocumentStatusPopoverRect,
  popover: KnowledgeDocumentStatusPopoverSize,
  viewport: KnowledgeDocumentStatusPopoverViewport,
): { placement: 'above' | 'below'; top: number; left: number } => {
  const gap = 8;
  const margin = 12;
  const fitsBelow = trigger.bottom + gap + popover.height <= viewport.height - margin;
  const placement = fitsBelow ? 'below' : 'above';
  const rawTop = fitsBelow ? trigger.bottom + gap : trigger.top - gap - popover.height;
  const rawLeft = trigger.right - popover.width;
  return {
    placement,
    top: Math.max(margin, Math.min(rawTop, viewport.height - popover.height - margin)),
    left: Math.max(margin, Math.min(rawLeft, viewport.width - popover.width - margin)),
  };
};
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run the same Vitest command. Expected: the new placement test and all existing document-panel tests pass.

### Task 2: Render status details through a portal and preserve interaction behavior

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx`
- Test: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts`

**Interfaces:**
- Consume the placement helper from Task 1.
- Preserve `onRetry`, `onRetryLocalIndex`, `onRetryExtraction`, and `onCancelExtraction` callbacks exactly as currently wired.

- [ ] **Step 1: Add a failing structural assertion for portal content**

Extend the panel tests to assert that closed rows still contain the three unique status triggers and no open content, while the popover component's open path renders `data-status-popover-portal="true"` and `role="dialog"`. The test must also assert `aria-expanded="true"` for the open trigger.

- [ ] **Step 2: Replace the clipped absolute panel with portal-backed rendering**

Import `createPortal` from `react-dom`. Keep the trigger in the row, but render the open panel through `document.body` only when `open` is true. Measure the panel with a ref after it mounts, calculate the position from the trigger rect, and update it on resize/scroll. Use a fixed-position wrapper with a high local z-index, `data-status-popover-portal="true"`, and the existing panel content.

The outside pointer listener must treat both the trigger and portal panel as inside, close on outside pointerdown, and return focus to the trigger on Escape or close. When `document` is unavailable during server rendering, render no open portal rather than accessing browser globals.

- [ ] **Step 3: Run focused tests and lint**

Run:

```bash
npm test -- --run src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeExtractionStatus.test.ts src/renderer/components/enterpriseLeadWorkspace/knowledgeDocumentPresentation.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts
```

Expected: all related tests pass and ESLint exits with code 0.

### Task 3: Verify the rendered interaction and build

**Files:**
- No new files.

- [ ] **Step 1: Start the correct Electron development workspace**

Run from `/Users/lijiahao/yuzhh-ai-assistant`:

```bash
npm run electron:dev
```

Confirm the active 5175 server is from this workspace before inspecting the page.

- [ ] **Step 2: Exercise the target flow**

Flow under test: knowledge base → document list → click parsing/local-index/AI status icon → full status panel appears above or below the row → click outside/Escape → panel closes and focus returns.

- [ ] **Step 3: Run production build and diff checks**

Run:

```bash
npm run build
git diff --check
```

Expected: renderer and Electron bundles build successfully and `git diff --check` prints no errors.
