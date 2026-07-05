# Two-Layer Runtime Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare "宇智汇和 AI 助手" for a macOS and Windows commercial release using a publish-level self-owned "
宇智汇和运行时 / Yuzhh Runtime" wrapper around the existing OpenClaw integration.

**Architecture:** Add centralized brand constants for product, distribution, and runtime names. Use those constants in
packaged runtime path resolution, user-facing runtime messages, release configuration, and legal surfaces while keeping
internal OpenClaw integration names where they preserve upgradeability. Disable automatic update checks for the first
release and verify packaged artifacts do not expose the legacy `cfmind` runtime directory.

**Tech Stack:** Electron, React, TypeScript, Vite, electron-builder, Vitest, ESLint, OpenClaw runtime packaging scripts.

---

## File Map

- Create: `src/shared/branding/constants.ts`
  - Owns product, company, distribution, runtime, legacy runtime, and upstream component constants.
- Create: `src/shared/branding/constants.test.ts`
  - Verifies release-facing brand defaults.
- Modify: `src/main/libs/openclawEngineManager.ts`
  - Uses branded packaged runtime directory lookup and branded missing-runtime message.
- Modify: `src/main/libs/openclawEngineManager.test.ts` or create a focused adjacent test if no test exists.
  - Verifies `yuzhh-runtime` is preferred and `cfmind` remains fallback only.
- Modify: `electron-builder.json`
  - Packages runtime resources as `yuzhh-runtime`.
- Modify: runtime packaging scripts under `scripts/`
  - Changes release resource copy destination from `cfmind` to `yuzhh-runtime`.
- Modify: `package.json`
  - Keeps auto-update disabled for the first release and confirms macOS/Windows artifact naming.
- Create or modify: `NOTICE.md`
  - Adds product, company, and OpenClaw component notice.
- Create or modify: `THIRD_PARTY_NOTICES.md`
  - Adds OpenClaw MIT disclosure and points to generated dependency notices when available.
- Create or modify: `PRIVACY.md`
  - Documents local-first data behavior.
- Create or modify: `TERMS.md`
  - Documents AI, third-party provider, and local execution terms.
- Modify: renderer settings/about/legal component files once located during implementation.
  - Adds in-app legal and open-source notice entry points.
- Create: `docs/release/mac-windows-release-checklist.md`
  - Documents unsigned test packaging, signed release packaging, artifact scans, and manual-download update policy.
- Create: `scripts/check-release-branding.cjs`
  - Scans release-relevant outputs for forbidden `cfmind` package exposure and legacy cloud endpoints.

---

## Task 1: Add Central Brand Constants

**Files:**

- Create: `src/shared/branding/constants.ts`
- Create: `src/shared/branding/constants.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/branding/constants.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import {
  DistributionBrand,
  ProductBrand,
  RuntimeBrand,
} from './constants';

describe('branding constants', () => {
  test('uses Yuzhh product and company identity', () => {
    expect(ProductBrand.NameZh).toBe('宇智汇和 AI 助手');
    expect(ProductBrand.CompanyNameZh).toBe('宇智汇和（东莞）科技有限公司');
    expect(ProductBrand.AppId).toBe('com.yuzhh.ai-assistant');
  });

  test('uses Yuzhh Runtime as the packaged runtime identity', () => {
    expect(RuntimeBrand.DisplayNameZh).toBe('宇智汇和运行时');
    expect(RuntimeBrand.DisplayNameEn).toBe('Yuzhh Runtime');
    expect(RuntimeBrand.BundleDirName).toBe('yuzhh-runtime');
    expect(RuntimeBrand.LegacyBundleDirName).toBe('cfmind');
    expect(RuntimeBrand.UpstreamName).toBe('OpenClaw');
  });

  test('keeps manual download as the first release update strategy', () => {
    expect(DistributionBrand.AutomaticUpdatesEnabled).toBe(false);
    expect(DistributionBrand.DownloadUrl).toBe('https://www.yuzhh.com/download');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- src/shared/branding/constants.test.ts
```

