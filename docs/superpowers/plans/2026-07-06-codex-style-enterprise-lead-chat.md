# Codex-Style Enterprise Lead Chat Implementation Plan

> **For lijiahao:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan.

Date: 2026-07-06

This plan improves the Enterprise Lead Workspace chat so research, routing, and
agent collaboration feel like one coherent Codex-style assistant turn. The repo
does not create commits until the user explicitly confirms, so this plan ends
with verification and diff review, not commit steps.

## Goal

Make `WorkspaceAiChat` render one coherent assistant answer with a collapsible
process timeline:

- Final answer first.
- Agent/research/routing metadata second.
- Research evidence and next actions available without interrupting the answer.
- No database migration in the first pass.

## Files

- `src/renderer/components/enterpriseLeadWorkspace/workspaceAiChatProcess.ts`
- `src/renderer/components/enterpriseLeadWorkspace/workspaceAiChatProcess.test.ts`
- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx`
- `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- `src/renderer/services/i18n.ts`

## Step 1: Add a Pure Process View Model

Create `workspaceAiChatProcess.ts` beside `WorkspaceAiChat.tsx`.

Add constants and types:

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

Add `deriveWorkspaceAiChatProcess(message)`:

```ts
export function deriveWorkspaceAiChatProcess(
  message: EnterpriseLeadWorkspaceChatMessage,
): WorkspaceAiChatProcess | null {
  if (!message.routing && !message.research && !message.agent) {
    return null;
  }

  const agentLabel = buildAgentLabel(message);
  const steps: WorkspaceAiChatProcessStep[] = [];

  if (message.routing) {
    steps.push({
      id: `${message.id}:routing`,
      kind: WorkspaceAiChatProcessStepKind.Routing,
      status: WorkspaceAiChatProcessStepStatus.Completed,
      titleKey: 'enterpriseLeadAiChatProcessStepRouting',
      detail: message.routing.reason,
    });
  }

  if (message.research) {
    steps.push({
      id: `${message.id}:research`,
      kind: WorkspaceAiChatProcessStepKind.Research,
      status: mapResearchStatus(message.research.status),
      titleKey: 'enterpriseLeadAiChatProcessStepResearch',
      detail: buildResearchDetail(message.research),
    });
  }

  for (const [index, step] of message.routing?.steps.entries() ?? []) {
    steps.push({
      id: `${message.id}:agent-step:${index}`,
      kind: WorkspaceAiChatProcessStepKind.AgentStep,
      status: WorkspaceAiChatProcessStepStatus.Completed,
      titleKey: 'enterpriseLeadAiChatProcessStepAgent',
      detail: step.content,
      agentName: step.agent.name,
    });
  }

  if (message.content.trim()) {
    steps.push({
      id: `${message.id}:answer`,
      kind: WorkspaceAiChatProcessStepKind.Answer,
      status: WorkspaceAiChatProcessStepStatus.Completed,
      titleKey: 'enterpriseLeadAiChatProcessStepAnswer',
    });
  }

  return {
    agentLabel,
    summaryKey: resolveProcessSummaryKey(message),
    summaryDetail: resolveProcessSummaryDetail(message),
    defaultExpanded: false,
    steps,
  };
}
```

Keep helpers pure and fully covered:

- `buildAgentLabel`
- `mapResearchStatus`
- `buildResearchDetail`
- `resolveProcessSummaryKey`
- `resolveProcessSummaryDetail`

## Step 2: Test the View Model

Create `workspaceAiChatProcess.test.ts`.

Cover these cases:

1. Message without agent/routing/research returns `null`.
2. Message with research completed derives a completed research step.
3. Message with routing agents derives a combined agent label.
4. Message with failed research derives a failed research step.
5. Message with skipped research derives a skipped research step.

Representative test:

```ts
import { describe, expect, test } from 'vitest';
import {
  WorkspaceAiChatProcessStepKind,
  WorkspaceAiChatProcessStepStatus,
  deriveWorkspaceAiChatProcess,
} from './workspaceAiChatProcess';

describe('deriveWorkspaceAiChatProcess', () => {
  test('derives routing and research steps from an assistant message', () => {
    const process = deriveWorkspaceAiChatProcess({
      id: 'message-1',
      role: 'assistant',
      content: '目前不能排序，因为没有具体客户名单。',
      createdAt: '2026-07-06T00:00:00.000Z',
      agent: { id: 'opportunity_radar', name: '商机雷达 Agent' },
      routing: {
        reason: '识别到客户优先级判断任务。',
        agents: [
          { id: 'research_helper', name: '调研助手 Agent' },
          { id: 'opportunity_radar', name: '商机雷达 Agent' },
        ],
        steps: [
          {
            agent: { id: 'research_helper', name: '调研助手 Agent' },
            content: '本轮调研没有提取到具体公司名单。',
          },
        ],
      },
      research: {
        status: 'completed',
        provider: 'firecrawl',
        summary: '调研完成，未发现可排序的真实客户名单。',
      },
    });

    expect(process?.agentLabel).toBe('调研助手 Agent + 商机雷达 Agent');
    expect(process?.steps.map((step) => step.kind)).toEqual([
      WorkspaceAiChatProcessStepKind.Routing,
      WorkspaceAiChatProcessStepKind.Research,
      WorkspaceAiChatProcessStepKind.AgentStep,
      WorkspaceAiChatProcessStepKind.Answer,
    ]);
    expect(
      process?.steps.find((step) => step.kind === WorkspaceAiChatProcessStepKind.Research)?.status,
    ).toBe(WorkspaceAiChatProcessStepStatus.Completed);
  });
});
```

