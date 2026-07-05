# Enterprise Lead Workspace Private Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the incorrect global-Agent binding mental model with workspace-private executable Agents that can be edited per workspace.

**Architecture:** Treat the workspace as the ownership boundary for Agent definitions. Keep the existing `workspaceAgents` storage field for migration safety, but reinterpret each item as a full workspace-owned Agent record rather than `globalAgent + overrides`; legacy role workspaces are projected into editable workspace Agent records. The workbench, AI chat, and run task resolution all read the same effective workspace-owned Agent list.

**Tech Stack:** Electron main process, React renderer, Redux-backed Agent store only for legacy compatibility, SQLite-backed enterprise lead workspace store, Vitest, TypeScript.

---

### Task 1: Correct the product spec

**Files:**
- Modify: `docs/superpowers/specs/2026-07-05-enterprise-lead-workspace-pages-design.md`

- [ ] **Step 1: Replace global-Agent language**

  Update the design doc so 工作台 says it manages workspace-private executable Agents, not global Agent bindings or overrides.

- [ ] **Step 2: Define compatibility boundary**

  Document that the existing `workspaceAgents` field remains as the serialized storage shape for now, but the product meaning is a complete workspace-owned Agent definition. Existing old-role workspaces must render editable default Agents.

### Task 2: Add red tests for workspace-owned Agent behavior

**Files:**
- Modify: `src/shared/enterpriseLeadWorkspace/validation.test.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [ ] **Step 1: Shared validation red test**

  Add a test that `normalizeEnterpriseLeadWorkspaceAgents` accepts `name`, `description`, `identity`, `systemPrompt`, `icon`, `model`, and `skillIds` directly on each workspace Agent item, and normalizes them into the item's effective configuration.

- [ ] **Step 2: Service red test**

  Add a test that a newly created workspace without supplied `workspaceAgents` receives default workspace-owned Agents for the enterprise lead workflow, including an editable `product_understanding` Agent.

- [ ] **Step 3: UI red test**

  Add a test that `WorkspaceWorkbench` in Agent mode renders the default 产品理解 Agent with an edit button even when the workspace has no global Agent records.

- [ ] **Step 4: Run the targeted tests and confirm failure**

  Run:

  ```bash
  npm test -- src/shared/enterpriseLeadWorkspace/validation.test.ts src/main/enterpriseLeadWorkspace/service.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
  ```

  Expected: FAIL on the newly added assertions because workspace Agent definitions are still treated as global bindings plus overrides.

### Task 3: Reinterpret workspaceAgents as workspace-private definitions

**Files:**
- Modify: `src/shared/enterpriseLeadWorkspace/types.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/validation.ts`
- Modify: `src/main/enterpriseLeadWorkspace/workflow.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Modify: `src/main/enterpriseLeadWorkspace/store.ts` only if normalization needs persistence compatibility

- [ ] **Step 1: Extend workspace Agent types**

  Keep the persisted shape compatible, but make workspace-owned fields first-class by allowing the same editable fields either directly on the Agent item or inside the legacy `overrides` object.

- [ ] **Step 2: Add default workflow Agent projection**

  Create a helper that turns `ENTERPRISE_LEAD_AGENT_WORKFLOW` metadata into editable workspace Agent records. The product-understanding role should have `agentId: 'product_understanding'`, `enabled: true`, ordered by workflow sequence, and full default name/description/icon/model/skill values.

- [ ] **Step 3: Use defaults on workspace creation**

  When creating a workspace with no supplied workspace Agents, store the default workspace-owned Agent list.

- [ ] **Step 4: Preserve old workspace compatibility**

  When reading or rendering an old workspace whose `workspaceAgents` is empty but `enabledAgentRoles` exists, derive editable workspace Agent definitions from those roles without requiring a global Agent lookup.

- [ ] **Step 5: Run targeted shared/main tests**

  Run:

  ```bash
  npm test -- src/shared/enterpriseLeadWorkspace/validation.test.ts src/main/enterpriseLeadWorkspace/service.test.ts
  ```

  Expected: PASS for the new workspace-owned Agent tests.

### Task 4: Rewrite workbench Agent management around workspace-private Agents

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
- Modify: `src/renderer/services/i18n.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [ ] **Step 1: Remove global Agent dependency from workbench Agent list**

  Stop loading global Agents for the 工作台 Agent 管理 list. The list should come from the workspace-owned Agent definitions plus legacy default projection.

- [ ] **Step 2: Replace add-global-Agent controls**

  Remove the primary “add existing global Agent” flow from the workbench surface. Keep create/edit controls focused on adding or modifying Agents inside the current workspace.

- [ ] **Step 3: Edit the selected workspace Agent directly**

  The edit form should open for `product_understanding` and save fields back into the current workspace Agent record. Saving must call the existing workspace-agent update service with complete workspace-owned definitions.

- [ ] **Step 4: Run targeted UI test**

  Run:

  ```bash
  npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
  ```

  Expected: PASS for default Agent rendering and editing behavior.

### Task 5: Align AI chat and run resolution with workspace-owned Agents

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx`
- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Modify: `src/main/enterpriseLeadWorkspace/promptTemplates.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [ ] **Step 1: Remove global-Agent label fallback from AI chat**

  AI 对话 target choices should be derived from workspace-owned Agent definitions. The fallback choice remains “全部 / 通用助手”.

- [ ] **Step 2: Ensure run tasks use workspace-owned snapshots**

  New runs should create tasks from enabled workspace-owned Agents. Each task snapshot should include the current workspace Agent's edited name, description, identity, prompt, model, and skills.

- [ ] **Step 3: Add assertions for edited Agent snapshots**

  Add a service test that editing the workspace product-understanding Agent changes the next run's `agentSnapshot.name` and prompt.

- [ ] **Step 4: Run targeted tests**

  Run:

  ```bash
  npm test -- src/main/enterpriseLeadWorkspace/service.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
  ```

  Expected: PASS.

### Task 6: Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused test suite**

  ```bash
  npm test -- src/shared/enterpriseLeadWorkspace/validation.test.ts src/main/enterpriseLeadWorkspace/service.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
  ```

- [ ] **Step 2: Run lint for touched TypeScript files**

  ```bash
  npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/enterpriseLeadWorkspace/types.ts src/shared/enterpriseLeadWorkspace/validation.ts src/shared/enterpriseLeadWorkspace/validation.test.ts src/main/enterpriseLeadWorkspace/workflow.ts src/main/enterpriseLeadWorkspace/service.ts src/main/enterpriseLeadWorkspace/service.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/services/i18n.ts
  ```

- [ ] **Step 3: Run typecheck and build**

  ```bash
  npx tsc --noEmit --pretty false
  npm run build
  ```

- [ ] **Step 4: Optional local UI inspection**

  Start the app, open an enterprise lead workspace, confirm 工作台 > Agent 管理 shows 产品理解 Agent without any global Agent setup, edit it, save it, and confirm the next run/AI chat target reads the edited name.
