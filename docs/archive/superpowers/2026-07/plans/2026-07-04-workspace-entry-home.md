# Workspace Entry Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the enterprise lead workspace the default app entry and replace its old launch surface with a minimal
two-choice home for creating or opening workspaces.

**Architecture:** Keep the change inside the existing renderer-side enterprise lead workspace module. Add pure UI
metadata helpers and a focused `WorkspaceEntryHome` component, then update `EnterpriseLeadWorkspaceView` to default to
that entry screen and `App.tsx` to default to the enterprise lead workspace main view. Reuse existing IPC, services,
persistence, workspace creation, and workspace workbench behavior.

**Tech Stack:** TypeScript, React, Electron renderer, Tailwind, Heroicons, existing `Modal`, existing
`enterpriseLeadWorkspaceService`, Vitest, ESLint.

**Version-Control Note:** Repository instructions say not to create commits until the user has tested and confirmed.
This plan intentionally omits commit steps even though the generic planning skill recommends frequent commits.

---

## Scope Check

This is a single renderer-focused entry change. It does not create a new data model, IPC channel, workflow engine, or
workspace type. The existing `WorkspaceCreate`, `WorkspaceWorkbench`, and enterprise lead workspace service remain the
behavioral backbone.

## File Structure

- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`
  Add entry-home metadata, a screen constant for the enterprise lead workspace view, a sortable history helper, and a
  small history modal state helper.

- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
  Add pure tests for entry choices, default screen, history sorting, and history modal states.

- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceEntryHome.tsx`
  Render the minimal two-card home and centered historical workspace modal.

- Modify: `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`
  Use `WorkspaceEntryHome` as the default screen, handle list loading failures without blocking the entry home, and stop
  auto-opening the most recent workspace.

- Modify: `src/renderer/components/enterpriseLeadWorkspace/index.ts`
  Export `WorkspaceEntryHome` if useful for future local imports.

- Modify: `src/renderer/App.tsx`
  Change the initial `mainView` from `cowork` to `enterpriseLeadWorkspace`.

- Modify: `src/renderer/services/i18n.ts`
  Add Chinese and English strings for the entry home and history modal.

## Task 1: Pure UI Helper Contracts

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`

- [ ] **Step 1: Add failing helper tests**

In `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts`, extend the import from
`./enterpriseLeadWorkspaceUi`:

```ts
import {
  EnterpriseLeadWorkspaceHistoryState,
  EnterpriseLeadWorkspaceLaunchMode,
  EnterpriseLeadWorkspaceScreen,
  getAgentCardTone,
  getAgentRoleLabel,
  getAgentStatusLabelKey,
  getEntryHomeActions,
  getHistoryModalState,
  getLaunchMode,
  getWorkbenchAgentItems,
  getWorkbenchConfigSections,
  getWorkbenchLayoutSpec,
  getWorkbenchSidebarItems,
  getWorkspaceCompletionPercent,
  hasTaskOutput,
  isWorkspaceOperationCurrent,
  sortWorkspacesByRecentUpdate,
  summarizeWorkspaceDraft,
} from './enterpriseLeadWorkspaceUi';
```

Add these tests inside the existing `describe('enterprise lead workspace UI helpers', () => { ... })` block:

```ts
  test('uses entry home as the default enterprise lead workspace screen', () => {
    expect(EnterpriseLeadWorkspaceScreen.Entry).toBe('entry');
  });

  test('defines exactly two entry home actions', () => {
    expect(getEntryHomeActions()).toEqual([
      {
        id: 'create',
        titleKey: 'enterpriseLeadEntryCreateTitle',
        descriptionKey: 'enterpriseLeadEntryCreateDesc',
        actionKey: 'enterpriseLeadEntryCreateAction',
        tone: 'primary',
      },
      {
        id: 'history',
        titleKey: 'enterpriseLeadEntryHistoryTitle',
        descriptionKey: 'enterpriseLeadEntryHistoryDesc',
        actionKey: 'enterpriseLeadEntryHistoryAction',
        tone: 'surface',
      },
    ]);
  });

  test('sorts historical workspaces by recent update', () => {
    const oldest = {
      ...createWorkspace('oldest'),
      updatedAt: '2026-07-01T00:00:00.000Z',
    };
    const newest = {
      ...createWorkspace('newest'),
      updatedAt: '2026-07-04T00:00:00.000Z',
    };
    const middle = {
      ...createWorkspace('middle'),
      updatedAt: '2026-07-02T00:00:00.000Z',
    };

    expect(sortWorkspacesByRecentUpdate([oldest, newest, middle]).map(item => item.id)).toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
  });

  test('computes historical workspace modal state', () => {
    expect(getHistoryModalState({
      isLoading: true,
      error: '',
      workspaces: [],
    })).toBe(EnterpriseLeadWorkspaceHistoryState.Loading);

    expect(getHistoryModalState({
      isLoading: false,
      error: 'failed',
      workspaces: [],
    })).toBe(EnterpriseLeadWorkspaceHistoryState.Error);

    expect(getHistoryModalState({
      isLoading: false,
      error: '',
      workspaces: [],
    })).toBe(EnterpriseLeadWorkspaceHistoryState.Empty);

    expect(getHistoryModalState({
      isLoading: false,
      error: '',
      workspaces: [createWorkspace('workspace-1')],
    })).toBe(EnterpriseLeadWorkspaceHistoryState.List);
  });
