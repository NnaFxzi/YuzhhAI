import { EnterpriseLeadIpcErrorCode } from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadExtractionSource,
  EnterpriseLeadIpcResult,
  EnterpriseLeadPendingVersion,
  EnterpriseLeadProfileConflictSnapshot,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
  EnterpriseLeadWorkspaceAgentCalibrationRequest,
  EnterpriseLeadWorkspaceAgentCalibrationResponse,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceProfile,
  EnterpriseLeadWorkspaceRunSummary,
  EnterpriseLeadWorkspaceSettingsUpdate,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../shared/enterpriseLeadWorkspace/types';
import {
  KnowledgeFactDomain,
  type KnowledgeFactDomain as KnowledgeFactDomainValue,
} from '../../shared/knowledgeBase/constants';

type EnterpriseLeadWorkspaceApi = Window['electron']['enterpriseLeadWorkspace'];

const LOG_PREFIX = '[EnterpriseLeadWorkspace]';
const OPERATION_FAILED_MESSAGE = 'Enterprise lead workspace operation failed';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const cloneDenseStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const length = value.length;
  const cloned: string[] = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      return null;
    }
    const item = value[index] as unknown;
    if (typeof item !== 'string') {
      return null;
    }
    cloned.push(item);
  }
  return cloned;
};

const cloneProfileConflictSnapshot = (
  value: unknown,
): EnterpriseLeadProfileConflictSnapshot | null => {
  try {
    if (
      !isPlainObject(value) ||
      !hasOwn(value, 'id') ||
      !hasOwn(value, 'profile') ||
      !hasOwn(value, 'profileRevision') ||
      !hasOwn(value, 'updatedAt')
    ) {
      return null;
    }
    const id = value.id;
    const profileSource = value.profile;
    const profileRevision = value.profileRevision;
    const updatedAt = value.updatedAt;
    if (
      typeof id !== 'string' ||
      !id.trim() ||
      typeof profileRevision !== 'number' ||
      !Number.isSafeInteger(profileRevision) ||
      profileRevision < 1 ||
      typeof updatedAt !== 'string' ||
      !updatedAt.trim() ||
      !Number.isFinite(Date.parse(updatedAt)) ||
      !isPlainObject(profileSource) ||
      !hasOwn(profileSource, KnowledgeFactDomain.CompanySummary)
    ) {
      return null;
    }
    const companySummary = profileSource.companySummary;
    if (typeof companySummary !== 'string') {
      return null;
    }
    const cloneRequiredArrayField = (
      domain: Exclude<
        KnowledgeFactDomainValue,
        typeof KnowledgeFactDomain.CompanySummary
      >,
    ): string[] | null => {
      if (!hasOwn(profileSource, domain)) {
        return null;
      }
      const source = profileSource[domain];
      return cloneDenseStringArray(source);
    };
    const productList = cloneRequiredArrayField(KnowledgeFactDomain.ProductList);
    const productCapabilities = cloneRequiredArrayField(KnowledgeFactDomain.ProductCapabilities);
    const targetCustomers = cloneRequiredArrayField(KnowledgeFactDomain.TargetCustomers);
    const applicationScenarios = cloneRequiredArrayField(
      KnowledgeFactDomain.ApplicationScenarios,
    );
    const sellingPoints = cloneRequiredArrayField(KnowledgeFactDomain.SellingPoints);
    const channelPreferences = cloneRequiredArrayField(KnowledgeFactDomain.ChannelPreferences);
    const prohibitedClaims = cloneRequiredArrayField(KnowledgeFactDomain.ProhibitedClaims);
    const contactRules = cloneRequiredArrayField(KnowledgeFactDomain.ContactRules);
    const missingInfo = cloneRequiredArrayField(KnowledgeFactDomain.MissingInfo);
    if (
      productList === null ||
      productCapabilities === null ||
      targetCustomers === null ||
      applicationScenarios === null ||
      sellingPoints === null ||
      channelPreferences === null ||
      prohibitedClaims === null ||
      contactRules === null ||
      missingInfo === null
    ) {
      return null;
    }
    const cloneOptionalTrustKeys = (
      field: 'confirmedKnowledgeKeys' | 'ignoredKnowledgeKeys',
    ): string[] | undefined | null => {
      if (!hasOwn(profileSource, field)) {
        return undefined;
      }
      const source = profileSource[field];
      return cloneDenseStringArray(source);
    };
    const confirmedKnowledgeKeys = cloneOptionalTrustKeys('confirmedKnowledgeKeys');
    const ignoredKnowledgeKeys = cloneOptionalTrustKeys('ignoredKnowledgeKeys');
    if (confirmedKnowledgeKeys === null || ignoredKnowledgeKeys === null) {
      return null;
    }
    return {
      id,
      profile: {
        companySummary,
        productList,
        productCapabilities,
        targetCustomers,
        applicationScenarios,
        sellingPoints,
        channelPreferences,
        prohibitedClaims,
        contactRules,
        missingInfo,
        ...(confirmedKnowledgeKeys !== undefined ? { confirmedKnowledgeKeys } : {}),
        ...(ignoredKnowledgeKeys !== undefined ? { ignoredKnowledgeKeys } : {}),
      },
      profileRevision,
      updatedAt,
    };
  } catch {
    return null;
  }
};

