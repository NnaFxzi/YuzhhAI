# Workspace Material Multi-File Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users select multiple mainstream-format files (PDF, images, spreadsheets, documents, plain text) when
creating a workspace, with per-file 50MB client-side validation and per-source processing.

**Architecture:** Extend the existing `createWorkspace` IPC contract to accept either the legacy singular `source` or a
new `extractionSources[]` array. Add a controlled `WorkspaceMaterialUpload` component that uses
`dialogApi.selectFiles` (with browser fallback) and a new helper `createWorkspaceFromUploadedMaterials` that maps each
file to its own `extractionSource`. Existing `createWorkspaceFromUploadedMaterial` (singular) stays as a thin
compatibility wrapper.

**Tech Stack:** React 18 (controlled components), Heroicons, Electron IPC, Vitest (pure logic only — no DOM test env in
this project).

## Global Constraints

- **Code style**: 2-space indent, single quotes, semicolons, PascalCase components, camelCase functions. Match existing
  `WorkspaceCreate.tsx` and `WorkspaceKnowledgeBase.tsx` style.
- **i18n**: Every user-visible string must use `t()` from `src/renderer/services/i18n.ts`. Add both `zh` and `en`
  entries.
- **Lint**: Each touched file must pass
  `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 <file>`.
- **Tests**: Vitest, `src/**/*.test.ts` colocated with source. No `.test.tsx` (project's vitest config has
  `environment: 'node'`).
- **AGENTS.md reminder**: `WorkspaceCreate.tsx` is already 928 lines; do not grow it past ~1000 lines — extract the
  multi-file UI into `WorkspaceMaterialUpload.tsx`.
- **Constants**: Use `EnterpriseLead*` constants from `src/shared/enterpriseLeadWorkspace/constants.ts`; do not hardcode
  extension lists.
- **Logging**: `console.error` for failures, `console.warn` for recoverable. Tag prefix `[EnterpriseLeadWorkspace]`.
- **Existing patterns**: `WorkspaceKnowledgeBase.tsx` already has `selectDocumentFile` doing the same per-extension
  dispatch — mirror its branching logic.
- **Frequent commits**: One commit per task (Conventional Commits in English, no `Co-Authored-By`).

---

## Task 1: Extend normalizeWorkspaceDraftInput to accept extractionSources

**Files:**

- Modify: `src/shared/enterpriseLeadWorkspace/validation.ts:850-876`
- Test: `src/shared/enterpriseLeadWorkspace/validation.test.ts` (extend existing file)

**Interfaces:**

- Consumes: existing `normalizeEnterpriseLeadExtractionSource(value)` at line ~830.
- Produces: `EnterpriseLeadWorkspaceDraft` now carries an optional
  `extractionSources?: EnterpriseLeadExtractionSource[]` field used by the renderer for multi-file uploads. The existing
  `source` field is preserved for callers that only have a single input.

- [ ] **Step 1: Write the failing test**

Append to `src/shared/enterpriseLeadWorkspace/validation.test.ts` (find the existing describe block; add a new test
inside it):

```ts
import type { EnterpriseLeadExtractionSource } from './types';

test('normalizeWorkspaceDraftInput accepts pre-built extractionSources array', () => {
  const sources: EnterpriseLeadExtractionSource[] = [
    {
      kind: 'file',
      label: '产品手册.pdf',
      fileName: '产品手册.pdf',
      filePath: '/tmp/产品手册.pdf',
      text: '主营产品：精密五金',
      extractionStatus: 'pending',
      vectorIndexStatus: 'pending',
    },
    {
      kind: 'image',
      label: '聊天截图.png',
      fileName: '聊天截图.png',
      filePath: '/tmp/聊天截图.png',
    },
  ];

  const draft = normalizeWorkspaceDraftInput({
    name: '华东线索',
    source: { kind: 'manual', label: 'fallback', text: '' },
    extractionSources: sources,
  });

  expect(draft.name).toBe('华东线索');
  expect(draft.source).toEqual({
    kind: 'manual',
    label: 'fallback',
    text: undefined,
  });
  // extractionSources is preserved on the draft (loose check; renderer forwards as-is)
  expect((draft as { extractionSources?: EnterpriseLeadExtractionSource[] }).extractionSources).toEqual(sources);
});

test('normalizeWorkspaceDraftInput works without extractionSources (legacy)', () => {
  const draft = normalizeWorkspaceDraftInput({
    name: 'legacy',
    source: { kind: 'file', label: 'a', text: 'hello' },
  });

  expect(draft.source.kind).toBe('file');
  expect(draft.source.text).toBe('hello');
  expect((draft as { extractionSources?: EnterpriseLeadExtractionSource[] }).extractionSources).toBeUndefined();
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
npx vitest run src/shared/enterpriseLeadWorkspace/validation.test.ts
```

Expected: FAIL — the second `expect` checking `(draft as ...).extractionSources` will fail because the type doesn't
allow it, and the runtime will drop the field.

- [ ] **Step 3: Extend the normalizeWorkspaceDraftInput return to preserve extractionSources**

Edit `src/shared/enterpriseLeadWorkspace/validation.ts`, replace the return at lines 863-875:

```ts
  return {
    name,
    type: EnterpriseLeadWorkspaceType.EnterpriseLead,
    profile: normalizeWorkspaceProfile(record.profile),
    source: normalizedSource,
    enabledAgentRoles: Array.isArray(record.enabledAgentRoles)
      ? Array.from(new Set(record.enabledAgentRoles.map(cleanText).filter(Boolean)))
      : [],
    workspaceAgents: normalizeEnterpriseLeadWorkspaceAgents(record.workspaceAgents),
    ...(Array.isArray(record.extractionSources)
      ? { extractionSources: normalizeEnterpriseLeadExtractionSources(record.extractionSources) }
      : {}),
    ...(isRecord(record.settings)
      ? { settings: normalizeEnterpriseLeadWorkspaceSettings(record.settings) }
      : {}),
  };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/shared/enterpriseLeadWorkspace/validation.test.ts
```

