import React from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  KnowledgeFactBatchAction,
  KnowledgeFactBatchSkipReason,
  KnowledgeFactBatchTaskStatus,
  KnowledgeFactDomain,
  KnowledgeFactEvidenceState,
  KnowledgeFactListView,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeFactBatchReviewTask,
  KnowledgeFactSummary,
} from '../../../shared/knowledgeBase/types';
import { knowledgeBaseService } from '../../services/knowledgeBase';
import {
  collectWorkspaceAiKnowledgeBatchVisibleSelectableFacts,
  useWorkspaceAiKnowledgeBatchReview,
} from './useWorkspaceAiKnowledgeBatchReview';
import type { WorkspaceAiKnowledgeRow } from './workspaceAiKnowledgeRows';

class FakeDomNode {
  parentNode: FakeDomNode | null = null;
  childNodes: FakeDomNode[] = [];
  ownerDocument: FakeDomDocument | null = null;
  nodeValue: string | null = null;
  textContent = '';
  nodeType = 0;

  get firstChild(): FakeDomNode | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): FakeDomNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  appendChild(node: FakeDomNode): FakeDomNode {
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }

  insertBefore(node: FakeDomNode, before: FakeDomNode | null): FakeDomNode {
    if (before === null) {
      return this.appendChild(node);
    }
    const index = this.childNodes.indexOf(before);
    if (index < 0) {
      return this.appendChild(node);
    }
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }

  removeChild(node: FakeDomNode): FakeDomNode {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) {
      this.childNodes.splice(index, 1);
      node.parentNode = null;
    }
    return node;
  }
}

class FakeDomText extends FakeDomNode {
  override nodeType = 3;

  constructor(value: string) {
    super();
    this.nodeValue = value;
    this.textContent = value;
  }
}

class FakeDomComment extends FakeDomNode {
  override nodeType = 8;

  constructor(value: string) {
    super();
    this.nodeValue = value;
  }
}

class FakeDomElement extends FakeDomNode {
  attributes = new Map<string, string>();
  style = {};
  dataset = {};
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  nodeName: string;
  override nodeType = 1;

  constructor(
    public tagName: string,
    isSvg = false,
  ) {
    super();
    this.nodeName = tagName.toUpperCase();
    if (isSvg) {
      this.namespaceURI = 'http://www.w3.org/2000/svg';
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(): void {}

  removeEventListener(): void {}
}

class FakeDomDocument extends FakeDomNode {
  body: FakeDomElement;
  documentElement: FakeDomElement;
  defaultView: Window | null = null;
  override nodeType = 9;

  constructor() {
    super();
    this.ownerDocument = this;
    this.documentElement = this.createElement('html');
    this.body = this.createElement('body');
    this.documentElement.ownerDocument = this;
    this.body.ownerDocument = this;
    this.documentElement.appendChild(this.body);
  }

  createElement(name: string): FakeDomElement {
    const element = new FakeDomElement(name);
    element.ownerDocument = this;
    return element;
  }

  createElementNS(_namespace: string, name: string): FakeDomElement {
    const element = new FakeDomElement(name, _namespace === 'http://www.w3.org/2000/svg');
    element.ownerDocument = this;
    return element;
  }

  createTextNode(value: string): FakeDomText {
    const text = new FakeDomText(value);
    text.ownerDocument = this;
    return text;
  }

  createComment(value: string): FakeDomComment {
    const comment = new FakeDomComment(value);
    comment.ownerDocument = this;
    return comment;
  }

  addEventListener(): void {}

  removeEventListener(): void {}
}

const installFakeDom = (): { restore: () => void } => {
  const fakeDocument = new FakeDomDocument();
  const sessionStorageState = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string): string | null => sessionStorageState.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      sessionStorageState.set(key, String(value));
    },
    removeItem: (key: string): void => {
      sessionStorageState.delete(key);
    },
    clear: (): void => {
      sessionStorageState.clear();
    },
  };
  const fakeWindow = {
    document: fakeDocument,
    navigator: { userAgent: 'node' },
    location: { href: 'http://localhost/', protocol: 'http:' },
    sessionStorage,
    window: undefined as unknown,
    self: undefined as unknown,
    top: undefined as unknown,
    parent: undefined as unknown,
    addEventListener: (): void => undefined,
    removeEventListener: (): void => undefined,
    requestAnimationFrame: (callback: FrameRequestCallback): number =>
      setTimeout(() => callback(Date.now()), 0) as unknown as number,
    cancelAnimationFrame: (handle: number): void => clearTimeout(handle),
    HTMLElement: FakeDomElement,
    HTMLIFrameElement: class FakeDomIFrameElement {},
    Node: FakeDomNode,
    Text: FakeDomText,
    Comment: FakeDomComment,
    SVGElement: class FakeDomSvgElement {},
    getSelection: (): Selection | null => null,
    event: undefined,
  } as unknown as Window & typeof globalThis;

  fakeWindow.window = fakeWindow;
  fakeWindow.self = fakeWindow;
  fakeWindow.top = fakeWindow;
  fakeWindow.parent = fakeWindow;
  fakeDocument.defaultView = fakeWindow;

  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('navigator', fakeWindow.navigator);
  vi.stubGlobal('Node', FakeDomNode);
  vi.stubGlobal('Text', FakeDomText);
  vi.stubGlobal('Comment', FakeDomComment);
  vi.stubGlobal('HTMLElement', FakeDomElement);
  vi.stubGlobal('SVGElement', class FakeDomSvgElement {});
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

  return {
    restore: () => {
      vi.unstubAllGlobals();
    },
  };
};

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
};

