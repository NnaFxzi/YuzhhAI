# Marketing Agent Positioning Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured product-positioning research workflow so `推广agent` can research multiple product directions, score them, save a recommendation, and reuse the recommended direction in later promotion content.

**Architecture:** Keep the user-facing flow in `推广agent`, while adding focused industry-pack domain modules for positioning contracts, scoring, persistence, and report reuse. OpenClaw gets a small local extension tool that lets the agent save and read positioning reports through LobsterAI's existing local callback server after it performs external research with available search tools.

**Tech Stack:** TypeScript, Electron IPC/callback server, OpenClaw local extension, better-sqlite3, Vitest, existing industry pack loader/store/generation services.

---

## File Structure

- Create `src/shared/industryPack/positioning.ts`
  - Owns shared request/report/score/confidence types and validation helpers for product-positioning analysis.
- Create `src/main/industryPack/positioningCandidates.ts`
  - Converts a loaded industry pack into candidate product directions.
- Create `src/main/industryPack/positioningService.ts`
  - Saves validated reports, reads the latest report, and builds reusable prompt context.
- Modify `src/main/industryPack/industryPackStore.ts`
  - Adds `industry_positioning_reports` persistence methods.
- Modify `src/main/industryPack/contentGenerationService.ts`
  - Injects latest positioning context into later content generation prompts when available.
- Modify `src/main/libs/mcpBridgeServer.ts`
  - Adds a typed callback handler for industry-positioning tool requests.
- Modify `src/main/mcp/mcpRuntime.ts`
  - Registers the industry-positioning callback handler and exposes its callback URL.
- Create `openclaw-extensions/lobster-industry-positioning/index.ts`
  - Registers `lobsterai_industry_positioning_save` and `lobsterai_industry_positioning_get_latest`.
- Create `openclaw-extensions/lobster-industry-positioning/package.json`
  - Declares the local extension entry.
- Create `openclaw-extensions/lobster-industry-positioning/openclaw.plugin.json`
  - Declares extension metadata and tool names.
- Modify `src/main/libs/openclawConfigSync.ts`
  - Enables and configures the local extension when bundled.
- Modify `src/main/libs/openclawExtensionManifests.test.ts`
  - Verifies the extension manifest contract.
- Modify `src/main/presetAgents.ts`
  - Teaches `推广agent` to perform external research, score directions, save the report, and reuse the main direction.
- Modify `src/main/agentManager.test.ts`
  - Pins the prompt behavior.

Do not create a commit while executing this plan unless the user explicitly asks for one. The repository instruction overrides the generic plan-template habit of frequent commits.

## Task 1: Add Shared Positioning Contract

**Files:**
- Create: `src/shared/industryPack/positioning.ts`
- Test: `src/shared/industryPack/positioning.test.ts`

- [ ] **Step 1: Write failing tests for report validation**

Create `src/shared/industryPack/positioning.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { IndustryPackId } from './constants';
import {
  PositioningConfidence,
  PositioningResearchLane,
  PositioningScoreFactor,
  normalizePositioningReportInput,
  validatePositioningReportInput,
} from './positioning';

describe('positioning report validation', () => {
  test('normalizes a valid positioning report input', () => {
    const normalized = normalizePositioningReportInput({
      packId: IndustryPackId.HeavyPackaging,
      requestedBy: 'agent',
      recommendedDirectionId: 'wooden_box_replacement',
      sourceSummary: {
        lanes: [
          {
            lane: PositioningResearchLane.Search,
            confidence: PositioningConfidence.High,
            summary: '客户主动搜索替代木箱和出口免熏蒸包装。',
            keywords: ['替代木箱', '出口免熏蒸'],
            painPoints: ['木箱成本高', '出口熏蒸麻烦'],
            competitorSignals: [],
            opportunitySignals: ['方案型表达少'],
          },
        ],
      },
      candidates: [
        {
          id: 'wooden_box_replacement',
          name: '替代木箱包装',
          summary: '适合出口重货和项目制发货客户。',
          scores: {
            [PositioningScoreFactor.MarketDemand]: {
              score: 5,
              reason: '搜索词有明确采购意图。',
            },
            [PositioningScoreFactor.CompetitiveOpportunity]: {
              score: 4,
              reason: '同行多讲产品参数，方案表达较少。',
            },
            [PositioningScoreFactor.FactoryFit]: {
              score: 4,
              reason: '工厂有重型纸箱和蜂窝箱能力。',
            },
            [PositioningScoreFactor.DealFeasibility]: {
              score: 4,
              reason: '客户可以直接提供尺寸重量询价。',
            },
            [PositioningScoreFactor.ContentExpansion]: {
              score: 5,
              reason: '可覆盖百度、1688、朋友圈和微信群。',
            },
          },
          keywords: ['替代木箱', '重型纸箱'],
          painPoints: ['木箱成本高'],
          competitorSignals: ['厂家直销', '可定制'],
          opportunitySignals: ['整体方案表达不足'],
          recommendedChannels: ['baidu_seo', '1688', 'wechat_moments'],
          missingFacts: ['真实客户案例'],
        },
      ],
      backupDirectionIds: ['honeycomb_carton'],
      nextActions: ['生成百度 SEO 文章', '生成朋友圈案例'],
    });

    expect(normalized.candidates[0].totalScore).toBe(22);
    expect(normalized.candidates[0].confidence).toBe(PositioningConfidence.High);
    expect(normalized.backupDirectionIds).toEqual(['honeycomb_carton']);
  });

  test('rejects missing recommended direction', () => {
    const result = validatePositioningReportInput({
      packId: IndustryPackId.HeavyPackaging,
      requestedBy: 'agent',
      recommendedDirectionId: 'missing',
      sourceSummary: { lanes: [] },
      candidates: [],
      backupDirectionIds: [],
      nextActions: [],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('recommendedDirectionId must match a candidate id');
  });

  test('rejects scores outside one to five', () => {
    const result = validatePositioningReportInput({
      packId: IndustryPackId.HeavyPackaging,
      requestedBy: 'agent',
      recommendedDirectionId: 'direction-1',
      sourceSummary: { lanes: [] },
      candidates: [
        {
          id: 'direction-1',
          name: '方向一',
          summary: '测试方向',
          scores: {
            [PositioningScoreFactor.MarketDemand]: {
              score: 6,
              reason: '错误分数',
            },
          },
          keywords: [],
          painPoints: [],
          competitorSignals: [],
          opportunitySignals: [],
          recommendedChannels: [],
          missingFacts: [],
        },
      ],
      backupDirectionIds: [],
      nextActions: [],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('candidate direction-1 score market_demand must be between 1 and 5');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/shared/industryPack/positioning.test.ts
```

Expected: fail because `src/shared/industryPack/positioning.ts` does not exist.

- [ ] **Step 3: Add positioning contract implementation**

