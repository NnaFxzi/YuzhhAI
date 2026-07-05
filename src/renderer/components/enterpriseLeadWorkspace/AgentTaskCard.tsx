import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';
import React from 'react';

import { EnterpriseLeadTaskStatus } from '../../../shared/enterpriseLeadWorkspace/constants';
import type { EnterpriseLeadAgentTask } from '../../../shared/enterpriseLeadWorkspace/types';
import { i18nService } from '../../services/i18n';
import {
  getAgentCardTone,
  getAgentStatusLabelKey,
  getEnterpriseLeadTaskDisplay,
  hasTaskOutput,
} from './enterpriseLeadWorkspaceUi';

export const AgentTaskRunAction = {
  Run: 'run',
  Rerun: 'rerun',
} as const;
export type AgentTaskRunAction =
  typeof AgentTaskRunAction[keyof typeof AgentTaskRunAction];

interface AgentTaskCardProps {
  task: EnterpriseLeadAgentTask;
  isBusy?: boolean;
  disabled?: boolean;
  onRun: (task: EnterpriseLeadAgentTask, action: AgentTaskRunAction) => void;
  onChat: (task: EnterpriseLeadAgentTask) => void;
}

const actionButtonBase =
  'inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60';

const displayText = (key: string | undefined, fallback: string): string =>
  key ? i18nService.t(key) : fallback;

export const AgentTaskCard: React.FC<AgentTaskCardProps> = ({
  task,
  isBusy = false,
  disabled = false,
  onRun,
  onChat,
}) => {
  const taskDisplay = getEnterpriseLeadTaskDisplay(task);
  const outputExists = hasTaskOutput(task);
  const action = outputExists ? AgentTaskRunAction.Rerun : AgentTaskRunAction.Run;
  const isRunning = task.status === EnterpriseLeadTaskStatus.Running || isBusy;
  const effectiveStatus = task.stale ? EnterpriseLeadTaskStatus.Stale : task.status;
  const tone = getAgentCardTone(effectiveStatus);
  const outputSummary = task.summary.trim() ||
    displayText(taskDisplay.outputKey, taskDisplay.outputText);
  const description = displayText(
    taskDisplay.descriptionKey,
    taskDisplay.descriptionText,
  );

  return (
    <article
      className={`flex min-h-[360px] flex-col rounded-lg border p-4 shadow-sm ${tone.containerClassName}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${tone.avatarClassName}`}
        >
          {displayText(taskDisplay.shortLabelKey, taskDisplay.shortLabelText)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate text-base font-semibold text-foreground">
              {displayText(taskDisplay.titleKey, taskDisplay.titleText)}
            </h3>
            <span
              className={`inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium ${tone.statusClassName}`}
            >
              {i18nService.t(getAgentStatusLabelKey(task.status, task.stale))}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-secondary">
            {description}
          </p>
        </div>
      </div>

      {task.stale && (
        <div className="mt-4 flex gap-2 rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm leading-6 text-amber-800 dark:text-amber-200">
          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{i18nService.t('enterpriseLeadAgentStale')}</span>
        </div>
      )}

      <div className="mt-4 space-y-4">
        <section>
          <h4 className="text-xs font-semibold uppercase text-secondary">
            {i18nService.t('enterpriseLeadAgentResponsibility')}
          </h4>
          <p className="mt-1 text-sm leading-6 text-foreground">
            {description}
          </p>
        </section>

        <div className="grid gap-4 border-t border-border/70 pt-4 md:grid-cols-2 md:divide-x md:divide-border">
          <section className="md:pr-4">
            <h4 className="text-xs font-semibold uppercase text-secondary">
              {i18nService.t('enterpriseLeadAgentInput')}
            </h4>
            <p className="mt-1 line-clamp-4 text-sm leading-6 text-foreground">
              {displayText(taskDisplay.inputKey, taskDisplay.inputText || description)}
            </p>
          </section>

          <section className="md:pl-4">
            <h4 className="text-xs font-semibold uppercase text-secondary">
              {i18nService.t('enterpriseLeadAgentOutput')}
            </h4>
            <p className="mt-1 line-clamp-4 text-sm leading-6 text-foreground">
              {outputSummary}
            </p>
          </section>
        </div>
      </div>

      {task.error && (
        <p className="mt-4 rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-sm leading-6 text-red-700 dark:text-red-300">
          {task.error}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
        <button
          type="button"
          disabled={disabled || isRunning}
          onClick={() => onRun(task, action)}
          className={`${actionButtonBase} ${tone.actionClassName}`}
        >
          {isRunning ? (
            <ArrowPathIcon className="h-4 w-4 animate-spin" />
          ) : action === AgentTaskRunAction.Rerun ? (
            <ArrowPathIcon className="h-4 w-4" />
          ) : (
            <PlayIcon className="h-4 w-4" />
          )}
          {isRunning
            ? i18nService.t('enterpriseLeadAgentRunning')
            : i18nService.t(action === AgentTaskRunAction.Rerun
              ? 'enterpriseLeadAgentRerun'
              : 'enterpriseLeadAgentRun')}
        </button>

        <button
          type="button"
          disabled={disabled || isRunning}
          onClick={() => onChat(task)}
          className={`${actionButtonBase} border border-border bg-surface text-foreground hover:bg-surface-raised focus:ring-primary/20`}
        >
          <ChatBubbleLeftRightIcon className="h-4 w-4" />
          {i18nService.t('enterpriseLeadAgentChat')}
        </button>
      </div>
    </article>
  );
};

export default AgentTaskCard;
