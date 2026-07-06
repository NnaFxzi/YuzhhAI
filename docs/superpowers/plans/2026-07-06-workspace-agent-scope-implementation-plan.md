# Workspace Agent Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement system-only global Agent templates and workspace-private user-created Agents for enterprise lead
workspaces.

**Architecture:** Add explicit workspace Agent source metadata, normalize legacy workspace Agent bindings, and keep
runtime resolution workspace-local. Update the workspace Agent UI to separate system templates from workspace instances
and replace free-form model/skill fields with validated selectors.

**Tech Stack:** TypeScript, React, Redux Toolkit, Vitest, Electron IPC, SQLite-backed enterprise lead workspace store.

---

## File Map

- Modify `src/shared/enterpriseLeadWorkspace/types.ts`: add `WorkspaceAgentSource` and fields on
  `EnterpriseLeadWorkspaceAgentBinding`.
- Modify `src/shared/enterpriseLeadWorkspace/validation.ts`: normalize workspace Agent source and template metadata.
- Modify `src/shared/enterpriseLeadWorkspace/validation.test.ts`: cover source migration and fallback behavior.
- Modify `src/main/enterpriseLeadWorkspace/store.ts`: persist and round trip normalized workspace Agent bindings.
- Modify `src/main/enterpriseLeadWorkspace/store.test.ts`: cover workspace privacy and source round trips.
- Modify `src/main/enterpriseLeadWorkspace/service.ts`: resolve system-template and workspace-created Agents explicitly.
- Modify `src/main/enterpriseLeadWorkspace/service.test.ts`: cover runtime resolution and immutable snapshots.
- Modify `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`: add display helpers for
  workspace Agent source labels.
- Modify `src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx`: split system templates from workspace
  Agents, add source badges, replace raw model/skill inputs.
- Modify `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`: cover UI rendering,
  add-from-template, editor validation, and disabled filters.
- Modify `src/renderer/services/i18n.ts`: add zh/en labels for system templates, workspace Agents, validation, and save
  failure states.

## Task 1: Add Workspace Agent Source Types

**Files:**

- Modify: `src/shared/enterpriseLeadWorkspace/types.ts`

- [ ] **Step 1: Add source constants and fields**

Add an `as const` source object near the existing workspace Agent types.

```ts
export const WorkspaceAgentSource = {
  SystemTemplate: 'system_template',
  WorkspaceCreated: 'workspace_created',
} as const;

export type WorkspaceAgentSource =
  typeof WorkspaceAgentSource[keyof typeof WorkspaceAgentSource];
```

Update `EnterpriseLeadWorkspaceAgentBinding`:

```ts
export interface EnterpriseLeadWorkspaceAgentBinding {
  agentId: string;
  enabled: boolean;
  order: number;
  source: WorkspaceAgentSource;
  templateId?: string;
  name?: string;
  description?: string;
  identity?: string;
  systemPrompt?: string;
  icon?: string;
  model?: string;
  skillIds?: string[];
  overrides: EnterpriseLeadWorkspaceAgentOverrides;
}
```

- [ ] **Step 2: Run typecheck target that catches shared type errors**

Run: `npm test -- src/shared/enterpriseLeadWorkspace/validation.test.ts`

Expected: tests may fail because normalization has not been updated yet; TypeScript should identify missing `source`
assumptions in touched code.

## Task 2: Normalize Legacy Workspace Agent Bindings

**Files:**

- Modify: `src/shared/enterpriseLeadWorkspace/validation.ts`
- Test: `src/shared/enterpriseLeadWorkspace/validation.test.ts`

- [ ] **Step 1: Write failing normalization tests**

Add tests covering these cases:

