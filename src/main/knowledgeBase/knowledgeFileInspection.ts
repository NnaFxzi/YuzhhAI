import fs from 'node:fs/promises';
import path from 'node:path';

import {
  KNOWLEDGE_MAX_FILE_BYTES,
  type KnowledgeBaseErrorCode,
  KnowledgeBaseErrorCode as KnowledgeBaseErrorCodes,
} from '../../shared/knowledgeBase/constants';

export interface KnowledgeFileInspection {
  absolutePath: string;
  displayName: string;
  extension: string;
  mimeType: string;
  fileSize: number;
  sourceMtime: number;
  canExtractText: boolean;
}

interface KnowledgeFileDefinition {
  canExtractText: boolean;
  matches: (header: Buffer) => boolean;
  mimeType: string;
}

export class KnowledgeFileInspectionError extends Error {
  constructor(readonly code: KnowledgeBaseErrorCode) {
    super(code);
    this.name = 'KnowledgeFileInspectionError';
  }
}

const startsWith = (header: Buffer, signature: Buffer): boolean =>
  header.length >= signature.length && header.subarray(0, signature.length).equals(signature);

const hasZipHeader = (header: Buffer): boolean =>
  startsWith(header, Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
  startsWith(header, Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
  startsWith(header, Buffer.from([0x50, 0x4b, 0x07, 0x08]));

const hasOleHeader = (header: Buffer): boolean =>
  startsWith(header, Buffer.from('d0cf11e0a1b11ae1', 'hex'));

const hasPlainTextHeader = (header: Buffer): boolean => !header.includes(0);

const hasWebpHeader = (header: Buffer): boolean =>
  header.length >= 12 &&
  header.subarray(0, 4).toString('ascii') === 'RIFF' &&
  header.subarray(8, 12).toString('ascii') === 'WEBP';

const hasHeifHeader = (header: Buffer): boolean => {
  if (header.length < 12 || header.subarray(4, 8).toString('ascii') !== 'ftyp') {
    return false;
  }
  return new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']).has(
    header.subarray(8, 12).toString('ascii'),
  );
};

const plainTextDefinitions: Record<string, string> = {
  '.csv': 'text/csv',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.log': 'text/plain',
  '.markdown': 'text/markdown',
  '.md': 'text/markdown',
  '.tsv': 'text/tab-separated-values',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
};

const fileDefinitions = new Map<string, KnowledgeFileDefinition>();
Object.entries(plainTextDefinitions).forEach(([extension, mimeType]) => {
  fileDefinitions.set(extension, {
    canExtractText: true,
    matches: hasPlainTextHeader,
    mimeType,
  });
});

const define = (
  extensions: string[],
  definition: Omit<KnowledgeFileDefinition, 'mimeType'> & { mimeType: string },
): void => {
  extensions.forEach(extension => fileDefinitions.set(extension, definition));
};

define(['.pdf'], {
  canExtractText: true,
  matches: header => startsWith(header, Buffer.from('%PDF-', 'ascii')),
  mimeType: 'application/pdf',
});
define(['.docx'], {
  canExtractText: true,
  matches: hasZipHeader,
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});
define(['.xlsx'], {
  canExtractText: true,
  matches: hasZipHeader,
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});
define(['.pptx'], {
  canExtractText: true,
  matches: hasZipHeader,
  mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
});
define(['.xls'], {
  canExtractText: true,
  matches: hasOleHeader,
  mimeType: 'application/vnd.ms-excel',
});
define(['.doc'], {
  canExtractText: false,
  matches: hasOleHeader,
  mimeType: 'application/msword',
});
define(['.ppt'], {
  canExtractText: false,
  matches: hasOleHeader,
  mimeType: 'application/vnd.ms-powerpoint',
});
define(['.png'], {
  canExtractText: true,
  matches: header => startsWith(header, Buffer.from('89504e470d0a1a0a', 'hex')),
  mimeType: 'image/png',
});
define(['.jpg', '.jpeg'], {
  canExtractText: true,
  matches: header => startsWith(header, Buffer.from([0xff, 0xd8, 0xff])),
  mimeType: 'image/jpeg',
});
define(['.gif'], {
  canExtractText: true,
  matches: header => {
    const signature = header.subarray(0, 6).toString('ascii');
    return signature === 'GIF87a' || signature === 'GIF89a';
  },
  mimeType: 'image/gif',
});
define(['.bmp'], {
  canExtractText: true,
  matches: header => startsWith(header, Buffer.from('BM', 'ascii')),
  mimeType: 'image/bmp',
});
define(['.tif', '.tiff'], {
  canExtractText: true,
  matches: header =>
    startsWith(header, Buffer.from('49492a00', 'hex')) ||
    startsWith(header, Buffer.from('4d4d002a', 'hex')),
  mimeType: 'image/tiff',
});
define(['.webp'], {
  canExtractText: true,
  matches: hasWebpHeader,
  mimeType: 'image/webp',
});
define(['.heic'], {
  canExtractText: true,
  matches: hasHeifHeader,
  mimeType: 'image/heic',
});
define(['.heif'], {
  canExtractText: true,
  matches: hasHeifHeader,
  mimeType: 'image/heif',
});

const readHeader = async (filePath: string, length: number): Promise<Buffer> => {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

export const inspectKnowledgeFile = async (
  absolutePath: string,
): Promise<KnowledgeFileInspection> => {
  const resolvedPath = path.resolve(absolutePath.trim());
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(resolvedPath);
  } catch {
    throw new KnowledgeFileInspectionError(KnowledgeBaseErrorCodes.SelectedFileMissing);
  }
  if (!stat.isFile()) {
    throw new KnowledgeFileInspectionError(KnowledgeBaseErrorCodes.UnsupportedFileType);
  }
  if (stat.size > KNOWLEDGE_MAX_FILE_BYTES) {
    throw new KnowledgeFileInspectionError(KnowledgeBaseErrorCodes.FileTooLarge);
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  const definition = fileDefinitions.get(extension);
  if (!definition) {
    throw new KnowledgeFileInspectionError(KnowledgeBaseErrorCodes.UnsupportedFileType);
  }
  const header = await readHeader(resolvedPath, 512);
  if (!definition.matches(header)) {
    throw new KnowledgeFileInspectionError(KnowledgeBaseErrorCodes.UnsupportedFileType);
  }

  return {
    absolutePath: resolvedPath,
    displayName: path.basename(resolvedPath),
    extension,
    mimeType: definition.mimeType,
    fileSize: stat.size,
    sourceMtime: stat.mtimeMs,
    canExtractText: definition.canExtractText,
  };
};