```

- [ ] **Step 2: Run the helper tests and verify they fail**

Run:

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: FAIL because `EnterpriseLeadWorkspaceScreen`, `getEntryHomeActions`, `sortWorkspacesByRecentUpdate`,
`EnterpriseLeadWorkspaceHistoryState`, and `getHistoryModalState` are not exported yet.

- [ ] **Step 3: Add helper constants and functions**

In `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`, add these exports near the existing
launch-mode constants:

```ts
export const EnterpriseLeadWorkspaceScreen = {
  Entry: 'entry',
  Create: 'create',
  Workspace: 'workspace',
} as const;
export type EnterpriseLeadWorkspaceScreen =
  typeof EnterpriseLeadWorkspaceScreen[keyof typeof EnterpriseLeadWorkspaceScreen];

export const EnterpriseLeadEntryAction = {
  Create: 'create',
  History: 'history',
} as const;
export type EnterpriseLeadEntryAction =
  typeof EnterpriseLeadEntryAction[keyof typeof EnterpriseLeadEntryAction];

export const EnterpriseLeadWorkspaceHistoryState = {
  Loading: 'loading',
  Empty: 'empty',
  Error: 'error',
  List: 'list',
} as const;
export type EnterpriseLeadWorkspaceHistoryState =
  typeof EnterpriseLeadWorkspaceHistoryState[keyof typeof EnterpriseLeadWorkspaceHistoryState];

export interface WorkspaceEntryAction {
  id: EnterpriseLeadEntryAction;
  titleKey: string;
  descriptionKey: string;
  actionKey: string;
  tone: 'primary' | 'surface';
}

export interface WorkspaceHistoryStateInput {
  isLoading: boolean;
  error: string;
  workspaces: EnterpriseLeadWorkspace[];
}
```

Add this constant near the other static UI metadata:

```ts
const WORKSPACE_ENTRY_ACTIONS: WorkspaceEntryAction[] = [
  {
    id: EnterpriseLeadEntryAction.Create,
    titleKey: 'enterpriseLeadEntryCreateTitle',
    descriptionKey: 'enterpriseLeadEntryCreateDesc',
    actionKey: 'enterpriseLeadEntryCreateAction',
    tone: 'primary',
  },
  {
    id: EnterpriseLeadEntryAction.History,
    titleKey: 'enterpriseLeadEntryHistoryTitle',
    descriptionKey: 'enterpriseLeadEntryHistoryDesc',
    actionKey: 'enterpriseLeadEntryHistoryAction',
    tone: 'surface',
  },
];
```

Add these exported functions near the existing `getLaunchMode` helper:

```ts
export const getEntryHomeActions = (): WorkspaceEntryAction[] =>
  WORKSPACE_ENTRY_ACTIONS;

export const sortWorkspacesByRecentUpdate = (
  workspaces: EnterpriseLeadWorkspace[],
): EnterpriseLeadWorkspace[] =>
  [...workspaces].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

