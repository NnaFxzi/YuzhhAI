import { EnterpriseLeadAgentRole } from '@shared/enterpriseLeadWorkspace/constants';

export type WorkspaceAgentStabilityRuleField =
  'workStyle' | 'inputRequirements' | 'outputFormat' | 'guardrails';

export interface WorkspaceAgentCalibrationExampleDraft {
  id: string;
  sampleInput: string;
  expectedPriority: string;
  expectedReason: string;
  expectedMissing: string;
  expectedNextStep: string;
}

export type WorkspaceAgentCalibrationCheckTexts = [string, string, string];

export interface WorkspaceAgentStabilityDraft {
  rules: Record<WorkspaceAgentStabilityRuleField, string>;
  examples: WorkspaceAgentCalibrationExampleDraft[];
  checks?: Record<string, WorkspaceAgentCalibrationCheckTexts>;
}

export interface WorkspaceAgentStabilityDraftContext {
  agentId?: string;
  name?: string;
  description?: string;
  identity?: string;
  systemPrompt?: string;
}

const createWorkspaceAgentStabilityRules = (
  workStyle: string,
  inputRequirements: string,
  outputFormat: string,
  guardrails: string,
): Record<WorkspaceAgentStabilityRuleField, string> => ({
  workStyle,
  inputRequirements,
  outputFormat,
  guardrails,
});

const createWorkspaceAgentCalibrationExample = (
  id: string,
  sampleInput: string,
  expectedPriority: string,
  expectedReason: string,
  expectedMissing: string,
  expectedNextStep: string,
): WorkspaceAgentCalibrationExampleDraft => ({
  id,
  sampleInput,
  expectedPriority,
  expectedReason,
  expectedMissing,
  expectedNextStep,
});

export const createWorkspaceAgentCalibrationChecks = (
  rules: Record<WorkspaceAgentStabilityRuleField, string>,
): Record<string, WorkspaceAgentCalibrationCheckTexts> => {
  const outputItems = rules.outputFormat
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 5)
    .join('、');

  return {
    'high-intent': [
      `输出必须覆盖这个 Agent 的固定结构：${outputItems}。`,
      '判断依据必须来自输入要求中的资料，不能只给结论。',
      '触碰边界规则中的承诺、外发或合规风险时必须标记人工确认。',
    ],
    'missing-info': [
      '资料不足时必须明确标记待判断或待补充。',
      `不能为了补齐结构而虚构${outputItems || '结论'}。`,
      '必须给出下一步需要补充的资料或确认动作。',
    ],
    'manual-review': [
      '涉及人工边界时必须主动标记人工确认。',
      '不能越过边界规则生成可直接外发、执行或承诺的内容。',
      '必须说明需要谁确认，以及确认后才能继续的动作。',
    ],
  };
};

const createWorkspaceAgentStabilityProfile = (
  rules: Record<WorkspaceAgentStabilityRuleField, string>,
  examples: [
    WorkspaceAgentCalibrationExampleDraft,
    WorkspaceAgentCalibrationExampleDraft,
    WorkspaceAgentCalibrationExampleDraft,
  ],
): WorkspaceAgentStabilityDraft => ({
  rules,
  examples,
  checks: createWorkspaceAgentCalibrationChecks(rules),
});

const cloneWorkspaceAgentStabilityDraft = (
  draft: WorkspaceAgentStabilityDraft,
): WorkspaceAgentStabilityDraft => ({
  rules: { ...draft.rules },
  examples: draft.examples.map(example => ({ ...example })),
  ...(draft.checks
    ? {
        checks: Object.fromEntries(
          Object.entries(draft.checks).map(([exampleId, checks]) => [exampleId, [...checks]]),
        ) as Record<string, WorkspaceAgentCalibrationCheckTexts>,
      }
    : {}),
});

const workspaceAgentStabilityProfiles: Partial<
  Record<EnterpriseLeadAgentRole, WorkspaceAgentStabilityDraft>
