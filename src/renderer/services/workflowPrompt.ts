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
