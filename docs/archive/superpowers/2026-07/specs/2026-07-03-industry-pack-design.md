# Industry Pack Design

## Objective

Build an independent vertical-business content generation system for manufacturing
marketing. The first shipped scenario is a heavy-packaging content generator, but
the underlying mechanism must support future industry-specific assistants for
other manufacturing categories.

The system should not depend on LobsterAI's existing Agent or Skill runtime as
its user-facing product model. It may learn from their engineering patterns:
manifest-driven configuration, modular prompts, structured outputs, local
persistence, clear execution records, and explicit user confirmation before any
external action.

## Product Positioning

The first product is a content generation tool for domestic customer acquisition
in manufacturing:

> Users enter factory, product, and case information once, then generate reusable
> marketing content for channels such as WeChat Moments, WeChat groups, 1688,
> Baidu SEO pages, short videos, and referral scripts.

The first sample pack targets heavy-packaging factories, including heavy
corrugated cartons, honeycomb cartons, paper edge protectors, paper pallets,
and packaging for large parts or heavy components.

## Recommended Phasing

### Phase 1: Industry Pack Kernel

Create a generic Industry Pack mechanism that defines:

- Which fields an industry needs.
- Which products, customer scenarios, themes, tones, and channels are supported.
- How prompt modules are assembled.
- Which output schemas can be generated.
- How generated assets are saved and displayed.

This phase ships with one built-in sample pack: heavy packaging.

### Phase 2: Dedicated Industry Assistant Builder

Create a guided setup that lets users create a dedicated business assistant from
an Industry Pack. The assistant is not a free-form chat agent. It is a saved
configuration made from:

- Selected industry pack.
- Factory profile.
- Product focus.
- Target customer groups.
- Preferred channels.
- Writing tone and content constraints.

The generated assistant appears as a business workspace such as "XX Packaging
Marketing Assistant".

## Why This Order

Industry Pack is the foundation. The assistant builder is a product layer on top.
If the assistant builder is built first, industry fields, channel rules, output
schemas, and templates will drift into large prompts and become hard to reuse.

By building the pack mechanism first, future verticals such as injection molding,
CNC machining, hardware manufacturing, equipment manufacturing, and packaging
printing can reuse the same workflow.

## Core Concepts

### Industry Pack

An Industry Pack is a manifest-backed bundle of business knowledge, field
definitions, generation tasks, prompt modules, output schemas, and examples.

It should be versioned and loadable without changing the core UI flow.

### Factory Profile

The user's reusable business profile. It describes the factory's real operating
capabilities, such as products, target customers, production capacity, lead
times, service regions, certifications, cases, and contact information.

### Product Profile

A reusable product record. In the heavy-packaging sample, examples include heavy
corrugated cartons, honeycomb cartons, paper edge protectors, and paper pallets.

### Case Profile

A structured marketing case. It captures customer pain, product weight,
dimensions, transport method, original packaging problem, proposed packaging
solution, and promotional angles.

### Generation Task

A user request built from structured choices: pack, task type, period, channels,
themes, tones, products, and optional case profile.

### Generated Asset

A saved output item. Each asset has a channel, title, body, keywords, metadata,
source task, created time, and status. Assets should be shown as cards in a
workspace rather than as chat messages.

## Pack Directory Structure

Recommended source layout:

```text
resources/industry-packs/
  heavy-packaging/
    manifest.json
    fields.json
    products.json
    themes.json
    tones.json
    tasks.json
    channels/
      wechat-moments.md
      wechat-group.md
      1688.md
      baidu-seo.md
      short-video.md
      referral.md
    output-schemas/
      content-package.json
      content-calendar.json
      channel-asset.json
    examples/
      replace-wooden-box.md
      anti-damage.md
      cost-reduction.md
      custom-packaging.md
```

Runtime and code layout:

```text
src/shared/industryPack/
  constants.ts
  types.ts

src/main/industryPack/
  industryPackLoader.ts
  templateRenderer.ts
  contentGenerationService.ts
  industryPackStore.ts
  ipcHandlers.ts

src/renderer/modules/industryMarketing/
  pages/
  components/
  services/
  store/
  types/
```

## Manifest Shape

The manifest describes what the pack supports. It should not contain large prompt
text. Prompt text belongs in channel, theme, task, and example files.

