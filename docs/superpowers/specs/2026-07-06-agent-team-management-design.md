# Agent Team Management And Conversation Tuning Design

## Summary

LobsterAI should treat Agents as a workspace team that participates in daily work, not as a standalone settings page.

The Agent experience will be redesigned around three connected surfaces:

1. A workspace-level **Agent Team** page for configuring the Agents that can act inside the current workspace.
2. A default **auto-routing** mode in chat so configured Agents are used directly when they match the task.
3. An in-conversation **Adjust this Agent** flow so users can correct poor answers at the moment they notice the
   problem.

This design builds on `2026-07-06-workspace-agent-scope-design.md`, which separates system-owned Agent templates from
workspace-owned Agent instances.

## Problem

The current Agent management experience exposes many low-level settings but does not make the user's main workflow
simple.

Observed issues:

- Agent management feels like a configuration page instead of an active part of the workspace.
- Users must understand too many concepts at once: identity, system prompt, user info, skills, model, research, IM
  bindings, and working directory.
- The chat composer can show a target Agent selector, but the product still pushes too much routing responsibility onto
  the user.
- When an Agent gives a bad answer, the user has no direct correction loop from that answer back to the Agent settings.
- The global Agent concept is ambiguous unless the product clearly separates read-only system templates from
  workspace-local Agents.

## Goals

- Make Agent configuration feel like managing the current workspace's working team.
- Keep common edits simple: responsibility, answer style, output format, research behavior, model, skills, and data
  scope.
- Move advanced prompt files and channel bindings behind an advanced section.
- Make chat use suitable workspace Agents automatically instead of recommending that the user manually switch.
- Let users tune an Agent directly from an unsatisfactory answer and retry the answer.
- Preserve workspace isolation: user-created Agents belong to one workspace unless explicitly copied.
- Keep historical runs stable through snapshots of the Agent configuration used at run time.

## Non-Goals

- Do not introduce user-created global Agents.
- Do not remove the system template library.
- Do not rewrite the OpenClaw runtime model.
- Do not build a full self-improving memory system in this phase.
- Do not turn every answer rating into an automatic persistent prompt mutation.
- Do not replace expert prompt editing; move it to an advanced path.

## Product Model

### System Agent Template

A read-only built-in Agent template shipped by LobsterAI. It may describe roles such as Product Understanding,
Opportunity Radar, Content Planning, Risk Review, or Sales Handoff.

Users can preview a system template and add it to the current workspace. Adding a template creates a workspace-local
Agent instance.

### Workspace Agent

An executable Agent instance owned by exactly one workspace. It can be created from a system template or from scratch.

Only enabled workspace Agents are eligible for auto-routing and workspace workflows.

### Agent Snapshot

The immutable Agent configuration captured when a chat turn, run, or task is created. Snapshots keep historical results
understandable even after users edit the workspace Agent later.

### Agent Adjustment

A user correction made from an Agent's answer. An adjustment can be applied only to a retry, saved to the current Agent,
or saved as a workspace-level preference depending on the user's choice.

## Information Architecture

Rename the sidebar entry from "Agent Management" or "代理管理" to "Agent Team" or "Agent 团队".

The Agent Team page has three primary columns:

```text
System Templates          This Workspace Team                    Agent Settings
----------------          -------------------                    --------------
Product Understanding     Product Understanding Agent   Enabled  Common
Opportunity Radar         Opportunity Radar Agent       Enabled  Capabilities
Content Planning          Content Planning Agent        Enabled  Advanced
Sales Handoff             Sales Handoff Agent           Disabled Test / Preview
```

### System Templates Column

Purpose: help users add useful built-in roles without editing global definitions.

Content:

- Template name and short responsibility.
- Read-only source badge.
- Default model and capability summary when available.
- Add to this workspace action.

Rules:

- A template cannot be edited directly.
- If a workspace already has an instance from the same template, show it as already added.
- Adding a template creates a workspace Agent instance and selects it in the team column.

### This Workspace Team Column

Purpose: show the Agents that can act in the current workspace.

Content:

- Agent name, icon, status, source badge, short responsibility.
- Model label.
- Skill count or capability summary.
- Research status.
- Last-used or last-edited hint when available.

Primary actions:

- Create workspace Agent.
- Enable or disable Agent.
- Edit Agent.
- Reorder Agents.
- Remove from this workspace.

Rules:

- Enable or disable affects future routing only.
- Removing an Agent does not mutate historical run snapshots.
- Low-frequency actions live in a row menu; Edit remains the obvious primary action.

### Agent Settings Column

Purpose: edit the selected Agent without forcing users into raw prompt fields first.

Tabs or sections:

1. **Common**
  - Responsibility.
  - Answer style.
  - Output format.
  - When to ask the user for missing information.
  - Whether to proactively research.
  - Preferred data sources or knowledge scope.

2. **Capabilities**
  - Model selector.
  - Skill selector.
  - External research providers.
  - Domestic research sources.
  - Working directory or workspace data scope.

