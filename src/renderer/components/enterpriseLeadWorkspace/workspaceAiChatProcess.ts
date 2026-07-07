import {
  EnterpriseLeadChatProgressPhase,
  EnterpriseLeadChatProgressStatus,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadWorkspaceChatMessage,
  EnterpriseLeadWorkspaceChatProgressEvent,
  EnterpriseLeadWorkspaceChatResearchResult,
} from '../../../shared/enterpriseLeadWorkspace/types';

export const WorkspaceAiChatProcessStepKind = {
  Routing: 'routing',
  Research: 'research',
  AgentStep: 'agent_step',
  Answer: 'answer',
} as const;

export type WorkspaceAiChatProcessStepKind =
  (typeof WorkspaceAiChatProcessStepKind)[keyof typeof WorkspaceAiChatProcessStepKind];

export const WorkspaceAiChatProcessStepStatus = {
  Pending: 'pending',
  Active: 'active',
  Completed: 'completed',
  Skipped: 'skipped',
  Failed: 'failed',
} as const;

export type WorkspaceAiChatProcessStepStatus =
  (typeof WorkspaceAiChatProcessStepStatus)[keyof typeof WorkspaceAiChatProcessStepStatus];

export interface WorkspaceAiChatProcessStep {
  id: string;
  kind: WorkspaceAiChatProcessStepKind;
  status: WorkspaceAiChatProcessStepStatus;
  titleKey?: string;
  title?: string;
  detail?: string;
  agentName?: string;
}

export interface WorkspaceAiChatProcess {
  agentLabel?: string;
  summaryKey: string;
  summaryDetail?: string;
  defaultExpanded: boolean;
  steps: WorkspaceAiChatProcessStep[];
}

export const WorkspaceAiChatSuggestedActionKind = {
  ContinueSearch: 'continue_search',
  ScorePastedList: 'score_pasted_list',
  BuildScreeningSheet: 'build_screening_sheet',
  RetryResearch: 'retry_research',
  RankCandidates: 'rank_candidates',
  DraftFollowUp: 'draft_follow_up',
} as const;

export type WorkspaceAiChatSuggestedActionKind =
  (typeof WorkspaceAiChatSuggestedActionKind)[keyof typeof WorkspaceAiChatSuggestedActionKind];

export interface WorkspaceAiChatSuggestedAction {
  kind: WorkspaceAiChatSuggestedActionKind;
  labelKey: string;
  draftKey: string;
}

const WorkspaceAiChatProcessI18nKey = {
  StepRouting: 'enterpriseLeadAiChatProcessStepRouting',
  StepResearch: 'enterpriseLeadAiChatProcessStepResearch',
  StepAgent: 'enterpriseLeadAiChatProcessStepAgent',
  StepAnswer: 'enterpriseLeadAiChatProcessStepAnswer',
  ResearchCompleted: 'enterpriseLeadAiChatProcessResearchCompleted',
  ResearchFailed: 'enterpriseLeadAiChatProcessResearchFailed',
  ResearchSkipped: 'enterpriseLeadAiChatProcessResearchSkipped',
  ResearchPending: 'enterpriseLeadAiChatProcessResearchPending',
  ProcessReady: 'enterpriseLeadAiChatProcessReady',
  SuggestedContinueSearch: 'enterpriseLeadAiChatSuggestedContinueSearch',
  SuggestedScorePastedList: 'enterpriseLeadAiChatSuggestedScorePastedList',
  SuggestedBuildScreeningSheet: 'enterpriseLeadAiChatSuggestedBuildScreeningSheet',
  SuggestedRetryResearch: 'enterpriseLeadAiChatSuggestedRetryResearch',
  SuggestedRankCandidates: 'enterpriseLeadAiChatSuggestedRankCandidates',
  SuggestedDraftFollowUp: 'enterpriseLeadAiChatSuggestedDraftFollowUp',
  SuggestedContinueSearchDraft: 'enterpriseLeadAiChatSuggestedContinueSearchDraft',
  SuggestedScorePastedListDraft: 'enterpriseLeadAiChatSuggestedScorePastedListDraft',
  SuggestedBuildScreeningSheetDraft: 'enterpriseLeadAiChatSuggestedBuildScreeningSheetDraft',
  SuggestedRetryResearchDraft: 'enterpriseLeadAiChatSuggestedRetryResearchDraft',
  SuggestedRankCandidatesDraft: 'enterpriseLeadAiChatSuggestedRankCandidatesDraft',
  SuggestedDraftFollowUpDraft: 'enterpriseLeadAiChatSuggestedDraftFollowUpDraft',
} as const;

