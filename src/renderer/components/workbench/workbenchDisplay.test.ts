import { describe, expect, test } from 'vitest';

import {
  getFeaturedWorkflowPrompts,
  getWorkflowOutputLabel,
} from './workbenchDisplay';

describe('workbench display helpers', () => {
  test('maps workflow output labels', () => {
    expect(getWorkflowOutputLabel('presentation')).toBe('PPT');
    expect(getWorkflowOutputLabel('spreadsheet')).toBe('表格');
  });

  test('returns concrete prompt cards for the home workbench', () => {
    const featured = getFeaturedWorkflowPrompts([
      {
        id: 'office',
        label: '办公整理',
        icon: 'PresentationChartBarIcon',
        color: '#22c55e',
        skillMapping: 'docx',
        category: 'office',
        prompts: [
          { id: 'daily-report', label: '整理日报', prompt: '写日报' },
          { id: 'slides', label: '资料转 PPT', prompt: '做 PPT' },
        ],
      },
      {
        id: 'content',
        label: '内容运营',
        icon: 'GlobeAltIcon',
        color: '#0ea5e9',
        skillMapping: 'local-tools',
        category: 'content',
        prompts: [
          { id: 'calendar', label: '选题日历', prompt: '做日历' },
          { id: 'script', label: '短视频脚本', prompt: '写脚本' },
        ],
      },
    ], 3);

    expect(featured).toEqual([
      expect.objectContaining({ actionId: 'office', actionLabel: '办公整理', prompt: expect.objectContaining({ id: 'daily-report' }) }),
      expect.objectContaining({ actionId: 'office', actionLabel: '办公整理', prompt: expect.objectContaining({ id: 'slides' }) }),
      expect.objectContaining({ actionId: 'content', actionLabel: '内容运营', prompt: expect.objectContaining({ id: 'calendar' }) }),
    ]);
  });

});
