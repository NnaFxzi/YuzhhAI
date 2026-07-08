import { describe, expect, test } from 'vitest';

import { EnterpriseLeadExtractionSourceKind } from '../../shared/enterpriseLeadWorkspace/constants';
import {
  buildWorkspaceDraftFromChunkFacts,
  buildWorkspaceExtractionChunks,
  DIRECT_EXTRACTION_MAX_CHARS,
  EXTRACTION_CHUNK_TARGET_CHARS,
  EXTRACTION_MAX_CHUNKS,
  normalizeWorkspaceChunkExtractionResult,
} from './documentExtraction';

describe('enterprise lead document extraction helpers', () => {
  test('keeps small readable text in a single extraction chunk', () => {
    const text = '主营精密五金加工，服务自动化设备厂，卖点是小批量快反。';

    const plan = buildWorkspaceExtractionChunks({
      sourceId: 'source-1',
      sourceLabel: 'factory.md',
      sourceText: text,
    });

    expect(text.length).toBeLessThan(DIRECT_EXTRACTION_MAX_CHARS);
    expect(plan.partial).toBe(false);
    expect(plan.chunks).toEqual([
      {
        chunkId: 'source-1:chunk-1',
        sourceId: 'source-1',
        index: 0,
        startOffset: 0,
        endOffset: text.length,
        label: 'factory.md 第 1 段',
        text,
      },
    ]);
  });

  test('splits very large text into bounded chunks and marks truncated extraction partial', () => {
    const paragraph = `${'主营精密五金加工。'.repeat(2_500)}\n\n`;
    const text = paragraph.repeat(EXTRACTION_MAX_CHUNKS + 4);

    const plan = buildWorkspaceExtractionChunks({
      sourceId: 'source-large',
      sourceLabel: 'large.md',
      sourceText: text,
    });

    expect(plan.partial).toBe(true);
    expect(plan.chunks).toHaveLength(EXTRACTION_MAX_CHUNKS);
    expect(plan.chunks.every(chunk => chunk.text.length <= EXTRACTION_CHUNK_TARGET_CHARS)).toBe(
      true,
    );
    expect(plan.chunks[0]?.startOffset).toBe(0);
    expect(plan.chunks[1]?.startOffset).toBeGreaterThan(plan.chunks[0]?.startOffset ?? 0);
  });

  test('normalizes chunk extraction results and merges facts without dropping hard rules', () => {
    const firstResult = normalizeWorkspaceChunkExtractionResult({
      facts: {
        companySummary: ['精密五金加工厂'],
        productList: ['金属支架', ' 金属支架 '],
        productCapabilities: ['来图定制'],
        targetCustomers: ['自动化设备厂'],
        applicationScenarios: ['设备装配'],
        sellingPoints: ['小批量快反'],
        channelPreferences: ['微信'],
        prohibitedClaims: ['绝对最低价'],
        contactRules: ['只生成草稿，不自动发送'],
        missingInfo: ['案例图片'],
      },
      evidence: [
        {
          field: 'productList',
          value: '金属支架',
          chunkId: 'source-1:chunk-1',
          quote: '主营金属支架',
          confidence: 'high',
        },
      ],
    });
    const secondResult = normalizeWorkspaceChunkExtractionResult({
      facts: {
        companySummary: ['服务自动化设备客户'],
        productList: ['金属支架', '铝合金外壳'],
        productCapabilities: ['CNC 加工'],
        targetCustomers: ['自动化设备厂', '机器人集成商'],
        applicationScenarios: [],
        sellingPoints: ['小批量快反'],
        channelPreferences: [],
        prohibitedClaims: ['100% 良率'],
        contactRules: ['报价需人工确认'],
        missingInfo: [],
      },
      evidence: [],
    });

    const draft = buildWorkspaceDraftFromChunkFacts({
      name: '大文件资料',
      sourceKind: EnterpriseLeadExtractionSourceKind.File,
      sourceLabel: 'large.md',
      sourceText: '原始大文件正文',
      chunkResults: [firstResult, secondResult],
    });

    expect(draft.profile.companySummary).toBe('精密五金加工厂；服务自动化设备客户');
    expect(draft.profile.productList).toEqual(['金属支架', '铝合金外壳']);
    expect(draft.profile.targetCustomers).toEqual(['自动化设备厂', '机器人集成商']);
    expect(draft.profile.prohibitedClaims).toEqual(['绝对最低价', '100% 良率']);
    expect(draft.profile.contactRules).toEqual(['只生成草稿，不自动发送', '报价需人工确认']);
    expect(draft.source.text).toBe('原始大文件正文');
  });
});