```json
{
  "id": "heavy-packaging",
  "name": "重型包装获客内容包",
  "version": "1.0.0",
  "category": "manufacturing-marketing",
  "description": "用于重型纸箱、蜂窝纸箱、纸托盘、纸护角等工业包装企业的国内推广内容生成。",
  "locale": "zh-CN",
  "entryTasks": [
    "generate_content_package",
    "generate_case_content",
    "generate_content_calendar"
  ],
  "supportedChannels": [
    "wechat_moments",
    "wechat_group",
    "1688",
    "baidu_seo",
    "short_video",
    "referral"
  ],
  "supportedThemes": [
    "replace_wooden_box",
    "anti_damage",
    "cost_reduction",
    "custom_packaging",
    "bulk_supply",
    "case_story"
  ],
  "supportedTones": [
    "boss",
    "professional_sales",
    "technical_solution",
    "short_direct"
  ],
  "defaultOutputSchemas": [
    "content-package",
    "content-calendar",
    "channel-asset"
  ]
}
```

## Field Definitions

Fields should be data-driven so future packs can render different forms without
rewriting the page.

Field groups for the heavy-packaging sample:

- Factory basics: name, location, service region, contact method.
- Product capabilities: product types, load range, dimensions, structures,
  materials, reinforcement options.
- Service capabilities: sample support, sample lead time, batch lead time, MOQ,
  invoice support, delivery area.
- Customer scenarios: machinery parts, auto parts, metal parts, home appliances,
  large equipment, export packaging.
- Proof points: equipment, capacity, certifications, past customers, case photos.
- Marketing constraints: prohibited claims, preferred wording, price visibility,
  contact CTA.

Fields must support required flags, help text, option lists, free text, and
multi-select values.

## Prompt Module Structure

Prompts should be composed from modules, not written as one large instruction.

Recommended prompt sections:

```text
system_role
industry_context
factory_profile
product_profile
case_profile
task_goal
selected_themes
selected_channels
tone_rules
period_rules
output_schema
examples
quality_checklist
```

Each module has one clear responsibility:

- `system_role`: stable generation role and safety boundaries.
- `industry_context`: industry terminology, customer concerns, and value angles.
- `factory_profile`: user-provided facts.
- `product_profile`: selected product facts.
- `case_profile`: optional case facts.
- `task_goal`: content package, case content, or content calendar.
- `selected_themes`: theme-specific selling angles.
- `selected_channels`: channel-specific writing rules.
- `tone_rules`: voice and style.
- `period_rules`: number of days, posting frequency, and distribution logic.
- `output_schema`: strict output format.
- `examples`: few-shot references.
- `quality_checklist`: final self-check before responding.

## Generation Configuration

The first version should expose these user choices:

```text
Generation task:
  Generate content package
  Generate case content
  Generate content calendar

Period:
  Today
  3 days
  7 days
  15 days
  30 days
  Custom

Channels:
  WeChat Moments
  WeChat group
  1688
  Baidu SEO
  Short video
  Referral script

Themes:
  Replace wooden box
  Anti-damage transport
  Cost reduction
  Custom packaging
  Bulk supply
  Customer case

Tone:
  Boss voice
  Professional sales
  Technical solution
  Short and direct
```

The period must not be hard-coded. It is a generation parameter that affects the
number of planned content items, topic rotation, and channel distribution.

## Output Types

### Content Package

A package generated from one product, one theme, or one case. It contains
channel-specific assets such as:

- WeChat Moments copy.
- WeChat group development script.
- 1688 title and detail page copy.
- Baidu SEO page title, outline, and body.
- Short video script.
- Referral script.

### Content Calendar

A dated plan based on the selected period. Each day can include one or more
content items. The calendar should include:

- Date or day number.
- Main theme.
- Channel.
- Title.
- Content body or script.
- Suggested CTA.
- Optional keywords.

### Channel Asset

A single generated content card saved in the workspace. It should include:

- Channel.
- Theme.
- Tone.
- Title.
- Body.
- Keywords.
- CTA.
- Source task.
- Copy/export actions.

## Heavy-Packaging Sample Rules

The sample pack should encode these industry facts:

- Common products: heavy corrugated carton, honeycomb carton, paper edge
  protector, paper pallet, custom reinforced carton.
- Target buyers: machinery-parts factories, auto-parts factories, metal-parts
  factories, large-product manufacturers, logistics packaging buyers, purchasing
  managers, packaging engineers.
- Buying concerns: load bearing, anti-damage performance, transport safety,
  custom size, lead time, MOQ, cost reduction, replacement of wooden boxes,
  environmental friendliness, export or domestic shipping needs.
