# System Health Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the verified system-health blockers found on 2026-07-08 while keeping unrelated lint debt and runtime
investigations separate.

**Architecture:** Fix deterministic code and patch defects at their ownership boundary first: LobsterAI config and tests
stay in `src/`, OpenClaw internal behavior stays as a version-scoped patch under `scripts/patches/v2026.6.1/`. Add
safety guards before running any command that can modify the sibling `../openclaw` repository. Treat log-only findings
without a localized root cause as diagnostic tasks with evidence gates before code changes.

**Tech Stack:** Electron, React, TypeScript, Vitest, ESLint, SQLite via `better-sqlite3`, OpenClaw runtime `v2026.6.1`.

## Global Constraints

- Node.js must remain `>=24.15.0 <25`.
- Do not revert existing uncommitted user changes.
- Do not commit until the user has tested and confirmed.
- Keep changes scoped; do not perform broad full-repo lint cleanup in this plan.
- Add or update tests as `.test.ts` files covered by `vitest.config.ts`.
- Run changed-file lint with `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 <files>`.
- Do not edit `vendor/openclaw-runtime/` generated output.
- Do not run destructive commands in `../openclaw` unless the user explicitly approves that specific action.

---

## Baseline Evidence

- `npm test` passed outside the sandbox: 234 test files, 2216 tests passed, 1 skipped.
- `npm run compile:electron` passed outside the sandbox.
- `npm run build` passed.
- Changed TypeScript files passed CI-equivalent ESLint.
- `npm run lint` currently fails with historical import/export sorting and React hooks warnings outside the changed-file
  gate.
- `main-2026-07-07.log` contained: 286 plugin skill symlink `EEXIST` warnings, 36 `dangerouslyAllowPrivateNetwork=true`
  security warnings, 46 OpenAI auth failures for memory sync, 26 `AGENTS.md` length truncations, 4 `EISDIR`
  directory-read failures, and 102 gateway liveness/reconnect lines.

## File Structure

- Modify `scripts/patches/v2026.6.1/openclaw-plugin-skill-symlink-idempotent.patch`: fix the missing `target`
  declaration in the OpenClaw regression test.
- Modify `scripts/apply-openclaw-patches.cjs`: stop resetting or cleaning `../openclaw` by default; require explicit
  opt-in for destructive reset behavior.
- Create `scripts/openclaw-patch-safety.cjs`: pure safety helpers used by the patch script and tests.
- Create `tests/openclawPatchSafety.test.ts`: unit coverage for dirty-worktree safety behavior.
- Create `src/main/libs/openclawPatches/pluginSkillSymlinkIdempotent.test.ts`: static coverage that the new patch
  contains the required implementation and compile-safe test snippets.
- Modify `src/shared/browserWebAccess/constants.ts`: keep strict browser network mode as the default.
- Modify `src/shared/browserWebAccess/constants.test.ts`: keep default strict-mode coverage.
- Modify `src/renderer/config.ts`: add a persisted browser web access migration version.
- Modify `src/renderer/services/config.ts`: migrate legacy persisted browser configs from the old implicit
  `proxy-compatible` default to `strict`, while preserving explicit opt-in after migration.
- Modify `src/renderer/services/config.test.ts`: cover browser config migration and post-migration opt-in.
- Modify `src/main/libs/openclawConfigSync.runtime.test.ts`: keep OpenClaw SSRF policy coverage.

## Task 1: Repair the OpenClaw Plugin Skill Patch

**Files:**

- Modify: `scripts/patches/v2026.6.1/openclaw-plugin-skill-symlink-idempotent.patch`
- Create: `src/main/libs/openclawPatches/pluginSkillSymlinkIdempotent.test.ts`
- Modify: `scripts/apply-openclaw-patches.cjs`

**Interfaces:**

- Consumes: `expectPatchContains()` and `readCurrentOpenClawPatch()` from
  `src/main/libs/openclawPatches/patchTestUtils.ts`.
- Produces: a patch file whose OpenClaw test can compile because `target` is declared before
  `fsSync.symlinkSync(target, linkPath, "dir")`.

- [ ] **Step 1: Add the static patch regression test**

