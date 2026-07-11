import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const {
  getMissingPreinstalledPluginIds,
} = require('../scripts/electron-builder-hooks.cjs');

const optionalCustomRegistryPlugin = {
  id: 'moltbot-popo',
  npm: 'moltbot-popo',
  version: '2.0.7',
  registry: 'https://npm.nie.netease.com',
  optional: true,
};

const requiredPlugin = {
  id: 'required-plugin',
  npm: '@example/required-plugin',
  version: '1.0.0',
};

const optionalPublicPlugin = {
  id: 'optional-public-plugin',
  npm: '@example/optional-public-plugin',
  version: '1.0.0',
  optional: true,
};

describe('electron-builder OpenClaw plugin verification', () => {
  test('returns a missing required plugin', () => {
    expect(getMissingPreinstalledPluginIds(
      [requiredPlugin],
      [],
    )).toEqual(['required-plugin']);
  });

  test('allows a missing optional custom-registry plugin', () => {
    expect(getMissingPreinstalledPluginIds(
      [optionalCustomRegistryPlugin],
      [],
    )).toEqual([]);
  });

  test('allows a missing optional public plugin', () => {
    expect(getMissingPreinstalledPluginIds(
      [optionalPublicPlugin],
      [],
    )).toEqual([]);
  });

  test('allows a missing optional plugin when installation was opted in', () => {
    expect(getMissingPreinstalledPluginIds(
      [optionalCustomRegistryPlugin],
      [],
      { OPENCLAW_INSTALL_OPTIONAL_PLUGINS: '1' },
    )).toEqual([]);
  });

  test('guards all packaged-worker smoke resources with nested cleanup', () => {
    const source = fs.readFileSync(
      path.resolve('scripts/verify-packaged-knowledge-index-worker.cjs'),
      'utf8',
    );

    expect(source).toContain([
      '  let tempDirectory = null;',
      '  let db = null;',
      '  let worker = null;',
      '  try {',
      "    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-worker-package-'));",
    ].join('\n'));
    expect(source).toContain([
      '  } finally {',
      '    try {',
      '      if (worker) {',
      '        await worker.terminate();',
      '      }',
      '    } finally {',
      '      try {',
      '        if (db) {',
      '          db.close();',
      '        }',
      '      } finally {',
      '        if (tempDirectory) {',
      '          fs.rmSync(tempDirectory, { recursive: true, force: true });',
      '        }',
      '      }',
      '    }',
      '  }',
    ].join('\n'));
  });
});
