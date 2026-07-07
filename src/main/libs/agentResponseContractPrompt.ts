import {
  type AgentResponseContract,
  defaultAgentResponseContract,
  normalizeAgentResponseContract,
  renderAgentResponseContractPrompt,
} from '../../shared/agent';

export const buildAgentResponseContractRuntimePrompt = (
  contractInput: AgentResponseContract | null | undefined,
): string => {
  const contract = normalizeAgentResponseContract(contractInput);
  const isDefault =
    contract.answerShape === defaultAgentResponseContract.answerShape &&
    contract.maxClarifyingQuestions === defaultAgentResponseContract.maxClarifyingQuestions &&
    contract.askBeforeAnswering === defaultAgentResponseContract.askBeforeAnswering &&
    contract.mustInclude.length === 0 &&
    contract.mustAvoid.length === 0 &&
    contract.qualityChecks.length === 0 &&
    contract.toolUseHints.length === 0;

  return isDefault ? '' : renderAgentResponseContractPrompt(contract);
};
