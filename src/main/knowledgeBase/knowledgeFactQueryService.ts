import { types as nodeUtilTypes } from 'node:util';

import {
  KNOWLEDGE_FACT_EVIDENCE_PAGE_DEFAULT_LIMIT,
  KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT,
  KnowledgeBaseErrorCode,
  KnowledgeFactDomain,
  KnowledgeFactEvidenceState,
  KnowledgeFactListView,
  KnowledgeFactReviewStatus,
} from '../../shared/knowledgeBase/constants';
import type {
  KnowledgeFactEvidencePageRequest,
  KnowledgeFactEvidencePageResult,
  KnowledgeFactEvidenceSummary,
  KnowledgeFactListResult,
  KnowledgeFactMetrics,
  KnowledgeFactSummary,
  KnowledgeListFactsRequest,
} from '../../shared/knowledgeBase/types';
import {
  type KnowledgeFactEvidencePageQueryCursor,
  type KnowledgeFactEvidenceQueryRecord,
  KnowledgeFactStateError,
  KnowledgeFactStore,
} from './knowledgeFactStore';

type CursorValue = {
  v: 1;
  updatedAt: string;
  id: string;
};

type EvidenceCursorValue = {
  v: 1;
  factId: string;
  factRevision: number;
  stale: boolean;
  confidence: number;
  createdAt: string;
  id: string;
};

const factViewSet = new Set<string>(Object.values(KnowledgeFactListView));
const evidenceStateSet = new Set<string>(Object.values(KnowledgeFactEvidenceState));
const reviewStatusSet = new Set<string>(Object.values(KnowledgeFactReviewStatus));
const CURSOR_MAX_LENGTH = 2_048;

const invalidRequest = (): never => {
  throw new KnowledgeFactStateError(KnowledgeBaseErrorCode.InvalidRequest);
};

const invalidState = (): never => {
  throw new KnowledgeFactStateError(KnowledgeBaseErrorCode.JobStateConflict);
};

const listInputKeys = [
  'workspaceId',
  'view',
  'reviewStatuses',
  'evidenceState',
  'cursor',
  'limit',
] as const;

const evidencePageInputKeys = [
  'factId',
  'expectedRevision',
  'cursor',
  'limit',
] as const;

const readListInputRecord = (value: unknown): Record<string, unknown> => {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      nodeUtilTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return invalidRequest();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.some(key => !listInputKeys.includes(key as typeof listInputKeys[number]))) {
      return invalidRequest();
    }
    const record: Record<string, unknown> = {};
    for (const key of listInputKeys) {
      const descriptor = descriptors[key];
      if (!descriptor) {
        continue;
      }
      if (!descriptor.enumerable || !('value' in descriptor)) {
        return invalidRequest();
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch (error) {
    if (error instanceof KnowledgeFactStateError) {
      throw error;
    }
    return invalidRequest();
  }
};

const readEvidencePageInputRecord = (value: unknown): Record<string, unknown> => {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      nodeUtilTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return invalidRequest();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => (
      typeof key !== 'string' ||
      !evidencePageInputKeys.includes(key as typeof evidencePageInputKeys[number])
    ))) {
      return invalidRequest();
    }
    const record: Record<string, unknown> = {};
    for (const key of evidencePageInputKeys) {
      const descriptor = descriptors[key];
      if (!descriptor) {
        continue;
      }
      if (!descriptor.enumerable || !('value' in descriptor)) {
        return invalidRequest();
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch (error) {
    if (error instanceof KnowledgeFactStateError) {
      throw error;
    }
    return invalidRequest();
  }
};

const copyReviewStatuses = (value: unknown): unknown[] => {
  try {
    if (
      !Array.isArray(value) ||
      nodeUtilTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return invalidRequest();
    }
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      !length ||
      !('value' in length) ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0
    ) {
      return invalidRequest();
    }
    const result: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        return invalidRequest();
      }
      result.push(descriptor.value);
    }
    return result;
  } catch (error) {
    if (error instanceof KnowledgeFactStateError) {
      throw error;
    }
    return invalidRequest();
  }
};

const encodeCursor = (value: CursorValue): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