Create `src/shared/industryPack/positioning.ts`:

```ts
import type { IndustryPackId } from './constants';
import type { ValidationResult } from './types';

export const PositioningResearchLane = {
  Search: 'search',
  Competitor1688: '1688_competitor',
  ContentPlatform: 'content_platform',
} as const;
export type PositioningResearchLane =
  typeof PositioningResearchLane[keyof typeof PositioningResearchLane];

export const PositioningConfidence = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
} as const;
export type PositioningConfidence =
  typeof PositioningConfidence[keyof typeof PositioningConfidence];

export const PositioningScoreFactor = {
  MarketDemand: 'market_demand',
  CompetitiveOpportunity: 'competitive_opportunity',
  FactoryFit: 'factory_fit',
  DealFeasibility: 'deal_feasibility',
  ContentExpansion: 'content_expansion',
} as const;
export type PositioningScoreFactor =
  typeof PositioningScoreFactor[keyof typeof PositioningScoreFactor];

export const PositioningRequester = {
  Agent: 'agent',
  Renderer: 'renderer',
} as const;
export type PositioningRequester =
  typeof PositioningRequester[keyof typeof PositioningRequester];

export interface PositioningLaneSummary {
  lane: PositioningResearchLane;
  confidence: PositioningConfidence;
  summary: string;
  keywords: string[];
  painPoints: string[];
  competitorSignals: string[];
  opportunitySignals: string[];
  researchedAt?: string;
}

export interface PositioningSourceSummary {
  lanes: PositioningLaneSummary[];
}

export interface PositioningFactorScore {
  score: number;
  reason: string;
}

export type PositioningFactorScores = Partial<Record<PositioningScoreFactor, PositioningFactorScore>>;

export interface PositioningCandidateInput {
  id: string;
  name: string;
  summary: string;
  scores: PositioningFactorScores;
  keywords: string[];
  painPoints: string[];
  competitorSignals: string[];
  opportunitySignals: string[];
  recommendedChannels: string[];
  missingFacts: string[];
}

export interface PositioningCandidateReport extends PositioningCandidateInput {
  totalScore: number;
  confidence: PositioningConfidence;
}

export interface PositioningReportInput {
  packId: IndustryPackId | string;
  requestedBy: PositioningRequester | string;
  recommendedDirectionId: string;
  sourceSummary: PositioningSourceSummary;
  candidates: PositioningCandidateInput[];
  backupDirectionIds: string[];
  nextActions: string[];
}

export interface PositioningReport extends Omit<PositioningReportInput, 'candidates'> {
  id: string;
  candidates: PositioningCandidateReport[];
  createdAt: string;
  updatedAt: string;
}

const SCORE_FACTORS: PositioningScoreFactor[] = [
  PositioningScoreFactor.MarketDemand,
  PositioningScoreFactor.CompetitiveOpportunity,
  PositioningScoreFactor.FactoryFit,
  PositioningScoreFactor.DealFeasibility,
  PositioningScoreFactor.ContentExpansion,
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const cleanText = (value: string): string => value.trim();

const cleanTextList = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.filter(hasText).map(item => item.trim()).filter(Boolean)))
    : [];

const readConfidence = (value: unknown): PositioningConfidence => {
  if (
    value === PositioningConfidence.Low ||
    value === PositioningConfidence.Medium ||
    value === PositioningConfidence.High
  ) {
    return value;
  }
  return PositioningConfidence.Medium;
};

const inferConfidence = (scores: PositioningFactorScores): PositioningConfidence => {
  const scoreCount = SCORE_FACTORS.filter(factor => scores[factor]).length;
  if (scoreCount >= 5) return PositioningConfidence.High;
  if (scoreCount >= 3) return PositioningConfidence.Medium;
  return PositioningConfidence.Low;
};

export function validatePositioningReportInput(value: unknown): ValidationResult {
  const errors: string[] = [];
  const input = value as Partial<PositioningReportInput> | null;

  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['positioning report input must be an object'] };
  }
  if (!hasText(input.packId)) errors.push('packId is required');
  if (!hasText(input.requestedBy)) errors.push('requestedBy is required');
  if (!hasText(input.recommendedDirectionId)) errors.push('recommendedDirectionId is required');
  if (!isRecord(input.sourceSummary) || !Array.isArray(input.sourceSummary.lanes)) {
    errors.push('sourceSummary.lanes must be an array');
  }
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    errors.push('candidates must include at least one candidate');
  }

  const candidateIds = new Set<string>();
  if (Array.isArray(input.candidates)) {
    input.candidates.forEach((candidate, index) => {
      if (!candidate || typeof candidate !== 'object') {
        errors.push(`candidate ${index} must be an object`);
        return;
      }
      if (!hasText(candidate.id)) {
        errors.push(`candidate ${index} id is required`);
      } else {
        candidateIds.add(candidate.id.trim());
      }
      if (!hasText(candidate.name)) errors.push(`candidate ${index} name is required`);
      if (!hasText(candidate.summary)) errors.push(`candidate ${index} summary is required`);

      const scores = isRecord(candidate.scores) ? candidate.scores : {};
      for (const factor of Object.values(PositioningScoreFactor)) {
        const score = scores[factor];
        if (score === undefined) continue;
        if (!isRecord(score)) {
          errors.push(`candidate ${candidate.id || index} score ${factor} must be an object`);
          continue;
        }
        if (typeof score.score !== 'number' || score.score < 1 || score.score > 5) {
          errors.push(`candidate ${candidate.id || index} score ${factor} must be between 1 and 5`);
        }
        if (!hasText(score.reason)) {
          errors.push(`candidate ${candidate.id || index} score ${factor} reason is required`);
        }
      }
    });
  }

  if (hasText(input.recommendedDirectionId) && !candidateIds.has(input.recommendedDirectionId.trim())) {
    errors.push('recommendedDirectionId must match a candidate id');
  }

  return { ok: errors.length === 0, errors };
}

export function normalizePositioningReportInput(input: PositioningReportInput): Omit<PositioningReport, 'id' | 'createdAt' | 'updatedAt'> {
  const validation = validatePositioningReportInput(input);
  if (!validation.ok) {
    throw new Error(`Invalid positioning report input: ${validation.errors.join('; ')}`);
  }

  const candidates = input.candidates.map(candidate => {
    const totalScore = SCORE_FACTORS.reduce((sum, factor) => {
      const score = candidate.scores[factor]?.score;
      return sum + (typeof score === 'number' ? score : 0);
    }, 0);

    return {
      ...candidate,
      id: cleanText(candidate.id),
      name: cleanText(candidate.name),
      summary: cleanText(candidate.summary),
      keywords: cleanTextList(candidate.keywords),
      painPoints: cleanTextList(candidate.painPoints),
      competitorSignals: cleanTextList(candidate.competitorSignals),
      opportunitySignals: cleanTextList(candidate.opportunitySignals),
      recommendedChannels: cleanTextList(candidate.recommendedChannels),
      missingFacts: cleanTextList(candidate.missingFacts),
      totalScore,
      confidence: inferConfidence(candidate.scores),
    };
  });

  return {
    packId: cleanText(String(input.packId)),
    requestedBy: cleanText(String(input.requestedBy)),
    recommendedDirectionId: cleanText(input.recommendedDirectionId),
    sourceSummary: {
      lanes: input.sourceSummary.lanes.map(lane => ({
        lane: lane.lane,
        confidence: readConfidence(lane.confidence),
        summary: cleanText(lane.summary || ''),
        keywords: cleanTextList(lane.keywords),
        painPoints: cleanTextList(lane.painPoints),
        competitorSignals: cleanTextList(lane.competitorSignals),
        opportunitySignals: cleanTextList(lane.opportunitySignals),
        researchedAt: hasText(lane.researchedAt) ? lane.researchedAt.trim() : undefined,
      })),
    },
    candidates,
    backupDirectionIds: cleanTextList(input.backupDirectionIds),
    nextActions: cleanTextList(input.nextActions),
  };
}
```

