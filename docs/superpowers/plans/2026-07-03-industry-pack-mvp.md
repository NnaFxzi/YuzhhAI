# Industry Pack MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first independent Industry Pack content generation MVP with a bundled heavy-packaging pack, structured input, generated asset persistence, and a renderer business workspace.

**Architecture:** Add a new independent industry marketing subsystem that does not create Cowork/OpenClaw sessions and does not invoke LobsterAI skills. The main process owns pack loading, template rendering, model calls, SQLite persistence, export generation, and IPC handlers; the renderer owns structured forms, task configuration, and asset cards.

**Tech Stack:** Electron IPC, React 18, Redux Toolkit, TypeScript, better-sqlite3, bundled JSON/Markdown resources, Vitest, existing provider configuration.

---

## Scope

This plan implements the MVP decisions from `docs/superpowers/specs/2026-07-03-industry-pack-design.md`:

- Official bundled industry packs only.
- First bundled pack: `heavy-packaging`.
- Structured manual entry plus free-text supplemental input.
- Copy, Markdown export, and Excel export.
- Dedicated industry marketing generation service, separate from Cowork/OpenClaw Agent and Skill runtime.

This plan does not implement user-imported packs, automatic publishing, CRM, IM sending, file parsing, Word export, or free-form custom prompt templates.

Repository guidance says not to commit until the user has tested and confirmed, so each task ends with a review checkpoint instead of a commit step.

## File Structure

Create:

- `src/shared/industryPack/constants.ts`: string constants for pack IDs, task IDs, channel IDs, theme IDs, tone IDs, output kinds, IPC channels, and asset statuses.
- `src/shared/industryPack/types.ts`: shared request, response, manifest, field, task, asset, and workspace types.
- `src/shared/industryPack/validation.ts`: pure validation and normalization helpers for manifests, generation requests, and generated assets.
- `src/shared/industryPack/validation.test.ts`: unit tests for validation and normalization.
- `resources/industry-packs/heavy-packaging/manifest.json`: bundled sample pack manifest.
- `resources/industry-packs/heavy-packaging/fields.json`: field definitions for factory, product, and case forms.
- `resources/industry-packs/heavy-packaging/products.json`: supported heavy-packaging product options.
- `resources/industry-packs/heavy-packaging/themes.json`: supported selling themes.
- `resources/industry-packs/heavy-packaging/tones.json`: tone definitions.
- `resources/industry-packs/heavy-packaging/tasks.json`: supported generation task definitions.
- `resources/industry-packs/heavy-packaging/channels/wechat-moments.md`: WeChat Moments channel rules.
- `resources/industry-packs/heavy-packaging/channels/wechat-group.md`: WeChat group channel rules.
- `resources/industry-packs/heavy-packaging/channels/1688.md`: 1688 channel rules.
- `resources/industry-packs/heavy-packaging/channels/baidu-seo.md`: Baidu SEO channel rules.
- `resources/industry-packs/heavy-packaging/channels/short-video.md`: short video channel rules.
- `resources/industry-packs/heavy-packaging/channels/referral.md`: referral script rules.
- `resources/industry-packs/heavy-packaging/output-schemas/channel-asset.json`: single asset output schema documentation.
- `resources/industry-packs/heavy-packaging/output-schemas/content-package.json`: content package output schema documentation.
- `resources/industry-packs/heavy-packaging/output-schemas/content-calendar.json`: content calendar output schema documentation.
- `resources/industry-packs/heavy-packaging/examples/replace-wooden-box.md`: few-shot example.
- `resources/industry-packs/heavy-packaging/examples/anti-damage.md`: few-shot example.
- `resources/industry-packs/heavy-packaging/examples/cost-reduction.md`: few-shot example.
- `src/main/industryPack/industryPackLoader.ts`: reads bundled pack files and validates manifests.
- `src/main/industryPack/industryPackLoader.test.ts`: loader tests with the bundled pack.
- `src/main/industryPack/generationPlanner.ts`: expands period/channel/theme selections into planned content items.
- `src/main/industryPack/templateRenderer.ts`: builds prompt modules from pack files and generation requests.
- `src/main/industryPack/templateRenderer.test.ts`: planner and renderer tests.
- `src/main/industryPack/industryPackStore.ts`: SQLite persistence for workspaces, profiles, tasks, and generated assets.
- `src/main/industryPack/industryPackStore.test.ts`: in-memory SQLite store tests.
- `src/main/industryPack/modelClientAdapter.ts`: isolated non-agent model call adapter.
- `src/main/industryPack/contentGenerationService.ts`: orchestrates validation, prompt rendering, model call, schema parsing, and persistence.
- `src/main/industryPack/contentGenerationService.test.ts`: service tests with a fake model adapter.
- `src/main/industryPack/exportService.ts`: Markdown and Excel export generation.
- `src/main/industryPack/exportService.test.ts`: export tests.
- `src/main/industryPack/ipcHandlers.ts`: IPC registration for industry marketing.
- `src/renderer/modules/industryMarketing/services/industryMarketing.ts`: renderer IPC service wrapper.
- `src/renderer/modules/industryMarketing/store/industryMarketingSlice.ts`: renderer state for selected workspace, profiles, generation config, and assets.
- `src/renderer/modules/industryMarketing/types.ts`: renderer-only UI helper types.
- `src/renderer/modules/industryMarketing/components/IndustryMarketingView.tsx`: top-level business workspace.
- `src/renderer/modules/industryMarketing/components/FactoryProfileForm.tsx`: factory and product input form.
- `src/renderer/modules/industryMarketing/components/GenerationConfigPanel.tsx`: task, period, channel, theme, and tone selection.
- `src/renderer/modules/industryMarketing/components/GeneratedAssetCard.tsx`: asset display card with copy/export/regenerate actions.
- `src/renderer/modules/industryMarketing/components/AssetWorkspace.tsx`: generated asset list and content calendar view.
- `src/renderer/modules/industryMarketing/index.ts`: module exports.

Modify:

- `src/main/sqliteStore.ts`: initialize industry marketing tables through the feature store during app startup or expose the database for the feature store.
- `src/main/main.ts`: construct `IndustryPackStore`, `IndustryPackLoader`, and generation/export services; register IPC handlers.
- `src/main/preload.ts`: expose `window.electron.industryMarketing`.
- `src/renderer/App.tsx`: add `industryMarketing` to `mainView` and render the new workspace.
- `src/renderer/components/Sidebar.tsx`: add a navigation entry for the industry marketing workspace.
- `src/renderer/services/i18n.ts`: add Chinese and English UI strings for navigation and the new module.
- `src/renderer/store/index.ts`: register `industryMarketing` reducer.

## Task 1: Shared Constants, Types, and Validation

**Files:**
- Create: `src/shared/industryPack/constants.ts`
- Create: `src/shared/industryPack/types.ts`
- Create: `src/shared/industryPack/validation.ts`
- Create: `src/shared/industryPack/validation.test.ts`

