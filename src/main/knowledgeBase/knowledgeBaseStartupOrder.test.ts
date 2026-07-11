import fs from 'node:fs';

import { describe, expect, test } from 'vitest';

describe('knowledge base startup order', () => {
  test('registers handlers and starts recovery only after the SQLite store is initialized', () => {
    const mainSource = fs.readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
    const initAppStart = mainSource.indexOf('const initApp = async () => {');
    const initAppEnd = mainSource.indexOf('\n  // 启动应用', initAppStart);
    const initAppSource = mainSource.slice(initAppStart, initAppEnd);
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

    const cleanupStart = mainSource.indexOf('const runAppCleanup = async');
    const cleanupEnd = mainSource.indexOf("app.on('before-quit'", cleanupStart);
    expect(cleanupStart).toBeGreaterThanOrEqual(0);
    expect(cleanupEnd).toBeGreaterThan(cleanupStart);
    const cleanupSource = mainSource.slice(cleanupStart, cleanupEnd);
    const shutdownIndex = cleanupSource.indexOf('knowledgeBaseFoundation.shutdown()');
    const closeIndex = cleanupSource.indexOf('getStore().close()');
    expect(shutdownIndex).toBeGreaterThanOrEqual(0);
    expect(closeIndex).toBeGreaterThanOrEqual(0);
    expect(shutdownIndex).toBeLessThan(closeIndex);
  });
});
