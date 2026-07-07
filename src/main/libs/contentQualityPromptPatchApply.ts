import fs from 'fs';
import path from 'path';

import type { Agent } from '../coworkStore';

export const CONTENT_QUALITY_PROMPT_PATCH_START =
  '<!-- lobsterai-content-quality-prompt-patch:start -->';
export const CONTENT_QUALITY_PROMPT_PATCH_END =
  '<!-- lobsterai-content-quality-prompt-patch:end -->';
export const CONTENT_QUALITY_PROMPT_PATCH_REGISTRY_KEY = 'content_quality_prompt_patches';

export interface ContentQualityPromptPatchRecord {
  agentId: string;
  promptPatch: string;
  appliedAt: string;
  promptPatchPath?: string;
}

export type ContentQualityPromptPatchRegistry = Record<string, ContentQualityPromptPatchRecord>;

export interface ApplyContentQualityPromptPatchToAgentOptions {
  agentId: string;
  promptPatch?: string;
  promptPatchPath?: string;
  backupDir: string;
  getAgent: (agentId: string) => Pick<Agent, 'id' | 'systemPrompt'> | null;
  getRegistry: () => ContentQualityPromptPatchRegistry;
  setRegistry: (registry: ContentQualityPromptPatchRegistry) => void;
  now?: Date;
}

export interface ApplyContentQualityPromptPatchToAgentResult {
  agentId: string;
  appliedAt: string;
  backupPath: string;
  promptPatch: string;
  promptPatchPath?: string;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizePromptPatch = (value: string): string => value.trim();

const readPromptPatch = (options: {
  promptPatch?: string;
  promptPatchPath?: string;
}): { promptPatch: string; promptPatchPath?: string } => {
  const inlinePatch = normalizePromptPatch(options.promptPatch ?? '');
  if (inlinePatch) {
    return {
      promptPatch: inlinePatch,
      ...(options.promptPatchPath?.trim()
        ? { promptPatchPath: options.promptPatchPath.trim() }
        : {}),
    };
  }

  const promptPatchPath = options.promptPatchPath?.trim();
  if (!promptPatchPath) {
    throw new Error('Prompt patch is empty');
  }

  return {
    promptPatch: normalizePromptPatch(fs.readFileSync(promptPatchPath, 'utf8')),
    promptPatchPath,
  };
};

const safeFileSegment = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent';

const buildBackupFileName = (agentId: string, appliedAt: string): string =>
  `agent-${safeFileSegment(agentId)}-system-prompt-${appliedAt
    .replace(/\.\d{3}Z$/, '')
    .replace(/[:T]/g, '-')}.md`;

export const findLatestContentQualityPromptPatchPath = (reportDir: string): string | null => {
  if (!fs.existsSync(reportDir)) {
    return null;
  }

  const candidates = fs
    .readdirSync(reportDir)
    .filter(fileName => fileName.endsWith('.prompt-patch.txt'))
    .map(fileName => {
      const filePath = path.join(reportDir, fileName);
      const stats = fs.statSync(filePath);
      return {
        filePath,
        mtimeMs: stats.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates[0]?.filePath ?? null;
};

const getPatchBlockPattern = (): RegExp =>
  new RegExp(
    `\\n*${escapeRegExp(CONTENT_QUALITY_PROMPT_PATCH_START)}[\\s\\S]*?${escapeRegExp(
      CONTENT_QUALITY_PROMPT_PATCH_END,
    )}\\n*`,
    'g',
  );

export const applyContentQualityPromptPatchToSystemPrompt = (
  systemPrompt: string,
  promptPatch: string,
  appliedAt: string,
): string => {
  const normalizedPatch = normalizePromptPatch(promptPatch);
  if (!normalizedPatch) {
    return systemPrompt;
  }

  const promptWithoutExistingPatch = systemPrompt.replace(getPatchBlockPattern(), '\n').trimEnd();
  const patchBlock = [
    CONTENT_QUALITY_PROMPT_PATCH_START,
    `Applied at: ${appliedAt}`,
    '',
    normalizedPatch,
    CONTENT_QUALITY_PROMPT_PATCH_END,
  ].join('\n');

  return [promptWithoutExistingPatch, patchBlock].filter(Boolean).join('\n\n');
};

export const applyContentQualityPromptPatchOverlay = (
  agents: Agent[],
  registry: ContentQualityPromptPatchRegistry,
): Agent[] =>
  agents.map(agent => {
    const patch = registry[agent.id];
    if (!patch?.promptPatch.trim()) {
      return agent;
    }

    return {
      ...agent,
      systemPrompt: applyContentQualityPromptPatchToSystemPrompt(
        agent.systemPrompt,
        patch.promptPatch,
        patch.appliedAt,
      ),
    };
  });

export const applyContentQualityPromptPatchToAgent = async ({
  agentId,
  promptPatch,
  promptPatchPath,
  backupDir,
  getAgent,
  getRegistry,
  setRegistry,
  now = new Date(),
}: ApplyContentQualityPromptPatchToAgentOptions): Promise<ApplyContentQualityPromptPatchToAgentResult> => {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    throw new Error('Agent id is required');
  }

  const { promptPatch: normalizedPatch, promptPatchPath: normalizedPatchPath } = readPromptPatch({
    promptPatch,
    promptPatchPath,
  });
  if (!normalizedPatch) {
    throw new Error('Prompt patch is empty');
  }

  const agent = getAgent(normalizedAgentId);
  if (!agent) {
    throw new Error(`Agent not found: ${normalizedAgentId}`);
  }

  const appliedAt = now.toISOString();
  const registry = getRegistry();
  const previousPatch = registry[normalizedAgentId];
  const previousEffectivePrompt = previousPatch
    ? applyContentQualityPromptPatchToSystemPrompt(
        agent.systemPrompt,
        previousPatch.promptPatch,
        previousPatch.appliedAt,
      )
    : agent.systemPrompt;

  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, buildBackupFileName(normalizedAgentId, appliedAt));
  fs.writeFileSync(
    backupPath,
    [
      '# Content Quality Prompt Patch Backup',
      '',
      `Agent: ${normalizedAgentId}`,
      `Backed up at: ${appliedAt}`,
      normalizedPatchPath ? `New patch source: ${normalizedPatchPath}` : 'New patch source: inline',
      '',
      '---',
      '',
      previousEffectivePrompt,
      '',
    ].join('\n'),
    'utf8',
  );

  const nextRegistry: ContentQualityPromptPatchRegistry = {
    ...registry,
    [normalizedAgentId]: {
      agentId: normalizedAgentId,
      promptPatch: normalizedPatch,
      appliedAt,
      ...(normalizedPatchPath ? { promptPatchPath: normalizedPatchPath } : {}),
    },
  };
  setRegistry(nextRegistry);

  return {
    agentId: normalizedAgentId,
    appliedAt,
    backupPath,
    promptPatch: normalizedPatch,
    ...(normalizedPatchPath ? { promptPatchPath: normalizedPatchPath } : {}),
  };
};
