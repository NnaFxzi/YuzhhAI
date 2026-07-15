import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { EnterpriseLeadWorkspace } from '../../../shared/enterpriseLeadWorkspace/types';
import { buildDefaultEnterpriseLeadWorkspaceSettings } from '../../../shared/enterpriseLeadWorkspace/validation';
import { i18nService } from '../../services/i18n';
import { kitService } from '../../services/kit';
import type { InstalledKit, MarketplaceKit } from '../../types/kit';
import {
  buildWorkspaceKitItems,
  WorkspaceKitsPanel,
  WorkspaceKitsPanelContent,
} from './WorkspaceKitsPanel';

const createWorkspace = (kitIds: string[]): EnterpriseLeadWorkspace => ({
  id: 'workspace-1',
  name: 'Workspace 1',
  type: 'enterprise_lead_generation',
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
  extractionSources: [],
  riskRules: [],
  enabledAgentRoles: [],
  workspaceAgents: [],
  settings: {
    ...buildDefaultEnterpriseLeadWorkspaceSettings(),
    kitIds,
  },
  profileRevision: 1,
  recentRunId: null,
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
});

const marketplaceKit: MarketplaceKit = {
  id: 'research-kit',
  name: 'Research Kit',
  description: 'Research from trusted sources.',
  icon: 'https://example.com/research-kit.png',
  skills: {
    bundle: 'https://example.com/research-kit.zip',
    list: [
      { id: 'web-search', name: 'Web Search' },
      { id: 'report-writer', name: 'Report Writer' },
    ],
  },
};

const installedKit: InstalledKit = {
  id: marketplaceKit.id,
  version: '1.0.0',
  installedAt: 1,
  skills: {
    skillIds: ['web-search', 'report-writer'],
  },
  mcpServers: [],
  connectors: [],
};

class FakeDomNode {
  parentNode: FakeDomNode | null = null;
  childNodes: FakeDomNode[] = [];
  ownerDocument: FakeDomDocument | null = null;
  nodeValue: string | null = null;
  nodeName = '';
  nodeType = 0;

  get textContent(): string {
    return this.childNodes.map(node => node.textContent ?? '').join('');
  }

  set textContent(value: string) {
    this.childNodes = value ? [new FakeDomText(value)] : [];
  }

  get firstChild(): FakeDomNode | null {
    return this.childNodes[0] ?? null;
  }

  appendChild(node: FakeDomNode): FakeDomNode {
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }

  insertBefore(node: FakeDomNode, before: FakeDomNode | null): FakeDomNode {
    if (!before) return this.appendChild(node);
    const index = this.childNodes.indexOf(before);
    if (index < 0) return this.appendChild(node);
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
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }
}

class FakeDomText extends FakeDomNode {
  nodeName = '#text';
  nodeType = 3;

  constructor(value: string) {
    super();
    this.nodeValue = value;
  }

  get textContent(): string {
    return this.nodeValue ?? '';
  }

  set textContent(value: string) {
    this.nodeValue = value;
  }
}

class FakeDomComment extends FakeDomText {
  nodeName = '#comment';
  nodeType = 8;
}

class FakeDomElement extends FakeDomNode {
  nodeType = 1;
  nodeName: string;
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  disabled = false;
  private eventListeners = new Map<
    string,
    Array<{ listener: EventListenerOrEventListenerObject; capture: boolean }>
  >();

