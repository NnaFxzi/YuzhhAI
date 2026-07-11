import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as XLSX from 'xlsx';

import {
  extractDocumentTextFromFile,
  extractImageText,
  isSupportedDocumentTextFile,
} from './documentTextExtractor';
import type { OcrAssetPaths } from './ocrAssets';

const tesseractMock = vi.hoisted(() => ({
  createWorker: vi.fn(),
}));

vi.mock('tesseract.js', () => ({
  createWorker: tesseractMock.createWorker,
  default: { createWorker: tesseractMock.createWorker },
}));

const buildMinimalPdf = (text: string): string => {
  const stream = `BT /F1 24 Tf 100 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'binary')} >>\nstream\n${stream}\nendstream`,
  ];

  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(body, 'binary');
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xrefOffset = Buffer.byteLength(body, 'binary');
  const xrefRows = offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n');

  return `${body}xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xrefRows}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
};

describe('documentTextExtractor', () => {
  let tmpDir = '';

  const createOcrAssetPaths = async (): Promise<OcrAssetPaths> => {
    const root = path.join(tmpDir, 'ocr');
    await fs.mkdir(root, { recursive: true });
    const workerPath = path.join(root, 'worker.node.cjs');
    const corePath = path.join(root, 'tesseract-core.wasm.js');
    const engPath = path.join(root, 'eng.traineddata.gz');
    const chiSimPath = path.join(root, 'chi_sim.traineddata.gz');
    await Promise.all(
      [workerPath, corePath, engPath, chiSimPath].map(filePath => fs.writeFile(filePath, '')),
    );
    return {
      root,
      workerPath,
      corePath,
      langPath: root,
      languageDataPaths: [engPath, chiSimPath],
      coreWasmPaths: [],
    };
  };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'document-text-extractor-'));
    tesseractMock.createWorker.mockReset();
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { force: true, recursive: true });
    }
  });

  test('extracts readable text from docx files', async () => {
    const archive = new JSZip();
    archive.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?>');
    archive.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?>');
    archive.file(
      'word/document.xml',
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
        '<w:body>',
        '<w:p><w:r><w:t>产品定位：企业知识库</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>核心卖点：自动入向量库</w:t></w:r></w:p>',
        '</w:body>',
        '</w:document>',
      ].join(''),
    );
    const filePath = path.join(tmpDir, 'knowledge.docx');
    await fs.writeFile(filePath, await archive.generateAsync({ type: 'nodebuffer' }));

    const result = await extractDocumentTextFromFile(filePath);

    expect(result.parser).toBe('docx');
    expect(result.content).toContain('产品定位：企业知识库');
    expect(result.content).toContain('核心卖点：自动入向量库');
  });

  test('extracts readable text from xlsx files', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['选题', '人群'],
      ['小红书选题拆解', '内容运营'],
      ['私域话术优化', '销售顾问'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, '内容资料');
    const filePath = path.join(tmpDir, 'knowledge.xlsx');
    XLSX.writeFile(workbook, filePath);

    const result = await extractDocumentTextFromFile(filePath);

    expect(result.parser).toBe('xlsx');
    expect(result.content).toContain('# 内容资料');
    expect(result.content).toContain('小红书选题拆解');
    expect(result.content).toContain('私域话术优化');
  });

  test('reads xlsx data through the main-process file reader when the SheetJS file adapter is unavailable', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['产品', '库存'],
      ['精密零件', 128],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, '库存资料');
    const filePath = path.join(tmpDir, 'inventory.xlsx');
    XLSX.writeFile(workbook, filePath);
    const originalReadFileSync = fsSync.readFileSync;
    fsSync.readFileSync = ((targetPath: string | Buffer | URL | number, ...args: unknown[]) => {
      if (targetPath === filePath) {
        throw new Error(`Cannot access file ${filePath}`);
      }
      return (originalReadFileSync as (...readArgs: unknown[]) => Buffer)(targetPath, ...args);
    }) as typeof fsSync.readFileSync;

    try {
      const result = await extractDocumentTextFromFile(filePath);

      expect(result.content).toContain('# 库存资料');
      expect(result.content).toContain('精密零件');
    } finally {
      fsSync.readFileSync = originalReadFileSync;
    }
  });

  test('extracts readable text from pdf files', async () => {
    const filePath = path.join(tmpDir, 'knowledge.pdf');
    await fs.writeFile(filePath, buildMinimalPdf('Hello PDF Knowledge'), 'binary');

    const result = await extractDocumentTextFromFile(filePath);

    expect(result.parser).toBe('pdf');
    expect(result.content).toContain('Hello PDF Knowledge');
  });

  test('uses local Node OCR assets for image text extraction', async () => {
    const assetPaths = await createOcrAssetPaths();
    const filePath = path.join(tmpDir, 'factory.png');
    await fs.writeFile(filePath, 'image');
    const progress = vi.fn();
    const worker = {
      recognize: vi.fn().mockResolvedValue({ data: { text: '工厂资料' } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    tesseractMock.createWorker.mockResolvedValueOnce(worker);

    const result = await extractImageText(filePath, { assetPaths, onProgress: progress });

    expect(result).toMatchObject({ content: '工厂资料', parser: 'image' });
    expect(tesseractMock.createWorker).toHaveBeenCalledWith(
      ['eng', 'chi_sim'],
      1,
      expect.objectContaining({
        workerPath: assetPaths.workerPath,
        corePath: assetPaths.corePath,
        langPath: assetPaths.langPath,
        gzip: true,
        cacheMethod: 'none',
        logger: expect.any(Function),
      }),
    );
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  test('does not pass an undefined logger to the Tesseract worker', async () => {
    const assetPaths = await createOcrAssetPaths();
    const filePath = path.join(tmpDir, 'factory.png');
    await fs.writeFile(filePath, 'image');
    tesseractMock.createWorker.mockResolvedValueOnce({
      recognize: vi.fn().mockResolvedValue({ data: { text: '' } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    });

    await extractImageText(filePath, { assetPaths });

    const workerOptions = tesseractMock.createWorker.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(workerOptions).not.toHaveProperty('logger');
  });

  test('overrides the PDF.js Node worker default with the installed worker module', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const requireForWorker = createRequire(import.meta.url);
    const expectedWorkerPath = requireForWorker.resolve('pdfjs-dist/build/pdf.worker.min.mjs');
    const filePath = path.join(tmpDir, 'worker-path.pdf');
    await fs.writeFile(filePath, buildMinimalPdf('PDF Worker Path'), 'binary');

    pdfjs.GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';
    await extractDocumentTextFromFile(filePath);

    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe(expectedWorkerPath);
  });

  test('extracts readable text from pptx files', async () => {
    const archive = new JSZip();
    archive.file(
      'ppt/slides/slide1.xml',
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"',
        ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
        '<p:cSld><p:spTree>',
        '<p:sp><p:txBody><a:p><a:r><a:t>目标客户：连锁门店</a:t></a:r></a:p></p:txBody></p:sp>',
        '<p:sp><p:txBody><a:p><a:r><a:t>核心卖点：门店增长 SOP</a:t></a:r></a:p></p:txBody></p:sp>',
        '</p:spTree></p:cSld>',
        '</p:sld>',
      ].join(''),
    );
    const filePath = path.join(tmpDir, 'knowledge.pptx');
    await fs.writeFile(filePath, await archive.generateAsync({ type: 'nodebuffer' }));

    const result = await extractDocumentTextFromFile(filePath);

    expect(result.parser).toBe('pptx');
    expect(result.content).toContain('目标客户：连锁门店');
    expect(result.content).toContain('核心卖点：门店增长 SOP');
  });

  test('keeps unsupported legacy word files out of the readable path', () => {
    expect(isSupportedDocumentTextFile('/tmp/legacy.doc')).toBe(false);
    expect(isSupportedDocumentTextFile('/tmp/modern.docx')).toBe(true);
    expect(isSupportedDocumentTextFile('/tmp/sheet.xlsx')).toBe(true);
    expect(isSupportedDocumentTextFile('/tmp/report.pdf')).toBe(true);
    expect(isSupportedDocumentTextFile('/tmp/slides.pptx')).toBe(true);
  });
});
