# Enterprise Lead Chat Session Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a confirmed delete action for Enterprise Lead workspace chat sessions in the left sidebar.

**Architecture:** Add a narrow delete-chat-session path through shared IPC constants, preload, renderer service, main
IPC handler, domain service, and SQLite store. The renderer owns optimistic sidebar state cleanup after the service
confirms deletion, while the store transaction owns deleting messages before the session row.

**Tech Stack:** Electron IPC, React, TypeScript, SQLite via better-sqlite3, Vitest, Tailwind, Heroicons.

---

## File Structure

- Modify `src/shared/enterpriseLeadWorkspace/constants.ts` to add the IPC channel constant.
- Modify `src/main/enterpriseLeadWorkspace/store.ts` to add `deleteChatSession(workspaceId, sessionId)`.
- Modify `src/main/enterpriseLeadWorkspace/service.ts` to validate workspace existence and call the store.
- Modify `src/main/enterpriseLeadWorkspace/ipcHandlers.ts` to expose the handler.
- Modify `src/main/preload.ts`, `src/renderer/types/electron.d.ts`, and
  `src/renderer/services/enterpriseLeadWorkspace.ts` to expose the renderer API.
- Modify `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx` to call deletion and update
  active chat state.
- Modify `src/renderer/components/enterpriseLeadWorkspace/WorkspaceShell.tsx` to render the delete button and
  confirmation dialog.
- Modify `src/renderer/services/i18n.ts` to add Chinese and English strings.
- Modify tests in `src/main/enterpriseLeadWorkspace/store.test.ts`,
  `src/main/enterpriseLeadWorkspace/ipcHandlers.test.ts`, and
  `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`.

## Task 1: Store Delete Behavior

**Files:**

- Test: `src/main/enterpriseLeadWorkspace/store.test.ts`
- Modify: `src/main/enterpriseLeadWorkspace/store.ts`

- [ ] **Step 1: Write the failing store test**

Add a test that creates two workspaces, creates two chat sessions in the first workspace and one in the second, appends
messages, deletes one session, then asserts only that session and its messages are gone.

```ts
test('deletes one workspace chat session with its messages only', () => {
  setupStore();
  const workspace = store.createWorkspace({
    name: '华南重包获客工作台',
    type: EnterpriseLeadWorkspaceType.EnterpriseLead,
    profile,
    extractionSources: [],
    enabledAgentRoles: [EnterpriseLeadAgentRole.ContentPlanning],
  });
  const otherWorkspace = store.createWorkspace({
    name: '华东精密件获客工作台',
    type: EnterpriseLeadWorkspaceType.EnterpriseLead,
    profile,
    extractionSources: [],
    enabledAgentRoles: [EnterpriseLeadAgentRole.SalesHandoff],
  });
  const deletedSession = store.createChatSession({ workspaceId: workspace.id, title: '删除我' });
  const retainedSession = store.createChatSession({ workspaceId: workspace.id, title: '保留我' });
  const otherSession = store.createChatSession({ workspaceId: otherWorkspace.id, title: '别的空间' });

  store.appendChatMessage(deletedSession.id, {
    id: 'delete-user-1',
    role: 'user',
    content: '删除这条',
    createdAt: '2026-07-04T08:00:00.000Z',
  });
  store.appendChatMessage(retainedSession.id, {
    id: 'retain-user-1',
    role: 'user',
    content: '保留这条',
    createdAt: '2026-07-04T08:01:00.000Z',
  });
  store.appendChatMessage(otherSession.id, {
    id: 'other-user-1',
    role: 'user',
    content: '别的空间消息',
    createdAt: '2026-07-04T08:02:00.000Z',
  });

  expect(store.deleteChatSession(workspace.id, deletedSession.id)).toBe(true);

  expect(store.getChatSession(workspace.id, deletedSession.id)).toBeNull();
  expect(store.getChatSession(workspace.id, retainedSession.id)?.messages).toHaveLength(1);
  expect(store.getChatSession(otherWorkspace.id, otherSession.id)?.messages).toHaveLength(1);
  expect(store.deleteChatSession(otherWorkspace.id, retainedSession.id)).toBe(false);
  expect(readTableCount(db!, 'enterprise_lead_chat_sessions')).toBe(2);
  expect(readTableCount(db!, 'enterprise_lead_chat_messages')).toBe(2);
});
```

