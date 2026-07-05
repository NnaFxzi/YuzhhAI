# Agent Edit Interaction Design

## Goal

Improve the Agent edit/create experience for Skills and External Research with a simple, efficient flow. The user should
be able to understand current capability state at a glance, choose useful skills faster, and configure research sources
with fewer clicks.

## Scope

This change updates shared renderer components used by both Agent creation and Agent editing:

- `AgentSkillSelector`
- `AgentExternalResearchPanel`
- `AgentDomesticResearchSourcesPanel`
- i18n strings used by those components
- focused pure UI helper tests where behavior can be isolated

This change does not alter persisted data structures, main process APIs, or the overall Agent modal navigation.

## Skill Selector Design

The skill selector will become a compact selection workspace instead of a large card grid.

Planned behavior:

- Show selected skills at the top as removable chips.
- Keep the existing meaning that no selected skills means the Agent can use all enabled skills.
- Add quick filters: all, selected, recommended for promotion agents, built-in, and custom.
- Keep search, but make it search skill name and localized description.
- Replace large cards with compact rows that show name, badge, description, and selected state.
- Keep empty states for no enabled skills and no search/filter matches.

The lightweight recommendation filter is local UI logic only. It should surface likely useful skills for
promotion/research use cases, such as web search, browser, document, spreadsheet, image, or research-related skills,
based on existing skill id/name/description matching. It is not a new capability-pack system.

## External Research Design

The external research panel will lead with a status summary before configuration controls.

Planned behavior:

- Show summary tiles for research mode, provider readiness, and domestic source count.
- Replace the current large mode cards with a compact segmented choice for inherit, override, and disabled.
- Keep provider API key controls collapsed unless override mode is active.
- Preserve existing test, show/hide, clear, and enable controls for Tavily and Firecrawl.
- Make provider readiness easier to scan by showing configured/unconfigured state in summary and provider rows.

## Domestic Research Source Design

The domestic source panel will keep the existing platform cards but add faster bulk actions.

Planned behavior:

- Keep source status labels and link import controls.
- Add bulk actions: enable recommended sources, enable all, and disable all.
- Recommended domestic sources should prefer sources with automatic search support and keep link-import-only sources
  available for manual enabling.
- Keep custom link sources unchanged except for visual alignment with the refined panel.

## Internationalization

All new user-visible strings must be added in both Chinese and English in `src/renderer/services/i18n.ts`.

## Testing And Verification

Implementation should include focused tests for pure helper logic, such as:

- skill filter classification and recommended matching
- domestic source bulk selection helpers
- external research summary derivation if extracted

Manual verification should cover:

- opening Agent edit and create flows
- switching to Skills and External Research tabs
- filtering and selecting/removing skills
- switching external research modes
- testing provider controls in override mode
- applying domestic source bulk actions

Changed TypeScript files must pass the repository's touched-file ESLint command.

## Non-Goals

- No new persisted settings.
- No new main/preload IPC.
- No ability-pack marketplace or template system.
- No large modal navigation rewrite.
- No broad visual redesign outside these shared panels.
