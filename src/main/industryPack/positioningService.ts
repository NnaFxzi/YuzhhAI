import type {
  PositioningCandidateReport,
  PositioningReport,
  PositioningReportInput,
} from '../../shared/industryPack/positioning';
import type { IndustryPackStore } from './industryPackStore';

interface PositioningServiceOptions {
  store: Pick<IndustryPackStore, 'createPositioningReport' | 'getLatestPositioningReport'>;
}

const findRecommendedCandidate = (report: PositioningReport): PositioningCandidateReport | undefined =>
  report.candidates.find(candidate => candidate.id === report.recommendedDirectionId);

export class PositioningService {
  constructor(private readonly options: PositioningServiceOptions) {}

  saveReport(input: PositioningReportInput): PositioningReport {
    return this.options.store.createPositioningReport(input);
  }

  getLatestReport(packId: string, agentId?: string): PositioningReport | null {
    return this.options.store.getLatestPositioningReport(packId, agentId);
  }

  buildLatestPromptContext(packId: string, agentId?: string): string {
    const report = this.getLatestReport(packId, agentId);
    if (!report) return '';

    const recommended = findRecommendedCandidate(report);
    if (!recommended) return '';

    const lines = [
      '## 已保存的产品定位分析',
      `推荐主推方向：${recommended.name}`,
      `定位摘要：${recommended.summary}`,
    ];

    if (recommended.keywords.length > 0) {
      lines.push(`关键词：${recommended.keywords.join('、')}`);
    }
    if (recommended.painPoints.length > 0) {
      lines.push(`客户痛点：${recommended.painPoints.join('、')}`);
    }
    if (recommended.opportunitySignals.length > 0) {
      lines.push(`机会点：${recommended.opportunitySignals.join('、')}`);
    }
    if (recommended.recommendedChannels.length > 0) {
      lines.push(`优先渠道：${recommended.recommendedChannels.join('、')}`);
    }
    if (recommended.missingFacts.length > 0) {
      lines.push(`后续可补资料：${recommended.missingFacts.join('、')}`);
    }

    return lines.join('\n');
  }
}
