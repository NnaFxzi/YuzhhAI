# Codex-Style Enterprise Lead Chat Design

Date: 2026-07-06

## Summary

The current Enterprise Lead Workspace chat makes the user feel like they are
watching several separate systems talk: research finishes, routing appears,
an agent answers, and then the answer sometimes asks for the same missing input
again. The target experience should feel closer to Codex: one user request
produces one coherent assistant turn, while tool work, agent routing, research
sources, and intermediate steps stay visible as secondary process context.

The first implementation should be mostly renderer-side and should reuse the
existing message model:

- `message.research` for search status, provider, summary, and candidates.
- `message.routing` for selected agents, route reason, and step outputs.
- `message.agent` for the final answering agent.
- `message.content` as the user-facing answer.

No database migration is required in the first phase.

## Problem

The bad example from the sales scenario exposed several interaction issues:

- The answer says it cannot rank concrete customers, but the UI also shows a
  separate "research completed" block, making the turn feel stitched together.
- Routing text such as "自动判断：销售部 与任务匹配" reads like internal plumbing
  rather than useful progress.
- Multi-agent steps compete with the final answer instead of supporting it.
- When research already completed and still found no real customer list, the
  final answer asks the user whether to authorize search again.
- Generic customer-type tables are used as a substitute for ranking actual
  customers, which weakens trust.

The product goal is not to hide the process. The goal is to make the process
subordinate to the answer, with enough transparency for the user to inspect how
the answer was produced.

## Design Principles

1. One user question maps to one user-visible assistant turn.
2. The final answer is always the primary surface.
3. Research, routing, tools, and agent collaboration are shown as a collapsible
   process timeline.
4. Agent identity is a quiet attribution, not a separate speaker unless the
   user explicitly opens the process details.
5. The assistant must distinguish "no concrete customer list exists" from
   "there are customer-type hypotheses".
6. Follow-up actions should move the work forward instead of asking the user to
   restart the same flow.

## Target Conversation Shape

### Completed Turn

The completed assistant message should have this structure:

1. Final answer content.
2. Quiet attribution line, for example:
  - `商机雷达 Agent`
  - `调研助手 + 商机雷达`
3. Collapsed process summary:
  - `过程 · 4 步 · 调研完成`
4. Optional suggested next actions:
  - `继续搜索真实公司`
  - `粘贴客户名单后评分`
  - `生成客户筛选表`

The process summary expands into a timeline:

1. `理解任务`
2. `调研`
3. `Agent 协作`
4. `生成答案`

### Pending Turn

While a request is running, the pending row should use the same timeline model
instead of separate status badges. This makes the transition from running to
completed feel continuous:

- `理解任务` completed when route intent is known.
- `调研` active, skipped, completed, or failed.
- `Agent 协作` active when routing steps are being collected.
- `生成答案` active while final text is being generated.

### Process Panel

The process panel is collapsed by default for completed messages and expanded
for pending messages. It contains process metadata, not hidden reasoning.

Recommended details:

- Routing: selected agent names and a short user-facing route label.
- Research: status, provider, and a short summary.
- Agent steps: agent name and short output preview.
- Evidence: lead candidates and source snippets where available.

Avoid exposing internal labels such as "自动判断" in the main message surface.

## Sales Scenario Behavior

For "帮我判断这批客户谁更值得优先跟进", if research completed but found no concrete
company list, the assistant should answer in this shape:

1. Direct conclusion:
  - "这批客户目前还不能排序，因为没有具体客户名单。"
2. Evidence boundary:
  - "本轮调研没有提取到可核验的公司名称、采购需求和来源组合。"
3. Useful partial signal:
  - "能看到的是行业方向，机械设备厂优先，其次是海外采购商/外贸公司。"
4. Next action:
  - "我可以继续搜索真实公司，或你把名单贴过来后我直接评分。"

It should not:

- Pretend there is a real customer ranking.
- Use a customer-type table as if it were a customer list.
- Ask whether to authorize search if the current turn already performed
  research.

## Data Model Mapping

The first phase derives a view model from the existing chat message:

```ts
export const WorkspaceAiChatProcessStepKind = {
  Routing: 'routing',
  Research: 'research',
  AgentStep: 'agent_step',
  Answer: 'answer',
} as const;

export type WorkspaceAiChatProcessStepKind =
  typeof WorkspaceAiChatProcessStepKind[keyof typeof WorkspaceAiChatProcessStepKind];

export const WorkspaceAiChatProcessStepStatus = {
  Pending: 'pending',
  Active: 'active',
  Completed: 'completed',
  Skipped: 'skipped',
  Failed: 'failed',
} as const;

export type WorkspaceAiChatProcessStepStatus =
  typeof WorkspaceAiChatProcessStepStatus[keyof typeof WorkspaceAiChatProcessStepStatus];

export interface WorkspaceAiChatProcessStep {
  id: string;
  kind: WorkspaceAiChatProcessStepKind;
  status: WorkspaceAiChatProcessStepStatus;
  titleKey: string;
  detail?: string;
  agentName?: string;
}

export interface WorkspaceAiChatProcess {
  agentLabel?: string;
  summaryKey: string;
  summaryDetail?: string;
  defaultExpanded: boolean;
  steps: WorkspaceAiChatProcessStep[];
}
```

The view model can be derived without changing persisted messages:

- `message.routing.agents` -> process agent label.
- `message.routing.reason` -> process panel detail only.
- `message.routing.steps` -> agent collaboration timeline steps.
- `message.research.status` -> research step status.
- `message.research.provider` and `message.research.summary` -> research detail.
- `message.content` -> final answer step.

## Component Model

Recommended new renderer helper:

- `src/renderer/components/enterpriseLeadWorkspace/workspaceAiChatProcess.ts`

Recommended UI components:

- `WorkspaceAiChatProcessSummary`
- `WorkspaceAiChatProcessPanel`
- `WorkspaceAiChatProcessStepRow`
- `WorkspaceAiChatSuggestedActions`

`WorkspaceAiChat.tsx` is already a large file, so derivation logic should live
in the helper module. Small presentational components can stay in
`WorkspaceAiChat.tsx` initially, then be extracted if the file grows further.

## Suggested Actions

Suggested actions should be derived from structured state when possible:

- Research completed and no concrete company candidates:
  - `继续搜索真实公司`
  - `粘贴客户名单后评分`
  - `生成客户筛选表`
- Research failed:
  - `重试调研`
  - `改用手动名单`
- Concrete candidates found:
  - `按优先级排序`
  - `生成跟进话术`
  - `导出线索表`

In the first phase, clicking an action can insert a draft into the composer.
It does not need a new backend command.

## Acceptance Criteria

- A completed assistant message renders final answer content before research or
  routing process UI.
- Research status appears inside the process panel, not as a competing answer
  block.
- Routing reasons are inspectable but not shown as "自动判断" in the main answer
  surface.
- The no-concrete-customer scenario does not show a fake ranked customer list.
- Existing historical messages without `research` or `routing` still render
  normally.
- The process toggle uses `aria-expanded` and a stable panel id.
- New user-visible strings are added to both Chinese and English i18n entries.
- Renderer tests cover the derived process model and message row rendering.
