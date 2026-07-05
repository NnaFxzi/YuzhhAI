# Office Workbench Differentiation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first-phase office workbench experience: chat remains central while current materials, generated
deliverables, office/content workflows, and scheduled work become visible around it.

**Architecture:** Keep Cowork, Artifacts, Scheduled Tasks, and Quick Actions as the underlying systems. Add a
renderer-only workbench layer that upgrades quick actions into workflow metadata, adds a workbench side panel beside
`CoworkView`, and renames/downgrades primary navigation without deleting advanced capabilities.

**Tech Stack:** Electron renderer, React, Redux Toolkit, TypeScript, Tailwind, Vitest, existing
Cowork/Artifact/Scheduled Task services.

---

## Scope Boundary

This plan implements Phase 1 from the design spec: "Make It Feel Like A Workbench."

Included:

- Structured workflow metadata on top of existing quick actions.
- Office/content workflow cards.
- Workbench side panel for current materials, generated artifacts, workflows, and scheduled tasks.
- Primary navigation product-language cleanup.
- Tests for workflow parsing, prompt assembly, and workbench display helpers.

Separate follow-up plans should cover:

- Cross-session artifact library with rename/favorite/tag.
- Saving completed tasks as reusable workflows.
- Creating scheduled tasks from completed workflow follow-up prompts.
- IM remote control repackaging.

## File Structure

- Modify `public/quick-actions.json`
  - Add workflow-oriented metadata while preserving current fields used by the app.
- Modify `public/quick-actions-i18n.json`
  - Replace generic demo prompts with office/content workflow copy in Chinese and English.
- Modify `src/renderer/types/quickAction.ts`
  - Extend the quick action schema with optional workflow fields.
- Modify `src/renderer/services/quickAction.ts`
  - Preserve backward compatibility and expose localized workflow metadata.
- Create `src/renderer/services/quickAction.test.ts`
  - Unit-test fallback behavior and localized workflow metadata.
- Create `src/renderer/services/workflowPrompt.ts`
  - Build a consistent prompt preamble for workflow-triggered tasks.
- Create `src/renderer/services/workflowPrompt.test.ts`
  - Unit-test prompt assembly.
- Create `src/renderer/components/workbench/workbenchDisplay.ts`
  - Pure helpers for material, artifact, workflow, and scheduled task display labels.
- Create `src/renderer/components/workbench/workbenchDisplay.test.ts`
  - Unit-test helper output.
- Create `src/renderer/components/workbench/WorkbenchSidePanel.tsx`
  - Renderer panel that reads existing Redux slices and shows workbench context.
- Create `src/renderer/components/workbench/index.ts`
  - Export workbench components.
- Modify `src/renderer/components/cowork/CoworkView.tsx`
  - Render the workbench side panel and use workflow prompt assembly when quick-action prompts are selected.
- Modify `src/renderer/components/quick-actions/QuickActionBar.tsx`
  - Present quick actions as workflow categories.
- Modify `src/renderer/components/quick-actions/PromptPanel.tsx`
  - Present prompts as workflow cards with required inputs and output type hints.
- Modify `src/renderer/components/Sidebar.tsx`
  - Rename and simplify primary entries; hide Skills/Kits/MCP from ordinary primary navigation.
- Modify `src/renderer/App.tsx`
  - Keep advanced views routable from settings/shortcuts but remove them from the ordinary sidebar path.
- Modify `src/renderer/services/i18n.ts`
  - Add workbench labels in `zh` and `en`.

## Task 1: Extend Quick Action Workflow Types

**Files:**

- Modify: `src/renderer/types/quickAction.ts`
- Test: `src/renderer/services/quickAction.test.ts`

- [ ] **Step 1: Add workflow metadata types**

Update `src/renderer/types/quickAction.ts` so the existing JSON remains valid and workflows can carry richer metadata:

```ts
export const WorkflowCategory = {
  Office: 'office',
  Content: 'content',
  Website: 'website',
  Education: 'education',
  Data: 'data',
} as const;
export type WorkflowCategory = typeof WorkflowCategory[keyof typeof WorkflowCategory];

export const WorkflowOutputType = {
  Text: 'text',
  Markdown: 'markdown',
  Document: 'document',
  Spreadsheet: 'spreadsheet',
  Presentation: 'presentation',
  Webpage: 'webpage',
  Image: 'image',
  Video: 'video',
} as const;
export type WorkflowOutputType = typeof WorkflowOutputType[keyof typeof WorkflowOutputType];

export interface WorkflowFollowUp {
  id: string;
  label: string;
  prompt: string;
}

export interface WorkflowMetadata {
  category?: WorkflowCategory;
  requiredInputs?: string[];
  outputTypes?: WorkflowOutputType[];
  followUps?: WorkflowFollowUp[];
}
```

