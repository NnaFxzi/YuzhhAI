# 运营推广 Agent团队 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前企业获客工作空间中的角色型 Agent、Cowork 对话和 OpenClaw 子会话统一为一个可执行、可暂停、可恢复、可审计的运营推广多 Agent 工作流。

**Architecture:** 保留 Cowork 作为自然语言入口和人工协作界面；新增独立的 Promotion Workflow Orchestrator 负责 DAG 调度、并行执行、重试、暂停和恢复；使用 Artifact Store 传递结构化产物和证据引用，不再把所有上游原始结果直接拼接进下游 Prompt。第一版继续使用现有 `ModelClientAdapter` 作为 Agent 执行适配器，OpenClaw 子会话作为可追踪的增强执行模式，所有外部发布、评论、私信和邮件继续经过人工审批并保持草稿优先。

**Tech Stack:** Electron main process, React + Redux renderer, TypeScript, SQLite via `better-sqlite3`, OpenClaw gateway, existing `ModelClientAdapter`, Vitest, ESLint, existing scheduled-task/Cron infrastructure.

## Global Constraints

- Node.js 必须满足 `>=24.15.0 <25`。
- 继续使用当前 OpenClaw runtime；不得直接修改 `vendor/openclaw-runtime/` 或 sibling OpenClaw checkout。
- 所有新增或修改的 TypeScript 文件必须通过 `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 <files>`。
- 工作流中的真实发布、评论、私信、邮件、下单和联系客户默认禁止；只能生成草稿、待办和人工审批请求。
- 不新增第三方 Schema 依赖；沿用当前 `normalize*` 手写校验模式。
- 保留旧版 `enabledAgentRoles` 和旧工作流读取能力，已有历史 run 不需要迁移成新 DAG 才能查看和归档。
- 不在 `main.ts` 中继续堆叠业务逻辑；新增逻辑放在 `src/main/enterpriseLeadWorkspace/` 或对应 shared 模块。
- 不做与本功能无关的拆文件、格式化、重命名或 legacy lint 清理。
- 所有用户可见 renderer 文案必须同时增加中文和英文 i18n。

## Scope and Release Boundaries

本计划分为三个可独立交付的里程碑：

1. **M1：可执行的逻辑多 Agent 工作流**。完成推广 DAG、结构化产物、串行/并行调度、暂停恢复和工作台运行视图。每个角色由一次独立模型任务执行，但不要求每个角色都创建 OpenClaw 子会话。
2. **M2：真实运行可观测性和 OpenClaw 子会话绑定**。将子会话与工作流任务关联，用户可以查看某个任务对应的 OpenClaw 子会话和历史。
3. **M3：持续运营闭环**。接入定时监控、指标快照、复盘和下一轮任务生成；外部发布仍保留审批门。

本计划不包含真实平台发布 API 的全面实现。平台连接器只需要在 M1 中提供草稿和审批接口，在 M3 中提供可插拔的执行边界。

## File Map

### New files

- `src/shared/enterpriseLeadWorkspace/workflowContracts.ts`：工作流节点、运行事件、任务输入、Artifact 引用和审批状态的共享类型。
- `src/shared/enterpriseLeadWorkspace/promotionWorkflowGraph.ts`：运营推广 DAG、节点依赖、默认执行策略和平台分支定义。
- `src/shared/enterpriseLeadWorkspace/promotionTaskContracts.ts`：各推广角色的输入/输出结构和手写校验器。
- `src/main/enterpriseLeadWorkspace/workflowArtifactStore.ts`：Artifact、Workflow Event、Task Attempt 的 SQLite 读写。
- `src/main/enterpriseLeadWorkspace/workflowOrchestrator.ts`：可恢复 DAG 调度器。
- `src/main/enterpriseLeadWorkspace/workflowExecutionAdapter.ts`：inline model execution 和后续 OpenClaw child-session execution 的统一接口。
- `src/main/enterpriseLeadWorkspace/workflowOrchestrator.test.ts`：DAG、并行、暂停、重试、恢复和取消测试。
- `src/shared/enterpriseLeadWorkspace/promotionTaskContracts.test.ts`：角色合同、证据、风险和草稿规则测试。
- `src/renderer/components/enterpriseLeadWorkspace/WorkflowRunView.tsx`：当前推广运行总览和实时进度。
- `src/renderer/components/enterpriseLeadWorkspace/WorkflowTaskCard.tsx`：单个 Agent任务卡片。
- `src/renderer/components/enterpriseLeadWorkspace/WorkflowApprovalPanel.tsx`：人工审批和退回修改界面。
- `src/renderer/components/enterpriseLeadWorkspace/workflowRunState.ts`：renderer 运行状态归并和事件 reducer。
- `src/renderer/components/enterpriseLeadWorkspace/workflowRunState.test.ts`：事件乱序、重复和断线恢复测试。

### Existing files to modify

- `src/shared/enterpriseLeadWorkspace/constants.ts`：补充 ready、awaiting approval、cancelled 等状态常量。
- `src/shared/enterpriseLeadWorkspace/types.ts`：将 DAG 节点、Artifact 引用、尝试次数和执行模式加入 run/task snapshot。
- `src/shared/enterpriseLeadWorkspace/agentOrganization.ts`：补充推广工作流的销售交接可选节点和部门分组映射。
- `src/main/enterpriseLeadWorkspace/workflow.ts`：保留角色描述，改为从统一 Promotion graph 读取默认顺序和元数据。
- `src/main/enterpriseLeadWorkspace/store.ts`：增加任务依赖、工作流版本、执行模式和新表初始化；保留旧字段兼容。
- `src/main/enterpriseLeadWorkspace/service.ts`：接入 Artifact Store 和 Orchestrator，保留旧 run 的 legacy fallback。
- `src/main/enterpriseLeadWorkspace/promptTemplates.ts`：改用角色合同和 Artifact 摘要构造 Prompt。
- `src/main/enterpriseLeadWorkspace/ipcHandlers.ts`：增加 start/resume/cancel/approve 和 workflow snapshot IPC。
- `src/shared/enterpriseLeadWorkspace/constants.ts` 与 `src/main/preload.ts`：增加新的 IPC channel 和事件类型。
- `src/renderer/services/enterpriseLeadWorkspace.ts`：封装新的 workflow API 和事件监听。
- `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`：增加 Workflow 内部页面和启动路由。
- `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`：渲染 WorkflowRunView，并刷新 workspace snapshot。
- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceStart.tsx`：把“开始工作流”改为打开工作流启动面板。
- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreationRecords.tsx`：复用 Artifact/事件结果展示历史运行。
- `src/main/libs/agentEngine/types.ts`、`src/main/libs/agentEngine/coworkEngineRouter.ts`、`src/main/libs/agentEngine/openclawRuntimeAdapter.ts`：M2 中增加子会话执行适配和任务关联字段。
- `src/main/subagentRunStore.ts`、`src/main/subagentMessageStore.ts`、`src/main/libs/agentEngine/subagentTracker.ts`：M2 中保存 workspace/run/task/role 关联。
- `src/scheduledTask/cronJobService.ts` 与 `src/scheduledTask/types.ts`：M3 中增加推广监控任务的 payload 和运行结果映射。
- `src/renderer/services/i18n.ts`、`src/main/i18n.ts`：增加全部用户可见的工作流状态、审批和错误文案。

