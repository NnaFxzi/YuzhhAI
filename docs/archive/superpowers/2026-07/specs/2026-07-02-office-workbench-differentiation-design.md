# Office Workbench Differentiation Design

## Goal

Position the public release of `宇智汇和 AI 助手` as an office-and-content workbench for non-developer users, rather
than a general coding agent or an agent capability marketplace.

The product promise is:

> 宇智汇和 AI 助手 is a smart office workbench that organizes materials, creates deliverables, and follows up recurring
> work.

The first public-facing experience should help ordinary office users, small business owners, content creators, and
operations teams turn files, webpages, screenshots, notes, and ideas into concrete outputs:

- Excel summaries and reports.
- Word documents and structured notes.
- PPT outlines and slide decks.
- Web pages and landing pages.
- Daily and weekly reports.
- Research summaries.
- Topic calendars.
- Draft articles, scripts, and content plans.

## Product Positioning

The app should not compete head-on with Codex or Claude Code on engineering delivery. Those products already emphasize
codebase understanding, multi-agent engineering workflows, PRs, CI, code review, terminal/IDE workflows, and background
coding tasks.

`宇智汇和 AI 助手` should instead emphasize a more accessible work outcome:

- "I have some materials; help me produce a useful deliverable."
- "I repeat this office/content task every day or week; help me automate it."
- "I do not want to understand skills, MCP, plugins, or agent runtimes; just help me finish the work."

The differentiator is the combination of:

- Local desktop files and folders.
- Chat as the natural control surface.
- Visible work materials and generated deliverables.
- Reusable office/content workflows.
- Scheduled follow-up tasks.
- Optional advanced capabilities hidden behind a simpler product language.

## Target Users

The first public release should primarily serve two user groups:

1. Ordinary office users and small business owners:
  - Spreadsheet cleanup and summaries.
  - PPT and document generation.
  - Daily/weekly reports.
  - Local file organization.
  - Simple web pages or forms.

2. Content creators, self-media users, and operations teams:
  - Topic ideation.
  - Research.
  - Drafting and polishing.
  - Graphic/video content planning.
  - Account content calendars.
  - Competitor tracking.

Developer-oriented workflows remain available through the underlying agent runtime, but they should not define the first
impression.

## Recommended Approach

Use an "office workbench first" information architecture.

The main screen remains chat-centered, but surrounding panels should make the work visible:

- Current materials.
- Generated deliverables.
- Common workflows.
- Recurring tasks.

This approach was chosen over two alternatives:

- Vertical assistant first: easier to market as "office assistant" or "content assistant", but it still asks users to
  pick an agent before doing work.
- Automation first: highly differentiated, but too high-friction for a first launch because users must trust the app
  before they schedule recurring work.

The recommended strategy is:

> Workbench as the main product, recurring automation as the memorable advantage, and agents/kits/skills as hidden
> advanced machinery.

## First-Screen Information Architecture

The main app should be reorganized around a workbench:

- `工作台`: primary chat and task execution area.
- `产物`: generated files and artifacts across sessions.
- `自动任务`: scheduled and recurring work.
- `历史`: prior sessions and reusable work.
- `设置`: model, account, appearance, advanced capabilities, and system configuration.

The current first-level entries for Skills, Kits, MCP, and Plugins should be downgraded from product concepts to
advanced configuration.

### Workbench Layout

The workbench should keep `CoworkView` as the core task surface.

Add a workbench side panel with four sections:

- `当前材料`: files, folders, screenshots, webpages, selected text, and prior session snippets used by the current task.
- `产物`: generated PPT, Word, Excel, HTML, images, videos, markdown reports, and text outputs.
- `常用工作流`: office and content workflows such as daily report, files to PPT, Excel summary, competitor research,
  topic calendar, public account draft, and short video script.
- `自动任务`: today's and this week's scheduled jobs, plus follow-up actions generated from completed work.

This panel should reuse existing artifact and scheduled-task capabilities wherever possible rather than duplicating
rendering or scheduling logic.

## Feature Additions And Optimizations

### 1. Workbench Side Panel

Create a unified panel that combines current task materials, generated artifacts, workflow shortcuts, and scheduled
follow-ups.

This panel should answer four user questions:

- What did I give the assistant?
- What did it produce?
- What can I do next?
- Can this happen automatically next time?

### 2. Workflow Catalog

