import crypto from 'node:crypto';

import {
  buildEnterpriseLeadWorkspaceKnowledgeScopeId,
  EnterpriseLeadAgentRole,
  EnterpriseLeadDeliverableKind,
  EnterpriseLeadDocumentExtractionStage,
  EnterpriseLeadDocumentExtractionStatus,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadKnowledgeIndexStatus,
  EnterpriseLeadRiskLevel,
  EnterpriseLeadRunStatus,
  EnterpriseLeadTaskStatus,
  EnterpriseLeadTodoKind,
  EnterpriseLeadWorkspaceAgentCalibrationCheckId,
  EnterpriseLeadWorkspaceAgentSource,
  EnterpriseLeadWorkspaceType,
} from '../../shared/enterpriseLeadWorkspace/constants';
import {
  isPromotionTaskContext,
  parsePromotionTaskResult,
} from '../../shared/enterpriseLeadWorkspace/promotionTaskContracts';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadAgentTaskResult,
  EnterpriseLeadArchive,
  EnterpriseLeadDeliverable,
  EnterpriseLeadExtractionSource,
  EnterpriseLeadPendingVersion,
  EnterpriseLeadRun,
  EnterpriseLeadTaskAgentRole,
  EnterpriseLeadTodo,
  EnterpriseLeadTodoInput,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
  EnterpriseLeadWorkspaceAgentCalibrationRequest,
  EnterpriseLeadWorkspaceAgentCalibrationResponse,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceProfile,
  EnterpriseLeadWorkspaceRunAgentSnapshot,
  EnterpriseLeadWorkspaceRunSummary,
  EnterpriseLeadWorkspaceSettingsUpdate,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../shared/enterpriseLeadWorkspace/types';
import {
  normalizeAgentTaskResultInput,
  normalizeWorkspaceDraftInput,
} from '../../shared/enterpriseLeadWorkspace/validation';
import type { ModelClientAdapter } from '../industryPack/modelClientAdapter';
import { resolveRawApiConfigFromAppConfig } from '../libs/claudeSettings';
import {
  CONTENT_KNOWLEDGE_EMBEDDING_VERSION,
  type ContentKnowledgeSource,
  ContentKnowledgeSourceType,
} from '../libs/contentKnowledgeRetrieval';
import type { ContentKnowledgeVectorStore } from '../libs/contentKnowledgeVectorStore';
import {
  buildWorkspaceDraftFromChunkFacts,
  buildWorkspaceExtractionChunks,
  DIRECT_EXTRACTION_MAX_CHARS,
  normalizeWorkspaceChunkExtractionResult,
  type WorkspaceChunkExtractionResult,
} from './documentExtraction';
import { parseModelJsonObject } from './modelJson';
import {
  buildAgentChatPrompt,
  buildAgentTaskPrompt,
  buildWorkspaceAgentCalibrationPrompt,
  buildWorkspaceChunkExtractionPrompt,
  buildWorkspaceChunkMergePrompt,
  buildWorkspaceExtractionPrompt,
} from './promptTemplates';
import type { CreateEnterpriseLeadTaskInput, EnterpriseLeadWorkspaceStore } from './store';
import {
  buildDefaultEnterpriseLeadWorkspaceAgents,
  getEnterpriseLeadAgentMetadata,
} from './workflow';

interface EnterpriseLeadWorkspaceServiceOptions {
  store: EnterpriseLeadWorkspaceStore;
  modelClient: ModelClientAdapter;
  agentProvider?: EnterpriseLeadWorkspaceAgentProvider;
  contentKnowledgeVectorStore?: ContentKnowledgeVectorStore;
  documentExtractionTimeoutMs?: number;
  staleDocumentProcessingMs?: number;
}

export interface EnterpriseLeadWorkspaceAgentTemplate {
  id: string;
  name: string;
  description?: string;
  identity?: string;
  systemPrompt?: string;
  icon?: string;
  model?: string;
  skillIds?: string[];
  enabled?: boolean;
}

export interface EnterpriseLeadWorkspaceAgentProvider {
  listAgents(): EnterpriseLeadWorkspaceAgentTemplate[];
  getAgent(agentId: string): EnterpriseLeadWorkspaceAgentTemplate | null;
}

interface ResolvedWorkspaceAgent {
  id: string;
  name: string;
  description: string;
  identity: string;
  systemPrompt: string;
  icon: string;
  model: string;
  skillIds: string[];
}

interface WorkspaceExtractionProgressUpdate {
  current?: number;
  partial?: boolean;
  stage?: EnterpriseLeadExtractionSource['extractionStage'];
  total?: number;
}

type WorkspaceExtractionProgressHandler = (update: WorkspaceExtractionProgressUpdate) => void;

const noopAgentProvider: EnterpriseLeadWorkspaceAgentProvider = {
  listAgents: () => [],
  getAgent: () => null,
};

const DEFAULT_DOCUMENT_EXTRACTION_TIMEOUT_MS = 180_000;
const DEFAULT_STALE_DOCUMENT_PROCESSING_MS = 10 * 60_000;
const DOCUMENT_EXTRACTION_TIMEOUT_MESSAGE =
  'Document extraction timed out. Please try again with a smaller file.';
const STALE_DOCUMENT_PROCESSING_MESSAGE =
  'Document processing was interrupted. Please retry this document.';

const normalizePositiveTimeout = (value: number | undefined, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
};

const buildEnterpriseLeadSourceId = (): string => `source_${crypto.randomUUID()}`;

const hashWorkspaceSourceText = (value: string): string =>
  crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);

export const ensureEnterpriseLeadSourceIds = (
  sources: EnterpriseLeadExtractionSource[],
): EnterpriseLeadExtractionSource[] =>
  sources.map(source => ({
    ...source,
    id: source.id?.trim() || buildEnterpriseLeadSourceId(),
  }));

const buildInitialEnterpriseLeadExtractionSources = (
  source: EnterpriseLeadExtractionSource,
): EnterpriseLeadExtractionSource[] => {
  if (source.kind === EnterpriseLeadExtractionSourceKind.Blank) {
    return [];
  }
  return ensureEnterpriseLeadSourceIds([source]);
};

const hasUsableVectorIndex = (source: EnterpriseLeadExtractionSource): boolean =>
  source.vectorIndexStatus === EnterpriseLeadKnowledgeIndexStatus.Indexed &&
  (source.vectorChunkCount ?? 0) > 0;

const getQueuedDocumentVectorStatus = (
  source: EnterpriseLeadExtractionSource,
): Pick<
  EnterpriseLeadExtractionSource,
  'vectorChunkCount' | 'vectorEmbeddingVersion' | 'vectorIndexedAt' | 'vectorIndexStatus'
> => {
  if (hasUsableVectorIndex(source)) {
    return {
      vectorChunkCount: source.vectorChunkCount,
      vectorEmbeddingVersion: source.vectorEmbeddingVersion,
      vectorIndexedAt: source.vectorIndexedAt,
      vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexed,
    };
  }

  return {
    vectorChunkCount: undefined,
    vectorEmbeddingVersion: undefined,
    vectorIndexedAt: undefined,
    vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
  };
};

const buildEnterpriseWorkspaceKnowledgeSourceContent = (
  source: EnterpriseLeadExtractionSource,
): string =>
  [source.summary?.trim() ? `摘要：${source.summary.trim()}` : '', source.text?.trim() ?? '']
    .filter(Boolean)
    .join('\n\n');

const enterpriseLeadProfileArrayFields = [
  'productList',
  'productCapabilities',
  'targetCustomers',
  'applicationScenarios',
  'sellingPoints',
  'channelPreferences',
  'prohibitedClaims',
  'contactRules',
  'missingInfo',
] as const;

