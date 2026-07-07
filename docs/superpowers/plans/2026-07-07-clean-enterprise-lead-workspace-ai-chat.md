# Clean Enterprise Lead Workspace AI Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dedicated `WorkspaceAiChat` experience and its private Enterprise Lead chat persistence/API so the
Enterprise Lead Workspace uses the embedded Cowork chat path only.

**Architecture:** First harden the existing Cowork-only path, then remove the fallback renderer page, then remove the
unused IPC/service/store/shared chat contract. Keep old `enterprise_lead_chat_sessions` and
`enterprise_lead_chat_messages` tables in existing user databases as inert legacy data; do not add a migration that
drops user history.

**Tech Stack:** Electron main/preload IPC, React + Redux Toolkit renderer, TypeScript, SQLite via `better-sqlite3`,
Vitest, ESLint.

## Global Constraints

- Do not reintroduce `yd_cowork`; OpenClaw/Cowork is the only active agent runtime path.
- Do not hardcode new user-visible renderer strings; add both `zh` and `en` entries in `src/renderer/services/i18n.ts`.
- Keep changes scoped to Enterprise Lead Workspace chat cleanup.
- Do not drop old SQLite chat tables; remove runtime creation/use only.
- Touched TypeScript/TSX files must pass
  `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 <files>`.
- Run relevant Vitest coverage for Enterprise Lead Workspace and bridge contracts.

---

## File Structure

- Modify `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`: make the AI Chat page
  Cowork-only and remove all dedicated chat-session fetch/send/delete branches.
- Modify `src/renderer/components/enterpriseLeadWorkspace/WorkspaceShell.tsx`: accept a local conversation-record type
  instead of `EnterpriseLeadWorkspaceChatSessionSummary`.
- Modify `src/renderer/components/enterpriseLeadWorkspace/WorkspaceSearch.tsx`: accept the same local
  conversation-record type for search results.
- Modify `src/renderer/components/enterpriseLeadWorkspace/workspaceCoworkSessionRecords.ts`: define the local
  sidebar/search record type and map Cowork sessions into it.
- Delete `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx`: remove the dedicated React chat surface.
- Delete `src/renderer/components/enterpriseLeadWorkspace/workspaceAiChatProcess.ts`: remove process/suggested-action
  helpers that only support `WorkspaceAiChat`.
- Modify `src/renderer/components/enterpriseLeadWorkspace/index.ts`: stop exporting `WorkspaceAiChat`.
- Modify `src/renderer/services/enterpriseLeadWorkspace.ts`: remove chat-session and chat send/progress bridge wrappers.
- Modify `src/renderer/types/electron.d.ts`: remove Enterprise Lead chat bridge methods and types.
- Modify `src/main/preload.ts`: remove Enterprise Lead chat bridge methods and progress listener wiring.
- Modify `src/shared/enterpriseLeadWorkspace/constants.ts`: remove Enterprise Lead chat IPC constants and progress
  constants.
- Modify `src/shared/enterpriseLeadWorkspace/types.ts`: remove `EnterpriseLeadWorkspaceChat*` types.
- Modify `src/shared/enterpriseLeadWorkspace/validation.ts`: remove `normalizeWorkspaceChatResearchIntent`.
- Modify `src/main/enterpriseLeadWorkspace/ipcHandlers.ts`: remove chat handlers and chat request parsing.
- Modify `src/main/enterpriseLeadWorkspace/service.ts`: remove dedicated chat service methods and private helpers used
  only by them.
- Modify `src/main/enterpriseLeadWorkspace/promptTemplates.ts`: remove `buildWorkspaceChat*` prompts and
  `WorkspaceChat*` prompt context types only used by dedicated chat.
- Modify `src/main/enterpriseLeadWorkspace/store.ts`: remove dedicated chat table creation, chat migrations, chat row
  mapping, chat CRUD methods, and chat-table cleanup from workspace deletion.
- Modify tests under `src/renderer/components/enterpriseLeadWorkspace/`, `src/renderer/services/`,
  `src/main/enterpriseLeadWorkspace/`, and `src/shared/enterpriseLeadWorkspace/` to match the removed contract.
