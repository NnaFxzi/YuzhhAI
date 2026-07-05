import {
  ArchiveBoxIcon,
  ClipboardDocumentCheckIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  ListBulletIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  EnterpriseLeadRiskLevel,
  EnterpriseLeadRunStatus,
  EnterpriseLeadTaskStatus,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadDeliverable,
  EnterpriseLeadRiskItem,
  EnterpriseLeadTaskAgentRole,
  EnterpriseLeadTodo,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceRunSummary,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import {
  type CreationRecordSummary,
  getAgentStatusLabelKey,
  getCreationRecordSummary,
  getEnterpriseLeadTaskDisplay,
} from './enterpriseLeadWorkspaceUi';

interface WorkspaceCreationRecordsProps {
  workspace: EnterpriseLeadWorkspace;
  selectedRunId?: string | null;
}

interface RunRiskItem extends EnterpriseLeadRiskItem {
  id: string;
  taskId: string;
}

export const CreationRecordResultSection = {
  Summary: 'summary',
  Deliverables: 'deliverables',
  Risks: 'risks',
  Todos: 'todos',
  Archive: 'archive',
} as const;
export type CreationRecordResultSection =
  typeof CreationRecordResultSection[keyof typeof CreationRecordResultSection];

export interface CreationRecordResultSectionMetadata {
  id: CreationRecordResultSection;
  titleKey: string;
}

const CREATION_RECORD_RESULT_SECTIONS: CreationRecordResultSectionMetadata[] = [
  {
    id: CreationRecordResultSection.Summary,
    titleKey: 'enterpriseLeadCreationResultSummary',
  },
  {
    id: CreationRecordResultSection.Deliverables,
    titleKey: 'enterpriseLeadCreationDeliverablePackage',
  },
  {
    id: CreationRecordResultSection.Risks,
    titleKey: 'enterpriseLeadCreationRisks',
  },
  {
    id: CreationRecordResultSection.Todos,
    titleKey: 'enterpriseLeadHumanTodos',
  },
  {
    id: CreationRecordResultSection.Archive,
    titleKey: 'enterpriseLeadCreationArchive',
  },
];

export const getCreationRecordResultSections = (): CreationRecordResultSectionMetadata[] =>
  CREATION_RECORD_RESULT_SECTIONS.map(section => ({ ...section }));

const runStatusLabelKeys: Record<string, string> = {
  [EnterpriseLeadRunStatus.Draft]: 'enterpriseLeadCreationRunStatusDraft',
  [EnterpriseLeadRunStatus.Running]: 'enterpriseLeadCreationRunStatusRunning',
  [EnterpriseLeadRunStatus.NeedsInput]: 'enterpriseLeadCreationRunStatusNeedsInput',
  [EnterpriseLeadRunStatus.Blocked]: 'enterpriseLeadCreationRunStatusBlocked',
  [EnterpriseLeadRunStatus.Completed]: 'enterpriseLeadCreationRunStatusCompleted',
  [EnterpriseLeadRunStatus.Archived]: 'enterpriseLeadCreationRunStatusArchived',
  [EnterpriseLeadRunStatus.Error]: 'enterpriseLeadCreationRunStatusError',
};

const runStatusClassNames: Record<string, string> = {
  [EnterpriseLeadRunStatus.Draft]: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  [EnterpriseLeadRunStatus.Running]: 'bg-primary/10 text-primary',
  [EnterpriseLeadRunStatus.NeedsInput]: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  [EnterpriseLeadRunStatus.Blocked]: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
  [EnterpriseLeadRunStatus.Completed]: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  [EnterpriseLeadRunStatus.Archived]: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  [EnterpriseLeadRunStatus.Error]: 'bg-red-500/10 text-red-700 dark:text-red-300',
};

const EnterpriseLeadDeliverableStatus = {
  Draft: 'draft',
  Approved: 'approved',
  Archived: 'archived',
} as const;

const EnterpriseLeadTodoStatus = {
  Open: 'open',
  Resolved: 'resolved',
} as const;

const deliverableStatusLabelKeys: Record<string, string> = {
  [EnterpriseLeadDeliverableStatus.Draft]: 'enterpriseLeadCreationDeliverableStatusDraft',
  [EnterpriseLeadDeliverableStatus.Approved]: 'enterpriseLeadCreationDeliverableStatusApproved',
  [EnterpriseLeadDeliverableStatus.Archived]: 'enterpriseLeadCreationDeliverableStatusArchived',
};

const todoStatusLabelKeys: Record<string, string> = {
  [EnterpriseLeadTodoStatus.Open]: 'enterpriseLeadCreationTodoStatusOpen',
  [EnterpriseLeadTodoStatus.Resolved]: 'enterpriseLeadCreationTodoStatusResolved',
};

const riskLevelLabelKeys: Record<string, string> = {
  [EnterpriseLeadRiskLevel.Low]: 'enterpriseLeadCreationRiskLevelLow',
  [EnterpriseLeadRiskLevel.Medium]: 'enterpriseLeadCreationRiskLevelMedium',
  [EnterpriseLeadRiskLevel.High]: 'enterpriseLeadCreationRiskLevelHigh',
};

const formatRecordDate = (value: string): string => {
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

const getRunStatusLabel = (status: string): string =>
  i18nService.t(runStatusLabelKeys[status] ?? 'enterpriseLeadCreationRunStatusUnknown');

const getRunStatusClassName = (status: string): string =>
  runStatusClassNames[status] ?? runStatusClassNames[EnterpriseLeadRunStatus.Draft];

const getArchiveStateLabel = (archiveStatus: string): string =>
  archiveStatus === 'archived'
    ? i18nService.t('enterpriseLeadArchived')
    : i18nService.t('enterpriseLeadCreationNotArchived');

export const getInitialCreationRecordId = (
  summaries: EnterpriseLeadWorkspaceRunSummary[],
  preferredRunId?: string | null,
): string | null => {
  if (preferredRunId && summaries.some(summary => summary.run.id === preferredRunId)) {
    return preferredRunId;
  }

  return summaries[0]?.run.id ?? null;
};

const displayText = (key: string | undefined, fallback: string): string =>
  key ? i18nService.t(key) : fallback;

const getRoleDisplayName = (role?: EnterpriseLeadTaskAgentRole | null): string => {
  if (!role) {
    return '';
  }

  const taskDisplay = getEnterpriseLeadTaskDisplay(role);
  return displayText(taskDisplay.titleKey, taskDisplay.titleText);
};

const getTaskIdFromDerivedId = (id: string): string | null => {
  const match = /^task:([^:]+)/.exec(id);
  return match?.[1] ?? null;
};

const getTaskDisplayName = (
  tasks: EnterpriseLeadAgentTask[],
  role?: EnterpriseLeadTaskAgentRole | null,
  taskId?: string | null,
): string => {
  const task = (taskId ? tasks.find(item => item.id === taskId) : undefined) ??
    (role ? tasks.find(item => item.role === role) : undefined);
  if (!task) {
    return role ? getRoleDisplayName(role) : '';
  }

  const taskDisplay = getEnterpriseLeadTaskDisplay(task);
  return displayText(taskDisplay.titleKey, taskDisplay.titleText);
};

const getDeliverableStatusLabel = (status: string): string =>
  i18nService.t(deliverableStatusLabelKeys[status] ?? 'enterpriseLeadCreationStatusUnknown');

const getTodoStatusLabel = (status: string): string =>
  i18nService.t(todoStatusLabelKeys[status] ?? 'enterpriseLeadCreationStatusUnknown');

const getRiskLevelLabel = (level: string): string =>
  i18nService.t(riskLevelLabelKeys[level] ?? 'enterpriseLeadCreationStatusUnknown');

const flattenTaskRisks = (tasks: EnterpriseLeadAgentTask[]): RunRiskItem[] =>
  tasks.flatMap(task => task.risks.map((risk, index) => ({
    ...risk,
    id: `${task.id}-risk-${index}`,
    taskId: task.id,
  })));

const CountPill: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number;
}> = ({ icon, label, value }) => (
  <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-raised px-2 py-1 text-xs text-secondary">
    {icon}
    <span>{label}</span>
    <span className="font-semibold text-foreground">{value}</span>
  </span>
);

const RunSummaryButton: React.FC<{
  summary: CreationRecordSummary;
  selected: boolean;
  onSelect: () => void;
}> = ({ summary, selected, onSelect }) => (
  <button
    type="button"
    onClick={onSelect}
    className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
      selected
        ? 'border-primary/60 bg-primary/5'
        : 'border-border bg-surface hover:border-primary/30 hover:bg-surface-raised'
    }`}
  >
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">
          {summary.goal || i18nService.t('enterpriseLeadCreationUntitledGoal')}
        </p>
        <p className="mt-1 text-xs text-tertiary">
          {formatRecordDate(summary.createdAt)}
        </p>
      </div>
      <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${getRunStatusClassName(summary.status)}`}>
        {getRunStatusLabel(summary.status)}
      </span>
    </div>

    <div className="mt-3 flex flex-wrap gap-1.5">
      <CountPill
        icon={<UserGroupIcon className="h-3.5 w-3.5" />}
        label={i18nService.t('enterpriseLeadCreationAgents')}
        value={summary.participantCount}
      />
      {summary.meta.slice(1).map(metric => (
        <CountPill
          key={metric.id}
          icon={<ListBulletIcon className="h-3.5 w-3.5" />}
          label={i18nService.t(metric.labelKey)}
          value={metric.count}
        />
      ))}
    </div>

    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-secondary">
      <span>
        {i18nService.t('enterpriseLeadCreationUpdatedAt')}
        {formatRecordDate(summary.updatedAt)}
      </span>
      <span className="rounded-md bg-surface-raised px-2 py-0.5">
        {getArchiveStateLabel(summary.archiveStatus)}
      </span>
    </div>
  </button>
);

