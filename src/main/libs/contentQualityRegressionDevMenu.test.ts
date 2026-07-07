import { describe, expect, test, vi } from 'vitest';

import {
  buildContentQualityRegressionDevMenuItem,
  installContentQualityRegressionDevMenu,
} from './contentQualityRegressionDevMenu';

const labels = {
  menuLabel: 'Content Quality',
  runReportLabel: 'Run Report',
  applyLatestPromptPatchLabel: 'Apply Latest Patch',
  startMessage: 'Report started',
  successMessage: 'Report finished',
  failureMessage: 'Report failed',
  applyPromptPatchSuccessMessage: 'Prompt patch applied',
  applyPromptPatchFailureMessage: 'Prompt patch failed',
};

const getRunReportClick = (
  menuItem: ReturnType<typeof buildContentQualityRegressionDevMenuItem>,
): (() => Promise<void>) => {
  if (!Array.isArray(menuItem.submenu)) {
    throw new Error('Expected submenu array');
  }
  const runItem = menuItem.submenu[0];
  if (!runItem || typeof runItem.click !== 'function') {
    throw new Error('Expected clickable report item');
  }
  return () =>
    Promise.resolve(runItem.click(undefined as never, undefined as never, undefined as never));
};

const getApplyLatestPromptPatchClick = (
  menuItem: ReturnType<typeof buildContentQualityRegressionDevMenuItem>,
): (() => Promise<void>) => {
  if (!Array.isArray(menuItem.submenu)) {
    throw new Error('Expected submenu array');
  }
  const applyItem = menuItem.submenu[1];
  if (!applyItem || typeof applyItem.click !== 'function') {
    throw new Error('Expected clickable prompt patch item');
  }
  return () =>
    Promise.resolve(applyItem.click(undefined as never, undefined as never, undefined as never));
};

