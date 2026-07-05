import {
  type ExternalResearchProviderConfig,
  ExternalResearchProviderIds,
} from '@shared/agent/externalResearch';
import {
  EnterpriseLeadContentDeliveryMode,
  EnterpriseLeadContentOutputPlatformId,
  EnterpriseLeadContentOutputPlatformIds,
} from '@shared/enterpriseLeadWorkspace/constants';
import type { ProviderConfig } from '@shared/providers';

import type {
  EnterpriseLeadWorkspaceContentPlatformConfig,
  EnterpriseLeadWorkspaceSettings,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { EnterpriseLeadWorkbenchStatusTone } from './enterpriseLeadWorkspaceUi';

export interface WorkspaceSettingsReadinessItem {
  id: 'model' | 'research' | 'content';
  titleKey: string;
  descriptionKey: string;
  statusKey: string;
  tone: typeof EnterpriseLeadWorkbenchStatusTone[keyof typeof EnterpriseLeadWorkbenchStatusTone];
}

export interface WorkspaceSettingConnectionStatus {
  ready: boolean;
  statusKey: string;
  tone: typeof EnterpriseLeadWorkbenchStatusTone[keyof typeof EnterpriseLeadWorkbenchStatusTone];
}

export interface WorkspaceSettingsBlockingIssue {
  id: string;
  statusKey: string;
  tone: typeof EnterpriseLeadWorkbenchStatusTone[keyof typeof EnterpriseLeadWorkbenchStatusTone];
}

const localProviderKeys = new Set(['ollama', 'lm-studio']);

const hasText = (value: string): boolean => value.trim().length > 0;

const getContentPlatformMissingStatusKey = (
  platform: EnterpriseLeadWorkspaceContentPlatformConfig,
): string | null => {
  if (platform.id === EnterpriseLeadContentOutputPlatformId.XiaohongshuDraft) {
    if (
      platform.deliveryMode === EnterpriseLeadContentDeliveryMode.DraftOnly
      || platform.deliveryMode === EnterpriseLeadContentDeliveryMode.MarkdownExport
    ) {
      return null;
    }
    if (!hasText(platform.endpoint)) {
      return 'enterpriseLeadWorkbenchContentPlatformMissingEndpoint';
    }
    if (!hasText(platform.token)) {
      return 'enterpriseLeadWorkbenchContentPlatformMissingToken';
    }
    return null;
  }

  if (platform.id === EnterpriseLeadContentOutputPlatformId.SalesMessage) {
    if (platform.deliveryMode === EnterpriseLeadContentDeliveryMode.SmsTemplate) {
      return null;
    }
    return hasText(platform.endpoint)
      ? null
      : 'enterpriseLeadWorkbenchContentPlatformMissingEndpoint';
  }

  if (platform.id === EnterpriseLeadContentOutputPlatformId.WechatArticle) {
    if (platform.deliveryMode === EnterpriseLeadContentDeliveryMode.MarkdownExport) {
      return null;
    }
    return hasText(platform.appId) && hasText(platform.token)
      ? null
      : 'enterpriseLeadWorkbenchContentPlatformMissingSecret';
  }

  if (platform.id === EnterpriseLeadContentOutputPlatformId.CustomWebhook) {
    return hasText(platform.endpoint)
      ? null
      : 'enterpriseLeadWorkbenchContentPlatformMissingWebhook';
  }

  return hasText(platform.endpoint) || hasText(platform.token)
    ? null
    : 'enterpriseLeadWorkbenchContentPlatformMissingEndpoint';
};

export const isContentPlatformConfigured = (
  platform: EnterpriseLeadWorkspaceContentPlatformConfig,
): boolean => getContentPlatformMissingStatusKey(platform) === null;

export const getModelProviderConnectionStatus = (
  providerKey: string,
  provider: ProviderConfig | undefined,
): WorkspaceSettingConnectionStatus => {
  if (!provider?.enabled) {
    return {
      ready: false,
      statusKey: 'enterpriseLeadWorkbenchStatusDisabled',
      tone: EnterpriseLeadWorkbenchStatusTone.Disabled,
    };
  }

  const hasModel = (provider.models ?? []).some(model => model.id.trim());
  const hasBaseUrl = provider.baseUrl.trim().length > 0;
  const hasCredential = provider.apiKey.trim().length > 0 || localProviderKeys.has(providerKey);
  if (!hasBaseUrl) {
    return {
      ready: false,
      statusKey: 'enterpriseLeadWorkbenchProviderMissingBaseUrl',
      tone: EnterpriseLeadWorkbenchStatusTone.Warning,
    };
  }
  if (!hasCredential) {
    return {
      ready: false,
      statusKey: 'enterpriseLeadWorkbenchProviderMissingApiKey',
      tone: EnterpriseLeadWorkbenchStatusTone.Warning,
    };
  }
  if (!hasModel) {
    return {
      ready: false,
      statusKey: 'enterpriseLeadWorkbenchProviderMissingModel',
      tone: EnterpriseLeadWorkbenchStatusTone.Warning,
    };
  }

  return {
    ready: true,
    statusKey: 'enterpriseLeadWorkbenchStatusConfigured',
    tone: EnterpriseLeadWorkbenchStatusTone.Configured,
  };
};

export const getExternalResearchProviderConnectionStatus = (
  provider: ExternalResearchProviderConfig,
): WorkspaceSettingConnectionStatus => {
  if (!provider.enabled) {
    return {
      ready: false,
      statusKey: 'enterpriseLeadWorkbenchStatusDisabled',
      tone: EnterpriseLeadWorkbenchStatusTone.Disabled,
    };
  }

  if (!provider.apiKey.trim()) {
    return {
      ready: false,
      statusKey: 'enterpriseLeadWorkbenchResearchMissingApiKey',
      tone: EnterpriseLeadWorkbenchStatusTone.Warning,
    };
  }

  return {
    ready: true,
    statusKey: 'enterpriseLeadWorkbenchStatusConfigured',
    tone: EnterpriseLeadWorkbenchStatusTone.Configured,
  };
};

export const getContentPlatformConnectionStatus = (
  platform: EnterpriseLeadWorkspaceContentPlatformConfig,
): WorkspaceSettingConnectionStatus => {
  if (!platform.enabled) {
    return {
      ready: false,
      statusKey: 'enterpriseLeadWorkbenchStatusDisabled',
      tone: EnterpriseLeadWorkbenchStatusTone.Disabled,
    };
  }

  const missingStatusKey = getContentPlatformMissingStatusKey(platform);
  if (!missingStatusKey) {
    return {
      ready: true,
      statusKey: 'enterpriseLeadWorkbenchStatusConfigured',
      tone: EnterpriseLeadWorkbenchStatusTone.Configured,
    };
  }

  return {
    ready: false,
    statusKey: missingStatusKey,
    tone: EnterpriseLeadWorkbenchStatusTone.Warning,
  };
};

const hasReadyExternalResearch = (settings: EnterpriseLeadWorkspaceSettings): boolean =>
  ExternalResearchProviderIds.some(providerId => {
    const provider = settings.externalResearch.providers[providerId];
    return getExternalResearchProviderConnectionStatus(provider).ready;
  });

const hasReadyContentPlatform = (settings: EnterpriseLeadWorkspaceSettings): boolean => {
  const defaultPlatform = settings.contentPlatforms.platforms[
    settings.contentPlatforms.outputRules.defaultPlatformId
  ];
  if (defaultPlatform) {
    return getContentPlatformConnectionStatus(defaultPlatform).ready;
  }

  return EnterpriseLeadContentOutputPlatformIds.some(platformId => {
    const platform = settings.contentPlatforms.platforms[platformId];
    return Boolean(platform && getContentPlatformConnectionStatus(platform).ready);
  });
};

const shouldBlockContentPlatformSave = (
  platform: EnterpriseLeadWorkspaceContentPlatformConfig,
): boolean => platform.enabled && getContentPlatformMissingStatusKey(platform) !== null;

const isWorkspaceDefaultModelAvailable = (
  settings: EnterpriseLeadWorkspaceSettings,
): boolean => {
  const providerKey = settings.model.defaultModelProvider.trim();
  const modelId = settings.model.defaultModel.trim();
  if (!providerKey || !modelId) {
    return false;
  }

  const provider = settings.model.providers[providerKey];
  if (!getModelProviderConnectionStatus(providerKey, provider).ready) {
    return false;
  }

  return provider?.models?.some(model => model.id.trim() === modelId) === true;
};

const getDefaultModelBlockingIssue = (
  settings: EnterpriseLeadWorkspaceSettings,
): WorkspaceSettingsBlockingIssue | null => {
  const providerKey = settings.model.defaultModelProvider.trim();
  const modelId = settings.model.defaultModel.trim();
  if (!providerKey && !modelId) {
    return null;
  }

  const provider = settings.model.providers[providerKey];
  const providerStatus = getModelProviderConnectionStatus(providerKey, provider);
  const providerModels = provider?.models ?? [];
  const hasProviderModel = providerModels.some(model => model.id.trim().length > 0);
  if (hasProviderModel && !providerModels.some(model => model.id.trim() === modelId)) {
    return {
      id: 'model:default',
      statusKey: 'enterpriseLeadWorkbenchDefaultModelUnavailable',
      tone: EnterpriseLeadWorkbenchStatusTone.Warning,
    };
  }

  if (!providerStatus.ready && providerStatus.tone === EnterpriseLeadWorkbenchStatusTone.Warning) {
    return null;
  }

  if (isWorkspaceDefaultModelAvailable(settings)) {
    return null;
  }

  return {
    id: 'model:default',
    statusKey: 'enterpriseLeadWorkbenchDefaultModelUnavailable',
    tone: EnterpriseLeadWorkbenchStatusTone.Warning,
  };
};

export const getWorkspaceSettingsBlockingIssues = (
  settings: EnterpriseLeadWorkspaceSettings,
): WorkspaceSettingsBlockingIssue[] => {
  const defaultModelIssue = getDefaultModelBlockingIssue(settings);
  const modelIssues = Object.entries(settings.model.providers)
    .map(([providerKey, provider]) => ({
      id: `model:${providerKey}`,
      ...getModelProviderConnectionStatus(providerKey, provider),
    }))
    .filter(issue => !issue.ready && issue.tone === EnterpriseLeadWorkbenchStatusTone.Warning);

  const researchIssues = ExternalResearchProviderIds
    .map(providerId => ({
      id: `research:${providerId}`,
      ...getExternalResearchProviderConnectionStatus(settings.externalResearch.providers[providerId]),
    }))
    .filter(issue => !issue.ready && issue.tone === EnterpriseLeadWorkbenchStatusTone.Warning);

  const contentIssues = EnterpriseLeadContentOutputPlatformIds
    .map(platformId => settings.contentPlatforms.platforms[platformId])
    .filter((platform): platform is EnterpriseLeadWorkspaceContentPlatformConfig =>
      Boolean(platform && shouldBlockContentPlatformSave(platform)))
    .map(platform => ({
      id: `content:${platform.id}`,
      ...getContentPlatformConnectionStatus(platform),
    }))
    .filter(issue => !issue.ready && issue.tone === EnterpriseLeadWorkbenchStatusTone.Warning);

  return [
    ...(defaultModelIssue ? [defaultModelIssue] : []),
    ...modelIssues,
    ...researchIssues,
    ...contentIssues,
  ];
};

export const getWorkspaceSettingsReadiness = (
  settings: EnterpriseLeadWorkspaceSettings,
): WorkspaceSettingsReadinessItem[] => {
  const defaultProvider = settings.model.defaultModelProvider
    ? settings.model.providers[settings.model.defaultModelProvider]
    : undefined;
  const modelReady = isWorkspaceDefaultModelAvailable(settings)
    && Boolean(defaultProvider);
  const researchReady = hasReadyExternalResearch(settings);
  const contentReady = hasReadyContentPlatform(settings);

  return [
    {
      id: 'model',
      titleKey: 'enterpriseLeadWorkspaceSettingsReadinessModel',
      descriptionKey: modelReady
        ? 'enterpriseLeadWorkspaceSettingsReadinessModelReadyDesc'
        : 'enterpriseLeadWorkspaceSettingsReadinessModelSetupDesc',
      statusKey: modelReady
        ? 'enterpriseLeadWorkspaceSettingsReady'
        : 'enterpriseLeadWorkspaceSettingsNeedsSetup',
      tone: modelReady
        ? EnterpriseLeadWorkbenchStatusTone.Configured
        : EnterpriseLeadWorkbenchStatusTone.Warning,
    },
    {
      id: 'research',
      titleKey: 'enterpriseLeadWorkspaceSettingsReadinessResearch',
      descriptionKey: researchReady
        ? 'enterpriseLeadWorkspaceSettingsReadinessResearchReadyDesc'
        : 'enterpriseLeadWorkspaceSettingsReadinessResearchSetupDesc',
      statusKey: researchReady
        ? 'enterpriseLeadWorkspaceSettingsReady'
        : 'enterpriseLeadWorkspaceSettingsNeedsSetup',
      tone: researchReady
        ? EnterpriseLeadWorkbenchStatusTone.Configured
        : EnterpriseLeadWorkbenchStatusTone.Warning,
    },
    {
      id: 'content',
      titleKey: 'enterpriseLeadWorkspaceSettingsReadinessContent',
      descriptionKey: contentReady
        ? 'enterpriseLeadWorkspaceSettingsReadinessContentReadyDesc'
        : 'enterpriseLeadWorkspaceSettingsReadinessContentSetupDesc',
      statusKey: contentReady
        ? 'enterpriseLeadWorkspaceSettingsReady'
        : 'enterpriseLeadWorkspaceSettingsNeedsSetup',
      tone: contentReady
        ? EnterpriseLeadWorkbenchStatusTone.Configured
        : EnterpriseLeadWorkbenchStatusTone.Warning,
    },
  ];
};

export const isWorkspaceSettingReady = (
  settings: EnterpriseLeadWorkspaceSettings,
  readinessId: WorkspaceSettingsReadinessItem['id'],
): boolean => getWorkspaceSettingsReadiness(settings).some(item =>
  item.id === readinessId && item.statusKey === 'enterpriseLeadWorkspaceSettingsReady');
