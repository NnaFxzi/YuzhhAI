# Content Production Agent Team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broad enterprise Agent Team with a six-agent content production team that improves topics, copy,
short-video scripts, private-domain messages, and conversion content.

**Architecture:** Keep the existing workspace-owned `workspaceAgents` model and route chat through the existing
enterprise lead workspace service. Replace default role metadata, add compatibility for legacy role ids, update chat
auto-routing to content intent sequences, and update renderer copy/choices so users can select content agents directly.

**Tech Stack:** TypeScript, Electron main process, React renderer, Redux-adjacent service wrappers, Vitest, Tailwind,
existing `i18nService`.

## Global Constraints

- Preserve old chat messages, run tasks, and `agentSnapshot` rendering.
- Do not silently delete user-created workspace agents.
- Do not rewrite Cowork/OpenClaw runtime integration.
- Use `workspaceAgents` storage; no new table is required in this phase.
- Add both Chinese and English i18n entries for user-visible renderer text.
- Follow test-first implementation: write a failing focused test before production code.
- Keep edits scoped to enterprise lead workspace Agent Team, chat routing, prompts, i18n, and tests.

---

### Task 1: Content Agent Role Metadata

**Files:**

- Modify: `src/shared/enterpriseLeadWorkspace/constants.ts`
- Modify: `src/main/enterpriseLeadWorkspace/workflow.ts`
- Test: `src/main/enterpriseLeadWorkspace/service.test.ts`
- Test: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

**Interfaces:**

- Produces: `EnterpriseLeadAgentRole.ProductSellingPoint`, `TopicPlanning`, `ShortVideoScript`, `SocialCopy`,
  `PrivateDomainConversion`, `ContentQuality`
- Produces: `ENTERPRISE_LEAD_AGENT_WORKFLOW` ordered as the six content roles
- Preserves: legacy role ids as valid constants for historical records

- [ ] **Step 1: Write failing tests for default team shape**

Add service coverage asserting a new workspace gets exactly the six content agents in order:

```ts
expect(workspace.workspaceAgents.map(agent => agent.agentId)).toEqual([
  EnterpriseLeadAgentRole.ProductSellingPoint,
  EnterpriseLeadAgentRole.TopicPlanning,
  EnterpriseLeadAgentRole.ShortVideoScript,
  EnterpriseLeadAgentRole.SocialCopy,
  EnterpriseLeadAgentRole.PrivateDomainConversion,
  EnterpriseLeadAgentRole.ContentQuality,
]);
```

Update renderer UI coverage that currently expects 9 workbench agent items to expect 6 content agents.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- src/main/enterpriseLeadWorkspace/service.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: tests fail because the workflow still returns legacy nine-agent roles.

- [ ] **Step 3: Add content role constants and metadata**

Update `EnterpriseLeadAgentRole` with the six new role ids while keeping old role ids for compatibility:

```ts
ProductSellingPoint: 'product_selling_point',
TopicPlanning: 'topic_planning',
ShortVideoScript: 'short_video_script',
SocialCopy: 'social_copy',
PrivateDomainConversion: 'private_domain_conversion',
ContentQuality: 'content_quality',
```

Replace `ENTERPRISE_LEAD_AGENT_WORKFLOW` with six metadata entries whose titles are:

```text
产品卖点 Agent
选题策划 Agent
短视频脚本 Agent
图文文案 Agent
私域转化 Agent
内容质检 Agent
```

- [ ] **Step 4: Run tests and verify GREEN for default team**

Run the same test command. Expected: default team shape tests pass or move to the next failing behavior.

---

### Task 2: Legacy Compatibility And Migration-Safe Defaults

**Files:**

- Modify: `src/main/enterpriseLeadWorkspace/workflow.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/validation.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
- Test: `src/main/enterpriseLeadWorkspace/service.test.ts`
- Test: `src/shared/enterpriseLeadWorkspace/validation.test.ts`

**Interfaces:**

- Produces: `LEGACY_ENTERPRISE_LEAD_AGENT_ROLES`
- Produces: `mapLegacyEnterpriseLeadAgentRole(role: string): EnterpriseLeadAgentRole | null`
- Preserves: `getEnterpriseLeadAgentMetadata()` can still render legacy roles

- [ ] **Step 1: Write failing tests for legacy role readability**

Add tests that:

```ts
expect(getEnterpriseLeadTaskDisplay({
  role: EnterpriseLeadAgentRole.ProjectArchive,
  agentSnapshot: null,
}).titleText || i18nService.t(getEnterpriseLeadTaskDisplay(...).titleKey!)).toBeTruthy();
```

Add a validation/service test that a workspace-created legacy custom binding remains present after normalization.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- src/shared/enterpriseLeadWorkspace/validation.test.ts src/main/enterpriseLeadWorkspace/service.test.ts
```

Expected: new compatibility expectations fail until mapping/readability code exists.

- [ ] **Step 3: Implement compatibility helpers**

Keep legacy constants in `EnterpriseLeadAgentRole`, but separate the default content workflow from legacy role metadata.
Add helper metadata for old roles so old snapshots and role displays do not throw.

When workspace bindings are pure untouched system-template legacy defaults, replace them with the six content defaults.
When any binding is workspace-created or has user overrides beyond template defaults, preserve it.

- [ ] **Step 4: Run tests and verify GREEN for compatibility**

