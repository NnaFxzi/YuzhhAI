# Enterprise Lead Workspace Design

## Goal

Build an `企业获客工作空间` that implements the multi-Agent business flow described in
`要求.md` while keeping the user experience simple.

The product should not expose a loose list of Agents and ask the user to manage
them manually. The user should create or open a business workspace, enter an
acquisition goal, and then see a controllable Agent workflow that produces
reviewable business deliverables.

The first version focuses on one workspace template:

```text
企业获客工作空间
```

It supports product understanding, opportunity judgment, content planning, social
operation drafts, sales handoff, risk review, summary, and archive. All external
actions remain drafts, todos, or approval items.

## Product Positioning

The workspace is a long-term business destination, not a single chat session.

Examples:

- 重型包装获客工作空间
- 蜂窝纸箱推广工作空间
- 某个产品线的销售跟进工作空间

Inside one workspace, the user can run multiple related acquisition executions,
such as:

- 推广重型纸箱
- 判断蜂窝纸箱商机
- 生成一周朋友圈和微信群内容
- 准备机械设备客户销售交接单

The core user model is:

```text
打开软件
→ 进入最近工作空间或创建工作空间
→ 输入本次获客目标
→ 总控 Agent 自动调度专业 Agent
→ 用户查看进度、干预 Agent、确认风险、使用成果包
```

## Existing Context

The current app already has pieces that can support this direction:

- A preset `推广agent` in `src/main/presetAgents.ts`.
- A heavy-packaging industry pack and content generation service under
  `src/main/industryPack/` and `src/shared/industryPack/`.
- Generated asset draft/export/archive statuses.
- OpenClaw as the single runtime/gateway.
- Subagent run tracking for parent/child execution history.

The requested system is broader than the existing `推广agent`. It needs a
workspace layer, execution records, Agent task records, structured deliverables,
risk gates, todos, and archive views. The design therefore treats Agents as
business modules inside a workspace rather than as one large prompt.

## Core Decisions

### Do Not Build One Super Agent

The system should not put all responsibilities into one huge `推广agent`.

Reasons:

- Each Agent in `要求.md` needs its own responsibility, status, input, output,
  summary, and project/workspace association.
- Risk review must be an explicit gate, not a paragraph in a generation prompt.
- Users need to inspect and rerun individual stages.
- Deliverables should be structured and archived outside chat history.

### Use Workspace-First Navigation

The first visible product concept is the workspace.

```text
Workspace → Run → Agent Task → Deliverable / Todo / Archive
```

User-facing language:

- 工作空间
- 本次执行
- Agent 进度
- 成果包
- 待处理事项
- 历史记录

### Use Controlled Structured Multi-Agent Flow

The first version should behave like a multi-Agent product, but the execution
should be controlled and structured.

It should not start with nine independent free-form long-running Agent chats
that talk to each other unpredictably.

Instead:

- Each Agent role has a prompt, input contract, output contract, status, and
  stored result.
- The controller runs the fixed flow in order.
- Users can pause, inspect, edit input, rerun a stage, or chat with an Agent.
- Agent chat changes create a pending version first. The user applies it before
  it changes the current run.

This keeps the first version reliable and easier to verify.

## Launch Experience

### First Launch

If the user has no workspace, the app should show a clean startup page inspired
by simple "offline space" style tools.

Primary action:

```text
创建企业获客工作空间
```

Secondary action:

```text
导入已有资料
```

The page should not expose Agent details yet. It should communicate that a
workspace is where business acquisition work will live.

### Returning Launch

If the user already has workspaces, the app should show:

- Recently opened workspace.
- Other recent workspaces.
- Create workspace.
- A lightweight quick-start input that can route to an existing workspace or
  create a new one after confirmation.

The default action should be to reopen the most recent workspace.

## Workspace Creation Flow

Workspace creation should avoid a long form. It uses extraction first, review
second.

```text
Create workspace
→ Upload files or answer in chat
→ Extract workspace profile
→ Show workspace draft
→ User confirms or edits
→ Create workspace
→ Enter Agent card console
```

### Input Methods

#### File Extraction

The user can upload business material such as:

- Product manuals
- Company introductions
- Historical promotional copy
- Customer cases
- Quote sheets
- Sales documents

The system extracts useful workspace profile fields and marks uncertain or
missing information.

#### Conversation Extraction

The user can describe the business in natural language.

Example:

```text
我们是做重型纸箱和蜂窝纸箱的，主要想找汽配和机械设备客户，
平时发朋友圈和微信群，不能乱写承重和交期。
```

The controller extracts the same profile fields as file extraction.

### Workspace Draft Confirmation

Before creating the workspace, the system shows a draft page. Extracted content
does not become official workspace data until the user confirms.

The draft includes:

- Workspace name.
- Company/product summary.
- Product list.
- Target customer directions.
- Channel preferences.
- Core selling points.
- Prohibited or risky claims.
- Missing information.
- Enabled default Agent workflow.

The user can edit the draft or create the workspace directly with incomplete
data. Missing data becomes todo items.

## Workspace Home

The confirmed home design is an Agent card console.

The page should show:

- Workspace profile summary.
- Current run goal.
- Project controller Agent.
- Agent cards for each fixed stage.
- Input and output summary for each Agent.
- Status for each Agent.
- Chat, view, rerun, and configure actions.
- Current user todos.
- Deliverable package.
- Safety boundary reminder.

The UI should make Agents visible enough to give control, but not force the user
to manually orchestrate the whole process.

## Fixed Agent Flow

The first version uses this fixed enterprise lead workflow:

```text
项目总控 Agent
→ 产品理解 Agent
→ 商机雷达 Agent
→ 内容策划 Agent
→ 社媒运营 Agent
→ 销售交接 Agent
→ 风控审核 Agent
→ 项目归纳 Agent
→ 项目归档 Agent
```

Users can skip stages for a specific run, but the first version should not
support arbitrary drag-and-drop Agent orchestration.

## Agent Roles

### 项目总控 Agent

Owns the execution plan.

Responsibilities:

- Understand the user goal.
- Create a run.
- Decide which stages are needed.
- Prepare the initial task plan.
- Trigger each Agent in order.
- Track statuses.
- Prevent bypassing risk review.
- Summarize the current run state.

### 产品理解 Agent

Turns workspace and run input into product understanding.

Outputs:

- Product profile.
- Core selling points.
- Suitable customers.
- Use scenarios.
- Missing information.
- Facts that must not be invented.
- Handoff context for opportunity and content stages.

### 商机雷达 Agent

Judges target customers and opportunity priority.

Outputs:

- Target customer directions.
- Purchase signals.
- Opportunity scores.
- High, medium, and low priority directions.
- Source and uncertainty notes.
- Follow-up recommendation.

### 内容策划 Agent

Creates reviewable content drafts.

Outputs:

- Xiaohongshu draft ideas and copy.
- Short-video script directions.
- WeChat article outline.
- Product introduction copy.
- Sales messaging drafts.
- High-risk expression list.
- Handoff context for social operation, sales handoff, and risk review.

### 社媒运营 Agent

Turns content into operational drafts and todos.

Outputs:

- Posting plan.
- Platform rhythm.
- Comment reply drafts.
- Direct-message drafts.
- Account nurturing suggestions.
- Manual operation todo list.

All outputs remain drafts. The Agent must not log in to social accounts or send
anything.

### 销售交接 Agent

Turns findings into salesperson-facing execution material.

Outputs:

- Sales handoff sheet.
- Follow-up SOP.
- First-contact suggestions.
- Objection handling suggestions.
- Daily manual todo list.
- Clear separation of facts, inferences, and unconfirmed information.

### 风控审核 Agent

Acts as a hard gate before final summary and archive.

Responsibilities:

- Detect automatic publishing, commenting, messaging, or emailing intent.
- Detect exaggerated product claims.
- Detect missing sources.
- Detect fabricated customer, contact, or case information.
- Detect privacy and non-public-data risk.
- Verify that external actions have draft/todo/approval status.
- Require revisions for high-risk content.

### 项目归纳 Agent

Creates the final user-readable summary from all Agent outputs.

Outputs:

- Run goal summary.
- Completion status by Agent.
- Product conclusion.
- Opportunity conclusion.
- Content and social operation results.
- Sales handoff summary.
- Risk review result.
- Manual confirmation items.
- Next-step recommendation.

It must not introduce new unverified facts.

### 项目归档 Agent

Saves the run as a reusable workspace asset.

Outputs:

- Archive record.
- Result index.
- Deliverable links.
- Risk review record.
- Todo and approval record.
- Reopen entry.

It must not treat temporary debug files as the only archive entry.

## Execution Behavior

The default mode is automatic execution with manual intervention.

Default flow:

```text
User enters goal
→ Controller creates run
→ Controller runs each stage
→ UI updates Agent cards
→ Risk review gates finalization
→ Summary and archive complete the run
```

User controls:

- Pause automatic execution.
- Chat with any Agent.
- View Agent input.
- View Agent output.
- Edit Agent input.
- Rerun an Agent.
- Apply or discard pending Agent chat results.

### Agent Chat Result Application

When the user chats with a specific Agent during a run, the result does not
immediately overwrite the official run output.

Flow:

```text
Agent chat
→ New pending version
→ User previews
→ User applies to current run
→ The Agent task output updates
→ Downstream stages are marked stale and need rerun
```

This prevents private Agent chats from silently changing official deliverables.

## Data Model

### Workspace

Long-term business container.

Fields include:

- id
- name
- type: enterprise lead workspace
- profile
- extraction sources
- risk rules
- enabled workflow stages
- recent run id
- created and updated timestamps

### Workspace Profile

Stores durable business context.

Fields include:

- Company summary.
- Product list.
- Product capabilities.
- Customer directions.
- Application scenarios.
- Selling points.
- Channel preferences.
- Prohibited claims.
- Contact rules.
- Missing information.

### Run

One execution inside a workspace.

Fields include:

- id
- workspace id
- user goal
- status
- current stage
- started and completed timestamps
- controller summary
- archive status

### Agent Task

One Agent's work inside one run.

Fields include:

- id
- run id
- agent role
- status
- input payload
- output payload
- summary
- missing info
- todos
- risks
- handoff context
- error
- stale flag
- created and updated timestamps

### Deliverable

Reusable output item.

Types include:

- Product profile.
- Opportunity report.
- Content draft.
- Social operation plan.
- Comment draft.
- Direct-message draft.
- Sales handoff sheet.
- Manual todo list.
- Risk review report.
- Final summary.

### Todo / Approval

Human-facing action item.

Types include:

- Missing information.
- Confirm expression.
- Manual publish.
- Manual comment.
- Manual direct message.
- Manual email.
- Review high-risk content.
- Confirm source.

### Archive

Stable historical record for completed or reviewed runs.

Includes:

- Run metadata.
- Agent task outputs.
- Deliverables.
- Risk report.
- Todos and approval items.
- Final summary.
- Reopen entry.

## Agent Output Contract

All Agents use a shared result envelope.

```text
AgentTaskResult {
  summary
  outputs
  missingInfo
  todos
  risks
  handoffContext
  status
}
```

Each Agent owns its own `outputs` schema, but the envelope is consistent so the
UI, risk review, archive, and rerun logic can work uniformly.

## Risk Gate

Risk review is a hard gate.

Flow:

```text
Content / social / sales outputs
→ Risk review
→ Pass: final summary and archive can proceed
→ Needs confirmation: final summary can proceed with explicit todos
→ Blocked: affected Agent must revise or user must explicitly confirm
```

Risk output includes:

- riskLevel: low, medium, or high
- blockingIssues
- warnings
- requiredRevisions
- approvalTodos
- draftOnlyConfirmed
- canArchive

Rules:

- No real publishing.
- No real commenting.
- No real direct messaging.
- No real emailing.
- No automatic social login.
- No bypassing verification or captcha.
- No non-public-data collection.
- No fabricated customers, contacts, sources, cases, certifications, prices,
  delivery promises, or performance numbers.
- All external actions must be drafts, todos, or approval items.
- Drafts must not be described as executed outcomes.

Risk levels:

- Low: allow final summary and archive with notes.
- Medium: allow final summary and archive with explicit user confirmation todos.
- High: block final archive until revision or explicit human confirmation.

## Deliverable Package

The run should produce a unified deliverable package rather than only chat
messages.

The package includes:

- Project/run summary.
- Original user goal.
- Agent division of work.
- Product profile.
- Product selling points.
- Suitable customers.
- Missing information.
- Opportunity judgment.
- Target customer directions.
- Purchase signals.
- Content drafts.
- Social media plan.
- Comment drafts.
- Direct-message drafts.
- Sales handoff sheet.
- Manual todos.
- Risk review.
- Final summary.
- Archive/reopen entry.

## MVP Scope

Included in the first version:

- Create enterprise lead workspace.
- First-launch and returning-launch workspace entry.
- File extraction and conversation extraction for workspace creation.
- Workspace draft confirmation page.
- Workspace profile storage.
- Fixed enterprise lead Agent workflow.
- Run creation from a user goal.
- Agent card console home.
- Structured Agent task inputs and outputs.
- Agent task status tracking.
- Agent chat pending-version flow.
- Rerun support for individual Agents.
- Stale downstream stage marking.
- Risk review hard gate.
- Deliverable package.
- Human todos and approval items.
- Archive and history entry.

Excluded from the first version:

- General workspace marketplace.
- Arbitrary user-created Agent workflows.
- Drag-and-drop workflow builder.
- User-created arbitrary Agents.
- Automatic publishing.
- Automatic commenting.
- Automatic direct messaging.
- Automatic emailing.
- Social account login.
- CRM customer database.
- Multi-user collaboration.
- Complex permission system.

## User Experience Principles

- The user starts from a workspace, not an Agent list.
- Creation uses extraction and confirmation, not a long form.
- Agent cards provide control without making the user orchestrate every step.
- Results live in deliverables, not only in chat messages.
- Every external action is clearly labeled as draft, todo, or approval.
- Risk review is visible and enforceable.
- The user can recover from bad output by editing inputs and rerunning stages.

## Verification Strategy

The first implementation should verify:

- First launch shows create workspace.
- Returning launch shows recent workspace and create workspace.
- File or conversation extraction produces a workspace draft.
- Confirming the draft creates a workspace.
- A user goal creates a run.
- The fixed Agent task set is created for the run.
- Each Agent task stores input, output, summary, status, todos, risks, and
  handoff context.
- Rerunning a task updates that task and marks downstream tasks stale.
- Agent chat produces a pending version until user applies it.
- High-risk review blocks final archive.
- Medium-risk review creates approval todos.
- Low-risk review allows final summary and archive.
- Deliverable package contains all required sections from `要求.md`.
- No UI copy implies that publishing, commenting, direct messaging, or emailing
  has been executed.

## Deferred Decisions

These are intentionally out of scope for the first implementation:

- Whether future versions support custom workspace templates.
- Whether future versions expose a visual workflow builder.
- Whether individual Agents become long-lived OpenClaw sessions.
- Whether completed manual todos can later be recorded as user-entered execution
  history.
- Whether CRM-style lead records become a separate module.