Expected: PASS for the two new tests; existing tests in the file still pass.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint --ext ts --report-unused-disable-directives --max-warnings 0 src/shared/enterpriseLeadWorkspace/validation.ts src/shared/enterpriseLeadWorkspace/validation.test.ts
git add src/shared/enterpriseLeadWorkspace/validation.ts src/shared/enterpriseLeadWorkspace/validation.test.ts
git commit -m "feat(workspace): accept extractionSources on workspace draft input"
```

---

## Task 2: Extend EnterpriseLeadWorkspaceDraft type and service.createWorkspace

**Files:**

- Modify: `src/shared/enterpriseLeadWorkspace/types.ts:102-112`
- Modify: `src/main/enterpriseLeadWorkspace/service.ts:588-607`

**Interfaces:**

- Consumes: `buildInitialEnterpriseLeadExtractionSources` at line 153 (single-source path) and
  `normalizeEnterpriseLeadExtractionSources` from validation.ts.
- Produces: `service.createWorkspace(draft)` persists `draft.extractionSources` directly when present, else falls back
  to `buildInitialEnterpriseLeadExtractionSources(draft.source)`.

- [ ] **Step 1: Add extractionSources field to EnterpriseLeadWorkspaceDraft type**

Edit `src/shared/enterpriseLeadWorkspace/types.ts`, replace lines 102-112:

```ts
export interface EnterpriseLeadWorkspaceDraft {
  id?: string;
  name: string;
  type: EnterpriseLeadWorkspaceType | string;
  profile: EnterpriseLeadWorkspaceProfile;
  source: EnterpriseLeadExtractionSource;
  extractionSources?: EnterpriseLeadExtractionSource[];
  enabledAgentRoles: Array<EnterpriseLeadAgentRole | string>;
  settings?: EnterpriseLeadWorkspaceSettings;
  workspaceAgents: EnterpriseLeadWorkspaceAgentBinding[];
  createdAt?: string;
}
```

- [ ] **Step 2: Update service.createWorkspace to prefer draft.extractionSources**

Edit `src/main/enterpriseLeadWorkspace/service.ts`, replace lines 588-607:

```ts
  createWorkspace(draft: unknown): EnterpriseLeadWorkspace {
    const normalizedDraft = normalizeWorkspaceDraftInput(draft);

    const initialSources =
      Array.isArray(normalizedDraft.extractionSources) && normalizedDraft.extractionSources.length > 0
        ? normalizedDraft.extractionSources
        : buildInitialEnterpriseLeadExtractionSources(normalizedDraft.source);

    const workspace = this.store.createWorkspace({
      name: normalizedDraft.name,
      type: EnterpriseLeadWorkspaceType.EnterpriseLead,
      profile: normalizedDraft.profile,
      extractionSources: initialSources,
      enabledAgentRoles: normalizedDraft.enabledAgentRoles,
      settings: normalizedDraft.settings,
      workspaceAgents: normalizedDraft.workspaceAgents,
    });
    if (!this.contentKnowledgeVectorStore) {
      return workspace;
    }
    return this.store.updateWorkspaceSources(
      workspace.id,
      this.syncWorkspaceSourcesToVectorIndex(workspace.id, workspace.extractionSources),
    );
  }
```

- [ ] **Step 3: Run existing main tests for service**

```bash
npx vitest run src/main/enterpriseLeadWorkspace/service.test.ts
```

Expected: PASS — the change preserves the legacy behavior when `extractionSources` is absent.

- [ ] **Step 4: Lint and commit**

```bash
npx eslint --ext ts --report-unused-disable-directives --max-warnings 0 src/shared/enterpriseLeadWorkspace/types.ts src/main/enterpriseLeadWorkspace/service.ts
git add src/shared/enterpriseLeadWorkspace/types.ts src/main/enterpriseLeadWorkspace/service.ts
git commit -m "feat(workspace): persist extractionSources from workspace draft"
```

---

## Task 3: Add new constants and MaterialUploadItem type in enterpriseLeadWorkspaceUi.ts

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts` (append near the existing
  `WorkspaceCreateStartMode` const around line 43)
- Modify: `src/main/libs/documentTextExtractor.ts` (no actual code change; export already exists)

**Interfaces:**

- Consumes: `EnterpriseLeadReadableDocumentExtensions`, `EnterpriseLeadImageAttachmentExtensions`,
  `EnterpriseLeadAttachmentOnlyDocumentExtensions`, `MAX_RICH_DOCUMENT_BYTES` (existing exports).
- Produces: `MaterialUploadItem` type and three exported constants (`ENTERPRISE_LEAD_MATERIAL_ACCEPT_EXTENSIONS`,
  `ENTERPRISE_LEAD_MATERIAL_DIALOG_FILTERS`, `MAX_MATERIAL_UPLOAD_BYTES`).

- [ ] **Step 1: Add the new imports and types**

Edit `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`. Replace the import block at lines
5-15:

```ts
import {
  EnterpriseLeadAgentRole,
  type EnterpriseLeadAgentRole as EnterpriseLeadAgentRoleType,
  EnterpriseLeadAttachmentOnlyDocumentExtension,
  EnterpriseLeadAttachmentOnlyDocumentExtensions,
  EnterpriseLeadContentPlatformId,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadImageAttachmentExtensions,
  EnterpriseLeadReadableDocumentExtensions,
  EnterpriseLeadResearchCapabilityId,
  EnterpriseLeadSkillCapabilityId,
  EnterpriseLeadTaskStatus,
  type EnterpriseLeadTaskStatus as EnterpriseLeadTaskStatusType,
  EnterpriseLeadWorkspaceType,
} from '../../../shared/enterpriseLeadWorkspace/constants';
```

- [ ] **Step 2: Add the new constants and type at the end of the const/type exports block**

Insert after line 57 (after `export type WorkspaceCreateBranchScreen = ...`), before
`export const EnterpriseLeadWorkspaceShellMode`:

```ts
export const MAX_MATERIAL_UPLOAD_BYTES = 50 * 1024 * 1024;

export const ENTERPRISE_LEAD_MATERIAL_ACCEPT_EXTENSIONS = [
  ...EnterpriseLeadReadableDocumentExtensions,
  ...EnterpriseLeadImageAttachmentExtensions,
  ...EnterpriseLeadAttachmentOnlyDocumentExtensions,
] as const;

export const ENTERPRISE_LEAD_MATERIAL_DIALOG_FILTERS = [
  {
    name: 'enterpriseLeadMaterialFilterDocuments',
    extensions: [...EnterpriseLeadReadableDocumentExtensions],
  },
  {
    name: 'enterpriseLeadMaterialFilterImages',
    extensions: [...EnterpriseLeadImageAttachmentExtensions],
  },
  {
    name: 'enterpriseLeadMaterialFilterAllFiles',
    extensions: ['*'],
  },
] as const;

export interface MaterialUploadItem {
  id: string;
  filePath: string;
  fileName: string;
  fileSize: number | null;
  kind:
    | typeof EnterpriseLeadExtractionSourceKind.File
    | typeof EnterpriseLeadExtractionSourceKind.Image;
  text?: string;
  truncated?: boolean;
}
```

