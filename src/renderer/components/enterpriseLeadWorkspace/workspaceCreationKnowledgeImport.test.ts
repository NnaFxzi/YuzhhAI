import { describe, expect, test, vi } from 'vitest';

import {
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadWorkspaceType,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceProfile,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { buildDefaultEnterpriseLeadWorkspaceSettings } from '../../../shared/enterpriseLeadWorkspace/validation';
import {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
} from '../../../shared/knowledgeBase/constants';
import type { KnowledgeDocumentListItem, KnowledgeImportBatchResult, } from '../../../shared/knowledgeBase/types';
import { KnowledgeBaseServiceError } from '../../services/knowledgeBase';
import {
  createWorkspaceWithKnowledgeImports,
  type WorkspaceMaterialSelectionItem,
} from './workspaceCreationKnowledgeImport';

const emptyProfile = (): EnterpriseLeadWorkspaceProfile => ({
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
});

const draft = (): EnterpriseLeadWorkspaceDraft => ({
  name: '统一知识库',
  type: EnterpriseLeadWorkspaceType.EnterpriseLead,
  profile: emptyProfile(),
  source: {
    kind: EnterpriseLeadExtractionSourceKind.Manual,
    label: '创建工作空间',
  },
  extractionSources: [],
  enabledAgentRoles: [],
  settings: buildDefaultEnterpriseLeadWorkspaceSettings(),
  workspaceAgents: [],
});

const workspace = (): EnterpriseLeadWorkspace => ({
  id: 'workspace-a',
  name: '统一知识库',
  type: EnterpriseLeadWorkspaceType.EnterpriseLead,
  profile: emptyProfile(),
  extractionSources: [],
  riskRules: [],
  enabledAgentRoles: [],
  settings: buildDefaultEnterpriseLeadWorkspaceSettings(),
  workspaceAgents: [],
  recentRunId: null,
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
});

const selected = (
  itemId: string,
  displayName: string,
  selectionToken: string,
): WorkspaceMaterialSelectionItem => ({
  itemId,
  displayName,
  fileSize: 100,
  selectionToken,
});

const documentItem = (itemId: string, displayName: string): KnowledgeDocumentListItem => ({
  id: `document-${itemId}`,
  displayName,
  sourceMode: KnowledgeDocumentSourceMode.Managed,
  currentVersionId: `version-${itemId}`,
  revision: 1,
  status: KnowledgeDocumentStatus.Pending,
  fileSize: 100,
  mimeType: 'application/pdf',
  contentHash: itemId.padEnd(64, 'a'),
  currentJob: null,
  localIndex: null,
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  deletedAt: null,
});

const successfulBatch = (
  entries: Array<{ itemId: string; displayName: string }>,
): KnowledgeImportBatchResult => ({
  importedCount: entries.length,
  failedCount: 0,
  items: entries.map(entry => ({
    success: true,
    itemId: entry.itemId,
    document: documentItem(entry.itemId, entry.displayName),
  })),
});

describe('createWorkspaceWithKnowledgeImports', () => {
  test('creates the workspace before grouped normalized imports and preserves item order', async () => {
    const events: string[] = [];
    const createWorkspace = vi.fn(async () => {
      events.push('create');
      return workspace();
    });
    const importSelection = vi.fn(
      async (_workspaceId: string, selectionToken: string): Promise<KnowledgeImportBatchResult> => {
        events.push(`import:${selectionToken}`);
        if (selectionToken === 'token-b') {
          throw new KnowledgeBaseServiceError(KnowledgeBaseErrorCode.InvalidSelectionToken);
        }
        return successfulBatch([
          { itemId: 'item-a', displayName: 'a.pdf' },
          { itemId: 'item-c', displayName: 'c.pdf' },
        ]);
      },
    );
    const items = [
      selected('item-a', 'a.pdf', 'token-a'),
      selected('item-b', 'b.pdf', 'token-b'),
      selected('item-c', 'c.pdf', 'token-a'),
    ];

    const result = await createWorkspaceWithKnowledgeImports({
      draft: draft(),
      items,
      createWorkspace,
      importSelection,
    });

    expect(events[0]).toBe('create');
    expect(importSelection).toHaveBeenCalledTimes(2);
    expect(importSelection).toHaveBeenNthCalledWith(1, 'workspace-a', 'token-a', [
      'item-a',
      'item-c',
    ]);
    expect(importSelection).toHaveBeenNthCalledWith(2, 'workspace-a', 'token-b', ['item-b']);
    expect(result).toMatchObject({
      workspace: { id: 'workspace-a' },
      importResult: { importedCount: 2, failedCount: 1 },
    });
    expect(result?.importResult.items.map(item => item.itemId)).toEqual([
      'item-a',
      'item-b',
      'item-c',
    ]);
    expect(result?.importResult.items[1]).toEqual({
      success: false,
      itemId: 'item-b',
      fileName: 'b.pdf',
      errorCode: KnowledgeBaseErrorCode.InvalidSelectionToken,
    });
  });

  test('does not consume selections when workspace creation fails', async () => {
    const createWorkspace = vi.fn(async () => null);
    const importSelection = vi.fn();

    const result = await createWorkspaceWithKnowledgeImports({
      draft: draft(),
      items: [selected('item-a', 'a.pdf', 'token-a')],
      createWorkspace,
      importSelection,
    });

    expect(result).toBeNull();
    expect(importSelection).not.toHaveBeenCalled();
  });

  test('maps an unexpected batch failure to a display-safe persistence error', async () => {
    const result = await createWorkspaceWithKnowledgeImports({
      draft: draft(),
      items: [selected('item-a', 'a.pdf', 'token-a')],
      createWorkspace: vi.fn(async () => workspace()),
      importSelection: vi.fn(async () => {
        throw new Error('/private/secret/a.pdf');
      }),
    });

    expect(result?.importResult.items).toEqual([
      {
        success: false,
        itemId: 'item-a',
        fileName: 'a.pdf',
        errorCode: KnowledgeBaseErrorCode.PersistenceFailed,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('/private/secret');
  });
});
