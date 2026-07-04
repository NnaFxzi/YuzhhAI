# Domestic Content Platform Research Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-version domestic content-platform research source layer for `推广agent`.

**Architecture:** Reuse the existing external research settings pattern: shared typed config, SQLite-backed main-process store/service, typed IPC through preload, renderer service methods, and an Agent settings panel. Add an OpenClaw tool that lets the promotion agent read enabled domestic source capabilities before deciding whether to search automatically or ask for pasted links.

**Tech Stack:** TypeScript, Electron IPC, better-sqlite3, React, Vitest, OpenClaw local extension tools.

---

### Task 1: Shared Domestic Source Model

**Files:**
- Create: `src/shared/agent/domesticResearch.ts`
- Create: `src/shared/agent/domesticResearch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';

import {
  buildDefaultDomesticResearchConfig,
  DomesticResearchSourceId,
  DomesticResearchStatus,
  getDomesticResearchSourceStatuses,
  normalizeDomesticResearchConfig,
} from './domesticResearch';

describe('domestic research settings', () => {
  test('builds stable default source capabilities', () => {
    const config = buildDefaultDomesticResearchConfig();

    expect(config.sources[DomesticResearchSourceId.Douyin].enabled).toBe(true);
    expect(config.sources[DomesticResearchSourceId.Douyin].modes).toEqual(['url_import']);
    expect(config.sources[DomesticResearchSourceId.Bilibili].modes).toEqual(['search', 'url_import']);
  });

  test('normalizes unknown source data while preserving known toggles', () => {
    const config = normalizeDomesticResearchConfig({
      sources: {
        douyin: { enabled: false },
        bilibili: { enabled: true },
        unknown: { enabled: true },
      },
    });

    expect(config.sources.douyin.enabled).toBe(false);
    expect(config.sources.bilibili.enabled).toBe(true);
    expect(Object.keys(config.sources)).not.toContain('unknown');
  });

  test('returns user-facing status summaries', () => {
    const statuses = getDomesticResearchSourceStatuses(buildDefaultDomesticResearchConfig());

    expect(statuses.douyin.status).toBe(DomesticResearchStatus.LinkImportOnly);
    expect(statuses.bilibili.status).toBe(DomesticResearchStatus.Available);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/shared/agent/domesticResearch.test.ts`

Expected: FAIL because `domesticResearch.ts` does not exist.

- [ ] **Step 3: Implement shared model**

Create source ids for Xiaohongshu, Douyin, Kuaishou, WeChat Channels, Bilibili, and WeChat official accounts; source modes `search` and `url_import`; statuses `available`, `link_import_only`, `needs_login`, `limited`, and `unsupported`; default capabilities matching the design spec.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/shared/agent/domesticResearch.test.ts`

Expected: PASS.

### Task 2: Main Store And Service

**Files:**
- Create: `src/main/agentDomesticResearchStore.ts`
- Create: `src/main/agentDomesticResearchStore.test.ts`
- Create: `src/main/agentDomesticResearchService.ts`
- Create: `src/main/agentDomesticResearchService.test.ts`

- [ ] **Step 1: Write failing store/service tests**

Test that per-agent settings persist in SQLite, invalid JSON falls back to defaults, and service returns enabled source statuses.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- src/main/agentDomesticResearchStore.test.ts src/main/agentDomesticResearchService.test.ts`

Expected: FAIL because store/service files do not exist.

- [ ] **Step 3: Implement store/service**

Create `agent_domestic_research_settings` with `agent_id`, `config_json`, `created_at`, and `updated_at`. Service exposes `getSettings`, `saveSettings`, and `getStatusPayload`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- src/main/agentDomesticResearchStore.test.ts src/main/agentDomesticResearchService.test.ts`

Expected: PASS.

### Task 3: IPC And Renderer Service

**Files:**
- Modify: `src/shared/agent/constants.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Modify: `src/renderer/services/agent.ts`
- Modify: `src/renderer/services/agent.test.ts`
- Modify: `src/main/main.ts`

- [ ] **Step 1: Write failing renderer service test**

Test that `agentService.getDomesticResearchSettings` and `saveDomesticResearchSettings` call the preload APIs.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/renderer/services/agent.test.ts`

Expected: FAIL because the service methods do not exist.

- [ ] **Step 3: Implement IPC**

Add `AgentIpcChannel.GetDomesticResearchSettings` and `SaveDomesticResearchSettings`; expose them in preload and renderer types; wire main handlers to `AgentDomesticResearchService`.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- src/renderer/services/agent.test.ts`

Expected: PASS.

### Task 4: Agent Settings UI

**Files:**
- Create: `src/renderer/components/agent/AgentDomesticResearchSourcesPanel.tsx`
- Modify: `src/renderer/components/agent/AgentExternalResearchPanel.tsx`
- Modify: `src/renderer/components/agent/AgentSettingsPanel.tsx`
- Modify: `src/renderer/components/agent/AgentCreateModal.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Add panel component**

Render source cards with status, supported modes, limitation text, and an enable switch. Keep it read-only except for source enable toggles.

- [ ] **Step 2: Load and save settings in existing Agent forms**

Load domestic source settings with external research settings. Save only when the domestic source config changed.

- [ ] **Step 3: Add localized strings**

Add zh/en strings for `调研数据源`, source labels, mode labels, and statuses.

### Task 5: Agent Tool Visibility

**Files:**
- Modify: `openclaw-extensions/lobster-industry-positioning/index.ts`
- Modify: `openclaw-extensions/lobster-industry-positioning/openclaw.plugin.json`
- Modify: `src/main/main.ts`
- Modify: `src/main/libs/openclawExtensionManifests.test.ts`

- [ ] **Step 1: Add failing manifest test**

Assert the local extension declares `lobsterai_domestic_research_sources_get`.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/main/libs/openclawExtensionManifests.test.ts`

Expected: FAIL because the tool is not declared.

- [ ] **Step 3: Register tool and main handler**

The tool returns enabled platform statuses, supported modes, and first-version limitations for the current agent.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- src/main/libs/openclawExtensionManifests.test.ts`

Expected: PASS.

### Task 6: Verification

**Files:**
- All touched TypeScript and TSX files.

- [ ] **Step 1: Run focused tests**

Run: `npm test -- src/shared/agent/domesticResearch.test.ts src/main/agentDomesticResearchStore.test.ts src/main/agentDomesticResearchService.test.ts src/renderer/services/agent.test.ts src/main/libs/openclawExtensionManifests.test.ts`

- [ ] **Step 2: Run changed-file lint**

Run: `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 <touched ts/tsx files>`

- [ ] **Step 3: Run Electron compile**

Run: `npm run compile:electron`

- [ ] **Step 4: Run production build**

Run: `npm run build`

