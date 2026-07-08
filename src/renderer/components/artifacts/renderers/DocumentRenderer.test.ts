import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { supplementDocxPageNumberText } from './DocumentRenderer';

describe('DocumentRenderer preview chrome', () => {
  test('does not render a global page-count strip above original documents', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./DocumentRenderer.tsx', import.meta.url)),
      'utf8',
    );

    expect(source).not.toContain(
      'shrink-0 border-b border-[#e0e0e0] px-3 py-1.5 text-xs text-[#999]',
    );
    expect(source).not.toContain('artifactPdfPageCount');
  });

  test('rewrites repeated DOCX page-one footer labels for each rendered page', () => {
    expect(supplementDocxPageNumberText('第 1 页', 3, 9)).toBe('第 3 页');
    expect(supplementDocxPageNumberText('第1页 / 共1页', 3, 9)).toBe('第 3 页 / 共 9 页');
    expect(supplementDocxPageNumberText('第 页 / 共 页', 3, 9)).toBe('第 3 页 / 共 9 页');
    expect(supplementDocxPageNumberText('Page 1 of 1', 3, 9)).toBe('Page 3 of 9');
  });
});
