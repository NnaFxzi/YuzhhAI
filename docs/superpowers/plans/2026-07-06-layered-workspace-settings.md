# Layered Workspace Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a layered settings model where global settings provide defaults, workspaces can override project
behavior, agents can override workspace defaults, and sessions keep runtime snapshots.

**Architecture:** Add a small shared settings resolver that produces one effective settings object plus source metadata.
Persist workspace overrides separately from existing global `cowork_config`, then migrate a narrow first batch of
settings into the resolver path: working directory, execution mode, memory, embedding, dreaming, enabled skill IDs, and
default model choice. Keep secrets and user preferences global by default.

**Tech Stack:** Electron IPC, SQLite, React, Redux Toolkit, TypeScript, OpenClaw config sync, Vitest, ESLint.

---

## File Structure

- Create: `src/shared/cowork/layeredSettings.ts`
  - Owns scope constants, override types, source metadata, defaults, and the pure resolver.
- Create: `src/shared/cowork/layeredSettings.test.ts`
  - Verifies precedence, inheritance, explicit reset-to-inherit behavior, and source metadata.
- Modify: `src/main/sqliteStore.ts`
  - Adds the workspace settings table migration.
- Modify: `src/main/coworkStore.ts`
  - Adds workspace settings persistence APIs and an effective settings read API.
- Modify: `src/main/coworkStore.test.ts`
  - Covers persistence, migration defaults, and effective setting resolution.
- Modify: `src/main/main.ts`
  - Adds IPC handlers for workspace settings reads/writes and routes OpenClaw sync through effective settings.
- Modify: `src/main/libs/openclawConfigSync.ts`
  - Consumes the effective settings object rather than raw global Cowork config where workspace-sensitive behavior is
    needed.
- Modify: `src/main/libs/openclawConfigImpact.ts`
  - Classifies workspace setting changes so OpenClaw sync/restart decisions remain explicit.
- Modify: `src/main/libs/openclawConfigImpact.test.ts`
  - Covers the new workspace impact reason.
- Modify: `src/renderer/types/cowork.ts`
  - Adds workspace settings and effective settings types.
- Modify: `src/renderer/types/electron.d.ts`
  - Exposes typed IPC contracts.
- Modify: `src/renderer/services/cowork.ts`
  - Adds service methods to load/save workspace overrides and refresh effective settings.
- Modify: `src/renderer/store/slices/coworkSlice.ts`
  - Stores workspace overrides and effective settings without breaking existing global config state.
- Modify: `src/renderer/store/slices/coworkSlice.test.ts`
  - Verifies Redux updates preserve existing config and track source metadata.
- Modify: `src/renderer/components/Settings.tsx`
  - Keeps global settings as the default layer and avoids presenting project-specific controls as only global.
- Create: `src/renderer/components/cowork/WorkspaceSettingsPanel.tsx`
  - Renders workspace-level controls with inherit/custom/reset states.
- Create: `src/renderer/components/cowork/WorkspaceSettingsPanel.test.ts`
  - Verifies visible inherit/custom/reset behavior.
- Modify: `src/renderer/services/i18n.ts`
  - Adds Chinese and English UI strings.

---

### Task 1: Shared Layered Settings Resolver

**Files:**

- Create: `src/shared/cowork/layeredSettings.ts`
- Create: `src/shared/cowork/layeredSettings.test.ts`

- [x] **Step 1: Write resolver tests**

Add tests that prove the intended precedence and source metadata:

