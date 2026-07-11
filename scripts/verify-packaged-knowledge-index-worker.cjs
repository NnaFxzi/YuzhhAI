'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { app } = require('electron');

const walk = (root, matches) => {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) walk(entryPath, matches);
    else matches.push(entryPath);
  }
};

const findOne = (files, suffix) => {
  const normalizedSuffix = path.normalize(suffix);
  const matches = files.filter(filePath => path.normalize(filePath).endsWith(normalizedSuffix));
  if (matches.length !== 1) {
    throw new Error(`Expected one packaged ${suffix}, found ${matches.length}`);
  }
  return matches[0];
};

const request = (worker, requestId, kind) => new Promise((resolve, reject) => {
  let settled = false;
  let timeout;
  const cleanup = () => {
    clearTimeout(timeout);
    worker.off('error', onError);
    worker.off('message', onMessage);
  };
  const fail = error => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(error);
  };
  const onError = error => fail(error);
  const onMessage = message => {
    if (message?.requestId !== requestId) return;
    if (settled) return;
    settled = true;
    cleanup();
    resolve(message);
  };
  timeout = setTimeout(() => fail(new Error(`Worker ${kind} timed out`)), 10_000);
  worker.once('error', onError);
  worker.on('message', onMessage);
  try {
    worker.postMessage({ requestId, kind });
  } catch (error) {
    fail(error);
  }
});

app.whenReady().then(async () => {
  const releaseRoot = path.resolve(process.argv[2] || 'release');
  const files = [];
  walk(releaseRoot, files);
  const workerPath = findOne(
    files,
    path.join('app.asar.unpacked', 'dist-electron', 'knowledge-index-worker.js'),
  );
  const nativePath = findOne(
    files,
    path.join(
      'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build',
      'Release', 'better_sqlite3.node',
    ),
  );
  const packageRoot = nativePath.slice(0, nativePath.indexOf(`${path.sep}build${path.sep}Release`));
  const Database = require(packageRoot);
  let tempDirectory = null;
  let db = null;
  let worker = null;
  try {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-worker-package-'));
    const databasePath = path.join(tempDirectory, 'smoke.sqlite');
    db = new Database(databasePath);
    db.exec(`
      CREATE TABLE enterprise_lead_workspaces (id TEXT PRIMARY KEY);
      CREATE TABLE knowledge_documents (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, current_version_id TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE knowledge_document_versions (
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL, extracted_text TEXT
      );
    `);
    db.close();
    db = null;

    worker = new Worker(workerPath, { workerData: { databasePath } });
    const result = await request(worker, 'smoke-run', 'run');
    if (
      result.kind !== 'result' ||
      result.result.indexedCount !== 0 ||
      result.result.failedCount !== 0
    ) {
      throw new Error(`Unexpected packaged worker result: ${JSON.stringify(result)}`);
    }
    const stopped = await request(worker, 'smoke-stop', 'shutdown');
    if (stopped.kind !== 'stopped') throw new Error('Packaged worker did not stop cleanly');
  } finally {
    try {
      if (worker) {
        await worker.terminate();
      }
    } finally {
      try {
        if (db) {
          db.close();
        }
      } finally {
        if (tempDirectory) {
          fs.rmSync(tempDirectory, { recursive: true, force: true });
        }
      }
    }
  }
  app.exit(0);
}).catch(error => {
  console.error(error);
  app.exit(1);
});
