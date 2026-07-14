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
