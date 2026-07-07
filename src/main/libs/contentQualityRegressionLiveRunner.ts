import {
  type ContentQualityRegressionReport,
  runContentQualityRegressionSuite,
} from './contentQualityRegressionRunner';
import {
  CONTENT_QUALITY_REGRESSION_CASES,
  CONTENT_QUALITY_SCORE_DIMENSIONS,
  type ContentQualityRegressionCase,
  type ContentQualityScoreDimensionId,
} from './contentQualityRegressionSuite';

export interface ContentQualityModelClient {
  complete(input: {
    prompt: string;
    purpose: 'generation' | 'evaluation';
    testCase: ContentQualityRegressionCase;
  }): Promise<string>;
}

export interface ContentQualityLiveRunnerOptions {
  cases?: ContentQualityRegressionCase[];
  generator: ContentQualityModelClient;
  evaluator: ContentQualityModelClient;
}

const DEFAULT_FACTORY_PROFILE = [
  '东莞重型包装工厂。',
  '主营：重型纸箱、蜂窝箱、纸护角、纸托盘、替代木箱包装。',
  '常见客户：机械配件、汽配、电机设备、出口设备、大件或异形件工业客户。',
  '常见卖点：替代木箱、减少熏蒸环节、按尺寸定制、按产品结构设计防护、包装降本需要按具体产品评估。',
  '事实边界：不要编造载重、交期、认证、价格、产能、服务区域、客户案例或确定性成本降幅。',
].join('\n');

export const buildContentQualityGenerationPrompt = (
  testCase: ContentQualityRegressionCase,
): string =>
  [
    '[内容质量回归生成任务]',
    '你是 LobsterAI Cowork 主对话中的推广 Agent。请根据已知工厂画像回答用户问题。',
    '',
    '已知工厂画像：',
    DEFAULT_FACTORY_PROFILE,
    '',
    '输出要求：',
    '- 先产出可直接使用的内容，不要停在追问，除非完全没有业务方向。',
    '- 保留事实边界，缺少参数时使用“可评估”“按产品尺寸确认”“按产品结构设计”等保守表达。',
    '- 用户要求只输出正文时，不要附加解释、关键词、评分或下一步建议。',
    '',
    `目标渠道：${testCase.targetChannel}`,
    `期望输出：${testCase.expectedOutput}`,
    `必须体现：${testCase.requiredSignals.join('、')}`,
    `禁止问题：${testCase.forbiddenSignals.join('、')}`,
    '',
    `用户问题：${testCase.prompt}`,
  ].join('\n');

export const runContentQualityRegressionWithModel = async ({
  cases = CONTENT_QUALITY_REGRESSION_CASES,
  generator,
  evaluator,
}: ContentQualityLiveRunnerOptions): Promise<ContentQualityRegressionReport> =>
  runContentQualityRegressionSuite({
    cases,
    generateOutput: testCase =>
      generator.complete({
        prompt: buildContentQualityGenerationPrompt(testCase),
        purpose: 'generation',
        testCase,
      }),
    evaluateOutput: ({ testCase, evaluationPrompt }) =>
      evaluator.complete({
        prompt: evaluationPrompt,
        purpose: 'evaluation',
        testCase,
      }),
  });

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

const formatScore = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

interface FailedDimensionPriority {
  id: ContentQualityScoreDimensionId;
  labelZh: string;
  count: number;
  index: number;
}

const REPAIR_SUGGESTIONS: Record<ContentQualityScoreDimensionId, string> = {
  channel_fit:
    '按渠道约束输出结构和长度，朋友圈重正文和真实场景，短视频重钩子、镜头和口播，私域话术重短句和下一步。',
  factory_profile_reuse:
    '加强知识库命中内容注入，回答前必须复用已确认的产品、客户、卖点和禁用承诺。',
  human_voice: '降低模板广告味，改成工厂老板、业务员或销售能自然说出口的短句。',
  conversion_action: '在每条内容末尾加入自然行动引导，例如发尺寸、私聊评估、提供用途后判断方案。',
  factual_boundaries: '继续压住硬承诺，禁止编造载重、交期、认证、价格、产能、服务区域和客户案例。',
  specificity: '补足具体客户场景、产品结构、运输痛点和保守卖点，减少“品质好、服务好”这类空泛表达。',
};

