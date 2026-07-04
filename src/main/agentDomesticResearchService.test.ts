import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  buildDefaultDomesticResearchConfig,
  DomesticResearchStatus,
} from '../shared/agent/domesticResearch';
import { AgentDomesticResearchService } from './agentDomesticResearchService';

const store = {
  getAgentSettings: vi.fn(),
  saveAgentSettings: vi.fn(),
};

beforeEach(() => {
  vi.restoreAllMocks();
  store.getAgentSettings.mockReset();
  store.saveAgentSettings.mockReset();
});

describe('AgentDomesticResearchService', () => {
  test('returns source status payload for an agent', () => {
    store.getAgentSettings.mockReturnValue(buildDefaultDomesticResearchConfig());
    const service = new AgentDomesticResearchService({ store });

    const payload = service.getStatusPayload('agent-a');

    expect(payload.settings.sources.douyin.enabled).toBe(true);
    expect(payload.statuses.douyin.status).toBe(DomesticResearchStatus.LinkImportOnly);
    expect(payload.statuses.bilibili.status).toBe(DomesticResearchStatus.Available);
  });

  test('saves normalized source settings', () => {
    const saved = buildDefaultDomesticResearchConfig();
    store.saveAgentSettings.mockReturnValue(saved);
    const service = new AgentDomesticResearchService({ store });

    const result = service.saveSettings('agent-a', {
      sources: {
        douyin: { enabled: false },
        unknown: { enabled: true },
      },
    });

    expect(result.sources.douyin.enabled).toBe(true);
    expect(store.saveAgentSettings).toHaveBeenCalledWith('agent-a', expect.objectContaining({
      sources: expect.objectContaining({
        douyin: expect.objectContaining({ enabled: false }),
      }),
    }));
  });
});
