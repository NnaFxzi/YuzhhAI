import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { EnterpriseLeadWorkspaceType } from '../../shared/enterpriseLeadWorkspace/constants';
import {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentIndexAttemptOutcome,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeEnrichmentAttemptOutcome,
  KnowledgeEnrichmentStatus,
  KnowledgeMigrationStatus,
} from '../../shared/knowledgeBase/constants';
import { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import {
  createKnowledgeBaseFoundation,
  type KnowledgeBaseFoundation,
  recoverAndMigrateKnowledgeBase,
} from './knowledgeBaseFoundation';
import { InlineKnowledgeDocumentIndexExecutor } from './knowledgeDocumentIndexExecutor';
import { KnowledgeDocumentIndexStore } from './knowledgeDocumentIndexStore';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';
import { KnowledgeEnrichmentRequestStore } from './knowledgeEnrichmentRequestStore';
import { KnowledgeFactProjectionStore } from './knowledgeFactProjectionStore';
import { KnowledgeFactStore } from './knowledgeFactStore';
import { KnowledgeIngestionJobStore } from './knowledgeIngestionJobStore';
import type {
  KnowledgeMigrationResult,
  LegacyKnowledgeWorkspace,
} from './knowledgeMigrationService';

const completedMigrationResult = (workspaceId: string): KnowledgeMigrationResult => ({
  workspaceId,
  sourceCount: 0,
  migratedCount: 0,
  skippedCount: 0,
  status: KnowledgeMigrationStatus.Completed,
  diagnostics: [],
});

type FoundationOptions = Parameters<typeof createKnowledgeBaseFoundation>[0];

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(innerResolve => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};

const createTestFoundation = (
  options: Omit<FoundationOptions, 'indexExecutorFactory'>,
): KnowledgeBaseFoundation => createKnowledgeBaseFoundation({
  ...options,
  indexExecutorFactory: ({ store }) => new InlineKnowledgeDocumentIndexExecutor(store),
});

const ensureTestWorkspace = (db: Database.Database, workspaceId: string): void => {
  const store = new EnterpriseLeadWorkspaceStore(db);
  if (store.getWorkspace(workspaceId)) return;
  const now = '2026-07-11T00:00:00.000Z';
  db.prepare(`
    INSERT INTO enterprise_lead_workspaces (
      id, name, type, profile, extraction_sources, risk_rules,
      enabled_agent_roles, settings, workspace_agents, recent_run_id,
      created_at, updated_at
    ) VALUES (?, ?, 'enterprise_lead', ?, '[]', '[]', '[]', NULL, NULL, NULL, ?, ?)
  `).run(workspaceId, workspaceId, JSON.stringify({
    companySummary: '', productList: [], productCapabilities: [], targetCustomers: [],
    applicationScenarios: [], sellingPoints: [], channelPreferences: [], prohibitedClaims: [],
    contactRules: [], missingInfo: [],
  }), now, now);
};

describe('knowledge base foundation', () => {
  const databases: Database.Database[] = [];
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    databases.splice(0).forEach(database => database.close());
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map(directory => fs.rm(directory, { recursive: true, force: true })),
    );
  });

  const createFoundationFixture = async (
    overrides: Pick<FoundationOptions, 'replaceWorkspaceDocumentSource'> = {},
  ) => {
    const db = new Database(':memory:');
    databases.push(db);
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-foundation-index-'));
    temporaryDirectories.push(userDataPath);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspace = workspaceStore.createWorkspace({
      name: 'Index test workspace',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
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
      enabledAgentRoles: [],
    });
    let executor!: InlineKnowledgeDocumentIndexExecutor;
    const foundation = createKnowledgeBaseFoundation({
      db,
      userDataPath,
      workspaceStore,
      indexExecutorFactory: ({ store }) => {
        executor = new InlineKnowledgeDocumentIndexExecutor(store);
        return executor;
      },
      ...overrides,
    });
    const createReadyDocument = (text: string) =>
      foundation.documentStore.createDocumentWithVersion({
        workspaceId: workspace.id,
        displayName: `${randomUUID()}.txt`,
        sourceMode: KnowledgeDocumentSourceMode.Managed,
        status: KnowledgeDocumentStatus.Ready,
        version: {
          contentHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
          managedPath: `blobs/test/${randomUUID()}`,
          mimeType: 'text/plain',
          fileSize: text.length,
          sourceMtime: null,
          parser: 'text',
          extractedText: text,
          extractionPartial: false,
        },
      });
    const schedule = (target: ReturnType<typeof createReadyDocument>) =>
      foundation.indexStore.scheduleCurrentVersion({
        workspaceId: workspace.id,
        documentId: target.document.id,
        documentVersionId: target.version.id,
      });
    return { db, executor, foundation, workspace, createReadyDocument, schedule };
  };

  test('recovers abandoned jobs before migrating workspaces', async () => {
    const events: string[] = [];
    await recoverAndMigrateKnowledgeBase({
      cleanupOrphans: () => {
        events.push('cleanup-orphans');
      },
      jobStore: {
        recoverAbandonedJobs: () => {
          events.push('recover-jobs');
          return 0;
        },
      },
      enrichmentRequestStore: {
        recoverAbandonedRunning: () => {
          events.push('recover-enrichment');
          return 0;
        },
      },
      trustedIndexStore: {
        recoverAbandonedRunning: () => {
          events.push('recover-trusted');
          return 0;
        },
        reconcileAll: () => {
          events.push('reconcile-trusted');
          return 0;
        },
      },
      indexStore: {
        recoverAbandonedIndexing: () => {
          events.push('recover-index');
          return 0;
        },
        reconcileMissingStates: () => {
          events.push('reconcile-index');
          return { pendingCount: 0, notApplicableCount: 0 };
        },
      },
      migrationService: {
        migrateWorkspace: async workspace => {
          events.push(`migrate:${workspace.id}`);
          return completedMigrationResult(workspace.id);
        },
      },
      workspaces: [{ id: 'workspace-a', extractionSources: [] }],
      staleBefore: '2026-07-11T00:50:00.000Z',
      now: '2026-07-11T01:00:00.000Z',
      onReady: () => {
        events.push('wake-ingestion');
        events.push('wake-index');
        events.push('wake-enrichment');
        events.push('wake-trusted');
      },
    } as Parameters<typeof recoverAndMigrateKnowledgeBase>[0]);

    expect(events).toEqual([
      'cleanup-orphans',
      'recover-jobs',
      'recover-index',
      'recover-enrichment',
      'recover-trusted',
      'migrate:workspace-a',
      'reconcile-index',
      'reconcile-trusted',
      'wake-ingestion',
      'wake-index',
      'wake-enrichment',
      'wake-trusted',
    ]);
  });

  test('resumes queued enrichment only after recovery and never replays abandoned running work', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const requestStore = new KnowledgeEnrichmentRequestStore(db);
    new KnowledgeDocumentStore(db);
    new KnowledgeDocumentIndexStore(db);
    new KnowledgeFactStore(db, { requestStore });
    const running = requestStore.createOrGetAuthorizedRequest({
      workspaceId: 'workspace-a',
      documentId: 'document-running',
      documentVersionId: 'version-running',
      providerId: 'provider-a',
      modelId: 'model-a',
      routingFingerprint: 'a'.repeat(64),
      now: '2026-07-13T00:00:00.000Z',
    });
    const queued = requestStore.createOrGetAuthorizedRequest({
      workspaceId: 'workspace-a',
      documentId: 'document-queued',
      documentVersionId: 'version-queued',
      providerId: 'provider-a',
      modelId: 'model-a',
      routingFingerprint: 'a'.repeat(64),
      now: '2026-07-13T00:00:02.000Z',
    });
    requestStore.claimNext('2026-07-13T00:00:01.000Z');
    const events: string[] = [];
    let recoveryComplete = false;
    let claimedRequestId: string | null = null;
    const modelGenerate = vi.fn(() => {
      expect(recoveryComplete).toBe(true);
      expect(requestStore.getSummary(running.id)?.status).toBe(KnowledgeEnrichmentStatus.Failed);
      events.push('model:queued');
    });
    await recoverAndMigrateKnowledgeBase({
      cleanupOrphans: () => events.push('cleanup'),
      jobStore: { recoverAbandonedJobs: () => 0 },
      indexStore: {
        recoverAbandonedIndexing: () => 0,
        reconcileMissingStates: () => 0,
      },
      enrichmentRequestStore: {
        recoverAbandonedRunning: () => {
          events.push('recover:enrichment');
          return requestStore.recoverAbandonedRunning('2026-07-13T01:00:00.000Z');
        },
      },
      trustedIndexStore: {
        recoverAbandonedRunning: () => 0,
        reconcileAll: () => 0,
      },
      migrationService: { migrateWorkspace: async () => completedMigrationResult('workspace-a') },
      workspaces: [{ id: 'workspace-a', extractionSources: [] }],
      staleBefore: '2026-07-13T00:00:00.000Z',
      now: '2026-07-13T01:00:00.000Z',
      onRecoveryComplete: () => {
        recoveryComplete = true;
      },
      wakeIngestion: () => undefined,
      wakeIndexing: () => undefined,
      wakeEnrichment: () => {
        const claim = requestStore.claimNext('2026-07-13T01:00:01.000Z');
        claimedRequestId = claim?.request.id ?? null;
        if (claim) modelGenerate();
      },
      wakeTrusted: () => undefined,
    } as Parameters<typeof recoverAndMigrateKnowledgeBase>[0]);

    expect(events).toEqual(['cleanup', 'recover:enrichment', 'model:queued']);
    expect(modelGenerate).toHaveBeenCalledTimes(1);
    expect(claimedRequestId).toBe(queued.id);
    expect(requestStore.getSummary(running.id)?.status).toBe(KnowledgeEnrichmentStatus.Failed);
    expect(requestStore.getSummary(queued.id)?.status).toBe(KnowledgeEnrichmentStatus.Running);
  });

  test('continues migrating later workspaces after one migration fails', async () => {
    const migrated: string[] = [];
    const errors: string[] = [];
    const workspaces: LegacyKnowledgeWorkspace[] = [
      { id: 'workspace-a', extractionSources: [] },
      { id: 'workspace-b', extractionSources: [] },
    ];

    await expect(
      recoverAndMigrateKnowledgeBase({
        jobStore: { recoverAbandonedJobs: () => 0 },
        indexStore: {
          recoverAbandonedIndexing: () => 0,
          reconcileMissingStates: () => ({ pendingCount: 0, notApplicableCount: 0 }),
        },
        migrationService: {
          migrateWorkspace: async workspace => {
            if (workspace.id === 'workspace-a') throw new Error('broken legacy source');
            migrated.push(workspace.id);
            return completedMigrationResult(workspace.id);
          },
        },
        workspaces,
        staleBefore: '2026-07-11T00:50:00.000Z',
        now: '2026-07-11T01:00:00.000Z',
        onMigrationError: workspaceId => errors.push(workspaceId),
      }),
    ).resolves.toBeUndefined();
    expect(errors).toEqual(['workspace-a']);
    expect(migrated).toEqual(['workspace-b']);
  });

  test('composes real stores and completes an empty shadow migration', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-foundation-'));
    temporaryDirectories.push(userDataPath);
    ensureTestWorkspace(db, 'workspace-a');
    const foundation = createTestFoundation({ db, userDataPath });

    await foundation.recoverMigrateAndStart(
      [{ id: 'workspace-a', extractionSources: [] }],
      '2026-07-11T01:00:00.000Z',
    );

    expect(foundation.migrationStore.getState('workspace-a')?.status).toBe(
      KnowledgeMigrationStatus.Completed,
    );
  });

  test('composes the complete Plan 2 facade on one database with explicit strict model boundaries', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-full-facade-'));
    temporaryDirectories.push(userDataPath);
    const modelClient = { generate: vi.fn() };
    const strictModelResolver = { resolveRouteSource: vi.fn() };
    const publishedChunkReader = { listPublishedChunks: vi.fn(() => []) };
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const foundation = createTestFoundation({
      db,
      userDataPath,
      workspaceStore,
      modelClient,
      strictModelResolver,
      publishedChunkReader,
      replaceWorkspaceDocumentSource: vi.fn(),
      replaceTrustedSources: vi.fn(),
    } as FoundationOptions);

    expect(foundation.enrichmentService).toBeDefined();
    expect(foundation.enrichmentRequestStore).toBeDefined();
    expect(foundation.factStore).toBeDefined();
    expect(foundation.factQueryService).toBeDefined();
    expect(foundation.factProjector).toBeDefined();
    expect(foundation.authorizationStore).toBeDefined();
    expect(foundation.trustedIndexStore).toBeDefined();
    expect(foundation.trustedIndexingService).toBeDefined();
    expect(foundation.projectionStore).toBeDefined();
    expect(foundation.enrichmentRequestStore.getDatabaseForInternalUse()).toBe(db);
    expect(foundation.factStore.getDatabaseForInternalUse()).toBe(db);
    expect(foundation.projectionStore.getDatabaseForInternalUse()).toBe(db);
    expect(workspaceStore.getProfileRevisionStore().getDatabaseForInternalUse()).toBe(db);
    expect(modelClient.generate).not.toHaveBeenCalled();
    expect(strictModelResolver.resolveRouteSource).not.toHaveBeenCalled();
    expect(publishedChunkReader.listPublishedChunks).not.toHaveBeenCalled();
  });

  test('drives real queued enrichment and trusted work only through injected foundation dependencies', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-wired-facade-'));
    temporaryDirectories.push(userDataPath);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspace = workspaceStore.createWorkspace({
      name: 'wired facade',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile: {
        companySummary: 'Wired company', productList: [], productCapabilities: [],
        targetCustomers: [], applicationScenarios: [], sellingPoints: [], channelPreferences: [],
        prohibitedClaims: [], contactRules: [], missingInfo: [],
      },
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const routingFingerprint = 'a'.repeat(64);
    const strictModelResolver = {
      resolveRouteSource: vi.fn(() => ({
        workspaceId: workspace.id,
        providerId: 'provider-wired',
        modelId: 'model-wired',
        routingFingerprint,
        apiConfig: {
          apiKey: 'SECRET-wired-key',
          baseURL: 'https://example.test/v1',
          model: 'model-wired',
          apiType: 'openai' as const,
        },
        providerLabel: 'Wired provider',
        modelLabel: 'Wired model',
        apiType: 'openai' as const,
      })),
    };
    const modelClient = {
      generate: vi.fn(async () => ({ text: JSON.stringify({ facts: [] }) })),
    };
    let foundation!: KnowledgeBaseFoundation;
    const publishedChunkReader = vi.fn((documentVersionId: string) =>
      foundation.indexStore.listVersionChunks(documentVersionId));
    const replaceTrustedSources = vi.fn();
    foundation = createTestFoundation({
      db,
      userDataPath,
      workspaceStore,
      strictModelResolver,
      modelClient,
      publishedChunkReader,
      replaceTrustedSources,
      replaceWorkspaceDocumentSource: vi.fn(),
    } as FoundationOptions);
    const target = foundation.documentStore.createDocumentWithVersion({
      workspaceId: workspace.id,
      displayName: 'wired.txt',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Ready,
      version: {
        contentHash: 'a'.repeat(64), managedPath: 'blobs/wired', mimeType: 'text/plain',
        fileSize: 12, sourceMtime: null, parser: 'text', extractedText: 'wired content',
        extractionPartial: false,
      },
    });
    foundation.indexStore.scheduleCurrentVersion({
      workspaceId: workspace.id,
      documentId: target.document.id,
      documentVersionId: target.version.id,
    });
    foundation.indexingService.wake();
    await foundation.indexingService.waitForIdle();
    const request = foundation.enrichmentRequestStore.createOrGetAuthorizedRequest({
      workspaceId: workspace.id,
      documentId: target.document.id,
      documentVersionId: target.version.id,
      providerId: 'provider-wired',
      modelId: 'model-wired',
      routingFingerprint,
    });

    expect(strictModelResolver.resolveRouteSource).not.toHaveBeenCalled();
    expect(modelClient.generate).not.toHaveBeenCalled();
    expect(publishedChunkReader).not.toHaveBeenCalled();
    expect(replaceTrustedSources).not.toHaveBeenCalled();
    await foundation.recoverMigrateAndStart([workspace]);
    await foundation.enrichmentService.waitForIdle();
    await foundation.trustedIndexingService.waitForIdle();

    expect(strictModelResolver.resolveRouteSource).toHaveBeenCalled();
    expect(modelClient.generate).toHaveBeenCalledTimes(1);
    expect(publishedChunkReader).toHaveBeenCalled();
    expect(replaceTrustedSources).toHaveBeenCalled();
    expect(foundation.enrichmentRequestStore.getSummary(request.id)?.status).toBe(
      KnowledgeEnrichmentStatus.Completed,
    );
  });

  test('startup reconciliation republishes each ready active raw source once without a full workspace rebuild', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-startup-raw-'));
    temporaryDirectories.push(userDataPath);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspace = workspaceStore.createWorkspace({
      name: 'startup raw',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile: {
        companySummary: '', productList: [], productCapabilities: [], targetCustomers: [],
        applicationScenarios: [], sellingPoints: [], channelPreferences: [], prohibitedClaims: [],
        contactRules: [], missingInfo: [],
      },
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const replaceWorkspaceDocumentSource = vi.fn((_workspaceId: string, _documentId: string) => {
      expect(db.inTransaction).toBe(false);
    });
    const replaceWorkspaceDocumentSources = vi.fn();
    const foundation = createTestFoundation({
      db,
      userDataPath,
      workspaceStore,
      replaceWorkspaceDocumentSource,
      replaceWorkspaceDocumentSources,
    } as FoundationOptions);
    const documents = Array.from({ length: 3 }, (_, index) =>
      foundation.documentStore.createDocumentWithVersion({
        workspaceId: workspace.id,
        displayName: `ready-${index}.txt`,
        sourceMode: KnowledgeDocumentSourceMode.Managed,
        status: KnowledgeDocumentStatus.Ready,
        version: {
          contentHash: String(index + 1).repeat(64), managedPath: `blobs/${index}`,
          mimeType: 'text/plain', fileSize: 10, sourceMtime: null, parser: 'text',
          extractedText: `ready ${index}`, extractionPartial: false,
        },
      }));
    for (const [status, extractedText] of [
      [KnowledgeDocumentStatus.Pending, 'pending'],
      [KnowledgeDocumentStatus.Processing, 'processing'],
      [KnowledgeDocumentStatus.Failed, 'failed'],
      [KnowledgeDocumentStatus.CompletedWithoutText, null],
      [KnowledgeDocumentStatus.Ready, '   '],
    ] as const) {
      foundation.documentStore.createDocumentWithVersion({
        workspaceId: workspace.id,
        displayName: `excluded-${status}.txt`,
        sourceMode: KnowledgeDocumentSourceMode.Managed,
        status,
        version: {
          contentHash: 'e'.repeat(64), managedPath: `blobs/excluded-${status}`,
          mimeType: 'text/plain', fileSize: 10, sourceMtime: null, parser: 'text',
          extractedText, extractionPartial: false,
        },
      });
    }

    await foundation.recoverMigrateAndStart([workspace]);

    expect(replaceWorkspaceDocumentSource).toHaveBeenCalledTimes(documents.length);
    expect(new Set(replaceWorkspaceDocumentSource.mock.calls.map(call => call[1]))).toEqual(
      new Set(documents.map(target => target.document.id)),
    );
    expect(replaceWorkspaceDocumentSources).not.toHaveBeenCalled();
  });

  test('persists deterministic ids for idless legacy sources before migration', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-foundation-'));
    temporaryDirectories.push(userDataPath);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspace = workspaceStore.createWorkspace({
      name: '旧知识库',
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
          kind: 'manual',
          label: '无 ID 旧资料',
          text: '需要稳定身份',
        },
      ],
      enabledAgentRoles: [],
    });
    const foundation = createTestFoundation({ db, userDataPath, workspaceStore });

    await foundation.recoverMigrateAndStart([workspace]);

    const migrated = foundation.documentStore.listDocuments(workspace.id)[0];
    const persistedSource = workspaceStore.getWorkspace(workspace.id)?.extractionSources[0];
    expect(migrated?.legacySourceId).toBeTruthy();
    expect(persistedSource?.id).toBe(migrated?.legacySourceId);
  });

  test('keeps startup idempotent after readiness instead of rerunning migration for later sources', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-foundation-'));
    temporaryDirectories.push(userDataPath);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspace = workspaceStore.createWorkspace({
      name: '持续迁移知识库',
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
          id: 'legacy-first',
          kind: 'manual',
          label: '首批资料',
          text: '首批正文',
        },
      ],
      enabledAgentRoles: [],
    });
    const foundation = createTestFoundation({ db, userDataPath, workspaceStore });

    const startup = foundation.recoverMigrateAndStart([workspace]);
    await startup;
    const updatedWorkspace = workspaceStore.updateWorkspaceSources(workspace.id, [
      ...workspaceStore.getWorkspace(workspace.id)!.extractionSources,
      {
        kind: 'manual',
        label: '后续资料',
        text: '后续正文',
      },
    ]);
    const repeatedStartup = foundation.recoverMigrateAndStart([updatedWorkspace]);
    const reusedStartupPromise = repeatedStartup === startup;
    await repeatedStartup;
    expect(reusedStartupPromise).toBe(true);

    expect(foundation.documentStore.listDocuments(workspace.id)).toHaveLength(1);
    expect(workspaceStore.getWorkspace(workspace.id)?.extractionSources[1]?.id).toBeTruthy();
    expect(foundation.migrationStore.getState(workspace.id)?.version).toBe(2);
    await foundation.ingestionService.waitForIdle();
    await foundation.indexingService.waitForIdle();
  });

  test('migrates an unprocessed legacy file through the real worker boundary', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-foundation-'));
    temporaryDirectories.push(userDataPath);
    const sourcePath = path.join(userDataPath, 'catalog.txt');
    await fs.writeFile(sourcePath, '旧目录正文');
    const extractDocumentText = vi.fn().mockResolvedValue({
      content: '已由本地 worker 解析',
      parser: 'text',
      truncated: false,
    });
    ensureTestWorkspace(db, 'workspace-a');
    const foundation = createTestFoundation({
      db,
      userDataPath,
      extractDocumentText,
    });

    await foundation.recoverMigrateAndStart([
      {
        id: 'workspace-a',
        extractionSources: [
          {
            id: 'legacy-catalog',
            kind: 'file',
            label: '产品目录',
            filePath: sourcePath,
          },
        ],
      },
    ]);
    await foundation.ingestionService.waitForIdle();

    expect(extractDocumentText).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ extensionHint: '.txt' }),
    );
    expect(foundation.documentStore.listDocuments('workspace-a')[0]?.status).toBe(
      KnowledgeDocumentStatus.Ready,
    );
  });

  test('recovers a recently running job left by the previous app process', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-foundation-'));
    temporaryDirectories.push(userDataPath);
    const extractDocumentText = vi.fn().mockResolvedValue({
      content: 'recovered local text',
      parser: 'text',
      truncated: false,
    });
    ensureTestWorkspace(db, 'workspace-a');
    const foundation = createTestFoundation({
      db,
      userDataPath,
      extractDocumentText,
    });
    const blob = await foundation.managedFileStore.importTextSnapshot('managed bytes');
    const created = foundation.documentStore.createDocumentWithVersion({
      workspaceId: 'workspace-a',
      displayName: 'recovered.txt',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Pending,
      version: {
        contentHash: blob.contentHash,
        managedPath: blob.managedPath,
        mimeType: 'text/plain',
        fileSize: blob.fileSize,
        sourceMtime: null,
        parser: null,
        extractedText: null,
        extractionPartial: false,
      },
    });
    const job = foundation.jobStore.createJob(
      {
        workspaceId: 'workspace-a',
        documentId: created.document.id,
        documentVersionId: created.version.id,
      },
      '2026-07-11T00:00:00.000Z',
    );
    foundation.jobStore.claimNextJob('2026-07-11T00:59:59.000Z');

    await foundation.recoverMigrateAndStart([], '2026-07-11T01:00:00.000Z');
    await foundation.ingestionService.waitForIdle();

    expect(extractDocumentText).toHaveBeenCalledTimes(1);
    expect(foundation.jobStore.getJob(job.id)?.status).toBe('completed');
    expect(foundation.documentStore.getVersion(created.version.id)?.extractedText).toBe(
      'recovered local text',
    );
  });

  test('deletes normalized workspace data without leaving text or job attempts', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-foundation-'));
    temporaryDirectories.push(userDataPath);
    ensureTestWorkspace(db, 'workspace-a');
    const foundation = createTestFoundation({ db, userDataPath });
    const created = foundation.documentStore.createDocumentWithVersion({
      workspaceId: 'workspace-a',
      displayName: '待删除资料',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Pending,
      version: {
        contentHash: 'a'.repeat(64),
        managedPath: `blobs/aa/${'a'.repeat(64)}`,
        mimeType: 'text/plain',
        fileSize: 12,
        sourceMtime: null,
        parser: 'text',
        extractedText: '需要被清理的正文',
        extractionPartial: false,
      },
    });
    const job = foundation.jobStore.createJob({
      workspaceId: 'workspace-a',
      documentId: created.document.id,
      documentVersionId: created.version.id,
    });
    foundation.jobStore.claimNextJob();
    foundation.migrationStore.begin('workspace-a', 1, 1);

    foundation.prepareWorkspaceDeletion('workspace-a');

    expect(foundation.documentStore.listDocuments('workspace-a', { includeDeleted: true })).toEqual(
      [],
    );
    expect(foundation.jobStore.getJob(job.id)).toBeNull();
    expect(foundation.migrationStore.getState('workspace-a')).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS count FROM knowledge_document_versions').get()).toEqual({
      count: 0,
    });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM knowledge_ingestion_job_attempts').get(),
    ).toEqual({ count: 0 });
  });

  test('recovers, reconciles, and wakes ingestion before local indexing', async () => {
    const fixture = await createFoundationFixture();
    const ready = fixture.createReadyDocument('searchable');
    const running = fixture.createReadyDocument('recover me');
    fixture.schedule(running);
    fixture.foundation.indexStore.claimNext('2026-07-11T00:59:59.000Z');

    await fixture.foundation.recoverMigrateAndStart(
      [fixture.workspace],
      '2026-07-11T01:00:00.000Z',
    );
    await fixture.foundation.indexingService.waitForIdle();

    expect(fixture.foundation.indexStore.getState(ready.version.id)?.status).toBe(
      KnowledgeDocumentIndexStatus.Indexed,
    );
    expect(fixture.foundation.indexStore.listAttempts(running.version.id)[0].outcome).toBe(
      KnowledgeDocumentIndexAttemptOutcome.Abandoned,
    );
  });

  test('deletes index rows before normalized workspace documents', async () => {
    const fixture = await createFoundationFixture();
    const target = fixture.createReadyDocument('workspace text');
    fixture.schedule(target);
    await fixture.executor.runUntilIdle();

    fixture.foundation.prepareWorkspaceDeletion(fixture.workspace.id);

    expect(fixture.foundation.indexStore.getState(target.version.id)).toBeNull();
    expect(fixture.foundation.indexStore.listVersionChunks(target.version.id)).toEqual([]);
    expect(fixture.foundation.documentStore.getDocument(target.document.id)).toBeNull();
    expect(fixture.workspace).not.toBeNull();
  });

  test('shuts down the index executor before the database is closed', async () => {
    const fixture = await createFoundationFixture();
    const firstShutdown = fixture.foundation.shutdown();
    const secondShutdown = fixture.foundation.shutdown();
    expect(secondShutdown).toBe(firstShutdown);
    await firstShutdown;
    await expect(fixture.executor.runUntilIdle()).rejects.toThrow('index_worker_unavailable');
  });

  test('seals and drains deferred document raw refreshes before foundation shutdown completes', async () => {
    const rawRefreshGate = deferred();
    const replaceWorkspaceDocumentSource = vi.fn(() => rawRefreshGate.promise);
    const fixture = await createFoundationFixture({ replaceWorkspaceDocumentSource });
    const target = fixture.createReadyDocument('raw refresh shutdown ownership');
    const replaced = fixture.foundation.documentService.replaceParsedDocumentVersion({
      documentId: target.document.id,
      expectedRevision: target.document.revision,
      version: {
        contentHash: 'e'.repeat(64),
        managedPath: 'blobs/test/raw-refresh-shutdown',
        mimeType: 'text/plain',
        fileSize: 24,
        sourceMtime: null,
        parser: 'text',
        extractedText: 'deferred raw refresh',
        extractionPartial: false,
      },
    });
    expect(replaceWorkspaceDocumentSource).toHaveBeenCalledTimes(1);

    const firstShutdown = fixture.foundation.shutdown();
    const secondShutdown = fixture.foundation.shutdown();
    expect(secondShutdown).toBe(firstShutdown);
    let shutdownCompleted = false;
    void firstShutdown.then(() => { shutdownCompleted = true; });
    await Promise.resolve();
    expect(shutdownCompleted).toBe(false);

    fixture.foundation.documentService.replaceParsedDocumentVersion({
      documentId: replaced.id,
      expectedRevision: replaced.revision,
      version: {
        contentHash: 'f'.repeat(64),
        managedPath: 'blobs/test/post-seal-refresh',
        mimeType: 'text/plain',
        fileSize: 22,
        sourceMtime: null,
        parser: 'text',
        extractedText: 'post seal raw refresh',
        extractionPartial: false,
      },
    });
    expect(replaceWorkspaceDocumentSource).toHaveBeenCalledTimes(1);

    rawRefreshGate.resolve();
    await firstShutdown;
    expect(shutdownCompleted).toBe(true);
  });

  test('seals and awaits every Plan 2 worker in the locked shutdown order', async () => {
    const fixture = await createFoundationFixture();
    const order: string[] = [];
    const enrichmentGate = deferred();
    const ingestionGate = deferred();
    const trustedGate = deferred();
    const indexGate = deferred();
    const documentGate = deferred();
    const legacyGate = deferred();
    vi.spyOn(fixture.foundation.enrichmentService, 'shutdown').mockImplementation(() => {
      order.push('seal:enrichment');
      return enrichmentGate.promise.then(() => { order.push('done:enrichment'); });
    });
    vi.spyOn(fixture.foundation.ingestionService, 'shutdown').mockImplementation(() => {
      order.push('seal:ingestion');
      return ingestionGate.promise.then(() => { order.push('done:ingestion'); });
    });
    vi.spyOn(fixture.foundation.trustedIndexingService, 'shutdown').mockImplementation(() => {
      order.push('seal:trusted');
      return trustedGate.promise.then(() => { order.push('done:trusted'); });
    });
    vi.spyOn(fixture.foundation.indexingService, 'shutdown').mockImplementation(() => {
      order.push('seal:index');
      return indexGate.promise.then(() => { order.push('done:index'); });
    });
    vi.spyOn(fixture.foundation.documentService, 'shutdown').mockImplementation(() => {
      order.push('seal:document');
      return documentGate.promise.then(() => { order.push('done:document'); });
    });
    fixture.foundation.trackLegacyWork(legacyGate.promise);

    const first = fixture.foundation.shutdown();
    const second = fixture.foundation.shutdown();
    expect(second).toBe(first);
    expect(order).toEqual([
      'seal:enrichment',
      'seal:ingestion',
      'seal:trusted',
      'seal:index',
      'seal:document',
    ]);
    let shutdownCompleted = false;
    void first.then(() => { shutdownCompleted = true; });
    enrichmentGate.resolve();
    await Promise.resolve();
    expect(shutdownCompleted).toBe(false);
    ingestionGate.resolve();
    await Promise.resolve();
    expect(shutdownCompleted).toBe(false);
    trustedGate.resolve();
    await Promise.resolve();
    expect(shutdownCompleted).toBe(false);
    indexGate.resolve();
    await Promise.resolve();
    expect(shutdownCompleted).toBe(false);
    documentGate.resolve();
    await Promise.resolve();
    expect(shutdownCompleted).toBe(false);
    legacyGate.resolve();
    await first;

    expect(order).toEqual([
      'seal:enrichment',
      'seal:ingestion',
      'seal:trusted',
      'seal:index',
      'seal:document',
      'done:enrichment',
      'done:ingestion',
      'done:trusted',
      'done:index',
      'done:document',
    ]);
  });

  test('awaits later drains and legacy work after an earlier worker shutdown rejects', async () => {
    const fixture = await createFoundationFixture();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ingestionGate = deferred();
    const trustedGate = deferred();
    const indexGate = deferred();
    const legacyGate = deferred();
    vi.spyOn(fixture.foundation.enrichmentService, 'shutdown')
      .mockRejectedValue(new Error('SECRET enrichment shutdown /private/path'));
    vi.spyOn(fixture.foundation.ingestionService, 'shutdown')
      .mockReturnValue(ingestionGate.promise);
    vi.spyOn(fixture.foundation.trustedIndexingService, 'shutdown')
      .mockReturnValue(trustedGate.promise);
    vi.spyOn(fixture.foundation.indexingService, 'shutdown')
      .mockReturnValue(indexGate.promise);
    fixture.foundation.trackLegacyWork(legacyGate.promise);

    let completed = false;
    const shutdown = fixture.foundation.shutdown();
    void shutdown.then(() => { completed = true; });
    ingestionGate.resolve();
    trustedGate.resolve();
    indexGate.resolve();
    await Promise.resolve();
    expect(completed).toBe(false);

    legacyGate.resolve();
    await expect(shutdown).resolves.toBeUndefined();
    expect(completed).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      '[KnowledgeBase]',
      { code: 'enrichment_shutdown_failed' },
    );
    const serializedLogs = JSON.stringify(consoleError.mock.calls);
    expect(serializedLogs).not.toContain('SECRET enrichment shutdown');
    expect(serializedLogs).not.toContain('/private/path');
  });

  test('waits for in-flight startup migration and tracked legacy model work before shutdown completes', async () => {
    const fixture = await createFoundationFixture();
    const migrationGate = deferred<KnowledgeMigrationResult>();
    const legacyGate = deferred();
    const migrate = vi.spyOn(fixture.foundation.migrationService, 'migrateWorkspace')
      .mockReturnValue(migrationGate.promise);
    const reconcileIndex = vi.spyOn(fixture.foundation.indexStore, 'reconcileMissingStates');
    const reconcileTrusted = vi.spyOn(fixture.foundation.trustedIndexStore, 'reconcileAll');
    const ingestionWake = vi.spyOn(fixture.foundation.ingestionService, 'wake');
    const indexWake = vi.spyOn(fixture.foundation.indexingService, 'wake');
    const enrichmentWake = vi.spyOn(fixture.foundation.enrichmentService, 'wake');
    const trustedWake = vi.spyOn(fixture.foundation.trustedIndexingService, 'wake');
    fixture.foundation.trackLegacyWork(legacyGate.promise);
    const startup = fixture.foundation.recoverMigrateAndStart([fixture.workspace]);
    await vi.waitFor(() => expect(migrate).toHaveBeenCalledTimes(1));

    let shutdownCompleted = false;
    const shutdown = fixture.foundation.shutdown();
    void shutdown.then(() => { shutdownCompleted = true; });
    await Promise.resolve();
    expect(shutdownCompleted).toBe(false);

    migrationGate.resolve(completedMigrationResult(fixture.workspace.id));
    await startup;
    await Promise.resolve();
    expect(shutdownCompleted).toBe(false);
    expect(reconcileIndex).not.toHaveBeenCalled();
    expect(reconcileTrusted).not.toHaveBeenCalled();
    expect(ingestionWake).not.toHaveBeenCalled();
    expect(indexWake).not.toHaveBeenCalled();
    expect(enrichmentWake).not.toHaveBeenCalled();
    expect(trustedWake).not.toHaveBeenCalled();

    legacyGate.resolve();
    await shutdown;
    expect(shutdownCompleted).toBe(true);
  });

  test('shares one startup/readiness promise and never reruns recovery or wakes after shutdown', async () => {
    const fixture = await createFoundationFixture();
    const recoverJobs = vi.spyOn(fixture.foundation.jobStore, 'recoverAbandonedJobs');
    const reconcileIndex = vi.spyOn(fixture.foundation.indexStore, 'reconcileMissingStates');

    expect(fixture.foundation.isReady()).toBe(false);
    const first = fixture.foundation.recoverMigrateAndStart(
      [fixture.workspace],
      '2026-07-11T01:00:00.000Z',
    );
    const second = fixture.foundation.recoverMigrateAndStart(
      [fixture.workspace],
      '2026-07-11T01:00:00.000Z',
    );
    expect(second).toBe(first);
    expect(fixture.foundation.whenReady()).toBe(first);
    await first;
    expect(fixture.foundation.isReady()).toBe(true);
    expect(recoverJobs).toHaveBeenCalledTimes(1);
    expect(reconcileIndex).toHaveBeenCalledTimes(1);

    await fixture.foundation.shutdown();
    fixture.foundation.ingestionService.wake();
    fixture.foundation.indexingService.wake();
    await fixture.foundation.ingestionService.waitForIdle();
    await fixture.foundation.indexingService.waitForIdle();
    expect(recoverJobs).toHaveBeenCalledTimes(1);
    expect(reconcileIndex).toHaveBeenCalledTimes(1);
  });

  test('never touches persistence when recovery is invoked after the closing gate', async () => {
    const fixture = await createFoundationFixture();
    const cleanup = vi.spyOn(
      fixture.foundation.cleanupCoordinator,
      'cleanupOrphansAtStartup',
    );
    await fixture.foundation.shutdown();

    const first = fixture.foundation.recoverMigrateAndStart([{
      id: fixture.workspace.id,
      extractionSources: [{ kind: 'manual', label: 'late', text: 'late' }],
    }]);
    const second = fixture.foundation.recoverMigrateAndStart([]);

    expect(second).toBe(first);
    await expect(first).resolves.toBeUndefined();
    expect(cleanup).not.toHaveBeenCalled();
    expect(fixture.foundation.isReady()).toBe(false);
    expect(fixture.workspace.extractionSources).toEqual([]);
  });

  test('does not normalize new legacy sources when startup is repeated after shutdown', async () => {
    const fixture = await createFoundationFixture();
    const startup = fixture.foundation.recoverMigrateAndStart([fixture.workspace]);
    await startup;
    await fixture.foundation.shutdown();
    const updated = new EnterpriseLeadWorkspaceStore(fixture.db).updateWorkspaceSources(
      fixture.workspace.id,
      [{ kind: 'manual', label: 'late', text: 'late' }],
    );

    const repeated = fixture.foundation.recoverMigrateAndStart([updated]);

    expect(repeated).toBe(startup);
    expect(new EnterpriseLeadWorkspaceStore(fixture.db)
      .getWorkspace(fixture.workspace.id)?.extractionSources[0]?.id).toBeUndefined();
  });

  test('wakes trusted refresh once only when explicit reconciliation repairs durable work', async () => {
    const fixture = await createFoundationFixture();
    const reconcile = vi.spyOn(fixture.foundation.trustedIndexStore, 'reconcileAll')
      .mockReturnValueOnce(2)
      .mockReturnValueOnce(0);
    const wake = vi.spyOn(fixture.foundation.trustedIndexingService, 'wake');

    expect(fixture.foundation.reconcileTrustedProfileIndex()).toBe(2);
    expect(wake).toHaveBeenCalledTimes(1);
    expect(fixture.foundation.reconcileTrustedProfileIndex()).toBe(0);
    expect(wake).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(2);

    reconcile.mockImplementationOnce(() => {
      throw new Error('SECRET reconcile SQL /private/path');
    });
    expect(() => fixture.foundation.reconcileTrustedProfileIndex()).toThrow();
    expect(wake).toHaveBeenCalledTimes(1);
  });

  test('defers projection validation until startup step zero sweeps parentless rows', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-deferred-projection-'));
    temporaryDirectories.push(userDataPath);
    const bootstrapProjection = new KnowledgeFactProjectionStore(db);
    db.pragma('foreign_keys = OFF');
    db.prepare(`
      INSERT INTO knowledge_fact_projection_support_group_roots (
        workspace_id, domain, normalized_value, root_fact_id
      ) VALUES ('child-only-workspace', 'productList', 'orphan', 'missing-fact')
    `).run();

    const foundation = createTestFoundation({ db, userDataPath });
    expect(foundation.projectionStore.isInitialized()).toBe(false);
    expect(() => foundation.projectionStore.getLedger('missing-fact')).toThrowError(
      expect.objectContaining({ code: KnowledgeBaseErrorCode.BackendNotReady }),
    );

    await foundation.recoverMigrateAndStart([]);

    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM knowledge_fact_projection_support_group_roots
    `).get()).toEqual({ count: 0 });
    expect(foundation.projectionStore.isInitialized()).toBe(true);
    expect(foundation.projectionStore.getLedger('missing-fact')).toBeNull();
    void bootstrapProjection;
  });

  test('deletes queued and running orphan work before any claim, model, extraction, or vector call', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-orphan-workers-'));
    temporaryDirectories.push(userDataPath);
    const workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    const workspace = workspaceStore.createWorkspace({
      name: 'orphan workers',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile: {
        companySummary: '', productList: [], productCapabilities: [], targetCustomers: [],
        applicationScenarios: [], sellingPoints: [], channelPreferences: [], prohibitedClaims: [],
        contactRules: [], missingInfo: [],
      },
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const documentStore = new KnowledgeDocumentStore(db);
    const document = documentStore.createDocumentWithVersion({
      workspaceId: workspace.id,
      displayName: 'orphan.pdf',
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      status: KnowledgeDocumentStatus.Pending,
      version: {
        contentHash: '3'.repeat(64), managedPath: 'blobs/orphan', mimeType: 'application/pdf',
        fileSize: 6, sourceMtime: null, parser: null, extractedText: null,
        extractionPartial: false,
      },
    });
    const jobStore = new KnowledgeIngestionJobStore(db);
    jobStore.createJob({
      workspaceId: workspace.id,
      documentId: document.document.id,
      documentVersionId: document.version.id,
    });
    jobStore.claimNextJob('2026-07-13T01:00:00.000Z');
    const indexStore = new KnowledgeDocumentIndexStore(db);
    indexStore.scheduleCurrentVersion({
      workspaceId: workspace.id,
      documentId: document.document.id,
      documentVersionId: document.version.id,
    });
    indexStore.claimNext('2026-07-13T01:00:01.000Z');
    const _requestStore = new KnowledgeEnrichmentRequestStore(db);
    const orphanRequestId = 'orphan-running-request';
    const orphanAttemptId = 'orphan-running-attempt';
    db.prepare(`
      INSERT INTO knowledge_enrichment_requests (
        id, workspace_id, document_id, document_version_id, status, consent_mode,
        provider_id, model_id, routing_fingerprint, revision, progress, attempt_count,
        active_attempt_id, error_code, error_message, valid_candidate_count,
        discarded_candidate_count, partial_reasons_json, requested_at, started_at,
        heartbeat_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'explicit', 'provider-orphan', 'model-orphan', ?,
        1, 5, 1, ?, NULL, NULL, 0, 0, '[]', ?, ?, ?, NULL, ?)
    `).run(
      orphanRequestId,
      workspace.id,
      document.document.id,
      document.version.id,
      KnowledgeEnrichmentStatus.Running,
      '4'.repeat(64),
      orphanAttemptId,
      '2026-07-13T01:00:00.000Z',
      '2026-07-13T01:00:01.000Z',
      '2026-07-13T01:00:02.000Z',
      '2026-07-13T01:00:02.000Z',
    );
    db.prepare(`
      INSERT INTO knowledge_enrichment_attempts (
        id, request_id, attempt_number, started_at, heartbeat_at, finished_at,
        outcome, error_code, error_message
      ) VALUES (?, ?, 1, ?, ?, NULL, ?, NULL, NULL)
    `).run(
      orphanAttemptId,
      orphanRequestId,
      '2026-07-13T01:00:01.000Z',
      '2026-07-13T01:00:02.000Z',
      KnowledgeEnrichmentAttemptOutcome.Running,
    );
    workspaceStore.getTrustedProfileIndexStore().claimNext('2026-07-13T01:00:03.000Z');
    db.pragma('foreign_keys = OFF');
    db.prepare('DELETE FROM enterprise_lead_workspaces WHERE id = ?').run(workspace.id);
    const extractDocumentText = vi.fn();
    const modelGenerate = vi.fn();
    const replaceWorkspaceDocumentSource = vi.fn();
    const replaceTrustedSources = vi.fn();
    const foundation = createTestFoundation({
      db,
      userDataPath,
      workspaceStore,
      extractDocumentText,
      modelGenerate,
      replaceWorkspaceDocumentSource,
      replaceTrustedSources,
    } as FoundationOptions);

    await foundation.recoverMigrateAndStart([]);
    await foundation.ingestionService.waitForIdle();
    await foundation.indexingService.waitForIdle();
    await foundation.enrichmentService.waitForIdle();
    await foundation.trustedIndexingService.waitForIdle();

    for (const table of [
      'knowledge_ingestion_jobs',
      'knowledge_ingestion_job_attempts',
      'knowledge_document_index_state',
      'knowledge_document_index_attempts',
      'knowledge_enrichment_requests',
      'knowledge_enrichment_attempts',
      'knowledge_trusted_profile_index_jobs',
      'knowledge_trusted_profile_index_attempts',
      'knowledge_documents',
      'knowledge_document_versions',
    ]) {
      expect((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count)
        .toBe(0);
    }
    expect(extractDocumentText).not.toHaveBeenCalled();
    expect(modelGenerate).not.toHaveBeenCalled();
    expect(replaceWorkspaceDocumentSource).not.toHaveBeenCalled();
    expect(replaceTrustedSources).not.toHaveBeenCalled();
  });
});