const sanitizeRouteReason = (reason: string): string =>
  reason.replace(/^自动判断[：:]\s*/, '').trim();

const mapResearchStatus = (
  status: EnterpriseLeadWorkspaceChatResearchResult['status'],
): WorkspaceAiChatProcessStepStatus => {
  if (status === 'completed') {
    return WorkspaceAiChatProcessStepStatus.Completed;
  }

  if (status === 'failed') {
    return WorkspaceAiChatProcessStepStatus.Failed;
  }

  return WorkspaceAiChatProcessStepStatus.Skipped;
};

const buildAgentLabel = (message: EnterpriseLeadWorkspaceChatMessage): string | undefined => {
  const agents = message.routing?.agents.length
    ? message.routing.agents
    : message.agent
      ? [message.agent]
      : [];
  const labels = agents
    .map(agent => agent.name.trim())
    .filter((name, index, names) => name && names.indexOf(name) === index);

  return labels.length > 0 ? labels.join(' + ') : undefined;
};

const buildResearchDetail = (
  research: EnterpriseLeadWorkspaceChatResearchResult,
): string | undefined => {
  const detailParts = [research.provider, research.summary].filter(Boolean);

  return detailParts.length > 0 ? detailParts.join(' · ') : undefined;
};

const resolveProcessSummaryKey = (message: EnterpriseLeadWorkspaceChatMessage): string => {
  if (message.research?.status === 'completed') {
    return WorkspaceAiChatProcessI18nKey.ResearchCompleted;
  }

  if (message.research?.status === 'failed') {
    return WorkspaceAiChatProcessI18nKey.ResearchFailed;
  }

  if (message.research?.status === 'skipped') {
    return WorkspaceAiChatProcessI18nKey.ResearchSkipped;
  }

  return WorkspaceAiChatProcessI18nKey.ProcessReady;
};

const resolveProcessSummaryDetail = (
  message: EnterpriseLeadWorkspaceChatMessage,
): string | undefined => message.research?.summary || undefined;

const mapProgressPhaseToStepKind = (
  phase: EnterpriseLeadWorkspaceChatProgressEvent['phase'],
): WorkspaceAiChatProcessStepKind | null => {
  if (phase === EnterpriseLeadChatProgressPhase.Routing) {
    return WorkspaceAiChatProcessStepKind.Routing;
  }
  if (phase === EnterpriseLeadChatProgressPhase.Research) {
    return WorkspaceAiChatProcessStepKind.Research;
  }
  if (phase === EnterpriseLeadChatProgressPhase.Agent) {
    return WorkspaceAiChatProcessStepKind.AgentStep;
  }
  if (phase === EnterpriseLeadChatProgressPhase.Synthesis) {
    return WorkspaceAiChatProcessStepKind.Answer;
  }
  if (phase === EnterpriseLeadChatProgressPhase.Error) {
    return WorkspaceAiChatProcessStepKind.Answer;
  }
  return null;
};

const mapProgressStatus = (
  status: EnterpriseLeadWorkspaceChatProgressEvent['status'],
): WorkspaceAiChatProcessStepStatus => {
  if (status === EnterpriseLeadChatProgressStatus.Completed) {
    return WorkspaceAiChatProcessStepStatus.Completed;
  }
  if (status === EnterpriseLeadChatProgressStatus.Failed) {
    return WorkspaceAiChatProcessStepStatus.Failed;
  }
  return WorkspaceAiChatProcessStepStatus.Active;
};

