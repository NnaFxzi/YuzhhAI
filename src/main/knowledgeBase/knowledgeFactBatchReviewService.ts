import { randomUUID } from 'node:crypto';

import {
  KNOWLEDGE_FACT_LIST_MAX_LIMIT,
  KnowledgeBaseErrorCode,
  KnowledgeFactBatchAction,
  KnowledgeFactBatchSkipReason,
  KnowledgeFactBatchTaskStatus,
} from '../../shared/knowledgeBase/constants';
import type {
  KnowledgeFactBatchReviewDetail,
  KnowledgeFactBatchReviewRequest,
  KnowledgeFactBatchReviewTask,
  KnowledgeFactSummary,
  KnowledgeListFactsRequest,
} from '../../shared/knowledgeBase/types';
import {
  EnterpriseLeadKnowledgeFactProjector,
  KnowledgeFactProjectionConflictError,
  KnowledgeFactProjectorError,
} from './enterpriseLeadKnowledgeFactProjector';
import { KnowledgeFactQueryService } from './knowledgeFactQueryService';

const DETAIL_LIMIT = 200;
const VALUE_PREVIEW_MAX_CHARS = 240;
const YIELD_EVERY_COUNT = 25;

type MaterializedFact = {
  factId: string;
  expectedRevision: number;
  valuePreview: string | null;
  missing: boolean;
};

type BatchReviewProjector = Pick<
  EnterpriseLeadKnowledgeFactProjector,
  'confirmFact' | 'rejectFact' | 'archiveFact'
>;

type BatchReviewQueryService = Pick<
  KnowledgeFactQueryService,
  'getFactCurrentRevision' | 'listFacts'
>;

export interface KnowledgeFactBatchReviewService {
  start(request: KnowledgeFactBatchReviewRequest): KnowledgeFactBatchReviewTask;
  getStatus(taskId: string): KnowledgeFactBatchReviewTask | null;
  retry(taskId: string): KnowledgeFactBatchReviewTask | null;
  waitForIdle(taskId: string): Promise<void>;
  shutdown(): Promise<void>;
}

export interface CreateKnowledgeFactBatchReviewServiceOptions {
  queryService: BatchReviewQueryService;
  projector: BatchReviewProjector;
  clock?: () => string;
  createTaskId?: () => string;
  yieldControl?: () => Promise<void>;
}

const cloneTask = (task: KnowledgeFactBatchReviewTask): KnowledgeFactBatchReviewTask => ({
  ...task,
  skippedByReason: { ...task.skippedByReason },
  details: task.details.map(detail => ({ ...detail })),
});

const cloneRequest = (
  request: KnowledgeFactBatchReviewRequest,
): KnowledgeFactBatchReviewRequest => ({
  workspaceId: request.workspaceId,
  action: request.action,
  reason: request.reason,
  selection: request.selection.kind === 'fact_ids'
    ? {
        kind: 'fact_ids',
        items: request.selection.items.map(item => ({ ...item })),
      }
    : {
        kind: 'matching_filters',
        filters: {
          view: request.selection.filters.view,
          reviewStatuses: request.selection.filters.reviewStatuses
            ? [...request.selection.filters.reviewStatuses]
            : undefined,
          evidenceState: request.selection.filters.evidenceState,
        },
      },
});

const truncateValuePreview = (value: string | null): string | null => {
  if (value === null) return null;
  return value.length <= VALUE_PREVIEW_MAX_CHARS
    ? value
    : `${value.slice(0, VALUE_PREVIEW_MAX_CHARS - 1)}…`;
};

const appendDetail = (
  task: KnowledgeFactBatchReviewTask,
  detail: KnowledgeFactBatchReviewDetail,
): void => {
  if (task.details.length >= DETAIL_LIMIT) return;
  task.details.push(detail);
};

const incrementSkippedReason = (
  task: KnowledgeFactBatchReviewTask,
  reason: typeof KnowledgeFactBatchSkipReason[keyof typeof KnowledgeFactBatchSkipReason],
): void => {
  task.skippedByReason[reason] = (task.skippedByReason[reason] ?? 0) + 1;
};

const toMaterializedFact = (summary: KnowledgeFactSummary): MaterializedFact => ({
  factId: summary.id,
  expectedRevision: summary.revision,
  valuePreview: truncateValuePreview(summary.value),
  missing: false,
});

const normalizeDetailCode = (error: unknown): string => {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : null;
  if (typeof code !== 'string' || code.trim().length === 0) {
    return 'unknown_error';
  }
  return /^[a-z0-9_]+$/u.test(code) ? code : 'unknown_error';
};

const applyFact = (
  projector: BatchReviewProjector,
  request: KnowledgeFactBatchReviewRequest,
  fact: MaterializedFact,
): unknown => {
  const { factId, expectedRevision } = fact;
  if (request.action === KnowledgeFactBatchAction.Confirm) {
    return projector.confirmFact({ factId, expectedRevision });
  }
  if (request.action === KnowledgeFactBatchAction.Reject) {
    return projector.rejectFact({ factId, expectedRevision });
  }
  return projector.archiveFact({ factId, expectedRevision });
};

