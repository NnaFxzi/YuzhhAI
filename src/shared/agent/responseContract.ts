export const AgentAnswerShape = {
  Direct: 'direct',
  ConfirmThenAnswer: 'confirm_then_answer',
  AnalysisThenPlan: 'analysis_then_plan',
  CopyReady: 'copy_ready',
} as const;

export type AgentAnswerShape = (typeof AgentAnswerShape)[keyof typeof AgentAnswerShape];

export interface AgentResponseContract {
  version: 1;
  answerShape: AgentAnswerShape;
  maxClarifyingQuestions: number;
  askBeforeAnswering: boolean;
  mustInclude: string[];
  mustAvoid: string[];
  qualityChecks: string[];
  toolUseHints: string[];
}

export const defaultAgentResponseContract: AgentResponseContract = {
  version: 1,
  answerShape: AgentAnswerShape.Direct,
  maxClarifyingQuestions: 2,
  askBeforeAnswering: false,
  mustInclude: [],
  mustAvoid: [],
  qualityChecks: [],
  toolUseHints: [],
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean)
    : [];

const isAgentAnswerShape = (value: unknown): value is AgentAnswerShape =>
  typeof value === 'string' && Object.values(AgentAnswerShape).includes(value as AgentAnswerShape);

const clampClarifyingQuestionCount = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultAgentResponseContract.maxClarifyingQuestions;
  }

  return Math.max(0, Math.min(3, Math.trunc(value)));
};

export const normalizeAgentResponseContract = (input: unknown): AgentResponseContract => {
  if (!input || typeof input !== 'object') {
    return defaultAgentResponseContract;
  }

  const raw = input as Partial<AgentResponseContract>;
  return {
    version: 1,
    answerShape: isAgentAnswerShape(raw.answerShape)
      ? raw.answerShape
      : defaultAgentResponseContract.answerShape,
    maxClarifyingQuestions: clampClarifyingQuestionCount(raw.maxClarifyingQuestions),
    askBeforeAnswering: raw.askBeforeAnswering === true,
    mustInclude: asStringArray(raw.mustInclude),
    mustAvoid: asStringArray(raw.mustAvoid),
    qualityChecks: asStringArray(raw.qualityChecks),
    toolUseHints: asStringArray(raw.toolUseHints),
  };
};

const renderList = (label: string, values: string[]): string =>
  values.length > 0 ? `${label}:\n${values.map(value => `- ${value}`).join('\n')}` : '';

export const renderAgentResponseContractPrompt = (contractInput: unknown): string => {
  const contract = normalizeAgentResponseContract(contractInput);
  const sections = [
    '[Agent response contract]',
    `Answer shape: ${contract.answerShape}`,
    `Ask before answering: ${contract.askBeforeAnswering ? 'yes' : 'no'}`,
    `Max clarifying questions before drafting: ${contract.maxClarifyingQuestions}`,
    renderList('Must include', contract.mustInclude),
    renderList('Must avoid', contract.mustAvoid),
    renderList('Quality checks', contract.qualityChecks),
    renderList('Tool-use hints', contract.toolUseHints),
  ].filter(Boolean);

  return sections.join('\n');
};
