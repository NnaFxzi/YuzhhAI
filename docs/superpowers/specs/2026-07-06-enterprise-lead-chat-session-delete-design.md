# Enterprise Lead Chat Session Delete Design

## Goal

Add a delete action to the Enterprise Lead workspace conversation list shown in the left sidebar. Users can remove stale
or accidental chat sessions without deleting the whole workspace.

## Scope

- Applies only to `enterprise_lead_chat_sessions` in a single workspace.
- Deleting a chat session also deletes its `enterprise_lead_chat_messages`.
- Deleting a workspace keeps its existing cascading cleanup behavior unchanged.
- No archive or undo behavior in this change.

## User Experience

- Each conversation row keeps its current compact title and age layout.
- On hover or keyboard focus, the row reveals a small trash icon button on the right.
- Clicking the trash icon does not select the conversation.
- A confirmation dialog appears before deletion.
- The dialog names the conversation and explains that its messages will be deleted.
- Confirming deletes the conversation. Cancelling closes the dialog with no changes.
- If the active conversation is deleted, the AI chat page remains open and resets to a new conversation state.
- If a non-active conversation is deleted, the current page and active conversation are unchanged.

## Architecture

- Add `DeleteChatSession` to `EnterpriseLeadWorkspaceIpc`.
- Expose `deleteChatSession(workspaceId, sessionId)` through preload and renderer service.
- Add `deleteChatSession(workspaceId, sessionId)` to the Enterprise Lead workspace service.
- Add a store transaction that validates workspace ownership, deletes messages for the session, then deletes the
  session.
- Wire `EnterpriseLeadWorkspaceView` to call the service, update `chatSessions`, and clear `activeChatSessionId` when
  needed.
- Extend `WorkspaceShell` with `onChatSessionDelete` and local confirmation state.

## Error Handling

- Invalid or missing workspace/session IDs return IPC failures.
- A missing session returns `false` instead of deleting anything.
- A session from another workspace returns `false`.
- UI keeps the row visible if deletion fails and shows an inline sidebar error if practical.

## Testing

- Store test: deleting a chat session removes its messages and leaves other sessions/workspaces intact.
- IPC handler test: delete channel validates input and calls the service with workspace and session IDs.
- Renderer static markup test: conversation rows expose a delete action without replacing the existing select behavior.
- Changed TypeScript files should pass the touched-file ESLint command.

