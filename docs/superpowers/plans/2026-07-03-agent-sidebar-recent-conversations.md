# Agent Sidebar Recent Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global Recent Conversations section above My Agents, include normal and Agent conversations, and stop showing the default main agent in My Agents.

**Architecture:** Reuse existing Cowork session summaries and Agent metadata. Add small pure helpers in the agent sidebar state module for filtering user-created agents and deriving recent conversation rows, then render a focused sidebar section that loads global recent sessions independently from the currently selected agent task list.

**Tech Stack:** React, Redux Toolkit, TypeScript, Vitest, Tailwind.

---

### Task 1: Pure Sidebar Logic

**Files:**
- Modify: `src/renderer/components/agentSidebar/useAgentSidebarState.ts`
- Modify: `src/renderer/components/agentSidebar/useAgentSidebarState.test.ts`

- [ ] Add tests proving the default `main` agent is excluded from My Agents.
- [ ] Add tests proving recent conversations sort globally by updated time and preserve Agent ids for labels.
- [ ] Implement the helper functions required by those tests.

### Task 2: Recent Session Fetching

**Files:**
- Modify: `src/renderer/services/cowork.ts`

- [ ] Add a service method that fetches global recent sessions without replacing the existing Redux session list.
- [ ] Use existing `window.electron.cowork.listSessions` with no `agentId`.

### Task 3: Sidebar UI

**Files:**
- Create: `src/renderer/components/agentSidebar/RecentConversationsSection.tsx`
- Modify: `src/renderer/components/agentSidebar/MyAgentSidebarTree.tsx`
- Modify: `src/renderer/components/agentSidebar/MyAgentSidebarHeader.tsx` if spacing needs adjustment
- Modify: `src/renderer/services/i18n.ts`

- [ ] Render Recent Conversations above My Agents.
- [ ] Include normal and Agent conversations.
- [ ] Show Agent name/icon for custom Agent conversations.
- [ ] Keep ordinary conversations free of “Main Agent” wording.
- [ ] Click opens the session and switches to the session Agent when needed.
- [ ] Add a search button that opens the existing Cowork search modal via event.

### Task 4: Verification

**Files:**
- Touched TypeScript/TSX files only.

- [ ] Run targeted Vitest coverage for agent sidebar logic.
- [ ] Run ESLint on touched TS/TSX files.

