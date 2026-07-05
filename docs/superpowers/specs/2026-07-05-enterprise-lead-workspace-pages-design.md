# Enterprise Lead Workspace Pages Design

## Goal

Complete the internal pages for an opened enterprise lead workspace so the
workspace sidebar is a real product surface, not a single usable workbench with
inactive labels.

The opened workspace should provide these pages:

- 工作台
- AI 对话
- 知识库
- 创作记录
- 空间设置

The first implementation should be a usable version. It should connect to real
workspace data and configuration where the repository already has support, while
avoiding a broad rewrite of Cowork, OpenClaw, or the global Agent system.

## Current Context

The repository already has an enterprise lead workspace flow with:

- workspace creation and profile extraction;
- workspace settings for model providers, skills, external research, and
  domestic research sources;
- fixed enterprise lead run/task records;
- pending versions, derived deliverables, todos, and archives;
- a workbench UI with an internal sidebar;
- global Agent CRUD and settings panels;
- Tavily and Firecrawl research service support;
- domestic content-platform source configuration/status support.

The current internal workspace sidebar already lists the target page labels, but
the workbench content is effectively the only implemented destination. The new
work should turn this shell into page navigation and redistribute existing
responsibilities into clear surfaces.

## Product Decisions

### Workspace Pages

The workspace shell owns the internal sidebar and active page state. All pages
share the same opened workspace identity, workspace refresh behavior, and visual
frame.

### 工作台

工作台 is the current workspace Agent management center.

The workspace is the product boundary. It does not expose a global Agent
concept to the user. 工作台 manages the executable Agents owned by the current
workspace:

- view workspace Agents;
- create a new Agent inside the workspace;
- edit each Agent's name, description, identity, prompt, icon, model, and
  skills;
- enable, disable, reorder, or remove Agents from the current workspace;
- keep all edits scoped to the current workspace.

Removing an Agent removes it from the current workspace's executable team. It
does not affect any other workspace.

Editing an Agent inside the workspace must not mutate any global or shared
Agent record. For this product surface, workspace Agents are workspace-private
definitions.

The enterprise lead default Agent team is a starter set copied into each
workspace. After creation, users can modify Agents such as 产品理解 Agent,
商机雷达 Agent, and 内容策划 Agent for that workspace only.

### AI 对话

AI 对话 is a workspace-aware chat page.

The user can ask questions, generate drafts, and request research. The response
uses:

- the current workspace profile;
- source material summaries;
- workspace-owned Agents and their current definitions;
- workspace model settings;
- workspace skills;
- workspace Tavily/Firecrawl settings;
- workspace domestic platform source settings and custom URLs;
- current or recent run outputs when useful.

If the user names a specific workspace Agent, the answer should use that
Agent's definition as the primary persona/task framing. If the user does not
name an Agent, the page answers as a general workspace assistant.

The chat may call configured research capabilities. External actions remain
limited to reading, searching, extracting, summarizing, and draft generation.
The system must not publish, comment, direct-message, email, place orders, or
mutate external systems.

### 知识库

知识库 is a read-only workspace knowledge view for the first version.

It shows what the workspace already knows:

- company summary;
- products and capabilities;
- target customers and application scenarios;
- selling points and channel preferences;
- prohibited claims and contact rules;
- source materials;
- recent deliverables;
- archived summaries.

The first version does not add manual editing, file management, search, or
custom knowledge entry creation. Empty sections show concise empty states.

### 创作记录

创作记录 is organized by execution run.

Each run corresponds to one acquisition goal. The list shows:

- goal;
- status;
- created/updated time;
- participating Agent count;
- deliverable count;
- todo/risk count;
- archive state.

Selecting a run opens a detail view with Agent output summaries, deliverables,
todos, risks, and archive information. The first version does not add run
deletion, cross-workspace search, or manual grouping.

### 空间设置

空间设置 owns full workspace configuration.

It carries the editing controls currently mixed into the workbench:

- model provider settings;
- default model/provider;
- enabled skills;
- Tavily and Firecrawl;
- domestic content-platform sources;
- custom source URLs;
- safety boundary reminder.

Saved settings apply to both workspace chat and enterprise lead workflow runs.

## Data Model

### Workspace-Owned Agent Definitions

Workspace-owned Agent definitions are the source of truth for this product
surface. There is no user-facing global Agent concept inside an enterprise lead
workspace.

For migration safety, the existing serialized field can remain named
`workspaceAgents`, but the product meaning changes from "global Agent binding
plus overrides" to "complete Agent definition owned by this workspace".

The preferred workspace field is:

```ts
workspaceAgents: Array<{
  agentId: string;
  enabled: boolean;
  order: number;
  name: string;
  description: string;
  identity: string;
  systemPrompt: string;
  icon: string;
  model: string;
  skillIds: string[];
}>;
```

