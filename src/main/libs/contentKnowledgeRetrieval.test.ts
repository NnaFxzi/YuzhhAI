import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import {
  buildContentKnowledgeIndex,
  ContentKnowledgeSourceType,
  searchContentKnowledgeIndex,
} from './contentKnowledgeRetrieval';
import { ContentKnowledgeVectorStore } from './contentKnowledgeVectorStore';

describe('content knowledge retrieval', () => {
  test('chunks knowledge sources and stores deterministic embeddings', () => {
    const index = buildContentKnowledgeIndex([
      {
        sourceId: 'user-profile',
        sourceType: ContentKnowledgeSourceType.UserProfile,
        label: 'USER.md',
        content: [
          '这家公司做注塑模具维护服务，主要服务华南制造企业。',
          '决策人是生产主管，主卖点是停机时间更短。',
          '内容要更像真实业务员，不要像广告海报。',
        ].join('\n'),
      },
    ]);

    expect(index.chunks.length).toBeGreaterThan(0);
    expect(index.chunks[0].embedding.length).toBeGreaterThan(16);
    expect(index.chunks[0].checksum).toHaveLength(40);
    expect(index.chunks[0].businessSignalCount).toBeGreaterThanOrEqual(3);
  });

  test('hybrid retrieval can match a content request through business context without exact channel terms', () => {
    const index = buildContentKnowledgeIndex([
      {
        sourceId: 'business-profile',
        sourceType: ContentKnowledgeSourceType.UserProfile,
        label: 'USER.md',
        content:
          '公司做注塑模具维护服务，服务华南制造企业，决策人是生产主管，卖点是减少停机时间和降低售后沟通成本。',
      },
      {
        sourceId: 'generic-preference',
        sourceType: ContentKnowledgeSourceType.Memory,
        label: 'MEMORY.md',
        content: '用户喜欢界面简单，回复尽量使用中文。',
      },
    ]);

    const result = searchContentKnowledgeIndex(index, '帮我做 10 个小红书选题');

    expect(result.matched).toBe(true);
    expect(result.hits[0].chunk.sourceId).toBe('business-profile');
    expect(result.hits[0].chunk.text).toContain('注塑模具维护服务');
    expect(result.hits[0].scores.contextFitScore).toBeGreaterThan(0);
  });

  test('threshold rejects generic preferences even when they mention a content channel', () => {
    const index = buildContentKnowledgeIndex([
      {
        sourceId: 'generic-xhs-style',
        sourceType: ContentKnowledgeSourceType.Memory,
        label: 'MEMORY.md',
        content: '用户喜欢小红书排版简洁，标题不要太夸张，平时使用中文。',
      },
    ]);

    const result = searchContentKnowledgeIndex(index, '帮我做 10 个小红书选题');

    expect(result.matched).toBe(false);
    expect(result.hits).toHaveLength(0);
    expect(result.diagnostics.rejectedCount).toBeGreaterThan(0);
  });

  test('sqlite vector store upserts chunks and retrieves ranked hits by scope', () => {
    const db = new Database(':memory:');
    const store = new ContentKnowledgeVectorStore(db);

    store.upsertSources('agent-main', [
      {
        sourceId: 'factory-profile',
        sourceType: ContentKnowledgeSourceType.UserProfile,
        label: 'USER.md',
        content: '主营工业包装服务，客户是机械设备厂采购负责人，卖点是防破损、免熏蒸和替代木箱。',
      },
    ]);

    const result = store.search('agent-main', '写一段私域销售转化话术');

    expect(result.matched).toBe(true);
    expect(result.hits[0].chunk.text).toContain('工业包装服务');
    expect(result.hits[0].scores.finalScore).toBeGreaterThanOrEqual(
      result.diagnostics.hitThreshold,
    );

    db.close();
  });

  test('sqlite vector store clears stale chunks when a source becomes empty', () => {
    const db = new Database(':memory:');
    const store = new ContentKnowledgeVectorStore(db);

    store.upsertSources('agent-main', [
      {
        sourceId: 'USER.md',
        sourceType: ContentKnowledgeSourceType.UserProfile,
        label: 'USER.md',
        content: '主营工业包装服务，客户是机械设备厂采购负责人，卖点是防破损。',
      },
    ]);
    expect(store.search('agent-main', '帮我做 10 个小红书选题').matched).toBe(true);

    store.upsertSources('agent-main', [
      {
        sourceId: 'USER.md',
        sourceType: ContentKnowledgeSourceType.UserProfile,
        label: 'USER.md',
        content: '',
      },
    ]);

    const result = store.search('agent-main', '帮我做 10 个小红书选题');

    expect(result.matched).toBe(false);
    expect(result.diagnostics.candidateCount).toBe(0);

    db.close();
  });
});
