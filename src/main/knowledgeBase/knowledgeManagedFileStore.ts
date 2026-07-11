import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  KNOWLEDGE_MAX_FILE_BYTES,
  KnowledgeBaseErrorCode,
} from '../../shared/knowledgeBase/constants';

const KNOWLEDGE_TEMP_FILE_CLEANUP_MIN_AGE_MS = 60 * 60_000;
const KNOWLEDGE_TEMP_FILE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i;

export interface ImportedKnowledgeBlob {
  contentHash: string;
  fileSize: number;
  managedPath: string;
  reused: boolean;
}

export class KnowledgeManagedFileError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'KnowledgeManagedFileError';
    this.code = code;
  }
}

export class KnowledgeManagedFileStore {
  private readonly temporaryDir: string;

  constructor(private readonly rootDir: string) {
    this.temporaryDir = path.join(rootDir, 'tmp');
  }

  async importFile(sourcePath: string): Promise<ImportedKnowledgeBlob> {
    await this.ensureDirectories();
    const stat = await fs.stat(sourcePath);
    if (!stat.isFile()) {
      throw new Error('Knowledge source is not a file');
    }
    this.assertSizeAllowed(stat.size);
    return this.importReadable(createReadStream(sourcePath));
  }

  async importTextSnapshot(text: string): Promise<ImportedKnowledgeBlob> {
    await this.ensureDirectories();
    const content = Buffer.from(text, 'utf8');
    this.assertSizeAllowed(content.byteLength);
    return this.importReadable(Readable.from([content]));
  }

  resolveManagedPath(managedPath: string): string {
    if (!/^blobs\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(managedPath)) {
      throw new KnowledgeManagedFileError(
        KnowledgeBaseErrorCode.InvalidManagedPath,
        'Invalid managed blob path',
      );
    }

    const resolvedRoot = path.resolve(this.rootDir);
    const resolvedPath = path.resolve(resolvedRoot, ...managedPath.split('/'));
    if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new KnowledgeManagedFileError(
        KnowledgeBaseErrorCode.InvalidManagedPath,
        'Invalid managed blob path',
      );
    }
    return resolvedPath;
  }

  async cleanupAbandonedTemporaryFiles(nowMs = Date.now()): Promise<number> {
    await this.ensureDirectories();
    const fileNames = await fs.readdir(this.temporaryDir);
    let removedCount = 0;
    for (const fileName of fileNames) {
      if (!KNOWLEDGE_TEMP_FILE_NAME_PATTERN.test(fileName)) {
        continue;
      }
      const temporaryPath = path.join(this.temporaryDir, fileName);
      try {
        const stat = await fs.stat(temporaryPath);
        if (
          !stat.isFile() ||
          nowMs - stat.mtimeMs < KNOWLEDGE_TEMP_FILE_CLEANUP_MIN_AGE_MS
        ) {
          continue;
        }
        await fs.rm(temporaryPath);
        removedCount += 1;
      } catch {
        // Another process or a concurrent import may have already removed the file.
      }
    }
    return removedCount;
  }

  private async importReadable(source: Readable): Promise<ImportedKnowledgeBlob> {
    const temporaryPath = path.join(this.temporaryDir, `${randomUUID()}.tmp`);
    const hash = createHash('sha256');
    let fileSize = 0;
    const hashAndLimit = new Transform({
      transform: (chunk: Buffer | string, _encoding, callback) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        fileSize += buffer.byteLength;
        if (fileSize > KNOWLEDGE_MAX_FILE_BYTES) {
          callback(this.createFileTooLargeError());
          return;
        }
        hash.update(buffer);
        callback(null, buffer);
      },
    });

    try {
      await pipeline(source, hashAndLimit, createWriteStream(temporaryPath, { flags: 'wx' }));
      const handle = await fs.open(temporaryPath, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }

      const contentHash = hash.digest('hex');
      const managedPath = `blobs/${contentHash.slice(0, 2)}/${contentHash}`;
      const targetPath = this.resolveManagedPath(managedPath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });

      let reused = false;
      try {
        await fs.link(temporaryPath, targetPath);
      } catch (error) {
        if (!this.isAlreadyExistsError(error)) {
          throw error;
        }
        reused = true;
      }

      return {
        contentHash,
        fileSize,
        managedPath,
        reused,
      };
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch((): void => undefined);
    }
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.temporaryDir, { recursive: true });
    await fs.mkdir(path.join(this.rootDir, 'blobs'), { recursive: true });
  }

  private assertSizeAllowed(fileSize: number): void {
    if (fileSize > KNOWLEDGE_MAX_FILE_BYTES) {
      throw this.createFileTooLargeError();
    }
  }

  private createFileTooLargeError(): KnowledgeManagedFileError {
    return new KnowledgeManagedFileError(
      KnowledgeBaseErrorCode.FileTooLarge,
      `Knowledge file is too large (max ${KNOWLEDGE_MAX_FILE_BYTES} bytes)`,
    );
  }

  private isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error && error.code === 'EEXIST';
  }
}