describe('buildContentQualityRegressionDevMenuItem', () => {
  test('shows immediate feedback before the long-running report finishes', async () => {
    let resolveReport: (value: Awaited<ReturnType<typeof runReport>>) => void = () => {};
    const runReport = vi.fn(
      () =>
        new Promise<{
          success: true;
          reportPath: string;
          promptPatchPath: string;
          total: number;
          passed: number;
          failed: number;
          passRate: number;
          averageScore: number;
        }>(resolve => {
          resolveReport = resolve;
        }),
    );
    const showItemInFolder = vi.fn();
    const showMessageBox = vi.fn();
    const menuItem = buildContentQualityRegressionDevMenuItem({
      labels,
      runReport,
      showItemInFolder,
      showMessageBox,
    });

    const pendingClick = getRunReportClick(menuItem)();
    await Promise.resolve();

    expect(showMessageBox).toHaveBeenCalledWith({
      type: 'info',
      message: 'Report started',
      buttons: ['OK'],
    });
    expect(showItemInFolder).not.toHaveBeenCalled();

    resolveReport({
      success: true,
      reportPath: '/tmp/content-quality/report.md',
      promptPatchPath: '/tmp/content-quality/report.prompt-patch.txt',
      total: 20,
      passed: 20,
      failed: 0,
      passRate: 1,
      averageScore: 9.2,
    });
    await pendingClick;
  });

  test('runs the report and reveals the generated markdown file', async () => {
    const runReport = vi.fn(async () => ({
      success: true as const,
      reportPath: '/tmp/content-quality/report.md',
      promptPatchPath: '/tmp/content-quality/report.prompt-patch.txt',
      total: 20,
      passed: 20,
      failed: 0,
      passRate: 1,
      averageScore: 9.2,
    }));
    const showItemInFolder = vi.fn();
    const showMessageBox = vi.fn();
    const menuItem = buildContentQualityRegressionDevMenuItem({
      labels,
      runReport,
      showItemInFolder,
      showMessageBox,
    });

    await getRunReportClick(menuItem)();

    expect(runReport).toHaveBeenCalledTimes(1);
    expect(showItemInFolder).toHaveBeenCalledWith('/tmp/content-quality/report.md');
    expect(showMessageBox).toHaveBeenCalledWith({
      type: 'info',
      message: 'Report finished',
      detail: '/tmp/content-quality/report.md',
      buttons: ['OK'],
    });
  });

  test('shows an error dialog without revealing a file when the report fails', async () => {
    const runReport = vi.fn(async () => ({
      success: false as const,
      error: 'Missing API configuration',
    }));
    const showItemInFolder = vi.fn();
    const showMessageBox = vi.fn();
    const menuItem = buildContentQualityRegressionDevMenuItem({
      labels,
      runReport,
      showItemInFolder,
      showMessageBox,
    });

    await getRunReportClick(menuItem)();

    expect(showItemInFolder).not.toHaveBeenCalled();
    expect(showMessageBox).toHaveBeenCalledWith({
      type: 'error',
      message: 'Report failed',
      detail: 'Missing API configuration',
      buttons: ['OK'],
    });
  });

  test('applies the latest prompt patch to the marketing agent from the menu', async () => {
    const applyLatestPromptPatchToMarketingAgent = vi.fn(async () => ({
      success: true as const,
      agentId: 'marketing-agent',
      appliedAt: '2026-07-07T08:30:00.000Z',
      backupPath: '/tmp/content-quality/prompt-patch-backups/agent-marketing-agent.md',
      promptPatchPath: '/tmp/content-quality/report.prompt-patch.txt',
    }));
    const showMessageBox = vi.fn();
    const menuItem = buildContentQualityRegressionDevMenuItem({
      labels,
      runReport: vi.fn(),
      applyLatestPromptPatchToMarketingAgent,
      showItemInFolder: vi.fn(),
      showMessageBox,
    });

    await getApplyLatestPromptPatchClick(menuItem)();

    expect(applyLatestPromptPatchToMarketingAgent).toHaveBeenCalledTimes(1);
    expect(showMessageBox).toHaveBeenCalledWith({
      type: 'info',
      message: 'Prompt patch applied',
      detail: '/tmp/content-quality/prompt-patch-backups/agent-marketing-agent.md',
      buttons: ['OK'],
    });
  });

  test('shows an error dialog when applying the latest prompt patch fails', async () => {
    const applyLatestPromptPatchToMarketingAgent = vi.fn(async () => ({
      success: false as const,
      error: 'No prompt patch file found',
    }));
    const showMessageBox = vi.fn();
    const menuItem = buildContentQualityRegressionDevMenuItem({
      labels,
      runReport: vi.fn(),
      applyLatestPromptPatchToMarketingAgent,
      showItemInFolder: vi.fn(),
      showMessageBox,
    });

    await getApplyLatestPromptPatchClick(menuItem)();

    expect(showMessageBox).toHaveBeenCalledWith({
      type: 'error',
      message: 'Prompt patch failed',
      detail: 'No prompt patch file found',
      buttons: ['OK'],
    });
  });
});

describe('installContentQualityRegressionDevMenu', () => {
  test('does not install the menu outside development mode', () => {
    const append = vi.fn();
    const result = installContentQualityRegressionDevMenu({
      isDev: false,
      labels,
      runReport: vi.fn(),
      applyLatestPromptPatchToMarketingAgent: vi.fn(),
      showItemInFolder: vi.fn(),
      showMessageBox: vi.fn(),
      getApplicationMenu: () => ({ append }),
      buildMenuFromTemplate: vi.fn(),
      createMenuItem: vi.fn(),
      setApplicationMenu: vi.fn(),
    });

    expect(result).toBe(false);
    expect(append).not.toHaveBeenCalled();
  });

  test('appends the menu item to the current application menu in development mode', () => {
    const menu = { append: vi.fn() };
    const createdMenuItem = { id: 'content-quality-menu' };
    const createMenuItem = vi.fn(() => createdMenuItem);
    const setApplicationMenu = vi.fn();
    const result = installContentQualityRegressionDevMenu({
      isDev: true,
      labels,
      runReport: vi.fn(),
      applyLatestPromptPatchToMarketingAgent: vi.fn(),
      showItemInFolder: vi.fn(),
      showMessageBox: vi.fn(),
      getApplicationMenu: () => menu,
      buildMenuFromTemplate: vi.fn(),
      createMenuItem,
      setApplicationMenu,
    });

    expect(result).toBe(true);
    expect(createMenuItem).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Content Quality',
      }),
    );
    expect(menu.append).toHaveBeenCalledWith(createdMenuItem);
    expect(setApplicationMenu).toHaveBeenCalledWith(menu);
  });
});
