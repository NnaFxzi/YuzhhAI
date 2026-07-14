# Task 6 Report — Promotion Workflow IPC

Feature commit: `6e8bf3c9 feat(workflow): expose promotion run control IPC`

## Delivered

- Added shared promotion workflow IPC channels for start, resume, cancel, task approval/rejection, and workflow events.
- Added validated main-process handlers that dispatch to the workspace service, return an immediate start snapshot, replay persisted run events, and append/send `run_error` when background execution rejects.
- Exposed typed preload and renderer service controls, including run-filtered event subscriptions with an unsubscribe callback.
- Clarified Cowork prompts: auto/manual is role routing for the current turn only; full promotion plans, bulk leads, and monitoring belong in workflow runs; execution claims require workflow or child-session evidence.

## Tests and checks

- `npm test -- ipcHandlers coworkAgentTeamBridge` — PASS (5 files, 44 tests)
- `npx vitest run src/renderer/services/enterpriseLeadWorkspace.test.ts` — PASS (1 file, 8 tests)
- `npm run compile:electron` — PASS
- Changed-file ESLint with `--max-warnings 0` — PASS
- `git diff --check` — PASS

`compile:electron` completed despite its dependency rebuild emitting existing sandbox access warnings for `~/.npm`.

## Committed files

- `src/shared/enterpriseLeadWorkspace/constants.ts`
- `src/main/enterpriseLeadWorkspace/ipcHandlers.ts`
- `src/main/enterpriseLeadWorkspace/ipcHandlers.test.ts`
- `src/main/preload.ts`
- `src/renderer/services/enterpriseLeadWorkspace.ts`
- `src/renderer/services/enterpriseLeadWorkspace.test.ts`
- `src/renderer/types/electron.d.ts`
- `src/main/enterpriseLeadWorkspace/coworkAgentTeamBridge.ts`
- `src/main/enterpriseLeadWorkspace/coworkAgentTeamBridge.test.ts`
- `src/main/main.ts`

## Review-fix1

- Wired the real main-process bridge to `EnterpriseLeadWorkspaceService.startWorkflow`, preserving requested graph options instead of dispatching the legacy runner.
- Added strict IPC validation: only `sales_handoff_requested` and `monitoring_requested` are accepted, and concurrency must be an integer from 1 through 3.
- Replaced post-completion event replay with per-sender/run cursor polling, so only new events stream during execution and control handlers never replay full histories.
- Persisted run error status and summary before creating/sending `run_error`.
- Added coverage for the registered IPC handlers, bridge option forwarding, streamed timing/deduplication, strict validation, and persisted error state.

## Review-fix2

- Refactored Start and Resume onto one sender/run-scoped event-stream helper. Resume now returns its snapshot and begins forwarding newly produced events without awaiting terminal workflow completion.
- Added per-sender/run stream guards, one rejection path per stream, and cleanup for terminal completion, rejection, and destroyed renderer `webContents`; controls retain cursor-based no-history replay behavior.
- Cleared active-run cancellation markers in generation-aware finalization so cancellation bookkeeping does not accumulate or erase a newer generation's state.
- Added focused coverage for Resume timing, duplicate Start and Resume calls, one persisted/sent `run_error`, destroyed-renderer stream cleanup, and post-settlement cancellation cleanup.

## Review-fix3

- Moved promotion workflow terminal ownership from sender-scoped streams to a shared workspace/run execution coordinator. Concurrent renderer senders now share one workflow execution and one terminal failure persistence path.
- Persisted `markRunError` and the `run_error` event before subscriber delivery, so a renderer destroyed before rejection cannot suppress durable failure state.
- Broadcast the one persisted failure event to every still-live sender stream, while destroyed streams are removed safely and terminal run bookkeeping is released after settlement.
- Added coverage for two live senders receiving a single persisted failure event, durable failure persistence after the only sender is destroyed, and settling the destroyed-stream fixture to avoid leaking a pending run between tests.

## Review-fix4

- Added an atomic SQLite-backed `markRunErrorOnce` transition that conditionally marks a run as errored and appends its `run_error` event in one transaction; later Start/Resume failures for that run receive no duplicate terminal failure artifact.
- Routed IPC failure handling through the durable transition result, while preserving background execution and retry/resume entry points.
- Removed each completed stream's `webContents` destroyed listener, and guarded event delivery/stream startup against an already-destroyed sender.
- Added focused regression coverage for sequential failed Start/Resume executions, durable single-event persistence across retry state, and normal listener cleanup.

## Review-fix5

- Made `cancelWorkflowRun` atomically transition only active, non-archived runs. Completed, cancelled, errored, and archived runs now leave their run row and tasks untouched; the orchestrator only records cancellation events after that store transition succeeds.
- Restricted `markRunErrorOnce` to the same non-terminal run states, so a late IPC rejection after cancellation cannot overwrite `Cancelled` or append `run_error`.
- Preserved existing error-resume behavior: an active failure still writes one durable error event, while a resumed attempt cannot create a duplicate.
- Added regression coverage for cancelling a completed run without mutations, cancellation followed by a late error transition, and IPC non-emission when durable error persistence is rejected.
