# Knowledge Base Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve LobsterAI's knowledge-base output quality by making enterprise workspace knowledge source identity
stable, cleaning vector lifecycle state, prioritizing confirmed facts and hard rules, and adding focused regression
coverage.

**Architecture:** Keep the existing four-layer design: OpenClaw memory files, enterprise workspace profile, content
knowledge vector store, and prompt-time evidence bridges. Add small, local contracts around source identity, scope
cleanup, retrieval ranking, and always-on workspace rule injection instead of replacing the retrieval system.

**Tech Stack:** Electron main process, React renderer, TypeScript, better-sqlite3, Vitest, existing content knowledge
hash/vector retrieval.

## Global Constraints

- Do not create commits until the user has tested and explicitly confirmed.
- Keep changes scoped to enterprise workspace knowledge, content knowledge retrieval, and knowledge prompt injection.
- Do not introduce a network dependency or remote embedding provider in this phase.
- Do not hardcode new renderer UI strings; use `src/renderer/services/i18n.ts` if user-facing copy is added.
- Touched TypeScript files must pass
  `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 <files>`.
- Use existing constants and `as const` objects for discriminants and source types.

---

## File Structure

- Modify `src/shared/enterpriseLeadWorkspace/types.ts`: add stable source id and optional provenance metadata to
  `EnterpriseLeadExtractionSource`.
- Modify `src/shared/enterpriseLeadWorkspace/validation.ts`: preserve existing source ids and normalize legacy sources
  safely.
- Modify `src/main/enterpriseLeadWorkspace/service.ts`: generate stable source ids, use them for vector source ids,
  index confirmed profile facts, and clear vector scope on workspace deletion.
- Modify `src/main/libs/contentKnowledgeRetrieval.ts`: add source metadata/priority fields and use them in source
  scoring.
- Modify `src/main/libs/contentKnowledgeVectorStore.ts`: persist source metadata needed for ranking and add
  `deleteScope(scopeId)`.
- Modify `src/main/libs/agentKnowledgeEvidencePrompt.ts`: always inject a compact active workspace profile/rules digest
  when an enterprise scope is active, while keeping raw chunk retrieval trigger-based.
- Modify tests:
  - `src/shared/enterpriseLeadWorkspace/validation.test.ts`
  - `src/main/enterpriseLeadWorkspace/service.test.ts`
  - `src/main/libs/contentKnowledgeRetrieval.test.ts`
  - `src/main/libs/agentKnowledgeEvidencePrompt.test.ts`

---

## Task 1: Stable Enterprise Knowledge Source Identity

**Files:**

- Modify: `src/shared/enterpriseLeadWorkspace/types.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/validation.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Test: `src/shared/enterpriseLeadWorkspace/validation.test.ts`
- Test: `src/main/enterpriseLeadWorkspace/service.test.ts`

**Interfaces:**

- Produces: `EnterpriseLeadExtractionSource.id?: string`
- Produces: `ensureEnterpriseLeadSourceIds(sources: EnterpriseLeadExtractionSource[]): EnterpriseLeadExtractionSource[]`
- Consumes existing: `normalizeEnterpriseLeadExtractionSource(value: unknown): EnterpriseLeadExtractionSource`

- [ ] **Step 1: Add failing validation coverage**

Add tests proving source ids are preserved and missing ids are filled during workspace/service operations:

```ts
expect(normalizeEnterpriseLeadExtractionSource({ id: 'src_existing', kind: 'file', label: '资料' }).id)
  .toBe('src_existing');
```

In `service.test.ts`, update the vector sync test to assert that `updated.extractionSources[0].id` is stable after a
second `updateWorkspaceSources()` call.

- [ ] **Step 2: Add the type field**

In `EnterpriseLeadExtractionSource`, add:

```ts
id?: string;
```

- [ ] **Step 3: Preserve ids in normalization**

In `normalizeEnterpriseLeadExtractionSource`, add `id: cleanOptionalText(record.id)` to the returned object.

- [ ] **Step 4: Generate stable ids in the service**

Add a helper in `service.ts`:

```ts
const buildEnterpriseLeadSourceId = (): string => `source_${crypto.randomUUID()}`;

const ensureEnterpriseLeadSourceIds = (
  sources: EnterpriseLeadExtractionSource[],
): EnterpriseLeadExtractionSource[] =>
  sources.map(source => ({
    ...source,
    id: source.id?.trim() || buildEnterpriseLeadSourceId(),
  }));
```

Import `crypto` from Node, then call this helper in `createWorkspace`, `updateWorkspaceSources`, and
`enqueueWorkspaceDocumentProcessing` before storing or indexing sources.

- [ ] **Step 5: Replace index-based vector source ids**

Replace `buildEnterpriseWorkspaceKnowledgeSourceId(index)` usage with `source.id`. Keep a fallback only for legacy
in-memory sources:

```ts
const sourceId = source.id?.trim() || `legacy-source-${index}`;
```

- [ ] **Step 6: Verify**

Run:

```bash
npm test -- src/shared/enterpriseLeadWorkspace/validation.test.ts src/main/enterpriseLeadWorkspace/service.test.ts
```

Expected: all selected tests pass.

---

## Task 2: Vector Scope Lifecycle Cleanup

**Files:**

- Modify: `src/main/libs/contentKnowledgeVectorStore.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Test: `src/main/libs/contentKnowledgeRetrieval.test.ts`
- Test: `src/main/enterpriseLeadWorkspace/service.test.ts`