```ts
import { describe, expect, test } from 'vitest';

import {
  SettingScope,
  resolveLayeredCoworkSettings,
  type CoworkSettingsLayer,
} from './layeredSettings';

const globalLayer: CoworkSettingsLayer = {
  scope: SettingScope.Global,
  values: {
    workingDirectory: '/global/project',
    executionMode: 'local',
    memoryEnabled: true,
    embeddingEnabled: false,
    dreamingEnabled: false,
    skillIds: ['global-skill'],
    defaultModel: 'global-model',
  },
};

describe('resolveLayeredCoworkSettings', () => {
  test('uses workspace overrides before global defaults', () => {
    const resolved = resolveLayeredCoworkSettings({
      global: globalLayer,
      workspace: {
        scope: SettingScope.Workspace,
        values: {
          workingDirectory: '/workspace/project',
          skillIds: ['workspace-skill'],
        },
      },
    });

    expect(resolved.values.workingDirectory).toBe('/workspace/project');
    expect(resolved.sources.workingDirectory).toBe(SettingScope.Workspace);
    expect(resolved.values.executionMode).toBe('local');
    expect(resolved.sources.executionMode).toBe(SettingScope.Global);
    expect(resolved.values.skillIds).toEqual(['workspace-skill']);
  });

  test('uses agent overrides before workspace overrides', () => {
    const resolved = resolveLayeredCoworkSettings({
      global: globalLayer,
      workspace: {
        scope: SettingScope.Workspace,
        values: { defaultModel: 'workspace-model' },
      },
      agent: {
        scope: SettingScope.Agent,
        values: { defaultModel: 'agent-model' },
      },
    });

    expect(resolved.values.defaultModel).toBe('agent-model');
    expect(resolved.sources.defaultModel).toBe(SettingScope.Agent);
  });

  test('uses session snapshot before all mutable layers', () => {
    const resolved = resolveLayeredCoworkSettings({
      global: globalLayer,
      workspace: {
        scope: SettingScope.Workspace,
        values: { executionMode: 'sandbox' },
      },
      session: {
        scope: SettingScope.Session,
        values: { executionMode: 'local' },
      },
    });

    expect(resolved.values.executionMode).toBe('local');
    expect(resolved.sources.executionMode).toBe(SettingScope.Session);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/shared/cowork/layeredSettings.test.ts`

Expected: FAIL because `src/shared/cowork/layeredSettings.ts` does not exist.

- [x] **Step 3: Implement the resolver**

Create `src/shared/cowork/layeredSettings.ts`:

```ts
export const SettingScope = {
  Default: 'default',
  Global: 'global',
  Workspace: 'workspace',
  Agent: 'agent',
  Session: 'session',
} as const;

export type SettingScope = typeof SettingScope[keyof typeof SettingScope];

export const InheritSetting = {
  Value: '__inherit__',
} as const;

export type InheritSetting = typeof InheritSetting[keyof typeof InheritSetting];

export interface LayeredCoworkSettingsValues {
  workingDirectory: string;
  executionMode: 'auto' | 'local' | 'sandbox';
  memoryEnabled: boolean;
  embeddingEnabled: boolean;
  dreamingEnabled: boolean;
  skillIds: string[];
  defaultModel: string;
}

export type LayeredCoworkSettingsUpdate = Partial<{
  [K in keyof LayeredCoworkSettingsValues]: LayeredCoworkSettingsValues[K] | InheritSetting;
}>;

export interface CoworkSettingsLayer {
  scope: SettingScope;
  values: Partial<LayeredCoworkSettingsValues>;
}

export interface LayeredCoworkSettingsResolution {
  values: LayeredCoworkSettingsValues;
  sources: Record<keyof LayeredCoworkSettingsValues, SettingScope>;
}

export const defaultLayeredCoworkSettings: LayeredCoworkSettingsValues = {
  workingDirectory: '',
  executionMode: 'local',
  memoryEnabled: true,
  embeddingEnabled: false,
  dreamingEnabled: false,
  skillIds: [],
  defaultModel: '',
};

const settingKeys = Object.keys(defaultLayeredCoworkSettings) as Array<keyof LayeredCoworkSettingsValues>;

const applyLayer = (
  result: LayeredCoworkSettingsResolution,
  layer?: CoworkSettingsLayer,
): void => {
  if (!layer) return;
  for (const key of settingKeys) {
    const value = layer.values[key];
    if (value !== undefined) {
      result.values[key] = value as never;
      result.sources[key] = layer.scope;
    }
  }
};

export const resolveLayeredCoworkSettings = (layers: {
  global: CoworkSettingsLayer;
  workspace?: CoworkSettingsLayer;
  agent?: CoworkSettingsLayer;
  session?: CoworkSettingsLayer;
}): LayeredCoworkSettingsResolution => {
  const result = settingKeys.reduce<LayeredCoworkSettingsResolution>(
    (acc, key) => {
      acc.values[key] = defaultLayeredCoworkSettings[key] as never;
      acc.sources[key] = SettingScope.Default;
      return acc;
    },
    {
      values: { ...defaultLayeredCoworkSettings },
      sources: {} as Record<keyof LayeredCoworkSettingsValues, SettingScope>,
    },
  );

  applyLayer(result, layers.global);
  applyLayer(result, layers.workspace);
  applyLayer(result, layers.agent);
  applyLayer(result, layers.session);

  return result;
};
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/shared/cowork/layeredSettings.test.ts`

