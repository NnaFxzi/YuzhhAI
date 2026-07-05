# Enterprise Lead Dynamic Workspace Agent Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make newly created enterprise lead execution runs derive their task queue, prompts, and displayed participants
from the current workspace-bound Agents and workspace-local overrides, while keeping old fixed-role run history
readable.

**Architecture:** Add nullable workspace-Agent metadata columns to task rows and broaden task role labels from fixed
enum-only to enum-or-string. The service resolves enabled workspace bindings into immutable per-run Agent snapshots;
prompts and UI display use those snapshots, while legacy rows continue through existing fixed-role metadata. Dynamic run
execution remains structurally compatible with existing output/todo/risk/archive derivation.

**Tech Stack:** Electron main process, TypeScript, better-sqlite3 migrations, React renderer, Vitest, existing
enterprise lead workspace store/service/UI modules.

---

## File Structure

- `src/shared/enterpriseLeadWorkspace/types.ts`: add `EnterpriseLeadWorkspaceRunAgentSnapshot`; broaden
  task/pending/deliverable role types; add `workspaceAgentId` and `agentSnapshot` fields.
- `src/shared/enterpriseLeadWorkspace/validation.ts`: normalize workspace Agent snapshots from stored JSON.
- `src/main/enterpriseLeadWorkspace/store.ts`: migrate `enterprise_lead_agent_tasks` with `workspace_agent_id` and
  `agent_snapshot`; create dynamic task rows; map rows back to new task shape.
- `src/main/enterpriseLeadWorkspace/store.test.ts`: cover schema migration, create/list round trip, and legacy null
  compatibility.
- `src/main/enterpriseLeadWorkspace/service.ts`: resolve new run task inputs from `workspace.workspaceAgents`; merge
  workspace overrides over global Agents; generate prompts/model config from task snapshots.
- `src/main/enterpriseLeadWorkspace/service.test.ts`: cover new run task creation from workspace Agents, workspace-only
  prompt/model use, and fallback to fixed roles when no workspace Agents exist.
- `src/main/enterpriseLeadWorkspace/promptTemplates.ts`: use task snapshot metadata for dynamic Agent tasks and fallback
  to fixed role metadata for old tasks.
- `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`: add safe dynamic Agent label helper.
- `src/renderer/components/enterpriseLeadWorkspace/AgentTaskCard.tsx`, `AgentWorkspaceConsole.tsx`,
  `WorkspaceCreationRecords.tsx`, `WorkspaceSidePanel.tsx`: display task/deliverable/todo/risk labels from dynamic Agent
  snapshots when present.
- `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`: cover dynamic label helper and
  basic render text.

---

## Task 1: Shared Types And Validation

**Files:**

- Modify: `src/shared/enterpriseLeadWorkspace/types.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/validation.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/validation.test.ts`

- [ ] **Step 1: Add failing validation test for workspace Agent snapshots**

Add to `src/shared/enterpriseLeadWorkspace/validation.test.ts`:

```ts
test('normalizes enterprise lead run Agent snapshots', () => {
  const snapshot = normalizeEnterpriseLeadRunAgentSnapshot({
    agentId: ' agent-a ',
    name: ' 内容 Agent ',
    description: ' 内容策划 ',
    identity: ' 专家 ',
    systemPrompt: ' 只写草稿 ',
    icon: ' pen ',
    model: ' gpt-4.1 ',
    skillIds: [' web-search ', '', 'docx'],
  });

  expect(snapshot).toEqual({
    agentId: 'agent-a',
    name: '内容 Agent',
    description: '内容策划',
    identity: '专家',
    systemPrompt: '只写草稿',
    icon: 'pen',
    model: 'gpt-4.1',
    skillIds: ['web-search', 'docx'],
  });
});
```

Run:

```bash
npm test -- enterpriseLeadWorkspace validation
```

Expected: fail because `normalizeEnterpriseLeadRunAgentSnapshot` is not defined.

- [ ] **Step 2: Add shared types**

In `src/shared/enterpriseLeadWorkspace/types.ts`, add:

```ts
export interface EnterpriseLeadWorkspaceRunAgentSnapshot {
  agentId: string;
  name: string;
  description: string;
  identity: string;
  systemPrompt: string;
  icon: string;
  model: string;
  skillIds: string[];
}

export type EnterpriseLeadTaskAgentRole = EnterpriseLeadAgentRole | string;
```

Then update:

