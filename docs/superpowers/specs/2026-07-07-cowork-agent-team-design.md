# Cowork Agent Team Integration Design

## Summary

Cowork's main chat should use the current workspace Agent team by default while still allowing the user to manually
target a specific workspace Agent. The first implementation phase keeps Cowork on the existing OpenClaw runtime and
injects workspace Agent team context into the Cowork prompt layer. This preserves Cowork's current tools, files, skills,
media, artifacts, working directory behavior, and session lifecycle.

## Goals

- Show an Agent team selector in the Cowork home prompt when a workspace Agent team is available.
- Default the selector to automatic routing.
- Allow manual selection of any enabled workspace Agent in the current workspace.
- Send the selected Agent team routing mode with Cowork start and continue requests.
- Add a bounded system prompt section that describes the enabled workspace Agents and the selected routing mode.
- Keep the existing global Cowork Agent selector behavior separate from workspace Agent team selection.
- Make the feature safe when no workspace Agent team exists.

## Non-Goals

- Do not replace Cowork's OpenClaw runtime with `enterpriseLeadWorkspace.chat`.
- Do not implement true sequential multi-Agent execution inside Cowork in this phase.
- Do not persist workspace Agent team selections as global Agent records.
- Do not change existing enterprise workspace task-run behavior.
- Do not remove or redesign the existing global Agent system.

## Current State

Cowork has a global Agent concept based on `state.agent.currentAgentId`. The home prompt can show an Agent selector, but
it only exposes global agents and is hidden when the current Agent is the default `main` Agent.

Enterprise lead workspaces have their own workspace-local Agent bindings in `workspace.workspaceAgents`. These bindings
include source, enabled state, order, overrides, model, skills, identity, and system prompt. The existing enterprise
workspace chat can route through those Agents, but the Cowork main chat does not currently consume that data.

## Recommended Approach

Use a hybrid integration:

- Cowork remains the runtime surface.
- Workspace Agent team configuration is read from the current enterprise lead workspace.
- The prompt input shows a compact team selector:
  - `Agent 团队：自动`
  - enabled workspace Agent names such as `项目总控 Agent`, `内容策划 Agent`, `风控审核 Agent`
- Start and continue requests include a workspace Agent routing selection.
- Main process validates the selection against the current workspace Agent list.
- Main process builds an additional system prompt section with:
  - enabled Agents sorted by order
  - each Agent's name, description, identity, system prompt, model, and skills
  - routing mode: automatic or manual
  - safety instructions that the model must not claim independent multi-Agent execution unless explicitly performed

## UI Design

The Cowork prompt footer should keep the current quiet workbench style. The team selector should sit near the folder
context and model selector, using an icon plus short text. It should not look like a large feature card.

Suggested control:

```text
[ folder project v ] [ Agent 团队: 自动 v ]                       [ model v ] [ send ]
```

The menu should contain:

- `自动` as the first option.
- A divider or subtle section label for enabled workspace Agents.
- One row per enabled workspace Agent, showing icon/short label, name, and optional model badge if the Agent has a model
  override.

When a manual Agent is selected, the trigger text changes to that Agent name. If the selected Agent becomes disabled or
removed, the UI falls back to automatic.

## Data Model

Introduce a small Cowork-side routing selection type:

```ts
export const CoworkWorkspaceAgentMode = {
  Auto: 'auto',
  Manual: 'manual',
} as const;

export interface CoworkWorkspaceAgentSelection {
  workspaceId: string;
  mode: CoworkWorkspaceAgentMode;
  agentId?: string;
}
```

This selection should be request-scoped rather than a global user preference for phase one. The session may store a
lightweight copy in message metadata or session metadata later, but that is not required for initial routing.

## Data Flow

1. Cowork view determines whether the active workbench context has an enterprise lead workspace.
2. Renderer loads that workspace's `workspaceAgents`.
3. Prompt input derives enabled Agent choices from `workspaceAgents`.
4. User keeps `自动` or selects a specific Agent.
5. `CoworkPromptInput` passes the selection to `CoworkView`.
6. `CoworkView` forwards it to `coworkService.startSession` or `coworkService.continueSession`.
7. IPC forwards the selection to main.
8. Main validates that:
  - the workspace exists
  - the selected Agent exists in `workspaceAgents`
  - the selected Agent is enabled
9. Main appends the Agent team prompt bridge to the Cowork system prompt.
10. OpenClaw runs the existing Cowork session with the enriched prompt.

## Prompt Bridge

The prompt bridge should be bounded and explicit:

- Name it `Cowork workspace Agent team context`.
- Include only enabled Agents.
- Respect workspace Agent order.
- Limit long system prompts and descriptions to avoid bloating context.
- For automatic mode, instruct the model to choose the most relevant Agent role or combine responsibilities when useful.
- For manual mode, instruct the model to answer as the selected Agent.
- Always state that this is a role/routing context inside one Cowork runtime turn, not proof that separate Agents were
  executed.

Example intent:

```text
Cowork workspace Agent team context:
- Routing mode: auto
- If one Agent clearly matches the task, answer under that Agent's responsibility.
- If multiple Agents are relevant, combine their responsibilities in one response and state the reasoning briefly.
- Do not claim that separate Agents executed unless a runtime event explicitly provides those results.
```

## Error Handling

- If no workspace Agent team exists, hide the selector and run Cowork normally.
- If a manual selected Agent is removed before send, fall back to automatic and show no blocking error.
- If workspace lookup fails in main, ignore the Agent team selection and continue Cowork normally with a warning log.
- If prompt bridge construction fails, continue without the bridge and log a recoverable warning.

## Internationalization

All visible strings need both Chinese and English entries:

- `Agent 团队`
- `自动`
- `使用 Agent 团队自动判断`
- `选择团队 Agent`
- `Agent 已不可用，已切回自动`

## Tests

Use test-first implementation.

Renderer tests:

- Prompt input renders `Agent 团队：自动` when workspace Agent choices exist.
- Manual selection updates the trigger label.
- Removed or disabled selected Agent falls back to automatic.
- Submit passes the Agent team selection through to the parent handler.

Service and IPC tests:

- `coworkService.startSession` forwards workspace Agent selection.
- `coworkService.continueSession` forwards workspace Agent selection.
- Main validates manual Agent selections against workspace-local bindings.
- Main ignores unbound global Agent ids in workspace Agent selection.

Prompt bridge tests:

- Automatic mode includes enabled Agents in order.
- Manual mode includes the selected Agent and marks it as the target.
- Disabled Agents are omitted.
- Long fields are bounded.

## Rollout

Phase one ships the selector and prompt bridge only. After that is stable, a later phase can extract the enterprise
workspace routing logic into a shared module and add true sequential multi-Agent execution for Cowork responses.

## Context Rules

- Phase one only enables the Agent team selector when Cowork receives an explicit enterprise lead workspace context from
  the renderer state or parent view.
- If no enterprise lead workspace id is available, Cowork hides the Agent team selector and keeps the existing behavior.
- If multiple enterprise workspaces exist, Cowork does not guess. It uses the workspace id from the active enterprise
  workspace surface.
- New sessions default to automatic routing. Persisting the last selected team Agent per workspace is intentionally
  deferred.
