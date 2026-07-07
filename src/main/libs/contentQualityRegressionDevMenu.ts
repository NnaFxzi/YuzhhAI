import type { MenuItemConstructorOptions } from 'electron';

import type {
  ContentQualityRegressionApplyPromptPatchResponse,
  ContentQualityRegressionRunReportResponse,
} from '../../shared/contentQualityRegression/constants';

interface ContentQualityRegressionDevMenuLabels {
  menuLabel: string;
  runReportLabel: string;
  applyLatestPromptPatchLabel: string;
  startMessage: string;
  successMessage: string;
  failureMessage: string;
  applyPromptPatchSuccessMessage: string;
  applyPromptPatchFailureMessage: string;
}

interface ContentQualityRegressionMessageBoxOptions {
  type: 'info' | 'error';
  message: string;
  detail?: string;
  buttons: string[];
}

interface ContentQualityRegressionDevMenuItemDeps {
  labels: ContentQualityRegressionDevMenuLabels;
  runReport: () => Promise<ContentQualityRegressionRunReportResponse>;
  applyLatestPromptPatchToMarketingAgent?: () => Promise<ContentQualityRegressionApplyPromptPatchResponse>;
  showItemInFolder: (filePath: string) => void;
  showMessageBox: (options: ContentQualityRegressionMessageBoxOptions) => unknown;
}

interface AppendableMenu {
  append: (item: unknown) => void;
}

export interface ContentQualityRegressionDevMenuInstallDeps extends ContentQualityRegressionDevMenuItemDeps {
  isDev: boolean;
  getApplicationMenu: () => AppendableMenu | null;
  buildMenuFromTemplate: (template: MenuItemConstructorOptions[]) => AppendableMenu;
  createMenuItem: (options: MenuItemConstructorOptions) => unknown;
  setApplicationMenu: (menu: AppendableMenu) => void;
}

const showReportFailure = (deps: ContentQualityRegressionDevMenuItemDeps, detail: string): void => {
  deps.showMessageBox({
    type: 'error',
    message: deps.labels.failureMessage,
    detail,
    buttons: ['OK'],
  });
};

const showPromptPatchFailure = (
  deps: ContentQualityRegressionDevMenuItemDeps,
  detail: string,
): void => {
  deps.showMessageBox({
    type: 'error',
    message: deps.labels.applyPromptPatchFailureMessage,
    detail,
    buttons: ['OK'],
  });
};

export async function runContentQualityRegressionReportWithFeedback(
  deps: ContentQualityRegressionDevMenuItemDeps,
): Promise<void> {
  deps.showMessageBox({
    type: 'info',
    message: deps.labels.startMessage,
    buttons: ['OK'],
  });

  try {
    const result = await deps.runReport();
    if (result.success === false) {
      showReportFailure(deps, result.error);
      return;
    }

    deps.showItemInFolder(result.reportPath);
    deps.showMessageBox({
      type: 'info',
      message: deps.labels.successMessage,
      detail: result.reportPath,
      buttons: ['OK'],
    });
  } catch (error) {
    showReportFailure(
      deps,
      error instanceof Error ? error.message : 'Unknown content quality regression error',
    );
  }
}

export async function applyLatestContentQualityPromptPatchWithFeedback(
  deps: ContentQualityRegressionDevMenuItemDeps,
): Promise<void> {
  if (!deps.applyLatestPromptPatchToMarketingAgent) {
    showPromptPatchFailure(deps, 'Prompt patch application is not configured');
    return;
  }

  try {
    const result = await deps.applyLatestPromptPatchToMarketingAgent();
    if (result.success === false) {
      showPromptPatchFailure(deps, result.error);
      return;
    }

    deps.showMessageBox({
      type: 'info',
      message: deps.labels.applyPromptPatchSuccessMessage,
      detail: result.backupPath,
      buttons: ['OK'],
    });
  } catch (error) {
    showPromptPatchFailure(
      deps,
      error instanceof Error ? error.message : 'Unknown content quality prompt patch error',
    );
  }
}

export function buildContentQualityRegressionDevMenuItem(
  deps: ContentQualityRegressionDevMenuItemDeps,
): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = [
    {
      label: deps.labels.runReportLabel,
      click: () => runContentQualityRegressionReportWithFeedback(deps),
    },
  ];
  if (deps.applyLatestPromptPatchToMarketingAgent) {
    submenu.push({
      label: deps.labels.applyLatestPromptPatchLabel,
      click: () => applyLatestContentQualityPromptPatchWithFeedback(deps),
    });
  }

  return {
    label: deps.labels.menuLabel,
    submenu,
  };
}

export function installContentQualityRegressionDevMenu(
  deps: ContentQualityRegressionDevMenuInstallDeps,
): boolean {
  if (!deps.isDev) {
    return false;
  }

  const menu = deps.getApplicationMenu() ?? deps.buildMenuFromTemplate([]);
  menu.append(deps.createMenuItem(buildContentQualityRegressionDevMenuItem(deps)));
  deps.setApplicationMenu(menu);
  return true;
}
