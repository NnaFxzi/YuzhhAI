import { beforeEach, describe, expect, test, vi } from 'vitest';

import { WorkflowCategory, WorkflowOutputType } from '../types/quickAction';
import { i18nService } from './i18n';
import { quickActionService } from './quickAction';

const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

describe('quickActionService workflow metadata', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    quickActionService.clearCache();
    vi.spyOn(i18nService, 'getLanguage').mockReturnValue('zh');
  });

  test('localizes workflow metadata while preserving prompt workflow fields', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: 2,
          actions: [{
            id: 'office',
            icon: 'PresentationChartBarIcon',
            color: '#2563EB',
            skillMapping: 'pptx',
            category: WorkflowCategory.Office,
            prompts: [{
              id: 'office.files-to-ppt',
              workflow: {
                category: WorkflowCategory.Office,
                requiredInputs: ['资料文件或文件夹'],
                outputTypes: [WorkflowOutputType.Presentation],
                followUps: [{
                  id: 'schedule-weekly',
                  label: '每周自动生成',
                  prompt: '每周一自动生成这份 PPT。',
                }],
              },
            }],
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          zh: {
            office: {
              label: '办公整理',
              prompts: {
                'office.files-to-ppt': {
                  label: '资料转 PPT',
                  description: '把资料整理成汇报演示',
                  prompt: '请把这些资料整理成 PPT。',
                },
              },
            },
          },
          en: {},
        }),
      });

    const actions = await quickActionService.getLocalizedActions();

    expect(actions[0].category).toBe(WorkflowCategory.Office);
    expect(actions[0].prompts[0]).toMatchObject({
      id: 'office.files-to-ppt',
      label: '资料转 PPT',
      workflow: {
        outputTypes: [WorkflowOutputType.Presentation],
      },
    });
  });
});