**Interfaces:**

- Produces: `ContentKnowledgeVectorStore.deleteScope(scopeId: string): number`
- Consumes existing: `buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId: string): string`

- [ ] **Step 1: Add failing vector-store test**

In `contentKnowledgeRetrieval.test.ts`, add a test that inserts chunks into two scopes, calls
`deleteScope('enterprise-workspace:a')`, and verifies only scope A is removed.

- [ ] **Step 2: Implement `deleteScope`**

Add to `ContentKnowledgeVectorStore`:

```ts
deleteScope(scopeId: string): number {
  const normalizedScopeId = scopeId.trim() || 'default';
  const result = this.db
    .prepare('DELETE FROM content_knowledge_chunks WHERE scope_id = ?')
    .run(normalizedScopeId);
  return result.changes;
}
```

- [ ] **Step 3: Clear enterprise scope on workspace deletion**

In `EnterpriseLeadWorkspaceService.deleteWorkspace`, compute the scope id and delete vector chunks after the store
deletion succeeds:

```ts
const deleted = this.store.deleteWorkspace(workspaceId);
if (deleted) {
  this.contentKnowledgeVectorStore?.deleteScope(
    buildEnterpriseLeadWorkspaceKnowledgeScopeId(workspaceId),
  );
}
return deleted;
```

- [ ] **Step 4: Add service regression coverage**

In `service.test.ts`, create a workspace with indexed source content, verify a search matches, delete the workspace,
then verify the same enterprise scope no longer matches.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- src/main/libs/contentKnowledgeRetrieval.test.ts src/main/enterpriseLeadWorkspace/service.test.ts
```

Expected: all selected tests pass.

---

## Task 3: Confirmed Facts and Hard Rules Ranking

**Files:**

- Modify: `src/main/libs/contentKnowledgeRetrieval.ts`
- Modify: `src/main/libs/contentKnowledgeVectorStore.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Test: `src/main/libs/contentKnowledgeRetrieval.test.ts`
- Test: `src/main/enterpriseLeadWorkspace/service.test.ts`

**Interfaces:**

- Produces: new `ContentKnowledgeSourceType` values:
  - `WorkspaceConfirmedProfile`
  - `WorkspaceRule`
- Produces optional fields on `ContentKnowledgeSource`:
  - `priority?: number`
  - `verifiedByUser?: boolean`
  - `evidenceTier?: 'A' | 'B' | 'C' | 'internal'`

- [ ] **Step 1: Add failing ranking tests**

Add a retrieval test with two sources: one raw document and one confirmed profile fact. Use the same prompt and assert
the confirmed profile hit ranks first.

Add a second test where a `WorkspaceRule` source containing a prohibited claim ranks above a generic raw source for a
content-generation request.

- [ ] **Step 2: Extend source and chunk types**

Add optional metadata to `ContentKnowledgeSource` and `ContentKnowledgeChunk`, then copy metadata from source to chunk
in `buildContentKnowledgeIndex`.

- [ ] **Step 3: Persist metadata in SQLite**

Add nullable columns in `content_knowledge_chunks`:

```sql
source_priority REAL DEFAULT 0,
verified_by_user INTEGER DEFAULT 0,
evidence_tier TEXT
```

Read/write these fields in `insertChunk`, `SELECT`, `ContentKnowledgeChunkRow`, and `mapRowToChunk`.

- [ ] **Step 4: Apply scoring boost**

In the source scoring section of `searchContentKnowledgeIndex`, add a bounded boost:

```ts
const metadataBoost = Math.min(0.2, Math.max(0, chunk.sourcePriority ?? 0));
const verifiedBoost = chunk.verifiedByUser ? 0.08 : 0;
```

Include these in `sourceScore` without allowing them to bypass the business-signal gate for content production.

- [ ] **Step 5: Index confirmed profile and rules**

In `syncWorkspaceSourcesToVectorIndex`, add derived sources:

```ts
{
  sourceId: `profile-confirmed:${workspaceId}`,
  sourceType: ContentKnowledgeSourceType.WorkspaceConfirmedProfile,
  label: '已确认业务知识',
  content: confirmed profile fact lines,
  priority: 0.18,
  verifiedByUser: true,
  evidenceTier: 'internal',
}
```

Also add a `WorkspaceRule` source for `prohibitedClaims` and `contactRules` with priority `0.2`.

- [ ] **Step 6: Verify**

Run:

```bash
npm test -- src/main/libs/contentKnowledgeRetrieval.test.ts src/main/enterpriseLeadWorkspace/service.test.ts
```

Expected: confirmed profile and hard rule sources rank ahead of raw source chunks while generic preferences still fail
the content-production gate.

