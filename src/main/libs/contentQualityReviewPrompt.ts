export const CONTENT_QUALITY_REVIEW_PROMPT_ZH_LINES = [
  '## 内容质量自检评分',
  '- 输出选题、文案、短视频脚本、私域话术、销售转化内容或改写结果前，先在内部按 6 项各 0-10 分自检：渠道适配、工厂画像复用、真人感、转化动作、事实边界、空泛程度。',
  '- 任一项低于 8 分，先静默重写一次，再输出最终稿；重写时优先补足具体场景、客户痛点、工厂产品、保守卖点和行动引导。',
  '- 不要把评分表、扣分项或自检过程展示给用户；用户只需要看到最终可直接使用的内容。',
] as const;

export const CONTENT_QUALITY_REVIEW_PROMPT_EN_LINES = [
  '## Content quality self-check',
  '- Before outputting topic ideas, copywriting, short-video scripts, private-domain messages, sales-conversion content, or rewrites, internally score six dimensions from 0-10: channel fit, factory-profile reuse, human voice, conversion action, factual boundaries, and specificity.',
  '- If any dimension scores below 8, silently rewrite once before answering; when rewriting, improve concrete scenarios, customer pain points, factory products, conservative selling points, and the next action.',
  '- Do not show the scorecard, deductions, or self-check process to the user; the user should only see the final copy-ready content.',
] as const;

export const CONTENT_QUALITY_REVIEW_PROMPT_ZH = CONTENT_QUALITY_REVIEW_PROMPT_ZH_LINES.join('\n');

export const CONTENT_QUALITY_REVIEW_PROMPT_EN = CONTENT_QUALITY_REVIEW_PROMPT_EN_LINES.join('\n');
