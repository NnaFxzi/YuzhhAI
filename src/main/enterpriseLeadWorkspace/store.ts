import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';

import type {
  EnterpriseLeadWorkspaceType,
} from '../../shared/enterpriseLeadWorkspace/constants';
import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadRunStatus,
  EnterpriseLeadTaskStatus,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadAgentTaskResult,
  EnterpriseLeadExtractionSource,
  EnterpriseLeadPendingVersion,
  EnterpriseLeadRiskItem,
  EnterpriseLeadRun,
  EnterpriseLeadTaskAgentRole,
  EnterpriseLeadTodoInput,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
  EnterpriseLeadWorkspaceChatMessage,
  EnterpriseLeadWorkspaceChatResearchResult,
  EnterpriseLeadWorkspaceChatSession,
  EnterpriseLeadWorkspaceChatSessionSummary,
  EnterpriseLeadWorkspaceProfile,
  EnterpriseLeadWorkspaceRunAgentSnapshot,
  EnterpriseLeadWorkspaceSettings,
  EnterpriseLeadWorkspaceSettingsUpdate,
} from '../../shared/enterpriseLeadWorkspace/types';
import {
  buildDefaultEnterpriseLeadWorkspaceSettings,
  normalizeEnterpriseLeadRunAgentSnapshot,
  normalizeEnterpriseLeadWorkspaceAgents,
  normalizeEnterpriseLeadWorkspaceSettings,
  normalizeEnterpriseLeadWorkspaceSettingsUpdate,
  normalizeWorkspaceProfile,
} from '../../shared/enterpriseLeadWorkspace/validation';

const defaultRiskRules = [
  'no_real_publish',
  'no_real_comment',
  'no_real_direct_message',
  'no_real_email',
  'draft_only_external_actions',
];

const cloneDefaultRiskRules = (): string[] => [...defaultRiskRules];

const defaultWorkspaceProfile = (): EnterpriseLeadWorkspaceProfile => ({
  companySummary: '',
  productList: [],
  productCapabilities: [],
  targetCustomers: [],
  applicationScenarios: [],
  sellingPoints: [],
  channelPreferences: [],
  prohibitedClaims: [],
  contactRules: [],
  missingInfo: [],
});

export interface CreateEnterpriseLeadWorkspaceInput {
  name: string;
  type: EnterpriseLeadWorkspaceType | string;
  profile: EnterpriseLeadWorkspaceProfile;
  extractionSources: EnterpriseLeadExtractionSource[];
  enabledAgentRoles: Array<EnterpriseLeadAgentRole | string>;
  settings?: EnterpriseLeadWorkspaceSettings;
  workspaceAgents?: EnterpriseLeadWorkspaceAgentBinding[];
  riskRules?: string[];
}

export interface CreateEnterpriseLeadRunInput {
  workspaceId: string;
  userGoal: string;
  roles?: EnterpriseLeadAgentRole[];
  tasks?: CreateEnterpriseLeadTaskInput[];
}

export interface CreateEnterpriseLeadTaskInput {
  role: EnterpriseLeadTaskAgentRole;
  workspaceAgentId?: string | null;
  agentSnapshot?: EnterpriseLeadWorkspaceRunAgentSnapshot | null;
}

export interface CreateEnterpriseLeadPendingVersionInput {
  taskId: string;
  userMessage: string;
  summary: string;
  outputPayload: Record<string, unknown>;
  missingInfo: string[];
  todos: EnterpriseLeadTodoInput[];
  risks: EnterpriseLeadRiskItem[];
  handoffContext: Record<string, unknown>;
}

export interface CreateEnterpriseLeadChatSessionInput {
  workspaceId: string;
  title: string;
}

export interface UpdateEnterpriseLeadRunProgressInput {
  runId: string;
  status: EnterpriseLeadRunStatus;
  currentRole: EnterpriseLeadTaskAgentRole | null;
  controllerSummary: string;
}

type EnterpriseLeadWorkspaceRow = Omit<
  EnterpriseLeadWorkspace,
  | 'profile'
  | 'extractionSources'
  | 'riskRules'
  | 'enabledAgentRoles'
  | 'settings'
  | 'workspaceAgents'
  | 'recentRunId'
> & {
  profile: string;
  extractionSources: string;
  riskRules: string;
  enabledAgentRoles: string;
  settings: string | null;
  workspaceAgents: string | null;
  recentRunId: string | null;
};

type EnterpriseLeadRunRow = EnterpriseLeadRun;

type EnterpriseLeadAgentTaskRow = Omit<
  EnterpriseLeadAgentTask,
  | 'agentSnapshot'
  | 'inputPayload'
  | 'outputPayload'
  | 'missingInfo'
  | 'todos'
  | 'risks'
  | 'handoffContext'
  | 'stale'
> & {
  agentSnapshot: string | null;
  inputPayload: string;
  outputPayload: string;
  missingInfo: string;
  todos: string;
  risks: string;
  handoffContext: string;
  stale: number;
};

type EnterpriseLeadPendingVersionRow = Omit<
  EnterpriseLeadPendingVersion,
  'outputPayload' | 'missingInfo' | 'todos' | 'risks' | 'handoffContext'
> & {
  outputPayload: string;
  missingInfo: string;
  todos: string;
  risks: string;
  handoffContext: string;
};

type EnterpriseLeadChatSessionRow = Omit<
  EnterpriseLeadWorkspaceChatSessionSummary,
  'messageCount'
> & {
  messageCount: number;
};

