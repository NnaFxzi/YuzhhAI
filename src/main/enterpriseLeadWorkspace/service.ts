import { randomUUID } from 'crypto';

import {
  DomesticResearchMode,
  type DomesticResearchSourceId as DomesticResearchSourceIdValue,
  DomesticResearchSourceIds,
} from '../../shared/agent/domesticResearch';
import {
  AgentExternalResearchMode,
  type ExternalResearchProviderConfig,
  ExternalResearchProviderId,
  type ExternalResearchProviderId as ExternalResearchProviderIdValue,
  redactExternalResearchSecret,
} from '../../shared/agent/externalResearch';
import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadDeliverableKind,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadRiskLevel,
  EnterpriseLeadRunStatus,
  EnterpriseLeadTaskStatus,
  EnterpriseLeadTodoKind,
  EnterpriseLeadWorkspaceType,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadAgentTaskResult,
  EnterpriseLeadArchive,
  EnterpriseLeadDeliverable,
  EnterpriseLeadPendingVersion,
  EnterpriseLeadRun,
  EnterpriseLeadTaskAgentRole,
  EnterpriseLeadTodo,
  EnterpriseLeadTodoInput,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
  EnterpriseLeadWorkspaceChatMessage,
  EnterpriseLeadWorkspaceChatRequest,
  EnterpriseLeadWorkspaceChatResearchIntent,
  EnterpriseLeadWorkspaceChatResearchResult,
  EnterpriseLeadWorkspaceChatResponse,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceProfile,
  EnterpriseLeadWorkspaceRunAgentSnapshot,
  EnterpriseLeadWorkspaceRunSummary,
  EnterpriseLeadWorkspaceSettingsUpdate,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../shared/enterpriseLeadWorkspace/types';
import {
  normalizeAgentTaskResultInput,
  normalizeWorkspaceChatResearchIntent,
  normalizeWorkspaceDraftInput,
} from '../../shared/enterpriseLeadWorkspace/validation';
import type { ModelClientAdapter } from '../industryPack/modelClientAdapter';
import { resolveRawApiConfigFromAppConfig } from '../libs/claudeSettings';
import { parseModelJsonObject } from './modelJson';
import {
  buildAgentChatPrompt,
  buildAgentTaskPrompt,
  buildWorkspaceChatResearchIntentPrompt,
  buildWorkspaceChatResponsePrompt,
  buildWorkspaceExtractionPrompt,
  type WorkspaceChatAgentPromptSummary,
} from './promptTemplates';
import type {
  CreateEnterpriseLeadTaskInput,
  EnterpriseLeadWorkspaceStore,
} from './store';
import {
  buildDefaultEnterpriseLeadWorkspaceAgents,
  ENTERPRISE_LEAD_AGENT_WORKFLOW,
  getEnterpriseLeadAgentMetadata,
} from './workflow';

interface EnterpriseLeadWorkspaceServiceOptions {
  store: EnterpriseLeadWorkspaceStore;
  modelClient: ModelClientAdapter;
  agentProvider?: EnterpriseLeadWorkspaceAgentProvider;
  researchClient?: EnterpriseLeadWorkspaceResearchClient;
}

export interface EnterpriseLeadWorkspaceAgentTemplate {
  id: string;
  name: string;
  description?: string;
  identity?: string;
  systemPrompt?: string;
  icon?: string;
  model?: string;
  skillIds?: string[];
  enabled?: boolean;
}

export interface EnterpriseLeadWorkspaceAgentProvider {
  listAgents(): EnterpriseLeadWorkspaceAgentTemplate[];
  getAgent(agentId: string): EnterpriseLeadWorkspaceAgentTemplate | null;
}

export interface EnterpriseLeadWorkspaceResearchClient {
  tavilySearch(apiKey: string, query: string, maxResults: number): Promise<unknown>;
  tavilyExtract(apiKey: string, urls: string[], query?: string): Promise<unknown>;
  firecrawlSearch(apiKey: string, query: string, maxResults: number): Promise<unknown>;
  firecrawlScrape(apiKey: string, url: string): Promise<unknown>;
  domesticSearch(sourceId: string, query: string, maxResults: number): Promise<unknown>;
}

const noopAgentProvider: EnterpriseLeadWorkspaceAgentProvider = {
  listAgents: () => [],
  getAgent: () => null,
};

const noopResearchClient: EnterpriseLeadWorkspaceResearchClient = {
  tavilySearch: async () => ({}),
  tavilyExtract: async () => ({}),
  firecrawlSearch: async () => ({}),
  firecrawlScrape: async () => ({}),
  domesticSearch: async () => ({}),
};

const WorkspaceChatResearchStatus = {
  Skipped: 'skipped',
  Completed: 'completed',
  Failed: 'failed',
} as const;

const RESEARCH_PROMPT_PAYLOAD_TEXT_LIMIT = 2_000;
const RESEARCH_PROMPT_PAYLOAD_ITEM_LIMIT = 24;
const sensitiveResearchPayloadKeyPattern =
  /(api.?key|secret|token|authorization|cookie|password|credential|raw|html)/i;

const workflowRoles = (): EnterpriseLeadAgentRole[] =>
  ENTERPRISE_LEAD_AGENT_WORKFLOW.map(item => item.role);

const isEnterpriseLeadTaskStatus = (value: string): value is EnterpriseLeadTaskStatus =>
  Object.values(EnterpriseLeadTaskStatus).includes(value as EnterpriseLeadTaskStatus);

