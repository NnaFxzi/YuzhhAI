import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import {
  DomesticResearchMode,
  type DomesticResearchMode as DomesticResearchModeValue,
  DomesticResearchSourceId,
  type DomesticResearchSourceId as DomesticResearchSourceIdValue,
  DomesticResearchSourceIds,
} from '@shared/agent/domesticResearch';
import {
  ExternalResearchProviderId,
  type ExternalResearchProviderId as ExternalResearchProviderIdValue,
  ExternalResearchProviderIds,
} from '@shared/agent/externalResearch';
import {
  EnterpriseLeadContentOutputLengthPolicy,
  EnterpriseLeadContentOutputPlatformId,
  type EnterpriseLeadContentOutputPlatformId as EnterpriseLeadContentOutputPlatformIdValue,
  EnterpriseLeadContentOutputPlatformIds,
} from '@shared/enterpriseLeadWorkspace/constants';
import { ApiFormat, type ProviderConfig } from '@shared/providers';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceContentPlatformConfig,
  EnterpriseLeadWorkspaceSettings,
} from '../../../shared/enterpriseLeadWorkspace/types';
import {
  normalizeEnterpriseLeadWorkspaceSettings,
} from '../../../shared/enterpriseLeadWorkspace/validation';
import {
  defaultConfig,
  getProviderDisplayName,
  getVisibleProviders,
  isCustomProvider,
} from '../../config';
import { agentService } from '../../services/agent';
import { configService } from '../../services/config';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import type { RootState } from '../../store';
import { setSkills } from '../../store/slices/skillSlice';
import type { Skill } from '../../types/skill';
import {
  type ExternalResearchTestResult,
  getExternalResearchTestFeedback,
} from '../agent/agentExternalResearchUi';
import {
  buildOpenAICompatibleChatCompletionsUrl,
  buildOpenAIResponsesUrl,
  CONNECTIVITY_TEST_TOKEN_BUDGET,
  shouldUseMaxCompletionTokensForOpenAI,
  shouldUseOpenAIResponsesForProvider,
} from '../settings/modelProviderUtils';
import { EnterpriseLeadWorkbenchStatusTone } from './enterpriseLeadWorkspaceUi';
import {
  getContentPlatformConnectionStatus,
  getExternalResearchProviderConnectionStatus,
  getModelProviderConnectionStatus,
  getWorkspaceSettingsBlockingIssues,
} from './workspaceSettingsReadiness';

export { getWorkspaceSettingsReadiness } from './workspaceSettingsReadiness';

interface WorkspaceSettingsProps {
  workspace: EnterpriseLeadWorkspace;
  onWorkspaceUpdated?: (workspace: EnterpriseLeadWorkspace) => void;
}

interface WorkspaceModelConnectionTestResult {
  providerKey: string;
  success: boolean;
  message: string;
}

interface WorkspaceDefaultModelOption {
  value: string;
  providerKey: string;
  modelId: string;
  label: string;
}

const statusBadgeClassNames: Record<string, string> = {
  [EnterpriseLeadWorkbenchStatusTone.Enabled]:
    'bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300',
  [EnterpriseLeadWorkbenchStatusTone.Warning]:
    'bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-300',
  [EnterpriseLeadWorkbenchStatusTone.Disabled]:
    'bg-slate-500/10 text-slate-500 ring-1 ring-slate-500/15 dark:text-slate-300',
  [EnterpriseLeadWorkbenchStatusTone.Configured]:
    'bg-primary/10 text-primary ring-1 ring-primary/20',
  [EnterpriseLeadWorkbenchStatusTone.Unconfigured]:
    'bg-slate-500/10 text-slate-500 ring-1 ring-slate-500/15 dark:text-slate-300',
};

const sourceLabelKeys: Record<DomesticResearchSourceIdValue, string> = {
  [DomesticResearchSourceId.Xiaohongshu]: 'agentDomesticResearchSourceXiaohongshu',
  [DomesticResearchSourceId.Douyin]: 'agentDomesticResearchSourceDouyin',
  [DomesticResearchSourceId.Kuaishou]: 'agentDomesticResearchSourceKuaishou',
  [DomesticResearchSourceId.WeChatChannels]: 'agentDomesticResearchSourceWeChatChannels',
  [DomesticResearchSourceId.Bilibili]: 'agentDomesticResearchSourceBilibili',
  [DomesticResearchSourceId.WeChatOfficialAccounts]: 'agentDomesticResearchSourceWeChatOfficialAccounts',
};

const providerLabelKeys: Record<ExternalResearchProviderIdValue, string> = {
  [ExternalResearchProviderId.Tavily]: 'agentExternalResearchTavily',
  [ExternalResearchProviderId.Firecrawl]: 'agentExternalResearchFirecrawl',
};

const ResearchQuickMode = {
  LocalOnly: 'local_only',
  WebSearch: 'web_search',
  WebCrawl: 'web_crawl',
} as const;
type ResearchQuickMode = typeof ResearchQuickMode[keyof typeof ResearchQuickMode];

const SkillPresetId = {
  AcquisitionContent: 'acquisition_content',
  ResearchAnalysis: 'research_analysis',
  LightweightChat: 'lightweight_chat',
} as const;
type SkillPresetId = typeof SkillPresetId[keyof typeof SkillPresetId];

interface SkillPresetDefinition {
  id: SkillPresetId;
  titleKey: string;
  descriptionKey: string;
  skillIds: string[];
}

const skillPresetDefinitions: SkillPresetDefinition[] = [
  {
    id: SkillPresetId.AcquisitionContent,
    titleKey: 'enterpriseLeadWorkbenchSkillPresetAcquisitionContent',
    descriptionKey: 'enterpriseLeadWorkbenchSkillPresetAcquisitionContentDesc',
    skillIds: ['article-writer', 'content-planner', 'web-search', 'xlsx', 'risk-review'],
  },
  {
    id: SkillPresetId.ResearchAnalysis,
    titleKey: 'enterpriseLeadWorkbenchSkillPresetResearchAnalysis',
    descriptionKey: 'enterpriseLeadWorkbenchSkillPresetResearchAnalysisDesc',
    skillIds: ['web-search', 'technology-search', 'xlsx'],
  },
  {
    id: SkillPresetId.LightweightChat,
    titleKey: 'enterpriseLeadWorkbenchSkillPresetLightweightChat',
    descriptionKey: 'enterpriseLeadWorkbenchSkillPresetLightweightChatDesc',
    skillIds: ['docx', 'xlsx'],
  },
];

const contentPlatformLabelKeys: Record<EnterpriseLeadContentOutputPlatformIdValue, string> = {
  [EnterpriseLeadContentOutputPlatformId.XiaohongshuDraft]:
    'enterpriseLeadWorkbenchContentPlatformXiaohongshuDraft',
  [EnterpriseLeadContentOutputPlatformId.SalesMessage]:
    'enterpriseLeadWorkbenchContentPlatformSalesMessage',
  [EnterpriseLeadContentOutputPlatformId.WechatArticle]:
    'enterpriseLeadWorkbenchContentPlatformWechatArticle',
  [EnterpriseLeadContentOutputPlatformId.CustomWebhook]:
    'enterpriseLeadWorkbenchContentPlatformCustomWebhook',
};

const contentPlatformDescKeys: Record<EnterpriseLeadContentOutputPlatformIdValue, string> = {
  [EnterpriseLeadContentOutputPlatformId.XiaohongshuDraft]:
    'enterpriseLeadWorkbenchContentPlatformXiaohongshuDraftDesc',
  [EnterpriseLeadContentOutputPlatformId.SalesMessage]:
    'enterpriseLeadWorkbenchContentPlatformSalesMessageDesc',
  [EnterpriseLeadContentOutputPlatformId.WechatArticle]:
    'enterpriseLeadWorkbenchContentPlatformWechatArticleDesc',
  [EnterpriseLeadContentOutputPlatformId.CustomWebhook]:
    'enterpriseLeadWorkbenchContentPlatformCustomWebhookDesc',
};

const cloneProviders = (providers: Record<string, ProviderConfig> | undefined): Record<string, ProviderConfig> =>
  JSON.parse(JSON.stringify(providers ?? {})) as Record<string, ProviderConfig>;

const fallbackProviderConfig = (providerKey: string): ProviderConfig => ({
  enabled: false,
  apiKey: '',
  baseUrl: defaultConfig.providers?.[providerKey]?.baseUrl ?? '',
  apiFormat: defaultConfig.providers?.[providerKey]?.apiFormat ?? ApiFormat.OpenAI,
  models: defaultConfig.providers?.[providerKey]?.models?.map(model => ({ ...model })) ?? [],
});

const getNextCustomProviderKey = (providers: Record<string, ProviderConfig>): string => {
  let index = 0;
  while (providers[`custom_${index}`]) {
    index += 1;
  }
  return `custom_${index}`;
};

