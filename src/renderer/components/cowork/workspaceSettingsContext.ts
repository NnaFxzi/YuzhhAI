export const WorkspaceSettingsContextSource = {
  Session: 'session',
  GlobalConfig: 'global-config',
  DefaultFallback: 'default-fallback',
  None: 'none',
} as const;

export type WorkspaceSettingsContextSource =
  (typeof WorkspaceSettingsContextSource)[keyof typeof WorkspaceSettingsContextSource];

export const WorkspaceSettingsContextDisabledReason = {
  DefaultFallback: 'default-fallback',
  NoWorkspace: 'no-workspace',
} as const;

export type WorkspaceSettingsContextDisabledReason =
  (typeof WorkspaceSettingsContextDisabledReason)[keyof typeof WorkspaceSettingsContextDisabledReason];

export interface WorkspaceSettingsContext {
  workspaceId: string;
  label: string;
  source: WorkspaceSettingsContextSource;
  editable: boolean;
  disabledReason: WorkspaceSettingsContextDisabledReason | null;
}

export interface ResolveWorkspaceSettingsContextInput {
  sessionCwd?: string | null;
  globalWorkingDirectory?: string | null;
  globalWorkingDirectoryConfigured?: boolean;
}

const cleanPath = (value?: string | null): string => value?.trim() ?? '';

export const resolveWorkspaceSettingsContext = ({
  sessionCwd,
  globalWorkingDirectory,
  globalWorkingDirectoryConfigured,
}: ResolveWorkspaceSettingsContextInput): WorkspaceSettingsContext => {
  const sessionWorkspaceId = cleanPath(sessionCwd);
  if (sessionWorkspaceId) {
    return {
      workspaceId: sessionWorkspaceId,
      label: sessionWorkspaceId,
      source: WorkspaceSettingsContextSource.Session,
      editable: true,
      disabledReason: null,
    };
  }

  const globalWorkspaceId = cleanPath(globalWorkingDirectory);
  if (globalWorkspaceId && globalWorkingDirectoryConfigured === true) {
    return {
      workspaceId: globalWorkspaceId,
      label: globalWorkspaceId,
      source: WorkspaceSettingsContextSource.GlobalConfig,
      editable: true,
      disabledReason: null,
    };
  }

  if (globalWorkspaceId) {
    return {
      workspaceId: '',
      label: globalWorkspaceId,
      source: WorkspaceSettingsContextSource.DefaultFallback,
      editable: false,
      disabledReason: WorkspaceSettingsContextDisabledReason.DefaultFallback,
    };
  }

  return {
    workspaceId: '',
    label: '',
    source: WorkspaceSettingsContextSource.None,
    editable: false,
    disabledReason: WorkspaceSettingsContextDisabledReason.NoWorkspace,
  };
};