type EnterpriseLeadProfileArrayField = (typeof enterpriseLeadProfileArrayFields)[number];

const enterpriseLeadProfileFactFieldLabels: Record<
  EnterpriseLeadProfileArrayField | 'companySummary',
  string
> = {
  companySummary: '公司概况',
  productList: '产品',
  productCapabilities: '产品能力',
  targetCustomers: '目标客户',
  applicationScenarios: '应用场景',
  sellingPoints: '卖点',
  channelPreferences: '渠道偏好',
  prohibitedClaims: '禁用承诺',
  contactRules: '联系规则',
  missingInfo: '缺失信息',
};

const cloneWorkspaceProfile = (
  profile: EnterpriseLeadWorkspaceProfile,
): EnterpriseLeadWorkspaceProfile => ({
  companySummary: profile.companySummary,
  productList: [...profile.productList],
  productCapabilities: [...profile.productCapabilities],
  targetCustomers: [...profile.targetCustomers],
  applicationScenarios: [...profile.applicationScenarios],
  sellingPoints: [...profile.sellingPoints],
  channelPreferences: [...profile.channelPreferences],
  prohibitedClaims: [...profile.prohibitedClaims],
  contactRules: [...profile.contactRules],
  missingInfo: [...profile.missingInfo],
  ...(profile.confirmedKnowledgeKeys && profile.confirmedKnowledgeKeys.length > 0
    ? { confirmedKnowledgeKeys: [...profile.confirmedKnowledgeKeys] }
    : {}),
  ...(profile.ignoredKnowledgeKeys && profile.ignoredKnowledgeKeys.length > 0
    ? { ignoredKnowledgeKeys: [...profile.ignoredKnowledgeKeys] }
    : {}),
});

const normalizeWorkspaceKnowledgeKeyText = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();

const normalizeWorkspaceKnowledgeKey = (value: string): string => {
  const separatorIndex = value.indexOf(':');
  if (separatorIndex === -1) {
    return normalizeWorkspaceKnowledgeKeyText(value);
  }
  const field = value.slice(0, separatorIndex).trim();
  const text = normalizeWorkspaceKnowledgeKeyText(value.slice(separatorIndex + 1));
  return field && text ? `${field}:${text}` : '';
};

const getWorkspaceKnowledgeFieldKey = (
  field: keyof EnterpriseLeadWorkspaceProfile,
  value: string,
): string => {
  const normalizedText = normalizeWorkspaceKnowledgeKeyText(value);
  return normalizedText ? `${field}:${normalizedText}` : '';
};

const getWorkspaceProfileKnowledgeKeys = (profile: EnterpriseLeadWorkspaceProfile): Set<string> => {
  const keys = new Set<string>();
  const companyKey = getWorkspaceKnowledgeFieldKey('companySummary', profile.companySummary);
  if (companyKey) {
    keys.add(companyKey);
  }
  enterpriseLeadProfileArrayFields.forEach(field => {
    profile[field].forEach(value => {
      const key = getWorkspaceKnowledgeFieldKey(field, value);
      if (key) {
        keys.add(key);
      }
    });
  });
  return keys;
};

const getNewExtractedWorkspaceKnowledgeKeys = (
  previousProfile: EnterpriseLeadWorkspaceProfile,
  extractedProfile: EnterpriseLeadWorkspaceProfile,
  mergedProfile: EnterpriseLeadWorkspaceProfile,
): string[] => {
  const previousKeys = getWorkspaceProfileKnowledgeKeys(previousProfile);
  const mergedKeys = getWorkspaceProfileKnowledgeKeys(mergedProfile);
  const extractedKeys = getWorkspaceProfileKnowledgeKeys(extractedProfile);
  return Array.from(extractedKeys).filter(key => mergedKeys.has(key) && !previousKeys.has(key));
};

const mergeWorkspaceProfileValues = (
  currentValues: string[],
  incomingValues: string[],
): string[] => {
  const seen = new Set<string>();
  return [...currentValues, ...incomingValues]
    .map(value => value.trim())
    .filter(value => {
      if (!value) {
        return false;
      }
      const key = value.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
};

const mergeExtractedWorkspaceProfile = (
  currentProfile: EnterpriseLeadWorkspaceProfile,
  extractedProfile: EnterpriseLeadWorkspaceProfile,
): EnterpriseLeadWorkspaceProfile => {
  const nextProfile = cloneWorkspaceProfile(currentProfile);
  const ignoredKeys = new Set(currentProfile.ignoredKnowledgeKeys ?? []);
  const extractedCompanySummary = extractedProfile.companySummary.trim();
  nextProfile.companySummary =
    currentProfile.companySummary.trim() ||
    (ignoredKeys.has(getWorkspaceKnowledgeFieldKey('companySummary', extractedCompanySummary))
      ? ''
      : extractedCompanySummary);
  enterpriseLeadProfileArrayFields.forEach((field: EnterpriseLeadProfileArrayField) => {
    nextProfile[field] = mergeWorkspaceProfileValues(
      currentProfile[field],
      extractedProfile[field].filter(
        value => !ignoredKeys.has(getWorkspaceKnowledgeFieldKey(field, value)),
      ),
    );
  });
  return nextProfile;
};

const getSourceExtractedKnowledgeKeys = (source: EnterpriseLeadExtractionSource): string[] =>
  Array.isArray(source.extractedKnowledgeKeys) ? source.extractedKnowledgeKeys : [];

const buildConfirmedWorkspaceProfileSourceContent = (
  profile: EnterpriseLeadWorkspaceProfile,
): string => {
  const confirmedKeys = new Set(
    (profile.confirmedKnowledgeKeys ?? []).map(normalizeWorkspaceKnowledgeKey).filter(Boolean),
  );
  if (confirmedKeys.size === 0) {
    return '';
  }

  const lines: string[] = [];
  const addConfirmedFact = (
    field: EnterpriseLeadProfileArrayField | 'companySummary',
    value: string,
  ): void => {
    const text = value.trim();
    const key = getWorkspaceKnowledgeFieldKey(field, text);
    if (!text || !key || !confirmedKeys.has(key)) {
      return;
    }
    lines.push(`${enterpriseLeadProfileFactFieldLabels[field]}：${text}`);
  };

  addConfirmedFact('companySummary', profile.companySummary);
  enterpriseLeadProfileArrayFields.forEach(field => {
    profile[field].forEach(value => addConfirmedFact(field, value));
  });

  return lines.join('\n');
};

const buildWorkspaceRuleSourceContent = (profile: EnterpriseLeadWorkspaceProfile): string =>
  [
    ...profile.prohibitedClaims
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => `禁用承诺：${value}`),
    ...profile.contactRules
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => `联系规则：${value}`),
  ].join('\n');

const buildDerivedWorkspaceKnowledgeSources = (
  workspaceId: string,
  profile?: EnterpriseLeadWorkspaceProfile,
): ContentKnowledgeSource[] => {
  if (!profile) {
    return [];
  }

  const sources: ContentKnowledgeSource[] = [];
  const confirmedProfileContent = buildConfirmedWorkspaceProfileSourceContent(profile);
  if (confirmedProfileContent.trim()) {
    sources.push({
      sourceId: `profile-confirmed:${workspaceId}`,
      sourceType: ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
      label: '已确认业务知识',
      content: confirmedProfileContent,
      priority: 0.18,
      verifiedByUser: true,
      evidenceTier: 'internal',
    });
  }

  const ruleContent = buildWorkspaceRuleSourceContent(profile);
  if (ruleContent.trim()) {
    sources.push({
      sourceId: `workspace-rules:${workspaceId}`,
      sourceType: ContentKnowledgeSourceType.WorkspaceRule,
      label: '硬性规则',
      content: ruleContent,
      priority: 0.2,
      verifiedByUser: true,
      evidenceTier: 'internal',
    });
  }

  return sources;
};

