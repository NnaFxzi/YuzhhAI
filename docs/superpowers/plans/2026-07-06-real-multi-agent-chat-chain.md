# Real Multi-Agent Chat Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking. Project policy: do not create commits until the user has tested and
> confirmed.

**Goal:** Upgrade workspace chat from lightweight Agent chain attribution to real sequential multi-Agent execution for
routed multi-Agent tasks.

**Architecture:** Keep the existing chat flow: planning -> research -> answer. When routing resolves more than one
Agent, run each routed Agent in order with its own prompt and model, collect step outputs, then pass those outputs to
the final synthesis prompt. Persist step metadata inside chat message routing so the UI can later inspect the chain
without another query.

**Tech Stack:** TypeScript, Vitest, React renderer tests, SQLite JSON persistence, Electron main process service layer.

---

## File Map

- Modify `src/shared/enterpriseLeadWorkspace/types.ts`: add optional `steps` to `EnterpriseLeadWorkspaceChatRouting`.
- Modify `src/main/enterpriseLeadWorkspace/promptTemplates.ts`: add `buildWorkspaceChatAgentStepPrompt()` and include
  `agentStepResults` in the final response prompt.
- Modify `src/main/enterpriseLeadWorkspace/service.ts`: execute routed Agents sequentially when
  `route.agents.length > 1`, then synthesize the final answer.
- Modify `src/main/enterpriseLeadWorkspace/service.test.ts`: verify private-message tasks call content planning, sales
  handoff, risk review, and final synthesis.
- Re-run existing store/UI tests because routing JSON is already persisted and displayed.

## Task 1: Add Chain Step Metadata

- [ ] Extend `EnterpriseLeadWorkspaceChatRouting` with:

```ts
steps?: EnterpriseLeadWorkspaceChatRouteStep[];

export interface EnterpriseLeadWorkspaceChatRouteStep {
  agent: EnterpriseLeadWorkspaceChatAgentAttribution;
  content: string;
}
```

- [ ] Keep `steps` optional so existing stored routing JSON remains valid.

## Task 2: Add Per-Agent Step Prompt

- [ ] Add `WorkspaceChatAgentStepPromptInput` in `promptTemplates.ts` with workspace, current Agent, routing, recent
  messages, user message, research result, recent run outputs, and prior step results.
- [ ] Add `buildWorkspaceChatAgentStepPrompt()` that asks the current Agent to produce only its intermediate
  contribution, not a final user-facing answer.
- [ ] Update `buildWorkspaceChatResponsePrompt()` to accept `agentStepResults?: EnterpriseLeadWorkspaceChatRouteStep[]`
  and include them under `多 Agent 中间结果`.

## Task 3: Execute Sequential Agent Steps

- [ ] In `EnterpriseLeadWorkspaceService.chat()`, after research and before final answer, call a new helper
  `runWorkspaceChatAgentSteps()`.
- [ ] The helper should return `[]` for no route, one-Agent routes, and shortcut answers.
- [ ] For multi-Agent routes, call the model once per Agent, passing prior step outputs to later Agents.
- [ ] Use each Agent's configured model when present.
- [ ] Persist returned steps under `message.routing.steps`.

## Task 4: Tests And Verification

- [ ] Update the private-message auto-route test to enqueue three Agent step outputs plus a final answer.
- [ ] Assert prompt order includes:
  - planning prompt
  - `内容策划 Agent` step prompt
  - `销售交接 Agent` step prompt
  - `风控审核 Agent` step prompt
  - final synthesis prompt
- [ ] Assert `response.message.routing.steps` stores the three step outputs.
- [ ] Run:

```bash
npm test -- src/main/enterpriseLeadWorkspace/store.test.ts src/main/enterpriseLeadWorkspace/service.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/enterpriseLeadWorkspace/types.ts src/main/enterpriseLeadWorkspace/service.ts src/main/enterpriseLeadWorkspace/service.test.ts src/main/enterpriseLeadWorkspace/promptTemplates.ts
npx tsc --noEmit --pretty false
npm test
```
