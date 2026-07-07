import { describe, expect, test, vi } from 'vitest';

import {
  buildMainApplicationMenuTemplate,
  installMainApplicationMenu,
  MainApplicationMenuRole,
} from './appMenu';

describe('buildMainApplicationMenuTemplate', () => {
  test('includes the standard edit menu so native paste shortcuts reach text inputs', () => {
    const template = buildMainApplicationMenuTemplate({ isMac: false });

    expect(template).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: MainApplicationMenuRole.EditMenu })]),
    );
  });

  test('keeps the macOS application menu when building for darwin', () => {
    const template = buildMainApplicationMenuTemplate({ isMac: true });

    expect(template[0]).toEqual(
      expect.objectContaining({
        role: MainApplicationMenuRole.AppMenu,
      }),
    );
  });
});

describe('installMainApplicationMenu', () => {
  test('builds and installs the main application menu', () => {
    const builtMenu = { id: 'main-menu' };
    const buildMenuFromTemplate = vi.fn(() => builtMenu);
    const setApplicationMenu = vi.fn();

    installMainApplicationMenu({
      isMac: false,
      buildMenuFromTemplate,
      setApplicationMenu,
    });

    expect(buildMenuFromTemplate).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ role: MainApplicationMenuRole.EditMenu })]),
    );
    expect(setApplicationMenu).toHaveBeenCalledWith(builtMenu);
  });
});