Expected: FAIL because `src/shared/branding/constants.ts` does not exist.

- [ ] **Step 3: Add the brand constants**

Create `src/shared/branding/constants.ts`:

```ts
export const ProductBrand = {
  NameZh: '宇智汇和 AI 助手',
  NameEn: 'Yuzhh AI Assistant',
  CompanyNameZh: '宇智汇和（东莞）科技有限公司',
  CompanyNameEn: 'Yuzhh (Dongguan) Technology Co., Ltd.',
  AppId: 'com.yuzhh.ai-assistant',
  Protocol: 'yuzhh-ai',
} as const;

export const RuntimeBrand = {
  DisplayNameZh: '宇智汇和运行时',
  DisplayNameEn: 'Yuzhh Runtime',
  BundleDirName: 'yuzhh-runtime',
  LegacyBundleDirName: 'cfmind',
  UpstreamName: 'OpenClaw',
} as const;

export const DistributionBrand = {
  AutomaticUpdatesEnabled: false,
  DownloadUrl: 'https://www.yuzhh.com/download',
  AccountUrl: 'https://www.yuzhh.com/account',
  LegalUrl: 'https://www.yuzhh.com/legal',
} as const;
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npm test -- src/shared/branding/constants.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run lint for the new files**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/branding/constants.ts src/shared/branding/constants.test.ts
```

Expected: PASS.

---

## Task 2: Brand Packaged Runtime Path Resolution

**Files:**

- Modify: `src/main/libs/openclawEngineManager.ts`
- Modify or create: `src/main/libs/openclawEngineManager.test.ts`
- Modify imports to use `src/shared/branding/constants.ts`

- [ ] **Step 1: Locate runtime path helper functions**

Run:

```bash
rg -n "cfmind|Resources|openclaw-runtime|runtime" src/main/libs/openclawEngineManager.ts src/main -g '*.ts'
```

Expected: identify the helper that chooses the packaged runtime directory and the user-facing missing-runtime message.

- [ ] **Step 2: Write or update the failing test**

If `src/main/libs/openclawEngineManager.test.ts` already exists, add this test. If it does not exist, create it and
import the exported helper after making the helper exportable in Step 4.

```ts
import { describe, expect, test } from 'vitest';

import { RuntimeBrand } from '../../shared/branding/constants';
import {
  getPackagedRuntimeDirCandidates,
  getRuntimeMissingMessage,
} from './openclawEngineManager';

describe('OpenClaw packaged runtime branding', () => {
  test('prefers the Yuzhh runtime directory and keeps cfmind only as fallback', () => {
    expect(getPackagedRuntimeDirCandidates('/Applications/App.app/Contents/Resources')).toEqual([
      '/Applications/App.app/Contents/Resources/yuzhh-runtime',
      '/Applications/App.app/Contents/Resources/cfmind',
    ]);
  });

  test('uses user-facing Yuzhh runtime text for missing runtime errors', () => {
    expect(getRuntimeMissingMessage()).toContain(RuntimeBrand.DisplayNameZh);
    expect(getRuntimeMissingMessage()).not.toContain('cfmind');
    expect(getRuntimeMissingMessage()).not.toContain('OpenClaw');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
npm test -- src/main/libs/openclawEngineManager.test.ts
```

Expected: FAIL because the exported helpers do not exist or still return `cfmind`-first behavior.

- [ ] **Step 4: Implement branded helper functions**

In `src/main/libs/openclawEngineManager.ts`, add or adapt these exports near the runtime path helpers:

```ts
import { RuntimeBrand } from '../../shared/branding/constants';

export function getPackagedRuntimeDirCandidates(resourcesPath: string): string[] {
  return [
    path.join(resourcesPath, RuntimeBrand.BundleDirName),
    path.join(resourcesPath, RuntimeBrand.LegacyBundleDirName),
  ];
}

export function getRuntimeMissingMessage(): string {
  return `未检测到内置${RuntimeBrand.DisplayNameZh}，请先完成运行时构建或重新安装应用。`;
}
```