export const EnterpriseLeadWorkspaceServiceErrorCode = {
  ProcessDocumentSourceApiUnavailable: 'process_document_source_api_unavailable',
  UpdateSourcesApiUnavailable: 'update_sources_api_unavailable',
} as const;

export class EnterpriseLeadWorkspaceServiceError extends Error {
  public readonly code: EnterpriseLeadIpcErrorCode;

  public readonly latestProfile?: EnterpriseLeadProfileConflictSnapshot;

  constructor(
    code: EnterpriseLeadIpcErrorCode,
    message: string,
    latestProfile?: unknown,
  ) {
    const safeLatestProfile = code === EnterpriseLeadIpcErrorCode.ProfileRevisionConflict
      ? cloneProfileConflictSnapshot(latestProfile)
      : null;
    const hasInvalidConflictSnapshot =
      code === EnterpriseLeadIpcErrorCode.ProfileRevisionConflict && !safeLatestProfile;
    super(hasInvalidConflictSnapshot ? OPERATION_FAILED_MESSAGE : message);
    this.name = 'EnterpriseLeadWorkspaceServiceError';
    this.code = hasInvalidConflictSnapshot ? EnterpriseLeadIpcErrorCode.OperationFailed : code;
    this.latestProfile = safeLatestProfile ?? undefined;
  }
}

const getApi = (): EnterpriseLeadWorkspaceApi | null =>
  window.electron?.enterpriseLeadWorkspace ?? null;

const logError = (action: string): void => {
  console.error(`${LOG_PREFIX} ${action} failed`, {
    code: EnterpriseLeadIpcErrorCode.OperationFailed,
    message: OPERATION_FAILED_MESSAGE,
  });
};

const unwrap = <T>(action: string, result: EnterpriseLeadIpcResult<T>, fallback: T): T => {
  if (result.success) {
    return result.data ?? fallback;
  }

  logError(action);
  return fallback;
};

const unwrapOrThrow = <T>(action: string, result: EnterpriseLeadIpcResult<T>, fallback: T): T => {
  if (result.success) {
    return result.data ?? fallback;
  }

  const serviceError = new EnterpriseLeadWorkspaceServiceError(
    result.error.code,
    result.error.message,
    result.error.latestProfile,
  );
  logError(action);
  throw serviceError;
};

const request = async <T>(
  action: string,
  fallback: T,
  invoke: (api: EnterpriseLeadWorkspaceApi) => Promise<EnterpriseLeadIpcResult<T>>,
): Promise<T> => {
  const api = getApi();
  if (!api) {
    logError(action);
    return fallback;
  }

  try {
    return unwrap(action, await invoke(api), fallback);
  } catch {
    logError(action);
    return fallback;
  }
};

