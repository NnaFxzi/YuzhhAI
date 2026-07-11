import {
  ArchiveBoxXMarkIcon,
  BuildingOffice2Icon,
  CheckCircleIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  SparklesIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  EnterpriseLeadDocumentExtractionStage,
  EnterpriseLeadDocumentExtractionStatus,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadImageAttachmentExtensions,
  EnterpriseLeadKnowledgeIndexStatus,
  EnterpriseLeadReadableDocumentExtensions,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadExtractionSource,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceProfile,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import {
  type EditableKnowledgeField,
  EnterpriseLeadKnowledgeItemKind,
  EnterpriseLeadKnowledgeSection,
  getEditableKnowledgeField,
  getWorkspaceKnowledgeSections,
  type WorkspaceKnowledgeItem,
} from './enterpriseLeadWorkspaceUi';
import WorkspaceKnowledgeDocumentsPanel from './WorkspaceKnowledgeDocumentsPanel';

interface WorkspaceKnowledgeBaseProps {
  workspace: EnterpriseLeadWorkspace;
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

const editableArrayFields = [
  'productList',
  'productCapabilities',
  'targetCustomers',
  'applicationScenarios',
  'sellingPoints',
  'channelPreferences',
  'prohibitedClaims',
  'contactRules',
  'missingInfo',
] as const;
type EditableArrayField = (typeof editableArrayFields)[number];

const editableKnowledgeKinds = [
  EnterpriseLeadKnowledgeItemKind.CompanySummary,
  EnterpriseLeadKnowledgeItemKind.Product,
  EnterpriseLeadKnowledgeItemKind.Capability,
  EnterpriseLeadKnowledgeItemKind.Customer,
  EnterpriseLeadKnowledgeItemKind.Scenario,
  EnterpriseLeadKnowledgeItemKind.SellingPoint,
  EnterpriseLeadKnowledgeItemKind.Channel,
  EnterpriseLeadKnowledgeItemKind.ProhibitedClaim,
  EnterpriseLeadKnowledgeItemKind.ContactRule,
] as const;
type EditableKnowledgeKind = (typeof editableKnowledgeKinds)[number];

const formatKnowledgeDate = (value?: string): string => {
  if (!value) {
    return '';
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return '';
  }

  try {
    const locale = i18nService.getLanguage() === 'zh' ? 'zh-CN' : 'en-US';
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
};

const itemKindLabelKeys: Record<EnterpriseLeadKnowledgeItemKind, string> = {
  [EnterpriseLeadKnowledgeItemKind.CompanySummary]: 'enterpriseLeadKnowledgeKindCompanySummary',
  [EnterpriseLeadKnowledgeItemKind.Product]: 'enterpriseLeadKnowledgeKindProduct',
  [EnterpriseLeadKnowledgeItemKind.Capability]: 'enterpriseLeadKnowledgeKindCapability',
  [EnterpriseLeadKnowledgeItemKind.Customer]: 'enterpriseLeadKnowledgeKindCustomer',
  [EnterpriseLeadKnowledgeItemKind.Scenario]: 'enterpriseLeadKnowledgeKindScenario',
  [EnterpriseLeadKnowledgeItemKind.SellingPoint]: 'enterpriseLeadKnowledgeKindSellingPoint',
  [EnterpriseLeadKnowledgeItemKind.Channel]: 'enterpriseLeadKnowledgeKindChannel',
  [EnterpriseLeadKnowledgeItemKind.ProhibitedClaim]: 'enterpriseLeadKnowledgeKindProhibitedClaim',
  [EnterpriseLeadKnowledgeItemKind.ContactRule]: 'enterpriseLeadKnowledgeKindContactRule',
  [EnterpriseLeadKnowledgeItemKind.Source]: 'enterpriseLeadKnowledgeKindSource',
  [EnterpriseLeadKnowledgeItemKind.Deliverable]: 'enterpriseLeadKnowledgeKindDeliverable',
  [EnterpriseLeadKnowledgeItemKind.Archive]: 'enterpriseLeadKnowledgeKindArchive',
};

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

const sectionDefaultKinds: Partial<Record<EnterpriseLeadKnowledgeSection, EditableKnowledgeKind>> =
  {
    [EnterpriseLeadKnowledgeSection.Company]: EnterpriseLeadKnowledgeItemKind.CompanySummary,
    [EnterpriseLeadKnowledgeSection.Products]: EnterpriseLeadKnowledgeItemKind.Product,
    [EnterpriseLeadKnowledgeSection.Customers]: EnterpriseLeadKnowledgeItemKind.Customer,
    [EnterpriseLeadKnowledgeSection.Selling]: EnterpriseLeadKnowledgeItemKind.SellingPoint,
    [EnterpriseLeadKnowledgeSection.Rules]: EnterpriseLeadKnowledgeItemKind.ContactRule,
  };

const enterpriseLeadKnowledgeAiTableHiddenSections = new Set<EnterpriseLeadKnowledgeSection>([
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

const isEditableArrayField = (
  field: keyof EnterpriseLeadWorkspaceProfile,
): field is EditableArrayField => editableArrayFields.includes(field as EditableArrayField);

const getArrayIndexFromItemId = (item: WorkspaceKnowledgeItem): number => {
  const idParts = item.id.split('-');
  const indexText = idParts[idParts.length - 1] ?? '';
  const index = Number.parseInt(indexText, 10);
  return Number.isInteger(index) && index >= 0 ? index : -1;
};

const normalizeKnowledgeConfirmationText = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();

const getEnterpriseLeadKnowledgeFieldKey = (
  field: keyof EnterpriseLeadWorkspaceProfile,
  value: string,
): string => {
  const normalizedText = normalizeKnowledgeConfirmationText(value);
  return normalizedText ? `${field}:${normalizedText}` : '';
};

export const getEnterpriseLeadKnowledgeConfirmationKey = (item: WorkspaceKnowledgeItem): string => {
  const editableField = getEditableKnowledgeField(item.kind);
  return editableField ? getEnterpriseLeadKnowledgeFieldKey(editableField.field, item.text) : '';
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
  const nextProfile = cloneProfile(profile);
  if (!key) {
    return nextProfile;
  }
  nextProfile.confirmedKnowledgeKeys = Array.from(
    new Set([...(nextProfile.confirmedKnowledgeKeys ?? []), key]),
  );
  if (nextProfile.ignoredKnowledgeKeys) {
    const nextIgnoredKeys = nextProfile.ignoredKnowledgeKeys.filter(
      ignoredKey => ignoredKey !== key,
    );
    if (nextIgnoredKeys.length > 0) {
      nextProfile.ignoredKnowledgeKeys = nextIgnoredKeys;
    } else {
      delete nextProfile.ignoredKnowledgeKeys;
    }
  }
  return nextProfile;
};

export const confirmEnterpriseLeadKnowledgeItemsInProfile = (
  profile: EnterpriseLeadWorkspaceProfile,
  items: WorkspaceKnowledgeItem[],
): EnterpriseLeadWorkspaceProfile => {
  const nextProfile = cloneProfile(profile);
  const confirmedKeys = items
    .map(item => getEnterpriseLeadKnowledgeConfirmationKey(item))
    .filter(Boolean);
  if (confirmedKeys.length === 0) {
    return nextProfile;
  }
  nextProfile.confirmedKnowledgeKeys = Array.from(
    new Set([...(nextProfile.confirmedKnowledgeKeys ?? []), ...confirmedKeys]),
  );
  if (nextProfile.ignoredKnowledgeKeys) {
    const confirmedKeySet = new Set(confirmedKeys);
    const nextIgnoredKeys = nextProfile.ignoredKnowledgeKeys.filter(
      ignoredKey => !confirmedKeySet.has(ignoredKey),
    );
    if (nextIgnoredKeys.length > 0) {
      nextProfile.ignoredKnowledgeKeys = nextIgnoredKeys;
    } else {
      delete nextProfile.ignoredKnowledgeKeys;
    }
  }
  return nextProfile;
};

export const confirmEnterpriseLeadKnowledgeValueInProfile = (
  profile: EnterpriseLeadWorkspaceProfile,
  field: keyof EnterpriseLeadWorkspaceProfile,
  value: string,
): EnterpriseLeadWorkspaceProfile => {
  const key = getEnterpriseLeadKnowledgeFieldKey(field, value);
  const nextProfile = cloneProfile(profile);
  if (!key) {
    return nextProfile;
  }
  nextProfile.confirmedKnowledgeKeys = Array.from(
    new Set([...(nextProfile.confirmedKnowledgeKeys ?? []), key]),
  );
  if (nextProfile.ignoredKnowledgeKeys) {
    const nextIgnoredKeys = nextProfile.ignoredKnowledgeKeys.filter(
      ignoredKey => ignoredKey !== key,
    );
    if (nextIgnoredKeys.length > 0) {
      nextProfile.ignoredKnowledgeKeys = nextIgnoredKeys;
    } else {
      delete nextProfile.ignoredKnowledgeKeys;
    }
  }
  return nextProfile;
};

const removeEnterpriseLeadKnowledgeItemConfirmationFromProfile = (
  profile: EnterpriseLeadWorkspaceProfile,
  item: WorkspaceKnowledgeItem,
): EnterpriseLeadWorkspaceProfile => {
  const key = getEnterpriseLeadKnowledgeConfirmationKey(item);
  const nextProfile = cloneProfile(profile);
  if (!key || !nextProfile.confirmedKnowledgeKeys) {
    return nextProfile;
  }
  const nextKeys = nextProfile.confirmedKnowledgeKeys.filter(confirmedKey => confirmedKey !== key);
  if (nextKeys.length > 0) {
    nextProfile.confirmedKnowledgeKeys = nextKeys;
  } else {
    delete nextProfile.confirmedKnowledgeKeys;
  }
  return nextProfile;
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
  const companyKey = getEnterpriseLeadKnowledgeFieldKey('companySummary', profile.companySummary);
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
    const key = getEnterpriseLeadKnowledgeFieldKey(field, value);
    return Boolean(key && removeKeys.has(key) && !keepKeys.has(key));
  };
  const nextProfile = cloneProfile(profile);
  if (shouldRemove('companySummary', nextProfile.companySummary)) {
    nextProfile.companySummary = '';
  }
  editableArrayFields.forEach(field => {
    nextProfile[field] = nextProfile[field].filter(value => !shouldRemove(field, value));
  });
  if (nextProfile.confirmedKnowledgeKeys) {
    const nextConfirmedKeys = nextProfile.confirmedKnowledgeKeys.filter(
      key => !removeKeys.has(key) || keepKeys.has(key),
    );
    if (nextConfirmedKeys.length > 0) {
      nextProfile.confirmedKnowledgeKeys = nextConfirmedKeys;
    } else {
      delete nextProfile.confirmedKnowledgeKeys;
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
  const nextProfile = removeEnterpriseLeadKnowledgeKeysFromProfile(profile, [key]);
  nextProfile.ignoredKnowledgeKeys = Array.from(
    new Set([...(nextProfile.ignoredKnowledgeKeys ?? []), key]),
  );
  return nextProfile;
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
  source?: Pick<
    EnterpriseLeadExtractionSource,
    'extractionStatus' | 'text' | 'vectorIndexStatus'
  > &
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

const getEditableItemField = (item: WorkspaceKnowledgeItem): EditableKnowledgeField | null =>
  getEditableKnowledgeField(item.kind);

const isEditableItem = (item: WorkspaceKnowledgeItem | null): item is WorkspaceKnowledgeItem =>
  Boolean(item && getEditableItemField(item));

const getDefaultKindForSection = (
  sectionId: EnterpriseLeadKnowledgeSection,
): EditableKnowledgeKind =>
  sectionDefaultKinds[sectionId] ?? EnterpriseLeadKnowledgeItemKind.Product;

const getKindField = (kind: EditableKnowledgeKind): EditableKnowledgeField =>
  getEditableKnowledgeField(kind) ?? {
    field: 'productList',
    multiValue: true,
  };

export type KnowledgeView = 'documents' | 'knowledge';
export type KnowledgeStatusFilter = 'all' | 'pending' | 'confirmed' | 'editable' | 'readonly';
export type DocumentStatusFilter =
  | 'all'
  | typeof EnterpriseLeadDocumentExtractionStatus.Pending
  | typeof EnterpriseLeadDocumentExtractionStatus.Extracting
  | typeof EnterpriseLeadDocumentExtractionStatus.Extracted
  | typeof EnterpriseLeadDocumentExtractionStatus.Failed;
export type EnterpriseLeadKnowledgeMetricId =
  'documents' | 'knowledge_all' | 'knowledge_pending' | 'knowledge_readonly';
export interface EnterpriseLeadKnowledgeMetricFilter {
  activeView: KnowledgeView;
  documentStatusFilter: DocumentStatusFilter;
  statusFilter: KnowledgeStatusFilter;
}

export const getEnterpriseLeadKnowledgeMetricFilter = (
  metricId: EnterpriseLeadKnowledgeMetricId,
): EnterpriseLeadKnowledgeMetricFilter => {
  switch (metricId) {
    case 'documents':
      return {
        activeView: 'documents',
        documentStatusFilter: 'all',
        statusFilter: 'all',
      };
    case 'knowledge_pending':
      return {
        activeView: 'knowledge',
        documentStatusFilter: 'all',
        statusFilter: 'pending',
      };
    case 'knowledge_readonly':
      return {
        activeView: 'knowledge',
        documentStatusFilter: 'all',
        statusFilter: 'readonly',
      };
    case 'knowledge_all':
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
type ModalMode = 'none' | 'company' | 'item' | 'deleteKnowledgeBatch';
type ItemModalMode = 'add' | 'edit';

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

interface ItemDraft {
  mode: ItemModalMode;
  kind: EditableKnowledgeKind;
  text: string;
  editingItemId: string;
}

interface CompanyDraft {
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

const createItemDraft = (
  sectionId: EnterpriseLeadKnowledgeSection,
  item?: WorkspaceKnowledgeItem | null,
): ItemDraft => ({
  mode: item ? 'edit' : 'add',
  kind:
    item?.kind && editableKnowledgeKinds.includes(item.kind as EditableKnowledgeKind)
      ? (item.kind as EditableKnowledgeKind)
      : getDefaultKindForSection(sectionId),
  text: item?.text ?? '',
  editingItemId: item?.id ?? '',
});

const getItemMeta = (item: WorkspaceKnowledgeItem): string => {
  const timestamp = formatKnowledgeDate(item.updatedAt ?? item.createdAt);
  return [item.metaText, timestamp].filter(Boolean).join(' · ');
};

export const WorkspaceKnowledgeBase: React.FC<WorkspaceKnowledgeBaseProps> = ({
  workspace,
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
  const [, setSelectedItemId] = useState(
    enterpriseLeadKnowledgeInitialSelectedItemId,
  );
  const [selectedKnowledgeItemIds, setSelectedKnowledgeItemIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<KnowledgeStatusFilter>('all');
  const [modalMode, setModalMode] = useState<ModalMode>('none');
  const [activeCompanyField, setActiveCompanyField] = useState<CompanyDraftField>('companySummary');
  const [companyDraft, setCompanyDraft] = useState<CompanyDraft>(() =>
    buildCompanyDraft(workspace.profile),
  );
  const [itemDraft, setItemDraft] = useState<ItemDraft>(() =>
    createItemDraft(EnterpriseLeadKnowledgeSection.Company),
  );
  const requestRef = useRef(0);
  const automaticVectorSyncKeysRef = useRef<Set<string>>(new Set());
  const automaticVectorSyncPromiseRef = useRef<Promise<EnterpriseLeadWorkspace | null> | null>(
    null,
  );
  const pendingSelectionRef = useRef<{
    field: keyof EnterpriseLeadWorkspaceProfile;
    index: number;
  } | null>(null);
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
    setCurrentWorkspace(workspace);
    setCompanyDraft(buildCompanyDraft(workspace.profile));
  }, [workspace]);

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

  useEffect(() => {
    const pendingSelection = pendingSelectionRef.current;
    if (!pendingSelection) {
      return;
    }

    const matchingItem = sections
      .flatMap(section => section.items)
      .find(item => {
        const editableField = getEditableItemField(item);
        if (editableField?.field === 'companySummary') {
          return pendingSelection.field === 'companySummary';
        }
        return (
          editableField?.field === pendingSelection.field &&
          getArrayIndexFromItemId(item) === pendingSelection.index
        );
      });

    if (matchingItem) {
      setSelectedItemId(matchingItem.id);
      pendingSelectionRef.current = null;
    }
  }, [sections]);

  const knowledgeRows = useMemo<KnowledgeTableRow[]>(
    () =>
      sections
        .filter(section => isEnterpriseLeadKnowledgeSectionShownInAiKnowledgeTable(section.id))
        .flatMap(section => section.items.map(item => ({ item, section }))),
    [sections],
  );
  const documentRows = useMemo<KnowledgeTableRow[]>(() => {
    const sourcesSection = sections.find(
      section => section.id === EnterpriseLeadKnowledgeSection.Sources,
    );
    return sourcesSection?.items.map(item => ({ item, section: sourcesSection })) ?? [];
  }, [sections]);
  const editableCount = knowledgeRows.filter(row => isEditableItem(row.item)).length;
  const readOnlyCount = knowledgeRows.length - editableCount;
  const pendingKnowledgeCount = getEnterpriseLeadKnowledgePendingItemCount(
    currentWorkspace.profile,
    knowledgeRows.map(row => row.item),
  );
  const normalizedQuery = normalizeEnterpriseLeadKnowledgeQuery(searchQuery);
  const filteredKnowledgeRows = knowledgeRows.filter(({ item, section }) => {
    const searchableText = [
      item.text,
      item.secondaryText,
      item.metaText,
      i18nService.t(section.titleKey),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const matchesQuery = !normalizedQuery || searchableText.includes(normalizedQuery);
    const editable = isEditableItem(item);
    const confirmed =
      editable && isEnterpriseLeadKnowledgeItemConfirmed(currentWorkspace.profile, item);
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'pending' && editable && !confirmed) ||
      (statusFilter === 'confirmed' && confirmed) ||
      (statusFilter === 'editable' && editable) ||
      (statusFilter === 'readonly' && !editable);
    return matchesQuery && matchesStatus;
  });
  const filteredPendingKnowledgeItems = getEnterpriseLeadKnowledgePendingItems(
    currentWorkspace.profile,
    filteredKnowledgeRows.map(row => row.item),
  );
  const filteredSelectableKnowledgeItems = filteredKnowledgeRows
    .map(row => row.item)
    .filter(isEditableItem);
  const selectedKnowledgeItems = getEnterpriseLeadKnowledgeSelectedItems(
    filteredSelectableKnowledgeItems,
    selectedKnowledgeItemIds,
  );
  const selectedPendingKnowledgeItems = getEnterpriseLeadKnowledgePendingItems(
    currentWorkspace.profile,
    selectedKnowledgeItems,
  );
  const selectedDeletableKnowledgeItems = selectedKnowledgeItems.filter(isEditableItem);
  const selectedKnowledgeItemIdSet = new Set(selectedKnowledgeItemIds);
  const selectedKnowledgeCount = selectedKnowledgeItems.length;
  const shouldShowSelectionToolbar =
    activeView === 'knowledge' &&
    shouldShowEnterpriseLeadKnowledgeSelectionToolbar(selectedKnowledgeCount);
  const areAllFilteredKnowledgeItemsSelected =
    filteredSelectableKnowledgeItems.length > 0 &&
    filteredSelectableKnowledgeItems.every(item => selectedKnowledgeItemIdSet.has(item.id));
  const isDeleteKnowledgeBatchModal = modalMode === 'deleteKnowledgeBatch';
  const activeCompanyFieldConfig = getCompanyDraftFieldConfig(activeCompanyField);
  const activeCompanyValue = companyDraft[activeCompanyField];
  const activeCompanyValueCount = getCompanyDraftValueCount(activeCompanyValue);

  const saveProfile = async (
    nextProfile: EnterpriseLeadWorkspaceProfile,
    successMessageKey: string,
    successMessageValues?: Record<string, string | number>,
  ): Promise<void> => {
    setIsSaving(true);
    clearFeedbackMessage();
    try {
      const updatedWorkspace = await enterpriseLeadWorkspaceService.updateWorkspaceProfile(
        currentWorkspace.id,
        nextProfile,
      );
      if (!updatedWorkspace) {
        throw new Error('Workspace profile update returned empty result');
      }
      setCurrentWorkspace(updatedWorkspace);
      onWorkspaceUpdated?.(updatedWorkspace);
      setCompanyDraft(buildCompanyDraft(updatedWorkspace.profile));
      showFeedbackMessage('success', successMessageKey, successMessageValues);
    } catch (profileError) {
      showFeedbackMessage(
        profileError instanceof Error &&
          profileError.message === 'Workspace profile update returned empty result'
          ? 'exception'
          : 'failure',
        profileError instanceof Error &&
          profileError.message === 'Workspace profile update returned empty result'
          ? 'enterpriseLeadKnowledgeUnexpectedError'
          : 'enterpriseLeadKnowledgeSaveFailed',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const openCompanyModal = (): void => {
    setCompanyDraft(buildCompanyDraft(currentWorkspace.profile));
    setActiveCompanyField('companySummary');
    setModalMode('company');
  };

  const openAddModal = (): void => {
    setItemDraft(createItemDraft(EnterpriseLeadKnowledgeSection.Products));
    setModalMode('item');
  };

  const applyMetricFilter = (metricId: EnterpriseLeadKnowledgeMetricId): void => {
    const filter = getEnterpriseLeadKnowledgeMetricFilter(metricId);
    setActiveView(filter.activeView);
    setStatusFilter(filter.statusFilter);
    setSearchQuery('');
    setSelectedItemId('');
    clearSelectedKnowledgeItems();
  };

  useEffect(() => {
    const sourcesNeedVectorSync = currentWorkspace.extractionSources.some(source =>
      doesEnterpriseLeadKnowledgeSourceNeedVectorSync(source),
    );
    if (!sourcesNeedVectorSync || isSaving || isVectorSyncing) {
      return;
    }

    const syncKey = [
      currentWorkspace.id,
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
    let cancelled = false;
    setIsVectorSyncing(true);
    const syncPromise = enterpriseLeadWorkspaceService.updateWorkspaceSources(
      currentWorkspace.id,
      currentWorkspace.extractionSources,
    );
    automaticVectorSyncPromiseRef.current = syncPromise;
    syncPromise
      .then(updatedWorkspace => {
        if (cancelled || !updatedWorkspace) {
          return;
        }
        setCurrentWorkspace(updatedWorkspace);
        onWorkspaceUpdated?.(updatedWorkspace);
      })
      .catch(() => {
        // Automatic vector refresh is a best-effort repair for stale document rows.
      })
      .finally(() => {
        if (automaticVectorSyncPromiseRef.current === syncPromise) {
          automaticVectorSyncPromiseRef.current = null;
        }
        if (!cancelled) {
          setIsVectorSyncing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentWorkspace, isSaving, isVectorSyncing, onWorkspaceUpdated]);

  const openEditModalForRow = (row: KnowledgeTableRow): void => {
    if (!isEditableItem(row.item)) {
      return;
    }
    setSelectedItemId(row.item.id);
    setItemDraft(createItemDraft(row.section.id, row.item));
    setModalMode('item');
  };

  const clearSelectedKnowledgeItems = (): void => {
    setSelectedKnowledgeItemIds([]);
  };

  const toggleKnowledgeItemSelection = (item: WorkspaceKnowledgeItem): void => {
    if (!isEditableItem(item)) {
      return;
    }
    setSelectedItemId(item.id);
    setSelectedKnowledgeItemIds(currentIds =>
      currentIds.includes(item.id)
        ? currentIds.filter(itemId => itemId !== item.id)
        : [...currentIds, item.id],
    );
  };

  const toggleFilteredKnowledgeSelection = (checked: boolean): void => {
    const filteredItemIds = filteredSelectableKnowledgeItems.map(item => item.id);
    if (filteredItemIds.length === 0) {
      return;
    }
    setSelectedKnowledgeItemIds(currentIds => {
      if (!checked) {
        return currentIds.filter(itemId => !filteredItemIds.includes(itemId));
      }
      return Array.from(new Set([...currentIds, ...filteredItemIds]));
    });
  };

  const closeModal = (): void => {
    if (isSaving) {
      return;
    }
    setModalMode('none');
  };

  const handleSaveCompanyDraft = async (): Promise<void> => {
    await saveProfile(
      applyCompanyDraft(currentWorkspace.profile, companyDraft),
      'enterpriseLeadKnowledgeCompanySaved',
    );
    setModalMode('none');
  };

  const handleSaveItemDraft = async (): Promise<void> => {
    const text = itemDraft.text.trim();
    if (!text) {
      showFeedbackMessage('failure', 'enterpriseLeadKnowledgeEmptyContentError');
      return;
    }

    const currentItem =
      itemDraft.mode === 'edit'
        ? (sections
            .flatMap(section => section.items)
            .find(item => item.id === itemDraft.editingItemId) ?? null)
        : null;
    const nextProfile = currentItem
      ? removeEnterpriseLeadKnowledgeItemConfirmationFromProfile(
          currentWorkspace.profile,
          currentItem,
        )
      : cloneProfile(currentWorkspace.profile);
    const targetField = getKindField(itemDraft.kind);
    let targetSelectionIndex = targetField.field === 'companySummary' ? -1 : 0;

    if (itemDraft.mode === 'edit') {
      const sourceField = currentItem ? getEditableItemField(currentItem) : null;
      if (currentItem && sourceField) {
        if (sourceField.field === 'companySummary') {
          if (targetField.field === 'companySummary') {
            nextProfile.companySummary = text;
            targetSelectionIndex = -1;
          } else {
            nextProfile.companySummary = '';
          }
        } else if (isEditableArrayField(sourceField.field)) {
          const index = getArrayIndexFromItemId(currentItem);
          if (index >= 0 && targetField.field === sourceField.field) {
            nextProfile[sourceField.field].splice(index, 1, text);
            targetSelectionIndex = index;
          } else if (index >= 0) {
            nextProfile[sourceField.field].splice(index, 1);
          }
        }
      }
    }

    const alreadyAppliedSameFieldEdit =
      itemDraft.mode === 'edit' &&
      targetField.field !== 'companySummary' &&
      sections
        .flatMap(section => section.items)
        .some(item => {
          if (item.id !== itemDraft.editingItemId) {
            return false;
          }
          const sourceField = getEditableItemField(item);
          return sourceField?.field === targetField.field;
        });

    if (targetField.field === 'companySummary') {
      nextProfile.companySummary = text;
      targetSelectionIndex = -1;
    } else if (isEditableArrayField(targetField.field) && !alreadyAppliedSameFieldEdit) {
      nextProfile[targetField.field] = [text, ...nextProfile[targetField.field]];
      targetSelectionIndex = 0;
    }

    setActiveView('knowledge');
    pendingSelectionRef.current = {
      field: targetField.field,
      index: targetSelectionIndex,
    };
    const profileToSave =
      itemDraft.mode === 'edit'
        ? confirmEnterpriseLeadKnowledgeValueInProfile(nextProfile, targetField.field, text)
        : nextProfile;

    await saveProfile(
      profileToSave,
      itemDraft.mode === 'edit'
        ? 'enterpriseLeadKnowledgeItemUpdated'
        : 'enterpriseLeadKnowledgeItemAdded',
    );
    setModalMode('none');
  };

  const archiveKnowledgeItem = async (item: WorkspaceKnowledgeItem): Promise<void> => {
    if (!getEditableItemField(item)) {
      return;
    }
    setSelectedItemId('');
    await saveProfile(
      ignoreEnterpriseLeadKnowledgeItemInProfile(currentWorkspace.profile, item),
      'enterpriseLeadKnowledgeItemArchived',
    );
  };

  const confirmFilteredKnowledgeItems = async (): Promise<void> => {
    if (filteredPendingKnowledgeItems.length === 0) {
      showFeedbackMessage('exception', 'enterpriseLeadKnowledgeBatchConfirmEmpty');
      return;
    }
    setSelectedItemId('');
    clearSelectedKnowledgeItems();
    await saveProfile(
      confirmEnterpriseLeadKnowledgeItemsInProfile(
        currentWorkspace.profile,
        filteredPendingKnowledgeItems,
      ),
      'enterpriseLeadKnowledgeBatchConfirmed',
      { count: filteredPendingKnowledgeItems.length },
    );
  };

  const confirmSelectedKnowledgeItems = async (): Promise<void> => {
    if (selectedPendingKnowledgeItems.length === 0) {
      showFeedbackMessage('exception', 'enterpriseLeadKnowledgeBatchConfirmEmpty');
      return;
    }
    setSelectedItemId('');
    clearSelectedKnowledgeItems();
    await saveProfile(
      confirmEnterpriseLeadKnowledgeItemsInProfile(
        currentWorkspace.profile,
        selectedPendingKnowledgeItems,
      ),
      'enterpriseLeadKnowledgeBatchConfirmed',
      { count: selectedPendingKnowledgeItems.length },
    );
  };

  const handleDeleteSelectedKnowledgeItems = async (): Promise<void> => {
    if (selectedDeletableKnowledgeItems.length === 0) {
      showFeedbackMessage('exception', 'enterpriseLeadKnowledgeBatchDeleteEmpty');
      return;
    }

    setIsSaving(true);
    clearFeedbackMessage();
    try {
      const nextProfile = selectedDeletableKnowledgeItems.reduce(
        (profile, item) => ignoreEnterpriseLeadKnowledgeItemInProfile(profile, item),
        currentWorkspace.profile,
      );
      const updatedWorkspace = await enterpriseLeadWorkspaceService.updateWorkspaceProfile(
        currentWorkspace.id,
        nextProfile,
      );
      if (!updatedWorkspace) {
        throw new Error('Workspace profile update returned empty result');
      }
      setCurrentWorkspace(updatedWorkspace);
      setCompanyDraft(buildCompanyDraft(updatedWorkspace.profile));
      onWorkspaceUpdated?.(updatedWorkspace);
      setSelectedItemId('');
      clearSelectedKnowledgeItems();
      setModalMode('none');
      showFeedbackMessage('success', 'enterpriseLeadKnowledgeBatchDeleted', {
        count: selectedDeletableKnowledgeItems.length,
      });
    } catch (deleteError) {
      showFeedbackMessage(
        deleteError instanceof Error &&
          deleteError.message === 'Workspace profile update returned empty result'
          ? 'exception'
          : 'failure',
        deleteError instanceof Error &&
          deleteError.message === 'Workspace profile update returned empty result'
          ? 'enterpriseLeadKnowledgeUnexpectedError'
          : 'enterpriseLeadKnowledgeSaveFailed',
      );
    } finally {
      setIsSaving(false);
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
          onClick={() => applyMetricFilter('documents')}
        >
          <p className="text-2xl font-semibold text-foreground">{documentRows.length}</p>
          <p className="mt-1 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadKnowledgeDocumentMetric')}
          </p>
        </button>
        <button
          type="button"
          className="border-r border-border px-6 py-4 text-left transition-colors hover:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
          onClick={() => applyMetricFilter('knowledge_all')}
        >
          <p className="text-2xl font-semibold text-foreground">{knowledgeRows.length}</p>
          <p className="mt-1 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadKnowledgeAiKnowledgeMetric')}
          </p>
        </button>
        <button
          type="button"
          className="border-r border-border px-6 py-4 text-left transition-colors hover:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
          onClick={() => applyMetricFilter('knowledge_pending')}
        >
          <p className="text-2xl font-semibold text-amber-600">{pendingKnowledgeCount}</p>
          <p className="mt-1 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadKnowledgePendingMetric')}
          </p>
        </button>
        <button
          type="button"
          className="px-6 py-4 text-left transition-colors hover:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
          onClick={() => applyMetricFilter('knowledge_readonly')}
        >
          <p className="text-2xl font-semibold text-foreground">{readOnlyCount}</p>
          <p className="mt-1 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadKnowledgeReferencedMetric')}
          </p>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-surface/50 p-4">
        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">
                {activeView === 'documents'
                  ? i18nService.t('enterpriseLeadKnowledgeDocumentLibraryTitle')
                  : i18nService.t('enterpriseLeadKnowledgeAiKnowledgeTitle')}
              </h2>
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
                onClick={() => {
                  setActiveView('documents');
                  setSelectedItemId(
                    getEnterpriseLeadKnowledgeSelectedItemIdAfterViewChange('documents'),
                  );
                  setSearchQuery('');
                }}
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
                onClick={() => {
                  setActiveView('knowledge');
                  setSelectedItemId(
                    getEnterpriseLeadKnowledgeSelectedItemIdAfterViewChange('knowledge'),
                  );
                  setSearchQuery('');
                }}
              >
                <SparklesIcon className="h-4 w-4" />
                {i18nService.t('enterpriseLeadKnowledgeAiKnowledgeTitle')}
              </button>
            </div>
          </div>

          {activeView === 'documents' ? (
            <div className="min-h-0 flex-1">
              <WorkspaceKnowledgeDocumentsPanel workspaceId={currentWorkspace.id} />
            </div>
          ) : (
            <>
          <div className={getEnterpriseLeadKnowledgeToolbarGridClassName(activeView)}>
            <label className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-secondary">
              <MagnifyingGlassIcon className="h-4 w-4 shrink-0" />
              <input
                type="search"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder={i18nService.t('enterpriseLeadKnowledgeKnowledgeSearchPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-tertiary"
              />
            </label>
            <select
              value={statusFilter}
              onChange={event => setStatusFilter(event.target.value as KnowledgeStatusFilter)}
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-secondary outline-none"
            >
              <option value="all">{i18nService.t('enterpriseLeadKnowledgeFilterAll')}</option>
              <option value="pending">
                {i18nService.t('enterpriseLeadKnowledgeStatusPendingConfirmation')}
              </option>
              <option value="confirmed">
                {i18nService.t('enterpriseLeadKnowledgeStatusConfirmed')}
              </option>
              <option value="editable">
                {i18nService.t('enterpriseLeadKnowledgeFilterEditable')}
              </option>
              <option value="readonly">
                {i18nService.t('enterpriseLeadKnowledgeFilterReadonly')}
              </option>
            </select>
            {shouldShowEnterpriseLeadKnowledgeBatchConfirmAction(
              filteredPendingKnowledgeItems.length,
            ) ? (
              <button
                type="button"
                disabled={isSaving}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-45 dark:text-emerald-300"
                onClick={() => void confirmFilteredKnowledgeItems()}
              >
                <CheckCircleIcon className={actionIconClassName} />
                {formatEnterpriseLeadKnowledgeMessage(
                  'enterpriseLeadKnowledgeConfirmFilteredAction',
                  { count: filteredPendingKnowledgeItems.length },
                )}
              </button>
            ) : (
              <div className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm font-medium text-secondary">
                {i18nService.t('enterpriseLeadKnowledgeNoPendingHint')}
              </div>
            )}
            {shouldShowEnterpriseLeadKnowledgeToolbarAddAction(activeView) ? (
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
                onClick={openAddModal}
              >
                <PlusIcon className={actionIconClassName} />
                {i18nService.t('enterpriseLeadKnowledgeAddContent')}
              </button>
            ) : null}
          </div>

          {shouldShowSelectionToolbar ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-primary/5 px-5 py-2.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="rounded-md bg-background px-2.5 py-1 text-xs font-semibold text-primary shadow-sm">
                  {formatEnterpriseLeadKnowledgeMessage(
                    'enterpriseLeadKnowledgeSelectedToolbarSummary',
                    { count: selectedKnowledgeCount },
                  )}
                </span>
                <button
                  type="button"
                  className="inline-flex h-8 items-center rounded-md border border-border bg-background px-2.5 text-xs font-medium text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
                  onClick={clearSelectedKnowledgeItems}
                >
                  {i18nService.t('enterpriseLeadKnowledgeClearSelectionAction')}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {shouldShowEnterpriseLeadKnowledgeBatchConfirmAction(
                  selectedPendingKnowledgeItems.length,
                ) ? (
                  <button
                    type="button"
                    disabled={isSaving}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/25 bg-background px-2.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-45 dark:text-emerald-300"
                    onClick={() => void confirmSelectedKnowledgeItems()}
                  >
                    <CheckCircleIcon className="h-4 w-4" />
                    {formatEnterpriseLeadKnowledgeMessage(
                      'enterpriseLeadKnowledgeConfirmSelectedAction',
                      { count: selectedPendingKnowledgeItems.length },
                    )}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={isSaving || selectedDeletableKnowledgeItems.length === 0}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-500/25 bg-background px-2.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-45 dark:text-amber-300"
                  onClick={() => setModalMode('deleteKnowledgeBatch')}
                >
                  <ArchiveBoxXMarkIcon className="h-4 w-4" />
                  {formatEnterpriseLeadKnowledgeMessage(
                    'enterpriseLeadKnowledgeDeleteSelectedAction',
                    { count: selectedDeletableKnowledgeItems.length },
                  )}
                </button>
              </div>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto">
            {filteredKnowledgeRows.length > 0 ? (
              <div className="min-w-[1120px]">
                <div className="min-w-0">
                  <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
                    <colgroup>
                      <col className={enterpriseLeadKnowledgeTableColumnClassNames.knowledge} />
                      <col className={enterpriseLeadKnowledgeTableColumnClassNames.category} />
                      <col className={enterpriseLeadKnowledgeTableColumnClassNames.status} />
                      <col className={enterpriseLeadKnowledgeTableColumnClassNames.actions} />
                    </colgroup>
                    <thead>
                      <tr className="bg-background text-xs font-semibold text-secondary">
                        <th className={enterpriseLeadKnowledgeHeaderCellClassName}>
                          <span className="flex items-center justify-start gap-3">
                            <input
                              type="checkbox"
                              checked={areAllFilteredKnowledgeItemsSelected}
                              disabled={isSaving || filteredSelectableKnowledgeItems.length === 0}
                              aria-label={i18nService.t(
                                'enterpriseLeadKnowledgeSelectVisibleAction',
                              )}
                              className="h-4 w-4 rounded border-border text-primary disabled:cursor-not-allowed disabled:opacity-45"
                              onChange={event =>
                                toggleFilteredKnowledgeSelection(event.target.checked)
                              }
                            />
                            <span>{i18nService.t('enterpriseLeadKnowledgeTableKnowledge')}</span>
                          </span>
                        </th>
                        <th className={enterpriseLeadKnowledgeHeaderCellClassName}>
                          {i18nService.t('enterpriseLeadKnowledgeTableCategory')}
                        </th>
                        <th className={enterpriseLeadKnowledgeHeaderCellClassName}>
                          {i18nService.t('enterpriseLeadKnowledgeTableStatus')}
                        </th>
                        <th className={enterpriseLeadKnowledgeHeaderCellClassName}>
                          {i18nService.t('enterpriseLeadKnowledgeTableActions')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredKnowledgeRows.map(row => {
                        const { item, section } = row;
                        const editable = isEditableItem(item);
                        const confirmed =
                          editable &&
                          isEnterpriseLeadKnowledgeItemConfirmed(currentWorkspace.profile, item);
                        const isChecked = selectedKnowledgeItemIdSet.has(item.id);
                        const sourceText = editable
                          ? i18nService.t('enterpriseLeadKnowledgeSourceWorkspaceProfile')
                          : getItemMeta(item) ||
                            i18nService.t('enterpriseLeadKnowledgeSourceGenerated');
                        const knowledgeMetaText = [
                          item.secondaryText && item.secondaryText !== item.text
                            ? item.secondaryText
                            : '',
                          `${i18nService.t('enterpriseLeadKnowledgeTableSource')}: ${sourceText}`,
                        ]
                          .filter(Boolean)
                          .join(' · ');
                        const statusClassName = confirmed
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : editable
                            ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                            : 'bg-surface-raised text-secondary';
                        const statusLabelKey = confirmed
                          ? 'enterpriseLeadKnowledgeStatusConfirmed'
                          : editable
                            ? 'enterpriseLeadKnowledgeStatusPendingConfirmation'
                            : 'enterpriseLeadKnowledgeStatusReadonly';
                        const usageLabelKey = confirmed
                          ? 'enterpriseLeadKnowledgeUsageAgentReadable'
                          : editable
                            ? 'enterpriseLeadKnowledgeUsagePendingConfirm'
                            : 'enterpriseLeadKnowledgeUsageSourceReadable';
                        const cellClassName = `border-b border-border px-3 py-3 align-middle ${
                          isChecked ? 'bg-primary/5' : 'bg-background'
                        }`;
                        return (
                          <tr key={item.id} className="group transition-colors hover:bg-surface/70">
                            <td
                              className={`relative border-b border-border px-4 py-3 align-middle ${
                                isChecked ? 'bg-primary/5' : 'bg-background'
                              }`}
                            >
                              <div className="flex min-w-0 items-start gap-3">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={!editable || isSaving}
                                  aria-label={i18nService.t(
                                    'enterpriseLeadKnowledgeSelectRowAction',
                                  )}
                                  className="mt-1 h-4 w-4 shrink-0 rounded border-border text-primary disabled:cursor-not-allowed disabled:opacity-35"
                                  onClick={event => event.stopPropagation()}
                                  onChange={() => toggleKnowledgeItemSelection(item)}
                                />
                                <div className="min-w-0">
                                  <p className="line-clamp-2 font-semibold leading-6 text-foreground">
                                    {item.text}
                                  </p>
                                  {knowledgeMetaText ? (
                                    <p className="mt-1 line-clamp-1 text-xs text-secondary">
                                      {knowledgeMetaText}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                            <td className={cellClassName}>
                              <div className="flex min-w-0 justify-center">
                                <span className="inline-flex max-w-full items-center truncate whitespace-nowrap rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                                  {i18nService.t(section.titleKey)}
                                </span>
                              </div>
                            </td>
                            <td className={cellClassName}>
                              <div className="flex min-w-0 flex-wrap justify-center gap-1.5">
                                <span
                                  className={`inline-flex whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${statusClassName}`}
                                >
                                  {i18nService.t(statusLabelKey)}
                                </span>
                                <span className="inline-flex whitespace-nowrap rounded-md bg-surface-raised px-2 py-1 text-xs font-medium text-secondary">
                                  {i18nService.t(usageLabelKey)}
                                </span>
                              </div>
                            </td>
                            <td className={`${cellClassName} text-right`}>
                              <div className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
                                <button
                                  type="button"
                                  disabled={!editable || isSaving}
                                  className={enterpriseLeadKnowledgeActionButtonClassNames.neutral}
                                  aria-label={i18nService.t('edit')}
                                  title={i18nService.t('edit')}
                                  onClick={event => {
                                    event.stopPropagation();
                                    openEditModalForRow(row);
                                  }}
                                >
                                  <PencilSquareIcon className="h-4 w-4" />
                                  <span>{i18nService.t('edit')}</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={!editable || isSaving}
                                  className={enterpriseLeadKnowledgeRowArchiveActionClassName}
                                  aria-label={i18nService.t('enterpriseLeadKnowledgeArchiveAction')}
                                  title={i18nService.t('enterpriseLeadKnowledgeArchiveAction')}
                                  onClick={event => {
                                    event.stopPropagation();
                                    void archiveKnowledgeItem(item);
                                  }}
                                >
                                  <ArchiveBoxXMarkIcon className="h-4 w-4" />
                                  <span>
                                    {i18nService.t('enterpriseLeadKnowledgeArchiveAction')}
                                  </span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="grid min-h-[320px] place-items-center px-6 text-center">
                <div>
                  <SparklesIcon className="mx-auto h-10 w-10 text-tertiary" />
                  <p className="mt-3 text-sm leading-6 text-secondary">
                    {i18nService.t('enterpriseLeadKnowledgeNoMatches')}
                  </p>
                </div>
              </div>
            )}
          </div>
            </>
          )}
        </section>
      </div>

      {modalMode !== 'none' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 px-4 py-6">
          <section
            className={`flex max-h-[calc(100vh-48px)] w-full flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl ${
              isDeleteKnowledgeBatchModal
                ? 'max-w-xl'
                : modalMode === 'company'
                  ? 'h-[720px] max-w-4xl'
                  : 'max-w-3xl'
            }`}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {isDeleteKnowledgeBatchModal
                    ? i18nService.t('enterpriseLeadKnowledgeBatchDeleteModalTitle')
                    : modalMode === 'company'
                      ? i18nService.t('enterpriseLeadKnowledgeCompanyModalTitle')
                      : itemDraft.mode === 'edit'
                        ? i18nService.t('enterpriseLeadKnowledgeEditModalTitle')
                        : i18nService.t('enterpriseLeadKnowledgeAddModalTitle')}
                </h2>
                <p className="mt-1 text-sm text-secondary">
                  {i18nService.t(
                    isDeleteKnowledgeBatchModal
                      ? 'enterpriseLeadKnowledgeBatchDeleteModalSubtitle'
                      : 'enterpriseLeadKnowledgeModalSubtitle',
                  )}
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

            <div
              className={
                modalMode === 'company'
                  ? 'min-h-0 flex-1 overflow-hidden'
                  : 'min-h-0 flex-1 overflow-y-auto px-5 py-4'
              }
            >
              {isDeleteKnowledgeBatchModal ? (
                <div className="grid gap-4">
                  <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-300">
                        <TrashIcon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          {formatEnterpriseLeadKnowledgeMessage(
                            'enterpriseLeadKnowledgeBatchDeleteSummary',
                            { count: selectedDeletableKnowledgeItems.length },
                          )}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-secondary">
                          {i18nService.t('enterpriseLeadKnowledgeBatchDeleteWarning')}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-surface px-4 py-3">
                    <p className="text-xs font-semibold text-secondary">
                      {i18nService.t('enterpriseLeadKnowledgeBatchDeleteScopeTitle')}
                    </p>
                    <div className="mt-2 grid gap-1.5 text-xs leading-5 text-secondary">
                      <p>{i18nService.t('enterpriseLeadKnowledgeBatchDeleteScopeKnowledge')}</p>
                      <p>{i18nService.t('enterpriseLeadKnowledgeBatchDeleteScopeDocuments')}</p>
                      <p>{i18nService.t('enterpriseLeadKnowledgeBatchDeleteScopeReadonly')}</p>
                    </div>
                  </div>
                </div>
              ) : modalMode === 'company' ? (
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
                        onChange={event =>
                          setCompanyDraft({
                            ...companyDraft,
                            [activeCompanyField]: event.target.value,
                          })
                        }
                        className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-6 text-foreground outline-none focus:border-primary/40"
                      />
                    </label>
                  </section>
                </div>
              ) : (
                <div className="grid gap-4">
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold text-secondary">
                      {i18nService.t('enterpriseLeadKnowledgeKindField')}
                    </span>
                    <select
                      value={itemDraft.kind}
                      onChange={event =>
                        setItemDraft({
                          ...itemDraft,
                          kind: event.target.value as EditableKnowledgeKind,
                        })
                      }
                      className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none"
                    >
                      {editableKnowledgeKinds.map(kind => (
                        <option key={kind} value={kind}>
                          {i18nService.t(itemKindLabelKeys[kind])}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold text-secondary">
                      {i18nService.t('enterpriseLeadKnowledgeContentField')}
                    </span>
                    <textarea
                      value={itemDraft.text}
                      onChange={event =>
                        setItemDraft({
                          ...itemDraft,
                          text: event.target.value,
                        })
                      }
                      className="min-h-[180px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none"
                      placeholder={i18nService.t('enterpriseLeadKnowledgeContentPlaceholder')}
                    />
                  </label>
                </div>
              )}
            </div>

            {isDeleteKnowledgeBatchModal ? (
              <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
                <button
                  type="button"
                  disabled={isSaving}
                  className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-secondary transition-colors hover:bg-surface-raised hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={closeModal}
                >
                  {i18nService.t('cancel')}
                </button>
                <button
                  type="button"
                  disabled={isSaving || selectedDeletableKnowledgeItems.length === 0}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void handleDeleteSelectedKnowledgeItems()}
                >
                  <ArchiveBoxXMarkIcon className="h-4 w-4" />
                  {isSaving
                    ? i18nService.t('saving')
                    : formatEnterpriseLeadKnowledgeMessage(
                        'enterpriseLeadKnowledgeBatchDeleteAction',
                        { count: selectedDeletableKnowledgeItems.length },
                      )}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
                <p className="text-xs text-secondary">
                  {i18nService.t('enterpriseLeadKnowledgeModalHint')}
                </p>
                <button
                  type="button"
                  disabled={isSaving}
                  className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={
                    modalMode === 'company' ? handleSaveCompanyDraft : handleSaveItemDraft
                  }
                >
                  {isSaving
                    ? i18nService.t('saving')
                    : i18nService.t('enterpriseLeadKnowledgeSaveAction')}
                </button>
              </div>
            )}
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