- [ ] **Step 1: Write the failing validation tests**

```ts
import { describe, expect, test } from 'vitest';

import { IndustryPackChannel, IndustryPackId, IndustryPackTask } from './constants';
import {
  normalizeGenerationRequest,
  validateIndustryPackManifest,
} from './validation';

describe('industry pack validation', () => {
  test('accepts a valid heavy packaging manifest', () => {
    const result = validateIndustryPackManifest({
      id: IndustryPackId.HeavyPackaging,
      name: '重型包装获客内容包',
      version: '1.0.0',
      category: 'manufacturing-marketing',
      description: '用于工业包装企业的国内推广内容生成。',
      locale: 'zh-CN',
      entryTasks: [IndustryPackTask.GenerateContentPackage],
      supportedChannels: [IndustryPackChannel.WechatMoments],
      supportedThemes: ['replace_wooden_box'],
      supportedTones: ['boss'],
      defaultOutputSchemas: ['content-package'],
    });

    expect(result.ok).toBe(true);
  });

  test('rejects a manifest without an id', () => {
    const result = validateIndustryPackManifest({
      name: 'Broken pack',
      version: '1.0.0',
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('manifest.id is required');
  });

  test('normalizes custom period bounds', () => {
    const normalized = normalizeGenerationRequest({
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentCalendar,
      period: { kind: 'custom', days: 45 },
      channels: [IndustryPackChannel.WechatMoments],
      themes: ['anti_damage'],
      tone: 'boss',
      profile: { factoryName: '东莞重包包装厂' },
    });

    expect(normalized.period).toEqual({ kind: 'custom', days: 30 });
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- src/shared/industryPack/validation.test.ts`

Expected: fails because `src/shared/industryPack/*` does not exist.

- [ ] **Step 3: Add shared constants**

```ts
export const IndustryPackId = {
  HeavyPackaging: 'heavy-packaging',
} as const;
export type IndustryPackId = typeof IndustryPackId[keyof typeof IndustryPackId];

export const IndustryPackTask = {
  GenerateContentPackage: 'generate_content_package',
  GenerateCaseContent: 'generate_case_content',
  GenerateContentCalendar: 'generate_content_calendar',
} as const;
export type IndustryPackTask = typeof IndustryPackTask[keyof typeof IndustryPackTask];

export const IndustryPackChannel = {
  WechatMoments: 'wechat_moments',
  WechatGroup: 'wechat_group',
  Platform1688: '1688',
  BaiduSeo: 'baidu_seo',
  ShortVideo: 'short_video',
  Referral: 'referral',
} as const;
export type IndustryPackChannel = typeof IndustryPackChannel[keyof typeof IndustryPackChannel];

export const GeneratedAssetStatus = {
  Draft: 'draft',
  Exported: 'exported',
  Archived: 'archived',
} as const;
export type GeneratedAssetStatus = typeof GeneratedAssetStatus[keyof typeof GeneratedAssetStatus];

export const IndustryMarketingIpc = {
  ListPacks: 'industryMarketing:packs:list',
  GetPack: 'industryMarketing:packs:get',
  GetWorkspace: 'industryMarketing:workspace:get',
  SaveFactoryProfile: 'industryMarketing:profile:saveFactory',
  SaveProductProfile: 'industryMarketing:profile:saveProduct',
  SaveCaseProfile: 'industryMarketing:profile:saveCase',
  Generate: 'industryMarketing:generate',
  ListAssets: 'industryMarketing:assets:list',
  UpdateAsset: 'industryMarketing:assets:update',
  ExportAsset: 'industryMarketing:assets:export',
} as const;
export type IndustryMarketingIpc = typeof IndustryMarketingIpc[keyof typeof IndustryMarketingIpc];
```

- [ ] **Step 4: Add shared types**

```ts
import type {
  GeneratedAssetStatus,
  IndustryPackChannel,
  IndustryPackId,
  IndustryPackTask,
} from './constants';

export interface IndustryPackManifest {
  id: IndustryPackId | string;
  name: string;
  version: string;
  category: string;
  description: string;
  locale: string;
  entryTasks: string[];
  supportedChannels: string[];
  supportedThemes: string[];
  supportedTones: string[];
  defaultOutputSchemas: string[];
}

export interface IndustryPackFieldOption {
  value: string;
  label: string;
}

export interface IndustryPackField {
  id: string;
  label: string;
  kind: 'text' | 'textarea' | 'select' | 'multiselect' | 'number';
  required?: boolean;
  helpText?: string;
  options?: IndustryPackFieldOption[];
}

export interface IndustryPackFieldGroup {
  id: string;
  title: string;
  fields: IndustryPackField[];
}

export interface GenerationPeriod {
  kind: 'today' | 'preset' | 'custom';
  days: number;
}

export interface IndustryGenerationRequest {
  packId: IndustryPackId | string;
  taskId: IndustryPackTask | string;
  period: GenerationPeriod;
  channels: Array<IndustryPackChannel | string>;
  themes: string[];
  tone: string;
  profile: Record<string, unknown>;
  productProfileId?: string;
  caseProfileId?: string;
  supplementalText?: string;
}

export interface GeneratedAsset {
  id: string;
  workspaceId: string;
  taskId: string;
  packId: string;
  channel: string;
  theme: string;
  tone: string;
  title: string;
  body: string;
  keywords: string[];
  cta: string;
  status: GeneratedAssetStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}
```

- [ ] **Step 5: Add validation helpers**

```ts
import type { GenerationPeriod, IndustryGenerationRequest, IndustryPackManifest, ValidationResult } from './types';

const MAX_CUSTOM_PERIOD_DAYS = 30;

const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function validateIndustryPackManifest(value: unknown): ValidationResult {
  const errors: string[] = [];
  const manifest = value as Partial<IndustryPackManifest> | null;

  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: ['manifest must be an object'] };
  }
  if (!hasText(manifest.id)) errors.push('manifest.id is required');
  if (!hasText(manifest.name)) errors.push('manifest.name is required');
  if (!hasText(manifest.version)) errors.push('manifest.version is required');
  if (!Array.isArray(manifest.entryTasks) || manifest.entryTasks.length === 0) {
    errors.push('manifest.entryTasks must include at least one task');
  }
  if (!Array.isArray(manifest.supportedChannels) || manifest.supportedChannels.length === 0) {
    errors.push('manifest.supportedChannels must include at least one channel');
  }

  return { ok: errors.length === 0, errors };
}

function normalizePeriod(period: GenerationPeriod): GenerationPeriod {
  if (period.kind === 'today') return { kind: 'today', days: 1 };
  if (period.kind === 'custom') {
    return {
      kind: 'custom',
      days: Math.min(Math.max(Math.floor(period.days || 1), 1), MAX_CUSTOM_PERIOD_DAYS),
    };
  }
  return {
    kind: 'preset',
    days: Math.min(Math.max(Math.floor(period.days || 1), 1), MAX_CUSTOM_PERIOD_DAYS),
  };
}

export function normalizeGenerationRequest(
  request: IndustryGenerationRequest,
): IndustryGenerationRequest {
  return {
    ...request,
    period: normalizePeriod(request.period),
    channels: Array.from(new Set(request.channels)),
    themes: Array.from(new Set(request.themes)),
    supplementalText: request.supplementalText?.trim() || undefined,
  };
}
```

