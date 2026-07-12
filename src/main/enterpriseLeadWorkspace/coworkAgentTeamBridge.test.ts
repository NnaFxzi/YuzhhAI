import { describe, expect, test } from 'vitest';

import {
  CoworkWorkspaceAgentMode,
  type CoworkWorkspaceAgentSelection,
} from '../../shared/cowork/workspaceAgentSelection';
import { EnterpriseLeadAgentRole } from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
} from '../../shared/enterpriseLeadWorkspace/types';
import { buildCoworkWorkspaceAgentTeamPrompt } from './coworkAgentTeamBridge';

const agentBinding = (
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
    identity: `${name} identity`,
    systemPrompt: `${name} system prompt`,
    icon: name.slice(0, 1),
    model: `${agentId}-model`,
    skillIds: [`${agentId}-skill`],
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

const selection = (
  mode: CoworkWorkspaceAgentSelection['mode'],
  agentId?: string,
): CoworkWorkspaceAgentSelection => ({
  workspaceId: 'workspace-1',
  mode,
  ...(agentId ? { agentId } : {}),
});

describe('buildCoworkWorkspaceAgentTeamPrompt', () => {
  test('builds automatic routing context from enabled workspace agents in order', () => {
    const prompt = buildCoworkWorkspaceAgentTeamPrompt({
      workspace: workspaceWithAgents([
        agentBinding('risk_review', 'Risk Agent', 20),
        agentBinding('content_planning', 'Content Agent', 10),
        agentBinding('disabled_agent', 'Disabled Agent', 30, false),
      ]),
      selection: selection(CoworkWorkspaceAgentMode.Auto),
    });

    expect(prompt).toContain('Cowork workspace Agent team context');
    expect(prompt).toContain('Routing mode: auto');
    expect(prompt).toMatch(/Content Agent[\s\S]+Risk Agent/);
    expect(prompt).not.toContain('Disabled Agent');
  });

  test('marks an enabled manual workspace agent as the target', () => {
    const prompt = buildCoworkWorkspaceAgentTeamPrompt({
      workspace: workspaceWithAgents([
        agentBinding('controller', 'Controller Agent', 0),
        agentBinding('risk_review', 'Risk Agent', 1),
      ]),
      selection: selection(CoworkWorkspaceAgentMode.Manual, 'risk_review'),
    });

    expect(prompt).toContain('Routing mode: manual');
    expect(prompt).toContain('Manual target Agent: Risk Agent');
    expect(prompt).toMatch(/Risk Agent \(target\)/);
  });

  test('keeps Cowork role routing distinct from executed promotion workflows', () => {
    const prompt = buildCoworkWorkspaceAgentTeamPrompt({
      workspace: workspaceWithAgents([
        agentBinding('controller', 'Controller Agent', 0),
      ]),
      selection: selection(CoworkWorkspaceAgentMode.Auto),
    });

    expect(prompt).toContain('Auto/manual selection only routes the current Cowork turn');
    expect(prompt).toContain('complete promotion plan, bulk lead generation, or ongoing monitoring');
    expect(prompt).toContain('workflow run page');
    expect(prompt).toContain('Workflow Event or an OpenClaw child-session event');
  });

  test('falls back to automatic routing when a manual target is unavailable', () => {
    const prompt = buildCoworkWorkspaceAgentTeamPrompt({
      workspace: workspaceWithAgents([
        agentBinding('controller', 'Controller Agent', 0),
        agentBinding('risk_review', 'Risk Agent', 1, false),
      ]),
      selection: selection(CoworkWorkspaceAgentMode.Manual, 'risk_review'),
    });

    expect(prompt).toContain('Routing mode: auto');
    expect(prompt).not.toContain('Manual target Agent');
    expect(prompt).not.toContain('Risk Agent');
  });

  test('returns null when workspace id does not match the selection', () => {
    const prompt = buildCoworkWorkspaceAgentTeamPrompt({
      workspace: workspaceWithAgents([agentBinding('controller', 'Controller Agent', 0)]),
      selection: {
        workspaceId: 'other-workspace',
        mode: CoworkWorkspaceAgentMode.Auto,
      },
    });

    expect(prompt).toBeNull();
  });

  test('bounds long workspace agent fields', () => {
    const longText = 'x'.repeat(1_500);
    const prompt = buildCoworkWorkspaceAgentTeamPrompt({
      workspace: workspaceWithAgents([
        agentBinding('content_planning', 'Content Agent', 0, true, {
          overrides: {
            description: longText,
            identity: longText,
            systemPrompt: longText,
          },
        }),
      ]),
      selection: selection(CoworkWorkspaceAgentMode.Auto),
    });

    expect(prompt).not.toContain(longText);
    expect(prompt).toContain('...');
  });

  test('adds video handoff guidance for the content planning agent', () => {
    const prompt = buildCoworkWorkspaceAgentTeamPrompt({
      workspace: workspaceWithAgents([
        agentBinding(EnterpriseLeadAgentRole.ContentPlanning, '内容策划 Agent', 0),
      ]),
      selection: selection(
        CoworkWorkspaceAgentMode.Manual,
        EnterpriseLeadAgentRole.ContentPlanning,
      ),
    });

    expect(prompt).toContain('是否需要继续生成视频');
    expect(prompt).toContain('如果需要，我可以继续把这版脚本整理成视频生成提示词');
  });
});
