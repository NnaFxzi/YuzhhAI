import {
  ArchiveBoxIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  PaperAirplaneIcon,
  PlayIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EnterpriseLeadRunStatus } from '../../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import AgentTaskCard, { AgentTaskRunAction } from './AgentTaskCard';
import {
  getEnterpriseLeadTaskDisplay,
  isWorkspaceOperationCurrent,
  type WorkspaceOperationToken,
} from './enterpriseLeadWorkspaceUi';
import WorkspaceSidePanel from './WorkspaceSidePanel';

interface AgentWorkspaceConsoleProps {
  workspace: EnterpriseLeadWorkspace;
  initialSnapshot?: EnterpriseLeadWorkspaceSnapshot | null;
}

const primaryButtonClassName =
  'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60';

const secondaryButtonClassName =
  'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60';

const displayText = (key: string | undefined, fallback: string): string =>
  key ? i18nService.t(key) : fallback;

export const AgentWorkspaceConsole: React.FC<AgentWorkspaceConsoleProps> = ({
  workspace,
  initialSnapshot,
}) => {
  const hasInitialSnapshot = initialSnapshot !== undefined;
  const mountedRef = useRef(true);
  const workspaceIdRef = useRef(workspace.id);
  const requestRef = useRef(0);
  const mutationRef = useRef(0);
  const [snapshot, setSnapshot] = useState<EnterpriseLeadWorkspaceSnapshot | null>(
    initialSnapshot ?? null,
  );
  const [isLoadingRun, setIsLoadingRun] = useState(!hasInitialSnapshot);
  const [goal, setGoal] = useState('');
  const [error, setError] = useState('');
  const [isCreatingRun, setIsCreatingRun] = useState(false);
  const [isRunningWorkflow, setIsRunningWorkflow] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [activeChatTaskId, setActiveChatTaskId] = useState<string | null>(null);
  const [chatMessage, setChatMessage] = useState('');
  const [isCreatingVersion, setIsCreatingVersion] = useState(false);
  const [applyingVersionId, setApplyingVersionId] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  workspaceIdRef.current = workspace.id;

  const beginLoad = useCallback((workspaceId: string): WorkspaceOperationToken => {
    const revision = requestRef.current + 1;
    requestRef.current = revision;

    return {
      workspaceId,
      revision,
    };
  }, []);

  const beginMutation = useCallback((workspaceId: string): WorkspaceOperationToken => {
    const revision = mutationRef.current + 1;
    mutationRef.current = revision;

    return {
      workspaceId,
      revision,
    };
  }, []);

  const isLoadCurrent = useCallback((token: WorkspaceOperationToken): boolean =>
    isWorkspaceOperationCurrent(
      token,
      workspaceIdRef.current,
      requestRef.current,
      mountedRef.current,
    ), []);

  const isMutationCurrent = useCallback((token: WorkspaceOperationToken): boolean =>
    isWorkspaceOperationCurrent(
      token,
      workspaceIdRef.current,
      mutationRef.current,
      mountedRef.current,
    ), []);

  const loadSnapshot = useCallback(async (
    showLoading = true,
  ): Promise<EnterpriseLeadWorkspaceSnapshot | null> => {
    const token = beginLoad(workspace.id);
    if (showLoading) {
      setIsLoadingRun(true);
    }
    setError('');

    try {
      const nextSnapshot = await enterpriseLeadWorkspaceService.getRun(token.workspaceId);
      if (!isLoadCurrent(token)) {
        return null;
      }

      if (!nextSnapshot) {
        setError(i18nService.t('enterpriseLeadRunFailed'));
        return null;
      }

      setSnapshot(nextSnapshot);
      return nextSnapshot;
    } catch {
      if (isLoadCurrent(token)) {
        setError(i18nService.t('enterpriseLeadRunFailed'));
      }
      return null;
    } finally {
      if (isLoadCurrent(token) && showLoading) {
        setIsLoadingRun(false);
      }
    }
  }, [beginLoad, isLoadCurrent, workspace.id]);

  useEffect(() => {
    requestRef.current += 1;
    mutationRef.current += 1;
    setSnapshot(initialSnapshot ?? null);
    setError('');
    setIsLoadingRun(!hasInitialSnapshot);
    setIsCreatingRun(false);
    setIsRunningWorkflow(false);
    setRunningTaskId(null);
    setActiveChatTaskId(null);
    setChatMessage('');
    setIsCreatingVersion(false);
    setApplyingVersionId(null);
    setIsArchiving(false);
    if (!hasInitialSnapshot) {
      void loadSnapshot(true);
    }
  }, [hasInitialSnapshot, initialSnapshot, loadSnapshot, workspace.id]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      mutationRef.current += 1;
    };
  }, []);

  const currentRun = snapshot?.currentRun ?? null;
  const tasks = useMemo(() => snapshot?.tasks ?? [], [snapshot?.tasks]);
  const pendingVersions = snapshot?.pendingVersions ?? [];
  const todos = snapshot?.todos ?? [];
  const deliverables = snapshot?.deliverables ?? [];
  const archives = snapshot?.archives ?? [];
  const activeChatTask = useMemo(
    () => tasks.find(task => task.id === activeChatTaskId) ?? null,
    [activeChatTaskId, tasks],
  );
  const isArchived = currentRun?.archiveStatus === 'archived' ||
    currentRun?.status === EnterpriseLeadRunStatus.Archived;
  const isMutatingLocked = isArchived || isArchiving;
  const hasActiveConsoleMutation = Boolean(runningTaskId) ||
    isRunningWorkflow ||
    isCreatingVersion ||
    Boolean(applyingVersionId) ||
    isArchiving;
  const canSubmitGoal = goal.trim().length > 0 && !isCreatingRun;
  const canSubmitChat = chatMessage.trim().length > 0 &&
    !hasActiveConsoleMutation &&
    !isMutatingLocked;

  const handleCreateRun = async (): Promise<void> => {
    const trimmedGoal = goal.trim();
    if (!trimmedGoal || isCreatingRun) {
      return;
    }

    const token = beginMutation(workspace.id);
    setIsCreatingRun(true);
    setError('');

    try {
      const nextSnapshot = await enterpriseLeadWorkspaceService.createRun(
        token.workspaceId,
        trimmedGoal,
      );
      if (!isMutationCurrent(token)) {
        return;
      }

      if (!nextSnapshot) {
        setError(i18nService.t('enterpriseLeadRunFailed'));
        return;
      }

      setSnapshot(nextSnapshot);
      setGoal('');
    } catch {
      if (isMutationCurrent(token)) {
        setError(i18nService.t('enterpriseLeadRunFailed'));
      }
    } finally {
      if (isMutationCurrent(token)) {
        setIsCreatingRun(false);
      }
    }
  };

  const handleTaskRun = async (
    task: EnterpriseLeadAgentTask,
    action: AgentTaskRunAction,
  ): Promise<void> => {
    if (hasActiveConsoleMutation || isMutatingLocked) {
      return;
    }

    const token = beginMutation(workspace.id);
    setRunningTaskId(task.id);
    setError('');

    try {
      const updatedTask = action === AgentTaskRunAction.Rerun
        ? await enterpriseLeadWorkspaceService.rerunTask(task.id)
        : await enterpriseLeadWorkspaceService.runTask(task.id);
      if (!isMutationCurrent(token)) {
        return;
      }

      if (!updatedTask) {
        setError(i18nService.t('enterpriseLeadRunFailed'));
        return;
      }

      await loadSnapshot(false);
    } catch {
      if (isMutationCurrent(token)) {
        setError(i18nService.t('enterpriseLeadRunFailed'));
      }
    } finally {
      if (isMutationCurrent(token)) {
        setRunningTaskId(null);
      }
    }
  };

  const handleRunWorkflow = async (): Promise<void> => {
    if (!currentRun || hasActiveConsoleMutation || isMutatingLocked) {
      return;
    }

    const token = beginMutation(workspace.id);
    setIsRunningWorkflow(true);
    setError('');

    try {
      const nextSnapshot = await enterpriseLeadWorkspaceService.runWorkflow(
        token.workspaceId,
        currentRun.id,
      );
      if (!isMutationCurrent(token)) {
        return;
      }

      if (!nextSnapshot) {
        setError(i18nService.t('enterpriseLeadRunFailed'));
        return;
      }

      setSnapshot(nextSnapshot);
    } catch {
      if (isMutationCurrent(token)) {
        setError(i18nService.t('enterpriseLeadRunFailed'));
      }
    } finally {
      if (isMutationCurrent(token)) {
        setIsRunningWorkflow(false);
      }
    }
  };

  const handleOpenChat = (task: EnterpriseLeadAgentTask): void => {
    if (isMutatingLocked) {
      return;
    }

    setActiveChatTaskId(task.id);
    setChatMessage('');
    setError('');
  };

  const handleCreatePendingVersion = async (): Promise<void> => {
    const trimmedMessage = chatMessage.trim();
    if (!activeChatTask || !trimmedMessage || hasActiveConsoleMutation || isMutatingLocked) {
      return;
    }

    const token = beginMutation(workspace.id);
    setIsCreatingVersion(true);
    setError('');

    try {
      const pendingVersion = await enterpriseLeadWorkspaceService.createPendingVersion(
        activeChatTask.id,
        trimmedMessage,
      );
      if (!isMutationCurrent(token)) {
        return;
      }

      if (!pendingVersion) {
        setError(i18nService.t('enterpriseLeadChatFailed'));
        return;
      }

      setChatMessage('');
      setActiveChatTaskId(null);
      await loadSnapshot(false);
    } catch {
      if (isMutationCurrent(token)) {
        setError(i18nService.t('enterpriseLeadChatFailed'));
      }
    } finally {
      if (isMutationCurrent(token)) {
        setIsCreatingVersion(false);
      }
    }
  };

  const handleApplyVersion = async (pendingVersionId: string): Promise<void> => {
    if (hasActiveConsoleMutation || isMutatingLocked) {
      return;
    }

    const token = beginMutation(workspace.id);
    setApplyingVersionId(pendingVersionId);
    setError('');

    try {
      const nextSnapshot = await enterpriseLeadWorkspaceService.applyPendingVersion(
        pendingVersionId,
      );
      if (!isMutationCurrent(token)) {
        return;
      }

      if (!nextSnapshot) {
        setError(i18nService.t('enterpriseLeadApplyVersionFailed'));
        return;
      }

      setSnapshot(nextSnapshot);
    } catch {
      if (isMutationCurrent(token)) {
        setError(i18nService.t('enterpriseLeadApplyVersionFailed'));
      }
    } finally {
      if (isMutationCurrent(token)) {
        setApplyingVersionId(null);
      }
    }
  };

  const handleArchiveRun = async (): Promise<void> => {
    if (!currentRun || hasActiveConsoleMutation || isArchived) {
      return;
    }

    const token = beginMutation(workspace.id);
    setIsArchiving(true);
    setError('');

    try {
      const nextSnapshot = await enterpriseLeadWorkspaceService.archiveRun(
        token.workspaceId,
        currentRun.id,
      );
      if (!isMutationCurrent(token)) {
        return;
      }

      if (!nextSnapshot) {
        setError(i18nService.t('enterpriseLeadArchiveFailed'));
        return;
      }

      setSnapshot(nextSnapshot);
    } catch {
      if (isMutationCurrent(token)) {
        setError(i18nService.t('enterpriseLeadArchiveFailed'));
      }
    } finally {
      if (isMutationCurrent(token)) {
        setIsArchiving(false);
      }
    }
  };

  if (isLoadingRun && !snapshot) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-secondary shadow-sm">
        {i18nService.t('enterpriseLeadRunLoading')}
      </div>
    );
  }

  if (!currentRun) {
    return (
      <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
        <div className="max-w-2xl">
          <h2 className="text-base font-semibold text-foreground">
            {i18nService.t('enterpriseLeadNoRunTitle')}
          </h2>
          <p className="mt-2 text-sm leading-6 text-secondary">
            {i18nService.t('enterpriseLeadNoRunDesc')}
          </p>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-end">
          <textarea
            value={goal}
            onChange={event => setGoal(event.currentTarget.value)}
            rows={3}
            className="min-h-[92px] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground placeholder:text-secondary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder={i18nService.t('enterpriseLeadRunGoalPlaceholder')}
          />
          <button
            type="button"
            disabled={!canSubmitGoal}
            onClick={() => void handleCreateRun()}
            className={`${primaryButtonClassName} md:w-auto`}
          >
            {isCreatingRun && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
            {i18nService.t('enterpriseLeadStartRun')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-secondary">
            {i18nService.t('enterpriseLeadCurrentGoal')}
          </p>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-foreground">
            {currentRun.userGoal}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isArchived ? (
            <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircleIcon className="h-4 w-4" />
              {i18nService.t('enterpriseLeadArchived')}
            </span>
          ) : (
            <>
              <button
                type="button"
                disabled={hasActiveConsoleMutation || isMutatingLocked}
                onClick={() => void handleRunWorkflow()}
                className={primaryButtonClassName}
              >
                {isRunningWorkflow ? (
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <PlayIcon className="h-4 w-4" />
                )}
                {i18nService.t('enterpriseLeadRunWorkflow')}
              </button>
              <button
                type="button"
                disabled={hasActiveConsoleMutation}
                onClick={() => void handleArchiveRun()}
                className={secondaryButtonClassName}
              >
                {isArchiving ? (
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <ArchiveBoxIcon className="h-4 w-4" />
                )}
                {i18nService.t('enterpriseLeadArchiveRun')}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {tasks.map(task => (
              <AgentTaskCard
                key={task.id}
                task={task}
                isBusy={runningTaskId === task.id}
                disabled={isMutatingLocked || hasActiveConsoleMutation}
                onRun={(nextTask, action) => void handleTaskRun(nextTask, action)}
                onChat={handleOpenChat}
              />
            ))}
          </div>

          {activeChatTask && (
            <section className="rounded-lg border border-primary/30 bg-surface p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  {(() => {
                    const taskDisplay = getEnterpriseLeadTaskDisplay(activeChatTask);
                    return (
                      <>
                        <h2 className="text-base font-semibold text-foreground">
                          {i18nService.t('enterpriseLeadAgentChatTitle')}
                        </h2>
                        <p className="mt-1 text-sm text-secondary">
                          {displayText(taskDisplay.titleKey, taskDisplay.titleText)}
                        </p>
                      </>
                    );
                  })()}
                </div>
                <button
                  type="button"
                  onClick={() => setActiveChatTaskId(null)}
                  title={i18nService.t('cancel')}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>

              <textarea
                value={chatMessage}
                onChange={event => setChatMessage(event.currentTarget.value)}
                rows={4}
                className="mt-4 min-h-[120px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground placeholder:text-secondary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder={i18nService.t('enterpriseLeadAgentChatPlaceholder')}
              />

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setActiveChatTaskId(null)}
                  className={secondaryButtonClassName}
                >
                  {i18nService.t('cancel')}
                </button>
                <button
                  type="button"
                  disabled={!canSubmitChat}
                  onClick={() => void handleCreatePendingVersion()}
                  className={primaryButtonClassName}
                >
                  {isCreatingVersion ? (
                    <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  ) : (
                    <PaperAirplaneIcon className="h-4 w-4" />
                  )}
                  {i18nService.t('enterpriseLeadAgentGenerateVersion')}
                </button>
              </div>
            </section>
          )}
        </div>

        <WorkspaceSidePanel
          tasks={tasks}
          pendingVersions={pendingVersions}
          todos={todos}
          deliverables={deliverables}
          archives={archives}
          applyingVersionId={applyingVersionId}
          disabled={isMutatingLocked || hasActiveConsoleMutation}
          onApplyVersion={pendingVersionId => void handleApplyVersion(pendingVersionId)}
        />
      </div>
    </div>
  );
};

export default AgentWorkspaceConsole;
