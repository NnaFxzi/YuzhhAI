# Agent External Research Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add visual Tavily and Firecrawl configuration for every agent, then let promotion-positioning tools use those
providers without environment variables.

**Architecture:** Store app-default and per-agent research credentials in a dedicated SQLite-backed store, expose them
through agent IPC and the agent create/settings UI, and keep API keys in main-process services only. Add a provider
client/service layer for Tavily and Firecrawl, then extend the OpenClaw positioning bridge so tools pass session context
and research intent while the main process resolves the active agent and credentials.

**Tech Stack:** Electron main/preload IPC, React + Redux + Tailwind renderer UI, better-sqlite3, Vitest, TypeScript
`fetch`, OpenClaw local extension tools.

---

## Source References

- Design spec: `docs/archive/superpowers/2026-07/specs/2026-07-03-marketing-agent-positioning-research-design.md`
- Tavily docs: `https://docs.tavily.com/documentation/api-reference/endpoint/search`,
  `https://docs.tavily.com/documentation/api-reference/endpoint/extract`
- Firecrawl docs: `https://docs.firecrawl.dev/api-reference/endpoint/search`,
  `https://docs.firecrawl.dev/api-reference/endpoint/scrape`

The first implementation should use:

- Tavily `POST https://api.tavily.com/search` with `Authorization: Bearer <key>`.
- Tavily `POST https://api.tavily.com/extract` with `Authorization: Bearer <key>`.
- Firecrawl `POST https://api.firecrawl.dev/v2/search` with `Authorization: Bearer <key>`.
- Firecrawl `POST https://api.firecrawl.dev/v2/scrape` with `Authorization: Bearer <key>`.

Do not use `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, or any environment-variable fallback.

## File Structure

- Create `src/shared/agent/externalResearch.ts`: provider ids, settings modes, credential/config types, normalization
  helpers, secret redaction helpers, and payload builders used across main/renderer/tests.
- Modify `src/shared/agent/constants.ts`: add IPC channel constants for external research settings and connection tests.
- Create `src/main/agentExternalResearchStore.ts`: dedicated SQLite store for app defaults and per-agent settings.
- Create `src/main/agentExternalResearchStore.test.ts`: persistence, inheritance, secret masking, and deletion cleanup
  tests.
- Create `src/main/agentExternalResearchService.ts`: resolves effective settings, tests provider connections, and owns
  provider credentials.
- Create `src/main/agentExternalResearchService.test.ts`: fetch-mocked tests for Tavily/Firecrawl requests and redacted
  errors.
- Modify `src/main/main.ts`: instantiate the external research store/service, register IPC handlers, and inject service
  into OpenClaw research/positioning callbacks.
- Modify `src/main/preload.ts`: expose safe external research methods under `window.electron.agents`.
- Modify `src/renderer/types/agent.ts`, `src/renderer/store/slices/agentSlice.ts`, `src/renderer/services/agent.ts`: add
  safe config summaries and service methods.
- Create `src/renderer/components/agent/AgentExternalResearchPanel.tsx`: reusable UI panel for create and settings
  modals.
- Create `src/renderer/components/agent/AgentExternalResearchPanel.test.tsx`: UI behavior around masking, defaults,
  overrides, clear, and test buttons.
- Modify `src/renderer/components/agent/constants.ts`: add `AgentDetailTab.ExternalResearch`.
- Modify `src/renderer/components/agent/AgentCreateModal.tsx` and
  `src/renderer/components/agent/AgentSettingsPanel.tsx`: add the tab and save/load flows.
- Modify `src/renderer/services/i18n.ts`: add Chinese and English UI strings.
- Modify `src/main/libs/mcpBridgeServer.ts`, `src/main/mcp/mcpRuntime.ts`, and
  `openclaw-extensions/lobster-industry-positioning/index.ts`: include `sessionKey` in positioning tool context and add
  research tools.
- Modify `src/main/industryPack/positioningService.ts`: allow latest reports to be resolved per agent once reports carry
  agent id.
- Modify `src/shared/industryPack/positioning.ts`, `src/main/industryPack/industryPackStore.ts`, and related tests:
  persist `agentId`, provider availability, and source counts on reports.
- Modify `src/main/presetAgents.ts`: update `推广agent` prompt so it uses visual Tavily/Firecrawl settings and never
  asks for env vars.
- Modify `src/main/libs/openclawExtensionManifests.test.ts`, `src/main/libs/openclawConfigSync.runtime.test.ts`, and
  related bridge tests.

Do not commit during execution unless the user explicitly asks for a commit.

---

### Task 1: Shared Types And Normalization

**Files:**

- Create: `src/shared/agent/externalResearch.ts`
- Modify: `src/shared/agent/constants.ts`
- Test: `src/shared/agent/externalResearch.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/shared/agent/externalResearch.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import {
  AgentExternalResearchMode,
  ExternalResearchProviderId,
  buildDefaultExternalResearchConfig,
  getEffectiveExternalResearchConfig,
  maskExternalResearchConfig,
  normalizeExternalResearchConfig,
  redactExternalResearchSecret,
} from './externalResearch';

