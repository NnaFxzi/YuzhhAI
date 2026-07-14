import type { DomesticResearchConfig } from '../agent/domesticResearch';
import type { ExternalResearchConfig } from '../agent/externalResearch';
import type { ProviderConfig } from '../providers';
import type {
  EnterpriseLeadAgentRole,
  EnterpriseLeadContentOutputLengthPolicy,
  EnterpriseLeadContentOutputPlatformId,
  EnterpriseLeadDeliverableKind,
  EnterpriseLeadDocumentExtractionStage,
  EnterpriseLeadDocumentExtractionStatus,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadKnowledgeIndexStatus,
  EnterpriseLeadRiskLevel,
  EnterpriseLeadRunStatus,
  EnterpriseLeadTaskStatus,
  EnterpriseLeadTodoKind,
  EnterpriseLeadWorkspaceAgentCalibrationCheckId,
  EnterpriseLeadWorkspaceAgentSource,
  EnterpriseLeadWorkspaceType,
} from './constants';
import type {
  WorkflowArtifactRef,
  WorkflowEvent,
  WorkflowEventProjection,
  WorkflowExecutionMode,
} from './workflowContracts';

export interface EnterpriseLeadWorkflowArtifact {
  id: string;
  runId: string;
  taskId: string;
  kind: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
  evidenceIds: string[];
  createdAt: string;
}

export interface EnterpriseLeadWorkflowEvent extends WorkflowEvent {
  payload: Record<string, unknown>;
}

export type EnterpriseLeadWorkflowLiveEvent = WorkflowEventProjection;

export interface EnterpriseLeadTaskAttempt {
  id: string;
  taskId: string;
  attempt: number;
  executionMode: WorkflowExecutionMode;
  status: string;
  error: string;
  startedAt: string;
  endedAt: string | null;
}

export interface EnterpriseLeadWorkflowHistoryEvent extends WorkflowEventProjection {
  id: string;
}

export interface EnterpriseLeadWorkflowHistoryAttempt {
  id: string;
  taskId: string;
  attempt: number;
  executionMode: WorkflowExecutionMode;
  status: string;
  startedAt: string;
  endedAt: string | null;
}

export interface EnterpriseLeadWorkflowHistory {
  events: EnterpriseLeadWorkflowHistoryEvent[];
  attempts: EnterpriseLeadWorkflowHistoryAttempt[];
}

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
  confirmedKnowledgeKeys?: string[];
  ignoredKnowledgeKeys?: string[];
}