```ts
export interface EnterpriseLeadAgentTask {
  id: string;
  runId: string;
  role: EnterpriseLeadTaskAgentRole;
  workspaceAgentId: string | null;
  agentSnapshot: EnterpriseLeadWorkspaceRunAgentSnapshot | null;
  // keep existing fields unchanged
}
```

Also broaden role fields in deliverable/pending/todo/risk-related types that mirror task roles:

```ts
role: EnterpriseLeadTaskAgentRole;
```

Use `EnterpriseLeadTaskAgentRole | null` only where the existing field is nullable.

- [ ] **Step 3: Implement snapshot normalizer**

In `src/shared/enterpriseLeadWorkspace/validation.ts`, export:

```ts
export const normalizeEnterpriseLeadRunAgentSnapshot = (
  value: unknown,
): EnterpriseLeadWorkspaceRunAgentSnapshot | null => {
  const raw = readRecord(value);
  const agentId = cleanText(raw.agentId);
  if (!agentId) return null;

  return {
    agentId,
    name: cleanText(raw.name) || agentId,
    description: cleanText(raw.description),
    identity: cleanText(raw.identity),
    systemPrompt: cleanText(raw.systemPrompt),
    icon: cleanText(raw.icon),
    model: cleanText(raw.model),
    skillIds: readStringArray(raw.skillIds),
  };
};
```

If `readStringArray` is not exported/available in the file, add a local helper:

```ts
const readStringArray = (value: unknown): string[] => (
  Array.isArray(value)
    ? value.map(cleanText).filter(Boolean)
    : []
);
```

- [ ] **Step 4: Run validation tests**

Run:

```bash
npm test -- enterpriseLeadWorkspace validation
```

Expected: validation tests pass.

---

## Task 2: Store Schema And Dynamic Task Rows

**Files:**

- Modify: `src/main/enterpriseLeadWorkspace/store.ts`
- Modify: `src/main/enterpriseLeadWorkspace/store.test.ts`

- [ ] **Step 1: Add failing store tests**

Add to `src/main/enterpriseLeadWorkspace/store.test.ts`:

```ts
test('creates dynamic workspace Agent task rows with Agent snapshots', () => {
  const workspace = store.createWorkspace({
    name: '动态 Agent 工作区',
    type: 'enterprise_lead',
    profile,
    extractionSources: [],
    enabledAgentRoles: [],
    workspaceAgents: [],
  });

  const run = store.createRun({
    workspaceId: workspace.id,
    userGoal: '生成获客方案',
    tasks: [{
      role: 'agent-a',
      workspaceAgentId: 'agent-a',
      agentSnapshot: {
        agentId: 'agent-a',
        name: '内容 Agent',
        description: '写内容',
        identity: '内容专家',
        systemPrompt: '只生成草稿',
        icon: 'pen',
        model: 'gpt-4.1',
        skillIds: ['web-search'],
      },
    }],
  });

  const tasks = store.listTasks(run.id);
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({
    role: 'agent-a',
    workspaceAgentId: 'agent-a',
    agentSnapshot: {
      agentId: 'agent-a',
      name: '内容 Agent',
      model: 'gpt-4.1',
      skillIds: ['web-search'],
    },
  });
});
```

Also add a legacy compatibility test:

```ts
test('lists legacy fixed-role task rows with null workspace Agent metadata', () => {
  const workspace = store.createWorkspace({
    name: '旧版工作区',
    type: 'enterprise_lead',
    profile,
    extractionSources: [],
    enabledAgentRoles: [],
    workspaceAgents: [],
  });

  const run = store.createRun({
    workspaceId: workspace.id,
    userGoal: '旧版执行',
    roles: [EnterpriseLeadAgentRole.ContentPlanning],
  });

  expect(store.listTasks(run.id)[0]).toMatchObject({
    role: EnterpriseLeadAgentRole.ContentPlanning,
    workspaceAgentId: null,
    agentSnapshot: null,
  });
});
```

Run:

```bash
npm test -- enterpriseLeadWorkspace store
```

Expected: fail because `createRun` does not accept `tasks` and mapped task fields are missing.

- [ ] **Step 2: Extend store input types**

In `src/main/enterpriseLeadWorkspace/store.ts`, replace the current `CreateEnterpriseLeadRunInput` shape with:

```ts
interface CreateEnterpriseLeadTaskInput {
  role: EnterpriseLeadTaskAgentRole;
  workspaceAgentId?: string | null;
  agentSnapshot?: EnterpriseLeadWorkspaceRunAgentSnapshot | null;
}

interface CreateEnterpriseLeadRunInput {
  workspaceId: string;
  userGoal: string;
  roles?: EnterpriseLeadAgentRole[];
  tasks?: CreateEnterpriseLeadTaskInput[];
}
```

