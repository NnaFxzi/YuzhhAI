import type { Skill } from '../../types/skill';

type RoutableSkill = Pick<Skill, 'id' | 'enabled' | 'skillPath'>;

interface CoworkRuntimeSkillSelectionInput {
  selectedSkillIds: string[];
  kitSkillIds: string[];
  skills: RoutableSkill[];
}

interface CoworkRuntimeSkillSelection {
  directSkillIds: string[];
  runtimeSkillIds: string[];
}

const unique = (ids: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
};

const resolveRoutableSkillIds = (skillIds: string[], skills: RoutableSkill[]): string[] => {
  const skillById = new Map(skills.map(skill => [skill.id, skill]));
  return unique(skillIds).filter(skillId => {
    const skill = skillById.get(skillId);
    return skill?.enabled === true && skill.skillPath.trim().length > 0;
  });
};

export const buildCoworkRuntimeSkillSelection = ({
  selectedSkillIds,
  kitSkillIds,
  skills,
}: CoworkRuntimeSkillSelectionInput): CoworkRuntimeSkillSelection => {
  const directSkillIds = resolveRoutableSkillIds(selectedSkillIds, skills);
  const kitRuntimeSkillIds = resolveRoutableSkillIds(kitSkillIds, skills);

  return {
    directSkillIds,
    runtimeSkillIds: unique([...directSkillIds, ...kitRuntimeSkillIds]),
  };
};
