export const CoworkPromptAddMenuItemId = {
  File: 'file',
  Skill: 'skill',
  PlanMode: 'plan-mode',
} as const;

export type CoworkPromptAddMenuItemId =
  (typeof CoworkPromptAddMenuItemId)[keyof typeof CoworkPromptAddMenuItemId];

export const isCoworkPromptSkillMenuEnabled = (): boolean => false;

export const getCoworkPromptAddMenuItemIds = (): CoworkPromptAddMenuItemId[] => [
  CoworkPromptAddMenuItemId.File,
  ...(isCoworkPromptSkillMenuEnabled() ? [CoworkPromptAddMenuItemId.Skill] : []),
  CoworkPromptAddMenuItemId.PlanMode,
];