- [ ] **Step 2: Run the store test to verify RED**

Run: `npm test -- src/main/enterpriseLeadWorkspace/store.test.ts`

Expected: FAIL because `deleteChatSession` does not exist on `EnterpriseLeadWorkspaceStore`.

- [ ] **Step 3: Implement minimal store deletion**

Add a `deleteChatSession` method to `EnterpriseLeadWorkspaceStore`:

```ts
deleteChatSession(workspaceId: string, sessionId: string): boolean {
  const deleteTransaction = this.db.transaction(() => {
    const session = this.db.prepare(`
      SELECT id
      FROM enterprise_lead_chat_sessions
      WHERE id = ? AND workspace_id = ?
      LIMIT 1
    `).get(sessionId, workspaceId) as { id: string } | undefined;
    if (!session) {
      return false;
    }

    this.db.prepare(`
      DELETE FROM enterprise_lead_chat_messages
      WHERE session_id = ?
    `).run(sessionId);

    const result = this.db.prepare(`
      DELETE FROM enterprise_lead_chat_sessions
      WHERE id = ? AND workspace_id = ?
    `).run(sessionId, workspaceId);

    return result.changes > 0;
  });

  return deleteTransaction();
}
```

- [ ] **Step 4: Run the store test to verify GREEN**

Run: `npm test -- src/main/enterpriseLeadWorkspace/store.test.ts`

Expected: PASS.

## Task 2: Main/Preload/Renderer API

**Files:**

- Test: `src/main/enterpriseLeadWorkspace/ipcHandlers.test.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/constants.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Modify: `src/main/enterpriseLeadWorkspace/ipcHandlers.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Modify: `src/renderer/services/enterpriseLeadWorkspace.ts`

- [ ] **Step 1: Write the failing IPC test**

Update `makeDeps()` to include `deleteChatSession: vi.fn(() => true)`. Add this test:

```ts
test('deletes a workspace chat session through the chat session delete channel', async () => {
  const { deps, service } = makeDeps();
  registerEnterpriseLeadWorkspaceHandlers(deps);

  const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.DeleteChatSession);
  expect(handler).toBeDefined();

  const result = await handler?.(undefined, {
    workspaceId: 'workspace-1',
    sessionId: 'chat-1',
  });

  expect(service.deleteChatSession).toHaveBeenCalledWith('workspace-1', 'chat-1');
  expect(result).toEqual({
    success: true,
    data: true,
  });
});
```

- [ ] **Step 2: Run the IPC test to verify RED**

Run: `npm test -- src/main/enterpriseLeadWorkspace/ipcHandlers.test.ts`

Expected: FAIL because the `DeleteChatSession` constant and service dependency do not exist.

- [ ] **Step 3: Implement the IPC/API path**

Add `DeleteChatSession: 'enterpriseLeadWorkspace:chatSessions:delete'` to `EnterpriseLeadWorkspaceIpc`.

Add `deleteChatSession` to `EnterpriseLeadWorkspaceService`:

```ts
deleteChatSession(workspaceId: string, sessionId: string): boolean {
  const workspace = this.store.getWorkspace(workspaceId);
  if (!workspace) {
    throw new Error('Enterprise lead workspace not found');
  }

  return this.store.deleteChatSession(workspaceId, sessionId);
}
```

Add the handler dependency and `ipcMain.handle(EnterpriseLeadWorkspaceIpc.DeleteChatSession, ...)` with
`requireNonEmptyString` for `workspaceId` and `sessionId`.

Expose `deleteChatSession(workspaceId, sessionId)` in preload, renderer type declarations, and
`enterpriseLeadWorkspaceService` using the existing `requestOrThrow` pattern.

- [ ] **Step 4: Run the IPC test to verify GREEN**

Run: `npm test -- src/main/enterpriseLeadWorkspace/ipcHandlers.test.ts`

Expected: PASS.

## Task 3: Sidebar Delete UI

**Files:**

- Test: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceShell.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Write the failing renderer test**

