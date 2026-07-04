import {
  type DomesticResearchConfig,
  DomesticResearchMode,
  DomesticResearchSourceIds,
} from '@shared/agent/domesticResearch';

export const DomesticResearchBulkAction = {
  Recommended: 'recommended',
  EnableAll: 'enableAll',
  DisableAll: 'disableAll',
} as const;

export type DomesticResearchBulkAction =
  typeof DomesticResearchBulkAction[keyof typeof DomesticResearchBulkAction];

export interface DomesticResearchSourceCount {
  enabled: number;
  total: number;
}

export const getDomesticResearchSourceCount = (
  config: DomesticResearchConfig,
): DomesticResearchSourceCount => {
  const customSources = config.customSources ?? [];
  const enabled = DomesticResearchSourceIds.filter(sourceId => config.sources[sourceId].enabled).length
    + customSources.filter(source => source.enabled).length;
  return {
    enabled,
    total: DomesticResearchSourceIds.length + customSources.length,
  };
};

const shouldEnableRecommendedSource = (
  config: DomesticResearchConfig,
  sourceId: typeof DomesticResearchSourceIds[number],
): boolean => config.sources[sourceId].modes.includes(DomesticResearchMode.Search);

export const applyDomesticResearchBulkAction = (
  config: DomesticResearchConfig,
  action: DomesticResearchBulkAction,
): DomesticResearchConfig => {
  const customSources = config.customSources ?? [];
  return {
    ...config,
    sources: DomesticResearchSourceIds.reduce((sources, sourceId) => ({
      ...sources,
      [sourceId]: {
        ...config.sources[sourceId],
        enabled: action === DomesticResearchBulkAction.Recommended
          ? shouldEnableRecommendedSource(config, sourceId)
          : action === DomesticResearchBulkAction.EnableAll,
      },
    }), config.sources),
    customSources: action === DomesticResearchBulkAction.Recommended
      ? customSources
      : customSources.map(source => ({
        ...source,
        enabled: action === DomesticResearchBulkAction.EnableAll,
      })),
  };
};
