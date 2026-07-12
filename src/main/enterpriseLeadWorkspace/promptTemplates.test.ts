import { describe, expect, test } from 'vitest';

import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadTaskStatus,
  EnterpriseLeadWorkspaceType,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadWorkspace,
} from '../../shared/enterpriseLeadWorkspace/types';
import { buildDefaultEnterpriseLeadWorkspaceSettings } from '../../shared/enterpriseLeadWorkspace/validation';
import {
  buildAgentTaskPrompt,
  buildPromotionTaskOutputSchema,
} from './promptTemplates';

const workspace: EnterpriseLeadWorkspace = {
  id: 'workspace-1',
  name: '推广工作台',
  type: EnterpriseLeadWorkspaceType.EnterpriseLead,
  profile: {
    companySummary: '工业包装供应商',
    productList: ['重型纸箱'],
    productCapabilities: [],
    targetCustomers: ['机械设备厂'],
    applicationScenarios: [],
    sellingPoints: [],
    channelPreferences: [],
    prohibitedClaims: [],
    contactRules: ['只生成草稿'],
    missingInfo: [],
  },
  extractionSources: [],
  riskRules: ['no_real_publish'],
  enabledAgentRoles: [EnterpriseLeadAgentRole.PromotionMultiPlatformAssets],
  settings: buildDefaultEnterpriseLeadWorkspaceSettings(),
  workspaceAgents: [],
  recentRunId: null,
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
};

const task = (role: EnterpriseLeadAgentRole): EnterpriseLeadAgentTask => ({
  id: `${role}-task`,
  runId: 'run-1',
  role,
  artifactRefs: [
    {
      id: 'input-artifact',
      kind: 'scored_leads',
      schemaVersion: 1,
      summary: '已评分线索摘要',
      producerTaskId: 'scoring-task',
      evidenceIds: ['evidence-1'],
    },
  ],
  workspaceAgentId: null,
  agentSnapshot: null,
  status: EnterpriseLeadTaskStatus.Ready,
  inputPayload: { unsafe: 'CURRENT_TASK_RAW_PAYLOAD' },
  outputPayload: {},
  summary: '',
  missingInfo: [],
  todos: [],
  risks: [],
  handoffContext: {},
  error: '',
  stale: false,
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
});

describe('promotion task prompts', () => {
  test('uses artifact summaries and role contracts instead of raw upstream payloads', () => {
    const prompt = buildAgentTaskPrompt({
      workspace,
      task: task(EnterpriseLeadAgentRole.PromotionMultiPlatformAssets),
      upstreamTasks: [
        {
          ...task(EnterpriseLeadAgentRole.PromotionLeadScoring),
          outputPayload: { unsafe: 'UNTRUSTED_RAW_UPSTREAM_OUTPUT' },
          artifactRefs: [
            {
              id: 'upstream-artifact',
              kind: 'scored_leads',
              schemaVersion: 1,
              summary: '高优先级线索 3 条',
              producerTaskId: 'scoring-task',
              evidenceIds: ['evidence-1'],
            },
          ],
        },
      ],
    });

    expect(prompt).toContain('inputArtifacts');
    expect(prompt).toContain('input-artifact');
    expect(prompt).toContain('upstream-artifact');
    expect(prompt).toContain('高优先级线索 3 条');
    expect(prompt).toContain('manualReviewRequired');
    expect(prompt).not.toContain('CURRENT_TASK_RAW_PAYLOAD');
    expect(prompt).not.toContain('UNTRUSTED_RAW_UPSTREAM_OUTPUT');
  });

  test('builds the fixed role schema for promotion monitoring output', () => {
    expect(buildPromotionTaskOutputSchema(EnterpriseLeadAgentRole.PromotionAccountMonitoring)).toEqual({
      metrics: ['渠道指标对象'],
      anomalies: ['异常对象'],
      hypotheses: ['异常假设'],
      adjustmentActions: ['人工确认后的调整建议'],
    });
  });
});
