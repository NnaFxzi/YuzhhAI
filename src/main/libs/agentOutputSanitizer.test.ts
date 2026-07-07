import { describe, expect, test } from 'vitest';

import { sanitizeAgentVisibleOutput } from './agentOutputSanitizer';

describe('sanitizeAgentVisibleOutput', () => {
  test('replaces overconfident data-ready opening with cautious evidence framing', () => {
    const output = sanitizeAgentVisibleOutput(
      [
        '数据已齐全，现在基于搜索结果和行业基线为你输出完整分析。',
        '',
        '## 2026年重包装/工业包装行业形势分析',
        '',
        '下一步：深耕出口客户。',
      ].join('\n'),
    );

    expect(output).toContain('我先基于已命中的行业包、知识库资料和搜索结果做分析');
    expect(output).toContain('未能交叉验证的数据会标为“待验证”');
    expect(output).toContain('## 2026年重包装/工业包装行业形势分析');
    expect(output).toContain('下一步：深耕出口客户。');
    expect(output).not.toContain('数据已齐全');
  });

  test('replaces enough-data opening with cautious evidence framing', () => {
    const output = sanitizeAgentVisibleOutput(
      [
        '我已经收集了足够的数据，现在为你整理分析报告。',
        '',
        '# 重型包装/工业包装行业形势分析（2026年7月）',
      ].join('\n'),
    );

    expect(output).toContain('我先基于已命中的行业包、知识库资料和搜索结果做分析');
    expect(output).toContain('未能交叉验证的数据会标为“待验证”');
    expect(output).toContain('# 重型包装/工业包装行业形势分析（2026年7月）');
    expect(output).not.toContain('我已经收集了足够的数据');
  });

  test('replaces data-is-enough opening with cautious evidence framing', () => {
    const output = sanitizeAgentVisibleOutput(
      [
        '数据已足够，以下是基于行业包+搜索结果的综合分析。',
        '',
        '## 重包装/工业包装行业形势分析（2025-2026）',
      ].join('\n'),
    );

    expect(output).toContain('我先基于已命中的行业包、知识库资料和搜索结果做分析');
    expect(output).toContain('未能交叉验证的数据会标为“待验证”');
    expect(output).toContain('## 重包装/工业包装行业形势分析（2025-2026）');
    expect(output).not.toContain('数据已足够');
  });

  test('replaces internal external-research configuration diagnostics with user-facing limitation', () => {
    const output = sanitizeAgentVisibleOutput(
      [
        '6. **补数据**：外研 API 未配置，前述含「待验证」标注的数据建议通过付费报告或行业展会进一步确证。',
        '',
        '**提醒**：当前外部研究 API（Tavily/Firecrawl）未配置，本次搜索通过浏览器完成，部分数据无法多源交叉验证。如需更精准的市场数据，建议在 agent 设置中[配置外研 API](https://docs.openclaw.ai)。',
      ].join('\n'),
    );

    expect(output).toContain('部分外部检索能力暂未接入');
    expect(output).toContain('建议通过行业协会、海关数据、客户访谈或付费报告交叉验证');
    expect(output).not.toContain('外研 API');
    expect(output).not.toContain('Tavily');
    expect(output).not.toContain('Firecrawl');
    expect(output).not.toContain('agent 设置');
    expect(output).not.toContain('docs.openclaw.ai');
  });

  test('leaves normal business output unchanged', () => {
    const output = [
      '我先按重包装/工业包装行业分析。',
      '',
      '一句话判断：行业处于结构性上升通道。',
    ].join('\n');

    expect(sanitizeAgentVisibleOutput(output)).toBe(output);
  });
});
