export const AgentId = {
  Main: 'main',
} as const;

export type AgentId = typeof AgentId[keyof typeof AgentId];

export const AgentIpcChannel = {
  List: 'agents:list',
  Get: 'agents:get',
  Create: 'agents:create',
  Update: 'agents:update',
  Delete: 'agents:delete',
  Presets: 'agents:presets',
  PresetTemplates: 'agents:presetTemplates',
  AddPreset: 'agents:addPreset',
  GetExternalResearchSettings: 'agents:externalResearch:get',
  SaveExternalResearchSettings: 'agents:externalResearch:save',
  TestExternalResearchProvider: 'agents:externalResearch:testProvider',
  GetDomesticResearchSettings: 'agents:domesticResearch:get',
  SaveDomesticResearchSettings: 'agents:domesticResearch:save',
} as const;

export type AgentIpcChannel = typeof AgentIpcChannel[keyof typeof AgentIpcChannel];

export const LegacyAgentName = {
  Main: 'main',
} as const;

export const DefaultAgentProfile = {
  Name: 'LobsterAI',
} as const;