---

### Task 1: 建立工作流状态、Artifact 和 DAG 合同

**Files:**

- Create: `src/shared/enterpriseLeadWorkspace/workflowContracts.ts`
- Create: `src/shared/enterpriseLeadWorkspace/promotionWorkflowGraph.ts`
- Create: `src/shared/enterpriseLeadWorkspace/promotionTaskContracts.test.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/constants.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/types.ts`
- Test: `src/main/enterpriseLeadWorkspace/workflow.test.ts`

**Interfaces:**

- Consumes: 现有 `EnterpriseLeadAgentRole`、`EnterpriseLeadTaskStatus`、`EnterpriseLeadWorkspaceAgentBinding`。
- Produces: `PromotionWorkflowNodeId`、`PromotionWorkflowNode`、`WorkflowArtifactRef`、`WorkflowEvent`、`WorkflowTaskExecutionContext`、`PROMOTION_WORKFLOW_GRAPH`。

- [ ] **Step 1: 写状态和合同的失败测试**

新增测试必须验证：

```ts
import { describe, expect, test } from 'vitest';
import { EnterpriseLeadAgentRole } from './constants';
import { PROMOTION_WORKFLOW_GRAPH } from './promotionWorkflowGraph';
import { normalizeWorkflowArtifactRef } from './workflowContracts';

describe('promotion workflow contracts', () => {
  test('keeps cleaning behind scraping and fans out insight tasks', () => {
    const cleaning = PROMOTION_WORKFLOW_GRAPH.find(
      node => node.role === EnterpriseLeadAgentRole.PromotionDataCleaning,
    );
    const insight = PROMOTION_WORKFLOW_GRAPH.find(
      node => node.role === EnterpriseLeadAgentRole.PromotionCompetitorInsight,
    );
    const scoring = PROMOTION_WORKFLOW_GRAPH.find(
      node => node.role === EnterpriseLeadAgentRole.PromotionLeadScoring,
    );

    expect(cleaning?.dependsOn).toEqual([
      EnterpriseLeadAgentRole.PromotionDataScraping,
    ]);
    expect(insight?.dependsOn).toEqual([
      EnterpriseLeadAgentRole.PromotionDataCleaning,
    ]);
    expect(scoring?.dependsOn).toEqual([
      EnterpriseLeadAgentRole.PromotionDataCleaning,
    ]);
  });

  test('rejects artifact references without an id and kind', () => {
    expect(normalizeWorkflowArtifactRef({ id: 'a' })).toBeNull();
    expect(normalizeWorkflowArtifactRef({ id: 'a', kind: 'clean_leads' })).toMatchObject({
      id: 'a',
      kind: 'clean_leads',
    });
  });
});
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- promotionWorkflowGraph promotionTaskContracts`

Expected: FAIL because the new graph, contract types and normalizer do not exist.

- [ ] **Step 3: 实现共享合同**

在 `workflowContracts.ts` 中实现以下最小接口：

```ts
import { EnterpriseLeadAgentRole } from './constants';

export const WorkflowExecutionMode = {
  Inline: 'inline',
  ChildSession: 'child_session',
} as const;
export type WorkflowExecutionMode =
  (typeof WorkflowExecutionMode)[keyof typeof WorkflowExecutionMode];

export type PromotionWorkflowNodeId = EnterpriseLeadAgentRole | string;

export interface PromotionWorkflowNode {
  role: PromotionWorkflowNodeId;
  dependsOn: PromotionWorkflowNodeId[];
  executionMode: WorkflowExecutionMode;
  optional?: boolean;
  enableWhen?: 'sales_handoff_requested' | 'monitoring_requested';
}

export interface WorkflowArtifactRef {
  id: string;
  kind: string;
  schemaVersion: number;
  summary: string;
  producerTaskId: string;
  evidenceIds: string[];
}

export interface WorkflowTaskExecutionContext {
  runId: string;
  taskId: string;
  role: string;
  userGoal: string;
  inputArtifacts: WorkflowArtifactRef[];
  acceptanceCriteria: string[];
  executionMode: WorkflowExecutionMode;
}

export interface WorkflowStartOptions {
  enabledOptionalNodes: string[];
  maxConcurrency: number;
}

export interface WorkflowEvent {
  runId: string;
  sequence: number;
  type: 'run_started' | 'task_ready' | 'task_started' | 'task_retrying' | 'task_completed' | 'task_failed' | 'task_blocked' | 'approval_required' | 'approval_rejected' | 'run_completed' | 'run_cancelled' | 'run_error';
  taskId?: string;
  role?: string;
  summary?: string;
  createdAt: string;
}

export function normalizeWorkflowArtifactRef(value: unknown): WorkflowArtifactRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const kind = typeof record.kind === 'string' ? record.kind.trim() : '';
  if (!id || !kind) return null;
  return {
    id,
    kind,
    schemaVersion: typeof record.schemaVersion === 'number' && Number.isFinite(record.schemaVersion)
      ? Math.max(1, Math.floor(record.schemaVersion))
      : 1,
    summary: typeof record.summary === 'string' ? record.summary.trim() : '',
    producerTaskId: typeof record.producerTaskId === 'string' ? record.producerTaskId.trim() : '',
    evidenceIds: Array.isArray(record.evidenceIds)
      ? record.evidenceIds.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
      : [],
  };
}
```

在 `promotionWorkflowGraph.ts` 中定义固定 DAG：

