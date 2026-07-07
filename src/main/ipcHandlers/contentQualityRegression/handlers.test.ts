import { beforeEach, describe, expect, test, vi } from 'vitest';

const { registeredHandlers } = vi.hoisted(() => ({
  registeredHandlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

import { ContentQualityRegressionIpc } from '../../../shared/contentQualityRegression/constants';
import {
  type ContentQualityRegressionHandlerDeps,
  registerContentQualityRegressionHandlers,
} from './handlers';

const makeDeps = (): {
  deps: ContentQualityRegressionHandlerDeps;
  runReportJob: ContentQualityRegressionHandlerDeps['runReportJob'];
  applyPromptPatchToAgent: NonNullable<
    ContentQualityRegressionHandlerDeps['applyPromptPatchToAgent']
  >;
  syncOpenClawConfig: NonNullable<ContentQualityRegressionHandlerDeps['syncOpenClawConfig']>;
} => {
  const runReportJob = vi.fn(async ({ cases }) => ({
    reportPath: '/tmp/content-quality-regression.md',
    promptPatchPath: '/tmp/content-quality-regression.prompt-patch.txt',
    markdown: '# report',
    report: {
      total: cases.length,
      passed: cases.length,
      failed: 0,
      passRate: 1,
      averageScore: 9,
      results: [],
      rewriteCases: [],
    },
  }));
  const applyPromptPatchToAgent = vi.fn(async () => ({
    agentId: 'marketing-agent',
    appliedAt: '2026-07-07T08:30:00.000Z',
    backupPath: '/tmp/content-quality/backups/agent-marketing-agent-system-prompt.md',
    promptPatchPath: '/tmp/content-quality-regression.prompt-patch.txt',
  }));
  const syncOpenClawConfig = vi.fn(async () => undefined);

  return {
    deps: {
      getReportDir: () => '/tmp/content-quality',
      generator: {
        complete: vi.fn(async () => 'generated'),
      },
      evaluator: {
        complete: vi.fn(
          async () => '{"scores":{},"shouldRewrite":false,"reasons":[],"rewriteFocus":[]}',
        ),
      },
      runReportJob,
      applyPromptPatchToAgent,
      syncOpenClawConfig,
    },
    runReportJob,
    applyPromptPatchToAgent,
    syncOpenClawConfig,
  };
};

beforeEach(() => {
  registeredHandlers.clear();
});

describe('registerContentQualityRegressionHandlers', () => {
  test('runs a report job and returns the report summary', async () => {
    const { deps, runReportJob } = makeDeps();
    registerContentQualityRegressionHandlers(deps);

    const handler = registeredHandlers.get(ContentQualityRegressionIpc.RunReport);
    expect(handler).toBeDefined();

    const result = await handler?.(undefined, { caseLimit: 2 });

    expect(runReportJob).toHaveBeenCalledWith(
      expect.objectContaining({
        cases: expect.arrayContaining([expect.objectContaining({ id: expect.any(String) })]),
        reportDir: '/tmp/content-quality',
        generator: deps.generator,
        evaluator: deps.evaluator,
      }),
    );
    expect(runReportJob.mock.calls[0][0].cases).toHaveLength(2);
    expect(result).toEqual({
      success: true,
      reportPath: '/tmp/content-quality-regression.md',
      promptPatchPath: '/tmp/content-quality-regression.prompt-patch.txt',
      total: 2,
      passed: 2,
      failed: 0,
      passRate: 1,
      averageScore: 9,
    });
  });

  test('selects explicit cases by id', async () => {
    const { deps, runReportJob } = makeDeps();
    registerContentQualityRegressionHandlers(deps);

    const handler = registeredHandlers.get(ContentQualityRegressionIpc.RunReport);
    const result = await handler?.(undefined, {
      caseIds: ['moments-single-heavy-packaging'],
    });

    expect(runReportJob.mock.calls[0][0].cases).toHaveLength(1);
    expect(runReportJob.mock.calls[0][0].cases[0].id).toBe('moments-single-heavy-packaging');
    expect(result).toMatchObject({
      success: true,
      total: 1,
    });
  });

  test('rejects malformed case limits before running the job', async () => {
    const { deps, runReportJob } = makeDeps();
    registerContentQualityRegressionHandlers(deps);

    const handler = registeredHandlers.get(ContentQualityRegressionIpc.RunReport);
    const result = await handler?.(undefined, { caseLimit: 0 });

    expect(runReportJob).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: 'Content quality regression caseLimit must be between 1 and 20',
    });
  });

  test('rejects unknown case ids before running the job', async () => {
    const { deps, runReportJob } = makeDeps();
    registerContentQualityRegressionHandlers(deps);

    const handler = registeredHandlers.get(ContentQualityRegressionIpc.RunReport);
    const result = await handler?.(undefined, { caseIds: ['missing-case'] });

    expect(runReportJob).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: 'Unknown content quality regression case id: missing-case',
    });
  });

  test('applies a generated prompt patch to an agent and syncs OpenClaw config', async () => {
    const { deps, applyPromptPatchToAgent, syncOpenClawConfig } = makeDeps();
    registerContentQualityRegressionHandlers(deps);

    const handler = registeredHandlers.get(ContentQualityRegressionIpc.ApplyPromptPatchToAgent);
    expect(handler).toBeDefined();

    const result = await handler?.(undefined, {
      agentId: ' marketing-agent ',
      promptPatchPath: ' /tmp/content-quality-regression.prompt-patch.txt ',
    });

    expect(applyPromptPatchToAgent).toHaveBeenCalledWith({
      agentId: 'marketing-agent',
      promptPatchPath: '/tmp/content-quality-regression.prompt-patch.txt',
    });
    expect(syncOpenClawConfig).toHaveBeenCalledWith('content-quality-prompt-patch-applied');
    expect(result).toEqual({
      success: true,
      agentId: 'marketing-agent',
      appliedAt: '2026-07-07T08:30:00.000Z',
      backupPath: '/tmp/content-quality/backups/agent-marketing-agent-system-prompt.md',
      promptPatchPath: '/tmp/content-quality-regression.prompt-patch.txt',
    });
  });

  test('rejects malformed prompt patch apply requests before writing agent state', async () => {
    const { deps, applyPromptPatchToAgent, syncOpenClawConfig } = makeDeps();
    registerContentQualityRegressionHandlers(deps);

    const handler = registeredHandlers.get(ContentQualityRegressionIpc.ApplyPromptPatchToAgent);
    const result = await handler?.(undefined, {
      agentId: 'marketing-agent',
      promptPatchPath: '   ',
    });

    expect(applyPromptPatchToAgent).not.toHaveBeenCalled();
    expect(syncOpenClawConfig).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: 'Content quality prompt patch request requires promptPatch or promptPatchPath',
    });
  });
});
