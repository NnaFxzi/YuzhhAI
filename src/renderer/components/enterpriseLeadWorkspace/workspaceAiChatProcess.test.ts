import { describe, expect, test } from 'vitest';

import {
  EnterpriseLeadChatProgressPhase,
  EnterpriseLeadChatProgressStatus,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import {
  deriveWorkspaceAiChatProcess,
  deriveWorkspaceAiChatProcessFromProgressEvents,
  deriveWorkspaceAiChatSuggestedActions,
  WorkspaceAiChatProcessStepKind,
  WorkspaceAiChatProcessStepStatus,
  WorkspaceAiChatSuggestedActionKind,
} from './workspaceAiChatProcess';

describe('deriveWorkspaceAiChatProcess', () => {
  test('returns null for a plain message without process metadata', () => {
    const process = deriveWorkspaceAiChatProcess({
      id: 'message-1',
      role: 'assistant',
      content: '这里是普通回复。',
      createdAt: '2026-07-06T00:00:00.000Z',
    });

    expect(process).toBeNull();
  });

  test('derives routing and research steps from an assistant message', () => {
    const process = deriveWorkspaceAiChatProcess({
      id: 'message-1',
      role: 'assistant',
      content: '目前不能排序，因为没有具体客户名单。',
      createdAt: '2026-07-06T00:00:00.000Z',
      agent: { id: 'opportunity_radar', name: '商机雷达 Agent' },
      routing: {
        reason: '自动判断：客户优先级判断任务。',
        agents: [
          { id: 'research_helper', name: '调研助手 Agent' },
          { id: 'opportunity_radar', name: '商机雷达 Agent' },
        ],
        steps: [
          {
            agent: { id: 'research_helper', name: '调研助手 Agent' },
            content: '本轮调研没有提取到具体公司名单。',
          },
        ],
      },
      research: {
        intent: { kind: 'search', query: '机械厂 客户线索', provider: 'auto' },
        status: 'completed',
        provider: 'firecrawl',
        summary: '调研完成，未发现可排序的真实客户名单。',
      },
    });

    expect(process?.agentLabel).toBe('调研助手 Agent + 商机雷达 Agent');
    expect(process?.summaryKey).toBe('enterpriseLeadAiChatProcessResearchCompleted');
    expect(process?.summaryDetail).toBe('调研完成，未发现可排序的真实客户名单。');
    expect(process?.steps.map(step => step.kind)).toEqual([
      WorkspaceAiChatProcessStepKind.Routing,
      WorkspaceAiChatProcessStepKind.Research,
      WorkspaceAiChatProcessStepKind.AgentStep,
      WorkspaceAiChatProcessStepKind.Answer,
    ]);
    expect(
      process?.steps.find(step => step.kind === WorkspaceAiChatProcessStepKind.Research)?.status,
    ).toBe(WorkspaceAiChatProcessStepStatus.Completed);
  });

  test('maps failed and skipped research statuses for process steps', () => {
    const failed = deriveWorkspaceAiChatProcess({
      id: 'failed-message',
      role: 'assistant',
      content: '调研失败，先根据已有资料判断。',
      createdAt: '2026-07-06T00:00:00.000Z',
      research: {
        intent: { kind: 'search', query: '客户线索', provider: 'auto' },
        status: 'failed',
        summary: '调研服务暂时不可用。',
      },
    });
    const skipped = deriveWorkspaceAiChatProcess({
      id: 'skipped-message',
      role: 'assistant',
      content: '这次未调研。',
      createdAt: '2026-07-06T00:00:00.000Z',
      research: {
        intent: { kind: 'none' },
        status: 'skipped',
        summary: '当前空间未开启调研能力。',
      },
    });

    expect(
      failed?.steps.find(step => step.kind === WorkspaceAiChatProcessStepKind.Research)?.status,
    ).toBe(WorkspaceAiChatProcessStepStatus.Failed);
    expect(failed?.summaryKey).toBe('enterpriseLeadAiChatProcessResearchFailed');
    expect(
      skipped?.steps.find(step => step.kind === WorkspaceAiChatProcessStepKind.Research)?.status,
    ).toBe(WorkspaceAiChatProcessStepStatus.Skipped);
    expect(skipped?.summaryKey).toBe('enterpriseLeadAiChatProcessResearchSkipped');
  });
});

describe('deriveWorkspaceAiChatProcessFromProgressEvents', () => {
  test('uses only real progress events and keeps the latest event per step', () => {
    const process = deriveWorkspaceAiChatProcessFromProgressEvents([
      {
        requestId: 'request-1',
        stepId: 'routing',
        phase: EnterpriseLeadChatProgressPhase.Routing,
        status: EnterpriseLeadChatProgressStatus.Running,
        title: '正在分析任务和选择 Agent',
        timestamp: 1,
      },
      {
        requestId: 'request-1',
        stepId: 'routing',
        phase: EnterpriseLeadChatProgressPhase.Routing,
        status: EnterpriseLeadChatProgressStatus.Completed,
        title: '已选择商机雷达 Agent',
        detail: '手动选择：商机雷达 Agent',
        source: '商机雷达 Agent',
        timestamp: 2,
      },
      {
        requestId: 'request-1',
        stepId: 'research',
        phase: EnterpriseLeadChatProgressPhase.Research,
        status: EnterpriseLeadChatProgressStatus.Running,
        title: '正在调研公开信息',
        detail: '自动化设备厂 采购信号',
        timestamp: 3,
      },
    ]);

    expect(process?.agentLabel).toBe('商机雷达 Agent');
    expect(process?.summaryDetail).toBe('自动化设备厂 采购信号');
    expect(process?.steps.map(step => [step.id, step.kind, step.status, step.title])).toEqual([
      [
        'routing',
        WorkspaceAiChatProcessStepKind.Routing,
        WorkspaceAiChatProcessStepStatus.Completed,
        '已选择商机雷达 Agent',
      ],
      [
        'research',
        WorkspaceAiChatProcessStepKind.Research,
        WorkspaceAiChatProcessStepStatus.Active,
        '正在调研公开信息',
      ],
    ]);
  });
});

describe('deriveWorkspaceAiChatSuggestedActions', () => {
  test('suggests next actions when research completed without concrete companies', () => {
    const actions = deriveWorkspaceAiChatSuggestedActions({
      id: 'message-1',
      role: 'assistant',
      content: '目前不能排序，因为没有具体客户名单。',
      createdAt: '2026-07-06T00:00:00.000Z',
      research: {
        intent: { kind: 'search', query: '机械厂 客户线索', provider: 'auto' },
        status: 'completed',
        summary: '未发现可排序的真实客户名单。',
        leadCandidates: [
          {
            kind: 'category',
            name: '机械设备厂',
            evidence: '行业方向匹配。',
            confidence: 'medium',
          },
        ],
      },
    });

    expect(actions.map(action => action.kind)).toEqual([
      WorkspaceAiChatSuggestedActionKind.ContinueSearch,
      WorkspaceAiChatSuggestedActionKind.ScorePastedList,
      WorkspaceAiChatSuggestedActionKind.BuildScreeningSheet,
    ]);
    expect(actions.map(action => action.draftKey)).toEqual([
      'enterpriseLeadAiChatSuggestedContinueSearchDraft',
      'enterpriseLeadAiChatSuggestedScorePastedListDraft',
      'enterpriseLeadAiChatSuggestedBuildScreeningSheetDraft',
    ]);
  });

  test('suggests ranking and follow-up actions when concrete companies exist', () => {
    const actions = deriveWorkspaceAiChatSuggestedActions({
      id: 'message-1',
      role: 'assistant',
      content: '发现 1 家客户。',
      createdAt: '2026-07-06T00:00:00.000Z',
      research: {
        intent: { kind: 'search', query: '机械厂 客户线索', provider: 'auto' },
        status: 'completed',
        summary: '发现 1 家有需求信号的公司。',
        leadCandidates: [
          {
            kind: 'company',
            name: '杭州某自动化设备有限公司',
            evidence: '近期发布设备扩产采购需求。',
            demandSignal: '设备扩产采购',
            confidence: 'high',
          },
        ],
      },
    });

    expect(actions.map(action => action.kind)).toEqual([
      WorkspaceAiChatSuggestedActionKind.RankCandidates,
      WorkspaceAiChatSuggestedActionKind.DraftFollowUp,
    ]);
    expect(actions.map(action => action.draftKey)).toEqual([
      'enterpriseLeadAiChatSuggestedRankCandidatesDraft',
      'enterpriseLeadAiChatSuggestedDraftFollowUpDraft',
    ]);
  });
});
