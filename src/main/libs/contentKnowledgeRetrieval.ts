import crypto from 'crypto';

export const CONTENT_KNOWLEDGE_EMBEDDING_VERSION = 'lobsterai-content-keyword-hash-v1';

const DEFAULT_CHUNK_MAX_CHARS = 520;
const DEFAULT_CHUNK_OVERLAP_CHARS = 80;
const DEFAULT_EMBEDDING_DIMENSIONS = 96;
const DEFAULT_MAX_HITS = 8;
const DEFAULT_HIT_THRESHOLD = 0.34;
const DEFAULT_MIN_BUSINESS_SIGNALS = 2;

export const ContentKnowledgeSourceType = {
  UserProfile: 'user_profile',
  Memory: 'memory',
  IndustryReport: 'industry_report',
  WorkspaceDocument: 'workspace_document',
} as const;

export type ContentKnowledgeSourceType =
  (typeof ContentKnowledgeSourceType)[keyof typeof ContentKnowledgeSourceType];

type SignalCategory = 'business' | 'product' | 'audience' | 'sales' | 'channel' | 'style';

type SignalRule = {
  token: string;
  category: SignalCategory;
};

export type ContentKnowledgeSource = {
  sourceId: string;
  sourceType: ContentKnowledgeSourceType | string;
  label: string;
  content: string;
  updatedAt?: number;
};

export type ContentKnowledgeChunk = {
  id: string;
  sourceId: string;
  sourceType: string;
  sourceLabel: string;
  chunkIndex: number;
  text: string;
  checksum: string;
  embeddingVersion: string;
  embedding: number[];
  tokens: string[];
  signals: string[];
  businessSignals: string[];
  businessSignalCount: number;
};

export type ContentKnowledgeIndex = {
  chunks: ContentKnowledgeChunk[];
  embeddingVersion: string;
  embeddingDimensions: number;
};

export type ContentKnowledgeHitScores = {
  keywordScore: number;
  vectorScore: number;
  contextFitScore: number;
  sourceScore: number;
  rerankBoost: number;
  finalScore: number;
};

export type ContentKnowledgeSearchHit = {
  chunk: ContentKnowledgeChunk;
  scores: ContentKnowledgeHitScores;
};

export type ContentKnowledgeRetrievalDiagnostics = {
  candidateCount: number;
  rejectedCount: number;
  hitThreshold: number;
  minBusinessSignalCount: number;
  embeddingVersion: string;
};

export type ContentKnowledgeRetrievalResult = {
  matched: boolean;
  hits: ContentKnowledgeSearchHit[];
  rejectedHits: ContentKnowledgeSearchHit[];
  diagnostics: ContentKnowledgeRetrievalDiagnostics;
};

export type ContentKnowledgeSearchOptions = {
  maxHits?: number;
  hitThreshold?: number;
  minBusinessSignals?: number;
};

export type ContentKnowledgeRetrieverInput = {
  scopeId: string;
  prompt: string;
  sources: ContentKnowledgeSource[];
  options?: ContentKnowledgeSearchOptions;
};

export type ContentKnowledgeRetriever = {
  retrieveFromSources: (input: ContentKnowledgeRetrieverInput) => ContentKnowledgeRetrievalResult;
};

const CONTENT_PRODUCTION_TOKENS = [
  '小红书',
  '选题',
  '标题',
  '脚本',
  '短视频',
  '口播',
  '分镜',
  '文案',
  '朋友圈',
  '公众号',
  '微信群',
  '私域',
  '私聊',
  '私信',
  '话术',
  '销售回复',
  '销售话术',
  '成交话术',
  '转化内容',
  '种草',
  '推广内容',
  '推广文案',
  '营销文案',
  '改写',
  '润色',
];

