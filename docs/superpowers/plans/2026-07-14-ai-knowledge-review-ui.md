# AI Knowledge Review UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add honest animated extraction feedback and turn the AI knowledge page into a compact review table with a keyboard-accessible right-side evidence drawer.

**Architecture:** Keep backend, IPC, controller, pagination, and mutation contracts unchanged. Add focused renderer-only components for extraction activity, filters, and the evidence drawer, then compose them from the existing panels. Preserve controller-owned evidence identity and callbacks so the redesign cannot bypass revision, stale-evidence, or projection safeguards.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3, Heroicons, Vitest, React DOM static markup tests, and the existing fake-DOM interaction harness.

## Global Constraints

- Do not modify SQLite, IPC, preload, model calls, polling cadence, fact ordering, pagination, or review state machines.
- Do not display a numeric percentage for `queued` or `running`; use an indeterminate visual with real status text.
- Every new user-visible string must have both `zh` and `en` entries in `src/renderer/services/i18n.ts`.
- Use existing theme tokens and Heroicons; respect reduced-motion settings.
- Preserve confirm/reject/archive legality, evidence paging/retry, stale-state behavior, and context resets.
- Do not stage, commit, or push before user manual acceptance.
- Implement every task with TDD, then run independent specification and code-quality reviews.

## File Map

- Create `WorkspaceKnowledgeExtractionStatus.tsx` and its test for one document's extraction activity.
- Create `WorkspaceAiKnowledgeFilters.tsx` and its test for styled filter controls.
- Create `WorkspaceKnowledgeFactEvidenceDrawer.tsx` and its test for focus-managed evidence display.
- Modify `WorkspaceKnowledgeDocumentsPanel.tsx` and its test to compose the activity component.
- Modify `WorkspaceAiKnowledgePanel.tsx` and its test to compose the filters, compact table, and drawer.
- Modify `WorkspaceKnowledgeFactEvidence.tsx` and its test so it renders evidence content rather than a table-cell disclosure.
- Modify `i18n.ts` for bilingual copy.

---

### Task 1: Honest Animated Extraction Status

**Files:**
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeExtractionStatus.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeExtractionStatus.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts`
- Modify: `src/renderer/services/i18n.ts`

**Interfaces:**
- Consumes: `KnowledgeDocumentExtractionPresentation` and the panel's existing cancel/retry callbacks.
- Produces:

```ts
export interface WorkspaceKnowledgeExtractionStatusProps {
  presentation: KnowledgeDocumentExtractionPresentation;
  isMutating: boolean;
  onCancel: () => void;
  onRetry: () => void;
}

export const WorkspaceKnowledgeExtractionStatus = (
  props: WorkspaceKnowledgeExtractionStatusProps,
): React.ReactElement;
```

- [ ] **Step 1: Write failing status tests**

Add static-markup tests with these exact contracts:

```ts
expect(renderStatus(KnowledgeEnrichmentStatus.Queued)).toContain('data-extraction-indeterminate');
expect(renderStatus(KnowledgeEnrichmentStatus.Queued)).not.toContain('0%');
expect(renderStatus(KnowledgeEnrichmentStatus.Running)).toContain('role="status"');
expect(renderStatus(KnowledgeEnrichmentStatus.Running)).toContain('motion-reduce:animate-none');
expect(renderStatus(KnowledgeEnrichmentStatus.ReviewRequired)).toContain(
  'enterpriseKnowledgeAiExtractionReviewSummary',
);
expect(renderStatus(KnowledgeEnrichmentStatus.ReviewRequired)).not.toContain(
  'data-extraction-indeterminate',
);
```

Add document-panel integration assertions that queued/running rows retain cancel and failed/cancelled rows retain retry.

- [ ] **Step 2: Prove the tests fail**

Run `npm test -- WorkspaceKnowledgeExtractionStatus WorkspaceKnowledgeDocumentsPanel`.

Expected: FAIL because the component and new i18n keys do not exist.

- [ ] **Step 3: Implement the component and bilingual copy**

Use the real status, never a timer-derived percentage:

```tsx
const isActive =
  presentation.status === KnowledgeEnrichmentStatus.Queued ||
  presentation.status === KnowledgeEnrichmentStatus.Running;

