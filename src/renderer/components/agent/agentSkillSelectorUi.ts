import type { Skill } from '../../types/skill';

export const AgentSkillFilter = {
  All: 'all',
  Selected: 'selected',
  Recommended: 'recommended',
  BuiltIn: 'builtIn',
  Custom: 'custom',
} as const;

export type AgentSkillFilter = typeof AgentSkillFilter[keyof typeof AgentSkillFilter];

const RECOMMENDED_SKILL_KEYWORDS = [
  'web-search',
  'browser',
  'document',
  'docx',
  'spreadsheet',
  'sheet',
  'image',
  'research',
  'search',
  'content',
  'promotion',
  'marketing',
  'writing',
  '调研',
  '搜索',
  '文档',
  '报告',
  '方案',
  '图片',
  '表格',
  '内容',
  '推广',
];

const getSkillSearchText = (skill: Skill, description: string): string =>
  `${skill.id} ${skill.name} ${description}`.toLowerCase();

export const isRecommendedAgentSkill = (skill: Skill, description = skill.description): boolean => {
  const searchText = getSkillSearchText(skill, description);
  return RECOMMENDED_SKILL_KEYWORDS.some(keyword => searchText.includes(keyword.toLowerCase()));
};

export interface FilterAgentSkillsOptions {
  skills: Skill[];
  selectedSkillIds: string[];
  filter: AgentSkillFilter;
  query: string;
  getDescription: (skill: Skill) => string;
}

export const filterAgentSkills = ({
  skills,
  selectedSkillIds,
  filter,
  query,
  getDescription,
}: FilterAgentSkillsOptions): Skill[] => {
  const selectedIds = new Set(selectedSkillIds);
  const normalizedQuery = query.trim().toLowerCase();

  return skills.filter(skill => {
    const description = getDescription(skill);
    const matchesQuery = !normalizedQuery
      || getSkillSearchText(skill, description).includes(normalizedQuery);
    if (!matchesQuery) return false;

    if (filter === AgentSkillFilter.Selected) return selectedIds.has(skill.id);
    if (filter === AgentSkillFilter.Recommended) return isRecommendedAgentSkill(skill, description);
    if (filter === AgentSkillFilter.BuiltIn) return skill.isBuiltIn;
    if (filter === AgentSkillFilter.Custom) return !skill.isBuiltIn && !skill.isOfficial;
    return true;
  });
};
