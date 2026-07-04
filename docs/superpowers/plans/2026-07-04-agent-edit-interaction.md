# Agent Edit Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Agent Skills and External Research tabs faster to scan and configure without changing persistence or IPC.

**Architecture:** Add small renderer-only helper modules for filter, summary, and bulk-action logic, then update the shared Agent panel components to consume those helpers. The shared components are used by both create and edit flows, so the UI improvement lands in both places with one implementation path.

**Tech Stack:** React, TypeScript, Redux state selectors, Tailwind utility classes, Vitest, existing `i18nService`.

---

## File Structure

- Create `src/renderer/components/agent/agentSkillSelectorUi.ts`: skill filter ids, recommendation matching, filtered list builder.
- Create `src/renderer/components/agent/agentSkillSelectorUi.test.ts`: Vitest coverage for filter and recommendation behavior.
- Create `src/renderer/components/agent/agentDomesticResearchUi.ts`: domestic source counts and bulk action helpers.
- Create `src/renderer/components/agent/agentDomesticResearchUi.test.ts`: Vitest coverage for recommended/all/none source actions.
- Modify `src/renderer/components/agent/agentExternalResearchUi.ts`: derive provider readiness and summary data.
- Modify `src/renderer/components/agent/agentExternalResearchUi.test.ts`: add summary helper tests.
- Modify `src/renderer/components/agent/AgentSkillSelector.tsx`: render selected chips, quick filters, and compact skill rows.
- Modify `src/renderer/components/agent/AgentExternalResearchPanel.tsx`: render status summary and compact mode selector.
- Modify `src/renderer/components/agent/AgentDomesticResearchSourcesPanel.tsx`: render bulk source actions and use count helper.
- Modify `src/renderer/services/i18n.ts`: add Chinese and English UI strings.

No commits should be created during implementation. The repository instructions require waiting for user testing and confirmation before committing.

---

### Task 1: Skill Selector Helpers

**Files:**
- Create: `src/renderer/components/agent/agentSkillSelectorUi.ts`
- Create: `src/renderer/components/agent/agentSkillSelectorUi.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/components/agent/agentSkillSelectorUi.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import type { Skill } from '../../types/skill';
import {
  AgentSkillFilter,
  filterAgentSkills,
  isRecommendedAgentSkill,
} from './agentSkillSelectorUi';

const createSkill = (patch: Partial<Skill> & Pick<Skill, 'id' | 'name'>): Skill => ({
  description: '',
  enabled: true,
  isBuiltIn: false,
  isOfficial: false,
  prompt: '',
  skillPath: '',
  updatedAt: 0,
  ...patch,
});

describe('agent skill selector UI helpers', () => {
  test('recommends research and content related skills from id, name, or description', () => {
    expect(isRecommendedAgentSkill(createSkill({
      id: 'web-search',
      name: 'web-search',
      description: 'Search and read web pages.',
    }))).toBe(true);
    expect(isRecommendedAgentSkill(createSkill({
      id: 'custom-doc',
      name: '文档助理',
      description: '创建报告和方案。',
    }))).toBe(true);
    expect(isRecommendedAgentSkill(createSkill({
      id: 'unrelated',
      name: 'calendar',
      description: 'Manage meetings.',
    }))).toBe(false);
  });

  test('filters selected, recommended, built-in, and custom skills', () => {
    const skills = [
      createSkill({ id: 'docx', name: 'docx', isBuiltIn: true }),
      createSkill({ id: 'web-search', name: 'web-search', isBuiltIn: true }),
      createSkill({ id: 'custom-writing', name: '内容写作' }),
    ];

    expect(filterAgentSkills({
      skills,
      selectedSkillIds: ['docx'],
      filter: AgentSkillFilter.Selected,
      query: '',
      getDescription: skill => skill.description,
    }).map(skill => skill.id)).toEqual(['docx']);

    expect(filterAgentSkills({
      skills,
      selectedSkillIds: [],
      filter: AgentSkillFilter.Recommended,
      query: '',
      getDescription: skill => skill.description,
    }).map(skill => skill.id)).toEqual(['docx', 'web-search', 'custom-writing']);

    expect(filterAgentSkills({
      skills,
      selectedSkillIds: [],
      filter: AgentSkillFilter.BuiltIn,
      query: '',
      getDescription: skill => skill.description,
    }).map(skill => skill.id)).toEqual(['docx', 'web-search']);

    expect(filterAgentSkills({
      skills,
      selectedSkillIds: [],
      filter: AgentSkillFilter.Custom,
      query: '',
      getDescription: skill => skill.description,
    }).map(skill => skill.id)).toEqual(['custom-writing']);
  });

  test('matches search query against skill name and localized description', () => {
    const skills = [
      createSkill({ id: 'docx', name: 'docx', description: 'Word documents' }),
      createSkill({ id: 'imagegen', name: 'imagegen', description: 'Generate images' }),
    ];

    expect(filterAgentSkills({
      skills,
      selectedSkillIds: [],
      filter: AgentSkillFilter.All,
      query: '图片',
      getDescription: skill => skill.id === 'imagegen' ? '生成图片素材' : skill.description,
    }).map(skill => skill.id)).toEqual(['imagegen']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- src/renderer/components/agent/agentSkillSelectorUi.test.ts
```

