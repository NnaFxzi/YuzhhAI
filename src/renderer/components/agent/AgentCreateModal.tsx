import { XMarkIcon } from '@heroicons/react/24/outline';
import { DefaultAgentAvatarIcon } from '@shared/agent/avatar';
import {
  buildDefaultDomesticResearchConfig,
  type DomesticResearchConfig,
} from '@shared/agent/domesticResearch';
import {
  AgentExternalResearchMode,
  buildDefaultExternalResearchEditConfig,
  type ExternalResearchEditConfig,
  type MaskedExternalResearchConfig,
} from '@shared/agent/externalResearch';
import type { Platform } from '@shared/platform';
import { PlatformRegistry } from '@shared/platform';
import { ProviderName } from '@shared/providers';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { agentService } from '../../services/agent';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { imService } from '../../services/im';
import { LogReporterAction, reportYdAnalyzer } from '../../services/logReporter';
import type { RootState } from '../../store';
import type { Model } from '../../store/slices/modelSlice';
import type { PresetAgent } from '../../types/agent';
import type { DingTalkInstanceConfig, DiscordInstanceConfig, FeishuInstanceConfig, IMGatewayConfig, NimInstanceConfig, PopoInstanceConfig, QQInstanceConfig, TelegramInstanceConfig, WecomInstanceConfig } from '../../types/im';
import type { Skill } from '../../types/skill';
import { getAgentDisplayNameById } from '../../utils/agentDisplay';
import { toOpenClawModelRef } from '../../utils/openclawModelRef';
import { getVisibleIMPlatforms } from '../../utils/regionFilter';
import Modal from '../common/Modal';
import AgentAvatarIcon from './AgentAvatarIcon';
import AgentAvatarPicker from './AgentAvatarPicker';
import AgentConfirmDialog from './AgentConfirmDialog';
import AgentDetailToolbar from './AgentDetailToolbar';
import AgentDomesticResearchSourcesPanel from './AgentDomesticResearchSourcesPanel';
import {
  DEFAULT_USER_INFO_TEMPLATE,
  getEditableUserInfo,
} from './agentEditText';
import AgentExternalResearchPanel from './AgentExternalResearchPanel';
import AgentSkillSelector from './AgentSkillSelector';
import { AgentConfirmDialogVariant, AgentDetailTab } from './constants';

type MultiInstancePlatform = 'dingtalk' | 'feishu' | 'qq' | 'wecom' | 'nim' | 'telegram' | 'discord' | 'popo';
type MultiInstanceConfig = DingTalkInstanceConfig | FeishuInstanceConfig | QQInstanceConfig | WecomInstanceConfig | NimInstanceConfig | TelegramInstanceConfig | DiscordInstanceConfig | PopoInstanceConfig;
type AgentCreateAnalyticsSource = 'home_agent_sidebar' | 'home_agent_sidebar_empty' | 'agents_view' | 'agent_create_modal';
type AgentCreateActionType =
  | 'open'
  | 'close'
  | 'open_template_picker'
  | 'close_template_picker'
  | 'template_selected'
  | 'tab_change'
  | 'create_submit'
  | 'create_success'
  | 'create_failed'
  | 'discard_confirm_open'
  | 'discard_confirm_submit'
  | 'discard_confirm_cancel';

const MULTI_INSTANCE_PLATFORMS: MultiInstancePlatform[] = ['dingtalk', 'feishu', 'qq', 'wecom', 'nim', 'telegram', 'discord', 'popo'];
const AGENT_CREATE_ANALYTICS_DEFAULT_SOURCE: AgentCreateAnalyticsSource = 'agent_create_modal';

const isMultiInstancePlatform = (platform: Platform): platform is MultiInstancePlatform =>
  MULTI_INSTANCE_PLATFORMS.includes(platform as MultiInstancePlatform);

const serializeAnalyticsList = (values: string[]): string | undefined => {
  const normalizedValues = values
    .map(value => value.trim())
    .filter(Boolean);
  return normalizedValues.length > 0 ? normalizedValues.join(',') : undefined;
};

