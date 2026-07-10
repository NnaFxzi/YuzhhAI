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