type EnterpriseLeadChatMessageRow = Omit<
  EnterpriseLeadWorkspaceChatMessage,
  'agent' | 'research' | 'routing'
> & {
  agent: string | null;
  routing: string | null;
  research: string | null;
  sequence: number;
};

const parseJsonValue = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const cleanText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const cleanNullableText = (value: unknown): string | null => {
  const text = cleanText(value);
  return text || null;
};

interface NormalizedCreateEnterpriseLeadTask {
  role: EnterpriseLeadTaskAgentRole;
  workspaceAgentId: string | null;
  agentSnapshot: EnterpriseLeadWorkspaceRunAgentSnapshot | null;
}

const normalizeCreateTaskInput = (
  task: CreateEnterpriseLeadTaskInput,
): NormalizedCreateEnterpriseLeadTask => {
  const role = cleanText(task.role);
  if (!role) {
    throw new Error('Enterprise lead task role is required');
  }

  return {
    role,
    workspaceAgentId: cleanNullableText(task.workspaceAgentId),
    agentSnapshot: normalizeEnterpriseLeadRunAgentSnapshot(task.agentSnapshot),
  };
};

const mapWorkspaceRow = (row: EnterpriseLeadWorkspaceRow): EnterpriseLeadWorkspace => ({
  ...row,
  profile: parseJsonValue(row.profile, defaultWorkspaceProfile()),
  extractionSources: parseJsonValue(row.extractionSources, []),
  riskRules: parseJsonValue(row.riskRules, cloneDefaultRiskRules()),
  enabledAgentRoles: parseJsonValue(row.enabledAgentRoles, []),
  settings: normalizeEnterpriseLeadWorkspaceSettings(
    row.settings ? parseJsonValue(row.settings, {}) : {},
  ),
  workspaceAgents: normalizeEnterpriseLeadWorkspaceAgents(
    row.workspaceAgents ? parseJsonValue(row.workspaceAgents, []) : [],
  ),
});

const mapRunRow = (row: EnterpriseLeadRunRow): EnterpriseLeadRun => row;

const mapTaskRow = (row: EnterpriseLeadAgentTaskRow): EnterpriseLeadAgentTask => ({
  ...row,
  workspaceAgentId: row.workspaceAgentId ?? null,
  agentSnapshot: row.agentSnapshot
    ? normalizeEnterpriseLeadRunAgentSnapshot(parseJsonValue(row.agentSnapshot, null))
    : null,
  inputPayload: parseJsonValue(row.inputPayload, {}),
  outputPayload: parseJsonValue(row.outputPayload, {}),
  missingInfo: parseJsonValue(row.missingInfo, []),
  todos: parseJsonValue(row.todos, []),
  risks: parseJsonValue(row.risks, []),
  handoffContext: parseJsonValue(row.handoffContext, {}),
  stale: row.stale === 1,
});

const mapPendingVersionRow = (row: EnterpriseLeadPendingVersionRow): EnterpriseLeadPendingVersion => ({
  ...row,
  outputPayload: parseJsonValue(row.outputPayload, {}),
  missingInfo: parseJsonValue(row.missingInfo, []),
  todos: parseJsonValue(row.todos, []),
  risks: parseJsonValue(row.risks, []),
  handoffContext: parseJsonValue(row.handoffContext, {}),
});

const mapChatMessageRow = (row: EnterpriseLeadChatMessageRow): EnterpriseLeadWorkspaceChatMessage => {
  const message: EnterpriseLeadWorkspaceChatMessage = {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
  };
  if (row.research) {
    message.research = parseJsonValue<EnterpriseLeadWorkspaceChatResearchResult | undefined>(
      row.research,
      undefined,
    );
  }
  if (row.agent) {
    message.agent = parseJsonValue<EnterpriseLeadWorkspaceChatMessage['agent'] | undefined>(
      row.agent,
      undefined,
    );
  }
  if (row.routing) {
    message.routing = parseJsonValue<EnterpriseLeadWorkspaceChatMessage['routing'] | undefined>(
      row.routing,
      undefined,
    );
  }
  return message;
};