- [ ] **Step 6: Run focused tests**

Run: `npm test -- src/shared/industryPack/validation.test.ts`

Expected: all tests pass.

- [ ] **Step 7: Run changed-file lint**

Run: `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/industryPack/constants.ts src/shared/industryPack/types.ts src/shared/industryPack/validation.ts src/shared/industryPack/validation.test.ts`

Expected: no ESLint errors or warnings.

- [ ] **Step 8: Review checkpoint**

Check that shared constants are not duplicated as bare discriminant strings in later tasks.

## Task 2: Bundled Heavy-Packaging Pack and Loader

**Files:**
- Create: `resources/industry-packs/heavy-packaging/manifest.json`
- Create: all bundled heavy-packaging JSON and Markdown files listed in File Structure
- Create: `src/main/industryPack/industryPackLoader.ts`
- Create: `src/main/industryPack/industryPackLoader.test.ts`

- [ ] **Step 1: Write the loader test**

```ts
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { IndustryPackId } from '../../shared/industryPack/constants';
import { IndustryPackLoader } from './industryPackLoader';

describe('IndustryPackLoader', () => {
  test('loads the bundled heavy packaging pack', () => {
    const loader = new IndustryPackLoader({
      packsRoot: path.resolve(process.cwd(), 'resources/industry-packs'),
    });

    const pack = loader.getPack(IndustryPackId.HeavyPackaging);

    expect(pack.manifest.id).toBe(IndustryPackId.HeavyPackaging);
    expect(pack.fields.groups.length).toBeGreaterThan(0);
    expect(pack.channels['wechat_moments']).toContain('朋友圈');
    expect(pack.channels['1688']).toContain('1688');
  });

  test('lists bundled packs in display order', () => {
    const loader = new IndustryPackLoader({
      packsRoot: path.resolve(process.cwd(), 'resources/industry-packs'),
    });

    expect(loader.listPacks().map(pack => pack.id)).toEqual([IndustryPackId.HeavyPackaging]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- src/main/industryPack/industryPackLoader.test.ts`

Expected: fails because the loader and bundled pack files do not exist.

- [ ] **Step 3: Add `manifest.json`**

```json
{
  "id": "heavy-packaging",
  "name": "重型包装获客内容包",
  "version": "1.0.0",
  "category": "manufacturing-marketing",
  "description": "用于重型纸箱、蜂窝纸箱、纸托盘、纸护角等工业包装企业的国内推广内容生成。",
  "locale": "zh-CN",
  "entryTasks": ["generate_content_package", "generate_case_content", "generate_content_calendar"],
  "supportedChannels": ["wechat_moments", "wechat_group", "1688", "baidu_seo", "short_video", "referral"],
  "supportedThemes": ["replace_wooden_box", "anti_damage", "cost_reduction", "custom_packaging", "bulk_supply", "case_story"],
  "supportedTones": ["boss", "professional_sales", "technical_solution", "short_direct"],
  "defaultOutputSchemas": ["content-package", "content-calendar", "channel-asset"]
}
```

- [ ] **Step 4: Add `fields.json`**

```json
{
  "groups": [
    {
      "id": "factory",
      "title": "工厂资料",
      "fields": [
        { "id": "factoryName", "label": "工厂名称", "kind": "text", "required": true },
        { "id": "location", "label": "所在地区", "kind": "text", "required": true },
        { "id": "serviceRegion", "label": "服务区域", "kind": "text" },
        { "id": "contactMethod", "label": "联系方式", "kind": "text" }
      ]
    },
    {
      "id": "capability",
      "title": "产品与能力",
      "fields": [
        { "id": "productTypes", "label": "主营产品", "kind": "multiselect", "required": true },
        { "id": "loadRange", "label": "承重范围", "kind": "text" },
        { "id": "customSize", "label": "可定制尺寸", "kind": "text" },
        { "id": "reinforcementOptions", "label": "加固方式", "kind": "textarea" },
        { "id": "sampleLeadTime", "label": "打样周期", "kind": "text" },
        { "id": "batchLeadTime", "label": "批量交期", "kind": "text" },
        { "id": "moq", "label": "起订量", "kind": "text" }
      ]
    },
    {
      "id": "case",
      "title": "案例资料",
      "fields": [
        { "id": "customerProduct", "label": "客户产品", "kind": "text" },
        { "id": "productWeight", "label": "单件重量", "kind": "text" },
        { "id": "transportMethod", "label": "运输方式", "kind": "text" },
        { "id": "originalProblem", "label": "原包装痛点", "kind": "textarea" },
        { "id": "solution", "label": "包装方案", "kind": "textarea" }
      ]
    }
  ]
}
```

- [ ] **Step 5: Add channel Markdown files**

Use short rule files. Example for `resources/industry-packs/heavy-packaging/channels/wechat-moments.md`:

```markdown
# 朋友圈规则

- 用真实工厂老板或销售的语气。
- 开头先讲客户痛点，不要直接堆产品名。
- 强调承重、防破损、定制、交期、替代木箱、降本。
- 结尾引导客户发送产品尺寸、重量、运输方式。
- 避免绝对承诺，例如“保证不破损”。
```

Example for `resources/industry-packs/heavy-packaging/channels/1688.md`:

```markdown
# 1688 规则

- 标题包含产品、厂家、定制、应用场景、承重或加厚词。
- 详情页按“适用产品、客户痛点、包装方案、工厂能力、咨询引导”组织。
- 关键词自然出现，不要重复堆砌。
- 用采购能理解的表达，避免夸张广告语。
```

- [ ] **Step 6: Add the loader implementation**