Upgrade the current quick actions into structured workflows.

Each workflow should include:

- `id`
- category
- title
- description
- required inputs
- recommended output types
- default prompt
- related skills or tool hints
- suggested follow-up actions

Initial workflow IDs:

- `office.daily-report`
- `office.weekly-report`
- `office.files-to-ppt`
- `office.excel-summary`
- `office.document-cleanup`
- `office.research-to-report`
- `content.topic-calendar`
- `content.competitor-research`
- `content.public-account-draft`
- `content.short-video-script`
- `content.materials-to-posts`

Workflows should be written in user language, not implementation language. Avoid exposing "skill", "MCP", "plugin", or "
agent runtime" in the default workflow cards.

### 3. Artifact Library

The current artifact experience is mostly session-local. Add a cross-session "deliverables" view.

The first version can derive artifact metadata from existing `cowork_messages` and renderer artifact parsing. A later
version can introduce a dedicated artifact library table for:

- rename
- favorite
- tag
- source session
- output type
- local file path
- regenerate from this
- continue editing

### 4. One-Click Reuse

Every successful task should be reusable.

Examples:

- "Use this format next time."
- "Save this as a workflow."
- "Every Monday, turn this folder into a weekly PPT."
- "Every morning, summarize these sources into a content topic sheet."

This should start as a guided follow-up action. It does not need a full workflow builder in the first pass.

### 5. Follow-Up Automation

Scheduled tasks should become a natural next step from completed work.

Examples:

- After a daily report is generated: "Generate this every weekday at 9:00?"
- After competitor research: "Track these competitors weekly?"
- After a topic calendar: "Refresh next week's topics every Friday?"

This reuses the existing scheduled task system but changes the user entry point from "create a cron job" to "keep doing
this for me."

### 6. First-Use Guidance

The first run should not start with model/runtime/skill concepts.

The onboarding should ask the user to start with one of two goals:

- `办公整理`: reports, documents, spreadsheets, PPTs, local files.
- `内容运营`: topics, research, drafts, calendars, scripts.

Then prompt the user to drag in a file, choose a folder, paste a link, or pick a workflow.

## Feature Downgrade And Removal Guidance

Do not immediately delete mature underlying capabilities. Public-release differentiation should first be achieved
through entry-point and language changes.

### Keep And Strengthen

- Cowork main conversation.
- Artifacts.
- Scheduled tasks.
- Quick actions, upgraded into workflows.
- Document, spreadsheet, PPT, PDF, webpage, search, email, and content skills.
- Local file/folder context.
- OpenClaw runtime.

### Downgrade Or Hide From Primary Navigation

- Kits main entry.
- MCP main entry.
- Skills management main entry.
- Plugins main entry.
- Agent engine settings.
- General-purpose preset agents unrelated to office/content work.

### Avoid In The First Public Positioning

- Leading with "agent store".
- Leading with "MCP".
- Leading with "plugins".
- Leading with medical, pet, or stock assistant presets.
- Presenting the app as a Claude Code or Codex replacement.

These features may remain available for advanced users through settings or advanced capability pages.

## Architecture

Add a lightweight workbench product layer above existing systems.

### Workbench Shell

Location:

- `src/renderer/App.tsx`
- `src/renderer/components/cowork/`
- new workbench components under `src/renderer/components/workbench/` when the feature grows.

Responsibilities:

- Keep `CoworkView` as the primary task view.
- Add the workbench side panel.
- Coordinate visible materials, artifacts, workflows, and scheduled follow-ups.
- Hide or downgrade advanced capability views from primary navigation.

### Workflow Catalog

Location:

- Start from `public/quick-actions.json`.
- Start from `public/quick-actions-i18n.json`.
- Later move typed workflow definitions into a shared or renderer service if needed.

Responsibilities:

- Describe workflows in product language.
- Provide prompt templates and required input hints.
- Suggest output type and follow-up actions.
- Map workflows to existing skills or kits without exposing those details to ordinary users.

### Artifact Library

Location:

- Reuse `src/renderer/components/artifacts/`.
- Reuse `src/renderer/services/artifactParser.ts`.
- Add a thin metadata extraction service before adding database tables.

Responsibilities:

- Extract artifact metadata from sessions.
- Show cross-session deliverables.
- Link each deliverable to its source session.
- Support opening, exporting, copying, and continuing from a deliverable.

### Follow-Up Automation

