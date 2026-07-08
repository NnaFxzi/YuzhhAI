import fs from 'node:fs/promises';
import path from 'node:path';

import JSZip from 'jszip';
import * as XLSX from 'xlsx';

import {
  EnterpriseLeadPlainTextDocumentExtensions,
  EnterpriseLeadReadableDocumentExtension,
  EnterpriseLeadReadableDocumentExtensions,
} from '../../shared/enterpriseLeadWorkspace/constants';

export const MAX_DOCUMENT_TEXT_READ_BYTES = 2 * 1024 * 1024;
export const MAX_EXTRACTED_DOCUMENT_TEXT_CHARS = 2 * 1024 * 1024;
export const MAX_RICH_DOCUMENT_BYTES = 50 * 1024 * 1024;

export type DocumentTextParser = 'text' | 'docx' | 'xlsx' | 'pdf' | 'pptx';

export interface ExtractedDocumentText {
  content: string;
  size: number;
  readBytes: number;
  truncated: boolean;
  parser: DocumentTextParser;
}

const dotExtension = (extension: string): string => `.${extension}`;

const TEXT_DOCUMENT_EXTENSIONS = new Set(
  EnterpriseLeadPlainTextDocumentExtensions.map(dotExtension),
);

export const SUPPORTED_DOCUMENT_TEXT_EXTENSIONS = new Set([
  ...EnterpriseLeadReadableDocumentExtensions.map(dotExtension),
]);

const getNormalizedExtension = (filePath: string): string =>
  path.extname(filePath).trim().toLowerCase();

export const isSupportedDocumentTextFile = (filePath: string): boolean =>
  SUPPORTED_DOCUMENT_TEXT_EXTENSIONS.has(getNormalizedExtension(filePath));

const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 10)),
    )
    .replace(/&#x([\da-f]+);/gi, (_match, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    );

const collapseBlankLines = (value: string): string =>
  value
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const clampContent = (
  content: string,
  alreadyTruncated = false,
): { content: string; truncated: boolean } => {
  if (content.length <= MAX_EXTRACTED_DOCUMENT_TEXT_CHARS) {
    return { content, truncated: alreadyTruncated };
  }
  return {
    content: content.slice(0, MAX_EXTRACTED_DOCUMENT_TEXT_CHARS),
    truncated: true,
  };
};

const ensureRichDocumentSize = (filePath: string, size: number): void => {
  if (size > MAX_RICH_DOCUMENT_BYTES) {
    throw new Error(
      `File too large for document text extraction (max ${Math.floor(MAX_RICH_DOCUMENT_BYTES / (1024 * 1024))}MB): ${filePath}`,
    );
  }
};

const extractPlainTextFile = async (
  filePath: string,
  size: number,
): Promise<ExtractedDocumentText> => {
  const truncatedByBytes = size > MAX_DOCUMENT_TEXT_READ_BYTES;
  const handle = await fs.open(filePath, 'r');
  try {
    const bytesToRead = Math.min(size, MAX_DOCUMENT_TEXT_READ_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    const clamped = clampContent(buffer.subarray(0, bytesRead).toString('utf8'), truncatedByBytes);
    return {
      content: clamped.content,
      parser: 'text',
      readBytes: bytesRead,
      size,
      truncated: clamped.truncated,
    };
  } finally {
    await handle.close();
  }
};

const extractDocxTextBlock = (xml: string): string => {
  const normalizedXml = xml.replace(/<w:tab\s*\/>/g, '\t').replace(/<w:br\s*\/>/g, '\n');
  const lines: string[] = [];
  const paragraphs = normalizedXml.match(/<w:p[\s\S]*?<\/w:p>/g) ?? [normalizedXml];
  for (const paragraph of paragraphs) {
    const textRuns: string[] = [];
    const textRunPattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let textRunMatch: RegExpExecArray | null = textRunPattern.exec(paragraph);
    while (textRunMatch) {
      textRuns.push(decodeXmlEntities(textRunMatch[1] ?? ''));
      textRunMatch = textRunPattern.exec(paragraph);
    }
    const line = textRuns.join('').trim();
    if (line) {
      lines.push(line);
    }
  }
  return lines.join('\n');
};

const extractDocxText = async (filePath: string, size: number): Promise<ExtractedDocumentText> => {
  ensureRichDocumentSize(filePath, size);
  const archive = await JSZip.loadAsync(await fs.readFile(filePath));
  const xmlPaths = Object.keys(archive.files)
    .filter(fileName => /^word\/(?:document|header\d+|footer\d+)\.xml$/i.test(fileName))
    .sort((left, right) => {
      if (left === 'word/document.xml') {
        return -1;
      }
      if (right === 'word/document.xml') {
        return 1;
      }
      return left.localeCompare(right);
    });
  const blocks: string[] = [];
  for (const xmlPath of xmlPaths) {
    const entry = archive.file(xmlPath);
    if (!entry) {
      continue;
    }
    const block = extractDocxTextBlock(await entry.async('text'));
    if (block) {
      blocks.push(block);
    }
  }
  const clamped = clampContent(collapseBlankLines(blocks.join('\n\n')));
  return {
    content: clamped.content,
    parser: 'docx',
    readBytes: size,
    size,
    truncated: clamped.truncated,
  };
};

const extractSpreadsheetText = async (
  filePath: string,
  size: number,
): Promise<ExtractedDocumentText> => {
  ensureRichDocumentSize(filePath, size);
  const workbook = XLSX.readFile(filePath, {
    cellDates: true,
    cellHTML: false,
  });
  const sheets = workbook.SheetNames.map(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      return '';
    }
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
    return csv ? `# ${sheetName}\n${csv}` : '';
  }).filter(Boolean);
  const clamped = clampContent(collapseBlankLines(sheets.join('\n\n')));
  return {
    content: clamped.content,
    parser: 'xlsx',
    readBytes: size,
    size,
    truncated: clamped.truncated,
  };
};