- [ ] **Step 4: Run shared contract tests**

Run:

```bash
npm test -- src/shared/industryPack/positioning.test.ts
```

Expected: pass.

## Task 2: Generate Candidate Product Directions From Industry Packs

**Files:**
- Create: `src/main/industryPack/positioningCandidates.ts`
- Test: `src/main/industryPack/positioningCandidates.test.ts`

- [ ] **Step 1: Write failing candidate tests**

Create `src/main/industryPack/positioningCandidates.test.ts`:

```ts
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { IndustryPackId } from '../../shared/industryPack/constants';
import { IndustryPackLoader } from './industryPackLoader';
import { buildPositioningCandidates } from './positioningCandidates';

describe('buildPositioningCandidates', () => {
  test('uses bundled products and solution directions from the heavy packaging pack', () => {
    const loader = new IndustryPackLoader({
      packsRoot: path.resolve(process.cwd(), 'resources/industry-packs'),
    });
    const pack = loader.getPack(IndustryPackId.HeavyPackaging);

    const candidates = buildPositioningCandidates(pack);

    expect(candidates.map(candidate => candidate.id)).toEqual(expect.arrayContaining([
      'heavy_corrugated_carton',
      'honeycomb_carton',
      'paper_edge_protector',
      'paper_pallet',
      'wooden_box_replacement',
      'solution_auto_parts_packaging',
      'solution_machinery_equipment_packaging',
      'solution_export_packaging',
      'solution_large_product_transportation',
    ]));
    expect(candidates.find(candidate => candidate.id === 'wooden_box_replacement')).toMatchObject({
      name: '替代木箱包装',
      keywords: expect.arrayContaining(['替代木箱']),
    });
  });

  test('narrows candidates when requested product ids are provided', () => {
    const loader = new IndustryPackLoader({
      packsRoot: path.resolve(process.cwd(), 'resources/industry-packs'),
    });
    const pack = loader.getPack(IndustryPackId.HeavyPackaging);

    const candidates = buildPositioningCandidates(pack, {
      requestedDirectionIds: ['paper_pallet', 'wooden_box_replacement'],
    });

    expect(candidates.map(candidate => candidate.id)).toEqual([
      'paper_pallet',
      'wooden_box_replacement',
    ]);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/main/industryPack/positioningCandidates.test.ts
```

Expected: fail because `positioningCandidates.ts` does not exist.

- [ ] **Step 3: Implement candidate generation**

Create `src/main/industryPack/positioningCandidates.ts`:

```ts
import type { LoadedIndustryPack } from './industryPackLoader';

interface IndustryPackProduct {
  id: string;
  name?: string;
  keywords?: string[];
  useCases?: string[];
  sellingPoints?: string[];
}

export interface PositioningCandidateDirection {
  id: string;
  name: string;
  keywords: string[];
  useCases: string[];
  sellingPoints: string[];
  source: 'product' | 'solution';
}

export interface BuildPositioningCandidatesOptions {
  requestedDirectionIds?: string[];
}

const SOLUTION_DIRECTIONS: PositioningCandidateDirection[] = [
  {
    id: 'solution_auto_parts_packaging',
    name: '汽配零部件包装方案',
    keywords: ['汽配包装', '汽车零部件包装', '重型纸箱'],
    useCases: ['汽车零部件', '五金模具', '长途运输'],
    sellingPoints: ['防破损', '按重量尺寸定制', '适合批量供货'],
    source: 'solution',
  },
  {
    id: 'solution_machinery_equipment_packaging',
    name: '机械设备包装方案',
    keywords: ['机械设备包装', '设备运输包装', '重型包装'],
    useCases: ['机械设备', '电机设备', '大件产品'],
    sellingPoints: ['结构加固', '替代木箱', '运输防护'],
    source: 'solution',
  },
  {
    id: 'solution_export_packaging',
    name: '出口免熏蒸包装方案',
    keywords: ['出口免熏蒸包装', '替代木箱', '纸托盘'],
    useCases: ['出口货物', '项目制发货', '跨境运输'],
    sellingPoints: ['免熏蒸', '降低木材成本', '交期更灵活'],
    source: 'solution',
  },
  {
    id: 'solution_large_product_transportation',
    name: '大件产品运输包装方案',
    keywords: ['大件产品包装', '重货包装', '防破损运输'],
    useCases: ['大件产品', '异形件', '仓储周转'],
    sellingPoints: ['防边角压伤', '适配装卸场景', '支持内衬护角组合'],
    source: 'solution',
  },
];

const isProduct = (value: unknown): value is IndustryPackProduct =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && typeof (value as IndustryPackProduct).id === 'string';

const cleanList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map(item => item.trim())
    : [];

export function buildPositioningCandidates(
  pack: LoadedIndustryPack,
  options: BuildPositioningCandidatesOptions = {},
): PositioningCandidateDirection[] {
  const productCandidates = pack.products
    .filter(isProduct)
    .map(product => ({
      id: product.id.trim(),
      name: product.name?.trim() || product.id.trim(),
      keywords: cleanList(product.keywords),
      useCases: cleanList(product.useCases),
      sellingPoints: cleanList(product.sellingPoints),
      source: 'product' as const,
    }));

  const allCandidates = [...productCandidates, ...SOLUTION_DIRECTIONS];
  const requestedIds = new Set(options.requestedDirectionIds?.map(id => id.trim()).filter(Boolean));

  if (requestedIds.size === 0) {
    return allCandidates;
  }

  return allCandidates.filter(candidate => requestedIds.has(candidate.id));
}
```

- [ ] **Step 4: Run candidate tests**

