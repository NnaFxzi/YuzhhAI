import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { EnterpriseLeadWorkspaceProfile } from '../../../shared/enterpriseLeadWorkspace/types';
import {
  KNOWLEDGE_FACT_EVIDENCE_PAGE_DEFAULT_LIMIT,
  KnowledgeBaseErrorCode,
  KnowledgeFactDomain,
  KnowledgeFactEvidenceState,
  KnowledgeFactListView,
  KnowledgeFactProjectionState,
  KnowledgeFactReviewDecision,
  KnowledgeFactReviewStatus,
  KnowledgeFactSourceKind,
} from '../../../shared/knowledgeBase/constants';
import type {
  KnowledgeFactListResult,
  KnowledgeFactMetrics,
  KnowledgeFactSummary,
} from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import { knowledgeBaseService } from '../../services/knowledgeBase';
import {
  useWorkspaceAiKnowledge,
  type UseWorkspaceAiKnowledgeInput,
  WorkspaceAiKnowledgeMutationFeedbackStatus,
  WorkspaceAiKnowledgeProjectionDialogKind,
} from './useWorkspaceAiKnowledge';
import {
  subscribeWorkspaceAiKnowledgeMetrics,
  useWorkspaceAiKnowledgeMetricsSubscription,
  WorkspaceAiKnowledgePanel,
  WorkspaceAiKnowledgePanelView,
  type WorkspaceAiKnowledgePanelViewProps,
} from './WorkspaceAiKnowledgePanel';
import type { WorkspaceAiKnowledgeRow } from './workspaceAiKnowledgeRows';
import { WorkspaceAiKnowledgeMutationKind } from './workspaceAiKnowledgeState';
import { WorkspaceKnowledgeFactEvidenceDrawer } from './WorkspaceKnowledgeFactEvidenceDrawer';

const metrics: KnowledgeFactMetrics = {
  activePendingCount: 1,
  activeConfirmedCount: 2,
  staleConfirmedCount: 3,
  rejectedHistoryCount: 4,
  archivedHistoryCount: 5,
  unduplicatedLegacyConfirmedCount: 6,
  totalAiKnowledgeCount: 7,
};

const fact = (overrides: Partial<KnowledgeFactSummary> = {}): KnowledgeFactSummary => ({
  id: 'fact-a',
  domain: KnowledgeFactDomain.ProductList,
  value: 'Normalized product',
  reviewStatus: KnowledgeFactReviewStatus.Pending,
  sourceKind: KnowledgeFactSourceKind.Extracted,
  revision: 1,
  projectionState: KnowledgeFactProjectionState.None,
  activeEvidenceCount: 2,
  staleEvidenceCount: 1,
  evidencePreview: null,
  createdAt: '2026-07-13T00:00:00.000Z',
  reviewedAt: null,
  updatedAt: '2026-07-13T00:00:00.000Z',
  archivedAt: null,
  ...overrides,
});

const rows: WorkspaceAiKnowledgeRow[] = [
  { kind: 'normalized_fact', fact: fact() },
  {
    kind: 'legacy_profile',
    item: {
      id: 'legacy-profile:productList:legacy product',
      domain: KnowledgeFactDomain.ProductList,
      value: 'Legacy product',
      knowledgeKey: 'productList:legacy product',
    },
  },
];

const defaultViewProps: WorkspaceAiKnowledgePanelViewProps = {
  rows,
  metrics,
  filters: {
    view: KnowledgeFactListView.Active,
    reviewStatuses: [],
    evidenceState: KnowledgeFactEvidenceState.Any,
  },
  nextCursor: null,
  isInitialLoading: false,
  isLoadingMore: false,
  errorCode: null,
  partialErrorCode: null,
  mutations: {},
  mutationFeedback: {},
  mutationAnnouncement: null,
  projectionDialog: null,
  evidence: {
    expandedFactId: null,
    factRevision: null,
    items: [],
    nextCursor: null,
    isLoading: false,
    requestGeneration: 0,
    activeRequest: null,
  },
  evidenceErrorCode: null,
  evidenceHasLoadedFirstPage: false,
  onViewChange: vi.fn(),
  onReviewStatusesChange: vi.fn(),
  onEvidenceStateChange: vi.fn(),
  onRetryInitial: vi.fn(),
  onRetryPartial: vi.fn(),
  onLoadMore: vi.fn(),
  onMaintainCompany: vi.fn(),
  onReviewFact: vi.fn(),
  onArchiveFact: vi.fn(),
  onToggleEvidence: vi.fn(),
  onLoadMoreEvidence: vi.fn(),
  onRetryEvidence: vi.fn(),
  onDismissProjectionConflict: vi.fn(),
  onResolveCompanyReplacement: vi.fn(),
  onResolveArchiveKeepCurrent: vi.fn(),
  onResolveArchiveRemoveCurrent: vi.fn(),
};

const renderView = (
  overrides: Partial<WorkspaceAiKnowledgePanelViewProps> = {},
): string =>
  renderToStaticMarkup(
    React.createElement(WorkspaceAiKnowledgePanelView, {
      ...defaultViewProps,
      ...overrides,
    }),
  );

const emptyProfile = (): EnterpriseLeadWorkspaceProfile => ({
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
});

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

type WorkspaceAiKnowledgeTestService = NonNullable<
  UseWorkspaceAiKnowledgeInput['service']
