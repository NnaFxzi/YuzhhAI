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
  actionLabelKey?: string;
  actionTarget?: SkillsResearchCapabilityActionTarget;
}

export const getSkillsResearchCapabilityCards = (): SkillsResearchCapabilityCard[] => [
  {
    kind: SkillsResearchCapabilityKind.ExternalResearch,
    titleKey: 'skillsResearchExternalTitle',
    descriptionKey: 'skillsResearchExternalDesc',
    statusKey: 'skillsResearchExternalStatus',
    listCard: true,
    managedAsSkill: false,
    toolNames: ['lobsterai_external_research_search', 'lobsterai_external_research_extract'],
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