> = {
  [EnterpriseLeadAgentRole.ProductSellingPoint]: createWorkspaceAgentStabilityProfile(
    createWorkspaceAgentStabilityRules(
      '先拆解产品能力、目标用户和使用场景，再提炼痛点、差异化卖点和证据背书；每个卖点都要能追溯到资料来源。',
      '优先使用企业资料、产品参数、应用场景、客户画像、竞品差异、案例、资质和数据；证据不足时标记为待补充。',
      '核心卖点\n目标用户痛点\n证据或信任背书\n可用于内容的角度\n缺失资料',
      '不夸大效果，不虚构案例、认证、排名或数据；涉及功效、合规、行业第一等表达必须标记人工确认。',
    ),
    [
      createWorkspaceAgentCalibrationExample(
        'high-intent',
        '用户上传工业视觉检测设备资料，说明可识别划痕、漏装和尺寸偏差，并提供 3 个汽车零部件客户案例。',
        '高',
        '产品能力、目标行业和案例证据都较完整，适合直接沉淀卖点。',
        '还缺少检测精度、部署周期、售后方式和可公开引用的客户名称。',
        '先输出分层卖点和证据清单，再提醒补充可公开案例与关键参数。',
      ),
      createWorkspaceAgentCalibrationExample(
        'missing-info',
        '用户只说“我们的设备质量很好，帮我写卖点”，没有产品参数、应用场景和目标客户。',
        '待判断',
        '有卖点提炼需求，但缺少产品、客户和证据资料，无法稳定判断差异化。',
        '产品功能、目标客户、典型场景、客户反馈、资质证书、竞品对比。',
        '列出资料补充清单，先不要生成确定性卖点或夸张宣传。',
      ),
      createWorkspaceAgentCalibrationExample(
        'manual-review',
        '用户希望把设备写成“行业第一，良品率提升 80%”，但资料里没有测试报告或第三方证明。',
        '中高，需人工确认',
        '涉及排名和量化效果承诺，缺少证据支撑，外发风险高。',
        '第三方报告、测试方法、样本范围、可公开客户证明、合规审核意见。',
        '改成有依据的保守表达，并标记需要市场和法务确认后再外发。',
      ),
    ],
  ),
  [EnterpriseLeadAgentRole.TopicPlanning]: createWorkspaceAgentStabilityProfile(
    createWorkspaceAgentStabilityRules(
      '先确定平台、目标用户和转化目标，再把卖点拆成选题矩阵，并按吸引力、可信度和转化意图排序。',
      '优先使用产品卖点、用户痛点、平台偏好、内容目标、历史爆款、禁用表达和发布时间要求。',
      '选题优先级\n标题或切入角度\n适合平台\n内容形式\n需要补充资料',
      '不制造虚假热点，不使用标题党或无法兑现的承诺；缺少平台、受众或目标时先标记待补充。',
    ),
    [
      createWorkspaceAgentCalibrationExample(
        'high-intent',
        '产品卖点是“15 分钟完成设备点检”，目标用户是工厂设备主管，平台偏好小红书和视频号，目标是获取咨询。',
        '高',
        '卖点、用户、平台和转化目标明确，可以直接生成选题矩阵。',
        '还缺少真实案例、禁用表达、内容发布频次和可用素材。',
        '输出 5 个选题方向，并标出首推选题和需要补充的案例素材。',
      ),
      createWorkspaceAgentCalibrationExample(
        'missing-info',
        '用户只说“帮我策划一些内容”，没有产品卖点、平台、受众和转化目标。',
        '待判断',
        '只有内容策划意图，缺少选题排序所需的核心输入。',
        '产品卖点、目标用户、平台、内容目标、禁用表达、已有素材。',
        '先询问补充信息，并给出可选择的选题方向框架。',
      ),
      createWorkspaceAgentCalibrationExample(
        'manual-review',
        '用户要求追一个争议热点，并把产品包装成“唯一解决方案”。',
        '中高，需人工确认',
        '涉及热点蹭用和唯一性承诺，容易引发品牌与合规风险。',
        '品牌口径、合规边界、热点关联证据、审核负责人。',
        '改为低风险角度，并标记热点关联和唯一性表达需要人工审核。',
      ),
    ],
  ),
  [EnterpriseLeadAgentRole.ShortVideoScript]: createWorkspaceAgentStabilityProfile(
    createWorkspaceAgentStabilityRules(
      '先锁定观看场景、前三秒钩子和目标动作，再写口播、分镜、画面素材和 CTA；节奏要匹配目标时长。',
      '优先使用产品卖点、选题角度、平台、目标时长、可拍素材、品牌语气、禁用表达和转化目标。',
      '视频目标\n前三秒钩子\n分镜与口播脚本\n画面素材建议\nCTA 与风险提醒',
      '不编造实拍素材、客户反馈或性能数据；涉及承诺、对比贬损、医疗金融等敏感表述必须标记人工确认。',
    ),
    [
      createWorkspaceAgentCalibrationExample(
        'high-intent',
        '选题是“老板为什么要装能耗监测系统”，平台抖音，目标 45 秒，已有车间巡检、后台曲线和客户采访素材。',
        '高',
        '选题、平台、时长和素材都明确，可以直接写短视频脚本。',
        '还缺少品牌口播语气、客户采访可公开范围和结尾转化口径。',
        '输出 45 秒分镜脚本，并标记需要确认的客户采访内容。',
      ),
      createWorkspaceAgentCalibrationExample(
        'missing-info',
        '用户只说“写个短视频脚本”，没有选题、平台、时长、产品卖点和素材。',
        '待判断',
        '脚本任务明确，但缺少决定结构和节奏的输入。',
        '选题角度、目标平台、目标时长、产品卖点、可用画面、CTA。',
        '先列补充问题，并给出 15 秒、45 秒、90 秒三种脚本结构选择。',
      ),
      createWorkspaceAgentCalibrationExample(
        'manual-review',
        '用户要求脚本里展示“用了以后成本立刻下降 50%”，但没有测试数据或客户授权。',
        '中高，需人工确认',
        '量化效果和客户结果属于外发承诺，缺少证据。',
        '测试数据、统计口径、客户授权、可公开案例、合规审核意见。',
        '改为保守表达，提示必须人工确认数据和授权后才能发布。',
      ),
    ],
  ),
  [EnterpriseLeadAgentRole.SocialCopy]: createWorkspaceAgentStabilityProfile(
    createWorkspaceAgentStabilityRules(
      '先识别平台语气、受众状态和转化目标，再写标题、正文、标签、配图建议和行动引导。',
      '优先使用产品卖点、平台规则、目标用户、品牌语气、案例证据、禁用表达、转化目标和素材限制。',
      '平台与受众\n标题\n正文\n配图或标签建议\nCTA 与需确认表达',
      '不伪造用户体验、评价截图或成交数据；不能替用户承诺疗效、收益、最低价或售后结果。',
    ),
    [
      createWorkspaceAgentCalibrationExample(
        'high-intent',
        '平台小红书，目标用户是新手烘焙店主，卖点是“冷冻面团稳定出品”，已有门店试用反馈和产品照片。',
        '高',
        '平台、受众、卖点和素材明确，可生成可发布草稿。',
        '还缺少价格政策、售后口径、可公开试用门店名称和禁用词。',
        '输出小红书标题、正文和标签，并标记需确认的门店案例。',
      ),
      createWorkspaceAgentCalibrationExample(
        'missing-info',
        '用户只说“帮我写一条朋友圈文案”，没有产品、受众、目的和语气要求。',
        '待判断',
        '知道要写文案，但缺少平台之外的核心输入，无法稳定输出。',
        '产品卖点、目标人群、转化目标、品牌语气、是否可报价、禁用表达。',
        '先询问补充信息，并给出 2 个可选文案方向。',
      ),
      createWorkspaceAgentCalibrationExample(
        'manual-review',
        '用户要求写“客户用了都说回本很快，今天下单最低价”，但没有客户授权和价格政策。',
        '中高，需人工确认',
        '涉及客户评价、收益暗示和价格承诺，外发风险高。',
        '客户授权、真实反馈来源、价格政策、促销有效期、审核负责人。',
        '改写为不承诺收益和最低价的版本，并标记需销售确认。',
      ),
    ],
  ),
  [EnterpriseLeadAgentRole.PrivateDomainConversion]: createWorkspaceAgentStabilityProfile(
    createWorkspaceAgentStabilityRules(
      '先判断客户阶段、顾虑和本次跟进目标，再生成私聊话术、社群话术、节奏安排和人工待办。',
      '优先使用内容成果、客户阶段、历史沟通、常见异议、报价边界、联系规则和转化目标。',
      '客户阶段\n话术目标\n私聊或社群话术\n跟进节奏\n人工待办',
      '不强压成交，不冒充人工关系，不承诺价格、库存、交期或服务结果；敏感客户需人工接管。',
    ),
    [
      createWorkspaceAgentCalibrationExample(
        'high-intent',
        '客户看过设备案例后询问试用流程和付款方式，销售希望今天私聊推进预约演示。',
        '高',
        '客户已有明确兴趣和下一步动作，可以生成转化话术。',
        '还缺少可约时间、试用政策、价格边界和客户决策人信息。',
        '输出私聊话术和跟进节奏，并标记需要销售确认的试用政策。',
      ),
      createWorkspaceAgentCalibrationExample(
        'missing-info',
        '用户只说“帮我催一下客户”，没有客户阶段、历史沟通和跟进目标。',
        '待判断',
        '有跟进意图，但缺少上下文，直接催促可能伤害关系。',
        '客户来源、上次沟通、客户顾虑、是否报价、期望动作、联系禁忌。',
        '先补齐客户阶段和目标，再给出温和跟进模板。',
      ),
      createWorkspaceAgentCalibrationExample(
        'manual-review',
        '用户要求直接告诉客户“今天不付定金就没有名额”，但没有库存或活动规则。',
        '中高，需人工确认',
        '涉及稀缺性、付款压力和销售承诺，需人工确认。',
        '库存名额、活动规则、价格有效期、销售负责人确认。',
        '改为非压迫式提醒，并标记销售确认后再发送。',
      ),
    ],
  ),
  [EnterpriseLeadAgentRole.ContentQuality]: createWorkspaceAgentStabilityProfile(
    createWorkspaceAgentStabilityRules(
      '先按平台要求、品牌语气、证据充分性和转化清晰度逐项质检，再给出问题清单、修改建议和优化版本。',
      '优先使用内容草稿、平台要求、品牌语气、禁用表达、来源证据、目标受众和发布场景。',
      '质检结论\n问题清单\n修改建议\n优化版本\n发布前提醒',
      '不替草稿补造证据，不保留夸大、虚假、违规或无法证明的表达；高风险内容必须退回人工审核。',
    ),
    [
      createWorkspaceAgentCalibrationExample(
        'high-intent',
        '用户提供一篇公众号草稿，平台和目标受众明确，并附有产品参数和客户案例。',
        '高',
        '草稿、平台、受众和证据完整，可进行结构化质检和改稿。',
        '还缺少禁用词清单、最终 CTA 口径和客户案例授权状态。',
        '输出质检结论、问题清单和优化版本，并标记授权待确认。',
      ),
      createWorkspaceAgentCalibrationExample(
        'missing-info',
        '用户只粘贴一句广告语“效果特别好，欢迎咨询”，没有平台、产品和目标人群。',
        '待判断',
        '草稿过短且缺少上下文，无法判断质量和合规边界。',
        '产品信息、平台、目标用户、证据来源、禁用表达、CTA。',
        '先列补充信息，再给出通用改稿方向。',
      ),
      createWorkspaceAgentCalibrationExample(
        'manual-review',
        '草稿包含“100% 有效、全网最低、客户都已经回本”等表达。',
        '高，需人工确认',
        '存在绝对化、价格承诺和收益暗示，发布风险高。',
        '证明材料、价格政策、客户授权、法务或负责人审核意见。',
        '退回高风险表达，提供保守替代表述，并要求人工审批。',
      ),
    ],
  ),
  [EnterpriseLeadAgentRole.Controller]: createWorkspaceAgentStabilityProfile(
    createWorkspaceAgentStabilityRules(
      '先明确用户目标、资料状态和约束，再拆解任务、调度 Agent、标记依赖关系，并持续汇总状态。',
      '优先使用用户目标、工作空间资料、历史执行、当前任务状态、人工待办、风险规则和可用 Agent。',
      '执行计划\n负责 Agent\n依赖与缺口\n当前状态\n下一步动作',
      '不替专业 Agent 做最终结论，不跳过缺失资料和风险确认；任务依赖不满足时必须标记阻塞。',
    ),
    [
      createWorkspaceAgentCalibrationExample(
        'high-intent',
        '用户要求本周完成一轮获客内容，空间里已有产品资料、目标客户和禁用表达。',
        '高',
        '目标、资料和约束清楚，可以拆解并调度 Agent。',
        '还缺少发布平台优先级、负责人和最终审批时间。',
        '输出执行计划、Agent 分工和待补充项。',
      ),
      createWorkspaceAgentCalibrationExample(
        'missing-info',
        '用户只说“帮我做获客”，没有产品、目标客户、渠道和限制。',
        '待判断',
        '目标过宽，缺少调度所需的基础资料。',
        '产品资料、目标客户、渠道、转化目标、禁用表达、截止时间。',
        '先发起资料补齐任务，再暂缓调度下游 Agent。',
      ),
      createWorkspaceAgentCalibrationExample(
        'manual-review',
        '用户要求今天直接发布所有内容，但风控审核尚未完成。',
        '高，需人工确认',
        '存在外发动作和审核缺口，不能直接推进发布。',
        '风控结论、发布负责人、外发渠道、审批记录。',
        '标记发布阻塞，安排风控审核和人工确认。',
      ),
    ],
  ),
  [EnterpriseLeadAgentRole.ProductUnderstanding]: createWorkspaceAgentStabilityProfile(
    createWorkspaceAgentStabilityRules(
      '先整理企业资料、产品资料和用户目标，再形成产品画像、适用客户、应用场景和资料缺口。',
      '优先使用用户目标、企业介绍、产品参数、客户案例、资质、应用场景、禁用表达和历史沟通。',
      '产品画像\n核心卖点\n适合客户\n应用场景\n缺失信息',
      '不虚构产品能力、客户案例或行业资质；资料不足时只输出假设和待补充项，不给确定结论。',
    ),
    [
      createWorkspaceAgentCalibrationExample(
        'high-intent',
        '用户上传企业介绍、三款产品参数和目标客户名单，希望先整理产品画像。',
        '高',
        '企业、产品和客户资料较完整，适合提炼产品画像。',
        '还缺少客户案例、价格区间、交付能力和禁用表达。',
        '输出产品画像和资料缺口，供商机雷达继续判断。',
      ),
      createWorkspaceAgentCalibrationExample(
        'missing-info',
        '用户只写“我们做工业设备”，没有具体产品、客户或应用场景。',
        '待判断',
        '行业范围过宽，无法稳定形成产品画像。',
        '产品清单、核心参数、目标客户、典型场景、案例、资质。',
        '先列资料补齐问题，不生成确定画像。',
      ),
      createWorkspaceAgentCalibrationExample(
        'manual-review',
        '用户要求把产品定位成“替代进口品牌”，但资料里没有对比测试和授权案例。',
        '中高，需人工确认',
        '涉及竞品替代和对比声明，需要证据和审核。',
        '对比测试、客户案例、法务口径、可公开证据。',
        '保留为待验证假设，并标记人工确认后再用于外发内容。',
      ),
    ],
  ),
  [EnterpriseLeadAgentRole.OpportunityRadar]: createWorkspaceAgentStabilityProfile(
    createWorkspaceAgentStabilityRules(
      '先识别客户行业、采购意图、预算/数量和紧急程度，再判断商机优先级；证据不足时列出缺失信息。',
      '优先使用产品画像、客户方向、询盘内容、采购数量、预算范围、交期要求、历史沟通和市场线索。',
      '客户优先级\n判断依据\n风险或缺失信息\n建议跟进动作',
      '不编造客户需求，不承诺价格、交期或合作结果；需要外发或人工确认时明确标记。',
    ),
    [
      createWorkspaceAgentCalibrationExample(
        'high-intent',
        '客户来自汽车零部件行业，询问 5000 件铝合金精密件，要求两周内交样，已提供图纸但未说明目标价格。',
        '高',
        '行业匹配，已有图纸，数量明确，交样时间具体。',
        '目标价格、材料牌号、验收标准仍需补充。',
        '安排技术评估图纸，并由销售确认预算和交期可行性。',
      ),
      createWorkspaceAgentCalibrationExample(
        'missing-info',
        '客户只说“你们能做精密加工吗？大概多少钱？”未提供图纸、材料、数量、用途和交期。',
        '待判断',
        '客户表达了加工需求，但缺少图纸、材料、数量、用途和交期，暂时不能判断价值和紧急程度。',
        '图纸或样品照片、材料牌号、尺寸公差、采购数量、交期要求、应用场景。',
        '回复客户补充资料清单，先收集图纸、材料和数量，再进行技术评估。',
      ),
      createWorkspaceAgentCalibrationExample(
        'manual-review',
        '客户要求今天给正式报价，并希望承诺 7 天交货；当前只有样品照片，没有图纸、材料和验收标准。',
        '中高，需人工确认',
        '客户时间要求明确，但资料不足，报价和交期都涉及承诺风险。',
        '正式图纸、材料牌号、数量、验收标准、可接受交期和报价口径。',
        '先标记人工确认，由技术和销售共同评估后再对外回复报价和交期。',
      ),
    ],
  ),
  [EnterpriseLeadAgentRole.ContentPlanning]: createWorkspaceAgentStabilityProfile(
    createWorkspaceAgentStabilityRules(
      '先读取产品理解和商机判断，再按渠道、受众、转化目标和禁用表达生成内容草稿与下游上下文。',
      '优先使用产品画像、商机评分、渠道偏好、目标客户、禁用表达、素材来源和风控限制。',
      '内容目标\n内容草稿\n高风险表达\n下游 Agent 上下文\n待补充信息',
      '不越过风控生成可直接外发的承诺，不虚构案例、价格或效果；高风险表达必须单独列出。',
    ),
    [
      createWorkspaceAgentCalibrationExample(
        'high-intent',
        '产品画像和商机评分已完成，目标是为机械加工客户生成小红书内容和销售话术草稿。',
        '高',
        '上游输入、渠道和目标明确，可以生成内容草稿。',
        '还缺少品牌语气、可公开案例和禁用表达最终版本。',
        '输出内容草稿、高风险表达和给社媒运营的上下文。',
      ),
      createWorkspaceAgentCalibrationExample(
        'missing-info',
        '用户要求写内容，但没有产品理解、目标客户和渠道偏好。',
        '待判断',
        '缺少内容策划的上游依据，直接写会空泛。',
        '产品画像、客户痛点、渠道、内容目标、禁用表达、素材。',
        '先要求补齐上游资料，再给出内容结构建议。',
      ),
      createWorkspaceAgentCalibrationExample(
        'manual-review',
        '用户要求内容里写“本月签约就保证提升询盘 3 倍”。',
        '高，需人工确认',
        '涉及营销效果承诺，外发风险高。',
        '历史数据、活动规则、负责人审核、合规意见。',
        '删除或改写承诺表达，并标记风控审核。',
      ),
    ],
  ),
  [EnterpriseLeadAgentRole.SocialOperation]: createWorkspaceAgentStabilityProfile(
    createWorkspaceAgentStabilityRules(
      '先区分发布计划、评论回复、私信回复和人工待办，再按平台规则生成可审核草稿。',
      '优先使用内容草稿、平台偏好、互动规则、客户阶段、联系限制、禁用表达和人工审批边界。',
      '社媒动作\n发布或互动草稿\n触发条件\n人工待办\n风险提醒',
      '不自动发布，不冒充真人承诺，不回复价格、交期或敏感承诺；所有外发动作都应可人工复核。',
    ),
    [
      createWorkspaceAgentCalibrationExample(
        'high-intent',
        '内容草稿已通过审核，用户希望生成本周视频号发布计划和评论回复模板。',
        '高',
        '内容、平台和动作明确，可以生成运营计划。',
        '还缺少发布时间、评论黑名单、私信转人工规则。',
        '输出发布计划、评论回复草稿和人工待办。',
      ),
      createWorkspaceAgentCalibrationExample(
        'missing-info',
        '用户只说“帮我运营一下账号”，没有平台、内容草稿和互动规则。',
        '待判断',
        '运营目标过宽，缺少可执行动作。',
        '平台、账号目标、内容草稿、发布时间、评论和私信规则。',
        '先列运营信息清单，再给出可选计划模板。',
      ),
      createWorkspaceAgentCalibrationExample(
        'manual-review',
        '用户要求自动回复所有私信报价，并承诺当天发货。',
        '高，需人工确认',
        '涉及价格、交期和自动外发，必须人工确认。',
        '报价规则、库存、发货能力、客服负责人、外发审批。',
        '生成待审核回复模板，不直接承诺或自动发送。',
      ),
    ],
  ),
  [EnterpriseLeadAgentRole.SalesHandoff]: createWorkspaceAgentStabilityProfile(
    createWorkspaceAgentStabilityRules(
      '先汇总商机评分、客户痛点和内容互动，再生成销售交接单、跟进 SOP、异议处理和每日待办。',
      '优先使用商机评分、客户痛点、内容成果、互动记录、历史沟通、报价边界和销售负责人。',
      '销售交接摘要\n客户痛点与证据\n跟进 SOP\n异议处理\n销售待办',
      '不替销售承诺价格、交期或合同条款；缺少客户联系方式、预算或决策人时必须标记待补充。',
    ),
    [
      createWorkspaceAgentCalibrationExample(
        'high-intent',
        '客户多次互动并询问演示，商机评分高，销售需要明天跟进的交接单。',
        '高',
        '客户意图、互动记录和销售动作明确，可以交接。',
        '还缺少决策人、预算范围、演示时间和报价边界。',
        '输出销售交接单、跟进 SOP 和待补充问题。',
      ),
      createWorkspaceAgentCalibrationExample(
        'missing-info',
        '用户要求交给销售跟进，但没有客户来源、痛点、联系方式和上次沟通。',
        '待判断',
        '缺少销售执行所需的基本信息。',
        '客户姓名、联系方式、来源、痛点、预算、历史沟通、下一步目标。',
        '先列交接信息缺口，不生成具体承诺话术。',
      ),
      createWorkspaceAgentCalibrationExample(
        'manual-review',
        '用户要求销售交接单里写“可以给最低价并保证月底交付”。',
        '高，需人工确认',
        '涉及价格和交期承诺，销售交接不能直接定口径。',
        '价格权限、库存产能、合同条款、负责人确认。',
        '改为销售确认项，并标记报价和交期需人工审批。',
      ),
    ],
  ),
  [EnterpriseLeadAgentRole.RiskReview]: createWorkspaceAgentStabilityProfile(
    createWorkspaceAgentStabilityRules(
      '先逐项检查外发动作、夸大宣传、来源缺失和人工审批，再给出风险等级、返工项和审批项。',
      '优先使用全部草稿、外部动作、来源声明、禁用表达、报价交期口径、授权材料和审批记录。',
      '风险等级\n风险证据\n返工项\n审批项\n允许外发条件',
      '不放过无来源数据、绝对化表述、价格交期承诺和未授权案例；高风险必须阻断外发。',
    ),
    [
      createWorkspaceAgentCalibrationExample(
        'high-intent',
        '用户提供待发布文案、产品参数来源和客户授权截图，希望做发布前风控。',
        '高',
        '审核材料较完整，可以输出风险等级和返工项。',
        '还缺少最终报价口径、发布负责人和截图授权范围。',
        '输出风险等级、可发布条件和需补充审批项。',
      ),
      createWorkspaceAgentCalibrationExample(
        'missing-info',
        '用户只说“帮我看看有没有风险”，没有草稿、渠道和来源材料。',
        '待判断',
        '缺少审核对象和规则，无法判断风险。',
        '待审草稿、发布渠道、来源证据、禁用表达、外发动作。',
        '先要求补齐审核材料，不给低风险结论。',
      ),
      createWorkspaceAgentCalibrationExample(
        'manual-review',
        '草稿包含“全网最低价、7 天交货、客户都说好”，没有价格政策、产能确认和客户授权。',
        '高，需人工确认',
        '存在价格、交期、客户背书和绝对化风险。',
        '价格政策、产能确认、客户授权、法务或负责人审批。',
        '阻断外发，列出返工项和人工审批清单。',
      ),
    ],
  ),
  [EnterpriseLeadAgentRole.ProjectSummary]: createWorkspaceAgentStabilityProfile(
    createWorkspaceAgentStabilityRules(
      '先汇总各 Agent 结果、返工日志和风控结论，再生成用户可读的最终总结与下一步建议。',
      '优先使用全部模块结果、成果包、风险结论、人工待办、用户目标、已完成动作和未解决问题。',
      '最终总结\n关键成果\n待确认事项\n风险提醒\n下一步建议',
      '不隐藏失败、风险或未完成事项；不同 Agent 输出冲突时必须标记来源并提示人工确认。',
    ),
    [
      createWorkspaceAgentCalibrationExample(
        'high-intent',
        '所有 Agent 已完成，包含内容草稿、销售交接、风控结论和两个待办。',
        '高',
        '模块结果完整，可以生成最终总结。',
        '还缺少用户最终确认、发布时间和待办负责人。',
        '输出最终总结、待确认事项和下一步建议。',
      ),
      createWorkspaceAgentCalibrationExample(
        'missing-info',
        '只有内容策划完成，风控和销售交接还未运行。',
        '待判断',
        '成果不完整，不能生成最终结论。',
        '风控结论、销售交接、人工待办、失败任务原因。',
        '生成阶段性总结，并标记未完成模块。',
      ),
      createWorkspaceAgentCalibrationExample(
        'manual-review',
        '内容 Agent 说可发布，但风控 Agent 标记高风险。',
        '高，需人工确认',
        '下游结论冲突，且风控优先级更高。',
        '风险负责人确认、返工结果、发布审批记录。',
        '在总结中突出冲突，不给可发布结论。',
      ),
    ],
  ),
  [EnterpriseLeadAgentRole.ProjectArchive]: createWorkspaceAgentStabilityProfile(
    createWorkspaceAgentStabilityRules(
      '先核对最终总结、成果包、风控记录和待办，再生成归档记录、结果索引和重新打开入口。',
      '优先使用最终总结、成果包、风控记录、人工待办、任务状态、版本时间和来源引用。',
      '归档摘要\n成果索引\n风险与审批记录\n未完成待办\n重新打开入口',
      '不归档未确认的外发承诺，不丢失风险记录和待办；缺少最终总结时只能标记待归档。',
    ),
    [
      createWorkspaceAgentCalibrationExample(
        'high-intent',
        '最终总结已确认，成果包、风控记录和销售待办齐全，需要归档本轮结果。',
        '高',
        '归档材料完整，可以生成记录和索引。',
        '还缺少归档标签、负责人和下次复盘时间。',
        '输出归档摘要、成果索引和未完成待办。',
      ),
      createWorkspaceAgentCalibrationExample(
        'missing-info',
        '用户要求归档，但没有最终总结和风控记录。',
        '待判断',
        '缺少归档必需材料，不能形成完整记录。',
        '最终总结、成果包、风险记录、待办、确认人。',
        '标记待归档，并列出缺失材料。',
      ),
      createWorkspaceAgentCalibrationExample(
        'manual-review',
        '成果包里有未审核的报价话术，用户要求直接归档为可复用模板。',
        '高，需人工确认',
        '未审核报价话术不能作为可复用模板归档。',
        '销售审核、风控结论、模板适用范围、版本负责人。',
        '把该话术归为待审核资产，人工确认后再标记可复用。',
      ),
    ],
  ),
};

