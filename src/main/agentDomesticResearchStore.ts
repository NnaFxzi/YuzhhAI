import Database from 'better-sqlite3';

import {
  buildDefaultDomesticResearchConfig,
  type DomesticResearchConfig,
  normalizeDomesticResearchConfig,
} from '../shared/agent/domesticResearch';

type DomesticResearchRow = {
  agent_id: string;
  config_json: string;
};

export class AgentDomesticResearchStore {
  constructor(private readonly db: Database.Database) {
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_domestic_research_settings (
        agent_id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  getAgentSettings(agentId: string): DomesticResearchConfig {
    return this.getRawSettings(agentId) ?? buildDefaultDomesticResearchConfig();
  }

  saveAgentSettings(agentId: string, config: DomesticResearchConfig): DomesticResearchConfig {
    const normalized = normalizeDomesticResearchConfig(config);
    const now = Date.now();
    this.db
      .prepare(`
        INSERT INTO agent_domestic_research_settings (agent_id, config_json, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(agent_id) DO UPDATE SET
          config_json = excluded.config_json,
          updated_at = excluded.updated_at
      `)
      .run(agentId, JSON.stringify(normalized), now, now);
    return normalized;
  }

  deleteAgentSettings(agentId: string): number {
    const result = this.db
      .prepare('DELETE FROM agent_domestic_research_settings WHERE agent_id = ?')
      .run(agentId);
    return result.changes;
  }

  private getRawSettings(agentId: string): DomesticResearchConfig | null {
    const row = this.db
      .prepare('SELECT agent_id, config_json FROM agent_domestic_research_settings WHERE agent_id = ?')
      .get(agentId) as DomesticResearchRow | undefined;
    if (!row) return null;
    try {
      return normalizeDomesticResearchConfig(JSON.parse(row.config_json) as unknown);
    } catch {
      return buildDefaultDomesticResearchConfig();
    }
  }
}
