import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Agent } from '../coworkStore';
import {
  applyContentQualityPromptPatchOverlay,
  applyContentQualityPromptPatchToAgent,
  applyContentQualityPromptPatchToSystemPrompt,
  CONTENT_QUALITY_PROMPT_PATCH_END,
  CONTENT_QUALITY_PROMPT_PATCH_START,
  type ContentQualityPromptPatchRegistry,
  findLatestContentQualityPromptPatchPath,
} from './contentQualityPromptPatchApply';

const makeAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: 'marketing-agent',
  name: '推广agent',
  description: '',
  systemPrompt: '原始推广提示词',
  identity: '',
  model: '',
  workingDirectory: '',
  responseContract: {
    version: 1,
    answerShape: 'copy_ready',
    maxClarifyingQuestions: 2,
    askBeforeAnswering: false,
    mustInclude: [],
    mustAvoid: [],
    qualityChecks: [],
    toolUseHints: [],
  },
  icon: '',
  skillIds: [],
  enabled: true,
  pinned: false,
  pinOrder: null,
  isDefault: false,
  source: 'preset',
  presetId: 'marketing-agent',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('content quality prompt patch application', () => {
  let tmpDir: string | null = null;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  test('applies a prompt patch as a replaceable marked block', () => {
    const first = applyContentQualityPromptPatchToSystemPrompt(
      '基础提示词',
      '[内容质量修复补丁]\n- 先交付正文',
      '2026-07-07T08:30:00.000Z',
    );
    const second = applyContentQualityPromptPatchToSystemPrompt(
      first,
      '[内容质量修复补丁]\n- 保持老板口吻',
      '2026-07-07T09:00:00.000Z',
    );

    expect(first).toContain(CONTENT_QUALITY_PROMPT_PATCH_START);
    expect(first).toContain('[内容质量修复补丁]\n- 先交付正文');
    expect(second).toContain('基础提示词');
    expect(second).toContain('[内容质量修复补丁]\n- 保持老板口吻');
    expect(second).not.toContain('- 先交付正文');
    expect(second.match(new RegExp(CONTENT_QUALITY_PROMPT_PATCH_START, 'g'))).toHaveLength(1);
    expect(second.match(new RegExp(CONTENT_QUALITY_PROMPT_PATCH_END, 'g'))).toHaveLength(1);
  });

  test('stores the patch overlay and backs up the previous effective prompt', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-quality-prompt-patch-'));
    const patchPath = path.join(tmpDir, 'report.prompt-patch.txt');
    fs.writeFileSync(
      patchPath,
      '[内容质量修复补丁]\n- 命中工厂画像时必须先输出正文\n- 不要编造载重和交期',
      'utf8',
    );
    let registry: ContentQualityPromptPatchRegistry = {
      'marketing-agent': {
        agentId: 'marketing-agent',
        promptPatch: '[内容质量修复补丁]\n- 旧补丁',
        appliedAt: '2026-07-06T08:00:00.000Z',
      },
    };
    const setRegistry = vi.fn((next: ContentQualityPromptPatchRegistry) => {
      registry = next;
    });

    const result = await applyContentQualityPromptPatchToAgent({
      agentId: ' marketing-agent ',
      promptPatchPath: patchPath,
      backupDir: path.join(tmpDir, 'backups'),
      now: new Date('2026-07-07T08:30:00.000Z'),
      getAgent: id => (id === 'marketing-agent' ? makeAgent() : null),
      getRegistry: () => registry,
      setRegistry,
    });

    expect(result).toMatchObject({
      agentId: 'marketing-agent',
      appliedAt: '2026-07-07T08:30:00.000Z',
      promptPatchPath: patchPath,
    });
    expect(fs.readFileSync(result.backupPath, 'utf8')).toContain('原始推广提示词');
    expect(fs.readFileSync(result.backupPath, 'utf8')).toContain('- 旧补丁');
    expect(setRegistry).toHaveBeenCalledWith({
      'marketing-agent': {
        agentId: 'marketing-agent',
        promptPatch: '[内容质量修复补丁]\n- 命中工厂画像时必须先输出正文\n- 不要编造载重和交期',
        promptPatchPath: patchPath,
        appliedAt: '2026-07-07T08:30:00.000Z',
      },
    });
  });

  test('overlays stored patches onto agents without mutating the input list', () => {
    const agent = makeAgent();
    const patched = applyContentQualityPromptPatchOverlay([agent], {
      'marketing-agent': {
        agentId: 'marketing-agent',
        promptPatch: '[内容质量修复补丁]\n- 朋友圈先出正文',
        appliedAt: '2026-07-07T08:30:00.000Z',
      },
    });

    expect(patched[0].systemPrompt).toContain('原始推广提示词');
    expect(patched[0].systemPrompt).toContain('- 朋友圈先出正文');
    expect(agent.systemPrompt).toBe('原始推广提示词');
  });

  test('rejects empty patches and missing agents before writing registry state', async () => {
    const setRegistry = vi.fn();

    await expect(
      applyContentQualityPromptPatchToAgent({
        agentId: 'marketing-agent',
        promptPatch: '   ',
        backupDir: '/tmp/unused',
        getAgent: () => makeAgent(),
        getRegistry: () => ({}),
        setRegistry,
      }),
    ).rejects.toThrow(/Prompt patch is empty/);

    await expect(
      applyContentQualityPromptPatchToAgent({
        agentId: 'missing-agent',
        promptPatch: '[内容质量修复补丁]\n- 先出正文',
        backupDir: '/tmp/unused',
        getAgent: () => null,
        getRegistry: () => ({}),
        setRegistry,
      }),
    ).rejects.toThrow(/Agent not found/);

    expect(setRegistry).not.toHaveBeenCalled();
  });

  test('finds the newest generated prompt patch file in a report directory', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-quality-prompt-patch-latest-'));
    const oldPatch = path.join(
      tmpDir,
      'content-quality-regression-2026-07-07-08-00-00.prompt-patch.txt',
    );
    const newPatch = path.join(
      tmpDir,
      'content-quality-regression-2026-07-07-09-00-00.prompt-patch.txt',
    );
    const markdownReport = path.join(tmpDir, 'content-quality-regression-2026-07-07-09-00-00.md');
    fs.writeFileSync(oldPatch, 'old', 'utf8');
    fs.writeFileSync(newPatch, 'new', 'utf8');
    fs.writeFileSync(markdownReport, '# report', 'utf8');
    fs.utimesSync(
      oldPatch,
      new Date('2026-07-07T08:00:00.000Z'),
      new Date('2026-07-07T08:00:00.000Z'),
    );
    fs.utimesSync(
      newPatch,
      new Date('2026-07-07T09:00:00.000Z'),
      new Date('2026-07-07T09:00:00.000Z'),
    );

    expect(findLatestContentQualityPromptPatchPath(tmpDir)).toBe(newPatch);
    expect(findLatestContentQualityPromptPatchPath(path.join(tmpDir, 'missing'))).toBeNull();
  });
});