- Modify `src/renderer/services/i18n.ts`: remove `enterpriseLeadAiChat*` keys after replacing any surviving fallback
  title key.

---

### Task 1: Lock AI Chat To Embedded Cowork

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/workspaceCoworkHandoff.test.ts`
- Test: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

**Interfaces:**
- Consumes: `onPrepareCoworkChat(draft: string): void` from `EnterpriseLeadWorkspaceViewProps`.
- Produces: `EnterpriseLeadWorkspaceView` always renders `CoworkView` for `EnterpriseLeadWorkspaceInternalPage.AiChat`.

- [ ] **Step 1: Write failing renderer test for Cowork-only AI Chat**

Add or update a test in `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts` that renders
`EnterpriseLeadWorkspaceView` with `onPrepareCoworkChat` and asserts the dedicated service chat session methods are not
called when a workspace opens.

Use this assertion shape:

```ts
expect(enterpriseLeadWorkspaceService.listChatSessions).not.toHaveBeenCalled();
expect(enterpriseLeadWorkspaceService.getChatSession).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run the focused test and verify it fails before implementation**

Run:

```bash
npm test -- enterpriseLeadWorkspaceUi
```

Expected: FAIL if the test still observes dedicated chat-session loading.

- [ ] **Step 3: Remove dedicated chat fallback from `EnterpriseLeadWorkspaceView`**

In `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`:

- Remove `EnterpriseLeadWorkspaceChatSessionSummary` import.
- Remove `WorkspaceAiChat` import.
- Make `onPrepareCoworkChat` required in `EnterpriseLeadWorkspaceViewProps`.
- Remove `chatSessions`, `chatSessionsRequestRef`, and `refreshChatSessions`.
- In the `activeWorkspaceId` effect, always call `void coworkService.loadSessions();`.
- In `handleInternalPageChange`, always call `prepareEmbeddedCoworkChat(workspaceForCowork)` when the target page is
  `AiChat`.
- In `renderWorkspaceInternalPage`, always return `CoworkView` for `AiChat`.
- In `handleChatSessionDelete`, always call `coworkService.deleteSession(sessionId)`.

The final AI Chat branch should have this shape:

```tsx
if (page === EnterpriseLeadWorkspaceInternalPage.AiChat) {
  return (
    <CoworkView
      onRequestAppSettings={onRequestAppSettings}
      onShowSkills={onShowSkills}
      onShowKits={onShowKits}
      isSidebarCollapsed={false}
      onNewChat={() => prepareEmbeddedCoworkChat(workspace)}
    />
  );
}
```

- [ ] **Step 4: Run focused test and verify it passes**

Run:

```bash
npm test -- enterpriseLeadWorkspaceUi
```

Expected: PASS for the Cowork-only AI Chat behavior and existing navigation tests.

- [ ] **Step 5: Commit checkpoint**

```bash
git add src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
git commit -m "refactor(enterprise-lead): route workspace chat through cowork"
```

---

### Task 2: Replace Dedicated Chat Session Types In Renderer UI

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/workspaceCoworkSessionRecords.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/workspaceCoworkSessionRecords.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceShell.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceSearch.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Modify: `src/renderer/services/i18n.ts`

**Interfaces:**
- Produces:

```ts
export interface WorkspaceConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export const mapCoworkSessionsToWorkspaceConversationRecords = (
  sessions: CoworkSessionSummary[],
): WorkspaceConversationRecord[];
```

- Consumes: `CoworkSessionSummary[]` from Redux state.

- [ ] **Step 1: Write failing tests for the new local record type**

Update `src/renderer/components/enterpriseLeadWorkspace/workspaceCoworkSessionRecords.test.ts`:

```ts
import {
  mapCoworkSessionsToWorkspaceConversationRecords,
  type WorkspaceConversationRecord,
} from './workspaceCoworkSessionRecords';

test('maps Cowork sessions into local workspace conversation records', () => {
  const records: WorkspaceConversationRecord[] = mapCoworkSessionsToWorkspaceConversationRecords([
    createCoworkSession(),
  ]);

  expect(records).toEqual([
    {
      id: 'cowork-session-1',
      title: 'Cowork 获客对话',
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:01:00.000Z',
      messageCount: 0,
    },
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- workspaceCoworkSessionRecords
```

Expected: FAIL because `mapCoworkSessionsToWorkspaceConversationRecords` does not exist yet.

- [ ] **Step 3: Implement the local record type and mapper**

Replace the old export in `src/renderer/components/enterpriseLeadWorkspace/workspaceCoworkSessionRecords.ts` with:

```ts
import { i18nService } from '../../services/i18n';
import type { CoworkSessionSummary } from '../../types/cowork';

export interface WorkspaceConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export const mapCoworkSessionsToWorkspaceConversationRecords = (
  sessions: CoworkSessionSummary[],
): WorkspaceConversationRecord[] =>
  sessions.map(session => ({
    id: session.id,
    title: session.title.trim() || i18nService.t('enterpriseLeadWorkspaceConversationUntitled'),
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.updatedAt).toISOString(),
    messageCount: 0,
  }));
```

- [ ] **Step 4: Replace shared chat session type imports in renderer components**

In `WorkspaceShell.tsx` and `WorkspaceSearch.tsx`, replace `EnterpriseLeadWorkspaceChatSessionSummary` with
`WorkspaceConversationRecord`.

In `EnterpriseLeadWorkspaceView.tsx`, replace:

```ts
mapCoworkSessionsToEnterpriseLeadChatSessionSummaries(coworkSessions, activeWorkspaceId)
```

with:

```ts
mapCoworkSessionsToWorkspaceConversationRecords(coworkSessions)
```

- [ ] **Step 5: Add replacement i18n key**

In `src/renderer/services/i18n.ts`, add both translations:

```ts
enterpriseLeadWorkspaceConversationUntitled: '新对话',
```

and:

```ts
enterpriseLeadWorkspaceConversationUntitled: 'New chat',
```