- [ ] **Step 3: Lint to confirm types compile**

```bash
npx eslint --ext ts --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts
```

Expected: PASS with no errors. If the `EnterpriseLeadAttachmentOnlyDocumentExtensions` symbol does not exist yet, see
Step 1b below.

- [ ] **Step 1b (only if Step 3 fails): export EnterpriseLeadAttachmentOnlyDocumentExtensions**

This array may not exist yet. If lint complains, add it to `src/shared/enterpriseLeadWorkspace/constants.ts` after line
200:

```ts
export const EnterpriseLeadAttachmentOnlyDocumentExtensions = [
  EnterpriseLeadAttachmentOnlyDocumentExtension.Doc,
  EnterpriseLeadAttachmentOnlyDocumentExtension.Ppt,
] as const;
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/shared/enterpriseLeadWorkspace/constants.ts 2>/dev/null || git add src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts
git commit -m "feat(workspace): add MaterialUploadItem type and material filter constants"
```

---

## Task 4: Add createWorkspaceFromUploadedMaterials helper (TDD)

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts` (append near
  `buildManualEnterpriseLeadWorkspaceDraft` at line 331)
- Test: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts` (extend)

**Interfaces:**

- Consumes: `MaterialUploadItem` (Task 3), `buildManualEnterpriseLeadWorkspaceDraft` (existing),
  `enterpriseLeadWorkspaceService.processDocumentSource`.
- Produces: `createWorkspaceFromUploadedMaterials(input)` — calls `service.createWorkspace` with all sources, then fires
  `processDocumentSource` per source with text, then `onCreated`. Returns the workspace or null.

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts` (create the describe block
if absent; place after the existing tests):

```ts
import { vi } from 'vitest';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import {
  createWorkspaceFromUploadedMaterials,
  type MaterialUploadItem,
  WorkspaceCreateStartMode,
} from './enterpriseLeadWorkspaceUi';

const stubWindow = (api: Record<string, unknown>): void => {
  vi.stubGlobal('window', { electron: { enterpriseLeadWorkspace: api } });
};

const buildWorkspace = (
  sources: Array<{ kind: string; label: string; text?: string }>,
): unknown => ({
  id: 'ws-1',
  name: '华东线索',
  type: 'enterprise_lead',
  profile: {
    companySummary: '',
    productList: [],
    productCapabilities: [],
    targetCustomers: [],
    applicationScenarios: [],
    sellingPoints: [],
    channelPreferences: [],
    prohibitedClaims: [],
    contactRules: [],
    missingInfo: [],
  },
  extractionSources: sources.map((s, i) => ({ id: `s-${i}`, ...s })),
  riskRules: [],
  enabledAgentRoles: [],
  workspaceAgents: [],
  settings: {},
  recentRunId: null,
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
});

describe('createWorkspaceFromUploadedMaterials', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('creates a workspace with all materials as separate extractionSources', async () => {
    const createWorkspace = vi.fn(async () => ({ success: true, data: buildWorkspace([]) }));
    stubWindow({ createWorkspace });

    const items: MaterialUploadItem[] = [
      { id: 'a', filePath: '/p/a.pdf', fileName: 'a.pdf', fileSize: 100, kind: 'file', text: '主营' },
      { id: 'b', filePath: '/p/b.png', fileName: 'b.png', fileSize: 50, kind: 'image' },
    ];

    const onCreated = vi.fn();
    await createWorkspaceFromUploadedMaterials({
      workspaceName: 'ws',
      items,
      onCreated,
      service: enterpriseLeadWorkspaceService,
    });

    expect(createWorkspace).toHaveBeenCalledTimes(1);
    const arg = createWorkspace.mock.calls[0]?.[0] as { extractionSources?: unknown[] };
    expect(Array.isArray(arg.extractionSources)).toBe(true);
    expect(arg.extractionSources).toHaveLength(2);
    expect(onCreated).toHaveBeenCalledWith('ws-1');
  });

  test('processes each source that has text; swallows per-source failures', async () => {
    const created = buildWorkspace([
      { kind: 'file', label: 'a', text: 'foo' },
      { kind: 'image', label: 'b' },
    ]);
    const createWorkspace = vi.fn(async () => ({ success: true, data: created }));
    const processDocumentSource = vi.fn(async () => ({ success: true, data: created }));
    stubWindow({ createWorkspace, processDocumentSource });

    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await createWorkspaceFromUploadedMaterials({
      workspaceName: 'ws',
      items: [
        { id: 'a', filePath: '/p/a', fileName: 'a', fileSize: 1, kind: 'file', text: 'foo' },
        { id: 'b', filePath: '/p/b', fileName: 'b', fileSize: 1, kind: 'image' },
      ],
      onCreated: vi.fn(),
      service: enterpriseLeadWorkspaceService,
    });

    // Only the source with text triggers processing
    expect(processDocumentSource).toHaveBeenCalledTimes(1);
    expect(processDocumentSource).toHaveBeenCalledWith('ws-1', expect.any(Array), 0);

    // Now confirm the swallowed-failure path
    processDocumentSource.mockRejectedValueOnce(new Error('boom'));
    await createWorkspaceFromUploadedMaterials({
      workspaceName: 'ws',
      items: [
        { id: 'c', filePath: '/p/c', fileName: 'c', fileSize: 1, kind: 'file', text: 'bar' },
      ],
      onCreated: vi.fn(),
      service: enterpriseLeadWorkspaceService,
    });
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to queue uploaded material processing'),
      expect.any(Error),
    );
  });

  test('returns null and skips onCreated when createWorkspace reports failure', async () => {
    const createWorkspace = vi.fn(async () => ({ success: false, error: 'db down' }));
    stubWindow({ createWorkspace });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const onCreated = vi.fn();
    const result = await createWorkspaceFromUploadedMaterials({
      workspaceName: 'ws',
      items: [
        { id: 'a', filePath: '/p/a', fileName: 'a', fileSize: 1, kind: 'file', text: 'x' },
      ],
      onCreated,
      service: enterpriseLeadWorkspaceService,
    });

    expect(result).toBeNull();
    expect(onCreated).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('createWorkspace failed'),
      'db down',
    );
  });

  test('first item label is used as the seed sourceLabel fallback', async () => {
    const createWorkspace = vi.fn(async () => ({ success: true, data: buildWorkspace([]) }));
    stubWindow({ createWorkspace });

    await createWorkspaceFromUploadedMaterials({
      workspaceName: 'ws',
      items: [
        { id: 'first', filePath: '/p/first', fileName: 'first.pdf', fileSize: 1, kind: 'file', text: 'x' },
      ],
      onCreated: vi.fn(),
      service: enterpriseLeadWorkspaceService,
    });

    const arg = createWorkspace.mock.calls[0]?.[0] as {
      source?: { label?: string };
      extractionSources?: Array<{ label?: string }>;
    };
    expect(arg.extractionSources?.[0]?.label).toBe('first.pdf');
  });
});
```

Note: `enterpriseLeadWorkspaceService` is already exported from `src/renderer/services/enterpriseLeadWorkspace.ts`. The
`processDocumentSource` method checks `typeof api.processDocumentSource !== 'function'` and throws; our stub provides
the function so the helper can call it.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: FAIL with `createWorkspaceFromUploadedMaterials is not exported`.

- [ ] **Step 3: Add the helper to enterpriseLeadWorkspaceUi.ts**

Find `buildManualEnterpriseLeadWorkspaceDraft` (line 331). Replace it (and its block) with the version that follows;
also append the new helper below it. Edit
`src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`:

Replace lines 331-357 (the entire `buildManualEnterpriseLeadWorkspaceDraft` function and its `ManualWorkspaceDraftInput`
interface above it at line 118):

Lines 118-124 already define `ManualWorkspaceDraftInput`. Keep those.

Replace lines 331-357 with:

```ts
export const buildManualEnterpriseLeadWorkspaceDraft = ({
  name,
  mode,
  sourceLabel,
  sourceText,
  settings,
}: ManualWorkspaceDraftInput): EnterpriseLeadWorkspaceDraft => {
  const trimmedName = cleanText(name);
  const trimmedSourceText = cleanText(sourceText ?? '');

  return {
    name: trimmedName || sourceLabel,
    type: EnterpriseLeadWorkspaceType.EnterpriseLead,
    profile: buildEmptyEnterpriseLeadWorkspaceProfile(),
    source: {
      kind:
        mode === WorkspaceCreateStartMode.Blank
          ? EnterpriseLeadExtractionSourceKind.Blank
          : EnterpriseLeadExtractionSourceKind.Manual,
      label: sourceLabel,
      text: trimmedSourceText || undefined,
    },
    enabledAgentRoles: [],
    settings,
    workspaceAgents: [],
  };
};

