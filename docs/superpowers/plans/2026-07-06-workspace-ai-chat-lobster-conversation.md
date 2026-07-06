# Workspace AI Chat Lobster Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the enterprise workspace “new conversation” page from a Codex-style task launcher back to a
LobsterAI-style conversation entry while keeping workspace Agent, research, and knowledge controls available.

**Architecture:** Keep the behavior inside `WorkspaceAiChat.tsx`; the chat service, session loading, and Enter-to-send
helper remain unchanged. The visual structure should mirror the existing LobsterAI prompt pattern: neutral page
background, `920px` content width, a rounded input card, and a muted context strip for workspace controls.

**Tech Stack:** React, TypeScript, Tailwind, Heroicons, renderer i18n, Vitest SSR rendering tests.

---

### Task 1: Lock The LobsterAI Conversation Direction

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [x] **Step 1: Replace Codex prompt-tray assertions**

Update the empty AI chat tests so they expect the LobsterAI copy and layout anchors:

```ts
expect(markup).toContain('今天要完成什么？');
expect(markup).toContain('输入想推进的事项，我会结合当前空间、Agent 和知识库继续处理。');
expect(markup).toContain('rounded-2xl border border-border bg-surface shadow-card');
expect(markup).toContain('bg-black/[0.035]');
expect(markup).not.toContain('bg-[#f6f7fa]');
expect(markup).not.toContain('min-h-[178px]');
```

- [x] **Step 2: Verify the updated tests fail**

Run:

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts -t "LobsterAI-style"
```

Expected before implementation: FAIL because the component still renders the Codex-style prompt tray.

### Task 2: Rework The Workspace Composer

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [x] **Step 1: Change empty-state copy**

Set `enterpriseLeadAiChatEmptyTitle` to `今天要完成什么？` and make the subtitle describe continuing with the current
workspace rather than launching a task.

- [x] **Step 2: Replace prompt-tray classes**

Use `bg-background` for the page, `max-w-[920px]` for the content,
`rounded-2xl border border-border bg-surface shadow-card` for the main composer, and a `bg-black/[0.035]` context strip
for Agent/research/knowledge controls.

- [x] **Step 3: Keep workspace controls secondary**

Move the Agent selector, research status, knowledge control, and add-context button into the composer footer/context
areas with neutral colors. The send button should use the LobsterAI-style compact dark circle when enabled and muted
gray when disabled.

### Task 3: Verify

**Files:**

- Verify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx`
- Verify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Verify: `src/renderer/services/i18n.ts`

- [x] **Step 1: Run targeted tests**

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: all enterprise lead workspace UI tests pass.

- [x] **Step 2: Run touched-file lint**

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/services/i18n.ts
```

Expected: no ESLint errors or warnings in touched TypeScript files.
