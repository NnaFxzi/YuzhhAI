export const ContentQualityRegressionCategory = {
  WeChatMoments: 'wechat_moments',
  OwnerToneRewrite: 'owner_tone_rewrite',
  ShortVideoScript: 'short_video_script',
  PrivateDomainMessage: 'private_domain_message',
  SalesConversion: 'sales_conversion',
} as const;

export type ContentQualityRegressionCategory =
  (typeof ContentQualityRegressionCategory)[keyof typeof ContentQualityRegressionCategory];

export const CONTENT_QUALITY_SCORE_DIMENSIONS = [
  {
    id: 'channel_fit',
    labelZh: '渠道适配',
    passScore: 8,
    descriptionZh: '内容结构、长度、语气和信息密度是否适合目标渠道。',
  },
  {
    id: 'factory_profile_reuse',
    labelZh: '工厂画像复用',
    passScore: 8,
    descriptionZh: '是否复用已知工厂、产品、客户、卖点和渠道信息。',
  },
  {
    id: 'human_voice',
    labelZh: '真人感',
    passScore: 8,
    descriptionZh: '是否像真实工厂老板、业务员或销售在说话，而不是模板广告。',
  },
  {
    id: 'conversion_action',
    labelZh: '转化动作',
    passScore: 8,
    descriptionZh: '是否有自然、具体、可执行的咨询、私聊、发尺寸、评估方案等下一步动作。',
  },
  {
    id: 'factual_boundaries',
    labelZh: '事实边界',
    passScore: 8,
    descriptionZh: '是否避免编造载重、交期、认证、价格、产能、服务区域、客户案例和确定性成本降幅。',
  },
  {
    id: 'specificity',
    labelZh: '空泛程度',
    passScore: 8,
    descriptionZh: '是否有具体场景、客户痛点、产品方案和保守卖点，避免空泛口号。',
  },
] as const;

export type ContentQualityScoreDimensionId =
  (typeof CONTENT_QUALITY_SCORE_DIMENSIONS)[number]['id'];

export interface ContentQualityRegressionCase {
  id: string;
  category: ContentQualityRegressionCategory;
  prompt: string;
  targetChannel: string;
  expectedOutput: string;
  requiredSignals: string[];
  forbiddenSignals: string[];
}

const commonForbiddenSignals = [
  '不要编造载重、交期、认证、价格、产能、服务区域',
  '不要写确定性成本降幅',
  '不要虚构客户案例',
];

