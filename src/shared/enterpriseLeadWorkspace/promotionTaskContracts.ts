import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadRiskLevel,
  type EnterpriseLeadTaskStatus,
} from './constants';
import {
  type PromotionAssetPackage,
  type PromotionCleanedRecord,
  PromotionConfidence,
  type PromotionContentQualityOutput,
  PromotionLeadTier,
  type PromotionMonitoringOutput,
  type PromotionScoredLead,
} from './promotionContracts';
import type {
  EnterpriseLeadAgentTaskResult,
  EnterpriseLeadRiskItem,
  EnterpriseLeadTaskAgentRole,
  EnterpriseLeadTodoInput,
} from './types';
import { normalizeAgentTaskResultInput } from './validation';
import {
  normalizeWorkflowArtifactRef,
  type WorkflowArtifactRef,
} from './workflowContracts';

type UnknownRecord = Record<string, unknown>;

export interface PromotionScrapingTaskItem {
  sourceKind: 'website' | 'social' | 'search' | 'manual' | 'unknown';
  sourceUrl: string;
  title: string;
  content: string;
  capturedAt: string;
  confidence: PromotionConfidence;
}

export interface PromotionScrapingTaskOutputs {
  items: PromotionScrapingTaskItem[];
}

export interface PromotionProductSellingPointTaskOutputs {
  sellingPoints: string[];
}

export interface PromotionControllerTaskOutputs {
  controlPlan: string;
  priorityTasks: string[];
  riskNotes: string[];
}

export interface PromotionCleaningTaskOutputs {
  records: PromotionCleanedRecord[];
  duplicates: string[];
  missingFields: string[];
}

export interface PromotionCompetitorInsightItem {
  competitor: string;
  finding: string;
  implication: string;
}

export interface PromotionCompetitorInsightTaskOutputs {
  competitorInsights: PromotionCompetitorInsightItem[];
}

export interface PromotionLeadScoringTaskOutputs {
  leads: PromotionScoredLead[];
}

export interface PromotionMultiPlatformAssetsTaskOutputs {
  assets: PromotionAssetPackage[];
}

export type PromotionContentQualityTaskOutputs = PromotionContentQualityOutput;

export type PromotionAccountMonitoringTaskOutputs = PromotionMonitoringOutput;

export interface PromotionPublishingScheduleDraft {
  platform: string;
  scheduledFor: string;
  draftSummary: string;
  manualReviewRequired: true;
}

export interface PromotionPublishingScheduleTaskOutputs {
  publicationDrafts: PromotionPublishingScheduleDraft[];
}

export interface PromotionPerformanceReviewTaskOutputs {
  reviewSummary: string;
  effectiveStrategies: string[];
  improvementActions: string[];
}

export interface PromotionSalesHandoffDraft {
  summary: string;
  followUpTasks: string[];
  manualReviewRequired: true;
}

export interface PromotionSalesHandoffTaskOutputs {
  handoffDraft: PromotionSalesHandoffDraft;
}

export interface PromotionTaskResult<TOutputs extends object = object> {
  role: EnterpriseLeadTaskAgentRole;
  status: EnterpriseLeadTaskStatus;
  summary: string;
  outputs: TOutputs;
  missingInfo: string[];
  todos: EnterpriseLeadTodoInput[];
  risks: EnterpriseLeadRiskItem[];
  handoffContext: UnknownRecord;
  artifactRefs: WorkflowArtifactRef[];
}

const PromotionSourceKind = {
  Website: 'website',
  Social: 'social',
  Search: 'search',
  Manual: 'manual',
  Unknown: 'unknown',
} as const;

const promotionRolePrefix = 'promotion_';

export const isPromotionTaskContext = (
  role: EnterpriseLeadTaskAgentRole,
  upstreamRoles: EnterpriseLeadTaskAgentRole[],
): boolean => {
  if (role.startsWith(promotionRolePrefix)) {
    return true;
  }

  const hasPromotionUpstream = upstreamRoles.some(upstreamRole =>
    upstreamRole.startsWith(promotionRolePrefix),
  );
  return (
    hasPromotionUpstream &&
    (role === EnterpriseLeadAgentRole.ProductSellingPoint ||
      role === EnterpriseLeadAgentRole.ContentQuality ||
      role === EnterpriseLeadAgentRole.SalesHandoff)
  );
};

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readRequiredText = (record: UnknownRecord, key: string): string => {
  const value = typeof record[key] === 'string' ? record[key].trim() : '';
  if (!value) {
    throw new Error(`promotion task output ${key} is required`);
  }
  return value;
};

