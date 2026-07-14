import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import { buildDefaultEnterpriseLeadWorkspaceSettings } from '../../shared/enterpriseLeadWorkspace/validation';
import { KnowledgeFactDomain, KnowledgeFactDomains } from '../../shared/knowledgeBase/constants';
import { KnowledgeTrustedProfileIndexStore } from '../knowledgeBase/knowledgeTrustedProfileIndexStore';
import { runTransientSqliteWriteTransaction } from '../libs/sqliteTransactionRetry';
import {
  EnterpriseLeadProfileInvalidRequestError,
  EnterpriseLeadProfileRevisionConflictError,
  type EnterpriseLeadWorkspaceProfilePersistenceFault,
  EnterpriseLeadWorkspaceProfilePersistenceStage,
  EnterpriseLeadWorkspaceProfileRevisionStore,
  validateEnterpriseLeadWorkspaceProfileRequest,
} from './profileRevisionStore';
import { EnterpriseLeadWorkspaceStore } from './store';

const openDatabases: Database.Database[] = [];
const temporaryDirectories: string[] = [];

const openDatabase = (databasePath = ':memory:'): Database.Database => {
  const db = new Database(databasePath);
  openDatabases.push(db);
  return db;
};

const createLegacyWorkspaceTable = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE enterprise_lead_workspaces (
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
  `);
};

const insertLegacyWorkspace = (
  db: Database.Database,
  workspaceId = 'workspace-legacy',
): void => {
  db.prepare(`
    INSERT INTO enterprise_lead_workspaces (
      id, name, type, profile, extraction_sources, risk_rules,
      enabled_agent_roles, settings, workspace_agents, recent_run_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workspaceId,
    'Legacy workspace',
    'enterprise_lead',
    JSON.stringify({
      companySummary: 'Legacy summary',
      productList: [],
      productCapabilities: [],
      targetCustomers: [],
      applicationScenarios: [],
      sellingPoints: [],
      channelPreferences: [],
      prohibitedClaims: [],
      contactRules: [],
      missingInfo: [],
    }),
    '[]',
    '[]',
    '[]',
    JSON.stringify(buildDefaultEnterpriseLeadWorkspaceSettings()),
    '[]',
    null,
    '2026-07-01T00:00:00.000Z',
    '2026-07-01T00:00:00.000Z',
  );
};

const initializeRevisionStores = (db: Database.Database) => {
  const trustedProfileIndexStore = new KnowledgeTrustedProfileIndexStore(db);
  const profileRevisionStore = new EnterpriseLeadWorkspaceProfileRevisionStore({
    db,
    trustedProfileIndexStore,
    loadWorkspace: () => null,
  });
  return { profileRevisionStore, trustedProfileIndexStore };
};

const profile = {
  companySummary: '工业包装供应商',
  productList: ['重型纸箱'],
  productCapabilities: ['抗压设计'],
  targetCustomers: ['机械设备厂'],
  applicationScenarios: ['出口运输'],
  sellingPoints: ['可替代木箱'],
  channelPreferences: ['微信'],
  prohibitedClaims: ['绝对防损'],
  contactRules: ['仅生成草稿'],
  missingInfo: ['案例图片'],
};

const defineChangingAccessor = (
  target: object,
  key: PropertyKey,
  firstValue: unknown,
  laterValue: unknown,
): (() => number) => {
  let reads = 0;
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get: () => {
      reads += 1;
      return reads === 1 ? firstValue : laterValue;
    },
  });
  return () => reads;
};

const createWorkspaceStore = (
  db: Database.Database,
  faultInjector?: EnterpriseLeadWorkspaceProfilePersistenceFault,
): EnterpriseLeadWorkspaceStore => new EnterpriseLeadWorkspaceStore(db, { faultInjector });

afterEach(() => {
  while (openDatabases.length > 0) {
    const db = openDatabases.pop();
    if (db?.open) {
      db.close();
    }
  }
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) {
      fs.rmSync(directory, { force: true, recursive: true });
    }
  }
});

