import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  EnterpriseLeadWorkspaceType,
} from '../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadWorkspaceProfile,
} from '../../shared/enterpriseLeadWorkspace/types';
import {
  KnowledgeBaseErrorCode,
  KnowledgeDocumentSourceMode,
  KnowledgeDocumentStatus,
  KnowledgeEnrichmentStatus,
  KnowledgeFactArchiveProjectionDecision,
  KnowledgeFactDomain,
  KnowledgeFactProfileProjectionAction,
  KnowledgeFactProjectionConflictKind,
  KnowledgeFactProjectionOperation,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
} from '../../shared/knowledgeBase/constants';
import {
  buildEnterpriseKnowledgeKey,
  normalizeEnterpriseKnowledgeValue,
} from '../../shared/knowledgeBase/enterpriseLeadProfileKnowledge';
import {
  EnterpriseLeadWorkspaceProfilePersistenceStage,
} from '../enterpriseLeadWorkspace/profileRevisionStore';
import { EnterpriseLeadWorkspaceStore } from '../enterpriseLeadWorkspace/store';
import { applySqliteConnectionPolicy } from '../libs/sqliteConnectionPolicy';
import {
  EnterpriseLeadKnowledgeFactProjector,
  KnowledgeFactProjectionConflictError,
  KnowledgeFactProjectorError,
  KnowledgeFactProjectorStage,
} from './enterpriseLeadKnowledgeFactProjector';
import { KnowledgeDocumentStore } from './knowledgeDocumentStore';
import { KnowledgeEnrichmentRequestStore } from './knowledgeEnrichmentRequestStore';
import { KnowledgeFactProjectionStore } from './knowledgeFactProjectionStore';
import { KnowledgeFactStore } from './knowledgeFactStore';

const NOW_1 = '2026-07-12T03:00:00.000Z';
const NOW_2 = '2026-07-12T03:01:00.000Z';
const NOW_3 = '2026-07-12T03:02:00.000Z';
const NOW_4 = '2026-07-12T03:03:00.000Z';
const ROUTING_FINGERPRINT = 'a'.repeat(64);
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop()!, { force: true, recursive: true });
  }
});

