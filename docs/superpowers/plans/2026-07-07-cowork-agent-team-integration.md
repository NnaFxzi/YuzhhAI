# Cowork Agent Team Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add request-scoped workspace Agent team routing to Cowork, defaulting to automatic routing with optional
manual workspace Agent targeting.

**Architecture:** Cowork remains on the OpenClaw runtime. The renderer derives enabled workspace Agent choices from an
explicit enterprise workspace context, sends a small selection object with Cowork start and continue requests, and the
main process validates that selection before appending a bounded Agent team prompt bridge.

**Tech Stack:** Electron main/preload IPC, React, Redux Toolkit state already present in the app, TypeScript, Vitest,
existing renderer `i18nService.t()` translations.

## Global Constraints

- Keep Cowork's existing global Agent selector separate from workspace Agent team selection.
- Hide the workspace Agent team selector when no explicit enterprise workspace context is available.
- Do not implement true sequential multi-Agent execution in this phase.
- User-visible renderer strings must use `i18nService.t()` and include Chinese and English translations.
- Do not create commits until the user has tested and confirmed.
- Touched TypeScript and TSX files must pass
  `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 <files>`.

---

## File Structure

- Create `src/shared/cowork/workspaceAgentSelection.ts` for the request selection constants and type guard.
- Create `src/main/enterpriseLeadWorkspace/coworkAgentTeamBridge.ts` for pure main-process prompt bridge construction.
- Create `src/main/enterpriseLeadWorkspace/coworkAgentTeamBridge.test.ts` for bridge tests.
- Create `src/renderer/components/cowork/workspaceAgentTeamOptions.ts` for pure renderer choice derivation.
- Create `src/renderer/components/cowork/workspaceAgentTeamOptions.test.ts` for choice derivation tests.
- Modify `src/renderer/types/cowork.ts`, `src/main/preload.ts`, and `src/renderer/types/electron.d.ts` to carry
  `workspaceAgentSelection`.
- Modify `src/renderer/services/cowork.ts` to forward the selection for start and continue.
- Modify `src/renderer/components/cowork/CoworkPromptInput.tsx` and `src/renderer/components/cowork/CoworkView.tsx` to
  show and submit the selector when a workspace context exists.
- Modify `src/main/main.ts` to validate and append the prompt bridge.
- Modify `src/renderer/services/i18n.ts` for selector copy.

## Task 1: Shared Selection Contract

**Files:**

- Create: `src/shared/cowork/workspaceAgentSelection.ts`
- Modify: `src/renderer/types/cowork.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/types/electron.d.ts`

**Interfaces:**

- Produces: `CoworkWorkspaceAgentMode`, `CoworkWorkspaceAgentSelection`,
  `normalizeCoworkWorkspaceAgentSelection(value): CoworkWorkspaceAgentSelection | null`
- Consumes: no new project code

- [ ] **Step 1: Add the shared type and normalizer test through later bridge and service tests**

Use the final shared shape everywhere:

```ts
export const CoworkWorkspaceAgentMode = {
  Auto: 'auto',
  Manual: 'manual',
} as const;

export type CoworkWorkspaceAgentMode =
  typeof CoworkWorkspaceAgentMode[keyof typeof CoworkWorkspaceAgentMode];

export interface CoworkWorkspaceAgentSelection {
  workspaceId: string;
  mode: CoworkWorkspaceAgentMode;
  agentId?: string;
}
```

- [ ] **Step 2: Add `workspaceAgentSelection?: CoworkWorkspaceAgentSelection | null` to start and continue option types
  **

Update the renderer service types, preload bridge types, and renderer Electron declaration with the same optional field.

## Task 2: Main Prompt Bridge

**Files:**

- Create: `src/main/enterpriseLeadWorkspace/coworkAgentTeamBridge.test.ts`
- Create: `src/main/enterpriseLeadWorkspace/coworkAgentTeamBridge.ts`
- Modify: `src/main/main.ts`

**Interfaces:**

- Consumes: `CoworkWorkspaceAgentSelection`
- Produces: `buildCoworkWorkspaceAgentTeamPrompt(options): string | null`

- [ ] **Step 1: Write failing bridge tests**

Test these exact behaviors:

```ts
test('builds automatic routing context from enabled workspace agents in order', () => {
  const prompt = buildCoworkWorkspaceAgentTeamPrompt({
    workspace: workspaceWithAgents([
      agentBinding('risk_review', 'Risk Agent', 20, true),
      agentBinding('content_planning', 'Content Agent', 10, true),
      agentBinding('disabled_agent', 'Disabled Agent', 30, false),
    ]),
    selection: {
      workspaceId: 'workspace-1',
      mode: CoworkWorkspaceAgentMode.Auto,
    },
  });

  expect(prompt).toContain('Routing mode: auto');
  expect(prompt).toMatch(/Content Agent[\s\S]+Risk Agent/);
  expect(prompt).not.toContain('Disabled Agent');
});
```

Add matching tests for manual target marking, invalid manual fallback to automatic, and bounding long fields.

- [ ] **Step 2: Run the bridge test and confirm it fails because the module does not exist**

Run: `npm test -- src/main/enterpriseLeadWorkspace/coworkAgentTeamBridge.test.ts`

Expected: failure caused by unresolved module or missing function.

- [ ] **Step 3: Implement bridge construction**

Implementation rules:

```ts
const MAX_FIELD_LENGTH = 900;
const MAX_AGENT_COUNT = 12;

export function buildCoworkWorkspaceAgentTeamPrompt(options: {
  workspace: EnterpriseLeadWorkspace | null | undefined;
  selection: CoworkWorkspaceAgentSelection | null | undefined;
}): string | null {
  // Return null unless selection and workspace id match.
  // Use enabled workspace agents only.
  // Sort by order, then name.
  // In manual mode, use the selected enabled agent as the target.
  // If manual selection is invalid, produce automatic context.
  // Bound description, identity, systemPrompt, model name, and skill ids.
}
```

