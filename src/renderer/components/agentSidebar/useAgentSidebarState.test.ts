import { expect, test } from 'vitest';

import {
  type CoworkSessionStatus,
  CoworkSessionStatusValue,
  type CoworkSessionSummary,
} from '../../types/cowork';
import type { AgentSidebarAgentSummary } from './types';
import {
  collapseAgentSidebarTaskList,
  filterUserAgentSidebarAgents,
  removeAgentSidebarAgentTaskPreviews,
  removeAgentSidebarTaskPreviews,
  sortAgentSidebarAgents,
  sortAgentSidebarTasks,
  sortRecentConversationSessions,
} from './useAgentSidebarState';

const makeSession = (
  id: string,
  createdAt: number,
  updatedAt = createdAt,
  status: CoworkSessionStatus = CoworkSessionStatusValue.Completed,
  pinned = false,
  pinOrder: number | null = null,
): CoworkSessionSummary => ({
  id,
  title: id,
  status,
  pinned,
  pinOrder,
  agentId: 'main',
  createdAt,
  updatedAt,
});

const makeAgent = (
  id: string,
  pinned = false,
  pinOrder: number | null = null,
): AgentSidebarAgentSummary => ({
  id,
  name: id,
  icon: '',
  enabled: true,
  pinned,
  pinOrder,
});

test('sortAgentSidebarTasks keeps unpinned tasks ordered by last update time', () => {
  const sorted = sortAgentSidebarTasks([
    makeSession('newer-created-older-update', 300, 200),
    makeSession('older-created-newer-update', 100, 500, CoworkSessionStatusValue.Running),
    makeSession('middle', 200, 300),
  ]);

  expect(sorted.map((session) => session.id)).toEqual([
    'older-created-newer-update',
    'middle',
    'newer-created-older-update',
  ]);
});

test('sortAgentSidebarTasks keeps pinned tasks in first-pinned-first order', () => {
  const sorted = sortAgentSidebarTasks([
    makeSession('newer-unpinned', 100, 400),
    makeSession('second-pinned', 100, 200, CoworkSessionStatusValue.Completed, true, 2),
    makeSession('middle-unpinned', 200, 300),
    makeSession('first-pinned', 200, 100, CoworkSessionStatusValue.Completed, true, 1),
  ]);

  expect(sorted.map((session) => session.id)).toEqual([
    'first-pinned',
    'second-pinned',
    'newer-unpinned',
    'middle-unpinned',
  ]);
});

test('sortAgentSidebarAgents keeps pinned agents in first-pinned-first order', () => {
  const sorted = sortAgentSidebarAgents([
    makeAgent('regular'),
    makeAgent('second-pinned', true, 2),
    makeAgent('first-pinned', true, 1),
    makeAgent('another-regular'),
  ]);

  expect(sorted.map((agent) => agent.id)).toEqual([
    'first-pinned',
    'second-pinned',
    'regular',
    'another-regular',
  ]);
});

test('filterUserAgentSidebarAgents excludes the default main agent from My Agents', () => {
  const filtered = filterUserAgentSidebarAgents([
    makeAgent('main', true, 1),
    makeAgent('writer'),
    makeAgent('researcher'),
  ]);

  expect(filtered.map((agent) => agent.id)).toEqual(['writer', 'researcher']);
});

test('sortRecentConversationSessions ignores pins and keeps conversations ordered by global activity', () => {
  const sorted = sortRecentConversationSessions([
    {
      ...makeSession('older-pinned-agent-task', 100, 200, CoworkSessionStatusValue.Completed, true, 1),
      agentId: 'writer',
    },
    {
      ...makeSession('newest-main-conversation', 200, 500),
      agentId: 'main',
    },
    {
      ...makeSession('middle-agent-task', 300, 400),
      agentId: 'researcher',
    },
  ]);

  expect(sorted.map((session) => `${session.id}:${session.agentId}`)).toEqual([
    'newest-main-conversation:main',
    'middle-agent-task:researcher',
    'older-pinned-agent-task:writer',
  ]);
});

test('collapseAgentSidebarTaskList resets one agent history list to preview mode', () => {
  expect(collapseAgentSidebarTaskList(['agent-1', 'agent-2'], 'agent-1')).toEqual(['agent-2']);
});

test('removeAgentSidebarTaskPreviews removes selected tasks across loaded agents', () => {
  const previews = {
    'agent-1': [
      makeSession('keep-1', 100),
      makeSession('remove-1', 200),
    ],
    'agent-2': [
      makeSession('remove-2', 300),
      makeSession('keep-2', 400),
    ],
  };

  const next = removeAgentSidebarTaskPreviews(previews, ['remove-1', 'remove-2']);

  expect(next['agent-1'].map((session) => session.id)).toEqual(['keep-1']);
  expect(next['agent-2'].map((session) => session.id)).toEqual(['keep-2']);
});

test('removeAgentSidebarTaskPreviews preserves state when nothing matches', () => {
  const previews = {
    'agent-1': [makeSession('keep-1', 100)],
  };

  expect(removeAgentSidebarTaskPreviews(previews, ['missing'])).toBe(previews);
});

test('removeAgentSidebarAgentTaskPreviews clears cached tasks for one agent id', () => {
  const previews = {
    'agent-1': [makeSession('remove-1', 100)],
    'agent-2': [makeSession('keep-2', 200)],
  };

  const next = removeAgentSidebarAgentTaskPreviews(previews, 'agent-1');

  expect(next['agent-1']).toBeUndefined();
  expect(next['agent-2'].map((session) => session.id)).toEqual(['keep-2']);
});

test('removeAgentSidebarAgentTaskPreviews preserves state when agent cache is missing', () => {
  const previews = {
    'agent-1': [makeSession('keep-1', 100)],
  };

  expect(removeAgentSidebarAgentTaskPreviews(previews, 'missing-agent')).toBe(previews);
});
