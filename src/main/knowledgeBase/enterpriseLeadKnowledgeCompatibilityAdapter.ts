import {
  EnterpriseLeadDocumentExtractionStatus,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadKnowledgeIndexStatus,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type { EnterpriseLeadExtractionSource } from '../../shared/enterpriseLeadWorkspace/types';
import { normalizeEnterpriseLeadExtractionSources } from '../../shared/enterpriseLeadWorkspace/validation';
import {
  KNOWLEDGE_DOCUMENT_LEGACY_SOURCE_PREFIX,
  type KnowledgeDocumentStatus,
  KnowledgeDocumentStatus as KnowledgeDocumentStatuses,
} from '../../shared/knowledgeBase/constants';
import type { KnowledgeDocumentListItem } from '../../shared/knowledgeBase/types';
import type { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';

const legacyExtractionStatusByDocumentStatus: Record<
  KnowledgeDocumentStatus,
  EnterpriseLeadDocumentExtractionStatus
> = {
  [KnowledgeDocumentStatuses.Pending]: EnterpriseLeadDocumentExtractionStatus.Pending,
  [KnowledgeDocumentStatuses.Processing]: EnterpriseLeadDocumentExtractionStatus.Extracting,
  [KnowledgeDocumentStatuses.Ready]: EnterpriseLeadDocumentExtractionStatus.Extracted,
  [KnowledgeDocumentStatuses.CompletedWithoutText]:
    EnterpriseLeadDocumentExtractionStatus.Extracted,
  [KnowledgeDocumentStatuses.Failed]: EnterpriseLeadDocumentExtractionStatus.Failed,
};

type CompatibilityWorkspaceStore = Pick<
  EnterpriseLeadWorkspaceStore,
  | 'removeWorkspaceSourceById'
  | 'removeWorkspaceSourceByIdInCurrentTransaction'
  | 'upsertWorkspaceSourceById'
  | 'upsertWorkspaceSourceByIdInCurrentTransaction'
>;

export const buildKnowledgeDocumentLegacySourceId = (documentId: string): string =>
  `${KNOWLEDGE_DOCUMENT_LEGACY_SOURCE_PREFIX}${documentId.trim()}`;

export interface KnowledgeCompatibilityProjectionOptions {
  legacySourceId?: string | null;
  legacySourceSnapshotJson?: string | null;
}

const parseLegacySourceSnapshot = (
  snapshotJson?: string | null,
): EnterpriseLeadExtractionSource | null => {
  const serialized = snapshotJson?.trim();
  if (!serialized) {
    return null;
  }
  try {
    return normalizeEnterpriseLeadExtractionSources([JSON.parse(serialized)])[0] ?? null;
  } catch {
    return null;
  }
};

export class EnterpriseLeadKnowledgeCompatibilityAdapter {
  constructor(private readonly workspaceStore: CompatibilityWorkspaceStore) {}

  upsertDocument(
    workspaceId: string,
    document: KnowledgeDocumentListItem,
    options: KnowledgeCompatibilityProjectionOptions = {},
  ): void {
    const sourceId =
      options.legacySourceId?.trim() || buildKnowledgeDocumentLegacySourceId(document.id);
    if (document.deletedAt) {
      this.removeDocument(workspaceId, document.id, sourceId);
      return;
    }
    this.workspaceStore.upsertWorkspaceSourceById(
      workspaceId,
      this.buildSource(
        document,
        sourceId,
        parseLegacySourceSnapshot(options.legacySourceSnapshotJson),
      ),
    );
  }

  removeDocument(workspaceId: string, documentId: string, legacySourceId?: string | null): void {
    this.workspaceStore.removeWorkspaceSourceById(
      workspaceId,
      legacySourceId?.trim() || buildKnowledgeDocumentLegacySourceId(documentId),
    );
  }

  upsertDocumentInCurrentTransaction(
    workspaceId: string,
    document: KnowledgeDocumentListItem,
    options: KnowledgeCompatibilityProjectionOptions = {},
  ): void {
    const sourceId =
      options.legacySourceId?.trim() || buildKnowledgeDocumentLegacySourceId(document.id);
    if (document.deletedAt) {
      this.removeDocumentInCurrentTransaction(workspaceId, document.id, sourceId);
      return;
    }
    this.workspaceStore.upsertWorkspaceSourceByIdInCurrentTransaction(
      workspaceId,
      this.buildSource(
        document,
        sourceId,
        parseLegacySourceSnapshot(options.legacySourceSnapshotJson),
      ),
    );
  }

  removeDocumentInCurrentTransaction(
    workspaceId: string,
    documentId: string,
    legacySourceId?: string | null,
  ): void {
    this.workspaceStore.removeWorkspaceSourceByIdInCurrentTransaction(
      workspaceId,
      legacySourceId?.trim() || buildKnowledgeDocumentLegacySourceId(documentId),
    );
  }

  private buildSource(
    document: KnowledgeDocumentListItem,
    sourceId: string,
    legacySourceSnapshot: EnterpriseLeadExtractionSource | null,
  ): EnterpriseLeadExtractionSource {
    const failed = document.status === KnowledgeDocumentStatuses.Failed;
    return {
      ...legacySourceSnapshot,
      id: sourceId,
      kind:
        legacySourceSnapshot?.kind ??
        (document.mimeType?.startsWith('image/')
          ? EnterpriseLeadExtractionSourceKind.Image
          : EnterpriseLeadExtractionSourceKind.File),
      label: document.displayName,
      fileName: document.displayName,
      fileSize: document.fileSize ?? legacySourceSnapshot?.fileSize,
      extractionStatus: legacyExtractionStatusByDocumentStatus[document.status],
      extractionError: failed ? (document.currentJob?.errorCode ?? undefined) : undefined,
      extractionProgressCurrent: document.currentJob
        ? Math.round(document.currentJob.progress * 100)
        : undefined,
      extractionProgressTotal: document.currentJob ? 100 : undefined,
      vectorIndexStatus: failed
        ? EnterpriseLeadKnowledgeIndexStatus.Failed
        : EnterpriseLeadKnowledgeIndexStatus.Pending,
      vectorIndexError: failed ? (document.currentJob?.errorCode ?? undefined) : undefined,
      createdAt: legacySourceSnapshot?.createdAt ?? document.createdAt,
      updatedAt: document.updatedAt,
    };
  }
}
