import { describe, expect, test } from 'vitest';

import { AgentAnswerShape, defaultAgentResponseContract } from '../../shared/agent';
import { buildAgentWorkspaceSystemPrompt } from './openclawAgentWorkspacePrompt';

describe('buildAgentWorkspaceSystemPrompt', () => {
  test('appends a non-default response contract to the agent system prompt', () => {
    const prompt = buildAgentWorkspaceSystemPrompt({
      systemPrompt: '你是营销文案助手。',
      responseContract: {
        ...defaultAgentResponseContract,
        answerShape: AgentAnswerShape.CopyReady,
        mustInclude: ['输出可直接复制的正文'],
        mustAvoid: ['不要编造硬事实'],
      },
    });

    expect(prompt).toContain('你是营销文案助手。');
    expect(prompt).toContain('[Knowledge evidence usage contract]');
    expect(prompt).toContain('[Agent response contract]');
    expect(prompt).toContain('Answer shape: copy_ready');
    expect(prompt).toContain('输出可直接复制的正文');
    expect(prompt.indexOf('你是营销文案助手。')).toBeLessThan(
      prompt.indexOf('[Knowledge evidence usage contract]'),
    );
    expect(prompt.indexOf('[Knowledge evidence usage contract]')).toBeLessThan(
      prompt.indexOf('[Agent response contract]'),
    );
  });

  test('keeps the default response contract out of the workspace prompt', () => {
    const prompt = buildAgentWorkspaceSystemPrompt({
      systemPrompt: '普通助手。',
      responseContract: defaultAgentResponseContract,
    });

    expect(prompt).toContain('普通助手。');
    expect(prompt).toContain('[Knowledge evidence usage contract]');
    expect(prompt).not.toContain('[Agent response contract]');
  });

  test('instructs agents to answer from matched knowledge before asking for industry details', () => {
    const prompt = buildAgentWorkspaceSystemPrompt({
      systemPrompt: '你是行业分析助手。',
      responseContract: defaultAgentResponseContract,
    });

    expect(prompt).toContain('memory_search');
    expect(prompt).toContain('lobsterai_industry_positioning_get_latest');
    expect(prompt).toContain('不要追问用户具体行业');
    expect(prompt).toContain('待验证');
  });
});