const getCustomProviderDisplayIndex = (providerKey: string): number => {
  const match = providerKey.match(/^custom_(\d+)$/);
  const index = match ? Number.parseInt(match[1] ?? '0', 10) : 0;
  return Number.isFinite(index) && index >= 0 ? index + 1 : 1;
};

const buildCustomProviderConfig = (providerKey: string): ProviderConfig => ({
  enabled: true,
  apiKey: '',
  baseUrl: '',
  apiFormat: ApiFormat.OpenAI,
  displayName: `${i18nService.t('enterpriseLeadWorkbenchCustomModelProvider')} ${getCustomProviderDisplayIndex(providerKey)}`,
  models: [],
});

const encodeDefaultModelOption = (providerKey: string, modelId: string): string =>
  JSON.stringify([providerKey, modelId]);

const decodeDefaultModelOption = (
  value: string,
): { providerKey: string; modelId: string } | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) {
      return null;
    }
    const [providerKey, modelId] = parsed;
    return typeof providerKey === 'string' && typeof modelId === 'string'
      ? { providerKey, modelId }
      : null;
  } catch {
    return null;
  }
};

export const buildEnterpriseLeadWorkspaceSettingsFromCurrentConfig = (): EnterpriseLeadWorkspaceSettings => {
  const config = configService.getConfig();
  return normalizeEnterpriseLeadWorkspaceSettings({
    model: {
      defaultModel: config.model.defaultModel,
      defaultModelProvider: config.model.defaultModelProvider ?? '',
      providers: cloneProviders(config.providers),
    },
  });
};

const ensureWorkspaceSettingsHaveProviders = (
  settings: EnterpriseLeadWorkspaceSettings,
): EnterpriseLeadWorkspaceSettings => {
  if (Object.keys(settings.model.providers).length > 0) {
    return settings;
  }
  const initial = buildEnterpriseLeadWorkspaceSettingsFromCurrentConfig();
  return normalizeEnterpriseLeadWorkspaceSettings({
    ...settings,
    model: initial.model,
  });
};

const getFirstModelId = (provider?: ProviderConfig): string =>
  provider?.models?.find(model => model.id.trim())?.id.trim() ?? '';

const getProviderKeysForDisplay = (
  providers: Record<string, ProviderConfig>,
): string[] => {
  const language = i18nService.getLanguage();
  const visibleKeys = getVisibleProviders(language).filter(providerKey => providers[providerKey]);
  const configuredKeys = Object.keys(providers).sort();
  return Array.from(new Set([...visibleKeys, ...configuredKeys]));
};

const getInitialActiveProviderKey = (
  settings: EnterpriseLeadWorkspaceSettings,
): string => Object.keys(settings.model.providers).find(providerKey =>
  settings.model.providers[providerKey].enabled)
  ?? getProviderKeysForDisplay(settings.model.providers)[0]
  ?? '';

const buildGeminiGenerateContentUrl = (baseUrl: string, modelId: string): string => {
  const normalized = baseUrl.trim().replace(/\/+$/, '') || 'https://generativelanguage.googleapis.com/v1beta';
  return `${normalized}/models/${modelId}:generateContent`;
};

