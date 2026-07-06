# Workspace Settings Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the workspace settings page's dense configuration layout with a three-step quick setup flow while
keeping advanced settings available.

**Architecture:** Keep the existing `WorkspaceSettings.tsx` component and its persistence logic. Change the render layer
to present quick model, skill preset, and research/output setup first, then move detailed provider, skill, source, and
content platform controls into collapsed advanced panels.

**Tech Stack:** React, TypeScript, Redux skill state, existing i18n dictionaries, Vitest server-rendered component
tests.

---

### Task 1: Update Render Expectations

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [x] **Step 1: Write the failing test**

Update the existing workspace settings render test so it expects:

```ts
expect(markup).toContain('快速设置');
expect(markup).toContain('选择默认模型');
expect(markup).toContain('选择一个能力包');
expect(markup).toContain('配置调研和输出');
expect(markup).toContain('先不接外部服务');
expect(markup).toContain('高级模型设置');
expect(markup).toContain('技能明细');
expect(markup).toContain('调研来源');
expect(markup).toContain('内容投递与风控');
expect(markup).toContain('保存配置');
expect(markup).not.toContain('大模型厂商配置');
expect(markup).not.toContain('外部调研能力管理');
```

- [x] **Step 2: Run test to verify it fails**

Run:
`npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts -t "renders workspace settings"`

Expected: FAIL because `WorkspaceSettings` still renders the dense settings sections.

### Task 2: Implement Quick Setup Rendering

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceSettings.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [x] **Step 1: Add concise i18n keys**

Add Chinese and English keys for quick setup labels: quick setup title/description, model step, skill preset step,
research/output step, advanced model, skill details, content delivery/risk, "skip external service", "web search", "web
crawl", and service-provider dropdown text.

- [x] **Step 2: Replace the primary settings body**

Update `WorkspaceSettings` to render:

- header and save button;
- three-step quick setup;
- collapsed `<details>` panels for advanced model settings, skill details, research sources, and content delivery/risk;
- the existing save behavior and blocking state.

- [x] **Step 3: Preserve existing controls**

Reuse current update handlers for default model, provider fields, skill selection, research providers, domestic sources,
content platforms, output rules, and save.

- [x] **Step 4: Run test to verify it passes**

Run:
`npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts -t "renders workspace settings"`

Expected: PASS.

### Task 3: Verify Changed Files

**Files:**

- Test: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Verify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceSettings.tsx`
- Verify: `src/renderer/services/i18n.ts`

- [x] **Step 1: Run targeted component test**

Run: `npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

Expected: PASS for the full component test file.

- [x] **Step 2: Run changed-file lint**

Run:
`npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/WorkspaceSettings.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/services/i18n.ts`

Expected: PASS for changed files.

- [x] **Step 3: Do not commit**

Repository instructions say not to commit until the user has tested and confirmed.
