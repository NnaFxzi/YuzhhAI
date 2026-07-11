import fs from 'node:fs';
import path from 'node:path';

export const OCR_ASSET_FILE_NAMES = {
  worker: 'worker.node.cjs',
  core: 'tesseract-core.wasm.js',
  eng: 'eng.traineddata.gz',
  chiSim: 'chi_sim.traineddata.gz',
} as const;

export const OCR_CORE_WASM_FILE_NAMES = [
  'tesseract-core.wasm',
  'tesseract-core-lstm.wasm',
  'tesseract-core-simd.wasm',
  'tesseract-core-simd-lstm.wasm',
  'tesseract-core-relaxedsimd.wasm',
  'tesseract-core-relaxedsimd-lstm.wasm',
] as const;

export interface OcrAssetPathOptions {
  isPackaged: boolean;
  projectRoot: string;
  resourcesPath: string;
}

export interface OcrAssetPaths {
  root: string;
  workerPath: string;
  corePath: string;
  langPath: string;
  languageDataPaths: [string, string];
  coreWasmPaths: string[];
}

export const resolveOcrAssetPaths = ({
  isPackaged,
  projectRoot,
  resourcesPath,
}: OcrAssetPathOptions): OcrAssetPaths => {
  const root = path.resolve(
    isPackaged ? path.join(resourcesPath, 'ocr') : path.join(projectRoot, 'resources', 'ocr'),
  );
  return {
    root,
    workerPath: path.join(root, OCR_ASSET_FILE_NAMES.worker),
    corePath: path.join(root, OCR_ASSET_FILE_NAMES.core),
    langPath: root,
    languageDataPaths: [
      path.join(root, OCR_ASSET_FILE_NAMES.eng),
      path.join(root, OCR_ASSET_FILE_NAMES.chiSim),
    ],
    coreWasmPaths: OCR_CORE_WASM_FILE_NAMES.map(fileName => path.join(root, fileName)),
  };
};

export const getMissingOcrAssetPaths = (
  paths: OcrAssetPaths,
  exists: (filePath: string) => boolean = filePath => fs.existsSync(filePath),
): string[] =>
  [paths.workerPath, paths.corePath, ...paths.coreWasmPaths, ...paths.languageDataPaths].filter(
    filePath => !exists(filePath),
  );
