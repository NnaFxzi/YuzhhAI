import { createRequire } from 'node:module';

import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const safety = require('../scripts/openclaw-patch-safety.cjs') as {
  OpenClawPatchCheckState: {
    AlreadyApplied: string;
    NeedsApply: string;
  };
  assertOpenClawSourcePatchApplyAllowed: (params: {
    openclawSrc: string;
    status: string;
    patchAffectedPaths?: string[];
  }) => void;
  assertOpenClawSourceResetAllowed: (params: {
    openclawSrc: string;
    status: string;
    allowReset: boolean;
  }) => void;
  formatDirtyOpenClawPatchApplyMessage: (openclawSrc: string, status: string) => string;
  formatDirtyOpenClawSourceMessage: (openclawSrc: string, status: string) => string;
  isOpenClawPatchResetAllowed: (env: Record<string, string | undefined>) => boolean;
  normalizeGitStatus: (status: unknown) => string;
  parseOpenClawGitStatusPaths: (status: string) => string[];
  parseOpenClawPatchAffectedPaths: (patchText: string) => string[];
  resolveOpenClawPatchCheckState: (params: {
    patchFile: string;
    reverseOk: boolean;
    forwardOk: boolean;
    forwardCheckError?: string | null;
    hasStrongValidator: boolean;
    strongValidatorPassed: boolean;
  }) => string;
};