Expected: PASS.

### Task 2: Workspace Settings Persistence

**Files:**

- Modify: `src/main/sqliteStore.ts`
- Modify: `src/main/coworkStore.ts`
- Modify: `src/main/coworkStore.test.ts`

- [x] **Step 1: Write persistence tests**

Add tests in `src/main/coworkStore.test.ts`:

```ts
test('workspace settings can override global cowork settings', () => {
  const store = createTestCoworkStore();
  store.setConfig({
    workingDirectory: '/global/project',
    memoryEnabled: true,
    embeddingEnabled: false,
  });

  store.setWorkspaceSettings('workspace-a', {
    workingDirectory: '/workspace/project',
    embeddingEnabled: true,
  });

  const settings = store.getWorkspaceSettings('workspace-a');
  expect(settings).toEqual({
    workingDirectory: '/workspace/project',
    embeddingEnabled: true,
  });
});

test('workspace settings can reset a key back to inherited global value', () => {
  const store = createTestCoworkStore();
  store.setWorkspaceSettings('workspace-a', {
    workingDirectory: '/workspace/project',
    embeddingEnabled: true,
  });

  store.setWorkspaceSettings('workspace-a', {
    workingDirectory: '__inherit__',
  });

  expect(store.getWorkspaceSettings('workspace-a')).toEqual({
    embeddingEnabled: true,
  });
});
```

Use the existing test store helper in `src/main/coworkStore.test.ts`; do not create a second helper with a separate
SQLite lifecycle.

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/main/coworkStore.test.ts -t "workspace settings"`

Expected: FAIL because workspace setting APIs and table do not exist.

- [x] **Step 3: Add SQLite table**

Modify `src/main/sqliteStore.ts` to create:

```sql
CREATE TABLE IF NOT EXISTS cowork_workspace_settings (
  workspace_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, key)
);
```

Also add:

```sql
CREATE INDEX IF NOT EXISTS idx_cowork_workspace_settings_workspace_id
ON cowork_workspace_settings(workspace_id);
```

- [x] **Step 4: Add store methods**

Add methods to `src/main/coworkStore.ts`:

```ts
getWorkspaceSettings(workspaceId: string): Partial<LayeredCoworkSettingsValues> {
  const rows = this.getAll<{ key: string; value: string }>(
    'SELECT key, value FROM cowork_workspace_settings WHERE workspace_id = ?',
    [workspaceId],
  );
  return Object.fromEntries(rows.map(row => [row.key, JSON.parse(row.value)]));
}

setWorkspaceSettings(workspaceId: string, updates: LayeredCoworkSettingsUpdate): void {
  const now = Date.now();
  const transaction = this.db.transaction(() => {
    for (const [key, value] of Object.entries(updates)) {
      if (value === InheritSetting.Value) {
        this.db
          .prepare('DELETE FROM cowork_workspace_settings WHERE workspace_id = ? AND key = ?')
          .run(workspaceId, key);
        continue;
      }
      this.db
        .prepare(`
          INSERT INTO cowork_workspace_settings (workspace_id, key, value, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(workspace_id, key)
          DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `)
        .run(workspaceId, key, JSON.stringify(value), now);
    }
  });
  transaction();
}
```

Use imports from `src/shared/cowork/layeredSettings.ts`.

- [x] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/main/coworkStore.test.ts -t "workspace settings"`

