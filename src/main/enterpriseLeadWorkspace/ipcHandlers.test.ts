import { beforeEach, describe, expect, test, vi } from 'vitest';

const { registeredHandlers } = vi.hoisted(() => ({
  registeredHandlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

import {
  EnterpriseLeadIpcErrorCode,
  EnterpriseLeadWorkspaceIpc,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentCalibrationResponse,
  EnterpriseLeadWorkspaceProfile,
} from '../../shared/enterpriseLeadWorkspace/types';
import { buildDefaultEnterpriseLeadWorkspaceSettings } from '../../shared/enterpriseLeadWorkspace/validation';
import { KnowledgeFactDomain, KnowledgeFactDomains } from '../../shared/knowledgeBase/constants';
import {
  type EnterpriseLeadWorkspaceHandlerDeps,
  registerEnterpriseLeadWorkspaceHandlers,
} from './ipcHandlers';
import { EnterpriseLeadProfileRevisionConflictError } from './profileRevisionStore';

const profile: EnterpriseLeadWorkspaceProfile = {
  companySummary: 'Industrial supplier',
  productList: ['Product A'],
  productCapabilities: [],
  targetCustomers: [],
  applicationScenarios: [],
  sellingPoints: [],
  channelPreferences: [],
  prohibitedClaims: [],
  contactRules: [],
  missingInfo: [],
};

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

const makeDeps = (): {
  deps: EnterpriseLeadWorkspaceHandlerDeps;
  service: EnterpriseLeadWorkspaceHandlerDeps['service'];
} => {
  const workspace: EnterpriseLeadWorkspace = {
    id: 'workspace-1',
    name: 'Workspace 1',
    type: 'enterprise_lead',
    profile,
    profileRevision: 4,
    extractionSources: [],
    riskRules: [],
    enabledAgentRoles: [],
    workspaceAgents: [],
    settings: buildDefaultEnterpriseLeadWorkspaceSettings(),
    recentRunId: null,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
  };
  const calibrationResponse: EnterpriseLeadWorkspaceAgentCalibrationResponse = {
    content: '客户优先级：高',
    checks: [{ id: 'priority', passed: true }],
  };
  const service: EnterpriseLeadWorkspaceHandlerDeps['service'] = {
    listWorkspaces: vi.fn(() => []),
    getWorkspace: vi.fn(() => workspace),
    extractDraftFromConversation: vi.fn(),
    createWorkspace: vi.fn(() => workspace),
    deleteWorkspace: vi.fn(() => true),
    updateWorkspaceProfile: vi.fn(() => workspace),
    updateWorkspaceSources: vi.fn(() => workspace),
    enqueueWorkspaceDocumentProcessing: vi.fn(() => workspace),
    updateWorkspaceSettings: vi.fn(() => workspace),
    updateWorkspaceAgents: vi.fn(() => workspace),
    listRuns: vi.fn(() => []),
    testWorkspaceAgent: vi.fn(() => calibrationResponse),
    createRun: vi.fn(),
    getSnapshot: vi.fn(),
    runWorkflow: vi.fn(),
    runTask: vi.fn(),
    rerunTask: vi.fn(),
    createPendingVersionFromChat: vi.fn(),
    applyPendingVersion: vi.fn(),
    archiveRun: vi.fn(),
  };

  return {
    deps: { service },
    service,
  };
};

beforeEach(() => {
  registeredHandlers.clear();
});

describe('registerEnterpriseLeadWorkspaceHandlers', () => {
  test('rejects malformed workspace agent payloads', async () => {
    const { deps, service } = makeDeps();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.UpdateWorkspaceAgents);
    expect(handler).toBeDefined();

    const result = await handler?.(undefined, {
      workspaceId: 'workspace-1',
    });

    expect(service.updateWorkspaceAgents).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: {
        code: EnterpriseLeadIpcErrorCode.InvalidRequest,
        message: 'Invalid enterprise lead workspace request',
      },
    });
  });

  test('validates and forwards the complete manual Profile CAS request', async () => {
    const { deps, service } = makeDeps();
    registerEnterpriseLeadWorkspaceHandlers(deps);
    const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.UpdateWorkspaceProfile);

    const result = await handler?.(undefined, {
      workspaceId: 'workspace-1',
      profile,
      expectedProfileRevision: 3,
      touchedFields: [KnowledgeFactDomain.CompanySummary, KnowledgeFactDomain.ProductList],
    });

    expect(service.updateWorkspaceProfile).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      profile,
      expectedProfileRevision: 3,
      touchedFields: [KnowledgeFactDomain.CompanySummary, KnowledgeFactDomain.ProductList],
    });
    expect(result).toMatchObject({ success: true });
  });

  test('rejects every malformed manual Profile request as invalid_request before calling service', async () => {
    const inheritedArray = new Array<string>(1);
    const inheritedPrototype = Object.assign(Object.create(Array.prototype), {
      0: 'inherited product',
    });
    Object.setPrototypeOf(inheritedArray, inheritedPrototype);
    const invalidRequests: unknown[] = [
      null,
      [],
      { workspaceId: 'workspace-1', profile, expectedProfileRevision: 0, touchedFields: [KnowledgeFactDomain.CompanySummary] },
      { workspaceId: 'workspace-1', profile, expectedProfileRevision: Number.MAX_SAFE_INTEGER + 1, touchedFields: [KnowledgeFactDomain.CompanySummary] },
      { workspaceId: 'workspace-1', profile, expectedProfileRevision: 1, touchedFields: [] },
      { workspaceId: 'workspace-1', profile, expectedProfileRevision: 1, touchedFields: [KnowledgeFactDomain.CompanySummary, KnowledgeFactDomain.CompanySummary] },
      { workspaceId: 'workspace-1', profile, expectedProfileRevision: 1, touchedFields: ['unknownField'] },
      { workspaceId: 'workspace-1', profile: { ...profile, productList: 'not-an-array' }, expectedProfileRevision: 1, touchedFields: [KnowledgeFactDomain.ProductList] },
      { workspaceId: 'workspace-1', profile: { ...profile, confirmedKnowledgeKeys: [1] }, expectedProfileRevision: 1, touchedFields: [KnowledgeFactDomain.ProductList] },
      { workspaceId: 'workspace-1', profile: { ...profile, productList: new Array<string>(1) }, expectedProfileRevision: 1, touchedFields: [KnowledgeFactDomain.ProductList] },
      { workspaceId: 'workspace-1', profile: { ...profile, confirmedKnowledgeKeys: new Array<string>(1) }, expectedProfileRevision: 1, touchedFields: [KnowledgeFactDomain.ProductList] },
      { workspaceId: 'workspace-1', profile: { ...profile, productList: inheritedArray }, expectedProfileRevision: 1, touchedFields: [KnowledgeFactDomain.ProductList] },
      Object.assign(Object.create({ workspaceId: 'workspace-1' }), {
        profile,
        expectedProfileRevision: 1,
        touchedFields: [KnowledgeFactDomain.CompanySummary],
      }),
    ];

    for (const request of invalidRequests) {
      const { deps, service } = makeDeps();
      registerEnterpriseLeadWorkspaceHandlers(deps);
      const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.UpdateWorkspaceProfile);

      const result = await handler?.(undefined, request);

      expect(service.updateWorkspaceProfile).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: {
          code: EnterpriseLeadIpcErrorCode.InvalidRequest,
          message: 'Invalid enterprise lead workspace request',
        },
      });
    }
    expect(KnowledgeFactDomains).toHaveLength(10);
  });

  test('returns a typed safe Profile conflict without transporting workspace settings or sources', async () => {
    const { deps, service } = makeDeps();
    const safeSnapshot = {
      id: 'workspace-1',
      profile: { ...profile, companySummary: 'Latest safe summary' },
      profileRevision: 5,
      updatedAt: '2026-07-12T05:00:00.000Z',
    };
    vi.mocked(service.updateWorkspaceProfile).mockImplementation(() => {
      throw new EnterpriseLeadProfileRevisionConflictError(safeSnapshot);
    });
    registerEnterpriseLeadWorkspaceHandlers(deps);
    const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.UpdateWorkspaceProfile);

    const result = await handler?.(undefined, {
      workspaceId: 'workspace-1',
      profile,
      expectedProfileRevision: 4,
      touchedFields: [KnowledgeFactDomain.CompanySummary],
    });

    expect(result).toEqual({
      success: false,
      error: {
        code: EnterpriseLeadIpcErrorCode.ProfileRevisionConflict,
        message: 'Workspace profile revision conflict',
        latestProfile: safeSnapshot,
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('settings');
    expect(serialized).not.toContain('extractionSources');
  });

  test('revalidates, clones, and allowlists a hostile conflict snapshot at the IPC boundary', async () => {
    const { deps, service } = makeDeps();
    const conflictError = new EnterpriseLeadProfileRevisionConflictError({
      id: 'workspace-1',
      profile,
      profileRevision: 5,
      updatedAt: '2026-07-12T05:00:00.000Z',
    });
    const hostileProfile = {
      ...profile,
      productList: [...profile.productList],
      confirmedKnowledgeKeys: ['productList:product a'],
      ignoredKnowledgeKeys: ['sellingPoints:not for export'],
      nestedSecret: 'nested-ipc-secret',
    };
    const hostileSnapshot = {
      id: 'workspace-1',
      profile: hostileProfile,
      profileRevision: 5,
      updatedAt: '2026-07-12T05:00:00.000Z',
      settings: { apiKey: 'sk-ipc-secret' },
      extractionSources: [{ filePath: '/private/ipc-source.pdf' }],
    };
    Object.defineProperty(conflictError, 'latestProfile', {
      configurable: true,
      enumerable: true,
      value: hostileSnapshot,
      writable: true,
    });
    vi.mocked(service.updateWorkspaceProfile).mockImplementation(() => {
      throw conflictError;
    });
    registerEnterpriseLeadWorkspaceHandlers(deps);
    const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.UpdateWorkspaceProfile);

    const result = await handler?.(undefined, {
      workspaceId: 'workspace-1',
      profile,
      expectedProfileRevision: 4,
      touchedFields: [KnowledgeFactDomain.CompanySummary],
    });
    hostileSnapshot.id = 'mutated-workspace';
    hostileProfile.productList[0] = 'mutated product';
    hostileProfile.confirmedKnowledgeKeys[0] = 'mutated confirmed key';
    hostileProfile.ignoredKnowledgeKeys[0] = 'mutated ignored key';

    expect(result).toEqual({
      success: false,
      error: {
        code: EnterpriseLeadIpcErrorCode.ProfileRevisionConflict,
        message: 'Workspace profile revision conflict',
        latestProfile: {
          id: 'workspace-1',
          profile: {
            ...profile,
            confirmedKnowledgeKeys: ['productList:product a'],
            ignoredKnowledgeKeys: ['sellingPoints:not for export'],
          },
          profileRevision: 5,
          updatedAt: '2026-07-12T05:00:00.000Z',
        },
      },
    });
    const serialized = JSON.stringify(result);
    for (const sentinel of [
      'nested-ipc-secret',
      'sk-ipc-secret',
      '/private/ipc-source.pdf',
      'mutated product',
      'mutated confirmed key',
      'mutated ignored key',
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  test('single-reads IPC conflict accessors and array items without leaking later values', async () => {
    const { deps, service } = makeDeps();
    const conflictError = new EnterpriseLeadProfileRevisionConflictError({
      id: 'workspace-1',
      profile,
      profileRevision: 5,
      updatedAt: '2026-07-12T05:00:00.000Z',
    });
    const productItems = new Array<string>(1);
    const confirmedItems = new Array<string>(1);
    const productItemReads = defineChangingAccessor(
      productItems,
      0,
      'Product A',
      'ipc-accessor-secret-product-item',
    );
    const confirmedItemReads = defineChangingAccessor(
      confirmedItems,
      0,
      'productList:product a',
      'ipc-accessor-secret-confirmed-item',
    );
    const sourceProfile: Record<string, unknown> = { ...profile };
    const companyReads = defineChangingAccessor(
      sourceProfile,
      KnowledgeFactDomain.CompanySummary,
      'Industrial supplier',
      'ipc-accessor-secret-company',
    );
    const productReads = defineChangingAccessor(
      sourceProfile,
      KnowledgeFactDomain.ProductList,
      productItems,
      ['ipc-accessor-secret-product-array'],
    );
    const confirmedReads = defineChangingAccessor(
      sourceProfile,
      'confirmedKnowledgeKeys',
      confirmedItems,
      ['ipc-accessor-secret-confirmed-array'],
    );
    const sourceSnapshot: Record<string, unknown> = {};
    const idReads = defineChangingAccessor(
      sourceSnapshot,
      'id',
      'workspace-1',
      'ipc-accessor-secret-workspace',
    );
    const profileReads = defineChangingAccessor(
      sourceSnapshot,
      'profile',
      sourceProfile,
      { ...profile, companySummary: 'ipc-accessor-secret-profile' },
    );
    const revisionReads = defineChangingAccessor(sourceSnapshot, 'profileRevision', 5, 6);
    const updatedAtReads = defineChangingAccessor(
      sourceSnapshot,
      'updatedAt',
      '2026-07-12T05:00:00.000Z',
      '2026-07-13T05:00:00.000Z',
    );
    Object.defineProperty(conflictError, 'latestProfile', {
      configurable: true,
      enumerable: true,
      value: sourceSnapshot,
      writable: true,
    });
    vi.mocked(service.updateWorkspaceProfile).mockImplementation(() => {
      throw conflictError;
    });
    registerEnterpriseLeadWorkspaceHandlers(deps);
    const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.UpdateWorkspaceProfile);

    const result = await handler?.(undefined, {
      workspaceId: 'workspace-1',
      profile,
      expectedProfileRevision: 4,
      touchedFields: [KnowledgeFactDomain.CompanySummary],
    });

    expect(result).toEqual({
      success: false,
      error: {
        code: EnterpriseLeadIpcErrorCode.ProfileRevisionConflict,
        message: 'Workspace profile revision conflict',
        latestProfile: {
          id: 'workspace-1',
          profile: {
            ...profile,
            productList: ['Product A'],
            confirmedKnowledgeKeys: ['productList:product a'],
          },
          profileRevision: 5,
          updatedAt: '2026-07-12T05:00:00.000Z',
        },
      },
    });
    for (const readCount of [
      idReads,
      profileReads,
      revisionReads,
      updatedAtReads,
      companyReads,
      productReads,
      confirmedReads,
      productItemReads,
      confirmedItemReads,
    ]) {
      expect(readCount()).toBe(1);
    }
    expect(JSON.stringify(result)).not.toContain('ipc-accessor-secret');
  });

  test('degrades an invalid typed conflict snapshot to fixed operation_failed', async () => {
    const { deps, service } = makeDeps();
    const conflictError = new EnterpriseLeadProfileRevisionConflictError({
      id: 'workspace-1',
      profile,
      profileRevision: 5,
      updatedAt: '2026-07-12T05:00:00.000Z',
    });
    Object.defineProperty(conflictError, 'latestProfile', {
      configurable: true,
      enumerable: true,
      value: {
        id: 'workspace-1',
        profile: { ...profile, productList: 'not-an-array' },
        profileRevision: 5,
        updatedAt: '2026-07-12T05:00:00.000Z',
      },
      writable: true,
    });
    vi.mocked(service.updateWorkspaceProfile).mockImplementation(() => {
      throw conflictError;
    });
    registerEnterpriseLeadWorkspaceHandlers(deps);
    const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.UpdateWorkspaceProfile);

    const result = await handler?.(undefined, {
      workspaceId: 'workspace-1',
      profile,
      expectedProfileRevision: 4,
      touchedFields: [KnowledgeFactDomain.CompanySummary],
    });

    expect(result).toEqual({
      success: false,
      error: {
        code: EnterpriseLeadIpcErrorCode.OperationFailed,
        message: 'Enterprise lead workspace operation failed',
      },
    });
  });

  test('degrades a sparse conflict snapshot to fixed operation_failed', async () => {
    const { deps, service } = makeDeps();
    const conflictError = new EnterpriseLeadProfileRevisionConflictError({
      id: 'workspace-1',
      profile,
      profileRevision: 5,
      updatedAt: '2026-07-12T05:00:00.000Z',
    });
    Object.defineProperty(conflictError, 'latestProfile', {
      configurable: true,
      enumerable: true,
      value: {
        id: 'workspace-1',
        profile: {
          ...profile,
          confirmedKnowledgeKeys: new Array<string>(1),
          nestedSecret: 'sparse-ipc-secret',
        },
        profileRevision: 5,
        updatedAt: '2026-07-12T05:00:00.000Z',
      },
      writable: true,
    });
    vi.mocked(service.updateWorkspaceProfile).mockImplementation(() => {
      throw conflictError;
    });
    registerEnterpriseLeadWorkspaceHandlers(deps);
    const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.UpdateWorkspaceProfile);

    const result = await handler?.(undefined, {
      workspaceId: 'workspace-1',
      profile,
      expectedProfileRevision: 4,
      touchedFields: [KnowledgeFactDomain.CompanySummary],
    });

    expect(result).toEqual({
      success: false,
      error: {
        code: EnterpriseLeadIpcErrorCode.OperationFailed,
        message: 'Enterprise lead workspace operation failed',
      },
    });
    expect(JSON.stringify(result)).not.toContain('sparse-ipc-secret');
  });

  test('redacts generic Error message, cause, stack, custom fields, credentials, paths, and SQL', async () => {
    const { deps, service } = makeDeps();
    const sentinels = [
      'sk-api-private',
      'oauth-access-private',
      'oauth-refresh-private',
      'https://private.endpoint.test/v1',
      '/Users/private/customer/source.pdf',
      'private source internals',
      'SELECT * FROM private_table',
    ];
    const dependencyError = Object.assign(
      new Error(`${sentinels[0]} ${sentinels[3]} ${sentinels[6]}`, {
        cause: new Error(`${sentinels[1]} ${sentinels[2]}`),
      }),
      {
        path: sentinels[4],
        source: sentinels[5],
      },
    );
    dependencyError.stack = `${dependencyError.stack}\n${sentinels.join('\n')}`;
    vi.mocked(service.updateWorkspaceProfile).mockImplementation(() => {
      throw dependencyError;
    });
    registerEnterpriseLeadWorkspaceHandlers(deps);
    const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.UpdateWorkspaceProfile);

    const result = await handler?.(undefined, {
      workspaceId: 'workspace-1',
      profile,
      expectedProfileRevision: 4,
      touchedFields: [KnowledgeFactDomain.CompanySummary],
    });

    expect(result).toEqual({
      success: false,
      error: {
        code: EnterpriseLeadIpcErrorCode.OperationFailed,
        message: 'Enterprise lead workspace operation failed',
      },
    });
    const serialized = JSON.stringify(result);
    for (const sentinel of sentinels) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  test('deletes a workspace through the workspace delete channel', async () => {
    const { deps, service } = makeDeps();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.DeleteWorkspace);
    expect(handler).toBeDefined();

    const result = await handler?.(undefined, 'workspace-1');

    expect(service.deleteWorkspace).toHaveBeenCalledWith('workspace-1');
    expect(result).toEqual({
      success: true,
      data: true,
    });
  });

  test('queues workspace document processing through the document process channel', async () => {
    const { deps, service } = makeDeps();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.ProcessDocumentSource);
    expect(handler).toBeDefined();

    const sources = [
      {
        kind: 'file',
        label: '工厂资料',
        text: '主营精密五金加工。',
      },
    ];
    const result = await handler?.(undefined, {
      workspaceId: 'workspace-1',
      sources,
      sourceIndex: 0,
    });

    expect(service.enqueueWorkspaceDocumentProcessing).toHaveBeenCalledWith(
      'workspace-1',
      [expect.objectContaining(sources[0])],
      0,
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        id: 'workspace-1',
        workspaceAgents: [],
      },
    });
  });

  test('routes workspace Agent calibration requests through the test channel', async () => {
    const { deps, service } = makeDeps();
    registerEnterpriseLeadWorkspaceHandlers(deps);

    const handler = registeredHandlers.get(EnterpriseLeadWorkspaceIpc.TestWorkspaceAgent);
    expect(handler).toBeDefined();

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
    const result = await handler?.(undefined, {
      workspaceId: 'workspace-1',
      request,
    });

    expect(service.testWorkspaceAgent).toHaveBeenCalledWith('workspace-1', request);
    expect(result).toEqual({
      success: true,
      data: {
        content: '客户优先级：高',
        checks: [{ id: 'priority', passed: true }],
      },
    });
  });
});
