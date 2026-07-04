import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import {
  GeneratedAssetStatus,
  IndustryPackChannel,
  IndustryPackId,
} from '../../shared/industryPack/constants';
import { IndustryPackStore } from './industryPackStore';

const createStore = (): { db: Database.Database; store: IndustryPackStore } => {
  const db = new Database(':memory:');
  return {
    db,
    store: new IndustryPackStore(db),
  };
};

describe('IndustryPackStore', () => {
  let db: Database.Database | undefined;
  let store: IndustryPackStore;

  const setupStore = (): void => {
    const setup = createStore();
    db = setup.db;
    store = setup.store;
  };

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  test('creates a workspace and saves generated assets', () => {
    setupStore();

    const workspace = store.ensureWorkspace({
      packId: IndustryPackId.HeavyPackaging,
      name: '东莞重包包装厂推广工作台',
    });
    expect(db.prepare('SELECT id FROM industry_workspaces WHERE id = ?').get(workspace.id))
      .toEqual({ id: workspace.id });

    const asset = store.createGeneratedAsset({
      workspaceId: workspace.id,
      taskId: 'task-1',
      packId: IndustryPackId.HeavyPackaging,
      channel: IndustryPackChannel.WechatMoments,
      theme: 'anti_damage',
      tone: 'boss',
      title: '80kg 零部件包装怎么防破损',
      body: '根据重量、尺寸和运输方式设计重型纸箱结构。',
      keywords: ['重型纸箱', '防破损'],
      cta: '发送尺寸和重量评估包装方案',
      status: GeneratedAssetStatus.Draft,
    });

    expect(store.listGeneratedAssets(workspace.id)).toEqual([asset]);
    expect(store.getGeneratedAsset(asset.id)).toEqual(asset);
  });

  test('returns the existing workspace for the same pack', () => {
    setupStore();

    const workspace = store.ensureWorkspace({
      packId: IndustryPackId.HeavyPackaging,
      name: '东莞重包包装厂推广工作台',
    });
    const secondWorkspace = store.ensureWorkspace({
      packId: IndustryPackId.HeavyPackaging,
      name: '另一个名称',
    });
    const rows = db.prepare('SELECT id FROM industry_workspaces').all();

    expect(secondWorkspace).toEqual(workspace);
    expect(rows).toHaveLength(1);
  });

  test('rejects generated assets when the pack does not match the workspace', () => {
    setupStore();

    const workspace = store.ensureWorkspace({
      packId: IndustryPackId.HeavyPackaging,
      name: '东莞重包包装厂推广工作台',
    });

    expect(() => store.createGeneratedAsset({
      workspaceId: workspace.id,
      taskId: 'task-1',
      packId: 'other-pack',
      channel: IndustryPackChannel.WechatMoments,
      theme: 'anti_damage',
      tone: 'boss',
      title: '80kg 零部件包装怎么防破损',
      body: '根据重量、尺寸和运输方式设计重型纸箱结构。',
      keywords: ['重型纸箱', '防破损'],
      cta: '发送尺寸和重量评估包装方案',
    })).toThrow('Generated asset packId does not match workspace packId');
  });

  test('orders assets deterministically when created timestamps match', () => {
    setupStore();

    const workspace = store.ensureWorkspace({
      packId: IndustryPackId.HeavyPackaging,
      name: '东莞重包包装厂推广工作台',
    });
    const firstAsset = store.createGeneratedAsset({
      workspaceId: workspace.id,
      taskId: 'task-1',
      packId: IndustryPackId.HeavyPackaging,
      channel: IndustryPackChannel.WechatMoments,
      theme: 'anti_damage',
      tone: 'boss',
      title: '第一条',
      body: '第一条内容',
      keywords: ['重型纸箱'],
      cta: '发送尺寸和重量评估包装方案',
    });
    const secondAsset = store.createGeneratedAsset({
      workspaceId: workspace.id,
      taskId: 'task-2',
      packId: IndustryPackId.HeavyPackaging,
      channel: IndustryPackChannel.WechatGroup,
      theme: 'anti_damage',
      tone: 'boss',
      title: '第二条',
      body: '第二条内容',
      keywords: ['防破损'],
      cta: '发送尺寸和重量评估包装方案',
    });

    db.prepare(`
      UPDATE industry_generated_assets
      SET created_at = ?, updated_at = ?
    `).run('2026-07-03T00:00:00.000Z', '2026-07-03T00:00:00.000Z');

    expect(store.listGeneratedAssets(workspace.id).map(asset => asset.id)).toEqual([
      secondAsset.id,
      firstAsset.id,
    ]);
  });

  test('returns an empty keyword list when stored keyword JSON is invalid', () => {
    setupStore();

    const workspace = store.ensureWorkspace({
      packId: IndustryPackId.HeavyPackaging,
      name: '东莞重包包装厂推广工作台',
    });
    const asset = store.createGeneratedAsset({
      workspaceId: workspace.id,
      taskId: 'task-1',
      packId: IndustryPackId.HeavyPackaging,
      channel: IndustryPackChannel.WechatMoments,
      theme: 'anti_damage',
      tone: 'boss',
      title: '80kg 零部件包装怎么防破损',
      body: '根据重量、尺寸和运输方式设计重型纸箱结构。',
      keywords: ['重型纸箱', '防破损'],
      cta: '发送尺寸和重量评估包装方案',
    });

    db.prepare('UPDATE industry_generated_assets SET keywords = ? WHERE id = ?').run(
      '{"broken":',
      asset.id,
    );

    expect(store.listGeneratedAssets(workspace.id)[0].keywords).toEqual([]);
  });

  test('saves and reads the latest positioning report for a pack', () => {
    setupStore();

    const first = store.createPositioningReport({
      packId: IndustryPackId.HeavyPackaging,
      agentId: 'marketing',
      requestedBy: 'agent',
      recommendedDirectionId: 'wooden_box_replacement',
      providerAvailability: { tavily: true, firecrawl: false },
      sourceCounts: { searchResults: 3, extractedPages: 0 },
      sourceSummary: { lanes: [] },
      candidates: [
        {
          id: 'wooden_box_replacement',
          name: '替代木箱包装',
          summary: '适合出口重货。',
          scores: {},
          keywords: ['替代木箱'],
          painPoints: ['木箱成本高'],
          competitorSignals: ['厂家直销'],
          opportunitySignals: ['方案表达不足'],
          recommendedChannels: ['baidu_seo'],
          missingFacts: ['案例'],
        },
      ],
      backupDirectionIds: [],
      nextActions: ['生成百度 SEO 文章'],
    });
    const second = store.createPositioningReport({
      packId: IndustryPackId.HeavyPackaging,
      agentId: 'content',
      requestedBy: 'agent',
      recommendedDirectionId: 'honeycomb_carton',
      providerAvailability: { tavily: false, firecrawl: true },
      sourceCounts: { searchResults: 1, extractedPages: 2 },
      sourceSummary: { lanes: [] },
      candidates: [
        {
          id: 'honeycomb_carton',
          name: '蜂窝纸箱',
          summary: '适合缓冲包装。',
          scores: {},
          keywords: ['蜂窝纸箱'],
          painPoints: ['大件易损'],
          competitorSignals: ['缓冲包装'],
          opportunitySignals: ['轻量化表达'],
          recommendedChannels: ['wechat_moments'],
          missingFacts: [],
        },
      ],
      backupDirectionIds: ['wooden_box_replacement'],
      nextActions: ['生成朋友圈案例'],
    });

    expect(store.getPositioningReport(first.id)?.recommendedDirectionId).toBe('wooden_box_replacement');
    expect(store.getPositioningReport(first.id)?.agentId).toBe('marketing');
    expect(store.getPositioningReport(first.id)?.providerAvailability).toEqual({ tavily: true, firecrawl: false });
    expect(store.getPositioningReport(first.id)?.sourceCounts).toEqual({ searchResults: 3, extractedPages: 0 });
    expect(store.getLatestPositioningReport(IndustryPackId.HeavyPackaging)?.id).toBe(second.id);
    expect(store.getLatestPositioningReport(IndustryPackId.HeavyPackaging, 'marketing')?.id).toBe(first.id);
    expect(store.getLatestPositioningReport(IndustryPackId.HeavyPackaging, 'content')?.id).toBe(second.id);
  });
});