export const CONTENT_QUALITY_REGRESSION_CASES: ContentQualityRegressionCase[] = [
  {
    id: 'moments-single-heavy-packaging',
    category: ContentQualityRegressionCategory.WeChatMoments,
    prompt: '帮我写一条朋友圈文案',
    targetChannel: '微信朋友圈',
    expectedOutput: '可直接发布的朋友圈正文',
    requiredSignals: ['重型包装', '重型纸箱', '替代木箱', '发尺寸或私聊评估'],
    forbiddenSignals: commonForbiddenSignals,
  },
  {
    id: 'moments-batch-week',
    category: ContentQualityRegressionCategory.WeChatMoments,
    prompt: '帮我写 10 条朋友圈文案，围绕替代木箱、防破损、免熏蒸和包装降本',
    targetChannel: '微信朋友圈',
    expectedOutput: '10 条可直接发布的朋友圈正文',
    requiredSignals: ['替代木箱', '防破损', '免熏蒸', '包装降本'],
    forbiddenSignals: commonForbiddenSignals,
  },
  {
    id: 'moments-dongguan-factory',
    category: ContentQualityRegressionCategory.WeChatMoments,
    prompt: '写一条朋友圈，突出东莞重型包装厂可以做重型纸箱、蜂窝箱、纸护角和纸托盘',
    targetChannel: '微信朋友圈',
    expectedOutput: '带地域和产品画像的朋友圈正文',
    requiredSignals: ['东莞', '重型纸箱', '蜂窝箱', '纸护角', '纸托盘'],
    forbiddenSignals: commonForbiddenSignals,
  },
  {
    id: 'moments-machinery-customers',
    category: ContentQualityRegressionCategory.WeChatMoments,
    prompt: '写一条朋友圈，主要吸引机械设备客户，语气像真实业务员',
    targetChannel: '微信朋友圈',
    expectedOutput: '面向机械设备客户的业务员口吻朋友圈',
    requiredSignals: ['机械设备', '运输包装', '产品尺寸', '评估方案'],
    forbiddenSignals: commonForbiddenSignals,
  },
  {
    id: 'rewrite-owner-tone-only-result',
    category: ContentQualityRegressionCategory.OwnerToneRewrite,
    prompt:
      '基于上一条输出，改写成老板口吻。保留原有工厂画像、产品、客户、卖点和渠道信息。不要新增没有证据的硬事实，不要编造载重、交期、认证、价格、产能、服务区域等信息。只输出可直接使用的改写结果，不要解释。',
    targetChannel: '微信朋友圈',
    expectedOutput: '只包含可直接复制的老板口吻正文',
    requiredSignals: ['老板口吻', '保守表达', '重型工业包装', '发尺寸评估'],
    forbiddenSignals: ['解释过程', '关键词', '下一步快捷改写', ...commonForbiddenSignals],
  },
  {
    id: 'rewrite-owner-tone-short',
    category: ContentQualityRegressionCategory.OwnerToneRewrite,
    prompt: '把上一条朋友圈改短一点，老板口吻，直接一点，但不要新增承诺',
    targetChannel: '微信朋友圈',
    expectedOutput: '短版老板口吻朋友圈正文',
    requiredSignals: ['直接', '短句', '不新增承诺'],
    forbiddenSignals: commonForbiddenSignals,
  },
  {
    id: 'rewrite-more-human',
    category: ContentQualityRegressionCategory.OwnerToneRewrite,
    prompt: '把这条朋友圈改得更像工厂老板自己发的，不要像广告',
    targetChannel: '微信朋友圈',
    expectedOutput: '更自然的工厂老板口吻正文',
    requiredSignals: ['工厂老板', '自然口语', '真实场景'],
    forbiddenSignals: ['广告海报感', ...commonForbiddenSignals],
  },
  {
    id: 'rewrite-wechat-group-owner-tone',
    category: ContentQualityRegressionCategory.OwnerToneRewrite,
    prompt: '把上面的内容改成微信群短句版，老板口吻，只输出正文',
    targetChannel: '微信群',
    expectedOutput: '适合微信群发送的老板口吻短句',
    requiredSignals: ['微信群', '短句', '只输出正文'],
    forbiddenSignals: ['解释过程', '下一步快捷改写', ...commonForbiddenSignals],
  },
  {
    id: 'script-wood-box-replacement',
    category: ContentQualityRegressionCategory.ShortVideoScript,
    prompt: '帮我写一个 30 秒短视频脚本，主题是替代木箱包装',
    targetChannel: '短视频',
    expectedOutput: '包含开场钩子、口播/镜头、卖点和行动引导的 30 秒脚本',
    requiredSignals: ['开场钩子', '替代木箱', '口播', '行动引导'],
    forbiddenSignals: commonForbiddenSignals,
  },
  {
    id: 'script-damage-prevention',
    category: ContentQualityRegressionCategory.ShortVideoScript,
    prompt: '写一个 60 秒短视频脚本，主题是重型纸箱运输防破损',
    targetChannel: '短视频',
    expectedOutput: '围绕运输防护的 60 秒短视频脚本',
    requiredSignals: ['重型纸箱', '防破损', '运输场景', '镜头'],
    forbiddenSignals: commonForbiddenSignals,
  },
  {
    id: 'script-fumigation-free-export',
    category: ContentQualityRegressionCategory.ShortVideoScript,
    prompt: '写一个短视频口播，讲出口包装为什么可以考虑免熏蒸纸包装方案',
    targetChannel: '短视频',
    expectedOutput: '出口免熏蒸方向的口播脚本',
    requiredSignals: ['出口包装', '免熏蒸', '纸包装方案', '可评估'],
    forbiddenSignals: commonForbiddenSignals,
  },
  {
    id: 'script-machinery-export',
    category: ContentQualityRegressionCategory.ShortVideoScript,
    prompt: '给机械设备出口客户写一个短视频脚本，突出纸箱和纸托盘方案',
    targetChannel: '短视频',
    expectedOutput: '面向机械设备出口客户的短视频脚本',
    requiredSignals: ['机械设备', '出口客户', '纸箱', '纸托盘'],
    forbiddenSignals: commonForbiddenSignals,
  },
  {
    id: 'private-group-heavy-packaging',
    category: ContentQualityRegressionCategory.PrivateDomainMessage,
    prompt: '帮我写一条发到微信群里的重型包装获客话术',
    targetChannel: '微信群',
    expectedOutput: '适合微信群发送的重型包装获客短话术',
    requiredSignals: ['微信群', '重型包装', '有货要发', '发尺寸'],
    forbiddenSignals: commonForbiddenSignals,
  },
  {
    id: 'private-referral',
    category: ContentQualityRegressionCategory.PrivateDomainMessage,
    prompt: '写一条老客户转介绍话术，让客户帮忙介绍需要重型纸箱或替代木箱包装的朋友',
    targetChannel: '微信私聊',
    expectedOutput: '自然真诚的老客户转介绍话术',
    requiredSignals: ['老客户', '转介绍', '重型纸箱', '替代木箱包装'],
    forbiddenSignals: commonForbiddenSignals,
  },
  {
    id: 'private-before-quote',
    category: ContentQualityRegressionCategory.PrivateDomainMessage,
    prompt: '微信私聊客户，报价前想让客户先发产品尺寸和重量，帮我写得自然一点',
    targetChannel: '微信私聊',
    expectedOutput: '报价前索取尺寸重量的自然私聊话术',
    requiredSignals: ['产品尺寸', '重量', '报价前', '自然'],
    forbiddenSignals: commonForbiddenSignals,
  },
  {
    id: 'private-customer-trust',
    category: ContentQualityRegressionCategory.PrivateDomainMessage,
    prompt: '客户说还是木箱更放心，帮我写一段微信回复，不要硬怼客户',
    targetChannel: '微信私聊',
    expectedOutput: '回应客户顾虑的微信私聊话术',
    requiredSignals: ['理解顾虑', '可评估', '产品结构', '方案'],
    forbiddenSignals: ['硬怼客户', ...commonForbiddenSignals],
  },
  {
    id: 'sales-wood-box-question',
    category: ContentQualityRegressionCategory.SalesConversion,
    prompt: '客户问纸箱能不能代替木箱，帮我写一段销售回复',
    targetChannel: '销售回复',
    expectedOutput: '可直接发送的销售回复',
    requiredSignals: ['不能一概而论', '看产品尺寸和结构', '评估方案'],
    forbiddenSignals: commonForbiddenSignals,
  },
  {
    id: 'sales-price-objection',
    category: ContentQualityRegressionCategory.SalesConversion,
    prompt: '客户觉得重型纸箱比普通纸箱贵，帮我写一段转化话术',
    targetChannel: '销售回复',
    expectedOutput: '回应价格异议的转化话术',
    requiredSignals: ['普通纸箱', '重型纸箱', '破损风险', '整体成本'],
    forbiddenSignals: commonForbiddenSignals,
  },
  {
    id: 'sales-load-concern',
    category: ContentQualityRegressionCategory.SalesConversion,
    prompt: '客户担心纸箱承重不够，帮我写一段销售跟进话术',
    targetChannel: '销售跟进',
    expectedOutput: '回应承重顾虑但不编造承重数据的跟进话术',
    requiredSignals: ['承重顾虑', '实际产品', '结构设计', '不要编造数据'],
    forbiddenSignals: commonForbiddenSignals,
  },
  {
    id: 'sales-1688-inquiry',
    category: ContentQualityRegressionCategory.SalesConversion,
    prompt: '1688 上有客户询盘重型纸箱，帮我写一段回复，目标是让客户发尺寸和用途',
    targetChannel: '1688',
    expectedOutput: '适合 1688 询盘的销售回复',
    requiredSignals: ['1688', '重型纸箱', '尺寸', '用途'],
    forbiddenSignals: commonForbiddenSignals,
  },
];

