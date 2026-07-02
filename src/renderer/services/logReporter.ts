import { isLegacyCloudEnabled, LocalIndependentCloud } from '../../shared/cloudCapabilities/constants';
import { store } from '../store';
import { configService } from './config';
import { getInstallationId } from './installationId';

export const LogReporterEndpoint = {
  Disabled: LocalIndependentCloud.DisabledAnalyticsEndpoint,
} as const;

export const LogReporterProduct = {
  YuzhhAiAssistant: 'yuzhh-ai-assistant',
} as const;

export const LogReporterCategory = {
  Actions: 'actions',
} as const;

export const LogReporterActionPrefix = {
  YuzhhAi: 'yuzhh_ai_',
} as const;

export const LogReporterAction = {
  AgentCreateAction: 'yuzhh_ai_agent_create_action',
  AgentSettingsAction: 'yuzhh_ai_agent_settings_action',
  AgentEngineMaintenanceAction: 'yuzhh_ai_agent_engine_maintenance_action',
  AgentEngineSettingChanged: 'yuzhh_ai_agent_engine_setting_changed',
  AboutAction: 'yuzhh_ai_about_action',
  AccountMenuAction: 'yuzhh_ai_account_menu_action',
  AppStarted: 'yuzhh_ai_app_started',
  AppearanceSettingChanged: 'yuzhh_ai_appearance_setting_changed',
  ArtifactPreviewAction: 'yuzhh_ai_artifact_preview_action',
  BrowserSettingChanged: 'yuzhh_ai_browser_setting_changed',
  CustomModelConnectionTested: 'yuzhh_ai_custom_model_connection_tested',
  CustomModelSettingsSaved: 'yuzhh_ai_custom_model_settings_saved',
  ConversationBlockAction: 'yuzhh_ai_conversation_block_action',
  ConversationMessageAction: 'yuzhh_ai_conversation_message_action',
  ConversationNavigationAction: 'yuzhh_ai_conversation_navigation_action',
  DreamingSettingChanged: 'yuzhh_ai_dreaming_setting_changed',
  EmailSkillConnectionTested: 'yuzhh_ai_email_skill_connection_tested',
  EmailSkillSettingsSaved: 'yuzhh_ai_email_skill_settings_saved',
  ExpertKitAction: 'yuzhh_ai_expert_kit_action',
  ExpertKitSelected: 'yuzhh_ai_expert_kit_selected',
  GeneralSettingChanged: 'yuzhh_ai_general_setting_changed',
  ImConnectionTested: 'yuzhh_ai_im_connection_tested',
  ImGatewayToggled: 'yuzhh_ai_im_gateway_toggled',
  ImInstanceChanged: 'yuzhh_ai_im_instance_changed',
  ImSettingsSaved: 'yuzhh_ai_im_settings_saved',
  MemoryEntryChanged: 'yuzhh_ai_memory_entry_changed',
  MemorySettingChanged: 'yuzhh_ai_memory_setting_changed',
  McpEnabled: 'yuzhh_ai_mcp_enabled',
  McpAction: 'yuzhh_ai_mcp_action',
  ModelSelected: 'yuzhh_ai_model_selected',
  PlanModeEnabled: 'yuzhh_ai_plan_mode_enabled',
  PluginAction: 'yuzhh_ai_plugin_action',
  PluginSettingsSaved: 'yuzhh_ai_plugin_settings_saved',
  PromptControlAction: 'yuzhh_ai_prompt_control_action',
  PromptSubmit: 'yuzhh_ai_prompt_submit',
  PromptTemplateAction: 'yuzhh_ai_prompt_template_action',
  ShortcutSettingChanged: 'yuzhh_ai_shortcut_setting_changed',
  SidebarAction: 'yuzhh_ai_sidebar_action',
  SkillAction: 'yuzhh_ai_skill_action',
  SkillEnabled: 'yuzhh_ai_skill_enabled',
  ScheduledTaskAction: 'yuzhh_ai_scheduled_task_action',
  TaskSearchAction: 'yuzhh_ai_task_search_action',
  UsageAnalyticsEnabled: 'yuzhh_ai_usage_analytics_enabled',
} as const;

export const LogReporterEntry = {
  PromptToolsMenu: 'prompt_tools_menu',
} as const;

type LogParamValue = string | number | boolean | null | undefined;

export type LogEventAction = `${typeof LogReporterActionPrefix.YuzhhAi}${string}`;

export type LogEventParams = Record<string, LogParamValue> & {
  action: LogEventAction;
};

const logCommons = {
  _npid: LogReporterProduct.YuzhhAiAssistant,
  _ncat: LogReporterCategory.Actions,
} as const;

export interface BuildLogUrlOptions {
  appVersion?: string;
  arch?: string;
  firstKeyfrom?: string;
  installationId?: string | null;
  language?: string;
  latestKeyfrom?: string;
  platform?: string;
  userId?: string;
  timestamp?: number;
}

type LogKeyfromAttribution = {
  firstKeyfrom: string;
  latestKeyfrom: string;
};

let cachedAppVersion = '';
let appVersionPromise: Promise<string> | null = null;
let cachedInstallationId: string | null = null;
let installationIdPromise: Promise<string | null> | null = null;
let cachedKeyfromAttribution: LogKeyfromAttribution | null = null;
let keyfromAttributionPromise: Promise<LogKeyfromAttribution | null> | null = null;

