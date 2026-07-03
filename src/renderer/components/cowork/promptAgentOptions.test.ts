import { expect, test } from 'vitest';

import { resolvePromptAgentSelectorState } from './promptAgentOptions';

const makeAgent = (id: string, enabled = true) => ({
  id,
  name: id === 'main' ? '主 Agent' : id,
  icon: '',
  enabled,
});

test('hides the prompt agent selector when only the default main agent exists', () => {
  const state = resolvePromptAgentSelectorState({
    agents: [makeAgent('main')],
    currentAgentId: 'main',
  });

  expect(state.shouldShowAgentSelector).toBe(false);
  expect(state.agentOptions).toEqual([]);
  expect(state.currentAgentForDisplay).toBeNull();
});

test('shows only user-created agents in the prompt agent selector', () => {
  const state = resolvePromptAgentSelectorState({
    agents: [makeAgent('main'), makeAgent('writer'), makeAgent('researcher')],
    currentAgentId: 'main',
  });

  expect(state.shouldShowAgentSelector).toBe(true);
  expect(state.agentOptions.map((agent) => agent.id)).toEqual(['writer', 'researcher']);
  expect(state.currentAgentForDisplay).toBeNull();
});

test('keeps the selected custom agent visible even when it is disabled', () => {
  const state = resolvePromptAgentSelectorState({
    agents: [makeAgent('main'), makeAgent('writer', false)],
    currentAgentId: 'writer',
  });

  expect(state.shouldShowAgentSelector).toBe(true);
  expect(state.agentOptions.map((agent) => agent.id)).toEqual(['writer']);
  expect(state.currentAgentForDisplay?.id).toBe('writer');
});
