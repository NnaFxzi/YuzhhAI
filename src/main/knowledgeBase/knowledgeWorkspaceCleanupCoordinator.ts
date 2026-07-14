import Database from 'better-sqlite3';

import {
  buildEnterpriseLeadWorkspaceKnowledgeScopeId,
  EnterpriseLeadKnowledgeScope,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type { EnterpriseLeadWorkspaceProfileRevisionStore } from '../enterpriseLeadWorkspace/profileRevisionStore';
import type { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import type { ContentKnowledgeVectorStore } from '../libs/contentKnowledgeVectorStore';
import { runTransientSqliteWriteTransaction } from '../libs/sqliteTransactionRetry';
import type { KnowledgeDocumentIndexStore } from './knowledgeDocumentIndexStore';
import type { KnowledgeDocumentStore } from './knowledgeDocumentStore';
import type { KnowledgeEnrichmentRequestStore } from './knowledgeEnrichmentRequestStore';
import type { KnowledgeExtractionAuthorizationStore } from './knowledgeExtractionAuthorizationStore';
import type { KnowledgeFactProjectionStore } from './knowledgeFactProjectionStore';
import type { KnowledgeFactStore } from './knowledgeFactStore';
import type { KnowledgeIngestionJobStore } from './knowledgeIngestionJobStore';
import type { KnowledgeMigrationStore } from './knowledgeMigrationStore';
import type { KnowledgeTrustedProfileIndexStore } from './knowledgeTrustedProfileIndexStore';

const WORKSPACE_CLEANUP_FAILED = 'workspace_cleanup_failed';
const ENTERPRISE_SCOPE_PREFIX = `${EnterpriseLeadKnowledgeScope.Workspace}:`;

export const KnowledgeWorkspaceCleanupStage = {
  TrustedIndex: 'trusted_index',
  Projections: 'projections',
  Facts: 'facts',
  EnrichmentRequests: 'enrichment_requests',
  DocumentIndex: 'document_index',
  IngestionJobs: 'ingestion_jobs',
  Documents: 'documents',
  Migration: 'migration',
  ProfileFieldRevisions: 'profile_field_revisions',
  WorkspaceRow: 'workspace_row',
  VectorScope: 'vector_scope',
} as const;
export type KnowledgeWorkspaceCleanupStage =
  (typeof KnowledgeWorkspaceCleanupStage)[keyof typeof KnowledgeWorkspaceCleanupStage];

export class KnowledgeWorkspaceCleanupError extends Error {
  readonly code = WORKSPACE_CLEANUP_FAILED;

  constructor() {
    super('Workspace cleanup failed');
    this.name = 'KnowledgeWorkspaceCleanupError';
    delete this.stack;
  }

  toJSON(): { code: string; message: string } {
    return { code: this.code, message: this.message };
  }
}

export interface KnowledgeWorkspaceCleanupCoordinatorOptions {
  db: Database.Database;
  workspaceStore: Pick<EnterpriseLeadWorkspaceStore, 'deleteWorkspaceRowInCurrentTransaction'>;
  trustedIndexStore: Pick<
    KnowledgeTrustedProfileIndexStore,
    | 'deleteParentlessTrustedIndexInCurrentTransaction'
    | 'deleteWorkspaceTrustedIndexInCurrentTransaction'
  >;
  projectionStore: Pick<
    KnowledgeFactProjectionStore,
    'deleteParentlessProjectionsInCurrentTransaction' |
    'deleteWorkspaceProjectionsInCurrentTransaction'
  >;
  factStore: Pick<
    KnowledgeFactStore,
    'deleteParentlessFactChildrenInCurrentTransaction' |
    'deleteWorkspaceFactsInCurrentTransaction'
  >;
  enrichmentRequestStore: Pick<
    KnowledgeEnrichmentRequestStore,
    'deleteParentlessEnrichmentInCurrentTransaction' |
    'deleteWorkspaceRequestsInCurrentTransaction' |
    'markWorkspaceStaleInCurrentTransaction'
  >;
  documentIndexStore: Pick<
    KnowledgeDocumentIndexStore,
    'deleteParentlessIndexInCurrentTransaction' |
    'deleteWorkspaceIndexInCurrentTransaction'
  >;
  ingestionJobStore: Pick<
    KnowledgeIngestionJobStore,
    'deleteParentlessIngestionInCurrentTransaction' |
    'deleteWorkspaceJobsInCurrentTransaction'
  >;
  documentStore: Pick<
    KnowledgeDocumentStore,
    'deleteParentlessVersionsInCurrentTransaction' |
    'deleteWorkspaceDocumentsInCurrentTransaction'
  >;
  migrationStore: Pick<KnowledgeMigrationStore, 'deleteWorkspaceMigrationInCurrentTransaction'>;
  profileRevisionStore: Pick<
    EnterpriseLeadWorkspaceProfileRevisionStore,
    'deleteWorkspaceFieldRevisionsInCurrentTransaction'
  >;
  contentKnowledgeVectorStore: Pick<
    ContentKnowledgeVectorStore,
    'deleteEnterpriseWorkspaceScopeInCurrentTransaction'
  >;
  authorizationStore: Pick<KnowledgeExtractionAuthorizationStore, 'clearWorkspace'>;
  enrichmentService: { abortActiveAttemptForWorkspace(workspaceId: string): void };
  trustedIndexingService: { abortActiveAttemptForWorkspace(workspaceId: string): void };
  onStage?: (stage: KnowledgeWorkspaceCleanupStage) => void;
}

export class KnowledgeWorkspaceCleanupCoordinator {
  constructor(private readonly options: KnowledgeWorkspaceCleanupCoordinatorOptions) {}

  prepareWorkspaceDeletion(workspaceId: string): boolean {
    const id = this.requireWorkspaceId(workspaceId);
    try {
      this.options.authorizationStore.clearWorkspace(id);
      const transaction = this.options.db.transaction(() => {
        this.options.enrichmentRequestStore.markWorkspaceStaleInCurrentTransaction(
          id,
          new Date().toISOString(),
        );
        return this.cleanupWorkspaceInCurrentTransaction(id, true);
      });
      const deleted = runTransientSqliteWriteTransaction(() => transaction.immediate());
      if (deleted) {
        this.abortAfterCommit(id);
      }
      return deleted;
    } catch (error) {
      if (error instanceof KnowledgeWorkspaceCleanupError) throw error;
      throw new KnowledgeWorkspaceCleanupError();
    }
  }

  cleanupOrphansAtStartup(now = new Date().toISOString()): number {
    try {
      const transaction = this.options.db.transaction(() => {
        const orphanedWorkspaceIds = this.listOrphanedWorkspaceIdsInCurrentTransaction();
        for (const workspaceId of orphanedWorkspaceIds) {
          this.cleanupWorkspaceInCurrentTransaction(workspaceId, false);
        }
        this.deleteParentlessChildrenInCurrentTransaction(now);
        return orphanedWorkspaceIds.length;
      });
      return runTransientSqliteWriteTransaction(() => transaction.immediate());
    } catch (error) {
      if (error instanceof KnowledgeWorkspaceCleanupError) throw error;
      throw new KnowledgeWorkspaceCleanupError();
    }
  }

  listOrphanedWorkspaceIdsInCurrentTransaction(): string[] {
    this.assertCurrentTransaction();
    const vectorWorkspaceIds = this.readReservedVectorWorkspaceIdsInCurrentTransaction();
    const rows = this.options.db.prepare(`
      SELECT workspace_id FROM knowledge_trusted_profile_index_jobs
      UNION SELECT workspace_id FROM knowledge_trusted_profile_index_state
      UNION SELECT workspace_id FROM knowledge_fact_projection_support_groups
      UNION SELECT workspace_id FROM knowledge_facts
      UNION SELECT workspace_id FROM knowledge_enrichment_requests
      UNION SELECT workspace_id FROM knowledge_document_index_state
      UNION SELECT workspace_id FROM knowledge_document_chunks
      UNION SELECT workspace_id FROM knowledge_ingestion_jobs
      UNION SELECT workspace_id FROM knowledge_documents
      UNION SELECT workspace_id FROM knowledge_migration_state
      UNION SELECT workspace_id FROM enterprise_lead_workspace_profile_field_revisions
    `).all() as Array<{ workspace_id: unknown }>;
    const candidates = new Set<string>(vectorWorkspaceIds);
    for (const row of rows) {
      if (
        typeof row.workspace_id !== 'string' ||
        !row.workspace_id.trim() ||
        row.workspace_id.trim() !== row.workspace_id
      ) {
        throw new KnowledgeWorkspaceCleanupError();
      }
      candidates.add(row.workspace_id);
    }
    const workspaceExists = this.options.db.prepare(`
      SELECT 1 FROM enterprise_lead_workspaces WHERE id = ? LIMIT 1
    `);
    return [...candidates]
      .filter(candidate => !workspaceExists.get(candidate))
      .sort((left, right) => left.localeCompare(right));
  }

  private cleanupWorkspaceInCurrentTransaction(
    workspaceId: string,
    deleteWorkspaceRow: boolean,
  ): boolean {
    this.assertCurrentTransaction();
    this.options.trustedIndexStore.deleteWorkspaceTrustedIndexInCurrentTransaction(workspaceId);
    this.emitStage(KnowledgeWorkspaceCleanupStage.TrustedIndex);
    this.options.projectionStore.deleteWorkspaceProjectionsInCurrentTransaction(workspaceId);
    this.emitStage(KnowledgeWorkspaceCleanupStage.Projections);
    this.options.factStore.deleteWorkspaceFactsInCurrentTransaction(workspaceId);
    this.emitStage(KnowledgeWorkspaceCleanupStage.Facts);
    this.options.enrichmentRequestStore.deleteWorkspaceRequestsInCurrentTransaction(workspaceId);
    this.emitStage(KnowledgeWorkspaceCleanupStage.EnrichmentRequests);
    this.options.documentIndexStore.deleteWorkspaceIndexInCurrentTransaction(workspaceId);
    this.emitStage(KnowledgeWorkspaceCleanupStage.DocumentIndex);
    this.options.ingestionJobStore.deleteWorkspaceJobsInCurrentTransaction(workspaceId);
    this.emitStage(KnowledgeWorkspaceCleanupStage.IngestionJobs);
    this.options.documentStore.deleteWorkspaceDocumentsInCurrentTransaction(workspaceId);
    this.emitStage(KnowledgeWorkspaceCleanupStage.Documents);
    this.options.migrationStore.deleteWorkspaceMigrationInCurrentTransaction(workspaceId);
    this.emitStage(KnowledgeWorkspaceCleanupStage.Migration);
    this.options.profileRevisionStore.deleteWorkspaceFieldRevisionsInCurrentTransaction(workspaceId);
    this.emitStage(KnowledgeWorkspaceCleanupStage.ProfileFieldRevisions);
    let deleted = false;
    if (deleteWorkspaceRow) {
      deleted = this.options.workspaceStore.deleteWorkspaceRowInCurrentTransaction(workspaceId);
      this.emitStage(KnowledgeWorkspaceCleanupStage.WorkspaceRow);
    }
    this.options.contentKnowledgeVectorStore
      .deleteEnterpriseWorkspaceScopeInCurrentTransaction(workspaceId);
    this.emitStage(KnowledgeWorkspaceCleanupStage.VectorScope);
    return deleteWorkspaceRow ? deleted : true;
  }

  private deleteParentlessChildrenInCurrentTransaction(now: string): void {
    this.options.trustedIndexStore.deleteParentlessTrustedIndexInCurrentTransaction();
    this.options.projectionStore.deleteParentlessProjectionsInCurrentTransaction(now);
    this.options.factStore.deleteParentlessFactChildrenInCurrentTransaction();
    this.options.enrichmentRequestStore.deleteParentlessEnrichmentInCurrentTransaction();
    this.options.documentIndexStore.deleteParentlessIndexInCurrentTransaction();
    this.options.ingestionJobStore.deleteParentlessIngestionInCurrentTransaction();
    this.options.documentStore.deleteParentlessVersionsInCurrentTransaction();
  }

  private readReservedVectorWorkspaceIdsInCurrentTransaction(): string[] {
    const rows = this.options.db.prepare(`
      SELECT DISTINCT scope_id
      FROM content_knowledge_chunks
      WHERE scope_id LIKE ?
      ORDER BY scope_id ASC
    `).all(`${ENTERPRISE_SCOPE_PREFIX}%`) as Array<{ scope_id: unknown }>;
    return rows.map(row => {
      if (typeof row.scope_id !== 'string') throw new KnowledgeWorkspaceCleanupError();
      const workspaceId = row.scope_id.slice(ENTERPRISE_SCOPE_PREFIX.length);
      if (
        !workspaceId || workspaceId.trim() !== workspaceId ||
        row.scope_id !== buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId)
      ) {
        throw new KnowledgeWorkspaceCleanupError();
      }
      return workspaceId;
    });
  }

  private abortAfterCommit(workspaceId: string): void {
    try {
      this.options.enrichmentService.abortActiveAttemptForWorkspace(workspaceId);
    } catch {
      console.warn('[KnowledgeWorkspaceCleanup]', { code: 'enrichment_abort_failed' });
    }
    try {
      this.options.trustedIndexingService.abortActiveAttemptForWorkspace(workspaceId);
    } catch {
      console.warn('[KnowledgeWorkspaceCleanup]', { code: 'trusted_abort_failed' });
    }
  }

  private emitStage(stage: KnowledgeWorkspaceCleanupStage): void {
    this.options.onStage?.(stage);
  }

  private assertCurrentTransaction(): void {
    if (!this.options.db.inTransaction) throw new KnowledgeWorkspaceCleanupError();
  }

  private requireWorkspaceId(workspaceId: string): string {
    const id = workspaceId.trim();
    if (!id) throw new KnowledgeWorkspaceCleanupError();
    return id;
  }
}