Then update the existing packaged runtime lookup to use `getPackagedRuntimeDirCandidates(...)` and update the
user-facing missing-runtime warning to use `getRuntimeMissingMessage()`.

- [ ] **Step 5: Run the targeted test**

Run:

```bash
npm test -- src/main/libs/openclawEngineManager.test.ts
```

Expected: PASS.

- [ ] **Step 6: Lint touched files**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/libs/openclawEngineManager.ts src/main/libs/openclawEngineManager.test.ts src/shared/branding/constants.ts
```

Expected: PASS.

---

## Task 3: Package Runtime As `yuzhh-runtime`

**Files:**

- Modify: `electron-builder.json`
- Modify: relevant scripts found by
  `rg -n "cfmind|extraResources|openclaw-runtime|vendor/openclaw-runtime" scripts electron-builder.json package.json`

- [ ] **Step 1: Locate packaging references**

Run:

```bash
rg -n "cfmind|extraResources|openclaw-runtime|vendor/openclaw-runtime|Resources" electron-builder.json scripts package.json
```

Expected: list every place that copies or refers to the packaged runtime directory.

- [ ] **Step 2: Update electron-builder resources**

In `electron-builder.json`, change any runtime resource mapping from:

```json
{
  "from": "vendor/openclaw-runtime/current",
  "to": "cfmind"
}
```

to:

```json
{
  "from": "vendor/openclaw-runtime/current",
  "to": "yuzhh-runtime"
}
```

If the file uses a different equivalent structure, preserve the surrounding format and only change the release
destination to `yuzhh-runtime`.

- [ ] **Step 3: Update runtime packaging scripts**

For each script found in Step 1 that writes `cfmind` as the packaged release directory, replace that output directory
with `RuntimeBrand.BundleDirName` when the script can import shared constants cleanly, or with the literal
`yuzhh-runtime` if the script is plain CommonJS and importing TypeScript would be brittle.

CommonJS script example:

```js
const PACKAGED_RUNTIME_DIR = 'yuzhh-runtime';
const LEGACY_PACKAGED_RUNTIME_DIR = 'cfmind';
```

Use `PACKAGED_RUNTIME_DIR` for new output and reserve `LEGACY_PACKAGED_RUNTIME_DIR` only for compatibility reads.

- [ ] **Step 4: Scan for remaining package-facing `cfmind` references**

Run:

```bash
rg -n "cfmind" electron-builder.json scripts src/main src/renderer src/shared package.json README.md README_zh.md
```

Expected: only compatibility fallback references, internal migration notes, tests that assert fallback behavior, or
legal/developer documentation remain.

- [ ] **Step 5: Run Electron compile**

Run:

```bash
npm run compile:electron
```

Expected: PASS.

---

## Task 4: Keep Automatic Updates Disabled For First Release

**Files:**

- Modify if needed: `src/shared/cloudCapabilities/constants.ts`
- Modify if needed: `src/main/libs/appUpdateCoordinator.ts`
- Modify if needed: `src/renderer/services/endpoints.ts`
- Modify if needed: `src/main/libs/endpoints.ts`
- Test: existing endpoint/update tests

- [ ] **Step 1: Confirm update endpoints are disabled**

Run:

```bash
rg -n "getUpdateCheckUrl|getManualUpdateCheckUrl|autoUpdater|update" src/main src/renderer src/shared
```

Expected: locate update endpoint helpers and update coordinator behavior.

- [ ] **Step 2: Add or confirm tests**

Ensure tests assert:

```ts
expect(getUpdateCheckUrl()).toBe('');
expect(getManualUpdateCheckUrl()).toBe('');
```

and that update fetching returns no update when endpoint is disabled.

- [ ] **Step 3: Run update-related tests**

Run:

```bash
npm test -- src/renderer/services/endpoints.test.ts src/main/libs/appUpdateCoordinator.test.ts
```

Expected: PASS.

---

## Task 5: Add Release Legal Documents

**Files:**

- Create or modify: `NOTICE.md`
- Create or modify: `THIRD_PARTY_NOTICES.md`
- Create or modify: `PRIVACY.md`
- Create or modify: `TERMS.md`
- Create or modify: `SECURITY.md`

- [ ] **Step 1: Create or update `NOTICE.md`**

Use this content as the starting point:

```md
# Notice

