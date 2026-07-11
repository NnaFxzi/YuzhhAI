const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'resources', 'ocr');
const legacyWorkerPath = path.join(output, 'worker.min.js');
const languages = ['eng', 'chi_sim'];
const dataBase = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';
const checkOnly = process.argv.includes('--check');
const workerOutput = path.join(output, 'worker.node.cjs');
const coreRoot = path.dirname(require.resolve('tesseract.js-core/package.json'));
const coreWasmNames = fs
  .readdirSync(coreRoot)
  .filter(fileName => /^tesseract-core.*\.wasm$/.test(fileName))
  .sort();
const copies = [
  [require.resolve('tesseract.js-core/tesseract-core.wasm.js'), 'tesseract-core.wasm.js'],
  ...coreWasmNames.map(fileName => [path.join(coreRoot, fileName), fileName]),
];

const ensureFile = async (target, downloadUrl) => {
  if (fs.existsSync(target) && fs.statSync(target).size > 0) {
    return;
  }
  if (checkOnly) {
    throw new Error('Missing OCR asset: ' + target);
  }
  if (!downloadUrl) {
    throw new Error('Missing OCR asset source: ' + target);
  }
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error('Failed to download ' + downloadUrl + ': ' + response.status);
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length === 0) {
    throw new Error('Downloaded empty OCR asset: ' + downloadUrl);
  }
  await fsp.writeFile(target, data);
};

const main = async () => {
  if (checkOnly) {
    await ensureFile(workerOutput);
    for (const [, name] of copies) {
      await ensureFile(path.join(output, name));
    }
  } else {
    await fsp.mkdir(output, { recursive: true });
    await fsp.rm(legacyWorkerPath, { force: true });
    await build({
      bundle: true,
      entryPoints: [require.resolve('tesseract.js/src/worker-script/node/index.js')],
      external: ['worker_threads'],
      format: 'cjs',
      outfile: workerOutput,
      platform: 'node',
    });
    for (const [source, name] of copies) {
      await fsp.copyFile(source, path.join(output, name));
    }
  }

  for (const language of languages) {
    await ensureFile(
      path.join(output, language + '.traineddata.gz'),
      dataBase + '/' + language + '/4.0.0_best_int/' + language + '.traineddata.gz',
    );
  }
};

main().catch(error => {
  console.error('[OCR assets] Failed to prepare OCR assets:', error);
  process.exitCode = 1;
});