const readOptionalText = (record: UnknownRecord, key: string): string =>
  typeof record[key] === 'string' ? record[key].trim() : '';

const readRequiredArray = (record: UnknownRecord, key: string): unknown[] => {
  if (!Array.isArray(record[key])) {
    throw new Error(`promotion task output ${key} must be an array`);
  }
  return record[key];
};

const normalizeTextList = (value: unknown, key: string): string[] =>
  readRequiredArray({ [key]: value }, key).map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`promotion task output ${key}[${index}] must be non-empty text`);
    }
    return item.trim();
  });

const normalizeRecordArray = (value: unknown, key: string): UnknownRecord[] =>
  readRequiredArray({ [key]: value }, key).map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`promotion task output ${key}[${index}] must be an object`);
    }
    return item;
  });

const requireNonEmpty = <T>(items: T[], key: string): T[] => {
  if (items.length === 0) {
    throw new Error(`promotion task output ${key} must not be empty`);
  }
  return items;
};

const normalizeConfidence = (value: unknown, key: string): PromotionConfidence => {
  const confidence = typeof value === 'string' ? value.trim() : '';
  if (!Object.values(PromotionConfidence).includes(confidence as PromotionConfidence)) {
    throw new Error(`promotion task output ${key} is invalid`);
  }
  return confidence as PromotionConfidence;
};

const normalizeArtifactRefs = (outputs: UnknownRecord): WorkflowArtifactRef[] => {
  if (!Array.isArray(outputs.artifactRefs)) {
    return [];
  }
  return outputs.artifactRefs
    .map(normalizeWorkflowArtifactRef)
    .filter((artifact): artifact is WorkflowArtifactRef => artifact !== null);
};

const normalizeSourceUrl = (record: UnknownRecord): string => {
  const sourceUrl = readRequiredText(record, 'sourceUrl');
  try {
    const url = new URL(sourceUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString();
    }
  } catch {
    // The shared contract rejects malformed source evidence below.
  }
  throw new Error('promotion task output sourceUrl must be an http(s) URL');
};

const normalizeScrapingOutputs = (outputs: UnknownRecord): PromotionScrapingTaskOutputs => ({
  items: requireNonEmpty(normalizeRecordArray(outputs.items, 'items').map(item => {
    const sourceKind = readRequiredText(item, 'sourceKind');
    if (!Object.values(PromotionSourceKind).includes(sourceKind as PromotionScrapingTaskItem['sourceKind'])) {
      throw new Error('promotion task output sourceKind is invalid');
    }
    const capturedAt = readRequiredText(item, 'capturedAt');
    if (Number.isNaN(Date.parse(capturedAt))) {
      throw new Error('promotion task output capturedAt is invalid');
    }
    return {
      sourceKind: sourceKind as PromotionScrapingTaskItem['sourceKind'],
      sourceUrl: normalizeSourceUrl(item),
      title: readRequiredText(item, 'title'),
      content: readRequiredText(item, 'content'),
      capturedAt: new Date(capturedAt).toISOString(),
      confidence: normalizeConfidence(item.confidence, 'confidence'),
    };
  }), 'items'),
});

const normalizeProductSellingPointOutputs = (
  outputs: UnknownRecord,
): PromotionProductSellingPointTaskOutputs => ({
  sellingPoints: normalizeTextList(outputs.sellingPoints, 'sellingPoints'),
});

const normalizeControllerOutputs = (outputs: UnknownRecord): PromotionControllerTaskOutputs => ({
  controlPlan: readRequiredText(outputs, 'controlPlan'),
  priorityTasks: normalizeTextList(outputs.priorityTasks, 'priorityTasks'),
  riskNotes: normalizeTextList(outputs.riskNotes, 'riskNotes'),
});

