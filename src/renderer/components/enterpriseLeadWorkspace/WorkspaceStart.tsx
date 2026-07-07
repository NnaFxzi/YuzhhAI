import {
  ArrowRightIcon,
  CheckIcon,
  DocumentTextIcon,
  FolderPlusIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';
import React from 'react';

import type { EnterpriseLeadWorkspace } from '../../../shared/enterpriseLeadWorkspace/types';
import { i18nService } from '../../services/i18n';
import {
  EnterpriseLeadWorkspaceInternalPage,
  EnterpriseLeadWorkspaceStartAction,
  EnterpriseLeadWorkspaceStartReadinessStatus,
  EnterpriseLeadWorkspaceStartSourceState,
  getWorkspaceStartActionTarget,
  getWorkspaceStartReadiness,
  getWorkspaceStartSourceState,
} from './enterpriseLeadWorkspaceUi';

interface WorkspaceStartProps {
  workspace: EnterpriseLeadWorkspace;
  onOpenPage: (page: EnterpriseLeadWorkspaceInternalPage) => void;
}

interface StartActionCard {
  id: EnterpriseLeadWorkspaceStartAction;
  titleKey: string;
  descriptionKey: string;
  icon: React.ReactNode;
}

const statusClassNames = {
  [EnterpriseLeadWorkspaceStartReadinessStatus.Ready]:
    'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  [EnterpriseLeadWorkspaceStartReadinessStatus.Warning]:
    'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  [EnterpriseLeadWorkspaceStartReadinessStatus.Optional]:
    'bg-surface-raised text-secondary',
};

const sourceBadgeClassNames = {
  [EnterpriseLeadWorkspaceStartSourceState.Material]: 'bg-primary/10 text-primary ring-primary/20',
  [EnterpriseLeadWorkspaceStartSourceState.Paste]: 'bg-primary/10 text-primary ring-primary/20',
  [EnterpriseLeadWorkspaceStartSourceState.Blank]:
    'bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300',
};

const getSourceLabelKey = (sourceState: EnterpriseLeadWorkspaceStartSourceState): string => {
  if (sourceState === EnterpriseLeadWorkspaceStartSourceState.Material) {
    return 'enterpriseLeadStartSourceMaterial';
  }

  if (sourceState === EnterpriseLeadWorkspaceStartSourceState.Paste) {
    return 'enterpriseLeadStartSourcePaste';
  }

  return 'enterpriseLeadStartSourceBlank';
};

const getSubtitleKey = (sourceState: EnterpriseLeadWorkspaceStartSourceState): string => {
  if (sourceState === EnterpriseLeadWorkspaceStartSourceState.Material) {
    return 'enterpriseLeadStartSubtitleMaterial';
  }

  if (sourceState === EnterpriseLeadWorkspaceStartSourceState.Paste) {
    return 'enterpriseLeadStartSubtitlePaste';
  }

  return 'enterpriseLeadStartSubtitleBlank';
};

const getAddMaterialDescriptionKey = (
  sourceState: EnterpriseLeadWorkspaceStartSourceState,
): string => {
  if (sourceState === EnterpriseLeadWorkspaceStartSourceState.Material) {
    return 'enterpriseLeadStartActionAddMaterialDescMaterial';
  }

  if (sourceState === EnterpriseLeadWorkspaceStartSourceState.Paste) {
    return 'enterpriseLeadStartActionAddMaterialDescPaste';
  }

  return 'enterpriseLeadStartActionAddMaterialDescBlank';
};

const getStartWorkflowDescriptionKey = (
  sourceState: EnterpriseLeadWorkspaceStartSourceState,
): string => sourceState === EnterpriseLeadWorkspaceStartSourceState.Blank
  ? 'enterpriseLeadStartActionStartWorkflowDescBlank'
  : 'enterpriseLeadStartActionStartWorkflowDesc';

export const WorkspaceStart: React.FC<WorkspaceStartProps> = ({
  workspace,
  onOpenPage,
}) => {
  const sourceState = getWorkspaceStartSourceState(workspace);
  const readiness = getWorkspaceStartReadiness(workspace);
  const source = workspace.extractionSources[0];
  const isBlank = sourceState === EnterpriseLeadWorkspaceStartSourceState.Blank;
  const actionCards: StartActionCard[] = [
    {
      id: EnterpriseLeadWorkspaceStartAction.AddMaterial,
      titleKey: 'enterpriseLeadStartActionAddMaterialTitle',
      descriptionKey: getAddMaterialDescriptionKey(sourceState),
      icon: <FolderPlusIcon className="h-5 w-5" />,
    },
    {
      id: EnterpriseLeadWorkspaceStartAction.ReviewProfile,
      titleKey: 'enterpriseLeadStartActionReviewProfileTitle',
      descriptionKey: 'enterpriseLeadStartActionReviewProfileDesc',
      icon: <DocumentTextIcon className="h-5 w-5" />,
    },
    {
      id: EnterpriseLeadWorkspaceStartAction.StartWorkflow,
      titleKey: 'enterpriseLeadStartActionStartWorkflowTitle',
      descriptionKey: getStartWorkflowDescriptionKey(sourceState),
      icon: <PlayIcon className="h-5 w-5" />,
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-surface-raised px-6 py-5">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <section className="rounded-lg border border-border bg-background px-5 py-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-5 border-b border-border pb-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  {i18nService.t('enterpriseLeadStartCreatedBadge')}
                </span>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${sourceBadgeClassNames[sourceState]}`}>
                  {i18nService.t(getSourceLabelKey(sourceState))}
                </span>
              </div>
              <h1 className="mt-3 truncate text-3xl font-semibold leading-10 text-foreground">
                {workspace.name}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">
                {i18nService.t(getSubtitleKey(sourceState))}
              </p>
            </div>
          </div>

          <div className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.72fr)]">
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-foreground">
                  {i18nService.t('enterpriseLeadStartNextActionTitle')}
                </h2>
                <span className="text-xs font-medium text-secondary">
                  {i18nService.t('enterpriseLeadStartNextActionHint')}
                </span>
              </div>
              <div className="grid gap-3">
                {actionCards.map(card => {
                  const isPrimary = isBlank
                    ? card.id === EnterpriseLeadWorkspaceStartAction.AddMaterial
                    : card.id === EnterpriseLeadWorkspaceStartAction.ReviewProfile;
                  const targetPage = getWorkspaceStartActionTarget(card.id, sourceState);

                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => onOpenPage(targetPage)}
                      className={`grid min-h-[92px] grid-cols-[44px_minmax(0,1fr)_24px] items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                        isPrimary
                          ? 'border-primary bg-primary text-white hover:bg-primary/90'
                          : 'border-border bg-background text-foreground hover:border-primary/30 hover:bg-surface-raised'
                      }`}
                    >
                      <span
                        className={`flex h-11 w-11 items-center justify-center rounded-lg ${
                          isPrimary ? 'bg-white/15 text-white' : 'bg-primary/10 text-primary'
                        }`}
                      >
                        {card.icon}
                      </span>
                      <span className="min-w-0">
                        <strong className="block text-base font-semibold leading-6">
                          {i18nService.t(card.titleKey)}
                        </strong>
                        <span className={`mt-1 block text-sm leading-5 ${
                          isPrimary ? 'text-white/80' : 'text-secondary'
                        }`}
                        >
                          {i18nService.t(card.descriptionKey)}
                        </span>
                      </span>
                      <ArrowRightIcon className="h-4 w-4" />
                    </button>
                  );
                })}
              </div>
            </section>

            <aside className="grid gap-4">
              <section className="rounded-lg border border-border bg-background p-4">
                <h2 className="text-sm font-semibold text-foreground">
                  {i18nService.t('enterpriseLeadStartReadinessTitle')}
                </h2>
                <div className="mt-3 grid gap-3">
                  {readiness.map((item, index) => (
                    <div
                      key={item.id}
                      className="grid min-h-[32px] grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2"
                    >
                      <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                        item.status === EnterpriseLeadWorkspaceStartReadinessStatus.Ready
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'bg-surface-raised text-secondary'
                      }`}
                      >
                        {item.status === EnterpriseLeadWorkspaceStartReadinessStatus.Ready ? (
                          <CheckIcon className="h-4 w-4" />
                        ) : index + 1}
                      </span>
                      <span className="truncate text-sm font-medium text-foreground">
                        {i18nService.t(item.labelKey)}
                      </span>
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClassNames[item.status]}`}>
                        {i18nService.t(item.statusKey)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-border bg-background p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-foreground">
                    {i18nService.t('enterpriseLeadStartCurrentMaterialTitle')}
                  </h2>
                  <button
                    type="button"
                    onClick={() => onOpenPage(EnterpriseLeadWorkspaceInternalPage.KnowledgeBase)}
                    className="h-8 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
                  >
                    {i18nService.t('enterpriseLeadStartManageMaterial')}
                  </button>
                </div>
                <div className="mt-3 rounded-lg bg-surface-raised px-3 py-3">
                  <strong className="block truncate text-sm font-semibold text-foreground">
                    {source?.label || i18nService.t('enterpriseLeadStartNoMaterialTitle')}
                  </strong>
                  <p className="mt-1 line-clamp-3 text-xs leading-5 text-secondary">
                    {source?.text?.trim() ||
                      (isBlank
                        ? i18nService.t('enterpriseLeadStartNoMaterialDesc')
                        : i18nService.t('enterpriseLeadStartMaterialReadyDesc'))}
                  </p>
                </div>
              </section>
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
};

export default WorkspaceStart;
