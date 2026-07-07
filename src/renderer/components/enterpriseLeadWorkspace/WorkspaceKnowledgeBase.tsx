import {
  ArchiveBoxXMarkIcon,
  ArrowPathIcon,
  ArrowUpTrayIcon,
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
  EnterpriseLeadDocumentExtractionStatus,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadKnowledgeIndexStatus,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadExtractionSource,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceProfile,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../../shared/enterpriseLeadWorkspace/types';
import {
  enterpriseLeadWorkspaceService,
  EnterpriseLeadWorkspaceServiceError,
} from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import {
  type EditableKnowledgeField,
  EnterpriseLeadKnowledgeItemKind,
  EnterpriseLeadKnowledgeSection,
  getEditableKnowledgeField,
  getWorkspaceKnowledgeSections,
  type WorkspaceKnowledgeItem,
} from './enterpriseLeadWorkspaceUi';

interface WorkspaceKnowledgeBaseProps {
  workspace: EnterpriseLeadWorkspace;
  onWorkspaceUpdated?: (workspace: EnterpriseLeadWorkspace) => void;
}

const actionIconClassName = 'h-4 w-4';
export const enterpriseLeadKnowledgeTableColumnClassNames = {
  knowledge: 'w-[54%]',
  meta: 'w-[24%]',
  actions: 'w-[22%]',
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
export type EnterpriseLeadKnowledgeMessageTone = 'success' | 'failure' | 'exception';
interface EnterpriseLeadKnowledgeMessage {
  tone: EnterpriseLeadKnowledgeMessageTone;
  text: string;
}
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
const enterpriseLeadKnowledgeMessageLabelKeys: Record<
  EnterpriseLeadKnowledgeMessageTone,
  string
> = {
  success: 'enterpriseLeadKnowledgeMessageSuccessLabel',
  failure: 'enterpriseLeadKnowledgeMessageFailureLabel',
  exception: 'enterpriseLeadKnowledgeMessageExceptionLabel',
};
export const getEnterpriseLeadKnowledgeMessageRole = (
  tone: EnterpriseLeadKnowledgeMessageTone,
): 'status' | 'alert' => tone === 'success' ? 'status' : 'alert';

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
type EditableArrayField = typeof editableArrayFields[number];

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
type EditableKnowledgeKind = typeof editableKnowledgeKinds[number];

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

const sourceKindLabelKeys: Record<string, string> = {
  [EnterpriseLeadExtractionSourceKind.Blank]: 'enterpriseLeadKnowledgeDocumentTypeBlank',
  [EnterpriseLeadExtractionSourceKind.Conversation]:
    'enterpriseLeadKnowledgeDocumentTypeConversation',
  [EnterpriseLeadExtractionSourceKind.File]: 'enterpriseLeadKnowledgeDocumentTypeFile',
  [EnterpriseLeadExtractionSourceKind.Manual]: 'enterpriseLeadKnowledgeDocumentTypeManual',
  web: 'enterpriseLeadKnowledgeDocumentTypeWeb',
};

const documentSourceTypeOptions = [
  EnterpriseLeadExtractionSourceKind.File,
  EnterpriseLeadExtractionSourceKind.Manual,
  EnterpriseLeadExtractionSourceKind.Conversation,
  'web',
] as const;

const documentFileFilters = [
  {
    name: 'Documents',
    extensions: [
      'txt',
      'md',
      'markdown',
      'csv',
      'tsv',
      'json',
      'jsonl',
      'html',
      'htm',
      'xml',
      'yaml',
      'yml',
      'log',
      'pdf',
      'doc',
      'docx',
      'xls',
      'xlsx',
    ],
  },
  {
    name: 'All files',
    extensions: ['*'],
  },
];

export const enterpriseLeadReadableDocumentExtensions = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'html',
  'htm',
  'xml',
  'yaml',
  'yml',
  'log',
  'pdf',
  'docx',
  'xls',
  'xlsx',
]);

const sectionDefaultKinds: Partial<Record<EnterpriseLeadKnowledgeSection, EditableKnowledgeKind>> = {
  [EnterpriseLeadKnowledgeSection.Company]: EnterpriseLeadKnowledgeItemKind.CompanySummary,
  [EnterpriseLeadKnowledgeSection.Products]: EnterpriseLeadKnowledgeItemKind.Product,
  [EnterpriseLeadKnowledgeSection.Customers]: EnterpriseLeadKnowledgeItemKind.Customer,
  [EnterpriseLeadKnowledgeSection.Selling]: EnterpriseLeadKnowledgeItemKind.SellingPoint,
  [EnterpriseLeadKnowledgeSection.Rules]: EnterpriseLeadKnowledgeItemKind.ContactRule,
};

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
});

const cleanLines = (value: string): string[] =>
  Array.from(new Set(value.split('\n').map(item => item.trim()).filter(Boolean)));

const joinLines = (values: string[]): string => values.join('\n');

const isEditableArrayField = (
  field: keyof EnterpriseLeadWorkspaceProfile,
): field is EditableArrayField =>
  editableArrayFields.includes(field as EditableArrayField);

const getArrayIndexFromItemId = (item: WorkspaceKnowledgeItem): number => {
  const idParts = item.id.split('-');
  const indexText = idParts[idParts.length - 1] ?? '';
  const index = Number.parseInt(indexText, 10);
  return Number.isInteger(index) && index >= 0 ? index : -1;
};

const normalizeKnowledgeConfirmationText = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();

export const getEnterpriseLeadKnowledgeConfirmationKey = (
  item: WorkspaceKnowledgeItem,
): string => {
  const editableField = getEditableKnowledgeField(item.kind);
  const normalizedText = normalizeKnowledgeConfirmationText(item.text);
  return editableField && normalizedText ? `${editableField.field}:${normalizedText}` : '';
};

export const isEnterpriseLeadKnowledgeItemConfirmed = (
  profile: EnterpriseLeadWorkspaceProfile,
  item: WorkspaceKnowledgeItem,
): boolean => {
  const key = getEnterpriseLeadKnowledgeConfirmationKey(item);
  return Boolean(key && profile.confirmedKnowledgeKeys?.includes(key));
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
  nextProfile.confirmedKnowledgeKeys = Array.from(new Set([
    ...(nextProfile.confirmedKnowledgeKeys ?? []),
    key,
  ]));
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
  const nextKeys = nextProfile.confirmedKnowledgeKeys.filter(
    confirmedKey => confirmedKey !== key,
  );
  if (nextKeys.length > 0) {
    nextProfile.confirmedKnowledgeKeys = nextKeys;
  } else {
    delete nextProfile.confirmedKnowledgeKeys;
  }
  return nextProfile;
};

export const getEnterpriseLeadKnowledgePendingItemCount = (
  profile: EnterpriseLeadWorkspaceProfile,
  items: WorkspaceKnowledgeItem[],
): number =>
  items.filter(item =>
    Boolean(getEnterpriseLeadKnowledgeConfirmationKey(item)) &&
    !isEnterpriseLeadKnowledgeItemConfirmed(profile, item),
  ).length;

const getSourceIndexFromItemId = (item: WorkspaceKnowledgeItem): number => {
  const match = /^source-(\d+)$/.exec(item.id);
  return match ? Number.parseInt(match[1] ?? '-1', 10) : -1;
};

const getSourceKindLabel = (kind?: string): string =>
  i18nService.t(
    kind && sourceKindLabelKeys[kind]
      ? sourceKindLabelKeys[kind]
      : 'enterpriseLeadKnowledgeDocumentTypeUnknown',
  );