宇智汇和 AI 助手 is published by 宇智汇和（东莞）科技有限公司.

The bundled 宇智汇和运行时 / Yuzhh Runtime includes OpenClaw open-source
components. OpenClaw is licensed under the MIT License. See
THIRD_PARTY_NOTICES.md for copyright and license details.
```

- [ ] **Step 2: Create or update `THIRD_PARTY_NOTICES.md`**

Use this content as the starting point:

```md
# Third-Party Notices

This product includes third-party open-source software.

## OpenClaw

宇智汇和运行时 includes OpenClaw components.

OpenClaw is licensed under the MIT License.

Copyright (c) 2026 OpenClaw Foundation

Permission is granted under the MIT License. The full OpenClaw license text
must be included with release artifacts that contain OpenClaw components.

## Dependency Notices

Additional dependency notices are generated from the packaged npm dependency
tree during release preparation.
```

- [ ] **Step 3: Create or update `PRIVACY.md`**

Use this content as the starting point:

```md
# Privacy Policy

宇智汇和 AI 助手 runs locally by default and does not require login for the
local-first release.

Project files, sessions, logs, configuration, and runtime state are stored on
the user's device by default. Analytics and log uploads are disabled by
default.

When users configure model providers, IM channels, MCP servers, skills, or
plugins, data may be sent to the services selected by the user. Those services
are governed by their own terms and privacy policies.

Skills, plugins, and MCP servers may access local files, execute commands, or
connect to networks depending on the permissions and configuration selected by
the user.
```

- [ ] **Step 4: Create or update `TERMS.md`**

Use this content as the starting point:

```md
# Terms of Use

宇智汇和 AI 助手 provides AI-assisted local productivity features. AI output may
be incomplete, inaccurate, or unsuitable for a particular purpose.

Users are responsible for their inputs, configured providers, local commands,
installed skills, installed plugins, MCP servers, and use of generated output.

Third-party model providers and external services configured by the user are
governed by their own terms.

Commercial licensing, enterprise deployment, support, and warranties may be
governed by a separate written agreement.
```

- [ ] **Step 5: Create or update `SECURITY.md`**

Use this content as the starting point:

```md
# Security

Report security issues to the official support channel listed on
https://www.yuzhh.com.

The local-first release disables remote marketplaces and automatic update
checks by default.

Do not install untrusted skills, plugins, or MCP servers. The runtime can read
files, execute commands, and connect to networks when granted permission or
configured to do so.
```

- [ ] **Step 6: Review legal language before public release**

Before public commercial distribution, have counsel review `PRIVACY.md`,
`TERMS.md`, `NOTICE.md`, and `THIRD_PARTY_NOTICES.md`.

---

## Task 6: Add In-App Legal And Open-Source Entry Points

**Files:**

- Locate with: `rg -n "服务条款|隐私|开源|关于|About|terms|privacy|license|export logs|导出日志" src/renderer src/main`
- Modify relevant renderer component and i18n files.

- [ ] **Step 1: Locate current legal/about UI**

Run:

```bash
rg -n "服务条款|隐私|开源|关于|About|terms|privacy|license|导出日志|版权所有" src/renderer src/main
```

Expected: identify the settings/about/footer component and i18n keys.

- [ ] **Step 2: Add i18n keys**

In `src/renderer/services/i18n.ts`, add both Chinese and English keys for:

```ts
legalNotice: '法律声明',
openSourceLicenses: '开源许可',
privacyPolicy: '隐私政策',
termsOfUse: '服务条款',
runtimeOpenSourceNotice: '宇智汇和运行时包含 OpenClaw 开源组件，OpenClaw 基于 MIT License 授权。',
```

Use the existing i18n object style in that file.

- [ ] **Step 3: Add UI links or buttons**

In the located settings/about component, add entries that open local legal documents or display their content:

```tsx
<button type="button" onClick={() => openLegalDocument('NOTICE.md')}>
  {t('legalNotice')}
