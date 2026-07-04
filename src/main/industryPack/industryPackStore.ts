import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';

import { GeneratedAssetStatus } from '../../shared/industryPack/constants';
import type {
  PositioningReport,
  PositioningReportInput,
} from '../../shared/industryPack/positioning';
import { normalizePositioningReportInput } from '../../shared/industryPack/positioning';
import type { GeneratedAsset } from '../../shared/industryPack/types';

interface WorkspaceInput {
  packId: string;
  name: string;
}

interface IndustryWorkspace {
  id: string;
  packId: string;
  name: string;
}

interface GeneratedAssetInput {
  workspaceId: string;
  taskId: string;
  packId: string;
  channel: string;
  theme: string;
  tone: string;
  title: string;
  body: string;
  keywords: string[];
  cta: string;
  status?: GeneratedAssetStatus;
}

type GeneratedAssetRow = Omit<GeneratedAsset, 'keywords'> & {
  keywords: string;
};

type PositioningReportRow = Omit<
  PositioningReport,
  'sourceSummary' | 'candidates' | 'backupDirectionIds' | 'nextActions' | 'providerAvailability' | 'sourceCounts'
> & {
  sourceSummary: string;
  candidates: string;
  backupDirectionIds: string;
  nextActions: string;
  providerAvailability: string;
  sourceCounts: string;
};

const parseKeywords = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
      return parsed;
    }
  } catch {
    return [];
  }

  return [];
};

const parseJsonValue = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const mapGeneratedAssetRow = (row: GeneratedAssetRow): GeneratedAsset => ({
  ...row,
  keywords: parseKeywords(row.keywords),
});

const mapPositioningReportRow = (row: PositioningReportRow): PositioningReport => ({
  ...row,
  sourceSummary: parseJsonValue(row.sourceSummary, { lanes: [] }),
  candidates: parseJsonValue(row.candidates, []),
  backupDirectionIds: parseJsonValue(row.backupDirectionIds, []),
  nextActions: parseJsonValue(row.nextActions, []),
  providerAvailability: parseJsonValue(row.providerAvailability, { tavily: false, firecrawl: false }),
  sourceCounts: parseJsonValue(row.sourceCounts, { searchResults: 0, extractedPages: 0 }),
});

