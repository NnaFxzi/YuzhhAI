export interface CoworkRuntimeSkillPolicyInput {
  runtimeSkillIds?: string[];
  activeSkillIds?: string[];
  agentSkillIds?: string[];
}

export const resolveCoworkRuntimeSkillIds = (input: CoworkRuntimeSkillPolicyInput): string[] =>
  input.runtimeSkillIds ?? [];
