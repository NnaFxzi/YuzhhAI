import { describe, expect, test } from 'vitest';

import {
  AiDialogueReplyLanguage,
  AiDialogueReplySurface,
  buildAiDialogueReplyContract,
} from './aiDialogueReplyContract';

describe('buildAiDialogueReplyContract', () => {
  test('builds a Cowork contract that favors direct execution and evidence clarity', () => {
    const contract = buildAiDialogueReplyContract({
      surface: AiDialogueReplySurface.Cowork,
      language: AiDialogueReplyLanguage.Auto,
    });

    expect(contract).toContain('[LobsterAI reply contract]');
    expect(contract).toContain('Answer in the same language as the latest user request');
    expect(contract).toContain('When there is enough context, proceed');
    expect(contract).toContain('Ask only 1-3 concise questions');
    expect(contract).toContain('Separate facts, evidence, assumptions, and recommendations');
    expect(contract).toContain('For content generation requests');
    expect(contract).toContain('draft a usable first version');
    expect(contract).toContain(
      'If the content knowledge retrieval preflight says no sufficiently relevant knowledge was found',
    );
    expect(contract).toContain('do not draft or make assumptions');
    expect(contract).toContain('Do not use blocking choice, confirmation, or user-input dialogs');
    expect(contract).toContain(
      'search or reuse available knowledge, memory, profile, and prior positioning context',
    );
    expect(contract).toContain(
      'For coding work, mention changed files, verification run, and remaining risk',
    );
    expect(contract).not.toContain('不得编造客户');
  });

  test('builds an Enterprise Lead contract with Chinese and lead-safety constraints', () => {
    const contract = buildAiDialogueReplyContract({
      surface: AiDialogueReplySurface.EnterpriseLead,
      language: AiDialogueReplyLanguage.Zh,
    });

    expect(contract).toContain('[LobsterAI reply contract]');
    expect(contract).toContain('用中文自然回答');
    expect(contract).toContain(
      '不得编造客户、联系人、认证、价格、交付、产能、案例或成本降低等事实',
    );
    expect(contract).toContain('外部动作只能生成草稿或审批建议');
    expect(contract).toContain('明确区分工作空间已有资料、研究结果、建议和推测');
  });
});