Extend the existing “renders Codex-style chat history” test or add a nearby test that passes
`onChatSessionDelete: vi.fn()` and asserts the delete action and confirmation labels render in static markup.

```ts
expect(markup).toContain('aria-label="删除对话 安装 oh-my-claudecode skill"');
expect(markup).toContain('enterprise-lead-chat-session-delete');
```

- [ ] **Step 2: Run the renderer test to verify RED**

Run: `npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

Expected: FAIL because `WorkspaceShell` has no delete action.

- [ ] **Step 3: Implement UI and state wiring**

In `WorkspaceShell.tsx`, add `TrashIcon` and `ExclamationTriangleIcon`, local pending/delete state, and an optional
prop:

```ts
onChatSessionDelete?: (sessionId: string) => Promise<boolean>;
```

Render each conversation row as a flex container with the existing select button plus a trash icon button that calls
`event.stopPropagation()` and opens a confirmation dialog. Keep the title and age layout stable; reveal the icon with
`opacity-0 group-hover:opacity-100 focus:opacity-100`.

In `EnterpriseLeadWorkspaceView.tsx`, add:

```ts
const handleChatSessionDelete = useCallback(async (sessionId: string): Promise<boolean> => {
  if (!activeWorkspaceId) {
    return false;
  }
  const deleted = await enterpriseLeadWorkspaceService.deleteChatSession(activeWorkspaceId, sessionId);
  if (!deleted) {
    return false;
  }
  setChatSessions(previous => previous.filter(session => session.id !== sessionId));
  if (activeChatSessionId === sessionId) {
    setActiveChatSessionId(null);
  }
  return true;
}, [activeChatSessionId, activeWorkspaceId]);
```

Pass `onChatSessionDelete={handleChatSessionDelete}` to `WorkspaceShell`.

Add i18n keys in both languages:

```ts
enterpriseLeadWorkspaceDeleteConversation: '删除对话',
enterpriseLeadWorkspaceDeleteConversationAria: '删除对话 {title}',
enterpriseLeadWorkspaceDeleteConversationTitle: '删除「{title}」？',
enterpriseLeadWorkspaceDeleteConversationWarning: '这会永久删除这条对话及其中的消息，不能恢复。',
enterpriseLeadWorkspaceDeleteConversationFailed: '删除对话失败，请稍后重试。',
```

- [ ] **Step 4: Run the renderer test to verify GREEN**

Run: `npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

Expected: PASS.

## Task 4: Integration Verification

**Files:**

- Verify changed files only.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- src/main/enterpriseLeadWorkspace/store.test.ts src/main/enterpriseLeadWorkspace/ipcHandlers.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run touched-file ESLint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/enterpriseLeadWorkspace/constants.ts src/main/enterpriseLeadWorkspace/store.ts src/main/enterpriseLeadWorkspace/service.ts src/main/enterpriseLeadWorkspace/ipcHandlers.ts src/main/preload.ts src/renderer/types/electron.d.ts src/renderer/services/enterpriseLeadWorkspace.ts src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceShell.tsx src/renderer/services/i18n.ts src/main/enterpriseLeadWorkspace/store.test.ts src/main/enterpriseLeadWorkspace/ipcHandlers.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: PASS with zero warnings.

- [ ] **Step 3: Review diff**

Run:
`git diff -- src/shared/enterpriseLeadWorkspace/constants.ts src/main/enterpriseLeadWorkspace/store.ts src/main/enterpriseLeadWorkspace/service.ts src/main/enterpriseLeadWorkspace/ipcHandlers.ts src/main/preload.ts src/renderer/types/electron.d.ts src/renderer/services/enterpriseLeadWorkspace.ts src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceShell.tsx src/renderer/services/i18n.ts src/main/enterpriseLeadWorkspace/store.test.ts src/main/enterpriseLeadWorkspace/ipcHandlers.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts docs/superpowers/specs/2026-07-06-enterprise-lead-chat-session-delete-design.md docs/superpowers/plans/2026-07-06-enterprise-lead-chat-session-delete.md`

Expected: Only chat-session deletion and spec/plan changes appear.

## Notes

- Do not commit in this repository until the user tests and confirms.
- Do not run broad lint cleanup; this repository has known legacy lint debt.

