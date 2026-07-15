import { describe, expect, test, vi } from 'vitest';

import { CoworkSessionStatusValue } from '../../types/cowork';
import { EnterpriseLeadWorkspaceInternalPage } from './enterpriseLeadWorkspaceUi';
import {
  getWorkspaceSidebarActiveChatSessionId,
  openEmbeddedCoworkConversationRecord,
  selectWorkspaceCoworkSearchSession,
} from './workspaceCoworkSessionActions';

describe('getWorkspaceSidebarActiveChatSessionId', () => {
  test('clears the highlighted conversation while the AI chat page is a new conversation', () => {
    expect(
      getWorkspaceSidebarActiveChatSessionId({
        activePage: EnterpriseLeadWorkspaceInternalPage.AiChat,
        activeChatSessionId: null,
      }),
    ).toBeNull();
  });

  test('keeps a selected conversation highlighted only while it is the active workspace chat record', () => {
    expect(
      getWorkspaceSidebarActiveChatSessionId({
        activePage: EnterpriseLeadWorkspaceInternalPage.AiChat,
        activeChatSessionId: 'cowork-session-1',
      }),
    ).toBe('cowork-session-1');
  });

  test('does not highlight a conversation on other workspace pages', () => {
    expect(
      getWorkspaceSidebarActiveChatSessionId({
        activePage: EnterpriseLeadWorkspaceInternalPage.Workbench,
        activeChatSessionId: 'cowork-session-1',
      }),
    ).toBeNull();
  });
});

describe('openEmbeddedCoworkConversationRecord', () => {
  test('activates the AI chat page and loads the selected Cowork session', async () => {
    const setActiveSessionId = vi.fn();
    const setActiveInternalPage = vi.fn();
    const discardHandoffDraft = vi.fn();
    const loadSession = vi.fn(async () => ({ id: 'cowork-session-1' }));

    await openEmbeddedCoworkConversationRecord({
      sessionId: 'cowork-session-1',
      setActiveSessionId,
      setActiveInternalPage,
      discardHandoffDraft,
      loadSession,
    });

    expect(discardHandoffDraft).toHaveBeenCalledBefore(loadSession);
    expect(setActiveSessionId).toHaveBeenCalledWith('cowork-session-1');
    expect(setActiveInternalPage).toHaveBeenCalledWith(EnterpriseLeadWorkspaceInternalPage.AiChat);
    expect(loadSession).toHaveBeenCalledWith('cowork-session-1');
  });

  test('clears active selection when the Cowork session cannot be loaded', async () => {
    const setActiveSessionId = vi.fn();

    await openEmbeddedCoworkConversationRecord({
      sessionId: 'missing-session',
      setActiveSessionId,
      setActiveInternalPage: vi.fn(),
      loadSession: vi.fn(async () => null),
    });

    expect(setActiveSessionId).toHaveBeenLastCalledWith(null);
  });
});

describe('selectWorkspaceCoworkSearchSession', () => {
  test('loads the Cowork session inside the workspace when embedded mode is active', async () => {
    const closeSearch = vi.fn();
    const openConversationRecord = vi.fn();

    await selectWorkspaceCoworkSearchSession({
      session: {
        id: 'cowork-session-1',
        title: '已保存对话',
        status: CoworkSessionStatusValue.Completed,
        pinned: false,
        createdAt: 1767225600000,
        updatedAt: 1767225600000,
      },
      closeSearch,
      openConversationRecord,
    });

    expect(closeSearch).toHaveBeenCalledWith(false);
    expect(openConversationRecord).toHaveBeenCalledWith('cowork-session-1');
  });

  test('keeps Cowork search selections inside the workspace without external navigation', async () => {
    const closeSearch = vi.fn();
    const openConversationRecord = vi.fn();
    const session = {
      id: 'cowork-session-2',
      title: '普通 Cowork 对话',
      status: CoworkSessionStatusValue.Completed,
      pinned: false,
      createdAt: 1767225600000,
      updatedAt: 1767225600000,
    };

    await selectWorkspaceCoworkSearchSession({
      session,
      closeSearch,
      openConversationRecord,
    });

    expect(closeSearch).toHaveBeenCalledWith(false);
    expect(openConversationRecord).toHaveBeenCalledWith('cowork-session-2');
  });
});
