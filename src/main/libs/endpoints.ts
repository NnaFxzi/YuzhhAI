import { app } from 'electron';

import {
  isLegacyCloudEnabled,
  LocalIndependentCloud,
} from '../../shared/cloudCapabilities/constants';
import { HtmlSharePublicRoute } from '../../shared/htmlShare/constants';
import type { SqliteStore } from '../sqliteStore';

let cachedTestMode: boolean | null = null;

/**
 * Read testMode from store and cache it.
 * Call once at startup and again whenever app_config changes.
 */
export function refreshEndpointsTestMode(store: SqliteStore): void {
  const appConfig = store.get<any>('app_config');
  cachedTestMode = appConfig?.app?.testMode === true;
}

/**
 * Whether the app is in test mode.
 * Uses cached value after init; falls back to !app.isPackaged before init.
 */
export const isTestModeEnabled = (): boolean => {
  return cachedTestMode ?? !app.isPackaged;
};

/**
 * Server API base URL — switches based on testMode.
 * Used for auth exchange/refresh, models, proxy, etc.
 */
export const getServerApiBaseUrl = (): string => {
  return LocalIndependentCloud.DisabledEndpoint;
};

export const getHtmlSharePublicBaseUrl = (): string => {
  if (!isLegacyCloudEnabled()) return LocalIndependentCloud.DisabledEndpoint;
  return `${getServerApiBaseUrl()}${HtmlSharePublicRoute.Root}`;
};

export const getUpdateCheckUrl = (): string => LocalIndependentCloud.DisabledEndpoint;

export const getManualUpdateCheckUrl = (): string => LocalIndependentCloud.DisabledEndpoint;

export const getFallbackDownloadUrl = (): string => LocalIndependentCloud.DownloadUrl;

export const getSkillStoreUrl = (): string => LocalIndependentCloud.DisabledEndpoint;

export const getPortalTasksUrl = (): string => LocalIndependentCloud.AccountUrl;

export const getKitStoreUrl = (): string => LocalIndependentCloud.DisabledEndpoint;
