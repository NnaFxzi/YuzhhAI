import { describe, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => process.cwd(),
    isPackaged: false,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

import { RuntimeBrand } from '../../shared/branding/constants';
import {
  buildOpenClawCompileCacheEnv,
  buildOpenClawGatewayExecArgv,
  getPackagedRuntimeDirCandidates,
  getRuntimeMissingMessage,
} from './openclawEngineManager';

describe('buildOpenClawCompileCacheEnv', () => {
  test('prevents the packaged launcher from respawning Electron Helper', () => {
    expect(buildOpenClawCompileCacheEnv('/tmp/openclaw-cache')).toEqual({
      NODE_COMPILE_CACHE: '/tmp/openclaw-cache',
      OPENCLAW_PACKAGED_COMPILE_CACHE_RESPAWNED: '1',
    });
  });
});

describe('buildOpenClawGatewayExecArgv', () => {
  test('adds a gateway heap limit when NODE_OPTIONS is empty', () => {
    expect(buildOpenClawGatewayExecArgv(undefined)).toEqual(['--max-old-space-size=4096']);
  });

  test('adds a gateway heap limit alongside unrelated NODE_OPTIONS', () => {
    expect(buildOpenClawGatewayExecArgv('--trace-warnings')).toEqual(['--max-old-space-size=4096']);
  });

  test('respects an existing max old space setting with equals syntax', () => {
    expect(buildOpenClawGatewayExecArgv('--max-old-space-size=8192 --trace-warnings')).toEqual([]);
  });

  test('respects an existing max old space setting with space syntax', () => {
    expect(buildOpenClawGatewayExecArgv('--max-old-space-size 8192 --trace-warnings')).toEqual([]);
  });
});

describe('OpenClaw packaged runtime branding', () => {
  test('prefers the Yuzhh runtime directory and keeps cfmind only as fallback', () => {
    expect(getPackagedRuntimeDirCandidates('/Applications/App.app/Contents/Resources')).toEqual([
      '/Applications/App.app/Contents/Resources/yuzhh-runtime',
      '/Applications/App.app/Contents/Resources/cfmind',
    ]);
  });

  test('uses user-facing Yuzhh runtime text for missing runtime errors', () => {
    expect(getRuntimeMissingMessage()).toContain(RuntimeBrand.DisplayNameZh);
    expect(getRuntimeMissingMessage()).not.toContain('cfmind');
    expect(getRuntimeMissingMessage()).not.toContain('OpenClaw');
  });
});