export const createKnowledgeFactBatchReviewService = (
  options: CreateKnowledgeFactBatchReviewServiceOptions,
): KnowledgeFactBatchReviewService => {
  const clock = options.clock ?? (() => new Date().toISOString());
  const createTaskId = options.createTaskId ?? (() => randomUUID());
  const yieldControl = options.yieldControl
    ?? (() => new Promise<void>(resolve => setImmediate(resolve)));
  const tasks = new Map<string, KnowledgeFactBatchReviewTask>();
  const requests = new Map<string, KnowledgeFactBatchReviewRequest>();
  const materializedFactsByTaskId = new Map<string, MaterializedFact[] | null>();
  const retryableFactsByTaskId = new Map<string, MaterializedFact[]>();
  const idlePromises = new Map<string, Promise<void>>();
  let closed = false;
  let shutdownPromise: Promise<void> | null = null;

  const createTaskRecord = (
    taskId: string,
    request: KnowledgeFactBatchReviewRequest,
    createdAt: string,
  ): KnowledgeFactBatchReviewTask => ({
    taskId,
    workspaceId: request.workspaceId,
    action: request.action,
    status: KnowledgeFactBatchTaskStatus.Queued,
    totalCount: 0,
    processedCount: 0,
    successCount: 0,
    skippedCount: 0,
    failedCount: 0,
    retryableCount: 0,
    skippedByReason: {},
    details: [],
    createdAt,
    startedAt: null,
    updatedAt: createdAt,
    completedAt: null,
  });

  const updateTimestamps = (
    task: KnowledgeFactBatchReviewTask,
    now: string,
    completed = false,
  ): void => {
    task.updatedAt = now;
    if (completed) task.completedAt = now;
  };

  const materializeFacts = async (
    request: KnowledgeFactBatchReviewRequest,
  ): Promise<MaterializedFact[]> => {
    if (request.selection.kind === 'fact_ids') {
      return request.selection.items.map(item => ({
        factId: item.factId,
        expectedRevision: item.expectedRevision,
        valuePreview: null as string | null,
        missing: false,
      }));
    }

    const facts: MaterializedFact[] = [];
    let cursor: string | undefined;
    do {
      const page = options.queryService.listFacts({
        workspaceId: request.workspaceId,
        view: request.selection.filters.view,
        reviewStatuses: request.selection.filters.reviewStatuses,
        evidenceState: request.selection.filters.evidenceState,
        cursor,
        limit: KNOWLEDGE_FACT_LIST_MAX_LIMIT,
      } satisfies KnowledgeListFactsRequest);
      facts.push(...page.items.map(toMaterializedFact));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return facts;
  };

  const refreshRetryableFacts = (
    workspaceId: string,
    retryableFacts: readonly MaterializedFact[],
  ): MaterializedFact[] =>
    retryableFacts.map(fact => {
      const currentRevision = options.queryService.getFactCurrentRevision(
        workspaceId,
        fact.factId,
      );
      if (currentRevision === null) {
        return {
          ...fact,
          missing: true,
        };
      }
      return {
        ...fact,
        expectedRevision: currentRevision,
        missing: false,
      };
    });

  const runTask = async (taskId: string): Promise<void> => {
    if (closed) return;
    const task = tasks.get(taskId);
    const request = requests.get(taskId);
    const materializedFacts = materializedFactsByTaskId.get(taskId);
    const retryableFacts = retryableFactsByTaskId.get(taskId);
    if (!task || !request || materializedFacts === undefined || !retryableFacts) return;
    const startedAt = clock();
    task.status = KnowledgeFactBatchTaskStatus.Running;
    task.startedAt = startedAt;
    updateTimestamps(task, startedAt);

    try {
      const facts = materializedFacts ?? await materializeFacts(request);
      if (closed) return;
      task.totalCount = facts.length;
      updateTimestamps(task, clock());

      for (let index = 0; index < facts.length; index += 1) {
        if (closed) return;
        const fact = facts[index];
        if (fact.missing) {
          task.skippedCount += 1;
          incrementSkippedReason(task, KnowledgeFactBatchSkipReason.NotFound);
          appendDetail(task, {
            factId: fact.factId,
            valuePreview: fact.valuePreview,
            code: KnowledgeFactBatchSkipReason.NotFound,
            retryable: false,
          });
          task.processedCount += 1;
          updateTimestamps(task, clock());
          if (task.processedCount % YIELD_EVERY_COUNT === 0) {
            await yieldControl();
          }
          continue;
        }
        try {
          applyFact(options.projector, request, fact);
          task.successCount += 1;
        } catch (error) {
          if (error instanceof KnowledgeFactProjectionConflictError) {
            task.skippedCount += 1;
            incrementSkippedReason(task, KnowledgeFactBatchSkipReason.ProjectionConflict);
            appendDetail(task, {
              factId: fact.factId,
              valuePreview: fact.valuePreview,
              code: KnowledgeFactBatchSkipReason.ProjectionConflict,
              retryable: false,
            });
          } else if (
            error instanceof KnowledgeFactProjectorError &&
            error.code === KnowledgeBaseErrorCode.FactEvidenceStale
          ) {
            task.skippedCount += 1;
            incrementSkippedReason(task, KnowledgeFactBatchSkipReason.NoActiveEvidence);
            appendDetail(task, {
              factId: fact.factId,
              valuePreview: fact.valuePreview,
              code: KnowledgeFactBatchSkipReason.NoActiveEvidence,
              retryable: false,
            });
          } else if (
            error instanceof KnowledgeFactProjectorError &&
            error.code === KnowledgeBaseErrorCode.FactRevisionConflict
          ) {
            task.skippedCount += 1;
            retryableFacts.push({ ...fact });
            task.retryableCount = retryableFacts.length;
            incrementSkippedReason(task, KnowledgeFactBatchSkipReason.RevisionConflict);
            appendDetail(task, {
              factId: fact.factId,
              valuePreview: fact.valuePreview,
              code: KnowledgeFactBatchSkipReason.RevisionConflict,
              retryable: true,
            });
          } else {
            task.failedCount += 1;
            retryableFacts.push({ ...fact });
            task.retryableCount = retryableFacts.length;
            appendDetail(task, {
              factId: fact.factId,
              valuePreview: fact.valuePreview,
              code: normalizeDetailCode(error),
              retryable: true,
            });
          }
        }
        task.processedCount += 1;
        updateTimestamps(task, clock());
        if (task.processedCount % YIELD_EVERY_COUNT === 0) {
          await yieldControl();
        }
      }

      if (closed) return;
      task.status = KnowledgeFactBatchTaskStatus.Completed;
      updateTimestamps(task, clock(), true);
    } catch {
      if (closed) return;
      task.status = KnowledgeFactBatchTaskStatus.Failed;
      updateTimestamps(task, clock(), true);
    }
  };

  return {
    start(request: KnowledgeFactBatchReviewRequest): KnowledgeFactBatchReviewTask {
      if (closed) {
        throw new Error('KnowledgeFactBatchReviewService is closed');
      }
      const now = clock();
      const taskId = createTaskId();
      const task = createTaskRecord(taskId, request, now);
      const requestClone = cloneRequest(request);
      tasks.set(task.taskId, task);
      requests.set(task.taskId, requestClone);
      materializedFactsByTaskId.set(task.taskId, null);
      retryableFactsByTaskId.set(task.taskId, []);
      idlePromises.set(task.taskId, Promise.resolve().then(() => runTask(task.taskId)));
      return cloneTask(task);
    },

    getStatus(taskId: string): KnowledgeFactBatchReviewTask | null {
      const task = tasks.get(taskId);
      return task ? cloneTask(task) : null;
    },

    retry(taskId: string): KnowledgeFactBatchReviewTask | null {
      if (closed) {
        throw new Error('KnowledgeFactBatchReviewService is closed');
      }
      const sourceTask = tasks.get(taskId);
      const sourceRequest = requests.get(taskId);
      const retryableFacts = retryableFactsByTaskId.get(taskId);
      if (
        !sourceTask
        || !sourceRequest
        || !retryableFacts
        || retryableFacts.length === 0
        || (
          sourceTask.status !== KnowledgeFactBatchTaskStatus.Completed
          && sourceTask.status !== KnowledgeFactBatchTaskStatus.Failed
        )
      ) {
        return null;
      }
      const refreshedRetryableFacts = refreshRetryableFacts(
        sourceRequest.workspaceId,
        retryableFacts,
      );
      const retryRequest: KnowledgeFactBatchReviewRequest = {
        workspaceId: sourceRequest.workspaceId,
        action: sourceRequest.action,
        selection: {
          kind: 'fact_ids',
          items: refreshedRetryableFacts.map(fact => ({
            factId: fact.factId,
            expectedRevision: fact.expectedRevision,
          })),
        },
        ...(typeof sourceRequest.reason === 'string' ? { reason: sourceRequest.reason } : {}),
      };
      const now = clock();
      const retryTaskId = createTaskId();
      const retryTask = createTaskRecord(retryTaskId, retryRequest, now);
      tasks.set(retryTaskId, retryTask);
      requests.set(retryTaskId, cloneRequest(retryRequest));
      materializedFactsByTaskId.set(retryTaskId, refreshedRetryableFacts.map(fact => ({ ...fact })));
      retryableFactsByTaskId.set(retryTaskId, []);
      idlePromises.set(retryTaskId, Promise.resolve().then(() => runTask(retryTaskId)));
      return cloneTask(retryTask);
    },

    async waitForIdle(taskId: string): Promise<void> {
      const idlePromise = idlePromises.get(taskId);
      if (!idlePromise) return;
      await idlePromise;
    },

    shutdown(): Promise<void> {
      if (shutdownPromise) return shutdownPromise;
      closed = true;
      const activeTasks = [...idlePromises.values()];
      tasks.clear();
      requests.clear();
      materializedFactsByTaskId.clear();
      retryableFactsByTaskId.clear();
      idlePromises.clear();
      shutdownPromise = Promise.all(activeTasks).then((): void => undefined);
      return shutdownPromise;
    },
  };
};
