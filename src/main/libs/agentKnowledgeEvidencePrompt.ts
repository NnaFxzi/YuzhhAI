import fs from 'fs';
import path from 'path';

import { VIDEO_GENERATION_HANDOFF_PROMPT } from '../../shared/contentProduction/videoGenerationHandoff';
import {
  buildContentKnowledgeIndex,
  type ContentKnowledgeRetrievalResult,
  type ContentKnowledgeRetriever,
  type ContentKnowledgeSource,
  ContentKnowledgeSourceType,
  searchContentKnowledgeIndex,
} from './contentKnowledgeRetrieval';
import { CONTENT_QUALITY_REVIEW_PROMPT_ZH_LINES } from './contentQualityReviewPrompt';

const KNOWLEDGE_CONTEXT_HIT_LIMIT = 8;
const KNOWLEDGE_CONTEXT_CHARS = 420;

const normalizeKnowledgePromptText = (value: string): string =>
  value.replace(/\s+/g, '').trim().toLowerCase();

const readKnowledgeFile = (filePath: string): string => {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch {
    return '';
  }
  return '';
};

const getKnowledgeWorkspaceDir = (stateDir: string, agentId?: string): string => {
  const normalizedAgentId = agentId?.trim();
  if (!normalizedAgentId || normalizedAgentId === 'main') {
    return path.join(stateDir, 'workspace-main');
  }
  return path.join(stateDir, `workspace-${normalizedAgentId}`);
};

const KNOWLEDGE_EVIDENCE_REQUEST_TOKENS = [
  '行业',
  '市场',
  '形势',
  '形式',
  '态势',
  '趋势',
  '竞争格局',
  '产品定位',
  '主推方向',
  '知识库',
  '分析当前',
];

const CONTENT_PRODUCTION_REQUEST_TOKENS = [
  '小红书',
  '选题',
  '标题',
  '脚本',
  '短视频',
  '口播',
  '分镜',
  '文案',
  '朋友圈',
  '公众号',
  '微信群',
  '私域',
  '私聊',
  '私信',
  '话术',
  '销售回复',
  '销售话术',
  '成交话术',
  '转化内容',
  '种草',
  '推广内容',
  '推广文案',
  '营销文案',
  '改写',
  '润色',
];

const isContentProductionRequest = (prompt: string): boolean => {
  const normalized = normalizeKnowledgePromptText(prompt);
  if (!normalized) {
    return false;
  }

  return CONTENT_PRODUCTION_REQUEST_TOKENS.some(token =>
    normalized.includes(normalizeKnowledgePromptText(token)),
  );
};

export const isKnowledgeEvidenceRequest = (prompt: string): boolean => {
  const normalized = normalizeKnowledgePromptText(prompt);
  if (!normalized) {
    return false;
  }

  return [...KNOWLEDGE_EVIDENCE_REQUEST_TOKENS, ...CONTENT_PRODUCTION_REQUEST_TOKENS].some(token =>
    normalized.includes(normalizeKnowledgePromptText(token)),
  );
};

