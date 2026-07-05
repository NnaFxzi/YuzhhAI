# Enterprise Lead Workspace Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the opened enterprise lead workspace so 工作台, AI 对话, 知识库, 创作记录, and 空间设置 are real usable pages backed by workspace data.

**Architecture:** Add a workspace shell that owns internal navigation and shared workspace refresh state. Extend enterprise lead workspace data with workspace-local Agent bindings/overrides, run listing, and workspace chat APIs, while keeping global Agents as templates and existing fixed-role run history readable. Move configuration editors into 空间设置, make 工作台 manage workspace-bound Agents, and add focused pages for chat, knowledge, and records.

**Tech Stack:** Electron main/preload IPC, React 18, Redux Toolkit, Tailwind, Better SQLite3, Vitest, existing `ModelClientAdapter`, existing Tavily/Firecrawl/domestic research helpers.

**Repository Rule Override:** This repository says not to create commits until the user has tested and confirmed. Do not run the commit steps from the generic planning skill during implementation.

---

## File Structure

Modify shared enterprise lead workspace types and constants:

- `src/shared/enterpriseLeadWorkspace/types.ts`
  Add workspace Agent binding/override, run summary, chat request/response, and research intent/result types.
- `src/shared/enterpriseLeadWorkspace/constants.ts`
  Add IPC constants for Agent binding, run list, and workspace chat.
- `src/shared/enterpriseLeadWorkspace/validation.ts`
  Normalize workspace Agent bindings/overrides and chat research intent.
- `src/shared/enterpriseLeadWorkspace/validation.test.ts`
  Cover override normalization, old workspace compatibility, and chat research intent limits.

Modify main enterprise lead workspace modules:

- `src/main/enterpriseLeadWorkspace/store.ts`
  Add `workspace_agents` JSON column or equivalent migration on `enterprise_lead_workspaces`, map it into workspace objects, update bindings, list runs.
- `src/main/enterpriseLeadWorkspace/store.test.ts`
  Cover workspace Agent binding, override persistence, global Agent non-mutation expectations at store boundary, and run listing.
- `src/main/enterpriseLeadWorkspace/service.ts`
  Add workspace Agent binding APIs, effective Agent resolution, run listing, and workspace chat orchestration.
- `src/main/enterpriseLeadWorkspace/service.test.ts`
  Cover effective Agent values, workspace chat with/without research, failed research, invalid research intent, and dynamic run-Agent resolution rules.
- `src/main/enterpriseLeadWorkspace/promptTemplates.ts`
  Add workspace chat intent and final response prompt builders.
- `src/main/enterpriseLeadWorkspace/ipcHandlers.ts`
  Register new IPC handlers and validate inputs.
- `src/main/main.ts`
  Pass Agent manager/read dependencies and research runner dependencies into enterprise workspace service.

Modify renderer bridge/service types:

- `src/main/preload.ts`
  Expose new enterprise workspace APIs.
- `src/renderer/types/electron.d.ts`
  Type new APIs.
- `src/renderer/services/enterpriseLeadWorkspace.ts`
  Add renderer service wrappers for Agent binding, run list, and chat.

Add or refactor renderer workspace components:

- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceShell.tsx`
  New shell with internal sidebar and active page state.
- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx`
  Refactor to workspace Agent management.
- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceSettings.tsx`
  Move provider, skill, external research, and domestic source editors here.
- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx`
  Add chat UI.
- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.tsx`
  Add read-only knowledge page.
- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreationRecords.tsx`
  Add run list/detail page.
- `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`
  Render `WorkspaceShell` for opened workspaces.
- `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
  Add internal page metadata, effective Agent display helpers, knowledge section helpers, run summary helpers, and chat UI helpers.
- `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
  Cover page metadata, effective Agent merge, knowledge sections, run summaries, and render smoke tests.
- `src/renderer/components/enterpriseLeadWorkspace/index.ts`
  Export new components as needed.

Modify i18n:

- `src/renderer/services/i18n.ts`
  Add Chinese and English strings for new pages, actions, empty states, chat, records, and settings.

Verification:

- `npm test -- enterpriseLeadWorkspace`
- `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 <touched ts/tsx files>`
- `npm run compile:electron`

---

## Task 1: Shared Types And Validation

**Files:**

- Modify: `src/shared/enterpriseLeadWorkspace/types.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/constants.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/validation.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/validation.test.ts`

- [ ] **Step 1: Add failing validation tests for workspace Agent overrides**

Add tests in `src/shared/enterpriseLeadWorkspace/validation.test.ts`:

```ts
test('normalizes workspace agent bindings with local overrides', () => {
  const normalized = normalizeEnterpriseLeadWorkspaceAgents([
    {
      agentId: ' agent-a ',
      enabled: false,
      order: 2.7,
      overrides: {
        name: '  Space Writer  ',
        description: '  Writes for this workspace only  ',
        identity: '  Workspace identity  ',
        systemPrompt: '  Workspace prompt  ',
        icon: '  briefcase  ',
        model: '  deepseek/deepseek-chat  ',
        skillIds: [' docx ', '', 'docx', 'web-search'],
      },
    },
  ]);

  expect(normalized).toEqual([
    {
      agentId: 'agent-a',
      enabled: false,
      order: 2,
      overrides: {
        name: 'Space Writer',
        description: 'Writes for this workspace only',
        identity: 'Workspace identity',
        systemPrompt: 'Workspace prompt',
        icon: 'briefcase',
        model: 'deepseek/deepseek-chat',
        skillIds: ['docx', 'web-search'],
      },
    },
  ]);
});

test('drops workspace agent bindings without an agent id', () => {
  expect(normalizeEnterpriseLeadWorkspaceAgents([
    { agentId: ' ', enabled: true, order: 0, overrides: { name: 'Missing' } },
  ])).toEqual([]);
});
```

- [ ] **Step 2: Add failing validation tests for chat research intent limits**

Add tests in the same file:

```ts
test('normalizes oversized workspace chat search intent', () => {
  const normalized = normalizeWorkspaceChatResearchIntent({
    kind: 'search',
    query: 'x'.repeat(700),
    provider: 'unknown',
  });

  expect(normalized).toEqual({
    kind: 'search',
    query: 'x'.repeat(500),
    provider: 'auto',
  });
});

test('normalizes extract intents to http urls and ten items', () => {
  const urls = [
    'https://example.com/a',
    'ftp://example.com/b',
    'http://example.com/c',
    ...Array.from({ length: 20 }, (_, index) => `https://example.com/${index}`),
  ];

  const normalized = normalizeWorkspaceChatResearchIntent({
    kind: 'extract',
    urls,
    query: '  summarize competitor pages  ',
    provider: 'firecrawl',
  });

  expect(normalized.kind).toBe('extract');
  if (normalized.kind !== 'extract') throw new Error('Expected extract intent');
  expect(normalized.urls).toHaveLength(10);
  expect(normalized.urls).not.toContain('ftp://example.com/b');
  expect(normalized.query).toBe('summarize competitor pages');
  expect(normalized.provider).toBe('firecrawl');
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
npm test -- validation
```

Expected: fails because `normalizeEnterpriseLeadWorkspaceAgents` and `normalizeWorkspaceChatResearchIntent` are not exported yet.

- [ ] **Step 4: Add shared types and constants**

In `src/shared/enterpriseLeadWorkspace/types.ts`, add:

```ts
export interface EnterpriseLeadWorkspaceAgentOverrides {
  name?: string;
  description?: string;
  identity?: string;
  systemPrompt?: string;
  icon?: string;
  model?: string;
  skillIds?: string[];
}

