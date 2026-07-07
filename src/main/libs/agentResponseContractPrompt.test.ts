import { describe, expect, test } from 'vitest';

import { AgentAnswerShape, defaultAgentResponseContract } from '../../shared/agent';
import { buildAgentResponseContractRuntimePrompt } from './agentResponseContractPrompt';

describe('buildAgentResponseContractRuntimePrompt', () => {
  test('returns empty text for the default direct contract with no rules', () => {
    expect(buildAgentResponseContractRuntimePrompt(undefined)).toBe('');
    expect(buildAgentResponseContractRuntimePrompt(defaultAgentResponseContract)).toBe('');
  });

  test('renders non-default contract guidance', () => {
    const prompt = buildAgentResponseContractRuntimePrompt({
      ...defaultAgentResponseContract,
      answerShape: AgentAnswerShape.CopyReady,
      mustInclude: ['输出可直接复制的正文'],
      mustAvoid: ['不要编造硬事实'],
      qualityChecks: ['事实保护检查'],
      toolUseHints: ['需要最新信息时先调研'],
    });

    expect(prompt).toContain('[Agent response contract]');
    expect(prompt).toContain('copy_ready');
    expect(prompt).toContain('输出可直接复制的正文');
    expect(prompt).toContain('不要编造硬事实');
    expect(prompt).toContain('需要最新信息时先调研');
  });
});