```ts
test('normalizes legacy system workspace agent bindings with source metadata', () => {
  const workspace = normalizeEnterpriseLeadWorkspace({
    ...baseWorkspaceInput(),
    workspaceAgents: [
      { agentId: 'content_planning', enabled: true, order: 0, overrides: { name: 'Content' } },
    ],
  });

  expect(workspace.workspaceAgents[0]).toMatchObject({
    agentId: 'content_planning',
    source: WorkspaceAgentSource.SystemTemplate,
    templateId: 'content_planning',
  });
});

test('normalizes unknown legacy workspace agent bindings as workspace-created', () => {
  const workspace = normalizeEnterpriseLeadWorkspace({
    ...baseWorkspaceInput(),
    workspaceAgents: [
      { agentId: 'local-writer', enabled: true, order: 0, overrides: { name: 'Local Writer' } },
    ],
  });

  expect(workspace.workspaceAgents[0]).toMatchObject({
    agentId: 'local-writer',
    source: WorkspaceAgentSource.WorkspaceCreated,
  });
  expect(workspace.workspaceAgents[0].templateId).toBeUndefined();
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- src/shared/enterpriseLeadWorkspace/validation.test.ts`

Expected: FAIL because `WorkspaceAgentSource` is not imported or normalization does not populate `source`.

- [ ] **Step 3: Implement normalization**

In `validation.ts`, import `WorkspaceAgentSource` and use a system-template id set built from `EnterpriseLeadAgentRole`.

Implementation shape:

```ts
const SystemWorkspaceAgentTemplateIds = new Set<string>(
  Object.values(EnterpriseLeadAgentRole),
);

const normalizeWorkspaceAgentSource = (
  agentId: string,
  record: Record<string, unknown>,
): {
  source: WorkspaceAgentSource;
  templateId?: string;
} => {
  const rawSource = typeof record.source === 'string' ? record.source.trim() : '';
  const rawTemplateId = typeof record.templateId === 'string' ? record.templateId.trim() : '';

  if (rawSource === WorkspaceAgentSource.SystemTemplate) {
    const templateId = rawTemplateId || agentId;
    return {
      source: WorkspaceAgentSource.SystemTemplate,
      templateId,
    };
  }

  if (rawSource === WorkspaceAgentSource.WorkspaceCreated) {
    return { source: WorkspaceAgentSource.WorkspaceCreated };
  }

  if (SystemWorkspaceAgentTemplateIds.has(agentId)) {
    return {
      source: WorkspaceAgentSource.SystemTemplate,
      templateId: agentId,
    };
  }

  return { source: WorkspaceAgentSource.WorkspaceCreated };
};
```

Apply this in the binding normalization function before returning the normalized binding.

- [ ] **Step 4: Verify shared tests**

Run: `npm test -- src/shared/enterpriseLeadWorkspace/validation.test.ts`

Expected: PASS.

## Task 3: Persist Source Metadata in Store Round Trips

**Files:**

- Modify: `src/main/enterpriseLeadWorkspace/store.ts`
- Test: `src/main/enterpriseLeadWorkspace/store.test.ts`

- [ ] **Step 1: Add store tests**

Add a test that creates a workspace with both source types:

```ts
test('workspace agent source metadata round trips through store', () => {
  const workspace = store.createWorkspace({
    ...draftPayload(),
    workspaceAgents: [
      {
        agentId: 'content_planning',
        enabled: true,
        order: 0,
        source: WorkspaceAgentSource.SystemTemplate,
        templateId: 'content_planning',
        overrides: { name: 'Content Planner' },
      },
      {
        agentId: 'local-reviewer',
        enabled: false,
        order: 1,
        source: WorkspaceAgentSource.WorkspaceCreated,
        overrides: { name: 'Local Reviewer' },
      },
    ],
  });

  expect(store.getWorkspace(workspace.id)?.workspaceAgents).toEqual(workspace.workspaceAgents);
  expect(store.listWorkspaces()[0].workspaceAgents).toEqual(workspace.workspaceAgents);
});
```

- [ ] **Step 2: Run store test**

Run: `npm test -- src/main/enterpriseLeadWorkspace/store.test.ts`

Expected: FAIL until source metadata is included in normalized persisted JSON.

- [ ] **Step 3: Update store normalization paths**

Ensure every `normalizeEnterpriseLeadWorkspaceAgents(...)` call persists the `source` and `templateId` fields. The store
already serializes `workspaceAgents` as JSON, so this task should mainly verify all input paths use the shared
normalizer.

- [ ] **Step 4: Verify store tests**

Run: `npm test -- src/main/enterpriseLeadWorkspace/store.test.ts`

Expected: PASS.

## Task 4: Resolve Runtime Agents by Source