Extend `Prompt`, `LocalizedPrompt`, `QuickAction`, and `LocalizedQuickAction`:

```ts
export interface Prompt {
  id: string;
  workflow?: WorkflowMetadata;
}

export interface LocalizedPrompt {
  id: string;
  label: string;
  description?: string;
  prompt: string;
  workflow?: WorkflowMetadata;
}

export interface QuickAction {
  id: string;
  icon: string;
  color: string;
  skillMapping: string;
  category?: WorkflowCategory;
  prompts: Prompt[];
}

export interface LocalizedQuickAction {
  id: string;
  label: string;
  icon: string;
  color: string;
  skillMapping: string;
  category?: WorkflowCategory;
  prompts: LocalizedPrompt[];
}
```

- [ ] **Step 2: Create a failing type/service test**

Create `src/renderer/services/quickAction.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { WorkflowCategory, WorkflowOutputType } from '../types/quickAction';
import { quickActionService } from './quickAction';
import { i18nService } from './i18n';

const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

describe('quickActionService workflow metadata', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    quickActionService.clearCache();
    vi.spyOn(i18nService, 'getLanguage').mockReturnValue('zh');
  });

  test('localizes workflow metadata while preserving prompt workflow fields', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: 2,
          actions: [{
            id: 'office',
            icon: 'PresentationChartBarIcon',
            color: '#2563EB',
            skillMapping: 'pptx',
            category: WorkflowCategory.Office,
            prompts: [{
              id: 'office.files-to-ppt',
              workflow: {
                category: WorkflowCategory.Office,
                requiredInputs: ['资料文件或文件夹'],
                outputTypes: [WorkflowOutputType.Presentation],
                followUps: [{
                  id: 'schedule-weekly',
                  label: '每周自动生成',
                  prompt: '每周一自动生成这份 PPT。',
                }],
              },
            }],
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          zh: {
            office: {
              label: '办公整理',
              prompts: {
                'office.files-to-ppt': {
                  label: '资料转 PPT',
                  description: '把资料整理成汇报演示',
                  prompt: '请把这些资料整理成 PPT。',
                },
              },
            },
          },
          en: {},
        }),
      });

    const actions = await quickActionService.getLocalizedActions();

    expect(actions[0].category).toBe(WorkflowCategory.Office);
    expect(actions[0].prompts[0]).toMatchObject({
      id: 'office.files-to-ppt',
      label: '资料转 PPT',
      workflow: {
        outputTypes: [WorkflowOutputType.Presentation],
      },
    });
  });
});
```

- [ ] **Step 3: Run the test and verify it fails before implementation**

Run:

```bash
npm test -- src/renderer/services/quickAction.test.ts
```

Expected before implementation: TypeScript or assertion failure because workflow fields are not typed or preserved.

## Task 2: Preserve Workflow Metadata In Quick Action Service

**Files:**

- Modify: `src/renderer/services/quickAction.ts`
- Test: `src/renderer/services/quickAction.test.ts`

- [ ] **Step 1: Update localization mapping**

In `getLocalizedActions()`, include `category` and prompt `workflow`:

```ts
return config.actions.map(action => {
  const actionI18n = i18nData[language]?.[action.id];

  return {
    ...action,
    category: action.category,
    label: actionI18n?.label || action.id,
    prompts: action.prompts.map(prompt => {
      const promptI18n = actionI18n?.prompts?.[prompt.id];

      return {
        id: prompt.id,
        label: promptI18n?.label || prompt.id,
        description: promptI18n?.description,
        prompt: promptI18n?.prompt || '',
        workflow: prompt.workflow,
      };
    }),
  };
});
```

- [ ] **Step 2: Run the quick action test**

Run:

```bash
npm test -- src/renderer/services/quickAction.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run touched-file lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/types/quickAction.ts src/renderer/services/quickAction.ts src/renderer/services/quickAction.test.ts
```

Expected: no errors and no warnings.

## Task 3: Add Workflow Prompt Assembly

**Files:**

