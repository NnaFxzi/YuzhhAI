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
  EnterpriseLeadWorkspaceProfile,
  EnterpriseLeadWorkspaceRunAgentSnapshot,
  EnterpriseLeadWorkspaceSettings,
  EnterpriseLeadWorkspaceSettingsUpdate,
} from '../../shared/enterpriseLeadWorkspace/types';
import {
  buildDefaultEnterpriseLeadWorkspaceSettings,
  normalizeEnterpriseLeadExtractionSources,
  normalizeEnterpriseLeadRunAgentSnapshot,
  normalizeEnterpriseLeadWorkspaceAgents,
  normalizeEnterpriseLeadWorkspaceSettings,
  normalizeEnterpriseLeadWorkspaceSettingsUpdate,
  normalizeWorkspaceProfile,
} from '../../shared/enterpriseLeadWorkspace/validation';
import {
  normalizeWorkflowStartOptions,
  type WorkflowArtifactRef,
  WorkflowExecutionMode,
  type WorkflowStartOptions,
} from '../../shared/enterpriseLeadWorkspace/workflowContracts';
import { KNOWLEDGE_DOCUMENT_LEGACY_SOURCE_PREFIX } from '../../shared/knowledgeBase/constants';
import { buildLegacyKnowledgeSourceId } from '../knowledgeBase/legacyKnowledgeSourceIdentity';

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
  workflowVersion?: string;
  roles?: EnterpriseLeadAgentRole[];
  tasks?: CreateEnterpriseLeadTaskInput[];
}

export interface CreateEnterpriseLeadTaskInput {
  role: EnterpriseLeadTaskAgentRole;
  workspaceAgentId?: string | null;
  agentSnapshot?: EnterpriseLeadWorkspaceRunAgentSnapshot | null;
  nodeId?: string;
  dependsOnTaskIds?: string[];
  executionMode?: WorkflowExecutionMode;
}

export interface CreateEnterpriseLeadPendingVersionInput {
  taskId: string;
  userMessage: string;
  summary: string;
  taskStatus?: EnterpriseLeadTaskStatus;
  outputPayload: Record<string, unknown>;
  artifactRefs?: WorkflowArtifactRef[];
  missingInfo: string[];
  todos: EnterpriseLeadTodoInput[];
  risks: EnterpriseLeadRiskItem[];
  handoffContext: Record<string, unknown>;
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

type EnterpriseLeadRunRow = Omit<EnterpriseLeadRun, 'workflowVersion'> & {
  workflowVersion: string | null;
};

type EnterpriseLeadAgentTaskRow = Omit<
  EnterpriseLeadAgentTask,
  | 'agentSnapshot'
  | 'artifactRefs'
  | 'inputPayload'
  | 'outputPayload'
  | 'missingInfo'
  | 'todos'
  | 'risks'
  | 'handoffContext'
  | 'stale'
> & {
  nodeId: string | null;
  dependsOnTaskIds: string | null;
  attempt: number | null;
  executionMode: WorkflowExecutionMode | null;
  agentSnapshot: string | null;
  artifactRefs: string;
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
  'outputPayload' | 'artifactRefs' | 'missingInfo' | 'todos' | 'risks' | 'handoffContext'
> & {
  outputPayload: string;
  artifactRefs: string;
  missingInfo: string;
  todos: string;
  risks: string;
  handoffContext: string;
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
  nodeId: string | null;
  dependsOnTaskIds: string[];
  executionMode: WorkflowExecutionMode | null;
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
    nodeId: cleanNullableText(task.nodeId),
    dependsOnTaskIds: (task.dependsOnTaskIds ?? [])
      .map(cleanText)
      .filter(Boolean),
    executionMode: task.executionMode ?? null,
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

const mapRunRow = (row: EnterpriseLeadRunRow): EnterpriseLeadRun => ({
  ...row,
  workflowVersion: row.workflowVersion ?? undefined,
});

const mapTaskRow = (row: EnterpriseLeadAgentTaskRow): EnterpriseLeadAgentTask => ({
  ...row,
  workspaceAgentId: row.workspaceAgentId ?? null,
  agentSnapshot: row.agentSnapshot
    ? normalizeEnterpriseLeadRunAgentSnapshot(parseJsonValue(row.agentSnapshot, null))
    : null,
  nodeId: row.nodeId ?? undefined,
  dependsOnTaskIds: parseJsonValue(row.dependsOnTaskIds ?? '[]', []),
  attempt: row.attempt ?? undefined,
  executionMode: row.executionMode ?? undefined,
  artifactRefs: parseJsonValue(row.artifactRefs, []),
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
  artifactRefs: parseJsonValue(row.artifactRefs, []),
  missingInfo: parseJsonValue(row.missingInfo, []),
  todos: parseJsonValue(row.todos, []),
  risks: parseJsonValue(row.risks, []),
  handoffContext: parseJsonValue(row.handoffContext, {}),
});

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
        workflow_version TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        workflow_start_options TEXT
      );

      CREATE TABLE IF NOT EXISTS enterprise_lead_agent_tasks (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        role TEXT NOT NULL,
        node_id TEXT,
        depends_on_task_ids TEXT NOT NULL DEFAULT '[]',
        attempt INTEGER,
        execution_mode TEXT,
        workspace_agent_id TEXT,
        agent_snapshot TEXT,
        artifact_refs TEXT NOT NULL DEFAULT '[]',
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
        task_status TEXT NOT NULL DEFAULT 'completed',
        output_payload TEXT NOT NULL,
        artifact_refs TEXT NOT NULL DEFAULT '[]',
        missing_info TEXT NOT NULL,
        todos TEXT NOT NULL,
        risks TEXT NOT NULL,
        handoff_context TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        applied_at TEXT
      );

      CREATE TABLE IF NOT EXISTS enterprise_lead_workflow_artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        payload TEXT NOT NULL,
        evidence_ids TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS enterprise_lead_workflow_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        task_id TEXT,
        role TEXT,
        summary TEXT,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(run_id, sequence)
      );

