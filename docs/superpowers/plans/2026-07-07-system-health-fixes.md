# System Health Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the current system-health issues found on 2026-07-07 without broad unrelated refactors.

**Architecture:** Apply small, testable changes at the ownership boundary where each problem originates. LobsterAI-side
runtime behavior stays in `src/main` and `src/shared`; OpenClaw internal behavior is handled as a version-scoped patch
under `scripts/patches/v2026.6.1/`.

**Tech Stack:** Electron, React, TypeScript, Vitest, ESLint, SQLite via `better-sqlite3`, OpenClaw runtime `v2026.6.1`.

## Global Constraints

- Node.js must remain `>=24.15.0 <25`.
- Do not revert existing uncommitted user changes.
- Keep changes scoped; do not perform broad lint cleanup in the critical bugfix tasks.
- Add or update tests as `.test.ts` files using Vitest.
- Run changed-file lint with `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 <files>`.
- Do not edit `vendor/openclaw-runtime/` generated output; use `scripts/patches/v2026.6.1/` for OpenClaw changes.

---

## File Structure

- Modify `src/main/libs/contentKnowledgeVectorStore.ts`: isolate persisted knowledge chunk ids by scope before inserting
  into SQLite.
- Modify `src/main/libs/contentKnowledgeRetrieval.test.ts`: add regression coverage for identical source ids/content
  across scopes.
- Modify `src/shared/browserWebAccess/constants.ts`: make strict browser network mode the default if product decision is
  to remove the startup security warning.
- Modify `src/shared/browserWebAccess/constants.test.ts`: assert default browser network mode is strict.
- Modify `src/main/libs/openclawConfigSync.runtime.test.ts`: assert default browser config does not enable
  private-network browser access.
- Create `scripts/patches/v2026.6.1/openclaw-plugin-skill-symlink-idempotent.patch`: make OpenClaw plugin skill symlink
  creation idempotent when the existing generated symlink already points to the target.
- Modify `scripts/apply-openclaw-patches.cjs`: add strong validation for the new OpenClaw patch.

## Task 1: Scope Knowledge Chunk Storage IDs

**Files:**

- Modify: `src/main/libs/contentKnowledgeVectorStore.ts`
- Test: `src/main/libs/contentKnowledgeRetrieval.test.ts`

**Interfaces:**

- Consumes: `ContentKnowledgeChunk.id` from `buildContentKnowledgeIndex(sources)`.
- Produces: `ContentKnowledgeVectorStore.upsertSources(scopeId, sources)` can store identical source ids/content in
  different scopes without throwing `UNIQUE constraint failed: content_knowledge_chunks.id`.

- [ ] **Step 1: Write the failing regression test**

Add this test to `src/main/libs/contentKnowledgeRetrieval.test.ts` inside
`describe('content knowledge retrieval', () => { ... })`:

```ts
  test('sqlite vector store isolates deterministic chunk ids by scope', () => {
    const db = new Database(':memory:');
    const store = new ContentKnowledgeVectorStore(db);
    const source = {
      sourceId: 'source-0',
      sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
      label: '相关公司资料.md',
      content: '主营工业包装服务，客户是机械设备厂采购负责人，卖点是防破损和免熏蒸。',
    };

    expect(() => store.upsertSources('enterprise-workspace:a', [source])).not.toThrow();
    expect(() => store.upsertSources('enterprise-workspace:b', [source])).not.toThrow();

    const row = db
      .prepare('SELECT COUNT(*) AS count FROM content_knowledge_chunks')
      .get() as { count: number };

    expect(row.count).toBe(2);
    expect(store.search('enterprise-workspace:a', '写一段私域销售转化话术').matched).toBe(true);
    expect(store.search('enterprise-workspace:b', '写一段私域销售转化话术').matched).toBe(true);

    db.close();
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- contentKnowledgeRetrieval
```

Expected before implementation: the new test fails with `UNIQUE constraint failed: content_knowledge_chunks.id`.

- [ ] **Step 3: Implement scoped persisted ids**

In `src/main/libs/contentKnowledgeVectorStore.ts`, import crypto:

```ts
import crypto from 'crypto';
```

Add this helper near the JSON parsing helpers:

```ts
const buildStoredChunkId = (scopeId: string, chunkId: string): string =>
  crypto
    .createHash('sha1')
    .update(scopeId)
    .update('\0')
    .update(chunkId)
    .digest('hex');
```

Replace both `insertChunk.run(` calls so the first inserted value is scoped:

```ts
          insertChunk.run(
            buildStoredChunkId(normalizedScopeId, chunk.id),
            normalizedScopeId,
            chunk.sourceType,
```