3. **Advanced**
  - System prompt.
  - Identity.
  - User information.
  - IM channel bindings.
  - Raw diagnostic metadata when needed.

4. **Test / Preview**
  - A small prompt box to test the selected Agent.
  - Shows which model, skills, research mode, and knowledge scope would be used.
  - Allows "Save and test" without leaving the page.

## Chat Experience

### Composer Routing Control

The chat composer should default to auto-routing.

Recommended control:

```text
Agent: Auto
```

Expanded menu:

```text
Auto
Product Understanding Agent
Opportunity Radar Agent
Content Planning Agent
Sales Handoff Agent
```

Behavior:

- Auto is the default for new workspace chats.
- Auto considers only enabled Agents in the current workspace.
- Manual selection is available for users who know exactly which Agent they want.
- Existing sessions keep their selected Agent or snapshot unless the user starts a new turn with a different route.

### Auto-Routing Rules

When the user sends a message in a workspace:

1. Build a candidate list from enabled workspace Agents.
2. Score candidates using each Agent's responsibility, trigger description, enabled capabilities, and workspace context.
3. If one Agent clearly matches, run that Agent directly.
4. If several Agents are useful and the workflow supports coordination, dispatch the relevant Agents and summarize.
5. If several Agents conflict and the action is user-visible or costly, ask a short clarification.
6. If no Agent matches, use the main assistant and explain only when helpful.

Important product rule:

The assistant should not answer "you should use X Agent" when X is already configured and enabled in the current
workspace. It should use X directly.

### Routing Transparency

When auto-routing selects an Agent, show a quiet status line near the response:

```text
Used Opportunity Radar Agent
```

If multiple Agents were involved:

```text
Used Product Understanding + Opportunity Radar
```

This should be inspectable but not noisy. The user should be able to understand what happened without being forced to
manage it.

## In-Conversation Agent Adjustment

Every assistant answer produced by a workspace Agent should expose an "Adjust this Agent" action.

Entry points:

- Answer toolbar action.
- More menu item.
- Optional quick feedback chips for common cases.

Adjustment drawer:

```text
Adjust this Agent

What was wrong?
[Not specific enough] [Did not research] [Ignored workspace info]
[Wrong format] [Wrong tone] [Wrong Agent]

Instruction
Describe how this Agent should answer next time...

Apply to
( ) Retry this answer only
( ) Save to this Agent
( ) Save as workspace preference

[Retry] [Save changes]
```

Chinese UI labels should be direct and action-oriented:

- 调整这个 Agent
- 哪里不合适？
- 不够具体
- 没有调研
- 没引用资料
- 格式不对
- 语气不对
- 用错 Agent
- 仅本次重试
- 保存到这个 Agent
- 保存为本空间习惯

### Adjustment Outcomes

#### Retry This Answer Only

Creates a retry with an extra temporary instruction. The Agent's saved configuration is not changed.

Use this for one-off corrections.

#### Save To This Agent

Adds a concise instruction to the Agent's common behavior or prompt overlay. The change affects future turns that use
this Agent.

Use this when the correction is role-specific, such as "always include competitor examples when doing market research."

#### Save As Workspace Preference

Stores a workspace-level preference that can influence multiple Agents. The change affects future workspace turns.

Use this when the correction is broad, such as "reports should use concise executive summaries first."

### Safety Rules

- Do not silently save negative feedback as a persistent prompt change.
- Persistent changes require an explicit user action.
- Show a before/after summary for persistent changes.
- If a system template-derived Agent is edited, save the edit to the workspace-local instance only.
- If an Agent is disabled after a response, the old response remains tied to its original snapshot.

## Agent Configuration Shape

The UI can map common settings into structured fields before rendering them into runtime prompts.

Recommended conceptual fields:

```ts
interface WorkspaceAgentBehavior {
  responsibility: string;
  answerStyle: string;
  outputFormat: string;
  missingInfoPolicy: string;
  researchPolicy: 'auto' | 'ask' | 'off';
  knowledgeScope: string[];
  persistentInstructions: string[];
}
```

This does not need to replace existing prompt fields immediately. The first implementation can store these as workspace
Agent overrides and render them into the Agent's effective prompt.

## Runtime Flow

### New Chat Turn With Auto-Routing

```text
User message
  -> load current workspace
  -> load enabled workspace Agents
  -> route to matching Agent or Agents
  -> capture Agent snapshot
  -> run through OpenClaw
  -> show answer with routing attribution
```

### Agent Adjustment And Retry

```text
User clicks "Adjust this Agent"
  -> drawer opens with answer context and Agent snapshot
  -> user chooses correction and apply scope
  -> if retry only: create retry with temporary instruction
  -> if save to Agent: update workspace Agent override, then optionally retry
  -> if save as workspace preference: update workspace settings, then optionally retry
```

## Data And Persistence

This design depends on workspace-local Agent source metadata from the existing workspace scope design:

