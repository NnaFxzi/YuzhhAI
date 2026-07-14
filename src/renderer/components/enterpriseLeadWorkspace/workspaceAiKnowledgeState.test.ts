import { describe, expect, test } from 'vitest';

import {
  KnowledgeBaseErrorCode,
  KnowledgeFactDomain,
  KnowledgeFactEvidenceState,
  KnowledgeFactListView,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeFactEvidenceSummary,
  KnowledgeFactMetrics,
  KnowledgeFactSummary,
} from '../../../shared/knowledgeBase/types';
import {
  buildWorkspaceAiKnowledgeFilterKey,
  createWorkspaceAiKnowledgeState,
  hasPendingWorkspaceAiKnowledgeTrailingRefresh,
  type WorkspaceAiKnowledgeAction,
  WorkspaceAiKnowledgeActionType,
  WorkspaceAiKnowledgeListMode,
  WorkspaceAiKnowledgeMutationKind,
  workspaceAiKnowledgeReducer,
} from './workspaceAiKnowledgeState';

const metrics = (seed = 0): KnowledgeFactMetrics => ({
  activePendingCount: seed + 1,
  activeConfirmedCount: seed + 2,
  staleConfirmedCount: seed + 3,
  rejectedHistoryCount: seed + 4,
  archivedHistoryCount: seed + 5,
  unduplicatedLegacyConfirmedCount: seed + 6,
  totalAiKnowledgeCount: seed + 7,
});

const emptyMetrics: KnowledgeFactMetrics = {
  activePendingCount: 0,
  activeConfirmedCount: 0,
  staleConfirmedCount: 0,
  rejectedHistoryCount: 0,
  archivedHistoryCount: 0,
  unduplicatedLegacyConfirmedCount: 0,
  totalAiKnowledgeCount: 0,
};

const fact = (id: string, revision: number): KnowledgeFactSummary => ({
  id,
  domain: KnowledgeFactDomain.ProductList,
  value: `${id}-r${revision}`,
  reviewStatus: KnowledgeFactReviewStatus.Pending,
  sourceKind: KnowledgeFactSourceKind.Extracted,
  revision,
  projectionState: KnowledgeFactProjectionState.None,
  activeEvidenceCount: 1,
  staleEvidenceCount: 0,
  evidencePreview: null,
  createdAt: '2026-07-13T00:00:00.000Z',
  reviewedAt: null,
  updatedAt: `2026-07-13T00:00:0${revision}.000Z`,
  archivedAt: null,
});

const evidence = (id: string, factId = 'fact-a'): KnowledgeFactEvidenceSummary => ({
  id,
  factId,
  documentId: `document-${id}`,
  documentVersionId: `version-${id}`,
  documentDisplayName: `${id}.pdf`,
  quote: `quote-${id}`,
  confidence: 0.9,
  stale: false,
  createdAt: '2026-07-13T00:00:00.000Z',
});

const deepFreeze = <Value>(value: Value): Value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const filters = {
  view: KnowledgeFactListView.Active,
  reviewStatuses: [KnowledgeFactReviewStatus.Pending, KnowledgeFactReviewStatus.Confirmed],
  evidenceState: KnowledgeFactEvidenceState.Active,
};

const initial = () =>
  createWorkspaceAiKnowledgeState({
    workspaceId: 'workspace-a',
    workspaceGeneration: 1,
    filters,
  });

const startList = (
  state: ReturnType<typeof initial>,
  requestGeneration: number,
  mode: WorkspaceAiKnowledgeListMode = WorkspaceAiKnowledgeListMode.Replace,
) =>
  workspaceAiKnowledgeReducer(state, {
    type: WorkspaceAiKnowledgeActionType.ListRequestStarted,
    workspaceGeneration: 1,
    requestGeneration,
    mode,
  });

const succeedList = (
  state: ReturnType<typeof initial>,
  requestGeneration: number,
  items: KnowledgeFactSummary[],
  nextCursor: string | null,
  nextMetrics: KnowledgeFactMetrics,
) =>
  workspaceAiKnowledgeReducer(state, {
    type: WorkspaceAiKnowledgeActionType.ListRequestSucceeded,
    workspaceGeneration: 1,
    requestGeneration,
    result: { items, nextCursor, metrics: nextMetrics },
  });

