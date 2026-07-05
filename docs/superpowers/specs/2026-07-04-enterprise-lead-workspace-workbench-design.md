# Enterprise Lead Workspace Workbench Design

## Goal

Replace the current workspace home default with a single-screen workbench for
managing the workspace's Agents, skills, research capabilities, and domestic
content platform configuration.

The workbench is the workspace landing page. It should not show the project
execution console, output editor, todos, run logs, or recent workspace list by
default.

## Confirmed Layout

The approved design is the v5 single-screen workbench:

- A left internal workspace sidebar.
- The sidebar top label is the current workspace name, not the app name.
- Sidebar entries are 工作台, AI 对话, 知识库, 创作记录, 空间设置.
- The main area is split into Agent 管理 on the left and three configuration
  panels on the right.
- The page avoids nested scroll regions and should fit the four management
  blocks in one workspace screen on desktop.

## Agent Management

Agent 管理 shows the fixed enterprise lead Agent team as 3x3 management cards:

- 项目总控 Agent
- 产品理解 Agent
- 商机雷达 Agent
- 内容策划 Agent
- 社媒运营 Agent
- 销售交接 Agent
- 风控审核 Agent
- 项目归纳 Agent
- 项目归档 Agent

Each card shows:

- avatar / short label
- Agent name
- short role label
- enabled status
- concise description
- ability summary
- 对话 action
- 编辑 action

The separate selected-Agent detail sidebar from earlier mockups is removed.
Detailed input, output, and bound ability fields should live behind 编辑 or a
later management drawer, not on the workbench landing page.

## Configuration Panels

The right side contains three compact panels:

1. 技能管理
   - Shows enabled and pending workspace skills.
   - Has a 管理技能 button.

2. 外部调研能力管理
   - Shows configurable research sources and status.
   - Has a 配置调研能力 button.

3. 内容平台配置
   - Shows domestic content platforms and status.
   - Has a 管理配置 button.

These panels are management summaries. Full editing can be a later drawer or
secondary page.

## Interaction Scope

For this implementation pass:

- The new workbench replaces the workspace home default.
- Buttons can be rendered as entry points without new persistence behavior.
- Existing run console behavior is not removed from the codebase; it is simply
  not the default workspace home view.
- No new IPC or main-process data model is required.

## Testing

Add renderer UI helper coverage for:

- workspace navigation labels include 知识库 and use the workspace name as the
  sidebar brand label.
- Agent management metadata contains the fixed 9 Agent roles.
- Workbench configuration sections expose the three management actions.

Renderer component implementation should then use the tested helpers and the
existing i18n service for user-visible strings.
