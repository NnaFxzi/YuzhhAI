import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  buildEnterpriseLeadWorkspaceKnowledgeScopeId,
  EnterpriseLeadWorkspaceType,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceSettings,
} from '../../shared/enterpriseLeadWorkspace/types';
import { buildDefaultEnterpriseLeadWorkspaceSettings } from '../../shared/enterpriseLeadWorkspace/validation';
import {
  KnowledgeFactDomain,
  KnowledgeTrustedIndexRefreshAttemptOutcome,
  KnowledgeTrustedIndexRefreshStatus,
  KnowledgeTrustedProfileIndexErrorCode,
} from '../../shared/knowledgeBase/constants';
import { buildEnterpriseKnowledgeKey } from '../../shared/knowledgeBase/enterpriseLeadProfileKnowledge';
import { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import {
  type ContentKnowledgeSource,
  ContentKnowledgeSourceType,
} from '../libs/contentKnowledgeRetrieval';
import { ContentKnowledgeVectorStore } from '../libs/contentKnowledgeVectorStore';
import { KnowledgeTrustedProfileIndexService } from './knowledgeTrustedProfileIndexService';

const databases: Database.Database[] = [];
const temporaryDirectories: string[] = [];

const createSecretSettings = (secret: string): EnterpriseLeadWorkspaceSettings => {
  const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
  settings.model.providers = {
    secretProvider: {
      enabled: true,
      apiKey: secret,
      baseUrl: `https://${secret}.example.invalid/v1`,
      apiFormat: 'openai',
      models: [{ id: secret, name: secret }],
    },
  };
  return settings;
};

const createWorkspace = (
  store: EnterpriseLeadWorkspaceStore,
  name: string,
  secret = 'TASK10_SETTINGS_SECRET_SENTINEL',
): EnterpriseLeadWorkspace => store.createWorkspace({
  name,
  type: EnterpriseLeadWorkspaceType.EnterpriseLead,
  profile: {
    companySummary: `${name} 主营工业包装`,
    productList: ['重型纸箱'],
    productCapabilities: ['抗压设计'],
    targetCustomers: ['机械设备厂'],
    applicationScenarios: ['出口运输'],
    sellingPoints: ['可替代木箱'],
    channelPreferences: ['微信'],
    prohibitedClaims: ['绝对防损'],
    contactRules: ['仅生成草稿'],
    missingInfo: [],
    confirmedKnowledgeKeys: [
      `companySummary:${name} 主营工业包装`,
      'productList:重型纸箱',
    ],
  },
  extractionSources: [],
  enabledAgentRoles: [],
  settings: createSecretSettings(secret),
  workspaceAgents: [],
});

const createClock = (): (() => string) => {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 13, 1, 0, tick++)).toISOString();
};

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for Task 10 service boundary');
};

const readAllSourceTypes = (
  result: ReturnType<ContentKnowledgeVectorStore['search']>,
): string[] => [...result.hits, ...result.rejectedHits]
  .map(hit => hit.chunk.sourceType)
  .sort();

afterEach(() => {
  while (databases.length > 0) {
    const db = databases.pop();
    if (db?.open) db.close();
  }
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop()!, { force: true, recursive: true });
  }
  vi.restoreAllMocks();
});