const SIGNAL_RULES: SignalRule[] = [
  { token: '行业', category: 'business' },
  { token: '赛道', category: 'business' },
  { token: '主营', category: 'business' },
  { token: '公司做', category: 'business' },
  { token: '企业', category: 'business' },
  { token: '工厂', category: 'business' },
  { token: '制造', category: 'business' },
  { token: '工业', category: 'business' },
  { token: 'b2b', category: 'business' },
  { token: '品牌', category: 'business' },
  { token: '门店', category: 'business' },
  { token: '供应商', category: 'business' },
  { token: '服务商', category: 'business' },
  { token: '场景', category: 'business' },
  { token: '产品', category: 'product' },
  { token: '服务', category: 'product' },
  { token: '注塑', category: 'product' },
  { token: '模具', category: 'product' },
  { token: '维护', category: 'product' },
  { token: '包装', category: 'product' },
  { token: '纸箱', category: 'product' },
  { token: '蜂窝', category: 'product' },
  { token: '木箱', category: 'product' },
  { token: '免熏蒸', category: 'product' },
  { token: '防破损', category: 'product' },
  { token: '防潮', category: 'product' },
  { token: '抗压', category: 'product' },
  { token: '机械', category: 'product' },
  { token: '出口', category: 'product' },
  { token: '运输', category: 'product' },
  { token: '运输损耗', category: 'product' },
  { token: '停机', category: 'product' },
  { token: '交付', category: 'product' },
  { token: '售后', category: 'product' },
  { token: '降本', category: 'product' },
  { token: '耗材', category: 'product' },
  { token: '解决方案', category: 'product' },
  { token: '客户', category: 'audience' },
  { token: '客群', category: 'audience' },
  { token: '人群', category: 'audience' },
  { token: '用户画像', category: 'audience' },
  { token: '目标人群', category: 'audience' },
  { token: '目标客户', category: 'audience' },
  { token: '设备厂', category: 'audience' },
  { token: '采购', category: 'audience' },
  { token: '采购负责人', category: 'audience' },
  { token: '决策人', category: 'audience' },
  { token: '生产主管', category: 'audience' },
  { token: '老板', category: 'audience' },
  { token: '经销商', category: 'audience' },
  { token: '卖点', category: 'sales' },
  { token: '痛点', category: 'sales' },
  { token: '转化', category: 'sales' },
  { token: '成交', category: 'sales' },
  { token: '询盘', category: 'sales' },
  { token: '线索', category: 'sales' },
  { token: '客单', category: 'sales' },
  { token: '价格', category: 'sales' },
  { token: '报价', category: 'sales' },
  { token: '成本', category: 'sales' },
  { token: '综合成本', category: 'sales' },
  { token: '沟通成本', category: 'sales' },
  { token: '复购', category: 'sales' },
  { token: '信任', category: 'sales' },
  { token: '行动引导', category: 'sales' },
  { token: '小红书', category: 'channel' },
  { token: '抖音', category: 'channel' },
  { token: '视频号', category: 'channel' },
  { token: '私域', category: 'channel' },
  { token: '朋友圈', category: 'channel' },
  { token: '微信群', category: 'channel' },
  { token: '公众号', category: 'channel' },
  { token: '直播', category: 'channel' },
  { token: '标题', category: 'style' },
  { token: '排版', category: 'style' },
  { token: '语气', category: 'style' },
  { token: '风格', category: 'style' },
  { token: '口播', category: 'style' },
];

const BUSINESS_CONTEXT_CATEGORIES = new Set<SignalCategory>([
  'business',
  'product',
  'audience',
  'sales',
]);

const normalizeComparableText = (value: string): string =>
  value.replace(/\s+/g, '').trim().toLowerCase();

const stripMarkdownSyntax = (line: string): string =>
  line
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();

const unique = <T>(items: T[]): T[] => Array.from(new Set(items));

const sha1 = (value: string): string => crypto.createHash('sha1').update(value).digest('hex');

const truncateVectorNumber = (value: number): number => Number(value.toFixed(6));

const splitLongText = (text: string, maxChars: number, overlapChars: number): string[] => {
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const end = Math.min(text.length, cursor + maxChars);
    chunks.push(text.slice(cursor, end).trim());
    if (end === text.length) {
      break;
    }
    cursor = Math.max(end - overlapChars, cursor + 1);
  }
  return chunks.filter(Boolean);
};