Expected: FAIL because `agentSkillSelectorUi.ts` does not exist.

- [ ] **Step 3: Implement the helpers**

Create `src/renderer/components/agent/agentSkillSelectorUi.ts`:

```ts
import type { Skill } from '../../types/skill';

export const AgentSkillFilter = {
  All: 'all',
  Selected: 'selected',
  Recommended: 'recommended',
  BuiltIn: 'builtIn',
  Custom: 'custom',
} as const;

export type AgentSkillFilter = typeof AgentSkillFilter[keyof typeof AgentSkillFilter];

const RECOMMENDED_SKILL_KEYWORDS = [
  'web-search',
  'browser',
  'doc',
  'docx',
  'spreadsheet',
  'sheet',
  'image',
  'research',
  'search',
  '调研',
  '搜索',
  '文档',
  '报告',
  '方案',
  '图片',
  '表格',
  '内容',
  '推广',
];

const getSkillSearchText = (skill: Skill, description: string): string =>
  `${skill.id} ${skill.name} ${description}`.toLowerCase();

export const isRecommendedAgentSkill = (skill: Skill, description = skill.description): boolean => {
  const searchText = getSkillSearchText(skill, description);
  return RECOMMENDED_SKILL_KEYWORDS.some(keyword => searchText.includes(keyword.toLowerCase()));
};

export interface FilterAgentSkillsOptions {
  skills: Skill[];
  selectedSkillIds: string[];
  filter: AgentSkillFilter;
  query: string;
  getDescription: (skill: Skill) => string;
}

export const filterAgentSkills = ({
  skills,
  selectedSkillIds,
  filter,
  query,
  getDescription,
}: FilterAgentSkillsOptions): Skill[] => {
  const selectedIds = new Set(selectedSkillIds);
  const normalizedQuery = query.trim().toLowerCase();

  return skills.filter(skill => {
    const description = getDescription(skill);
    const matchesQuery = !normalizedQuery
      || getSkillSearchText(skill, description).includes(normalizedQuery);
    if (!matchesQuery) return false;

    if (filter === AgentSkillFilter.Selected) return selectedIds.has(skill.id);
    if (filter === AgentSkillFilter.Recommended) return isRecommendedAgentSkill(skill, description);
    if (filter === AgentSkillFilter.BuiltIn) return skill.isBuiltIn;
    if (filter === AgentSkillFilter.Custom) return !skill.isBuiltIn;
    return true;
  });
};
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run:

```bash
npm test -- src/renderer/components/agent/agentSkillSelectorUi.test.ts
```

Expected: PASS.

---

### Task 2: Domestic Research Helpers

**Files:**
- Create: `src/renderer/components/agent/agentDomesticResearchUi.ts`
- Create: `src/renderer/components/agent/agentDomesticResearchUi.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/components/agent/agentDomesticResearchUi.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import {
  buildDefaultDomesticResearchConfig,
  DomesticResearchSourceId,
} from '@shared/agent/domesticResearch';
import {
  applyDomesticResearchBulkAction,
  DomesticResearchBulkAction,
  getDomesticResearchSourceCount,
} from './agentDomesticResearchUi';

