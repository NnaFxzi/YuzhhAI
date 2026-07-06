# Build Warning Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the known Vite CJS Node API and lottie-web eval build warnings without changing product behavior.

**Architecture:** Keep the app's package format unchanged and make only targeted build-path changes. Vite config will
run as explicit ESM, the legacy dev script will stop requiring Vite through CommonJS, and the renderer bundle will
resolve `lottie-web` to the light player that does not contain the eval-based expression engine.

**Tech Stack:** Vite 5, Rollup, Electron renderer, Vitest, lottie-react/lottie-web.

---

### Task 1: Add Build Warning Regression Coverage

**Files:**

- Create: `tests/build-warning-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const rootDir = resolve(__dirname, '..');

function readProjectFile(relativePath: string): string {
  return readFileSync(resolve(rootDir, relativePath), 'utf8');
}

describe('build warning configuration', () => {
  test('legacy dev script loads Vite through ESM instead of require', () => {
    const script = readProjectFile('scripts/dev.js');

    expect(script).not.toContain("require('vite')");
    expect(script).toContain("import('vite')");
  });

  test('Vite aliases lottie-web to the light player without eval', () => {
    const config = readProjectFile('vite.config.mts');
    const lightPlayer = readProjectFile('node_modules/lottie-web/build/player/lottie_light.js');

    expect(config).toContain("'lottie-web': 'lottie-web/build/player/lottie_light.js'");
    expect(lightPlayer).not.toMatch(/\beval\s*\(/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/build-warning-config.test.ts`

Expected: FAIL because `scripts/dev.js` still contains `require('vite')` and `vite.config.mts` does not exist yet.

### Task 2: Move Vite Config To Explicit ESM

**Files:**

- Rename: `vite.config.ts` -> `vite.config.mts`

- [ ] **Step 1: Rename the config file**

Move the existing file from `vite.config.ts` to `vite.config.mts` without changing its contents.

- [ ] **Step 2: Run build to check Vite CJS warning**

Run: `npm run build`

Expected: Vite no longer prints `The CJS build of Vite's Node API is deprecated` from the app config loading path.

### Task 3: Update Legacy Dev Script Vite Loading

**Files:**

- Modify: `scripts/dev.js`

- [ ] **Step 1: Replace CommonJS Vite API loading**

Change:

```js
const { createServer } = require('vite');
```

to:

```js
let createServer;
```

Then inside `startApp()` before `createServer()` is used:

```js
  ({ createServer } = await import('vite'));
```

- [ ] **Step 2: Run targeted test**

Run: `npm test -- tests/build-warning-config.test.ts`

Expected: The dev script assertion passes; the lottie alias assertion may still fail until Task 4 is complete.

### Task 4: Alias Lottie To Light Player

**Files:**

- Modify: `vite.config.mts`

- [ ] **Step 1: Add lottie-web alias**

Inside `resolve.alias`, add:

```ts
'lottie-web': 'lottie-web/build/player/lottie_light.js',
```

- [ ] **Step 2: Run targeted test**

Run: `npm test -- tests/build-warning-config.test.ts`

Expected: PASS.

### Task 5: Verify Build And Lint

**Files:**

- Verify: `tests/build-warning-config.test.ts`
- Verify: `scripts/dev.js`
- Verify: `vite.config.mts`

- [ ] **Step 1: Run changed-file lint**

Run: `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 tests/build-warning-config.test.ts`

Expected: PASS with no warnings.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: PASS. The previous Vite CJS and lottie eval warnings should not appear.

- [ ] **Step 3: Review final diff**

Run:
`git diff -- docs/superpowers/plans/2026-07-05-build-warning-cleanup.md tests/build-warning-config.test.ts scripts/dev.js vite.config.mts vite.config.ts`

Expected: Diff is limited to this warning cleanup.