```ts
export const PROMOTION_WORKFLOW_GRAPH: PromotionWorkflowNode[] = [
  { role: EnterpriseLeadAgentRole.PromotionController, dependsOn: [], executionMode: WorkflowExecutionMode.Inline },
  { role: EnterpriseLeadAgentRole.PromotionDataScraping, dependsOn: [EnterpriseLeadAgentRole.PromotionController], executionMode: WorkflowExecutionMode.Inline },
  { role: EnterpriseLeadAgentRole.ProductSellingPoint, dependsOn: [EnterpriseLeadAgentRole.PromotionController], executionMode: WorkflowExecutionMode.Inline },
  { role: EnterpriseLeadAgentRole.PromotionDataCleaning, dependsOn: [EnterpriseLeadAgentRole.PromotionDataScraping], executionMode: WorkflowExecutionMode.Inline },
  { role: EnterpriseLeadAgentRole.PromotionCompetitorInsight, dependsOn: [EnterpriseLeadAgentRole.PromotionDataCleaning], executionMode: WorkflowExecutionMode.Inline },
  { role: EnterpriseLeadAgentRole.PromotionLeadScoring, dependsOn: [EnterpriseLeadAgentRole.PromotionDataCleaning], executionMode: WorkflowExecutionMode.Inline },
  { role: EnterpriseLeadAgentRole.PromotionMultiPlatformAssets, dependsOn: [EnterpriseLeadAgentRole.ProductSellingPoint, EnterpriseLeadAgentRole.PromotionCompetitorInsight, EnterpriseLeadAgentRole.PromotionLeadScoring], executionMode: WorkflowExecutionMode.Inline },
  { role: EnterpriseLeadAgentRole.ContentQuality, dependsOn: [EnterpriseLeadAgentRole.PromotionMultiPlatformAssets], executionMode: WorkflowExecutionMode.Inline },
  { role: EnterpriseLeadAgentRole.PromotionPublishingSchedule, dependsOn: [EnterpriseLeadAgentRole.ContentQuality], executionMode: WorkflowExecutionMode.Inline },
  { role: EnterpriseLeadAgentRole.SalesHandoff, dependsOn: [EnterpriseLeadAgentRole.PromotionLeadScoring, EnterpriseLeadAgentRole.PromotionMultiPlatformAssets], executionMode: WorkflowExecutionMode.Inline, optional: true, enableWhen: 'sales_handoff_requested' },
  { role: EnterpriseLeadAgentRole.PromotionAccountMonitoring, dependsOn: [EnterpriseLeadAgentRole.PromotionPublishingSchedule], executionMode: WorkflowExecutionMode.Inline, optional: true, enableWhen: 'monitoring_requested' },
  { role: EnterpriseLeadAgentRole.PromotionPerformanceReview, dependsOn: [EnterpriseLeadAgentRole.PromotionAccountMonitoring], executionMode: WorkflowExecutionMode.Inline, optional: true, enableWhen: 'monitoring_requested' },
];
```

为 `EnterpriseLeadRunStatus` 增加 `AwaitingApproval`、`Cancelled`，为 `EnterpriseLeadTaskStatus` 增加 `Ready`、`AwaitingApproval`、`Cancelled`。在 `EnterpriseLeadAgentTask` 中增加 `nodeId`、`dependsOnTaskIds`、`attempt`、`executionMode` 和 `artifactRefs`；在 `EnterpriseLeadRun` 中增加 `workflowVersion`。`SalesHandoff` 和监控/复盘节点默认关闭，由 Workflow 启动参数显式启用。

- [ ] **Step 4: 运行通过测试和类型检查**

Run: `npm test -- promotionWorkflowGraph promotionTaskContracts`

Run: `npx tsc --noEmit --pretty false`

Expected: PASS；Promotion graph 无循环，所有依赖角色存在，Artifact 引用缺失字段时返回 `null`。

- [ ] **Step 5: 提交独立变更**

```bash
git add src/shared/enterpriseLeadWorkspace/constants.ts src/shared/enterpriseLeadWorkspace/types.ts src/shared/enterpriseLeadWorkspace/workflowContracts.ts src/shared/enterpriseLeadWorkspace/promotionWorkflowGraph.ts src/shared/enterpriseLeadWorkspace/promotionTaskContracts.test.ts
git commit -m "feat(workflow): define promotion agent graph contracts"
```

---

### Task 2: 增加 Artifact、事件和任务尝试存储

**Files:**

- Create: `src/main/enterpriseLeadWorkspace/workflowArtifactStore.ts`
- Create: `src/main/enterpriseLeadWorkspace/workflowArtifactStore.test.ts`
- Modify: `src/main/enterpriseLeadWorkspace/store.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/types.ts`

**Interfaces:**

- Consumes: Task 1 的 `WorkflowArtifactRef`、`WorkflowEvent`、`EnterpriseLeadWorkspaceRun`。
- Produces: `WorkflowArtifactStore.createArtifact`、`getArtifact`、`listRunArtifacts`、`appendEvent`、`listEvents`、`createAttempt`、`finishAttempt`。

- [ ] **Step 1: 写 SQLite 行为测试**

测试必须覆盖：

```ts
test('stores artifact lineage and returns events in sequence order', () => {
  const store = createWorkflowArtifactStore(':memory:');
  const artifact = store.createArtifact({
    runId: 'run-1',
    taskId: 'task-1',
    kind: 'clean_lead_dataset',
    schemaVersion: 1,
    payload: { rows: 2 },
    evidenceIds: ['evidence-1'],
  });

  store.appendEvent({ runId: 'run-1', type: 'task_started', taskId: 'task-1' });
  store.appendEvent({ runId: 'run-1', type: 'task_completed', taskId: 'task-1' });

  expect(store.getArtifact(artifact.id)).toMatchObject({
    runId: 'run-1',
    taskId: 'task-1',
    kind: 'clean_lead_dataset',
  });
  expect(store.listEvents('run-1').map(event => event.sequence)).toEqual([1, 2]);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- workflowArtifactStore`

Expected: FAIL because the store and tables do not exist.

- [ ] **Step 3: 实现表和存储方法**

在 `EnterpriseLeadWorkspaceStore.initialize()` 中增加以下表，使用现有 ad-hoc migration 风格保证旧 SQLite 可以启动：

```sql
CREATE TABLE IF NOT EXISTS enterprise_lead_workflow_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  evidence_ids TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS enterprise_lead_workflow_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  task_id TEXT,
  role TEXT,
  summary TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, sequence)
);

CREATE TABLE IF NOT EXISTS enterprise_lead_task_attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  execution_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
```

`workflowArtifactStore.ts` 只负责 JSON 序列化、ID、时间和查询，不负责工作流调度。`appendEvent` 必须在事务中按当前 run 的最大 sequence 加一，避免并行任务产生重复 sequence。

- [ ] **Step 4: 运行测试并检查迁移兼容**

Run: `npm test -- workflowArtifactStore store`

