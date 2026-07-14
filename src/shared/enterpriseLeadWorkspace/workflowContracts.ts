import type { EnterpriseLeadAgentRole } from './constants';

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

export const WorkflowOptionalNode = {
  SalesHandoffRequested: 'sales_handoff_requested',
  MonitoringRequested: 'monitoring_requested',
} as const;
export type WorkflowOptionalNode =
  (typeof WorkflowOptionalNode)[keyof typeof WorkflowOptionalNode];

export interface WorkflowStartOptions {
  enabledOptionalNodes: string[];
  maxConcurrency: number;
}

export const DEFAULT_WORKFLOW_START_OPTIONS: WorkflowStartOptions = {
  enabledOptionalNodes: [],
  maxConcurrency: 3,
};

export const WORKFLOW_REVIEW_FEEDBACK_MAX_LENGTH = 2_000;
export const WORKFLOW_HISTORY_MAX_ENTRIES = 200;

export const normalizeWorkflowReviewFeedback = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const feedback = value.trim();
  return feedback && feedback.length <= WORKFLOW_REVIEW_FEEDBACK_MAX_LENGTH ? feedback : null;
};

export const normalizeWorkflowStartOptions = (
  options?: Partial<WorkflowStartOptions>,
): WorkflowStartOptions => {
  const allowedOptionalNodes = new Set<string>(Object.values(WorkflowOptionalNode));
  const enabledOptionalNodes = Array.from(
    new Set(
      (options?.enabledOptionalNodes ?? []).filter(
        (node): node is WorkflowOptionalNode => allowedOptionalNodes.has(node),
      ),
    ),
  );
  const requestedConcurrency = options?.maxConcurrency;
  const maxConcurrency =
    typeof requestedConcurrency === 'number' && Number.isFinite(requestedConcurrency)
      ? Math.min(3, Math.max(1, Math.floor(requestedConcurrency)))
      : DEFAULT_WORKFLOW_START_OPTIONS.maxConcurrency;

  return { enabledOptionalNodes, maxConcurrency };
};

export const WorkflowEventType = {
  RunStarted: 'run_started',
  RunRetrying: 'run_retrying',
  TaskReady: 'task_ready',
  TaskStarted: 'task_started',
  TaskRetrying: 'task_retrying',
  TaskCompleted: 'task_completed',
  TaskFailed: 'task_failed',
  TaskBlocked: 'task_blocked',
  TaskCancelled: 'task_cancelled',
  ApprovalRequired: 'approval_required',
  ApprovalRejected: 'approval_rejected',
  RunCompleted: 'run_completed',
  RunCancelled: 'run_cancelled',
  RunError: 'run_error',
} as const;
export type WorkflowEventType = (typeof WorkflowEventType)[keyof typeof WorkflowEventType];

export interface WorkflowEvent {
  id?: string;
  runId: string;
  sequence: number;
  type: WorkflowEventType;
  taskId?: string;
  role?: string;
  summary?: string;
  createdAt: string;
}

export interface WorkflowEventProjection {
  runId: string;
  sequence: number;
  type: WorkflowEventType;
  taskId?: string;
  feedback?: string;
  createdAt: string;
}

export const projectWorkflowEventForRenderer = (
  event: WorkflowEvent & { payload?: unknown },
): WorkflowEventProjection => {
  const feedback = event.type === WorkflowEventType.ApprovalRejected
    && event.payload
    && typeof event.payload === 'object'
    && !Array.isArray(event.payload)
    ? normalizeWorkflowReviewFeedback((event.payload as Record<string, unknown>).feedback)
    : null;
  return {
    runId: event.runId,
    sequence: event.sequence,
    type: event.type,
    ...(event.taskId ? { taskId: event.taskId } : {}),
    ...(feedback ? { feedback } : {}),
    createdAt: event.createdAt,
  };
};

export function normalizeWorkflowArtifactRef(value: unknown): WorkflowArtifactRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const kind = typeof record.kind === 'string' ? record.kind.trim() : '';
  if (!id || !kind) return null;
  return {
    id,
    kind,
    schemaVersion:
      typeof record.schemaVersion === 'number' && Number.isFinite(record.schemaVersion)
        ? Math.max(1, Math.floor(record.schemaVersion))
        : 1,
    summary: typeof record.summary === 'string' ? record.summary.trim() : '',
    producerTaskId:
      typeof record.producerTaskId === 'string' ? record.producerTaskId.trim() : '',
    evidenceIds: Array.isArray(record.evidenceIds)
      ? record.evidenceIds
          .filter((item): item is string => typeof item === 'string')
          .map(item => item.trim())
          .filter(Boolean)
      : [],
  };
}