Run:

```bash
npm test -- src/main/industryPack/positioningCandidates.test.ts
```

Expected: pass.

## Task 3: Persist Positioning Reports

**Files:**
- Modify: `src/main/industryPack/industryPackStore.ts`
- Test: `src/main/industryPack/industryPackStore.test.ts`

- [ ] **Step 1: Add failing store tests**

Append to `src/main/industryPack/industryPackStore.test.ts`:

```ts
  test('saves and reads the latest positioning report for a pack', () => {
    setupStore();

    const first = store.createPositioningReport({
      packId: IndustryPackId.HeavyPackaging,
      requestedBy: 'agent',
      recommendedDirectionId: 'wooden_box_replacement',
      sourceSummary: { lanes: [] },
      candidates: [
        {
          id: 'wooden_box_replacement',
          name: '替代木箱包装',
          summary: '适合出口重货。',
          scores: {},
          keywords: ['替代木箱'],
          painPoints: ['木箱成本高'],
          competitorSignals: ['厂家直销'],
          opportunitySignals: ['方案表达不足'],
          recommendedChannels: ['baidu_seo'],
          missingFacts: ['案例'],
        },
      ],
      backupDirectionIds: [],
      nextActions: ['生成百度 SEO 文章'],
    });
    const second = store.createPositioningReport({
      packId: IndustryPackId.HeavyPackaging,
      requestedBy: 'agent',
      recommendedDirectionId: 'honeycomb_carton',
      sourceSummary: { lanes: [] },
      candidates: [
        {
          id: 'honeycomb_carton',
          name: '蜂窝纸箱',
          summary: '适合缓冲包装。',
          scores: {},
          keywords: ['蜂窝纸箱'],
          painPoints: ['大件易损'],
          competitorSignals: ['缓冲包装'],
          opportunitySignals: ['轻量化表达'],
          recommendedChannels: ['wechat_moments'],
          missingFacts: [],
        },
      ],
      backupDirectionIds: ['wooden_box_replacement'],
      nextActions: ['生成朋友圈案例'],
    });

    expect(store.getPositioningReport(first.id)?.recommendedDirectionId).toBe('wooden_box_replacement');
    expect(store.getLatestPositioningReport(IndustryPackId.HeavyPackaging)?.id).toBe(second.id);
  });
```

- [ ] **Step 2: Run the failing store test**

Run:

```bash
npm test -- src/main/industryPack/industryPackStore.test.ts
```

Expected: fail because `IndustryPackStore` does not have positioning report methods.

- [ ] **Step 3: Add store imports and row helpers**

Modify `src/main/industryPack/industryPackStore.ts`:

```ts
import type {
  PositioningReport,
  PositioningReportInput,
} from '../../shared/industryPack/positioning';
import { normalizePositioningReportInput } from '../../shared/industryPack/positioning';

type PositioningReportRow = Omit<PositioningReport, 'sourceSummary' | 'candidates' | 'backupDirectionIds' | 'nextActions'> & {
  sourceSummary: string;
  candidates: string;
  backupDirectionIds: string;
  nextActions: string;
};

const parseJsonValue = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const mapPositioningReportRow = (row: PositioningReportRow): PositioningReport => ({
  ...row,
  sourceSummary: parseJsonValue(row.sourceSummary, { lanes: [] }),
  candidates: parseJsonValue(row.candidates, []),
  backupDirectionIds: parseJsonValue(row.backupDirectionIds, []),
  nextActions: parseJsonValue(row.nextActions, []),
});
```

- [ ] **Step 4: Add table creation**

Inside `initialize()` in `IndustryPackStore`, add the table after `industry_generated_assets`:

```ts
      CREATE TABLE IF NOT EXISTS industry_positioning_reports (
        id TEXT PRIMARY KEY,
        pack_id TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        recommended_direction_id TEXT NOT NULL,
        source_summary TEXT NOT NULL,
        candidates TEXT NOT NULL,
        backup_direction_ids TEXT NOT NULL,
        next_actions TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
```

- [ ] **Step 5: Add create/read methods**

Add methods to `IndustryPackStore`:

```ts
  createPositioningReport(input: PositioningReportInput): PositioningReport {
    const normalized = normalizePositioningReportInput(input);
    const now = new Date().toISOString();
    const report: PositioningReport = {
      id: randomUUID(),
      ...normalized,
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO industry_positioning_reports (
        id,
        pack_id,
        requested_by,
        recommended_direction_id,
        source_summary,
        candidates,
        backup_direction_ids,
        next_actions,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      report.id,
      report.packId,
      report.requestedBy,
      report.recommendedDirectionId,
      JSON.stringify(report.sourceSummary),
      JSON.stringify(report.candidates),
      JSON.stringify(report.backupDirectionIds),
      JSON.stringify(report.nextActions),
      report.createdAt,
      report.updatedAt,
    );

    return report;
  }

  getPositioningReport(reportId: string): PositioningReport | null {
    const row = this.db.prepare(`
      SELECT
        id,
        pack_id as packId,
        requested_by as requestedBy,
        recommended_direction_id as recommendedDirectionId,
        source_summary as sourceSummary,
        candidates,
        backup_direction_ids as backupDirectionIds,
        next_actions as nextActions,
        created_at as createdAt,
        updated_at as updatedAt
      FROM industry_positioning_reports
      WHERE id = ?
      LIMIT 1
    `).get(reportId) as PositioningReportRow | undefined;

    return row ? mapPositioningReportRow(row) : null;
  }

  getLatestPositioningReport(packId: string): PositioningReport | null {
    const row = this.db.prepare(`
      SELECT
        id,
        pack_id as packId,
        requested_by as requestedBy,
        recommended_direction_id as recommendedDirectionId,
        source_summary as sourceSummary,
        candidates,
        backup_direction_ids as backupDirectionIds,
        next_actions as nextActions,
        created_at as createdAt,
        updated_at as updatedAt
      FROM industry_positioning_reports
      WHERE pack_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `).get(packId) as PositioningReportRow | undefined;

    return row ? mapPositioningReportRow(row) : null;
  }
```

- [ ] **Step 6: Run store tests**

Run:

```bash
npm test -- src/main/industryPack/industryPackStore.test.ts
```

Expected: pass.

## Task 4: Add Positioning Service And Prompt Context Reuse

**Files:**
- Create: `src/main/industryPack/positioningService.ts`
- Modify: `src/main/industryPack/contentGenerationService.ts`
- Test: `src/main/industryPack/positioningService.test.ts`
- Test: `src/main/industryPack/contentGenerationService.test.ts`

- [ ] **Step 1: Write failing positioning service tests**

Create `src/main/industryPack/positioningService.test.ts`:

```ts
import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import { IndustryPackId } from '../../shared/industryPack/constants';
import { PositioningService } from './positioningService';
import { IndustryPackStore } from './industryPackStore';

describe('PositioningService', () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  test('saves a report and builds compact reusable context', () => {
    db = new Database(':memory:');
    const store = new IndustryPackStore(db);
    const service = new PositioningService({ store });

    const report = service.saveReport({
      packId: IndustryPackId.HeavyPackaging,
      requestedBy: 'agent',
      recommendedDirectionId: 'wooden_box_replacement',
      sourceSummary: { lanes: [] },
      candidates: [
        {
          id: 'wooden_box_replacement',
          name: '替代木箱包装',
          summary: '适合出口重货和项目制发货客户。',
          scores: {},
          keywords: ['替代木箱', '出口免熏蒸'],
          painPoints: ['木箱成本高', '出口熏蒸麻烦'],
          competitorSignals: ['厂家直销'],
          opportunitySignals: ['整体方案表达不足'],
          recommendedChannels: ['baidu_seo', '1688', 'wechat_moments'],
          missingFacts: ['真实客户案例'],
        },
      ],
      backupDirectionIds: [],
      nextActions: ['生成百度 SEO 文章'],
    });

    expect(report.recommendedDirectionId).toBe('wooden_box_replacement');
    expect(service.buildLatestPromptContext(IndustryPackId.HeavyPackaging)).toContain('替代木箱包装');
    expect(service.buildLatestPromptContext(IndustryPackId.HeavyPackaging)).toContain('出口免熏蒸');
  });
});
```

- [ ] **Step 2: Run the failing service test**

Run:

```bash
npm test -- src/main/industryPack/positioningService.test.ts
```

Expected: fail because `PositioningService` does not exist.

- [ ] **Step 3: Implement positioning service**

Create `src/main/industryPack/positioningService.ts`:

```ts
import type {
  PositioningCandidateReport,
  PositioningReport,
  PositioningReportInput,
} from '../../shared/industryPack/positioning';
import type { IndustryPackStore } from './industryPackStore';

interface PositioningServiceOptions {
  store: Pick<IndustryPackStore, 'createPositioningReport' | 'getLatestPositioningReport'>;
}

const findRecommendedCandidate = (report: PositioningReport): PositioningCandidateReport | undefined =>
  report.candidates.find(candidate => candidate.id === report.recommendedDirectionId);

export class PositioningService {
  constructor(private readonly options: PositioningServiceOptions) {}

  saveReport(input: PositioningReportInput): PositioningReport {
    return this.options.store.createPositioningReport(input);
  }

  getLatestReport(packId: string): PositioningReport | null {
    return this.options.store.getLatestPositioningReport(packId);
  }

  buildLatestPromptContext(packId: string): string {
    const report = this.getLatestReport(packId);
    if (!report) return '';

    const recommended = findRecommendedCandidate(report);
    if (!recommended) return '';

    const lines = [
      '## 已保存的产品定位分析',
      `推荐主推方向：${recommended.name}`,
      `定位摘要：${recommended.summary}`,
    ];

    if (recommended.keywords.length > 0) {
      lines.push(`关键词：${recommended.keywords.join('、')}`);
    }
    if (recommended.painPoints.length > 0) {
      lines.push(`客户痛点：${recommended.painPoints.join('、')}`);
    }
    if (recommended.opportunitySignals.length > 0) {
      lines.push(`机会点：${recommended.opportunitySignals.join('、')}`);
    }
    if (recommended.recommendedChannels.length > 0) {
      lines.push(`优先渠道：${recommended.recommendedChannels.join('、')}`);
    }
    if (recommended.missingFacts.length > 0) {
      lines.push(`后续可补资料：${recommended.missingFacts.join('、')}`);
    }

    return lines.join('\n');
  }
}
```

- [ ] **Step 4: Add failing content-generation reuse test**

Append to `src/main/industryPack/contentGenerationService.test.ts`:

```ts
  test('includes saved positioning context in later generation prompts', async () => {
    let prompt = '';
    const setup = createService({
      async generate(input) {
        prompt = input.prompt;
        return {
          text: JSON.stringify({
            channel: IndustryPackChannel.WechatMoments,
            theme: 'replace_wooden_box',
            title: '替代木箱包装怎么选',
            body: '先看出口、重量和运输线路。',
            keywords: ['替代木箱'],
            cta: '发尺寸重量，帮你评估。',
          }),
        };
      },
    });
    db = setup.db;
    setup.store.createPositioningReport({
      packId: IndustryPackId.HeavyPackaging,
      requestedBy: 'agent',
      recommendedDirectionId: 'wooden_box_replacement',
      sourceSummary: { lanes: [] },
      candidates: [
        {
          id: 'wooden_box_replacement',
          name: '替代木箱包装',
          summary: '适合出口重货。',
          scores: {},
          keywords: ['替代木箱'],
          painPoints: ['木箱成本高'],
          competitorSignals: [],
          opportunitySignals: ['整体方案表达不足'],
          recommendedChannels: ['baidu_seo'],
          missingFacts: [],
        },
      ],
      backupDirectionIds: [],
      nextActions: [],
    });

    await setup.service.generate({
      packId: IndustryPackId.HeavyPackaging,
      taskId: IndustryPackTask.GenerateContentPackage,
      period: { kind: 'today', days: 1 },
      channels: [IndustryPackChannel.WechatMoments],
      themes: ['replace_wooden_box'],
      tone: 'professional_sales',
      profile: { factoryName: '东莞重包包装厂' },
    });

    expect(prompt).toContain('已保存的产品定位分析');
    expect(prompt).toContain('推荐主推方向：替代木箱包装');
  });
```

- [ ] **Step 5: Modify content generation service to accept positioning service**

Modify `src/main/industryPack/contentGenerationService.ts`:

```ts
import type { PositioningService } from './positioningService';

interface ContentGenerationServiceOptions {
  loader: IndustryPackLoader;
  modelClient: ModelClientAdapter;
  store: IndustryPackStore;
  positioningService?: Pick<PositioningService, 'buildLatestPromptContext'>;
}
```

Then change prompt construction in `generate()`:

```ts
    const basePrompt = renderIndustryPrompt(pack, normalizedRequest);
    const positioningContext = this.options.positioningService
      ?.buildLatestPromptContext(String(normalizedRequest.packId))
      .trim();
    const prompt = positioningContext
      ? `${basePrompt}\n\n${positioningContext}\n`
      : basePrompt;
```

- [ ] **Step 6: Update test setup to inject the service**

In `src/main/industryPack/contentGenerationService.test.ts`, import and instantiate `PositioningService` in `createService`:

```ts
import { PositioningService } from './positioningService';
```

Inside `createService`:

```ts
  const positioningService = new PositioningService({ store });

  return {
    db,
    service: new ContentGenerationService({
      loader,
      modelClient,
      store,
      positioningService,
    }),
    store,
  };
```