- [ ] **Step 3: Add migrations**

In `EnterpriseLeadWorkspaceStore.migrateAgentTasks`, after the existing `sequence` migration:

```ts
if (!columnNames.has('workspace_agent_id')) {
  this.db.exec('ALTER TABLE enterprise_lead_agent_tasks ADD COLUMN workspace_agent_id TEXT;');
}
if (!columnNames.has('agent_snapshot')) {
  this.db.exec('ALTER TABLE enterprise_lead_agent_tasks ADD COLUMN agent_snapshot TEXT;');
}
```

Also add both columns to the `CREATE TABLE IF NOT EXISTS enterprise_lead_agent_tasks` statement:

```sql
workspace_agent_id TEXT,
agent_snapshot TEXT,
```

- [ ] **Step 4: Write dynamic task rows**

In `createRun`, derive task inputs before the transaction:

```ts
const taskInputs: CreateEnterpriseLeadTaskInput[] =
  input.tasks && input.tasks.length > 0
    ? input.tasks
    : (input.roles ?? []).map(role => ({
        role,
        workspaceAgentId: null,
        agentSnapshot: null,
      }));
```

Set:

```ts
currentRole: taskInputs[0]?.role ?? null,
```

Update `INSERT INTO enterprise_lead_agent_tasks` to include `workspace_agent_id` and `agent_snapshot`, and pass:

```ts
task.workspaceAgentId ?? null,
task.agentSnapshot ? JSON.stringify(task.agentSnapshot) : null,
```

- [ ] **Step 5: Map task rows**

Update task row type and mapper to read:

```ts
workspace_agent_id as workspaceAgentId,
agent_snapshot as agentSnapshot,
```

Then map:

```ts
workspaceAgentId: row.workspaceAgentId ?? null,
agentSnapshot: row.agentSnapshot
  ? normalizeEnterpriseLeadRunAgentSnapshot(parseJsonValue(row.agentSnapshot, null))
  : null,
```

- [ ] **Step 6: Run store tests**

Run:

```bash
npm test -- enterpriseLeadWorkspace store
```

Expected: store tests pass.

---

## Task 3: Service Agent Resolution And Runner Prompts

**Files:**

- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.test.ts`
- Modify: `src/main/enterpriseLeadWorkspace/promptTemplates.ts`

- [ ] **Step 1: Add failing service tests for dynamic run creation**

Add to `src/main/enterpriseLeadWorkspace/service.test.ts`:

```ts
test('creates new runs from enabled workspace Agents with local overrides', () => {
  const setup = createService({
    agentProvider: createAgentProvider([{
      id: 'agent-content',
      name: 'Global Content Agent',
      description: 'Global desc',
      identity: 'Global identity',
      systemPrompt: 'Global prompt',
      icon: 'pen',
      model: 'global-model',
      skillIds: ['global-skill'],
      enabled: true,
    }]),
  });
  db = setup.db;
  const workspace = setup.store.createWorkspace({
    name: '动态 Agent 工作区',
    type: 'enterprise_lead',
    profile: draftPayload().profile,
    extractionSources: [draftPayload().source],
    enabledAgentRoles: [EnterpriseLeadAgentRole.RiskReview],
    workspaceAgents: [{
      agentId: 'agent-content',
      enabled: true,
      order: 0,
      overrides: {
        name: '空间内容 Agent',
        systemPrompt: '只写制造业内容草稿。',
        model: 'workspace-model',
        skillIds: ['workspace-skill'],
      },
    }],
  });

  const snapshot = setup.service.createRun(workspace.id, '生成内容草稿');

  expect(snapshot.tasks).toHaveLength(1);
  expect(snapshot.tasks[0]).toMatchObject({
    role: 'agent-content',
    workspaceAgentId: 'agent-content',
    agentSnapshot: {
      agentId: 'agent-content',
      name: '空间内容 Agent',
      systemPrompt: '只写制造业内容草稿。',
      model: 'workspace-model',
      skillIds: ['workspace-skill'],
    },
  });
});
```

Add fallback coverage:

```ts
test('falls back to fixed enterprise roles when workspace has no workspace Agents', () => {
  const setup = createService();
  db = setup.db;
  const workspace = setup.service.createWorkspace(draftPayload());

  const snapshot = setup.service.createRun(workspace.id, '旧版执行');

  expect(snapshot.tasks[0].workspaceAgentId).toBeNull();
  expect(snapshot.tasks.map(task => task.role)).toEqual(
    ENTERPRISE_LEAD_AGENT_WORKFLOW.map(agent => agent.role),
  );
});
```

- [ ] **Step 2: Add failing prompt/model test**

Add:

```ts
test('runs dynamic workspace Agent task with Agent snapshot prompt and model', async () => {
  const setup = createService({
    agentProvider: createAgentProvider([{
      id: 'agent-content',
      name: 'Global Content Agent',
      systemPrompt: 'Global prompt',
      model: 'global-model',
      skillIds: [],
      enabled: true,
    }]),
  });
  db = setup.db;
  const workspace = setup.store.createWorkspace({
    name: '动态 Agent 工作区',
    type: 'enterprise_lead',
    profile: draftPayload().profile,
    extractionSources: [draftPayload().source],
    enabledAgentRoles: [],
    workspaceAgents: [{
      agentId: 'agent-content',
      enabled: true,
      order: 0,
      overrides: {
        name: '空间内容 Agent',
        systemPrompt: '只写制造业内容草稿。',
        model: 'workspace-model',
      },
    }],
  });
  const snapshot = setup.service.createRun(workspace.id, '生成内容草稿');
  setup.modelClient.enqueue({
    role: 'agent-content',
    status: EnterpriseLeadTaskStatus.Completed,
    summary: '空间内容 Agent 已完成。',
    outputs: {},
    missingInfo: [],
    todos: [],
    risks: [],
    handoffContext: {},
  });

  await setup.service.runTask(snapshot.tasks[0].id);

  const prompt = setup.modelClient.prompts.at(-1)?.prompt ?? '';
  expect(prompt).toContain('空间内容 Agent');
  expect(prompt).toContain('只写制造业内容草稿。');
  expect(setup.modelClient.prompts.at(-1)?.model).toBe('workspace-model');
});
```

- [ ] **Step 3: Resolve dynamic task inputs**

In `EnterpriseLeadWorkspaceService.createRun`, replace selected-role-only logic with:

```ts
const taskInputs = this.resolveRunTaskInputs(workspace);
const run = this.store.createRun({
  workspaceId,
  userGoal,
  tasks: taskInputs.length > 0 ? taskInputs : undefined,
  roles: taskInputs.length > 0 ? undefined : this.resolveLegacyRunRoles(workspace),
});
```

Add:

```ts
private resolveLegacyRunRoles(workspace: EnterpriseLeadWorkspace): EnterpriseLeadAgentRole[] {
  const selectedRoles = workspace.enabledAgentRoles.filter(isEnterpriseLeadAgentRole);
  return selectedRoles.length > 0 ? selectedRoles : workflowRoles();
}

