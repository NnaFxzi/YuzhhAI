import { describe, expect, test } from 'vitest';

import {
  normalizePromotionMonitoringScheduleContext,
  PromotionMonitoringReason,
} from './promotionContracts';

const validContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  agentId: 'promotion_account_monitoring',
  idempotencyKey: 'window-1',
  metricSource: {
    channel: 'xiaohongshu',
    accountName: 'LobsterAI',
    capturedAt: '2026-07-14T08:00:00+08:00',
    impressions: 100,
    clicks: 10,
    interactions: 6,
    leads: 2,
    cost: 32,
    sourceId: 'metrics-1',
    periodStart: '2026-07-07T08:00:00+08:00',
    periodEnd: '2026-07-14T07:59:59+08:00',
  },
  window: {
    start: '2026-07-07T08:00:00+08:00',
    end: '2026-07-14T07:59:59+08:00',
  },
};

describe('promotion monitoring schedule contracts', () => {
  test('canonicalizes equivalent metric periods and monitoring windows before claiming a run', () => {
    const result = normalizePromotionMonitoringScheduleContext(validContext);

    expect(result.reasons).toEqual([]);
    expect(result.context).toMatchObject({
      metricSource: {
        capturedAt: '2026-07-14T00:00:00.000Z',
        periodStart: '2026-07-07T00:00:00.000Z',
        periodEnd: '2026-07-13T23:59:59.000Z',
      },
      window: {
        start: '2026-07-07T00:00:00.000Z',
        end: '2026-07-13T23:59:59.000Z',
      },
    });
  });

  test('turns malformed non-empty period timestamps into a safe monitoring reason', () => {
    const result = normalizePromotionMonitoringScheduleContext({
      ...validContext,
      metricSource: { ...validContext.metricSource, periodStart: 'not-an-iso-timestamp' },
    });

    expect(result.context).toBeNull();
    expect(result.reasons).toContain(PromotionMonitoringReason.MetricPeriod);
  });
});