const isEnterpriseLeadTodoKind = (value: string): value is EnterpriseLeadTodoKind =>
  Object.values(EnterpriseLeadTodoKind).includes(value as EnterpriseLeadTodoKind);

const isEnterpriseLeadAgentRole = (value: string): value is EnterpriseLeadAgentRole =>
  Object.values(EnterpriseLeadAgentRole).includes(value as EnterpriseLeadAgentRole);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const getUpstreamTasks = (
  tasks: EnterpriseLeadAgentTask[],
  task: EnterpriseLeadAgentTask,
): EnterpriseLeadAgentTask[] => {
  const taskIndex = tasks.findIndex(item => item.id === task.id);
  if (taskIndex === -1) {
    return [];
  }

  return tasks.slice(0, taskIndex);
};

const getTaskTitle = (task: EnterpriseLeadAgentTask): string => {
  if (task.agentSnapshot?.name) {
    return task.agentSnapshot.name;
  }
  if (isEnterpriseLeadAgentRole(task.role)) {
    return getEnterpriseLeadAgentMetadata(task.role).title;
  }
  return task.role;
};

const getDeliverableKind = (
  role: EnterpriseLeadTaskAgentRole,
): EnterpriseLeadDeliverable['kind'] => {
  switch (role) {
    case EnterpriseLeadAgentRole.ProductUnderstanding:
      return EnterpriseLeadDeliverableKind.ProductProfile;
    case EnterpriseLeadAgentRole.OpportunityRadar:
      return EnterpriseLeadDeliverableKind.OpportunityReport;
    case EnterpriseLeadAgentRole.ContentPlanning:
      return EnterpriseLeadDeliverableKind.ContentDraft;
    case EnterpriseLeadAgentRole.SocialOperation:
      return EnterpriseLeadDeliverableKind.SocialPlan;
    case EnterpriseLeadAgentRole.SalesHandoff:
      return EnterpriseLeadDeliverableKind.SalesHandoff;
    case EnterpriseLeadAgentRole.RiskReview:
      return EnterpriseLeadDeliverableKind.RiskReview;
    case EnterpriseLeadAgentRole.ProjectSummary:
      return EnterpriseLeadDeliverableKind.FinalSummary;
    default:
      return EnterpriseLeadDeliverableKind.FinalSummary;
  }
};

const sanitizeTaskResult = (
  result: EnterpriseLeadAgentTaskResult,
  task: EnterpriseLeadAgentTask,
): EnterpriseLeadAgentTaskResult => ({
  ...result,
  role: task.role,
  status: isEnterpriseLeadTaskStatus(result.status)
    ? result.status
    : EnterpriseLeadTaskStatus.NeedsInput,
});

const resolveWorkspaceApiConfig = (workspace: EnterpriseLeadWorkspace) =>
  resolveRawApiConfigFromAppConfig({
    model: {
      defaultModel: workspace.settings.model.defaultModel,
      defaultModelProvider: workspace.settings.model.defaultModelProvider,
    },
    providers: workspace.settings.model.providers,
  }).config ?? undefined;

export class EnterpriseLeadWorkspaceService {
  private readonly store: EnterpriseLeadWorkspaceStore;

  private readonly modelClient: ModelClientAdapter;

  private readonly agentProvider: EnterpriseLeadWorkspaceAgentProvider;

  private readonly researchClient: EnterpriseLeadWorkspaceResearchClient;

  constructor(options: EnterpriseLeadWorkspaceServiceOptions) {
    this.store = options.store;
    this.modelClient = options.modelClient;
    this.agentProvider = options.agentProvider ?? noopAgentProvider;
    this.researchClient = options.researchClient ?? noopResearchClient;
  }

  listWorkspaces(): EnterpriseLeadWorkspace[] {
    return this.store.listWorkspaces();
  }

  getWorkspace(id: string): EnterpriseLeadWorkspace | null {
    return this.store.getWorkspace(id);
  }

  async extractDraftFromConversation(sourceText: string): Promise<EnterpriseLeadWorkspaceDraft> {
    const sourceLabel = '对话输入';
    const result = await this.modelClient.generate({
      prompt: buildWorkspaceExtractionPrompt({ sourceText, sourceLabel }),
    });
    const draft = normalizeWorkspaceDraftInput(parseModelJsonObject(result.text));

    return {
      ...draft,
      source: {
        kind: EnterpriseLeadExtractionSourceKind.Conversation,
        label: sourceLabel,
        text: sourceText,
      },
    };
  }

  createWorkspace(draft: unknown): EnterpriseLeadWorkspace {
    const normalizedDraft = normalizeWorkspaceDraftInput(draft);
    const workspaceAgents = normalizedDraft.workspaceAgents.length > 0
      ? normalizedDraft.workspaceAgents
      : buildDefaultEnterpriseLeadWorkspaceAgents(workflowRoles());

    return this.store.createWorkspace({
      name: normalizedDraft.name,
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile: normalizedDraft.profile,
      extractionSources: [normalizedDraft.source],
      enabledAgentRoles: workflowRoles(),
      settings: normalizedDraft.settings,
      workspaceAgents,
    });
  }

  deleteWorkspace(workspaceId: string): boolean {
    return this.store.deleteWorkspace(workspaceId);
  }

  updateWorkspaceSettings(
    workspaceId: string,
    input: EnterpriseLeadWorkspaceSettingsUpdate,
  ): EnterpriseLeadWorkspace {
    return this.store.updateWorkspaceSettings(workspaceId, input);
  }

