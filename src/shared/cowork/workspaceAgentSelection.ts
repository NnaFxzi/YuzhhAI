export const CoworkWorkspaceAgentMode = {
  Auto: 'auto',
  Manual: 'manual',
} as const;

export type CoworkWorkspaceAgentMode =
  (typeof CoworkWorkspaceAgentMode)[keyof typeof CoworkWorkspaceAgentMode];

export interface CoworkWorkspaceAgentSelection {
  workspaceId: string;
  mode: CoworkWorkspaceAgentMode;
  agentId?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const cleanText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const normalizeCoworkWorkspaceAgentSelection = (
  value: unknown,
): CoworkWorkspaceAgentSelection | null => {
  if (!isRecord(value)) return null;

  const workspaceId = cleanText(value.workspaceId);
  if (!workspaceId) return null;

  const rawMode = cleanText(value.mode);
  const agentId = cleanText(value.agentId);
  if (rawMode === CoworkWorkspaceAgentMode.Manual && agentId) {
    return {
      workspaceId,
      mode: CoworkWorkspaceAgentMode.Manual,
      agentId,
    };
  }

  return {
    workspaceId,
    mode: CoworkWorkspaceAgentMode.Auto,
  };
};