Then replace remaining renderer references to `enterpriseLeadAiChatUntitledSession` with
`enterpriseLeadWorkspaceConversationUntitled`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- workspaceCoworkSessionRecords enterpriseLeadWorkspaceUi
```

Expected: PASS.

- [ ] **Step 7: Commit checkpoint**

```bash
git add src/renderer/components/enterpriseLeadWorkspace/workspaceCoworkSessionRecords.ts src/renderer/components/enterpriseLeadWorkspace/workspaceCoworkSessionRecords.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceShell.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceSearch.tsx src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/services/i18n.ts
git commit -m "refactor(enterprise-lead): use cowork conversation records"
```

---

### Task 3: Delete Dedicated WorkspaceAiChat Renderer Surface

**Files:**
- Delete: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx`
- Delete: `src/renderer/components/enterpriseLeadWorkspace/workspaceAiChatProcess.ts`
- Delete: `src/renderer/components/enterpriseLeadWorkspace/workspaceAiChatProcess.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/index.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Modify: `src/renderer/services/i18n.ts`

**Interfaces:**

- Removes: `WorkspaceAiChat`, `WorkspaceAiChatMessageRow`, `WorkspaceAiChatPendingRow`, `WorkspaceAiChatAgentPicker`,
  `WorkspaceAiChatAdjustmentDrawer`, `deriveWorkspaceAiChatProcess`, and all `buildWorkspaceAiChat*` helpers.
- Produces: No renderer imports from `./WorkspaceAiChat` or `./workspaceAiChatProcess`.

- [ ] **Step 1: Confirm all dedicated renderer imports**

Run:

```bash
rg -n "WorkspaceAiChat|workspaceAiChatProcess|enterpriseLeadAiChat" src/renderer/components/enterpriseLeadWorkspace src/renderer/services/i18n.ts
```

Expected: Matches in the files listed for this task.

- [ ] **Step 2: Remove tests that exercise deleted components/helpers**

In `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`, remove imports from
`./WorkspaceAiChat` and delete test blocks that render or assert:

- `WorkspaceAiChat`
- `WorkspaceAiChatMessageRow`
- `WorkspaceAiChatPendingRow`
- `WorkspaceAiChatAgentPicker`
- `WorkspaceAiChatAdjustmentDrawer`
- `buildWorkspaceAiChatRetryDraft`
- `buildWorkspaceAiChatOutputPreferenceInstructions`
- `buildWorkspaceAiChatAgentHabitPrompt`
- `buildWorkspaceAiChatAgentHabitBindings`
- `getWorkspaceAiChatExecutionHabitSummaries`
- `getWorkspaceAiChatTypewriterText`
- `isWorkspaceAiChatRequestCurrent`

- [ ] **Step 3: Delete renderer files and exports**

Remove the export from `src/renderer/components/enterpriseLeadWorkspace/index.ts`:

```ts
export { WorkspaceAiChat } from './WorkspaceAiChat';
```

Delete these files:

```text
src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx
src/renderer/components/enterpriseLeadWorkspace/workspaceAiChatProcess.ts
src/renderer/components/enterpriseLeadWorkspace/workspaceAiChatProcess.test.ts
```

- [ ] **Step 4: Remove obsolete i18n keys**

In `src/renderer/services/i18n.ts`, delete `enterpriseLeadAiChat*` keys after Task 2 has replaced
`enterpriseLeadAiChatUntitledSession`.

Run this check:

```bash
rg -n "enterpriseLeadAiChat" src/renderer src/shared src/main
```

Expected: no matches.

- [ ] **Step 5: Run focused renderer tests**

Run:

```bash
npm test -- enterpriseLeadWorkspaceUi workspaceCoworkSessionRecords workspaceCoworkHandoff
```

Expected: PASS.

- [ ] **Step 6: Commit checkpoint**

```bash
git add src/renderer/components/enterpriseLeadWorkspace src/renderer/services/i18n.ts
git commit -m "refactor(enterprise-lead): remove dedicated workspace chat ui"
```

---

### Task 4: Remove Renderer Bridge Contract For Dedicated Chat

**Files:**
- Modify: `src/renderer/services/enterpriseLeadWorkspace.ts`
- Modify: `src/renderer/services/enterpriseLeadWorkspace.test.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Modify: `src/main/preload.ts`

**Interfaces:**
- Removes renderer API methods:

```ts
listChatSessions(workspaceId: string)
getChatSession(workspaceId: string, sessionId: string)
deleteChatSession(workspaceId: string, sessionId: string)
chat(workspaceId: string, request: EnterpriseLeadWorkspaceChatRequest)
onChatProgress(requestId: string, callback: ...)
```

- [ ] **Step 1: Remove bridge tests first**

In `src/renderer/services/enterpriseLeadWorkspace.test.ts`, delete tests named:

- `lists workspace chat sessions through bridge`
- `loads a workspace chat session through bridge`
- `deletes a workspace chat session through bridge`
- `sends workspace chat messages through bridge`
- `subscribes to workspace chat progress through bridge`

- [ ] **Step 2: Run test and verify compile failure points at old exports**

Run:

```bash
npm test -- enterpriseLeadWorkspaceService
```

Expected: FAIL if old imports/exports are still referenced by the test build.

- [ ] **Step 3: Remove service functions and type imports**

In `src/renderer/services/enterpriseLeadWorkspace.ts`, remove imports for:

```ts
EnterpriseLeadWorkspaceChatProgressEvent
EnterpriseLeadWorkspaceChatRequest
EnterpriseLeadWorkspaceChatResponse
EnterpriseLeadWorkspaceChatSession
EnterpriseLeadWorkspaceChatSessionSummary
```

Remove function exports:

```ts
listChatSessions
getChatSession
deleteChatSession
chat
onChatProgress
```

Also remove them from the exported `enterpriseLeadWorkspaceService` object.

- [ ] **Step 4: Remove preload bridge methods**

In `src/main/preload.ts`, remove chat type imports and remove these properties from `enterpriseLeadWorkspace`:

```ts
listChatSessions
getChatSession
deleteChatSession
chat
onChatProgress
```

- [ ] **Step 5: Remove electron.d.ts bridge methods**

In `src/renderer/types/electron.d.ts`, remove chat type imports and remove the same five methods from
`enterpriseLeadWorkspace`.

- [ ] **Step 6: Run focused service tests**

Run:

```bash
npm test -- enterpriseLeadWorkspaceService
```

Expected: PASS.

- [ ] **Step 7: Commit checkpoint**

```bash
git add src/renderer/services/enterpriseLeadWorkspace.ts src/renderer/services/enterpriseLeadWorkspace.test.ts src/renderer/types/electron.d.ts src/main/preload.ts
git commit -m "refactor(enterprise-lead): remove workspace chat bridge"
```

---

### Task 5: Remove Main IPC Chat Handlers And Shared IPC Constants

**Files:**
- Modify: `src/main/enterpriseLeadWorkspace/ipcHandlers.ts`
- Modify: `src/main/enterpriseLeadWorkspace/ipcHandlers.test.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/constants.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/types.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/validation.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/validation.test.ts`

**Interfaces:**
- Removes IPC constants:

```ts
ListChatSessions
GetChatSession
DeleteChatSession
Chat
ChatProgress
```

- Removes shared types:

```ts
EnterpriseLeadWorkspaceChatMessage
EnterpriseLeadWorkspaceChatProgressEvent
EnterpriseLeadWorkspaceChatAgentAttribution
EnterpriseLeadWorkspaceChatRouting
EnterpriseLeadWorkspaceChatRouteStep
EnterpriseLeadWorkspaceChatSessionSummary
EnterpriseLeadWorkspaceChatSession
EnterpriseLeadWorkspaceChatRequest
EnterpriseLeadWorkspaceChatResearchIntent
EnterpriseLeadWorkspaceChatResearchResult
EnterpriseLeadWorkspaceChatLeadCandidate
EnterpriseLeadWorkspaceChatResponse
```

- [ ] **Step 1: Remove IPC handler tests**

In `src/main/enterpriseLeadWorkspace/ipcHandlers.test.ts`, delete tests and mocks for:

```ts
listChatSessions
getChatSession
deleteChatSession
chat
EnterpriseLeadWorkspaceChatProgressEvent
EnterpriseLeadWorkspaceChatResponse
```

- [ ] **Step 2: Remove validation tests for chat research intent**

In `src/shared/enterpriseLeadWorkspace/validation.test.ts`, delete the `normalizeWorkspaceChatResearchIntent` test
cases.

- [ ] **Step 3: Remove IPC constants and progress constants**

In `src/shared/enterpriseLeadWorkspace/constants.ts`, delete:

```ts
EnterpriseLeadChatProgressPhase
EnterpriseLeadChatProgressStatus
ListChatSessions
GetChatSession
DeleteChatSession
Chat
ChatProgress
```

- [ ] **Step 4: Remove chat shared types and validation function**

In `src/shared/enterpriseLeadWorkspace/types.ts`, delete all `EnterpriseLeadWorkspaceChat*` interfaces/types.

In `src/shared/enterpriseLeadWorkspace/validation.ts`, delete:

```ts
normalizeWorkspaceChatResearchIntent
```

and remove its now-unused type import.

- [ ] **Step 5: Remove IPC handlers and parsers**

In `src/main/enterpriseLeadWorkspace/ipcHandlers.ts`, remove:

- Chat types from imports.
- Chat methods from `EnterpriseLeadWorkspaceHandlerDeps`.
- `readResearchStatus`, `readResearchProvider`, `readResearchResult`, `readRecentChatMessages`, and `readChatRequest` if
  no longer used.
- The `ipcMain.handle(EnterpriseLeadWorkspaceIpc.Chat, ...)` block.
- The `ListChatSessions`, `GetChatSession`, and `DeleteChatSession` handler blocks.

- [ ] **Step 6: Run focused IPC and validation tests**

Run:

```bash
npm test -- enterpriseLeadWorkspace/ipcHandlers validation
```

Expected: PASS.

- [ ] **Step 7: Commit checkpoint**

```bash
git add src/main/enterpriseLeadWorkspace/ipcHandlers.ts src/main/enterpriseLeadWorkspace/ipcHandlers.test.ts src/shared/enterpriseLeadWorkspace/constants.ts src/shared/enterpriseLeadWorkspace/types.ts src/shared/enterpriseLeadWorkspace/validation.ts src/shared/enterpriseLeadWorkspace/validation.test.ts
git commit -m "refactor(enterprise-lead): remove workspace chat ipc contract"
```

---

### Task 6: Remove Main Service Chat Implementation And Prompt Templates

**Files:**
- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.test.ts`
- Modify: `src/main/enterpriseLeadWorkspace/promptTemplates.ts`

**Interfaces:**
- Removes service methods:

```ts
listChatSessions(workspaceId: string)
getChatSession(workspaceId: string, sessionId: string)
deleteChatSession(workspaceId: string, sessionId: string)
chat(workspaceId: string, request: EnterpriseLeadWorkspaceChatRequest, progressSink?: ...)
```

- Keeps service methods:

```ts
testWorkspaceAgent(workspaceId, request)
createRun(workspaceId, userGoal)
runWorkflow(workspaceId, runId)
runTask(taskId)
createPendingVersionFromChat(taskId, userMessage)
```

- [ ] **Step 1: Remove service tests for dedicated chat**

In `src/main/enterpriseLeadWorkspace/service.test.ts`, delete test cases that call:

```ts
setup.service.chat(...)
setup.service.listChatSessions(...)
setup.service.getChatSession(...)
setup.service.deleteChatSession(...)
```

Keep tests for `testWorkspaceAgent`, `runTask`, `runWorkflow`, pending versions, archives, content platform settings,
and workspace CRUD.

- [ ] **Step 2: Run service tests and verify failures identify remaining chat code**

Run:

```bash
npm test -- enterpriseLeadWorkspace/service
```

Expected: FAIL until chat imports/types/helpers are removed.

- [ ] **Step 3: Remove chat prompt exports**

In `src/main/enterpriseLeadWorkspace/promptTemplates.ts`, remove exports and input interfaces for:

```ts
WorkspaceChatAgentPromptSummary
WorkspaceChatLeadContext
WorkspaceChatIndustryContext
WorkspaceChatContentKnowledgeContext
buildWorkspaceChatResearchIntentPrompt
buildWorkspaceChatAgentStepPrompt
buildWorkspaceChatResponsePrompt
```

Run:

```bash
rg -n "buildWorkspaceChat|WorkspaceChat" src/main/enterpriseLeadWorkspace/promptTemplates.ts
```

Expected: no matches.

- [ ] **Step 4: Remove service chat imports, methods, and private helpers**

In `src/main/enterpriseLeadWorkspace/service.ts`, remove imports for deleted chat constants, chat types, and
`buildWorkspaceChat*` prompts.

Remove the public chat methods listed in this task.

Remove private helpers that only support the deleted `chat()` path, including:

```ts
sanitizeRecentMessages
sanitizeRecentResearch
sanitizeResearchForPrompt
summarizeResearchPayloadForPrompt
redactWorkspaceResearchText
runWorkspaceChatAgentSteps
parseChatPlanningResult
resolveEffectiveChatResearchIntent
resolveAutoExternalSearchResearchIntent
shouldAutoSearchForLeadOpportunity
buildLeadOpportunitySearchQuery
resolveChatAgentRoute
resolvePlannedTargetAgent
resolveAutoRoute
findAutoRouteAgents
normalizeAutoRouteText
withResearchAgentRoute
resolveResearchAgentAttribution
toChatRouting
resolveShortcutChatAnswer
hasConcreteWorkspaceLeadContext
hasConcreteResearchLeadCandidates
isOpportunityRadarAgent
isCustomerPriorityReferenceRequest
isRiskReviewAgent
isRiskReviewMissingCopyRequest
executeResearch
executeSearchResearch
executeExtractResearch
executeDomesticStatusResearch
executeDomesticSearchResearch
failedResearch
withResearchTimeout
```

After removal, run:

```bash
rg -n "WorkspaceChat|EnterpriseLeadWorkspaceChat|EnterpriseLeadChatProgress|buildWorkspaceChat|normalizeWorkspaceChatResearchIntent" src/main/enterpriseLeadWorkspace/service.ts src/main/enterpriseLeadWorkspace/promptTemplates.ts
```

Expected: no matches.

- [ ] **Step 5: Run service tests**

Run:

```bash
npm test -- enterpriseLeadWorkspace/service
```

Expected: PASS.

- [ ] **Step 6: Commit checkpoint**

```bash
git add src/main/enterpriseLeadWorkspace/service.ts src/main/enterpriseLeadWorkspace/service.test.ts src/main/enterpriseLeadWorkspace/promptTemplates.ts
git commit -m "refactor(enterprise-lead): remove dedicated chat service"
```

---

### Task 7: Remove Dedicated Chat Tables From Store Runtime

**Files:**
- Modify: `src/main/enterpriseLeadWorkspace/store.ts`
- Modify: `src/main/enterpriseLeadWorkspace/store.test.ts`

**Interfaces:**
- Removes store methods:

```ts
createChatSession(input)
listChatSessions(workspaceId)
getChatSession(workspaceId, sessionId)
deleteChatSession(workspaceId, sessionId)
appendChatMessage(sessionId, message)
```

- Keeps old user database tables untouched if they already exist.
- New databases no longer create `enterprise_lead_chat_sessions` or `enterprise_lead_chat_messages`.

- [ ] **Step 1: Remove store tests for chat persistence**

In `src/main/enterpriseLeadWorkspace/store.test.ts`, remove tests that call:

```ts
store.createChatSession(...)
store.listChatSessions(...)
store.getChatSession(...)
store.deleteChatSession(...)
store.appendChatMessage(...)
```

Remove `enterprise_lead_chat_sessions` and `enterprise_lead_chat_messages` from the `EnterpriseLeadWorkspaceTable` test
union.

- [ ] **Step 2: Run store tests and verify failures point at store chat code**

Run:

```bash
npm test -- enterpriseLeadWorkspace/store
```

Expected: FAIL until store methods/types/table creation are removed.

- [ ] **Step 3: Remove chat table runtime creation and migrations**

In `src/main/enterpriseLeadWorkspace/store.ts`, remove:

- `EnterpriseLeadChatSessionRow`
- `EnterpriseLeadChatMessageRow`
- `mapChatMessageRow`
- `CREATE TABLE IF NOT EXISTS enterprise_lead_chat_sessions`
- `CREATE TABLE IF NOT EXISTS enterprise_lead_chat_messages`
- `idx_enterprise_lead_chat_sessions_workspace_updated`
- `idx_enterprise_lead_chat_messages_session_sequence`
- `ensureChatMessageAgentColumn`
- `ensureChatMessageRoutingColumn`
- `ensureChatMessageProgressEventsColumn`
- Calls to the three `ensureChatMessage*` methods from constructor/setup.

- [ ] **Step 4: Remove chat CRUD methods and workspace-delete cleanup**

In `deleteWorkspace(workspaceId)`, remove SQL statements that delete from:

```sql
enterprise_lead_chat_messages
enterprise_lead_chat_sessions
```

Then delete store methods:

```ts
createChatSession
listChatSessions
getChatSession
deleteChatSession
appendChatMessage
```

- [ ] **Step 5: Run store tests**

Run:

```bash
npm test -- enterpriseLeadWorkspace/store
```

Expected: PASS.

- [ ] **Step 6: Commit checkpoint**

```bash
git add src/main/enterpriseLeadWorkspace/store.ts src/main/enterpriseLeadWorkspace/store.test.ts
git commit -m "refactor(enterprise-lead): stop creating workspace chat tables"
```

---

### Task 8: Final Reference Sweep, Lint, And Build Verification

**Files:**
- Verify all touched files from Tasks 1-7.

**Interfaces:**

- Produces: no runtime source references to the dedicated Enterprise Lead chat surface, bridge, IPC, service, shared
  types, or tables.

- [ ] **Step 1: Run zero-reference sweep**

Run:

```bash
rg -n "WorkspaceAiChat|workspaceAiChatProcess|EnterpriseLeadWorkspaceChat|EnterpriseLeadChatProgress|enterprise_lead_chat|enterpriseLeadWorkspace:chat|enterpriseLeadAiChat|normalizeWorkspaceChatResearchIntent|buildWorkspaceChat" src
```

Expected: no matches.

- [ ] **Step 2: Run Enterprise Lead test set**

Run:

```bash
npm test -- enterpriseLeadWorkspace
```

Expected: PASS.

- [ ] **Step 3: Run shared validation and bridge tests**

Run:

```bash
npm test -- validation enterpriseLeadWorkspaceService
```

Expected: PASS.

- [ ] **Step 4: Run Electron TypeScript compile**

Run:

```bash
npm run compile:electron
```

Expected: PASS.

- [ ] **Step 5: Run changed-file ESLint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceShell.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceSearch.tsx src/renderer/components/enterpriseLeadWorkspace/workspaceCoworkSessionRecords.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/components/enterpriseLeadWorkspace/workspaceCoworkSessionRecords.test.ts src/renderer/services/enterpriseLeadWorkspace.ts src/renderer/services/enterpriseLeadWorkspace.test.ts src/renderer/types/electron.d.ts src/main/preload.ts src/shared/enterpriseLeadWorkspace/constants.ts src/shared/enterpriseLeadWorkspace/types.ts src/shared/enterpriseLeadWorkspace/validation.ts src/shared/enterpriseLeadWorkspace/validation.test.ts src/main/enterpriseLeadWorkspace/ipcHandlers.ts src/main/enterpriseLeadWorkspace/ipcHandlers.test.ts src/main/enterpriseLeadWorkspace/service.ts src/main/enterpriseLeadWorkspace/service.test.ts src/main/enterpriseLeadWorkspace/promptTemplates.ts src/main/enterpriseLeadWorkspace/store.ts src/main/enterpriseLeadWorkspace/store.test.ts
```