Expected: PASS.

### Task 3: Effective Settings API

**Files:**

- Modify: `src/main/coworkStore.ts`
- Modify: `src/main/main.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Modify: `src/renderer/types/cowork.ts`
- Modify: `src/renderer/services/cowork.ts`
- Modify: `src/renderer/store/slices/coworkSlice.ts`
- Test: `src/main/coworkStore.test.ts`
- Test: `src/renderer/store/slices/coworkSlice.test.ts`

- [x] **Step 1: Write effective settings store test**

Add a test that proves global + workspace + agent precedence:

```ts
test('effective cowork settings resolve global workspace and agent layers', () => {
  const store = createTestCoworkStore();
  store.setConfig({
    workingDirectory: '/global/project',
    embeddingEnabled: false,
  });
  store.setWorkspaceSettings('workspace-a', {
    workingDirectory: '/workspace/project',
    embeddingEnabled: true,
  });
  const agent = store.createAgent({
    name: 'Docs Agent',
    workingDirectory: '/agent/project',
  });

  const resolved = store.getEffectiveSettings({
    workspaceId: 'workspace-a',
    agentId: agent.id,
  });

  expect(resolved.values.workingDirectory).toBe('/agent/project');
  expect(resolved.sources.workingDirectory).toBe('agent');
  expect(resolved.values.embeddingEnabled).toBe(true);
  expect(resolved.sources.embeddingEnabled).toBe('workspace');
});
```

- [x] **Step 2: Add store resolver**

Add `getEffectiveSettings` to `src/main/coworkStore.ts`. Map existing global `CoworkConfig` to a global
`CoworkSettingsLayer`. Map agent `workingDirectory`, `model`, and `skillIds` into the agent layer when present.

- [x] **Step 3: Add IPC handlers**

In `src/main/main.ts`, add handlers:

```ts
ipcMain.handle('cowork:getWorkspaceSettings', async (_event, workspaceId: string) => {
  return { success: true, settings: getCoworkStore().getWorkspaceSettings(workspaceId) };
});

ipcMain.handle('cowork:setWorkspaceSettings', async (_event, workspaceId: string, updates: LayeredCoworkSettingsUpdate) => {
  const previous = getCoworkStore().getEffectiveSettings({ workspaceId });
  getCoworkStore().setWorkspaceSettings(workspaceId, updates);
  const next = getCoworkStore().getEffectiveSettings({ workspaceId });
  const impactDecision = classifyWorkspaceSettingsChange(previous.values, next.values);
  await syncOpenClawForImpactDecision(impactDecision);
  return { success: true };
});

ipcMain.handle('cowork:getEffectiveSettings', async (_event, input: { workspaceId?: string; agentId?: string; sessionId?: string }) => {
  return { success: true, settings: getCoworkStore().getEffectiveSettings(input) };
});
```

Use the existing cowork IPC style around the current `cowork:getConfig` and `cowork:setConfig` handlers rather than
duplicating error handling patterns.

- [x] **Step 4: Add renderer service and Redux support**

Add typed service methods:

```ts
async getWorkspaceSettings(workspaceId: string) {
  return window.electron.cowork.getWorkspaceSettings(workspaceId);
}

async setWorkspaceSettings(workspaceId: string, updates: LayeredCoworkSettingsUpdate) {
  return window.electron.cowork.setWorkspaceSettings(workspaceId, updates);
}