return (
  <div
    {...(isActive ? { role: 'status', 'aria-live': 'polite' as const } : {})}
    className={isActive
      ? 'rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5'
      : 'flex flex-wrap items-center justify-between gap-3'}
  >
    {isActive ? (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <ArrowPathIcon
            aria-hidden="true"
            className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none"
          />
          <div>
            <p className="text-sm font-medium text-foreground">{activeTitle}</p>
            <p className="text-xs text-secondary">{activeDescription}</p>
          </div>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-primary/10" aria-hidden="true">
          <div
            data-extraction-indeterminate
            className="h-full w-1/3 animate-shimmer rounded-full bg-primary motion-reduce:animate-none"
          />
        </div>
      </div>
    ) : terminalContent}
  </div>
);
```

Add exact Chinese and English strings for queued description, running title/description, and the review summary with `pendingFactCount`.

- [ ] **Step 4: Compose it from the document panel**

Replace only the extraction row markup:

```tsx
<WorkspaceKnowledgeExtractionStatus
  presentation={extraction}
  isMutating={isExtractionMutating}
  onCancel={() => onCancelExtraction(document)}
  onRetry={() => onRetryExtraction(document)}
/>
```

Do not change authorization, retry, or cancellation functions.

- [ ] **Step 5: Verify Task 1**

Run:

```bash
npm test -- WorkspaceKnowledgeExtractionStatus WorkspaceKnowledgeDocumentsPanel knowledgeDocumentPresentation
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeExtractionStatus.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeExtractionStatus.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts \
  src/renderer/services/i18n.ts
```

Expected: focused tests PASS and lint exits 0.

---

### Task 2: Compact Filter Toolbar

**Files:**
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeFilters.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeFilters.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts`
- Modify: `src/renderer/services/i18n.ts`

**Interfaces:**
- Consumes: `WorkspaceAiKnowledgeCanonicalFilters` and existing filter callbacks.
- Produces:

```ts
export interface WorkspaceAiKnowledgeFiltersProps {
  filters: WorkspaceAiKnowledgeCanonicalFilters;
  onViewChange: (view: KnowledgeFactListViewValue) => void;
  onReviewStatusesChange: (statuses: KnowledgeFactReviewStatusValue[]) => void;
  onEvidenceStateChange: (state: KnowledgeFactEvidenceStateValue) => void;
}
```

- [ ] **Step 1: Write failing toolbar tests**

Assert the new structure and removal of the raw multiple select:

```ts
expect(html).toContain('data-ai-knowledge-filters');
expect(html).toContain('data-review-status-trigger');
expect(html).not.toContain('<select multiple');
expect(html).toContain('enterpriseAiKnowledgeReviewFilterAll');
```

Using the fake-DOM harness, open the review menu, toggle Pending and Confirmed, and assert:

```ts
expect(onReviewStatusesChange).toHaveBeenLastCalledWith([
  KnowledgeFactReviewStatus.Pending,
  KnowledgeFactReviewStatus.Confirmed,
]);
```

Also test Escape/outside close, `aria-expanded`, and `aria-controls`.

- [ ] **Step 2: Prove the tests fail**

Run `npm test -- WorkspaceAiKnowledgeFilters WorkspaceAiKnowledgePanel`.

Expected: FAIL because the extracted toolbar and summary strings do not exist.

- [ ] **Step 3: Implement the styled toolbar**

Use styled native single selects for view/evidence and a checkbox popover for review status:

```tsx
<button
  type="button"
  data-review-status-trigger
  aria-haspopup="menu"
  aria-expanded={open}
  aria-controls={menuId}
  className={controlClassName}
  onClick={() => setOpen(current => !current)}
>
  <span className="truncate">{summary}</span>
  <ChevronDownIcon className="h-4 w-4" aria-hidden="true" />
</button>
```