export class EnterpriseLeadWorkspaceStore {
  constructor(private readonly db: Database.Database) {
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS enterprise_lead_workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        profile TEXT NOT NULL,
        extraction_sources TEXT NOT NULL,
        risk_rules TEXT NOT NULL,
        enabled_agent_roles TEXT NOT NULL,
        settings TEXT,
        workspace_agents TEXT,
        recent_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS enterprise_lead_runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_goal TEXT NOT NULL,
        status TEXT NOT NULL,
        current_role TEXT,
        controller_summary TEXT NOT NULL,
        archive_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS enterprise_lead_agent_tasks (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        role TEXT NOT NULL,
        workspace_agent_id TEXT,
        agent_snapshot TEXT,
        sequence INTEGER NOT NULL,
        status TEXT NOT NULL,
        input_payload TEXT NOT NULL,
        output_payload TEXT NOT NULL,
        summary TEXT NOT NULL,
        missing_info TEXT NOT NULL,
        todos TEXT NOT NULL,
        risks TEXT NOT NULL,
        handoff_context TEXT NOT NULL,
        error TEXT NOT NULL,
        stale INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS enterprise_lead_pending_versions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        role TEXT NOT NULL,
        user_message TEXT NOT NULL,
        summary TEXT NOT NULL,
        output_payload TEXT NOT NULL,
        missing_info TEXT NOT NULL,
        todos TEXT NOT NULL,
        risks TEXT NOT NULL,
        handoff_context TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        applied_at TEXT
      );

      CREATE TABLE IF NOT EXISTS enterprise_lead_chat_sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS enterprise_lead_chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        agent TEXT,
        routing TEXT,
        research TEXT,
        sequence INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_enterprise_lead_chat_sessions_workspace_updated
      ON enterprise_lead_chat_sessions(workspace_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_enterprise_lead_chat_messages_session_sequence
      ON enterprise_lead_chat_messages(session_id, sequence);
    `);
    this.ensureRunArchiveColumns();
    this.ensureAgentTaskSequenceColumn();
    this.ensureAgentTaskAgentColumns();
    this.ensureWorkspaceSettingsColumn();
    this.ensureWorkspaceAgentsColumn();
    this.ensureChatMessageAgentColumn();
    this.ensureChatMessageRoutingColumn();
  }

  private ensureChatMessageAgentColumn(): void {
    const columns = this.db.pragma('table_info(enterprise_lead_chat_messages)') as Array<{ name: string }>;
    const columnNames = new Set(columns.map(column => column.name));
    if (!columnNames.has('agent')) {
      this.db.exec('ALTER TABLE enterprise_lead_chat_messages ADD COLUMN agent TEXT;');
    }
  }

  private ensureChatMessageRoutingColumn(): void {
    const columns = this.db.pragma('table_info(enterprise_lead_chat_messages)') as Array<{ name: string }>;
    const columnNames = new Set(columns.map(column => column.name));
    if (!columnNames.has('routing')) {
      this.db.exec('ALTER TABLE enterprise_lead_chat_messages ADD COLUMN routing TEXT;');
    }
  }

  private ensureAgentTaskAgentColumns(): void {
    const columns = this.db.pragma('table_info(enterprise_lead_agent_tasks)') as Array<{ name: string }>;
    const columnNames = new Set(columns.map(column => column.name));
    if (!columnNames.has('workspace_agent_id')) {
      this.db.exec('ALTER TABLE enterprise_lead_agent_tasks ADD COLUMN workspace_agent_id TEXT;');
    }
    if (!columnNames.has('agent_snapshot')) {
      this.db.exec('ALTER TABLE enterprise_lead_agent_tasks ADD COLUMN agent_snapshot TEXT;');
    }
  }

  private ensureWorkspaceSettingsColumn(): void {
    const columns = this.db.pragma('table_info(enterprise_lead_workspaces)') as Array<{ name: string }>;
    const columnNames = new Set(columns.map(column => column.name));
    if (!columnNames.has('settings')) {
      this.db.exec('ALTER TABLE enterprise_lead_workspaces ADD COLUMN settings TEXT;');
    }
  }

  private ensureWorkspaceAgentsColumn(): void {
    const columns = this.db.pragma('table_info(enterprise_lead_workspaces)') as Array<{ name: string }>;
    const columnNames = new Set(columns.map(column => column.name));
    if (!columnNames.has('workspace_agents')) {
      this.db.exec('ALTER TABLE enterprise_lead_workspaces ADD COLUMN workspace_agents TEXT;');
    }
  }

  private ensureRunArchiveColumns(): void {
    const columns = this.db.pragma('table_info(enterprise_lead_runs)') as Array<{ name: string }>;
    const columnNames = new Set(columns.map(column => column.name));
    if (!columnNames.has('archive_status')) {
      this.db.exec(`
        ALTER TABLE enterprise_lead_runs
        ADD COLUMN archive_status TEXT NOT NULL DEFAULT 'not_archived';
      `);
    }
    if (!columnNames.has('completed_at')) {
      this.db.exec('ALTER TABLE enterprise_lead_runs ADD COLUMN completed_at TEXT;');
    }
    this.db.prepare(`
      UPDATE enterprise_lead_runs
      SET archive_status = CASE
        WHEN status = ? THEN 'archived'
        ELSE 'not_archived'
      END
      WHERE archive_status IS NULL OR archive_status = '' OR archive_status = 'not_archived'
    `).run(EnterpriseLeadRunStatus.Archived);
    this.db.prepare(`
      UPDATE enterprise_lead_runs
      SET completed_at = updated_at
      WHERE status = ? AND completed_at IS NULL
    `).run(EnterpriseLeadRunStatus.Archived);
  }

  private ensureAgentTaskSequenceColumn(): void {
    const columns = this.db.pragma('table_info(enterprise_lead_agent_tasks)') as Array<{ name: string }>;
    const columnNames = new Set(columns.map(column => column.name));
    if (!columnNames.has('sequence')) {
      this.db.exec('ALTER TABLE enterprise_lead_agent_tasks ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0;');
    }
    this.backfillAgentTaskSequences();
  }

  private backfillAgentTaskSequences(): void {
    const runs = this.db.prepare(`
      SELECT run_id as runId
      FROM enterprise_lead_agent_tasks
      GROUP BY run_id
      HAVING COUNT(*) > 1 AND COUNT(DISTINCT sequence) < COUNT(*)
    `).all() as Array<{ runId: string }>;
    if (runs.length === 0) {
      return;
    }

    const selectTasks = this.db.prepare(`
      SELECT id
      FROM enterprise_lead_agent_tasks
      WHERE run_id = ?
      ORDER BY rowid ASC
    `);
    const updateSequence = this.db.prepare(`
      UPDATE enterprise_lead_agent_tasks
      SET sequence = ?
      WHERE id = ?
    `);
    const backfillTransaction = this.db.transaction(() => {
      runs.forEach(run => {
        const tasks = selectTasks.all(run.runId) as Array<{ id: string }>;
        tasks.forEach((task, index) => {
          updateSequence.run(index, task.id);
        });
      });
    });

    backfillTransaction();
  }

  createWorkspace(input: CreateEnterpriseLeadWorkspaceInput): EnterpriseLeadWorkspace {
    const now = new Date().toISOString();
    const workspace: EnterpriseLeadWorkspace = {
      id: randomUUID(),
      name: input.name,
      type: input.type,
      profile: input.profile,
      extractionSources: input.extractionSources,
      riskRules: input.riskRules ? [...input.riskRules] : cloneDefaultRiskRules(),
      enabledAgentRoles: input.enabledAgentRoles,
      settings: normalizeEnterpriseLeadWorkspaceSettings(
        input.settings ?? buildDefaultEnterpriseLeadWorkspaceSettings(),
      ),
      workspaceAgents: normalizeEnterpriseLeadWorkspaceAgents(input.workspaceAgents),
      recentRunId: null,
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO enterprise_lead_workspaces (
        id,
        name,
        type,
        profile,
        extraction_sources,
        risk_rules,
        enabled_agent_roles,
        settings,
        workspace_agents,
        recent_run_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      workspace.id,
      workspace.name,
      workspace.type,
      JSON.stringify(workspace.profile),
      JSON.stringify(workspace.extractionSources),
      JSON.stringify(workspace.riskRules),
      JSON.stringify(workspace.enabledAgentRoles),
      JSON.stringify(workspace.settings),
      JSON.stringify(workspace.workspaceAgents),
      workspace.recentRunId,
      workspace.createdAt,
      workspace.updatedAt,
    );

    return workspace;
  }

  listWorkspaces(): EnterpriseLeadWorkspace[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        name,
        type,
        profile,
        extraction_sources as extractionSources,
        risk_rules as riskRules,
        enabled_agent_roles as enabledAgentRoles,
        settings,
        workspace_agents as workspaceAgents,
        recent_run_id as recentRunId,
        created_at as createdAt,
        updated_at as updatedAt
      FROM enterprise_lead_workspaces
      ORDER BY updated_at DESC, rowid DESC
    `).all() as EnterpriseLeadWorkspaceRow[];

    return rows.map(mapWorkspaceRow);
  }

