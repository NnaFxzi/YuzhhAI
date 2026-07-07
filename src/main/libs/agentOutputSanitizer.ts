const MEMORY_CONTEXT_LIMITATION_NOTE =
  '部分历史记忆暂未读取，本次已基于已命中的行业包和资料分析；相关缺口已标为“待验证”。';

const CAUTIOUS_EVIDENCE_FRAMING_NOTE =
  '我先基于已命中的行业包、知识库资料和搜索结果做分析；未能交叉验证的数据会标为“待验证”。';

const EXTERNAL_RESEARCH_LIMITATION_NOTE =
  '部分外部检索能力暂未接入；涉及市场规模、增速、竞争份额等关键数据，建议通过行业协会、海关数据、客户访谈或付费报告交叉验证。';

const INTERNAL_MEMORY_DIAGNOSTIC_PATTERNS = [
  /\bopenclaw\s+memory\s+index\s+--force\b/i,
  /\bmemory\s+index\s+--force\b/i,
  /记忆索引.*(?:不可用|失败|错误|不匹配|重建)/i,
  /(?:embedding|向量|索引).*(?:不匹配|错误|失败|不可用|重建)/i,
  /(?:不匹配|错误|失败|不可用).*(?:embedding|向量|索引)/i,
  /openclaw[\\/](?:state|logs|runtime).*(?:memory|MEMORY|USER|workspace|记忆|知识库)/i,
  /\bworkspace-main\b.*(?:MEMORY\.md|USER\.md|记忆|知识库)/i,
] as const;

const OVERCONFIDENT_EVIDENCE_READY_PATTERNS = [
  /数据[已己]齐全/,
  /数据够了/,
  /资料[已己]?齐全/,
  /资料很完整/,
  /数据[已己]足够/,
  /资料[已己]足够/,
  /(?:我)?(?:已经|已|现已)?收集(?:了)?足够(?:的)?数据/,
  /(?:我)?(?:已经|已|现已)?收集(?:了)?足够(?:的)?资料/,
] as const;

const INTERNAL_EXTERNAL_RESEARCH_DIAGNOSTIC_PATTERNS = [
  /外研\s*API.*(?:未配置|未接入|未启用)/i,
  /外部研究\s*API.*(?:未配置|未接入|未启用)/i,
  /(?:Tavily|Firecrawl).*未配置/i,
  /(?:agent\s*设置|docs\.openclaw\.ai|配置外研\s*API|外部研究 API)/i,
] as const;

const stripMarkdownLinePrefix = (line: string): string =>
  line
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*[-*]\s+/, '')
    .trim();

const isInternalMemoryDiagnosticLine = (line: string): boolean => {
  const normalized = stripMarkdownLinePrefix(line);
  if (!normalized) return false;
  return INTERNAL_MEMORY_DIAGNOSTIC_PATTERNS.some(pattern => pattern.test(normalized));
};

const isOverconfidentEvidenceReadyLine = (line: string): boolean => {
  const normalized = stripMarkdownLinePrefix(line);
  if (!normalized) return false;
  return OVERCONFIDENT_EVIDENCE_READY_PATTERNS.some(pattern => pattern.test(normalized));
};

const isInternalExternalResearchDiagnosticLine = (line: string): boolean => {
  const normalized = stripMarkdownLinePrefix(line);
  if (!normalized) return false;
  return INTERNAL_EXTERNAL_RESEARCH_DIAGNOSTIC_PATTERNS.some(pattern => pattern.test(normalized));
};

export function sanitizeAgentVisibleOutput(content: string): string {
  if (!content) return content;

  const lines = content.split(/\r?\n/);
  const sanitizedLines: string[] = [];
  let insertedLimitationNote = content.includes(MEMORY_CONTEXT_LIMITATION_NOTE);
  let insertedCautiousEvidenceNote = content.includes(CAUTIOUS_EVIDENCE_FRAMING_NOTE);
  let insertedExternalResearchNote = content.includes(EXTERNAL_RESEARCH_LIMITATION_NOTE);
  let removedDiagnostic = false;
  let replacedOverconfidentEvidenceReady = false;
  let replacedExternalResearchDiagnostic = false;

  for (const line of lines) {
    if (isOverconfidentEvidenceReadyLine(line)) {
      replacedOverconfidentEvidenceReady = true;
      if (!insertedCautiousEvidenceNote) {
        sanitizedLines.push(CAUTIOUS_EVIDENCE_FRAMING_NOTE);
        insertedCautiousEvidenceNote = true;
      }
      continue;
    }
    if (isInternalExternalResearchDiagnosticLine(line)) {
      replacedExternalResearchDiagnostic = true;
      if (!insertedExternalResearchNote) {
        sanitizedLines.push(`> 注：${EXTERNAL_RESEARCH_LIMITATION_NOTE}`);
        insertedExternalResearchNote = true;
      }
      continue;
    }
    if (isInternalMemoryDiagnosticLine(line)) {
      removedDiagnostic = true;
      if (!insertedLimitationNote) {
        sanitizedLines.push(`> 注：${MEMORY_CONTEXT_LIMITATION_NOTE}`);
        insertedLimitationNote = true;
      }
      continue;
    }
    sanitizedLines.push(line);
  }

  if (
    !removedDiagnostic &&
    !replacedOverconfidentEvidenceReady &&
    !replacedExternalResearchDiagnostic
  ) {
    return content;
  }

  return sanitizedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
