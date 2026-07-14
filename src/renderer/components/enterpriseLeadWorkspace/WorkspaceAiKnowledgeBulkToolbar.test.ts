import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  KNOWLEDGE_FACT_BATCH_REJECT_REASON_MAX_CHARS,
  KnowledgeFactBatchAction,
  KnowledgeFactBatchSkipReason,
  KnowledgeFactBatchTaskStatus,
  KnowledgeFactDomain,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeFactBatchReviewTask,
  KnowledgeFactSummary,
} from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import type { WorkspaceAiKnowledgeBatchReviewViewModel } from './useWorkspaceAiKnowledgeBatchReview';
import {
  WorkspaceAiKnowledgeBulkReviewDialog,
} from './WorkspaceAiKnowledgeBulkReviewDialog';
import {
  WorkspaceAiKnowledgeBulkToolbar,
} from './WorkspaceAiKnowledgeBulkToolbar';

const fact = (id: string): KnowledgeFactSummary => ({
  id,
  domain: KnowledgeFactDomain.ProductList,
  value: `${id} value preview`,
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
});

const createTask = (
  overrides: Partial<KnowledgeFactBatchReviewTask> = {},
): KnowledgeFactBatchReviewTask => ({
  taskId: 'task-1',
  workspaceId: 'workspace-1',
  action: KnowledgeFactBatchAction.Confirm,
  status: KnowledgeFactBatchTaskStatus.Queued,
  totalCount: 0,
  processedCount: 0,
  successCount: 0,
  skippedCount: 0,
  failedCount: 0,
  skippedByReason: {},
  details: [],
  createdAt: '2026-07-14T00:00:00.000Z',
  startedAt: null,
  updatedAt: '2026-07-14T00:00:00.000Z',
  completedAt: null,
  ...overrides,
});

const createViewModel = (
  overrides: Partial<WorkspaceAiKnowledgeBatchReviewViewModel> = {},
): WorkspaceAiKnowledgeBatchReviewViewModel => ({
  selectedFacts: new Map<string, KnowledgeFactSummary>(),
  selectionMode: null,
  selectedCount: 0,
  visibleSelectableCount: 0,
  allVisibleSelected: false,
  someVisibleSelected: false,
  canSelectAllMatching: false,
  task: null,
  isStarting: false,
  toggleFact: vi.fn(),
  toggleVisible: vi.fn(),
  selectMatching: vi.fn(),
  clearSelection: vi.fn(),
  start: vi.fn(async () => undefined),
  retryFailed: vi.fn(async () => undefined),
  dismissTask: vi.fn(),
  ...overrides,
});

const renderToolbar = (
  viewModel: WorkspaceAiKnowledgeBatchReviewViewModel,
  overrides: Partial<React.ComponentProps<typeof WorkspaceAiKnowledgeBulkToolbar>> = {},
): string =>
  renderToStaticMarkup(
    React.createElement(WorkspaceAiKnowledgeBulkToolbar, {
      viewModel,
      showArchiveAction: true,
      ...overrides,
    }),
  );

const renderDialog = (
  overrides: Partial<React.ComponentProps<typeof WorkspaceAiKnowledgeBulkReviewDialog>> = {},
): string =>
  renderToStaticMarkup(
    React.createElement(WorkspaceAiKnowledgeBulkReviewDialog, {
      action: KnowledgeFactBatchAction.Confirm,
      isOpen: true,
      selectedCount: 2,
      isSubmitting: false,
      reason: '',
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
      onReasonChange: vi.fn(),
      ...overrides,
    }),
  );

class FakeDomNode {
  parentNode: FakeDomNode | null = null;
  childNodes: FakeDomNode[] = [];
  ownerDocument: FakeDomDocument | null = null;
  nodeValue: string | null = null;
  private textContentValue = '';

  get textContent(): string {
    return this.textContentValue;
  }

  set textContent(value: string) {
    this.textContentValue = value;
  }

  get firstChild(): FakeDomNode | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): FakeDomNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get isConnected(): boolean {
    return (
      (this as { nodeType?: number }).nodeType === 9 ||
      this.parentNode?.isConnected === true
    );
  }

  appendChild(node: FakeDomNode): FakeDomNode {
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }

  insertBefore(node: FakeDomNode, before: FakeDomNode | null): FakeDomNode {
    if (!before) {
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
      const activeElement = this.ownerDocument?.activeElement ?? null;
      if (activeElement && node.contains(activeElement)) {
        this.ownerDocument?.setActiveElement(this.ownerDocument.body);
      }
      this.childNodes.splice(index, 1);
      node.parentNode = null;
    }
    return node;
  }

  contains(node: FakeDomNode | null): boolean {
    let current = node;
    while (current) {
      if (current === this) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
  }
}

