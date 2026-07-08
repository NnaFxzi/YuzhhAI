import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  AgentExternalResearchMode,
  ExternalResearchProviderId,
  ExternalResearchSecretEditAction,
} from '../shared/agent/externalResearch';
import { AgentExternalResearchStore } from './agentExternalResearchStore';
import { SharedCredentialStore } from './sharedCredentialStore';

let db: Database.Database;
let store: AgentExternalResearchStore;

beforeEach(() => {
  db = new Database(':memory:');
  store = new AgentExternalResearchStore(db);
});

afterEach(() => {
  db.close();
});

describe('AgentExternalResearchStore', () => {
  test('returns disabled app defaults when no row exists', () => {
    const defaults = store.getAppDefaults();

    expect(defaults.mode).toBe(AgentExternalResearchMode.Override);
    expect(defaults.providers.tavily.enabled).toBe(false);
    expect(defaults.providers.firecrawl.apiKey).toBe('');
  });

  test('saves and reads app defaults with raw keys only in main store', () => {
    store.saveAppDefaults({
      mode: AgentExternalResearchMode.Override,
      providers: {
        [ExternalResearchProviderId.Tavily]: { enabled: true, apiKey: 'tvly-main' },
        [ExternalResearchProviderId.Firecrawl]: { enabled: true, apiKey: 'fc-main' },
      },
    });

    expect(store.getAppDefaults().providers.tavily.apiKey).toBe('tvly-main');
    expect(store.getMaskedAppDefaults().providers.tavily.apiKeyPreview).toBe('tvly...main');
  });

  test('shares app default provider keys through the shared credential store', () => {
    const credentialStore = new SharedCredentialStore(':memory:');
    store = new AgentExternalResearchStore(db, credentialStore);

    store.saveAppDefaults({
      mode: AgentExternalResearchMode.Override,
      providers: {
        [ExternalResearchProviderId.Tavily]: { enabled: true, apiKey: 'tvly-shared' },
        [ExternalResearchProviderId.Firecrawl]: { enabled: true, apiKey: 'fc-shared' },
      },
    });

    expect(credentialStore.getMany(['TAVILY_API_KEY', 'FIRECRAWL_API_KEY'])).toEqual({
      TAVILY_API_KEY: 'tvly-shared',
      FIRECRAWL_API_KEY: 'fc-shared',
    });
  });

  test('uses shared credentials as provider key fallback without changing enabled flags', () => {
    const credentialStore = new SharedCredentialStore(':memory:');
    credentialStore.setMany({
      TAVILY_API_KEY: 'tvly-global',
      FIRECRAWL_API_KEY: 'fc-global',
    });
    store = new AgentExternalResearchStore(db, credentialStore);

    const defaults = store.getAppDefaults();

    expect(defaults.providers.tavily).toEqual({ enabled: false, apiKey: 'tvly-global' });
    expect(defaults.providers.firecrawl).toEqual({ enabled: false, apiKey: 'fc-global' });
  });

  test('agent settings inherit app defaults by default', () => {
    const config = store.getAgentSettings('agent-a');

    expect(config.mode).toBe(AgentExternalResearchMode.Inherit);
    expect(config.providers.tavily.enabled).toBe(false);
  });

  test('saves per-agent override and resolves effective config', () => {
    store.saveAppDefaults({
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: { enabled: true, apiKey: 'tvly-default' },
        firecrawl: { enabled: false, apiKey: '' },
      },
    });
    store.saveAgentSettings('agent-a', {
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: { enabled: false, apiKey: '' },
        firecrawl: { enabled: true, apiKey: 'fc-agent' },
      },
    });

    const effective = store.getEffectiveSettings('agent-a');

    expect(effective.providers.tavily.enabled).toBe(false);
    expect(effective.providers.firecrawl.apiKey).toBe('fc-agent');
  });

  test('preserves existing api key when edit payload asks to preserve', () => {
    store.saveAgentSettings('agent-a', {
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: { enabled: true, apiKey: 'tvly-existing' },
        firecrawl: { enabled: false, apiKey: '' },
      },
    });

    store.saveAgentSettingsEdit('agent-a', {
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: {
          enabled: true,
          apiKeyAction: ExternalResearchSecretEditAction.Preserve,
          apiKey: '',
        },
        firecrawl: {
          enabled: false,
          apiKeyAction: ExternalResearchSecretEditAction.Clear,
          apiKey: '',
        },
      },
    });

    expect(store.getAgentSettings('agent-a').providers.tavily.apiKey).toBe('tvly-existing');
  });

  test('clears existing api key when edit payload asks to clear', () => {
    store.saveAgentSettings('agent-a', {
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: { enabled: true, apiKey: 'tvly-existing' },
        firecrawl: { enabled: false, apiKey: '' },
      },
    });

    store.saveAgentSettingsEdit('agent-a', {
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: {
          enabled: true,
          apiKeyAction: ExternalResearchSecretEditAction.Clear,
          apiKey: '',
        },
        firecrawl: {
          enabled: false,
          apiKeyAction: ExternalResearchSecretEditAction.Clear,
          apiKey: '',
        },
      },
    });

    expect(store.getAgentSettings('agent-a').providers.tavily.apiKey).toBe('');
  });

  test('deletes orphaned agent settings', () => {
    store.saveAgentSettings('agent-a', {
      mode: AgentExternalResearchMode.Disabled,
      providers: {
        tavily: { enabled: false, apiKey: '' },
        firecrawl: { enabled: false, apiKey: '' },
      },
    });

    expect(store.deleteAgentSettings('agent-a')).toBe(1);
    expect(store.getAgentSettings('agent-a').mode).toBe(AgentExternalResearchMode.Inherit);
  });
});
