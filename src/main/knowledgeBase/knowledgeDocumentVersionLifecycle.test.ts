import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

test('routes every production version replacement through KnowledgeDocumentService', () => {
  const callers = globSync('src/main/**/*.ts')
    .filter(filePath => !filePath.endsWith('.test.ts'))
    .filter(filePath => readFileSync(filePath, 'utf8').includes('documentStore.addVersion('))
    .map(filePath => path.normalize(filePath));

  expect(callers).toEqual([
    path.normalize('src/main/knowledgeBase/knowledgeDocumentService.ts'),
  ]);
});
