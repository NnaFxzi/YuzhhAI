# Enterprise Lead Workspace Independent Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each enterprise lead workspace own its model provider, skill, external research, and domestic platform
research configuration.

**Architecture:** Store the workspace-specific configuration inside `EnterpriseLeadWorkspace.settings` with explicit
`model`, `skillIds`, `externalResearch`, and `domesticResearch` sections. The renderer edits those sections directly on
the workbench page, while the main process normalizes and persists them. Enterprise lead model generation resolves API
credentials from the workspace's own provider settings instead of only the global app config.

**Tech Stack:** Electron IPC, React, Redux, TypeScript, SQLite, Vitest, existing provider/skill/research helpers.

---

### Task 1: Shared Settings Shape

**Files:**

- Modify: `src/shared/enterpriseLeadWorkspace/types.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/validation.ts`
- Test: `src/shared/enterpriseLeadWorkspace/validation.test.ts`

- [ ] Add model provider settings with `defaultModel`, `defaultModelProvider`, and `providers`.
- [ ] Replace static capability/platform settings with `skillIds`, `externalResearch`, and `domesticResearch`.
- [ ] Normalize legacy `modelRef`, `skillCapabilities`, `researchCapabilities`, and `contentPlatforms` so existing rows
  still load.
- [ ] Verify defaults and partial updates with Vitest.

### Task 2: Workspace Persistence And Runtime Model Resolution

**Files:**

- Modify: `src/main/enterpriseLeadWorkspace/store.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Modify: `src/main/industryPack/modelClientAdapter.ts`
- Modify: `src/main/libs/claudeSettings.ts`
- Test: `src/main/enterpriseLeadWorkspace/store.test.ts`
- Test: `src/main/enterpriseLeadWorkspace/service.test.ts`
- Test: `src/main/industryPack/modelClientAdapter.test.ts`

- [ ] Allow workspace creation to accept initial settings copied from the current global config.
- [ ] Persist workspace settings in the existing `settings` JSON column.
- [ ] Export a helper that resolves a raw API config from an app-config-like provider object.
- [ ] Pass workspace-resolved API config into enterprise lead generation.
- [ ] Verify runs use enabled workspace roles and workspace provider credentials.

### Task 3: Renderer Workbench Editors

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx`
- Modify: `src/renderer/services/enterpriseLeadWorkspace.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Modify: `src/renderer/services/i18n.ts`
- Test: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Test: `src/renderer/services/enterpriseLeadWorkspace.test.ts`

- [ ] Copy current global provider configuration into a new workspace draft before creation.
- [ ] Replace the model selector with provider cards that edit enabled state, API key, base URL, and API format.
- [ ] Replace static skill capability switches with the current installed skill list and workspace `skillIds`.
- [ ] Replace static research/platform switches with Tavily/Firecrawl and domestic source editors.
- [ ] Save all workbench edits through the existing workspace settings IPC.

### Task 4: Verification

**Commands:**

-
`npm test -- src/shared/enterpriseLeadWorkspace/validation.test.ts src/main/enterpriseLeadWorkspace/store.test.ts src/main/enterpriseLeadWorkspace/service.test.ts src/main/industryPack/modelClientAdapter.test.ts src/renderer/services/enterpriseLeadWorkspace.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 <touched files>`
- `npm run build`

- [ ] Confirm the target tests pass.
- [ ] Confirm touched TypeScript files pass ESLint.
- [ ] Confirm production build passes.
