import React from 'react';

import ComposeIcon from '../icons/ComposeIcon';
import SidebarToggleIcon from '../icons/SidebarToggleIcon';
import WindowTitleBar from '../window/WindowTitleBar';
import KitsManager from './KitsManager';

interface KitsViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
  onTryAsking?: (text: string, kitId: string) => void;
}

const KitsView: React.FC<KitsViewProps> = ({ isSidebarCollapsed, onToggleSidebar, onNewChat, updateBadge, onTryAsking }) => {
  const isMac = window.electron.platform === 'darwin';
  return (
    <div className="relative flex-1 flex flex-col bg-background h-full">
      <div className="draggable pointer-events-auto absolute left-80 right-32 top-0 z-20 h-10" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-11 items-center justify-between px-4">
        <div className="pointer-events-auto flex items-center space-x-3 h-8">
          {isSidebarCollapsed && (
            <div className={`non-draggable flex items-center gap-1 ${isMac ? 'pl-[68px]' : ''}`}>
              <button
                type="button"
                onClick={onToggleSidebar}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-secondary hover:bg-surface-raised transition-colors"
              >
                <SidebarToggleIcon className="h-4 w-4" isCollapsed={true} />
              </button>
              <button
                type="button"
                onClick={onNewChat}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-secondary hover:bg-surface-raised transition-colors"
              >
                <ComposeIcon className="h-4 w-4" />
              </button>
              {updateBadge}
            </div>
          )}
        </div>
        <WindowTitleBar inline className="pointer-events-auto" />
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 [scrollbar-gutter:stable]">
        <div className={`mx-auto w-full max-w-[1120px] px-6 pb-8 ${isSidebarCollapsed ? 'pt-14' : 'pt-6'}`}>
          <KitsManager onTryAsking={onTryAsking} />
        </div>
      </div>
    </div>
  );
};

export default KitsView;
