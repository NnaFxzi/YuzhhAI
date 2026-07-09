import {
  AgentExternalResearchMode,
  type ExternalResearchEditConfig,
  ExternalResearchProviderId,
  ExternalResearchProviderIds,
  ExternalResearchSecretEditAction,
  type MaskedExternalResearchConfig,
} from '@shared/agent/externalResearch';
import { describe, expect, test } from 'vitest';

import {
  getExternalResearchApiKeyDraftFromInput,
  getExternalResearchApiKeyInputState,
  getExternalResearchSummary,
  getExternalResearchTestFeedback,
  SAVED_EXTERNAL_RESEARCH_SECRET_INPUT_VALUE,
} from './agentExternalResearchUi';

const createEditConfig = (): ExternalResearchEditConfig => ({
  mode: AgentExternalResearchMode.Override,
  providers: {
    [ExternalResearchProviderId.Tavily]: {
      enabled: true,
      apiKeyAction: ExternalResearchSecretEditAction.Replace,
      apiKey: 'tvly-test',
    },
    [ExternalResearchProviderId.Firecrawl]: {
      enabled: false,
      apiKeyAction: ExternalResearchSecretEditAction.Preserve,
      apiKey: '',
    },
  },
});

const createDefaults = (): MaskedExternalResearchConfig => ({
  mode: AgentExternalResearchMode.Inherit,
  providers: {
    [ExternalResearchProviderId.Tavily]: {
      enabled: true,
      hasApiKey: true,
      apiKeyPreview: 'tvly...test',
    },
    [ExternalResearchProviderId.Firecrawl]: {
      enabled: false,
      hasApiKey: false,
      apiKeyPreview: '',
    },
  },
});

