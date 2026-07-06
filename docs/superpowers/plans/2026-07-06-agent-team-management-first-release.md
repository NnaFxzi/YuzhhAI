# Agent Team Management First Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first release of Agent Team management by aligning the existing workspace Agent UI with chat
auto-routing, response attribution, and a retry-only Agent adjustment entry point.

**Architecture:** Reuse the existing enterprise lead workspace Agent management and chat surfaces. Add lightweight chat
message Agent attribution in shared types, main store persistence, and service responses; keep auto-routing as
`targetAgentId` omitted. Add renderer helper/UI tests before changing the chat controls and message toolbar.

**Tech Stack:** TypeScript, React, Tailwind, Redux-backed renderer tests, Vitest, Electron IPC, SQLite-backed enterprise
lead workspace store.

---

## File Map

- Modify `src/shared/enterpriseLeadWorkspace/types.ts`: add optional chat Agent attribution metadata.
- Modify `src/main/enterpriseLeadWorkspace/store.ts`: persist and read chat Agent attribution metadata.
- Modify `src/main/enterpriseLeadWorkspace/store.test.ts`: cover message attribution round trip.
- Modify `src/main/enterpriseLeadWorkspace/service.ts`: attach selected Agent attribution to assistant messages.
- Modify `src/main/enterpriseLeadWorkspace/service.test.ts`: cover targeted Agent attribution and auto mode without
  attribution.
- Modify `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx`: rename the picker default to Auto,
  render attribution, and add retry-only adjustment drawer.
- Modify `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`: cover picker text,
  attribution, and adjustment drawer static behavior.
- Modify `src/renderer/services/i18n.ts`: add Chinese and English labels for Agent Team, Auto, attribution, and
  adjustment UI.

## Task 1: Persist Chat Agent Attribution

- [ ] Write failing store and service tests for `message.agent`.
- [ ] Run focused tests and confirm they fail because the field is missing.
- [ ] Add `EnterpriseLeadWorkspaceChatAgentAttribution` and optional `agent` field.
- [ ] Add `agent` JSON column migration for `enterprise_lead_chat_messages`.
- [ ] Read/write `agent` through chat message store mapping.
- [ ] Attach selected Agent metadata to assistant messages in `EnterpriseLeadWorkspaceService.chat`.
- [ ] Run focused store/service tests and confirm they pass.

## Task 2: Align Chat Auto Mode And Attribution UI

- [ ] Write failing renderer tests for the Agent picker default label `自动`, assistant attribution text, and adjustment
  entry.
- [ ] Run focused renderer tests and confirm they fail.
- [ ] Rename the default chat picker option from "all" to "auto" in zh/en i18n.
- [ ] Render assistant attribution when `message.agent` exists.
- [ ] Add an "Adjust this Agent" action for attributed assistant messages.
- [ ] Implement a retry-only adjustment drawer that applies a temporary instruction to the composer.
- [ ] Run focused renderer tests and confirm they pass.

## Task 3: Rename Navigation And Workbench Copy

- [ ] Write or update static render assertions for Agent Team wording.
- [ ] Run focused renderer tests and confirm they fail where wording is old.
- [ ] Update sidebar/workbench i18n labels from Agent management wording to Agent Team wording.
- [ ] Run focused renderer tests and confirm they pass.

## Task 4: Verify

- [ ] Run focused tests:

```bash
npm test -- src/main/enterpriseLeadWorkspace/store.test.ts src/main/enterpriseLeadWorkspace/service.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

- [ ] Run touched-file lint:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/enterpriseLeadWorkspace/types.ts src/main/enterpriseLeadWorkspace/store.ts src/main/enterpriseLeadWorkspace/store.test.ts src/main/enterpriseLeadWorkspace/service.ts src/main/enterpriseLeadWorkspace/service.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/services/i18n.ts
```

- [ ] Review the final diff for unrelated churn.
