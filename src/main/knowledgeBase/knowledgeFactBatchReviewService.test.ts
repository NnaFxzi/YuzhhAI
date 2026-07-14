import { describe, expect, test, vi } from 'vitest';

import {
  KnowledgeBaseErrorCode,
  KnowledgeFactBatchAction,
  KnowledgeFactBatchSkipReason,
  KnowledgeFactBatchTaskStatus,
  KnowledgeFactDomain,
  KnowledgeFactEvidenceState,
  KnowledgeFactListView,
  KnowledgeFactProjectionConflictKind,
  KnowledgeFactProjectionOperation,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
} from '../../shared/knowledgeBase/constants';
import type { KnowledgeFactSummary } from '../../shared/knowledgeBase/types';
import {
  KnowledgeFactProjectionConflictError,
  KnowledgeFactProjectorError,
} from './enterpriseLeadKnowledgeFactProjector';
import { createKnowledgeFactBatchReviewService } from './knowledgeFactBatchReviewService';

const createFactSummary = (
  id: string,
  revision: number,
  value = `Fact value ${id}`,
): KnowledgeFactSummary => ({
  id,
  domain: KnowledgeFactDomain.CompanySummary,
  value,
  reviewStatus: KnowledgeFactReviewStatus.Pending,
  sourceKind: KnowledgeFactSourceKind.Extracted,
  revision,
  projectionState: KnowledgeFactProjectionState.None,
  activeEvidenceCount: 1,
  staleEvidenceCount: 0,
  evidencePreview: null,
  createdAt: '2026-07-14T00:00:00.000Z',
  reviewedAt: null,
  updatedAt: '2026-07-14T00:00:00.000Z',
  archivedAt: null,
});