- [ ] **Step 7: Run service tests**

Run:

```bash
npm test -- src/main/industryPack/positioningService.test.ts src/main/industryPack/contentGenerationService.test.ts
```

Expected: pass.

## Task 5: Add OpenClaw Tool Bridge For Saving And Reading Reports

**Files:**
- Modify: `src/main/libs/mcpBridgeServer.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/libs/openclawConfigSync.ts`
- Create: `openclaw-extensions/lobster-industry-positioning/index.ts`
- Create: `openclaw-extensions/lobster-industry-positioning/package.json`
- Create: `openclaw-extensions/lobster-industry-positioning/openclaw.plugin.json`
- Test: `src/main/libs/openclawExtensionManifests.test.ts`
- Test: `src/main/libs/openclawConfigSync.runtime.test.ts`

- [ ] **Step 1: Add extension manifest test expectations**

Modify `src/main/libs/openclawExtensionManifests.test.ts`:

```ts
  test('declares local industry positioning tool contract', () => {
    expect(readContractTools('lobster-industry-positioning')).toEqual([
      'lobsterai_industry_positioning_save',
      'lobsterai_industry_positioning_get_latest',
    ]);
  });

  test('declares TypeScript entry for industry positioning extension', () => {
    expect(readPackageOpenClawExtensions('lobster-industry-positioning')).toEqual(['./index.ts']);
  });
```

- [ ] **Step 2: Run failing manifest test**

Run:

```bash
npm test -- src/main/libs/openclawExtensionManifests.test.ts
```

Expected: fail because the extension files do not exist.

- [ ] **Step 3: Add extension package metadata**

Create `openclaw-extensions/lobster-industry-positioning/package.json`:

```json
{
  "name": "openclaw-lobster-industry-positioning",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "openclaw": {
    "extensions": [
      "./index.ts"
    ]
  },
  "dependencies": {
    "@sinclair/typebox": "0.34.49"
  }
}
```

Create `openclaw-extensions/lobster-industry-positioning/openclaw.plugin.json`:

```json
{
  "id": "lobster-industry-positioning",
  "name": "LobsterAI Industry Positioning",
  "description": "Save and read structured industry positioning reports from LobsterAI desktop.",
  "version": "1.0.0",
  "tools": [
    "lobsterai_industry_positioning_save",
    "lobsterai_industry_positioning_get_latest"
  ],
  "configSchema": {
    "type": "object",
    "properties": {
      "callbackUrl": {
        "type": "string"
      },
      "secret": {
        "type": "string"
      },
      "requestTimeoutMs": {
        "type": "number"
      }
    }
  }
}
```

- [ ] **Step 4: Implement the OpenClaw extension**

Create `openclaw-extensions/lobster-industry-positioning/index.ts`:

```ts
import { Type } from '@sinclair/typebox';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';

type PluginConfig = {
  callbackUrl: string;
  secret: string;
  requestTimeoutMs: number;
};

type ToolRequest = {
  tool: string;
  args: Record<string, unknown>;
  context: {
    sessionKey: string;
    toolCallId: string;
  };
};

type ToolResponse = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  details?: Record<string, unknown>;
};

const DEFAULT_TIMEOUT_MS = 120_000;

const SaveReportSchema = Type.Object({
  packId: Type.String({ description: 'Industry pack id. Use "heavy-packaging" for the bundled heavy packaging pack.' }),
  recommendedDirectionId: Type.String({ description: 'Candidate id selected as the main promotion direction.' }),
  sourceSummary: Type.Record(Type.String(), Type.Unknown(), { description: 'Structured research lane summaries.' }),
  candidates: Type.Array(Type.Record(Type.String(), Type.Unknown()), { minItems: 1, description: 'Scored candidate direction reports.' }),
  backupDirectionIds: Type.Optional(Type.Array(Type.String(), { description: 'Backup candidate ids.' })),
  nextActions: Type.Optional(Type.Array(Type.String(), { description: 'Recommended next actions.' })),
});

const GetLatestSchema = Type.Object({
  packId: Type.String({ description: 'Industry pack id. Use "heavy-packaging" for the bundled heavy packaging pack.' }),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parsePluginConfig = (value: unknown): PluginConfig => {
  const raw = isRecord(value) ? value : {};
  return {
    callbackUrl: typeof raw.callbackUrl === 'string' ? raw.callbackUrl.trim() : '',
    secret: typeof raw.secret === 'string' ? raw.secret.trim() : '',
    requestTimeoutMs: typeof raw.requestTimeoutMs === 'number' ? raw.requestTimeoutMs : DEFAULT_TIMEOUT_MS,
  };
};

async function callBridge(config: PluginConfig, request: ToolRequest): Promise<ToolResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetch(config.callbackUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-lobster-industry-positioning-secret': config.secret,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Industry positioning callback HTTP ${response.status}: ${text.trim() || response.statusText}`);
    }
    if (!text.trim()) {
      return { content: [{ type: 'text', text: 'No response from LobsterAI.' }], isError: true };
    }

    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed) && Array.isArray(parsed.content)) {
      return parsed as ToolResponse;
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }],
      details: isRecord(parsed) ? parsed : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