const normalizeFieldConfidence = (value: unknown): Record<string, PromotionConfidence> => {
  if (!isRecord(value)) {
    throw new Error('promotion task output fieldConfidence must be an object');
  }
  const entries = Object.entries(value).map(([field, confidence]) => [
    field.trim(),
    normalizeConfidence(confidence, `fieldConfidence.${field}`),
  ] as const);
  if (entries.length === 0 || entries.some(([field]) => !field)) {
    throw new Error('promotion task output fieldConfidence is required');
  }
  return Object.fromEntries(entries);
};

const normalizeCleaningOutputs = (outputs: UnknownRecord): PromotionCleaningTaskOutputs => ({
  records: requireNonEmpty(normalizeRecordArray(outputs.records, 'records').map(record => ({
    id: readRequiredText(record, 'id'),
    companyName: readRequiredText(record, 'companyName'),
    industry: readRequiredText(record, 'industry'),
    contactHint: readOptionalText(record, 'contactHint'),
    fieldConfidence: normalizeFieldConfidence(record.fieldConfidence),
  })), 'records'),
  duplicates: normalizeTextList(outputs.duplicates, 'duplicates'),
  missingFields: normalizeTextList(outputs.missingFields, 'missingFields'),
});

const normalizeCompetitorInsightOutputs = (
  outputs: UnknownRecord,
): PromotionCompetitorInsightTaskOutputs => ({
  competitorInsights: requireNonEmpty(
    normalizeRecordArray(outputs.competitorInsights, 'competitorInsights').map(insight => ({
      competitor: readRequiredText(insight, 'competitor'),
      finding: readRequiredText(insight, 'finding'),
      implication: readRequiredText(insight, 'implication'),
    })),
    'competitorInsights',
  ),
});

const normalizeLeadScoringOutputs = (outputs: UnknownRecord): PromotionLeadScoringTaskOutputs => ({
  leads: requireNonEmpty(normalizeRecordArray(outputs.leads, 'leads').map(lead => {
    const score = lead.score;
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error('promotion task output score must be between 0 and 100');
    }
    const tier = readRequiredText(lead, 'tier');
    if (!Object.values(PromotionLeadTier).includes(tier as PromotionScoredLead['tier'])) {
      throw new Error('promotion task output tier is invalid');
    }
    return {
      id: readRequiredText(lead, 'id'),
      score,
      tier: tier as PromotionScoredLead['tier'],
      reasons: normalizeTextList(lead.reasons, 'reasons'),
      missingFields: normalizeTextList(lead.missingFields, 'missingFields'),
      nextAction: readRequiredText(lead, 'nextAction'),
    };
  }), 'leads'),
});

const normalizeAssetsOutputs = (outputs: UnknownRecord): PromotionMultiPlatformAssetsTaskOutputs => ({
  assets: requireNonEmpty(normalizeRecordArray(outputs.assets, 'assets').map(asset => ({
    platform: readRequiredText(asset, 'platform'),
    title: readRequiredText(asset, 'title'),
    body: readRequiredText(asset, 'body'),
    tags: normalizeTextList(asset.tags, 'tags'),
    callToAction: readRequiredText(asset, 'callToAction'),
    manualReviewRequired: true,
  })), 'assets'),
});

const normalizeQualityOutputs = (outputs: UnknownRecord): PromotionContentQualityTaskOutputs => {
  const riskLevel = readRequiredText(outputs, 'riskLevel');
  if (!Object.values(EnterpriseLeadRiskLevel).includes(riskLevel as EnterpriseLeadRiskLevel)) {
    throw new Error('promotion task output riskLevel is invalid');
  }
  if (typeof outputs.canArchive !== 'boolean') {
    throw new Error('promotion task output canArchive must be a boolean');
  }
  return {
    riskLevel: riskLevel as PromotionContentQualityTaskOutputs['riskLevel'],
    blockingIssues: normalizeTextList(outputs.blockingIssues, 'blockingIssues'),
    warnings: normalizeTextList(outputs.warnings, 'warnings'),
    requiredRevisions: normalizeTextList(outputs.requiredRevisions, 'requiredRevisions'),
    canArchive: riskLevel === EnterpriseLeadRiskLevel.High ? false : outputs.canArchive,
  };
};