describe('external research config helpers', () => {
  test('normalizes app defaults without requiring environment variables', () => {
    const config = normalizeExternalResearchConfig({
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: { enabled: true, apiKey: ' tvly-test ' },
        firecrawl: { enabled: false, apiKey: ' fc-test ' },
      },
    });

    expect(config.mode).toBe(AgentExternalResearchMode.Override);
    expect(config.providers.tavily).toEqual({ enabled: true, apiKey: 'tvly-test' });
    expect(config.providers.firecrawl).toEqual({ enabled: false, apiKey: 'fc-test' });
  });

  test('uses app defaults for an agent in inherit mode', () => {
    const appDefault = normalizeExternalResearchConfig({
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: { enabled: true, apiKey: 'tvly-default' },
        firecrawl: { enabled: true, apiKey: 'fc-default' },
      },
    });
    const agent = buildDefaultExternalResearchConfig(AgentExternalResearchMode.Inherit);

    expect(getEffectiveExternalResearchConfig(agent, appDefault)).toEqual(appDefault);
  });

  test('masks secrets for renderer summaries', () => {
    const masked = maskExternalResearchConfig(normalizeExternalResearchConfig({
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: { enabled: true, apiKey: 'tvly-1234567890' },
        firecrawl: { enabled: true, apiKey: 'fc-abcdef123456' },
      },
    }));

    expect(masked.providers[ExternalResearchProviderId.Tavily].hasApiKey).toBe(true);
    expect(masked.providers[ExternalResearchProviderId.Tavily].apiKeyPreview).toBe('tvly...7890');
    expect(masked.providers[ExternalResearchProviderId.Firecrawl].apiKeyPreview).toBe('fc-a...3456');
    expect(JSON.stringify(masked)).not.toContain('1234567890');
  });

  test('redacts known key values from error strings', () => {
    const redacted = redactExternalResearchSecret(
      'Authorization failed for tvly-secret and fc-secret',
      ['tvly-secret', 'fc-secret'],
    );

    expect(redacted).toBe('Authorization failed for [redacted] and [redacted]');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- src/shared/agent/externalResearch.test.ts
```

Expected: fail because `src/shared/agent/externalResearch.ts` does not exist.

- [ ] **Step 3: Add shared types and helpers**

Create `src/shared/agent/externalResearch.ts`:

```ts
export const ExternalResearchProviderId = {
  Tavily: 'tavily',
  Firecrawl: 'firecrawl',
} as const;

export type ExternalResearchProviderId =
  typeof ExternalResearchProviderId[keyof typeof ExternalResearchProviderId];

export const ExternalResearchProviderIds = [
  ExternalResearchProviderId.Tavily,
  ExternalResearchProviderId.Firecrawl,
] as const;

export const AgentExternalResearchMode = {
  Inherit: 'inherit',
  Override: 'override',
  Disabled: 'disabled',
} as const;

export type AgentExternalResearchMode =
  typeof AgentExternalResearchMode[keyof typeof AgentExternalResearchMode];

export const ExternalResearchSettingsScope = {
  AppDefault: '__app_default__',
} as const;

export interface ExternalResearchProviderConfig {
  enabled: boolean;
  apiKey: string;
}

export interface ExternalResearchConfig {
  mode: AgentExternalResearchMode;
  providers: Record<ExternalResearchProviderId, ExternalResearchProviderConfig>;
}

export interface MaskedExternalResearchProviderConfig {
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyPreview: string;
}

export interface MaskedExternalResearchConfig {
  mode: AgentExternalResearchMode;
  providers: Record<ExternalResearchProviderId, MaskedExternalResearchProviderConfig>;
}

export const buildDefaultExternalResearchConfig = (
  mode: AgentExternalResearchMode = AgentExternalResearchMode.Inherit,
): ExternalResearchConfig => ({
  mode,
  providers: {
    [ExternalResearchProviderId.Tavily]: { enabled: false, apiKey: '' },
    [ExternalResearchProviderId.Firecrawl]: { enabled: false, apiKey: '' },
  },
});

const readProvider = (value: unknown): ExternalResearchProviderConfig => {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    enabled: raw.enabled === true,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '',
  };
};

export const normalizeExternalResearchConfig = (value: unknown): ExternalResearchConfig => {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const modeValues = Object.values(AgentExternalResearchMode);
  const mode = modeValues.includes(raw.mode as AgentExternalResearchMode)
    ? raw.mode as AgentExternalResearchMode
    : AgentExternalResearchMode.Inherit;
  const providers = raw.providers && typeof raw.providers === 'object' && !Array.isArray(raw.providers)
    ? raw.providers as Record<string, unknown>
    : {};

  return {
    mode,
    providers: {
      [ExternalResearchProviderId.Tavily]: readProvider(providers[ExternalResearchProviderId.Tavily]),
      [ExternalResearchProviderId.Firecrawl]: readProvider(providers[ExternalResearchProviderId.Firecrawl]),
    },
  };
};

export const getEffectiveExternalResearchConfig = (
  agentConfig: ExternalResearchConfig,
  appDefaultConfig: ExternalResearchConfig,
): ExternalResearchConfig => {
  if (agentConfig.mode === AgentExternalResearchMode.Disabled) {
    return buildDefaultExternalResearchConfig(AgentExternalResearchMode.Disabled);
  }
  if (agentConfig.mode === AgentExternalResearchMode.Override) {
    return agentConfig;
  }
  return appDefaultConfig;
};

const previewSecret = (apiKey: string): string => {
  if (!apiKey) return '';
  if (apiKey.length <= 8) return '••••';
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
};

export const maskExternalResearchConfig = (
  config: ExternalResearchConfig,
): MaskedExternalResearchConfig => ({
  mode: config.mode,
  providers: {
    [ExternalResearchProviderId.Tavily]: {
      enabled: config.providers.tavily.enabled,
      hasApiKey: config.providers.tavily.apiKey.length > 0,
      apiKeyPreview: previewSecret(config.providers.tavily.apiKey),
    },
    [ExternalResearchProviderId.Firecrawl]: {
      enabled: config.providers.firecrawl.enabled,
      hasApiKey: config.providers.firecrawl.apiKey.length > 0,
      apiKeyPreview: previewSecret(config.providers.firecrawl.apiKey),
    },
  },
});

export const redactExternalResearchSecret = (message: string, secrets: string[]): string =>
  secrets
    .filter(secret => secret.trim().length > 0)
    .reduce((current, secret) => current.split(secret).join('[redacted]'), message);
```

Modify `src/shared/agent/constants.ts`:

```ts
export const AgentIpcChannel = {
  List: 'agents:list',
  Get: 'agents:get',
  Create: 'agents:create',
  Update: 'agents:update',
  Delete: 'agents:delete',
  Presets: 'agents:presets',
  PresetTemplates: 'agents:presetTemplates',
  AddPreset: 'agents:addPreset',
  GetExternalResearchSettings: 'agents:externalResearch:get',
  SaveExternalResearchSettings: 'agents:externalResearch:save',
  TestExternalResearchProvider: 'agents:externalResearch:testProvider',
} as const;
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npm test -- src/shared/agent/externalResearch.test.ts
```

Expected: pass.

---

### Task 2: SQLite Store For App Defaults And Per-Agent Overrides

**Files:**

- Create: `src/main/agentExternalResearchStore.ts`
- Create: `src/main/agentExternalResearchStore.test.ts`

- [ ] **Step 1: Write the failing store tests**

Create `src/main/agentExternalResearchStore.test.ts`:

```ts
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { AgentExternalResearchMode, ExternalResearchProviderId } from '../shared/agent/externalResearch';
import { AgentExternalResearchStore } from './agentExternalResearchStore';

let db: Database.Database;
let store: AgentExternalResearchStore;

beforeEach(() => {
  db = new Database(':memory:');
  store = new AgentExternalResearchStore(db);
});

afterEach(() => {
  db.close();
});

describe('AgentExternalResearchStore', () => {
  test('returns disabled app defaults when no row exists', () => {
    const defaults = store.getAppDefaults();

    expect(defaults.mode).toBe(AgentExternalResearchMode.Override);
    expect(defaults.providers.tavily.enabled).toBe(false);
    expect(defaults.providers.firecrawl.apiKey).toBe('');
  });

  test('saves and reads app defaults with raw keys only in main store', () => {
    store.saveAppDefaults({
      mode: AgentExternalResearchMode.Override,
      providers: {
        [ExternalResearchProviderId.Tavily]: { enabled: true, apiKey: 'tvly-main' },
        [ExternalResearchProviderId.Firecrawl]: { enabled: true, apiKey: 'fc-main' },
      },
    });

    expect(store.getAppDefaults().providers.tavily.apiKey).toBe('tvly-main');
    expect(store.getMaskedAppDefaults().providers.tavily.apiKeyPreview).toBe('tvly...main');
  });

  test('agent settings inherit app defaults by default', () => {
    const config = store.getAgentSettings('agent-a');

    expect(config.mode).toBe(AgentExternalResearchMode.Inherit);
    expect(config.providers.tavily.enabled).toBe(false);
  });

  test('saves per-agent override and resolves effective config', () => {
    store.saveAppDefaults({
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: { enabled: true, apiKey: 'tvly-default' },
        firecrawl: { enabled: false, apiKey: '' },
      },
    });
    store.saveAgentSettings('agent-a', {
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: { enabled: false, apiKey: '' },
        firecrawl: { enabled: true, apiKey: 'fc-agent' },
      },
    });

    const effective = store.getEffectiveSettings('agent-a');

    expect(effective.providers.tavily.enabled).toBe(false);
    expect(effective.providers.firecrawl.apiKey).toBe('fc-agent');
  });

  test('deletes orphaned agent settings', () => {
    store.saveAgentSettings('agent-a', {
      mode: AgentExternalResearchMode.Disabled,
      providers: {
        tavily: { enabled: false, apiKey: '' },
        firecrawl: { enabled: false, apiKey: '' },
      },
    });

    expect(store.deleteAgentSettings('agent-a')).toBe(1);
    expect(store.getAgentSettings('agent-a').mode).toBe(AgentExternalResearchMode.Inherit);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- src/main/agentExternalResearchStore.test.ts
```

Expected: fail because `AgentExternalResearchStore` does not exist.

- [ ] **Step 3: Implement the store**

Create `src/main/agentExternalResearchStore.ts` with a focused table:

```ts
import Database from 'better-sqlite3';

import {
  AgentExternalResearchMode,
  ExternalResearchSettingsScope,
  buildDefaultExternalResearchConfig,
  getEffectiveExternalResearchConfig,
  maskExternalResearchConfig,
  normalizeExternalResearchConfig,
  type ExternalResearchConfig,
  type MaskedExternalResearchConfig,
} from '../shared/agent/externalResearch';

type ExternalResearchRow = {
  agent_id: string;
  config_json: string;
  created_at: number;
  updated_at: number;
};

export class AgentExternalResearchStore {
  constructor(private readonly db: Database.Database) {
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_external_research_settings (
        agent_id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  getAppDefaults(): ExternalResearchConfig {
    return this.getRawSettings(ExternalResearchSettingsScope.AppDefault)
      ?? buildDefaultExternalResearchConfig(AgentExternalResearchMode.Override);
  }

  getMaskedAppDefaults(): MaskedExternalResearchConfig {
    return maskExternalResearchConfig(this.getAppDefaults());
  }

  saveAppDefaults(config: ExternalResearchConfig): ExternalResearchConfig {
    return this.saveRawSettings(ExternalResearchSettingsScope.AppDefault, {
      ...normalizeExternalResearchConfig(config),
      mode: AgentExternalResearchMode.Override,
    });
  }

  getAgentSettings(agentId: string): ExternalResearchConfig {
    return this.getRawSettings(agentId) ?? buildDefaultExternalResearchConfig(AgentExternalResearchMode.Inherit);
  }

  getMaskedAgentSettings(agentId: string): MaskedExternalResearchConfig {
    return maskExternalResearchConfig(this.getAgentSettings(agentId));
  }

  saveAgentSettings(agentId: string, config: ExternalResearchConfig): ExternalResearchConfig {
    return this.saveRawSettings(agentId, normalizeExternalResearchConfig(config));
  }

  getEffectiveSettings(agentId: string): ExternalResearchConfig {
    return getEffectiveExternalResearchConfig(this.getAgentSettings(agentId), this.getAppDefaults());
  }

  getMaskedEffectiveSettings(agentId: string): MaskedExternalResearchConfig {
    return maskExternalResearchConfig(this.getEffectiveSettings(agentId));
  }

  deleteAgentSettings(agentId: string): number {
    const result = this.db
      .prepare('DELETE FROM agent_external_research_settings WHERE agent_id = ?')
      .run(agentId);
    return result.changes;
  }

  private getRawSettings(agentId: string): ExternalResearchConfig | null {
    const row = this.db
      .prepare('SELECT * FROM agent_external_research_settings WHERE agent_id = ?')
      .get(agentId) as ExternalResearchRow | undefined;
    if (!row) return null;
    try {
      return normalizeExternalResearchConfig(JSON.parse(row.config_json) as unknown);
    } catch {
      return buildDefaultExternalResearchConfig(
        agentId === ExternalResearchSettingsScope.AppDefault
          ? AgentExternalResearchMode.Override
          : AgentExternalResearchMode.Inherit,
      );
    }
  }

  private saveRawSettings(agentId: string, config: ExternalResearchConfig): ExternalResearchConfig {
    const normalized = normalizeExternalResearchConfig(config);
    const now = Date.now();
    this.db
      .prepare(`
        INSERT INTO agent_external_research_settings (agent_id, config_json, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(agent_id) DO UPDATE SET
          config_json = excluded.config_json,
          updated_at = excluded.updated_at
      `)
      .run(agentId, JSON.stringify(normalized), now, now);
    return normalized;
  }
}
```

- [ ] **Step 4: Run the store tests**

Run:

```bash
npm test -- src/main/agentExternalResearchStore.test.ts
```

Expected: pass.

---

### Task 3: Provider Service And Connection Tests

**Files:**

- Create: `src/main/agentExternalResearchService.ts`
- Create: `src/main/agentExternalResearchService.test.ts`

- [ ] **Step 1: Write fetch-mocked tests**

Create `src/main/agentExternalResearchService.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { AgentExternalResearchMode, ExternalResearchProviderId } from '../shared/agent/externalResearch';
import { AgentExternalResearchService } from './agentExternalResearchService';

const store = {
  getEffectiveSettings: vi.fn(),
  getMaskedAgentSettings: vi.fn(),
  getMaskedAppDefaults: vi.fn(),
  saveAgentSettings: vi.fn(),
  saveAppDefaults: vi.fn(),
};

beforeEach(() => {
  vi.restoreAllMocks();
  store.getEffectiveSettings.mockReset();
});

describe('AgentExternalResearchService', () => {
  test('tests Tavily with a search request and bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ results: [{ title: 'A', url: 'https://example.com', content: 'x' }] }),
    });
    const service = new AgentExternalResearchService({ store, fetch: fetchMock });

    const result = await service.testProvider({
      providerId: ExternalResearchProviderId.Tavily,
      apiKey: 'tvly-test',
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tvly-test' }),
      }),
    );
  });

  test('tests Firecrawl with a v2 search request and bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, data: { web: [] } }),
    });
    const service = new AgentExternalResearchService({ store, fetch: fetchMock });

    const result = await service.testProvider({
      providerId: ExternalResearchProviderId.Firecrawl,
      apiKey: 'fc-test',
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v2/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer fc-test' }),
      }),
    );
  });

  test('redacts provider secrets from failed connection messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid tvly-secret',
    });
    const service = new AgentExternalResearchService({ store, fetch: fetchMock });

    const result = await service.testProvider({
      providerId: ExternalResearchProviderId.Tavily,
      apiKey: 'tvly-secret',
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('[redacted]');
    expect(result.message).not.toContain('tvly-secret');
  });

  test('returns configured providers for agent without exposing api keys', () => {
    store.getEffectiveSettings.mockReturnValue({
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: { enabled: true, apiKey: 'tvly-secret' },
        firecrawl: { enabled: false, apiKey: '' },
      },
    });
    const service = new AgentExternalResearchService({ store, fetch: vi.fn() });

    const summary = service.getAvailability('agent-a');

    expect(summary.providers.tavily.available).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('tvly-secret');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- src/main/agentExternalResearchService.test.ts
```

Expected: fail because the service does not exist.

- [ ] **Step 3: Implement provider client/service**

Create `src/main/agentExternalResearchService.ts`:

```ts
import {
  ExternalResearchProviderId,
  redactExternalResearchSecret,
  type ExternalResearchConfig,
  type ExternalResearchProviderId as ExternalResearchProviderIdValue,
  type MaskedExternalResearchConfig,
} from '../shared/agent/externalResearch';

interface StoreLike {
  getEffectiveSettings(agentId: string): ExternalResearchConfig;
  getMaskedAgentSettings(agentId: string): MaskedExternalResearchConfig;
  getMaskedAppDefaults(): MaskedExternalResearchConfig;
  saveAgentSettings(agentId: string, config: ExternalResearchConfig): ExternalResearchConfig;
  saveAppDefaults(config: ExternalResearchConfig): ExternalResearchConfig;
}

interface TestProviderInput {
  providerId: ExternalResearchProviderIdValue;
  apiKey: string;
}

interface TestProviderResult {
  ok: boolean;
  message: string;
}

interface AvailabilityProviderSummary {
  enabled: boolean;
  configured: boolean;
  available: boolean;
}

export interface ExternalResearchAvailability {
  providers: Record<ExternalResearchProviderIdValue, AvailabilityProviderSummary>;
}

type FetchLike = typeof fetch;

export class AgentExternalResearchService {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: { store: StoreLike; fetch?: FetchLike }) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  getMaskedAppDefaults(): MaskedExternalResearchConfig {
    return this.options.store.getMaskedAppDefaults();
  }

  getMaskedAgentSettings(agentId: string): MaskedExternalResearchConfig {
    return this.options.store.getMaskedAgentSettings(agentId);
  }

  saveAppDefaults(config: ExternalResearchConfig): MaskedExternalResearchConfig {
    this.options.store.saveAppDefaults(config);
    return this.getMaskedAppDefaults();
  }

  saveAgentSettings(agentId: string, config: ExternalResearchConfig): MaskedExternalResearchConfig {
    this.options.store.saveAgentSettings(agentId, config);
    return this.getMaskedAgentSettings(agentId);
  }

  getEffectiveSettings(agentId: string): ExternalResearchConfig {
    return this.options.store.getEffectiveSettings(agentId);
  }

  getAvailability(agentId: string): ExternalResearchAvailability {
    const effective = this.getEffectiveSettings(agentId);
    return {
      providers: {
        tavily: this.toProviderAvailability(effective.providers.tavily),
        firecrawl: this.toProviderAvailability(effective.providers.firecrawl),
      },
    };
  }

  async testProvider(input: TestProviderInput): Promise<TestProviderResult> {
    const apiKey = input.apiKey.trim();
    if (!apiKey) {
      return { ok: false, message: 'API key is empty.' };
    }

    try {
      if (input.providerId === ExternalResearchProviderId.Tavily) {
        await this.postJson('https://api.tavily.com/search', apiKey, {
          query: 'LobsterAI connection test',
          search_depth: 'basic',
          max_results: 1,
          include_answer: false,
        });
      } else {
        await this.postJson('https://api.firecrawl.dev/v2/search', apiKey, {
          query: 'LobsterAI connection test',
          limit: 1,
          sources: ['web'],
          timeout: 30_000,
        });
      }
      return { ok: true, message: 'Connection successful.' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: redactExternalResearchSecret(message, [apiKey]) };
    }
  }

  async tavilySearch(agentId: string, query: string, maxResults = 5): Promise<unknown> {
    const config = this.getEffectiveSettings(agentId).providers.tavily;
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

  async tavilyExtract(agentId: string, urls: string[], query?: string): Promise<unknown> {
    const config = this.getEffectiveSettings(agentId).providers.tavily;
    this.assertProviderReady(ExternalResearchProviderId.Tavily, config.enabled, config.apiKey);
    return this.postJson('https://api.tavily.com/extract', config.apiKey, {
      urls,
      ...(query ? { query, chunks_per_source: 3 } : {}),
      extract_depth: 'basic',
    });
  }

  async firecrawlSearch(agentId: string, query: string, limit = 5): Promise<unknown> {
    const config = this.getEffectiveSettings(agentId).providers.firecrawl;
    this.assertProviderReady(ExternalResearchProviderId.Firecrawl, config.enabled, config.apiKey);
    return this.postJson('https://api.firecrawl.dev/v2/search', config.apiKey, {
      query,
      limit,
      sources: ['web'],
      country: 'CN',
      timeout: 60_000,
    });
  }

  async firecrawlScrape(agentId: string, url: string): Promise<unknown> {
    const config = this.getEffectiveSettings(agentId).providers.firecrawl;
    this.assertProviderReady(ExternalResearchProviderId.Firecrawl, config.enabled, config.apiKey);
    return this.postJson('https://api.firecrawl.dev/v2/scrape', config.apiKey, {
      url,
      formats: ['markdown'],
      onlyMainContent: true,
      timeout: 60_000,
    });
  }

  private toProviderAvailability(provider: { enabled: boolean; apiKey: string }): AvailabilityProviderSummary {
    const configured = provider.apiKey.trim().length > 0;
    return { enabled: provider.enabled, configured, available: provider.enabled && configured };
  }

  private assertProviderReady(providerId: ExternalResearchProviderIdValue, enabled: boolean, apiKey: string): void {
    if (!enabled || !apiKey.trim()) {
      throw new Error(`${providerId} is not configured. Open the agent external research settings to enable it.`);
    }
  }

  private async postJson(url: string, apiKey: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${url} HTTP ${response.status}: ${text.trim() || response.statusText}`);
    }
    return text.trim() ? JSON.parse(text) as unknown : {};
  }
}
```

- [ ] **Step 4: Run the service tests**

Run:

```bash
npm test -- src/main/agentExternalResearchService.test.ts
```

Expected: pass.

---

### Task 4: IPC And Preload Surface

**Files:**

- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/types/agent.ts`
- Modify: `src/renderer/services/agent.ts`
- Test: `src/renderer/services/agent.test.ts`

- [ ] **Step 1: Add renderer service tests**

Extend `src/renderer/services/agent.test.ts` with:

```ts
test('agentService saves external research settings through preload API', async () => {
  const saveExternalResearchSettings = vi.fn().mockResolvedValue({
    mode: 'override',
    providers: {
      tavily: { enabled: true, hasApiKey: true, apiKeyPreview: 'tvly...test' },
      firecrawl: { enabled: false, hasApiKey: false, apiKeyPreview: '' },
    },
  });
  window.electron = {
    ...window.electron,
    agents: {
      ...window.electron?.agents,
      saveExternalResearchSettings,
    },
  } as typeof window.electron;

  const result = await agentService.saveExternalResearchSettings('agent-1', {
    mode: 'override',
    providers: {
      tavily: { enabled: true, apiKey: 'tvly-test' },
      firecrawl: { enabled: false, apiKey: '' },
    },
  });

  expect(result?.providers.tavily.hasApiKey).toBe(true);
  expect(saveExternalResearchSettings).toHaveBeenCalledWith('agent-1', expect.objectContaining({ mode: 'override' }));
});
```

- [ ] **Step 2: Run the renderer service test to verify it fails**

Run:

```bash
npm test -- src/renderer/services/agent.test.ts
```

Expected: fail because `saveExternalResearchSettings` is not implemented.

- [ ] **Step 3: Register main-process IPC handlers**

In `src/main/main.ts`, add lazy store/service creation near existing `getIndustryPackStore`:

```ts
let agentExternalResearchStore: AgentExternalResearchStore | null = null;
let agentExternalResearchService: AgentExternalResearchService | null = null;

const getAgentExternalResearchStore = (): AgentExternalResearchStore => {
  if (!agentExternalResearchStore) {
    agentExternalResearchStore = new AgentExternalResearchStore(getStore().getDatabase());
  }
  return agentExternalResearchStore;
};

const getAgentExternalResearchService = (): AgentExternalResearchService => {
  if (!agentExternalResearchService) {
    agentExternalResearchService = new AgentExternalResearchService({
      store: getAgentExternalResearchStore(),
    });
  }
  return agentExternalResearchService;
};
```

Add IPC handlers beside existing agent handlers:

```ts
ipcMain.handle(AgentIpcChannel.GetExternalResearchSettings, async (_event, agentId?: string) => {
  try {
    const service = getAgentExternalResearchService();
    return {
      success: true,
      appDefaults: service.getMaskedAppDefaults(),
      agentSettings: agentId ? service.getMaskedAgentSettings(agentId) : null,
      availability: agentId ? service.getAvailability(agentId) : null,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to load external research settings' };
  }
});

ipcMain.handle(AgentIpcChannel.SaveExternalResearchSettings, async (_event, agentId: string | null, config: ExternalResearchConfig) => {
  try {
    const service = getAgentExternalResearchService();
    const settings = agentId
      ? service.saveAgentSettings(agentId, config)
      : service.saveAppDefaults(config);
    syncOpenClawConfig({ reason: 'agent-external-research-updated' }).catch(err => {
      console.error('[OpenClaw] config sync after external research update failed:', err);
    });
    return { success: true, settings };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to save external research settings' };
  }
});

ipcMain.handle(AgentIpcChannel.TestExternalResearchProvider, async (_event, input: { providerId: ExternalResearchProviderId; apiKey: string }) => {
  try {
    const result = await getAgentExternalResearchService().testProvider(input);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to test external research provider' };
  }
});
```

In `AgentIpcChannel.Delete` handler, after successful deletion:

```ts
getAgentExternalResearchStore().deleteAgentSettings(id);
```

- [ ] **Step 4: Add preload and renderer service methods**

In `src/main/preload.ts`, expose:

```ts
getExternalResearchSettings: async (agentId?: string) => {
  const result = await ipcRenderer.invoke(AgentIpcChannel.GetExternalResearchSettings, agentId);
  return result?.success ? result : null;
},
saveExternalResearchSettings: async (agentId: string | null, config: ExternalResearchConfig) => {
  const result = await ipcRenderer.invoke(AgentIpcChannel.SaveExternalResearchSettings, agentId, config);
  return result?.success ? result.settings : null;
},
testExternalResearchProvider: async (input: { providerId: ExternalResearchProviderId; apiKey: string }) => {
  const result = await ipcRenderer.invoke(AgentIpcChannel.TestExternalResearchProvider, input);
  return result?.success ? result.result : { ok: false, message: result?.error ?? 'Connection test failed.' };
},
```

In `src/renderer/services/agent.ts`, add matching methods:

```ts
async getExternalResearchSettings(agentId?: string) {
  return await window.electron?.agents?.getExternalResearchSettings(agentId) ?? null;
}

async saveExternalResearchSettings(agentId: string | null, config: ExternalResearchConfig) {
  return await window.electron?.agents?.saveExternalResearchSettings(agentId, config) ?? null;
}

async testExternalResearchProvider(input: { providerId: ExternalResearchProviderId; apiKey: string }) {
  return await window.electron?.agents?.testExternalResearchProvider(input) ?? { ok: false, message: 'Connection test failed.' };
}
```

- [ ] **Step 5: Run IPC-adjacent tests**

Run:

```bash
npm test -- src/renderer/services/agent.test.ts src/main/agentExternalResearchStore.test.ts src/main/agentExternalResearchService.test.ts
```

Expected: pass.

---

### Task 5: Agent UI Panel

**Files:**

- Create: `src/renderer/components/agent/AgentExternalResearchPanel.tsx`
- Create: `src/renderer/components/agent/AgentExternalResearchPanel.test.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Write UI tests**

Create `src/renderer/components/agent/AgentExternalResearchPanel.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { AgentExternalResearchMode } from '../../../shared/agent/externalResearch';
import AgentExternalResearchPanel from './AgentExternalResearchPanel';

const baseConfig = {
  mode: AgentExternalResearchMode.Inherit,
  providers: {
    tavily: { enabled: false, apiKey: '' },
    firecrawl: { enabled: false, apiKey: '' },
  },
};

describe('AgentExternalResearchPanel', () => {
  test('shows inherit mode and hides override key fields by default', () => {
    render(<AgentExternalResearchPanel value={baseConfig} appDefaults={null} onChange={vi.fn()} onTestProvider={vi.fn()} />);

    expect(screen.getByText('使用默认调研配置')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Tavily API Key')).not.toBeInTheDocument();
  });

  test('shows provider key fields in override mode', () => {
    render(
      <AgentExternalResearchPanel
        value={{ ...baseConfig, mode: AgentExternalResearchMode.Override }}
        appDefaults={null}
        onChange={vi.fn()}
        onTestProvider={vi.fn()}
      />,
    );

    expect(screen.getByPlaceholderText('Tavily API Key')).toHaveAttribute('type', 'password');
    expect(screen.getByPlaceholderText('Firecrawl API Key')).toHaveAttribute('type', 'password');
  });

  test('clear button removes an api key', () => {
    const onChange = vi.fn();
    render(
      <AgentExternalResearchPanel
        value={{
          mode: AgentExternalResearchMode.Override,
          providers: {
            tavily: { enabled: true, apiKey: 'tvly-test' },
            firecrawl: { enabled: false, apiKey: '' },
          },
        }}
        appDefaults={null}
        onChange={onChange}
        onTestProvider={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '清空 Tavily API Key' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      providers: expect.objectContaining({
        tavily: { enabled: true, apiKey: '' },
      }),
    }));
  });
});
```

- [ ] **Step 2: Run the UI test to verify it fails**

Run:

```bash
npm test -- src/renderer/components/agent/AgentExternalResearchPanel.test.tsx
```

Expected: fail because the component does not exist.

- [ ] **Step 3: Add i18n strings**

Add both Chinese and English keys in `src/renderer/services/i18n.ts`:

```ts
agentTabExternalResearch: '外部调研',
agentExternalResearchTitle: '外部调研能力',
agentExternalResearchHint: '用于行业、同行、关键词和客户痛点调研。API Key 只保存在本地，不会写入提示词。',
agentExternalResearchUseDefault: '使用默认调研配置',
agentExternalResearchOverride: '单独配置这个 Agent',
agentExternalResearchDisabled: '关闭外部调研',
agentExternalResearchTavily: 'Tavily',
agentExternalResearchFirecrawl: 'Firecrawl',
agentExternalResearchEnabled: '启用',
agentExternalResearchApiKeyPlaceholderTavily: 'Tavily API Key',
agentExternalResearchApiKeyPlaceholderFirecrawl: 'Firecrawl API Key',
agentExternalResearchTest: '测试连接',
agentExternalResearchClear: '清空 {provider} API Key',
agentExternalResearchShow: '显示 {provider} API Key',
agentExternalResearchHide: '隐藏 {provider} API Key',
agentExternalResearchTestSuccess: '连接成功',
agentExternalResearchTestFailed: '连接失败',
```

English equivalents:

```ts
agentTabExternalResearch: 'Research',
agentExternalResearchTitle: 'External research',
agentExternalResearchHint: 'Used for industry, competitor, keyword, and pain-point research. API keys stay local and are never written into prompts.',
agentExternalResearchUseDefault: 'Use default research settings',
agentExternalResearchOverride: 'Configure this agent separately',
agentExternalResearchDisabled: 'Turn off external research',
agentExternalResearchTavily: 'Tavily',
agentExternalResearchFirecrawl: 'Firecrawl',
agentExternalResearchEnabled: 'Enabled',
agentExternalResearchApiKeyPlaceholderTavily: 'Tavily API Key',
agentExternalResearchApiKeyPlaceholderFirecrawl: 'Firecrawl API Key',
agentExternalResearchTest: 'Test',
agentExternalResearchClear: 'Clear {provider} API Key',
agentExternalResearchShow: 'Show {provider} API Key',
agentExternalResearchHide: 'Hide {provider} API Key',
agentExternalResearchTestSuccess: 'Connection successful',
agentExternalResearchTestFailed: 'Connection failed',
```

- [ ] **Step 4: Implement `AgentExternalResearchPanel`**

Create a compact panel that uses existing button/input styles from agent modals:

```tsx
import React, { useState } from 'react';
import { EyeIcon, EyeSlashIcon, TrashIcon } from '@heroicons/react/24/outline';

import {
  AgentExternalResearchMode,
  ExternalResearchProviderId,
  type ExternalResearchConfig,
  type ExternalResearchProviderId as ExternalResearchProviderIdValue,
  type MaskedExternalResearchConfig,
} from '../../../shared/agent/externalResearch';
import { i18nService } from '../../services/i18n';

interface AgentExternalResearchPanelProps {
  value: ExternalResearchConfig;
  appDefaults: MaskedExternalResearchConfig | null;
  onChange: (value: ExternalResearchConfig) => void;
  onTestProvider: (providerId: ExternalResearchProviderIdValue, apiKey: string) => Promise<{ ok: boolean; message: string }>;
}

const providerLabels = {
  [ExternalResearchProviderId.Tavily]: 'agentExternalResearchTavily',
  [ExternalResearchProviderId.Firecrawl]: 'agentExternalResearchFirecrawl',
} as const;

const placeholders = {
  [ExternalResearchProviderId.Tavily]: 'agentExternalResearchApiKeyPlaceholderTavily',
  [ExternalResearchProviderId.Firecrawl]: 'agentExternalResearchApiKeyPlaceholderFirecrawl',
} as const;

const AgentExternalResearchPanel: React.FC<AgentExternalResearchPanelProps> = ({
  value,
  appDefaults,
  onChange,
  onTestProvider,
}) => {
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testMessage, setTestMessage] = useState<Record<string, string>>({});

  const updateMode = (mode: ExternalResearchConfig['mode']) => onChange({ ...value, mode });
  const updateProvider = (
    providerId: ExternalResearchProviderIdValue,
    patch: Partial<ExternalResearchConfig['providers'][ExternalResearchProviderIdValue]>,
  ) => onChange({
    ...value,
    providers: {
      ...value.providers,
      [providerId]: { ...value.providers[providerId], ...patch },
    },
  });

  const testProvider = async (providerId: ExternalResearchProviderIdValue) => {
    setTesting(prev => ({ ...prev, [providerId]: true }));
    const result = await onTestProvider(providerId, value.providers[providerId].apiKey);
    setTestMessage(prev => ({ ...prev, [providerId]: result.message }));
    setTesting(prev => ({ ...prev, [providerId]: false }));
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{i18nService.t('agentExternalResearchTitle')}</h3>
          <p className="mt-1 text-xs leading-5 text-secondary">{i18nService.t('agentExternalResearchHint')}</p>
        </div>

        <div className="grid gap-2">
          {[
            [AgentExternalResearchMode.Inherit, 'agentExternalResearchUseDefault'],
            [AgentExternalResearchMode.Override, 'agentExternalResearchOverride'],
            [AgentExternalResearchMode.Disabled, 'agentExternalResearchDisabled'],
          ].map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => updateMode(mode as ExternalResearchConfig['mode'])}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                value.mode === mode ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-secondary hover:bg-surface-raised'
              }`}
            >
              <span>{i18nService.t(label)}</span>
            </button>
          ))}
        </div>

        {value.mode === AgentExternalResearchMode.Inherit && appDefaults && (
          <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-secondary">
            Tavily: {appDefaults.providers.tavily.hasApiKey ? appDefaults.providers.tavily.apiKeyPreview : i18nService.t('agentIMNotConfigured')}
            <span className="mx-2">·</span>
            Firecrawl: {appDefaults.providers.firecrawl.hasApiKey ? appDefaults.providers.firecrawl.apiKeyPreview : i18nService.t('agentIMNotConfigured')}
          </div>
        )}

        {value.mode === AgentExternalResearchMode.Override && (
          <div className="space-y-3">
            {Object.values(ExternalResearchProviderId).map(providerId => {
              const label = i18nService.t(providerLabels[providerId]);
              const inputType = shown[providerId] ? 'text' : 'password';
              return (
                <div key={providerId} className="rounded-lg border border-border p-3">
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <input
                      type="checkbox"
                      checked={value.providers[providerId].enabled}
                      onChange={event => updateProvider(providerId, { enabled: event.target.checked })}
                    />
                  </label>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type={inputType}
                      value={value.providers[providerId].apiKey}
                      onChange={event => updateProvider(providerId, { apiKey: event.target.value })}
                      placeholder={i18nService.t(placeholders[providerId])}
                      className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      aria-label={(shown[providerId] ? i18nService.t('agentExternalResearchHide') : i18nService.t('agentExternalResearchShow')).replace('{provider}', label)}
                      onClick={() => setShown(prev => ({ ...prev, [providerId]: !prev[providerId] }))}
                      className="h-9 w-9 rounded-lg border border-border hover:bg-surface-raised"
                    >
                      {shown[providerId] ? <EyeSlashIcon className="mx-auto h-4 w-4" /> : <EyeIcon className="mx-auto h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      aria-label={i18nService.t('agentExternalResearchClear').replace('{provider}', label)}
                      onClick={() => updateProvider(providerId, { apiKey: '' })}
                      className="h-9 w-9 rounded-lg border border-border hover:bg-surface-raised"
                    >
                      <TrashIcon className="mx-auto h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={testing[providerId] || !value.providers[providerId].apiKey.trim()}
                      onClick={() => void testProvider(providerId)}
                      className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-surface-raised disabled:opacity-50"
                    >
                      {i18nService.t('agentExternalResearchTest')}
                    </button>
                  </div>
                  {testMessage[providerId] && (
                    <p className="mt-2 text-xs text-secondary">{testMessage[providerId]}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentExternalResearchPanel;
```

- [ ] **Step 5: Run UI tests**

Run:

```bash
npm test -- src/renderer/components/agent/AgentExternalResearchPanel.test.tsx
```

Expected: pass.

---

### Task 6: Wire UI Into Agent Create And Settings

**Files:**

- Modify: `src/renderer/components/agent/constants.ts`
- Modify: `src/renderer/components/agent/AgentCreateModal.tsx`
- Modify: `src/renderer/components/agent/AgentSettingsPanel.tsx`

- [ ] **Step 1: Add the external research tab constant**

Modify `src/renderer/components/agent/constants.ts`:

```ts
export const AgentDetailTab = {
  Prompt: 'prompt',
  Identity: 'identity',
  User: 'user',
  Skills: 'skills',
  ExternalResearch: 'externalResearch',
  Im: 'im',
} as const;
```

- [ ] **Step 2: Add create-modal state and save flow**

In `AgentCreateModal.tsx`:

```ts
const [externalResearchConfig, setExternalResearchConfig] = useState<ExternalResearchConfig>(
  buildDefaultExternalResearchConfig(AgentExternalResearchMode.Inherit),
);
const [externalResearchDefaults, setExternalResearchDefaults] = useState<MaskedExternalResearchConfig | null>(null);
```

When the modal opens, load defaults:

```ts
agentService.getExternalResearchSettings().then(settings => {
  setExternalResearchDefaults(settings?.appDefaults ?? null);
}).catch(() => setExternalResearchDefaults(null));
```

After `agentService.createAgent(...)` succeeds:

```ts
await agentService.saveExternalResearchSettings(agent.id, externalResearchConfig);
```

Add the tab:

```ts
{ key: AgentDetailTab.ExternalResearch, label: i18nService.t('agentTabExternalResearch') },
```

Add the tab content:

```tsx
{activeTab === AgentDetailTab.ExternalResearch && (
  <AgentExternalResearchPanel
    value={externalResearchConfig}
    appDefaults={externalResearchDefaults}
    onChange={setExternalResearchConfig}
    onTestProvider={(providerId, apiKey) => agentService.testExternalResearchProvider({ providerId, apiKey })}
  />
)}
```

- [ ] **Step 3: Add settings-panel load and save flow**

In `AgentSettingsPanel.tsx`, load saved settings with the selected agent:

```ts
const [externalResearchConfig, setExternalResearchConfig] = useState<ExternalResearchConfig>(
  buildDefaultExternalResearchConfig(AgentExternalResearchMode.Inherit),
);
const [externalResearchDefaults, setExternalResearchDefaults] = useState<MaskedExternalResearchConfig | null>(null);

const researchSettings = await agentService.getExternalResearchSettings(agentId);
setExternalResearchDefaults(researchSettings?.appDefaults ?? null);
setExternalResearchConfig(researchSettings?.agentSettings
  ? unmaskExternalResearchForEditing(researchSettings.agentSettings)
  : buildDefaultExternalResearchConfig(AgentExternalResearchMode.Inherit));
```

Because masked settings cannot recover raw keys, implement the edit contract in IPC so
`getExternalResearchSettings(agentId)` returns masked summaries plus an edit config where existing keys are represented
by an empty field and preserved on save unless the user types a replacement or clicks clear. Add this helper to
`src/shared/agent/externalResearch.ts`:

```ts
export const ExternalResearchSecretEditAction = {
  Preserve: 'preserve',
  Replace: 'replace',
  Clear: 'clear',
} as const;
```

Use that action model in the settings panel so existing secrets are not overwritten by masked values.

On save:

```ts
await agentService.saveExternalResearchSettings(agentId, externalResearchConfig);
```

Add the same tab and tab content as the create modal.

- [ ] **Step 4: Run focused renderer tests**

Run:

```bash
npm test -- src/renderer/components/agent/AgentExternalResearchPanel.test.tsx src/renderer/services/agent.test.ts
```

Expected: pass.

---

### Task 7: Secret-Preserving Edit Payloads

**Files:**

- Modify: `src/shared/agent/externalResearch.ts`
- Modify: `src/main/agentExternalResearchStore.ts`
- Modify: `src/main/agentExternalResearchStore.test.ts`
- Modify: `src/main/agentExternalResearchService.ts`

- [ ] **Step 1: Add tests for preserving and clearing existing keys**

Add to `src/main/agentExternalResearchStore.test.ts`:

```ts
test('preserves existing api key when edit payload asks to preserve', () => {
  store.saveAgentSettings('agent-a', {
    mode: AgentExternalResearchMode.Override,
    providers: {
      tavily: { enabled: true, apiKey: 'tvly-existing' },
      firecrawl: { enabled: false, apiKey: '' },
    },
  });

  store.saveAgentSettingsEdit('agent-a', {
    mode: AgentExternalResearchMode.Override,
    providers: {
      tavily: { enabled: true, apiKeyAction: 'preserve', apiKey: '' },
      firecrawl: { enabled: false, apiKeyAction: 'clear', apiKey: '' },
    },
  });

  expect(store.getAgentSettings('agent-a').providers.tavily.apiKey).toBe('tvly-existing');
});

test('clears existing api key when edit payload asks to clear', () => {
  store.saveAgentSettings('agent-a', {
    mode: AgentExternalResearchMode.Override,
    providers: {
      tavily: { enabled: true, apiKey: 'tvly-existing' },
      firecrawl: { enabled: false, apiKey: '' },
    },
  });

  store.saveAgentSettingsEdit('agent-a', {
    mode: AgentExternalResearchMode.Override,
    providers: {
      tavily: { enabled: true, apiKeyAction: 'clear', apiKey: '' },
      firecrawl: { enabled: false, apiKeyAction: 'clear', apiKey: '' },
    },
  });

  expect(store.getAgentSettings('agent-a').providers.tavily.apiKey).toBe('');
});
```

- [ ] **Step 2: Run the store test to verify it fails**

Run:

```bash
npm test -- src/main/agentExternalResearchStore.test.ts
```

Expected: fail because edit payload support is missing.

- [ ] **Step 3: Implement edit payload types and merge logic**

Add to `src/shared/agent/externalResearch.ts`:

```ts
export const ExternalResearchSecretEditAction = {
  Preserve: 'preserve',
  Replace: 'replace',
  Clear: 'clear',
} as const;

export type ExternalResearchSecretEditAction =
  typeof ExternalResearchSecretEditAction[keyof typeof ExternalResearchSecretEditAction];

export interface ExternalResearchProviderEditConfig {
  enabled: boolean;
  apiKeyAction: ExternalResearchSecretEditAction;
  apiKey: string;
}

export interface ExternalResearchEditConfig {
  mode: AgentExternalResearchMode;
  providers: Record<ExternalResearchProviderId, ExternalResearchProviderEditConfig>;
}

export const mergeExternalResearchEditConfig = (
  existing: ExternalResearchConfig,
  edit: ExternalResearchEditConfig,
): ExternalResearchConfig => ({
  mode: edit.mode,
  providers: {
    tavily: mergeProviderEdit(existing.providers.tavily, edit.providers.tavily),
    firecrawl: mergeProviderEdit(existing.providers.firecrawl, edit.providers.firecrawl),
  },
});

const mergeProviderEdit = (
  existing: ExternalResearchProviderConfig,
  edit: ExternalResearchProviderEditConfig,
): ExternalResearchProviderConfig => ({
  enabled: edit.enabled,
  apiKey:
    edit.apiKeyAction === ExternalResearchSecretEditAction.Preserve
      ? existing.apiKey
      : edit.apiKeyAction === ExternalResearchSecretEditAction.Clear
          ? ''
          : edit.apiKey.trim(),
});
```

Add store methods:

```ts
saveAgentSettingsEdit(agentId: string, edit: ExternalResearchEditConfig): ExternalResearchConfig {
  return this.saveAgentSettings(agentId, mergeExternalResearchEditConfig(this.getAgentSettings(agentId), edit));
}

saveAppDefaultsEdit(edit: ExternalResearchEditConfig): ExternalResearchConfig {
  return this.saveAppDefaults(mergeExternalResearchEditConfig(this.getAppDefaults(), edit));
}
```

Update the service and IPC to accept edit configs for UI saves.

- [ ] **Step 4: Run store and service tests**

Run:

```bash
npm test -- src/main/agentExternalResearchStore.test.ts src/main/agentExternalResearchService.test.ts
```

Expected: pass.

---

### Task 8: OpenClaw Bridge Context And Research Tools

**Files:**

- Modify: `openclaw-extensions/lobster-industry-positioning/index.ts`
- Modify: `src/main/libs/mcpBridgeServer.ts`
- Modify: `src/main/mcp/mcpRuntime.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/libs/openclawExtensionManifests.test.ts`

- [ ] **Step 1: Add manifest/tool tests**

Extend `src/main/libs/openclawExtensionManifests.test.ts` to assert:

```ts
expect(source).toContain('lobsterai_external_research_search');
expect(source).toContain('lobsterai_external_research_extract');
expect(source).toContain('sessionKey');
expect(source).not.toContain('TAVILY_API_KEY');
expect(source).not.toContain('FIRECRAWL_API_KEY');
```

- [ ] **Step 2: Run the manifest test to verify it fails**

Run:

```bash
npm test -- src/main/libs/openclawExtensionManifests.test.ts
```

Expected: fail because the tools and session context are missing.

- [ ] **Step 3: Pass session context from plugin to bridge**

Update `openclaw-extensions/lobster-industry-positioning/index.ts` request context:

```ts
context: {
  toolCallId: id,
  sessionKey: typeof api.session?.key === 'string' ? api.session.key : '',
}
```

If the OpenClaw plugin SDK exposes session key on a different field, inspect the local SDK typings and use the existing
media extension pattern. The final JSON sent to the bridge must contain `context.sessionKey`.

Update `IndustryPositioningToolRequest` in `src/main/libs/mcpBridgeServer.ts`:

```ts
context?: {
  toolCallId?: string;
  sessionKey?: string;
};
```

Log only a prefix:

```ts
log('INFO', `Industry positioning request received for tool="${request.tool}" toolCallId="${request.context?.toolCallId ?? ''}" sessionKey="${request.context?.sessionKey?.slice(0, 30) ?? ''}…"`);
```

- [ ] **Step 4: Add research tools to the plugin**

In `openclaw-extensions/lobster-industry-positioning/index.ts`, add:

```ts
const SearchResearchSchema = Type.Object({
  query: Type.String({ description: 'Search query for keyword, industry, competitor, or content research.' }),
  maxResults: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
  provider: Type.Optional(Type.Union([
    Type.Literal('auto'),
    Type.Literal('tavily'),
    Type.Literal('firecrawl'),
  ])),
});

const ExtractResearchSchema = Type.Object({
  urls: Type.Array(Type.String(), { minItems: 1, maxItems: 10 }),
  query: Type.Optional(Type.String({ description: 'Optional extraction focus.' })),
  provider: Type.Optional(Type.Union([
    Type.Literal('auto'),
    Type.Literal('tavily'),
    Type.Literal('firecrawl'),
  ])),
});
```

Register:

```ts
api.registerTool({
  name: 'lobsterai_external_research_search',
  label: 'External Research Search',
  description: 'Search external sources for industry, competitor, keyword, and customer pain-point research. API keys are resolved by LobsterAI settings.',
  parameters: SearchResearchSchema,
  async execute(id, args) {
    return await callBridge(config, {
      tool: 'lobsterai_external_research_search',
      args,
      context: { toolCallId: id, sessionKey: getSessionKey(api) },
    });
  },
});

api.registerTool({
  name: 'lobsterai_external_research_extract',
  label: 'External Research Extract',
  description: 'Extract clean content from URLs selected during external research. API keys are resolved by LobsterAI settings.',
  parameters: ExtractResearchSchema,
  async execute(id, args) {
    return await callBridge(config, {
      tool: 'lobsterai_external_research_extract',
      args,
      context: { toolCallId: id, sessionKey: getSessionKey(api) },
    });
  },
});
```

- [ ] **Step 5: Handle research tools in main**

In `src/main/main.ts`, reuse `parseManagedSessionKey` to resolve `agentId`:

```ts
const resolveAgentIdFromIndustryToolRequest = (request: IndustryPositioningToolRequest): string => {
  const sessionKey = request.context?.sessionKey ?? '';
  return parseManagedSessionKey(sessionKey)?.agentId ?? AgentId.Main;
};
```

Add handlers:

```ts
if (request.tool === 'lobsterai_external_research_search') {
  const agentId = resolveAgentIdFromIndustryToolRequest(request);
  const query = typeof request.args.query === 'string' ? request.args.query.trim() : '';
  if (!query) {
    return { content: [{ type: 'text', text: 'Missing search query.' }], isError: true };
  }
  const maxResults = typeof request.args.maxResults === 'number' ? Math.min(10, Math.max(1, Math.floor(request.args.maxResults))) : 5;
  const provider = typeof request.args.provider === 'string' ? request.args.provider : 'auto';
  const research = await runExternalResearchSearch({ agentId, query, maxResults, provider });
  return { content: [{ type: 'text', text: JSON.stringify(research, null, 2) }], details: { agentId, provider: research.provider } };
}

if (request.tool === 'lobsterai_external_research_extract') {
  const agentId = resolveAgentIdFromIndustryToolRequest(request);
  const urls = Array.isArray(request.args.urls) ? request.args.urls.filter((url): url is string => typeof url === 'string') : [];
  const provider = typeof request.args.provider === 'string' ? request.args.provider : 'auto';
  const query = typeof request.args.query === 'string' ? request.args.query : undefined;
  const research = await runExternalResearchExtract({ agentId, urls, query, provider });
  return { content: [{ type: 'text', text: JSON.stringify(research, null, 2) }], details: { agentId, provider: research.provider } };
}
```

Implement `runExternalResearchSearch` and `runExternalResearchExtract` as small helpers near the handler. Provider
selection should prefer Tavily for search and Firecrawl for extract when both are available, then fall back to the other
configured provider. Return a user-friendly error telling the user to open visual agent settings when no provider is
configured.

- [ ] **Step 6: Run OpenClaw extension tests**

Run:

```bash
npm test -- src/main/libs/openclawExtensionManifests.test.ts
```

Expected: pass.

---

### Task 9: Positioning Reports Become Agent-Aware

**Files:**

- Modify: `src/shared/industryPack/positioning.ts`
- Modify: `src/shared/industryPack/positioning.test.ts`
- Modify: `src/main/industryPack/industryPackStore.ts`
- Modify: `src/main/industryPack/industryPackStore.test.ts`
- Modify: `src/main/industryPack/positioningService.ts`
- Modify: `src/main/industryPack/positioningService.test.ts`
- Modify: `src/main/main.ts`

- [ ] **Step 1: Add failing tests**

Extend positioning tests to expect:

```ts
expect(report.agentId).toBe('marketing');
expect(report.providerAvailability).toEqual({ tavily: true, firecrawl: false });
expect(report.sourceCounts).toEqual({ searchResults: 5, extractedPages: 2 });
```

Extend latest-report tests:

```ts
const latestForMarketing = store.getLatestPositioningReport('heavy-packaging', 'marketing');
expect(latestForMarketing?.agentId).toBe('marketing');
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/shared/industryPack/positioning.test.ts src/main/industryPack/industryPackStore.test.ts src/main/industryPack/positioningService.test.ts
```

Expected: fail because report types and store methods are not agent-aware.

- [ ] **Step 3: Update positioning report model**

In `src/shared/industryPack/positioning.ts`, add:

```ts
agentId: string;
providerAvailability: {
  tavily: boolean;
  firecrawl: boolean;
};
sourceCounts: {
  searchResults: number;
  extractedPages: number;
};
```

Default missing `agentId` to `AgentId.Main`, and default counts/availability to false/zero in normalization.

- [ ] **Step 4: Update database store**

In `src/main/industryPack/industryPackStore.ts`, add columns through table initialization and migration-safe
`ALTER TABLE` checks:

```sql
agent_id TEXT NOT NULL DEFAULT 'main',
provider_availability TEXT NOT NULL DEFAULT '{}',
source_counts TEXT NOT NULL DEFAULT '{}'
```

Update `createPositioningReport` insert/select mapping, and overload
`getLatestPositioningReport(packId: string, agentId?: string)` so agent-specific lookups prefer the matching agent.

- [ ] **Step 5: Use agent context in tool saves and reads**

In `src/main/main.ts` industry positioning handler:

```ts
const agentId = resolveAgentIdFromIndustryToolRequest(request);
```

For save:

```ts
const report = service.saveReport({
  ...request.args,
  agentId,
  providerAvailability: getAgentExternalResearchService().getAvailability(agentId).providers,
  requestedBy: 'agent',
} as PositioningReportInput);
```

For latest:

```ts
const report = packId ? service.getLatestReport(packId, agentId) : null;
```

- [ ] **Step 6: Run positioning tests**

Run:

```bash
npm test -- src/shared/industryPack/positioning.test.ts src/main/industryPack/industryPackStore.test.ts src/main/industryPack/positioningService.test.ts
```

Expected: pass.

---

### Task 10: Marketing Agent Prompt Update

**Files:**

- Modify: `src/main/presetAgents.ts`
- Modify: `src/main/agentManager.test.ts`

- [ ] **Step 1: Add prompt assertions**

Extend `src/main/agentManager.test.ts` marketing agent test:

```ts
expect(marketingAgent?.systemPrompt).toContain('Tavily');
expect(marketingAgent?.systemPrompt).toContain('Firecrawl');
expect(marketingAgent?.systemPrompt).toContain('外部调研设置');
expect(marketingAgent?.systemPrompt).not.toContain('TAVILY_API_KEY');
expect(marketingAgent?.systemPrompt).not.toContain('FIRECRAWL_API_KEY');
expect(marketingAgent?.systemPrompt).toContain('lobsterai_external_research_search');
expect(marketingAgent?.systemPrompt).toContain('lobsterai_external_research_extract');
```

- [ ] **Step 2: Run the agent prompt test to verify it fails**

Run:

```bash
npm test -- src/main/agentManager.test.ts
```

Expected: fail until prompt is updated.

- [ ] **Step 3: Update the Chinese and English promotion-agent prompt**

In `src/main/presetAgents.ts`, add instruction text:

```text
当用户要求“分析主推方向”“产品定位”“行业/同行/关键词/客户痛点调研”时：
1. 先检查是否有可用外部调研能力。
2. 使用 lobsterai_external_research_search 查询百度关键词、1688 同行表达、行业需求和内容平台痛点。
3. 对重要 URL 使用 lobsterai_external_research_extract 提取正文或结构化信息。
4. API Key 由 LobsterAI 的可视化外部调研设置提供，不要要求用户配置环境变量，也不要在提示词或报告中写入密钥。
5. 调研后用 lobsterai_industry_positioning_save 保存定位报告。
```

English prompt should carry the same behavior.

- [ ] **Step 4: Run prompt test**

Run:

```bash
npm test -- src/main/agentManager.test.ts
```

Expected: pass.

---

### Task 11: OpenClaw Config Sync And Local Extension Build

**Files:**

- Modify: `src/main/libs/openclawConfigSync.ts`
- Modify: `src/main/libs/openclawConfigSync.runtime.test.ts`
- Modify: `openclaw-extensions/lobster-industry-positioning/openclaw.plugin.json` if new tool metadata must be declared.

- [ ] **Step 1: Add config sync assertions**

Extend `src/main/libs/openclawConfigSync.runtime.test.ts` existing industry positioning plugin test:

```ts
expect(plugin.config.callbackUrl).toContain('/industry-positioning-callback');
expect(JSON.stringify(plugin.config)).not.toContain('tvly-');
expect(JSON.stringify(plugin.config)).not.toContain('fc-');
```

- [ ] **Step 2: Run config sync test**

Run:

```bash
npm test -- src/main/libs/openclawConfigSync.runtime.test.ts
```

Expected: pass if plugin config already only carries callback URL and bridge secret; fail if any key is accidentally
synced.

- [ ] **Step 3: Build local extension**

Run:

```bash
npm run openclaw:extensions:local
npm run openclaw:precompile
```

Expected: local extensions sync and precompile with `0 errors`.

---

### Task 12: Focused Verification

**Files:**

- All touched TypeScript/TSX files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- src/shared/agent/externalResearch.test.ts src/main/agentExternalResearchStore.test.ts src/main/agentExternalResearchService.test.ts src/renderer/services/agent.test.ts src/renderer/components/agent/AgentExternalResearchPanel.test.tsx src/shared/industryPack/positioning.test.ts src/main/industryPack/industryPackStore.test.ts src/main/industryPack/positioningService.test.ts src/main/agentManager.test.ts src/main/libs/openclawExtensionManifests.test.ts src/main/libs/openclawConfigSync.runtime.test.ts
```

Expected: all selected test files pass.

- [ ] **Step 2: Run changed-file lint**

Run with the final touched TypeScript/TSX list:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/agent/externalResearch.ts src/shared/agent/externalResearch.test.ts src/shared/agent/constants.ts src/main/agentExternalResearchStore.ts src/main/agentExternalResearchStore.test.ts src/main/agentExternalResearchService.ts src/main/agentExternalResearchService.test.ts src/main/main.ts src/main/preload.ts src/renderer/types/agent.ts src/renderer/services/agent.ts src/renderer/services/agent.test.ts src/renderer/components/agent/constants.ts src/renderer/components/agent/AgentCreateModal.tsx src/renderer/components/agent/AgentSettingsPanel.tsx src/renderer/components/agent/AgentExternalResearchPanel.tsx src/renderer/components/agent/AgentExternalResearchPanel.test.tsx src/renderer/services/i18n.ts src/main/libs/mcpBridgeServer.ts src/main/mcp/mcpRuntime.ts src/shared/industryPack/positioning.ts src/shared/industryPack/positioning.test.ts src/main/industryPack/industryPackStore.ts src/main/industryPack/industryPackStore.test.ts src/main/industryPack/positioningService.ts src/main/industryPack/positioningService.test.ts src/main/presetAgents.ts src/main/agentManager.test.ts src/main/libs/openclawConfigSync.ts src/main/libs/openclawConfigSync.runtime.test.ts src/main/libs/openclawExtensionManifests.test.ts openclaw-extensions/lobster-industry-positioning/index.ts
```

Expected: no ESLint errors or warnings.

- [ ] **Step 3: Compile Electron main/preload**

Run:

```bash
npm run compile:electron
```

Expected: TypeScript compile succeeds. If sandbox blocks cache writes, rerun with approved escalation.

- [ ] **Step 4: Manual UI verification**

Run:

```bash
npm run electron:dev
```

Expected manual checks:

- New agent modal has an `外部调研` tab.
- Settings modal has an `外部调研` tab.
- Default/inherit mode hides raw key inputs.
- Override mode shows Tavily and Firecrawl fields as password inputs.
- Show/hide and clear buttons work.
- Test connection calls provider test and never displays raw key in error text.
- Saving and reopening preserves existing keys without exposing them.

- [ ] **Step 5: Manual agent workflow verification**

With valid Tavily or Firecrawl keys configured in UI, ask `推广agent`:

```text
根据行业、同行、关键词和客户痛点，分析主推方向
```

Expected:

- Agent uses `lobsterai_external_research_search`.
- Agent optionally uses `lobsterai_external_research_extract` for selected URLs.
- Agent saves the report with `lobsterai_industry_positioning_save`.
- The response never asks for environment variables.
- The saved report can be reused by a later content request.

---

## Self-Review

- Spec coverage: The plan covers visual all-agent settings, app defaults plus per-agent override, no environment
  variables, secret isolation, Tavily/Firecrawl API calls, OpenClaw research tools, agent-aware positioning reports,
  prompt updates, and verification.
- Scope control: First implementation uses Tavily Search/Extract and Firecrawl Search/Scrape. Firecrawl batch/crawl and
  Tavily crawl/map can be added later through the same service without blocking the first usable workflow.
- Secret handling: The plan keeps raw keys in main-process store/service only, masks renderer summaries, preserves
  existing keys through explicit edit actions, and redacts provider errors.
- Known implementation risk: The exact OpenClaw plugin SDK field for session key must be verified against local typings
  or the existing media extension during Task 8. The final bridge request must include `context.sessionKey`.
