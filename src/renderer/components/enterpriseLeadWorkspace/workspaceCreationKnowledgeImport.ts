import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceDraft,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { KnowledgeBaseErrorCode } from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeImportBatchResult,
  KnowledgeImportItemResult,
  KnowledgeSelectedFile,
} from '../../../shared/knowledgeBase/types';
import { KnowledgeBaseServiceError } from '../../services/knowledgeBase';

export interface WorkspaceMaterialSelectionItem extends KnowledgeSelectedFile {
  selectionToken: string;
}

interface WorkspaceMaterialSelectionGroup {
  selectionToken: string;
  items: WorkspaceMaterialSelectionItem[];
}

export interface CreateWorkspaceWithKnowledgeImportsInput {
  draft: EnterpriseLeadWorkspaceDraft;
  items: WorkspaceMaterialSelectionItem[];
  createWorkspace: (draft: EnterpriseLeadWorkspaceDraft) => Promise<EnterpriseLeadWorkspace | null>;
  importSelection: (
    workspaceId: string,
    selectionToken: string,
    itemIds: string[],
  ) => Promise<KnowledgeImportBatchResult>;
}

export interface CreateWorkspaceWithKnowledgeImportsResult {
  workspace: EnterpriseLeadWorkspace;
  importResult: KnowledgeImportBatchResult;
}

const groupSelections = (
  items: WorkspaceMaterialSelectionItem[],
): WorkspaceMaterialSelectionGroup[] => {
  const groups = new Map<string, WorkspaceMaterialSelectionItem[]>();
  for (const item of items) {
    const group = groups.get(item.selectionToken);
    if (group) {
      group.push(item);
    } else {
      groups.set(item.selectionToken, [item]);
    }
  }
  return Array.from(groups, ([selectionToken, groupItems]) => ({
    selectionToken,
    items: groupItems,
  }));
};

const toSafeFailure = (
  item: WorkspaceMaterialSelectionItem,
  errorCode: KnowledgeBaseErrorCode,
): KnowledgeImportItemResult => ({
  success: false,
  itemId: item.itemId,
  fileName: item.displayName,
  errorCode,
});

const getImportErrorCode = (error: unknown): KnowledgeBaseErrorCode =>
  error instanceof KnowledgeBaseServiceError
    ? error.code
    : KnowledgeBaseErrorCode.PersistenceFailed;

export const createWorkspaceWithKnowledgeImports = async ({
  draft,
  items,
  createWorkspace,
  importSelection,
}: CreateWorkspaceWithKnowledgeImportsInput): Promise<CreateWorkspaceWithKnowledgeImportsResult | null> => {
  const workspace = await createWorkspace(draft);
  if (!workspace) {
    return null;
  }

  const groups = groupSelections(items);
  const settledResults = await Promise.allSettled(
    groups.map(group =>
      importSelection(
        workspace.id,
        group.selectionToken,
        group.items.map(item => item.itemId),
      ),
    ),
  );
  const resultsByItemId = new Map<string, KnowledgeImportItemResult>();

  settledResults.forEach((settled, groupIndex) => {
    const group = groups[groupIndex];
    if (!group) {
      return;
    }
    if (settled.status === 'fulfilled') {
      settled.value.items.forEach(item => resultsByItemId.set(item.itemId, item));
      return;
    }
    const errorCode = getImportErrorCode(settled.reason);
    group.items.forEach(item => resultsByItemId.set(item.itemId, toSafeFailure(item, errorCode)));
  });

  const importItems = items.map(
    item =>
      resultsByItemId.get(item.itemId) ??
      toSafeFailure(item, KnowledgeBaseErrorCode.PersistenceFailed),
  );
  const importedCount = importItems.filter(item => item.success).length;

  return {
    workspace,
    importResult: {
      importedCount,
      failedCount: importItems.length - importedCount,
      items: importItems,
    },
  };
};