export interface EnterpriseLeadExtractionSource {
  id?: string;
  kind: EnterpriseLeadExtractionSourceKind | string;
  label: string;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  text?: string;
  summary?: string;
  extractionStatus?: EnterpriseLeadDocumentExtractionStatus | string;
  extractionError?: string;
  extractionProgressCurrent?: number;
  extractionProgressTotal?: number;
  extractionStage?: EnterpriseLeadDocumentExtractionStage | string;
  extractionPartial?: boolean;
  lastExtractedAt?: string;
  vectorIndexStatus?: EnterpriseLeadKnowledgeIndexStatus | string;
  vectorIndexError?: string;
  vectorIndexedAt?: string;
  vectorChunkCount?: number;
  vectorEmbeddingVersion?: string;
  extractedKnowledgeKeys?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface EnterpriseLeadWorkspaceAgentOverrides {
  name?: string;
  description?: string;
  identity?: string;
  systemPrompt?: string;
  icon?: string;
  model?: string;
  skillIds?: string[];
}

export interface EnterpriseLeadWorkspaceAgentBinding {
  agentId: string;
  source?: EnterpriseLeadWorkspaceAgentSource;
  templateId?: string;
  enabled: boolean;
  order: number;
  name?: string;
  description?: string;
  identity?: string;
  systemPrompt?: string;
  icon?: string;
  model?: string;
  skillIds?: string[];
  overrides: EnterpriseLeadWorkspaceAgentOverrides;
}

export interface EnterpriseLeadWorkspaceRunAgentSnapshot {
  agentId: string;
  name: string;
  description: string;
  identity: string;
  systemPrompt: string;
  icon: string;
  model: string;
  skillIds: string[];
}

export type EnterpriseLeadTaskAgentRole = EnterpriseLeadAgentRole | string;

export interface EnterpriseLeadWorkspaceDraft {
  id?: string;
  name: string;
  type: EnterpriseLeadWorkspaceType | string;
  profile: EnterpriseLeadWorkspaceProfile;
  source: EnterpriseLeadExtractionSource;
  extractionSources?: EnterpriseLeadExtractionSource[];
  enabledAgentRoles: Array<EnterpriseLeadAgentRole | string>;
  settings?: EnterpriseLeadWorkspaceSettings;
  workspaceAgents: EnterpriseLeadWorkspaceAgentBinding[];
  createdAt?: string;
}

export interface EnterpriseLeadWorkspaceModelSettings {
  defaultModel: string;
  defaultModelProvider: string;
  providers: Record<string, ProviderConfig>;
}

export interface EnterpriseLeadWorkspaceContentPlatformConfig {
  id: EnterpriseLeadContentOutputPlatformId | string;
  enabled: boolean;
  deliveryMode: string;
  account: string;
  endpoint: string;
  token: string;
  appId: string;
  payloadFormat: string;
}

export interface EnterpriseLeadWorkspaceContentOutputRules {
  defaultPlatformId: EnterpriseLeadContentOutputPlatformId | string;
  lengthPolicy: EnterpriseLeadContentOutputLengthPolicy | string;
  riskCheckBeforeExport: boolean;
  variablePlaceholders: string[];
  archiveOutputs: boolean;
}

export interface EnterpriseLeadWorkspaceContentPlatformSettings {
  platforms: Record<string, EnterpriseLeadWorkspaceContentPlatformConfig>;
  outputRules: EnterpriseLeadWorkspaceContentOutputRules;
}

export interface EnterpriseLeadWorkspaceOutputPreferences {
  instructions: string[];
}

export interface EnterpriseLeadWorkspaceSettings {
  model: EnterpriseLeadWorkspaceModelSettings;
  skillIds: string[];
  externalResearch: ExternalResearchConfig;
  domesticResearch: DomesticResearchConfig;
  contentPlatforms: EnterpriseLeadWorkspaceContentPlatformSettings;
  outputPreferences: EnterpriseLeadWorkspaceOutputPreferences;
}

export interface EnterpriseLeadWorkspaceSettingsUpdate {
  enabledAgentRoles?: Array<EnterpriseLeadAgentRole | string>;
  workspaceAgents?: EnterpriseLeadWorkspaceAgentBinding[];
  settings?: Partial<{
    model: Partial<EnterpriseLeadWorkspaceModelSettings>;
    skillIds: string[];
    externalResearch: Partial<ExternalResearchConfig>;
    domesticResearch: Partial<DomesticResearchConfig>;
    outputPreferences: Partial<EnterpriseLeadWorkspaceOutputPreferences>;
  }>;
}

export type EnterpriseLeadWorkspaceNormalizedSettingsUpdate = Omit<
  EnterpriseLeadWorkspaceSettingsUpdate,
  'settings'
> & {
  settings?: EnterpriseLeadWorkspaceSettings;
};

export interface EnterpriseLeadWorkspace {
  id: string;
  name: string;
  type: EnterpriseLeadWorkspaceType | string;
  profile: EnterpriseLeadWorkspaceProfile;
  extractionSources: EnterpriseLeadExtractionSource[];
  riskRules: string[];
  enabledAgentRoles: Array<EnterpriseLeadAgentRole | string>;
  settings: EnterpriseLeadWorkspaceSettings;
  workspaceAgents: EnterpriseLeadWorkspaceAgentBinding[];
  recentRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnterpriseLeadWorkspaceRunSummary {
  run: EnterpriseLeadRun;
  taskCount: number;
  deliverableCount: number;
  todoCount: number;
  riskCount: number;
}

export interface EnterpriseLeadWorkspaceAgentCalibrationDraft {
  name: string;
  description: string;
  identity: string;
  systemPrompt: string;
  icon: string;
  model: string;
  skillIds: string[];
}

export interface EnterpriseLeadWorkspaceAgentCalibrationExample {
  sampleInput: string;
  expectedPriority: string;
  expectedReason: string;
  expectedMissing: string;
  expectedNextStep: string;
}

export interface EnterpriseLeadWorkspaceAgentCalibrationRequest {
  agentId?: string;
  agent: EnterpriseLeadWorkspaceAgentCalibrationDraft;
  example: EnterpriseLeadWorkspaceAgentCalibrationExample;
}

export interface EnterpriseLeadWorkspaceAgentCalibrationCheck {
  id: EnterpriseLeadWorkspaceAgentCalibrationCheckId;
  passed: boolean;
}

export interface EnterpriseLeadWorkspaceAgentCalibrationResponse {
  content: string;
  checks: EnterpriseLeadWorkspaceAgentCalibrationCheck[];
}

export interface EnterpriseLeadRun {
  id: string;
  workspaceId: string;
  userGoal: string;
  status: EnterpriseLeadRunStatus;
  workflowVersion?: string;
  currentRole: EnterpriseLeadTaskAgentRole | null;
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
  role?: EnterpriseLeadTaskAgentRole;
  deliverableId?: string;
}

export interface EnterpriseLeadRiskItem {
  level: EnterpriseLeadRiskLevel | string;
  title: string;
  description: string;
  role?: EnterpriseLeadTaskAgentRole;
}

export interface EnterpriseLeadAgentTaskResult {
  role: EnterpriseLeadTaskAgentRole;
  summary: string;
  outputs: Record<string, unknown>;
  artifactRefs?: WorkflowArtifactRef[];
  missingInfo: string[];
  todos: EnterpriseLeadTodoInput[];
  risks: EnterpriseLeadRiskItem[];
  handoffContext: Record<string, unknown>;
  status: EnterpriseLeadTaskStatus | string;
}

export interface EnterpriseLeadAgentTask {
  id: string;
  runId: string;
  role: EnterpriseLeadTaskAgentRole;
  nodeId?: string;
  dependsOnTaskIds?: string[];
  attempt?: number;
  executionMode?: WorkflowExecutionMode;
  artifactRefs?: WorkflowArtifactRef[];
  workspaceAgentId: string | null;
  agentSnapshot: EnterpriseLeadWorkspaceRunAgentSnapshot | null;
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
  role: EnterpriseLeadTaskAgentRole;
  userMessage: string;
  summary: string;
  taskStatus?: EnterpriseLeadTaskStatus;
  outputPayload: Record<string, unknown>;
  artifactRefs?: WorkflowArtifactRef[];
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
  role: EnterpriseLeadTaskAgentRole;
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
  role: EnterpriseLeadTaskAgentRole | null;
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
  workflowHistory?: EnterpriseLeadWorkflowHistory;
}

export interface EnterpriseLeadIpcResult<T> {
  success: boolean;
  error?: string;
  data?: T;
}