Create `src/main/libs/openclawPatches/pluginSkillSymlinkIdempotent.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { expectPatchContains, readCurrentOpenClawPatch } from './patchTestUtils';

const PATCH_FILE = 'openclaw-plugin-skill-symlink-idempotent.patch';

describe('openclaw-plugin-skill-symlink-idempotent.patch', () => {
  test('keeps the idempotent symlink behavior in the current OpenClaw patch set', () => {
    expectPatchContains(PATCH_FILE, [
      'code === "EEXIST"',
      'fs.realpathSync(linkPath) === fs.realpathSync(target)',
      'activeLinkPaths.add(linkPath)',
      'managedTargets.has(entry.name) && activeLinkPaths.has(path.join(pluginSkillsDir, entry.name))',
      'isGeneratedPluginSkillEntry(existingEntry)',
      'logger: log',
      'keeps existing generated plugin skill symlinks that already point at the target',
      'failed to create plugin skill symlink',
      'testing.logger',
    ]);
  });

  test('declares the test target before creating the pre-existing symlink', () => {
    const patch = readCurrentOpenClawPatch(PATCH_FILE);
    const targetDeclaration = 'const target = path.join(skillParent, "browser-automation");';
    const symlinkCall = 'fsSync.symlinkSync(target, linkPath, "dir");';

    expect(patch).toContain(targetDeclaration);
    expect(patch).toContain(symlinkCall);
    expect(patch.indexOf(targetDeclaration)).toBeLessThan(patch.indexOf(symlinkCall));
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails first**

Run:

```bash
npm test -- pluginSkillSymlinkIdempotent
```

Expected before the patch fix: the second test fails because
`const target = path.join(skillParent, "browser-automation");` is missing.

- [ ] **Step 3: Fix the OpenClaw patch test snippet**

In `scripts/patches/v2026.6.1/openclaw-plugin-skill-symlink-idempotent.patch`, change the first added test body from:

```diff
+      await writeSkillDir(skillParent, "browser-automation");
+      const linkPath = path.join(managedDir, "browser-automation");
+      fsSync.symlinkSync(target, linkPath, "dir");
```

to:

```diff
+      await writeSkillDir(skillParent, "browser-automation");
+      const target = path.join(skillParent, "browser-automation");
+      const linkPath = path.join(managedDir, "browser-automation");
+      fsSync.symlinkSync(target, linkPath, "dir");
```

- [ ] **Step 4: Strengthen LobsterAI-side patch validation**

In `scripts/apply-openclaw-patches.cjs`, add this snippet to the `src/skills/loading/plugin-skills.test.ts` validator
list for `openclaw-plugin-skill-symlink-idempotent.patch`:

```js
'const target = path.join(skillParent, "browser-automation");',
```

The final list for that test file must contain:

```js
snippets: [
  'keeps existing generated plugin skill symlinks that already point at the target',
  'const target = path.join(skillParent, "browser-automation");',
  'failed to create plugin skill symlink',
  'testing.logger',
],
```

- [ ] **Step 5: Run focused verification**

Run:

```bash
npm test -- pluginSkillSymlinkIdempotent
node --check scripts/apply-openclaw-patches.cjs
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/libs/openclawPatches/pluginSkillSymlinkIdempotent.test.ts
```

Expected: the Vitest file passes, the Node syntax check exits 0, and ESLint exits 0.

## Task 2: Make OpenClaw Patch Application Safe by Default

**Files:**

- Create: `scripts/openclaw-patch-safety.cjs`
- Modify: `scripts/apply-openclaw-patches.cjs`
- Create: `tests/openclawPatchSafety.test.ts`

**Interfaces:**

- Consumes: `git status --porcelain` output for `../openclaw`.
- Produces: normal patch application refuses to reset, checkout, or clean a dirty OpenClaw source tree unless
  `LOBSTERAI_OPENCLAW_PATCH_RESET=1` is set.

- [ ] **Step 1: Add the safety helper module**

Create `scripts/openclaw-patch-safety.cjs`:

```js
'use strict';

function isOpenClawPatchResetAllowed(env) {
  return env.LOBSTERAI_OPENCLAW_PATCH_RESET === '1';
}

function normalizeGitStatus(status) {
  return String(status ?? '').trim();
}

function formatDirtyOpenClawSourceMessage(openclawSrc, status) {
  const normalized = normalizeGitStatus(status);
  return [
    `[apply-openclaw-patches] Refusing to reset dirty OpenClaw source: ${openclawSrc}`,
    '[apply-openclaw-patches] Preserve or clean these changes first, then rerun.',
    '[apply-openclaw-patches] To intentionally discard sibling OpenClaw changes, rerun with LOBSTERAI_OPENCLAW_PATCH_RESET=1.',
    normalized ? `[apply-openclaw-patches] Dirty status:\n${normalized}` : '',
  ].filter(Boolean).join('\n');
}

function assertOpenClawSourceResetAllowed(params) {
  const status = normalizeGitStatus(params.status);
  if (!status) {
    return;
  }
  if (params.allowReset) {
    return;
  }
  throw new Error(formatDirtyOpenClawSourceMessage(params.openclawSrc, status));
}

module.exports = {
  assertOpenClawSourceResetAllowed,
  formatDirtyOpenClawSourceMessage,
  isOpenClawPatchResetAllowed,
  normalizeGitStatus,
};
```

- [ ] **Step 2: Add unit tests for the safety helper**

Create `tests/openclawPatchSafety.test.ts`:

```ts
import { createRequire } from 'node:module';

import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const safety = require('../scripts/openclaw-patch-safety.cjs') as {
  assertOpenClawSourceResetAllowed: (params: {
    openclawSrc: string;
    status: string;
    allowReset: boolean;
  }) => void;
  formatDirtyOpenClawSourceMessage: (openclawSrc: string, status: string) => string;
  isOpenClawPatchResetAllowed: (env: Record<string, string | undefined>) => boolean;
  normalizeGitStatus: (status: unknown) => string;
};

