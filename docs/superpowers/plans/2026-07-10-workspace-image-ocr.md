# Workspace Image OCR Completion Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox syntax for tracking.

Goal: Complete the workspace image-upload OCR path so local Tesseract OCR extracts English and Simplified Chinese text,
reports per-file state, and falls back to image-only attachments when OCR is unavailable.

Architecture: Keep OCR in the Electron main process behind the preload bridge. Add a testable OCR asset resolver and
build-time asset preparation; pass explicit local worker/core/language paths to Tesseract. Process renderer uploads
sequentially and forward successful OCR text into the existing extractionSources and vector-index pipeline.

Tech Stack: Electron 40, React 18, TypeScript, Vitest, Tesseract.js 7, Electron Builder, existing heic2any conversion
path.

## Global Constraints

- OCR runs when workspace creation is submitted, not when a file is merely selected.
- Runtime OCR uses local resources and never downloads language data.
- Required language files are eng.traineddata.gz and chi_sim.traineddata.gz.
- Supported OCR languages remain eng and chi_sim.
- Multiple images are processed sequentially in input order.
- OCR failure or empty output preserves the original image and does not block workspace creation.
- Renderer code accesses files and OCR only through preload IPC.
- New IPC channel names are shared constants, not duplicated string literals.
- New user-visible strings must be added to both zh and en dictionaries.
- Touched TypeScript/TSX files must pass the repository ESLint command with max warnings set to zero.
- Do not modify OpenClaw runtime output, database schema, or unrelated workspace architecture.
- Do not commit until the user has tested and confirmed the completed change.

## File Map

- Create src/main/libs/ocrAssets.ts and src/main/libs/ocrAssets.test.ts for OCR resource names, paths, and missing-file
  checks.
- Create scripts/ensure-ocr-language-data.cjs for build-time OCR resource preparation, including the Node worker bundle
  and all core WASM variants.
- Modify src/shared/dialog/constants.ts, src/main/main.ts, and src/main/preload.ts for the shared IPC contract.
- Modify src/main/libs/documentTextExtractor.ts and its test for local Tesseract options and cleanup.
- Modify enterpriseLeadWorkspaceUi.ts and its test for sequential, stateful OCR orchestration.
- Modify WorkspaceCreate.tsx, WorkspaceMaterialUpload.tsx, i18n.ts, and electron.d.ts for UI state and types.
- Modify package.json and electron-builder.json so OCR assets exist before compile and ship under Resources/ocr.

---

### Task 1: Add shared OCR IPC constants

Files:

- Modify: src/shared/dialog/constants.ts
- Create: src/shared/dialog/constants.test.ts

Interfaces: Add DialogIpc.ExtractImageText with value dialog:extractImageText and DialogIpc.ExtractImageTextProgress
with value dialog:extractImageText:progress. Preserve the two existing values.

- [ ] Step 1: Write the failing test

~~~typescript
import { describe, expect, test } from 'vitest';
import { DialogIpc } from './constants';

describe('DialogIpc', () => {
  test('exposes image OCR request and progress channels', () => {
    expect(DialogIpc.ExtractImageText).toBe('dialog:extractImageText');
    expect(DialogIpc.ExtractImageTextProgress).toBe('dialog:extractImageText:progress');
  });
});
~~~

- [ ] Step 2: Run it and verify the expected failure

~~~bash
npx vitest run src/shared/dialog/constants.test.ts
~~~

Expected: FAIL because the two properties do not exist.

- [ ] Step 3: Implement the constants

~~~typescript
export const DialogIpc = {
  StatFile: 'dialog:statFile',
  ReadTextFile: 'dialog:readTextFile',
  ExtractImageText: 'dialog:extractImageText',
  ExtractImageTextProgress: 'dialog:extractImageText:progress',
} as const;
~~~

- [ ] Step 4: Run the focused test

~~~bash
npx vitest run src/shared/dialog/constants.test.ts
~~~

Expected: PASS.

### Task 2: Add deterministic OCR asset resolution and preparation

Files:

- Create: src/main/libs/ocrAssets.ts
- Create: src/main/libs/ocrAssets.test.ts
- Create: scripts/ensure-ocr-language-data.cjs
- Modify: package.json
- Modify: electron-builder.json

Interfaces: resolveOcrAssetPaths(options) returns root, workerPath, corePath, langPath, and languageDataPaths.
getMissingOcrAssetPaths(paths, exists?) returns missing files in stable order. Development root is
projectRoot/resources/ocr; packaged root is resourcesPath/ocr.

- [ ] Step 1: Write failing resolver tests

~~~typescript
import { describe, expect, test } from 'vitest';
import { getMissingOcrAssetPaths, resolveOcrAssetPaths } from './ocrAssets';

describe('ocrAssets', () => {
  test('resolves development resources', () => {
    expect(resolveOcrAssetPaths({
      isPackaged: false,
      projectRoot: '/repo/lobsterai',
      resourcesPath: '/ignored',
    })).toEqual({
      root: '/repo/lobsterai/resources/ocr',
      workerPath: '/repo/lobsterai/resources/ocr/worker.min.js',
      corePath: '/repo/lobsterai/resources/ocr/tesseract-core.wasm.js',
      langPath: '/repo/lobsterai/resources/ocr',
      languageDataPaths: [
        '/repo/lobsterai/resources/ocr/eng.traineddata.gz',
        '/repo/lobsterai/resources/ocr/chi_sim.traineddata.gz',
      ],
    });
  });

  test('resolves packaged resources', () => {
    expect(resolveOcrAssetPaths({
      isPackaged: true,
      projectRoot: '/repo/lobsterai',
      resourcesPath: '/Applications/LobsterAI.app/Contents/Resources',
    }).root).toBe('/Applications/LobsterAI.app/Contents/Resources/ocr');
  });

  test('reports only missing files', () => {
    const paths = resolveOcrAssetPaths({
      isPackaged: false,
      projectRoot: '/repo',
      resourcesPath: '/ignored',
    });
    const present = new Set([paths.workerPath, paths.corePath, paths.languageDataPaths[0]]);
    expect(getMissingOcrAssetPaths(paths, filePath => present.has(filePath))).toEqual([
      paths.languageDataPaths[1],
    ]);
  });
});
~~~

- [ ] Step 2: Run tests and verify the expected failure

~~~bash
npx vitest run src/main/libs/ocrAssets.test.ts
~~~

Expected: FAIL because ocrAssets.ts does not exist.

- [ ] Step 3: Implement ocrAssets.ts

~~~typescript
import fs from 'node:fs';
import path from 'node:path';

export const OCR_ASSET_FILE_NAMES = {
  worker: 'worker.min.js',
  core: 'tesseract-core.wasm.js',
  eng: 'eng.traineddata.gz',
  chiSim: 'chi_sim.traineddata.gz',
} as const;

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
}

export const resolveOcrAssetPaths = ({
  isPackaged,
  projectRoot,
  resourcesPath,
}: OcrAssetPathOptions): OcrAssetPaths => {
  const root = path.resolve(
    isPackaged
      ? path.join(resourcesPath, 'ocr')
      : path.join(projectRoot, 'resources', 'ocr'),
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
  };
};

export const getMissingOcrAssetPaths = (
  paths: OcrAssetPaths,
  exists: (filePath: string) => boolean = filePath => fs.existsSync(filePath),
): string[] =>
  [paths.workerPath, paths.corePath, ...paths.languageDataPaths].filter(
    filePath => !exists(filePath),
  );
~~~

- [ ] Step 4: Add build-time resource preparation

Create scripts/ensure-ocr-language-data.cjs. It must bundle tesseract.js/src/worker-script/node/index.js with esbuild
into worker.node.cjs, copy the core JavaScript loader and every tesseract-core*.wasm variant into resources/ocr, then
download missing language files from the pinned URLs below. The --check flag validates without modifying files.

