export const SkillsManagerTab = {
  Research: 'research',
  Installed: 'installed',
  Marketplace: 'marketplace',
} as const;

export type SkillsManagerTab = (typeof SkillsManagerTab)[keyof typeof SkillsManagerTab];

export const getSkillsManagerTabs = (): SkillsManagerTab[] => [
  SkillsManagerTab.Installed,
  SkillsManagerTab.Marketplace,
  SkillsManagerTab.Research,
];

export const getDefaultSkillsManagerTab = (): SkillsManagerTab => SkillsManagerTab.Installed;

export const getSkillsManagerTabLabelKey = (tab: SkillsManagerTab): string => {
  switch (tab) {
    case SkillsManagerTab.Research:
      return 'skillsResearchCapabilitiesTitle';
    case SkillsManagerTab.Installed:
      return 'skillInstalled';
    case SkillsManagerTab.Marketplace:
      return 'skillMarketplace';
  }
};
