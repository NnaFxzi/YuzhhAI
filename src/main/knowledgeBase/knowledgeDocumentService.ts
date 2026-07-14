import Database from 'better-sqlite3';

import {
  KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES,
  type KnowledgeBaseErrorCode,
  KnowledgeBaseErrorCode as KnowledgeBaseErrorCodes,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
} from '../../shared/knowledgeBase/constants';
import type {
  CreateKnowledgeDocumentInput,
  KnowledgeDocument,
  KnowledgeDocumentDetails,
  KnowledgeDocumentDetailsRequest,
  KnowledgeDocumentIndexSummary,
  KnowledgeDocumentListItem,
  KnowledgeDocumentRevisionRequest,
  KnowledgeDocumentSummary,
  KnowledgeDocumentVersion,
  KnowledgeImportBatchResult,
  KnowledgeImportItemResult,
  KnowledgeIngestionJob,
  KnowledgeIngestionJobSummary,
  KnowledgeListDocumentsRequest,
  KnowledgeRetryDocumentRequest,
  KnowledgeRetryLocalIndexRequest,
} from '../../shared/knowledgeBase/types';
import {
  runTransientSqliteWriteTransaction,
  runTransientSqliteWriteTransactionUntilSuccess,
  type TransientSqliteBusyRetryDelay,
} from '../libs/sqliteTransactionRetry';
import {
  buildKnowledgeDocumentLegacySourceId,
  type EnterpriseLeadKnowledgeCompatibilityAdapter,
} from './enterpriseLeadKnowledgeCompatibilityAdapter';
import {
  KnowledgeDocumentIndexStateError,
  type KnowledgeDocumentIndexStore,
} from './knowledgeDocumentIndexStore';
import type { KnowledgeDocumentIndexState } from './knowledgeDocumentIndexTypes';
import {
  KnowledgeDocumentRevisionConflictError,
  KnowledgeDocumentStore,
} from './knowledgeDocumentStore';
import type { KnowledgeEnrichmentRequestStore } from './knowledgeEnrichmentRequestStore';
import type { KnowledgeFactStore } from './knowledgeFactStore';
import {
  inspectKnowledgeFile,
  type KnowledgeFileInspection,
  KnowledgeFileInspectionError,
} from './knowledgeFileInspection';
import {
  KnowledgeIngestionJobStateError,
  KnowledgeIngestionJobStore,
} from './knowledgeIngestionJobStore';
import { KnowledgeManagedFileError, KnowledgeManagedFileStore } from './knowledgeManagedFileStore';
import {
  KnowledgeSelectionTokenError,
  KnowledgeSelectionTokenStore,
  type SelectedKnowledgeFileEntry,
} from './knowledgeSelectionTokenStore';

type KnowledgeCompatibilityAdapter = Pick<
  EnterpriseLeadKnowledgeCompatibilityAdapter,
  | 'removeDocument'
  | 'removeDocumentInCurrentTransaction'
  | 'upsertDocument'
  | 'upsertDocumentInCurrentTransaction'
>;

export const KnowledgeDocumentLifecycleStage = {
  AfterRevalidationBeforeFirstWrite: 'after_revalidation_before_first_write',
  AfterRequestsStale: 'after_requests_stale',
  AfterEvidenceStale: 'after_evidence_stale',
  AfterIngestionCancelled: 'after_ingestion_cancelled',
  AfterRawSourceDeleted: 'after_raw_source_deleted',
  AfterLocalIndexDeleted: 'after_local_index_deleted',
  AfterDocumentMutated: 'after_document_mutated',
  AfterLocalIndexScheduled: 'after_local_index_scheduled',
  AfterCompatibilityProjection: 'after_compatibility_projection',
} as const;
export type KnowledgeDocumentLifecycleStage =
  (typeof KnowledgeDocumentLifecycleStage)[keyof typeof KnowledgeDocumentLifecycleStage];

