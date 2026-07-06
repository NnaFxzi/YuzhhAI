# Workspace AI Chat Codex Prompt Tray Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Codex-style AI chat entry and conversation composer in the enterprise lead workspace.

**Architecture:** Keep the change scoped to `WorkspaceAiChat.tsx` and its SSR UI tests. Preserve the existing workspace
chat service flow while replacing the visual shell, message bubbles, and textarea keyboard behavior.

**Tech Stack:** React, TypeScript, Tailwind, Heroicons, Vitest SSR rendering tests.

---

### Task 1: Lock The New Empty Prompt Tray

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [x] **Step 1: Add a failing SSR test for the simplified empty state**

Assert that the AI chat empty state contains the main title, subtitle, add-context control, Agent selector, research
status, knowledge button, and no longer renders the removed `AI 对话` eyebrow.

- [x] **Step 2: Verify the test fails before implementation**

Run:

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts -t "simplified Codex-style prompt tray"
```

Expected before implementation: FAIL because the old `AI 对话` eyebrow is still present.

- [x] **Step 3: Add a prototype-token regression test**

Assert the real component contains the prototype's visual anchors: `#f6f7fa` background, `1060px` shell, `900px / 178px`
landing composer, `22px` composer radius, `252px` Agent control, and `42px` send button.

### Task 2: Implement Composer And Message Visuals

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx`

- [x] **Step 1: Replace the old composer layout**

Change `renderComposer()` to a rounded prompt tray with a transparent textarea, bottom toolbar, add-context button,
Agent selector, research chip, knowledge chip, and circular send button.

- [x] **Step 2: Remove visual role labels from messages**

Update `MessageRow` so user and assistant messages render without `我` or `助手` labels, keeping user messages
right-aligned and assistant messages plain.

- [x] **Step 3: Remove the empty-state eyebrow**

Delete the `enterpriseLeadAiChatTitle` eyebrow from the empty chat screen while keeping `接下来要完成什么？` and the
subtitle.

### Task 3: Add Enter-To-Send Behavior

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [x] **Step 1: Add a failing keyboard helper test**

Assert plain Enter submits, Shift+Enter does not submit, IME composition Enter does not submit, and non-Enter keys do
not submit.

- [x] **Step 2: Implement `shouldSubmitWorkspaceChatKey`**

Export a small predicate and use it from the textarea `onKeyDown` handler to call `handleSend()` only for plain Enter.

### Task 4: Verify

**Files:**

- Verify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx`
- Verify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [x] **Step 1: Run targeted tests**

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: all enterprise lead workspace UI tests pass.

- [x] **Step 2: Run touched-file lint**

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: no ESLint errors or warnings.