const testWorkspaceModelProviderConnection = async (
  providerKey: string,
  provider: ProviderConfig,
): Promise<{ success: boolean; message: string }> => {
  const providerStatus = getModelProviderConnectionStatus(providerKey, provider);
  if (!providerStatus.ready) {
    return {
      success: false,
      message: i18nService.t(providerStatus.statusKey),
    };
  }

  const modelId = getFirstModelId(provider);
  const apiFormat = provider.apiFormat ?? ApiFormat.OpenAI;
  const baseUrl = provider.baseUrl.trim().replace(/\/+$/, '');
  let response: Awaited<ReturnType<typeof window.electron.api.fetch>>;

  if (apiFormat === ApiFormat.Anthropic) {
    const anthropicUrl = baseUrl.endsWith('/v1')
      ? `${baseUrl}/messages`
      : `${baseUrl}/v1/messages`;
    response = await window.electron.api.fetch({
      url: anthropicUrl,
      method: 'POST',
      headers: {
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: CONNECTIVITY_TEST_TOKEN_BUDGET,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });
  } else if (apiFormat === ApiFormat.Gemini) {
    response = await window.electron.api.fetch({
      url: buildGeminiGenerateContentUrl(baseUrl, modelId),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': provider.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
        generationConfig: { maxOutputTokens: CONNECTIVITY_TEST_TOKEN_BUDGET },
      }),
    });
  } else {
    const useResponsesApi = shouldUseOpenAIResponsesForProvider(providerKey);
    const openaiUrl = useResponsesApi
      ? buildOpenAIResponsesUrl(baseUrl)
      : buildOpenAICompatibleChatCompletionsUrl(baseUrl, providerKey);
    const body: Record<string, unknown> = useResponsesApi
      ? {
        model: modelId,
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
        max_output_tokens: CONNECTIVITY_TEST_TOKEN_BUDGET,
      }
      : {
        model: modelId,
        messages: [{ role: 'user', content: 'Hi' }],
      };
    if (!useResponsesApi) {
      if (shouldUseMaxCompletionTokensForOpenAI(providerKey, modelId)) {
        body.max_completion_tokens = CONNECTIVITY_TEST_TOKEN_BUDGET;
      } else {
        body.max_tokens = CONNECTIVITY_TEST_TOKEN_BUDGET;
      }
    }
    response = await window.electron.api.fetch({
      url: openaiUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(provider.apiKey.trim() ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  if (response.ok) {
    return {
      success: true,
      message: i18nService.t('connectionSuccess'),
    };
  }

  const data = response.data ?? {};
  const message = data.error?.message
    || data.message
    || `${i18nService.t('connectionFailed')}: ${response.status}`;
  return {
    success: false,
    message,
  };
};

const sortSkillsForWorkspace = (skills: Skill[], selectedSkillIds: string[]): Skill[] => {
  const selected = new Set(selectedSkillIds);
  return [...skills].sort((left, right) => {
    const leftSelected = selected.has(left.id);
    const rightSelected = selected.has(right.id);
    if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
    if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
};

interface SaveWorkspaceSettingsDraftOptions {
  workspaceId: string;
  draftSettings: EnterpriseLeadWorkspaceSettings;
  isCurrentSave: () => boolean;
  onSaved: (workspace: EnterpriseLeadWorkspace) => void;
  onError: () => void;
}

export const saveWorkspaceSettingsDraft = async ({
  workspaceId,
  draftSettings,
  isCurrentSave,
  onSaved,
  onError,
}: SaveWorkspaceSettingsDraftOptions): Promise<void> => {
  try {
    const updated = await enterpriseLeadWorkspaceService.updateWorkspaceSettings(workspaceId, {
      settings: draftSettings,
    });
    if (!isCurrentSave()) {
      return;
    }
    if (!updated) {
      onError();
      return;
    }
    onSaved({
      ...updated,
      settings: ensureWorkspaceSettingsHaveProviders(updated.settings),
    });
  } catch {
    if (isCurrentSave()) {
      onError();
    }
  }
};

export const WorkspaceSettings: React.FC<WorkspaceSettingsProps> = ({
  workspace,
  onWorkspaceUpdated,
}) => {
  const workspaceIdRef = useRef(workspace.id);
  const saveSequenceRef = useRef(0);
  workspaceIdRef.current = workspace.id;
  const dispatch = useDispatch();
  const skills = useSelector((state: RootState) => state.skill.skills);
  const initialSettings = useMemo(
    () => ensureWorkspaceSettingsHaveProviders(workspace.settings),
    [workspace.settings],
  );
  const [draftSettings, setDraftSettings] = useState<EnterpriseLeadWorkspaceSettings>(initialSettings);
  const [savedSettings, setSavedSettings] = useState<EnterpriseLeadWorkspaceSettings>(initialSettings);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [activeProviderKey, setActiveProviderKey] = useState(() => getInitialActiveProviderKey(initialSettings));
  const [shownSecrets, setShownSecrets] = useState<Record<string, boolean>>({});
  const [modelTestingProviderKey, setModelTestingProviderKey] = useState('');
  const [modelTestResult, setModelTestResult] = useState<WorkspaceModelConnectionTestResult | null>(null);
  const [researchTesting, setResearchTesting] = useState<Record<string, boolean>>({});
  const [researchTestResults, setResearchTestResults] = useState<Record<string, ExternalResearchTestResult>>({});
  const [selectedSkillPresetId, setSelectedSkillPresetId] = useState<SkillPresetId>(SkillPresetId.AcquisitionContent);

  useEffect(() => {
    let cancelled = false;
    void skillService.loadSkills()
      .then(loadedSkills => {
        if (!cancelled) {
          dispatch(setSkills(loadedSkills));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  useEffect(() => {
    setDraftSettings(initialSettings);
    setSavedSettings(initialSettings);
    setSaveState('idle');
    setModelTestingProviderKey('');
    setModelTestResult(null);
    setResearchTesting({});
    setResearchTestResults({});
    setActiveProviderKey(previous => (
      previous && initialSettings.model.providers[previous]
        ? previous
        : Object.keys(initialSettings.model.providers).find(providerKey =>
          initialSettings.model.providers[providerKey].enabled)
          ?? Object.keys(initialSettings.model.providers)[0]
          ?? ''
    ));
  }, [initialSettings, workspace.id]);

  const providerKeys = useMemo(
    () => getProviderKeysForDisplay(draftSettings.model.providers),
    [draftSettings.model.providers],
  );
  const defaultModelOptions = useMemo<WorkspaceDefaultModelOption[]>(
    () => providerKeys.flatMap(providerKey => {
      const provider = draftSettings.model.providers[providerKey];
      if (!getModelProviderConnectionStatus(providerKey, provider).ready) {
        return [];
      }
      return (provider.models ?? [])
        .map(model => ({
          modelId: model.id.trim(),
          modelName: model.name.trim() || model.id.trim(),
        }))
        .filter(model => model.modelId.length > 0)
        .map(model => ({
          value: encodeDefaultModelOption(providerKey, model.modelId),
          providerKey,
          modelId: model.modelId,
          label: `${getProviderDisplayName(providerKey, provider)} / ${model.modelName}`,
        }));
    }),
    [draftSettings.model.providers, providerKeys],
  );
  const selectedDefaultModelValue = defaultModelOptions.some(option =>
    option.providerKey === draftSettings.model.defaultModelProvider
    && option.modelId === draftSettings.model.defaultModel)
    ? encodeDefaultModelOption(
      draftSettings.model.defaultModelProvider,
      draftSettings.model.defaultModel,
    )
    : '';
  const activeProvider = activeProviderKey
    ? draftSettings.model.providers[activeProviderKey]
    : undefined;
  const activeProviderModels = activeProvider?.models ?? [];
  const activeProviderStatus = activeProviderKey && activeProvider
    ? getModelProviderConnectionStatus(activeProviderKey, activeProvider)
    : null;
  const activeModelTestResult = modelTestResult?.providerKey === activeProviderKey
    ? modelTestResult
    : null;
  const isTestingActiveModelProvider = modelTestingProviderKey === activeProviderKey;
  const orderedSkills = useMemo(
    () => sortSkillsForWorkspace(skills, draftSettings.skillIds),
    [draftSettings.skillIds, skills],
  );
  const blockingIssues = useMemo(
    () => getWorkspaceSettingsBlockingIssues(draftSettings),
    [draftSettings],
  );
  const firstBlockingIssue = blockingIssues[0] ?? null;
  const isDirty = JSON.stringify(draftSettings) !== JSON.stringify(savedSettings);
  const canSaveSettings = isDirty && saveState !== 'saving' && blockingIssues.length === 0;
  const selectedResearchProviderId = ExternalResearchProviderIds.find(providerId =>
    draftSettings.externalResearch.providers[providerId]?.enabled) ?? '';
  const selectedResearchProvider = selectedResearchProviderId
    ? draftSettings.externalResearch.providers[selectedResearchProviderId]
    : null;
  const selectedResearchProviderTestResult = selectedResearchProviderId
    ? researchTestResults[selectedResearchProviderId]
    : undefined;
  const selectedResearchQuickMode: ResearchQuickMode = selectedResearchProviderId === ExternalResearchProviderId.Tavily
    ? ResearchQuickMode.WebSearch
    : selectedResearchProviderId === ExternalResearchProviderId.Firecrawl
      ? ResearchQuickMode.WebCrawl
      : ResearchQuickMode.LocalOnly;
  const quickSetupCompleteCount = [
    selectedDefaultModelValue.length > 0,
    draftSettings.skillIds.length > 0,
    draftSettings.contentPlatforms.outputRules.defaultPlatformId.length > 0,
  ].filter(Boolean).length;

  const markDirty = (): void => {
    if (saveState !== 'saving') {
      setSaveState('idle');
    }
  };

  const updateSettings = (
    updater: (settings: EnterpriseLeadWorkspaceSettings) => EnterpriseLeadWorkspaceSettings,
  ): void => {
    setDraftSettings(previous => normalizeEnterpriseLeadWorkspaceSettings(updater(previous), previous));
    markDirty();
  };

  const updateProvider = (providerKey: string, patch: Partial<ProviderConfig>): void => {
    setModelTestResult(previous => (
      previous?.providerKey === providerKey ? null : previous
    ));
    updateSettings(previous => {
      const currentProvider = previous.model.providers[providerKey] ?? fallbackProviderConfig(providerKey);
      const nextProvider = {
        ...currentProvider,
        ...patch,
      };
      const shouldUseAsDefault = nextProvider.enabled
        && (!previous.model.defaultModelProvider || previous.model.defaultModelProvider === providerKey);
      const firstModelId = getFirstModelId(nextProvider);

      return {
        ...previous,
        model: {
          ...previous.model,
          defaultModelProvider: shouldUseAsDefault ? providerKey : previous.model.defaultModelProvider,
          defaultModel: shouldUseAsDefault && firstModelId ? firstModelId : previous.model.defaultModel,
          providers: {
            ...previous.model.providers,
            [providerKey]: nextProvider,
          },
        },
      };
    });
  };

  const addCustomModelProvider = (): void => {
    const providerKey = getNextCustomProviderKey(draftSettings.model.providers);
    const provider = buildCustomProviderConfig(providerKey);
    setActiveProviderKey(providerKey);
    updateSettings(previous => ({
      ...previous,
      model: {
        ...previous.model,
        defaultModelProvider: previous.model.defaultModelProvider || providerKey,
        providers: {
          ...previous.model.providers,
          [providerKey]: provider,
        },
      },
    }));
  };

  const updateDefaultModel = (value: string): void => {
    const option = decodeDefaultModelOption(value);
    if (!option) {
      return;
    }
    updateSettings(previous => ({
      ...previous,
      model: {
        ...previous.model,
        defaultModelProvider: option.providerKey,
        defaultModel: option.modelId,
      },
    }));
  };

  const testModelProvider = async (providerKey: string): Promise<void> => {
    const provider = draftSettings.model.providers[providerKey];
    if (!provider || modelTestingProviderKey) {
      return;
    }

    setModelTestingProviderKey(providerKey);
    setModelTestResult(null);
    try {
      const result = await testWorkspaceModelProviderConnection(providerKey, provider);
      setModelTestResult({
        providerKey,
        ...result,
      });
    } catch (error) {
      setModelTestResult({
        providerKey,
        success: false,
        message: error instanceof Error ? error.message : i18nService.t('connectionFailed'),
      });
    } finally {
      setModelTestingProviderKey('');
    }
  };

  const toggleSkill = (skillId: string): void => {
    updateSettings(previous => {
      const selected = new Set(previous.skillIds);
      if (selected.has(skillId)) {
        selected.delete(skillId);
      } else {
        selected.add(skillId);
      }
      return {
        ...previous,
        skillIds: Array.from(selected),
      };
    });
  };

  const selectSkillPreset = (preset: SkillPresetDefinition): void => {
    setSelectedSkillPresetId(preset.id);
    const availableSkillIds = new Set(skills.map(skill => skill.id));
    const presetSkillIds = preset.skillIds.filter(skillId => availableSkillIds.has(skillId));
    const nextSkillIds = presetSkillIds.length > 0 || skills.length > 0
      ? presetSkillIds
      : preset.skillIds;
    updateSettings(previous => ({
      ...previous,
      skillIds: nextSkillIds,
    }));
  };

  const updateExternalResearchProvider = (
    providerId: ExternalResearchProviderIdValue,
    patch: Partial<EnterpriseLeadWorkspaceSettings['externalResearch']['providers'][ExternalResearchProviderIdValue]>,
  ): void => {
    setResearchTestResults(previous => {
      const next = { ...previous };
      delete next[providerId];
      return next;
    });
    updateSettings(previous => ({
      ...previous,
      externalResearch: {
        ...previous.externalResearch,
        providers: {
          ...previous.externalResearch.providers,
          [providerId]: {
            ...previous.externalResearch.providers[providerId],
            ...patch,
          },
        },
      },
    }));
  };

  const updateResearchServiceProvider = (
    providerId: ExternalResearchProviderIdValue | '',
  ): void => {
    setResearchTestResults({});
    updateSettings(previous => ({
      ...previous,
      externalResearch: {
        ...previous.externalResearch,
        providers: {
          ...previous.externalResearch.providers,
          [ExternalResearchProviderId.Tavily]: {
            ...previous.externalResearch.providers[ExternalResearchProviderId.Tavily],
            enabled: providerId === ExternalResearchProviderId.Tavily,
          },
          [ExternalResearchProviderId.Firecrawl]: {
            ...previous.externalResearch.providers[ExternalResearchProviderId.Firecrawl],
            enabled: providerId === ExternalResearchProviderId.Firecrawl,
          },
        },
      },
    }));
  };

  const updateSelectedResearchApiKey = (apiKey: string): void => {
    if (!selectedResearchProviderId) {
      return;
    }
    updateExternalResearchProvider(selectedResearchProviderId, { apiKey });
  };

  const testSelectedResearchProvider = async (): Promise<void> => {
    if (!selectedResearchProviderId) {
      return;
    }
    await testExternalResearchProvider(selectedResearchProviderId);
  };

  const testExternalResearchProvider = async (
    providerId: ExternalResearchProviderIdValue,
  ): Promise<void> => {
    const provider = draftSettings.externalResearch.providers[providerId];
    if (!provider.apiKey.trim() || researchTesting[providerId]) {
      return;
    }

    setResearchTesting(previous => ({ ...previous, [providerId]: true }));
    try {
      const result = await agentService.testExternalResearchProvider({
        providerId,
        apiKey: provider.apiKey,
      });
      setResearchTestResults(previous => ({ ...previous, [providerId]: result }));
    } catch {
      setResearchTestResults(previous => ({
        ...previous,
        [providerId]: {
          ok: false,
          message: i18nService.t('agentExternalResearchTestUnexpectedError'),
        },
      }));
    } finally {
      setResearchTesting(previous => ({ ...previous, [providerId]: false }));
    }
  };

  const updateDomesticSource = (
    sourceId: DomesticResearchSourceIdValue,
    patch: Partial<EnterpriseLeadWorkspaceSettings['domesticResearch']['sources'][DomesticResearchSourceIdValue]>,
  ): void => {
    updateSettings(previous => ({
      ...previous,
      domesticResearch: {
        ...previous.domesticResearch,
        sources: {
          ...previous.domesticResearch.sources,
          [sourceId]: {
            ...previous.domesticResearch.sources[sourceId],
            ...patch,
          },
        },
      },
    }));
  };

  const toggleDomesticMode = (
    sourceId: DomesticResearchSourceIdValue,
    mode: DomesticResearchModeValue,
    enabled: boolean,
  ): void => {
    const source = draftSettings.domesticResearch.sources[sourceId];
    const modes = new Set(source.modes);
    if (enabled) {
      modes.add(mode);
    } else if (modes.size > 1) {
      modes.delete(mode);
    }
    updateDomesticSource(sourceId, { modes: Array.from(modes) });
  };

  const updateDomesticUrls = (
    sourceId: DomesticResearchSourceIdValue,
    value: string,
  ): void => {
    updateDomesticSource(sourceId, {
      urls: value
        .split('\n')
        .map(url => url.trim())
        .filter(Boolean),
    });
  };

  const addCustomDomesticSource = (): void => {
    updateSettings(previous => {
      const nextIndex = previous.domesticResearch.customSources.length + 1;
      return {
        ...previous,
        domesticResearch: {
          ...previous.domesticResearch,
          customSources: [
            ...previous.domesticResearch.customSources,
            {
              id: `custom-${Date.now()}`,
              name: `${i18nService.t('enterpriseLeadWorkbenchCustomSource')} ${nextIndex}`,
              enabled: true,
              modes: [DomesticResearchMode.UrlImport],
              urls: [],
            },
          ],
        },
      };
    });
  };

  const removeCustomDomesticSource = (sourceId: string): void => {
    updateSettings(previous => ({
      ...previous,
      domesticResearch: {
        ...previous.domesticResearch,
        customSources: previous.domesticResearch.customSources.filter(source => source.id !== sourceId),
      },
    }));
  };

  const updateCustomDomesticSource = (
    sourceId: string,
    patch: Partial<EnterpriseLeadWorkspaceSettings['domesticResearch']['customSources'][number]>,
  ): void => {
    updateSettings(previous => ({
      ...previous,
      domesticResearch: {
        ...previous.domesticResearch,
        customSources: previous.domesticResearch.customSources.map(source =>
          source.id === sourceId ? { ...source, ...patch, modes: [DomesticResearchMode.UrlImport] } : source),
      },
    }));
  };

  const updateContentPlatform = (
    platformId: EnterpriseLeadContentOutputPlatformIdValue,
    patch: Partial<EnterpriseLeadWorkspaceContentPlatformConfig>,
  ): void => {
    updateSettings(previous => {
      const currentPlatform = previous.contentPlatforms.platforms[platformId];
      if (!currentPlatform) {
        return previous;
      }
      return {
        ...previous,
        contentPlatforms: {
          ...previous.contentPlatforms,
          platforms: {
            ...previous.contentPlatforms.platforms,
            [platformId]: {
              ...currentPlatform,
              ...patch,
            },
          },
        },
      };
    });
  };

  const updateContentOutputRules = (
    patch: Partial<EnterpriseLeadWorkspaceSettings['contentPlatforms']['outputRules']>,
  ): void => {
    updateSettings(previous => ({
      ...previous,
      contentPlatforms: {
        ...previous.contentPlatforms,
        outputRules: {
          ...previous.contentPlatforms.outputRules,
          ...patch,
        },
      },
    }));
  };

  const updateContentVariablePlaceholders = (value: string): void => {
    updateContentOutputRules({
      variablePlaceholders: value
        .split(/[,，]/)
        .map(item => item.trim())
        .filter(Boolean),
    });
  };

  const saveSettings = async (): Promise<void> => {
    if (!canSaveSettings) {
      return;
    }

    const saveWorkspaceId = workspace.id;
    const saveSequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = saveSequence;
    setSaveState('saving');
    await saveWorkspaceSettingsDraft({
      workspaceId: saveWorkspaceId,
      draftSettings,
      isCurrentSave: () =>
        workspaceIdRef.current === saveWorkspaceId
        && saveSequenceRef.current === saveSequence,
      onSaved: updated => {
        const normalizedUpdatedSettings = ensureWorkspaceSettingsHaveProviders(updated.settings);
        setSavedSettings(normalizedUpdatedSettings);
        setDraftSettings(normalizedUpdatedSettings);
        setSaveState('saved');
        onWorkspaceUpdated?.({
          ...updated,
          settings: normalizedUpdatedSettings,
        });
      },
      onError: () => {
        setSaveState('error');
      },
    });
  };

  const getSaveStatusLabel = (): string => {
    if (saveState === 'saving') return i18nService.t('saving');
    if (saveState === 'saved') return i18nService.t('enterpriseLeadWorkbenchSaved');
    if (saveState === 'error') return i18nService.t('enterpriseLeadWorkbenchSaveFailed');
    if (firstBlockingIssue) {
      return i18nService.t('enterpriseLeadWorkbenchSaveBlocked').replace(
        '{reason}',
        i18nService.t(firstBlockingIssue.statusKey),
      );
    }
    if (isDirty) return i18nService.t('enterpriseLeadWorkbenchUnsaved');
    return i18nService.t('enterpriseLeadWorkbenchSaved');
  };

  const renderProviderEditor = () => (
    <details className="rounded-lg border border-border bg-background shadow-sm">
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block truncate text-lg font-semibold leading-6 text-foreground">
            {i18nService.t('enterpriseLeadWorkbenchAdvancedModelTitle')}
          </span>
          <span className="mt-0.5 block text-sm leading-6 text-secondary">
            {i18nService.t('enterpriseLeadWorkbenchAdvancedModelDesc')}
          </span>
        </span>
        <span className="rounded-lg bg-primary/10 px-3 py-2 text-xs font-medium text-primary ring-1 ring-primary/20">
          {i18nService.t('enterpriseLeadWorkbenchWorkspaceScoped')}
        </span>
      </summary>
      <div className="border-t border-border p-4">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={addCustomModelProvider}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {i18nService.t('enterpriseLeadWorkbenchCustomModelProviderAdd')}
          </button>
        </div>

      <div className="mt-4 rounded-lg border border-border bg-surface px-3 py-3">
        <label className="grid gap-1.5">
          <span className="text-sm font-semibold text-foreground">
            {i18nService.t('enterpriseLeadWorkbenchDefaultModelSelect')}
          </span>
          <select
            value={selectedDefaultModelValue}
            onChange={event => updateDefaultModel(event.target.value)}
            disabled={defaultModelOptions.length === 0}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">
              {i18nService.t(
                defaultModelOptions.length > 0
                  ? 'enterpriseLeadWorkbenchDefaultModelUnavailable'
                  : 'enterpriseLeadWorkbenchDefaultModelNoOptions',
              )}
            </option>
            {defaultModelOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-xs leading-5 text-secondary">
          {i18nService.t('enterpriseLeadWorkbenchDefaultModelSelectDesc')}
        </p>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="grid max-h-80 gap-1.5 overflow-y-auto pr-1">
          {providerKeys.map(providerKey => {
            const provider = draftSettings.model.providers[providerKey];
            const isActive = activeProviderKey === providerKey;
            const providerStatus = getModelProviderConnectionStatus(providerKey, provider);
            return (
              <button
                key={providerKey}
                type="button"
                onClick={() => setActiveProviderKey(providerKey)}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                  isActive
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border/70 bg-surface hover:bg-surface-raised'
                }`}
              >
                <span className="min-w-0">
                  <strong className="block truncate text-sm text-foreground">
                    {getProviderDisplayName(providerKey, provider)}
                  </strong>
                  <span className="block truncate text-xs text-secondary">
                    {provider.baseUrl || i18nService.t('enterpriseLeadWorkbenchProviderNoBaseUrl')}
                  </span>
                </span>
                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium ${
                    statusBadgeClassNames[
                      providerStatus.tone
                    ]
                  }`}
                >
                  {i18nService.t(providerStatus.statusKey)}
                </span>
              </button>
            );
          })}
        </div>

        {activeProviderKey && activeProvider && (
          <div className="rounded-lg border border-border bg-surface px-3 py-3">
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-foreground">
                {getProviderDisplayName(activeProviderKey, activeProvider)}
              </span>
              <span className="inline-flex items-center gap-2 text-xs text-secondary">
                {i18nService.t('enterpriseLeadWorkbenchEnabled')}
                <input
                  type="checkbox"
                  checked={activeProvider.enabled}
                  onChange={event => updateProvider(activeProviderKey, { enabled: event.target.checked })}
                  className="h-4 w-4 accent-primary"
                />
              </span>
            </label>

            <div className="mt-3 grid gap-2">
              {isCustomProvider(activeProviderKey) ? (
                <label className="block">
                  <span className="text-xs font-medium text-secondary">
                    {i18nService.t('enterpriseLeadWorkbenchProviderDisplayName')}
                  </span>
                  <input
                    type="text"
                    value={activeProvider.displayName ?? ''}
                    onChange={event => updateProvider(activeProviderKey, {
                      displayName: event.target.value,
                    })}
                    className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                  />
                </label>
              ) : null}
              <label className="block">
                <span className="text-xs font-medium text-secondary">
                  {i18nService.t('enterpriseLeadWorkbenchProviderApiKey')}
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <input
                    type={shownSecrets[activeProviderKey] ? 'text' : 'password'}
                    value={activeProvider.apiKey}
                    onChange={event => updateProvider(activeProviderKey, { apiKey: event.target.value })}
                    className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    aria-label={i18nService.t('enterpriseLeadWorkbenchToggleProviderSecret')}
                    onClick={() => setShownSecrets(previous => ({
                      ...previous,
                      [activeProviderKey]: !previous[activeProviderKey],
                    }))}
                    className="h-8 w-8 rounded-md border border-border text-secondary hover:bg-background"
                  >
                    {shownSecrets[activeProviderKey]
                      ? <EyeSlashIcon className="mx-auto h-4 w-4" />
                      : <EyeIcon className="mx-auto h-4 w-4" />}
                  </button>
                </span>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-secondary">
                  {i18nService.t('enterpriseLeadWorkbenchProviderBaseUrl')}
                </span>
                <input
                  type="text"
                  value={activeProvider.baseUrl}
                  onChange={event => updateProvider(activeProviderKey, { baseUrl: event.target.value })}
                  className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-secondary">
                    {i18nService.t('enterpriseLeadWorkbenchProviderApiFormat')}
                  </span>
                  <select
                    value={activeProvider.apiFormat ?? ApiFormat.OpenAI}
                    onChange={event => updateProvider(activeProviderKey, { apiFormat: event.target.value as ProviderConfig['apiFormat'] })}
                    className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                  >
                    <option value={ApiFormat.OpenAI}>OpenAI</option>
                    <option value={ApiFormat.Anthropic}>Anthropic</option>
                    <option value={ApiFormat.Gemini}>Gemini</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-secondary">
                    {i18nService.t('enterpriseLeadWorkbenchProviderModelIds')}
                  </span>
                  <select
                    value={
                      activeProviderModels.some(model => model.id === draftSettings.model.defaultModel)
                        ? encodeDefaultModelOption(activeProviderKey, draftSettings.model.defaultModel)
                        : ''
                    }
                    onChange={event => updateDefaultModel(event.target.value)}
                    disabled={activeProviderModels.length === 0}
                    className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                  >
                    <option value="">
                      {i18nService.t('enterpriseLeadWorkbenchDefaultModelUnavailable')}
                    </option>
                    {activeProviderModels.map(model => {
                      const modelId = model.id.trim();
                      if (!modelId) {
                        return null;
                      }
                      return (
                        <option
                          key={modelId}
                          value={encodeDefaultModelOption(activeProviderKey, modelId)}
                        >
                          {model.name?.trim() || modelId}
                        </option>
                      );
                    })}
                  </select>
                </label>
              </div>
              <p className="text-xs leading-5 text-secondary">
                {i18nService.t('enterpriseLeadWorkbenchProviderDefaultModel')}
                {draftSettings.model.defaultModelProvider && draftSettings.model.defaultModel
                  ? ` ${getProviderDisplayName(draftSettings.model.defaultModelProvider, draftSettings.model.providers[draftSettings.model.defaultModelProvider])}/${draftSettings.model.defaultModel}`
                  : ` ${i18nService.t('enterpriseLeadWorkbenchProviderNoDefaultModel')}`}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!activeProviderStatus?.ready || isTestingActiveModelProvider}
                  onClick={() => void testModelProvider(activeProviderKey)}
                  className="h-8 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {i18nService.t(
                    isTestingActiveModelProvider
                      ? 'testing'
                      : 'enterpriseLeadWorkbenchTestModelConnection',
                  )}
                </button>
              </div>
              {activeModelTestResult ? (
                <div className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${
                  activeModelTestResult.success
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
                }`}
                >
                  {activeModelTestResult.success ? (
                    <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="font-semibold">
                      {i18nService.t(activeModelTestResult.success ? 'connectionSuccess' : 'connectionFailed')}
                    </div>
                    <div className="mt-0.5 break-words leading-5">
                      {activeModelTestResult.message}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
      </div>
    </details>
  );

  const renderSkillsEditor = () => (
    <details className="rounded-lg border border-border bg-background shadow-sm">
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block truncate text-lg font-semibold leading-6 text-foreground">
            {i18nService.t('enterpriseLeadWorkbenchAdvancedSkillsTitle')}
          </span>
          <span className="mt-0.5 block text-sm leading-6 text-secondary">
            {i18nService.t('enterpriseLeadWorkbenchAdvancedSkillsDesc')}
          </span>
        </span>
        <span className="shrink-0 rounded-lg bg-primary/10 px-3 py-2 text-xs font-medium text-primary ring-1 ring-primary/20">
          {draftSettings.skillIds.length}/{skills.length}
        </span>
      </summary>

      <div className="grid max-h-72 gap-1.5 overflow-y-auto border-t border-border p-4">
        {orderedSkills.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-secondary">
            {i18nService.t('enterpriseLeadWorkbenchSkillsEmpty')}
          </div>
        ) : orderedSkills.map(skill => {
          const checked = draftSettings.skillIds.includes(skill.id);
          return (
            <label
              key={skill.id}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border/70 bg-surface px-2.5 py-2"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleSkill(skill.id)}
                className="h-4 w-4 accent-primary"
              />
              <span className="min-w-0">
                <strong className="block truncate text-sm text-foreground">
                  {skill.name}
                </strong>
                <span className="block truncate text-xs text-secondary">
                  {skill.description}
                </span>
              </span>
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                statusBadgeClassNames[
                  skill.enabled
                    ? EnterpriseLeadWorkbenchStatusTone.Enabled
                    : EnterpriseLeadWorkbenchStatusTone.Disabled
                ]
              }`}
              >
                {i18nService.t(skill.enabled
                  ? 'enterpriseLeadWorkbenchStatusEnabled'
                  : 'enterpriseLeadWorkbenchStatusDisabled')}
              </span>
            </label>
          );
        })}
      </div>
    </details>
  );

  const renderExternalResearchEditor = () => (
    <details className="rounded-lg border border-border bg-background shadow-sm">
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block truncate text-lg font-semibold leading-6 text-foreground">
            {i18nService.t('enterpriseLeadWorkbenchResearchProvidersTitle')}
          </span>
          <span className="mt-0.5 block text-sm leading-6 text-secondary">
            {i18nService.t('enterpriseLeadWorkbenchResearchProvidersDesc')}
          </span>
        </span>
        <span className="shrink-0 rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-300">
          {i18nService.t('enterpriseLeadWorkbenchOptional')}
        </span>
      </summary>

      <div className="grid gap-2 border-t border-border p-4 md:grid-cols-2">
        {ExternalResearchProviderIds.map(providerId => {
          const provider = draftSettings.externalResearch.providers[providerId];
          const providerStatus = getExternalResearchProviderConnectionStatus(provider);
          const canTestProvider = provider.apiKey.trim().length > 0;
          const isTestingProvider = researchTesting[providerId] === true;
          const testResult = researchTestResults[providerId];
          return (
            <div key={providerId} className="rounded-lg border border-border bg-surface px-3 py-3">
              <label className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <strong className="text-sm text-foreground">
                    {i18nService.t(providerLabelKeys[providerId])}
                  </strong>
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                    statusBadgeClassNames[
                      providerStatus.tone
                    ]
                  }`}
                  >
                    {i18nService.t(providerStatus.statusKey)}
                  </span>
                </span>
                <span className="inline-flex items-center gap-2 text-xs text-secondary">
                  {i18nService.t('enterpriseLeadWorkbenchEnabled')}
                  <input
                    type="checkbox"
                    checked={provider.enabled}
                    onChange={event => updateExternalResearchProvider(providerId, { enabled: event.target.checked })}
                    className="h-4 w-4 accent-primary"
                  />
                </span>
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type={shownSecrets[providerId] ? 'text' : 'password'}
                  value={provider.apiKey}
                  onChange={event => updateExternalResearchProvider(providerId, { apiKey: event.target.value })}
                  placeholder={i18nService.t('enterpriseLeadWorkbenchResearchApiKeyPlaceholder')}
                  className="h-8 min-w-[180px] flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                />
                <button
                  type="button"
                  disabled={!canTestProvider || isTestingProvider}
                  onClick={() => void testExternalResearchProvider(providerId)}
                  className="h-8 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {i18nService.t(
                    isTestingProvider
                      ? 'agentExternalResearchTesting'
                      : 'agentExternalResearchTest',
                  )}
                </button>
              </div>
              {testResult ? (() => {
                const feedback = getExternalResearchTestFeedback(testResult);
                return (
                  <div className={`mt-2 flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${feedback.toneClassName}`}>
                    {feedback.icon === 'success' ? (
                      <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold">
                        {i18nService.t(feedback.labelKey)}
                      </div>
                      <div className="mt-0.5 break-words leading-5">
                        {feedback.message}
                      </div>
                    </div>
                  </div>
                );
              })() : null}
            </div>
          );
        })}
      </div>
    </details>
  );

  const renderDomesticResearchEditor = () => (
    <details className="rounded-lg border border-border bg-background shadow-sm">
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block truncate text-lg font-semibold leading-6 text-foreground">
            {i18nService.t('enterpriseLeadWorkbenchResearchSourcesTitle')}
          </span>
          <span className="mt-0.5 block text-sm leading-6 text-secondary">
            {i18nService.t('enterpriseLeadWorkbenchResearchSourcesDesc')}
          </span>
        </span>
        <button
          type="button"
          onClick={addCustomDomesticSource}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2 text-xs font-medium text-foreground hover:bg-surface-raised"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          {i18nService.t('enterpriseLeadWorkbenchCustomSourceAdd')}
        </button>
      </summary>

      <div className="grid gap-2 border-t border-border p-4 lg:grid-cols-2">
        {DomesticResearchSourceIds.map(sourceId => {
          const source = draftSettings.domesticResearch.sources[sourceId];
          return (
            <div key={sourceId} className="rounded-lg border border-border bg-surface px-3 py-3">
              <label className="flex items-center justify-between gap-3">
                <strong className="text-sm text-foreground">
                  {i18nService.t(sourceLabelKeys[sourceId])}
                </strong>
                <span className="inline-flex items-center gap-2 text-xs text-secondary">
                  {i18nService.t('enterpriseLeadWorkbenchEnabled')}
                  <input
                    type="checkbox"
                    checked={source.enabled}
                    onChange={event => updateDomesticSource(sourceId, { enabled: event.target.checked })}
                    className="h-4 w-4 accent-primary"
                  />
                </span>
              </label>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-secondary">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={source.modes.includes(DomesticResearchMode.Search)}
                    onChange={event => toggleDomesticMode(sourceId, DomesticResearchMode.Search, event.target.checked)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  {i18nService.t('agentDomesticResearchModeSearch')}
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={source.modes.includes(DomesticResearchMode.UrlImport)}
                    onChange={event => toggleDomesticMode(sourceId, DomesticResearchMode.UrlImport, event.target.checked)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  {i18nService.t('agentDomesticResearchModeUrlImport')}
                </label>
              </div>
              <textarea
                value={source.urls.join('\n')}
                onChange={event => updateDomesticUrls(sourceId, event.target.value)}
                placeholder={i18nService.t('enterpriseLeadWorkbenchSourceUrlsPlaceholder')}
                className="mt-2 min-h-16 w-full resize-y rounded-md border border-border bg-background px-2 py-2 text-xs leading-5 text-foreground outline-none focus:border-primary"
              />
            </div>
          );
        })}

        {draftSettings.domesticResearch.customSources.map(source => (
          <div key={source.id} className="rounded-lg border border-dashed border-border bg-surface px-3 py-3">
            <div className="flex items-center gap-2">
              <input
                value={source.name}
                onChange={event => updateCustomDomesticSource(source.id, { name: event.target.value })}
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
              />
              <label className="inline-flex shrink-0 items-center gap-1.5 text-xs text-secondary">
                <input
                  type="checkbox"
                  checked={source.enabled}
                  onChange={event => updateCustomDomesticSource(source.id, { enabled: event.target.checked })}
                  className="h-3.5 w-3.5 accent-primary"
                />
                {i18nService.t('enterpriseLeadWorkbenchEnabled')}
              </label>
              <button
                type="button"
                aria-label={i18nService.t('enterpriseLeadWorkbenchCustomSourceDelete')}
                onClick={() => removeCustomDomesticSource(source.id)}
                className="h-8 w-8 rounded-md border border-border text-secondary hover:bg-background"
              >
                <TrashIcon className="mx-auto h-4 w-4" />
              </button>
            </div>
            <textarea
              value={source.urls.join('\n')}
              onChange={event => updateCustomDomesticSource(source.id, {
                urls: event.target.value.split('\n').map(url => url.trim()).filter(Boolean),
              })}
              placeholder={i18nService.t('enterpriseLeadWorkbenchSourceUrlsPlaceholder')}
              className="mt-2 min-h-16 w-full resize-y rounded-md border border-border bg-background px-2 py-2 text-xs leading-5 text-foreground outline-none focus:border-primary"
            />
          </div>
        ))}
      </div>
    </details>
  );

  const renderContentPlatformEditor = () => (
    <details className="rounded-lg border border-border bg-background shadow-sm">
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block truncate text-lg font-semibold leading-6 text-foreground">
            {i18nService.t('enterpriseLeadWorkbenchContentDeliveryTitle')}
          </span>
          <span className="mt-0.5 block text-sm leading-6 text-secondary">
            {i18nService.t('enterpriseLeadWorkbenchContentDeliveryDesc')}
          </span>
        </span>
        <span className="shrink-0 rounded-lg bg-primary/10 px-3 py-2 text-xs font-medium text-primary ring-1 ring-primary/20">
          {i18nService.t('enterpriseLeadWorkbenchStatusConfigured')}
        </span>
      </summary>

      <div className="grid gap-2 border-t border-border p-4">
        {EnterpriseLeadContentOutputPlatformIds.map(platformId => {
          const platform = draftSettings.contentPlatforms.platforms[platformId];
          if (!platform) return null;
          const platformStatus = getContentPlatformConnectionStatus(platform);
          return (
            <div key={platformId} className="rounded-lg border border-border bg-surface px-3 py-3">
              <div className="grid gap-3 lg:grid-cols-[minmax(180px,0.8fr)_minmax(0,1.5fr)_auto] lg:items-start">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <strong className="truncate text-sm text-foreground">
                      {i18nService.t(contentPlatformLabelKeys[platformId])}
                    </strong>
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                      statusBadgeClassNames[platformStatus.tone]
                    }`}
                    >
                      {i18nService.t(platformStatus.statusKey)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-secondary">
                    {i18nService.t(contentPlatformDescKeys[platformId])}
                  </p>
                </div>

                <div className="grid gap-2 md:grid-cols-3">
                  {platformId === EnterpriseLeadContentOutputPlatformId.WechatArticle ? (
                    <input
                      type="text"
                      value={platform.appId}
                      onChange={event => updateContentPlatform(platformId, { appId: event.target.value })}
                      placeholder={i18nService.t('enterpriseLeadWorkbenchContentPlatformAppIdPlaceholder')}
                      className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                    />
                  ) : platformId === EnterpriseLeadContentOutputPlatformId.CustomWebhook ? (
                    <input
                      type="password"
                      value={platform.token}
                      onChange={event => updateContentPlatform(platformId, { token: event.target.value })}
                      placeholder={i18nService.t('enterpriseLeadWorkbenchContentPlatformTokenPlaceholder')}
                      className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                    />
                  ) : (
                    <input
                      type="text"
                      value={platform.account}
                      onChange={event => updateContentPlatform(platformId, { account: event.target.value })}
                      placeholder={i18nService.t('enterpriseLeadWorkbenchContentPlatformAccountPlaceholder')}
                      className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                    />
                  )}
                  {platformId === EnterpriseLeadContentOutputPlatformId.CustomWebhook
                    || platformId === EnterpriseLeadContentOutputPlatformId.SalesMessage ? (
                      <input
                        type="url"
                        value={platform.endpoint}
                        onChange={event => updateContentPlatform(platformId, { endpoint: event.target.value })}
                        placeholder={i18nService.t('enterpriseLeadWorkbenchContentPlatformEndpointPlaceholder')}
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                      />
                    ) : (
                      <input
                        type="password"
                        value={platform.token}
                        onChange={event => updateContentPlatform(platformId, { token: event.target.value })}
                        placeholder={i18nService.t('enterpriseLeadWorkbenchContentPlatformTokenPlaceholder')}
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                      />
                    )}
                  <select
                    value={
                      platformId === EnterpriseLeadContentOutputPlatformId.CustomWebhook
                        ? platform.payloadFormat
                        : platform.deliveryMode
                    }
                    onChange={event => updateContentPlatform(
                      platformId,
                      platformId === EnterpriseLeadContentOutputPlatformId.CustomWebhook
                        ? { payloadFormat: event.target.value }
                        : { deliveryMode: event.target.value },
                    )}
                    className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                  >
                    {platformId === EnterpriseLeadContentOutputPlatformId.XiaohongshuDraft && (
                      <>
                        <option value="draft_only">{i18nService.t('enterpriseLeadWorkbenchContentDeliveryDraftOnly')}</option>
                        <option value="markdown_export">{i18nService.t('enterpriseLeadWorkbenchContentDeliveryMarkdown')}</option>
                        <option value="third_party_draft">{i18nService.t('enterpriseLeadWorkbenchContentDeliveryThirdParty')}</option>
                      </>
                    )}
                    {platformId === EnterpriseLeadContentOutputPlatformId.SalesMessage && (
                      <>
                        <option value="wecom_draft">{i18nService.t('enterpriseLeadWorkbenchContentDeliveryWecom')}</option>
                        <option value="crm_draft">{i18nService.t('enterpriseLeadWorkbenchContentDeliveryCrm')}</option>
                        <option value="sms_template">{i18nService.t('enterpriseLeadWorkbenchContentDeliverySms')}</option>
                      </>
                    )}
                    {platformId === EnterpriseLeadContentOutputPlatformId.WechatArticle && (
                      <>
                        <option value="wechat_draft">{i18nService.t('enterpriseLeadWorkbenchContentDeliveryWechatDraft')}</option>
                        <option value="markdown_export">{i18nService.t('enterpriseLeadWorkbenchContentDeliveryMarkdown')}</option>
                      </>
                    )}
                    {platformId === EnterpriseLeadContentOutputPlatformId.CustomWebhook && (
                      <>
                        <option value="json">{i18nService.t('enterpriseLeadWorkbenchContentPayloadJson')}</option>
                        <option value="markdown">{i18nService.t('enterpriseLeadWorkbenchContentPayloadMarkdown')}</option>
                        <option value="feishu_table">{i18nService.t('enterpriseLeadWorkbenchContentPayloadFeishuTable')}</option>
                      </>
                    )}
                  </select>
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-secondary">
                  {i18nService.t('enterpriseLeadWorkbenchEnabled')}
                  <input
                    type="checkbox"
                    checked={platform.enabled}
                    onChange={event => updateContentPlatform(platformId, { enabled: event.target.checked })}
                    className="h-4 w-4 accent-primary"
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-lg border border-border bg-surface px-3 py-3">
        <h3 className="text-sm font-semibold text-foreground">
          {i18nService.t('enterpriseLeadWorkbenchContentOutputRulesTitle')}
        </h3>
        <p className="mt-1 text-xs leading-5 text-secondary">
          {i18nService.t('enterpriseLeadWorkbenchContentOutputRulesDesc')}
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-secondary">
              {i18nService.t('enterpriseLeadWorkbenchContentDefaultTarget')}
            </span>
            <select
              value={draftSettings.contentPlatforms.outputRules.defaultPlatformId}
              onChange={event => updateContentOutputRules({ defaultPlatformId: event.target.value })}
              className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
            >
              {EnterpriseLeadContentOutputPlatformIds.map(platformId => (
                <option key={platformId} value={platformId}>
                  {i18nService.t(contentPlatformLabelKeys[platformId])}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-secondary">
              {i18nService.t('enterpriseLeadWorkbenchContentLengthPolicy')}
            </span>
            <select
              value={draftSettings.contentPlatforms.outputRules.lengthPolicy}
              onChange={event => updateContentOutputRules({ lengthPolicy: event.target.value })}
              className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
            >
              <option value={EnterpriseLeadContentOutputLengthPolicy.Compress}>
                {i18nService.t('enterpriseLeadWorkbenchContentLengthCompress')}
              </option>
              <option value={EnterpriseLeadContentOutputLengthPolicy.Split}>
                {i18nService.t('enterpriseLeadWorkbenchContentLengthSplit')}
              </option>
              <option value={EnterpriseLeadContentOutputLengthPolicy.WarnOnly}>
                {i18nService.t('enterpriseLeadWorkbenchContentLengthWarnOnly')}
              </option>
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="text-xs font-medium text-secondary">
              {i18nService.t('enterpriseLeadWorkbenchContentVariablePlaceholders')}
            </span>
            <input
              type="text"
              value={draftSettings.contentPlatforms.outputRules.variablePlaceholders.join('、')}
              onChange={event => updateContentVariablePlaceholders(event.target.value)}
              className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
            />
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-secondary">
            <input
              type="checkbox"
              checked={draftSettings.contentPlatforms.outputRules.riskCheckBeforeExport}
              onChange={event => updateContentOutputRules({ riskCheckBeforeExport: event.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            {i18nService.t('enterpriseLeadWorkbenchContentRiskCheck')}
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-secondary">
            <input
              type="checkbox"
              checked={draftSettings.contentPlatforms.outputRules.archiveOutputs}
              onChange={event => updateContentOutputRules({ archiveOutputs: event.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            {i18nService.t('enterpriseLeadWorkbenchContentArchiveOutputs')}
          </label>
        </div>
      </div>
    </details>
  );

  const renderQuickSetup = () => {
    const isTestingSelectedResearchProvider = selectedResearchProviderId
      ? researchTesting[selectedResearchProviderId] === true
      : false;
    const canTestSelectedResearchProvider = Boolean(
      selectedResearchProviderId && selectedResearchProvider?.apiKey.trim(),
    );

    return (
      <section className="rounded-lg border border-border bg-background shadow-sm">
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold leading-6 text-foreground">
              {i18nService.t('enterpriseLeadWorkbenchQuickSetupTitle')}
            </h2>
            <p className="mt-1 text-sm leading-6 text-secondary">
              {i18nService.t('enterpriseLeadWorkbenchQuickSetupDesc')}
            </p>
          </div>
          <div className="shrink-0 rounded-lg bg-primary/10 px-3 py-2 text-right text-xs font-medium text-primary ring-1 ring-primary/20">
            <div className="text-lg font-semibold leading-5">
              {quickSetupCompleteCount}/3
            </div>
            <div className="mt-1">
              {i18nService.t('enterpriseLeadWorkbenchQuickSetupProgress')}
            </div>
          </div>
        </div>

        <div className="divide-y divide-border">
          <section className="grid gap-3 px-4 py-4 md:grid-cols-[2rem_minmax(0,1fr)_auto]">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              1
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">
                {i18nService.t('enterpriseLeadWorkbenchQuickModelTitle')}
              </h3>
              <p className="mt-1 text-xs leading-5 text-secondary">
                {i18nService.t('enterpriseLeadWorkbenchQuickModelDesc')}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <select
                  value={selectedDefaultModelValue}
                  onChange={event => updateDefaultModel(event.target.value)}
                  disabled={defaultModelOptions.length === 0}
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={i18nService.t('enterpriseLeadWorkbenchDefaultModelSelect')}
                >
                  <option value="">
                    {i18nService.t(
                      defaultModelOptions.length > 0
                        ? 'enterpriseLeadWorkbenchDefaultModelUnavailable'
                        : 'enterpriseLeadWorkbenchDefaultModelNoOptions',
                    )}
                  </option>
                  {defaultModelOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!activeProviderStatus?.ready || isTestingActiveModelProvider}
                  onClick={() => activeProviderKey && void testModelProvider(activeProviderKey)}
                  className="h-9 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {i18nService.t(
                    isTestingActiveModelProvider
                      ? 'testing'
                      : 'enterpriseLeadWorkbenchTestModelConnection',
                  )}
                </button>
              </div>
            </div>
            <span className={`h-fit rounded-full px-2 py-1 text-xs font-medium ${
              selectedDefaultModelValue
                ? statusBadgeClassNames[EnterpriseLeadWorkbenchStatusTone.Enabled]
                : statusBadgeClassNames[EnterpriseLeadWorkbenchStatusTone.Warning]
            }`}
            >
              {i18nService.t(selectedDefaultModelValue
                ? 'enterpriseLeadWorkspaceSettingsReady'
                : 'enterpriseLeadWorkspaceSettingsNeedsSetup')}
            </span>
          </section>

          <section className="grid gap-3 px-4 py-4 md:grid-cols-[2rem_minmax(0,1fr)_auto]">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              2
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">
                {i18nService.t('enterpriseLeadWorkbenchQuickSkillPresetTitle')}
              </h3>
              <p className="mt-1 text-xs leading-5 text-secondary">
                {i18nService.t('enterpriseLeadWorkbenchQuickSkillPresetDesc')}
              </p>
              <div className="mt-3 grid gap-2 lg:grid-cols-3">
                {skillPresetDefinitions.map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => selectSkillPreset(preset)}
                    className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                      selectedSkillPresetId === preset.id
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border bg-surface hover:bg-surface-raised'
                    }`}
                  >
                    <strong className="block text-sm text-foreground">
                      {i18nService.t(preset.titleKey)}
                    </strong>
                    <span className="mt-1 block text-xs leading-5 text-secondary">
                      {i18nService.t(preset.descriptionKey)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <span className={`h-fit rounded-full px-2 py-1 text-xs font-medium ${
              draftSettings.skillIds.length > 0
                ? statusBadgeClassNames[EnterpriseLeadWorkbenchStatusTone.Enabled]
                : statusBadgeClassNames[EnterpriseLeadWorkbenchStatusTone.Warning]
            }`}
            >
              {draftSettings.skillIds.length > 0
                ? `${draftSettings.skillIds.length} ${i18nService.t('enterpriseLeadWorkbenchQuickSkillsSelected')}`
                : i18nService.t('enterpriseLeadWorkbenchQuickSkillsPending')}
            </span>
          </section>

          <section className="grid gap-3 px-4 py-4 md:grid-cols-[2rem_minmax(0,1fr)_auto]">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              3
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">
                {i18nService.t('enterpriseLeadWorkbenchQuickResearchOutputTitle')}
              </h3>
              <p className="mt-1 text-xs leading-5 text-secondary">
                {i18nService.t('enterpriseLeadWorkbenchQuickResearchOutputDesc')}
              </p>
              <div className="mt-3 grid gap-2 lg:grid-cols-3">
                <button
                  type="button"
                  onClick={() => updateResearchServiceProvider('')}
                  className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                    selectedResearchQuickMode === ResearchQuickMode.LocalOnly
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border bg-surface hover:bg-surface-raised'
                  }`}
                >
                  <strong className="block text-sm text-foreground">
                    {i18nService.t('enterpriseLeadWorkbenchResearchModeLocalOnly')}
                  </strong>
                  <span className="mt-1 block text-xs leading-5 text-secondary">
                    {i18nService.t('enterpriseLeadWorkbenchResearchModeLocalOnlyDesc')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => updateResearchServiceProvider(ExternalResearchProviderId.Tavily)}
                  className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                    selectedResearchQuickMode === ResearchQuickMode.WebSearch
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border bg-surface hover:bg-surface-raised'
                  }`}
                >
                  <strong className="block text-sm text-foreground">
                    {i18nService.t('enterpriseLeadWorkbenchResearchModeWebSearch')}
                  </strong>
                  <span className="mt-1 block text-xs leading-5 text-secondary">
                    {i18nService.t('enterpriseLeadWorkbenchResearchModeWebSearchDesc')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => updateResearchServiceProvider(ExternalResearchProviderId.Firecrawl)}
                  className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                    selectedResearchQuickMode === ResearchQuickMode.WebCrawl
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border bg-surface hover:bg-surface-raised'
                  }`}
                >
                  <strong className="block text-sm text-foreground">
                    {i18nService.t('enterpriseLeadWorkbenchResearchModeWebCrawl')}
                  </strong>
                  <span className="mt-1 block text-xs leading-5 text-secondary">
                    {i18nService.t('enterpriseLeadWorkbenchResearchModeWebCrawlDesc')}
                  </span>
                </button>
              </div>
              <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto]">
                <select
                  value={selectedResearchProviderId}
                  onChange={event => updateResearchServiceProvider(event.target.value as ExternalResearchProviderIdValue | '')}
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-primary"
                  aria-label={i18nService.t('enterpriseLeadWorkbenchResearchProviderSelect')}
                >
                  <option value="">
                    {i18nService.t('enterpriseLeadWorkbenchResearchProviderNone')}
                  </option>
                  {ExternalResearchProviderIds.map(providerId => (
                    <option key={providerId} value={providerId}>
                      {i18nService.t(providerLabelKeys[providerId])}
                    </option>
                  ))}
                </select>
                <input
                  type={selectedResearchProviderId && shownSecrets[selectedResearchProviderId] ? 'text' : 'password'}
                  value={selectedResearchProvider?.apiKey ?? ''}
                  onChange={event => updateSelectedResearchApiKey(event.target.value)}
                  disabled={!selectedResearchProviderId}
                  placeholder={i18nService.t('enterpriseLeadWorkbenchResearchProviderApiKeyPlaceholder')}
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button
                  type="button"
                  disabled={!canTestSelectedResearchProvider || isTestingSelectedResearchProvider}
                  onClick={() => void testSelectedResearchProvider()}
                  className="h-9 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {i18nService.t(
                    isTestingSelectedResearchProvider
                      ? 'agentExternalResearchTesting'
                      : 'agentExternalResearchTest',
                  )}
                </button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <select
                  value={draftSettings.contentPlatforms.outputRules.defaultPlatformId}
                  onChange={event => updateContentOutputRules({ defaultPlatformId: event.target.value })}
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-primary"
                  aria-label={i18nService.t('enterpriseLeadWorkbenchContentDefaultTarget')}
                >
                  {EnterpriseLeadContentOutputPlatformIds.map(platformId => (
                    <option key={platformId} value={platformId}>
                      {i18nService.t(contentPlatformLabelKeys[platformId])}
                    </option>
                  ))}
                </select>
                <select
                  value="domestic_sources"
                  disabled
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-70"
                  aria-label={i18nService.t('enterpriseLeadWorkbenchResearchMaterialSource')}
                >
                  <option value="domestic_sources">
                    {i18nService.t('enterpriseLeadWorkbenchResearchMaterialDomesticLinks')}
                  </option>
                </select>
              </div>
              {selectedResearchProviderTestResult ? (() => {
                const feedback = getExternalResearchTestFeedback(selectedResearchProviderTestResult);
                return (
                  <div className={`mt-3 flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${feedback.toneClassName}`}>
                    {feedback.icon === 'success' ? (
                      <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold">
                        {i18nService.t(feedback.labelKey)}
                      </div>
                      <div className="mt-0.5 break-words leading-5">
                        {feedback.message}
                      </div>
                    </div>
                  </div>
                );
              })() : null}
            </div>
            <span className="h-fit rounded-full bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-300">
              {i18nService.t('enterpriseLeadWorkbenchQuickResearchOptional')}
            </span>
          </section>
        </div>
      </section>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-surface-raised px-6 py-5">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground">
              {i18nService.t('enterpriseLeadWorkbenchNavSettings')}
            </h1>
            <p className="mt-1 text-sm leading-6 text-secondary">
              {i18nService.t('enterpriseLeadWorkbenchSettingsQuickDesc')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={`hidden rounded-md px-2 py-1 text-xs font-medium sm:inline-flex ${
                saveState === 'error'
                  ? 'bg-red-500/10 text-red-600 dark:text-red-300'
                  : firstBlockingIssue
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : isDirty
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              {getSaveStatusLabel()}
            </span>
            <button
              type="button"
              disabled={!canSaveSettings}
              onClick={() => void saveSettings()}
              className="h-9 shrink-0 rounded-lg bg-primary px-3 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-white/80 dark:disabled:bg-slate-700"
            >
              {saveState === 'saving'
                ? i18nService.t('saving')
                : i18nService.t('enterpriseLeadWorkbenchSaveConfig')}
            </button>
          </div>
        </div>

        {renderQuickSetup()}
        {renderProviderEditor()}
        {renderSkillsEditor()}
        {renderExternalResearchEditor()}
        {renderDomesticResearchEditor()}
        {renderContentPlatformEditor()}

        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">
              {i18nService.t('enterpriseLeadWorkbenchQuickSaveDockTitle')}
            </div>
            <div className="mt-0.5 truncate text-xs leading-5 text-secondary">
              {i18nService.t('enterpriseLeadWorkbenchQuickSaveDockDesc')}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden rounded-md bg-surface px-2 py-1 text-xs font-medium text-secondary sm:inline-flex">
              {getSaveStatusLabel()}
            </span>
            <button
              type="button"
              disabled={!canSaveSettings}
              onClick={() => void saveSettings()}
              className="h-9 rounded-lg bg-primary px-3 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-white/80 dark:disabled:bg-slate-700"
            >
              {saveState === 'saving'
                ? i18nService.t('saving')
                : i18nService.t('enterpriseLeadWorkbenchSaveConfig')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkspaceSettings;
