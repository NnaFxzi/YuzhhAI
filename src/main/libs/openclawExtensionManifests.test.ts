import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../');

function readManifest(extensionId: string): Record<string, unknown> {
  const manifestPath = path.join(repoRoot, 'openclaw-extensions', extensionId, 'openclaw.plugin.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
}

function readContractTools(extensionId: string): string[] {
  const manifest = readManifest(extensionId);
  const contracts = manifest.contracts as { tools?: unknown } | undefined;
  return Array.isArray(contracts?.tools)
    ? contracts.tools.filter((tool): tool is string => typeof tool === 'string')
    : [];
}

describe('OpenClaw extension manifests', () => {
  test('declares the AskUserQuestion agent tool contract', () => {
    expect(readContractTools('ask-user-question')).toEqual(['AskUserQuestion']);
  });

  test('declares LobsterAI media generation agent tool contracts', () => {
    expect(readContractTools('lobster-media-generation')).toEqual([
      'lobsterai_image_generate',
      'lobsterai_video_generate',
    ]);
  });
});