describe('agent external research UI helpers', () => {
  test('maps successful provider tests to a success tone', () => {
    expect(
      getExternalResearchTestFeedback({ ok: true, message: 'Connection successful.' }),
    ).toEqual({
      icon: 'success',
      labelKey: 'agentExternalResearchTestSuccess',
      message: 'Connection successful.',
      toneClassName:
        'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    });
  });

  test('maps failed provider tests to an error tone', () => {
    expect(getExternalResearchTestFeedback({ ok: false, message: 'Invalid API key' })).toEqual({
      icon: 'error',
      labelKey: 'agentExternalResearchTestFailed',
      message: 'Invalid API key',
      toneClassName: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
    });
  });

  test('summarizes override provider readiness from edit config', () => {
    expect(getExternalResearchSummary(createEditConfig(), createDefaults()).providers).toEqual({
      configured: 1,
      enabled: 1,
      total: 2,
    });
  });

  test('counts preserved override API keys as configured only when saved', () => {
    const value = createEditConfig();
    value.providers[ExternalResearchProviderId.Tavily].apiKey = '';
    value.providers[ExternalResearchProviderId.Tavily].apiKeyAction =
      ExternalResearchSecretEditAction.Preserve;
    const saved = createDefaults();
    saved.mode = AgentExternalResearchMode.Override;
    saved.providers[ExternalResearchProviderId.Firecrawl].hasApiKey = true;

    expect(getExternalResearchSummary(value, createDefaults(), saved).providers).toEqual({
      configured: 2,
      enabled: 1,
      total: ExternalResearchProviderIds.length,
    });
  });

  test('does not count whitespace-only replacement override API keys as configured', () => {
    const value = createEditConfig();
    value.providers[ExternalResearchProviderId.Tavily].apiKey = '   ';
    value.providers[ExternalResearchProviderId.Tavily].apiKeyAction =
      ExternalResearchSecretEditAction.Replace;
    value.providers[ExternalResearchProviderId.Firecrawl].apiKeyAction =
      ExternalResearchSecretEditAction.Replace;

    expect(getExternalResearchSummary(value, createDefaults()).providers).toEqual({
      configured: 0,
      enabled: 1,
      total: ExternalResearchProviderIds.length,
    });
  });

  test('summarizes inherited provider readiness from app defaults', () => {
    const value = createEditConfig();
    value.mode = AgentExternalResearchMode.Inherit;

    expect(getExternalResearchSummary(value, createDefaults())).toEqual({
      mode: AgentExternalResearchMode.Inherit,
      providers: {
        configured: 1,
        enabled: 1,
        total: 2,
      },
    });
  });

  test('summarizes disabled mode as unavailable despite stale provider values', () => {
    const value = createEditConfig();
    value.mode = AgentExternalResearchMode.Disabled;
    value.providers[ExternalResearchProviderId.Firecrawl].enabled = true;
    value.providers[ExternalResearchProviderId.Firecrawl].apiKey = 'fc-stale';
    value.providers[ExternalResearchProviderId.Firecrawl].apiKeyAction =
      ExternalResearchSecretEditAction.Preserve;

    expect(getExternalResearchSummary(value, createDefaults())).toEqual({
      mode: AgentExternalResearchMode.Disabled,
      providers: {
        configured: 0,
        enabled: 0,
        total: ExternalResearchProviderIds.length,
      },
    });
  });

  test('summarizes inherited provider readiness as unavailable without app defaults', () => {
    const value = createEditConfig();
    value.mode = AgentExternalResearchMode.Inherit;

    expect(getExternalResearchSummary(value, null)).toEqual({
      mode: AgentExternalResearchMode.Inherit,
      providers: {
        configured: 0,
        enabled: 0,
        total: ExternalResearchProviderIds.length,
      },
    });
  });

  test('does not count whitespace-only override API keys as configured', () => {
    const value = createEditConfig();
    value.providers[ExternalResearchProviderId.Tavily].apiKey = '   ';

    expect(getExternalResearchSummary(value, createDefaults()).providers).toEqual({
      configured: 0,
      enabled: 1,
      total: ExternalResearchProviderIds.length,
    });
  });

  test('keeps saved provider keys out of editable input state', () => {
    expect(
      getExternalResearchApiKeyInputState(
        {
          enabled: true,
          apiKeyAction: ExternalResearchSecretEditAction.Preserve,
          apiKey: '',
        },
        true,
        true,
      ),
    ).toEqual({
      isSavedSecret: true,
      inputType: 'password',
      placeholderKey: 'agentExternalResearchApiKeySavedPlaceholder',
      value: SAVED_EXTERNAL_RESEARCH_SECRET_INPUT_VALUE,
      canToggleVisibility: false,
      canUseSavedKey: true,
    });
  });

  test('allows only draft provider keys to be shown while editing', () => {
    expect(
      getExternalResearchApiKeyInputState(
        {
          enabled: true,
          apiKeyAction: ExternalResearchSecretEditAction.Replace,
          apiKey: 'tvly-draft',
        },
        true,
        false,
      ),
    ).toEqual({
      isSavedSecret: false,
      inputType: 'text',
      placeholderKey: null,
      value: 'tvly-draft',
      canToggleVisibility: true,
      canUseSavedKey: false,
    });
  });

  test('does not treat unsaved empty preserve edits as saved input state', () => {
    expect(
      getExternalResearchApiKeyInputState(
        {
          enabled: true,
          apiKeyAction: ExternalResearchSecretEditAction.Preserve,
          apiKey: '',
        },
        false,
        false,
      ),
    ).toEqual({
      isSavedSecret: false,
      inputType: 'password',
      placeholderKey: null,
      value: '',
      canToggleVisibility: false,
      canUseSavedKey: false,
    });
  });

  test('turns edits to a backfilled saved key into replacement drafts', () => {
    const inputState = getExternalResearchApiKeyInputState(
      {
        enabled: true,
        apiKeyAction: ExternalResearchSecretEditAction.Preserve,
        apiKey: '',
      },
      false,
      true,
    );

    expect(getExternalResearchApiKeyDraftFromInput(inputState, inputState.value)).toBeNull();
    expect(getExternalResearchApiKeyDraftFromInput(inputState, '***********')).toBeNull();
    expect(getExternalResearchApiKeyDraftFromInput(inputState, `${inputState.value}tvly-new`)).toBe(
      'tvly-new',
    );
    expect(getExternalResearchApiKeyDraftFromInput(inputState, `tvly-new${inputState.value}`)).toBe(
      'tvly-new',
    );
    expect(getExternalResearchApiKeyDraftFromInput(inputState, 'tvly-new')).toBe('tvly-new');
  });
});
