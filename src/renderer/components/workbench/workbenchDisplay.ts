import type { LocalizedPrompt, LocalizedQuickAction, WorkflowOutputType } from '../../types/quickAction';

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

export function getWorkflowOutputLabel(outputType: WorkflowOutputType): string {
  return WorkflowOutputLabel[outputType];
}

export interface FeaturedWorkflowPrompt {
  actionId: string;
  actionLabel: string;
  actionIcon: string;
  prompt: LocalizedPrompt;
}

export function getFeaturedWorkflowPrompts(
  actions: LocalizedQuickAction[],
  maxCount = 4,
): FeaturedWorkflowPrompt[] {
  return actions.flatMap((action) => (
    action.prompts.map((prompt) => ({
      actionId: action.id,
      actionLabel: action.label,
      actionIcon: action.icon,
      prompt,
    }))
  )).slice(0, maxCount);
}