const resolveLiveProcessSummaryKey = (event: EnterpriseLeadWorkspaceChatProgressEvent): string => {
  if (event.status === EnterpriseLeadChatProgressStatus.Failed) {
    return WorkspaceAiChatProcessI18nKey.ResearchFailed;
  }
  if (event.status === EnterpriseLeadChatProgressStatus.Running) {
    return WorkspaceAiChatProcessI18nKey.ResearchPending;
  }
  if (event.phase === EnterpriseLeadChatProgressPhase.Research) {
    return WorkspaceAiChatProcessI18nKey.ResearchCompleted;
  }
  return WorkspaceAiChatProcessI18nKey.ProcessReady;
};

export function deriveWorkspaceAiChatProcessFromProgressEvents(
  progressEvents: EnterpriseLeadWorkspaceChatProgressEvent[] | undefined,
): WorkspaceAiChatProcess | null {
  if (!progressEvents?.length) {
    return null;
  }

  const latestByStepId = new Map<string, EnterpriseLeadWorkspaceChatProgressEvent>();
  const displayEvents = progressEvents.filter(
    event => event.phase !== EnterpriseLeadChatProgressPhase.Done,
  );
  displayEvents.forEach(event => {
    latestByStepId.set(event.stepId, event);
  });

  const steps = Array.from(latestByStepId.values())
    .map(event => {
      const kind = mapProgressPhaseToStepKind(event.phase);
      if (!kind) {
        return null;
      }
      const step: WorkspaceAiChatProcessStep = {
        id: event.stepId,
        kind,
        status: mapProgressStatus(event.status),
        title: event.title,
        ...(event.detail ? { detail: event.detail } : {}),
        ...(event.phase === EnterpriseLeadChatProgressPhase.Agent && event.source
          ? { agentName: event.source }
          : {}),
      };
      return step;
    })
    .filter((step): step is WorkspaceAiChatProcessStep => Boolean(step));

  if (steps.length === 0) {
    return null;
  }

  const latestEvent =
    displayEvents[displayEvents.length - 1] ?? progressEvents[progressEvents.length - 1]!;
  const labels = displayEvents
    .filter(
      event =>
        event.phase === EnterpriseLeadChatProgressPhase.Routing ||
        event.phase === EnterpriseLeadChatProgressPhase.Agent,
    )
    .map(event => event.source?.trim())
    .filter((name, index, names): name is string => Boolean(name) && names.indexOf(name) === index);

  return {
    agentLabel: labels.length > 0 ? labels.join(' + ') : undefined,
    summaryKey: resolveLiveProcessSummaryKey(latestEvent),
    summaryDetail: latestEvent.detail,
    defaultExpanded: true,
    steps,
  };
}