Existing persisted records that still contain `overrides` remain readable. The
normalization layer should merge direct fields and legacy `overrides` into one
effective workspace-owned Agent definition.

Creating a new Agent from the workbench adds a new workspace-owned Agent
definition. It does not create, bind, or mutate a global Agent record.

New workspaces can initialize `workspaceAgents` from starter enterprise lead
Agents. Existing workspaces that only have `enabledAgentRoles` remain readable.

### Compatibility With Existing Roles

Existing data includes fixed role IDs such as `controller`,
`content_planning`, and `risk_review`.

Compatibility should be explicit:

- Old workspaces continue to render their existing roles.
- If an old workspace has no `workspaceAgents`, project its enabled roles into
  editable workspace-owned Agent definitions at read/render time.
- New workspace saves should persist workspace-owned Agent definitions so the
  user can edit 产品理解 Agent and other execution Agents directly.
- Existing run/task records keep their role fields so historical records remain
  readable.

The implementation plan should choose the smallest safe migration that lets the
new workbench manage real Agents without breaking current run history.

### Workspace Settings

Workspace settings remain workspace-scoped:

- model providers;
- selected skills;
- external research providers;
- domestic research sources.

When a workspace Agent has its own model or skill settings, the first version
should use workspace settings as the default for workspace chat and workspace
workflow behavior. Agent-specific settings remain editable but should not make
the workspace's active capability state ambiguous.

Precedence is:

1. Workspace model, skill, and research settings control provider availability
   and external research for workspace chat and workflow runs.
2. Workspace-owned Agent definitions control the selected Agent's name,
   description, identity, prompt, icon, model preference, and skill preference.
3. Starter role metadata is only a fallback for old workspaces that have not
   persisted workspace-owned Agent definitions yet.

For named-Agent chat responses, the selected workspace Agent's effective prompt
comes from the workspace-owned Agent definition, while provider credentials and
research availability still come from workspace settings.

### Runs

Add a read-only run list path for creation records:

```ts
listRuns(workspaceId: string): EnterpriseLeadRun[]
```

Run detail can use the existing snapshot lookup:

```ts
getRun(workspaceId, runId)
```

### Run Creation And Agent Resolution

New workspace runs should resolve participating Agents from the current
workspace-owned Agent definitions first.

The existing fixed role workflow is a compatibility fallback for old workspaces
and existing run history only. New runs created after this feature should derive
their participating task set from the current `workspaceAgents` list and each
workspace Agent's effective prompt/configuration. Old `EnterpriseLeadAgentRole`
task records stay readable for historical records.

If implementation risk forces a phased delivery, the phase boundary must be
explicit: 工作台 and AI 对话 use workspace Agents in the first phase, and dynamic
workspace-Agent run execution is tracked as the next phase rather than silently
pretending fixed-role runs use the edited workspace Agents.

Selected phase boundary for this implementation: 工作台, AI 对话, and new run
task snapshots resolve workspace-owned Agents. Existing historical run records
remain readable because each task keeps its `role`, `workspaceAgentId`, and
`agentSnapshot` values.

## Component Design

### WorkspaceShell

`WorkspaceShell` wraps the internal sidebar and page content.

Responsibilities:

- render the sidebar;
- own active internal page state;
- keep the active page highlighted;
- provide the current workspace to all pages;
- coordinate workspace refreshes after settings or Agent binding changes.

### WorkspaceWorkbench

`WorkspaceWorkbench` becomes Agent management.

Responsibilities:

- load/render workspace-owned executable Agents;
- create a new workspace Agent;
- open edit UI for the selected workspace Agent;
- enable/disable or remove workspace Agents;
- show configuration summaries that link to 空间设置.

It should not own model provider, research, or platform source editors.

### WorkspaceAiChat

`WorkspaceAiChat` renders a chat-style page for the current workspace.

Responsibilities:

- maintain the current page's message list;
- accept user input;
- call a workspace chat IPC/service method;
- show research/source status in the assistant response when available;
- show model/research errors clearly.

The first version does not need durable chat history. This keeps the first pass
focused and avoids creating another conversation persistence model.

### WorkspaceKnowledgeBase

`WorkspaceKnowledgeBase` renders grouped read-only sections from workspace
profile, source material, deliverables, and archives.

### WorkspaceCreationRecords

`WorkspaceCreationRecords` renders run list and run detail.

It can fetch run list on page open and fetch detail only when a record is
selected.

### WorkspaceSettings

`WorkspaceSettings` owns the existing provider, skill, external research, and
domestic source editors. It preserves the existing save behavior but moves the
editing surface out of the workbench.

## AI Chat Flow

