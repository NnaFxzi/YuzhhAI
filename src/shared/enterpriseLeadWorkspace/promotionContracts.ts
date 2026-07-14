export interface PromotionScrapedItem {
  id: string;
  sourceKind: 'website' | 'social' | 'search' | 'manual' | 'unknown';
  sourceUrl: string;
  title: string;
  content: string;
  capturedAt: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface PromotionLeadRecord {
  id: string;
  companyName: string;
  contactHint: string;
  industry: string;
  intentSignals: string[];
  score: number;
  missingFields: string[];
}

export interface PromotionMetricSnapshot {
  channel: string;
  accountName: string;
  capturedAt: string;
  impressions: number;
  clicks: number;
  interactions: number;
  leads: number;
  cost: number;
  sourceId?: string;
  periodStart?: string;
  periodEnd?: string;
  currency?: string;
  evidenceIds?: string[];
}

export interface PromotionMonitoringWindow {
  start: string;
  end: string;
}

export interface PromotionMonitoringScheduleContext {
  workspaceId: string;
  runId: string;
  agentId: string;
  metricSource: PromotionMetricSnapshot;
  idempotencyKey: string;
  window: PromotionMonitoringWindow;
}

export const PromotionMonitoringReason = {
  MetricSnapshot: 'metric_snapshot',
  MetricPlatform: 'metric_platform',
  MetricSource: 'metric_source',
  MetricPeriod: 'metric_period',
  IdempotencyKey: 'idempotency_key',
  Workspace: 'workspace',
  Run: 'run',
  MonitoringAgent: 'monitoring_agent',
} as const;
export type PromotionMonitoringReason =
  typeof PromotionMonitoringReason[keyof typeof PromotionMonitoringReason];

export interface PromotionMonitoringScheduleValidation {
  context: PromotionMonitoringScheduleContext | null;
  reasons: PromotionMonitoringReason[];
}

export const PromotionMonitoringPresentation = {
  NeedsVerifiedInput: 'promotion_monitoring_needs_verified_input',
  ReviewBlocked: 'promotion_monitoring_review_blocked',
} as const;
export type PromotionMonitoringPresentation =
  typeof PromotionMonitoringPresentation[keyof typeof PromotionMonitoringPresentation];

export const PromotionArtifactKind = {
  MetricReport: 'promotion_metric_report',
  PerformanceReview: 'promotion_performance_review',
} as const;
export type PromotionArtifactKind =
  (typeof PromotionArtifactKind)[keyof typeof PromotionArtifactKind];

const knownPromotionMetricPlatforms = new Set([
  'xiaohongshu',
  'douyin',
  'kuaishou',
  'wechatofficial',
  'wecom',
]);

const readMetricText = (value: unknown, key: string): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`promotion metric ${key} is required`);
  return text;
};

const normalizeMetricTimestamp = (value: unknown, key: string, required: boolean): string | undefined => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text && !required) return undefined;
  if (!text || Number.isNaN(Date.parse(text))) {
    throw new Error(`promotion metric ${key} must be an ISO timestamp`);
  }
  return new Date(text).toISOString();
};

const normalizeMetricNumber = (value: unknown, key: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`promotion metric ${key} must be a non-negative number`);
  }
  return value;
};

export const normalizePromotionMetricSnapshot = (value: unknown): PromotionMetricSnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('promotion metric snapshot must be an object');
  }
  const source = value as Record<string, unknown>;
  const periodStart = normalizeMetricTimestamp(source.periodStart, 'periodStart', false);
  const periodEnd = normalizeMetricTimestamp(source.periodEnd, 'periodEnd', false);
  if (periodStart && periodEnd && Date.parse(periodStart) > Date.parse(periodEnd)) {
    throw new Error('promotion metric periodStart must not be after periodEnd');
  }
  const sourceId = typeof source.sourceId === 'string' ? source.sourceId.trim() : '';
  const currency = typeof source.currency === 'string' ? source.currency.trim().toUpperCase() : '';
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    throw new Error('promotion metric currency must be an ISO 4217 code');
  }
  const evidenceIds = Array.isArray(source.evidenceIds)
    ? Array.from(
        new Set(
          source.evidenceIds
            .filter((item): item is string => typeof item === 'string')
            .map(item => item.trim())
            .filter(Boolean),
        ),
      )
    : [];
  if (source.evidenceIds !== undefined && !Array.isArray(source.evidenceIds)) {
    throw new Error('promotion metric evidenceIds must be an array');
  }
  return {
    channel: readMetricText(source.channel, 'channel'),
    accountName: readMetricText(source.accountName, 'accountName'),
    capturedAt: normalizeMetricTimestamp(source.capturedAt, 'capturedAt', true)!,
    impressions: normalizeMetricNumber(source.impressions, 'impressions'),
    clicks: normalizeMetricNumber(source.clicks, 'clicks'),
    interactions: normalizeMetricNumber(source.interactions, 'interactions'),
    leads: normalizeMetricNumber(source.leads, 'leads'),
    cost: normalizeMetricNumber(source.cost, 'cost'),
    ...(sourceId ? { sourceId } : {}),
    ...(periodStart ? { periodStart } : {}),
    ...(periodEnd ? { periodEnd } : {}),
    ...(currency ? { currency } : {}),
    ...(evidenceIds.length > 0 ? { evidenceIds } : {}),
  };
};

