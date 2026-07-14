# Independent AI Knowledge Model Contract Repair Plan

Date: 2026-07-14

## Task 1: Freeze RED coverage

Modify tests only:

- `src/main/knowledgeBase/knowledgeEnrichmentCandidateValidator.test.ts`
- `src/main/knowledgeBase/knowledgeEnrichmentService.test.ts`
- `src/main/industryPack/modelClientAdapter.test.ts`

Add tests for the exact prompt contract, `temperature: 0`, safe `finish_reason` handling,
rejection before publication, one request per planned call, and a bounded two-chunk success path.
Run the three test files and record the expected RED failures before production edits.

## Task 2: Implement the minimal repair

Modify only:

- `src/main/knowledgeBase/knowledgeEnrichmentCandidateValidator.ts`
- `src/main/knowledgeBase/knowledgeEnrichmentService.ts`
- `src/main/industryPack/modelClientAdapter.ts`

Keep the user prompt and strict parser unchanged. Extend the static system prompt, pass temperature
zero from the service, normalize an allowlisted first-choice finish reason in the adapter, and map a
length-truncated result to `invalid_model_response` before validation/publication. Run the three
focused test files to GREEN and run strict ESLint on all six files.

## Task 3: Independent reviews and fixes

Provide a frozen task diff and exact test evidence to an independent specification reviewer and an
independent code/security reviewer. Resolve all critical and important findings with new RED tests,
then repeat both reviews until C0/I0.

## Task 4: Rebuild Plan 3 acceptance package

Expand the Plan 3 final manifest from 36 to the exact repaired file set, rebuild the final diff from
the Plan 2 baseline, verify forward/reverse application and byte identity, and update the progress
and final-verification reports. Run focused tests, official `npm test`, strict touched-file ESLint,
`npm run build`, `git diff --check`, and `npm run compile:electron` last.

## Task 5: Manual success-path acceptance

Do not initiate a real provider call without action-time user consent. Ask the user to retry the
existing extraction or explicitly authorize the assistant to click the send action. Verify facts,
evidence, confirmation, archive/history, metrics, and privacy behavior without exposing raw content.