Run:

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/workspaceAiChatProcess.test.ts
```

## Step 3: Add Process Summary and Panel Components

Modify `WorkspaceAiChat.tsx`.

Import the new helper:

```ts
import {
  WorkspaceAiChatProcess,
  WorkspaceAiChatProcessStep,
  WorkspaceAiChatProcessStepStatus,
  deriveWorkspaceAiChatProcess,
} from './workspaceAiChatProcess';
```

Add presentational components:

- `WorkspaceAiChatProcessSummary`
- `WorkspaceAiChatProcessPanel`
- `WorkspaceAiChatProcessStepRow`

Expected behavior:

- The summary button renders only when `deriveWorkspaceAiChatProcess(message)`
  returns a process.
- The answer body remains above the process summary.
- Completed messages default collapsed.
- The toggle button has `aria-expanded` and `aria-controls`.
- The process panel uses a compact timeline visual, not a card inside a card.

Use existing icons already imported where possible:

- `CheckIcon` for completed.
- `ExclamationTriangleIcon` for failed.
- `MagnifyingGlassIcon` for research.
- `SparklesIcon` for answer/agent work.

## Step 4: Move Research Status into the Process Panel

Replace the standalone `ResearchStatusChip` placement in completed assistant
messages with process timeline rendering.

Keep research status content, but make it secondary:

- `调研完成` appears in the process summary.
- Provider and summary appear inside the expanded panel.
- Research failure remains visible enough to diagnose, but does not replace the
  final answer.

Do not remove the old helper until all references are gone. If
`ResearchStatusChip` becomes unused, delete it in the same patch.

## Step 5: Add Suggested Action Chips

In `workspaceAiChatProcess.ts`, add:

```ts
export const WorkspaceAiChatSuggestedActionKind = {
  ContinueSearch: 'continue_search',
  ScorePastedList: 'score_pasted_list',
  BuildScreeningSheet: 'build_screening_sheet',
  RetryResearch: 'retry_research',
  RankCandidates: 'rank_candidates',
  DraftFollowUp: 'draft_follow_up',
} as const;
```

Add `deriveWorkspaceAiChatSuggestedActions(message)`:

- If research completed and there are no company candidates:
  - continue search
  - score pasted list
  - build screening sheet
- If research failed:
  - retry research
  - score pasted list
- If company candidates exist:
  - rank candidates
  - draft follow-up

Wire actions in `WorkspaceAiChat.tsx` so clicking an action inserts a draft into
the composer. Use existing prompt-input state rather than adding a backend
command.

Suggested Chinese drafts:

- `继续搜索真实公司，并只保留有采购/扩产/招标/询价信号的客户。`
- `我会粘贴客户名单，请按匹配度、需求强度、成交可能性给出优先级。`
- `生成一个客户筛选表，包含公司、行业、需求信号、来源、优先级和跟进建议。`

## Step 6: Add i18n Strings

Update `src/renderer/services/i18n.ts` with Chinese and English entries.

Required keys:

- `enterpriseLeadAiChatProcessToggle`
- `enterpriseLeadAiChatProcessTitle`
- `enterpriseLeadAiChatProcessStepRouting`
- `enterpriseLeadAiChatProcessStepResearch`
- `enterpriseLeadAiChatProcessStepAgent`
- `enterpriseLeadAiChatProcessStepAnswer`
- `enterpriseLeadAiChatProcessResearchCompleted`
- `enterpriseLeadAiChatProcessResearchFailed`
- `enterpriseLeadAiChatProcessResearchSkipped`
- `enterpriseLeadAiChatProcessResearchPending`
- `enterpriseLeadAiChatProcessNoDetails`
- `enterpriseLeadAiChatSuggestedContinueSearch`
- `enterpriseLeadAiChatSuggestedScorePastedList`
- `enterpriseLeadAiChatSuggestedBuildScreeningSheet`
- `enterpriseLeadAiChatSuggestedRetryResearch`
- `enterpriseLeadAiChatSuggestedRankCandidates`
- `enterpriseLeadAiChatSuggestedDraftFollowUp`

## Step 7: Update UI Tests

Update `enterpriseLeadWorkspaceUi.test.ts`.

Add or adjust tests for:

1. Final answer appears before process summary text.
2. Research status is available inside process UI.
3. The main message surface does not display `自动判断`.
4. Suggested actions appear when research completed without concrete company
   candidates.
5. Historical messages without routing/research still render.

Representative assertions:

```ts
expect(container.textContent?.indexOf('目前不能排序')).toBeLessThan(
  container.textContent?.indexOf('过程') ?? Number.POSITIVE_INFINITY,
);
expect(screen.getByRole('button', { name: /过程/ })).toHaveAttribute(
  'aria-expanded',
  'false',
);
expect(screen.queryByText(/自动判断/)).toBeNull();
```

If the expanded panel is hidden by default, click the toggle before asserting
panel details:

```ts
fireEvent.click(screen.getByRole('button', { name: /过程/ }));
expect(screen.getByText(/调研完成/)).toBeInTheDocument();
```

## Step 8: Verify

Run focused tests:

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/workspaceAiChatProcess.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Run changed-file lint:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/workspaceAiChatProcess.ts src/renderer/components/enterpriseLeadWorkspace/workspaceAiChatProcess.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/services/i18n.ts
```

For UI behavior, start the app and manually validate one sales request:

```bash
npm run electron:dev
```

Manual validation checklist:

- Ask: `帮我判断这批客户谁更值得优先跟进`.
- Confirm the completed assistant turn shows one answer first.
- Confirm process summary is collapsed by default.
- Expand process and confirm research/routing details are visible.
- Confirm no fake customer ranking appears when no concrete customer list was
  found.
- Click a suggested action and confirm it inserts a useful draft.

Finally, run:

```bash
git diff --check
```

Review the diff for unrelated churn and user-visible Chinese/English string
mistakes before handing off.
