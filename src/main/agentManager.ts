import { AgentId, normalizeAgentResponseContract } from '../shared/agent';
import { ManagedPresetAgentId } from '../shared/agent/managedPresetAgents';
import type { Agent, CoworkStore, CreateAgentRequest, UpdateAgentRequest } from './coworkStore';
import {
  AUTO_INSTALLED_PRESET_AGENT_IDS,
  PRESET_AGENTS,
  type PresetAgent,
  presetToCreateRequest,
} from './presetAgents';

interface ManagedPresetVisibilityStore {
  isManagedPresetAgentHidden?: (id: string) => boolean;
  clearManagedPresetAgentHidden?: (id: string) => void;
}

const AUTO_INSTALLED_PRESET_AGENT_ID_SET = new Set<string>(AUTO_INSTALLED_PRESET_AGENT_IDS);
const GLOBAL_AGENT_CREATE_ERROR =
  'Global Agent creation is limited to built-in system Agents. Use addPresetAgent for system Agents or create workspace Agents inside a workspace.';
const SYSTEM_AGENT_DEFINITION_UPDATE_ERROR =
  'System Agent definition fields are managed by LobsterAI. Only model, workingDirectory, enabled, and pinned can be updated.';
const SYSTEM_AGENT_RUNTIME_UPDATE_KEYS = new Set<keyof UpdateAgentRequest>([
  'model',
  'workingDirectory',
  'enabled',
  'pinned',
]);
const CONTENT_AUTO_ROUTE_PATTERNS = [
  '小红书',
  '朋友圈',
  '公众号',
  '微信群',
  '社群',
  '私域',
  '私聊',
  '私信',
  '话术',
  '销售回复',
  '销售话术',
  '推广文案',
  '营销文案',
  '活动文案',
  '海报文案',
  '种草',
  '选题',
  '短视频',
  '口播',
  '分镜',
  '抖音',
  '视频号',
  '改自然',
  '去ai味',
  'ai味',
  '润色',
  '改写',
];

const isSystemAgent = (agent: Agent): boolean =>
  agent.id === AgentId.Main || agent.isDefault || agent.source === 'preset';

const normalizeAutoRouteText = (value: string): string =>
  value.replace(/\s+/g, '').trim().toLowerCase();

const isContentAutoRouteRequest = (prompt: string): boolean => {
  const normalizedPrompt = normalizeAutoRouteText(prompt);
  if (!normalizedPrompt) {
    return false;
  }

  return CONTENT_AUTO_ROUTE_PATTERNS.some(pattern =>
    normalizedPrompt.includes(normalizeAutoRouteText(pattern)),
  );
};

const getSystemAgentDefinitionUpdateKeys = (updates: UpdateAgentRequest): string[] =>
  Object.keys(updates).filter(
    key => !SYSTEM_AGENT_RUNTIME_UPDATE_KEYS.has(key as keyof UpdateAgentRequest),
  );

/**
 * AgentManager handles CRUD operations for agents and preset agent installation.
 * Agents are stored in the SQLite `agents` table via CoworkStore.
 */
export class AgentManager {
  private store: CoworkStore;

  constructor(store: CoworkStore) {
    this.store = store;
  }

  listAgents(): Agent[] {
    this.ensureAutoInstalledPresetAgents();
    return this.store.listAgents();
  }

  getAgent(agentId: string): Agent | null {
    if (AUTO_INSTALLED_PRESET_AGENT_ID_SET.has(agentId)) {
      this.ensureAutoInstalledPresetAgents();
    }
    return this.store.getAgent(agentId);
  }

  getDefaultAgent(): Agent {
    const agents = this.store.listAgents();
    return agents.find(a => a.isDefault) || agents[0];
  }

  resolveRuntimeAgent(agentId?: string): Agent {
    const requestedAgentId = agentId?.trim() || AgentId.Main;
    const requestedAgent = this.getAgent(requestedAgentId);
    if (requestedAgent?.enabled) {
      return requestedAgent;
    }

    return this.getAgent(AgentId.Main) ?? this.getDefaultAgent();
  }

  resolveRuntimeAgentForPrompt(agentId: string | undefined, prompt: string): Agent {
    const runtimeAgent = this.resolveRuntimeAgent(agentId);
    if (runtimeAgent.id !== AgentId.Main || !isContentAutoRouteRequest(prompt)) {
      return runtimeAgent;
    }

    return this.resolveRuntimeAgent(ManagedPresetAgentId.Marketing);
  }

