import type { IndustryPackId } from './constants';
import type { ValidationResult } from './types';

export const PositioningResearchLane = {
  Search: 'search',
  Competitor1688: '1688_competitor',
  ContentPlatform: 'content_platform',
} as const;
export type PositioningResearchLane =
  typeof PositioningResearchLane[keyof typeof PositioningResearchLane];

export const PositioningConfidence = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
} as const;
export type PositioningConfidence =
  typeof PositioningConfidence[keyof typeof PositioningConfidence];

export const PositioningScoreFactor = {
  MarketDemand: 'market_demand',
  CompetitiveOpportunity: 'competitive_opportunity',
  FactoryFit: 'factory_fit',
  DealFeasibility: 'deal_feasibility',
  ContentExpansion: 'content_expansion',
} as const;
export type PositioningScoreFactor =
  typeof PositioningScoreFactor[keyof typeof PositioningScoreFactor];

export const PositioningRequester = {
  Agent: 'agent',
  Renderer: 'renderer',
} as const;
export type PositioningRequester =
  typeof PositioningRequester[keyof typeof PositioningRequester];

export interface PositioningLaneSummary {
  lane: PositioningResearchLane;
  confidence: PositioningConfidence;
  summary: string;
  keywords: string[];
  painPoints: string[];
  competitorSignals: string[];
  opportunitySignals: string[];
  researchedAt?: string;
}

export interface PositioningSourceSummary {
  lanes: PositioningLaneSummary[];
}

export interface PositioningFactorScore {
  score: number;
  reason: string;
}

export type PositioningFactorScores = Partial<Record<PositioningScoreFactor, PositioningFactorScore>>;

export interface PositioningCandidateInput {
  id: string;
  name: string;
  summary: string;
  scores: PositioningFactorScores;
  keywords: string[];
  painPoints: string[];
  competitorSignals: string[];
  opportunitySignals: string[];
  recommendedChannels: string[];
  missingFacts: string[];
}

export interface PositioningCandidateReport extends PositioningCandidateInput {
  totalScore: number;
  confidence: PositioningConfidence;
}

export interface PositioningReportInput {
  packId: IndustryPackId | string;
  agentId?: string;
  requestedBy: PositioningRequester | string;
  recommendedDirectionId: string;
  providerAvailability?: {
    tavily: boolean;
    firecrawl: boolean;
  };
  sourceCounts?: {
    searchResults: number;
    extractedPages: number;
  };
  sourceSummary: PositioningSourceSummary;
  candidates: PositioningCandidateInput[];
  backupDirectionIds: string[];
  nextActions: string[];
}

export interface PositioningReport extends Omit<PositioningReportInput, 'candidates'> {
  id: string;
  candidates: PositioningCandidateReport[];
  createdAt: string;
  updatedAt: string;
}

const SCORE_FACTORS: PositioningScoreFactor[] = [
  PositioningScoreFactor.MarketDemand,
  PositioningScoreFactor.CompetitiveOpportunity,
  PositioningScoreFactor.FactoryFit,
  PositioningScoreFactor.DealFeasibility,
  PositioningScoreFactor.ContentExpansion,
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const cleanText = (value: string): string => value.trim();

const cleanTextList = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.filter(hasText).map(item => item.trim()).filter(Boolean)))
    : [];

const readNonNegativeInteger = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;

const readConfidence = (value: unknown): PositioningConfidence => {
  if (
    value === PositioningConfidence.Low ||
    value === PositioningConfidence.Medium ||
    value === PositioningConfidence.High
  ) {
    return value;
  }
  return PositioningConfidence.Medium;
};

const inferConfidence = (scores: PositioningFactorScores): PositioningConfidence => {
  const scoreCount = SCORE_FACTORS.filter(factor => scores[factor]).length;
  if (scoreCount >= 5) return PositioningConfidence.High;
  if (scoreCount >= 3) return PositioningConfidence.Medium;
  return PositioningConfidence.Low;
};