const normalizeMonitoringRecordList = (value: unknown, key: string): Array<Record<string, unknown>> =>
  normalizeRecordArray(value, key).map(record => ({ ...record }));

const normalizeMonitoringOutputs = (outputs: UnknownRecord): PromotionAccountMonitoringTaskOutputs => ({
  metrics: requireNonEmpty(normalizeMonitoringRecordList(outputs.metrics, 'metrics'), 'metrics'),
  anomalies: requireNonEmpty(normalizeMonitoringRecordList(outputs.anomalies, 'anomalies'), 'anomalies'),
  hypotheses: requireNonEmpty(normalizeTextList(outputs.hypotheses, 'hypotheses'), 'hypotheses'),
  adjustmentActions: requireNonEmpty(
    normalizeTextList(outputs.adjustmentActions, 'adjustmentActions'),
    'adjustmentActions',
  ),
});

const normalizeScheduledFor = (value: unknown): string => {
  const scheduledFor = typeof value === 'string' ? value.trim() : '';
  if (!scheduledFor || Number.isNaN(Date.parse(scheduledFor))) {
    throw new Error('promotion task output scheduledFor is invalid');
  }
  return new Date(scheduledFor).toISOString();
};

const normalizePublishingScheduleOutputs = (
  outputs: UnknownRecord,
): PromotionPublishingScheduleTaskOutputs => ({
  publicationDrafts: requireNonEmpty(
    normalizeRecordArray(outputs.publicationDrafts, 'publicationDrafts').map(draft => ({
      platform: readRequiredText(draft, 'platform'),
      scheduledFor: normalizeScheduledFor(draft.scheduledFor),
      draftSummary: readRequiredText(draft, 'draftSummary'),
      manualReviewRequired: true,
    })),
    'publicationDrafts',
  ),
});

const normalizePerformanceReviewOutputs = (
  outputs: UnknownRecord,
): PromotionPerformanceReviewTaskOutputs => ({
  reviewSummary: readRequiredText(outputs, 'reviewSummary'),
  effectiveStrategies: normalizeTextList(outputs.effectiveStrategies, 'effectiveStrategies'),
  improvementActions: normalizeTextList(outputs.improvementActions, 'improvementActions'),
});

const normalizeSalesHandoffOutputs = (outputs: UnknownRecord): PromotionSalesHandoffTaskOutputs => {
  if (!isRecord(outputs.handoffDraft)) {
    throw new Error('promotion task output handoffDraft must be an object');
  }
  return {
    handoffDraft: {
      summary: readRequiredText(outputs.handoffDraft, 'summary'),
      followUpTasks: requireNonEmpty(
        normalizeTextList(outputs.handoffDraft.followUpTasks, 'followUpTasks'),
        'followUpTasks',
      ),
      manualReviewRequired: true,
    },
  };
};

const normalizeRoleOutputs = (
  role: EnterpriseLeadTaskAgentRole,
  outputs: UnknownRecord,
): object => {
  switch (role) {
    case EnterpriseLeadAgentRole.PromotionController:
      return normalizeControllerOutputs(outputs);
    case EnterpriseLeadAgentRole.PromotionDataScraping:
      return normalizeScrapingOutputs(outputs);
    case EnterpriseLeadAgentRole.ProductSellingPoint:
      return normalizeProductSellingPointOutputs(outputs);
    case EnterpriseLeadAgentRole.PromotionDataCleaning:
      return normalizeCleaningOutputs(outputs);
    case EnterpriseLeadAgentRole.PromotionCompetitorInsight:
      return normalizeCompetitorInsightOutputs(outputs);
    case EnterpriseLeadAgentRole.PromotionLeadScoring:
      return normalizeLeadScoringOutputs(outputs);
    case EnterpriseLeadAgentRole.PromotionMultiPlatformAssets:
      return normalizeAssetsOutputs(outputs);
    case EnterpriseLeadAgentRole.ContentQuality:
      return normalizeQualityOutputs(outputs);
    case EnterpriseLeadAgentRole.PromotionAccountMonitoring:
      return normalizeMonitoringOutputs(outputs);
    case EnterpriseLeadAgentRole.PromotionPublishingSchedule:
      return normalizePublishingScheduleOutputs(outputs);
    case EnterpriseLeadAgentRole.PromotionPerformanceReview:
      return normalizePerformanceReviewOutputs(outputs);
    case EnterpriseLeadAgentRole.SalesHandoff:
      return normalizeSalesHandoffOutputs(outputs);
    default:
      throw new Error(`promotion task role ${role} does not have an output contract`);
  }
};

