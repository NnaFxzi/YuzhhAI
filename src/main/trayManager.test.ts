import { beforeEach, describe, expect, test, vi } from 'vitest';

const { electronMocks } = vi.hoisted(() => {
  const buildFromTemplate = vi.fn((template: unknown[]) => ({
    template,
  }));
  const trayInstances: Array<{
    destroy: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    popUpContextMenu: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
    setToolTip: ReturnType<typeof vi.fn>;
  }> = [];

  return {
    electronMocks: {
      buildFromTemplate,
      trayInstances,
    },
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    quit: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  Menu: {
    buildFromTemplate: electronMocks.buildFromTemplate,
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({
      getSize: () => ({ height: 16 }),
      resize: vi.fn(),
      setTemplateImage: vi.fn(),
    })),
  },
  Tray: vi.fn().mockImplementation(function MockTray() {
    const tray = {
      destroy: vi.fn(),
      on: vi.fn(),
      popUpContextMenu: vi.fn(),
      removeListener: vi.fn(),
      setToolTip: vi.fn(),
    };
    electronMocks.trayInstances.push(tray);
    return tray;
  }),
}));

import { createTray, destroyTray, setTrayDevelopmentActions } from './trayManager';

beforeEach(() => {
  destroyTray();
  setTrayDevelopmentActions([]);
  electronMocks.buildFromTemplate.mockClear();
  electronMocks.trayInstances.length = 0;
});

describe('trayManager', () => {
  test('adds development actions to the tray context menu', () => {
    const runReport = vi.fn();
    setTrayDevelopmentActions([
      {
        label: '运行内容质量回归报告',
        onClick: runReport,
      },
    ]);

    createTray(() => null);

    const template = electronMocks.buildFromTemplate.mock.calls.at(-1)?.[0] as Array<{
      label?: string;
      click?: () => void;
      type?: string;
    }>;
    const reportItem = template.find(item => item.label === '运行内容质量回归报告');
    expect(reportItem).toBeDefined();

    reportItem?.click?.();

    expect(runReport).toHaveBeenCalledTimes(1);
    expect(template.findIndex(item => item.label === '运行内容质量回归报告')).toBeLessThan(
      template.findIndex(item => item.label === '退出'),
    );
  });
});
