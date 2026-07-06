import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const rootDir = resolve(__dirname, '..');

function readProjectFile(relativePath: string): string {
  return readFileSync(resolve(rootDir, relativePath), 'utf8');
}

describe('build warning configuration', () => {
  test('legacy dev script loads Vite through ESM instead of require', () => {
    const script = readProjectFile('scripts/dev.js');

    expect(script).not.toContain("require('vite')");
    expect(script).toContain("import('vite')");
  });

  test('Vite aliases lottie-web to the light player without eval', () => {
    const config = readProjectFile('vite.config.mts');
    const lightPlayer = readProjectFile('node_modules/lottie-web/build/player/lottie_light.js');

    expect(config).toContain("'lottie-web': 'lottie-web/build/player/lottie_light.js'");
    expect(lightPlayer).not.toMatch(/\beval\s*\(/);
  });
});