  createAgent(_request: CreateAgentRequest, _defaultModel?: string): Agent {
    throw new Error(GLOBAL_AGENT_CREATE_ERROR);
  }

  updateAgent(agentId: string, updates: UpdateAgentRequest): Agent | null {
    const existing = this.store.getAgent(agentId);
    if (!existing) return null;

    if (isSystemAgent(existing)) {
      const definitionUpdateKeys = getSystemAgentDefinitionUpdateKeys(updates);
      if (definitionUpdateKeys.length > 0) {
        throw new Error(
          `${SYSTEM_AGENT_DEFINITION_UPDATE_ERROR} Rejected fields: ${definitionUpdateKeys.join(', ')}.`,
        );
      }
    }

    return this.store.updateAgent(agentId, {
      ...updates,
      ...(updates.workingDirectory !== undefined
        ? { workingDirectory: updates.workingDirectory.trim() }
        : {}),
    });
  }

  deleteAgent(agentId: string): boolean {
    if (AUTO_INSTALLED_PRESET_AGENT_ID_SET.has(agentId)) {
      this.ensureAutoInstalledPresetAgents();
      this.getVisibilityStore().clearManagedPresetAgentHidden?.(agentId);
      return false;
    }

    const deleted = this.store.deleteAgent(agentId);
    return deleted;
  }

  // --- Preset agents ---

  getPresetAgents(): PresetAgent[] {
    this.ensureAutoInstalledPresetAgents();
    const existingAgents = this.store.listAgents();
    const existingPresetIds = new Set(
      existingAgents.filter(a => a.source === 'preset').map(a => a.presetId),
    );
    // Only return presets that haven't been added yet
    return PRESET_AGENTS.filter(p => !existingPresetIds.has(p.id));
  }

  getAllPresetAgents(): PresetAgent[] {
    return PRESET_AGENTS;
  }

  addPresetAgent(presetId: string, defaultModel?: string): Agent | null {
    const preset = PRESET_AGENTS.find(p => p.id === presetId);
    if (!preset) return null;

    // Check if already installed
    const existing = this.store.getAgent(preset.id);
    if (existing) {
      this.getVisibilityStore().clearManagedPresetAgentHidden?.(presetId);
      if (!existing.enabled) {
        return this.store.updateAgent(existing.id, { enabled: true });
      }
      return existing;
    }

    this.getVisibilityStore().clearManagedPresetAgentHidden?.(presetId);

    return this.store.createAgent({
      ...presetToCreateRequest(preset),
      model: defaultModel?.trim() || '',
      workingDirectory: '',
    });
  }

  private ensureAutoInstalledPresetAgents(): void {
    for (const presetId of AUTO_INSTALLED_PRESET_AGENT_IDS) {
      const preset = PRESET_AGENTS.find(p => p.id === presetId);
      if (!preset) continue;

      const existing = this.store.getAgent(presetId);
      if (existing) {
        this.refreshManagedPresetAgent(existing, preset);
        continue;
      }

      if (this.getVisibilityStore().isManagedPresetAgentHidden?.(presetId) === true) {
        this.getVisibilityStore().clearManagedPresetAgentHidden?.(presetId);
      }

      this.store.createAgent({
        ...presetToCreateRequest(preset),
        model: '',
        workingDirectory: '',
      });
    }
  }

  private refreshManagedPresetAgent(existing: Agent, preset: PresetAgent): void {
    if (existing.source !== 'preset' || existing.presetId !== preset.id) {
      return;
    }

    const request = presetToCreateRequest(preset);
    const updates: UpdateAgentRequest = {
      name: request.name,
      description: request.description,
      identity: request.identity,
      systemPrompt: request.systemPrompt,
      icon: request.icon,
      skillIds: request.skillIds,
      responseContract: normalizeAgentResponseContract(request.responseContract),
    };

    const shouldUpdate =
      existing.name !== updates.name ||
      existing.description !== updates.description ||
      existing.identity !== updates.identity ||
      existing.systemPrompt !== updates.systemPrompt ||
      existing.icon !== updates.icon ||
      JSON.stringify(existing.skillIds) !== JSON.stringify(updates.skillIds) ||
      JSON.stringify(normalizeAgentResponseContract(existing.responseContract)) !==
        JSON.stringify(updates.responseContract);

    if (shouldUpdate) {
      this.store.updateAgent(existing.id, updates);
    }
  }

  private getVisibilityStore(): ManagedPresetVisibilityStore {
    return this.store as CoworkStore & ManagedPresetVisibilityStore;
  }
}