export interface KnowledgeDocumentServiceOptions {
  db: Database.Database;
  documentStore: KnowledgeDocumentStore;
  indexStore: Pick<KnowledgeDocumentIndexStore,
    | 'deactivateVersion'
    | 'deactivateVersionInCurrentTransaction'
    | 'getState'
    | 'listStates'
    | 'retryFailedVersion'
    | 'scheduleCurrentVersion'
    | 'scheduleCurrentVersionInCurrentTransaction'
  >;
  jobStore: KnowledgeIngestionJobStore;
  managedFileStore: KnowledgeManagedFileStore;
  selectionTokenStore: KnowledgeSelectionTokenStore;
  compatibilityAdapter: KnowledgeCompatibilityAdapter;
  workspaceExists: (workspaceId: string) => boolean;
  enrichmentRequestStore?: Pick<
    KnowledgeEnrichmentRequestStore,
    | 'listDocumentIdsWithStalePriorVersionExtraction'
    | 'listLatestSummariesForVersions'
    | 'markVersionStaleInCurrentTransaction'
  >;
  factStore?: Pick<KnowledgeFactStore, 'markVersionEvidenceStaleInCurrentTransaction'>;
  enrichmentLifecycle?: {
    abortActiveAttemptForVersion(documentVersionId: string): void;
  };
  workspaceVectorLifecycle?: {
    deleteWorkspaceDocumentSources(workspaceId: string, sourceIds: readonly string[]): number;
    replaceWorkspaceDocumentSource(workspaceId: string, documentId: string): unknown;
  };
  inspectFile?: (absolutePath: string) => Promise<KnowledgeFileInspection>;
  onJobsQueued?: () => void;
  onIndexQueued?: () => void;
  busyRetryDelay?: TransientSqliteBusyRetryDelay;
  onLifecycleStage?: (stage: KnowledgeDocumentLifecycleStage) => void;
}

export class KnowledgeDocumentServiceError extends Error {
  readonly fileName?: string;

  readonly latestDocument?: KnowledgeDocumentListItem;

  constructor(
    readonly code: KnowledgeBaseErrorCode,
    options: {
      fileName?: string;
      latestDocument?: KnowledgeDocumentListItem;
    } = {},
  ) {
    super(code);
    this.name = 'KnowledgeDocumentServiceError';
    this.fileName = options.fileName;
    this.latestDocument = options.latestDocument;
  }
}

export class KnowledgeDocumentService {
  private readonly inspectFile: (absolutePath: string) => Promise<KnowledgeFileInspection>;

  private readonly pendingRawSourceRefreshes = new Set<Promise<void>>();

  private rawSourceRefreshSealed = false;

  private rawSourceRefreshShutdownPromise: Promise<void> | null = null;

  constructor(private readonly options: KnowledgeDocumentServiceOptions) {
    this.inspectFile = options.inspectFile ?? inspectKnowledgeFile;
  }

  shutdown(): Promise<void> {
    this.rawSourceRefreshSealed = true;
    if (this.rawSourceRefreshShutdownPromise) return this.rawSourceRefreshShutdownPromise;
    this.rawSourceRefreshShutdownPromise = this.drainRawSourceRefreshes();
    return this.rawSourceRefreshShutdownPromise;
  }

  async importSelection(input: {
    ownerId: number;
    workspaceId: string;
    selectionToken: string;
    itemIds?: string[];
  }): Promise<KnowledgeImportBatchResult> {
    const workspaceId = input.workspaceId.trim();
    this.requireWorkspace(workspaceId);
    let selectedFiles: SelectedKnowledgeFileEntry[];
    try {
      selectedFiles = this.options.selectionTokenStore.consume(
        input.selectionToken,
        input.ownerId,
        input.itemIds,
      );
    } catch (error) {
      throw this.toServiceError(error);
    }

    const items: KnowledgeImportItemResult[] = [];
    let queuedJobs = 0;
    for (const selectedFile of selectedFiles) {
      try {
        const result = await this.importSelectedFile(workspaceId, selectedFile);
        items.push({
          success: true,
          itemId: selectedFile.itemId,
          document: result.document,
        });
        if (result.queuedJob) {
          queuedJobs += 1;
        }
      } catch (error) {
        const serviceError = this.toServiceError(error, selectedFile.displayName);
        items.push({
          success: false,
          itemId: selectedFile.itemId,
          fileName: selectedFile.displayName,
          errorCode: serviceError.code,
        });
      }
    }

    if (queuedJobs > 0) {
      this.options.onJobsQueued?.();
    }
    const importedCount = items.filter(item => item.success).length;
    return {
      importedCount,
      failedCount: items.length - importedCount,
      items,
    };
  }

