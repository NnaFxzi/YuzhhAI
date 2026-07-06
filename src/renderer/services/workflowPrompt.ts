import type { LocalizedPrompt } from '../types/quickAction';
import type { LanguageType } from './i18n';

interface BuildWorkflowPromptOptions {
  language?: LanguageType;
}

const WORKFLOW_PROMPT_LABELS: Record<
  LanguageType,
  {
    workflowHeading: string;
    name: string;
    description: string;
    requiredInputs: string;
    requiredInputsSeparator: string;
    outputTypes: string;
    outputTypesSeparator: string;
    userTaskHeading: string;
    colon: string;
  }
> = {
  zh: {
    workflowHeading: '## 工作流',
    name: '名称',
    description: '说明',
    requiredInputs: '需要的材料',
    requiredInputsSeparator: '、',
    outputTypes: '期望产物',
    outputTypesSeparator: '、',
    userTaskHeading: '## 用户任务',
    colon: '：',
  },
  en: {
    workflowHeading: '## Workflow',
    name: 'Name',
    description: 'Description',
    requiredInputs: 'Required material',
    requiredInputsSeparator: ', ',
    outputTypes: 'Expected output',
    outputTypesSeparator: ', ',
    userTaskHeading: '## User task',
    colon: ': ',
  },
};

export function buildWorkflowPrompt(
  prompt: LocalizedPrompt,
  options: BuildWorkflowPromptOptions = {},
): string {
  const basePrompt = prompt.prompt.trim();
  if (!prompt.workflow) {
    return basePrompt;
  }

  const labels = WORKFLOW_PROMPT_LABELS[options.language ?? 'zh'];
  const requiredInputs = prompt.workflow.requiredInputs?.filter(Boolean) ?? [];
  const outputTypes = prompt.workflow.outputTypes?.filter(Boolean) ?? [];

  return [
    labels.workflowHeading,
    `${labels.name}${labels.colon}${prompt.label}`,
    prompt.description ? `${labels.description}${labels.colon}${prompt.description}` : null,
    requiredInputs.length > 0
      ? `${labels.requiredInputs}${labels.colon}${requiredInputs.join(labels.requiredInputsSeparator)}`
      : null,
    outputTypes.length > 0
      ? `${labels.outputTypes}${labels.colon}${outputTypes.join(labels.outputTypesSeparator)}`
      : null,
    '',
    labels.userTaskHeading,
    basePrompt,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