export interface EnterpriseLeadWorkspaceAgentBinding {
  agentId: string;
  enabled: boolean;
  order: number;
  overrides: EnterpriseLeadWorkspaceAgentOverrides;
}

export interface EnterpriseLeadWorkspaceRunSummary {
  run: EnterpriseLeadRun;
  taskCount: number;
  deliverableCount: number;
  todoCount: number;
  riskCount: number;
}

export interface EnterpriseLeadWorkspaceChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  research?: EnterpriseLeadWorkspaceChatResearchResult;
}

export interface EnterpriseLeadWorkspaceChatRequest {
  message: string;
  targetAgentId?: string;
  recentMessages?: EnterpriseLeadWorkspaceChatMessage[];
}

export type EnterpriseLeadWorkspaceChatResearchIntent =
  | { kind: 'none' }
  | { kind: 'search'; query: string; provider: 'auto' | 'tavily' | 'firecrawl' }
  | { kind: 'extract'; urls: string[]; query?: string; provider: 'auto' | 'tavily' | 'firecrawl' }
  | { kind: 'domestic_status' };

export interface EnterpriseLeadWorkspaceChatResearchResult {
  intent: EnterpriseLeadWorkspaceChatResearchIntent;
  status: 'skipped' | 'completed' | 'failed';
  provider?: 'tavily' | 'firecrawl' | 'domestic';
  summary: string;
  payload?: unknown;
}

export interface EnterpriseLeadWorkspaceChatResponse {
  message: EnterpriseLeadWorkspaceChatMessage;
}
```

Add `workspaceAgents: EnterpriseLeadWorkspaceAgentBinding[];` to `EnterpriseLeadWorkspace` and `EnterpriseLeadWorkspaceDraft` if draft initialization needs it.

In `src/shared/enterpriseLeadWorkspace/constants.ts`, add IPC constants:

```ts
  UpdateWorkspaceAgents: 'enterpriseLeadWorkspace:workspaces:updateAgents',
  ListRuns: 'enterpriseLeadWorkspace:runs:list',
  Chat: 'enterpriseLeadWorkspace:chat:send',
```

- [ ] **Step 5: Implement validation helpers**

In `src/shared/enterpriseLeadWorkspace/validation.ts`, add helpers:

```ts
const MAX_WORKSPACE_CHAT_QUERY_LENGTH = 500;
const MAX_WORKSPACE_CHAT_EXTRACT_URLS = 10;

const cleanOptionalText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const cleanSkillIds = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const ids = Array.from(new Set(value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)));
  return ids.length > 0 ? ids : undefined;
};

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const normalizeResearchProvider = (value: unknown): 'auto' | 'tavily' | 'firecrawl' =>
  value === 'tavily' || value === 'firecrawl' ? value : 'auto';

export const normalizeEnterpriseLeadWorkspaceAgents = (
  value: unknown,
): EnterpriseLeadWorkspaceAgentBinding[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item, index): EnterpriseLeadWorkspaceAgentBinding | null => {
      const record = isRecord(item) ? item : {};
      const agentId = typeof record.agentId === 'string' ? record.agentId.trim() : '';
      if (!agentId) return null;
      const rawOverrides = isRecord(record.overrides) ? record.overrides : {};
      const overrides: EnterpriseLeadWorkspaceAgentOverrides = {};
      const textFields = ['name', 'description', 'identity', 'systemPrompt', 'icon', 'model'] as const;
      textFields.forEach(field => {
        const text = cleanOptionalText(rawOverrides[field]);
        if (text) overrides[field] = text;
      });
      const skillIds = cleanSkillIds(rawOverrides.skillIds);
      if (skillIds) overrides.skillIds = skillIds;

      return {
        agentId,
        enabled: record.enabled !== false,
        order: typeof record.order === 'number' && Number.isFinite(record.order)
          ? Math.max(0, Math.floor(record.order))
          : index,
        overrides,
      };
    })
    .filter((item): item is EnterpriseLeadWorkspaceAgentBinding => Boolean(item))
    .sort((left, right) => left.order - right.order)
    .map((item, index) => ({ ...item, order: index }));
};