const splitSourceIntoChunkTexts = (
  content: string,
  maxChars = DEFAULT_CHUNK_MAX_CHARS,
  overlapChars = DEFAULT_CHUNK_OVERLAP_CHARS,
): string[] => {
  const lines = content.split(/\r?\n/).map(stripMarkdownSyntax).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    if (line.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(...splitLongText(line, maxChars, overlapChars));
      continue;
    }

    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
};

const extractSignals = (text: string, categories?: Set<SignalCategory>): string[] => {
  const normalizedText = normalizeComparableText(text);
  return SIGNAL_RULES.filter(rule => !categories || categories.has(rule.category))
    .filter(rule => normalizedText.includes(normalizeComparableText(rule.token)))
    .map(rule => rule.token);
};

const tokenizeContentKnowledgeText = (text: string): string[] => {
  const normalized = text.toLowerCase();
  const tokens: string[] = [];
  tokens.push(...extractSignals(normalized));
  tokens.push(...(normalized.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []));

  for (const segment of normalized.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (segment.length <= 6) {
      tokens.push(segment);
    }
    for (let index = 0; index < segment.length - 1; index += 1) {
      tokens.push(segment.slice(index, index + 2));
    }
    for (let index = 0; index < segment.length - 2; index += 1) {
      tokens.push(segment.slice(index, index + 3));
    }
  }

  return unique(tokens.filter(token => token.length > 1));
};

export const buildContentKnowledgeEmbedding = (
  text: string,
  dimensions = DEFAULT_EMBEDDING_DIMENSIONS,
): number[] => {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = tokenizeContentKnowledgeText(text);

  for (const token of tokens) {
    const digest = crypto.createHash('sha1').update(token).digest();
    const index = digest.readUInt16BE(0) % dimensions;
    const sign = digest[2] % 2 === 0 ? 1 : -1;
    const weight = 1 + Math.min(token.length, 8) / 8;
    vector[index] += sign * weight;
  }

  const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
  if (!norm) {
    return vector;
  }

  return vector.map(value => truncateVectorNumber(value / norm));
};

