import { describe, expect, test } from 'vitest';

import {
  renderAssetMarkdown,
  renderCalendarCsvCompatibleRows,
} from './exportService';

describe('exportService', () => {
  test('renders a generated asset as markdown', () => {
    const markdown = renderAssetMarkdown({
      title: '重型纸箱防破损方案',
      channel: 'wechat_moments',
      theme: 'anti_damage',
      body: '根据重量和运输方式设计包装。',
      keywords: ['重型纸箱', '防破损'],
      cta: '发送尺寸和重量评估方案',
    });

    expect(markdown).toContain('# 重型纸箱防破损方案');
    expect(markdown).toContain('重型纸箱');
    expect(markdown).toContain('行动引导：发送尺寸和重量评估方案');
  });

  test('renders calendar rows for spreadsheet export', () => {
    const rows = renderCalendarCsvCompatibleRows([
      {
        day: 1,
        channel: 'wechat_moments',
        theme: 'anti_damage',
        title: '第 1 天内容',
        body: '内容正文',
        cta: '联系评估',
      },
    ]);

    expect(rows[0]).toEqual({
      day: 1,
      channel: 'wechat_moments',
      theme: 'anti_damage',
      title: '第 1 天内容',
      body: '内容正文',
      cta: '联系评估',
    });
  });
});
