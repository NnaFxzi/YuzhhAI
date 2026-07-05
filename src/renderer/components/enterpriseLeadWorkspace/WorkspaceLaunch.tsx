import {
  ArrowRightIcon,
  ArrowUpTrayIcon,
  ClockIcon,
  DocumentTextIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import React from 'react';

import type { EnterpriseLeadWorkspace } from '../../../shared/enterpriseLeadWorkspace/types';
import { i18nService } from '../../services/i18n';
import {
  EnterpriseLeadWorkspaceLaunchMode,
  getLaunchMode,
  getWorkspaceCompletionPercent,
  summarizeWorkspaceDraft,
} from './enterpriseLeadWorkspaceUi';

interface WorkspaceLaunchProps {
  workspaces: EnterpriseLeadWorkspace[];
  onCreate: () => void;
  onOpen: (workspaceId: string) => void;
}

const getRecentWorkspace = (
  workspaces: EnterpriseLeadWorkspace[],
): EnterpriseLeadWorkspace | null =>
  [...workspaces].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;

const getSummaryLabels = () => ({
  productsFallback: i18nService.t('enterpriseLeadProductsFallback'),
  customersFallback: i18nService.t('enterpriseLeadCustomersFallback'),
  targetCustomersPrefix: i18nService.t('enterpriseLeadTargetCustomersPrefix'),
});

const ActionIcon: React.FC<{
  children: React.ReactNode;
  tone: 'primary' | 'surface';
}> = ({ children, tone }) => (
  <span
    className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
      tone === 'primary'
        ? 'bg-white/15 text-white'
        : 'bg-primary/10 text-primary'
    }`}
  >
    {children}
  </span>
);

const WorkspaceSummary: React.FC<{ workspace: EnterpriseLeadWorkspace }> = ({ workspace }) => {
  const summary = summarizeWorkspaceDraft(workspace, getSummaryLabels());
  const completion = getWorkspaceCompletionPercent(workspace.profile);

  return (
    <div className="min-w-0">
      <h3 className="truncate text-base font-semibold text-foreground">
        {summary.name}
      </h3>
      <p className="mt-1 line-clamp-2 text-sm text-secondary">
        {summary.products}
      </p>
      <p className="mt-1 truncate text-xs text-secondary">
        {summary.targetCustomers}
      </p>
      {completion < 100 && (
        <p className="mt-2 text-xs font-medium text-primary">
          {i18nService.t('enterpriseLeadProfileIncomplete')}
        </p>
      )}
    </div>
  );
};

export const WorkspaceLaunch: React.FC<WorkspaceLaunchProps> = ({
  workspaces,
  onCreate,
  onOpen,
}) => {
  const launchMode = getLaunchMode(workspaces);
  const recentWorkspace = getRecentWorkspace(workspaces);
  const secondaryWorkspaces = workspaces
    .filter(workspace => workspace.id !== recentWorkspace?.id)
    .slice(0, 3);

  if (launchMode === EnterpriseLeadWorkspaceLaunchMode.FirstLaunch) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center bg-background px-6 py-10">
        <div className="w-full max-w-3xl">
          <div className="text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-primary text-white shadow-sm">
              <DocumentTextIcon className="h-7 w-7" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground">
              {i18nService.t('enterpriseLeadWorkspaceTitle')}
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-secondary">
              {i18nService.t('enterpriseLeadWorkspaceSubtitle')}
            </p>
          </div>

          <div className="mt-8 grid gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={onCreate}
              className="group flex min-h-[132px] items-start gap-4 rounded-lg bg-primary p-5 text-left text-white shadow-sm transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <ActionIcon tone="primary">
                <PlusIcon className="h-5 w-5" />
              </ActionIcon>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold">
                  {i18nService.t('enterpriseLeadCreateWorkspace')}
                </span>
                <span className="mt-2 block text-sm leading-6 text-white/80">
                  {i18nService.t('enterpriseLeadCreateWorkspaceDesc')}
                </span>
              </span>
              <ArrowRightIcon className="mt-1 h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5" />
            </button>

            <button
              type="button"
              onClick={onCreate}
              className="group flex min-h-[132px] items-start gap-4 rounded-lg border border-border bg-surface p-5 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <ActionIcon tone="surface">
                <ArrowUpTrayIcon className="h-5 w-5" />
              </ActionIcon>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold text-foreground">
                  {i18nService.t('enterpriseLeadImportMaterial')}
                </span>
                <span className="mt-2 block text-sm leading-6 text-secondary">
                  {i18nService.t('enterpriseLeadImportMaterialDesc')}
                </span>
              </span>
              <ArrowRightIcon className="mt-1 h-5 w-5 shrink-0 text-secondary transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 bg-background px-6 py-8">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground">
            {i18nService.t('enterpriseLeadWorkspaceTitle')}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">
            {i18nService.t('enterpriseLeadRecentWorkspacesDesc')}
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          {recentWorkspace && (
            <button
              type="button"
              onClick={() => onOpen(recentWorkspace.id)}
              className="group flex min-h-[220px] flex-col justify-between rounded-lg border border-border bg-surface p-5 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <span>
                <span className="mb-4 inline-flex items-center gap-2 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                  <ClockIcon className="h-4 w-4" />
                  {i18nService.t('enterpriseLeadRecentlyOpened')}
                </span>
                <WorkspaceSummary workspace={recentWorkspace} />
              </span>
              <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary">
                {i18nService.t('enterpriseLeadOpenWorkspace')}
                <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onCreate}
            className="group flex min-h-[220px] flex-col justify-between rounded-lg border border-border bg-surface p-5 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <span>
              <ActionIcon tone="surface">
                <PlusIcon className="h-5 w-5" />
              </ActionIcon>
              <span className="mt-4 block text-base font-semibold text-foreground">
                {i18nService.t('enterpriseLeadCreateNewWorkspace')}
              </span>
              <span className="mt-2 block text-sm leading-6 text-secondary">
                {i18nService.t('enterpriseLeadCreateWorkspaceDesc')}
              </span>
            </span>
            <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary">
              {i18nService.t('enterpriseLeadCreateByExtraction')}
              <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </button>
        </div>

        {secondaryWorkspaces.length > 0 && (
          <div className="mt-8">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">
                {i18nService.t('enterpriseLeadRecentWorkspaces')}
              </h2>
              <p className="text-xs text-secondary">
                {i18nService.t('enterpriseLeadRecentWorkspacesDesc')}
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {secondaryWorkspaces.map(workspace => (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => onOpen(workspace.id)}
                  className="rounded-lg border border-border bg-surface p-4 text-left transition-colors hover:border-primary/40 hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <WorkspaceSummary workspace={workspace} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkspaceLaunch;
