# Task 3 Report: Promotion Task Contracts

Commit: `5cc548a8` (`feat(workflow): add promotion task contracts`)

## Red / Green

- RED: `npm test -- promotionTaskContracts` failed because
  `promotionTaskContracts.ts` did not exist.
- RED: `npm test -- promptTemplates` showed promotion prompts serializing raw
  task and upstream payloads and the missing output-schema builder.
- RED: the legacy-status regression initially failed when an omitted status
  changed from `completed` to `needs_input`.
- RED: the role-spoofing regression initially returned the model-supplied
  role instead of the requested role.
- GREEN: focused promotion, prompt, and validation suites passed after each
  minimal implementation change.

## Contracts

`parsePromotionTaskResult(role, value)` uses
`normalizeAgentTaskResultInput(value)` as the envelope parser, then enforces
the fixed role outputs:

- Scraping: `items[].sourceKind`, `sourceUrl` (HTTP(S)), `title`, `content`,
  `capturedAt`, and `confidence`.
- Cleaning: `records[].id`, `companyName`, `industry`, `contactHint`, and
  `fieldConfidence`, plus `duplicates[]` and `missingFields[]`.
- Scoring: `leads[].id`, bounded `score`, `tier`, `reasons`, `missingFields`,
  and `nextAction`.
- Assets: `assets[].platform`, `title`, `body`, `tags`, and `callToAction`;
  the parser always normalizes `manualReviewRequired` to `true`.
- Quality: `riskLevel`, `blockingIssues`, `warnings`, `requiredRevisions`,
  and `canArchive`; high risk always prevents archive.
- Monitoring: object arrays for `metrics` and `anomalies`, plus
  `hypotheses[]` and `adjustmentActions[]`.

Malformed required role data throws, so callers cannot accept a structurally
unsafe completed result. Unknown nonempty task statuses normalize to
`needs_input`; omitted statuses keep the pre-existing `completed` default.
The returned role is always the requested role, not model-controlled. Invalid
artifact references are discarded during normalized artifact-ref collection.

## Prompt Safety

`buildPromotionTaskOutputSchema(role)` exposes the fixed model output shape.
Promotion prompts use only structured `inputArtifacts`, upstream artifact
summaries, the role contract, workspace profile, research settings, platform
settings, risk rules, and output preferences. They do not inject the current
task raw payload or upstream `outputPayload`. Existing non-promotion prompts
retain their prior task/upstream behavior. Publication and contact actions
remain draft-only and require manual review.

## Verification

- `npm test -- promotionTaskContracts agentOutputSanitizer agentResponseContractPrompt`
  — 3 files, 17 tests passed.
- `npm test -- promptTemplates validation` — 3 files, 36 tests passed.
- `npx tsc --noEmit --pretty false` — passed.
- Changed-file ESLint with `--max-warnings 0` — passed.
- `git diff --check` and cached `git diff --check` — passed.

## Files

- `src/shared/enterpriseLeadWorkspace/promotionTaskContracts.ts`
- `src/shared/enterpriseLeadWorkspace/promotionContracts.ts`
- `src/shared/enterpriseLeadWorkspace/validation.ts`
- `src/main/enterpriseLeadWorkspace/promptTemplates.ts`
- `src/shared/enterpriseLeadWorkspace/promotionTaskContracts.test.ts`
- `src/shared/enterpriseLeadWorkspace/validation.test.ts`
- `src/main/enterpriseLeadWorkspace/promptTemplates.test.ts`

## Self-review

- Verified all six requested role categories and the supplied negative
  source-evidence and draft-only-asset cases.
- Kept the implementation scoped to Task 3 contracts, validation, prompts,
  and directly related tests.
- Did not stage this report; it remains untracked by design.

## Review-fix 1

### Red / Green

- RED: `npx vitest run src/main/enterpriseLeadWorkspace/service.test.ts src/main/enterpriseLeadWorkspace/store.test.ts src/main/enterpriseLeadWorkspace/promptTemplates.test.ts src/shared/enterpriseLeadWorkspace/promotionTaskContracts.test.ts` failed four new regressions: malformed scraping output persisted as `completed`, task artifact references were lost after reload, ProductSellingPoint prompts exposed raw task/upstream payloads, and ProductSellingPoint had no output contract.
- GREEN: the same focused run passed 4 files / 98 tests after the repair.
- GREEN: `npm test -- promotionTaskContracts service store agentOutputSanitizer agentResponseContractPrompt` passed 59 files / 628 tests; `npx tsc --noEmit --pretty false`, changed-file ESLint, and `git diff --check` passed.

### Safety decision

- Promotion-context tasks now parse through `parsePromotionTaskResult` before persistence. Any parser failure becomes a `needs_input` result with empty outputs and artifact references, so malformed output cannot be stored as completed.
- ProductSellingPoint follows the promotion-safe prompt path only when it has a promotion upstream; its legacy path stays unchanged. Its promotion schema accepts only structured selling points.
- `artifact_refs` is an additive task-table column with an `[]` default. Reads, updates, and reloads round-trip it while legacy rows retain their existing data.
- Draft-only/manual-review boundaries remain unchanged.

### Files

- `src/main/enterpriseLeadWorkspace/service.ts`
- `src/main/enterpriseLeadWorkspace/service.test.ts`
- `src/main/enterpriseLeadWorkspace/store.ts`
- `src/main/enterpriseLeadWorkspace/store.test.ts`
- `src/main/enterpriseLeadWorkspace/promptTemplates.ts`
- `src/main/enterpriseLeadWorkspace/promptTemplates.test.ts`
- `src/shared/enterpriseLeadWorkspace/promotionTaskContracts.ts`
- `src/shared/enterpriseLeadWorkspace/promotionTaskContracts.test.ts`
- `src/shared/enterpriseLeadWorkspace/types.ts`

SHA: `acfa6da0` (`fix(workflow): enforce promotion task contracts`)

## Review-fix 2

### Red / Green

- RED: new chat-prompt regression exposed ProductSellingPoint chat revisions serializing the raw task and raw upstream output instead of promotion-safe artifacts and the fixed selling-point schema.
- RED: new pending-version regressions showed malformed promotion chat output could be applied as `completed`, promotion artifact references were dropped, and the apply-time reconstruction altered legacy output payloads.
- GREEN: `npx vitest run src/main/enterpriseLeadWorkspace/promptTemplates.test.ts src/main/enterpriseLeadWorkspace/service.test.ts` passed 2 files / 64 tests after the scoped repair.

### Repair

- Promotion-context chat revisions now use the same promotion-safe workspace, artifact summaries, and fixed role output schema as live task execution. ProductSellingPoint uses this path only with promotion upstream context; legacy chat construction remains unchanged.
- Chat revisions parse through `parsePromotionTaskResult` before pending storage and again before application. Invalid promotion output becomes the existing safe `needs_input` result with empty outputs and artifacts instead of a completed task.
- Pending versions persist the normalized task status and artifact references. Applying a revision writes both to the task update; legacy pending versions retain `completed` and `[]` defaults through the additive migration.

### Verification

- `npm test -- promotionTaskContracts service agentOutputSanitizer agentResponseContractPrompt` — 36 files / 364 tests passed.
- `npm test -- promptTemplates` — 1 file / 5 tests passed.
- `npx tsc --noEmit --pretty false` and changed-file ESLint with `--max-warnings 0` — passed.
- `git diff --check` and cached `git diff --check` — passed.
