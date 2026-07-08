import {
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadWorkspaceType,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadExtractionSource,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceProfile,
} from '../../shared/enterpriseLeadWorkspace/types';

export const DIRECT_EXTRACTION_MAX_CHARS = 60_000;
export const EXTRACTION_CHUNK_TARGET_CHARS = 18_000;
export const EXTRACTION_CHUNK_OVERLAP_CHARS = 800;
export const EXTRACTION_MAX_CHUNKS = 30;

const chunkFactFields = [
  'companySummary',
  'productList',
  'productCapabilities',
  'targetCustomers',
  'applicationScenarios',
  'sellingPoints',
  'channelPreferences',
  'prohibitedClaims',
  'contactRules',
  'missingInfo',
] as const;

type ChunkFactField = (typeof chunkFactFields)[number];

const chunkFactFieldSet = new Set<string>(chunkFactFields);

export interface WorkspaceExtractionChunk {
  chunkId: string;
  sourceId: string;
  index: number;
  startOffset: number;
  endOffset: number;
  text: string;
  label: string;
}

export interface WorkspaceExtractionChunkPlan {
  chunks: WorkspaceExtractionChunk[];
  partial: boolean;
}

export interface WorkspaceChunkExtractionEvidence {
  field: ChunkFactField;
  value: string;
  chunkId: string;
  quote: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface WorkspaceChunkExtractionResult {
  facts: Record<ChunkFactField, string[]>;
  evidence: WorkspaceChunkExtractionEvidence[];
}

interface BuildWorkspaceExtractionChunksInput {
  sourceId: string;
  sourceLabel: string;
  sourceText: string;
}

interface BuildWorkspaceDraftFromChunkFactsInput {
  name: string;
  sourceKind: EnterpriseLeadExtractionSource['kind'];
  sourceLabel: string;
  sourceText: string;
  chunkResults: WorkspaceChunkExtractionResult[];
}

const emptyChunkFacts = (): Record<ChunkFactField, string[]> => ({
  companySummary: [],
  productList: [],
  productCapabilities: [],
  targetCustomers: [],
  applicationScenarios: [],
  sellingPoints: [],
  channelPreferences: [],
  prohibitedClaims: [],
  contactRules: [],
  missingInfo: [],
});

const cleanText = (value: unknown): string =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

const normalizeFactKey = (value: string): string => cleanText(value).toLowerCase();

const cleanTextList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  value.forEach(item => {
    const text = cleanText(item);
    const key = normalizeFactKey(text);
    if (!text || seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(text);
  });
  return result;
};

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const findPreviousBreak = (text: string, start: number, targetEnd: number): number => {
  const minEnd = Math.min(text.length, start + Math.floor(EXTRACTION_CHUNK_TARGET_CHARS * 0.55));
  const searchText = text.slice(start, targetEnd);
  const breakPatterns = ['\n\n# ', '\n# ', '\n\n', '\n'];
  for (const pattern of breakPatterns) {
    const index = searchText.lastIndexOf(pattern);
    if (index > 0 && start + index >= minEnd) {
      return start + index + pattern.length;
    }
  }
  return targetEnd;
};

export const buildWorkspaceExtractionChunks = ({
  sourceId,
  sourceLabel,
  sourceText,
}: BuildWorkspaceExtractionChunksInput): WorkspaceExtractionChunkPlan => {
  const text = sourceText.trim();
  if (!text) {
    return { chunks: [], partial: false };
  }

  if (text.length <= DIRECT_EXTRACTION_MAX_CHARS) {
    return {
      partial: false,
      chunks: [
        {
          chunkId: `${sourceId}:chunk-1`,
          sourceId,
          index: 0,
          startOffset: 0,
          endOffset: text.length,
          text,
          label: `${sourceLabel} 第 1 段`,
        },
      ],
    };
  }

  const chunks: WorkspaceExtractionChunk[] = [];
  let startOffset = 0;
  while (startOffset < text.length && chunks.length < EXTRACTION_MAX_CHUNKS) {
    const targetEnd = Math.min(text.length, startOffset + EXTRACTION_CHUNK_TARGET_CHARS);
    const endOffset =
      targetEnd === text.length ? targetEnd : findPreviousBreak(text, startOffset, targetEnd);
    const chunkText = text.slice(startOffset, endOffset).trim();
    if (chunkText) {
      chunks.push({
        chunkId: `${sourceId}:chunk-${chunks.length + 1}`,
        sourceId,
        index: chunks.length,
        startOffset,
        endOffset,
        text: chunkText,
        label: `${sourceLabel} 第 ${chunks.length + 1} 段`,
      });
    }
    if (endOffset >= text.length) {
      break;
    }
    startOffset = Math.max(endOffset - EXTRACTION_CHUNK_OVERLAP_CHARS, startOffset + 1);
  }

  return {
    chunks,
    partial: chunks[chunks.length - 1]?.endOffset !== text.length,
  };
};

export const normalizeWorkspaceChunkExtractionResult = (
  value: unknown,
): WorkspaceChunkExtractionResult => {
  const record = toRecord(value);
  const rawFacts = toRecord(record.facts);
  const facts = emptyChunkFacts();
  chunkFactFields.forEach(field => {
    facts[field] = cleanTextList(rawFacts[field]);
  });

  const evidence = Array.isArray(record.evidence)
    ? record.evidence
        .map(item => {
          const evidenceRecord = toRecord(item);
          const field = cleanText(evidenceRecord.field);
          if (!chunkFactFieldSet.has(field)) {
            return null;
          }
          const confidence = cleanText(evidenceRecord.confidence);
          return {
            field: field as ChunkFactField,
            value: cleanText(evidenceRecord.value),
            chunkId: cleanText(evidenceRecord.chunkId),
            quote: cleanText(evidenceRecord.quote),
            confidence:
              confidence === 'low' || confidence === 'medium' || confidence === 'high'
                ? confidence
                : 'medium',
          };
        })
        .filter((item): item is WorkspaceChunkExtractionEvidence =>
          Boolean(item && item.value && item.chunkId),
        )
    : [];

  return { facts, evidence };
};

const mergeFactField = (
  chunkResults: WorkspaceChunkExtractionResult[],
  field: ChunkFactField,
  limit = 30,
): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const chunkResult of chunkResults) {
    for (const value of chunkResult.facts[field]) {
      const key = normalizeFactKey(value);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(value);
      if (result.length >= limit) {
        return result;
      }
    }
  }
  return result;
};