class FakeDomText extends FakeDomNode {
  nodeType = 3;
  nodeName = '#text';

  constructor(value: string) {
    super();
    this.nodeValue = value;
    this.textContent = value;
  }
}

class FakeDomComment extends FakeDomNode {
  nodeType = 8;
  nodeName = '#comment';

  constructor(value: string) {
    super();
    this.nodeValue = value;
    this.textContent = value;
  }
}

class FakeDomElement extends FakeDomNode {
  nodeType = 1;
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  nodeName: string;
  selected = false;
  defaultSelected = false;
  checked = false;
  defaultChecked = false;
  disabled = false;
  private eventListeners = new Map<
    string,
    Array<{
      listener: EventListenerOrEventListenerObject;
      capture: boolean;
    }>
  >();

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

  get textContent(): string {
    return this.childNodes.map(node => node.textContent ?? '').join('');
  }

  set textContent(value: string) {
    this.childNodes = value ? [new FakeDomText(value)] : [];
  }

  get options(): FakeDomElement[] {
    return this.childNodes.filter(
      (node): node is FakeDomElement =>
        node instanceof FakeDomElement && node.tagName.toLowerCase() === 'option',
    );
  }

  get value(): string {
    return this.getAttribute('value') ?? '';
  }

  set value(value: string) {
    this.setAttribute('value', value);
  }

  get type(): string {
    return this.getAttribute('type') ?? '';
  }

