'use strict';

/**
 * Apply version-specific LobsterAI patches to the openclaw source tree.
 *
 * Patches are organised in scripts/patches/<version>/ directories, where
 * <version> matches the "openclaw.version" field in package.json (e.g.
 * "v2026.3.2").  Only patches for the currently pinned version are applied.
 *
 * Usage:
 *   node scripts/apply-openclaw-patches.cjs [openclaw-src-dir]
 *
 * If openclaw-src-dir is not specified, defaults to ../openclaw relative to
 * the LobsterAI project root.
 *
 * Safe to run multiple times — already-applied patches are skipped.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  OpenClawPatchCheckState,
  assertOpenClawSourcePatchApplyAllowed,
  assertOpenClawSourceResetAllowed,
  isOpenClawPatchResetAllowed,
  parseOpenClawPatchAffectedPaths,
  resolveOpenClawPatchCheckState,
} = require('./openclaw-patch-safety.cjs');

const rootDir = path.resolve(__dirname, '..');
const openclawSrc = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(rootDir, '..', 'openclaw');

// Read pinned openclaw version from package.json.
const pkg = require(path.join(rootDir, 'package.json'));
const openclawVersion = pkg.openclaw && pkg.openclaw.version;
if (!openclawVersion) {
  console.error('[apply-openclaw-patches] Missing "openclaw.version" in package.json.');
  process.exit(1);
}

const patchesDir = path.join(rootDir, 'scripts', 'patches', openclawVersion);

if (!fs.existsSync(openclawSrc)) {
  console.error(`[apply-openclaw-patches] openclaw source not found: ${openclawSrc}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(openclawSrc, 'package.json'))) {
  console.error(`[apply-openclaw-patches] Not an openclaw project: ${openclawSrc}`);
  process.exit(1);
}

if (!fs.existsSync(patchesDir)) {
  console.log(`[apply-openclaw-patches] No patches directory for ${openclawVersion}, nothing to do.`);
  process.exit(0);
}

const patchFiles = fs.readdirSync(patchesDir)
  .filter(f => f.endsWith('.patch'))
  .sort();

if (patchFiles.length === 0) {
  console.log(`[apply-openclaw-patches] No patches found for ${openclawVersion}, nothing to do.`);
  process.exit(0);
}

console.log(`[apply-openclaw-patches] Applying patches for openclaw ${openclawVersion} (${patchFiles.length} file(s))`);

const strongPatchValidators = {
  'openclaw-dashscope-context-cache.patch': [
    {
      file: 'src/agents/embedded-agent-runner/prompt-cache-retention.ts',
      snippets: [
        'contextCacheProvider === "dashscope"',
        'contextCacheProvider === "anthropic-compatible"',
        'contextCacheMode === "explicit"',
        'explicitContextCacheEligible',
      ],
    },
    {
      file: 'src/llm/providers/openai-completions.ts',
      snippets: [
        'getCompatCacheControl(compat, cacheRetention, options)',
        'options?.contextCacheProvider === "dashscope"',
        'options?.contextCacheProvider === "anthropic-compatible"',
        'options?.contextCacheMode === "explicit"',
        'isOpenAICompatibleExplicitContextCache(options)',
        'EXPLICIT_CONTEXT_CACHE_LOG_PREFIX = "********************"',
        '[ExplicitCachePayload]',
        'hasCacheControl=',
        'cache_control: cacheControl',
        'return { type: "ephemeral", ...(ttl ? { ttl } : {}) };',
      ],
    },
    {
      file: 'src/agents/embedded-agent-runner/extra-params.ts',
      snippets: [
        'contextCacheProvider?: "dashscope" | "anthropic-compatible"',
        'contextCacheMode?: "explicit"',
        'resolveExplicitContextCacheStreamParams',
        'EXPLICIT_CONTEXT_CACHE_LOG_PREFIX = "********************"',
        '[ExplicitCachePassThrough]',
        '...explicitContextCacheParams',
      ],
    },
    {
      file: 'src/agents/openai-transport-stream.ts',
      snippets: [
        'contextCacheProvider?: string',
        'contextCacheMode?: string',
        'isOpenAICompatibleExplicitContextCache',
        'applyOpenAICompletionsExplicitContextCache',
        'EXPLICIT_CONTEXT_CACHE_LOG_PREFIX = "********************"',
        '[ExplicitCachePayload]',
        'cache_control: cacheControl',
      ],
    },
  ],
  'openclaw-user-turn-cache-stability.patch': [
    {
      file: 'src/agents/embedded-agent-runner/run/attempt.llm-boundary.ts',
      snippets: [
        'canonicalizeTextOnlyUserContent',
        'stampUserTextWithMessageTimestamp',
        'currentUserTimestampOverride',
      ],
    },
    {
      file: 'src/gateway/server-methods/agent-timestamp.ts',
      snippets: ['export function buildTimestampPrefix'],
    },
    {
      file: 'src/gateway/server-methods/chat.ts',
      snippets: ['BodyForAgent: messageForAgent'],
    },
    {
      file: 'src/agents/embedded-agent-runner/run/attempt.llm-boundary.cache-stability.test.ts',
      snippets: ['prompt-cache byte-identity', 'turn1AsCurrent', 'turn1AsHistorical'],
    },
  ],
  'openclaw-plugin-skill-symlink-idempotent.patch': [
    {
      file: 'src/skills/loading/plugin-skills.ts',
      snippets: [
        'code === "EEXIST"',
        'fs.realpathSync(linkPath) === fs.realpathSync(target)',
        'activeLinkPaths.add(linkPath)',
        'managedTargets.has(entry.name) && activeLinkPaths.has(path.join(pluginSkillsDir, entry.name))',
        'isGeneratedPluginSkillEntry(existingEntry)',
        'logger: log',
      ],
    },
    {
      file: 'src/skills/loading/plugin-skills.test.ts',
      snippets: [
        'keeps existing generated plugin skill symlinks that already point at the target',
        'const target = path.join(skillParent, "browser-automation");',
        'failed to create plugin skill symlink',
        'testing.logger',
      ],
    },
  ],
};

function collectMissingStrongPatchSnippets(patchFile) {
  const validators = strongPatchValidators[patchFile];
  if (!validators) {
    return [];
  }

  const missing = [];
  for (const validator of validators) {
    const targetPath = path.join(openclawSrc, validator.file);
    if (!fs.existsSync(targetPath)) {
      missing.push(`${validator.file}: file not found`);
      continue;
    }

    const source = fs.readFileSync(targetPath, 'utf8');
    for (const snippet of validator.snippets) {
      if (!source.includes(snippet)) {
        missing.push(`${validator.file}: missing ${JSON.stringify(snippet)}`);
      }
    }
  }
  return missing;
}

function isStrongPatchApplied(patchFile) {
  return collectMissingStrongPatchSnippets(patchFile).length === 0;
}

function assertStrongPatchApplied(patchFile) {
  const missing = collectMissingStrongPatchSnippets(patchFile);
  if (missing.length === 0) {
    return;
  }

  console.error(`[apply-openclaw-patches] Strong validation failed for ${patchFile}.`);
  console.error('[apply-openclaw-patches] The patch was not applied to the actual OpenClaw source tree:');
  for (const item of missing) {
    console.error(`[apply-openclaw-patches]   - ${item}`);
  }
  process.exit(1);
}

let startedWithDirtyOpenClawSource = false;
let initialOpenClawSourceStatus = '';
const allowOpenClawSourceReset = isOpenClawPatchResetAllowed(process.env);

// Do not discard sibling OpenClaw changes by default. A dirty tree may simply
// mean these patches are already applied, so classify patches before refusing.
try {
  initialOpenClawSourceStatus = execFileSync('git', ['status', '--porcelain'], {
    cwd: openclawSrc,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  startedWithDirtyOpenClawSource = initialOpenClawSourceStatus.trim().length > 0;

  if (allowOpenClawSourceReset && startedWithDirtyOpenClawSource) {
    assertOpenClawSourceResetAllowed({
      openclawSrc,
      status: initialOpenClawSourceStatus,
      allowReset: allowOpenClawSourceReset,
    });
    execFileSync('git', ['reset', 'HEAD', '.'], { cwd: openclawSrc, stdio: 'pipe' });
    execFileSync('git', ['checkout', '.'], { cwd: openclawSrc, stdio: 'pipe' });
    execFileSync('git', ['clean', '-fd'], { cwd: openclawSrc, stdio: 'pipe' });
    console.log('[apply-openclaw-patches] Reset openclaw source to clean state before patching.');
    startedWithDirtyOpenClawSource = false;
    initialOpenClawSourceStatus = '';
  } else if (startedWithDirtyOpenClawSource) {
    console.log('[apply-openclaw-patches] OpenClaw source is dirty; will skip already-applied patches and refuse new patch application.');
  } else {
    console.log('[apply-openclaw-patches] OpenClaw source is clean; skipping destructive reset.');
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

let applied = 0;
let skipped = 0;

for (const patchFile of patchFiles) {
  const originalPatchPath = path.join(patchesDir, patchFile);

  // Normalize line endings: strip \r so that CRLF-checked-out patches don't
  // cause "corrupt patch" errors on Windows (git apply rejects \r in diffs).
  const raw = fs.readFileSync(originalPatchPath, 'utf8');
  const patchAffectedPaths = parseOpenClawPatchAffectedPaths(raw);
  const needsNormalize = raw.includes('\r');
  let patchPath = originalPatchPath;
  if (needsNormalize) {
    patchPath = path.join(os.tmpdir(), `lobsterai-patch-${patchFile}`);
    fs.writeFileSync(patchPath, raw.replace(/\r/g, ''), 'utf8');
  }

  try {
    // Check if patch is already applied.
    //
    // Strategy:
    //   1. Try `git apply --check --reverse` — if it succeeds the patch is applied.
    //   2. Try `git apply --check` (forward) — if it succeeds the patch is NOT applied.
    //   3. If BOTH fail, only a strong validator may classify the patch as already
    //      applied. Otherwise fail closed instead of guessing from git stderr.

    let reverseOk = false;
    let reverseErr = null;
    try {
      execFileSync('git', ['apply', '--check', '--reverse', '--ignore-whitespace', patchPath], {
        cwd: openclawSrc,
        stdio: 'pipe',
      });
      reverseOk = true;
    } catch (err) {
      reverseErr = err;
      // reverse check failed — patch may or may not be applied
    }

    // Try forward apply check.
    let forwardErr = null;
    try {
      execFileSync('git', ['apply', '--check', '--ignore-whitespace', patchPath], {
        cwd: openclawSrc,
        stdio: 'pipe',
      });
    } catch (err) {
      forwardErr = err;
    }

    const hasStrongValidator = Boolean(strongPatchValidators[patchFile]);
    const strongValidatorPassed = hasStrongValidator && isStrongPatchApplied(patchFile);

    let patchCheckState;
    try {
      patchCheckState = resolveOpenClawPatchCheckState({
        patchFile,
        reverseOk,
        forwardOk: !forwardErr,
        forwardCheckError: forwardErr?.stderr ? forwardErr.stderr.toString() : '',
        hasStrongValidator,
        strongValidatorPassed,
      });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    if (patchCheckState === OpenClawPatchCheckState.AlreadyApplied) {
      if (reverseOk) {
        console.log(`[apply-openclaw-patches] Already applied: ${patchFile}`);
      } else if (hasStrongValidator) {
        console.log(`[apply-openclaw-patches] Already applied (strong validation): ${patchFile}`);
      } else {
        const reverseStderr = reverseErr?.stderr ? reverseErr.stderr.toString() : '';
        console.log(`[apply-openclaw-patches] Already applied: ${patchFile}`);
        if (reverseStderr) {
          console.debug(`[apply-openclaw-patches] Reverse check note for ${patchFile}:\n${reverseStderr}`);
        }
      }
      skipped++;
      continue;
    }

    // Apply the patch.
    if (startedWithDirtyOpenClawSource) {
      assertOpenClawSourcePatchApplyAllowed({
        openclawSrc,
        status: initialOpenClawSourceStatus,
        patchAffectedPaths,
      });
      console.log(`[apply-openclaw-patches] Dirty OpenClaw source has no path overlap with ${patchFile}; applying.`);
    }

    try {
      execFileSync('git', ['apply', '--ignore-whitespace', patchPath], {
        cwd: openclawSrc,
        stdio: 'pipe',
      });
      console.log(`[apply-openclaw-patches] Applied: ${patchFile}`);
      applied++;
    } catch (err) {
      console.error(`[apply-openclaw-patches] Failed to apply: ${patchFile}`);
      const stderr = err.stderr ? err.stderr.toString() : '';
      if (stderr) console.error(stderr);
      process.exit(1);
    }
  } finally {
    // Clean up temporary normalized patch file.
    if (needsNormalize && fs.existsSync(patchPath)) {
      try {
        fs.unlinkSync(patchPath);
      } catch {
        // Best-effort cleanup only; the temp file lives under the OS temp dir.
      }
    }
  }
}

for (const patchFile of patchFiles) {
  assertStrongPatchApplied(patchFile);
}

console.log(`[apply-openclaw-patches] Done. Applied: ${applied}, Skipped (already applied): ${skipped}`);