const requestOrThrow = async <T>(
  action: string,
  fallback: T,
  invoke: (api: EnterpriseLeadWorkspaceApi) => Promise<EnterpriseLeadIpcResult<T>>,
): Promise<T> => {
  const api = getApi();
  if (!api) {
    const errorMessage = 'Enterprise lead workspace API is unavailable';
    logError(action);
    throw new Error(errorMessage);
  }

  try {
    return unwrapOrThrow(action, await invoke(api), fallback);
  } catch (error) {
    logError(action);
    if (error instanceof EnterpriseLeadWorkspaceServiceError) {
      throw error;
    }
    throw new EnterpriseLeadWorkspaceServiceError(
      EnterpriseLeadIpcErrorCode.OperationFailed,
      OPERATION_FAILED_MESSAGE,
    );
  }
};

export const listWorkspaces = async (): Promise<EnterpriseLeadWorkspace[]> =>
  requestOrThrow('listWorkspaces', [], api => api.listWorkspaces());

export const getWorkspace = async (id: string): Promise<EnterpriseLeadWorkspace | null> =>
  request<EnterpriseLeadWorkspace | null>('getWorkspace', null, api => api.getWorkspace(id));

export const extractDraft = async (text: string): Promise<EnterpriseLeadWorkspaceDraft | null> =>
  request<EnterpriseLeadWorkspaceDraft | null>('extractDraft', null, api => api.extractDraft(text));

export const createWorkspace = async (
  draft: EnterpriseLeadWorkspaceDraft,
): Promise<EnterpriseLeadWorkspace | null> =>
  request<EnterpriseLeadWorkspace | null>('createWorkspace', null, api =>
    api.createWorkspace(draft),
  );

export const deleteWorkspace = async (workspaceId: string): Promise<boolean> =>
  requestOrThrow('deleteWorkspace', false, api => api.deleteWorkspace(workspaceId));

export const updateWorkspaceSettings = async (
  workspaceId: string,
  settings: EnterpriseLeadWorkspaceSettingsUpdate,
): Promise<EnterpriseLeadWorkspace | null> =>
  request<EnterpriseLeadWorkspace | null>('updateWorkspaceSettings', null, api =>
    api.updateWorkspaceSettings(workspaceId, settings),
  );

export const updateWorkspaceProfile = async (
  workspaceId: string,
  profile: EnterpriseLeadWorkspaceProfile,
  expectedProfileRevision: number,
  touchedFields: KnowledgeFactDomainValue[],
): Promise<EnterpriseLeadWorkspace | null> =>
  requestOrThrow<EnterpriseLeadWorkspace | null>('updateWorkspaceProfile', null, api =>
    api.updateWorkspaceProfile(
      workspaceId,
      profile,
      expectedProfileRevision,
      touchedFields,
    ),
  );

export const updateWorkspaceSources = async (
  workspaceId: string,
  sources: EnterpriseLeadExtractionSource[],
): Promise<EnterpriseLeadWorkspace | null> =>
  requestOrThrow<EnterpriseLeadWorkspace | null>('updateWorkspaceSources', null, api => {
    if (typeof api.updateWorkspaceSources !== 'function') {
      throw new Error(EnterpriseLeadWorkspaceServiceErrorCode.UpdateSourcesApiUnavailable);
    }
    return api.updateWorkspaceSources(workspaceId, sources);
  });

export const processDocumentSource = async (
  workspaceId: string,
  sources: EnterpriseLeadExtractionSource[],
  sourceIndex: number,
): Promise<EnterpriseLeadWorkspace | null> =>
  requestOrThrow<EnterpriseLeadWorkspace | null>('processDocumentSource', null, api => {
    if (typeof api.processDocumentSource !== 'function') {
      throw new Error(EnterpriseLeadWorkspaceServiceErrorCode.ProcessDocumentSourceApiUnavailable);
    }
    return api.processDocumentSource(workspaceId, sources, sourceIndex);
  });