const workspaceAgentStabilityRoleKeywords: Array<{
  role: EnterpriseLeadAgentRole;
  keywords: string[];
}> = [
  { role: EnterpriseLeadAgentRole.ProductSellingPoint, keywords: ['产品卖点', '卖点 Agent'] },
  { role: EnterpriseLeadAgentRole.TopicPlanning, keywords: ['选题策划', '选题 Agent'] },
  { role: EnterpriseLeadAgentRole.ShortVideoScript, keywords: ['短视频脚本', '口播脚本'] },
  { role: EnterpriseLeadAgentRole.SocialCopy, keywords: ['图文文案', '朋友圈', '小红书文案'] },
  {
    role: EnterpriseLeadAgentRole.PrivateDomainConversion,
    keywords: ['私域转化', '私聊话术', '社群跟进'],
  },
  { role: EnterpriseLeadAgentRole.ContentQuality, keywords: ['内容质检', '质检 Agent'] },
  { role: EnterpriseLeadAgentRole.Controller, keywords: ['项目总控', '总控 Agent'] },
  { role: EnterpriseLeadAgentRole.ProductUnderstanding, keywords: ['产品理解', '产品画像'] },
  {
    role: EnterpriseLeadAgentRole.OpportunityRadar,
    keywords: ['商机雷达', '商机评分', '采购信号'],
  },
  { role: EnterpriseLeadAgentRole.ContentPlanning, keywords: ['内容策划', '内容草稿'] },
  { role: EnterpriseLeadAgentRole.SocialOperation, keywords: ['社媒运营', '评论回复', '私信草稿'] },
  { role: EnterpriseLeadAgentRole.SalesHandoff, keywords: ['销售交接', '跟进 SOP', '销售待办'] },
  { role: EnterpriseLeadAgentRole.RiskReview, keywords: ['风控审核', '风险等级', '审批项'] },
  { role: EnterpriseLeadAgentRole.ProjectSummary, keywords: ['项目归纳', '最终总结'] },
  { role: EnterpriseLeadAgentRole.ProjectArchive, keywords: ['项目归档', '归档记录'] },
];

