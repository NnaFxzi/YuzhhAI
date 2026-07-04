export const ManagedPresetAgentId = {
  Marketing: 'marketing-agent',
} as const;

export type ManagedPresetAgentId =
  typeof ManagedPresetAgentId[keyof typeof ManagedPresetAgentId];
