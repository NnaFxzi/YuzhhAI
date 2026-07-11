import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  EnterpriseLeadDocumentExtractionStatus,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadKnowledgeIndexStatus,
  EnterpriseLeadWorkspaceType,
} from '../../shared/enterpriseLeadWorkspace/constants';
import {
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeIngestionJobStatus,
  KnowledgeIngestionStage,
} from '../../shared/knowledgeBase/constants';
import type { KnowledgeDocumentListItem } from '../../shared/knowledgeBase/types';
import { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import {
  buildKnowledgeDocumentLegacySourceId,
  EnterpriseLeadKnowledgeCompatibilityAdapter,
} from './enterpriseLeadKnowledgeCompatibilityAdapter';

const profile = {
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
};

const documentItem = (
  overrides: Partial<KnowledgeDocumentListItem> = {},
): KnowledgeDocumentListItem => ({
  id: 'doc-1',
  displayName: 'Managed.pdf',
  sourceMode: KnowledgeDocumentSourceMode.Managed,
  currentVersionId: 'version-1',
  revision: 1,
  status: KnowledgeDocumentStatus.Pending,
  fileSize: 1024,
  mimeType: 'application/pdf',
  contentHash: 'a'.repeat(64),
  currentJob: {
    id: 'job-1',
    documentVersionId: 'version-1',
    stage: KnowledgeIngestionStage.Queued,
    status: KnowledgeIngestionJobStatus.Queued,
    progress: 0,
    errorCode: null,
    updatedAt: '2026-07-11T00:00:00.000Z',
  },
  localIndex: null,
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  deletedAt: null,
  ...overrides,
});

describe('EnterpriseLeadKnowledgeCompatibilityAdapter', () => {
  let db: Database.Database;
  let workspaceStore: EnterpriseLeadWorkspaceStore;
  let adapter: EnterpriseLeadKnowledgeCompatibilityAdapter;
  let workspaceId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    workspaceStore = new EnterpriseLeadWorkspaceStore(db);
    workspaceId = workspaceStore.createWorkspace({
      name: '兼容投影',
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile,
      extractionSources: [
        {
          id: 'legacy-a',
          kind: EnterpriseLeadExtractionSourceKind.Manual,
          label: '保留资料',
          text: 'legacy text',
        },
      ],
      enabledAgentRoles: [],
    }).id;
    adapter = new EnterpriseLeadKnowledgeCompatibilityAdapter(workspaceStore);
  });

  afterEach(() => {
    db.close();
  });

  test('projects display metadata and status without raw text or local paths', () => {
    adapter.upsertDocument(workspaceId, documentItem());

    const sources = workspaceStore.getWorkspace(workspaceId)?.extractionSources ?? [];
    expect(sources[0]).toMatchObject({ id: 'legacy-a', text: 'legacy text' });
    expect(sources[1]).toMatchObject({
      id: buildKnowledgeDocumentLegacySourceId('doc-1'),
      extractionStatus: EnterpriseLeadDocumentExtractionStatus.Pending,
      fileName: 'Managed.pdf',
      fileSize: 1024,
      kind: EnterpriseLeadExtractionSourceKind.File,
      label: 'Managed.pdf',
      vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
    });
    expect(sources[1]).not.toHaveProperty('text');
    expect(sources[1]).not.toHaveProperty('filePath');
  });

  test('maps processing, ready, no-text, and failed states without claiming indexed content', () => {
    const states = [
      [KnowledgeDocumentStatus.Processing, EnterpriseLeadDocumentExtractionStatus.Extracting],
      [KnowledgeDocumentStatus.Ready, EnterpriseLeadDocumentExtractionStatus.Extracted],
      [
        KnowledgeDocumentStatus.CompletedWithoutText,
        EnterpriseLeadDocumentExtractionStatus.Extracted,
      ],
      [KnowledgeDocumentStatus.Failed, EnterpriseLeadDocumentExtractionStatus.Failed],
    ] as const;

    for (const [status, extractionStatus] of states) {
      adapter.upsertDocument(
        workspaceId,
        documentItem({
          status,
          currentJob:
            status === KnowledgeDocumentStatus.Failed
              ? {
                  ...documentItem().currentJob!,
                  errorCode: 'parser_failed',
                  status: KnowledgeIngestionJobStatus.Failed,
                }
              : documentItem().currentJob,
        }),
      );
      const projected = workspaceStore
        .getWorkspace(workspaceId)
        ?.extractionSources.find(source => source.id === 'knowledge-document:doc-1');
      expect(projected?.extractionStatus).toBe(extractionStatus);
      expect(projected?.vectorIndexStatus).toBe(
        status === KnowledgeDocumentStatus.Failed
          ? EnterpriseLeadKnowledgeIndexStatus.Failed
          : EnterpriseLeadKnowledgeIndexStatus.Pending,
      );
      expect(projected?.extractionError).toBe(
        status === KnowledgeDocumentStatus.Failed ? 'parser_failed' : undefined,
      );
    }
  });

  test('removes a projected source when the normalized document is deleted', () => {
    adapter.upsertDocument(workspaceId, documentItem());

    adapter.upsertDocument(
      workspaceId,
      documentItem({ deletedAt: '2026-07-11T01:00:00.000Z', revision: 2 }),
    );

    expect(
      workspaceStore
        .getWorkspace(workspaceId)
        ?.extractionSources.some(source => source.id === 'knowledge-document:doc-1'),
    ).toBe(false);
    expect(workspaceStore.getWorkspace(workspaceId)?.extractionSources[0]?.id).toBe('legacy-a');
  });

  test('updates and deletes a migrated legacy source by its preserved identity', () => {
    const legacySourceSnapshot = {
      id: 'legacy-a',
      kind: EnterpriseLeadExtractionSourceKind.Manual,
      label: '保留资料',
      filePath: '/legacy/source.txt',
      text: 'legacy text',
      summary: '旧摘要',
      extractedKnowledgeKeys: ['companySummary'],
    };
    adapter.upsertDocument(workspaceId, documentItem(), {
      legacySourceId: 'legacy-a',
      legacySourceSnapshotJson: JSON.stringify(legacySourceSnapshot),
    });

    const projected = workspaceStore.getWorkspace(workspaceId)?.extractionSources ?? [];
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      id: 'legacy-a',
      label: 'Managed.pdf',
      filePath: '/legacy/source.txt',
      text: 'legacy text',
      summary: '旧摘要',
      extractedKnowledgeKeys: ['companySummary'],
    });

    adapter.upsertDocument(
      workspaceId,
      documentItem({ deletedAt: '2026-07-11T01:00:00.000Z', revision: 2 }),
      {
        legacySourceId: 'legacy-a',
        legacySourceSnapshotJson: JSON.stringify(legacySourceSnapshot),
      },
    );
    expect(workspaceStore.getWorkspace(workspaceId)?.extractionSources).toEqual([]);
  });

  test('uses the image legacy kind only for image MIME types', () => {
    adapter.upsertDocument(workspaceId, documentItem({ mimeType: 'image/png' }));
    const projected = workspaceStore
      .getWorkspace(workspaceId)
      ?.extractionSources.find(source => source.id === 'knowledge-document:doc-1');
    expect(projected?.kind).toBe(EnterpriseLeadExtractionSourceKind.Image);
  });
});