```ts
import fs from 'node:fs';
import path from 'node:path';

import { validateIndustryPackManifest } from '../../shared/industryPack/validation';
import type { IndustryPackManifest } from '../../shared/industryPack/types';

interface IndustryPackLoaderOptions {
  packsRoot: string;
}

export interface LoadedIndustryPack {
  id: string;
  manifest: IndustryPackManifest;
  fields: { groups: unknown[] };
  products: unknown;
  themes: unknown;
  tones: unknown;
  tasks: unknown;
  channels: Record<string, string>;
  outputSchemas: Record<string, unknown>;
  examples: Record<string, string>;
}

export class IndustryPackLoader {
  constructor(private readonly options: IndustryPackLoaderOptions) {}

  listPacks(): Array<{ id: string; name: string; version: string }> {
    return fs.readdirSync(this.options.packsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => this.getPack(entry.name))
      .map(pack => ({
        id: pack.manifest.id,
        name: pack.manifest.name,
        version: pack.manifest.version,
      }));
  }

  getPack(packId: string): LoadedIndustryPack {
    const packDir = path.join(this.options.packsRoot, packId);
    const manifest = this.readJson<IndustryPackManifest>(path.join(packDir, 'manifest.json'));
    const validation = validateIndustryPackManifest(manifest);
    if (!validation.ok) {
      throw new Error(`Invalid industry pack ${packId}: ${validation.errors.join('; ')}`);
    }

    return {
      id: manifest.id,
      manifest,
      fields: this.readJson(path.join(packDir, 'fields.json')),
      products: this.readOptionalJson(path.join(packDir, 'products.json'), []),
      themes: this.readOptionalJson(path.join(packDir, 'themes.json'), []),
      tones: this.readOptionalJson(path.join(packDir, 'tones.json'), []),
      tasks: this.readOptionalJson(path.join(packDir, 'tasks.json'), []),
      channels: this.readMarkdownDirectory(path.join(packDir, 'channels')),
      outputSchemas: this.readJsonDirectory(path.join(packDir, 'output-schemas')),
      examples: this.readMarkdownDirectory(path.join(packDir, 'examples')),
    };
  }

  private readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  }

  private readOptionalJson<T>(filePath: string, fallback: T): T {
    if (!fs.existsSync(filePath)) return fallback;
    return this.readJson<T>(filePath);
  }

  private readJsonDirectory(dirPath: string): Record<string, unknown> {
    if (!fs.existsSync(dirPath)) return {};
    return Object.fromEntries(
      fs.readdirSync(dirPath)
        .filter(file => file.endsWith('.json'))
        .map(file => [path.basename(file, '.json'), this.readJson(path.join(dirPath, file))]),
    );
  }

  private readMarkdownDirectory(dirPath: string): Record<string, string> {
    if (!fs.existsSync(dirPath)) return {};
    return Object.fromEntries(
      fs.readdirSync(dirPath)
        .filter(file => file.endsWith('.md'))
        .map(file => [path.basename(file, '.md').replaceAll('-', '_'), fs.readFileSync(path.join(dirPath, file), 'utf8')]),
    );
  }
}
```

- [ ] **Step 7: Run focused tests**

Run: `npm test -- src/main/industryPack/industryPackLoader.test.ts`

Expected: all tests pass.

- [ ] **Step 8: Run changed-file lint**

Run: `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/industryPack/industryPackLoader.ts src/main/industryPack/industryPackLoader.test.ts`

Expected: no ESLint errors or warnings.

- [ ] **Step 9: Review checkpoint**

Open the bundled pack files and confirm they describe heavy packaging, not generic marketing.

## Task 3: Planning and Prompt Rendering

**Files:**
- Create: `src/main/industryPack/generationPlanner.ts`
- Create: `src/main/industryPack/templateRenderer.ts`
- Create: `src/main/industryPack/templateRenderer.test.ts`

- [ ] **Step 1: Write planner and renderer tests**

```ts
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { IndustryPackChannel, IndustryPackId, IndustryPackTask } from '../../shared/industryPack/constants';
import { IndustryPackLoader } from './industryPackLoader';
import { planGenerationItems } from './generationPlanner';
import { renderIndustryPrompt } from './templateRenderer';

describe('industry prompt rendering', () => {
  const loader = new IndustryPackLoader({
    packsRoot: path.resolve(process.cwd(), 'resources/industry-packs'),
  });

  test('plans one item per channel for a today content package', () => {
    const items = planGenerationItems({
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentPackage,
      period: { kind: 'today', days: 1 },
      channels: [IndustryPackChannel.WechatMoments, IndustryPackChannel.Platform1688],
      themes: ['replace_wooden_box'],
      tone: 'boss',
      profile: { factoryName: '东莞重包包装厂' },
    });

    expect(items.map(item => item.channel)).toEqual([
      IndustryPackChannel.WechatMoments,
      IndustryPackChannel.Platform1688,
    ]);
  });

  test('renders prompt with selected channel rules and schema instruction', () => {
    const pack = loader.getPack(IndustryPackId.HeavyPackaging);
    const prompt = renderIndustryPrompt(pack, {
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentPackage,
      period: { kind: 'today', days: 1 },
      channels: [IndustryPackChannel.WechatMoments],
      themes: ['anti_damage'],
      tone: 'professional_sales',
      profile: {
        factoryName: '东莞重包包装厂',
        productTypes: ['重型瓦楞纸箱'],
      },
      supplementalText: '客户常运输 80kg 机械零部件。',
    });

    expect(prompt).toContain('东莞重包包装厂');
    expect(prompt).toContain('朋友圈规则');
    expect(prompt).toContain('80kg 机械零部件');
    expect(prompt).toContain('JSON');
  });
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `npm test -- src/main/industryPack/templateRenderer.test.ts`

Expected: fails because planner and renderer do not exist.

- [ ] **Step 3: Add generation planner**

```ts
import type { IndustryGenerationRequest } from '../../shared/industryPack/types';

export interface PlannedGenerationItem {
  day: number;
  channel: string;
  theme: string;
}

export function planGenerationItems(request: IndustryGenerationRequest): PlannedGenerationItem[] {
  const days = Math.max(1, request.period.days);
  const isCalendar = request.taskId === 'generate_content_calendar';
  const totalDays = isCalendar ? days : 1;
  const items: PlannedGenerationItem[] = [];

  for (let day = 1; day <= totalDays; day += 1) {
    request.channels.forEach((channel, channelIndex) => {
      const theme = request.themes[(day + channelIndex - 1) % request.themes.length] || request.themes[0] || 'case_story';
      items.push({ day, channel, theme });
    });
  }

  return items;
}
```

- [ ] **Step 4: Add prompt renderer**

```ts
import type { IndustryGenerationRequest } from '../../shared/industryPack/types';
import type { LoadedIndustryPack } from './industryPackLoader';
import { planGenerationItems } from './generationPlanner';

export function renderIndustryPrompt(
  pack: LoadedIndustryPack,
  request: IndustryGenerationRequest,
): string {
  const plannedItems = planGenerationItems(request);
  const selectedChannelRules = request.channels
    .map(channel => `## Channel: ${channel}\n${pack.channels[String(channel)] || ''}`)
    .join('\n\n');

  return [
    'You are a manufacturing marketing content strategist.',
    'Generate Chinese domestic customer-acquisition content for the selected industry.',
    'Do not invent certifications, customer names, exact load guarantees, or cost savings not provided by the user.',
    `Industry pack: ${pack.manifest.name}`,
    `Task: ${request.taskId}`,
    `Tone: ${request.tone}`,
    `Period days: ${request.period.days}`,
    `Factory profile JSON:\n${JSON.stringify(request.profile, null, 2)}`,
    request.supplementalText ? `Supplemental information:\n${request.supplementalText}` : '',
    `Selected channel rules:\n${selectedChannelRules}`,
    `Planned items JSON:\n${JSON.stringify(plannedItems, null, 2)}`,
    'Return only JSON with an "assets" array. Each asset must include channel, theme, title, body, keywords, and cta.',
  ].filter(Boolean).join('\n\n');
}
```

- [ ] **Step 5: Run focused tests**

Run: `npm test -- src/main/industryPack/templateRenderer.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Run changed-file lint**