      CREATE TABLE IF NOT EXISTS enterprise_lead_task_attempts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        execution_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT
      );
    `);
    this.ensureRunArchiveColumns();
    this.ensureWorkflowVersionColumn();
    this.ensureWorkflowRunOptionsColumn();
    this.ensureAgentTaskSequenceColumn();
    this.ensureWorkflowTaskColumns();
    this.migrateLegacyWorkflowTaskExecutionModes();
    this.ensureAgentTaskAgentColumns();
    this.ensureAgentTaskArtifactRefsColumn();
    this.ensurePendingVersionResultColumns();
    this.ensureWorkspaceSettingsColumn();
    this.ensureWorkspaceAgentsColumn();
  }

  private ensureWorkflowRunOptionsColumn(): void {
    const columns = this.db.pragma('table_info(enterprise_lead_runs)') as Array<{ name: string }>;
    const columnNames = new Set(columns.map(column => column.name));
    if (!columnNames.has('workflow_start_options')) {
      this.db.exec('ALTER TABLE enterprise_lead_runs ADD COLUMN workflow_start_options TEXT;');
    }
  }

  private ensureWorkflowVersionColumn(): void {
    const columns = this.db.pragma('table_info(enterprise_lead_runs)') as Array<{ name: string }>;
    if (!columns.some(column => column.name === 'workflow_version')) {
      this.db.exec('ALTER TABLE enterprise_lead_runs ADD COLUMN workflow_version TEXT;');
    }
  }

  private ensureWorkflowTaskColumns(): void {
    const columns = this.db.pragma('table_info(enterprise_lead_agent_tasks)') as Array<{ name: string }>;
    const columnNames = new Set(columns.map(column => column.name));
    if (!columnNames.has('node_id')) {
      this.db.exec('ALTER TABLE enterprise_lead_agent_tasks ADD COLUMN node_id TEXT;');
    }
    if (!columnNames.has('depends_on_task_ids')) {
      this.db.exec(
        "ALTER TABLE enterprise_lead_agent_tasks ADD COLUMN depends_on_task_ids TEXT NOT NULL DEFAULT '[]';",
      );
    }
    if (!columnNames.has('attempt')) {
      this.db.exec('ALTER TABLE enterprise_lead_agent_tasks ADD COLUMN attempt INTEGER;');
    }
    if (!columnNames.has('execution_mode')) {
      this.db.exec('ALTER TABLE enterprise_lead_agent_tasks ADD COLUMN execution_mode TEXT;');
    }
  }

  private migrateLegacyWorkflowTaskExecutionModes(): void {
    this.db.prepare(`
      UPDATE enterprise_lead_agent_tasks
      SET execution_mode = ?
      WHERE execution_mode IS NULL
    `).run(WorkflowExecutionMode.Inline);
  }

  getDatabase(): Database.Database {
    return this.db;
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

  private ensureAgentTaskArtifactRefsColumn(): void {
    const columns = this.db.pragma('table_info(enterprise_lead_agent_tasks)') as Array<{ name: string }>;
    const columnNames = new Set(columns.map(column => column.name));
    if (!columnNames.has('artifact_refs')) {
      this.db.exec(
        "ALTER TABLE enterprise_lead_agent_tasks ADD COLUMN artifact_refs TEXT NOT NULL DEFAULT '[]';",
      );
    }
  }

  private ensurePendingVersionResultColumns(): void {
    const columns = this.db.pragma('table_info(enterprise_lead_pending_versions)') as Array<{
      name: string;
    }>;
    const columnNames = new Set(columns.map(column => column.name));
    if (!columnNames.has('task_status')) {
      this.db.exec(
        "ALTER TABLE enterprise_lead_pending_versions ADD COLUMN task_status TEXT NOT NULL DEFAULT 'completed';",
      );
    }
    if (!columnNames.has('artifact_refs')) {
      this.db.exec(
        "ALTER TABLE enterprise_lead_pending_versions ADD COLUMN artifact_refs TEXT NOT NULL DEFAULT '[]';",
      );
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

  updateWorkspaceSources(
    workspaceId: string,
    sources: EnterpriseLeadExtractionSource[],
    options: {
      transformReconciledSources?: (
        sources: EnterpriseLeadExtractionSource[],
      ) => EnterpriseLeadExtractionSource[];
    } = {},
  ): EnterpriseLeadWorkspace {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }

    const reconciledSources = this.reconcileNormalizedKnowledgeSources(
      workspace,
      normalizeEnterpriseLeadExtractionSources(sources),
    );
    const normalizedSources = options.transformReconciledSources
      ? normalizeEnterpriseLeadExtractionSources(
          options.transformReconciledSources(reconciledSources),
        )
      : reconciledSources;
    return this.writeWorkspaceSources(workspace.id, normalizedSources);
  }

  upsertWorkspaceSourceById(
    workspaceId: string,
    source: EnterpriseLeadExtractionSource,
  ): EnterpriseLeadWorkspace {
    const transaction = this.db.transaction(() => {
      const workspace = this.getWorkspace(workspaceId);
      if (!workspace) {
        throw new Error('Enterprise lead workspace not found');
      }
      const normalizedSource = normalizeEnterpriseLeadExtractionSources([source])[0];
      const sourceId = normalizedSource?.id?.trim();
      if (!normalizedSource || !sourceId) {
        throw new Error('Enterprise lead workspace source id is required');
      }
      const sourceIndex = workspace.extractionSources.findIndex(item => item.id === sourceId);
      const sources = [...workspace.extractionSources];
      if (sourceIndex >= 0) {
        sources[sourceIndex] = normalizedSource;
      } else {
        sources.push(normalizedSource);
      }
      return this.writeWorkspaceSources(workspaceId, sources);
    });
    return transaction();
  }

  removeWorkspaceSourceById(workspaceId: string, sourceId: string): boolean {
    const transaction = this.db.transaction(() => {
      const workspace = this.getWorkspace(workspaceId);
      if (!workspace) {
        throw new Error('Enterprise lead workspace not found');
      }
      const normalizedSourceId = sourceId.trim();
      if (!normalizedSourceId) {
        throw new Error('Enterprise lead workspace source id is required');
      }
      const sources = workspace.extractionSources.filter(item => item.id !== normalizedSourceId);
      if (sources.length === workspace.extractionSources.length) {
        return false;
      }
      this.writeWorkspaceSources(workspaceId, sources);
      return true;
    });
    return transaction();
  }

  private reconcileNormalizedKnowledgeSources(
    workspace: EnterpriseLeadWorkspace,
    incomingSources: EnterpriseLeadExtractionSource[],
  ): EnterpriseLeadExtractionSource[] {
    const normalizedTableExists = this.db
      .prepare(
        `
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = 'knowledge_documents'
        LIMIT 1
      `,
      )
      .get();
    if (!normalizedTableExists) {
      return incomingSources;
    }

    const documentRows = this.db
      .prepare(
        `
        SELECT id, legacy_source_id, deleted_at
        FROM knowledge_documents
        WHERE workspace_id = ?
      `,
      )
      .all(workspace.id) as Array<{
      id: string;
      legacy_source_id: string | null;
      deleted_at: string | null;
    }>;
    const activeSourceIds = new Set<string>();
    const deletedSourceIds = new Set<string>();
    for (const row of documentRows) {
      const sourceId =
        row.legacy_source_id?.trim() ||
        `${KNOWLEDGE_DOCUMENT_LEGACY_SOURCE_PREFIX}${row.id}`;
      (row.deleted_at ? deletedSourceIds : activeSourceIds).add(sourceId);
    }

    const authoritativeSources = new Map<string, EnterpriseLeadExtractionSource>();
    for (const source of workspace.extractionSources) {
      const sourceId = source.id?.trim();
      if (sourceId && activeSourceIds.has(sourceId)) {
        authoritativeSources.set(sourceId, source);
      }
    }

    const retainedSourceIds = new Set<string>();
    const reconciledSources: EnterpriseLeadExtractionSource[] = [];
    for (const [sourceIndex, source] of incomingSources.entries()) {
      const sourceId =
        source.id?.trim() || buildLegacyKnowledgeSourceId(workspace.id, source, sourceIndex);
      if (sourceId && deletedSourceIds.has(sourceId)) {
        continue;
      }
      if (sourceId && activeSourceIds.has(sourceId)) {
        retainedSourceIds.add(sourceId);
        reconciledSources.push(authoritativeSources.get(sourceId) ?? { ...source, id: sourceId });
        continue;
      }
      reconciledSources.push(source);
    }
    for (const [sourceId, source] of authoritativeSources) {
      if (!retainedSourceIds.has(sourceId)) {
        reconciledSources.push(source);
      }
    }
    return reconciledSources;
  }

  private writeWorkspaceSources(
    workspaceId: string,
    sources: EnterpriseLeadExtractionSource[],
  ): EnterpriseLeadWorkspace {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE enterprise_lead_workspaces
        SET extraction_sources = ?, updated_at = ?
        WHERE id = ?
      `,
      )
      .run(JSON.stringify(sources), now, workspaceId);

    const updated = this.getWorkspace(workspaceId);
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
            nodeId: null,
            dependsOnTaskIds: [],
            executionMode: null,
          }));
    const taskRecords = taskInputs.map(task => ({ id: randomUUID(), task }));
    const taskIdByNode = new Map<string, string>();
    taskRecords.forEach(({ id, task }) => {
      if (task.nodeId) taskIdByNode.set(task.nodeId, id);
    });
    const currentTaskRole = taskInputs[0]?.role;
    const now = new Date().toISOString();
    const run: EnterpriseLeadRun = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      userGoal: input.userGoal,
      status: EnterpriseLeadRunStatus.Running,
      workflowVersion: cleanNullableText(input.workflowVersion) ?? undefined,
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
          workflow_version,
          workflow_start_options,
          created_at,
          updated_at,
          completed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        run.id,
        run.workspaceId,
        run.userGoal,
        run.status,
        run.currentRole,
        run.controllerSummary,
        run.archiveStatus,
        run.workflowVersion ?? null,
        null,
        run.createdAt,
        run.updatedAt,
        run.completedAt,
      );

      const insertTask = this.db.prepare(`
        INSERT INTO enterprise_lead_agent_tasks (
          id,
          run_id,
          role,
          node_id,
          depends_on_task_ids,
          attempt,
          execution_mode,
          workspace_agent_id,
          agent_snapshot,
          artifact_refs,
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const inputPayload = {
        workspaceId: workspace.id,
        workspaceProfile: workspace.profile,
        userGoal: input.userGoal,
      };
      taskRecords.forEach(({ id, task }, index) => {
        insertTask.run(
          id,
          run.id,
          task.role,
          task.nodeId,
          JSON.stringify(task.dependsOnTaskIds.map(taskId => taskIdByNode.get(taskId) ?? taskId)),
          null,
          task.executionMode,
          task.workspaceAgentId,
          task.agentSnapshot ? JSON.stringify(task.agentSnapshot) : null,
          JSON.stringify([]),
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

  initializeWorkflowRun(
    runId: string,
    tasks: CreateEnterpriseLeadTaskInput[],
    options: WorkflowStartOptions,
  ): void {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error('Enterprise lead run not found');
    }
    if (this.listTasks(runId).length > 0) {
      return;
    }
    const workspace = this.getWorkspace(run.workspaceId);
    if (!workspace) {
      throw new Error('Enterprise lead workspace not found');
    }
    const normalizedTasks = tasks.map(normalizeCreateTaskInput);
    const taskRecords = normalizedTasks.map(task => ({ id: randomUUID(), task }));
    const taskIdByNode = new Map<string, string>();
    taskRecords.forEach(({ id, task }) => {
      if (task.nodeId) taskIdByNode.set(task.nodeId, id);
    });
    const now = new Date().toISOString();
    const insert = this.db.prepare(`
      INSERT INTO enterprise_lead_agent_tasks (
        id, run_id, role, node_id, depends_on_task_ids, attempt, execution_mode,
        workspace_agent_id, agent_snapshot, artifact_refs, sequence, status,
        input_payload, output_payload, summary, missing_info, todos, risks,
        handoff_context, error, stale, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const initialize = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE enterprise_lead_runs
        SET workflow_start_options = ?, updated_at = ?
        WHERE id = ?
      `).run(JSON.stringify(options), now, runId);
      taskRecords.forEach(({ id, task }, index) => {
        insert.run(
          id,
          runId,
          task.role,
          task.nodeId,
          JSON.stringify(task.dependsOnTaskIds.map(taskId => taskIdByNode.get(taskId) ?? taskId)),
          null,
          task.executionMode,
          task.workspaceAgentId,
          task.agentSnapshot ? JSON.stringify(task.agentSnapshot) : null,
          JSON.stringify([]),
          index,
          EnterpriseLeadTaskStatus.Waiting,
          JSON.stringify({ workspaceId: workspace.id, workspaceProfile: workspace.profile, userGoal: run.userGoal }),
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
    });
    initialize();
  }

  getWorkflowStartOptions(runId: string): WorkflowStartOptions {
    const row = this.db.prepare(`
      SELECT workflow_start_options as workflowStartOptions
      FROM enterprise_lead_runs WHERE id = ? LIMIT 1
    `).get(runId) as { workflowStartOptions: string | null } | undefined;
    if (!row) {
      throw new Error('Enterprise lead run not found');
    }
    return normalizeWorkflowStartOptions(
      row.workflowStartOptions ? parseJsonValue(row.workflowStartOptions, {}) : {},
    );
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
        workflow_version as workflowVersion,
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
        workflow_version as workflowVersion,
        created_at as createdAt,
        updated_at as updatedAt,
        completed_at as completedAt
      FROM enterprise_lead_runs
      WHERE workspace_id = ?
      ORDER BY created_at DESC, rowid DESC
    `).all(workspaceId) as EnterpriseLeadRunRow[];

    return rows.map(mapRunRow);
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
        node_id as nodeId,
        depends_on_task_ids as dependsOnTaskIds,
        attempt,
        execution_mode as executionMode,
        workspace_agent_id as workspaceAgentId,
        agent_snapshot as agentSnapshot,
        artifact_refs as artifactRefs,
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
        node_id as nodeId,
        depends_on_task_ids as dependsOnTaskIds,
        attempt,
        execution_mode as executionMode,
        workspace_agent_id as workspaceAgentId,
        agent_snapshot as agentSnapshot,
        artifact_refs as artifactRefs,
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
    const artifactRefs = result.artifactRefs ?? task.artifactRefs ?? [];
    const updateTransaction = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE enterprise_lead_agent_tasks
        SET
          status = ?,
          output_payload = ?,
          artifact_refs = ?,
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
        JSON.stringify(artifactRefs),
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

  updateWorkflowTaskResult(
    taskId: string,
    result: EnterpriseLeadAgentTaskResult,
    attempt: number,
  ): void {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error('Enterprise lead task not found');
    }
    this.assertRunMutable(task.runId);
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE enterprise_lead_agent_tasks
      SET
        status = ?, output_payload = ?, artifact_refs = ?, summary = ?,
        missing_info = ?, todos = ?, risks = ?, handoff_context = ?, error = '',
        stale = 0, attempt = ?, updated_at = ?
      WHERE id = ?
    `).run(
      result.status,
      JSON.stringify(result.outputs),
      JSON.stringify(result.artifactRefs ?? task.artifactRefs ?? []),
      result.summary,
      JSON.stringify(result.missingInfo),
      JSON.stringify(result.todos),
      JSON.stringify(result.risks),
      JSON.stringify(result.handoffContext),
      attempt,
      now,
      taskId,
    );
  }

  updateWorkflowTaskStatus(
    taskId: string,
    status: EnterpriseLeadTaskStatus,
    options: { summary?: string; error?: string; attempt?: number } = {},
  ): void {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error('Enterprise lead task not found');
    }
    this.assertRunMutable(task.runId);
    this.db.prepare(`
      UPDATE enterprise_lead_agent_tasks
      SET status = ?, summary = ?, error = ?, stale = ?, attempt = COALESCE(?, attempt), updated_at = ?
      WHERE id = ?
    `).run(
      status,
      options.summary ?? task.summary,
      options.error ?? '',
      status === EnterpriseLeadTaskStatus.Stale ? 1 : 0,
      options.attempt ?? null,
      new Date().toISOString(),
      taskId,
    );
  }

  markWorkflowDownstreamTasksStale(taskId: string): void {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error('Enterprise lead task not found');
    }
    this.assertRunMutable(task.runId);

    const tasks = this.listTasks(task.runId);
    const staleTaskIds = new Set<string>();
    const pendingTaskIds = [task.id];
    while (pendingTaskIds.length > 0) {
      const upstreamTaskId = pendingTaskIds.shift();
      tasks
        .filter(candidate => (candidate.dependsOnTaskIds ?? []).includes(upstreamTaskId ?? ''))
        .forEach(candidate => {
          if (staleTaskIds.has(candidate.id)) return;
          staleTaskIds.add(candidate.id);
          pendingTaskIds.push(candidate.id);
        });
    }
    if (staleTaskIds.size === 0) return;

    const now = new Date().toISOString();
    const markStale = this.db.transaction(() => {
      staleTaskIds.forEach(downstreamTaskId => {
        this.db.prepare(`
          UPDATE enterprise_lead_agent_tasks
          SET status = ?, stale = 1, updated_at = ?
          WHERE id = ?
        `).run(EnterpriseLeadTaskStatus.Stale, now, downstreamTaskId);
      });
    });
    markStale();
  }

  cancelWorkflowRun(runId: string): void {
    this.assertRunMutable(runId);
    const now = new Date().toISOString();
    const cancel = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE enterprise_lead_agent_tasks
        SET status = ?, updated_at = ?
        WHERE run_id = ? AND status <> ?
      `).run(EnterpriseLeadTaskStatus.Cancelled, now, runId, EnterpriseLeadTaskStatus.Completed);
      this.db.prepare(`
        UPDATE enterprise_lead_runs
        SET status = ?, current_role = NULL, controller_summary = ?, updated_at = ?
        WHERE id = ?
      `).run(EnterpriseLeadRunStatus.Cancelled, 'Workflow cancelled.', now, runId);
    });
    cancel();
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
      taskStatus: input.taskStatus ?? EnterpriseLeadTaskStatus.Completed,
      outputPayload: input.outputPayload,
      artifactRefs: input.artifactRefs ?? task.artifactRefs ?? [],
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
        task_status,
        output_payload,
        artifact_refs,
        missing_info,
        todos,
        risks,
        handoff_context,
        status,
        created_at,
        applied_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pendingVersion.id,
      pendingVersion.taskId,
      pendingVersion.runId,
      pendingVersion.workspaceId,
      pendingVersion.role,
      pendingVersion.userMessage,
      pendingVersion.summary,
      pendingVersion.taskStatus,
      JSON.stringify(pendingVersion.outputPayload),
      JSON.stringify(pendingVersion.artifactRefs),
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
        task_status as taskStatus,
        output_payload as outputPayload,
        artifact_refs as artifactRefs,
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

  applyPendingVersion(
    pendingVersionId: string,
    taskResult?: EnterpriseLeadAgentTaskResult,
  ): EnterpriseLeadPendingVersion {
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
    const result = taskResult ?? {
      role: pendingVersion.role,
      status: pendingVersion.taskStatus ?? EnterpriseLeadTaskStatus.Completed,
      summary: pendingVersion.summary,
      outputs: pendingVersion.outputPayload,
      artifactRefs: pendingVersion.artifactRefs ?? [],
      missingInfo: pendingVersion.missingInfo,
      todos: pendingVersion.todos,
      risks: pendingVersion.risks,
      handoffContext: pendingVersion.handoffContext,
    };
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
          artifact_refs = ?,
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
        JSON.stringify(result.artifactRefs ?? []),
        result.summary,
        JSON.stringify(result.missingInfo),
        JSON.stringify(result.todos),
        JSON.stringify(result.risks),
        JSON.stringify(result.handoffContext),
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

  getPendingVersion(pendingVersionId: string): EnterpriseLeadPendingVersion | null {
    const row = this.db.prepare(`
      SELECT
        id,
        task_id as taskId,
        run_id as runId,
        workspace_id as workspaceId,
        role,
        user_message as userMessage,
        summary,
        task_status as taskStatus,
        output_payload as outputPayload,
        artifact_refs as artifactRefs,
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
          OR artifact_refs <> '[]'
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
