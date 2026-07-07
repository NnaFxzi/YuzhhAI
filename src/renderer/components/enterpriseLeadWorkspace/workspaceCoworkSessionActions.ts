import type { CoworkSessionSummary } from '../../types/cowork';
import {
  EnterpriseLeadWorkspaceInternalPage,
  type EnterpriseLeadWorkspaceInternalPage as EnterpriseLeadWorkspaceInternalPageType,
} from './enterpriseLeadWorkspaceUi';

interface GetWorkspaceSidebarActiveChatSessionIdOptions {
  activePage: EnterpriseLeadWorkspaceInternalPageType;
  activeChatSessionId: string | null;
}

export const getWorkspaceSidebarActiveChatSessionId = ({
  activePage,
  activeChatSessionId,
}: GetWorkspaceSidebarActiveChatSessionIdOptions): string | null =>
  activePage === EnterpriseLeadWorkspaceInternalPage.AiChat ? activeChatSessionId : null;

interface OpenEmbeddedCoworkConversationRecordOptions {
  sessionId: string;
  setActiveSessionId: (sessionId: string | null) => void;
  setActiveInternalPage: (page: EnterpriseLeadWorkspaceInternalPageType) => void;
  loadSession: (sessionId: string) => Promise<unknown | null>;
}

export const openEmbeddedCoworkConversationRecord = async ({
  sessionId,
  setActiveSessionId,
  setActiveInternalPage,
  loadSession,
}: OpenEmbeddedCoworkConversationRecordOptions): Promise<void> => {
  setActiveSessionId(sessionId);
  setActiveInternalPage(EnterpriseLeadWorkspaceInternalPage.AiChat);

  const session = await loadSession(sessionId);
  if (!session) {
    setActiveSessionId(null);
  }
};

interface SelectWorkspaceCoworkSearchSessionOptions {
  session: CoworkSessionSummary;
  closeSearch: (isOpen: boolean) => void;
  openConversationRecord: (sessionId: string) => void;
}

export const selectWorkspaceCoworkSearchSession = async ({
  session,
  closeSearch,
  openConversationRecord,
}: SelectWorkspaceCoworkSearchSessionOptions): Promise<void> => {
  closeSearch(false);
  openConversationRecord(session.id);
};
