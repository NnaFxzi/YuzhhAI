import { describe, expect, test } from 'vitest';

import {
  AgentAnswerShape,
  defaultAgentResponseContract,
  normalizeAgentResponseContract,
  renderAgentResponseContractPrompt,
} from './responseContract';

describe('agent response contract', () => {
  test('normalizes missing values to safe defaults', () => {
    expect(normalizeAgentResponseContract(null)).toEqual(defaultAgentResponseContract);
  });

  test('clamps clarification questions to a small range', () => {
    const contract = normalizeAgentResponseContract({
      version: 1,
      answerShape: AgentAnswerShape.CopyReady,
      maxClarifyingQuestions: 99,
      askBeforeAnswering: true,
      mustInclude: ['可直接复制的正文'],
      mustAvoid: ['编造硬事实'],
      qualityChecks: ['先做事实保护检查'],
      toolUseHints: ['需要最新信息时先调研'],
    });

    expect(contract.maxClarifyingQuestions).toBe(3);
  });

  test('drops invalid list entries while preserving ordered text rules', () => {
    const contract = normalizeAgentResponseContract({
      version: 1,
      answerShape: 'not-real',
      mustInclude: ['  先确认理解  ', '', 42, '可直接复制'],
      mustAvoid: [false, '不要编造数据'],
    });

    expect(contract.answerShape).toBe(defaultAgentResponseContract.answerShape);
    expect(contract.mustInclude).toEqual(['先确认理解', '可直接复制']);
    expect(contract.mustAvoid).toEqual(['不要编造数据']);
  });

  test('renders compact runtime guidance', () => {
    const prompt = renderAgentResponseContractPrompt({
      ...defaultAgentResponseContract,
      answerShape: AgentAnswerShape.ConfirmThenAnswer,
      mustInclude: ['先用一句话确认理解'],
      mustAvoid: ['不要编造数据'],
    });

    expect(prompt).toContain('[Agent response contract]');
    expect(prompt).toContain('confirm_then_answer');
    expect(prompt).toContain('先用一句话确认理解');
    expect(prompt).toContain('不要编造数据');
  });
});
