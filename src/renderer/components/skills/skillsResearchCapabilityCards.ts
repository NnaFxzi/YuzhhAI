import type { MaskedExternalResearchConfig } from '@shared/agent/externalResearch';
import { SkillConfigFieldType, type SkillConfigSchema } from '@shared/skills/config';

export const SkillsResearchCapabilityKind = {
  ExternalResearch: 'external-research',
  Browser: 'browser',
} as const;

export type SkillsResearchCapabilityKind =
  (typeof SkillsResearchCapabilityKind)[keyof typeof SkillsResearchCapabilityKind];

export const SkillsResearchCapabilityActionTarget = {
  ExternalResearchSettings: 'external-research-settings',
  BrowserSettings: 'browser-settings',
} as const;

export type SkillsResearchCapabilityActionTarget =
  (typeof SkillsResearchCapabilityActionTarget)[keyof typeof SkillsResearchCapabilityActionTarget];

export interface SkillsResearchCapabilityCard {
  kind: SkillsResearchCapabilityKind;
  titleKey: string;
  descriptionKey: string;
  statusKey: string;
  listCard: true;
  managedAsSkill: false;
  toolNames: string[];
  configSchema?: SkillConfigSchema;
  actionLabelKey?: string;
  actionTarget?: SkillsResearchCapabilityActionTarget;
}

export interface ExternalResearchCapabilityConfigStatus {
  configuredCount: number;
  enabledCount: number;
  totalCount: number;
  configured: boolean;
}

const externalResearchCapabilityConfigSchema: SkillConfigSchema = {
  fields: [
    {
      key: 'TAVILY_API_KEY',
      type: SkillConfigFieldType.Secret,
      required: false,
      label: { zh: 'Tavily API Key', en: 'Tavily API Key' },
      description: {
        zh: '用于外部调研搜索和网页资料提取。',
        en: 'Used for external research search and web extraction.',
      },
    },
    {
      key: 'FIRECRAWL_API_KEY',
      type: SkillConfigFieldType.Secret,
      required: false,
      label: { zh: 'Firecrawl API Key', en: 'Firecrawl API Key' },
      description: {
        zh: '用于网页搜索、抓取和正文提取。',
        en: 'Used for web search, crawling, and content extraction.',
      },
    },
  ],
};

export const getExternalResearchCapabilityConfigStatus = (
  config: MaskedExternalResearchConfig | null | undefined,
): ExternalResearchCapabilityConfigStatus => {
  const providers = [config?.providers.tavily, config?.providers.firecrawl];
  const configuredCount = providers.filter(provider => provider?.hasApiKey === true).length;
  const enabledCount = providers.filter(
    provider => provider?.enabled === true && provider.hasApiKey === true,
  ).length;

  return {
    configuredCount,
    enabledCount,
    totalCount: providers.length,
    configured: enabledCount > 0,
  };
};

export const getSkillsResearchCapabilityCards = (): SkillsResearchCapabilityCard[] => [
  {
    kind: SkillsResearchCapabilityKind.ExternalResearch,
    titleKey: 'skillsResearchExternalTitle',
    descriptionKey: 'skillsResearchExternalDesc',
    statusKey: 'skillsResearchExternalStatus',
    listCard: true,
    managedAsSkill: false,
    toolNames: ['lobsterai_external_research_search', 'lobsterai_external_research_extract'],
    configSchema: externalResearchCapabilityConfigSchema,
    actionLabelKey: 'skillsResearchExternalAction',
    actionTarget: SkillsResearchCapabilityActionTarget.ExternalResearchSettings,
  },
  {
    kind: SkillsResearchCapabilityKind.Browser,
    titleKey: 'skillsResearchBrowserTitle',
    descriptionKey: 'skillsResearchBrowserDesc',
    statusKey: 'skillsResearchBrowserStatus',
    listCard: true,
    managedAsSkill: false,
    toolNames: ['browser'],
    actionLabelKey: 'skillsResearchBrowserAction',
    actionTarget: SkillsResearchCapabilityActionTarget.BrowserSettings,
  },
];
