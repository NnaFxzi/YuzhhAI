import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadExtractionSource,
  EnterpriseLeadIpcResult,
  EnterpriseLeadPendingVersion,
  EnterpriseLeadWorkflowEvent,
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
import type { WorkflowStartOptions } from '../../shared/enterpriseLeadWorkspace/workflowContracts';

type EnterpriseLeadWorkspaceApi = Window['electron']['enterpriseLeadWorkspace'];

const LOG_PREFIX = '[EnterpriseLeadWorkspace]';

export const EnterpriseLeadWorkspaceServiceError = {
  ProcessDocumentSourceApiUnavailable: 'process_document_source_api_unavailable',
  UpdateSourcesApiUnavailable: 'update_sources_api_unavailable',
} as const;

const getApi = (): EnterpriseLeadWorkspaceApi | null =>
  window.electron?.enterpriseLeadWorkspace ?? null;

const logError = (action: string, error: unknown): void => {
  console.error(`${LOG_PREFIX} ${action} failed`, error);
};

const unwrap = <T>(action: string, result: EnterpriseLeadIpcResult<T>, fallback: T): T => {
  if (result.success) {
    return result.data ?? fallback;
  }

  logError(action, result.error || 'Unknown enterprise lead workspace error');
  return fallback;
};

const unwrapOrThrow = <T>(action: string, result: EnterpriseLeadIpcResult<T>, fallback: T): T => {
  if (result.success) {
    return result.data ?? fallback;
  }

  const errorMessage = result.error || 'Unknown enterprise lead workspace error';
  logError(action, errorMessage);
  throw new Error(errorMessage);
};

const request = async <T>(
  action: string,
  fallback: T,
  invoke: (api: EnterpriseLeadWorkspaceApi) => Promise<EnterpriseLeadIpcResult<T>>,
): Promise<T> => {
  const api = getApi();
  if (!api) {
    logError(action, 'Enterprise lead workspace API is unavailable');
    return fallback;
  }

  try {
    return unwrap(action, await invoke(api), fallback);
  } catch (error) {
    logError(action, error);
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
    logError(action, errorMessage);
    throw new Error(errorMessage);
  }

  try {
    return unwrapOrThrow(action, await invoke(api), fallback);
  } catch (error) {
    logError(action, error);
    throw error;
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
): Promise<EnterpriseLeadWorkspace | null> =>
  request<EnterpriseLeadWorkspace | null>('updateWorkspaceProfile', null, api =>
    api.updateWorkspaceProfile(workspaceId, profile),
  );

export const updateWorkspaceSources = async (
  workspaceId: string,
  sources: EnterpriseLeadExtractionSource[],
): Promise<EnterpriseLeadWorkspace | null> =>
  requestOrThrow<EnterpriseLeadWorkspace | null>('updateWorkspaceSources', null, api => {
    if (typeof api.updateWorkspaceSources !== 'function') {
      throw new Error(EnterpriseLeadWorkspaceServiceError.UpdateSourcesApiUnavailable);
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
      throw new Error(EnterpriseLeadWorkspaceServiceError.ProcessDocumentSourceApiUnavailable);
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

export const startWorkflow = async (
  workspaceId: string,
  runId: string,
  options: WorkflowStartOptions,
): Promise<EnterpriseLeadWorkspaceSnapshot | null> =>
  requestOrThrow<EnterpriseLeadWorkspaceSnapshot | null>('startWorkflow', null, api =>
    api.startWorkflow(workspaceId, runId, options),
  );

export const resumeWorkflow = async (
  workspaceId: string,
  runId: string,
): Promise<EnterpriseLeadWorkspaceSnapshot | null> =>
  requestOrThrow<EnterpriseLeadWorkspaceSnapshot | null>('resumeWorkflow', null, api =>
    api.resumeWorkflow(workspaceId, runId),
  );

export const cancelWorkflow = async (
  workspaceId: string,
  runId: string,
): Promise<EnterpriseLeadWorkspaceSnapshot | null> =>
  requestOrThrow<EnterpriseLeadWorkspaceSnapshot | null>('cancelWorkflow', null, api =>
    api.cancelWorkflow(workspaceId, runId),
  );

export const approveWorkflowTask = async (
  workspaceId: string,
  runId: string,
  taskId: string,
): Promise<EnterpriseLeadWorkspaceSnapshot | null> =>
  requestOrThrow<EnterpriseLeadWorkspaceSnapshot | null>('approveWorkflowTask', null, api =>
    api.approveWorkflowTask(workspaceId, runId, taskId),
  );

export const rejectWorkflowTask = async (
  workspaceId: string,
  runId: string,
  taskId: string,
): Promise<EnterpriseLeadWorkspaceSnapshot | null> =>
  requestOrThrow<EnterpriseLeadWorkspaceSnapshot | null>('rejectWorkflowTask', null, api =>
    api.rejectWorkflowTask(workspaceId, runId, taskId),
  );

export const onWorkflowEvent = (
  runId: string,
  listener: (event: EnterpriseLeadWorkflowEvent) => void,
): (() => void) => {
  const api = getApi();
  if (!api || typeof api.onEvent !== 'function') {
    logError('onWorkflowEvent', 'Enterprise lead workflow event API is unavailable');
    return () => undefined;
  }
  return api.onEvent(event => {
    if (event.runId === runId) {
      listener(event);
    }
  });
};

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
  startWorkflow,
  resumeWorkflow,
  cancelWorkflow,
  approveWorkflowTask,
  rejectWorkflowTask,
  onWorkflowEvent,
};
