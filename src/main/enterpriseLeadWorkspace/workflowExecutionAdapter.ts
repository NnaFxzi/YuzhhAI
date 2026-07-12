import type { PromotionTaskResult } from '../../shared/enterpriseLeadWorkspace/promotionTaskContracts';
import { parsePromotionTaskResult } from '../../shared/enterpriseLeadWorkspace/promotionTaskContracts';
import {
  WorkflowExecutionMode,
  type WorkflowTaskExecutionContext,
} from '../../shared/enterpriseLeadWorkspace/workflowContracts';
import type { ModelClientAdapter } from '../industryPack/modelClientAdapter';
import { resolveRawApiConfigFromAppConfig } from '../libs/claudeSettings';
import { parseModelJsonObject } from './modelJson';
import { type AgentTaskPromptInput,buildAgentTaskPrompt } from './promptTemplates';

export interface WorkflowExecutionAdapter {
  execute(context: WorkflowTaskExecutionContext): Promise<PromotionTaskResult>;
}

export interface InlineWorkflowExecutionAdapterOptions {
  modelClient: ModelClientAdapter;
  resolvePromptContext(context: WorkflowTaskExecutionContext): Promise<AgentTaskPromptInput>;
}

const resolveWorkspaceApiConfig = (workspace: EnterpriseLeadWorkspace) =>
  resolveRawApiConfigFromAppConfig({
    model: {
      defaultModel: workspace.settings.model.defaultModel,
      defaultModelProvider: workspace.settings.model.defaultModelProvider,
    },
    providers: workspace.settings.model.providers,
  }).config ?? undefined;

export class InlineWorkflowExecutionAdapter implements WorkflowExecutionAdapter {
  constructor(private readonly options: InlineWorkflowExecutionAdapterOptions) {}

  async execute(context: WorkflowTaskExecutionContext): Promise<PromotionTaskResult> {
    if (context.executionMode !== WorkflowExecutionMode.Inline) {
      throw new Error(`Inline workflow adapter cannot execute ${context.executionMode}`);
    }
    const promptContext = await this.options.resolvePromptContext(context);
    const model = promptContext.task.agentSnapshot?.model.trim();
    const generated = await this.options.modelClient.generate({
      prompt: buildAgentTaskPrompt(promptContext),
      apiConfig: resolveWorkspaceApiConfig(promptContext.workspace),
      ...(model ? { model } : {}),
    });
    return parsePromotionTaskResult(promptContext.task.role, parseModelJsonObject(generated.text));
  }
}

export class UnsupportedExecutionModeError extends Error {
  constructor(executionMode: WorkflowExecutionMode) {
    super(`Workflow execution mode ${executionMode} is not supported yet`);
    this.name = 'UnsupportedExecutionModeError';
  }
}

export class ChildSessionWorkflowExecutionAdapter implements WorkflowExecutionAdapter {
  async execute(context: WorkflowTaskExecutionContext): Promise<PromotionTaskResult> {
    throw new UnsupportedExecutionModeError(context.executionMode);
  }
}
