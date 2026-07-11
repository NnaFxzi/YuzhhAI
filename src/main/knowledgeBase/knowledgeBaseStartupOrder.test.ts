import fs from 'node:fs';

import { describe, expect, test } from 'vitest';

describe('knowledge base startup order', () => {
  test('registers handlers and starts recovery only after the SQLite store is initialized', () => {
    const source = fs.readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
    const initAppStart = source.indexOf('const initApp = async () => {');
    const initAppEnd = source.indexOf('\n  // 启动应用', initAppStart);
    const initAppSource = source.slice(initAppStart, initAppEnd);
    const storeInitialization = initAppSource.indexOf('store = await initStore();');
    const foundationCreation = initAppSource.indexOf(
      'const knowledgeBase = getKnowledgeBaseFoundation();',
    );
    const handlerRegistration = initAppSource.indexOf('registerKnowledgeBaseHandlers({');
    const recoveryStart = initAppSource.indexOf('.recoverMigrateAndStart(');

    expect(initAppStart).toBeGreaterThan(-1);
    expect(initAppEnd).toBeGreaterThan(initAppStart);
    expect(storeInitialization).toBeGreaterThan(-1);
    expect(foundationCreation).toBeGreaterThan(storeInitialization);
    expect(handlerRegistration).toBeGreaterThan(foundationCreation);
    expect(recoveryStart).toBeGreaterThan(handlerRegistration);
  });
});