const getModelAnalyticsSource = (model: Model | null): 'package' | 'custom' | undefined => {
  if (!model) return undefined;
  if (model.isServerModel || model.providerKey === ProviderName.LobsteraiServer) {
    return 'package';
  }
  return 'custom';
};

const getModelSelectorGroup = (model: Model | null): 'server' | 'user' | undefined => {
  if (!model) return undefined;
  return model.isServerModel || model.providerKey === ProviderName.LobsteraiServer ? 'server' : 'user';
};

interface AgentCreateModalProps {
  isOpen?: boolean;
  onClose: () => void;
  presentation?: 'modal' | 'page';
  source?: AgentCreateAnalyticsSource;
}

const AgentCreateModal: React.FC<AgentCreateModalProps> = ({
  isOpen = true,
  onClose,
  presentation = 'modal',
  source = AGENT_CREATE_ANALYTICS_DEFAULT_SOURCE,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [identity, setIdentity] = useState('');
  const [userInfo, setUserInfo] = useState('');
  const [icon, setIcon] = useState(DefaultAgentAvatarIcon);
  const [model, setModel] = useState<Model | null>(null);
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [presetTemplates, setPresetTemplates] = useState<PresetAgent[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(true);
  const [addingPresetId, setAddingPresetId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AgentDetailTab>(AgentDetailTab.Identity);
  const [externalResearchConfig, setExternalResearchConfig] = useState<ExternalResearchEditConfig>(
    buildDefaultExternalResearchEditConfig(AgentExternalResearchMode.Inherit),
  );
  const [externalResearchDefaults, setExternalResearchDefaults] = useState<MaskedExternalResearchConfig | null>(null);
  const [domesticResearchConfig, setDomesticResearchConfig] = useState<DomesticResearchConfig>(
    buildDefaultDomesticResearchConfig(),
  );
  const initialDomesticResearchRef = useRef(JSON.stringify(buildDefaultDomesticResearchConfig()));
  const globalSelectedModel = useSelector((state: RootState) => state.model.defaultSelectedModel);
  const agents = useSelector((state: RootState) => state.agent.agents);
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const coworkConfig = useSelector((state: RootState) => state.cowork.config);
  const skills = useSelector((state: RootState) => state.skill.skills);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<{
    id: string;
    name: string;
    skillCount: number;
  } | null>(null);
  const initialWorkingDirectoryRef = useRef('');
  const initialModelRef = useRef('');
  const initialUserInfoRef = useRef('');
  const initializedOpenRef = useRef(false);

  // IM binding state — keys are platform names or `platform:<instanceId>` for multi-instance platforms.
  const [imConfig, setImConfig] = useState<IMGatewayConfig | null>(null);
  const [boundKeys, setBoundKeys] = useState<Set<string>>(new Set());

  const getChangedFields = useCallback((): string[] => {
    const changedFields: string[] = [];
    if (name.trim()) changedFields.push('name');
    if (description.trim()) changedFields.push('description');
    if (systemPrompt.trim()) changedFields.push('systemPrompt');
    if (identity.trim()) changedFields.push('identity');
    if (userInfo !== initialUserInfoRef.current) changedFields.push('userInfo');
    if (icon !== DefaultAgentAvatarIcon) changedFields.push('icon');
    if ((model ? toOpenClawModelRef(model) : '') !== initialModelRef.current) changedFields.push('model');
    if (workingDirectory !== initialWorkingDirectoryRef.current) changedFields.push('workingDirectory');
    if (skillIds.length > 0) changedFields.push('skillIds');
    if (externalResearchConfig.mode !== AgentExternalResearchMode.Inherit) changedFields.push('externalResearch');
    if (JSON.stringify(domesticResearchConfig) !== initialDomesticResearchRef.current) changedFields.push('domesticResearch');
    if (boundKeys.size > 0) changedFields.push('imBindings');
    return changedFields;
  }, [boundKeys.size, description, domesticResearchConfig, externalResearchConfig.mode, icon, identity, model, name, skillIds.length, systemPrompt, userInfo, workingDirectory]);

  const isDirty = useCallback((): boolean => {
    return getChangedFields().length > 0;
  }, [getChangedFields]);

  const getSelectedSkills = useCallback((): Skill[] => (
    skillIds
      .map(skillId => skills.find(skill => skill.id === skillId))
      .filter((skill): skill is Skill => Boolean(skill))
  ), [skillIds, skills]);

  const getImPlatformsForAnalytics = useCallback((): string[] => {
    const platforms = new Set<string>();
    boundKeys.forEach((key) => {
      const platform = key.split(':')[0]?.trim();
      if (platform) {
        platforms.add(platform);
      }
    });
    return Array.from(platforms).sort();
  }, [boundKeys]);

  const reportAgentCreateAction = useCallback((
    actionType: AgentCreateActionType,
    options: {
      activeTab?: AgentDetailTab;
      changedFields?: string[];
      errorCode?: 'user_info_write_failed' | 'create_agent_failed' | 'unknown';
      includeConfigDetails?: boolean;
      isDirty?: boolean;
      result?: 'success' | 'failed';
      targetTab?: AgentDetailTab;
      template?: {
        id: string;
        name: string;
        skillCount: number;
      } | null;
    } = {},
  ): void => {
    const changedFields = options.changedFields ?? [];
    const selectedSkills = options.includeConfigDetails ? getSelectedSkills() : [];
    const imPlatforms = options.includeConfigDetails ? getImPlatformsForAnalytics() : [];
    const template = options.template === undefined ? selectedTemplate : options.template;
    console.debug(`[AgentCreateModal] reporting analytics action ${actionType}`);
    void reportYdAnalyzer({
      action: LogReporterAction.AgentCreateAction,
      source,
      actionType,
      activeTab: options.activeTab ?? activeTab,
      targetTab: options.targetTab,
      creationMode: template ? 'template' : 'blank',
      isDirty: options.isDirty,
      changedFieldCount: changedFields.length,
      changedFields: changedFields.length > 0 ? changedFields.join(',') : undefined,
      templateId: template?.id,
      templateName: template?.name,
      templateSkillCount: template?.skillCount,
      skillCount: skillIds.length,
      imBindingCount: boundKeys.size,
      hasModel: Boolean(model),
      hasWorkingDirectory: workingDirectory.trim().length > 0,
      result: options.result,
      errorCode: options.errorCode,
      modelId: options.includeConfigDetails ? model?.id : undefined,
      modelName: options.includeConfigDetails ? model?.name : undefined,
      modelSource: options.includeConfigDetails ? getModelAnalyticsSource(model) : undefined,
      providerKey: options.includeConfigDetails ? model?.providerKey : undefined,
      provider: options.includeConfigDetails ? model?.provider : undefined,
      selectorGroup: options.includeConfigDetails ? getModelSelectorGroup(model) : undefined,
      skillIds: options.includeConfigDetails ? serializeAnalyticsList(selectedSkills.map(skill => skill.id)) : undefined,
      skillNames: options.includeConfigDetails ? serializeAnalyticsList(selectedSkills.map(skill => skill.name)) : undefined,
      builtInSkillCount: options.includeConfigDetails
        ? selectedSkills.filter(skill => skill.isBuiltIn).length
        : undefined,
      customSkillCount: options.includeConfigDetails
        ? selectedSkills.filter(skill => !skill.isBuiltIn).length
        : undefined,
      imPlatforms: options.includeConfigDetails ? serializeAnalyticsList(imPlatforms) : undefined,
    });
  }, [
    activeTab,
    boundKeys.size,
    getImPlatformsForAnalytics,
    getSelectedSkills,
    model,
    selectedTemplate,
    skillIds.length,
    source,
    workingDirectory,
  ]);

  useEffect(() => {
    if (!isOpen) {
      initializedOpenRef.current = false;
      return;
    }
    if (initializedOpenRef.current) return;
    initializedOpenRef.current = true;
    setName('');
    setDescription('');
    setSystemPrompt('');
    setIdentity('');
    setUserInfo('');
    initialUserInfoRef.current = '';
    setIcon(DefaultAgentAvatarIcon);
    const currentAgent = agents.find((agent) => agent.id === currentAgentId);
    const defaultWorkingDirectory = currentAgent?.workingDirectory?.trim() || coworkConfig.workingDirectory || '';
    initialWorkingDirectoryRef.current = defaultWorkingDirectory;
    initialModelRef.current = globalSelectedModel ? toOpenClawModelRef(globalSelectedModel) : '';
    setModel(globalSelectedModel ?? null);
    setWorkingDirectory(defaultWorkingDirectory);
    setSkillIds([]);
    setExternalResearchConfig(buildDefaultExternalResearchEditConfig(AgentExternalResearchMode.Inherit));
    const defaultDomesticResearch = buildDefaultDomesticResearchConfig();
    setDomesticResearchConfig(defaultDomesticResearch);
    initialDomesticResearchRef.current = JSON.stringify(defaultDomesticResearch);
    setActiveTab(AgentDetailTab.Identity);
    setShowUnsavedConfirm(false);
    setShowTemplatePicker(true);
    setAddingPresetId(null);
    setSelectedTemplate(null);
    setBoundKeys(new Set());
    reportAgentCreateAction('open', {
      activeTab: AgentDetailTab.Identity,
      isDirty: false,
      template: null,
    });
    void coworkService.readBootstrapFile('USER.md').then((content) => {
      const editableContent = getEditableUserInfo(content);
      initialUserInfoRef.current = editableContent;
      setUserInfo(editableContent);
    });
    imService.loadConfig().then((cfg) => {
      if (cfg) setImConfig(cfg);
    });
    agentService.getExternalResearchSettings()
      .then(settings => setExternalResearchDefaults(settings?.appDefaults ?? null))
      .catch(() => setExternalResearchDefaults(null));
    setTemplatesLoading(true);
    agentService.getPresetTemplates()
      .then(setPresetTemplates)
      .finally(() => setTemplatesLoading(false));
  }, [agents, coworkConfig.workingDirectory, currentAgentId, globalSelectedModel, isOpen, reportAgentCreateAction]);

  useEffect(() => {
    if (!isOpen || model || !globalSelectedModel) return;
    if (!initialModelRef.current) {
      initialModelRef.current = toOpenClawModelRef(globalSelectedModel);
    }
    setModel(globalSelectedModel);
  }, [globalSelectedModel, isOpen, model]);

  if (!isOpen) return null;

  const resetForm = () => {
    setName('');
    setDescription('');
    setSystemPrompt('');
    setIdentity('');
    setUserInfo('');
    initialUserInfoRef.current = '';
    setIcon(DefaultAgentAvatarIcon);
    setModel(null);
    setWorkingDirectory('');
    setSkillIds([]);
    setExternalResearchConfig(buildDefaultExternalResearchEditConfig(AgentExternalResearchMode.Inherit));
    const defaultDomesticResearch = buildDefaultDomesticResearchConfig();
    setDomesticResearchConfig(defaultDomesticResearch);
    initialDomesticResearchRef.current = JSON.stringify(defaultDomesticResearch);
    setActiveTab(AgentDetailTab.Identity);
    setShowTemplatePicker(true);
    setSelectedTemplate(null);
    setBoundKeys(new Set());
  };

  const handleApplyTemplate = async (preset: PresetAgent) => {
    if (creating) return;

    const isEn = i18nService.getLanguage() === 'en';
    const templateName = isEn && preset.nameEn ? preset.nameEn : preset.name;
    const template = {
      id: preset.id,
      name: templateName,
      skillCount: preset.skillIds?.length ?? 0,
    };
    setSelectedTemplate(template);
    reportAgentCreateAction('template_selected', {
      activeTab: AgentDetailTab.Identity,
      isDirty: false,
      template,
    });
    reportAgentCreateAction('create_submit', {
      changedFields: [],
      includeConfigDetails: false,
      isDirty: false,
      template,
    });
    setCreating(true);
    setAddingPresetId(preset.id);
    try {
      const agent = await agentService.addPreset(preset.id);
      if (agent) {
        agentService.switchAgent(agent.id);
        reportAgentCreateAction('create_success', {
          changedFields: [],
          includeConfigDetails: false,
          isDirty: false,
          result: 'success',
          template,
        });
        onClose();
        resetForm();
      } else {
        reportAgentCreateAction('create_failed', {
          changedFields: [],
          errorCode: 'create_agent_failed',
          includeConfigDetails: false,
          isDirty: false,
          result: 'failed',
          template,
        });
        window.dispatchEvent(
          new CustomEvent('app:showToast', {
            detail: i18nService.t('systemAgentAddFailed'),
          }),
        );
      }
    } catch {
      reportAgentCreateAction('create_failed', {
        changedFields: [],
        errorCode: 'unknown',
        includeConfigDetails: false,
        isDirty: false,
        result: 'failed',
        template,
      });
      window.dispatchEvent(
        new CustomEvent('app:showToast', {
          detail: i18nService.t('systemAgentAddFailed'),
        }),
      );
    } finally {
      setCreating(false);
      setAddingPresetId(null);
    }
  };

  const handleClose = () => {
    const changedFields = getChangedFields();
    if (changedFields.length > 0) {
      reportAgentCreateAction('discard_confirm_open', {
        changedFields,
        isDirty: true,
      });
      setShowUnsavedConfirm(true);
    } else {
      reportAgentCreateAction('close', { isDirty: false });
      onClose();
    }
  };

  const handleConfirmDiscard = () => {
    reportAgentCreateAction('discard_confirm_submit', {
      changedFields: getChangedFields(),
      isDirty: true,
    });
    setShowUnsavedConfirm(false);
    onClose();
  };

  const handleCancelDiscard = () => {
    reportAgentCreateAction('discard_confirm_cancel', {
      changedFields: getChangedFields(),
      isDirty: true,
    });
    setShowUnsavedConfirm(false);
  };

  const handleTabChange = (targetTab: AgentDetailTab) => {
    if (targetTab === activeTab) return;
    reportAgentCreateAction('tab_change', {
      activeTab,
      isDirty: isDirty(),
      targetTab,
    });
    setActiveTab(targetTab);
  };

  const handleCreate = () => {
    const changedFields = getChangedFields();

    reportAgentCreateAction('create_failed', {
      changedFields,
      errorCode: 'create_agent_failed',
      includeConfigDetails: true,
      isDirty: changedFields.length > 0,
      result: 'failed',
    });
    window.dispatchEvent(
      new CustomEvent('app:showToast', {
        detail: i18nService.t('agentGlobalCreateUnavailable'),
      }),
    );
  };

  const handleToggleIMBinding = (key: string) => {
    const next = new Set(boundKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setBoundKeys(next);
  };

  /** Get enabled instances for a multi-instance platform (doesn't require live connection) */
  const getEnabledInstances = (platform: MultiInstancePlatform) => {
    if (!imConfig) return [];
    const cfg = imConfig[platform];
    const instances = cfg?.instances;
    if (!Array.isArray(instances)) return [];
    return instances.filter((inst: MultiInstanceConfig) => inst.enabled);
  };

  const isPlatformConfigured = (platform: Platform): boolean => {
    if (!imConfig) return false;
    if (isMultiInstancePlatform(platform)) {
      return getEnabledInstances(platform).length > 0;
    }
    return 'enabled' in imConfig[platform] && imConfig[platform].enabled === true;
  };

  /** Resolve agent name by id */
  const getAgentName = (aid: string): string | null => {
    return getAgentDisplayNameById(aid, agents);
  };

  const renderToggle = (isOn: boolean) => (
    <div
      className={`relative w-9 h-5 rounded-full transition-colors ${
        isOn ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <div
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          isOn ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </div>
  );

  const tabs: { key: AgentDetailTab; label: string }[] = [
    { key: AgentDetailTab.Identity, label: i18nService.t('coworkBootstrapIdentityTitle') },
    { key: AgentDetailTab.Prompt, label: i18nService.t('coworkBootstrapSoulTitle') },
    { key: AgentDetailTab.User, label: i18nService.t('coworkBootstrapUserTitle') },
    { key: AgentDetailTab.Skills, label: i18nService.t('agentTabSkills') },
    { key: AgentDetailTab.ExternalResearch, label: i18nService.t('agentTabExternalResearch') },
    { key: AgentDetailTab.Im, label: i18nService.t('agentTabIM') },
  ];

  const renderTextEditor = (
    value: string,
    onChange: (value: string) => void,
    placeholder: string,
    ariaLabel: string,
    hint: string,
    action?: {
      label: string;
      onClick: () => void;
    },
  ) => (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <p className="text-xs leading-5 text-secondary">
          {hint}
        </p>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            {action.label}
          </button>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="min-h-0 flex-1 w-full resize-none border border-transparent bg-transparent text-sm leading-6 text-foreground placeholder:text-secondary/45 focus:outline-none"
      />
    </div>
  );

  const editorContent = (
    <>
      <div className="flex shrink-0 items-start justify-between gap-4 px-7 py-5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <AgentAvatarPicker value={icon} onChange={setIcon} />
          <div className="min-w-0 flex-1 pt-0.5">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={i18nService.t('agentNamePlaceholder')}
              aria-label={i18nService.t('agentName')}
              className="w-full bg-transparent text-lg font-semibold leading-6 text-foreground placeholder:text-secondary/40 focus:outline-none"
              autoFocus
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={i18nService.t('agentDescriptionPlaceholder')}
              aria-label={i18nService.t('agentDescription')}
              className="mt-0.5 w-full bg-transparent text-sm leading-5 text-secondary placeholder:text-secondary/50 focus:outline-none"
            />
          </div>
        </div>
        <div className="mt-1 flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              reportAgentCreateAction('open_template_picker', {
                isDirty: isDirty(),
              });
              setShowTemplatePicker(true);
            }}
            className="h-8 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-foreground hover:bg-surface-raised transition-colors"
          >
            {i18nService.t('agentUseTemplate')}
          </button>
          <button type="button" onClick={handleClose} className="p-2 rounded-lg hover:bg-surface-raised transition-colors">
            <XMarkIcon className="h-5 w-5 text-secondary" />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex shrink-0 border-b border-border px-7">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => handleTabChange(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
              activeTab === tab.key
                ? 'text-foreground'
                : 'text-secondary hover:text-foreground'
            }`}
          >
            {tab.label}
            {activeTab === tab.key && (
              <div className="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-foreground rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-7 py-7 overflow-hidden flex-1 min-h-0">
        {activeTab === AgentDetailTab.Prompt && renderTextEditor(
          systemPrompt,
          setSystemPrompt,
          i18nService.t('coworkBootstrapPlaceholder'),
          i18nService.t('coworkBootstrapSoulTitle'),
          i18nService.t('coworkBootstrapSoulHint'),
        )}

        {activeTab === AgentDetailTab.Identity && renderTextEditor(
          identity,
          setIdentity,
          i18nService.t('coworkBootstrapPlaceholder'),
          i18nService.t('coworkBootstrapIdentityTitle'),
          i18nService.t('coworkBootstrapIdentityHint'),
        )}

        {activeTab === AgentDetailTab.User && renderTextEditor(
          userInfo,
          setUserInfo,
          i18nService.t('coworkBootstrapPlaceholder'),
          i18nService.t('coworkBootstrapUserTitle'),
          i18nService.t('coworkBootstrapUserHint'),
          {
            label: i18nService.t('coworkBootstrapUserEmptyAction'),
            onClick: () => setUserInfo(DEFAULT_USER_INFO_TEMPLATE),
          },
        )}

        {activeTab === AgentDetailTab.Skills && (
          <AgentSkillSelector selectedSkillIds={skillIds} onChange={setSkillIds} />
        )}

        {activeTab === AgentDetailTab.ExternalResearch && (
          <div className="h-full overflow-y-auto space-y-6">
            <AgentExternalResearchPanel
              value={externalResearchConfig}
              appDefaults={externalResearchDefaults}
              onChange={setExternalResearchConfig}
              onTestProvider={input => agentService.testExternalResearchProvider(input)}
            />
            <AgentDomesticResearchSourcesPanel
              value={domesticResearchConfig}
              onChange={setDomesticResearchConfig}
            />
          </div>
        )}

        {activeTab === AgentDetailTab.Im && (
          <div className="h-full overflow-y-auto">
            <div className="space-y-1">
              {PlatformRegistry.platforms
                .filter((platform) => (getVisibleIMPlatforms(i18nService.getLanguage()) as readonly string[]).includes(platform))
                .map((platform) => {
                  const logo = PlatformRegistry.logo(platform);

                  if (isMultiInstancePlatform(platform)) {
                    const enabledInstances = getEnabledInstances(platform);

                    if (enabledInstances.length === 0) {
                      return (
                        <div
                          key={platform}
                          className="flex items-center justify-between px-3 py-2.5 rounded-lg opacity-50"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center">
                              <img src={logo} alt={i18nService.t(platform)} className="w-6 h-6 object-contain rounded" />
                            </div>
                            <div>
                              <div className="text-sm font-medium text-foreground">
                                {i18nService.t(platform)}
                              </div>
                              <div className="text-xs text-secondary/50">
                                {i18nService.t('agentIMNotConfiguredHint') || 'Please configure in Settings > IM Bots first'}
                              </div>
                            </div>
                          </div>
                          <span className="text-xs text-secondary/50">
                            {i18nService.t('agentIMNotConfigured') || 'Not configured'}
                          </span>
                        </div>
                      );
                    }

                    return (
                      <div key={platform} className="rounded-lg border border-border overflow-hidden">
                        <div className="flex items-center gap-3 px-3 py-2.5 bg-surface-raised">
                          <div className="flex h-8 w-8 items-center justify-center">
                            <img src={logo} alt={i18nService.t(platform)} className="w-6 h-6 object-contain rounded" />
                          </div>
                          <span className="text-sm font-semibold text-foreground">
                            {i18nService.t(platform)}
                          </span>
                        </div>
                        {enabledInstances.map((inst: MultiInstanceConfig, idx: number) => {
                          const bindingKey = `${platform}:${inst.instanceId}`;
                          const isBound = boundKeys.has(bindingKey);
                          const bindings = imConfig?.settings?.platformAgentBindings || {};
                          const otherAgentId = bindings[bindingKey];
                          const boundToOther = Boolean(otherAgentId && !isBound);
                          const otherAgentName = boundToOther ? getAgentName(otherAgentId) : null;
                          return (
                            <div
                              key={inst.instanceId}
                              className={`flex items-center justify-between px-3 py-2 pl-14 transition-colors cursor-pointer hover:bg-surface-raised ${
                                idx < enabledInstances.length - 1 ? 'border-b border-border-subtle' : ''
                              }`}
                              onClick={() => handleToggleIMBinding(bindingKey)}
                            >
                              <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                                <span className="text-sm text-foreground">
                                  {inst.instanceName}
                                </span>
                                {boundToOther && otherAgentName && (
                                  <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                                    {(i18nService.t('agentIMBoundToOther') || '-> {agent}').replace('{agent}', otherAgentName)}
                                  </span>
                                )}
                              </div>
                              {renderToggle(isBound)}
                            </div>
                          );
                        })}
                      </div>
                    );
                  }

                  // Single-instance platform
                  const configured = isPlatformConfigured(platform);
                  const bound = boundKeys.has(platform);
                  const bindings = imConfig?.settings?.platformAgentBindings || {};
                  const otherAgentId = bindings[platform];
                  const boundToOther = Boolean(configured && otherAgentId && !bound);
                  const otherAgentName = boundToOther ? getAgentName(otherAgentId) : null;
                  return (
                    <div
                      key={platform}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${
                        configured
                          ? 'hover:bg-surface-raised cursor-pointer'
                          : 'opacity-50'
                      }`}
                      onClick={() => configured && handleToggleIMBinding(platform)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center">
                          <img src={logo} alt={i18nService.t(platform)} className="w-6 h-6 object-contain rounded" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            {i18nService.t(platform)}
                          </div>
                          {!configured && (
                            <div className="text-xs text-secondary/50">
                              {i18nService.t('agentIMNotConfiguredHint') || 'Please configure in Settings > IM Bots first'}
                            </div>
                          )}
                        </div>
                        {boundToOther && otherAgentName && (
                          <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                            {(i18nService.t('agentIMBoundToOther') || '-> {agent}').replace('{agent}', otherAgentName)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {configured ? (
                          renderToggle(bound)
                        ) : (
                          <span className="text-xs text-secondary/50">
                            {i18nService.t('agentIMNotConfigured') || 'Not configured'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-t border-border">
        <AgentDetailToolbar
          model={model}
          onModelChange={setModel}
          workingDirectory={workingDirectory}
          onWorkingDirectoryChange={setWorkingDirectory}
        />
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            className="h-9 px-5 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {creating ? i18nService.t('creating') : i18nService.t('create')}
          </button>
        </div>
      </div>
    </>
  );

  const closeTemplatePicker = () => {
    reportAgentCreateAction('close_template_picker', {
      isDirty: isDirty(),
    });
    handleClose();
  };

  const content = showTemplatePicker ? (
    <AgentTemplatePickerContent
      presets={presetTemplates}
      loading={templatesLoading}
      addingPresetId={addingPresetId}
      onClose={closeTemplatePicker}
      onSelect={handleApplyTemplate}
    />
  ) : (
    editorContent
  );

  return (
    <>
      {presentation === 'page' ? (
        <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-surface bg-surface shadow-sm">
          {content}
        </div>
      ) : (
        <Modal
          isOpen={isOpen}
          onClose={showTemplatePicker ? closeTemplatePicker : handleClose}
          overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/10 dark:bg-black/50"
          className="w-[calc(100vw-56px)] max-w-[854px] h-[82vh] max-h-[664px] rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.16)] bg-surface border border-surface flex flex-col overflow-hidden"
        >
          {content}
        </Modal>
      )}

      {showUnsavedConfirm && (
        <AgentConfirmDialog
          variant={AgentConfirmDialogVariant.Unsaved}
          title={i18nService.t('agentUnsavedTitle')}
          message={i18nService.t('agentUnsavedMessage')}
          cancelLabel={i18nService.t('agentUnsavedStay')}
          confirmLabel={i18nService.t('agentUnsavedDiscard')}
          onCancel={handleCancelDiscard}
          onConfirm={handleConfirmDiscard}
        />
      )}
    </>
  );
};

const AgentTemplatePickerContent: React.FC<{
  presets: PresetAgent[];
  loading: boolean;
  addingPresetId: string | null;
  onClose: () => void;
  onSelect: (preset: PresetAgent) => void;
}> = ({ presets, loading, addingPresetId, onClose, onSelect }) => {
  const isEn = i18nService.getLanguage() === 'en';

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-3 px-7 py-5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">
            {i18nService.t('systemAgentTemplateTitle')}
          </h2>
          <p className="mt-1 text-sm leading-5 text-secondary">
            {i18nService.t('systemAgentTemplateDesc')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-raised transition-colors"
          >
            <XMarkIcon className="h-5 w-5 text-secondary" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-7">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-secondary">
            {i18nService.t('loading')}
          </div>
        ) : presets.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-secondary">
            {i18nService.t('systemAgentTemplateEmpty')}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {presets.map(preset => {
              const name = isEn && preset.nameEn ? preset.nameEn : preset.name;
              const description =
                isEn && preset.descriptionEn ? preset.descriptionEn : preset.description;
              const installed = preset.installed === true;
              const enabled = preset.enabled !== false;
              const statusLabel = installed
                ? enabled
                  ? i18nService.t('systemAgentStatusEnabled')
                  : i18nService.t('systemAgentStatusDisabled')
                : i18nService.t('systemAgentStatusAvailable');
              const actionLabel = installed
                ? enabled
                  ? i18nService.t('openSystemAgent')
                  : i18nService.t('restoreSystemAgent')
                : i18nService.t('addSystemAgentShort');

              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={Boolean(addingPresetId)}
                  onClick={() => onSelect(preset)}
                  className="group flex min-h-[132px] flex-col items-start rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-primary/40 hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="flex w-full items-center gap-3">
                    <AgentAvatarIcon
                      value={preset.icon}
                      className="h-8 w-8"
                      iconClassName="h-5 w-5"
                      legacyClassName="text-2xl"
                    />
                    <div className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                      {name}
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                        installed
                          ? enabled
                            ? 'bg-primary/10 text-primary'
                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'bg-surface-raised text-secondary'
                      }`}
                    >
                      {statusLabel}
                    </span>
                    <span className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-secondary">
                      {addingPresetId === preset.id
                        ? i18nService.t('systemAgentAdding')
                        : actionLabel}
                    </span>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-foreground/90 line-clamp-3">
                    {description}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
};

export default AgentCreateModal;