const getPptxXmlSortKey = (xmlPath: string): string => {
  const slideMatch = /\/slide(\d+)\.xml$/i.exec(xmlPath);
  if (slideMatch) {
    return `0-${String(Number.parseInt(slideMatch[1] ?? '0', 10)).padStart(6, '0')}`;
  }
  const notesMatch = /\/notesSlide(\d+)\.xml$/i.exec(xmlPath);
  if (notesMatch) {
    return `1-${String(Number.parseInt(notesMatch[1] ?? '0', 10)).padStart(6, '0')}`;
  }
  return xmlPath;
};

const extractPptxTextBlock = (xml: string): string => {
  const normalizedXml = xml.replace(/<a:br\s*\/>/gi, '\n').replace(/<\/a:p>/gi, '\n');
  const textRuns: string[] = [];
  const textRunPattern = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi;
  let textRunMatch: RegExpExecArray | null = textRunPattern.exec(normalizedXml);
  while (textRunMatch) {
    const text = decodeXmlEntities(textRunMatch[1] ?? '').trim();
    if (text) {
      textRuns.push(text);
    }
    textRunMatch = textRunPattern.exec(normalizedXml);
  }
  return collapseBlankLines(textRuns.join('\n'));
};

const extractPptxText = async (filePath: string, size: number): Promise<ExtractedDocumentText> => {
  ensureRichDocumentSize(filePath, size);
  const archive = await JSZip.loadAsync(await fs.readFile(filePath));
  const xmlPaths = Object.keys(archive.files)
    .filter(fileName =>
      /^ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/i.test(fileName),
    )
    .sort((left, right) => getPptxXmlSortKey(left).localeCompare(getPptxXmlSortKey(right)));
  const blocks: string[] = [];
  for (const xmlPath of xmlPaths) {
    const entry = archive.file(xmlPath);
    if (!entry) {
      continue;
    }
    const block = extractPptxTextBlock(await entry.async('text'));
    if (block) {
      blocks.push(block);
    }
  }
  const clamped = clampContent(collapseBlankLines(blocks.join('\n\n')));
  return {
    content: clamped.content,
    parser: 'pptx',
    readBytes: size,
    size,
    truncated: clamped.truncated,
  };
};

const hasTextItemString = (item: unknown): item is { str: string } =>
  Boolean(item) &&
  typeof item === 'object' &&
  'str' in item &&
  typeof (item as { str?: unknown }).str === 'string';

const extractPdfText = async (filePath: string, size: number): Promise<ExtractedDocumentText> => {
  ensureRichDocumentSize(filePath, size);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const buffer = await fs.readFile(filePath);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  const pdfDocument = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map(item => (hasTextItemString(item) ? item.str : ''))
        .filter(Boolean)
        .join(' ')
        .trim();
      if (pageText) {
        pages.push(pageText);
      }
    }
    const clamped = clampContent(collapseBlankLines(pages.join('\n\n')));
    return {
      content: clamped.content,
      parser: 'pdf',
      readBytes: size,
      size,
      truncated: clamped.truncated,
    };
  } finally {
    await pdfDocument.destroy();
  }
};

export const extractDocumentTextFromFile = async (
  filePath: string,
): Promise<ExtractedDocumentText> => {
  const normalizedPath = path.resolve(filePath.trim());
  const stat = await fs.stat(normalizedPath);
  if (!stat.isFile()) {
    throw new Error('Not a file');
  }

  const extension = getNormalizedExtension(normalizedPath);
  if (TEXT_DOCUMENT_EXTENSIONS.has(extension)) {
    return extractPlainTextFile(normalizedPath, stat.size);
  }
  if (extension === dotExtension(EnterpriseLeadReadableDocumentExtension.Docx)) {
    return extractDocxText(normalizedPath, stat.size);
  }
  if (
    extension === dotExtension(EnterpriseLeadReadableDocumentExtension.Xlsx) ||
    extension === dotExtension(EnterpriseLeadReadableDocumentExtension.Xls)
  ) {
    return extractSpreadsheetText(normalizedPath, stat.size);
  }
  if (extension === dotExtension(EnterpriseLeadReadableDocumentExtension.Pdf)) {
    return extractPdfText(normalizedPath, stat.size);
  }
  if (extension === dotExtension(EnterpriseLeadReadableDocumentExtension.Pptx)) {
    return extractPptxText(normalizedPath, stat.size);
  }

  throw new Error(`Unsupported readable document type: ${extension || 'unknown'}`);
};