Expected: PASS；旧 workspace、旧 run 和旧 task 的读取结果保持不变，新表为空时也能正常启动。

- [ ] **Step 5: 提交**

```bash
git add src/main/enterpriseLeadWorkspace/store.ts src/main/enterpriseLeadWorkspace/workflowArtifactStore.ts src/main/enterpriseLeadWorkspace/workflowArtifactStore.test.ts src/shared/enterpriseLeadWorkspace/types.ts
git commit -m "feat(workflow): persist artifacts and execution events"
```

---

### Task 3: 为推广 Agent建立角色级输入输出合同

**Files:**

- Create: `src/shared/enterpriseLeadWorkspace/promotionTaskContracts.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/promotionContracts.ts`
- Modify: `src/main/enterpriseLeadWorkspace/promptTemplates.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/validation.ts`
- Test: `src/shared/enterpriseLeadWorkspace/promotionTaskContracts.test.ts`

**Interfaces:**

- Consumes: Task 1 的 Artifact 引用和当前 workspace profile、research、platform settings。
- Produces: `parsePromotionTaskResult(role, value)`、`buildPromotionTaskOutputSchema(role)`、`PromotionTaskResult`。

- [ ] **Step 1: 写角色合同失败测试**

至少测试以下角色：数据抓取、数据清洗、商机评分、多平台物料、内容质检、账户监控。

```ts
test('requires source evidence for scraped items', () => {
  expect(() => parsePromotionTaskResult(EnterpriseLeadAgentRole.PromotionDataScraping, {
    status: 'completed',
    summary: '抓取完成',
    outputs: { items: [{ title: '某公司', content: '有需求' }] },
    missingInfo: [],
    todos: [],
    risks: [],
    handoffContext: {},
  })).toThrow('sourceUrl');
});

test('normalizes platform assets into draft-only deliverables', () => {
  const result = parsePromotionTaskResult(EnterpriseLeadAgentRole.PromotionMultiPlatformAssets, {
    status: 'completed',
    summary: '物料完成',
    outputs: { assets: [{ platform: 'xiaohongshu', title: '标题', body: '正文', tags: [], callToAction: '咨询' }] },
    missingInfo: [],
    todos: [],
    risks: [],
    handoffContext: {},
  });

  expect(result.outputs.assets[0].manualReviewRequired).toBe(true);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- promotionTaskContracts`

Expected: FAIL because role-specific parsers do not exist.

- [ ] **Step 3: 实现合同和校验器**

使用现有 `normalizeAgentTaskResultInput` 作为外层校验，再按角色校验 `outputs`：

```ts
export interface PromotionTaskResult {
  status: EnterpriseLeadTaskStatus;
  summary: string;
  outputs: Record<string, unknown>;
  missingInfo: string[];
  todos: EnterpriseLeadTodoInput[];
  risks: EnterpriseLeadRiskItem[];
  handoffContext: Record<string, unknown>;
  artifactRefs: WorkflowArtifactRef[];
}

export function parsePromotionTaskResult(
  role: EnterpriseLeadTaskAgentRole,
  value: unknown,
): PromotionTaskResult {
  const base = normalizeAgentTaskResultInput(value);
  const outputs = normalizeRoleOutputs(role, base.outputs);
  return {
    ...base,
    outputs,
    artifactRefs: normalizeArtifactRefs(outputs),
  };
}
```

角色合同必须落到以下固定字段：

- 抓取：`items[].sourceKind/sourceUrl/title/content/capturedAt/confidence`
- 清洗：`records[].id/companyName/industry/contactHint/fieldConfidence`、`duplicates[]`、`missingFields[]`
- 商机评分：`leads[].id/score/tier/reasons/missingFields/nextAction`
- 物料：`assets[].platform/title/body/tags/callToAction/manualReviewRequired`
- 质检：`riskLevel/blockingIssues/warnings/requiredRevisions/canArchive`
- 监控：`metrics[]/anomalies[]/hypotheses[]/adjustmentActions[]`

在 `promptTemplates.ts` 中新增 `buildPromotionTaskOutputSchema(role)`，下游 Prompt 只接收 `inputArtifacts`、Artifact 摘要和角色合同，不再直接注入所有 `upstreamTasks.outputPayload`。

- [ ] **Step 4: 运行测试、补齐边界**

Run: `npm test -- promotionTaskContracts agentOutputSanitizer agentResponseContractPrompt`

Expected: PASS；缺失 source URL、缺失平台、非法风险级别、无效状态和非数组输出都会被拒绝或降级为 `needs_input`。

- [ ] **Step 5: 提交**

```bash
git add src/shared/enterpriseLeadWorkspace/promotionContracts.ts src/shared/enterpriseLeadWorkspace/promotionTaskContracts.ts src/shared/enterpriseLeadWorkspace/promotionTaskContracts.test.ts src/shared/enterpriseLeadWorkspace/validation.ts src/main/enterpriseLeadWorkspace/promptTemplates.ts
git commit -m "feat(workflow): add promotion task contracts"
```

---

### Task 4: 实现可并行、可暂停、可恢复的 DAG Orchestrator

**Files:**

- Create: `src/main/enterpriseLeadWorkspace/workflowExecutionAdapter.ts`
- Create: `src/main/enterpriseLeadWorkspace/workflowOrchestrator.ts`
- Create: `src/main/enterpriseLeadWorkspace/workflowOrchestrator.test.ts`
- Modify: `src/main/enterpriseLeadWorkspace/store.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/workflowContracts.ts`

**Interfaces:**

- Consumes: Task 1 的 graph，Task 2 的 Artifact/Event Store，Task 3 的 role parser。
- Produces: `EnterpriseLeadWorkflowOrchestrator.startRun`、`resumeRun`、`cancelRun`、`getSnapshot`。

- [ ] **Step 1: 写调度器失败测试**

测试至少覆盖：

```ts
test('runs independent insight tasks in parallel after cleaning completes', async () => {
  const adapter = createFakeExecutionAdapter();
  const orchestrator = createOrchestrator(adapter);
  const snapshot = await orchestrator.startRun('workspace-1', 'run-1');

  expect(adapter.maxConcurrent).toBe(2);
  expect(snapshot.tasks.find(task => task.role === EnterpriseLeadAgentRole.PromotionCompetitorInsight)?.status)
    .toBe(EnterpriseLeadTaskStatus.Completed);
  expect(snapshot.tasks.find(task => task.role === EnterpriseLeadAgentRole.PromotionLeadScoring)?.status)
    .toBe(EnterpriseLeadTaskStatus.Completed);
});

test('pauses downstream tasks when a worker needs input', async () => {
  const adapter = createFakeExecutionAdapter({
    [EnterpriseLeadAgentRole.PromotionDataCleaning]: { status: EnterpriseLeadTaskStatus.NeedsInput },
  });
  const snapshot = await createOrchestrator(adapter).startRun('workspace-1', 'run-1');

  expect(snapshot.currentRun?.status).toBe(EnterpriseLeadRunStatus.NeedsInput);
  expect(snapshot.tasks.find(task => task.role === EnterpriseLeadAgentRole.PromotionCompetitorInsight)?.status)
    .toBe(EnterpriseLeadTaskStatus.Waiting);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- workflowOrchestrator`