Do this in both `upsertSources()` and `replaceSources()`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- contentKnowledgeRetrieval agentKnowledgeEvidencePrompt openclawRuntimeAdapter
```

Expected: all selected tests pass.

- [ ] **Step 5: Verify lint for touched files**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/libs/contentKnowledgeVectorStore.ts src/main/libs/contentKnowledgeRetrieval.test.ts
```

Expected: no output and exit code 0.

## Task 2: Make Browser Private-Network Access Explicit

**Files:**

- Modify: `src/shared/browserWebAccess/constants.ts`
- Test: `src/shared/browserWebAccess/constants.test.ts`
- Test: `src/main/libs/openclawConfigSync.runtime.test.ts`

**Interfaces:**

- Consumes: `BrowserNetworkMode.Strict` and `normalizeBrowserWebAccessConfig()`.
- Produces: new installs default to strict SSRF behavior; users can still opt into `BrowserNetworkMode.ProxyCompatible`
  from settings.

- [ ] **Step 1: Add default normalization test**

Add this test to `src/shared/browserWebAccess/constants.test.ts`:

```ts
  test('defaults browser network access to strict mode', () => {
    const config = normalizeBrowserWebAccessConfig({});

    expect(config.networkMode).toBe(BrowserNetworkMode.Strict);
  });
```

- [ ] **Step 2: Add OpenClaw config sync regression test**

Add this test near the browser config tests in `src/main/libs/openclawConfigSync.runtime.test.ts`:

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

- [ ] **Step 3: Run the focused tests and verify failure**

Run:

```bash
npm test -- browserWebAccess openclawConfigSync.runtime
```

Expected before implementation: default network mode assertion fails because the current default is `proxy-compatible`.

- [ ] **Step 4: Change the default**

In `src/shared/browserWebAccess/constants.ts`, change:

```ts
  networkMode: BrowserNetworkMode.ProxyCompatible,
```

to:

```ts
  networkMode: BrowserNetworkMode.Strict,
```

Keep the `ProxyCompatible` option available in the settings UI; do not remove enum values or UI controls.

- [ ] **Step 5: Run tests and lint**

Run:

```bash
npm test -- browserWebAccess openclawConfigSync.runtime
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/browserWebAccess/constants.ts src/shared/browserWebAccess/constants.test.ts src/main/libs/openclawConfigSync.runtime.test.ts
```

Expected: focused tests pass and lint exits 0.

## Task 3: Make OpenClaw Plugin Skill Symlink Creation Idempotent

**Files:**

- Create: `scripts/patches/v2026.6.1/openclaw-plugin-skill-symlink-idempotent.patch`
- Modify: `scripts/apply-openclaw-patches.cjs`
- OpenClaw source target: `../openclaw/src/skills/loading/plugin-skills.ts`
- OpenClaw source test target: `../openclaw/src/skills/loading/plugin-skills.test.ts`

**Interfaces:**

- Consumes: OpenClaw `resolvePluginSkillDirs()` / plugin skill materialization flow.
- Produces: existing generated symlink pointing at the same target is treated as success, not logged as
  `failed to create plugin skill symlink ... EEXIST`.

- [ ] **Step 1: Add the OpenClaw regression test in the patch**

Patch `../openclaw/src/skills/loading/plugin-skills.test.ts` with a test that creates the desired symlink before refresh
and expects no warning. The test body should be equivalent to:

```ts
  it("keeps existing generated plugin skill symlinks that already point at the target", async () => {
    const skillParent = await tempDirs.make("plugin-skills-");
    const managedDir = await tempDirs.make("managed-plugin-skills-");
    await createSkill(skillParent, "browser-automation");
    const target = path.join(skillParent, "browser-automation");
    const linkPath = path.join(managedDir, "browser-automation");
    fsSync.symlinkSync(target, linkPath, "dir");

    const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => undefined);

    testing.materializePluginSkillSymlinks([skillParent], { pluginSkillsDir: managedDir });

    expect(fsSync.realpathSync(linkPath)).toBe(fsSync.realpathSync(target));
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("failed to create plugin skill symlink"),
    );
  });
```

- [ ] **Step 2: Patch the implementation**

Patch `../openclaw/src/skills/loading/plugin-skills.ts` so `fs.symlinkSync(target, linkPath, linkType)` handles `EEXIST`
by checking the existing entry:

```ts
      try {
        fs.symlinkSync(target, linkPath, linkType);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") {
          try {
            if (
              fs.lstatSync(linkPath).isSymbolicLink() &&
              fs.realpathSync(linkPath) === fs.realpathSync(target)
            ) {
              activeLinkPaths.add(linkPath);
              continue;
            }
          } catch {
            // Fall through to the existing warning for broken or unreadable entries.
          }
        }
        log.warn(`failed to create plugin skill symlink "${linkPath}" → "${target}": ${String(err)}`);
      }
```

