import React, { useState } from 'react';

import type { EnterpriseLeadAgentTask } from '../../../shared/enterpriseLeadWorkspace/types';
import { i18nService } from '../../services/i18n';

interface WorkflowApprovalPanelProps {
  task: EnterpriseLeadAgentTask;
  disabled?: boolean;
  onApprove: (task: EnterpriseLeadAgentTask) => void;
  onReject: (task: EnterpriseLeadAgentTask) => void;
}

export const WorkflowApprovalPanel: React.FC<WorkflowApprovalPanelProps> = ({
  task,
  disabled = false,
  onApprove,
  onReject,
}) => {
  const [feedback, setFeedback] = useState('');

  return (
    <section className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-sm font-semibold text-foreground">
        {i18nService.t('enterpriseLeadWorkflowApprovalTitle')}
      </p>
      <textarea
        value={feedback}
        onChange={event => setFeedback(event.target.value)}
        placeholder={i18nService.t('enterpriseLeadWorkflowApprovalFeedbackPlaceholder')}
        className="mt-2 min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onApprove(task)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {i18nService.t('enterpriseLeadWorkflowApprove')}
        </button>
        <button
          type="button"
          disabled={disabled || !feedback.trim()}
          onClick={() => onReject(task)}
          className="rounded-md border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-60 dark:text-amber-200"
        >
          {i18nService.t('enterpriseLeadWorkflowReject')}
        </button>
      </div>
    </section>
  );
};

export default WorkflowApprovalPanel;
