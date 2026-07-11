import path from 'node:path';

import Database from 'better-sqlite3';

import { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import { extractDocumentTextFromFile } from '../libs/documentTextExtractor';
import { EnterpriseLeadKnowledgeCompatibilityAdapter } from './enterpriseLeadKnowledgeCompatibilityAdapter';
import {
  type KnowledgeDocumentIndexExecutor,
  WorkerKnowledgeDocumentIndexExecutor,
} from './knowledgeDocumentIndexExecutor';
import { KnowledgeDocumentIndexService } from './knowledgeDocumentIndexService';
import { KnowledgeDocumentIndexStore } from './knowledgeDocumentIndexStore';
import { KnowledgeDocumentService } from './knowledgeDocumentService';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';
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
  recoverMigrateAndStart: (workspaces: LegacyKnowledgeWorkspace[], now?: string) => Promise<void>;
  deleteWorkspaceData: (workspaceId: string) => void;
  shutdown: () => Promise<void>;
}

export interface KnowledgeDocumentIndexExecutorFactoryInput {
  store: KnowledgeDocumentIndexStore;
  databasePath: string | null;
}

export const recoverAndMigrateKnowledgeBase = async (options: {
  jobStore: Pick<KnowledgeIngestionJobStore, 'recoverAbandonedJobs'>;
  indexStore: Pick<KnowledgeDocumentIndexStore,
    'recoverAbandonedIndexing' | 'reconcileMissingStates'
  >;
  migrationService: Pick<KnowledgeMigrationService, 'migrateWorkspace'>;
  workspaces: LegacyKnowledgeWorkspace[];
  staleBefore: string;
  now: string;
  onMigrationError?: (workspaceId: string, error: unknown) => void;
  onReady?: () => void;
}): Promise<void> => {
  options.jobStore.recoverAbandonedJobs(options.staleBefore, options.now);
  options.indexStore.recoverAbandonedIndexing(options.staleBefore, options.now);
  for (const workspace of options.workspaces) {
    try {
      await options.migrationService.migrateWorkspace(workspace);
    } catch (error) {
      options.onMigrationError?.(workspace.id, error);
    }
  }
  options.indexStore.reconcileMissingStates(options.now);
  options.onReady?.();
};

export const createKnowledgeBaseFoundation = (options: {
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
}): KnowledgeBaseFoundation => {
  const databasePath = options.databasePath?.trim() ? options.databasePath : null;
  const indexWorkerScriptPath = options.indexWorkerScriptPath?.trim()
    ? options.indexWorkerScriptPath
    : null;
  if (!options.indexExecutorFactory && (!databasePath || !indexWorkerScriptPath)) {
    throw new Error('Knowledge document index worker paths are required');
  }

  const workspaceStore = options.workspaceStore ?? new EnterpriseLeadWorkspaceStore(options.db);
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
  let ingestionService: KnowledgeIngestionService;
  const documentService = new KnowledgeDocumentService({
    db: options.db,
    documentStore,
    jobStore,
    indexStore,
    managedFileStore,
    selectionTokenStore,
    compatibilityAdapter,
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
      options.extractDocumentText ??
      ((managedPath, extractionOptions) =>
        extractDocumentTextFromFile(managedPath, {
          extensionHint: extractionOptions.extensionHint,
          image: { onProgress: extractionOptions.onProgress },
        })),
    onIndexQueued: () => indexingService.wake(),
    onDocumentUpdated: (workspaceId, documentId) => {
      if (!workspaceStore.getWorkspace(workspaceId)) {
        return;
      }
      const document = documentStore.getDocument(documentId);
      if (!document) {
        return;
      }
      compatibilityAdapter.upsertDocument(
        workspaceId,
        documentService.getDocumentDetails({ documentId }).document,
        {
          legacySourceId: document.legacySourceId,
          legacySourceSnapshotJson: documentStore.getLegacySourceSnapshotJson(document.id),
        },
      );
    },
  });

  return {
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
    deleteWorkspaceData: (workspaceId: string): void => {
      const transaction = options.db.transaction(() => {
        indexStore.deleteWorkspaceIndex(workspaceId);
        jobStore.deleteWorkspaceJobs(workspaceId);
        documentStore.deleteWorkspaceDocuments(workspaceId);
        migrationStore.deleteState(workspaceId);
      });
      transaction();
    },
    recoverMigrateAndStart: async (
      workspaces: LegacyKnowledgeWorkspace[],
      now = new Date().toISOString(),
    ): Promise<void> => {
      const nowMs = Date.parse(now);
      const workspacesWithStableSourceIds = workspaces.map(workspace => {
        let changed = false;
        const extractionSources = workspace.extractionSources.map((source, sourceIndex) => {
          if (isNormalizedKnowledgeProjectionSourceId(source.id)) {
            return source;
          }
          const sourceId = buildLegacyKnowledgeSourceId(workspace.id, source, sourceIndex);
          if (source.id?.trim() === sourceId) {
            return source;
          }
          changed = true;
          return { ...source, id: sourceId };
        });
        if (!changed) {
          return workspace;
        }
        const persistedWorkspace = workspaceStore.getWorkspace(workspace.id)
          ? workspaceStore.updateWorkspaceSources(workspace.id, extractionSources)
          : null;
        return {
          id: workspace.id,
          extractionSources: persistedWorkspace?.extractionSources ?? extractionSources,
        };
      });
      await managedFileStore
        .cleanupAbandonedTemporaryFiles(Number.isFinite(nowMs) ? nowMs : Date.now())
        .catch(error => {
          console.warn('[KnowledgeBase] Failed to clean abandoned temporary files:', error);
        });
      // Startup runs before this process wakes workers, so every running job belongs to a
      // previous process and must be requeued even when its last heartbeat was recent.
      const staleBefore = new Date((Number.isFinite(nowMs) ? nowMs : Date.now()) + 1).toISOString();
      await recoverAndMigrateKnowledgeBase({
        jobStore,
        indexStore,
        migrationService,
        workspaces: workspacesWithStableSourceIds,
        staleBefore,
        now,
        onMigrationError: (workspaceId, error) => {
          console.warn(`[KnowledgeBase] Failed to migrate workspace ${workspaceId}:`, error);
        },
        onReady: () => {
          ingestionService.wake();
          indexingService.wake();
        },
      });
    },
    shutdown: async (): Promise<void> => {
      await indexingService.shutdown();
    },
  };
};