const cosineSimilarity = (a: number[], b: number[]): number => {
  const length = Math.min(a.length, b.length);
  if (!length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (!normA || !normB) {
    return 0;
  }
  return dot / Math.sqrt(normA * normB);
};

const scoreKeywordOverlap = (queryTokens: string[], chunkTokens: string[]): number => {
  if (!queryTokens.length || !chunkTokens.length) {
    return 0;
  }
  const chunkSet = new Set(chunkTokens);
  const meaningfulQueryTokens = queryTokens.filter(token => token.length > 1);
  const overlapCount = meaningfulQueryTokens.reduce(
    (total, token) => total + (chunkSet.has(token) ? 1 : 0),
    0,
  );
  return overlapCount / Math.max(meaningfulQueryTokens.length, 1);
};

const sourceScoreFor = (sourceType: string): number => {
  switch (sourceType) {
    case ContentKnowledgeSourceType.UserProfile:
      return 0.12;
    case ContentKnowledgeSourceType.IndustryReport:
      return 0.1;
    case ContentKnowledgeSourceType.Memory:
      return 0.07;
    default:
      return 0.05;
  }
};

const isContentProductionPrompt = (prompt: string): boolean => {
  const normalizedPrompt = normalizeComparableText(prompt);
  return CONTENT_PRODUCTION_TOKENS.some(token =>
    normalizedPrompt.includes(normalizeComparableText(token)),
  );
};

const createChunk = (
  source: ContentKnowledgeSource,
  text: string,
  chunkIndex: number,
): ContentKnowledgeChunk => {
  const checksum = sha1(text);
  const businessSignals = extractSignals(text, BUSINESS_CONTEXT_CATEGORIES);
  const signals = unique([...extractSignals(text), ...businessSignals]);
  return {
    id: sha1(`${source.sourceType}:${source.sourceId}:${chunkIndex}:${checksum}`),
    sourceId: source.sourceId,
    sourceType: source.sourceType,
    sourceLabel: source.label,
    chunkIndex,
    text,
    checksum,
    embeddingVersion: CONTENT_KNOWLEDGE_EMBEDDING_VERSION,
    embedding: buildContentKnowledgeEmbedding(text),
    tokens: tokenizeContentKnowledgeText(text),
    signals,
    businessSignals,
    businessSignalCount: businessSignals.length,
  };
};

export const buildContentKnowledgeIndex = (
  sources: ContentKnowledgeSource[],
): ContentKnowledgeIndex => ({
  chunks: sources.flatMap(source =>
    splitSourceIntoChunkTexts(source.content).map((text, index) =>
      createChunk(source, text, index),
    ),
  ),
  embeddingVersion: CONTENT_KNOWLEDGE_EMBEDDING_VERSION,
  embeddingDimensions: DEFAULT_EMBEDDING_DIMENSIONS,
});

const scoreChunk = (
  chunk: ContentKnowledgeChunk,
  prompt: string,
  queryTokens: string[],
  queryEmbedding: number[],
): ContentKnowledgeSearchHit => {
  const keywordScore = scoreKeywordOverlap(queryTokens, chunk.tokens);
  const vectorScore = Math.max(0, cosineSimilarity(queryEmbedding, chunk.embedding));
  const contentProductionPrompt = isContentProductionPrompt(prompt);
  const contextFitScore = contentProductionPrompt
    ? Math.min(1, chunk.businessSignalCount / 4)
    : Math.min(1, chunk.businessSignalCount / 6);
  const sourceScore = sourceScoreFor(chunk.sourceType);
  const rerankBoost =
    Math.min(0.14, chunk.businessSignalCount * 0.018) + (keywordScore > 0 ? 0.03 : 0);
  const finalScore = Math.min(
    1,
    keywordScore * 0.24 +
      vectorScore * 0.2 +
      contextFitScore * 0.41 +
      sourceScore * 0.05 +
      rerankBoost,
  );

  return {
    chunk,
    scores: {
      keywordScore,
      vectorScore,
      contextFitScore,
      sourceScore,
      rerankBoost,
      finalScore,
    },
  };
};

const isEligibleHit = (
  hit: ContentKnowledgeSearchHit,
  prompt: string,
  hitThreshold: number,
  minBusinessSignals: number,
): boolean => {
  if (hit.scores.finalScore < hitThreshold) {
    return false;
  }
  if (isContentProductionPrompt(prompt) && hit.chunk.businessSignalCount < minBusinessSignals) {
    return false;
  }
  return true;
};

export const searchContentKnowledgeIndex = (
  index: ContentKnowledgeIndex,
  prompt: string,
  options: ContentKnowledgeSearchOptions = {},
): ContentKnowledgeRetrievalResult => {
  const maxHits = options.maxHits ?? DEFAULT_MAX_HITS;
  const hitThreshold = options.hitThreshold ?? DEFAULT_HIT_THRESHOLD;
  const minBusinessSignals = options.minBusinessSignals ?? DEFAULT_MIN_BUSINESS_SIGNALS;
  const queryTokens = tokenizeContentKnowledgeText(prompt);
  const queryEmbedding = buildContentKnowledgeEmbedding(prompt, index.embeddingDimensions);
  const scoredHits = index.chunks
    .map(chunk => scoreChunk(chunk, prompt, queryTokens, queryEmbedding))
    .sort(
      (a, b) =>
        b.scores.finalScore - a.scores.finalScore ||
        b.chunk.businessSignalCount - a.chunk.businessSignalCount ||
        a.chunk.chunkIndex - b.chunk.chunkIndex,
    );
  const eligibleHits = scoredHits.filter(hit =>
    isEligibleHit(hit, prompt, hitThreshold, minBusinessSignals),
  );
  const rejectedHits = scoredHits.filter(
    hit => !isEligibleHit(hit, prompt, hitThreshold, minBusinessSignals),
  );

  return {
    matched: eligibleHits.length > 0,
    hits: eligibleHits.slice(0, maxHits),
    rejectedHits: rejectedHits.slice(0, maxHits),
    diagnostics: {
      candidateCount: index.chunks.length,
      rejectedCount: rejectedHits.length,
      hitThreshold,
      minBusinessSignalCount: minBusinessSignals,
      embeddingVersion: index.embeddingVersion,
    },
  };
};
