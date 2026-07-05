import { configureStore } from '@reduxjs/toolkit';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadContentDeliveryMode,
  EnterpriseLeadContentOutputPlatformId,
  EnterpriseLeadDeliverableKind,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadRunStatus,
  EnterpriseLeadTaskStatus,
  EnterpriseLeadTodoKind,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadPendingVersion,
  EnterpriseLeadRun,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceProfile,
  EnterpriseLeadWorkspaceRunSummary,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { buildDefaultEnterpriseLeadWorkspaceSettings } from '../../../shared/enterpriseLeadWorkspace/validation';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import agentReducer from '../../store/slices/agentSlice';
import modelReducer from '../../store/slices/modelSlice';
import skillReducer from '../../store/slices/skillSlice';
import {
  buildManualEnterpriseLeadWorkspaceDraft,
  EnterpriseLeadEntryAction,
  EnterpriseLeadKnowledgeItemKind,
  EnterpriseLeadWorkbenchSidebarMode,
  EnterpriseLeadWorkspaceHistoryState,
  EnterpriseLeadWorkspaceInternalPage,
  EnterpriseLeadWorkspaceLaunchMode,
  EnterpriseLeadWorkspaceScreen,
  EnterpriseLeadWorkspaceShellMode,
  EnterpriseLeadWorkspaceStartAction,
  EnterpriseLeadWorkspaceStartSourceState,
  getAgentCardTone,
  getAgentRoleLabel,
  getAgentStatusLabelKey,
  getCreationRecordSummary,
  getDefaultWorkbenchSidebarMode,
  getDefaultWorkspaceInternalPage,
  getEditableKnowledgeField,
  getEffectiveWorkspaceAgent,
  getEnterpriseLeadTaskDisplay,
  getEntryHomeActions,
  getHistoryModalState,
  getLaunchMode,
  getShellModeForEnterpriseLeadWorkspaceScreen,
  getWorkbenchAgentItems,
  getWorkbenchConfigSections,
  getWorkbenchLayoutSpec,
  getWorkbenchSidebarItems,
  getWorkbenchSidebarWidth,
  getWorkspaceCompletionPercent,
  getWorkspaceCreateBranchScreen,
  getWorkspaceInternalPages,
  getWorkspaceKnowledgeSections,
  getWorkspaceStartActionTarget,
  getWorkspaceStartReadiness,
  getWorkspaceStartSourceState,
  hasTaskOutput,
  isWorkspaceOperationCurrent,
  shouldRefreshHistoryOnEntryAction,
  sortWorkspacesByRecentUpdate,
  summarizeWorkspaceDraft,
  WorkspaceCreateBranchScreen,
  WorkspaceCreateStartMode,
} from './enterpriseLeadWorkspaceUi';
import {
  isWorkspaceAiChatRequestCurrent,
  WorkspaceAiChat,
} from './WorkspaceAiChat';
import WorkspaceCreate from './WorkspaceCreate';
import {
  getCreationRecordResultSections,
  getInitialCreationRecordId,
} from './WorkspaceCreationRecords';
import WorkspaceEntryHome, {
  WorkspaceDeleteConfirmDialog,
  WorkspaceHistoryList,
} from './WorkspaceEntryHome';
import {
  buildWorkspaceSearchResults,
  WorkspaceSearch,
} from './WorkspaceSearch';
import {
  getWorkspaceSettingsReadiness,
  saveWorkspaceSettingsDraft,
  WorkspaceSettings,
} from './WorkspaceSettings';
import {
  getContentPlatformConnectionStatus,
  getExternalResearchProviderConnectionStatus,
  getModelProviderConnectionStatus,
  getWorkspaceSettingsBlockingIssues,
} from './workspaceSettingsReadiness';
import WorkspaceShell from './WorkspaceShell';
import WorkspaceSidePanel from './WorkspaceSidePanel';
import WorkspaceStart from './WorkspaceStart';
import {
  createAndBindWorkspaceAgent,
  moveWorkspaceAgentBinding,
  prepareWorkspaceAgentBindings,
  saveWorkbenchWorkspaceAgents,
  saveWorkspaceAgentBindings,
  WorkspaceAgentActionsMenu,
  WorkspaceAgentEditorDialog,
  WorkspaceWorkbench,
} from './WorkspaceWorkbench';

const emptyProfile = (): EnterpriseLeadWorkspaceProfile => ({
  companySummary: '',
  productList: [],
  productCapabilities: [],
  targetCustomers: [],
  applicationScenarios: [],
  sellingPoints: [],
  channelPreferences: [],
  prohibitedClaims: [],
  contactRules: [],
  missingInfo: [],
});

const createWorkspace = (
  id: string,
  enabledAgentRoles: EnterpriseLeadWorkspace['enabledAgentRoles'] = [],
  workspaceAgents: EnterpriseLeadWorkspaceAgentBinding[] = [],
): EnterpriseLeadWorkspace => ({
  id,
  name: `Workspace ${id}`,
  type: 'enterprise_lead',
  profile: emptyProfile(),
  extractionSources: [],
  riskRules: [],
  enabledAgentRoles,
  settings: buildDefaultEnterpriseLeadWorkspaceSettings(),
  workspaceAgents,
  recentRunId: null,
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z',
});

const createRun = (workspaceId: string): EnterpriseLeadRun => ({
  id: 'run-1',
  workspaceId,
  userGoal: '整理本周可跟进的机械厂线索',
  status: EnterpriseLeadRunStatus.Running,
  currentRole: EnterpriseLeadAgentRole.ContentPlanning,
  controllerSummary: '内容策划 Agent 正在处理。',
  archiveStatus: 'not_archived',
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z',
  completedAt: null,
});

const createRunSummary = (
  workspaceId: string,
  overrides: Partial<EnterpriseLeadRun> = {},
): EnterpriseLeadWorkspaceRunSummary => ({
  run: {
    ...createRun(workspaceId),
    ...overrides,
  },
  taskCount: 3,
  deliverableCount: 2,
  todoCount: 1,
  riskCount: 0,
});

const createTask = (
  workspaceId: string,
  role: EnterpriseLeadAgentRole = EnterpriseLeadAgentRole.ContentPlanning,
): EnterpriseLeadAgentTask => ({
  id: `task-${role}`,
  runId: 'run-1',
  role,
  workspaceAgentId: null,
  agentSnapshot: null,
  status: EnterpriseLeadTaskStatus.Completed,
  inputPayload: {
    workspaceId,
  },
  outputPayload: {
    draft: '本周优先跟进长三角精密制造客户。',
  },
  summary: '已生成本周精密制造获客内容草稿。',
  missingInfo: [],
  todos: [],
  risks: [],
  handoffContext: {},
  error: '',
  stale: false,
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z',
});

const createPendingVersion = (
  workspaceId: string,
  role: EnterpriseLeadAgentRole = EnterpriseLeadAgentRole.ContentPlanning,
): EnterpriseLeadPendingVersion => ({
  id: 'version-1',
  taskId: `task-${role}`,
  runId: 'run-1',
  workspaceId,
  role,
  userMessage: '改得更短，更适合销售直接发送',
  summary: '更短的销售触达版本。',
  outputPayload: {},
  missingInfo: [],
  todos: [],
  risks: [],
  handoffContext: {},
  status: 'pending',
  createdAt: '2026-07-04T00:00:00.000Z',
  appliedAt: null,
});

const createSnapshot = (workspace: EnterpriseLeadWorkspace): EnterpriseLeadWorkspaceSnapshot => ({
  workspace,
  currentRun: createRun(workspace.id),
  tasks: [createTask(workspace.id)],
  pendingVersions: [createPendingVersion(workspace.id)],
  deliverables: [],
  todos: [],
  archives: [],
});

const createDraft = (
  profile: EnterpriseLeadWorkspaceProfile,
): EnterpriseLeadWorkspaceDraft => ({
  name: 'North Star Leads',
  type: 'enterprise_lead',
  profile,
  source: {
    kind: 'conversation',
    label: 'Conversation',
  },
  enabledAgentRoles: [],
  workspaceAgents: [],
});

