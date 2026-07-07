import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const readSource = (relativePath: string): string => {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
};

describe('renderer import hygiene', () => {
  test('does not dynamically import cowork service from agent service', () => {
    const source = readSource('src/renderer/services/agent.ts');

    expect(source).not.toMatch(/import\(\s*['"]\.\/cowork['"]\s*\)/);
  });

  test('does not create custom global agents from the agent creation modal', () => {
    const source = readSource('src/renderer/components/agent/AgentCreateModal.tsx');

    expect(source).not.toContain('agentService.createAgent(');
    expect(source).toContain('agentGlobalCreateUnavailable');
  });

  test.each([
    'src/renderer/services/auth.ts',
    'src/renderer/components/ModelSelector.tsx',
    'src/renderer/components/cowork/MediaModelPicker.tsx',
  ])('does not dynamically import endpoints from %s', (relativePath) => {
    const source = readSource(relativePath);

    expect(source).not.toMatch(/import\(\s*['"][^'"]*endpoints['"]\s*\)/);
  });
});