**Files:**

- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Test: `src/main/enterpriseLeadWorkspace/service.test.ts`

- [ ] **Step 1: Add runtime service tests**

Add tests for:

```ts
test('resolves system-template workspace agents with overrides', () => {
  const workspace = service.createWorkspace({
    ...draftPayload(),
    workspaceAgents: [
      {
        agentId: 'content_planning',
        enabled: true,
        order: 0,
        source: WorkspaceAgentSource.SystemTemplate,
        templateId: 'content_planning',
        overrides: { name: 'Custom Content Agent', model: 'gpt-4.1' },
      },
    ],
  });

  const snapshot = service.createRun(workspace.id, 'Create content plan');

  expect(snapshot.tasks[0].agentSnapshot).toMatchObject({
    agentId: 'content_planning',
    name: 'Custom Content Agent',
    model: 'gpt-4.1',
  });
});

test('workspace-created agents do not leak between workspaces', () => {
  const workspaceA = service.createWorkspace({
    ...draftPayload(),
    name: 'A',
    workspaceAgents: [
      {
        agentId: 'local-agent',
        enabled: true,
        order: 0,
        source: WorkspaceAgentSource.WorkspaceCreated,
        overrides: { name: 'A Local Agent' },
      },
    ],
  });
  const workspaceB = service.createWorkspace({
    ...draftPayload(),
    name: 'B',
    workspaceAgents: [],
  });

  const snapshotA = service.createRun(workspaceA.id, 'Run A');
  const snapshotB = service.createRun(workspaceB.id, 'Run B');

  expect(snapshotA.tasks.map(task => task.workspaceAgentId)).toContain('local-agent');
  expect(snapshotB.tasks.map(task => task.workspaceAgentId)).not.toContain('local-agent');
});
```

- [ ] **Step 2: Run service tests and confirm failure**

Run: `npm test -- src/main/enterpriseLeadWorkspace/service.test.ts`

Expected: FAIL until imports and source-aware defaults are implemented.

- [ ] **Step 3: Implement source-aware merge**

Update `mergeWorkspaceAgentBinding` so it handles both sources explicitly:

```ts
private mergeWorkspaceAgentBinding(
  binding: EnterpriseLeadWorkspaceAgentBinding,
): WorkspaceChatAgentPromptSummary | null {
  const overrides = binding.overrides;
  const name = overrides.name ?? binding.name ?? binding.agentId;
  return {
    id: binding.agentId,
    name,
    description: overrides.description ?? binding.description ?? '',
    identity: overrides.identity ?? binding.identity ?? '',
    systemPrompt: overrides.systemPrompt ?? binding.systemPrompt ?? '',
    icon: overrides.icon ?? binding.icon ?? '',
    model: overrides.model ?? binding.model ?? '',
    skillIds: overrides.skillIds ?? binding.skillIds ?? [],
  };
}
```

Keep runtime resolution workspace-local by continuing to use only `workspace.workspaceAgents` inside
`resolveEffectiveWorkspaceAgents`.

- [ ] **Step 4: Verify service tests**

Run: `npm test -- src/main/enterpriseLeadWorkspace/service.test.ts`

Expected: PASS.

## Task 5: Split UI into System Templates and Workspace Agents

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
- Modify: `src/renderer/services/i18n.ts`
- Test: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [ ] **Step 1: Add UI tests**

Add render tests that assert:

```ts
expect(markup).toContain(i18nService.t('enterpriseLeadWorkbenchSystemAgentsTitle'));
expect(markup).toContain(i18nService.t('enterpriseLeadWorkbenchWorkspaceAgentsTitle'));
expect(markup).toContain(i18nService.t('enterpriseLeadWorkbenchAgentSourceSystemTemplate'));
expect(markup).toContain(i18nService.t('enterpriseLeadWorkbenchAgentSourceWorkspaceCreated'));
```

- [ ] **Step 2: Add i18n keys**

Add zh and en keys:

