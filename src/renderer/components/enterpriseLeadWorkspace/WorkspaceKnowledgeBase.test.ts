import fs from 'node:fs';

import { describe, expect, test, vi } from 'vitest';

import {
  EnterpriseLeadDocumentExtractionStatus,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadImageAttachmentExtensions,
  EnterpriseLeadKnowledgeIndexStatus,
  EnterpriseLeadSourceDocumentFileFilterExtensions,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadExtractionSource,
  EnterpriseLeadWorkspace,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { buildDefaultEnterpriseLeadWorkspaceSettings } from '../../../shared/enterpriseLeadWorkspace/validation';
import { KnowledgeFactDomain } from '../../../shared/knowledgeBase/constants';
import {
  buildEnterpriseKnowledgeKey,
  confirmEnterpriseProfileKnowledgeKey,
  ignoreEnterpriseProfileKnowledgeKey,
} from '../../../shared/knowledgeBase/enterpriseLeadProfileKnowledge';
import type { KnowledgeFactMetrics } from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import {
  EnterpriseLeadKnowledgeItemKind,
  EnterpriseLeadKnowledgeSection,
} from './enterpriseLeadWorkspaceUi';
import {
  canPreviewEnterpriseLeadOriginalDocument,
  canRetryEnterpriseLeadDocumentProcessing,
  confirmEnterpriseLeadKnowledgeItemInProfile,
  confirmEnterpriseLeadKnowledgeItemsInProfile,
  confirmEnterpriseLeadKnowledgeValueInProfile,
  doesEnterpriseLeadKnowledgeDocumentMatchQuery,
  doesEnterpriseLeadKnowledgeSourceNeedVectorSync,
  enterpriseLeadKnowledgeActionButtonClassNames,
  enterpriseLeadKnowledgeConfirmBehavior,
  enterpriseLeadKnowledgeDocumentHeaderClassName,
  enterpriseLeadKnowledgeDocumentHeaderLastClassName,
  enterpriseLeadKnowledgeHeaderCellClassName,
  enterpriseLeadKnowledgeInitialSelectedItemId,
  enterpriseLeadKnowledgeMessageAnimationClassName,
  enterpriseLeadKnowledgeMessageAutoDismissMs,
  enterpriseLeadKnowledgeMessageSuccessAccentClassName,
  enterpriseLeadKnowledgeMessageToneClassNames,
  EnterpriseLeadKnowledgeMetric,
  enterpriseLeadKnowledgeRowArchiveActionClassName,
  enterpriseLeadKnowledgeTableColumnClassNames,
  enterpriseLeadKnowledgeVectorIndexStatusClassNames,
  enterpriseLeadReadableDocumentExtensions,
  getEnterpriseLeadKnowledgeConfirmationKey,
  getEnterpriseLeadKnowledgeDeletionKeys,
  getEnterpriseLeadKnowledgeDocumentStatusDescription,
  getEnterpriseLeadKnowledgeMessageAutoDismissMs,
  getEnterpriseLeadKnowledgeMessageRole,
  getEnterpriseLeadKnowledgeMetricFilter,
  getEnterpriseLeadKnowledgePendingItemCount,
  getEnterpriseLeadKnowledgePendingItems,
  getEnterpriseLeadKnowledgeSelectedDeletionKeys,
  getEnterpriseLeadKnowledgeSelectedItemIdAfterViewChange,
  getEnterpriseLeadKnowledgeToolbarGridClassName,
  getEnterpriseLeadKnowledgeTouchedFields,
  getEnterpriseLeadKnowledgeVectorIndexStatus,
  getEnterpriseLeadKnowledgeVectorIndexSummary,
  getEnterpriseLeadNewExtractedKnowledgeKeys,
  ignoreEnterpriseLeadKnowledgeItemInProfile,
  isEnterpriseLeadDocumentProcessing,
  isEnterpriseLeadKnowledgeItemConfirmed,
  isEnterpriseLeadKnowledgeItemIgnored,
  isEnterpriseLeadKnowledgeSectionShownInAiKnowledgeTable,
  markEnterpriseLeadCompanyFieldTouched,
  mergeEnterpriseLeadProfileConflict,
  removeEnterpriseLeadKnowledgeKeysFromProfile,
  shouldShowEnterpriseLeadKnowledgeBatchConfirmAction,
  shouldShowEnterpriseLeadKnowledgeDetailPanel,
  shouldShowEnterpriseLeadKnowledgeSelectionToolbar,
  shouldShowEnterpriseLeadKnowledgeToolbarAddAction,
} from './WorkspaceKnowledgeBase';

const task8I18nKeys = [
  'enterpriseKnowledgeAiExtraction',
  'enterpriseKnowledgeAiExtractionStatusCancelled',
  'enterpriseKnowledgeAiExtractionStatusCompleted',
  'enterpriseKnowledgeAiExtractionStatusFailed',
  'enterpriseKnowledgeAiExtractionStatusNotStarted',
  'enterpriseKnowledgeAiExtractionStatusQueued',
  'enterpriseKnowledgeAiExtractionStatusReviewRequired',
  'enterpriseKnowledgeAiExtractionStatusRunning',
  'enterpriseKnowledgeAiExtractionStatusStale',
  'enterpriseKnowledgeAiExtractionStatusStalePriorVersion',
  'enterpriseKnowledgeCancelAiExtraction',
  'enterpriseKnowledgeExtractAiKnowledge',
  'enterpriseKnowledgeExtractCurrentVersion',
  'enterpriseKnowledgeExtractionAuthorizationDescription',
  'enterpriseKnowledgeExtractionAuthorizationDocument',
  'enterpriseKnowledgeExtractionAuthorizationExpiresAt',
  'enterpriseKnowledgeExtractionAuthorizationModel',
  'enterpriseKnowledgeExtractionAuthorizationPartialWarning',
  'enterpriseKnowledgeExtractionAuthorizationPlannedCalls',
  'enterpriseKnowledgeExtractionAuthorizationPreparing',
  'enterpriseKnowledgeExtractionAuthorizationProvider',
  'enterpriseKnowledgeExtractionAuthorizationSend',
  'enterpriseKnowledgeExtractionAuthorizationSending',
  'enterpriseKnowledgeExtractionAuthorizationTitle',
  'enterpriseKnowledgeRetryAiExtraction',
  'enterpriseAiKnowledgeColumnActions',
  'enterpriseAiKnowledgeColumnDomain',
  'enterpriseAiKnowledgeColumnEvidence',
  'enterpriseAiKnowledgeColumnSource',
  'enterpriseAiKnowledgeColumnStatus',
  'enterpriseAiKnowledgeColumnValue',
  'enterpriseAiKnowledgeDomainApplicationScenarios',
  'enterpriseAiKnowledgeDomainChannelPreferences',
  'enterpriseAiKnowledgeDomainCompanySummary',
  'enterpriseAiKnowledgeDomainContactRules',
  'enterpriseAiKnowledgeDomainMissingInfo',
  'enterpriseAiKnowledgeDomainProductCapabilities',
  'enterpriseAiKnowledgeDomainProductList',
  'enterpriseAiKnowledgeDomainProhibitedClaims',
  'enterpriseAiKnowledgeDomainSellingPoints',
  'enterpriseAiKnowledgeDomainTargetCustomers',
  'enterpriseAiKnowledgeEmptyActive',
  'enterpriseAiKnowledgeEmptyHistory',
  'enterpriseAiKnowledgeEndOfList',
  'enterpriseAiKnowledgeEvidenceActive',
  'enterpriseAiKnowledgeEvidenceAny',
  'enterpriseAiKnowledgeEvidenceFilterLabel',
  'enterpriseAiKnowledgeEvidenceStale',
  'enterpriseAiKnowledgeLegacyNoEvidence',
  'enterpriseAiKnowledgeLegacyReadOnly',
  'enterpriseAiKnowledgeLegacySource',
  'enterpriseAiKnowledgeLoadFailed',
  'enterpriseAiKnowledgeLoadMore',
  'enterpriseAiKnowledgeLoading',
  'enterpriseAiKnowledgeLoadingMore',
  'enterpriseAiKnowledgeLoadingStatus',
  'enterpriseAiKnowledgeMaintainCompany',
  'enterpriseAiKnowledgePartialLoadFailed',
  'enterpriseAiKnowledgeRetryInitial',
  'enterpriseAiKnowledgeRetryPartial',
  'enterpriseAiKnowledgeReviewFilterLabel',
  'enterpriseAiKnowledgeSourceExtracted',
  'enterpriseAiKnowledgeSourceImported',
  'enterpriseAiKnowledgeSourceManual',
  'enterpriseAiKnowledgeStatusArchived',
  'enterpriseAiKnowledgeStatusConfirmed',
  'enterpriseAiKnowledgeStatusPending',
  'enterpriseAiKnowledgeStatusRejected',
  'enterpriseAiKnowledgeTableCaption',
  'enterpriseAiKnowledgeViewActive',
  'enterpriseAiKnowledgeViewHistory',
  'enterpriseAiKnowledgeViewLabel',
  'enterpriseAiKnowledgeArchive',
  'enterpriseAiKnowledgeArchiveConflictDescription',
  'enterpriseAiKnowledgeArchiveConflictTitle',
  'enterpriseAiKnowledgeArchiveKeepCurrent',
  'enterpriseAiKnowledgeArchiveLedgerlessDescription',
  'enterpriseAiKnowledgeArchiveRemoveCurrent',
  'enterpriseAiKnowledgeCompanyConflictDescription',
  'enterpriseAiKnowledgeCompanyConflictTitle',
  'enterpriseAiKnowledgeCompanyReplace',
  'enterpriseAiKnowledgeConfirm',
  'enterpriseAiKnowledgeConfirmRequiresActiveEvidence',
  'enterpriseAiKnowledgeDialogCancel',
  'enterpriseAiKnowledgeEvidenceActiveState',
  'enterpriseAiKnowledgeEvidenceCollapse',
  'enterpriseAiKnowledgeEvidenceConfidence',
  'enterpriseAiKnowledgeEvidenceEmpty',
  'enterpriseAiKnowledgeEvidenceEnd',
  'enterpriseAiKnowledgeEvidenceExpand',
  'enterpriseAiKnowledgeEvidenceLoadFailed',
  'enterpriseAiKnowledgeEvidenceLoadMore',
  'enterpriseAiKnowledgeEvidenceLoading',
  'enterpriseAiKnowledgeEvidenceLoadingMore',
  'enterpriseAiKnowledgeEvidenceLoadingStatus',
  'enterpriseAiKnowledgeEvidencePreview',
  'enterpriseAiKnowledgeEvidenceRetry',
  'enterpriseAiKnowledgeEvidenceStaleState',
  'enterpriseAiKnowledgeEvidenceStateConflict',
  'enterpriseAiKnowledgeEvidenceUnknownTime',
  'enterpriseAiKnowledgeMutationDisabledReason',
  'enterpriseAiKnowledgeMutationFailed',
  'enterpriseAiKnowledgeMutationLiveStatus',
  'enterpriseAiKnowledgeMutationStale',
  'enterpriseAiKnowledgeMutationSubmitting',
  'enterpriseAiKnowledgeMutationSucceeded',
  'enterpriseAiKnowledgePanelFocusAnchor',
  'enterpriseAiKnowledgeReject',
] as const;

const createProfileWorkspaceForTest = (
  id = 'workspace-a',
  profileRevision = 4,
): EnterpriseLeadWorkspace => ({
  id,
  name: `Workspace ${id}`,
  type: 'enterprise_lead',
  profile: {
    companySummary: 'Original summary',
    productList: ['Original product'],
    productCapabilities: [],
    targetCustomers: [],
    applicationScenarios: [],
    sellingPoints: [],
    channelPreferences: [],
    prohibitedClaims: [],
    contactRules: [],
    missingInfo: [],
  },
  profileRevision,
  extractionSources: [],
  riskRules: [],
  enabledAgentRoles: [],
  settings: buildDefaultEnterpriseLeadWorkspaceSettings(),
  workspaceAgents: [],
  recentRunId: null,
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: `2026-07-12T0${Math.min(profileRevision, 9)}:00:00.000Z`,
});

const createDeferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} => {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
};