const fact = (
  id: string,
  overrides: Partial<KnowledgeFactSummary> = {},
): KnowledgeFactSummary => ({
  id,
  domain: KnowledgeFactDomain.ProductList,
  value: `${id}-value`,
  reviewStatus: KnowledgeFactReviewStatus.Pending,
  sourceKind: KnowledgeFactSourceKind.Extracted,
  revision: 1,
  projectionState: KnowledgeFactProjectionState.None,
  activeEvidenceCount: 1,
  staleEvidenceCount: 0,
  evidencePreview: null,
  createdAt: '2026-07-14T00:00:00.000Z',
  reviewedAt: null,
  updatedAt: '2026-07-14T00:00:00.000Z',
  archivedAt: null,
  ...overrides,
});

const row = (summary: KnowledgeFactSummary): WorkspaceAiKnowledgeRow => ({
  kind: 'normalized_fact',
  fact: summary,
});

const legacyRow = (): WorkspaceAiKnowledgeRow => ({
  kind: 'legacy_profile',
  item: {
    id: 'legacy-profile:productList:legacy value',
    domain: fact('ignored').domain,
    value: 'Legacy value',
    knowledgeKey: 'productList:legacy value',
  },
});

const task = (
  overrides: Partial<KnowledgeFactBatchReviewTask> = {},
): KnowledgeFactBatchReviewTask => ({
  taskId: 'task-1',
  workspaceId: 'workspace-a',
  action: KnowledgeFactBatchAction.Confirm,
  status: KnowledgeFactBatchTaskStatus.Queued,
  totalCount: 2,
  processedCount: 0,
  successCount: 0,
  skippedCount: 0,
  failedCount: 0,
  retryableCount: 0,
  skippedByReason: {},
  details: [],
  createdAt: '2026-07-14T00:00:00.000Z',
  startedAt: null,
  updatedAt: '2026-07-14T00:00:00.000Z',
  completedAt: null,
  ...overrides,
});

describe('collectWorkspaceAiKnowledgeBatchVisibleSelectableFacts', () => {
  test('returns only active non-archived pending normalized facts with active evidence and no conflicts', () => {
    const eligible = fact('eligible');
    const selected = collectWorkspaceAiKnowledgeBatchVisibleSelectableFacts([
      row(eligible),
      row(fact('confirmed', { reviewStatus: KnowledgeFactReviewStatus.Confirmed })),
      row(fact('rejected', { reviewStatus: KnowledgeFactReviewStatus.Rejected })),
      row(fact('archived', { archivedAt: '2026-07-14T01:00:00.000Z' })),
      row(fact('no-evidence', { activeEvidenceCount: 0 })),
      row(fact('conflict', { projectionState: KnowledgeFactProjectionState.Conflict })),
      legacyRow(),
    ]);

    expect([...selected.entries()]).toEqual([
      ['eligible', { fact: eligible, expectedRevision: eligible.revision }],
    ]);
  });
});