describe('createKnowledgeFactBatchReviewService', () => {
  test('starts a queued task and processes matching-filter pages sequentially', async () => {
    const listFacts = vi
      .fn()
      .mockReturnValueOnce({
        items: [createFactSummary('fact-1', 11, 'First value')],
        nextCursor: 'cursor-1',
        metrics: {
          activePendingCount: 1,
          activeConfirmedCount: 0,
          staleConfirmedCount: 0,
          rejectedHistoryCount: 0,
          archivedHistoryCount: 0,
          unduplicatedLegacyConfirmedCount: 0,
          totalAiKnowledgeCount: 1,
        },
      })
      .mockReturnValueOnce({
        items: [createFactSummary('fact-2', 12, 'Second value')],
        nextCursor: null,
        metrics: {
          activePendingCount: 1,
          activeConfirmedCount: 0,
          staleConfirmedCount: 0,
          rejectedHistoryCount: 0,
          archivedHistoryCount: 0,
          unduplicatedLegacyConfirmedCount: 0,
          totalAiKnowledgeCount: 1,
        },
      });
    const confirmFact = vi.fn(() => ({
      fact: createFactSummary('confirmed', 1),
      profileChanged: false,
      profileRevision: null,
      fieldRevision: null,
    }));
    const service = createKnowledgeFactBatchReviewService({
      queryService: { listFacts },
      projector: {
        confirmFact,
        rejectFact: vi.fn(),
        archiveFact: vi.fn(),
      },
    });

    const task = service.start({
      workspaceId: 'workspace-a',
      action: KnowledgeFactBatchAction.Confirm,
      selection: {
        kind: 'matching_filters',
        filters: {
          view: KnowledgeFactListView.Active,
          reviewStatuses: [KnowledgeFactReviewStatus.Pending],
          evidenceState: KnowledgeFactEvidenceState.Any,
        },
      },
    });

    expect(task).toMatchObject({
      workspaceId: 'workspace-a',
      action: KnowledgeFactBatchAction.Confirm,
      status: KnowledgeFactBatchTaskStatus.Queued,
      totalCount: 0,
      processedCount: 0,
      successCount: 0,
      skippedCount: 0,
      failedCount: 0,
      details: [],
      startedAt: null,
      completedAt: null,
    });

    await service.waitForIdle(task.taskId);

    expect(listFacts).toHaveBeenNthCalledWith(1, {
      workspaceId: 'workspace-a',
      view: KnowledgeFactListView.Active,
      reviewStatuses: [KnowledgeFactReviewStatus.Pending],
      evidenceState: KnowledgeFactEvidenceState.Any,
      cursor: undefined,
      limit: 100,
    });
    expect(listFacts).toHaveBeenNthCalledWith(2, {
      workspaceId: 'workspace-a',
      view: KnowledgeFactListView.Active,
      reviewStatuses: [KnowledgeFactReviewStatus.Pending],
      evidenceState: KnowledgeFactEvidenceState.Any,
      cursor: 'cursor-1',
      limit: 100,
    });
    expect(confirmFact.mock.calls).toEqual([
      [{ factId: 'fact-1', expectedRevision: 11 }],
      [{ factId: 'fact-2', expectedRevision: 12 }],
    ]);
    expect(service.getStatus(task.taskId)).toMatchObject({
      status: KnowledgeFactBatchTaskStatus.Completed,
      totalCount: 2,
      processedCount: 2,
      successCount: 2,
      skippedCount: 0,
      failedCount: 0,
    });
  });

  test('maps fact evidence stale to a non-retryable skipped detail', async () => {
    const service = createKnowledgeFactBatchReviewService({
      queryService: { listFacts: vi.fn() },
      projector: {
        confirmFact: vi.fn(() => {
          throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.FactEvidenceStale);
        }),
        rejectFact: vi.fn(),
        archiveFact: vi.fn(),
      },
    });

    const task = service.start({
      workspaceId: 'workspace-a',
      action: KnowledgeFactBatchAction.Confirm,
      selection: {
        kind: 'fact_ids',
        items: [{ factId: 'fact-stale', expectedRevision: 3 }],
      },
    });

    await service.waitForIdle(task.taskId);

    expect(service.getStatus(task.taskId)).toMatchObject({
      status: KnowledgeFactBatchTaskStatus.Completed,
      totalCount: 1,
      processedCount: 1,
      successCount: 0,
      skippedCount: 1,
      failedCount: 0,
      skippedByReason: {
        [KnowledgeFactBatchSkipReason.NoActiveEvidence]: 1,
      },
      details: [{
        factId: 'fact-stale',
        valuePreview: null,
        code: KnowledgeFactBatchSkipReason.NoActiveEvidence,
        retryable: false,
      }],
    });
  });

  test('maps fact revision conflict to a retryable skipped detail', async () => {
    const rejectFact = vi.fn(() => {
      throw new KnowledgeFactProjectorError(KnowledgeBaseErrorCode.FactRevisionConflict);
    });
    const service = createKnowledgeFactBatchReviewService({
      queryService: { listFacts: vi.fn() },
      projector: {
        confirmFact: vi.fn(),
        rejectFact,
        archiveFact: vi.fn(),
      },
    });

    const task = service.start({
      workspaceId: 'workspace-a',
      action: KnowledgeFactBatchAction.Reject,
      selection: {
        kind: 'fact_ids',
        items: [{ factId: 'fact-conflict', expectedRevision: 4 }],
      },
    });

    await service.waitForIdle(task.taskId);

    expect(rejectFact).toHaveBeenCalledWith({ factId: 'fact-conflict', expectedRevision: 4 });
    expect(service.getStatus(task.taskId)).toMatchObject({
      status: KnowledgeFactBatchTaskStatus.Completed,
      skippedCount: 1,
      failedCount: 0,
      skippedByReason: {
        [KnowledgeFactBatchSkipReason.RevisionConflict]: 1,
      },
      details: [{
        factId: 'fact-conflict',
        valuePreview: null,
        code: KnowledgeFactBatchSkipReason.RevisionConflict,
        retryable: true,
      }],
    });
  });

  test('maps projection conflicts to non-retryable skipped details', async () => {
    const archiveFact = vi.fn(() => {
      throw new KnowledgeFactProjectionConflictError({
        operation: KnowledgeFactProjectionOperation.Archive,
        kind: KnowledgeFactProjectionConflictKind.ArchiveFieldChanged,
        factId: 'fact-projection',
        factRevision: 7,
        domain: KnowledgeFactDomain.CompanySummary,
        currentFieldValue: 'Current summary',
        fieldRevision: 9,
      });
    });
    const service = createKnowledgeFactBatchReviewService({
      queryService: { listFacts: vi.fn() },
      projector: {
        confirmFact: vi.fn(),
        rejectFact: vi.fn(),
        archiveFact,
      },
    });

    const task = service.start({
      workspaceId: 'workspace-a',
      action: KnowledgeFactBatchAction.Archive,
      selection: {
        kind: 'fact_ids',
        items: [{ factId: 'fact-projection', expectedRevision: 7 }],
      },
    });

    await service.waitForIdle(task.taskId);

    expect(archiveFact).toHaveBeenCalledWith({ factId: 'fact-projection', expectedRevision: 7 });
    expect(service.getStatus(task.taskId)).toMatchObject({
      status: KnowledgeFactBatchTaskStatus.Completed,
      skippedCount: 1,
      failedCount: 0,
      skippedByReason: {
        [KnowledgeFactBatchSkipReason.ProjectionConflict]: 1,
      },
      details: [{
        factId: 'fact-projection',
        valuePreview: null,
        code: KnowledgeFactBatchSkipReason.ProjectionConflict,
        retryable: false,
      }],
    });
  });

  test('continues after unknown projector failures without undoing prior successes', async () => {
    const confirmFact = vi
      .fn()
      .mockReturnValueOnce({
        fact: createFactSummary('fact-1', 1),
        profileChanged: false,
        profileRevision: null,
        fieldRevision: null,
      })
      .mockImplementationOnce(() => {
        throw new Error('network wobble');
      })
      .mockReturnValueOnce({
        fact: createFactSummary('fact-3', 3),
        profileChanged: false,
        profileRevision: null,
        fieldRevision: null,
      });
    const service = createKnowledgeFactBatchReviewService({
      queryService: { listFacts: vi.fn() },
      projector: {
        confirmFact,
        rejectFact: vi.fn(),
        archiveFact: vi.fn(),
      },
    });

    const task = service.start({
      workspaceId: 'workspace-a',
      action: KnowledgeFactBatchAction.Confirm,
      selection: {
        kind: 'fact_ids',
        items: [
          { factId: 'fact-1', expectedRevision: 1 },
          { factId: 'fact-2', expectedRevision: 2 },
          { factId: 'fact-3', expectedRevision: 3 },
        ],
      },
    });

    await service.waitForIdle(task.taskId);

    expect(confirmFact.mock.calls).toEqual([
      [{ factId: 'fact-1', expectedRevision: 1 }],
      [{ factId: 'fact-2', expectedRevision: 2 }],
      [{ factId: 'fact-3', expectedRevision: 3 }],
    ]);
    expect(service.getStatus(task.taskId)).toMatchObject({
      status: KnowledgeFactBatchTaskStatus.Completed,
      totalCount: 3,
      processedCount: 3,
      successCount: 2,
      skippedCount: 0,
      failedCount: 1,
      details: [{
        factId: 'fact-2',
        valuePreview: null,
        code: 'unknown_error',
        retryable: true,
      }],
    });
  });

  test('returns null for an unknown task id', () => {
    const service = createKnowledgeFactBatchReviewService({
      queryService: { listFacts: vi.fn() },
      projector: {
        confirmFact: vi.fn(),
        rejectFact: vi.fn(),
        archiveFact: vi.fn(),
      },
    });

    expect(service.getStatus('missing-task')).toBeNull();
  });
});