type UploadedMaterialsService = Pick<
  typeof enterpriseLeadWorkspaceService,
  'createWorkspace' | 'processDocumentSource'
>;

export interface CreateWorkspaceFromUploadedMaterialsInput {
  workspaceName: string;
  items: MaterialUploadItem[];
  settings?: EnterpriseLeadWorkspaceSettings;
  onCreated: (workspaceId: string) => void;
  service?: UploadedMaterialsService;
}

export const createWorkspaceFromUploadedMaterials = async ({
  workspaceName,
  items,
  settings,
  onCreated,
  service = enterpriseLeadWorkspaceService,
}: CreateWorkspaceFromUploadedMaterialsInput): Promise<EnterpriseLeadWorkspace | null> => {
  const now = new Date().toISOString();
  const primaryItem = items[0];
  const fallbackLabel =
    primaryItem?.fileName?.trim() || primaryItem?.filePath || workspaceName.trim();

  const baseDraft = buildManualEnterpriseLeadWorkspaceDraft({
    name: workspaceName,
    mode: WorkspaceCreateStartMode.Material,
    sourceLabel: fallbackLabel,
    settings,
  });

  const extractionSources: EnterpriseLeadExtractionSource[] = items.map(item => ({
    kind: item.kind,
    label: item.fileName?.trim() || item.filePath,
    filePath: item.filePath,
    fileName: item.fileName,
    fileSize: typeof item.fileSize === 'number' && item.fileSize > 0 ? item.fileSize : undefined,
    text: item.text?.trim() || undefined,
    ...(item.truncated ? { extractionPartial: true } : {}),
    extractionStatus: EnterpriseLeadDocumentExtractionStatus.Pending,
    vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
    createdAt: now,
    updatedAt: now,
  }));

  let workspace: EnterpriseLeadWorkspace | null = null;
  try {
    workspace = await service.createWorkspace({
      ...baseDraft,
      source: {
        kind: primaryItem?.kind ?? EnterpriseLeadExtractionSourceKind.File,
        label: fallbackLabel,
        filePath: primaryItem?.filePath,
        fileName: primaryItem?.fileName,
        fileSize:
          typeof primaryItem?.fileSize === 'number' && primaryItem.fileSize > 0
            ? primaryItem.fileSize
            : undefined,
        text: primaryItem?.text?.trim() || undefined,
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Pending,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
        createdAt: now,
        updatedAt: now,
      },
      extractionSources,
    });
  } catch (error) {
    console.error('[EnterpriseLeadWorkspace] createWorkspace failed', error);
    return null;
  }

  if (!workspace) {
    return null;
  }

  for (let i = 0; i < workspace.extractionSources.length; i += 1) {
    const source = workspace.extractionSources[i];
    if (!source?.text?.trim()) {
      continue;
    }
    void service
      .processDocumentSource(workspace.id, workspace.extractionSources, i)
      .catch(error => {
        console.warn(
          '[EnterpriseLeadWorkspace] Failed to queue uploaded material processing:',
          error,
        );
      });
  }

  onCreated(workspace.id);
  return workspace;
};
```

Add the imports needed at the top of the file (if not already present):

```ts
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import {
  EnterpriseLeadDocumentExtractionStatus,
  EnterpriseLeadKnowledgeIndexStatus,
} from '../../../shared/enterpriseLeadWorkspace/constants';
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: PASS for the four new tests. Existing tests in the file still pass.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint --ext ts --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
git add src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
git commit -m "feat(workspace): add createWorkspaceFromUploadedMaterials helper"
```

---

## Task 5: Add new i18n keys (zh + en)

**Files:**

- Modify: `src/renderer/services/i18n.ts:2839-2873` (zh) and `:7094-7129` (en)

**Interfaces:**

- Consumes: existing `enterpriseLeadCreateMaterial*` keys.
- Produces: 5 new keys for the multi-file UI feedback (add zh and en).

- [ ] **Step 1: Add zh keys**

Find the zh block at line 2867 (`enterpriseLeadCreateMaterialTypeCustomerList`). Insert after the closing line 2873 (
`enterpriseLeadCreateMaterialSourceLabel: '上传资料',`):

```ts
    enterpriseLeadMaterialListTitle: '已选择 {count} 个文件',
    enterpriseLeadMaterialAddMore: '+ 添加更多文件',
    enterpriseLeadMaterialEmpty: '未选择任何文件',
    enterpriseLeadMaterialFileSizeExceeded: '文件超过 50MB 上限：{name}',
    enterpriseLeadMaterialUnsupportedType: '不支持的文件类型：.{ext}',
    enterpriseLeadMaterialReadFailed: '读取失败：{name}',
