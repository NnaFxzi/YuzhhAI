import type { Agent, CoworkStore, CreateAgentRequest, UpdateAgentRequest } from './coworkStore';
import {
  AUTO_INSTALLED_PRESET_AGENT_IDS,
  PRESET_AGENTS,
  type PresetAgent,
  presetToCreateRequest,
} from './presetAgents';

interface ManagedPresetVisibilityStore {
  isManagedPresetAgentHidden?: (id: string) => boolean;
  markManagedPresetAgentHidden?: (id: string) => void;
  clearManagedPresetAgentHidden?: (id: string) => void;
}

const AUTO_INSTALLED_PRESET_AGENT_ID_SET = new Set<string>(AUTO_INSTALLED_PRESET_AGENT_IDS);

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

  createAgent(request: CreateAgentRequest, defaultModel?: string): Agent {
    return this.store.createAgent({
      ...request,
      model: request.model?.trim() || defaultModel?.trim() || '',
      workingDirectory: request.workingDirectory?.trim() || '',
    });
  }

  updateAgent(agentId: string, updates: UpdateAgentRequest): Agent | null {
    return this.store.updateAgent(agentId, {
      ...updates,
      ...(updates.workingDirectory !== undefined
        ? { workingDirectory: updates.workingDirectory.trim() }
        : {}),
    });
  }

  deleteAgent(agentId: string): boolean {
    const deleted = this.store.deleteAgent(agentId);
    if (deleted && AUTO_INSTALLED_PRESET_AGENT_ID_SET.has(agentId)) {
      this.getVisibilityStore().markManagedPresetAgentHidden?.(agentId);
    }
    return deleted;
  }

  // --- Preset agents ---

  getPresetAgents(): PresetAgent[] {
    this.ensureAutoInstalledPresetAgents();
    const existingAgents = this.store.listAgents();
    const existingPresetIds = new Set(
      existingAgents.filter(a => a.source === 'preset').map(a => a.presetId)
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
    if (existing) return existing;

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

      if (this.getVisibilityStore().isManagedPresetAgentHidden?.(presetId) === true) continue;

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
    };

    const shouldUpdate =
      existing.name !== updates.name ||
      existing.description !== updates.description ||
      existing.identity !== updates.identity ||
      existing.systemPrompt !== updates.systemPrompt ||
      existing.icon !== updates.icon ||
      JSON.stringify(existing.skillIds) !== JSON.stringify(updates.skillIds);

    if (shouldUpdate) {
      this.store.updateAgent(existing.id, updates);
    }
  }

  private getVisibilityStore(): ManagedPresetVisibilityStore {
    return this.store as CoworkStore & ManagedPresetVisibilityStore;
  }
}
