import { describe, expect, test } from 'vitest';

import { KnowledgeDocumentIndexTokenizer } from '../../shared/knowledgeBase/constants';
import {
  buildKnowledgeChunkId,
  buildKnowledgeFtsMatchQuery,
  buildKnowledgeFtsSearchText,
  chunkKnowledgeDocumentVersion,
} from './knowledgeDocumentChunker';

describe('chunkKnowledgeDocumentVersion', () => {
  test('uses deterministic 18,000 character chunks with 800 character overlap', () => {
    const text = 'a'.repeat(36_500);
    const first = chunkKnowledgeDocumentVersion({ documentVersionId: 'version-a', text });
    const retry = chunkKnowledgeDocumentVersion({ documentVersionId: 'version-a', text });

    expect(first.map(chunk => [chunk.startOffset, chunk.endOffset])).toEqual([
      [0, 18_000],
      [17_200, 35_200],
      [34_400, 36_500],
    ]);
    expect(retry.map(chunk => chunk.id)).toEqual(first.map(chunk => chunk.id));
  });

  test('returns one complete chunk for text shorter than the target', () => {
    const progress: number[] = [];

    const chunks = chunkKnowledgeDocumentVersion({
      documentVersionId: 'version-short',
      text: 'short text',
      onProgress: value => progress.push(value),
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      ordinal: 0,
      content: 'short text',
      startOffset: 0,
      endOffset: 10,
      pageNumber: null,
      sheetName: null,
      slideNumber: null,
      headingPath: null,
    });
    expect(progress).toEqual([1]);
  });

  test('returns no chunks for empty text', () => {
    expect(chunkKnowledgeDocumentVersion({
      documentVersionId: 'version-empty',
      text: '',
    })).toEqual([]);
  });

  test('rejects chunk sizes that cannot advance safely', () => {
    expect(() => chunkKnowledgeDocumentVersion({
      documentVersionId: 'version-invalid-target',
      text: 'abc',
      targetChars: 0,
    })).toThrow('Knowledge chunk target must be a positive integer');
    expect(() => chunkKnowledgeDocumentVersion({
      documentVersionId: 'version-invalid-overlap',
      text: 'abc',
      targetChars: 2,
      overlapChars: 2,
    })).toThrow('Knowledge chunk overlap must be smaller than the target');
  });

  test('does not split a UTF-16 surrogate pair', () => {
    const text = `${'a'.repeat(9)}😀${'b'.repeat(20)}`;
    const chunks = chunkKnowledgeDocumentVersion({
      documentVersionId: 'version-emoji',
      text,
      targetChars: 10,
      overlapChars: 2,
    });

    const splitsSurrogatePair = (value: string, offset: number): boolean =>
      offset > 0 &&
      offset < value.length &&
      value.charCodeAt(offset - 1) >= 0xd800 &&
      value.charCodeAt(offset - 1) <= 0xdbff &&
      value.charCodeAt(offset) >= 0xdc00 &&
      value.charCodeAt(offset) <= 0xdfff;

    expect(chunks.every(chunk =>
      !splitsSurrogatePair(text, chunk.startOffset) &&
      !splitsSurrogatePair(text, chunk.endOffset),
    )).toBe(true);
    expect(chunks.map(chunk => text.slice(chunk.startOffset, chunk.endOffset))).toEqual(
      chunks.map(chunk => chunk.content),
    );

    const overlapText = `${'a'.repeat(8)}😀${'b'.repeat(8)}`;
    const overlapChunks = chunkKnowledgeDocumentVersion({
      documentVersionId: 'version-overlap-emoji',
      text: overlapText,
      targetChars: 12,
      overlapChars: 3,
    });
    expect(overlapChunks.every(chunk =>
      !splitsSurrogatePair(overlapText, chunk.startOffset) &&
      !splitsSurrogatePair(overlapText, chunk.endOffset),
    )).toBe(true);

    expect(chunkKnowledgeDocumentVersion({
      documentVersionId: 'version-single-emoji',
      text: '😀x',
      targetChars: 1,
      overlapChars: 0,
    }).map(chunk => chunk.content)).toEqual(['😀', 'x']);
  });
});

describe('buildKnowledgeChunkId', () => {
  test('hashes the exact NUL-delimited chunk identity with SHA-256', () => {
    expect(buildKnowledgeChunkId({
      documentVersionId: 'version-id',
      ordinal: 2,
      startOffset: 10,
      endOffset: 15,
      checksum: 'abc',
    })).toBe('b5b9c3b825f6d9c77f45ebdc40c207b6aca1d947f695931c2dfa5d9a60a48189');
  });
});

describe('local FTS normalization', () => {
  test('builds deterministic CJK bigram text', () => {
    expect(
      buildKnowledgeFtsSearchText(
        '企业知识库 AI',
        KnowledgeDocumentIndexTokenizer.CjkBigramV1,
      ),
    ).toBe('企业 业知 知识 识库 ai');
  });

  test('normalizes case, width, and whitespace for trigram text', () => {
    expect(
      buildKnowledgeFtsSearchText(
        '  ＡＩ\tBudget  ',
        KnowledgeDocumentIndexTokenizer.TrigramV1,
      ),
    ).toBe('ai budget');
  });

  test('preserves source order across CJK and Latin token boundaries', () => {
    expect(
      buildKnowledgeFtsSearchText(
        '预算AI2026',
        KnowledgeDocumentIndexTokenizer.CjkBigramV1,
      ),
    ).toBe('预算 ai2026');
    expect(
      buildKnowledgeFtsSearchText(
        '支持 AI 问答',
        KnowledgeDocumentIndexTokenizer.CjkBigramV1,
      ),
    ).toBe('支持 ai 问答');
    expect(
      buildKnowledgeFtsSearchText(
        'AI预算',
        KnowledgeDocumentIndexTokenizer.CjkBigramV1,
      ),
    ).toBe('ai 预算');
    expect(
      buildKnowledgeFtsSearchText(
        '预算AI知识',
        KnowledgeDocumentIndexTokenizer.CjkBigramV1,
      ),
    ).toBe('预算 ai 知识');
  });

  test('quotes trigram terms without exposing MATCH syntax', () => {
    expect(
      buildKnowledgeFtsMatchQuery(
        '预算 "2026" OR secret:*',
        KnowledgeDocumentIndexTokenizer.TrigramV1,
      ),
    ).toBe('"预算 ""2026"" or secret:*"');
  });

  test('returns null for an empty query', () => {
    expect(
      buildKnowledgeFtsMatchQuery('   ', KnowledgeDocumentIndexTokenizer.TrigramV1),
    ).toBeNull();
  });

  test('returns null when CJK normalization removes all punctuation', () => {
    expect(
      buildKnowledgeFtsMatchQuery('!?:', KnowledgeDocumentIndexTokenizer.CjkBigramV1),
    ).toBeNull();
  });
});