const toPromotionTaskResult = <TOutputs extends object>(
  role: EnterpriseLeadTaskAgentRole,
  base: EnterpriseLeadAgentTaskResult,
  outputs: TOutputs,
  artifactRefs: WorkflowArtifactRef[],
): PromotionTaskResult<TOutputs> => ({
  role,
  status: base.status as EnterpriseLeadTaskStatus,
  summary: base.summary,
  outputs,
  missingInfo: base.missingInfo,
  todos: base.todos,
  risks: base.risks,
  handoffContext: base.handoffContext,
  artifactRefs,
});

export function parsePromotionTaskResult(
  role: typeof EnterpriseLeadAgentRole.PromotionController,
  value: unknown,
): PromotionTaskResult<PromotionControllerTaskOutputs>;
export function parsePromotionTaskResult(
  role: typeof EnterpriseLeadAgentRole.PromotionDataScraping,
  value: unknown,
): PromotionTaskResult<PromotionScrapingTaskOutputs>;
export function parsePromotionTaskResult(
  role: typeof EnterpriseLeadAgentRole.PromotionCompetitorInsight,
  value: unknown,
): PromotionTaskResult<PromotionCompetitorInsightTaskOutputs>;
export function parsePromotionTaskResult(
  role: typeof EnterpriseLeadAgentRole.ProductSellingPoint,
  value: unknown,
): PromotionTaskResult<PromotionProductSellingPointTaskOutputs>;
export function parsePromotionTaskResult(
  role: typeof EnterpriseLeadAgentRole.PromotionDataCleaning,
  value: unknown,
): PromotionTaskResult<PromotionCleaningTaskOutputs>;
export function parsePromotionTaskResult(
  role: typeof EnterpriseLeadAgentRole.PromotionLeadScoring,
  value: unknown,
): PromotionTaskResult<PromotionLeadScoringTaskOutputs>;
export function parsePromotionTaskResult(
  role: typeof EnterpriseLeadAgentRole.PromotionMultiPlatformAssets,
  value: unknown,
): PromotionTaskResult<PromotionMultiPlatformAssetsTaskOutputs>;
export function parsePromotionTaskResult(
  role: typeof EnterpriseLeadAgentRole.ContentQuality,
  value: unknown,
): PromotionTaskResult<PromotionContentQualityTaskOutputs>;
export function parsePromotionTaskResult(
  role: typeof EnterpriseLeadAgentRole.PromotionAccountMonitoring,
  value: unknown,
): PromotionTaskResult<PromotionAccountMonitoringTaskOutputs>;
export function parsePromotionTaskResult(
  role: typeof EnterpriseLeadAgentRole.PromotionPublishingSchedule,
  value: unknown,
): PromotionTaskResult<PromotionPublishingScheduleTaskOutputs>;
export function parsePromotionTaskResult(
  role: typeof EnterpriseLeadAgentRole.PromotionPerformanceReview,
  value: unknown,
): PromotionTaskResult<PromotionPerformanceReviewTaskOutputs>;
export function parsePromotionTaskResult(
  role: typeof EnterpriseLeadAgentRole.SalesHandoff,
  value: unknown,
): PromotionTaskResult<PromotionSalesHandoffTaskOutputs>;
export function parsePromotionTaskResult(
  role: EnterpriseLeadTaskAgentRole,
  value: unknown,
): PromotionTaskResult;
export function parsePromotionTaskResult(
  role: EnterpriseLeadTaskAgentRole,
  value: unknown,
): PromotionTaskResult {
  const base = normalizeAgentTaskResultInput(value);
  const outputs = normalizeRoleOutputs(role, base.outputs);
  return toPromotionTaskResult(role, base, outputs, normalizeArtifactRefs(base.outputs));
}