  constructor(
    public tagName: string,
    isSvg = false,
  ) {
    super();
    this.nodeName = tagName.toUpperCase();
    if (isSvg) this.namespaceURI = 'http://www.w3.org/2000/svg';
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  setAttributeNS(_namespace: string | null, name: string, value: string): void {
    this.setAttribute(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getAttributeNS(_namespace: string | null, name: string): string | null {
    return this.getAttribute(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const listeners = this.eventListeners.get(type) ?? [];
    listeners.push({ listener, capture });
    this.eventListeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const listeners = this.eventListeners.get(type) ?? [];
    this.eventListeners.set(
      type,
      listeners.filter(entry => entry.listener !== listener || entry.capture !== capture),
    );
  }

  click(): void {
    const path: FakeDomElement[] = [this];
    let current = this.parentNode;
    while (current) {
      if (current instanceof FakeDomElement) path.push(current);
      current = current.parentNode;
    }
    const event = {
      type: 'click',
      target: this,
      srcElement: this,
      currentTarget: null,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 0,
      detail: 1,
      isTrusted: false,
      timeStamp: Date.now(),
      preventDefault: (): void => undefined,
      stopPropagation: (): void => undefined,
      stopImmediatePropagation: (): void => undefined,
      composedPath: (): FakeDomElement[] => [...path],
    } as unknown as MouseEvent;

    for (const element of [...path].reverse()) {
      for (const entry of element.eventListeners.get('click') ?? []) {
        if (entry.capture) {
          if (typeof entry.listener === 'function') entry.listener.call(element, event);
          else entry.listener.handleEvent(event);
        }
      }
    }
    for (const element of path) {
      for (const entry of element.eventListeners.get('click') ?? []) {
        if (!entry.capture) {
          if (typeof entry.listener === 'function') entry.listener.call(element, event);
          else entry.listener.handleEvent(event);
        }
      }
    }
  }
}

class FakeDomDocument extends FakeDomNode {
  nodeType = 9;
  nodeName = '#document';
  documentElement = new FakeDomElement('html');
  body = new FakeDomElement('body');
  defaultView = globalThis as Window & typeof globalThis;

  constructor() {
    super();
    this.documentElement.ownerDocument = this;
    this.body.ownerDocument = this;
  }

  createElement(tagName: string): FakeDomElement {
    const element = new FakeDomElement(tagName);
    element.ownerDocument = this;
    return element;
  }

  createElementNS(namespace: string | null, tagName: string): FakeDomElement {
    const element = new FakeDomElement(tagName, namespace === 'http://www.w3.org/2000/svg');
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

  addEventListener(): void {}

  removeEventListener(): void {}

  getElementById(): null {
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
    self: undefined as unknown,
    top: undefined as unknown,
    parent: undefined as unknown,
    addEventListener: (): void => undefined,
    removeEventListener: (): void => undefined,
    requestAnimationFrame: (callback: FrameRequestCallback): number =>
      setTimeout(() => callback(Date.now()), 0) as unknown as number,
    cancelAnimationFrame: (handle: number): void => clearTimeout(handle),
    getSelection: (): null => null,
    HTMLElement: FakeDomElement,
    HTMLIFrameElement: class FakeDomIFrameElement {},
    Node: FakeDomNode,
    Text: FakeDomText,
    Comment: FakeDomComment,
    SVGElement: class FakeDomSvgElement {},
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

  return () => vi.unstubAllGlobals();
};

const findByAttribute = (
  root: FakeDomNode,
  attribute: string,
  value?: string,
): FakeDomElement | null => {
  for (const child of root.childNodes) {
    if (!(child instanceof FakeDomElement)) continue;
    const actual = child.getAttribute(attribute);
    if (value === undefined ? actual !== null : actual === value) return child;
    const nested = findByAttribute(child, attribute, value);
    if (nested) return nested;
  }
  return null;
};

const findButtonByText = (root: FakeDomNode, text: string): FakeDomElement | null => {
  for (const child of root.childNodes) {
    if (!(child instanceof FakeDomElement)) continue;
    if (child.tagName === 'button' && child.textContent === text) return child;
    const nested = findButtonByText(child, text);
    if (nested) return nested;
  }
  return null;
};

const flushEffects = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const mockKitData = (
  marketplaceKits: MarketplaceKit[],
  installedKits: Record<string, InstalledKit>,
): void => {
  vi.spyOn(kitService, 'fetchMarketplaceKits').mockResolvedValue(marketplaceKits);
  vi.spyOn(kitService, 'getInstalledKits').mockResolvedValue(installedKits);
};

const managementCtaCases: Array<[
  state: string,
  workspace: EnterpriseLeadWorkspace,
  marketplaceKits: MarketplaceKit[],
  installedKits: Record<string, InstalledKit>,
  actionLabel: string,
]> = [
  ['empty', createWorkspace([]), [], {}, 'enterpriseLeadWorkspaceKitsManageAction'],
  ['missing', createWorkspace(['missing-kit']), [], {}, 'enterpriseLeadWorkspaceKitsManageAction'],
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WorkspaceKitsPanel', () => {
  test('renders an installed workspace default as selected with its metadata and skill count', () => {
    vi.spyOn(i18nService, 't').mockImplementation(key => key);
    const items = buildWorkspaceKitItems(
      createWorkspace([marketplaceKit.id]),
      { [installedKit.id]: installedKit },
      [marketplaceKit],
    );

    const markup = renderToStaticMarkup(
      React.createElement(WorkspaceKitsPanelContent, {
        items,
        savingKitId: null,
        saveError: '',
        onToggle: vi.fn(),
      }),
    );

    expect(markup).toContain('Research Kit');
    expect(markup).toContain('Research from trusted sources.');
    expect(markup).toContain('enterpriseLeadWorkspaceKitsSelected');
    expect(markup).toContain('enterpriseLeadWorkspaceKitsDefault');
    expect(markup).toContain('kitInstalled');
    expect(markup).toContain('kitSkillCount');
    expect(markup).toContain('aria-pressed="true"');
  });

  test('updates localized Kit metadata after the application language changes', async () => {
    const previousLanguage = i18nService.getLanguage();
    const localizedKit: MarketplaceKit = {
      ...marketplaceKit,
      name: { zh: '研究套件', en: 'Research Kit' },
      description: { zh: '从可信来源开展研究。', en: 'Research from trusted sources.' },
    };
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    mockKitData([localizedKit], { [installedKit.id]: installedKit });

    try {
      i18nService.setLanguage('zh', { persist: false });
      await React.act(async () => {
        root.render(React.createElement(WorkspaceKitsPanel, {
          workspace: createWorkspace([localizedKit.id]),
        }));
        await flushEffects();
      });
      expect(container.textContent).toContain('研究套件');

      await React.act(async () => {
        i18nService.setLanguage('en', { persist: false });
        await flushEffects();
      });
      expect(container.textContent).toContain('Research Kit');
      expect(container.textContent).toContain('Research from trusted sources.');
    } finally {
      await React.act(async () => root.unmount());
      i18nService.setLanguage(previousLanguage, { persist: false });
      restoreDom();
    }
  });

  test('clicks the rendered Kit toggle and persists only Kit settings', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const { enterpriseLeadWorkspaceService } = await import('../../services/enterpriseLeadWorkspace');
    const container = document.createElement('div');
    const root = createRoot(container);
    const workspace = createWorkspace([]);
    const updatedWorkspace = createWorkspace([marketplaceKit.id]);
    const onWorkspaceUpdated = vi.fn();
    mockKitData([marketplaceKit], { [installedKit.id]: installedKit });
    const updateWorkspaceSettings = vi
      .spyOn(enterpriseLeadWorkspaceService, 'updateWorkspaceSettings')
      .mockResolvedValue(updatedWorkspace);

    try {
      await React.act(async () => {
        root.render(React.createElement(WorkspaceKitsPanel, { workspace, onWorkspaceUpdated }));
        await flushEffects();
      });
      const toggle = findByAttribute(
        container as unknown as FakeDomNode,
        'data-workspace-kit-id',
        marketplaceKit.id,
      );
      expect(toggle).not.toBeNull();

      await React.act(async () => {
        toggle?.click();
        await flushEffects();
      });

      expect(updateWorkspaceSettings).toHaveBeenCalledWith(workspace.id, {
        settings: { kitIds: [marketplaceKit.id] },
      });
      expect(updateWorkspaceSettings.mock.calls[0]?.[1]).not.toHaveProperty('enabledAgentRoles');
      expect(updateWorkspaceSettings.mock.calls[0]?.[1]).not.toHaveProperty('workspaceAgents');
      expect(onWorkspaceUpdated).toHaveBeenCalledWith(updatedWorkspace);
    } finally {
      await React.act(async () => root.unmount());
      restoreDom();
    }
  });

  test('removes a stale missing workspace default from persisted Kit settings', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const { enterpriseLeadWorkspaceService } = await import('../../services/enterpriseLeadWorkspace');
    const container = document.createElement('div');
    const root = createRoot(container);
    const workspace = createWorkspace(['missing-kit']);
    const updatedWorkspace = createWorkspace([]);
    const onWorkspaceUpdated = vi.fn();
    mockKitData([], {});
    const updateWorkspaceSettings = vi
      .spyOn(enterpriseLeadWorkspaceService, 'updateWorkspaceSettings')
      .mockResolvedValue(updatedWorkspace);

    try {
      await React.act(async () => {
        root.render(React.createElement(WorkspaceKitsPanel, { workspace, onWorkspaceUpdated }));
        await flushEffects();
      });
      const remove = findByAttribute(
        container as unknown as FakeDomNode,
        'data-workspace-kit-remove',
        'missing-kit',
      );
      expect(remove).not.toBeNull();

      await React.act(async () => {
        remove?.click();
        await flushEffects();
      });

      expect(updateWorkspaceSettings).toHaveBeenCalledWith(workspace.id, {
        settings: { kitIds: [] },
      });
      expect(onWorkspaceUpdated).toHaveBeenCalledWith(updatedWorkspace);
    } finally {
      await React.act(async () => root.unmount());
      restoreDom();
    }
  });

  test.each(managementCtaCases)('clicks the rendered $state management CTA', async (
    _state,
    workspace,
    marketplaceKits,
    installedKits,
    actionLabel,
  ) => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    const root = createRoot(container);
    const onShowKits = vi.fn();
    mockKitData(marketplaceKits, installedKits);
    vi.spyOn(i18nService, 't').mockImplementation(key => key);

    try {
      await React.act(async () => {
        root.render(React.createElement(WorkspaceKitsPanel, { workspace, onShowKits }));
        await flushEffects();
      });
      const manageAction = findButtonByText(container as unknown as FakeDomNode, actionLabel);
      expect(manageAction).not.toBeNull();

      await React.act(async () => {
        manageAction?.click();
      });

      expect(onShowKits).toHaveBeenCalledTimes(1);
    } finally {
      await React.act(async () => root.unmount());
      restoreDom();
    }
  });
});
