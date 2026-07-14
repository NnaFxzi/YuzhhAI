import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  KnowledgeFactEvidenceState,
  KnowledgeFactListView,
  KnowledgeFactReviewStatus,
} from '../../../shared/knowledgeBase/constants';
import { i18nService } from '../../services/i18n';
import {
  WorkspaceAiKnowledgeFilters,
  type WorkspaceAiKnowledgeFiltersProps,
} from './WorkspaceAiKnowledgeFilters';

const defaultProps: WorkspaceAiKnowledgeFiltersProps = {
  filters: {
    view: KnowledgeFactListView.Active,
    reviewStatuses: [],
    evidenceState: KnowledgeFactEvidenceState.Any,
  },
  onViewChange: vi.fn(),
  onReviewStatusesChange: vi.fn(),
  onEvidenceStateChange: vi.fn(),
};

const renderFilters = (
  overrides: Partial<WorkspaceAiKnowledgeFiltersProps> = {},
): string =>
  renderToStaticMarkup(
    React.createElement(WorkspaceAiKnowledgeFilters, {
      ...defaultProps,
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

interface FakeEventInit {
  key?: string;
  shiftKey?: boolean;
  target: FakeDomNode;
  type: string;
}

const createFakeEvent = ({
  key,
  shiftKey = false,
  target,
  type,
}: FakeEventInit): Event => {
  let defaultPrevented = false;
  return {
    type,
    target,
    srcElement: target,
    currentTarget: null,
    bubbles: true,
    cancelable: true,
    key,
    shiftKey,
    get defaultPrevented(): boolean {
      return defaultPrevented;
    },
    eventPhase: 0,
    isTrusted: false,
    timeStamp: Date.now(),
    preventDefault(): void {
      defaultPrevented = true;
    },
    stopPropagation(): void {},
    stopImmediatePropagation(): void {},
    composedPath: (): FakeDomNode[] => {
      const path: FakeDomNode[] = [target];
      let current = target.parentNode;
      while (current) {
        path.push(current);
        current = current.parentNode;
      }
      return path;
    },
  } as unknown as Event;
};

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

  focus(): void {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getAttributeNS(_namespace: string | null, name: string): string | null {
    return this.getAttribute(name);
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
    this.defaultView = globalThis as Window & typeof globalThis;
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
    const event = createFakeEvent({
      key,
      shiftKey: options.shiftKey,
      target,
      type,
    });
    for (const listener of this.eventListeners.get(type) ?? []) {
      if (typeof listener === 'function') {
        listener.call(this, event);
      } else {
        listener.handleEvent(event);
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

describe('WorkspaceAiKnowledgeFilters', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('renders styled single selects and an accessible review-status trigger', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const html = renderFilters();

    expect(html).toContain('data-ai-knowledge-filters');
    expect(html).toContain('data-review-status-trigger');
    expect(html).not.toContain('<select multiple');
    expect((html.match(/<select/g) ?? [])).toHaveLength(2);
    expect((html.match(/<select[^>]*class="[^"]*h-10/g) ?? [])).toHaveLength(2);
    expect(html).toContain('enterpriseAiKnowledgeReviewFilterAll');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/aria-controls="([^"]+)"/);
    const triggerMarkup =
      html.match(/<button[^>]*data-review-status-trigger[^>]*>/)?.[0] ?? '';
    expect(triggerMarkup).not.toContain('aria-label=');
    const labelledByIds =
      triggerMarkup.match(/aria-labelledby="([^"]+)"/)?.[1].split(' ') ?? [];
    expect(labelledByIds).toHaveLength(2);
    for (const id of labelledByIds) {
      expect(html).toContain(`id="${id}"`);
    }

    const selectedHtml = renderFilters({
      filters: {
        ...defaultProps.filters,
        reviewStatuses: [
          KnowledgeFactReviewStatus.Confirmed,
          KnowledgeFactReviewStatus.Pending,
        ],
      },
    });
    expect(selectedHtml.indexOf('enterpriseAiKnowledgeStatusPending')).toBeLessThan(
      selectedHtml.indexOf('enterpriseAiKnowledgeStatusConfirmed'),
    );
  });

  test('shows clear filters only when a non-default filter is active', () => {
    expect(renderFilters()).not.toContain('data-ai-knowledge-clear-filters');
    expect(
      renderFilters({
        filters: {
          ...defaultProps.filters,
          view: KnowledgeFactListView.History,
          evidenceState: KnowledgeFactEvidenceState.Stale,
        },
      }),
    ).toContain('data-ai-knowledge-clear-filters');
  });

  test('clears the view, review status, and evidence filters together', async () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    const { restore } = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const onViewChange = vi.fn();
    const onReviewStatusesChange = vi.fn();
    const onEvidenceStateChange = vi.fn();

    try {
      await React.act(async () => {
        root.render(
          React.createElement(WorkspaceAiKnowledgeFilters, {
            ...defaultProps,
            filters: {
              view: KnowledgeFactListView.History,
              reviewStatuses: [KnowledgeFactReviewStatus.Pending],
              evidenceState: KnowledgeFactEvidenceState.Stale,
            },
            onViewChange,
            onReviewStatusesChange,
            onEvidenceStateChange,
          }),
        );
        await Promise.resolve();
      });

      const clearButton = findByAttribute(
        container as unknown as FakeDomNode,
        'data-ai-knowledge-clear-filters',
      );
      expect(clearButton).not.toBeNull();

      await React.act(async () => {
        clearButton?.click();
        await Promise.resolve();
      });

      expect(onViewChange).toHaveBeenCalledWith(KnowledgeFactListView.Active);
      expect(onReviewStatusesChange).toHaveBeenCalledWith([]);
      expect(onEvidenceStateChange).toHaveBeenCalledWith(
        KnowledgeFactEvidenceState.Any,
      );
    } finally {
      root.unmount();
      restore();
    }
  });

  test('emits explicitly selected review statuses in enum order', async () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    const { restore } = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const onReviewStatusesChange = vi.fn();
    let unmounted = false;
    const Harness = (): React.ReactElement => {
      const [filters, setFilters] = React.useState(defaultProps.filters);
      return React.createElement(WorkspaceAiKnowledgeFilters, {
        filters,
        onViewChange: vi.fn(),
        onReviewStatusesChange: statuses => {
          onReviewStatusesChange(statuses);
          setFilters(current => ({
            ...current,
            reviewStatuses: statuses,
          }));
        },
        onEvidenceStateChange: vi.fn(),
      });
    };

    try {
      await React.act(async () => {
        root.render(React.createElement(Harness));
        await Promise.resolve();
      });
      const trigger = findByAttribute(
        container as unknown as FakeDomNode,
        'data-review-status-trigger',
      );
      expect(trigger).not.toBeNull();

      await React.act(async () => {
        trigger?.click();
        await Promise.resolve();
      });
      expect(trigger?.getAttribute('aria-expanded')).toBe('true');
      const menu = findByAttribute(
        container as unknown as FakeDomNode,
        'role',
        'menu',
      );
      expect(menu?.getAttribute('id')).toBe(
        trigger?.getAttribute('aria-controls'),
      );
      const pending = findByAttribute(
        container as unknown as FakeDomNode,
        'value',
        KnowledgeFactReviewStatus.Pending,
      );
      const confirmed = findByAttribute(
        container as unknown as FakeDomNode,
        'value',
        KnowledgeFactReviewStatus.Confirmed,
      );

      await React.act(async () => {
        confirmed?.click();
        await Promise.resolve();
      });
      await React.act(async () => {
        pending?.click();
        await Promise.resolve();
      });

      expect(onReviewStatusesChange).toHaveBeenLastCalledWith([
        KnowledgeFactReviewStatus.Pending,
        KnowledgeFactReviewStatus.Confirmed,
      ]);
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

  test('implements the menuitemcheckbox focus and keyboard model', async () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    const { fakeDocument, restore } = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const fakeContainer = container as unknown as FakeDomNode;
    const root = createRoot(container);
    const onReviewStatusesChange = vi.fn();
    let unmounted = false;

    try {
      await React.act(async () => {
        root.render(
          React.createElement(WorkspaceAiKnowledgeFilters, {
            ...defaultProps,
            filters: {
              ...defaultProps.filters,
              reviewStatuses: [KnowledgeFactReviewStatus.Confirmed],
            },
            onReviewStatusesChange,
          }),
        );
        await Promise.resolve();
      });
      const trigger = findByAttribute(
        container as unknown as FakeDomNode,
        'data-review-status-trigger',
      );
      await React.act(async () => {
        trigger?.click();
        await Promise.resolve();
      });
      const pending = findByAttribute(
        container as unknown as FakeDomNode,
        'value',
        KnowledgeFactReviewStatus.Pending,
      );
      const confirmed = findByAttribute(
        container as unknown as FakeDomNode,
        'value',
        KnowledgeFactReviewStatus.Confirmed,
      );
      const rejected = findByAttribute(
        container as unknown as FakeDomNode,
        'value',
        KnowledgeFactReviewStatus.Rejected,
      );

      expect(pending?.getAttribute('role')).toBe('menuitemcheckbox');
      expect(pending?.getAttribute('aria-checked')).toBe('false');
      expect(confirmed?.getAttribute('aria-checked')).toBe('true');
      expect(pending?.getAttribute('tabindex')).toBe('-1');
      expect(confirmed?.getAttribute('tabindex')).toBe('-1');
      expect(rejected?.getAttribute('tabindex')).toBe('-1');
      expect(fakeDocument.activeElement).toBe(confirmed);

      await React.act(async () => {
        fakeDocument.dispatch('keydown', confirmed ?? fakeContainer, 'ArrowDown');
        await Promise.resolve();
      });
      expect(fakeDocument.activeElement).toBe(rejected);
      await React.act(async () => {
        fakeDocument.dispatch('keydown', rejected ?? fakeContainer, 'ArrowDown');
        await Promise.resolve();
      });
      expect(fakeDocument.activeElement).toBe(pending);
      await React.act(async () => {
        fakeDocument.dispatch('keydown', pending ?? fakeContainer, 'ArrowUp');
        await Promise.resolve();
      });
      expect(fakeDocument.activeElement).toBe(rejected);
      await React.act(async () => {
        fakeDocument.dispatch('keydown', rejected ?? fakeContainer, 'Home');
        await Promise.resolve();
      });
      expect(fakeDocument.activeElement).toBe(pending);
      await React.act(async () => {
        fakeDocument.dispatch('keydown', pending ?? fakeContainer, 'End');
        await Promise.resolve();
      });
      expect(fakeDocument.activeElement).toBe(rejected);

      await React.act(async () => {
        fakeDocument.dispatch('keydown', rejected ?? fakeContainer, 'Enter');
        await Promise.resolve();
      });
      expect(onReviewStatusesChange).toHaveBeenLastCalledWith([
        KnowledgeFactReviewStatus.Confirmed,
        KnowledgeFactReviewStatus.Rejected,
      ]);
      await React.act(async () => {
        fakeDocument.dispatch('keydown', rejected ?? fakeContainer, 'Home');
        await Promise.resolve();
      });
      await React.act(async () => {
        fakeDocument.dispatch('keydown', pending ?? fakeContainer, ' ');
        await Promise.resolve();
      });
      expect(onReviewStatusesChange).toHaveBeenLastCalledWith([
        KnowledgeFactReviewStatus.Pending,
        KnowledgeFactReviewStatus.Confirmed,
      ]);

      await React.act(async () => {
        fakeDocument.dispatch('keydown', pending ?? fakeContainer, 'Escape');
        await Promise.resolve();
      });
      expect(trigger?.getAttribute('aria-expanded')).toBe('false');
      expect(fakeDocument.activeElement).toBe(trigger);
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

  test('lets Tab and Shift+Tab leave menuitems without restoring trigger focus', async () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    const { fakeDocument, restore } = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const fakeContainer = container as unknown as FakeDomNode;
    const root = createRoot(container);
    let unmounted = false;

    try {
      await React.act(async () => {
        root.render(
          React.createElement(WorkspaceAiKnowledgeFilters, defaultProps),
        );
        await Promise.resolve();
      });
      const trigger = findByAttribute(
        container as unknown as FakeDomNode,
        'data-review-status-trigger',
      );
      const viewSelect = findByAttribute(
        container as unknown as FakeDomNode,
        'aria-label',
        'enterpriseAiKnowledgeViewLabel',
      );
      const evidenceSelect = findByAttribute(
        container as unknown as FakeDomNode,
        'aria-label',
        'enterpriseAiKnowledgeEvidenceFilterLabel',
      );
      const cases = [
        { shiftKey: false, nextFocus: evidenceSelect },
        { shiftKey: true, nextFocus: viewSelect },
      ];

      for (const tabCase of cases) {
        await React.act(async () => {
          trigger?.click();
          await Promise.resolve();
        });
        const focusedMenuItem = fakeDocument.activeElement;
        expect(focusedMenuItem?.getAttribute('role')).toBe('menuitemcheckbox');
        let tabEvent!: Event;
        await React.act(async () => {
          tabEvent = fakeDocument.dispatch(
            'keydown',
            focusedMenuItem ?? fakeContainer,
            'Tab',
            { shiftKey: tabCase.shiftKey },
          );
          await Promise.resolve();
        });
        expect(tabEvent.defaultPrevented).toBe(false);
        expect(trigger?.getAttribute('aria-expanded')).toBe('false');
        expect(fakeDocument.activeElement).not.toBe(trigger);
        tabCase.nextFocus?.focus();
        expect(fakeDocument.activeElement).toBe(tabCase.nextFocus);
      }
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

  test('treats both sibling selects as outside without stealing focus', async () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    const { fakeDocument, restore } = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const onReviewStatusesChange = vi.fn();
    let unmounted = false;

    try {
      await React.act(async () => {
        root.render(
          React.createElement(WorkspaceAiKnowledgeFilters, {
            ...defaultProps,
            onReviewStatusesChange,
          }),
        );
        await Promise.resolve();
      });
      const trigger = findByAttribute(
        container as unknown as FakeDomNode,
        'data-review-status-trigger',
      );
      const siblingSelects = [
        findByAttribute(
          container as unknown as FakeDomNode,
          'aria-label',
          'enterpriseAiKnowledgeViewLabel',
        ),
        findByAttribute(
          container as unknown as FakeDomNode,
          'aria-label',
          'enterpriseAiKnowledgeEvidenceFilterLabel',
        ),
      ];

      expect(siblingSelects.every(Boolean)).toBe(true);
      for (const siblingSelect of siblingSelects) {
        if (!siblingSelect) {
          continue;
        }
        await React.act(async () => {
          trigger?.click();
          await Promise.resolve();
        });
        expect(trigger?.getAttribute('aria-expanded')).toBe('true');
        siblingSelect.focus();
        let arrowEvent!: Event;
        await React.act(async () => {
          arrowEvent = fakeDocument.dispatch(
            'keydown',
            siblingSelect,
            'ArrowDown',
          );
          await Promise.resolve();
        });
        expect(arrowEvent.defaultPrevented).toBe(false);
        expect(fakeDocument.activeElement).toBe(siblingSelect);
        expect(trigger?.getAttribute('aria-expanded')).toBe('true');
        await React.act(async () => {
          fakeDocument.dispatch('pointerdown', siblingSelect);
          await Promise.resolve();
        });
        expect(trigger?.getAttribute('aria-expanded')).toBe('false');
        expect(fakeDocument.activeElement).toBe(siblingSelect);
      }
      expect(onReviewStatusesChange).not.toHaveBeenCalled();
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

  test('forwards single-select changes and removes open-menu document listeners on unmount', async () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    const { fakeDocument, restore } = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const onViewChange = vi.fn();
    const onEvidenceStateChange = vi.fn();
    let unmounted = false;

    try {
      await React.act(async () => {
        root.render(
          React.createElement(WorkspaceAiKnowledgeFilters, {
            ...defaultProps,
            onViewChange,
            onEvidenceStateChange,
          }),
        );
        await Promise.resolve();
      });
      const viewSelect = findByAttribute(
        container as unknown as FakeDomNode,
        'aria-label',
        'enterpriseAiKnowledgeViewLabel',
      );
      const evidenceSelect = findByAttribute(
        container as unknown as FakeDomNode,
        'aria-label',
        'enterpriseAiKnowledgeEvidenceFilterLabel',
      );
      const trigger = findByAttribute(
        container as unknown as FakeDomNode,
        'data-review-status-trigger',
      );

      await React.act(async () => {
        viewSelect?.change(KnowledgeFactListView.History);
        evidenceSelect?.change(KnowledgeFactEvidenceState.Stale);
        await Promise.resolve();
      });
      expect(onViewChange).toHaveBeenCalledWith(KnowledgeFactListView.History);
      expect(onEvidenceStateChange).toHaveBeenCalledWith(
        KnowledgeFactEvidenceState.Stale,
      );

      await React.act(async () => {
        trigger?.click();
        await Promise.resolve();
      });
      expect(fakeDocument.listenerCount('keydown')).toBe(1);
      expect(fakeDocument.listenerCount('pointerdown')).toBe(1);

      await React.act(async () => {
        root.unmount();
        unmounted = true;
      });
      expect(fakeDocument.listenerCount('keydown')).toBe(0);
      expect(fakeDocument.listenerCount('pointerdown')).toBe(0);
    } finally {
      if (!unmounted) {
        root.unmount();
      }
      restore();
    }
  });

  test('closes on Escape and outside pointer interaction without changing filters', async () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    const { fakeDocument, restore } = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const outside = document.createElement('div');
    const fakeContainer = container as unknown as FakeDomNode;
    const fakeOutside = outside as unknown as FakeDomNode;
    const root = createRoot(container);
    const onReviewStatusesChange = vi.fn();
    let unmounted = false;

    try {
      await React.act(async () => {
        root.render(
          React.createElement(WorkspaceAiKnowledgeFilters, {
            ...defaultProps,
            onReviewStatusesChange,
          }),
        );
        await Promise.resolve();
      });
      const trigger = findByAttribute(
        container as unknown as FakeDomNode,
        'data-review-status-trigger',
      );

      await React.act(async () => {
        trigger?.click();
        await Promise.resolve();
      });
      await React.act(async () => {
        fakeDocument.dispatch('keydown', trigger ?? fakeContainer, 'Escape');
        await Promise.resolve();
      });
      expect(trigger?.getAttribute('aria-expanded')).toBe('false');
      expect(fakeDocument.activeElement).toBe(trigger);

      await React.act(async () => {
        trigger?.click();
        await Promise.resolve();
      });
      await React.act(async () => {
        fakeDocument.dispatch('pointerdown', fakeOutside);
        await Promise.resolve();
      });
      expect(trigger?.getAttribute('aria-expanded')).toBe('false');
      expect(onReviewStatusesChange).not.toHaveBeenCalled();
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
