import { describe, expect, test } from 'vitest';

import { resolveKnowledgeDocumentIndexWorkerPath } from './knowledgeDocumentIndexWorkerPath';

describe('resolveKnowledgeDocumentIndexWorkerPath', () => {
  test('resolves development and packaged worker bundles', () => {
    expect(resolveKnowledgeDocumentIndexWorkerPath({
      isPackaged: false,
      moduleDirectory: '/repo/dist-electron',
      resourcesPath: '/Applications/LobsterAI.app/Contents/Resources',
    })).toBe('/repo/dist-electron/knowledge-index-worker.js');
    expect(resolveKnowledgeDocumentIndexWorkerPath({
      isPackaged: true,
      moduleDirectory: '/ignored',
      resourcesPath: '/Applications/LobsterAI.app/Contents/Resources',
    })).toBe(
      '/Applications/LobsterAI.app/Contents/Resources/app.asar.unpacked/dist-electron/knowledge-index-worker.js',
    );
  });
});