---

## Task 4: Always-On Active Workspace Digest

**Files:**

- Modify: `src/main/libs/agentKnowledgeEvidencePrompt.ts`
- Modify: `src/main/libs/agentEngine/openclawRuntimeAdapter.ts`
- Test: `src/main/libs/agentKnowledgeEvidencePrompt.test.ts`

**Interfaces:**

- Produces: `buildEnterpriseWorkspaceDigestPrompt(input): string`
- Consumes existing: active enterprise workspace knowledge scope id passed through `sharedScopeIds`

- [ ] **Step 1: Add failing prompt tests**

Add a test for a non-trigger request such as `帮我改一下这段`. With an active enterprise workspace digest, the prompt
should include company/product/rules context but should not include raw K1 chunk diagnostics.

- [ ] **Step 2: Add digest builder**

Create a compact prompt block:

```ts
[Active workspace business facts]
- Products: ...
- Customers: ...
- Selling points: ...
- Hard rules: ...
```

Keep it short and omit empty sections. Include prohibited claims and contact rules whenever present.

- [ ] **Step 3: Wire digest into runtime prompt sections**

In `openclawRuntimeAdapter.ts`, add the digest before the current user request when an enterprise workspace is active.
Keep existing `buildAgentKnowledgeFileContextPrompt` trigger behavior unchanged for raw retrieval chunks.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- src/main/libs/agentKnowledgeEvidencePrompt.test.ts
```

Expected: active workspace facts/rules are available for ordinary edit requests, and existing content-production
preflight behavior still passes.

---

## Task 5: Quality Diagnostics and Regression Matrix

**Files:**

- Modify: `src/main/libs/contentKnowledgeRetrieval.ts`
- Modify: `src/main/libs/agentKnowledgeEvidencePrompt.ts`
- Test: `src/main/libs/contentKnowledgeRetrieval.test.ts`
- Test: `src/main/libs/agentKnowledgeEvidencePrompt.test.ts`

**Interfaces:**

- Produces diagnostics fields:
  - `confirmedHitCount`
  - `ruleHitCount`
  - `topSourceLabels`

- [ ] **Step 1: Add diagnostics tests**

Assert diagnostics include confirmed/rule hit counts and top source labels after a mixed retrieval.

- [ ] **Step 2: Extend diagnostics object**

Add fields to `ContentKnowledgeRetrievalDiagnostics`, populate them in `searchContentKnowledgeIndex`, and keep defaults
at zero/empty array.

- [ ] **Step 3: Keep diagnostics internal**

Ensure final prompt text does not expose internal table names, SQL details, embedding errors, or implementation paths.
Existing prompt tests already assert this; update them if new safe wording is added.

- [ ] **Step 4: Run the focused regression matrix**

Run:

```bash
npm test -- src/main/libs/contentKnowledgeRetrieval.test.ts src/main/libs/agentKnowledgeEvidencePrompt.test.ts src/main/enterpriseLeadWorkspace/service.test.ts src/shared/enterpriseLeadWorkspace/validation.test.ts
```

Expected: all selected tests pass.

---

## Task 6: Final Verification

**Files:**

- No product files required unless earlier tasks touched additional TypeScript files.

- [ ] **Step 1: Run changed-file lint**

Run with the final touched file list:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/enterpriseLeadWorkspace/types.ts src/shared/enterpriseLeadWorkspace/validation.ts src/main/enterpriseLeadWorkspace/service.ts src/main/libs/contentKnowledgeRetrieval.ts src/main/libs/contentKnowledgeVectorStore.ts src/main/libs/agentKnowledgeEvidencePrompt.ts src/main/libs/agentEngine/openclawRuntimeAdapter.ts src/shared/enterpriseLeadWorkspace/validation.test.ts src/main/enterpriseLeadWorkspace/service.test.ts src/main/libs/contentKnowledgeRetrieval.test.ts src/main/libs/agentKnowledgeEvidencePrompt.test.ts
```

Expected: no ESLint errors or warnings in touched TypeScript files.

- [ ] **Step 2: Run official tests if time allows**

Run:

```bash
npm test
```

Expected: Vitest suite passes, or any unrelated existing failures are documented with the focused test result above.

- [ ] **Step 3: Manual product check**

Start the app with:

```bash
npm run electron:dev
```

Expected manual behavior:

- Create or open an enterprise lead workspace.
- Upload or paste a source document.
- Confirm one extracted product or selling point.
- Ask for a content draft and verify the answer uses confirmed facts.
- Delete the workspace and verify no stale workspace knowledge appears in a new unrelated workspace.

---

## Rollout Notes

- Phase 1 should include Tasks 1 and 2 only. It improves correctness and data hygiene with low prompt risk.
- Phase 2 should include Task 3. It changes retrieval ranking, so focused tests are required before UI testing.
- Phase 3 should include Tasks 4 and 5. It affects model context, so it should be manually tested with short edit
  requests and content-production requests.
- Do not add semantic embedding or external research persistence in this plan; those belong in a later plan after the
  current knowledge contracts are stable.
