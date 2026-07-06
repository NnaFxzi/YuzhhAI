import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadIpcResult,
  EnterpriseLeadPendingVersion,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
  EnterpriseLeadWorkspaceChatRequest,
  EnterpriseLeadWorkspaceChatResponse,
  EnterpriseLeadWorkspaceChatSession,
  EnterpriseLeadWorkspaceChatSessionSummary,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceProfile,
  EnterpriseLeadWorkspaceRunSummary,
  EnterpriseLeadWorkspaceSettingsUpdate,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../shared/enterpriseLeadWorkspace/types';

type EnterpriseLeadWorkspaceApi = Window['electron']['enterpriseLeadWorkspace'];

const LOG_PREFIX = '[EnterpriseLeadWorkspace]';

const getApi = (): EnterpriseLeadWorkspaceApi | null =>
  window.electron?.enterpriseLeadWorkspace ?? null;

const logError = (action: string, error: unknown): void => {
  console.error(`${LOG_PREFIX} ${action} failed`, error);
};

const unwrap = <T>(
  action: string,
  result: EnterpriseLeadIpcResult<T>,
  fallback: T,
): T => {
  if (result.success) {
    return result.data ?? fallback;
  }

  logError(action, result.error || 'Unknown enterprise lead workspace error');
  return fallback;
};

const unwrapOrThrow = <T>(
  action: string,
  result: EnterpriseLeadIpcResult<T>,
  fallback: T,
): T => {
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

export const extractDraft = async (
  text: string,
): Promise<EnterpriseLeadWorkspaceDraft | null> =>
  request<EnterpriseLeadWorkspaceDraft | null>(
    'extractDraft',
    null,
    api => api.extractDraft(text),
  );

export const createWorkspace = async (
  draft: EnterpriseLeadWorkspaceDraft,
): Promise<EnterpriseLeadWorkspace | null> =>
  request<EnterpriseLeadWorkspace | null>(
    'createWorkspace',
    null,
    api => api.createWorkspace(draft),
  );

export const deleteWorkspace = async (workspaceId: string): Promise<boolean> =>
  requestOrThrow('deleteWorkspace', false, api => api.deleteWorkspace(workspaceId));

export const updateWorkspaceSettings = async (
  workspaceId: string,
  settings: EnterpriseLeadWorkspaceSettingsUpdate,
): Promise<EnterpriseLeadWorkspace | null> =>
  request<EnterpriseLeadWorkspace | null>(
    'updateWorkspaceSettings',
    null,
    api => api.updateWorkspaceSettings(workspaceId, settings),
  );

export const updateWorkspaceProfile = async (
  workspaceId: string,
  profile: EnterpriseLeadWorkspaceProfile,
): Promise<EnterpriseLeadWorkspace | null> =>
  request<EnterpriseLeadWorkspace | null>(
    'updateWorkspaceProfile',
    null,
    api => api.updateWorkspaceProfile(workspaceId, profile),
  );

export const updateWorkspaceAgents = async (
  workspaceId: string,
  agents: EnterpriseLeadWorkspaceAgentBinding[],
): Promise<EnterpriseLeadWorkspace | null> =>
  request<EnterpriseLeadWorkspace | null>(
    'updateWorkspaceAgents',
    null,
    api => api.updateWorkspaceAgents(workspaceId, agents),
  );

export const listRuns = async (
  workspaceId: string,
): Promise<EnterpriseLeadWorkspaceRunSummary[]> =>
  request<EnterpriseLeadWorkspaceRunSummary[]>(
    'listRuns',
    [],
    api => api.listRuns(workspaceId),
  );

export const createRun = async (
  workspaceId: string,
  userGoal: string,
): Promise<EnterpriseLeadWorkspaceSnapshot | null> =>
  request<EnterpriseLeadWorkspaceSnapshot | null>(
    'createRun',
    null,
    api => api.createRun(workspaceId, userGoal),
  );

export const getRun = async (
  workspaceId: string,
  runId?: string,
): Promise<EnterpriseLeadWorkspaceSnapshot | null> =>
  request<EnterpriseLeadWorkspaceSnapshot | null>(
    'getRun',
    null,
    api => api.getRun(workspaceId, runId),
  );

export const runWorkflow = async (
  workspaceId: string,
  runId: string,
): Promise<EnterpriseLeadWorkspaceSnapshot | null> =>
  request<EnterpriseLeadWorkspaceSnapshot | null>(
    'runWorkflow',
    null,
    api => api.runWorkflow(workspaceId, runId),
  );

export const listChatSessions = async (
  workspaceId: string,
): Promise<EnterpriseLeadWorkspaceChatSessionSummary[]> =>
  request<EnterpriseLeadWorkspaceChatSessionSummary[]>('listChatSessions', [], api =>
    api.listChatSessions(workspaceId),
  );

export const getChatSession = async (
  workspaceId: string,
  sessionId: string,
): Promise<EnterpriseLeadWorkspaceChatSession | null> =>
  request<EnterpriseLeadWorkspaceChatSession | null>('getChatSession', null, api =>
    api.getChatSession(workspaceId, sessionId),
  );

export const deleteChatSession = async (workspaceId: string, sessionId: string): Promise<boolean> =>
  requestOrThrow<boolean>('deleteChatSession', false, api =>
    api.deleteChatSession(workspaceId, sessionId),
  );

export const chat = async (
  workspaceId: string,
  chatRequest: EnterpriseLeadWorkspaceChatRequest,
): Promise<EnterpriseLeadWorkspaceChatResponse | null> =>
  request<EnterpriseLeadWorkspaceChatResponse | null>(
    'chat',
    null,
    api => api.chat(workspaceId, chatRequest),
  );

export const runTask = async (taskId: string): Promise<EnterpriseLeadAgentTask | null> =>
  request<EnterpriseLeadAgentTask | null>(
    'runTask',
    null,
    api => api.runTask(taskId),
  );

export const rerunTask = async (taskId: string): Promise<EnterpriseLeadAgentTask | null> =>
  request<EnterpriseLeadAgentTask | null>(
    'rerunTask',
    null,
    api => api.rerunTask(taskId),
  );

export const createPendingVersion = async (
  taskId: string,
  message: string,
): Promise<EnterpriseLeadPendingVersion | null> =>
  request<EnterpriseLeadPendingVersion | null>(
    'createPendingVersion',
    null,
    api => api.createPendingVersion(taskId, message),
  );

export const applyPendingVersion = async (
  pendingVersionId: string,
): Promise<EnterpriseLeadWorkspaceSnapshot | null> =>
  request<EnterpriseLeadWorkspaceSnapshot | null>(
    'applyPendingVersion',
    null,
    api => api.applyPendingVersion(pendingVersionId),
  );

export const archiveRun = async (
  workspaceId: string,
  runId: string,
): Promise<EnterpriseLeadWorkspaceSnapshot | null> =>
  request<EnterpriseLeadWorkspaceSnapshot | null>(
    'archiveRun',
    null,
    api => api.archiveRun(workspaceId, runId),
  );

export const enterpriseLeadWorkspaceService = {
  listWorkspaces,
  getWorkspace,
  extractDraft,
  createWorkspace,
  deleteWorkspace,
  updateWorkspaceProfile,
  updateWorkspaceSettings,
  updateWorkspaceAgents,
  listRuns,
  createRun,
  getRun,
  runWorkflow,
  listChatSessions,
  getChatSession,
  deleteChatSession,
  chat,
  runTask,
  rerunTask,
  createPendingVersion,
  applyPendingVersion,
  archiveRun,
};
