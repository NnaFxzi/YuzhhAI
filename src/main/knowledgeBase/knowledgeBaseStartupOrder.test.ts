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

    const cleanupStart = mainSource.indexOf("const runAppCleanup = (reason = 'quit')");
    const cleanupEnd = mainSource.indexOf("app.on('before-quit'", cleanupStart);
    expect(cleanupStart).toBeGreaterThanOrEqual(0);
    expect(cleanupEnd).toBeGreaterThan(cleanupStart);
    const cleanupSource = mainSource.slice(cleanupStart, cleanupEnd);
    const shutdownIndex = cleanupSource.indexOf('knowledgeBaseFoundation.shutdown()');
    const closeIndex = cleanupSource.indexOf('getStore().close()');
    expect(shutdownIndex).toBeGreaterThanOrEqual(0);
    expect(closeIndex).toBeGreaterThanOrEqual(0);
    expect(shutdownIndex).toBeLessThan(closeIndex);

    const deleteAdapterStart = mainSource.indexOf('deleteWorkspace: workspaceId =>');
    const deleteAdapterEnd = mainSource.indexOf('updateWorkspaceProfile:', deleteAdapterStart);
    const deleteAdapter = mainSource.slice(deleteAdapterStart, deleteAdapterEnd);
    expect(deleteAdapter).toContain(
      'getEnterpriseLeadWorkspaceService().deleteWorkspace(workspaceId)',
    );
    expect(deleteAdapter).not.toContain('.transaction(');
    expect(deleteAdapter).not.toContain('deleteWorkspaceData');

    const compositionStart = mainSource.indexOf(
      'const getEnterpriseLeadWorkspaceService = (): EnterpriseLeadWorkspaceService =>',
    );
    const compositionEnd = mainSource.indexOf(
      'const getAgentExternalResearchStore = (): AgentExternalResearchStore =>',
      compositionStart,
    );
    const compositionSource = mainSource.slice(compositionStart, compositionEnd);
    expect(compositionSource.match(/modelClient: getEnterpriseKnowledgeModelClient\(\)/g))
      .toHaveLength(2);
    expect(compositionSource.match(/contentKnowledgeVectorStore: getContentKnowledgeVectorStore\(\)/g))
      .toHaveLength(2);
    expect(compositionSource).toContain(
      'prepareWorkspaceDeletion: workspaceId =>\n' +
      '        getKnowledgeBaseFoundation().prepareWorkspaceDeletion(workspaceId)',
    );

    const legacyShutdownIndex = cleanupSource.indexOf('enterpriseLeadWorkspaceService.shutdown()');
    expect(legacyShutdownIndex).toBeGreaterThanOrEqual(0);
    expect(legacyShutdownIndex).toBeLessThan(shutdownIndex);
    expect(cleanupSource).toContain('knowledgeBaseFoundation.trackLegacyWork(');
    expect(mainSource).not.toContain("console.error('[KnowledgeBase] Shadow migration failed:', error)");
    expect(mainSource).toContain(
      "console.error('[KnowledgeBase] Startup failed [KNOWLEDGE_BASE_STARTUP_FAILED]')",
    );

    expect(cleanupSource).toContain('appCleanupPromise');
    expect(cleanupSource).not.toMatch(/console\.(?:error|warn)[^\n]*error\b/);

    expect(mainSource).toMatch(/let appCleanupPromise:\s*Promise<void>\s*\|\s*null\s*=\s*null/);
    expect(mainSource).toMatch(
      /const runAppCleanup = \(reason = 'quit'\): Promise<void> => \{/,
    );
    expect(mainSource).not.toContain('const runAppCleanup = async');
    expect(cleanupSource).toMatch(/if \(appCleanupPromise\)\s*return appCleanupPromise/);
    expect(cleanupSource).toContain('appCleanupPromise =');
    expect(cleanupSource).toContain('return appCleanupPromise;');
    const beforeQuitSource = mainSource.slice(
      mainSource.indexOf("app.on('before-quit'"),
      mainSource.indexOf('const handleTerminationSignal'),
    );
    const signalSource = mainSource.slice(
      mainSource.indexOf('const handleTerminationSignal'),
      mainSource.indexOf('// 初始化应用'),
    );
    expect(beforeQuitSource).toContain('runAppCleanup()');
    expect(signalSource).toContain('runAppCleanup()');
    expect(signalSource).toContain("process.once('SIGINT'");
    expect(signalSource).toContain("process.once('SIGTERM'");
  });
});
