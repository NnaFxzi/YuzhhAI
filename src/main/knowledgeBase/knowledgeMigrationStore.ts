import Database from 'better-sqlite3';

import { KnowledgeMigrationStatus } from '../../shared/knowledgeBase/constants';
import type { KnowledgeMigrationState } from '../../shared/knowledgeBase/types';

type KnowledgeMigrationStateRow = {
  workspace_id: string;
  version: number;
  status: KnowledgeMigrationState['status'];
  source_count: number;
  migrated_count: number;
  last_source_id: string | null;
  diagnostics_json: string;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
};

const parseDiagnostics = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
};

const mapStateRow = (row: KnowledgeMigrationStateRow): KnowledgeMigrationState => ({
  workspaceId: row.workspace_id,
  version: row.version,
  status: row.status,
  sourceCount: row.source_count,
  migratedCount: row.migrated_count,
  lastSourceId: row.last_source_id,
  diagnostics: parseDiagnostics(row.diagnostics_json),
  startedAt: row.started_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at,
});

const normalizeDiagnostics = (diagnostics: string[]): string[] =>
  diagnostics
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map(item => item.slice(0, 500));

export class KnowledgeMigrationStore {
  constructor(private readonly db: Database.Database) {
    this.initialize();
  }

  getState(workspaceId: string): KnowledgeMigrationState | null {
    const row = this.db
      .prepare(
        `
        SELECT
          workspace_id,
          version,
          status,
          source_count,
          migrated_count,
          last_source_id,
          diagnostics_json,
          started_at,
          updated_at,
          completed_at
        FROM knowledge_migration_state
        WHERE workspace_id = ?
        LIMIT 1
      `,
      )
      .get(workspaceId.trim()) as KnowledgeMigrationStateRow | undefined;
    return row ? mapStateRow(row) : null;
  }

  begin(
    workspaceId: string,
    version: number,
    sourceCount: number,
    now = new Date().toISOString(),
  ): KnowledgeMigrationState {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId) {
      throw new Error('Workspace id is required');
    }
    const current = this.getState(normalizedWorkspaceId);
    if (
      current?.version === version &&
      current.status === KnowledgeMigrationStatus.Completed
    ) {
      return current;
    }

    if (current?.version === version) {
      this.db
        .prepare(
          `
          UPDATE knowledge_migration_state
          SET status = ?, source_count = ?, updated_at = ?, completed_at = NULL
          WHERE workspace_id = ?
        `,
        )
        .run(
          KnowledgeMigrationStatus.Running,
          Math.max(0, Math.floor(sourceCount)),
          now,
          normalizedWorkspaceId,
        );
      return this.requireState(normalizedWorkspaceId);
    }

    this.db
      .prepare(
        `
        INSERT INTO knowledge_migration_state (
          workspace_id,
          version,
          status,
          source_count,
          migrated_count,
          last_source_id,
          diagnostics_json,
          started_at,
          updated_at,
          completed_at
        )
        VALUES (?, ?, ?, ?, 0, NULL, '[]', ?, ?, NULL)
        ON CONFLICT(workspace_id) DO UPDATE SET
          version = excluded.version,
          status = excluded.status,
          source_count = excluded.source_count,
          migrated_count = 0,
          last_source_id = NULL,
          diagnostics_json = '[]',
          started_at = excluded.started_at,
          updated_at = excluded.updated_at,
          completed_at = NULL
      `,
      )
      .run(
        normalizedWorkspaceId,
        Math.max(1, Math.floor(version)),
        KnowledgeMigrationStatus.Running,
        Math.max(0, Math.floor(sourceCount)),
        now,
        now,
      );
    return this.requireState(normalizedWorkspaceId);
  }

  recordProgress(
    workspaceId: string,
    migratedCount: number,
    lastSourceId: string,
    now = new Date().toISOString(),
  ): KnowledgeMigrationState {
    this.requireState(workspaceId);
    this.db
      .prepare(
        `
        UPDATE knowledge_migration_state
        SET migrated_count = ?, last_source_id = ?, updated_at = ?
        WHERE workspace_id = ?
      `,
      )
      .run(
        Math.max(0, Math.floor(migratedCount)),
        lastSourceId.trim() || null,
        now,
        workspaceId.trim(),
      );
    return this.requireState(workspaceId);
  }

  complete(
    workspaceId: string,
    diagnostics: string[],
    now = new Date().toISOString(),
  ): KnowledgeMigrationState {
    return this.finish(
      workspaceId,
      KnowledgeMigrationStatus.Completed,
      diagnostics,
      now,
      now,
    );
  }

  fail(
    workspaceId: string,
    diagnostics: string[],
    now = new Date().toISOString(),
  ): KnowledgeMigrationState {
    return this.finish(workspaceId, KnowledgeMigrationStatus.Failed, diagnostics, now, null);
  }

  deleteState(workspaceId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM knowledge_migration_state WHERE workspace_id = ?')
      .run(workspaceId.trim());
    return result.changes > 0;
  }

  private finish(
    workspaceId: string,
    status: KnowledgeMigrationState['status'],
    diagnostics: string[],
    now: string,
    completedAt: string | null,
  ): KnowledgeMigrationState {
    this.requireState(workspaceId);
    this.db
      .prepare(
        `
        UPDATE knowledge_migration_state
        SET status = ?, diagnostics_json = ?, updated_at = ?, completed_at = ?
        WHERE workspace_id = ?
      `,
      )
      .run(
        status,
        JSON.stringify(normalizeDiagnostics(diagnostics)),
        now,
        completedAt,
        workspaceId.trim(),
      );
    return this.requireState(workspaceId);
  }

  private requireState(workspaceId: string): KnowledgeMigrationState {
    const state = this.getState(workspaceId);
    if (!state) {
      throw new Error('Knowledge migration state not found');
    }
    return state;
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_migration_state (
        workspace_id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        source_count INTEGER NOT NULL,
        migrated_count INTEGER NOT NULL,
        last_source_id TEXT,
        diagnostics_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
    `);
  }
}
