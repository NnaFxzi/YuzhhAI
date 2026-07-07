import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import * as XLSX from 'xlsx';

import { extractDocumentTextFromFile, isSupportedDocumentTextFile } from './documentTextExtractor';

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

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'document-text-extractor-'));
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

  test('extracts readable text from pdf files', async () => {
    const filePath = path.join(tmpDir, 'knowledge.pdf');
    await fs.writeFile(filePath, buildMinimalPdf('Hello PDF Knowledge'), 'binary');

    const result = await extractDocumentTextFromFile(filePath);

    expect(result.parser).toBe('pdf');
    expect(result.content).toContain('Hello PDF Knowledge');
  });

  test('keeps unsupported legacy word files out of the readable path', () => {
    expect(isSupportedDocumentTextFile('/tmp/legacy.doc')).toBe(false);
    expect(isSupportedDocumentTextFile('/tmp/modern.docx')).toBe(true);
    expect(isSupportedDocumentTextFile('/tmp/sheet.xlsx')).toBe(true);
    expect(isSupportedDocumentTextFile('/tmp/report.pdf')).toBe(true);
  });
});