const renderEnterpriseLeadComponent = (element: React.ReactElement): string => {
  const testStore = configureStore({
    reducer: {
      agent: agentReducer,
      model: modelReducer,
      skill: skillReducer,
    },
    preloadedState: {
      agent: {
        agents: [
          {
            id: 'agent-a',
            name: 'Global Writer',
            description: 'Global writer description.',
            icon: 'briefcase',
            model: 'deepseek/deepseek-chat',
            workingDirectory: '',
            enabled: true,
            pinned: false,
            pinOrder: null,
            isDefault: false,
            source: 'custom' as const,
            skillIds: ['docx'],
          },
          {
            id: 'agent-b',
            name: 'Research Agent',
            description: 'Researches public customer signals.',
            icon: 'search',
            model: 'openai/gpt-4.1',
            workingDirectory: '',
            enabled: true,
            pinned: false,
            pinOrder: null,
            isDefault: false,
            source: 'custom' as const,
            skillIds: ['web-search'],
          },
        ],
        currentAgentId: 'main',
        loading: false,
      },
      skill: {
        skills: [
          {
            id: 'docx',
            name: '文档处理',
            description: '读取和整理客户资料文档。',
            enabled: true,
            isOfficial: true,
            isBuiltIn: true,
            updatedAt: 0,
            prompt: '',
            skillPath: '/tmp/docx/SKILL.md',
          },
          {
            id: 'web-search',
            name: '联网搜索',
            description: '搜索公开网页信息。',
            enabled: true,
            isOfficial: true,
            isBuiltIn: true,
            updatedAt: 0,
            prompt: '',
            skillPath: '/tmp/web-search/SKILL.md',
          },
        ],
        activeSkillIds: [],
      },
    },
  });

  return renderToStaticMarkup(
    React.createElement(Provider, {
      store: testStore,
      children: element,
    }),
  );
};

const renderWorkbench = (
  props: React.ComponentProps<typeof WorkspaceWorkbench>,
): string => renderEnterpriseLeadComponent(
  React.createElement(WorkspaceWorkbench, props),
);