export function validatePositioningReportInput(value: unknown): ValidationResult {
  const errors: string[] = [];
  const input = value as Partial<PositioningReportInput> | null;

  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['positioning report input must be an object'] };
  }
  if (!hasText(input.packId)) errors.push('packId is required');
  if (!hasText(input.requestedBy)) errors.push('requestedBy is required');
  if (!hasText(input.recommendedDirectionId)) errors.push('recommendedDirectionId is required');
  if (!isRecord(input.sourceSummary) || !Array.isArray(input.sourceSummary.lanes)) {
    errors.push('sourceSummary.lanes must be an array');
  }
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    errors.push('candidates must include at least one candidate');
  }

  const candidateIds = new Set<string>();
  if (Array.isArray(input.candidates)) {
    input.candidates.forEach((candidate, index) => {
      if (!candidate || typeof candidate !== 'object') {
        errors.push(`candidate ${index} must be an object`);
        return;
      }
      if (!hasText(candidate.id)) {
        errors.push(`candidate ${index} id is required`);
      } else {
        candidateIds.add(candidate.id.trim());
      }
      if (!hasText(candidate.name)) errors.push(`candidate ${index} name is required`);
      if (!hasText(candidate.summary)) errors.push(`candidate ${index} summary is required`);

      const scores = isRecord(candidate.scores) ? candidate.scores : {};
      for (const factor of Object.values(PositioningScoreFactor)) {
        const score = scores[factor];
        if (score === undefined) continue;
        if (!isRecord(score)) {
          errors.push(`candidate ${candidate.id || index} score ${factor} must be an object`);
          continue;
        }
        if (typeof score.score !== 'number' || score.score < 1 || score.score > 5) {
          errors.push(`candidate ${candidate.id || index} score ${factor} must be between 1 and 5`);
        }
        if (!hasText(score.reason)) {
          errors.push(`candidate ${candidate.id || index} score ${factor} reason is required`);
        }
      }
    });
  }

  if (hasText(input.recommendedDirectionId) && !candidateIds.has(input.recommendedDirectionId.trim())) {
    errors.push('recommendedDirectionId must match a candidate id');
  }

  return { ok: errors.length === 0, errors };
}

export function normalizePositioningReportInput(
  input: PositioningReportInput,
): Omit<PositioningReport, 'id' | 'createdAt' | 'updatedAt'> {
  const validation = validatePositioningReportInput(input);
  if (!validation.ok) {
    throw new Error(`Invalid positioning report input: ${validation.errors.join('; ')}`);
  }

  const candidates = input.candidates.map(candidate => {
    const totalScore = SCORE_FACTORS.reduce((sum, factor) => {
      const score = candidate.scores[factor]?.score;
      return sum + (typeof score === 'number' ? score : 0);
    }, 0);

    return {
      ...candidate,
      id: cleanText(candidate.id),
      name: cleanText(candidate.name),
      summary: cleanText(candidate.summary),
      keywords: cleanTextList(candidate.keywords),
      painPoints: cleanTextList(candidate.painPoints),
      competitorSignals: cleanTextList(candidate.competitorSignals),
      opportunitySignals: cleanTextList(candidate.opportunitySignals),
      recommendedChannels: cleanTextList(candidate.recommendedChannels),
      missingFacts: cleanTextList(candidate.missingFacts),
      totalScore,
      confidence: inferConfidence(candidate.scores),
    };
  });

  return {
    packId: cleanText(String(input.packId)),
    agentId: hasText(input.agentId) ? cleanText(input.agentId) : 'main',
    requestedBy: cleanText(String(input.requestedBy)),
    recommendedDirectionId: cleanText(input.recommendedDirectionId),
    providerAvailability: {
      tavily: input.providerAvailability?.tavily === true,
      firecrawl: input.providerAvailability?.firecrawl === true,
    },
    sourceCounts: {
      searchResults: readNonNegativeInteger(input.sourceCounts?.searchResults),
      extractedPages: readNonNegativeInteger(input.sourceCounts?.extractedPages),
    },
    sourceSummary: {
      lanes: input.sourceSummary.lanes.map(lane => ({
        lane: lane.lane,
        confidence: readConfidence(lane.confidence),
        summary: cleanText(lane.summary || ''),
        keywords: cleanTextList(lane.keywords),
        painPoints: cleanTextList(lane.painPoints),
        competitorSignals: cleanTextList(lane.competitorSignals),
        opportunitySignals: cleanTextList(lane.opportunitySignals),
        researchedAt: hasText(lane.researchedAt) ? lane.researchedAt.trim() : undefined,
      })),
    },
    candidates,
    backupDirectionIds: cleanTextList(input.backupDirectionIds),
    nextActions: cleanTextList(input.nextActions),
  };
}