Run the same command. Expected: legacy readability and preservation tests pass.

---

### Task 3: Content Chat Routing And Prompt Flow

**Files:**

- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Modify: `src/main/enterpriseLeadWorkspace/promptTemplates.ts`
- Test: `src/main/enterpriseLeadWorkspace/service.test.ts`

**Interfaces:**

- Produces: Auto Team route sequences:
  - topic requests: Product Selling Point -> Topic Planning -> Content Quality
  - video requests: Product Selling Point -> Short Video Script -> Content Quality
  - social copy requests: Product Selling Point -> Social Copy -> Content Quality
  - private-domain requests: Product Selling Point -> Private-Domain Conversion -> Content Quality
  - polish/review requests: Content Quality
- Preserves: manual `targetAgentId` takes precedence

- [ ] **Step 1: Write failing routing tests**

Add tests that send representative chat messages:

```ts
await service.chat(workspace.id, { message: '帮我做 10 个小红书选题' });
expect(latestAssistant.routing?.agents.map(agent => agent.id)).toEqual([
  EnterpriseLeadAgentRole.ProductSellingPoint,
  EnterpriseLeadAgentRole.TopicPlanning,
  EnterpriseLeadAgentRole.ContentQuality,
]);
```

Repeat for:

```text
帮我写一个 60 秒短视频脚本
帮我写一条朋友圈文案
客户看完内容后我该怎么私聊跟进
这段文案太像 AI，帮我改自然
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- src/main/enterpriseLeadWorkspace/service.test.ts
```

Expected: routing still returns old content/sales/risk roles or a single planned target.

- [ ] **Step 3: Implement content routing**

Replace `WORKSPACE_CHAT_AUTO_ROUTE_RULES` with content-focused rules and update `resolveChatAgentRoute()` so matched
rules can return multi-agent sequences. Ensure manual target selection still returns only the selected agent.

Update prompt wording so final synthesis describes the active content specialist team and quality checker rather than
enterprise lead/scoring roles.

- [ ] **Step 4: Run tests and verify GREEN for routing**

Run the same service test command. Expected: routing tests pass.

---

### Task 4: Renderer Agent Selection And Agent Team Copy

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
- Modify: `src/renderer/services/i18n.ts`
- Test: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

**Interfaces:**

- Produces: chat picker labels `Auto Team` / `自动团队`
- Produces: renderer workbench team list with six content agents
- Preserves: `targetAgentId` is still sent through `enterpriseLeadWorkspaceService.chat()`

- [ ] **Step 1: Write failing renderer tests**

Add tests asserting:

```ts
const choices = getSortedAgentChoices(workspace.workspaceAgents);
expect(choices.map(choice => choice.id)).toEqual([
  EnterpriseLeadAgentRole.ProductSellingPoint,
  EnterpriseLeadAgentRole.TopicPlanning,
  EnterpriseLeadAgentRole.ShortVideoScript,
  EnterpriseLeadAgentRole.SocialCopy,
  EnterpriseLeadAgentRole.PrivateDomainConversion,
  EnterpriseLeadAgentRole.ContentQuality,
]);
```

Assert rendered picker includes `自动团队` and the six content names.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: tests fail while UI copy and role list still reflect old roles.

- [ ] **Step 3: Update renderer list and copy**

Update workbench agent item metadata and i18n copy:

```text
Agent 团队 -> 内容 Agent 团队 where page context needs clarity
管理当前工作空间中会提升选题、脚本、文案和私域转化质量的 Agent 团队
自动团队
```

Keep the sidebar label `Agent 团队` unless the existing navigation needs shorter text.

- [ ] **Step 4: Run tests and verify GREEN for renderer**

Run the same renderer test command. Expected: renderer tests pass.

---

### Task 5: Verification And Changed-File Lint

**Files:**

- Verify all touched TypeScript and TSX files

**Interfaces:**

- Produces: final verified implementation summary

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- src/main/enterpriseLeadWorkspace/service.test.ts src/shared/enterpriseLeadWorkspace/validation.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run changed-file ESLint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/enterpriseLeadWorkspace/constants.ts src/shared/enterpriseLeadWorkspace/validation.ts src/main/enterpriseLeadWorkspace/workflow.ts src/main/enterpriseLeadWorkspace/service.ts src/main/enterpriseLeadWorkspace/promptTemplates.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/renderer/services/i18n.ts src/main/enterpriseLeadWorkspace/service.test.ts src/shared/enterpriseLeadWorkspace/validation.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: PASS or only unrelated pre-existing issues clearly documented.

- [ ] **Step 3: Review diff**

Run:

```bash
git diff -- src/shared/enterpriseLeadWorkspace/constants.ts src/shared/enterpriseLeadWorkspace/validation.ts src/main/enterpriseLeadWorkspace/workflow.ts src/main/enterpriseLeadWorkspace/service.ts src/main/enterpriseLeadWorkspace/promptTemplates.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/renderer/services/i18n.ts src/main/enterpriseLeadWorkspace/service.test.ts src/shared/enterpriseLeadWorkspace/validation.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts docs/superpowers/specs/2026-07-07-content-production-agent-team-design.md docs/superpowers/plans/2026-07-07-content-production-agent-team.md
```

Expected: diff is scoped to content Agent Team redesign and does not revert unrelated user changes.
