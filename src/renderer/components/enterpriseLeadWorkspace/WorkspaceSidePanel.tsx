import {
  ArchiveBoxIcon,
  CheckCircleIcon,
  ClipboardDocumentListIcon,
  DocumentTextIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import React from 'react';

import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadArchive,
  EnterpriseLeadDeliverable,
  EnterpriseLeadPendingVersion,
  EnterpriseLeadTaskAgentRole,
  EnterpriseLeadTodo,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { i18nService } from '../../services/i18n';
import { getEnterpriseLeadTaskDisplay } from './enterpriseLeadWorkspaceUi';

interface WorkspaceSidePanelProps {
  tasks?: EnterpriseLeadAgentTask[];
  pendingVersions: EnterpriseLeadPendingVersion[];
  todos: EnterpriseLeadTodo[];
  deliverables: EnterpriseLeadDeliverable[];
  archives: EnterpriseLeadArchive[];
  applyingVersionId?: string | null;
  disabled?: boolean;
  onApplyVersion: (pendingVersionId: string) => void;
}

interface PanelSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

const panelSectionTitle =
  'flex items-center gap-2 text-sm font-semibold text-foreground';

const emptyStateClassName = 'py-4 text-sm leading-6 text-secondary';

const PanelSection: React.FC<PanelSectionProps> = ({ title, icon, children }) => (
  <section className="border-t border-border px-4 py-3.5 first:border-t-0">
    <h3 className={panelSectionTitle}>
      {icon}
      {title}
    </h3>
    {children}
  </section>
);

const displayText = (key: string | undefined, fallback: string): string =>
  key ? i18nService.t(key) : fallback;

const RoleBadge: React.FC<{ role: EnterpriseLeadTaskAgentRole; label?: string }> = ({
  role,
  label,
}) => {
  const taskDisplay = getEnterpriseLeadTaskDisplay(role);

  return (
    <span className="inline-flex items-center rounded-md bg-surface-raised px-2 py-0.5 text-xs font-medium text-secondary">
      {label || displayText(taskDisplay.titleKey, taskDisplay.titleText)}
    </span>
  );
};

const getTaskIdFromDerivedId = (id: string): string | null => {
  const match = /^task:([^:]+)/.exec(id);
  return match?.[1] ?? null;
};

const findDisplayTask = (
  tasksById: Map<string, EnterpriseLeadAgentTask>,
  tasks: EnterpriseLeadAgentTask[],
  role: EnterpriseLeadTaskAgentRole,
  taskId?: string | null,
): EnterpriseLeadAgentTask | null => {
  if (taskId) {
    const task = tasksById.get(taskId);
    if (task) return task;
  }

  return tasks.find(task => task.role === role) ?? null;
};

const getTaskDisplayLabel = (task: EnterpriseLeadAgentTask): string => {
  const taskDisplay = getEnterpriseLeadTaskDisplay(task);
  return displayText(taskDisplay.titleKey, taskDisplay.titleText);
};

export const WorkspaceSidePanel: React.FC<WorkspaceSidePanelProps> = ({
  tasks = [],
  pendingVersions,
  todos,
  deliverables,
  archives,
  applyingVersionId = null,
  disabled = false,
  onApplyVersion,
}) => {
  const pendingItems = pendingVersions.filter(
    version => version.status === 'pending',
  );
  const tasksById = React.useMemo(
    () => new Map(tasks.map(task => [task.id, task])),
    [tasks],
  );
  const getLabelForRole = (
    role: EnterpriseLeadTaskAgentRole | null | undefined,
    taskId?: string | null,
    fallback?: string,
  ): string | undefined => {
    const displayTask = taskId ? tasksById.get(taskId) : undefined;
    if (displayTask) {
      return getTaskDisplayLabel(displayTask);
    }
    if (!role) {
      return fallback;
    }
    const displayTaskByRole = findDisplayTask(tasksById, tasks, role, null);
    return displayTaskByRole ? getTaskDisplayLabel(displayTaskByRole) : fallback;
  };

  return (
    <aside className="shrink-0 rounded-xl border border-border bg-background shadow-sm">
      <PanelSection
        title={i18nService.t('enterpriseLeadPendingVersions')}
        icon={<CheckCircleIcon className="h-4 w-4 text-primary" />}
      >
        {pendingItems.length > 0 ? (
          <div className="mt-3 divide-y divide-border">
            {pendingItems.map(version => (
              <div key={version.id} className="py-3 first:pt-0 last:pb-0">
                <div className="mb-2">
                  <RoleBadge
                    role={version.role}
                    label={getLabelForRole(version.role, version.taskId)}
                  />
                </div>
                <p className="line-clamp-3 text-sm leading-6 text-foreground">
                  {version.summary.trim() || version.userMessage.trim() ||
                    i18nService.t('enterpriseLeadEmptyField')}
                </p>
                <button
                  type="button"
                  disabled={disabled || applyingVersionId === version.id}
                  onClick={() => onApplyVersion(version.id)}
                  className="mt-3 inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-xs font-medium text-white transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {applyingVersionId === version.id
                    ? i18nService.t('enterpriseLeadApplyingVersion')
                    : i18nService.t('enterpriseLeadApplyVersion')}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className={emptyStateClassName}>
            {i18nService.t('enterpriseLeadNoPendingVersions')}
          </p>
        )}
      </PanelSection>

      <PanelSection
        title={i18nService.t('enterpriseLeadHumanTodos')}
        icon={<ClipboardDocumentListIcon className="h-4 w-4 text-primary" />}
      >
        {todos.length > 0 ? (
          <div className="mt-3 divide-y divide-border">
            {todos.map(todo => (
              <div key={todo.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  {getLabelForRole(todo.role, getTaskIdFromDerivedId(todo.id)) && (
                    <RoleBadge
                      role={todo.role ?? getTaskIdFromDerivedId(todo.id) ?? ''}
                      label={getLabelForRole(
                        todo.role,
                        getTaskIdFromDerivedId(todo.id),
                      )}
                    />
                  )}
                  <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                    {i18nService.t('enterpriseLeadSafetyDraftOnly')}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {todo.title}
                </p>
                <p className="mt-1 line-clamp-3 text-sm leading-6 text-secondary">
                  {todo.description}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className={emptyStateClassName}>
            {i18nService.t('enterpriseLeadNoTodos')}
          </p>
        )}
      </PanelSection>

      <PanelSection
        title={i18nService.t('enterpriseLeadDeliverables')}
        icon={<DocumentTextIcon className="h-4 w-4 text-primary" />}
      >
        {deliverables.length > 0 ? (
          <div className="mt-3 divide-y divide-border">
            {deliverables.map(deliverable => (
              <div key={deliverable.id} className="py-3 first:pt-0 last:pb-0">
                <div className="mb-2">
                  <RoleBadge
                    role={deliverable.role}
                    label={getLabelForRole(
                      deliverable.role,
                      getTaskIdFromDerivedId(deliverable.id),
                      deliverable.title,
                    )}
                  />
                </div>
                <p className="text-sm font-medium text-foreground">
                  {deliverable.title}
                </p>
                <p className="mt-1 line-clamp-3 text-sm leading-6 text-secondary">
                  {deliverable.summary}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className={emptyStateClassName}>
            {i18nService.t('enterpriseLeadNoDeliverables')}
          </p>
        )}
      </PanelSection>

      <PanelSection
        title={i18nService.t('enterpriseLeadArchives')}
        icon={<ArchiveBoxIcon className="h-4 w-4 text-primary" />}
      >
        {archives.length > 0 ? (
          <div className="mt-3 divide-y divide-border">
            {archives.map(archive => (
              <div key={archive.id} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-medium text-foreground">
                  {archive.title}
                </p>
                <p className="mt-1 line-clamp-3 text-sm leading-6 text-secondary">
                  {archive.summary}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className={emptyStateClassName}>
            {i18nService.t('enterpriseLeadNoArchives')}
          </p>
        )}
      </PanelSection>

      <PanelSection
        title={i18nService.t('enterpriseLeadSafetyBoundary')}
        icon={<ShieldCheckIcon className="h-4 w-4 text-primary" />}
      >
        <ul className="mt-3 space-y-2 text-sm leading-6 text-secondary">
          <li>{i18nService.t('enterpriseLeadSafetyNoPublish')}</li>
          <li>{i18nService.t('enterpriseLeadSafetyNoComment')}</li>
          <li>{i18nService.t('enterpriseLeadSafetyNoPrivateMessage')}</li>
          <li>{i18nService.t('enterpriseLeadSafetyNoEmail')}</li>
          <li className="font-medium text-foreground">
            {i18nService.t('enterpriseLeadSafetyDraftOnly')}
          </li>
        </ul>
      </PanelSection>
    </aside>
  );
};

export default WorkspaceSidePanel;
