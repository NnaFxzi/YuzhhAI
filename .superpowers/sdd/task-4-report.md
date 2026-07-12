# Task 4 Report — Resumable Promotion Orchestrator

Commit: `8986bdf0 feat(workflow): add resumable promotion orchestrator`

## Red / Green

- Red: `npm test -- workflowOrchestrator` failed as expected because `workflowOrchestrator` did not exist.
- Green: `npm test -- workflowOrchestrator` passes with 7 tests covering DAG parallelism, needs-input pause, approval/resume, retry/resume, persisted start options, cancellation, and idempotent duplicate starts.

## Design and compatibility

- The orchestrator materializes the Task 1 promotion graph into persisted task dependency IDs and schedules only completed-dependency nodes.
- Batches are limited to normalized concurrency `1..3` and use `Promise.allSettled` so one task failure preserves peer results.
- Every execution records an attempt, event, and draft-only output artifact; child-session execution is explicitly unsupported.
- Workflow metadata migrations are additive: legacy tasks retain empty dependencies and legacy runs receive default start options.
- Optional nodes are accepted only for `sales_handoff_requested` and `monitoring_requested`; resume reads the saved options and cannot enable new optional nodes.

## Validation

- Pass: `npm test -- workflowOrchestrator` — 1 file, 7 tests.
- Pass: changed-file ESLint with `--max-warnings 0`.
- Pass: `git diff --check` before commit.
- TypeScript note: `npx tsc --project electron-tsconfig.json` reaches one pre-existing Task 3 error in `src/main/enterpriseLeadWorkspace/service.ts:552` (`PromotionTaskResult<object>` is not assignable to `EnterpriseLeadAgentTaskResult`). No Task 4 file reports a TypeScript error. `npm run compile:electron` is blocked earlier by its OCR preflight attempting to fetch `cdn.jsdelivr.net` in the restricted network environment.

## Committed files

- `src/main/enterpriseLeadWorkspace/workflowExecutionAdapter.ts`
- `src/main/enterpriseLeadWorkspace/workflowOrchestrator.ts`
- `src/main/enterpriseLeadWorkspace/workflowOrchestrator.test.ts`
- `src/main/enterpriseLeadWorkspace/store.ts`
- `src/shared/enterpriseLeadWorkspace/workflowContracts.ts`

## Review-fix1

- Production integration: `EnterpriseLeadWorkspaceService` now owns an `EnterpriseLeadWorkflowOrchestrator` with an `InlineWorkflowExecutionAdapter` backed by the existing model client. New promotion-controller workspaces create an empty run and `runWorkflow` initializes/resumes the persisted DAG. Historical task rows without DAG node IDs, and all non-promotion runs, continue through the legacy sequential path.
- Legacy execution mode: store initialization migrates `NULL execution_mode` values to `inline`; the orchestrator also defaults an in-memory missing mode to `inline` before creating an attempt, preventing ready-task retry loops.
- Cancellation audit trail: `cancelRun` emits one `task_cancelled` event per task changed to cancelled, then emits `run_cancelled`.
- Regression coverage: service routing to the production DAG, null-mode migration, cancellation events, and parallel peer progression after a task failure.
- Validation: `npx vitest run src/main/enterpriseLeadWorkspace/store.test.ts src/main/enterpriseLeadWorkspace/workflowOrchestrator.test.ts src/main/enterpriseLeadWorkspace/service.test.ts` passes (106 tests). Changed-file ESLint and `git diff --check` were run. `npx tsc --project electron-tsconfig.json` still reports the existing Task 3 typing error at `service.ts:556` (`PromotionTaskResult<object>` outputs are narrower than `Record<string, unknown>`); this review fix introduces no additional TypeScript error.