export const buildAgentKnowledgeEvidencePrompt = (): string =>
  [
    '[Knowledge evidence usage contract]',
    '- 当用户提出行业分析、市场形势、竞争格局、产品定位、主推方向或要求结合知识库的问题时，先使用可用知识来源，再输出结论。',
    '- 当用户提出内容生产请求，包括选题、标题、文案、短视频脚本、私域话术、销售回复、成交话术、销售转化内容、小红书选题或平台草稿时，也要先使用可用知识来源。',
    '- 可用时优先调用或参考 `memory_search`、`memory_get`、`MEMORY.md`、`USER.md`、`lobsterai_industry_positioning_get_latest`、工作区资料和最近运行结果。',
    '- 如果 `memory_search`、`MEMORY.md`、`USER.md` 或 `lobsterai_industry_positioning_get_latest` 已经命中相关行业、产品、客户或定位报告，就把这些结果当作证据包拼接到当前任务中回答。',
    '- 命中行业证据时，不要追问用户具体行业；先按证据识别的行业回答，并用一句话说明“我先按……行业分析”。',
    '- 命中内容生产证据时，不要追问用户具体领域、赛道、人群或风格；先按证据识别的产品、客户、渠道、卖点和历史定位回答，并用一句话说明“我先按……方向生成”。',
    '- 对重型包装获客场景，重型包装行业包、定位报告、memory_search 或 lobsterai_industry_positioning_get_latest 命中重型纸箱、蜂窝箱、纸护角、纸托盘、替代木箱、机械设备、汽配、出口包装、防破损、降本或免熏蒸等信息时，已经足够先写一版保守可用的朋友圈文案。',
    '- 用户只说“帮我写一条朋友圈文案”时，不要把城市、具体产品、目标客户行业作为写作前的必填项；城市、联系方式、承重数据、客户细分只能放在正文后的可选优化问题里。',
    ...CONTENT_QUALITY_REVIEW_PROMPT_ZH_LINES,
    '- 老板口吻也要保持事实边界；不要把替代木箱、免熏蒸、成本更低、装柜率更高或防护不比木箱差写成所有订单都成立的确定承诺；没有案例或参数支撑时，优先写成可评估、可减少、可优化、按产品结构设计。',
    '- 用户明确要求只输出改写结果时，只输出正文，不要额外输出解释、关键词、行动引导或下一步快捷改写。',
    '- 不要调用阻断式选择、确认或用户输入弹窗来询问内容生产的领域、赛道、人群、风格或渠道；这些信息优先从当前提示词、知识库、长期记忆、工厂画像和已保存定位报告中推断。',
    '- 内容生产没有命中足够相关知识时，不要假设生成，不要暂按通用方向生成，也不要输出选题、脚本、文案、私域话术或销售转化内容；只用普通对话请用户补充领域/赛道、账号定位、目标人群、产品/服务、卖点或转化目标中的关键缺口。',
    '- 小红书选题默认输出标题或角度、目标人群、痛点、开头钩子、内容形式和转化意图；不要只输出标题列表，也不要只问“你做什么行业”。',
    '- 短视频脚本默认输出开场钩子、镜头/口播、卖点展开、信任补充和行动引导；私域/销售话术默认输出场景、用户顾虑、可复制话术和跟进动作。',
    `- ${VIDEO_GENERATION_HANDOFF_PROMPT}`,
    '- 只有完全没有相关证据，或命中多个互相冲突的行业时，才追问用户确认。',
    '- 记忆索引暂时不可用不是停止回答的理由；如果其他知识来源可用，继续分析，把缺少证据的判断标记为“待验证”。',
    '- 证据质量分级：A 类=官方统计、海关/协会、上市公司公告/年报、专业数据库或一手调研；B 类=权威媒体、券商、咨询机构公开摘要；C 类=百度文库、博客、论坛、转载文章、无法确认原始出处的内容。',
    '- 证据硬规则：A 类 → 高置信，可支撑核心结论、经营决策、市场规模、增速、排名、政策确定性、企业收入或市占率；B 类 → 中置信，可支撑趋势判断、行业结构、风险判断和行动建议，但关键经营决策需 A 类或多源交叉验证；C 类 → 低置信/待验证。',
    '- C 类来源不得标为“中”“较高”或“高”；C 类只能支撑趋势线索、待验证假设或调研方向，不能支撑经营决策、市场规模、增速、排名、政策确定性、企业收入或市占率。',
    '- 当关键结论只有 C 类来源支撑时，必须写入“风险与待验证信息”，不要放进“一句话判断”或“对用户业务的机会”的确定性表述里。',
    '- A/B 类证据可以支撑核心结论；C 类证据只能作为线索或待验证信息，不能支撑核心结论，也不能单独支撑市场规模、增速、排名或政策确定性判断。',
    '- 涉及数字或关键判断时使用证据编号，例如“废纸均价 1604 元/吨 [S1，高置信]”；结尾附“资料依据表”，列出证据编号、来源、日期、来源类型、置信度和用于支撑的结论。',
    '- 不要说“数据已齐全”“数据够了”“资料很完整”这类过度确定的话；改为“我先基于已命中的行业包、知识库资料和搜索结果做分析，未能交叉验证的数据会标为待验证”。',
    '- 输出具体数字、市场规模、增长率、企业数量、利润、出口额、占比或年份预测时，必须同时给出来源、时间和置信度；没有来源的数字不要写成确定事实，改写为“待验证”。',
    '- 不要暴露内部技术诊断、embedding 错误、索引命令、堆栈、内部路径、外部研究 API、Tavily、Firecrawl、agent 设置、docs.openclaw.ai 或 `openclaw memory index --force` 这类命令/配置；遇到记忆或索引状态异常时，不要在最终回答中提及“历史记忆”“索引”“检索暂不可用”，直接省略内部状态；需要表达证据边界时，只用业务化说法：“我先基于已命中的工厂资料、行业包和调研信息来写；没有证据支撑的具体数据不做确定表达”。',
    '- 开头要业务化：优先写“我先按……行业分析”，再给结论；不要用“数据够了”“工具返回了”“索引异常”等内部过程话术开场。',
    '- 结尾必须给可执行动作清单，动作要能直接推进业务，例如主推方向、客户优先级、内容动作、待补资料或下一步调研任务。',
    '- 行业分析默认结构：一句话判断、行业现状、客户采购逻辑、竞争格局、对用户业务的机会、风险与待验证信息、下一步动作。',
  ].join('\n');

