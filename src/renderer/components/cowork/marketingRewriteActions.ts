import { ManagedPresetAgentId } from '../../../shared/agent/managedPresetAgents';

export const MarketingRewriteActionId = {
  OwnerTone: 'owner_tone',
  WeChatGroupShort: 'wechat_group_short',
  Alibaba1688Title: '1688_title',
  BaiduSeoLongForm: 'baidu_seo_long_form',
} as const;

export type MarketingRewriteActionId =
  typeof MarketingRewriteActionId[keyof typeof MarketingRewriteActionId];

export interface MarketingRewriteAction {
  id: MarketingRewriteActionId;
  labelKey: string;
  prompt: string;
}

interface BuildMarketingRewriteActionsOptions {
  agentId?: string | null;
  isBusy: boolean;
  latestAssistantContent?: string | null;
}

const buildRewritePrompt = (target: string): string => (
  `基于你上一条输出，改写成${target}。` +
  '保留原有工厂画像、产品、客户、卖点和渠道信息。' +
  '不要新增没有证据的硬事实，不要编造载重、交期、认证、价格、产能、服务区域等信息。' +
  '只输出可直接使用的改写结果，不要解释。'
);

export function buildMarketingRewriteActions(
  options: BuildMarketingRewriteActionsOptions,
): MarketingRewriteAction[] {
  if (
    options.agentId !== ManagedPresetAgentId.Marketing ||
    options.isBusy ||
    !options.latestAssistantContent?.trim()
  ) {
    return [];
  }

  return [
    {
      id: MarketingRewriteActionId.OwnerTone,
      labelKey: 'marketingRewriteOwnerTone',
      prompt: buildRewritePrompt('老板口吻'),
    },
    {
      id: MarketingRewriteActionId.WeChatGroupShort,
      labelKey: 'marketingRewriteWeChatGroupShort',
      prompt: buildRewritePrompt('微信群短文案'),
    },
    {
      id: MarketingRewriteActionId.Alibaba1688Title,
      labelKey: 'marketingRewrite1688Title',
      prompt: buildRewritePrompt('1688商品标题'),
    },
    {
      id: MarketingRewriteActionId.BaiduSeoLongForm,
      labelKey: 'marketingRewriteBaiduSeoLongForm',
      prompt: buildRewritePrompt('百度SEO长文'),
    },
  ];
}
