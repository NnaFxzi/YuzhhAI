import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import type { EnterpriseLeadWorkspace } from '../../../shared/enterpriseLeadWorkspace/types';
import { coworkService } from '../../services/cowork';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import type { CoworkSessionSummary } from '../../types/cowork';
import { CoworkView, type CoworkViewProps } from '../cowork';
import CoworkSearchModal from '../cowork/CoworkSearchModal';
import SidebarToggleIcon from '../icons/SidebarToggleIcon';
import WindowTitleBar from '../window/WindowTitleBar';
import {
  EnterpriseLeadWorkspaceInternalPage,
  type EnterpriseLeadWorkspaceInternalPage as EnterpriseLeadWorkspaceInternalPageType,
  EnterpriseLeadWorkspaceScreen,
  EnterpriseLeadWorkspaceShellMode,
  type EnterpriseLeadWorkspaceShellMode as EnterpriseLeadWorkspaceShellModeType,
  getDefaultWorkspaceInternalPage,
  getShellModeForEnterpriseLeadWorkspaceScreen,
  sortWorkspacesByRecentUpdate,
} from './enterpriseLeadWorkspaceUi';
import { buildEnterpriseLeadCoworkHandoffRequest } from './workspaceCoworkHandoff';
import {
  getWorkspaceSidebarActiveChatSessionId,
  openEmbeddedCoworkConversationRecord,
  selectWorkspaceCoworkSearchSession,
} from './workspaceCoworkSessionActions';
import { mapCoworkSessionsToEnterpriseLeadChatSessionSummaries } from './workspaceCoworkSessionRecords';
import WorkspaceCreate from './WorkspaceCreate';
import WorkspaceEntryHome from './WorkspaceEntryHome';
import WorkspaceKnowledgeBase from './WorkspaceKnowledgeBase';
import WorkspaceShell from './WorkspaceShell';
import WorkspaceStart from './WorkspaceStart';
import WorkspaceWorkbench from './WorkspaceWorkbench';

interface EnterpriseLeadWorkspaceViewProps {
  isSidebarCollapsed?: boolean;
  hideSidebarToggle?: boolean;
  onToggleSidebar?: () => void;
  onShellModeChange?: (shellMode: EnterpriseLeadWorkspaceShellModeType) => void;
  updateBadge?: React.ReactNode;
  onRequestAppSettings?: CoworkViewProps['onRequestAppSettings'];
  onPrepareCoworkChat: (draft: string) => void;
  onShowSkills?: () => void;
  onShowKits?: () => void;
}

export const EnterpriseLeadWorkspacePageTarget = {
  EmbeddedCoworkChat: 'embedded_cowork_chat',
  WorkspacePanel: 'workspace_panel',
} as const;

export type EnterpriseLeadWorkspacePageTarget =
  (typeof EnterpriseLeadWorkspacePageTarget)[keyof typeof EnterpriseLeadWorkspacePageTarget];

export interface EnterpriseLeadWorkspacePageRouting {
  target: EnterpriseLeadWorkspacePageTarget;
  usesDedicatedEnterpriseLeadChatSessions: boolean;
}

export const getEnterpriseLeadWorkspacePageRouting = (
  page: EnterpriseLeadWorkspaceInternalPageType,
): EnterpriseLeadWorkspacePageRouting => ({
  target:
    page === EnterpriseLeadWorkspaceInternalPage.AiChat
      ? EnterpriseLeadWorkspacePageTarget.EmbeddedCoworkChat
      : EnterpriseLeadWorkspacePageTarget.WorkspacePanel,
  usesDedicatedEnterpriseLeadChatSessions: false,
});

