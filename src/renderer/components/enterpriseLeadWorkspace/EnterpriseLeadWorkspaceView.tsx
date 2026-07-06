import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceChatSessionSummary,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
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
import WorkspaceAiChat from './WorkspaceAiChat';
import WorkspaceCreate from './WorkspaceCreate';
import WorkspaceEntryHome from './WorkspaceEntryHome';
import WorkspaceKnowledgeBase from './WorkspaceKnowledgeBase';
import WorkspaceSearch from './WorkspaceSearch';
import WorkspaceSettings from './WorkspaceSettings';
import WorkspaceShell from './WorkspaceShell';
import WorkspaceStart from './WorkspaceStart';
import WorkspaceWorkbench from './WorkspaceWorkbench';

interface EnterpriseLeadWorkspaceViewProps {
  isSidebarCollapsed?: boolean;
  hideSidebarToggle?: boolean;
  onToggleSidebar?: () => void;
  onShellModeChange?: (shellMode: EnterpriseLeadWorkspaceShellModeType) => void;
  updateBadge?: React.ReactNode;
  onRequestAppSettings?: () => void;
}

export const EnterpriseLeadWorkspaceView: React.FC<EnterpriseLeadWorkspaceViewProps> = ({
  isSidebarCollapsed,
  hideSidebarToggle = false,
  onToggleSidebar,
  onShellModeChange,
  updateBadge,
  onRequestAppSettings,
}) => {
  const [screen, setScreen] = useState<EnterpriseLeadWorkspaceScreen>(
    EnterpriseLeadWorkspaceScreen.Entry,
  );
  const [workspaces, setWorkspaces] = useState<EnterpriseLeadWorkspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<EnterpriseLeadWorkspace | null>(null);
  const [activeInternalPage, setActiveInternalPage] = useState<EnterpriseLeadWorkspaceInternalPageType>(
    getDefaultWorkspaceInternalPage(),
  );
  const [chatSessions, setChatSessions] = useState<EnterpriseLeadWorkspaceChatSessionSummary[]>([]);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(true);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceListError, setWorkspaceListError] = useState('');
  const navigationRevisionRef = useRef(0);
  const refreshRequestRef = useRef(0);
  const chatSessionsRequestRef = useRef(0);
  const isMac = window.electron.platform === 'darwin';
  const shellMode = getShellModeForEnterpriseLeadWorkspaceScreen(screen);

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

  const refreshChatSessions = useCallback(async (workspaceId: string): Promise<void> => {
    const requestId = chatSessionsRequestRef.current + 1;
    chatSessionsRequestRef.current = requestId;

    try {
      const nextChatSessions = await enterpriseLeadWorkspaceService.listChatSessions(workspaceId);
      if (chatSessionsRequestRef.current === requestId) {
        setChatSessions(nextChatSessions);
      }
    } catch {
      if (chatSessionsRequestRef.current === requestId) {
        setChatSessions([]);
      }
    }
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId) {
      chatSessionsRequestRef.current += 1;
      setChatSessions([]);
      setActiveChatSessionId(null);
      return;
    }

    setActiveChatSessionId(null);
    void refreshChatSessions(activeWorkspaceId);
  }, [activeWorkspaceId, refreshChatSessions]);

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

    enterpriseLeadWorkspaceService.getWorkspace(activeWorkspaceId)
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
    setChatSessions([]);
    setActiveChatSessionId(null);
    setWorkspaceError('');
    setActiveInternalPage(getDefaultWorkspaceInternalPage());
    setScreen(EnterpriseLeadWorkspaceScreen.Entry);
  };

  const handleOpen = (workspaceId: string): void => {
    navigationRevisionRef.current += 1;
    setActiveWorkspace(null);
    setWorkspaceError('');
    setChatSessions([]);
    setActiveChatSessionId(null);
    setActiveWorkspaceId(workspaceId);
    setActiveInternalPage(getDefaultWorkspaceInternalPage());
    setScreen(EnterpriseLeadWorkspaceScreen.Workspace);
  };

  const handleCreated = (workspaceId: string): void => {
    navigationRevisionRef.current += 1;
    setActiveWorkspace(null);
    setWorkspaceError('');
    setChatSessions([]);
    setActiveChatSessionId(null);
    setActiveWorkspaceId(workspaceId);
    setActiveInternalPage(getDefaultWorkspaceInternalPage());
    setScreen(EnterpriseLeadWorkspaceScreen.Workspace);
    void refreshWorkspaces(workspaceId);
  };

  const handleHistoryOpen = (): void => {
    void refreshWorkspaces();
  };

  const handleDeleteWorkspace = useCallback(async (workspaceId: string): Promise<boolean> => {
    const deleted = await enterpriseLeadWorkspaceService.deleteWorkspace(workspaceId);

    if (!deleted) {
      return false;
    }

    setWorkspaces(previous => previous.filter(item => item.id !== workspaceId));

    if (activeWorkspaceId === workspaceId) {
      navigationRevisionRef.current += 1;
      setActiveWorkspaceId(null);
      setActiveWorkspace(null);
      setChatSessions([]);
      setActiveChatSessionId(null);
      setActiveInternalPage(getDefaultWorkspaceInternalPage());
      setScreen(EnterpriseLeadWorkspaceScreen.Entry);
    }

    return true;
  }, [activeWorkspaceId]);

  const handleExitWorkspace = (): void => {
    navigationRevisionRef.current += 1;
    setActiveWorkspace(null);
    setActiveWorkspaceId(null);
    setChatSessions([]);
    setActiveChatSessionId(null);
    setWorkspaceError('');
    setActiveInternalPage(getDefaultWorkspaceInternalPage());
    setScreen(EnterpriseLeadWorkspaceScreen.Entry);
  };

  const handleInternalPageChange = (page: EnterpriseLeadWorkspaceInternalPageType): void => {
    if (page === EnterpriseLeadWorkspaceInternalPage.AiChat) {
      setActiveChatSessionId(null);
    }
    setActiveInternalPage(page);
  };

  const handleChatSessionSelect = (sessionId: string): void => {
    setActiveChatSessionId(sessionId);
    setActiveInternalPage(EnterpriseLeadWorkspaceInternalPage.AiChat);
  };

  const handleChatSessionDelete = useCallback(async (sessionId: string): Promise<boolean> => {
    if (!activeWorkspaceId) {
      return false;
    }

    const deleted = await enterpriseLeadWorkspaceService.deleteChatSession(
      activeWorkspaceId,
      sessionId,
    );
    if (!deleted) {
      return false;
    }

    setChatSessions(previous => previous.filter(session => session.id !== sessionId));
    if (activeChatSessionId === sessionId) {
      setActiveChatSessionId(null);
    }
    return true;
  }, [activeChatSessionId, activeWorkspaceId]);

  const handleChatSessionsUpdated = (): void => {
    if (activeWorkspaceId) {
      void refreshChatSessions(activeWorkspaceId);
    }
  };

  const handleWorkspaceUpdated = (workspace: EnterpriseLeadWorkspace): void => {
    setActiveWorkspace(workspace);
    setWorkspaces(previous => sortWorkspacesByRecentUpdate(
      previous.map(item => (item.id === workspace.id ? workspace : item)),
    ));
  };

  const renderPreparingPanel = (
    page: EnterpriseLeadWorkspaceInternalPageType,
  ): React.ReactNode => {
    const pageLabels = {
      [EnterpriseLeadWorkspaceInternalPage.Workbench]: 'enterpriseLeadWorkbenchNavWorkbench',
      [EnterpriseLeadWorkspaceInternalPage.AiChat]: 'enterpriseLeadWorkbenchNavAiChat',
      [EnterpriseLeadWorkspaceInternalPage.Search]: 'enterpriseLeadWorkbenchNavSearch',
      [EnterpriseLeadWorkspaceInternalPage.KnowledgeBase]: 'enterpriseLeadWorkbenchNavKnowledgeBase',
      [EnterpriseLeadWorkspaceInternalPage.CreationRecords]: 'enterpriseLeadWorkbenchNavCreationRecords',
      [EnterpriseLeadWorkspaceInternalPage.AgentManagement]: 'enterpriseLeadWorkbenchNavAgentManagement',
      [EnterpriseLeadWorkspaceInternalPage.Settings]: 'enterpriseLeadWorkbenchNavSettings',
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
    if (page === EnterpriseLeadWorkspaceInternalPage.Workbench) {
      return (
        <WorkspaceStart
          workspace={workspace}
          onOpenPage={handleInternalPageChange}
        />
      );
    }

    if (page === EnterpriseLeadWorkspaceInternalPage.AgentManagement) {
      return (
        <WorkspaceWorkbench
          workspace={workspace}
          onWorkspaceUpdated={handleWorkspaceUpdated}
          onOpenSettings={() => setActiveInternalPage(EnterpriseLeadWorkspaceInternalPage.Settings)}
        />
      );
    }

    if (page === EnterpriseLeadWorkspaceInternalPage.Settings) {
      return (
        <WorkspaceSettings
          workspace={workspace}
          onWorkspaceUpdated={handleWorkspaceUpdated}
        />
      );
    }

    if (page === EnterpriseLeadWorkspaceInternalPage.KnowledgeBase) {
      return (
        <WorkspaceKnowledgeBase
          workspace={workspace}
          onWorkspaceUpdated={handleWorkspaceUpdated}
        />
      );
    }

    if (page === EnterpriseLeadWorkspaceInternalPage.Search) {
      return (
        <WorkspaceSearch
          workspace={workspace}
          chatSessions={chatSessions}
          onChatSessionSelect={handleChatSessionSelect}
        />
      );
    }

    if (page === EnterpriseLeadWorkspaceInternalPage.AiChat) {
      return (
        <WorkspaceAiChat
          workspace={workspace}
          activeSessionId={activeChatSessionId}
          onSessionChange={setActiveChatSessionId}
          onSessionsUpdated={handleChatSessionsUpdated}
        />
      );
    }

    return renderPreparingPanel(page);
  };

  const renderContent = (): React.ReactNode => {
    if (screen === EnterpriseLeadWorkspaceScreen.Create) {
      return (
        <WorkspaceCreate
          onCreated={handleCreated}
          onCancel={handleCancelCreate}
        />
      );
    }

    if (screen === EnterpriseLeadWorkspaceScreen.Workspace && activeWorkspaceId) {
      const workspace = activeWorkspace?.id === activeWorkspaceId
        ? activeWorkspace
        : workspaces.find(item => item.id === activeWorkspaceId) ?? null;

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
              onPageChange={handleInternalPageChange}
              onExitWorkspace={handleExitWorkspace}
              chatSessions={chatSessions}
              activeChatSessionId={
                activeInternalPage === EnterpriseLeadWorkspaceInternalPage.AiChat
                  ? activeChatSessionId
                  : null
              }
              onChatSessionSelect={handleChatSessionSelect}
              onChatSessionDelete={handleChatSessionDelete}
            >
              {renderWorkspaceInternalPage(activeInternalPage, workspace)}
            </WorkspaceShell>
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
        <div className="min-h-0 flex-1 overflow-y-auto">
          {renderContent()}
        </div>
      </div>
    );
  }

  const headerWorkspace = activeWorkspace?.id === activeWorkspaceId
    ? activeWorkspace
    : workspaces.find(item => item.id === activeWorkspaceId) ?? null;
  const headerTitle = screen === EnterpriseLeadWorkspaceScreen.Workspace && headerWorkspace?.name
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
          <h1 className="truncate text-lg font-semibold text-foreground">
            {headerTitle}
          </h1>
        </div>
        <WindowTitleBar inline />
      </div>
      <div
        className={`min-h-0 flex-1 ${
          screen === EnterpriseLeadWorkspaceScreen.Workspace
            ? 'overflow-hidden'
            : 'overflow-y-auto'
        }`}
      >
        {renderContent()}
      </div>
    </div>
  );
};

export default EnterpriseLeadWorkspaceView;