const decodeCursor = (value: unknown): CursorValue => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > CURSOR_MAX_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return invalidRequest();
  }
  let parsed: unknown;
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) {
      return invalidRequest();
    }
    const decodedText = decoded.toString('utf8');
    if (!Buffer.from(decodedText, 'utf8').equals(decoded)) {
      return invalidRequest();
    }
    parsed = JSON.parse(decodedText);
  } catch {
    return invalidRequest();
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    return invalidRequest();
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(',') !== 'id,updatedAt,v' || record.v !== 1) {
    return invalidRequest();
  }
  if (typeof record.id !== 'string' || record.id.trim().length === 0) {
    return invalidRequest();
  }
  if (typeof record.updatedAt !== 'string') {
    return invalidRequest();
  }
  try {
    if (new Date(record.updatedAt).toISOString() !== record.updatedAt) {
      return invalidRequest();
    }
  } catch {
    return invalidRequest();
  }
  return { v: 1, updatedAt: record.updatedAt, id: record.id };
};

const exponentFreeNumber = (value: number): string => {
  const source = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(source);
  if (!match) {
    return source;
  }
  const sign = match[1];
  const whole = match[2];
  const fraction = match[3] ?? '';
  const exponent = Number(match[4]);
  const digits = whole + fraction;
  const point = whole.length + exponent;
  if (point <= 0) {
    return `${sign}0.${'0'.repeat(-point)}${digits}`;
  }
  if (point >= digits.length) {
    return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  }
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
};

const serializeEvidenceCursor = (value: EvidenceCursorValue): string =>
  `{"v":1,"factId":${JSON.stringify(value.factId)},` +
  `"factRevision":${value.factRevision},"stale":${value.stale},` +
  `"confidence":${exponentFreeNumber(value.confidence)},` +
  `"createdAt":${JSON.stringify(value.createdAt)},"id":${JSON.stringify(value.id)}}`;

const encodeEvidenceCursorToken = (value: EvidenceCursorValue): string =>
  Buffer.from(serializeEvidenceCursor(value), 'utf8').toString('base64url');

const encodeEvidenceCursor = (value: EvidenceCursorValue): string => {
  const token = encodeEvidenceCursorToken(value);
  if (token.length > CURSOR_MAX_LENGTH) {
    return invalidState();
  }
  return token;
};

const decodeEvidenceCursor = (value: unknown): EvidenceCursorValue => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > CURSOR_MAX_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return invalidRequest();
  }
  let parsed: unknown;
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) {
      return invalidRequest();
    }
    const decodedText = decoded.toString('utf8');
    if (!Buffer.from(decodedText, 'utf8').equals(decoded)) {
      return invalidRequest();
    }
    parsed = JSON.parse(decodedText);
  } catch {
    return invalidRequest();
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    return invalidRequest();
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.join(',') !== 'v,factId,factRevision,stale,confidence,createdAt,id' ||
    record.v !== 1 ||
    typeof record.factId !== 'string' ||
    record.factId.trim().length === 0 ||
    typeof record.factRevision !== 'number' ||
    !Number.isSafeInteger(record.factRevision) ||
    record.factRevision < 1 ||
    typeof record.stale !== 'boolean' ||
    typeof record.confidence !== 'number' ||
    !Number.isFinite(record.confidence) ||
    Object.is(record.confidence, -0) ||
    record.confidence < 0 ||
    record.confidence > 1 ||
    typeof record.createdAt !== 'string' ||
    typeof record.id !== 'string' ||
    !/^[0-9a-f]{64}$/.test(record.id)
  ) {
    return invalidRequest();
  }
  try {
    if (new Date(record.createdAt).toISOString() !== record.createdAt) {
      return invalidRequest();
    }
  } catch {
    return invalidRequest();
  }
  const cursor: EvidenceCursorValue = {
    v: 1,
    factId: record.factId,
    factRevision: record.factRevision,
    stale: record.stale,
    confidence: record.confidence,
    createdAt: record.createdAt,
    id: record.id,
  };
  if (encodeEvidenceCursorToken(cursor) !== value) {
    return invalidRequest();
  }
  return cursor;
};