export const getHistoryModalState = ({
  isLoading,
  error,
  workspaces,
}: WorkspaceHistoryStateInput): EnterpriseLeadWorkspaceHistoryState => {
  if (isLoading) {
    return EnterpriseLeadWorkspaceHistoryState.Loading;
  }

  if (error.trim()) {
    return EnterpriseLeadWorkspaceHistoryState.Error;
  }

  if (workspaces.length === 0) {
    return EnterpriseLeadWorkspaceHistoryState.Empty;
  }

  return EnterpriseLeadWorkspaceHistoryState.List;
};
```

- [ ] **Step 4: Run the helper tests and verify they pass**

Run:

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: PASS.

## Task 2: Workspace Entry Home Component

**Files:**

- Create: `src/renderer/components/enterpriseLeadWorkspace/WorkspaceEntryHome.tsx`
- Modify: `src/renderer/components/enterpriseLeadWorkspace/index.ts`
- Test indirectly through Task 1 helper coverage and Task 5 manual validation.

- [ ] **Step 1: Create the entry component**

Create `src/renderer/components/enterpriseLeadWorkspace/WorkspaceEntryHome.tsx`:

```tsx
import {
  ArrowRightIcon,
  BriefcaseIcon,
  ClockIcon,
  FolderOpenIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useState } from 'react';

import type { EnterpriseLeadWorkspace } from '../../../shared/enterpriseLeadWorkspace/types';
import Modal from '../common/Modal';
import { i18nService } from '../../services/i18n';
import {
  EnterpriseLeadEntryAction,
  EnterpriseLeadWorkspaceHistoryState,
  getEntryHomeActions,
  getHistoryModalState,
  sortWorkspacesByRecentUpdate,
  summarizeWorkspaceDraft,
} from './enterpriseLeadWorkspaceUi';

interface WorkspaceEntryHomeProps {
  workspaces: EnterpriseLeadWorkspace[];
  isLoadingWorkspaces: boolean;
  workspaceListError: string;
  onCreate: () => void;
  onOpen: (workspaceId: string) => void;
}

const getSummaryLabels = () => ({
  productsFallback: i18nService.t('enterpriseLeadProductsFallback'),
  customersFallback: i18nService.t('enterpriseLeadCustomersFallback'),
  targetCustomersPrefix: i18nService.t('enterpriseLeadTargetCustomersPrefix'),
});

const getEntryIcon = (actionId: EnterpriseLeadEntryAction): React.ReactNode => {
  if (actionId === EnterpriseLeadEntryAction.Create) {
    return <PlusIcon className="h-6 w-6" />;
  }

  return <FolderOpenIcon className="h-6 w-6" />;
};