private resolveRunTaskInputs(workspace: EnterpriseLeadWorkspace): Array<{
  role: string;
  workspaceAgentId: string;
  agentSnapshot: EnterpriseLeadWorkspaceRunAgentSnapshot;
}> {
  return this.resolveEffectiveWorkspaceAgents(workspace)
    .map(agent => ({
      role: agent.id,
      workspaceAgentId: agent.id,
      agentSnapshot: {
        agentId: agent.id,
        name: agent.name,
        description: agent.description,
        identity: agent.identity,
        systemPrompt: agent.systemPrompt,
        icon: agent.icon,
        model: agent.model,
        skillIds: agent.skillIds,
      },
    }));
}
```

- [ ] **Step 4: Use dynamic task metadata in prompts**

In `promptTemplates.ts`, add:

```ts
const getTaskPromptMetadata = (task: EnterpriseLeadAgentTask) => {
  if (task.agentSnapshot) {
    return {
      title: task.agentSnapshot.name,
      description: task.agentSnapshot.description || task.agentSnapshot.identity || '当前工作区 Agent。',
      inputSummary: '用户目标、工作空间资料、上游 Agent 输出',
      outputSummary: '符合该 Agent 提示词的结构化结果',
      systemPrompt: task.agentSnapshot.systemPrompt,
    };
  }
  const metadata = getEnterpriseLeadAgentMetadata(task.role as EnterpriseLeadAgentRole);
  return {
    ...metadata,
    systemPrompt: '',
  };
};
```

Use it in both `buildAgentTaskPrompt` and `buildAgentChatPrompt`, adding `metadata.systemPrompt` to the prompt when
present:

```ts
metadata.systemPrompt ? `Agent 系统提示词：${metadata.systemPrompt}` : '',
```

- [ ] **Step 5: Use dynamic task model**

In `runTask` and `createPendingVersionFromChat`, pass task model when present:

```ts
const taskModel = taskContext.task.agentSnapshot?.model?.trim();
const result = await this.modelClient.generate({
  prompt: buildAgentTaskPrompt(taskContext),
  apiConfig: resolveWorkspaceApiConfig(taskContext.workspace),
  ...(taskModel ? { model: taskModel } : {}),
});
```

- [ ] **Step 6: Run service tests**

Run:

```bash
npm test -- enterpriseLeadWorkspace service
```

Expected: service tests pass.

---

## Task 4: Renderer Dynamic Agent Labels

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/AgentTaskCard.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/AgentWorkspaceConsole.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreationRecords.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceSidePanel.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [ ] **Step 1: Add failing label helper test**

Add:

```ts
test('uses workspace Agent snapshot labels for dynamic tasks', () => {
  expect(getEnterpriseLeadTaskDisplay({
    role: 'agent-content',
    agentSnapshot: {
      agentId: 'agent-content',
      name: '空间内容 Agent',
      description: '写内容',
      identity: '',
      systemPrompt: '',
      icon: 'pen',
      model: '',
      skillIds: [],
    },
  }).title).toBe('空间内容 Agent');
});
```

- [ ] **Step 2: Implement display helper**

In `enterpriseLeadWorkspaceUi.ts`, add:

```ts
export const getEnterpriseLeadTaskDisplay = (
  input: Pick<EnterpriseLeadAgentTask, 'role' | 'agentSnapshot'> | {
    role?: EnterpriseLeadTaskAgentRole | null;
    agentSnapshot?: EnterpriseLeadWorkspaceRunAgentSnapshot | null;
  },
): { title: string; shortLabel: string; titleKey?: string } => {
  if (input.agentSnapshot) {
    const title = input.agentSnapshot.name || input.agentSnapshot.agentId;
    return {
      title,
      shortLabel: title.trim().charAt(0).toUpperCase() || '#',
    };
  }
  if (input.role && Object.values(EnterpriseLeadAgentRole).includes(input.role as EnterpriseLeadAgentRole)) {
    const metadata = getAgentRoleLabel(input.role as EnterpriseLeadAgentRole);
    return {
      title: metadata.titleKey,
      shortLabel: metadata.shortLabelKey,
      titleKey: metadata.titleKey,
    };
  }
  const title = String(input.role ?? '');
  return {
    title,
    shortLabel: title.trim().charAt(0).toUpperCase() || '#',
  };
};
```

Renderer components should call `i18nService.t(display.titleKey)` when `titleKey` exists, otherwise use `display.title`.

- [ ] **Step 3: Update task cards and details**

Replace direct `getAgentRoleLabel(task.role)` calls in the listed renderer files with
`getEnterpriseLeadTaskDisplay(task)`.

For todos/risks/deliverables that only have a role string and no snapshot, keep current fixed-role behavior for enum
roles and raw string fallback for dynamic roles.

- [ ] **Step 4: Run UI tests**

Run:

```bash
npm test -- enterpriseLeadWorkspaceUi
```

Expected: UI tests pass.

---

## Task 5: Integration Verification And Review

**Files:**

- Review all touched files.
- Modify tests only if failures reveal missing coverage.

- [ ] **Step 1: Run enterprise workspace tests**

Run:

```bash
npm test -- enterpriseLeadWorkspace
```

Expected: all enterprise lead workspace tests pass.

- [ ] **Step 2: Run external research tests**

Run:

```bash
npm test -- agentExternalResearchService
```

Expected: all external research tests still pass.

- [ ] **Step 3: Run targeted ESLint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 $(git status --short | awk '{print $2}' | grep -E '\.(ts|tsx)$')
```

Expected: no ESLint errors or warnings.

- [ ] **Step 4: Compile Electron**

Run:

```bash
npm run compile:electron
```

Expected: Electron main/preload TypeScript compile passes. If sandbox blocks native dependency rebuild writes to
`~/.npm` or `~/.electron-gyp`, rerun with approved escalation.

- [ ] **Step 5: Final review checklist**

Verify:

- New runs with enabled `workspaceAgents` produce task rows with `workspaceAgentId` and `agentSnapshot`.
- New runs without `workspaceAgents` still produce fixed-role tasks.
- `runTask` for dynamic tasks uses task snapshot name/systemPrompt/model.
- Old fixed-role runs still render with role labels and can be listed/opened.
- Workbench-created Agent binding affects the next run only after saving to the workspace.
- No prompt path serializes provider API keys.