describe('agent domestic research UI helpers', () => {
  test('counts enabled built-in and custom sources', () => {
    const config = buildDefaultDomesticResearchConfig();
    config.sources.xiaohongshu.enabled = false;
    config.customSources = [{
      id: 'custom-1',
      name: '竞品案例',
      enabled: true,
      modes: ['url_import'],
      urls: [],
    }];

    expect(getDomesticResearchSourceCount(config)).toEqual({
      enabled: 6,
      total: 7,
    });
  });

  test('enables recommended searchable sources and leaves custom sources unchanged', () => {
    const config = buildDefaultDomesticResearchConfig();
    const next = applyDomesticResearchBulkAction(config, DomesticResearchBulkAction.Recommended);

    expect(next.sources[DomesticResearchSourceId.Bilibili].enabled).toBe(true);
    expect(next.sources[DomesticResearchSourceId.WeChatOfficialAccounts].enabled).toBe(true);
    expect(next.sources[DomesticResearchSourceId.Xiaohongshu].enabled).toBe(false);
    expect(next.sources[DomesticResearchSourceId.Douyin].enabled).toBe(false);
  });

  test('enables and disables all built-in and custom sources', () => {
    const config = buildDefaultDomesticResearchConfig();
    config.customSources = [{
      id: 'custom-1',
      name: '竞品案例',
      enabled: false,
      modes: ['url_import'],
      urls: [],
    }];

    const allEnabled = applyDomesticResearchBulkAction(config, DomesticResearchBulkAction.EnableAll);
    expect(Object.values(allEnabled.sources).every(source => source.enabled)).toBe(true);
    expect(allEnabled.customSources[0].enabled).toBe(true);

    const allDisabled = applyDomesticResearchBulkAction(allEnabled, DomesticResearchBulkAction.DisableAll);
    expect(Object.values(allDisabled.sources).every(source => !source.enabled)).toBe(true);
    expect(allDisabled.customSources[0].enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- src/renderer/components/agent/agentDomesticResearchUi.test.ts
```

Expected: FAIL because `agentDomesticResearchUi.ts` does not exist.

- [ ] **Step 3: Implement the helpers**

Create `src/renderer/components/agent/agentDomesticResearchUi.ts`:

```ts
import {
  type DomesticResearchConfig,
  DomesticResearchMode,
  DomesticResearchSourceIds,
} from '@shared/agent/domesticResearch';

export const DomesticResearchBulkAction = {
  Recommended: 'recommended',
  EnableAll: 'enableAll',
  DisableAll: 'disableAll',
} as const;

export type DomesticResearchBulkAction =
  typeof DomesticResearchBulkAction[keyof typeof DomesticResearchBulkAction];

export interface DomesticResearchSourceCount {
  enabled: number;
  total: number;
}

export const getDomesticResearchSourceCount = (
  config: DomesticResearchConfig,
): DomesticResearchSourceCount => {
  const enabled = DomesticResearchSourceIds.filter(sourceId => config.sources[sourceId].enabled).length
    + config.customSources.filter(source => source.enabled).length;
  return {
    enabled,
    total: DomesticResearchSourceIds.length + config.customSources.length,
  };
};

const shouldEnableRecommendedSource = (
  config: DomesticResearchConfig,
  sourceId: typeof DomesticResearchSourceIds[number],
): boolean => config.sources[sourceId].modes.includes(DomesticResearchMode.Search);

export const applyDomesticResearchBulkAction = (
  config: DomesticResearchConfig,
  action: DomesticResearchBulkAction,
): DomesticResearchConfig => ({
  ...config,
  sources: DomesticResearchSourceIds.reduce((sources, sourceId) => ({
    ...sources,
    [sourceId]: {
      ...config.sources[sourceId],
      enabled: action === DomesticResearchBulkAction.Recommended
        ? shouldEnableRecommendedSource(config, sourceId)
        : action === DomesticResearchBulkAction.EnableAll,
    },
  }), config.sources),
  customSources: action === DomesticResearchBulkAction.Recommended
    ? config.customSources
    : config.customSources.map(source => ({
      ...source,
      enabled: action === DomesticResearchBulkAction.EnableAll,
    })),
});
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run:

```bash
npm test -- src/renderer/components/agent/agentDomesticResearchUi.test.ts
```

Expected: PASS.

---

### Task 3: External Research Summary Helpers

**Files:**
- Modify: `src/renderer/components/agent/agentExternalResearchUi.ts`
- Modify: `src/renderer/components/agent/agentExternalResearchUi.test.ts`

- [ ] **Step 1: Add failing tests**

Append tests to `src/renderer/components/agent/agentExternalResearchUi.test.ts`:

```ts
import {
  AgentExternalResearchMode,
  ExternalResearchProviderId,
  type ExternalResearchEditConfig,
  type MaskedExternalResearchConfig,
} from '@shared/agent/externalResearch';
import { getExternalResearchSummary } from './agentExternalResearchUi';

const createEditConfig = (): ExternalResearchEditConfig => ({
  mode: AgentExternalResearchMode.Override,
  providers: {
    [ExternalResearchProviderId.Tavily]: {
      enabled: true,
      apiKeyAction: 'replace',
      apiKey: 'tvly-test',
    },
    [ExternalResearchProviderId.Firecrawl]: {
      enabled: false,
      apiKeyAction: 'preserve',
      apiKey: '',
    },
  },
});

const createDefaults = (): MaskedExternalResearchConfig => ({
  mode: AgentExternalResearchMode.Inherit,
  providers: {
    [ExternalResearchProviderId.Tavily]: {
      enabled: true,
      hasApiKey: true,
      apiKeyPreview: 'tvly...test',
    },
    [ExternalResearchProviderId.Firecrawl]: {
      enabled: false,
      hasApiKey: false,
      apiKeyPreview: '',
    },
  },
});

test('summarizes override provider readiness from edit config', () => {
  expect(getExternalResearchSummary(createEditConfig(), createDefaults()).providers).toEqual({
    configured: 1,
    enabled: 1,
    total: 2,
  });
});

test('summarizes inherited provider readiness from app defaults', () => {
  const value = createEditConfig();
  value.mode = AgentExternalResearchMode.Inherit;

  expect(getExternalResearchSummary(value, createDefaults())).toEqual({
    mode: AgentExternalResearchMode.Inherit,
    providers: {
      configured: 1,
      enabled: 1,
      total: 2,
    },
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- src/renderer/components/agent/agentExternalResearchUi.test.ts
```

Expected: FAIL because `getExternalResearchSummary` is not exported.

- [ ] **Step 3: Implement the summary helper**

Add to `src/renderer/components/agent/agentExternalResearchUi.ts`:

```ts
import {
  AgentExternalResearchMode,
  type ExternalResearchEditConfig,
  ExternalResearchProviderIds,
  type MaskedExternalResearchConfig,
} from '@shared/agent/externalResearch';

export interface ExternalResearchSummary {
  mode: ExternalResearchEditConfig['mode'];
  providers: {
    configured: number;
    enabled: number;
    total: number;
  };
}

export const getExternalResearchSummary = (
  value: ExternalResearchEditConfig,
  appDefaults: MaskedExternalResearchConfig | null,
): ExternalResearchSummary => {
  const providers = ExternalResearchProviderIds.map(providerId => {
    if (value.mode === AgentExternalResearchMode.Inherit) {
      const provider = appDefaults?.providers[providerId];
      return {
        configured: Boolean(provider?.hasApiKey),
        enabled: Boolean(provider?.enabled),
      };
    }
    const provider = value.providers[providerId];
    return {
      configured: provider.apiKey.trim().length > 0,
      enabled: provider.enabled,
    };
  });

  return {
    mode: value.mode,
    providers: {
      configured: providers.filter(provider => provider.configured).length,
      enabled: providers.filter(provider => provider.enabled).length,
      total: providers.length,
    },
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npm test -- src/renderer/components/agent/agentExternalResearchUi.test.ts
```

Expected: PASS.

---

### Task 4: Skill Selector UI

**Files:**
- Modify: `src/renderer/components/agent/AgentSkillSelector.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Add i18n strings**

Add Chinese keys near existing `agentSkills*` strings:

```ts
agentSkillsSelectedTitle: '已选技能',
agentSkillsAvailableTitle: '可用技能',
agentSkillsSelectedEmpty: '还没有单独限制技能，保存后会默认使用所有已启用技能。',
agentSkillsFilterAll: '全部',
agentSkillsFilterSelected: '已选',
agentSkillsFilterRecommended: '推荐',
agentSkillsFilterBuiltIn: '内置',
agentSkillsFilterCustom: '自定义',
agentSkillsRecommendedHint: '推荐筛选会优先显示适合推广、调研和内容生产的技能。',
agentSkillsRemoveSkill: '移除 {skill}',
```

Add English keys near existing `agentSkills*` strings:

```ts
agentSkillsSelectedTitle: 'Selected skills',
agentSkillsAvailableTitle: 'Available skills',
agentSkillsSelectedEmpty: 'No skill limit is set. After saving, this Agent can use all enabled skills.',
agentSkillsFilterAll: 'All',
agentSkillsFilterSelected: 'Selected',
agentSkillsFilterRecommended: 'Recommended',
agentSkillsFilterBuiltIn: 'Built-in',
agentSkillsFilterCustom: 'Custom',
agentSkillsRecommendedHint: 'Recommended prioritizes skills useful for promotion, research, and content work.',
agentSkillsRemoveSkill: 'Remove {skill}',
```

- [ ] **Step 2: Update `AgentSkillSelector.tsx` imports and state**

Import `XMarkIcon` and the helper:

```ts
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import {
  AgentSkillFilter,
  filterAgentSkills,
} from './agentSkillSelectorUi';
```

Add state:

```ts
const [filter, setFilter] = useState<AgentSkillFilter>(AgentSkillFilter.All);
```

- [ ] **Step 3: Replace local filtering with helper filtering**

Use:

```ts
const getDescription = (skill: Skill) =>
  skillService.getLocalizedSkillDescription(skill.id, skill.name, skill.description);

const filteredSkills = filterAgentSkills({
  skills: enabledSkills,
  selectedSkillIds,
  filter,
  query: search,
  getDescription,
});

const selectedSkills = selectedSkillIds
  .map(id => enabledSkills.find(skill => skill.id === id))
  .filter((skill): skill is Skill => Boolean(skill));
```

- [ ] **Step 4: Render selected chips and quick filters**

Replace the top summary block with a compact header that includes:

```tsx
<div className="shrink-0 rounded-lg border border-border bg-surface-raised/40 px-3.5 py-3">
  <div className="flex flex-wrap items-center justify-between gap-2">
    <div>
      <div className="text-sm font-semibold text-foreground">{selectionText}</div>
      <div className="mt-1 text-xs leading-5 text-secondary">{i18nService.t('agentSkillsHint')}</div>
    </div>
    {selectedSkillIds.length > 0 && (
      <button type="button" onClick={() => onChange([])} className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-secondary transition-colors hover:bg-surface-raised hover:text-foreground">
        {i18nService.t('agentSkillsClearSelection')}
      </button>
    )}
  </div>
  <div className="mt-3 flex flex-wrap gap-2">
    {selectedSkills.length === 0 ? (
      <span className="text-xs leading-6 text-secondary/75">{i18nService.t('agentSkillsSelectedEmpty')}</span>
    ) : selectedSkills.map(skill => (
      <button key={skill.id} type="button" onClick={() => toggle(skill.id)} aria-label={i18nService.t('agentSkillsRemoveSkill').replace('{skill}', skill.name)} className="inline-flex max-w-[180px] items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
        <span className="truncate">{skill.name}</span>
        <XMarkIcon className="h-3.5 w-3.5 shrink-0" />
      </button>
    ))}
  </div>
</div>
```

Render filter buttons below search:

```tsx
const filterOptions = [
  [AgentSkillFilter.All, 'agentSkillsFilterAll'],
  [AgentSkillFilter.Selected, 'agentSkillsFilterSelected'],
  [AgentSkillFilter.Recommended, 'agentSkillsFilterRecommended'],
  [AgentSkillFilter.BuiltIn, 'agentSkillsFilterBuiltIn'],
  [AgentSkillFilter.Custom, 'agentSkillsFilterCustom'],
] as const;
```

Use small segmented buttons with selected state `border-primary bg-primary/10 text-primary`.

- [ ] **Step 5: Replace cards with compact rows**

Render each skill as a full-width button with min height around `72px`, icon, title/badge, two-line description, and right-side checkbox.

- [ ] **Step 6: Run helper tests**

Run:

```bash
npm test -- src/renderer/components/agent/agentSkillSelectorUi.test.ts
```

Expected: PASS.

---

### Task 5: External Research UI

**Files:**
- Modify: `src/renderer/components/agent/AgentExternalResearchPanel.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Add i18n strings**

Add Chinese keys:

```ts
agentExternalResearchSummaryMode: '调研模式',
agentExternalResearchSummaryProviders: '服务商',
agentExternalResearchSummaryProviderCount: '已配置 {configured}/{total} · 启用 {enabled}',
agentExternalResearchModeInheritShort: '默认',
agentExternalResearchModeOverrideShort: '单独配置',
agentExternalResearchModeDisabledShort: '关闭',
agentExternalResearchConfigured: '已配置',
agentExternalResearchUnconfigured: '未配置',
```

Add English keys:

```ts
agentExternalResearchSummaryMode: 'Research mode',
agentExternalResearchSummaryProviders: 'Providers',
agentExternalResearchSummaryProviderCount: '{configured}/{total} configured · {enabled} enabled',
agentExternalResearchModeInheritShort: 'Default',
agentExternalResearchModeOverrideShort: 'Custom',
agentExternalResearchModeDisabledShort: 'Off',
agentExternalResearchConfigured: 'Configured',
agentExternalResearchUnconfigured: 'Not configured',
```

- [ ] **Step 2: Use summary helper**

Import and use:

```ts
import {
  type ExternalResearchTestResult,
  getExternalResearchSummary,
  getExternalResearchTestFeedback,
} from './agentExternalResearchUi';
```

Inside component:

```ts
const summary = getExternalResearchSummary(value, appDefaults);
```

- [ ] **Step 3: Render status summary above controls**

Add a three-column summary before mode selection:

```tsx
<div className="grid gap-2 sm:grid-cols-2">
  <div className="rounded-lg border border-border-subtle bg-surface-raised/40 px-3 py-2.5">
    <div className="text-[11px] font-medium uppercase text-secondary">{i18nService.t('agentExternalResearchSummaryMode')}</div>
    <div className="mt-1 text-sm font-semibold text-foreground">{i18nService.t(modeShortLabelKeys[value.mode])}</div>
  </div>
  <div className="rounded-lg border border-border-subtle bg-surface-raised/40 px-3 py-2.5">
    <div className="text-[11px] font-medium uppercase text-secondary">{i18nService.t('agentExternalResearchSummaryProviders')}</div>
    <div className="mt-1 text-sm font-semibold text-foreground">
      {i18nService.t('agentExternalResearchSummaryProviderCount')
        .replace('{configured}', String(summary.providers.configured))
        .replace('{total}', String(summary.providers.total))
        .replace('{enabled}', String(summary.providers.enabled))}
    </div>
  </div>
</div>
```

- [ ] **Step 4: Replace large mode cards with segmented buttons**

Use mode options with short labels:

```ts
const modeShortLabelKeys = {
  [AgentExternalResearchMode.Inherit]: 'agentExternalResearchModeInheritShort',
  [AgentExternalResearchMode.Override]: 'agentExternalResearchModeOverrideShort',
  [AgentExternalResearchMode.Disabled]: 'agentExternalResearchModeDisabledShort',
} as const;
```

Render a compact button group with hints below the selected mode.

- [ ] **Step 5: Add configured state to provider rows**

For each provider row, show a small status pill:

```tsx
const isConfigured = provider.apiKey.trim().length > 0;
```

Use `agentExternalResearchConfigured` or `agentExternalResearchUnconfigured`.

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- src/renderer/components/agent/agentExternalResearchUi.test.ts
```

Expected: PASS.

---

### Task 6: Domestic Research UI

**Files:**
- Modify: `src/renderer/components/agent/AgentDomesticResearchSourcesPanel.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Add i18n strings**

Add Chinese keys:

```ts
agentDomesticResearchBulkRecommended: '启用推荐来源',
agentDomesticResearchBulkAll: '全部开启',
agentDomesticResearchBulkNone: '全部关闭',
```

Add English keys:

```ts
agentDomesticResearchBulkRecommended: 'Use recommended',
agentDomesticResearchBulkAll: 'Enable all',
agentDomesticResearchBulkNone: 'Disable all',
```

- [ ] **Step 2: Import domestic helpers**

```ts
import {
  applyDomesticResearchBulkAction,
  DomesticResearchBulkAction,
  getDomesticResearchSourceCount,
} from './agentDomesticResearchUi';
```

- [ ] **Step 3: Replace inline source counting**

Use:

```ts
const sourceCount = getDomesticResearchSourceCount(value);
```

Replace `enabledCount` and `totalCount` references with `sourceCount.enabled` and `sourceCount.total`.

- [ ] **Step 4: Render bulk action buttons**

Add buttons near the source count:

```tsx
<div className="flex flex-wrap gap-2">
  <button type="button" onClick={() => onChange(applyDomesticResearchBulkAction(value, DomesticResearchBulkAction.Recommended))} className="h-8 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised">
    {i18nService.t('agentDomesticResearchBulkRecommended')}
  </button>
  <button type="button" onClick={() => onChange(applyDomesticResearchBulkAction(value, DomesticResearchBulkAction.EnableAll))} className="h-8 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised">
    {i18nService.t('agentDomesticResearchBulkAll')}
  </button>
  <button type="button" onClick={() => onChange(applyDomesticResearchBulkAction(value, DomesticResearchBulkAction.DisableAll))} className="h-8 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-secondary transition-colors hover:bg-surface-raised hover:text-foreground">
    {i18nService.t('agentDomesticResearchBulkNone')}
  </button>
</div>
```

- [ ] **Step 5: Run domestic helper tests**

Run:

```bash
npm test -- src/renderer/components/agent/agentDomesticResearchUi.test.ts
```

Expected: PASS.

---

### Task 7: Verification

**Files:**
- No new files.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- src/renderer/components/agent/agentSkillSelectorUi.test.ts src/renderer/components/agent/agentDomesticResearchUi.test.ts src/renderer/components/agent/agentExternalResearchUi.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 2: Run touched-file lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/agent/AgentSkillSelector.tsx src/renderer/components/agent/AgentExternalResearchPanel.tsx src/renderer/components/agent/AgentDomesticResearchSourcesPanel.tsx src/renderer/components/agent/agentSkillSelectorUi.ts src/renderer/components/agent/agentSkillSelectorUi.test.ts src/renderer/components/agent/agentDomesticResearchUi.ts src/renderer/components/agent/agentDomesticResearchUi.test.ts src/renderer/components/agent/agentExternalResearchUi.ts src/renderer/components/agent/agentExternalResearchUi.test.ts src/renderer/services/i18n.ts
```

Expected: exits with code 0 and no warnings.

- [ ] **Step 3: Start local app for manual validation**

Run:

```bash
npm run electron:dev
```

Expected: app opens successfully. In create and edit Agent flows, Skills and External Research tabs show the refined controls, and save behavior remains unchanged.

- [ ] **Step 4: Review diff before handoff**

Run:

```bash
git diff -- src/renderer/components/agent src/renderer/services/i18n.ts docs/superpowers/specs/2026-07-04-agent-edit-interaction-design.md docs/superpowers/plans/2026-07-04-agent-edit-interaction.md
```

Expected: diff is limited to planned files and contains no unrelated formatting churn.
