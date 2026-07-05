# Enterprise Lead Knowledge Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the enterprise lead workspace knowledge base from a read-only card wall into a workspace-local maintenance surface for company profile knowledge.

**Architecture:** Persist first-version knowledge edits by updating `EnterpriseLeadWorkspaceProfile`, because existing knowledge sections are already derived from workspace profile data. Keep run deliverables, archives, and source materials read-only in this pass, while profile-backed knowledge can be added, edited, confirmed, and archived by mutating profile fields. The UI mirrors the approved HTML prototype with category navigation, searchable list, detail panel, and an add/edit modal.

**Tech Stack:** Electron IPC, SQLite-backed main process store, React + TypeScript + Tailwind renderer, Vitest.

---

## File Structure

- Modify `src/shared/enterpriseLeadWorkspace/constants.ts`: add a profile update IPC channel constant.
- Modify `src/shared/enterpriseLeadWorkspace/types.ts`: expose profile update input through the existing workspace profile type.
- Modify `src/main/enterpriseLeadWorkspace/store.ts`: add `updateWorkspaceProfile(workspaceId, profile)`.
- Modify `src/main/enterpriseLeadWorkspace/service.ts`: expose `updateWorkspaceProfile`.
- Modify `src/main/enterpriseLeadWorkspace/ipcHandlers.ts`: add IPC handler for profile updates.
- Modify `src/main/main.ts`: wire the service method into handler registration.
- Modify `src/main/preload.ts`: expose `updateWorkspaceProfile`.
- Modify `src/renderer/types/electron.d.ts`: type the new preload method.
- Modify `src/renderer/services/enterpriseLeadWorkspace.ts`: add renderer service wrapper.
- Modify `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.tsx`: replace read-only card grid with profile-backed maintenance UI.
- Modify `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`: add metadata helpers for profile-backed editable knowledge items.
- Modify `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`: cover editable knowledge item metadata.
- Modify `src/main/enterpriseLeadWorkspace/store.test.ts`: cover profile persistence.
- Modify `src/renderer/services/i18n.ts`: add zh/en strings used by the new UI.

## Task 1: Persist Workspace Profile Updates

**Files:**
- Modify: `src/main/enterpriseLeadWorkspace/store.test.ts`
- Modify: `src/main/enterpriseLeadWorkspace/store.ts`
- Modify: `src/main/enterpriseLeadWorkspace/service.ts`
- Modify: `src/main/enterpriseLeadWorkspace/ipcHandlers.ts`
- Modify: `src/shared/enterpriseLeadWorkspace/constants.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Modify: `src/renderer/services/enterpriseLeadWorkspace.ts`
- Modify: `src/main/main.ts`

- [ ] **Step 1: Write failing store test**

Add a Vitest case in `src/main/enterpriseLeadWorkspace/store.test.ts`:

```ts
test('updateWorkspaceProfile persists workspace-local profile knowledge', () => {
  const profile = createProfile();
  const workspace = store.createWorkspace({
    name: '华南重包获客工作台',
    type: EnterpriseLeadWorkspaceType.EnterpriseLead,
    profile,
    extractionSources: [],
    enabledAgentRoles: [EnterpriseLeadAgentRole.ProductUnderstanding],
  });

  const updated = store.updateWorkspaceProfile(workspace.id, {
    ...profile,
    companySummary: '更新后的企业画像',
    productList: ['精密金属支架'],
    prohibitedClaims: ['不能承诺最低价'],
  });

  expect(updated.profile.companySummary).toBe('更新后的企业画像');
  expect(updated.profile.productList).toEqual(['精密金属支架']);
  expect(updated.profile.prohibitedClaims).toEqual(['不能承诺最低价']);
  expect(updated.updatedAt).not.toBe(workspace.updatedAt);
  expect(store.getWorkspace(workspace.id)?.profile).toEqual(updated.profile);
});
```

- [ ] **Step 2: Run failing test**

Run: `npm test -- src/main/enterpriseLeadWorkspace/store.test.ts`

Expected: fails because `updateWorkspaceProfile` does not exist.

- [ ] **Step 3: Implement profile update**

Add `updateWorkspaceProfile(workspaceId: string, profile: EnterpriseLeadWorkspaceProfile)` to the store and service. The store updates only `profile` and `updated_at`, then returns the refreshed workspace.

- [ ] **Step 4: Add IPC/preload/service plumbing**

Add `EnterpriseLeadWorkspaceIpc.UpdateWorkspaceProfile`, handler input validation, preload method, renderer type declaration, renderer service wrapper, and main handler registration.

- [ ] **Step 5: Verify persistence test passes**

Run: `npm test -- src/main/enterpriseLeadWorkspace/store.test.ts`

Expected: pass.

## Task 2: Add Editable Knowledge Metadata Helpers

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`

