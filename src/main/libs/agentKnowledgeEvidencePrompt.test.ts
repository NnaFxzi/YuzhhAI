import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'vitest';

import {
  buildAgentKnowledgeEvidencePrompt,
  buildAgentKnowledgeEvidencePromptForRequest,
  buildAgentKnowledgeFileContextPrompt,
  isKnowledgeEvidenceRequest,
} from './agentKnowledgeEvidencePrompt';

describe('buildAgentKnowledgeEvidencePrompt', () => {
  test('requires sourced numbers and hides internal diagnostics in industry answers', () => {
    const prompt = buildAgentKnowledgeEvidencePrompt();

    expect(prompt).toContain('具体数字');
    expect(prompt).toContain('市场规模');
    expect(prompt).toContain('来源');
    expect(prompt).toContain('时间');
    expect(prompt).toContain('置信度');
    expect(prompt).toContain('没有来源');
    expect(prompt).toContain('待验证');
    expect(prompt).toContain('不要暴露');
    expect(prompt).toContain('embedding');
    expect(prompt).toContain('openclaw memory index --force');
    expect(prompt).toContain('我先按');
    expect(prompt).toContain('可执行动作清单');
    expect(prompt).toContain('外部研究 API');
    expect(prompt).toContain('Tavily');
    expect(prompt).toContain('Firecrawl');
    expect(prompt).toContain('agent 设置');
    expect(prompt).toContain('docs.openclaw.ai');
    expect(prompt).toContain('不要在最终回答中提及“历史记忆”“索引”“检索暂不可用”');
    expect(prompt).not.toContain('统一转译为“部分历史记忆');
  });

  test('requires source quality tiers and forbids overconfident data-ready wording', () => {
    const prompt = buildAgentKnowledgeEvidencePrompt();

    expect(prompt).toContain('证据质量分级');
    expect(prompt).toContain('A 类');
    expect(prompt).toContain('官方统计');
    expect(prompt).toContain('B 类');
    expect(prompt).toContain('券商');
    expect(prompt).toContain('C 类');
    expect(prompt).toContain('百度文库');
    expect(prompt).toContain('博客');
    expect(prompt).toContain('不能支撑核心结论');
    expect(prompt).toContain('资料依据表');
    expect(prompt).toContain('证据编号');
    expect(prompt).toContain('不要说“数据已齐全”');
  });

  test('defines hard mapping from evidence tier to confidence and supported conclusion types', () => {
    const prompt = buildAgentKnowledgeEvidencePrompt();

    expect(prompt).toContain('证据硬规则');
    expect(prompt).toContain('A 类 → 高置信');
    expect(prompt).toContain('B 类 → 中置信');
    expect(prompt).toContain('C 类 → 低置信/待验证');
    expect(prompt).toContain('C 类来源不得标为“中”“较高”或“高”');
    expect(prompt).toContain('C 类只能支撑趋势线索、待验证假设或调研方向');
    expect(prompt).toContain(
      '不能支撑经营决策、市场规模、增速、排名、政策确定性、企业收入或市占率',
    );
    expect(prompt).toContain('当关键结论只有 C 类来源支撑时，必须写入“风险与待验证信息”');
  });

  test('treats content production requests as knowledge-first requests', () => {
    expect(isKnowledgeEvidenceRequest('帮我做 10 个小红书选题')).toBe(true);
    expect(isKnowledgeEvidenceRequest('写一段私域成交话术')).toBe(true);
    expect(isKnowledgeEvidenceRequest('生成一条短视频脚本')).toBe(true);

    const prompt = buildAgentKnowledgeEvidencePromptForRequest('帮我做 10 个小红书选题');

    expect(prompt).toContain('[Knowledge evidence usage contract]');
    expect(prompt).toContain('内容生产');
    expect(prompt).toContain('memory_search');
    expect(prompt).toContain('lobsterai_industry_positioning_get_latest');
    expect(prompt).toContain('不要调用阻断式选择');
    expect(prompt).toContain('没有命中足够相关知识时，不要假设生成');
    expect(prompt).toContain('小红书选题');
    expect(prompt).toContain('内容质量自检评分');
    expect(prompt).toContain('渠道适配、工厂画像复用、真人感、转化动作、事实边界、空泛程度');
    expect(prompt).toContain('任一项低于 8 分，先静默重写一次');
    expect(prompt).toContain('不要把评分表、扣分项或自检过程展示给用户');
  });

  test('requires an explicit video generation follow-up after short video scripts', () => {
    const prompt = buildAgentKnowledgeEvidencePromptForRequest('帮我写一个 60 秒短视频脚本');

    expect(prompt).toContain('下一步：是否需要继续生成视频？');
    expect(prompt).toContain('如果需要，我可以继续把这版脚本整理成视频生成提示词');
    expect(prompt).toContain('不要只给“老板出镜版/30 秒版”等改写建议来替代这个确认');
  });

  test('treats heavy-packaging positioning context as enough for a WeChat Moments draft', () => {
    const prompt = buildAgentKnowledgeEvidencePromptForRequest('帮我写一条朋友圈文案');

    expect(prompt).toContain('重型包装行业包、定位报告');
    expect(prompt).toContain('足够先写一版保守可用的朋友圈文案');
    expect(prompt).toContain('不要把城市、具体产品、目标客户行业作为写作前的必填项');
    expect(prompt).toContain('城市、联系方式、承重数据、客户细分');
    expect(prompt).toContain('老板口吻也要保持事实边界');
    expect(prompt).toContain(
      '不要把替代木箱、免熏蒸、成本更低、装柜率更高或防护不比木箱差写成所有订单都成立的确定承诺',
    );
    expect(prompt).toContain('用户明确要求只输出改写结果时，只输出正文');
  });

  test('appends workspace knowledge snippets before content production answers', () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-content-knowledge-'));
    const workspaceDir = path.join(stateDir, 'workspace-main');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'USER.md'),
      '用户主营重型纸箱和蜂窝纸箱，主要客户是机械设备厂和汽配出口工厂。',
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceDir, 'MEMORY.md'),
      [
        '# User Memories',
        '',
        '- 小红书内容优先围绕防破损、替代木箱、免熏蒸和包装降本做选题。',
        '- 私域话术要像真实工厂业务员，不要像广告海报。',
      ].join('\n'),
      'utf8',
    );

    const prompt = buildAgentKnowledgeFileContextPrompt({
      prompt: '帮我做 10 个小红书选题',
      stateDir,
      agentId: 'main',
    });

    expect(prompt).toContain('[Knowledge base context matched before answering]');
    expect(prompt).toContain('重型纸箱和蜂窝纸箱');
    expect(prompt).toContain('防破损、替代木箱、免熏蒸和包装降本');

    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  test('matched content knowledge forbids denying remembered factory facts', () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-content-known-factory-'));
    const workspaceDir = path.join(stateDir, 'workspace-main');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'USER.md'),
      '工厂主要做重型纸箱、蜂窝箱、纸护角、纸托盘，可按尺寸定制。',
      'utf8',
    );

    const prompt = buildAgentKnowledgeFileContextPrompt({
      prompt: '帮我写一条朋友圈文案',
      stateDir,
      agentId: 'main',
    });

    expect(prompt).toContain('[Knowledge base context matched before answering]');
    expect(prompt).toContain('重型纸箱、蜂窝箱、纸护角、纸托盘');
    expect(prompt).toContain('不要说“我目前还没记住你工厂的具体情况”');
    expect(prompt).toContain('先输出一条可直接复制的朋友圈文案草稿');
    expect(prompt).toContain('内容质量自检评分');
    expect(prompt).toContain('任一项低于 8 分，先静默重写一次');
    expect(prompt).toContain('老板口吻也要保持事实边界');
    expect(prompt).toContain('只输出正文，不要额外输出解释、关键词、行动引导或下一步快捷改写');

    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  test('matches business profile context even without exact content channel keywords', () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-business-profile-'));
    const workspaceDir = path.join(stateDir, 'workspace-main');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'USER.md'),
      [
        '公司做注塑模具维护服务，服务华南制造企业。',
        '决策人是生产主管，卖点是减少停机时间和降低售后沟通成本。',
      ].join('\n'),
      'utf8',
    );

    const prompt = buildAgentKnowledgeFileContextPrompt({
      prompt: '帮我做 10 个小红书选题',
      stateDir,
      agentId: 'main',
    });

    expect(prompt).toContain('[Knowledge base context matched before answering]');
    expect(prompt).toContain('注塑模具维护服务');
    expect(prompt).toContain('生产主管');
    expect(prompt).toContain('命中阈值');

    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  test('does not treat generic channel preferences as enough business context', () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-generic-channel-'));
    const workspaceDir = path.join(stateDir, 'workspace-main');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'MEMORY.md'),
      '用户喜欢小红书排版简洁，标题不要太夸张，平时使用中文。',
      'utf8',
    );

    const prompt = buildAgentKnowledgeFileContextPrompt({
      prompt: '帮我做 10 个小红书选题',
      stateDir,
      agentId: 'main',
    });

    expect(prompt).toContain('[Content knowledge retrieval preflight]');
    expect(prompt).toContain('No sufficiently relevant knowledge was found');
    expect(prompt).not.toContain('[Knowledge base context matched before answering]');
    expect(prompt).not.toContain('小红书排版简洁');

    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  test('blocks content production when local knowledge has no relevant business context', () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-content-missing-'));
    const workspaceDir = path.join(stateDir, 'workspace-main');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'USER.md'),
      '用户喜欢极简界面，平时使用中文。',
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceDir, 'MEMORY.md'),
      '- 上次讨论了软件更新通知的显示位置。',
      'utf8',
    );

    const prompt = buildAgentKnowledgeFileContextPrompt({
      prompt: '帮我做 10 个小红书选题',
      stateDir,
      agentId: 'main',
    });

    expect(prompt).toContain('[Content knowledge retrieval preflight]');
    expect(prompt).toContain('No sufficiently relevant knowledge was found');
    expect(prompt).toContain('不要生成选题、脚本、文案、私域话术或销售转化内容');
    expect(prompt).toContain('请用户补充');
    expect(prompt).not.toContain('[Knowledge base context matched before answering]');
    expect(prompt).not.toContain('极简界面');
    expect(prompt).not.toContain('软件更新通知');

    fs.rmSync(stateDir, { recursive: true, force: true });
  });
});