describe('KnowledgeTrustedProfileIndexService', () => {
  test('supports cleanup-first deferred startup and an idempotent shutdown promise', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    createWorkspace(workspaceStore, 'deferred trusted workspace');
    const indexStore = workspaceStore.getTrustedProfileIndexStore();
    const recover = vi.spyOn(indexStore, 'recoverAbandonedRunning');
    const reconcile = vi.spyOn(indexStore, 'reconcileAll');
    const claim = vi.spyOn(indexStore, 'claimNext');
    const replaceTrustedSources = vi.fn();
    const service = new KnowledgeTrustedProfileIndexService({
      indexStore,
      loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
      replaceTrustedSources,
      clock: createClock(),
      autoStart: false,
    });

    service.wake();
    await Promise.resolve();
    expect(recover).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(replaceTrustedSources).not.toHaveBeenCalled();

    service.startAfterRecovery();
    await service.waitForIdle();
    expect(claim).toHaveBeenCalled();
    expect(replaceTrustedSources).toHaveBeenCalledTimes(1);

    const firstShutdown = service.shutdown();
    const secondShutdown = service.shutdown();
    expect(secondShutdown).toBe(firstShutdown);
    await firstShutdown;
  });

  test('starts from existing queued jobs and coalesces wakes into one FIFO drain', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const first = createWorkspace(workspaceStore, '工厂 A');
    const second = createWorkspace(workspaceStore, '工厂 B');
    let active = 0;
    let maximumActive = 0;
    const replacedScopes: string[] = [];
    const replaceTrustedSources = vi.fn(async (
      scopeId: string,
      sources: ContentKnowledgeSource[],
    ) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      expect(sources.every(source =>
        source.sourceType === ContentKnowledgeSourceType.WorkspaceConfirmedProfile
        || source.sourceType === ContentKnowledgeSourceType.WorkspaceRule)).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 0));
      replacedScopes.push(scopeId);
      active -= 1;
    });
    expect(workspaceStore.getTrustedProfileIndexStore().getJob(first.id, 1)?.status)
      .toBe(KnowledgeTrustedIndexRefreshStatus.Queued);
    expect(workspaceStore.getTrustedProfileIndexStore().getJob(second.id, 1)?.status)
      .toBe(KnowledgeTrustedIndexRefreshStatus.Queued);
    const service = new KnowledgeTrustedProfileIndexService({
      indexStore: workspaceStore.getTrustedProfileIndexStore(),
      loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
      replaceTrustedSources,
      clock: createClock(),
    });

    service.wake();
    service.wake();
    await service.waitForIdle();

    expect(maximumActive).toBe(1);
    const expectedFifoScopes = (db.prepare(`
      SELECT workspace_id FROM knowledge_trusted_profile_index_jobs
      ORDER BY requested_at ASC, id ASC
    `).all() as Array<{ workspace_id: string }>).map(row =>
      buildEnterpriseLeadWorkspaceKnowledgeScopeId(row.workspace_id));
    expect(replacedScopes).toEqual(expectedFifoScopes);
    expect(workspaceStore.getTrustedProfileIndexStore().getState(first.id))
      .toMatchObject({ indexedProfileRevision: 1 });
    expect(workspaceStore.getTrustedProfileIndexStore().getState(second.id))
      .toMatchObject({ indexedProfileRevision: 1 });
  });

  test('records only each job revision when an older job builds the newer current Profile', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const vectorStore = new ContentKnowledgeVectorStore(db);
    const initial = createWorkspace(workspaceStore, '版本工厂');
    const revisionTwo = workspaceStore.updateWorkspaceProfile({
      workspaceId: initial.id,
      expectedProfileRevision: 1,
      profile: {
        ...initial.profile,
        companySummary: '版本工厂 Profile C2',
        confirmedKnowledgeKeys: [
          buildEnterpriseKnowledgeKey(
            KnowledgeFactDomain.CompanySummary,
            '版本工厂 Profile C2',
          ),
          'productList:重型纸箱',
        ],
      },
      touchedFields: ['companySummary'],
    });
    const current = workspaceStore.updateWorkspaceProfile({
      workspaceId: initial.id,
      expectedProfileRevision: revisionTwo.profileRevision,
      profile: {
        ...revisionTwo.profile,
        companySummary: '版本工厂 Profile C3',
        confirmedKnowledgeKeys: [
          buildEnterpriseKnowledgeKey(
            KnowledgeFactDomain.CompanySummary,
            '版本工厂 Profile C3',
          ),
          'productList:重型纸箱',
        ],
      },
      touchedFields: ['companySummary'],
    });
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(current.id);
    vectorStore.replaceWorkspaceDocumentSources(scopeId, [{
      sourceId: 'raw-version',
      sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
      label: '版本原始资料',
      content: '工业包装原始资料',
    }]);
    let releaseSecond: () => void = () => {};
    let releaseThird: () => void = () => {};
    const secondGate = new Promise<void>(resolve => {
      releaseSecond = resolve;
    });
    const thirdGate = new Promise<void>(resolve => {
      releaseThird = resolve;
    });
    const builtSources: ContentKnowledgeSource[][] = [];
    const service = new KnowledgeTrustedProfileIndexService({
      indexStore: workspaceStore.getTrustedProfileIndexStore(),
      loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
      replaceTrustedSources: async (replacementScopeId, sources) => {
        builtSources.push(sources);
        vectorStore.replaceTrustedSources(replacementScopeId, sources);
        if (builtSources.length === 2) await secondGate;
        if (builtSources.length === 3) await thirdGate;
      },
      clock: createClock(),
    });
    await waitFor(() => builtSources.length === 2);

    expect(JSON.stringify(builtSources[0])).toContain('Profile C3');
    expect(workspaceStore.getTrustedProfileIndexStore().getState(current.id))
      .toMatchObject({ indexedProfileRevision: 1 });
    expect(readAllSourceTypes(vectorStore.search(
      scopeId,
      '工业包装',
      { hitThreshold: 0, maxHits: 20, minBusinessSignals: 0 },
    ))).toEqual([ContentKnowledgeSourceType.WorkspaceDocument]);

    releaseSecond();
    await waitFor(() => builtSources.length === 3);
    expect(workspaceStore.getTrustedProfileIndexStore().getState(current.id))
      .toMatchObject({ indexedProfileRevision: 2 });
    releaseThird();
    await service.waitForIdle();
    expect(workspaceStore.getTrustedProfileIndexStore().getState(current.id))
      .toMatchObject({ indexedProfileRevision: 3 });
  });

  test('completes an older audit job without rebuilding or restamping current indexed state', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const initial = createWorkspace(workspaceStore, '旧任务工厂');
    const current = workspaceStore.updateWorkspaceProfile({
      workspaceId: initial.id,
      expectedProfileRevision: 1,
      profile: {
        ...initial.profile,
        companySummary: '旧任务工厂新版',
        confirmedKnowledgeKeys: [
          buildEnterpriseKnowledgeKey(
            KnowledgeFactDomain.CompanySummary,
            '旧任务工厂新版',
          ),
          'productList:重型纸箱',
        ],
      },
      touchedFields: ['companySummary'],
    });
    const indexStore = workspaceStore.getTrustedProfileIndexStore();
    const firstClaim = indexStore.claimNext('2026-07-13T00:00:00.000Z')!;
    expect(indexStore.completeAttempt(
      firstClaim.job.id,
      firstClaim.attempt.id,
      '2026-07-13T00:01:00.000Z',
    )).toBe(true);
    const secondClaim = indexStore.claimNext('2026-07-13T00:02:00.000Z')!;
    expect(indexStore.completeAttempt(
      secondClaim.job.id,
      secondClaim.attempt.id,
      '2026-07-13T00:03:00.000Z',
    )).toBe(true);
    const stateBefore = indexStore.getState(current.id)!;
    db.prepare(`
      UPDATE knowledge_trusted_profile_index_jobs
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(
      KnowledgeTrustedIndexRefreshStatus.Queued,
      '2026-07-13T00:04:00.000Z',
      firstClaim.job.id,
    );
    const replaceTrustedSources = vi.fn();
    const service = new KnowledgeTrustedProfileIndexService({
      indexStore,
      loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
      replaceTrustedSources,
      clock: createClock(),
    });

    await service.waitForIdle();

    expect(replaceTrustedSources).not.toHaveBeenCalled();
    expect(indexStore.getState(current.id)).toEqual(stateBefore);
    expect(indexStore.listAttempts(firstClaim.job.id).map(attempt => attempt.outcome)).toEqual([
      KnowledgeTrustedIndexRefreshAttemptOutcome.Completed,
      KnowledgeTrustedIndexRefreshAttemptOutcome.Completed,
    ]);
  });

  test('does not lose a synchronous tail wake observed at the claim-null boundary', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspace = createWorkspace(workspaceStore, '尾部唤醒工厂');
    const indexStore = workspaceStore.getTrustedProfileIndexStore();
    const originalClaimNext = indexStore.claimNext.bind(indexStore);
    let service!: KnowledgeTrustedProfileIndexService;
    const claimNext = vi.spyOn(indexStore, 'claimNext');
    claimNext.mockImplementationOnce(() => {
      service.wake();
      return null;
    });
    claimNext.mockImplementation((now?: string) => originalClaimNext(now));
    service = new KnowledgeTrustedProfileIndexService({
      indexStore,
      loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
      replaceTrustedSources: vi.fn(),
      clock: createClock(),
    });

    await service.waitForIdle();

    expect(claimNext.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(indexStore.getState(workspace.id)).toMatchObject({ indexedProfileRevision: 1 });
  });

  test('sanitizes a refresh failure, continues to newer work, and retries only after outer commit', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const secret = 'TASK10_PROFILE_SOURCE_ERROR_CAUSE_SECRET';
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const failing = createWorkspace(workspaceStore, '失败工厂', secret);
    const succeeding = createWorkspace(workspaceStore, '成功工厂');
    let shouldFail = true;
    const replacement = vi.fn(async (scopeId: string) => {
      if (scopeId === buildEnterpriseLeadWorkspaceKnowledgeScopeId(failing.id) && shouldFail) {
        throw Object.assign(new Error(secret), {
          cause: { providerToken: secret },
          source: secret,
        });
      }
    });
    const logged: unknown[] = [];
    const service = new KnowledgeTrustedProfileIndexService({
      indexStore: workspaceStore.getTrustedProfileIndexStore(),
      loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
      replaceTrustedSources: replacement,
      clock: createClock(),
      logError: event => logged.push(event),
    });

    await service.waitForIdle();

    const failedJob = workspaceStore.getTrustedProfileIndexStore().getJob(failing.id, 1)!;
    expect(failedJob).toMatchObject({
      status: KnowledgeTrustedIndexRefreshStatus.Failed,
      errorCode: KnowledgeTrustedProfileIndexErrorCode.RefreshFailed,
    });
    expect(workspaceStore.getTrustedProfileIndexStore().getState(failing.id)).toBeNull();
    expect(workspaceStore.getTrustedProfileIndexStore().getState(succeeding.id))
      .toMatchObject({ indexedProfileRevision: 1 });
    expect(JSON.stringify({ failedJob, logged })).not.toContain(secret);
    expect(logged).toEqual([
      {
        module: '[KnowledgeTrustedProfileIndex]',
        workspaceId: failing.id,
        jobId: failedJob.id,
        attemptId: expect.any(String),
        code: KnowledgeTrustedProfileIndexErrorCode.RefreshFailed,
      },
    ]);

    shouldFail = false;
    expect(service.retryFailed()).toBe(1);
    await service.waitForIdle();

    expect(workspaceStore.getTrustedProfileIndexStore().getState(failing.id))
      .toMatchObject({ indexedProfileRevision: 1 });
    expect(workspaceStore.getTrustedProfileIndexStore().listAttempts(failedJob.id).map(
      attempt => attempt.outcome,
    )).toEqual([
      KnowledgeTrustedIndexRefreshAttemptOutcome.Failed,
      KnowledgeTrustedIndexRefreshAttemptOutcome.Completed,
    ]);
  });

  test('continues from a failed older revision to a newer success without replaying the failure', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const initial = createWorkspace(workspaceStore, '连续版本工厂');
    const revisionTwo = workspaceStore.updateWorkspaceProfile({
      workspaceId: initial.id,
      expectedProfileRevision: 1,
      profile: { ...initial.profile, contactRules: ['revision 2'] },
      touchedFields: [KnowledgeFactDomain.ContactRules],
    });
    const revisionThree = workspaceStore.updateWorkspaceProfile({
      workspaceId: initial.id,
      expectedProfileRevision: revisionTwo.profileRevision,
      profile: { ...revisionTwo.profile, contactRules: ['revision 3'] },
      touchedFields: [KnowledgeFactDomain.ContactRules],
    });
    let replacements = 0;
    const service = new KnowledgeTrustedProfileIndexService({
      indexStore: workspaceStore.getTrustedProfileIndexStore(),
      loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
      replaceTrustedSources: async () => {
        replacements += 1;
        if (replacements === 2) throw new Error('revision 2 refresh failed');
      },
      logError: vi.fn(),
      clock: createClock(),
    });

    await service.waitForIdle();

    const indexStore = workspaceStore.getTrustedProfileIndexStore();
    expect(replacements).toBe(3);
    expect(indexStore.getJob(initial.id, 2)).toMatchObject({
      status: KnowledgeTrustedIndexRefreshStatus.Failed,
      attemptCount: 1,
    });
    expect(indexStore.listAttempts(indexStore.getJob(initial.id, 2)!.id).map(
      attempt => attempt.outcome,
    )).toEqual([KnowledgeTrustedIndexRefreshAttemptOutcome.Failed]);
    expect(indexStore.getJob(initial.id, 3)).toMatchObject({
      status: KnowledgeTrustedIndexRefreshStatus.Completed,
      attemptCount: 1,
    });
    expect(indexStore.getState(revisionThree.id)).toMatchObject({
      indexedProfileRevision: 3,
    });
  });

  test('retries transient trusted-vector BUSY without recording a refresh failure', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspace = createWorkspace(workspaceStore, '向量忙工厂');
    let replacementAttempts = 0;
    const logged: unknown[] = [];
    const service = new KnowledgeTrustedProfileIndexService({
      indexStore: workspaceStore.getTrustedProfileIndexStore(),
      loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
      replaceTrustedSources: () => {
        replacementAttempts += 1;
        if (replacementAttempts <= 3) {
          throw Object.assign(new Error('raw vector busy secret'), {
            code: 'SQLITE_BUSY',
          });
        }
      },
      busyRetryDelay: async () => undefined,
      logError: event => logged.push(event),
      clock: createClock(),
    });

    await service.waitForIdle();

    expect(replacementAttempts).toBe(4);
    expect(workspaceStore.getTrustedProfileIndexStore().getState(workspace.id))
      .toMatchObject({ indexedProfileRevision: 1 });
    expect(workspaceStore.getTrustedProfileIndexStore().getJob(workspace.id, 1))
      .toMatchObject({
        status: KnowledgeTrustedIndexRefreshStatus.Completed,
        attemptCount: 1,
        errorCode: null,
      });
    expect(logged).toEqual([]);
  });

  test('retries transient exact-completion BUSY without recording a refresh failure', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspace = createWorkspace(workspaceStore, '完成忙工厂');
    const indexStore = workspaceStore.getTrustedProfileIndexStore();
    const originalComplete = indexStore.completeAttempt.bind(indexStore);
    const completeAttempt = vi.spyOn(indexStore, 'completeAttempt');
    let completionAttempts = 0;
    completeAttempt.mockImplementation((...args) => {
      completionAttempts += 1;
      if (completionAttempts <= 3) {
        throw Object.assign(new Error('raw completion busy secret'), {
          code: 'SQLITE_BUSY_SNAPSHOT',
        });
      }
      return originalComplete(...args);
    });
    const logged: unknown[] = [];
    const service = new KnowledgeTrustedProfileIndexService({
      indexStore,
      loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
      replaceTrustedSources: vi.fn(),
      busyRetryDelay: async () => undefined,
      logError: event => logged.push(event),
      clock: createClock(),
    });

    await service.waitForIdle();

    expect(completeAttempt).toHaveBeenCalledTimes(4);
    expect(indexStore.getState(workspace.id)).toMatchObject({ indexedProfileRevision: 1 });
    expect(indexStore.getJob(workspace.id, 1)).toMatchObject({
      status: KnowledgeTrustedIndexRefreshStatus.Completed,
      attemptCount: 1,
      errorCode: null,
    });
    expect(logged).toEqual([]);
  });

  test('does not abort workspace A BUSY retry when workspace B is deleted and still drains C', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspaceA = createWorkspace(workspaceStore, 'BUSY 工厂 A');
    const workspaceB = createWorkspace(workspaceStore, '删除工厂 B');
    const workspaceC = createWorkspace(workspaceStore, '后续工厂 C');
    const indexStore = workspaceStore.getTrustedProfileIndexStore();
    const orderJobs = db.prepare(`
      UPDATE knowledge_trusted_profile_index_jobs
      SET updated_at = ?
      WHERE workspace_id = ? AND profile_revision = 1
    `);
    orderJobs.run('2026-07-13T00:00:00.000Z', workspaceA.id);
    orderJobs.run('2026-07-13T00:00:01.000Z', workspaceB.id);
    orderJobs.run('2026-07-13T00:00:02.000Z', workspaceC.id);
    const workspaceAJob = indexStore.getJob(workspaceA.id, 1)!;
    const originalFailAttempt = indexStore.failAttempt.bind(indexStore);
    let workspaceAFailAttempts = 0;
    vi.spyOn(indexStore, 'failAttempt').mockImplementation((jobId, attemptId, now) => {
      if (jobId === workspaceAJob.id && workspaceAFailAttempts === 0) {
        workspaceAFailAttempts += 1;
        throw Object.assign(new Error('workspace A raw BUSY secret'), {
          code: 'SQLITE_BUSY',
        });
      }
      if (jobId === workspaceAJob.id) workspaceAFailAttempts += 1;
      return originalFailAttempt(jobId, attemptId, now);
    });
    let releaseBusyDelay: () => void = () => undefined;
    const busyDelayGate = new Promise<void>(resolve => {
      releaseBusyDelay = resolve;
    });
    let busyDelayStarted = false;
    const replacedScopes: string[] = [];
    const workspaceAScope = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceA.id);
    const workspaceBScope = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceB.id);
    const service = new KnowledgeTrustedProfileIndexService({
      indexStore,
      loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
      replaceTrustedSources: async scopeId => {
        replacedScopes.push(scopeId);
        if (scopeId === workspaceAScope) {
          throw new Error('workspace A refresh terminal failure');
        }
      },
      busyRetryDelay: async () => {
        busyDelayStarted = true;
        await busyDelayGate;
      },
      logError: vi.fn(),
      clock: createClock(),
    });
    await waitFor(() => busyDelayStarted);

    service.abortActiveAttemptForWorkspace(workspaceB.id);
    db.transaction(() => {
      indexStore.deleteWorkspaceTrustedIndexInCurrentTransaction(workspaceB.id);
      workspaceStore.deleteWorkspaceRowInCurrentTransaction(workspaceB.id);
    })();
    releaseBusyDelay();
    await service.waitForIdle();

    expect(workspaceAFailAttempts).toBe(2);
    expect(indexStore.getJob(workspaceA.id, 1)).toMatchObject({
      status: KnowledgeTrustedIndexRefreshStatus.Failed,
      activeAttemptId: null,
    });
    expect(indexStore.getState(workspaceC.id)).toMatchObject({ indexedProfileRevision: 1 });
    expect(workspaceStore.getWorkspace(workspaceB.id)).toBeNull();
    expect(indexStore.getJob(workspaceB.id, 1)).toBeNull();
    expect(indexStore.getState(workspaceB.id)).toBeNull();
    expect(replacedScopes).not.toContain(workspaceBScope);
  });

  test('does not poison an inactive workspace abort before its later claim', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspaceA = createWorkspace(workspaceStore, 'active workspace A');
    const workspaceB = createWorkspace(workspaceStore, 'later workspace B');
    const indexStore = workspaceStore.getTrustedProfileIndexStore();
    const orderJobs = db.prepare(`
      UPDATE knowledge_trusted_profile_index_jobs
      SET updated_at = ?
      WHERE workspace_id = ? AND profile_revision = 1
    `);
    orderJobs.run('2026-07-13T00:00:00.000Z', workspaceA.id);
    orderJobs.run('2026-07-13T00:00:01.000Z', workspaceB.id);
    let releaseWorkspaceA: () => void = () => undefined;
    const workspaceAGate = new Promise<void>(resolve => {
      releaseWorkspaceA = resolve;
    });
    const workspaceAScope = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceA.id);
    const workspaceBScope = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceB.id);
    const replacedScopes: string[] = [];
    const service = new KnowledgeTrustedProfileIndexService({
      indexStore,
      loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
      replaceTrustedSources: async scopeId => {
        replacedScopes.push(scopeId);
        if (scopeId === workspaceAScope) await workspaceAGate;
      },
      clock: createClock(),
    });
    await waitFor(() => replacedScopes.includes(workspaceAScope));

    service.abortActiveAttemptForWorkspace(workspaceB.id);
    releaseWorkspaceA();
    await service.waitForIdle();

    expect(replacedScopes).toEqual([workspaceAScope, workspaceBScope]);
    expect(indexStore.getJob(workspaceA.id, 1)).toMatchObject({
      status: KnowledgeTrustedIndexRefreshStatus.Completed,
      activeAttemptId: null,
    });
    expect(indexStore.getJob(workspaceB.id, 1)).toMatchObject({
      status: KnowledgeTrustedIndexRefreshStatus.Completed,
      activeAttemptId: null,
    });
    expect(indexStore.getState(workspaceB.id)).toMatchObject({ indexedProfileRevision: 1 });
  });

  test('recovers a crash after vector replacement with the gate closed until exact completion', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const vectorStore = new ContentKnowledgeVectorStore(db);
    const workspace = createWorkspace(workspaceStore, '恢复工厂');
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspace.id);
    vectorStore.replaceWorkspaceDocumentSources(scopeId, [{
      sourceId: 'raw-recovery',
      sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
      label: '恢复原始资料',
      content: '工业包装原始资料',
    }]);
    const crashedClaim = workspaceStore.getTrustedProfileIndexStore().claimNext(
      '2026-07-13T00:00:00.000Z',
    )!;
    vectorStore.replaceTrustedSources(scopeId, [{
      sourceId: `profile-confirmed:${workspace.id}`,
      sourceType: ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
      label: '已确认业务知识',
      content: '已确认：恢复工厂主营工业包装',
    }]);
    expect(readAllSourceTypes(vectorStore.search(
      scopeId,
      '工业包装',
      { hitThreshold: 0, maxHits: 20, minBusinessSignals: 0 },
    ))).toEqual([ContentKnowledgeSourceType.WorkspaceDocument]);

    let releaseReplacement: () => void = () => {};
    const replacementGate = new Promise<void>(resolve => {
      releaseReplacement = resolve;
    });
    let replacementStarted = false;
    const service = new KnowledgeTrustedProfileIndexService({
      indexStore: workspaceStore.getTrustedProfileIndexStore(),
      loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
      replaceTrustedSources: async (replacementScopeId, sources) => {
        replacementStarted = true;
        await replacementGate;
        vectorStore.replaceTrustedSources(replacementScopeId, sources);
      },
      clock: createClock(),
    });
    await waitFor(() => replacementStarted);

    expect(workspaceStore.getTrustedProfileIndexStore().getState(workspace.id)).toBeNull();
    releaseReplacement();
    await service.waitForIdle();

    expect(workspaceStore.getTrustedProfileIndexStore().getState(workspace.id))
      .toMatchObject({ indexedProfileRevision: 1 });
    expect(workspaceStore.getTrustedProfileIndexStore().listAttempts(crashedClaim.job.id).map(
      attempt => attempt.outcome,
    )).toEqual([
      KnowledgeTrustedIndexRefreshAttemptOutcome.Abandoned,
      KnowledgeTrustedIndexRefreshAttemptOutcome.Completed,
    ]);
    expect(readAllSourceTypes(vectorStore.search(
      scopeId,
      '工业包装',
      { hitThreshold: 0, maxHits: 20, minBusinessSignals: 0 },
    ))).toEqual([
      ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
      ContentKnowledgeSourceType.WorkspaceDocument,
      ContentKnowledgeSourceType.WorkspaceRule,
    ].sort());
  });

  test('shutdown lets the current committed refresh finish but prevents another claim', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const first = createWorkspace(workspaceStore, '关闭工厂 A');
    const second = createWorkspace(workspaceStore, '关闭工厂 B');
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let replacements = 0;
    const service = new KnowledgeTrustedProfileIndexService({
      indexStore: workspaceStore.getTrustedProfileIndexStore(),
      loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
      replaceTrustedSources: async () => {
        replacements += 1;
        await gate;
      },
      clock: createClock(),
    });
    await waitFor(() => replacements === 1);

    const shutdown = service.shutdown();
    service.wake();
    release();
    await shutdown;
    await service.waitForIdle();

    expect(replacements).toBe(1);
    expect([
      workspaceStore.getTrustedProfileIndexStore().getState(first.id),
      workspaceStore.getTrustedProfileIndexStore().getState(second.id),
    ].filter(Boolean)).toHaveLength(1);
    expect([
      workspaceStore.getTrustedProfileIndexStore().getJob(first.id, 1)?.status,
      workspaceStore.getTrustedProfileIndexStore().getJob(second.id, 1)?.status,
    ].sort()).toEqual([
      KnowledgeTrustedIndexRefreshStatus.Completed,
      KnowledgeTrustedIndexRefreshStatus.Queued,
    ].sort());
  });

  test('retries a safe exhausted-claim signal after a real WAL lock is released', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-service-real-lock-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'trusted.sqlite');
    const workerDb = new Database(databasePath);
    databases.push(workerDb);
    workerDb.pragma('journal_mode = WAL');
    workerDb.pragma('busy_timeout = 0');
    const workspaceStore = new EnterpriseLeadWorkspaceStore(workerDb);
    const workspace = createWorkspace(workspaceStore, '真实锁工厂');
    const lockDb = new Database(databasePath);
    databases.push(lockDb);
    lockDb.pragma('journal_mode = WAL');
    lockDb.pragma('busy_timeout = 0');
    let retryDelays = 0;
    const logged: unknown[] = [];
    const service = new KnowledgeTrustedProfileIndexService({
      indexStore: workspaceStore.getTrustedProfileIndexStore(),
      loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
      replaceTrustedSources: vi.fn(),
      busyRetryDelay: async () => {
        retryDelays += 1;
        if (lockDb.inTransaction) lockDb.exec('COMMIT');
      },
      logError: event => logged.push(event),
      clock: createClock(),
    });
    lockDb.exec('BEGIN IMMEDIATE');

    await service.waitForIdle();

    expect(retryDelays).toBeGreaterThanOrEqual(1);
    expect(workspaceStore.getTrustedProfileIndexStore().getState(workspace.id))
      .toMatchObject({ indexedProfileRevision: 1 });
    expect(logged).toEqual([]);
  });

  test('continues draining when a post-terminal logging sink throws', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const failing = createWorkspace(workspaceStore, '日志失败工厂');
    const succeeding = createWorkspace(workspaceStore, '日志后续工厂');
    const service = new KnowledgeTrustedProfileIndexService({
      indexStore: workspaceStore.getTrustedProfileIndexStore(),
      loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
      replaceTrustedSources: async scopeId => {
        if (scopeId === buildEnterpriseLeadWorkspaceKnowledgeScopeId(failing.id)) {
          throw new Error('refresh failure before throwing logger');
        }
      },
      logError: () => {
        throw new Error('TASK10_THROWING_LOGGER_SECRET');
      },
      clock: createClock(),
    });

    await expect(service.waitForIdle()).resolves.toBeUndefined();

    expect(workspaceStore.getTrustedProfileIndexStore().getJob(failing.id, 1))
      .toMatchObject({ status: KnowledgeTrustedIndexRefreshStatus.Failed });
    expect(workspaceStore.getTrustedProfileIndexStore().getState(succeeding.id))
      .toMatchObject({ indexedProfileRevision: 1 });
  });

  test('shutdown interrupts failure-state BUSY backoff and leaves the durable running lease', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspace = createWorkspace(workspaceStore, '失败退避工厂');
    const indexStore = workspaceStore.getTrustedProfileIndexStore();
    const busyError = Object.assign(new Error('raw busy secret'), {
      code: 'SQLITE_BUSY',
    });
    const failAttempt = vi.spyOn(indexStore, 'failAttempt');
    failAttempt.mockImplementation(() => {
      throw busyError;
    });
    let releaseDelay: () => void = () => {};
    let delayStarted = false;
    const service = new KnowledgeTrustedProfileIndexService({
      indexStore,
      loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
      replaceTrustedSources: async () => {
        throw new Error('replacement failed');
      },
      busyRetryDelay: async () => {
        delayStarted = true;
        await new Promise<void>(resolve => {
          releaseDelay = resolve;
        });
      },
      clock: createClock(),
    });
    await waitFor(() => delayStarted);

    const shutdown = service.shutdown();
    const outcome = await Promise.race([
      shutdown.then(() => 'shutdown'),
      new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 30)),
    ]);
    if (outcome === 'timeout') releaseDelay();
    await shutdown;

    expect(outcome).toBe('shutdown');
    expect(indexStore.getJob(workspace.id, 1)).toMatchObject({
      status: KnowledgeTrustedIndexRefreshStatus.Running,
      activeAttemptId: expect.any(String),
    });
    expect(indexStore.getState(workspace.id)).toBeNull();
  });

  test('shutdown interrupts trusted-vector BUSY backoff without fabricating a failure', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspace = createWorkspace(workspaceStore, '向量退避关闭工厂');
    const indexStore = workspaceStore.getTrustedProfileIndexStore();
    const failAttempt = vi.spyOn(indexStore, 'failAttempt');
    let releaseDelay: () => void = () => {};
    let delayStarted = false;
    const service = new KnowledgeTrustedProfileIndexService({
      indexStore,
      loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
      replaceTrustedSources: async () => {
        throw Object.assign(new Error('raw vector busy during shutdown'), {
          code: 'SQLITE_BUSY',
        });
      },
      busyRetryDelay: async () => {
        delayStarted = true;
        await new Promise<void>(resolve => {
          releaseDelay = resolve;
        });
      },
      clock: createClock(),
    });
    await waitFor(() => delayStarted);

    const shutdown = service.shutdown();
    const outcome = await Promise.race([
      shutdown.then(() => 'shutdown'),
      new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 30)),
    ]);
    if (outcome === 'timeout') releaseDelay();
    await shutdown;

    expect(outcome).toBe('shutdown');
    expect(failAttempt).not.toHaveBeenCalled();
    expect(indexStore.getJob(workspace.id, 1)).toMatchObject({
      status: KnowledgeTrustedIndexRefreshStatus.Running,
      errorCode: null,
    });
    expect(indexStore.getState(workspace.id)).toBeNull();
  });

  test('keeps the gate closed and the running lease durable when exact completion ownership is lost', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const vectorStore = new ContentKnowledgeVectorStore(db);
    const workspace = createWorkspace(workspaceStore, '完成丢失工厂');
    const scopeId = buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspace.id);
    vectorStore.replaceWorkspaceDocumentSources(scopeId, [{
      sourceId: 'raw-completion-lost',
      sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
      label: '完成丢失原始资料',
      content: '工业包装原始资料',
    }]);
    const indexStore = workspaceStore.getTrustedProfileIndexStore();
    const completeAttempt = vi.spyOn(indexStore, 'completeAttempt');
    completeAttempt.mockReturnValue(false);
    const logged: unknown[] = [];
    const service = new KnowledgeTrustedProfileIndexService({
      indexStore,
      loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
      replaceTrustedSources: (replacementScopeId, sources) =>
        vectorStore.replaceTrustedSources(replacementScopeId, sources),
      logError: event => logged.push(event),
      clock: createClock(),
    });

    await service.waitForIdle();

    expect(completeAttempt).toHaveBeenCalledTimes(1);
    expect(indexStore.getJob(workspace.id, 1)).toMatchObject({
      status: KnowledgeTrustedIndexRefreshStatus.Running,
      activeAttemptId: expect.any(String),
    });
    expect(indexStore.getState(workspace.id)).toBeNull();
    expect(logged).toEqual([]);
    expect(readAllSourceTypes(vectorStore.search(
      scopeId,
      '工业包装',
      { hitThreshold: 0, maxHits: 20, minBusinessSignals: 0 },
    ))).toEqual([ContentKnowledgeSourceType.WorkspaceDocument]);
  });
});