describe('workspace AI knowledge list state', () => {
  test('canonicalizes backend filters without any free-text search state', () => {
    const left = buildWorkspaceAiKnowledgeFilterKey({
      evidenceState: KnowledgeFactEvidenceState.Active,
      reviewStatuses: [
        KnowledgeFactReviewStatus.Confirmed,
        KnowledgeFactReviewStatus.Pending,
        KnowledgeFactReviewStatus.Confirmed,
      ],
      view: KnowledgeFactListView.Active,
    });
    const right = buildWorkspaceAiKnowledgeFilterKey(filters);

    expect(left).toBe(right);
    expect(left).toBe('active|pending,confirmed|active');
    expect(buildWorkspaceAiKnowledgeFilterKey()).toBe(
      buildWorkspaceAiKnowledgeFilterKey({
        view: KnowledgeFactListView.Active,
        evidenceState: KnowledgeFactEvidenceState.Any,
      }),
    );
    expect(buildWorkspaceAiKnowledgeFilterKey()).toBe('active||any');
    expect(initial()).not.toHaveProperty('search');
    expect(initial()).not.toHaveProperty('query');
  });

  test('resets items, cursors, metrics, mutations, evidence, and request ownership on context change', () => {
    let state = startList(initial(), 1);
    state = succeedList(state, 1, [fact('fact-a', 1)], 'cursor-2', metrics(10));
    state = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.EvidenceExpanded,
      factId: 'fact-a',
      factRevision: 1,
    });
    state = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.MutationStarted,
      workspaceGeneration: 1,
      factId: 'fact-b',
      requestGeneration: 1,
      kind: WorkspaceAiKnowledgeMutationKind.Review,
    });

    const reset = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.ContextReset,
      workspaceId: 'workspace-b',
      workspaceGeneration: 2,
      filters: { view: KnowledgeFactListView.History },
    });

    expect(reset.workspaceId).toBe('workspace-b');
    expect(reset.workspaceGeneration).toBe(2);
    expect(reset.items).toEqual([]);
    expect(reset.nextCursor).toBeNull();
    expect(reset.metrics).toEqual(emptyMetrics);
    expect(reset.mutations).toEqual({});
    expect(reset.activeListRequest).toBeNull();
    expect(reset.evidence.expandedFactId).toBeNull();
    expect(reset.evidence.items).toEqual([]);
    expect(reset.filterKey).toBe('history||any');
  });

  test('resets the same workspace when its backend filter generation changes', () => {
    let state = startList(initial(), 1);
    state = succeedList(state, 1, [fact('fact-a', 1)], 'cursor-2', metrics(10));

    const reset = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.ContextReset,
      workspaceId: 'workspace-a',
      workspaceGeneration: 2,
      filters: {
        view: KnowledgeFactListView.Active,
        reviewStatuses: [KnowledgeFactReviewStatus.Confirmed],
        evidenceState: KnowledgeFactEvidenceState.Stale,
      },
    });

    expect(reset.workspaceId).toBe('workspace-a');
    expect(reset.workspaceGeneration).toBe(2);
    expect(reset.filterKey).toBe('active|confirmed|stale');
    expect(reset.items).toEqual([]);
    expect(reset.nextCursor).toBeNull();
  });

  test('replaces first pages, appends by ID, keeps newer revisions, and replaces metrics', () => {
    let state = startList(initial(), 1);
    state = succeedList(
      state,
      1,
      [fact('fact-a', 2), fact('fact-b', 1)],
      'cursor-2',
      metrics(10),
    );
    state = startList(state, 2, WorkspaceAiKnowledgeListMode.Append);
    state = succeedList(
      state,
      2,
      [
        fact('fact-a', 1),
        fact('fact-b', 3),
        { ...fact('fact-b', 3), value: 'equal-revision-must-not-win' },
        fact('fact-c', 1),
        fact('fact-c', 2),
      ],
      null,
      metrics(20),
    );

    expect(state.items.map(item => [item.id, item.revision])).toEqual([
      ['fact-a', 2],
      ['fact-b', 3],
      ['fact-c', 2],
    ]);
    expect(state.nextCursor).toBeNull();
    expect(state.metrics).toEqual(metrics(20));
    expect(state.metrics).not.toEqual(metrics(30));
    expect(state.items.find(item => item.id === 'fact-b')?.value).toBe('fact-b-r3');

    const appendAfterEnd = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.ListRequestStarted,
      workspaceGeneration: 1,
      requestGeneration: 3,
      mode: WorkspaceAiKnowledgeListMode.Append,
    });
    expect(appendAfterEnd).toBe(state);
  });

  test('replace refresh removes absent IDs without downgrading a known fact revision', () => {
    let state = startList(initial(), 1);
    state = succeedList(
      state,
      1,
      [fact('fact-a', 3), fact('fact-b', 1)],
      null,
      metrics(1),
    );
    state = startList(state, 2);
    state = succeedList(
      state,
      2,
      [fact('fact-a', 2), fact('fact-c', 1)],
      null,
      metrics(2),
    );

    expect(state.items.map(item => [item.id, item.revision])).toEqual([
      ['fact-a', 3],
      ['fact-c', 1],
    ]);
    expect(state.metrics).toEqual(metrics(2));
  });

  test('ignores stale generations and exposes exactly one trailing refresh after settle', () => {
    let state = startList(initial(), 4);
    const staleWorkspace = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.ListRequestSucceeded,
      workspaceGeneration: 0,
      requestGeneration: 4,
      result: { items: [fact('stale', 1)], nextCursor: null, metrics: metrics(50) },
    });
    const staleRequest = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.ListRequestSucceeded,
      workspaceGeneration: 1,
      requestGeneration: 3,
      result: { items: [fact('stale', 1)], nextCursor: null, metrics: metrics(50) },
    });
    expect(staleWorkspace).toBe(state);
    expect(staleRequest).toBe(state);

    state = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.RefreshRequested,
    });
    state = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.RefreshRequested,
    });
    expect(state.trailingRefresh).toBe(true);
    expect(hasPendingWorkspaceAiKnowledgeTrailingRefresh(state)).toBe(false);

    state = succeedList(state, 4, [fact('fresh', 1)], null, metrics(1));
    expect(hasPendingWorkspaceAiKnowledgeTrailingRefresh(state)).toBe(true);

    state = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.TrailingRefreshStarted,
      workspaceGeneration: 1,
      requestGeneration: 5,
    });
    expect(state.trailingRefresh).toBe(false);
    expect(state.activeListRequest?.requestGeneration).toBe(5);
    expect(hasPendingWorkspaceAiKnowledgeTrailingRefresh(state)).toBe(false);
  });

  test('does not mutate frozen reducer state or page action payloads', () => {
    const state = deepFreeze(startList(initial(), 1));
    const action = deepFreeze({
      type: WorkspaceAiKnowledgeActionType.ListRequestSucceeded,
      workspaceGeneration: 1,
      requestGeneration: 1,
      result: {
        items: [fact('fact-a', 1), fact('fact-b', 1)],
        nextCursor: 'cursor-2',
        metrics: metrics(4),
      },
    } satisfies WorkspaceAiKnowledgeAction);
    const stateSnapshot = JSON.stringify(state);
    const actionSnapshot = JSON.stringify(action);

    const next = workspaceAiKnowledgeReducer(state, action);

    expect(next.items.map(item => item.id)).toEqual(['fact-a', 'fact-b']);
    expect(JSON.stringify(state)).toBe(stateSnapshot);
    expect(JSON.stringify(action)).toBe(actionSnapshot);
  });

  test('tracks mutations per fact and ignores stale mutation settlement', () => {
    let state = startList(initial(), 1);
    state = succeedList(state, 1, [fact('fact-a', 1), fact('fact-b', 1)], 'cursor-2', metrics(1));
    state = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.MutationStarted,
      workspaceGeneration: 1,
      factId: 'fact-a',
      requestGeneration: 5,
      kind: WorkspaceAiKnowledgeMutationKind.Review,
    });
    state = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.MutationStarted,
      workspaceGeneration: 1,
      factId: 'fact-b',
      requestGeneration: 6,
      kind: WorkspaceAiKnowledgeMutationKind.Archive,
    });
    const stale = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.MutationFailed,
      workspaceGeneration: 1,
      factId: 'fact-a',
      requestGeneration: 4,
    });
    expect(stale).toBe(state);
    expect(Object.keys(state.mutations).sort()).toEqual(['fact-a', 'fact-b']);

    state = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.MutationSucceeded,
      workspaceGeneration: 1,
      factId: 'fact-a',
      requestGeneration: 5,
      fact: fact('fact-a', 2),
    });
    expect(state.mutations).not.toHaveProperty('fact-a');
    expect(state.mutations).toHaveProperty('fact-b');
    expect(state.items).toEqual([]);
    expect(state.nextCursor).toBeNull();
    expect(state.trailingRefresh).toBe(true);
  });

  test('ignores mutation settlement from a previous workspace generation after an ID collision', () => {
    let state = workspaceAiKnowledgeReducer(initial(), {
      type: WorkspaceAiKnowledgeActionType.MutationStarted,
      workspaceGeneration: 1,
      factId: 'fact-a',
      requestGeneration: 7,
      kind: WorkspaceAiKnowledgeMutationKind.Review,
    });
    state = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.ContextReset,
      workspaceId: 'workspace-b',
      workspaceGeneration: 2,
    });
    state = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.MutationStarted,
      workspaceGeneration: 2,
      factId: 'fact-a',
      requestGeneration: 7,
      kind: WorkspaceAiKnowledgeMutationKind.Archive,
    });

    const afterOldSuccess = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.MutationSucceeded,
      workspaceGeneration: 1,
      factId: 'fact-a',
      requestGeneration: 7,
      fact: fact('fact-a', 2),
    });
    const afterOldFailure = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.MutationFailed,
      workspaceGeneration: 1,
      factId: 'fact-a',
      requestGeneration: 7,
      errorCode: KnowledgeBaseErrorCode.JobStateConflict,
    });

    expect(afterOldSuccess).toBe(state);
    expect(afterOldFailure).toBe(state);
    expect(state.mutations['fact-a']).toMatchObject({
      workspaceGeneration: 2,
      requestGeneration: 7,
      kind: WorkspaceAiKnowledgeMutationKind.Archive,
    });
  });
});