- Create: `src/renderer/services/workflowPrompt.ts`
- Create: `src/renderer/services/workflowPrompt.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/services/workflowPrompt.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { WorkflowCategory, WorkflowOutputType, type LocalizedPrompt } from '../types/quickAction';
import { buildWorkflowPrompt } from './workflowPrompt';

describe('buildWorkflowPrompt', () => {
  test('adds workflow context before the user-facing prompt', () => {
    const prompt: LocalizedPrompt = {
      id: 'office.daily-report',
      label: '生成日报',
      description: '整理今天的工作',
      prompt: '请基于材料生成日报。',
      workflow: {
        category: WorkflowCategory.Office,
        requiredInputs: ['今天的工作记录', '相关文件'],
        outputTypes: [WorkflowOutputType.Markdown, WorkflowOutputType.Document],
      },
    };

    expect(buildWorkflowPrompt(prompt)).toContain('## 工作流');
    expect(buildWorkflowPrompt(prompt)).toContain('名称：生成日报');
    expect(buildWorkflowPrompt(prompt)).toContain('需要的材料：今天的工作记录、相关文件');
    expect(buildWorkflowPrompt(prompt)).toContain('期望产物：markdown、document');
    expect(buildWorkflowPrompt(prompt)).toContain('请基于材料生成日报。');
  });

  test('returns the raw prompt when workflow metadata is absent', () => {
    expect(buildWorkflowPrompt({
      id: 'plain',
      label: 'Plain',
      prompt: '直接执行。',
    })).toBe('直接执行。');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- src/renderer/services/workflowPrompt.test.ts
```

Expected: FAIL because `workflowPrompt.ts` does not exist.

- [ ] **Step 3: Add the implementation**

Create `src/renderer/services/workflowPrompt.ts`:

```ts
import type { LocalizedPrompt } from '../types/quickAction';

export function buildWorkflowPrompt(prompt: LocalizedPrompt): string {
  const basePrompt = prompt.prompt.trim();
  if (!prompt.workflow) {
    return basePrompt;
  }

  const requiredInputs = prompt.workflow.requiredInputs?.filter(Boolean) ?? [];
  const outputTypes = prompt.workflow.outputTypes?.filter(Boolean) ?? [];

  return [
    '## 工作流',
    `名称：${prompt.label}`,
    prompt.description ? `说明：${prompt.description}` : null,
    requiredInputs.length > 0 ? `需要的材料：${requiredInputs.join('、')}` : null,
    outputTypes.length > 0 ? `期望产物：${outputTypes.join('、')}` : null,
    '',
    '## 用户任务',
    basePrompt,
  ].filter((line): line is string => line !== null).join('\n');
}
```

- [ ] **Step 4: Run workflow prompt tests**

Run:

```bash
npm test -- src/renderer/services/workflowPrompt.test.ts
```

Expected: PASS.

## Task 4: Upgrade Public Workflow Catalog Data

**Files:**

- Modify: `public/quick-actions.json`
- Modify: `public/quick-actions-i18n.json`
- Test: `src/renderer/services/quickAction.test.ts`

- [ ] **Step 1: Replace quick action categories**

Set `public/quick-actions.json` to version 2 and use product-language workflow categories. Keep `skillMapping` for
compatibility:

```json
{
  "version": 2,
  "actions": [
    {
      "id": "office",
      "icon": "PresentationChartBarIcon",
      "color": "#2563EB",
      "skillMapping": "docx",
      "category": "office",
      "prompts": [
        {
          "id": "office.daily-report",
          "workflow": {
            "category": "office",
            "requiredInputs": ["工作记录、聊天记录、文件或截图"],
            "outputTypes": ["markdown", "document"],
            "followUps": [
              {
                "id": "repeat-weekday",
                "label": "设为工作日自动生成",
                "prompt": "每个工作日根据同样来源生成日报。"
              }
            ]
          }
        },
        {
          "id": "office.files-to-ppt",
          "workflow": {
            "category": "office",
            "requiredInputs": ["资料文件、文件夹或网页链接"],
            "outputTypes": ["presentation"],
            "followUps": [
              {
                "id": "repeat-weekly",
                "label": "每周更新这份 PPT",
                "prompt": "每周根据新增资料更新这份 PPT。"
              }
            ]
          }
        },
        {
          "id": "office.excel-summary",
          "workflow": {
            "category": "office",
            "requiredInputs": ["Excel、CSV 或截图表格"],
            "outputTypes": ["spreadsheet", "document"]
          }
        }
      ]
    },
    {
      "id": "content",
      "icon": "GlobeAltIcon",
      "color": "#10B981",
      "skillMapping": "web-search",
      "category": "content",
      "prompts": [
        {
          "id": "content.topic-calendar",
          "workflow": {
            "category": "content",
            "requiredInputs": ["账号定位、目标受众、参考链接或历史内容"],
            "outputTypes": ["spreadsheet", "markdown"],
            "followUps": [
              {
                "id": "repeat-weekly",
                "label": "每周生成选题表",
                "prompt": "每周根据近期热点和账号定位生成下周选题表。"
              }
            ]
          }
        },
        {
          "id": "content.competitor-research",
          "workflow": {
            "category": "content",
            "requiredInputs": ["竞品名称、账号链接或行业关键词"],
            "outputTypes": ["markdown", "document"]
          }
        },
        {
          "id": "content.short-video-script",
          "workflow": {
            "category": "content",
            "requiredInputs": ["主题、目标平台、时长和口播风格"],
            "outputTypes": ["markdown", "video"]
          }
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Add localized workflow copy**

Update `public/quick-actions-i18n.json` with matching `zh` and `en` entries. The Chinese section should include:

```json
{
  "zh": {
    "office": {
      "label": "办公整理",
      "prompts": {
        "office.daily-report": {
          "label": "生成日报",
          "description": "把工作记录、文件和截图整理成今日工作总结",
          "prompt": "请基于我提供的材料生成一份今日工作日报。要求：1. 先列出今日完成事项；2. 总结关键进展和风险；3. 提炼明天待办；4. 输出适合直接发给团队或老板的 Markdown 版本。"
        },
        "office.files-to-ppt": {
          "label": "资料转 PPT",
          "description": "把资料文件、网页或文件夹整理成汇报演示",
          "prompt": "请把我提供的资料整理成一份汇报 PPT。先给出结构化大纲，再生成可编辑的 PPT 文件；如果资料不足，请先列出缺失信息。"
        },
        "office.excel-summary": {
          "label": "表格汇总分析",
          "description": "汇总 Excel/CSV 数据并生成结论",
          "prompt": "请读取我提供的表格数据，完成分类汇总、异常值标注、关键趋势分析，并输出一份整理后的表格和一段可直接汇报的结论。"
        }
      }
    },
    "content": {
      "label": "内容运营",
      "prompts": {
        "content.topic-calendar": {
          "label": "选题日历",
          "description": "生成一周内容选题和发布节奏",
          "prompt": "请根据账号定位、目标受众和我提供的参考材料，生成未来一周内容选题日历。每个选题包含标题、核心观点、素材方向、发布平台和推荐发布时间。"
        },
        "content.competitor-research": {
          "label": "竞品调研",
          "description": "整理竞品内容策略、亮点和机会",
          "prompt": "请调研我提供的竞品或行业关键词，整理它们近期内容方向、爆款特征、用户反馈和可借鉴机会，并输出结构化报告。"
        },
        "content.short-video-script": {
          "label": "短视频脚本",
          "description": "把主题整理成可拍摄脚本",
          "prompt": "请根据我提供的主题生成短视频脚本。要求包含前 3 秒钩子、分镜、口播文案、画面建议、字幕重点和结尾引导。"
        }
      }
    }
  }
}
```

Add equivalent English labels and prompts under `en`.

- [ ] **Step 3: Run quick action tests**

Run:

```bash
npm test -- src/renderer/services/quickAction.test.ts
```

Expected: PASS.

## Task 5: Add Workbench Display Helpers

**Files:**

- Create: `src/renderer/components/workbench/workbenchDisplay.ts`
- Create: `src/renderer/components/workbench/workbenchDisplay.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/renderer/components/workbench/workbenchDisplay.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { ArtifactTypeValue, type Artifact } from '../../types/artifact';
import {
  getArtifactDisplayMeta,
  getDraftMaterialName,
  getWorkflowOutputLabel,
} from './workbenchDisplay';

