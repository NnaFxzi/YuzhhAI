# Local Independent Cloud-Off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent default requests to Youdao/LobsterAI services while keeping local independent app features usable.

**Architecture:** Add explicit cloud capability helpers, make endpoint helpers return disabled/local URLs by default,
and gate cloud-only callers before fetch. Keep compatibility identifiers that are runtime protocols.

**Tech Stack:** Electron main process, React renderer, TypeScript, Vitest, existing IPC and endpoint helper modules.

---

### Task 1: Add Cloud Capability Helpers

**Files:**

- Create: `src/shared/cloudCapabilities/constants.ts`
- Modify: `src/renderer/config.ts`

- [ ] Create a shared module with disabled-by-default cloud capability flags and local public URLs.
- [ ] Change default usage analytics to false.
- [ ] Add tests or update existing endpoint/log reporter tests to use the new disabled default.

### Task 2: Disable Legacy Analytics Requests

**Files:**

- Modify: `src/renderer/services/logReporter.ts`
- Modify: `src/renderer/services/logReporter.test.ts`

- [ ] Make `reportYdAnalyzer()` return false without network when legacy analytics is disabled.
- [ ] Rename public action prefix constants to neutral names while keeping event strings stable only if tests require
  it.
- [ ] Verify the reporter no longer builds or fetches `rlogs.youdao.com` in the default configuration.

### Task 3: Replace Endpoint Defaults

**Files:**

- Modify: `src/main/libs/endpoints.ts`
- Modify: `src/renderer/services/endpoints.ts`
- Modify: related endpoint tests

- [ ] Replace Youdao/LobsterAI default endpoint URLs with disabled empty strings or `https://www.yuzhh.com`
  informational URLs.
- [ ] Expose `isLegacyCloudEnabled()` and `isCloudEndpointEnabled(url)` helpers.
- [ ] Keep portal links informational only.

### Task 4: Gate Cloud Fetch Callers

**Files:**

- Modify: `src/renderer/services/auth.ts`
- Modify: `src/main/libs/appUpdateCoordinator.ts`
- Modify: `src/main/ipcHandlers/skills/handlers.ts`
- Modify: `src/main/ipcHandlers/kits/handlers.ts`
- Modify: `src/main/ipcHandlers/mcp/handlers.ts`
- Modify: `src/main/main.ts` cloud-only auth/html-share/model sections where direct requests are made.

- [ ] Skip login URL, update, marketplace, and cloud share fetches when endpoints are disabled.
- [ ] Return clear disabled messages for cloud-only APIs.
- [ ] Preserve user-configured provider, MCP, local skill, local plugin, and OpenClaw runtime flows.

### Task 5: Verification

**Files:**

- Test: `src/renderer/services/endpoints.test.ts`
- Test: `src/renderer/services/logReporter.test.ts`
- Test: touched main/renderer tests where available

- [ ] Run touched-file ESLint.
- [ ] Run targeted Vitest tests for endpoints, analytics, update coordinator, and marketplace handlers.
- [ ] Run `npm run compile:electron`.
- [ ] Run `npm run build`.
- [ ] Run final source scan for `youdao.com`, `api-overmind`, `rlogs`, and old portal URLs; document intentional
  remaining compatibility identifiers.