  updateWorkspaceProfile(
    workspaceId: string,
    profile: EnterpriseLeadWorkspaceProfile,
  ): EnterpriseLeadWorkspace {
    return this.store.updateWorkspaceProfile(workspaceId, profile);
  }

  updateWorkspaceAgents(
    workspaceId: string,
    agents: EnterpriseLeadWorkspaceAgentBinding[],
  ): EnterpriseLeadWorkspace {
    return this.store.updateWorkspaceAgents(workspaceId, agents);
  }

  listRuns(workspaceId: string): EnterpriseLeadWorkspaceRunSummary[] {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    return this.store.listRuns(workspaceId).map(run => {
      const tasks = this.store.listTasks(run.id);
      return {
        run,
        taskCount: tasks.length,
        deliverableCount: this.deriveDeliverables(workspace, run, tasks).length,
        todoCount: this.deriveTodos(workspace, run, tasks).length,
        riskCount: tasks.reduce((count, task) => count + task.risks.length, 0),
      };
    });
  }

  async chat(
    workspaceId: string,
    request: EnterpriseLeadWorkspaceChatRequest,
  ): Promise<EnterpriseLeadWorkspaceChatResponse> {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    const effectiveAgents = this.resolveEffectiveWorkspaceAgents(workspace);
    const targetAgent = this.resolveTargetAgent(request.targetAgentId, effectiveAgents);
    const recentMessages = this.sanitizeRecentMessages(workspace, request.recentMessages ?? []);
    const recentRunOutputs = this.collectRecentRunOutputs(workspace);
    const apiConfig = resolveWorkspaceApiConfig(workspace);
    const intentResult = await this.modelClient.generate({
      prompt: buildWorkspaceChatResearchIntentPrompt({
        workspace,
        effectiveAgents,
        targetAgent,
        recentMessages,
        userMessage: request.message,
        recentRunOutputs,
      }),
      apiConfig,
      ...(targetAgent?.model ? { model: targetAgent.model } : {}),
    });
    const researchIntent = this.parseResearchIntent(intentResult.text);
    const research = await this.executeResearch(workspace, researchIntent);
    const answer = await this.modelClient.generate({
      prompt: buildWorkspaceChatResponsePrompt({
        workspace,
        effectiveAgents,
        targetAgent,
        recentMessages,
        userMessage: request.message,
        recentRunOutputs,
        researchResult: this.sanitizeResearchForPrompt(workspace, research),
      }),
      apiConfig,
      ...(targetAgent?.model ? { model: targetAgent.model } : {}),
    });

    return {
      message: {
        id: randomUUID(),
        role: 'assistant',
        content: answer.text.trim(),
        createdAt: new Date().toISOString(),
        research,
      },
    };
  }

  createRun(workspaceId: string, userGoal: string): EnterpriseLeadWorkspaceSnapshot {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }
    const dynamicTasks = this.resolveRunTasksForWorkspace(workspace);
    const run = dynamicTasks.length > 0
      ? this.store.createRun({
          workspaceId,
          userGoal,
          tasks: dynamicTasks,
        })
      : this.store.createRun({
          workspaceId,
          userGoal,
          roles: this.resolveLegacyRunRoles(workspace),
        });