describe('workbench display helpers', () => {
  test('returns user-facing artifact metadata', () => {
    const artifact: Artifact = {
      id: 'a1',
      messageId: 'm1',
      sessionId: 's1',
      type: ArtifactTypeValue.Document,
      title: '日报.docx',
      content: '',
      filePath: '/tmp/日报.docx',
      createdAt: 1,
    };

    expect(getArtifactDisplayMeta(artifact)).toEqual({
      title: '日报.docx',
      typeLabel: '文档',
      pathLabel: '/tmp/日报.docx',
    });
  });

  test('returns file names for draft material paths', () => {
    expect(getDraftMaterialName('/Users/me/report.xlsx')).toBe('report.xlsx');
  });

  test('maps workflow output labels', () => {
    expect(getWorkflowOutputLabel('presentation')).toBe('PPT');
    expect(getWorkflowOutputLabel('spreadsheet')).toBe('表格');
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm test -- src/renderer/components/workbench/workbenchDisplay.test.ts
```

Expected: FAIL because helper file does not exist.

- [ ] **Step 3: Add helper implementation**

Create `src/renderer/components/workbench/workbenchDisplay.ts`:

```ts
import { ArtifactTypeValue, type Artifact, type ArtifactType } from '../../types/artifact';
import type { WorkflowOutputType } from '../../types/quickAction';

const ArtifactTypeLabel: Record<ArtifactType, string> = {
  [ArtifactTypeValue.Html]: '网页',
  [ArtifactTypeValue.Svg]: 'SVG',
  [ArtifactTypeValue.Image]: '图片',
  [ArtifactTypeValue.Video]: '视频',
  [ArtifactTypeValue.Mermaid]: '图表',
  [ArtifactTypeValue.Code]: '代码',
  [ArtifactTypeValue.Markdown]: 'Markdown',
  [ArtifactTypeValue.Text]: '文本',
  [ArtifactTypeValue.Document]: '文档',
  [ArtifactTypeValue.LocalService]: '本地服务',
};

const WorkflowOutputLabel: Record<WorkflowOutputType, string> = {
  text: '文本',
  markdown: 'Markdown',
  document: '文档',
  spreadsheet: '表格',
  presentation: 'PPT',
  webpage: '网页',
  image: '图片',
  video: '视频',
};

function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || filePath;
}

export function getArtifactDisplayMeta(artifact: Artifact): {
  title: string;
  typeLabel: string;
  pathLabel: string | null;
} {
  return {
    title: artifact.title || artifact.fileName || artifact.type,
    typeLabel: ArtifactTypeLabel[artifact.type],
    pathLabel: artifact.filePath || artifact.url || null,
  };
}

export function getDraftMaterialName(filePath: string): string {
  return basename(filePath);
}

export function getWorkflowOutputLabel(outputType: WorkflowOutputType): string {
  return WorkflowOutputLabel[outputType];
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
npm test -- src/renderer/components/workbench/workbenchDisplay.test.ts
```

Expected: PASS.

## Task 6: Build Workbench Side Panel

**Files:**

- Create: `src/renderer/components/workbench/WorkbenchSidePanel.tsx`
- Create: `src/renderer/components/workbench/index.ts`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Add i18n keys**

Add Chinese keys near related sidebar/workspace labels:

```ts
workbenchMaterials: '当前材料',
workbenchMaterialsEmpty: '拖入文件、截图或选择文本后会显示在这里',
workbenchArtifacts: '产物',
workbenchArtifactsEmpty: '生成的文档、表格、PPT、网页会显示在这里',
workbenchWorkflows: '常用工作流',
workbenchTasks: '自动任务',
workbenchTasksEmpty: '还没有自动任务',
workbenchOpenArtifact: '打开产物',
```

Add English keys:

```ts
workbenchMaterials: 'Materials',
workbenchMaterialsEmpty: 'Files, screenshots, and selected text appear here',
workbenchArtifacts: 'Deliverables',
workbenchArtifactsEmpty: 'Generated docs, sheets, slides, and pages appear here',
workbenchWorkflows: 'Workflows',
workbenchTasks: 'Automations',
workbenchTasksEmpty: 'No automations yet',
workbenchOpenArtifact: 'Open deliverable',
```

- [ ] **Step 2: Create the panel component**

Create `src/renderer/components/workbench/WorkbenchSidePanel.tsx`:

```tsx
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { selectSessionArtifacts, openArtifactPreviewTab } from '../../store/slices/artifactSlice';
import { RootState } from '../../store';
import { i18nService } from '../../services/i18n';
import { LocalizedQuickAction } from '../../types/quickAction';
import { getArtifactDisplayMeta, getDraftMaterialName, getWorkflowOutputLabel } from './workbenchDisplay';

interface WorkbenchSidePanelProps {
  sessionId: string | null;
  draftKey: string;
  workflows: LocalizedQuickAction[];
  onWorkflowSelect: (actionId: string) => void;
}

const sectionClassName = 'border-b border-border-subtle px-3 py-3 last:border-b-0';
const sectionTitleClassName = 'mb-2 text-xs font-semibold uppercase tracking-wide text-secondary';

const WorkbenchSidePanel: React.FC<WorkbenchSidePanelProps> = ({
  sessionId,
  draftKey,
  workflows,
  onWorkflowSelect,
}) => {
  const dispatch = useDispatch();
  const artifacts = useSelector((state: RootState) => (
    sessionId ? selectSessionArtifacts(state, sessionId) : []
  ));
  const draftAttachments = useSelector((state: RootState) => state.cowork.draftAttachments[draftKey] ?? []);
  const scheduledTasks = useSelector((state: RootState) => state.scheduledTask.tasks);

  return (
    <aside className="hidden w-[300px] shrink-0 border-l border-border bg-surface/70 lg:flex lg:flex-col">
      <section className={sectionClassName}>
        <h2 className={sectionTitleClassName}>{i18nService.t('workbenchMaterials')}</h2>
        {draftAttachments.length === 0 ? (
          <p className="text-xs leading-5 text-secondary">{i18nService.t('workbenchMaterialsEmpty')}</p>
        ) : (
          <div className="space-y-1.5">
            {draftAttachments.slice(0, 5).map((attachment) => (
              <div key={`${attachment.path}:${attachment.name}`} className="truncate rounded-md bg-background px-2 py-1.5 text-xs text-foreground">
                {getDraftMaterialName(attachment.path || attachment.name)}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={sectionClassName}>
        <h2 className={sectionTitleClassName}>{i18nService.t('workbenchArtifacts')}</h2>
        {artifacts.length === 0 ? (
          <p className="text-xs leading-5 text-secondary">{i18nService.t('workbenchArtifactsEmpty')}</p>
        ) : (
          <div className="space-y-1.5">
            {artifacts.slice(0, 6).map((artifact) => {
              const meta = getArtifactDisplayMeta(artifact);
              return (
                <button
                  key={artifact.id}
                  type="button"
                  className="w-full rounded-md bg-background px-2 py-1.5 text-left transition-colors hover:bg-surface-raised"
                  title={meta.pathLabel ?? meta.title}
                  onClick={() => {
                    if (sessionId) {
                      dispatch(openArtifactPreviewTab({ sessionId, artifactId: artifact.id }));
                    }
                  }}
                >
                  <div className="truncate text-xs font-medium text-foreground">{meta.title}</div>
                  <div className="text-[11px] text-secondary">{meta.typeLabel}</div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className={sectionClassName}>
        <h2 className={sectionTitleClassName}>{i18nService.t('workbenchWorkflows')}</h2>
        <div className="space-y-1.5">
          {workflows.slice(0, 4).map((workflow) => (
            <button
              key={workflow.id}
              type="button"
              className="w-full rounded-md bg-background px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-surface-raised"
              onClick={() => onWorkflowSelect(workflow.id)}
            >
              {workflow.label}
              {workflow.prompts[0]?.workflow?.outputTypes?.[0] && (
                <span className="ml-1 text-[11px] text-secondary">
                  {getWorkflowOutputLabel(workflow.prompts[0].workflow.outputTypes[0])}
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      <section className={sectionClassName}>
        <h2 className={sectionTitleClassName}>{i18nService.t('workbenchTasks')}</h2>
        {scheduledTasks.length === 0 ? (
          <p className="text-xs leading-5 text-secondary">{i18nService.t('workbenchTasksEmpty')}</p>
        ) : (
          <div className="space-y-1.5">
            {scheduledTasks.slice(0, 4).map((task) => (
              <div key={task.id} className="truncate rounded-md bg-background px-2 py-1.5 text-xs text-foreground">
                {task.name}
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
};

export default WorkbenchSidePanel;
```

- [ ] **Step 3: Export the component**

Create `src/renderer/components/workbench/index.ts`:

```ts
export { default as WorkbenchSidePanel } from './WorkbenchSidePanel';
```

- [ ] **Step 4: Run component lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/workbench/WorkbenchSidePanel.tsx src/renderer/components/workbench/index.ts src/renderer/components/workbench/workbenchDisplay.ts src/renderer/components/workbench/workbenchDisplay.test.ts
```

Expected: no errors and no warnings.

## Task 7: Integrate Workbench Panel Into CoworkView

**Files:**

- Modify: `src/renderer/components/cowork/CoworkView.tsx`
- Modify: `src/renderer/components/quick-actions/PromptPanel.tsx`
- Test: `src/renderer/services/workflowPrompt.test.ts`

- [ ] **Step 1: Import workflow prompt and side panel**

Add imports in `CoworkView.tsx`:

```ts
import { buildWorkflowPrompt } from '../../services/workflowPrompt';
import { WorkbenchSidePanel } from '../workbench';
```

- [ ] **Step 2: Use workflow prompt assembly when a prompt card is selected**

Find the quick-action prompt selection handler in `CoworkView.tsx`. Update it so it passes the full localized prompt
into `buildWorkflowPrompt()` before writing the draft. The final logic should follow this shape:

```ts
const handlePromptSelect = useCallback((promptText: string, promptId: string) => {
  const selectedAction = quickActions.find(action => action.id === selectedActionId);
  const selectedPrompt = selectedAction?.prompts.find(prompt => prompt.id === promptId);
  const nextPrompt = selectedPrompt ? buildWorkflowPrompt(selectedPrompt) : promptText;

  dispatch(setDraftPrompt({ sessionId: '__home__', draft: nextPrompt }));
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(CoworkUiEvent.FocusInput, {
      detail: { text: nextPrompt },
    }));
  }, 0);
}, [dispatch, quickActions, selectedActionId]);
```

Keep existing analytics calls around this handler; only change the prompt text source.

- [ ] **Step 3: Render WorkbenchSidePanel beside the existing Cowork content**

In the main return of `CoworkView`, wrap the current detail/home content with a horizontal flex row and add the panel:

```tsx
<div className="flex h-full min-h-0">
  <div className="min-w-0 flex-1">
    {/* existing CoworkView content stays here */}
  </div>
  <WorkbenchSidePanel
    sessionId={currentSession?.id ?? null}
    draftKey={currentSession?.id ?? '__home__'}
    workflows={quickActions}
    onWorkflowSelect={(actionId) => dispatch(selectAction(actionId))}
  />
</div>
```

Do not put the side panel inside `ArtifactPanel`; it should sit outside the existing artifact preview system.

- [ ] **Step 4: Update PromptPanel callback to pass the prompt object if needed**

If the current handler cannot identify `selectedActionId` safely, change `PromptPanelProps`:

```ts
interface PromptPanelProps {
  action: LocalizedQuickAction;
  onPromptSelect: (prompt: LocalizedPrompt) => void;
}
```

Then update the click handler:

```ts
const handlePromptClick = (prompt: LocalizedPrompt) => {
  dispatch(selectPrompt(prompt.id));
  onPromptSelect(prompt);
};
```

Update `CoworkView` to receive the full prompt:

```ts
const handlePromptSelect = useCallback((prompt: LocalizedPrompt) => {
  const nextPrompt = buildWorkflowPrompt(prompt);
  dispatch(setDraftPrompt({ sessionId: '__home__', draft: nextPrompt }));
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(CoworkUiEvent.FocusInput, {
      detail: { text: nextPrompt },
    }));
  }, 0);
}, [dispatch]);
```

- [ ] **Step 5: Run targeted tests**

Run:

```bash
npm test -- src/renderer/services/workflowPrompt.test.ts src/renderer/components/workbench/workbenchDisplay.test.ts
```

Expected: PASS.

## Task 8: Reframe Quick Actions As Workflows

**Files:**

- Modify: `src/renderer/components/quick-actions/QuickActionBar.tsx`
- Modify: `src/renderer/components/quick-actions/PromptPanel.tsx`

- [ ] **Step 1: Update QuickActionBar display language**

Keep the component simple, but make the button style read like workflow categories. Replace the button class with:

```tsx
className="flex items-center gap-1.5 rounded-md border border-border-subtle bg-background px-3 py-1.5 text-[13px] font-medium leading-5 text-foreground transition-colors hover:border-primary/40 hover:bg-surface-raised"
```

- [ ] **Step 2: Add output type hints to PromptPanel cards**

Inside each prompt card, after the description, render output type labels:

```tsx
{prompt.workflow?.outputTypes && prompt.workflow.outputTypes.length > 0 && (
  <div className="mt-1 flex flex-wrap gap-1">
    {prompt.workflow.outputTypes.map((outputType) => (
      <span
        key={outputType}
        className="rounded-[4px] bg-primary-muted px-1.5 py-0.5 text-[11px] font-medium text-primary"
      >
        {outputType}
      </span>
    ))}
  </div>
)}
```

- [ ] **Step 3: Add required input hints to PromptPanel cards**

Below output type labels, render one compact material hint:

```tsx
{prompt.workflow?.requiredInputs?.[0] && (
  <p className="mt-1 text-[11px] leading-4 text-secondary">
    {prompt.workflow.requiredInputs[0]}
  </p>
)}
```

- [ ] **Step 4: Run touched-file lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/quick-actions/QuickActionBar.tsx src/renderer/components/quick-actions/PromptPanel.tsx
```

Expected: no errors and no warnings.

## Task 9: Simplify Primary Navigation

**Files:**

- Modify: `src/renderer/components/Sidebar.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Add navigation labels**

Add Chinese keys:

```ts
workbench: '工作台',
deliverables: '产物',
advancedCapabilities: '高级能力',
```

Add English keys:

```ts
workbench: 'Workbench',
deliverables: 'Deliverables',
advancedCapabilities: 'Advanced',
```

- [ ] **Step 2: Rename Cowork entry to Workbench**

In `Sidebar.tsx`, add a primary workbench button before scheduled tasks:

```tsx
<button
  type="button"
  onClick={() => {
    reportSidebarAction('open_workbench', { activeView, isCollapsed });
    setIsSearchOpen(false);
    onShowCowork();
  }}
  className={activeView === 'cowork' ? activeSidebarNavItemClassName : sidebarNavItemClassName}
  aria-current={activeView === 'cowork' ? 'page' : undefined}
>
  <ComposeIcon className="h-4 w-4 shrink-0" />
  {i18nService.t('workbench')}
</button>
```

Keep "new task" as a separate command if product wants both; otherwise let "new task" remain at the top as creation
action.

- [ ] **Step 3: Hide Skills/Kits/MCP buttons from ordinary primary nav**

Remove these visible button blocks from `Sidebar.tsx`:

- `open_kits`
- `open_skills`
- `open_mcp`

Do not delete props or handlers yet. `App.tsx` can keep rendering those views when called by settings, shortcuts, or
future advanced pages.

- [ ] **Step 4: Keep Scheduled Tasks as Automations**

Change the scheduled task label in the sidebar button to:

```tsx
{i18nService.t('workbenchTasks')}
```

Keep the `activeView === 'scheduledTasks'` state and `onShowScheduledTasks()` behavior unchanged.

- [ ] **Step 5: Run touched-file lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/Sidebar.tsx src/renderer/App.tsx src/renderer/services/i18n.ts
```

Expected: no errors and no warnings.

## Task 10: Verification Pass

**Files:**

- Verify all touched files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- src/renderer/services/quickAction.test.ts src/renderer/services/workflowPrompt.test.ts src/renderer/components/workbench/workbenchDisplay.test.ts
```

Expected: all tests PASS.

- [ ] **Step 2: Run touched TypeScript lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/types/quickAction.ts src/renderer/services/quickAction.ts src/renderer/services/quickAction.test.ts src/renderer/services/workflowPrompt.ts src/renderer/services/workflowPrompt.test.ts src/renderer/components/workbench/WorkbenchSidePanel.tsx src/renderer/components/workbench/index.ts src/renderer/components/workbench/workbenchDisplay.ts src/renderer/components/workbench/workbenchDisplay.test.ts src/renderer/components/cowork/CoworkView.tsx src/renderer/components/quick-actions/QuickActionBar.tsx src/renderer/components/quick-actions/PromptPanel.tsx src/renderer/components/Sidebar.tsx src/renderer/App.tsx src/renderer/services/i18n.ts
```

Expected: no errors and no warnings.

- [ ] **Step 3: Run renderer build**

Run:

```bash
npm run build
```

Expected: build completes successfully. If unrelated legacy failures appear, record them and include the focused
test/lint results.

- [ ] **Step 4: Manual validation in Electron**

Run:

```bash
npm run electron:dev
```

Expected:

- Sidebar shows `工作台` and `自动任务` as ordinary product entries.
- Skills/Kits/MCP no longer appear as ordinary primary sidebar entries.
- Home quick actions show office/content workflow groups.
- Selecting a workflow writes a structured prompt into the chat input.
- Dragging or selecting files makes them appear under `当前材料` in the workbench panel.
- Generated artifacts appear under `产物` and open the existing artifact preview when clicked.
- Existing scheduled tasks appear under `自动任务`.

- [ ] **Step 5: Review diff for scope**

Run:

```bash
git diff -- src/renderer public docs/archive/superpowers/2026-07/plans/2026-07-02-office-workbench-differentiation.md
```

Expected:

- No unrelated formatting churn.
- No deletion of Skills/Kits/MCP/Plugins backend or settings code.
- No generated runtime/vendor files touched.
- User-visible strings have both Chinese and English translations.

## Commit Guidance

Repository instructions say not to create commits until the user has tested and confirmed, unless explicitly requested.
During execution, do not commit by default.

If the user later approves committing this work, use a Conventional Commit message:

```bash
git add public/quick-actions.json public/quick-actions-i18n.json src/renderer/types/quickAction.ts src/renderer/services/quickAction.ts src/renderer/services/quickAction.test.ts src/renderer/services/workflowPrompt.ts src/renderer/services/workflowPrompt.test.ts src/renderer/components/workbench src/renderer/components/cowork/CoworkView.tsx src/renderer/components/quick-actions/QuickActionBar.tsx src/renderer/components/quick-actions/PromptPanel.tsx src/renderer/components/Sidebar.tsx src/renderer/App.tsx src/renderer/services/i18n.ts
git commit -m "feat(workbench): introduce office workflow surface"
```
