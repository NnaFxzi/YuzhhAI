import { describe, expect, test } from 'vitest';

import { expectPatchContains, readCurrentOpenClawPatch } from './patchTestUtils';

const PATCH_FILE = 'openclaw-plugin-skill-symlink-idempotent.patch';

describe('openclaw-plugin-skill-symlink-idempotent.patch', () => {
  test('keeps the idempotent symlink behavior in the current OpenClaw patch set', () => {
    expectPatchContains(PATCH_FILE, [
      'code === "EEXIST"',
      'fs.realpathSync(linkPath) === fs.realpathSync(target)',
      'activeLinkPaths.add(linkPath)',
      'managedTargets.has(entry.name) && activeLinkPaths.has(path.join(pluginSkillsDir, entry.name))',
      'isGeneratedPluginSkillEntry(existingEntry)',
      'logger: log',
      'keeps existing generated plugin skill symlinks that already point at the target',
      'failed to create plugin skill symlink',
      'testing.logger',
    ]);
  });

  test('declares the test target before creating the pre-existing symlink', () => {
    const patch = readCurrentOpenClawPatch(PATCH_FILE);
    const targetDeclaration = 'const target = path.join(skillParent, "browser-automation");';
    const symlinkCall = 'fsSync.symlinkSync(target, linkPath, "dir");';

    expect(patch).toContain(targetDeclaration);
    expect(patch).toContain(symlinkCall);
    expect(patch.indexOf(targetDeclaration)).toBeLessThan(patch.indexOf(symlinkCall));
  });
});
