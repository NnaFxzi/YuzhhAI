import path from 'path';
import { describe, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => ''),
    isPackaged: false,
  },
}));

import { resolvePackageRoot } from './computerUseMcpServer';

describe('resolvePackageRoot', () => {
  test('resolves the MCP SDK package root instead of its exported cjs package marker', () => {
    const root = resolvePackageRoot('@modelcontextprotocol/sdk');

    expect(root).toBeTruthy();
    expect(path.basename(root!)).toBe('sdk');
    expect(root).not.toContain(`${path.sep}dist${path.sep}cjs`);
  });
});
