import { describe, expect, test } from 'vitest';

import {
  AgentExternalResearchMode,
  buildDefaultExternalResearchConfig,
  buildDefaultExternalResearchEditConfig,
  createExternalResearchEditConfigFromMasked,
  ExternalResearchProviderId,
  ExternalResearchSecretEditAction,
  getEffectiveExternalResearchConfig,
  maskExternalResearchConfig,
  mergeExternalResearchEditConfig,
  normalizeExternalResearchConfig,
  redactExternalResearchSecret,
} from './externalResearch';

describe('external research config helpers', () => {
  test('normalizes provider config without requiring environment variables', () => {
    const config = normalizeExternalResearchConfig({
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: { enabled: true, apiKey: ' tvly-test ' },
        firecrawl: { enabled: false, apiKey: ' fc-test ' },
      },
    });

    expect(config.mode).toBe(AgentExternalResearchMode.Override);
    expect(config.providers.tavily).toEqual({ enabled: true, apiKey: 'tvly-test' });
    expect(config.providers.firecrawl).toEqual({ enabled: false, apiKey: 'fc-test' });
  });

  test('uses app defaults for an agent in inherit mode', () => {
    const appDefault = normalizeExternalResearchConfig({
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: { enabled: true, apiKey: 'tvly-default' },
        firecrawl: { enabled: true, apiKey: 'fc-default' },
      },
    });
    const agent = buildDefaultExternalResearchConfig(AgentExternalResearchMode.Inherit);

    expect(getEffectiveExternalResearchConfig(agent, appDefault)).toEqual(appDefault);
  });

  test('masks secrets for renderer summaries', () => {
    const masked = maskExternalResearchConfig(normalizeExternalResearchConfig({
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: { enabled: true, apiKey: 'tvly-1234567890' },
        firecrawl: { enabled: true, apiKey: 'fc-abcdef123456' },
      },
    }));

    expect(masked.providers[ExternalResearchProviderId.Tavily].hasApiKey).toBe(true);
    expect(masked.providers[ExternalResearchProviderId.Tavily].apiKeyPreview).toBe('tvly...7890');
    expect(masked.providers[ExternalResearchProviderId.Firecrawl].apiKeyPreview).toBe('fc-a...3456');
    expect(JSON.stringify(masked)).not.toContain('1234567890');
  });

  test('merges edit payloads without exposing preserved keys to the renderer', () => {
    const existing = normalizeExternalResearchConfig({
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: { enabled: true, apiKey: 'tvly-existing' },
        firecrawl: { enabled: true, apiKey: 'fc-existing' },
      },
    });
    const edit = buildDefaultExternalResearchEditConfig(AgentExternalResearchMode.Override);
    edit.providers.tavily.enabled = false;
    edit.providers.tavily.apiKeyAction = ExternalResearchSecretEditAction.Preserve;
    edit.providers.firecrawl.enabled = true;
    edit.providers.firecrawl.apiKeyAction = ExternalResearchSecretEditAction.Clear;

    const merged = mergeExternalResearchEditConfig(existing, edit);

    expect(merged.providers.tavily).toEqual({ enabled: false, apiKey: 'tvly-existing' });
    expect(merged.providers.firecrawl).toEqual({ enabled: true, apiKey: '' });
  });

  test('builds edit config from masked summaries using preserve for existing keys', () => {
    const edit = createExternalResearchEditConfigFromMasked({
      mode: AgentExternalResearchMode.Override,
      providers: {
        tavily: { enabled: true, hasApiKey: true, apiKeyPreview: 'tvly...ting' },
        firecrawl: { enabled: false, hasApiKey: false, apiKeyPreview: '' },
      },
    });

    expect(edit.providers.tavily).toEqual({
      enabled: true,
      apiKeyAction: ExternalResearchSecretEditAction.Preserve,
      apiKey: '',
    });
    expect(edit.providers.firecrawl.apiKeyAction).toBe(ExternalResearchSecretEditAction.Clear);
  });

  test('redacts known key values from error strings', () => {
    const redacted = redactExternalResearchSecret(
      'Authorization failed for tvly-secret and fc-secret',
      ['tvly-secret', 'fc-secret'],
    );

    expect(redacted).toBe('Authorization failed for [redacted] and [redacted]');
  });
});