- [ ] **Step 1: Write failing helper test**

Add a test that resolves editable profile field metadata:

```ts
test('maps editable knowledge kinds to profile fields', () => {
  expect(getEditableKnowledgeField(EnterpriseLeadKnowledgeItemKind.CompanySummary))
    .toEqual({ field: 'companySummary', multiValue: false });
  expect(getEditableKnowledgeField(EnterpriseLeadKnowledgeItemKind.Product))
    .toEqual({ field: 'productList', multiValue: true });
  expect(getEditableKnowledgeField(EnterpriseLeadKnowledgeItemKind.ContactRule))
    .toEqual({ field: 'contactRules', multiValue: true });
  expect(getEditableKnowledgeField(EnterpriseLeadKnowledgeItemKind.Source)).toBeNull();
});
```

- [ ] **Step 2: Run failing helper test**

Run: `npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

Expected: fails because `getEditableKnowledgeField` does not exist.

- [ ] **Step 3: Implement helper**

Export `getEditableKnowledgeField(kind)` and `EditableKnowledgeField` type from `enterpriseLeadWorkspaceUi.ts`.

- [ ] **Step 4: Verify helper test passes**

Run: `npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`

Expected: pass.

## Task 3: Replace Knowledge Base UI With Maintenance Console

**Files:**
- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.tsx`
- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Add UI strings**

Add zh/en strings for search, filters, add/edit modal, company material fields, status, actions, and save feedback.

- [ ] **Step 2: Implement local editable state**

Use the workspace prop as initial state and keep `currentWorkspace` in component state. Refresh it after `enterpriseLeadWorkspaceService.updateWorkspaceProfile` returns.

- [ ] **Step 3: Implement category/list/detail layout**

Render category navigation, searchable item list, detail panel, and read-only labeling for source/deliverable/archive items.

- [ ] **Step 4: Implement add/edit/company modal**

Support:
- `维护公司资料`: edits `companySummary`, `productList`, `targetCustomers`, `sellingPoints`, `prohibitedClaims`, and `contactRules`.
- `添加内容`: appends one item into the selected profile field.
- `编辑`: updates the selected profile-backed item.
- `归档`: removes the selected profile-backed item from the profile field.
- `确认入库`: marks the selected profile-backed item as saved by updating the profile timestamp.

- [ ] **Step 5: Verify renderer type safety**

Run: `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/renderer/services/enterpriseLeadWorkspace.ts src/renderer/types/electron.d.ts src/renderer/services/i18n.ts`

Expected: pass for touched renderer files.

## Task 4: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- src/main/enterpriseLeadWorkspace/store.test.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: pass.

- [ ] **Step 2: Run changed TypeScript lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/shared/enterpriseLeadWorkspace/constants.ts src/shared/enterpriseLeadWorkspace/types.ts src/main/enterpriseLeadWorkspace/store.ts src/main/enterpriseLeadWorkspace/service.ts src/main/enterpriseLeadWorkspace/ipcHandlers.ts src/main/preload.ts src/main/main.ts src/renderer/services/enterpriseLeadWorkspace.ts src/renderer/types/electron.d.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceKnowledgeBase.tsx src/renderer/services/i18n.ts
```

Expected: pass or only pre-existing unrelated warnings clearly reported.

- [ ] **Step 3: Manual UI check**

Start the app with `npm run electron:dev` if the user wants a live app check. Verify knowledge page supports company material maintenance, add, edit, archive, and confirm actions.