```

- [ ] **Step 2: Add en keys**

Find the en block at line 7122 (`enterpriseLeadCreateMaterialTypeCustomerList`). Insert after line 7129 (
`enterpriseLeadCreateMaterialSourceLabel: 'Uploaded material',`):

```ts
    enterpriseLeadMaterialListTitle: '{count} files selected',
    enterpriseLeadMaterialAddMore: '+ Add more files',
    enterpriseLeadMaterialEmpty: 'No files selected',
    enterpriseLeadMaterialFileSizeExceeded: 'File exceeds 50MB limit: {name}',
    enterpriseLeadMaterialUnsupportedType: 'Unsupported file type: .{ext}',
    enterpriseLeadMaterialReadFailed: 'Failed to read: {name}',
```

- [ ] **Step 3: Verify t() calls resolve (typecheck via tsc)**

```bash
npx tsc --noEmit src/renderer/services/i18n.ts 2>/dev/null || npm run compile:electron 2>&1 | tail -20
```

Expected: no new TypeScript errors.

- [ ] **Step 4: Lint and commit**

```bash
npx eslint --ext ts --report-unused-disable-directives --max-warnings 0 src/renderer/services/i18n.ts
git add src/renderer/services/i18n.ts
git commit -m "i18n(workspace): add multi-file material upload strings"
```

---

## Task 6: Create WorkspaceMaterialUpload component

**Files:**

- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceMaterialUpload.tsx`

**Interfaces:**

- Consumes: `MaterialUploadItem`, `ENTERPRISE_LEAD_MATERIAL_ACCEPT_EXTENSIONS`,
  `ENTERPRISE_LEAD_MATERIAL_DIALOG_FILTERS`, `MAX_MATERIAL_UPLOAD_BYTES` from `enterpriseLeadWorkspaceUi.ts`.
  `window.electron?.dialog.selectFiles`, `dialog.readTextFile`, `dialog.statFile`.
- Produces: a controlled React component `<WorkspaceMaterialUpload items onItemsChange onError disabled />` that handles
  multi-file dialog + browser fallback + size/extension validation + per-file dispatch.

- [ ] **Step 1: Write the new component**

Create `src/renderer/components/enterpriseLeadWorkspace/WorkspaceMaterialUpload.tsx`:

```tsx
import {
  ArrowUpTrayIcon,
  DocumentIcon,
  PhotoIcon,
  TableCellsIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useCallback, useId, useMemo, useRef } from 'react';

import {
  EnterpriseLeadAttachmentOnlyDocumentExtensions,
  EnterpriseLeadImageAttachmentExtensions,
  EnterpriseLeadReadableDocumentExtensions,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import { i18nService } from '../../services/i18n';
import {
  ENTERPRISE_LEAD_MATERIAL_ACCEPT_EXTENSIONS,
  ENTERPRISE_LEAD_MATERIAL_DIALOG_FILTERS,
  MAX_MATERIAL_UPLOAD_BYTES,
  type MaterialUploadItem,
} from './enterpriseLeadWorkspaceUi';

interface WorkspaceMaterialUploadProps {
  items: MaterialUploadItem[];
  onItemsChange: (items: MaterialUploadItem[]) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

const ACCEPT_ATTRIBUTE = [
  ...ENTERPRISE_LEAD_MATERIAL_ACCEPT_EXTENSIONS.map(ext => `.${ext}`),
].join(',');

const READABLE_EXTENSIONS = new Set<string>(EnterpriseLeadReadableDocumentExtensions);
const IMAGE_EXTENSIONS = new Set<string>(EnterpriseLeadImageAttachmentExtensions);
const ATTACHMENT_ONLY_EXTENSIONS = new Set<string>(EnterpriseLeadAttachmentOnlyDocumentExtensions);

const ALL_SUPPORTED_EXTENSIONS = new Set<string>([
  ...READABLE_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...ATTACHMENT_ONLY_EXTENSIONS,
]);

const formatBytes = (bytes: number | null): string => {
  if (bytes === null || bytes <= 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getExtension = (fileName: string): string => {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
};

const getBaseName = (fileName: string): string => {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName;
};

const buildItemFromPath = async (
  dialogApi: Window['electron']['dialog'],
  filePath: string,
): Promise<MaterialUploadItem | null> => {
  const fileName = filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
  const extension = getExtension(fileName);
  const id = `${fileName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let fileSize: number | null = null;
  if (typeof dialogApi.statFile === 'function') {
    const stat = await dialogApi.statFile(filePath).catch(() => null);
    if (stat?.success && typeof stat.size === 'number') {
      fileSize = stat.size;
    }
  }

  if (fileSize !== null && fileSize > MAX_MATERIAL_UPLOAD_BYTES) {
    return { id, filePath, fileName, fileSize, kind: 'file', rejected: true, reason: 'oversize' } as never;
  }

  if (!ALL_SUPPORTED_EXTENSIONS.has(extension)) {
    return { id, filePath, fileName, fileSize, kind: 'file', rejected: true, reason: 'unsupported' } as never;
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    return {
      id,
      filePath,
      fileName,
      fileSize,
      kind: 'image',
    };
  }

  if (READABLE_EXTENSIONS.has(extension) && typeof dialogApi.readTextFile === 'function') {
    const readResult = await dialogApi.readTextFile(filePath);
    if (!readResult.success) {
      return { id, filePath, fileName, fileSize, kind: 'file', rejected: true, reason: 'read' } as never;
    }
    return {
      id,
      filePath,
      fileName,
      fileSize,
      kind: 'file',
      text: readResult.content ?? '',
      truncated: Boolean(readResult.truncated),
    };
  }

  // ATTACHMENT_ONLY_EXTENSIONS (doc/ppt) or readable without readTextFile
  return {
    id,
    filePath,
    fileName,
    fileSize,
    kind: 'file',
  };
};

const getFileIcon = (item: MaterialUploadItem): React.ReactNode => {
  const extension = getExtension(item.fileName);
  if (IMAGE_EXTENSIONS.has(extension)) {
    return <PhotoIcon className="h-4 w-4" />;
  }
  if (READABLE_EXTENSIONS.has(extension) && /\.(xlsx?|csv|tsv)$/.test(extension)) {
    return <TableCellsIcon className="h-4 w-4" />;
  }
  return <DocumentIcon className="h-4 w-4" />;
};

