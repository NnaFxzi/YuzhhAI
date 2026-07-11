import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  KNOWLEDGE_MAX_FILE_BYTES,
  KnowledgeBaseErrorCode,
} from '../../shared/knowledgeBase/constants';
import { inspectKnowledgeFile } from './knowledgeFileInspection';

describe('inspectKnowledgeFile', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-file-inspection-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const writeFixture = async (fileName: string, content: Buffer | string): Promise<string> => {
    const filePath = path.join(tempDir, fileName);
    await fs.writeFile(filePath, content);
    return filePath;
  };

  test('accepts a PDF only when its header matches the selected extension', async () => {
    const pdf = await writeFixture('manual.pdf', '%PDF-1.7\n');
    await expect(inspectKnowledgeFile(pdf)).resolves.toMatchObject({
      absolutePath: pdf,
      canExtractText: true,
      displayName: 'manual.pdf',
      extension: '.pdf',
      mimeType: 'application/pdf',
    });

    const disguised = await writeFixture('fake.pdf', 'not a pdf');
    await expect(inspectKnowledgeFile(disguised)).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.UnsupportedFileType,
    });
  });

  test('accepts ZIP-based Office formats and rejects a mismatched header', async () => {
    const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    const docx = await writeFixture('manual.docx', zipHeader);
    await expect(inspectKnowledgeFile(docx)).resolves.toMatchObject({
      canExtractText: true,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    const fakeXlsx = await writeFixture('fake.xlsx', '%PDF-1.7');
    await expect(inspectKnowledgeFile(fakeXlsx)).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.UnsupportedFileType,
    });
  });

  test('keeps legacy DOC and PPT files as explicit no-text attachments', async () => {
    const oleHeader = Buffer.from('d0cf11e0a1b11ae1', 'hex');
    const document = await writeFixture('legacy.doc', oleHeader);
    const presentation = await writeFixture('legacy.ppt', oleHeader);

    await expect(inspectKnowledgeFile(document)).resolves.toMatchObject({
      canExtractText: false,
      extension: '.doc',
      mimeType: 'application/msword',
    });
    await expect(inspectKnowledgeFile(presentation)).resolves.toMatchObject({
      canExtractText: false,
      extension: '.ppt',
      mimeType: 'application/vnd.ms-powerpoint',
    });
  });

  test('accepts known image signatures', async () => {
    const fixtures: Array<[string, Buffer, string]> = [
      ['image.png', Buffer.from('89504e470d0a1a0a', 'hex'), 'image/png'],
      ['image.jpg', Buffer.from('ffd8ffe000104a46', 'hex'), 'image/jpeg'],
      ['image.gif', Buffer.from('GIF89a', 'ascii'), 'image/gif'],
      ['image.bmp', Buffer.from('BMxxxx', 'ascii'), 'image/bmp'],
      ['image.tif', Buffer.from('49492a00', 'hex'), 'image/tiff'],
      ['image.webp', Buffer.from('RIFF0000WEBP', 'ascii'), 'image/webp'],
      ['image.heic', Buffer.from('000000186674797068656963', 'hex'), 'image/heic'],
    ];

    for (const [fileName, header, mimeType] of fixtures) {
      const filePath = await writeFixture(fileName, header);
      await expect(inspectKnowledgeFile(filePath)).resolves.toMatchObject({
        canExtractText: true,
        mimeType,
      });
    }
  });

  test('rejects binary bytes disguised as a plain-text extension', async () => {
    const markdown = await writeFixture('valid.md', '# Local knowledge');
    await expect(inspectKnowledgeFile(markdown)).resolves.toMatchObject({
      canExtractText: true,
      mimeType: 'text/markdown',
    });

    const disguised = await writeFixture('fake.md', Buffer.from([0, 1, 2, 3]));
    await expect(inspectKnowledgeFile(disguised)).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.UnsupportedFileType,
    });
  });

  test('rejects unsupported, missing, directory, and oversized inputs with stable codes', async () => {
    const unsupported = await writeFixture('archive.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    await expect(inspectKnowledgeFile(unsupported)).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.UnsupportedFileType,
    });
    await expect(inspectKnowledgeFile(path.join(tempDir, 'missing.pdf'))).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.SelectedFileMissing,
    });
    await expect(inspectKnowledgeFile(tempDir)).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.UnsupportedFileType,
    });

    const oversized = path.join(tempDir, 'oversized.pdf');
    await fs.writeFile(oversized, '%PDF-1.7');
    await fs.truncate(oversized, KNOWLEDGE_MAX_FILE_BYTES + 1);
    await expect(inspectKnowledgeFile(oversized)).rejects.toMatchObject({
      code: KnowledgeBaseErrorCode.FileTooLarge,
    });
  });
});
