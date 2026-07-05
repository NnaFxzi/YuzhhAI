# Vite Warning Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the low-risk Vite warnings caused by files being both dynamically and statically imported, while
documenting follow-up paths for the dependency-level warnings.

**Architecture:** Keep helper modules that are already statically imported in the main renderer graph as static imports
everywhere. Add a source-level regression test that prevents reintroducing dynamic imports for `cowork.ts` and
`endpoints.ts`, then update the few call sites that currently use `await import(...)`.

**Tech Stack:** React renderer, TypeScript, Vitest, Vite/Rollup build warnings.

---

## Scope

This implementation pass handles the Vite warnings for mixed static/dynamic imports:

- `src/renderer/services/cowork.ts`
- `src/renderer/services/endpoints.ts`

The following warnings are intentionally not changed in this pass:

- Vite CJS Node API deprecation: likely requires dependency/config migration and should be handled separately.
- `lottie-web` `eval`: third-party package behavior; replacing it means changing animation implementation and should be
  handled separately.

## File Structure

- Create `src/renderer/services/importHygiene.test.ts`
  - Guards against dynamic imports of modules that are already in the static renderer graph.
- Modify `src/renderer/services/agent.ts`
  - Replace `await import('./cowork')` with a static import.
- Modify `src/renderer/services/auth.ts`
  - Replace dynamic `./endpoints` imports with a static import.
- Modify `src/renderer/components/ModelSelector.tsx`
  - Replace dynamic `../services/endpoints` import with a static import.
- Modify `src/renderer/components/cowork/MediaModelPicker.tsx`
  - Replace dynamic `../../services/endpoints` import with a static import.

## Task 1: Add Import Hygiene Regression Test

**Files:**

- Create: `src/renderer/services/importHygiene.test.ts`

- [x] **Step 1: Write the failing test**

Create `src/renderer/services/importHygiene.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const readSource = (relativePath: string): string => {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
};

describe('renderer import hygiene', () => {
  test('does not dynamically import cowork service from agent service', () => {
    const source = readSource('src/renderer/services/agent.ts');

    expect(source).not.toMatch(/import\(\s*['"]\.\/cowork['"]\s*\)/);
  });

  test.each([
    'src/renderer/services/auth.ts',
    'src/renderer/components/ModelSelector.tsx',
    'src/renderer/components/cowork/MediaModelPicker.tsx',
  ])('does not dynamically import endpoints from %s', (relativePath) => {
    const source = readSource(relativePath);

    expect(source).not.toMatch(/import\(\s*['"][^'"]*endpoints['"]\s*\)/);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/renderer/services/importHygiene.test.ts
```

Expected: FAIL because the current code still contains dynamic imports of `./cowork` and `endpoints`.

## Task 2: Replace Mixed Dynamic Imports With Static Imports

**Files:**

- Modify: `src/renderer/services/agent.ts`
- Modify: `src/renderer/services/auth.ts`
- Modify: `src/renderer/components/ModelSelector.tsx`
- Modify: `src/renderer/components/cowork/MediaModelPicker.tsx`

- [x] **Step 1: Update `agent.ts`**

Add:

```ts
import { coworkService } from './cowork';
```

Remove this block from `deleteAgent`:

```ts
const { coworkService } = await import('./cowork');
```

Keep:

```ts
coworkService.loadSessions(AgentId.Main);
```

- [x] **Step 2: Update `auth.ts`**

Add:

```ts
import { getLoginOvermindUrl, getPortalLoginUrl } from './endpoints';
```

Remove these dynamic imports:

```ts
const { getLoginOvermindUrl } = await import('./endpoints');
const { getPortalLoginUrl } = await import('./endpoints');
```

Call the statically imported functions directly.

- [x] **Step 3: Update `ModelSelector.tsx`**

Add:

```ts
import { getPortalPricingUrl } from '../services/endpoints';
```

Remove:

```ts
const { getPortalPricingUrl } = await import('../services/endpoints');
```

- [x] **Step 4: Update `MediaModelPicker.tsx`**

Add:

```ts
import { getPortalPricingUrl } from '../../services/endpoints';
```

Remove:

```ts
const { getPortalPricingUrl } = await import('../../services/endpoints');
```

- [x] **Step 5: Run focused test to verify it passes**

Run:

```bash
npm test -- src/renderer/services/importHygiene.test.ts
```

Expected: PASS.

## Task 3: Verification

**Files:**

- Verify modified TypeScript files.

- [x] **Step 1: Run touched-file ESLint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/services/importHygiene.test.ts src/renderer/services/agent.ts src/renderer/services/auth.ts src/renderer/components/ModelSelector.tsx src/renderer/components/cowork/MediaModelPicker.tsx
```

Expected: no output, exit 0.

- [x] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected:

- Build exits 0.
- The mixed dynamic/static import warnings for `cowork.ts` and `endpoints.ts` are gone.
- The Vite CJS Node API warning may remain.
- The `lottie-web` `eval` warning may remain.

- [x] **Step 3: Search for remaining dynamic imports**

Run:

```bash
rg -n "await import\\(.*cowork|await import\\(.*endpoints|import\\(\\s*['\"][^'\"]*endpoints['\"]\\s*\\)|import\\(\\s*['\"]\\.\\/cowork['\"]\\s*\\)" src/renderer -g "*.ts" -g "*.tsx" -g "!*.d.ts"
```

Expected: no runtime dynamic imports of `cowork` or `endpoints` remain in renderer source.

## Self-Review

- Spec coverage: The plan covers the low-risk mixed import warnings and explicitly excludes dependency/config warnings.
- Placeholder scan: No placeholder tasks remain.
- Type consistency: The imports and paths match the current source tree.
