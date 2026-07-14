import path from 'node:path';

import Database from 'better-sqlite3';

import { buildEnterpriseLeadWorkspaceKnowledgeScopeId } from '../../shared/enterpriseLeadWorkspace/constants';
import { KnowledgeDocumentStatus } from '../../shared/knowledgeBase/constants';
import { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import type { ModelClientAdapter } from '../industryPack/modelClientAdapter';
import { ModelResponseReadError } from '../industryPack/modelClientAdapter';
import type { ContentKnowledgeSource } from '../libs/contentKnowledgeRetrieval';
import { ContentKnowledgeVectorStore } from '../libs/contentKnowledgeVectorStore';
import { extractDocumentTextFromFile } from '../libs/documentTextExtractor';
import { EnterpriseLeadKnowledgeCompatibilityAdapter } from './enterpriseLeadKnowledgeCompatibilityAdapter';
import { EnterpriseLeadKnowledgeFactProjector } from './enterpriseLeadKnowledgeFactProjector';
import {
  type KnowledgeDocumentIndexExecutor,
  WorkerKnowledgeDocumentIndexExecutor,
} from './knowledgeDocumentIndexExecutor';
import { KnowledgeDocumentIndexService } from './knowledgeDocumentIndexService';
import { KnowledgeDocumentIndexStore } from './knowledgeDocumentIndexStore';
import type { KnowledgeDocumentChunk } from './knowledgeDocumentIndexTypes';
import { KnowledgeDocumentService } from './knowledgeDocumentService';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';
import { KnowledgeEnrichmentModelResolver } from './knowledgeEnrichmentModelResolver';
import { KnowledgeEnrichmentPublicationStore } from './knowledgeEnrichmentPublicationStore';
import { KnowledgeEnrichmentRequestStore } from './knowledgeEnrichmentRequestStore';
import {
  type KnowledgeEnrichmentPublishedChunkReader,
  KnowledgeEnrichmentService,
} from './knowledgeEnrichmentService';
import type { KnowledgeEnrichmentWorkspaceRouteSource } from './knowledgeEnrichmentTypes';
import { KnowledgeExtractionAuthorizationStore } from './knowledgeExtractionAuthorizationStore';
import { KnowledgeFactProjectionStore } from './knowledgeFactProjectionStore';
import { KnowledgeFactQueryService } from './knowledgeFactQueryService';
import { KnowledgeFactStore } from './knowledgeFactStore';
import { KnowledgeIngestionJobStore } from './knowledgeIngestionJobStore';
import {
  KnowledgeIngestionService,
  type LocalKnowledgeExtractionResult,
} from './knowledgeIngestionService';
import { KnowledgeManagedFileStore } from './knowledgeManagedFileStore';
import {
  KnowledgeMigrationService,
  type LegacyKnowledgeWorkspace,
} from './knowledgeMigrationService';
import { KnowledgeMigrationStore } from './knowledgeMigrationStore';
import { KnowledgeSelectionTokenStore } from './knowledgeSelectionTokenStore';
import { KnowledgeTrustedProfileIndexService } from './knowledgeTrustedProfileIndexService';
import type { KnowledgeTrustedProfileIndexStore } from './knowledgeTrustedProfileIndexStore';
import { KnowledgeWorkspaceCleanupCoordinator } from './knowledgeWorkspaceCleanupCoordinator';
import {
  buildLegacyKnowledgeSourceId,
  isNormalizedKnowledgeProjectionSourceId,
} from './legacyKnowledgeSourceIdentity';

export interface KnowledgeBaseFoundation {
  documentService: KnowledgeDocumentService;
  documentStore: KnowledgeDocumentStore;
  ingestionService: KnowledgeIngestionService;
  indexingService: KnowledgeDocumentIndexService;
  indexStore: KnowledgeDocumentIndexStore;
  jobStore: KnowledgeIngestionJobStore;
  managedFileStore: KnowledgeManagedFileStore;
  migrationStore: KnowledgeMigrationStore;
  migrationService: KnowledgeMigrationService;
  selectionTokenStore: KnowledgeSelectionTokenStore;
  enrichmentService: KnowledgeEnrichmentService;
  enrichmentRequestStore: KnowledgeEnrichmentRequestStore;
  factStore: KnowledgeFactStore;
  factQueryService: KnowledgeFactQueryService;
  factProjector: EnterpriseLeadKnowledgeFactProjector;
  authorizationStore: KnowledgeExtractionAuthorizationStore;
  trustedIndexStore: KnowledgeTrustedProfileIndexStore;
  trustedIndexingService: KnowledgeTrustedProfileIndexService;
  projectionStore: KnowledgeFactProjectionStore;
  cleanupCoordinator: KnowledgeWorkspaceCleanupCoordinator;
  recoverMigrateAndStart: (workspaces: LegacyKnowledgeWorkspace[], now?: string) => Promise<void>;
  prepareWorkspaceDeletion: (workspaceId: string) => boolean;
  reconcileTrustedProfileIndex: () => number;
  isReady: () => boolean;
  whenReady: () => Promise<void>;
  trackLegacyWork: (work: Promise<unknown>) => void;
  shutdown: () => Promise<void>;
}

export interface KnowledgeDocumentIndexExecutorFactoryInput {
  store: KnowledgeDocumentIndexStore;
  databasePath: string | null;
}

interface RecoverAndMigrateKnowledgeBaseOptions {
  cleanupOrphans?: () => void;
  afterCleanup?: () => void | Promise<void>;
  jobStore: Pick<KnowledgeIngestionJobStore, 'recoverAbandonedJobs'>;
  indexStore: Pick<KnowledgeDocumentIndexStore,
    'recoverAbandonedIndexing' | 'reconcileMissingStates'
  >;
  enrichmentRequestStore?: Pick<KnowledgeEnrichmentRequestStore, 'recoverAbandonedRunning'>;
  trustedIndexStore?: Pick<
    KnowledgeTrustedProfileIndexStore,
    'recoverAbandonedRunning' | 'reconcileAll'
  >;
  migrationService: Pick<KnowledgeMigrationService, 'migrateWorkspace'>;
  workspaces: LegacyKnowledgeWorkspace[];
  staleBefore: string;
  now: string;
  onMigrationError?: (workspaceId: string, error: unknown) => void;
  onRecoveryComplete?: () => void;
  afterReconciliation?: () => void | Promise<void>;
  shouldStop?: () => boolean;
  wakeIngestion?: () => void;
  wakeIndexing?: () => void;
  wakeEnrichment?: () => void;
  wakeTrusted?: () => void;
  onReady?: () => void;
}

export const recoverAndMigrateKnowledgeBase = async (
  options: RecoverAndMigrateKnowledgeBaseOptions,
): Promise<void> => {
  options.cleanupOrphans?.();
  await options.afterCleanup?.();
  if (options.shouldStop?.()) return;

  options.jobStore.recoverAbandonedJobs(options.staleBefore, options.now);
  if (options.shouldStop?.()) return;
  options.indexStore.recoverAbandonedIndexing(options.staleBefore, options.now);
  if (options.shouldStop?.()) return;
  options.enrichmentRequestStore?.recoverAbandonedRunning(options.now);
  if (options.shouldStop?.()) return;
  options.trustedIndexStore?.recoverAbandonedRunning(options.now);
  options.onRecoveryComplete?.();
  if (options.shouldStop?.()) return;

  for (const workspace of options.workspaces) {
    try {
      await options.migrationService.migrateWorkspace(workspace);
    } catch (error) {
      options.onMigrationError?.(workspace.id, error);
    }
    if (options.shouldStop?.()) return;
  }

  options.indexStore.reconcileMissingStates(options.now);
  if (options.shouldStop?.()) return;
  options.trustedIndexStore?.reconcileAll(options.now);
  if (options.shouldStop?.()) return;
  await options.afterReconciliation?.();
  if (options.shouldStop?.()) return;

  if (options.onReady) {
    options.onReady();
    return;
  }
  options.wakeIngestion?.();
  options.wakeIndexing?.();
  options.wakeEnrichment?.();
  options.wakeTrusted?.();
};

type FoundationPublishedChunkReader = KnowledgeEnrichmentPublishedChunkReader | (
  (documentVersionId: string) => readonly KnowledgeDocumentChunk[]
);

export interface KnowledgeBaseFoundationOptions {
  db: Database.Database;
  userDataPath: string;
  databasePath?: string;
  indexWorkerScriptPath?: string;
  indexExecutorFactory?: (
    input: KnowledgeDocumentIndexExecutorFactoryInput,
  ) => KnowledgeDocumentIndexExecutor;
  workspaceStore?: EnterpriseLeadWorkspaceStore;
  extractDocumentText?: (
    managedPath: string,
    options: {
      extensionHint: string;
      onProgress?: (progress: number) => void;
    },
  ) => Promise<LocalKnowledgeExtractionResult>;
  strictModelResolver?: Pick<KnowledgeEnrichmentModelResolver, 'resolveRouteSource'>;
  modelClient?: Pick<ModelClientAdapter, 'generate'>;
  modelGenerate?: ModelClientAdapter['generate'];
  publishedChunkReader?: FoundationPublishedChunkReader;
  contentKnowledgeVectorStore?: ContentKnowledgeVectorStore;
  replaceWorkspaceDocumentSource?: (
    workspaceId: string,
    documentId: string,
  ) => unknown | Promise<unknown>;
  replaceWorkspaceDocumentSources?: (workspaceId: string) => unknown | Promise<unknown>;
  replaceTrustedSources?: (
    scopeId: string,
    sources: ContentKnowledgeSource[],
  ) => unknown | Promise<unknown>;
}

export const createKnowledgeBaseFoundation = (
  options: KnowledgeBaseFoundationOptions,
): KnowledgeBaseFoundation => {
  const databasePath = options.databasePath?.trim() ? options.databasePath : null;
  const indexWorkerScriptPath = options.indexWorkerScriptPath?.trim()
    ? options.indexWorkerScriptPath
    : null;
  if (!options.indexExecutorFactory && (!databasePath || !indexWorkerScriptPath)) {
    throw new Error('Knowledge document index worker paths are required');
  }

  const workspaceStore = options.workspaceStore ?? new EnterpriseLeadWorkspaceStore(options.db);
  const trustedIndexStore = workspaceStore.getTrustedProfileIndexStore();
  const documentStore = new KnowledgeDocumentStore(options.db);
  const indexStore = new KnowledgeDocumentIndexStore(options.db);
  const indexExecutor = options.indexExecutorFactory
    ? options.indexExecutorFactory({ store: indexStore, databasePath })
    : new WorkerKnowledgeDocumentIndexExecutor({
        databasePath: databasePath!,
        workerScriptPath: indexWorkerScriptPath!,
      });
  const indexingService = new KnowledgeDocumentIndexService(indexExecutor, indexStore);
  const jobStore = new KnowledgeIngestionJobStore(options.db);
  const migrationStore = new KnowledgeMigrationStore(options.db);
  const enrichmentRequestStore = new KnowledgeEnrichmentRequestStore(options.db);
  const factStore = new KnowledgeFactStore(options.db, { requestStore: enrichmentRequestStore });
  const projectionStore = new KnowledgeFactProjectionStore(options.db, {
    deferInitialization: true,
  });
  const authorizationStore = new KnowledgeExtractionAuthorizationStore();
  const contentKnowledgeVectorStore = options.contentKnowledgeVectorStore
    ?? new ContentKnowledgeVectorStore(options.db);
  const selectionTokenStore = new KnowledgeSelectionTokenStore();
  const managedFileStore = new KnowledgeManagedFileStore(
    path.join(options.userDataPath, 'knowledge-base'),
  );
  const compatibilityAdapter = new EnterpriseLeadKnowledgeCompatibilityAdapter(workspaceStore);
  const migrationService = new KnowledgeMigrationService({
    db: options.db,
    documentStore,
    managedFileStore,
    jobStore,
    migrationStore,
  });

  const loadWorkspaceRouteSourceInCurrentTransaction = (
    db: Database.Database,
    workspaceId: string,
  ): KnowledgeEnrichmentWorkspaceRouteSource | null => {
    if (db !== options.db || !db.inTransaction) return null;
    return workspaceStore.getWorkspace(workspaceId);
  };
  const strictModelResolver = options.strictModelResolver
    ?? new KnowledgeEnrichmentModelResolver({
      getWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
    });
  const modelClient: Pick<ModelClientAdapter, 'generate'> = options.modelClient ?? {
    generate: options.modelGenerate ?? (async () => {
      throw new ModelResponseReadError();
    }),
  };
  const publishedChunkReader: KnowledgeEnrichmentPublishedChunkReader =
    typeof options.publishedChunkReader === 'function'
      ? { listPublishedChunks: options.publishedChunkReader }
      : options.publishedChunkReader ?? {
        listPublishedChunks: documentVersionId => indexStore.listVersionChunks(documentVersionId),
      };
  const publicationStore = new KnowledgeEnrichmentPublicationStore(
    options.db,
    factStore,
    enrichmentRequestStore,
    {
      loadWorkspaceRouteSourceInCurrentTransaction,
      resolveExactRouteFromSource: source => {
        const resolved = strictModelResolver.resolveRouteSource(source.id, source);
        return {
          workspaceId: resolved.workspaceId,
          providerId: resolved.providerId,
          modelId: resolved.modelId,
          routingFingerprint: resolved.routingFingerprint,
        };
      },
    },
  );
  const enrichmentService = new KnowledgeEnrichmentService({
    db: options.db,
    authorizationStore,
    requestStore: enrichmentRequestStore,
    publicationStore,
    modelResolver: strictModelResolver,
    modelClient,
    publishedChunkReader,
    loadWorkspaceRouteSourceInCurrentTransaction,
  });
  const replaceTrustedSources = options.replaceTrustedSources
    ?? ((scopeId: string, sources: ContentKnowledgeSource[]) =>
      contentKnowledgeVectorStore.replaceTrustedSources(scopeId, sources));
  const trustedIndexingService = new KnowledgeTrustedProfileIndexService({
    indexStore: trustedIndexStore,
    loadWorkspace: workspaceId => workspaceStore.getWorkspace(workspaceId),
    replaceTrustedSources,
    autoStart: false,
  });
  const notifyTrustedRefresh = (): void => trustedIndexingService.wake();
  const factProjector = new EnterpriseLeadKnowledgeFactProjector(
    options.db,
    factStore,
    projectionStore,
    workspaceStore.getProfileRevisionStore(),
    { onTrustedRefreshCommitted: notifyTrustedRefresh },
  );
  const factQueryService = new KnowledgeFactQueryService(factStore);
  const replaceWorkspaceDocumentSource = options.replaceWorkspaceDocumentSource
    ?? ((workspaceId: string, documentId: string) =>
      contentKnowledgeVectorStore.replaceWorkspaceDocumentSource(workspaceId, documentId));

  let ingestionService!: KnowledgeIngestionService;
  const documentService = new KnowledgeDocumentService({
    db: options.db,
    documentStore,
    jobStore,
    indexStore,
    managedFileStore,
    selectionTokenStore,
    compatibilityAdapter,
    enrichmentRequestStore,
    factStore,
    enrichmentLifecycle: enrichmentService,
    workspaceVectorLifecycle: {
      deleteWorkspaceDocumentSources: (workspaceId, sourceIds) =>
        contentKnowledgeVectorStore.deleteWorkspaceDocumentSources(
          buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId),
          sourceIds,
        ),
      replaceWorkspaceDocumentSource,
    },
    workspaceExists: workspaceId => Boolean(workspaceStore.getWorkspace(workspaceId)),
    onJobsQueued: () => ingestionService.wake(),
    onIndexQueued: () => indexingService.wake(),
  });
  ingestionService = new KnowledgeIngestionService({
    db: options.db,
    documentStore,
    jobStore,
    indexStore,
    managedFileStore,
    extractDocumentText:
      options.extractDocumentText
      ?? ((managedPath, extractionOptions) =>
        extractDocumentTextFromFile(managedPath, {
          extensionHint: extractionOptions.extensionHint,
          image: { onProgress: extractionOptions.onProgress },
        })),
    updateCompatibilityProjectionInCurrentTransaction: (workspaceId, documentId) => {
      const document = documentStore.getDocument(documentId);
      if (!document || document.workspaceId !== workspaceId) return;
      compatibilityAdapter.upsertDocumentInCurrentTransaction(
        workspaceId,
        documentService.getDocumentDetails({ documentId }).document,
        {
          legacySourceId: document.legacySourceId,
          legacySourceSnapshotJson: documentStore.getLegacySourceSnapshotJson(document.id),
        },
      );
    },
    replaceWorkspaceDocumentSource,
    onIndexQueued: () => indexingService.wake(),
  });

  const cleanupCoordinator = new KnowledgeWorkspaceCleanupCoordinator({
    db: options.db,
    workspaceStore,
    trustedIndexStore,
    projectionStore,
    factStore,
    enrichmentRequestStore,
    documentIndexStore: indexStore,
    ingestionJobStore: jobStore,
    documentStore,
    migrationStore,
    profileRevisionStore: workspaceStore.getProfileRevisionStore(),
    contentKnowledgeVectorStore,
    authorizationStore,
    enrichmentService,
    trustedIndexingService,
  });

  let startupPromise: Promise<void> | null = null;
  let shutdownPromise: Promise<void> | null = null;
  let ready = false;
  let closing = false;
  const notStartedPromise = new Promise<void>(() => undefined);
  const legacyWork = new Set<Promise<void>>();

  const normalizeLegacyWorkspace = (workspace: LegacyKnowledgeWorkspace): LegacyKnowledgeWorkspace => {
    let changed = false;
    const extractionSources = workspace.extractionSources.map((source, sourceIndex) => {
      if (isNormalizedKnowledgeProjectionSourceId(source.id)) return source;
      const sourceId = buildLegacyKnowledgeSourceId(workspace.id, source, sourceIndex);
      if (source.id?.trim() === sourceId) return source;
      changed = true;
      return { ...source, id: sourceId };
    });
    if (!changed) return workspace;
    const persistedWorkspace = workspaceStore.getWorkspace(workspace.id)
      ? workspaceStore.updateWorkspaceSources(workspace.id, extractionSources)
      : null;
    return {
      id: workspace.id,
      extractionSources: persistedWorkspace?.extractionSources ?? extractionSources,
    };
  };

  const reconcileReadyRawSources = async (): Promise<void> => {
    for (const workspace of workspaceStore.listWorkspaces()) {
      for (const document of documentStore.listDocuments(workspace.id)) {
        if (document.status !== KnowledgeDocumentStatus.Ready || document.deletedAt !== null) {
          continue;
        }
        const version = documentStore.getVersion(document.currentVersionId);
        if (!version?.extractedText?.trim()) continue;
        try {
          await replaceWorkspaceDocumentSource(workspace.id, document.id);
        } catch {
          console.warn('[KnowledgeBase]', {
            code: 'raw_source_reconciliation_failed',
            workspaceId: workspace.id,
            documentId: document.id,
          });
        }
        if (closing) return;
      }
    }
  };

  const trackLegacyWork = (work: Promise<unknown>): void => {
    let tracked!: Promise<void>;
    tracked = Promise.resolve(work)
      .then((): void => undefined)
      .catch(() => {
        console.warn('[KnowledgeBase]', { code: 'legacy_work_failed' });
      })
      .finally(() => legacyWork.delete(tracked));
    legacyWork.add(tracked);
  };

  const waitForLegacyWork = async (): Promise<void> => {
    while (legacyWork.size > 0) {
      await Promise.all([...legacyWork]);
    }
  };

  const sealWorker = (
    code: string,
    operation: () => Promise<void>,
  ): Promise<void> => {
    try {
      return Promise.resolve(operation()).catch(() => {
        console.error('[KnowledgeBase]', { code });
      });
    } catch {
      console.error('[KnowledgeBase]', { code });
      return Promise.resolve();
    }
  };

  const foundation: KnowledgeBaseFoundation = {
    documentService,
    documentStore,
    ingestionService,
    indexingService,
    indexStore,
    jobStore,
    managedFileStore,
    migrationStore,
    migrationService,
    selectionTokenStore,
    enrichmentService,
    enrichmentRequestStore,
    factStore,
    factQueryService,
    factProjector,
    authorizationStore,
    trustedIndexStore,
    trustedIndexingService,
    projectionStore,
    cleanupCoordinator,
    prepareWorkspaceDeletion: workspaceId =>
      cleanupCoordinator.prepareWorkspaceDeletion(workspaceId),
    reconcileTrustedProfileIndex: (): number => {
      const reconciledCount = trustedIndexStore.reconcileAll();
      if (reconciledCount > 0) trustedIndexingService.wake();
      return reconciledCount;
    },
    isReady: () => ready,
    whenReady: () => startupPromise ?? notStartedPromise,
    trackLegacyWork,
    recoverMigrateAndStart: (
      workspaces: LegacyKnowledgeWorkspace[],
      now = new Date().toISOString(),
    ): Promise<void> => {
      if (closing) {
        startupPromise ??= Promise.resolve();
        return startupPromise;
      }
      if (startupPromise) {
        workspaces.forEach(normalizeLegacyWorkspace);
        return startupPromise;
      }
      const nowMs = Date.parse(now);
      const currentTimeMs = Number.isFinite(nowMs) ? nowMs : Date.now();
      const staleBefore = new Date(currentTimeMs + 1).toISOString();
      startupPromise = recoverAndMigrateKnowledgeBase({
        cleanupOrphans: () => cleanupCoordinator.cleanupOrphansAtStartup(now),
        afterCleanup: async () => {
          projectionStore.initializeAfterCleanup();
          await managedFileStore.cleanupAbandonedTemporaryFiles(currentTimeMs).catch(() => {
            console.warn('[KnowledgeBase]', { code: 'temporary_file_cleanup_failed' });
          });
        },
        jobStore,
        indexStore,
        enrichmentRequestStore,
        trustedIndexStore,
        migrationService: {
          migrateWorkspace: workspace =>
            migrationService.migrateWorkspace(normalizeLegacyWorkspace(workspace)),
        },
        workspaces,
        staleBefore,
        now,
        onMigrationError: workspaceId => {
          console.warn('[KnowledgeBase]', { code: 'legacy_migration_failed', workspaceId });
        },
        shouldStop: () => closing,
        afterReconciliation: reconcileReadyRawSources,
        wakeIngestion: () => ingestionService.wake(),
        wakeIndexing: () => indexingService.wake(),
        wakeEnrichment: () => enrichmentService.wake(),
        wakeTrusted: () => trustedIndexingService.startAfterRecovery(),
      }).then(() => {
        if (!closing) ready = true;
      });
      return startupPromise;
    },
    shutdown: (): Promise<void> => {
      if (shutdownPromise) return shutdownPromise;
      closing = true;
      ready = false;
      const enrichmentShutdown = sealWorker(
        'enrichment_shutdown_failed',
        () => enrichmentService.shutdown(),
      );
      const ingestionShutdown = sealWorker(
        'ingestion_shutdown_failed',
        () => ingestionService.shutdown(),
      );
      const trustedShutdown = sealWorker(
        'trusted_index_shutdown_failed',
        () => trustedIndexingService.shutdown(),
      );
      const indexShutdown = sealWorker(
        'local_index_shutdown_failed',
        () => indexingService.shutdown(),
      );
      const documentShutdown = sealWorker(
        'document_raw_refresh_shutdown_failed',
        () => documentService.shutdown(),
      );
      shutdownPromise = (async () => {
        await enrichmentShutdown;
        await ingestionShutdown;
        await trustedShutdown;
        await indexShutdown;
        await documentShutdown;
        await startupPromise?.catch((): void => undefined);
        await waitForLegacyWork();
      })();
      return shutdownPromise;
    },
  };

  return foundation;
};