An empty status array means all statuses. Emit selected statuses in enum order, not click order. Close on Escape and outside pointer interaction without changing filters.

- [ ] **Step 4: Compose the toolbar**

Replace the raw filters in `WorkspaceAiKnowledgePanelView` with:

```tsx
<WorkspaceAiKnowledgeFilters
  filters={props.filters}
  onViewChange={props.onViewChange}
  onReviewStatusesChange={props.onReviewStatusesChange}
  onEvidenceStateChange={props.onEvidenceStateChange}
/>
```

Do not change controller filter methods or request construction.

- [ ] **Step 5: Verify Task 2**

Run:

```bash
npm test -- WorkspaceAiKnowledgeFilters WorkspaceAiKnowledgePanel useWorkspaceAiKnowledge workspaceAiKnowledgeState
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeFilters.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeFilters.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts \
  src/renderer/services/i18n.ts
```

Expected: focused tests PASS and lint exits 0.

---

### Task 3: Compact Table and Evidence Drawer

**Files:**
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidenceDrawer.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidenceDrawer.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidence.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidence.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts`
- Modify: `src/renderer/services/i18n.ts`

**Interfaces:**
- Consumes: current evidence state, flags, and callbacks.
- Produces:

```ts
export interface WorkspaceKnowledgeFactEvidenceDrawerProps {
  fact: KnowledgeFactSummary | null;
  evidence: WorkspaceAiKnowledgeEvidenceState;
  hasLoadedFirstPage: boolean;
  errorCode: KnowledgeBaseErrorCode | null;
  returnFocusElement: HTMLElement | null;
  onClose: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
}
```

- [ ] **Step 1: Write failing evidence and drawer tests**

Update evidence-content tests:

```ts
expect(html).not.toContain('aria-expanded');
expect(html).not.toContain('enterpriseAiKnowledgeEvidencePreview');
expect(html).toContain('enterpriseAiKnowledgeEvidenceConfidence');
```

Add drawer assertions:

```ts
expect(openHtml).toContain('role="dialog"');
expect(openHtml).toContain('aria-modal="true"');
expect(openHtml).toContain('data-evidence-drawer');
expect(closedHtml).toBe('');
```

In fake DOM, assert initial close-button focus, Escape close, and return focus to a still-connected trigger.

- [ ] **Step 2: Write failing compact-table tests**

```ts
expect(html).toContain('data-ai-knowledge-table-scroll');
expect(html).toContain('min-w-[1040px]');
expect(html).toContain('data-evidence-trigger');
expect(html).not.toContain('enterpriseAiKnowledgeEvidencePreview');
expect(html).toContain('line-clamp-3');
```

Render an expanded fact and assert the drawer is outside the table and the matching trigger is expanded.

- [ ] **Step 3: Prove the tests fail**

Run `npm test -- WorkspaceKnowledgeFactEvidenceDrawer WorkspaceKnowledgeFactEvidence WorkspaceAiKnowledgePanel`.

Expected: FAIL because the drawer and compact table do not exist.

- [ ] **Step 4: Make evidence content-only and implement the drawer**

Keep evidence items, loading, retry, empty, paging, and end states in `WorkspaceKnowledgeFactEvidence`. Move trigger and preview responsibilities out.

Use a panel-local overlay and drawer:

```tsx
<aside
  data-evidence-drawer
  role="dialog"
  aria-modal="true"
  aria-labelledby={titleId}
  className="absolute inset-y-0 right-0 z-30 flex w-[min(420px,calc(100%-1rem))] flex-col border-l border-border bg-background shadow-xl"