export function deriveWorkspaceAiChatProcess(
  message: EnterpriseLeadWorkspaceChatMessage,
): WorkspaceAiChatProcess | null {
  const progressProcess = deriveWorkspaceAiChatProcessFromProgressEvents(message.progressEvents);
  if (progressProcess) {
    return {
      ...progressProcess,
      agentLabel: progressProcess.agentLabel ?? buildAgentLabel(message),
      defaultExpanded: false,
    };
  }

  if (!message.routing && !message.research && !message.agent) {
    return null;
  }

  const steps: WorkspaceAiChatProcessStep[] = [];

  if (message.routing) {
    const routeDetail = sanitizeRouteReason(message.routing.reason);

    steps.push({
      id: `${message.id}:routing`,
      kind: WorkspaceAiChatProcessStepKind.Routing,
      status: WorkspaceAiChatProcessStepStatus.Completed,
      titleKey: WorkspaceAiChatProcessI18nKey.StepRouting,
      detail: routeDetail || undefined,
    });
  }

  if (message.research) {
    steps.push({
      id: `${message.id}:research`,
      kind: WorkspaceAiChatProcessStepKind.Research,
      status: mapResearchStatus(message.research.status),
      titleKey: WorkspaceAiChatProcessI18nKey.StepResearch,
      detail: buildResearchDetail(message.research),
    });
  }

  for (const [index, step] of message.routing?.steps?.entries() ?? []) {
    steps.push({
      id: `${message.id}:agent-step:${index}`,
      kind: WorkspaceAiChatProcessStepKind.AgentStep,
      status: WorkspaceAiChatProcessStepStatus.Completed,
      titleKey: WorkspaceAiChatProcessI18nKey.StepAgent,
      detail: step.content,
      agentName: step.agent.name,
    });
  }

  if (message.content.trim()) {
    steps.push({
      id: `${message.id}:answer`,
      kind: WorkspaceAiChatProcessStepKind.Answer,
      status: WorkspaceAiChatProcessStepStatus.Completed,
      titleKey: WorkspaceAiChatProcessI18nKey.StepAnswer,
    });
  }

  return {
    agentLabel: buildAgentLabel(message),
    summaryKey: resolveProcessSummaryKey(message),
    summaryDetail: resolveProcessSummaryDetail(message),
    defaultExpanded: false,
    steps,
  };
}

export function deriveWorkspaceAiChatSuggestedActions(
  message: EnterpriseLeadWorkspaceChatMessage,
): WorkspaceAiChatSuggestedAction[] {
  const research = message.research;

  if (!research) {
    return [];
  }

  if (research.status === 'failed') {
    return [
      {
        kind: WorkspaceAiChatSuggestedActionKind.RetryResearch,
        labelKey: WorkspaceAiChatProcessI18nKey.SuggestedRetryResearch,
        draftKey: WorkspaceAiChatProcessI18nKey.SuggestedRetryResearchDraft,
      },
      {
        kind: WorkspaceAiChatSuggestedActionKind.ScorePastedList,
        labelKey: WorkspaceAiChatProcessI18nKey.SuggestedScorePastedList,
        draftKey: WorkspaceAiChatProcessI18nKey.SuggestedScorePastedListDraft,
      },
    ];
  }

  if (research.status !== 'completed') {
    return [];
  }

  const hasCompanyCandidates = Boolean(
    research.leadCandidates?.some(candidate => candidate.kind === 'company'),
  );

  if (hasCompanyCandidates) {
    return [
      {
        kind: WorkspaceAiChatSuggestedActionKind.RankCandidates,
        labelKey: WorkspaceAiChatProcessI18nKey.SuggestedRankCandidates,
        draftKey: WorkspaceAiChatProcessI18nKey.SuggestedRankCandidatesDraft,
      },
      {
        kind: WorkspaceAiChatSuggestedActionKind.DraftFollowUp,
        labelKey: WorkspaceAiChatProcessI18nKey.SuggestedDraftFollowUp,
        draftKey: WorkspaceAiChatProcessI18nKey.SuggestedDraftFollowUpDraft,
      },
    ];
  }

  return [
    {
      kind: WorkspaceAiChatSuggestedActionKind.ContinueSearch,
      labelKey: WorkspaceAiChatProcessI18nKey.SuggestedContinueSearch,
      draftKey: WorkspaceAiChatProcessI18nKey.SuggestedContinueSearchDraft,
    },
    {
      kind: WorkspaceAiChatSuggestedActionKind.ScorePastedList,
      labelKey: WorkspaceAiChatProcessI18nKey.SuggestedScorePastedList,
      draftKey: WorkspaceAiChatProcessI18nKey.SuggestedScorePastedListDraft,
    },
    {
      kind: WorkspaceAiChatSuggestedActionKind.BuildScreeningSheet,
      labelKey: WorkspaceAiChatProcessI18nKey.SuggestedBuildScreeningSheet,
      draftKey: WorkspaceAiChatProcessI18nKey.SuggestedBuildScreeningSheetDraft,
    },
  ];
}