const plugin = {
  id: 'lobster-industry-positioning',
  name: 'LobsterAI Industry Positioning',
  description: 'Save and read structured industry positioning reports from LobsterAI desktop.',
  configSchema: {
    parse(value: unknown): PluginConfig {
      return parsePluginConfig(value);
    },
  },
  register(api: OpenClawPluginApi) {
    const config = parsePluginConfig(api.pluginConfig);
    if (!config.callbackUrl || !config.secret) {
      api.logger.info('[lobster-industry-positioning] skipped: callbackUrl or secret not configured.');
      return;
    }

    api.registerTool({
      name: 'lobsterai_industry_positioning_save',
      label: 'Save Industry Positioning Report',
      description: [
        'Save a structured product-positioning report after researching keywords, 1688 competitors, and content-platform pain points.',
        'Use after you have scored candidate product directions and selected the main promotion direction.',
      ].join(' '),
      parameters: SaveReportSchema,
      async execute(id: string, args: Record<string, unknown>, ctx?: { sessionKey?: string }) {
        try {
          return await callBridge(config, {
            tool: 'lobsterai_industry_positioning_save',
            args,
            context: {
              sessionKey: ctx?.sessionKey ?? '',
              toolCallId: id,
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { content: [{ type: 'text', text: message }], isError: true };
        }
      },
    });

    api.registerTool({
      name: 'lobsterai_industry_positioning_get_latest',
      label: 'Get Latest Industry Positioning Report',
      description: 'Read the latest saved product-positioning recommendation for an industry pack.',
      parameters: GetLatestSchema,
      async execute(id: string, args: Record<string, unknown>, ctx?: { sessionKey?: string }) {
        try {
          return await callBridge(config, {
            tool: 'lobsterai_industry_positioning_get_latest',
            args,
            context: {
              sessionKey: ctx?.sessionKey ?? '',
              toolCallId: id,
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { content: [{ type: 'text', text: message }], isError: true };
        }
      },
    });

    api.logger.info('[lobster-industry-positioning] registered industry positioning tools.');
  },
};

export default plugin;
```

- [ ] **Step 5: Extend callback server types and handler registration**

Modify `src/main/libs/mcpBridgeServer.ts` by adding request/response types:

```ts
export type IndustryPositioningToolRequest = {
  tool: string;
  args: Record<string, unknown>;
  context?: {
    sessionKey?: string;
    toolCallId?: string;
  };
};

export type IndustryPositioningToolResponse = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  details?: Record<string, unknown>;
};
```

Add a private callback field:

```ts
  private onIndustryPositioningCallback:
    ((request: IndustryPositioningToolRequest) => Promise<IndustryPositioningToolResponse>) | null = null;
```

Add a public registration method:

```ts
  onIndustryPositioning(callback: (request: IndustryPositioningToolRequest) => Promise<IndustryPositioningToolResponse>): void {
    this.onIndustryPositioningCallback = callback;
  }
```

Add a callback URL getter beside `askUserCallbackUrl` and `mediaCallbackUrl`:

```ts
  get industryPositioningCallbackUrl(): string | null {
    return this.port ? `http://127.0.0.1:${this.port}/industry-positioning-callback` : null;
  }
```

Update auth header support:

```ts
    const authHeader = req.headers['x-mcp-bridge-secret']
      || req.headers['x-ask-user-secret']
      || req.headers['x-lobster-media-secret']
      || req.headers['x-lobster-industry-positioning-secret'];
```

Route the callback path beside media generation:

```ts
    if (url.pathname === '/industry-positioning-callback') {
      await this.handleIndustryPositioning(req, res);
      return;
    }
```

Add the handler:

```ts
  private async handleIndustryPositioning(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await readRequestBody(req);
      const request = JSON.parse(body) as IndustryPositioningToolRequest;

      if (!this.onIndustryPositioningCallback) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Industry positioning callback not registered' }));
        return;
      }

      const result = await this.onIndustryPositioningCallback(request);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        error: error instanceof Error ? error.message : 'Industry positioning callback failed',
      }));
    }
  }
```

- [ ] **Step 6: Extend McpRuntime with an industry positioning handler**

Modify imports in `src/main/mcp/mcpRuntime.ts`:

```ts
import {
  type AskUserRequest,
  type AskUserResponse,
  type IndustryPositioningToolRequest,
  type IndustryPositioningToolResponse,
  McpBridgeServer,
  type MediaGenerationRequest,
  type MediaGenerationResponse,
} from '../libs/mcpBridgeServer';
```

Modify the exported types:

```ts
export type {
  AskUserResponse,
  IndustryPositioningToolRequest,
  IndustryPositioningToolResponse,
  MediaGenerationRequest,
  MediaGenerationResponse,
};
```

Add a private handler field:

```ts
  private industryPositioningHandler:
    | ((request: IndustryPositioningToolRequest) => Promise<IndustryPositioningToolResponse>)
    | null = null;
```

Add setter and callback URL getter beside the media equivalents:

```ts
  setIndustryPositioningHandler(
    handler: (request: IndustryPositioningToolRequest) => Promise<IndustryPositioningToolResponse>,
  ): void {
    this.industryPositioningHandler = handler;
  }

  getIndustryPositioningCallbackUrl(): string | null {
    return this.bridgeServer?.industryPositioningCallbackUrl ?? null;
  }
```

Inside `startAskUserServer()`, register the bridge callback after
`this.bridgeServer.onMediaGeneration(...)`:

```ts
    this.bridgeServer.onIndustryPositioning(async (request) => {
      if (!this.industryPositioningHandler) {
        return {
          content: [{ type: 'text', text: 'Industry positioning service is not ready yet.' }],
          isError: true,
        };
      }
      return await this.industryPositioningHandler(request);
    });
```

- [ ] **Step 7: Wire callback handling in main process**

Modify `src/main/main.ts` near the existing media callback setup:

```ts
  getMcpRuntime().setIndustryPositioningHandler(async (request) => {
    const positioningService = getPositioningService();

    if (request.tool === 'lobsterai_industry_positioning_get_latest') {
      const packId = typeof request.args.packId === 'string' ? request.args.packId : '';
      const report = positioningService.getLatestReport(packId);
      return {
        content: [{
          type: 'text',
          text: report
            ? JSON.stringify(report, null, 2)
            : `No positioning report saved for ${packId || 'unknown pack'}.`,
        }],
        details: report ? { reportId: report.id } : undefined,
      };
    }

    if (request.tool === 'lobsterai_industry_positioning_save') {
      const report = positioningService.saveReport({
        ...request.args,
        requestedBy: 'agent',
      } as PositioningReportInput);
      return {
        content: [{
          type: 'text',
          text: `Saved positioning report ${report.id}. Recommended direction: ${report.recommendedDirectionId}.`,
        }],
        details: { reportId: report.id, recommendedDirectionId: report.recommendedDirectionId },
      };
    }

    return {
      content: [{ type: 'text', text: `Unsupported industry positioning tool: ${request.tool}` }],
      isError: true,
    };
  });
```

Also create a lazy `getPositioningService()` helper near the existing industry
pack service helpers:

```ts
let positioningService: PositioningService | null = null;

const getPositioningService = (): PositioningService => {
  if (!positioningService) {
    positioningService = new PositioningService({
      store: getIndustryPackStore(),
    });
  }
  return positioningService;
};
```

- [ ] **Step 8: Configure the extension in OpenClaw config sync**

Modify `src/main/libs/openclawConfigSync.ts`:

```ts
    const hasIndustryPositioningPlugin = isBundledPluginAvailable('lobster-industry-positioning');
```

Add it to built-in plugin entries:

```ts
          ...(hasIndustryPositioningPlugin ? { 'lobster-industry-positioning': { enabled: true } } : {}),
```

Add config after media generation config:

```ts
    const industryPositioningCallbackUrl = this.getIndustryPositioningCallbackUrl?.();
    if (hasIndustryPositioningPlugin && industryPositioningCallbackUrl && managedConfig.plugins) {
      const plugins = managedConfig.plugins as Record<string, unknown>;
      const entries = plugins.entries as Record<string, Record<string, unknown>>;
      entries['lobster-industry-positioning'] = {
        enabled: true,
        config: {
          callbackUrl: industryPositioningCallbackUrl,
          secret: '${LOBSTER_MCP_BRIDGE_SECRET}',
          requestTimeoutMs: 120000,
        },
      };
    }