>
  <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
    <div className="min-w-0">
      <p className="text-xs font-medium text-primary">{domainLabel}</p>
      <h3 id={titleId} className="mt-1 line-clamp-2 text-sm font-semibold text-foreground">
        {fact.value}
      </h3>
    </div>
    <button
      ref={closeButtonRef}
      type="button"
      aria-label={i18nService.t('enterpriseAiKnowledgeEvidenceDrawerClose')}
      className="rounded-md p-1.5 text-secondary hover:bg-surface-raised hover:text-foreground"
      onClick={onClose}
    >
      <XMarkIcon className="h-5 w-5" aria-hidden="true" />
    </button>
  </header>
  <div className="min-h-0 flex-1 overflow-y-auto p-5">
    <WorkspaceKnowledgeFactEvidence {...evidenceProps} />
  </div>
</aside>
```

Focus the close button on open, close on Escape, and return focus only when the original trigger remains connected.

- [ ] **Step 5: Style the compact table without changing semantics**

Wrap the table in a bordered horizontal scroll container. Use `min-w-[1040px]`, explicit column widths, `line-clamp-3`, status pills, and theme tokens. Keep every current action data attribute and callback argument.

The evidence cell becomes counts plus one trigger:

```tsx
<button
  type="button"
  data-evidence-trigger
  aria-expanded={isExpanded}
  aria-controls={drawerId}
  onClick={event => {
    setEvidenceReturnFocusElement(event.currentTarget);
    props.onToggleEvidence(row.fact);
  }}
>
  {i18nService.t('enterpriseAiKnowledgeEvidenceExpand')}
</button>
```

Use existing review/archive disabled rules, feedback, paging, and projection dialogs verbatim.

- [ ] **Step 6: Verify Task 3**

Run:

```bash
npm test -- WorkspaceKnowledgeFactEvidenceDrawer WorkspaceKnowledgeFactEvidence WorkspaceAiKnowledgePanel useWorkspaceAiKnowledge
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidenceDrawer.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidenceDrawer.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidence.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidence.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts \
  src/renderer/services/i18n.ts
```

Expected: focused tests PASS and lint exits 0.

---

### Task 4: Integrated Regression and Rendered QA

**Files:**
- Modify only files from Tasks 1–3 if a test or visual defect is found.
- Save screenshots and temporary automation outside the repository.

**Interfaces:**
- Consumes: completed renderer components from Tasks 1–3.
- Produces: verified Electron document-status and AI-knowledge review flows.

- [ ] **Step 1: Run focused renderer regression**

```bash
npm test -- WorkspaceKnowledgeExtractionStatus WorkspaceKnowledgeDocumentsPanel \
  knowledgeDocumentPresentation WorkspaceAiKnowledgeFilters \
  WorkspaceKnowledgeFactEvidenceDrawer WorkspaceKnowledgeFactEvidence \
  WorkspaceAiKnowledgePanel useWorkspaceAiKnowledge workspaceAiKnowledgeState \
  enterpriseLeadWorkspaceUi WorkspaceKnowledgeBase
```

Expected: all selected Vitest files PASS.

- [ ] **Step 2: Run build and complete changed-file lint**

Run:

```bash
npm run build
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeExtractionStatus.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeExtractionStatus.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeFilters.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgeFilters.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidenceDrawer.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidenceDrawer.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidence.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeFactEvidence.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeDocumentsPanel.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiKnowledgePanel.test.ts \
  src/renderer/services/i18n.ts
```

Expected: build and lint exit 0.

- [ ] **Step 3: Validate the rendered Electron flow**

The flow under test is: Knowledge Base → queued/running document → truthful animated status → AI Knowledge → compact table → evidence drawer → close via button/Escape → review controls remain available.

Verify page identity, no framework overlay, no relevant console errors, desktop layout, horizontal overflow behavior, filter interaction, drawer focus return, and reduced-motion class coverage. Capture document-status and open-drawer screenshots outside the repository.

- [ ] **Step 4: Review final scope**

Run:

```bash
git diff --check
git diff --stat
git diff -- src/renderer/components/enterpriseLeadWorkspace src/renderer/services/i18n.ts
```

Expected: no whitespace errors, no backend/IPC changes from this plan, no unrelated formatting churn, and complete bilingual copy.