describe('WorkspaceKnowledgeBase layout', () => {
  test('mounts normalized document management without renderer path reads', () => {
    const source = fs.readFileSync(
      new URL('./WorkspaceKnowledgeBase.tsx', import.meta.url),
      'utf8',
    );
    const indexSource = fs.readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain('WorkspaceKnowledgeDocumentsPanel');
    expect(source).toContain('workspaceId={currentWorkspace.id}');
    expect(source).toContain('initialImportResult={pendingInitialImportResult}');
    expect(source).toContain('onInitialImportResultConsumed');
    expect(source).toContain('setPendingInitialImportResult(undefined)');
    expect(source).toContain('normalizedDocumentCount ?? documentRows.length');
    expect(source).toContain('onDocumentCountChange={setNormalizedDocumentCount}');
    expect(source).toContain('onWorkspaceProjectionChange={handleWorkspaceProjectionChange}');
    expect(source).toContain('<WorkspaceAiKnowledgePanel');
    expect(source).toContain('profileRevision={currentWorkspace.profileRevision}');
    expect(source).toContain('profile={currentWorkspace.profile}');
    expect(source).toContain('onMaintainCompany={openCompanyModal}');
    expect(source).toContain('onProjectionRefresh={handleAiKnowledgeProjectionRefresh}');
    expect(source).toContain('workspaceProjectionMountedRef.current');
    expect(source).toContain('workspacePropRef.current === workspacePropAtRequest');
    expect(source).not.toContain('resolveEnterpriseLeadKnowledgeDocumentUpload');
    expect(source).not.toContain('window.electron.dialog');
    expect(source).not.toContain('knowledge_readonly');
    expect(source).not.toContain('enterpriseLeadKnowledgeFilterReadonly');
    expect(source).not.toContain('normalizeKnowledgeConfirmationText');
    expect(source).not.toContain('setSearchQuery');
    expect(source).not.toContain('setStatusFilter');
    expect(source).not.toContain('setSelectedKnowledgeItemIds');
    expect(source).not.toContain("setModalMode('item')");
    expect(source).not.toContain("setModalMode('deleteKnowledgeBatch')");
    expect(source).toContain('new Set<KnowledgeFactDomain>');
    expect(indexSource).toContain("export { WorkspaceAiKnowledgePanel } from './WorkspaceAiKnowledgePanel';");
  });

  test('derives all top AI metrics from one backend metric snapshot', async () => {
    type GetMetricValues = (metrics: KnowledgeFactMetrics) => {
      aiKnowledgeCount: number;
      pendingCount: number;
      confirmedCount: number;
    };
    const module = await import('./WorkspaceKnowledgeBase');
    const getMetricValues = (
      module as unknown as {
        getEnterpriseLeadAiKnowledgeMetricValues?: GetMetricValues;
      }
    ).getEnterpriseLeadAiKnowledgeMetricValues;

    expect(getMetricValues).toEqual(expect.any(Function));
    if (!getMetricValues) {
      return;
    }

    expect(
      getMetricValues({
        activePendingCount: 2,
        activeConfirmedCount: 3,
        staleConfirmedCount: 5,
        rejectedHistoryCount: 7,
        archivedHistoryCount: 11,
        unduplicatedLegacyConfirmedCount: 13,
        totalAiKnowledgeCount: 17,
      }),
    ).toEqual({
      aiKnowledgeCount: 17,
      pendingCount: 2,
      confirmedCount: 21,
    });
  });

  test('accepts only the current safe AI projection refresh owner', async () => {
    type IsCurrentRefresh = (input: {
      request: unknown;
      requestGeneration: number;
      currentRequestGeneration: number;
      mounted: boolean;
      latestWorkspaceProp: Pick<EnterpriseLeadWorkspace, 'id' | 'profileRevision'>;
      currentWorkspace: Pick<EnterpriseLeadWorkspace, 'id' | 'profileRevision'>;
    }) => boolean;
    const module = await import('./WorkspaceKnowledgeBase');
    const isCurrentRefresh = (
      module as unknown as {
        isEnterpriseLeadAiProjectionRefreshRequestCurrent?: IsCurrentRefresh;
      }
    ).isEnterpriseLeadAiProjectionRefreshRequestCurrent;

    expect(isCurrentRefresh).toEqual(expect.any(Function));
    if (!isCurrentRefresh) {
      return;
    }

    const current = {
      request: { workspaceId: 'workspace-a', profileRevision: 4 },
      requestGeneration: 3,
      currentRequestGeneration: 3,
      mounted: true,
      latestWorkspaceProp: { id: 'workspace-a', profileRevision: 4 },
      currentWorkspace: { id: 'workspace-a', profileRevision: 4 },
    };
    expect(isCurrentRefresh(current)).toBe(true);
    expect(isCurrentRefresh({ ...current, mounted: false })).toBe(false);
    expect(isCurrentRefresh({ ...current, currentRequestGeneration: 4 })).toBe(false);
    expect(isCurrentRefresh({ ...current, request: null })).toBe(false);
    expect(
      isCurrentRefresh({
        ...current,
        request: { workspaceId: 'workspace-b', profileRevision: 4 },
      }),
    ).toBe(false);
    expect(
      isCurrentRefresh({
        ...current,
        request: { workspaceId: 'workspace-a', profileRevision: 0 },
      }),
    ).toBe(false);
    expect(
      isCurrentRefresh({
        ...current,
        request: { workspaceId: 'workspace-a', profileRevision: Number.MAX_SAFE_INTEGER + 1 },
      }),
    ).toBe(false);
    expect(
      isCurrentRefresh({
        ...current,
        request: { workspaceId: 'workspace-a', profileRevision: 3 },
      }),
    ).toBe(false);
    expect(
      isCurrentRefresh({
        ...current,
        latestWorkspaceProp: { id: 'workspace-b', profileRevision: 4 },
      }),
    ).toBe(false);
    expect(
      isCurrentRefresh({
        ...current,
        currentWorkspace: { id: 'workspace-b', profileRevision: 4 },
      }),
    ).toBe(false);
  });

  test('loads and publishes only a current workspace meeting the AI mutation minimum revision', async () => {
    type RefreshAiProjection = (input: {
      request: { workspaceId: string; profileRevision: number };
      loadWorkspace: (workspaceId: string) => Promise<EnterpriseLeadWorkspace | null>;
      isCurrent: () => boolean;
      onWorkspaceUpdated: (workspace: EnterpriseLeadWorkspace) => void;
    }) => Promise<EnterpriseLeadWorkspace | null>;
    const module = await import('./WorkspaceKnowledgeBase');
    const refreshAiProjection = (
      module as unknown as {
        refreshWorkspaceAfterAiKnowledgeProjectionMutation?: RefreshAiProjection;
      }
    ).refreshWorkspaceAfterAiKnowledgeProjectionMutation;

    expect(refreshAiProjection).toEqual(expect.any(Function));
    if (!refreshAiProjection) {
      return;
    }

    const request = { workspaceId: 'workspace-a', profileRevision: 5 };
    const acceptedWorkspace = createProfileWorkspaceForTest('workspace-a', 6);
    const onWorkspaceUpdated = vi.fn();
    const loadWorkspace = vi.fn().mockResolvedValue(acceptedWorkspace);
    await expect(
      refreshAiProjection({
        request,
        loadWorkspace,
        isCurrent: () => true,
        onWorkspaceUpdated,
      }),
    ).resolves.toBe(acceptedWorkspace);
    expect(loadWorkspace).toHaveBeenCalledWith('workspace-a');
    expect(onWorkspaceUpdated).toHaveBeenCalledWith(acceptedWorkspace);

    for (const rejectedWorkspace of [
      null,
      createProfileWorkspaceForTest('workspace-b', 6),
      createProfileWorkspaceForTest('workspace-a', 4),
    ]) {
      const rejectedPublish = vi.fn();
      await expect(
        refreshAiProjection({
          request,
          loadWorkspace: vi.fn().mockResolvedValue(rejectedWorkspace),
          isCurrent: () => true,
          onWorkspaceUpdated: rejectedPublish,
        }),
      ).resolves.toBeNull();
      expect(rejectedPublish).not.toHaveBeenCalled();
    }

    const pending = createDeferred<EnterpriseLeadWorkspace | null>();
    let isCurrent = true;
    const stalePublish = vi.fn();
    const staleRefresh = refreshAiProjection({
      request,
      loadWorkspace: () => pending.promise,
      isCurrent: () => isCurrent,
      onWorkspaceUpdated: stalePublish,
    });
    isCurrent = false;
    pending.resolve(acceptedWorkspace);
    await expect(staleRefresh).resolves.toBeNull();
    expect(stalePublish).not.toHaveBeenCalled();

    const olderLoad = createDeferred<EnterpriseLeadWorkspace | null>();
    const newerLoad = createDeferred<EnterpriseLeadWorkspace | null>();
    const olderPublish = vi.fn();
    const newerPublish = vi.fn();
    let currentGeneration = 1;
    const olderRefresh = refreshAiProjection({
      request: { workspaceId: 'workspace-a', profileRevision: 5 },
      loadWorkspace: () => olderLoad.promise,
      isCurrent: () => currentGeneration === 1,
      onWorkspaceUpdated: olderPublish,
    });

    currentGeneration = 2;
    const newerWorkspace = createProfileWorkspaceForTest('workspace-a', 6);
    const newerRefresh = refreshAiProjection({
      request: { workspaceId: 'workspace-a', profileRevision: 6 },
      loadWorkspace: () => newerLoad.promise,
      isCurrent: () => currentGeneration === 2,
      onWorkspaceUpdated: newerPublish,
    });

    newerLoad.resolve(newerWorkspace);
    await expect(newerRefresh).resolves.toBe(newerWorkspace);
    expect(newerPublish).toHaveBeenCalledWith(newerWorkspace);

    olderLoad.resolve(createProfileWorkspaceForTest('workspace-a', 5));
    await expect(olderRefresh).resolves.toBeNull();
    expect(olderPublish).not.toHaveBeenCalled();
  });

  test('publishes only the current workspace projection after a document mutation', async () => {
    type RefreshWorkspaceProjection = (input: {
      workspaceId: string;
      loadWorkspace: (workspaceId: string) => Promise<EnterpriseLeadWorkspace | null>;
      isCurrent: () => boolean;
      onWorkspaceUpdated: (workspace: EnterpriseLeadWorkspace) => void;
    }) => Promise<EnterpriseLeadWorkspace | null>;
    const module = await import('./WorkspaceKnowledgeBase');
    const refreshWorkspaceProjection = (
      module as unknown as {
        refreshWorkspaceAfterKnowledgeDocumentMutation?: RefreshWorkspaceProjection;
      }
    ).refreshWorkspaceAfterKnowledgeDocumentMutation;

    expect(refreshWorkspaceProjection).toEqual(expect.any(Function));
    if (!refreshWorkspaceProjection) {
      return;
    }

    const updatedWorkspace: EnterpriseLeadWorkspace = {
      id: 'workspace-a',
      name: '统一知识库',
      type: 'enterprise_lead',
      profile: {
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
      },
      profileRevision: 2,
      extractionSources: [
        {
          id: 'knowledge-document:document-a',
          kind: EnterpriseLeadExtractionSourceKind.File,
          label: '追加资料.pdf',
          fileName: '追加资料.pdf',
        },
      ],
      riskRules: [],
      enabledAgentRoles: [],
      settings: buildDefaultEnterpriseLeadWorkspaceSettings(),
      workspaceAgents: [],
      recentRunId: null,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T01:00:00.000Z',
    };
    const loadWorkspace = vi.fn(async () => updatedWorkspace);
    const onWorkspaceUpdated = vi.fn();

    await expect(
      refreshWorkspaceProjection({
        workspaceId: updatedWorkspace.id,
        loadWorkspace,
        isCurrent: () => true,
        onWorkspaceUpdated,
      }),
    ).resolves.toBe(updatedWorkspace);
    expect(loadWorkspace).toHaveBeenCalledWith(updatedWorkspace.id);
    expect(onWorkspaceUpdated).toHaveBeenCalledWith(updatedWorkspace);

    loadWorkspace.mockClear();
    onWorkspaceUpdated.mockClear();
    await expect(
      refreshWorkspaceProjection({
        workspaceId: updatedWorkspace.id,
        loadWorkspace,
        isCurrent: () => false,
        onWorkspaceUpdated,
      }),
    ).resolves.toBeNull();
    expect(loadWorkspace).not.toHaveBeenCalled();
    expect(onWorkspaceUpdated).not.toHaveBeenCalled();

    let resolveWorkspace!: (workspace: EnterpriseLeadWorkspace | null) => void;
    const deferredWorkspace = new Promise<EnterpriseLeadWorkspace | null>(resolve => {
      resolveWorkspace = resolve;
    });
    let isCurrent = true;
    const deferredUpdate = vi.fn();
    const pendingRefresh = refreshWorkspaceProjection({
      workspaceId: updatedWorkspace.id,
      loadWorkspace: async () => deferredWorkspace,
      isCurrent: () => isCurrent,
      onWorkspaceUpdated: deferredUpdate,
    });

    isCurrent = false;
    resolveWorkspace(updatedWorkspace);

    await expect(pendingRefresh).resolves.toBeNull();
    expect(deferredUpdate).not.toHaveBeenCalled();
  });

  const getPercent = (className: string): number => {
    const match = /^w-\[(\d+)%\]$/.exec(className);
    return match ? Number.parseInt(match[1] ?? '0', 10) : 0;
  };

  test('allocates a stable expanded action column for the AI knowledge table', () => {
    expect(Object.keys(enterpriseLeadKnowledgeTableColumnClassNames)).toEqual([
      'knowledge',
      'category',
      'status',
      'actions',
    ]);

    const widths = Object.values(enterpriseLeadKnowledgeTableColumnClassNames).map(getPercent);

    expect(enterpriseLeadKnowledgeTableColumnClassNames.knowledge).toBe('w-[50%]');
    expect(enterpriseLeadKnowledgeTableColumnClassNames.category).toBe('w-[18%]');
    expect(enterpriseLeadKnowledgeTableColumnClassNames.status).toBe('w-[16%]');
    expect(enterpriseLeadKnowledgeTableColumnClassNames.actions).toBe('w-[16%]');
    expect(widths.reduce((total, width) => total + width, 0)).toBe(100);
  });

  test('uses compact expanded text action buttons in the AI knowledge table', () => {
    const actionButtonClassNames = Object.values(enterpriseLeadKnowledgeActionButtonClassNames);

    expect(actionButtonClassNames).toHaveLength(2);
    actionButtonClassNames.forEach(className => {
      expect(className).toContain('min-w-[54px]');
      expect(className).toContain('gap-1');
      expect(className).not.toContain('w-8 ');
    });
  });

  test('keeps add document as a single top-level action on the document view', () => {
    expect(shouldShowEnterpriseLeadKnowledgeToolbarAddAction('documents')).toBe(false);
    expect(shouldShowEnterpriseLeadKnowledgeToolbarAddAction('knowledge')).toBe(true);
    expect(getEnterpriseLeadKnowledgeToolbarGridClassName('documents')).toContain(
      'md:grid-cols-[minmax(0,1fr)_180px]',
    );
    expect(getEnterpriseLeadKnowledgeToolbarGridClassName('knowledge')).toContain(
      'md:grid-cols-[minmax(0,1fr)_180px_auto_auto]',
    );
  });

  test('matches document search against source file metadata and extracted body', () => {
    const item = {
      id: 'source-0',
      kind: EnterpriseLeadKnowledgeItemKind.Source,
      metaText: '本地文件',
      secondaryText: '启盛制造',
      text: '客户资料',
    };
    const source = {
      kind: 'file',
      label: '客户资料',
      fileName: 'OEM-pricing.pdf',
      filePath: '/Users/demo/Documents/OEM-pricing.pdf',
      summary: '华东客户年度报价资料',
      text: '最小起订量 5000 件',
    };

    expect(doesEnterpriseLeadKnowledgeDocumentMatchQuery(item, source, 'oem-pricing')).toBe(true);
    expect(doesEnterpriseLeadKnowledgeDocumentMatchQuery(item, source, '华东客户')).toBe(true);
    expect(doesEnterpriseLeadKnowledgeDocumentMatchQuery(item, source, '5000')).toBe(true);
    expect(doesEnterpriseLeadKnowledgeDocumentMatchQuery(item, source, '不存在')).toBe(false);
  });

  test('previews rich source files as original documents when a local path exists', () => {
    expect(
      canPreviewEnterpriseLeadOriginalDocument({
        filePath: '/Users/demo/Documents/product.docx',
      }),
    ).toBe(true);
    expect(
      canPreviewEnterpriseLeadOriginalDocument({
        fileName: '手动资料.docx',
      }),
    ).toBe(false);
  });

  test('previews image source files when a local path exists', () => {
    expect(
      canPreviewEnterpriseLeadOriginalDocument({
        filePath: '/Users/demo/Documents/product.png',
      }),
    ).toBe(true);
    expect(
      canPreviewEnterpriseLeadOriginalDocument({
        filePath: '/Users/demo/Documents/photo.JPG',
      }),
    ).toBe(true);
    expect(
      canPreviewEnterpriseLeadOriginalDocument({
        fileName: 'logo.svg',
      }),
    ).toBe(false);
  });

  test('persists workspace profile when confirming AI knowledge into the library', () => {
    expect(enterpriseLeadKnowledgeConfirmBehavior.persistProfile).toBe(true);
    expect(enterpriseLeadKnowledgeConfirmBehavior.successMessageKey).toBe(
      'enterpriseLeadKnowledgeItemConfirmed',
    );
  });

  test('marks a confirmed AI knowledge item in profile and removes it from pending count', () => {
    const profile = {
      companySummary: '',
      productList: ['重型纸箱'],
      productCapabilities: [],
      targetCustomers: [],
      applicationScenarios: [],
      sellingPoints: [],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
    };
    const item = {
      id: 'product-0',
      kind: EnterpriseLeadKnowledgeItemKind.Product,
      text: '重型纸箱',
    };

    expect(getEnterpriseLeadKnowledgePendingItemCount(profile, [item])).toBe(1);

    const confirmedProfile = confirmEnterpriseLeadKnowledgeItemInProfile(profile, item);

    expect(confirmedProfile).not.toBe(profile);
    expect(confirmedProfile.confirmedKnowledgeKeys).toEqual([
      getEnterpriseLeadKnowledgeConfirmationKey(item),
    ]);
    expect(isEnterpriseLeadKnowledgeItemConfirmed(confirmedProfile, item)).toBe(true);
    expect(getEnterpriseLeadKnowledgePendingItemCount(confirmedProfile, [item])).toBe(0);
  });

  test('delegates canonical trust-key behavior to the shared Profile helpers', () => {
    const item = {
      id: 'product-0',
      kind: EnterpriseLeadKnowledgeItemKind.Product,
      text: '  Lead   RADAR  ',
    };
    const profile = {
      companySummary: '',
      productList: ['Lead Radar'],
      productCapabilities: [],
      targetCustomers: [],
      applicationScenarios: [],
      sellingPoints: [],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
    };
    const key = buildEnterpriseKnowledgeKey(KnowledgeFactDomain.ProductList, item.text);

    expect(confirmEnterpriseLeadKnowledgeItemInProfile(profile, item)).toEqual(
      confirmEnterpriseProfileKnowledgeKey(profile, key),
    );
    expect(ignoreEnterpriseLeadKnowledgeItemInProfile(profile, item).ignoredKnowledgeKeys).toEqual(
      ignoreEnterpriseProfileKnowledgeKey(profile, key).ignoredKnowledgeKeys,
    );
  });

  test('deduplicates exact touched domains for single and batch Profile actions', () => {
    const items = [
      { id: 'product-0', kind: EnterpriseLeadKnowledgeItemKind.Product, text: 'A' },
      { id: 'product-1', kind: EnterpriseLeadKnowledgeItemKind.Product, text: 'B' },
      { id: 'selling-point-0', kind: EnterpriseLeadKnowledgeItemKind.SellingPoint, text: 'C' },
      { id: 'source-0', kind: EnterpriseLeadKnowledgeItemKind.Source, text: 'Read only' },
    ];

    expect(getEnterpriseLeadKnowledgeTouchedFields(items)).toEqual([
      KnowledgeFactDomain.ProductList,
      KnowledgeFactDomain.SellingPoints,
    ]);
  });

  test('keeps a company field touched after editing it back to its original value', () => {
    const first = markEnterpriseLeadCompanyFieldTouched(
      new Set(),
      KnowledgeFactDomain.CompanySummary,
    );
    const restored = markEnterpriseLeadCompanyFieldTouched(
      first,
      KnowledgeFactDomain.CompanySummary,
    );

    expect(restored).toEqual(new Set([KnowledgeFactDomain.CompanySummary]));
    expect(restored).not.toBe(first);
  });

  test('merges only a current non-regressing safe conflict snapshot and preserves settings', () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.model.providers.private = {
      enabled: true,
      apiKey: 'sk-local-only',
      baseUrl: 'https://local-only.test/v1',
      models: [],
    };
    const current: EnterpriseLeadWorkspace = {
      id: 'workspace-a',
      name: 'Local workspace',
      type: 'enterprise_lead',
      profile: {
        companySummary: 'Old',
        productList: [],
        productCapabilities: [],
        targetCustomers: [],
        applicationScenarios: [],
        sellingPoints: [],
        channelPreferences: [],
        prohibitedClaims: [],
        contactRules: [],
        missingInfo: [],
      },
      profileRevision: 4,
      extractionSources: [{ kind: 'file', label: 'local only', filePath: '/private/local' }],
      riskRules: [],
      enabledAgentRoles: [],
      settings,
      workspaceAgents: [],
      recentRunId: null,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T04:00:00.000Z',
    };
    const latest = {
      id: 'workspace-a',
      profile: { ...current.profile, companySummary: 'Latest' },
      profileRevision: 5,
      updatedAt: '2026-07-12T05:00:00.000Z',
    };

    const merged = mergeEnterpriseLeadProfileConflict(current, 'workspace-a', latest);
    expect(merged).toEqual({
      ...current,
      profile: latest.profile,
      profileRevision: 5,
      updatedAt: latest.updatedAt,
    });
    expect(merged?.settings).toBe(settings);
    expect(merged?.extractionSources).toBe(current.extractionSources);
    expect(mergeEnterpriseLeadProfileConflict(current, 'workspace-b', latest)).toBeNull();
    expect(mergeEnterpriseLeadProfileConflict(current, 'workspace-a', {
      ...latest,
      profileRevision: 3,
    })).toBeNull();
    expect(mergeEnterpriseLeadProfileConflict(current, 'workspace-a', {
      ...latest,
      id: 'workspace-b',
    })).toBeNull();
  });

  test('preserves a dirty company draft across same-revision projection refreshes', async () => {
    type ReconcileCompanyDraft = (input: {
      currentWorkspace: EnterpriseLeadWorkspace;
      incomingWorkspace: EnterpriseLeadWorkspace;
      companyDraft: Record<KnowledgeFactDomain, string>;
      touchedFields: ReadonlySet<KnowledgeFactDomain>;
    }) => {
      workspace: EnterpriseLeadWorkspace;
      companyDraft: Record<KnowledgeFactDomain, string>;
      touchedFields: ReadonlySet<KnowledgeFactDomain>;
      resetDraft: boolean;
    };
    const module = await import('./WorkspaceKnowledgeBase');
    const reconcileCompanyDraft = (
      module as unknown as {
        reconcileEnterpriseLeadCompanyDraftWorkspaceRefresh?: ReconcileCompanyDraft;
      }
    ).reconcileEnterpriseLeadCompanyDraftWorkspaceRefresh;

    expect(reconcileCompanyDraft).toEqual(expect.any(Function));
    if (!reconcileCompanyDraft) {
      return;
    }

    const currentWorkspace = createProfileWorkspaceForTest();
    const companyDraft: Record<KnowledgeFactDomain, string> = {
      companySummary: 'Unsaved local edit',
      productList: 'Original product',
      productCapabilities: '',
      targetCustomers: '',
      applicationScenarios: '',
      sellingPoints: '',
      channelPreferences: '',
      prohibitedClaims: '',
      contactRules: '',
      missingInfo: '',
    };
    const touchedFields = new Set<KnowledgeFactDomain>([KnowledgeFactDomain.CompanySummary]);
    const projectionRefresh: EnterpriseLeadWorkspace = {
      ...currentWorkspace,
      extractionSources: [
        {
          id: 'knowledge-document:source-a',
          kind: EnterpriseLeadExtractionSourceKind.File,
          label: 'Fresh projection.pdf',
          vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexed,
        },
      ],
    };

    const sameRevision = reconcileCompanyDraft({
      currentWorkspace,
      incomingWorkspace: projectionRefresh,
      companyDraft,
      touchedFields,
    });

    expect(sameRevision.workspace).toBe(projectionRefresh);
    expect(sameRevision.companyDraft).toBe(companyDraft);
    expect(sameRevision.touchedFields).toBe(touchedFields);
    expect(sameRevision.resetDraft).toBe(false);

    const lowerRevision = reconcileCompanyDraft({
      currentWorkspace,
      incomingWorkspace: {
        ...projectionRefresh,
        profileRevision: currentWorkspace.profileRevision - 1,
      },
      companyDraft,
      touchedFields,
    });

    expect(lowerRevision.workspace).toBe(currentWorkspace);
    expect(lowerRevision.companyDraft).toBe(companyDraft);
    expect(lowerRevision.touchedFields).toBe(touchedFields);
    expect(lowerRevision.resetDraft).toBe(false);

    const refreshedProfile = reconcileCompanyDraft({
      currentWorkspace,
      incomingWorkspace: {
        ...projectionRefresh,
        profile: {
          ...projectionRefresh.profile,
          companySummary: 'Server profile refresh',
        },
        profileRevision: currentWorkspace.profileRevision + 1,
      },
      companyDraft,
      touchedFields,
    });

    expect(refreshedProfile.companyDraft.companySummary).toBe('Server profile refresh');
    expect(refreshedProfile.touchedFields).toEqual(new Set());
    expect(refreshedProfile.resetDraft).toBe(true);
  });

  test('blocks company draft edits while a profile save is in flight', async () => {
    type UpdateCompanyDraft = (input: {
      isSaving: boolean;
      field: KnowledgeFactDomain;
      value: string;
      companyDraft: Record<KnowledgeFactDomain, string>;
      touchedFields: ReadonlySet<KnowledgeFactDomain>;
    }) => {
      companyDraft: Record<KnowledgeFactDomain, string>;
      touchedFields: ReadonlySet<KnowledgeFactDomain>;
    };
    const module = await import('./WorkspaceKnowledgeBase');
    const updateCompanyDraft = (
      module as unknown as {
        updateEnterpriseLeadCompanyDraftField?: UpdateCompanyDraft;
      }
    ).updateEnterpriseLeadCompanyDraftField;

    expect(updateCompanyDraft).toEqual(expect.any(Function));
    if (!updateCompanyDraft) {
      return;
    }

    const companyDraft: Record<KnowledgeFactDomain, string> = {
      companySummary: 'Original',
      productList: '',
      productCapabilities: '',
      targetCustomers: '',
      applicationScenarios: '',
      sellingPoints: '',
      channelPreferences: '',
      prohibitedClaims: '',
      contactRules: '',
      missingInfo: '',
    };
    const touchedFields = new Set<KnowledgeFactDomain>();
    const blocked = updateCompanyDraft({
      isSaving: true,
      field: KnowledgeFactDomain.CompanySummary,
      value: 'Late edit',
      companyDraft,
      touchedFields,
    });

    expect(blocked.companyDraft).toBe(companyDraft);
    expect(blocked.touchedFields).toBe(touchedFields);

    const accepted = updateCompanyDraft({
      isSaving: false,
      field: KnowledgeFactDomain.CompanySummary,
      value: 'Tracked edit',
      companyDraft,
      touchedFields,
    });

    expect(accepted.companyDraft.companySummary).toBe('Tracked edit');
    expect(accepted.touchedFields).toEqual(new Set([KnowledgeFactDomain.CompanySummary]));
  });

  test('ignores every late save response callback after scope invalidation', async () => {
    interface ProfileSaveScope {
      mounted: boolean;
      workspaceId: string;
      profileRevision: number;
      requestEpoch: number;
    }
    type CreateScope = (workspace: Pick<EnterpriseLeadWorkspace, 'id' | 'profileRevision'>) =>
      ProfileSaveScope;
    type SetMounted = (scope: ProfileSaveScope, mounted: boolean) => void;
    type SynchronizeScope = (
      scope: ProfileSaveScope,
      workspace: Pick<EnterpriseLeadWorkspace, 'id' | 'profileRevision'>,
    ) => string;
    type RunSave = (input: {
      scope: ProfileSaveScope;
      submittedWorkspace: EnterpriseLeadWorkspace;
      execute: () => Promise<EnterpriseLeadWorkspace | null>;
      resolveConflict: (
        error: unknown,
      ) => EnterpriseLeadWorkspace | null | undefined;
      onStarted: () => void;
      onSuccess: (workspace: EnterpriseLeadWorkspace) => void;
      onConflict: (workspace: EnterpriseLeadWorkspace) => void;
      onFailure: (error: unknown) => void;
      onSettled: () => void;
    }) => Promise<string>;
    const module = await import('./WorkspaceKnowledgeBase');
    const helpers = module as unknown as {
      createEnterpriseLeadProfileSaveRequestScope?: CreateScope;
      setEnterpriseLeadProfileSaveRequestMounted?: SetMounted;
      synchronizeEnterpriseLeadProfileSaveRequestScope?: SynchronizeScope;
      runEnterpriseLeadProfileSaveRequest?: RunSave;
    };

    expect(helpers.createEnterpriseLeadProfileSaveRequestScope).toEqual(expect.any(Function));
    expect(helpers.setEnterpriseLeadProfileSaveRequestMounted).toEqual(expect.any(Function));
    expect(helpers.synchronizeEnterpriseLeadProfileSaveRequestScope).toEqual(expect.any(Function));
    expect(helpers.runEnterpriseLeadProfileSaveRequest).toEqual(expect.any(Function));
    if (
      !helpers.createEnterpriseLeadProfileSaveRequestScope ||
      !helpers.setEnterpriseLeadProfileSaveRequestMounted ||
      !helpers.synchronizeEnterpriseLeadProfileSaveRequestScope ||
      !helpers.runEnterpriseLeadProfileSaveRequest
    ) {
      return;
    }

    const submittedWorkspace = createProfileWorkspaceForTest();
    const updatedWorkspace = {
      ...submittedWorkspace,
      profileRevision: submittedWorkspace.profileRevision + 1,
    };
    const createCallbacks = () => ({
      onStarted: vi.fn(),
      onSuccess: vi.fn(),
      onConflict: vi.fn(),
      onFailure: vi.fn(),
      onSettled: vi.fn(),
    });

    const switchedScope = helpers.createEnterpriseLeadProfileSaveRequestScope(submittedWorkspace);
    helpers.setEnterpriseLeadProfileSaveRequestMounted(switchedScope, true);
    const switchedDeferred = createDeferred<EnterpriseLeadWorkspace | null>();
    const switchedCallbacks = createCallbacks();
    const switchedSave = helpers.runEnterpriseLeadProfileSaveRequest({
      scope: switchedScope,
      submittedWorkspace,
      execute: () => switchedDeferred.promise,
      resolveConflict: () => undefined,
      ...switchedCallbacks,
    });
    helpers.synchronizeEnterpriseLeadProfileSaveRequestScope(
      switchedScope,
      createProfileWorkspaceForTest('workspace-b', 1),
    );
    switchedDeferred.resolve(updatedWorkspace);

    await expect(switchedSave).resolves.toBe('ignored');
    expect(switchedCallbacks.onStarted).toHaveBeenCalledTimes(1);
    expect(switchedCallbacks.onSuccess).not.toHaveBeenCalled();
    expect(switchedCallbacks.onConflict).not.toHaveBeenCalled();
    expect(switchedCallbacks.onFailure).not.toHaveBeenCalled();
    expect(switchedCallbacks.onSettled).not.toHaveBeenCalled();

    const revisedScope = helpers.createEnterpriseLeadProfileSaveRequestScope(submittedWorkspace);
    helpers.setEnterpriseLeadProfileSaveRequestMounted(revisedScope, true);
    const revisedDeferred = createDeferred<EnterpriseLeadWorkspace | null>();
    const revisedCallbacks = createCallbacks();
    const revisedSave = helpers.runEnterpriseLeadProfileSaveRequest({
      scope: revisedScope,
      submittedWorkspace,
      execute: () => revisedDeferred.promise,
      resolveConflict: () => undefined,
      ...revisedCallbacks,
    });
    helpers.synchronizeEnterpriseLeadProfileSaveRequestScope(revisedScope, {
      id: submittedWorkspace.id,
      profileRevision: submittedWorkspace.profileRevision + 1,
    });
    revisedDeferred.resolve(updatedWorkspace);

    await expect(revisedSave).resolves.toBe('ignored');
    expect(revisedCallbacks.onSuccess).not.toHaveBeenCalled();
    expect(revisedCallbacks.onConflict).not.toHaveBeenCalled();
    expect(revisedCallbacks.onFailure).not.toHaveBeenCalled();
    expect(revisedCallbacks.onSettled).not.toHaveBeenCalled();

    const unmountedScope = helpers.createEnterpriseLeadProfileSaveRequestScope(submittedWorkspace);
    helpers.setEnterpriseLeadProfileSaveRequestMounted(unmountedScope, true);
    const conflictError = new Error('safe conflict');
    const conflictDeferred = createDeferred<EnterpriseLeadWorkspace | null>();
    const conflictCallbacks = createCallbacks();
    const unmountedSave = helpers.runEnterpriseLeadProfileSaveRequest({
      scope: unmountedScope,
      submittedWorkspace,
      execute: () => conflictDeferred.promise,
      resolveConflict: error => (error === conflictError ? updatedWorkspace : undefined),
      ...conflictCallbacks,
    });
    helpers.setEnterpriseLeadProfileSaveRequestMounted(unmountedScope, false);
    conflictDeferred.reject(conflictError);

    await expect(unmountedSave).resolves.toBe('ignored');
    expect(conflictCallbacks.onSuccess).not.toHaveBeenCalled();
    expect(conflictCallbacks.onConflict).not.toHaveBeenCalled();
    expect(conflictCallbacks.onFailure).not.toHaveBeenCalled();
    expect(conflictCallbacks.onSettled).not.toHaveBeenCalled();

    const supersededScope = helpers.createEnterpriseLeadProfileSaveRequestScope(submittedWorkspace);
    helpers.setEnterpriseLeadProfileSaveRequestMounted(supersededScope, true);
    const staleFailure = createDeferred<EnterpriseLeadWorkspace | null>();
    const currentSuccess = createDeferred<EnterpriseLeadWorkspace | null>();
    const staleCallbacks = createCallbacks();
    const currentCallbacks = createCallbacks();
    const staleSave = helpers.runEnterpriseLeadProfileSaveRequest({
      scope: supersededScope,
      submittedWorkspace,
      execute: () => staleFailure.promise,
      resolveConflict: () => undefined,
      ...staleCallbacks,
    });
    const currentSave = helpers.runEnterpriseLeadProfileSaveRequest({
      scope: supersededScope,
      submittedWorkspace,
      execute: () => currentSuccess.promise,
      resolveConflict: () => undefined,
      ...currentCallbacks,
    });
    staleFailure.reject(new Error('stale failure'));
    currentSuccess.resolve(updatedWorkspace);

    await expect(staleSave).resolves.toBe('ignored');
    await expect(currentSave).resolves.toBe('success');
    expect(staleCallbacks.onFailure).not.toHaveBeenCalled();
    expect(staleCallbacks.onSettled).not.toHaveBeenCalled();
    expect(currentCallbacks.onSuccess).toHaveBeenCalledWith(updatedWorkspace);
    expect(currentCallbacks.onSettled).toHaveBeenCalledTimes(1);
  });

  test('settles current self-rejected responses without publishing UI callbacks', async () => {
    interface ProfileSaveScope {
      mounted: boolean;
      workspaceId: string;
      profileRevision: number;
      requestEpoch: number;
    }
    type RunSave = (input: {
      scope: ProfileSaveScope;
      submittedWorkspace: EnterpriseLeadWorkspace;
      execute: () => Promise<EnterpriseLeadWorkspace | null>;
      resolveConflict: (
        error: unknown,
      ) => EnterpriseLeadWorkspace | null | undefined;
      onStarted: () => void;
      onSuccess: (workspace: EnterpriseLeadWorkspace) => void;
      onConflict: (workspace: EnterpriseLeadWorkspace) => void;
      onFailure: (error: unknown) => void;
      onSettled: () => void;
    }) => Promise<string>;
    const module = await import('./WorkspaceKnowledgeBase');
    const helpers = module as unknown as {
      createEnterpriseLeadProfileSaveRequestScope?: (
        workspace: Pick<EnterpriseLeadWorkspace, 'id' | 'profileRevision'>,
      ) => ProfileSaveScope;
      setEnterpriseLeadProfileSaveRequestMounted?: (
        scope: ProfileSaveScope,
        mounted: boolean,
      ) => void;
      runEnterpriseLeadProfileSaveRequest?: RunSave;
    };

    expect(helpers.runEnterpriseLeadProfileSaveRequest).toEqual(expect.any(Function));
    if (
      !helpers.createEnterpriseLeadProfileSaveRequestScope ||
      !helpers.setEnterpriseLeadProfileSaveRequestMounted ||
      !helpers.runEnterpriseLeadProfileSaveRequest
    ) {
      return;
    }

    const submittedWorkspace = createProfileWorkspaceForTest();
    const conflictError = new Error('safe rejected conflict');
    const cases: Array<{
      execute: () => Promise<EnterpriseLeadWorkspace | null>;
      resolveConflict: (
        error: unknown,
      ) => EnterpriseLeadWorkspace | null | undefined;
    }> = [
      {
        execute: async () => ({
          ...submittedWorkspace,
          id: 'workspace-b',
          profileRevision: submittedWorkspace.profileRevision + 1,
        }),
        resolveConflict: () => undefined,
      },
      {
        execute: async () => ({
          ...submittedWorkspace,
          profileRevision: submittedWorkspace.profileRevision - 1,
        }),
        resolveConflict: () => undefined,
      },
      {
        execute: async () => {
          throw conflictError;
        },
        resolveConflict: () => null,
      },
      {
        execute: async () => {
          throw conflictError;
        },
        resolveConflict: () => ({
          ...submittedWorkspace,
          id: 'workspace-b',
          profileRevision: submittedWorkspace.profileRevision + 1,
        }),
      },
    ];
    const results = await Promise.all(cases.map(async currentCase => {
      const scope = helpers.createEnterpriseLeadProfileSaveRequestScope!(submittedWorkspace);
      helpers.setEnterpriseLeadProfileSaveRequestMounted!(scope, true);
      const onStarted = vi.fn();
      const onSuccess = vi.fn();
      const onConflict = vi.fn();
      const onFailure = vi.fn();
      const onSettled = vi.fn();
      const feedback = vi.fn();
      const closeModal = vi.fn();
      const updateParent = vi.fn();
      const outcome = await helpers.runEnterpriseLeadProfileSaveRequest!({
        scope,
        submittedWorkspace,
        execute: currentCase.execute,
        resolveConflict: currentCase.resolveConflict,
        onStarted,
        onSuccess: workspace => {
          onSuccess(workspace);
          feedback();
          closeModal();
          updateParent();
        },
        onConflict: workspace => {
          onConflict(workspace);
          feedback();
          closeModal();
          updateParent();
        },
        onFailure: error => {
          onFailure(error);
          feedback();
          closeModal();
          updateParent();
        },
        onSettled,
      });
      return {
        outcome,
        onStarted,
        onSuccess,
        onConflict,
        onFailure,
        onSettled,
        feedback,
        closeModal,
        updateParent,
      };
    }));

    expect(results.map(result => result.outcome)).toEqual([
      'ignored',
      'ignored',
      'ignored',
      'ignored',
    ]);
    results.forEach(result => {
      expect(result.onStarted).toHaveBeenCalledTimes(1);
      expect(result.onSuccess).not.toHaveBeenCalled();
      expect(result.onConflict).not.toHaveBeenCalled();
      expect(result.onFailure).not.toHaveBeenCalled();
      expect(result.feedback).not.toHaveBeenCalled();
      expect(result.closeModal).not.toHaveBeenCalled();
      expect(result.updateParent).not.toHaveBeenCalled();
      expect(result.onSettled).toHaveBeenCalledTimes(1);
    });
  });

  test('routes accepted conflict and current failure through the guarded save lifecycle', async () => {
    interface ProfileSaveScope {
      mounted: boolean;
      workspaceId: string;
      profileRevision: number;
      requestEpoch: number;
    }
    type RunSave = (input: {
      scope: ProfileSaveScope;
      submittedWorkspace: EnterpriseLeadWorkspace;
      execute: () => Promise<EnterpriseLeadWorkspace | null>;
      resolveConflict: (
        error: unknown,
      ) => EnterpriseLeadWorkspace | null | undefined;
      onStarted: () => void;
      onSuccess: (workspace: EnterpriseLeadWorkspace) => void;
      onConflict: (workspace: EnterpriseLeadWorkspace) => void;
      onFailure: (error: unknown) => void;
      onSettled: () => void;
    }) => Promise<string>;
    const module = await import('./WorkspaceKnowledgeBase');
    const helpers = module as unknown as {
      createEnterpriseLeadProfileSaveRequestScope?: (
        workspace: Pick<EnterpriseLeadWorkspace, 'id' | 'profileRevision'>,
      ) => ProfileSaveScope;
      setEnterpriseLeadProfileSaveRequestMounted?: (
        scope: ProfileSaveScope,
        mounted: boolean,
      ) => void;
      runEnterpriseLeadProfileSaveRequest?: RunSave;
    };

    expect(helpers.runEnterpriseLeadProfileSaveRequest).toEqual(expect.any(Function));
    if (
      !helpers.createEnterpriseLeadProfileSaveRequestScope ||
      !helpers.setEnterpriseLeadProfileSaveRequestMounted ||
      !helpers.runEnterpriseLeadProfileSaveRequest
    ) {
      return;
    }

    const submittedWorkspace = createProfileWorkspaceForTest();
    const conflictWorkspace = {
      ...submittedWorkspace,
      profile: {
        ...submittedWorkspace.profile,
        companySummary: 'Concurrent profile',
      },
      profileRevision: submittedWorkspace.profileRevision + 1,
    };
    const conflictScope = helpers.createEnterpriseLeadProfileSaveRequestScope(submittedWorkspace);
    helpers.setEnterpriseLeadProfileSaveRequestMounted(conflictScope, true);
    const conflictError = new Error('safe conflict');
    const onConflict = vi.fn();
    const onConflictSettled = vi.fn();

    await expect(
      helpers.runEnterpriseLeadProfileSaveRequest({
        scope: conflictScope,
        submittedWorkspace,
        execute: async () => {
          throw conflictError;
        },
        resolveConflict: error => (error === conflictError ? conflictWorkspace : undefined),
        onStarted: vi.fn(),
        onSuccess: vi.fn(),
        onConflict,
        onFailure: vi.fn(),
        onSettled: onConflictSettled,
      }),
    ).resolves.toBe('conflict');
    expect(onConflict).toHaveBeenCalledWith(conflictWorkspace);
    expect(onConflictSettled).toHaveBeenCalledTimes(1);
    expect(conflictScope.profileRevision).toBe(conflictWorkspace.profileRevision);

    const failureScope = helpers.createEnterpriseLeadProfileSaveRequestScope(submittedWorkspace);
    helpers.setEnterpriseLeadProfileSaveRequestMounted(failureScope, true);
    const failure = new Error('safe current failure');
    const onFailure = vi.fn();
    const onFailureSettled = vi.fn();

    await expect(
      helpers.runEnterpriseLeadProfileSaveRequest({
        scope: failureScope,
        submittedWorkspace,
        execute: async () => {
          throw failure;
        },
        resolveConflict: () => undefined,
        onStarted: vi.fn(),
        onSuccess: vi.fn(),
        onConflict: vi.fn(),
        onFailure,
        onSettled: onFailureSettled,
      }),
    ).resolves.toBe('failure');
    expect(onFailure).toHaveBeenCalledWith(failure);
    expect(onFailureSettled).toHaveBeenCalledTimes(1);
  });

  test('keeps an edited AI knowledge value confirmed after save', () => {
    const profile = {
      companySummary: '',
      productList: ['蜂窝纸板'],
      productCapabilities: [],
      targetCustomers: [],
      applicationScenarios: [],
      sellingPoints: [],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
    };
    const editedItem = {
      id: 'product-0',
      kind: EnterpriseLeadKnowledgeItemKind.Product,
      text: '蜂窝纸板',
    };

    expect(getEnterpriseLeadKnowledgePendingItemCount(profile, [editedItem])).toBe(1);

    const confirmedProfile = confirmEnterpriseLeadKnowledgeValueInProfile(
      profile,
      'productList',
      '蜂窝纸板',
    );

    expect(isEnterpriseLeadKnowledgeItemConfirmed(confirmedProfile, editedItem)).toBe(true);
    expect(getEnterpriseLeadKnowledgePendingItemCount(confirmedProfile, [editedItem])).toBe(0);
  });

  test('ignores an AI knowledge item and removes it from the maintained profile', () => {
    const profile = {
      companySummary: '',
      productList: ['重型纸箱'],
      productCapabilities: [],
      targetCustomers: [],
      applicationScenarios: [],
      sellingPoints: [],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
      confirmedKnowledgeKeys: ['productList:重型纸箱'],
    };
    const item = {
      id: 'product-0',
      kind: EnterpriseLeadKnowledgeItemKind.Product,
      text: '重型纸箱',
    };

    const ignoredProfile = ignoreEnterpriseLeadKnowledgeItemInProfile(profile, item);

    expect(ignoredProfile.productList).toEqual([]);
    expect(ignoredProfile.confirmedKnowledgeKeys).toBeUndefined();
    expect(ignoredProfile.ignoredKnowledgeKeys).toEqual([
      getEnterpriseLeadKnowledgeConfirmationKey(item),
    ]);
    expect(isEnterpriseLeadKnowledgeItemIgnored(ignoredProfile, item)).toBe(true);
  });

  test('bulk confirms pending AI knowledge items while ignoring read-only source rows', () => {
    const profile = {
      companySummary: '',
      productList: ['重型纸箱'],
      productCapabilities: [],
      targetCustomers: ['汽配工厂'],
      applicationScenarios: [],
      sellingPoints: [],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
    };
    const items = [
      {
        id: 'product-0',
        kind: EnterpriseLeadKnowledgeItemKind.Product,
        text: '重型纸箱',
      },
      {
        id: 'customer-0',
        kind: EnterpriseLeadKnowledgeItemKind.Customer,
        text: '汽配工厂',
      },
      {
        id: 'source-0',
        kind: EnterpriseLeadKnowledgeItemKind.Source,
        text: '客户访谈原文',
      },
    ];

    expect(getEnterpriseLeadKnowledgePendingItems(profile, items)).toEqual(items.slice(0, 2));

    const confirmedProfile = confirmEnterpriseLeadKnowledgeItemsInProfile(profile, items);

    expect(confirmedProfile.confirmedKnowledgeKeys).toEqual([
      getEnterpriseLeadKnowledgeConfirmationKey(items[0]),
      getEnterpriseLeadKnowledgeConfirmationKey(items[1]),
    ]);
    expect(getEnterpriseLeadKnowledgePendingItemCount(confirmedProfile, items)).toBe(0);
  });

  test('builds batch delete keys only for maintainable AI knowledge items', () => {
    const items = [
      {
        id: 'product-0',
        kind: EnterpriseLeadKnowledgeItemKind.Product,
        text: '重型纸箱',
      },
      {
        id: 'source-0',
        kind: EnterpriseLeadKnowledgeItemKind.Source,
        text: '客户访谈原文',
      },
      {
        id: 'selling-point-0',
        kind: EnterpriseLeadKnowledgeItemKind.SellingPoint,
        text: '防破损',
      },
    ];

    expect(getEnterpriseLeadKnowledgeDeletionKeys(items)).toEqual([
      'productList:重型纸箱',
      'sellingPoints:防破损',
    ]);
  });

  test('builds batch delete keys only from selected maintainable AI knowledge items', () => {
    const items = [
      {
        id: 'product-0',
        kind: EnterpriseLeadKnowledgeItemKind.Product,
        text: '重型纸箱',
      },
      {
        id: 'source-0',
        kind: EnterpriseLeadKnowledgeItemKind.Source,
        text: '客户访谈原文',
      },
      {
        id: 'selling-point-0',
        kind: EnterpriseLeadKnowledgeItemKind.SellingPoint,
        text: '防破损',
      },
    ];

    expect(getEnterpriseLeadKnowledgeSelectedDeletionKeys(items, ['product-0'])).toEqual([
      'productList:重型纸箱',
    ]);
    expect(
      getEnterpriseLeadKnowledgeSelectedDeletionKeys(items, ['source-0', 'selling-point-0']),
    ).toEqual(['sellingPoints:防破损']);
  });

  test('shows selected action toolbar only after AI knowledge is selected', () => {
    expect(shouldShowEnterpriseLeadKnowledgeSelectionToolbar(0)).toBe(false);
    expect(shouldShowEnterpriseLeadKnowledgeSelectionToolbar(1)).toBe(true);
  });

  test('hides no-op confirmation controls', () => {
    expect(shouldShowEnterpriseLeadKnowledgeBatchConfirmAction(0)).toBe(false);
    expect(shouldShowEnterpriseLeadKnowledgeBatchConfirmAction(1)).toBe(true);
  });

  test('keeps row ignore as a secondary hover action', () => {
    expect(enterpriseLeadKnowledgeRowArchiveActionClassName).toContain('opacity-0');
    expect(enterpriseLeadKnowledgeRowArchiveActionClassName).toContain('group-hover:opacity-100');
  });

  test('maps top metrics to knowledge table filters', () => {
    expect(
      getEnterpriseLeadKnowledgeMetricFilter(EnterpriseLeadKnowledgeMetric.Documents),
    ).toMatchObject({
      activeView: 'documents',
      documentStatusFilter: 'all',
    });
    expect(getEnterpriseLeadKnowledgeMetricFilter(EnterpriseLeadKnowledgeMetric.All)).toMatchObject(
      {
        activeView: 'knowledge',
        statusFilter: 'all',
      },
    );
    expect(
      getEnterpriseLeadKnowledgeMetricFilter(EnterpriseLeadKnowledgeMetric.Pending),
    ).toMatchObject({
      activeView: 'knowledge',
      statusFilter: 'pending',
    });
    expect(
      getEnterpriseLeadKnowledgeMetricFilter(EnterpriseLeadKnowledgeMetric.Confirmed),
    ).toMatchObject({ activeView: 'knowledge', statusFilter: 'confirmed' });
  });

  test('does not open a detail panel from AI knowledge table selection', () => {
    expect(shouldShowEnterpriseLeadKnowledgeDetailPanel('documents', 'source-0')).toBe(false);
    expect(shouldShowEnterpriseLeadKnowledgeDetailPanel('knowledge', '')).toBe(false);
    expect(shouldShowEnterpriseLeadKnowledgeDetailPanel('knowledge', 'product-0')).toBe(false);
  });

  test('shows only derived knowledge sections in the AI knowledge table', () => {
    expect(
      isEnterpriseLeadKnowledgeSectionShownInAiKnowledgeTable(
        EnterpriseLeadKnowledgeSection.Sources,
      ),
    ).toBe(false);
    expect(
      isEnterpriseLeadKnowledgeSectionShownInAiKnowledgeTable(
        EnterpriseLeadKnowledgeSection.Deliverables,
      ),
    ).toBe(false);
    expect(
      isEnterpriseLeadKnowledgeSectionShownInAiKnowledgeTable(
        EnterpriseLeadKnowledgeSection.Archives,
      ),
    ).toBe(false);
    expect(
      isEnterpriseLeadKnowledgeSectionShownInAiKnowledgeTable(
        EnterpriseLeadKnowledgeSection.Products,
      ),
    ).toBe(true);
  });

  test('tracks only newly contributed knowledge keys from document extraction', () => {
    const previousProfile = {
      companySummary: '东莞工厂',
      productList: ['重型纸箱'],
      productCapabilities: [],
      targetCustomers: [],
      applicationScenarios: [],
      sellingPoints: [],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
    };
    const extractedProfile = {
      companySummary: '东莞工厂',
      productList: ['重型纸箱', '蜂窝纸板'],
      productCapabilities: [],
      targetCustomers: ['机械设备厂'],
      applicationScenarios: [],
      sellingPoints: ['防破损'],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
    };
    const mergedProfile = {
      ...previousProfile,
      productList: ['重型纸箱', '蜂窝纸板'],
      targetCustomers: ['机械设备厂'],
      sellingPoints: ['防破损'],
    };

    expect(
      getEnterpriseLeadNewExtractedKnowledgeKeys(previousProfile, extractedProfile, mergedProfile),
    ).toEqual(['productList:蜂窝纸板', 'targetCustomers:机械设备厂', 'sellingPoints:防破损']);
  });

  test('removes only unpreserved source knowledge keys from profile and confirmations', () => {
    const profile = {
      companySummary: '东莞工厂',
      productList: ['重型纸箱', '蜂窝纸板'],
      productCapabilities: [],
      targetCustomers: ['机械设备厂'],
      applicationScenarios: [],
      sellingPoints: ['防破损'],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
      confirmedKnowledgeKeys: [
        'productList:蜂窝纸板',
        'targetCustomers:机械设备厂',
        'sellingPoints:防破损',
      ],
    };

    const nextProfile = removeEnterpriseLeadKnowledgeKeysFromProfile(
      profile,
      ['productList:蜂窝纸板', 'targetCustomers:机械设备厂'],
      ['targetCustomers:机械设备厂'],
    );

    expect(nextProfile.productList).toEqual(['重型纸箱']);
    expect(nextProfile.targetCustomers).toEqual(['机械设备厂']);
    expect(nextProfile.sellingPoints).toEqual(['防破损']);
    expect(nextProfile.confirmedKnowledgeKeys).toEqual([
      'targetCustomers:机械设备厂',
      'sellingPoints:防破损',
    ]);
  });

  test('left aligns document table headers and centers AI knowledge table headers', () => {
    expect(enterpriseLeadKnowledgeDocumentHeaderClassName).toContain('text-left');
    expect(enterpriseLeadKnowledgeDocumentHeaderClassName).not.toContain('text-center');
    expect(enterpriseLeadKnowledgeDocumentHeaderLastClassName).toContain('text-left');
    expect(enterpriseLeadKnowledgeDocumentHeaderLastClassName).not.toContain('text-center');
    expect(enterpriseLeadKnowledgeDocumentHeaderLastClassName).not.toContain('text-right');
    expect(enterpriseLeadKnowledgeHeaderCellClassName).toContain('text-center');
    expect(enterpriseLeadKnowledgeHeaderCellClassName).not.toContain('text-right');
  });

  test('clears selected rows when switching knowledge views', () => {
    expect(enterpriseLeadKnowledgeInitialSelectedItemId).toBe('');
    expect(getEnterpriseLeadKnowledgeSelectedItemIdAfterViewChange('knowledge')).toBe('');
    expect(getEnterpriseLeadKnowledgeSelectedItemIdAfterViewChange('documents')).toBe('');
  });

  test('classifies global knowledge messages by outcome tone', () => {
    expect(Object.keys(enterpriseLeadKnowledgeMessageToneClassNames)).toEqual([
      'success',
      'failure',
      'exception',
    ]);
    expect(enterpriseLeadKnowledgeMessageToneClassNames.success).toContain('border-emerald');
    expect(enterpriseLeadKnowledgeMessageToneClassNames.failure).toContain('border-red');
    expect(enterpriseLeadKnowledgeMessageToneClassNames.exception).toContain('border-amber');
    expect(getEnterpriseLeadKnowledgeMessageRole('success')).toBe('status');
    expect(getEnterpriseLeadKnowledgeMessageRole('failure')).toBe('alert');
    expect(getEnterpriseLeadKnowledgeMessageRole('exception')).toBe('alert');
  });

  test('animates global knowledge messages without animating reduced-motion users', () => {
    expect(enterpriseLeadKnowledgeMessageAnimationClassName).toContain(
      'animate-knowledge-message-in',
    );
    expect(enterpriseLeadKnowledgeMessageAnimationClassName).toContain(
      'motion-reduce:animate-none',
    );
    expect(enterpriseLeadKnowledgeMessageSuccessAccentClassName).toContain(
      'animate-knowledge-message-success-sheen',
    );
    expect(enterpriseLeadKnowledgeMessageSuccessAccentClassName).toContain('motion-reduce:hidden');
  });

  test('auto dismisses global knowledge messages after readable durations', () => {
    expect(Object.keys(enterpriseLeadKnowledgeMessageAutoDismissMs)).toEqual([
      'success',
      'failure',
      'exception',
    ]);
    expect(getEnterpriseLeadKnowledgeMessageAutoDismissMs('success')).toBe(3000);
    expect(getEnterpriseLeadKnowledgeMessageAutoDismissMs('failure')).toBe(5000);
    expect(getEnterpriseLeadKnowledgeMessageAutoDismissMs('exception')).toBe(6000);
    expect(getEnterpriseLeadKnowledgeMessageAutoDismissMs('success')).toBeLessThan(
      getEnterpriseLeadKnowledgeMessageAutoDismissMs('failure'),
    );
    expect(getEnterpriseLeadKnowledgeMessageAutoDismissMs('failure')).toBeLessThanOrEqual(
      getEnterpriseLeadKnowledgeMessageAutoDismissMs('exception'),
    );
  });

  test('maps document vector index status for knowledge base rows', () => {
    expect(Object.keys(enterpriseLeadKnowledgeVectorIndexStatusClassNames)).toEqual([
      'pending',
      'indexing',
      'indexed',
      'failed',
    ]);
    expect(enterpriseLeadKnowledgeVectorIndexStatusClassNames.indexed).toContain('emerald');
    expect(enterpriseLeadKnowledgeVectorIndexStatusClassNames.failed).toContain('red');
    expect(getEnterpriseLeadKnowledgeVectorIndexStatus()).toBe('pending');
    expect(getEnterpriseLeadKnowledgeVectorIndexStatus({ vectorIndexStatus: 'indexed' })).toBe(
      'indexed',
    );
    expect(
      getEnterpriseLeadKnowledgeVectorIndexSummary({
        vectorChunkCount: 12,
        vectorIndexStatus: 'indexed',
      }),
    ).toContain('12');
  });

  test('detects stale readable documents that still need vector sync', () => {
    expect(
      doesEnterpriseLeadKnowledgeSourceNeedVectorSync({
        text: '主营工业包装服务，客户是机械设备厂采购负责人。',
      }),
    ).toBe(true);
    expect(
      doesEnterpriseLeadKnowledgeSourceNeedVectorSync({
        text: '主营工业包装服务，客户是机械设备厂采购负责人。',
        extractionStatus: 'extracting',
        vectorIndexStatus: 'indexing',
      }),
    ).toBe(false);
    expect(
      doesEnterpriseLeadKnowledgeSourceNeedVectorSync({
        text: '主营工业包装服务，客户是机械设备厂采购负责人。',
        vectorChunkCount: 4,
        vectorIndexStatus: 'indexed',
      }),
    ).toBe(false);
    expect(
      doesEnterpriseLeadKnowledgeSourceNeedVectorSync({
        text: '   ',
        vectorIndexStatus: 'pending',
      }),
    ).toBe(false);
  });

  test('guards retry and mutation actions while documents are processing', () => {
    expect(
      canRetryEnterpriseLeadDocumentProcessing({
        text: '企业资料正文',
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Pending,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
      }),
    ).toBe(true);
    expect(
      canRetryEnterpriseLeadDocumentProcessing({
        text: '企业资料正文',
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Failed,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Failed,
      }),
    ).toBe(true);
    expect(
      canRetryEnterpriseLeadDocumentProcessing({
        text: '企业资料正文',
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Failed,
      }),
    ).toBe(true);
    expect(
      canRetryEnterpriseLeadDocumentProcessing({
        text: '企业资料正文',
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexed,
      }),
    ).toBe(false);
    expect(
      canRetryEnterpriseLeadDocumentProcessing({
        text: '企业资料正文',
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracting,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexing,
      }),
    ).toBe(false);
    expect(
      canRetryEnterpriseLeadDocumentProcessing({
        text: '   ',
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Failed,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Failed,
      }),
    ).toBe(false);
    const pendingImageWithoutText: EnterpriseLeadExtractionSource = {
      kind: EnterpriseLeadExtractionSourceKind.Image,
      label: '旧图片资料',
      filePath: '/tmp/legacy-image.png',
      extractionStatus: EnterpriseLeadDocumentExtractionStatus.Pending,
      vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
    };
    expect(canRetryEnterpriseLeadDocumentProcessing(pendingImageWithoutText)).toBe(true);
    expect(
      isEnterpriseLeadDocumentProcessing({
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracting,
      }),
    ).toBe(true);
    expect(
      isEnterpriseLeadDocumentProcessing({
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexing,
      }),
    ).toBe(true);
    expect(
      isEnterpriseLeadDocumentProcessing({
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Failed,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Failed,
      }),
    ).toBe(false);
  });

  test('describes chunk extraction progress for large document processing', () => {
    expect(
      getEnterpriseLeadKnowledgeDocumentStatusDescription({
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracting,
        extractionStage: 'extracting_chunks',
        extractionProgressCurrent: 3,
        extractionProgressTotal: 12,
      }),
    ).toContain('3/12');
    expect(
      getEnterpriseLeadKnowledgeDocumentStatusDescription({
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracting,
        extractionStage: 'merging',
      }),
    ).toContain('合并');
    expect(
      getEnterpriseLeadKnowledgeDocumentStatusDescription({
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
        extractionPartial: true,
      }),
    ).toContain('大文件');
  });

  test('treats rich document uploads as readable knowledge sources', () => {
    expect(enterpriseLeadReadableDocumentExtensions.has('pdf')).toBe(true);
    expect(enterpriseLeadReadableDocumentExtensions.has('docx')).toBe(true);
    expect(enterpriseLeadReadableDocumentExtensions.has('xlsx')).toBe(true);
    expect(enterpriseLeadReadableDocumentExtensions.has('xls')).toBe(true);
    expect(enterpriseLeadReadableDocumentExtensions.has('pptx')).toBe(true);
    expect(enterpriseLeadReadableDocumentExtensions.has('doc')).toBe(false);
  });

  test('allows image uploads as attachable knowledge sources without marking them readable', () => {
    expect(EnterpriseLeadImageAttachmentExtensions).toContain('png');
    expect(EnterpriseLeadImageAttachmentExtensions).toContain('jpg');
    expect(EnterpriseLeadImageAttachmentExtensions).toContain('webp');
    expect(EnterpriseLeadSourceDocumentFileFilterExtensions).toContain('png');
    expect(EnterpriseLeadSourceDocumentFileFilterExtensions).toContain('jpg');
    expect(EnterpriseLeadSourceDocumentFileFilterExtensions).toContain('webp');
    expect(enterpriseLeadReadableDocumentExtensions.has('png')).toBe(false);
  });

  test('provides exactly 108 Task 5-7 translations in both locales without fallback', () => {
    expect(task8I18nKeys).toHaveLength(108);
    expect(new Set(task8I18nKeys).size).toBe(108);

    const previousLanguage = i18nService.getLanguage();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (const language of ['zh', 'en'] as const) {
        i18nService.setLanguage(language, { persist: false });
        for (const key of task8I18nKeys) {
          const translated = i18nService.t(key);
          expect(translated.trim(), `${language}:${key}`).not.toBe('');
          expect(translated, `${language}:${key}`).not.toBe(key);
        }
        expect(
          i18nService.t('enterpriseAiKnowledgeArchiveLedgerlessDescription'),
        ).toBe(
          language === 'zh'
            ? '未找到可核对的历史记录，只能保留公司资料中的当前内容。'
            : 'No verifiable history was found, so only the current company-profile value can be kept.',
        );
        expect(warn, `${language} must not use translation fallback`).not.toHaveBeenCalled();
      }
    } finally {
      i18nService.setLanguage(previousLanguage, { persist: false });
      warn.mockRestore();
    }
  });

  test('keeps Task 5-7 component-visible copy behind i18n keys', () => {
    const componentFiles = [
      './WorkspaceKnowledgeDocumentsPanel.tsx',
      './WorkspaceKnowledgeExtractionDialog.tsx',
      './WorkspaceAiKnowledgePanel.tsx',
      './WorkspaceKnowledgeFactDialogs.tsx',
      './WorkspaceKnowledgeFactEvidence.tsx',
    ];
    const rawVisibleTextPattern = /(?<!=)>\s*[^<>{}\n]*[A-Za-z\u3400-\u9fff][^<>{}\n]*</g;

    for (const componentFile of componentFiles) {
      const source = fs.readFileSync(new URL(componentFile, import.meta.url), 'utf8');
      expect(source.match(rawVisibleTextPattern) ?? [], componentFile).toEqual([]);
    }
  });
});
