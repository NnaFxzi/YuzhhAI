import { expect, test } from 'vitest';

import type { CoworkMessage } from '../../coworkStore';
import { ContinuityCapsuleSource, type CoworkContinuityCapsule } from './coworkContinuityCapsule';
import {
  buildCoworkTopKEvidenceBridge,
  buildCoworkTopKEvidenceBridgeResult,
} from './coworkTopKEvidence';

const message = (
  type: CoworkMessage['type'],
  content: string,
  timestamp: number,
  metadata?: CoworkMessage['metadata'],
): CoworkMessage => ({
  id: `${type}-${timestamp}`,
  type,
  content,
  timestamp,
  ...(metadata ? { metadata } : {}),
});

const makeCapsule = (overrides: Partial<CoworkContinuityCapsule> = {}): CoworkContinuityCapsule => ({
  version: 1,
  sessionId: 'session-1',
  revision: 1,
  updatedAt: 100,
  lastSource: ContinuityCapsuleSource.PostCompaction,
  lastCompactedAt: 100,
  currentObjective: 'Fix the failing bakery page test.',
  recentUserRequests: [],
  userConstraints: [],
  decisions: [],
  recentActions: [],
  touchedFiles: [{ path: 'src/pages/Bakery.tsx' }],
  keySymbols: [],
  verification: [],
  nextSteps: ['Investigate npm test failure.'],
  recentFailures: [],
  activeCapabilities: [],
  openQuestions: [],
  ...overrides,
});

test('top-k evidence bridge is skipped before compaction', () => {
  const bridge = buildCoworkTopKEvidenceBridge({
    sessionId: 'session-1',
    prompt: '继续处理 src/pages/Bakery.tsx',
    capsule: makeCapsule({ lastCompactedAt: undefined }),
    messages: [
      message('user', 'src/pages/Bakery.tsx 的测试失败了。', 1),
    ],
  });

  expect(bridge).toBe('');
});

test('top-k evidence bridge retrieves bounded matching historical evidence', () => {
  const result = buildCoworkTopKEvidenceBridgeResult({
    sessionId: 'session-1',
    prompt: '继续处理 src/pages/Bakery.tsx 的 npm test failed',
    capsule: makeCapsule(),
    messages: [
      message('user', '用户要求麦田烘焙页面支持中日双语切换。', 1),
      message('tool_result', 'npm test failed in src/pages/Bakery.tsx: expected ja copy to be visible.', 2, {
        toolName: 'shell',
      }),
      message('assistant', 'Next step: fix the ja translation branch in src/pages/Bakery.tsx.', 3),
      message('user', '继续处理 src/pages/Bakery.tsx 的 npm test failed', 101),
    ],
  });
  const bridge = result.bridge;

  expect(bridge).toContain('[LobsterAI retrieved evidence after context compaction]');
  expect(bridge).toContain('tool result: shell');
  expect(bridge).toContain('src/pages/Bakery.tsx');
  expect(bridge).toContain('expected ja copy');
  expect(bridge).not.toContain('timestamp');
  expect(bridge.length).toBeLessThanOrEqual(2000);
  expect(result.diagnostics.candidateCount).toBe(3);
  expect(result.diagnostics.injectedCount).toBeGreaterThan(0);
  expect(result.diagnostics.bridgeLength).toBe(bridge.length);
});

test('top-k evidence bridge redacts sensitive-looking lines', () => {
  const bridge = buildCoworkTopKEvidenceBridge({
    sessionId: 'session-1',
    prompt: '继续处理 src/pages/Bakery.tsx 的 api key error',
    capsule: makeCapsule(),
    messages: [
      message('tool_result', 'src/pages/Bakery.tsx failed\napiKey=super-secret-value\nerror: invalid config', 2, {
        toolName: 'shell',
      }),
    ],
  });

  expect(bridge).toContain('[redacted sensitive line]');
  expect(bridge).not.toContain('super-secret-value');
});