Expected: FAIL because the orchestrator and fake adapter contract do not exist.

- [ ] **Step 3: 实现执行适配器接口**

```ts
export interface WorkflowExecutionAdapter {
  execute(
    context: WorkflowTaskExecutionContext,
  ): Promise<PromotionTaskResult>;
}
```

第一版 `InlineWorkflowExecutionAdapter` 调用现有 `ModelClientAdapter.generate`，使用 workspace model config、task snapshot model 和 Task 3 的角色 Prompt；`ChildSessionWorkflowExecutionAdapter` 只保留接口和 `UnsupportedExecutionModeError`，在 M2 实现。

- [ ] **Step 4: 实现调度器核心循环**

调度器必须遵循以下规则：

1. 只把所有依赖任务为 `completed` 的任务标记为 `ready`。
2. 同一批次最多并行执行 3 个任务。
3. 使用 `Promise.allSettled` 收集同批次结果，单个任务失败不得丢失其他任务结果。
4. 任务状态为 `needs_input` 时，当前 run 变为 `needs_input`，下游保持 `waiting`。
5. 任务状态为 `awaiting_approval` 时，当前 run 变为 `awaiting_approval`，只允许 `approveTask` 或 `rejectTask` 改变状态。
6. `resumeRun` 只重跑 `ready`、`error`、`stale` 和已解决审批节点，不重复执行已完成且未 stale 的任务。
7. 每次状态变化都写入 Workflow Event；每次执行都写入 Task Attempt。
8. 同一 `runId` 只能有一个活动 orchestrator，重复 start 必须返回已有运行状态。
9. `cancelRun` 将未完成任务标记为 `cancelled`，不删除已产生 Artifact。

核心调度函数接口固定为：

```ts
export class EnterpriseLeadWorkflowOrchestrator {
  startRun(workspaceId: string, runId: string, options?: WorkflowStartOptions): Promise<EnterpriseLeadWorkspaceSnapshot>;
  resumeRun(workspaceId: string, runId: string): Promise<EnterpriseLeadWorkspaceSnapshot>;
  cancelRun(workspaceId: string, runId: string): Promise<EnterpriseLeadWorkspaceSnapshot>;
  getSnapshot(workspaceId: string, runId: string): EnterpriseLeadWorkspaceSnapshot;
}
```

`WorkflowStartOptions.enabledOptionalNodes` 只接受 `sales_handoff_requested` 和 `monitoring_requested`；`maxConcurrency` 归一化到 1-3，默认值为 3。`resumeRun` 读取已保存的启动参数，不允许在恢复时隐式打开新的可选节点。

- [ ] **Step 5: 运行调度器测试**

Run: `npm test -- workflowOrchestrator`

Expected: PASS；测试验证依赖顺序、并行上限、needs input、approval、retry、resume、cancel 和幂等启动。

- [ ] **Step 6: 提交**

```bash
git add src/main/enterpriseLeadWorkspace/workflowExecutionAdapter.ts src/main/enterpriseLeadWorkspace/workflowOrchestrator.ts src/main/enterpriseLeadWorkspace/workflowOrchestrator.test.ts src/main/enterpriseLeadWorkspace/store.ts src/shared/enterpriseLeadWorkspace/workflowContracts.ts
git commit -m "feat(workflow): add resumable promotion orchestrator"
```

---

### Task 5: 将现有 EnterpriseLeadWorkspaceService 接入新 Orchestrator

**Files:**

- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Modify: `src/main/enterpriseLeadWorkspace/store.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.test.ts`
- Modify: `src/main/enterpriseLeadWorkspace/workflow.ts`

**Interfaces:**

- Consumes: Task 1-4 的 graph、contracts、store 和 orchestrator。
- Produces: 现有 `createRun`、`runTask`、`runWorkflow` API 的兼容实现，以及新增 `resumeRun`、`cancelRun`、`approveTask`、`rejectTask`。

- [ ] **Step 1: 为旧行为补充回归测试**

保留并扩展现有测试：

- legacy workspace 没有 `workspaceAgents` 时仍按 `enabledAgentRoles` 创建任务。
- 已存在的旧 run 可以继续读取、查看 deliverables 和 archive。
- 新 promotion run 使用 graph，而不是简单数组顺序。
- product selling point 与 data scraping 都完成后，data cleaning 才可运行。
- 重跑清洗任务会让竞品洞察、商机评分和下游物料标记为 stale。
- workspace Agent 的技能为 workspace skill 与 agent skill 的去重并集。

- [ ] **Step 2: 运行回归测试确认当前基线**

Run: `npm test -- service workflow`

Expected: 新增断言在接入前失败，已有旧 workflow 测试仍然通过。

- [ ] **Step 3: 修改 run 创建和 Agent snapshot**

`createRun` 使用 `PROMOTION_WORKFLOW_GRAPH` 创建 `nodeId`、依赖 task IDs、workflow version 和 execution mode；仍然保留旧 `resolveLegacyRunRoles` 分支。

Agent 技能合并逻辑改成：

```ts
const skillIds = Array.from(
  new Set([...workspace.settings.skillIds, ...agent.skillIds]),
);
```

创建 run 时继续保存 immutable Agent snapshot，后续修改 workspace Agent 不影响已经创建的 run。

- [ ] **Step 4: 修改 runTask 和 Prompt 输入**

`runTask` 只读取当前 task 的 `artifactRefs` 和依赖节点产物摘要，调用 `InlineWorkflowExecutionAdapter`，通过 Task 3 的 parser 校验结果，并将输出写入 Artifact Store。

`buildAgentTaskPrompt` 的输入固定改为：

```ts
interface AgentTaskPromptInput {
  workspace: EnterpriseLeadWorkspace;
  task: EnterpriseLeadAgentTask;
  executionContext: WorkflowTaskExecutionContext;
  inputArtifacts: WorkflowArtifactRef[];
}
```

不得继续传递所有前序 task 的完整 `outputPayload`。

