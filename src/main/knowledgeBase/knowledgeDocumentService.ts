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
import type { EnterpriseLeadKnowledgeCompatibilityAdapter } from './enterpriseLeadKnowledgeCompatibilityAdapter';
import {
  KnowledgeDocumentIndexStateError,
  type KnowledgeDocumentIndexStore,
  runTransientSqliteWriteTransactionUntilSuccess,
  type TransientSqliteBusyRetryDelay,
} from './knowledgeDocumentIndexStore';
import type { KnowledgeDocumentIndexState } from './knowledgeDocumentIndexTypes';
import {
  KnowledgeDocumentRevisionConflictError,
  KnowledgeDocumentStore,
} from './knowledgeDocumentStore';
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
  'removeDocument' | 'upsertDocument'
>;

export interface KnowledgeDocumentServiceOptions {
  db: Database.Database;
  documentStore: KnowledgeDocumentStore;
  indexStore: Pick<KnowledgeDocumentIndexStore,
    | 'deactivateVersion'
    | 'getState'
    | 'listStates'
    | 'retryFailedVersion'
    | 'scheduleCurrentVersion'
  >;
  jobStore: KnowledgeIngestionJobStore;
  managedFileStore: KnowledgeManagedFileStore;
  selectionTokenStore: KnowledgeSelectionTokenStore;
  compatibilityAdapter: KnowledgeCompatibilityAdapter;
  workspaceExists: (workspaceId: string) => boolean;
  inspectFile?: (absolutePath: string) => Promise<KnowledgeFileInspection>;
  onJobsQueued?: () => void;
  onIndexQueued?: () => void;
  busyRetryDelay?: TransientSqliteBusyRetryDelay;
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

  constructor(private readonly options: KnowledgeDocumentServiceOptions) {
    this.inspectFile = options.inspectFile ?? inspectKnowledgeFile;
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
    return this.options.documentStore.listDocuments(workspaceId, {
      visibility: input.visibility,
    }).map(document =>
      this.toListItem(
        document,
        jobsByTarget.get(this.buildTargetKey(document.id, document.currentVersionId)) ?? null,
        statesByVersion.get(document.currentVersionId) ?? null,
      ),
    );
  }

  getDocumentDetails(input: KnowledgeDocumentDetailsRequest): KnowledgeDocumentDetails {
    const document = this.requireDocument(input.documentId);
    const version = this.requireVersion(document.currentVersionId);
    return {
      document: this.toListItem(
        this.toSummary(document, version),
        this.options.jobStore.getCurrentJob(document.id, version.id),
        this.options.indexStore.getState(version.id),
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
        const deleted = this.options.documentStore.softDeleteDocument(
          existing.id,
          input.expectedRevision,
        );
        this.options.jobStore.cancelQueuedJobsForDocument(existing.id);
        const hadIndexState =
          this.options.indexStore.getState(existing.currentVersionId) !== null;
        if (hadIndexState) {
          this.options.indexStore.deactivateVersion({
            workspaceId: existing.workspaceId,
            documentId: existing.id,
            documentVersionId: existing.currentVersionId,
          });
        }
        const item = this.toListItemFromDocument(deleted);
        this.options.compatibilityAdapter.upsertDocument(
          deleted.workspaceId,
          item,
          this.getCompatibilityProjectionOptions(deleted),
        );
        return { item, hadIndexState };
      });
      const result = transaction();
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
        const restored = this.options.documentStore.restoreDocument(
          existing.id,
          input.expectedRevision,
        );
        const indexState = this.options.indexStore.scheduleCurrentVersion({
          workspaceId: restored.workspaceId,
          documentId: restored.id,
          documentVersionId: restored.currentVersionId,
        });
        const item = this.toListItemFromDocument(restored);
        this.options.compatibilityAdapter.upsertDocument(
          restored.workspaceId,
          item,
          this.getCompatibilityProjectionOptions(restored),
        );
        return { item, indexState };
      });
      const result = transaction();
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
        const hadPreviousIndexState =
          this.options.indexStore.getState(existing.currentVersionId) !== null;
        if (hadPreviousIndexState) {
          this.options.indexStore.deactivateVersion({
            workspaceId: existing.workspaceId,
            documentId: existing.id,
            documentVersionId: existing.currentVersionId,
          });
        }
        const status = input.version.extractedText?.trim()
          ? KnowledgeDocumentStatus.Ready
          : KnowledgeDocumentStatus.CompletedWithoutText;
        const replaced = this.options.documentStore.addVersion(
          existing.id,
          input.expectedRevision,
          input.version,
          status,
        );
        const indexState = this.options.indexStore.scheduleCurrentVersion({
          workspaceId: replaced.document.workspaceId,
          documentId: replaced.document.id,
          documentVersionId: replaced.version.id,
        });
        const item = this.toListItemFromDocument(replaced.document);
        this.options.compatibilityAdapter.upsertDocument(
          replaced.document.workspaceId,
          item,
          this.getCompatibilityProjectionOptions(replaced.document),
        );
        return { item, indexState, hadPreviousIndexState };
      });
      const result = transaction();
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
        this.options.compatibilityAdapter.upsertDocument(
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
        : this.options.indexStore.scheduleCurrentVersion({
            workspaceId,
            documentId: created.document.id,
            documentVersionId: created.version.id,
          });
      const item = this.toListItem(
        this.toSummary(created.document, created.version),
        job,
        indexState,
      );
      this.options.compatibilityAdapter.upsertDocument(
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
    return this.toListItem(
      this.toSummary(document, version),
      this.options.jobStore.getCurrentJob(document.id, document.currentVersionId),
      this.options.indexStore.getState(document.currentVersionId),
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

  private notifyIndexQueued(): void {
    try {
      this.options.onIndexQueued?.();
    } catch (error) {
      console.warn('[KnowledgeBase] Failed to wake local index worker:', error);
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