const normalizePromotionMonitoringWindow = (
  value: unknown,
): { window: PromotionMonitoringWindow | null; reasons: PromotionMonitoringReason[] } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { window: null, reasons: [PromotionMonitoringReason.MetricPeriod] };
  }
  const source = value as Record<string, unknown>;
  const start = typeof source.start === 'string' ? source.start.trim() : '';
  const end = typeof source.end === 'string' ? source.end.trim() : '';
  if (!start || !end) {
    return { window: { start, end }, reasons: [PromotionMonitoringReason.MetricPeriod] };
  }
  try {
    const normalizedStart = normalizeMetricTimestamp(start, 'window.start', true)!;
    const normalizedEnd = normalizeMetricTimestamp(end, 'window.end', true)!;
    if (Date.parse(normalizedStart) > Date.parse(normalizedEnd)) {
      return { window: null, reasons: [PromotionMonitoringReason.MetricPeriod] };
    }
    return { window: { start: normalizedStart, end: normalizedEnd }, reasons: [] };
  } catch {
    return { window: null, reasons: [PromotionMonitoringReason.MetricPeriod] };
  }
};

export const normalizePromotionMonitoringScheduleContext = (
  value: unknown,
): PromotionMonitoringScheduleValidation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { context: null, reasons: [PromotionMonitoringReason.MetricSnapshot] };
  }
  const source = value as Record<string, unknown>;
  const reasons: PromotionMonitoringReason[] = [];
  const readContextId = (
    key: 'workspaceId' | 'runId' | 'agentId' | 'idempotencyKey',
    reason: PromotionMonitoringReason,
  ): string => {
    const text = typeof source[key] === 'string' ? source[key].trim() : '';
    if (!text) reasons.push(reason);
    return text;
  };
  const workspaceId = readContextId('workspaceId', PromotionMonitoringReason.Workspace);
  const runId = readContextId('runId', PromotionMonitoringReason.Run);
  const agentId = readContextId('agentId', PromotionMonitoringReason.MonitoringAgent);
  const idempotencyKey = readContextId('idempotencyKey', PromotionMonitoringReason.IdempotencyKey);
  let metricSource: PromotionMetricSnapshot | null = null;
  try {
    metricSource = normalizePromotionMetricSnapshot(source.metricSource);
  } catch (error) {
    reasons.push(
      error instanceof Error && error.message.includes('period')
        ? PromotionMonitoringReason.MetricPeriod
        : PromotionMonitoringReason.MetricSnapshot,
    );
  }
  const normalizedWindow = normalizePromotionMonitoringWindow(source.window);
  reasons.push(...normalizedWindow.reasons);
  if (!metricSource || !normalizedWindow.window) {
    return { context: null, reasons: Array.from(new Set(reasons)) };
  }
  return {
    context: {
      workspaceId,
      runId,
      agentId,
      metricSource,
      idempotencyKey,
      window: normalizedWindow.window,
    },
    reasons: Array.from(new Set(reasons)),
  };
};

export const getPromotionMonitoringMissingInfo = (
  snapshot: PromotionMetricSnapshot,
  window: PromotionMonitoringWindow,
): PromotionMonitoringReason[] => {
  const missing: PromotionMonitoringReason[] = [];
  if (!knownPromotionMetricPlatforms.has(snapshot.channel.trim().toLowerCase())) {
    missing.push(PromotionMonitoringReason.MetricPlatform);
  }
  if (!snapshot.sourceId) missing.push(PromotionMonitoringReason.MetricSource);
  if (!snapshot.periodStart || !snapshot.periodEnd) missing.push(PromotionMonitoringReason.MetricPeriod);
  missing.push(...normalizePromotionMonitoringWindow(window).reasons);
  return Array.from(new Set(missing));
};

export const getPromotionWorkflowArtifactKind = (
  role: EnterpriseLeadTaskAgentRole,
): string => {
  if (role === EnterpriseLeadAgentRole.PromotionAccountMonitoring) {
    return PromotionArtifactKind.MetricReport;
  }
  if (role === EnterpriseLeadAgentRole.PromotionPerformanceReview) {
    return PromotionArtifactKind.PerformanceReview;
  }
  return `${role}_output`;
};

export interface PromotionAssetPackage {
  platform: string;
  title: string;
  body: string;
  tags: string[];
  callToAction: string;
  manualReviewRequired: boolean;
}

export const PromotionConfidence = {
  High: 'high',
  Medium: 'medium',
  Low: 'low',
} as const;
export type PromotionConfidence =
  (typeof PromotionConfidence)[keyof typeof PromotionConfidence];

export const PromotionLeadTier = {
  High: 'high',
  Medium: 'medium',
  Low: 'low',
} as const;
export type PromotionLeadTier = (typeof PromotionLeadTier)[keyof typeof PromotionLeadTier];

export interface PromotionCleanedRecord {
  id: string;
  companyName: string;
  industry: string;
  contactHint: string;
  fieldConfidence: Record<string, PromotionConfidence>;
}

export interface PromotionScoredLead {
  id: string;
  score: number;
  tier: PromotionLeadTier;
  reasons: string[];
  missingFields: string[];
  nextAction: string;
}

export interface PromotionContentQualityOutput {
  riskLevel: 'low' | 'medium' | 'high';
  blockingIssues: string[];
  warnings: string[];
  requiredRevisions: string[];
  canArchive: boolean;
}

export interface PromotionMonitoringOutput {
  metrics: Array<Record<string, unknown>>;
  anomalies: Array<Record<string, unknown>>;
  hypotheses: string[];
  adjustmentActions: string[];
}
import { EnterpriseLeadAgentRole } from './constants';
import type { EnterpriseLeadTaskAgentRole } from './types';