~~~javascript
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'resources', 'ocr');
const languages = ['eng', 'chi_sim'];
const dataBase = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';
const checkOnly = process.argv.includes('--check');
const copies = [
  [require.resolve('tesseract.js/dist/worker.min.js'), 'worker.min.js'],
  [require.resolve('tesseract.js-core/tesseract-core.wasm.js'), 'tesseract-core.wasm.js'],
  [require.resolve('tesseract.js-core/tesseract-core.wasm'), 'tesseract-core.wasm'],
];

const ensureDownload = async (target, url) => {
  if (fs.existsSync(target) && fs.statSync(target).size > 0) return;
  if (checkOnly) throw new Error('Missing OCR asset: ' + target);
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to download ' + url + ': ' + response.status);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length === 0) throw new Error('Downloaded empty OCR asset: ' + url);
  await fsp.writeFile(target, data);
};

const main = async () => {
  if (checkOnly) {
    for (const [, name] of copies) {
      await ensureDownload(path.join(output, name), null);
    }
  } else {
    await fsp.mkdir(output, { recursive: true });
    for (const [source, name] of copies) {
      await fsp.copyFile(source, path.join(output, name));
    }
  }
  for (const language of languages) {
    await ensureDownload(
      path.join(output, language + '.traineddata.gz'),
      dataBase + '/' + language + '/4.0.0_best_int/' + language + '.traineddata.gz',
    );
  }
};

main().catch(error => {
  console.error('[OCR assets] Failed to prepare OCR assets:', error);
  process.exitCode = 1;
});
~~~

- [ ] Step 5: Wire scripts and Electron resources

Add package.json script ensure:ocr-data with value node scripts/ensure-ocr-language-data.cjs. Change the existing
precompile:electron value to run npm run ensure:ocr-data before electron-builder install-app-deps. Add this object to
electron-builder.json top-level extraResources:

~~~json
{
  "from": "resources/ocr",
  "to": "ocr",
  "filter": ["**/*"]
}
~~~

- [ ] Step 6: Validate the task

~~~bash
npm run ensure:ocr-data
npx vitest run src/main/libs/ocrAssets.test.ts
~~~

Expected: resources/ocr contains the worker, core, and both language files; resolver tests pass. If the download is
blocked by sandbox networking, rerun only the resource command with escalation and the required user approval.

### Task 3: Make the main-process extractor use local Tesseract assets

Files:

- Modify: src/main/libs/documentTextExtractor.ts
- Modify: src/main/libs/documentTextExtractor.test.ts

Interfaces: ExtractImageTextOptions gains assetPaths?: OcrAssetPaths. extractDocumentTextFromFile(filePath, options?)
gains options.image and forwards it only for image extensions.

- [ ] Step 1: Add failing mocked-Tesseract tests

Mock tesseract.js and add tests that create a temporary image file, pass explicit asset paths, assert createWorker
receives ['eng', 'chi_sim'], workerPath, corePath, langPath, gzip: true, trim returned text, forward recognition
progress, reject missing assets before worker creation, and terminate the worker when recognize throws:

~~~typescript
const worker = {
  recognize: vi.fn(async () => ({ data: { text: '  图片中的文字  ' } })),
  terminate: vi.fn(async () => undefined),
};
createWorker.mockResolvedValueOnce(worker);
const result = await extractImageText(filePath, {
  assetPaths,
  onProgress: value => progress.push(value),
});
expect(result).toMatchObject({ parser: 'image', content: '图片中的文字' });
expect(createWorker).toHaveBeenCalledWith(
  ['eng', 'chi_sim'],
  1,
  expect.objectContaining({
    workerPath: assetPaths.workerPath,
    corePath: assetPaths.corePath,
    langPath: assetPaths.langPath,
    gzip: true,
  }),
);
expect(worker.terminate).toHaveBeenCalledTimes(1);
~~~

- [ ] Step 2: Run the extractor tests and verify failure

~~~bash
npx vitest run src/main/libs/documentTextExtractor.test.ts
~~~

Expected: the new tests fail because local asset options are not accepted or validated.

- [ ] Step 3: Implement options and validation

