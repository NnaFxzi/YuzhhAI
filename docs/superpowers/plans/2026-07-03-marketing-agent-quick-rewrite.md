# Marketing Agent Quick Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lightweight quick-rewrite chips for `marketing-agent` sessions so users can turn the latest generated copy into owner tone, WeChat group short copy, 1688 titles, or Baidu SEO long-form content with one click.

**Architecture:** Keep the first version renderer-only and prompt-driven. A pure helper decides whether rewrite chips should appear and builds safe continuation prompts; `CoworkSessionDetail` renders the chips above the existing prompt input and sends the selected prompt through the existing `onContinue` flow. No database schema, IPC contract, or OpenClaw runtime changes are needed.

**Tech Stack:** TypeScript, React, Redux-backed Cowork session state, existing Vitest setup, existing renderer i18n service.

---

## Scope

This plan implements the first quick-rewrite experience only:

- Show rewrite chips only for `marketing-agent` sessions.
- Show chips only when the session is not busy and the latest assistant message has content.
- Send a concise continuation prompt that tells the model to reuse the previous output and preserve fact-protection rules.
- Do not parse or store structured copies yet.
- Do not add a factory-profile editor or positioning report card in this phase.

The repository instruction says not to create commits until the user has tested and confirmed, so this plan intentionally omits commit steps.

## File Structure

- Create `src/shared/agent/managedPresetAgents.ts`
  - Owns shared managed preset agent IDs, starting with `Marketing`.
- Modify `src/main/presetAgents.ts`
  - Imports `ManagedPresetAgentId` from shared code instead of declaring the same discriminant locally.
- Create `src/renderer/components/cowork/marketingRewriteActions.ts`
  - Pure helper for visibility and rewrite prompt construction.
- Create `src/renderer/components/cowork/marketingRewriteActions.test.ts`
  - Tests marketing-agent gating, busy-state gating, assistant-content gating, and prompt wording.
- Create `src/renderer/components/cowork/MarketingRewriteChips.tsx`
  - Small presentational component for the chips.
- Modify `src/renderer/components/cowork/CoworkSessionDetail.tsx`
  - Finds the latest assistant message, asks the helper for actions, renders chips above `CoworkPromptInput`, and calls `onContinue(action.prompt)` on click.
- Modify `src/renderer/services/i18n.ts`
  - Adds Chinese and English labels for the chip section and four actions.

---

### Task 1: Share The Marketing Agent ID

**Files:**
- Create: `src/shared/agent/managedPresetAgents.ts`
- Modify: `src/main/presetAgents.ts`
- Test: `src/main/agentManager.test.ts`

- [ ] **Step 1: Write the shared constant file**

Create `src/shared/agent/managedPresetAgents.ts`:

```ts
export const ManagedPresetAgentId = {
  Marketing: 'marketing-agent',
} as const;

export type ManagedPresetAgentId =
  typeof ManagedPresetAgentId[keyof typeof ManagedPresetAgentId];
```

- [ ] **Step 2: Update the preset agent module to import the shared constant**

In `src/main/presetAgents.ts`, add this import near the other shared imports:

```ts
import { ManagedPresetAgentId } from '../shared/agent/managedPresetAgents';
```

Remove the local block:

```ts
export const ManagedPresetAgentId = {
  Marketing: 'marketing-agent',
} as const;

export type ManagedPresetAgentId = typeof ManagedPresetAgentId[keyof typeof ManagedPresetAgentId];
```

Keep the existing `AUTO_INSTALLED_PRESET_AGENT_IDS` definition:

```ts
export const AUTO_INSTALLED_PRESET_AGENT_IDS: ManagedPresetAgentId[] = [
  ManagedPresetAgentId.Marketing,
];
```

- [ ] **Step 3: Run the preset-agent test**

Run:

```bash
npm test -- src/main/agentManager.test.ts
```

Expected: all tests in `src/main/agentManager.test.ts` pass.