  listDocuments(input: KnowledgeListDocumentsRequest): KnowledgeDocumentListItem[] {
    const workspaceId = input.workspaceId.trim();
    this.requireWorkspace(workspaceId);
    const jobs = this.options.jobStore.listCurrentJobs(workspaceId);
    const jobsByTarget = new Map(
      jobs.map(job => [this.buildTargetKey(job.documentId, job.documentVersionId), job]),
    );
    const statesByVersion = new Map(
      this.options.indexStore
        .listStates(workspaceId)
        .map(state => [state.documentVersionId, state]),
    );
    const documents = this.options.documentStore.listDocuments(workspaceId, {
      visibility: input.visibility,
    });
    const enrichmentByVersion = this.options.enrichmentRequestStore
      ?.listLatestSummariesForVersions(
        workspaceId,
        documents.map(document => document.currentVersionId),
      ) ?? new Map();
    const staleHistoryDocumentIds = this.options.enrichmentRequestStore
      ?.listDocumentIdsWithStalePriorVersionExtraction(workspaceId) ?? new Set<string>();
    return documents.map(document =>
      this.toListItem(
        document,
        jobsByTarget.get(this.buildTargetKey(document.id, document.currentVersionId)) ?? null,
        statesByVersion.get(document.currentVersionId) ?? null,
        enrichmentByVersion.get(document.currentVersionId) ?? null,
        staleHistoryDocumentIds.has(document.id),
      ),
    );
  }

  getDocumentDetails(input: KnowledgeDocumentDetailsRequest): KnowledgeDocumentDetails {
    const document = this.requireDocument(input.documentId);
    const version = this.requireVersion(document.currentVersionId);
    const enrichment = this.options.enrichmentRequestStore
      ?.listLatestSummariesForVersions(document.workspaceId, [version.id]).get(version.id) ?? null;
    const hasStaleHistory = this.options.enrichmentRequestStore
      ?.listDocumentIdsWithStalePriorVersionExtraction(document.workspaceId).has(document.id)
      ?? false;
    return {
      document: this.toListItem(
        this.toSummary(document, version),
        this.options.jobStore.getCurrentJob(document.id, version.id),
        this.options.indexStore.getState(version.id),
        enrichment,
        hasStaleHistory,
      ),
      activeVersion: {
        id: version.id,
        parser: version.parser,
        extractedText: version.extractedText,
        extractionPartial: version.extractionPartial,
        createdAt: version.createdAt,
      },
    };
  }