Import OcrAssetPaths, getMissingOcrAssetPaths, and resolveOcrAssetPaths. Before importing Tesseract, resolve the
explicit or development asset paths and throw an error beginning with OCR asset(s) missing when any required path is
absent. Pass:

~~~typescript
{
  workerPath: assetPaths.workerPath,
  corePath: assetPaths.corePath,
  langPath: assetPaths.langPath,
  gzip: true,
  cacheMethod: 'none',
  logger: options.onProgress
    ? message => {
        if (
          message.status === 'recognizing text' &&
          typeof message.progress === 'number'
        ) {
          options.onProgress(Math.max(0, Math.min(1, message.progress)));
        }
      }
    : undefined,
}
~~~

Preserve the existing HEIC/HEIF conversion branch, input-size check, text trimming, and worker termination in finally.
Update extractDocumentTextFromFile to call extractImageText(normalizedPath, options.image) for image extensions without
changing other parsers.

- [ ] Step 4: Run focused extractor tests

~~~bash
npx vitest run src/main/libs/documentTextExtractor.test.ts src/main/libs/ocrAssets.test.ts
~~~

Expected: PASS.

### Task 4: Wire main process and preload through the shared contract

Files:

- Modify: src/main/main.ts
- Modify: src/main/preload.ts
- Modify: src/renderer/types/electron.d.ts

Interfaces: Main resolves one workspaceOcrAssetPaths value using app.isPackaged, process.resourcesPath, and
path.resolve(__dirname, '..'). Both image OCR and document extraction use those paths. Preload uses DialogIpc for
invocation, listener, and removal.

- [ ] Step 1: Update main imports and resolver

Add resolveOcrAssetPaths beside the extractor imports and define:

~~~typescript
const workspaceOcrAssetPaths = resolveOcrAssetPaths({
  isPackaged: app.isPackaged,
  projectRoot: path.resolve(__dirname, '..'),
  resourcesPath: process.resourcesPath,
});
~~~

- [ ] Step 2: Pass assets from both main handlers

Change extractDocumentTextFromFile(filePath) to extractDocumentTextFromFile(filePath, { image: { assetPaths:
workspaceOcrAssetPaths } }). Change the OCR handler to pass assetPaths: workspaceOcrAssetPaths and send progress with
DialogIpc.ExtractImageTextProgress. Preserve current try/catch return conversion and do not log image bytes or OCR
content.

- [ ] Step 3: Replace preload literals

~~~typescript
extractImageText: (filePath: string) =>
  ipcRenderer.invoke(DialogIpc.ExtractImageText, filePath),
onExtractImageTextProgress: listener => {
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on(DialogIpc.ExtractImageTextProgress, handler);
  return () => ipcRenderer.off(DialogIpc.ExtractImageTextProgress, handler);
},
~~~

Preserve the existing explicit payload types and unsubscribe behavior.

- [ ] Step 4: Compile and lint the main boundary

~~~bash
npm run compile:electron
npx eslint --ext ts --report-unused-disable-directives --max-warnings 0 src/main/main.ts src/main/preload.ts src/main/libs/documentTextExtractor.ts src/main/libs/ocrAssets.ts src/shared/dialog/constants.ts
~~~

Expected: both commands exit 0.

### Task 5: Make renderer OCR orchestration sequential and stateful

Files:

- Modify: src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts
- Modify: src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts

Interfaces: Add EnterpriseLeadOcrStatus with Processing, Completed, and Failed values. Add onOcrState with itemId,
fileName, status, progress, and optional error. Preserve onOcrProgress compatibility.

- [ ] Step 1: Add failing tests

Add one test with two images whose mock OCR records start and end events; assert start:first, end:first, start:second,
end:second and state sequence processing, completed, processing, completed. Add another test returning success with
whitespace-only content; assert the last state is Failed with error OCR returned empty text and the created source has
no text.

- [ ] Step 2: Run helper tests and verify failure

~~~bash
npx vitest run src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
~~~

Expected: the new tests fail because current code uses Promise.all and has no state callback.