  set type(value: string) {
    this.setAttribute('type', value);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  setAttributeNS(_namespace: string | null, name: string, value: string): void {
    this.setAttribute(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const capture =
      typeof options === 'boolean' ? options : Boolean(options?.capture);
    const listeners = this.eventListeners.get(type) ?? [];
    listeners.push({ listener, capture });
    this.eventListeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    const capture =
      typeof options === 'boolean' ? options : Boolean(options?.capture);
    const listeners = this.eventListeners.get(type);
    if (!listeners) {
      return;
    }
    this.eventListeners.set(
      type,
      listeners.filter(
        entry => entry.listener !== listener || entry.capture !== capture,
      ),
    );
  }

  click(): void {
    if (this.tagName.toLowerCase() === 'input' && this.type === 'checkbox') {
      this.checked = !this.checked;
    }
    this.dispatchBubblingEvent('click');
  }

  change(value: string): void {
    this.value = value;
    this.dispatchBubblingEvent('change');
  }

  focus(): void {
    this.ownerDocument?.setActiveElement(this);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getAttributeNS(_namespace: string | null, name: string): string | null {
    return this.getAttribute(name);
  }

  getAttributeNames(): string[] {
    return [...this.attributes.keys()];
  }

  private dispatchBubblingEvent(type: string): void {
    const path: FakeDomElement[] = [this];
    let current: FakeDomNode | null = this.parentNode;
    while (current) {
      if (current instanceof FakeDomElement) {
        path.push(current);
      }
      current = current.parentNode;
    }
    let propagationStopped = false;
    let immediatePropagationStopped = false;
    let defaultPrevented = false;
    const event = {
      type,
      target: this,
      srcElement: this,
      currentTarget: null,
      bubbles: true,
      cancelable: true,
      get defaultPrevented(): boolean {
        return defaultPrevented;
      },
      eventPhase: 0,
      isTrusted: false,
      timeStamp: Date.now(),
      button: 0,
      buttons: 0,
      detail: 1,
      view: window,
      preventDefault(): void {
        defaultPrevented = true;
      },
      stopPropagation(): void {
        propagationStopped = true;
      },
      stopImmediatePropagation(): void {
        propagationStopped = true;
        immediatePropagationStopped = true;
      },
      composedPath: (): FakeDomElement[] => [...path],
    } as unknown as MouseEvent;
    const invoke = (element: FakeDomElement, capture: boolean): void => {
      immediatePropagationStopped = false;
      for (const entry of element.eventListeners.get(type) ?? []) {
        if (entry.capture !== capture || immediatePropagationStopped) {
          continue;
        }
        if (typeof entry.listener === 'function') {
          entry.listener.call(element, event);
        } else {
          entry.listener.handleEvent(event);
        }
      }
    };

    for (const element of [...path].reverse()) {
      invoke(element, true);
      if (propagationStopped) {
        return;
      }
    }
    for (const element of path) {
      invoke(element, false);
      if (propagationStopped) {
        return;
      }
    }
  }
}

const findFakeDomElement = (
  root: FakeDomNode,
  predicate: (element: FakeDomElement) => boolean,
): FakeDomElement | null => {
  for (const child of root.childNodes) {
    if (child instanceof FakeDomElement) {
      if (predicate(child)) {
        return child;
      }
      const nested = findFakeDomElement(child, predicate);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
};

class FakeDomDocument extends FakeDomNode {
  nodeType = 9;
  nodeName = '#document';
  documentElement: FakeDomElement;
  body: FakeDomElement;
  defaultView: Window & typeof globalThis;
  activeElement: FakeDomElement | null = null;
  private eventListeners = new Map<
    string,
    EventListenerOrEventListenerObject[]
  >();

  constructor() {
    super();
    this.documentElement = new FakeDomElement('html');
    this.body = new FakeDomElement('body');
    this.documentElement.ownerDocument = this;
    this.body.ownerDocument = this;
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
    this.defaultView = globalThis as Window & typeof globalThis;
    this.activeElement = this.body;
  }

  createElement(tagName: string): FakeDomElement {
    const element = new FakeDomElement(tagName);
    element.ownerDocument = this;
    return element;
  }

  createElementNS(namespace: string | null, tagName: string): FakeDomElement {
    const element = new FakeDomElement(
      tagName,
      namespace === 'http://www.w3.org/2000/svg',
    );
    element.ownerDocument = this;
    return element;
  }

  createTextNode(value: string): FakeDomText {
    const node = new FakeDomText(value);
    node.ownerDocument = this;
    return node;
  }

  createComment(value: string): FakeDomComment {
    const node = new FakeDomComment(value);
    node.ownerDocument = this;
    return node;
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    const listeners = this.eventListeners.get(type) ?? [];
    listeners.push(listener);
    this.eventListeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    const listeners = this.eventListeners.get(type) ?? [];
    this.eventListeners.set(
      type,
      listeners.filter(entry => entry !== listener),
    );
  }

  dispatch(
    type: string,
    target: FakeDomNode,
    key?: string,
    options: { shiftKey?: boolean } = {},
  ): Event {
    const path: FakeDomElement[] = [];
    if (target instanceof FakeDomElement) {
      path.push(target);
      let current: FakeDomNode | null = target.parentNode;
      while (current) {
        if (current instanceof FakeDomElement) {
          path.push(current);
        }
        current = current.parentNode;
      }
    }
    let propagationStopped = false;
    let immediatePropagationStopped = false;
    let defaultPrevented = false;
    const event = {
      type,
      target,
      srcElement: target,
      currentTarget: null,
      bubbles: true,
      cancelable: true,
      key,
      shiftKey: options.shiftKey ?? false,
      get defaultPrevented(): boolean {
        return defaultPrevented;
      },
      eventPhase: 0,
      isTrusted: false,
      timeStamp: Date.now(),
      preventDefault(): void {
        defaultPrevented = true;
      },
      stopPropagation(): void {
        propagationStopped = true;
      },
      stopImmediatePropagation(): void {
        propagationStopped = true;
        immediatePropagationStopped = true;
      },
      composedPath: (): FakeDomNode[] => [target, ...path.slice(1)],
    } as unknown as Event;
    const invokeElement = (element: FakeDomElement, capture: boolean): void => {
      immediatePropagationStopped = false;
      for (const entry of element.eventListeners.get(type) ?? []) {
        if (entry.capture !== capture || immediatePropagationStopped) {
          continue;
        }
        if (typeof entry.listener === 'function') {
          entry.listener.call(element, event);
        } else {
          entry.listener.handleEvent(event);
        }
      }
    };

    for (const element of [...path].reverse()) {
      invokeElement(element, true);
      if (propagationStopped) {
        return event;
      }
    }
    for (const element of path) {
      invokeElement(element, false);
      if (propagationStopped) {
        return event;
      }
    }
    for (const listener of this.eventListeners.get(type) ?? []) {
      if (typeof listener === 'function') {
        listener.call(this, event);
      } else {
        listener.handleEvent(event);
      }
      if (propagationStopped) {
        return event;
      }
    }
    if (
      type === 'keydown' &&
      !event.defaultPrevented &&
      target instanceof FakeDomElement &&
      target.tagName.toLowerCase() === 'button' &&
      (key === 'Enter' || key === ' ')
    ) {
      target.click();
    }
    return event;
  }

  listenerCount(type: string): number {
    return this.eventListeners.get(type)?.length ?? 0;
  }

  setActiveElement(element: FakeDomElement | null): void {
    this.activeElement = element;
  }

  getElementById(): FakeDomElement | null {
    return null;
  }
}

const installFakeDom = (): {
  fakeDocument: FakeDomDocument;
  restore: () => void;
} => {
  const fakeDocument = new FakeDomDocument();
  const fakeWindow = {
    document: fakeDocument,
    navigator: { userAgent: 'node' },
    location: { href: 'http://localhost/', protocol: 'http:' },
    window: undefined as unknown,
    addEventListener: (): void => undefined,
    removeEventListener: (): void => undefined,
    requestAnimationFrame: (callback: FrameRequestCallback): number =>
      setTimeout(() => callback(Date.now()), 0) as unknown as number,
    cancelAnimationFrame: (handle: number): void => clearTimeout(handle),
    getSelection: (): Selection | null => null,
    HTMLElement: FakeDomElement,
    HTMLIFrameElement: class FakeDomIFrameElement {},
    Node: FakeDomNode,
    Text: FakeDomText,
    Comment: FakeDomComment,
    SVGElement: class FakeDomSvgElement {},
    event: undefined,
    self: undefined as unknown,
    top: undefined as unknown,
    parent: undefined as unknown,
  } as unknown as Window & typeof globalThis;

  fakeWindow.self = fakeWindow;
  fakeWindow.window = fakeWindow;
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
    fakeDocument,
    restore: () => {
      vi.unstubAllGlobals();
    },
  };
};

const findByAttribute = (
  root: FakeDomNode,
  attribute: string,
  value?: string,
): FakeDomElement | null =>
  findFakeDomElement(root, element => {
    const actual = element.getAttribute(attribute);
    return value === undefined ? actual !== null : actual === value;
  });

const findByTag = (
  root: FakeDomNode,
  tagName: string,
): FakeDomElement | null =>
  findFakeDomElement(
    root,
    element => element.tagName.toLowerCase() === tagName.toLowerCase(),
  );

describe('WorkspaceAiKnowledgeBulkToolbar', () => {
  afterEach(() => {
    i18nService.setLanguage('zh', { persist: false });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('uses english translations for stable markup assertions', () => {
    i18nService.setLanguage('en', { persist: false });
    expect(i18nService.t('enterpriseAiKnowledgeBatchSelectedCount')).toBe('{count} selected');
  });

  test('renders nothing when selection and task are both empty', () => {
    i18nService.setLanguage('en', { persist: false });
    expect(renderToolbar(createViewModel())).toBe('');
  });

  test('renders the selected count, mixed checkbox, and select-all-matching prompt', () => {
    i18nService.setLanguage('en', { persist: false });
    const markup = renderToolbar(
      createViewModel({
        selectedFacts: new Map([
          ['fact-a', fact('fact-a')],
          ['fact-b', fact('fact-b')],
        ]),
        selectionMode: 'page',
        selectedCount: 2,
        visibleSelectableCount: 4,
        someVisibleSelected: true,
        canSelectAllMatching: true,
      }),
    );

    expect(markup).toContain('data-ai-knowledge-bulk-toolbar="true"');
    expect(markup).toContain('2 selected');
    expect(markup).toContain('aria-checked="mixed"');
    expect(markup).toContain('Select all matching filters');
  });

  test('renders confirm as the primary action and reject/archive as secondary actions', () => {
    i18nService.setLanguage('en', { persist: false });
    const markup = renderToolbar(
      createViewModel({
        selectedFacts: new Map([['fact-a', fact('fact-a')]]),
        selectionMode: 'page',
        selectedCount: 1,
        visibleSelectableCount: 1,
        allVisibleSelected: true,
      }),
    );

    expect(markup).toContain('data-bulk-review-trigger="confirm"');
    expect(markup).toContain('data-bulk-review-trigger="reject"');
    expect(markup).toContain('data-bulk-review-trigger="archive"');
    expect(markup).toContain('bg-primary');
    expect(markup).toContain('border-border');
  });

  test('keeps reject submit enabled at the shared max length and blocks over-limit input with localized feedback', () => {
    i18nService.setLanguage('en', { persist: false });
    const maxLengthReason = 'x'.repeat(KNOWLEDGE_FACT_BATCH_REJECT_REASON_MAX_CHARS);
    const overLimitReason = `${maxLengthReason}x`;
    const boundaryMarkup = renderDialog({
      action: KnowledgeFactBatchAction.Reject,
      reason: maxLengthReason,
    });
    const overLimitMarkup = renderDialog({
      action: KnowledgeFactBatchAction.Reject,
      reason: overLimitReason,
    });

    expect(boundaryMarkup).toContain('<textarea');
    expect(boundaryMarkup).not.toContain('data-bulk-review-confirm="true" disabled=""');
    expect(overLimitMarkup).toContain('data-bulk-review-confirm="true" disabled=""');
    expect(overLimitMarkup).toContain('Keep the shared rejection reason within 240 characters.');
  });

  test('disables toolbar actions and announces progress while a task is running', () => {
    i18nService.setLanguage('en', { persist: false });
    const markup = renderToolbar(
      createViewModel({
        selectedFacts: new Map([['fact-a', fact('fact-a')]]),
        selectionMode: 'page',
        selectedCount: 1,
        visibleSelectableCount: 1,
        allVisibleSelected: true,
        task: createTask({
          status: KnowledgeFactBatchTaskStatus.Running,
          totalCount: 10,
          processedCount: 3,
          successCount: 2,
          skippedCount: 1,
        }),
      }),
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('3 / 10');
    expect(markup).toContain('data-bulk-review-trigger="confirm" disabled=""');
    expect(markup).toContain('data-bulk-review-clear-selection="true" disabled=""');
  });

  test('renders completed summary, caps detail samples, and only shows retry when retryable details exist', () => {
    i18nService.setLanguage('en', { persist: false });
    const retryableMarkup = renderToolbar(
      createViewModel({
        task: createTask({
          status: KnowledgeFactBatchTaskStatus.Completed,
          totalCount: 9,
          processedCount: 9,
          successCount: 4,
          skippedCount: 3,
          failedCount: 2,
          skippedByReason: {
            [KnowledgeFactBatchSkipReason.NoActiveEvidence]: 2,
            [KnowledgeFactBatchSkipReason.RevisionConflict]: 1,
          },
          details: [
            { factId: 'fact-1', valuePreview: 'Preview 1', code: 'no_active_evidence', retryable: false },
            { factId: 'fact-2', valuePreview: 'Preview 2', code: 'revision_conflict', retryable: true },
            { factId: 'fact-3', valuePreview: 'Preview 3', code: 'projection_conflict', retryable: false },
            { factId: 'fact-4', valuePreview: 'Preview 4', code: 'not_found', retryable: false },
            { factId: 'fact-5', valuePreview: 'Preview 5', code: 'unknown_error', retryable: true },
            { factId: 'fact-6', valuePreview: 'Preview 6', code: 'unknown_error', retryable: true },
          ],
        }),
      }),
    );
    const nonRetryableMarkup = renderToolbar(
      createViewModel({
        task: createTask({
          status: KnowledgeFactBatchTaskStatus.Failed,
          totalCount: 2,
          processedCount: 2,
          successCount: 0,
          skippedCount: 1,
          failedCount: 1,
          details: [
            { factId: 'fact-1', valuePreview: 'Preview 1', code: 'not_found', retryable: false },
          ],
        }),
      }),
    );

    expect(retryableMarkup).toContain('Success 4');
    expect(retryableMarkup).toContain('Skipped 3');
    expect(retryableMarkup).toContain('Failed 2');
    expect(retryableMarkup).toContain('Preview 5');
    expect(retryableMarkup).not.toContain('Preview 6');
    expect(retryableMarkup).toContain('data-bulk-review-retry="true"');
    expect(nonRetryableMarkup).not.toContain('data-bulk-review-retry="true"');
  });

  test('guards terminal retry and dismiss interactions while a new batch task is starting', async () => {
    i18nService.setLanguage('en', { persist: false });
    const { restore } = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const retryFailed = vi.fn(async () => undefined);
    const dismissTask = vi.fn();
    let unmounted = false;

    try {
      await React.act(async () => {
        root.render(
          React.createElement(WorkspaceAiKnowledgeBulkToolbar, {
            viewModel: createViewModel({
              isStarting: true,
              task: createTask({
                status: KnowledgeFactBatchTaskStatus.Completed,
                totalCount: 2,
                processedCount: 2,
                failedCount: 1,
                details: [
                  {
                    factId: 'retryable-a',
                    valuePreview: 'Retryable preview',
                    code: 'unknown_error',
                    retryable: true,
                  },
                ],
              }),
              retryFailed,
              dismissTask,
            }),
            showArchiveAction: true,
          }),
        );
        await Promise.resolve();
      });

      const retryButton = findByAttribute(
        container as unknown as FakeDomNode,
        'data-bulk-review-retry',
      );
      const dismissButton = findByAttribute(
        container as unknown as FakeDomNode,
        'data-bulk-review-dismiss',
      );

      expect(retryButton).not.toBeNull();
      expect(dismissButton).not.toBeNull();
      expect(retryButton?.getAttribute('disabled')).toBe('');
      expect(dismissButton?.getAttribute('disabled')).toBe('');

      await React.act(async () => {
        retryButton?.click();
        dismissButton?.click();
        await Promise.resolve();
      });

      expect(retryFailed).not.toHaveBeenCalled();
      expect(dismissTask).not.toHaveBeenCalled();
    } finally {
      await React.act(async () => {
        root.unmount();
        unmounted = true;
      });
      if (!unmounted) {
        root.unmount();
      }
      restore();
    }
  });

  test('moves focus into the dialog on open so Escape closes it after mouse-triggered launch', async () => {
    i18nService.setLanguage('en', { persist: false });
    const { fakeDocument, restore } = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const opener = document.createElement('button');
    const container = document.createElement('div');
    document.body.appendChild(opener);
    document.body.appendChild(container);
    const root = createRoot(container);
    const onCancel = vi.fn();
    let unmounted = false;

    try {
      opener.focus();
      expect(fakeDocument.activeElement).toBe(opener);

      await React.act(async () => {
        root.render(
          React.createElement(WorkspaceAiKnowledgeBulkReviewDialog, {
            action: KnowledgeFactBatchAction.Confirm,
            isOpen: true,
            selectedCount: 1,
            isSubmitting: false,
            reason: '',
            onCancel,
            onConfirm: vi.fn(),
            onReasonChange: vi.fn(),
          }),
        );
        await Promise.resolve();
      });

      const dialog = findByAttribute(
        container as unknown as FakeDomNode,
        'role',
        'dialog',
      );

      expect(dialog).not.toBeNull();
      expect(fakeDocument.activeElement).toBe(dialog);

      await React.act(async () => {
        fakeDocument.dispatch('keydown', dialog ?? (container as unknown as FakeDomNode), 'Escape');
        await Promise.resolve();
      });

      expect(findByAttribute(
        container as unknown as FakeDomNode,
        'role',
        'dialog',
      )).not.toBeNull();
      expect(onCancel).toHaveBeenCalledTimes(1);
    } finally {
      await React.act(async () => {
        root.unmount();
        unmounted = true;
      });
      if (!unmounted) {
        root.unmount();
      }
      restore();
    }
  });

  test('renders an accessible dialog shell for reject and confirm actions', () => {
    i18nService.setLanguage('en', { persist: false });
    const rejectMarkup = renderDialog({
      action: KnowledgeFactBatchAction.Reject,
      reason: '',
    });
    const confirmMarkup = renderDialog({
      action: KnowledgeFactBatchAction.Confirm,
    });

    expect(rejectMarkup).toContain('role="dialog"');
    expect(rejectMarkup).toContain('<textarea');
    expect(rejectMarkup).toContain('required=""');
    expect(confirmMarkup).not.toContain('<textarea');
  });

  test('still stops Escape from cancelling while the dialog is submitting', () => {
    i18nService.setLanguage('en', { persist: false });
    const tree = renderDialog({
      action: KnowledgeFactBatchAction.Confirm,
      isSubmitting: true,
    });

    expect(tree).toContain('data-bulk-review-cancel="true" disabled=""');
    expect(tree).toContain('Creating the bulk review task…');
  });

  test('renders the reject textarea in the mounted dialog tree', async () => {
    i18nService.setLanguage('en', { persist: false });
    const { restore } = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let unmounted = false;

    try {
      await React.act(async () => {
        root.render(
          React.createElement(WorkspaceAiKnowledgeBulkReviewDialog, {
            action: KnowledgeFactBatchAction.Reject,
            isOpen: true,
            selectedCount: 2,
            isSubmitting: false,
            reason: '',
            onCancel: vi.fn(),
            onConfirm: vi.fn(),
            onReasonChange: vi.fn(),
          }),
        );
        await Promise.resolve();
      });

      expect(findByTag(container as unknown as FakeDomNode, 'textarea')).not.toBeNull();
    } finally {
      await React.act(async () => {
        root.unmount();
        unmounted = true;
      });
      if (!unmounted) {
        root.unmount();
      }
      restore();
    }
  });
});
