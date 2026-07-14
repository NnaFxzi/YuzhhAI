import {
  BuildingOffice2Icon,
  DocumentTextIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  EnterpriseLeadDocumentExtractionStage,
  EnterpriseLeadDocumentExtractionStatus,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadImageAttachmentExtensions,
  EnterpriseLeadIpcErrorCode,
  EnterpriseLeadKnowledgeIndexStatus,
  EnterpriseLeadReadableDocumentExtensions,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadExtractionSource,
  EnterpriseLeadProfileConflictSnapshot,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceProfile,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../../shared/enterpriseLeadWorkspace/types';
import {
  KnowledgeFactDomain,
  KnowledgeFactDomains,
} from '../../../shared/knowledgeBase/constants';
import {
  buildEnterpriseKnowledgeKey,
  confirmEnterpriseProfileKnowledgeKey,
  ignoreEnterpriseProfileKnowledgeKey,
  removeEnterpriseProfileKnowledgeKey,
} from '../../../shared/knowledgeBase/enterpriseLeadProfileKnowledge';
import type {
  KnowledgeFactMetrics,
  KnowledgeImportBatchResult,
} from '../../../shared/knowledgeBase/types';
import {
  enterpriseLeadWorkspaceService,
  EnterpriseLeadWorkspaceServiceError,
} from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import { knowledgeBaseService } from '../../services/knowledgeBase';
import {
  EnterpriseLeadKnowledgeSection,
  getEditableKnowledgeField,
  getWorkspaceKnowledgeSections,
  type WorkspaceKnowledgeItem,
} from './enterpriseLeadWorkspaceUi';
import WorkspaceAiKnowledgePanel from './WorkspaceAiKnowledgePanel';
import WorkspaceKnowledgeDocumentsPanel, {
  workspaceKnowledgeUploadButtonSlotId,
} from './WorkspaceKnowledgeDocumentsPanel';

interface WorkspaceKnowledgeBaseProps {
  workspace: EnterpriseLeadWorkspace;
  initialImportResult?: KnowledgeImportBatchResult;
  onInitialImportResultConsumed?: (workspaceId: string) => void;
  onWorkspaceUpdated?: (workspace: EnterpriseLeadWorkspace) => void;
}

const actionIconClassName = 'h-4 w-4';
export const enterpriseLeadKnowledgeTableColumnClassNames = {
  knowledge: 'w-[50%]',
  category: 'w-[18%]',
  status: 'w-[16%]',
  actions: 'w-[16%]',
} as const;
export const enterpriseLeadKnowledgeDocumentHeaderClassName = 'min-w-0 text-left';
export const enterpriseLeadKnowledgeDocumentHeaderLastClassName = 'min-w-0 text-left';
export const enterpriseLeadKnowledgeHeaderCellClassName =
  'border-b border-border px-4 py-3 text-center';
export const enterpriseLeadKnowledgeConfirmBehavior = {
  persistProfile: true,
  successMessageKey: 'enterpriseLeadKnowledgeItemConfirmed',
} as const;
export const enterpriseLeadKnowledgeInitialSelectedItemId = '';
export const getEnterpriseLeadKnowledgeSelectedItemIdAfterViewChange = (
  _view: KnowledgeView,
): string => enterpriseLeadKnowledgeInitialSelectedItemId;

const enterpriseLeadKnowledgeActionButtonBaseClassName =
  'inline-flex h-8 min-w-[54px] shrink-0 items-center justify-center gap-1 rounded-md border px-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45';
export const enterpriseLeadKnowledgeActionButtonClassNames = {
  danger: `${enterpriseLeadKnowledgeActionButtonBaseClassName} border-red-500/20 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-300`,
  neutral: `${enterpriseLeadKnowledgeActionButtonBaseClassName} border-border bg-background text-secondary hover:bg-surface-raised hover:text-foreground`,
} as const;
export const enterpriseLeadKnowledgeRowArchiveActionClassName = `${enterpriseLeadKnowledgeActionButtonClassNames.danger} opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100`;
export type EnterpriseLeadKnowledgeMessageTone = 'success' | 'failure' | 'exception';
interface EnterpriseLeadKnowledgeMessage {
  tone: EnterpriseLeadKnowledgeMessageTone;
  text: string;
}

const formatEnterpriseLeadKnowledgeMessage = (
  messageKey: string,
  values?: Record<string, string | number>,
): string => {
  let message = i18nService.t(messageKey);
  Object.entries(values ?? {}).forEach(([key, value]) => {
    message = message.replace(`{${key}}`, String(value));
  });
  return message;
};

export const enterpriseLeadKnowledgeMessageToneClassNames: Record<
  EnterpriseLeadKnowledgeMessageTone,
  string
> = {
  success:
    'border-emerald-500/30 bg-emerald-50 text-emerald-700 shadow-emerald-950/10 dark:bg-emerald-500/15 dark:text-emerald-200',
  failure:
    'border-red-500/30 bg-red-50 text-red-700 shadow-red-950/10 dark:bg-red-500/15 dark:text-red-200',
  exception:
    'border-amber-500/30 bg-amber-50 text-amber-800 shadow-amber-950/10 dark:bg-amber-500/15 dark:text-amber-200',
};
export const enterpriseLeadKnowledgeMessageAnimationClassName =
  'animate-knowledge-message-in motion-reduce:animate-none';
export const enterpriseLeadKnowledgeMessageSuccessAccentClassName =
  'pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-18deg] bg-white/45 blur-sm animate-knowledge-message-success-sheen motion-reduce:hidden dark:bg-white/15';
export const enterpriseLeadKnowledgeMessageAutoDismissMs: Record<
  EnterpriseLeadKnowledgeMessageTone,
  number
> = {
  success: 3000,
  failure: 5000,
  exception: 6000,
};
export const getEnterpriseLeadKnowledgeMessageAutoDismissMs = (
  tone: EnterpriseLeadKnowledgeMessageTone,
): number => enterpriseLeadKnowledgeMessageAutoDismissMs[tone];
const enterpriseLeadKnowledgeMessageLabelKeys: Record<EnterpriseLeadKnowledgeMessageTone, string> =
  {
    success: 'enterpriseLeadKnowledgeMessageSuccessLabel',
    failure: 'enterpriseLeadKnowledgeMessageFailureLabel',
    exception: 'enterpriseLeadKnowledgeMessageExceptionLabel',
  };
export const getEnterpriseLeadKnowledgeMessageRole = (
  tone: EnterpriseLeadKnowledgeMessageTone,
): 'status' | 'alert' => (tone === 'success' ? 'status' : 'alert');

type EditableArrayField = Exclude<
  KnowledgeFactDomain,
  typeof KnowledgeFactDomain.CompanySummary
>;
const editableArrayFields = KnowledgeFactDomains.filter(
  (field): field is EditableArrayField => field !== KnowledgeFactDomain.CompanySummary,
);
const knowledgeFactDomainSet = new Set<string>(KnowledgeFactDomains);

export const enterpriseLeadReadableDocumentExtensions = new Set<string>(
  EnterpriseLeadReadableDocumentExtensions,
);
const enterpriseLeadOriginalDocumentPreviewExtensions = new Set<string>([
  ...EnterpriseLeadImageAttachmentExtensions,
  'csv',
  'docx',
  'pdf',
  'pptx',
  'tsv',
  'xls',
  'xlsx',
]);

const enterpriseLeadKnowledgeAiTableHiddenSections = new Set<EnterpriseLeadKnowledgeSection>([
  EnterpriseLeadKnowledgeSection.Sources,
  EnterpriseLeadKnowledgeSection.Deliverables,
  EnterpriseLeadKnowledgeSection.Archives,
]);

export const isEnterpriseLeadKnowledgeSectionShownInAiKnowledgeTable = (
  sectionId: EnterpriseLeadKnowledgeSection,
): boolean => !enterpriseLeadKnowledgeAiTableHiddenSections.has(sectionId);

const cloneProfile = (profile: EnterpriseLeadWorkspaceProfile): EnterpriseLeadWorkspaceProfile => ({
  companySummary: profile.companySummary,
  productList: [...profile.productList],
  productCapabilities: [...profile.productCapabilities],
  targetCustomers: [...profile.targetCustomers],
  applicationScenarios: [...profile.applicationScenarios],
  sellingPoints: [...profile.sellingPoints],
  channelPreferences: [...profile.channelPreferences],
  prohibitedClaims: [...profile.prohibitedClaims],
  contactRules: [...profile.contactRules],
  missingInfo: [...profile.missingInfo],
  ...(profile.confirmedKnowledgeKeys && profile.confirmedKnowledgeKeys.length > 0
    ? { confirmedKnowledgeKeys: [...profile.confirmedKnowledgeKeys] }
    : {}),
  ...(profile.ignoredKnowledgeKeys && profile.ignoredKnowledgeKeys.length > 0
    ? { ignoredKnowledgeKeys: [...profile.ignoredKnowledgeKeys] }
    : {}),
});

const cleanLines = (value: string): string[] =>
  Array.from(
    new Set(
      value
        .split('\n')
        .map(item => item.trim())
        .filter(Boolean),
    ),
  );

const joinLines = (values: string[]): string => values.join('\n');

const getEnterpriseLeadKnowledgeFieldKey = (
  field: KnowledgeFactDomain,
  value: string,
): string => buildEnterpriseKnowledgeKey(field, value);

export const getEnterpriseLeadKnowledgeConfirmationKey = (item: WorkspaceKnowledgeItem): string => {
  const editableField = getEditableKnowledgeField(item.kind);
  return editableField && knowledgeFactDomainSet.has(editableField.field)
    ? getEnterpriseLeadKnowledgeFieldKey(editableField.field as KnowledgeFactDomain, item.text)
    : '';
};

export const isEnterpriseLeadKnowledgeItemConfirmed = (
  profile: EnterpriseLeadWorkspaceProfile,
  item: WorkspaceKnowledgeItem,
): boolean => {
  const key = getEnterpriseLeadKnowledgeConfirmationKey(item);
  return Boolean(key && profile.confirmedKnowledgeKeys?.includes(key));
};

export const isEnterpriseLeadKnowledgeItemIgnored = (
  profile: EnterpriseLeadWorkspaceProfile,
  item: WorkspaceKnowledgeItem,
): boolean => {
  const key = getEnterpriseLeadKnowledgeConfirmationKey(item);
  return Boolean(key && profile.ignoredKnowledgeKeys?.includes(key));
};

export const confirmEnterpriseLeadKnowledgeItemInProfile = (
  profile: EnterpriseLeadWorkspaceProfile,
  item: WorkspaceKnowledgeItem,
): EnterpriseLeadWorkspaceProfile => {
  const key = getEnterpriseLeadKnowledgeConfirmationKey(item);
  return key ? confirmEnterpriseProfileKnowledgeKey(profile, key) : cloneProfile(profile);
};

export const confirmEnterpriseLeadKnowledgeItemsInProfile = (
  profile: EnterpriseLeadWorkspaceProfile,
  items: WorkspaceKnowledgeItem[],
): EnterpriseLeadWorkspaceProfile => {
  return items.reduce((nextProfile, item) => {
    const key = getEnterpriseLeadKnowledgeConfirmationKey(item);
    return key ? confirmEnterpriseProfileKnowledgeKey(nextProfile, key) : nextProfile;
  }, cloneProfile(profile));
};

export const confirmEnterpriseLeadKnowledgeValueInProfile = (
  profile: EnterpriseLeadWorkspaceProfile,
  field: KnowledgeFactDomain,
  value: string,
): EnterpriseLeadWorkspaceProfile => {
  const key = getEnterpriseLeadKnowledgeFieldKey(field, value);
  return key ? confirmEnterpriseProfileKnowledgeKey(profile, key) : cloneProfile(profile);
};

export const getEnterpriseLeadKnowledgePendingItems = (
  profile: EnterpriseLeadWorkspaceProfile,
  items: WorkspaceKnowledgeItem[],
): WorkspaceKnowledgeItem[] =>
  items.filter(
    item =>
      Boolean(getEnterpriseLeadKnowledgeConfirmationKey(item)) &&
      !isEnterpriseLeadKnowledgeItemIgnored(profile, item) &&
      !isEnterpriseLeadKnowledgeItemConfirmed(profile, item),
  );

export const getEnterpriseLeadKnowledgePendingItemCount = (
  profile: EnterpriseLeadWorkspaceProfile,
  items: WorkspaceKnowledgeItem[],
): number => getEnterpriseLeadKnowledgePendingItems(profile, items).length;

export const getEnterpriseLeadKnowledgeDeletionKeys = (items: WorkspaceKnowledgeItem[]): string[] =>
  Array.from(
    new Set(items.map(item => getEnterpriseLeadKnowledgeConfirmationKey(item)).filter(Boolean)),
  );

export const getEnterpriseLeadKnowledgeSelectedItems = (
  items: WorkspaceKnowledgeItem[],
  selectedItemIds: string[],
): WorkspaceKnowledgeItem[] => {
  const selectedItemIdSet = new Set(selectedItemIds);
  return items.filter(item => selectedItemIdSet.has(item.id));
};

export const getEnterpriseLeadKnowledgeTouchedFields = (
  items: readonly WorkspaceKnowledgeItem[],
): KnowledgeFactDomain[] => {
  const touchedFields = new Set<KnowledgeFactDomain>();
  for (const item of items) {
    const editableField = getEditableKnowledgeField(item.kind);
    if (editableField && knowledgeFactDomainSet.has(editableField.field)) {
      touchedFields.add(editableField.field as KnowledgeFactDomain);
    }
  }
  return KnowledgeFactDomains.filter(field => touchedFields.has(field));
};

export const getEnterpriseLeadKnowledgeSelectedDeletionKeys = (
  items: WorkspaceKnowledgeItem[],
  selectedItemIds: string[],
): string[] =>
  getEnterpriseLeadKnowledgeDeletionKeys(
    getEnterpriseLeadKnowledgeSelectedItems(items, selectedItemIds),
  );

export const shouldShowEnterpriseLeadKnowledgeSelectionToolbar = (
  selectedItemCount: number,
): boolean => selectedItemCount > 0;

export const shouldShowEnterpriseLeadKnowledgeBatchConfirmAction = (
  pendingItemCount: number,
): boolean => pendingItemCount > 0;

const getEnterpriseLeadProfileKnowledgeKeys = (
  profile: EnterpriseLeadWorkspaceProfile,
): Set<string> => {
  const keys = new Set<string>();
  const companyKey = getEnterpriseLeadKnowledgeFieldKey(
    KnowledgeFactDomain.CompanySummary,
    profile.companySummary,
  );
  if (companyKey) {
    keys.add(companyKey);
  }
  editableArrayFields.forEach(field => {
    profile[field].forEach(value => {
      const key = getEnterpriseLeadKnowledgeFieldKey(field, value);
      if (key) {
        keys.add(key);
      }
    });
  });
  return keys;
};

export const getEnterpriseLeadNewExtractedKnowledgeKeys = (
  previousProfile: EnterpriseLeadWorkspaceProfile,
  extractedProfile: EnterpriseLeadWorkspaceProfile,
  mergedProfile: EnterpriseLeadWorkspaceProfile,
): string[] => {
  const previousKeys = getEnterpriseLeadProfileKnowledgeKeys(previousProfile);
  const mergedKeys = getEnterpriseLeadProfileKnowledgeKeys(mergedProfile);
  const extractedKeys = getEnterpriseLeadProfileKnowledgeKeys(extractedProfile);
  return Array.from(extractedKeys).filter(key => mergedKeys.has(key) && !previousKeys.has(key));
};

export const removeEnterpriseLeadKnowledgeKeysFromProfile = (
  profile: EnterpriseLeadWorkspaceProfile,
  keysToRemove: Iterable<string>,
  preservedKeys: Iterable<string> = [],
): EnterpriseLeadWorkspaceProfile => {
  const removeKeys = new Set(keysToRemove);
  const keepKeys = new Set(preservedKeys);
  const shouldRemove = (field: keyof EnterpriseLeadWorkspaceProfile, value: string): boolean => {
    const key = knowledgeFactDomainSet.has(field)
      ? getEnterpriseLeadKnowledgeFieldKey(field as KnowledgeFactDomain, value)
      : '';
    return Boolean(key && removeKeys.has(key) && !keepKeys.has(key));
  };
  let nextProfile = cloneProfile(profile);
  if (shouldRemove('companySummary', nextProfile.companySummary)) {
    nextProfile.companySummary = '';
  }
  editableArrayFields.forEach(field => {
    nextProfile[field] = nextProfile[field].filter(value => !shouldRemove(field, value));
  });
  for (const key of removeKeys) {
    if (!keepKeys.has(key)) {
      nextProfile = removeEnterpriseProfileKnowledgeKey(nextProfile, key);
    }
  }
  return nextProfile;
};

export const ignoreEnterpriseLeadKnowledgeItemInProfile = (
  profile: EnterpriseLeadWorkspaceProfile,
  item: WorkspaceKnowledgeItem,
): EnterpriseLeadWorkspaceProfile => {
  const key = getEnterpriseLeadKnowledgeConfirmationKey(item);
  if (!key) {
    return cloneProfile(profile);
  }
  return ignoreEnterpriseProfileKnowledgeKey(
    removeEnterpriseLeadKnowledgeKeysFromProfile(profile, [key]),
    key,
  );
};

const documentStatusTextKeys: Record<string, string> = {
  [EnterpriseLeadDocumentExtractionStatus.Pending]:
    'enterpriseLeadKnowledgeDocumentPendingExtractText',
  [EnterpriseLeadDocumentExtractionStatus.Extracting]:
    'enterpriseLeadKnowledgeDocumentExtractingText',
  [EnterpriseLeadDocumentExtractionStatus.Extracted]:
    'enterpriseLeadKnowledgeDocumentExtractedText',
  [EnterpriseLeadDocumentExtractionStatus.Failed]:
    'enterpriseLeadKnowledgeDocumentFailedExtractText',
};

export const enterpriseLeadKnowledgeVectorIndexStatusClassNames: Record<string, string> = {
  [EnterpriseLeadKnowledgeIndexStatus.Pending]:
    'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  [EnterpriseLeadKnowledgeIndexStatus.Indexing]: 'bg-primary/10 text-primary',
  [EnterpriseLeadKnowledgeIndexStatus.Indexed]:
    'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  [EnterpriseLeadKnowledgeIndexStatus.Failed]: 'bg-red-500/10 text-red-700 dark:text-red-300',
};

const getDocumentExtractionStatus = (
  source?: Pick<EnterpriseLeadExtractionSource, 'extractionStatus' | 'text'>,
): string => {
  if (source?.extractionStatus) {
    return source.extractionStatus;
  }
  return source?.text
    ? EnterpriseLeadDocumentExtractionStatus.Extracted
    : EnterpriseLeadDocumentExtractionStatus.Pending;
};

export const getEnterpriseLeadKnowledgeVectorIndexStatus = (
  source?: Pick<EnterpriseLeadExtractionSource, 'vectorIndexStatus'>,
): string => source?.vectorIndexStatus || EnterpriseLeadKnowledgeIndexStatus.Pending;

export const doesEnterpriseLeadKnowledgeSourceNeedVectorSync = (
  source?: Pick<
    EnterpriseLeadExtractionSource,
    'extractionStatus' | 'summary' | 'text' | 'vectorChunkCount' | 'vectorIndexStatus'
  >,
): boolean => {
  if (!source?.summary?.trim() && !source?.text?.trim()) {
    return false;
  }
  if (source.extractionStatus === EnterpriseLeadDocumentExtractionStatus.Extracting) {
    return false;
  }
  const status = getEnterpriseLeadKnowledgeVectorIndexStatus(source);
  if (status === EnterpriseLeadKnowledgeIndexStatus.Indexed) {
    return (source.vectorChunkCount ?? 0) <= 0;
  }
  return (
    status === EnterpriseLeadKnowledgeIndexStatus.Pending ||
    status === EnterpriseLeadKnowledgeIndexStatus.Indexing
  );
};

export const isEnterpriseLeadDocumentProcessing = (
  source?: Pick<EnterpriseLeadExtractionSource, 'extractionStatus' | 'vectorIndexStatus'>,
): boolean =>
  source?.extractionStatus === EnterpriseLeadDocumentExtractionStatus.Extracting ||
  source?.vectorIndexStatus === EnterpriseLeadKnowledgeIndexStatus.Indexing;

export const canRetryEnterpriseLeadDocumentProcessing = (
  source?: Pick<EnterpriseLeadExtractionSource, 'extractionStatus' | 'text' | 'vectorIndexStatus'> &
    Partial<Pick<EnterpriseLeadExtractionSource, 'filePath' | 'kind'>>,
): boolean => {
  if (isEnterpriseLeadDocumentProcessing(source)) {
    return false;
  }
  const extractionStatus = getDocumentExtractionStatus(source);
  const vectorIndexStatus = getEnterpriseLeadKnowledgeVectorIndexStatus(source);
  if (!source?.text?.trim()) {
    return (
      source?.kind === EnterpriseLeadExtractionSourceKind.Image &&
      Boolean(source.filePath?.trim()) &&
      (extractionStatus === EnterpriseLeadDocumentExtractionStatus.Pending ||
        extractionStatus === EnterpriseLeadDocumentExtractionStatus.Failed ||
        vectorIndexStatus === EnterpriseLeadKnowledgeIndexStatus.Failed)
    );
  }
  return (
    extractionStatus !== EnterpriseLeadDocumentExtractionStatus.Extracted ||
    vectorIndexStatus !== EnterpriseLeadKnowledgeIndexStatus.Indexed
  );
};

export const getEnterpriseLeadKnowledgeVectorIndexSummary = (
  source?: Pick<
    EnterpriseLeadExtractionSource,
    'vectorChunkCount' | 'vectorIndexError' | 'vectorIndexStatus'
  >,
): string => {
  const status = getEnterpriseLeadKnowledgeVectorIndexStatus(source);
  if (status === EnterpriseLeadKnowledgeIndexStatus.Indexed) {
    const chunkCount = source?.vectorChunkCount ?? 0;
    if (chunkCount <= 0) {
      // Indexed without chunks is typical for non-text sources like images.
      return i18nService.t('enterpriseLeadKnowledgeVectorImageNoIndexText');
    }
    return i18nService
      .t('enterpriseLeadKnowledgeVectorIndexedText')
      .replace('{count}', String(chunkCount));
  }
  if (status === EnterpriseLeadKnowledgeIndexStatus.Failed) {
    return source?.vectorIndexError || i18nService.t('enterpriseLeadKnowledgeVectorFailedText');
  }
  if (status === EnterpriseLeadKnowledgeIndexStatus.Indexing) {
    return i18nService.t('enterpriseLeadKnowledgeVectorIndexingText');
  }
  return i18nService.t('enterpriseLeadKnowledgeVectorPendingText');
};

const getDocumentStatusDescription = (status: string): string =>
  i18nService.t(
    documentStatusTextKeys[status] ?? 'enterpriseLeadKnowledgeDocumentPendingExtractText',
  );

export const getEnterpriseLeadKnowledgeDocumentStatusDescription = (
  source?: Pick<
    EnterpriseLeadExtractionSource,
    | 'extractionPartial'
    | 'extractionProgressCurrent'
    | 'extractionProgressTotal'
    | 'extractionStage'
    | 'extractionStatus'
    | 'text'
  >,
): string => {
  const status = getDocumentExtractionStatus(source);
  if (
    status === EnterpriseLeadDocumentExtractionStatus.Extracting &&
    source?.extractionStage === EnterpriseLeadDocumentExtractionStage.ExtractingChunks
  ) {
    return i18nService
      .t('enterpriseLeadKnowledgeDocumentExtractingChunksText')
      .replace('{current}', String(source.extractionProgressCurrent ?? 0))
      .replace('{total}', String(source.extractionProgressTotal ?? 0));
  }
  if (
    status === EnterpriseLeadDocumentExtractionStatus.Extracting &&
    source?.extractionStage === EnterpriseLeadDocumentExtractionStage.Merging
  ) {
    return i18nService.t('enterpriseLeadKnowledgeDocumentMergingText');
  }
  if (status === EnterpriseLeadDocumentExtractionStatus.Extracted && source?.extractionPartial) {
    return i18nService.t('enterpriseLeadKnowledgeDocumentPartialExtractedText');
  }
  return getDocumentStatusDescription(status);
};

export type KnowledgeView = 'documents' | 'knowledge';
export type KnowledgeStatusFilter = 'all' | 'pending' | 'confirmed' | 'editable';
export type DocumentStatusFilter =
  | 'all'
  | typeof EnterpriseLeadDocumentExtractionStatus.Pending
  | typeof EnterpriseLeadDocumentExtractionStatus.Extracting
  | typeof EnterpriseLeadDocumentExtractionStatus.Extracted
  | typeof EnterpriseLeadDocumentExtractionStatus.Failed;
export const EnterpriseLeadKnowledgeMetric = {
  Documents: 'documents',
  All: 'knowledge_all',
  Pending: 'knowledge_pending',
  Confirmed: 'knowledge_confirmed',
} as const;
export type EnterpriseLeadKnowledgeMetricId =
  (typeof EnterpriseLeadKnowledgeMetric)[keyof typeof EnterpriseLeadKnowledgeMetric];
export interface EnterpriseLeadKnowledgeMetricFilter {
  activeView: KnowledgeView;
  documentStatusFilter: DocumentStatusFilter;
  statusFilter: KnowledgeStatusFilter;
}

export const getEnterpriseLeadKnowledgeMetricFilter = (
  metricId: EnterpriseLeadKnowledgeMetricId,
): EnterpriseLeadKnowledgeMetricFilter => {
  switch (metricId) {
    case EnterpriseLeadKnowledgeMetric.Documents:
      return {
        activeView: 'documents',
        documentStatusFilter: 'all',
        statusFilter: 'all',
      };
    case EnterpriseLeadKnowledgeMetric.Pending:
      return {
        activeView: 'knowledge',
        documentStatusFilter: 'all',
        statusFilter: 'pending',
      };
    case EnterpriseLeadKnowledgeMetric.Confirmed:
      return {
        activeView: 'knowledge',
        documentStatusFilter: 'all',
        statusFilter: 'confirmed',
      };
    case EnterpriseLeadKnowledgeMetric.All:
    default:
      return {
        activeView: 'knowledge',
        documentStatusFilter: 'all',
        statusFilter: 'all',
      };
  }
};

export const shouldShowEnterpriseLeadKnowledgeDetailPanel = (
  _activeView: KnowledgeView,
  _selectedItemId: string,
): boolean => false;
type ModalMode = 'none' | 'company';

interface KnowledgeTableRow {
  item: WorkspaceKnowledgeItem;
  section: ReturnType<typeof getWorkspaceKnowledgeSections>[number];
}

function getFileNameFromPath(filePath: string): string {
  const normalized = filePath.trim();
  if (!normalized) {
    return '';
  }
  return normalized.split(/[\\/]/).filter(Boolean).pop() ?? normalized;
}

function getFileExtension(filePath: string): string {
  const fileName = getFileNameFromPath(filePath);
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex > -1 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
}

const normalizeEnterpriseLeadKnowledgeQuery = (query: string): string => query.trim().toLowerCase();

export const doesEnterpriseLeadKnowledgeDocumentMatchQuery = (
  item: WorkspaceKnowledgeItem,
  source: EnterpriseLeadExtractionSource | undefined,
  query: string,
): boolean => {
  const normalizedQuery = normalizeEnterpriseLeadKnowledgeQuery(query);
  if (!normalizedQuery) {
    return true;
  }

  return [
    item.text,
    item.secondaryText,
    item.metaText,
    source?.label,
    source?.kind,
    source?.fileName,
    source?.filePath,
    source?.summary,
    source?.text,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(normalizedQuery);
};

export const canPreviewEnterpriseLeadOriginalDocument = (
  source?: Pick<EnterpriseLeadExtractionSource, 'fileName' | 'filePath'>,
): boolean => {
  const filePath = source?.filePath?.trim();
  if (!filePath) {
    return false;
  }
  return enterpriseLeadOriginalDocumentPreviewExtensions.has(
    getFileExtension(source?.fileName || filePath),
  );
};

export const shouldShowEnterpriseLeadKnowledgeToolbarAddAction = (
  activeView: KnowledgeView,
): boolean => activeView === 'knowledge';

export const getEnterpriseLeadKnowledgeToolbarGridClassName = (activeView: KnowledgeView): string =>
  `grid gap-3 border-b border-border px-5 py-3 ${
    activeView === 'knowledge'
      ? 'md:grid-cols-[minmax(0,1fr)_180px_auto_auto]'
      : 'md:grid-cols-[minmax(0,1fr)_180px]'
  }`;

export interface CompanyDraft {
  companySummary: string;
  productList: string;
  productCapabilities: string;
  targetCustomers: string;
  applicationScenarios: string;
  sellingPoints: string;
  channelPreferences: string;
  prohibitedClaims: string;
  contactRules: string;
  missingInfo: string;
}

type CompanyDraftField = keyof CompanyDraft;

interface CompanyDraftFieldConfig {
  field: CompanyDraftField;
  labelKey: string;
}

interface CompanyDraftGroup {
  id: string;
  titleKey: string;
  fields: CompanyDraftField[];
}

const companyDraftFieldConfigs: CompanyDraftFieldConfig[] = [
  {
    field: 'companySummary',
    labelKey: 'enterpriseLeadKnowledgeCompanySummaryField',
  },
  {
    field: 'productList',
    labelKey: 'enterpriseLeadKnowledgeProductListField',
  },
  {
    field: 'productCapabilities',
    labelKey: 'enterpriseLeadKnowledgeProductCapabilitiesField',
  },
  {
    field: 'targetCustomers',
    labelKey: 'enterpriseLeadKnowledgeTargetCustomersField',
  },
  {
    field: 'applicationScenarios',
    labelKey: 'enterpriseLeadKnowledgeApplicationScenariosField',
  },
  {
    field: 'sellingPoints',
    labelKey: 'enterpriseLeadKnowledgeSellingPointsField',
  },
  {
    field: 'channelPreferences',
    labelKey: 'enterpriseLeadKnowledgeChannelPreferencesField',
  },
  {
    field: 'prohibitedClaims',
    labelKey: 'enterpriseLeadKnowledgeProhibitedClaimsField',
  },
  {
    field: 'contactRules',
    labelKey: 'enterpriseLeadKnowledgeContactRulesField',
  },
  {
    field: 'missingInfo',
    labelKey: 'enterpriseLeadKnowledgeMissingInfoField',
  },
];

const companyDraftGroups: CompanyDraftGroup[] = [
  {
    fields: ['companySummary', 'missingInfo'],
    id: 'overview',
    titleKey: 'enterpriseLeadKnowledgeCompanyGroupOverview',
  },
  {
    fields: ['productList', 'productCapabilities'],
    id: 'products',
    titleKey: 'enterpriseLeadKnowledgeCompanyGroupProducts',
  },
  {
    fields: ['targetCustomers', 'applicationScenarios'],
    id: 'customers',
    titleKey: 'enterpriseLeadKnowledgeCompanyGroupCustomers',
  },
  {
    fields: ['sellingPoints', 'channelPreferences'],
    id: 'selling',
    titleKey: 'enterpriseLeadKnowledgeCompanyGroupSelling',
  },
  {
    fields: ['prohibitedClaims', 'contactRules'],
    id: 'rules',
    titleKey: 'enterpriseLeadKnowledgeCompanyGroupRules',
  },
];

const defaultCompanyDraftFieldConfig = companyDraftFieldConfigs[0] as CompanyDraftFieldConfig;

const getCompanyDraftFieldConfig = (field: CompanyDraftField): CompanyDraftFieldConfig =>
  companyDraftFieldConfigs.find(config => config.field === field) ?? defaultCompanyDraftFieldConfig;

const getCompanyDraftValueCount = (value: string): number => {
  const lines = cleanLines(value);
  if (lines.length > 0) {
    return lines.length;
  }
  return value.trim() ? 1 : 0;
};

const buildCompanyDraft = (profile: EnterpriseLeadWorkspaceProfile): CompanyDraft => ({
  companySummary: profile.companySummary,
  productList: joinLines(profile.productList),
  productCapabilities: joinLines(profile.productCapabilities),
  targetCustomers: joinLines(profile.targetCustomers),
  applicationScenarios: joinLines(profile.applicationScenarios),
  sellingPoints: joinLines(profile.sellingPoints),
  channelPreferences: joinLines(profile.channelPreferences),
  prohibitedClaims: joinLines(profile.prohibitedClaims),
  contactRules: joinLines(profile.contactRules),
  missingInfo: joinLines(profile.missingInfo),
});

export interface EnterpriseLeadCompanyDraftWorkspaceRefreshResult {
  workspace: EnterpriseLeadWorkspace;
  companyDraft: CompanyDraft;
  touchedFields: Set<KnowledgeFactDomain>;
  resetDraft: boolean;
}

export const reconcileEnterpriseLeadCompanyDraftWorkspaceRefresh = (input: {
  currentWorkspace: EnterpriseLeadWorkspace;
  incomingWorkspace: EnterpriseLeadWorkspace;
  companyDraft: CompanyDraft;
  touchedFields: Set<KnowledgeFactDomain>;
}): EnterpriseLeadCompanyDraftWorkspaceRefreshResult => {
  const isSameWorkspace = input.currentWorkspace.id === input.incomingWorkspace.id;
  if (
    isSameWorkspace &&
    input.incomingWorkspace.profileRevision < input.currentWorkspace.profileRevision
  ) {
    return {
      workspace: input.currentWorkspace,
      companyDraft: input.companyDraft,
      touchedFields: input.touchedFields,
      resetDraft: false,
    };
  }
  if (
    isSameWorkspace &&
    input.incomingWorkspace.profileRevision === input.currentWorkspace.profileRevision
  ) {
    return {
      workspace: input.incomingWorkspace,
      companyDraft: input.companyDraft,
      touchedFields: input.touchedFields,
      resetDraft: false,
    };
  }
  return {
    workspace: input.incomingWorkspace,
    companyDraft: buildCompanyDraft(input.incomingWorkspace.profile),
    touchedFields: new Set(),
    resetDraft: true,
  };
};

const applyCompanyDraft = (
  profile: EnterpriseLeadWorkspaceProfile,
  draft: CompanyDraft,
): EnterpriseLeadWorkspaceProfile => ({
  ...cloneProfile(profile),
  companySummary: draft.companySummary.trim(),
  productList: cleanLines(draft.productList),
  productCapabilities: cleanLines(draft.productCapabilities),
  targetCustomers: cleanLines(draft.targetCustomers),
  applicationScenarios: cleanLines(draft.applicationScenarios),
  sellingPoints: cleanLines(draft.sellingPoints),
  channelPreferences: cleanLines(draft.channelPreferences),
  prohibitedClaims: cleanLines(draft.prohibitedClaims),
  contactRules: cleanLines(draft.contactRules),
  missingInfo: cleanLines(draft.missingInfo),
});

export const markEnterpriseLeadCompanyFieldTouched = (
  current: ReadonlySet<KnowledgeFactDomain>,
  field: KnowledgeFactDomain,
): Set<KnowledgeFactDomain> => new Set([...current, field]);

export const updateEnterpriseLeadCompanyDraftField = (input: {
  isSaving: boolean;
  field: KnowledgeFactDomain;
  value: string;
  companyDraft: CompanyDraft;
  touchedFields: Set<KnowledgeFactDomain>;
}): {
  companyDraft: CompanyDraft;
  touchedFields: Set<KnowledgeFactDomain>;
} => {
  if (input.isSaving) {
    return {
      companyDraft: input.companyDraft,
      touchedFields: input.touchedFields,
    };
  }
  return {
    companyDraft: {
      ...input.companyDraft,
      [input.field]: input.value,
    },
    touchedFields: markEnterpriseLeadCompanyFieldTouched(input.touchedFields, input.field),
  };
};

export const mergeEnterpriseLeadProfileConflict = (
  currentWorkspace: EnterpriseLeadWorkspace,
  submittedWorkspaceId: string,
  latestProfile: EnterpriseLeadProfileConflictSnapshot,
): EnterpriseLeadWorkspace | null => {
  if (
    latestProfile.id !== submittedWorkspaceId ||
    currentWorkspace.id !== submittedWorkspaceId ||
    latestProfile.profileRevision < currentWorkspace.profileRevision
  ) {
    return null;
  }
  return {
    ...currentWorkspace,
    id: latestProfile.id,
    profile: latestProfile.profile,
    profileRevision: latestProfile.profileRevision,
    updatedAt: latestProfile.updatedAt,
  };
};

export interface EnterpriseLeadProfileSaveRequestScope {
  mounted: boolean;
  workspaceId: string;
  profileRevision: number;
  requestEpoch: number;
}

interface EnterpriseLeadProfileSaveRequestToken {
  workspaceId: string;
  requestEpoch: number;
}

export const EnterpriseLeadProfileSaveScopeUpdate = {
  Ignored: 'ignored',
  ProfileChanged: 'profile_changed',
  ProjectionChanged: 'projection_changed',
  WorkspaceChanged: 'workspace_changed',
} as const;
export type EnterpriseLeadProfileSaveScopeUpdate =
  (typeof EnterpriseLeadProfileSaveScopeUpdate)[keyof typeof EnterpriseLeadProfileSaveScopeUpdate];

export const EnterpriseLeadProfileSaveRequestOutcome = {
  Conflict: 'conflict',
  Failure: 'failure',
  Ignored: 'ignored',
  Success: 'success',
} as const;
export type EnterpriseLeadProfileSaveRequestOutcome =
  (typeof EnterpriseLeadProfileSaveRequestOutcome)[keyof typeof EnterpriseLeadProfileSaveRequestOutcome];

export const createEnterpriseLeadProfileSaveRequestScope = (
  workspace: Pick<EnterpriseLeadWorkspace, 'id' | 'profileRevision'>,
): EnterpriseLeadProfileSaveRequestScope => ({
  mounted: false,
  workspaceId: workspace.id,
  profileRevision: workspace.profileRevision,
  requestEpoch: 0,
});

export const setEnterpriseLeadProfileSaveRequestMounted = (
  scope: EnterpriseLeadProfileSaveRequestScope,
  mounted: boolean,
): void => {
  if (scope.mounted === mounted) {
    return;
  }
  scope.mounted = mounted;
  if (!mounted) {
    scope.requestEpoch += 1;
  }
};

export const synchronizeEnterpriseLeadProfileSaveRequestScope = (
  scope: EnterpriseLeadProfileSaveRequestScope,
  workspace: Pick<EnterpriseLeadWorkspace, 'id' | 'profileRevision'>,
): EnterpriseLeadProfileSaveScopeUpdate => {
  if (scope.workspaceId !== workspace.id) {
    scope.workspaceId = workspace.id;
    scope.profileRevision = workspace.profileRevision;
    scope.requestEpoch += 1;
    return EnterpriseLeadProfileSaveScopeUpdate.WorkspaceChanged;
  }
  if (workspace.profileRevision < scope.profileRevision) {
    return EnterpriseLeadProfileSaveScopeUpdate.Ignored;
  }
  if (workspace.profileRevision > scope.profileRevision) {
    scope.profileRevision = workspace.profileRevision;
    scope.requestEpoch += 1;
    return EnterpriseLeadProfileSaveScopeUpdate.ProfileChanged;
  }
  return EnterpriseLeadProfileSaveScopeUpdate.ProjectionChanged;
};

const beginEnterpriseLeadProfileSaveRequest = (
  scope: EnterpriseLeadProfileSaveRequestScope,
  submittedWorkspace: Pick<EnterpriseLeadWorkspace, 'id' | 'profileRevision'>,
): EnterpriseLeadProfileSaveRequestToken | null => {
  if (
    !scope.mounted ||
    scope.workspaceId !== submittedWorkspace.id ||
    scope.profileRevision !== submittedWorkspace.profileRevision
  ) {
    return null;
  }
  scope.requestEpoch += 1;
  return {
    workspaceId: scope.workspaceId,
    requestEpoch: scope.requestEpoch,
  };
};

const isEnterpriseLeadProfileSaveRequestCurrent = (
  scope: EnterpriseLeadProfileSaveRequestScope,
  token: EnterpriseLeadProfileSaveRequestToken,
): boolean =>
  scope.mounted &&
  scope.workspaceId === token.workspaceId &&
  scope.requestEpoch === token.requestEpoch;

const acceptEnterpriseLeadProfileSaveResponse = (
  scope: EnterpriseLeadProfileSaveRequestScope,
  token: EnterpriseLeadProfileSaveRequestToken,
  workspace: EnterpriseLeadWorkspace,
): boolean => {
  if (
    !isEnterpriseLeadProfileSaveRequestCurrent(scope, token) ||
    workspace.id !== token.workspaceId ||
    workspace.profileRevision < scope.profileRevision
  ) {
    return false;
  }
  scope.profileRevision = workspace.profileRevision;
  return true;
};

export const runEnterpriseLeadProfileSaveRequest = async (input: {
  scope: EnterpriseLeadProfileSaveRequestScope;
  submittedWorkspace: EnterpriseLeadWorkspace;
  execute: () => Promise<EnterpriseLeadWorkspace | null>;
  resolveConflict: (error: unknown) => EnterpriseLeadWorkspace | null | undefined;
  onStarted: () => void;
  onSuccess: (workspace: EnterpriseLeadWorkspace) => void;
  onConflict: (workspace: EnterpriseLeadWorkspace) => void;
  onFailure: (error: unknown) => void;
  onSettled: () => void;
}): Promise<EnterpriseLeadProfileSaveRequestOutcome> => {
  const token = beginEnterpriseLeadProfileSaveRequest(input.scope, input.submittedWorkspace);
  if (!token) {
    return EnterpriseLeadProfileSaveRequestOutcome.Ignored;
  }
  input.onStarted();
  try {
    const updatedWorkspace = await input.execute();
    if (!isEnterpriseLeadProfileSaveRequestCurrent(input.scope, token)) {
      return EnterpriseLeadProfileSaveRequestOutcome.Ignored;
    }
    if (!updatedWorkspace) {
      input.onFailure(new Error('Workspace profile update returned empty result'));
      return EnterpriseLeadProfileSaveRequestOutcome.Failure;
    }
    if (!acceptEnterpriseLeadProfileSaveResponse(input.scope, token, updatedWorkspace)) {
      return EnterpriseLeadProfileSaveRequestOutcome.Ignored;
    }
    input.onSuccess(updatedWorkspace);
    return EnterpriseLeadProfileSaveRequestOutcome.Success;
  } catch (error) {
    if (!isEnterpriseLeadProfileSaveRequestCurrent(input.scope, token)) {
      return EnterpriseLeadProfileSaveRequestOutcome.Ignored;
    }
    const conflictWorkspace = input.resolveConflict(error);
    if (conflictWorkspace === null) {
      return EnterpriseLeadProfileSaveRequestOutcome.Ignored;
    }
    if (conflictWorkspace) {
      if (!acceptEnterpriseLeadProfileSaveResponse(input.scope, token, conflictWorkspace)) {
        return EnterpriseLeadProfileSaveRequestOutcome.Ignored;
      }
      input.onConflict(conflictWorkspace);
      return EnterpriseLeadProfileSaveRequestOutcome.Conflict;
    }
    input.onFailure(error);
    return EnterpriseLeadProfileSaveRequestOutcome.Failure;
  } finally {
    if (isEnterpriseLeadProfileSaveRequestCurrent(input.scope, token)) {
      input.onSettled();
    }
  }
};

export const refreshWorkspaceAfterKnowledgeDocumentMutation = async (input: {
  workspaceId: string;
  loadWorkspace: (workspaceId: string) => Promise<EnterpriseLeadWorkspace | null>;
  isCurrent: () => boolean;
  onWorkspaceUpdated: (workspace: EnterpriseLeadWorkspace) => void;
}): Promise<EnterpriseLeadWorkspace | null> => {
  if (!input.isCurrent()) {
    return null;
  }
  const updatedWorkspace = await input.loadWorkspace(input.workspaceId);
  if (!updatedWorkspace || updatedWorkspace.id !== input.workspaceId || !input.isCurrent()) {
    return null;
  }
  input.onWorkspaceUpdated(updatedWorkspace);
  return updatedWorkspace;
};

export interface EnterpriseLeadAiKnowledgeMetricValues {
  aiKnowledgeCount: number;
  pendingCount: number;
  confirmedCount: number;
}

export const getEnterpriseLeadAiKnowledgeMetricValues = (
  metrics: KnowledgeFactMetrics,
): EnterpriseLeadAiKnowledgeMetricValues => ({
  aiKnowledgeCount: metrics.totalAiKnowledgeCount,
  pendingCount: metrics.activePendingCount,
  confirmedCount:
    metrics.activeConfirmedCount +
    metrics.staleConfirmedCount +
    metrics.unduplicatedLegacyConfirmedCount,
});

export const isEnterpriseLeadAiProjectionRefreshRequestCurrent = (input: {
  request: unknown;
  requestGeneration: number;
  currentRequestGeneration: number;
  mounted: boolean;
  latestWorkspaceProp: Pick<EnterpriseLeadWorkspace, 'id' | 'profileRevision'>;
  currentWorkspace: Pick<EnterpriseLeadWorkspace, 'id' | 'profileRevision'>;
}): boolean => {
  if (!input.mounted || input.requestGeneration !== input.currentRequestGeneration) {
    return false;
  }
  if (!input.request || typeof input.request !== 'object' || Array.isArray(input.request)) {
    return false;
  }
  const request = input.request as Partial<{
    workspaceId: string;
    profileRevision: number;
  }>;
  if (
    typeof request.workspaceId !== 'string' ||
    request.workspaceId.length === 0 ||
    !Number.isSafeInteger(request.profileRevision) ||
    (request.profileRevision ?? 0) <= 0
  ) {
    return false;
  }
  return (
    request.workspaceId === input.latestWorkspaceProp.id &&
    request.workspaceId === input.currentWorkspace.id &&
    (request.profileRevision as number) >= input.latestWorkspaceProp.profileRevision &&
    (request.profileRevision as number) >= input.currentWorkspace.profileRevision
  );
};

export const refreshWorkspaceAfterAiKnowledgeProjectionMutation = async (input: {
  request: { workspaceId: string; profileRevision: number };
  loadWorkspace: (workspaceId: string) => Promise<EnterpriseLeadWorkspace | null>;
  isCurrent: () => boolean;
  onWorkspaceUpdated: (workspace: EnterpriseLeadWorkspace) => void;
}): Promise<EnterpriseLeadWorkspace | null> => {
  if (
    !input.request.workspaceId ||
    !Number.isSafeInteger(input.request.profileRevision) ||
    input.request.profileRevision <= 0 ||
    !input.isCurrent()
  ) {
    return null;
  }
  const updatedWorkspace = await input.loadWorkspace(input.request.workspaceId);
  if (!input.isCurrent()) {
    return null;
  }
  if (
    !updatedWorkspace ||
    updatedWorkspace.id !== input.request.workspaceId ||
    !Number.isSafeInteger(updatedWorkspace.profileRevision) ||
    updatedWorkspace.profileRevision < input.request.profileRevision ||
    !input.isCurrent()
  ) {
    return null;
  }
  input.onWorkspaceUpdated(updatedWorkspace);
  return updatedWorkspace;
};

interface EnterpriseLeadAiKnowledgeMetricsOwner {
  workspaceId: string;
  profileRevision: number;
  contextToken: EnterpriseLeadWorkspaceRenderContextToken;
  metrics: KnowledgeFactMetrics;
}

interface EnterpriseLeadWorkspaceRenderContextToken {
  workspaceId: string;
  profileRevision: number;
}

const advanceEnterpriseLeadWorkspaceAcceptanceEpoch = (epoch: { current: number }): void => {
  epoch.current += 1;
};

const claimEnterpriseLeadWorkspaceAcceptanceEpoch = (
  epoch: { current: number },
  expectedEpoch: number,
): boolean => {
  if (epoch.current !== expectedEpoch) {
    return false;
  }
  advanceEnterpriseLeadWorkspaceAcceptanceEpoch(epoch);
  return true;
};

export const WorkspaceKnowledgeBase: React.FC<WorkspaceKnowledgeBaseProps> = ({
  workspace,
  initialImportResult,
  onInitialImportResultConsumed,
  onWorkspaceUpdated,
}) => {
  const [currentWorkspace, setCurrentWorkspace] = useState(workspace);
  const [snapshot, setSnapshot] = useState<EnterpriseLeadWorkspaceSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isVectorSyncing, setIsVectorSyncing] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<EnterpriseLeadKnowledgeMessage | null>(
    null,
  );
  const [activeView, setActiveView] = useState<KnowledgeView>('documents');
  const [pendingInitialImportResult, setPendingInitialImportResult] = useState(initialImportResult);
  const [normalizedDocumentCount, setNormalizedDocumentCount] = useState<number | null>(null);
  const [knowledgeDocumentsRefreshToken, setKnowledgeDocumentsRefreshToken] = useState(0);
  const consumedInitialImportResultRef = useRef<KnowledgeImportBatchResult>();
  const workspaceProjectionRefreshRequestRef = useRef(0);
  const workspaceProjectionMountedRef = useRef(false);
  const aiProjectionRefreshRequestRef = useRef(0);
  const aiProjectionMountedRef = useRef(false);
  const aiMetricsRefreshRequestRef = useRef(0);
  const workspaceRenderContextToken = useMemo<EnterpriseLeadWorkspaceRenderContextToken>(
    () => ({
      workspaceId: workspace.id,
      profileRevision: workspace.profileRevision,
    }),
    [workspace.id, workspace.profileRevision],
  );
  const workspacePropRef = useRef(workspace);
  const workspaceIdRef = useRef(workspace.id);
  const committedWorkspaceContextTokenRef = useRef(workspaceRenderContextToken);
  const workspaceAcceptanceEpochRef = useRef(0);
  const [aiMetricsOwner, setAiMetricsOwner] =
    useState<EnterpriseLeadAiKnowledgeMetricsOwner | null>(null);
  const [modalMode, setModalMode] = useState<ModalMode>('none');
  const [activeCompanyField, setActiveCompanyField] = useState<CompanyDraftField>('companySummary');
  const [companyDraft, setCompanyDraft] = useState<CompanyDraft>(() =>
    buildCompanyDraft(workspace.profile),
  );
  const [companyTouchedFields, setCompanyTouchedFields] = useState<Set<KnowledgeFactDomain>>(
    new Set(),
  );
  const companyDraftRef = useRef(companyDraft);
  const companyTouchedFieldsRef = useRef(companyTouchedFields);
  companyDraftRef.current = companyDraft;
  companyTouchedFieldsRef.current = companyTouchedFields;
  const requestRef = useRef(0);
  const currentWorkspaceRef = useRef(currentWorkspace);
  const profileSaveRequestScopeRef = useRef(
    createEnterpriseLeadProfileSaveRequestScope(workspace),
  );
  useLayoutEffect(() => {
    const didCommittedWorkspaceChange =
      workspacePropRef.current !== workspace ||
      committedWorkspaceContextTokenRef.current !== workspaceRenderContextToken;
    workspacePropRef.current = workspace;
    workspaceIdRef.current = workspace.id;
    committedWorkspaceContextTokenRef.current = workspaceRenderContextToken;
    if (didCommittedWorkspaceChange) {
      advanceEnterpriseLeadWorkspaceAcceptanceEpoch(workspaceAcceptanceEpochRef);
    }
    synchronizeEnterpriseLeadProfileSaveRequestScope(
      profileSaveRequestScopeRef.current,
      workspace,
    );
  }, [workspace, workspaceRenderContextToken]);
  const automaticVectorSyncKeysRef = useRef<Set<string>>(new Set());
  const automaticVectorSyncPromiseRef = useRef<Promise<EnterpriseLeadWorkspace | null> | null>(
    null,
  );
  const showFeedbackMessage = (
    tone: EnterpriseLeadKnowledgeMessageTone,
    messageKey: string,
    values?: Record<string, string | number>,
  ): void => {
    setFeedbackMessage({
      text: formatEnterpriseLeadKnowledgeMessage(messageKey, values),
      tone,
    });
  };
  const clearFeedbackMessage = (): void => {
    setFeedbackMessage(null);
  };

  useEffect(() => {
    if (!feedbackMessage) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setFeedbackMessage(current => (current === feedbackMessage ? null : current));
    }, getEnterpriseLeadKnowledgeMessageAutoDismissMs(feedbackMessage.tone));

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [feedbackMessage]);

  useEffect(() => {
    const requestScope = profileSaveRequestScopeRef.current;
    setEnterpriseLeadProfileSaveRequestMounted(requestScope, true);
    return () => {
      setEnterpriseLeadProfileSaveRequestMounted(requestScope, false);
    };
  }, []);

  useEffect(() => {
    const reconciled = reconcileEnterpriseLeadCompanyDraftWorkspaceRefresh({
      currentWorkspace: currentWorkspaceRef.current,
      incomingWorkspace: workspace,
      companyDraft: companyDraftRef.current,
      touchedFields: companyTouchedFieldsRef.current,
    });
    if (reconciled.workspace === currentWorkspaceRef.current && reconciled.workspace !== workspace) {
      return;
    }
    currentWorkspaceRef.current = reconciled.workspace;
    setCurrentWorkspace(reconciled.workspace);
    if (reconciled.resetDraft) {
      companyDraftRef.current = reconciled.companyDraft;
      companyTouchedFieldsRef.current = reconciled.touchedFields;
      setCompanyDraft(reconciled.companyDraft);
      setCompanyTouchedFields(reconciled.touchedFields);
      setIsSaving(false);
    }
  }, [workspace]);

  useEffect(() => {
    if (!initialImportResult || consumedInitialImportResultRef.current === initialImportResult) {
      return;
    }
    consumedInitialImportResultRef.current = initialImportResult;
    setPendingInitialImportResult(initialImportResult);
    onInitialImportResultConsumed?.(workspace.id);
  }, [initialImportResult, onInitialImportResultConsumed, workspace.id]);

  useEffect(() => {
    if (activeView !== 'documents') {
      setPendingInitialImportResult(undefined);
    }
  }, [activeView]);

  useEffect(() => {
    workspaceProjectionMountedRef.current = true;
    aiProjectionMountedRef.current = true;
    return () => {
      workspaceProjectionMountedRef.current = false;
      workspaceProjectionRefreshRequestRef.current += 1;
      aiProjectionMountedRef.current = false;
      aiProjectionRefreshRequestRef.current += 1;
      aiMetricsRefreshRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setSnapshot(null);
    clearFeedbackMessage();
    setIsLoading(true);

    enterpriseLeadWorkspaceService
      .getRun(workspace.id, workspace.recentRunId ?? undefined)
      .then(nextSnapshot => {
        if (requestRef.current !== requestId) {
          return;
        }
        setSnapshot(nextSnapshot);
      })
      .catch(() => {
        if (requestRef.current === requestId) {
          showFeedbackMessage('exception', 'enterpriseLeadKnowledgeLoadFailed');
        }
      })
      .finally(() => {
        if (requestRef.current === requestId) {
          setIsLoading(false);
        }
      });

    return () => {
      requestRef.current += 1;
    };
  }, [workspace.id, workspace.recentRunId]);

  const sections = useMemo(
    () => getWorkspaceKnowledgeSections(currentWorkspace, snapshot),
    [currentWorkspace, snapshot],
  );

  const handleWorkspaceProjectionChange = async (): Promise<void> => {
    const workspaceId = currentWorkspace.id;
    const workspacePropAtRequest = workspacePropRef.current;
    const workspaceContextTokenAtRequest = committedWorkspaceContextTokenRef.current;
    const workspaceAcceptanceEpochAtRequest = workspaceAcceptanceEpochRef.current;
    const requestId = workspaceProjectionRefreshRequestRef.current + 1;
    workspaceProjectionRefreshRequestRef.current = requestId;
    const isCurrent = (): boolean =>
      workspaceProjectionMountedRef.current &&
      workspaceProjectionRefreshRequestRef.current === requestId &&
      workspacePropRef.current === workspacePropAtRequest &&
      workspaceIdRef.current === workspaceId &&
      committedWorkspaceContextTokenRef.current === workspaceContextTokenAtRequest &&
      workspaceAcceptanceEpochRef.current === workspaceAcceptanceEpochAtRequest;
    await refreshWorkspaceAfterKnowledgeDocumentMutation({
      workspaceId,
      loadWorkspace: id => enterpriseLeadWorkspaceService.getWorkspace(id),
      isCurrent,
      onWorkspaceUpdated: updatedWorkspace => {
        if (!isCurrent()) {
          return;
        }
        const reconciled = reconcileEnterpriseLeadCompanyDraftWorkspaceRefresh({
          currentWorkspace: currentWorkspaceRef.current,
          incomingWorkspace: updatedWorkspace,
          companyDraft: companyDraftRef.current,
          touchedFields: companyTouchedFieldsRef.current,
        });
        if (
          reconciled.workspace === currentWorkspaceRef.current &&
          reconciled.workspace !== updatedWorkspace
        ) {
          return;
        }
        if (!isCurrent()) {
          return;
        }
        if (
          !claimEnterpriseLeadWorkspaceAcceptanceEpoch(
            workspaceAcceptanceEpochRef,
            workspaceAcceptanceEpochAtRequest,
          )
        ) {
          return;
        }
        synchronizeEnterpriseLeadProfileSaveRequestScope(
          profileSaveRequestScopeRef.current,
          reconciled.workspace,
        );
        currentWorkspaceRef.current = reconciled.workspace;
        setCurrentWorkspace(reconciled.workspace);
        if (reconciled.resetDraft) {
          companyDraftRef.current = reconciled.companyDraft;
          companyTouchedFieldsRef.current = reconciled.touchedFields;
          setCompanyDraft(reconciled.companyDraft);
          setCompanyTouchedFields(reconciled.touchedFields);
          setIsSaving(false);
        }
        onWorkspaceUpdated?.(updatedWorkspace);
      },
    });
  };

  const handleAiKnowledgeMetricsChange = (metrics: KnowledgeFactMetrics): void => {
    const owner: EnterpriseLeadAiKnowledgeMetricsOwner = {
      workspaceId: currentWorkspace.id,
      profileRevision: currentWorkspace.profileRevision,
      contextToken: workspaceRenderContextToken,
      metrics,
    };
    const latestWorkspaceProp = workspacePropRef.current;
    const acceptedWorkspace = currentWorkspaceRef.current;
    if (
      owner.contextToken !== committedWorkspaceContextTokenRef.current ||
      owner.workspaceId !== latestWorkspaceProp.id ||
      owner.profileRevision !== latestWorkspaceProp.profileRevision ||
      owner.workspaceId !== acceptedWorkspace.id ||
      owner.profileRevision !== acceptedWorkspace.profileRevision
    ) {
      return;
    }
    aiMetricsRefreshRequestRef.current += 1;
    setAiMetricsOwner(owner);
    setKnowledgeDocumentsRefreshToken(current => current + 1);
  };

  const handleAiKnowledgeMetricsRefresh = async (): Promise<void> => {
    const owner = {
      workspaceId: currentWorkspace.id,
      profileRevision: currentWorkspace.profileRevision,
      contextToken: workspaceRenderContextToken,
    };
    const isOwnerCurrent = (): boolean => {
      const latestWorkspaceProp = workspacePropRef.current;
      const acceptedWorkspace = currentWorkspaceRef.current;
      return (
        workspaceProjectionMountedRef.current &&
        owner.contextToken === committedWorkspaceContextTokenRef.current &&
        owner.workspaceId === latestWorkspaceProp.id &&
        owner.profileRevision === latestWorkspaceProp.profileRevision &&
        owner.workspaceId === acceptedWorkspace.id &&
        owner.profileRevision === acceptedWorkspace.profileRevision
      );
    };
    if (!isOwnerCurrent()) {
      return;
    }
    const requestId = aiMetricsRefreshRequestRef.current + 1;
    aiMetricsRefreshRequestRef.current = requestId;
    try {
      const result = await knowledgeBaseService.listFacts({
        workspaceId: owner.workspaceId,
        limit: 1,
      });
      if (aiMetricsRefreshRequestRef.current !== requestId || !isOwnerCurrent()) {
        return;
      }
      handleAiKnowledgeMetricsChange(result.metrics);
    } catch {
      // Document extraction remains usable when this best-effort metric refresh fails.
    }
  };

  const handleAiKnowledgeProjectionRefresh = async (request: {
    workspaceId: string;
    profileRevision: number;
  }): Promise<void> => {
    const requestGeneration = aiProjectionRefreshRequestRef.current + 1;
    const workspaceContextTokenAtRequest = committedWorkspaceContextTokenRef.current;
    const workspaceAcceptanceEpochAtRequest = workspaceAcceptanceEpochRef.current;
    const canStart = isEnterpriseLeadAiProjectionRefreshRequestCurrent({
      request,
      requestGeneration,
      currentRequestGeneration: requestGeneration,
      mounted: aiProjectionMountedRef.current,
      latestWorkspaceProp: workspacePropRef.current,
      currentWorkspace: currentWorkspaceRef.current,
    }) &&
      committedWorkspaceContextTokenRef.current === workspaceContextTokenAtRequest &&
      workspaceAcceptanceEpochRef.current === workspaceAcceptanceEpochAtRequest;
    if (!canStart) {
      return;
    }
    aiProjectionRefreshRequestRef.current = requestGeneration;
    const isCurrent = (): boolean =>
      isEnterpriseLeadAiProjectionRefreshRequestCurrent({
        request,
        requestGeneration,
        currentRequestGeneration: aiProjectionRefreshRequestRef.current,
        mounted: aiProjectionMountedRef.current,
        latestWorkspaceProp: workspacePropRef.current,
        currentWorkspace: currentWorkspaceRef.current,
      }) &&
      committedWorkspaceContextTokenRef.current === workspaceContextTokenAtRequest &&
      workspaceAcceptanceEpochRef.current === workspaceAcceptanceEpochAtRequest;

    await refreshWorkspaceAfterAiKnowledgeProjectionMutation({
      request,
      loadWorkspace: id => enterpriseLeadWorkspaceService.getWorkspace(id),
      isCurrent,
      onWorkspaceUpdated: updatedWorkspace => {
        if (!isCurrent()) {
          return;
        }
        const reconciled = reconcileEnterpriseLeadCompanyDraftWorkspaceRefresh({
          currentWorkspace: currentWorkspaceRef.current,
          incomingWorkspace: updatedWorkspace,
          companyDraft: companyDraftRef.current,
          touchedFields: companyTouchedFieldsRef.current,
        });
        if (
          reconciled.workspace === currentWorkspaceRef.current &&
          reconciled.workspace !== updatedWorkspace
        ) {
          return;
        }
        if (!isCurrent()) {
          return;
        }
        if (
          !claimEnterpriseLeadWorkspaceAcceptanceEpoch(
            workspaceAcceptanceEpochRef,
            workspaceAcceptanceEpochAtRequest,
          )
        ) {
          return;
        }
        synchronizeEnterpriseLeadProfileSaveRequestScope(
          profileSaveRequestScopeRef.current,
          reconciled.workspace,
        );
        currentWorkspaceRef.current = reconciled.workspace;
        setCurrentWorkspace(reconciled.workspace);
        if (reconciled.resetDraft) {
          companyDraftRef.current = reconciled.companyDraft;
          companyTouchedFieldsRef.current = reconciled.touchedFields;
          setCompanyDraft(reconciled.companyDraft);
          setCompanyTouchedFields(reconciled.touchedFields);
          setIsSaving(false);
        }
        onWorkspaceUpdated?.(reconciled.workspace);
      },
    });
  };

  const documentRows = useMemo<KnowledgeTableRow[]>(() => {
    const sourcesSection = sections.find(
      section => section.id === EnterpriseLeadKnowledgeSection.Sources,
    );
    return sourcesSection?.items.map(item => ({ item, section: sourcesSection })) ?? [];
  }, [sections]);
  const hasCurrentAiMetrics = Boolean(
    aiMetricsOwner &&
      aiMetricsOwner.workspaceId === workspace.id &&
      aiMetricsOwner.profileRevision === workspace.profileRevision &&
      aiMetricsOwner.workspaceId === currentWorkspace.id &&
      aiMetricsOwner.profileRevision === currentWorkspace.profileRevision &&
      aiMetricsOwner.contextToken === workspaceRenderContextToken,
  );
  const aiMetricValues = hasCurrentAiMetrics && aiMetricsOwner
    ? getEnterpriseLeadAiKnowledgeMetricValues(aiMetricsOwner.metrics)
    : {
        aiKnowledgeCount: 0,
        pendingCount: 0,
        confirmedCount: 0,
      };
  const activeCompanyFieldConfig = getCompanyDraftFieldConfig(activeCompanyField);
  const activeCompanyValue = companyDraft[activeCompanyField];
  const activeCompanyValueCount = getCompanyDraftValueCount(activeCompanyValue);
  const documentCount = normalizedDocumentCount ?? documentRows.length;

  const saveProfile = async (
    nextProfile: EnterpriseLeadWorkspaceProfile,
    touchedFields: KnowledgeFactDomain[],
    successMessageKey: string,
    successMessageValues?: Record<string, string | number>,
    onAcceptedSuccess?: (workspace: EnterpriseLeadWorkspace) => void,
  ): Promise<EnterpriseLeadProfileSaveRequestOutcome> => {
    if (touchedFields.length === 0) {
      return EnterpriseLeadProfileSaveRequestOutcome.Ignored;
    }
    const submittedWorkspace = currentWorkspaceRef.current;
    return runEnterpriseLeadProfileSaveRequest({
      scope: profileSaveRequestScopeRef.current,
      submittedWorkspace,
      execute: () =>
        enterpriseLeadWorkspaceService.updateWorkspaceProfile(
          submittedWorkspace.id,
          nextProfile,
          submittedWorkspace.profileRevision,
          touchedFields,
        ),
      resolveConflict: error => {
        if (
          !(error instanceof EnterpriseLeadWorkspaceServiceError) ||
          error.code !== EnterpriseLeadIpcErrorCode.ProfileRevisionConflict
        ) {
          return undefined;
        }
        if (!error.latestProfile) {
          return null;
        }
        return mergeEnterpriseLeadProfileConflict(
          currentWorkspaceRef.current,
          submittedWorkspace.id,
          error.latestProfile,
        );
      },
      onStarted: () => {
        setIsSaving(true);
        clearFeedbackMessage();
      },
      onSuccess: updatedWorkspace => {
        advanceEnterpriseLeadWorkspaceAcceptanceEpoch(workspaceAcceptanceEpochRef);
        const nextDraft = buildCompanyDraft(updatedWorkspace.profile);
        const nextTouchedFields = new Set<KnowledgeFactDomain>();
        currentWorkspaceRef.current = updatedWorkspace;
        companyDraftRef.current = nextDraft;
        companyTouchedFieldsRef.current = nextTouchedFields;
        setCurrentWorkspace(updatedWorkspace);
        setCompanyDraft(nextDraft);
        setCompanyTouchedFields(nextTouchedFields);
        onWorkspaceUpdated?.(updatedWorkspace);
        showFeedbackMessage('success', successMessageKey, successMessageValues);
        onAcceptedSuccess?.(updatedWorkspace);
      },
      onConflict: mergedWorkspace => {
        advanceEnterpriseLeadWorkspaceAcceptanceEpoch(workspaceAcceptanceEpochRef);
        const nextDraft = buildCompanyDraft(mergedWorkspace.profile);
        const nextTouchedFields = new Set<KnowledgeFactDomain>();
        currentWorkspaceRef.current = mergedWorkspace;
        companyDraftRef.current = nextDraft;
        companyTouchedFieldsRef.current = nextTouchedFields;
        setCurrentWorkspace(mergedWorkspace);
        setCompanyDraft(nextDraft);
        setCompanyTouchedFields(nextTouchedFields);
        onWorkspaceUpdated?.(mergedWorkspace);
        showFeedbackMessage('failure', 'enterpriseLeadKnowledgeSaveFailed');
      },
      onFailure: profileError => {
        const isEmptyResult =
          profileError instanceof Error &&
          profileError.message === 'Workspace profile update returned empty result';
        showFeedbackMessage(
          isEmptyResult
          ? 'exception'
          : 'failure',
          isEmptyResult
          ? 'enterpriseLeadKnowledgeUnexpectedError'
          : 'enterpriseLeadKnowledgeSaveFailed',
        );
      },
      onSettled: () => {
        setIsSaving(false);
      },
    });
  };

  const openCompanyModal = (): void => {
    const nextDraft = buildCompanyDraft(currentWorkspace.profile);
    const nextTouchedFields = new Set<KnowledgeFactDomain>();
    companyDraftRef.current = nextDraft;
    companyTouchedFieldsRef.current = nextTouchedFields;
    setCompanyDraft(nextDraft);
    setCompanyTouchedFields(nextTouchedFields);
    setActiveCompanyField('companySummary');
    setModalMode('company');
  };

  useEffect(() => {
    const sourcesNeedVectorSync = currentWorkspace.extractionSources.some(source =>
      doesEnterpriseLeadKnowledgeSourceNeedVectorSync(source),
    );
    if (
      !sourcesNeedVectorSync ||
      isSaving ||
      isVectorSyncing ||
      automaticVectorSyncPromiseRef.current
    ) {
      return;
    }

    const workspaceContextTokenAtRequest = committedWorkspaceContextTokenRef.current;
    const workspaceIdAtRequest = workspaceContextTokenAtRequest.workspaceId;
    const profileRevisionAtRequest = workspaceContextTokenAtRequest.profileRevision;
    if (
      currentWorkspace.id !== workspaceIdAtRequest ||
      currentWorkspace.profileRevision !== profileRevisionAtRequest
    ) {
      return;
    }
    const syncKey = [
      workspaceIdAtRequest,
      profileRevisionAtRequest,
      currentWorkspace.extractionSources
        .map((source, index) =>
          [
            index,
            source.updatedAt ?? '',
            source.vectorIndexStatus ?? '',
            source.vectorChunkCount ?? '',
            source.text?.length ?? 0,
            source.summary?.length ?? 0,
          ].join(':'),
        )
        .join('|'),
    ].join('::');
    if (automaticVectorSyncKeysRef.current.has(syncKey)) {
      return;
    }

    automaticVectorSyncKeysRef.current.add(syncKey);
    const workspaceAcceptanceEpochAtRequest = workspaceAcceptanceEpochRef.current;
    setIsVectorSyncing(true);
    const syncPromise = enterpriseLeadWorkspaceService.updateWorkspaceSources(
      workspaceIdAtRequest,
      currentWorkspace.extractionSources,
    );
    automaticVectorSyncPromiseRef.current = syncPromise;
    const ownsCurrentRequest = (): boolean =>
      workspaceProjectionMountedRef.current &&
      automaticVectorSyncPromiseRef.current === syncPromise &&
      currentWorkspaceRef.current.id === workspaceIdAtRequest &&
      committedWorkspaceContextTokenRef.current === workspaceContextTokenAtRequest &&
      workspaceAcceptanceEpochRef.current === workspaceAcceptanceEpochAtRequest;
    const releaseSyncKeyForRetry = (): void => {
      if (automaticVectorSyncPromiseRef.current === syncPromise) {
        automaticVectorSyncKeysRef.current.delete(syncKey);
      }
    };
    syncPromise
      .then(updatedWorkspace => {
        if (!updatedWorkspace || updatedWorkspace.id !== workspaceIdAtRequest) {
          if (!ownsCurrentRequest()) {
            releaseSyncKeyForRetry();
          }
          return;
        }
        if (!ownsCurrentRequest()) {
          releaseSyncKeyForRetry();
          return;
        }
        const reconciled = reconcileEnterpriseLeadCompanyDraftWorkspaceRefresh({
          currentWorkspace: currentWorkspaceRef.current,
          incomingWorkspace: updatedWorkspace,
          companyDraft: companyDraftRef.current,
          touchedFields: companyTouchedFieldsRef.current,
        });
        if (
          reconciled.workspace === currentWorkspaceRef.current &&
          reconciled.workspace !== updatedWorkspace
        ) {
          return;
        }
        if (!ownsCurrentRequest()) {
          releaseSyncKeyForRetry();
          return;
        }
        if (
          !claimEnterpriseLeadWorkspaceAcceptanceEpoch(
            workspaceAcceptanceEpochRef,
            workspaceAcceptanceEpochAtRequest,
          )
        ) {
          releaseSyncKeyForRetry();
          return;
        }
        synchronizeEnterpriseLeadProfileSaveRequestScope(
          profileSaveRequestScopeRef.current,
          reconciled.workspace,
        );
        currentWorkspaceRef.current = reconciled.workspace;
        setCurrentWorkspace(reconciled.workspace);
        if (reconciled.resetDraft) {
          companyDraftRef.current = reconciled.companyDraft;
          companyTouchedFieldsRef.current = reconciled.touchedFields;
          setCompanyDraft(reconciled.companyDraft);
          setCompanyTouchedFields(reconciled.touchedFields);
          setIsSaving(false);
        }
        onWorkspaceUpdated?.(updatedWorkspace);
      })
      .catch(() => {
        if (!ownsCurrentRequest()) {
          releaseSyncKeyForRetry();
        }
        // Automatic vector refresh is a best-effort repair for stale document rows.
      })
      .finally(() => {
        if (automaticVectorSyncPromiseRef.current === syncPromise) {
          automaticVectorSyncPromiseRef.current = null;
          if (workspaceProjectionMountedRef.current) {
            setIsVectorSyncing(false);
          }
        }
      });
  }, [currentWorkspace, isSaving, isVectorSyncing, onWorkspaceUpdated, workspaceRenderContextToken]);

  const closeModal = (): void => {
    if (isSaving) {
      return;
    }
    setModalMode('none');
  };

  const handleSaveCompanyDraft = async (): Promise<void> => {
    const touchedFields = KnowledgeFactDomains.filter(field => companyTouchedFields.has(field));
    if (touchedFields.length === 0) {
      return;
    }
    const outcome = await saveProfile(
      applyCompanyDraft(currentWorkspace.profile, companyDraft),
      touchedFields,
      'enterpriseLeadKnowledgeCompanySaved',
    );
    if (outcome !== EnterpriseLeadProfileSaveRequestOutcome.Ignored) {
      setModalMode('none');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {feedbackMessage ? (
        <div className="pointer-events-none fixed left-1/2 top-5 z-[70] w-[min(520px,calc(100vw-32px))] -translate-x-1/2">
          <div
            role={getEnterpriseLeadKnowledgeMessageRole(feedbackMessage.tone)}
            aria-live={feedbackMessage.tone === 'success' ? 'polite' : 'assertive'}
            className={`pointer-events-auto relative flex min-h-11 items-center gap-2 overflow-hidden rounded-lg border px-3 py-2 shadow-lg backdrop-blur ${enterpriseLeadKnowledgeMessageAnimationClassName} ${
              enterpriseLeadKnowledgeMessageToneClassNames[feedbackMessage.tone]
            }`}
          >
            {feedbackMessage.tone === 'success' ? (
              <span
                aria-hidden="true"
                className={enterpriseLeadKnowledgeMessageSuccessAccentClassName}
              />
            ) : null}
            <span className="relative z-10 shrink-0 rounded-md bg-background/70 px-2 py-0.5 text-xs font-semibold">
              {i18nService.t(enterpriseLeadKnowledgeMessageLabelKeys[feedbackMessage.tone])}
            </span>
            <span className="relative z-10 min-w-0 flex-1 truncate text-sm font-medium">
              {feedbackMessage.text}
            </span>
            <button
              type="button"
              className="relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-current opacity-70 transition-opacity hover:opacity-100"
              aria-label={i18nService.t('close')}
              onClick={clearFeedbackMessage}
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
      <div className="shrink-0 border-b border-border bg-background px-6 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-primary">
              {i18nService.t('enterpriseLeadWorkbenchNavKnowledgeBase')}
            </p>
            <h1 className="mt-1 truncate text-xl font-semibold text-foreground">
              {i18nService.t('enterpriseLeadKnowledgePageTitle')}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary">
              {i18nService.t('enterpriseLeadKnowledgeMaintenanceSubtitle')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span id={workspaceKnowledgeUploadButtonSlotId} className="inline-flex shrink-0" />
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-secondary shadow-sm transition-colors hover:bg-surface-raised hover:text-foreground"
              onClick={openCompanyModal}
            >
              <BuildingOffice2Icon className={actionIconClassName} />
              {i18nService.t('enterpriseLeadKnowledgeMaintainCompany')}
            </button>
          </div>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-2 border-b border-border bg-surface/50 md:grid-cols-4">
        <button
          type="button"
          className="border-r border-border px-6 py-4 text-left transition-colors hover:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
          onClick={() => setActiveView('documents')}
        >
          <p className="text-2xl font-semibold text-foreground">
            {normalizedDocumentCount ?? documentRows.length}
          </p>
          <p className="mt-1 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadKnowledgeDocumentMetric')}
          </p>
        </button>
        <button
          type="button"
          className="border-r border-border px-6 py-4 text-left transition-colors hover:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
          onClick={() => setActiveView('knowledge')}
        >
          <p className="text-2xl font-semibold text-foreground">
            {aiMetricValues.aiKnowledgeCount}
          </p>
          <p className="mt-1 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadKnowledgeAiKnowledgeMetric')}
          </p>
        </button>
        <button
          type="button"
          className="border-r border-border px-6 py-4 text-left transition-colors hover:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
          onClick={() => setActiveView('knowledge')}
        >
          <p className="text-2xl font-semibold text-amber-600">
            {aiMetricValues.pendingCount}
          </p>
          <p className="mt-1 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadKnowledgePendingMetric')}
          </p>
        </button>
        <button
          type="button"
          className="px-6 py-4 text-left transition-colors hover:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
          onClick={() => setActiveView('knowledge')}
        >
          <p className="text-2xl font-semibold text-foreground">
            {aiMetricValues.confirmedCount}
          </p>
          <p className="mt-1 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadKnowledgeConfirmedMetric')}
          </p>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-surface/50 p-4">
        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">
                  {activeView === 'documents'
                    ? i18nService.t('enterpriseLeadKnowledgeDocumentLibraryTitle')
                    : i18nService.t('enterpriseLeadKnowledgeAiKnowledgeTitle')}
                </h2>
                {activeView === 'documents' ? (
                  <span
                    data-document-count={documentCount}
                    aria-label={i18nService
                      .t('enterpriseKnowledgeFileCount')
                      .replace('{count}', String(documentCount))}
                    className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-surface-raised px-2 text-xs font-semibold text-secondary"
                  >
                    {documentCount}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm leading-6 text-secondary">
                {activeView === 'documents'
                  ? i18nService.t('enterpriseLeadKnowledgeDocumentLibrarySubtitle')
                  : i18nService.t('enterpriseLeadKnowledgeAiKnowledgeSubtitle')}
              </p>
            </div>
            <div className="inline-flex rounded-lg border border-border bg-surface p-1">
              <button
                type="button"
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors ${
                  activeView === 'documents'
                    ? 'bg-background text-primary shadow-sm'
                    : 'text-secondary hover:text-foreground'
                }`}
                onClick={() => setActiveView('documents')}
              >
                <DocumentTextIcon className="h-4 w-4" />
                {i18nService.t('enterpriseLeadKnowledgeDocumentLibraryTitle')}
              </button>
              <button
                type="button"
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors ${
                  activeView === 'knowledge'
                    ? 'bg-background text-primary shadow-sm'
                    : 'text-secondary hover:text-foreground'
                }`}
                onClick={() => setActiveView('knowledge')}
              >
                <SparklesIcon className="h-4 w-4" />
                {i18nService.t('enterpriseLeadKnowledgeAiKnowledgeTitle')}
              </button>
            </div>
          </div>

          <div
            className={`min-h-0 flex-1 ${activeView === 'documents' ? '' : 'hidden'}`}
            aria-hidden={activeView !== 'documents'}
          >
            <WorkspaceKnowledgeDocumentsPanel
              workspaceId={currentWorkspace.id}
              initialImportResult={pendingInitialImportResult}
              refreshToken={knowledgeDocumentsRefreshToken}
              uploadButtonSlotId={workspaceKnowledgeUploadButtonSlotId}
              onDocumentCountChange={setNormalizedDocumentCount}
              onWorkspaceProjectionChange={handleWorkspaceProjectionChange}
              onAiKnowledgeMetricsRefresh={handleAiKnowledgeMetricsRefresh}
            />
          </div>
          {activeView === 'knowledge' ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <WorkspaceAiKnowledgePanel
                workspaceId={currentWorkspace.id}
                profileRevision={currentWorkspace.profileRevision}
                profile={currentWorkspace.profile}
                onMetricsChange={handleAiKnowledgeMetricsChange}
                onMaintainCompany={openCompanyModal}
                onProjectionRefresh={handleAiKnowledgeProjectionRefresh}
              />
            </div>
          ) : null}
        </section>
      </div>

      {modalMode === 'company' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 px-4 py-6">
          <section className="flex h-[720px] max-h-[calc(100vh-48px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {i18nService.t('enterpriseLeadKnowledgeCompanyModalTitle')}
                </h2>
                <p className="mt-1 text-sm text-secondary">
                  {i18nService.t('enterpriseLeadKnowledgeModalSubtitle')}
                </p>
              </div>
              <button
                type="button"
                className="rounded-md p-1.5 text-secondary hover:bg-surface-raised hover:text-foreground"
                onClick={closeModal}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
                <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
                  <aside className="min-h-0 overflow-y-auto border-b border-border bg-surface/60 p-4 lg:border-b-0 lg:border-r">
                    <p className="text-xs leading-5 text-secondary">
                      {i18nService.t('enterpriseLeadKnowledgeCompanyEditorHint')}
                    </p>
                    <div className="mt-4 grid gap-4">
                      {companyDraftGroups.map(group => (
                        <div key={group.id}>
                          <p className="mb-2 text-xs font-semibold text-tertiary">
                            {i18nService.t(group.titleKey)}
                          </p>
                          <div className="grid gap-1.5">
                            {group.fields.map(field => {
                              const fieldConfig = getCompanyDraftFieldConfig(field);
                              const count = getCompanyDraftValueCount(companyDraft[field]);
                              const selected = activeCompanyField === field;
                              return (
                                <button
                                  key={field}
                                  type="button"
                                  className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                                    selected
                                      ? 'border-primary/30 bg-primary/10 text-primary'
                                      : 'border-border bg-background text-secondary hover:bg-surface-raised hover:text-foreground'
                                  }`}
                                  onClick={() => setActiveCompanyField(field)}
                                >
                                  <span className="truncate text-sm font-semibold">
                                    {i18nService.t(fieldConfig.labelKey)}
                                  </span>
                                  <span
                                    className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${
                                      selected
                                        ? 'bg-background text-primary'
                                        : 'bg-surface-raised text-tertiary'
                                    }`}
                                  >
                                    {count}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </aside>

                  <section className="flex min-h-0 min-w-0 flex-col bg-background">
                    <div className="shrink-0 border-b border-border px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-semibold text-foreground">
                            {i18nService.t(activeCompanyFieldConfig.labelKey)}
                          </h3>
                          <p className="mt-1 text-xs leading-5 text-secondary">
                            {i18nService.t('enterpriseLeadKnowledgeCompanyFieldEditHint')}
                          </p>
                        </div>
                        <span className="rounded-md bg-surface-raised px-2 py-1 text-xs font-medium text-secondary">
                          {i18nService
                            .t(
                              activeCompanyValueCount > 0
                                ? 'enterpriseLeadKnowledgeCompanyFieldStats'
                                : 'enterpriseLeadKnowledgeCompanyFieldEmpty',
                            )
                            .replace('{count}', String(activeCompanyValueCount))}
                        </span>
                      </div>
                    </div>
                    <label className="flex min-h-0 flex-1 flex-col p-5">
                      <textarea
                        value={activeCompanyValue}
                        disabled={isSaving}
                        onChange={event => {
                          const next = updateEnterpriseLeadCompanyDraftField({
                            isSaving,
                            field: activeCompanyField,
                            value: event.target.value,
                            companyDraft: companyDraftRef.current,
                            touchedFields: companyTouchedFieldsRef.current,
                          });
                          companyTouchedFieldsRef.current = next.touchedFields;
                          companyDraftRef.current = next.companyDraft;
                          setCompanyTouchedFields(next.touchedFields);
                          setCompanyDraft(next.companyDraft);
                        }}
                        className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-6 text-foreground outline-none focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </label>
                  </section>
                </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
              <p className="text-xs text-secondary">
                {i18nService.t('enterpriseLeadKnowledgeModalHint')}
              </p>
              <button
                type="button"
                disabled={isSaving || companyTouchedFields.size === 0}
                className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void handleSaveCompanyDraft()}
              >
                {isSaving
                  ? i18nService.t('saving')
                  : i18nService.t('enterpriseLeadKnowledgeSaveAction')}
              </button>
            </div>
          </section>
        </div>
      )}

      {isLoading ? (
        <div className="pointer-events-none fixed bottom-4 right-4 rounded-lg border border-border bg-background px-3 py-2 text-xs text-secondary shadow-lg">
          {i18nService.t('loading')}
        </div>
      ) : null}
    </div>
  );
};

export default WorkspaceKnowledgeBase;
