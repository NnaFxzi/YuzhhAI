# Workspace AI Chat Lobster Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the original LobsterAI conversation motion language into the enterprise workspace AI chat without
replacing the current workspace-specific chat flow.

**Architecture:** Reuse existing Tailwind animation primitives (`animate-fade-in-up`, `animate-message-in`, focus
shadows, transition/active scale classes) inside `WorkspaceAiChat.tsx`. Keep the current service calls, session
handling, Enter-to-send behavior, Agent selector, research status, and knowledge controls unchanged.

**Tech Stack:** React, TypeScript, Tailwind, Vitest SSR rendering tests.

---

### Task 1: Lock LobsterAI Motion Anchors

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx`

- [x] **Step 1: Add failing tests**

Add assertions that the workspace AI empty state contains LobsterAI-style staggered motion anchors:

```ts
expect(markup).toContain('animate-fade-in-up');
expect(markup).toContain('animation-delay:70ms');
expect(markup).toContain('animation-delay:120ms');
expect(markup).toContain('animation-delay:160ms');
expect(markup).toContain('motion-reduce:animate-none');
expect(markup).toContain('transition-all duration-200 ease-out');
```

Add a pure helper assertion for message rows:

```ts
expect(getWorkspaceAiChatMessageRowClassName(true)).toContain('animate-message-in');
expect(getWorkspaceAiChatMessageRowClassName(false, false)).not.toContain('animate-message-in');
```

- [x] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts -t "motion"
```

Expected before implementation: FAIL because `WorkspaceAiChat` does not yet render the staggered animation classes or
export the message-row class helper.

### Task 2: Implement Motion In Workspace AI Chat

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx`

- [x] **Step 1: Add small motion helpers**

Add:

```ts
export const getWorkspaceAiChatEntranceStyle = (delayMs: number): React.CSSProperties => ({
  animationDelay: `${delayMs}ms`,
  animationFillMode: 'both',
});

export const getWorkspaceAiChatMessageRowClassName = (
  isUser: boolean,
  animate = true,
): string => [
  'flex',
  isUser ? 'justify-end' : 'justify-start',
  animate ? 'animate-message-in motion-reduce:animate-none' : '',
].filter(Boolean).join(' ');
```

- [x] **Step 2: Apply empty-state staged entrance**

Use `animate-fade-in-up motion-reduce:animate-none` on the title, subtitle, and composer wrapper with delays `70ms`,
`120ms`, and `160ms`.

- [x] **Step 3: Apply message entrance**

Use `getWorkspaceAiChatMessageRowClassName()` in `MessageRow`, passing `animate={index === messages.length - 1}` when
rendering message rows.

- [x] **Step 4: Add existing LobsterAI interaction transitions**

Add `transition-all duration-200 ease-out` to the composer card and `duration-150 ease-out active:scale-[0.98]` to the
small controls where appropriate.

### Task 3: Verify

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
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/services/i18n.ts
```

Expected: no ESLint errors or warnings.

- [x] **Step 3: Visually validate in Electron**

Open an existing enterprise workspace, enter “新对话”, and verify the heading/input area enters subtly, the input
focus/controls feel like LobsterAI, and existing conversation rows remain readable.
