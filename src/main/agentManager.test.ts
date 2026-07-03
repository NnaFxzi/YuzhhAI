import { describe, expect, test } from 'vitest';

import { AgentManager } from './agentManager';
import type { Agent, CoworkStore, CreateAgentRequest, UpdateAgentRequest } from './coworkStore';

const MARKETING_AGENT_ID = 'marketing-agent';

const createStoredAgent = (overrides: Partial<Agent> = {}): Agent => {
  const now = Date.now();
  return {
    id: MARKETING_AGENT_ID,
    name: '推广agent',
    description: '',
    systemPrompt: '旧版推广提示词',
    identity: '',
    model: 'provider/model',
    workingDirectory: '/tmp/project',
    icon: '',
    skillIds: [],
    enabled: true,
    pinned: true,
    pinOrder: 1,
    isDefault: false,
    source: 'preset',
    presetId: MARKETING_AGENT_ID,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};

class FakeCoworkStore {
  private agents: Agent[];
  private hiddenManagedPresetAgentIds = new Set<string>();

  constructor(initialAgents: Agent[] = []) {
    this.agents = [...initialAgents];
  }

  listAgents(): Agent[] {
    return [...this.agents];
  }

  getAgent(id: string): Agent | null {
    return this.agents.find((agent) => agent.id === id) ?? null;
  }

  createAgent(request: CreateAgentRequest): Agent {
    const now = Date.now();
    const agent: Agent = {
      id: request.id ?? `agent-${this.agents.length + 1}`,
      name: request.name,
      description: request.description ?? '',
      systemPrompt: request.systemPrompt ?? '',
      identity: request.identity ?? '',
      model: request.model ?? '',
      workingDirectory: request.workingDirectory ?? '',
      icon: request.icon ?? '',
      skillIds: request.skillIds ?? [],
      enabled: true,
      pinned: false,
      pinOrder: null,
      isDefault: false,
      source: request.source ?? 'custom',
      presetId: request.presetId ?? '',
      createdAt: now,
      updatedAt: now,
    };
    this.agents.push(agent);
    return agent;
  }

  updateAgent(id: string, updates: UpdateAgentRequest): Agent | null {
    const index = this.agents.findIndex((agent) => agent.id === id);
    if (index < 0) return null;
    this.agents[index] = { ...this.agents[index], ...updates, updatedAt: Date.now() };
    return this.agents[index];
  }

  deleteAgent(id: string): boolean {
    const before = this.agents.length;
    this.agents = this.agents.filter((agent) => agent.id !== id);
    return this.agents.length !== before;
  }

  isManagedPresetAgentHidden(id: string): boolean {
    return this.hiddenManagedPresetAgentIds.has(id);
  }

  markManagedPresetAgentHidden(id: string): void {
    this.hiddenManagedPresetAgentIds.add(id);
  }
}

describe('AgentManager managed preset agents', () => {
  test('listAgents auto-installs 推广agent when it has not existed before', () => {
    const store = new FakeCoworkStore();
    const manager = new AgentManager(store as unknown as CoworkStore);

    const agents = manager.listAgents();
    const marketingAgent = agents.find((agent) => agent.id === MARKETING_AGENT_ID);

    expect(marketingAgent).toMatchObject({
      id: MARKETING_AGENT_ID,
      name: '推广agent',
      source: 'preset',
      presetId: MARKETING_AGENT_ID,
      enabled: true,
    });
    expect(marketingAgent?.systemPrompt).toContain('不采用填表方式');
    expect(marketingAgent?.systemPrompt).toContain('缺少关键信息时');
  });

  test('推广agent prompt instructs memory-backed factory profile extraction and focused follow-up', () => {
    const store = new FakeCoworkStore();
    const manager = new AgentManager(store as unknown as CoworkStore);

    const marketingAgent = manager
      .listAgents()
      .find((agent) => agent.id === MARKETING_AGENT_ID);

    expect(marketingAgent?.systemPrompt).toContain('长期记忆');
    expect(marketingAgent?.systemPrompt).toContain('我记住了');
    expect(marketingAgent?.systemPrompt).toContain('不要重复追问已经记住的信息');
    expect(marketingAgent?.systemPrompt).toContain('地区、产品、客户行业、应用场景、卖点、渠道偏好');
    expect(marketingAgent?.systemPrompt).toContain('只追问最关键的 1-2 个问题');
    expect(marketingAgent?.systemPrompt).toContain('默认只维护一家工厂画像');
    expect(marketingAgent?.systemPrompt).toContain('本次任务临时要求');
    expect(marketingAgent?.systemPrompt).toContain('长期资料更新信号');
    expect(marketingAgent?.systemPrompt).toContain('原来记住的资料先保留');
    expect(marketingAgent?.systemPrompt).toContain('生成前用一句话确认');
    expect(marketingAgent?.systemPrompt).toContain('不要编造没有提供的硬事实');
    expect(marketingAgent?.systemPrompt).toContain('成本降幅、承重范围、合作年限、交期承诺、认证资质、服务区域');
  });

  test('listAgents does not duplicate 推广agent across repeated loads', () => {
    const store = new FakeCoworkStore();
    const manager = new AgentManager(store as unknown as CoworkStore);

    manager.listAgents();
    manager.listAgents();

    const marketingAgents = manager
      .listAgents()
      .filter((agent) => agent.id === MARKETING_AGENT_ID);
    expect(marketingAgents).toHaveLength(1);
  });

  test('deleteAgent prevents 推广agent from being auto-restored after manager reload', () => {
    const store = new FakeCoworkStore();
    const manager = new AgentManager(store as unknown as CoworkStore);

    expect(manager.listAgents().some((agent) => agent.id === MARKETING_AGENT_ID)).toBe(true);
    expect(manager.deleteAgent(MARKETING_AGENT_ID)).toBe(true);

    const reloadedManager = new AgentManager(store as unknown as CoworkStore);
    expect(reloadedManager.listAgents().some((agent) => agent.id === MARKETING_AGENT_ID)).toBe(false);
  });

  test('listAgents refreshes an existing managed 推广agent to the latest prompt without changing user runtime fields', () => {
    const store = new FakeCoworkStore([createStoredAgent()]);
    const manager = new AgentManager(store as unknown as CoworkStore);

    const marketingAgent = manager
      .listAgents()
      .find((agent) => agent.id === MARKETING_AGENT_ID);

    expect(marketingAgent?.systemPrompt).toContain('长期记忆');
    expect(marketingAgent?.model).toBe('provider/model');
    expect(marketingAgent?.workingDirectory).toBe('/tmp/project');
    expect(marketingAgent?.pinned).toBe(true);
    expect(marketingAgent?.pinOrder).toBe(1);
  });
});