export const updateWorkspaceAgents = async (
  workspaceId: string,
  agents: EnterpriseLeadWorkspaceAgentBinding[],
): Promise<EnterpriseLeadWorkspace | null> =>
  request<EnterpriseLeadWorkspace | null>('updateWorkspaceAgents', null, api =>
    api.updateWorkspaceAgents(workspaceId, agents),
  );

export const listRuns = async (workspaceId: string): Promise<EnterpriseLeadWorkspaceRunSummary[]> =>
  request<EnterpriseLeadWorkspaceRunSummary[]>('listRuns', [], api => api.listRuns(workspaceId));

export const createRun = async (
  workspaceId: string,
  userGoal: string,
): Promise<EnterpriseLeadWorkspaceSnapshot | null> =>
  request<EnterpriseLeadWorkspaceSnapshot | null>('createRun', null, api =>
    api.createRun(workspaceId, userGoal),
  );

export const getRun = async (
  workspaceId: string,
  runId?: string,
): Promise<EnterpriseLeadWorkspaceSnapshot | null> =>
  request<EnterpriseLeadWorkspaceSnapshot | null>('getRun', null, api =>
    api.getRun(workspaceId, runId),
  );

export const runWorkflow = async (
  workspaceId: string,
  runId: string,
): Promise<EnterpriseLeadWorkspaceSnapshot | null> =>
  request<EnterpriseLeadWorkspaceSnapshot | null>('runWorkflow', null, api =>
    api.runWorkflow(workspaceId, runId),
  );

export const testWorkspaceAgent = async (
  workspaceId: string,
  calibrationRequest: EnterpriseLeadWorkspaceAgentCalibrationRequest,
): Promise<EnterpriseLeadWorkspaceAgentCalibrationResponse | null> =>
  request<EnterpriseLeadWorkspaceAgentCalibrationResponse | null>('testWorkspaceAgent', null, api =>
    api.testWorkspaceAgent(workspaceId, calibrationRequest),
  );

export const runTask = async (taskId: string): Promise<EnterpriseLeadAgentTask | null> =>
  request<EnterpriseLeadAgentTask | null>('runTask', null, api => api.runTask(taskId));

export const rerunTask = async (taskId: string): Promise<EnterpriseLeadAgentTask | null> =>
  request<EnterpriseLeadAgentTask | null>('rerunTask', null, api => api.rerunTask(taskId));

export const createPendingVersion = async (
  taskId: string,
  message: string,
): Promise<EnterpriseLeadPendingVersion | null> =>
  request<EnterpriseLeadPendingVersion | null>('createPendingVersion', null, api =>
    api.createPendingVersion(taskId, message),
  );

export const applyPendingVersion = async (
  pendingVersionId: string,
): Promise<EnterpriseLeadWorkspaceSnapshot | null> =>
  request<EnterpriseLeadWorkspaceSnapshot | null>('applyPendingVersion', null, api =>
    api.applyPendingVersion(pendingVersionId),
  );

export const archiveRun = async (
  workspaceId: string,
  runId: string,
): Promise<EnterpriseLeadWorkspaceSnapshot | null> =>
  request<EnterpriseLeadWorkspaceSnapshot | null>('archiveRun', null, api =>
    api.archiveRun(workspaceId, runId),
  );

export const enterpriseLeadWorkspaceService = {
  listWorkspaces,
  getWorkspace,
  extractDraft,
  createWorkspace,
  deleteWorkspace,
  updateWorkspaceProfile,
  processDocumentSource,
  updateWorkspaceSources,
  updateWorkspaceSettings,
  updateWorkspaceAgents,
  listRuns,
  createRun,
  getRun,
  runWorkflow,
  testWorkspaceAgent,
  runTask,
  rerunTask,
  createPendingVersion,
  applyPendingVersion,
  archiveRun,
};