const isEnterpriseLeadTaskStatus = (value: string): value is EnterpriseLeadTaskStatus =>
  Object.values(EnterpriseLeadTaskStatus).includes(value as EnterpriseLeadTaskStatus);

const isEnterpriseLeadTodoKind = (value: string): value is EnterpriseLeadTodoKind =>
  Object.values(EnterpriseLeadTodoKind).includes(value as EnterpriseLeadTodoKind);

const isEnterpriseLeadAgentRole = (value: string): value is EnterpriseLeadAgentRole =>
  Object.values(EnterpriseLeadAgentRole).includes(value as EnterpriseLeadAgentRole);

const getUpstreamTasks = (
  tasks: EnterpriseLeadAgentTask[],
  task: EnterpriseLeadAgentTask,
): EnterpriseLeadAgentTask[] => {
  const taskIndex = tasks.findIndex(item => item.id === task.id);
  if (taskIndex === -1) {
    return [];
  }

  return tasks.slice(0, taskIndex);
};

const getTaskTitle = (task: EnterpriseLeadAgentTask): string => {
  if (task.agentSnapshot?.name) {
    return task.agentSnapshot.name;
  }
  if (isEnterpriseLeadAgentRole(task.role)) {
    return getEnterpriseLeadAgentMetadata(task.role).title;
  }
  return task.role;
};

const getDeliverableKind = (
  role: EnterpriseLeadTaskAgentRole,
): EnterpriseLeadDeliverable['kind'] => {
  switch (role) {
    case EnterpriseLeadAgentRole.ProductSellingPoint:
    case EnterpriseLeadAgentRole.ProductUnderstanding:
      return EnterpriseLeadDeliverableKind.ProductProfile;
    case EnterpriseLeadAgentRole.PromotionDataScraping:
      return EnterpriseLeadDeliverableKind.PromotionResearchData;
    case EnterpriseLeadAgentRole.PromotionDataCleaning:
      return EnterpriseLeadDeliverableKind.PromotionCleanDataset;
    case EnterpriseLeadAgentRole.PromotionCompetitorInsight:
      return EnterpriseLeadDeliverableKind.PromotionCompetitorInsight;
    case EnterpriseLeadAgentRole.TopicPlanning:
    case EnterpriseLeadAgentRole.ShortVideoScript:
    case EnterpriseLeadAgentRole.SocialCopy:
    case EnterpriseLeadAgentRole.PromotionMultiPlatformAssets:
      return EnterpriseLeadDeliverableKind.ContentDraft;
    case EnterpriseLeadAgentRole.PrivateDomainConversion:
      return EnterpriseLeadDeliverableKind.SalesHandoff;
    case EnterpriseLeadAgentRole.ContentQuality:
      return EnterpriseLeadDeliverableKind.RiskReview;
    case EnterpriseLeadAgentRole.OpportunityRadar:
    case EnterpriseLeadAgentRole.PromotionLeadScoring:
      return EnterpriseLeadDeliverableKind.OpportunityReport;
    case EnterpriseLeadAgentRole.ContentPlanning:
      return EnterpriseLeadDeliverableKind.ContentDraft;
    case EnterpriseLeadAgentRole.SocialOperation:
    case EnterpriseLeadAgentRole.PromotionPublishingSchedule:
      return EnterpriseLeadDeliverableKind.SocialPlan;
    case EnterpriseLeadAgentRole.PromotionAccountMonitoring:
      return EnterpriseLeadDeliverableKind.PromotionMetricReport;
    case EnterpriseLeadAgentRole.PromotionPerformanceReview:
      return EnterpriseLeadDeliverableKind.PromotionPerformanceReview;
    case EnterpriseLeadAgentRole.SalesHandoff:
      return EnterpriseLeadDeliverableKind.SalesHandoff;
    case EnterpriseLeadAgentRole.RiskReview:
      return EnterpriseLeadDeliverableKind.RiskReview;
    case EnterpriseLeadAgentRole.ProjectSummary:
      return EnterpriseLeadDeliverableKind.FinalSummary;
    default:
      return EnterpriseLeadDeliverableKind.FinalSummary;
  }
};

const sanitizeTaskResult = (
  result: EnterpriseLeadAgentTaskResult,
  task: EnterpriseLeadAgentTask,
): EnterpriseLeadAgentTaskResult => ({
  ...result,
  role: task.role,
  status: isEnterpriseLeadTaskStatus(result.status)
    ? result.status
    : EnterpriseLeadTaskStatus.NeedsInput,
});

const buildPromotionContractNeedsInputResult = (
  task: EnterpriseLeadAgentTask,
  modelResult: unknown,
): EnterpriseLeadAgentTaskResult => {
  try {
    const result = normalizeAgentTaskResultInput(modelResult);
    return {
      ...result,
      role: task.role,
      status: EnterpriseLeadTaskStatus.NeedsInput,
      outputs: {},
      artifactRefs: [],
    };
  } catch {
    return {
      role: task.role,
      status: EnterpriseLeadTaskStatus.NeedsInput,
      summary: task.summary,
      outputs: {},
      artifactRefs: [],
      missingInfo: [],
      todos: [],
      risks: [],
      handoffContext: {},
    };
  }
};

const normalizeLiveTaskResult = (
  modelResult: unknown,
  task: EnterpriseLeadAgentTask,
  upstreamTasks: EnterpriseLeadAgentTask[],
): EnterpriseLeadAgentTaskResult => {
  if (!isPromotionTaskContext(task.role, upstreamTasks.map(upstream => upstream.role))) {
    return normalizeAgentTaskResultInput(modelResult);
  }

  try {
    return parsePromotionTaskResult(task.role, modelResult);
  } catch {
    return buildPromotionContractNeedsInputResult(task, modelResult);
  }
};

const resolveWorkspaceApiConfig = (workspace: EnterpriseLeadWorkspace) =>
  resolveRawApiConfigFromAppConfig({
    model: {
      defaultModel: workspace.settings.model.defaultModel,
      defaultModelProvider: workspace.settings.model.defaultModelProvider,
    },
    providers: workspace.settings.model.providers,
  }).config ?? undefined;

const normalizeCalibrationText = (value: string): string => value.toLowerCase().replace(/\s+/g, '');

const includesAnyCalibrationToken = (content: string, tokens: string[]): boolean => {
  const normalizedContent = normalizeCalibrationText(content);
  return tokens.some(token => normalizedContent.includes(normalizeCalibrationText(token)));
};

const buildWorkspaceAgentCalibrationChecks = (
  content: string,
): EnterpriseLeadWorkspaceAgentCalibrationResponse['checks'] => [
  {
    id: EnterpriseLeadWorkspaceAgentCalibrationCheckId.Priority,
    passed: includesAnyCalibrationToken(content, ['客户优先级', '优先级', 'priority']),
  },
  {
    id: EnterpriseLeadWorkspaceAgentCalibrationCheckId.Reason,
    passed: includesAnyCalibrationToken(content, ['判断依据', '依据', 'reason']),
  },
  {
    id: EnterpriseLeadWorkspaceAgentCalibrationCheckId.Missing,
    passed: includesAnyCalibrationToken(content, ['缺失信息', '缺失', '待补充', 'missing']),
  },
  {
    id: EnterpriseLeadWorkspaceAgentCalibrationCheckId.NextStep,
    passed: includesAnyCalibrationToken(content, ['下一步动作', '下一步', '跟进', 'next']),
  },
];

