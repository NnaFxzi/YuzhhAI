import {
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  EnterpriseLeadRunStatus,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceRunSummary,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import {
  buildCreationRecordConversationMessages,
  type CreationRecordConversationMessage,
  CreationRecordConversationRole,
  type CreationRecordSummary,
  getCreationRecordSummary,
} from './enterpriseLeadWorkspaceUi';

interface WorkspaceCreationRecordsProps {
  workspace: EnterpriseLeadWorkspace;
  selectedRunId?: string | null;
}

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

export const getInitialCreationRecordId = (
  summaries: EnterpriseLeadWorkspaceRunSummary[],
  preferredRunId?: string | null,
): string | null => {
  if (preferredRunId && summaries.some(summary => summary.run.id === preferredRunId)) {
    return preferredRunId;
  }

  return summaries[0]?.run.id ?? null;
};

const getConversationLabel = (message: CreationRecordConversationMessage): string =>
  message.labelKey ? i18nService.t(message.labelKey) : message.labelText ?? '';

const RunSummaryButton: React.FC<{
  summary: CreationRecordSummary;
  selected: boolean;
  onSelect: () => void;
}> = ({ summary, selected, onSelect }) => (
  <button
    type="button"
    onClick={onSelect}
    className={`relative w-full rounded-md px-3 py-2.5 text-left transition-colors ${
      selected
        ? 'bg-surface-raised text-foreground shadow-sm'
        : 'text-secondary hover:bg-surface-raised hover:text-foreground'
    }`}
  >
    {selected && (
      <span className="absolute left-0 top-2.5 h-[calc(100%-20px)] w-0.5 rounded-r bg-primary" />
    )}
    <div className="flex min-w-0 items-start justify-between gap-2">
      <p className="line-clamp-2 min-w-0 text-sm font-semibold leading-5 text-foreground">
        {summary.goal || i18nService.t('enterpriseLeadCreationUntitledGoal')}
      </p>
      <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${getRunStatusClassName(summary.status)}`}>
        {getRunStatusLabel(summary.status)}
      </span>
    </div>
    <p className="mt-1 truncate text-xs text-tertiary">
      {formatRecordDate(summary.updatedAt) || formatRecordDate(summary.createdAt)}
    </p>
  </button>
);

const ConversationMessageRow: React.FC<{
  message: CreationRecordConversationMessage;
}> = ({ message }) => {
  const isUser = message.role === CreationRecordConversationRole.User;
  const label = getConversationLabel(message)
    || i18nService.t(isUser
      ? 'enterpriseLeadCreationConversationUser'
      : 'enterpriseLeadCreationConversationController');

  return (
    <article className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[84%] rounded-lg px-3 py-2.5 ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'border border-border bg-surface text-foreground'
        }`}
      >
        <div className={`text-[11px] font-medium ${isUser ? 'text-primary-foreground/80' : 'text-tertiary'}`}>
          {label}
        </div>
        <p className={`mt-1 break-words whitespace-pre-wrap text-sm leading-6 ${isUser ? 'text-primary-foreground' : 'text-foreground'}`}>
          {message.content || i18nService.t('enterpriseLeadCreationNoTaskSummary')}
        </p>
        {message.createdAt ? (
          <div className={`mt-1 text-[11px] ${isUser ? 'text-primary-foreground/70' : 'text-tertiary'}`}>
            {formatRecordDate(message.createdAt)}
          </div>
        ) : null}
      </div>
    </article>
  );
};

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
  const conversationMessages = useMemo(
    () => snapshot ? buildCreationRecordConversationMessages(snapshot) : [],
    [snapshot],
  );

  return (
    <div className="grid h-full min-h-0 flex-1 overflow-hidden bg-background lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-b border-border bg-surface lg:border-b-0 lg:border-r">
        <div className="shrink-0 px-4 py-4">
          <p className="text-sm font-semibold text-foreground">
            {i18nService.t('enterpriseLeadCreationConversationTitle')}
          </p>
          <p className="mt-1 truncate text-xs text-tertiary">
            {workspace.name}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {listError ? (
            <p className="mb-3 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
              {listError}
            </p>
          ) : null}

          {isLoadingList ? (
            <p className="px-2 py-4 text-sm text-secondary">{i18nService.t('loading')}</p>
          ) : null}

          {!isLoadingList && summaries.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-4 py-6 text-sm leading-6 text-secondary">
              {i18nService.t('enterpriseLeadCreationRecordsEmpty')}
            </p>
          ) : (
            <div className="space-y-1">
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
        </div>
      </aside>

      <main className="flex min-h-0 flex-col overflow-hidden bg-background">
        {!selectedRunId ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-6">
            <div className="rounded-md border border-dashed border-border px-5 py-8 text-center text-sm text-secondary">
              {i18nService.t('enterpriseLeadCreationRecordSelectEmpty')}
            </div>
          </div>
        ) : null}

        {selectedRunId && isLoadingDetail ? (
          <p className="m-6 rounded-md border border-border bg-surface px-4 py-4 text-sm text-secondary">
            {i18nService.t('loading')}
          </p>
        ) : null}

        {detailError ? (
          <p className="m-6 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
            {detailError}
          </p>
        ) : null}

        {snapshot && selectedSummary ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <header className="shrink-0 border-b border-border bg-background px-6 py-4">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-xs font-semibold text-primary">
                    <ChatBubbleLeftRightIcon className="h-4 w-4" />
                    {i18nService.t('enterpriseLeadCreationConversationTitle')}
                  </p>
                  <h2 className="mt-1 line-clamp-2 text-lg font-semibold text-foreground">
                    {selectedSummary.goal || i18nService.t('enterpriseLeadCreationUntitledGoal')}
                  </h2>
                  <p className="mt-1 text-xs text-tertiary">
                    {formatRecordDate(selectedSummary.createdAt)}
                  </p>
                </div>
                <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium ${getRunStatusClassName(selectedSummary.status)}`}>
                  {getRunStatusLabel(selectedSummary.status)}
                </span>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {conversationMessages.length > 0 ? (
                <div className="mx-auto max-w-4xl space-y-4">
                  {conversationMessages.map(message => (
                    <ConversationMessageRow key={message.id} message={message} />
                  ))}
                </div>
              ) : (
                <div className="mx-auto max-w-4xl rounded-md border border-dashed border-border px-5 py-8 text-center text-sm text-secondary">
                  {i18nService.t('enterpriseLeadCreationConversationEmpty')}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
};

export default WorkspaceCreationRecords;