describe('EnterpriseLeadWorkspaceProfileRevisionStore migration', () => {
  test('adds a safe global revision and backfills exactly ten field revisions at one', () => {
    const db = openDatabase();
    createLegacyWorkspaceTable(db);
    insertLegacyWorkspace(db);

    const { profileRevisionStore, trustedProfileIndexStore } = initializeRevisionStores(db);

    const columns = db.pragma('table_info(enterprise_lead_workspaces)') as Array<{
      dflt_value: string | null;
      name: string;
      notnull: number;
      type: string;
    }>;
    expect(columns.find(column => column.name === 'profile_revision')).toMatchObject({
      dflt_value: '1',
      notnull: 1,
      type: 'INTEGER',
    });
    expect(
      db.prepare(`
        SELECT profile_revision AS profileRevision
        FROM enterprise_lead_workspaces
        WHERE id = ?
      `).get('workspace-legacy'),
    ).toEqual({ profileRevision: 1 });

    const fieldRows = db.prepare(`
      SELECT field, revision
      FROM enterprise_lead_workspace_profile_field_revisions
      WHERE workspace_id = ?
      ORDER BY field
    `).all('workspace-legacy') as Array<{ field: string; revision: number }>;
    expect(fieldRows).toHaveLength(KnowledgeFactDomains.length);
    expect(fieldRows.map(row => row.field).sort()).toEqual([...KnowledgeFactDomains].sort());
    expect(new Set(fieldRows.map(row => row.revision))).toEqual(new Set([1]));
    for (const field of KnowledgeFactDomains) {
      expect(profileRevisionStore.getFieldRevision('workspace-legacy', field)).toBe(1);
    }
    expect(trustedProfileIndexStore.getState('workspace-legacy')).toBeNull();
  });

  test('repairs missing field rows without resetting existing revisions', () => {
    const db = openDatabase();
    createLegacyWorkspaceTable(db);
    insertLegacyWorkspace(db);
    initializeRevisionStores(db);

    db.prepare(`
      UPDATE enterprise_lead_workspace_profile_field_revisions
      SET revision = 7
      WHERE workspace_id = ? AND field = ?
    `).run('workspace-legacy', KnowledgeFactDomain.ProductList);
    db.prepare(`
      DELETE FROM enterprise_lead_workspace_profile_field_revisions
      WHERE workspace_id = ? AND field = ?
    `).run('workspace-legacy', KnowledgeFactDomain.ContactRules);

    const { profileRevisionStore } = initializeRevisionStores(db);

    expect(profileRevisionStore.getFieldRevision(
      'workspace-legacy',
      KnowledgeFactDomain.ProductList,
    )).toBe(7);
    expect(profileRevisionStore.getFieldRevision(
      'workspace-legacy',
      KnowledgeFactDomain.ContactRules,
    )).toBe(1);
    const count = db.prepare(`
      SELECT COUNT(*) AS count
      FROM enterprise_lead_workspace_profile_field_revisions
      WHERE workspace_id = ?
    `).get('workspace-legacy') as { count: number };
    expect(count.count).toBe(KnowledgeFactDomains.length);
  });

  test('persists the migration and repaired revisions across a file-backed reopen', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-revision-migration-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'legacy.sqlite');
    const firstDb = openDatabase(databasePath);
    createLegacyWorkspaceTable(firstDb);
    insertLegacyWorkspace(firstDb);
    initializeRevisionStores(firstDb);
    firstDb.prepare(`
      UPDATE enterprise_lead_workspace_profile_field_revisions
      SET revision = 9
      WHERE workspace_id = ? AND field = ?
    `).run('workspace-legacy', KnowledgeFactDomain.SellingPoints);
    firstDb.close();

    const secondDb = openDatabase(databasePath);
    const { profileRevisionStore, trustedProfileIndexStore } = initializeRevisionStores(secondDb);

    expect(profileRevisionStore.getFieldRevision(
      'workspace-legacy',
      KnowledgeFactDomain.SellingPoints,
    )).toBe(9);
    expect(trustedProfileIndexStore.getJob('workspace-legacy', 1)).toBeNull();
    expect(trustedProfileIndexStore.getState('workspace-legacy')).toBeNull();
  });

  test('rejects invalid domains and every non-safe revision at the DDL boundary', () => {
    const db = openDatabase();
    createLegacyWorkspaceTable(db);
    insertLegacyWorkspace(db);
    initializeRevisionStores(db);

    expect(() => db.prepare(`
      INSERT INTO enterprise_lead_workspace_profile_field_revisions (
        workspace_id, field, revision
      ) VALUES (?, ?, ?)
    `).run('workspace-legacy', 'unknownField', 1)).toThrow();
    for (const invalidRevision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => db.prepare(`
        UPDATE enterprise_lead_workspace_profile_field_revisions
        SET revision = ?
        WHERE workspace_id = ? AND field = ?
      `).run(
        invalidRevision,
        'workspace-legacy',
        KnowledgeFactDomain.CompanySummary,
      )).toThrow();
      expect(() => db.prepare(`
        UPDATE enterprise_lead_workspaces
        SET profile_revision = ?
        WHERE id = ?
      `).run(invalidRevision, 'workspace-legacy')).toThrow();
    }
  });
});