export class EnterpriseLeadWorkspaceService {
  private readonly store: EnterpriseLeadWorkspaceStore;

  private readonly modelClient: ModelClientAdapter;

  private readonly agentProvider: EnterpriseLeadWorkspaceAgentProvider;

  private readonly contentKnowledgeVectorStore?: ContentKnowledgeVectorStore;

  private readonly documentExtractionTimeoutMs: number;

  private readonly staleDocumentProcessingMs: number;

  private documentProcessingQueue: Promise<void> = Promise.resolve();

  constructor(options: EnterpriseLeadWorkspaceServiceOptions) {
    this.store = options.store;
    this.modelClient = options.modelClient;
    this.agentProvider = options.agentProvider ?? noopAgentProvider;
    this.contentKnowledgeVectorStore = options.contentKnowledgeVectorStore;
    this.documentExtractionTimeoutMs = normalizePositiveTimeout(
      options.documentExtractionTimeoutMs,
      DEFAULT_DOCUMENT_EXTRACTION_TIMEOUT_MS,
    );
    this.staleDocumentProcessingMs = normalizePositiveTimeout(
      options.staleDocumentProcessingMs,
      DEFAULT_STALE_DOCUMENT_PROCESSING_MS,
    );
  }

  listWorkspaces(): EnterpriseLeadWorkspace[] {
    return this.store
      .listWorkspaces()
      .map(workspace => this.repairStaleWorkspaceDocumentProcessing(workspace));
  }

  getWorkspace(id: string): EnterpriseLeadWorkspace | null {
    const workspace = this.store.getWorkspace(id);
    return workspace ? this.repairStaleWorkspaceDocumentProcessing(workspace) : null;
  }

  createWorkspace(draft: unknown): EnterpriseLeadWorkspace {
    const normalizedDraft = normalizeWorkspaceDraftInput(draft);

    const initialSources =
      Array.isArray(normalizedDraft.extractionSources) && normalizedDraft.extractionSources.length > 0
        ? normalizedDraft.extractionSources
        : buildInitialEnterpriseLeadExtractionSources(normalizedDraft.source);

    const workspace = this.store.createWorkspace({
      name: normalizedDraft.name,
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile: normalizedDraft.profile,
      extractionSources: initialSources,
      enabledAgentRoles: normalizedDraft.enabledAgentRoles,
      settings: normalizedDraft.settings,
      workspaceAgents: normalizedDraft.workspaceAgents,
    });
    if (!this.contentKnowledgeVectorStore) {
      return workspace;
    }
    return this.store.updateWorkspaceSources(
      workspace.id,
      this.syncWorkspaceSourcesToVectorIndex(workspace.id, workspace.extractionSources),
    );
  }