```ts
enterpriseLeadWorkbenchSystemAgentsTitle: 'System Agents',
enterpriseLeadWorkbenchSystemAgentsDesc: 'Built-in read-only templates that can be added to this workspace.',
enterpriseLeadWorkbenchWorkspaceAgentsTitle: 'This Workspace Agents',
enterpriseLeadWorkbenchWorkspaceAgentsDesc: 'Agents created or customized for this workspace only.',
enterpriseLeadWorkbenchAddSystemAgent: 'Add to this workspace',
enterpriseLeadWorkbenchAgentSourceSystemTemplate: 'System template',
enterpriseLeadWorkbenchAgentSourceWorkspaceCreated: 'Workspace-created',
enterpriseLeadWorkbenchNewWorkspaceAgent: 'New workspace Agent',
```

Use equivalent zh translations in the zh dictionary.

- [ ] **Step 3: Render two sections**

In `WorkspaceWorkbench.tsx`, derive:

```ts
const systemTemplateAgents = useMemo(
  () => buildDefaultWorkspaceAgentBindings(workflowRoles()).map(binding => ({
    ...binding,
    source: WorkspaceAgentSource.SystemTemplate,
    templateId: binding.agentId,
  })),
  [],
);

const workspaceCreatedAgents = effectiveWorkspaceAgents;
```

Render system templates above workspace Agent rows. System template rows should call an
`addSystemAgentToWorkspace(templateId)` handler instead of opening the full editor.

- [ ] **Step 4: Implement add-from-template handler**

Add:

```ts
const addSystemAgentToWorkspace = (templateId: string): void => {
  const template = systemTemplateAgents.find(agent => agent.agentId === templateId);
  if (!template) return;
  const exists = workspaceAgentBindings.some(binding =>
    binding.source === WorkspaceAgentSource.SystemTemplate
    && binding.templateId === templateId
  );
  if (exists) return;
  void saveWorkspaceAgents([
    ...workspaceAgentBindings,
    {
      ...template,
      enabled: true,
      order: workspaceAgentBindings.length,
      source: WorkspaceAgentSource.SystemTemplate,
      templateId,
    },
  ]);
};
```

- [ ] **Step 5: Verify UI tests**

Run: `npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

Expected: PASS.

## Task 6: Replace Free-Form Model and Skill Inputs

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx`
- Test: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [ ] **Step 1: Add editor tests for model and skills**

Test that the editor no longer renders plain labels for model and skill ids as simple text inputs and includes
selector-driven UI labels.

Expected assertions:

```ts
expect(markup).toContain(i18nService.t('agentDefaultModel'));
expect(markup).toContain(i18nService.t('agentTabSkills'));
```

- [ ] **Step 2: Change draft shape for skills**

Change `WorkspaceAgentOverrideDraft` so `skillIds` is `string[]` instead of a comma-separated string.

```ts
const getOverrideDraft = (
  binding: EnterpriseLeadWorkspaceAgentBinding | undefined,
) => ({
  name: binding?.overrides.name ?? '',
  description: binding?.overrides.description ?? '',
  identity: binding?.overrides.identity ?? '',
  systemPrompt: binding?.overrides.systemPrompt ?? '',
  icon: binding?.overrides.icon ?? '',
  model: binding?.overrides.model ?? '',
  skillIds: binding?.overrides.skillIds ?? [],
});
```

- [ ] **Step 3: Render `AgentSkillSelector`**

Import `AgentSkillSelector` and render it for the capabilities section instead of an input for `skillIds`.

```tsx
<AgentSkillSelector
  selectedSkillIds={draft.skillIds}
  onChange={skillIds => onDraftChange('skillIds', skillIds)}
/>
```

Update `onDraftChange` typing to accept `string | string[]`.

- [ ] **Step 4: Render model selector**

Import `ModelSelector`, `resolveOpenClawModelRef`, and `toOpenClawModelRef`. Resolve the string model ref into a
`Model | null`, and write back the provider-qualified ref on change.

```tsx
<ModelSelector
  value={resolvedModel}
  onChange={nextModel => onDraftChange('model', nextModel ? toOpenClawModelRef(nextModel) : '')}
  portal
/>
```

- [ ] **Step 5: Update overrides builder**

Remove comma parsing. Use the array directly:

```ts
if (draft.skillIds.length > 0) {
  overrides.skillIds = draft.skillIds;
}
```

- [ ] **Step 6: Verify UI tests**

