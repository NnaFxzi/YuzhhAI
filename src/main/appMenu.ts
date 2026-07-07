import type { MenuItemConstructorOptions } from 'electron';

export const MainApplicationMenuRole = {
  AppMenu: 'appMenu',
  EditMenu: 'editMenu',
  ViewMenu: 'viewMenu',
  WindowMenu: 'windowMenu',
} as const;

export type MainApplicationMenuRole =
  (typeof MainApplicationMenuRole)[keyof typeof MainApplicationMenuRole];

interface MainApplicationMenuOptions {
  isMac: boolean;
}

interface MainApplicationMenuInstallDeps extends MainApplicationMenuOptions {
  buildMenuFromTemplate: (template: MenuItemConstructorOptions[]) => unknown;
  setApplicationMenu: (menu: unknown) => void;
}

export const buildMainApplicationMenuTemplate = ({
  isMac,
}: MainApplicationMenuOptions): MenuItemConstructorOptions[] => [
  ...(isMac ? [{ role: MainApplicationMenuRole.AppMenu }] : []),
  { role: MainApplicationMenuRole.EditMenu },
  { role: MainApplicationMenuRole.ViewMenu },
  { role: MainApplicationMenuRole.WindowMenu },
];

export const installMainApplicationMenu = (deps: MainApplicationMenuInstallDeps): void => {
  deps.setApplicationMenu(
    deps.buildMenuFromTemplate(buildMainApplicationMenuTemplate({ isMac: deps.isMac })),
  );
};