- [ ] **Step 5: 修改 runWorkflow API 并保留兼容 fallback**

新 run 调用 orchestrator；历史 run 如果 `workflowVersion` 为空，仍使用当前串行逻辑读取和继续执行。`rerunTask` 只将受影响的下游节点标记 stale，不删除 Artifact 或事件。

- [ ] **Step 6: 运行服务回归测试**

Run: `npm test -- service workflow`

Expected: PASS；至少包含旧版串行测试、新版 DAG 测试、snapshot immutability、stale downstream、archive risk gate 和 pending version 测试。

- [ ] **Step 7: 提交**

```bash
git add src/main/enterpriseLeadWorkspace/service.ts src/main/enterpriseLeadWorkspace/store.ts src/main/enterpriseLeadWorkspace/service.test.ts src/main/enterpriseLeadWorkspace/workflow.ts
git commit -m "feat(workflow): connect workspace service to promotion DAG"
```

---

### Task 6: 增加工作流 IPC、事件流和 Cowork 语义边界

**Files:**

- Modify: `src/shared/enterpriseLeadWorkspace/constants.ts`
- Modify: `src/main/enterpriseLeadWorkspace/ipcHandlers.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/services/enterpriseLeadWorkspace.ts`
- Modify: `src/main/enterpriseLeadWorkspace/coworkAgentTeamBridge.ts`
- Modify: `src/main/main.ts`
- Test: `src/main/enterpriseLeadWorkspace/ipcHandlers.test.ts`

**Interfaces:**

- Consumes: Task 5 的 service API 和 Task 2 的 Workflow Events。
- Produces: `workflow:start`、`workflow:resume`、`workflow:cancel`、`workflow:approveTask`、`workflow:rejectTask`、`workflow:event`。

- [ ] **Step 1: 写 IPC contract 测试**

测试必须验证：

- 空 workspaceId/runId 被拒绝。
- start 返回 run snapshot。
- cancel/approve/reject 调用正确的 service 方法。
- renderer 只能接收到当前 runId 的事件。

- [ ] **Step 2: 增加 shared IPC 常量和 preload API**

在共享常量中加入：

```ts
export const EnterpriseLeadWorkflowIpc = {
  Start: 'enterpriseLeadWorkflow:start',
  Resume: 'enterpriseLeadWorkflow:resume',
  Cancel: 'enterpriseLeadWorkflow:cancel',
  ApproveTask: 'enterpriseLeadWorkflow:approveTask',
  RejectTask: 'enterpriseLeadWorkflow:rejectTask',
  Event: 'enterpriseLeadWorkflow:event',
} as const;
```

Preload 暴露：

```ts
start: (workspaceId: string, runId: string, options: WorkflowStartOptions) => ipcRenderer.invoke(EnterpriseLeadWorkflowIpc.Start, { workspaceId, runId, options }),
resume: (workspaceId: string, runId: string) => ipcRenderer.invoke(EnterpriseLeadWorkflowIpc.Resume, { workspaceId, runId }),
cancel: (workspaceId: string, runId: string) => ipcRenderer.invoke(EnterpriseLeadWorkflowIpc.Cancel, { workspaceId, runId }),
onEvent: (listener: (event: WorkflowEvent) => void) => ipcRenderer.on(EnterpriseLeadWorkflowIpc.Event, (_event, payload) => listener(payload)),
```

同时提供对应的 unsubscribe，避免 Workspace 页面卸载后监听器泄漏。

- [ ] **Step 3: 修改 main IPC handler**

handler 只负责参数校验、调用 service 和把事件发送给窗口；不得在 handler 中实现依赖判断或业务 Prompt。后台运行时捕获异常并写入 `run_error` event，确保 renderer 不会永久停留在 running。

- [ ] **Step 4: 调整 Cowork team prompt**

在 `coworkAgentTeamBridge.ts` 中明确：

- Auto/manual 只代表当前 Cowork turn 的角色路由。
- 用户要求完整推广计划、批量获客、持续监控时，建议进入工作流运行页面。
- 不得声称其他 Agent 已经执行，除非存在对应 Workflow Event 或 OpenClaw child-session event。

这部分仍然只影响聊天提示词，不把 workflow run 伪装成普通聊天 turn。

- [ ] **Step 5: 运行 IPC 和主进程编译测试**

Run: `npm test -- ipcHandlers coworkAgentTeamBridge`

Run: `npm run compile:electron`

Expected: PASS；IPC 输入验证、主进程编译和已有 Cowork team prompt 测试全部通过。

- [ ] **Step 6: 提交**

```bash
git add src/shared/enterpriseLeadWorkspace/constants.ts src/main/enterpriseLeadWorkspace/ipcHandlers.ts src/main/preload.ts src/renderer/services/enterpriseLeadWorkspace.ts src/main/enterpriseLeadWorkspace/coworkAgentTeamBridge.ts src/main/main.ts src/main/enterpriseLeadWorkspace/ipcHandlers.test.ts
git commit -m "feat(workflow): expose promotion run control IPC"
```

---

### Task 7: 实现工作流启动、进度、审批和历史 UI

**Files:**

- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkflowRunView.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkflowTaskCard.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkflowApprovalPanel.tsx`
- Create: `src/renderer/components/enterpriseLeadWorkspace/workflowRunState.ts`
- Create: `src/renderer/components/enterpriseLeadWorkspace/workflowRunState.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceStart.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreationRecords.tsx`
- Modify: `src/renderer/services/i18n.ts`

**Interfaces:**

- Consumes: Task 6 的 preload API 和 Workflow Events。
- Produces: 用户可启动、查看、暂停、审批、退回、取消和恢复推广工作流的完整界面。

- [ ] **Step 1: 写 reducer 失败测试**

```ts
test('ignores duplicate and foreign run events', () => {
  const initial = createWorkflowRunState('run-1');
  const afterForeign = reduceWorkflowRunState(initial, {
    runId: 'run-2',
    sequence: 1,
    type: 'task_started',
    createdAt: '2026-07-12T00:00:00.000Z',
  });
  const afterStarted = reduceWorkflowRunState(initial, {
    runId: 'run-1',
    sequence: 1,
    type: 'task_started',
    taskId: 'task-1',
    createdAt: '2026-07-12T00:00:00.000Z',
  });

  expect(afterForeign).toEqual(initial);
  expect(reduceWorkflowRunState(afterStarted, afterStarted.lastEvent)).toEqual(afterStarted);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- workflowRunState`

Expected: FAIL because the reducer and run state do not exist。

- [ ] **Step 3: 增加 Workflow 页面路由**

在 `EnterpriseLeadWorkspaceInternalPage` 中增加 `Workflow`，并把 `WorkspaceStart` 的 `StartWorkflow` 目标改为 Workflow 页面。空白工作空间仍先跳转知识库；已有资料的工作空间进入 Workflow 启动面板。启动面板将用户选择转换为 `WorkflowStartOptions.enabledOptionalNodes`，再传给 Task 6 的 `workflow:start` IPC。

启动面板显示：

- 当前工作空间资料完整度
- 启用的 Agent数量
- 可运行节点和缺失前置条件
- 本次推广目标输入框
- 工作流模式：内容生产、线索挖掘、完整推广闭环
- “仅生成草稿”安全提示

- [ ] **Step 4: 实现 WorkflowRunView 和任务卡片**

`WorkflowRunView` 负责：

- 调用 `createRun` 与 `start`。
- 注册/注销 event listener。
- 断线后调用 `getRun` 从 SQLite snapshot 恢复。
- 展示阶段进度、当前状态、总控摘要、Artifact 数量、风险数量和待办数量。
- 提供 Resume、Cancel、Retry 和打开 Cowork 对话入口。

`WorkflowTaskCard` 负责：

- Agent名称、角色、状态、尝试次数、耗时。
- 输入 Artifact 和输出 Artifact。
- missing info、risk、manual review。
- “查看子会话”入口只在存在 child-session metadata 时显示。

`WorkflowApprovalPanel` 只允许：批准、退回并填写修改意见、标记人工处理完成。审批完成后调用 `approveTask` 或 `rejectTask`，不能直接修改 task 状态。

- [ ] **Step 5: 更新 Creation Records**

历史记录继续使用 `WorkspaceCreationRecords`，但增加：

- DAG 节点状态，而不是只按时间倒序显示。
- Artifact 版本和来源链接。
- 每次重试和审批的事件时间线。
- 已归档 run 的只读模式。

- [ ] **Step 6: 运行 renderer 测试和 lint**

Run: `npm test -- workflowRunState enterpriseLeadWorkspaceUi WorkspaceCreationRecords`

Run: `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/WorkflowRunView.tsx src/renderer/components/enterpriseLeadWorkspace/WorkflowTaskCard.tsx src/renderer/components/enterpriseLeadWorkspace/WorkflowApprovalPanel.tsx src/renderer/components/enterpriseLeadWorkspace/workflowRunState.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceStart.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreationRecords.tsx`

Expected: PASS；事件重复、断线恢复、审批状态和 i18n key 全部覆盖。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/components/enterpriseLeadWorkspace src/renderer/services/i18n.ts
git commit -m "feat(workflow): add promotion run workbench"
```

---

### Task 8: 将 OpenClaw 子会话和工作流任务关联

**Files:**

- Modify: `src/main/subagentRunStore.ts`
- Modify: `src/main/subagentMessageStore.ts`
- Modify: `src/main/libs/agentEngine/subagentTracker.ts`
- Modify: `src/main/libs/agentEngine/openclawRuntimeAdapter.ts`
- Modify: `src/main/libs/agentEngine/types.ts`
- Modify: `src/main/libs/agentEngine/coworkEngineRouter.ts`
- Modify: `src/main/ipcHandlers/coworkSubagent/handlers.ts`
- Modify: `src/renderer/types/cowork.ts`
- Modify: `src/renderer/components/cowork/SubagentSessionDetail.tsx`
- Test: `src/main/libs/agentEngine/subagentTracker.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `runId/taskId/role`，Task 4 的 `WorkflowExecutionMode.ChildSession`。
- Produces: `SubagentSessionSummary.workflowRunId`、`taskId`、`role` 和工作流任务到子会话的可追踪映射。

- [ ] **Step 1: 写关联字段测试**

测试 `sessions_spawn` 参数包含以下 metadata 时，Tracker 能够持久化：

```ts
{
  agentId: 'promotion_data_scraping',
  task: '抓取本周机械设备客户线索',
  label: '数据抓取 Agent',
  lobsterai: {
    workflowRunId: 'run-1',
    taskId: 'task-1',
    role: 'promotion_data_scraping',
  },
}
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- subagentTracker openclawRuntimeAdapter`

Expected: FAIL because the summary/store 没有 workflow metadata 字段。

- [ ] **Step 3: 增加 SQLite 兼容字段**

在 subagent runs 表增加 nullable 字段：`workflow_run_id`、`enterprise_task_id`、`workspace_agent_id`、`role`。启动时使用 `PRAGMA table_info()` 检查并 `ALTER TABLE`，不要重建已有表。

- [ ] **Step 4: 将 metadata 从 tool args 传到 Tracker**

`SubagentTracker.onToolStart` 解析 `args.lobsterai`，保留没有 metadata 的旧 sessions_spawn 行为；`SubagentSessionSummary` 只在字段存在时返回关联信息。

- [ ] **Step 5: 暴露只读查询**

增加按 `parentSessionId + workflowRunId + taskId` 查询子会话的 adapter 方法，renderer 的任务卡片通过该方法打开正确的子会话，而不是只按 agentId 猜测。

- [ ] **Step 6: 运行 OpenClaw 定向测试和编译**

Run: `npm test -- subagentTracker openclawRuntimeAdapter`

Run: `npm run compile:electron`

Expected: PASS；旧子会话测试、metadata 子会话测试和 Electron 编译全部通过。

- [ ] **Step 7: 提交**

```bash
git add src/main/subagentRunStore.ts src/main/subagentMessageStore.ts src/main/libs/agentEngine/subagentTracker.ts src/main/libs/agentEngine/openclawRuntimeAdapter.ts src/main/libs/agentEngine/types.ts src/main/libs/agentEngine/coworkEngineRouter.ts src/main/ipcHandlers/coworkSubagent/handlers.ts src/renderer/types/cowork.ts src/renderer/components/cowork/SubagentSessionDetail.tsx
git commit -m "feat(workflow): link OpenClaw subagents to promotion tasks"
```

---

### Task 9: 接入周期性账户监控和推广复盘

**Files:**

- Modify: `src/shared/enterpriseLeadWorkspace/promotionContracts.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Modify: `src/scheduledTask/types.ts`
- Modify: `src/scheduledTask/cronJobService.ts`
- Modify: `src/scheduledTask/modelMapper.ts`
- Modify: `src/scheduledTask/integration.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkflowRunView.tsx`
- Modify: `src/renderer/services/i18n.ts`

**Interfaces:**

- Consumes: Task 4 的可恢复 run、Task 7 的审批 UI、现有 CronJobService。
- Produces: `PromotionMetricSnapshot` 导入、监控 run 触发、复盘 Artifact 和下一轮推广建议。

- [ ] **Step 1: 写定时监控映射测试**

测试必须验证：

- scheduled task payload 能携带 `workspaceId`、`runId`、`agentId` 和指标来源。
- 监控任务执行结果会生成 `PromotionMetricReport` Artifact。
- 监控任务失败时不改变上一次已完成复盘。
- 同一时间窗口重复执行具有幂等 key。

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- scheduledTask integration`

Expected: 新增 promotion monitoring payload 测试失败。

- [ ] **Step 3: 增加指标输入边界**

`PromotionMetricSnapshot` 增加可选字段：`sourceId`、`periodStart`、`periodEnd`、`currency`、`evidenceIds`。未知平台或缺少时间范围时，监控 Agent 输出 `needs_input`，不得猜测趋势。

- [ ] **Step 4: 创建监控触发器**

复用现有 `agentTurn` payload，生成的 prompt 必须只要求读取指标、生成报告和待确认调整动作；不得直接包含发布、改预算或修改平台设置的执行权限。

- [ ] **Step 5: 连接复盘 Artifact**

监控完成后，将 `PromotionMetricReport` 作为 `PromotionPerformanceReview` 的输入 Artifact；复盘结果写入 workspace knowledge 或归档前必须经过用户确认的长期事实列表。

- [ ] **Step 6: 运行测试**

Run: `npm test -- scheduledTask integration service`

Expected: PASS；指标缺失、重复窗口、失败重试和复盘输入引用均有测试覆盖。

- [ ] **Step 7: 提交**

```bash
git add src/shared/enterpriseLeadWorkspace/promotionContracts.ts src/main/enterpriseLeadWorkspace/service.ts src/scheduledTask/types.ts src/scheduledTask/cronJobService.ts src/scheduledTask/modelMapper.ts src/scheduledTask/integration.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkflowRunView.tsx src/renderer/services/i18n.ts
git commit -m "feat(workflow): add scheduled promotion monitoring"
```

---

### Task 10: 完成端到端验证、文档和发布前检查

**Files:**

- Create: `docs/enterprise-lead-promotion-workflow.md`
- Modify: `README.md` 或当前项目开发文档入口（只增加链接和简短说明）
- Test: 所有 Task 1-9 的测试文件

**Interfaces:**

- Consumes: M1-M3 的完整工作流、IPC、UI、scheduled task 和子会话实现。
- Produces: 可供开发、测试和产品验收使用的运行说明、故障排查说明和安全边界说明。

- [ ] **Step 1: 写端到端验收清单**

验收场景必须包括：

1. 用户创建企业推广工作空间并导入资料。
2. 用户输入“找到本周机械设备客户并生成首周推广内容”。
3. 推广总控创建 run，数据抓取和产品卖点并行。
4. 数据清洗完成后，竞品洞察和商机评分并行。
5. 物料生成后进入内容质检。
6. 质检发现高风险表达时，run 进入审批状态。
7. 用户退回物料，只有物料和后续节点 stale。
8. 用户批准草稿，系统生成发布排期和人工发布待办。
9. 定时监控生成指标报告。
10. 复盘 Agent 生成下一轮策略建议。
11. 重启应用后仍能通过 run snapshot 恢复状态。
12. 用户取消 run 后，未完成任务停止，已生成 Artifact 保留。

- [ ] **Step 2: 运行官方测试和针对性测试**

Run: `npm test`

Run: `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 <all touched TypeScript files>`

Run: `npm run compile:electron`

Run: `npm run build`

Expected: 新增代码测试、changed-file lint、Electron 编译和 renderer build 全部通过；若全量 lint 因 legacy debt 失败，只报告与本次变更无关的既有错误。

- [ ] **Step 3: 手动验证 Electron 流程**

Run: `npm run electron:dev`

验证：

- 工作空间中能看到 Workflow 页面。
- 开始工作流后任务卡片实时变化。
- 关闭并重新打开页面后状态从 SQLite 恢复。
- 需要审批时不会自动调用外部发布。
- Cowork 聊天中不会声称未执行的 Agent 已经完成。
- OpenClaw 子会话存在时可以从任务卡片打开历史。

- [ ] **Step 4: 编写开发文档**

文档必须说明：

- 单 Agent 对话、逻辑工作流、OpenClaw 子会话三者区别。
- Promotion DAG 的节点和依赖。
- Artifact Schema 和证据要求。
- 任务状态迁移。
- 人工审批边界。
- 如何重试、恢复、取消和归档。
- 如何增加一个新的推广 Agent角色。
- 如何增加一个新的平台输出适配器。
- 如何查看 workflow events、task attempts 和子会话。

- [ ] **Step 5: 提交最终文档和验证结果**

```bash
git add docs/enterprise-lead-promotion-workflow.md README.md
git commit -m "docs(workflow): document promotion agent team"
```

## Acceptance Criteria

实现完成的最低标准：

- 运营推广工作流不是单纯的角色 Prompt，而是由可持久化 DAG 驱动。
- 独立节点可以并行执行，依赖节点不会提前执行。
- 每个 Agent 输出都经过角色级合同校验，并产生带 lineage 的 Artifact。
- run 可以 needs input、awaiting approval、resume、retry 和 cancel。
- 用户可以在工作台看到真实已执行的 Agent、任务状态、产物、风险和审批项。
- Cowork 聊天不会把角色路由伪装成真实多 Agent 执行。
- OpenClaw 子会话如果启用，能够关联到具体 run、task 和 role。
- 账户监控可以通过现有定时任务触发，并把指标传递给复盘 Agent。
- 真实外部动作仍然受人工审批和 draft-only 安全边界保护。
- 旧工作空间、旧 run 和 legacy workflow 不被破坏。

## Self-review

- Spec coverage: 角色分工、DAG 调度、共享状态、结构化交接、人工审批、Cowork 语义、OpenClaw 子会话、定时监控和验收均有对应任务。
- Placeholder scan: 计划没有使用未定义的负责人、日期或实现占位符；所有新增接口、文件和验证命令均已明确。
- Type consistency: `WorkflowArtifactRef`、`WorkflowTaskExecutionContext`、`WorkflowEvent`、`WorkflowExecutionAdapter` 和 `EnterpriseLeadWorkflowOrchestrator` 在任务间保持同名和同一职责。
- Compatibility: legacy `enabledAgentRoles`、旧 run snapshot、旧 subagent metadata 和 draft-only 外部动作边界均保留。