Run: `npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

Expected: PASS.

## Task 7: Add Save Validation and Failure Feedback

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx`
- Modify: `src/renderer/services/i18n.ts`
- Test: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [ ] **Step 1: Add validation tests**

Add tests for:

```ts
expect(validateWorkspaceAgentDraft({
  name: '',
  source: WorkspaceAgentSource.WorkspaceCreated,
  model: '',
  skillIds: [],
}).valid).toBe(false);

expect(validateWorkspaceAgentDraft({
  name: 'Agent',
  source: WorkspaceAgentSource.WorkspaceCreated,
  model: 'missing-provider/missing-model',
  skillIds: [],
}).errors).toContain('model');
```

- [ ] **Step 2: Implement validation helper**

Add a local helper or exported UI helper:

```ts
export const validateWorkspaceAgentDraft = ({
  draft,
  source,
  availableModelRefs,
  enabledSkillIds,
}: {
  draft: WorkspaceAgentOverrideDraft;
  source: WorkspaceAgentSource;
  availableModelRefs: Set<string>;
  enabledSkillIds: Set<string>;
}): { valid: boolean; errors: Array<'name' | 'model' | 'skills'> } => {
  const errors: Array<'name' | 'model' | 'skills'> = [];
  if (source === WorkspaceAgentSource.WorkspaceCreated && !draft.name.trim()) {
    errors.push('name');
  }
  if (draft.model.trim() && !availableModelRefs.has(draft.model.trim())) {
    errors.push('model');
  }
  if (draft.skillIds.some(skillId => !enabledSkillIds.has(skillId))) {
    errors.push('skills');
  }
  return { valid: errors.length === 0, errors };
};
```

- [ ] **Step 3: Show validation errors in the dialog**

Add i18n keys:

```ts
enterpriseLeadWorkbenchAgentNameRequired: 'Name is required.',
enterpriseLeadWorkbenchAgentModelInvalid: 'Select an available model.',
enterpriseLeadWorkbenchAgentSkillsInvalid: 'Remove unavailable skills before saving.',
enterpriseLeadWorkbenchAgentSaveFailed: 'Agent changes were not saved.',
```

Use equivalent zh translations.

- [ ] **Step 4: Block invalid saves**

In `saveOverrides` and `createWorkspaceAgent`, call the validation helper before saving. If invalid, keep the dialog
open and show field-level errors.

- [ ] **Step 5: Verify UI tests**

Run: `npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

Expected: PASS.

## Task 8: Changed-File Lint and Targeted Test Pass

**Files:**

- Verify all modified TypeScript and TSX files.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- src/shared/enterpriseLeadWorkspace/validation.test.ts src/main/enterpriseLeadWorkspace/store.test.ts src/main/enterpriseLeadWorkspace/service.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run changed-file lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/enterpriseLeadWorkspace/types.ts src/shared/enterpriseLeadWorkspace/validation.ts src/shared/enterpriseLeadWorkspace/validation.test.ts src/main/enterpriseLeadWorkspace/store.ts src/main/enterpriseLeadWorkspace/store.test.ts src/main/enterpriseLeadWorkspace/service.ts src/main/enterpriseLeadWorkspace/service.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/services/i18n.ts
```

Expected: PASS.

- [ ] **Step 3: Review diff for scope**

Run:
`git diff -- docs/superpowers/specs/2026-07-06-workspace-agent-scope-design.md docs/superpowers/plans/2026-07-06-workspace-agent-scope-implementation-plan.md src/shared/enterpriseLeadWorkspace src/main/enterpriseLeadWorkspace src/renderer/components/enterpriseLeadWorkspace src/renderer/services/i18n.ts`

Expected: only workspace Agent scope changes and docs are present.

## Self-Review

- Spec coverage: The plan covers data migration, UI changes, runtime parsing, save failure handling, and tests.
- Placeholder scan: The plan contains no open-ended implementation placeholders.
- Type consistency: `WorkspaceAgentSource`, `source`, `templateId`, and `workspaceAgents` are used consistently across
  tasks.

## Execution Options

After this plan is approved, use one of these execution modes:

1. Subagent-driven execution with review after each task.
2. Inline execution in this session with checkpoints after each task group.