</button>
<button type="button" onClick={() => openLegalDocument('THIRD_PARTY_NOTICES.md')}>
  {t('openSourceLicenses')}
</button>
<button type="button" onClick={() => openLegalDocument('PRIVACY.md')}>
  {t('privacyPolicy')}
</button>
<button type="button" onClick={() => openLegalDocument('TERMS.md')}>
  {t('termsOfUse')}
</button>
```

If the app already uses a standard external-link helper, use that existing helper instead of introducing a new pattern.

- [ ] **Step 4: Run renderer tests or build**

Run:

```bash
npm run build
```

Expected: PASS.

---

## Task 7: Add Release Branding Scan

**Files:**

- Create: `scripts/check-release-branding.cjs`
- Modify: `package.json`

- [ ] **Step 1: Create the scan script**

Create `scripts/check-release-branding.cjs`:

```js
const fs = require('node:fs');
const path = require('node:path');

const roots = ['src', 'scripts', 'electron-builder.json', 'package.json', 'README.md', 'README_zh.md'];

const forbidden = [
  {
    pattern: /\bResources\/cfmind\b|\bresources\/cfmind\b/g,
    message: 'Packaged runtime path must use yuzhh-runtime, not cfmind.',
  },
  {
    pattern: /lobsterai-server\.youdao|api-overmind\.youdao|rlogs\.youdao/g,
    message: 'Legacy Youdao/LobsterAI cloud endpoints must stay disabled.',
  },
];

const allowedCfmindFiles = new Set([
  path.normalize('src/shared/branding/constants.ts'),
  path.normalize('src/shared/branding/constants.test.ts'),
]);

function walk(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target).flatMap((entry) => {
    if (['node_modules', 'dist', 'dist-electron', 'release', 'vendor'].includes(entry)) {
      return [];
    }
    return walk(path.join(target, entry));
  });
}

let failed = false;

for (const file of roots.flatMap(walk)) {
  const normalized = path.normalize(file);
  const content = fs.readFileSync(file, 'utf8');

  if (content.includes('cfmind') && !allowedCfmindFiles.has(normalized)) {
    console.error(`${file}: unexpected cfmind reference`);
    failed = true;
  }

  for (const rule of forbidden) {
    if (rule.pattern.test(content)) {
      console.error(`${file}: ${rule.message}`);
      failed = true;
    }
    rule.pattern.lastIndex = 0;
  }
}

if (failed) {
  process.exit(1);
}

console.log('Release branding scan passed.');
```

- [ ] **Step 2: Add package script**

In `package.json`, add:

```json
"check:release-branding": "node scripts/check-release-branding.cjs"
```

Place it near the existing check/build scripts and preserve JSON formatting.

- [ ] **Step 3: Run the scan**

Run:

```bash
npm run check:release-branding
```

Expected: PASS after intentional compatibility exceptions are captured in the script.

---

## Task 8: Add macOS/Windows Release Checklist

**Files:**

- Create: `docs/release/mac-windows-release-checklist.md`

- [ ] **Step 1: Add release checklist**

Create `docs/release/mac-windows-release-checklist.md`:

```md
# macOS and Windows Release Checklist

## Scope

This checklist is for the first commercial release of 宇智汇和 AI 助手.
Automatic updates are disabled. Users download new versions manually from the
official website.

## Before Packaging