export const buildWorkspaceDraftFromChunkFacts = ({
  name,
  sourceKind,
  sourceLabel,
  sourceText,
  chunkResults,
}: BuildWorkspaceDraftFromChunkFactsInput): EnterpriseLeadWorkspaceDraft => {
  const profile: EnterpriseLeadWorkspaceProfile = {
    companySummary: mergeFactField(chunkResults, 'companySummary', 6).join('；'),
    productList: mergeFactField(chunkResults, 'productList', 20),
    productCapabilities: mergeFactField(chunkResults, 'productCapabilities'),
    targetCustomers: mergeFactField(chunkResults, 'targetCustomers'),
    applicationScenarios: mergeFactField(chunkResults, 'applicationScenarios'),
    sellingPoints: mergeFactField(chunkResults, 'sellingPoints'),
    channelPreferences: mergeFactField(chunkResults, 'channelPreferences'),
    prohibitedClaims: mergeFactField(chunkResults, 'prohibitedClaims', 50),
    contactRules: mergeFactField(chunkResults, 'contactRules', 50),
    missingInfo: mergeFactField(chunkResults, 'missingInfo'),
  };

  return {
    name: cleanText(name) || cleanText(sourceLabel) || '未命名工作空间',
    type: EnterpriseLeadWorkspaceType.EnterpriseLead,
    profile,
    source: {
      kind: sourceKind || EnterpriseLeadExtractionSourceKind.File,
      label: cleanText(sourceLabel) || '未命名资料',
      text: sourceText,
    },
    enabledAgentRoles: [],
    workspaceAgents: [],
  };
};
