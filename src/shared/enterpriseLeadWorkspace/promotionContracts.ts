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
}

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