describe('openclaw patch safety helpers', () => {
  test('normalizes empty git status output', () => {
    expect(safety.normalizeGitStatus('\n')).toBe('');
    expect(safety.normalizeGitStatus(' M file.ts\n')).toBe('M file.ts');
  });

  test('parses dirty paths from git porcelain output', () => {
    expect(
      safety.parseOpenClawGitStatusPaths(
        [' M src/agents/attempt.ts', '?? src/new-file.ts', 'R  src/old.ts -> src/new.ts'].join(
          '\n',
        ),
      ),
    ).toEqual(['src/agents/attempt.ts', 'src/new-file.ts', 'src/new.ts', 'src/old.ts']);
  });

  test('parses affected paths from patch text', () => {
    expect(
      safety.parseOpenClawPatchAffectedPaths(
        [
          'diff --git a/src/skills/loading/plugin-skills.test.ts b/src/skills/loading/plugin-skills.test.ts',
          'index f7533faf..57a4ddc7 100644',
          'diff --git a/src/skills/loading/plugin-skills.ts b/src/skills/loading/plugin-skills.ts',
        ].join('\n'),
      ),
    ).toEqual(['src/skills/loading/plugin-skills.test.ts', 'src/skills/loading/plugin-skills.ts']);
  });

  test('blocks dirty OpenClaw resets by default', () => {
    expect(() =>
      safety.assertOpenClawSourceResetAllowed({
        openclawSrc: '/repo/openclaw',
        status: ' M src/file.ts\n?? scratch.txt\n',
        allowReset: false,
      }),
    ).toThrow('Refusing to reset dirty OpenClaw source: /repo/openclaw');
  });

  test('allows dirty OpenClaw reset only with explicit opt-in', () => {
    expect(() =>
      safety.assertOpenClawSourceResetAllowed({
        openclawSrc: '/repo/openclaw',
        status: ' M src/file.ts\n',
        allowReset: true,
      }),
    ).not.toThrow();
  });

  test('blocks new patch application when the OpenClaw source started dirty', () => {
    expect(() =>
      safety.assertOpenClawSourcePatchApplyAllowed({
        openclawSrc: '/repo/openclaw',
        status: ' M src/file.ts\n',
      }),
    ).toThrow('Refusing to apply new patches to dirty OpenClaw source: /repo/openclaw');
  });

  test('blocks new patch application when patch paths overlap dirty OpenClaw paths', () => {
    expect(() =>
      safety.assertOpenClawSourcePatchApplyAllowed({
        openclawSrc: '/repo/openclaw',
        status: ' M src/skills/loading/plugin-skills.ts\n',
        patchAffectedPaths: [
          'src/skills/loading/plugin-skills.test.ts',
          'src/skills/loading/plugin-skills.ts',
        ],
      }),
    ).toThrow('The patch touches paths that already have local changes');
  });

  test('allows new patch application on dirty OpenClaw source when patch paths do not overlap', () => {
    expect(() =>
      safety.assertOpenClawSourcePatchApplyAllowed({
        openclawSrc: '/repo/openclaw',
        status: ' M src/agents/attempt.ts\n?? src/agents/new-test.ts\n',
        patchAffectedPaths: [
          'src/skills/loading/plugin-skills.test.ts',
          'src/skills/loading/plugin-skills.ts',
        ],
      }),
    ).not.toThrow();
  });

  test('allows new patch application when the OpenClaw source started clean', () => {
    expect(() =>
      safety.assertOpenClawSourcePatchApplyAllowed({
        openclawSrc: '/repo/openclaw',
        status: '\n',
      }),
    ).not.toThrow();
  });

  test('reads the destructive reset opt-in environment flag exactly', () => {
    expect(safety.isOpenClawPatchResetAllowed({ LOBSTERAI_OPENCLAW_PATCH_RESET: '1' })).toBe(true);
    expect(safety.isOpenClawPatchResetAllowed({ LOBSTERAI_OPENCLAW_PATCH_RESET: 'true' })).toBe(
      false,
    );
    expect(safety.isOpenClawPatchResetAllowed({})).toBe(false);
  });

  test('treats reverse-check success as already applied without needing a validator', () => {
    expect(
      safety.resolveOpenClawPatchCheckState({
        patchFile: 'custom.patch',
        reverseOk: true,
        forwardOk: false,
        forwardCheckError: null,
        hasStrongValidator: false,
        strongValidatorPassed: false,
      }),
    ).toBe(safety.OpenClawPatchCheckState.AlreadyApplied);
  });

  test('preserves idempotent skip behavior when strong validation confirms an ambiguous patch', () => {
    expect(
      safety.resolveOpenClawPatchCheckState({
        patchFile: 'validated.patch',
        reverseOk: false,
        forwardOk: false,
        forwardCheckError: 'error: validated.patch: already exists in working directory',
        hasStrongValidator: true,
        strongValidatorPassed: true,
      }),
    ).toBe(safety.OpenClawPatchCheckState.AlreadyApplied);
  });

  test('fails closed for ambiguous unvalidated patches instead of guessing from git stderr', () => {
    expect(() =>
      safety.resolveOpenClawPatchCheckState({
        patchFile: 'custom.patch',
        reverseOk: false,
        forwardOk: false,
        forwardCheckError:
          'error: foo.ts: already exists in working directory\nerror: patch failed: foo.ts:1',
        hasStrongValidator: false,
        strongValidatorPassed: false,
      }),
    ).toThrow('Patch check was ambiguous for custom.patch');
  });

  test('fails closed when a strong validator exists but does not confirm the ambiguous patch', () => {
    expect(() =>
      safety.resolveOpenClawPatchCheckState({
        patchFile: 'validated.patch',
        reverseOk: false,
        forwardOk: false,
        forwardCheckError: 'error: patch failed: foo.ts:1\nerror: foo.ts: patch does not apply',
        hasStrongValidator: true,
        strongValidatorPassed: false,
      }),
    ).toThrow('Strong validation did not confirm the patch');
  });

  test('fails closed when forward check fails without stderr', () => {
    expect(() =>
      safety.resolveOpenClawPatchCheckState({
        patchFile: 'silent.patch',
        reverseOk: false,
        forwardOk: false,
        forwardCheckError: '',
        hasStrongValidator: false,
        strongValidatorPassed: false,
      }),
    ).toThrow('Patch check was ambiguous for silent.patch');
  });

  test('returns needs-apply only when forward check succeeds', () => {
    expect(
      safety.resolveOpenClawPatchCheckState({
        patchFile: 'clean.patch',
        reverseOk: false,
        forwardOk: true,
        forwardCheckError: '',
        hasStrongValidator: false,
        strongValidatorPassed: false,
      }),
    ).toBe(safety.OpenClawPatchCheckState.NeedsApply);
  });
});
