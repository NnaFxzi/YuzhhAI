# Task 5 Report — Workspace Service Promotion DAG

Feature commit: `2087cce7 feat(workflow): connect workspace service to promotion DAG`

## Red / Green evidence

- Red: `npm test -- service workflow` failed with 8 expected regressions: workspace-agent skills were discarded; promotion runs had no workflow version or materialized graph tasks; cleaning could not be evaluated against graph dependencies; and rerun graph invalidation had no persisted graph to traverse.
- Green: `npm test -- promptTemplates` passes (1 file, 18 tests).
- Green: elevated `npm test -- service workflow` passes (37 files, 379 tests).
- Green: `npx tsc --noEmit`, changed-file ESLint with `--max-warnings 0`, and `git diff --check` all exit successfully.

## Compatibility and behavior

- New promotion runs persist `promotion-v1`, graph node IDs, generated dependency task IDs, inline execution mode, and immutable agent snapshots at creation time. Historical runs with no workflow version continue through serial execution.
- Workspace and agent skill IDs are snapshotted as a deduplicated union, preserving agent-level skill overrides across persistence.
- Promotion task prompts receive only the current task, execution context, and artifact summaries. The inline adapter parses the Task 3 promotion contract and service-driven task execution writes a durable output artifact.
- `resumeRun`, `cancelRun`, `approveTask`, and `rejectTask` are exposed by the service. Promotion runs delegate to the orchestrator; legacy runs retain serial/cancellation and approval-state compatibility.
- Rerunning a graph node marks only reachable descendants stale. Existing artifacts and workflow events are retained.

## Files in feature commit

- `src/main/enterpriseLeadWorkspace/service.ts`
- `src/main/enterpriseLeadWorkspace/store.ts`
- `src/main/enterpriseLeadWorkspace/service.test.ts`
- `src/main/enterpriseLeadWorkspace/workflow.ts`
- `src/main/enterpriseLeadWorkspace/workflowExecutionAdapter.ts`
- `src/main/enterpriseLeadWorkspace/workflowOrchestrator.ts`
- `src/main/enterpriseLeadWorkspace/promptTemplates.ts`
- `src/main/enterpriseLeadWorkspace/promptTemplates.test.ts`
- `src/shared/enterpriseLeadWorkspace/promotionWorkflowGraph.ts`
- `src/shared/enterpriseLeadWorkspace/validation.ts`

## Review-fix 1

- Fixed `workflowOrchestrator.ts` execution context construction to merge and deduplicate persisted task artifact refs with dependency artifact refs, preserving Artifact-only context on retries without including raw upstream output payloads.
- Added an orchestrator regression covering a failed controller task and retry execution with task-owned and dependency artifact refs.

## Review-fix 2

- Fixed legacy unversioned promotion runs with zero persisted tasks being completed by the legacy serial loop without execution.
- `runWorkflow` now recognizes the promotion workspace shape, materializes the non-optional promotion DAG once, persists `promotion-v1`, and resumes it through the workflow orchestrator. Populated DAGs and nonpromotion historical runs retain their existing behavior.
- Added a service regression constructing a legacy zero-task promotion run and verifying graph materialization plus controller execution into `needs_input`.
- Verification: elevated `npm test -- service workflow` (37 files, 381 tests), `npx tsc --noEmit`, changed-file ESLint with `--max-warnings 0`, and `git diff --check` all pass.

## Review-fix 3

- Fixed Electron compilation integration errors by importing `EnterpriseLeadWorkspace`, narrowing promotion outputs through an explicit object normalizer before Artifact Store/task-result writes, and using the `EnterpriseLeadTaskStatus` type alias for the legacy approval signature.
