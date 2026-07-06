# Workspace Agent Scope Design

## Summary

LobsterAI will separate Agent concepts into system-owned global templates and workspace-owned Agent instances.

System global Agents are built in by the product and are available to every workspace as read-only templates. Users
cannot create new global Agents. Users create Agents only inside a workspace, and those workspace Agents are private to
the workspace that owns them.

This design resolves the current ambiguity where workspace Agent management looks like global Agent creation even though
runtime execution already works from workspace-local bindings and snapshots.

## Goals

- Make global Agent scope system-owned only.
- Allow users to create and manage Agents inside a workspace.
- Prevent workspace-created Agents from being visible or usable in other workspaces.
- Preserve historical run behavior through immutable Agent snapshots.
- Keep system templates reusable without allowing direct mutation of the system source.
- Replace free-form model and skill text fields with validated selectors.
- Make save failures explicit enough that users know which part was persisted.

## Non-Goals

- This change does not introduce user-created global Agents.
- This change does not automatically share workspace-created Agents across workspaces.
- This change does not delete existing legacy custom Agent records.
- This change does not require changing OpenClaw's runtime format for Cowork sessions.

## Terminology

### System Global Agent

A system-owned template shipped by LobsterAI. It is globally visible and read-only. Examples include product planning,
content planning, risk review, and sales handoff templates.

### Workspace Agent

A workspace-owned execution Agent. It belongs to exactly one workspace. It may be created from scratch by the user or
copied from a system global Agent template.

### Agent Snapshot

The immutable Agent data captured when a run or task is created. Snapshots make historical runs stable even if the
workspace Agent is edited later.

## Product Rules

1. Global Agents are system built in only.
2. Users cannot create global Agents.
3. Users can create Agents only inside a workspace.
4. Workspace-created Agents cannot be seen, selected, or executed by other workspaces.
5. System global Agents can be added to any workspace, but adding one creates a workspace-local instance.
6. Users edit only workspace-local instances.
7. Disabling a workspace Agent hides it from execution but keeps it visible in workspace management.
8. Deleting a workspace Agent removes it from future execution but does not mutate historical snapshots.
9. Running tasks always use the current workspace's enabled Agent instances.
10. Historical task records always use their captured Agent snapshot.

## Recommended Data Model

Add explicit source metadata to workspace Agent bindings.

```ts
export const WorkspaceAgentSource = {
  SystemTemplate: 'system_template',
  WorkspaceCreated: 'workspace_created',
} as const;

export type WorkspaceAgentSource =
  typeof WorkspaceAgentSource[keyof typeof WorkspaceAgentSource];

export interface EnterpriseLeadWorkspaceAgentBinding {
  agentId: string;
  enabled: boolean;
  order: number;
  source: WorkspaceAgentSource;
  templateId?: string;
  overrides: EnterpriseLeadWorkspaceAgentOverrides;
}
```

Rules:

- `agentId` is unique only inside a workspace.
- `source: system_template` means the binding was created from a system template.
- `templateId` stores the source system template id for system-derived bindings.
- `source: workspace_created` means the binding was created directly in the workspace.
- `overrides` stores editable workspace-local values.
- System templates remain separate from workspace bindings.

## System Template Library

System global Agents should be exposed through a system template registry, not by treating user-customizable rows as
global Agents.

The initial implementation can use the existing enterprise lead workflow role definitions as the system template source.
A follow-up can move those definitions to a dedicated module if the list grows.

Template fields:

```ts
interface SystemAgentTemplate {
  id: string;
  name: string;
  description: string;
  identity: string;
  systemPrompt: string;
  icon: string;
  defaultSkillIds: string[];
  defaultModel?: string;
}
```

System templates are read-only in UI. The workspace may copy a template into `workspaceAgents`; after that, edits apply
only to the workspace-local instance.

## Data Migration

### Existing `workspaceAgents`

When loading or normalizing existing workspace Agent bindings:

- Preserve `agentId`, `enabled`, `order`, and `overrides`.
- If `source` is missing and `agentId` matches a system template id:
  - Set `source` to `system_template`.
  - Set `templateId` to `agentId`.
- If `source` is missing and `agentId` does not match a system template id:
  - Set `source` to `workspace_created`.
- Trim blank `templateId` values.
- Preserve unknown but valid custom `agentId` strings as workspace-created Agents.

### Legacy `enabledAgentRoles`

`enabledAgentRoles` remains a fallback only when `workspaceAgents` is empty.

When fallback creates workspace Agent bindings:

- Each generated binding uses `source: system_template`.
- Each generated binding uses `templateId` equal to the role id.
- The generated bindings become the runtime source for that workspace.

### Existing Legacy Global Custom Agents

Existing user-created global custom Agent records must not be deleted by this change.

They are not treated as system global Agents. They are not automatically exposed to every workspace. If the product
needs to preserve access, provide an explicit "copy legacy Agent into this workspace" action that creates a
`workspace_created` binding in the selected workspace.

This avoids accidental cross-workspace sharing.

## UI Design

### Workspace Agent Management Page

The workspace Agent management page has two sections.

#### System Agents