export const WorkspaceMaterialUpload: React.FC<WorkspaceMaterialUploadProps> = ({
  items,
  onItemsChange,
  onError,
  disabled = false,
}) => {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);

  const acceptAttr = useMemo(() => ACCEPT_ATTRIBUTE, []);

  const appendItems = useCallback(
    async (paths: string[]) => {
      const dialogApi = window.electron?.dialog;
      if (!dialogApi) {
        return;
      }
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      const additions: MaterialUploadItem[] = [];
      const rejections: string[] = [];

      for (const filePath of paths) {
        const built = await buildItemFromPath(dialogApi, filePath);
        if (built && (built as { rejected?: boolean }).rejected) {
          const reason = (built as { reason?: string }).reason;
          const ext = getExtension(filePath);
          if (reason === 'oversize') {
            rejections.push(i18nService.t('enterpriseLeadMaterialFileSizeExceeded', { name: filePath }));
          } else if (reason === 'unsupported') {
            rejections.push(i18nService.t('enterpriseLeadMaterialUnsupportedType', { ext }));
          } else {
            rejections.push(i18nService.t('enterpriseLeadMaterialReadFailed', { name: filePath }));
          }
          continue;
        }
        if (built) {
          additions.push(built);
        }
      }

      if (requestId !== requestIdRef.current) {
        return;
      }

      if (additions.length > 0) {
        onItemsChange([...items, ...additions]);
      }
      if (rejections.length > 0) {
        onError(rejections.join('\n'));
      }
    },
    [items, onItemsChange, onError],
  );

  const handleChooseClick = useCallback((): void => {
    const dialogApi = window.electron?.dialog;
    if (dialogApi?.selectFiles) {
      void dialogApi
        .selectFiles({
          title: i18nService.t('enterpriseLeadCreateMaterialTitle'),
          filters: [...ENTERPRISE_LEAD_MATERIAL_DIALOG_FILTERS],
        })
        .then(result => {
          if (!result.success || !Array.isArray(result.paths) || result.paths.length === 0) {
            return;
          }
          void appendItems(result.paths);
        });
      return;
    }
    fileInputRef.current?.click();
  }, [appendItems]);

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const files = event.currentTarget.files;
      event.currentTarget.value = '';
      if (!files || files.length === 0) {
        return;
      }
      const paths: string[] = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        if (!file) continue;
        const maybePath = (file as File & { path?: unknown }).path;
        if (typeof maybePath === 'string' && maybePath.length > 0) {
          paths.push(maybePath);
        }
      }
      if (paths.length > 0) {
        void appendItems(paths);
      }
    },
    [appendItems],
  );

  const handleRemove = useCallback(
    (id: string): void => {
      onItemsChange(items.filter(item => item.id !== id));
    },
    [items, onItemsChange],
  );

  const listTitle =
    items.length === 0
      ? i18nService.t('enterpriseLeadMaterialEmpty')
      : i18nService.t('enterpriseLeadMaterialListTitle', { count: items.length });

  return (
    <div className="grid gap-3">
      <button
        type="button"
        onClick={handleChooseClick}
        disabled={disabled}
        className="grid min-h-[120px] w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-5 py-4 text-left transition-colors hover:border-primary/70 hover:bg-primary/10 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="grid h-11 w-11 place-items-center rounded-full bg-surface text-primary shadow-sm">
          <ArrowUpTrayIcon className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">{listTitle}</span>
          <span className="mt-1 block text-xs leading-5 text-secondary">
            {i18nService.t('enterpriseLeadCreateMaterialDropDesc')}
          </span>
        </span>
        <span className="text-sm font-semibold text-primary">
          {i18nService.t('enterpriseLeadCreateMaterialChooseFile')}
        </span>
      </button>

      <input
        id={inputId}
        ref={fileInputRef}
        type="file"
        accept={acceptAttr}
        multiple
        className="sr-only"
        onChange={handleFileInputChange}
      />

      {items.length > 0 && (
        <ul className="grid gap-1.5 rounded-lg border border-border bg-surface px-3 py-2">
          {items.map(item => (
            <li
              key={item.id}
              className="grid grid-cols-[20px_minmax(0,1fr)_auto_auto] items-center gap-2 text-xs"
            >
              <span className="text-secondary">{getFileIcon(item)}</span>
              <span className="truncate text-foreground" title={item.fileName}>
                {getBaseName(item.fileName)}
                <span className="text-secondary">.{getExtension(item.fileName)}</span>
                {item.truncated && (
                  <span className="ml-2 rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-300">
                    truncated
                  </span>
                )}
              </span>
              <span className="text-secondary">{formatBytes(item.fileSize)}</span>
              <button
                type="button"
                onClick={() => handleRemove(item.id)}
                disabled={disabled}
                aria-label={`Remove ${item.fileName}`}
                className="grid h-6 w-6 place-items-center rounded text-secondary hover:bg-surface-raised hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <XMarkIcon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <button
          type="button"
          onClick={handleChooseClick}
          disabled={disabled}
          className="self-start text-xs font-semibold text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {i18nService.t('enterpriseLeadMaterialAddMore')}
        </button>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Lint the new component**

```bash
npx eslint --ext tsx,ts --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/WorkspaceMaterialUpload.tsx
```

Expected: PASS with no errors. If `as never` casts for the rejected items cause warnings, prefer to introduce a
discriminated union:

```ts
type BuildResult =
  | { kind: 'ok'; item: MaterialUploadItem }
  | { kind: 'rejected'; reason: 'oversize' | 'unsupported' | 'read'; name: string; ext?: string };

// Then refactor `buildItemFromPath` to return BuildResult instead of using `as never`.
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/enterpriseLeadWorkspace/WorkspaceMaterialUpload.tsx
git commit -m "feat(workspace): add WorkspaceMaterialUpload multi-file component"
```

---

## Task 7: Wire WorkspaceMaterialUpload into WorkspaceCreate.tsx

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx`

**Interfaces:**

- Consumes: `WorkspaceMaterialUpload` (Task 6), `createWorkspaceFromUploadedMaterials` (Task 4), `MaterialUploadItem`
  type.
- Produces: `WorkspaceCreate.tsx` `renderMaterialStep` uses the new component; `handleCreateFromMaterial` calls the new
  helper; legacy single-file state (`materialText`, `loadedFileName`, `loadedFileSize`) replaced with `materials`.

- [ ] **Step 1: Replace imports and remove legacy constants**

Edit `src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx`:

Replace the import block (lines 1-36):

```tsx
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  ArrowUpTrayIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  DocumentTextIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import React, { useState } from 'react';

import {
  EnterpriseLeadExtractionSourceKind,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceSettings,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import {
  buildManualEnterpriseLeadWorkspaceDraft,
  createWorkspaceFromUploadedMaterials,
  getWorkspaceCreateBranchScreen,
  type MaterialUploadItem,
  WorkspaceCreateBranchScreen,
  WorkspaceCreateStartMode,
  type WorkspaceCreateStartMode as WorkspaceCreateStartModeType,
} from './enterpriseLeadWorkspaceUi';
import { WorkspaceMaterialUpload } from './WorkspaceMaterialUpload';
import { buildEnterpriseLeadWorkspaceSettingsFromCurrentConfig } from './WorkspaceWorkbench';
```

Remove these legacy helpers/constants (lines 51-104):

- `ACCEPTED_MATERIAL_FILE_TYPES` constant
- `browserReadableMaterialExtensions` constant
- `getMaterialFileFilters()`
- `getFileNameFromPath()`
- `getMaterialFileExtension()`
- `getBrowserFilePath()`
- `UploadedMaterialWorkspaceInput` interface
- `normalizeOptionalFileSize()`

Replace them with one tiny helper for backward compat:

```ts
const normalizeOptionalFileSize = (fileSize?: number | null): number | undefined =>
  typeof fileSize === 'number' && Number.isFinite(fileSize) && fileSize > 0 ? fileSize : undefined;
```

Keep `createWorkspaceFromUploadedMaterial` (the legacy singular export). Replace its body to delegate to the plural
helper:

```ts
export const createWorkspaceFromUploadedMaterial = async ({
  workspaceName,
  sourceText,
  sourceLabel,
  fileName,
  fileSize,
  settings,
  onCreated,
  service = enterpriseLeadWorkspaceService,
}: {
  workspaceName: string;
  sourceText: string;
  sourceLabel: string;
  fileName?: string;
  fileSize?: number | null;
  settings?: EnterpriseLeadWorkspaceSettings;
  onCreated: (workspaceId: string) => void;
  service?: Pick<typeof enterpriseLeadWorkspaceService, 'createWorkspace' | 'processDocumentSource'>;
}): Promise<EnterpriseLeadWorkspace | null> => {
  const cleanSourceText = sourceText.trim();
  if (!cleanSourceText) {
    throw new Error('Uploaded material text is required');
  }

  return createWorkspaceFromUploadedMaterials({
    workspaceName,
    items: [
      {
        id: 'singular-legacy',
        filePath: '',
        fileName: fileName?.trim() || sourceLabel.trim(),
        fileSize: normalizeOptionalFileSize(fileSize),
        kind: EnterpriseLeadExtractionSourceKind.File,
        text: cleanSourceText,
      },
    ],
    settings,
    onCreated,
    service,
  });
};
```

- [ ] **Step 2: Replace state and handlers**

Replace the `WorkspaceCreate` function body's state and handler declarations. Find lines 198-356 (state declarations,
helpers, file change handler) and replace with:

```tsx
export const WorkspaceCreate: React.FC<WorkspaceCreateProps> = ({ onCreated, onCancel }) => {
  const [workspaceName, setWorkspaceName] = useState('');
  const [selectedMode, setSelectedMode] = useState<WorkspaceCreateStartModeType>(
    WorkspaceCreateStartMode.Material,
  );
  const [branchScreen, setBranchScreen] = useState<WorkspaceCreateBranchScreen | null>(null);
  const [materials, setMaterials] = useState<MaterialUploadItem[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const workspaceDisplayName =
    workspaceName.trim() || i18nService.t('enterpriseLeadCreateDefaultWorkspaceName');
  const isBusy = isCreating;

  const handleCancel = (): void => {
    if (isBusy) {
      return;
    }
    onCancel();
  };

  const handleNext = (): void => {
    setError('');
    setBranchScreen(getWorkspaceCreateBranchScreen(selectedMode));
  };

  const handleBackToDetails = (): void => {
    setError('');
    setBranchScreen(null);
  };

  const createWorkspaceFromDraft = async (draft: EnterpriseLeadWorkspaceDraft): Promise<void> => {
    setIsCreating(true);
    setError('');

    try {
      const workspace = await enterpriseLeadWorkspaceService.createWorkspace(draft);
      if (!workspace) {
        setError(i18nService.t('enterpriseLeadCreateFailed'));
        return;
      }

      onCreated(workspace.id);
    } catch {
      setError(i18nService.t('enterpriseLeadCreateFailed'));
    } finally {
      setIsCreating(false);
    }
  };

  const createWorkspaceFromExtractedText = async (
    sourceText: string,
    sourceKind: EnterpriseLeadExtractionSourceKind,
    sourceLabel: string,
  ): Promise<void> => {
    const cleanSourceText = sourceText.trim();
    if (!cleanSourceText) {
      setError(i18nService.t('enterpriseLeadDraftEmpty'));
      return;
    }

    setIsCreating(true);
    setError('');

    try {
      const draft = await enterpriseLeadWorkspaceService.extractDraft(cleanSourceText);
      if (!draft) {
        setError(i18nService.t('enterpriseLeadExtractFailed'));
        return;
      }

      const workspace = await enterpriseLeadWorkspaceService.createWorkspace({
        ...draft,
        name: workspaceDisplayName,
        source: {
          kind: sourceKind,
          label: sourceLabel,
          text: cleanSourceText,
        },
        settings: buildEnterpriseLeadWorkspaceSettingsFromCurrentConfig(),
      });
      if (!workspace) {
        setError(i18nService.t('enterpriseLeadCreateFailed'));
        return;
      }

      onCreated(workspace.id);
    } catch {
      setError(i18nService.t('enterpriseLeadCreateFailed'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateFromMaterial = (): void => {
    if (materials.length === 0) {
      setError(i18nService.t('enterpriseLeadCreateMaterialRequired'));
      return;
    }

    setIsCreating(true);
    setError('');
    void createWorkspaceFromUploadedMaterials({
      workspaceName: workspaceDisplayName,
      items: materials,
      settings: buildEnterpriseLeadWorkspaceSettingsFromCurrentConfig(),
      onCreated,
    })
      .then(workspace => {
        if (!workspace) {
          setError(i18nService.t('enterpriseLeadCreateFailed'));
        }
      })
      .catch(() => {
        setError(i18nService.t('enterpriseLeadCreateFailed'));
      })
      .finally(() => {
        setIsCreating(false);
      });
  };
```

Note: this drops `handleCreateFromPaste`, `handleCreateBlank`, `handleSkipMaterial` from the diff here — they already
exist and are unchanged. The diff above is what **changes** relative to the original.

- [ ] **Step 3: Replace renderMaterialStep markup**

Find the `renderMaterialStep` function (starts at line 660, ends near 751). Replace the entire body — the dropzone
button, hidden input, type chips, and footer — with:

```tsx
  const renderMaterialStep = (): React.ReactNode => (
    <>
      {renderPanelHeader(
        'enterpriseLeadCreateMaterialTitle',
        formatWorkspaceNameText('enterpriseLeadCreateMaterialSubtitle', workspaceDisplayName),
        handleBackToDetails,
      )}

      <WorkspaceMaterialUpload
        items={materials}
        onItemsChange={setMaterials}
        onError={setError}
        disabled={isBusy}
      />

      {renderError()}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm leading-5 text-secondary">
          {i18nService.t('enterpriseLeadCreateMaterialFooterHint')}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isBusy}
            className="inline-flex h-11 items-center rounded-lg border border-transparent px-4 text-sm font-semibold text-secondary transition-colors hover:bg-surface-raised hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {i18nService.t('enterpriseLeadCreateCancel')}
          </button>
          <button
            type="button"
            onClick={handleSkipMaterial}
            disabled={isBusy}
            className="inline-flex h-11 items-center rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {i18nService.t('enterpriseLeadCreateSkipForNow')}
          </button>
          <button
            type="button"
            onClick={handleCreateFromMaterial}
            disabled={isBusy}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCreating ? (
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
            ) : (
              <CheckIcon className="h-4 w-4" />
            )}
            {i18nService.t('enterpriseLeadCreateEnterWorkspace')}
          </button>
        </div>
      </div>
    </>
  );
```

- [ ] **Step 4: Lint and run all workspace tests**

```bash
npx eslint --ext tsx,ts --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx
npx vitest run src/renderer/components/enterpriseLeadWorkspace/
```

Expected: lint PASS, all tests in the directory PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx
git commit -m "feat(workspace): wire multi-file material upload into create flow"
```

---

## Task 8: Final verification

**Files:** none modified; verification only.

- [ ] **Step 1: Run the full Vitest suite**

```bash
npm test
```

Expected: PASS for all tests. No regressions in `enterpriseLeadWorkspace.test.ts`, `enterpriseLeadWorkspaceUi.test.ts`,
`WorkspaceKnowledgeBase.test.ts`, or `validation.test.ts`.

- [ ] **Step 2: Run ESLint on touched files only**

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 \
  src/shared/enterpriseLeadWorkspace/validation.ts \
  src/shared/enterpriseLeadWorkspace/validation.test.ts \
  src/shared/enterpriseLeadWorkspace/types.ts \
  src/main/enterpriseLeadWorkspace/service.ts \
  src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts \
  src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceMaterialUpload.tsx \
  src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx \
  src/renderer/services/i18n.ts
```

Expected: PASS with no errors and no warnings.

- [ ] **Step 3: Verify file size budget**

```bash
wc -l src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx src/renderer/components/enterpriseLeadWorkspace/WorkspaceMaterialUpload.tsx
```

Expected: `WorkspaceCreate.tsx` ≤ 1000 lines (was 928, should drop to ~750), `WorkspaceMaterialUpload.tsx` ≤ 280 lines.

- [ ] **Step 4: Manually smoke-test with `npm run electron:dev`**

Verify in the running app:

- Open "Create workspace" → "From material"
- Click dropzone → OS file picker opens with multi-select
- Select 2 PDFs + 1 PNG + 1 XLSX → all appear in the compact list with sizes
- Click "Enter workspace" → workspace is created; on the workspace's Knowledge Base, 4 documents appear in
  `extractionSources`
- Pick a 60MB file → toast `enterpriseLeadMaterialFileSizeExceeded`
- Pick a `.zip` → toast `enterpriseLeadMaterialUnsupportedType`
- "+ 添加更多文件" works for incremental selection
- Remove (×) buttons remove individual rows

- [ ] **Step 5: Final commit if any drift**

```bash
git status --short
# If clean, no commit needed. Otherwise:
# git add -A
# git commit -m "chore(workspace): post-implementation cleanup"
```

---

## Self-Review (against spec)

**Spec coverage:**

| Spec section                                | Implementing task                                     |
|---------------------------------------------|-------------------------------------------------------|
| §2 Multi-file selection via Electron dialog | T6 (WorkspaceMaterialUpload `dialogApi.selectFiles`)  |
| §2 Browser fallback                         | T6 (`<input type="file" multiple>`)                   |
| §2 All format families                      | T3 (constants), T6 (validation + dispatch)            |
| §2 50MB client-side limit                   | T3 (constant), T6 (validation in `buildItemFromPath`) |
| §2 Each file as own extractionSource        | T4 (helper maps items → extractionSources)            |
| §2 Sub-component extraction                 | T6 (new `WorkspaceMaterialUpload.tsx`)                |
| §2 Singular function preserved              | T7 (delegating wrapper)                               |
| §4.1 MaterialUploadItem type                | T3                                                    |
| §4.1 Constants and dialog filters           | T3                                                    |
| §4.1 Helper signature                       | T4                                                    |
| §4.2 WorkspaceCreate wiring                 | T7                                                    |
| §4.3 Combined accept attribute              | T6 (`ACCEPT_ATTRIBUTE`)                               |
| §4.3 Extension dispatch                     | T6 (`buildItemFromPath` branching)                    |
| §4.5 Error scenarios                        | T6 (rejection reasons → onError callback)             |
| §4.6 Compact list UI                        | T6 (`<ul>` rendering)                                 |
| §5 Test plan                                | T1 (validation), T4 (helper), T6 (component)          |
| §6 Risk: WorkspaceCreate bloat              | T7 (extraction)                                       |
| §6 Risk: per-source failure                 | T4 (warn-only)                                        |
| §6 Risk: i18n keys                          | T5                                                    |

**Placeholder scan:** No TBDs, no "implement later", no vague steps. Each step has exact code or commands.

**Type consistency:**

- `MaterialUploadItem` defined in T3, consumed in T4 (helper) and T6 (component), wired in T7.
- `MAX_MATERIAL_UPLOAD_BYTES` defined in T3, consumed in T6 validation.
- `ENTERPRISE_LEAD_MATERIAL_*` defined in T3, consumed in T6.
- `createWorkspaceFromUploadedMaterials` defined in T4, consumed in T7.
- Singular wrapper `createWorkspaceFromUploadedMaterial` defined in T7, preserves its exported signature so any external
  importer (none today) is unaffected.
