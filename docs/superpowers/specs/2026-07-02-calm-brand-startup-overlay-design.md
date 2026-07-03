# Calm Brand Startup Overlay Design

## Goal

Improve the first-screen loading experience by replacing the current busy startup overlay with a restrained, brand-aware full-screen launch state.

The chosen direction is **calm professional**: quiet, layered, lightly branded, and durable for everyday use.

## Scope

Update the renderer startup overlay only:

- `src/renderer/components/cowork/EngineStartupOverlay.tsx`
- related i18n strings in `src/renderer/services/i18n.ts` if new user-facing copy is needed
- relevant targeted tests or lint verification for touched files

Do not change:

- OpenClaw startup sequencing
- gateway health checks
- Cowork runtime routing
- app window creation timing
- workbench home layout

## Experience

When the OpenClaw engine status is `starting`, the app shows a full-screen startup page that fully covers the current view. The page should feel like a product launch screen, not a diagnostic panel.

The screen contains:

- a subtle dark background with low-contrast depth
- a small centered brand mark using existing local logo assets or a restrained AI mark if the existing logo does not fit cleanly
- a primary title such as “正在打开工作台”
- a secondary line explaining that models, skills, and the local workspace are being prepared
- one progress row with the current startup stage and percentage
- a compact slow-start hint after the existing delay threshold
- the app name as a quiet footer

The current rotating tip card should be removed from this overlay. It adds visual weight and makes the launch state feel more like a modal than a startup screen.

## Copy

Avoid implementation terms in the UI. The user should not see internal names such as OpenClaw, gateway, or runtime.

Preferred Chinese copy:

- Title: `正在打开工作台`
- Subtitle: `准备模型、技能和本地工作空间`
- Status fallback: `连接工作引擎`
- Slow hint: keep the existing meaning, but phrase it as a calm user-facing note

English copy should preserve the same tone:

- Title: `Opening your workbench`
- Subtitle: `Preparing models, skills, and the local workspace`
- Status fallback: `Connecting the work engine`

## Visual Rules

Use existing Tailwind tokens where possible:

- dark background from existing surface/background tokens
- restrained blue/green accent for progress only
- no decorative orbs or heavy gradients
- no card nested inside another card
- stable dimensions for logo, progress area, and hint area to avoid layout shifts
- keep border radius consistent with the app, around 8-16px depending on element size

Animation should stay subtle:

- fade in the overlay
- softly animate progress changes
- optional low-opacity shimmer in the progress bar only

## Behavior

Keep current behavior:

- render only when status exists and phase is `starting`
- use `progressPercent` when available
- clamp progress from 0 to 100
- show the slow hint after `SLOW_HINT_AFTER_MS`
- return `null` when the engine is not starting

The overlay remains above all views with the existing high z-index.

## Error Handling

This design does not add a new error state. Existing error handling and banners remain unchanged. If startup transitions from `starting` to `error`, the overlay disappears as it does today and the existing error UI handles the condition.

## Testing And Verification

Verification should include:

- TypeScript/ESLint on touched TypeScript/TSX files
- visual check in dark mode at desktop size
- confirm long localized strings do not overflow
- confirm progress and slow hint do not shift the center layout

If a full Electron run is too heavy, at minimum verify by running targeted lint and inspecting the component structure. Manual Electron validation is preferred because this is a startup visual state.