Preserve the existing cleanup behavior for stale, broken, non-generated, or moved links.

- [ ] **Step 3: Save the patch**

From the LobsterAI repo root, generate:

```bash
git -C ../openclaw diff src/skills/loading/plugin-skills.ts src/skills/loading/plugin-skills.test.ts > scripts/patches/v2026.6.1/openclaw-plugin-skill-symlink-idempotent.patch
```

Expected: the new patch file contains only the two OpenClaw source files above.

- [ ] **Step 4: Add strong patch validation**

In `scripts/apply-openclaw-patches.cjs`, add a `strongPatchValidators` entry:

```js
  'openclaw-plugin-skill-symlink-idempotent.patch': [
    {
      file: 'src/skills/loading/plugin-skills.ts',
      snippets: [
        'code === "EEXIST"',
        'fs.realpathSync(linkPath) === fs.realpathSync(target)',
        'activeLinkPaths.add(linkPath)',
      ],
    },
    {
      file: 'src/skills/loading/plugin-skills.test.ts',
      snippets: [
        'keeps existing generated plugin skill symlinks that already point at the target',
        'failed to create plugin skill symlink',
      ],
    },
  ],
```

- [ ] **Step 5: Run OpenClaw and LobsterAI verification**

Run:

```bash
npm run openclaw:patch
cd ../openclaw && npm test -- plugin-skills
cd ../yuzhh-ai-assistant && npm run openclaw:runtime:host
```

Expected: patch applies, OpenClaw plugin skill tests pass, runtime rebuild succeeds.

## Task 4: Verification, Triage, and Deferred Debt

**Files:**

- No source changes required unless earlier tasks changed files.

**Interfaces:**

- Consumes: all fixes from Tasks 1-3.
- Produces: a clean handoff with clear distinction between fixed issues and deferred non-blocking debt.

- [ ] **Step 1: Run core verification**

Run:

```bash
npm test
npm run compile:electron
npm run build
```

Expected: all three commands pass. If `npm test` or `compile:electron` fails inside sandbox with loopback/cache
permission errors, rerun with normal local permissions and record the sandbox-only failure.

- [ ] **Step 2: Run changed-file lint**

Run this with the actual touched files from Tasks 1-3:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/libs/contentKnowledgeVectorStore.ts src/main/libs/contentKnowledgeRetrieval.test.ts src/shared/browserWebAccess/constants.ts src/shared/browserWebAccess/constants.test.ts src/main/libs/openclawConfigSync.runtime.test.ts
```

Expected: exit code 0.

- [ ] **Step 3: Manually validate runtime logs**

Start the app:

```bash
npm run electron:dev
```

After the gateway reaches ready, inspect the current main log:

```bash
tail -n 2000 "$HOME/Library/Logs/宇智汇和 AI 助手/main-2026-07-07.log" | rg -i "UNIQUE constraint failed: content_knowledge_chunks.id|failed to create plugin skill symlink|dangerouslyAllowPrivateNetwork=true"
```

Expected after all fixes:

```text
no matches
```

- [ ] **Step 4: Record deferred items instead of mixing them into this fix**

Keep these as separate follow-up work:

- Full-repo lint cleanup: `npm run lint` currently reports historical import/export sorting and React hook warnings
  outside the current changed-file gate.
- Agent auth cleanup: marketing agent memory sync needs an OpenAI auth profile or a deliberate provider selection
  change.
- Prompt-size cleanup: workspace `AGENTS.md` exceeded the 20000 character injection limit and should be shortened or
  split.
- Tool UX cleanup: reading a directory path produced `EISDIR`; handle this in the tool layer only if it is reproducible
  from UI actions.

- [ ] **Step 5: Final review**

Review the diff for accidental generated-file churn:

```bash
git status --short
git diff --stat
```

Expected: changes are limited to the planned files and the existing unrelated worktree changes are not reverted.

## Recommended Execution Order

1. Task 1 first: it fixes the real user-facing knowledge-context failure.
2. Task 2 second: it removes the default security warning while preserving explicit opt-in.
3. Task 3 third: it reduces runtime error noise through a proper OpenClaw version patch.
4. Task 4 last: it proves the system is healthy and separates deferred debt from fixed bugs.

## Self-Review

- Spec coverage: all observed issues are represented. Critical runtime bug, security warning, symlink warning,
  validation commands, and deferred non-code/config debt are covered.
- Placeholder scan: no task contains open-ended implementation placeholders.
- Type consistency: planned functions and constants match existing names: `ContentKnowledgeVectorStore`,
  `buildContentKnowledgeIndex`, `BrowserNetworkMode.Strict`, and `OpenClawConfigSync`.
