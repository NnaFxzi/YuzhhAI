import { IndustryPackId } from '../../shared/industryPack/constants';
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

export interface PositioningLatestToolPayload {
  status: 'saved_report' | 'baseline' | 'empty';
  packId: string;
  agentId?: string;
  industryLabel?: string;
  message: string;
  baselineEvidence: string[];
  answerGuidance: string;
  report?: PositioningReport;
}

const HEAVY_PACKAGING_BASELINE_EVIDENCE = [
  '行业包：重型包装获客内容包，用于重型纸箱、蜂窝纸箱、纸托盘、纸护角等工业包装企业的国内推广内容生成。',
  '核心产品：重型瓦楞纸箱、蜂窝纸箱、纸护角、纸托盘、替代木箱包装。',
  '典型客户与场景：机械配件、电机设备、汽车零部件、五金模具、出口设备、重型零部件、项目制发货、整车运输。',
  '常见机会：替代木箱、免熏蒸、降低木材和仓储成本、防破损运输、包装降本、定制包装方案、批量稳定供应。',
  '采购关注点：抗压缓冲、防潮、交付周期、定制能力、总成本、装卸与长途运输风险。',
];

const POSITIONING_TOOL_ANSWER_GUIDANCE = [
  '如果用户询问当前行业形势、行业分析、市场趋势、产品定位或主推方向，且 packId 已识别为 heavy-packaging，请先按重包装/工业包装行业回答。',
  '不要追问用户具体行业；可以用一句话说明“我先按重包装/工业包装行业分析”。',
  '没有保存的定位报告只代表没有历史结论，不代表没有行业背景；请基于 baselineEvidence 先给分析。',
  '缺少实时市场规模、真实竞品数据或本厂案例时，把相关判断标记为“待验证”。',
].join('\n');

export class PositioningService {
  constructor(private readonly options: PositioningServiceOptions) {}

  saveReport(input: PositioningReportInput): PositioningReport {
    return this.options.store.createPositioningReport(input);
  }

  getLatestReport(packId: string, agentId?: string): PositioningReport | null {
    return this.options.store.getLatestPositioningReport(packId, agentId);
  }

  buildLatestToolPayload(packId: string, agentId?: string): PositioningLatestToolPayload {
    const report = this.getLatestReport(packId, agentId);
    if (report) {
      return {
        status: 'saved_report',
        packId,
        ...(agentId?.trim() ? { agentId: agentId.trim() } : {}),
        message: 'Saved positioning report found.',
        baselineEvidence: [],
        answerGuidance: POSITIONING_TOOL_ANSWER_GUIDANCE,
        report,
      };
    }

    if (packId === IndustryPackId.HeavyPackaging) {
      return {
        status: 'baseline',
        packId,
        ...(agentId?.trim() ? { agentId: agentId.trim() } : {}),
        industryLabel: '重包装/工业包装',
        message:
          'No saved positioning report found. Use the built-in heavy-packaging industry baseline as evidence before asking follow-up questions.',
        baselineEvidence: HEAVY_PACKAGING_BASELINE_EVIDENCE,
        answerGuidance: POSITIONING_TOOL_ANSWER_GUIDANCE,
      };
    }

    return {
      status: 'empty',
      packId: packId || 'unknown pack',
      ...(agentId?.trim() ? { agentId: agentId.trim() } : {}),
      message: `No positioning report saved for ${packId || 'unknown pack'}.`,
      baselineEvidence: [],
      answerGuidance:
        'No industry baseline is available for this packId. Ask the user to confirm the industry before analyzing.',
    };
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