async getEffectiveSettings(input: { workspaceId?: string; agentId?: string; sessionId?: string }) {
  return window.electron.cowork.getEffectiveSettings(input);
}
```

Store the returned effective settings separately from the existing global `config` field so existing settings UI remains
stable.

- [x] **Step 5: Run targeted tests**

Run:
`npm test -- src/main/coworkStore.test.ts -t "effective cowork settings" src/renderer/store/slices/coworkSlice.test.ts`

Expected: PASS.

### Task 4: OpenClaw Config Sync Uses Effective Settings

**Files:**

- Modify: `src/main/libs/openclawConfigSync.ts`
- Modify: `src/main/libs/openclawConfigImpact.ts`
- Modify: `src/main/libs/openclawConfigImpact.test.ts`
- Test: `src/main/libs/openclawConfigSync.test.ts`
- Test: `src/main/libs/openclawConfigSync.runtime.test.ts`

- [x] **Step 1: Write impact tests**

Add tests to `src/main/libs/openclawConfigImpact.test.ts`:

```ts
test('classifies workspace runtime setting changes as OpenClaw sync', () => {
  expect(classifyWorkspaceSettingsChange(
    { workingDirectory: '/a', embeddingEnabled: false },
    { workingDirectory: '/b', embeddingEnabled: false },
  )).toEqual({
    impact: OpenClawConfigImpact.Sync,
    reasons: [OpenClawConfigImpactReason.WorkspaceRuntimeConfig],
  });
});

test('classifies workspace dreaming changes as OpenClaw restart', () => {
  expect(classifyWorkspaceSettingsChange(
    { dreamingEnabled: false },
    { dreamingEnabled: true },
  )).toEqual({
    impact: OpenClawConfigImpact.Restart,
    reasons: [OpenClawConfigImpactReason.WorkspaceDreamingConfig],
  });
});
```

- [x] **Step 2: Add impact reasons**

Extend `OpenClawConfigImpactReason`:

```ts
WorkspaceRuntimeConfig: 'workspace.runtime',
WorkspaceOpenClawConfig: 'workspace.openclaw',
WorkspaceDreamingConfig: 'workspace.dreaming',
```

Add `classifyWorkspaceSettingsChange(previous, next)` with the same field split as the existing Cowork config
classifier.

- [x] **Step 3: Route sync through effective settings**

Modify `src/main/libs/openclawConfigSync.ts` so the values that affect `agents.defaults.cwd`, sandbox mode, embedding
memory search, dreaming cron, selected skills, and default model come from the effective settings object for the active
workspace/session context.

Keep these existing behaviors unchanged:

- `agents.defaults.workspace` still points at the OpenClaw agent workspace.
- `cwd` still points at the user-visible project working directory.
- Non-main agent workspace files still live under OpenClaw state.
- Provider credentials remain sourced from global provider config for this plan; workspace provider credential overrides
  are out of scope.

- [x] **Step 4: Run OpenClaw config tests**

Run:
`npm test -- src/main/libs/openclawConfigImpact.test.ts src/main/libs/openclawConfigSync.test.ts src/main/libs/openclawConfigSync.runtime.test.ts`

Expected: PASS.

### Task 5: Workspace Settings UI

**Files:**

- Create: `src/renderer/components/cowork/WorkspaceSettingsPanel.tsx`
- Create: `src/renderer/components/cowork/WorkspaceSettingsPanel.test.ts`
- Modify: `src/renderer/components/Settings.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [x] **Step 1: Write render tests**

Add tests for:

```ts
expect(markup).toContain('继承全局');
expect(markup).toContain('当前工作空间');
expect(markup).toContain('恢复继承');
expect(markup).toContain('工作目录');
expect(markup).toContain('默认模型');
expect(markup).toContain('记忆');
expect(markup).toContain('向量检索');
expect(markup).toContain('梦境任务');
```

Add English assertions for the English dictionary branch:

```ts
expect(markup).toContain('Inherited from global');
expect(markup).toContain('Current workspace');
expect(markup).toContain('Restore inheritance');
```

- [x] **Step 2: Build the panel**

