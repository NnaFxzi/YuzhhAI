import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  DomesticResearchMode,
  DomesticResearchSourceId,
} from '../shared/agent/domesticResearch';
import { AgentDomesticResearchStore } from './agentDomesticResearchStore';

let db: Database.Database;
let store: AgentDomesticResearchStore;

beforeEach(() => {
  db = new Database(':memory:');
  store = new AgentDomesticResearchStore(db);
});

afterEach(() => {
  db.close();
});

describe('AgentDomesticResearchStore', () => {
  test('returns default platform settings when no row exists', () => {
    const config = store.getAgentSettings('agent-a');

    expect(config.sources.douyin.enabled).toBe(true);
    expect(config.sources.douyin.modes).toEqual([DomesticResearchMode.UrlImport]);
    expect(config.sources.douyin.urls).toEqual([]);
    expect(config.sources.bilibili.modes).toEqual([DomesticResearchMode.Search, DomesticResearchMode.UrlImport]);
  });

  test('saves and reads per-agent source toggles', () => {
    store.saveAgentSettings('agent-a', {
      sources: {
        ...store.getAgentSettings('agent-a').sources,
        [DomesticResearchSourceId.Douyin]: {
          enabled: false,
          modes: [DomesticResearchMode.UrlImport],
          urls: [],
        },
      },
      customSources: [],
    });

    const config = store.getAgentSettings('agent-a');

    expect(config.sources.douyin.enabled).toBe(false);
    expect(config.sources.bilibili.enabled).toBe(true);
  });

  test('saves and reads built-in source links', () => {
    store.saveAgentSettings('agent-a', {
      sources: {
        ...store.getAgentSettings('agent-a').sources,
        [DomesticResearchSourceId.Xiaohongshu]: {
          enabled: true,
          modes: [DomesticResearchMode.UrlImport],
          urls: ['https://www.xiaohongshu.com/explore/abc'],
        },
      },
      customSources: [],
    });

    const config = store.getAgentSettings('agent-a');

    expect(config.sources.xiaohongshu.urls).toEqual([
      'https://www.xiaohongshu.com/explore/abc',
    ]);
  });

  test('falls back to defaults when stored json is invalid', () => {
    db.prepare(`
      INSERT INTO agent_domestic_research_settings (agent_id, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run('agent-a', '{invalid', 1, 1);

    expect(store.getAgentSettings('agent-a').sources.douyin.enabled).toBe(true);
  });

  test('deletes orphaned agent settings', () => {
    store.saveAgentSettings('agent-a', store.getAgentSettings('agent-a'));

    expect(store.deleteAgentSettings('agent-a')).toBe(1);
    expect(store.getAgentSettings('agent-a').sources.douyin.enabled).toBe(true);
  });
});