const writeReporterLog = (level: 'debug' | 'warn', message: string, error?: unknown): void => {
  if (level === 'warn') {
    if (error === undefined) {
      console.warn(`[LogReporter] ${message}`);
    } else {
      console.warn(`[LogReporter] ${message}:`, error);
    }
  } else {
    console.debug(`[LogReporter] ${message}`);
  }
  window.electron?.log?.fromRenderer?.(level, 'LogReporter', message);
};

const getWindowAppVersion = async (): Promise<string> => {
  if (cachedAppVersion) {
    return cachedAppVersion;
  }
  if (typeof window === 'undefined' || !window.electron?.appInfo?.getVersion) {
    return '';
  }
  if (!appVersionPromise) {
    appVersionPromise = window.electron.appInfo.getVersion()
      .then(version => {
        cachedAppVersion = version || '';
        return cachedAppVersion;
      })
      .catch(error => {
        appVersionPromise = null;
        writeReporterLog('warn', 'failed to load app version for analytics', error);
        return '';
      });
  }
  return appVersionPromise;
};

const getInstallationIdForAnalytics = async (): Promise<string | null> => {
  if (cachedInstallationId) {
    return cachedInstallationId;
  }
  if (!installationIdPromise) {
    installationIdPromise = getInstallationId()
      .then(id => {
        cachedInstallationId = id;
        return cachedInstallationId;
      })
      .catch(error => {
        installationIdPromise = null;
        writeReporterLog('warn', 'failed to load installation uuid for analytics', error);
        return null;
      });
  }
  return installationIdPromise;
};

const getWindowKeyfromAttribution = async (): Promise<LogKeyfromAttribution | null> => {
  if (cachedKeyfromAttribution) {
    return cachedKeyfromAttribution;
  }
  if (typeof window === 'undefined' || !window.electron?.appInfo?.getKeyfromAttribution) {
    return null;
  }
  if (!keyfromAttributionPromise) {
    keyfromAttributionPromise = window.electron.appInfo.getKeyfromAttribution()
      .then(attribution => {
        cachedKeyfromAttribution = {
          firstKeyfrom: attribution.firstKeyfrom || '',
          latestKeyfrom: attribution.latestKeyfrom || '',
        };
        return cachedKeyfromAttribution;
      })
      .catch(error => {
        keyfromAttributionPromise = null;
        writeReporterLog('warn', 'failed to load keyfrom attribution for analytics', error);
        return null;
      });
  }
  return keyfromAttributionPromise;
};

const getWindowPlatform = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.electron?.platform || '';
};

const getWindowArch = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.electron?.arch || '';
};

export const buildLogUrl = (
  params: LogEventParams,
  options: BuildLogUrlOptions = {},
): string => {
  const url = new URL(LogReporterEndpoint.Disabled);
  const config = configService.getConfig();
  const userId = options.userId ?? store.getState().auth.user?.yid ?? '';
  const firstKeyfrom = options.firstKeyfrom ?? cachedKeyfromAttribution?.firstKeyfrom;
  const latestKeyfrom = options.latestKeyfrom ?? cachedKeyfromAttribution?.latestKeyfrom;
  const installationId = options.installationId ?? cachedInstallationId;
  const logParams: Record<string, LogParamValue> = {
    ...params,
    ...logCommons,
    app_version: options.appVersion ?? cachedAppVersion,
    os_platform: options.platform ?? getWindowPlatform(),
    os_arch: options.arch ?? getWindowArch(),
    language: options.language ?? config.language,
    uuid: installationId,
    firstKeyfrom,
    latestKeyfrom,
    is_logged_in: userId.trim().length > 0,
    log_Usid: userId,
    uts: options.timestamp ?? Date.now(),
  };

  Object.entries(logParams).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  });

  return url.href;
};

export const reportYdAnalyzer = async (params: LogEventParams): Promise<boolean> => {
  if (!isLegacyCloudEnabled()) {
    writeReporterLog('debug', `skipped event ${params.action} because legacy analytics is disabled`);
    return false;
  }

  if (configService.getConfig().usageAnalyticsEnabled === false) {
    writeReporterLog('debug', `skipped event ${params.action} because usage analytics is disabled`);
    return false;
  }

  if (!params.action.trim()) {
    writeReporterLog('warn', 'skipped an event without an action');
    return false;
  }

  if (!params.action.startsWith(LogReporterActionPrefix.YuzhhAi)) {
    writeReporterLog('warn', 'skipped an event without the Yuzhh AI action prefix');
    return false;
  }

  try {
    await Promise.all([
      getWindowAppVersion(),
      getInstallationIdForAnalytics(),
      getWindowKeyfromAttribution(),
    ]);
    writeReporterLog('debug', `sending event ${params.action}`);
    const response = await window.electron.api.fetch({
      url: buildLogUrl(params),
      method: 'GET',
      headers: {},
    });

    if (!response.ok) {
      writeReporterLog('warn', `event ${params.action} failed with status ${response.status}`);
      return false;
    }

    writeReporterLog('debug', `sent event ${params.action} successfully`);
    return true;
  } catch (error) {
    writeReporterLog('warn', `event ${params.action} failed`, error);
    return false;
  }
};