export const buildAgentKnowledgeEvidencePromptForRequest = (prompt: string): string =>
  isKnowledgeEvidenceRequest(prompt) ? buildAgentKnowledgeEvidencePrompt() : '';

const buildContentKnowledgeMissingPrompt = (): string =>
  [
    '[Content knowledge retrieval preflight]',
    'No sufficiently relevant knowledge was found for this content-production request.',
    '- 这表示应用层没有找到可支撑内容生产的领域/赛道、账号定位、目标人群、产品/服务、卖点、渠道或转化目标资料。',
    '- 不要生成选题、脚本、文案、私域话术或销售转化内容。',
    '- 不要假设用户属于美妆、穿搭、家居、职场、母婴、旅行、数码或其他任意赛道。',
    '- 请用户补充一个最关键缺口，例如领域/赛道、账号定位、目标人群、产品/服务或转化目标。',
    '- 用普通聊天文本提问，不要调用阻断式选择弹窗。',
  ].join('\n');

const truncateKnowledgeContext = (text: string): string =>
  text.length > KNOWLEDGE_CONTEXT_CHARS ? `${text.slice(0, KNOWLEDGE_CONTEXT_CHARS - 1)}…` : text;

const buildKnowledgeContextPrompt = (result: ContentKnowledgeRetrievalResult): string => {
  const lines = [
    '[Knowledge base context matched before answering]',
    'The following local workspace knowledge chunks were retrieved by LobsterAI before the model answered. Treat them as evidence for the current request.',
    '内容生产硬规则：如果命中片段里已经包含工厂、产品、客户或卖点信息，不要说“我目前还没记住你工厂的具体情况”，也不要说“没有存过你们工厂的具体资料”；不要重复询问命中片段已有的产品、客户或卖点。',
    '如果当前请求是朋友圈文案，先输出一条可直接复制的朋友圈文案草稿；如果是选题、脚本、私域话术或销售转化内容，也先输出可直接使用的成品，再把缺失信息放到末尾用 1-2 个问题追问。',
    VIDEO_GENERATION_HANDOFF_PROMPT,
    ...CONTENT_QUALITY_REVIEW_PROMPT_ZH_LINES,
    '老板口吻也要保持事实边界；替代木箱、免熏蒸、成本更低、装柜率更高、防护不比木箱差等卖点，没有案例或参数支撑时要写成可评估、可减少、可优化、按产品结构设计。',
    '用户明确要求只输出改写结果时，只输出正文，不要额外输出解释、关键词、行动引导或下一步快捷改写。',
    `检索方式：知识条目切片 + embedding 入库/索引 + 关键词/向量混合检索 + 重排；命中阈值 ${result.diagnostics.hitThreshold.toFixed(2)}，最低业务信号 ${result.diagnostics.minBusinessSignalCount}。`,
  ];

  result.hits.slice(0, KNOWLEDGE_CONTEXT_HIT_LIMIT).forEach((hit, index) => {
    lines.push(
      `[K${index + 1}] ${hit.chunk.sourceLabel} · score ${hit.scores.finalScore.toFixed(2)} · business signals ${hit.chunk.businessSignalCount}`,
      `- ${truncateKnowledgeContext(hit.chunk.text.replace(/\s+/g, ' ').trim())}`,
    );
  });

  return lines.join('\n');
};