- Selling angles: replace wooden box, reduce package weight, reduce breakage,
  custom reinforcement, fast sampling, stable batch supply.
- Avoid unsupported claims: absolute load guarantees, unverifiable cost savings,
  misleading environmental claims, or promises not backed by user data.

## User Experience

The first screen should not be a blank chat interface. It should present a
business workflow:

1. Select or create an industry workspace.
2. Complete factory profile.
3. Add product or case.
4. Choose generation task.
5. Configure period, channels, themes, and tone.
6. Generate content.
7. Review generated asset cards.
8. Copy or export selected assets.

Generated output should be editable and regenerable. Users should be able to ask
for controlled rewrites, such as:

- More like a factory owner.
- More suitable for WeChat Moments.
- More technical.
- Shorter.
- Emphasize cost reduction.
- Emphasize anti-damage transport.

These rewrites should still use the same structured task metadata.

## Persistence

The first version needs these records:

- `IndustryPackInstall`: installed or built-in pack metadata.
- `IndustryWorkspace`: user workspace based on one pack.
- `FactoryProfile`: reusable factory information.
- `ProductProfile`: product records.
- `CaseProfile`: marketing case records.
- `GenerationTask`: structured generation request.
- `GeneratedAsset`: generated content card.

Local SQLite persistence is preferred for consistency with the desktop app.

## Boundaries

The first version does not include:

- Automatic publishing.
- CRM.
- Lead scoring.
- IM sending.
- Existing LobsterAI Agent or Skill runtime integration.
- User-created arbitrary prompts as first-class templates.
- Multi-user collaboration.

The system may reuse shared desktop capabilities such as model configuration,
local storage, file selection, and renderer layout primitives.

## Extension Path

After the heavy-packaging sample works, new packs should be added by creating
new pack folders and registering them through the same loader:

```text
injection-molding
cnc-machining
hardware-processing
packaging-printing
machinery-equipment
```

The Industry Assistant Builder should then create saved workspaces from these
packs. A saved assistant is a configured workspace, not a free-form agent.

## Testing Strategy

Initial coverage should focus on pure logic:

- Manifest validation.
- Field schema parsing.
- Template selection.
- Prompt module assembly.
- Output schema validation.
- Period-to-calendar item planning.
- Generated asset persistence.

UI validation should confirm:

- Pack-driven forms render from field definitions.
- Required fields are enforced.
- Channel, theme, period, and tone selections produce the expected task payload.
- Generated asset cards display structured outputs correctly.

## Product Decisions

### Industry Pack Availability

The MVP ships with official bundled industry packs only. The first bundled pack
is `heavy-packaging`.

The system should still be designed around a generic pack loader and manifest
contract so additional official packs can be added without changing the core
workflow. User-imported packs are out of scope for MVP because they introduce
template safety, version compatibility, schema validation, prompt quality, and
support complexity.

Planned progression:

```text
V1: Official bundled industry packs.
V2: Developer or administrator import of industry packs.
V3: Guided user creation of dedicated industry assistants.
```

### Export Formats

The MVP supports copy, Markdown export, and Excel export.

- Single channel assets: copy and Markdown export.
- Full content packages: Markdown export.
- Content calendars: Excel export.

Word export is deferred. It is better suited for later formal documents such as
customer proposal drafts, case reports, or marketing plan documents.

### Input Method

The MVP uses structured manual entry plus a free-text supplemental information
field. Complex file parsing is out of scope for MVP.

This keeps the first version reliable for factory users whose PDFs, Excel files,
images, and quotation sheets may be inconsistent. The system can still let users
paste product descriptions, case notes, quotation text, or sales notes into the
supplemental field.

Planned progression:

```text
V1: Structured manual entry plus free-text supplemental input.
V2: Excel product-table import.
V3: PDF and image extraction for product and case information.
V4: Batch product and case library import.
```

### Model Calling Path

The independent business system uses a dedicated generation service instead of
the existing LobsterAI Agent or Skill runtime.

Recommended flow:

```text
Renderer industry marketing pages
→ IPC
→ industryMarketingGenerationService
→ prompt/template renderer
→ model client adapter
→ output schema validator
→ GeneratedAsset store
→ Renderer asset workspace
```

The service may reuse application-level model configuration and credentials, but
it must not create Cowork/OpenClaw agent sessions, invoke LobsterAI skills, or
depend on agent tool routing. The product experience is a structured business
tool rather than a free-form chat agent.