Create `WorkspaceSettingsPanel.tsx` with:

- one row per workspace-overridable setting;
- a visible source badge using `settings.sources[key]`;
- a toggle or segmented control for inherited versus custom;
- a reset button that writes `InheritSetting.Value`;
- no API key inputs and no theme/shortcut controls.

- [x] **Step 3: Keep global Settings focused**

Modify `Settings.tsx` so global tabs continue to edit global defaults, but project-sensitive copy says "global default"
rather than implying "current project value".

- [x] **Step 4: Run UI tests**

Run: `npm test -- src/renderer/components/cowork/WorkspaceSettingsPanel.test.ts`

Expected: PASS.

### Task 6: Migration And Backward Compatibility

**Files:**

- Modify: `src/main/sqliteStore.ts`
- Modify: `src/main/coworkStore.test.ts`
- Modify: `src/main/coworkStore.ts`

- [x] **Step 1: Preserve existing users**

Do not move existing global `cowork_config` rows during the first release. Treat them as global defaults. Workspace
overrides start empty unless the user explicitly customizes a workspace.

- [x] **Step 2: Preserve existing agent behavior**

Keep the existing one-time `agents.workingDirectoryBackfill.v1.completed` migration intact. Agent working directories
remain higher precedence than workspace working directories.

- [x] **Step 3: Add safe JSON parsing**

When reading `cowork_workspace_settings.value`, catch malformed JSON and skip only the broken key. Log with:

```ts
console.warn('[CoworkStore] Failed to parse workspace setting:', { workspaceId, key }, error);
```

- [x] **Step 4: Add corrupt-row test**

Insert one invalid JSON row into `cowork_workspace_settings`, then assert other valid settings still load.

### Task 7: Verification

**Commands:**

- `npm test -- src/shared/cowork/layeredSettings.test.ts`
- `npm test -- src/main/coworkStore.test.ts -t "workspace settings"`
-
`npm test -- src/main/libs/openclawConfigImpact.test.ts src/main/libs/openclawConfigSync.test.ts src/main/libs/openclawConfigSync.runtime.test.ts`
-
`npm test -- src/renderer/store/slices/coworkSlice.test.ts src/renderer/components/cowork/WorkspaceSettingsPanel.test.ts`
-
`npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/cowork/layeredSettings.ts src/shared/cowork/layeredSettings.test.ts src/main/sqliteStore.ts src/main/coworkStore.ts src/main/coworkStore.test.ts src/main/main.ts src/main/libs/openclawConfigSync.ts src/main/libs/openclawConfigImpact.ts src/main/libs/openclawConfigImpact.test.ts src/renderer/types/cowork.ts src/renderer/types/electron.d.ts src/renderer/services/cowork.ts src/renderer/store/slices/coworkSlice.ts src/renderer/store/slices/coworkSlice.test.ts src/renderer/components/Settings.tsx src/renderer/components/cowork/WorkspaceSettingsPanel.tsx src/renderer/components/cowork/WorkspaceSettingsPanel.test.ts src/renderer/services/i18n.ts`
- `npm run compile:electron`

- [x] Confirm all targeted Vitest coverage passes.
- [x] Confirm touched TypeScript files pass changed-file ESLint.
- [x] Confirm Electron main/preload TypeScript compilation passes.
- [x] Manually validate that changing workspace settings updates OpenClaw config without changing unrelated global
  defaults.
- [x] Do not commit. Repository instructions require user testing and confirmation before commits.

---

## Rollout Recommendation

Ship this in two product slices:

1. Foundation release: resolver, persistence, effective settings API, and OpenClaw sync for working directory, execution
   mode, memory, embedding, dreaming, skill IDs, and default model.
2. UX release: workspace settings panel, visible inheritance badges, reset-to-global controls, and clearer copy in
   global Settings.

Defer provider credential overrides until the foundation is stable. Keep API keys global in the first iteration and
allow workspaces to select a provider/model by reference. This avoids secret duplication and reduces migration risk.