>;

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
    return (
      node !== null &&
      (node === this || this.childNodes.some(child => child.contains(node)))
    );
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

  get textContent(): string {
    return this.nodeValue ?? '';
  }

  set textContent(value: string) {
    this.nodeValue = value;
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
  scrollTop = 0;
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
    const path: FakeDomElement[] = [this];
    let current: FakeDomNode | null = this.parentNode;
    while (current) {
      if (current instanceof FakeDomElement) {
        path.push(current);
      }
      current = current.parentNode;
    }
    if (path.some(element => element.getAttribute('inert') !== null)) {
      return;
    }
    let propagationStopped = false;
    let immediatePropagationStopped = false;
    let defaultPrevented = false;
    const event = {
      type: 'click',
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
      for (const entry of element.eventListeners.get('click') ?? []) {
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

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getAttributeNS(_namespace: string | null, name: string): string | null {
    return this.getAttribute(name);
  }

  getAttributeNames(): string[] {
    return [...this.attributes.keys()];
  }

  private hasInertAncestor(): boolean {
    return (
      this.getAttribute('inert') !== null ||
      (this.parentNode instanceof FakeDomElement &&
        this.parentNode.hasInertAncestor())
    );
  }

  focus(): void {
    if (this.hasInertAncestor()) {
      return;
    }
    this.ownerDocument?.setActiveElement(this);
  }

  querySelectorAll(): FakeDomElement[] {
    const matches: FakeDomElement[] = [];
    for (const child of this.childNodes) {
      if (!(child instanceof FakeDomElement)) {
        continue;
      }
      if (
        ['button', 'a', 'input', 'select', 'textarea'].includes(
          child.tagName.toLowerCase(),
        ) &&
        child.getAttribute('disabled') === null
      ) {
        matches.push(child);
      }
      matches.push(...child.querySelectorAll());
    }
    return matches;
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

const findFakeDomElements = (
  root: FakeDomNode,
  predicate: (element: FakeDomElement) => boolean,
): FakeDomElement[] => {
  const matches: FakeDomElement[] = [];
  for (const child of root.childNodes) {
    if (!(child instanceof FakeDomElement)) {
      continue;
    }
    if (predicate(child)) {
      matches.push(child);
    }
    matches.push(...findFakeDomElements(child, predicate));
  }
  return matches;
};

class FakeDomDocument extends FakeDomNode {
  nodeType = 9;
  nodeName = '#document';
  documentElement: FakeDomElement;
  body: FakeDomElement;
  activeElement: FakeDomElement | null = null;
  defaultView: Window & typeof globalThis;
  private eventListeners = new Map<
    string,
    Array<EventListenerOrEventListenerObject>
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

  setActiveElement(element: FakeDomElement): void {
    this.activeElement = element;
  }

  dispatchKeyboardEvent(key: string, shiftKey = false): void {
    let defaultPrevented = false;
    const event = {
      type: 'keydown',
      key,
      shiftKey,
      target: this.activeElement,
      currentTarget: this,
      bubbles: true,
      cancelable: true,
      get defaultPrevented(): boolean {
        return defaultPrevented;
      },
      preventDefault(): void {
        defaultPrevented = true;
      },
      stopPropagation(): void {},
      stopImmediatePropagation(): void {},
    } as unknown as KeyboardEvent;
    for (const listener of this.eventListeners.get('keydown') ?? []) {
      if (typeof listener === 'function') {
        listener.call(this, event);
      } else {
        listener.handleEvent(event);
      }
    }
  }

  getElementById(): FakeDomElement | null {
    return null;
  }
}

const installFakeDom = (): (() => void) => {
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

  return () => {
    vi.unstubAllGlobals();
  };
};

describe('WorkspaceAiKnowledgePanelView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('renders normalized Task 7 actions while legacy rows remain maintain-only', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const html = renderView();

    expect(html).toContain('enterpriseAiKnowledgeTableCaption');
    expect(html).toContain('Normalized product');
    expect(html).toContain('Legacy product');
    expect(html).toContain('enterpriseAiKnowledgeStatusPending');
    expect(html).toContain('enterpriseAiKnowledgeLegacyReadOnly');
    expect(html).toContain('enterpriseAiKnowledgeMaintainCompany');
    expect(html).toContain('enterpriseAiKnowledgeEvidenceActive');
    expect(html).toContain('enterpriseAiKnowledgeEvidenceStale');
    expect(html).not.toContain('type="search"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('data-confirm-fact');
    expect(html).toContain('data-reject-fact');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-profile-edit');
    expect(html).not.toContain('data-batch-action');
    expect((html.match(/data-maintain-company/g) ?? [])).toHaveLength(1);
  });

  test('renders review-workbench summary and semantic status treatments', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const html = renderView({
      rows: [
        {
          kind: 'normalized_fact',
          fact: fact({ reviewStatus: KnowledgeFactReviewStatus.Pending }),
        },
        {
          kind: 'normalized_fact',
          fact: fact({
            id: 'confirmed-fact',
            reviewStatus: KnowledgeFactReviewStatus.Confirmed,
          }),
        },
        {
          kind: 'normalized_fact',
          fact: fact({
            id: 'rejected-fact',
            reviewStatus: KnowledgeFactReviewStatus.Rejected,
          }),
        },
        {
          kind: 'normalized_fact',
          fact: fact({
            id: 'archived-fact',
            reviewStatus: KnowledgeFactReviewStatus.Confirmed,
            archivedAt: '2026-07-13T01:00:00.000Z',
          }),
        },
      ],
    });

    expect(html).toContain('data-ai-knowledge-review-summary');
    expect(html).toContain('data-ai-knowledge-pending-count="1"');
    expect(html).toContain('sticky');
    expect(html).toContain('border-l-amber-400');
    expect(html).toContain('border-amber-200');
    expect(html).toContain('border-emerald-200');
    expect(html).toContain('border-red-200');
    expect(html).toContain('bg-slate-100');
  });

  test('renders normalized-only and legacy-only tables with textual status, source, and evidence meaning', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    const archived = fact({
      id: 'fact-archived',
      reviewStatus: KnowledgeFactReviewStatus.Confirmed,
      sourceKind: KnowledgeFactSourceKind.Imported,
      archivedAt: '2026-07-13T01:00:00.000Z',
      activeEvidenceCount: 0,
      staleEvidenceCount: 3,
    });
    const normalizedHtml = renderView({
      rows: [
        { kind: 'normalized_fact', fact: archived },
        {
          kind: 'normalized_fact',
          fact: fact({
            id: 'fact-confirmed',
            reviewStatus: KnowledgeFactReviewStatus.Confirmed,
          }),
        },
        {
          kind: 'normalized_fact',
          fact: fact({
            id: 'fact-rejected',
            reviewStatus: KnowledgeFactReviewStatus.Rejected,
          }),
        },
      ],
    });
    const legacyHtml = renderView({ rows: [rows[1]] });

    expect(normalizedHtml).toContain('enterpriseAiKnowledgeStatusArchived');
    expect(normalizedHtml).toContain('enterpriseAiKnowledgeStatusConfirmed');
    expect(normalizedHtml).toContain('enterpriseAiKnowledgeStatusRejected');
    expect(normalizedHtml).toContain('enterpriseAiKnowledgeSourceImported');
    expect(normalizedHtml).toContain('enterpriseAiKnowledgeEvidenceActive');
    expect(normalizedHtml).toContain('enterpriseAiKnowledgeEvidenceStale');
    expect(normalizedHtml).not.toContain('data-maintain-company');
    expect(normalizedHtml).toContain('data-archive-fact');
    expect(normalizedHtml).toContain('enterpriseAiKnowledgeEvidenceExpand');

    expect(legacyHtml).toContain('enterpriseAiKnowledgeLegacyReadOnly');
    expect(legacyHtml).toContain('enterpriseAiKnowledgeLegacySource');
    expect(legacyHtml).toContain('enterpriseAiKnowledgeLegacyNoEvidence');
    const legacyTableBody = legacyHtml.slice(legacyHtml.indexOf('<tbody'));
    expect((legacyTableBody.match(/<button/g) ?? [])).toHaveLength(2);
    expect(legacyTableBody).toContain('data-knowledge-content-toggle');
    expect(legacyTableBody).toContain('data-maintain-company');
  });

  test('renders a compact horizontally scrollable table without evidence previews', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const html = renderView({
      rows: [
        {
          kind: 'normalized_fact',
          fact: fact({
            value:
              'A deliberately long knowledge value that remains bounded to three visual lines.',
            evidencePreview: {
              id: 'private-preview-id',
              factId: 'fact-a',
              documentId: 'private-document-id',
              documentVersionId: 'private-version-id',
              documentDisplayName: 'Must not render.pdf',
              quote: 'Must not render this preview quote',
              confidence: 0.9,
              stale: false,
              createdAt: '2026-07-13T00:00:00.000Z',
            },
          }),
        },
        rows[1],
      ],
    });

    expect(html).toContain('data-ai-knowledge-table-scroll');
    expect(html).toContain('min-w-[1040px]');
    expect(html).toContain('data-evidence-trigger');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/aria-controls="[^"]*evidence-drawer"/);
    expect((html.match(/line-clamp-3/g) ?? [])).toHaveLength(2);
    expect((html.match(/data-knowledge-content-toggle/g) ?? [])).toHaveLength(2);
    expect(html).toContain('enterpriseAiKnowledgeContentExpand');
    expect(html).toContain('data-knowledge-status-pill');
    expect(html).not.toContain('enterpriseAiKnowledgeEvidencePreview');
    expect(html).not.toContain('Must not render.pdf');
    expect(html).not.toContain('Must not render this preview quote');
  });

  test('renders a named polite initial loading state and an accessible fatal retry', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const loadingHtml = renderView({
      rows: [],
      isInitialLoading: true,
    });
    expect(loadingHtml).toContain('role="status"');
    expect(loadingHtml).toContain('aria-live="polite"');
    expect(loadingHtml).toContain('aria-label="enterpriseAiKnowledgeLoadingStatus"');
    expect(loadingHtml).toContain('enterpriseAiKnowledgeLoading');
    expect(loadingHtml).not.toContain('<table');

    const fatalHtml = renderView({
      rows: [],
      errorCode: KnowledgeBaseErrorCode.BackendNotReady,
    });
    expect(fatalHtml).toContain('role="alert"');
    expect(fatalHtml).toContain('enterpriseAiKnowledgeLoadFailed');
    expect(fatalHtml).toContain('data-retry-initial');
    expect(fatalHtml).toContain('aria-label="enterpriseAiKnowledgeRetryInitial"');
    expect(fatalHtml).not.toContain(KnowledgeBaseErrorCode.BackendNotReady);
  });

  test('distinguishes Active and History empty states without rendering a search field', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const activeHtml = renderView({ rows: [] });
    const historyHtml = renderView({
      rows: [],
      filters: {
        ...defaultViewProps.filters,
        view: KnowledgeFactListView.History,
      },
    });

    expect(activeHtml).toContain('enterpriseAiKnowledgeEmptyActive');
    expect(activeHtml).not.toContain('enterpriseAiKnowledgeEmptyHistory');
    expect(historyHtml).toContain('enterpriseAiKnowledgeEmptyHistory');
    expect(historyHtml).not.toContain('enterpriseAiKnowledgeEmptyActive');
    expect(activeHtml).not.toContain('type="search"');
    expect(historyHtml).not.toContain('type="search"');
  });

  test('preserves the table on a partial error and renders one named retry', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const html = renderView({
      partialErrorCode: KnowledgeBaseErrorCode.PersistenceFailed,
    });

    expect(html).toContain('<table');
    expect(html).toContain('enterpriseAiKnowledgePartialLoadFailed');
    expect(html).toContain('data-retry-partial');
    expect(html).toContain('aria-label="enterpriseAiKnowledgeRetryPartial"');
    expect((html.match(/data-retry-partial/g) ?? [])).toHaveLength(1);
    expect(html).not.toContain(KnowledgeBaseErrorCode.PersistenceFailed);
  });

  test('renders a named load-more control only for a backend cursor and disables it while active', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const readyHtml = renderView({ nextCursor: 'cursor-2' });
    const loadingHtml = renderView({ nextCursor: 'cursor-2', isLoadingMore: true });
    const replacingHtml = renderView({ nextCursor: 'cursor-2', isInitialLoading: true });
    const endedHtml = renderView({ nextCursor: null });

    expect(readyHtml).toContain('data-load-more');
    expect(readyHtml).toContain('aria-label="enterpriseAiKnowledgeLoadMore"');
    expect(readyHtml).not.toContain('disabled=""');
    expect(loadingHtml).toContain('data-load-more');
    expect(loadingHtml).toContain('disabled=""');
    expect(loadingHtml).toContain('enterpriseAiKnowledgeLoadingMore');
    expect(replacingHtml).toContain('data-load-more');
    expect(replacingHtml).toContain('disabled=""');
    expect(endedHtml).not.toContain('data-load-more');
    expect(endedHtml).toContain('enterpriseAiKnowledgeEndOfList');
  });

  test('uses labelled backend filters and never exposes an Archived pseudo-filter', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const html = renderView();

    expect(html).toContain('data-ai-knowledge-filters');
    expect(html).toContain('data-review-status-trigger');
    expect(html).not.toContain('<select multiple');
    expect(html).toContain('enterpriseAiKnowledgeReviewFilterAll');
    expect(html).toContain('aria-label="enterpriseAiKnowledgeViewLabel"');
    expect(html).toContain('aria-labelledby="enterprise-ai-knowledge-review-label-');
    expect(html).toContain('aria-label="enterpriseAiKnowledgeEvidenceFilterLabel"');
    expect(html).toContain(`value="${KnowledgeFactListView.Active}"`);
    expect(html).toContain(`value="${KnowledgeFactListView.History}"`);
    expect(html).toContain(`value="${KnowledgeFactEvidenceState.Any}"`);
    expect(html).toContain(`value="${KnowledgeFactEvidenceState.Active}"`);
    expect(html).toContain(`value="${KnowledgeFactEvidenceState.Stale}"`);
    expect(html).not.toContain('value="archived"');
  });

  test('enforces normalized row action legality with visible disabled and mutation feedback', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    const pendingReady = fact({ id: 'pending-ready', activeEvidenceCount: 1 });
    const pendingWithoutActiveEvidence = fact({
      id: 'pending-no-active',
      activeEvidenceCount: 0,
      staleEvidenceCount: 1,
    });
    const confirmed = fact({
      id: 'confirmed',
      reviewStatus: KnowledgeFactReviewStatus.Confirmed,
    });
    const rejected = fact({
      id: 'rejected',
      reviewStatus: KnowledgeFactReviewStatus.Rejected,
    });
    const archived = fact({
      id: 'archived',
      reviewStatus: KnowledgeFactReviewStatus.Confirmed,
      archivedAt: '2026-07-13T01:00:00.000Z',
    });
    const html = renderView({
      rows: [
        { kind: 'normalized_fact', fact: pendingReady },
        { kind: 'normalized_fact', fact: pendingWithoutActiveEvidence },
        { kind: 'normalized_fact', fact: confirmed },
        { kind: 'normalized_fact', fact: rejected },
        { kind: 'normalized_fact', fact: archived },
        rows[1],
      ],
      mutations: {
        'pending-ready': {
          workspaceGeneration: 1,
          requestGeneration: 2,
          kind: WorkspaceAiKnowledgeMutationKind.Review,
        },
      },
      mutationFeedback: {
        'pending-ready': {
          status: WorkspaceAiKnowledgeMutationFeedbackStatus.Submitting,
          errorCode: null,
        },
      },
    });

    expect((html.match(/data-confirm-fact/g) ?? [])).toHaveLength(2);
    expect((html.match(/data-reject-fact/g) ?? [])).toHaveLength(2);
    expect((html.match(/data-archive-fact/g) ?? [])).toHaveLength(1);
    expect(html).toContain('enterpriseAiKnowledgeConfirmRequiresActiveEvidence');
    expect(html).toContain('enterpriseAiKnowledgeMutationSubmitting');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('data-confirm-fact="rejected"');
    expect((html.match(/data-maintain-company/g) ?? [])).toHaveLength(1);
    const legacyStart = html.indexOf('data-legacy-profile-id');
    expect(html.slice(legacyStart)).not.toContain('data-confirm-fact');
    expect(html.slice(legacyStart)).not.toContain('data-archive-fact');
  });

  test('composes one expanded evidence drawer outside the table', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    const expandedFact = fact({ id: 'expanded-fact', revision: 4 });
    const collapsedFact = fact({ id: 'collapsed-fact', revision: 2 });
    const html = renderView({
      rows: [
        { kind: 'normalized_fact', fact: expandedFact },
        { kind: 'normalized_fact', fact: collapsedFact },
      ],
      evidence: {
        expandedFactId: 'expanded-fact',
        factRevision: 4,
        items: [
          {
            id: 'private-evidence-id',
            factId: 'expanded-fact',
            documentId: 'private-document-id',
            documentVersionId: 'private-version-id',
            documentDisplayName: 'Safe evidence.pdf',
            quote: 'Safe bounded quote',
            confidence: 0.8,
            stale: false,
            createdAt: '2026-07-13T00:00:00.000Z',
          },
        ],
        nextCursor: null,
        isLoading: false,
        requestGeneration: 2,
        activeRequest: null,
      },
      evidenceHasLoadedFirstPage: true,
    });

    const drawerControlIds = [
      ...html.matchAll(/aria-controls="([^"]*evidence-drawer)"/g),
    ].map(match => match[1]);
    expect((html.match(/data-evidence-trigger/g) ?? [])).toHaveLength(2);
    expect(drawerControlIds).toHaveLength(2);
    expect(new Set(drawerControlIds).size).toBe(1);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-expanded="false"');
    expect((html.match(/Safe evidence\.pdf/g) ?? [])).toHaveLength(1);
    expect(html).toContain('Safe bounded quote');
    expect(html).toContain('data-evidence-drawer');
    expect(html).toContain('data-evidence-drawer-backdrop');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('data-ai-knowledge-panel-viewport');
    expect(html).toContain('data-ai-knowledge-panel-scroll');
    const backgroundTag = html.match(
      /<div[^>]*data-ai-knowledge-panel-background[^>]*>/,
    )?.[0];
    expect(backgroundTag).toContain('inert=""');
    expect(backgroundTag).toContain('aria-hidden="true"');
    expect(backgroundTag).toContain('pointer-events-none');
    expect(html).toContain(`id="${drawerControlIds[0]}" data-evidence-drawer`);
    expect(html.indexOf('data-evidence-drawer')).toBeGreaterThan(
      html.indexOf('</table>'),
    );
    expect(html).toContain('enterpriseAiKnowledgePanelFocusAnchor');
    expect(html).not.toContain('private-evidence-id');
    expect(html).not.toContain('private-document-id');
    expect(html).not.toContain('private-version-id');
  });

  test('generates a unique associated evidence drawer ID for every panel instance', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    const firstFact = fact({ id: 'first-panel-fact', revision: 2 });
    const secondFact = fact({ id: 'second-panel-fact', revision: 3 });
    const panelProps = (
      currentFact: KnowledgeFactSummary,
    ): WorkspaceAiKnowledgePanelViewProps => ({
      ...defaultViewProps,
      rows: [{ kind: 'normalized_fact', fact: currentFact }],
      evidence: {
        expandedFactId: currentFact.id,
        factRevision: currentFact.revision,
        items: [],
        nextCursor: null,
        isLoading: false,
        requestGeneration: 1,
        activeRequest: null,
      },
      evidenceHasLoadedFirstPage: true,
    });
    const html = renderToStaticMarkup(
      React.createElement(
        'div',
        null,
        React.createElement(WorkspaceAiKnowledgePanelView, {
          ...panelProps(firstFact),
          key: 'first',
        }),
        React.createElement(WorkspaceAiKnowledgePanelView, {
          ...panelProps(secondFact),
          key: 'second',
        }),
      ),
    );

    const controls = [
      ...html.matchAll(/aria-controls="([^"]*evidence-drawer)"/g),
    ].map(match => match[1]);
    const drawerIds = [
      ...html.matchAll(/id="([^"]*evidence-drawer)" data-evidence-drawer/g),
    ].map(match => match[1]);

    expect(controls).toHaveLength(2);
    expect(drawerIds).toHaveLength(2);
    expect(new Set(controls).size).toBe(2);
    expect(new Set(drawerIds).size).toBe(2);
    expect([...controls].sort()).toEqual([...drawerIds].sort());
  });

  test('renders fixed mutation errors without exposing codes or diagnostics', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    const html = renderView({
      mutationFeedback: {
        'fact-a': {
          status: WorkspaceAiKnowledgeMutationFeedbackStatus.Failed,
          errorCode: KnowledgeBaseErrorCode.FactRevisionConflict,
        },
      },
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain('enterpriseAiKnowledgeMutationStale');
    expect(html).not.toContain(KnowledgeBaseErrorCode.FactRevisionConflict);
  });

  test('renders a stable named polite success announcement outside an empty table', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const html = renderView({
      rows: [],
      mutationAnnouncement: {
        status: WorkspaceAiKnowledgeMutationFeedbackStatus.Succeeded,
        generation: 1,
      },
    });

    expect(html).not.toContain('<table');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(
      'aria-label="enterpriseAiKnowledgeMutationLiveStatus"',
    );
    expect(html).toContain('enterpriseAiKnowledgeMutationSucceeded');
  });

  test('forwards each accepted metrics identity to the latest callback without replay', () => {
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const callbackRef: { current?: (value: KnowledgeFactMetrics) => void } = {
      current: firstCallback,
    };
    let acceptedListener: ((value: KnowledgeFactMetrics) => void) | null = null;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((listener: (value: KnowledgeFactMetrics) => void) => {
      acceptedListener = listener;
      return unsubscribe;
    });
    const firstMetrics = { ...metrics, totalAiKnowledgeCount: 10 };
    const secondMetrics = { ...metrics, totalAiKnowledgeCount: 20 };

    const release = subscribeWorkspaceAiKnowledgeMetrics(subscribe, callbackRef);
    expect(firstCallback).not.toHaveBeenCalled();
    const emitAcceptedMetrics = acceptedListener as unknown as (
      value: KnowledgeFactMetrics,
    ) => void;
    emitAcceptedMetrics(firstMetrics);
    callbackRef.current = secondCallback;
    emitAcceptedMetrics(secondMetrics);

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(firstCallback.mock.calls[0][0]).toBe(firstMetrics);
    expect(secondCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback.mock.calls[0][0]).toBe(secondMetrics);
    expect(WorkspaceAiKnowledgePanel).toBeTypeOf('function');
    release();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('WorkspaceAiKnowledgePanel production lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('keeps one committed metrics subscription when only the callback changes', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    let unmounted = false;
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const unsubscribe = vi.fn();
    let acceptedListener: ((value: KnowledgeFactMetrics) => void) | null = null;
    const subscribe = vi.fn((listener: (value: KnowledgeFactMetrics) => void) => {
      acceptedListener = listener;
      return unsubscribe;
    });
    const Harness = ({
      callback,
    }: {
      callback?: (value: KnowledgeFactMetrics) => void;
    }): null => {
      useWorkspaceAiKnowledgeMetricsSubscription(subscribe, callback);
      return null;
    };

    try {
      await React.act(async () => {
        root.render(React.createElement(Harness, { callback: firstCallback }));
        await Promise.resolve();
      });
      const committedListener = acceptedListener as unknown as (
        value: KnowledgeFactMetrics
      ) => void;
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(unsubscribe).not.toHaveBeenCalled();

      await React.act(async () => {
        root.render(React.createElement(Harness, { callback: secondCallback }));
        await Promise.resolve();
      });

      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(acceptedListener).toBe(committedListener);
      expect(unsubscribe).not.toHaveBeenCalled();
      expect(committedListener).toBeTypeOf('function');
      committedListener(metrics);
      expect(firstCallback).not.toHaveBeenCalled();
      expect(secondCallback).toHaveBeenCalledTimes(1);
      expect(secondCallback.mock.calls[0][0]).toBe(metrics);
      await React.act(async () => {
        root.unmount();
      });
      unmounted = true;
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    } finally {
      if (!unmounted) {
        await React.act(async () => {
          root.unmount();
        });
      }
      restoreDom();
    }
  });

  test('keeps Reject success announced through the production hook after the row is removed', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const pendingFact = fact({ id: 'fact-reject' });
    const stableProfile = emptyProfile();
    let listInvocation = 0;
    const service: WorkspaceAiKnowledgeTestService = {
      listFacts: vi.fn(async () => ({
        items: listInvocation++ === 0 ? [pendingFact] : [],
        nextCursor: null,
        metrics,
      })),
      listDocuments: vi.fn(async () => []),
      reviewFact: vi.fn(async () => ({
        fact: {
          ...pendingFact,
          reviewStatus: KnowledgeFactReviewStatus.Rejected,
          revision: 2,
        },
        profileChanged: false,
        profileRevision: null,
        fieldRevision: null,
      })),
    };
    const captures: Array<{
      factIds: string[];
      announcementStatus: string | null;
    }> = [];
    let actionStarted = false;
    const Harness = (): null => {
      const state = useWorkspaceAiKnowledge({
        workspaceId: 'workspace-a',
        profileRevision: 1,
        profile: stableProfile,
        service,
      });
      React.useLayoutEffect(() => {
        captures.push({
          factIds: state.facts.map(item => item.id),
          announcementStatus: state.mutationAnnouncement?.status ?? null,
        });
        if (!actionStarted && state.facts[0]) {
          actionStarted = true;
          void state.reviewFact(
            state.facts[0],
            KnowledgeFactReviewDecision.Reject,
          );
        }
      });
      return null;
    };

    try {
      await React.act(async () => {
        root.render(React.createElement(Harness));
        for (let index = 0; index < 16; index += 1) {
          await Promise.resolve();
        }
      });

      expect(service.reviewFact).toHaveBeenCalledTimes(1);
      expect(captures).toContainEqual({
        factIds: [],
        announcementStatus: WorkspaceAiKnowledgeMutationFeedbackStatus.Succeeded,
      });
    } finally {
      await React.act(async () => {
        root.unmount();
      });
      restoreDom();
    }
  });

  test('focuses the evidence drawer close button, closes on Escape, and returns focus to its connected trigger', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const trigger = document.createElement('button');
    const root = createRoot(container);
    const onClose = vi.fn();
    const drawerFact = fact({ id: 'focus-fact', revision: 3 });
    const drawerEvidence = {
      expandedFactId: drawerFact.id,
      factRevision: drawerFact.revision,
      items: [],
      nextCursor: 'next-evidence-page',
      isLoading: false,
      requestGeneration: 1,
      activeRequest: null,
    };
    let unmounted = false;

    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const Harness = (): React.ReactElement => {
      const [isOpen, setIsOpen] = React.useState(true);
      return React.createElement(WorkspaceKnowledgeFactEvidenceDrawer, {
        drawerId: 'focus-test-drawer',
        fact: isOpen ? drawerFact : null,
        evidence: drawerEvidence,
        hasLoadedFirstPage: true,
        errorCode: null,
        returnFocusElement: trigger,
        onClose: () => {
          onClose();
          setIsOpen(false);
        },
        onLoadMore: vi.fn(),
        onRetry: vi.fn(),
      });
    };

    try {
      document.body.appendChild(trigger);
      document.body.appendChild(container);
      await React.act(async () => {
        root.render(React.createElement(Harness));
        await Promise.resolve();
      });
      const closeButton = findFakeDomElement(
        container as unknown as FakeDomNode,
        element =>
          element.tagName.toLowerCase() === 'button' &&
          element.getAttribute('aria-label') ===
            'enterpriseAiKnowledgeEvidenceDrawerClose',
      );
      expect(closeButton).not.toBeNull();
      expect(document.activeElement).toBe(closeButton);
      const loadMoreButton = findFakeDomElement(
        container as unknown as FakeDomNode,
        element => element.getAttribute('data-evidence-load-more') !== null,
      );
      expect(loadMoreButton).not.toBeNull();

      await React.act(async () => {
        (document as unknown as FakeDomDocument).dispatchKeyboardEvent(
          'Tab',
          true,
        );
        await Promise.resolve();
      });
      expect(document.activeElement === loadMoreButton).toBe(true);

      loadMoreButton?.focus();
      await React.act(async () => {
        (document as unknown as FakeDomDocument).dispatchKeyboardEvent('Tab');
        await Promise.resolve();
      });
      expect(document.activeElement === closeButton).toBe(true);

      await React.act(async () => {
        (document as unknown as FakeDomDocument).dispatchKeyboardEvent('Escape');
        await Promise.resolve();
      });

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(trigger);
      expect(
        findFakeDomElement(
          container as unknown as FakeDomNode,
          element => element.getAttribute('data-evidence-drawer') !== null,
        ),
      ).toBeNull();

      await React.act(async () => {
        root.unmount();
      });
      unmounted = true;
    } finally {
      if (!unmounted) {
        await React.act(async () => {
          root.unmount();
        });
      }
      restoreDom();
    }
  });

  test('gives a delayed projection conflict sole modal priority and collapses the evidence controller once', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const expandedFact = fact({ id: 'priority-fact', revision: 4 });
    const onToggleEvidence = vi.fn();
    const onReviewFact = vi.fn();
    const onDismissProjectionConflict = vi.fn();
    const focusAnchorRef = React.createRef<HTMLDivElement>();
    let showProjectionConflict!: () => void;
    let unmounted = false;

    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const Harness = (): React.ReactElement => {
      const [evidence, setEvidence] = React.useState({
        ...defaultViewProps.evidence,
      });
      const [projectionDialog, setProjectionDialog] =
        React.useState<WorkspaceAiKnowledgePanelViewProps['projectionDialog']>(
          null,
        );
      showProjectionConflict = () => {
        setProjectionDialog({
          kind: WorkspaceAiKnowledgeProjectionDialogKind.CompanyReplacement,
          dialogGeneration: 6,
          workspaceGeneration: 1,
          factId: expandedFact.id,
          factRevision: expandedFact.revision,
          domain: KnowledgeFactDomain.CompanySummary,
          currentFieldValue: 'Safe current summary',
          fieldRevision: 9,
          isSubmitting: false,
          errorCode: null,
        });
      };
      return React.createElement(WorkspaceAiKnowledgePanelView, {
        ...defaultViewProps,
        rows: [{ kind: 'normalized_fact', fact: expandedFact }],
        evidence,
        evidenceHasLoadedFirstPage: true,
        projectionDialog,
        focusAnchorRef,
        onReviewFact,
        onToggleEvidence: currentFact => {
          onToggleEvidence(currentFact);
          setEvidence(current =>
            current.expandedFactId === currentFact.id
              ? {
                  ...current,
                  expandedFactId: null,
                  factRevision: null,
                  items: [],
                }
              : {
                  ...current,
                  expandedFactId: currentFact.id,
                  factRevision: currentFact.revision,
                },
          );
        },
        onDismissProjectionConflict: () => {
          onDismissProjectionConflict();
          setProjectionDialog(null);
        },
      });
    };

    try {
      document.body.appendChild(container);
      await React.act(async () => {
        root.render(React.createElement(Harness));
        await Promise.resolve();
      });
      const evidenceTrigger = findFakeDomElement(
        container as unknown as FakeDomNode,
        element => element.getAttribute('data-evidence-trigger') !== null,
      );
      expect(evidenceTrigger).not.toBeNull();
      await React.act(async () => {
        evidenceTrigger?.click();
        await Promise.resolve();
      });
      expect(
        findFakeDomElement(
          container as unknown as FakeDomNode,
          element => element.getAttribute('data-evidence-drawer') !== null,
        ),
      ).not.toBeNull();
      onToggleEvidence.mockClear();
      const returnFocusSpy = vi.spyOn(evidenceTrigger!, 'focus');
      const focusAnchor = focusAnchorRef.current;
      expect(focusAnchor).not.toBeNull();
      const focusAnchorSpy = vi.spyOn(focusAnchor!, 'focus');

      await React.act(async () => {
        showProjectionConflict();
        await Promise.resolve();
      });

      const projectionDialog = findFakeDomElement(
        container as unknown as FakeDomNode,
        element => element.getAttribute('role') === 'dialog',
      );
      const cancelButton = findFakeDomElement(
        container as unknown as FakeDomNode,
        element => element.getAttribute('data-fact-dialog-cancel') !== null,
      );
      const background = findFakeDomElement(
        container as unknown as FakeDomNode,
        element =>
          element.getAttribute('data-ai-knowledge-panel-background') !== null,
      );
      expect(projectionDialog).not.toBeNull();
      expect(cancelButton).not.toBeNull();
      expect(document.activeElement).toBe(cancelButton);
      expect(
        findFakeDomElement(
          container as unknown as FakeDomNode,
          element => element.getAttribute('data-evidence-drawer') !== null,
        ),
      ).toBeNull();
      expect(
        findFakeDomElement(
          container as unknown as FakeDomNode,
          element =>
            element.getAttribute('data-evidence-drawer-backdrop') !== null,
        ),
      ).toBeNull();
      expect(background?.getAttribute('inert')).toBe('');
      expect(background?.contains(projectionDialog)).toBe(false);
      expect(
        background?.contains(focusAnchor as unknown as FakeDomNode),
      ).toBe(false);
      expect(focusAnchorSpy).toHaveBeenCalledTimes(1);
      const confirmButton = findFakeDomElement(
        container as unknown as FakeDomNode,
        element => element.getAttribute('data-confirm-fact') !== null,
      );
      confirmButton?.click();
      expect(onReviewFact).not.toHaveBeenCalled();
      expect(onToggleEvidence).toHaveBeenCalledTimes(1);
      expect(onToggleEvidence).toHaveBeenCalledWith(expandedFact);
      expect(returnFocusSpy).not.toHaveBeenCalled();

      await React.act(async () => {
        cancelButton?.click();
        await Promise.resolve();
      });
      expect(onDismissProjectionConflict).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(focusAnchor);
      expect(
        findFakeDomElement(
          container as unknown as FakeDomNode,
          element => element.getAttribute('data-evidence-drawer') !== null,
        ),
      ).toBeNull();
      expect(onToggleEvidence).toHaveBeenCalledTimes(1);

      await React.act(async () => {
        root.unmount();
      });
      unmounted = true;
    } finally {
      if (!unmounted) {
        await React.act(async () => {
          root.unmount();
        });
      }
      restoreDom();
    }
  });

  test('preserves the original dialog opener when projection opens without taking over a drawer', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const focusAnchorRef = React.createRef<HTMLDivElement>();
    let showProjectionConflict!: () => void;
    let unmounted = false;

    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const Harness = (): React.ReactElement => {
      const [projectionDialog, setProjectionDialog] =
        React.useState<WorkspaceAiKnowledgePanelViewProps['projectionDialog']>(
          null,
        );
      showProjectionConflict = () => {
        setProjectionDialog({
          kind: WorkspaceAiKnowledgeProjectionDialogKind.CompanyReplacement,
          dialogGeneration: 7,
          workspaceGeneration: 1,
          factId: 'dialog-only-fact',
          factRevision: 2,
          domain: KnowledgeFactDomain.CompanySummary,
          currentFieldValue: 'Current summary',
          fieldRevision: 3,
          isSubmitting: false,
          errorCode: null,
        });
      };
      return React.createElement(WorkspaceAiKnowledgePanelView, {
        ...defaultViewProps,
        projectionDialog,
        focusAnchorRef,
        onDismissProjectionConflict: () => setProjectionDialog(null),
      });
    };

    try {
      document.body.appendChild(container);
      await React.act(async () => {
        root.render(React.createElement(Harness));
        await Promise.resolve();
      });
      const focusAnchor = focusAnchorRef.current;
      expect(focusAnchor).not.toBeNull();
      const focusAnchorSpy = vi.spyOn(focusAnchor!, 'focus');
      const opener = findFakeDomElement(
        container as unknown as FakeDomNode,
        element => element.getAttribute('data-confirm-fact') !== null,
      );
      expect(opener).not.toBeNull();
      if (!opener) {
        throw new Error('Projection opener was not rendered');
      }
      opener.focus();

      await React.act(async () => {
        showProjectionConflict();
        await Promise.resolve();
      });
      const cancelButton = findFakeDomElement(
        container as unknown as FakeDomNode,
        element => element.getAttribute('data-fact-dialog-cancel') !== null,
      );
      expect(document.activeElement).toBe(cancelButton);
      expect(focusAnchorSpy).not.toHaveBeenCalled();

      await React.act(async () => {
        cancelButton?.click();
        await Promise.resolve();
      });
      expect(document.activeElement).toBe(opener);
      expect(focusAnchorSpy).not.toHaveBeenCalled();

      await React.act(async () => {
        root.unmount();
      });
      unmounted = true;
    } finally {
      if (!unmounted) {
        await React.act(async () => {
          root.unmount();
        });
      }
      restoreDom();
    }
  });

  test('keeps committed evidence callbacks and opener focus isolated from an aborted render', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const openerA = document.createElement('button');
    const openerB = document.createElement('button');
    const root = createRoot(container);
    const blocker = deferred<void>();
    const onCloseA = vi.fn();
    const onCloseB = vi.fn();
    const factA = fact({ id: 'committed-fact', revision: 1 });
    const factB = fact({ id: 'aborted-fact', revision: 2 });
    let shouldSuspend = false;
    let unmounted = false;

    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const SuspendAfterDrawer = (): null => {
      if (shouldSuspend) {
        throw blocker.promise;
      }
      return null;
    };
    const renderTree = (
      currentFact: KnowledgeFactSummary,
      returnFocusElement: HTMLElement,
      onClose: () => void,
    ): React.ReactElement =>
      React.createElement(
        React.Suspense,
        { fallback: null },
        React.createElement(WorkspaceKnowledgeFactEvidenceDrawer, {
          drawerId: 'aborted-render-drawer',
          fact: currentFact,
          evidence: {
            ...defaultViewProps.evidence,
            expandedFactId: currentFact.id,
            factRevision: currentFact.revision,
          },
          hasLoadedFirstPage: true,
          errorCode: null,
          returnFocusElement,
          onClose,
          onLoadMore: vi.fn(),
          onRetry: vi.fn(),
        }),
        React.createElement(SuspendAfterDrawer),
      );

    try {
      document.body.appendChild(openerA);
      document.body.appendChild(openerB);
      document.body.appendChild(container);
      await React.act(async () => {
        root.render(renderTree(factA, openerA, onCloseA));
        await Promise.resolve();
      });
      const openerAFocusSpy = vi.spyOn(openerA, 'focus');
      const openerBFocusSpy = vi.spyOn(openerB, 'focus');

      shouldSuspend = true;
      await React.act(async () => {
        React.startTransition(() => {
          root.render(renderTree(factB, openerB, onCloseB));
        });
        await Promise.resolve();
      });

      await React.act(async () => {
        (document as unknown as FakeDomDocument).dispatchKeyboardEvent('Escape');
        await Promise.resolve();
      });
      expect(onCloseA).toHaveBeenCalledTimes(1);
      expect(onCloseB).not.toHaveBeenCalled();

      await React.act(async () => {
        root.unmount();
      });
      unmounted = true;
      expect(openerAFocusSpy).toHaveBeenCalledTimes(1);
      expect(openerBFocusSpy).not.toHaveBeenCalled();
    } finally {
      if (!unmounted) {
        await React.act(async () => {
          root.unmount();
        });
      }
      restoreDom();
    }
  });

  test('toggles normalized and legacy knowledge content with associated keyboard buttons', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    let unmounted = false;

    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    try {
      document.body.appendChild(container);
      await React.act(async () => {
        root.render(
          React.createElement(WorkspaceAiKnowledgePanelView, {
            ...defaultViewProps,
            rows: [
              {
                kind: 'normalized_fact',
                fact: fact({ value: 'Long normalized knowledge content' }),
              },
              rows[1],
            ],
          }),
        );
        await Promise.resolve();
      });

      const toggles = findFakeDomElements(
        container as unknown as FakeDomNode,
        element =>
          element.getAttribute('data-knowledge-content-toggle') !== null,
      );
      expect(toggles).toHaveLength(2);
      for (const toggle of toggles) {
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.textContent).toContain(
          'enterpriseAiKnowledgeContentExpand',
        );
        const contentId = toggle.getAttribute('aria-controls');
        const content = findFakeDomElement(
          container as unknown as FakeDomNode,
          element => element.getAttribute('id') === contentId,
        );
        expect(content?.getAttribute('class')).toContain('line-clamp-3');
      }

      await React.act(async () => {
        toggles[0].click();
        toggles[1].click();
        await Promise.resolve();
      });
      for (const toggle of toggles) {
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(toggle.textContent).toContain(
          'enterpriseAiKnowledgeContentCollapse',
        );
        const contentId = toggle.getAttribute('aria-controls');
        const content = findFakeDomElement(
          container as unknown as FakeDomNode,
          element => element.getAttribute('id') === contentId,
        );
        expect(content?.getAttribute('class')).not.toContain('line-clamp-3');
      }

      await React.act(async () => {
        root.render(
          React.createElement(WorkspaceAiKnowledgePanelView, {
            ...defaultViewProps,
            rows: [
              {
                kind: 'normalized_fact',
                fact: fact({
                  revision: 2,
                  value: 'Revised normalized knowledge content',
                }),
              },
              rows[1],
            ],
          }),
        );
        await Promise.resolve();
      });
      const revisedToggles = findFakeDomElements(
        container as unknown as FakeDomNode,
        element =>
          element.getAttribute('data-knowledge-content-toggle') !== null,
      );
      expect(revisedToggles[0].getAttribute('aria-expanded')).toBe('false');
      expect(revisedToggles[0].textContent).toContain(
        'enterpriseAiKnowledgeContentExpand',
      );
      expect(revisedToggles[1].getAttribute('aria-expanded')).toBe('true');

      await React.act(async () => {
        root.unmount();
      });
      unmounted = true;
    } finally {
      if (!unmounted) {
        await React.act(async () => {
          root.unmount();
        });
      }
      restoreDom();
    }
  });

  test('preserves row action callback arguments outside the modal drawer', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const pendingFact = fact({ id: 'callback-pending' });
    const confirmedFact = fact({
      id: 'callback-confirmed',
      reviewStatus: KnowledgeFactReviewStatus.Confirmed,
    });
    const onReviewFact = vi.fn();
    const onArchiveFact = vi.fn();
    const onMaintainCompany = vi.fn();
    let unmounted = false;

    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    try {
      document.body.appendChild(container);
      await React.act(async () => {
        root.render(
          React.createElement(WorkspaceAiKnowledgePanelView, {
            ...defaultViewProps,
            rows: [
              { kind: 'normalized_fact', fact: pendingFact },
              { kind: 'normalized_fact', fact: confirmedFact },
              rows[1],
            ],
            onReviewFact,
            onArchiveFact,
            onMaintainCompany,
          }),
        );
        await Promise.resolve();
      });
      const clickAction = async (attribute: string): Promise<void> => {
        const button = findFakeDomElement(
          container as unknown as FakeDomNode,
          element => element.getAttribute(attribute) !== null,
        );
        expect(button).not.toBeNull();
        await React.act(async () => {
          button?.click();
          await Promise.resolve();
        });
      };

      await clickAction('data-confirm-fact');
      await clickAction('data-reject-fact');
      await clickAction('data-archive-fact');
      await clickAction('data-maintain-company');

      expect(onReviewFact.mock.calls).toEqual([
        [pendingFact, KnowledgeFactReviewDecision.Confirm],
        [pendingFact, KnowledgeFactReviewDecision.Reject],
      ]);
      expect(onArchiveFact).toHaveBeenCalledWith(confirmedFact);
      expect(onMaintainCompany).toHaveBeenCalledTimes(1);

      await React.act(async () => {
        root.unmount();
      });
      unmounted = true;
    } finally {
      if (!unmounted) {
        await React.act(async () => {
          root.unmount();
        });
      }
      restoreDom();
    }
  });

  test('keeps drawer focus lifecycle open while switching fact and opener identities', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const triggerA = document.createElement('button');
    const triggerB = document.createElement('button');
    const root = createRoot(container);
    const factA = fact({ id: 'focus-fact-a', revision: 2 });
    const factB = fact({ id: 'focus-fact-b', revision: 3 });
    const triggerAFocus = vi.spyOn(triggerA, 'focus');
    const triggerBFocus = vi.spyOn(triggerB, 'focus');
    let unmounted = false;

    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const renderDrawer = (
      currentFact: KnowledgeFactSummary | null,
      returnFocusElement: HTMLElement | null,
    ): React.ReactElement =>
      React.createElement(WorkspaceKnowledgeFactEvidenceDrawer, {
        drawerId: 'switch-focus-drawer',
        fact: currentFact,
        evidence: {
          expandedFactId: currentFact?.id ?? null,
          factRevision: currentFact?.revision ?? null,
          items: [],
          nextCursor: null,
          isLoading: false,
          requestGeneration: 1,
          activeRequest: null,
        },
        hasLoadedFirstPage: true,
        errorCode: null,
        returnFocusElement,
        onClose: vi.fn(),
        onLoadMore: vi.fn(),
        onRetry: vi.fn(),
      });

    try {
      document.body.appendChild(triggerA);
      document.body.appendChild(triggerB);
      document.body.appendChild(container);
      await React.act(async () => {
        root.render(renderDrawer(factA, triggerA));
        await Promise.resolve();
      });
      const closeButton = findFakeDomElement(
        container as unknown as FakeDomNode,
        element =>
          element.getAttribute('aria-label') ===
          'enterpriseAiKnowledgeEvidenceDrawerClose',
      );
      expect(document.activeElement).toBe(closeButton);

      await React.act(async () => {
        root.render(renderDrawer(factB, triggerB));
        await Promise.resolve();
      });
      expect(triggerAFocus).not.toHaveBeenCalled();
      expect(triggerBFocus).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(closeButton);

      await React.act(async () => {
        root.render(renderDrawer(null, null));
        await Promise.resolve();
      });
      expect(triggerAFocus).not.toHaveBeenCalled();
      expect(triggerBFocus).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(triggerB);

      await React.act(async () => {
        root.unmount();
      });
      unmounted = true;
    } finally {
      if (!unmounted) {
        await React.act(async () => {
          root.unmount();
        });
      }
      restoreDom();
    }
  });

  test('opens the panel drawer without changing scroll position and isolates background actions', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const panelFact = fact({ id: 'panel-focus-fact', revision: 4 });
    const onReviewFact = vi.fn();
    let unmounted = false;

    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const Harness = (): React.ReactElement => {
      const [evidence, setEvidence] = React.useState(defaultViewProps.evidence);
      return React.createElement(WorkspaceAiKnowledgePanelView, {
        ...defaultViewProps,
        rows: [{ kind: 'normalized_fact', fact: panelFact }],
        evidence,
        onReviewFact,
        onToggleEvidence: selectedFact => {
          setEvidence(current =>
            current.expandedFactId === selectedFact.id
              ? { ...defaultViewProps.evidence, requestGeneration: 2 }
              : {
                  ...defaultViewProps.evidence,
                  expandedFactId: selectedFact.id,
                  factRevision: selectedFact.revision,
                  requestGeneration: 1,
                },
          );
        },
      });
    };

    try {
      document.body.appendChild(container);
      await React.act(async () => {
        root.render(React.createElement(Harness));
        await Promise.resolve();
      });
      const viewport = findFakeDomElement(
        container as unknown as FakeDomNode,
        element =>
          element.getAttribute('data-ai-knowledge-panel-viewport') !== null,
      );
      const background = findFakeDomElement(
        container as unknown as FakeDomNode,
        element =>
          element.getAttribute('data-ai-knowledge-panel-background') !== null,
      );
      const trigger = findFakeDomElement(
        container as unknown as FakeDomNode,
        element => element.getAttribute('data-evidence-trigger') !== null,
      );
      const confirm = findFakeDomElement(
        container as unknown as FakeDomNode,
        element => element.getAttribute('data-confirm-fact') !== null,
      );
      expect(viewport).not.toBeNull();
      expect(background).not.toBeNull();
      expect(trigger).not.toBeNull();
      expect(confirm).not.toBeNull();
      if (!background || !trigger || !confirm) {
        throw new Error('Panel controls were not rendered');
      }
      background.scrollTop = 240;
      confirm.click();
      expect(onReviewFact).toHaveBeenCalledWith(
        panelFact,
        KnowledgeFactReviewDecision.Confirm,
      );
      onReviewFact.mockClear();
      const triggerFocus = vi.spyOn(trigger, 'focus');

      await React.act(async () => {
        trigger.click();
        await Promise.resolve();
      });
      const drawer = findFakeDomElement(
        container as unknown as FakeDomNode,
        element => element.getAttribute('data-evidence-drawer') !== null,
      );
      const backdrop = findFakeDomElement(
        container as unknown as FakeDomNode,
        element =>
          element.getAttribute('data-evidence-drawer-backdrop') !== null,
      );
      const closeButton = findFakeDomElement(
        container as unknown as FakeDomNode,
        element =>
          element.getAttribute('aria-label') ===
          'enterpriseAiKnowledgeEvidenceDrawerClose',
      );
      expect(drawer).not.toBeNull();
      expect(backdrop).not.toBeNull();
      expect(drawer?.parentNode).toBe(viewport);
      expect(backdrop?.parentNode).toBe(viewport);
      expect(background.parentNode).toBe(viewport);
      expect(background.scrollTop).toBe(240);
      expect(background.getAttribute('inert')).not.toBeNull();
      expect(background.getAttribute('aria-hidden')).toBe('true');
      expect(background.getAttribute('class')).toContain('pointer-events-none');
      expect(document.activeElement).toBe(closeButton);

      confirm.click();
      confirm.focus();
      expect(onReviewFact).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(closeButton);

      await React.act(async () => {
        closeButton?.click();
        await Promise.resolve();
      });
      expect(triggerFocus).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(trigger);
      expect(background.scrollTop).toBe(240);

      await React.act(async () => {
        root.unmount();
      });
      unmounted = true;
    } finally {
      if (!unmounted) {
        await React.act(async () => {
          root.unmount();
        });
      }
      restoreDom();
    }
  });

  test('does not return panel drawer focus to a disconnected trigger', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const panelFact = fact({ id: 'removed-panel-fact', revision: 2 });
    let unmounted = false;

    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    const Harness = (): React.ReactElement => {
      const [currentRows, setCurrentRows] = React.useState<WorkspaceAiKnowledgeRow[]>([
        { kind: 'normalized_fact', fact: panelFact },
      ]);
      const [evidence, setEvidence] = React.useState(defaultViewProps.evidence);
      return React.createElement(WorkspaceAiKnowledgePanelView, {
        ...defaultViewProps,
        rows: currentRows,
        evidence,
        onToggleEvidence: selectedFact => {
          if (evidence.expandedFactId === selectedFact.id) {
            setCurrentRows([]);
            setEvidence({ ...defaultViewProps.evidence, requestGeneration: 2 });
            return;
          }
          setEvidence({
            ...defaultViewProps.evidence,
            expandedFactId: selectedFact.id,
            factRevision: selectedFact.revision,
            requestGeneration: 1,
          });
        },
      });
    };

    try {
      document.body.appendChild(container);
      await React.act(async () => {
        root.render(React.createElement(Harness));
        await Promise.resolve();
      });
      const trigger = findFakeDomElement(
        container as unknown as FakeDomNode,
        element => element.getAttribute('data-evidence-trigger') !== null,
      );
      expect(trigger).not.toBeNull();
      if (!trigger) {
        throw new Error('Evidence trigger was not rendered');
      }
      const triggerFocus = vi.spyOn(trigger, 'focus');
      await React.act(async () => {
        trigger.click();
        await Promise.resolve();
      });
      const closeButton = findFakeDomElement(
        container as unknown as FakeDomNode,
        element =>
          element.getAttribute('aria-label') ===
          'enterpriseAiKnowledgeEvidenceDrawerClose',
      );
      expect(closeButton).not.toBeNull();

      await React.act(async () => {
        closeButton?.click();
        await Promise.resolve();
      });
      expect(trigger.isConnected).toBe(false);
      expect(triggerFocus).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(trigger);

      await React.act(async () => {
        root.unmount();
      });
      unmounted = true;
    } finally {
      if (!unmounted) {
        await React.act(async () => {
          root.unmount();
        });
      }
      restoreDom();
    }
  });

  test('mounts 100 normalized rows with zero evidence IPC and one explicit expansion with one IPC', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const manyFacts = Array.from({ length: 100 }, (_, index) =>
      fact({ id: `fact-${index}`, value: `Fact ${index}` }),
    );
    const getFactEvidence = vi.spyOn(knowledgeBaseService, 'getFactEvidence').mockResolvedValue({
      factId: 'fact-0',
      factRevision: 1,
      items: [],
      nextCursor: null,
    });
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    vi.spyOn(knowledgeBaseService, 'listDocuments').mockResolvedValue([]);
    vi.spyOn(knowledgeBaseService, 'listFacts').mockResolvedValue({
      items: manyFacts,
      nextCursor: null,
      metrics,
    });
    let unmounted = false;

    try {
      await React.act(async () => {
        root.render(
          React.createElement(WorkspaceAiKnowledgePanel, {
            workspaceId: 'workspace-a',
            profileRevision: 1,
            profile: emptyProfile(),
            onMaintainCompany: vi.fn(),
          }),
        );
        await Promise.resolve();
      });
      expect(getFactEvidence).not.toHaveBeenCalled();

      const firstDisclosure = findFakeDomElement(
        container as unknown as FakeDomNode,
        element =>
          element.tagName.toLowerCase() === 'button' &&
          element.getAttribute('data-evidence-trigger') !== null &&
          element.getAttribute('aria-controls')?.endsWith('evidence-drawer') ===
            true &&
          element.getAttribute('aria-expanded') === 'false',
      );
      expect(firstDisclosure).not.toBeNull();
      await React.act(async () => {
        firstDisclosure?.click();
        for (let index = 0; index < 8; index += 1) {
          await Promise.resolve();
        }
      });
      expect(getFactEvidence).toHaveBeenCalledTimes(1);
      expect(getFactEvidence.mock.calls[0][0]).toEqual({
        factId: 'fact-0',
        expectedRevision: 1,
        limit: KNOWLEDGE_FACT_EVIDENCE_PAGE_DEFAULT_LIMIT,
      });

      await React.act(async () => {
        root.unmount();
      });
      unmounted = true;
    } finally {
      if (!unmounted) {
        await React.act(async () => {
          root.unmount();
        });
      }
      restoreDom();
    }
  });

  test('resets content expansion when the production panel switches workspaces with the same fact identity', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const stableProfile = emptyProfile();
    const sharedFact = fact({ id: 'shared-fact', revision: 7 });
    let unmounted = false;

    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    vi.spyOn(knowledgeBaseService, 'listDocuments').mockResolvedValue([]);
    vi.spyOn(knowledgeBaseService, 'listFacts').mockResolvedValue({
      items: [sharedFact],
      nextCursor: null,
      metrics,
    });

    const renderWorkspace = (workspaceId: string): React.ReactElement =>
      React.createElement(WorkspaceAiKnowledgePanel, {
        workspaceId,
        profileRevision: 1,
        profile: stableProfile,
        onMaintainCompany: vi.fn(),
      });

    try {
      document.body.appendChild(container);
      await React.act(async () => {
        root.render(renderWorkspace('workspace-a'));
        for (let index = 0; index < 8; index += 1) {
          await Promise.resolve();
        }
      });
      const workspaceAToggle = findFakeDomElement(
        container as unknown as FakeDomNode,
        element =>
          element.getAttribute('data-knowledge-content-toggle') !== null,
      );
      expect(workspaceAToggle).not.toBeNull();
      await React.act(async () => {
        workspaceAToggle?.click();
        await Promise.resolve();
      });
      expect(workspaceAToggle?.getAttribute('aria-expanded')).toBe('true');

      await React.act(async () => {
        root.render(renderWorkspace('workspace-b'));
        for (let index = 0; index < 8; index += 1) {
          await Promise.resolve();
        }
      });
      const workspaceBToggle = findFakeDomElement(
        container as unknown as FakeDomNode,
        element =>
          element.getAttribute('data-knowledge-content-toggle') !== null,
      );
      expect(workspaceBToggle).not.toBeNull();
      expect(workspaceBToggle?.getAttribute('aria-expanded')).toBe('false');

      await React.act(async () => {
        root.unmount();
      });
      unmounted = true;
    } finally {
      if (!unmounted) {
        await React.act(async () => {
          root.unmount();
        });
      }
      restoreDom();
    }
  });

  test('keeps an uncommitted context callback isolated until that context commits', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const workspaceAPage = deferred<KnowledgeFactListResult>();
    const blocker = deferred<void>();
    const workspaceAMetrics = { ...metrics, totalAiKnowledgeCount: 101 };
    const workspaceBMetrics = { ...metrics, totalAiKnowledgeCount: 202 };
    const onWorkspaceAMetrics = vi.fn();
    const onWorkspaceBMetrics = vi.fn();
    let shouldSuspend = false;

    const SuspendAfterPanel = (): null => {
      if (shouldSuspend) {
        throw blocker.promise;
      }
      return null;
    };
    const renderTree = (
      workspaceId: string,
      onMetricsChange: (value: KnowledgeFactMetrics) => void,
    ): React.ReactElement =>
      React.createElement(
        React.Suspense,
        { fallback: null },
        React.createElement(WorkspaceAiKnowledgePanel, {
          workspaceId,
          profileRevision: workspaceId === 'workspace-a' ? 1 : 2,
          profile: emptyProfile(),
          onMetricsChange,
          onMaintainCompany: vi.fn(),
        }),
        React.createElement(SuspendAfterPanel),
      );

    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    vi.spyOn(knowledgeBaseService, 'listDocuments').mockResolvedValue([]);
    vi.spyOn(knowledgeBaseService, 'listFacts').mockImplementation(request =>
      request.workspaceId === 'workspace-a'
        ? workspaceAPage.promise
        : Promise.resolve({
            items: [fact({ id: 'fact-b', value: 'Workspace B fact' })],
            nextCursor: null,
            metrics: workspaceBMetrics,
          }),
    );

    try {
      await React.act(async () => {
        root.render(renderTree('workspace-a', onWorkspaceAMetrics));
        await Promise.resolve();
      });

      shouldSuspend = true;
      await React.act(async () => {
        React.startTransition(() => {
          root.render(renderTree('workspace-b', onWorkspaceBMetrics));
        });
        await Promise.resolve();
      });

      await React.act(async () => {
        workspaceAPage.resolve({
          items: [fact({ id: 'fact-a', value: 'Workspace A fact' })],
          nextCursor: null,
          metrics: workspaceAMetrics,
        });
        await Promise.resolve();
      });

      expect(onWorkspaceAMetrics).toHaveBeenCalledTimes(1);
      expect(onWorkspaceAMetrics.mock.calls[0][0]).toBe(workspaceAMetrics);
      expect(onWorkspaceBMetrics).not.toHaveBeenCalled();

      shouldSuspend = false;
      await React.act(async () => {
        blocker.resolve();
        await blocker.promise;
        await Promise.resolve();
      });

      expect(onWorkspaceAMetrics).toHaveBeenCalledTimes(1);
      expect(onWorkspaceBMetrics).toHaveBeenCalledTimes(1);
      expect(onWorkspaceBMetrics.mock.calls[0][0]).toBe(workspaceBMetrics);
    } finally {
      await React.act(async () => {
        root.unmount();
      });
      restoreDom();
    }
  });

  test('captures an empty first committed snapshot when the service holder changes', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const serviceBPage = deferred<KnowledgeFactListResult>();
    const stableProfile = emptyProfile();
    const captures: Array<{
      label: string;
      factIds: string[];
      metrics: KnowledgeFactMetrics;
    }> = [];
    const serviceAMetrics = { ...metrics, totalAiKnowledgeCount: 301 };
    const serviceA: WorkspaceAiKnowledgeTestService = {
      listFacts: vi.fn(async (): Promise<KnowledgeFactListResult> => ({
        items: [fact({ id: 'service-a-fact' })],
        nextCursor: null,
        metrics: serviceAMetrics,
      })),
      listDocuments: vi.fn(async () => []),
    };
    const serviceB: WorkspaceAiKnowledgeTestService = {
      listFacts: vi.fn(() => serviceBPage.promise),
      listDocuments: vi.fn(async () => []),
    };
    const HookCapture = ({
      label,
      service,
    }: {
      label: string;
      service: WorkspaceAiKnowledgeTestService;
    }): null => {
      const state = useWorkspaceAiKnowledge({
        workspaceId: 'workspace-a',
        profileRevision: 1,
        profile: stableProfile,
        service,
      });
      React.useLayoutEffect(() => {
        captures.push({
          label,
          factIds: state.facts.map(item => item.id),
          metrics: state.metrics,
        });
      });
      return null;
    };

    try {
      await React.act(async () => {
        root.render(React.createElement(HookCapture, { label: 'A', service: serviceA }));
        await Promise.resolve();
      });
      expect(captures[captures.length - 1]?.factIds).toEqual(['service-a-fact']);

      await React.act(async () => {
        root.render(React.createElement(HookCapture, { label: 'B', service: serviceB }));
        await Promise.resolve();
      });

      const firstServiceBCapture = captures.find(capture => capture.label === 'B');
      expect(firstServiceBCapture?.factIds).toEqual([]);
      expect(firstServiceBCapture?.metrics.totalAiKnowledgeCount).toBe(0);

      serviceBPage.resolve({
        items: [fact({ id: 'service-b-fact' })],
        nextCursor: null,
        metrics: { ...metrics, totalAiKnowledgeCount: 302 },
      });
    } finally {
      await React.act(async () => {
        root.unmount();
      });
      restoreDom();
    }
  });

  test('does not mutate the committed holder during an aborted service render', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const { flushSync } = await import('react-dom');
    const container = document.createElement('div');
    const root = createRoot(container);
    const blocker = deferred<void>();
    const stableProfile = emptyProfile();
    let shouldSuspend = false;
    const serviceA: WorkspaceAiKnowledgeTestService = {
      listFacts: vi.fn(async (): Promise<KnowledgeFactListResult> => ({
        items: [fact({ id: 'service-a-fact' })],
        nextCursor: null,
        metrics,
      })),
      listDocuments: vi.fn(async () => []),
    };
    const serviceB: WorkspaceAiKnowledgeTestService = {
      listFacts: vi.fn(async (): Promise<KnowledgeFactListResult> => ({
        items: [],
        nextCursor: null,
        metrics,
      })),
      listDocuments: vi.fn(async () => []),
    };
    const HookHarness = ({
      service,
    }: {
      service: WorkspaceAiKnowledgeTestService;
    }): null => {
      useWorkspaceAiKnowledge({
        workspaceId: 'workspace-a',
        profileRevision: 1,
        profile: stableProfile,
        service,
      });
      return null;
    };
    const SuspendAfterHook = (): null => {
      if (shouldSuspend) {
        throw blocker.promise;
      }
      return null;
    };
    const renderTree = (service: WorkspaceAiKnowledgeTestService): React.ReactElement =>
      React.createElement(
        React.Suspense,
        { fallback: null },
        React.createElement(HookHarness, { service }),
        React.createElement(SuspendAfterHook),
      );

    try {
      await React.act(async () => {
        root.render(renderTree(serviceA));
        await Promise.resolve();
      });
      expect(serviceA.listFacts).toHaveBeenCalledTimes(1);

      shouldSuspend = true;
      await React.act(async () => {
        React.startTransition(() => {
          root.render(renderTree(serviceB));
        });
        await Promise.resolve();
      });
      expect(serviceB.listFacts).not.toHaveBeenCalled();

      shouldSuspend = false;
      await React.act(async () => {
        flushSync(() => {
          root.render(renderTree(serviceA));
        });
        await Promise.resolve();
      });

      expect(serviceA.listFacts).toHaveBeenCalledTimes(1);
      expect(serviceB.listFacts).not.toHaveBeenCalled();
      blocker.resolve();
    } finally {
      await React.act(async () => {
        root.unmount();
      });
      restoreDom();
    }
  });
});