export const getContentQualityRegressionCasesByCategory = (
  category: ContentQualityRegressionCategory,
): ContentQualityRegressionCase[] =>
  CONTENT_QUALITY_REGRESSION_CASES.filter(item => item.category === category);

export const buildContentQualityEvaluationPrompt = ({
  testCase,
  modelOutput,
}: {
  testCase: ContentQualityRegressionCase;
  modelOutput: string;
}): string => {
  const dimensionLines = CONTENT_QUALITY_SCORE_DIMENSIONS.map(
    dimension =>
      `- ${dimension.id}（${dimension.labelZh}）：0-10 分，及格 ${dimension.passScore} 分。${dimension.descriptionZh}`,
  ).join('\n');

  return [
    '[内容质量回归评审]',
    '你是 LobsterAI 的内容质量评审器。请根据测试用例和模型输出打分。',
    '只输出 JSON，不要输出解释性正文或 Markdown。',
    '',
    '评分维度：',
    dimensionLines,
    '',
    '硬性事实边界：不要编造载重、交期、认证、价格、产能、服务区域、客户案例或确定性成本降幅。',
    '如果任一维度低于 8 分，shouldRewrite 必须为 true。',
    '',
    'JSON 结构：',
    '{',
    '  "scores": {',
    '    "channel_fit": 0,',
    '    "factory_profile_reuse": 0,',
    '    "human_voice": 0,',
    '    "conversion_action": 0,',
    '    "factual_boundaries": 0,',
    '    "specificity": 0',
    '  },',
    '  "shouldRewrite": true,',
    '  "reasons": ["每条原因不超过 30 字"],',
    '  "rewriteFocus": ["需要补强的方向"]',
    '}',
    '',
    `测试分类：${testCase.category}`,
    `目标渠道：${testCase.targetChannel}`,
    `用户问题：${testCase.prompt}`,
    `期望输出：${testCase.expectedOutput}`,
    `必须出现或体现：${testCase.requiredSignals.join('、')}`,
    `禁止问题：${testCase.forbiddenSignals.join('、')}`,
    '',
    '模型输出：',
    modelOutput,
  ].join('\n');
};