- `source: system_template | workspace_created`
- `templateId` for system-derived Agents.
- `overrides` for workspace-local edits.

Additional persistence recommended for this design:

- Workspace Agent behavior overrides for common settings.
- Optional workspace preference records for cross-Agent response conventions.
- Agent snapshot metadata on chat turns or runs.
- Adjustment audit metadata: source message id, Agent id, adjustment category, apply scope, timestamp.

The adjustment audit should support debugging and future UX improvements. It does not need to be shown prominently in
the first UI.

## Error Handling

- If auto-routing cannot load workspace Agents, fall back to the main assistant and show a compact warning.
- If the selected Agent is disabled before sending, ask whether to use Auto or re-enable the Agent.
- If an Agent's model is unavailable, show a repair prompt with model selection.
- If a saved adjustment fails, keep the drawer open and show exactly which save failed.
- If retry succeeds but persistent save fails, make the partial outcome explicit.

## Visual Direction

The Agent Team page should feel like an operational control surface, not a marketing page.

Design qualities:

- Dense but calm.
- List/table rows for repeated Agents.
- Small source, status, model, skill, and research badges.
- Right-side editor with clear section grouping.
- No hero layout, oversized cards, or decorative gradients.
- Icons are useful controls: add, enable, more actions, test, retry, settings.

Recommended layout:

```text
┌───────────────────────────────────────────────────────────────────────┐
│ Agent Team                                      Search   New Agent     │
├───────────────────┬───────────────────────────────┬───────────────────┤
│ System Templates  │ This Workspace Team            │ Settings          │
│                   │                               │                   │
│ + Product         │ Product Understanding  Enabled │ Common            │
│ + Opportunity     │ Opportunity Radar      Enabled │ Capabilities      │
│ + Content         │ Content Planning       Enabled │ Advanced          │
│ + Sales           │ Sales Handoff          Off     │ Test / Preview    │
└───────────────────┴───────────────────────────────┴───────────────────┘
```

For narrow screens, collapse the settings column into a drawer.

## Implementation Phases

### Phase 1: Agent Team Page

- Rename sidebar entry to Agent Team / Agent 团队.
- Show system templates separately from this workspace's Agents.
- Show workspace Agents in a compact list.
- Move Agent editing into a right-side editor or modal with Common, Capabilities, Advanced, and Test sections.
- Preserve existing data and runtime behavior where possible.

### Phase 2: Auto-Routing In Chat

- Change composer default to Auto.
- Add route attribution on responses.
- Use enabled workspace Agents directly when task intent matches.
- Keep manual Agent selection as an override.

### Phase 3: Conversation Adjustment Drawer

- Add Adjust this Agent action to Agent-produced answers.
- Support retry-only adjustments.
- Support saving to workspace Agent.
- Support saving workspace preference.
- Add adjustment audit metadata.

### Phase 4: Quality And Observability

- Track how often auto-routing chooses each Agent.
- Track how often users adjust an Agent after a response.
- Surface simple health indicators in the Agent Team list.
- Add better repair flows for missing models, disabled skills, and unavailable research providers.

## Testing Strategy

Renderer tests:

- Agent Team page renders system templates and workspace Agents separately.
- Read-only templates cannot be edited directly.
- Workspace Agent editor shows Common, Capabilities, Advanced, and Test sections.
- Composer defaults to Auto when workspace Agents exist.
- Manual Agent selection overrides Auto.
- Adjustment drawer supports retry-only, save-to-Agent, and workspace-preference choices.

Shared logic tests:

- Auto-routing candidate selection filters disabled Agents.
- Auto-routing falls back predictably when no Agent matches.
- Agent behavior overrides render into effective prompts.
- Adjustment category and apply scope normalization is stable.

Main/runtime tests:

- Workspace Agent snapshots are captured on runs.
- Edited workspace Agents do not mutate historical snapshots.
- Persistent adjustment save failures return structured errors.
- Missing model or skill state produces repairable errors.

Manual validation:

- Create a workspace from a system template.
- Add a system Agent to the workspace.
- Create a custom workspace Agent.
- Ask a task that should use an enabled Agent automatically.
- Adjust the answer, retry once, and confirm the saved Agent behavior affects a later turn.

## Open Decisions

The implementation plan should choose these before coding:

1. Whether Phase 1 edits use a right-side persistent panel or a modal on smaller screens.
2. Whether route scoring is initially heuristic or delegated to the runtime model.
3. How broad workspace preferences should be represented in the existing workspace settings data.
4. Which existing response component owns the "Adjust this Agent" action.
5. Whether the first release supports multi-Agent dispatch or only single-Agent auto-routing.

## Recommended First Release

The first release should stay narrow:

- Build the Agent Team page structure.
- Default the composer to Auto for workspace chat.
- Add response attribution for the chosen Agent.
- Add "Adjust this Agent" with retry-only behavior.

Saving adjustments to the Agent and workspace preferences can follow after the retry loop is proven useful.