    return this.getSnapshot(workspaceId, run.id);
  }

  async runTask(taskId: string): Promise<EnterpriseLeadAgentTask> {
    const taskContext = this.getTaskContext(taskId);
    const taskModel = taskContext.task.agentSnapshot?.model.trim();
    const result = await this.modelClient.generate({
      prompt: buildAgentTaskPrompt(taskContext),
      apiConfig: resolveWorkspaceApiConfig(taskContext.workspace),
      ...(taskModel ? { model: taskModel } : {}),
    });
    const normalizedResult = sanitizeTaskResult(
      normalizeAgentTaskResultInput(parseModelJsonObject(result.text)),
      taskContext.task,
    );

    this.store.updateTaskResult(taskId, normalizedResult);
    const updatedTask = this.store.getTask(taskId);
    if (!updatedTask) {
      throw new Error('Enterprise lead Agent task disappeared after update');
    }

    return updatedTask;
  }

  async rerunTask(taskId: string): Promise<EnterpriseLeadAgentTask> {
    return this.runTask(taskId);
  }

  async runWorkflow(workspaceId: string, runId: string): Promise<EnterpriseLeadWorkspaceSnapshot> {
    const run = this.getRunForWorkspace(workspaceId, runId);
    const tasks = this.store.listTasks(run.id);

    for (const task of tasks) {
      if (task.status === EnterpriseLeadTaskStatus.Completed && !task.stale) {
        continue;
      }

      const taskTitle = getTaskTitle(task);
      this.store.updateRunProgress({
        runId: run.id,
        status: EnterpriseLeadRunStatus.Running,
        currentRole: task.role,
        controllerSummary: `${taskTitle} 正在处理。`,
      });

      const updatedTask = await this.runTask(task.id);
      if (updatedTask.status !== EnterpriseLeadTaskStatus.Completed) {
        const updatedTaskTitle = getTaskTitle(updatedTask);
        this.store.updateRunProgress({
          runId: run.id,
          status: this.mapTaskStatusToRunStatus(updatedTask.status),
          currentRole: updatedTask.role,
          controllerSummary: updatedTask.summary || `${updatedTaskTitle} 需要人工确认后继续。`,
        });
        return this.getSnapshot(workspaceId, run.id);
      }
    }

    this.store.updateRunProgress({
      runId: run.id,
      status: EnterpriseLeadRunStatus.Completed,
      currentRole: null,
      controllerSummary: '总控已完成本次获客任务。',
    });

    return this.getSnapshot(workspaceId, run.id);
  }

  async createPendingVersionFromChat(
    taskId: string,
    userMessage: string,
  ): Promise<EnterpriseLeadPendingVersion> {
    const taskContext = this.getTaskContext(taskId);
    const taskModel = taskContext.task.agentSnapshot?.model.trim();
    const result = await this.modelClient.generate({
      prompt: buildAgentChatPrompt({
        ...taskContext,
        userMessage,
      }),
      apiConfig: resolveWorkspaceApiConfig(taskContext.workspace),
      ...(taskModel ? { model: taskModel } : {}),
    });
    const normalizedResult = sanitizeTaskResult(
      normalizeAgentTaskResultInput(parseModelJsonObject(result.text)),
      taskContext.task,
    );

    return this.store.createPendingVersion({
      taskId,
      userMessage,
      summary: normalizedResult.summary,
      outputPayload: normalizedResult.outputs,
      missingInfo: normalizedResult.missingInfo,
      todos: normalizedResult.todos,
      risks: normalizedResult.risks,
      handoffContext: normalizedResult.handoffContext,
    });
  }

  applyPendingVersion(pendingVersionId: string): EnterpriseLeadWorkspaceSnapshot {
    const pendingVersion = this.store.applyPendingVersion(pendingVersionId);
    return this.getSnapshot(pendingVersion.workspaceId, pendingVersion.runId);
  }

  archiveRun(workspaceId: string, runId: string): EnterpriseLeadWorkspaceSnapshot {
    const runToArchive = this.getRunForWorkspace(workspaceId, runId);
    if (runToArchive.status !== EnterpriseLeadRunStatus.Completed) {
      throw new Error('Enterprise lead run must be completed before archive');
    }
    this.assertRunHasNoBlockingRiskReview(runToArchive.id);
    const run = this.store.archiveRun(workspaceId, runId);
    return this.getSnapshot(workspaceId, run.id);
  }

  getSnapshot(workspaceId: string, runId?: string): EnterpriseLeadWorkspaceSnapshot {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    const currentRun = this.getCurrentRun(workspace, runId);
    const tasks = currentRun ? this.store.listTasks(currentRun.id) : [];
    const pendingVersions = currentRun ? this.store.listPendingVersions(currentRun.id) : [];

    return {
      workspace,
      currentRun,
      tasks,
      pendingVersions,
      deliverables: currentRun ? this.deriveDeliverables(workspace, currentRun, tasks) : [],
      todos: currentRun ? this.deriveTodos(workspace, currentRun, tasks) : [],
      archives: this.deriveArchives(workspace),
    };
  }

  private resolveLegacyRunRoles(workspace: EnterpriseLeadWorkspace): EnterpriseLeadAgentRole[] {
    const selectedRoles = workspace.enabledAgentRoles.filter(isEnterpriseLeadAgentRole);
    return selectedRoles.length > 0 ? selectedRoles : workflowRoles();
  }

  private resolveRunTasksForWorkspace(
    workspace: EnterpriseLeadWorkspace,
  ): CreateEnterpriseLeadTaskInput[] {
    return this.resolveEffectiveWorkspaceAgents(workspace).map(agent => ({
      role: agent.id,
      workspaceAgentId: agent.id,
      agentSnapshot: this.toRunAgentSnapshot(agent),
    }));
  }

  private toRunAgentSnapshot(
    agent: WorkspaceChatAgentPromptSummary,
  ): EnterpriseLeadWorkspaceRunAgentSnapshot {
    return {
      agentId: agent.id,
      name: agent.name,
      description: agent.description,
      identity: agent.identity,
      systemPrompt: agent.systemPrompt,
      icon: agent.icon,
      model: agent.model,
      skillIds: agent.skillIds,
    };
  }

  private resolveEffectiveWorkspaceAgents(
    workspace: EnterpriseLeadWorkspace,
  ): WorkspaceChatAgentPromptSummary[] {
    const workspaceAgents = workspace.workspaceAgents.length > 0
      ? workspace.workspaceAgents
      : buildDefaultEnterpriseLeadWorkspaceAgents(this.resolveLegacyRunRoles(workspace));

    return [...workspaceAgents]
      .filter(binding => binding.enabled)
      .sort((left, right) => left.order - right.order)
      .map(binding => this.mergeWorkspaceAgentBinding(binding))
      .filter((agent): agent is WorkspaceChatAgentPromptSummary => Boolean(agent));
  }

  private mergeWorkspaceAgentBinding(
    binding: EnterpriseLeadWorkspaceAgentBinding,
  ): WorkspaceChatAgentPromptSummary | null {
    const overrides = binding.overrides;
    const name = overrides.name ?? binding.name ?? binding.agentId;
    return {
      id: binding.agentId,
      name,
      description: overrides.description ?? binding.description ?? '',
      identity: overrides.identity ?? binding.identity ?? '',
      systemPrompt: overrides.systemPrompt ?? binding.systemPrompt ?? '',
      icon: overrides.icon ?? binding.icon ?? '',
      model: overrides.model ?? binding.model ?? '',
      skillIds: overrides.skillIds ?? binding.skillIds ?? [],
    };
  }

  private resolveTargetAgent(
    targetAgentId: string | undefined,
    effectiveAgents: WorkspaceChatAgentPromptSummary[],
  ): WorkspaceChatAgentPromptSummary | null {
    const targetId = targetAgentId?.trim();
    if (!targetId) {
      return null;
    }

    return effectiveAgents.find(agent => agent.id === targetId) ?? null;
  }

  private sanitizeRecentMessages(
    workspace: EnterpriseLeadWorkspace,
    messages: EnterpriseLeadWorkspaceChatMessage[],
  ): EnterpriseLeadWorkspaceChatMessage[] {
    return messages
      .filter(message => message.role === 'user' || message.role === 'assistant')
      .slice(-12)
      .map(message => {
        const sanitized: EnterpriseLeadWorkspaceChatMessage = {
          id: message.id,
          role: message.role,
          content: message.content.slice(0, 4_000),
          createdAt: message.createdAt,
        };
        if (message.research) {
          sanitized.research = this.sanitizeRecentResearch(workspace, message.research);
        }
        return sanitized;
      });
  }

  private sanitizeRecentResearch(
    workspace: EnterpriseLeadWorkspace,
    research: EnterpriseLeadWorkspaceChatResearchResult,
  ): EnterpriseLeadWorkspaceChatResearchResult {
    return {
      intent: research.intent,
      status: research.status,
      ...(research.provider ? { provider: research.provider } : {}),
      summary: this.redactWorkspaceResearchText(workspace, research.summary).slice(0, 1_000),
    };
  }

  private sanitizeResearchForPrompt(
    workspace: EnterpriseLeadWorkspace,
    research: EnterpriseLeadWorkspaceChatResearchResult,
  ): EnterpriseLeadWorkspaceChatResearchResult {
    const sanitized: EnterpriseLeadWorkspaceChatResearchResult = {
      intent: research.intent,
      status: research.status,
      ...(research.provider ? { provider: research.provider } : {}),
      summary: this.redactWorkspaceResearchText(workspace, research.summary).slice(0, 1_000),
    };
    const payloadSummary = this.summarizeResearchPayloadForPrompt(research.payload);
    if (payloadSummary) {
      sanitized.payload = {
        dataSummary: payloadSummary,
      };
    }
    return sanitized;
  }

  private summarizeResearchPayloadForPrompt(payload: unknown): string {
    const items: string[] = [];
    const seen = new WeakSet<object>();

    const addText = (value: string): void => {
      const text = value.replace(/\s+/g, ' ').trim();
      if (!text) return;
      const currentLength = items.join('\n').length;
      if (currentLength >= RESEARCH_PROMPT_PAYLOAD_TEXT_LIMIT) return;
      const remaining = RESEARCH_PROMPT_PAYLOAD_TEXT_LIMIT - currentLength;
      items.push(text.slice(0, remaining));
    };

    const visit = (value: unknown, key?: string): void => {
      if (items.length >= RESEARCH_PROMPT_PAYLOAD_ITEM_LIMIT) {
        return;
      }
      if (key && sensitiveResearchPayloadKeyPattern.test(key)) {
        return;
      }
      if (typeof value === 'string') {
        addText(value);
        return;
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        addText(String(value));
        return;
      }
      if (!value || typeof value !== 'object') {
        return;
      }
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
      if (Array.isArray(value)) {
        value.slice(0, RESEARCH_PROMPT_PAYLOAD_ITEM_LIMIT).forEach(item => visit(item));
        return;
      }
      Object.entries(value)
        .slice(0, RESEARCH_PROMPT_PAYLOAD_ITEM_LIMIT)
        .forEach(([entryKey, entryValue]) => visit(entryValue, entryKey));
    };

    visit(payload);
    return items.join('\n').slice(0, RESEARCH_PROMPT_PAYLOAD_TEXT_LIMIT);
  }

  private redactWorkspaceResearchText(
    workspace: EnterpriseLeadWorkspace | undefined,
    text: string,
  ): string {
    if (!workspace) {
      return text;
    }
    return redactExternalResearchSecret(text, this.getWorkspaceResearchSecrets(workspace));
  }

  private getWorkspaceResearchSecrets(workspace: EnterpriseLeadWorkspace): string[] {
    return Object.values(workspace.settings.externalResearch.providers)
      .map(provider => provider.apiKey.trim())
      .filter(Boolean);
  }

  private collectRecentRunOutputs(workspace: EnterpriseLeadWorkspace): unknown[] {
    if (!workspace.recentRunId) {
      return [];
    }

    const run = this.store.getRun(workspace.recentRunId);
    if (!run || run.workspaceId !== workspace.id) {
      return [];
    }

    return this.store.listTasks(run.id)
      .filter(task => task.summary.trim() || Object.keys(task.outputPayload).length > 0)
      .slice(0, 12)
      .map(task => ({
        role: task.role,
        agentName: task.agentSnapshot?.name,
        workspaceAgentId: task.workspaceAgentId,
        status: task.status,
        summary: task.summary.slice(0, 1_000),
        outputSummary: this.summarizeResearchPayloadForPrompt(task.outputPayload),
        missingInfoSummary: this.summarizeResearchPayloadForPrompt(task.missingInfo),
        todoSummary: this.summarizeResearchPayloadForPrompt(task.todos),
        riskSummary: this.summarizeResearchPayloadForPrompt(task.risks),
      }));
  }

  private parseResearchIntent(modelText: string): EnterpriseLeadWorkspaceChatResearchIntent {
    try {
      const parsed = parseModelJsonObject(modelText);
      const rawIntent = isRecord(parsed) ? parsed.researchIntent : undefined;
      return normalizeWorkspaceChatResearchIntent(rawIntent);
    } catch {
      return { kind: 'none' };
    }
  }

  private async executeResearch(
    workspace: EnterpriseLeadWorkspace,
    intent: EnterpriseLeadWorkspaceChatResearchIntent,
  ): Promise<EnterpriseLeadWorkspaceChatResearchResult> {
    if (intent.kind === 'none') {
      return {
        intent,
        status: WorkspaceChatResearchStatus.Skipped,
        summary: 'No external research was requested.',
      };
    }

    try {
      if (intent.kind === 'search') {
        return await this.executeSearchResearch(workspace, intent);
      }
      if (intent.kind === 'extract') {
        return await this.executeExtractResearch(workspace, intent);
      }
      if (intent.kind === 'domestic_search') {
        return await this.executeDomesticSearchResearch(workspace, intent);
      }
      return await this.executeDomesticStatusResearch(workspace, intent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        intent,
        status: WorkspaceChatResearchStatus.Failed,
        summary: this.redactWorkspaceResearchText(workspace, message),
      };
    }
  }

  private async executeSearchResearch(
    workspace: EnterpriseLeadWorkspace,
    intent: Extract<EnterpriseLeadWorkspaceChatResearchIntent, { kind: 'search' }>,
  ): Promise<EnterpriseLeadWorkspaceChatResearchResult> {
    const provider = this.selectSearchProvider(workspace, intent.provider);
    if (!provider) {
      return this.failedResearch(
        intent,
        'External search is unavailable because Tavily or Firecrawl is not configured for this workspace.',
      );
    }

    const config = workspace.settings.externalResearch.providers[provider];
    const payload = provider === ExternalResearchProviderId.Tavily
      ? await this.researchClient.tavilySearch(config.apiKey, intent.query, 5)
      : await this.researchClient.firecrawlSearch(config.apiKey, intent.query, 5);

    return {
      intent,
      status: WorkspaceChatResearchStatus.Completed,
      provider,
      summary: `${provider} search completed for: ${intent.query}`,
      payload,
    };
  }

  private async executeExtractResearch(
    workspace: EnterpriseLeadWorkspace,
    intent: Extract<EnterpriseLeadWorkspaceChatResearchIntent, { kind: 'extract' }>,
  ): Promise<EnterpriseLeadWorkspaceChatResearchResult> {
    const provider = this.selectExtractProvider(workspace, intent.provider);
    if (!provider) {
      return this.failedResearch(
        intent,
        'External extraction is unavailable because Tavily or Firecrawl is not configured for this workspace.',
      );
    }

    const config = workspace.settings.externalResearch.providers[provider];
    const payload = provider === ExternalResearchProviderId.Firecrawl
      ? await Promise.all(intent.urls.map(url =>
          this.researchClient.firecrawlScrape(config.apiKey, url),
        ))
      : await this.researchClient.tavilyExtract(config.apiKey, intent.urls, intent.query);

    return {
      intent,
      status: WorkspaceChatResearchStatus.Completed,
      provider,
      summary: `${provider} extraction completed for ${intent.urls.length} URL(s).`,
      payload,
    };
  }

  private async executeDomesticStatusResearch(
    workspace: EnterpriseLeadWorkspace,
    intent: Extract<EnterpriseLeadWorkspaceChatResearchIntent, { kind: 'domestic_status' }>,
  ): Promise<EnterpriseLeadWorkspaceChatResearchResult> {
    const domesticConfig = workspace.settings.domesticResearch;
    const enabledSources = DomesticResearchSourceIds
      .map(sourceId => ({
        sourceId,
        ...domesticConfig.sources[sourceId],
      }))
      .filter(source => source.enabled);
    const searchableSources = enabledSources.filter(source =>
      source.modes.includes(DomesticResearchMode.Search),
    );
    const searched = await Promise.all(searchableSources.map(async source => ({
      sourceId: source.sourceId,
      result: await this.researchClient.domesticSearch(source.sourceId, workspace.name, 5),
    })));
    const enabledCustomSources = domesticConfig.customSources.filter(source => source.enabled);

    return {
      intent,
      status: WorkspaceChatResearchStatus.Completed,
      provider: 'domestic',
      summary: enabledSources.length > 0 || enabledCustomSources.length > 0
        ? 'Domestic research sources are configured for read-only status and URL review.'
        : 'No domestic research sources are enabled for this workspace.',
      payload: {
        enabledSources,
        customSources: enabledCustomSources,
        searched,
      },
    };
  }

  private async executeDomesticSearchResearch(
    workspace: EnterpriseLeadWorkspace,
    intent: Extract<EnterpriseLeadWorkspaceChatResearchIntent, { kind: 'domestic_search' }>,
  ): Promise<EnterpriseLeadWorkspaceChatResearchResult> {
    const searchableSourceIds = this.selectDomesticSearchSourceIds(workspace, intent.sourceIds);
    const normalizedIntent: EnterpriseLeadWorkspaceChatResearchIntent = {
      ...intent,
      sourceIds: searchableSourceIds,
    };

    if (searchableSourceIds.length === 0) {
      return this.failedResearch(
        normalizedIntent,
        'Domestic platform search is unavailable because no enabled searchable domestic sources are configured for this workspace.',
      );
    }

    const searched = await Promise.all(searchableSourceIds.map(async sourceId => ({
      sourceId,
      result: await this.researchClient.domesticSearch(sourceId, intent.query, 5),
    })));

    return {
      intent: normalizedIntent,
      status: WorkspaceChatResearchStatus.Completed,
      provider: 'domestic',
      summary: `Domestic platform search completed for: ${intent.query}`,
      payload: {
        searched,
      },
    };
  }

  private failedResearch(
    intent: EnterpriseLeadWorkspaceChatResearchIntent,
    summary: string,
  ): EnterpriseLeadWorkspaceChatResearchResult {
    return {
      intent,
      status: WorkspaceChatResearchStatus.Failed,
      summary,
    };
  }

  private selectSearchProvider(
    workspace: EnterpriseLeadWorkspace,
    requestedProvider: 'auto' | 'tavily' | 'firecrawl',
  ): ExternalResearchProviderIdValue | null {
    if (requestedProvider !== 'auto') {
      return this.isProviderReady(workspace, requestedProvider) ? requestedProvider : null;
    }
    if (this.isProviderReady(workspace, ExternalResearchProviderId.Tavily)) {
      return ExternalResearchProviderId.Tavily;
    }
    if (this.isProviderReady(workspace, ExternalResearchProviderId.Firecrawl)) {
      return ExternalResearchProviderId.Firecrawl;
    }
    return null;
  }

  private selectExtractProvider(
    workspace: EnterpriseLeadWorkspace,
    requestedProvider: 'auto' | 'tavily' | 'firecrawl',
  ): ExternalResearchProviderIdValue | null {
    if (requestedProvider !== 'auto') {
      return this.isProviderReady(workspace, requestedProvider) ? requestedProvider : null;
    }
    if (this.isProviderReady(workspace, ExternalResearchProviderId.Firecrawl)) {
      return ExternalResearchProviderId.Firecrawl;
    }
    if (this.isProviderReady(workspace, ExternalResearchProviderId.Tavily)) {
      return ExternalResearchProviderId.Tavily;
    }
    return null;
  }

  private isProviderReady(
    workspace: EnterpriseLeadWorkspace,
    providerId: ExternalResearchProviderIdValue,
  ): boolean {
    const externalConfig = workspace.settings.externalResearch;
    if (externalConfig.mode === AgentExternalResearchMode.Disabled) {
      return false;
    }
    const providerConfig: ExternalResearchProviderConfig = externalConfig.providers[providerId];
    return providerConfig.enabled && providerConfig.apiKey.trim().length > 0;
  }

  private selectDomesticSearchSourceIds(
    workspace: EnterpriseLeadWorkspace,
    requestedSourceIds: DomesticResearchSourceIdValue[],
  ): DomesticResearchSourceIdValue[] {
    const requested = requestedSourceIds.length > 0
      ? new Set(requestedSourceIds)
      : null;
    return DomesticResearchSourceIds.filter(sourceId => {
      if (requested && !requested.has(sourceId)) {
        return false;
      }
      const source = workspace.settings.domesticResearch.sources[sourceId];
      return source.enabled && source.modes.includes(DomesticResearchMode.Search);
    });
  }

  private getRunForWorkspace(workspaceId: string, runId: string): EnterpriseLeadRun {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    const run = this.store.getRun(runId);
    if (!run) {
      throw new Error('Enterprise lead run not found');
    }
    if (run.workspaceId !== workspace.id) {
      throw new Error('Enterprise lead run does not belong to workspace');
    }
    if (run.status === EnterpriseLeadRunStatus.Archived || run.archiveStatus === 'archived') {
      throw new Error('Enterprise lead run is archived');
    }

    return run;
  }

  private getCurrentRun(
    workspace: EnterpriseLeadWorkspace,
    runId?: string,
  ): EnterpriseLeadRun | null {
    const currentRunId = runId ?? workspace.recentRunId;
    if (!currentRunId) {
      return null;
    }

    const run = this.store.getRun(currentRunId);
    if (!run) {
      throw new Error('Enterprise lead run not found');
    }
    if (run.workspaceId !== workspace.id) {
      throw new Error('Enterprise lead run does not belong to workspace');
    }

    return run;
  }

  private getTaskContext(taskId: string): {
    workspace: EnterpriseLeadWorkspace;
    task: EnterpriseLeadAgentTask;
    upstreamTasks: EnterpriseLeadAgentTask[];
  } {
    const task = this.store.getTask(taskId);
    if (!task) {
      throw new Error('Enterprise lead Agent task not found');
    }

    const run = this.store.getRun(task.runId);
    if (!run) {
      throw new Error('Enterprise lead workspace not found for task');
    }
    if (run.status === EnterpriseLeadRunStatus.Archived || run.archiveStatus === 'archived') {
      throw new Error('Enterprise lead run is archived');
    }

    const workspace = this.store.getWorkspace(run.workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found for task');
    }

    const tasks = this.store.listTasks(task.runId);
    return {
      workspace,
      task,
      upstreamTasks: getUpstreamTasks(tasks, task),
    };
  }

  private deriveDeliverables(
    workspace: EnterpriseLeadWorkspace,
    run: EnterpriseLeadRun,
    tasks: EnterpriseLeadAgentTask[],
  ): EnterpriseLeadDeliverable[] {
    return tasks
      .filter(task => task.summary.trim())
      .map(task => {
        return {
          id: `task:${task.id}`,
          runId: run.id,
          workspaceId: workspace.id,
          kind: getDeliverableKind(task.role),
          role: task.role,
          title: getTaskTitle(task),
          summary: task.summary,
          payload: task.outputPayload,
          status: 'draft',
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        };
      });
  }

  private deriveTodos(
    workspace: EnterpriseLeadWorkspace,
    run: EnterpriseLeadRun,
    tasks: EnterpriseLeadAgentTask[],
  ): EnterpriseLeadTodo[] {
    return tasks.flatMap(task => task.todos.map((todo, index) => ({
      id: `task:${task.id}:todo:${index}`,
      runId: run.id,
      workspaceId: workspace.id,
      kind: this.sanitizeTodoKind(todo),
      title: todo.title,
      description: todo.description,
      role: this.sanitizeTodoRole(todo, task),
      status: 'open',
      createdAt: task.updatedAt,
      updatedAt: task.updatedAt,
    })));
  }

  private sanitizeTodoKind(todo: EnterpriseLeadTodoInput): EnterpriseLeadTodoKind {
    return isEnterpriseLeadTodoKind(todo.kind)
      ? todo.kind
      : EnterpriseLeadTodoKind.MissingInfo;
  }

  private sanitizeTodoRole(
    todo: EnterpriseLeadTodoInput,
    task: EnterpriseLeadAgentTask,
  ): EnterpriseLeadTaskAgentRole | null {
    if (!todo.role) {
      return null;
    }

    if (isEnterpriseLeadAgentRole(todo.role)) {
      return todo.role;
    }

    if (task.workspaceAgentId || task.agentSnapshot) {
      return todo.role === task.role || todo.role === task.workspaceAgentId
        ? todo.role
        : task.role;
    }

    return task.role;
  }

  private deriveArchives(workspace: EnterpriseLeadWorkspace): EnterpriseLeadArchive[] {
    return this.store.listArchivedRuns(workspace.id).map(run => {
      const tasks = this.store.listTasks(run.id);
      const summaryTask = tasks.find(task =>
        task.role === EnterpriseLeadAgentRole.ProjectSummary ||
        task.role === EnterpriseLeadAgentRole.ProjectArchive,
      ) ?? [...tasks].reverse().find(task => task.summary.trim());

      return {
        id: `run:${run.id}`,
        runId: run.id,
        workspaceId: workspace.id,
        title: run.userGoal,
        summary: run.controllerSummary || summaryTask?.summary || run.userGoal,
        payload: {
          userGoal: run.userGoal,
          controllerSummary: run.controllerSummary,
          tasks: tasks.map(task => ({
            role: task.role,
            status: task.status,
            summary: task.summary,
            outputPayload: task.outputPayload,
            risks: task.risks,
            todos: task.todos,
          })),
        },
        createdAt: run.completedAt || run.updatedAt,
      };
    });
  }

  private mapTaskStatusToRunStatus(status: EnterpriseLeadTaskStatus): EnterpriseLeadRunStatus {
    if (status === EnterpriseLeadTaskStatus.Blocked) {
      return EnterpriseLeadRunStatus.Blocked;
    }
    if (status === EnterpriseLeadTaskStatus.Error) {
      return EnterpriseLeadRunStatus.Error;
    }
    return EnterpriseLeadRunStatus.NeedsInput;
  }

  private assertRunHasNoBlockingRiskReview(runId: string): void {
    const tasks = this.store.listTasks(runId);
    const riskTask = tasks.find(task =>
      task.role === EnterpriseLeadAgentRole.RiskReview,
    ) ?? tasks.find(task => this.isDynamicRiskReviewTask(task));
    if (!riskTask) {
      if (tasks.some(task => task.workspaceAgentId || task.agentSnapshot)) {
        this.assertDynamicRunHasNoBlockingRisk(tasks);
        return;
      }
      throw new Error('Enterprise lead risk review must be completed before archive');
    }

    const canArchive = riskTask.outputPayload.canArchive ?? riskTask.handoffContext.canArchive;
    const riskLevel = riskTask.outputPayload.riskLevel;
    const hasHighRisk = riskTask.risks.some(risk => risk.level === EnterpriseLeadRiskLevel.High);
    if (
      riskTask.status === EnterpriseLeadTaskStatus.Blocked ||
      canArchive === false ||
      riskLevel === EnterpriseLeadRiskLevel.High ||
      hasHighRisk
    ) {
      throw new Error('Enterprise lead run has unresolved risk review');
    }
    if (riskTask.status !== EnterpriseLeadTaskStatus.Completed || riskTask.stale) {
      throw new Error('Enterprise lead risk review must be completed before archive');
    }
    if (tasks.some(task => task.workspaceAgentId || task.agentSnapshot)) {
      this.assertDynamicRunHasNoBlockingRisk(tasks);
    }
  }

  private isDynamicRiskReviewTask(task: EnterpriseLeadAgentTask): boolean {
    if (!task.workspaceAgentId && !task.agentSnapshot) {
      return false;
    }
    const text = [
      task.role,
      task.agentSnapshot?.name,
      task.agentSnapshot?.description,
      task.agentSnapshot?.identity,
    ].join(' ').toLowerCase();

    return /risk|review|audit|风险|风控|审核|合规/.test(text);
  }

  private assertDynamicRunHasNoBlockingRisk(tasks: EnterpriseLeadAgentTask[]): void {
    const hasUnfinishedTask = tasks.some(task =>
      task.status !== EnterpriseLeadTaskStatus.Completed || task.stale);
    if (hasUnfinishedTask) {
      throw new Error('Enterprise lead risk review must be completed before archive');
    }

    const hasBlockingRisk = tasks.some(task =>
      task.status === EnterpriseLeadTaskStatus.Blocked ||
      task.outputPayload.canArchive === false ||
      task.handoffContext.canArchive === false ||
      task.outputPayload.riskLevel === EnterpriseLeadRiskLevel.High ||
      task.risks.some(risk => risk.level === EnterpriseLeadRiskLevel.High));

    if (hasBlockingRisk) {
      throw new Error('Enterprise lead run has unresolved risk review');
    }
  }
}