Shows built-in system templates.

Capabilities:

- Preview template name, description, icon, default model, and default skills.
- Add a template to the current workspace.
- Disable the add button when the current workspace already has an instance from that template, unless duplicates are
  intentionally allowed later.

Labeling:

- "System Agent"
- "Add to this workspace"
- "Read-only template"

#### This Workspace Agents

Shows workspace-local Agent instances.

Capabilities:

- Create workspace Agent.
- Edit workspace Agent.
- Enable or disable workspace Agent.
- Delete workspace Agent.
- Reorder workspace Agents.
- Filter by all, enabled, disabled.
- Show source badge: "From system template" or "Created in this workspace".

Labeling:

- "This workspace Agents"
- "Only available in this workspace"
- "Enabled Agents run in workspace workflows"

### Creation Paths

The workspace page has two explicit creation paths:

1. "Add system Agent"
  - Creates a workspace-local binding with `source: system_template`.
  - Copies template defaults into overrides only where needed for display or customization.

2. "New workspace Agent"
  - Creates a workspace-local binding with `source: workspace_created`.
  - Requires a name.
  - Does not create or modify global Agent records.

### Editor Controls

The workspace Agent editor must not use raw model or skill text boxes.

Model:

- Use the existing model selector pattern.
- Store the selected value as a provider-qualified model ref.
- Show validation if the previously saved model no longer exists.

Skills:

- Use the existing Agent skill selector pattern.
- Store selected `skillIds` as an array.
- Show disabled or missing selected skills as warnings.

## Runtime Resolution

Workflow execution resolves Agents from the current workspace only.

Resolution steps:

1. Read `workspace.workspaceAgents`.
2. If it is empty, build fallback system-template bindings from `enabledAgentRoles`.
3. Filter bindings where `enabled === true`.
4. Sort by `order`.
5. Convert each binding into an effective Agent:
  - For `system_template`, read template defaults and apply overrides.
  - For `workspace_created`, use workspace-local overrides.
6. Create tasks using the effective Agents.
7. Store `agentSnapshot` on each task.

No runtime path should query workspace-created Agents from another workspace.

## Save Failure Handling

Workspace Agent saves should be as close to atomic as the current store supports. A workspace Agent update should write
the normalized `workspaceAgents` array in one workspace update call.

The UI should report structured save results:

```ts
export interface WorkspaceAgentSaveResult {
  success: boolean;
  steps: {
    validation: 'success' | 'failed' | 'skipped';
    workspaceAgents: 'success' | 'failed' | 'skipped';
    runtimePreview: 'success' | 'failed' | 'skipped';
  };
  error?: string;
}
```

Rules:

- Validation happens before persistence.
- Invalid model refs block save.
- Missing skill ids block save when they were just selected in the current editor.
- Legacy missing skill ids already stored in an Agent should be shown as warnings and can be removed by saving.
- Failed saves keep the editor open and preserve the draft.
- Delete and disable are separate actions.
- Adding a system template either creates a full workspace-local binding or creates nothing.

## Validation Rules

Validate before saving:

- `name` must be non-empty for workspace-created Agents.
- `agentId` must be unique inside the workspace.
- `source` must be one of `system_template` or `workspace_created`.
- `templateId` must exist when `source` is `system_template`.
- `templateId` must refer to a known system template.
- `model` must resolve to an available model when set through the editor.
- `skillIds` must refer to installed, enabled skills when selected through the editor.

## Testing Requirements

### Shared Validation Tests

- Normalizes missing `source` on old `workspaceAgents`.
- Marks known system ids as `system_template`.
- Marks unknown ids as `workspace_created`.
- Keeps workspace-created Agent ids private to their workspace.
- Builds fallback bindings from `enabledAgentRoles` only when `workspaceAgents` is empty.
- Preserves `templateId` for system-template bindings.

### Store Tests

- Persists `source` and `templateId` in `workspace_agents`.
- Round trips workspace-created Agents.
- Round trips system-template Agents.
- Does not leak workspace A Agents into workspace B.

### Service Tests

- Executes only enabled workspace Agents.
- Resolves system-template defaults plus overrides.
- Resolves workspace-created Agents from local overrides.
- Captures immutable `agentSnapshot` on run creation.
- Editing a workspace Agent after run creation does not mutate existing snapshots.

### UI Tests

- System Agent section renders read-only templates.
- Adding a system template creates a workspace-local instance.
- Workspace Agent section shows source badges.
- Disabled Agents remain visible in the disabled filter.
- Model editor uses model selector behavior.
- Skill editor uses skill selector behavior.
- Save is blocked for invalid model selection.
- Save is blocked for invalid newly selected skill ids.
- Failed save keeps the editor open.

## Acceptance Criteria

- Users cannot create global Agents.
- Users can create Agents inside a workspace.
- Workspace-created Agents are invisible to other workspaces.
- System Agents are read-only templates.
- Adding a system Agent creates a workspace-local instance.
- Runtime workflows execute only enabled Agents from the current workspace.
- Historical task snapshots remain immutable.
- Model and skill inputs are selector-based and validated.
- Save failures identify the failing step and preserve drafts.