  getWorkspace(id: string): EnterpriseLeadWorkspace | null {
    const row = this.db.prepare(`
      SELECT
        id,
        name,
        type,
        profile,
        extraction_sources as extractionSources,
        risk_rules as riskRules,
        enabled_agent_roles as enabledAgentRoles,
        settings,
        workspace_agents as workspaceAgents,
        recent_run_id as recentRunId,
        created_at as createdAt,
        updated_at as updatedAt
      FROM enterprise_lead_workspaces
      WHERE id = ?
      LIMIT 1
    `).get(id) as EnterpriseLeadWorkspaceRow | undefined;

    return row ? mapWorkspaceRow(row) : null;
  }

  deleteWorkspace(workspaceId: string): boolean {
    const deleteTransaction = this.db.transaction(() => {
      this.db.prepare(`
        DELETE FROM enterprise_lead_chat_messages
        WHERE session_id IN (
          SELECT id
          FROM enterprise_lead_chat_sessions
          WHERE workspace_id = ?
        )
      `).run(workspaceId);

      this.db.prepare(`
        DELETE FROM enterprise_lead_chat_sessions
        WHERE workspace_id = ?
      `).run(workspaceId);

      this.db.prepare(`
        DELETE FROM enterprise_lead_pending_versions
        WHERE workspace_id = ?
      `).run(workspaceId);

      this.db.prepare(`
        DELETE FROM enterprise_lead_agent_tasks
        WHERE run_id IN (
          SELECT id
          FROM enterprise_lead_runs
          WHERE workspace_id = ?
        )
      `).run(workspaceId);

      this.db.prepare(`
        DELETE FROM enterprise_lead_runs
        WHERE workspace_id = ?
      `).run(workspaceId);

      const result = this.db.prepare(`
        DELETE FROM enterprise_lead_workspaces
        WHERE id = ?
      `).run(workspaceId);

      return result.changes > 0;
    });

    return deleteTransaction();
  }

  updateWorkspaceSettings(
    workspaceId: string,
    input: EnterpriseLeadWorkspaceSettingsUpdate,
  ): EnterpriseLeadWorkspace {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    const normalized = normalizeEnterpriseLeadWorkspaceSettingsUpdate(input, workspace.settings);
    const enabledAgentRoles = normalized.enabledAgentRoles ?? workspace.enabledAgentRoles;
    const settings: EnterpriseLeadWorkspaceSettings = normalized.settings
      ? normalizeEnterpriseLeadWorkspaceSettings(normalized.settings, workspace.settings)
      : workspace.settings;
    const workspaceAgents = normalized.workspaceAgents ?? workspace.workspaceAgents;
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE enterprise_lead_workspaces
      SET enabled_agent_roles = ?, settings = ?, workspace_agents = ?, updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(enabledAgentRoles),
      JSON.stringify(settings),
      JSON.stringify(workspaceAgents),
      now,
      workspace.id,
    );

