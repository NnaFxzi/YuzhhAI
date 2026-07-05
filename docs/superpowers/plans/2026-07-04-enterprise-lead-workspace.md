# Enterprise Lead Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first enterprise lead workspace MVP: workspace launch, extraction-based creation, structured multi-Agent runs, Agent card console, risk gate, deliverables, todos, and archive records.

**Architecture:** Add a focused enterprise lead workspace module beside the existing industry pack module. Shared constants and types define the workspace/run/task/deliverable contracts; the main process owns SQLite persistence, structured workflow execution, and IPC; the renderer owns launch/create/console UI through a thin service layer. First version uses a controlled structured multi-Agent workflow, not free-form Agent-to-Agent chat.

**Tech Stack:** TypeScript, Electron IPC, React, Redux-free local UI state for the workspace views, better-sqlite3, Vitest, existing OpenAI-compatible `ModelClientAdapter` pattern from `src/main/industryPack/modelClientAdapter.ts`.

**Version-Control Note:** Repository instructions say not to create commits until the user has tested and confirmed. Each task ends with a verification checkpoint. Commit commands are intentionally omitted from task steps; when the user asks to commit, use Conventional Commits.

---

## Scope Check

The spec covers one product surface with several supporting pieces. It remains a single MVP because each subsystem serves one vertical slice: creating and running an `企业获客工作空间`. The plan therefore builds one integrated feature in layers:

1. Shared contracts.
2. Main-process persistence.
3. Workflow execution.
4. IPC and preload bridge.
5. Renderer launch/create/console views.
6. Verification.

The plan does not implement custom workspace templates, arbitrary Agent workflows, CRM, social login, automatic external actions, or multi-user collaboration.

## File Structure

Create these shared files:

- `src/shared/enterpriseLeadWorkspace/constants.ts`
  Stable IDs, statuses, IPC channels, risk levels, todo kinds, deliverable kinds, and Agent role definitions.
- `src/shared/enterpriseLeadWorkspace/types.ts`
  Public request/response and entity types used by main, preload, renderer, and tests.
- `src/shared/enterpriseLeadWorkspace/validation.ts`
  Small normalizers and validators for workspace draft, run goal, Agent task result, and risk result.
- `src/shared/enterpriseLeadWorkspace/validation.test.ts`
  Pure Vitest coverage for required fields, defaulting, and malformed model JSON handling.

Create these main-process files:

- `src/main/enterpriseLeadWorkspace/store.ts`
  SQLite tables and persistence methods for workspaces, drafts, runs, Agent tasks, deliverables, todos, pending versions, and archives.
- `src/main/enterpriseLeadWorkspace/store.test.ts`
  In-memory database coverage for create/list/update/run/task/archive behavior.
- `src/main/enterpriseLeadWorkspace/workflow.ts`
  Fixed enterprise lead Agent workflow metadata, dependency order, task creation, stale downstream calculation, and task status helpers.
- `src/main/enterpriseLeadWorkspace/workflow.test.ts`
  Pure coverage for fixed role order and stale propagation.
- `src/main/enterpriseLeadWorkspace/promptTemplates.ts`
  Prompt builders for workspace extraction and each Agent role.
- `src/main/enterpriseLeadWorkspace/modelJson.ts`
  JSON extraction/parsing helpers for model responses.
- `src/main/enterpriseLeadWorkspace/service.ts`
  Business service that uses the store, workflow, and model client to extract drafts, create workspaces, create runs, run Agent tasks, apply pending versions, and archive results.
- `src/main/enterpriseLeadWorkspace/service.test.ts`
  Service tests with a fake model client.
- `src/main/enterpriseLeadWorkspace/ipcHandlers.ts`
  Electron IPC handlers around the service and store.

Modify these existing main/preload files:

- `src/main/main.ts`
  Instantiate `EnterpriseLeadWorkspaceStore` and `EnterpriseLeadWorkspaceService`; register handlers.
- `src/main/preload.ts`
  Expose `window.electron.enterpriseLeadWorkspace`.
- `src/renderer/types/electron.d.ts`
  Add the preload API type.

Create these renderer files:

- `src/renderer/services/enterpriseLeadWorkspace.ts`
  Thin wrapper around `window.electron.enterpriseLeadWorkspace`.
- `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`
  Feature root that switches between launch, create draft, and workspace console states.
- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceLaunch.tsx`
  First/returning launch experience.
- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx`
  File/conversation extraction and draft confirmation.
- `src/renderer/components/enterpriseLeadWorkspace/AgentWorkspaceConsole.tsx`
  Agent card console for one workspace and current run.
- `src/renderer/components/enterpriseLeadWorkspace/AgentTaskCard.tsx`
  One Agent card with role, status, input/output summary, chat, view, rerun actions.
- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceSidePanel.tsx`
  Current todos, deliverables, and safety boundary.
- `src/renderer/components/enterpriseLeadWorkspace/index.ts`
  Barrel export.
- `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
  Pure helper tests for UI labels, status groups, and action availability.

Modify these renderer files:

- `src/renderer/App.tsx`
  Add a `enterpriseLeadWorkspace` main view and route to the new feature root.
- `src/renderer/components/Sidebar.tsx`
  Add a workspace navigation entry.
- `src/renderer/services/i18n.ts`
  Add zh/en strings for the new UI.

## Shared Entity Model

Use these stable constants throughout implementation. Consumers import values and derived types instead of comparing bare strings.

```ts
export const EnterpriseLeadWorkspaceType = {
  EnterpriseLead: 'enterprise_lead',
} as const;

export const EnterpriseLeadAgentRole = {
  Controller: 'controller',
  ProductUnderstanding: 'product_understanding',
  OpportunityRadar: 'opportunity_radar',
  ContentPlanning: 'content_planning',
  SocialOperation: 'social_operation',
  SalesHandoff: 'sales_handoff',
  RiskReview: 'risk_review',
  ProjectSummary: 'project_summary',
  ProjectArchive: 'project_archive',
} as const;

export const EnterpriseLeadRunStatus = {
  Draft: 'draft',
  Running: 'running',
  NeedsInput: 'needs_input',
  Blocked: 'blocked',
  Completed: 'completed',
  Archived: 'archived',
  Error: 'error',
} as const;

export const EnterpriseLeadTaskStatus = {
  Waiting: 'waiting',
  Running: 'running',
  NeedsInput: 'needs_input',
  Completed: 'completed',
  Stale: 'stale',
  Blocked: 'blocked',
  Error: 'error',
} as const;

export const EnterpriseLeadRiskLevel = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
} as const;
```

## Task 1: Shared Constants, Types, And Validation

**Files:**

- Create: `src/shared/enterpriseLeadWorkspace/constants.ts`
- Create: `src/shared/enterpriseLeadWorkspace/types.ts`
- Create: `src/shared/enterpriseLeadWorkspace/validation.ts`
- Create: `src/shared/enterpriseLeadWorkspace/validation.test.ts`

- [ ] **Step 1: Write failing validation tests**

Create `src/shared/enterpriseLeadWorkspace/validation.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadRiskLevel,
  EnterpriseLeadTodoKind,
} from './constants';
import {
  normalizeAgentTaskResultInput,
  normalizeRiskReviewOutput,
  normalizeWorkspaceDraftInput,
} from './validation';

describe('enterprise lead workspace validation', () => {
  test('normalizes a workspace draft from extracted profile data', () => {
    const draft = normalizeWorkspaceDraftInput({
      name: ' 重型包装获客 ',
      profile: {
        companySummary: '东莞工厂，做重型纸箱',
        productList: ['重型纸箱', '蜂窝纸箱', '重型纸箱'],
        targetCustomers: ['汽配', '机械设备'],
        channelPreferences: ['朋友圈'],
        sellingPoints: ['防破损'],
        prohibitedClaims: ['不能写具体承重'],
        missingInfo: ['真实案例'],
      },
      source: { kind: 'conversation', label: '用户描述' },
    });

    expect(draft.name).toBe('重型包装获客');
    expect(draft.profile.productList).toEqual(['重型纸箱', '蜂窝纸箱']);
    expect(draft.source.kind).toBe('conversation');
  });

  test('rejects a workspace draft without a name', () => {
    expect(() => normalizeWorkspaceDraftInput({
      name: '',
      profile: {},
      source: { kind: 'conversation', label: '用户描述' },
    })).toThrow('workspace draft name is required');
  });

  test('normalizes an Agent task result envelope', () => {
    const result = normalizeAgentTaskResultInput({
      role: EnterpriseLeadAgentRole.ProductUnderstanding,
      summary: '已识别产品和客户方向',
      outputs: { productProfile: { name: '重型纸箱' } },
      missingInfo: ['承重范围'],
      todos: [{
        kind: EnterpriseLeadTodoKind.MissingInfo,
        title: '补充承重范围',
        description: '用于避免编造具体参数',
      }],
      risks: [],
      handoffContext: { product: '重型纸箱' },
      status: 'completed',
    });

    expect(result.summary).toBe('已识别产品和客户方向');
    expect(result.missingInfo).toEqual(['承重范围']);
    expect(result.todos[0].kind).toBe(EnterpriseLeadTodoKind.MissingInfo);
  });

  test('high risk prevents archive without explicit confirmation', () => {
    const output = normalizeRiskReviewOutput({
      riskLevel: EnterpriseLeadRiskLevel.High,
      blockingIssues: ['内容暗示已经私信客户'],
      warnings: [],
      requiredRevisions: ['改成私信草稿'],
      approvalTodos: [],
      draftOnlyConfirmed: false,
      canArchive: true,
    });

    expect(output.canArchive).toBe(false);
    expect(output.blockingIssues).toEqual(['内容暗示已经私信客户']);
  });
});
```

- [ ] **Step 2: Run the shared validation test and confirm it fails**

Run:

```bash
npm test -- src/shared/enterpriseLeadWorkspace/validation.test.ts
```

Expected: fail because `src/shared/enterpriseLeadWorkspace/validation.ts` does not exist.

- [ ] **Step 3: Create shared constants**

Create `src/shared/enterpriseLeadWorkspace/constants.ts`:

```ts
export const EnterpriseLeadWorkspaceType = {
  EnterpriseLead: 'enterprise_lead',
} as const;
export type EnterpriseLeadWorkspaceType =
  typeof EnterpriseLeadWorkspaceType[keyof typeof EnterpriseLeadWorkspaceType];

export const EnterpriseLeadAgentRole = {
  Controller: 'controller',
  ProductUnderstanding: 'product_understanding',
  OpportunityRadar: 'opportunity_radar',
  ContentPlanning: 'content_planning',
  SocialOperation: 'social_operation',
  SalesHandoff: 'sales_handoff',
  RiskReview: 'risk_review',
  ProjectSummary: 'project_summary',
  ProjectArchive: 'project_archive',
} as const;
export type EnterpriseLeadAgentRole =
  typeof EnterpriseLeadAgentRole[keyof typeof EnterpriseLeadAgentRole];

export const EnterpriseLeadRunStatus = {
  Draft: 'draft',
  Running: 'running',
  NeedsInput: 'needs_input',
  Blocked: 'blocked',
  Completed: 'completed',
  Archived: 'archived',
  Error: 'error',
} as const;
export type EnterpriseLeadRunStatus =
  typeof EnterpriseLeadRunStatus[keyof typeof EnterpriseLeadRunStatus];

export const EnterpriseLeadTaskStatus = {
  Waiting: 'waiting',
  Running: 'running',
  NeedsInput: 'needs_input',
  Completed: 'completed',
  Stale: 'stale',
  Blocked: 'blocked',
  Error: 'error',
} as const;
export type EnterpriseLeadTaskStatus =
  typeof EnterpriseLeadTaskStatus[keyof typeof EnterpriseLeadTaskStatus];

export const EnterpriseLeadRiskLevel = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
} as const;
export type EnterpriseLeadRiskLevel =
  typeof EnterpriseLeadRiskLevel[keyof typeof EnterpriseLeadRiskLevel];

export const EnterpriseLeadTodoKind = {
  MissingInfo: 'missing_info',
  ConfirmExpression: 'confirm_expression',
  ManualPublish: 'manual_publish',
  ManualComment: 'manual_comment',
  ManualDirectMessage: 'manual_direct_message',
  ManualEmail: 'manual_email',
  ReviewRisk: 'review_risk',
  ConfirmSource: 'confirm_source',
} as const;
export type EnterpriseLeadTodoKind =
  typeof EnterpriseLeadTodoKind[keyof typeof EnterpriseLeadTodoKind];

export const EnterpriseLeadDeliverableKind = {
  ProductProfile: 'product_profile',
  OpportunityReport: 'opportunity_report',
  ContentDraft: 'content_draft',
  SocialPlan: 'social_plan',
  CommentDraft: 'comment_draft',
  DirectMessageDraft: 'direct_message_draft',
  SalesHandoff: 'sales_handoff',
  RiskReview: 'risk_review',
  FinalSummary: 'final_summary',
} as const;
export type EnterpriseLeadDeliverableKind =
  typeof EnterpriseLeadDeliverableKind[keyof typeof EnterpriseLeadDeliverableKind];

export const EnterpriseLeadExtractionSourceKind = {
  Conversation: 'conversation',
  File: 'file',
} as const;
export type EnterpriseLeadExtractionSourceKind =
  typeof EnterpriseLeadExtractionSourceKind[keyof typeof EnterpriseLeadExtractionSourceKind];

export const EnterpriseLeadWorkspaceIpc = {
  ListWorkspaces: 'enterpriseLeadWorkspace:workspaces:list',
  GetWorkspace: 'enterpriseLeadWorkspace:workspaces:get',
  ExtractDraft: 'enterpriseLeadWorkspace:drafts:extract',
  CreateWorkspace: 'enterpriseLeadWorkspace:workspaces:create',
  CreateRun: 'enterpriseLeadWorkspace:runs:create',
  GetRun: 'enterpriseLeadWorkspace:runs:get',
  RunTask: 'enterpriseLeadWorkspace:tasks:run',
  RerunTask: 'enterpriseLeadWorkspace:tasks:rerun',
  CreatePendingVersion: 'enterpriseLeadWorkspace:tasks:createPendingVersion',
  ApplyPendingVersion: 'enterpriseLeadWorkspace:tasks:applyPendingVersion',
  ArchiveRun: 'enterpriseLeadWorkspace:runs:archive',
} as const;
export type EnterpriseLeadWorkspaceIpc =
  typeof EnterpriseLeadWorkspaceIpc[keyof typeof EnterpriseLeadWorkspaceIpc];
```

- [ ] **Step 4: Create shared types**

Create `src/shared/enterpriseLeadWorkspace/types.ts`:

```ts
import type {
  EnterpriseLeadAgentRole,
  EnterpriseLeadDeliverableKind,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadRiskLevel,
  EnterpriseLeadRunStatus,
  EnterpriseLeadTaskStatus,
  EnterpriseLeadTodoKind,
  EnterpriseLeadWorkspaceType,
} from './constants';

export interface EnterpriseLeadWorkspaceProfile {
  companySummary: string;
  productList: string[];
  productCapabilities: string[];
  targetCustomers: string[];
  applicationScenarios: string[];
  sellingPoints: string[];
  channelPreferences: string[];
  prohibitedClaims: string[];
  contactRules: string[];
  missingInfo: string[];
}

export interface EnterpriseLeadExtractionSource {
  kind: EnterpriseLeadExtractionSourceKind | string;
  label: string;
  filePath?: string;
  text?: string;
}

export interface EnterpriseLeadWorkspaceDraft {
  id?: string;
  name: string;
  type: EnterpriseLeadWorkspaceType | string;
  profile: EnterpriseLeadWorkspaceProfile;
  source: EnterpriseLeadExtractionSource;
  enabledAgentRoles: Array<EnterpriseLeadAgentRole | string>;
  createdAt?: string;
}

export interface EnterpriseLeadWorkspace {
  id: string;
  name: string;
  type: EnterpriseLeadWorkspaceType | string;
  profile: EnterpriseLeadWorkspaceProfile;
  extractionSources: EnterpriseLeadExtractionSource[];
  riskRules: string[];
  enabledAgentRoles: Array<EnterpriseLeadAgentRole | string>;
  recentRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnterpriseLeadRun {
  id: string;
  workspaceId: string;
  userGoal: string;
  status: EnterpriseLeadRunStatus;
  currentRole: EnterpriseLeadAgentRole | null;
  controllerSummary: string;
  archiveStatus: 'not_archived' | 'archived';
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface EnterpriseLeadTodoInput {
  kind: EnterpriseLeadTodoKind | string;
  title: string;
  description: string;
  role?: EnterpriseLeadAgentRole | string;
  deliverableId?: string;
}

export interface EnterpriseLeadRiskItem {
  level: EnterpriseLeadRiskLevel | string;
  title: string;
  description: string;
  role?: EnterpriseLeadAgentRole | string;
}

export interface EnterpriseLeadAgentTaskResult {
  role: EnterpriseLeadAgentRole | string;
  summary: string;
  outputs: Record<string, unknown>;
  missingInfo: string[];
  todos: EnterpriseLeadTodoInput[];
  risks: EnterpriseLeadRiskItem[];
  handoffContext: Record<string, unknown>;
  status: EnterpriseLeadTaskStatus | string;
}

export interface EnterpriseLeadAgentTask {
  id: string;
  runId: string;
  role: EnterpriseLeadAgentRole;
  status: EnterpriseLeadTaskStatus;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  summary: string;
  missingInfo: string[];
  todos: EnterpriseLeadTodoInput[];
  risks: EnterpriseLeadRiskItem[];
  handoffContext: Record<string, unknown>;
  error: string;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EnterpriseLeadPendingVersion {
  id: string;
  taskId: string;
  runId: string;
  workspaceId: string;
  role: EnterpriseLeadAgentRole;
  userMessage: string;
  summary: string;
  outputPayload: Record<string, unknown>;
  missingInfo: string[];
  todos: EnterpriseLeadTodoInput[];
  risks: EnterpriseLeadRiskItem[];
  handoffContext: Record<string, unknown>;
  status: 'pending' | 'applied' | 'discarded';
  createdAt: string;
  appliedAt: string | null;
}

export interface EnterpriseLeadRiskReviewOutput {
  riskLevel: EnterpriseLeadRiskLevel;
  blockingIssues: string[];
  warnings: string[];
  requiredRevisions: string[];
  approvalTodos: EnterpriseLeadTodoInput[];
  draftOnlyConfirmed: boolean;
  canArchive: boolean;
}

export interface EnterpriseLeadDeliverable {
  id: string;
  runId: string;
  workspaceId: string;
  kind: EnterpriseLeadDeliverableKind;
  role: EnterpriseLeadAgentRole;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  status: 'draft' | 'approved' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface EnterpriseLeadTodo {
  id: string;
  runId: string;
  workspaceId: string;
  kind: EnterpriseLeadTodoKind;
  title: string;
  description: string;
  role: EnterpriseLeadAgentRole | null;
  status: 'open' | 'resolved';
  createdAt: string;
  updatedAt: string;
}

export interface EnterpriseLeadArchive {
  id: string;
  runId: string;
  workspaceId: string;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface EnterpriseLeadWorkspaceSnapshot {
  workspace: EnterpriseLeadWorkspace;
  currentRun: EnterpriseLeadRun | null;
  tasks: EnterpriseLeadAgentTask[];
  pendingVersions: EnterpriseLeadPendingVersion[];
  deliverables: EnterpriseLeadDeliverable[];
  todos: EnterpriseLeadTodo[];
  archives: EnterpriseLeadArchive[];
}

export interface EnterpriseLeadIpcResult<T> {
  success: boolean;
  error?: string;
  data?: T;
}
```

- [ ] **Step 5: Create validation helpers**

Create `src/shared/enterpriseLeadWorkspace/validation.ts`:

```ts
import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadRiskLevel,
  EnterpriseLeadTaskStatus,
  EnterpriseLeadTodoKind,
  EnterpriseLeadWorkspaceType,
} from './constants';
import type {
  EnterpriseLeadAgentTaskResult,
  EnterpriseLeadRiskReviewOutput,
  EnterpriseLeadTodoInput,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceProfile,
} from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const cleanText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const cleanTextList = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.map(cleanText).filter(Boolean)))
    : [];

const readRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};

const defaultProfile = (): EnterpriseLeadWorkspaceProfile => ({
  companySummary: '',
  productList: [],
  productCapabilities: [],
  targetCustomers: [],
  applicationScenarios: [],
  sellingPoints: [],
  channelPreferences: [],
  prohibitedClaims: [],
  contactRules: [],
  missingInfo: [],
});

export function normalizeWorkspaceProfile(value: unknown): EnterpriseLeadWorkspaceProfile {
  const record = readRecord(value);
  return {
    ...defaultProfile(),
    companySummary: cleanText(record.companySummary),
    productList: cleanTextList(record.productList),
    productCapabilities: cleanTextList(record.productCapabilities),
    targetCustomers: cleanTextList(record.targetCustomers),
    applicationScenarios: cleanTextList(record.applicationScenarios),
    sellingPoints: cleanTextList(record.sellingPoints),
    channelPreferences: cleanTextList(record.channelPreferences),
    prohibitedClaims: cleanTextList(record.prohibitedClaims),
    contactRules: cleanTextList(record.contactRules),
    missingInfo: cleanTextList(record.missingInfo),
  };
}

export function normalizeWorkspaceDraftInput(value: unknown): EnterpriseLeadWorkspaceDraft {
  const record = readRecord(value);
  const name = cleanText(record.name);
  if (!name) throw new Error('workspace draft name is required');

  const source = readRecord(record.source);
  const sourceKind = cleanText(source.kind) || EnterpriseLeadExtractionSourceKind.Conversation;

  return {
    name,
    type: EnterpriseLeadWorkspaceType.EnterpriseLead,
    profile: normalizeWorkspaceProfile(record.profile),
    source: {
      kind: sourceKind,
      label: cleanText(source.label) || '用户输入',
      filePath: cleanText(source.filePath) || undefined,
      text: cleanText(source.text) || undefined,
    },
    enabledAgentRoles: Object.values(EnterpriseLeadAgentRole),
  };
}

const normalizeTodo = (value: unknown): EnterpriseLeadTodoInput => {
  const record = readRecord(value);
  return {
    kind: cleanText(record.kind) || EnterpriseLeadTodoKind.MissingInfo,
    title: cleanText(record.title) || '待处理事项',
    description: cleanText(record.description),
    role: cleanText(record.role) || undefined,
    deliverableId: cleanText(record.deliverableId) || undefined,
  };
};

export function normalizeAgentTaskResultInput(value: unknown): EnterpriseLeadAgentTaskResult {
  const record = readRecord(value);
  const role = cleanText(record.role);
  if (!role) throw new Error('agent task result role is required');
  const summary = cleanText(record.summary);
  if (!summary) throw new Error('agent task result summary is required');

  return {
    role,
    summary,
    outputs: readRecord(record.outputs),
    missingInfo: cleanTextList(record.missingInfo),
    todos: Array.isArray(record.todos) ? record.todos.map(normalizeTodo) : [],
    risks: Array.isArray(record.risks)
      ? record.risks.map(item => {
        const risk = readRecord(item);
        return {
          level: cleanText(risk.level) || EnterpriseLeadRiskLevel.Low,
          title: cleanText(risk.title) || '风险提示',
          description: cleanText(risk.description),
          role: cleanText(risk.role) || undefined,
        };
      })
      : [],
    handoffContext: readRecord(record.handoffContext),
    status: cleanText(record.status) || EnterpriseLeadTaskStatus.Completed,
  };
}

export function normalizeRiskReviewOutput(value: unknown): EnterpriseLeadRiskReviewOutput {
  const record = readRecord(value);
  const riskLevel = cleanText(record.riskLevel) as EnterpriseLeadRiskLevel;
  const normalizedLevel = Object.values(EnterpriseLeadRiskLevel).includes(riskLevel)
    ? riskLevel
    : EnterpriseLeadRiskLevel.Medium;
  const blockingIssues = cleanTextList(record.blockingIssues);
  return {
    riskLevel: normalizedLevel,
    blockingIssues,
    warnings: cleanTextList(record.warnings),
    requiredRevisions: cleanTextList(record.requiredRevisions),
    approvalTodos: Array.isArray(record.approvalTodos)
      ? record.approvalTodos.map(normalizeTodo)
      : [],
    draftOnlyConfirmed: record.draftOnlyConfirmed === true,
    canArchive: normalizedLevel === EnterpriseLeadRiskLevel.High
      ? false
      : record.canArchive !== false,
  };
}
```

- [ ] **Step 6: Run tests and changed-file lint**

Run:

```bash
npm test -- src/shared/enterpriseLeadWorkspace/validation.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/enterpriseLeadWorkspace/constants.ts src/shared/enterpriseLeadWorkspace/types.ts src/shared/enterpriseLeadWorkspace/validation.ts src/shared/enterpriseLeadWorkspace/validation.test.ts
```

Expected: both pass.

- [ ] **Step 7: Check worktree state**

Run:

```bash
git status --short
```

Expected: only the four new shared enterprise lead workspace files plus existing docs/plan files are changed.

## Task 2: Main SQLite Store

**Files:**

- Create: `src/main/enterpriseLeadWorkspace/store.ts`
- Create: `src/main/enterpriseLeadWorkspace/store.test.ts`

- [ ] **Step 1: Write store tests**

Create `src/main/enterpriseLeadWorkspace/store.test.ts`:

```ts
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadRiskLevel,
  EnterpriseLeadTaskStatus,
  EnterpriseLeadTodoKind,
} from '../../shared/enterpriseLeadWorkspace/constants';
import { EnterpriseLeadWorkspaceStore } from './store';

const createStore = () => new EnterpriseLeadWorkspaceStore(new Database(':memory:'));

describe('EnterpriseLeadWorkspaceStore', () => {
  test('creates and lists workspaces', () => {
    const store = createStore();
    const workspace = store.createWorkspace({
      name: '重型包装获客',
      profile: {
        companySummary: '东莞重型包装工厂',
        productList: ['重型纸箱'],
        productCapabilities: [],
        targetCustomers: ['汽配'],
        applicationScenarios: [],
        sellingPoints: ['防破损'],
        channelPreferences: ['朋友圈'],
        prohibitedClaims: ['不得编造承重'],
        contactRules: [],
        missingInfo: ['真实案例'],
      },
      source: { kind: 'conversation', label: '用户描述' },
      enabledAgentRoles: Object.values(EnterpriseLeadAgentRole),
    });

    expect(workspace.name).toBe('重型包装获客');
    expect(store.listWorkspaces()).toHaveLength(1);
    expect(store.getWorkspace(workspace.id)?.profile.productList).toEqual(['重型纸箱']);
  });

  test('creates a run with fixed Agent tasks', () => {
    const store = createStore();
    const workspace = store.createWorkspace({
      name: '重型包装获客',
      profile: { companySummary: '', productList: [], productCapabilities: [], targetCustomers: [], applicationScenarios: [], sellingPoints: [], channelPreferences: [], prohibitedClaims: [], contactRules: [], missingInfo: [] },
      source: { kind: 'conversation', label: '用户描述' },
      enabledAgentRoles: Object.values(EnterpriseLeadAgentRole),
    });

    const run = store.createRun({
      workspaceId: workspace.id,
      userGoal: '我要推广一个产品',
      agentRoles: Object.values(EnterpriseLeadAgentRole),
    });

    const tasks = store.listTasks(run.id);
    expect(tasks.map(task => task.role)).toEqual(Object.values(EnterpriseLeadAgentRole));
    expect(tasks[0].status).toBe(EnterpriseLeadTaskStatus.Waiting);
  });

  test('reads the current run by id', () => {
    const store = createStore();
    const workspace = store.createWorkspace({
      name: '重型包装获客',
      profile: { companySummary: '', productList: [], productCapabilities: [], targetCustomers: [], applicationScenarios: [], sellingPoints: [], channelPreferences: [], prohibitedClaims: [], contactRules: [], missingInfo: [] },
      source: { kind: 'conversation', label: '用户描述' },
      enabledAgentRoles: Object.values(EnterpriseLeadAgentRole),
    });
    const run = store.createRun({
      workspaceId: workspace.id,
      userGoal: '我要推广一个产品',
      agentRoles: Object.values(EnterpriseLeadAgentRole),
    });

    expect(store.getRun(run.id)?.userGoal).toBe('我要推广一个产品');
  });

  test('updates task result and stores structured task output', () => {
    const store = createStore();
    const workspace = store.createWorkspace({
      name: '重型包装获客',
      profile: { companySummary: '', productList: [], productCapabilities: [], targetCustomers: [], applicationScenarios: [], sellingPoints: [], channelPreferences: [], prohibitedClaims: [], contactRules: [], missingInfo: [] },
      source: { kind: 'conversation', label: '用户描述' },
      enabledAgentRoles: Object.values(EnterpriseLeadAgentRole),
    });
    const run = store.createRun({
      workspaceId: workspace.id,
      userGoal: '我要推广一个产品',
      agentRoles: Object.values(EnterpriseLeadAgentRole),
    });
    const task = store.listTasks(run.id)[1];

    store.updateTaskResult(task.id, {
      role: task.role,
      summary: '已完成商机判断',
      outputs: { customerDirections: ['汽配'] },
      missingInfo: [],
      todos: [{ kind: EnterpriseLeadTodoKind.ConfirmSource, title: '确认来源', description: '采购信号需要来源' }],
      risks: [{ level: EnterpriseLeadRiskLevel.Low, title: '来源不足', description: '需要补充来源' }],
      handoffContext: { priority: '汽配' },
      status: EnterpriseLeadTaskStatus.Completed,
    });

    const updated = store.getTask(task.id);
    expect(updated?.summary).toBe('已完成商机判断');
    expect(updated?.todos[0].kind).toBe(EnterpriseLeadTodoKind.ConfirmSource);
    expect(updated?.handoffContext).toEqual({ priority: '汽配' });
  });

  test('creates and applies a pending Agent version', () => {
    const store = createStore();
    const workspace = store.createWorkspace({
      name: '重型包装获客',
      profile: { companySummary: '', productList: [], productCapabilities: [], targetCustomers: [], applicationScenarios: [], sellingPoints: [], channelPreferences: [], prohibitedClaims: [], contactRules: [], missingInfo: [] },
      source: { kind: 'conversation', label: '用户描述' },
      enabledAgentRoles: Object.values(EnterpriseLeadAgentRole),
    });
    const run = store.createRun({
      workspaceId: workspace.id,
      userGoal: '我要推广一个产品',
      agentRoles: Object.values(EnterpriseLeadAgentRole),
    });
    const task = store.listTasks(run.id)[3];
    const pending = store.createPendingVersion({
      workspaceId: workspace.id,
      taskId: task.id,
      runId: run.id,
      role: task.role,
      userMessage: '把内容改得更像朋友圈',
      result: {
        role: task.role,
        summary: '已生成更适合朋友圈的版本',
        outputs: { posts: ['朋友圈草稿'] },
        missingInfo: [],
        todos: [],
        risks: [],
        handoffContext: { channel: '朋友圈' },
        status: EnterpriseLeadTaskStatus.Completed,
      },
    });

    expect(store.listPendingVersions(run.id)).toHaveLength(1);
    store.applyPendingVersion(pending.id);
    expect(store.getTask(task.id)?.summary).toBe('已生成更适合朋友圈的版本');
    expect(store.listPendingVersions(run.id)[0].status).toBe('applied');
  });
});
```

