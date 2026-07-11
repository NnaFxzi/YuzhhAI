import fs from 'node:fs/promises';

import Database from 'better-sqlite3';

import {
  EnterpriseLeadImageAttachmentExtensions,
  EnterpriseLeadReadableDocumentExtensions,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type { EnterpriseLeadExtractionSource } from '../../shared/enterpriseLeadWorkspace/types';
import {
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeMigrationStatus,
} from '../../shared/knowledgeBase/constants';
import type {
  CreateKnowledgeDocumentInput,
  KnowledgeIngestionJob,
} from '../../shared/knowledgeBase/types';
import type { KnowledgeDocumentStore } from './knowledgeDocumentStore';
import type { KnowledgeIngestionJobStore } from './knowledgeIngestionJobStore';
import type { ImportedKnowledgeBlob, KnowledgeManagedFileStore } from './knowledgeManagedFileStore';
import type { KnowledgeMigrationStore } from './knowledgeMigrationStore';
import {
  buildLegacyKnowledgeSourceId,
  isNormalizedKnowledgeProjectionSourceId,
} from './legacyKnowledgeSourceIdentity';

const KNOWLEDGE_LEGACY_MIGRATION_VERSION = 2;
const extractableLegacyExtensions = new Set(
  [...EnterpriseLeadReadableDocumentExtensions, ...EnterpriseLeadImageAttachmentExtensions].map(
    extension => `.${extension}`,
  ),
);

export interface LegacyKnowledgeWorkspace {
  id: string;
  extractionSources: EnterpriseLeadExtractionSource[];
}

export interface KnowledgeMigrationResult {
  workspaceId: string;
  sourceCount: number;
  migratedCount: number;
  skippedCount: number;
  status: KnowledgeMigrationStatus;
  diagnostics: string[];
}

type KnowledgeManagedFileImporter = Pick<
  KnowledgeManagedFileStore,
  'importFile' | 'importTextSnapshot'
>;

type KnowledgeJobCreator = {
  createJob: (
    input: {
      workspaceId: string;
      documentId: string;
      documentVersionId: string;
    },
    now?: string,
  ) => KnowledgeIngestionJob;
};

interface KnowledgeMigrationServiceOptions {
  db: Database.Database;
  documentStore: KnowledgeDocumentStore;
  managedFileStore: KnowledgeManagedFileImporter;
  jobStore: KnowledgeJobCreator | Pick<KnowledgeIngestionJobStore, 'createJob'>;
  migrationStore: KnowledgeMigrationStore;
  fileExists?: (filePath: string) => Promise<boolean>;
}

const defaultFileExists = async (filePath: string): Promise<boolean> => {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
};

const cleanOptionalText = (value?: string): string => value?.trim() ?? '';

const migrationErrorMessage = (sourceLabel: string, error: unknown): string => {
  const detail = error instanceof Error ? error.message : String(error);
  return `${sourceLabel}: ${detail}`.slice(0, 500);
};

export class KnowledgeMigrationService {
  private readonly fileExists: (filePath: string) => Promise<boolean>;

  constructor(private readonly options: KnowledgeMigrationServiceOptions) {
    this.fileExists = options.fileExists ?? defaultFileExists;
  }

  async migrateWorkspace(workspace: LegacyKnowledgeWorkspace): Promise<KnowledgeMigrationResult> {
    const workspaceId = workspace.id.trim();
    if (!workspaceId) {
      throw new Error('Workspace id is required');
    }
    const sources = Array.isArray(workspace.extractionSources) ? workspace.extractionSources : [];
    this.options.migrationStore.begin(
      workspaceId,
      KNOWLEDGE_LEGACY_MIGRATION_VERSION,
      sources.length,
    );

    let migratedCount = 0;
    let skippedCount = 0;
    const diagnostics: string[] = [];

    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      const source = sources[sourceIndex];
      if (!source) {
        continue;
      }
      const legacySourceId = buildLegacyKnowledgeSourceId(workspaceId, source, sourceIndex);
      if (isNormalizedKnowledgeProjectionSourceId(legacySourceId)) {
        skippedCount += 1;
        continue;
      }
      if (this.options.documentStore.findByLegacySourceId(workspaceId, legacySourceId)) {
        skippedCount += 1;
        migratedCount += 1;
        this.options.migrationStore.recordProgress(workspaceId, migratedCount, legacySourceId);
        continue;
      }

      try {
        const sourceText = cleanOptionalText(source.text);
        const blob = await this.importLegacyContent(source, sourceText);
        const documentInput = this.buildDocumentInput({
          workspaceId,
          legacySourceId,
          source,
          sourceIndex,
          sourceText,
          blob,
        });
        const now = new Date().toISOString();
        const transaction = this.options.db.transaction(() => {
          if (this.options.documentStore.findByLegacySourceId(workspaceId, legacySourceId)) {
            this.options.migrationStore.recordProgress(
              workspaceId,
              migratedCount + 1,
              legacySourceId,
              now,
            );
            return false;
          }
          const created = this.options.documentStore.createDocumentWithVersion({
            ...documentInput,
            legacySourceSnapshotJson: JSON.stringify(source),
          });
          if (documentInput.status === KnowledgeDocumentStatus.Pending) {
            this.options.jobStore.createJob(
              {
                workspaceId,
                documentId: created.document.id,
                documentVersionId: created.version.id,
              },
              now,
            );
          }
          this.options.migrationStore.recordProgress(
            workspaceId,
            migratedCount + 1,
            legacySourceId,
            now,
          );
          return true;
        });
        const published = transaction();
        migratedCount += 1;
        if (!published) {
          skippedCount += 1;
        }
      } catch (error) {
        diagnostics.push(migrationErrorMessage(source.label || legacySourceId, error));
      }
    }

    const completedState =
      diagnostics.length > 0
        ? this.options.migrationStore.fail(workspaceId, diagnostics)
        : this.options.migrationStore.complete(workspaceId, diagnostics);
    return {
      workspaceId,
      sourceCount: sources.length,
      migratedCount,
      skippedCount,
      status: completedState.status,
      diagnostics: completedState.diagnostics,
    };
  }

  private async importLegacyContent(
    source: EnterpriseLeadExtractionSource,
    sourceText: string,
  ): Promise<ImportedKnowledgeBlob | null> {
    const filePath = cleanOptionalText(source.filePath);
    if (filePath && (await this.fileExists(filePath))) {
      return this.options.managedFileStore.importFile(filePath);
    }
    if (sourceText) {
      return this.options.managedFileStore.importTextSnapshot(sourceText);
    }
    return null;
  }

  private buildDocumentInput(input: {
    workspaceId: string;
    legacySourceId: string;
    source: EnterpriseLeadExtractionSource;
    sourceIndex: number;
    sourceText: string;
    blob: ImportedKnowledgeBlob | null;
  }): CreateKnowledgeDocumentInput {
    const originalPath = cleanOptionalText(input.source.filePath);
    const sourceFileName =
      cleanOptionalText(input.source.fileName) || getFileNameFromPath(originalPath);
    const canExtractManagedFile = Boolean(
      input.blob &&
      !input.sourceText &&
      extractableLegacyExtensions.has(getFileExtension(sourceFileName || originalPath)),
    );
    const displayName = canExtractManagedFile
      ? sourceFileName || originalPath
      : cleanOptionalText(input.source.label) ||
        sourceFileName ||
        originalPath ||
        `Legacy source ${input.sourceIndex + 1}`;

    return {
      workspaceId: input.workspaceId,
      legacySourceId: input.legacySourceId,
      displayName,
      sourceMode: KnowledgeDocumentSourceMode.Managed,
      originalPath: originalPath || undefined,
      status: input.sourceText
        ? KnowledgeDocumentStatus.Ready
        : canExtractManagedFile
          ? KnowledgeDocumentStatus.Pending
          : KnowledgeDocumentStatus.CompletedWithoutText,
      version: {
        contentHash: input.blob?.contentHash ?? null,
        managedPath: input.blob?.managedPath ?? null,
        mimeType: null,
        fileSize: input.blob?.fileSize ?? input.source.fileSize ?? null,
        sourceMtime: null,
        parser: `legacy:${input.source.kind || 'unknown'}`,
        extractedText: input.sourceText || null,
        extractionPartial: Boolean(input.source.extractionPartial),
      },
    };
  }
}

const getFileNameFromPath = (filePath: string): string =>
  filePath.split(/[\\/]/).filter(Boolean).pop() ?? '';

const getFileExtension = (fileName: string): string => {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
};