The workspace chat service runs a controlled two-step flow.

### Step 1: Resolve Research Intent

The service asks the model to classify the user message into a structured
research intent:

```ts
type WorkspaceChatResearchIntent =
  | { kind: 'none' }
  | { kind: 'search'; query: string; provider?: 'auto' | 'tavily' | 'firecrawl' }
  | { kind: 'extract'; urls: string[]; query?: string; provider?: 'auto' | 'tavily' | 'firecrawl' }
  | { kind: 'domestic_status' };
```

If the user pasted URLs, `extract` is preferred. If the user asks for public or
fresh information without URLs, `search` is preferred. If the user asks what
domestic sources are available, use `domestic_status`.

The service validates and clamps the model-produced intent before any network
call:

- search query max length: 500 characters;
- extract URL count max: 10;
- URL protocol: `http:` or `https:` only;
- provider: unknown provider values become `auto`;
- research response text is summarized or truncated before being included in the
  final model prompt;
- each research call uses a timeout and returns a structured failure summary on
  timeout.

### Step 2: Gather Research And Respond

If the intent needs research, the service calls configured workspace providers.
API keys stay server-side and must not be included in model prompts.

Then the service asks the model for the final response using:

- user message;
- workspace profile;
- workspace Agents;
- relevant run/deliverable context;
- workspace settings summary;
- research result or research failure summary;
- safety boundaries.

### Provider Selection

Use workspace-scoped provider configuration. Do not rely on arbitrary global
Agent research settings for workspace chat.

For `auto`:

- prefer Tavily for search when enabled and configured;
- fall back to Firecrawl search;
- prefer Firecrawl for URL extraction when enabled and configured;
- fall back to Tavily extract.

Domestic sources in the first version expose status and configured URLs. The
chat can summarize available sources or ask the user for links when a platform
is URL-import-only.

### Safety Boundaries

The chat never performs real publishing, commenting, direct messaging, emailing,
ordering, or external mutation. It may create:

- draft content;
- suggested replies;
- todo items;
- research summaries;
- risk reminders;
- next-step recommendations.

## Error Handling

Workspace pages should remain usable if optional data is missing.

- If workspace details fail to load, keep the existing workspace load error
  banner behavior.
- If run listing fails, show a creation-records error state without blocking
  other pages.
- If research is requested but providers are not configured, produce a response
  that states the missing capability and gives a lower-confidence answer from
  existing workspace data.
- If a configured research call fails, include a research failure note and still
  answer when possible.
- If the model call fails, show an error and do not fabricate a response.
- If an Agent bound to the workspace is missing globally, show it as unavailable
  and offer removal/rebinding instead of crashing.

## Internationalization

All user-visible renderer strings must use `i18nService.t()` with Chinese and
English keys.

Expected new string groups:

- workspace page titles and subtitles;
- workspace-owned Agent actions;
- AI chat empty, loading, research, and error states;
- knowledge section titles and empty states;
- creation record list/detail labels;
- settings save and safety labels.

## Testing

### Shared And UI Helpers

Add pure helper tests for:

- workspace sidebar active page metadata;
- workspace-owned Agent summaries;
- knowledge section derivation from profile/snapshot;
- creation record summary derivation;
- research intent normalization;
- safety-boundary labels and capability summaries.

### Main Process

Add service/store tests for:

- listing workspace runs;
- preserving old role-based workspaces;
- creating, editing, enabling, disabling, reordering, and removing workspace-owned Agents;
- preserving old role-based workspaces by projecting roles into editable workspace Agents;
- resolving effective workspace Agent values from workspace-owned definitions;
- workspace chat with no research;
- workspace chat with Tavily/Firecrawl research;
- workspace chat when research is unconfigured;
- workspace chat when research fails;
- workspace chat with invalid or oversized research intent values;
- workspace chat when model generation fails.

### Renderer

Add component tests or static render tests for:

- internal sidebar switches active pages;
- 工作台 renders workspace-bound Agents and creation/add actions;
- AI 对话 renders message, loading, and error states;
- 知识库 renders real profile and archive data;
- 创作记录 renders run list and selected detail;
- 空间设置 renders the moved configuration editors.

### Verification

Implementation verification should include:

- relevant Vitest tests;
- changed-file ESLint;
- `npm run compile:electron` if IPC, preload, or main process types change;
- manual renderer check for the five internal pages.

## Out Of Scope

This design does not include:

- durable chat history for workspace AI chat;
- arbitrary multi-Agent orchestration editing;
- publishing/commenting/direct-message/email automation;
- deleting historical runs;
- cross-workspace search;
- knowledge-base manual editing;
- file upload and document management inside 知识库;
- full OpenClaw/Cowork conversation reuse for workspace chat.
