import { describe, expect, test } from 'vitest';

import { getMissingOcrAssetPaths, resolveOcrAssetPaths } from './ocrAssets';

describe('ocrAssets', () => {
  test('resolves development resources', () => {
    expect(
      resolveOcrAssetPaths({
        isPackaged: false,
        projectRoot: '/repo/yuzhh-ai-assistant',
        resourcesPath: '/ignored',
      }),
    ).toEqual({
      root: '/repo/yuzhh-ai-assistant/resources/ocr',
      workerPath: '/repo/yuzhh-ai-assistant/resources/ocr/worker.node.cjs',
      corePath: '/repo/yuzhh-ai-assistant/resources/ocr/tesseract-core.wasm.js',
      langPath: '/repo/yuzhh-ai-assistant/resources/ocr',
      languageDataPaths: [
        '/repo/yuzhh-ai-assistant/resources/ocr/eng.traineddata.gz',
        '/repo/yuzhh-ai-assistant/resources/ocr/chi_sim.traineddata.gz',
      ],
      coreWasmPaths: [
        '/repo/yuzhh-ai-assistant/resources/ocr/tesseract-core.wasm',
        '/repo/yuzhh-ai-assistant/resources/ocr/tesseract-core-lstm.wasm',
        '/repo/yuzhh-ai-assistant/resources/ocr/tesseract-core-simd.wasm',
        '/repo/yuzhh-ai-assistant/resources/ocr/tesseract-core-simd-lstm.wasm',
        '/repo/yuzhh-ai-assistant/resources/ocr/tesseract-core-relaxedsimd.wasm',
        '/repo/yuzhh-ai-assistant/resources/ocr/tesseract-core-relaxedsimd-lstm.wasm',
      ],
    });
  });

  test('resolves packaged resources', () => {
    expect(
      resolveOcrAssetPaths({
        isPackaged: true,
        projectRoot: '/repo/yuzhh-ai-assistant',
        resourcesPath: '/Applications/Yuzhh.app/Contents/Resources',
      }).root,
    ).toBe('/Applications/Yuzhh.app/Contents/Resources/ocr');
  });

  test('reports only missing files', () => {
    const paths = resolveOcrAssetPaths({
      isPackaged: false,
      projectRoot: '/repo',
      resourcesPath: '/ignored',
    });
    const present = new Set([
      paths.workerPath,
      paths.corePath,
      ...paths.coreWasmPaths,
      paths.languageDataPaths[0],
    ]);

    expect(getMissingOcrAssetPaths(paths, filePath => present.has(filePath))).toEqual([
      paths.languageDataPaths[1],
    ]);
  });
});
