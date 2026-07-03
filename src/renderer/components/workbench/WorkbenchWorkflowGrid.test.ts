import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { type LocalizedQuickAction, WorkflowOutputType } from '../../types/quickAction';
import WorkbenchWorkflowGrid from './WorkbenchWorkflowGrid';

const actions: LocalizedQuickAction[] = [
  {
    id: 'office',
    label: '办公整理',
    icon: 'PresentationChartBarIcon',
    color: '#22c55e',
    skillMapping: 'docx',
    category: 'office',
    prompts: [
      {
        id: 'daily-report',
        label: '生成日报',
        description: '把工作记录整理成今日工作总结',
        prompt: '写日报',
        workflow: {
          outputTypes: [WorkflowOutputType.Markdown, WorkflowOutputType.Document],
        },
      },
    ],
  },
];

describe('WorkbenchWorkflowGrid', () => {
  test('renders the aligned lightweight template layout', () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkbenchWorkflowGrid, {
        actions,
        onPromptSelect: () => {},
      }),
    );

    expect(html).toContain('data-layout="aligned-template-list"');
    expect(html).toContain('生成日报');
    expect(html).toContain('办公整理');
    expect(html).toContain('bg-white');
    expect(html).toContain('data-accent="blue"');
    expect(html).not.toContain('bg-teal-400/[0.035]');
    expect(html).not.toContain('min-h-[128px]');
  });
});