Run: `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/industryPack/generationPlanner.ts src/main/industryPack/templateRenderer.ts src/main/industryPack/templateRenderer.test.ts`

Expected: no ESLint errors or warnings.

- [ ] **Step 7: Review checkpoint**

Confirm that period logic is a request parameter and no task hard-codes one day or one week.

## Task 4: SQLite Persistence

**Files:**
- Create: `src/main/industryPack/industryPackStore.ts`
- Create: `src/main/industryPack/industryPackStore.test.ts`

- [ ] **Step 1: Write store tests**

```ts
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { GeneratedAssetStatus, IndustryPackChannel, IndustryPackId } from '../../shared/industryPack/constants';
import { IndustryPackStore } from './industryPackStore';

describe('IndustryPackStore', () => {
  test('creates a workspace and saves generated assets', () => {
    const db = new Database(':memory:');
    const store = new IndustryPackStore(db);

    const workspace = store.ensureWorkspace({
      packId: IndustryPackId.HeavyPackaging,
      name: '东莞重包包装厂推广工作台',
    });

    const asset = store.createGeneratedAsset({
      workspaceId: workspace.id,
      taskId: 'task-1',
      packId: IndustryPackId.HeavyPackaging,
      channel: IndustryPackChannel.WechatMoments,
      theme: 'anti_damage',
      tone: 'boss',
      title: '80kg 零部件包装怎么防破损',
      body: '根据重量、尺寸和运输方式设计重型纸箱结构。',
      keywords: ['重型纸箱', '防破损'],
      cta: '发送尺寸和重量评估包装方案',
      status: GeneratedAssetStatus.Draft,
    });

    expect(store.listGeneratedAssets(workspace.id)).toEqual([asset]);
  });
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `npm test -- src/main/industryPack/industryPackStore.test.ts`

Expected: fails because `IndustryPackStore` does not exist.

- [ ] **Step 3: Implement feature store tables and methods**

```ts
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

import { GeneratedAssetStatus } from '../../shared/industryPack/constants';
import type { GeneratedAsset } from '../../shared/industryPack/types';

interface WorkspaceInput {
  packId: string;
  name: string;
}

interface GeneratedAssetInput {
  workspaceId: string;
  taskId: string;
  packId: string;
  channel: string;
  theme: string;
  tone: string;
  title: string;
  body: string;
  keywords: string[];
  cta: string;
  status?: GeneratedAssetStatus;
}