export const WorkspaceEntryHome: React.FC<WorkspaceEntryHomeProps> = ({
  workspaces,
  isLoadingWorkspaces,
  workspaceListError,
  onCreate,
  onOpen,
}) => {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const actions = getEntryHomeActions();
  const sortedWorkspaces = useMemo(
    () => sortWorkspacesByRecentUpdate(workspaces),
    [workspaces],
  );
  const historyState = getHistoryModalState({
    isLoading: isLoadingWorkspaces,
    error: workspaceListError,
    workspaces: sortedWorkspaces,
  });

  useEffect(() => {
    if (!isHistoryOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsHistoryOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isHistoryOpen]);

  const handleAction = (actionId: EnterpriseLeadEntryAction): void => {
    if (actionId === EnterpriseLeadEntryAction.Create) {
      onCreate();
      return;
    }

    setIsHistoryOpen(true);
  };

  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-3xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-foreground">
              {i18nService.t('enterpriseLeadEntryTitle')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-secondary">
              {i18nService.t('enterpriseLeadEntrySubtitle')}
            </p>
          </div>
          <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:flex">
            <BriefcaseIcon className="h-6 w-6" />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {actions.map(action => (
            <button
              key={action.id}
              type="button"
              onClick={() => handleAction(action.id)}
              className={`group flex min-h-[190px] flex-col justify-between rounded-lg border p-5 text-left shadow-sm transition-colors focus:outline-none focus:ring-2 ${
                action.tone === 'primary'
                  ? 'border-primary bg-primary text-white hover:bg-primary/90 focus:ring-primary/30'
                  : 'border-border bg-surface text-foreground hover:border-primary/40 hover:bg-surface-raised focus:ring-primary/20'
              }`}
            >
              <span>
                <span
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-lg ${
                    action.tone === 'primary'
                      ? 'bg-white/15 text-white'
                      : 'bg-primary/10 text-primary'
                  }`}
                >
                  {getEntryIcon(action.id)}
                </span>
                <span className="mt-4 block text-lg font-semibold">
                  {i18nService.t(action.titleKey)}
                </span>
                <span
                  className={`mt-2 block text-sm leading-6 ${
                    action.tone === 'primary' ? 'text-white/80' : 'text-secondary'
                  }`}
                >
                  {i18nService.t(action.descriptionKey)}
                </span>
              </span>
              <span
                className={`mt-6 inline-flex items-center gap-2 text-sm font-medium ${
                  action.tone === 'primary' ? 'text-white' : 'text-primary'
                }`}
              >
                {i18nService.t(action.actionKey)}
                <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          ))}
        </div>
      </div>

      <Modal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        className="w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-xl"
        overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {i18nService.t('enterpriseLeadHistoryModalTitle')}
            </h2>
            <p className="mt-1 text-sm text-secondary">
              {i18nService.t('enterpriseLeadHistoryModalDesc')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsHistoryOpen(false)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
            aria-label={i18nService.t('enterpriseLeadHistoryModalClose')}
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {historyState === EnterpriseLeadWorkspaceHistoryState.Loading && (
          <div className="flex min-h-[180px] items-center justify-center rounded-lg border border-border bg-background px-4 py-8 text-sm text-secondary">
            {i18nService.t('loading')}
          </div>
        )}

        {historyState === EnterpriseLeadWorkspaceHistoryState.Error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
            {i18nService.t('enterpriseLeadHistoryLoadFailed')}
          </div>
        )}

        {historyState === EnterpriseLeadWorkspaceHistoryState.Empty && (
          <div className="rounded-lg border border-border bg-background px-4 py-6 text-center">
            <p className="text-sm font-medium text-foreground">
              {i18nService.t('enterpriseLeadHistoryEmptyTitle')}
            </p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-secondary">
              {i18nService.t('enterpriseLeadHistoryEmptyDesc')}
            </p>
            <button
              type="button"
              onClick={() => {
                setIsHistoryOpen(false);
                onCreate();
              }}
              className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {i18nService.t('enterpriseLeadCreateWorkspace')}
            </button>
          </div>
        )}

        {historyState === EnterpriseLeadWorkspaceHistoryState.List && (
          <div className="grid max-h-[360px] gap-2 overflow-y-auto pr-1">
            {sortedWorkspaces.map(workspace => {
              const summary = summarizeWorkspaceDraft(workspace, getSummaryLabels());

              return (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => {
                    setIsHistoryOpen(false);
                    onOpen(workspace.id);
                  }}
                  className="rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {summary.name}
                  </span>
                  <span className="mt-1 line-clamp-2 text-sm leading-5 text-secondary">
                    {summary.products}
                  </span>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs text-secondary">
                    <ClockIcon className="h-3.5 w-3.5" />
                    {i18nService.t('enterpriseLeadHistoryUpdatedAtPrefix')}
                    {new Date(workspace.updatedAt).toLocaleDateString()}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default WorkspaceEntryHome;
```

- [ ] **Step 2: Export the new component**

In `src/renderer/components/enterpriseLeadWorkspace/index.ts`, change the file to:

```ts
export { EnterpriseLeadWorkspaceView } from './EnterpriseLeadWorkspaceView';
export { WorkspaceEntryHome } from './WorkspaceEntryHome';
export { WorkspaceWorkbench } from './WorkspaceWorkbench';
```

- [ ] **Step 3: Run TypeScript-aware lint on the new component**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/WorkspaceEntryHome.tsx src/renderer/components/enterpriseLeadWorkspace/index.ts
```

Expected: PASS. If it fails on import ordering or class names, fix only the reported touched files.

## Task 3: Entry Screen Routing In EnterpriseLeadWorkspaceView

**Files:**

- Modify: `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`

- [ ] **Step 1: Replace local launch screen constants with shared screen constants**

In `src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx`, update imports:

```tsx
import React, { useCallback, useEffect, useState } from 'react';

import type { EnterpriseLeadWorkspace } from '../../../shared/enterpriseLeadWorkspace/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import SidebarToggleIcon from '../icons/SidebarToggleIcon';
import WindowTitleBar from '../window/WindowTitleBar';
import {
  EnterpriseLeadWorkspaceScreen,
  sortWorkspacesByRecentUpdate,
} from './enterpriseLeadWorkspaceUi';
import WorkspaceCreate from './WorkspaceCreate';
import WorkspaceEntryHome from './WorkspaceEntryHome';
import WorkspaceWorkbench from './WorkspaceWorkbench';
```

Delete the existing local `EnterpriseLeadWorkspaceScreen` constant/type and delete the local `sortByRecentUpdate`
helper.

- [ ] **Step 2: Initialize the view to entry home**

Replace the screen state initialization with:

```tsx
  const [screen, setScreen] = useState<EnterpriseLeadWorkspaceScreen>(
    EnterpriseLeadWorkspaceScreen.Entry,
  );
```

Add a list error state near the existing workspace error state:

```tsx
  const [workspaceListError, setWorkspaceListError] = useState('');
```

- [ ] **Step 3: Update refreshWorkspaces so it never auto-opens recent workspaces**

Replace the existing `refreshWorkspaces` function with:

```tsx
  const refreshWorkspaces = useCallback(async (preferredWorkspaceId?: string): Promise<void> => {
    setIsLoadingWorkspaces(true);
    setWorkspaceListError('');

    try {
      const nextWorkspaces = await enterpriseLeadWorkspaceService.listWorkspaces();
      const sortedWorkspaces = sortWorkspacesByRecentUpdate(nextWorkspaces);
      setWorkspaces(sortedWorkspaces);

      if (preferredWorkspaceId) {
        setActiveWorkspace(null);
        setActiveWorkspaceId(preferredWorkspaceId);
        setScreen(EnterpriseLeadWorkspaceScreen.Workspace);
      } else {
        setActiveWorkspace(null);
        setActiveWorkspaceId(null);
        setScreen(EnterpriseLeadWorkspaceScreen.Entry);
      }
    } catch {
      setWorkspaces([]);
      setWorkspaceListError(i18nService.t('enterpriseLeadHistoryLoadFailed'));

      if (!preferredWorkspaceId) {
        setActiveWorkspace(null);
        setActiveWorkspaceId(null);
        setScreen(EnterpriseLeadWorkspaceScreen.Entry);
      }
    } finally {
      setIsLoadingWorkspaces(false);
    }
  }, []);
```

- [ ] **Step 4: Update create/open handlers to use shared screen constants**

Make sure these handlers use `EnterpriseLeadWorkspaceScreen.Create` and `EnterpriseLeadWorkspaceScreen.Workspace`:

```tsx
  const handleCreate = (): void => {
    setScreen(EnterpriseLeadWorkspaceScreen.Create);
  };

  const handleOpen = (workspaceId: string): void => {
    setActiveWorkspace(null);
    setWorkspaceError('');
    setActiveWorkspaceId(workspaceId);
    setScreen(EnterpriseLeadWorkspaceScreen.Workspace);
  };

  const handleCreated = (workspaceId: string): void => {
    setActiveWorkspace(null);
    setWorkspaceError('');
    setActiveWorkspaceId(workspaceId);
    setScreen(EnterpriseLeadWorkspaceScreen.Workspace);
    void refreshWorkspaces(workspaceId);
  };
```

- [ ] **Step 5: Render entry home by default**

In `renderContent`, remove the full-page loading branch:

```tsx
    if (isLoadingWorkspaces && workspaces.length === 0) {
      return (
        <div className="flex min-h-full flex-1 items-center justify-center bg-background px-6 py-8 text-sm text-secondary">
          {i18nService.t('loading')}
        </div>
      );
    }
```

Keep create and workspace rendering, but update comparisons to shared constants:

```tsx
    if (screen === EnterpriseLeadWorkspaceScreen.Create) {
      return <WorkspaceCreate onCreated={handleCreated} />;
    }

    if (screen === EnterpriseLeadWorkspaceScreen.Workspace && activeWorkspaceId) {
      // existing workspace rendering stays the same
    }
```

Replace the final `WorkspaceLaunch` return with:

```tsx
    return (
      <WorkspaceEntryHome
        workspaces={workspaces}
        isLoadingWorkspaces={isLoadingWorkspaces}
        workspaceListError={workspaceListError}
        onCreate={handleCreate}
        onOpen={handleOpen}
      />
    );
```

- [ ] **Step 6: Run lint for the modified view**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx
```

Expected: PASS. If it fails because `WorkspaceLaunch` or old launch-mode imports are unused, remove those imports.

## Task 4: I18n Strings

**Files:**

- Modify: `src/renderer/services/i18n.ts`

- [ ] **Step 1: Add Chinese strings**

In the Chinese enterprise lead workspace block in `src/renderer/services/i18n.ts`, add:

```ts
    enterpriseLeadEntryTitle: '线索工作区',
    enterpriseLeadEntrySubtitle: '创建或打开一个业务线索空间。',
    enterpriseLeadEntryCreateTitle: '创建工作区',
    enterpriseLeadEntryCreateDesc: '从资料、对话或产品说明开始整理业务画像。',
    enterpriseLeadEntryCreateAction: '开始创建',
    enterpriseLeadEntryHistoryTitle: '打开历史工作区',
    enterpriseLeadEntryHistoryDesc: '查看已经创建的线索工作区。',
    enterpriseLeadEntryHistoryAction: '选择工作区',
    enterpriseLeadHistoryModalTitle: '打开历史工作区',
    enterpriseLeadHistoryModalDesc: '选择一个已经创建的线索工作区。',
    enterpriseLeadHistoryModalClose: '关闭历史工作区列表',
    enterpriseLeadHistoryEmptyTitle: '还没有历史工作区',
    enterpriseLeadHistoryEmptyDesc: '先创建一个线索工作区，后续就可以从这里继续打开。',
    enterpriseLeadHistoryLoadFailed: '历史工作区加载失败，请稍后重试。',
    enterpriseLeadHistoryUpdatedAtPrefix: '最近更新：',
```

- [ ] **Step 2: Add English strings**

In the English enterprise lead workspace block in `src/renderer/services/i18n.ts`, add:

```ts
    enterpriseLeadEntryTitle: 'Lead Workspace',
    enterpriseLeadEntrySubtitle: 'Create or open a business lead workspace.',
    enterpriseLeadEntryCreateTitle: 'Create workspace',
    enterpriseLeadEntryCreateDesc: 'Start from source material, a conversation, or product notes.',
    enterpriseLeadEntryCreateAction: 'Start creating',
    enterpriseLeadEntryHistoryTitle: 'Open historical workspace',
    enterpriseLeadEntryHistoryDesc: 'View lead workspaces you have already created.',
    enterpriseLeadEntryHistoryAction: 'Choose workspace',
    enterpriseLeadHistoryModalTitle: 'Open historical workspace',
    enterpriseLeadHistoryModalDesc: 'Choose an existing lead workspace.',
    enterpriseLeadHistoryModalClose: 'Close historical workspace list',
    enterpriseLeadHistoryEmptyTitle: 'No historical workspaces yet',
    enterpriseLeadHistoryEmptyDesc: 'Create a lead workspace first, then reopen it from here later.',
    enterpriseLeadHistoryLoadFailed: 'Failed to load historical workspaces. Try again later.',
    enterpriseLeadHistoryUpdatedAtPrefix: 'Updated: ',
```

- [ ] **Step 3: Run lint for i18n**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/services/i18n.ts
```

Expected: PASS.

## Task 5: Default App Entry

**Files:**

- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Change default main view**

In `src/renderer/App.tsx`, change:

```tsx
  const [mainView, setMainView] = useState<MainView>('cowork');
```

to:

```tsx
  const [mainView, setMainView] = useState<MainView>('enterpriseLeadWorkspace');
```

- [ ] **Step 2: Run lint for App**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/App.tsx
```

Expected: PASS. If existing formatting in `App.tsx` triggers touched-line lint complaints, fix only the touched
import/state area.

## Task 6: Verification

**Files:**

- Verify all touched TypeScript/TSX files.

- [ ] **Step 1: Run focused Vitest coverage**

Run:

```bash
npm test -- src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run changed-file ESLint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/renderer/App.tsx src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.test.ts src/renderer/components/enterpriseLeadWorkspace/WorkspaceEntryHome.tsx src/renderer/components/enterpriseLeadWorkspace/EnterpriseLeadWorkspaceView.tsx src/renderer/components/enterpriseLeadWorkspace/index.ts src/renderer/services/i18n.ts
```

Expected: PASS.

- [ ] **Step 3: Manual app validation**

Run the app:

```bash
npm run electron:dev
```

Expected manual checks:

- After initialization, the active sidebar view is `线索工作区`.
- The first content screen shows only the two primary entry choices.
- Clicking `创建工作区` opens the existing workspace creation surface.
- Clicking `打开历史工作区` opens a centered modal.
- With no workspaces, the modal shows the empty state and a create action.
- With workspaces, the modal lists them newest first.
- Selecting a historical workspace opens the existing workspace workbench.
- The general Cowork workbench is still reachable from the sidebar.

If the dev server cannot run in the current environment, record that manual validation was not completed and include the
Vitest and ESLint results in the handoff.

## Implementation Notes

- Do not remove `WorkspaceLaunch.tsx` in this pass. It is no longer the default surface after this change, but deleting
  it is unnecessary churn.
- Do not add search to the historical workspace modal.
- Do not add new IPC handlers.
- Do not change enterprise lead workspace SQLite tables.
- Do not change `WorkspaceCreate` behavior except through navigation into it.
- Do not change `WorkspaceWorkbench` behavior.