export class IndustryPackStore {
  constructor(private readonly db: Database.Database) {
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS industry_workspaces (
        id TEXT PRIMARY KEY,
        pack_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS industry_generated_assets (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        pack_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        theme TEXT NOT NULL,
        tone TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        keywords TEXT NOT NULL,
        cta TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS industry_positioning_reports (
        id TEXT PRIMARY KEY,
        pack_id TEXT NOT NULL,
        agent_id TEXT NOT NULL DEFAULT 'main',
        requested_by TEXT NOT NULL,
        recommended_direction_id TEXT NOT NULL,
        provider_availability TEXT NOT NULL DEFAULT '{}',
        source_counts TEXT NOT NULL DEFAULT '{}',
        source_summary TEXT NOT NULL,
        candidates TEXT NOT NULL,
        backup_direction_ids TEXT NOT NULL,
        next_actions TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.ensurePositioningReportColumns();
  }

  private ensurePositioningReportColumns(): void {
    const columns = this.db.pragma('table_info(industry_positioning_reports)') as Array<{ name: string }>;
    const columnNames = new Set(columns.map(column => column.name));
    if (!columnNames.has('agent_id')) {
      this.db.exec("ALTER TABLE industry_positioning_reports ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'main';");
    }
    if (!columnNames.has('provider_availability')) {
      this.db.exec("ALTER TABLE industry_positioning_reports ADD COLUMN provider_availability TEXT NOT NULL DEFAULT '{}';");
    }
    if (!columnNames.has('source_counts')) {
      this.db.exec("ALTER TABLE industry_positioning_reports ADD COLUMN source_counts TEXT NOT NULL DEFAULT '{}';");
    }
  }

  ensureWorkspace(input: WorkspaceInput): IndustryWorkspace {
    const existing = this.findWorkspaceByPackId(input.packId);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const workspace: IndustryWorkspace = {
      id: randomUUID(),
      packId: input.packId,
      name: input.name,
    };
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO industry_workspaces (id, pack_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(workspace.id, workspace.packId, workspace.name, now, now);

    if (result.changes > 0) {
      return workspace;
    }

    const conflictWorkspace = this.findWorkspaceByPackId(input.packId);
    if (!conflictWorkspace) {
      throw new Error('Failed to create industry workspace');
    }

    return conflictWorkspace;
  }

  private findWorkspaceByPackId(packId: string): IndustryWorkspace | undefined {
    return this.db.prepare(`
      SELECT id, pack_id as packId, name
      FROM industry_workspaces
      WHERE pack_id = ?
      LIMIT 1
    `).get(packId) as IndustryWorkspace | undefined;
  }

  private findWorkspaceById(workspaceId: string): IndustryWorkspace | undefined {
    return this.db.prepare(`
      SELECT id, pack_id as packId, name
      FROM industry_workspaces
      WHERE id = ?
      LIMIT 1
    `).get(workspaceId) as IndustryWorkspace | undefined;
  }

  createGeneratedAsset(input: GeneratedAssetInput): GeneratedAsset {
    const workspace = this.findWorkspaceById(input.workspaceId);
    if (!workspace) {
      throw new Error('Generated asset workspace does not exist');
    }
    if (workspace.packId !== input.packId) {
      throw new Error('Generated asset packId does not match workspace packId');
    }

    const now = new Date().toISOString();
    const asset: GeneratedAsset = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      packId: input.packId,
      channel: input.channel,
      theme: input.theme,
      tone: input.tone,
      title: input.title,
      body: input.body,
      keywords: input.keywords,
      cta: input.cta,
      status: input.status || GeneratedAssetStatus.Draft,
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO industry_generated_assets (
        id,
        workspace_id,
        task_id,
        pack_id,
        channel,
        theme,
        tone,
        title,
        body,
        keywords,
        cta,
        status,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      asset.id,
      asset.workspaceId,
      asset.taskId,
      asset.packId,
      asset.channel,
      asset.theme,
      asset.tone,
      asset.title,
      asset.body,
      JSON.stringify(asset.keywords),
      asset.cta,
      asset.status,
      asset.createdAt,
      asset.updatedAt,
    );

    return asset;
  }

  listGeneratedAssets(workspaceId: string): GeneratedAsset[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        workspace_id as workspaceId,
        task_id as taskId,
        pack_id as packId,
        channel,
        theme,
        tone,
        title,
        body,
        keywords,
        cta,
        status,
        created_at as createdAt,
        updated_at as updatedAt
      FROM industry_generated_assets
      WHERE workspace_id = ?
      ORDER BY created_at DESC, rowid DESC
    `).all(workspaceId) as GeneratedAssetRow[];

    return rows.map(mapGeneratedAssetRow);
  }

  getGeneratedAsset(assetId: string): GeneratedAsset | null {
    const row = this.db.prepare(`
      SELECT
        id,
        workspace_id as workspaceId,
        task_id as taskId,
        pack_id as packId,
        channel,
        theme,
        tone,
        title,
        body,
        keywords,
        cta,
        status,
        created_at as createdAt,
        updated_at as updatedAt
      FROM industry_generated_assets
      WHERE id = ?
      LIMIT 1
    `).get(assetId) as GeneratedAssetRow | undefined;

    return row ? mapGeneratedAssetRow(row) : null;
  }

  createPositioningReport(input: PositioningReportInput): PositioningReport {
    const normalized = normalizePositioningReportInput(input);
    const now = new Date().toISOString();
    const report: PositioningReport = {
      id: randomUUID(),
      ...normalized,
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO industry_positioning_reports (
        id,
        pack_id,
        agent_id,
        requested_by,
        recommended_direction_id,
        provider_availability,
        source_counts,
        source_summary,
        candidates,
        backup_direction_ids,
        next_actions,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      report.id,
      report.packId,
      report.agentId,
      report.requestedBy,
      report.recommendedDirectionId,
      JSON.stringify(report.providerAvailability),
      JSON.stringify(report.sourceCounts),
      JSON.stringify(report.sourceSummary),
      JSON.stringify(report.candidates),
      JSON.stringify(report.backupDirectionIds),
      JSON.stringify(report.nextActions),
      report.createdAt,
      report.updatedAt,
    );

    return report;
  }

  getPositioningReport(reportId: string): PositioningReport | null {
    const row = this.db.prepare(`
      SELECT
        id,
        pack_id as packId,
        agent_id as agentId,
        requested_by as requestedBy,
        recommended_direction_id as recommendedDirectionId,
        provider_availability as providerAvailability,
        source_counts as sourceCounts,
        source_summary as sourceSummary,
        candidates,
        backup_direction_ids as backupDirectionIds,
        next_actions as nextActions,
        created_at as createdAt,
        updated_at as updatedAt
      FROM industry_positioning_reports
      WHERE id = ?
      LIMIT 1
    `).get(reportId) as PositioningReportRow | undefined;

    return row ? mapPositioningReportRow(row) : null;
  }

  getLatestPositioningReport(packId: string, agentId?: string): PositioningReport | null {
    const normalizedAgentId = agentId?.trim();
    const params = normalizedAgentId ? [packId, normalizedAgentId] : [packId];
    const row = this.db.prepare(`
      SELECT
        id,
        pack_id as packId,
        agent_id as agentId,
        requested_by as requestedBy,
        recommended_direction_id as recommendedDirectionId,
        provider_availability as providerAvailability,
        source_counts as sourceCounts,
        source_summary as sourceSummary,
        candidates,
        backup_direction_ids as backupDirectionIds,
        next_actions as nextActions,
        created_at as createdAt,
        updated_at as updatedAt
      FROM industry_positioning_reports
      WHERE pack_id = ?
      ${normalizedAgentId ? 'AND agent_id = ?' : ''}
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `).get(...params) as PositioningReportRow | undefined;

    return row ? mapPositioningReportRow(row) : null;
  }
}
