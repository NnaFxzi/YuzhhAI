# Calm Brand Startup Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current OpenClaw startup overlay with a restrained, brand-aware full-screen launch state.

**Architecture:** Keep the existing `EngineStartupOverlay` component and status subscription flow. Remove the rotating
tip-card behavior, simplify the UI to a centered brand mark, title, subtitle, progress row, slow-start hint, and footer.
Add/adjust i18n keys so user-facing copy avoids internal implementation terms.

**Tech Stack:** React, TypeScript, Tailwind, existing `i18nService`, existing OpenClaw engine status IPC via
`coworkService`.

---

### Task 1: Update Startup Overlay UI

**Files:**

- Modify: `src/renderer/components/cowork/EngineStartupOverlay.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Replace tip rotation state with startup copy helpers**

In `src/renderer/components/cowork/EngineStartupOverlay.tsx`, remove the `LightBulbIcon` import, `TIP_KEYS`,
`TIP_ROTATE_MS`, and `tipIndex` state. Add a status label resolver that keeps internal status names out of the UI:

```ts
const resolveEngineStatusLabel = (status: OpenClawEngineStatus): string => {
  if (status.phase === 'starting') {
    return i18nService.t('engineStartingStatusConnecting');
  }

  return resolveEngineStatusText(status);
};
```

- [ ] **Step 2: Keep only slow-hint timing in the startup effect**

Update the `useEffect` tied to `isStarting` so it only manages the slow-start timer:

```ts
  useEffect(() => {
    if (!isStarting) {
      setShowSlowHint(false);
      return;
    }

    const slowHintTimer = setTimeout(() => {
      setShowSlowHint(true);
    }, SLOW_HINT_AFTER_MS);

    return () => {
      clearTimeout(slowHintTimer);
    };
  }, [isStarting]);
```

- [ ] **Step 3: Replace the JSX with the calm professional launch screen**

Keep the existing `progressPercent` calculation. Replace the returned JSX with:

```tsx
  const progressWidth = progressPercent !== null
    ? `${Math.max(progressPercent, 4)}%`
    : '36%';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#090D14] animate-fade-in">
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_22%,rgba(59,130,246,0.18),transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.55),rgba(9,13,20,0.96))]"
        aria-hidden="true"
      />
      <div
        className="absolute inset-6 rounded-2xl border border-white/[0.06] sm:inset-8 sm:rounded-[24px]"
        aria-hidden="true"
      />

      <div className="relative z-10 flex w-full max-w-[420px] flex-col items-center px-6 text-center" role="status" aria-live="polite">
        <div className="relative">
          <div className="absolute -inset-4 rounded-[28px] bg-primary/10 blur-2xl" aria-hidden="true" />
          <div className="relative flex h-[76px] w-[76px] items-center justify-center rounded-[22px] border border-primary/30 bg-surface-raised shadow-[0_24px_70px_rgba(0,0,0,0.36)]">
            <img
              src="logo.png"
              alt={i18nService.t('appName')}
              width={44}
              height={44}
              className="select-none rounded-xl"
              draggable={false}
            />
          </div>
        </div>

        <h1 className="mt-7 text-[25px] font-semibold leading-8 tracking-normal text-foreground">
          {i18nService.t('engineStartingTitle')}
        </h1>
        <p className="mt-2 text-sm leading-6 text-secondary">
          {i18nService.t('engineStartingSubtitle')}
        </p>

        <div className="mt-8 w-full max-w-[282px]">
          <div className="mb-2 flex min-h-[18px] items-center justify-between gap-4 text-xs">
            <span className="truncate text-secondary">{resolveEngineStatusLabel(status)}</span>
            {progressPercent !== null && (
              <span className="shrink-0 tabular-nums text-foreground/80">{progressPercent}%</span>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 shadow-[0_0_22px_rgba(96,165,250,0.24)] transition-all duration-500 ease-smooth"
              style={{ width: progressWidth }}
            >
              <div
                className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/35 to-transparent"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>

        <div className="mt-7 min-h-[58px] w-full max-w-[330px]">
          <div
            className={`rounded-xl border border-white/[0.08] bg-surface-raised/45 px-4 py-3 text-left transition-opacity duration-500 ${
              showSlowHint ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <p className="text-xs font-medium leading-5 text-foreground/85">
              {i18nService.t('engineStartingSlowHintTitle')}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-muted">
              {i18nService.t('engineStartingSlowHint')}
            </p>
          </div>
        </div>
      </div>

      <div className="absolute bottom-6 left-0 right-0 text-center text-xs text-muted/70">
        {i18nService.t('appName')}
      </div>
    </div>
  );
```

- [ ] **Step 4: Add and update i18n keys**

In `src/renderer/services/i18n.ts`, update Chinese keys:

```ts
    engineStartingTitle: '正在打开工作台',
    engineStartingSubtitle: '准备模型、技能和本地工作空间',
    engineStartingStatusConnecting: '连接工作引擎',
    engineStartingSlowHintTitle: '准备期间你可以稍等片刻',
    engineStartingSlowHint: '首次启动可能需要更久，后续会更快。',
```

Update English keys:

```ts
    engineStartingTitle: 'Opening your workbench',
    engineStartingSubtitle: 'Preparing models, skills, and the local workspace',
    engineStartingStatusConnecting: 'Connecting the work engine',
    engineStartingSlowHintTitle: 'This can take a moment',
    engineStartingSlowHint: 'First launch may take longer. Future launches are usually faster.',
```

Keep existing `engineStartingTip*` keys for now if other code references them are not removed everywhere in this same
edit; remove them only if TypeScript and searches confirm no references remain.

- [ ] **Step 5: Run targeted checks**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/cowork/EngineStartupOverlay.tsx src/renderer/services/i18n.ts
```

Expected: exits successfully with no warnings.

- [ ] **Step 6: Review diff**

Run:

```bash
git diff -- src/renderer/components/cowork/EngineStartupOverlay.tsx src/renderer/services/i18n.ts docs/archive/superpowers/2026-07/specs/2026-07-02-calm-brand-startup-overlay-design.md docs/archive/superpowers/2026-07/plans/2026-07-02-calm-brand-startup-overlay.md
```

Expected: diff only contains the startup overlay design, plan, and targeted i18n changes.

Do not commit. Repository instructions require waiting for user testing and confirmation before committing.

