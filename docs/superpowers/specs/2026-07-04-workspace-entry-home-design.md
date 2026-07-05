# Workspace Entry Home Design

## Goal

Make the enterprise lead workspace the default product entry after app startup.
The first visible product screen should no longer be the general chat workbench.
It should be a clean workspace entry home with two choices:

- Create workspace.
- Open historical workspace.

The design keeps the entry simple and preserves the existing enterprise lead
workspace creation, workbench, and history data paths.

## Product Decision

The app should open to the enterprise lead workspace entry home after global app
initialization finishes.

Global flows still take priority:

- Startup loading.
- Initialization error screen.
- Privacy agreement.
- Welcome dialog.
- Settings, update, and permission overlays.

After those flows, the selected main view should be the enterprise lead
workspace view by default.

The app should not auto-open the most recent workspace on launch. Returning
users should still see the same simple entry home and choose whether to create a
new workspace or open an existing one.

## Home Screen

The home screen is intentionally minimal. It should not behave like a broad
feature dashboard.

Visible content:

- Title: `线索工作区`.
- Short supporting line, such as `创建或打开一个业务线索空间`.
- Primary entry card: `创建工作区`.
- Secondary entry card: `打开历史工作区`.

The two cards should be visually balanced. `创建工作区` can have the primary
accent color, but `打开历史工作区` should remain equally clear and easy to select.

The page should not show:

- Recent workspace cards by default.
- Agent details.
- Skill configuration summaries.
- Research/source configuration.
- Run logs.
- Deliverable previews.
- Marketing-style hero content.

## Create Workspace Flow

Clicking `创建工作区` should enter the existing workspace creation flow.

The existing `WorkspaceCreate` behavior remains the creation surface:

- The user can paste business material.
- The user can upload supported text material.
- The system extracts a workspace draft.
- The user confirms the draft.
- Creation success opens the created workspace.

The entry home does not need to duplicate draft extraction controls.

## Historical Workspace Flow

Clicking `打开历史工作区` opens a centered modal.

The modal lists existing enterprise lead workspaces sorted by recent update
time. Each item should show:

- Workspace name.
- Short business summary when available.
- Recent update time.

Selecting a workspace closes the modal and opens that workspace's existing
workbench.

The modal should support these states:

- Loading: show a concise loading state inside the modal.
- Empty: explain that no historical workspaces exist and offer `创建工作区`.
- Error: show a concise failure message and let the user close the modal or
  retry through reopening.

The first version should not add search, filtering, pinning, or grouping. Those
can be added later if users accumulate many workspaces.

## Navigation

The app's global sidebar remains available.

The enterprise lead workspace nav item should be active by default on app open.
The general chat workbench remains available as a secondary sidebar entry. This
change should not remove existing Cowork sessions, scheduled tasks, kits, MCP,
skills, or settings entry points.

Inside the enterprise lead workspace view:

- Entry home is the default screen.
- Create workspace is a child screen.
- Opened workspace is a child screen.
- Returning from a workspace, when implemented, should go back to the entry
  home rather than the old launch page.

## Component Design

Add a small focused renderer component:

```text
WorkspaceEntryHome
```

Responsibilities:

- Render the two entry cards.
- Own the historical workspace modal open/close state.
- Render historical workspace loading, empty, error, and list states.
- Call `onCreate` when the user chooses to create.
- Call `onOpen(workspaceId)` when the user chooses a historical workspace.

`EnterpriseLeadWorkspaceView` should own navigation state:

- Entry home.
- Create.
- Workspace.

It should continue to own workspace loading and active workspace selection.

Existing service calls remain in use:

- `enterpriseLeadWorkspaceService.listWorkspaces()`
- `enterpriseLeadWorkspaceService.getWorkspace(workspaceId)`
- `enterpriseLeadWorkspaceService.createWorkspace(draft)`

No new main-process API or database table is required for this entry change.

## Data Flow

Startup:

```text
App initializes
→ default main view is enterpriseLeadWorkspace
→ EnterpriseLeadWorkspaceView loads workspace summaries
→ WorkspaceEntryHome displays two choices
```

Create:

```text
Create workspace card
→ WorkspaceCreate
→ extract draft
→ confirm create
→ refresh workspace list
→ open created workspace
```

Open history:

```text
Open historical workspace card
→ centered modal
→ select workspace
→ get workspace detail
→ WorkspaceWorkbench
```

## Error Handling

Workspace list loading should not block the entry home from rendering. The home
can show immediately while the history modal handles loading or empty states.

If listing workspaces fails, the modal should show a localized error message.
The home remains usable and the user can still create a workspace.

If opening a selected workspace fails, keep the current existing workspace error
banner behavior.

If a workspace is deleted or unavailable between listing and selection, treat it
as an open failure and show the existing workspace load failure message.

## Internationalization

All user-visible strings must use `i18nService.t()` with both Chinese and
English entries.

Likely new keys:

- `enterpriseLeadEntryTitle`
- `enterpriseLeadEntrySubtitle`
- `enterpriseLeadEntryCreateTitle`
- `enterpriseLeadEntryCreateDesc`
- `enterpriseLeadEntryCreateAction`
- `enterpriseLeadEntryHistoryTitle`
- `enterpriseLeadEntryHistoryDesc`
- `enterpriseLeadEntryHistoryAction`
- `enterpriseLeadHistoryModalTitle`
- `enterpriseLeadHistoryModalDesc`
- `enterpriseLeadHistoryEmptyTitle`
- `enterpriseLeadHistoryEmptyDesc`
- `enterpriseLeadHistoryLoadFailed`

Existing enterprise lead workspace strings may be reused where they match
exactly.

## Testing

Add or update renderer helper coverage for:

- The entry home exposes exactly two primary choices.
- The default enterprise lead workspace screen is entry home, not automatic
  recent workspace open.
- The historical workspace modal supports loading, empty, error, and list
  states through tested helper metadata where practical.
- Workspace summaries are still sorted by recent update before display.

Verification for implementation should include:

- Relevant Vitest tests.
- ESLint for touched TypeScript and TSX files.
- Manual app check with the default startup view when practical.

## Out Of Scope

This design does not include:

- Search inside historical workspace modal.
- Workspace pinning.
- Workspace grouping.
- Deleting or renaming workspaces from the modal.
- A workspace marketplace.
- Changes to enterprise lead workflow execution.
- Changes to Agent cards or the existing workspace workbench.
- Removing the general Cowork workbench.