- [ ] **Step 4: Run changed-file lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/agent/managedPresetAgents.ts src/main/presetAgents.ts src/main/agentManager.test.ts
```

Expected: exit code 0, no warnings.

---

### Task 2: Build Rewrite Action Prompt Logic

**Files:**
- Create: `src/renderer/components/cowork/marketingRewriteActions.ts`
- Create: `src/renderer/components/cowork/marketingRewriteActions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/components/cowork/marketingRewriteActions.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import {
  buildMarketingRewriteActions,
  MarketingRewriteActionId,
} from './marketingRewriteActions';

describe('buildMarketingRewriteActions', () => {
  test('returns no actions outside marketing-agent sessions', () => {
    const actions = buildMarketingRewriteActions({
      agentId: 'main',
      isBusy: false,
      latestAssistantContent: '朋友圈文案：正文',
    });

    expect(actions).toEqual([]);
  });

  test('returns no actions while a session is busy', () => {
    const actions = buildMarketingRewriteActions({
      agentId: 'marketing-agent',
      isBusy: true,
      latestAssistantContent: '朋友圈文案：正文',
    });

    expect(actions).toEqual([]);
  });

  test('returns no actions without assistant content to rewrite', () => {
    const actions = buildMarketingRewriteActions({
      agentId: 'marketing-agent',
      isBusy: false,
      latestAssistantContent: '   ',
    });

    expect(actions).toEqual([]);
  });

  test('builds focused rewrite prompts for the latest assistant output', () => {
    const actions = buildMarketingRewriteActions({
      agentId: 'marketing-agent',
      isBusy: false,
      latestAssistantContent: '朋友圈文案：正文',
    });

    expect(actions.map(action => action.id)).toEqual([
      MarketingRewriteActionId.OwnerTone,
      MarketingRewriteActionId.WeChatGroupShort,
      MarketingRewriteActionId.Alibaba1688Title,
      MarketingRewriteActionId.BaiduSeoLongForm,
    ]);
    expect(actions[0].prompt).toContain('基于你上一条输出');
    expect(actions[0].prompt).toContain('老板口吻');
    expect(actions[0].prompt).toContain('不要新增没有证据的硬事实');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/renderer/components/cowork/marketingRewriteActions.test.ts
```

Expected: FAIL because `marketingRewriteActions.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/renderer/components/cowork/marketingRewriteActions.ts`:

```ts
import { ManagedPresetAgentId } from '../../../shared/agent/managedPresetAgents';

export const MarketingRewriteActionId = {
  OwnerTone: 'owner_tone',
  WeChatGroupShort: 'wechat_group_short',
  Alibaba1688Title: '1688_title',
  BaiduSeoLongForm: 'baidu_seo_long_form',
} as const;

export type MarketingRewriteActionId =
  typeof MarketingRewriteActionId[keyof typeof MarketingRewriteActionId];

export interface MarketingRewriteAction {
  id: MarketingRewriteActionId;
  labelKey: string;
  prompt: string;
}

interface BuildMarketingRewriteActionsOptions {
  agentId?: string | null;
  isBusy: boolean;
  latestAssistantContent?: string | null;
}

const buildRewritePrompt = (target: string): string => (
  `基于你上一条输出的可直接复制正文，改写成${target}。`
  + '请沿用同一工厂画像、产品、客户行业、卖点和渠道；'
  + '不要新增没有证据的硬事实，不要编造承重、交期、认证、价格、产能或服务区域；'
  + '如果上一条信息不足，请用保守表达，并只给出可直接使用的改写结果。'
);

export function buildMarketingRewriteActions(
  options: BuildMarketingRewriteActionsOptions,
): MarketingRewriteAction[] {
  if (options.agentId !== ManagedPresetAgentId.Marketing) return [];
  if (options.isBusy) return [];
  if (!options.latestAssistantContent?.trim()) return [];

  return [
    {
      id: MarketingRewriteActionId.OwnerTone,
      labelKey: 'marketingRewriteOwnerTone',
      prompt: buildRewritePrompt('老板口吻'),
    },
    {
      id: MarketingRewriteActionId.WeChatGroupShort,
      labelKey: 'marketingRewriteWeChatGroupShort',
      prompt: buildRewritePrompt('微信群短句版'),
    },
    {
      id: MarketingRewriteActionId.Alibaba1688Title,
      labelKey: 'marketingRewrite1688Title',
      prompt: buildRewritePrompt('1688 标题版'),
    },
    {
      id: MarketingRewriteActionId.BaiduSeoLongForm,
      labelKey: 'marketingRewriteBaiduSeoLongForm',
      prompt: buildRewritePrompt('百度 SEO 长文版'),
    },
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- src/renderer/components/cowork/marketingRewriteActions.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Run changed-file lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/cowork/marketingRewriteActions.ts src/renderer/components/cowork/marketingRewriteActions.test.ts
```

Expected: exit code 0, no warnings.

---

### Task 3: Render Rewrite Chips In Marketing Sessions

**Files:**
- Create: `src/renderer/components/cowork/MarketingRewriteChips.tsx`
- Modify: `src/renderer/components/cowork/CoworkSessionDetail.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Add i18n strings**

In the Chinese dictionary in `src/renderer/services/i18n.ts`, add:

```ts
marketingRewriteTitle: '快捷改写',
marketingRewriteOwnerTone: '老板口吻',
marketingRewriteWeChatGroupShort: '微信群短句',
marketingRewrite1688Title: '1688 标题',
marketingRewriteBaiduSeoLongForm: '百度 SEO 长文',
```

In the English dictionary, add:

```ts
marketingRewriteTitle: 'Quick rewrite',
marketingRewriteOwnerTone: 'Owner tone',
marketingRewriteWeChatGroupShort: 'WeChat group short',
marketingRewrite1688Title: '1688 titles',
marketingRewriteBaiduSeoLongForm: 'Baidu SEO long-form',
```

- [ ] **Step 2: Create the chip component**

Create `src/renderer/components/cowork/MarketingRewriteChips.tsx`:

```tsx
import React from 'react';
import { WandSparkles } from 'lucide-react';

import { i18nService } from '../../services/i18n';
import type { MarketingRewriteAction } from './marketingRewriteActions';

interface MarketingRewriteChipsProps {
  actions: MarketingRewriteAction[];
  onSelect: (action: MarketingRewriteAction) => void;
}

const MarketingRewriteChips: React.FC<MarketingRewriteChipsProps> = ({
  actions,
  onSelect,
}) => {
  if (actions.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 px-1 text-xs">
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <WandSparkles className="h-3.5 w-3.5" aria-hidden="true" />
        {i18nService.t('marketingRewriteTitle')}
      </span>
      {actions.map(action => (
        <button
          key={action.id}
          type="button"
          className="rounded-full border border-border bg-surface px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={() => onSelect(action)}
        >
          {i18nService.t(action.labelKey)}
        </button>
      ))}
    </div>
  );
};

export default MarketingRewriteChips;
```

- [ ] **Step 3: Import the helper and component**

In `src/renderer/components/cowork/CoworkSessionDetail.tsx`, add imports near the existing cowork component imports:

```ts
import MarketingRewriteChips from './MarketingRewriteChips';
import {
  buildMarketingRewriteActions,
  type MarketingRewriteAction,
} from './marketingRewriteActions';
```

- [ ] **Step 4: Compute latest assistant content and actions**

Inside `CoworkSessionDetail`, after `isSessionBusy` and `currentSession` are available, add:

```ts
const latestAssistantContent = useMemo(() => {
  const messages = currentSession?.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.type === 'assistant'
      && !message.metadata?.isThinking
      && message.content.trim()
    ) {
      return message.content;
    }
  }
  return '';
}, [currentSession?.messages]);

const marketingRewriteActions = useMemo(() => (
  buildMarketingRewriteActions({
    agentId: currentSession?.agentId,
    isBusy: isSessionBusy,
    latestAssistantContent,
  })
), [currentSession?.agentId, isSessionBusy, latestAssistantContent]);
```

- [ ] **Step 5: Add the click handler**

In `CoworkSessionDetail`, near other callbacks, add:

```ts
const handleMarketingRewriteSelect = useCallback(async (action: MarketingRewriteAction) => {
  if (isSessionBusy || currentSession?.status === CoworkSessionStatusValue.Running) {
    window.dispatchEvent(new CustomEvent('app:showToast', {
      detail: i18nService.t('coworkSessionStillRunning'),
    }));
    return;
  }
  await onContinue(action.prompt);
}, [currentSession?.status, isSessionBusy, onContinue]);
```

- [ ] **Step 6: Render chips above the prompt input**

In the bottom prompt area of `CoworkSessionDetail`, immediately before `<CoworkPromptInput ... />`, add:

```tsx
<MarketingRewriteChips
  actions={marketingRewriteActions}
  onSelect={handleMarketingRewriteSelect}
/>
```

The result should look like:

```tsx
<div className={COWORK_DETAIL_CONTENT_CLASS}>
  <MarketingRewriteChips
    actions={marketingRewriteActions}
    onSelect={handleMarketingRewriteSelect}
  />
  <CoworkPromptInput
    ref={promptInputRef}
    onSubmit={onContinue}
    onStop={onStop}
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm test -- src/renderer/components/cowork/marketingRewriteActions.test.ts src/main/agentManager.test.ts
```

Expected: both test files pass.

- [ ] **Step 8: Run changed-file lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/agent/managedPresetAgents.ts src/main/presetAgents.ts src/main/agentManager.test.ts src/renderer/components/cowork/marketingRewriteActions.ts src/renderer/components/cowork/marketingRewriteActions.test.ts src/renderer/components/cowork/MarketingRewriteChips.tsx src/renderer/components/cowork/CoworkSessionDetail.tsx src/renderer/services/i18n.ts
```

Expected: exit code 0, no warnings.

---

### Task 4: Final Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run the focused test suite**

Run:

```bash
npm test -- src/renderer/components/cowork/marketingRewriteActions.test.ts src/main/agentManager.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run changed-file lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/agent/managedPresetAgents.ts src/main/presetAgents.ts src/main/agentManager.test.ts src/renderer/components/cowork/marketingRewriteActions.ts src/renderer/components/cowork/marketingRewriteActions.test.ts src/renderer/components/cowork/MarketingRewriteChips.tsx src/renderer/components/cowork/CoworkSessionDetail.tsx src/renderer/services/i18n.ts
```

Expected: exit code 0, no warnings.

- [ ] **Step 3: Run the renderer build if lint and focused tests pass**

Run:

```bash
npm run build
```

Expected: production renderer bundle succeeds.

- [ ] **Step 4: Manually validate in the app**

Run the app with the normal dev command:

```bash
npm run electron:dev
```

Manual checks:

- Select “推广agent”.
- Ask it to generate a WeChat Moments post.
- Wait for the assistant response to finish.
- Confirm the quick-rewrite chips appear above the prompt input.
- Click “老板口吻”.
- Confirm a continuation is sent and the new output rewrites the previous copy without inventing hard facts.
- Switch to the main agent and confirm the chips do not appear.
- Start a response and confirm chips are hidden while the session is running.

---

## Self-Review

- **Spec coverage:** The plan covers the approved next phase: quick rewrite for marketing agent sessions. It intentionally does not include factory-profile editing or positioning report cards.
- **Placeholder scan:** No task uses TBD/TODO/implement-later language. Each code task includes concrete code and commands.
- **Type consistency:** `MarketingRewriteActionId`, `MarketingRewriteAction`, and `buildMarketingRewriteActions` are defined in Task 2 and reused consistently in Task 3.
