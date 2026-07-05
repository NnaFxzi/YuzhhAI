import {
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  Cog6ToothIcon,
  MagnifyingGlassIcon,
  RectangleGroupIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import React from 'react';

import { EnterpriseLeadRunStatus } from '../../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceRunSummary,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { i18nService } from '../../services/i18n';
import {
  type EnterpriseLeadWorkbenchNavIcon as EnterpriseLeadWorkbenchNavIconType,
  type EnterpriseLeadWorkspaceInternalPage,
  getCreationRecordSummary,
  getDefaultWorkbenchSidebarMode,
  getWorkbenchSidebarWidth,
  getWorkspaceInternalPages,
} from './enterpriseLeadWorkspaceUi';

interface WorkspaceShellProps {
  workspace: EnterpriseLeadWorkspace;
  activePage: EnterpriseLeadWorkspaceInternalPage;
  onPageChange: (page: EnterpriseLeadWorkspaceInternalPage) => void;
  recentRuns?: EnterpriseLeadWorkspaceRunSummary[];
  onRecordSelect?: (runId: string) => void;
  children: React.ReactNode;
}

const navIconById: Record<EnterpriseLeadWorkbenchNavIconType, React.ComponentType<{ className?: string }>> = {
  dashboard: RectangleGroupIcon,
  chat: ChatBubbleLeftRightIcon,
  search: MagnifyingGlassIcon,
  knowledge: BookOpenIcon,
  records: ClockIcon,
  agents: UserGroupIcon,
  settings: Cog6ToothIcon,
};

const runStatusLabelKeys: Record<string, string> = {
  [EnterpriseLeadRunStatus.Draft]: 'enterpriseLeadCreationRunStatusDraft',
  [EnterpriseLeadRunStatus.Running]: 'enterpriseLeadCreationRunStatusRunning',
  [EnterpriseLeadRunStatus.NeedsInput]: 'enterpriseLeadCreationRunStatusNeedsInput',
  [EnterpriseLeadRunStatus.Blocked]: 'enterpriseLeadCreationRunStatusBlocked',
  [EnterpriseLeadRunStatus.Completed]: 'enterpriseLeadCreationRunStatusCompleted',
  [EnterpriseLeadRunStatus.Archived]: 'enterpriseLeadCreationRunStatusArchived',
  [EnterpriseLeadRunStatus.Error]: 'enterpriseLeadCreationRunStatusError',
};

export const WorkspaceShell: React.FC<WorkspaceShellProps> = ({
  activePage,
  onPageChange,
  recentRuns = [],
  onRecordSelect,
  children,
}) => {
  const sidebarMode = getDefaultWorkbenchSidebarMode();
  const sidebarWidth = getWorkbenchSidebarWidth(sidebarMode);
  const pages = getWorkspaceInternalPages();
  const recentRecords = recentRuns.slice(0, 4).map(runSummary => getCreationRecordSummary(runSummary));

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-background">
      <aside
        className="flex h-full shrink-0 flex-col border-r border-border bg-surface px-3 py-5"
        style={{ width: sidebarWidth }}
        data-workspace-shell-sidebar-mode={sidebarMode}
      >
        <nav className="flex shrink-0 flex-col gap-1 pb-4" aria-label={i18nService.t('enterpriseLeadNavLabel')}>
          {pages.map(page => {
            const Icon = navIconById[page.icon];
            const isActive = page.id === activePage;

            return (
              <button
                key={page.id}
                type="button"
                onClick={() => onPageChange(page.id)}
                className={`flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-surface-raised text-foreground shadow-sm'
                    : 'text-secondary hover:bg-surface-raised hover:text-foreground'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">
                  {i18nService.t(page.labelKey)}
                </span>
              </button>
            );
          })}
        </nav>
        {recentRecords.length > 0 ? (
          <section className="min-h-0 flex-1 overflow-y-auto border-t border-border pt-4">
            <p className="px-2 text-xs font-semibold text-tertiary">
              {i18nService.t('enterpriseLeadWorkspaceSidebarConversationRecords')}
            </p>
            <div className="mt-2 space-y-1">
              {recentRecords.map(record => (
                <button
                  key={record.runId}
                  type="button"
                  onClick={() => onRecordSelect?.(record.runId)}
                  className="group w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-raised"
                >
                  <span className="block truncate text-sm font-medium text-foreground">
                    {record.goal || i18nService.t('enterpriseLeadCreationUntitledGoal')}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-secondary">
                    <span className="truncate">
                      {i18nService.t(runStatusLabelKeys[record.status] ?? 'enterpriseLeadCreationRunStatusUnknown')}
                    </span>
                    <span className="shrink-0">
                      {i18nService
                        .t('enterpriseLeadWorkspaceSidebarDeliverableCount')
                        .replace('{count}', String(record.deliverableCount))}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
};

export default WorkspaceShell;