- [ ] **Step 2: Run store tests and confirm failure**

Run:

```bash
npm test -- src/main/enterpriseLeadWorkspace/store.test.ts
```

Expected: fail because `src/main/enterpriseLeadWorkspace/store.ts` does not exist.

- [ ] **Step 3: Implement the store**

Create `src/main/enterpriseLeadWorkspace/store.ts` with these responsibilities:

```ts
import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';

import {
  EnterpriseLeadRunStatus,
  EnterpriseLeadTaskStatus,
  EnterpriseLeadWorkspaceType,
  type EnterpriseLeadAgentRole,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadAgentTaskResult,
  EnterpriseLeadArchive,
  EnterpriseLeadDeliverable,
  EnterpriseLeadExtractionSource,
  EnterpriseLeadPendingVersion,
  EnterpriseLeadRun,
  EnterpriseLeadTodo,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceProfile,
} from '../../shared/enterpriseLeadWorkspace/types';

interface CreateWorkspaceInput {
  name: string;
  profile: EnterpriseLeadWorkspaceProfile;
  source: EnterpriseLeadExtractionSource;
  enabledAgentRoles: EnterpriseLeadAgentRole[];
}

interface CreateRunInput {
  workspaceId: string;
  userGoal: string;
  agentRoles: EnterpriseLeadAgentRole[];
}

interface CreatePendingVersionInput {
  workspaceId: string;
  taskId: string;
  runId: string;
  role: EnterpriseLeadAgentRole;
  userMessage: string;
  result: EnterpriseLeadAgentTaskResult;
}

type WorkspaceRow = Omit<EnterpriseLeadWorkspace, 'profile' | 'extractionSources' | 'riskRules' | 'enabledAgentRoles'> & {
  profile: string;
  extractionSources: string;
  riskRules: string;
  enabledAgentRoles: string;
};

type RunRow = Omit<EnterpriseLeadRun, 'currentRole'> & {
  currentRole: string | null;
};

type TaskRow = Omit<EnterpriseLeadAgentTask, 'inputPayload' | 'outputPayload' | 'missingInfo' | 'todos' | 'risks' | 'handoffContext' | 'stale'> & {
  inputPayload: string;
  outputPayload: string;
  missingInfo: string;
  todos: string;
  risks: string;
  handoffContext: string;
  stale: number;
};

type PendingVersionRow = Omit<EnterpriseLeadPendingVersion, 'outputPayload' | 'missingInfo' | 'todos' | 'risks' | 'handoffContext'> & {
  outputPayload: string;
  missingInfo: string;
  todos: string;
  risks: string;
  handoffContext: string;
};

const parseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const nowIso = (): string => new Date().toISOString();

export class EnterpriseLeadWorkspaceStore {
  constructor(private readonly db: Database.Database) {
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS enterprise_lead_workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        profile TEXT NOT NULL,
        extraction_sources TEXT NOT NULL,
        risk_rules TEXT NOT NULL,
        enabled_agent_roles TEXT NOT NULL,
        recent_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS enterprise_lead_runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_goal TEXT NOT NULL,
        status TEXT NOT NULL,
        current_role TEXT,
        controller_summary TEXT NOT NULL,
        archive_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS enterprise_lead_agent_tasks (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        input_payload TEXT NOT NULL,
        output_payload TEXT NOT NULL,
        summary TEXT NOT NULL,
        missing_info TEXT NOT NULL,
        todos TEXT NOT NULL,
        risks TEXT NOT NULL,
        handoff_context TEXT NOT NULL,
        error TEXT NOT NULL,
        stale INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS enterprise_lead_pending_versions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        role TEXT NOT NULL,
        user_message TEXT NOT NULL,
        summary TEXT NOT NULL,
        output_payload TEXT NOT NULL,
        missing_info TEXT NOT NULL,
        todos TEXT NOT NULL,
        risks TEXT NOT NULL,
        handoff_context TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        applied_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_enterprise_lead_runs_workspace_id
      ON enterprise_lead_runs(workspace_id);

      CREATE INDEX IF NOT EXISTS idx_enterprise_lead_agent_tasks_run_id
      ON enterprise_lead_agent_tasks(run_id);

      CREATE INDEX IF NOT EXISTS idx_enterprise_lead_pending_versions_run_id
      ON enterprise_lead_pending_versions(run_id);
    `);
  }

  createWorkspace(input: CreateWorkspaceInput): EnterpriseLeadWorkspace {
    const now = nowIso();
    const workspace: EnterpriseLeadWorkspace = {
      id: randomUUID(),
      name: input.name.trim(),
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile: input.profile,
      extractionSources: [input.source],
      riskRules: [
        'no_real_publish',
        'no_real_comment',
        'no_real_direct_message',
        'no_real_email',
        'draft_only_external_actions',
      ],
      enabledAgentRoles: input.enabledAgentRoles,
      recentRunId: null,
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO enterprise_lead_workspaces (
        id, name, type, profile, extraction_sources, risk_rules,
        enabled_agent_roles, recent_run_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      workspace.id,
      workspace.name,
      workspace.type,
      JSON.stringify(workspace.profile),
      JSON.stringify(workspace.extractionSources),
      JSON.stringify(workspace.riskRules),
      JSON.stringify(workspace.enabledAgentRoles),
      workspace.recentRunId,
      workspace.createdAt,
      workspace.updatedAt,
    );

    return workspace;
  }

  listWorkspaces(): EnterpriseLeadWorkspace[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        name,
        type,
        profile,
        extraction_sources as extractionSources,
        risk_rules as riskRules,
        enabled_agent_roles as enabledAgentRoles,
        recent_run_id as recentRunId,
        created_at as createdAt,
        updated_at as updatedAt
      FROM enterprise_lead_workspaces
      ORDER BY updated_at DESC
    `).all() as WorkspaceRow[];
    return rows.map(row => this.mapWorkspace(row));
  }

  getWorkspace(id: string): EnterpriseLeadWorkspace | null {
    const row = this.db.prepare(`
      SELECT
        id,
        name,
        type,
        profile,
        extraction_sources as extractionSources,
        risk_rules as riskRules,
        enabled_agent_roles as enabledAgentRoles,
        recent_run_id as recentRunId,
        created_at as createdAt,
        updated_at as updatedAt
      FROM enterprise_lead_workspaces
      WHERE id = ?
      LIMIT 1
    `).get(id) as WorkspaceRow | undefined;
    return row ? this.mapWorkspace(row) : null;
  }

  createRun(input: CreateRunInput): EnterpriseLeadRun {
    const workspace = this.getWorkspace(input.workspaceId);
    if (!workspace) throw new Error('Enterprise lead workspace not found');

    const now = nowIso();
    const run: EnterpriseLeadRun = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      userGoal: input.userGoal.trim(),
      status: EnterpriseLeadRunStatus.Running,
      currentRole: null,
      controllerSummary: '',
      archiveStatus: 'not_archived',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    const insertRun = this.db.prepare(`
      INSERT INTO enterprise_lead_runs (
        id, workspace_id, user_goal, status, current_role, controller_summary,
        archive_status, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertTask = this.db.prepare(`
      INSERT INTO enterprise_lead_agent_tasks (
        id, run_id, role, status, input_payload, output_payload, summary,
        missing_info, todos, risks, handoff_context, error, stale, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      insertRun.run(
        run.id,
        run.workspaceId,
        run.userGoal,
        run.status,
        run.currentRole,
        run.controllerSummary,
        run.archiveStatus,
        run.createdAt,
        run.updatedAt,
        run.completedAt,
      );
      input.agentRoles.forEach(role => {
        insertTask.run(
          randomUUID(),
          run.id,
          role,
          EnterpriseLeadTaskStatus.Waiting,
          JSON.stringify({ workspaceId: workspace.id, workspaceProfile: workspace.profile, userGoal: run.userGoal }),
          '{}',
          '',
          '[]',
          '[]',
          '[]',
          '{}',
          '',
          0,
          now,
          now,
        );
      });
      this.db.prepare(`
        UPDATE enterprise_lead_workspaces
        SET recent_run_id = ?, updated_at = ?
        WHERE id = ?
      `).run(run.id, now, workspace.id);
    })();

    return run;
  }

  getRun(runId: string): EnterpriseLeadRun | null {
    const row = this.db.prepare(`
      SELECT
        id,
        workspace_id as workspaceId,
        user_goal as userGoal,
        status,
        current_role as currentRole,
        controller_summary as controllerSummary,
        archive_status as archiveStatus,
        created_at as createdAt,
        updated_at as updatedAt,
        completed_at as completedAt
      FROM enterprise_lead_runs
      WHERE id = ?
      LIMIT 1
    `).get(runId) as RunRow | undefined;
    return row ? this.mapRun(row) : null;
  }

  listTasks(runId: string): EnterpriseLeadAgentTask[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        run_id as runId,
        role,
        status,
        input_payload as inputPayload,
        output_payload as outputPayload,
        summary,
        missing_info as missingInfo,
        todos,
        risks,
        handoff_context as handoffContext,
        error,
        stale,
        created_at as createdAt,
        updated_at as updatedAt
      FROM enterprise_lead_agent_tasks
      WHERE run_id = ?
      ORDER BY rowid ASC
    `).all(runId) as TaskRow[];
    return rows.map(row => this.mapTask(row));
  }

  getTask(taskId: string): EnterpriseLeadAgentTask | null {
    const row = this.db.prepare(`
      SELECT
        id,
        run_id as runId,
        role,
        status,
        input_payload as inputPayload,
        output_payload as outputPayload,
        summary,
        missing_info as missingInfo,
        todos,
        risks,
        handoff_context as handoffContext,
        error,
        stale,
        created_at as createdAt,
        updated_at as updatedAt
      FROM enterprise_lead_agent_tasks
      WHERE id = ?
      LIMIT 1
    `).get(taskId) as TaskRow | undefined;
    return row ? this.mapTask(row) : null;
  }

  updateTaskResult(taskId: string, result: EnterpriseLeadAgentTaskResult): void {
    const now = nowIso();
    this.db.prepare(`
      UPDATE enterprise_lead_agent_tasks
      SET
        status = ?,
        output_payload = ?,
        summary = ?,
        missing_info = ?,
        todos = ?,
        risks = ?,
        handoff_context = ?,
        error = '',
        stale = 0,
        updated_at = ?
      WHERE id = ?
    `).run(
      result.status,
      JSON.stringify(result.outputs),
      result.summary,
      JSON.stringify(result.missingInfo),
      JSON.stringify(result.todos),
      JSON.stringify(result.risks),
      JSON.stringify(result.handoffContext),
      now,
      taskId,
    );
  }

  createPendingVersion(input: CreatePendingVersionInput): EnterpriseLeadPendingVersion {
    const now = nowIso();
    const pending: EnterpriseLeadPendingVersion = {
      id: randomUUID(),
      taskId: input.taskId,
      runId: input.runId,
      workspaceId: input.workspaceId,
      role: input.role,
      userMessage: input.userMessage.trim(),
      summary: input.result.summary,
      outputPayload: input.result.outputs,
      missingInfo: input.result.missingInfo,
      todos: input.result.todos,
      risks: input.result.risks,
      handoffContext: input.result.handoffContext,
      status: 'pending',
      createdAt: now,
      appliedAt: null,
    };

    this.db.prepare(`
      INSERT INTO enterprise_lead_pending_versions (
        id, task_id, run_id, workspace_id, role, user_message, summary,
        output_payload, missing_info, todos, risks, handoff_context,
        status, created_at, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pending.id,
      pending.taskId,
      pending.runId,
      pending.workspaceId,
      pending.role,
      pending.userMessage,
      pending.summary,
      JSON.stringify(pending.outputPayload),
      JSON.stringify(pending.missingInfo),
      JSON.stringify(pending.todos),
      JSON.stringify(pending.risks),
      JSON.stringify(pending.handoffContext),
      pending.status,
      pending.createdAt,
      pending.appliedAt,
    );

    return pending;
  }

  listPendingVersions(runId: string): EnterpriseLeadPendingVersion[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        task_id as taskId,
        run_id as runId,
        workspace_id as workspaceId,
        role,
        user_message as userMessage,
        summary,
        output_payload as outputPayload,
        missing_info as missingInfo,
        todos,
        risks,
        handoff_context as handoffContext,
        status,
        created_at as createdAt,
        applied_at as appliedAt
      FROM enterprise_lead_pending_versions
      WHERE run_id = ?
      ORDER BY created_at DESC
    `).all(runId) as PendingVersionRow[];
    return rows.map(row => this.mapPendingVersion(row));
  }

  applyPendingVersion(pendingVersionId: string): void {
    const row = this.db.prepare(`
      SELECT
        id,
        task_id as taskId,
        run_id as runId,
        workspace_id as workspaceId,
        role,
        user_message as userMessage,
        summary,
        output_payload as outputPayload,
        missing_info as missingInfo,
        todos,
        risks,
        handoff_context as handoffContext,
        status,
        created_at as createdAt,
        applied_at as appliedAt
      FROM enterprise_lead_pending_versions
      WHERE id = ?
      LIMIT 1
    `).get(pendingVersionId) as PendingVersionRow | undefined;
    if (!row) throw new Error('Enterprise lead pending version not found');
    const pending = this.mapPendingVersion(row);
    const tasks = this.listTasks(pending.runId);
    const taskIndex = tasks.findIndex(task => task.id === pending.taskId);
    if (taskIndex < 0) throw new Error('Enterprise lead Agent task not found for pending version');
    const now = nowIso();

    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE enterprise_lead_agent_tasks
        SET
          status = ?,
          output_payload = ?,
          summary = ?,
          missing_info = ?,
          todos = ?,
          risks = ?,
          handoff_context = ?,
          error = '',
          stale = 0,
          updated_at = ?
        WHERE id = ?
      `).run(
        EnterpriseLeadTaskStatus.Completed,
        JSON.stringify(pending.outputPayload),
        pending.summary,
        JSON.stringify(pending.missingInfo),
        JSON.stringify(pending.todos),
        JSON.stringify(pending.risks),
        JSON.stringify(pending.handoffContext),
        now,
        pending.taskId,
      );

      tasks.slice(taskIndex + 1).forEach(task => {
        this.db.prepare(`
          UPDATE enterprise_lead_agent_tasks
          SET stale = 1, status = ?, updated_at = ?
          WHERE id = ?
        `).run(EnterpriseLeadTaskStatus.Stale, now, task.id);
      });

      this.db.prepare(`
        UPDATE enterprise_lead_pending_versions
        SET status = 'applied', applied_at = ?
        WHERE id = ?
      `).run(now, pending.id);
    })();
  }

  private mapWorkspace(row: WorkspaceRow): EnterpriseLeadWorkspace {
    return {
      ...row,
      profile: parseJson(row.profile, {} as EnterpriseLeadWorkspace['profile']),
      extractionSources: parseJson(row.extractionSources, []),
      riskRules: parseJson(row.riskRules, []),
      enabledAgentRoles: parseJson(row.enabledAgentRoles, []),
    };
  }

  private mapRun(row: RunRow): EnterpriseLeadRun {
    return {
      ...row,
      currentRole: row.currentRole as EnterpriseLeadRun['currentRole'],
    };
  }

  private mapTask(row: TaskRow): EnterpriseLeadAgentTask {
    return {
      ...row,
      inputPayload: parseJson(row.inputPayload, {}),
      outputPayload: parseJson(row.outputPayload, {}),
      missingInfo: parseJson(row.missingInfo, []),
      todos: parseJson(row.todos, []),
      risks: parseJson(row.risks, []),
      handoffContext: parseJson(row.handoffContext, {}),
      stale: row.stale === 1,
    };
  }

  private mapPendingVersion(row: PendingVersionRow): EnterpriseLeadPendingVersion {
    return {
      ...row,
      outputPayload: parseJson(row.outputPayload, {}),
      missingInfo: parseJson(row.missingInfo, []),
      todos: parseJson(row.todos, []),
      risks: parseJson(row.risks, []),
      handoffContext: parseJson(row.handoffContext, {}),
    };
  }
}
```

- [ ] **Step 4: Run store tests and lint**

Run:

```bash
npm test -- src/main/enterpriseLeadWorkspace/store.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/enterpriseLeadWorkspace/store.ts src/main/enterpriseLeadWorkspace/store.test.ts
```

Expected: both pass.

## Task 3: Workflow Metadata And Stale Propagation

**Files:**

- Create: `src/main/enterpriseLeadWorkspace/workflow.ts`
- Create: `src/main/enterpriseLeadWorkspace/workflow.test.ts`

- [ ] **Step 1: Write workflow tests**

Create `src/main/enterpriseLeadWorkspace/workflow.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { EnterpriseLeadAgentRole } from '../../shared/enterpriseLeadWorkspace/constants';
import {
  ENTERPRISE_LEAD_AGENT_WORKFLOW,
  getDownstreamAgentRoles,
  getEnterpriseLeadAgentMetadata,
} from './workflow';

describe('enterprise lead workflow', () => {
  test('defines the fixed Agent order', () => {
    expect(ENTERPRISE_LEAD_AGENT_WORKFLOW.map(agent => agent.role)).toEqual([
      EnterpriseLeadAgentRole.Controller,
      EnterpriseLeadAgentRole.ProductUnderstanding,
      EnterpriseLeadAgentRole.OpportunityRadar,
      EnterpriseLeadAgentRole.ContentPlanning,
      EnterpriseLeadAgentRole.SocialOperation,
      EnterpriseLeadAgentRole.SalesHandoff,
      EnterpriseLeadAgentRole.RiskReview,
      EnterpriseLeadAgentRole.ProjectSummary,
      EnterpriseLeadAgentRole.ProjectArchive,
    ]);
  });

  test('returns user-facing metadata for Agent cards', () => {
    const metadata = getEnterpriseLeadAgentMetadata(EnterpriseLeadAgentRole.RiskReview);
    expect(metadata.title).toBe('风控审核 Agent');
    expect(metadata.shortLabel).toBe('控');
    expect(metadata.safetyCritical).toBe(true);
  });

  test('marks downstream roles stale after content planning changes', () => {
    expect(getDownstreamAgentRoles(EnterpriseLeadAgentRole.ContentPlanning)).toEqual([
      EnterpriseLeadAgentRole.SocialOperation,
      EnterpriseLeadAgentRole.SalesHandoff,
      EnterpriseLeadAgentRole.RiskReview,
      EnterpriseLeadAgentRole.ProjectSummary,
      EnterpriseLeadAgentRole.ProjectArchive,
    ]);
  });
});
```

- [ ] **Step 2: Run workflow tests and confirm failure**

Run:

```bash
npm test -- src/main/enterpriseLeadWorkspace/workflow.test.ts
```

Expected: fail because `workflow.ts` does not exist.

- [ ] **Step 3: Implement workflow metadata**

Create `src/main/enterpriseLeadWorkspace/workflow.ts`:

```ts
import { EnterpriseLeadAgentRole, type EnterpriseLeadAgentRole as EnterpriseLeadAgentRoleValue } from '../../shared/enterpriseLeadWorkspace/constants';

export interface EnterpriseLeadAgentMetadata {
  role: EnterpriseLeadAgentRoleValue;
  title: string;
  shortLabel: string;
  description: string;
  inputSummary: string;
  outputSummary: string;
  safetyCritical: boolean;
}

export const ENTERPRISE_LEAD_AGENT_WORKFLOW: EnterpriseLeadAgentMetadata[] = [
  {
    role: EnterpriseLeadAgentRole.Controller,
    title: '项目总控 Agent',
    shortLabel: '总',
    description: '理解目标、拆解任务、调度专业 Agent、汇总状态。',
    inputSummary: '用户目标、工作空间资料、历史执行',
    outputSummary: '执行计划、阶段状态、总控总结',
    safetyCritical: true,
  },
  {
    role: EnterpriseLeadAgentRole.ProductUnderstanding,
    title: '产品理解 Agent',
    shortLabel: '产',
    description: '整理产品画像、卖点、适合客户、应用场景和缺失资料。',
    inputSummary: '用户目标、企业资料、产品资料',
    outputSummary: '产品画像、核心卖点、适合客户、缺失信息',
    safetyCritical: false,
  },
  {
    role: EnterpriseLeadAgentRole.OpportunityRadar,
    title: '商机雷达 Agent',
    shortLabel: '商',
    description: '判断客户方向、采购信号、商机评分和跟进优先级。',
    inputSummary: '产品画像、客户方向、市场线索',
    outputSummary: '商机评分、采购信号、优先级建议',
    safetyCritical: false,
  },
  {
    role: EnterpriseLeadAgentRole.ContentPlanning,
    title: '内容策划 Agent',
    shortLabel: '内',
    description: '生成小红书、短视频、公众号、产品介绍和销售话术草稿。',
    inputSummary: '产品理解、商机判断、渠道偏好、禁用表达',
    outputSummary: '内容草稿、高风险表达、下游上下文',
    safetyCritical: false,
  },
  {
    role: EnterpriseLeadAgentRole.SocialOperation,
    title: '社媒运营 Agent',
    shortLabel: '媒',
    description: '生成发布计划、评论回复草稿、私信草稿和运营待办。',
    inputSummary: '内容草稿、平台偏好、互动规则',
    outputSummary: '社媒计划、评论草稿、私信草稿、人工待办',
    safetyCritical: true,
  },
  {
    role: EnterpriseLeadAgentRole.SalesHandoff,
    title: '销售交接 Agent',
    shortLabel: '销',
    description: '生成销售交接单、SOP、异议处理和每日人工待办。',
    inputSummary: '商机评分、客户痛点、内容成果',
    outputSummary: '销售交接单、跟进 SOP、销售待办',
    safetyCritical: false,
  },
  {
    role: EnterpriseLeadAgentRole.RiskReview,
    title: '风控审核 Agent',
    shortLabel: '控',
    description: '检查外发风险、夸大宣传、来源缺失和人工审批。',
    inputSummary: '全部草稿、外部动作、来源声明',
    outputSummary: '风险等级、返工项、审批项',
    safetyCritical: true,
  },
  {
    role: EnterpriseLeadAgentRole.ProjectSummary,
    title: '项目归纳 Agent',
    shortLabel: '归',
    description: '汇总所有 Agent 输出，生成用户可读的最终总结。',
    inputSummary: '全部模块结果、返工日志、风控结论',
    outputSummary: '最终总结、待确认事项、下一步建议',
    safetyCritical: false,
  },
  {
    role: EnterpriseLeadAgentRole.ProjectArchive,
    title: '项目归档 Agent',
    shortLabel: '档',
    description: '保存成果、风控记录、待办和历史查看入口。',
    inputSummary: '最终总结、成果包、风控记录、待办',
    outputSummary: '归档记录、结果索引、重新打开入口',
    safetyCritical: true,
  },
];

export function getEnterpriseLeadAgentMetadata(
  role: EnterpriseLeadAgentRoleValue,
): EnterpriseLeadAgentMetadata {
  const metadata = ENTERPRISE_LEAD_AGENT_WORKFLOW.find(item => item.role === role);
  if (!metadata) throw new Error(`Unknown enterprise lead Agent role: ${role}`);
  return metadata;
}

export function getDownstreamAgentRoles(
  role: EnterpriseLeadAgentRoleValue,
): EnterpriseLeadAgentRoleValue[] {
  const index = ENTERPRISE_LEAD_AGENT_WORKFLOW.findIndex(item => item.role === role);
  if (index < 0) throw new Error(`Unknown enterprise lead Agent role: ${role}`);
  return ENTERPRISE_LEAD_AGENT_WORKFLOW.slice(index + 1).map(item => item.role);
}
```

- [ ] **Step 4: Run workflow tests and lint**

Run:

```bash
npm test -- src/main/enterpriseLeadWorkspace/workflow.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/enterpriseLeadWorkspace/workflow.ts src/main/enterpriseLeadWorkspace/workflow.test.ts
```

Expected: both pass.

## Task 4: Model JSON Parsing, Prompts, And Service

**Files:**

- Create: `src/main/enterpriseLeadWorkspace/modelJson.ts`
- Create: `src/main/enterpriseLeadWorkspace/promptTemplates.ts`
- Create: `src/main/enterpriseLeadWorkspace/service.ts`
- Create: `src/main/enterpriseLeadWorkspace/service.test.ts`

- [ ] **Step 1: Write service tests with fake model client**

Create `src/main/enterpriseLeadWorkspace/service.test.ts`:

```ts
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { EnterpriseLeadAgentRole, EnterpriseLeadRiskLevel, EnterpriseLeadTaskStatus } from '../../shared/enterpriseLeadWorkspace/constants';
import type { ModelClientAdapter } from '../industryPack/modelClientAdapter';
import { EnterpriseLeadWorkspaceStore } from './store';
import { EnterpriseLeadWorkspaceService } from './service';

const createModelClient = (responses: string[]): ModelClientAdapter => {
  let index = 0;
  return {
    async generate() {
      const text = responses[index] ?? responses[responses.length - 1];
      index += 1;
      return { text };
    },
  };
};

const createService = (responses: string[]) => {
  const store = new EnterpriseLeadWorkspaceStore(new Database(':memory:'));
  return {
    store,
    service: new EnterpriseLeadWorkspaceService({
      store,
      modelClient: createModelClient(responses),
    }),
  };
};

describe('EnterpriseLeadWorkspaceService', () => {
  test('extracts a workspace draft from conversation text', async () => {
    const { service } = createService([
      JSON.stringify({
        name: '重型包装获客',
        profile: {
          companySummary: '东莞工厂，做重型纸箱',
          productList: ['重型纸箱'],
          targetCustomers: ['汽配'],
          channelPreferences: ['朋友圈'],
          sellingPoints: ['防破损'],
          prohibitedClaims: ['不能编造承重'],
          missingInfo: ['客户案例'],
        },
      }),
    ]);

    const draft = await service.extractDraftFromConversation('我们做重型纸箱，想找汽配客户');
    expect(draft.name).toBe('重型包装获客');
    expect(draft.profile.targetCustomers).toEqual(['汽配']);
    expect(draft.source.kind).toBe('conversation');
  });

  test('creates a workspace and a run with Agent tasks', async () => {
    const { service } = createService(['{}']);
    const workspace = service.createWorkspace({
      name: '重型包装获客',
      profile: { companySummary: '', productList: [], productCapabilities: [], targetCustomers: [], applicationScenarios: [], sellingPoints: [], channelPreferences: [], prohibitedClaims: [], contactRules: [], missingInfo: [] },
      source: { kind: 'conversation', label: '用户描述' },
      enabledAgentRoles: Object.values(EnterpriseLeadAgentRole),
    });

    const snapshot = service.createRun(workspace.id, '我要推广一个产品');
    expect(snapshot.currentRun?.userGoal).toBe('我要推广一个产品');
    expect(snapshot.tasks.map(task => task.role)).toEqual(Object.values(EnterpriseLeadAgentRole));
  });

  test('creates a pending Agent version and applies it', async () => {
    const { service } = createService([
      JSON.stringify({
        role: EnterpriseLeadAgentRole.ContentPlanning,
        summary: '已改成朋友圈表达',
        outputs: { posts: ['朋友圈草稿'] },
        missingInfo: [],
        todos: [],
        risks: [],
        handoffContext: { channel: '朋友圈' },
        status: EnterpriseLeadTaskStatus.Completed,
      }),
    ]);
    const workspace = service.createWorkspace({
      name: '重型包装获客',
      profile: { companySummary: '', productList: [], productCapabilities: [], targetCustomers: [], applicationScenarios: [], sellingPoints: [], channelPreferences: [], prohibitedClaims: [], contactRules: [], missingInfo: [] },
      source: { kind: 'conversation', label: '用户描述' },
      enabledAgentRoles: Object.values(EnterpriseLeadAgentRole),
    });
    const snapshot = service.createRun(workspace.id, '我要推广一个产品');
    const task = snapshot.tasks.find(item => item.role === EnterpriseLeadAgentRole.ContentPlanning);
    if (!task) throw new Error('missing content task');

    const pending = await service.createPendingVersionFromChat(task.id, '把内容改得更像朋友圈');
    expect(pending.summary).toBe('已改成朋友圈表达');
    const appliedSnapshot = service.applyPendingVersion(pending.id);
    expect(appliedSnapshot.tasks.find(item => item.id === task.id)?.summary).toBe('已改成朋友圈表达');
    expect(appliedSnapshot.pendingVersions[0].status).toBe('applied');
  });

  test('runs a risk review and blocks archive on high risk', async () => {
    const { service, store } = createService([
      JSON.stringify({
        role: EnterpriseLeadAgentRole.RiskReview,
        summary: '发现高风险外发表达',
        outputs: {
          riskLevel: EnterpriseLeadRiskLevel.High,
          blockingIssues: ['私信草稿写成已私信'],
          warnings: [],
          requiredRevisions: ['改成待人工私信草稿'],
          approvalTodos: [],
          draftOnlyConfirmed: false,
          canArchive: true,
        },
        missingInfo: [],
        todos: [],
        risks: [],
        handoffContext: {},
        status: 'blocked',
      }),
    ]);
    const workspace = store.createWorkspace({
      name: '重型包装获客',
      profile: { companySummary: '', productList: [], productCapabilities: [], targetCustomers: [], applicationScenarios: [], sellingPoints: [], channelPreferences: [], prohibitedClaims: [], contactRules: [], missingInfo: [] },
      source: { kind: 'conversation', label: '用户描述' },
      enabledAgentRoles: Object.values(EnterpriseLeadAgentRole),
    });
    const run = store.createRun({
      workspaceId: workspace.id,
      userGoal: '准备私信草稿',
      agentRoles: Object.values(EnterpriseLeadAgentRole),
    });
    const riskTask = store.listTasks(run.id).find(task => task.role === EnterpriseLeadAgentRole.RiskReview);
    if (!riskTask) throw new Error('missing risk task');

    const result = await service.runTask(riskTask.id);
    expect(result.status).toBe('blocked');
    expect(result.outputPayload.riskLevel).toBe(EnterpriseLeadRiskLevel.High);
  });
});
```

- [ ] **Step 2: Run service tests and confirm failure**

Run:

```bash
npm test -- src/main/enterpriseLeadWorkspace/service.test.ts
```

Expected: fail because service files do not exist.

- [ ] **Step 3: Implement JSON parsing helper**

Create `src/main/enterpriseLeadWorkspace/modelJson.ts`:

```ts
export function cleanModelJsonText(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenceMatch) return fenceMatch[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

export function parseModelJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(cleanModelJsonText(text)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Enterprise lead model response must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}
```

- [ ] **Step 4: Implement prompt builders**

Create `src/main/enterpriseLeadWorkspace/promptTemplates.ts`:

```ts
import type { EnterpriseLeadAgentRole } from '../../shared/enterpriseLeadWorkspace/constants';
import type { EnterpriseLeadAgentTask, EnterpriseLeadWorkspace } from '../../shared/enterpriseLeadWorkspace/types';
import { getEnterpriseLeadAgentMetadata } from './workflow';

const stringifyJson = (value: unknown): string => JSON.stringify(value, null, 2);

export function buildWorkspaceExtractionPrompt(input: {
  sourceText: string;
  sourceLabel: string;
}): string {
  return [
    '你是企业获客工作空间资料提取助手。',
    '请从用户资料中提取工作空间草稿。不要编造没有出现的事实。',
    '必须返回 JSON 对象，字段包括 name 和 profile。',
    'profile 字段包括 companySummary, productList, productCapabilities, targetCustomers, applicationScenarios, sellingPoints, channelPreferences, prohibitedClaims, contactRules, missingInfo。',
    `资料来源：${input.sourceLabel}`,
    `资料内容：\n${input.sourceText}`,
  ].join('\n\n');
}

export function buildAgentTaskPrompt(input: {
  workspace: EnterpriseLeadWorkspace;
  task: EnterpriseLeadAgentTask;
  upstreamTasks: EnterpriseLeadAgentTask[];
}): string {
  const metadata = getEnterpriseLeadAgentMetadata(input.task.role as EnterpriseLeadAgentRole);
  return [
    `你是${metadata.title}。`,
    metadata.description,
    '你在一个企业获客工作空间中工作。请只生成结构化 JSON，不要执行任何外部动作。',
    '所有发布、评论、私信、邮件都只能输出草稿、待办或审批项。',
    '不得编造客户、联系方式、来源、认证、价格、交期、承重、案例、降本比例。',
    '返回 JSON 对象，字段必须包括 role, summary, outputs, missingInfo, todos, risks, handoffContext, status。',
    `工作空间资料 JSON:\n${stringifyJson(input.workspace.profile)}`,
    `当前任务输入 JSON:\n${stringifyJson(input.task.inputPayload)}`,
    `上游任务结果 JSON:\n${stringifyJson(input.upstreamTasks.map(task => ({
      role: task.role,
      summary: task.summary,
      outputs: task.outputPayload,
      handoffContext: task.handoffContext,
    })))}`,
  ].join('\n\n');
}

export function buildAgentChatPrompt(input: {
  workspace: EnterpriseLeadWorkspace;
  task: EnterpriseLeadAgentTask;
  upstreamTasks: EnterpriseLeadAgentTask[];
  userMessage: string;
}): string {
  return [
    buildAgentTaskPrompt(input),
    '用户正在单独调整这个 Agent 的结果。请生成一个待应用版本，不要直接覆盖原结果。',
    `用户补充要求：\n${input.userMessage}`,
  ].join('\n\n');
}
```

- [ ] **Step 5: Implement the service**

Create `src/main/enterpriseLeadWorkspace/service.ts`:

```ts
import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadDeliverableKind,
  EnterpriseLeadTodoKind,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadAgentTaskResult,
  EnterpriseLeadDeliverable,
  EnterpriseLeadPendingVersion,
  EnterpriseLeadTodo,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../shared/enterpriseLeadWorkspace/types';
import {
  normalizeAgentTaskResultInput,
  normalizeWorkspaceDraftInput,
} from '../../shared/enterpriseLeadWorkspace/validation';
import type { ModelClientAdapter } from '../industryPack/modelClientAdapter';
import { parseModelJsonObject } from './modelJson';
import { buildAgentChatPrompt, buildAgentTaskPrompt, buildWorkspaceExtractionPrompt } from './promptTemplates';
import type { EnterpriseLeadWorkspaceStore } from './store';
import { ENTERPRISE_LEAD_AGENT_WORKFLOW } from './workflow';

interface EnterpriseLeadWorkspaceServiceOptions {
  store: EnterpriseLeadWorkspaceStore;
  modelClient: ModelClientAdapter;
}

export class EnterpriseLeadWorkspaceService {
  constructor(private readonly options: EnterpriseLeadWorkspaceServiceOptions) {}

  listWorkspaces(): EnterpriseLeadWorkspace[] {
    return this.options.store.listWorkspaces();
  }

  getWorkspace(id: string): EnterpriseLeadWorkspace | null {
    return this.options.store.getWorkspace(id);
  }

  async extractDraftFromConversation(sourceText: string): Promise<EnterpriseLeadWorkspaceDraft> {
    const prompt = buildWorkspaceExtractionPrompt({
      sourceText,
      sourceLabel: '对话输入',
    });
    const result = await this.options.modelClient.generate({ prompt });
    return normalizeWorkspaceDraftInput({
      ...parseModelJsonObject(result.text),
      source: {
        kind: 'conversation',
        label: '对话输入',
        text: sourceText,
      },
    });
  }

  createWorkspace(draft: EnterpriseLeadWorkspaceDraft): EnterpriseLeadWorkspace {
    const normalized = normalizeWorkspaceDraftInput(draft);
    return this.options.store.createWorkspace({
      name: normalized.name,
      profile: normalized.profile,
      source: normalized.source,
      enabledAgentRoles: ENTERPRISE_LEAD_AGENT_WORKFLOW.map(item => item.role),
    });
  }

  createRun(workspaceId: string, userGoal: string): EnterpriseLeadWorkspaceSnapshot {
    const run = this.options.store.createRun({
      workspaceId,
      userGoal,
      agentRoles: ENTERPRISE_LEAD_AGENT_WORKFLOW.map(item => item.role),
    });
    return this.getSnapshot(workspaceId, run.id);
  }

  async runTask(taskId: string): Promise<EnterpriseLeadAgentTask> {
    const task = this.options.store.getTask(taskId);
    if (!task) throw new Error('Enterprise lead Agent task not found');
    const tasks = this.options.store.listTasks(task.runId);
    const upstreamTasks = tasks.slice(0, tasks.findIndex(item => item.id === task.id));
    const workspaceId = String(task.inputPayload.workspaceId ?? '');
    const workspace = workspaceId
      ? this.options.store.getWorkspace(workspaceId)
      : this.findWorkspaceFromTaskInput(task);
    if (!workspace) throw new Error('Enterprise lead workspace not found for task');

    const prompt = buildAgentTaskPrompt({ workspace, task, upstreamTasks });
    const modelResult = await this.options.modelClient.generate({ prompt });
    const result = normalizeAgentTaskResultInput({
      ...parseModelJsonObject(modelResult.text),
      role: task.role,
    }) as EnterpriseLeadAgentTaskResult;

    this.options.store.updateTaskResult(task.id, result);
    const updated = this.options.store.getTask(task.id);
    if (!updated) throw new Error('Enterprise lead Agent task disappeared after update');
    return updated;
  }

  async createPendingVersionFromChat(
    taskId: string,
    userMessage: string,
  ): Promise<EnterpriseLeadPendingVersion> {
    const task = this.options.store.getTask(taskId);
    if (!task) throw new Error('Enterprise lead Agent task not found');
    const workspace = this.findWorkspaceFromTaskInput(task);
    if (!workspace) throw new Error('Enterprise lead workspace not found for pending version');
    const tasks = this.options.store.listTasks(task.runId);
    const upstreamTasks = tasks.slice(0, tasks.findIndex(item => item.id === task.id));
    const prompt = buildAgentChatPrompt({ workspace, task, upstreamTasks, userMessage });
    const modelResult = await this.options.modelClient.generate({ prompt });
    const result = normalizeAgentTaskResultInput({
      ...parseModelJsonObject(modelResult.text),
      role: task.role,
    }) as EnterpriseLeadAgentTaskResult;

    return this.options.store.createPendingVersion({
      workspaceId: workspace.id,
      taskId: task.id,
      runId: task.runId,
      role: task.role,
      userMessage,
      result,
    });
  }

  applyPendingVersion(pendingVersionId: string): EnterpriseLeadWorkspaceSnapshot {
    this.options.store.applyPendingVersion(pendingVersionId);
    const workspaces = this.options.store.listWorkspaces();
    const workspace = workspaces.find(item => item.recentRunId && this.options.store.listPendingVersions(item.recentRunId).some(version => version.id === pendingVersionId));
    if (!workspace?.recentRunId) throw new Error('Enterprise lead workspace not found after applying pending version');
    return this.getSnapshot(workspace.id, workspace.recentRunId);
  }

  getSnapshot(workspaceId: string, runId?: string): EnterpriseLeadWorkspaceSnapshot {
    const workspace = this.options.store.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Enterprise lead workspace not found');
    const currentRunId = runId ?? workspace.recentRunId;
    const currentRun = currentRunId ? this.options.store.getRun(currentRunId) : null;
    const tasks = currentRunId ? this.options.store.listTasks(currentRunId) : [];
    return {
      workspace,
      currentRun,
      tasks,
      pendingVersions: currentRunId ? this.options.store.listPendingVersions(currentRunId) : [],
      deliverables: currentRunId ? this.buildDeliverables(workspace.id, currentRunId, tasks) : [],
      todos: currentRunId ? this.buildTodos(workspace.id, currentRunId, tasks) : [],
      archives: [],
    };
  }

  private findWorkspaceFromTaskInput(task: EnterpriseLeadAgentTask): EnterpriseLeadWorkspace | null {
    const workspaces = this.options.store.listWorkspaces();
    return workspaces.find(workspace => workspace.recentRunId === task.runId) ?? null;
  }

  private buildDeliverables(
    workspaceId: string,
    runId: string,
    tasks: EnterpriseLeadAgentTask[],
  ): EnterpriseLeadDeliverable[] {
    return tasks
      .filter(task => task.summary)
      .map(task => ({
        id: `${task.id}:deliverable`,
        runId,
        workspaceId,
        kind: EnterpriseLeadDeliverableKind.FinalSummary,
        role: task.role,
        title: `${task.role} 输出`,
        summary: task.summary,
        payload: task.outputPayload,
        status: 'draft',
        createdAt: task.updatedAt,
        updatedAt: task.updatedAt,
      }));
  }

  private buildTodos(
    workspaceId: string,
    runId: string,
    tasks: EnterpriseLeadAgentTask[],
  ): EnterpriseLeadTodo[] {
    return tasks.flatMap(task => task.todos.map((todo, index) => ({
      id: `${task.id}:todo:${index}`,
      runId,
      workspaceId,
      kind: todo.kind || EnterpriseLeadTodoKind.MissingInfo,
      title: todo.title,
      description: todo.description,
      role: task.role,
      status: 'open',
      createdAt: task.updatedAt,
      updatedAt: task.updatedAt,
    })));
  }
}
```

- [ ] **Step 6: Run tests and lint**

Run:

```bash
npm test -- src/main/enterpriseLeadWorkspace/service.test.ts src/main/enterpriseLeadWorkspace/store.test.ts src/main/enterpriseLeadWorkspace/workflow.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/enterpriseLeadWorkspace/modelJson.ts src/main/enterpriseLeadWorkspace/promptTemplates.ts src/main/enterpriseLeadWorkspace/service.ts src/main/enterpriseLeadWorkspace/service.test.ts
```

Expected: tests and lint pass. `getSnapshot` returns the real current run, pending versions, derived deliverables, and derived todos.

## Task 5: IPC, Preload, And Renderer Service

**Files:**

- Create: `src/main/enterpriseLeadWorkspace/ipcHandlers.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Create: `src/renderer/services/enterpriseLeadWorkspace.ts`

- [ ] **Step 1: Keep IPC handlers thin and covered through service tests**

The repository does not currently unit-test every IPC registration. Keep this task focused by covering business behavior in service tests and keeping IPC handlers as validation-and-delegation wrappers.

- [ ] **Step 2: Create IPC handlers**

Create `src/main/enterpriseLeadWorkspace/ipcHandlers.ts`:

```ts
import { ipcMain } from 'electron';

import { EnterpriseLeadWorkspaceIpc } from '../../shared/enterpriseLeadWorkspace/constants';
import type { EnterpriseLeadWorkspaceDraft } from '../../shared/enterpriseLeadWorkspace/types';
import type { EnterpriseLeadWorkspaceService } from './service';

export interface EnterpriseLeadWorkspaceHandlerDeps {
  service: Pick<
    EnterpriseLeadWorkspaceService,
    | 'listWorkspaces'
    | 'getWorkspace'
    | 'extractDraftFromConversation'
    | 'createWorkspace'
    | 'createRun'
    | 'getSnapshot'
    | 'runTask'
    | 'createPendingVersionFromChat'
    | 'applyPendingVersion'
  >;
}

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown enterprise lead workspace error';

export function registerEnterpriseLeadWorkspaceHandlers(
  deps: EnterpriseLeadWorkspaceHandlerDeps,
): void {
  ipcMain.handle(EnterpriseLeadWorkspaceIpc.ListWorkspaces, async () => {
    try {
      return { success: true, data: deps.service.listWorkspaces() };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle(EnterpriseLeadWorkspaceIpc.GetWorkspace, async (_event, id: string) => {
    try {
      return { success: true, data: deps.service.getWorkspace(id) };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle(EnterpriseLeadWorkspaceIpc.ExtractDraft, async (_event, input: { text?: unknown }) => {
    try {
      const text = typeof input?.text === 'string' ? input.text : '';
      if (!text.trim()) throw new Error('Workspace extraction text is required');
      return { success: true, data: await deps.service.extractDraftFromConversation(text) };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle(EnterpriseLeadWorkspaceIpc.CreateWorkspace, async (_event, draft: EnterpriseLeadWorkspaceDraft) => {
    try {
      return { success: true, data: deps.service.createWorkspace(draft) };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle(EnterpriseLeadWorkspaceIpc.CreateRun, async (_event, input: { workspaceId?: unknown; userGoal?: unknown }) => {
    try {
      if (typeof input?.workspaceId !== 'string' || !input.workspaceId.trim()) {
        throw new Error('Workspace id is required');
      }
      if (typeof input?.userGoal !== 'string' || !input.userGoal.trim()) {
        throw new Error('Run goal is required');
      }
      return {
        success: true,
        data: deps.service.createRun(input.workspaceId, input.userGoal),
      };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle(EnterpriseLeadWorkspaceIpc.GetRun, async (_event, input: { workspaceId?: unknown; runId?: unknown }) => {
    try {
      if (typeof input?.workspaceId !== 'string' || !input.workspaceId.trim()) {
        throw new Error('Workspace id is required');
      }
      return {
        success: true,
        data: deps.service.getSnapshot(
          input.workspaceId,
          typeof input.runId === 'string' ? input.runId : undefined,
        ),
      };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle(EnterpriseLeadWorkspaceIpc.RunTask, async (_event, taskId: string) => {
    try {
      if (!taskId?.trim()) throw new Error('Task id is required');
      return { success: true, data: await deps.service.runTask(taskId) };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle(EnterpriseLeadWorkspaceIpc.CreatePendingVersion, async (_event, input: { taskId?: unknown; message?: unknown }) => {
    try {
      if (typeof input?.taskId !== 'string' || !input.taskId.trim()) {
        throw new Error('Task id is required');
      }
      if (typeof input?.message !== 'string' || !input.message.trim()) {
        throw new Error('Agent chat message is required');
      }
      return {
        success: true,
        data: await deps.service.createPendingVersionFromChat(input.taskId, input.message),
      };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle(EnterpriseLeadWorkspaceIpc.ApplyPendingVersion, async (_event, pendingVersionId: string) => {
    try {
      if (!pendingVersionId?.trim()) throw new Error('Pending version id is required');
      return { success: true, data: deps.service.applyPendingVersion(pendingVersionId) };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });
}
```

- [ ] **Step 3: Register main-process service**

Modify `src/main/main.ts`:

```ts
import { EnterpriseLeadWorkspaceService } from './enterpriseLeadWorkspace/service';
import { EnterpriseLeadWorkspaceStore } from './enterpriseLeadWorkspace/store';
import { registerEnterpriseLeadWorkspaceHandlers } from './enterpriseLeadWorkspace/ipcHandlers';
```

Add singleton fields beside `industryPackStore`:

```ts
let enterpriseLeadWorkspaceStore: EnterpriseLeadWorkspaceStore | null = null;
let enterpriseLeadWorkspaceService: EnterpriseLeadWorkspaceService | null = null;
```

Add getters near industry pack getters:

```ts
const getEnterpriseLeadWorkspaceStore = (): EnterpriseLeadWorkspaceStore => {
  if (!enterpriseLeadWorkspaceStore) {
    enterpriseLeadWorkspaceStore = new EnterpriseLeadWorkspaceStore(getStore().getDatabase());
  }
  return enterpriseLeadWorkspaceStore;
};

const getEnterpriseLeadWorkspaceService = (): EnterpriseLeadWorkspaceService => {
  if (!enterpriseLeadWorkspaceService) {
    enterpriseLeadWorkspaceService = new EnterpriseLeadWorkspaceService({
      store: getEnterpriseLeadWorkspaceStore(),
      modelClient: createConfiguredIndustryModelClient(),
    });
  }
  return enterpriseLeadWorkspaceService;
};
```

Register handlers near `registerIndustryPackHandlers`:

```ts
registerEnterpriseLeadWorkspaceHandlers({
  service: {
    listWorkspaces: () => getEnterpriseLeadWorkspaceService().listWorkspaces(),
    getWorkspace: id => getEnterpriseLeadWorkspaceService().getWorkspace(id),
    extractDraftFromConversation: text =>
      getEnterpriseLeadWorkspaceService().extractDraftFromConversation(text),
    createWorkspace: draft => getEnterpriseLeadWorkspaceService().createWorkspace(draft),
    createRun: (workspaceId, userGoal) =>
      getEnterpriseLeadWorkspaceService().createRun(workspaceId, userGoal),
    getSnapshot: (workspaceId, runId) =>
      getEnterpriseLeadWorkspaceService().getSnapshot(workspaceId, runId),
    runTask: taskId => getEnterpriseLeadWorkspaceService().runTask(taskId),
    createPendingVersionFromChat: (taskId, message) =>
      getEnterpriseLeadWorkspaceService().createPendingVersionFromChat(taskId, message),
    applyPendingVersion: pendingVersionId =>
      getEnterpriseLeadWorkspaceService().applyPendingVersion(pendingVersionId),
  },
});
```

- [ ] **Step 4: Expose preload API**

Modify `src/main/preload.ts`:

```ts
import { EnterpriseLeadWorkspaceIpc } from '../shared/enterpriseLeadWorkspace/constants';
import type { EnterpriseLeadWorkspaceDraft } from '../shared/enterpriseLeadWorkspace/types';
```

Inside `contextBridge.exposeInMainWorld('electron', { ... })`, add:

```ts
enterpriseLeadWorkspace: {
  listWorkspaces: () => ipcRenderer.invoke(EnterpriseLeadWorkspaceIpc.ListWorkspaces),
  getWorkspace: (id: string) =>
    ipcRenderer.invoke(EnterpriseLeadWorkspaceIpc.GetWorkspace, id),
  extractDraft: (text: string) =>
    ipcRenderer.invoke(EnterpriseLeadWorkspaceIpc.ExtractDraft, { text }),
  createWorkspace: (draft: EnterpriseLeadWorkspaceDraft) =>
    ipcRenderer.invoke(EnterpriseLeadWorkspaceIpc.CreateWorkspace, draft),
  createRun: (workspaceId: string, userGoal: string) =>
    ipcRenderer.invoke(EnterpriseLeadWorkspaceIpc.CreateRun, { workspaceId, userGoal }),
  getRun: (workspaceId: string, runId?: string) =>
    ipcRenderer.invoke(EnterpriseLeadWorkspaceIpc.GetRun, { workspaceId, runId }),
  runTask: (taskId: string) =>
    ipcRenderer.invoke(EnterpriseLeadWorkspaceIpc.RunTask, taskId),
  createPendingVersion: (taskId: string, message: string) =>
    ipcRenderer.invoke(EnterpriseLeadWorkspaceIpc.CreatePendingVersion, { taskId, message }),
  applyPendingVersion: (pendingVersionId: string) =>
    ipcRenderer.invoke(EnterpriseLeadWorkspaceIpc.ApplyPendingVersion, pendingVersionId),
},
```

- [ ] **Step 5: Add renderer type declarations**

Modify `src/renderer/types/electron.d.ts` imports:

```ts
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadIpcResult,
  EnterpriseLeadPendingVersion,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../shared/enterpriseLeadWorkspace/types';
```

Add to the `window.electron` interface:

```ts
enterpriseLeadWorkspace: {
  listWorkspaces: () => Promise<EnterpriseLeadIpcResult<EnterpriseLeadWorkspace[]>>;
  getWorkspace: (id: string) => Promise<EnterpriseLeadIpcResult<EnterpriseLeadWorkspace | null>>;
  extractDraft: (text: string) => Promise<EnterpriseLeadIpcResult<EnterpriseLeadWorkspaceDraft>>;
  createWorkspace: (
    draft: EnterpriseLeadWorkspaceDraft,
  ) => Promise<EnterpriseLeadIpcResult<EnterpriseLeadWorkspace>>;
  createRun: (
    workspaceId: string,
    userGoal: string,
  ) => Promise<EnterpriseLeadIpcResult<EnterpriseLeadWorkspaceSnapshot>>;
  getRun: (
    workspaceId: string,
    runId?: string,
  ) => Promise<EnterpriseLeadIpcResult<EnterpriseLeadWorkspaceSnapshot>>;
  runTask: (taskId: string) => Promise<EnterpriseLeadIpcResult<EnterpriseLeadAgentTask>>;
  createPendingVersion: (
    taskId: string,
    message: string,
  ) => Promise<EnterpriseLeadIpcResult<EnterpriseLeadPendingVersion>>;
  applyPendingVersion: (
    pendingVersionId: string,
  ) => Promise<EnterpriseLeadIpcResult<EnterpriseLeadWorkspaceSnapshot>>;
};
```

- [ ] **Step 6: Add renderer service**

Create `src/renderer/services/enterpriseLeadWorkspace.ts`:

```ts
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadPendingVersion,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../shared/enterpriseLeadWorkspace/types';

const unwrap = <T>(result: { success: boolean; data?: T; error?: string }, fallback: T): T => {
  if (result.success && result.data !== undefined) return result.data;
  if (result.error) console.error('[EnterpriseLeadWorkspace]', result.error);
  return fallback;
};

class EnterpriseLeadWorkspaceRendererService {
  async listWorkspaces(): Promise<EnterpriseLeadWorkspace[]> {
    return unwrap(await window.electron.enterpriseLeadWorkspace.listWorkspaces(), []);
  }

  async extractDraft(text: string): Promise<EnterpriseLeadWorkspaceDraft | null> {
    return unwrap(await window.electron.enterpriseLeadWorkspace.extractDraft(text), null);
  }

  async createWorkspace(draft: EnterpriseLeadWorkspaceDraft): Promise<EnterpriseLeadWorkspace | null> {
    return unwrap(await window.electron.enterpriseLeadWorkspace.createWorkspace(draft), null);
  }

  async createRun(workspaceId: string, userGoal: string): Promise<EnterpriseLeadWorkspaceSnapshot | null> {
    return unwrap(await window.electron.enterpriseLeadWorkspace.createRun(workspaceId, userGoal), null);
  }

  async getRun(workspaceId: string, runId?: string): Promise<EnterpriseLeadWorkspaceSnapshot | null> {
    return unwrap(await window.electron.enterpriseLeadWorkspace.getRun(workspaceId, runId), null);
  }

  async runTask(taskId: string): Promise<EnterpriseLeadAgentTask | null> {
    return unwrap(await window.electron.enterpriseLeadWorkspace.runTask(taskId), null);
  }

  async createPendingVersion(taskId: string, message: string): Promise<EnterpriseLeadPendingVersion | null> {
    return unwrap(await window.electron.enterpriseLeadWorkspace.createPendingVersion(taskId, message), null);
  }

  async applyPendingVersion(pendingVersionId: string): Promise<EnterpriseLeadWorkspaceSnapshot | null> {
    return unwrap(await window.electron.enterpriseLeadWorkspace.applyPendingVersion(pendingVersionId), null);
  }
}

export const enterpriseLeadWorkspaceService = new EnterpriseLeadWorkspaceRendererService();
```

- [ ] **Step 7: Run tests, compile check, and lint touched files**

Run:

```bash
npm test -- src/shared/enterpriseLeadWorkspace/validation.test.ts src/main/enterpriseLeadWorkspace/store.test.ts src/main/enterpriseLeadWorkspace/workflow.test.ts src/main/enterpriseLeadWorkspace/service.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/enterpriseLeadWorkspace/ipcHandlers.ts src/main/main.ts src/main/preload.ts src/renderer/types/electron.d.ts src/renderer/services/enterpriseLeadWorkspace.ts
```

Expected: all new enterprise lead workspace files, preload changes, type declarations, and renderer service pass lint. For `main.ts`, capture unrelated pre-existing lint output separately and continue only after confirming the new registration code is not the source of the warning or error.

## Task 6: Renderer Workspace Launch And Creation UI

**Files:**

- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceLaunch.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/index.ts`
- Create: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
- Create: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

- [ ] **Step 1: Write pure UI helper tests**

Create `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import {
  getLaunchMode,
  getWorkspaceCompletionPercent,
  summarizeWorkspaceDraft,
} from './enterpriseLeadWorkspaceUi';

describe('enterprise lead workspace UI helpers', () => {
  test('shows create mode when there are no workspaces', () => {
    expect(getLaunchMode([])).toBe('first_launch');
  });

  test('shows recent mode when workspaces exist', () => {
    expect(getLaunchMode([{ id: 'workspace-1' }])).toBe('returning');
  });

  test('summarizes extracted workspace draft', () => {
    expect(summarizeWorkspaceDraft({
      name: '重型包装获客',
      profile: {
        companySummary: '东莞工厂',
        productList: ['重型纸箱'],
        productCapabilities: [],
        targetCustomers: ['汽配'],
        applicationScenarios: [],
        sellingPoints: ['防破损'],
        channelPreferences: ['朋友圈'],
        prohibitedClaims: ['不能编造承重'],
        contactRules: [],
        missingInfo: ['真实案例'],
      },
      type: 'enterprise_lead',
      source: { kind: 'conversation', label: '用户描述' },
      enabledAgentRoles: [],
    })).toContain('重型纸箱');
  });

  test('computes profile completion from populated profile groups', () => {
    expect(getWorkspaceCompletionPercent({
      companySummary: '东莞工厂',
      productList: ['重型纸箱'],
      productCapabilities: [],
      targetCustomers: ['汽配'],
      applicationScenarios: [],
      sellingPoints: ['防破损'],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
    })).toBe(50);
  });
});
```

- [ ] **Step 2: Implement UI helpers**

Create `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`:

```ts
import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceProfile,
} from '../../../shared/enterpriseLeadWorkspace/types';

export type EnterpriseLeadLaunchMode = 'first_launch' | 'returning';

export function getLaunchMode(workspaces: Array<Pick<EnterpriseLeadWorkspace, 'id'>>): EnterpriseLeadLaunchMode {
  return workspaces.length === 0 ? 'first_launch' : 'returning';
}

export function summarizeWorkspaceDraft(draft: EnterpriseLeadWorkspaceDraft): string {
  const productText = draft.profile.productList.join('、') || '产品资料待补充';
  const customerText = draft.profile.targetCustomers.join('、') || '客户方向待补充';
  return `${draft.name}：${productText}，目标客户：${customerText}`;
}

export function getWorkspaceCompletionPercent(profile: EnterpriseLeadWorkspaceProfile): number {
  const checks = [
    profile.companySummary.trim().length > 0,
    profile.productList.length > 0,
    profile.targetCustomers.length > 0,
    profile.sellingPoints.length > 0,
    profile.channelPreferences.length > 0,
    profile.prohibitedClaims.length > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
```

- [ ] **Step 3: Create launch component**

Create `src/renderer/components/enterpriseLeadWorkspace/WorkspaceLaunch.tsx`:

```tsx
import React from 'react';

import type { EnterpriseLeadWorkspace } from '../../../shared/enterpriseLeadWorkspace/types';
import { i18nService } from '../../services/i18n';

interface WorkspaceLaunchProps {
  workspaces: EnterpriseLeadWorkspace[];
  onCreate: () => void;
  onOpen: (workspaceId: string) => void;
}

const WorkspaceLaunch: React.FC<WorkspaceLaunchProps> = ({ workspaces, onCreate, onOpen }) => {
  const isFirstLaunch = workspaces.length === 0;
  const recent = workspaces[0];

  if (isFirstLaunch) {
    return (
      <div className="flex min-h-full items-center justify-center bg-background p-8">
        <div className="w-full max-w-3xl rounded-2xl border border-border bg-surface p-10 shadow-sm">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-semibold text-foreground">
              {i18nService.t('enterpriseLeadWorkspaceTitle')}
            </h1>
            <p className="mt-3 text-sm text-secondary">
              {i18nService.t('enterpriseLeadWorkspaceSubtitle')}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <button
              type="button"
              onClick={onCreate}
              className="rounded-2xl border-2 border-primary bg-primary/5 p-6 text-left transition-colors hover:bg-primary/10"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-xl font-semibold text-white">+</div>
              <div className="text-base font-semibold text-foreground">
                {i18nService.t('enterpriseLeadCreateWorkspace')}
              </div>
              <div className="mt-2 text-sm text-secondary">
                {i18nService.t('enterpriseLeadCreateWorkspaceDesc')}
              </div>
            </button>
            <button
              type="button"
              onClick={onCreate}
              className="rounded-2xl border border-border bg-surface-raised p-6 text-left transition-colors hover:bg-surface"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-background text-lg text-foreground">↗</div>
              <div className="text-base font-semibold text-foreground">
                {i18nService.t('enterpriseLeadImportMaterial')}
              </div>
              <div className="mt-2 text-sm text-secondary">
                {i18nService.t('enterpriseLeadImportMaterialDesc')}
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-background p-8">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              {i18nService.t('enterpriseLeadRecentWorkspaces')}
            </h1>
            <p className="mt-2 text-sm text-secondary">
              {i18nService.t('enterpriseLeadRecentWorkspacesDesc')}
            </p>
          </div>
          <button
            type="button"
            onClick={onCreate}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
          >
            {i18nService.t('enterpriseLeadCreateWorkspace')}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {recent && (
            <button
              type="button"
              onClick={() => onOpen(recent.id)}
              className="rounded-2xl border-2 border-primary bg-primary/5 p-5 text-left"
            >
              <div className="text-xs font-medium uppercase text-primary">
                {i18nService.t('enterpriseLeadRecentlyOpened')}
              </div>
              <div className="mt-3 text-base font-semibold text-foreground">{recent.name}</div>
              <div className="mt-2 text-sm text-secondary">
                {recent.profile.companySummary || i18nService.t('enterpriseLeadProfileIncomplete')}
              </div>
            </button>
          )}
          {workspaces.slice(1, 3).map(workspace => (
            <button
              type="button"
              key={workspace.id}
              onClick={() => onOpen(workspace.id)}
              className="rounded-2xl border border-border bg-surface p-5 text-left hover:bg-surface-raised"
            >
              <div className="text-base font-semibold text-foreground">{workspace.name}</div>
              <div className="mt-2 text-sm text-secondary">
                {workspace.profile.companySummary || i18nService.t('enterpriseLeadProfileIncomplete')}
              </div>
            </button>
          ))}
          <button
            type="button"
            onClick={onCreate}
            className="rounded-2xl border border-dashed border-border bg-surface p-5 text-left hover:bg-surface-raised"
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-background text-lg text-primary">+</div>
            <div className="text-base font-semibold text-foreground">
              {i18nService.t('enterpriseLeadCreateNewWorkspace')}
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkspaceLaunch;
```

- [ ] **Step 4: Create workspace creation component**

Create `src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx`:

```tsx
import React, { useState } from 'react';

import type { EnterpriseLeadWorkspaceDraft } from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import { summarizeWorkspaceDraft } from './enterpriseLeadWorkspaceUi';

interface WorkspaceCreateProps {
  onCancel: () => void;
  onCreated: (workspaceId: string) => void;
}

const splitText = (value: string[]): string => value.length > 0 ? value.join('、') : i18nService.t('enterpriseLeadEmptyField');

const readFileText = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
  reader.onerror = () => reject(reader.error ?? new Error('Failed to read workspace source file'));
  reader.readAsText(file);
});

const WorkspaceCreate: React.FC<WorkspaceCreateProps> = ({ onCancel, onCreated }) => {
  const [sourceText, setSourceText] = useState('');
  const [draft, setDraft] = useState<EnterpriseLeadWorkspaceDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleExtract = async () => {
    if (!sourceText.trim()) return;
    setLoading(true);
    setError('');
    try {
      const nextDraft = await enterpriseLeadWorkspaceService.extractDraft(sourceText);
      setDraft(nextDraft);
    } catch (extractError) {
      setError(extractError instanceof Error ? extractError.message : i18nService.t('enterpriseLeadExtractFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      setSourceText(await readFileText(file));
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : i18nService.t('enterpriseLeadReadFileFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!draft) return;
    setLoading(true);
    setError('');
    try {
      const workspace = await enterpriseLeadWorkspaceService.createWorkspace(draft);
      if (workspace) onCreated(workspace.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : i18nService.t('enterpriseLeadCreateFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid h-full grid-cols-[minmax(360px,480px)_1fr] bg-background">
      <section className="border-r border-border bg-surface p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{i18nService.t('enterpriseLeadCreateWorkspace')}</h1>
            <p className="mt-1 text-sm text-secondary">{i18nService.t('enterpriseLeadCreateByExtraction')}</p>
          </div>
          <button type="button" onClick={onCancel} className="rounded-lg bg-surface-raised px-3 py-2 text-sm text-foreground">
            {i18nService.t('cancel')}
          </button>
        </div>
        <label className="block rounded-xl border border-dashed border-border bg-background p-4 text-sm text-secondary">
          <span className="font-medium text-foreground">{i18nService.t('enterpriseLeadUploadMaterial')}</span>
          <input
            type="file"
            accept=".txt,.md,.csv"
            className="mt-3 block w-full text-xs"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </label>
        <textarea
          value={sourceText}
          onChange={(event) => setSourceText(event.target.value)}
          className="mt-4 h-72 w-full resize-none rounded-xl border border-border bg-background p-3 text-sm text-foreground"
          aria-label={i18nService.t('enterpriseLeadConversationMaterial')}
        />
        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        <button
          type="button"
          onClick={handleExtract}
          disabled={loading || !sourceText.trim()}
          className="mt-4 w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? i18nService.t('enterpriseLeadExtracting') : i18nService.t('enterpriseLeadExtractWorkspace')}
        </button>
      </section>
      <section className="overflow-y-auto p-8">
        {!draft ? (
          <div className="flex h-full items-center justify-center text-sm text-secondary">
            {i18nService.t('enterpriseLeadDraftEmpty')}
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">
            <div className="mb-5">
              <h2 className="text-2xl font-semibold text-foreground">{draft.name}</h2>
              <p className="mt-2 text-sm text-secondary">{summarizeWorkspaceDraft(draft)}</p>
            </div>
            <div className="grid gap-3">
              {[
                [i18nService.t('enterpriseLeadCompanySummary'), draft.profile.companySummary || i18nService.t('enterpriseLeadEmptyField')],
                [i18nService.t('enterpriseLeadProducts'), splitText(draft.profile.productList)],
                [i18nService.t('enterpriseLeadTargetCustomers'), splitText(draft.profile.targetCustomers)],
                [i18nService.t('enterpriseLeadChannels'), splitText(draft.profile.channelPreferences)],
                [i18nService.t('enterpriseLeadSellingPoints'), splitText(draft.profile.sellingPoints)],
                [i18nService.t('enterpriseLeadProhibitedClaims'), splitText(draft.profile.prohibitedClaims)],
                [i18nService.t('enterpriseLeadMissingInfo'), splitText(draft.profile.missingInfo)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-border bg-surface p-4">
                  <div className="text-xs font-medium text-secondary">{label}</div>
                  <div className="mt-2 text-sm text-foreground">{value}</div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setDraft(null)} className="rounded-xl bg-surface-raised px-4 py-2 text-sm text-foreground">
                {i18nService.t('enterpriseLeadReextract')}
              </button>
              <button type="button" onClick={handleCreate} disabled={loading} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {i18nService.t('enterpriseLeadConfirmCreate')}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

export default WorkspaceCreate;
```

- [ ] **Step 5: Create feature root and barrel export**

Create `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`:

```tsx
import React, { useEffect, useState } from 'react';

import type { EnterpriseLeadWorkspace } from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import AgentWorkspaceConsole from './AgentWorkspaceConsole';
import WorkspaceCreate from './WorkspaceCreate';
import WorkspaceLaunch from './WorkspaceLaunch';

type ViewMode = 'loading' | 'launch' | 'create' | 'workspace';

const EnterpriseLeadWorkspaceView: React.FC = () => {
  const [mode, setMode] = useState<ViewMode>('loading');
  const [workspaces, setWorkspaces] = useState<EnterpriseLeadWorkspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    enterpriseLeadWorkspaceService.listWorkspaces().then(items => {
      if (!mounted) return;
      setWorkspaces(items);
      if (items.length > 0) {
        setWorkspaceId(items[0].id);
        setMode('workspace');
      } else {
        setMode('launch');
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (mode === 'loading') {
    return <div className="flex h-full items-center justify-center text-secondary">Loading...</div>;
  }

  if (mode === 'create') {
    return (
      <WorkspaceCreate
        onCancel={() => setMode(workspaces.length > 0 ? 'workspace' : 'launch')}
        onCreated={(id) => {
          setWorkspaceId(id);
          setMode('workspace');
        }}
      />
    );
  }

  if (mode === 'workspace' && workspaceId) {
    return <AgentWorkspaceConsole workspaceId={workspaceId} onCreateWorkspace={() => setMode('create')} />;
  }

  return (
    <WorkspaceLaunch
      workspaces={workspaces}
      onCreate={() => setMode('create')}
      onOpen={(id) => {
        setWorkspaceId(id);
        setMode('workspace');
      }}
    />
  );
};

export default EnterpriseLeadWorkspaceView;
```

Create `src/renderer/components/enterpriseLeadWorkspace/index.ts`:

```ts
export { default as EnterpriseLeadWorkspaceView } from './EnterpriseLeadWorkspaceView';
```

- [ ] **Step 6: Run UI helper tests and lint**

Run:

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceLaunch.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx src/renderer/components/enterpriseLeadWorkspace/index.ts
```

Expected: tests and lint pass for launch, creation, feature root, and helper modules.

## Task 7: Agent Card Console UI

**Files:**

- Create: `src/renderer/components/enterpriseLeadWorkspace/AgentWorkspaceConsole.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/AgentTaskCard.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceSidePanel.tsx`

- [ ] **Step 1: Create Agent task card**

Create `src/renderer/components/enterpriseLeadWorkspace/AgentTaskCard.tsx`:

```tsx
import React from 'react';

import type { EnterpriseLeadAgentTask } from '../../../shared/enterpriseLeadWorkspace/types';
import { getAgentCardTone, getAgentRoleLabel } from './enterpriseLeadWorkspaceUi';

interface AgentTaskCardProps {
  task: EnterpriseLeadAgentTask;
  onRun: (taskId: string) => void;
  onChat: (taskId: string) => void;
}

const AgentTaskCard: React.FC<AgentTaskCardProps> = ({ task, onRun, onChat }) => {
  const label = getAgentRoleLabel(task.role);
  const tone = getAgentCardTone(task.status);

  return (
    <div className={`rounded-xl border p-4 ${tone.className}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background text-sm font-semibold text-foreground">
          {label.shortLabel}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="truncate text-sm font-semibold text-foreground">{label.title}</h3>
            <span className="text-xs font-medium text-secondary">{task.status}</span>
          </div>
          <p className="mt-1 text-xs text-secondary">{label.description}</p>
        </div>
      </div>

      <div className="mt-3 space-y-1 text-xs text-secondary">
        <div><span className="font-medium text-foreground">输入：</span>{label.inputSummary}</div>
        <div><span className="font-medium text-foreground">输出：</span>{task.summary || label.outputSummary}</div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => onChat(task.id)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white">
          对话
        </button>
        <button type="button" onClick={() => onRun(task.id)} className="rounded-lg bg-surface-raised px-3 py-1.5 text-xs font-medium text-foreground">
          {task.summary ? '重跑' : '运行'}
        </button>
      </div>
    </div>
  );
};

export default AgentTaskCard;
```

- [ ] **Step 2: Extend UI helpers for labels and tones**

Modify `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`:

```ts
import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadTaskStatus,
  type EnterpriseLeadAgentRole as EnterpriseLeadAgentRoleValue,
  type EnterpriseLeadTaskStatus as EnterpriseLeadTaskStatusValue,
} from '../../../shared/enterpriseLeadWorkspace/constants';

export function getAgentRoleLabel(role: EnterpriseLeadAgentRoleValue | string) {
  const labels = {
    [EnterpriseLeadAgentRole.Controller]: ['总', '项目总控 Agent', '理解目标、拆解任务、调度专业 Agent。', '用户目标、空间资料', '执行计划、阶段状态'],
    [EnterpriseLeadAgentRole.ProductUnderstanding]: ['产', '产品理解 Agent', '整理产品画像、卖点、客户场景。', '用户目标、产品资料', '产品画像、卖点、缺失信息'],
    [EnterpriseLeadAgentRole.OpportunityRadar]: ['商', '商机雷达 Agent', '判断客户方向、采购信号和优先级。', '产品画像、客户方向', '商机评分、采购信号'],
    [EnterpriseLeadAgentRole.ContentPlanning]: ['内', '内容策划 Agent', '生成内容草稿和高风险表达列表。', '商机判断、渠道偏好', '内容草稿、风险表达'],
    [EnterpriseLeadAgentRole.SocialOperation]: ['媒', '社媒运营 Agent', '生成社媒计划、评论和私信草稿。', '内容草稿、平台规则', '发布计划、互动草稿'],
    [EnterpriseLeadAgentRole.SalesHandoff]: ['销', '销售交接 Agent', '生成销售交接单和 SOP。', '商机评分、客户痛点', '交接单、SOP'],
    [EnterpriseLeadAgentRole.RiskReview]: ['控', '风控审核 Agent', '检查外发风险、夸大宣传和来源缺失。', '全部草稿、来源声明', '风险等级、返工项'],
    [EnterpriseLeadAgentRole.ProjectSummary]: ['归', '项目归纳 Agent', '汇总所有结果并生成最终总结。', '全部 Agent 输出', '最终总结、下一步建议'],
    [EnterpriseLeadAgentRole.ProjectArchive]: ['档', '项目归档 Agent', '保存成果和历史查看入口。', '成果包、风控记录', '归档索引'],
  } as const;
  const item = labels[role as EnterpriseLeadAgentRoleValue] ?? ['?', '未知 Agent', '未知职责', '未知输入', '未知输出'];
  return {
    shortLabel: item[0],
    title: item[1],
    description: item[2],
    inputSummary: item[3],
    outputSummary: item[4],
  };
}

export function getAgentCardTone(status: EnterpriseLeadTaskStatusValue | string): { className: string } {
  if (status === EnterpriseLeadTaskStatus.Completed) return { className: 'border-emerald-200 bg-emerald-50/40' };
  if (status === EnterpriseLeadTaskStatus.NeedsInput || status === EnterpriseLeadTaskStatus.Blocked) return { className: 'border-amber-200 bg-amber-50/60' };
  if (status === EnterpriseLeadTaskStatus.Error) return { className: 'border-red-200 bg-red-50/60' };
  if (status === EnterpriseLeadTaskStatus.Stale) return { className: 'border-blue-200 bg-blue-50/60' };
  return { className: 'border-border bg-surface' };
}
```

- [ ] **Step 3: Create side panel**

Create `src/renderer/components/enterpriseLeadWorkspace/WorkspaceSidePanel.tsx`:

```tsx
import React from 'react';

import type {
  EnterpriseLeadDeliverable,
  EnterpriseLeadPendingVersion,
  EnterpriseLeadTodo,
} from '../../../shared/enterpriseLeadWorkspace/types';

interface WorkspaceSidePanelProps {
  todos: EnterpriseLeadTodo[];
  deliverables: EnterpriseLeadDeliverable[];
  pendingVersions: EnterpriseLeadPendingVersion[];
  onApplyPendingVersion: (pendingVersionId: string) => void;
}

const WorkspaceSidePanel: React.FC<WorkspaceSidePanelProps> = ({
  todos,
  deliverables,
  pendingVersions,
  onApplyPendingVersion,
}) => (
  <aside className="space-y-4">
    <section className="rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">待应用版本</h3>
      <div className="mt-3 space-y-2">
        {pendingVersions.length === 0 ? (
          <div className="text-xs text-secondary">暂无待应用版本</div>
        ) : pendingVersions.map(version => (
          <div key={version.id} className="rounded-lg bg-surface-raised p-3 text-xs text-secondary">
            <div className="font-medium text-foreground">{version.summary}</div>
            <div className="mt-1">{version.userMessage}</div>
            {version.status === 'pending' && (
              <button
                type="button"
                onClick={() => onApplyPendingVersion(version.id)}
                className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white"
              >
                应用版本
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
    <section className="rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">当前需要你处理</h3>
      <div className="mt-3 space-y-2">
        {todos.length === 0 ? (
          <div className="text-xs text-secondary">暂无人工待办</div>
        ) : todos.map(todo => (
          <div key={todo.id} className="rounded-lg bg-surface-raised p-3 text-xs text-secondary">
            <div className="font-medium text-foreground">{todo.title}</div>
            <div className="mt-1">{todo.description}</div>
          </div>
        ))}
      </div>
    </section>
    <section className="rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">成果包</h3>
      <div className="mt-3 space-y-2">
        {deliverables.length === 0 ? (
          <div className="text-xs text-secondary">成果将在 Agent 执行后出现</div>
        ) : deliverables.map(deliverable => (
          <div key={deliverable.id} className="rounded-lg bg-surface-raised p-3 text-xs text-secondary">
            <div className="font-medium text-foreground">{deliverable.title}</div>
            <div className="mt-1">{deliverable.summary}</div>
          </div>
        ))}
      </div>
    </section>
    <section className="rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">安全边界</h3>
      <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-secondary">
        <li>不自动发布</li>
        <li>不自动评论</li>
        <li>不自动私信</li>
        <li>不自动发邮件</li>
        <li>所有外部动作只进入草稿、待办或审批</li>
      </ul>
    </section>
  </aside>
);

export default WorkspaceSidePanel;
```

- [ ] **Step 4: Create console**

Create `src/renderer/components/enterpriseLeadWorkspace/AgentWorkspaceConsole.tsx`:

```tsx
import React, { useEffect, useState } from 'react';

import type { EnterpriseLeadWorkspaceSnapshot } from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import AgentTaskCard from './AgentTaskCard';
import WorkspaceSidePanel from './WorkspaceSidePanel';

interface AgentWorkspaceConsoleProps {
  workspaceId: string;
  onCreateWorkspace: () => void;
}

const AgentWorkspaceConsole: React.FC<AgentWorkspaceConsoleProps> = ({ workspaceId, onCreateWorkspace }) => {
  const [snapshot, setSnapshot] = useState<EnterpriseLeadWorkspaceSnapshot | null>(null);
  const [goal, setGoal] = useState('');
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [chatTaskId, setChatTaskId] = useState<string | null>(null);
  const [chatMessage, setChatMessage] = useState('');
  const [chatSubmitting, setChatSubmitting] = useState(false);

  const refresh = async () => {
    setSnapshot(await enterpriseLeadWorkspaceService.getRun(workspaceId));
  };

  useEffect(() => {
    void refresh();
  }, [workspaceId]);

  const handleCreateRun = async () => {
    if (!goal.trim()) return;
    const next = await enterpriseLeadWorkspaceService.createRun(workspaceId, goal);
    if (next) {
      setSnapshot(next);
      setGoal('');
    }
  };

  const handleRunTask = async (taskId: string) => {
    setRunningTaskId(taskId);
    try {
      await enterpriseLeadWorkspaceService.runTask(taskId);
      await refresh();
    } finally {
      setRunningTaskId(null);
    }
  };

  const handleCreatePendingVersion = async () => {
    if (!chatTaskId || !chatMessage.trim()) return;
    setChatSubmitting(true);
    try {
      await enterpriseLeadWorkspaceService.createPendingVersion(chatTaskId, chatMessage);
      setChatMessage('');
      setChatTaskId(null);
      await refresh();
    } finally {
      setChatSubmitting(false);
    }
  };

  const handleApplyPendingVersion = async (pendingVersionId: string) => {
    const next = await enterpriseLeadWorkspaceService.applyPendingVersion(pendingVersionId);
    if (next) setSnapshot(next);
  };

  if (!snapshot) {
    return <div className="flex h-full items-center justify-center text-secondary">Loading...</div>;
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border bg-surface px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{snapshot.workspace.name}</h1>
            <p className="mt-1 text-sm text-secondary">
              {snapshot.workspace.profile.companySummary || '工作空间资料待补充'}
            </p>
          </div>
          <button type="button" onClick={onCreateWorkspace} className="rounded-xl bg-surface-raised px-4 py-2 text-sm font-medium text-foreground">
            创建工作空间
          </button>
        </div>
        <div className="mt-4 flex gap-2">
          <input
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
            aria-label="输入本次获客目标"
          />
          <button type="button" onClick={handleCreateRun} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white">
            开始执行
          </button>
        </div>
        {chatTaskId && (
          <div className="mt-4 rounded-xl border border-border bg-background p-3">
            <div className="mb-2 text-sm font-medium text-foreground">单独调整 Agent 输出</div>
            <textarea
              value={chatMessage}
              onChange={(event) => setChatMessage(event.target.value)}
              className="h-24 w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
              aria-label="单独调整 Agent 输出"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setChatTaskId(null)} className="rounded-lg bg-surface-raised px-3 py-1.5 text-xs text-foreground">
                取消
              </button>
              <button
                type="button"
                onClick={handleCreatePendingVersion}
                disabled={chatSubmitting || !chatMessage.trim()}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                生成待应用版本
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] gap-4 overflow-y-auto p-4">
        <main className="grid content-start gap-3 md:grid-cols-2">
          {snapshot.tasks.map(task => (
            <AgentTaskCard
              key={task.id}
              task={task.id === runningTaskId ? { ...task, status: 'running' } : task}
              onRun={handleRunTask}
              onChat={(taskId) => {
                setChatTaskId(taskId);
                setChatMessage('');
              }}
            />
          ))}
        </main>
        <WorkspaceSidePanel
          todos={snapshot.todos}
          deliverables={snapshot.deliverables}
          pendingVersions={snapshot.pendingVersions}
          onApplyPendingVersion={handleApplyPendingVersion}
        />
      </div>
    </div>
  );
};

export default AgentWorkspaceConsole;
```

- [ ] **Step 5: Run lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/AgentTaskCard.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceSidePanel.tsx src/renderer/components/enterpriseLeadWorkspace/AgentWorkspaceConsole.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts
```

Expected: pass after imports and type casts are correct.

## Task 8: App Navigation, Sidebar, And i18n Wiring

**Files:**

- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/Sidebar.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Add i18n keys**

Modify both zh and en dictionaries in `src/renderer/services/i18n.ts`:

```ts
enterpriseLeadWorkspaceTitle: '宇智能工作空间',
enterpriseLeadWorkspaceSubtitle: '为企业获客、内容运营和销售跟进创建一个长期业务空间',
enterpriseLeadCreateWorkspace: '创建企业获客工作空间',
enterpriseLeadCreateWorkspaceDesc: '通过上传资料或对话，自动提取企业、产品、客户和渠道信息。',
enterpriseLeadImportMaterial: '导入已有资料',
enterpriseLeadImportMaterialDesc: '从产品手册、公司介绍、历史文案或客户资料里建立空间。',
enterpriseLeadRecentWorkspaces: '最近工作空间',
enterpriseLeadRecentWorkspacesDesc: '继续上次获客任务，或创建新的业务空间',
enterpriseLeadRecentlyOpened: '最近打开',
enterpriseLeadCreateNewWorkspace: '创建新工作空间',
enterpriseLeadProfileIncomplete: '资料待补充',
enterpriseLeadNavLabel: '获客空间',
enterpriseLeadCreateByExtraction: '上传资料或粘贴描述，系统会先提取工作空间草稿',
enterpriseLeadUploadMaterial: '上传资料',
enterpriseLeadConversationMaterial: '对话资料',
enterpriseLeadExtracting: '提取中...',
enterpriseLeadExtractWorkspace: '提取工作空间资料',
enterpriseLeadDraftEmpty: '左侧输入资料后，提取结果会显示在这里',
enterpriseLeadCompanySummary: '企业概况',
enterpriseLeadProducts: '产品',
enterpriseLeadTargetCustomers: '目标客户',
enterpriseLeadChannels: '渠道偏好',
enterpriseLeadSellingPoints: '卖点',
enterpriseLeadProhibitedClaims: '禁用表达',
enterpriseLeadMissingInfo: '缺失资料',
enterpriseLeadEmptyField: '待补充',
enterpriseLeadReextract: '重新提取',
enterpriseLeadConfirmCreate: '确认创建',
enterpriseLeadExtractFailed: '提取失败',
enterpriseLeadReadFileFailed: '读取文件失败',
enterpriseLeadCreateFailed: '创建失败',
```

English values:

```ts
enterpriseLeadWorkspaceTitle: 'Yuzh Workspace',
enterpriseLeadWorkspaceSubtitle: 'Create a long-term business workspace for lead generation, content operations, and sales follow-up.',
enterpriseLeadCreateWorkspace: 'Create lead workspace',
enterpriseLeadCreateWorkspaceDesc: 'Extract company, product, customer, and channel information from files or conversation.',
enterpriseLeadImportMaterial: 'Import materials',
enterpriseLeadImportMaterialDesc: 'Build a workspace from product manuals, company introductions, past copy, or customer material.',
enterpriseLeadRecentWorkspaces: 'Recent workspaces',
enterpriseLeadRecentWorkspacesDesc: 'Continue recent lead work or create a new business workspace.',
enterpriseLeadRecentlyOpened: 'Recently opened',
enterpriseLeadCreateNewWorkspace: 'Create new workspace',
enterpriseLeadProfileIncomplete: 'Profile incomplete',
enterpriseLeadNavLabel: 'Lead Workspace',
enterpriseLeadCreateByExtraction: 'Upload material or paste a description, then review the extracted workspace draft.',
enterpriseLeadUploadMaterial: 'Upload material',
enterpriseLeadConversationMaterial: 'Conversation material',
enterpriseLeadExtracting: 'Extracting...',
enterpriseLeadExtractWorkspace: 'Extract workspace profile',
enterpriseLeadDraftEmpty: 'Extracted workspace details will appear here after you provide material.',
enterpriseLeadCompanySummary: 'Company summary',
enterpriseLeadProducts: 'Products',
enterpriseLeadTargetCustomers: 'Target customers',
enterpriseLeadChannels: 'Channels',
enterpriseLeadSellingPoints: 'Selling points',
enterpriseLeadProhibitedClaims: 'Prohibited claims',
enterpriseLeadMissingInfo: 'Missing info',
enterpriseLeadEmptyField: 'Not provided',
enterpriseLeadReextract: 'Extract again',
enterpriseLeadConfirmCreate: 'Create workspace',
enterpriseLeadExtractFailed: 'Extraction failed',
enterpriseLeadReadFileFailed: 'Failed to read file',
enterpriseLeadCreateFailed: 'Creation failed',
```

- [ ] **Step 2: Wire App main view**

Modify `src/renderer/App.tsx`:

```ts
import { EnterpriseLeadWorkspaceView } from './components/enterpriseLeadWorkspace';
```

Extend state type:

```ts
const [mainView, setMainView] = useState<'cowork' | 'skills' | 'scheduledTasks' | 'kits' | 'mcp' | 'enterpriseLeadWorkspace'>('cowork');
```

Add handler:

```ts
const handleShowEnterpriseLeadWorkspace = useCallback(() => {
  setMainView('enterpriseLeadWorkspace');
}, []);
```

Pass to `Sidebar`:

```tsx
onShowEnterpriseLeadWorkspace={handleShowEnterpriseLeadWorkspace}
```

Render view:

```tsx
{mainView === 'enterpriseLeadWorkspace' && (
  <EnterpriseLeadWorkspaceView />
)}
```

- [ ] **Step 3: Wire Sidebar nav**

Modify `src/renderer/components/Sidebar.tsx` prop types:

```ts
activeView: 'cowork' | 'skills' | 'scheduledTasks' | 'kits' | 'mcp' | 'enterpriseLeadWorkspace';
onShowEnterpriseLeadWorkspace: () => void;
```

Add a nav button near other primary navigation buttons:

```tsx
<button
  type="button"
  onClick={onShowEnterpriseLeadWorkspace}
  className={activeView === 'enterpriseLeadWorkspace' ? activeSidebarNavItemClassName : sidebarNavItemClassName}
>
  <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm border border-current text-[10px]">获</span>
  <span className="truncate">{i18nService.t('enterpriseLeadNavLabel')}</span>
</button>
```

- [ ] **Step 4: Run lint on touched renderer files**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/App.tsx src/renderer/components/Sidebar.tsx src/renderer/services/i18n.ts
```

Expected: pass.

## Task 9: End-To-End Verification Pass

**Files:**

- No new files.
- Verify all touched files.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- src/shared/enterpriseLeadWorkspace/validation.test.ts src/main/enterpriseLeadWorkspace/store.test.ts src/main/enterpriseLeadWorkspace/workflow.test.ts src/main/enterpriseLeadWorkspace/service.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: pass.

- [ ] **Step 2: Run changed-file ESLint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/enterpriseLeadWorkspace/constants.ts src/shared/enterpriseLeadWorkspace/types.ts src/shared/enterpriseLeadWorkspace/validation.ts src/shared/enterpriseLeadWorkspace/validation.test.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/enterpriseLeadWorkspace/store.ts src/main/enterpriseLeadWorkspace/store.test.ts src/main/enterpriseLeadWorkspace/workflow.ts src/main/enterpriseLeadWorkspace/workflow.test.ts src/main/enterpriseLeadWorkspace/modelJson.ts src/main/enterpriseLeadWorkspace/promptTemplates.ts src/main/enterpriseLeadWorkspace/service.ts src/main/enterpriseLeadWorkspace/service.test.ts src/main/enterpriseLeadWorkspace/ipcHandlers.ts src/main/main.ts src/main/preload.ts
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/types/electron.d.ts src/renderer/services/enterpriseLeadWorkspace.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceLaunch.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx src/renderer/components/enterpriseLeadWorkspace/AgentTaskCard.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceSidePanel.tsx src/renderer/components/enterpriseLeadWorkspace/AgentWorkspaceConsole.tsx src/renderer/components/enterpriseLeadWorkspace/index.ts src/renderer/App.tsx src/renderer/components/Sidebar.tsx src/renderer/services/i18n.ts
```

Expected: all three lint groups pass.

- [ ] **Step 3: Compile Electron main/preload**

Run:

```bash
npm run compile:electron
```

Expected: pass.

- [ ] **Step 4: Run production renderer build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 5: Manual smoke test in Electron**

Run:

```bash
npm run electron:dev
```

Expected:

- App launches.
- Sidebar contains `获客空间`.
- First visit to the new view shows the create workspace launch screen when no workspace exists.
- Conversation extraction creates a draft.
- Confirming the draft creates a workspace and opens the Agent card console.
- Creating a run creates the fixed Agent task cards.
- Running a task stores output and updates the card.
- Safety boundary text says external actions remain drafts/todos/approval items.

Stop the dev server after verification.

- [ ] **Step 6: Review diff for scope and safety**

Run:

```bash
git diff --stat
git diff -- src/shared/enterpriseLeadWorkspace src/main/enterpriseLeadWorkspace src/main/main.ts src/main/preload.ts src/renderer/components/enterpriseLeadWorkspace src/renderer/services/enterpriseLeadWorkspace.ts src/renderer/types/electron.d.ts src/renderer/App.tsx src/renderer/components/Sidebar.tsx src/renderer/services/i18n.ts
```

Expected:

- No generated runtime/vendor changes.
- No unrelated formatting churn.
- No strings implying publishing/commenting/private messaging/emailing has happened.
- All user-visible strings have zh and en translations.
- No API keys or sensitive data in prompts, reports, logs, or tests.