describe('workspace AI knowledge evidence ownership', () => {
  const expandAndStart = () => {
    let state = workspaceAiKnowledgeReducer(initial(), {
      type: WorkspaceAiKnowledgeActionType.EvidenceExpanded,
      factId: 'fact-a',
      factRevision: 2,
    });
    state = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.EvidenceRequestStarted,
      workspaceGeneration: 1,
      requestGeneration: 1,
      factId: 'fact-a',
      factRevision: 2,
      mode: WorkspaceAiKnowledgeListMode.Replace,
    });
    return state;
  };

  test('replaces first page, appends one page with ID dedup, and stops at a null cursor', () => {
    let state = expandAndStart();
    state = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.EvidenceRequestSucceeded,
      workspaceGeneration: 1,
      requestGeneration: 1,
      result: {
        factId: 'fact-a',
        factRevision: 2,
        items: [evidence('evidence-a'), evidence('evidence-b')],
        nextCursor: 'evidence-cursor-2',
      },
    });
    state = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.EvidenceRequestStarted,
      workspaceGeneration: 1,
      requestGeneration: 2,
      factId: 'fact-a',
      factRevision: 2,
      mode: WorkspaceAiKnowledgeListMode.Append,
    });
    state = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.EvidenceRequestSucceeded,
      workspaceGeneration: 1,
      requestGeneration: 2,
      result: {
        factId: 'fact-a',
        factRevision: 2,
        items: [evidence('evidence-b'), evidence('evidence-c')],
        nextCursor: null,
      },
    });

    expect(state.evidence.items.map(item => item.id)).toEqual([
      'evidence-a',
      'evidence-b',
      'evidence-c',
    ]);
    expect(state.evidence.nextCursor).toBeNull();
    const afterEnd = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.EvidenceRequestStarted,
      workspaceGeneration: 1,
      requestGeneration: 3,
      factId: 'fact-a',
      factRevision: 2,
      mode: WorkspaceAiKnowledgeListMode.Append,
    });
    expect(afterEnd).toBe(state);
  });

  test('ignores stale fact, revision, workspace, and request responses', () => {
    const state = expandAndStart();
    const baseAction: Extract<
      WorkspaceAiKnowledgeAction,
      { type: typeof WorkspaceAiKnowledgeActionType.EvidenceRequestSucceeded }
    > = {
      type: WorkspaceAiKnowledgeActionType.EvidenceRequestSucceeded,
      workspaceGeneration: 1,
      requestGeneration: 1,
      result: {
        factId: 'fact-a',
        factRevision: 2,
        items: [evidence('evidence-a')],
        nextCursor: null,
      },
    };

    expect(
      workspaceAiKnowledgeReducer(state, {
        ...baseAction,
        workspaceGeneration: 0,
      }),
    ).toBe(state);
    expect(
      workspaceAiKnowledgeReducer(state, {
        ...baseAction,
        requestGeneration: 0,
      }),
    ).toBe(state);
    expect(
      workspaceAiKnowledgeReducer(state, {
        ...baseAction,
        result: { ...baseAction.result, factId: 'fact-b' },
      }),
    ).toBe(state);
    expect(
      workspaceAiKnowledgeReducer(state, {
        ...baseAction,
        result: { ...baseAction.result, factRevision: 3 },
      }),
    ).toBe(state);
  });

  test('keeps evidence through mutation start and ordinary failure', () => {
    let state = workspaceAiKnowledgeReducer(expandAndStart(), {
      type: WorkspaceAiKnowledgeActionType.EvidenceRequestSucceeded,
      workspaceGeneration: 1,
      requestGeneration: 1,
      result: {
        factId: 'fact-a',
        factRevision: 2,
        items: [evidence('evidence-a')],
        nextCursor: null,
      },
    });
    state = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.MutationStarted,
      workspaceGeneration: 1,
      factId: 'fact-a',
      requestGeneration: 20,
      kind: WorkspaceAiKnowledgeMutationKind.Review,
    });

    expect(state.evidence.expandedFactId).toBe('fact-a');
    expect(state.evidence.items.map(item => item.id)).toEqual(['evidence-a']);

    state = workspaceAiKnowledgeReducer(state, {
      type: WorkspaceAiKnowledgeActionType.MutationFailed,
      workspaceGeneration: 1,
      factId: 'fact-a',
      requestGeneration: 20,
      errorCode: KnowledgeBaseErrorCode.PersistenceFailed,
    });
    expect(state.evidence.expandedFactId).toBe('fact-a');
    expect(state.evidence.items.map(item => item.id)).toEqual(['evidence-a']);
  });

  test('invalidates evidence on collapse, fact revision change, review/archive, and conflict', () => {
    const loaded = workspaceAiKnowledgeReducer(expandAndStart(), {
      type: WorkspaceAiKnowledgeActionType.EvidenceRequestSucceeded,
      workspaceGeneration: 1,
      requestGeneration: 1,
      result: {
        factId: 'fact-a',
        factRevision: 2,
        items: [evidence('evidence-a')],
        nextCursor: null,
      },
    });

    const collapsed = workspaceAiKnowledgeReducer(loaded, {
      type: WorkspaceAiKnowledgeActionType.EvidenceCollapsed,
    });
    expect(collapsed.evidence.expandedFactId).toBeNull();
    expect(collapsed.evidence.items).toEqual([]);

    let refreshed = startList(loaded, 8);
    refreshed = succeedList(refreshed, 8, [fact('fact-a', 3)], null, metrics(1));
    expect(refreshed.evidence.expandedFactId).toBeNull();

    for (const kind of [
      WorkspaceAiKnowledgeMutationKind.Review,
      WorkspaceAiKnowledgeMutationKind.Archive,
    ]) {
      const mutating = workspaceAiKnowledgeReducer(loaded, {
        type: WorkspaceAiKnowledgeActionType.MutationStarted,
        workspaceGeneration: 1,
        factId: 'fact-a',
        requestGeneration: 10,
        kind,
      });
      expect(mutating.evidence.expandedFactId).toBe('fact-a');
      const succeeded = workspaceAiKnowledgeReducer(mutating, {
        type: WorkspaceAiKnowledgeActionType.MutationSucceeded,
        workspaceGeneration: 1,
        factId: 'fact-a',
        requestGeneration: 10,
        fact: fact('fact-a', 3),
      });
      expect(succeeded.evidence.expandedFactId).toBeNull();
    }

    const conflict = workspaceAiKnowledgeReducer(expandAndStart(), {
      type: WorkspaceAiKnowledgeActionType.EvidenceRequestFailed,
      workspaceGeneration: 1,
      requestGeneration: 1,
      errorCode: KnowledgeBaseErrorCode.JobStateConflict,
    });
    expect(conflict.evidence.expandedFactId).toBeNull();
    expect(conflict.evidence.items).toEqual([]);
  });
});