export const EnterpriseLeadWorkspaceView: React.FC<EnterpriseLeadWorkspaceViewProps> = ({
  isSidebarCollapsed,
  hideSidebarToggle = false,
  onToggleSidebar,
  onShellModeChange,
  updateBadge,
  onRequestAppSettings,
  onPrepareCoworkChat,
  onShowSkills,
  onShowKits,
}) => {
  const [screen, setScreen] = useState<EnterpriseLeadWorkspaceScreen>(
    EnterpriseLeadWorkspaceScreen.Entry,
  );
  const [workspaces, setWorkspaces] = useState<EnterpriseLeadWorkspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<EnterpriseLeadWorkspace | null>(null);
  const [activeInternalPage, setActiveInternalPage] =
    useState<EnterpriseLeadWorkspaceInternalPageType>(getDefaultWorkspaceInternalPage());
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  const [isWorkspaceSearchOpen, setIsWorkspaceSearchOpen] = useState(false);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(true);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceListError, setWorkspaceListError] = useState('');
  const navigationRevisionRef = useRef(0);
  const refreshRequestRef = useRef(0);
  const isMac = window.electron.platform === 'darwin';
  const shellMode = getShellModeForEnterpriseLeadWorkspaceScreen(screen);
  const coworkSessions = useSelector((state: RootState) => state.cowork.sessions);
  const currentCoworkSessionId = useSelector((state: RootState) => state.cowork.currentSessionId);

  useEffect(() => {
    onShellModeChange?.(shellMode);
  }, [onShellModeChange, shellMode]);

  const refreshWorkspaces = useCallback(async (preferredWorkspaceId?: string): Promise<void> => {
    const refreshRequest = refreshRequestRef.current + 1;
    refreshRequestRef.current = refreshRequest;
    const navigationRevision = navigationRevisionRef.current;

    setIsLoadingWorkspaces(true);
    setWorkspaceListError('');

    try {
      const nextWorkspaces = await enterpriseLeadWorkspaceService.listWorkspaces();
      const sortedWorkspaces = sortWorkspacesByRecentUpdate(nextWorkspaces);
      const isCurrentRefresh = refreshRequestRef.current === refreshRequest;
      const isSameNavigation = navigationRevisionRef.current === navigationRevision;

      if (isCurrentRefresh) {
        setWorkspaces(sortedWorkspaces);
      }

      if (preferredWorkspaceId && isSameNavigation) {
        setActiveWorkspace(null);
        setActiveWorkspaceId(preferredWorkspaceId);
        setActiveInternalPage(getDefaultWorkspaceInternalPage());
        setScreen(EnterpriseLeadWorkspaceScreen.Workspace);
      } else if (!preferredWorkspaceId && isSameNavigation) {
        setActiveWorkspace(null);
        setActiveWorkspaceId(null);
        setActiveInternalPage(getDefaultWorkspaceInternalPage());
        setScreen(EnterpriseLeadWorkspaceScreen.Entry);
      }
    } catch {
      const isCurrentRefresh = refreshRequestRef.current === refreshRequest;
      const isSameNavigation = navigationRevisionRef.current === navigationRevision;

      if (isCurrentRefresh) {
        setWorkspaces([]);
        setWorkspaceListError(i18nService.t('enterpriseLeadHistoryLoadFailed'));
      }

      if (!preferredWorkspaceId && isSameNavigation) {
        setActiveWorkspace(null);
        setActiveWorkspaceId(null);
        setScreen(EnterpriseLeadWorkspaceScreen.Entry);
      }
    } finally {
      if (refreshRequestRef.current === refreshRequest) {
        setIsLoadingWorkspaces(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  useEffect(() => {
    setActiveChatSessionId(null);
    setIsWorkspaceSearchOpen(false);
    void coworkService.loadSessions();
  }, [activeWorkspaceId]);

  useEffect(() => {
    let isCancelled = false;

    if (!activeWorkspaceId) {
      setActiveWorkspace(null);
      return () => {
        isCancelled = true;
      };
    }

    setIsLoadingWorkspace(true);
    setWorkspaceError('');

    enterpriseLeadWorkspaceService
      .getWorkspace(activeWorkspaceId)
      .then(workspace => {
        if (isCancelled) {
          return;
        }

        if (workspace) {
          setActiveWorkspace(workspace.id === activeWorkspaceId ? workspace : null);
          return;
        }

        setActiveWorkspace(workspaces.find(item => item.id === activeWorkspaceId) ?? null);
        setWorkspaceError(i18nService.t('enterpriseLeadWorkspaceLoadFailed'));
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setActiveWorkspace(workspaces.find(item => item.id === activeWorkspaceId) ?? null);
        setWorkspaceError(i18nService.t('enterpriseLeadWorkspaceLoadFailed'));
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingWorkspace(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [activeWorkspaceId, workspaces]);

  const handleCreate = (): void => {
    navigationRevisionRef.current += 1;
    setScreen(EnterpriseLeadWorkspaceScreen.Create);
  };

  const handleCancelCreate = (): void => {
    navigationRevisionRef.current += 1;
    setActiveWorkspace(null);
    setActiveWorkspaceId(null);
    setActiveChatSessionId(null);
    setWorkspaceError('');
    setActiveInternalPage(getDefaultWorkspaceInternalPage());
    setScreen(EnterpriseLeadWorkspaceScreen.Entry);
  };

  const handleOpen = (workspaceId: string): void => {
    navigationRevisionRef.current += 1;
    setActiveWorkspace(null);
    setWorkspaceError('');
    setActiveChatSessionId(null);
    setActiveWorkspaceId(workspaceId);
    setActiveInternalPage(getDefaultWorkspaceInternalPage());
    setScreen(EnterpriseLeadWorkspaceScreen.Workspace);
  };

  const handleCreated = (workspaceId: string): void => {
    navigationRevisionRef.current += 1;
    setActiveWorkspace(null);
    setWorkspaceError('');
    setActiveChatSessionId(null);
    setActiveWorkspaceId(workspaceId);
    setActiveInternalPage(getDefaultWorkspaceInternalPage());
    setScreen(EnterpriseLeadWorkspaceScreen.Workspace);
    void refreshWorkspaces(workspaceId);
  };

  const handleHistoryOpen = (): void => {
    void refreshWorkspaces();
  };

  const handleDeleteWorkspace = useCallback(
    async (workspaceId: string): Promise<boolean> => {
      const deleted = await enterpriseLeadWorkspaceService.deleteWorkspace(workspaceId);

      if (!deleted) {
        return false;
      }

      setWorkspaces(previous => previous.filter(item => item.id !== workspaceId));

      if (activeWorkspaceId === workspaceId) {
        navigationRevisionRef.current += 1;
        setActiveWorkspaceId(null);
        setActiveWorkspace(null);
        setActiveChatSessionId(null);
        setActiveInternalPage(getDefaultWorkspaceInternalPage());
        setScreen(EnterpriseLeadWorkspaceScreen.Entry);
      }

      return true;
    },
    [activeWorkspaceId],
  );

  const handleExitWorkspace = (): void => {
    navigationRevisionRef.current += 1;
    setActiveWorkspace(null);
    setActiveWorkspaceId(null);
    setActiveChatSessionId(null);
    setWorkspaceError('');
    setActiveInternalPage(getDefaultWorkspaceInternalPage());
    setScreen(EnterpriseLeadWorkspaceScreen.Entry);
  };

  const prepareEmbeddedCoworkChat = useCallback(
    (workspace: EnterpriseLeadWorkspace): void => {
      const request = buildEnterpriseLeadCoworkHandoffRequest(workspace);

      setActiveChatSessionId(null);
      setActiveInternalPage(request.nextInternalPage);
      onPrepareCoworkChat(request.draft);
    },
    [onPrepareCoworkChat],
  );

  const handleInternalPageChange = (
    page: EnterpriseLeadWorkspaceInternalPageType,
    workspaceForCowork: EnterpriseLeadWorkspace,
  ): void => {
    const pageRouting = getEnterpriseLeadWorkspacePageRouting(page);

    if (pageRouting.target === EnterpriseLeadWorkspacePageTarget.EmbeddedCoworkChat) {
      prepareEmbeddedCoworkChat(workspaceForCowork);
      return;
    }

    setActiveInternalPage(page);
  };

  const handleChatSessionSelect = useCallback((sessionId: string): void => {
    void openEmbeddedCoworkConversationRecord({
      sessionId,
      setActiveSessionId: setActiveChatSessionId,
      setActiveInternalPage,
      loadSession: selectedSessionId => coworkService.loadSession(selectedSessionId),
    });
  }, []);

  const visibleChatSessions = useMemo(
    () =>
      activeWorkspaceId
        ? mapCoworkSessionsToEnterpriseLeadChatSessionSummaries(coworkSessions, activeWorkspaceId)
        : [],
    [activeWorkspaceId, coworkSessions],
  );
  const visibleActiveChatSessionId = getWorkspaceSidebarActiveChatSessionId({
    activePage: activeInternalPage,
    activeChatSessionId,
  });

  const handleWorkspaceSearchSelect = useCallback(
    async (session: CoworkSessionSummary): Promise<void> => {
      await selectWorkspaceCoworkSearchSession({
        session,
        closeSearch: setIsWorkspaceSearchOpen,
        openConversationRecord: handleChatSessionSelect,
      });
    },
    [handleChatSessionSelect],
  );

  const handleChatSessionDelete = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const deleted = await coworkService.deleteSession(sessionId);
      if (deleted && activeChatSessionId === sessionId) {
        setActiveChatSessionId(null);
      }
      return deleted;
    },
    [activeChatSessionId],
  );

  const handleWorkspaceUpdated = (workspace: EnterpriseLeadWorkspace): void => {
    setActiveWorkspace(workspace);
    setWorkspaces(previous =>
      sortWorkspacesByRecentUpdate(
        previous.map(item => (item.id === workspace.id ? workspace : item)),
      ),
    );
  };

  const renderPreparingPanel = (page: EnterpriseLeadWorkspaceInternalPageType): React.ReactNode => {
    const pageLabels = {
      [EnterpriseLeadWorkspaceInternalPage.Workbench]: 'enterpriseLeadWorkbenchNavWorkbench',
      [EnterpriseLeadWorkspaceInternalPage.AiChat]: 'enterpriseLeadWorkbenchNavAiChat',
      [EnterpriseLeadWorkspaceInternalPage.Search]: 'enterpriseLeadWorkbenchNavSearch',
      [EnterpriseLeadWorkspaceInternalPage.KnowledgeBase]:
        'enterpriseLeadWorkbenchNavKnowledgeBase',
      [EnterpriseLeadWorkspaceInternalPage.CreationRecords]:
        'enterpriseLeadWorkbenchNavCreationRecords',
      [EnterpriseLeadWorkspaceInternalPage.AgentManagement]:
        'enterpriseLeadWorkbenchNavAgentManagement',
    } satisfies Record<EnterpriseLeadWorkspaceInternalPageType, string>;

    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-8">
        <section className="w-full max-w-xl rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
          <p className="text-xs font-semibold uppercase text-primary">
            {i18nService.t(pageLabels[page])}
          </p>
          <h2 className="mt-3 text-lg font-semibold text-foreground">
            {i18nService.t('enterpriseLeadWorkspacePagePreparingTitle')}
          </h2>
          <p className="mt-2 text-sm leading-6 text-secondary">
            {i18nService.t('enterpriseLeadWorkspacePagePreparingDescription')}
          </p>
        </section>
      </div>
    );
  };

  const renderWorkspaceInternalPage = (
    page: EnterpriseLeadWorkspaceInternalPageType,
    workspace: EnterpriseLeadWorkspace,
  ): React.ReactNode => {
    const pageRouting = getEnterpriseLeadWorkspacePageRouting(page);

    if (page === EnterpriseLeadWorkspaceInternalPage.Workbench) {
      return (
        <WorkspaceStart
          workspace={workspace}
          onOpenPage={nextPage => handleInternalPageChange(nextPage, workspace)}
        />
      );
    }

    if (page === EnterpriseLeadWorkspaceInternalPage.AgentManagement) {
      return (
        <WorkspaceWorkbench workspace={workspace} onWorkspaceUpdated={handleWorkspaceUpdated} />
      );
    }

    if (page === EnterpriseLeadWorkspaceInternalPage.KnowledgeBase) {
      return (
        <WorkspaceKnowledgeBase workspace={workspace} onWorkspaceUpdated={handleWorkspaceUpdated} />
      );
    }

    if (pageRouting.target === EnterpriseLeadWorkspacePageTarget.EmbeddedCoworkChat) {
      return (
        <CoworkView
          onRequestAppSettings={onRequestAppSettings}
          onShowSkills={onShowSkills}
          onShowKits={onShowKits}
          isSidebarCollapsed={false}
          onNewChat={() => prepareEmbeddedCoworkChat(workspace)}
        />
      );
    }

    return renderPreparingPanel(page);
  };

  const renderContent = (): React.ReactNode => {
    if (screen === EnterpriseLeadWorkspaceScreen.Create) {
      return <WorkspaceCreate onCreated={handleCreated} onCancel={handleCancelCreate} />;
    }

    if (screen === EnterpriseLeadWorkspaceScreen.Workspace && activeWorkspaceId) {
      const workspace =
        activeWorkspace?.id === activeWorkspaceId
          ? activeWorkspace
          : (workspaces.find(item => item.id === activeWorkspaceId) ?? null);

      return (
        <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
          {workspaceError && (
            <div className="border-b border-border bg-red-500/10 px-6 py-2 text-sm text-red-600 dark:text-red-300">
              {workspaceError}
            </div>
          )}
          {workspace && (
            <WorkspaceShell
              workspace={workspace}
              activePage={activeInternalPage}
              onPageChange={page => handleInternalPageChange(page, workspace)}
              onExitWorkspace={handleExitWorkspace}
              chatSessions={visibleChatSessions}
              activeChatSessionId={visibleActiveChatSessionId}
              onChatSessionSelect={handleChatSessionSelect}
              onChatSessionDelete={handleChatSessionDelete}
              onSearchOpen={() => setIsWorkspaceSearchOpen(true)}
            >
              {renderWorkspaceInternalPage(activeInternalPage, workspace)}
            </WorkspaceShell>
          )}
          {workspace && (
            <CoworkSearchModal
              isOpen={isWorkspaceSearchOpen}
              onClose={() => setIsWorkspaceSearchOpen(false)}
              sessions={coworkSessions}
              currentSessionId={currentCoworkSessionId}
              onSelectSession={handleWorkspaceSearchSelect}
            />
          )}
          {!workspace && isLoadingWorkspace && (
            <div className="flex min-h-full flex-1 items-center justify-center px-6 py-8 text-sm text-secondary">
              {i18nService.t('loading')}
            </div>
          )}
        </div>
      );
    }

    return (
      <WorkspaceEntryHome
        workspaces={workspaces}
        isLoadingWorkspaces={isLoadingWorkspaces}
        workspaceListError={workspaceListError}
        onCreate={handleCreate}
        onHistoryOpen={handleHistoryOpen}
        onOpen={handleOpen}
        onDeleteWorkspace={handleDeleteWorkspace}
        onRequestAppSettings={onRequestAppSettings}
      />
    );
  };

  if (!isSidebarCollapsed) {
    return <>{renderContent()}</>;
  }

  if (shellMode === EnterpriseLeadWorkspaceShellMode.Focused) {
    return (
      <div className="relative flex h-full min-h-0 flex-1 flex-col bg-background">
        <WindowTitleBar />
        <div className="min-h-0 flex-1 overflow-y-auto">{renderContent()}</div>
      </div>
    );
  }

  const headerWorkspace =
    activeWorkspace?.id === activeWorkspaceId
      ? activeWorkspace
      : (workspaces.find(item => item.id === activeWorkspaceId) ?? null);
  const headerTitle =
    screen === EnterpriseLeadWorkspaceScreen.Workspace && headerWorkspace?.name
      ? headerWorkspace.name
      : i18nService.t('enterpriseLeadNavLabel');

  return (
    <div className="flex h-full flex-1 flex-col bg-background">
      <div className="draggable flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex h-8 min-w-0 items-center space-x-3">
          <div className={`non-draggable flex items-center gap-1 ${isMac ? 'pl-[68px]' : ''}`}>
            {!hideSidebarToggle && (
              <button
                type="button"
                onClick={onToggleSidebar}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised"
                aria-label={i18nService.t('expand')}
              >
                <SidebarToggleIcon className="h-4 w-4" isCollapsed={true} />
              </button>
            )}
            {updateBadge}
          </div>
          {screen === EnterpriseLeadWorkspaceScreen.Workspace && (
            <button
              type="button"
              onClick={handleExitWorkspace}
              className="non-draggable inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
              aria-label={i18nService.t('enterpriseLeadWorkspaceExitToList')}
            >
              <ArrowLeftIcon className="h-4 w-4" />
            </button>
          )}
          <h1 className="truncate text-lg font-semibold text-foreground">{headerTitle}</h1>
        </div>
        <WindowTitleBar inline />
      </div>
      <div
        className={`min-h-0 flex-1 ${
          screen === EnterpriseLeadWorkspaceScreen.Workspace ? 'overflow-hidden' : 'overflow-y-auto'
        }`}
      >
        {renderContent()}
      </div>
    </div>
  );
};

export default EnterpriseLeadWorkspaceView;
