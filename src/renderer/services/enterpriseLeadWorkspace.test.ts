import { afterEach, describe, expect, test, vi } from 'vitest';

import type { EnterpriseLeadWorkspace } from '../../shared/enterpriseLeadWorkspace/types';
import { buildDefaultEnterpriseLeadWorkspaceSettings } from '../../shared/enterpriseLeadWorkspace/validation';
import { KnowledgeFactDomain } from '../../shared/knowledgeBase/constants';
import {
  enterpriseLeadWorkspaceService,
  EnterpriseLeadWorkspaceServiceError,
  EnterpriseLeadWorkspaceServiceErrorCode,
} from './enterpriseLeadWorkspace';

const createWindowWithEnterpriseLeadWorkspace = (
  api: Partial<Window['electron']['enterpriseLeadWorkspace']>,
): void => {
  vi.stubGlobal('window', {
    electron: {
      enterpriseLeadWorkspace: api,
    },
  });
};

const createWorkspace = (): EnterpriseLeadWorkspace => ({
  id: 'workspace-1',
  name: 'Workspace 1',
  type: 'enterprise_lead',
  profile: {
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
  },
  profileRevision: 1,
  extractionSources: [],
  riskRules: [],
  enabledAgentRoles: [],
  settings: buildDefaultEnterpriseLeadWorkspaceSettings(),
  workspaceAgents: [],
  recentRunId: null,
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
});

const defineChangingAccessor = (
  target: object,
  key: PropertyKey,
  firstValue: unknown,
  laterValue: unknown,
): (() => number) => {
  let reads = 0;
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get: () => {
      reads += 1;
      return reads === 1 ? firstValue : laterValue;
    },
  });
  return () => reads;
};

