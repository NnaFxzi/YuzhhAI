import { describe, expect, test } from 'vitest';

import {
  buildDevServerUnavailableDataUrl,
  buildDevServerUnavailableHtml,
} from './devServerErrorPage';

describe('dev server error page', () => {
  test('escapes the failed URL before rendering it into HTML', () => {
    const html = buildDevServerUnavailableHtml('http://localhost:5175/?q=<script>');

    expect(html).toContain('http://localhost:5175/?q=&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  test('builds a data URL Electron can load without the dev server', () => {
    const dataUrl = buildDevServerUnavailableDataUrl('http://localhost:5175');

    expect(dataUrl).toMatch(/^data:text\/html;charset=utf-8,/);
    expect(decodeURIComponent(dataUrl)).toContain('开发服务未启动');
  });
});