```

Add `getIndustryPositioningCallbackUrl?: () => string | null` to
`OpenClawConfigSyncDeps`, assign it in the constructor, and pass
`() => getMcpRuntime().getIndustryPositioningCallbackUrl()` from `src/main/main.ts`
where `OpenClawConfigSync` is created.

- [ ] **Step 9: Run extension and config tests**

Run:

```bash
npm test -- src/main/libs/openclawExtensionManifests.test.ts src/main/libs/openclawConfigSync.runtime.test.ts
```

Expected: pass after adding or updating config-sync assertions for the new plugin.

## Task 6: Teach The Marketing Agent Prompt To Use Positioning Research

**Files:**
- Modify: `src/main/presetAgents.ts`
- Test: `src/main/agentManager.test.ts`

- [ ] **Step 1: Add failing prompt assertions**

Modify the prompt test in `src/main/agentManager.test.ts`:

```ts
    expect(marketingAgent?.systemPrompt).toContain('产品定位分析');
    expect(marketingAgent?.systemPrompt).toContain('百度关键词、1688 同行、内容平台');
    expect(marketingAgent?.systemPrompt).toContain('市场需求、竞争机会、工厂匹配、成交可行、内容扩展');
    expect(marketingAgent?.systemPrompt).toContain('lobsterai_industry_positioning_save');
    expect(marketingAgent?.systemPrompt).toContain('lobsterai_industry_positioning_get_latest');
    expect(marketingAgent?.systemPrompt).toContain('主推方向');
```

- [ ] **Step 2: Run failing prompt test**

Run:

```bash
npm test -- src/main/agentManager.test.ts
```

Expected: fail because the prompt does not mention positioning research tools.

- [ ] **Step 3: Update Chinese prompt**

In `src/main/presetAgents.ts`, add this section to the marketing agent `systemPrompt` before `## 输出风格`:

```ts
      '## 产品定位分析\n' +
      '- 当用户问“现在主推哪个产品方向”“帮我分析产品定位”“根据行业和同行判断主推方向”时，执行产品定位分析任务。\n' +
      '- 先读取已保存的定位报告；如果可用工具里有 lobsterai_industry_positioning_get_latest，先调用它查看最近一次主推方向。\n' +
      '- 如果用户要求重新分析，围绕百度关键词、1688 同行、内容平台三类外部数据调研；数据源不可用时继续分析并说明置信度。\n' +
      '- 候选方向默认包括重型瓦楞纸箱、蜂窝纸箱、纸护角、纸托盘、替代木箱包装，以及汽配零部件、机械设备、出口免熏蒸、大件运输等方案方向。\n' +
      '- 每个候选方向按市场需求、竞争机会、工厂匹配、成交可行、内容扩展五项打分，每项 1-5 分，必须给理由。\n' +
      '- 最终输出主推方向、备选方向、关键词、客户痛点、同行卖点、机会点、适合渠道、第一周内容主题、需要补充的案例或参数。\n' +
      '- 如果可用工具里有 lobsterai_industry_positioning_save，完成分析后把结构化报告保存，后续生成朋友圈、微信群、1688、百度 SEO 内容时优先复用已保存主推方向。\n\n' +
```

- [ ] **Step 4: Update English prompt**

Add the English equivalent to `systemPromptEn`:

```ts
      '## Product Positioning Analysis\n' +
      '- When the user asks which product direction to promote, run a product-positioning analysis task.\n' +
      '- First read the latest saved positioning report if lobsterai_industry_positioning_get_latest is available.\n' +
      '- If the user asks for a fresh analysis, research three lanes: search keywords, 1688 competitors, and content-platform pain points. Continue with lower confidence if a lane is unavailable.\n' +
      '- Candidate directions include heavy-duty corrugated cartons, honeycomb cartons, paper edge protectors, paper pallets, wooden-box replacement packaging, and solution directions such as auto parts, machinery equipment, export fumigation-free packaging, and large-product transportation.\n' +
      '- Score every candidate from 1 to 5 on market demand, competitive opportunity, factory fit, deal feasibility, and content expansion. Always explain each score.\n' +
      '- Output the main direction, backup directions, keywords, customer pain points, competitor wording, opportunity gaps, suitable channels, first-week content themes, and missing case or parameter materials.\n' +
      '- If lobsterai_industry_positioning_save is available, save the structured report after analysis and reuse the saved main direction for later WeChat, 1688, Baidu SEO, and group content.\n\n' +
```

- [ ] **Step 5: Run prompt tests**

Run:

```bash
npm test -- src/main/agentManager.test.ts
```

Expected: pass.

## Task 7: Verification

**Files:**
- Verify all touched TypeScript files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- src/shared/industryPack/positioning.test.ts src/main/industryPack/positioningCandidates.test.ts src/main/industryPack/industryPackStore.test.ts src/main/industryPack/positioningService.test.ts src/main/industryPack/contentGenerationService.test.ts src/main/agentManager.test.ts src/main/libs/openclawExtensionManifests.test.ts src/main/libs/openclawConfigSync.runtime.test.ts
```

Expected: all listed Vitest suites pass.

- [ ] **Step 2: Run touched-file lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/industryPack/positioning.ts src/shared/industryPack/positioning.test.ts src/main/industryPack/positioningCandidates.ts src/main/industryPack/positioningCandidates.test.ts src/main/industryPack/industryPackStore.ts src/main/industryPack/industryPackStore.test.ts src/main/industryPack/positioningService.ts src/main/industryPack/positioningService.test.ts src/main/industryPack/contentGenerationService.ts src/main/industryPack/contentGenerationService.test.ts src/main/libs/mcpBridgeServer.ts src/main/mcp/mcpRuntime.ts src/main/libs/openclawConfigSync.ts src/main/libs/openclawConfigSync.runtime.test.ts src/main/libs/openclawExtensionManifests.test.ts src/main/presetAgents.ts src/main/agentManager.test.ts openclaw-extensions/lobster-industry-positioning/index.ts
```

Expected: pass with zero warnings.

- [ ] **Step 3: Compile Electron main/preload**

Run:

```bash
npm run compile:electron
```

Expected: TypeScript compile passes.

- [ ] **Step 4: Build local extension bundle path**

Run:

```bash
npm run openclaw:extensions:local
npm run openclaw:precompile
```

Expected: local OpenClaw extensions sync and precompile without errors, including `lobster-industry-positioning`.

- [ ] **Step 5: Review the final diff**

Run:

```bash
git diff --stat
git diff -- src/shared/industryPack src/main/industryPack src/main/libs/mcpBridgeServer.ts src/main/libs/openclawConfigSync.ts src/main/presetAgents.ts openclaw-extensions/lobster-industry-positioning
```

Expected: diff is scoped to positioning research, persistence, tool bridge, prompt guidance, and tests. Do not commit unless the user explicitly asks.