  deleteWorkspace(workspaceId: string): boolean {
    const deleted = this.store.deleteWorkspace(workspaceId);
    if (deleted) {
      this.contentKnowledgeVectorStore?.deleteScope(
        buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId),
      );
    }
    return deleted;
  }

  async extractDraftFromConversation(sourceText: string): Promise<EnterpriseLeadWorkspaceDraft> {
    const sourceLabel = '对话输入';
    const draft = await this.extractDraftFromSource(sourceText, sourceLabel);

    return {
      ...draft,
      source: {
        kind: EnterpriseLeadExtractionSourceKind.Conversation,
        label: sourceLabel,
        text: sourceText,
      },
    };
  }

  updateWorkspaceProfile(
    workspaceId: string,
    profile: EnterpriseLeadWorkspaceProfile,
  ): EnterpriseLeadWorkspace {
    const updatedWorkspace = this.store.updateWorkspaceProfile(workspaceId, profile);
    if (!this.contentKnowledgeVectorStore) {
      return updatedWorkspace;
    }
    return this.store.updateWorkspaceSources(
      updatedWorkspace.id,
      this.syncWorkspaceSourcesToVectorIndex(
        updatedWorkspace.id,
        updatedWorkspace.extractionSources,
        updatedWorkspace.profile,
      ),
    );
  }

  updateWorkspaceSources(
    workspaceId: string,
    sources: EnterpriseLeadExtractionSource[],
  ): EnterpriseLeadWorkspace {
    const sourcesWithIds = ensureEnterpriseLeadSourceIds(sources);
    return this.store.updateWorkspaceSources(
      workspaceId,
      sourcesWithIds,
      {
        transformReconciledSources: reconciledSources =>
          this.syncWorkspaceSourcesToVectorIndex(workspaceId, reconciledSources),
      },
    );
  }

  enqueueWorkspaceDocumentProcessing(
    workspaceId: string,
    sources: EnterpriseLeadExtractionSource[],
    sourceIndex: number,
  ): EnterpriseLeadWorkspace {
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= sources.length) {
      throw new Error('Document source index is invalid');
    }
    const sourcesWithIds = ensureEnterpriseLeadSourceIds(sources);
    const source = sourcesWithIds[sourceIndex];
    const sourceText = source?.text?.trim() ?? '';
    if (!source || !sourceText) {
      throw new Error('Document source text is required');
    }

    const now = new Date().toISOString();
    const queuedSources = sourcesWithIds.map((item, index): EnterpriseLeadExtractionSource => {
      if (index !== sourceIndex) {
        return item;
      }
      return {
        ...item,
        extractionError: undefined,
        extractionPartial: undefined,
        extractionProgressCurrent: undefined,
        extractionProgressTotal: undefined,
        extractionStage: EnterpriseLeadDocumentExtractionStage.Queued,
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracting,
        vectorIndexError: undefined,
        ...getQueuedDocumentVectorStatus(item),
        updatedAt: now,
      };
    });
    const queuedWorkspace = this.store.updateWorkspaceSources(workspaceId, queuedSources);
    this.enqueueDocumentProcessingJob(workspaceId, sourceIndex);
    return queuedWorkspace;
  }

  private repairStaleWorkspaceDocumentProcessing(
    workspace: EnterpriseLeadWorkspace,
  ): EnterpriseLeadWorkspace {
    const nowMs = Date.now();
    const nextUpdatedAt = new Date(nowMs).toISOString();
    let changed = false;
    const nextSources = workspace.extractionSources.map(source => {
      if (!this.isStaleDocumentProcessingSource(source, workspace.updatedAt, nowMs)) {
        return source;
      }

      changed = true;
      return {
        ...source,
        ...(source.extractionStatus === EnterpriseLeadDocumentExtractionStatus.Extracting
          ? {
              extractionError: STALE_DOCUMENT_PROCESSING_MESSAGE,
              extractionStatus: EnterpriseLeadDocumentExtractionStatus.Failed,
            }
          : {}),
        ...(source.vectorIndexStatus === EnterpriseLeadKnowledgeIndexStatus.Indexing
          ? {
              vectorIndexError: STALE_DOCUMENT_PROCESSING_MESSAGE,
              vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Failed,
            }
          : {}),
        updatedAt: nextUpdatedAt,
      };
    });

    return changed ? this.store.updateWorkspaceSources(workspace.id, nextSources) : workspace;
  }

  updateWorkspaceSettings(
    workspaceId: string,
    input: EnterpriseLeadWorkspaceSettingsUpdate,
  ): EnterpriseLeadWorkspace {
    return this.store.updateWorkspaceSettings(workspaceId, input);
  }

  private isStaleDocumentProcessingSource(
    source: EnterpriseLeadExtractionSource,
    workspaceUpdatedAt: string,
    nowMs: number,
  ): boolean {
    const isProcessing =
      source.extractionStatus === EnterpriseLeadDocumentExtractionStatus.Extracting ||
      source.vectorIndexStatus === EnterpriseLeadKnowledgeIndexStatus.Indexing;
    if (!isProcessing) {
      return false;
    }

    const updatedAtMs = Date.parse(source.updatedAt || workspaceUpdatedAt);
    return Number.isFinite(updatedAtMs) && nowMs - updatedAtMs > this.staleDocumentProcessingMs;
  }

  private async extractDraftFromSource(
    sourceText: string,
    sourceLabel: string,
    onProgress?: WorkspaceExtractionProgressHandler,
  ): Promise<EnterpriseLeadWorkspaceDraft> {
    if (sourceText.trim().length > DIRECT_EXTRACTION_MAX_CHARS) {
      return this.extractDraftFromLargeSource(sourceText, sourceLabel, onProgress);
    }

    const result = await this.withDocumentExtractionTimeout(
      this.modelClient.generate({
        prompt: buildWorkspaceExtractionPrompt({ sourceText, sourceLabel }),
      }),
    );
    return normalizeWorkspaceDraftInput(parseModelJsonObject(result.text));
  }

  private async extractDraftFromLargeSource(
    sourceText: string,
    sourceLabel: string,
    onProgress?: WorkspaceExtractionProgressHandler,
  ): Promise<EnterpriseLeadWorkspaceDraft> {
    const chunkPlan = buildWorkspaceExtractionChunks({
      sourceId: `large-source-${hashWorkspaceSourceText(sourceText)}`,
      sourceLabel,
      sourceText,
    });
    const chunkResults: WorkspaceChunkExtractionResult[] = [];
    onProgress?.({
      current: 0,
      partial: chunkPlan.partial,
      stage: EnterpriseLeadDocumentExtractionStage.ExtractingChunks,
      total: chunkPlan.chunks.length,
    });

    for (const chunk of chunkPlan.chunks) {
      const result = await this.withDocumentExtractionTimeout(
        this.modelClient.generate({
          prompt: buildWorkspaceChunkExtractionPrompt({
            chunk,
            sourceLabel,
            totalChunks: chunkPlan.chunks.length,
          }),
        }),
      );
      chunkResults.push(normalizeWorkspaceChunkExtractionResult(parseModelJsonObject(result.text)));
      onProgress?.({
        current: chunkResults.length,
        partial: chunkPlan.partial,
        stage: EnterpriseLeadDocumentExtractionStage.ExtractingChunks,
        total: chunkPlan.chunks.length,
      });
    }

    const fallbackDraft = buildWorkspaceDraftFromChunkFacts({
      name: sourceLabel,
      sourceKind: EnterpriseLeadExtractionSourceKind.File,
      sourceLabel,
      sourceText,
      chunkResults,
    });
    onProgress?.({
      current: chunkPlan.chunks.length,
      partial: chunkPlan.partial,
      stage: EnterpriseLeadDocumentExtractionStage.Merging,
      total: chunkPlan.chunks.length,
    });
    const mergeResult = await this.withDocumentExtractionTimeout(
      this.modelClient.generate({
        prompt: buildWorkspaceChunkMergePrompt({ chunkResults, sourceLabel }),
      }),
    );
    const mergedDraft = parseModelJsonObject(mergeResult.text);
    return normalizeWorkspaceDraftInput({
      ...fallbackDraft,
      ...mergedDraft,
      source: {
        ...fallbackDraft.source,
        ...((mergedDraft.source ?? {}) as Record<string, unknown>),
        text: sourceText,
      },
    });
  }

  private async withDocumentExtractionTimeout<T>(operation: Promise<T>): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(DOCUMENT_EXTRACTION_TIMEOUT_MESSAGE));
          }, this.documentExtractionTimeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  async waitForDocumentProcessingIdle(): Promise<void> {
    await this.documentProcessingQueue;
  }

  private enqueueDocumentProcessingJob(workspaceId: string, sourceIndex: number): void {
    const nextQueue = this.documentProcessingQueue
      .catch((): void => undefined)
      .then(() => this.processWorkspaceDocumentSource(workspaceId, sourceIndex));
    this.documentProcessingQueue = nextQueue.catch(error => {
      console.warn('[EnterpriseLeadWorkspace] Background document processing failed:', error);
    });
  }

  private async processWorkspaceDocumentSource(
    workspaceId: string,
    sourceIndex: number,
  ): Promise<void> {
    try {
      const workspace = this.store.getWorkspace(workspaceId);
      const source = workspace?.extractionSources[sourceIndex];
      const sourceText = source?.text?.trim() ?? '';
      if (!workspace || !source || !sourceText) {
        return;
      }

      const extractedDraft = await this.extractDraftFromSource(sourceText, source.label, update => {
        this.updateWorkspaceDocumentProcessingProgress(workspaceId, sourceIndex, update);
      });
      const nextProfile = mergeExtractedWorkspaceProfile(workspace.profile, extractedDraft.profile);
      const extractedKnowledgeKeys = getNewExtractedWorkspaceKnowledgeKeys(
        workspace.profile,
        extractedDraft.profile,
        nextProfile,
      );
      const profiledWorkspace = this.store.updateWorkspaceProfile(workspace.id, nextProfile);

      const now = new Date().toISOString();
      const nextSources = [...profiledWorkspace.extractionSources];
      const nextSource = nextSources[sourceIndex];
      if (!nextSource) {
        return;
      }
      nextSources[sourceIndex] = {
        ...nextSource,
        extractionError: undefined,
        extractionProgressCurrent: undefined,
        extractionProgressTotal: undefined,
        extractionStage: undefined,
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
        extractedKnowledgeKeys: Array.from(
          new Set([...getSourceExtractedKnowledgeKeys(nextSource), ...extractedKnowledgeKeys]),
        ),
        lastExtractedAt: now,
        updatedAt: now,
        vectorIndexError: undefined,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexing,
      };
      this.updateWorkspaceSources(profiledWorkspace.id, nextSources);
    } catch (error) {
      this.markWorkspaceDocumentProcessingFailed(workspaceId, sourceIndex, error);
    }
  }

  private updateWorkspaceDocumentProcessingProgress(
    workspaceId: string,
    sourceIndex: number,
    update: WorkspaceExtractionProgressUpdate,
  ): void {
    const workspace = this.store.getWorkspace(workspaceId);
    const source = workspace?.extractionSources[sourceIndex];
    if (!workspace || !source) {
      return;
    }

    const nextSources = [...workspace.extractionSources];
    nextSources[sourceIndex] = {
      ...source,
      extractionPartial:
        typeof update.partial === 'boolean' ? update.partial : source.extractionPartial,
      extractionProgressCurrent:
        typeof update.current === 'number' && Number.isFinite(update.current)
          ? Math.max(0, Math.floor(update.current))
          : source.extractionProgressCurrent,
      extractionProgressTotal:
        typeof update.total === 'number' && Number.isFinite(update.total)
          ? Math.max(0, Math.floor(update.total))
          : source.extractionProgressTotal,
      extractionStage: update.stage ?? source.extractionStage,
      updatedAt: new Date().toISOString(),
    };
    this.store.updateWorkspaceSources(workspace.id, nextSources);
  }

  private markWorkspaceDocumentProcessingFailed(
    workspaceId: string,
    sourceIndex: number,
    error: unknown,
  ): void {
    const workspace = this.store.getWorkspace(workspaceId);
    const source = workspace?.extractionSources[sourceIndex];
    if (!workspace || !source) {
      return;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    const nextSources = [...workspace.extractionSources];
    nextSources[sourceIndex] = {
      ...source,
      extractionError: errorMessage,
      extractionProgressCurrent: undefined,
      extractionProgressTotal: undefined,
      extractionStage: undefined,
      extractionStatus: EnterpriseLeadDocumentExtractionStatus.Failed,
      updatedAt: new Date().toISOString(),
      vectorIndexError: errorMessage,
      vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Failed,
    };
    this.store.updateWorkspaceSources(workspace.id, nextSources);
  }

  private syncWorkspaceSourcesToVectorIndex(
    workspaceId: string,
    sources: EnterpriseLeadExtractionSource[],
    profile = this.store.getWorkspace(workspaceId)?.profile,
  ): EnterpriseLeadExtractionSource[] {
    if (!this.contentKnowledgeVectorStore) {
      return sources;
    }

    const now = new Date().toISOString();
    const contentSources = sources.map((source, index) => ({
      source,
      sourceId: source.id?.trim() || `legacy-source-${index}`,
      content: buildEnterpriseWorkspaceKnowledgeSourceContent(source),
    }));

    try {
      const rawDocumentSources: ContentKnowledgeSource[] = contentSources
        .filter(item => item.content.trim())
        .map(item => ({
          sourceId: item.sourceId,
          sourceType: ContentKnowledgeSourceType.WorkspaceDocument,
          label: item.source.label,
          content: item.content,
        }));
      const syncResult = this.contentKnowledgeVectorStore.replaceSources(
        buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId),
        [...rawDocumentSources, ...buildDerivedWorkspaceKnowledgeSources(workspaceId, profile)],
      );
      const chunkCountBySourceId = new Map(
        syncResult.sourceResults.map(item => [item.sourceId, item.chunkCount]),
      );

      return contentSources.map((item): EnterpriseLeadExtractionSource => {
        if (!item.content.trim()) {
          // Nothing to vector-index (e.g. images): preserve the caller's status
          // so renderers can keep marking such sources as Indexed without text.
          return item.source;
        }
        const chunkCount = chunkCountBySourceId.get(item.sourceId) ?? 0;
        return {
          ...item.source,
          vectorChunkCount: chunkCount,
          vectorEmbeddingVersion: CONTENT_KNOWLEDGE_EMBEDDING_VERSION,
          vectorIndexError: undefined as string | undefined,
          vectorIndexedAt: chunkCount > 0 ? now : undefined,
          vectorIndexStatus:
            chunkCount > 0
              ? EnterpriseLeadKnowledgeIndexStatus.Indexed
              : EnterpriseLeadKnowledgeIndexStatus.Pending,
        };
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return contentSources.map((item): EnterpriseLeadExtractionSource => {
        if (!item.content.trim()) {
          // Preserve the caller's status for sources that were never indexed.
          return item.source;
        }
        return {
          ...item.source,
          vectorChunkCount: 0,
          vectorEmbeddingVersion: CONTENT_KNOWLEDGE_EMBEDDING_VERSION,
          vectorIndexError: errorMessage,
          vectorIndexedAt: undefined as string | undefined,
          vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Failed,
        };
      });
    }
  }

  updateWorkspaceAgents(
    workspaceId: string,
    agents: EnterpriseLeadWorkspaceAgentBinding[],
  ): EnterpriseLeadWorkspace {
    return this.store.updateWorkspaceAgents(workspaceId, agents);
  }

  listRuns(workspaceId: string): EnterpriseLeadWorkspaceRunSummary[] {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    return this.store.listRuns(workspaceId).map(run => {
      const tasks = this.store.listTasks(run.id);
      return {
        run,
        taskCount: tasks.length,
        deliverableCount: this.deriveDeliverables(workspace, run, tasks).length,
        todoCount: this.deriveTodos(workspace, run, tasks).length,
        riskCount: tasks.reduce((count, task) => count + task.risks.length, 0),
      };
    });
  }

  async testWorkspaceAgent(
    workspaceId: string,
    request: EnterpriseLeadWorkspaceAgentCalibrationRequest,
  ): Promise<EnterpriseLeadWorkspaceAgentCalibrationResponse> {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    const result = await this.modelClient.generate({
      prompt: buildWorkspaceAgentCalibrationPrompt({
        workspace,
        agent: request.agent,
        example: request.example,
      }),
      apiConfig: resolveWorkspaceApiConfig(workspace),
      ...(request.agent.model.trim() ? { model: request.agent.model.trim() } : {}),
    });
    const content = result.text.trim();

    return {
      content,
      checks: buildWorkspaceAgentCalibrationChecks(content),
    };
  }

  createRun(workspaceId: string, userGoal: string): EnterpriseLeadWorkspaceSnapshot {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }
    const dynamicTasks = this.resolveRunTasksForWorkspace(workspace);
    const run =
      dynamicTasks.length > 0
        ? this.store.createRun({
            workspaceId,
            userGoal,
            tasks: dynamicTasks,
          })
        : this.store.createRun({
            workspaceId,
            userGoal,
            roles: this.resolveLegacyRunRoles(workspace),
          });

    return this.getSnapshot(workspaceId, run.id);
  }

  async runTask(taskId: string): Promise<EnterpriseLeadAgentTask> {
    const taskContext = this.getTaskContext(taskId);
    const taskModel = taskContext.task.agentSnapshot?.model.trim();
    const result = await this.modelClient.generate({
      prompt: buildAgentTaskPrompt(taskContext),
      apiConfig: resolveWorkspaceApiConfig(taskContext.workspace),
      ...(taskModel ? { model: taskModel } : {}),
    });
    const normalizedResult = sanitizeTaskResult(
      normalizeLiveTaskResult(
        parseModelJsonObject(result.text),
        taskContext.task,
        taskContext.upstreamTasks,
      ),
      taskContext.task,
    );

    this.store.updateTaskResult(taskId, normalizedResult);
    const updatedTask = this.store.getTask(taskId);
    if (!updatedTask) {
      throw new Error('Enterprise lead Agent task disappeared after update');
    }

    return updatedTask;
  }

  async rerunTask(taskId: string): Promise<EnterpriseLeadAgentTask> {
    return this.runTask(taskId);
  }

  async runWorkflow(workspaceId: string, runId: string): Promise<EnterpriseLeadWorkspaceSnapshot> {
    const run = this.getRunForWorkspace(workspaceId, runId);
    const tasks = this.store.listTasks(run.id);

    for (const task of tasks) {
      if (task.status === EnterpriseLeadTaskStatus.Completed && !task.stale) {
        continue;
      }

      const taskTitle = getTaskTitle(task);
      this.store.updateRunProgress({
        runId: run.id,
        status: EnterpriseLeadRunStatus.Running,
        currentRole: task.role,
        controllerSummary: `${taskTitle} 正在处理。`,
      });

      const updatedTask = await this.runTask(task.id);
      if (updatedTask.status !== EnterpriseLeadTaskStatus.Completed) {
        const updatedTaskTitle = getTaskTitle(updatedTask);
        this.store.updateRunProgress({
          runId: run.id,
          status: this.mapTaskStatusToRunStatus(updatedTask.status),
          currentRole: updatedTask.role,
          controllerSummary: updatedTask.summary || `${updatedTaskTitle} 需要人工确认后继续。`,
        });
        return this.getSnapshot(workspaceId, run.id);
      }
    }

    this.store.updateRunProgress({
      runId: run.id,
      status: EnterpriseLeadRunStatus.Completed,
      currentRole: null,
      controllerSummary: '总控已完成本次获客任务。',
    });

    return this.getSnapshot(workspaceId, run.id);
  }

  async createPendingVersionFromChat(
    taskId: string,
    userMessage: string,
  ): Promise<EnterpriseLeadPendingVersion> {
    const taskContext = this.getTaskContext(taskId);
    const taskModel = taskContext.task.agentSnapshot?.model.trim();
    const result = await this.modelClient.generate({
      prompt: buildAgentChatPrompt({
        ...taskContext,
        userMessage,
      }),
      apiConfig: resolveWorkspaceApiConfig(taskContext.workspace),
      ...(taskModel ? { model: taskModel } : {}),
    });
    const normalizedResult = sanitizeTaskResult(
      normalizeAgentTaskResultInput(parseModelJsonObject(result.text)),
      taskContext.task,
    );

    return this.store.createPendingVersion({
      taskId,
      userMessage,
      summary: normalizedResult.summary,
      outputPayload: normalizedResult.outputs,
      missingInfo: normalizedResult.missingInfo,
      todos: normalizedResult.todos,
      risks: normalizedResult.risks,
      handoffContext: normalizedResult.handoffContext,
    });
  }

  applyPendingVersion(pendingVersionId: string): EnterpriseLeadWorkspaceSnapshot {
    const pendingVersion = this.store.applyPendingVersion(pendingVersionId);
    return this.getSnapshot(pendingVersion.workspaceId, pendingVersion.runId);
  }

  archiveRun(workspaceId: string, runId: string): EnterpriseLeadWorkspaceSnapshot {
    const runToArchive = this.getRunForWorkspace(workspaceId, runId);
    if (runToArchive.status !== EnterpriseLeadRunStatus.Completed) {
      throw new Error('Enterprise lead run must be completed before archive');
    }
    this.assertRunHasNoBlockingRiskReview(runToArchive.id);
    const run = this.store.archiveRun(workspaceId, runId);
    return this.getSnapshot(workspaceId, run.id);
  }

  getSnapshot(workspaceId: string, runId?: string): EnterpriseLeadWorkspaceSnapshot {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    const currentRun = this.getCurrentRun(workspace, runId);
    const tasks = currentRun ? this.store.listTasks(currentRun.id) : [];
    const pendingVersions = currentRun ? this.store.listPendingVersions(currentRun.id) : [];

    return {
      workspace,
      currentRun,
      tasks,
      pendingVersions,
      deliverables: currentRun ? this.deriveDeliverables(workspace, currentRun, tasks) : [],
      todos: currentRun ? this.deriveTodos(workspace, currentRun, tasks) : [],
      archives: this.deriveArchives(workspace),
    };
  }

  private resolveLegacyRunRoles(workspace: EnterpriseLeadWorkspace): EnterpriseLeadAgentRole[] {
    return workspace.enabledAgentRoles.filter(isEnterpriseLeadAgentRole);
  }

  private resolveRunTasksForWorkspace(
    workspace: EnterpriseLeadWorkspace,
  ): CreateEnterpriseLeadTaskInput[] {
    return this.resolveEffectiveWorkspaceAgents(workspace).map(agent => ({
      role: agent.id,
      workspaceAgentId: agent.id,
      agentSnapshot: this.toRunAgentSnapshot(agent),
    }));
  }

  private toRunAgentSnapshot(
    agent: ResolvedWorkspaceAgent,
  ): EnterpriseLeadWorkspaceRunAgentSnapshot {
    return {
      agentId: agent.id,
      name: agent.name,
      description: agent.description,
      identity: agent.identity,
      systemPrompt: agent.systemPrompt,
      icon: agent.icon,
      model: agent.model,
      skillIds: agent.skillIds,
    };
  }

  private resolveEffectiveWorkspaceAgents(
    workspace: EnterpriseLeadWorkspace,
  ): ResolvedWorkspaceAgent[] {
    const workspaceAgents =
      workspace.workspaceAgents.length > 0
        ? workspace.workspaceAgents
        : buildDefaultEnterpriseLeadWorkspaceAgents(this.resolveLegacyRunRoles(workspace));

    return [...workspaceAgents]
      .filter(binding => binding.enabled)
      .sort((left, right) => left.order - right.order)
      .map(binding => this.mergeWorkspaceAgentBinding(binding))
      .map(agent =>
        agent
          ? {
              ...agent,
              skillIds: [...workspace.settings.skillIds],
            }
          : agent,
      )
      .filter((agent): agent is ResolvedWorkspaceAgent => Boolean(agent));
  }

  private mergeWorkspaceAgentBinding(
    binding: EnterpriseLeadWorkspaceAgentBinding,
  ): ResolvedWorkspaceAgent | null {
    const baseBinding =
      binding.source === EnterpriseLeadWorkspaceAgentSource.SystemTemplate
        ? this.resolveSystemTemplateBinding(binding)
        : binding.source === EnterpriseLeadWorkspaceAgentSource.LocalAgent
          ? this.resolveLocalAgentBinding(binding)
          : null;
    if (
      (binding.source === EnterpriseLeadWorkspaceAgentSource.SystemTemplate ||
        binding.source === EnterpriseLeadWorkspaceAgentSource.LocalAgent) &&
      !baseBinding
    ) {
      return null;
    }

    const baseOverrides = baseBinding?.overrides ?? {};
    const overrides = {
      ...baseOverrides,
      ...binding.overrides,
    };
    const name = overrides.name ?? binding.name ?? binding.agentId;
    return {
      id: binding.agentId,
      name,
      description: overrides.description ?? binding.description ?? '',
      identity: overrides.identity ?? binding.identity ?? '',
      systemPrompt: overrides.systemPrompt ?? binding.systemPrompt ?? '',
      icon: overrides.icon ?? binding.icon ?? '',
      model: overrides.model ?? binding.model ?? '',
      skillIds: overrides.skillIds ?? binding.skillIds ?? [],
    };
  }

  private resolveSystemTemplateBinding(
    binding: EnterpriseLeadWorkspaceAgentBinding,
  ): EnterpriseLeadWorkspaceAgentBinding | null {
    const templateId = binding.templateId ?? binding.agentId;
    if (!isEnterpriseLeadAgentRole(templateId)) {
      return null;
    }

    return buildDefaultEnterpriseLeadWorkspaceAgents([templateId])[0] ?? null;
  }

  private resolveLocalAgentBinding(
    binding: EnterpriseLeadWorkspaceAgentBinding,
  ): EnterpriseLeadWorkspaceAgentBinding | null {
    const agent = this.agentProvider.getAgent(binding.agentId);
    if (!agent || agent.enabled === false) {
      return null;
    }

    return {
      agentId: agent.id,
      source: EnterpriseLeadWorkspaceAgentSource.LocalAgent,
      enabled: true,
      order: binding.order,
      overrides: {
        name: agent.name,
        description: agent.description,
        identity: agent.identity,
        systemPrompt: agent.systemPrompt,
        icon: agent.icon,
        model: agent.model,
        skillIds: agent.skillIds ?? [],
      },
    };
  }

  private getRunForWorkspace(workspaceId: string, runId: string): EnterpriseLeadRun {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    const run = this.store.getRun(runId);
    if (!run) {
      throw new Error('Enterprise lead run not found');
    }
    if (run.workspaceId !== workspace.id) {
      throw new Error('Enterprise lead run does not belong to workspace');
    }
    if (run.status === EnterpriseLeadRunStatus.Archived || run.archiveStatus === 'archived') {
      throw new Error('Enterprise lead run is archived');
    }

    return run;
  }

  private getCurrentRun(
    workspace: EnterpriseLeadWorkspace,
    runId?: string,
  ): EnterpriseLeadRun | null {
    const currentRunId = runId ?? workspace.recentRunId;
    if (!currentRunId) {
      return null;
    }

    const run = this.store.getRun(currentRunId);
    if (!run) {
      throw new Error('Enterprise lead run not found');
    }
    if (run.workspaceId !== workspace.id) {
      throw new Error('Enterprise lead run does not belong to workspace');
    }

    return run;
  }

  private getTaskContext(taskId: string): {
    workspace: EnterpriseLeadWorkspace;
    task: EnterpriseLeadAgentTask;
    upstreamTasks: EnterpriseLeadAgentTask[];
  } {
    const task = this.store.getTask(taskId);
    if (!task) {
      throw new Error('Enterprise lead Agent task not found');
    }

    const run = this.store.getRun(task.runId);
    if (!run) {
      throw new Error('Enterprise lead workspace not found for task');
    }
    if (run.status === EnterpriseLeadRunStatus.Archived || run.archiveStatus === 'archived') {
      throw new Error('Enterprise lead run is archived');
    }

    const workspace = this.store.getWorkspace(run.workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found for task');
    }

    const tasks = this.store.listTasks(task.runId);
    return {
      workspace,
      task,
      upstreamTasks: getUpstreamTasks(tasks, task),
    };
  }

  private deriveDeliverables(
    workspace: EnterpriseLeadWorkspace,
    run: EnterpriseLeadRun,
    tasks: EnterpriseLeadAgentTask[],
  ): EnterpriseLeadDeliverable[] {
    return tasks
      .filter(task => task.summary.trim())
      .map(task => {
        return {
          id: `task:${task.id}`,
          runId: run.id,
          workspaceId: workspace.id,
          kind: getDeliverableKind(task.role),
          role: task.role,
          title: getTaskTitle(task),
          summary: task.summary,
          payload: task.outputPayload,
          status: 'draft',
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        };
      });
  }

  private deriveTodos(
    workspace: EnterpriseLeadWorkspace,
    run: EnterpriseLeadRun,
    tasks: EnterpriseLeadAgentTask[],
  ): EnterpriseLeadTodo[] {
    return tasks.flatMap(task =>
      task.todos.map((todo, index) => ({
        id: `task:${task.id}:todo:${index}`,
        runId: run.id,
        workspaceId: workspace.id,
        kind: this.sanitizeTodoKind(todo),
        title: todo.title,
        description: todo.description,
        role: this.sanitizeTodoRole(todo, task),
        status: 'open',
        createdAt: task.updatedAt,
        updatedAt: task.updatedAt,
      })),
    );
  }

  private sanitizeTodoKind(todo: EnterpriseLeadTodoInput): EnterpriseLeadTodoKind {
    return isEnterpriseLeadTodoKind(todo.kind) ? todo.kind : EnterpriseLeadTodoKind.MissingInfo;
  }

  private sanitizeTodoRole(
    todo: EnterpriseLeadTodoInput,
    task: EnterpriseLeadAgentTask,
  ): EnterpriseLeadTaskAgentRole | null {
    if (!todo.role) {
      return null;
    }

    if (isEnterpriseLeadAgentRole(todo.role)) {
      return todo.role;
    }

    if (task.workspaceAgentId || task.agentSnapshot) {
      return todo.role === task.role || todo.role === task.workspaceAgentId ? todo.role : task.role;
    }

    return task.role;
  }

  private deriveArchives(workspace: EnterpriseLeadWorkspace): EnterpriseLeadArchive[] {
    return this.store.listArchivedRuns(workspace.id).map(run => {
      const tasks = this.store.listTasks(run.id);
      const summaryTask =
        tasks.find(
          task =>
            task.role === EnterpriseLeadAgentRole.ProjectSummary ||
            task.role === EnterpriseLeadAgentRole.ProjectArchive,
        ) ?? [...tasks].reverse().find(task => task.summary.trim());

      return {
        id: `run:${run.id}`,
        runId: run.id,
        workspaceId: workspace.id,
        title: run.userGoal,
        summary: run.controllerSummary || summaryTask?.summary || run.userGoal,
        payload: {
          userGoal: run.userGoal,
          controllerSummary: run.controllerSummary,
          tasks: tasks.map(task => ({
            role: task.role,
            status: task.status,
            summary: task.summary,
            outputPayload: task.outputPayload,
            risks: task.risks,
            todos: task.todos,
          })),
        },
        createdAt: run.completedAt || run.updatedAt,
      };
    });
  }

  private mapTaskStatusToRunStatus(status: EnterpriseLeadTaskStatus): EnterpriseLeadRunStatus {
    if (status === EnterpriseLeadTaskStatus.Blocked) {
      return EnterpriseLeadRunStatus.Blocked;
    }
    if (status === EnterpriseLeadTaskStatus.Error) {
      return EnterpriseLeadRunStatus.Error;
    }
    return EnterpriseLeadRunStatus.NeedsInput;
  }

  private assertRunHasNoBlockingRiskReview(runId: string): void {
    const tasks = this.store.listTasks(runId);
    const riskTask =
      tasks.find(
        task =>
          task.role === EnterpriseLeadAgentRole.RiskReview ||
          task.role === EnterpriseLeadAgentRole.ContentQuality,
      ) ?? tasks.find(task => this.isDynamicRiskReviewTask(task));
    if (!riskTask) {
      if (tasks.some(task => task.workspaceAgentId || task.agentSnapshot)) {
        this.assertDynamicRunHasNoBlockingRisk(tasks);
        return;
      }
      throw new Error('Enterprise lead risk review must be completed before archive');
    }

    const canArchive = riskTask.outputPayload.canArchive ?? riskTask.handoffContext.canArchive;
    const riskLevel = riskTask.outputPayload.riskLevel;
    const hasHighRisk = riskTask.risks.some(risk => risk.level === EnterpriseLeadRiskLevel.High);
    if (
      riskTask.status === EnterpriseLeadTaskStatus.Blocked ||
      canArchive === false ||
      riskLevel === EnterpriseLeadRiskLevel.High ||
      hasHighRisk
    ) {
      throw new Error('Enterprise lead run has unresolved risk review');
    }
    if (riskTask.status !== EnterpriseLeadTaskStatus.Completed || riskTask.stale) {
      throw new Error('Enterprise lead risk review must be completed before archive');
    }
    if (tasks.some(task => task.workspaceAgentId || task.agentSnapshot)) {
      this.assertDynamicRunHasNoBlockingRisk(tasks);
    }
  }

  private isDynamicRiskReviewTask(task: EnterpriseLeadAgentTask): boolean {
    if (!task.workspaceAgentId && !task.agentSnapshot) {
      return false;
    }
    const text = [
      task.role,
      task.agentSnapshot?.name,
      task.agentSnapshot?.description,
      task.agentSnapshot?.identity,
    ]
      .join(' ')
      .toLowerCase();

    return /risk|review|audit|风险|风控|审核|合规/.test(text);
  }

  private assertDynamicRunHasNoBlockingRisk(tasks: EnterpriseLeadAgentTask[]): void {
    const hasUnfinishedTask = tasks.some(
      task => task.status !== EnterpriseLeadTaskStatus.Completed || task.stale,
    );
    if (hasUnfinishedTask) {
      throw new Error('Enterprise lead risk review must be completed before archive');
    }

    const hasBlockingRisk = tasks.some(
      task =>
        task.status === EnterpriseLeadTaskStatus.Blocked ||
        task.outputPayload.canArchive === false ||
        task.handoffContext.canArchive === false ||
        task.outputPayload.riskLevel === EnterpriseLeadRiskLevel.High ||
        task.risks.some(risk => risk.level === EnterpriseLeadRiskLevel.High),
    );

    if (hasBlockingRisk) {
      throw new Error('Enterprise lead run has unresolved risk review');
    }
  }
}