const normalizeInput = (input: KnowledgeListFactsRequest): {
  workspaceId: string;
  view: KnowledgeFactListView;
  reviewStatuses: KnowledgeFactReviewStatus[];
  evidenceState: KnowledgeFactEvidenceState;
  cursor: CursorValue | null;
  limit: number;
} => {
  const record = readListInputRecord(input);
  if (
    typeof record.workspaceId !== 'string' ||
    record.workspaceId.trim().length === 0
  ) {
    return invalidRequest();
  }
  const view = record.view ?? KnowledgeFactListView.Active;
  const evidenceState = record.evidenceState ?? KnowledgeFactEvidenceState.Any;
  if (
    typeof view !== 'string' ||
    typeof evidenceState !== 'string' ||
    !factViewSet.has(view) ||
    !evidenceStateSet.has(evidenceState)
  ) {
    return invalidRequest();
  }
  let reviewStatuses: KnowledgeFactReviewStatus[] = [];
  if (record.reviewStatuses !== undefined) {
    const rawReviewStatuses = copyReviewStatuses(record.reviewStatuses);
    if (rawReviewStatuses.some(status => typeof status !== 'string')) {
      return invalidRequest();
    }
    const uniqueReviewStatuses = [...new Set(rawReviewStatuses as string[])];
    if (uniqueReviewStatuses.some(status => !reviewStatusSet.has(status))) {
      return invalidRequest();
    }
    reviewStatuses = uniqueReviewStatuses as KnowledgeFactReviewStatus[];
  }
  const limit = record.limit ?? 50;
  if (
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return invalidRequest();
  }
  return {
    workspaceId: record.workspaceId.trim(),
    view: view as KnowledgeFactListView,
    reviewStatuses,
    evidenceState: evidenceState as KnowledgeFactEvidenceState,
    cursor: record.cursor === undefined ? null : decodeCursor(record.cursor),
    limit,
  };
};

const normalizeEvidencePageInput = (
  input: KnowledgeFactEvidencePageRequest,
): {
  factId: string;
  expectedRevision: number;
  cursor: KnowledgeFactEvidencePageQueryCursor | null;
  limit: number;
} => {
  const record = readEvidencePageInputRecord(input);
  if (
    typeof record.factId !== 'string' ||
    record.factId.trim().length === 0 ||
    typeof record.expectedRevision !== 'number' ||
    !Number.isSafeInteger(record.expectedRevision) ||
    record.expectedRevision < 1
  ) {
    return invalidRequest();
  }
  const factId = record.factId;
  const expectedRevision = record.expectedRevision;
  const limit = record.limit ?? KNOWLEDGE_FACT_EVIDENCE_PAGE_DEFAULT_LIMIT;
  if (
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > KNOWLEDGE_FACT_EVIDENCE_PAGE_MAX_LIMIT
  ) {
    return invalidRequest();
  }
  const cursorValue = record.cursor === undefined
    ? null
    : decodeEvidenceCursor(record.cursor);
  if (
    cursorValue !== null &&
    (
      cursorValue.factId !== factId ||
      cursorValue.factRevision !== expectedRevision
    )
  ) {
    return invalidRequest();
  }
  return {
    factId,
    expectedRevision,
    cursor: cursorValue === null
      ? null
      : {
        stale: cursorValue.stale,
        confidence: cursorValue.confidence,
        createdAt: cursorValue.createdAt,
        id: cursorValue.id,
      },
    limit,
  };
};

const compatibleProfileJson = (profileJson: unknown): string | null => {
  if (typeof profileJson !== 'string') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(profileJson);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const profile = parsed as Record<string, unknown>;
  const arrayDomains = [
    KnowledgeFactDomain.ProductList,
    KnowledgeFactDomain.ProductCapabilities,
    KnowledgeFactDomain.TargetCustomers,
    KnowledgeFactDomain.ApplicationScenarios,
    KnowledgeFactDomain.SellingPoints,
    KnowledgeFactDomain.ChannelPreferences,
    KnowledgeFactDomain.ProhibitedClaims,
    KnowledgeFactDomain.ContactRules,
    KnowledgeFactDomain.MissingInfo,
  ] as const;
  if (typeof profile.companySummary !== 'string') {
    return null;
  }
  for (const domain of arrayDomains) {
    if (
      !Array.isArray(profile[domain]) ||
      (profile[domain] as unknown[]).some(value => typeof value !== 'string')
    ) {
      return null;
    }
  }
  const canonicalProfile: Record<string, string | string[]> = {
    companySummary: profile.companySummary,
  };
  for (const domain of arrayDomains) {
    canonicalProfile[domain] = [...profile[domain] as string[]];
  }
  return JSON.stringify(canonicalProfile);
};