export class IndustryPackStore {
  constructor(private readonly db: Database.Database) {
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS industry_workspaces (
        id TEXT PRIMARY KEY,
        pack_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS industry_generated_assets (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        pack_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        theme TEXT NOT NULL,
        tone TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        keywords TEXT NOT NULL,
        cta TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  ensureWorkspace(input: WorkspaceInput): { id: string; packId: string; name: string } {
    const existing = this.db.prepare(
      'SELECT id, pack_id as packId, name FROM industry_workspaces WHERE pack_id = ? ORDER BY created_at LIMIT 1',
    ).get(input.packId) as { id: string; packId: string; name: string } | undefined;
    if (existing) return existing;

    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO industry_workspaces (id, pack_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, input.packId, input.name, now, now);
    return { id, packId: input.packId, name: input.name };
  }

  createGeneratedAsset(input: GeneratedAssetInput): GeneratedAsset {
    const now = new Date().toISOString();
    const asset: GeneratedAsset = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      packId: input.packId,
      channel: input.channel,
      theme: input.theme,
      tone: input.tone,
      title: input.title,
      body: input.body,
      keywords: input.keywords,
      cta: input.cta,
      status: input.status || GeneratedAssetStatus.Draft,
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO industry_generated_assets
      (id, workspace_id, task_id, pack_id, channel, theme, tone, title, body, keywords, cta, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      asset.id,
      asset.workspaceId,
      asset.taskId,
      asset.packId,
      asset.channel,
      asset.theme,
      asset.tone,
      asset.title,
      asset.body,
      JSON.stringify(asset.keywords),
      asset.cta,
      asset.status,
      asset.createdAt,
      asset.updatedAt,
    );
    return asset;
  }

  listGeneratedAssets(workspaceId: string): GeneratedAsset[] {
    const rows = this.db.prepare(`
      SELECT id, workspace_id as workspaceId, task_id as taskId, pack_id as packId,
             channel, theme, tone, title, body, keywords, cta, status,
             created_at as createdAt, updated_at as updatedAt
      FROM industry_generated_assets
      WHERE workspace_id = ?
      ORDER BY created_at DESC
    `).all(workspaceId) as Array<Omit<GeneratedAsset, 'keywords'> & { keywords: string }>;

    return rows.map(row => ({
      ...row,
      keywords: JSON.parse(row.keywords) as string[],
    }));
  }
}
```

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/main/industryPack/industryPackStore.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Run changed-file lint**

Run: `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/industryPack/industryPackStore.ts src/main/industryPack/industryPackStore.test.ts`

Expected: no ESLint errors or warnings.

- [ ] **Step 6: Review checkpoint**

Confirm generated assets are stored as structured records rather than Cowork messages.

## Task 5: Generation Service and Model Adapter

**Files:**
- Create: `src/main/industryPack/modelClientAdapter.ts`
- Create: `src/main/industryPack/contentGenerationService.ts`
- Create: `src/main/industryPack/contentGenerationService.test.ts`

- [ ] **Step 1: Write service test with fake model client**

```ts
import Database from 'better-sqlite3';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { IndustryPackChannel, IndustryPackId, IndustryPackTask } from '../../shared/industryPack/constants';
import { ContentGenerationService } from './contentGenerationService';
import { IndustryPackLoader } from './industryPackLoader';
import { IndustryPackStore } from './industryPackStore';

describe('ContentGenerationService', () => {
  test('generates and persists channel assets from model JSON', async () => {
    const store = new IndustryPackStore(new Database(':memory:'));
    const loader = new IndustryPackLoader({
      packsRoot: path.resolve(process.cwd(), 'resources/industry-packs'),
    });
    const service = new ContentGenerationService({
      loader,
      store,
      modelClient: {
        generateText: async () => JSON.stringify({
          assets: [
            {
              channel: IndustryPackChannel.WechatMoments,
              theme: 'anti_damage',
              title: '重型零部件运输怎么减少破损',
              body: '根据重量、尺寸和运输方式设计重型纸箱结构。',
              keywords: ['重型纸箱', '防破损'],
              cta: '发送产品尺寸和重量，评估包装方案'
            }
          ]
        }),
      },
    });

    const result = await service.generate({
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentPackage,
      period: { kind: 'today', days: 1 },
      channels: [IndustryPackChannel.WechatMoments],
      themes: ['anti_damage'],
      tone: 'boss',
      profile: { factoryName: '东莞重包包装厂' },
    });

    expect(result.assets).toHaveLength(1);
    expect(store.listGeneratedAssets(result.workspace.id)[0].title).toContain('重型零部件');
  });
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `npm test -- src/main/industryPack/contentGenerationService.test.ts`

Expected: fails because generation service does not exist.

- [ ] **Step 3: Add model adapter interface and MVP implementation**

```ts
import { session } from 'electron';

export interface ModelClientAdapter {
  generateText(input: {
    prompt: string;
    temperature?: number;
  }): Promise<string>;
}

interface AppModelConfig {
  api?: { key?: string; baseUrl?: string };
  model?: { defaultModel?: string; defaultModelProvider?: string };
  providers?: Record<string, {
    enabled?: boolean;
    apiKey?: string;
    baseUrl?: string;
    apiFormat?: 'openai' | 'anthropic' | 'gemini';
    models?: Array<{ id: string }>;
  }>;
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (normalized.endsWith('/chat/completions')) return normalized;
  if (/\/v\d+$/.test(normalized)) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

function resolveOpenAICompatibleConfig(config: AppModelConfig | null | undefined): {
  apiKey: string;
  baseUrl: string;
  model: string;
} {
  const preferredProvider = config?.model?.defaultModelProvider;
  const provider = preferredProvider ? config?.providers?.[preferredProvider] : undefined;
  if (provider?.enabled && provider.apiKey && provider.baseUrl) {
    return {
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      model: config?.model?.defaultModel || provider.models?.[0]?.id || '',
    };
  }
  if (config?.api?.key && config.api.baseUrl) {
    return {
      apiKey: config.api.key,
      baseUrl: config.api.baseUrl,
      model: config.model?.defaultModel || '',
    };
  }
  throw new Error('No model configuration is available for industry content generation');
}

export function createIndustryModelClientAdapter(
  getConfig: () => AppModelConfig | null | undefined,
): ModelClientAdapter {
  return {
    async generateText(input) {
      const config = resolveOpenAICompatibleConfig(getConfig());
      if (!config.model) {
        throw new Error('No default model is configured for industry content generation');
      }
      const response = await session.defaultSession.fetch(buildChatCompletionsUrl(config.baseUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: input.prompt }],
          temperature: input.temperature ?? 0.7,
        }),
      });
      if (!response.ok) {
        throw new Error(`Model request failed: ${response.status} ${response.statusText}`);
      }
      const payload = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = payload.choices?.[0]?.message?.content?.trim();
      if (!text) {
        throw new Error('Model response did not include text content');
      }
      return text;
    },
  };
}
```

This MVP adapter supports OpenAI-compatible chat completions using existing app model configuration. Anthropic and Gemini protocol adapters are excluded from this plan.

- [ ] **Step 4: Add content generation service**

```ts
import { randomUUID } from 'node:crypto';

import { GeneratedAssetStatus } from '../../shared/industryPack/constants';
import type { GeneratedAsset, IndustryGenerationRequest } from '../../shared/industryPack/types';
import { normalizeGenerationRequest } from '../../shared/industryPack/validation';
import type { ModelClientAdapter } from './modelClientAdapter';
import type { IndustryPackLoader } from './industryPackLoader';
import type { IndustryPackStore } from './industryPackStore';
import { renderIndustryPrompt } from './templateRenderer';

interface ContentGenerationServiceDeps {
  loader: IndustryPackLoader;
  store: IndustryPackStore;
  modelClient: ModelClientAdapter;
}

interface ParsedModelAsset {
  channel: string;
  theme: string;
  title: string;
  body: string;
  keywords?: string[];
  cta?: string;
}

export class ContentGenerationService {
  constructor(private readonly deps: ContentGenerationServiceDeps) {}

  async generate(request: IndustryGenerationRequest): Promise<{
    workspace: { id: string; packId: string; name: string };
    assets: GeneratedAsset[];
  }> {
    const normalized = normalizeGenerationRequest(request);
    const pack = this.deps.loader.getPack(String(normalized.packId));
    const workspace = this.deps.store.ensureWorkspace({
      packId: String(normalized.packId),
      name: `${pack.manifest.name}工作台`,
    });
    const prompt = renderIndustryPrompt(pack, normalized);
    const modelText = await this.deps.modelClient.generateText({ prompt, temperature: 0.7 });
    const parsed = this.parseModelText(modelText);
    const taskId = randomUUID();

    const assets = parsed.map(asset => this.deps.store.createGeneratedAsset({
      workspaceId: workspace.id,
      taskId,
      packId: String(normalized.packId),
      channel: asset.channel,
      theme: asset.theme,
      tone: normalized.tone,
      title: asset.title,
      body: asset.body,
      keywords: asset.keywords || [],
      cta: asset.cta || '',
      status: GeneratedAssetStatus.Draft,
    }));

    return { workspace, assets };
  }

  private parseModelText(text: string): ParsedModelAsset[] {
    const parsed = JSON.parse(text) as { assets?: ParsedModelAsset[] };
    if (!Array.isArray(parsed.assets)) {
      throw new Error('Model response must include an assets array');
    }
    return parsed.assets.filter(asset =>
      asset.channel && asset.theme && asset.title && asset.body,
    );
  }
}
```

- [ ] **Step 5: Run focused tests**

Run: `npm test -- src/main/industryPack/contentGenerationService.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Run changed-file lint**

Run: `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/industryPack/modelClientAdapter.ts src/main/industryPack/contentGenerationService.ts src/main/industryPack/contentGenerationService.test.ts`

Expected: no ESLint errors or warnings.

- [ ] **Step 7: Review checkpoint**

Confirm the service does not import Cowork/OpenClaw runtime adapter or skill manager modules.

## Task 6: IPC and Preload API

**Files:**
- Create: `src/main/industryPack/ipcHandlers.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`

- [ ] **Step 1: Keep IPC handlers thin and rely on service tests**

Do not add a separate IPC handler test for this MVP. `ipcHandlers.ts` should only translate IPC inputs into service method calls and convert thrown errors into `{ success: false, error }` responses. Behavioral coverage belongs in `industryPackLoader.test.ts`, `industryPackStore.test.ts`, `templateRenderer.test.ts`, `contentGenerationService.test.ts`, and `exportService.test.ts`.

- [ ] **Step 2: Add IPC handlers**

```ts
import { ipcMain } from 'electron';

import { IndustryMarketingIpc } from '../../shared/industryPack/constants';
import type { IndustryGenerationRequest } from '../../shared/industryPack/types';
import type { ContentGenerationService } from './contentGenerationService';
import type { IndustryPackLoader } from './industryPackLoader';
import type { IndustryPackStore } from './industryPackStore';

interface RegisterIndustryPackHandlersDeps {
  loader: IndustryPackLoader;
  store: IndustryPackStore;
  generationService: ContentGenerationService;
}

export function registerIndustryPackHandlers(deps: RegisterIndustryPackHandlersDeps): void {
  ipcMain.handle(IndustryMarketingIpc.ListPacks, async () => ({
    success: true,
    packs: deps.loader.listPacks(),
  }));

  ipcMain.handle(IndustryMarketingIpc.GetPack, async (_event, packId: string) => ({
    success: true,
    pack: deps.loader.getPack(packId),
  }));

  ipcMain.handle(IndustryMarketingIpc.Generate, async (_event, request: IndustryGenerationRequest) => {
    try {
      const result = await deps.generationService.generate(request);
      return { success: true, ...result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate content',
      };
    }
  });
}
```

- [ ] **Step 3: Wire handlers in `main.ts`**

Instantiate the loader, store, model client, and service near other startup service construction:

```ts
const industryPackLoader = new IndustryPackLoader({
  packsRoot: path.join(process.cwd(), 'resources', 'industry-packs'),
});
const industryPackStore = new IndustryPackStore(getStore().getDatabase());
const industryGenerationService = new ContentGenerationService({
  loader: industryPackLoader,
  store: industryPackStore,
  modelClient: createIndustryModelClientAdapter(() => getStore().get<AppConfigSettings>('app_config')),
});
registerIndustryPackHandlers({
  loader: industryPackLoader,
  store: industryPackStore,
  generationService: industryGenerationService,
});
```

Place the imports with the other main-process feature imports near the top of `src/main/main.ts`. Create the service instances in the same initialization area that creates other SQLite-backed feature services after `getStore()` is available. Register handlers inside the existing IPC handler registration flow, before app-ready long-running runtime startup logic begins.

- [ ] **Step 4: Expose preload API**

```ts
industryMarketing: {
  listPacks: () => ipcRenderer.invoke(IndustryMarketingIpc.ListPacks),
  getPack: (packId: string) => ipcRenderer.invoke(IndustryMarketingIpc.GetPack, packId),
  generate: (request: IndustryGenerationRequest) =>
    ipcRenderer.invoke(IndustryMarketingIpc.Generate, request),
  listAssets: (workspaceId: string) =>
    ipcRenderer.invoke(IndustryMarketingIpc.ListAssets, workspaceId),
  exportAsset: (assetId: string, format: 'markdown' | 'excel') =>
    ipcRenderer.invoke(IndustryMarketingIpc.ExportAsset, { assetId, format }),
}
```

- [ ] **Step 5: Run main compile**

Run: `npm run compile:electron`

Expected: compile succeeds.

- [ ] **Step 6: Run changed-file lint**

Run: `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/industryPack/ipcHandlers.ts src/main/main.ts src/main/preload.ts`

Expected: no ESLint errors or warnings in touched files.

- [ ] **Step 7: Review checkpoint**

Confirm the renderer cannot access API keys and sends only structured generation requests.

## Task 7: Renderer Industry Marketing Workspace

**Files:**
- Create: renderer module files listed in File Structure
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/Sidebar.tsx`
- Modify: `src/renderer/store/index.ts`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Add Redux slice tests**

```ts
import { describe, expect, test } from 'vitest';

import reducer, {
  setSelectedPackId,
  setGenerationConfig,
} from './industryMarketingSlice';

describe('industryMarketingSlice', () => {
  test('stores selected pack and generation config', () => {
    const state = reducer(undefined, setSelectedPackId('heavy-packaging'));
    const updated = reducer(state, setGenerationConfig({
      period: { kind: 'preset', days: 7 },
      channels: ['wechat_moments'],
      themes: ['anti_damage'],
      tone: 'boss',
    }));

    expect(updated.selectedPackId).toBe('heavy-packaging');
    expect(updated.generationConfig.period.days).toBe(7);
  });
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `npm test -- src/renderer/modules/industryMarketing/store/industryMarketingSlice.test.ts`

Expected: fails because the slice does not exist.

- [ ] **Step 3: Add renderer service wrapper**

```ts
import type { IndustryGenerationRequest } from '@shared/industryPack/types';

export const industryMarketingService = {
  listPacks: () => window.electron.industryMarketing.listPacks(),
  getPack: (packId: string) => window.electron.industryMarketing.getPack(packId),
  generate: (request: IndustryGenerationRequest) =>
    window.electron.industryMarketing.generate(request),
  listAssets: (workspaceId: string) =>
    window.electron.industryMarketing.listAssets(workspaceId),
  exportAsset: (assetId: string, format: 'markdown' | 'excel') =>
    window.electron.industryMarketing.exportAsset(assetId, format),
};
```

- [ ] **Step 4: Add Redux slice**

```ts
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { GenerationPeriod } from '@shared/industryPack/types';

interface GenerationConfigState {
  period: GenerationPeriod;
  channels: string[];
  themes: string[];
  tone: string;
}

interface IndustryMarketingState {
  selectedPackId: string;
  generationConfig: GenerationConfigState;
}

const initialState: IndustryMarketingState = {
  selectedPackId: 'heavy-packaging',
  generationConfig: {
    period: { kind: 'today', days: 1 },
    channels: ['wechat_moments'],
    themes: ['anti_damage'],
    tone: 'boss',
  },
};

const industryMarketingSlice = createSlice({
  name: 'industryMarketing',
  initialState,
  reducers: {
    setSelectedPackId(state, action: PayloadAction<string>) {
      state.selectedPackId = action.payload;
    },
    setGenerationConfig(state, action: PayloadAction<GenerationConfigState>) {
      state.generationConfig = action.payload;
    },
  },
});

export const { setSelectedPackId, setGenerationConfig } = industryMarketingSlice.actions;
export default industryMarketingSlice.reducer;
```

- [ ] **Step 5: Add focused UI components**

Build `IndustryMarketingView` as the actual first screen, not a landing page. It should show:

- Left column: factory/profile form and generation configuration.
- Main area: generated asset workspace.
- Primary action: generate content package.
- Empty state: brief, practical prompt to complete factory information.

Use existing Tailwind style patterns and compact operational UI. Avoid marketing hero layout.

- [ ] **Step 6: Wire app navigation**

Modify `App.tsx` main view union:

```ts
const [mainView, setMainView] = useState<'cowork' | 'skills' | 'scheduledTasks' | 'kits' | 'mcp' | 'industryMarketing'>('cowork');
```

Render:

```tsx
{mainView === 'industryMarketing' && <IndustryMarketingView />}
```

Modify `Sidebar.tsx` to add one navigation item using a relevant existing icon.

- [ ] **Step 7: Add i18n strings**

Add Chinese and English keys for:

```text
industryMarketingTitle
industryMarketingNav
industryMarketingGenerate
industryMarketingFactoryProfile
industryMarketingGeneratedAssets
industryMarketingCopy
industryMarketingExportMarkdown
industryMarketingExportExcel
```

- [ ] **Step 8: Run focused tests**

Run: `npm test -- src/renderer/modules/industryMarketing/store/industryMarketingSlice.test.ts`

Expected: all tests pass.

- [ ] **Step 9: Run build verification**

Run: `npm run build`

Expected: renderer TypeScript and Vite build succeed.

- [ ] **Step 10: Run changed-file lint**

Run: `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/modules/industryMarketing src/renderer/App.tsx src/renderer/components/Sidebar.tsx src/renderer/store/index.ts src/renderer/services/i18n.ts`

Expected: no ESLint errors or warnings in touched files.

- [ ] **Step 11: Review checkpoint**

Confirm the first screen is a business workflow and not a blank chat interface.

## Task 8: Export Service

**Files:**
- Create: `src/main/industryPack/exportService.ts`
- Create: `src/main/industryPack/exportService.test.ts`
- Modify: `src/main/industryPack/ipcHandlers.ts`

- [ ] **Step 1: Write export tests**

```ts
import { describe, expect, test } from 'vitest';

import { renderAssetMarkdown, renderCalendarCsvCompatibleRows } from './exportService';

describe('exportService', () => {
  test('renders a generated asset as markdown', () => {
    const markdown = renderAssetMarkdown({
      title: '重型纸箱防破损方案',
      channel: 'wechat_moments',
      theme: 'anti_damage',
      body: '根据重量和运输方式设计包装。',
      keywords: ['重型纸箱', '防破损'],
      cta: '发送尺寸和重量评估方案',
    });

    expect(markdown).toContain('# 重型纸箱防破损方案');
    expect(markdown).toContain('重型纸箱');
  });

  test('renders calendar rows for spreadsheet export', () => {
    const rows = renderCalendarCsvCompatibleRows([
      {
        day: 1,
        channel: 'wechat_moments',
        theme: 'anti_damage',
        title: '第 1 天内容',
        body: '内容正文',
        cta: '联系评估',
      },
    ]);

    expect(rows[0]).toEqual({
      day: 1,
      channel: 'wechat_moments',
      theme: 'anti_damage',
      title: '第 1 天内容',
      body: '内容正文',
      cta: '联系评估',
    });
  });
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `npm test -- src/main/industryPack/exportService.test.ts`

Expected: fails because export service does not exist.

- [ ] **Step 3: Implement Markdown and spreadsheet-row rendering**

```ts
interface ExportableAsset {
  title: string;
  channel: string;
  theme: string;
  body: string;
  keywords: string[];
  cta: string;
}

interface CalendarAsset {
  day: number;
  channel: string;
  theme: string;
  title: string;
  body: string;
  cta: string;
}

export function renderAssetMarkdown(asset: ExportableAsset): string {
  return [
    `# ${asset.title}`,
    '',
    `- 渠道：${asset.channel}`,
    `- 主题：${asset.theme}`,
    `- 关键词：${asset.keywords.join('、')}`,
    '',
    asset.body,
    '',
    `行动引导：${asset.cta}`,
  ].join('\n');
}

export function renderCalendarCsvCompatibleRows(assets: CalendarAsset[]) {
  return assets.map(asset => ({
    day: asset.day,
    channel: asset.channel,
    theme: asset.theme,
    title: asset.title,
    body: asset.body,
    cta: asset.cta,
  }));
}
```

- [ ] **Step 4: Wire export IPC**

Add an IPC branch that writes Markdown with `fs.writeFileSync`. For Excel, use the existing `xlsx` dependency to create one worksheet named `内容日历`.

```ts
import fs from 'node:fs';
import * as XLSX from 'xlsx';

export function writeMarkdownExport(filePath: string, markdown: string): void {
  fs.writeFileSync(filePath, markdown, 'utf8');
}

export function writeExcelExport(filePath: string, rows: Array<Record<string, unknown>>): void {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, '内容日历');
  XLSX.writeFile(workbook, filePath);
}
```

Resolve the save path in the main process by calling `dialog.showSaveDialog({ filters })` inside the export IPC handler. Return `{ success: false, canceled: true }` when the user cancels. The renderer receives only the final success, canceled state, error message, and saved file path.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- src/main/industryPack/exportService.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Run changed-file lint**

Run: `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/industryPack/exportService.ts src/main/industryPack/exportService.test.ts src/main/industryPack/ipcHandlers.ts`

Expected: no ESLint errors or warnings.

- [ ] **Step 7: Review checkpoint**

Confirm Word export remains absent from UI and IPC for MVP.

## Task 9: Final Verification

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run focused industry pack tests**

Run: `npm test -- industryPack industryMarketing`

Expected: all relevant new tests pass.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: all tests pass. If sandbox blocks 127.0.0.1 callback tests with `listen EPERM`, rerun the same command with approved elevated permissions.

- [ ] **Step 3: Run Electron compile**

Run: `npm run compile:electron`

Expected: Electron main and preload TypeScript compile succeeds.

- [ ] **Step 4: Run renderer build**

Run: `npm run build`

Expected: TypeScript and Vite build succeeds.

- [ ] **Step 5: Run changed-file lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/shared/industryPack/constants.ts \
  src/shared/industryPack/types.ts \
  src/shared/industryPack/validation.ts \
  src/shared/industryPack/validation.test.ts \
  src/main/industryPack/industryPackLoader.ts \
  src/main/industryPack/industryPackLoader.test.ts \
  src/main/industryPack/generationPlanner.ts \
  src/main/industryPack/templateRenderer.ts \
  src/main/industryPack/templateRenderer.test.ts \
  src/main/industryPack/industryPackStore.ts \
  src/main/industryPack/industryPackStore.test.ts \
  src/main/industryPack/modelClientAdapter.ts \
  src/main/industryPack/contentGenerationService.ts \
  src/main/industryPack/contentGenerationService.test.ts \
  src/main/industryPack/exportService.ts \
  src/main/industryPack/exportService.test.ts \
  src/main/industryPack/ipcHandlers.ts \
  src/main/main.ts \
  src/main/preload.ts \
  src/renderer/modules/industryMarketing \
  src/renderer/App.tsx \
  src/renderer/components/Sidebar.tsx \
  src/renderer/store/index.ts \
  src/renderer/services/i18n.ts
```

Expected: no ESLint errors or warnings in touched files.

- [ ] **Step 6: Manual validation**

Run: `npm run electron:dev`

Expected:

- The app opens.
- Sidebar shows the industry marketing workspace.
- The workspace renders factory/profile input, generation config, and empty asset workspace.
- User can select period, channels, themes, and tone.
- Generate action creates structured asset cards when a model is configured.
- Generated content can be copied.
- Markdown export works for content assets.
- Excel export works for content calendars.

- [ ] **Step 7: Diff review**

Check:

- No generated runtime/vendor files changed.
- No unrelated UI strings changed.
- No Cowork/OpenClaw Agent or Skill runtime dependency was added to the new generation path.
- No hard-coded single-day or one-week generation assumption exists.
- No automatic publishing, CRM, IM sending, file parsing, or Word export was added.

## Execution Options

Plan complete. Two execution options:

1. Subagent-Driven (recommended): dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution: execute tasks in this session using executing-plans, batch execution with checkpoints.
