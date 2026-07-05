import {
  ArchiveBoxIcon,
  ArchiveBoxXMarkIcon,
  ArrowPathIcon,
  BookOpenIcon,
  BuildingOffice2Icon,
  CheckCircleIcon,
  ClipboardDocumentListIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UsersIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import type {
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

interface WorkspaceKnowledgeBaseProps {
  workspace: EnterpriseLeadWorkspace;
  onWorkspaceUpdated?: (workspace: EnterpriseLeadWorkspace) => void;
}

const sectionIconClassName = 'h-4 w-4 text-secondary';
const actionIconClassName = 'h-4 w-4';

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

const sectionIcons: Record<EnterpriseLeadKnowledgeSection, React.ReactNode> = {
  [EnterpriseLeadKnowledgeSection.Company]: <BuildingOffice2Icon className={sectionIconClassName} />,
  [EnterpriseLeadKnowledgeSection.Products]: <SparklesIcon className={sectionIconClassName} />,
  [EnterpriseLeadKnowledgeSection.Customers]: <UsersIcon className={sectionIconClassName} />,
  [EnterpriseLeadKnowledgeSection.Selling]: <BookOpenIcon className={sectionIconClassName} />,
  [EnterpriseLeadKnowledgeSection.Rules]: <ShieldCheckIcon className={sectionIconClassName} />,
  [EnterpriseLeadKnowledgeSection.Sources]: <DocumentTextIcon className={sectionIconClassName} />,
  [EnterpriseLeadKnowledgeSection.Deliverables]: (
    <ClipboardDocumentListIcon className={sectionIconClassName} />
  ),
  [EnterpriseLeadKnowledgeSection.Archives]: <ArchiveBoxIcon className={sectionIconClassName} />,
};

const sectionDefaultKinds: Partial<Record<EnterpriseLeadKnowledgeSection, EditableKnowledgeKind>> = {
  [EnterpriseLeadKnowledgeSection.Company]: EnterpriseLeadKnowledgeItemKind.CompanySummary,
  [EnterpriseLeadKnowledgeSection.Products]: EnterpriseLeadKnowledgeItemKind.Product,
  [EnterpriseLeadKnowledgeSection.Customers]: EnterpriseLeadKnowledgeItemKind.Customer,
  [EnterpriseLeadKnowledgeSection.Selling]: EnterpriseLeadKnowledgeItemKind.SellingPoint,
  [EnterpriseLeadKnowledgeSection.Rules]: EnterpriseLeadKnowledgeItemKind.ContactRule,
};

const kindSections: Record<EditableKnowledgeKind, EnterpriseLeadKnowledgeSection> = {
  [EnterpriseLeadKnowledgeItemKind.CompanySummary]: EnterpriseLeadKnowledgeSection.Company,
  [EnterpriseLeadKnowledgeItemKind.Product]: EnterpriseLeadKnowledgeSection.Products,
  [EnterpriseLeadKnowledgeItemKind.Capability]: EnterpriseLeadKnowledgeSection.Products,
  [EnterpriseLeadKnowledgeItemKind.Customer]: EnterpriseLeadKnowledgeSection.Customers,
  [EnterpriseLeadKnowledgeItemKind.Scenario]: EnterpriseLeadKnowledgeSection.Customers,
  [EnterpriseLeadKnowledgeItemKind.SellingPoint]: EnterpriseLeadKnowledgeSection.Selling,
  [EnterpriseLeadKnowledgeItemKind.Channel]: EnterpriseLeadKnowledgeSection.Selling,
  [EnterpriseLeadKnowledgeItemKind.ProhibitedClaim]: EnterpriseLeadKnowledgeSection.Rules,
  [EnterpriseLeadKnowledgeItemKind.ContactRule]: EnterpriseLeadKnowledgeSection.Rules,
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

type KnowledgeStatusFilter = 'all' | 'editable' | 'readonly';
type ModalMode = 'none' | 'company' | 'item';
type ItemModalMode = 'add' | 'edit';

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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeSectionId, setActiveSectionId] = useState<EnterpriseLeadKnowledgeSection>(
    EnterpriseLeadKnowledgeSection.Company,
  );
  const [selectedItemId, setSelectedItemId] = useState('company-summary');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<KnowledgeStatusFilter>('all');
  const [modalMode, setModalMode] = useState<ModalMode>('none');
  const [companyDraft, setCompanyDraft] = useState<CompanyDraft>(
    () => buildCompanyDraft(workspace.profile),
  );
  const [itemDraft, setItemDraft] = useState<ItemDraft>(
    () => createItemDraft(EnterpriseLeadKnowledgeSection.Company),
  );
  const requestRef = useRef(0);
  const pendingSelectionRef = useRef<{
    field: keyof EnterpriseLeadWorkspaceProfile;
    index: number;
  } | null>(null);

  useEffect(() => {
    setCurrentWorkspace(workspace);
    setCompanyDraft(buildCompanyDraft(workspace.profile));
  }, [workspace]);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setSnapshot(null);
    setError('');
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
          setError(i18nService.t('enterpriseLeadKnowledgeLoadFailed'));
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

  const activeSection = sections.find(section => section.id === activeSectionId) ?? sections[0];
  const allItems = activeSection?.items ?? [];
  const editableCount = sections.reduce(
    (count, section) => count + section.items.filter(item => isEditableItem(item)).length,
    0,
  );
  const readOnlyCount = sections.reduce(
    (count, section) => count + section.items.filter(item => !isEditableItem(item)).length,
    0,
  );
  const missingCount = currentWorkspace.profile.missingInfo.length;
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredItems = allItems.filter(item => {
    const searchableText = [item.text, item.secondaryText, item.metaText]
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
  const selectedItem =
    filteredItems.find(item => item.id === selectedItemId) ??
    filteredItems[0] ??
    allItems[0] ??
    null;
  const selectedEditableField = selectedItem ? getEditableItemField(selectedItem) : null;

  const saveProfile = async (
    nextProfile: EnterpriseLeadWorkspaceProfile,
    successMessageKey: string,
  ): Promise<void> => {
    setIsSaving(true);
    setError('');
    setNotice('');
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
      setNotice(i18nService.t(successMessageKey));
    } catch {
      setError(i18nService.t('enterpriseLeadKnowledgeSaveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const openCompanyModal = (): void => {
    setCompanyDraft(buildCompanyDraft(currentWorkspace.profile));
    setModalMode('company');
  };

  const openAddModal = (): void => {
    setItemDraft(createItemDraft(activeSection.id));
    setModalMode('item');
  };

  const openEditModal = (): void => {
    if (!selectedItem || !isEditableItem(selectedItem)) {
      return;
    }
    setItemDraft(createItemDraft(activeSection.id, selectedItem));
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
      setError(i18nService.t('enterpriseLeadKnowledgeEmptyContentError'));
      return;
    }

    const nextProfile = cloneProfile(currentWorkspace.profile);
    const targetField = getKindField(itemDraft.kind);
    let targetSelectionIndex = targetField.field === 'companySummary' ? -1 : 0;

    if (itemDraft.mode === 'edit') {
      const currentItem = sections
        .flatMap(section => section.items)
        .find(item => item.id === itemDraft.editingItemId);
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

    setActiveSectionId(kindSections[itemDraft.kind]);
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

  const handleArchiveSelected = async (): Promise<void> => {
    if (!selectedItem || !selectedEditableField) {
      return;
    }
    const nextProfile = cloneProfile(currentWorkspace.profile);
    if (selectedEditableField.field === 'companySummary') {
      nextProfile.companySummary = '';
    } else if (isEditableArrayField(selectedEditableField.field)) {
      const index = getArrayIndexFromItemId(selectedItem);
      if (index >= 0) {
        nextProfile[selectedEditableField.field].splice(index, 1);
      }
    }
    setSelectedItemId('');
    await saveProfile(nextProfile, 'enterpriseLeadKnowledgeItemArchived');
  };

  const handleConfirmSelected = async (): Promise<void> => {
    if (!selectedItem || !selectedEditableField) {
      return;
    }
    await saveProfile(currentWorkspace.profile, 'enterpriseLeadKnowledgeItemConfirmed');
  };

  const handleSectionChange = (sectionId: EnterpriseLeadKnowledgeSection): void => {
    setActiveSectionId(sectionId);
    setSearchQuery('');
    setStatusFilter('all');
    const section = sections.find(item => item.id === sectionId);
    setSelectedItemId(section?.items[0]?.id ?? '');
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="shrink-0 border-b border-border bg-background px-6 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-primary">
              {i18nService.t('enterpriseLeadWorkbenchNavKnowledgeBase')}
            </p>
            <h1 className="mt-1 truncate text-xl font-semibold text-foreground">
              {currentWorkspace.name}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary">
              {i18nService.t('enterpriseLeadKnowledgeMaintenanceSubtitle')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-secondary shadow-sm transition-colors hover:bg-surface-raised hover:text-foreground"
              onClick={() => setNotice(i18nService.t('enterpriseLeadKnowledgeSourcesSynced'))}
            >
              <ArrowPathIcon className={actionIconClassName} />
              {i18nService.t('enterpriseLeadKnowledgeSyncSources')}
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
              onClick={openAddModal}
            >
              <PlusIcon className={actionIconClassName} />
              {i18nService.t('enterpriseLeadKnowledgeAddContent')}
            </button>
          </div>
        </div>
        {error ? (
          <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            {notice}
          </p>
        ) : null}
      </div>

      <div className="grid shrink-0 grid-cols-2 border-b border-border bg-surface/50 md:grid-cols-4">
        <div className="border-r border-border px-6 py-4">
          <p className="text-2xl font-semibold text-foreground">{editableCount}</p>
          <p className="mt-1 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadKnowledgeEditableMetric')}
          </p>
        </div>
        <div className="border-r border-border px-6 py-4">
          <p className="text-2xl font-semibold text-foreground">{sections.length}</p>
          <p className="mt-1 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadKnowledgeCategoryMetric')}
          </p>
        </div>
        <div className="border-r border-border px-6 py-4">
          <p className="text-2xl font-semibold text-amber-600">{missingCount}</p>
          <p className="mt-1 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadKnowledgeMissingMetric')}
          </p>
        </div>
        <div className="px-6 py-4">
          <p className="text-2xl font-semibold text-foreground">{readOnlyCount}</p>
          <p className="mt-1 text-xs font-medium text-secondary">
            {i18nService.t('enterpriseLeadKnowledgeReadonlyMetric')}
          </p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[220px_minmax(360px,1fr)_360px] xl:overflow-hidden">
        <aside className="border-b border-border bg-surface/40 xl:min-h-0 xl:border-b-0 xl:border-r">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              {i18nService.t('enterpriseLeadKnowledgeCategories')}
            </h2>
            <p className="mt-1 text-xs text-secondary">
              {i18nService.t('enterpriseLeadKnowledgeWorkspaceOnly')}
            </p>
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto p-3 xl:max-h-none">
            {sections.map(section => (
              <button
                key={section.id}
                type="button"
                className={`grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  section.id === activeSection.id
                    ? 'bg-surface-raised text-foreground shadow-sm'
                    : 'text-secondary hover:bg-surface-raised hover:text-foreground'
                }`}
                onClick={() => handleSectionChange(section.id)}
              >
                {sectionIcons[section.id]}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {i18nService.t(section.titleKey)}
                  </span>
                  <span className="block truncate text-xs text-tertiary">
                    {i18nService.t(section.emptyKey)}
                  </span>
                </span>
                <span className="rounded-md bg-background px-2 py-0.5 text-xs text-secondary">
                  {section.items.length}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-h-[520px] border-b border-border bg-background xl:min-h-0 xl:border-b-0 xl:border-r">
          <div className="grid grid-cols-[minmax(0,1fr)_138px] gap-2 border-b border-border px-4 py-3">
            <label className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-secondary">
              <MagnifyingGlassIcon className="h-4 w-4 shrink-0" />
              <input
                type="search"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder={i18nService.t('enterpriseLeadKnowledgeSearchPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-tertiary"
              />
            </label>
            <select
              value={statusFilter}
              onChange={event => setStatusFilter(event.target.value as KnowledgeStatusFilter)}
              className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-secondary outline-none"
            >
              <option value="all">{i18nService.t('enterpriseLeadKnowledgeFilterAll')}</option>
              <option value="editable">{i18nService.t('enterpriseLeadKnowledgeFilterEditable')}</option>
              <option value="readonly">{i18nService.t('enterpriseLeadKnowledgeFilterReadonly')}</option>
            </select>
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-xs text-secondary">
            <span>{i18nService.t(activeSection.emptyKey)}</span>
            <span>{filteredItems.length} {i18nService.t('enterpriseLeadKnowledgeItemUnit')}</span>
          </div>
          <div className="min-h-0 space-y-2 overflow-y-auto p-4">
            {filteredItems.length > 0 ? filteredItems.map(item => {
              const editable = isEditableItem(item);
              const active = selectedItem?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-background hover:border-primary/50 hover:bg-surface'
                  }`}
                  onClick={() => setSelectedItemId(item.id)}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {item.text}
                    </span>
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                      editable
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'bg-surface-raised text-secondary'
                    }`}
                    >
                      {editable
                        ? i18nService.t('enterpriseLeadKnowledgeStatusEditable')
                        : i18nService.t('enterpriseLeadKnowledgeStatusReadonly')}
                    </span>
                  </div>
                  {item.secondaryText && item.secondaryText !== item.text ? (
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-secondary">
                      {item.secondaryText}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      {i18nService.t(itemKindLabelKeys[item.kind])}
                    </span>
                    {getItemMeta(item) ? (
                      <span className="text-xs text-tertiary">{getItemMeta(item)}</span>
                    ) : null}
                  </div>
                </button>
              );
            }) : (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm leading-6 text-secondary">
                {i18nService.t('enterpriseLeadKnowledgeNoMatches')}
              </div>
            )}
          </div>
        </section>

        <aside className="min-h-[520px] bg-background xl:min-h-0">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              {i18nService.t('enterpriseLeadKnowledgeDetailTitle')}
            </h2>
            <span className="rounded-md bg-surface-raised px-2 py-0.5 text-xs text-secondary">
              {selectedItem && isEditableItem(selectedItem)
                ? i18nService.t('enterpriseLeadKnowledgeStatusEditable')
                : i18nService.t('enterpriseLeadKnowledgeStatusReadonly')}
            </span>
          </div>
          <div className="min-h-0 overflow-y-auto px-4 py-4">
            {selectedItem ? (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-medium text-primary">
                    {i18nService.t(itemKindLabelKeys[selectedItem.kind])}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold leading-7 text-foreground">
                    {selectedItem.text}
                  </h3>
                  {selectedItem.secondaryText && selectedItem.secondaryText !== selectedItem.text ? (
                    <p className="mt-2 text-sm leading-6 text-secondary">
                      {selectedItem.secondaryText}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2 rounded-lg border border-border bg-surface px-3 py-3 text-sm">
                  <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
                    <span className="text-tertiary">{i18nService.t('enterpriseLeadKnowledgeDetailScope')}</span>
                    <span className="text-secondary">{i18nService.t('enterpriseLeadKnowledgeWorkspaceOnly')}</span>
                  </div>
                  <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
                    <span className="text-tertiary">{i18nService.t('enterpriseLeadKnowledgeDetailSource')}</span>
                    <span className="text-secondary">
                      {selectedEditableField
                        ? i18nService.t('enterpriseLeadKnowledgeSourceWorkspaceProfile')
                        : i18nService.t('enterpriseLeadKnowledgeSourceGenerated')}
                    </span>
                  </div>
                  <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
                    <span className="text-tertiary">{i18nService.t('enterpriseLeadKnowledgeDetailUsage')}</span>
                    <span className="text-secondary">
                      {selectedEditableField
                        ? i18nService.t('enterpriseLeadKnowledgeUsageEditable')
                        : i18nService.t('enterpriseLeadKnowledgeUsageReadonly')}
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-background px-3 py-3">
                  <h4 className="text-sm font-semibold text-foreground">
                    {i18nService.t('enterpriseLeadKnowledgeSuggestedAction')}
                  </h4>
                  <p className="mt-2 text-sm leading-6 text-secondary">
                    {selectedEditableField
                      ? i18nService.t('enterpriseLeadKnowledgeSuggestedEditable')
                      : i18nService.t('enterpriseLeadKnowledgeSuggestedReadonly')}
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm leading-6 text-secondary">
                {i18nService.t('enterpriseLeadKnowledgeNoSelection')}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!selectedItem || !selectedEditableField || isSaving}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-secondary transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-45"
                onClick={openEditModal}
              >
                <PencilSquareIcon className="h-4 w-4" />
                {i18nService.t('edit')}
              </button>
              <button
                type="button"
                disabled={!selectedItem || !selectedEditableField || isSaving}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-500/20 bg-red-500/10 px-2.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-45 dark:text-red-300"
                onClick={handleArchiveSelected}
              >
                <ArchiveBoxXMarkIcon className="h-4 w-4" />
                {i18nService.t('enterpriseLeadKnowledgeArchiveAction')}
              </button>
            </div>
            <button
              type="button"
              disabled={!selectedItem || !selectedEditableField || isSaving}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={handleConfirmSelected}
            >
              <CheckCircleIcon className="h-4 w-4" />
              {i18nService.t('enterpriseLeadKnowledgeConfirmAction')}
            </button>
          </div>
        </aside>
      </div>

      {modalMode !== 'none' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 px-4 py-6">
          <section className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {modalMode === 'company'
                    ? i18nService.t('enterpriseLeadKnowledgeCompanyModalTitle')
                    : itemDraft.mode === 'edit'
                      ? i18nService.t('enterpriseLeadKnowledgeEditModalTitle')
                      : i18nService.t('enterpriseLeadKnowledgeAddModalTitle')}
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

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {modalMode === 'company' ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold text-secondary">
                      {i18nService.t('enterpriseLeadKnowledgeCompanySummaryField')}
                    </span>
                    <textarea
                      value={companyDraft.companySummary}
                      onChange={event => setCompanyDraft({
                        ...companyDraft,
                        companySummary: event.target.value,
                      })}
                      className="min-h-[110px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold text-secondary">
                      {i18nService.t('enterpriseLeadKnowledgeProductListField')}
                    </span>
                    <textarea
                      value={companyDraft.productList}
                      onChange={event => setCompanyDraft({
                        ...companyDraft,
                        productList: event.target.value,
                      })}
                      className="min-h-[110px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold text-secondary">
                      {i18nService.t('enterpriseLeadKnowledgeProductCapabilitiesField')}
                    </span>
                    <textarea
                      value={companyDraft.productCapabilities}
                      onChange={event => setCompanyDraft({
                        ...companyDraft,
                        productCapabilities: event.target.value,
                      })}
                      className="min-h-[110px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold text-secondary">
                      {i18nService.t('enterpriseLeadKnowledgeTargetCustomersField')}
                    </span>
                    <textarea
                      value={companyDraft.targetCustomers}
                      onChange={event => setCompanyDraft({
                        ...companyDraft,
                        targetCustomers: event.target.value,
                      })}
                      className="min-h-[110px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold text-secondary">
                      {i18nService.t('enterpriseLeadKnowledgeApplicationScenariosField')}
                    </span>
                    <textarea
                      value={companyDraft.applicationScenarios}
                      onChange={event => setCompanyDraft({
                        ...companyDraft,
                        applicationScenarios: event.target.value,
                      })}
                      className="min-h-[110px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold text-secondary">
                      {i18nService.t('enterpriseLeadKnowledgeSellingPointsField')}
                    </span>
                    <textarea
                      value={companyDraft.sellingPoints}
                      onChange={event => setCompanyDraft({
                        ...companyDraft,
                        sellingPoints: event.target.value,
                      })}
                      className="min-h-[110px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold text-secondary">
                      {i18nService.t('enterpriseLeadKnowledgeChannelPreferencesField')}
                    </span>
                    <textarea
                      value={companyDraft.channelPreferences}
                      onChange={event => setCompanyDraft({
                        ...companyDraft,
                        channelPreferences: event.target.value,
                      })}
                      className="min-h-[110px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold text-secondary">
                      {i18nService.t('enterpriseLeadKnowledgeProhibitedClaimsField')}
                    </span>
                    <textarea
                      value={companyDraft.prohibitedClaims}
                      onChange={event => setCompanyDraft({
                        ...companyDraft,
                        prohibitedClaims: event.target.value,
                      })}
                      className="min-h-[110px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold text-secondary">
                      {i18nService.t('enterpriseLeadKnowledgeContactRulesField')}
                    </span>
                    <textarea
                      value={companyDraft.contactRules}
                      onChange={event => setCompanyDraft({
                        ...companyDraft,
                        contactRules: event.target.value,
                      })}
                      className="min-h-[110px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold text-secondary">
                      {i18nService.t('enterpriseLeadKnowledgeMissingInfoField')}
                    </span>
                    <textarea
                      value={companyDraft.missingInfo}
                      onChange={event => setCompanyDraft({
                        ...companyDraft,
                        missingInfo: event.target.value,
                      })}
                      className="min-h-[110px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none"
                    />
                  </label>
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

            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
              <p className="text-xs text-secondary">
                {i18nService.t('enterpriseLeadKnowledgeModalHint')}
              </p>
              <button
                type="button"
                disabled={isSaving}
                className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={modalMode === 'company' ? handleSaveCompanyDraft : handleSaveItemDraft}
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