- [ ] Step 3: Replace parallel mapping with sequential orchestration

Use a for...of loop over items. Emit Processing at progress 0, subscribe to the existing per-file progress event, clamp
progress to [0, 1], emit Completed at progress 1 only for non-empty text, emit Failed at progress 0 for empty results or
exceptions, include returned errors, always unsubscribe in finally, and push each resolved item before processing the
next item. Do not throw an OCR error out of the loop.

Use:

~~~typescript
export const EnterpriseLeadOcrStatus = {
  Processing: 'processing',
  Completed: 'completed',
  Failed: 'failed',
} as const;

export type EnterpriseLeadOcrStatus =
  (typeof EnterpriseLeadOcrStatus)[keyof typeof EnterpriseLeadOcrStatus];
~~~

- [ ] Step 4: Run renderer helper tests

~~~bash
npx vitest run src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
~~~

Expected: all existing and new helper tests pass.

### Task 6: Surface OCR status in the creation UI and translations

Files:

- Modify: src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx
- Modify: src/renderer/components/enterpriseLeadWorkspace/WorkspaceMaterialUpload.tsx
- Modify: src/renderer/services/i18n.ts
- Modify: src/renderer/types/electron.d.ts

- [ ] Step 1: Add bilingual labels

~~~typescript
// zh
enterpriseLeadMaterialOcrFailed: '文字提取失败，图片仍会保留',
enterpriseLeadMaterialOcrEmpty: '未识别到文字，图片仍会保留',

// en
enterpriseLeadMaterialOcrFailed: 'Text extraction failed; the image will be kept',
enterpriseLeadMaterialOcrEmpty: 'No text detected; the image will be kept',
~~~

- [ ] Step 2: Update WorkspaceCreate from onOcrState

Pass an onOcrState callback that updates the matching material's ocrProgress and sets ocrError to the translated
empty/failure label only when status is Failed. Remove the existing finally inference that derives OCR completion from
item.text; retain setIsCreating(false).

- [ ] Step 3: Update material row rendering

Show progress only for an image with progress in [0, 1) and no error. Keep the existing success badge for non-empty
item.text. When item.ocrError exists, show it as a localized error badge while keeping the file name, size, and remove
button visible. Do not introduce hardcoded user-visible strings.

- [ ] Step 4: Lint renderer changes

~~~bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceMaterialUpload.tsx src/renderer/services/i18n.ts src/renderer/types/electron.d.ts
~~~

Expected: exit 0 with no warnings.

### Task 7: Verify the complete path

Files: Verify all files from Tasks 1–6; do not add unrelated changes.

- [ ] Step 1: Run focused tests

~~~bash
npx vitest run src/shared/dialog/constants.test.ts src/main/libs/ocrAssets.test.ts src/main/libs/documentTextExtractor.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
~~~

- [ ] Step 2: Run Electron compile and renderer build

~~~bash
npm run compile:electron
npm run build
~~~

Expected: both exit 0 and the compile hook confirms OCR assets exist.

- [ ] Step 3: Run the official test command

~~~bash
npm test
~~~

Expected: zero failures. Report unrelated legacy failures separately if any.

- [ ] Step 4: Inspect the diff

~~~bash
git diff --check
git status --short
git diff --stat
git diff -- src/shared/dialog/constants.ts src/main/libs/ocrAssets.ts src/main/libs/documentTextExtractor.ts src/main/main.ts src/main/preload.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceMaterialUpload.tsx src/renderer/services/i18n.ts package.json electron-builder.json
~~~

Confirm no generated runtime output, unrelated formatting churn, OCR content in logs, or remaining OCR channel literals
outside the shared constants and tests.

- [ ] Step 5: Manually validate Electron behavior

Run npm run electron:dev and verify that a Chinese/English PNG or JPG shows OCR progress, the created workspace contains
searchable extracted text, an image with no readable text still creates the workspace and remains attached, and a
missing local OCR asset shows a failure label while preserving the image. Restore any temporarily renamed resource file.

Do not commit until the user has tested and explicitly confirmed the behavior.