  deleteDocument(input: KnowledgeDocumentRevisionRequest): KnowledgeDocumentListItem {
    try {
      const transaction = this.options.db.transaction(() => {
        const existing = this.requireDocument(input.documentId);
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterRevalidationBeforeFirstWrite);
        const now = new Date().toISOString();
        this.options.enrichmentRequestStore?.markVersionStaleInCurrentTransaction(
          existing.currentVersionId,
          now,
        );
        this.options.factStore?.markVersionEvidenceStaleInCurrentTransaction(
          existing.currentVersionId,
          now,
        );
        this.options.jobStore.cancelJobsForVersionInCurrentTransaction(
          existing.id,
          existing.currentVersionId,
          now,
        );
        this.deleteRawSourceInCurrentTransaction(existing);
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterRequestsStale);
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterEvidenceStale);
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterIngestionCancelled);
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterRawSourceDeleted);
        const hadIndexState = this.options.indexStore.getState(existing.currentVersionId) !== null;
        if (hadIndexState) {
          this.options.indexStore.deactivateVersionInCurrentTransaction({
            workspaceId: existing.workspaceId,
            documentId: existing.id,
            documentVersionId: existing.currentVersionId,
          }, now);
        }
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterLocalIndexDeleted);
        const deleted = this.options.documentStore.softDeleteDocumentInCurrentTransaction(
          existing.id,
          input.expectedRevision,
        );
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterDocumentMutated);
        const item = this.toListItemFromDocument(deleted);
        this.options.compatibilityAdapter.upsertDocumentInCurrentTransaction(
          deleted.workspaceId,
          item,
          this.getCompatibilityProjectionOptions(deleted),
        );
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterCompatibilityProjection);
        return { item, hadIndexState };
      });
      const result = runTransientSqliteWriteTransaction(() => transaction());
      this.abortEnrichmentAfterCommit(result.item.currentVersionId);
      if (result.hadIndexState) {
        this.notifyIndexQueued();
      }
      return result.item;
    } catch (error) {
      throw this.toServiceError(error);
    }
  }

  restoreDocument(input: KnowledgeDocumentRevisionRequest): KnowledgeDocumentListItem {
    try {
      const transaction = this.options.db.transaction(() => {
        const existing = this.requireDocument(input.documentId);
        if (!existing.deletedAt) {
          throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.JobStateConflict);
        }
        if (existing.deletedAt && existing.sourceMode === KnowledgeDocumentSourceMode.Managed) {
          const version = this.requireVersion(existing.currentVersionId);
          if (
            this.options.documentStore.getActiveManagedBytes(existing.workspaceId) +
              (version.fileSize ?? 0) >
            KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES
          ) {
            throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.WorkspaceQuotaExceeded);
          }
        }
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterRevalidationBeforeFirstWrite);
        const restored = this.options.documentStore.restoreDocumentInCurrentTransaction(
          existing.id,
          input.expectedRevision,
        );
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterDocumentMutated);
        const indexState = this.options.indexStore.scheduleCurrentVersionInCurrentTransaction({
          workspaceId: restored.workspaceId,
          documentId: restored.id,
          documentVersionId: restored.currentVersionId,
        });
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterLocalIndexScheduled);
        const item = this.toListItemFromDocument(restored);
        this.options.compatibilityAdapter.upsertDocumentInCurrentTransaction(
          restored.workspaceId,
          item,
          this.getCompatibilityProjectionOptions(restored),
        );
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterCompatibilityProjection);
        return { item, indexState };
      });
      const result = runTransientSqliteWriteTransaction(() => transaction());
      this.refreshRawSourceAfterCommit(result.item);
      if (result.indexState.status === KnowledgeDocumentIndexStatus.Pending) {
        this.notifyIndexQueued();
      }
      return result.item;
    } catch (error) {
      throw this.toServiceError(error);
    }
  }

  replaceParsedDocumentVersion(input: {
    documentId: string;
    expectedRevision: number;
    version: CreateKnowledgeDocumentInput['version'];
  }): KnowledgeDocumentListItem {
    try {
      if (!input.version.parser?.trim()) {
        throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.InvalidRequest);
      }
      const transaction = this.options.db.transaction(() => {
        const existing = this.requireDocument(input.documentId);
        if (existing.deletedAt) {
          throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.JobStateConflict);
        }
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterRevalidationBeforeFirstWrite);
        const now = new Date().toISOString();
        this.options.enrichmentRequestStore?.markVersionStaleInCurrentTransaction(
          existing.currentVersionId,
          now,
        );
        this.options.factStore?.markVersionEvidenceStaleInCurrentTransaction(
          existing.currentVersionId,
          now,
        );
        this.options.jobStore.cancelJobsForVersionInCurrentTransaction(
          existing.id,
          existing.currentVersionId,
          now,
        );
        this.deleteRawSourceInCurrentTransaction(existing);
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterRequestsStale);
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterEvidenceStale);
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterIngestionCancelled);
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterRawSourceDeleted);
        const hadPreviousIndexState = this.options.indexStore.getState(
          existing.currentVersionId,
        ) !== null;
        if (hadPreviousIndexState) {
          this.options.indexStore.deactivateVersionInCurrentTransaction({
            workspaceId: existing.workspaceId,
            documentId: existing.id,
            documentVersionId: existing.currentVersionId,
          }, now);
        }
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterLocalIndexDeleted);
        const status = input.version.extractedText?.trim()
          ? KnowledgeDocumentStatus.Ready
          : KnowledgeDocumentStatus.CompletedWithoutText;
        const replaced = this.options.documentStore.addVersionInCurrentTransaction(
          existing.id,
          input.expectedRevision,
          input.version,
          status,
        );
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterDocumentMutated);
        const indexState = this.options.indexStore.scheduleCurrentVersionInCurrentTransaction({
          workspaceId: replaced.document.workspaceId,
          documentId: replaced.document.id,
          documentVersionId: replaced.version.id,
        });
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterLocalIndexScheduled);
        const item = this.toListItemFromDocument(replaced.document);
        this.options.compatibilityAdapter.upsertDocumentInCurrentTransaction(
          replaced.document.workspaceId,
          item,
          this.getCompatibilityProjectionOptions(replaced.document),
        );
        this.emitLifecycleStage(KnowledgeDocumentLifecycleStage.AfterCompatibilityProjection);
        return {
          item,
          indexState,
          hadPreviousIndexState,
          previousVersionId: existing.currentVersionId,
        };
      });
      const result = runTransientSqliteWriteTransaction(() => transaction());
      this.abortEnrichmentAfterCommit(result.previousVersionId);
      this.refreshRawSourceAfterCommit(result.item);
      if (
        result.hadPreviousIndexState ||
        result.indexState.status === KnowledgeDocumentIndexStatus.Pending
      ) {
        this.notifyIndexQueued();
      }
      return result.item;
    } catch (error) {
      throw this.toServiceError(error);
    }
  }

  retryDocument(input: KnowledgeRetryDocumentRequest): KnowledgeDocumentListItem {
    try {
      const transaction = this.options.db.transaction(() => {
        const document = this.requireDocument(input.documentId);
        if (document.deletedAt || document.currentVersionId !== input.documentVersionId) {
          throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.JobStateConflict);
        }
        const job = this.options.jobStore.getCurrentJob(document.id, document.currentVersionId);
        if (!job) {
          throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.JobStateConflict);
        }
        this.options.jobStore.retry(job.id);
        if (
          !this.options.documentStore.setDocumentStatusIfCurrentVersion({
            documentId: document.id,
            documentVersionId: document.currentVersionId,
            status: KnowledgeDocumentStatus.Pending,
          })
        ) {
          throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.JobStateConflict);
        }
        const updated = this.requireDocument(document.id);
        const item = this.toListItemFromDocument(updated);
        this.options.compatibilityAdapter.upsertDocumentInCurrentTransaction(
          updated.workspaceId,
          item,
          this.getCompatibilityProjectionOptions(updated),
        );
        return item;
      });
      const item = transaction();
      this.options.onJobsQueued?.();
      return item;
    } catch (error) {
      throw this.toServiceError(error);
    }
  }

  retryLocalIndex(input: KnowledgeRetryLocalIndexRequest): KnowledgeDocumentListItem {
    try {
      const transaction = this.options.db.transaction(() => {
        const document = this.requireDocument(input.documentId);
        if (document.deletedAt || document.currentVersionId !== input.documentVersionId) {
          throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.JobStateConflict);
        }
        this.options.indexStore.retryFailedVersion({
          documentId: document.id,
          documentVersionId: document.currentVersionId,
        });
        return this.toListItemFromDocument(document);
      });
      const item = transaction();
      this.notifyIndexQueued();
      return item;
    } catch (error) {
      throw this.toServiceError(error);
    }
  }

  private async importSelectedFile(
    workspaceId: string,
    selectedFile: SelectedKnowledgeFileEntry,
  ): Promise<{ document: KnowledgeDocumentListItem; queuedJob: boolean }> {
    const inspection = await this.inspectFile(selectedFile.absolutePath);
    if (
      inspection.fileSize !== selectedFile.fileSize ||
      inspection.sourceMtime !== selectedFile.sourceMtime
    ) {
      throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.SelectedFileChanged);
    }
    if (
      this.options.documentStore.getActiveManagedBytes(workspaceId) + inspection.fileSize >
      KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES
    ) {
      throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.WorkspaceQuotaExceeded);
    }

    const blob = await this.options.managedFileStore.importFile(inspection.absolutePath);
    const inspectionAfterCopy = await this.inspectFile(selectedFile.absolutePath);
    if (
      inspectionAfterCopy.fileSize !== inspection.fileSize ||
      inspectionAfterCopy.sourceMtime !== inspection.sourceMtime ||
      blob.fileSize !== inspection.fileSize
    ) {
      throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.SelectedFileChanged);
    }
    const transaction = this.options.db.transaction(() => {
      // The early check avoids unnecessary copies. This transactional check is authoritative:
      // synchronous SQLite transactions serialize publications from concurrent imports.
      if (
        this.options.documentStore.getActiveManagedBytes(workspaceId) + blob.fileSize >
        KNOWLEDGE_MAX_WORKSPACE_LOGICAL_BYTES
      ) {
        throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.WorkspaceQuotaExceeded);
      }
      const created = this.options.documentStore.createDocumentWithVersion({
        workspaceId,
        displayName: inspection.displayName,
        sourceMode: KnowledgeDocumentSourceMode.Managed,
        originalPath: inspection.absolutePath,
        status: inspection.canExtractText
          ? KnowledgeDocumentStatus.Pending
          : KnowledgeDocumentStatus.CompletedWithoutText,
        version: {
          contentHash: blob.contentHash,
          managedPath: blob.managedPath,
          mimeType: inspection.mimeType,
          fileSize: blob.fileSize,
          sourceMtime: inspection.sourceMtime,
          parser: inspection.canExtractText ? null : 'attachment',
          extractedText: null,
          extractionPartial: false,
        },
      });
      const job = inspection.canExtractText
        ? this.options.jobStore.createJob({
            workspaceId,
            documentId: created.document.id,
            documentVersionId: created.version.id,
          })
        : null;
      const indexState = inspection.canExtractText
        ? null
        : this.options.indexStore.scheduleCurrentVersionInCurrentTransaction({
            workspaceId,
            documentId: created.document.id,
            documentVersionId: created.version.id,
          });
      const item = this.toListItem(
        this.toSummary(created.document, created.version),
        job,
        indexState,
      );
      this.options.compatibilityAdapter.upsertDocumentInCurrentTransaction(
        workspaceId,
        item,
        this.getCompatibilityProjectionOptions(created.document),
      );
      return { document: item, queuedJob: Boolean(job) };
    });
    return runTransientSqliteWriteTransactionUntilSuccess(
      transaction,
      this.options.busyRetryDelay,
    );
  }

  private requireWorkspace(workspaceId: string): void {
    if (!workspaceId || !this.options.workspaceExists(workspaceId)) {
      throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.WorkspaceNotFound);
    }
  }

  private getCompatibilityProjectionOptions(document: KnowledgeDocument): {
    legacySourceId: string | null;
    legacySourceSnapshotJson: string | null;
  } {
    return {
      legacySourceId: document.legacySourceId,
      legacySourceSnapshotJson: this.options.documentStore.getLegacySourceSnapshotJson(document.id),
    };
  }

  private requireDocument(documentId: string): KnowledgeDocument {
    const document = this.options.documentStore.getDocument(documentId.trim());
    if (!document) {
      throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.DocumentNotFound);
    }
    return document;
  }

  private requireVersion(versionId: string): KnowledgeDocumentVersion {
    const version = this.options.documentStore.getVersion(versionId);
    if (!version) {
      throw new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.DocumentNotFound);
    }
    return version;
  }

  private toListItemFromDocument(document: KnowledgeDocument): KnowledgeDocumentListItem {
    const version = this.requireVersion(document.currentVersionId);
    const enrichment = this.options.enrichmentRequestStore
      ?.listLatestSummariesForVersions(document.workspaceId, [version.id]).get(version.id) ?? null;
    const hasStaleHistory = this.options.enrichmentRequestStore
      ?.listDocumentIdsWithStalePriorVersionExtraction(document.workspaceId).has(document.id)
      ?? false;
    return this.toListItem(
      this.toSummary(document, version),
      this.options.jobStore.getCurrentJob(document.id, document.currentVersionId),
      this.options.indexStore.getState(document.currentVersionId),
      enrichment,
      hasStaleHistory,
    );
  }

  private toSummary(
    document: KnowledgeDocument,
    version: KnowledgeDocumentVersion,
  ): KnowledgeDocumentSummary {
    return {
      ...document,
      fileSize: version.fileSize,
      mimeType: version.mimeType,
      contentHash: version.contentHash,
    };
  }

  private toListItem(
    document: KnowledgeDocumentSummary,
    job: KnowledgeIngestionJob | null,
    indexState: KnowledgeDocumentIndexState | null,
    enrichment: KnowledgeDocumentListItem['enrichment'] = null,
    hasStalePriorVersionExtraction = false,
  ): KnowledgeDocumentListItem {
    return {
      id: document.id,
      displayName: document.displayName,
      sourceMode: document.sourceMode,
      currentVersionId: document.currentVersionId,
      revision: document.revision,
      status: document.status,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
      contentHash: document.contentHash,
      currentJob: job ? this.toJobSummary(job) : null,
      localIndex: this.toIndexSummary(indexState),
      enrichment,
      hasStalePriorVersionExtraction,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      deletedAt: document.deletedAt,
    };
  }

  private toIndexSummary(
    state: KnowledgeDocumentIndexState | null,
  ): KnowledgeDocumentIndexSummary | null {
    if (!state) {
      return null;
    }
    return {
      documentVersionId: state.documentVersionId,
      status: state.status,
      chunkCount: state.chunkCount,
      attemptCount: state.attemptCount,
      errorCode: state.errorCode,
      updatedAt: state.updatedAt,
      completedAt: state.completedAt,
    };
  }

  private emitLifecycleStage(stage: KnowledgeDocumentLifecycleStage): void {
    this.options.onLifecycleStage?.(stage);
  }

  private deleteRawSourceInCurrentTransaction(document: KnowledgeDocument): void {
    const sourceId = document.legacySourceId?.trim()
      || buildKnowledgeDocumentLegacySourceId(document.id);
    this.options.workspaceVectorLifecycle?.deleteWorkspaceDocumentSources(
      document.workspaceId,
      [sourceId],
    );
  }

  private abortEnrichmentAfterCommit(documentVersionId: string): void {
    try {
      this.options.enrichmentLifecycle?.abortActiveAttemptForVersion(documentVersionId);
    } catch {
      console.warn('[KnowledgeDocumentLifecycle]', { code: 'enrichment_abort_failed' });
    }
  }

  private refreshRawSourceAfterCommit(document: KnowledgeDocumentListItem): void {
    if (this.rawSourceRefreshSealed) return;
    try {
      const result = this.options.workspaceVectorLifecycle?.replaceWorkspaceDocumentSource(
        this.requireDocument(document.id).workspaceId,
        document.id,
      );
      this.trackRawSourceRefresh(result);
    } catch {
      this.logRawSourceRefreshFailure();
    }
  }

  private trackRawSourceRefresh(result: unknown): void {
    let tracked!: Promise<void>;
    tracked = Promise.resolve(result)
      .then((): void => undefined)
      .catch(() => {
        this.logRawSourceRefreshFailure();
      })
      .finally(() => {
        this.pendingRawSourceRefreshes.delete(tracked);
      });
    this.pendingRawSourceRefreshes.add(tracked);
  }

  private async drainRawSourceRefreshes(): Promise<void> {
    while (this.pendingRawSourceRefreshes.size > 0) {
      await Promise.all([...this.pendingRawSourceRefreshes]);
    }
  }

  private logRawSourceRefreshFailure(): void {
    console.warn('[KnowledgeDocumentLifecycle]', { code: 'raw_source_refresh_failed' });
  }

  private notifyIndexQueued(): void {
    try {
      this.options.onIndexQueued?.();
    } catch {
      console.warn('[KnowledgeDocumentLifecycle]', { code: 'index_worker_wake_failed' });
    }
  }

  private toJobSummary(job: KnowledgeIngestionJob): KnowledgeIngestionJobSummary {
    return {
      id: job.id,
      documentVersionId: job.documentVersionId,
      stage: job.stage,
      status: job.status,
      progress: job.progress,
      errorCode: job.errorCode,
      updatedAt: job.updatedAt,
    };
  }

  private buildTargetKey(documentId: string, documentVersionId: string): string {
    return `${documentId}\0${documentVersionId}`;
  }

  private toServiceError(error: unknown, fileName?: string): KnowledgeDocumentServiceError {
    if (error instanceof KnowledgeDocumentServiceError) {
      return error;
    }
    if (
      error instanceof KnowledgeSelectionTokenError ||
      error instanceof KnowledgeFileInspectionError
    ) {
      return new KnowledgeDocumentServiceError(error.code, { fileName });
    }
    if (error instanceof KnowledgeManagedFileError) {
      const code = Object.values(KnowledgeBaseErrorCodes).includes(
        error.code as KnowledgeBaseErrorCode,
      )
        ? (error.code as KnowledgeBaseErrorCode)
        : KnowledgeBaseErrorCodes.PersistenceFailed;
      return new KnowledgeDocumentServiceError(code, { fileName });
    }
    if (error instanceof KnowledgeDocumentRevisionConflictError) {
      return new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.RevisionConflict, {
        latestDocument: this.toListItemFromDocument(error.currentDocument),
      });
    }
    if (error instanceof KnowledgeIngestionJobStateError) {
      return new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.JobStateConflict);
    }
    if (error instanceof KnowledgeDocumentIndexStateError) {
      return new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.JobStateConflict);
    }
    return new KnowledgeDocumentServiceError(KnowledgeBaseErrorCodes.PersistenceFailed, {
      fileName,
    });
  }
}
