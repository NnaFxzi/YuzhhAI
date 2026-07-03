import fs from 'node:fs';

import * as XLSX from 'xlsx';

export interface ExportableAsset {
  title: string;
  channel: string;
  theme: string;
  body: string;
  keywords: string[];
  cta: string;
}

export interface CalendarAsset {
  day: number;
  channel: string;
  theme: string;
  title: string;
  body: string;
  cta: string;
}

export function renderAssetMarkdown(asset: ExportableAsset): string {
  return [
    `# ${asset.title}`,
    '',
    `- 渠道：${asset.channel}`,
    `- 主题：${asset.theme}`,
    `- 关键词：${asset.keywords.join('、')}`,
    '',
    asset.body,
    '',
    `行动引导：${asset.cta}`,
  ].join('\n');
}

export function renderCalendarCsvCompatibleRows(
  assets: CalendarAsset[],
): Array<Record<string, string | number>> {
  return assets.map(asset => ({
    day: asset.day,
    channel: asset.channel,
    theme: asset.theme,
    title: asset.title,
    body: asset.body,
    cta: asset.cta,
  }));
}

export function writeMarkdownExport(filePath: string, markdown: string): void {
  fs.writeFileSync(filePath, markdown, 'utf8');
}

export function writeExcelExport(
  filePath: string,
  rows: Array<Record<string, unknown>>,
): void {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, '内容日历');
  XLSX.writeFile(workbook, filePath);
}