const DetailSection: React.FC<{
  title: string;
  icon: React.ReactNode;
  emptyText: string;
  children: React.ReactNode;
  isEmpty: boolean;
}> = ({ title, icon, emptyText, children, isEmpty }) => (
  <section className="rounded-lg border border-border bg-surface px-4 py-4 shadow-sm">
    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
      {icon}
      {title}
    </h3>
    {isEmpty ? (
      <p className="mt-3 text-sm leading-6 text-secondary">{emptyText}</p>
    ) : (
      children
    )}
  </section>
);

const TaskRows: React.FC<{ tasks: EnterpriseLeadAgentTask[] }> = ({ tasks }) => (
  <div className="mt-3 divide-y divide-border">
    {tasks.map(task => {
      const taskDisplay = getEnterpriseLeadTaskDisplay(task);
      const statusKey = getAgentStatusLabelKey(
        task.status === EnterpriseLeadTaskStatus.Completed && task.stale
          ? EnterpriseLeadTaskStatus.Stale
          : task.status,
      );
      const outputEntries = Object.entries(task.outputPayload ?? {});

      return (
        <article key={task.id} className="py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {displayText(taskDisplay.titleKey, taskDisplay.titleText)}
            </span>
            <span className="rounded-md bg-surface-raised px-2 py-0.5 text-xs text-secondary">
              {i18nService.t(statusKey)}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-foreground">
            {task.summary.trim() || i18nService.t('enterpriseLeadCreationNoTaskSummary')}
          </p>
          {outputEntries.length > 0 ? (
            <dl className="mt-2 grid gap-2 text-xs text-secondary sm:grid-cols-2">
              {outputEntries.slice(0, 4).map(([key, value]) => (
                <div key={key} className="min-w-0 rounded-md bg-background px-2 py-2">
                  <dt className="truncate font-medium text-foreground">{key}</dt>
                  <dd className="mt-1 line-clamp-3 break-words leading-5">
                    {typeof value === 'string' ? value : JSON.stringify(value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </article>
      );
    })}
  </div>
);

const DeliverableRows: React.FC<{
  deliverables: EnterpriseLeadDeliverable[];
  tasks: EnterpriseLeadAgentTask[];
}> = ({
  deliverables,
  tasks,
}) => (
  <div className="mt-3 divide-y divide-border">
    {deliverables.map(deliverable => (
      <article key={deliverable.id} className="py-3 first:pt-0 last:pb-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {getTaskDisplayName(
              tasks,
              deliverable.role,
              getTaskIdFromDerivedId(deliverable.id),
            ) || deliverable.title}
          </span>
          <span className="rounded-md bg-surface-raised px-2 py-0.5 text-xs text-secondary">
            {getDeliverableStatusLabel(deliverable.status)}
          </span>
        </div>
        <p className="mt-2 text-sm font-medium text-foreground">{deliverable.title}</p>
        <p className="mt-1 line-clamp-3 text-sm leading-6 text-secondary">
          {deliverable.summary}
        </p>
      </article>
    ))}
  </div>
);

const TodoRows: React.FC<{
  todos: EnterpriseLeadTodo[];
  tasks: EnterpriseLeadAgentTask[];
}> = ({ todos, tasks }) => (
  <div className="mt-3 divide-y divide-border">
    {todos.map(todo => (
      <article key={todo.id} className="py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            {getTaskDisplayName(tasks, todo.role, getTaskIdFromDerivedId(todo.id)) ? (
              <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {getTaskDisplayName(tasks, todo.role, getTaskIdFromDerivedId(todo.id))}
              </span>
            ) : null}
            <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
              {getTodoStatusLabel(todo.status)}
            </span>
          </div>
        <p className="mt-2 text-sm font-medium text-foreground">{todo.title}</p>
        <p className="mt-1 text-sm leading-6 text-secondary">{todo.description}</p>
      </article>
    ))}
  </div>
);

const RiskRows: React.FC<{
  risks: RunRiskItem[];
  tasks: EnterpriseLeadAgentTask[];
}> = ({ risks, tasks }) => (
  <div className="mt-3 divide-y divide-border">
    {risks.map(risk => (
      <article key={risk.id} className="py-3 first:pt-0 last:pb-0">
        <div className="flex flex-wrap items-center gap-2">
          {getTaskDisplayName(tasks, risk.role, risk.taskId) ? (
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {getTaskDisplayName(tasks, risk.role, risk.taskId)}
            </span>
          ) : null}
          <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-xs text-red-700 dark:text-red-300">
            {getRiskLevelLabel(risk.level)}
          </span>
        </div>
        <p className="mt-2 text-sm font-medium text-foreground">{risk.title}</p>
        <p className="mt-1 text-sm leading-6 text-secondary">{risk.description}</p>
      </article>
    ))}
  </div>
);

const ArchiveRows: React.FC<{ snapshot: EnterpriseLeadWorkspaceSnapshot }> = ({ snapshot }) => (
  <div className="mt-3 divide-y divide-border">
    <div className="pb-3 text-sm leading-6 text-secondary">
      <span className="font-medium text-foreground">
        {i18nService.t('enterpriseLeadCreationArchiveState')}
      </span>
      {getArchiveStateLabel(snapshot.currentRun?.archiveStatus ?? 'not_archived')}
    </div>
    {snapshot.archives.map(archive => (
      <article key={archive.id} className="py-3 first:pt-0 last:pb-0">
        <p className="text-sm font-medium text-foreground">{archive.title}</p>
        <p className="mt-1 text-sm leading-6 text-secondary">{archive.summary}</p>
        <p className="mt-1 text-xs text-tertiary">{formatRecordDate(archive.createdAt)}</p>
      </article>
    ))}
  </div>
);

export const WorkspaceCreationRecords: React.FC<WorkspaceCreationRecordsProps> = ({
  workspace,
  selectedRunId: preferredRunId = null,
}) => {
  const [runSummaries, setRunSummaries] = useState<EnterpriseLeadWorkspaceRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<EnterpriseLeadWorkspaceSnapshot | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  useEffect(() => {
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    setRunSummaries([]);
    setSelectedRunId(null);
    setSnapshot(null);
    setListError('');
    setDetailError('');
    setIsLoadingList(true);

    enterpriseLeadWorkspaceService.listRuns(workspace.id)
      .then(nextSummaries => {
        if (listRequestRef.current !== requestId) {
          return;
        }
        setRunSummaries(nextSummaries);
        setSelectedRunId(getInitialCreationRecordId(nextSummaries, preferredRunId));
      })
      .catch(() => {
        if (listRequestRef.current === requestId) {
          setListError(i18nService.t('enterpriseLeadCreationRecordsLoadFailed'));
        }
      })
      .finally(() => {
        if (listRequestRef.current === requestId) {
          setIsLoadingList(false);
        }
      });

    return () => {
      listRequestRef.current += 1;
    };
  }, [preferredRunId, workspace.id]);

  useEffect(() => {
    if (!selectedRunId) {
      setSnapshot(null);
      setDetailError('');
      return;
    }

    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    setSnapshot(null);
    setDetailError('');
    setIsLoadingDetail(true);

    enterpriseLeadWorkspaceService.getRun(workspace.id, selectedRunId)
      .then(nextSnapshot => {
        if (detailRequestRef.current !== requestId) {
          return;
        }
        setSnapshot(nextSnapshot);
        if (!nextSnapshot) {
          setDetailError(i18nService.t('enterpriseLeadCreationRecordDetailLoadFailed'));
        }
      })
      .catch(() => {
        if (detailRequestRef.current === requestId) {
          setDetailError(i18nService.t('enterpriseLeadCreationRecordDetailLoadFailed'));
        }
      })
      .finally(() => {
        if (detailRequestRef.current === requestId) {
          setIsLoadingDetail(false);
        }
      });

    return () => {
      detailRequestRef.current += 1;
    };
  }, [selectedRunId, workspace.id]);

  const summaries = useMemo(
    () => runSummaries.map(summary => getCreationRecordSummary(summary)),
    [runSummaries],
  );
  const selectedSummary = summaries.find(summary => summary.runId === selectedRunId) ?? null;
  const risks = useMemo(
    () => flattenTaskRisks(snapshot?.tasks ?? []),
    [snapshot?.tasks],
  );
  const renderResultSection = (
    section: CreationRecordResultSectionMetadata,
  ): React.ReactNode => {
    if (!snapshot || !selectedSummary) {
      return null;
    }

    if (section.id === CreationRecordResultSection.Summary) {
      return (
        <DetailSection
          title={i18nService.t(section.titleKey)}
          icon={<ClipboardDocumentCheckIcon className="h-4 w-4 text-primary" />}
          emptyText=""
          isEmpty={false}
        >
          <div className="mt-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="line-clamp-2 text-lg font-semibold text-foreground">
                  {selectedSummary.goal || i18nService.t('enterpriseLeadCreationUntitledGoal')}
                </h2>
                <p className="mt-1 text-sm text-secondary">
                  {formatRecordDate(selectedSummary.createdAt)}
                </p>
              </div>
              <span className={`rounded-md px-2.5 py-1 text-xs font-medium ${getRunStatusClassName(selectedSummary.status)}`}>
                {getRunStatusLabel(selectedSummary.status)}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <CountPill
                icon={<UserGroupIcon className="h-3.5 w-3.5" />}
                label={i18nService.t('enterpriseLeadCreationAgents')}
                value={selectedSummary.participantCount}
              />
              {selectedSummary.meta.map(metric => (
                <CountPill
                  key={metric.id}
                  icon={<ListBulletIcon className="h-3.5 w-3.5" />}
                  label={i18nService.t(metric.labelKey)}
                  value={metric.count}
                />
              ))}
            </div>
            {snapshot.currentRun?.controllerSummary ? (
              <p className="mt-4 text-sm leading-6 text-secondary">
                {snapshot.currentRun.controllerSummary}
              </p>
            ) : null}
            {snapshot.tasks.length > 0 ? (
              <div className="mt-4 border-t border-border pt-4">
                <h4 className="text-xs font-semibold text-tertiary">
                  {i18nService.t('enterpriseLeadCreationExecutionDetails')}
                </h4>
                <TaskRows tasks={snapshot.tasks} />
              </div>
            ) : null}
          </div>
        </DetailSection>
      );
    }

    if (section.id === CreationRecordResultSection.Deliverables) {
      return (
        <DetailSection
          title={i18nService.t(section.titleKey)}
          icon={<DocumentTextIcon className="h-4 w-4 text-primary" />}
          emptyText={i18nService.t('enterpriseLeadNoDeliverables')}
          isEmpty={snapshot.deliverables.length === 0}
        >
          <DeliverableRows
            deliverables={snapshot.deliverables}
            tasks={snapshot.tasks}
          />
        </DetailSection>
      );
    }

    if (section.id === CreationRecordResultSection.Risks) {
      return (
        <DetailSection
          title={i18nService.t(section.titleKey)}
          icon={<ExclamationTriangleIcon className="h-4 w-4 text-primary" />}
          emptyText={i18nService.t('enterpriseLeadCreationNoRisks')}
          isEmpty={risks.length === 0}
        >
          <RiskRows risks={risks} tasks={snapshot.tasks} />
        </DetailSection>
      );
    }

    if (section.id === CreationRecordResultSection.Todos) {
      return (
        <DetailSection
          title={i18nService.t(section.titleKey)}
          icon={<ListBulletIcon className="h-4 w-4 text-primary" />}
          emptyText={i18nService.t('enterpriseLeadNoTodos')}
          isEmpty={snapshot.todos.length === 0}
        >
          <TodoRows todos={snapshot.todos} tasks={snapshot.tasks} />
        </DetailSection>
      );
    }

    return (
      <DetailSection
        title={i18nService.t(section.titleKey)}
        icon={<ArchiveBoxIcon className="h-4 w-4 text-primary" />}
        emptyText={i18nService.t('enterpriseLeadNoArchives')}
        isEmpty={snapshot.archives.length === 0 && snapshot.currentRun?.archiveStatus !== 'archived'}
      >
        <ArchiveRows snapshot={snapshot} />
      </DetailSection>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      <div className="shrink-0 border-b border-border bg-background px-6 py-4">
        <p className="text-xs font-semibold uppercase text-primary">
          {i18nService.t('enterpriseLeadWorkbenchNavCreationRecords')}
        </p>
        <h1 className="mt-1 truncate text-xl font-semibold text-foreground">
          {workspace.name}
        </h1>
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-b border-border bg-background px-4 py-4 lg:border-b-0 lg:border-r">
          {listError ? (
            <p className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
              {listError}
            </p>
          ) : null}

          {isLoadingList ? (
            <p className="px-2 py-4 text-sm text-secondary">{i18nService.t('loading')}</p>
          ) : null}

          {!isLoadingList && summaries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm leading-6 text-secondary">
              {i18nService.t('enterpriseLeadCreationRecordsEmpty')}
            </p>
          ) : (
            <div className="space-y-3">
              {summaries.map(summary => (
                <RunSummaryButton
                  key={summary.runId}
                  summary={summary}
                  selected={summary.runId === selectedRunId}
                  onSelect={() => setSelectedRunId(summary.runId)}
                />
              ))}
            </div>
          )}
        </aside>

        <main className="min-h-0 overflow-y-auto px-6 py-5">
          {!selectedRunId ? (
            <div className="rounded-lg border border-dashed border-border px-5 py-8 text-center text-sm text-secondary">
              {i18nService.t('enterpriseLeadCreationRecordSelectEmpty')}
            </div>
          ) : null}

          {selectedRunId && isLoadingDetail ? (
            <p className="rounded-lg border border-border bg-surface px-4 py-4 text-sm text-secondary">
              {i18nService.t('loading')}
            </p>
          ) : null}

          {detailError ? (
            <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
              {detailError}
            </p>
          ) : null}

          {snapshot && selectedSummary ? (
            <div className="space-y-4">
              {getCreationRecordResultSections().map(section => (
                <React.Fragment key={section.id}>
                  {renderResultSection(section)}
                </React.Fragment>
              ))}
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
};

export default WorkspaceCreationRecords;
