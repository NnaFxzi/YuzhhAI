import { createHash } from 'node:crypto';

import {
  KNOWLEDGE_CHUNK_OVERLAP_CHARS,
  KNOWLEDGE_CHUNK_TARGET_CHARS,
  type KnowledgeDocumentIndexTokenizer,
  KnowledgeDocumentIndexTokenizer as KnowledgeDocumentIndexTokenizers,
} from '../../shared/knowledgeBase/constants';
import type { KnowledgeDocumentChunkDraft } from './knowledgeDocumentIndexTypes';

const CJK_CHARACTER =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;
const LETTER_OR_NUMBER_CHARACTER = /^[\p{Letter}\p{Number}]$/u;

const isHighSurrogate = (value: number): boolean => value >= 0xd800 && value <= 0xdbff;
const isLowSurrogate = (value: number): boolean => value >= 0xdc00 && value <= 0xdfff;

const safeBoundary = (text: string, offset: number): number => {
  if (
    offset > 0 &&
    offset < text.length &&
    isHighSurrogate(text.charCodeAt(offset - 1)) &&
    isLowSurrogate(text.charCodeAt(offset))
  ) {
    return offset - 1;
  }
  return offset;
};

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const normalizeSearchText = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

const toCjkBigramTokens = (value: string): string[] => {
  const tokens: string[] = [];
  const characters = Array.from(value);
  if (characters.length === 1) {
    return characters;
  }
  for (let index = 0; index < characters.length - 1; index += 1) {
    tokens.push(`${characters[index]}${characters[index + 1]}`);
  }
  return tokens;
};

const tokenizeCjkBigramText = (value: string): string[] => {
  const tokens: string[] = [];
  let run = '';
  let runIsCjk: boolean | null = null;
  const flush = (): void => {
    if (!run) {
      return;
    }
    if (runIsCjk === true) {
      tokens.push(...toCjkBigramTokens(run));
    } else {
      tokens.push(run);
    }
    run = '';
    runIsCjk = null;
  };

  for (const character of value) {
    const isCjk = CJK_CHARACTER.test(character);
    if (!isCjk && !LETTER_OR_NUMBER_CHARACTER.test(character)) {
      flush();
      continue;
    }
    if (run && runIsCjk !== isCjk) {
      flush();
    }
    run += character;
    runIsCjk = isCjk;
  }
  flush();
  return tokens;
};

export const buildKnowledgeChunkId = (input: {
  documentVersionId: string;
  ordinal: number;
  startOffset: number;
  endOffset: number;
  checksum: string;
}): string =>
  sha256(
    [
      input.documentVersionId,
      input.ordinal,
      input.startOffset,
      input.endOffset,
      input.checksum,
    ].join('\0'),
  );

export const chunkKnowledgeDocumentVersion = (input: {
  documentVersionId: string;
  text: string;
  targetChars?: number;
  overlapChars?: number;
  onProgress?: (progress: number) => void;
}): KnowledgeDocumentChunkDraft[] => {
  const targetChars = input.targetChars ?? KNOWLEDGE_CHUNK_TARGET_CHARS;
  const overlapChars = input.overlapChars ?? KNOWLEDGE_CHUNK_OVERLAP_CHARS;
  if (!Number.isInteger(targetChars) || targetChars < 1) {
    throw new Error('Knowledge chunk target must be a positive integer');
  }
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= targetChars) {
    throw new Error('Knowledge chunk overlap must be smaller than the target');
  }

  const chunks: KnowledgeDocumentChunkDraft[] = [];
  let startOffset = 0;
  while (startOffset < input.text.length) {
    const candidateEnd = safeBoundary(
      input.text,
      Math.min(input.text.length, startOffset + targetChars),
    );
    const endOffset = candidateEnd > startOffset
      ? candidateEnd
      : Math.min(input.text.length, startOffset + 2);
    const content = input.text.slice(startOffset, endOffset);
    const checksum = sha256(content);
    const ordinal = chunks.length;
    chunks.push({
      id: buildKnowledgeChunkId({
        documentVersionId: input.documentVersionId,
        ordinal,
        startOffset,
        endOffset,
        checksum,
      }),
      ordinal,
      content,
      startOffset,
      endOffset,
      checksum,
      pageNumber: null,
      sheetName: null,
      slideNumber: null,
      headingPath: null,
    });
    input.onProgress?.(endOffset / input.text.length);
    if (endOffset === input.text.length) {
      break;
    }
    const nextOffset = safeBoundary(input.text, endOffset - overlapChars);
    startOffset = nextOffset > startOffset ? nextOffset : endOffset;
  }
  return chunks;
};

export const buildKnowledgeFtsSearchText = (
  content: string,
  tokenizer: KnowledgeDocumentIndexTokenizer,
): string => {
  const normalized = normalizeSearchText(content);
  if (tokenizer === KnowledgeDocumentIndexTokenizers.TrigramV1) {
    return normalized;
  }
  return tokenizeCjkBigramText(normalized).join(' ');
};

export const buildKnowledgeFtsMatchQuery = (
  query: string,
  tokenizer: KnowledgeDocumentIndexTokenizer,
): string | null => {
  const searchText = buildKnowledgeFtsSearchText(query, tokenizer).trim();
  return searchText ? `"${searchText.replace(/"/g, '""')}"` : null;
};