const documentStatusLabelKeys: Record<string, string> = {
  [EnterpriseLeadDocumentExtractionStatus.Pending]: 'enterpriseLeadKnowledgeDocumentStatusPending',
  [EnterpriseLeadDocumentExtractionStatus.Extracting]:
    'enterpriseLeadKnowledgeDocumentStatusExtracting',
  [EnterpriseLeadDocumentExtractionStatus.Extracted]:
    'enterpriseLeadKnowledgeDocumentStatusExtracted',
  [EnterpriseLeadDocumentExtractionStatus.Failed]: 'enterpriseLeadKnowledgeDocumentStatusFailed',
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

const documentStatusClassNames: Record<string, string> = {
  [EnterpriseLeadDocumentExtractionStatus.Pending]:
    'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  [EnterpriseLeadDocumentExtractionStatus.Extracting]:
    'bg-primary/10 text-primary',
  [EnterpriseLeadDocumentExtractionStatus.Extracted]:
    'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  [EnterpriseLeadDocumentExtractionStatus.Failed]:
    'bg-red-500/10 text-red-700 dark:text-red-300',
};

const vectorIndexStatusLabelKeys: Record<string, string> = {
  [EnterpriseLeadKnowledgeIndexStatus.Pending]:
    'enterpriseLeadKnowledgeVectorStatusPending',
  [EnterpriseLeadKnowledgeIndexStatus.Indexing]:
    'enterpriseLeadKnowledgeVectorStatusIndexing',
  [EnterpriseLeadKnowledgeIndexStatus.Indexed]:
    'enterpriseLeadKnowledgeVectorStatusIndexed',
  [EnterpriseLeadKnowledgeIndexStatus.Failed]:
    'enterpriseLeadKnowledgeVectorStatusFailed',
};

export const enterpriseLeadKnowledgeVectorIndexStatusClassNames: Record<string, string> = {
  [EnterpriseLeadKnowledgeIndexStatus.Pending]:
    'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  [EnterpriseLeadKnowledgeIndexStatus.Indexing]:
    'bg-primary/10 text-primary',
  [EnterpriseLeadKnowledgeIndexStatus.Indexed]:
    'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  [EnterpriseLeadKnowledgeIndexStatus.Failed]:
    'bg-red-500/10 text-red-700 dark:text-red-300',
};

const getDocumentExtractionStatus = (
  source?: EnterpriseLeadExtractionSource,
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

const getVectorIndexStatusLabel = (status: string): string =>
  i18nService.t(
    vectorIndexStatusLabelKeys[status] ?? 'enterpriseLeadKnowledgeVectorStatusPending',
  );

export const getEnterpriseLeadKnowledgeVectorIndexSummary = (
  source?: Pick<
    EnterpriseLeadExtractionSource,
    'vectorChunkCount' | 'vectorIndexError' | 'vectorIndexStatus'
  >,
): string => {
  const status = getEnterpriseLeadKnowledgeVectorIndexStatus(source);
  if (status === EnterpriseLeadKnowledgeIndexStatus.Indexed) {
    return i18nService.t('enterpriseLeadKnowledgeVectorIndexedText')
      .replace('{count}', String(source?.vectorChunkCount ?? 0));
  }
  if (status === EnterpriseLeadKnowledgeIndexStatus.Failed) {
    return source?.vectorIndexError ||
      i18nService.t('enterpriseLeadKnowledgeVectorFailedText');
  }
  if (status === EnterpriseLeadKnowledgeIndexStatus.Indexing) {
    return i18nService.t('enterpriseLeadKnowledgeVectorIndexingText');
  }
  return i18nService.t('enterpriseLeadKnowledgeVectorPendingText');
};

const getVectorIndexStatusClassName = (status: string): string =>
  enterpriseLeadKnowledgeVectorIndexStatusClassNames[status] ??
  enterpriseLeadKnowledgeVectorIndexStatusClassNames[EnterpriseLeadKnowledgeIndexStatus.Pending] ??
  '';

const getDocumentStatusLabel = (status: string): string =>
  i18nService.t(
    documentStatusLabelKeys[status] ?? 'enterpriseLeadKnowledgeDocumentStatusPending',
  );

const getDocumentStatusDescription = (status: string): string =>
  i18nService.t(
    documentStatusTextKeys[status] ?? 'enterpriseLeadKnowledgeDocumentPendingExtractText',
  );

const getDocumentStatusClassName = (status: string): string =>
  documentStatusClassNames[status] ?? documentStatusClassNames[
    EnterpriseLeadDocumentExtractionStatus.Pending
  ] ?? '';

const formatFileSize = (size?: number | null): string => {
  if (!size || !Number.isFinite(size) || size <= 0) {
    return '';
  }
  if (size < 1024) {
    return `${Math.round(size)} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
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

type KnowledgeView = 'documents' | 'knowledge';
type KnowledgeStatusFilter = 'all' | 'editable' | 'readonly';
type DocumentStatusFilter =
  | 'all'
  | typeof EnterpriseLeadDocumentExtractionStatus.Pending
  | typeof EnterpriseLeadDocumentExtractionStatus.Extracting
  | typeof EnterpriseLeadDocumentExtractionStatus.Extracted
  | typeof EnterpriseLeadDocumentExtractionStatus.Failed;
type ModalMode = 'none' | 'company' | 'item' | 'document' | 'documentPreview';
type ItemModalMode = 'add' | 'edit';

interface KnowledgeTableRow {
  item: WorkspaceKnowledgeItem;
  section: ReturnType<typeof getWorkspaceKnowledgeSections>[number];
}

interface DocumentDraft {
  mode: 'add' | 'edit';
  sourceIndex: number;
  name: string;
  category: string;
  fileName: string;
  fileSize: number | null;
  sourceType: string;
  note: string;
  summary: string;
  extractImmediately: boolean;
}

const createEmptyDocumentDraft = (): DocumentDraft => ({
  category: '',
  extractImmediately: true,
  fileName: '',
  fileSize: null,
  mode: 'add',
  name: '',
  note: '',
  summary: '',
  sourceIndex: -1,
  sourceType: EnterpriseLeadExtractionSourceKind.Manual,
});

const createDocumentDraftFromSource = (
  source: EnterpriseLeadExtractionSource,
  sourceIndex: number,
): DocumentDraft => ({
  category: source.filePath ?? '',
  extractImmediately: false,
  fileName: source.fileName ?? getFileNameFromPath(source.filePath ?? ''),
  fileSize: source.fileSize ?? null,
  mode: 'edit',
  name: source.label,
  note: source.text ?? '',
  summary: source.summary ?? '',
  sourceIndex,
  sourceType: source.kind || EnterpriseLeadExtractionSourceKind.Manual,
});

function getFileNameFromPath(filePath: string): string {
  const normalized = filePath.trim();
  if (!normalized) {
    return '';
  }
  return normalized.split(/[\\/]/).filter(Boolean).pop() ?? normalized;
}

const getFileNameWithoutExtension = (filePath: string): string => {
  const fileName = getFileNameFromPath(filePath);
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
};

const getFileExtension = (filePath: string): string => {
  const fileName = getFileNameFromPath(filePath);
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex > -1 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
};

const mergeUniqueValues = (currentValues: string[], incomingValues: string[]): string[] => {
  const seen = new Set<string>();
  return [...currentValues, ...incomingValues]
    .map(value => value.trim())
    .filter(value => {
      if (!value) {
        return false;
      }
      const key = value.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
};

const mergeExtractedProfile = (
  currentProfile: EnterpriseLeadWorkspaceProfile,
  extractedProfile: EnterpriseLeadWorkspaceProfile,
): EnterpriseLeadWorkspaceProfile => ({
  ...cloneProfile(currentProfile),
  companySummary: currentProfile.companySummary.trim() ||
    extractedProfile.companySummary.trim(),
  productList: mergeUniqueValues(currentProfile.productList, extractedProfile.productList),
  productCapabilities: mergeUniqueValues(
    currentProfile.productCapabilities,
    extractedProfile.productCapabilities,
  ),
  targetCustomers: mergeUniqueValues(
    currentProfile.targetCustomers,
    extractedProfile.targetCustomers,
  ),
  applicationScenarios: mergeUniqueValues(
    currentProfile.applicationScenarios,
    extractedProfile.applicationScenarios,
  ),
  sellingPoints: mergeUniqueValues(currentProfile.sellingPoints, extractedProfile.sellingPoints),
  channelPreferences: mergeUniqueValues(
    currentProfile.channelPreferences,
    extractedProfile.channelPreferences,
  ),
  prohibitedClaims: mergeUniqueValues(
    currentProfile.prohibitedClaims,
    extractedProfile.prohibitedClaims,
  ),
  contactRules: mergeUniqueValues(currentProfile.contactRules, extractedProfile.contactRules),
  missingInfo: mergeUniqueValues(currentProfile.missingInfo, extractedProfile.missingInfo),
});

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
  companyDraftFieldConfigs.find(config => config.field === field) ??
  defaultCompanyDraftFieldConfig;

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
  kind: (item?.kind && editableKnowledgeKinds.includes(item.kind as EditableKnowledgeKind))
    ? item.kind as EditableKnowledgeKind
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
  const [feedbackMessage, setFeedbackMessage] =
    useState<EnterpriseLeadKnowledgeMessage | null>(null);
  const [activeView, setActiveView] = useState<KnowledgeView>('documents');
  const [selectedItemId, setSelectedItemId] = useState(
    enterpriseLeadKnowledgeInitialSelectedItemId,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<KnowledgeStatusFilter>('all');
  const [documentStatusFilter, setDocumentStatusFilter] = useState<DocumentStatusFilter>('all');
  const [modalMode, setModalMode] = useState<ModalMode>('none');
  const [activeCompanyField, setActiveCompanyField] =
    useState<CompanyDraftField>('companySummary');
  const [companyDraft, setCompanyDraft] = useState<CompanyDraft>(
    () => buildCompanyDraft(workspace.profile),
  );
  const [itemDraft, setItemDraft] = useState<ItemDraft>(
    () => createItemDraft(EnterpriseLeadKnowledgeSection.Company),
  );
  const [documentDraft, setDocumentDraft] = useState<DocumentDraft>(createEmptyDocumentDraft);
  const requestRef = useRef(0);
  const pendingSelectionRef = useRef<{
    field: keyof EnterpriseLeadWorkspaceProfile;
    index: number;
  } | null>(null);
  const showFeedbackMessage = (
    tone: EnterpriseLeadKnowledgeMessageTone,
    messageKey: string,
  ): void => {
    setFeedbackMessage({
      text: i18nService.t(messageKey),
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
      setFeedbackMessage(current => current === feedbackMessage ? null : current);
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

    enterpriseLeadWorkspaceService.getRun(workspace.id, workspace.recentRunId ?? undefined)
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
        return editableField?.field === pendingSelection.field &&
          getArrayIndexFromItemId(item) === pendingSelection.index;
      });

    if (matchingItem) {
      setSelectedItemId(matchingItem.id);
      pendingSelectionRef.current = null;
    }
  }, [sections]);

  const knowledgeRows = useMemo<KnowledgeTableRow[]>(
    () => sections.flatMap(section => section.items.map(item => ({ item, section }))),
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
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredDocumentRows = documentRows.filter(({ item }) => {
    const sourceIndex = getSourceIndexFromItemId(item);
    const source = currentWorkspace.extractionSources[sourceIndex];
    const extractionStatus = getDocumentExtractionStatus(source);
    const searchableText = [item.text, item.secondaryText, item.metaText]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const matchesQuery = !normalizedQuery || searchableText.includes(normalizedQuery);
    const matchesStatus =
      documentStatusFilter === 'all' || documentStatusFilter === extractionStatus;
    return matchesQuery && matchesStatus;
  });
  const filteredKnowledgeRows = knowledgeRows.filter(({ item, section }) => {
    const searchableText = [item.text, item.secondaryText, item.metaText, i18nService.t(section.titleKey)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const matchesQuery = !normalizedQuery || searchableText.includes(normalizedQuery);
    const editable = isEditableItem(item);
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'editable' && editable) ||
      (statusFilter === 'readonly' && !editable);
    return matchesQuery && matchesStatus;
  });
  const documentPreviewText = documentDraft.note.trim();
  const documentFileName = documentDraft.fileName || getFileNameFromPath(documentDraft.category);
  const documentExtension = getFileExtension(documentDraft.category || documentFileName);
  const documentPreviewCharCount = documentPreviewText.replace(/\s/g, '').length;
  const previewDocumentSource = documentDraft.sourceIndex >= 0
    ? currentWorkspace.extractionSources[documentDraft.sourceIndex]
    : undefined;
  const isDocumentPreviewModal = modalMode === 'documentPreview';
  const activeCompanyFieldConfig = getCompanyDraftFieldConfig(activeCompanyField);
  const activeCompanyValue = companyDraft[activeCompanyField];
  const activeCompanyValueCount = getCompanyDraftValueCount(activeCompanyValue);

  const saveProfile = async (
    nextProfile: EnterpriseLeadWorkspaceProfile,
    successMessageKey: string,
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
      showFeedbackMessage('success', successMessageKey);
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

  const saveSources = async (
    nextSources: EnterpriseLeadExtractionSource[],
    successMessageKey: string,
  ): Promise<EnterpriseLeadWorkspace | null> => {
    setIsSaving(true);
    clearFeedbackMessage();
    try {
      const updatedWorkspace = await enterpriseLeadWorkspaceService.updateWorkspaceSources(
        currentWorkspace.id,
        nextSources,
      );
      if (!updatedWorkspace) {
        throw new Error('Workspace source update returned empty result');
      }
      setCurrentWorkspace(updatedWorkspace);
      onWorkspaceUpdated?.(updatedWorkspace);
      showFeedbackMessage('success', successMessageKey);
      return updatedWorkspace;
    } catch (saveError) {
      const isApiUnavailable = saveError instanceof Error &&
        saveError.message === EnterpriseLeadWorkspaceServiceError.UpdateSourcesApiUnavailable;
      const isUnexpectedEmpty = saveError instanceof Error &&
        saveError.message === 'Workspace source update returned empty result';
      showFeedbackMessage(
        isApiUnavailable || isUnexpectedEmpty ? 'exception' : 'failure',
        isApiUnavailable
          ? 'enterpriseLeadKnowledgeDocumentApiUnavailable'
          : isUnexpectedEmpty
            ? 'enterpriseLeadKnowledgeUnexpectedError'
            : 'enterpriseLeadKnowledgeSaveFailed',
      );
      return null;
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

  const openDocumentModal = (): void => {
    setDocumentDraft(createEmptyDocumentDraft());
    setModalMode('document');
  };

  const syncDocumentSources = async (): Promise<void> => {
    await saveSources(
      currentWorkspace.extractionSources,
      'enterpriseLeadKnowledgeSourcesSynced',
    );
  };

  const selectDocumentFile = async (): Promise<void> => {
    const dialogApi = window.electron?.dialog;
    if (!dialogApi?.selectFile) {
      showFeedbackMessage('exception', 'enterpriseLeadKnowledgeFileSelectionUnavailable');
      return;
    }

    clearFeedbackMessage();
    const result = await dialogApi.selectFile({
      title: i18nService.t('enterpriseLeadKnowledgeChooseDocumentFile'),
      filters: documentFileFilters,
    });
    if (!result.success || !result.path) {
      if (!result.success) {
        showFeedbackMessage('failure', 'enterpriseLeadKnowledgeFileSelectionFailed');
      }
      return;
    }

    const selectedPath = result.path;
    const fileName = getFileNameFromPath(selectedPath);
    const extension = getFileExtension(selectedPath);
    const statResult = dialogApi.statFile ? await dialogApi.statFile(selectedPath) : null;
    let nextNote = documentDraft.note;

    if (enterpriseLeadReadableDocumentExtensions.has(extension) && dialogApi.readTextFile) {
      const readResult = await dialogApi.readTextFile(selectedPath);
      if (readResult.success) {
        nextNote = readResult.content ?? '';
        if (readResult.truncated) {
          showFeedbackMessage('exception', 'enterpriseLeadKnowledgeFileTextTruncated');
        }
      } else {
        showFeedbackMessage('failure', 'enterpriseLeadKnowledgeFileReadFailed');
      }
    } else {
      showFeedbackMessage('exception', 'enterpriseLeadKnowledgeFileReadUnsupported');
    }

    setDocumentDraft({
      ...documentDraft,
      category: selectedPath,
      fileName,
      fileSize: statResult?.success ? statResult.size ?? null : null,
      name: documentDraft.name.trim() ? documentDraft.name : getFileNameWithoutExtension(fileName),
      note: nextNote,
      sourceType: EnterpriseLeadExtractionSourceKind.File,
    });
  };

  const openEditDocumentModal = (item: WorkspaceKnowledgeItem): void => {
    const sourceIndex = getSourceIndexFromItemId(item);
    const source = currentWorkspace.extractionSources[sourceIndex];
    if (!source) {
      return;
    }
    setSelectedItemId(item.id);
    setDocumentDraft(createDocumentDraftFromSource(source, sourceIndex));
    setModalMode('document');
  };

  const openPreviewDocumentModal = (item: WorkspaceKnowledgeItem): void => {
    const sourceIndex = getSourceIndexFromItemId(item);
    const source = currentWorkspace.extractionSources[sourceIndex];
    if (!source) {
      return;
    }
    setSelectedItemId(item.id);
    setDocumentDraft(createDocumentDraftFromSource(source, sourceIndex));
    setModalMode('documentPreview');
  };

  const openEditModalForRow = (row: KnowledgeTableRow): void => {
    if (!isEditableItem(row.item)) {
      return;
    }
    setSelectedItemId(row.item.id);
    setItemDraft(createItemDraft(row.section.id, row.item));
    setModalMode('item');
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

    const currentItem = itemDraft.mode === 'edit'
      ? sections
        .flatMap(section => section.items)
        .find(item => item.id === itemDraft.editingItemId) ?? null
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

    await saveProfile(
      nextProfile,
      itemDraft.mode === 'edit'
        ? 'enterpriseLeadKnowledgeItemUpdated'
        : 'enterpriseLeadKnowledgeItemAdded',
    );
    setModalMode('none');
  };

  const extractDocumentSource = async (
    workspaceWithSource: EnterpriseLeadWorkspace,
    sourceIndex: number,
    sourceText: string,
    successMessageKey: string,
  ): Promise<void> => {
    let latestWorkspace = workspaceWithSource;
    setIsSaving(true);
    clearFeedbackMessage();
    try {
      const extractedDraft = await enterpriseLeadWorkspaceService.extractDraft(sourceText);
      if (!extractedDraft) {
        throw new Error('Document extraction returned empty result');
      }
      const nextProfile = mergeExtractedProfile(
        latestWorkspace.profile,
        extractedDraft.profile,
      );
      const profiledWorkspace = await enterpriseLeadWorkspaceService.updateWorkspaceProfile(
        latestWorkspace.id,
        nextProfile,
      );
      if (!profiledWorkspace) {
        throw new Error('Document extraction profile update returned empty result');
      }
      latestWorkspace = profiledWorkspace;

      const now = new Date().toISOString();
      const extractedSources = [...latestWorkspace.extractionSources];
      const extractedSource = extractedSources[sourceIndex];
      if (extractedSource) {
        extractedSources[sourceIndex] = {
          ...extractedSource,
          extractionError: undefined,
          extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
          lastExtractedAt: now,
          updatedAt: now,
        };
      }
      const extractedWorkspace = await enterpriseLeadWorkspaceService.updateWorkspaceSources(
        latestWorkspace.id,
        extractedSources,
      );
      if (!extractedWorkspace) {
        throw new Error('Document extraction source update returned empty result');
      }

      setCurrentWorkspace(extractedWorkspace);
      setCompanyDraft(buildCompanyDraft(extractedWorkspace.profile));
      onWorkspaceUpdated?.(extractedWorkspace);
      setActiveView('knowledge');
      showFeedbackMessage('success', successMessageKey);
    } catch {
      const now = new Date().toISOString();
      const failedSources = [...latestWorkspace.extractionSources];
      const failedSource = failedSources[sourceIndex];
      if (failedSource) {
        failedSources[sourceIndex] = {
          ...failedSource,
          extractionError: i18nService.t('enterpriseLeadKnowledgeDocumentExtractFailed'),
          extractionStatus: EnterpriseLeadDocumentExtractionStatus.Failed,
          updatedAt: now,
        };
      }
      try {
        const failedWorkspace = await enterpriseLeadWorkspaceService.updateWorkspaceSources(
          latestWorkspace.id,
          failedSources,
        );
        if (failedWorkspace) {
          setCurrentWorkspace(failedWorkspace);
          onWorkspaceUpdated?.(failedWorkspace);
        }
      } catch {
        // The visible error below is enough for this user action.
      }
      showFeedbackMessage('failure', 'enterpriseLeadKnowledgeDocumentExtractFailed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDocumentDraft = async (): Promise<void> => {
    const name = documentDraft.name.trim();
    if (!name) {
      showFeedbackMessage('failure', 'enterpriseLeadKnowledgeDocumentNameRequired');
      return;
    }
    const sourcePath = documentDraft.category.trim();
    if (!sourcePath) {
      showFeedbackMessage('failure', 'enterpriseLeadKnowledgeDocumentFileRequired');
      return;
    }
    const sourceText = documentDraft.note.trim();
    if (documentDraft.extractImmediately && !sourceText) {
      showFeedbackMessage('failure', 'enterpriseLeadKnowledgeDocumentExtractTextRequired');
      return;
    }

    const now = new Date().toISOString();
    const nextSource: EnterpriseLeadExtractionSource = {
      kind: documentDraft.sourceType || EnterpriseLeadExtractionSourceKind.File,
      label: name,
      filePath: sourcePath,
      fileName: documentDraft.fileName || getFileNameFromPath(sourcePath),
      fileSize: documentDraft.fileSize ?? undefined,
      text: sourceText || undefined,
      summary: documentDraft.summary.trim() || undefined,
      ...(documentDraft.extractImmediately && sourceText
        ? {
          extractionError: undefined,
          extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracting,
        }
        : documentDraft.mode === 'add'
          ? { extractionStatus: EnterpriseLeadDocumentExtractionStatus.Pending }
          : {}),
      createdAt: now,
      updatedAt: now,
    };
    const nextSources = [...currentWorkspace.extractionSources];
    if (documentDraft.mode === 'edit' && documentDraft.sourceIndex >= 0) {
      const previousSource = nextSources[documentDraft.sourceIndex];
      if (!previousSource) {
        showFeedbackMessage('exception', 'enterpriseLeadKnowledgeDocumentMissingError');
        return;
      }
      nextSources[documentDraft.sourceIndex] = {
        ...previousSource,
        ...nextSource,
        createdAt: previousSource.createdAt ?? now,
      };
    } else {
      nextSources.unshift(nextSource);
    }

    const savedWorkspace = await saveSources(
      nextSources,
      documentDraft.mode === 'edit'
        ? 'enterpriseLeadKnowledgeDocumentUpdated'
        : 'enterpriseLeadKnowledgeDocumentAdded',
    );
    if (!savedWorkspace) {
      return;
    }
    if (!documentDraft.extractImmediately || !sourceText) {
      setModalMode('none');
      return;
    }

    await extractDocumentSource(
      savedWorkspace,
      documentDraft.mode === 'edit' ? documentDraft.sourceIndex : 0,
      sourceText,
      documentDraft.mode === 'edit'
        ? 'enterpriseLeadKnowledgeDocumentUpdatedAndExtracted'
        : 'enterpriseLeadKnowledgeDocumentAddedAndExtracted',
    );
    setModalMode('none');
  };

  const deleteDocumentSource = async (item: WorkspaceKnowledgeItem): Promise<void> => {
    const sourceIndex = getSourceIndexFromItemId(item);
    if (sourceIndex < 0 || !currentWorkspace.extractionSources[sourceIndex]) {
      return;
    }
    if (!window.confirm(i18nService.t('enterpriseLeadKnowledgeDeleteDocumentConfirm'))) {
      return;
    }
    const nextSources = currentWorkspace.extractionSources.filter(
      (_source, index) => index !== sourceIndex,
    );
    setSelectedItemId('');
    await saveSources(nextSources, 'enterpriseLeadKnowledgeDocumentDeleted');
  };

  const archiveKnowledgeItem = async (item: WorkspaceKnowledgeItem): Promise<void> => {
    const editableField = getEditableItemField(item);
    if (!editableField) {
      return;
    }
    const nextProfile = cloneProfile(currentWorkspace.profile);
    if (editableField.field === 'companySummary') {
      nextProfile.companySummary = '';
    } else if (isEditableArrayField(editableField.field)) {
      const index = getArrayIndexFromItemId(item);
      if (index >= 0) {
        nextProfile[editableField.field].splice(index, 1);
      }
    }
    setSelectedItemId('');
    await saveProfile(nextProfile, 'enterpriseLeadKnowledgeItemArchived');
  };

  const confirmKnowledgeItem = async (item: WorkspaceKnowledgeItem): Promise<void> => {
    if (!getEditableItemField(item)) {
      return;
    }
    setSelectedItemId(item.id);
    if (enterpriseLeadKnowledgeConfirmBehavior.persistProfile) {
      await saveProfile(
        confirmEnterpriseLeadKnowledgeItemInProfile(currentWorkspace.profile, item),
        enterpriseLeadKnowledgeConfirmBehavior.successMessageKey,
      );
      return;
    }
    showFeedbackMessage('success', enterpriseLeadKnowledgeConfirmBehavior.successMessageKey);
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
              <span aria-hidden="true" className={enterpriseLeadKnowledgeMessageSuccessAccentClassName} />
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
              disabled={isSaving}
              onClick={() => void syncDocumentSources()}
            >
              <ArrowPathIcon className={actionIconClassName} />
              {i18nService.t('enterpriseLeadKnowledgeSyncDocuments')}
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-secondary shadow-sm transition-colors hover:bg-surface-raised hover:text-foreground"
              onClick={openCompanyModal}
            >
              <BuildingOffice2Icon className={actionIconClassName} />
              {i18nService.t('enterpriseLeadKnowledgeMaintainCompany')}
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              onClick={openDocumentModal}
            >
              <PlusIcon className={actionIconClassName} />
              {i18nService.t('enterpriseLeadKnowledgeAddDocument')}
            </button>
          </div>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-2 border-b border-border bg-surface/50 md:grid-cols-4">
        <div className="border-r border-border px-6 py-4">
          <p className="text-2xl font-semibold text-foreground">{documentRows.length}</p>
          <p className="mt-1 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadKnowledgeDocumentMetric')}
          </p>
        </div>
        <div className="border-r border-border px-6 py-4">
          <p className="text-2xl font-semibold text-foreground">{knowledgeRows.length}</p>
          <p className="mt-1 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadKnowledgeAiKnowledgeMetric')}
          </p>
        </div>
        <div className="border-r border-border px-6 py-4">
          <p className="text-2xl font-semibold text-amber-600">{pendingKnowledgeCount}</p>
          <p className="mt-1 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadKnowledgePendingMetric')}
          </p>
        </div>
        <div className="px-6 py-4">
          <p className="text-2xl font-semibold text-foreground">{readOnlyCount}</p>
          <p className="mt-1 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadKnowledgeReferencedMetric')}
          </p>
        </div>
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
                  setSelectedItemId(getEnterpriseLeadKnowledgeSelectedItemIdAfterViewChange(
                    'documents',
                  ));
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
                  setSelectedItemId(getEnterpriseLeadKnowledgeSelectedItemIdAfterViewChange(
                    'knowledge',
                  ));
                  setSearchQuery('');
                }}
              >
                <SparklesIcon className="h-4 w-4" />
                {i18nService.t('enterpriseLeadKnowledgeAiKnowledgeTitle')}
              </button>
            </div>
          </div>

          <div className="grid gap-3 border-b border-border px-5 py-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
            <label className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-secondary">
              <MagnifyingGlassIcon className="h-4 w-4 shrink-0" />
              <input
                type="search"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder={i18nService.t(
                  activeView === 'documents'
                    ? 'enterpriseLeadKnowledgeDocumentSearchPlaceholder'
                    : 'enterpriseLeadKnowledgeKnowledgeSearchPlaceholder',
                )}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-tertiary"
              />
            </label>
            {activeView === 'documents' ? (
              <select
                value={documentStatusFilter}
                onChange={event => setDocumentStatusFilter(event.target.value as DocumentStatusFilter)}
                className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-secondary outline-none"
              >
                <option value="all">{i18nService.t('enterpriseLeadKnowledgeDocumentStatusAll')}</option>
                <option value={EnterpriseLeadDocumentExtractionStatus.Pending}>
                  {i18nService.t('enterpriseLeadKnowledgeDocumentStatusPending')}
                </option>
                <option value={EnterpriseLeadDocumentExtractionStatus.Extracting}>
                  {i18nService.t('enterpriseLeadKnowledgeDocumentStatusExtracting')}
                </option>
                <option value={EnterpriseLeadDocumentExtractionStatus.Extracted}>
                  {i18nService.t('enterpriseLeadKnowledgeDocumentStatusExtracted')}
                </option>
                <option value={EnterpriseLeadDocumentExtractionStatus.Failed}>
                  {i18nService.t('enterpriseLeadKnowledgeDocumentStatusFailed')}
                </option>
              </select>
            ) : (
              <select
                value={statusFilter}
                onChange={event => setStatusFilter(event.target.value as KnowledgeStatusFilter)}
                className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-secondary outline-none"
              >
                <option value="all">{i18nService.t('enterpriseLeadKnowledgeFilterAll')}</option>
                <option value="editable">{i18nService.t('enterpriseLeadKnowledgeFilterEditable')}</option>
                <option value="readonly">{i18nService.t('enterpriseLeadKnowledgeFilterReadonly')}</option>
              </select>
            )}
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
              onClick={activeView === 'documents' ? openDocumentModal : openAddModal}
            >
              <PlusIcon className={actionIconClassName} />
              {activeView === 'documents'
                ? i18nService.t('enterpriseLeadKnowledgeAddDocument')
                : i18nService.t('enterpriseLeadKnowledgeAddContent')}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {activeView === 'documents' ? (
              filteredDocumentRows.length > 0 ? (
                <div className="w-full min-w-0 p-3 text-sm">
                  <div className="sticky top-0 z-10 grid grid-cols-[minmax(150px,1fr)_72px_76px_minmax(96px,0.46fr)_minmax(108px,0.46fr)_112px_minmax(216px,244px)] items-center gap-2.5 border-b border-border bg-background/95 px-4 py-2 text-xs font-semibold text-secondary backdrop-blur">
                    <span className={enterpriseLeadKnowledgeDocumentHeaderClassName}>
                      {i18nService.t('enterpriseLeadKnowledgeTableDocument')}
                    </span>
                    <span className={enterpriseLeadKnowledgeDocumentHeaderClassName}>
                      {i18nService.t('enterpriseLeadKnowledgeTableType')}
                    </span>
                    <span className={enterpriseLeadKnowledgeDocumentHeaderClassName}>
                      {i18nService.t('enterpriseLeadKnowledgeTableStatus')}
                    </span>
                    <span className={enterpriseLeadKnowledgeDocumentHeaderClassName}>
                      {i18nService.t('enterpriseLeadKnowledgeTableAiExtract')}
                    </span>
                    <span className={enterpriseLeadKnowledgeDocumentHeaderClassName}>
                      {i18nService.t('enterpriseLeadKnowledgeTableVectorIndex')}
                    </span>
                    <span className={enterpriseLeadKnowledgeDocumentHeaderClassName}>
                      {i18nService.t('enterpriseLeadKnowledgeTableUpdated')}
                    </span>
                    <span className={enterpriseLeadKnowledgeDocumentHeaderLastClassName}>
                      {i18nService.t('enterpriseLeadKnowledgeTableActions')}
                    </span>
                  </div>
                  <div className="grid gap-2 pt-2">
                    {filteredDocumentRows.map(row => {
                      const { item } = row;
                      const sourceIndex = getSourceIndexFromItemId(item);
                      const source = currentWorkspace.extractionSources[sourceIndex];
                      const extractionStatus = getDocumentExtractionStatus(source);
                      const vectorIndexStatus = getEnterpriseLeadKnowledgeVectorIndexStatus(source);
                      const isSelected = selectedItemId === item.id;
                      const sourceTextLength = source?.text?.replace(/\s/g, '').length ?? 0;
                      const sourceDetail = source?.fileName ||
                        source?.filePath ||
                        item.secondaryText ||
                        i18nService.t('enterpriseLeadKnowledgeDocumentSourceManaged');
                      return (
                        <div
                          key={item.id}
                          className={`relative grid min-h-[76px] cursor-pointer grid-cols-[minmax(150px,1fr)_72px_76px_minmax(96px,0.46fr)_minmax(108px,0.46fr)_112px_minmax(216px,244px)] items-center gap-2.5 rounded-lg border px-4 py-3 transition-colors ${
                            isSelected
                              ? 'border-primary/25 bg-background shadow-[0_0_0_1px_rgba(59,130,246,0.12)]'
                              : 'border-transparent bg-background hover:border-border hover:bg-surface/50'
                          }`}
                          onClick={() => setSelectedItemId(item.id)}
                        >
                          {isSelected ? (
                            <span className="absolute bottom-3 left-0 top-3 w-1 rounded-r-full bg-primary" />
                          ) : null}
                          <div className="flex min-w-0 items-center gap-3 pl-2">
                            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                              isSelected
                                ? 'bg-primary/10 text-primary'
                                : 'bg-surface-raised text-secondary'
                            }`}
                            >
                              <DocumentTextIcon className="h-5 w-5" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {item.text}
                              </p>
                              <p className="mt-1 truncate text-xs text-secondary">
                                {sourceDetail}
                              </p>
                              {source?.summary ? (
                                <p className="mt-1 line-clamp-1 text-xs text-tertiary">
                                  {source.summary}
                                </p>
                              ) : null}
                            </div>
                          </div>

                          <div className="min-w-0">
                            <span className="inline-flex max-w-full items-center truncate whitespace-nowrap rounded-md bg-primary/10 px-1.5 py-1 text-xs font-semibold text-primary">
                              {getSourceKindLabel(item.metaText)}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <span className={`inline-flex max-w-full truncate whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-semibold ${
                              getDocumentStatusClassName(extractionStatus)
                            }`}
                            >
                              {getDocumentStatusLabel(extractionStatus)}
                            </span>
                          </div>

                          <div className="min-w-0">
                            <p className="line-clamp-1 text-sm font-medium text-foreground">
                              {getDocumentStatusDescription(extractionStatus)}
                            </p>
                            {sourceTextLength > 0 ? (
                              <p className="mt-1 text-xs text-tertiary">
                                {i18nService.t('enterpriseLeadKnowledgeDocumentPreviewStats')
                                  .replace('{count}', String(sourceTextLength))}
                              </p>
                            ) : null}
                          </div>

                          <div className="min-w-0">
                            <span className={`inline-flex max-w-full truncate whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-semibold ${
                              getVectorIndexStatusClassName(vectorIndexStatus)
                            }`}
                            >
                              {getVectorIndexStatusLabel(vectorIndexStatus)}
                            </span>
                            <p className="mt-1 line-clamp-1 text-xs text-tertiary">
                              {getEnterpriseLeadKnowledgeVectorIndexSummary(source)}
                            </p>
                          </div>

                          <div className="truncate text-sm text-secondary">
                            {formatKnowledgeDate(item.updatedAt ?? item.createdAt) ||
                              i18nService.t('enterpriseLeadKnowledgeUnknownTime')}
                          </div>

                          <div className="flex min-w-0 items-center justify-end gap-1.5 whitespace-nowrap">
                            <button
                              type="button"
                              disabled={isSaving}
                              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary/10 px-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-45"
                              onClick={event => {
                                event.stopPropagation();
                                openPreviewDocumentModal(item);
                              }}
                            >
                              <DocumentTextIcon className="h-4 w-4" />
                              {i18nService.t('enterpriseLeadKnowledgePreviewDocument')}
                            </button>
                            <button
                              type="button"
                              disabled={isSaving}
                              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium text-secondary transition-colors hover:bg-surface-raised hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
                              onClick={event => {
                                event.stopPropagation();
                                openEditDocumentModal(item);
                              }}
                            >
                              <PencilSquareIcon className="h-4 w-4" />
                              {i18nService.t('edit')}
                            </button>
                            <button
                              type="button"
                              disabled={isSaving}
                              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-red-500/20 bg-background px-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-45 dark:text-red-300"
                              onClick={event => {
                                event.stopPropagation();
                                void deleteDocumentSource(item);
                              }}
                            >
                              <TrashIcon className="h-4 w-4" />
                              {i18nService.t('delete')}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="grid min-h-[320px] place-items-center px-6 text-center">
                  <div>
                    <DocumentTextIcon className="mx-auto h-10 w-10 text-tertiary" />
                    <p className="mt-3 text-sm leading-6 text-secondary">
                      {i18nService.t('enterpriseLeadKnowledgeDocumentEmpty')}
                    </p>
                  </div>
                </div>
              )
            ) : filteredKnowledgeRows.length > 0 ? (
              <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
                <colgroup>
                  <col className={enterpriseLeadKnowledgeTableColumnClassNames.knowledge} />
                  <col className={enterpriseLeadKnowledgeTableColumnClassNames.meta} />
                  <col className={enterpriseLeadKnowledgeTableColumnClassNames.actions} />
                </colgroup>
                <thead>
                  <tr className="bg-background text-xs font-semibold text-secondary">
                    <th className={enterpriseLeadKnowledgeHeaderCellClassName}>
                      {i18nService.t('enterpriseLeadKnowledgeTableKnowledge')}
                    </th>
                    <th className={enterpriseLeadKnowledgeHeaderCellClassName}>
                      {i18nService.t('enterpriseLeadKnowledgeTableMeta')}
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
                    const confirmed = editable &&
                      isEnterpriseLeadKnowledgeItemConfirmed(currentWorkspace.profile, item);
                    const isSelected = selectedItemId === item.id;
                    const sourceText = editable
                      ? i18nService.t('enterpriseLeadKnowledgeSourceWorkspaceProfile')
                      : getItemMeta(item) ||
                        i18nService.t('enterpriseLeadKnowledgeSourceGenerated');
                    const knowledgeMetaText = [
                      item.secondaryText && item.secondaryText !== item.text
                        ? item.secondaryText
                        : '',
                      `${i18nService.t('enterpriseLeadKnowledgeTableSource')}: ${sourceText}`,
                    ].filter(Boolean).join(' · ');
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
                    const cellClassName = `border-b border-border px-3 py-3 align-middle ${
                      isSelected ? 'bg-primary/5' : 'bg-background'
                    }`;
                    return (
                      <tr
                        key={item.id}
                        className="cursor-pointer transition-colors hover:bg-surface/70"
                        onClick={() => setSelectedItemId(item.id)}
                      >
                        <td className={`relative border-b border-border px-4 py-3 align-middle ${
                          isSelected ? 'bg-primary/5' : 'bg-background'
                        }`}
                        >
                          {isSelected ? (
                            <span className="absolute bottom-3 left-0 top-3 w-1 rounded-r-full bg-primary" />
                          ) : null}
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
                        </td>
                        <td className={cellClassName}>
                          <div className="flex min-w-0 flex-wrap gap-1.5">
                            <span className="inline-flex max-w-full items-center truncate whitespace-nowrap rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                              {i18nService.t(section.titleKey)}
                            </span>
                            <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${statusClassName}`}>
                              {i18nService.t(statusLabelKey)}
                            </span>
                            <span className="inline-flex whitespace-nowrap rounded-md bg-surface-raised px-2 py-1 text-xs font-medium text-secondary">
                              {confirmed
                                ? i18nService.t('enterpriseLeadKnowledgeUsageAgentReadable')
                                : editable
                                  ? i18nService.t('enterpriseLeadKnowledgeUsagePendingConfirm')
                                  : i18nService.t('enterpriseLeadKnowledgeUsageSourceReadable')}
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
                              disabled={!editable || confirmed || isSaving}
                              className={enterpriseLeadKnowledgeActionButtonClassNames.neutral}
                              aria-label={i18nService.t(
                                confirmed
                                  ? 'enterpriseLeadKnowledgeStatusConfirmed'
                                  : 'enterpriseLeadKnowledgeConfirmAction',
                              )}
                              title={i18nService.t(
                                confirmed
                                  ? 'enterpriseLeadKnowledgeStatusConfirmed'
                                  : 'enterpriseLeadKnowledgeConfirmAction',
                              )}
                              onClick={event => {
                                event.stopPropagation();
                                void confirmKnowledgeItem(item);
                              }}
                            >
                              <CheckCircleIcon className="h-4 w-4" />
                              <span>
                                {i18nService.t(
                                  confirmed
                                    ? 'enterpriseLeadKnowledgeStatusConfirmed'
                                    : 'enterpriseLeadKnowledgeConfirmCompactAction',
                                )}
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={!editable || isSaving}
                              className={enterpriseLeadKnowledgeActionButtonClassNames.danger}
                              aria-label={i18nService.t('enterpriseLeadKnowledgeArchiveAction')}
                              title={i18nService.t('enterpriseLeadKnowledgeArchiveAction')}
                              onClick={event => {
                                event.stopPropagation();
                                void archiveKnowledgeItem(item);
                              }}
                            >
                              <ArchiveBoxXMarkIcon className="h-4 w-4" />
                              <span>{i18nService.t('enterpriseLeadKnowledgeArchiveAction')}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
        </section>
      </div>

      {modalMode !== 'none' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 px-4 py-6">
          <section className={`flex max-h-[calc(100vh-48px)] w-full flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl ${
            isDocumentPreviewModal
              ? 'h-[calc(100vh-64px)] max-w-5xl'
              : modalMode === 'document'
                ? 'max-w-2xl'
              : modalMode === 'company'
                ? 'h-[720px] max-w-4xl'
                : 'max-w-3xl'
          }`}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {isDocumentPreviewModal
                    ? i18nService.t('enterpriseLeadKnowledgePreviewDocumentModalTitle')
                    : modalMode === 'document'
                    ? i18nService.t(
                      documentDraft.mode === 'edit'
                        ? 'enterpriseLeadKnowledgeEditDocumentModalTitle'
                        : 'enterpriseLeadKnowledgeAddDocumentModalTitle',
                    )
                    : modalMode === 'company'
                    ? i18nService.t('enterpriseLeadKnowledgeCompanyModalTitle')
                    : itemDraft.mode === 'edit'
                      ? i18nService.t('enterpriseLeadKnowledgeEditModalTitle')
                      : i18nService.t('enterpriseLeadKnowledgeAddModalTitle')}
                </h2>
                {!isDocumentPreviewModal ? (
                  <p className="mt-1 text-sm text-secondary">
                    {i18nService.t(
                      modalMode === 'document'
                        ? documentDraft.mode === 'edit'
                          ? 'enterpriseLeadKnowledgeEditDocumentModalSubtitle'
                          : 'enterpriseLeadKnowledgeAddDocumentModalSubtitle'
                        : 'enterpriseLeadKnowledgeModalSubtitle',
                    )}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="rounded-md p-1.5 text-secondary hover:bg-surface-raised hover:text-foreground"
                onClick={closeModal}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className={
              isDocumentPreviewModal || modalMode === 'company'
                ? 'min-h-0 flex-1 overflow-hidden'
                : 'min-h-0 flex-1 overflow-y-auto px-5 py-4'
            }
            >
              {isDocumentPreviewModal ? (
                <div className="flex h-full min-h-0 flex-col bg-background">
                  <div className="shrink-0 border-b border-border px-5 py-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                        <DocumentTextIcon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold text-foreground">
                          {documentDraft.name || documentFileName}
                        </h3>
                        <p className="mt-1 truncate text-xs text-secondary">
                          {[
                            getSourceKindLabel(documentDraft.sourceType),
                            documentFileName || documentDraft.category,
                            formatFileSize(documentDraft.fileSize),
                            formatKnowledgeDate(
                              previewDocumentSource?.updatedAt ?? previewDocumentSource?.createdAt,
                            ),
                            i18nService.t('enterpriseLeadKnowledgeDocumentPreviewStats')
                              .replace('{count}', String(documentPreviewCharCount)),
                          ].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-hidden">
                    {documentPreviewText ? (
                      <div className="h-full overflow-auto px-6 py-5">
                        <div className="mx-auto max-w-4xl whitespace-pre-wrap font-sans text-sm leading-7 text-foreground">
                          {documentPreviewText}
                        </div>
                      </div>
                    ) : (
                      <div className="grid h-full min-h-[260px] place-items-center text-center">
                        <div>
                          <DocumentTextIcon className="mx-auto h-10 w-10 text-tertiary" />
                          <p className="mt-3 text-sm text-secondary">
                            {i18nService.t('enterpriseLeadKnowledgeDocumentPreviewEmpty')}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : modalMode === 'document' ? (
                documentDraft.mode === 'edit' ? (
                  <div className="grid gap-4">
                    <div className="rounded-lg border border-border bg-surface px-4 py-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                          <DocumentTextIcon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {documentFileName || documentDraft.category || documentDraft.name}
                            </p>
                            <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                              {documentExtension.toUpperCase() ||
                                getSourceKindLabel(documentDraft.sourceType)}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-xs leading-5 text-secondary">
                            {[
                              getSourceKindLabel(documentDraft.sourceType),
                              formatFileSize(documentDraft.fileSize),
                              formatKnowledgeDate(
                                previewDocumentSource?.updatedAt ?? previewDocumentSource?.createdAt,
                              ),
                            ].filter(Boolean).join(' · ')}
                          </p>
                          {documentDraft.category ? (
                            <p className="mt-2 truncate text-xs text-tertiary">
                              {documentDraft.category}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <label className="grid gap-1.5">
                      <span className="text-xs font-semibold text-secondary">
                        {i18nService.t('enterpriseLeadKnowledgeDocumentNameField')}
                      </span>
                      <input
                        type="text"
                        value={documentDraft.name}
                        onChange={event => setDocumentDraft({
                          ...documentDraft,
                          name: event.target.value,
                        })}
                        className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                      />
                    </label>

                    <label className="grid gap-1.5">
                      <span className="text-xs font-semibold text-secondary">
                        {i18nService.t('enterpriseLeadKnowledgeDocumentSummaryField')}
                      </span>
                      <textarea
                        value={documentDraft.summary}
                        onChange={event => setDocumentDraft({
                          ...documentDraft,
                          summary: event.target.value,
                        })}
                        className="min-h-[140px] resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm leading-6 text-foreground outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                        placeholder={i18nService.t(
                          'enterpriseLeadKnowledgeDocumentSummaryPlaceholder',
                        )}
                      />
                    </label>

                    <div className="rounded-lg border border-border bg-surface px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <DocumentTextIcon className="h-4 w-4 shrink-0 text-secondary" />
                          <span className="text-sm font-semibold text-foreground">
                            {i18nService.t('enterpriseLeadKnowledgeDocumentContentStatusTitle')}
                          </span>
                        </div>
                        {documentPreviewText ? (
                          <div className="flex items-center gap-2 text-xs text-secondary">
                            <span className="rounded-md bg-emerald-500/10 px-2 py-1 font-semibold text-emerald-700 dark:text-emerald-300">
                              {i18nService.t('enterpriseLeadKnowledgeDocumentPreviewExtractedBadge')}
                            </span>
                            <span>
                              {i18nService.t('enterpriseLeadKnowledgeDocumentPreviewStats')
                                .replace('{count}', String(documentPreviewCharCount))}
                            </span>
                          </div>
                        ) : (
                          <span className="rounded-md bg-surface-raised px-2 py-1 text-xs font-medium text-tertiary">
                            {i18nService.t('enterpriseLeadKnowledgeDocumentContentStatusEmpty')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    <div>
                      <button
                        type="button"
                        className="grid min-h-[116px] w-full place-items-center rounded-lg border border-dashed border-border bg-surface px-5 py-5 text-center transition-colors hover:border-primary/50 hover:bg-primary/5"
                        onClick={() => {
                          void selectDocumentFile();
                        }}
                      >
                        <span>
                          <ArrowUpTrayIcon className="mx-auto h-10 w-10 text-primary" />
                          <span className="mt-3 block text-sm font-semibold text-foreground">
                            {documentDraft.fileName || documentDraft.category
                              ? i18nService.t('enterpriseLeadKnowledgeChangeDocumentFile')
                              : i18nService.t('enterpriseLeadKnowledgeSelectDocumentFile')}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-secondary">
                            {i18nService.t('enterpriseLeadKnowledgeUploadSubtitle')}
                          </span>
                        </span>
                      </button>

                      {documentDraft.category ? (
                        <div className="mt-3 rounded-lg border border-border bg-surface p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {documentFileName}
                              </p>
                              <p className="mt-1 text-xs leading-5 text-secondary">
                                {[
                                  getSourceKindLabel(documentDraft.sourceType),
                                  formatFileSize(documentDraft.fileSize),
                                  formatKnowledgeDate(new Date().toISOString()),
                                ].filter(Boolean).join(' · ')}
                              </p>
                            </div>
                            <span className="shrink-0 rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                              {documentExtension.toUpperCase() ||
                                i18nService.t('enterpriseLeadKnowledgeDocumentTypeFile')}
                            </span>
                          </div>
                          <div className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-xs leading-5 text-secondary">
                            <DocumentTextIcon className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{i18nService.t('enterpriseLeadKnowledgeDocumentSourceManaged')}</span>
                          </div>
                        </div>
                      ) : null}
                    </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1.5">
                      <span className="text-xs font-semibold text-secondary">
                        {i18nService.t('enterpriseLeadKnowledgeDocumentNameField')}
                      </span>
                      <input
                        type="text"
                        value={documentDraft.name}
                        onChange={event => setDocumentDraft({
                          ...documentDraft,
                          name: event.target.value,
                        })}
                        className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                      />
                    </label>

                    <div className="grid gap-1.5">
                      <span className="text-xs font-semibold text-secondary">
                        {i18nService.t('enterpriseLeadKnowledgeDocumentSourceTypeField')}
                      </span>
                      <select
                        value={documentDraft.sourceType}
                        onChange={event => setDocumentDraft({
                          ...documentDraft,
                          sourceType: event.target.value,
                        })}
                        className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                      >
                        {documentSourceTypeOptions.map(option => {
                          return (
                            <option
                              key={option}
                              value={option}
                            >
                              {getSourceKindLabel(option)}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </div>

                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold text-secondary">
                      {i18nService.t('enterpriseLeadKnowledgeDocumentSummaryField')}
                    </span>
                    <textarea
                      value={documentDraft.summary}
                      onChange={event => setDocumentDraft({
                        ...documentDraft,
                        summary: event.target.value,
                      })}
                      className="min-h-[96px] resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm leading-6 text-foreground outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                      placeholder={i18nService.t(
                        'enterpriseLeadKnowledgeDocumentSummaryPlaceholder',
                      )}
                    />
                  </label>

                  <div className="rounded-lg border border-border bg-surface px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <DocumentTextIcon className="h-4 w-4 shrink-0 text-secondary" />
                        <span className="text-sm font-semibold text-foreground">
                          {i18nService.t('enterpriseLeadKnowledgeDocumentContentStatusTitle')}
                        </span>
                      </div>
                      {documentPreviewText ? (
                        <div className="flex items-center gap-2 text-xs text-secondary">
                          <span className="rounded-md bg-emerald-500/10 px-2 py-1 font-semibold text-emerald-700 dark:text-emerald-300">
                            {i18nService.t('enterpriseLeadKnowledgeDocumentPreviewExtractedBadge')}
                          </span>
                          <span>
                            {i18nService.t('enterpriseLeadKnowledgeDocumentPreviewStats')
                              .replace('{count}', String(documentPreviewCharCount))}
                          </span>
                        </div>
                      ) : (
                        <span className="rounded-md bg-surface-raised px-2 py-1 text-xs font-medium text-tertiary">
                          {i18nService.t('enterpriseLeadKnowledgeDocumentContentStatusEmpty')}
                        </span>
                      )}
                    </div>
                  </div>

                  <label className="flex items-start gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
                    <input
                      type="checkbox"
                      checked={documentDraft.extractImmediately}
                      onChange={event => setDocumentDraft({
                        ...documentDraft,
                        extractImmediately: event.target.checked,
                      })}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-border text-primary"
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-foreground">
                        {i18nService.t('enterpriseLeadKnowledgeExtractAfterAdd')}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-secondary">
                        {i18nService.t('enterpriseLeadKnowledgeExtractAfterAddDesc')}
                      </span>
                      </span>
                    </label>
                  </div>
                )
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
                                  <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${
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
                          {i18nService.t(
                            activeCompanyValueCount > 0
                              ? 'enterpriseLeadKnowledgeCompanyFieldStats'
                              : 'enterpriseLeadKnowledgeCompanyFieldEmpty',
                          ).replace('{count}', String(activeCompanyValueCount))}
                        </span>
                      </div>
                    </div>
                    <label className="flex min-h-0 flex-1 flex-col p-5">
                      <textarea
                        value={activeCompanyValue}
                        onChange={event => setCompanyDraft({
                          ...companyDraft,
                          [activeCompanyField]: event.target.value,
                        })}
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
                      onChange={event => setItemDraft({
                        ...itemDraft,
                        kind: event.target.value as EditableKnowledgeKind,
                      })}
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
                      onChange={event => setItemDraft({
                        ...itemDraft,
                        text: event.target.value,
                      })}
                      className="min-h-[180px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none"
                      placeholder={i18nService.t('enterpriseLeadKnowledgeContentPlaceholder')}
                    />
                  </label>
                </div>
              )}
            </div>

            {!isDocumentPreviewModal ? (
              <div className={`flex items-center gap-3 border-t border-border px-5 py-4 ${
                modalMode === 'document' && documentDraft.mode === 'edit'
                  ? 'justify-end'
                  : 'justify-between'
              }`}
              >
                {modalMode === 'document' && documentDraft.mode === 'edit' ? null : (
                  <p className="text-xs text-secondary">
                    {i18nService.t(
                      modalMode === 'document'
                        ? 'enterpriseLeadKnowledgeDocumentModalHint'
                        : 'enterpriseLeadKnowledgeModalHint',
                    )}
                  </p>
                )}
                <button
                  type="button"
                  disabled={
                    isSaving ||
                    (modalMode === 'document' &&
                      (!documentDraft.name.trim() || !documentDraft.category.trim()))
                  }
                  className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={
                    modalMode === 'document'
                      ? handleSaveDocumentDraft
                      : modalMode === 'company'
                        ? handleSaveCompanyDraft
                        : handleSaveItemDraft
                  }
                >
                  {isSaving ? i18nService.t('saving') : i18nService.t(
                    modalMode === 'document'
                      ? documentDraft.mode === 'edit'
                        ? 'enterpriseLeadKnowledgeUpdateDocument'
                        : documentDraft.extractImmediately
                          ? 'enterpriseLeadKnowledgeAddAndExtract'
                          : 'enterpriseLeadKnowledgeSaveDocument'
                      : 'enterpriseLeadKnowledgeSaveAction',
                  )}
                </button>
              </div>
            ) : null}
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
