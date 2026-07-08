'use strict';

const OpenClawPatchCheckState = {
  AlreadyApplied: 'already-applied',
  NeedsApply: 'needs-apply',
};

function isOpenClawPatchResetAllowed(env) {
  return env.LOBSTERAI_OPENCLAW_PATCH_RESET === '1';
}

function normalizeGitStatus(status) {
  return String(status ?? '').trim();
}

function stripGitStatusPathQuotes(filePath) {
  const trimmed = String(filePath ?? '').trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseOpenClawGitStatusPaths(status) {
  const rawStatus = String(status ?? '')
    .replace(/\r/g, '')
    .replace(/\s+$/g, '');
  if (!rawStatus.trim()) {
    return [];
  }

  const paths = new Set();
  for (const line of rawStatus.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const payload = line.slice(3).trim();
    if (!payload) {
      continue;
    }

    const renameMarker = ' -> ';
    if (payload.includes(renameMarker)) {
      const [fromPath, toPath] = payload.split(renameMarker);
      if (fromPath) {
        paths.add(stripGitStatusPathQuotes(fromPath));
      }
      if (toPath) {
        paths.add(stripGitStatusPathQuotes(toPath));
      }
      continue;
    }

    paths.add(stripGitStatusPathQuotes(payload));
  }
  return Array.from(paths).filter(Boolean).sort();
}

function parseOpenClawPatchAffectedPaths(patchText) {
  const paths = new Set();
  for (const line of String(patchText ?? '').split('\n')) {
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (!match) {
      continue;
    }
    const oldPath = match[1];
    const newPath = match[2];
    if (oldPath && oldPath !== '/dev/null') {
      paths.add(oldPath);
    }
    if (newPath && newPath !== '/dev/null') {
      paths.add(newPath);
    }
  }
  return Array.from(paths).sort();
}

function getDirtyOpenClawPatchPathConflicts(status, patchAffectedPaths) {
  const dirtyPaths = new Set(parseOpenClawGitStatusPaths(status));
  return Array.from(new Set(patchAffectedPaths ?? []))
    .filter(filePath => dirtyPaths.has(filePath))
    .sort();
}

function formatDirtyOpenClawSourceMessage(openclawSrc, status) {
  const normalized = normalizeGitStatus(status);
  return [
    `[apply-openclaw-patches] Refusing to reset dirty OpenClaw source: ${openclawSrc}`,
    '[apply-openclaw-patches] Preserve or clean these changes first, then rerun.',
    '[apply-openclaw-patches] To intentionally discard sibling OpenClaw changes, rerun with LOBSTERAI_OPENCLAW_PATCH_RESET=1.',
    normalized ? `[apply-openclaw-patches] Dirty status:\n${normalized}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatDirtyOpenClawPatchApplyMessage(openclawSrc, status, conflicts) {
  const normalized = normalizeGitStatus(status);
  const conflictLines =
    Array.isArray(conflicts) && conflicts.length > 0
      ? conflicts.map(filePath => `[apply-openclaw-patches]   - ${filePath}`)
      : [];
  return [
    `[apply-openclaw-patches] Refusing to apply new patches to dirty OpenClaw source: ${openclawSrc}`,
    conflictLines.length > 0
      ? '[apply-openclaw-patches] The patch touches paths that already have local changes:'
      : '[apply-openclaw-patches] Already-applied patches can be skipped, but applying new patches could mix with existing local changes.',
    ...conflictLines,
    '[apply-openclaw-patches] Preserve or clean these changes first, then rerun.',
    '[apply-openclaw-patches] To intentionally discard sibling OpenClaw changes before patching, rerun with LOBSTERAI_OPENCLAW_PATCH_RESET=1.',
    normalized ? `[apply-openclaw-patches] Dirty status:\n${normalized}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatAmbiguousOpenClawPatchCheckMessage(params) {
  const normalizedForwardError = normalizeGitStatus(params.forwardCheckError);
  return [
    `[apply-openclaw-patches] Patch check was ambiguous for ${params.patchFile}.`,
    '[apply-openclaw-patches] Reverse check did not confirm that the patch was already applied, and forward check did not confirm that it can be applied cleanly.',
    params.hasStrongValidator
      ? '[apply-openclaw-patches] Strong validation did not confirm the patch, so LobsterAI is failing closed instead of guessing from git stderr.'
      : '[apply-openclaw-patches] No strong validator is registered for this patch, so LobsterAI is failing closed instead of guessing from git stderr.',
    '[apply-openclaw-patches] Clean the sibling OpenClaw tree or add/fix a strong validator before rerunning.',
    normalizedForwardError
      ? `[apply-openclaw-patches] Forward check stderr:\n${normalizedForwardError}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function resolveOpenClawPatchCheckState(params) {
  if (params.reverseOk) {
    return OpenClawPatchCheckState.AlreadyApplied;
  }

  if (params.forwardOk) {
    return OpenClawPatchCheckState.NeedsApply;
  }

  if (params.strongValidatorPassed) {
    return OpenClawPatchCheckState.AlreadyApplied;
  }

  throw new Error(formatAmbiguousOpenClawPatchCheckMessage(params));
}

function assertOpenClawSourceResetAllowed(params) {
  const status = normalizeGitStatus(params.status);
  if (!status) {
    return;
  }
  if (params.allowReset) {
    return;
  }
  throw new Error(formatDirtyOpenClawSourceMessage(params.openclawSrc, status));
}

function assertOpenClawSourcePatchApplyAllowed(params) {
  const status = normalizeGitStatus(params.status);
  if (!status) {
    return;
  }
  const patchAffectedPaths = Array.from(params.patchAffectedPaths ?? []).filter(Boolean);
  if (patchAffectedPaths.length > 0) {
    const conflicts = getDirtyOpenClawPatchPathConflicts(params.status, patchAffectedPaths);
    if (conflicts.length === 0) {
      return;
    }
    throw new Error(formatDirtyOpenClawPatchApplyMessage(params.openclawSrc, status, conflicts));
  }
  throw new Error(formatDirtyOpenClawPatchApplyMessage(params.openclawSrc, status));
}

module.exports = {
  OpenClawPatchCheckState,
  assertOpenClawSourcePatchApplyAllowed,
  assertOpenClawSourceResetAllowed,
  formatAmbiguousOpenClawPatchCheckMessage,
  formatDirtyOpenClawPatchApplyMessage,
  formatDirtyOpenClawSourceMessage,
  getDirtyOpenClawPatchPathConflicts,
  isOpenClawPatchResetAllowed,
  normalizeGitStatus,
  parseOpenClawGitStatusPaths,
  parseOpenClawPatchAffectedPaths,
  resolveOpenClawPatchCheckState,
};