describe('EnterpriseLeadWorkspaceProfileRevisionStore CAS', () => {
  test('regular validation single-reads accessors and returns an independent exact-key Profile', () => {
    const productItems = new Array<string>(1);
    const trustItems = new Array<string>(1);
    const productItemReads = defineChangingAccessor(
      productItems,
      0,
      'Original product',
      'secret-product-item',
    );
    const trustItemReads = defineChangingAccessor(
      trustItems,
      0,
      'productList:original product',
      'secret-trust-item',
    );
    const sourceProfile: Record<string, unknown> = {
      ...profile,
      productCapabilities: [...profile.productCapabilities],
      targetCustomers: [...profile.targetCustomers],
      applicationScenarios: [...profile.applicationScenarios],
      sellingPoints: [...profile.sellingPoints],
      channelPreferences: [...profile.channelPreferences],
      prohibitedClaims: [...profile.prohibitedClaims],
      contactRules: [...profile.contactRules],
      missingInfo: [...profile.missingInfo],
    };
    const companyReads = defineChangingAccessor(
      sourceProfile,
      KnowledgeFactDomain.CompanySummary,
      'Original summary',
      'secret-company',
    );
    const domainReads = defineChangingAccessor(
      sourceProfile,
      KnowledgeFactDomain.ProductList,
      productItems,
      ['secret-domain-array'],
    );
    const trustReads = defineChangingAccessor(
      sourceProfile,
      'confirmedKnowledgeKeys',
      trustItems,
      ['secret-trust-array'],
    );

    const validated = validateEnterpriseLeadWorkspaceProfileRequest(sourceProfile);
    Object.defineProperty(productItems, 0, {
      configurable: true,
      enumerable: true,
      value: 'mutated original product',
      writable: true,
    });
    Object.defineProperty(trustItems, 0, {
      configurable: true,
      enumerable: true,
      value: 'mutated original trust',
      writable: true,
    });

    expect(validated).toEqual({
      ...profile,
      companySummary: 'Original summary',
      productList: ['Original product'],
      confirmedKnowledgeKeys: ['productList:original product'],
    });
    expect(Object.keys(validated).sort()).toEqual([
      ...KnowledgeFactDomains,
      'confirmedKnowledgeKeys',
    ].sort());
    for (const readCount of [
      companyReads,
      domainReads,
      trustReads,
      productItemReads,
      trustItemReads,
    ]) {
      expect(readCount()).toBe(1);
    }
    expect(JSON.stringify(validated)).not.toContain('secret-');

    const throwingProfile = { ...profile };
    Object.defineProperty(throwingProfile, KnowledgeFactDomain.ProductList, {
      enumerable: true,
      get: () => {
        throw new TypeError('secret raw accessor failure');
      },
    });
    expect(() => validateEnterpriseLeadWorkspaceProfileRequest(throwingProfile)).toThrow(
      EnterpriseLeadProfileInvalidRequestError,
    );
  });

  test('increments global and explicit field revisions and atomically enqueues the same revision', () => {
    const db = openDatabase();
    const store = createWorkspaceStore(db);
    const workspace = store.createWorkspace({
      name: 'CAS workspace',
      type: 'enterprise_lead',
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const now = '2026-07-12T02:00:00.000Z';

    const result = store.getProfileRevisionStore().compareAndSwapProfile({
      workspaceId: workspace.id,
      expectedProfileRevision: 1,
      nextProfile: {
        ...workspace.profile,
        companySummary: '更新后的企业画像',
      },
      touchedFields: [
        KnowledgeFactDomain.CompanySummary,
        KnowledgeFactDomain.ContactRules,
      ],
      now,
    });

    expect(result.previousProfileRevision).toBe(1);
    expect(result.profileRevision).toBe(2);
    expect(result.workspace.profileRevision).toBe(2);
    expect(result.workspace.profile.companySummary).toBe('更新后的企业画像');
    expect(result.touchedFieldRevisions).toEqual({
      [KnowledgeFactDomain.CompanySummary]: 2,
      [KnowledgeFactDomain.ContactRules]: 2,
    });
    expect(store.getProfileRevisionStore().getFieldRevision(
      workspace.id,
      KnowledgeFactDomain.ProductList,
    )).toBe(1);
    expect(store.getTrustedProfileIndexStore().getJob(workspace.id, 2)).toMatchObject({
      profileRevision: 2,
      requestedAt: now,
      updatedAt: now,
    });
    expect(store.getTrustedProfileIndexStore().getState(workspace.id)).toBeNull();
  });

  test('increments explicitly touched fields for a normalized same-value save', () => {
    const db = openDatabase();
    const store = createWorkspaceStore(db);
    const workspace = store.createWorkspace({
      name: 'Same value workspace',
      type: 'enterprise_lead',
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });

    const result = store.getProfileRevisionStore().compareAndSwapProfile({
      workspaceId: workspace.id,
      expectedProfileRevision: 1,
      nextProfile: {
        ...workspace.profile,
        companySummary: '  工业包装供应商  ',
      },
      touchedFields: [KnowledgeFactDomain.CompanySummary],
    });

    expect(result.profileRevision).toBe(2);
    expect(result.workspace.profile.companySummary).toBe('工业包装供应商');
    expect(result.touchedFieldRevisions).toEqual({
      [KnowledgeFactDomain.CompanySummary]: 2,
    });
  });

  test('returns only a display-safe latest snapshot on a stale expected revision', () => {
    const db = openDatabase();
    const store = createWorkspaceStore(db);
    const workspace = store.createWorkspace({
      name: 'Private workspace',
      type: 'enterprise_lead',
      profile,
      extractionSources: [{
        kind: 'file',
        label: 'private source',
        filePath: '/private/customer/path',
        text: 'private source body',
      }],
      enabledAgentRoles: [],
      settings: {
        ...buildDefaultEnterpriseLeadWorkspaceSettings(),
        model: {
          defaultModel: 'secret-model',
          defaultModelProvider: 'secret-provider',
          providers: {
            secret: {
              enabled: true,
              apiKey: 'sk-private-key',
              baseUrl: 'https://secret.endpoint.test/v1',
              oauthAccessToken: 'oauth-access-private',
              oauthRefreshToken: 'oauth-refresh-private',
              models: [],
            },
          },
        },
      },
    });
    store.updateWorkspaceProfile({
      workspaceId: workspace.id,
      expectedProfileRevision: 1,
      profile: { ...workspace.profile, companySummary: 'Latest safe summary' },
      touchedFields: [KnowledgeFactDomain.CompanySummary],
    });

    let thrown: unknown;
    try {
      store.updateWorkspaceProfile({
        workspaceId: workspace.id,
        expectedProfileRevision: 1,
        profile: { ...workspace.profile, sellingPoints: ['stale overwrite'] },
        touchedFields: [KnowledgeFactDomain.SellingPoints],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EnterpriseLeadProfileRevisionConflictError);
    expect(thrown).toMatchObject({
      latestProfile: {
        id: workspace.id,
        profile: expect.objectContaining({ companySummary: 'Latest safe summary' }),
        profileRevision: 2,
        updatedAt: expect.any(String),
      },
    });
    const serialized = JSON.stringify(thrown);
    for (const sentinel of [
      'sk-private-key',
      'oauth-access-private',
      'oauth-refresh-private',
      'secret.endpoint.test',
      '/private/customer/path',
      'private source body',
      'secret-provider',
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
    expect(store.getProfileRevisionStore().getFieldRevision(
      workspace.id,
      KnowledgeFactDomain.SellingPoints,
    )).toBe(1);
    expect(store.getTrustedProfileIndexStore().getJob(workspace.id, 3)).toBeNull();
  });

  test('clones conflict snapshots into the exact display-safe allowlist', () => {
    const sourceProfile = {
      ...profile,
      productList: [...profile.productList],
      confirmedKnowledgeKeys: ['productList:重型纸箱'],
      ignoredKnowledgeKeys: ['sellingPoints:可替代木箱'],
      nestedSecret: 'nested-profile-secret',
    };
    const sourceSnapshot = {
      id: 'workspace-safe',
      profile: sourceProfile,
      profileRevision: 7,
      updatedAt: '2026-07-12T05:00:00.000Z',
      settings: { apiKey: 'sk-conflict-secret' },
      extractionSources: [{ filePath: '/private/conflict-source.pdf' }],
    };

    const error = new EnterpriseLeadProfileRevisionConflictError(sourceSnapshot);
    sourceSnapshot.id = 'workspace-mutated';
    sourceSnapshot.profileRevision = 99;
    sourceSnapshot.updatedAt = '2026-07-12T06:00:00.000Z';
    sourceProfile.productList[0] = 'mutated product';
    sourceProfile.confirmedKnowledgeKeys[0] = 'mutated confirmed key';
    sourceProfile.ignoredKnowledgeKeys[0] = 'mutated ignored key';

    expect(Object.keys(error.latestProfile).sort()).toEqual([
      'id',
      'profile',
      'profileRevision',
      'updatedAt',
    ]);
    expect(Object.keys(error.latestProfile.profile).sort()).toEqual([
      ...KnowledgeFactDomains,
      'confirmedKnowledgeKeys',
      'ignoredKnowledgeKeys',
    ].sort());
    expect(error.latestProfile).toEqual({
      id: 'workspace-safe',
      profile: {
        ...profile,
        confirmedKnowledgeKeys: ['productList:重型纸箱'],
        ignoredKnowledgeKeys: ['sellingPoints:可替代木箱'],
      },
      profileRevision: 7,
      updatedAt: '2026-07-12T05:00:00.000Z',
    });
    expect(JSON.stringify(error.latestProfile)).not.toContain('sk-conflict-secret');
    expect(JSON.stringify(error.latestProfile)).not.toContain('/private/conflict-source.pdf');
    expect(JSON.stringify(error.latestProfile)).not.toContain('nested-profile-secret');
  });

  test('single-reads every conflict snapshot accessor and array item', () => {
    const confirmedKeys = new Array<string>(1);
    const ignoredKeys = new Array<string>(1);
    const confirmedItemReads = defineChangingAccessor(
      confirmedKeys,
      0,
      'productList:original product',
      'secret-confirmed-item',
    );
    const ignoredItemReads = defineChangingAccessor(
      ignoredKeys,
      0,
      'sellingPoints:not for export',
      'secret-ignored-item',
    );
    const sourceProfile: Record<string, unknown> = { ...profile };
    const companyReads = defineChangingAccessor(
      sourceProfile,
      'companySummary',
      'Original summary',
      'secret-company-summary',
    );
    const domainReads = defineChangingAccessor(
      sourceProfile,
      KnowledgeFactDomain.ProductList,
      ['Original product'],
      ['secret-domain-array'],
    );
    const confirmedReads = defineChangingAccessor(
      sourceProfile,
      'confirmedKnowledgeKeys',
      confirmedKeys,
      ['secret-confirmed-array'],
    );
    const ignoredReads = defineChangingAccessor(
      sourceProfile,
      'ignoredKnowledgeKeys',
      ignoredKeys,
      ['secret-ignored-array'],
    );
    const maliciousProfile = { ...profile, companySummary: 'secret-profile-object' };
    const sourceSnapshot: Record<string, unknown> = {};
    const idReads = defineChangingAccessor(
      sourceSnapshot,
      'id',
      'workspace-safe',
      'secret-workspace-id',
    );
    const profileReads = defineChangingAccessor(
      sourceSnapshot,
      'profile',
      sourceProfile,
      maliciousProfile,
    );
    const revisionReads = defineChangingAccessor(sourceSnapshot, 'profileRevision', 7, 8);
    const updatedAtReads = defineChangingAccessor(
      sourceSnapshot,
      'updatedAt',
      '2026-07-12T05:00:00.000Z',
      '2026-07-13T05:00:00.000Z',
    );

    const error = new EnterpriseLeadProfileRevisionConflictError(sourceSnapshot);

    expect(error.latestProfile).toEqual({
      id: 'workspace-safe',
      profile: {
        ...profile,
        companySummary: 'Original summary',
        productList: ['Original product'],
        confirmedKnowledgeKeys: ['productList:original product'],
        ignoredKnowledgeKeys: ['sellingPoints:not for export'],
      },
      profileRevision: 7,
      updatedAt: '2026-07-12T05:00:00.000Z',
    });
    for (const readCount of [
      idReads,
      profileReads,
      revisionReads,
      updatedAtReads,
      companyReads,
      domainReads,
      confirmedReads,
      ignoredReads,
      confirmedItemReads,
      ignoredItemReads,
    ]) {
      expect(readCount()).toBe(1);
    }
    expect(JSON.stringify(error.latestProfile)).not.toContain('secret-');
  });

  test('rejects sparse required and trust arrays with the fixed persistence error', () => {
    for (const sparseField of [
      KnowledgeFactDomain.ProductList,
      'confirmedKnowledgeKeys',
    ] as const) {
      const sparseArray = new Array<string>(1);
      const sparseProfile = {
        ...profile,
        [sparseField]: sparseArray,
      };

      expect(() => new EnterpriseLeadProfileRevisionConflictError({
        id: 'workspace-safe',
        profile: sparseProfile,
        profileRevision: 7,
        updatedAt: '2026-07-12T05:00:00.000Z',
      })).toThrow('Workspace profile persistence state conflict');
    }
  });

  test('rejects undeclared value and trust-key domains without any write', () => {
    const db = openDatabase();
    const store = createWorkspaceStore(db);
    const workspace = store.createWorkspace({
      name: 'Integrity workspace',
      type: 'enterprise_lead',
      profile: {
        ...profile,
        confirmedKnowledgeKeys: ['productList:重型纸箱'],
      },
      extractionSources: [],
      enabledAgentRoles: [],
    });

    const invalidProfiles = [
      {
        ...workspace.profile,
        productList: ['未声明变更'],
      },
      {
        ...workspace.profile,
        confirmedKnowledgeKeys: [],
        ignoredKnowledgeKeys: ['productList:重型纸箱'],
      },
    ];
    for (const nextProfile of invalidProfiles) {
      expect(() => store.updateWorkspaceProfile({
        workspaceId: workspace.id,
        expectedProfileRevision: 1,
        profile: nextProfile,
        touchedFields: [KnowledgeFactDomain.CompanySummary],
      })).toThrow(EnterpriseLeadProfileInvalidRequestError);
    }
    expect(store.getWorkspace(workspace.id)?.profileRevision).toBe(1);
    expect(store.getProfileRevisionStore().getFieldRevision(
      workspace.id,
      KnowledgeFactDomain.CompanySummary,
    )).toBe(1);
    expect(store.getTrustedProfileIndexStore().getJob(workspace.id, 2)).toBeNull();
  });

  test('rejects a canonical confirmed-and-ignored overlap without any CAS write', () => {
    const db = openDatabase();
    const store = createWorkspaceStore(db);
    const workspace = store.createWorkspace({
      name: 'Contradictory trust workspace',
      type: 'enterprise_lead',
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const overlappingKey = 'productList:重型纸箱';

    expect(() => store.updateWorkspaceProfile({
      workspaceId: workspace.id,
      expectedProfileRevision: 1,
      profile: {
        ...workspace.profile,
        confirmedKnowledgeKeys: [overlappingKey],
        ignoredKnowledgeKeys: [overlappingKey],
      },
      touchedFields: [KnowledgeFactDomain.ProductList],
    })).toThrow(EnterpriseLeadProfileInvalidRequestError);

    expect(store.getWorkspace(workspace.id)?.profile).toEqual(workspace.profile);
    expect(store.getWorkspace(workspace.id)?.profileRevision).toBe(1);
    expect(store.getProfileRevisionStore().getFieldRevision(
      workspace.id,
      KnowledgeFactDomain.ProductList,
    )).toBe(1);
    expect(store.getTrustedProfileIndexStore().getJob(workspace.id, 2)).toBeNull();
  });

  test('rejects sparse and inherited regular Profile arrays without any CAS write', () => {
    const db = openDatabase();
    const store = createWorkspaceStore(db);
    const workspace = store.createWorkspace({
      name: 'Dense Profile workspace',
      type: 'enterprise_lead',
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const inheritedArray = new Array<string>(1);
    const inheritedPrototype = Object.assign(Object.create(Array.prototype), {
      0: 'inherited product',
    });
    Object.setPrototypeOf(inheritedArray, inheritedPrototype);
    const invalidProfiles = [
      { ...workspace.profile, productList: new Array<string>(1) },
      { ...workspace.profile, confirmedKnowledgeKeys: new Array<string>(1) },
      { ...workspace.profile, productList: inheritedArray },
    ];

    for (const nextProfile of invalidProfiles) {
      expect(() => store.updateWorkspaceProfile({
        workspaceId: workspace.id,
        expectedProfileRevision: 1,
        profile: nextProfile,
        touchedFields: [KnowledgeFactDomain.ProductList],
      })).toThrow(EnterpriseLeadProfileInvalidRequestError);
    }

    expect(store.getWorkspace(workspace.id)?.profile).toEqual(workspace.profile);
    expect(store.getWorkspace(workspace.id)?.profileRevision).toBe(1);
    expect(store.getProfileRevisionStore().getFieldRevision(
      workspace.id,
      KnowledgeFactDomain.ProductList,
    )).toBe(1);
    expect(store.getTrustedProfileIndexStore().getJob(workspace.id, 2)).toBeNull();
  });

  test('CAS reads the next Profile accessor once and persists its cloned safe value', () => {
    const db = openDatabase();
    const store = createWorkspaceStore(db);
    const workspace = store.createWorkspace({
      name: 'Accessor CAS workspace',
      type: 'enterprise_lead',
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const safeNextProfile: Record<string, unknown> = { ...workspace.profile };
    const companyReads = defineChangingAccessor(
      safeNextProfile,
      KnowledgeFactDomain.CompanySummary,
      'Safe CAS summary',
      'secret-cas-summary',
    );
    const input: Record<string, unknown> = {
      workspaceId: workspace.id,
      expectedProfileRevision: 1,
      touchedFields: [KnowledgeFactDomain.CompanySummary],
    };
    const nextProfileReads = defineChangingAccessor(
      input,
      'nextProfile',
      safeNextProfile,
      { ...workspace.profile, companySummary: 'secret-next-profile' },
    );

    const result = store.getProfileRevisionStore().compareAndSwapProfile(input as never);

    expect(result.workspace.profile.companySummary).toBe('Safe CAS summary');
    expect(result.profileRevision).toBe(2);
    expect(nextProfileReads()).toBe(1);
    expect(companyReads()).toBe(1);
    expect(JSON.stringify(result.workspace.profile)).not.toContain('secret-');
  });

  test('preserves unchanged malformed trust history byte-for-byte on an unrelated save', () => {
    const db = openDatabase();
    const store = createWorkspaceStore(db);
    const workspace = store.createWorkspace({
      name: 'Malformed history workspace',
      type: 'enterprise_lead',
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const malformedKeys = [' unknown:key ', 'productList:Not Canonical', 'no-separator'];
    const historicalProfile = {
      ...workspace.profile,
      confirmedKnowledgeKeys: malformedKeys,
      ignoredKnowledgeKeys: malformedKeys,
    };
    db.prepare(`
      UPDATE enterprise_lead_workspaces
      SET profile = ?
      WHERE id = ?
    `).run(JSON.stringify(historicalProfile), workspace.id);

    const updated = store.updateWorkspaceProfile({
      workspaceId: workspace.id,
      expectedProfileRevision: 1,
      profile: {
        ...historicalProfile,
        contactRules: ['人工复核后联系'],
      },
      touchedFields: [KnowledgeFactDomain.ContactRules],
    });

    expect(updated.profile.confirmedKnowledgeKeys).toEqual(malformedKeys);
    expect(updated.profile.ignoredKnowledgeKeys).toEqual(malformedKeys);
    expect(store.getProfileRevisionStore().getFieldRevision(
      workspace.id,
      KnowledgeFactDomain.ContactRules,
    )).toBe(2);
    expect(store.getProfileRevisionStore().getFieldRevision(
      workspace.id,
      KnowledgeFactDomain.ProductList,
    )).toBe(1);

    expect(() => store.updateWorkspaceProfile({
      workspaceId: workspace.id,
      expectedProfileRevision: 2,
      profile: {
        ...updated.profile,
        confirmedKnowledgeKeys: malformedKeys.slice(1),
      },
      touchedFields: [KnowledgeFactDomain.ProductList],
    })).toThrow(EnterpriseLeadProfileInvalidRequestError);
  });

  test('maps an invalid persisted regular Profile to the fixed persistence error', () => {
    const db = openDatabase();
    const store = createWorkspaceStore(db);
    const workspace = store.createWorkspace({
      name: 'Invalid persisted Profile workspace',
      type: 'enterprise_lead',
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    db.prepare(`
      UPDATE enterprise_lead_workspaces
      SET profile = ?
      WHERE id = ?
    `).run(JSON.stringify({ ...workspace.profile, productList: [1] }), workspace.id);

    expect(() => store.updateWorkspaceProfile({
      workspaceId: workspace.id,
      expectedProfileRevision: 1,
      profile: workspace.profile,
      touchedFields: [KnowledgeFactDomain.ProductList],
    })).toThrow('Workspace profile persistence state conflict');
    expect(store.getProfileRevisionStore().getFieldRevision(
      workspace.id,
      KnowledgeFactDomain.ProductList,
    )).toBe(1);
    expect(store.getTrustedProfileIndexStore().getJob(workspace.id, 2)).toBeNull();
  });

  test('rejects nested public use and current-transaction use outside a transaction', () => {
    const db = openDatabase();
    const store = createWorkspaceStore(db);
    const workspace = store.createWorkspace({
      name: 'Transaction boundary workspace',
      type: 'enterprise_lead',
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const revisionStore = store.getProfileRevisionStore();
    const input = {
      workspaceId: workspace.id,
      expectedProfileRevision: 1,
      nextProfile: workspace.profile,
      touchedFields: [KnowledgeFactDomain.CompanySummary],
    };

    expect(() => revisionStore.compareAndSwapProfileInCurrentTransaction(input)).toThrow();
    expect(() => db.transaction(() => revisionStore.compareAndSwapProfile(input))()).toThrow();
  });

  test('rolls back profile, fields, and outbox for every post-write fault stage', () => {
    for (const fault of [
      { stage: EnterpriseLeadWorkspaceProfilePersistenceStage.AfterProfileUpdate },
      {
        stage: EnterpriseLeadWorkspaceProfilePersistenceStage.AfterFieldRevisionUpdate,
        field: KnowledgeFactDomain.CompanySummary,
      },
      { stage: EnterpriseLeadWorkspaceProfilePersistenceStage.AfterProfileOutboxInsert },
    ]) {
      const db = openDatabase();
      let armed = false;
      const store = createWorkspaceStore(db, (stage, details) => {
        if (armed && stage === fault.stage && (!fault.field || details.field === fault.field)) {
          throw new Error('injected profile fault');
        }
      });
      const workspace = store.createWorkspace({
        name: 'Fault workspace',
        type: 'enterprise_lead',
        profile,
        extractionSources: [],
        enabledAgentRoles: [],
      });
      armed = true;

      expect(() => store.updateWorkspaceProfile({
        workspaceId: workspace.id,
        expectedProfileRevision: 1,
        profile: { ...workspace.profile, companySummary: 'must roll back' },
        touchedFields: [KnowledgeFactDomain.CompanySummary],
      })).toThrow('injected profile fault');
      expect(store.getWorkspace(workspace.id)?.profileRevision).toBe(1);
      expect(store.getWorkspace(workspace.id)?.profile.companySummary).toBe(profile.companySummary);
      expect(store.getProfileRevisionStore().getFieldRevision(
        workspace.id,
        KnowledgeFactDomain.CompanySummary,
      )).toBe(1);
      expect(store.getTrustedProfileIndexStore().getJob(workspace.id, 2)).toBeNull();
      db.close();
    }
  });

  test('fails closed and rolls back when the next revision job already exists', () => {
    const db = openDatabase();
    const store = createWorkspaceStore(db);
    const workspace = store.createWorkspace({
      name: 'Collision workspace',
      type: 'enterprise_lead',
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    store.getTrustedProfileIndexStore().enqueue({
      workspaceId: workspace.id,
      profileRevision: 2,
      now: '2026-07-12T03:00:00.000Z',
    });

    expect(() => store.updateWorkspaceProfile({
      workspaceId: workspace.id,
      expectedProfileRevision: 1,
      profile: { ...workspace.profile, companySummary: 'must roll back' },
      touchedFields: [KnowledgeFactDomain.CompanySummary],
    })).toThrow('Trusted profile index persistence state conflict');
    expect(store.getWorkspace(workspace.id)?.profileRevision).toBe(1);
    expect(store.getProfileRevisionStore().getFieldRevision(
      workspace.id,
      KnowledgeFactDomain.CompanySummary,
    )).toBe(1);
  });

  test('allows exactly one of two file-backed WAL writers with the same expected revision', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-revision-manual-race-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'workspace.sqlite');
    const firstDb = openDatabase(databasePath);
    firstDb.pragma('journal_mode = WAL');
    const firstStore = createWorkspaceStore(firstDb);
    const workspace = firstStore.createWorkspace({
      name: 'Manual race workspace',
      type: 'enterprise_lead',
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const secondDb = openDatabase(databasePath);
    secondDb.pragma('journal_mode = WAL');
    const secondStore = createWorkspaceStore(secondDb);
    const firstView = firstStore.getWorkspace(workspace.id);
    const secondView = secondStore.getWorkspace(workspace.id);
    if (!firstView || !secondView) {
      throw new Error('workspace missing');
    }

    const outcomes = [
      () => firstStore.updateWorkspaceProfile({
        workspaceId: workspace.id,
        expectedProfileRevision: firstView.profileRevision,
        profile: { ...firstView.profile, companySummary: 'first writer' },
        touchedFields: [KnowledgeFactDomain.CompanySummary],
      }),
      () => secondStore.updateWorkspaceProfile({
        workspaceId: workspace.id,
        expectedProfileRevision: secondView.profileRevision,
        profile: { ...secondView.profile, companySummary: 'second writer' },
        touchedFields: [KnowledgeFactDomain.CompanySummary],
      }),
    ].map(write => {
      try {
        return { workspace: write() } as const;
      } catch (error) {
        return { error } as const;
      }
    });
    const successes = outcomes.filter(
      (outcome): outcome is { workspace: ReturnType<typeof firstStore.updateWorkspaceProfile> } =>
        'workspace' in outcome,
    );
    const conflicts = outcomes.filter(
      (outcome): outcome is { error: unknown } => 'error' in outcome,
    );

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].error).toBeInstanceOf(EnterpriseLeadProfileRevisionConflictError);
    expect(String(conflicts[0].error)).not.toMatch(/SQLITE|BUSY|UNIQUE|UPDATE/i);
    expect(firstStore.getWorkspace(workspace.id)).toMatchObject({
      profile: { companySummary: successes[0].workspace.profile.companySummary },
      profileRevision: 2,
    });
    expect(firstStore.getProfileRevisionStore().getFieldRevision(
      workspace.id,
      KnowledgeFactDomain.CompanySummary,
    )).toBe(2);
    expect(firstStore.getTrustedProfileIndexStore().getJob(workspace.id, 2)).not.toBeNull();
    expect(firstStore.getTrustedProfileIndexStore().getJob(workspace.id, 3)).toBeNull();
    expect(secondStore.getProfileRevisionStore().getFieldRevision(
      workspace.id,
      KnowledgeFactDomain.ProductList,
    )).toBe(1);
  });

  test('restarts a WAL snapshot around the outer transaction without a partial commit', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-revision-wal-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'workspace.sqlite');
    const firstDb = openDatabase(databasePath);
    firstDb.pragma('journal_mode = WAL');
    const firstStore = createWorkspaceStore(firstDb);
    const workspace = firstStore.createWorkspace({
      name: 'WAL workspace',
      type: 'enterprise_lead',
      profile,
      extractionSources: [],
      enabledAgentRoles: [],
    });
    const secondDb = openDatabase(databasePath);
    secondDb.pragma('journal_mode = WAL');
    const secondStore = createWorkspaceStore(secondDb);
    let outerAttempts = 0;

    const outerTransaction = firstDb.transaction(() => {
      outerAttempts += 1;
      const current = firstStore.getWorkspace(workspace.id);
      if (!current) {
        throw new Error('workspace missing');
      }
      if (outerAttempts === 1) {
        secondStore.updateWorkspaceProfile({
          workspaceId: workspace.id,
          expectedProfileRevision: current.profileRevision,
          profile: { ...current.profile, companySummary: 'manual winner' },
          touchedFields: [KnowledgeFactDomain.CompanySummary],
        });
      }
      return firstStore.getProfileRevisionStore().compareAndSwapProfileInCurrentTransaction({
        workspaceId: workspace.id,
        expectedProfileRevision: current.profileRevision,
        nextProfile: { ...current.profile, sellingPoints: ['outer transaction change'] },
        touchedFields: [KnowledgeFactDomain.SellingPoints],
      });
    });

    const result = runTransientSqliteWriteTransaction(outerTransaction);

    expect(outerAttempts).toBe(2);
    expect(result.profileRevision).toBe(3);
    expect(result.workspace.profile.companySummary).toBe('manual winner');
    expect(result.workspace.profile.sellingPoints).toEqual(['outer transaction change']);
    expect(firstStore.getTrustedProfileIndexStore().getJob(workspace.id, 2)).not.toBeNull();
    expect(firstStore.getTrustedProfileIndexStore().getJob(workspace.id, 3)).not.toBeNull();
  });
});