const buildKnowledgeSources = (workspaceDir: string): ContentKnowledgeSource[] => [
  {
    sourceId: 'USER.md',
    sourceType: ContentKnowledgeSourceType.UserProfile,
    label: 'USER.md',
    content: readKnowledgeFile(path.join(workspaceDir, 'USER.md')),
  },
  {
    sourceId: 'MEMORY.md',
    sourceType: ContentKnowledgeSourceType.Memory,
    label: 'MEMORY.md',
    content: readKnowledgeFile(path.join(workspaceDir, 'MEMORY.md')),
  },
];

const retrieveKnowledgeContext = ({
  prompt,
  workspaceDir,
  agentId,
  knowledgeRetriever,
  sharedScopeIds,
}: {
  prompt: string;
  workspaceDir: string;
  agentId?: string;
  knowledgeRetriever?: ContentKnowledgeRetriever;
  sharedScopeIds?: string[];
}): ContentKnowledgeRetrievalResult => {
  const sources = buildKnowledgeSources(workspaceDir);
  const scopeId = `agent:${agentId?.trim() || 'main'}:${workspaceDir}`;
  if (knowledgeRetriever) {
    return knowledgeRetriever.retrieveFromSources({
      scopeId,
      prompt,
      sources,
      sharedScopeIds,
      options: { maxHits: KNOWLEDGE_CONTEXT_HIT_LIMIT },
    });
  }

  return searchContentKnowledgeIndex(buildContentKnowledgeIndex(sources), prompt, {
    maxHits: KNOWLEDGE_CONTEXT_HIT_LIMIT,
  });
};

export const buildAgentKnowledgeFileContextPrompt = ({
  prompt,
  stateDir,
  agentId,
  knowledgeRetriever,
  sharedScopeIds,
}: {
  prompt: string;
  stateDir?: string;
  agentId?: string;
  knowledgeRetriever?: ContentKnowledgeRetriever;
  sharedScopeIds?: string[];
}): string => {
  const normalizedStateDir = stateDir?.trim();
  if (!isKnowledgeEvidenceRequest(prompt)) {
    return '';
  }

  const contentProductionRequest = isContentProductionRequest(prompt);
  if (!normalizedStateDir) {
    return contentProductionRequest ? buildContentKnowledgeMissingPrompt() : '';
  }

  const workspaceDir = getKnowledgeWorkspaceDir(normalizedStateDir, agentId);
  const retrievalResult = retrieveKnowledgeContext({
    prompt,
    workspaceDir,
    agentId,
    knowledgeRetriever,
    sharedScopeIds,
  });

  if (!retrievalResult.matched) {
    return contentProductionRequest ? buildContentKnowledgeMissingPrompt() : '';
  }

  return buildKnowledgeContextPrompt(retrievalResult);
};
