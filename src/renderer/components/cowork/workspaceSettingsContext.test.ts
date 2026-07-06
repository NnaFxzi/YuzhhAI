import { describe, expect, test } from 'vitest';

import {
  resolveWorkspaceSettingsContext,
  WorkspaceSettingsContextDisabledReason,
  WorkspaceSettingsContextSource,
} from './workspaceSettingsContext';

describe('resolveWorkspaceSettingsContext', () => {
  test('uses the current session cwd before global config', () => {
    const context = resolveWorkspaceSettingsContext({
      sessionCwd: '  /project/session  ',
      globalWorkingDirectory: '/project/global',
      globalWorkingDirectoryConfigured: true,
    });

    expect(context).toEqual({
      workspaceId: '/project/session',
      label: '/project/session',
      source: WorkspaceSettingsContextSource.Session,
      editable: true,
      disabledReason: null,
    });
  });

  test('uses an explicitly configured global working directory', () => {
    const context = resolveWorkspaceSettingsContext({
      sessionCwd: '',
      globalWorkingDirectory: ' /project/global ',
      globalWorkingDirectoryConfigured: true,
    });

    expect(context).toEqual({
      workspaceId: '/project/global',
      label: '/project/global',
      source: WorkspaceSettingsContextSource.GlobalConfig,
      editable: true,
      disabledReason: null,
    });
  });

  test('does not edit the default fallback working directory as a workspace', () => {
    const context = resolveWorkspaceSettingsContext({
      sessionCwd: '',
      globalWorkingDirectory: '/Users/me/yuzhh-ai-assistant/project',
      globalWorkingDirectoryConfigured: false,
    });

    expect(context).toEqual({
      workspaceId: '',
      label: '/Users/me/yuzhh-ai-assistant/project',
      source: WorkspaceSettingsContextSource.DefaultFallback,
      editable: false,
      disabledReason: WorkspaceSettingsContextDisabledReason.DefaultFallback,
    });
  });

  test('returns a non-editable empty context when no workspace can be resolved', () => {
    const context = resolveWorkspaceSettingsContext({
      sessionCwd: '',
      globalWorkingDirectory: '',
      globalWorkingDirectoryConfigured: false,
    });

    expect(context).toEqual({
      workspaceId: '',
      label: '',
      source: WorkspaceSettingsContextSource.None,
      editable: false,
      disabledReason: WorkspaceSettingsContextDisabledReason.NoWorkspace,
    });
  });
});