Location:

- Reuse `src/scheduledTask/`.
- Reuse `src/renderer/components/scheduledTasks/`.
- Add follow-up creation surfaces in workbench completion states.

Responsibilities:

- Convert a completed workflow into a suggested recurring task.
- Pre-fill task title, prompt, materials, cadence, and output expectation.
- Show failures in plain user language.

## Data Flow

1. User selects a workflow or enters a free-form task.
2. Workbench collects user input, selected files, links, current materials, and workflow metadata.
3. Workbench sends a structured prompt through the existing Cowork flow.
4. OpenClaw executes the task through existing tools and skills.
5. Cowork stream events update the conversation.
6. Artifact parsing detects generated deliverables.
7. Workbench side panel shows materials and deliverables.
8. Completion state offers next actions: export, continue editing, save workflow, or schedule recurring work.

## Error Handling

Errors should be explained in office-user language instead of exposing internal capability names.

- Model not configured:
  - "先连接一个模型再开始工作。"
  - Actions: configure model, use local model, later.

- Required capability unavailable:
  - "这个工作流需要文档/表格处理能力，当前不可用。"
  - Actions: repair, open advanced capabilities, choose text-only output.

- File read failure:
  - Show the affected file.
  - Explain whether the issue is permission, missing file, unsupported format, or file size.
  - Offer retry or reselect.

- Deliverable generation failure:
  - Preserve partial results.
  - Offer continue generation, switch output format, or export text only.

- Scheduled task failure:
  - Show the latest failure reason.
  - Offer manual rerun with the same materials.
  - Offer edit schedule or disable.

## Testing And Verification

Validate five core user paths:

1. Drag in multiple files, generate a materials summary, and confirm the deliverable appears in the workbench panel.
2. Provide an Excel file, generate summary statistics, and export a spreadsheet or report.
3. Provide a folder of materials, generate a PPT outline or deck, and continue editing it.
4. Enter a content direction, generate a weekly topic calendar, and save it as a reusable workflow.
5. Complete a daily report and create a recurring task from the follow-up prompt.

Recommended automated tests:

- Workflow catalog parsing.
- Workflow prompt assembly.
- Artifact metadata extraction.
- Follow-up automation payload generation.
- Sidebar/main navigation visibility for ordinary versus advanced entries.

Manual validation:

- First-run path for office users.
- First-run path for content users.
- Disabled or missing model state.
- Missing skill/capability state.
- Failed scheduled task recovery.

## Implementation Phases

### Phase 1: Make It Feel Like A Workbench

- Rename and reorganize primary navigation.
- Add the workbench side panel.
- Upgrade quick actions into workflow cards.
- Surface current materials and generated artifacts in the panel.
- Move Kits, MCP, Skills, and Plugins out of primary navigation.

### Phase 2: Close The Deliverable Loop

- Add cross-session artifact library.
- Support rename, favorite, continue editing, and source-session linking.
- Add workflow save/reuse affordances.
- Expand office and content workflow coverage.

### Phase 3: Make It Work Continuously

- Add workflow completion follow-ups for recurring tasks.
- Add daily report, weekly report, topic tracking, and competitor monitoring templates.
- Repackage IM remote control as an advanced way to command the workbench from a phone.

## Risks

- The current app has many mature capabilities. Hiding them too aggressively could frustrate advanced users.
- The workbench panel could become noisy if materials, artifacts, workflows, and tasks are all shown at once without
  prioritization.
- Artifact metadata derived from conversation history may be incomplete until a dedicated artifact library table exists.
- Some existing docs and UI still reflect historical runtime concepts. These should be cleaned up when changing product
  language.
- Existing first-run setup may still expose model and runtime complexity before users experience value.

## Non-Goals For The First Pass

- Delete Skills, Kits, MCP, Plugins, or IM code.
- Build a full visual workflow builder.
- Replace the OpenClaw runtime.
- Create a cloud marketplace.
- Build a developer-first coding surface.
- Add new medical, pet, or stock assistant flows.

## Success Criteria

The redesign is successful if a new user can understand the product without learning agent infrastructure:

- They can start from a file, folder, link, or workflow card.
- They can see what materials are being used.
- They can see and reuse generated deliverables.
- They can turn a finished task into a recurring task.
- They can ignore Skills, Kits, MCP, Plugins, and runtime settings unless they need advanced configuration.