describe('useWorkspaceAiKnowledgeBatchReview', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('tracks fact toggles, visible selection, partial selection state, and matching mode without materializing extra ids', async () => {
    const { restore } = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const pendingA = fact('fact-a');
    const pendingB = fact('fact-b', { revision: 2 });
    const latest: { current: ReturnType<typeof useWorkspaceAiKnowledgeBatchReview> | null } = {
      current: null,
    };

    const Harness = (): React.ReactElement | null => {
      latest.current = useWorkspaceAiKnowledgeBatchReview({
        workspaceId: 'workspace-a',
        rows: [row(pendingA), row(pendingB), row(fact('confirmed', {
          reviewStatus: KnowledgeFactReviewStatus.Confirmed,
        }))],
        filters: {
          view: KnowledgeFactListView.Active,
          reviewStatuses: [KnowledgeFactReviewStatus.Pending],
          evidenceState: KnowledgeFactEvidenceState.Any,
        },
        nextCursor: 'cursor-1',
        onRefresh: vi.fn().mockResolvedValue([]),
      });
      return null;
    };

    try {
      await React.act(async () => {
        root.render(React.createElement(Harness));
        await flushMicrotasks();
      });

      expect(latest.current?.visibleSelectableCount).toBe(2);
      expect(latest.current?.selectedCount).toBe(0);
      expect(latest.current?.allVisibleSelected).toBe(false);
      expect(latest.current?.someVisibleSelected).toBe(false);
      expect(latest.current?.canSelectAllMatching).toBe(true);
      expect(latest.current?.canExpandToMatching).toBe(false);

      await React.act(async () => {
        latest.current?.toggleFact(pendingA);
        await flushMicrotasks();
      });

      expect([...latest.current!.selectedFacts.keys()]).toEqual(['fact-a']);
      expect(latest.current?.selectionMode).toBe('page');
      expect(latest.current?.selectedCount).toBe(1);
      expect(latest.current?.allVisibleSelected).toBe(false);
      expect(latest.current?.someVisibleSelected).toBe(true);
      expect(latest.current?.canSelectAllMatching).toBe(true);
      expect(latest.current?.canExpandToMatching).toBe(false);

      await React.act(async () => {
        latest.current?.toggleVisible();
        await flushMicrotasks();
      });

      expect([...latest.current!.selectedFacts.keys()]).toEqual(['fact-a', 'fact-b']);
      expect(latest.current?.selectedCount).toBe(2);
      expect(latest.current?.allVisibleSelected).toBe(true);
      expect(latest.current?.someVisibleSelected).toBe(false);
      expect(latest.current?.canSelectAllMatching).toBe(true);
      expect(latest.current?.canExpandToMatching).toBe(true);

      await React.act(async () => {
        latest.current?.selectMatching();
        await flushMicrotasks();
      });

      expect(latest.current?.selectionMode).toBe('matching');
      expect(latest.current?.selectedCount).toBe(2);
      expect([...latest.current!.selectedFacts.keys()]).toEqual(['fact-a', 'fact-b']);
      expect(latest.current?.canSelectAllMatching).toBe(false);
      expect(latest.current?.canExpandToMatching).toBe(false);
    } finally {
      root.unmount();
      restore();
    }
  });

  test('allows the summary entry to widen a partial page selection into matching filters', async () => {
    const { restore } = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const pendingA = fact('fact-a');
    const pendingB = fact('fact-b', { revision: 2 });
    const latest: { current: ReturnType<typeof useWorkspaceAiKnowledgeBatchReview> | null } = {
      current: null,
    };

    const Harness = (): React.ReactElement | null => {
      latest.current = useWorkspaceAiKnowledgeBatchReview({
        workspaceId: 'workspace-a',
        rows: [row(pendingA), row(pendingB)],
        filters: {
          view: KnowledgeFactListView.Active,
          reviewStatuses: [KnowledgeFactReviewStatus.Pending],
          evidenceState: KnowledgeFactEvidenceState.Any,
        },
        nextCursor: 'cursor-1',
        onRefresh: vi.fn().mockResolvedValue([]),
      });
      return null;
    };

    try {
      await React.act(async () => {
        root.render(React.createElement(Harness));
        await flushMicrotasks();
      });

      await React.act(async () => {
        latest.current?.toggleFact(pendingA);
        await flushMicrotasks();
      });

      expect(latest.current?.selectionMode).toBe('page');
      expect(latest.current?.selectedCount).toBe(1);
      expect(latest.current?.canSelectAllMatching).toBe(true);
      expect(latest.current?.canExpandToMatching).toBe(false);

      await React.act(async () => {
        latest.current?.selectMatching();
        await flushMicrotasks();
      });

      expect(latest.current?.selectionMode).toBe('matching');
      expect([...latest.current!.selectedFacts.keys()]).toEqual(['fact-a', 'fact-b']);
      expect(latest.current?.selectedCount).toBe(2);
    } finally {
      root.unmount();
      restore();
    }
  });

  test('forces matching batch review scope to pending facts when all statuses are visible', async () => {
    const { restore } = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const pending = fact('fact-pending');
    const startBatchReview = vi
      .spyOn(knowledgeBaseService, 'startBatchReview')
      .mockResolvedValue(task());
    vi.spyOn(knowledgeBaseService, 'getBatchReviewStatus').mockResolvedValue(null);
    const latest: { current: ReturnType<typeof useWorkspaceAiKnowledgeBatchReview> | null } = {
      current: null,
    };

    const Harness = (): React.ReactElement | null => {
      latest.current = useWorkspaceAiKnowledgeBatchReview({
        workspaceId: 'workspace-a',
        rows: [row(pending)],
        filters: {
          view: KnowledgeFactListView.Active,
          evidenceState: KnowledgeFactEvidenceState.Any,
          reviewStatuses: [],
        },
        nextCursor: 'cursor-1',
        onRefresh: vi.fn().mockResolvedValue([]),
      });
      return null;
    };

    try {
      await React.act(async () => {
        root.render(React.createElement(Harness));
        await flushMicrotasks();
      });
      await React.act(async () => {
        latest.current?.selectMatching();
        await flushMicrotasks();
      });
      await React.act(async () => {
        await latest.current?.start(KnowledgeFactBatchAction.Confirm);
        await flushMicrotasks();
      });

      expect(startBatchReview).toHaveBeenCalledWith({
        workspaceId: 'workspace-a',
        action: KnowledgeFactBatchAction.Confirm,
        selection: {
          kind: 'matching_filters',
          filters: {
            view: KnowledgeFactListView.Active,
            reviewStatuses: [KnowledgeFactReviewStatus.Pending],
            evidenceState: KnowledgeFactEvidenceState.Any,
          },
        },
      });
    } finally {
      root.unmount();
      restore();
    }
  });

  test('starts a page task with fact ids and a matching task with filters', async () => {
    const { restore } = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const pendingA = fact('fact-a');
    const pendingB = fact('fact-b', { revision: 2 });
    const startBatchReview = vi
      .spyOn(knowledgeBaseService, 'startBatchReview')
      .mockResolvedValue(task());
    vi.spyOn(knowledgeBaseService, 'getBatchReviewStatus').mockResolvedValue(null);
    const latest: { current: ReturnType<typeof useWorkspaceAiKnowledgeBatchReview> | null } = {
      current: null,
    };

    const renderHarness = async (selection: 'page' | 'matching'): Promise<void> => {
      const Harness = (): React.ReactElement | null => {
        latest.current = useWorkspaceAiKnowledgeBatchReview({
          workspaceId: 'workspace-a',
          rows: [row(pendingA), row(pendingB)],
          filters: {
            view: KnowledgeFactListView.Active,
          reviewStatuses: [KnowledgeFactReviewStatus.Pending],
          evidenceState: KnowledgeFactEvidenceState.Any,
        },
        nextCursor: 'cursor-1',
        onRefresh: vi.fn().mockResolvedValue([]),
      });
      return null;
    };

      await React.act(async () => {
        root.render(React.createElement(Harness));
        await flushMicrotasks();
      });
      await React.act(async () => {
        latest.current?.toggleVisible();
        await flushMicrotasks();
      });
      if (selection === 'matching') {
        await React.act(async () => {
          latest.current?.selectMatching();
          await flushMicrotasks();
        });
      }
    };

    try {
      await renderHarness('page');
      await React.act(async () => {
        await latest.current?.start(KnowledgeFactBatchAction.Confirm);
        await flushMicrotasks();
      });
      expect(startBatchReview).toHaveBeenNthCalledWith(1, {
        workspaceId: 'workspace-a',
        action: KnowledgeFactBatchAction.Confirm,
        selection: {
          kind: 'fact_ids',
          items: [
            { factId: 'fact-a', expectedRevision: 1 },
            { factId: 'fact-b', expectedRevision: 2 },
          ],
        },
      });

      await React.act(async () => {
        latest.current?.clearSelection();
        await flushMicrotasks();
      });
      await renderHarness('matching');
      await React.act(async () => {
        await latest.current?.start(KnowledgeFactBatchAction.Archive);
        await flushMicrotasks();
      });
      expect(startBatchReview).toHaveBeenNthCalledWith(2, {
        workspaceId: 'workspace-a',
        action: KnowledgeFactBatchAction.Archive,
        selection: {
          kind: 'matching_filters',
          filters: {
            view: KnowledgeFactListView.Active,
            reviewStatuses: [KnowledgeFactReviewStatus.Pending],
            evidenceState: KnowledgeFactEvidenceState.Any,
          },
        },
      });
    } finally {
      root.unmount();
      restore();
    }
  });

  test('restores a stored task id, polls every 750 ms while active, and refreshes once after terminal status', async () => {
    vi.useFakeTimers();
    const { restore } = installFakeDom();
    window.sessionStorage.setItem('ai-knowledge-batch-review:workspace-a', 'task-1');
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const getBatchReviewStatus = vi
      .spyOn(knowledgeBaseService, 'getBatchReviewStatus')
      .mockResolvedValueOnce(task({
        status: KnowledgeFactBatchTaskStatus.Running,
        startedAt: '2026-07-14T00:00:01.000Z',
      }))
      .mockResolvedValueOnce(task({
        status: KnowledgeFactBatchTaskStatus.Completed,
        processedCount: 2,
        successCount: 2,
        startedAt: '2026-07-14T00:00:01.000Z',
        completedAt: '2026-07-14T00:00:05.000Z',
      }));
    const latest: { current: ReturnType<typeof useWorkspaceAiKnowledgeBatchReview> | null } = {
      current: null,
    };

    const Harness = (): React.ReactElement | null => {
      latest.current = useWorkspaceAiKnowledgeBatchReview({
        workspaceId: 'workspace-a',
        rows: [row(fact('fact-a')), row(fact('fact-b'))],
        filters: {
          view: KnowledgeFactListView.Active,
          reviewStatuses: [KnowledgeFactReviewStatus.Pending],
          evidenceState: KnowledgeFactEvidenceState.Any,
        },
        nextCursor: null,
        onRefresh,
      });
      return null;
    };

    try {
      await React.act(async () => {
        root.render(React.createElement(Harness));
        await flushMicrotasks();
      });

      expect(getBatchReviewStatus).toHaveBeenCalledTimes(1);
      expect(latest.current?.task?.status).toBe(KnowledgeFactBatchTaskStatus.Running);

      await React.act(async () => {
        await vi.advanceTimersByTimeAsync(749);
        await flushMicrotasks();
      });
      expect(getBatchReviewStatus).toHaveBeenCalledTimes(1);

      await React.act(async () => {
        await vi.advanceTimersByTimeAsync(1);
        await flushMicrotasks();
      });

      expect(getBatchReviewStatus).toHaveBeenCalledTimes(2);
      expect(latest.current?.task?.status).toBe(KnowledgeFactBatchTaskStatus.Completed);
      expect(onRefresh).toHaveBeenCalledTimes(1);

      await React.act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
      });
      expect(getBatchReviewStatus).toHaveBeenCalledTimes(2);

      await React.act(async () => {
        latest.current?.dismissTask();
        await flushMicrotasks();
      });
      expect(window.sessionStorage.getItem('ai-knowledge-batch-review:workspace-a')).toBeNull();
      expect(latest.current?.task).toBeNull();
    } finally {
      root.unmount();
      restore();
    }
  });

  test('retries restore after a transient first status failure and keeps the stored handle until it succeeds', async () => {
    vi.useFakeTimers();
    const { restore } = installFakeDom();
    window.sessionStorage.setItem('ai-knowledge-batch-review:workspace-a', 'task-1');
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const getBatchReviewStatus = vi
      .spyOn(knowledgeBaseService, 'getBatchReviewStatus')
      .mockRejectedValueOnce(new Error('transient restore failure'))
      .mockResolvedValueOnce(task({
        status: KnowledgeFactBatchTaskStatus.Running,
        startedAt: '2026-07-14T00:00:01.000Z',
      }))
      .mockResolvedValueOnce(task({
        status: KnowledgeFactBatchTaskStatus.Completed,
        processedCount: 2,
        successCount: 2,
        startedAt: '2026-07-14T00:00:01.000Z',
        completedAt: '2026-07-14T00:00:05.000Z',
      }));
    const latest: { current: ReturnType<typeof useWorkspaceAiKnowledgeBatchReview> | null } = {
      current: null,
    };

    const Harness = (): React.ReactElement | null => {
      latest.current = useWorkspaceAiKnowledgeBatchReview({
        workspaceId: 'workspace-a',
        rows: [row(fact('fact-a')), row(fact('fact-b'))],
        filters: {
          view: KnowledgeFactListView.Active,
          reviewStatuses: [KnowledgeFactReviewStatus.Pending],
          evidenceState: KnowledgeFactEvidenceState.Any,
        },
        nextCursor: null,
        onRefresh,
      });
      return null;
    };

    try {
      await React.act(async () => {
        root.render(React.createElement(Harness));
        await flushMicrotasks();
      });

      expect(getBatchReviewStatus).toHaveBeenCalledTimes(1);
      expect(latest.current?.task).toBeNull();
      expect(window.sessionStorage.getItem('ai-knowledge-batch-review:workspace-a')).toBe('task-1');

      await React.act(async () => {
        await vi.advanceTimersByTimeAsync(749);
        await flushMicrotasks();
      });

      expect(getBatchReviewStatus).toHaveBeenCalledTimes(1);
      expect(window.sessionStorage.getItem('ai-knowledge-batch-review:workspace-a')).toBe('task-1');

      await React.act(async () => {
        await vi.advanceTimersByTimeAsync(1);
        await flushMicrotasks();
      });

      expect(getBatchReviewStatus).toHaveBeenCalledTimes(2);
      expect(latest.current?.task?.status).toBe(KnowledgeFactBatchTaskStatus.Running);
      expect(window.sessionStorage.getItem('ai-knowledge-batch-review:workspace-a')).not.toBeNull();

      await React.act(async () => {
        await vi.advanceTimersByTimeAsync(750);
        await flushMicrotasks();
      });

      expect(getBatchReviewStatus).toHaveBeenCalledTimes(3);
      expect(latest.current?.task?.status).toBe(KnowledgeFactBatchTaskStatus.Completed);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    } finally {
      root.unmount();
      restore();
    }
  });

  test('keeps polling after a transient active-status failure and eventually refreshes on completion', async () => {
    vi.useFakeTimers();
    const { restore } = installFakeDom();
    window.sessionStorage.setItem('ai-knowledge-batch-review:workspace-a', 'task-1');
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const getBatchReviewStatus = vi
      .spyOn(knowledgeBaseService, 'getBatchReviewStatus')
      .mockResolvedValueOnce(task({
        status: KnowledgeFactBatchTaskStatus.Running,
        startedAt: '2026-07-14T00:00:01.000Z',
      }))
      .mockRejectedValueOnce(new Error('transient IPC failure'))
      .mockResolvedValueOnce(task({
        status: KnowledgeFactBatchTaskStatus.Completed,
        processedCount: 2,
        successCount: 2,
        startedAt: '2026-07-14T00:00:01.000Z',
        completedAt: '2026-07-14T00:00:05.000Z',
      }));
    const latest: { current: ReturnType<typeof useWorkspaceAiKnowledgeBatchReview> | null } = {
      current: null,
    };

    const Harness = (): React.ReactElement | null => {
      latest.current = useWorkspaceAiKnowledgeBatchReview({
        workspaceId: 'workspace-a',
        rows: [row(fact('fact-a')), row(fact('fact-b'))],
        filters: {
          view: KnowledgeFactListView.Active,
          reviewStatuses: [KnowledgeFactReviewStatus.Pending],
          evidenceState: KnowledgeFactEvidenceState.Any,
        },
        nextCursor: null,
        onRefresh,
      });
      return null;
    };

    try {
      await React.act(async () => {
        root.render(React.createElement(Harness));
        await flushMicrotasks();
      });

      expect(getBatchReviewStatus).toHaveBeenCalledTimes(1);
      expect(latest.current?.task?.status).toBe(KnowledgeFactBatchTaskStatus.Running);

      await React.act(async () => {
        await vi.advanceTimersByTimeAsync(750);
        await flushMicrotasks();
      });

      expect(getBatchReviewStatus).toHaveBeenCalledTimes(2);
      expect(latest.current?.task?.status).toBe(KnowledgeFactBatchTaskStatus.Running);
      expect(window.sessionStorage.getItem('ai-knowledge-batch-review:workspace-a')).not.toBeNull();
      expect(onRefresh).not.toHaveBeenCalled();

      await React.act(async () => {
        await vi.advanceTimersByTimeAsync(750);
        await flushMicrotasks();
      });

      expect(getBatchReviewStatus).toHaveBeenCalledTimes(3);
      expect(latest.current?.task?.status).toBe(KnowledgeFactBatchTaskStatus.Completed);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    } finally {
      root.unmount();
      restore();
    }
  });

  test('clears a restored storage entry when the task no longer exists', async () => {
    const { restore } = installFakeDom();
    window.sessionStorage.setItem('ai-knowledge-batch-review:workspace-a', 'missing-task');
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    vi.spyOn(knowledgeBaseService, 'getBatchReviewStatus').mockResolvedValue(null);
    const latest: { current: ReturnType<typeof useWorkspaceAiKnowledgeBatchReview> | null } = {
      current: null,
    };

    const Harness = (): React.ReactElement | null => {
      latest.current = useWorkspaceAiKnowledgeBatchReview({
        workspaceId: 'workspace-a',
        rows: [],
        filters: {
          view: KnowledgeFactListView.Active,
          reviewStatuses: [KnowledgeFactReviewStatus.Pending],
          evidenceState: KnowledgeFactEvidenceState.Any,
        },
        nextCursor: null,
        onRefresh: vi.fn().mockResolvedValue([]),
      });
      return null;
    };

    try {
      await React.act(async () => {
        root.render(React.createElement(Harness));
        await flushMicrotasks();
      });

      expect(latest.current?.task).toBeNull();
      expect(window.sessionStorage.getItem('ai-knowledge-batch-review:workspace-a')).toBeNull();
    } finally {
      root.unmount();
      restore();
    }
  });

  test('retries the whole server-owned retryable set without re-reading rows or detail samples', async () => {
    const { restore } = installFakeDom();
    window.sessionStorage.setItem('ai-knowledge-batch-review:workspace-a', 'task-2');
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const currentRows: WorkspaceAiKnowledgeRow[] = [];
    const onRefresh = vi.fn().mockResolvedValue(currentRows);
    const retryBatchReview = vi.fn().mockResolvedValue(task({
      taskId: 'task-3',
      status: KnowledgeFactBatchTaskStatus.Queued,
    }));
    Object.assign(knowledgeBaseService, { retryBatchReview });
    const startBatchReview = vi
      .spyOn(knowledgeBaseService, 'startBatchReview')
      .mockResolvedValue(task({
        taskId: 'task-3',
        status: KnowledgeFactBatchTaskStatus.Queued,
      }));
    vi.spyOn(knowledgeBaseService, 'getBatchReviewStatus')
      .mockResolvedValueOnce(task({
        taskId: 'task-2',
        status: KnowledgeFactBatchTaskStatus.Completed,
        action: KnowledgeFactBatchAction.Confirm,
        processedCount: 3,
        successCount: 1,
        skippedCount: 2,
        retryableCount: 205,
        details: [
          {
            factId: 'retryable-a',
            valuePreview: 'Retry A',
            code: KnowledgeFactBatchSkipReason.RevisionConflict,
            retryable: true,
          },
          {
            factId: 'not-retryable',
            valuePreview: 'Skip forever',
            code: KnowledgeFactBatchSkipReason.NoActiveEvidence,
            retryable: false,
          },
          {
            factId: 'retryable-missing-evidence',
            valuePreview: 'Retry missing evidence',
            code: KnowledgeFactBatchSkipReason.RevisionConflict,
            retryable: true,
          },
        ],
        completedAt: '2026-07-14T00:00:05.000Z',
      }))
      .mockResolvedValue(null);
    const latest: { current: ReturnType<typeof useWorkspaceAiKnowledgeBatchReview> | null } = {
      current: null,
    };

    const Harness = (): React.ReactElement | null => {
      latest.current = useWorkspaceAiKnowledgeBatchReview({
        workspaceId: 'workspace-a',
        rows: currentRows,
        filters: {
          view: KnowledgeFactListView.Active,
          reviewStatuses: [KnowledgeFactReviewStatus.Pending],
          evidenceState: KnowledgeFactEvidenceState.Any,
        },
        nextCursor: null,
        onRefresh,
      });
      return null;
    };

    try {
      await React.act(async () => {
        root.render(React.createElement(Harness));
        await flushMicrotasks();
      });

      expect(latest.current?.task?.status).toBe(KnowledgeFactBatchTaskStatus.Completed);
      expect(onRefresh).toHaveBeenCalledTimes(1);

      await React.act(async () => {
        startBatchReview.mockClear();
        retryBatchReview.mockClear();
        await latest.current?.retryFailed();
        await flushMicrotasks();
      });

      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(startBatchReview).not.toHaveBeenCalled();
      expect(retryBatchReview).toHaveBeenCalledWith('task-2');
    } finally {
      root.unmount();
      restore();
    }
  });

  test('retries a restored reject task by task id after remount', async () => {
    const { restore } = installFakeDom();
    window.sessionStorage.setItem('ai-knowledge-batch-review:workspace-a', JSON.stringify({
      taskId: 'task-reject',
      action: KnowledgeFactBatchAction.Reject,
      rejectReason: 'Not supported by policy',
    }));
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const retryBatchReview = vi.fn().mockResolvedValue(task({
      taskId: 'task-reject-retry',
      action: KnowledgeFactBatchAction.Reject,
      status: KnowledgeFactBatchTaskStatus.Queued,
    }));
    Object.assign(knowledgeBaseService, { retryBatchReview });
    const onRefresh = vi.fn().mockResolvedValue([] satisfies WorkspaceAiKnowledgeRow[]);
    vi.spyOn(knowledgeBaseService, 'getBatchReviewStatus')
      .mockResolvedValueOnce(task({
        taskId: 'task-reject',
        action: KnowledgeFactBatchAction.Reject,
        status: KnowledgeFactBatchTaskStatus.Completed,
        processedCount: 1,
        skippedCount: 1,
        failedCount: 0,
        retryableCount: 1,
        details: [
          {
            factId: 'retryable-reject',
            valuePreview: 'Retry reject',
            code: KnowledgeFactBatchSkipReason.RevisionConflict,
            retryable: true,
          },
        ],
        completedAt: '2026-07-14T00:00:05.000Z',
      }))
      .mockResolvedValue(null);
    const latest: { current: ReturnType<typeof useWorkspaceAiKnowledgeBatchReview> | null } = {
      current: null,
    };

    const Harness = (): React.ReactElement | null => {
      latest.current = useWorkspaceAiKnowledgeBatchReview({
        workspaceId: 'workspace-a',
        rows: [],
        filters: {
          view: KnowledgeFactListView.Active,
          reviewStatuses: [KnowledgeFactReviewStatus.Pending],
          evidenceState: KnowledgeFactEvidenceState.Any,
        },
        nextCursor: null,
        onRefresh,
      });
      return null;
    };

    try {
      await React.act(async () => {
        root.render(React.createElement(Harness));
        await flushMicrotasks();
      });

      expect(latest.current?.task?.action).toBe(KnowledgeFactBatchAction.Reject);
      expect(onRefresh).toHaveBeenCalledTimes(1);

      await React.act(async () => {
        await latest.current?.retryFailed();
        await flushMicrotasks();
      });

      expect(retryBatchReview).toHaveBeenCalledWith('task-reject');
    } finally {
      root.unmount();
      restore();
    }
  });
});
