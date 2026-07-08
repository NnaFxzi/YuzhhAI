import Database from 'better-sqlite3';

import {
  AgentExternalResearchMode,
  buildDefaultExternalResearchConfig,
  type ExternalResearchConfig,
  type ExternalResearchEditConfig,
  ExternalResearchSettingsScope,
  getEffectiveExternalResearchConfig,
  type MaskedExternalResearchConfig,
  maskExternalResearchConfig,
  mergeExternalResearchEditConfig,
  normalizeExternalResearchConfig,
} from '../shared/agent/externalResearch';
import { SharedCredentialStore } from './sharedCredentialStore';

type ExternalResearchRow = {
  agent_id: string;
  config_json: string;
};

export class AgentExternalResearchStore {
  constructor(
    private readonly db: Database.Database,
    private readonly sharedCredentials?: SharedCredentialStore,
  ) {
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_external_research_settings (
        agent_id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  getAppDefaults(): ExternalResearchConfig {
    return this.withSharedProviderCredentials(
      this.getRawSettings(ExternalResearchSettingsScope.AppDefault) ??
        buildDefaultExternalResearchConfig(AgentExternalResearchMode.Override),
    );
  }

  getMaskedAppDefaults(): MaskedExternalResearchConfig {
    return maskExternalResearchConfig(this.getAppDefaults());
  }

  saveAppDefaults(config: ExternalResearchConfig): ExternalResearchConfig {
    const saved = this.saveRawSettings(ExternalResearchSettingsScope.AppDefault, {
      ...normalizeExternalResearchConfig(config),
      mode: AgentExternalResearchMode.Override,
    });
    this.saveSharedProviderCredentials(saved);
    return saved;
  }

  saveAppDefaultsEdit(edit: ExternalResearchEditConfig): ExternalResearchConfig {
    return this.saveAppDefaults(mergeExternalResearchEditConfig(this.getAppDefaults(), edit));
  }

  getAgentSettings(agentId: string): ExternalResearchConfig {
    return this.withSharedProviderCredentials(
      this.getRawSettings(agentId) ??
        buildDefaultExternalResearchConfig(AgentExternalResearchMode.Inherit),
    );
  }

  getMaskedAgentSettings(agentId: string): MaskedExternalResearchConfig {
    return maskExternalResearchConfig(this.getAgentSettings(agentId));
  }

  saveAgentSettings(agentId: string, config: ExternalResearchConfig): ExternalResearchConfig {
    return this.saveRawSettings(agentId, normalizeExternalResearchConfig(config));
  }

  saveAgentSettingsEdit(agentId: string, edit: ExternalResearchEditConfig): ExternalResearchConfig {
    return this.saveAgentSettings(
      agentId,
      mergeExternalResearchEditConfig(this.getAgentSettings(agentId), edit),
    );
  }

  getEffectiveSettings(agentId: string): ExternalResearchConfig {
    return getEffectiveExternalResearchConfig(
      this.getAgentSettings(agentId),
      this.getAppDefaults(),
    );
  }

  getMaskedEffectiveSettings(agentId: string): MaskedExternalResearchConfig {
    return maskExternalResearchConfig(this.getEffectiveSettings(agentId));
  }

  deleteAgentSettings(agentId: string): number {
    const result = this.db
      .prepare('DELETE FROM agent_external_research_settings WHERE agent_id = ?')
      .run(agentId);
    return result.changes;
  }

  private getRawSettings(agentId: string): ExternalResearchConfig | null {
    const row = this.db
      .prepare(
        'SELECT agent_id, config_json FROM agent_external_research_settings WHERE agent_id = ?',
      )
      .get(agentId) as ExternalResearchRow | undefined;
    if (!row) return null;
    try {
      return normalizeExternalResearchConfig(JSON.parse(row.config_json) as unknown);
    } catch {
      return buildDefaultExternalResearchConfig(
        agentId === ExternalResearchSettingsScope.AppDefault
          ? AgentExternalResearchMode.Override
          : AgentExternalResearchMode.Inherit,
      );
    }
  }

  private saveRawSettings(agentId: string, config: ExternalResearchConfig): ExternalResearchConfig {
    const normalized = normalizeExternalResearchConfig(config);
    const now = Date.now();
    this.db
      .prepare(
        `
        INSERT INTO agent_external_research_settings (agent_id, config_json, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(agent_id) DO UPDATE SET
          config_json = excluded.config_json,
          updated_at = excluded.updated_at
      `,
      )
      .run(agentId, JSON.stringify(normalized), now, now);
    return normalized;
  }

  private withSharedProviderCredentials(config: ExternalResearchConfig): ExternalResearchConfig {
    if (!this.sharedCredentials) return config;
    const shared = this.sharedCredentials.getMany(['TAVILY_API_KEY', 'FIRECRAWL_API_KEY']);
    return {
      ...config,
      providers: {
        tavily: {
          ...config.providers.tavily,
          apiKey: config.providers.tavily.apiKey || shared.TAVILY_API_KEY || '',
        },
        firecrawl: {
          ...config.providers.firecrawl,
          apiKey: config.providers.firecrawl.apiKey || shared.FIRECRAWL_API_KEY || '',
        },
      },
    };
  }

  private saveSharedProviderCredentials(config: ExternalResearchConfig): void {
    this.sharedCredentials?.setMany({
      TAVILY_API_KEY: config.providers.tavily.apiKey,
      FIRECRAWL_API_KEY: config.providers.firecrawl.apiKey,
    });
  }
}
