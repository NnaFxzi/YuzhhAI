import { describe, expect, test } from 'vitest';

import {
  CoworkWorkspaceAgentMode,
  type CoworkWorkspaceAgentSelection,
} from '../../../shared/cowork/workspaceAgentSelection';
import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { deriveWorkspaceAgentTeamChoices } from './workspaceAgentTeamOptions';

const binding = (
  agentId: string,
  name: string,
  order: number,
  enabled = true,
  extra: Partial<EnterpriseLeadWorkspaceAgentBinding> = {},
): EnterpriseLeadWorkspaceAgentBinding => ({
  agentId,
  enabled,
  order,
  overrides: {
    name,
    description: `${name} description`,
    icon: name.slice(0, 1),
    model: `${agentId}-model`,
    ...extra.overrides,
  },
  ...extra,
});

const workspaceWithAgents = (
  workspaceAgents: EnterpriseLeadWorkspaceAgentBinding[],
): EnterpriseLeadWorkspace =>
  ({
    id: 'workspace-1',
    name: 'Workspace One',
    workspaceAgents,
  }) as EnterpriseLeadWorkspace;

const manualSelection = (agentId: string): CoworkWorkspaceAgentSelection => ({
  workspaceId: 'workspace-1',
  mode: CoworkWorkspaceAgentMode.Manual,
  agentId,
});

describe('deriveWorkspaceAgentTeamChoices', () => {
  test('derives automatic selection plus enabled workspace agent choices in order', () => {
    const result = deriveWorkspaceAgentTeamChoices(
      workspaceWithAgents([
        binding('risk_review', 'Risk Agent', 20),
        binding('content_planning', 'Content Agent', 10),
        binding('disabled', 'Disabled Agent', 30, false),
      ]),
      null,
    );

    expect(result.shouldShow).toBe(true);
    expect(result.selection).toEqual({
      workspaceId: 'workspace-1',
      mode: CoworkWorkspaceAgentMode.Auto,
    });
    expect(result.choices.map(choice => choice.label)).toEqual(['Content Agent', 'Risk Agent']);
    expect(result.selectedChoice).toBeNull();
  });

  test('keeps an enabled manual selection selected', () => {
    const result = deriveWorkspaceAgentTeamChoices(
      workspaceWithAgents([
        binding('controller', 'Controller Agent', 0),
        binding('risk_review', 'Risk Agent', 1),
      ]),
      manualSelection('risk_review'),
    );

    expect(result.selection).toEqual(manualSelection('risk_review'));
    expect(result.selectedChoice?.label).toBe('Risk Agent');
  });

  test('falls back to automatic selection when manual target is disabled', () => {
    const result = deriveWorkspaceAgentTeamChoices(
      workspaceWithAgents([
        binding('controller', 'Controller Agent', 0),
        binding('risk_review', 'Risk Agent', 1, false),
      ]),
      manualSelection('risk_review'),
    );

    expect(result.selection).toEqual({
      workspaceId: 'workspace-1',
      mode: CoworkWorkspaceAgentMode.Auto,
    });
    expect(result.selectedChoice).toBeNull();
    expect(result.choices.map(choice => choice.id)).toEqual(['controller']);
  });

  test('hides the selector when no enabled workspace agents exist', () => {
    const result = deriveWorkspaceAgentTeamChoices(
      workspaceWithAgents([binding('disabled', 'Disabled Agent', 0, false)]),
      null,
    );

    expect(result.shouldShow).toBe(false);
    expect(result.selection).toBeNull();
    expect(result.choices).toEqual([]);
  });
});