describe('enterpriseLeadWorkspaceService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('propagates historical workspace list failures', async () => {
    createWindowWithEnterpriseLeadWorkspace({
      listWorkspaces: async () => ({
        success: false,
        error: {
          code: 'operation_failed',
          message: 'database unavailable',
        },
      }),
    });

    await expect(enterpriseLeadWorkspaceService.listWorkspaces()).rejects.toThrow(
      'database unavailable',
    );
  });

  test('forwards the complete Profile CAS contract through preload', async () => {
    const updateWorkspaceProfile = vi.fn(async () => ({
      success: true as const,
      data: createWorkspace(),
    }));
    createWindowWithEnterpriseLeadWorkspace({ updateWorkspaceProfile });
    const profile = {
      companySummary: 'Updated summary',
      productList: [],
      productCapabilities: [],
      targetCustomers: [],
      applicationScenarios: [],
      sellingPoints: [],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
    };

    await enterpriseLeadWorkspaceService.updateWorkspaceProfile(
      'workspace-1',
      profile,
      7,
      [KnowledgeFactDomain.CompanySummary],
    );

    expect(updateWorkspaceProfile).toHaveBeenCalledWith(
      'workspace-1',
      profile,
      7,
      [KnowledgeFactDomain.CompanySummary],
    );
  });

  test('preserves the typed safe Profile conflict structure from IPC', async () => {
    const conflictProfile = {
      companySummary: 'Latest summary',
      productList: ['Original product'],
      productCapabilities: [],
      targetCustomers: [],
      applicationScenarios: [],
      sellingPoints: [],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
      confirmedKnowledgeKeys: ['productList:original product'],
      ignoredKnowledgeKeys: ['sellingPoints:not for export'],
      nestedSecret: 'renderer-nested-secret',
    };
    const latestProfile = {
      id: 'workspace-1',
      profile: conflictProfile,
      profileRevision: 8,
      updatedAt: '2026-07-12T06:00:00.000Z',
      settings: { apiKey: 'sk-renderer-secret' },
      extractionSources: [{ filePath: '/private/renderer-source.pdf' }],
    };
    createWindowWithEnterpriseLeadWorkspace({
      updateWorkspaceProfile: async () => ({
        success: false,
        error: {
          code: 'profile_revision_conflict',
          message: 'Workspace profile revision conflict',
          latestProfile: latestProfile as never,
        },
      }),
    });

    let thrown: unknown;
    try {
      await enterpriseLeadWorkspaceService.updateWorkspaceProfile(
        'workspace-1',
        latestProfile.profile,
        7,
        [KnowledgeFactDomain.CompanySummary],
      );
    } catch (error) {
      thrown = error;
    }
    latestProfile.id = 'mutated-workspace';
    conflictProfile.productList[0] = 'mutated product';
    conflictProfile.confirmedKnowledgeKeys[0] = 'mutated confirmed key';
    conflictProfile.ignoredKnowledgeKeys[0] = 'mutated ignored key';

    expect(thrown).toBeInstanceOf(EnterpriseLeadWorkspaceServiceError);
    expect(thrown).toEqual(expect.objectContaining({
      code: 'profile_revision_conflict',
      latestProfile: {
        id: 'workspace-1',
        profile: {
          companySummary: 'Latest summary',
          productList: ['Original product'],
          productCapabilities: [],
          targetCustomers: [],
          applicationScenarios: [],
          sellingPoints: [],
          channelPreferences: [],
          prohibitedClaims: [],
          contactRules: [],
          missingInfo: [],
          confirmedKnowledgeKeys: ['productList:original product'],
          ignoredKnowledgeKeys: ['sellingPoints:not for export'],
        },
        profileRevision: 8,
        updatedAt: '2026-07-12T06:00:00.000Z',
      },
      message: 'Workspace profile revision conflict',
    }));
    expect(JSON.stringify(thrown)).not.toMatch(
      /renderer-nested-secret|sk-renderer-secret|renderer-source|mutated product|mutated confirmed|mutated ignored/,
    );
  });

  test('degrades an invalid renderer conflict snapshot to fixed operation_failed', async () => {
    createWindowWithEnterpriseLeadWorkspace({
      updateWorkspaceProfile: async () => ({
        success: false,
        error: {
          code: 'profile_revision_conflict',
          message: 'secret invalid conflict',
          latestProfile: {
            id: 'workspace-1',
            profile: {
              ...createWorkspace().profile,
              productList: 'not-an-array',
            },
            profileRevision: 8,
            updatedAt: '2026-07-12T06:00:00.000Z',
          } as never,
        },
      }),
    });

    let thrown: unknown;
    try {
      await enterpriseLeadWorkspaceService.updateWorkspaceProfile(
        'workspace-1',
        createWorkspace().profile,
        7,
        [KnowledgeFactDomain.CompanySummary],
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EnterpriseLeadWorkspaceServiceError);
    expect(thrown).toMatchObject({
      code: 'operation_failed',
      message: 'Enterprise lead workspace operation failed',
      latestProfile: undefined,
    });
    expect(JSON.stringify(thrown)).not.toContain('secret invalid conflict');
  });

  test('single-reads renderer conflict accessors and array items without leaking later values', async () => {
    const confirmedKeys = new Array<string>(1);
    const ignoredKeys = new Array<string>(1);
    const confirmedItemReads = defineChangingAccessor(
      confirmedKeys,
      0,
      'productList:original product',
      'secret-renderer-confirmed-item',
    );
    const ignoredItemReads = defineChangingAccessor(
      ignoredKeys,
      0,
      'sellingPoints:not for export',
      'secret-renderer-ignored-item',
    );
    const safeProfile = createWorkspace().profile;
    const sourceProfile: Record<string, unknown> = { ...safeProfile };
    const companyReads = defineChangingAccessor(
      sourceProfile,
      'companySummary',
      'Original summary',
      'secret-renderer-company',
    );
    const domainReads = defineChangingAccessor(
      sourceProfile,
      KnowledgeFactDomain.ProductList,
      ['Original product'],
      ['secret-renderer-domain'],
    );
    const confirmedReads = defineChangingAccessor(
      sourceProfile,
      'confirmedKnowledgeKeys',
      confirmedKeys,
      ['secret-renderer-confirmed-array'],
    );
    const ignoredReads = defineChangingAccessor(
      sourceProfile,
      'ignoredKnowledgeKeys',
      ignoredKeys,
      ['secret-renderer-ignored-array'],
    );
    const sourceSnapshot: Record<string, unknown> = {};
    const idReads = defineChangingAccessor(
      sourceSnapshot,
      'id',
      'workspace-1',
      'secret-renderer-workspace',
    );
    const profileReads = defineChangingAccessor(
      sourceSnapshot,
      'profile',
      sourceProfile,
      { ...safeProfile, companySummary: 'secret-renderer-profile' },
    );
    const revisionReads = defineChangingAccessor(sourceSnapshot, 'profileRevision', 8, 9);
    const updatedAtReads = defineChangingAccessor(
      sourceSnapshot,
      'updatedAt',
      '2026-07-12T06:00:00.000Z',
      '2026-07-13T06:00:00.000Z',
    );
    createWindowWithEnterpriseLeadWorkspace({
      updateWorkspaceProfile: async () => ({
        success: false,
        error: {
          code: 'profile_revision_conflict',
          message: 'Workspace profile revision conflict',
          latestProfile: sourceSnapshot as never,
        },
      }),
    });

    let thrown: unknown;
    try {
      await enterpriseLeadWorkspaceService.updateWorkspaceProfile(
        'workspace-1',
        safeProfile,
        7,
        [KnowledgeFactDomain.CompanySummary],
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual(expect.objectContaining({
      code: 'profile_revision_conflict',
      latestProfile: {
        id: 'workspace-1',
        profile: {
          ...safeProfile,
          companySummary: 'Original summary',
          productList: ['Original product'],
          confirmedKnowledgeKeys: ['productList:original product'],
          ignoredKnowledgeKeys: ['sellingPoints:not for export'],
        },
        profileRevision: 8,
        updatedAt: '2026-07-12T06:00:00.000Z',
      },
    }));
    for (const readCount of [
      idReads,
      profileReads,
      revisionReads,
      updatedAtReads,
      companyReads,
      domainReads,
      confirmedReads,
      ignoredReads,
      confirmedItemReads,
      ignoredItemReads,
    ]) {
      expect(readCount()).toBe(1);
    }
    expect(JSON.stringify(thrown)).not.toContain('secret-renderer');
  });

  test('degrades sparse required and trust conflict arrays to fixed operation_failed', async () => {
    for (const sparseField of [
      KnowledgeFactDomain.ProductList,
      'confirmedKnowledgeKeys',
    ] as const) {
      createWindowWithEnterpriseLeadWorkspace({
        updateWorkspaceProfile: async () => ({
          success: false,
          error: {
            code: 'profile_revision_conflict',
            message: 'sparse renderer secret',
            latestProfile: {
              id: 'workspace-1',
              profile: {
                ...createWorkspace().profile,
                [sparseField]: new Array<string>(1),
              },
              profileRevision: 8,
              updatedAt: '2026-07-12T06:00:00.000Z',
            } as never,
          },
        }),
      });

      let thrown: unknown;
      try {
        await enterpriseLeadWorkspaceService.updateWorkspaceProfile(
          'workspace-1',
          createWorkspace().profile,
          7,
          [KnowledgeFactDomain.CompanySummary],
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toMatchObject({
        code: 'operation_failed',
        message: 'Enterprise lead workspace operation failed',
        latestProfile: undefined,
      });
      expect(JSON.stringify(thrown)).not.toContain('sparse renderer secret');
    }
  });

  test('logs request failures safely and never logs the complete Error object', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const thrown = Object.assign(new Error('safe bridge failure'), {
      apiKey: 'sk-custom-field-must-not-be-logged',
      sourcePath: '/private/source/path',
    });
    createWindowWithEnterpriseLeadWorkspace({
      listWorkspaces: async () => {
        throw thrown;
      },
    });

    await expect(enterpriseLeadWorkspaceService.listWorkspaces()).rejects.toMatchObject({
      code: 'operation_failed',
      message: 'Enterprise lead workspace operation failed',
    });
    expect(logged).toHaveBeenCalled();
    for (const call of logged.mock.calls) {
      expect(call).not.toContain(thrown);
      expect(JSON.stringify(call)).not.toContain('sk-custom-field-must-not-be-logged');
      expect(JSON.stringify(call)).not.toContain('/private/source/path');
    }
  });

  test('never logs secrets from a rejected bridge Error message', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const thrown = new Error(
      'SECRET bridge failure /private/customer.sqlite SQL apiKey=sk-message-secret '
      + 'endpoint=https://private-provider.example/v1',
    );
    createWindowWithEnterpriseLeadWorkspace({
      listWorkspaces: async () => {
        throw thrown;
      },
    });

    let received: unknown;
    try {
      await enterpriseLeadWorkspaceService.listWorkspaces();
    } catch (error) {
      received = error;
    }

    expect(received).toBeInstanceOf(EnterpriseLeadWorkspaceServiceError);
    expect(received).not.toBe(thrown);
    expect(received).toMatchObject({
      code: 'operation_failed',
      message: 'Enterprise lead workspace operation failed',
      latestProfile: undefined,
    });
    expect(logged).toHaveBeenCalledWith(
      '[EnterpriseLeadWorkspace] listWorkspaces failed',
      {
        code: 'operation_failed',
        message: 'Enterprise lead workspace operation failed',
      },
    );
    expect(JSON.stringify(logged.mock.calls)).not.toMatch(
      /SECRET|private\/customer|SQL|apiKey|sk-message-secret|private-provider|https:\/\//,
    );
    for (const serialized of [JSON.stringify(received), String(received), (received as Error).stack]) {
      expect(serialized).not.toMatch(
        /SECRET|private\/customer|SQL|apiKey|sk-message-secret|private-provider|https:\/\//,
      );
    }
  });

  test('exports API-unavailable codes separately from the typed service Error class', () => {
    expect(EnterpriseLeadWorkspaceServiceErrorCode).toEqual({
      ProcessDocumentSourceApiUnavailable: 'process_document_source_api_unavailable',
      UpdateSourcesApiUnavailable: 'update_sources_api_unavailable',
    });
    expect(EnterpriseLeadWorkspaceServiceError).toEqual(expect.any(Function));
  });

  test('saves workspace settings through the enterprise lead workspace API', async () => {
    const updateWorkspaceSettings = vi.fn(async () => ({
      success: true as const,
      data: createWorkspace(),
    }));
    createWindowWithEnterpriseLeadWorkspace({ updateWorkspaceSettings });

    await enterpriseLeadWorkspaceService.updateWorkspaceSettings('workspace-1', {
      enabledAgentRoles: ['content_planning'],
      settings: {
        model: {
          defaultModel: 'gpt-4.1',
          defaultModelProvider: 'openai',
          providers: {
            openai: {
              enabled: true,
              apiKey: 'sk-workspace',
              baseUrl: 'https://api.openai.com/v1',
              apiFormat: 'openai',
              models: [{ id: 'gpt-4.1', name: 'GPT-4.1' }],
            },
          },
        },
      },
    });

    expect(updateWorkspaceSettings).toHaveBeenCalledWith('workspace-1', {
      enabledAgentRoles: ['content_planning'],
      settings: {
        model: {
          defaultModel: 'gpt-4.1',
          defaultModelProvider: 'openai',
          providers: {
            openai: {
              enabled: true,
              apiKey: 'sk-workspace',
              baseUrl: 'https://api.openai.com/v1',
              apiFormat: 'openai',
              models: [{ id: 'gpt-4.1', name: 'GPT-4.1' }],
            },
          },
        },
      },
    });
  });

  test('updates workspace agent bindings through bridge', async () => {
    const binding = {
      agentId: 'agent-a',
      enabled: true,
      order: 0,
      overrides: { name: 'Workspace Writer' },
    };
    const workspace = {
      id: 'workspace-1',
      name: 'Workspace 1',
      type: 'enterprise_lead',
      profile: {
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
      },
      extractionSources: [],
      riskRules: [],
      enabledAgentRoles: [],
      workspaceAgents: [binding],
      settings: buildDefaultEnterpriseLeadWorkspaceSettings(),
      recentRunId: null,
      createdAt: '2026-07-05T00:00:00.000Z',
      updatedAt: '2026-07-05T00:00:00.000Z',
      profileRevision: 1,
    };
    const updateWorkspaceAgents = vi.fn(async () => ({
      success: true as const,
      data: workspace,
    }));
    createWindowWithEnterpriseLeadWorkspace({ updateWorkspaceAgents });

    const result = await enterpriseLeadWorkspaceService.updateWorkspaceAgents('workspace-1', [
      binding,
    ]);

    expect(updateWorkspaceAgents).toHaveBeenCalledWith('workspace-1', [binding]);
    expect(result?.workspaceAgents).toEqual([binding]);
  });

  test('queues document source processing through bridge', async () => {
    const workspace = {
      id: 'workspace-1',
      name: 'Workspace 1',
      type: 'enterprise_lead',
      profile: {
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
      },
      extractionSources: [
        {
          kind: 'file',
          label: '工厂资料',
          text: '主营精密五金加工。',
        },
      ],
      riskRules: [],
      enabledAgentRoles: [],
      workspaceAgents: [],
      settings: buildDefaultEnterpriseLeadWorkspaceSettings(),
      recentRunId: null,
      createdAt: '2026-07-05T00:00:00.000Z',
      updatedAt: '2026-07-05T00:00:00.000Z',
      profileRevision: 1,
    };
    const processDocumentSource = vi.fn(async () => ({
      success: true as const,
      data: workspace,
    }));
    createWindowWithEnterpriseLeadWorkspace({ processDocumentSource });

    const result = await enterpriseLeadWorkspaceService.processDocumentSource(
      'workspace-1',
      workspace.extractionSources,
      0,
    );

    expect(processDocumentSource).toHaveBeenCalledWith(
      'workspace-1',
      workspace.extractionSources,
      0,
    );
    expect(result?.extractionSources[0]?.label).toBe('工厂资料');
  });

  test('deletes a workspace through bridge', async () => {
    const deleteWorkspace = vi.fn(async () => ({
      success: true as const,
      data: true,
    }));
    createWindowWithEnterpriseLeadWorkspace({ deleteWorkspace });

    const result = await enterpriseLeadWorkspaceService.deleteWorkspace('workspace-1');

    expect(deleteWorkspace).toHaveBeenCalledWith('workspace-1');
    expect(result).toBe(true);
  });

  test('lists workspace runs through bridge', async () => {
    const listRuns = vi.fn(async () => ({
      success: true as const,
      data: [],
    }));
    createWindowWithEnterpriseLeadWorkspace({ listRuns });

    const result = await enterpriseLeadWorkspaceService.listRuns('workspace-1');

    expect(listRuns).toHaveBeenCalledWith('workspace-1');
    expect(result).toEqual([]);
  });

  test('tests workspace Agent drafts through bridge', async () => {
    const testWorkspaceAgent = vi.fn(async () => ({
      success: true as const,
      data: {
        content: '客户优先级：高',
        checks: [{ id: 'priority' as const, passed: true }],
      },
    }));
    createWindowWithEnterpriseLeadWorkspace({ testWorkspaceAgent });

    const request = {
      agentId: 'agent-opportunity',
      agent: {
        name: '商机雷达 Agent',
        description: '判断客户方向、采购信号、商机评分和跟进优先级。',
        identity: '',
        systemPrompt: '按固定结构输出。',
        icon: '商',
        model: '',
        skillIds: [],
      },
      example: {
        sampleInput: '客户来自汽车零部件行业。',
        expectedPriority: '高',
        expectedReason: '行业匹配。',
        expectedMissing: '目标价格。',
        expectedNextStep: '安排技术评估。',
      },
    };

    const result = await enterpriseLeadWorkspaceService.testWorkspaceAgent('workspace-1', request);

    expect(testWorkspaceAgent).toHaveBeenCalledWith('workspace-1', request);
    expect(result?.content).toContain('客户优先级');
  });
});