- [ ] **Step 4: Run the bridge test and confirm it passes**

Run: `npm test -- src/main/enterpriseLeadWorkspace/coworkAgentTeamBridge.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Append bridge in Cowork start and continue handlers**

In `src/main/main.ts`, build the prompt bridge after the existing base system prompt is chosen and before the runtime
request is sent. If bridge construction returns null, preserve current Cowork behavior exactly.

## Task 3: Renderer Choice Derivation

**Files:**

- Create: `src/renderer/components/cowork/workspaceAgentTeamOptions.test.ts`
- Create: `src/renderer/components/cowork/workspaceAgentTeamOptions.ts`

**Interfaces:**

- Consumes: `EnterpriseLeadWorkspace`, `CoworkWorkspaceAgentSelection`
- Produces: `deriveWorkspaceAgentTeamChoices(workspace, selection)`

- [ ] **Step 1: Write failing renderer helper tests**

Test these exact behaviors:

```ts
test('derives auto plus enabled workspace agent choices in order', () => {
  const result = deriveWorkspaceAgentTeamChoices(workspaceWithAgents([
    binding('risk_review', 'Risk Agent', 20, true),
    binding('content_planning', 'Content Agent', 10, true),
    binding('disabled', 'Disabled Agent', 30, false),
  ]), null);

  expect(result.shouldShow).toBe(true);
  expect(result.selection.mode).toBe(CoworkWorkspaceAgentMode.Auto);
  expect(result.choices.map((choice) => choice.label)).toEqual([
    'Content Agent',
    'Risk Agent',
  ]);
});
```

Add a test that a removed or disabled manual selection falls back to automatic.

- [ ] **Step 2: Run the helper test and confirm it fails because the module does not exist**

Run: `npm test -- src/renderer/components/cowork/workspaceAgentTeamOptions.test.ts`

Expected: failure caused by unresolved module or missing function.

- [ ] **Step 3: Implement renderer choice derivation**

Return:

```ts
interface WorkspaceAgentTeamChoice {
  id: string;
  label: string;
  description?: string;
  model?: string;
  iconText?: string;
}

interface WorkspaceAgentTeamChoiceState {
  shouldShow: boolean;
  choices: WorkspaceAgentTeamChoice[];
  selection: CoworkWorkspaceAgentSelection | null;
  selectedChoice: WorkspaceAgentTeamChoice | null;
}
```

- [ ] **Step 4: Run the helper test and confirm it passes**

Run: `npm test -- src/renderer/components/cowork/workspaceAgentTeamOptions.test.ts`

Expected: all tests pass.

## Task 4: Renderer UI And Request Forwarding

**Files:**

- Modify: `src/renderer/components/cowork/CoworkPromptInput.tsx`
- Modify: `src/renderer/components/cowork/CoworkView.tsx`
- Modify: `src/renderer/services/cowork.ts`
- Modify: `src/renderer/services/i18n.ts`

**Interfaces:**

- Consumes: `deriveWorkspaceAgentTeamChoices`
- Produces: visible selector and `workspaceAgentSelection` in submitted start and continue requests

- [ ] **Step 1: Update `CoworkPromptInput` props**

Extend `onSubmit` so the final parameter includes `workspaceAgentSelection?: CoworkWorkspaceAgentSelection | null`. Add
optional props for `workspaceAgentTeamState` and `onWorkspaceAgentSelectionChange`.

- [ ] **Step 2: Add compact selector UI**

Render a footer button labeled with `cowork.agentTeam.label` and the current automatic or manual selection only when
`workspaceAgentTeamState.shouldShow` is true.

- [ ] **Step 3: Forward selection through `CoworkView`**

Pass `workspaceAgentSelection` into both `coworkService.startSession` and `coworkService.continueSession`.

- [ ] **Step 4: Forward selection through `coworkService.continueSession`**

Keep existing fields unchanged and add `workspaceAgentSelection: options.workspaceAgentSelection ?? null`.

## Task 5: Main IPC Wiring And Verification

**Files:**

- Modify: `src/main/main.ts`
- Test: bridge and renderer helper tests

**Interfaces:**

- Consumes: `workspaceAgentSelection` from IPC options
- Produces: validated prompt bridge appended to runtime `systemPrompt`

- [ ] **Step 1: Resolve workspace by id**

Use the enterprise lead workspace store to fetch the workspace id from `workspaceAgentSelection.workspaceId`. If lookup
fails, log a warning and continue without the bridge.

- [ ] **Step 2: Append prompt bridge safely**

Append the bridge as a separate section after the existing Cowork system prompt. Do not alter runtime Agent id selection
or model override behavior.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
npm test -- src/main/enterpriseLeadWorkspace/coworkAgentTeamBridge.test.ts
npm test -- src/renderer/components/cowork/workspaceAgentTeamOptions.test.ts
```

- [ ] **Step 4: Run touched-file lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/cowork/workspaceAgentSelection.ts src/main/enterpriseLeadWorkspace/coworkAgentTeamBridge.ts src/main/enterpriseLeadWorkspace/coworkAgentTeamBridge.test.ts src/main/main.ts src/main/preload.ts src/renderer/types/cowork.ts src/renderer/types/electron.d.ts src/renderer/services/cowork.ts src/renderer/components/cowork/workspaceAgentTeamOptions.ts src/renderer/components/cowork/workspaceAgentTeamOptions.test.ts src/renderer/components/cowork/CoworkPromptInput.tsx src/renderer/components/cowork/CoworkView.tsx src/renderer/services/i18n.ts
```

Expected: no ESLint errors or warnings in touched files.