- Confirm product name is 宇智汇和 AI 助手.
- Confirm publisher is 宇智汇和（东莞）科技有限公司.
- Confirm app ID is com.yuzhh.ai-assistant.
- Confirm runtime display name is 宇智汇和运行时 / Yuzhh Runtime.
- Run `npm test -- src/shared/branding/constants.test.ts`.
- Run `npm run check:release-branding`.
- Run `npm run compile:electron`.
- Run `npm run build`.

## macOS Unsigned Test Package

- Run `npm run dist:mac` in local packaging mode.
- Confirm the app launches.
- Confirm the app does not require login on first launch.
- Confirm the bundled runtime starts.
- Confirm `Contents/Resources/yuzhh-runtime` exists.
- Confirm `Contents/Resources/cfmind` does not exist.

## macOS Signed Release Package

- Provide Apple Developer ID signing credentials through environment variables
  or CI secrets.
- Build the DMG.
- Confirm hardened runtime is enabled.
- Notarize the app.
- Staple the notarization result.
- Test launch on a clean macOS machine.

## Windows Unsigned Test Package

- Run `npm run dist:win`.
- Install the generated setup executable on a Windows test machine.
- Confirm the app launches.
- Confirm the app does not require login on first launch.
- Confirm `resources/yuzhh-runtime` exists.
- Confirm `resources/cfmind` does not exist.

## Windows Signed Release Package

- Provide Windows signing credentials through environment variables or CI
  secrets.
- Build the signed setup executable.
- Confirm the application executable is signed.
- Confirm the installer is signed.
- Confirm the uninstaller is signed.
- Test install, launch, and uninstall on a clean Windows machine.

## Legal

- Confirm NOTICE.md is packaged.
- Confirm THIRD_PARTY_NOTICES.md is packaged.
- Confirm PRIVACY.md is packaged.
- Confirm TERMS.md is packaged.
- Confirm SECURITY.md is packaged.
- Confirm OpenClaw MIT notice is visible in the app.

## Manual Download Update Policy

- Confirm automatic update checks are disabled.
- Confirm the download link points to https://www.yuzhh.com/download.
- Confirm release notes are available on the official website.
```

- [ ] **Step 2: Review checklist for platform gaps**

Compare the checklist with current `package.json` scripts. Add any existing project-specific command names that differ
from `npm run dist:mac` or `npm run dist:win`.

---

## Task 9: Final Verification

**Files:**

- All touched files from previous tasks.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- src/shared/branding/constants.test.ts src/main/libs/openclawEngineManager.test.ts src/renderer/services/endpoints.test.ts src/main/libs/appUpdateCoordinator.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run release scan**

Run:

```bash
npm run check:release-branding
```

Expected: PASS.

- [ ] **Step 3: Run touched-file lint**

Run ESLint on all touched TypeScript and TSX files:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/branding/constants.ts src/shared/branding/constants.test.ts src/main/libs/openclawEngineManager.ts src/main/libs/openclawEngineManager.test.ts src/renderer/services/i18n.ts
```

Expected: PASS. If the about/settings component is touched, include that file in the command.

- [ ] **Step 4: Compile Electron code**

Run:

```bash
npm run compile:electron
```

Expected: PASS.

- [ ] **Step 5: Build renderer**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Inspect diff**

Run:

```bash
git diff --stat
git diff -- docs/archive/superpowers/2026-07/specs/2026-07-02-two-layer-runtime-release-design.md docs/archive/superpowers/2026-07/plans/2026-07-02-two-layer-runtime-release.md
```

Expected: changes are scoped to runtime branding, packaging, legal documents, release checks, and docs.

---

## Self-Review

- Spec coverage: runtime branding, packaged directory, legal files, macOS/Windows release strategy, disabled updates,
  and verification are covered by Tasks 1-9.
- Placeholder scan: no task uses TBD/TODO language. Legal text is a concrete starter version with explicit counsel
  review before public release.
- Type consistency: `ProductBrand`, `RuntimeBrand`, and `DistributionBrand` names are consistent across tasks.
- Scope check: source-level OpenClaw fork rename is intentionally excluded.