Expected: PASS with zero warnings.

- [ ] **Step 6: Manual Electron smoke test**

Run:

```bash
npm run electron:dev
```

Smoke-test these flows:

- Open Enterprise Lead Workspace.
- Open an existing workspace.
- Click `新对话` / `New chat`.
- Confirm the embedded Cowork chat view appears.
- Confirm starting a new chat still focuses the Cowork composer.
- Confirm deleting a conversation record deletes the Cowork session and does not call Enterprise Lead chat IPC.
- Delete a workspace and confirm no SQLite error occurs from missing `enterprise_lead_chat_*` tables.

Expected: all flows work without renderer console errors or main-process SQL errors.

- [ ] **Step 7: Final commit**

```bash
git add src docs/superpowers/plans/2026-07-07-clean-enterprise-lead-workspace-ai-chat.md
git commit -m "refactor(enterprise-lead): remove dedicated workspace ai chat"
```

---

## Self-Review

- Spec coverage: The plan removes the dedicated `WorkspaceAiChat` page, its local state path,
  `enterpriseLeadWorkspaceService.chat`, shared chat types, IPC bridge, service logic, and dedicated SQLite table
  runtime creation.
- Data safety: The plan does not drop existing user tables; it only stops creating and using them.
- Replacement path: The plan relies on the already-present embedded Cowork path and removes the fallback branch that
  kept the old chat alive.
- Risk to watch: Cowork session summaries currently have no persisted Enterprise Lead workspace id. This plan keeps the
  existing Cowork session listing behavior but removes the misleading dependency on
  `EnterpriseLeadWorkspaceChatSessionSummary`. A future enhancement should add real Cowork session-to-workspace metadata
  if per-workspace record filtering is required.
