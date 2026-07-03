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

test('shows the default main option and user-created agents in the prompt agent selector', () => {
  const state = resolvePromptAgentSelectorState({
    agents: [makeAgent('main'), makeAgent('writer'), makeAgent('researcher')],
    currentAgentId: 'main',
  });

  expect(state.shouldShowAgentSelector).toBe(true);
  expect(state.agentOptions.map((agent) => agent.id)).toEqual(['main', 'writer', 'researcher']);
  expect(state.currentAgentForDisplay).toBeNull();
});

test('includes the default main agent so a custom agent can be deselected', () => {
  const state = resolvePromptAgentSelectorState({
    agents: [makeAgent('main'), makeAgent('writer')],
    currentAgentId: 'writer',
  });

  expect(state.shouldShowAgentSelector).toBe(true);
  expect(state.agentOptions.map((agent) => agent.id)).toEqual(['main', 'writer']);
  expect(state.agentOptions[0].name).toBe('不选择 Agent');
  expect(state.currentAgentForDisplay?.id).toBe('writer');
});

test('keeps the selected custom agent visible even when it is disabled', () => {
  const state = resolvePromptAgentSelectorState({
    agents: [makeAgent('main'), makeAgent('writer', false)],
    currentAgentId: 'writer',
  });

  expect(state.shouldShowAgentSelector).toBe(true);
  expect(state.agentOptions.map((agent) => agent.id)).toEqual(['main', 'writer']);
  expect(state.currentAgentForDisplay?.id).toBe('writer');
});