    const updated = this.getWorkspace(workspace.id);
    if (!updated) {
      throw new Error('Enterprise lead workspace not found');
    }
    return updated;
  }

  updateWorkspaceProfile(
    workspaceId: string,
    profile: EnterpriseLeadWorkspaceProfile,
  ): EnterpriseLeadWorkspace {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    const normalizedProfile = normalizeWorkspaceProfile(profile);
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE enterprise_lead_workspaces
      SET profile = ?, updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(normalizedProfile),
      now,
      workspace.id,
    );

    const updated = this.getWorkspace(workspace.id);
    if (!updated) {
      throw new Error('Enterprise lead workspace not found');
    }
    return updated;
  }

  updateWorkspaceAgents(
    workspaceId: string,
    agents: EnterpriseLeadWorkspaceAgentBinding[],
  ): EnterpriseLeadWorkspace {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    const workspaceAgents = normalizeEnterpriseLeadWorkspaceAgents(agents);
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE enterprise_lead_workspaces
      SET workspace_agents = ?, updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(workspaceAgents),
      now,
      workspace.id,
    );

    const updated = this.getWorkspace(workspace.id);
    if (!updated) {
      throw new Error('Enterprise lead workspace not found');
    }
    return updated;
  }

  createRun(input: CreateEnterpriseLeadRunInput): EnterpriseLeadRun {
    const workspace = this.getWorkspace(input.workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    const taskInputs: NormalizedCreateEnterpriseLeadTask[] =
      input.tasks && input.tasks.length > 0
        ? input.tasks.map(normalizeCreateTaskInput)
        : (input.roles ?? []).map((role): NormalizedCreateEnterpriseLeadTask => ({
            role,
            workspaceAgentId: null,
            agentSnapshot: null,
          }));
    const currentTaskRole = taskInputs[0]?.role;
    const now = new Date().toISOString();
    const run: EnterpriseLeadRun = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      userGoal: input.userGoal,
      status: EnterpriseLeadRunStatus.Running,
      currentRole: currentTaskRole ?? null,
      controllerSummary: '',
      archiveStatus: 'not_archived',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    const createRunTransaction = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO enterprise_lead_runs (
          id,
          workspace_id,
          user_goal,
          status,
          current_role,
          controller_summary,
          archive_status,
          created_at,
          updated_at,
          completed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        run.id,
        run.workspaceId,
        run.userGoal,
        run.status,
        run.currentRole,
        run.controllerSummary,
        run.archiveStatus,
        run.createdAt,
        run.updatedAt,
        run.completedAt,
      );

      const insertTask = this.db.prepare(`
        INSERT INTO enterprise_lead_agent_tasks (
          id,
          run_id,
          role,
          workspace_agent_id,
          agent_snapshot,
          sequence,
          status,
          input_payload,
          output_payload,
          summary,
          missing_info,
          todos,
          risks,
          handoff_context,
          error,
          stale,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const inputPayload = {
        workspaceId: workspace.id,
        workspaceProfile: workspace.profile,
        userGoal: input.userGoal,
      };
      taskInputs.forEach((task, index) => {
        insertTask.run(
          randomUUID(),
          run.id,
          task.role,
          task.workspaceAgentId,
          task.agentSnapshot ? JSON.stringify(task.agentSnapshot) : null,
          index,
          EnterpriseLeadTaskStatus.Waiting,
          JSON.stringify(inputPayload),
          JSON.stringify({}),
          '',
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify({}),
          '',
          0,
          now,
          now,
        );
      });

      this.db.prepare(`
        UPDATE enterprise_lead_workspaces
        SET recent_run_id = ?, updated_at = ?
        WHERE id = ?
      `).run(run.id, now, workspace.id);
    });

    createRunTransaction();
    return run;
  }

  getRun(runId: string): EnterpriseLeadRun | null {
    const row = this.db.prepare(`
      SELECT
        id,
        workspace_id as workspaceId,
        user_goal as userGoal,
        status,
        current_role as currentRole,
        controller_summary as controllerSummary,
        archive_status as archiveStatus,
        created_at as createdAt,
        updated_at as updatedAt,
        completed_at as completedAt
      FROM enterprise_lead_runs
      WHERE id = ?
      LIMIT 1
    `).get(runId) as EnterpriseLeadRunRow | undefined;

    return row ? mapRunRow(row) : null;
  }

  listRuns(workspaceId: string): EnterpriseLeadRun[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        workspace_id as workspaceId,
        user_goal as userGoal,
        status,
        current_role as currentRole,
        controller_summary as controllerSummary,
        archive_status as archiveStatus,
        created_at as createdAt,
        updated_at as updatedAt,
        completed_at as completedAt
      FROM enterprise_lead_runs
      WHERE workspace_id = ?
      ORDER BY created_at DESC, rowid DESC
    `).all(workspaceId) as EnterpriseLeadRunRow[];

    return rows.map(mapRunRow);
  }

  createChatSession(input: CreateEnterpriseLeadChatSessionInput): EnterpriseLeadWorkspaceChatSessionSummary {
    const workspace = this.getWorkspace(input.workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    const now = new Date().toISOString();
    const session: EnterpriseLeadWorkspaceChatSessionSummary = {
      id: randomUUID(),
      workspaceId: workspace.id,
      title: cleanText(input.title) || 'New chat',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    };

    this.db.prepare(`
      INSERT INTO enterprise_lead_chat_sessions (
        id,
        workspace_id,
        title,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.workspaceId,
      session.title,
      session.createdAt,
      session.updatedAt,
    );

    return session;
  }

  listChatSessions(workspaceId: string): EnterpriseLeadWorkspaceChatSessionSummary[] {
    const rows = this.db.prepare(`
      SELECT
        sessions.id,
        sessions.workspace_id as workspaceId,
        sessions.title,
        sessions.created_at as createdAt,
        sessions.updated_at as updatedAt,
        COUNT(messages.id) as messageCount
      FROM enterprise_lead_chat_sessions sessions
      LEFT JOIN enterprise_lead_chat_messages messages
        ON messages.session_id = sessions.id
      WHERE sessions.workspace_id = ?
      GROUP BY sessions.id
      ORDER BY sessions.updated_at DESC, sessions.rowid DESC
    `).all(workspaceId) as EnterpriseLeadChatSessionRow[];

    return rows;
  }

  getChatSession(workspaceId: string, sessionId: string): EnterpriseLeadWorkspaceChatSession | null {
    const session = this.db.prepare(`
      SELECT
        sessions.id,
        sessions.workspace_id as workspaceId,
        sessions.title,
        sessions.created_at as createdAt,
        sessions.updated_at as updatedAt,
        COUNT(messages.id) as messageCount
      FROM enterprise_lead_chat_sessions sessions
      LEFT JOIN enterprise_lead_chat_messages messages
        ON messages.session_id = sessions.id
      WHERE sessions.workspace_id = ? AND sessions.id = ?
      GROUP BY sessions.id
      LIMIT 1
    `).get(workspaceId, sessionId) as EnterpriseLeadChatSessionRow | undefined;

    if (!session) {
      return null;
    }

    const messages = this.db.prepare(`
      SELECT
        id,
        role,
        content,
        agent,
        routing,
        research,
        sequence,
        created_at as createdAt
      FROM enterprise_lead_chat_messages
      WHERE session_id = ?
      ORDER BY sequence ASC, rowid ASC
    `).all(sessionId) as EnterpriseLeadChatMessageRow[];

    return {
      ...session,
      messages: messages.map(mapChatMessageRow),
    };
  }

  deleteChatSession(workspaceId: string, sessionId: string): boolean {
    const deleteTransaction = this.db.transaction(() => {
      const session = this.db.prepare(`
        SELECT id
        FROM enterprise_lead_chat_sessions
        WHERE id = ? AND workspace_id = ?
        LIMIT 1
      `).get(sessionId, workspaceId) as { id: string } | undefined;
      if (!session) {
        return false;
      }

      this.db.prepare(`
        DELETE FROM enterprise_lead_chat_messages
        WHERE session_id = ?
      `).run(sessionId);

      const result = this.db.prepare(`
        DELETE FROM enterprise_lead_chat_sessions
        WHERE id = ? AND workspace_id = ?
      `).run(sessionId, workspaceId);

      return result.changes > 0;
    });

    return deleteTransaction();
  }

  appendChatMessage(
    sessionId: string,
    message: EnterpriseLeadWorkspaceChatMessage,
  ): EnterpriseLeadWorkspaceChatMessage {
    const session = this.db.prepare(`
      SELECT id
      FROM enterprise_lead_chat_sessions
      WHERE id = ?
      LIMIT 1
    `).get(sessionId) as { id: string } | undefined;
    if (!session) {
      throw new Error('Enterprise lead chat session not found');
    }

    const nextSequence = (
      this.db.prepare(`
        SELECT COALESCE(MAX(sequence), 0) + 1 as nextSequence
        FROM enterprise_lead_chat_messages
        WHERE session_id = ?
      `).get(sessionId) as { nextSequence: number }
    ).nextSequence;
    const createdAt = cleanText(message.createdAt) || new Date().toISOString();
    const sanitized: EnterpriseLeadWorkspaceChatMessage = {
      id: cleanText(message.id) || randomUUID(),
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
      createdAt,
    };
    if (message.research) {
      sanitized.research = message.research;
    }
    if (message.agent?.id && message.agent.name) {
      sanitized.agent = {
        id: cleanText(message.agent.id),
        name: cleanText(message.agent.name),
      };
    }
    const routingAgents = message.routing?.agents
      .map(agent => ({
        id: cleanText(agent.id),
        name: cleanText(agent.name),
      }))
      .filter(agent => agent.id && agent.name) ?? [];
    if (message.routing?.reason && routingAgents.length > 0) {
      const routingSteps = message.routing.steps
        ?.map(step => ({
          agent: {
            id: cleanText(step.agent.id),
            name: cleanText(step.agent.name),
          },
          content: cleanText(step.content),
        }))
        .filter(step => step.agent.id && step.agent.name && step.content) ?? [];
      sanitized.routing = {
        reason: cleanText(message.routing.reason),
        agents: routingAgents,
        ...(routingSteps.length > 0 ? { steps: routingSteps } : {}),
      };
    }

    const appendTransaction = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO enterprise_lead_chat_messages (
          id,
          session_id,
          role,
          content,
          agent,
          routing,
          research,
          sequence,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sanitized.id,
        sessionId,
        sanitized.role,
        sanitized.content,
        sanitized.agent ? JSON.stringify(sanitized.agent) : null,
        sanitized.routing ? JSON.stringify(sanitized.routing) : null,
        sanitized.research ? JSON.stringify(sanitized.research) : null,
        nextSequence,
        sanitized.createdAt,
      );

      this.db.prepare(`
        UPDATE enterprise_lead_chat_sessions
        SET updated_at = ?
        WHERE id = ?
      `).run(sanitized.createdAt, sessionId);
    });

    appendTransaction();
    return sanitized;
  }

  updateRunProgress(input: UpdateEnterpriseLeadRunProgressInput): EnterpriseLeadRun {
    this.assertRunMutable(input.runId);

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE enterprise_lead_runs
      SET
        status = ?,
        current_role = ?,
        controller_summary = ?,
        updated_at = ?,
        completed_at = CASE
          WHEN ? THEN COALESCE(completed_at, ?)
          ELSE completed_at
        END
      WHERE id = ?
    `).run(
      input.status,
      input.currentRole,
      input.controllerSummary,
      now,
      input.status === EnterpriseLeadRunStatus.Completed ? 1 : 0,
      now,
      input.runId,
    );

    const run = this.getRun(input.runId);
    if (!run) {
      throw new Error('Enterprise lead run not found');
    }
    return run;
  }

  listArchivedRuns(workspaceId: string): EnterpriseLeadRun[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        workspace_id as workspaceId,
        user_goal as userGoal,
        status,
        current_role as currentRole,
        controller_summary as controllerSummary,
        archive_status as archiveStatus,
        created_at as createdAt,
        updated_at as updatedAt,
        completed_at as completedAt
      FROM enterprise_lead_runs
      WHERE workspace_id = ? AND (status = ? OR archive_status = 'archived')
      ORDER BY completed_at DESC, updated_at DESC, rowid DESC
    `).all(workspaceId, EnterpriseLeadRunStatus.Archived) as EnterpriseLeadRunRow[];

    return rows.map(mapRunRow);
  }

  archiveRun(workspaceId: string, runId: string): EnterpriseLeadRun {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error('Enterprise lead run not found');
    }
    if (run.workspaceId !== workspaceId) {
      throw new Error('Enterprise lead run does not belong to workspace');
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE enterprise_lead_runs
      SET
        status = ?,
        archive_status = 'archived',
        updated_at = ?,
        completed_at = COALESCE(completed_at, ?)
      WHERE id = ? AND workspace_id = ?
    `).run(
      EnterpriseLeadRunStatus.Archived,
      now,
      now,
      runId,
      workspaceId,
    );

    const archivedRun = this.getRun(runId);
    if (!archivedRun) {
      throw new Error('Enterprise lead run not found');
    }
    return archivedRun;
  }

  listTasks(runId: string): EnterpriseLeadAgentTask[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        run_id as runId,
        role,
        workspace_agent_id as workspaceAgentId,
        agent_snapshot as agentSnapshot,
        status,
        input_payload as inputPayload,
        output_payload as outputPayload,
        summary,
        missing_info as missingInfo,
        todos,
        risks,
        handoff_context as handoffContext,
        error,
        stale,
        created_at as createdAt,
        updated_at as updatedAt
      FROM enterprise_lead_agent_tasks
      WHERE run_id = ?
      ORDER BY sequence ASC
    `).all(runId) as EnterpriseLeadAgentTaskRow[];

    return rows.map(mapTaskRow);
  }

  getTask(taskId: string): EnterpriseLeadAgentTask | null {
    const row = this.db.prepare(`
      SELECT
        id,
        run_id as runId,
        role,
        workspace_agent_id as workspaceAgentId,
        agent_snapshot as agentSnapshot,
        status,
        input_payload as inputPayload,
        output_payload as outputPayload,
        summary,
        missing_info as missingInfo,
        todos,
        risks,
        handoff_context as handoffContext,
        error,
        stale,
        created_at as createdAt,
        updated_at as updatedAt
      FROM enterprise_lead_agent_tasks
      WHERE id = ?
      LIMIT 1
    `).get(taskId) as EnterpriseLeadAgentTaskRow | undefined;

    return row ? mapTaskRow(row) : null;
  }

  updateTaskResult(taskId: string, result: EnterpriseLeadAgentTaskResult): void {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error('Enterprise lead task not found');
    }
    this.assertRunMutable(task.runId);
    const taskSequence = this.findTaskSequence(taskId);
    if (!taskSequence) {
      throw new Error('Enterprise lead task not found');
    }

    const now = new Date().toISOString();
    const updateTransaction = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE enterprise_lead_agent_tasks
        SET
          status = ?,
          output_payload = ?,
          summary = ?,
          missing_info = ?,
          todos = ?,
          risks = ?,
          handoff_context = ?,
          error = '',
          stale = 0,
          updated_at = ?
        WHERE id = ?
      `).run(
        result.status,
        JSON.stringify(result.outputs),
        result.summary,
        JSON.stringify(result.missingInfo),
        JSON.stringify(result.todos),
        JSON.stringify(result.risks),
        JSON.stringify(result.handoffContext),
        now,
        taskId,
      );

      this.markDownstreamTasksStale(task.runId, taskSequence.sequence, now);
    });

    updateTransaction();
  }

  createPendingVersion(input: CreateEnterpriseLeadPendingVersionInput): EnterpriseLeadPendingVersion {
    const task = this.getTask(input.taskId);
    if (!task) {
      throw new Error('Enterprise lead task not found');
    }
    this.assertRunMutable(task.runId);

    const now = new Date().toISOString();
    const pendingVersion: EnterpriseLeadPendingVersion = {
      id: randomUUID(),
      taskId: task.id,
      runId: task.runId,
      workspaceId: this.findWorkspaceIdByRunId(task.runId),
      role: task.role,
      userMessage: input.userMessage,
      summary: input.summary,
      outputPayload: input.outputPayload,
      missingInfo: input.missingInfo,
      todos: input.todos,
      risks: input.risks,
      handoffContext: input.handoffContext,
      status: 'pending',
      createdAt: now,
      appliedAt: null,
    };

    this.db.prepare(`
      INSERT INTO enterprise_lead_pending_versions (
        id,
        task_id,
        run_id,
        workspace_id,
        role,
        user_message,
        summary,
        output_payload,
        missing_info,
        todos,
        risks,
        handoff_context,
        status,
        created_at,
        applied_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pendingVersion.id,
      pendingVersion.taskId,
      pendingVersion.runId,
      pendingVersion.workspaceId,
      pendingVersion.role,
      pendingVersion.userMessage,
      pendingVersion.summary,
      JSON.stringify(pendingVersion.outputPayload),
      JSON.stringify(pendingVersion.missingInfo),
      JSON.stringify(pendingVersion.todos),
      JSON.stringify(pendingVersion.risks),
      JSON.stringify(pendingVersion.handoffContext),
      pendingVersion.status,
      pendingVersion.createdAt,
      pendingVersion.appliedAt,
    );

    return pendingVersion;
  }

  listPendingVersions(runId: string): EnterpriseLeadPendingVersion[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        task_id as taskId,
        run_id as runId,
        workspace_id as workspaceId,
        role,
        user_message as userMessage,
        summary,
        output_payload as outputPayload,
        missing_info as missingInfo,
        todos,
        risks,
        handoff_context as handoffContext,
        status,
        created_at as createdAt,
        applied_at as appliedAt
      FROM enterprise_lead_pending_versions
      WHERE run_id = ?
      ORDER BY created_at DESC, rowid DESC
    `).all(runId) as EnterpriseLeadPendingVersionRow[];

    return rows.map(mapPendingVersionRow);
  }

  applyPendingVersion(pendingVersionId: string): EnterpriseLeadPendingVersion {
    const pendingVersion = this.getPendingVersion(pendingVersionId);
    if (!pendingVersion) {
      throw new Error('Enterprise lead pending version not found');
    }
    if (pendingVersion.status !== 'pending') {
      throw new Error('Enterprise lead pending version is not pending');
    }

    const taskSequence = this.findTaskSequence(pendingVersion.taskId);
    if (!taskSequence) {
      throw new Error('Enterprise lead task not found');
    }
    this.assertRunMutable(pendingVersion.runId);

    const now = new Date().toISOString();
    const applyTransaction = this.db.transaction(() => {
      const pendingUpdate = this.db.prepare(`
        UPDATE enterprise_lead_pending_versions
        SET status = 'applied', applied_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(now, pendingVersion.id);
      if (pendingUpdate.changes === 0) {
        throw new Error('Enterprise lead pending version is not pending');
      }

      this.db.prepare(`
        UPDATE enterprise_lead_agent_tasks
        SET
          status = ?,
          output_payload = ?,
          summary = ?,
          missing_info = ?,
          todos = ?,
          risks = ?,
          handoff_context = ?,
          error = '',
          stale = 0,
          updated_at = ?
        WHERE id = ?
      `).run(
        EnterpriseLeadTaskStatus.Completed,
        JSON.stringify(pendingVersion.outputPayload),
        pendingVersion.summary,
        JSON.stringify(pendingVersion.missingInfo),
        JSON.stringify(pendingVersion.todos),
        JSON.stringify(pendingVersion.risks),
        JSON.stringify(pendingVersion.handoffContext),
        now,
        pendingVersion.taskId,
      );

      this.markDownstreamTasksStale(pendingVersion.runId, taskSequence.sequence, now);
    });

    applyTransaction();

    return {
      ...pendingVersion,
      status: 'applied',
      appliedAt: now,
    };
  }

  private getPendingVersion(pendingVersionId: string): EnterpriseLeadPendingVersion | null {
    const row = this.db.prepare(`
      SELECT
        id,
        task_id as taskId,
        run_id as runId,
        workspace_id as workspaceId,
        role,
        user_message as userMessage,
        summary,
        output_payload as outputPayload,
        missing_info as missingInfo,
        todos,
        risks,
        handoff_context as handoffContext,
        status,
        created_at as createdAt,
        applied_at as appliedAt
      FROM enterprise_lead_pending_versions
      WHERE id = ?
      LIMIT 1
    `).get(pendingVersionId) as EnterpriseLeadPendingVersionRow | undefined;

    return row ? mapPendingVersionRow(row) : null;
  }

  private assertRunMutable(runId: string): void {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error('Enterprise lead run not found');
    }
    if (run.status === EnterpriseLeadRunStatus.Archived || run.archiveStatus === 'archived') {
      throw new Error('Enterprise lead run is archived');
    }
  }

  private findWorkspaceIdByRunId(runId: string): string {
    const row = this.db.prepare(`
      SELECT workspace_id as workspaceId
      FROM enterprise_lead_runs
      WHERE id = ?
      LIMIT 1
    `).get(runId) as { workspaceId: string } | undefined;

    if (!row) {
      throw new Error('Enterprise lead run not found');
    }

    return row.workspaceId;
  }

  private findTaskSequence(taskId: string): { sequence: number } | null {
    const row = this.db.prepare(`
      SELECT sequence
      FROM enterprise_lead_agent_tasks
      WHERE id = ?
      LIMIT 1
    `).get(taskId) as { sequence: number } | undefined;

    return row || null;
  }

  private markDownstreamTasksStale(runId: string, sequence: number, now: string): void {
    this.db.prepare(`
      UPDATE enterprise_lead_agent_tasks
      SET status = ?, stale = 1, updated_at = ?
      WHERE
        run_id = ?
        AND sequence > ?
        AND (
          status <> ?
          OR summary <> ''
          OR output_payload <> '{}'
          OR todos <> '[]'
          OR risks <> '[]'
          OR handoff_context <> '{}'
        )
    `).run(
      EnterpriseLeadTaskStatus.Stale,
      now,
      runId,
      sequence,
      EnterpriseLeadTaskStatus.Waiting,
    );
  }
}