const toEvidenceSummary = (
  record: KnowledgeFactEvidenceQueryRecord,
  truncateQuote: boolean,
): KnowledgeFactEvidenceSummary => ({
  id: record.evidence.id,
  factId: record.evidence.factId,
  documentId: record.evidence.documentId,
  documentVersionId: record.evidence.documentVersionId,
  documentDisplayName: record.documentDisplayName,
  quote: truncateQuote ? record.evidence.quote.slice(0, 240) : record.evidence.quote,
  confidence: record.evidence.confidence,
  stale: record.evidence.staleAt !== null,
  createdAt: record.evidence.createdAt,
});

export class KnowledgeFactQueryService {
  constructor(private readonly factStore: KnowledgeFactStore) {}

  listFacts(input: KnowledgeListFactsRequest): KnowledgeFactListResult {
    const normalized = normalizeInput(input);
    try {
      const profileJson = compatibleProfileJson(
        this.factStore.getWorkspaceProfileForQuery(normalized.workspaceId),
      );
      const pageFacts = this.factStore.listFactPageForQuery(normalized);
      const hasMore = pageFacts.length > normalized.limit;
      const facts = pageFacts.slice(0, normalized.limit);
      const previews = this.factStore.listFactEvidencePreviewsForQuery(
        facts.map(fact => fact.id),
      );
      const previewByFactId = new Map(previews.map(preview => [preview.factId, preview]));
      const metricRecord = this.factStore.getFactMetricsForQuery(
        normalized.workspaceId,
        profileJson,
      );
      const items = facts.map((fact): KnowledgeFactSummary => {
        const projection = previewByFactId.get(fact.id);
        if (!projection) {
          return invalidState();
        }
        return {
          id: fact.id,
          domain: fact.domain,
          value: fact.value,
          reviewStatus: fact.reviewStatus,
          sourceKind: fact.sourceKind,
          revision: fact.revision,
          projectionState: fact.projectionState,
          activeEvidenceCount: projection.activeEvidenceCount,
          staleEvidenceCount: projection.staleEvidenceCount,
          evidencePreview: projection.preview
            ? toEvidenceSummary(projection.preview, true)
            : null,
          createdAt: fact.createdAt,
          reviewedAt: fact.reviewedAt,
          updatedAt: fact.updatedAt,
          archivedAt: fact.tombstonedAt,
        };
      });
      const metrics: KnowledgeFactMetrics = {
        activePendingCount: metricRecord.activePendingCount,
        activeConfirmedCount: metricRecord.activeConfirmedCount,
        staleConfirmedCount: metricRecord.staleConfirmedCount,
        rejectedHistoryCount: metricRecord.rejectedHistoryCount,
        archivedHistoryCount: metricRecord.archivedHistoryCount,
        unduplicatedLegacyConfirmedCount: metricRecord.unduplicatedLegacyConfirmedCount,
        totalAiKnowledgeCount:
          metricRecord.activePendingCount +
          metricRecord.activeConfirmedCount +
          metricRecord.staleConfirmedCount +
          metricRecord.unduplicatedLegacyConfirmedCount,
      };
      const cursorFact = hasMore ? facts[facts.length - 1] : null;
      return {
        items,
        nextCursor: cursorFact
          ? encodeCursor({ v: 1, updatedAt: cursorFact.updatedAt, id: cursorFact.id })
          : null,
        metrics,
      };
    } catch (error) {
      if (error instanceof KnowledgeFactStateError) {
        throw error;
      }
      return invalidState();
    }
  }

  getFactEvidence(input: KnowledgeFactEvidencePageRequest): KnowledgeFactEvidencePageResult {
    const normalized = normalizeEvidencePageInput(input);
    try {
      const page = this.factStore.listFactEvidenceForQuery(
        normalized,
        record => toEvidenceSummary(record, false),
      );
      if (
        page.factId !== normalized.factId ||
        page.factRevision !== normalized.expectedRevision ||
        page.items.length > normalized.limit ||
        (page.hasMore && page.items.length === 0)
      ) {
        return invalidState();
      }
      const lastItem = page.hasMore ? page.items[page.items.length - 1] : null;
      return {
        factId: page.factId,
        factRevision: page.factRevision,
        items: page.items,
        nextCursor: lastItem === null
          ? null
          : encodeEvidenceCursor({
            v: 1,
            factId: page.factId,
            factRevision: page.factRevision,
            stale: lastItem.stale,
            confidence: lastItem.confidence,
            createdAt: lastItem.createdAt,
            id: lastItem.id,
          }),
      };
    } catch (error) {
      if (error instanceof KnowledgeFactStateError) {
        throw error;
      }
      return invalidState();
    }
  }
}
