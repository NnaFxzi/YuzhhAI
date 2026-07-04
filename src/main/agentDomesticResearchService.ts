import {
  type DomesticResearchConfig,
  type DomesticResearchStatusMap,
  getDomesticResearchSourceStatuses,
  normalizeDomesticResearchConfig,
} from '../shared/agent/domesticResearch';

interface StoreLike {
  getAgentSettings(agentId: string): DomesticResearchConfig;
  saveAgentSettings(agentId: string, config: DomesticResearchConfig): DomesticResearchConfig;
}

export interface DomesticResearchStatusPayload {
  settings: DomesticResearchConfig;
  statuses: DomesticResearchStatusMap;
}

export class AgentDomesticResearchService {
  constructor(private readonly options: { store: StoreLike }) {}

  getSettings(agentId: string): DomesticResearchConfig {
    return this.options.store.getAgentSettings(agentId);
  }

  saveSettings(agentId: string, config: unknown): DomesticResearchConfig {
    const normalized = normalizeDomesticResearchConfig(config);
    return this.options.store.saveAgentSettings(agentId, normalized);
  }

  getStatusPayload(agentId: string): DomesticResearchStatusPayload {
    const settings = this.getSettings(agentId);
    return {
      settings,
      statuses: getDomesticResearchSourceStatuses(settings),
    };
  }
}
