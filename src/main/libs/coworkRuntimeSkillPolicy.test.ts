import { describe, expect, test } from 'vitest';

import { resolveCoworkRuntimeSkillIds } from './coworkRuntimeSkillPolicy';

describe('resolveCoworkRuntimeSkillIds', () => {
  test('uses explicit runtime skills without falling back to message or agent skills', () => {
    expect(
      resolveCoworkRuntimeSkillIds({
        runtimeSkillIds: ['workspace-skill'],
        activeSkillIds: ['message-skill'],
        agentSkillIds: ['agent-skill'],
      }),
    ).toEqual(['workspace-skill']);
  });

  test('returns empty skills when only message or agent skills are present', () => {
    expect(
      resolveCoworkRuntimeSkillIds({
        activeSkillIds: ['message-skill'],
        agentSkillIds: ['agent-skill'],
      }),
    ).toEqual([]);
  });
});
