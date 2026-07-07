import { describe, expect, test } from 'vitest';

import { resolvePromptPasteDecision } from './promptPasteUtils';

const makeClipboardFile = (name: string) => ({ name });

describe('resolvePromptPasteDecision', () => {
  test('keeps native text paste when clipboard payload also includes files', () => {
    const imageFile = makeClipboardFile('screenshot.png');

    const decision = resolvePromptPasteDecision({
      files: [imageFile],
      types: ['text/plain', 'Files'],
      getData: format => (format === 'text/plain' ? 'hello from clipboard' : ''),
    });

    expect(decision.files).toEqual([imageFile]);
    expect(decision.shouldPreventDefault).toBe(false);
  });

  test('prevents native paste for file-only clipboard payloads', () => {
    const imageFile = makeClipboardFile('screenshot.png');

    const decision = resolvePromptPasteDecision({
      files: [imageFile],
      types: ['Files'],
      getData: () => '',
    });

    expect(decision.files).toEqual([imageFile]);
    expect(decision.shouldPreventDefault).toBe(true);
  });

  test('uses file clipboard items when the files list is empty', () => {
    const imageFile = makeClipboardFile('screenshot.png');

    const decision = resolvePromptPasteDecision({
      files: [],
      items: [
        {
          kind: 'file',
          getAsFile: () => imageFile,
        },
      ],
      types: ['Files'],
      getData: () => '',
    });

    expect(decision.files).toEqual([imageFile]);
    expect(decision.shouldPreventDefault).toBe(true);
  });
});
