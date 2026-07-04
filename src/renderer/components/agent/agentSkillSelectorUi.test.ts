import { describe, expect, test } from 'vitest';

import type { Skill } from '../../types/skill';
import {
  AgentSkillFilter,
  filterAgentSkills,
  isRecommendedAgentSkill,
} from './agentSkillSelectorUi';

const createSkill = (patch: Partial<Skill> & Pick<Skill, 'id' | 'name'>): Skill => ({
  description: '',
  enabled: true,
  isBuiltIn: false,
  isOfficial: false,
  prompt: '',
  skillPath: '',
  updatedAt: 0,
  ...patch,
});

describe('agent skill selector UI helpers', () => {
  test('recommends research and content related skills from id, name, or description', () => {
    expect(isRecommendedAgentSkill(createSkill({
      id: 'web-search',
      name: 'web-search',
      description: 'Search and read web pages.',
    }))).toBe(true);
    expect(isRecommendedAgentSkill(createSkill({
      id: 'custom-doc',
      name: '文档助理',
      description: '创建报告和方案。',
    }))).toBe(true);
    expect(isRecommendedAgentSkill(createSkill({
      id: 'unrelated',
      name: 'calendar',
      description: 'Manage meetings.',
    }))).toBe(false);
  });

  test('recommends English content, promotion, marketing, and writing skills', () => {
    expect(isRecommendedAgentSkill(createSkill({
      id: 'content-calendar',
      name: 'Planning',
    }))).toBe(true);
    expect(isRecommendedAgentSkill(createSkill({
      id: 'promo-helper',
      name: 'Launch support',
      description: 'Promotion campaign assistant.',
    }))).toBe(true);
    expect(isRecommendedAgentSkill(createSkill({
      id: 'go-to-market',
      name: 'Marketing strategy',
    }))).toBe(true);
    expect(isRecommendedAgentSkill(createSkill({
      id: 'copy-assistant',
      name: 'Writing coach',
    }))).toBe(true);
  });

  test('filters selected, recommended, built-in, and custom skills', () => {
    const skills = [
      createSkill({ id: 'docx', name: 'docx', isBuiltIn: true }),
      createSkill({ id: 'web-search', name: 'web-search', isBuiltIn: true }),
      createSkill({ id: 'official-writing', name: '官方写作', isOfficial: true }),
      createSkill({ id: 'custom-writing', name: '内容写作' }),
    ];

    expect(filterAgentSkills({
      skills,
      selectedSkillIds: ['docx'],
      filter: AgentSkillFilter.Selected,
      query: '',
      getDescription: skill => skill.description,
    }).map(skill => skill.id)).toEqual(['docx']);

    expect(filterAgentSkills({
      skills,
      selectedSkillIds: [],
      filter: AgentSkillFilter.Recommended,
      query: '',
      getDescription: skill => skill.description,
    }).map(skill => skill.id)).toEqual(['docx', 'web-search', 'official-writing', 'custom-writing']);

    expect(filterAgentSkills({
      skills,
      selectedSkillIds: [],
      filter: AgentSkillFilter.BuiltIn,
      query: '',
      getDescription: skill => skill.description,
    }).map(skill => skill.id)).toEqual(['docx', 'web-search']);

    expect(filterAgentSkills({
      skills,
      selectedSkillIds: [],
      filter: AgentSkillFilter.Custom,
      query: '',
      getDescription: skill => skill.description,
    }).map(skill => skill.id)).toEqual(['custom-writing']);
  });

  test('matches search query against skill name and localized description', () => {
    const skills = [
      createSkill({ id: 'docx', name: 'docx', description: 'Word documents' }),
      createSkill({ id: 'imagegen', name: 'imagegen', description: 'Generate images' }),
    ];

    expect(filterAgentSkills({
      skills,
      selectedSkillIds: [],
      filter: AgentSkillFilter.All,
      query: '图片',
      getDescription: skill => skill.id === 'imagegen' ? '生成图片素材' : skill.description,
    }).map(skill => skill.id)).toEqual(['imagegen']);
  });

  test('matches search query against skill id and name', () => {
    const skills = [
      createSkill({ id: 'spreadsheet-tools', name: 'Data utilities' }),
      createSkill({ id: 'asset-helper', name: 'Image Studio' }),
    ];

    expect(filterAgentSkills({
      skills,
      selectedSkillIds: [],
      filter: AgentSkillFilter.All,
      query: 'spreadsheet',
      getDescription: skill => skill.description,
    }).map(skill => skill.id)).toEqual(['spreadsheet-tools']);

    expect(filterAgentSkills({
      skills,
      selectedSkillIds: [],
      filter: AgentSkillFilter.All,
      query: 'studio',
      getDescription: skill => skill.description,
    }).map(skill => skill.id)).toEqual(['asset-helper']);
  });
});