const createDeferred = <T,>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} => {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enterprise lead workspace UI helpers', () => {
  test('uses entry home as the default enterprise lead workspace screen', () => {
    expect(EnterpriseLeadWorkspaceScreen.Entry).toBe('entry');
  });

  test('uses focused shell before entering a concrete workspace', () => {
    expect(getShellModeForEnterpriseLeadWorkspaceScreen(
      EnterpriseLeadWorkspaceScreen.Entry,
    )).toBe(EnterpriseLeadWorkspaceShellMode.Focused);
    expect(getShellModeForEnterpriseLeadWorkspaceScreen(
      EnterpriseLeadWorkspaceScreen.Create,
    )).toBe(EnterpriseLeadWorkspaceShellMode.Focused);
  });

  test('uses workspace shell inside a concrete workspace', () => {
    expect(getShellModeForEnterpriseLeadWorkspaceScreen(
      EnterpriseLeadWorkspaceScreen.Workspace,
    )).toBe(EnterpriseLeadWorkspaceShellMode.Workspace);
  });

  test('resolves workspace-owned Agent fields with overrides taking precedence', () => {
    const effective = getEffectiveWorkspaceAgent({
      agentId: 'agent-a',
      enabled: true,
      order: 0,
      name: 'Workspace Writer',
      description: 'Workspace description',
      identity: 'Workspace identity',
      systemPrompt: 'Workspace prompt',
      icon: 'briefcase',
      model: 'deepseek/deepseek-chat',
      skillIds: ['docx'],
      overrides: {
        name: 'Edited Writer',
        skillIds: ['web-search'],
      },
    });

    expect(effective.name).toBe('Edited Writer');
    expect(effective.description).toBe('Workspace description');
    expect(effective.model).toBe('deepseek/deepseek-chat');
    expect(effective.skillIds).toEqual(['web-search']);
  });

  test('uses workspace Agent id fallback without marking a missing global Agent', () => {
    const effective = getEffectiveWorkspaceAgent({
      agentId: 'missing-agent',
      enabled: false,
      order: 2,
      overrides: {},
    });

    expect(effective.id).toBe('missing-agent');
    expect(effective.name).toBe('missing-agent');
    expect(effective.description).toBe('');
    expect(effective.enabled).toBe(false);
    expect(effective.order).toBe(2);
    expect(effective.missing).toBe(false);
  });

  test('defines exactly two entry home actions', () => {
    expect(getEntryHomeActions()).toEqual([
      {
        id: 'create',
        titleKey: 'enterpriseLeadEntryCreateTitle',
        descriptionKey: 'enterpriseLeadEntryCreateDesc',
        actionKey: 'enterpriseLeadEntryCreateAction',
        tone: 'primary',
      },
      {
        id: 'history',
        titleKey: 'enterpriseLeadEntryHistoryTitle',
        descriptionKey: 'enterpriseLeadEntryHistoryDesc',
        actionKey: 'enterpriseLeadEntryHistoryAction',
        tone: 'surface',
      },
    ]);
  });

  test('returns defensive copies of entry home actions', () => {
    const actions = getEntryHomeActions();

    actions[0].titleKey = 'mutatedTitle';

    expect(getEntryHomeActions()[0].titleKey).toBe('enterpriseLeadEntryCreateTitle');
  });

  test('renders entry home according to the approved centered prototype', () => {
    const html = renderToStaticMarkup(React.createElement(WorkspaceEntryHome, {
      workspaces: [createWorkspace('workspace-1')],
      isLoadingWorkspaces: false,
      workspaceListError: '',
      onCreate: vi.fn(),
      onHistoryOpen: vi.fn(),
      onOpen: vi.fn(),
      onDeleteWorkspace: vi.fn(),
    }));

    expect(html).toContain('宇智能AI');
    expect(html).toContain('开始使用');
    expect(html).toContain('创建或者打开一个工作空间。');
    expect(html).toContain('工作空间操作');
    expect(html).toContain('创建工作区');
    expect(html).toContain('打开历史工作区');
    expect(html).toContain('yuzhh-logo-ai-concept');
    expect(html).toContain('bg-background');
    expect(html).not.toContain('bg-[#fbfcfe]');
    expect(html).not.toContain('>线索工作区</h1>');
  });

  test('refreshes history when opening the historical workspace entry', () => {
    expect(shouldRefreshHistoryOnEntryAction(EnterpriseLeadEntryAction.History)).toBe(true);
    expect(shouldRefreshHistoryOnEntryAction(EnterpriseLeadEntryAction.Create)).toBe(false);
  });

  test('sorts historical workspaces by recent update', () => {
    const oldest = {
      ...createWorkspace('oldest'),
      updatedAt: '2026-07-01T00:00:00.000Z',
    };
    const newest = {
      ...createWorkspace('newest'),
      updatedAt: '2026-07-04T00:00:00.000Z',
    };
    const middle = {
      ...createWorkspace('middle'),
      updatedAt: '2026-07-02T00:00:00.000Z',
    };
    const input = [oldest, newest, middle];

    expect(sortWorkspacesByRecentUpdate(input).map(item => item.id)).toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
    expect(input.map(item => item.id)).toEqual([
      'oldest',
      'newest',
      'middle',
    ]);
  });

  test('computes historical workspace modal state', () => {
    expect(getHistoryModalState({
      isLoading: true,
      error: '',
      workspaces: [],
    })).toBe(EnterpriseLeadWorkspaceHistoryState.Loading);

    expect(getHistoryModalState({
      isLoading: false,
      error: 'failed',
      workspaces: [],
    })).toBe(EnterpriseLeadWorkspaceHistoryState.Error);

    expect(getHistoryModalState({
      isLoading: false,
      error: '',
      workspaces: [],
    })).toBe(EnterpriseLeadWorkspaceHistoryState.Empty);

    expect(getHistoryModalState({
      isLoading: false,
      error: '',
      workspaces: [createWorkspace('workspace-1')],
    })).toBe(EnterpriseLeadWorkspaceHistoryState.List);
  });

  test('renders historical workspace actions and separates delete confirmation into a dialog', () => {
    const workspace = createWorkspace('workspace-1');
    const listHtml = renderToStaticMarkup(React.createElement(WorkspaceHistoryList, {
      historyState: EnterpriseLeadWorkspaceHistoryState.List,
      sortedWorkspaces: [workspace],
      activeActionsWorkspaceId: workspace.id,
      isDeletingWorkspaceId: null,
      onOpen: vi.fn(),
      onCreate: vi.fn(),
      onToggleActions: vi.fn(),
      onRequestDelete: vi.fn(),
    }));
    const dialogHtml = renderToStaticMarkup(React.createElement(WorkspaceDeleteConfirmDialog, {
      workspace,
      isDeletingWorkspaceId: null,
      deleteError: '',
      onCancelDelete: vi.fn(),
      onConfirmDelete: vi.fn(),
    }));

    expect(listHtml).toContain('打开工作区操作');
    expect(listHtml).toContain('删除工作区');
    expect(listHtml).not.toContain('删除「Workspace workspace-1」？');
    expect(dialogHtml).toContain('role="dialog"');
    expect(dialogHtml).toContain('aria-modal="true"');
    expect(dialogHtml).toContain('删除「Workspace workspace-1」？');
    expect(dialogHtml).toContain('删除后会移除这个空间的资料、知识库、Agent 设置和创作记录，不能恢复。');
  });

  test('uses first launch mode when no workspaces exist', () => {
    expect(getLaunchMode([])).toBe(EnterpriseLeadWorkspaceLaunchMode.FirstLaunch);
    expect(getLaunchMode([createWorkspace('workspace-1')])).toBe(
      EnterpriseLeadWorkspaceLaunchMode.Returning,
    );
  });

  test('routes each workspace creation start mode to its own branch screen', () => {
    expect(getWorkspaceCreateBranchScreen(WorkspaceCreateStartMode.Material)).toBe(
      WorkspaceCreateBranchScreen.Material,
    );
    expect(getWorkspaceCreateBranchScreen(WorkspaceCreateStartMode.Paste)).toBe(
      WorkspaceCreateBranchScreen.Paste,
    );
    expect(getWorkspaceCreateBranchScreen(WorkspaceCreateStartMode.Blank)).toBe(
      WorkspaceCreateBranchScreen.Blank,
    );
  });

  test('renders escape controls on the workspace creation start step', () => {
    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceCreate, {
        onCreated: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(markup).toContain('返回开始页');
    expect(markup).toContain('取消创建');
    expect(markup).toContain('border-t border-border/70 pt-5');
    expect(markup).toContain('flex flex-col-reverse gap-2 sm:flex-row');
  });

  test('builds a blank manual workspace draft without initial profile data', () => {
    const draft = buildManualEnterpriseLeadWorkspaceDraft({
      name: '  华东制造业拓客计划  ',
      mode: WorkspaceCreateStartMode.Blank,
      sourceLabel: '空白创建',
    });

    expect(draft.name).toBe('华东制造业拓客计划');
    expect(draft.type).toBe('enterprise_lead');
    expect(draft.source).toEqual({
      kind: 'blank',
      label: '空白创建',
      text: undefined,
    });
    expect(draft.profile).toEqual(emptyProfile());
    expect(draft.enabledAgentRoles).toEqual([]);
    expect(draft.workspaceAgents).toEqual([]);
  });

  test('builds a pasted manual workspace draft with trimmed source text', () => {
    const draft = buildManualEnterpriseLeadWorkspaceDraft({
      name: '',
      mode: WorkspaceCreateStartMode.Paste,
      sourceLabel: '粘贴内容',
      sourceText: '  目标客户是汽车零部件企业。  ',
    });

    expect(draft.name).toBe('粘贴内容');
    expect(draft.source).toEqual({
      kind: 'manual',
      label: '粘贴内容',
      text: '目标客户是汽车零部件企业。',
    });
  });

  test('computes profile completion from six populated profile groups', () => {
    const profile = emptyProfile();
    profile.companySummary = 'Industrial sales workflow automation';
    profile.productList = ['Lead Radar'];
    profile.targetCustomers = ['Manufacturing sales teams'];

    expect(getWorkspaceCompletionPercent(profile)).toBe(50);
  });

  test('treats paired profile fields as one completed group', () => {
    const profile = emptyProfile();
    profile.productCapabilities = ['Maps buyer intent'];
    profile.applicationScenarios = ['New market expansion'];
    profile.contactRules = ['No medical claims'];

    expect(getWorkspaceCompletionPercent(profile)).toBe(50);
  });

  test('summarizes draft name, products, and target customers', () => {
    const profile = emptyProfile();
    profile.productList = ['Lead Radar', 'Account Briefs'];
    profile.targetCustomers = ['Channel teams', 'Sales leaders'];

    expect(
      summarizeWorkspaceDraft(createDraft(profile), {
        productsFallback: 'No products',
        customersFallback: 'No customers',
        targetCustomersPrefix: 'For: ',
      }),
    ).toEqual({
      name: 'North Star Leads',
      products: 'Lead Radar, Account Briefs',
      targetCustomers: 'For: Channel teams, Sales leaders',
    });
  });

  test('uses caller-provided fallbacks for empty draft summary fields', () => {
    expect(
      summarizeWorkspaceDraft(createDraft(emptyProfile()), {
        productsFallback: 'No products',
        customersFallback: 'No customers',
        targetCustomersPrefix: 'For: ',
      }),
    ).toEqual({
      name: 'North Star Leads',
      products: 'No products',
      targetCustomers: 'For: No customers',
    });
  });

  test('builds workspace knowledge sections from profile and snapshot', () => {
    const workspace = createWorkspace('workspace-1');
    workspace.profile.companySummary = '精密制造企业，主营高精度零部件加工。';
    workspace.profile.productList = ['五轴加工服务'];
    const snapshot = {
      ...createSnapshot(workspace),
      deliverables: [{
        id: 'deliverable-1',
        runId: 'run-1',
        workspaceId: workspace.id,
        kind: EnterpriseLeadDeliverableKind.ContentDraft,
        role: EnterpriseLeadAgentRole.ContentPlanning,
        title: '销售触达草稿',
        summary: '面向长三角制造客户的触达话术。',
        payload: {},
        status: 'draft' as const,
        createdAt: '2026-07-04T01:00:00.000Z',
        updatedAt: '2026-07-04T01:00:00.000Z',
      }],
    };

    const sections = getWorkspaceKnowledgeSections(workspace, snapshot);

    expect(sections.map(section => section.id)).toContain('company');
    expect(sections.map(section => section.id)).toContain('products');
    expect(sections.find(section => section.id === 'company')?.items[0]?.text)
      .toContain('精密制造企业');
  });

  test('maps editable knowledge kinds to workspace profile fields', () => {
    expect(getEditableKnowledgeField(EnterpriseLeadKnowledgeItemKind.CompanySummary))
      .toEqual({ field: 'companySummary', multiValue: false });
    expect(getEditableKnowledgeField(EnterpriseLeadKnowledgeItemKind.Product))
      .toEqual({ field: 'productList', multiValue: true });
    expect(getEditableKnowledgeField(EnterpriseLeadKnowledgeItemKind.ContactRule))
      .toEqual({ field: 'contactRules', multiValue: true });
    expect(getEditableKnowledgeField(EnterpriseLeadKnowledgeItemKind.Source)).toBeNull();
  });

  test('summarizes creation record counts from run summary', () => {
    const summary = getCreationRecordSummary({
      run: {
        ...createRun('workspace-1'),
        id: 'run-counts',
      },
      taskCount: 3,
      deliverableCount: 2,
      todoCount: 4,
      riskCount: 1,
    });

    expect(summary.meta).toEqual([
      expect.objectContaining({ id: 'tasks', count: 3 }),
      expect.objectContaining({ id: 'deliverables', count: 2 }),
      expect.objectContaining({ id: 'todos', count: 4 }),
      expect.objectContaining({ id: 'risks', count: 1 }),
    ]);
  });

  test('returns localized label metadata for known agent roles', () => {
    expect(getAgentRoleLabel(EnterpriseLeadAgentRole.RiskReview)).toMatchObject({
      role: EnterpriseLeadAgentRole.RiskReview,
      titleKey: 'enterpriseLeadAgentRoleRiskReviewTitle',
      shortLabelKey: 'enterpriseLeadAgentRoleRiskReviewShortLabel',
      descriptionKey: 'enterpriseLeadAgentRoleRiskReviewDescription',
      inputKey: 'enterpriseLeadAgentRoleRiskReviewInput',
      outputKey: 'enterpriseLeadAgentRoleRiskReviewOutput',
      safetyCritical: true,
    });
  });

  test('returns display metadata for dynamic workspace Agent tasks', () => {
    const display = getEnterpriseLeadTaskDisplay({
      role: 'agent-risk',
      agentSnapshot: {
        agentId: 'agent-risk',
        name: '空间风控 Agent',
        description: '检查外发内容风险',
        identity: '风控专家',
        systemPrompt: '只做风险审核',
        icon: 'shield',
        model: 'gpt-4.1',
        skillIds: ['risk-check'],
      },
    });

    expect(display).toMatchObject({
      role: 'agent-risk',
      titleText: '空间风控 Agent',
      descriptionText: '检查外发内容风险',
      outputText: '空间风控 Agent',
      safetyCritical: true,
    });
    expect(display.titleKey).toBeUndefined();
  });

  test('renders side panel no-role todo with dynamic task snapshot label', () => {
    const task: EnterpriseLeadAgentTask = {
      ...createTask('workspace-1'),
      id: 'task-dynamic',
      role: 'agent-content',
      workspaceAgentId: 'agent-content',
      agentSnapshot: {
        agentId: 'agent-content',
        name: '动态内容 Agent',
        description: '负责内容草稿',
        identity: '内容专家',
        systemPrompt: '只写草稿',
        icon: 'pen',
        model: 'gpt-4.1',
        skillIds: [],
      },
    };
    const html = renderToStaticMarkup(React.createElement(WorkspaceSidePanel, {
      tasks: [task],
      pendingVersions: [],
      todos: [{
        id: `task:${task.id}:todo:0`,
        runId: 'run-1',
        workspaceId: 'workspace-1',
        kind: EnterpriseLeadTodoKind.MissingInfo,
        title: '补充素材',
        description: '补充案例图片。',
        role: null,
        status: 'open',
        createdAt: '2026-07-04T00:00:00.000Z',
        updatedAt: '2026-07-04T00:00:00.000Z',
      }],
      deliverables: [],
      archives: [],
      onApplyVersion: vi.fn(),
    }));

    expect(html).toContain('动态内容 Agent');
    expect(html).not.toContain('agent-content');
  });

  test('maps task statuses to agent card tone classes', () => {
    expect(getAgentCardTone(EnterpriseLeadTaskStatus.Running).containerClassName)
      .toContain('border-primary');
    expect(getAgentCardTone(EnterpriseLeadTaskStatus.Error).statusClassName)
      .toContain('text-red');
    expect(getAgentCardTone(EnterpriseLeadTaskStatus.Stale).actionClassName)
      .toContain('bg-amber');
  });

  test('returns status label keys with stale state taking priority', () => {
    expect(getAgentStatusLabelKey(EnterpriseLeadTaskStatus.NeedsInput)).toBe(
      'enterpriseLeadAgentStatusNeedsInput',
    );
    expect(getAgentStatusLabelKey(EnterpriseLeadTaskStatus.Completed, true)).toBe(
      'enterpriseLeadAgentStatusStale',
    );
  });

  test('detects task output from summary text or output payload', () => {
    expect(hasTaskOutput({ summary: '  Done  ', outputPayload: {} })).toBe(true);
    expect(hasTaskOutput({ summary: '', outputPayload: { draft: 'Draft text' } })).toBe(true);
    expect(hasTaskOutput({ summary: '', outputPayload: {} })).toBe(false);
  });

  test('rejects stale workspace operation tokens after workspace or revision changes', () => {
    const token = {
      workspaceId: 'workspace-1',
      revision: 2,
    };

    expect(isWorkspaceOperationCurrent(token, 'workspace-1', 2, true)).toBe(true);
    expect(isWorkspaceOperationCurrent(token, 'workspace-2', 2, true)).toBe(false);
    expect(isWorkspaceOperationCurrent(token, 'workspace-1', 3, true)).toBe(false);
    expect(isWorkspaceOperationCurrent(token, 'workspace-1', 2, false)).toBe(false);
  });

  test('defines workbench sidebar navigation with knowledge base entry', () => {
    expect(getWorkbenchSidebarItems().map(item => item.labelKey)).toEqual([
      'enterpriseLeadWorkbenchNavWorkbench',
      'enterpriseLeadWorkbenchNavAiChat',
      'enterpriseLeadWorkbenchNavSearch',
      'enterpriseLeadWorkbenchNavKnowledgeBase',
      'enterpriseLeadWorkbenchNavCreationRecords',
      'enterpriseLeadWorkbenchNavAgentManagement',
      'enterpriseLeadWorkbenchNavSettings',
    ]);
  });

  test('defines workspace internal pages in sidebar order', () => {
    expect(getWorkspaceInternalPages().map(page => page.id)).toEqual([
      'workbench',
      'ai_chat',
      'search',
      'knowledge_base',
      'creation_records',
      'agent_management',
      'settings',
    ]);
  });

  test('resolves start dashboard state for material workspaces', () => {
    const workspace = {
      ...createWorkspace('material'),
      profile: {
        ...emptyProfile(),
        companySummary: '服务汽车零部件企业的工业自动化方案。',
        targetCustomers: ['华东汽车零部件厂'],
        contactRules: ['避免夸大交付周期'],
      },
      extractionSources: [
        {
          kind: EnterpriseLeadExtractionSourceKind.File,
          label: '制造业客户名单.csv',
          text: '客户名单',
        },
      ],
    };

    expect(getWorkspaceStartSourceState(workspace)).toBe(
      EnterpriseLeadWorkspaceStartSourceState.Material,
    );
    expect(getWorkspaceStartReadiness(workspace).map(item => item.status)).toEqual([
      'ready',
      'ready',
      'ready',
      'optional',
    ]);
    expect(getWorkspaceStartActionTarget(
      EnterpriseLeadWorkspaceStartAction.StartWorkflow,
      EnterpriseLeadWorkspaceStartSourceState.Material,
    )).toBe(EnterpriseLeadWorkspaceInternalPage.AiChat);
  });

  test('resolves start dashboard state for pasted-content workspaces', () => {
    const workspace = {
      ...createWorkspace('paste'),
      profile: {
        ...emptyProfile(),
        targetCustomers: ['跨境 SaaS 增长团队'],
      },
      extractionSources: [
        {
          kind: EnterpriseLeadExtractionSourceKind.Manual,
          label: '粘贴内容',
          text: '跨境 SaaS 线索池背景',
        },
      ],
    };

    expect(getWorkspaceStartSourceState(workspace)).toBe(
      EnterpriseLeadWorkspaceStartSourceState.Paste,
    );
    expect(getWorkspaceStartReadiness(workspace)[0].status).toBe('ready');
    expect(getWorkspaceStartReadiness(workspace)[1].status).toBe('ready');
    expect(getWorkspaceStartActionTarget(
      EnterpriseLeadWorkspaceStartAction.ReviewProfile,
      EnterpriseLeadWorkspaceStartSourceState.Paste,
    )).toBe(EnterpriseLeadWorkspaceInternalPage.KnowledgeBase);
  });

  test('guides blank workspaces back to material before workflow actions', () => {
    const workspace = {
      ...createWorkspace('blank'),
      extractionSources: [
        {
          kind: EnterpriseLeadExtractionSourceKind.Blank,
          label: '空白创建',
        },
      ],
    };

    expect(getWorkspaceStartSourceState(workspace)).toBe(
      EnterpriseLeadWorkspaceStartSourceState.Blank,
    );
    expect(getWorkspaceStartReadiness(workspace).map(item => item.status)).toEqual([
      'warning',
      'warning',
      'optional',
      'optional',
    ]);
    expect(getWorkspaceStartActionTarget(
      EnterpriseLeadWorkspaceStartAction.StartWorkflow,
      EnterpriseLeadWorkspaceStartSourceState.Blank,
    )).toBe(EnterpriseLeadWorkspaceInternalPage.KnowledgeBase);
  });

  test('renders workspace shell as an in-space action sidebar', () => {
    const workspace = createWorkspace('sidebar');

    const markup = renderEnterpriseLeadComponent(
      React.createElement(
        WorkspaceShell,
        {
          workspace,
          activePage: 'ai_chat',
          onPageChange: vi.fn(),
          children: React.createElement('div', null, 'Active page body'),
        },
      ),
    );

    expect(markup).toContain('新对话');
    expect(markup).toContain('搜索');
    expect(markup).toContain('工作台');
    expect(markup).toContain('知识库');
    expect(markup).toContain('空间设置');
    expect(markup).not.toContain('AI 对话');
    expect(markup).not.toContain('企业获客空间');
    expect(markup).not.toContain(workspace.name);
  });

  test('renders a persistent exit action at the bottom of the workspace shell sidebar', () => {
    const workspace = createWorkspace('sidebar');

    const markup = renderEnterpriseLeadComponent(
      React.createElement(
        WorkspaceShell,
        {
          workspace,
          activePage: 'workbench',
          onPageChange: vi.fn(),
          onExitWorkspace: vi.fn(),
          children: React.createElement('div', null, 'Active page body'),
        },
      ),
    );

    expect(markup).toContain('返回空间列表');
    expect(markup).toContain('aria-label="返回空间列表"');
    expect(markup).toContain('shrink-0 border-t border-border pt-3');
  });

  test('renders recent execution records in the workspace shell sidebar', () => {
    const workspace = createWorkspace('sidebar');
    const recentRuns = [
      createRunSummary(workspace.id, {
        id: 'run-recent',
        userGoal: '帮我找长三角机械厂线索',
        status: EnterpriseLeadRunStatus.Running,
      }),
      {
        ...createRunSummary(workspace.id, {
          id: 'run-needs-input',
          userGoal: '整理本周可跟进的机械厂线索',
          status: EnterpriseLeadRunStatus.NeedsInput,
        }),
        todoCount: 7,
        riskCount: 5,
      },
    ];

    const markup = renderEnterpriseLeadComponent(
      React.createElement(
        WorkspaceShell,
        {
          workspace,
          activePage: 'ai_chat',
          onPageChange: vi.fn(),
          recentRuns,
          onRecordSelect: vi.fn(),
          children: React.createElement('div', null, 'Active page body'),
        },
      ),
    );

    expect(markup).toContain('对话记录');
    expect(markup).toContain('2 条');
    expect(markup).toContain('全部');
    expect(markup).toContain('帮我找长三角机械厂线索');
    expect(markup).toContain('运行中');
    expect(markup).toContain('2 成果');
    expect(markup).toContain('1 待办');
    expect(markup).toContain('0 风险');
    expect(markup).toContain('整理本周可跟进的机械厂线索');
    expect(markup).toContain('需补充');
    expect(markup).toContain('7 待办');
    expect(markup).toContain('5 风险');
  });

  test('keeps an actionable empty state for workspace shell conversation records', () => {
    const workspace = createWorkspace('sidebar-empty');

    const markup = renderEnterpriseLeadComponent(
      React.createElement(
        WorkspaceShell,
        {
          workspace,
          activePage: 'workbench',
          onPageChange: vi.fn(),
          recentRuns: [],
          children: React.createElement('div', null, 'Active page body'),
        },
      ),
    );

    expect(markup).toContain('对话记录');
    expect(markup).toContain('还没有对话记录');
    expect(markup).toContain('完成一次工作台任务后会出现在这里。');
  });

  test('renders workspace start dashboard with next actions and readiness', () => {
    const workspace = {
      ...createWorkspace('start'),
      profile: {
        ...emptyProfile(),
        targetCustomers: ['华东汽车零部件厂'],
      },
      extractionSources: [
        {
          kind: EnterpriseLeadExtractionSourceKind.File,
          label: '制造业客户名单.csv',
          text: '包含客户名称、区域和行业标签。',
        },
      ],
    };
    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceStart, {
        workspace,
        onOpenPage: vi.fn(),
      }),
    );

    expect(markup).toContain('已创建');
    expect(markup).toContain('上传资料');
    expect(markup).toContain('下一步');
    expect(markup).toContain('查看业务画像');
    expect(markup).toContain('准备进度');
    expect(markup).toContain('当前资料');
    expect(markup).toContain('制造业客户名单.csv');
  });

  test('prefers the requested creation record when it exists', () => {
    const summaries = [
      createRunSummary('workspace-1', { id: 'run-newest' }),
      createRunSummary('workspace-1', { id: 'run-target' }),
    ];

    expect(getInitialCreationRecordId(summaries, 'run-target')).toBe('run-target');
    expect(getInitialCreationRecordId(summaries, 'missing-run')).toBe('run-newest');
    expect(getInitialCreationRecordId([], 'run-target')).toBeNull();
  });

  test('orders creation record detail as a result center', () => {
    expect(getCreationRecordResultSections().map(section => section.id)).toEqual([
      'summary',
      'deliverables',
      'risks',
      'todos',
      'archive',
    ]);
    expect(getCreationRecordResultSections().map(section => section.titleKey)).toEqual([
      'enterpriseLeadCreationResultSummary',
      'enterpriseLeadCreationDeliverablePackage',
      'enterpriseLeadCreationRisks',
      'enterpriseLeadHumanTodos',
      'enterpriseLeadCreationArchive',
    ]);
  });

  test('uses workbench as default workspace internal page', () => {
    expect(getDefaultWorkspaceInternalPage()).toBe('workbench');
  });

  test('defines icon navigation for the workbench rail', () => {
    expect(getWorkbenchSidebarItems().map(item => item.icon)).toEqual([
      'dashboard',
      'chat',
      'search',
      'knowledge',
      'records',
      'agents',
      'settings',
    ]);
  });

  test('uses the expanded workbench sidebar as the default mode', () => {
    expect(getDefaultWorkbenchSidebarMode()).toBe(
      EnterpriseLeadWorkbenchSidebarMode.Expanded,
    );
    expect(getWorkbenchSidebarWidth(EnterpriseLeadWorkbenchSidebarMode.Expanded)).toBe(196);
    expect(getWorkbenchSidebarWidth(EnterpriseLeadWorkbenchSidebarMode.Collapsed)).toBe(76);
  });

  test('returns defensive copies of workbench sidebar items', () => {
    const sidebarItems = getWorkbenchSidebarItems();

    sidebarItems[0].labelKey = 'mutatedNavLabel';
    sidebarItems[0].icon = 'settings';

    expect(getWorkbenchSidebarItems()[0].labelKey).toBe('enterpriseLeadWorkbenchNavWorkbench');
    expect(getWorkbenchSidebarItems()[0].icon).toBe('dashboard');
  });

  test('defines management cards for the fixed enterprise lead Agent team', () => {
    const agentItems = getWorkbenchAgentItems();

    expect(agentItems).toHaveLength(9);
    expect(agentItems.map(item => item.role)).toEqual([
      EnterpriseLeadAgentRole.Controller,
      EnterpriseLeadAgentRole.ProductUnderstanding,
      EnterpriseLeadAgentRole.OpportunityRadar,
      EnterpriseLeadAgentRole.ContentPlanning,
      EnterpriseLeadAgentRole.SocialOperation,
      EnterpriseLeadAgentRole.SalesHandoff,
      EnterpriseLeadAgentRole.RiskReview,
      EnterpriseLeadAgentRole.ProjectSummary,
      EnterpriseLeadAgentRole.ProjectArchive,
    ]);
    expect(agentItems[0]).toMatchObject({
      roleLabelKey: 'enterpriseLeadWorkbenchAgentControllerRole',
      capabilitySummaryKey: 'enterpriseLeadWorkbenchAgentControllerCapabilitySummary',
    });
  });

  test('returns defensive copies of workbench agent items', () => {
    const agentItems = getWorkbenchAgentItems();

    agentItems[0].roleLabelKey = 'mutatedAgentRole';

    expect(getWorkbenchAgentItems()[0].roleLabelKey).toBe(
      'enterpriseLeadWorkbenchAgentControllerRole',
    );
  });

  test('defines workbench configuration sections with management actions', () => {
    const sections = getWorkbenchConfigSections();

    expect(sections.map(section => section.actionKey)).toEqual([
      'enterpriseLeadWorkbenchManageSkills',
      'enterpriseLeadWorkbenchConfigureResearch',
      'enterpriseLeadWorkbenchManagePlatforms',
    ]);
    expect(sections.flatMap(section => section.items)).toHaveLength(13);
  });

  test('returns defensive copies of workbench configuration sections and items', () => {
    const sections = getWorkbenchConfigSections();

    sections[0].titleKey = 'mutatedSectionTitle';
    sections[0].items[0].titleKey = 'mutatedItemTitle';
    sections[0].items.pop();

    const freshSections = getWorkbenchConfigSections();
    expect(freshSections[0].titleKey).toBe('enterpriseLeadWorkbenchSkillsTitle');
    expect(freshSections[0].items[0].titleKey).toBe(
      'enterpriseLeadWorkbenchSkillDocumentParsing',
    );
    expect(freshSections[0].items).toHaveLength(4);
  });

  test('defines compact workbench navigation for single-screen management', () => {
    expect(getWorkbenchLayoutSpec()).toMatchObject({
      minimumContentWidth: 1168,
      sidebarWidth: 196,
      expandedSidebarWidth: 196,
      collapsedSidebarWidth: 76,
      agentPanelMinWidth: 552,
      configPanelMinWidth: 388,
      configPanelMaxWidth: 460,
      agentColumnCount: 3,
      agentCardRowHeight: 136,
      agentRowCount: 3,
      configColumnCount: 1,
      usesNestedScrollRegion: true,
    });
  });

  test('does not render a nested workbench sidebar', () => {
    const markup = renderWorkbench({
      workspace: createWorkspace('workspace-1'),
    });

    expect(markup).not.toContain('data-workbench-sidebar-mode');
    expect(markup).not.toContain('grid-template-columns:196px');
  });

  test('omits the workspace identity header from the workbench sidebar', () => {
    const markup = renderWorkbench({
      workspace: createWorkspace('workspace-1'),
    });

    expect(markup).not.toContain('Workspace workspace-1');
  });

  test('omits the workbench sidebar collapse control', () => {
    const markup = renderWorkbench({
      workspace: createWorkspace('workspace-1'),
    });

    expect(markup).not.toContain('收起工作区');
    expect(markup).not.toContain('展开工作区');
  });

  test('renders agent management as a workspace-bound Agent list', () => {
    const markup = renderWorkbench({
      workspace: createWorkspace('workspace-1', [], [{
        agentId: 'agent-a',
        enabled: true,
        order: 0,
        overrides: {
          name: 'Workspace Writer',
          description: 'Workspace-only writer.',
        },
      }]),
    });

    expect(markup).toContain('工作区 Agent 管理');
    expect(markup).toContain('Workspace Writer');
    expect(markup).toContain('Workspace-only writer.');
    expect(markup).toContain('role="table"');
    expect(markup).toContain('role="columnheader"');
    expect(markup).toContain('Agent');
    expect(markup).toContain('职责');
    expect(markup).toContain('模型 / 技能');
    expect(markup).toContain('状态');
    expect(markup).toContain('操作');
    expect(markup).toContain('仅当前空间生效');
    expect(markup).toContain('已启用');
    expect(markup).not.toContain('添加已有 Agent');
    expect(markup).toContain('编辑');
    expect(markup).toContain('更多操作');
    expect(markup).not.toContain('移出工作区');
    expect(markup).toContain('大模型');
    expect(markup).toContain('技能');
    expect(markup).toContain('调研');
    expect(markup).toContain('内容来源');
    expect(markup).toContain('空间设置');
    expect(markup).not.toContain('任务执行');
    expect(markup).not.toContain('还没有当前任务');
    expect(markup).not.toContain('启动 Agent 任务');
    expect(markup).not.toContain('文档处理');
    expect(markup).not.toContain('Tavily');
    expect(markup).not.toContain('Firecrawl');
    expect(markup).not.toContain('DeepSeek');
  });

  test('renders workbench configuration status from workspace setting readiness', () => {
    const workspace = createWorkspace('workspace-1');
    workspace.settings.model.providers.deepseek = {
      enabled: true,
      apiKey: 'sk-deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai',
      models: [{
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
      }],
    };
    workspace.settings.model.defaultModelProvider = 'deepseek';
    workspace.settings.model.defaultModel = 'deepseek-chat';
    workspace.settings.externalResearch.providers.tavily.enabled = true;
    workspace.settings.externalResearch.providers.tavily.apiKey = 'tvly-key';
    workspace.settings.contentPlatforms.platforms[
      EnterpriseLeadContentOutputPlatformId.XiaohongshuDraft
    ].enabled = true;
    workspace.settings.contentPlatforms.platforms[
      EnterpriseLeadContentOutputPlatformId.XiaohongshuDraft
    ].token = 'xhs-token';

    const markup = renderWorkbench({ workspace });

    expect(markup).toContain('大模型');
    expect(markup).toContain('调研');
    expect(markup).toContain('内容来源');
    expect(markup.match(/可用/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(markup).not.toContain('0 个来源');
  });

  test('renders low-frequency Agent actions inside the row menu', () => {
    const noop = (): void => undefined;
    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceAgentActionsMenu, {
        agentId: 'agent-a',
        enabled: true,
        canMoveUp: true,
        canMoveDown: false,
        onToggle: noop,
        onMoveUp: noop,
        onMoveDown: noop,
        onRemove: noop,
      }),
    );

    expect(markup).toContain('停用');
    expect(markup).toContain('上移 Agent');
    expect(markup).toContain('下移 Agent');
    expect(markup).toContain('移出工作区');
  });

  test('renders workspace Agent management as the default workbench surface', () => {
    const workspace = createWorkspace('workspace-1', [], [{
      agentId: 'agent-a',
      enabled: true,
      order: 0,
      overrides: {
        name: 'Workspace Writer',
      },
    }]);
    const snapshot: EnterpriseLeadWorkspaceSnapshot = {
      workspace,
      currentRun: null,
      tasks: [],
      pendingVersions: [],
      deliverables: [],
      todos: [],
      archives: [],
    };

    const markup = renderWorkbench({
      workspace,
      initialSnapshot: snapshot,
    });

    expect(markup).toContain('工作区 Agent 管理');
    expect(markup).toContain('Workspace Writer');
    expect(markup).not.toContain('任务执行');
    expect(markup).not.toContain('还没有当前任务');
    expect(markup).not.toContain('启动 Agent 任务');
  });

  test('renders legacy enabled roles as editable workspace-owned Agents', () => {
    const markup = renderWorkbench({
      workspace: createWorkspace('workspace-1', [
        EnterpriseLeadAgentRole.Controller,
      ]),
    });

    expect(markup).toContain('项目总控 Agent');
    expect(markup).toContain('编辑');
    expect(markup).toContain('工作区内生效');
    expect(markup).not.toContain('旧版角色');
    expect(markup).not.toContain('添加已有 Agent');
  });

  test('renders default execution Agents as editable workspace-owned Agents', () => {
    const markup = renderWorkbench({
      workspace: createWorkspace('workspace-1', [
        EnterpriseLeadAgentRole.ProductUnderstanding,
      ]),
    });

    expect(markup).toContain('产品理解 Agent');
    expect(markup).toContain('编辑');
    expect(markup).toContain('工作区内生效');
    expect(markup).not.toContain('旧版角色');
    expect(markup).not.toContain('添加已有 Agent');
  });

  test('does not leak run task controls into agent management cards', () => {
    const workspace = createWorkspace('workspace-1');
    const markup = renderWorkbench({
      workspace,
      initialSnapshot: createSnapshot(workspace),
    });

    expect(markup).toContain('还没有工作区 Agent');
    expect(markup).not.toContain('内容策划 Agent');
    expect(markup).not.toContain('生成小红书、短视频、公众号、产品介绍和销售话术草稿。');
    expect(markup).not.toContain('当前目标');
    expect(markup).not.toContain('交给总控运行');
    expect(markup).not.toContain('归档本次任务');
    expect(markup).not.toContain('已生成本周精密制造获客内容草稿。');
    expect(markup).not.toContain('应用版本');
  });

  test('renders workspace Agent editing as a modal dialog', () => {
    const noop = (): void => undefined;
    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceAgentEditorDialog, {
        draft: {
          name: '产品理解 Agent',
          description: '整理产品资料。',
          identity: '产品专家',
          systemPrompt: '只处理产品理解。',
          model: 'gpt-4.1',
          icon: '产',
          skillIds: 'docx',
        },
        saveState: 'idle',
        onCancel: noop,
        onDraftChange: noop,
        onSave: noop,
      }),
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('编辑工作区 Agent');
    expect(markup).toContain('这里的修改只保存到当前工作空间');
    expect(markup).toContain('基本信息');
    expect(markup).toContain('执行设定');
    expect(markup).toContain('能力配置');
    expect(markup).toContain('产品理解 Agent');
    expect(markup).toContain('保存');
  });

  test('renders workspace settings with provider, skills, research, and platform sections', () => {
    const workspace = createWorkspace('workspace-1');
    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceSettings, { workspace }),
    );

    expect(markup).toContain('大模型厂商配置');
    expect(markup).toContain('本空间默认模型');
    expect(markup).toContain('测试模型连接');
    expect(markup).toContain('技能管理');
    expect(markup).toContain('外部调研能力管理');
    expect(markup).toContain('测试连接');
    expect(markup).toContain('国内内容来源');
    expect(markup).toContain('内容平台接入');
    expect(markup).toContain('小红书草稿');
    expect(markup).toContain('销售私信 / 企微');
    expect(markup).toContain('输出规则');
    expect(markup).toContain('外发前风险检查');
    expect(markup).toContain('保存配置');
  });

  test('summarizes workspace settings readiness across model, research, and content platforms', () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.model.providers.deepseek = {
      enabled: true,
      apiKey: 'sk-deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
    };
    settings.model.defaultModelProvider = 'deepseek';
    settings.model.defaultModel = 'deepseek-chat';
    settings.externalResearch.providers.tavily = {
      enabled: true,
      apiKey: 'tvly-key',
    };
    settings.contentPlatforms.platforms.xiaohongshu_draft = {
      ...settings.contentPlatforms.platforms.xiaohongshu_draft,
      enabled: true,
      deliveryMode: EnterpriseLeadContentDeliveryMode.ThirdPartyDraft,
      endpoint: 'https://draft.example.com/xhs',
      token: 'xhs-token',
    };
    settings.contentPlatforms.outputRules.defaultPlatformId =
      EnterpriseLeadContentOutputPlatformId.XiaohongshuDraft;

    expect(getWorkspaceSettingsReadiness(settings).map(item => item.statusKey)).toEqual([
      'enterpriseLeadWorkspaceSettingsReady',
      'enterpriseLeadWorkspaceSettingsReady',
      'enterpriseLeadWorkspaceSettingsReady',
    ]);

    settings.externalResearch.providers.tavily.apiKey = '';
    settings.contentPlatforms.platforms.xiaohongshu_draft.endpoint = '';

    expect(getWorkspaceSettingsReadiness(settings).map(item => item.statusKey)).toEqual([
      'enterpriseLeadWorkspaceSettingsReady',
      'enterpriseLeadWorkspaceSettingsNeedsSetup',
      'enterpriseLeadWorkspaceSettingsNeedsSetup',
    ]);
  });

  test('treats local content output modes as usable without external credentials', () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    const platform = settings.contentPlatforms.platforms[
      EnterpriseLeadContentOutputPlatformId.XiaohongshuDraft
    ];

    expect(platform.deliveryMode).toBe('draft_only');
    expect(getContentPlatformConnectionStatus(platform).statusKey).toBe(
      'enterpriseLeadWorkbenchStatusConfigured',
    );
    expect(getWorkspaceSettingsReadiness(settings).find(item => item.id === 'content')?.statusKey).toBe(
      'enterpriseLeadWorkspaceSettingsReady',
    );
    expect(getWorkspaceSettingsBlockingIssues(settings)).toEqual([]);
  });

  test('blocks remote content delivery modes when required connection fields are missing', () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.contentPlatforms.platforms[
      EnterpriseLeadContentOutputPlatformId.XiaohongshuDraft
    ].deliveryMode = 'third_party_draft';
    settings.contentPlatforms.platforms[
      EnterpriseLeadContentOutputPlatformId.SalesMessage
    ].deliveryMode = 'wecom_draft';
    settings.contentPlatforms.platforms[
      EnterpriseLeadContentOutputPlatformId.WechatArticle
    ].enabled = true;

    expect(getWorkspaceSettingsBlockingIssues(settings).map(issue => issue.statusKey)).toEqual([
      'enterpriseLeadWorkbenchContentPlatformMissingEndpoint',
      'enterpriseLeadWorkbenchContentPlatformMissingEndpoint',
      'enterpriseLeadWorkbenchContentPlatformMissingSecret',
    ]);
  });

  test('identifies missing workspace setting credentials before marking providers ready', () => {
    expect(getModelProviderConnectionStatus('deepseek', {
      enabled: true,
      apiKey: '',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
    }).statusKey).toBe('enterpriseLeadWorkbenchProviderMissingApiKey');

    expect(getModelProviderConnectionStatus('deepseek', {
      enabled: true,
      apiKey: 'sk-deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai',
      models: [],
    }).statusKey).toBe('enterpriseLeadWorkbenchProviderMissingModel');

    expect(getModelProviderConnectionStatus('custom_0', {
      enabled: true,
      apiKey: 'sk-custom',
      baseUrl: '',
      apiFormat: 'openai',
      models: [{ id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3' }],
    }).statusKey).toBe('enterpriseLeadWorkbenchProviderMissingBaseUrl');

    expect(getExternalResearchProviderConnectionStatus({
      enabled: true,
      apiKey: '',
    }).statusKey).toBe('enterpriseLeadWorkbenchResearchMissingApiKey');
  });

  test('collects incomplete enabled workspace settings as save blockers', () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.model.providers.deepseek = {
      enabled: true,
      apiKey: '',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
    };
    settings.externalResearch.providers.tavily = {
      enabled: true,
      apiKey: '',
    };
    settings.contentPlatforms.platforms[
      EnterpriseLeadContentOutputPlatformId.CustomWebhook
    ].enabled = true;

    expect(getWorkspaceSettingsBlockingIssues(settings).map(issue => issue.statusKey)).toEqual([
      'enterpriseLeadWorkbenchProviderMissingApiKey',
      'enterpriseLeadWorkbenchResearchMissingApiKey',
      'enterpriseLeadWorkbenchContentPlatformMissingWebhook',
    ]);
  });

  test('blocks saving when the selected workspace default model is unavailable', () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.model.providers.deepseek = {
      enabled: true,
      apiKey: 'sk-deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
    };
    settings.model.defaultModelProvider = 'deepseek';
    settings.model.defaultModel = 'missing-model';

    expect(getWorkspaceSettingsBlockingIssues(settings).map(issue => issue.statusKey)).toContain(
      'enterpriseLeadWorkbenchDefaultModelUnavailable',
    );
  });

  test('renders workspace settings save blocker before allowing invalid config save', () => {
    const workspace = createWorkspace('workspace-1');
    workspace.settings.model.providers.deepseek = {
      enabled: true,
      apiKey: '',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
    };

    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceSettings, { workspace }),
    );

    expect(markup).toContain('请补齐：缺少 API Key');
  });

  test('renders custom workspace model provider controls', () => {
    const workspace = createWorkspace('workspace-1');
    workspace.settings.model.providers.custom_0 = {
      enabled: true,
      apiKey: 'sk-siliconflow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiFormat: 'openai',
      displayName: '硅基流动',
      models: [{ id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3' }],
    };
    workspace.settings.model.defaultModelProvider = 'custom_0';
    workspace.settings.model.defaultModel = 'deepseek-ai/DeepSeek-V3';

    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceSettings, { workspace }),
    );

    expect(markup).toContain('新增模型厂商');
    expect(markup).toContain('厂商名称');
    expect(markup).toContain('硅基流动');
  });

  test('renders workspace AI chat with configured agent choices', () => {
    const workspace = createWorkspace('workspace-1');
    workspace.settings.externalResearch.providers.tavily = {
      enabled: true,
      apiKey: 'tvly-test',
    };
    workspace.workspaceAgents = [{
      agentId: 'agent-a',
      enabled: true,
      order: 0,
      overrides: {
        name: '内容 Agent',
      },
    }];

    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceAiChat, { workspace }),
    );

    expect(markup).toContain('AI 对话');
    expect(markup).toContain('接下来要完成什么？');
    expect(markup).toContain('本空间能力');
    expect(markup).toContain('允许调研');
    expect(markup).toContain('引用知识库');
    expect(markup).toContain('内容 Agent');
    expect(markup).toContain('发送');
    expect(markup).not.toContain('还没有对话。选择目标 Agent 后发送第一条消息。');
  });

  test('renders workspace AI chat choices without global Agent fallback', () => {
    const workspace = createWorkspace('workspace-1');
    workspace.workspaceAgents = [{
      agentId: 'agent-a',
      enabled: true,
      order: 0,
      overrides: {},
    }];

    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceAiChat, { workspace }),
    );

    expect(markup).toContain('>agent-a<');
    expect(markup).not.toContain('Global Writer');
  });

  test('searches current workspace profile, sources, and workspace Agents', () => {
    const workspace = createWorkspace('workspace-1');
    workspace.profile.productList = ['精密金属支架'];
    workspace.extractionSources = [{
      kind: 'document',
      label: '销售话术文档',
      text: '跟进节奏和禁用表达',
    }];
    workspace.workspaceAgents = [{
      agentId: 'agent-a',
      enabled: true,
      order: 0,
      overrides: {
        name: '商机雷达',
        description: '查找自动化设备厂线索',
      },
    }];

    const productResults = buildWorkspaceSearchResults(workspace, '支架');
    expect(productResults.map(result => result.title)).toContain('精密金属支架');

    const sourceResults = buildWorkspaceSearchResults(workspace, '话术');
    expect(sourceResults.map(result => result.title)).toContain('销售话术文档');

    const agentResults = buildWorkspaceSearchResults(workspace, '商机');
    expect(agentResults.map(result => result.title)).toContain('商机雷达');
  });

  test('renders workspace search page with local workspace results', () => {
    const workspace = createWorkspace('workspace-1');
    workspace.profile.sellingPoints = ['交付稳定'];

    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceSearch, { workspace }),
    );

    expect(markup).toContain('搜索');
    expect(markup).toContain('搜索当前空间的画像、来源和 Agent 配置');
    expect(markup).toContain('交付稳定');
  });

  test('omits disabled workspace Agents from AI chat choices', () => {
    const workspace = createWorkspace('workspace-1');
    workspace.workspaceAgents = [
      {
        agentId: 'agent-a',
        enabled: true,
        order: 0,
        overrides: {
          name: '内容 Agent',
        },
      },
      {
        agentId: 'agent-b',
        enabled: false,
        order: 1,
        overrides: {
          name: '停用 Agent',
        },
      },
    ];

    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceAiChat, { workspace }),
    );

    expect(markup).toContain('内容 Agent');
    expect(markup).not.toContain('停用 Agent');
  });

  test('treats workspace AI chat completions as stale after workspace or request changes', () => {
    const token = {
      requestId: 4,
      workspaceId: 'workspace-a',
    };

    expect(isWorkspaceAiChatRequestCurrent(token, {
      requestId: 4,
      workspaceId: 'workspace-a',
    })).toBe(true);
    expect(isWorkspaceAiChatRequestCurrent(token, {
      requestId: 4,
      workspaceId: 'workspace-b',
    })).toBe(false);
    expect(isWorkspaceAiChatRequestCurrent(token, {
      requestId: 5,
      workspaceId: 'workspace-a',
    })).toBe(false);
  });

  test('workbench agent save sends only workspace agent bindings', async () => {
    const binding = {
      agentId: 'agent-a',
      enabled: true,
      order: 0,
      overrides: {},
    };
    const updateWorkspaceAgents = vi
      .spyOn(enterpriseLeadWorkspaceService, 'updateWorkspaceAgents')
      .mockResolvedValue(createWorkspace('workspace-1'));
    const onSaved = vi.fn();
    const onError = vi.fn();

    await saveWorkspaceAgentBindings({
      workspaceId: 'workspace-1',
      workspaceAgents: [binding],
      isCurrentSave: () => true,
      onSaved,
      onError,
    });

    expect(updateWorkspaceAgents).toHaveBeenCalledWith('workspace-1', [binding]);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'workspace-1' }));
    expect(onError).not.toHaveBeenCalled();
  });

  test('prepares workspace agent bindings with last duplicate agent winning', () => {
    const prepared = prepareWorkspaceAgentBindings([
      {
        agentId: 'agent-a',
        enabled: true,
        order: 10,
        overrides: {
          name: 'First A',
        },
      },
      {
        agentId: 'agent-b',
        enabled: false,
        order: -1,
        overrides: {},
      },
      {
        agentId: 'agent-a',
        enabled: false,
        order: 4,
        overrides: {
          name: 'Last A',
          skillIds: ['web-search'],
        },
      },
    ]);

    expect(prepared).toEqual([
      {
        agentId: 'agent-b',
        enabled: false,
        order: 0,
        overrides: {},
      },
      {
        agentId: 'agent-a',
        enabled: false,
        order: 1,
        overrides: {
          name: 'Last A',
          skillIds: ['web-search'],
        },
      },
    ]);
  });

  test('moves workspace agent bindings and remaps order', () => {
    const moved = moveWorkspaceAgentBinding([
      {
        agentId: 'agent-a',
        enabled: true,
        order: 0,
        overrides: {},
      },
      {
        agentId: 'agent-b',
        enabled: true,
        order: 1,
        overrides: {},
      },
      {
        agentId: 'agent-c',
        enabled: true,
        order: 2,
        overrides: {},
      },
    ], 'agent-b', -1);

    expect(moved.map(binding => [binding.agentId, binding.order])).toEqual([
      ['agent-b', 0],
      ['agent-a', 1],
      ['agent-c', 2],
    ]);
  });

  test('creates a workspace-owned Agent inside the current workspace', async () => {
    const updateWorkspaceAgents = vi
      .spyOn(enterpriseLeadWorkspaceService, 'updateWorkspaceAgents')
      .mockResolvedValue(createWorkspace('workspace-1'));
    const onSaved = vi.fn();
    const onError = vi.fn();

    await createAndBindWorkspaceAgent({
      workspaceId: 'workspace-1',
      workspaceAgents: [],
      name: ' 新 Agent ',
      description: ' 新建的全局模板 ',
      systemPrompt: ' 只处理当前空间的问题 ',
      identity: ' 空间助手 ',
      model: ' gpt-4.1 ',
      icon: ' compass ',
      skillIds: 'web-search, docx',
      isCurrentSave: () => true,
      onSaved,
      onError,
    });

    expect(updateWorkspaceAgents).toHaveBeenCalledWith('workspace-1', [{
      agentId: '新-agent',
      enabled: true,
      order: 0,
      overrides: {
        name: '新 Agent',
        description: '新建的全局模板',
        systemPrompt: '只处理当前空间的问题',
        identity: '空间助手',
        model: 'gpt-4.1',
        icon: 'compass',
        skillIds: ['web-search', 'docx'],
      },
    }]);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'workspace-1' }));
    expect(onError).not.toHaveBeenCalled();
  });

  test('workbench agent save ignores overlapping saves from the same instance', async () => {
    const deferred = createDeferred<EnterpriseLeadWorkspace | null>();
    const updateWorkspaceAgents = vi
      .spyOn(enterpriseLeadWorkspaceService, 'updateWorkspaceAgents')
      .mockReturnValue(deferred.promise);
    const onSaved = vi.fn();
    const onError = vi.fn();
    const saveInFlightRef = { current: false };
    const binding = {
      agentId: 'agent-a',
      enabled: true,
      order: 0,
      overrides: {},
    };

    const firstSave = saveWorkspaceAgentBindings({
      workspaceId: 'workspace-1',
      workspaceAgents: [binding],
      isCurrentSave: () => true,
      onSaved,
      onError,
      saveInFlightRef,
    });
    const secondSave = saveWorkspaceAgentBindings({
      workspaceId: 'workspace-1',
      workspaceAgents: [{
        ...binding,
        enabled: false,
      }],
      isCurrentSave: () => true,
      onSaved,
      onError,
      saveInFlightRef,
    });

    expect(updateWorkspaceAgents).toHaveBeenCalledTimes(1);
    deferred.resolve(createWorkspace('workspace-1'));
    await Promise.all([firstSave, secondSave]);

    expect(updateWorkspaceAgents).toHaveBeenCalledTimes(1);
    expect(saveInFlightRef.current).toBe(false);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  test('rapid workbench save attempt does not invalidate first save callback', async () => {
    const deferred = createDeferred<EnterpriseLeadWorkspace | null>();
    const updatedWorkspace = createWorkspace('workspace-1');
    const updateWorkspaceAgents = vi
      .spyOn(enterpriseLeadWorkspaceService, 'updateWorkspaceAgents')
      .mockReturnValue(deferred.promise);
    const onSaving = vi.fn();
    const onSaved = vi.fn();
    const onError = vi.fn();
    const workspaceIdRef = { current: 'workspace-1' };
    const saveSequenceRef = { current: 0 };
    const saveInFlightRef = { current: false };
    const binding = {
      agentId: 'agent-a',
      enabled: true,
      order: 0,
      overrides: {},
    };

    const firstSave = saveWorkbenchWorkspaceAgents({
      workspaceId: 'workspace-1',
      workspaceAgents: [binding],
      workspaceIdRef,
      saveSequenceRef,
      saveInFlightRef,
      onSaving,
      onSaved,
      onError,
    });
    const secondSave = saveWorkbenchWorkspaceAgents({
      workspaceId: 'workspace-1',
      workspaceAgents: [{
        ...binding,
        enabled: false,
      }],
      workspaceIdRef,
      saveSequenceRef,
      saveInFlightRef,
      onSaving,
      onSaved,
      onError,
    });

    expect(updateWorkspaceAgents).toHaveBeenCalledTimes(1);
    expect(saveSequenceRef.current).toBe(1);
    deferred.resolve(updatedWorkspace);
    await Promise.all([firstSave, secondSave]);

    expect(updateWorkspaceAgents).toHaveBeenCalledTimes(1);
    expect(saveSequenceRef.current).toBe(1);
    expect(saveInFlightRef.current).toBe(false);
    expect(onSaving).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(updatedWorkspace);
    expect(onError).not.toHaveBeenCalled();
  });

  test('stale workspace agent save does not clear newer in-flight guard', async () => {
    const deferred = createDeferred<EnterpriseLeadWorkspace | null>();
    const updateWorkspaceAgents = vi
      .spyOn(enterpriseLeadWorkspaceService, 'updateWorkspaceAgents')
      .mockReturnValue(deferred.promise);
    const onSaved = vi.fn();
    const onError = vi.fn();
    const saveInFlightRef = { current: false };
    let currentWorkspaceId = 'workspace-a';

    const savePromise = saveWorkspaceAgentBindings({
      workspaceId: 'workspace-a',
      workspaceAgents: [{
        agentId: 'agent-a',
        enabled: true,
        order: 0,
        overrides: {},
      }],
      isCurrentSave: () => currentWorkspaceId === 'workspace-a',
      onSaved,
      onError,
      saveInFlightRef,
    });

    expect(updateWorkspaceAgents).toHaveBeenCalledTimes(1);
    currentWorkspaceId = 'workspace-b';
    saveInFlightRef.current = true;
    deferred.resolve(createWorkspace('workspace-a'));
    await savePromise;

    expect(saveInFlightRef.current).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  test('workspace settings save sends only settings', async () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    const updateWorkspaceSettings = vi
      .spyOn(enterpriseLeadWorkspaceService, 'updateWorkspaceSettings')
      .mockResolvedValue(createWorkspace('workspace-1'));
    const onSaved = vi.fn();
    const onError = vi.fn();

    await saveWorkspaceSettingsDraft({
      workspaceId: 'workspace-1',
      draftSettings: settings,
      isCurrentSave: () => true,
      onSaved,
      onError,
    });

    expect(updateWorkspaceSettings).toHaveBeenCalledWith('workspace-1', {
      settings,
    });
    expect(updateWorkspaceSettings.mock.calls[0]?.[1]).not.toHaveProperty('enabledAgentRoles');
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'workspace-1' }));
    expect(onError).not.toHaveBeenCalled();
  });

  test('stale workbench save completion does not update current UI callbacks', async () => {
    const deferred = createDeferred<EnterpriseLeadWorkspace | null>();
    vi.spyOn(enterpriseLeadWorkspaceService, 'updateWorkspaceAgents')
      .mockReturnValue(deferred.promise);
    let currentWorkspaceId = 'workspace-a';
    const onSaved = vi.fn();
    const onError = vi.fn();

    const savePromise = saveWorkspaceAgentBindings({
      workspaceId: 'workspace-a',
      workspaceAgents: [{
        agentId: 'agent-a',
        enabled: true,
        order: 0,
        overrides: {},
      }],
      isCurrentSave: () => currentWorkspaceId === 'workspace-a',
      onSaved,
      onError,
    });

    currentWorkspaceId = 'workspace-b';
    deferred.resolve(createWorkspace('workspace-a'));
    await savePromise;

    expect(onSaved).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