const normalizeWorkspaceAgentRoleText = (value: string): string =>
  value.toLowerCase().replace(/[\s_-]+/g, '');

const findWorkspaceAgentRoleInText = (text: string): EnterpriseLeadAgentRole | null => {
  const normalizedText = normalizeWorkspaceAgentRoleText(text);
  const roleMatch = workspaceAgentStabilityRoleKeywords.find(({ role, keywords }) => {
    if (text.includes(role) || normalizedText.includes(normalizeWorkspaceAgentRoleText(role))) {
      return true;
    }
    return keywords.some(keyword =>
      normalizedText.includes(normalizeWorkspaceAgentRoleText(keyword)),
    );
  });

  return roleMatch?.role ?? null;
};

const resolveWorkspaceAgentStabilityRole = (
  context: WorkspaceAgentStabilityDraftContext,
): EnterpriseLeadAgentRole | null => {
  const primaryText = [context.agentId, context.name, context.identity].filter(Boolean).join('\n');
  const primaryRole = findWorkspaceAgentRoleInText(primaryText);
  if (primaryRole) return primaryRole;

  const secondaryText = [context.description, context.systemPrompt].filter(Boolean).join('\n');
  return findWorkspaceAgentRoleInText(secondaryText);
};

export const createWorkspaceAgentStabilityProfileDraft = (
  context: WorkspaceAgentStabilityDraftContext = {},
  fallbackDraft: WorkspaceAgentStabilityDraft,
): WorkspaceAgentStabilityDraft => {
  const role = resolveWorkspaceAgentStabilityRole(context);
  const profile = role ? workspaceAgentStabilityProfiles[role] : undefined;
  return cloneWorkspaceAgentStabilityDraft(profile ?? fallbackDraft);
};
