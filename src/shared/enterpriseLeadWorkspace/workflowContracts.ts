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

export interface WorkflowStartOptions {
  enabledOptionalNodes: string[];
  maxConcurrency: number;
}

export interface WorkflowEvent {
  runId: string;
  sequence: number;
  type:
    | 'run_started'
    | 'task_ready'
    | 'task_started'
    | 'task_retrying'
    | 'task_completed'
    | 'task_failed'
    | 'task_blocked'
    | 'approval_required'
    | 'approval_rejected'
    | 'run_completed'
    | 'run_cancelled'
    | 'run_error';
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
