import React, { useMemo } from 'react';

import { EnterpriseLeadTaskStatus } from '../../../shared/enterpriseLeadWorkspace/constants';
import type { EnterpriseLeadAgentTask } from '../../../shared/enterpriseLeadWorkspace/types';
import { normalizeWorkflowArtifactRef, type WorkflowArtifactRef } from '../../../shared/enterpriseLeadWorkspace/workflowContracts';
import { i18nService } from '../../services/i18n';
import { getAgentCardTone, getAgentStatusLabelKey, getEnterpriseLeadTaskDisplay } from './enterpriseLeadWorkspaceUi';
import WorkflowApprovalPanel from './WorkflowApprovalPanel';

interface WorkflowTaskCardProps {
  task: EnterpriseLeadAgentTask;
  disabled?: boolean;
  readOnly?: boolean;
  onApprove: (task: EnterpriseLeadAgentTask) => void;
  onReject: (task: EnterpriseLeadAgentTask, feedback: string) => void;
  onOpenChildSession?: (sessionId: string) => void;
}

const readArtifactRefs = (value: unknown): WorkflowArtifactRef[] =>
  Array.isArray(value)
    ? value.map(normalizeWorkflowArtifactRef).filter((item): item is WorkflowArtifactRef => item !== null)
    : [];

const formatDuration = (startedAt: string, endedAt: string): string => {
  const duration = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(duration) || duration < 0) return i18nService.t('enterpriseLeadWorkflowDurationUnknown');
  return i18nService.t('enterpriseLeadWorkflowDurationMinutes').replace(
    '{count}',
    String(Math.max(1, Math.round(duration / 60_000))),
  );
};

const getChildSessionId = (task: EnterpriseLeadAgentTask): string => {
  const value = task.handoffContext?.childSessionId;
  return typeof value === 'string' ? value.trim() : '';
};

export const WorkflowTaskCard: React.FC<WorkflowTaskCardProps> = ({
  task,
  disabled = false,
  readOnly = false,
  onApprove,
  onReject,
  onOpenChildSession,
}) => {
  const display = getEnterpriseLeadTaskDisplay(task);
  const tone = getAgentCardTone(task.status);
  const inputArtifacts = useMemo(() => readArtifactRefs(task.inputPayload?.artifactRefs), [task.inputPayload]);
  const outputArtifacts = useMemo(
    () => task.artifactRefs ?? readArtifactRefs(task.outputPayload?.artifactRefs),
    [task.artifactRefs, task.outputPayload],
  );
  const childSessionId = getChildSessionId(task);
  const needsApproval = task.status === EnterpriseLeadTaskStatus.AwaitingApproval;

  return (
    <article className={`rounded-lg border p-4 ${tone.containerClassName}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {display.titleKey ? i18nService.t(display.titleKey) : display.titleText}
          </h3>
          <p className="mt-1 text-xs text-secondary">{task.agentSnapshot?.name || task.role}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${tone.statusClassName}`}>
          {i18nService.t(getAgentStatusLabelKey(task.status, task.stale))}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-secondary sm:grid-cols-4">
        <span>{i18nService.t('enterpriseLeadWorkflowAttempts').replace('{count}', String(task.attempt ?? 1))}</span>
        <span>{formatDuration(task.createdAt, task.updatedAt)}</span>
        <span>{i18nService.t('enterpriseLeadWorkflowRiskCount').replace('{count}', String(task.risks.length))}</span>
        <span>{i18nService.t('enterpriseLeadWorkflowTodoCount').replace('{count}', String(task.todos.length))}</span>
      </div>
      {task.summary ? <p className="mt-3 text-sm leading-6 text-secondary">{task.summary}</p> : null}
      {task.missingInfo.length > 0 ? <p className="mt-3 text-xs text-amber-800 dark:text-amber-200">{task.missingInfo.join(' · ')}</p> : null}
      <div className="mt-3 grid gap-3 text-xs text-secondary sm:grid-cols-2">
        <div><p className="font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowInputArtifacts')}</p>{inputArtifacts.map(item => <p key={item.id} className="mt-1 truncate">{item.summary || item.kind}</p>)}</div>
        <div><p className="font-semibold text-foreground">{i18nService.t('enterpriseLeadWorkflowOutputArtifacts')}</p>{outputArtifacts.map(item => <p key={item.id} className="mt-1 truncate">{item.summary || item.kind}</p>)}</div>
      </div>
      {childSessionId && onOpenChildSession ? <button type="button" onClick={() => onOpenChildSession(childSessionId)} className="mt-3 text-xs font-semibold text-primary">{i18nService.t('enterpriseLeadWorkflowOpenChildSession')}</button> : null}
      {needsApproval && !readOnly ? <WorkflowApprovalPanel task={task} disabled={disabled} onApprove={onApprove} onReject={onReject} /> : null}
    </article>
  );
};

export default WorkflowTaskCard;
