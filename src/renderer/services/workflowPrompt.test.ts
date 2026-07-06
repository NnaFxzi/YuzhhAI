import { describe, expect, test } from 'vitest';

import { type LocalizedPrompt, WorkflowCategory, WorkflowOutputType } from '../types/quickAction';
import { buildWorkflowPrompt } from './workflowPrompt';

describe('buildWorkflowPrompt', () => {
  test('adds workflow context before the user-facing prompt', () => {
    const prompt: LocalizedPrompt = {
      id: 'office.daily-report',
      label: '生成日报',
      description: '整理今天的工作',
      prompt: '请基于材料生成日报。',
      workflow: {
        category: WorkflowCategory.Office,
        requiredInputs: ['今天的工作记录', '相关文件'],
        outputTypes: [WorkflowOutputType.Markdown, WorkflowOutputType.Document],
      },
    };

    const result = buildWorkflowPrompt(prompt);

    expect(result).toContain('## 工作流');
    expect(result).toContain('名称：生成日报');
    expect(result).toContain('需要的材料：今天的工作记录、相关文件');
    expect(result).toContain('期望产物：markdown、document');
    expect(result).toContain('请基于材料生成日报。');
  });

  test('wraps workflow prompts in English when language is en', () => {
    const prompt: LocalizedPrompt = {
      id: 'office.daily-report',
      label: 'Daily report',
      description: 'Summarize today work',
      prompt: 'Create a daily report from the material.',
      workflow: {
        category: WorkflowCategory.Office,
        requiredInputs: ['work notes', 'related files'],
        outputTypes: [WorkflowOutputType.Markdown, WorkflowOutputType.Document],
      },
    };

    const result = buildWorkflowPrompt(prompt, { language: 'en' });

    expect(result).toContain('## Workflow');
    expect(result).toContain('Name: Daily report');
    expect(result).toContain('Required material: work notes, related files');
    expect(result).toContain('Expected output: markdown, document');
    expect(result).toContain('## User task');
    expect(result).not.toContain('## 工作流');
  });

  test('returns the raw prompt when workflow metadata is absent', () => {
    expect(buildWorkflowPrompt({
      id: 'plain',
      label: 'Plain',
      prompt: '直接执行。',
    })).toBe('直接执行。');
  });
});
