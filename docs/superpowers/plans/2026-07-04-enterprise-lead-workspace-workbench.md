# Enterprise Lead Workspace Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the workspace home default with a single-screen management workbench for Agents, skills, research capabilities, and domestic content platforms.

**Architecture:** Keep execution/run behavior in the existing console files, but introduce a separate renderer workbench component for the landing page. Add pure UI metadata helpers so tests can verify navigation, Agent management metadata, and configuration sections without mounting Electron UI.

**Tech Stack:** Electron renderer, React, TypeScript, Tailwind, Vitest, existing `i18nService`.

---

### Task 1: Add Workbench Metadata Helpers

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Write failing helper tests**

Add tests that assert:

```ts
expect(getWorkbenchSidebarItems().map(item => item.labelKey)).toEqual([
  'enterpriseLeadWorkbenchNavWorkbench',
  'enterpriseLeadWorkbenchNavAiChat',
  'enterpriseLeadWorkbenchNavKnowledgeBase',
  'enterpriseLeadWorkbenchNavCreationRecords',
  'enterpriseLeadWorkbenchNavSettings',
]);
expect(getWorkbenchAgentItems()).toHaveLength(9);
expect(getWorkbenchConfigSections().map(section => section.actionKey)).toEqual([
  'enterpriseLeadWorkbenchManageSkills',
  'enterpriseLeadWorkbenchConfigureResearch',
  'enterpriseLeadWorkbenchManagePlatforms',
]);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: fails because the new helper exports do not exist.

- [ ] **Step 3: Implement helper metadata and i18n keys**

Add helper exports for sidebar items, Agent management cards, and config
sections. Add zh/en translations for every new label key.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: pass.

### Task 2: Build Workbench Component And Replace Home Default

**Files:**
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/index.ts`

- [ ] **Step 1: Implement `WorkspaceWorkbench`**

Render the v5 single-screen workbench:

- left workspace sidebar using the workspace name
- nav entries including 知识库
- Agent 管理 3x3 cards
- 技能管理, 外部调研能力管理, 内容平台配置 panels
- no selected-Agent detail sidebar

- [ ] **Step 2: Replace default workspace home content**

Update `WorkspaceHome` to render `WorkspaceWorkbench` instead of the summary,
run console, and recent workspace list.

- [ ] **Step 3: Run TypeScript and renderer tests**

Run:

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: pass.

### Task 3: Verify Build Quality

**Files:**
- Verify all touched TypeScript/TSX files.

- [ ] **Step 1: Run changed-file lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx src/renderer/components/enterpriseLeadWorkspace/index.ts src/renderer/services/i18n.ts
```

Expected: pass.

- [ ] **Step 2: Run renderer build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 3: Smoke the page when feasible**

Run the app and verify the workspace page shows:

- workspace name in the sidebar
- 知识库 nav entry
- 9 Agent cards
- three configuration panels
- no selected-Agent detail sidebar