export const normalizeWorkspaceChatResearchIntent = (
  value: unknown,
): EnterpriseLeadWorkspaceChatResearchIntent => {
  const record = isRecord(value) ? value : {};
  if (record.kind === 'search') {
    const query = typeof record.query === 'string'
      ? record.query.trim().slice(0, MAX_WORKSPACE_CHAT_QUERY_LENGTH)
      : '';
    return query
      ? { kind: 'search', query, provider: normalizeResearchProvider(record.provider) }
      : { kind: 'none' };
  }
  if (record.kind === 'extract') {
    const urls = Array.isArray(record.urls)
      ? record.urls
        .map(url => (typeof url === 'string' ? url.trim() : ''))
        .filter(url => url && isHttpUrl(url))
        .slice(0, MAX_WORKSPACE_CHAT_EXTRACT_URLS)
      : [];
    const query = cleanOptionalText(record.query);
    return urls.length > 0
      ? { kind: 'extract', urls, ...(query ? { query } : {}), provider: normalizeResearchProvider(record.provider) }
      : { kind: 'none' };
  }
  if (record.kind === 'domestic_status') {
    return { kind: 'domestic_status' };
  }
  return { kind: 'none' };
};
```

Also update existing workspace normalization so missing `workspaceAgents` becomes `[]`.

- [ ] **Step 6: Run tests and verify they pass**

Run:

```bash
npm test -- validation
```

Expected: validation tests pass.

---

## Task 2: Store And Service Workspace Agent Binding

**Files:**

- Modify: `src/main/enterpriseLeadWorkspace/store.ts`
- Modify: `src/main/enterpriseLeadWorkspace/store.test.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.test.ts`

- [ ] **Step 1: Write failing store tests for workspace Agents**

In `src/main/enterpriseLeadWorkspace/store.test.ts`, add:

```ts
test('persists workspace agent bindings without changing global agents', () => {
  const setup = createStore();
  const store = setup.store;
  const workspace = store.createWorkspace({
    name: '华南重包获客工作台',
    type: EnterpriseLeadWorkspaceType.EnterpriseLead,
    profile,
    extractionSources: [],
    enabledAgentRoles: [EnterpriseLeadAgentRole.Controller],
  });

  const updated = store.updateWorkspaceAgents(workspace.id, [
    {
      agentId: 'global-agent-1',
      enabled: true,
      order: 0,
      overrides: {
        name: 'Workspace-only name',
        systemPrompt: 'Workspace-only prompt',
      },
    },
  ]);

  expect(updated.workspaceAgents).toEqual([
    {
      agentId: 'global-agent-1',
      enabled: true,
      order: 0,
      overrides: {
        name: 'Workspace-only name',
        systemPrompt: 'Workspace-only prompt',
      },
    },
  ]);
  expect(store.getWorkspace(workspace.id)?.workspaceAgents[0].overrides.name)
    .toBe('Workspace-only name');
});
```

- [ ] **Step 2: Write failing store test for run listing**

Add:

```ts
test('lists runs for a workspace newest first with archive state', () => {
  const setup = createStore();
  const store = setup.store;
  const workspace = store.createWorkspace({
    name: '华南重包获客工作台',
    type: EnterpriseLeadWorkspaceType.EnterpriseLead,
    profile,
    extractionSources: [],
    enabledAgentRoles: [EnterpriseLeadAgentRole.Controller],
  });
  const first = store.createRun({
    workspaceId: workspace.id,
    userGoal: 'first goal',
    roles: [EnterpriseLeadAgentRole.Controller],
  });
  const second = store.createRun({
    workspaceId: workspace.id,
    userGoal: 'second goal',
    roles: [EnterpriseLeadAgentRole.Controller],
  });

  expect(store.listRuns(workspace.id).map(run => run.id)).toEqual([second.id, first.id]);
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
npm test -- store
```

Expected: fails because `updateWorkspaceAgents` and `listRuns` do not exist.

- [ ] **Step 4: Add store column migration and row mapping**

In `src/main/enterpriseLeadWorkspace/store.ts`:

Add `workspaceAgents: string | null` to `EnterpriseLeadWorkspaceRow`.

In table creation add:

```sql
workspace_agents TEXT,
```

Add migration:

```ts
private ensureWorkspaceAgentsColumn(): void {
  const columns = this.db.pragma('table_info(enterprise_lead_workspaces)') as Array<{ name: string }>;
  const columnNames = new Set(columns.map(column => column.name));
  if (!columnNames.has('workspace_agents')) {
    this.db.exec('ALTER TABLE enterprise_lead_workspaces ADD COLUMN workspace_agents TEXT;');
  }
}
```

Call `this.ensureWorkspaceAgentsColumn();` in `initialize()`.

In `mapWorkspaceRow`, add:

```ts
workspaceAgents: normalizeEnterpriseLeadWorkspaceAgents(
  row.workspaceAgents ? parseJsonValue(row.workspaceAgents, []) : [],
),
```

Update `SELECT` statements to include:

```sql
workspace_agents as workspaceAgents
```

Update `INSERT` to include `workspace_agents` and pass `JSON.stringify(workspace.workspaceAgents)`.

- [ ] **Step 5: Add store methods**

Add:

```ts
updateWorkspaceAgents(
  workspaceId: string,
  agents: EnterpriseLeadWorkspaceAgentBinding[],
): EnterpriseLeadWorkspace {
  const workspace = this.getWorkspace(workspaceId);
  if (!workspace) {
    throw new Error('Enterprise lead workspace not found');
  }
  const normalizedAgents = normalizeEnterpriseLeadWorkspaceAgents(agents);
  const now = new Date().toISOString();

  this.db.prepare(`
    UPDATE enterprise_lead_workspaces
    SET workspace_agents = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(normalizedAgents), now, workspace.id);

  const updated = this.getWorkspace(workspace.id);
  if (!updated) {
    throw new Error('Enterprise lead workspace not found');
  }
  return updated;
}

listRuns(workspaceId: string): EnterpriseLeadRun[] {
  const rows = this.db.prepare(`
    SELECT
      id,
      workspace_id as workspaceId,
      user_goal as userGoal,
      status,
      current_role as currentRole,
      controller_summary as controllerSummary,
      archive_status as archiveStatus,
      created_at as createdAt,
      updated_at as updatedAt,
      completed_at as completedAt
    FROM enterprise_lead_runs
    WHERE workspace_id = ?
    ORDER BY updated_at DESC, rowid DESC
  `).all(workspaceId) as EnterpriseLeadRunRow[];

  return rows.map(mapRunRow);
}
```

- [ ] **Step 6: Add service methods for binding and effective Agents**

In `src/main/enterpriseLeadWorkspace/service.ts`, extend dependencies:

```ts
agentProvider?: {
  listAgents: () => Array<{
    id: string;
    name: string;
    description: string;
    identity: string;
    systemPrompt: string;
    icon: string;
    model: string;
    skillIds: string[];
    enabled: boolean;
  }>;
  getAgent: (agentId: string) => {
    id: string;
    name: string;
    description: string;
    identity: string;
    systemPrompt: string;
    icon: string;
    model: string;
    skillIds: string[];
    enabled: boolean;
  } | null;
};
```

Add service methods:

```ts
updateWorkspaceAgents(
  workspaceId: string,
  agents: EnterpriseLeadWorkspaceAgentBinding[],
): EnterpriseLeadWorkspace {
  return this.store.updateWorkspaceAgents(workspaceId, agents);
}

listRuns(workspaceId: string): EnterpriseLeadWorkspaceRunSummary[] {
  const workspace = this.store.getWorkspace(workspaceId);
  if (!workspace) {
    throw new Error('Enterprise lead workspace not found');
  }
  return this.store.listRuns(workspaceId).map(run => {
    const tasks = this.store.listTasks(run.id);
    return {
      run,
      taskCount: tasks.length,
      deliverableCount: this.deriveDeliverables(workspace, run, tasks).length,
      todoCount: this.deriveTodos(workspace, run, tasks).length,
      riskCount: tasks.reduce((count, task) => count + task.risks.length, 0),
    };
  });
}
```

- [ ] **Step 7: Run store and service tests**

Run:

```bash
npm test -- enterpriseLeadWorkspace
```

Expected: all existing enterprise workspace tests pass with new tests.

---

## Task 3: IPC, Preload, And Renderer Service

**Files:**

- Modify: `src/main/enterpriseLeadWorkspace/ipcHandlers.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Modify: `src/renderer/services/enterpriseLeadWorkspace.ts`
- Modify: `src/renderer/services/enterpriseLeadWorkspace.test.ts`

- [ ] **Step 1: Write failing renderer service tests**

In `src/renderer/services/enterpriseLeadWorkspace.test.ts`, add tests that mock `window.electron.enterpriseLeadWorkspace`:

```ts
test('updates workspace agent bindings through bridge', async () => {
  const binding = {
    agentId: 'agent-a',
    enabled: true,
    order: 0,
    overrides: { name: 'Workspace Writer' },
  };
  const workspace = {
    id: 'workspace-1',
    name: 'Workspace 1',
    type: 'enterprise_lead',
    profile: {
      companySummary: '',
      productList: [],
      productCapabilities: [],
      targetCustomers: [],
      applicationScenarios: [],
      sellingPoints: [],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
    },
    extractionSources: [],
    riskRules: [],
    enabledAgentRoles: [],
    workspaceAgents: [binding],
    settings: buildDefaultEnterpriseLeadWorkspaceSettings(),
    recentRunId: null,
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
  };
  const updateWorkspaceAgents = vi.fn(async () => ({
    success: true as const,
    data: workspace,
  }));
  createWindowWithEnterpriseLeadWorkspace({
    updateWorkspaceAgents: vi.fn().mockResolvedValue({
      success: true,
      data: workspace,
    }),
  });

  const result = await enterpriseLeadWorkspaceService.updateWorkspaceAgents('workspace-1', [binding]);

  expect(updateWorkspaceAgents).toHaveBeenCalledWith('workspace-1', [binding]);
  expect(result?.workspaceAgents).toEqual([binding]);
});

test('sends workspace chat messages through bridge', async () => {
  const chat = vi.fn(async () => ({
    success: true as const,
    data: {
      message: {
        id: 'assistant-1',
        role: 'assistant' as const,
        content: '可以，这是基于当前空间资料的回答。',
        createdAt: '2026-07-05T00:00:00.000Z',
      },
    },
  }));
  createWindowWithEnterpriseLeadWorkspace({
    chat,
  });

  const result = await enterpriseLeadWorkspaceService.chat('workspace-1', {
    message: '帮我写一段跟进话术',
  });

  expect(chat).toHaveBeenCalledWith('workspace-1', { message: '帮我写一段跟进话术' });
  expect(result?.message.content).toContain('当前空间资料');
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm test -- enterpriseLeadWorkspace
```

Expected: fails because bridge/service methods are missing.

- [ ] **Step 3: Add IPC handler dependencies and handlers**

In `src/main/enterpriseLeadWorkspace/ipcHandlers.ts`, extend service interface with:

```ts
updateWorkspaceAgents: (
  workspaceId: string,
  agents: EnterpriseLeadWorkspaceAgentBinding[],
) => EnterpriseLeadWorkspace | Promise<EnterpriseLeadWorkspace>;
listRuns: (
  workspaceId: string,
) => EnterpriseLeadWorkspaceRunSummary[] | Promise<EnterpriseLeadWorkspaceRunSummary[]>;
chat: (
  workspaceId: string,
  request: EnterpriseLeadWorkspaceChatRequest,
) => EnterpriseLeadWorkspaceChatResponse | Promise<EnterpriseLeadWorkspaceChatResponse>;
```

Register:

```ts
ipcMain.handle(
  EnterpriseLeadWorkspaceIpc.UpdateWorkspaceAgents,
  async (_event, input: { workspaceId?: unknown; agents?: unknown }) => {
    try {
      const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
      const agents = Array.isArray(input?.agents) ? input.agents as EnterpriseLeadWorkspaceAgentBinding[] : [];
      return ok(await deps.service.updateWorkspaceAgents(workspaceId, agents));
    } catch (error) {
      return fail<EnterpriseLeadWorkspace>(error);
    }
  },
);

ipcMain.handle(EnterpriseLeadWorkspaceIpc.ListRuns, async (_event, workspaceId: unknown) => {
  try {
    return ok(await deps.service.listRuns(requireNonEmptyString(workspaceId, 'Workspace id')));
  } catch (error) {
    return fail<EnterpriseLeadWorkspaceRunSummary[]>(error);
  }
});

ipcMain.handle(
  EnterpriseLeadWorkspaceIpc.Chat,
  async (_event, input: { workspaceId?: unknown; request?: unknown }) => {
    try {
      const workspaceId = requireNonEmptyString(input?.workspaceId, 'Workspace id');
      const request = readChatRequest(input?.request);
      return ok(await deps.service.chat(workspaceId, request));
    } catch (error) {
      return fail<EnterpriseLeadWorkspaceChatResponse>(error);
    }
  },
);
```

Add `readChatRequest`:

```ts
const readChatRequest = (value: unknown): EnterpriseLeadWorkspaceChatRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Chat request is required');
  }
  const record = value as Record<string, unknown>;
  const message = requireNonEmptyString(record.message, 'Message');
  return {
    message,
    targetAgentId: typeof record.targetAgentId === 'string' ? record.targetAgentId : undefined,
    recentMessages: Array.isArray(record.recentMessages)
      ? record.recentMessages as EnterpriseLeadWorkspaceChatMessage[]
      : undefined,
  };
};
```

- [ ] **Step 4: Wire main service dependencies**

In `src/main/main.ts`, when constructing `EnterpriseLeadWorkspaceService`, pass:

```ts
agentProvider: {
  listAgents: () => getAgentManager().listAgents(),
  getAgent: agentId => getAgentManager().getAgent(agentId),
},
externalResearch: {
  tavilySearch: (_workspaceId, config, query, maxResults) =>
    getEnterpriseLeadWorkspaceService().runWorkspaceTavilySearch(config, query, maxResults),
  // If this indirection is circular, move helper methods into service constructor deps instead.
},
```

During implementation, avoid circular calls by injecting small fetch helpers into `EnterpriseLeadWorkspaceService`:

```ts
researchClient: {
  tavilySearch: (apiKey, query, maxResults) => getAgentExternalResearchService().searchWithConfig('tavily', apiKey, query, maxResults),
  firecrawlSearch: (apiKey, query, maxResults) => getAgentExternalResearchService().searchWithConfig('firecrawl', apiKey, query, maxResults),
}
```

If `AgentExternalResearchService` does not expose config-based helpers, add them in Task 5.

- [ ] **Step 5: Expose preload APIs**

In `src/main/preload.ts`, add:

```ts
updateWorkspaceAgents: (workspaceId, agents) =>
  ipcRenderer.invoke(EnterpriseLeadWorkspaceIpc.UpdateWorkspaceAgents, { workspaceId, agents }),
listRuns: (workspaceId) =>
  ipcRenderer.invoke(EnterpriseLeadWorkspaceIpc.ListRuns, workspaceId),
chat: (workspaceId, request) =>
  ipcRenderer.invoke(EnterpriseLeadWorkspaceIpc.Chat, { workspaceId, request }),
```

In `src/renderer/types/electron.d.ts`, add matching signatures.

- [ ] **Step 6: Add renderer service wrappers**

In `src/renderer/services/enterpriseLeadWorkspace.ts`, add:

```ts
export const updateWorkspaceAgents = async (
  workspaceId: string,
  agents: EnterpriseLeadWorkspaceAgentBinding[],
): Promise<EnterpriseLeadWorkspace | null> =>
  request<EnterpriseLeadWorkspace | null>(
    'updateWorkspaceAgents',
    null,
    api => api.updateWorkspaceAgents(workspaceId, agents),
  );

export const listRuns = async (
  workspaceId: string,
): Promise<EnterpriseLeadWorkspaceRunSummary[]> =>
  request<EnterpriseLeadWorkspaceRunSummary[]>(
    'listRuns',
    [],
    api => api.listRuns(workspaceId),
  );

export const chat = async (
  workspaceId: string,
  chatRequest: EnterpriseLeadWorkspaceChatRequest,
): Promise<EnterpriseLeadWorkspaceChatResponse | null> =>
  request<EnterpriseLeadWorkspaceChatResponse | null>(
    'chat',
    null,
    api => api.chat(workspaceId, chatRequest),
  );
```

Export these on `enterpriseLeadWorkspaceService`.

- [ ] **Step 7: Run bridge/service tests**

Run:

```bash
npm test -- enterpriseLeadWorkspace
```

Expected: renderer service and IPC-related unit tests pass or expose only not-yet-implemented chat service failures.

---

## Task 4: Workspace Shell And Navigation Helpers

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceShell.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/index.ts`

- [ ] **Step 1: Add failing helper tests for internal pages**

In `enterpriseLeadWorkspaceUi.test.ts`, add:

```ts
test('defines workspace internal pages in sidebar order', () => {
  expect(getWorkspaceInternalPages().map(page => page.id)).toEqual([
    'workbench',
    'ai_chat',
    'knowledge_base',
    'creation_records',
    'settings',
  ]);
});

test('uses workbench as default workspace internal page', () => {
  expect(getDefaultWorkspaceInternalPage()).toBe('workbench');
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm test -- enterpriseLeadWorkspaceUi
```

Expected: missing helper functions.

- [ ] **Step 3: Add page metadata helpers**

In `enterpriseLeadWorkspaceUi.ts`, add:

```ts
export const EnterpriseLeadWorkspaceInternalPage = {
  Workbench: 'workbench',
  AiChat: 'ai_chat',
  KnowledgeBase: 'knowledge_base',
  CreationRecords: 'creation_records',
  Settings: 'settings',
} as const;
export type EnterpriseLeadWorkspaceInternalPage =
  typeof EnterpriseLeadWorkspaceInternalPage[keyof typeof EnterpriseLeadWorkspaceInternalPage];

export interface WorkspaceInternalPageMetadata {
  id: EnterpriseLeadWorkspaceInternalPage;
  icon: EnterpriseLeadWorkbenchNavIcon;
  labelKey: string;
}

const WORKSPACE_INTERNAL_PAGES: WorkspaceInternalPageMetadata[] = [
  { id: EnterpriseLeadWorkspaceInternalPage.Workbench, icon: EnterpriseLeadWorkbenchNavIcon.Dashboard, labelKey: 'enterpriseLeadWorkbenchNavWorkbench' },
  { id: EnterpriseLeadWorkspaceInternalPage.AiChat, icon: EnterpriseLeadWorkbenchNavIcon.Chat, labelKey: 'enterpriseLeadWorkbenchNavAiChat' },
  { id: EnterpriseLeadWorkspaceInternalPage.KnowledgeBase, icon: EnterpriseLeadWorkbenchNavIcon.Knowledge, labelKey: 'enterpriseLeadWorkbenchNavKnowledgeBase' },
  { id: EnterpriseLeadWorkspaceInternalPage.CreationRecords, icon: EnterpriseLeadWorkbenchNavIcon.Records, labelKey: 'enterpriseLeadWorkbenchNavCreationRecords' },
  { id: EnterpriseLeadWorkspaceInternalPage.Settings, icon: EnterpriseLeadWorkbenchNavIcon.Settings, labelKey: 'enterpriseLeadWorkbenchNavSettings' },
];

export const getWorkspaceInternalPages = (): WorkspaceInternalPageMetadata[] =>
  WORKSPACE_INTERNAL_PAGES.map(page => ({ ...page }));

export const getDefaultWorkspaceInternalPage = (): EnterpriseLeadWorkspaceInternalPage =>
  EnterpriseLeadWorkspaceInternalPage.Workbench;
```

- [ ] **Step 4: Create `WorkspaceShell.tsx`**

Create component with the existing sidebar styles:

```tsx
export const WorkspaceShell: React.FC<WorkspaceShellProps> = ({
  workspace,
  activePage,
  onPageChange,
  children,
}) => {
  const pages = getWorkspaceInternalPages();
  const sidebarMode = getDefaultWorkbenchSidebarMode();

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-surface-raised py-4 pr-4 pl-0">
      <aside
        data-workbench-sidebar-mode={sidebarMode}
        className="flex w-[196px] shrink-0 flex-col rounded-r-xl border-y border-r border-border bg-background px-3 py-3 shadow-sm"
      >
        <nav className="w-full space-y-1">
          {pages.map(page => {
            const Icon = navIconById[page.icon];
            const isActive = page.id === activePage;
            return (
              <button
                key={page.id}
                type="button"
                title={i18nService.t(page.labelKey)}
                onClick={() => onPageChange(page.id)}
                className={`flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-sm leading-5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                  isActive
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-secondary hover:bg-surface-raised hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{i18nService.t(page.labelKey)}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
};
```

Move `navIconById` to a shared local export or duplicate inside the new shell if simpler.

- [ ] **Step 5: Update opened workspace rendering**

In `EnterpriseLeadWorkspaceView.tsx`, replace `WorkspaceHome` with state:

```ts
const [activeInternalPage, setActiveInternalPage] = useState<EnterpriseLeadWorkspaceInternalPage>(
  getDefaultWorkspaceInternalPage(),
);
```

Render:

```tsx
<WorkspaceShell
  workspace={workspace}
  activePage={activeInternalPage}
  onPageChange={setActiveInternalPage}
>
  {renderWorkspaceInternalPage(activeInternalPage, workspace)}
</WorkspaceShell>
```

Initially `renderWorkspaceInternalPage` can route not-yet-built pages to a small
localized "page is being prepared" empty panel except `WorkspaceWorkbench`; later
tasks replace each empty panel with its real component.

- [ ] **Step 6: Run UI helper tests**

Run:

```bash
npm test -- enterpriseLeadWorkspaceUi
```

Expected: passes helper tests. Static render tests may need updates for new shell markup.

---

## Task 5: Workspace Settings Page Extraction

**Files:**

- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceSettings.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [ ] **Step 1: Add static render test for settings page**

In `enterpriseLeadWorkspaceUi.test.ts`, first add a small render helper near the
existing `renderWorkbench` helper so standalone page components can be rendered
with the same Redux/i18n assumptions:

```tsx
const renderEnterpriseLeadComponent = (element: React.ReactElement): string => {
  const testStore = configureStore({
    reducer: {
      model: modelReducer,
      skill: skillReducer,
    },
    preloadedState: {
      model: {
        providerConfig: null,
        configs: {},
        providerStatus: 'idle',
        providerError: null,
        modelOptions: {},
        modelOptionsStatus: 'idle',
        modelOptionsError: null,
      },
      skill: {
        skills: [],
        enabledSkillIds: [],
        loading: false,
        error: null,
        operationLoading: false,
      },
    },
  });

  return renderToStaticMarkup(
    <Provider store={testStore}>
      {element}
    </Provider>,
  );
};
```

Then add:

```ts
test('renders workspace settings with provider, skills, research, and platform sections', () => {
  const workspace = createWorkspace('workspace-1');
  const markup = renderEnterpriseLeadComponent(<WorkspaceSettings workspace={workspace} />);

  expect(markup).toContain('大模型厂商配置');
  expect(markup).toContain('技能管理');
  expect(markup).toContain('外部调研能力管理');
  expect(markup).toContain('内容平台配置');
  expect(markup).toContain('保存配置');
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm test -- enterpriseLeadWorkspaceUi
```

Expected: `WorkspaceSettings` does not exist.

- [ ] **Step 3: Extract settings editor**

Move provider, skill, external research, domestic source state and render functions from `WorkspaceWorkbench.tsx` into `WorkspaceSettings.tsx`.

Use props:

```ts
interface WorkspaceSettingsProps {
  workspace: EnterpriseLeadWorkspace;
  onWorkspaceUpdated?: (workspace: EnterpriseLeadWorkspace) => void;
}
```

Keep save behavior:

```ts
const updated = await enterpriseLeadWorkspaceService.updateWorkspaceSettings(workspace.id, {
  settings: draftSettings,
});
```

Do not send `enabledAgentRoles` from settings page.

- [ ] **Step 4: Simplify workbench**

Remove provider/skill/research/platform editors from `WorkspaceWorkbench.tsx`. Leave a compact configuration status summary with a button that switches to `EnterpriseLeadWorkspaceInternalPage.Settings`.

Add prop:

```ts
onOpenSettings?: () => void;
```

- [ ] **Step 5: Wire page route**

In `EnterpriseLeadWorkspaceView.tsx`, route Settings to:

```tsx
<WorkspaceSettings
  workspace={workspace}
  onWorkspaceUpdated={handleWorkspaceUpdated}
/>
```

Pass `onOpenSettings` to `WorkspaceWorkbench`.

- [ ] **Step 6: Run UI tests**

Run:

```bash
npm test -- enterpriseLeadWorkspaceUi
```

Expected: settings render test passes and workbench tests are updated to assert settings editors moved out.

---

## Task 6: Workspace Agent Management Workbench

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Possibly reuse: `src/renderer/components/agent/AgentCreateModal.tsx`
- Possibly reuse: `src/renderer/components/agent/AgentSettingsPanel.tsx`

- [ ] **Step 1: Add helper tests for effective workspace Agent merge**

In `enterpriseLeadWorkspaceUi.test.ts`, add:

```ts
test('merges workspace agent overrides over global agent template', () => {
  const effective = getEffectiveWorkspaceAgent({
    agentId: 'agent-a',
    enabled: true,
    order: 0,
    overrides: {
      name: 'Workspace Writer',
      skillIds: ['web-search'],
    },
  }, {
    id: 'agent-a',
    name: 'Global Writer',
    description: 'Global description',
    identity: 'Global identity',
    systemPrompt: 'Global prompt',
    icon: 'briefcase',
    model: 'deepseek/deepseek-chat',
    skillIds: ['docx'],
    enabled: true,
  });

  expect(effective.name).toBe('Workspace Writer');
  expect(effective.description).toBe('Global description');
  expect(effective.skillIds).toEqual(['web-search']);
});
```

- [ ] **Step 2: Implement effective Agent helper**

In `enterpriseLeadWorkspaceUi.ts`, add:

```ts
export const getEffectiveWorkspaceAgent = (
  binding: EnterpriseLeadWorkspaceAgentBinding,
  globalAgent: Pick<Agent, 'id' | 'name' | 'description' | 'identity' | 'systemPrompt' | 'icon' | 'model' | 'skillIds' | 'enabled'> | null,
): EffectiveWorkspaceAgent => ({
  id: binding.agentId,
  missing: !globalAgent,
  enabled: binding.enabled,
  order: binding.order,
  name: binding.overrides.name ?? globalAgent?.name ?? binding.agentId,
  description: binding.overrides.description ?? globalAgent?.description ?? '',
  identity: binding.overrides.identity ?? globalAgent?.identity ?? '',
  systemPrompt: binding.overrides.systemPrompt ?? globalAgent?.systemPrompt ?? '',
  icon: binding.overrides.icon ?? globalAgent?.icon ?? 'briefcase',
  model: binding.overrides.model ?? globalAgent?.model ?? '',
  skillIds: binding.overrides.skillIds ?? globalAgent?.skillIds ?? [],
});
```

- [ ] **Step 3: Update Workbench UI**

Render workspace-bound Agents from `workspace.workspaceAgents`, merged with Redux global agents.

When no `workspaceAgents` exist but `enabledAgentRoles` exist, render compatibility starter cards using existing role metadata and a CTA to initialize workspace Agents.

Add actions:

- Create Agent
- Add Existing Agent
- Edit
- Enable/Disable
- Remove from workspace

For first pass, `Edit` can open a simple workspace override drawer instead of global `AgentSettingsPanel`.

- [ ] **Step 4: Add update handlers**

Use:

```ts
await enterpriseLeadWorkspaceService.updateWorkspaceAgents(workspace.id, nextBindings);
```

After success call `onWorkspaceUpdated(updated)`.

- [ ] **Step 5: Run renderer tests**

Run:

```bash
npm test -- enterpriseLeadWorkspaceUi
```

Expected: effective Agent helper tests pass and workbench static render tests reflect Agent management.

---

## Task 7: Knowledge Base And Creation Records Pages

**Files:**

- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreationRecords.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`

- [ ] **Step 1: Add helper tests for knowledge sections**

Add:

```ts
test('builds workspace knowledge sections from profile and snapshot', () => {
  const workspace = createWorkspace('workspace-1');
  workspace.profile.companySummary = '精密制造企业';
  workspace.profile.productList = ['CNC 加工'];
  const sections = getWorkspaceKnowledgeSections(workspace, createSnapshot(workspace));

  expect(sections.map(section => section.id)).toContain('company');
  expect(sections.find(section => section.id === 'company')?.items[0]).toContain('精密制造企业');
});
```

- [ ] **Step 2: Add helper tests for run summaries**

Add:

```ts
test('summarizes creation record counts from run summary', () => {
  const summary = getCreationRecordSummary({
    run: createRun('workspace-1'),
    taskCount: 3,
    deliverableCount: 2,
    todoCount: 1,
    riskCount: 4,
  });

  expect(summary.meta).toContain('3');
  expect(summary.meta).toContain('2');
  expect(summary.meta).toContain('1');
  expect(summary.meta).toContain('4');
});
```

- [ ] **Step 3: Implement helpers**

Add `getWorkspaceKnowledgeSections` and `getCreationRecordSummary` in `enterpriseLeadWorkspaceUi.ts`.

Keep them pure and independent of React.

- [ ] **Step 4: Implement `WorkspaceKnowledgeBase`**

Render sections:

- enterprise profile
- products/capabilities
- customers/scenarios
- selling points/channels
- prohibited claims/contact rules
- source materials
- recent deliverables
- archives

Use empty state for sections without items.

- [ ] **Step 5: Implement `WorkspaceCreationRecords`**

On mount, call:

```ts
enterpriseLeadWorkspaceService.listRuns(workspace.id)
```

Render list. On selection, call:

```ts
enterpriseLeadWorkspaceService.getRun(workspace.id, runId)
```

Render task summaries, deliverables, todos, risks, and archive state.

- [ ] **Step 6: Wire routes**

In `EnterpriseLeadWorkspaceView.tsx`, route KnowledgeBase and CreationRecords to the new components.

- [ ] **Step 7: Run renderer tests**

Run:

```bash
npm test -- enterpriseLeadWorkspaceUi
```

Expected: helper tests and static render tests pass.

---

## Task 8: Workspace AI Chat Service

**Files:**

- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.test.ts`
- Modify: `src/main/enterpriseLeadWorkspace/promptTemplates.ts`
- Modify: `src/main/agentExternalResearchService.ts`
- Modify: `src/main/agentExternalResearchService.test.ts`

- [ ] **Step 1: Extend service test helpers for injected Agents and research**

In `service.test.ts`, update the Vitest import:

```ts
import { afterEach, describe, expect, test, vi } from 'vitest';
```

Then extend the existing `createService()` helper instead of adding test-only
setters to the service:

```ts
const createAgentProvider = (agents: Array<{
  id: string;
  name: string;
  description?: string;
  identity?: string;
  systemPrompt?: string;
  icon?: string;
  model?: string;
  skillIds?: string[];
  enabled?: boolean;
}> = []) => ({
  listAgents: () => agents,
  getAgent: (agentId: string) => agents.find(agent => agent.id === agentId) ?? null,
});

const createResearchClient = () => ({
  tavilySearch: vi.fn(),
  tavilyExtract: vi.fn(),
  firecrawlSearch: vi.fn(),
  firecrawlScrape: vi.fn(),
  domesticSearch: vi.fn(),
});

const createService = (
  overrides: Partial<ConstructorParameters<typeof EnterpriseLeadWorkspaceService>[0]> = {},
): {
  db: Database.Database;
  modelClient: FakeModelClient;
  researchClient: ReturnType<typeof createResearchClient>;
  service: EnterpriseLeadWorkspaceService;
  store: EnterpriseLeadWorkspaceStore;
} => {
  const db = new Database(':memory:');
  const store = new EnterpriseLeadWorkspaceStore(db);
  const modelClient = new FakeModelClient();
  const researchClient = createResearchClient();
  const agentProvider = createAgentProvider();
  return {
    db,
    modelClient,
    researchClient,
    service: new EnterpriseLeadWorkspaceService({
      store,
      modelClient,
      agentProvider,
      researchClient,
      ...overrides,
    }),
    store,
  };
};
```

During implementation, make the matching service constructor dependencies real:

```ts
interface EnterpriseLeadWorkspaceAgentProvider {
  listAgents: () => EnterpriseLeadWorkspaceAgentTemplate[];
  getAgent: (agentId: string) => EnterpriseLeadWorkspaceAgentTemplate | null;
}

interface EnterpriseLeadWorkspaceResearchClient {
  tavilySearch: (apiKey: string, query: string, maxResults: number) => Promise<unknown>;
  tavilyExtract: (apiKey: string, urls: string[]) => Promise<unknown>;
  firecrawlSearch: (apiKey: string, query: string, maxResults: number) => Promise<unknown>;
  firecrawlScrape: (apiKey: string, url: string) => Promise<unknown>;
  domesticSearch: (sourceId: string, query: string, maxResults: number) => Promise<unknown>;
}
```

Use no-op defaults in the service constructor only where necessary so existing
tests that do not care about Agents or research keep working.

- [ ] **Step 2: Add service tests for chat without research**

In `service.test.ts`, add:

```ts
test('answers workspace chat with workspace profile and effective agents', async () => {
  const setup = createService({
    agentProvider: createAgentProvider([{
      id: 'agent-a',
      name: 'Global Agent',
      description: 'Global desc',
      identity: 'Global identity',
      systemPrompt: 'Global prompt',
      icon: 'briefcase',
      model: '',
      skillIds: [],
      enabled: true,
    }]),
  });
  const draft = draftPayload();
  draft.profile.companySummary = '精密制造企业';
  const workspace = setup.store.createWorkspace({
    name: draft.name,
    type: 'enterprise_lead',
    profile: draft.profile,
    extractionSources: [draft.source],
    enabledAgentRoles: [],
    workspaceAgents: [{
      agentId: 'agent-a',
      enabled: true,
      order: 0,
      overrides: { name: '内容 Agent', systemPrompt: '只写适合制造业的内容。' },
    }],
  });
  setup.modelClient.enqueue({ researchIntent: { kind: 'none' } });
  setup.modelClient.enqueue('这是基于精密制造企业资料生成的回答。');

  const response = await setup.service.chat(workspace.id, {
    message: '帮我写一段客户跟进话术',
    targetAgentId: 'agent-a',
  });

  expect(response.message.role).toBe('assistant');
  expect(response.message.content).toContain('精密制造企业');
  expect(setup.modelClient.prompts[1].prompt).toContain('内容 Agent');
});
```

- [ ] **Step 3: Add tests for unconfigured and failed research**

Add:

```ts
test('workspace chat reports unconfigured research and still answers', async () => {
  const setup = createService();
  const workspace = setup.service.createWorkspace(draftPayload());
  setup.modelClient.enqueue({ researchIntent: { kind: 'search', query: '机械厂采购信号', provider: 'auto' } });
  setup.modelClient.enqueue('当前空间未配置调研能力，以下基于已有资料低置信生成。');

  const response = await setup.service.chat(workspace.id, { message: '调研机械厂采购信号' });

  expect(response.message.research?.status).toBe('failed');
  expect(response.message.content).toContain('未配置调研能力');
});

test('workspace chat clamps invalid research intent before network calls', async () => {
  const setup = createService();
  const workspace = setup.service.createWorkspace(draftPayloadWithWorkspaceModelConfig());
  setup.modelClient.enqueue({
    researchIntent: {
      kind: 'extract',
      urls: ['ftp://invalid.test/a', 'https://example.com/a'],
      provider: 'bad-provider',
    },
  });
  setup.researchClient.firecrawlScrape.mockResolvedValue({ markdown: 'Example page' });
  setup.modelClient.enqueue('已根据页面内容总结。');

  await setup.service.chat(workspace.id, { message: '总结这个链接 https://example.com/a' });

  expect(setup.researchClient.firecrawlScrape).toHaveBeenCalledWith(
    expect.any(String),
    'https://example.com/a',
  );
});
```

- [ ] **Step 4: Add prompt builders**

In `promptTemplates.ts`, add:

```ts
export function buildWorkspaceChatResearchIntentPrompt(input: WorkspaceChatPromptInput): string {
  return [
    '你是企业线索工作区的调研意图分类器。',
    '只输出 JSON，不要输出 Markdown。',
    'JSON schema:',
    stringify({
      researchIntent: {
        kind: 'none | search | extract | domestic_status',
        query: 'search query when needed',
        urls: ['urls when extracting'],
        provider: 'auto | tavily | firecrawl',
      },
    }),
    '用户消息:',
    input.message,
    '当前工作区摘要:',
    stringify(input.workspaceSummary),
  ].join('\n');
}

export function buildWorkspaceChatResponsePrompt(input: WorkspaceChatResponsePromptInput): string {
  return [
    '你是企业线索工作区 AI 对话助手。',
    '安全边界:',
    buildSafetySection(),
    '回答必须基于工作区资料、当前 Agent 定义和调研结果。',
    '如果信息不足，明确说明不确定性，不要编造客户、联系人、认证、价格或交付事实。',
    '用户消息:',
    input.message,
    '目标 Agent:',
    stringify(input.targetAgent ?? null),
    '工作区资料:',
    stringify(input.workspace),
    '近期上下文:',
    stringify(input.recentMessages ?? []),
    '调研结果:',
    stringify(input.research ?? null),
  ].join('\n');
}
```

- [ ] **Step 5: Add config-based research helpers**

In `AgentExternalResearchService`, add helpers that accept provider config instead of agent ID:

```ts
async tavilySearchWithConfig(config: ExternalResearchProviderConfig, query: string, maxResults = 5): Promise<unknown> {
  this.assertProviderReady(ExternalResearchProviderId.Tavily, config.enabled, config.apiKey);
  return this.postJson('https://api.tavily.com/search', config.apiKey, {
    query,
    search_depth: 'advanced',
    chunks_per_source: 3,
    max_results: maxResults,
    include_answer: false,
    include_raw_content: false,
    country: 'china',
  });
}
```

Add equivalent `tavilyExtractWithConfig`, `firecrawlSearchWithConfig`, and `firecrawlScrapeWithConfig`.

- [ ] **Step 6: Implement service chat**

In `EnterpriseLeadWorkspaceService.chat`:

1. Load workspace.
2. Resolve effective workspace Agents.
3. Generate research intent using model.
4. Normalize intent with `normalizeWorkspaceChatResearchIntent`.
5. Execute research with workspace settings.
6. Generate final response.
7. Return an assistant message with research metadata.

Use generated IDs:

```ts
const message: EnterpriseLeadWorkspaceChatMessage = {
  id: randomUUID(),
  role: 'assistant',
  content: result.text.trim(),
  createdAt: new Date().toISOString(),
  research,
};
```

- [ ] **Step 7: Run service tests**

Run:

```bash
npm test -- enterpriseLeadWorkspace
```

Expected: chat tests pass.

---

## Task 9: Workspace AI Chat UI

**Files:**

- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Add static render test**

Add:

```ts
test('renders workspace AI chat with configured agent choices', () => {
  const workspace = createWorkspace('workspace-1');
  workspace.workspaceAgents = [{
    agentId: 'agent-a',
    enabled: true,
    order: 0,
    overrides: { name: '内容 Agent' },
  }];
  const markup = renderEnterpriseLeadComponent(<WorkspaceAiChat workspace={workspace} />);

  expect(markup).toContain('AI 对话');
  expect(markup).toContain('内容 Agent');
  expect(markup).toContain('发送');
});
```

- [ ] **Step 2: Implement UI**

Create component:

- page header
- message list
- target Agent select
- textarea
- send button
- research status chip in assistant messages
- error banner

Send:

```ts
const response = await enterpriseLeadWorkspaceService.chat(workspace.id, {
  message: trimmed,
  targetAgentId: selectedAgentId || undefined,
  recentMessages: messages.slice(-8),
});
```

- [ ] **Step 3: Add i18n keys**

Add Chinese and English keys:

- `enterpriseLeadAiChatTitle`
- `enterpriseLeadAiChatSubtitle`
- `enterpriseLeadAiChatPlaceholder`
- `enterpriseLeadAiChatSend`
- `enterpriseLeadAiChatAgentAll`
- `enterpriseLeadAiChatResearchCompleted`
- `enterpriseLeadAiChatResearchFailed`
- `enterpriseLeadAiChatFailed`

- [ ] **Step 4: Wire route**

In `EnterpriseLeadWorkspaceView.tsx`, render:

```tsx
<WorkspaceAiChat workspace={workspace} />
```

for `EnterpriseLeadWorkspaceInternalPage.AiChat`.

- [ ] **Step 5: Run renderer tests**

Run:

```bash
npm test -- enterpriseLeadWorkspaceUi
```

Expected: AI chat render test passes.

---

## Task 10: i18n, Exports, And Final Verification

**Files:**

- Modify: `src/renderer/services/i18n.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/index.ts`
- Review all touched files

- [ ] **Step 1: Add remaining i18n keys**

Add keys for:

- workspace Agent management actions
- knowledge empty states
- creation records labels
- settings safety labels
- chat labels
- missing Agent warnings

Every new Chinese key gets English equivalent in the English dictionary block.

- [ ] **Step 2: Export new components**

Update `index.ts`:

```ts
export { WorkspaceShell } from './WorkspaceShell';
export { WorkspaceAiChat } from './WorkspaceAiChat';
export { WorkspaceKnowledgeBase } from './WorkspaceKnowledgeBase';
export { WorkspaceCreationRecords } from './WorkspaceCreationRecords';
export { WorkspaceSettings } from './WorkspaceSettings';
```

- [ ] **Step 3: Run targeted tests**

Run:

```bash
npm test -- enterpriseLeadWorkspace
```

Expected: all enterprise workspace tests pass.

- [ ] **Step 4: Run changed-file ESLint**

Run with the actual touched file list:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/enterpriseLeadWorkspace/types.ts src/shared/enterpriseLeadWorkspace/constants.ts src/shared/enterpriseLeadWorkspace/validation.ts src/shared/enterpriseLeadWorkspace/validation.test.ts src/main/enterpriseLeadWorkspace/store.ts src/main/enterpriseLeadWorkspace/store.test.ts src/main/enterpriseLeadWorkspace/service.ts src/main/enterpriseLeadWorkspace/service.test.ts src/main/enterpriseLeadWorkspace/promptTemplates.ts src/main/enterpriseLeadWorkspace/ipcHandlers.ts src/main/agentExternalResearchService.ts src/main/agentExternalResearchService.test.ts src/main/main.ts src/main/preload.ts src/renderer/types/electron.d.ts src/renderer/services/enterpriseLeadWorkspace.ts src/renderer/services/enterpriseLeadWorkspace.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceShell.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceWorkbench.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceSettings.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceAiChat.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreationRecords.tsx src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/components/enterpriseLeadWorkspace/index.ts src/renderer/services/i18n.ts
```

Expected: no ESLint errors or warnings in touched files.

- [ ] **Step 5: Compile Electron**

Run:

```bash
npm run compile:electron
```

Expected: Electron main/preload TypeScript compile passes.

- [ ] **Step 6: Manual check**

Run the app when practical:

```bash
npm run electron:dev
```

Check:

- opened workspace sidebar switches all five pages;
- 工作台 creates/edits workspace-local Agent overrides without changing global Agent details in another workspace;
- AI 对话 answers with workspace data and shows research state;
- 知识库 shows profile/source/deliverable/archive data;
- 创作记录 lists runs and opens details;
- 空间设置 saves model/skill/research/source config.

---

## Self-Review Notes

Spec coverage:

- Five pages: covered by Tasks 4, 5, 6, 7, 9.
- Workspace-local Agent editing: covered by Tasks 1, 2, 6.
- AI chat with research: covered by Tasks 1, 3, 8, 9.
- Knowledge base: covered by Task 7.
- Creation records: covered by Tasks 2 and 7.
- Settings extraction: covered by Task 5.
- Tests and verification: covered by Task 10.

Known phase boundary:

- 工作台 and AI 对话 use workspace-bound Agents and workspace-local overrides in this implementation.
- Dynamic workflow execution from arbitrary workspace Agents is intentionally deferred. The current run/task schema still stores `EnterpriseLeadAgentRole` task records, so existing/new execution runs continue through the fixed enterprise lead role workflow until a follow-up schema and runner migration is implemented.