const emptyProfile = (): EnterpriseLeadWorkspaceProfile => ({
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

type FixtureOptions = {
  profile?: EnterpriseLeadWorkspaceProfile;
  onStage?: (stage: KnowledgeFactProjectorStage) => void;
  onTrustedRefreshCommitted?: () => void;
  profileFaultStage?: EnterpriseLeadWorkspaceProfilePersistenceStage;
  shouldFaultProfile?: () => boolean;
  db?: Database.Database;
};

const createFixture = (options: FixtureOptions = {}) => {
  const db = options.db ?? new Database(':memory:');
  db.pragma('foreign_keys = ON');
  let profileFaultsEnabled = false;
  const workspaceStore = new EnterpriseLeadWorkspaceStore(db, {
    faultInjector: stage => {
      if (
        profileFaultsEnabled &&
        (options.shouldFaultProfile?.() ?? true) &&
        stage === options.profileFaultStage
      ) {
        throw new Error('SECRET profile fault /private/profile SQL SELECT settings apiKey');
      }
    },
  });
  const workspace = workspaceStore.createWorkspace({
    name: 'Task 9 workspace',
    type: EnterpriseLeadWorkspaceType.EnterpriseLead,
    profile: options.profile ?? emptyProfile(),
    extractionSources: [],
    enabledAgentRoles: [],
  });
  profileFaultsEnabled = true;
  const requestStore = new KnowledgeEnrichmentRequestStore(db, { clock: () => NOW_1 });
  const documentStore = new KnowledgeDocumentStore(db);
  const factStore = new KnowledgeFactStore(db, { requestStore, clock: () => NOW_1 });
  const projectionStore = new KnowledgeFactProjectionStore(db);
  const projector = new EnterpriseLeadKnowledgeFactProjector(
    db,
    factStore,
    projectionStore,
    workspaceStore.getProfileRevisionStore(),
    {
      clock: () => NOW_2,
      onStage: options.onStage,
      onTrustedRefreshCommitted: options.onTrustedRefreshCommitted,
    },
  );
  return {
    db,
    documentStore,
    factStore,
    projectionStore,
    projector,
    requestStore,
    workspace,
    workspaceStore,
  };
};

const seedPendingFact = (
  fixture: ReturnType<typeof createFixture>,
  overrides: {
    factId?: string;
    requestId?: string;
    domain?: typeof KnowledgeFactDomain[keyof typeof KnowledgeFactDomain];
    value?: string;
    staleAt?: string | null;
  } = {},
) => {
  const factId = overrides.factId ?? 'fact-a';
  const requestId = overrides.requestId ?? 'request-a';
  const domain = overrides.domain ?? KnowledgeFactDomain.ProductList;
  const value = overrides.value ?? 'Industrial robots';
  const document = fixture.documentStore.createDocumentWithVersion({
    workspaceId: fixture.workspace.id,
    displayName: `${factId}-SECRET-evidence.txt`,
    sourceMode: KnowledgeDocumentSourceMode.Managed,
    status: KnowledgeDocumentStatus.Ready,
    version: {
      contentHash: 'f'.repeat(64),
      managedPath: `/private/SECRET/${factId}`,
      mimeType: 'text/plain',
      fileSize: 64,
      sourceMtime: null,
      parser: 'text',
      extractedText: 'SECRET evidence chunk text about industrial robots',
      extractionPartial: false,
    },
  });
  fixture.db.prepare(`
    INSERT INTO knowledge_enrichment_requests (
      id, workspace_id, document_id, document_version_id, status, consent_mode,
      provider_id, model_id, routing_fingerprint, revision, progress, attempt_count,
      active_attempt_id, error_code, error_message, valid_candidate_count,
      discarded_candidate_count, partial_reasons_json, requested_at, started_at,
      heartbeat_at, completed_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, 'explicit', 'provider-SECRET', 'model-a', ?, 1, 100, 1,
      NULL, NULL, NULL, 1, 0, '[]', ?, ?, NULL, NULL, ?
    )
  `).run(
    requestId,
    fixture.workspace.id,
    document.document.id,
    document.version.id,
    KnowledgeEnrichmentStatus.ReviewRequired,
    ROUTING_FINGERPRINT,
    NOW_1,
    NOW_1,
    NOW_1,
  );
  fixture.db.prepare(`
    INSERT INTO knowledge_facts (
      id, originating_request_id, workspace_id, domain, value, normalized_value,
      review_status, source_kind, revision, conflict_group_key, projection_state,
      created_at, reviewed_at, updated_at, tombstoned_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, NULL, ?, NULL)
  `).run(
    factId,
    requestId,
    fixture.workspace.id,
    domain,
    value,
    normalizeEnterpriseKnowledgeValue(value).normalizedValue,
    KnowledgeFactReviewStatus.Pending,
    KnowledgeFactSourceKind.Extracted,
    KnowledgeFactProjectionState.None,
    NOW_1,
    NOW_1,
  );
  fixture.db.prepare(`
    INSERT INTO knowledge_enrichment_request_facts (request_id, fact_id)
    VALUES (?, ?)
  `).run(requestId, factId);
  fixture.db.prepare(`
    INSERT INTO knowledge_fact_evidence (
      id, workspace_id, fact_id, request_id, document_id, document_version_id,
      chunk_id, quote, confidence, extractor_provider_id, extractor_model_id,
      created_at, stale_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    factId === 'fact-a' ? '1'.repeat(64) : '2'.repeat(64),
    fixture.workspace.id,
    factId,
    requestId,
    document.document.id,
    document.version.id,
    `chunk-${factId}`,
    'SECRET evidence quote',
    0.9,
    'provider-SECRET',
    'model-a',
    NOW_1,
    overrides.staleAt ?? null,
  );
  return { document, domain, factId, requestId, value };
};

const getProfile = (fixture: ReturnType<typeof createFixture>) =>
  fixture.workspaceStore.getWorkspace(fixture.workspace.id)!;

const countRows = (db: Database.Database, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;

const expectProjectionConflict = (
  operation: () => unknown,
  expected: Partial<KnowledgeFactProjectionConflictError['conflict']>,
): KnowledgeFactProjectionConflictError => {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(KnowledgeFactProjectionConflictError);
  expect(thrown).toMatchObject({
    code: KnowledgeBaseErrorCode.FactProjectionConflict,
    conflict: expected,
  });
  expect(thrown).not.toHaveProperty('stack');
  expect(thrown).not.toHaveProperty('cause');
  const serialized = JSON.parse(JSON.stringify(thrown));
  expect(Object.keys(serialized).sort()).toEqual(['code', 'conflict']);
  expect(Object.keys(serialized.conflict).sort()).toEqual([
    'currentFieldValue',
    'domain',
    'factId',
    'factRevision',
    'fieldRevision',
    'kind',
    'operation',
  ].sort());
  for (const forbidden of [
    'settings',
    'apiKey',
    'provider-SECRET',
    '/private/SECRET',
    'SECRET evidence',
    'chunk-fact',
    'SELECT',
    'knowledge_fact_profile_projection_ledger',
  ]) {
    expect(JSON.stringify(serialized)).not.toContain(forbidden);
  }
  return thrown as KnowledgeFactProjectionConflictError;
};

describe('EnterpriseLeadKnowledgeFactProjector review operations', () => {
  test('wakes trusted refresh exactly once after committed Profile changes and never for reject', () => {
    const onTrustedRefreshCommitted = vi.fn();
    const fixture = createFixture({ onTrustedRefreshCommitted });
    seedPendingFact(fixture);

    const confirmed = fixture.projector.confirmFact({ factId: 'fact-a', expectedRevision: 1 });
    expect(confirmed.profileChanged).toBe(true);
    expect(confirmed).not.toHaveProperty('trustedRefreshQueued');
    expect(onTrustedRefreshCommitted).toHaveBeenCalledTimes(1);
    expect(fixture.db.inTransaction).toBe(false);

    const archived = fixture.projector.archiveFact({ factId: 'fact-a', expectedRevision: 2 });
    expect(archived.profileChanged).toBe(true);
    expect(archived).not.toHaveProperty('trustedRefreshQueued');
    expect(onTrustedRefreshCommitted).toHaveBeenCalledTimes(2);

    const rejectedFixture = createFixture({ onTrustedRefreshCommitted });
    seedPendingFact(rejectedFixture, { factId: 'fact-reject', requestId: 'request-reject' });
    rejectedFixture.projector.rejectFact({ factId: 'fact-reject', expectedRevision: 1 });
    expect(onTrustedRefreshCommitted).toHaveBeenCalledTimes(2);
    fixture.db.close();
    rejectedFixture.db.close();
  });

  test('owns one deferred retried transaction and calls only the neutral Profile CAS primitive', () => {
    const source = fs.readFileSync(
      new URL('./enterpriseLeadKnowledgeFactProjector.ts', import.meta.url),
      'utf8',
    );
    expect(source.match(/this\.db\.transaction\(/g)).toHaveLength(3);
    expect(source.match(/runTransientSqliteWriteTransaction\(transaction\)/g)).toHaveLength(3);
    expect(source).not.toContain('.immediate(');
    expect(source.match(/compareAndSwapProfileInCurrentTransaction\(/g)).toHaveLength(2);
    expect(source).not.toMatch(/\.compareAndSwapProfile\s*\(/);
    expect(source).not.toMatch(/\benqueue(?:InCurrentTransaction)?\s*\(/);
  });

  test('fails fast when the Profile revision store is bound to another connection', () => {
    const fixtureA = createFixture();
    const fixtureB = createFixture();
    expect(() => new EnterpriseLeadKnowledgeFactProjector(
      fixtureA.db,
      fixtureA.factStore,
      fixtureA.projectionStore,
      fixtureB.workspaceStore.getProfileRevisionStore(),
    )).toThrow(KnowledgeFactProjectorError);
    fixtureB.db.close();
    fixtureA.db.close();
  });

  test.each([
    { replaceExisting: true },
    { expectedFieldRevision: 1 },
    { replaceExisting: false, expectedFieldRevision: 1 },
  ])('rejects invalid replacement input combinations before any write: %j', replacement => {
    const fixture = createFixture();
    const seeded = seedPendingFact(fixture, {
      domain: KnowledgeFactDomain.CompanySummary,
      value: 'Extracted new summary',
    });
    let thrown: unknown;
    try {
      fixture.projector.confirmFact({
        factId: seeded.factId,
        expectedRevision: 1,
        ...replacement,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KnowledgeFactProjectorError);
    expect(thrown).toMatchObject({ code: KnowledgeBaseErrorCode.InvalidRequest });
    expect(fixture.factStore.getFact(seeded.factId)).toMatchObject({ revision: 1 });
    expect(fixture.projectionStore.getLedger(seeded.factId)).toBeNull();
    expect(getProfile(fixture).profileRevision).toBe(1);
    fixture.db.close();
  });

  test.each([
    KnowledgeFactProjectorStage.AfterRevalidationBeforeFirstWrite,
    KnowledgeFactProjectorStage.AfterFactTransition,
    KnowledgeFactProjectorStage.AfterRequestRecalculation,
  ])('rolls rejection fully back after projector fault stage %s', faultStage => {
    const fixture = createFixture({
      onStage: stage => {
        if (stage === faultStage) {
          throw new Error('SECRET rejection fault SQL /private/path');
        }
      },
    });
    const seeded = seedPendingFact(fixture);
    expect(() => fixture.projector.rejectFact({
      factId: seeded.factId,
      expectedRevision: 1,
    })).toThrow(KnowledgeFactProjectorError);
    expect(fixture.factStore.getFact(seeded.factId)).toMatchObject({
      revision: 1,
      reviewStatus: KnowledgeFactReviewStatus.Pending,
    });
    expect(fixture.requestStore.getSummary(seeded.requestId)?.status)
      .toBe(KnowledgeEnrichmentStatus.ReviewRequired);
    expect(fixture.projectionStore.getLedger(seeded.factId)).toBeNull();
    expect(getProfile(fixture).profileRevision).toBe(1);
    expect(countRows(fixture.db, 'knowledge_trusted_profile_index_jobs')).toBe(1);
    fixture.db.close();
  });

  test('captures reject input accessors exactly once before validation and use', () => {
    const fixture = createFixture();
    const seeded = seedPendingFact(fixture);
    let factIdReads = 0;
    let revisionReads = 0;
    const input = {} as Record<string, unknown>;
    Object.defineProperties(input, {
      factId: {
        enumerable: true,
        get: () => ++factIdReads === 1 ? seeded.factId : 'SECRET-second-read-fact',
      },
      expectedRevision: {
        enumerable: true,
        get: () => ++revisionReads === 1 ? 1 : 99,
      },
    });

    const result = fixture.projector.rejectFact(input as never);
    expect(result.fact).toMatchObject({
      id: seeded.factId,
      reviewStatus: KnowledgeFactReviewStatus.Rejected,
    });
    expect(factIdReads).toBe(1);
    expect(revisionReads).toBe(1);
    fixture.db.close();
  });

  test('confirms an array fact with value/trust projection, ledger, support, request, and outbox atomically', () => {
    const ignoredKey = buildEnterpriseKnowledgeKey(
      KnowledgeFactDomain.ProductList,
      'Industrial robots',
    );
    const fixture = createFixture({
      profile: { ...emptyProfile(), ignoredKnowledgeKeys: [ignoredKey] },
    });
    const seeded = seedPendingFact(fixture);
    const result = fixture.projector.confirmFact({
      factId: seeded.factId,
      expectedRevision: 1,
    });

    expect(result).toMatchObject({
      profileChanged: true,
      profileRevision: 2,
      fieldRevision: 2,
      fact: {
        id: seeded.factId,
        reviewStatus: KnowledgeFactReviewStatus.Confirmed,
        projectionState: KnowledgeFactProjectionState.Active,
        revision: 2,
        reviewedAt: NOW_2,
      },
    });
    expect(result.fact.activeEvidenceCount).toBe(1);
    expect(result.fact.evidencePreview?.quote).toBe('SECRET evidence quote');
    const workspace = getProfile(fixture);
    expect(workspace.profile.productList).toEqual(['Industrial robots']);
    expect(workspace.profile.confirmedKnowledgeKeys).toEqual([ignoredKey]);
    expect(workspace.profile.ignoredKnowledgeKeys).toBeUndefined();
    expect(fixture.workspaceStore.getProfileRevisionStore().getFieldRevision(
      workspace.id,
      KnowledgeFactDomain.ProductList,
    )).toBe(2);
    expect(fixture.workspaceStore.getTrustedProfileIndexStore().getJob(workspace.id, 2))
      .not.toBeNull();
    expect(fixture.requestStore.getSummary(seeded.requestId)?.status)
      .toBe(KnowledgeEnrichmentStatus.Completed);

    expect(fixture.projectionStore.getLedger(seeded.factId)).toEqual({
      factId: seeded.factId,
      workspaceId: workspace.id,
      domain: KnowledgeFactDomain.ProductList,
      normalizedValue: 'industrial robots',
      cycleRootFactId: seeded.factId,
      action: KnowledgeFactProfileProjectionAction.Inserted,
      appliedValue: ['Industrial robots'],
      priorValue: [],
      appliedProfileRevision: 2,
      appliedFieldRevision: 2,
      priorConfirmedKeyPresent: false,
      priorIgnoredKeyPresent: true,
      appliedAt: NOW_2,
      reversedAt: null,
    });
    expect(fixture.projectionStore.getSupportGroup(
      workspace.id,
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.activeSupportCount).toBe(1);
    fixture.db.close();
  });

  test('deduplicates a preexisting value while recording support and rejects without Profile/outbox work', () => {
    const fixture = createFixture({
      profile: { ...emptyProfile(), productList: [' INDUSTRIAL   ROBOTS '] },
    });
    const seeded = seedPendingFact(fixture);
    const confirm = fixture.projector.confirmFact({ factId: seeded.factId, expectedRevision: 1 });
    expect(getProfile(fixture).profile.productList).toEqual(['INDUSTRIAL   ROBOTS']);
    expect(fixture.projectionStore.getLedger(seeded.factId)?.action)
      .toBe(KnowledgeFactProfileProjectionAction.PreexistingSupport);
    expect(confirm.profileRevision).toBe(2);

    const rejectSeed = seedPendingFact(fixture, {
      factId: 'fact-b',
      requestId: 'request-b',
      domain: KnowledgeFactDomain.SellingPoints,
      value: 'Reject this',
      staleAt: NOW_1,
    });
    const beforeOutbox = countRows(fixture.db, 'knowledge_trusted_profile_index_jobs');
    const reject = fixture.projector.rejectFact({
      factId: rejectSeed.factId,
      expectedRevision: 1,
    });
    expect(reject).toMatchObject({
      profileChanged: false,
      profileRevision: null,
      fieldRevision: null,
      fact: {
        reviewStatus: KnowledgeFactReviewStatus.Rejected,
        projectionState: KnowledgeFactProjectionState.None,
        revision: 2,
      },
    });
    expect(fixture.projectionStore.getLedger(rejectSeed.factId)).toBeNull();
    expect(countRows(fixture.db, 'knowledge_trusted_profile_index_jobs')).toBe(beforeOutbox);
    expect(fixture.requestStore.getSummary(rejectSeed.requestId)?.status)
      .toBe(KnowledgeEnrichmentStatus.Completed);
    fixture.db.close();
  });

  test('records support without CAS or outbox when Profile value and trust are already confirmed', () => {
    const key = buildEnterpriseKnowledgeKey(KnowledgeFactDomain.ProductList, 'Industrial robots');
    const onTrustedRefreshCommitted = vi.fn();
    const fixture = createFixture({
      profile: {
        ...emptyProfile(),
        productList: ['Industrial robots'],
        confirmedKnowledgeKeys: [key],
      },
      onTrustedRefreshCommitted,
    });
    const seeded = seedPendingFact(fixture);
    const beforeJobs = countRows(fixture.db, 'knowledge_trusted_profile_index_jobs');
    const confirmed = fixture.projector.confirmFact({
      factId: seeded.factId,
      expectedRevision: 1,
    });
    expect(confirmed).toMatchObject({
      profileChanged: false,
      profileRevision: 1,
      fieldRevision: 1,
    });
    expect(countRows(fixture.db, 'knowledge_trusted_profile_index_jobs')).toBe(beforeJobs);
    expect(fixture.projectionStore.getLedger(seeded.factId)?.action)
      .toBe(KnowledgeFactProfileProjectionAction.PreexistingSupport);

    const archived = fixture.projector.archiveFact({
      factId: seeded.factId,
      expectedRevision: 2,
    });
    expect(archived).toMatchObject({
      profileChanged: false,
      profileRevision: 1,
      fieldRevision: 1,
    });
    expect(countRows(fixture.db, 'knowledge_trusted_profile_index_jobs')).toBe(beforeJobs);
    expect(getProfile(fixture).profile.productList).toEqual(['Industrial robots']);
    expect(getProfile(fixture).profile.confirmedKnowledgeKeys).toEqual([key]);
    expect(onTrustedRefreshCommitted).not.toHaveBeenCalled();
    fixture.db.close();
  });

  test('fails confirmation closed when active evidence no longer belongs to an active current document version', () => {
    const onTrustedRefreshCommitted = vi.fn();
    const fixture = createFixture({ onTrustedRefreshCommitted });
    const seeded = seedPendingFact(fixture);
    fixture.db.prepare(`
      UPDATE knowledge_documents
      SET deleted_at = ?
      WHERE id = ?
    `).run(NOW_2, seeded.document.document.id);

    let thrown: unknown;
    try {
      fixture.projector.confirmFact({ factId: seeded.factId, expectedRevision: 1 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KnowledgeFactProjectorError);
    expect(thrown).toMatchObject({ code: KnowledgeBaseErrorCode.FactEvidenceStale });
    expect(fixture.factStore.getFact(seeded.factId)).toMatchObject({ revision: 1 });
    expect(fixture.projectionStore.getLedger(seeded.factId)).toBeNull();
    expect(getProfile(fixture).profileRevision).toBe(1);
    expect(countRows(fixture.db, 'knowledge_trusted_profile_index_jobs')).toBe(1);
    expect(onTrustedRefreshCommitted).not.toHaveBeenCalled();
    expect(JSON.stringify(thrown)).not.toContain('SECRET evidence');
    fixture.db.close();
  });

  test.each([
    KnowledgeFactProjectorStage.AfterRevalidationBeforeFirstWrite,
    KnowledgeFactProjectorStage.AfterProfileChange,
    KnowledgeFactProjectorStage.AfterProjectionChange,
    KnowledgeFactProjectorStage.AfterFactTransition,
    KnowledgeFactProjectorStage.AfterRequestRecalculation,
  ])('rolls confirmation fully back after projector fault stage %s', faultStage => {
    const onTrustedRefreshCommitted = vi.fn();
    const fixture = createFixture({
      onStage: stage => {
        if (stage === faultStage) {
          throw new Error('SECRET projector fault SQL /private/path');
        }
      },
      onTrustedRefreshCommitted,
    });
    const seeded = seedPendingFact(fixture);
    let thrown: unknown;
    try {
      fixture.projector.confirmFact({ factId: seeded.factId, expectedRevision: 1 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KnowledgeFactProjectorError);
    expect(thrown).toMatchObject({ code: KnowledgeBaseErrorCode.EnrichmentPersistenceFailed });
    expect(fixture.factStore.getFact(seeded.factId)).toMatchObject({
      revision: 1,
      reviewStatus: KnowledgeFactReviewStatus.Pending,
    });
    expect(fixture.projectionStore.getLedger(seeded.factId)).toBeNull();
    expect(getProfile(fixture)).toMatchObject({ profileRevision: 1 });
    expect(countRows(fixture.db, 'knowledge_trusted_profile_index_jobs')).toBe(1);
    expect(fixture.requestStore.getSummary(seeded.requestId)?.status)
      .toBe(KnowledgeEnrichmentStatus.ReviewRequired);
    expect(JSON.stringify(thrown)).not.toContain('SECRET');
    expect(onTrustedRefreshCommitted).not.toHaveBeenCalled();
    fixture.db.close();
  });

  test.each([
    EnterpriseLeadWorkspaceProfilePersistenceStage.AfterProfileUpdate,
    EnterpriseLeadWorkspaceProfilePersistenceStage.AfterFieldRevisionUpdate,
    EnterpriseLeadWorkspaceProfilePersistenceStage.AfterProfileOutboxInsert,
  ])('rolls archive fully back after Profile CAS fault stage %s', profileFaultStage => {
    let archiveProfileFaultEnabled = false;
    const fixture = createFixture({
      profileFaultStage,
      shouldFaultProfile: () => archiveProfileFaultEnabled,
    });
    const seeded = seedPendingFact(fixture);
    fixture.projector.confirmFact({ factId: seeded.factId, expectedRevision: 1 });
    archiveProfileFaultEnabled = true;
    const beforeProfile = getProfile(fixture);
    const beforeJobs = countRows(fixture.db, 'knowledge_trusted_profile_index_jobs');

    expect(() => fixture.projector.archiveFact({
      factId: seeded.factId,
      expectedRevision: 2,
    })).toThrow(KnowledgeFactProjectorError);
    expect(getProfile(fixture)).toEqual(beforeProfile);
    expect(fixture.factStore.getFact(seeded.factId)).toMatchObject({
      revision: 2,
      tombstonedAt: null,
      projectionState: KnowledgeFactProjectionState.Active,
    });
    expect(fixture.projectionStore.getLedger(seeded.factId)?.reversedAt).toBeNull();
    expect(fixture.projectionStore.getSupportGroup(
      fixture.workspace.id,
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.activeSupportCount).toBe(1);
    expect(countRows(fixture.db, 'knowledge_trusted_profile_index_jobs')).toBe(beforeJobs);
    fixture.db.close();
  });

  test.each([
    EnterpriseLeadWorkspaceProfilePersistenceStage.AfterProfileUpdate,
    EnterpriseLeadWorkspaceProfilePersistenceStage.AfterFieldRevisionUpdate,
    EnterpriseLeadWorkspaceProfilePersistenceStage.AfterProfileOutboxInsert,
  ])('rolls confirmation fully back after Profile CAS fault stage %s', profileFaultStage => {
    const fixture = createFixture({ profileFaultStage });
    const seeded = seedPendingFact(fixture);
    expect(() => fixture.projector.confirmFact({
      factId: seeded.factId,
      expectedRevision: 1,
    })).toThrow(KnowledgeFactProjectorError);
    expect(fixture.factStore.getFact(seeded.factId)).toMatchObject({ revision: 1 });
    expect(fixture.projectionStore.getLedger(seeded.factId)).toBeNull();
    expect(getProfile(fixture).profileRevision).toBe(1);
    expect(fixture.workspaceStore.getProfileRevisionStore().getFieldRevision(
      fixture.workspace.id,
      KnowledgeFactDomain.ProductList,
    )).toBe(1);
    expect(countRows(fixture.db, 'knowledge_trusted_profile_index_jobs')).toBe(1);
    fixture.db.close();
  });
});

describe('EnterpriseLeadKnowledgeFactProjector company-summary conflicts', () => {
  test('rejects malformed sparse conflict field values instead of serializing hidden data', () => {
    const sparse = new Array<string>(1);
    expect(() => new KnowledgeFactProjectionConflictError({
      operation: KnowledgeFactProjectionOperation.Archive,
      kind: KnowledgeFactProjectionConflictKind.ArchiveFieldChanged,
      factId: 'fact-a',
      factRevision: 1,
      domain: KnowledgeFactDomain.ProductList,
      currentFieldValue: sparse,
      fieldRevision: 1,
    })).toThrow(KnowledgeFactProjectorError);
  });

  test('returns a restart-safe display-only conflict and requires exact displayed field revision to replace', () => {
    const fixture = createFixture({
      profile: { ...emptyProfile(), companySummary: 'Existing safe summary' },
    });
    const seeded = seedPendingFact(fixture, {
      domain: KnowledgeFactDomain.CompanySummary,
      value: 'Extracted new summary',
    });
    const beforeProfile = getProfile(fixture);
    expectProjectionConflict(
      () => fixture.projector.confirmFact({ factId: seeded.factId, expectedRevision: 1 }),
      {
        operation: KnowledgeFactProjectionOperation.Confirm,
        kind: KnowledgeFactProjectionConflictKind.CompanySummaryReplacement,
        factId: seeded.factId,
        factRevision: 1,
        domain: KnowledgeFactDomain.CompanySummary,
        currentFieldValue: 'Existing safe summary',
        fieldRevision: 1,
      },
    );
    expect(getProfile(fixture)).toEqual(beforeProfile);
    expect(fixture.factStore.getFact(seeded.factId)).toMatchObject({ revision: 1 });
    expect(fixture.projectionStore.getLedger(seeded.factId)).toBeNull();

    const restarted = new EnterpriseLeadKnowledgeFactProjector(
      fixture.db,
      fixture.factStore,
      fixture.projectionStore,
      fixture.workspaceStore.getProfileRevisionStore(),
      { clock: () => NOW_2 },
    );
    expectProjectionConflict(
      () => restarted.confirmFact({
        factId: seeded.factId,
        expectedRevision: 1,
        replaceExisting: true,
        expectedFieldRevision: 99,
      }),
      { currentFieldValue: 'Existing safe summary', fieldRevision: 1 },
    );

    const replaced = restarted.confirmFact({
      factId: seeded.factId,
      expectedRevision: 1,
      replaceExisting: true,
      expectedFieldRevision: 1,
    });
    expect(replaced).toMatchObject({ profileRevision: 2, fieldRevision: 2 });
    expect(getProfile(fixture).profile.companySummary).toBe('Extracted new summary');
    expect(fixture.projectionStore.getLedger(seeded.factId)).toMatchObject({
      action: KnowledgeFactProfileProjectionAction.ReplacedSingle,
      priorValue: 'Existing safe summary',
      appliedValue: 'Extracted new summary',
      appliedFieldRevision: 2,
    });
    fixture.db.close();
  });

  test.each(['', '  extracted   new SUMMARY  '])(
    'confirms an empty/equal normalized company summary without replacement (%j)',
    companySummary => {
      const fixture = createFixture({ profile: { ...emptyProfile(), companySummary } });
      const seeded = seedPendingFact(fixture, {
        domain: KnowledgeFactDomain.CompanySummary,
        value: 'Extracted new summary',
      });
      expect(() => fixture.projector.confirmFact({
        factId: seeded.factId,
        expectedRevision: 1,
      })).not.toThrow();
      expect(fixture.projectionStore.getLedger(seeded.factId)?.action).toBe(
        companySummary.trim()
          ? KnowledgeFactProfileProjectionAction.PreexistingSupport
          : KnowledgeFactProfileProjectionAction.Inserted,
      );
      fixture.db.close();
    },
  );

  test.each([
    { currentSummary: '', expectedCurrentSummary: '', label: 'cleared' },
    {
      currentSummary: '  extracted   new SUMMARY  ',
      expectedCurrentSummary: 'extracted   new SUMMARY',
      label: 'normalized-equal',
    },
  ])('rejects a stale replacement after the company summary was $label', ({
    currentSummary,
    expectedCurrentSummary,
  }) => {
    const fixture = createFixture({
      profile: { ...emptyProfile(), companySummary: 'Existing safe summary' },
    });
    const seeded = seedPendingFact(fixture, {
      domain: KnowledgeFactDomain.CompanySummary,
      value: 'Extracted new summary',
    });
    const beforeEdit = getProfile(fixture);
    fixture.workspaceStore.getProfileRevisionStore().compareAndSwapProfile({
      workspaceId: fixture.workspace.id,
      expectedProfileRevision: beforeEdit.profileRevision,
      nextProfile: { ...beforeEdit.profile, companySummary: currentSummary },
      touchedFields: [KnowledgeFactDomain.CompanySummary],
      now: NOW_3,
    });
    const beforeConflict = getProfile(fixture);
    const beforeOutboxCount = countRows(
      fixture.db,
      'knowledge_trusted_profile_index_jobs',
    );
    const beforeRequest = fixture.requestStore.getSummary(seeded.requestId);

    expectProjectionConflict(
      () => fixture.projector.confirmFact({
        factId: seeded.factId,
        expectedRevision: 1,
        replaceExisting: true,
        expectedFieldRevision: 1,
      }),
      {
        operation: KnowledgeFactProjectionOperation.Confirm,
        kind: KnowledgeFactProjectionConflictKind.CompanySummaryReplacement,
        currentFieldValue: expectedCurrentSummary,
        fieldRevision: 2,
      },
    );
    expect(getProfile(fixture)).toEqual(beforeConflict);
    expect(fixture.factStore.getFact(seeded.factId)).toMatchObject({ revision: 1 });
    expect(fixture.projectionStore.getLedger(seeded.factId)).toBeNull();
    expect(fixture.projectionStore.getSupportGroup(
      fixture.workspace.id,
      KnowledgeFactDomain.CompanySummary,
      'extracted new summary',
    )).toBeNull();
    expect(countRows(fixture.db, 'knowledge_trusted_profile_index_jobs'))
      .toBe(beforeOutboxCount);
    expect(fixture.requestStore.getSummary(seeded.requestId)).toEqual(beforeRequest);
    fixture.db.close();
  });
});

describe('EnterpriseLeadKnowledgeFactProjector archive and safe reversal', () => {
  test('archives a ledgerless cleanup conflict only with keep_current and preserves Profile', () => {
    const onTrustedRefreshCommitted = vi.fn();
    const fixture = createFixture({ onTrustedRefreshCommitted });
    fixture.db.exec('DROP INDEX idx_knowledge_facts_active_value');
    const root = seedPendingFact(fixture);
    fixture.projector.confirmFact({ factId: root.factId, expectedRevision: 1 });
    const later = seedPendingFact(fixture, {
      factId: 'fact-b',
      requestId: 'request-b',
    });
    fixture.projector.confirmFact({ factId: later.factId, expectedRevision: 1 });
    const profileBeforeCleanup = getProfile(fixture);
    const trustedWakeCountBeforeCleanup = onTrustedRefreshCommitted.mock.calls.length;
    const preservedRows = {
      evidence: (fixture.db.prepare(`
        SELECT COUNT(*) AS count FROM knowledge_fact_evidence WHERE fact_id = ?
      `).get(later.factId) as { count: number }).count,
      membership: (fixture.db.prepare(`
        SELECT COUNT(*) AS count FROM knowledge_enrichment_request_facts WHERE fact_id = ?
      `).get(later.factId) as { count: number }).count,
      request: (fixture.db.prepare(`
        SELECT COUNT(*) AS count FROM knowledge_enrichment_requests WHERE id = ?
      `).get(later.requestId) as { count: number }).count,
    };
    fixture.db.pragma('foreign_keys = OFF');
    fixture.db.prepare(`DELETE FROM knowledge_facts WHERE id = ?`).run(root.factId);
    fixture.db.prepare(`
      DELETE FROM knowledge_fact_profile_projection_ledger WHERE fact_id = ?
    `).run(root.factId);
    fixture.db.pragma('foreign_keys = ON');

    const deletedCount = fixture.db.transaction(() =>
      fixture.projectionStore.deleteParentlessProjectionsInCurrentTransaction(NOW_3))();
    const recovered = fixture.factStore.getFact(later.factId);
    expect(deletedCount).toBe(3);
    expect(recovered).toMatchObject({
      reviewStatus: KnowledgeFactReviewStatus.Confirmed,
      projectionState: KnowledgeFactProjectionState.Conflict,
      revision: 3,
      updatedAt: NOW_3,
      tombstonedAt: null,
    });
    expect(fixture.projectionStore.getLedger(later.factId)).toBeNull();
    expect(() => fixture.projector.archiveFact({
      factId: later.factId,
      expectedRevision: 2,
      projectionDecision: KnowledgeFactArchiveProjectionDecision.KeepCurrent,
    })).toThrow(expect.objectContaining({
      code: KnowledgeBaseErrorCode.FactRevisionConflict,
    }));
    expect(() => fixture.projector.archiveFact({
      factId: later.factId,
      expectedRevision: 3,
      projectionDecision: KnowledgeFactArchiveProjectionDecision.RemoveCurrent,
      expectedFieldRevision: fixture.workspaceStore.getProfileRevisionStore().getFieldRevision(
        fixture.workspace.id,
        KnowledgeFactDomain.ProductList,
      ),
    })).toThrow(expect.objectContaining({
      code: KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
    }));
    expect(fixture.factStore.getFact(later.factId)).toEqual(recovered);
    expect(getProfile(fixture)).toEqual(profileBeforeCleanup);

    const restartedProjector = new EnterpriseLeadKnowledgeFactProjector(
      fixture.db,
      fixture.factStore,
      fixture.projectionStore,
      fixture.workspaceStore.getProfileRevisionStore(),
      {
        clock: () => NOW_4,
        onTrustedRefreshCommitted,
      },
    );
    const archived = restartedProjector.archiveFact({
      factId: later.factId,
      expectedRevision: 3,
      projectionDecision: KnowledgeFactArchiveProjectionDecision.KeepCurrent,
    });

    expect(archived).toMatchObject({
      fact: {
        revision: 4,
        projectionState: KnowledgeFactProjectionState.Conflict,
        archivedAt: NOW_4,
      },
      profileChanged: false,
      profileRevision: null,
      fieldRevision: null,
    });
    expect(getProfile(fixture)).toEqual(profileBeforeCleanup);
    expect(onTrustedRefreshCommitted).toHaveBeenCalledTimes(trustedWakeCountBeforeCleanup);
    expect((fixture.db.prepare(`
      SELECT COUNT(*) AS count FROM knowledge_fact_evidence WHERE fact_id = ?
    `).get(later.factId) as { count: number }).count).toBe(preservedRows.evidence);
    expect((fixture.db.prepare(`
      SELECT COUNT(*) AS count FROM knowledge_enrichment_request_facts WHERE fact_id = ?
    `).get(later.factId) as { count: number }).count).toBe(preservedRows.membership);
    expect((fixture.db.prepare(`
      SELECT COUNT(*) AS count FROM knowledge_enrichment_requests WHERE id = ?
    `).get(later.requestId) as { count: number }).count).toBe(preservedRows.request);
    fixture.db.close();
  });

  test.each([
    { firstFactId: 'fact-a', secondFactId: 'fact-b', label: 'root first' },
    { firstFactId: 'fact-b', secondFactId: 'fact-a', label: 'later support first' },
  ])('migrates a legacy persisted root across clock regression and archives $label', ({
    firstFactId,
    secondFactId,
  }) => {
    const key = buildEnterpriseKnowledgeKey(
      KnowledgeFactDomain.ProductList,
      'Industrial robots',
    );
    const fixture = createFixture({
      profile: { ...emptyProfile(), ignoredKnowledgeKeys: [key] },
    });
    fixture.db.exec('DROP INDEX idx_knowledge_facts_active_value');
    const root = seedPendingFact(fixture);
    fixture.projector.confirmFact({ factId: root.factId, expectedRevision: 1 });
    const later = seedPendingFact(fixture, {
      factId: 'fact-b',
      requestId: 'request-b',
    });
    fixture.projector.confirmFact({ factId: later.factId, expectedRevision: 1 });
    fixture.db.prepare(`
      UPDATE knowledge_fact_profile_projection_ledger
      SET applied_at = CASE fact_id WHEN 'fact-a' THEN ? ELSE ? END
    `).run(NOW_3, NOW_1);
    fixture.db.exec(`
      ALTER TABLE knowledge_fact_profile_projection_ledger
      DROP COLUMN cycle_root_fact_id;
    `);

    const migratedStore = new KnowledgeFactProjectionStore(fixture.db);
    const restartedProjector = new EnterpriseLeadKnowledgeFactProjector(
      fixture.db,
      fixture.factStore,
      migratedStore,
      fixture.workspaceStore.getProfileRevisionStore(),
      { clock: () => NOW_2 },
    );
    restartedProjector.archiveFact({ factId: firstFactId, expectedRevision: 2 });
    restartedProjector.archiveFact({ factId: secondFactId, expectedRevision: 2 });

    expect(getProfile(fixture).profile.productList).toEqual([]);
    expect(getProfile(fixture).profile.confirmedKnowledgeKeys).toBeUndefined();
    expect(getProfile(fixture).profile.ignoredKnowledgeKeys).toEqual([key]);
    fixture.db.close();
  });

  test('restores the inserted root baseline when the root fact is archived before later support', () => {
    const key = buildEnterpriseKnowledgeKey(
      KnowledgeFactDomain.ProductList,
      'Industrial robots',
    );
    const fixture = createFixture({
      profile: { ...emptyProfile(), ignoredKnowledgeKeys: [key] },
    });
    fixture.db.exec('DROP INDEX idx_knowledge_facts_active_value');
    const root = seedPendingFact(fixture);
    fixture.projector.confirmFact({ factId: root.factId, expectedRevision: 1 });
    const later = seedPendingFact(fixture, {
      factId: 'fact-b',
      requestId: 'request-b',
    });
    fixture.projector.confirmFact({ factId: later.factId, expectedRevision: 1 });

    fixture.projector.archiveFact({ factId: root.factId, expectedRevision: 2 });
    const restartedProjectionStore = new KnowledgeFactProjectionStore(fixture.db);
    const restartedProjector = new EnterpriseLeadKnowledgeFactProjector(
      fixture.db,
      fixture.factStore,
      restartedProjectionStore,
      fixture.workspaceStore.getProfileRevisionStore(),
      { clock: () => NOW_2 },
    );
    restartedProjector.archiveFact({ factId: later.factId, expectedRevision: 2 });

    expect(getProfile(fixture).profile.productList).toEqual([]);
    expect(getProfile(fixture).profile.confirmedKnowledgeKeys).toBeUndefined();
    expect(getProfile(fixture).profile.ignoredKnowledgeKeys).toEqual([key]);
    fixture.db.close();
  });

  test('restores the inserted root baseline when later support is archived first', () => {
    const key = buildEnterpriseKnowledgeKey(
      KnowledgeFactDomain.ProductList,
      'Industrial robots',
    );
    const fixture = createFixture({
      profile: { ...emptyProfile(), ignoredKnowledgeKeys: [key] },
    });
    fixture.db.exec('DROP INDEX idx_knowledge_facts_active_value');
    const root = seedPendingFact(fixture);
    fixture.projector.confirmFact({ factId: root.factId, expectedRevision: 1 });
    const later = seedPendingFact(fixture, {
      factId: 'fact-b',
      requestId: 'request-b',
    });
    fixture.projector.confirmFact({ factId: later.factId, expectedRevision: 1 });

    fixture.projector.archiveFact({ factId: later.factId, expectedRevision: 2 });
    fixture.projector.archiveFact({ factId: root.factId, expectedRevision: 2 });

    expect(getProfile(fixture).profile.productList).toEqual([]);
    expect(getProfile(fixture).profile.confirmedKnowledgeKeys).toBeUndefined();
    expect(getProfile(fixture).profile.ignoredKnowledgeKeys).toEqual([key]);
    fixture.db.close();
  });

  test('fails archive safely and without writes when a later support is corrupted into the root', () => {
    const key = buildEnterpriseKnowledgeKey(
      KnowledgeFactDomain.ProductList,
      'Industrial robots',
    );
    const fixture = createFixture({
      profile: { ...emptyProfile(), ignoredKnowledgeKeys: [key] },
    });
    fixture.db.exec('DROP INDEX idx_knowledge_facts_active_value');
    const root = seedPendingFact(fixture);
    fixture.projector.confirmFact({ factId: root.factId, expectedRevision: 1 });
    const later = seedPendingFact(fixture, {
      factId: 'fact-b',
      requestId: 'request-b',
    });
    fixture.projector.confirmFact({ factId: later.factId, expectedRevision: 1 });
    fixture.projector.archiveFact({ factId: root.factId, expectedRevision: 2 });
    fixture.db.prepare(`
      UPDATE knowledge_fact_projection_support_group_roots
      SET root_fact_id = ?
      WHERE workspace_id = ? AND domain = ? AND normalized_value = ?
    `).run(
      later.factId,
      fixture.workspace.id,
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    );
    const before = {
      workspace: getProfile(fixture),
      fact: fixture.factStore.getFact(later.factId),
      request: fixture.requestStore.getSummary(later.requestId),
      outboxCount: countRows(fixture.db, 'knowledge_trusted_profile_index_jobs'),
      groups: fixture.db.prepare(`
        SELECT * FROM knowledge_fact_projection_support_groups
        ORDER BY workspace_id, domain, normalized_value
      `).all(),
      roots: fixture.db.prepare(`
        SELECT * FROM knowledge_fact_projection_support_group_roots
        ORDER BY workspace_id, domain, normalized_value
      `).all(),
      ledgers: fixture.db.prepare(`
        SELECT * FROM knowledge_fact_profile_projection_ledger
        ORDER BY fact_id
      `).all(),
    };

    let thrown: unknown;
    try {
      fixture.projector.archiveFact({ factId: later.factId, expectedRevision: 2 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KnowledgeFactProjectorError);
    expect(JSON.parse(JSON.stringify(thrown))).toEqual({
      code: KnowledgeBaseErrorCode.EnrichmentPersistenceFailed,
      message: 'Knowledge fact review failed',
    });
    expect(thrown).not.toHaveProperty('cause');
    expect(thrown).not.toHaveProperty('stack');
    expect(getProfile(fixture)).toEqual(before.workspace);
    expect(fixture.factStore.getFact(later.factId)).toEqual(before.fact);
    expect(fixture.requestStore.getSummary(later.requestId)).toEqual(before.request);
    expect(countRows(fixture.db, 'knowledge_trusted_profile_index_jobs'))
      .toBe(before.outboxCount);
    expect(fixture.db.prepare(`
      SELECT * FROM knowledge_fact_projection_support_groups
      ORDER BY workspace_id, domain, normalized_value
    `).all()).toEqual(before.groups);
    expect(fixture.db.prepare(`
      SELECT * FROM knowledge_fact_projection_support_group_roots
      ORDER BY workspace_id, domain, normalized_value
    `).all()).toEqual(before.roots);
    expect(fixture.db.prepare(`
      SELECT * FROM knowledge_fact_profile_projection_ledger
      ORDER BY fact_id
    `).all()).toEqual(before.ledgers);
    fixture.db.close();
  });

  test('restores the replaced root baseline when the root fact is archived before later support', () => {
    const fixture = createFixture({
      profile: { ...emptyProfile(), companySummary: 'Prior company summary' },
    });
    fixture.db.exec('DROP INDEX idx_knowledge_facts_active_value');
    const root = seedPendingFact(fixture, {
      domain: KnowledgeFactDomain.CompanySummary,
      value: 'Applied company summary',
    });
    fixture.projector.confirmFact({
      factId: root.factId,
      expectedRevision: 1,
      replaceExisting: true,
      expectedFieldRevision: 1,
    });
    const later = seedPendingFact(fixture, {
      factId: 'fact-b',
      requestId: 'request-b',
      domain: KnowledgeFactDomain.CompanySummary,
      value: 'Applied company summary',
    });
    fixture.projector.confirmFact({ factId: later.factId, expectedRevision: 1 });

    fixture.projector.archiveFact({ factId: root.factId, expectedRevision: 2 });
    fixture.projector.archiveFact({ factId: later.factId, expectedRevision: 2 });

    expect(getProfile(fixture).profile.companySummary).toBe('Prior company summary');
    fixture.db.close();
  });

  test('restores the replaced root baseline when later support is archived first', () => {
    const fixture = createFixture({
      profile: { ...emptyProfile(), companySummary: 'Prior company summary' },
    });
    fixture.db.exec('DROP INDEX idx_knowledge_facts_active_value');
    const root = seedPendingFact(fixture, {
      domain: KnowledgeFactDomain.CompanySummary,
      value: 'Applied company summary',
    });
    fixture.projector.confirmFact({
      factId: root.factId,
      expectedRevision: 1,
      replaceExisting: true,
      expectedFieldRevision: 1,
    });
    const later = seedPendingFact(fixture, {
      factId: 'fact-b',
      requestId: 'request-b',
      domain: KnowledgeFactDomain.CompanySummary,
      value: 'Applied company summary',
    });
    fixture.projector.confirmFact({ factId: later.factId, expectedRevision: 1 });

    fixture.projector.archiveFact({ factId: later.factId, expectedRevision: 2 });
    fixture.projector.archiveFact({ factId: root.factId, expectedRevision: 2 });

    expect(getProfile(fixture).profile.companySummary).toBe('Prior company summary');
    fixture.db.close();
  });

  test('decrements a shared support group but retains the inserted value and confirmed trust', () => {
    const fixture = createFixture();
    fixture.db.exec('DROP INDEX idx_knowledge_facts_active_value');
    const seeded = seedPendingFact(fixture);
    fixture.projector.confirmFact({ factId: seeded.factId, expectedRevision: 1 });
    const later = seedPendingFact(fixture, {
      factId: 'fact-b',
      requestId: 'request-b',
    });
    fixture.projector.confirmFact({ factId: later.factId, expectedRevision: 1 });

    fixture.projector.archiveFact({ factId: seeded.factId, expectedRevision: 2 });
    const key = buildEnterpriseKnowledgeKey(
      KnowledgeFactDomain.ProductList,
      'Industrial robots',
    );
    expect(getProfile(fixture).profile.productList).toEqual(['Industrial robots']);
    expect(getProfile(fixture).profile.confirmedKnowledgeKeys).toEqual([key]);
    expect(fixture.projectionStore.getSupportGroup(
      fixture.workspace.id,
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.activeSupportCount).toBe(1);
    fixture.db.close();
  });

  test('never removes a preexisting manual value and restores its prior ignored trust state', () => {
    const key = buildEnterpriseKnowledgeKey(KnowledgeFactDomain.ProductList, 'Industrial robots');
    const fixture = createFixture({
      profile: {
        ...emptyProfile(),
        productList: ['Industrial robots'],
        ignoredKnowledgeKeys: [key],
      },
    });
    const seeded = seedPendingFact(fixture);
    fixture.projector.confirmFact({ factId: seeded.factId, expectedRevision: 1 });
    const archived = fixture.projector.archiveFact({ factId: seeded.factId, expectedRevision: 2 });

    expect(archived.fact).toMatchObject({
      revision: 3,
      archivedAt: NOW_2,
      projectionState: KnowledgeFactProjectionState.Reversed,
    });
    expect(getProfile(fixture).profile.productList).toEqual(['Industrial robots']);
    expect(getProfile(fixture).profile.confirmedKnowledgeKeys).toBeUndefined();
    expect(getProfile(fixture).profile.ignoredKnowledgeKeys).toEqual([key]);
    expect(fixture.projectionStore.getLedger(seeded.factId)?.reversedAt).toBe(NOW_2);
    expect(fixture.projectionStore.getSupportGroup(
      fixture.workspace.id,
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.activeSupportCount).toBe(0);
    expect(countRows(fixture.db, 'knowledge_fact_evidence')).toBe(1);
    fixture.db.close();
  });

  test('removes an inserted value after unrelated-field edit by using fresh global revision', () => {
    const fixture = createFixture();
    const seeded = seedPendingFact(fixture);
    fixture.projector.confirmFact({ factId: seeded.factId, expectedRevision: 1 });
    const afterConfirm = getProfile(fixture);
    fixture.workspaceStore.getProfileRevisionStore().compareAndSwapProfile({
      workspaceId: fixture.workspace.id,
      expectedProfileRevision: afterConfirm.profileRevision,
      nextProfile: { ...afterConfirm.profile, contactRules: ['Email only'] },
      touchedFields: [KnowledgeFactDomain.ContactRules],
      now: NOW_3,
    });

    const archived = fixture.projector.archiveFact({ factId: seeded.factId, expectedRevision: 2 });
    expect(archived).toMatchObject({
      profileChanged: true,
      profileRevision: 4,
      fieldRevision: 3,
    });
    const workspace = getProfile(fixture);
    expect(workspace.profile.productList).toEqual([]);
    expect(workspace.profile.contactRules).toEqual(['Email only']);
    fixture.db.close();
  });

  test('returns a no-write same-field conflict, then keep_current preserves value and restores trust', () => {
    const fixture = createFixture();
    const seeded = seedPendingFact(fixture);
    fixture.projector.confirmFact({ factId: seeded.factId, expectedRevision: 1 });
    const afterConfirm = getProfile(fixture);
    fixture.workspaceStore.getProfileRevisionStore().compareAndSwapProfile({
      workspaceId: fixture.workspace.id,
      expectedProfileRevision: afterConfirm.profileRevision,
      nextProfile: {
        ...afterConfirm.profile,
        productList: [...afterConfirm.profile.productList, 'Manual addition'],
      },
      touchedFields: [KnowledgeFactDomain.ProductList],
      now: NOW_3,
    });
    const beforeConflict = getProfile(fixture);
    const beforeJobs = countRows(fixture.db, 'knowledge_trusted_profile_index_jobs');
    expectProjectionConflict(
      () => fixture.projector.archiveFact({ factId: seeded.factId, expectedRevision: 2 }),
      {
        operation: KnowledgeFactProjectionOperation.Archive,
        kind: KnowledgeFactProjectionConflictKind.ArchiveFieldChanged,
        currentFieldValue: ['Industrial robots', 'Manual addition'],
        fieldRevision: 3,
      },
    );
    expect(getProfile(fixture)).toEqual(beforeConflict);
    expect(fixture.factStore.getFact(seeded.factId)).toMatchObject({ revision: 2 });
    expect(fixture.projectionStore.getLedger(seeded.factId)?.reversedAt).toBeNull();
    expect(countRows(fixture.db, 'knowledge_trusted_profile_index_jobs')).toBe(beforeJobs);

    const archived = fixture.projector.archiveFact({
      factId: seeded.factId,
      expectedRevision: 2,
      projectionDecision: KnowledgeFactArchiveProjectionDecision.KeepCurrent,
    });
    expect(archived.fact).toMatchObject({ revision: 3, archivedAt: NOW_2 });
    expect(getProfile(fixture).profile.productList)
      .toEqual(['Industrial robots', 'Manual addition']);
    expect(getProfile(fixture).profile.confirmedKnowledgeKeys).toBeUndefined();
    fixture.db.close();
  });

  test('remove_current requires the displayed field revision, preserves other values, and refreshes stale conflicts', () => {
    const fixture = createFixture();
    const seeded = seedPendingFact(fixture);
    fixture.projector.confirmFact({ factId: seeded.factId, expectedRevision: 1 });
    let workspace = getProfile(fixture);
    fixture.workspaceStore.getProfileRevisionStore().compareAndSwapProfile({
      workspaceId: fixture.workspace.id,
      expectedProfileRevision: workspace.profileRevision,
      nextProfile: {
        ...workspace.profile,
        productList: [...workspace.profile.productList, 'Manual addition'],
      },
      touchedFields: [KnowledgeFactDomain.ProductList],
      now: NOW_3,
    });
    expectProjectionConflict(
      () => fixture.projector.archiveFact({ factId: seeded.factId, expectedRevision: 2 }),
      { fieldRevision: 3 },
    );

    workspace = getProfile(fixture);
    fixture.workspaceStore.getProfileRevisionStore().compareAndSwapProfile({
      workspaceId: fixture.workspace.id,
      expectedProfileRevision: workspace.profileRevision,
      nextProfile: {
        ...workspace.profile,
        productList: [...workspace.profile.productList, 'Concurrent same-field value'],
      },
      touchedFields: [KnowledgeFactDomain.ProductList],
      now: NOW_3,
    });
    expectProjectionConflict(
      () => fixture.projector.archiveFact({
        factId: seeded.factId,
        expectedRevision: 2,
        projectionDecision: KnowledgeFactArchiveProjectionDecision.RemoveCurrent,
        expectedFieldRevision: 3,
      }),
      {
        currentFieldValue: [
          'Industrial robots',
          'Manual addition',
          'Concurrent same-field value',
        ],
        fieldRevision: 4,
      },
    );
    expect(fixture.factStore.getFact(seeded.factId)).toMatchObject({ revision: 2 });

    const removed = fixture.projector.archiveFact({
      factId: seeded.factId,
      expectedRevision: 2,
      projectionDecision: KnowledgeFactArchiveProjectionDecision.RemoveCurrent,
      expectedFieldRevision: 4,
    });
    expect(removed.fact).toMatchObject({ revision: 3, archivedAt: NOW_2 });
    expect(getProfile(fixture).profile.productList).toEqual([
      'Manual addition',
      'Concurrent same-field value',
    ]);
    fixture.db.close();
  });

  test('restores a replaced company summary only while the applied value remains current', () => {
    const fixture = createFixture({
      profile: { ...emptyProfile(), companySummary: 'Prior company summary' },
    });
    const seeded = seedPendingFact(fixture, {
      domain: KnowledgeFactDomain.CompanySummary,
      value: 'Applied company summary',
    });
    fixture.projector.confirmFact({
      factId: seeded.factId,
      expectedRevision: 1,
      replaceExisting: true,
      expectedFieldRevision: 1,
    });
    fixture.projector.archiveFact({ factId: seeded.factId, expectedRevision: 2 });
    expect(getProfile(fixture).profile.companySummary).toBe('Prior company summary');
    expect(fixture.projectionStore.getLedger(seeded.factId)).toMatchObject({
      action: KnowledgeFactProfileProjectionAction.ReplacedSingle,
      reversedAt: NOW_2,
    });
    fixture.db.close();
  });

  test.each([
    KnowledgeFactProjectorStage.AfterRevalidationBeforeFirstWrite,
    KnowledgeFactProjectorStage.AfterProfileChange,
    KnowledgeFactProjectorStage.AfterProjectionChange,
    KnowledgeFactProjectorStage.AfterFactTransition,
    KnowledgeFactProjectorStage.AfterRequestRecalculation,
  ])('rolls archive/reversal fully back after fault stage %s', faultStage => {
    let archiveFaultsEnabled = false;
    const fixture = createFixture({
      onStage: stage => {
        if (archiveFaultsEnabled && stage === faultStage) {
          throw new Error('SECRET archive fault SQL /private/path evidence');
        }
      },
    });
    const seeded = seedPendingFact(fixture);
    fixture.projector.confirmFact({ factId: seeded.factId, expectedRevision: 1 });
    archiveFaultsEnabled = true;
    const beforeProfile = getProfile(fixture);
    const beforeJobs = countRows(fixture.db, 'knowledge_trusted_profile_index_jobs');

    let thrown: unknown;
    try {
      fixture.projector.archiveFact({ factId: seeded.factId, expectedRevision: 2 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KnowledgeFactProjectorError);
    expect(thrown).toMatchObject({ code: KnowledgeBaseErrorCode.EnrichmentPersistenceFailed });
    expect(getProfile(fixture)).toEqual(beforeProfile);
    expect(fixture.factStore.getFact(seeded.factId)).toMatchObject({
      revision: 2,
      tombstonedAt: null,
      projectionState: KnowledgeFactProjectionState.Active,
    });
    expect(fixture.projectionStore.getLedger(seeded.factId)?.reversedAt).toBeNull();
    expect(fixture.projectionStore.getSupportGroup(
      fixture.workspace.id,
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.activeSupportCount).toBe(1);
    expect(countRows(fixture.db, 'knowledge_trusted_profile_index_jobs')).toBe(beforeJobs);
    expect(JSON.stringify(thrown)).not.toContain('SECRET');
    fixture.db.close();
  });

  test.each([
    KnowledgeFactArchiveProjectionDecision.KeepCurrent,
    KnowledgeFactArchiveProjectionDecision.RemoveCurrent,
  ])('does not lose a newer company summary after replaced projection conflict with %s', decision => {
    const fixture = createFixture({
      profile: { ...emptyProfile(), companySummary: 'Prior company summary' },
    });
    const seeded = seedPendingFact(fixture, {
      domain: KnowledgeFactDomain.CompanySummary,
      value: 'Applied company summary',
    });
    fixture.projector.confirmFact({
      factId: seeded.factId,
      expectedRevision: 1,
      replaceExisting: true,
      expectedFieldRevision: 1,
    });
    const afterConfirm = getProfile(fixture);
    fixture.workspaceStore.getProfileRevisionStore().compareAndSwapProfile({
      workspaceId: fixture.workspace.id,
      expectedProfileRevision: afterConfirm.profileRevision,
      nextProfile: { ...afterConfirm.profile, companySummary: 'Newer manual summary' },
      touchedFields: [KnowledgeFactDomain.CompanySummary],
      now: NOW_3,
    });
    expectProjectionConflict(
      () => fixture.projector.archiveFact({ factId: seeded.factId, expectedRevision: 2 }),
      { currentFieldValue: 'Newer manual summary', fieldRevision: 3 },
    );

    fixture.projector.archiveFact({
      factId: seeded.factId,
      expectedRevision: 2,
      projectionDecision: decision,
      ...(decision === KnowledgeFactArchiveProjectionDecision.RemoveCurrent
        ? { expectedFieldRevision: 3 }
        : {}),
    });
    expect(getProfile(fixture).profile.companySummary).toBe('Newer manual summary');
    fixture.db.close();
  });
});

describe('EnterpriseLeadKnowledgeFactProjector WAL whole-transaction retry', () => {
  test('retries after an unrelated concurrent Profile write and re-reads the fresh global revision', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'task9-projector-wal-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'knowledge.sqlite');
    const dbA = new Database(filePath);
    applySqliteConnectionPolicy(dbA);
    dbA.pragma('journal_mode = WAL');
    dbA.pragma('busy_timeout = 0');
    let fixtureB: ReturnType<typeof createFixture> | null = null;
    let attempts = 0;
    const onTrustedRefreshCommitted = vi.fn(() => {
      expect(dbA.inTransaction).toBe(false);
    });
    const fixtureA = createFixture({
      db: dbA,
      onTrustedRefreshCommitted,
      onStage: stage => {
        if (
          stage === KnowledgeFactProjectorStage.AfterRevalidationBeforeFirstWrite &&
          attempts++ === 0
        ) {
          const current = fixtureB!.workspaceStore.getWorkspace(fixtureA.workspace.id)!;
          fixtureB!.workspaceStore.getProfileRevisionStore().compareAndSwapProfile({
            workspaceId: fixtureA.workspace.id,
            expectedProfileRevision: current.profileRevision,
            nextProfile: { ...current.profile, contactRules: ['Concurrent email only'] },
            touchedFields: [KnowledgeFactDomain.ContactRules],
            now: NOW_3,
          });
        }
      },
    });
    const seeded = seedPendingFact(fixtureA);
    const dbB = new Database(filePath);
    applySqliteConnectionPolicy(dbB);
    dbB.pragma('journal_mode = WAL');
    dbB.pragma('busy_timeout = 0');
    const workspaceStoreB = new EnterpriseLeadWorkspaceStore(dbB);
    const requestStoreB = new KnowledgeEnrichmentRequestStore(dbB, { clock: () => NOW_1 });
    const documentStoreB = new KnowledgeDocumentStore(dbB);
    const factStoreB = new KnowledgeFactStore(dbB, { requestStore: requestStoreB });
    const projectionStoreB = new KnowledgeFactProjectionStore(dbB);
    fixtureB = {
      db: dbB,
      documentStore: documentStoreB,
      factStore: factStoreB,
      projectionStore: projectionStoreB,
      projector: new EnterpriseLeadKnowledgeFactProjector(
        dbB,
        factStoreB,
        projectionStoreB,
        workspaceStoreB.getProfileRevisionStore(),
      ),
      requestStore: requestStoreB,
      workspace: fixtureA.workspace,
      workspaceStore: workspaceStoreB,
    };

    const result = fixtureA.projector.confirmFact({ factId: seeded.factId, expectedRevision: 1 });
    expect(attempts).toBe(2);
    expect(result).toMatchObject({ profileRevision: 3, fieldRevision: 2 });
    expect(getProfile(fixtureA).profile.contactRules).toEqual(['Concurrent email only']);
    expect(getProfile(fixtureA).profile.productList).toEqual(['Industrial robots']);
    expect(countRows(dbA, 'knowledge_fact_profile_projection_ledger')).toBe(1);
    expect(onTrustedRefreshCommitted).toHaveBeenCalledTimes(1);
    fixtureB.db.close();
    fixtureA.db.close();
  });

  test('retries archive after a concurrent same-field write and returns a fresh no-write conflict', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'task9-archive-wal-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'knowledge.sqlite');
    const dbA = new Database(filePath);
    applySqliteConnectionPolicy(dbA);
    dbA.pragma('journal_mode = WAL');
    dbA.pragma('busy_timeout = 0');
    let fixtureB: ReturnType<typeof createFixture> | null = null;
    let raceEnabled = false;
    let concurrentWriteCount = 0;
    const onTrustedRefreshCommitted = vi.fn();
    const fixtureA = createFixture({
      db: dbA,
      onTrustedRefreshCommitted,
      onStage: stage => {
        if (
          raceEnabled &&
          stage === KnowledgeFactProjectorStage.AfterRevalidationBeforeFirstWrite &&
          concurrentWriteCount++ === 0
        ) {
          const current = fixtureB!.workspaceStore.getWorkspace(fixtureA.workspace.id)!;
          fixtureB!.workspaceStore.getProfileRevisionStore().compareAndSwapProfile({
            workspaceId: fixtureA.workspace.id,
            expectedProfileRevision: current.profileRevision,
            nextProfile: {
              ...current.profile,
              productList: [...current.profile.productList, 'Concurrent manual addition'],
            },
            touchedFields: [KnowledgeFactDomain.ProductList],
            now: NOW_3,
          });
        }
      },
    });
    const seeded = seedPendingFact(fixtureA);
    fixtureA.projector.confirmFact({ factId: seeded.factId, expectedRevision: 1 });
    expect(onTrustedRefreshCommitted).toHaveBeenCalledTimes(1);
    onTrustedRefreshCommitted.mockClear();

    const dbB = new Database(filePath);
    applySqliteConnectionPolicy(dbB);
    dbB.pragma('journal_mode = WAL');
    dbB.pragma('busy_timeout = 0');
    const workspaceStoreB = new EnterpriseLeadWorkspaceStore(dbB);
    const requestStoreB = new KnowledgeEnrichmentRequestStore(dbB, { clock: () => NOW_1 });
    const documentStoreB = new KnowledgeDocumentStore(dbB);
    const factStoreB = new KnowledgeFactStore(dbB, { requestStore: requestStoreB });
    const projectionStoreB = new KnowledgeFactProjectionStore(dbB);
    fixtureB = {
      db: dbB,
      documentStore: documentStoreB,
      factStore: factStoreB,
      projectionStore: projectionStoreB,
      projector: new EnterpriseLeadKnowledgeFactProjector(
        dbB,
        factStoreB,
        projectionStoreB,
        workspaceStoreB.getProfileRevisionStore(),
      ),
      requestStore: requestStoreB,
      workspace: fixtureA.workspace,
      workspaceStore: workspaceStoreB,
    };
    raceEnabled = true;

    expectProjectionConflict(
      () => fixtureA.projector.archiveFact({ factId: seeded.factId, expectedRevision: 2 }),
      {
        operation: KnowledgeFactProjectionOperation.Archive,
        kind: KnowledgeFactProjectionConflictKind.ArchiveFieldChanged,
        currentFieldValue: ['Industrial robots', 'Concurrent manual addition'],
        fieldRevision: 3,
      },
    );
    expect(concurrentWriteCount).toBe(1);
    expect(fixtureA.factStore.getFact(seeded.factId)).toMatchObject({
      revision: 2,
      tombstonedAt: null,
      projectionState: KnowledgeFactProjectionState.Active,
    });
    expect(fixtureA.projectionStore.getLedger(seeded.factId)?.reversedAt).toBeNull();
    expect(fixtureA.projectionStore.getSupportGroup(
      fixtureA.workspace.id,
      KnowledgeFactDomain.ProductList,
      'industrial robots',
    )?.activeSupportCount).toBe(1);
    expect(getProfile(fixtureA).profile.productList)
      .toEqual(['Industrial robots', 'Concurrent manual addition']);
    expect(onTrustedRefreshCommitted).not.toHaveBeenCalled();
    fixtureB.db.close();
    fixtureA.db.close();
  });
});