describe('openclaw patch safety helpers', () => {
  test('normalizes empty git status output', () => {
    expect(safety.normalizeGitStatus('\n')).toBe('');
    expect(safety.normalizeGitStatus(' M file.ts\n')).toBe('M file.ts');
  });

  test('blocks dirty OpenClaw resets by default', () => {
    expect(() =>
      safety.assertOpenClawSourceResetAllowed({
        openclawSrc: '/repo/openclaw',
        status: ' M src/file.ts\n?? scratch.txt\n',
        allowReset: false,
      }),
    ).toThrow('Refusing to reset dirty OpenClaw source: /repo/openclaw');
  });

  test('allows dirty OpenClaw reset only with explicit opt-in', () => {
    expect(() =>
      safety.assertOpenClawSourceResetAllowed({
        openclawSrc: '/repo/openclaw',
        status: ' M src/file.ts\n',
        allowReset: true,
      }),
    ).not.toThrow();
  });

  test('reads the destructive reset opt-in environment flag exactly', () => {
    expect(safety.isOpenClawPatchResetAllowed({ LOBSTERAI_OPENCLAW_PATCH_RESET: '1' })).toBe(true);
    expect(safety.isOpenClawPatchResetAllowed({ LOBSTERAI_OPENCLAW_PATCH_RESET: 'true' })).toBe(false);
    expect(safety.isOpenClawPatchResetAllowed({})).toBe(false);
  });
});
```

- [ ] **Step 3: Run the helper tests**

Run:

```bash
npm test -- openclawPatchSafety
```

Expected: the new helper tests pass.

- [ ] **Step 4: Wire the helper into `apply-openclaw-patches.cjs`**

Near the existing `require()` block in `scripts/apply-openclaw-patches.cjs`, add:

```js
const {
  assertOpenClawSourceResetAllowed,
  isOpenClawPatchResetAllowed,
} = require('./openclaw-patch-safety.cjs');
```

Replace the current reset block:

```js
// Reset openclaw source to a clean tag state before applying patches.
// This removes stale patches left by a different LobsterAI branch that may have
// applied different patches for the same openclaw version.
try {
  execFileSync('git', ['reset', 'HEAD', '.'], { cwd: openclawSrc, stdio: 'pipe' });
  execFileSync('git', ['checkout', '.'], { cwd: openclawSrc, stdio: 'pipe' });
  execFileSync('git', ['clean', '-fd'], { cwd: openclawSrc, stdio: 'pipe' });
  console.log('[apply-openclaw-patches] Reset openclaw source to clean state before patching.');
} catch (err) {
  console.warn(`[apply-openclaw-patches] Warning: failed to reset openclaw source: ${err.message}`);
}
```

with:

```js
// Do not discard sibling OpenClaw changes by default. Normal patch application
// may read ../openclaw, but destructive cleanup requires an explicit opt-in.
try {
  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd: openclawSrc,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const allowReset = isOpenClawPatchResetAllowed(process.env);
  assertOpenClawSourceResetAllowed({ openclawSrc, status, allowReset });

  if (allowReset && status.trim()) {
    execFileSync('git', ['reset', 'HEAD', '.'], { cwd: openclawSrc, stdio: 'pipe' });
    execFileSync('git', ['checkout', '.'], { cwd: openclawSrc, stdio: 'pipe' });
    execFileSync('git', ['clean', '-fd'], { cwd: openclawSrc, stdio: 'pipe' });
    console.log('[apply-openclaw-patches] Reset openclaw source to clean state before patching.');
  } else {
    console.log('[apply-openclaw-patches] OpenClaw source is clean; skipping destructive reset.');
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
```

- [ ] **Step 5: Run focused verification**

Run:

```bash
npm test -- openclawPatchSafety pluginSkillSymlinkIdempotent
node --check scripts/openclaw-patch-safety.cjs
node --check scripts/apply-openclaw-patches.cjs
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 tests/openclawPatchSafety.test.ts src/main/libs/openclawPatches/pluginSkillSymlinkIdempotent.test.ts
```

Expected: all commands exit 0.

## Task 3: Migrate Browser Network Defaults to Strict Safely

**Files:**

- Modify: `src/shared/browserWebAccess/constants.ts`
- Modify: `src/shared/browserWebAccess/constants.test.ts`
- Modify: `src/main/libs/openclawConfigSync.runtime.test.ts`
- Modify: `src/renderer/config.ts`
- Modify: `src/renderer/services/config.ts`
- Modify: `src/renderer/services/config.test.ts`

**Interfaces:**

- Consumes: `BrowserNetworkMode.Strict`, `BrowserNetworkMode.ProxyCompatible`, and `normalizeBrowserWebAccessConfig()`.
- Produces: new configs default to strict SSRF behavior; legacy persisted configs that only carry the old default are
  migrated to strict; users can still opt into `proxy-compatible` after migration.

- [ ] **Step 1: Confirm the existing default tests are present**

`src/shared/browserWebAccess/constants.test.ts` must contain:

```ts
test('defaults browser network access to strict mode', () => {
  const config = normalizeBrowserWebAccessConfig({});

  expect(config.networkMode).toBe(BrowserNetworkMode.Strict);
});
```

`src/main/libs/openclawConfigSync.runtime.test.ts` must contain:

```ts
test('defaults browser ssrf policy to private-network blocked', async () => {
  const { OpenClawConfigSync } = await import('./openclawConfigSync');

  const sync = new OpenClawConfigSync({
    engineManager: {
      getConfigPath: () => configPath,
      getGatewayToken: () => 'gateway-token',
      getStateDir: () => stateDir,
      getBaseDir: () => tmpDir,
    } as never,
    getCoworkConfig: () => ({
      workingDirectory: tmpDir,
      systemPrompt: '',
      executionMode: 'local',
      agentEngine: 'openclaw',
      memoryEnabled: false,
      memoryImplicitUpdateEnabled: false,
      memoryLlmJudgeEnabled: false,
      memoryGuardLevel: 'balanced',
      memoryUserMemoriesMaxItems: 100,
      skipMissedJobs: false,
    }),
    getBrowserWebAccessConfig: () => ({}),
    isEnterprise: () => false,
    getPopoInstances: () => [],
    getNeteaseBeeChanConfig: () => null,
    getWeixinConfig: () => null,
    getIMSettings: () => null,
    getSkillsList: () => [],
    getAgents: () => [],
  } as never);

  const result = sync.sync('browser-default-security');
  expect(result.ok).toBe(true);

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  expect(config.browser.ssrfPolicy).toMatchObject({
    dangerouslyAllowPrivateNetwork: false,
  });
});
```

- [ ] **Step 2: Add a persisted migration version to `AppConfig`**

In `src/renderer/config.ts`, add this property after `browserWebAccess`:

```ts
  browserWebAccessMigrationVersion?: number;
```

- [ ] **Step 3: Add browser migration imports**

In `src/renderer/services/config.ts`, replace:

```ts
import { normalizeBrowserWebAccessConfig } from '../../shared/browserWebAccess/constants';
```

with:

```ts
import {
  BrowserNetworkMode,
  type BrowserWebAccessConfig,
  normalizeBrowserWebAccessConfig,
} from '../../shared/browserWebAccess/constants';
```

- [ ] **Step 4: Add the migration helper**

In `src/renderer/services/config.ts`, after the `type ProviderModel = ...` line, add:

```ts
const BROWSER_WEB_ACCESS_MIGRATION_VERSION = 1;

const getBrowserWebAccessMigrationVersion = (config: Partial<AppConfig>): number => (
  typeof config.browserWebAccessMigrationVersion === 'number'
    ? config.browserWebAccessMigrationVersion
    : 0
);

const migrateBrowserWebAccessConfig = (config: Partial<AppConfig>): BrowserWebAccessConfig => {
  const normalized = normalizeBrowserWebAccessConfig(config.browserWebAccess);
  const migrationVersion = getBrowserWebAccessMigrationVersion(config);

  if (
    migrationVersion < BROWSER_WEB_ACCESS_MIGRATION_VERSION &&
    config.browserWebAccess?.networkMode === BrowserNetworkMode.ProxyCompatible
  ) {
    return {
      ...normalized,
      networkMode: BrowserNetworkMode.Strict,
    };
  }

  return normalized;
};
```

- [ ] **Step 5: Use the helper during hydration**

In `hydrateStoredConfig()`, replace:

```ts
    browserWebAccess: normalizeBrowserWebAccessConfig(storedConfig.browserWebAccess),
```

with:

```ts
    browserWebAccess: migrateBrowserWebAccessConfig(storedConfig),
    browserWebAccessMigrationVersion: BROWSER_WEB_ACCESS_MIGRATION_VERSION,
```

- [ ] **Step 6: Preserve post-migration explicit opt-in during updates**

In `updateConfig()`, after the `browserWebAccess: normalizeBrowserWebAccessConfig(...)` property, add:

```ts
      browserWebAccessMigrationVersion: BROWSER_WEB_ACCESS_MIGRATION_VERSION,
```

The resulting block must be:

```ts
      browserWebAccess: normalizeBrowserWebAccessConfig(
        newConfig.browserWebAccess ?? base.browserWebAccess,
      ),
      browserWebAccessMigrationVersion: BROWSER_WEB_ACCESS_MIGRATION_VERSION,
      notificationSettings: normalizeNotificationSettings(
        newConfig.notificationSettings ?? base.notificationSettings,
      ),
```

- [ ] **Step 7: Add config migration tests**

In `src/renderer/services/config.test.ts`, add this import:

```ts
import { BrowserNetworkMode } from '../../shared/browserWebAccess/constants';
```

Add this `describe` block after the shortcut migration tests:

```ts
describe('configService browser web access migrations', () => {
  test('migrates the legacy proxy-compatible browser default to strict mode', async () => {
    const storedConfig: AppConfig = {
      ...defaultConfig,
      browserWebAccessMigrationVersion: undefined,
      browserWebAccess: {
        ...defaultConfig.browserWebAccess,
        networkMode: BrowserNetworkMode.ProxyCompatible,
      },
    };
    const { configService, storeData, setItem } = await loadConfigServiceWithStoredConfig(storedConfig);

    await configService.init();

    const savedConfig = storeData[CONFIG_KEYS.APP_CONFIG] as AppConfig;
    expect(configService.getConfig().browserWebAccess.networkMode).toBe(BrowserNetworkMode.Strict);
    expect(savedConfig.browserWebAccess.networkMode).toBe(BrowserNetworkMode.Strict);
    expect(savedConfig.browserWebAccessMigrationVersion).toBe(1);
    expect(setItem).toHaveBeenCalledWith(CONFIG_KEYS.APP_CONFIG, expect.any(Object));
  });

  test('preserves an explicit proxy-compatible opt-in after browser migration is applied', async () => {
    const storedConfig: AppConfig = {
      ...defaultConfig,
      browserWebAccessMigrationVersion: 1,
      browserWebAccess: {
        ...defaultConfig.browserWebAccess,
        networkMode: BrowserNetworkMode.Strict,
      },
    };
    const { configService, storeData } = await loadConfigServiceWithStoredConfig(storedConfig);

    await configService.updateConfig({
      browserWebAccess: {
        ...defaultConfig.browserWebAccess,
        networkMode: BrowserNetworkMode.ProxyCompatible,
      },
    });

    const savedConfig = storeData[CONFIG_KEYS.APP_CONFIG] as AppConfig;
    expect(savedConfig.browserWebAccess.networkMode).toBe(BrowserNetworkMode.ProxyCompatible);
    expect(savedConfig.browserWebAccessMigrationVersion).toBe(1);
  });
});
```

- [ ] **Step 8: Run focused browser verification**

Run:

```bash
npm test -- browserWebAccess openclawConfigSync.runtime configService
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/browserWebAccess/constants.ts src/shared/browserWebAccess/constants.test.ts src/main/libs/openclawConfigSync.runtime.test.ts src/renderer/config.ts src/renderer/services/config.ts src/renderer/services/config.test.ts
```

Expected: all focused tests pass and changed-file lint exits 0.

## Task 4: Verify the Scoped Knowledge Chunk Fix Still Holds

**Files:**

- Verify: `src/main/libs/contentKnowledgeVectorStore.ts`
- Verify: `src/main/libs/contentKnowledgeRetrieval.test.ts`

**Interfaces:**

- Consumes: `ContentKnowledgeVectorStore.upsertSources(scopeId, sources)`.
- Produces: identical deterministic chunk IDs can be stored in different scopes without
  `UNIQUE constraint failed: content_knowledge_chunks.id`.

- [ ] **Step 1: Confirm the regression test exists**

`src/main/libs/contentKnowledgeRetrieval.test.ts` must contain a test named:

```ts
test('sqlite vector store isolates deterministic chunk ids by scope', () => {
```

- [ ] **Step 2: Run focused knowledge tests**

Run:

```bash
npm test -- contentKnowledgeRetrieval agentKnowledgeEvidencePrompt openclawRuntimeAdapter
```

Expected: all selected tests pass.

- [ ] **Step 3: Run changed-file lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/libs/contentKnowledgeVectorStore.ts src/main/libs/contentKnowledgeRetrieval.test.ts
```

Expected: ESLint exits 0.

## Task 5: Reduce `AGENTS.md` Runtime Injection Below the 20000 Character Limit

**Files:**

- Modify: `src/main/libs/openclawConfigSync.ts`
- Test: `src/main/libs/openclawConfigSync.runtime.test.ts`

**Interfaces:**

- Consumes: generated OpenClaw workspace `AGENTS.md` content.
- Produces: generated main-agent and non-main-agent `AGENTS.md` files stay below 20000 characters in the tested
  marketing-agent configuration.

- [ ] **Step 1: Add a regression test that reproduces the length budget**

In `src/main/libs/openclawConfigSync.runtime.test.ts`, add a test near the existing `AGENTS.md` sync tests:

```ts
test('keeps generated agent AGENTS.md under the OpenClaw injection budget', async () => {
  const { OpenClawConfigSync } = await import('./openclawConfigSync');

  const sync = new OpenClawConfigSync({
    engineManager: {
      getConfigPath: () => configPath,
      getGatewayToken: () => 'gateway-token',
      getStateDir: () => stateDir,
      getBaseDir: () => tmpDir,
    } as never,
    getCoworkConfig: () => ({
      workingDirectory: tmpDir,
      systemPrompt: [
        'You help marketing users create copy-ready answers.',
        'Reuse available knowledge before asking follow-up questions.',
      ].join('\n'),
      executionMode: 'local',
      agentEngine: 'openclaw',
      memoryEnabled: true,
      memoryImplicitUpdateEnabled: true,
      memoryLlmJudgeEnabled: false,
      memoryGuardLevel: 'balanced',
      memoryUserMemoriesMaxItems: 100,
      skipMissedJobs: false,
    }),
    getBrowserWebAccessConfig: () => ({}),
    isEnterprise: () => false,
    getPopoInstances: () => [],
    getNeteaseBeeChanConfig: () => null,
    getWeixinConfig: () => null,
    getIMSettings: () => null,
    getSkillsList: () => [],
    getAgents: () => [
      {
        id: 'marketing-agent',
        name: 'Marketing Agent',
        enabled: true,
        systemPrompt: 'Create concise marketing copy with concrete business context.',
        identity: 'Marketing copy specialist',
        skillIds: [],
      },
    ],
  } as never);

  const result = sync.sync('agents-md-budget');
  expect(result.ok).toBe(true);

  const agentsMdPath = path.join(stateDir, 'workspace-marketing-agent', 'AGENTS.md');
  const agentsMd = fs.readFileSync(agentsMdPath, 'utf8');
  expect(agentsMd.length).toBeLessThanOrEqual(20000);
});
```

- [ ] **Step 2: Run the regression test**

Run:

```bash
npm test -- openclawConfigSync.runtime
```

Expected before prompt trimming: the new test fails if the generated marketing-agent `AGENTS.md` exceeds 20000
characters.

- [ ] **Step 3: Trim repeated static guidance in `openclawConfigSync.ts`**

In `src/main/libs/openclawConfigSync.ts`, shorten repeated managed-section guidance by editing only static prompt arrays
near the constants that build `AGENTS.md`. Keep the following ideas exactly once each:

```ts
'Use available memory, USER.md, MEMORY.md, saved positioning reports, workspace knowledge, and recent run results before asking follow-up questions.',
'For content generation, produce a conservative usable first draft when business evidence is sufficient.',
'Do not expose internal diagnostics, paths, indexing commands, provider errors, or tool stack traces in final answers.',
```

Remove duplicated longer variants that restate the same rules in both main-agent and non-main-agent managed sections. Do
not remove the managed-section markers, workspace file names, skill routing information, or sandbox instructions.

- [ ] **Step 4: Run the budget test again**

Run:

```bash
npm test -- openclawConfigSync.runtime
```

Expected: the budget test passes and existing OpenClaw config sync tests pass.

- [ ] **Step 5: Run changed-file lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/libs/openclawConfigSync.ts src/main/libs/openclawConfigSync.runtime.test.ts
```

Expected: ESLint exits 0.

## Task 6: Triage OpenAI Auth Failures Before Code Changes

**Files:**

- Inspect: `src/main/libs/openclawConfigSync.ts`
- Inspect: `src/main/libs/claudeSettings.ts`
- Inspect: `src/main/libs/pluginManager.ts`
- Inspect runtime file: `~/Library/Logs/宇智汇和 AI 助手/main-2026-07-07.log`

**Interfaces:**

- Consumes: configured provider state and generated OpenClaw auth/plugin config.
- Produces: a written root-cause note that identifies whether memory sync is incorrectly hardcoded to OpenAI, missing an
  auth propagation path, or using a plugin default that needs product configuration.

- [ ] **Step 1: Gather exact log evidence**

Run:

```bash
rg -n 'No API key found for provider "openai"|search-bootstrap|memory-core|memory-lancedb' "$HOME/Library/Logs/宇智汇和 AI 助手/main-2026-07-07.log"
```

Expected: output includes the failing agent ID, auth store path, and `search-bootstrap` phase.

- [ ] **Step 2: Inspect generated runtime config**

Run:

```bash
node -e "const fs=require('fs'); const p=process.env.HOME + '/Library/Application Support/yuzhh-ai-assistant/openclaw/state/openclaw.json'; const c=JSON.parse(fs.readFileSync(p,'utf8')); console.log(JSON.stringify({providers:Object.keys(c.models?.providers||{}), primary:c.models?.primary, memoryCore:c.plugins?.entries?.['memory-core'], memoryLancedb:c.plugins?.entries?.['memory-lancedb']}, null, 2));"
```

Expected: output shows whether `memory-core` or `memory-lancedb` still references OpenAI while the configured primary
provider is DeepSeek.

- [ ] **Step 3: Decide the smallest code path only after evidence**

Use the evidence from Steps 1 and 2:

- If a memory plugin entry explicitly names OpenAI while app config names DeepSeek, add an OpenClaw config sync test
  that asserts memory plugin provider follows the app model provider, then update `src/main/libs/openclawConfigSync.ts`.
- If OpenClaw defaults to OpenAI when no plugin entry exists, add a version-scoped OpenClaw patch or explicit LobsterAI
  plugin config entry; choose LobsterAI config first if it can express the behavior cleanly.
- If the marketing agent is intentionally configured for OpenAI, fix the agent auth profile or provider setting outside
  code.

- [ ] **Step 4: Record the decision**

Append the evidence and chosen path to this plan under "Task 6 Result" before implementing a code change. Include the
exact provider, agent ID, and runtime config key involved.

## Task 7: Triage Directory Read `EISDIR` Before Code Changes

**Files:**

- Inspect: `src/main/libs/agentEngine/openclawRuntimeAdapter.ts`
- Inspect: `src/main/main.ts`
- Inspect runtime file: `~/Library/Logs/宇智汇和 AI 助手/main-2026-07-07.log`

**Interfaces:**

- Consumes: tool call display/handling around OpenClaw `read` tool failures.
- Produces: a localized bug report or a small UX fix that turns directory reads into a user-friendly directory listing
  or explanatory error.

- [ ] **Step 1: Gather exact failing calls**

Run:

```bash
rg -n 'EISDIR: illegal operation on a directory|raw_params=.*"path"' "$HOME/Library/Logs/宇智汇和 AI 助手/main-2026-07-07.log"
```

Expected: output includes the directory path passed to the `read` tool.

- [ ] **Step 2: Determine whether the failure is OpenClaw-side or LobsterAI-side**

Run:

```bash
rg -n 'name: .read.|toolCall.*read|read failed|tool_result|toolResult' src/main/libs/agentEngine/openclawRuntimeAdapter.ts src/main/main.ts
```

Expected: output identifies whether LobsterAI only displays the OpenClaw tool failure or transforms the tool request.

- [ ] **Step 3: Choose the fix boundary**

Use this boundary rule:

- If LobsterAI only displays the OpenClaw failure, create a version-scoped OpenClaw patch that checks
  `fs.statSync(path).isDirectory()` before `readFile`.
- If LobsterAI constructs the read request with a directory path, add a LobsterAI-side guard and a test in
  `src/main/libs/agentEngine/openclawRuntimeAdapter.test.ts`.

- [ ] **Step 4: Add a failing test after choosing the boundary**

If the fix is LobsterAI-side, add a test whose assertion contains this user-facing message:

```ts
expect(result.content).toContain('This path is a directory');
```

If the fix is OpenClaw-side, add the assertion to the OpenClaw patch test inside the version-scoped patch and add a
LobsterAI static patch test under `src/main/libs/openclawPatches/`.

## Task 8: Gateway Liveness and Reconnect Follow-Up

**Files:**

- Inspect: `src/main/libs/openclawEngineManager.ts`
- Inspect: `src/main/libs/openclawChannelSessionSync.ts`
- Inspect runtime file: `~/Library/Logs/宇智汇和 AI 助手/main-2026-07-07.log`

**Interfaces:**

- Consumes: gateway liveness warnings, event loop delay diagnostics, and reconnect logs.
- Produces: either a confirmed environmental note or a focused runtime bug report with one reproducible trigger.

- [ ] **Step 1: Extract liveness timeline**

Run:

```bash
rg -n 'liveness warning|TickWatchdog|gateway WS disconnected|gateway client stopped' "$HOME/Library/Logs/宇智汇和 AI 助手/main-2026-07-07.log"
```

Expected: output includes timestamps and event-loop delay values.

- [ ] **Step 2: Compare the liveness windows with app activity**

Run:

```bash
rg -n 'agent run start|embedded run agent start|embedded run agent end|syncOpenClawConfig START|startGateway|restartGateway' "$HOME/Library/Logs/宇智汇和 AI 助手/main-2026-07-07.log"
```

Expected: output shows whether liveness warnings happen during long agent runs, config sync, gateway restart, or idle
periods.

- [ ] **Step 3: Decide whether code changes are justified**

Use this boundary rule:

- If liveness warnings happen only after machine sleep, app quit, or manual gateway restart, record as environmental.
- If warnings happen during active runs and correlate with a blocking synchronous operation, add a focused test or
  diagnostic timer around that operation.
- If warnings happen without local work and with event-loop delay over 90000ms, open an OpenClaw runtime investigation
  before changing LobsterAI reconnect policy.

## Task 8 Result

- Status: DONE_WITH_CONCERNS
- Boundary: OpenClaw runtime investigation, not a LobsterAI code change.
- Evidence: the log shows multiple `TickWatchdog` timeouts and OpenClaw `liveness warning` entries with
  `eventLoopDelayMaxMs` well above 90000ms, plus repeated `gateway WS disconnected` / `gateway client stopped`
  follow-ups. Some spikes occur right after `system resumed from sleep`, but others happen during active agent and
  channel-poll activity.
- Recommendation: do not change LobsterAI reconnect policy yet; investigate the OpenClaw runtime watchdog /
  event-loop-delay source first.

## Task 9: Final Verification and Handoff

**Files:**

- Verify all files touched by Tasks 1 through 5.
- Do not include files from Tasks 6 through 8 unless those tasks produced code changes after evidence review.

**Interfaces:**

- Consumes: all implemented fixes.
- Produces: a clean handoff that separates passed verification, sandbox-only failures, and deferred runtime
  investigations.

- [ ] **Step 1: Run official tests**

Run:

```bash
npm test
```

Expected in normal local permissions: all Vitest files pass. If the sandbox blocks loopback listening with
`listen EPERM: operation not permitted 127.0.0.1`, rerun with normal local permissions and record the sandbox-only
failure.

- [ ] **Step 2: Run Electron compile**

Run:

```bash
npm run compile:electron
```

Expected in normal local permissions: command exits 0. If the sandbox blocks `~/.npm` or `~/.electron-gyp`, rerun with
normal local permissions and record the sandbox-only failure.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: command exits 0.

- [ ] **Step 4: Run changed-file lint**

Run this command with the actual touched TypeScript and TSX files:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/libs/openclawPatches/pluginSkillSymlinkIdempotent.test.ts tests/openclawPatchSafety.test.ts src/shared/browserWebAccess/constants.ts src/shared/browserWebAccess/constants.test.ts src/main/libs/openclawConfigSync.runtime.test.ts src/renderer/config.ts src/renderer/services/config.ts src/renderer/services/config.test.ts src/main/libs/contentKnowledgeVectorStore.ts src/main/libs/contentKnowledgeRetrieval.test.ts
```

Expected: command exits 0.

- [ ] **Step 5: Review git state**

Run:

```bash
git status --short
git diff --stat
```

Expected: changes are limited to the planned files plus pre-existing uncommitted files. Do not revert unrelated user
changes.

- [ ] **Step 6: Optional OpenClaw patch apply verification with approval**

Only after the user confirms that `../openclaw` can be modified, run:

```bash
npm run openclaw:patch
```

Expected: the script either applies patches or skips already-applied patches. It must not reset or clean `../openclaw`
unless `LOBSTERAI_OPENCLAW_PATCH_RESET=1` is explicitly set.

## Deferred Debt Not Included in This Fix

- Full-repo `npm run lint` cleanup remains separate because it currently reports historical import/export sorting and
  hooks warnings outside the changed-file gate.
- Runtime OpenAI memory auth failures require Task 6 evidence before code changes.
- Runtime `EISDIR` directory reads require Task 7 boundary selection before code changes.
- Gateway liveness warnings require Task 8 timeline correlation before reconnect policy changes.

## Self-Review

- Spec coverage: covers the broken OpenClaw patch test, dangerous OpenClaw patch reset behavior, browser private-network
  security warning, scoped content knowledge regression, AGENTS injection length warning, OpenAI memory auth failures,
  EISDIR directory reads, gateway liveness warnings, and final verification.
- Placeholder scan: no step uses an undefined file path or an unspecified command. Diagnostic tasks have explicit
  evidence commands and boundary rules before code changes.
- Type consistency: referenced names match the current codebase: `BrowserNetworkMode`, `BrowserWebAccessConfig`,
  `normalizeBrowserWebAccessConfig`, `OpenClawConfigSync`, `expectPatchContains`, and `ContentKnowledgeVectorStore`.

## Task 6 Result

Status: evidence gathered, decision recorded.

Evidence:

- Log search found 46 `No API key found for provider "openai"` / `search-bootstrap` failures and 44
  `loading memory-core` entries in `~/Library/Logs/宇智汇和 AI 助手/main-2026-07-07.log`.
- The failures point at per-agent auth stores for `main` and `marketing-agent`:
  `~/Library/Application Support/yuzhh-ai-assistant/openclaw/state/agents/main/agent/auth-profiles.json` and
  `~/Library/Application Support/yuzhh-ai-assistant/openclaw/state/agents/marketing-agent/agent/auth-profiles.json`.
- Runtime config `~/Library/Application Support/yuzhh-ai-assistant/openclaw/state/openclaw.json` currently has
  `models.providers.deepseek`, `models.primary = deepseek/deepseek-v4-pro`, and `agents.defaults.memorySearch = null`.
- OpenClaw runtime `vendor/openclaw-runtime/mac-arm64/dist/memory-search-3JM0G_3O.js` hardcodes
  `DEFAULT_MEMORY_EMBEDDING_PROVIDER = "openai"` and uses it when the memory provider is omitted or set to `auto`.
- `src/main/libs/openclawConfigSync.ts` only writes `agents.defaults.memorySearch` when
  `runtimeCoworkConfig.embeddingEnabled` is truthy; the current branch omits any explicit disabled policy.

Decision:

- Code change is likely needed, but the root cause is shared: OpenClaw falls back to OpenAI for memory search, and
  LobsterAI currently omits `agents.defaults.memorySearch` when embedding is disabled.
- Smallest boundary: `src/main/libs/openclawConfigSync.ts`, specifically the `agents.defaults.memorySearch` sync path. A
  focused runtime test should assert that embedding-disabled configs emit an explicit disabled policy, and
  embedding-enabled configs emit the selected provider/model.

## Task 7 Result

Status: evidence gathered, boundary chosen.

Evidence:

- Runtime logs show two `EISDIR: illegal operation on a directory, read` failures emitted from `[OpenClaw stderr]`.
- The exact directory paths were
  `~/Library/Application Support/yuzhh-ai-assistant/openclaw/state/workspace-marketing-agent/memory` and
  `~/Library/Application Support/yuzhh-ai-assistant/openclaw/state/workspace-marketing-agent/product-intro-video`.
- `src/main/libs/agentEngine/openclawRuntimeAdapter.ts` and `src/main/main.ts` only render or store incoming tool
  events/results for this path; no LobsterAI code path was found constructing those `read` requests.

Decision:

- Boundary is OpenClaw-side. The follow-up fix should be a version-scoped OpenClaw patch for `v2026.6.1` that checks
  whether a `read` target is a directory before `readFile`, returning a user-friendly message such as
  `This path is a directory`.
- LobsterAI-side work should be limited to a static patch regression test under `src/main/libs/openclawPatches/` if that
  OpenClaw patch is added.