const PROMPT_PATCH_RULES: Record<ContentQualityScoreDimensionId, string> = {
  channel_fit:
    '先识别用户要的渠道，再按渠道输出：朋友圈给可直接发布正文，短视频给钩子/镜头/口播/行动，私域话术给短句和下一步。',
  factory_profile_reuse:
    '知识库/记忆命中工厂画像、产品、客户、卖点或禁用承诺时，必须先基于这些事实输出可用初稿；不得再说“没有记住具体情况”。',
  human_voice:
    '输出必须像工厂老板、业务员或销售本人在说话，少用模板广告词，多用短句、场景句和自然表达。',
  conversion_action:
    '结尾必须保留一个轻行动引导，只能使用“发尺寸/私聊评估/说明用途后判断方案”等保守动作。',
  factual_boundaries:
    '禁止编造载重、交期、认证、价格、产能、服务区域、客户案例和确定性成本降幅；缺少参数时用“可评估/需看产品结构/按尺寸确认”。',
  specificity:
    '每次内容至少写出一个具体客户场景、运输痛点、产品结构或保守卖点，避免只写“品质好、服务好、欢迎咨询”。',
};

const getFailedDimensionPriorities = (
  report: ContentQualityRegressionReport,
): FailedDimensionPriority[] => {
  const failedCounts = new Map<string, number>();
  report.rewriteCases.forEach(result => {
    result.failedDimensions.forEach(dimensionId => {
      failedCounts.set(dimensionId, (failedCounts.get(dimensionId) ?? 0) + 1);
    });
  });

  return CONTENT_QUALITY_SCORE_DIMENSIONS.map((dimension, index) => ({
    id: dimension.id,
    labelZh: dimension.labelZh,
    count: failedCounts.get(dimension.id) ?? 0,
    index,
  }))
    .filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count || a.index - b.index);
};

const buildRepairPriorityLines = (report: ContentQualityRegressionReport): string[] => {
  const priorities = getFailedDimensionPriorities(report);
  if (priorities.length === 0) {
    return ['', '## 修复优先级', '无'];
  }

  const priorityLines = priorities.map(
    item => `- ${item.labelZh}（${item.id}）：${item.count} 个样本低于及格线`,
  );

  return ['', '## 修复优先级', '优先修复高频低分维度，再看单条样本的重写重点。', ...priorityLines];
};

const buildRepairSuggestionLines = (report: ContentQualityRegressionReport): string[] => {
  const priorities = getFailedDimensionPriorities(report);
  if (priorities.length === 0) {
    return ['', '## 修复建议', '无'];
  }

  return [
    '',
    '## 修复建议',
    ...priorities.map(item => `- ${item.labelZh}：${REPAIR_SUGGESTIONS[item.id]}`),
  ];
};

export const formatContentQualityPromptPatch = (report: ContentQualityRegressionReport): string => {
  const priorities = getFailedDimensionPriorities(report);
  if (priorities.length === 0) {
    return ['[内容质量修复补丁]', '无'].join('\n');
  }

  return ['[内容质量修复补丁]', ...priorities.map(item => `- ${PROMPT_PATCH_RULES[item.id]}`)].join(
    '\n',
  );
};

const buildPromptPatchLines = (report: ContentQualityRegressionReport): string[] => {
  return [
    '',
    '## Prompt Patch',
    '将下面内容追加到内容生产 Agent 的系统提示词或内容质量规则中：',
    '',
    '```text',
    ...formatContentQualityPromptPatch(report).split('\n'),
    '```',
  ];
};

export const formatContentQualityRegressionReport = (
  report: ContentQualityRegressionReport,
): string => {
  const lines = [
    '# 内容质量回归报告',
    '',
    `总样本：${report.total}`,
    `通过：${report.passed}`,
    `失败：${report.failed}`,
    `通过率：${formatPercent(report.passRate)}`,
    `平均分：${formatScore(report.averageScore)}`,
    '',
    '## 维度',
    ...CONTENT_QUALITY_SCORE_DIMENSIONS.map(
      dimension => `- ${dimension.labelZh}（${dimension.id}）：及格 ${dimension.passScore} 分`,
    ),
    ...buildRepairPriorityLines(report),
    ...buildRepairSuggestionLines(report),
    ...buildPromptPatchLines(report),
  ];

  if (report.rewriteCases.length === 0) {
    lines.push('', '## 需要重写的样本', '无');
    return lines.join('\n');
  }

  lines.push('', '## 需要重写的样本');

  report.rewriteCases.forEach(result => {
    lines.push(
      '',
      `### ${result.testCase.id}`,
      `- 分类：${result.testCase.category}`,
      `- 用户问题：${result.testCase.prompt}`,
      `- 低分维度：${result.failedDimensions.join('、') || '无'}`,
      `- 原因：${result.evaluation.reasons.join('；') || '未提供'}`,
      `- 重写重点：${result.evaluation.rewriteFocus.join('；') || '未提供'}`,
    );
  });

  return lines.join('\n');
};
