import { configureStore } from '@reduxjs/toolkit';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  EnterpriseLeadAgentRole,
  EnterpriseLeadContentDeliveryMode,
  EnterpriseLeadContentOutputPlatformId,
  EnterpriseLeadDeliverableKind,
  EnterpriseLeadDocumentExtractionStatus,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadKnowledgeIndexStatus,
  EnterpriseLeadRunStatus,
  EnterpriseLeadTaskStatus,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadPendingVersion,
  EnterpriseLeadRun,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceProfile,
  EnterpriseLeadWorkspaceRunSummary,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { buildDefaultEnterpriseLeadWorkspaceSettings } from '../../../shared/enterpriseLeadWorkspace/validation';
import type {
  KnowledgeExtractionAuthorizationPreparation,
  KnowledgeFactMetrics,
  KnowledgeImportBatchResult,
} from '../../../shared/knowledgeBase/types';
import { enterpriseLeadWorkspaceService } from '../../services/enterpriseLeadWorkspace';
import { i18nService } from '../../services/i18n';
import agentReducer from '../../store/slices/agentSlice';
import authReducer from '../../store/slices/authSlice';
import modelReducer from '../../store/slices/modelSlice';
import skillReducer from '../../store/slices/skillSlice';
import type { Skill } from '../../types/skill';
import * as workspaceUi from './enterpriseLeadWorkspaceUi';
import {
  buildCreationRecordConversationMessages,
  buildManualEnterpriseLeadWorkspaceDraft,
  EnterpriseLeadEntryAction,
  EnterpriseLeadKnowledgeItemKind,
  EnterpriseLeadKnowledgeSection,
  EnterpriseLeadWorkspaceHistoryState,
  EnterpriseLeadWorkspaceInternalPage,
  EnterpriseLeadWorkspaceLaunchMode,
  EnterpriseLeadWorkspaceScreen,
  EnterpriseLeadWorkspaceShellMode,
  EnterpriseLeadWorkspaceStartAction,
  EnterpriseLeadWorkspaceStartSourceState,
  getAgentCardTone,
  getAgentStatusLabelKey,
  getCreationRecordSummary,
  getEditableKnowledgeField,
  getEnterpriseLeadTaskDisplay,
  getEntryHomeActions,
  getHistoryModalState,
  getLaunchMode,
  getShellModeForEnterpriseLeadWorkspaceScreen,
  getWorkbenchSidebarItems,
  getWorkspaceCompletionPercent,
  getWorkspaceCreateBranchScreen,
  getWorkspaceInternalPages,
  getWorkspaceKnowledgeSections,
  getWorkspaceStartActionTarget,
  getWorkspaceStartReadiness,
  getWorkspaceStartSourceState,
  hasTaskOutput,
  isWorkspaceOperationCurrent,
  normalizeWorkspaceInternalPage,
  shouldRefreshHistoryOnEntryAction,
  sortWorkspacesByRecentUpdate,
  summarizeWorkspaceDraft,
  WorkspaceCreateBranchScreen,
  WorkspaceCreateStartMode,
} from './enterpriseLeadWorkspaceUi';
import {
  EnterpriseLeadWorkspacePageTarget,
  getEnterpriseLeadWorkspacePageRouting,
  hasEnterpriseLeadWorkspaceProcessingSources,
} from './EnterpriseLeadWorkspaceView';
import type { WorkspaceConversationRecord } from './workspaceCoworkSessionRecords';
import WorkspaceCreate from './WorkspaceCreate';
import { getInitialCreationRecordId } from './WorkspaceCreationRecords';
import WorkspaceEntryHome, {
  WorkspaceDeleteConfirmDialog,
  WorkspaceHistoryList,
} from './WorkspaceEntryHome';
import WorkspaceKnowledgeExtractionDialog from './WorkspaceKnowledgeExtractionDialog';
import { buildWorkspaceSearchResults, WorkspaceSearch } from './WorkspaceSearch';
import {
  getWorkspaceSettingsReadiness,
  saveWorkspaceSettingsDraft,
  WorkspaceSettings,
} from './WorkspaceSettings';
import {
  getContentPlatformConnectionStatus,
  getExternalResearchProviderConnectionStatus,
  getModelProviderConnectionStatus,
  getWorkspaceSettingsBlockingIssues,
} from './workspaceSettingsReadiness';
import WorkspaceShell, {
  getWorkspaceShellNavAction,
  WorkspaceShellNavAction,
} from './WorkspaceShell';
import WorkspaceStart from './WorkspaceStart';

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

const createWorkspace = (
  id: string,
  enabledAgentRoles: EnterpriseLeadWorkspace['enabledAgentRoles'] = [],
  workspaceAgents: EnterpriseLeadWorkspaceAgentBinding[] = [],
): EnterpriseLeadWorkspace => ({
  id,
  name: `Workspace ${id}`,
  type: 'enterprise_lead',
  profile: emptyProfile(),
  profileRevision: 1,
  extractionSources: [],
  riskRules: [],
  enabledAgentRoles,
  settings: buildDefaultEnterpriseLeadWorkspaceSettings(),
  workspaceAgents,
  recentRunId: null,
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z',
});

const createRun = (workspaceId: string): EnterpriseLeadRun => ({
  id: 'run-1',
  workspaceId,
  userGoal: '整理本周可跟进的机械厂线索',
  status: EnterpriseLeadRunStatus.Running,
  currentRole: EnterpriseLeadAgentRole.ContentPlanning,
  controllerSummary: '内容策划 Agent 正在处理。',
  archiveStatus: 'not_archived',
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z',
  completedAt: null,
});

const createRunSummary = (
  workspaceId: string,
  overrides: Partial<EnterpriseLeadRun> = {},
): EnterpriseLeadWorkspaceRunSummary => ({
  run: {
    ...createRun(workspaceId),
    ...overrides,
  },
  taskCount: 3,
  deliverableCount: 2,
  todoCount: 1,
  riskCount: 0,
});

const createTask = (
  workspaceId: string,
  role: EnterpriseLeadAgentRole = EnterpriseLeadAgentRole.ContentPlanning,
): EnterpriseLeadAgentTask => ({
  id: `task-${role}`,
  runId: 'run-1',
  role,
  workspaceAgentId: null,
  agentSnapshot: null,
  status: EnterpriseLeadTaskStatus.Completed,
  inputPayload: {
    workspaceId,
  },
  outputPayload: {
    draft: '本周优先跟进长三角精密制造客户。',
  },
  summary: '已生成本周精密制造获客内容草稿。',
  missingInfo: [],
  todos: [],
  risks: [],
  handoffContext: {},
  error: '',
  stale: false,
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z',
});

const createPendingVersion = (
  workspaceId: string,
  role: EnterpriseLeadAgentRole = EnterpriseLeadAgentRole.ContentPlanning,
): EnterpriseLeadPendingVersion => ({
  id: 'version-1',
  taskId: `task-${role}`,
  runId: 'run-1',
  workspaceId,
  role,
  userMessage: '改得更短，更适合销售直接发送',
  summary: '更短的销售触达版本。',
  outputPayload: {},
  missingInfo: [],
  todos: [],
  risks: [],
  handoffContext: {},
  status: 'pending',
  createdAt: '2026-07-04T00:00:00.000Z',
  appliedAt: null,
});

const createSnapshot = (workspace: EnterpriseLeadWorkspace): EnterpriseLeadWorkspaceSnapshot => ({
  workspace,
  currentRun: createRun(workspace.id),
  tasks: [createTask(workspace.id)],
  pendingVersions: [createPendingVersion(workspace.id)],
  deliverables: [],
  todos: [],
  archives: [],
});

const createDraft = (profile: EnterpriseLeadWorkspaceProfile): EnterpriseLeadWorkspaceDraft => ({
  name: 'North Star Leads',
  type: 'enterprise_lead',
  profile,
  source: {
    kind: 'conversation',
    label: 'Conversation',
  },
  enabledAgentRoles: [],
  workspaceAgents: [],
});

const createTestSkills = (): Skill[] => [
  {
    id: 'docx',
    name: '文档处理',
    description: '读取和整理客户资料文档。',
    enabled: true,
    isOfficial: true,
    isBuiltIn: true,
    updatedAt: 0,
    prompt: '',
    skillPath: '/tmp/docx/SKILL.md',
  },
  {
    id: 'web-search',
    name: '联网搜索',
    description: '搜索公开网页信息。',
    enabled: true,
    isOfficial: true,
    isBuiltIn: true,
    updatedAt: 0,
    prompt: '',
    skillPath: '/tmp/web-search/SKILL.md',
  },
];

const renderEnterpriseLeadComponent = (
  element: React.ReactElement,
  options: { skills?: Skill[] } = {},
): string => {
  const testStore = configureStore({
    reducer: {
      auth: authReducer,
      agent: agentReducer,
      model: modelReducer,
      skill: skillReducer,
    },
    preloadedState: {
      agent: {
        agents: [
          {
            id: 'agent-a',
            name: 'Global Writer',
            description: 'Global writer description.',
            icon: 'briefcase',
            model: 'deepseek/deepseek-chat',
            workingDirectory: '',
            enabled: true,
            pinned: false,
            pinOrder: null,
            isDefault: false,
            source: 'custom' as const,
            skillIds: ['docx'],
          },
          {
            id: 'agent-b',
            name: 'Research Agent',
            description: 'Researches public customer signals.',
            icon: 'search',
            model: 'openai/gpt-4.1',
            workingDirectory: '',
            enabled: true,
            pinned: false,
            pinOrder: null,
            isDefault: false,
            source: 'custom' as const,
            skillIds: ['web-search'],
          },
        ],
        currentAgentId: 'main',
        loading: false,
      },
      skill: {
        skills: options.skills ?? createTestSkills(),
        activeSkillIds: [],
      },
    },
  });

  return renderToStaticMarkup(
    React.createElement(Provider, {
      store: testStore,
      children: element,
    }),
  );
};

const createDeferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} => {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
};

class FakeDomNode {
  parentNode: FakeDomNode | null = null;
  childNodes: FakeDomNode[] = [];
  ownerDocument: FakeDomDocument | null = null;
  private nodeValueValue: string | null = null;
  private textContentValue = '';

  get nodeValue(): string | null {
    return this.nodeValueValue;
  }

  set nodeValue(value: string | null) {
    this.nodeValueValue = value;
    this.textContentValue = value ?? '';
  }

  get textContent(): string {
    return this.textContentValue;
  }

  set textContent(value: string) {
    this.textContentValue = value;
    this.nodeValueValue = value;
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
}

class FakeDomText extends FakeDomNode {
  nodeType = 3;
  nodeName = '#text';

  constructor(text: string) {
    super();
    this.nodeValue = text;
    this.textContent = text;
  }
}

class FakeDomComment extends FakeDomNode {
  nodeType = 8;
  nodeName = '#comment';

  constructor(text: string) {
    super();
    this.nodeValue = text;
    this.textContent = text;
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
  disabled = false;
  private valueValue = '';
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
    return this.valueValue;
  }

  set value(value: string) {
    this.valueValue = value;
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
    const listeners = this.eventListeners.get(type);
    if (!listeners) {
      return;
    }
    this.eventListeners.set(
      type,
      listeners.filter(entry => entry.listener !== listener || entry.capture !== capture),
    );
  }

  attachEvent(): void {}

  detachEvent(): void {}

  focus(): void {}

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
      detail: type === 'click' ? 1 : 0,
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
    } as unknown as Event;
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

  click(): void {
    this.dispatchBubblingEvent('click');
  }

  input(value: string): void {
    const previousValue = this.value;
    this.dispatchBubblingEvent('focusin');
    const valueSetter = Object.getOwnPropertyDescriptor(FakeDomElement.prototype, 'value')?.set;
    valueSetter?.call(this, value);
    const valueTracker = (
      this as unknown as {
        _valueTracker?: { setValue: (trackedValue: string) => void };
      }
    )._valueTracker;
    valueTracker?.setValue(previousValue);
    this.dispatchBubblingEvent('input');
    this.dispatchBubblingEvent('change');
    this.dispatchBubblingEvent('keyup');
    this.dispatchBubblingEvent('focusout');
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

const findFakeDomElements = (
  root: FakeDomNode,
  predicate: (element: FakeDomElement) => boolean,
): FakeDomElement[] => {
  const elements: FakeDomElement[] = [];
  for (const child of root.childNodes) {
    if (child instanceof FakeDomElement) {
      if (predicate(child)) {
        elements.push(child);
      }
      elements.push(...findFakeDomElements(child, predicate));
    }
  }
  return elements;
};

class FakeDomDocument extends FakeDomNode {
  nodeType = 9;
  nodeName = '#document';
  oninput: unknown = null;
  documentElement: FakeDomElement;
  body: FakeDomElement;
  defaultView: Window & typeof globalThis;

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
    const element = new FakeDomElement(tagName, namespace === 'http://www.w3.org/2000/svg');
    element.ownerDocument = this;
    return element;
  }

  createTextNode(text: string): FakeDomText {
    const node = new FakeDomText(text);
    node.ownerDocument = this;
    return node;
  }

  createComment(text: string): FakeDomComment {
    const node = new FakeDomComment(text);
    node.ownerDocument = this;
    return node;
  }

  addEventListener(): void {}

  removeEventListener(): void {}

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
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
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
    electron: {
      platform: 'darwin',
      log: {
        fromRenderer: vi.fn(),
      },
      window: {
        isMaximized: vi.fn().mockResolvedValue(false),
        onStateChanged: vi.fn(() => () => undefined),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
        showSystemMenu: vi.fn(),
      },
    },
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

const collectFakeDomAttributeValues = (node: FakeDomNode, attributeName: string): string[] => {
  const values: string[] = [];

  if (node instanceof FakeDomElement) {
    const value = node.getAttribute(attributeName);

    if (value) {
      values.push(value);
    }
  }

  node.childNodes.forEach(child => {
    values.push(...collectFakeDomAttributeValues(child, attributeName));
  });

  return values;
};

interface CapturedWorkspaceAiKnowledgePanelProps {
  workspaceId: string;
  profileRevision: number;
  profile: EnterpriseLeadWorkspaceProfile;
  onMetricsChange?: (metrics: KnowledgeFactMetrics) => void;
  onMaintainCompany: () => void;
  onProjectionRefresh?: (input: {
    workspaceId: string;
    profileRevision: number;
  }) => Promise<void> | void;
}

interface CapturedWorkspaceKnowledgeDocumentsPanelProps {
  workspaceId: string;
  initialImportResult?: KnowledgeImportBatchResult;
  onDocumentCountChange: (count: number) => void;
  onWorkspaceProjectionChange: () => Promise<void> | void;
  onAiKnowledgeMetricsRefresh?: () => Promise<void> | void;
}

type KnowledgeBaseServiceApi = typeof import('../../services/knowledgeBase').knowledgeBaseService;

interface WorkspaceKnowledgeBaseMountHarness {
  ReactInner: typeof React;
  container: FakeDomElement;
  aiPanelProps: () => CapturedWorkspaceAiKnowledgePanelProps | null;
  documentPanelProps: () => CapturedWorkspaceKnowledgeDocumentsPanelProps | null;
  service: typeof enterpriseLeadWorkspaceService;
  knowledgeBaseService: KnowledgeBaseServiceApi;
  translate: (key: string) => string;
  render: (
    workspace: EnterpriseLeadWorkspace,
    onWorkspaceUpdated?: (workspace: EnterpriseLeadWorkspace) => void,
    onLayout?: () => void,
  ) => Promise<void>;
  startSuspendedRender: (
    workspace: EnterpriseLeadWorkspace,
    suspension: Promise<unknown>,
    onWorkspaceUpdated?: (workspace: EnterpriseLeadWorkspace) => void,
  ) => Promise<void>;
  cleanup: () => Promise<void>;
}

const mountIsolatedWorkspaceKnowledgeBase = async (input: {
  workspace: EnterpriseLeadWorkspace;
  initialImportResult?: KnowledgeImportBatchResult;
  onWorkspaceUpdated?: (workspace: EnterpriseLeadWorkspace) => void;
  configureService?: (service: typeof enterpriseLeadWorkspaceService) => void;
  configureKnowledgeBaseService?: (service: KnowledgeBaseServiceApi) => void;
  strictMode?: boolean;
}): Promise<WorkspaceKnowledgeBaseMountHarness> => {
  await vi.resetModules();
  const restoreDom = installFakeDom();
  const ReactInner = await import('react');
  const { createRoot } = await import('react-dom/client');
  let capturedAiPanelProps: CapturedWorkspaceAiKnowledgePanelProps | null = null;
  let capturedDocumentPanelProps: CapturedWorkspaceKnowledgeDocumentsPanelProps | null = null;

  vi.doMock('./WorkspaceKnowledgeDocumentsPanel', () => {
    const ControlledWorkspaceKnowledgeDocumentsPanel = (
      props: CapturedWorkspaceKnowledgeDocumentsPanelProps,
    ): React.ReactElement => {
      ReactInner.useLayoutEffect(() => {
        capturedDocumentPanelProps = props;
      }, [props]);
      return ReactInner.createElement('div', { 'data-testid': 'controlled-document-panel' });
    };
    return {
      default: ControlledWorkspaceKnowledgeDocumentsPanel,
      workspaceKnowledgeUploadButtonSlotId: 'enterprise-knowledge-upload-slot',
    };
  });
  vi.doMock('./WorkspaceAiKnowledgePanel', () => {
    const ControlledWorkspaceAiKnowledgePanel = (
      props: CapturedWorkspaceAiKnowledgePanelProps,
    ): React.ReactElement => {
      ReactInner.useLayoutEffect(() => {
        capturedAiPanelProps = props;
      }, [props]);
      const [privateFilter, setPrivateFilter] = ReactInner.useState('active');
      return ReactInner.createElement(
        'section',
        { 'data-testid': 'controlled-ai-panel' },
        ReactInner.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'controlled-ai-maintain-company',
            onClick: props.onMaintainCompany,
          },
          'controlled-maintain-company',
        ),
        ReactInner.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'controlled-ai-private-history',
            onClick: () => setPrivateFilter('history'),
          },
          'controlled-private-history',
        ),
        ReactInner.createElement(
          'span',
          { 'data-testid': 'controlled-ai-private-filter' },
          privateFilter,
        ),
      );
    };
    return {
      default: ControlledWorkspaceAiKnowledgePanel,
      WorkspaceAiKnowledgePanel: ControlledWorkspaceAiKnowledgePanel,
    };
  });

  const enterpriseLeadWorkspaceModule = await import('../../services/enterpriseLeadWorkspace');
  const knowledgeBaseModule = await import('../../services/knowledgeBase');
  const i18nModule = await import('../../services/i18n');
  input.configureKnowledgeBaseService?.(knowledgeBaseModule.knowledgeBaseService);
  const { WorkspaceKnowledgeBase: IsolatedWorkspaceKnowledgeBase } =
    await import('./WorkspaceKnowledgeBase');
  const service = enterpriseLeadWorkspaceModule.enterpriseLeadWorkspaceService;
  vi.spyOn(service, 'getRun').mockResolvedValue(null);
  input.configureService?.(service);
  const container = document.createElement('div') as unknown as FakeDomElement;
  const root = createRoot(container as unknown as Element);
  let renderGeneration = 0;
  const SuspendAfterWorkspaceKnowledgeBase = (props: {
    suspension?: Promise<unknown>;
  }): React.ReactElement | null => {
    if (props.suspension) {
      throw props.suspension;
    }
    return null;
  };
  const RootHarness = (props: {
    workspace: EnterpriseLeadWorkspace;
    onWorkspaceUpdated?: (workspace: EnterpriseLeadWorkspace) => void;
    onLayout?: () => void;
    generation: number;
    suspension?: Promise<unknown>;
  }): React.ReactElement => {
    ReactInner.useLayoutEffect(() => {
      props.onLayout?.();
    }, [props.generation, props.onLayout]);
    return ReactInner.createElement(
      ReactInner.Suspense,
      {
        fallback: ReactInner.createElement('div', {
          'data-testid': 'workspace-knowledge-suspense-fallback',
        }),
      },
      ReactInner.createElement(IsolatedWorkspaceKnowledgeBase, {
        workspace: props.workspace,
        initialImportResult: input.initialImportResult,
        onWorkspaceUpdated: props.onWorkspaceUpdated,
      }),
      ReactInner.createElement(SuspendAfterWorkspaceKnowledgeBase, {
        suspension: props.suspension,
      }),
    );
  };
  const createRootHarnessElement = (
    props: React.ComponentProps<typeof RootHarness>,
  ): React.ReactElement => {
    const element = ReactInner.createElement(RootHarness, props);
    return input.strictMode
      ? ReactInner.createElement(ReactInner.StrictMode, null, element)
      : element;
  };

  const render = async (
    workspace: EnterpriseLeadWorkspace,
    onWorkspaceUpdated = input.onWorkspaceUpdated,
    onLayout?: () => void,
  ): Promise<void> => {
    renderGeneration += 1;
    await ReactInner.act(async () => {
      root.render(
        createRootHarnessElement({
          workspace,
          onWorkspaceUpdated,
          onLayout,
          generation: renderGeneration,
        }),
      );
      await Promise.resolve();
    });
  };

  const startSuspendedRender = async (
    workspace: EnterpriseLeadWorkspace,
    suspension: Promise<unknown>,
    onWorkspaceUpdated = input.onWorkspaceUpdated,
  ): Promise<void> => {
    renderGeneration += 1;
    await ReactInner.act(async () => {
      ReactInner.startTransition(() => {
        root.render(
          createRootHarnessElement({
            workspace,
            onWorkspaceUpdated,
            generation: renderGeneration,
            suspension,
          }),
        );
      });
      await Promise.resolve();
    });
  };

  await render(input.workspace, input.onWorkspaceUpdated);

  return {
    ReactInner,
    container,
    aiPanelProps: () => capturedAiPanelProps,
    documentPanelProps: () => capturedDocumentPanelProps,
    service,
    knowledgeBaseService: knowledgeBaseModule.knowledgeBaseService,
    translate: key => i18nModule.i18nService.t(key),
    render,
    startSuspendedRender,
    cleanup: async () => {
      await ReactInner.act(async () => {
        root.unmount();
      });
      vi.doUnmock('./WorkspaceKnowledgeDocumentsPanel');
      vi.doUnmock('./WorkspaceAiKnowledgePanel');
      restoreDom();
      await vi.resetModules();
    },
  };
};

const getFakeDomElementByTestId = (root: FakeDomNode, testId: string): FakeDomElement | null =>
  findFakeDomElement(root, element => element.getAttribute('data-testid') === testId);

const getKnowledgeMetricButton = (root: FakeDomNode, label: string): FakeDomElement | null =>
  findFakeDomElement(
    root,
    element => element.tagName.toLowerCase() === 'button' && element.textContent.includes(label),
  );

const getKnowledgeMetricValue = (root: FakeDomNode, label: string): string => {
  const button = getKnowledgeMetricButton(root, label);
  const value = button?.childNodes.find(
    node => node instanceof FakeDomElement && node.tagName.toLowerCase() === 'p',
  );
  return value?.textContent ?? '';
};

const automaticVectorFailureCases = [
  { label: 'a rejected request', outcome: 'reject' },
  { label: 'a null response', outcome: 'null' },
  { label: 'a wrong-workspace response', outcome: 'wrong_workspace' },
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enterprise lead workspace UI helpers', () => {
  test('keeps committed extraction callbacks when replacement callbacks render but never commit', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div') as unknown as FakeDomElement;
    const root = createRoot(container as unknown as Element);
    const oldSend = vi.fn(async () => undefined);
    const oldClose = vi.fn();
    const abortedSend = vi.fn(async () => undefined);
    const abortedClose = vi.fn();
    const preparation: KnowledgeExtractionAuthorizationPreparation = {
      authorizationToken: 'single-use-token',
      descriptor: {
        workspaceId: 'workspace-committed',
        documentId: 'document-committed',
        documentVersionId: 'version-committed',
        documentDisplayName: 'Committed.pdf',
        providerId: 'provider-private-id',
        providerLabel: 'Provider',
        modelId: 'model-private-id',
        modelLabel: 'Model',
        plannedModelCalls: 1,
        partial: false,
        expiresAt: '2026-07-14T00:00:00.000Z',
      },
    };
    const prepare = vi.fn(async () => preparation);
    const permanentSuspension = new Promise<void>(() => undefined);
    const SuspendAfterDialog = ({ suspension }: { suspension?: Promise<void> }): null => {
      if (suspension) {
        throw suspension;
      }
      return null;
    };
    const renderDialog = (
      send: (authorizationToken: string) => Promise<void>,
      onClose: () => void,
      suspension?: Promise<void>,
    ): React.ReactElement =>
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(
          React.Suspense,
          { fallback: null },
          React.createElement(WorkspaceKnowledgeExtractionDialog, {
            prepare,
            send,
            onClose,
          }),
          React.createElement(SuspendAfterDialog, { suspension }),
        ),
      );

    try {
      await React.act(async () => {
        root.render(renderDialog(oldSend, oldClose));
        for (let index = 0; index < 8; index += 1) {
          await Promise.resolve();
        }
      });
      const sendButton = getFakeDomElementByTestId(container, 'knowledge-extraction-send');
      expect(sendButton).not.toBeNull();

      await React.act(async () => {
        React.startTransition(() => {
          root.render(renderDialog(abortedSend, abortedClose, permanentSuspension));
        });
        await Promise.resolve();
      });
      await React.act(async () => {
        sendButton?.click();
        for (let index = 0; index < 4; index += 1) {
          await Promise.resolve();
        }
      });

      expect(abortedSend).not.toHaveBeenCalled();
      expect(abortedClose).not.toHaveBeenCalled();
      expect(oldSend).toHaveBeenCalledTimes(1);
      expect(oldSend).toHaveBeenCalledWith('single-use-token');
      expect(oldClose).toHaveBeenCalledTimes(1);
    } finally {
      await React.act(async () => {
        root.unmount();
      });
      restoreDom();
    }
  });

  test('uses replacement extraction callbacks after those props commit', async () => {
    const restoreDom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div') as unknown as FakeDomElement;
    const root = createRoot(container as unknown as Element);
    const oldSend = vi.fn(async () => undefined);
    const oldClose = vi.fn();
    const committedSend = vi.fn(async () => undefined);
    const committedClose = vi.fn();
    const prepare = vi.fn(async (): Promise<KnowledgeExtractionAuthorizationPreparation> => ({
      authorizationToken: 'single-use-token',
      descriptor: {
        workspaceId: 'workspace-committed',
        documentId: 'document-committed',
        documentVersionId: 'version-committed',
        documentDisplayName: 'Committed.pdf',
        providerId: 'provider-private-id',
        providerLabel: 'Provider',
        modelId: 'model-private-id',
        modelLabel: 'Model',
        plannedModelCalls: 1,
        partial: false,
        expiresAt: '2026-07-14T00:00:00.000Z',
      },
    }));
    const renderDialog = (
      send: (authorizationToken: string) => Promise<void>,
      onClose: () => void,
    ): React.ReactElement =>
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(WorkspaceKnowledgeExtractionDialog, {
          prepare,
          send,
          onClose,
        }),
      );

    try {
      await React.act(async () => {
        root.render(renderDialog(oldSend, oldClose));
        for (let index = 0; index < 8; index += 1) {
          await Promise.resolve();
        }
      });
      await React.act(async () => {
        root.render(renderDialog(committedSend, committedClose));
        await Promise.resolve();
      });
      const sendButton = getFakeDomElementByTestId(container, 'knowledge-extraction-send');
      expect(sendButton).not.toBeNull();

      await React.act(async () => {
        sendButton?.click();
        for (let index = 0; index < 4; index += 1) {
          await Promise.resolve();
        }
      });

      expect(oldSend).not.toHaveBeenCalled();
      expect(oldClose).not.toHaveBeenCalled();
      expect(committedSend).toHaveBeenCalledTimes(1);
      expect(committedSend).toHaveBeenCalledWith('single-use-token');
      expect(committedClose).toHaveBeenCalledTimes(1);
    } finally {
      await React.act(async () => {
        root.unmount();
      });
      restoreDom();
    }
  });

  test('composes the real parent branches and routes the mounted AI maintain button to company editing', async () => {
    const workspace = {
      ...createWorkspace('workspace-integration'),
      profile: {
        ...emptyProfile(),
        productList: ['Legacy product'],
      },
      profileRevision: 4,
    };
    const initialImportResult: KnowledgeImportBatchResult = {
      importedCount: 1,
      failedCount: 0,
      items: [],
    };
    const harness = await mountIsolatedWorkspaceKnowledgeBase({
      workspace,
      initialImportResult,
    });

    try {
      expect(
        getFakeDomElementByTestId(harness.container, 'controlled-document-panel'),
      ).not.toBeNull();
      expect(getFakeDomElementByTestId(harness.container, 'controlled-ai-panel')).toBeNull();
      expect(harness.documentPanelProps()).toMatchObject({
        workspaceId: workspace.id,
        initialImportResult,
        onDocumentCountChange: expect.any(Function),
        onWorkspaceProjectionChange: expect.any(Function),
      });

      const aiTab = getKnowledgeMetricButton(
        harness.container,
        harness.translate('enterpriseLeadKnowledgeAiKnowledgeTitle'),
      );
      expect(aiTab).not.toBeNull();
      await harness.ReactInner.act(async () => {
        aiTab?.click();
      });

      const aiProps = harness.aiPanelProps();
      expect(aiProps).toMatchObject({
        workspaceId: workspace.id,
        profileRevision: workspace.profileRevision,
        profile: workspace.profile,
        onMetricsChange: expect.any(Function),
        onMaintainCompany: expect.any(Function),
        onProjectionRefresh: expect.any(Function),
      });
      expect(aiProps?.profile).toBe(workspace.profile);
      expect(getFakeDomElementByTestId(harness.container, 'controlled-ai-panel')).not.toBeNull();
      expect(
        findFakeDomElements(
          harness.container,
          element => element.tagName.toLowerCase() === 'input',
        ),
      ).toEqual([]);
      expect(harness.container.textContent).not.toContain(
        harness.translate('enterpriseLeadKnowledgeAddContent'),
      );

      const privateHistory = getFakeDomElementByTestId(
        harness.container,
        'controlled-ai-private-history',
      );
      await harness.ReactInner.act(async () => {
        privateHistory?.click();
      });
      const pendingCard = getKnowledgeMetricButton(
        harness.container,
        harness.translate('enterpriseLeadKnowledgePendingMetric'),
      );
      await harness.ReactInner.act(async () => {
        pendingCard?.click();
      });
      expect(
        getFakeDomElementByTestId(harness.container, 'controlled-ai-private-filter')?.textContent,
      ).toBe('history');
      const confirmedCard = getKnowledgeMetricButton(
        harness.container,
        harness.translate('enterpriseLeadKnowledgeConfirmedMetric'),
      );
      await harness.ReactInner.act(async () => {
        confirmedCard?.click();
      });
      expect(
        getFakeDomElementByTestId(harness.container, 'controlled-ai-private-filter')?.textContent,
      ).toBe('history');

      const maintainCompany = getFakeDomElementByTestId(
        harness.container,
        'controlled-ai-maintain-company',
      );
      expect(maintainCompany).not.toBeNull();
      await harness.ReactInner.act(async () => {
        maintainCompany?.click();
      });
      expect(
        findFakeDomElement(
          harness.container,
          element => element.tagName.toLowerCase() === 'textarea',
        ),
      ).not.toBeNull();
      expect(harness.container.textContent).toContain(
        harness.translate('enterpriseLeadKnowledgeCompanyModalTitle'),
      );
    } finally {
      await harness.cleanup();
    }
  });

  test('refreshes top AI metrics from a completed document extraction without opening the AI view', async () => {
    const workspace = {
      ...createWorkspace('workspace-document-metrics-refresh'),
      profileRevision: 4,
    };
    const refreshedMetrics: KnowledgeFactMetrics = {
      activePendingCount: 17,
      activeConfirmedCount: 0,
      staleConfirmedCount: 0,
      rejectedHistoryCount: 0,
      archivedHistoryCount: 0,
      unduplicatedLegacyConfirmedCount: 0,
      totalAiKnowledgeCount: 17,
    };
    let listFacts: ReturnType<typeof vi.fn> | null = null;
    const harness = await mountIsolatedWorkspaceKnowledgeBase({
      workspace,
      configureKnowledgeBaseService: service => {
        listFacts = vi.spyOn(service, 'listFacts').mockResolvedValue({
          items: [],
          nextCursor: null,
          metrics: refreshedMetrics,
        });
      },
    });

    try {
      expect(getFakeDomElementByTestId(harness.container, 'controlled-ai-panel')).toBeNull();
      const refreshMetrics = harness.documentPanelProps()?.onAiKnowledgeMetricsRefresh;
      expect(refreshMetrics).toEqual(expect.any(Function));

      await harness.ReactInner.act(async () => {
        await refreshMetrics?.();
      });

      expect(listFacts).toHaveBeenCalledWith({
        workspaceId: workspace.id,
        limit: 1,
      });
      expect(
        getKnowledgeMetricValue(
          harness.container,
          harness.translate('enterpriseLeadKnowledgeAiKnowledgeMetric'),
        ),
      ).toBe('17');
      expect(
        getKnowledgeMetricValue(
          harness.container,
          harness.translate('enterpriseLeadKnowledgePendingMetric'),
        ),
      ).toBe('17');
      expect(getFakeDomElementByTestId(harness.container, 'controlled-ai-panel')).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });

  test('owns backend AI metrics by workspace, revision, and render generation before passive effects', async () => {
    const workspaceA = {
      ...createWorkspace('workspace-metrics-a'),
      profileRevision: 4,
    };
    const workspaceB = {
      ...createWorkspace('workspace-metrics-b'),
      profileRevision: 4,
    };
    const harness = await mountIsolatedWorkspaceKnowledgeBase({ workspace: workspaceA });
    const metrics = (overrides: Partial<KnowledgeFactMetrics> = {}): KnowledgeFactMetrics => ({
      activePendingCount: 1,
      activeConfirmedCount: 2,
      staleConfirmedCount: 3,
      rejectedHistoryCount: 4,
      archivedHistoryCount: 5,
      unduplicatedLegacyConfirmedCount: 6,
      totalAiKnowledgeCount: 7,
      ...overrides,
    });
    const aiLabel = harness.translate('enterpriseLeadKnowledgeAiKnowledgeMetric');
    const pendingLabel = harness.translate('enterpriseLeadKnowledgePendingMetric');
    const confirmedLabel = harness.translate('enterpriseLeadKnowledgeConfirmedMetric');
    const documentLabel = harness.translate('enterpriseLeadKnowledgeDocumentMetric');

    try {
      const aiTab = getKnowledgeMetricButton(
        harness.container,
        harness.translate('enterpriseLeadKnowledgeAiKnowledgeTitle'),
      );
      await harness.ReactInner.act(async () => {
        aiTab?.click();
      });
      const firstAiProps = harness.aiPanelProps();
      expect(firstAiProps?.onMetricsChange).toEqual(expect.any(Function));
      await harness.ReactInner.act(async () => {
        harness.documentPanelProps()?.onDocumentCountChange(19);
        firstAiProps?.onMetricsChange?.(metrics());
      });
      expect(getKnowledgeMetricValue(harness.container, documentLabel)).toBe('19');
      expect(getKnowledgeMetricValue(harness.container, aiLabel)).toBe('7');
      expect(getKnowledgeMetricValue(harness.container, pendingLabel)).toBe('1');
      expect(getKnowledgeMetricValue(harness.container, confirmedLabel)).toBe('11');

      await harness.ReactInner.act(async () => {
        firstAiProps?.onMetricsChange?.(
          metrics({
            activePendingCount: 8,
            activeConfirmedCount: 13,
            staleConfirmedCount: 21,
            unduplicatedLegacyConfirmedCount: 34,
            totalAiKnowledgeCount: 55,
          }),
        );
      });
      expect(getKnowledgeMetricValue(harness.container, documentLabel)).toBe('19');
      expect(getKnowledgeMetricValue(harness.container, aiLabel)).toBe('55');
      expect(getKnowledgeMetricValue(harness.container, pendingLabel)).toBe('8');
      expect(getKnowledgeMetricValue(harness.container, confirmedLabel)).toBe('68');

      let workspaceBPrePassive: string[] = [];
      await harness.render(workspaceB, undefined, () => {
        workspaceBPrePassive = [
          getKnowledgeMetricValue(harness.container, aiLabel),
          getKnowledgeMetricValue(harness.container, pendingLabel),
          getKnowledgeMetricValue(harness.container, confirmedLabel),
        ];
      });
      expect(workspaceBPrePassive).toEqual(['0', '0', '0']);
      await harness.ReactInner.act(async () => {
        firstAiProps?.onMetricsChange?.(metrics({ totalAiKnowledgeCount: 89 }));
      });
      expect(getKnowledgeMetricValue(harness.container, aiLabel)).toBe('0');

      const workspaceBRevision4Props = harness.aiPanelProps();
      await harness.ReactInner.act(async () => {
        workspaceBRevision4Props?.onMetricsChange?.(metrics({ totalAiKnowledgeCount: 144 }));
      });
      expect(getKnowledgeMetricValue(harness.container, aiLabel)).toBe('144');
      expect(getKnowledgeMetricValue(harness.container, documentLabel)).toBe('19');

      const workspaceBRevision5 = {
        ...workspaceB,
        profileRevision: 5,
        updatedAt: '2026-07-04T05:00:00.000Z',
      };
      let revision5PrePassive: string[] = [];
      await harness.render(workspaceBRevision5, undefined, () => {
        revision5PrePassive = [
          getKnowledgeMetricValue(harness.container, aiLabel),
          getKnowledgeMetricValue(harness.container, pendingLabel),
          getKnowledgeMetricValue(harness.container, confirmedLabel),
        ];
      });
      expect(revision5PrePassive).toEqual(['0', '0', '0']);
      await harness.ReactInner.act(async () => {
        workspaceBRevision4Props?.onMetricsChange?.(metrics({ totalAiKnowledgeCount: 233 }));
      });
      expect(getKnowledgeMetricValue(harness.container, aiLabel)).toBe('0');
      const revision5Props = harness.aiPanelProps();
      await harness.ReactInner.act(async () => {
        revision5Props?.onMetricsChange?.(metrics({ totalAiKnowledgeCount: 377 }));
      });
      expect(getKnowledgeMetricValue(harness.container, aiLabel)).toBe('377');
      expect(getKnowledgeMetricValue(harness.container, documentLabel)).toBe('19');
    } finally {
      await harness.cleanup();
    }
  });

  test('keeps committed workspace metrics owned when a transition renders another workspace but suspends before commit', async () => {
    const workspaceA = {
      ...createWorkspace('workspace-suspended-metrics-a'),
      profileRevision: 4,
    };
    const workspaceB = {
      ...createWorkspace('workspace-suspended-metrics-b'),
      profileRevision: 4,
    };
    const harness = await mountIsolatedWorkspaceKnowledgeBase({ workspace: workspaceA });
    const metrics = (totalAiKnowledgeCount: number): KnowledgeFactMetrics => ({
      activePendingCount: 1,
      activeConfirmedCount: 2,
      staleConfirmedCount: 3,
      rejectedHistoryCount: 4,
      archivedHistoryCount: 5,
      unduplicatedLegacyConfirmedCount: 6,
      totalAiKnowledgeCount,
    });
    const aiLabel = harness.translate('enterpriseLeadKnowledgeAiKnowledgeMetric');
    const suspendedRender = createDeferred<void>();

    try {
      await harness.ReactInner.act(async () => {
        getKnowledgeMetricButton(
          harness.container,
          harness.translate('enterpriseLeadKnowledgeAiKnowledgeTitle'),
        )?.click();
      });
      const initialAiProps = harness.aiPanelProps();
      expect(initialAiProps).toMatchObject({
        workspaceId: workspaceA.id,
        profileRevision: workspaceA.profileRevision,
      });
      await harness.ReactInner.act(async () => {
        initialAiProps?.onMetricsChange?.(metrics(7));
      });
      expect(getKnowledgeMetricValue(harness.container, aiLabel)).toBe('7');
      const committedAiProps = harness.aiPanelProps();

      await harness.startSuspendedRender(workspaceB, suspendedRender.promise);
      expect(harness.aiPanelProps()).toBe(committedAiProps);
      expect(
        getFakeDomElementByTestId(harness.container, 'workspace-knowledge-suspense-fallback'),
      ).toBeNull();

      await harness.ReactInner.act(async () => {
        committedAiProps?.onMetricsChange?.(metrics(41));
      });
      expect(getKnowledgeMetricValue(harness.container, aiLabel)).toBe('41');
    } finally {
      await harness.cleanup();
    }
  });

  test('keeps a committed workspace AI reload current when another workspace render suspends before commit', async () => {
    const workspaceA = {
      ...createWorkspace('workspace-suspended-reload-a'),
      profileRevision: 4,
    };
    const workspaceB = {
      ...createWorkspace('workspace-suspended-reload-b'),
      profileRevision: 4,
    };
    const refreshedWorkspaceA: EnterpriseLeadWorkspace = {
      ...workspaceA,
      name: 'Accepted suspended-render refresh',
      updatedAt: '2026-07-04T04:30:00.000Z',
    };
    const onWorkspaceUpdated = vi.fn();
    const harness = await mountIsolatedWorkspaceKnowledgeBase({
      workspace: workspaceA,
      onWorkspaceUpdated,
    });
    const pendingWorkspace = createDeferred<EnterpriseLeadWorkspace | null>();
    const suspendedRender = createDeferred<void>();

    try {
      await harness.ReactInner.act(async () => {
        getKnowledgeMetricButton(
          harness.container,
          harness.translate('enterpriseLeadKnowledgeAiKnowledgeTitle'),
        )?.click();
      });
      const committedAiProps = harness.aiPanelProps();
      const getWorkspace = vi
        .spyOn(harness.service, 'getWorkspace')
        .mockReturnValueOnce(pendingWorkspace.promise);
      const pendingRefresh = committedAiProps?.onProjectionRefresh?.({
        workspaceId: workspaceA.id,
        profileRevision: workspaceA.profileRevision,
      });

      await harness.startSuspendedRender(workspaceB, suspendedRender.promise, onWorkspaceUpdated);
      expect(harness.aiPanelProps()).toBe(committedAiProps);
      await harness.ReactInner.act(async () => {
        pendingWorkspace.resolve(refreshedWorkspaceA);
        await pendingRefresh;
      });

      expect(getWorkspace).toHaveBeenCalledWith(workspaceA.id);
      expect(onWorkspaceUpdated).toHaveBeenCalledTimes(1);
      expect(onWorkspaceUpdated).toHaveBeenCalledWith(refreshedWorkspaceA);
    } finally {
      await harness.cleanup();
    }
  });

  test('keeps an in-flight profile save owned when another workspace render suspends before commit', async () => {
    const workspaceA: EnterpriseLeadWorkspace = {
      ...createWorkspace('workspace-suspended-save-a'),
      profile: {
        ...emptyProfile(),
        companySummary: 'Original company summary',
      },
      profileRevision: 4,
    };
    const workspaceB = {
      ...createWorkspace('workspace-suspended-save-b'),
      profileRevision: 4,
    };
    const savedWorkspaceA: EnterpriseLeadWorkspace = {
      ...workspaceA,
      profile: {
        ...workspaceA.profile,
        companySummary: 'Saved company summary',
      },
      profileRevision: 5,
      updatedAt: '2026-07-04T05:00:00.000Z',
    };
    const onWorkspaceUpdated = vi.fn();
    const harness = await mountIsolatedWorkspaceKnowledgeBase({
      workspace: workspaceA,
      onWorkspaceUpdated,
    });
    const pendingSave = createDeferred<EnterpriseLeadWorkspace | null>();
    const suspendedRender = createDeferred<void>();

    try {
      await harness.ReactInner.act(async () => {
        getKnowledgeMetricButton(
          harness.container,
          harness.translate('enterpriseLeadKnowledgeAiKnowledgeTitle'),
        )?.click();
      });
      await harness.ReactInner.act(async () => {
        getFakeDomElementByTestId(harness.container, 'controlled-ai-maintain-company')?.click();
      });
      const companyTextarea = findFakeDomElement(
        harness.container,
        element => element.tagName.toLowerCase() === 'textarea',
      );
      expect(companyTextarea).not.toBeNull();
      await harness.ReactInner.act(async () => {
        companyTextarea?.input('Saved company summary');
      });
      const updateWorkspaceProfile = vi
        .spyOn(harness.service, 'updateWorkspaceProfile')
        .mockReturnValueOnce(pendingSave.promise);
      const saveButton = findFakeDomElement(
        harness.container,
        element =>
          element.tagName.toLowerCase() === 'button' &&
          element.textContent.includes(harness.translate('enterpriseLeadKnowledgeSaveAction')),
      );
      expect(saveButton).not.toBeNull();
      await harness.ReactInner.act(async () => {
        saveButton?.click();
        await Promise.resolve();
      });
      expect(updateWorkspaceProfile).toHaveBeenCalledTimes(1);

      await harness.startSuspendedRender(workspaceB, suspendedRender.promise, onWorkspaceUpdated);
      await harness.ReactInner.act(async () => {
        pendingSave.resolve(savedWorkspaceA);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onWorkspaceUpdated).toHaveBeenCalledTimes(1);
      expect(onWorkspaceUpdated).toHaveBeenCalledWith(savedWorkspaceA);
    } finally {
      await harness.cleanup();
    }
  });

  test('lets only the first same-revision document or AI reload publish across both seams', async () => {
    const workspace = {
      ...createWorkspace('workspace-cross-seam-reload'),
      profileRevision: 4,
    };
    const firstDocumentWorkspace: EnterpriseLeadWorkspace = {
      ...workspace,
      profile: {
        ...workspace.profile,
        companySummary: 'First document reload snapshot',
      },
      updatedAt: '2026-07-04T04:10:00.000Z',
    };
    const staleAiWorkspace: EnterpriseLeadWorkspace = {
      ...workspace,
      profile: {
        ...workspace.profile,
        companySummary: 'Stale AI reload snapshot',
      },
      updatedAt: '2026-07-04T04:20:00.000Z',
    };
    const onWorkspaceUpdated = vi.fn();
    const harness = await mountIsolatedWorkspaceKnowledgeBase({
      workspace,
      onWorkspaceUpdated,
    });
    const pendingDocumentWorkspace = createDeferred<EnterpriseLeadWorkspace | null>();
    const pendingAiWorkspace = createDeferred<EnterpriseLeadWorkspace | null>();

    try {
      const getWorkspace = vi
        .spyOn(harness.service, 'getWorkspace')
        .mockReturnValueOnce(pendingDocumentWorkspace.promise)
        .mockReturnValueOnce(pendingAiWorkspace.promise);
      const pendingDocumentRefresh = harness.documentPanelProps()?.onWorkspaceProjectionChange();
      await harness.ReactInner.act(async () => {
        getKnowledgeMetricButton(
          harness.container,
          harness.translate('enterpriseLeadKnowledgeAiKnowledgeTitle'),
        )?.click();
      });
      const pendingAiRefresh = harness.aiPanelProps()?.onProjectionRefresh?.({
        workspaceId: workspace.id,
        profileRevision: workspace.profileRevision,
      });
      expect(getWorkspace).toHaveBeenCalledTimes(2);

      await harness.ReactInner.act(async () => {
        pendingDocumentWorkspace.resolve(firstDocumentWorkspace);
        await pendingDocumentRefresh;
      });
      expect(onWorkspaceUpdated).toHaveBeenCalledTimes(1);
      expect(onWorkspaceUpdated).toHaveBeenLastCalledWith(firstDocumentWorkspace);
      expect(harness.aiPanelProps()?.profile.companySummary).toBe(
        firstDocumentWorkspace.profile.companySummary,
      );

      await harness.ReactInner.act(async () => {
        pendingAiWorkspace.resolve(staleAiWorkspace);
        await pendingAiRefresh;
      });
      expect(onWorkspaceUpdated).toHaveBeenCalledTimes(1);
      expect(onWorkspaceUpdated).not.toHaveBeenCalledWith(staleAiWorkspace);
      expect(harness.aiPanelProps()?.profile.companySummary).toBe(
        firstDocumentWorkspace.profile.companySummary,
      );
    } finally {
      await harness.cleanup();
    }
  });

  test('rejects an older document settlement after a profile publication advances workspace ownership', async () => {
    const workspace: EnterpriseLeadWorkspace = {
      ...createWorkspace('workspace-profile-publication-race'),
      profile: {
        ...emptyProfile(),
        companySummary: 'Original company summary',
      },
      profileRevision: 4,
    };
    const savedWorkspace: EnterpriseLeadWorkspace = {
      ...workspace,
      profile: {
        ...workspace.profile,
        companySummary: 'Saved company summary',
      },
      profileRevision: 5,
      updatedAt: '2026-07-04T05:00:00.000Z',
    };
    const staleDocumentWorkspace: EnterpriseLeadWorkspace = {
      ...workspace,
      profileRevision: 5,
      updatedAt: '2026-07-04T04:30:00.000Z',
    };
    const onWorkspaceUpdated = vi.fn();
    const harness = await mountIsolatedWorkspaceKnowledgeBase({
      workspace,
      onWorkspaceUpdated,
    });
    const pendingDocumentWorkspace = createDeferred<EnterpriseLeadWorkspace | null>();

    try {
      vi.spyOn(harness.service, 'getWorkspace').mockReturnValueOnce(
        pendingDocumentWorkspace.promise,
      );
      const pendingDocumentRefresh = harness.documentPanelProps()?.onWorkspaceProjectionChange();

      await harness.ReactInner.act(async () => {
        getKnowledgeMetricButton(
          harness.container,
          harness.translate('enterpriseLeadKnowledgeAiKnowledgeTitle'),
        )?.click();
      });
      await harness.ReactInner.act(async () => {
        getFakeDomElementByTestId(harness.container, 'controlled-ai-maintain-company')?.click();
      });
      const companyTextarea = findFakeDomElement(
        harness.container,
        element => element.tagName.toLowerCase() === 'textarea',
      );
      await harness.ReactInner.act(async () => {
        companyTextarea?.input('Saved company summary');
      });
      vi.spyOn(harness.service, 'updateWorkspaceProfile').mockResolvedValueOnce(savedWorkspace);
      const saveButton = findFakeDomElement(
        harness.container,
        element =>
          element.tagName.toLowerCase() === 'button' &&
          element.textContent.includes(harness.translate('enterpriseLeadKnowledgeSaveAction')),
      );
      await harness.ReactInner.act(async () => {
        saveButton?.click();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(onWorkspaceUpdated).toHaveBeenCalledTimes(1);
      expect(onWorkspaceUpdated).toHaveBeenLastCalledWith(savedWorkspace);

      await harness.ReactInner.act(async () => {
        pendingDocumentWorkspace.resolve(staleDocumentWorkspace);
        await pendingDocumentRefresh;
      });
      expect(onWorkspaceUpdated).toHaveBeenCalledTimes(1);
      expect(harness.aiPanelProps()?.profile.companySummary).toBe(
        savedWorkspace.profile.companySummary,
      );
    } finally {
      await harness.cleanup();
    }
  });

  test('publishes a deferred automatic vector sync once and releases syncing for the next key', async () => {
    const source = {
      id: 'vector-source-a',
      kind: EnterpriseLeadExtractionSourceKind.File,
      label: 'vector-source-a.pdf',
      text: 'Searchable source text',
      extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
      vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
      updatedAt: '2026-07-04T04:00:00.000Z',
    };
    const workspace: EnterpriseLeadWorkspace = {
      ...createWorkspace('workspace-automatic-vector-sync'),
      extractionSources: [source],
      profileRevision: 4,
    };
    const indexedWorkspace: EnterpriseLeadWorkspace = {
      ...workspace,
      extractionSources: [
        {
          ...source,
          vectorChunkCount: 1,
          vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexed,
          updatedAt: '2026-07-04T04:10:00.000Z',
        },
      ],
      updatedAt: '2026-07-04T04:10:00.000Z',
    };
    const nextSource = {
      ...source,
      id: 'vector-source-b',
      label: 'vector-source-b.pdf',
      text: 'A different searchable source',
      updatedAt: '2026-07-04T05:00:00.000Z',
    };
    const nextWorkspace: EnterpriseLeadWorkspace = {
      ...workspace,
      extractionSources: [nextSource],
      updatedAt: '2026-07-04T05:00:00.000Z',
    };
    const firstSync = createDeferred<EnterpriseLeadWorkspace | null>();
    const secondSync = createDeferred<EnterpriseLeadWorkspace | null>();
    const onWorkspaceUpdated = vi.fn();
    let syncCallCount = 0;
    const harness = await mountIsolatedWorkspaceKnowledgeBase({
      workspace,
      onWorkspaceUpdated,
      strictMode: true,
      configureService: service => {
        vi.spyOn(service, 'updateWorkspaceSources').mockImplementation(() => {
          syncCallCount += 1;
          return syncCallCount === 1 ? firstSync.promise : secondSync.promise;
        });
      },
    });

    try {
      expect(syncCallCount).toBe(1);
      await harness.ReactInner.act(async () => {
        firstSync.resolve(indexedWorkspace);
        await firstSync.promise;
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(onWorkspaceUpdated).toHaveBeenCalledTimes(1);
      expect(onWorkspaceUpdated).toHaveBeenLastCalledWith(indexedWorkspace);
      expect(syncCallCount).toBe(1);

      await harness.render(nextWorkspace, onWorkspaceUpdated);
      expect(syncCallCount).toBe(2);
      expect(onWorkspaceUpdated).toHaveBeenCalledTimes(1);
    } finally {
      await harness.cleanup();
    }
  });

  test('retries the same automatic vector key after a committed revision invalidates its owner', async () => {
    const source = {
      id: 'vector-source-revision',
      kind: EnterpriseLeadExtractionSourceKind.File,
      label: 'vector-source-revision.pdf',
      text: 'Searchable revision source',
      extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
      vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
      updatedAt: '2026-07-04T04:00:00.000Z',
    };
    const workspaceRevision4: EnterpriseLeadWorkspace = {
      ...createWorkspace('workspace-automatic-vector-revision'),
      extractionSources: [source],
      profileRevision: 4,
    };
    const workspaceRevision5: EnterpriseLeadWorkspace = {
      ...workspaceRevision4,
      profileRevision: 5,
      updatedAt: '2026-07-04T05:00:00.000Z',
    };
    const staleIndexedWorkspace: EnterpriseLeadWorkspace = {
      ...workspaceRevision4,
      extractionSources: [
        {
          ...source,
          vectorChunkCount: 1,
          vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexed,
        },
      ],
    };
    const currentIndexedWorkspace: EnterpriseLeadWorkspace = {
      ...workspaceRevision5,
      extractionSources: [
        {
          ...source,
          vectorChunkCount: 1,
          vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexed,
        },
      ],
    };
    const staleSync = createDeferred<EnterpriseLeadWorkspace | null>();
    const currentSync = createDeferred<EnterpriseLeadWorkspace | null>();
    const onWorkspaceUpdated = vi.fn();
    let syncCallCount = 0;
    const harness = await mountIsolatedWorkspaceKnowledgeBase({
      workspace: workspaceRevision4,
      onWorkspaceUpdated,
      configureService: service => {
        vi.spyOn(service, 'updateWorkspaceSources').mockImplementation(() => {
          syncCallCount += 1;
          return syncCallCount === 1 ? staleSync.promise : currentSync.promise;
        });
      },
    });

    try {
      expect(syncCallCount).toBe(1);
      await harness.render(workspaceRevision5, onWorkspaceUpdated);
      expect(syncCallCount).toBe(1);

      await harness.ReactInner.act(async () => {
        staleSync.resolve(staleIndexedWorkspace);
        await staleSync.promise;
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(onWorkspaceUpdated).not.toHaveBeenCalled();
      expect(syncCallCount).toBe(2);

      await harness.ReactInner.act(async () => {
        currentSync.resolve(currentIndexedWorkspace);
        await currentSync.promise;
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(onWorkspaceUpdated).toHaveBeenCalledTimes(1);
      expect(onWorkspaceUpdated).toHaveBeenLastCalledWith(currentIndexedWorkspace);
      expect(syncCallCount).toBe(2);
    } finally {
      await harness.cleanup();
    }
  });

  test.each(automaticVectorFailureCases)(
    'retries the current revision after stale automatic vector owner settles with $label',
    async ({ outcome }) => {
      const source = {
        id: 'vector-source-stale-failure',
        kind: EnterpriseLeadExtractionSourceKind.File,
        label: 'vector-source-stale-failure.pdf',
        text: 'Searchable stale failure source',
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
        updatedAt: '2026-07-04T04:00:00.000Z',
      };
      const workspaceRevision4: EnterpriseLeadWorkspace = {
        ...createWorkspace(`workspace-automatic-vector-stale-${outcome}`),
        extractionSources: [source],
        profileRevision: 4,
      };
      const workspaceRevision5: EnterpriseLeadWorkspace = {
        ...workspaceRevision4,
        profileRevision: 5,
        updatedAt: '2026-07-04T05:00:00.000Z',
      };
      const currentIndexedWorkspace: EnterpriseLeadWorkspace = {
        ...workspaceRevision5,
        extractionSources: [
          {
            ...source,
            vectorChunkCount: 1,
            vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexed,
          },
        ],
      };
      const wrongWorkspace: EnterpriseLeadWorkspace = {
        ...workspaceRevision4,
        id: `wrong-workspace-${outcome}`,
      };
      const staleSync = createDeferred<EnterpriseLeadWorkspace | null>();
      const currentSync = createDeferred<EnterpriseLeadWorkspace | null>();
      const onWorkspaceUpdated = vi.fn();
      let syncCallCount = 0;
      const harness = await mountIsolatedWorkspaceKnowledgeBase({
        workspace: workspaceRevision4,
        onWorkspaceUpdated,
        strictMode: true,
        configureService: service => {
          vi.spyOn(service, 'updateWorkspaceSources').mockImplementation(() => {
            syncCallCount += 1;
            return syncCallCount === 1 ? staleSync.promise : currentSync.promise;
          });
        },
      });

      try {
        expect(syncCallCount).toBe(1);
        await harness.render(workspaceRevision5, onWorkspaceUpdated);
        expect(syncCallCount).toBe(1);

        await harness.ReactInner.act(async () => {
          if (outcome === 'reject') {
            staleSync.reject(new Error('stale automatic vector request failed'));
            await staleSync.promise.catch(() => undefined);
          } else {
            staleSync.resolve(outcome === 'null' ? null : wrongWorkspace);
            await staleSync.promise;
          }
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(onWorkspaceUpdated).not.toHaveBeenCalled();
        expect(syncCallCount).toBe(2);

        await harness.ReactInner.act(async () => {
          currentSync.resolve(currentIndexedWorkspace);
          await currentSync.promise;
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(onWorkspaceUpdated).toHaveBeenCalledTimes(1);
        expect(onWorkspaceUpdated).toHaveBeenLastCalledWith(currentIndexedWorkspace);
        expect(syncCallCount).toBe(2);
      } finally {
        await harness.cleanup();
      }
    },
  );

  test.each(automaticVectorFailureCases)(
    'does not immediately retry current automatic vector owner after $label',
    async ({ outcome }) => {
      const source = {
        id: 'vector-source-current-failure',
        kind: EnterpriseLeadExtractionSourceKind.File,
        label: 'vector-source-current-failure.pdf',
        text: 'Searchable current failure source',
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
      };
      const workspace: EnterpriseLeadWorkspace = {
        ...createWorkspace(`workspace-automatic-vector-current-${outcome}`),
        extractionSources: [source],
        profileRevision: 4,
      };
      const wrongWorkspace: EnterpriseLeadWorkspace = {
        ...workspace,
        id: `wrong-current-workspace-${outcome}`,
      };
      const pendingSync = createDeferred<EnterpriseLeadWorkspace | null>();
      const onWorkspaceUpdated = vi.fn();
      let syncCallCount = 0;
      const harness = await mountIsolatedWorkspaceKnowledgeBase({
        workspace,
        onWorkspaceUpdated,
        strictMode: true,
        configureService: service => {
          vi.spyOn(service, 'updateWorkspaceSources').mockImplementation(() => {
            syncCallCount += 1;
            return pendingSync.promise;
          });
        },
      });

      try {
        expect(syncCallCount).toBe(1);
        await harness.ReactInner.act(async () => {
          if (outcome === 'reject') {
            pendingSync.reject(new Error('current automatic vector request failed'));
            await pendingSync.promise.catch(() => undefined);
          } else {
            pendingSync.resolve(outcome === 'null' ? null : wrongWorkspace);
            await pendingSync.promise;
          }
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(onWorkspaceUpdated).not.toHaveBeenCalled();
        expect(syncCallCount).toBe(1);
      } finally {
        await harness.cleanup();
      }
    },
  );

  test.each(automaticVectorFailureCases)(
    'starts the same-source newer revision after current automatic vector owner settles with $label',
    async ({ outcome }) => {
      const source = {
        id: 'vector-source-current-failure-new-revision',
        kind: EnterpriseLeadExtractionSourceKind.File,
        label: 'vector-source-current-failure-new-revision.pdf',
        text: 'Searchable current failure source for a newer revision',
        extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
        vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
        updatedAt: '2026-07-04T04:00:00.000Z',
      };
      const workspaceRevision4: EnterpriseLeadWorkspace = {
        ...createWorkspace(`workspace-automatic-vector-current-new-revision-${outcome}`),
        extractionSources: [source],
        profileRevision: 4,
      };
      const workspaceRevision5: EnterpriseLeadWorkspace = {
        ...workspaceRevision4,
        profileRevision: 5,
        updatedAt: '2026-07-04T05:00:00.000Z',
      };
      const currentIndexedWorkspace: EnterpriseLeadWorkspace = {
        ...workspaceRevision5,
        extractionSources: [
          {
            ...source,
            vectorChunkCount: 1,
            vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexed,
          },
        ],
      };
      const wrongWorkspace: EnterpriseLeadWorkspace = {
        ...workspaceRevision4,
        id: `wrong-current-new-revision-workspace-${outcome}`,
      };
      const failedSync = createDeferred<EnterpriseLeadWorkspace | null>();
      const currentSync = createDeferred<EnterpriseLeadWorkspace | null>();
      const onWorkspaceUpdated = vi.fn();
      let syncCallCount = 0;
      const harness = await mountIsolatedWorkspaceKnowledgeBase({
        workspace: workspaceRevision4,
        onWorkspaceUpdated,
        strictMode: true,
        configureService: service => {
          vi.spyOn(service, 'updateWorkspaceSources').mockImplementation(() => {
            syncCallCount += 1;
            return syncCallCount === 1 ? failedSync.promise : currentSync.promise;
          });
        },
      });

      try {
        expect(syncCallCount).toBe(1);
        await harness.ReactInner.act(async () => {
          if (outcome === 'reject') {
            failedSync.reject(new Error('current automatic vector request failed before revision'));
            await failedSync.promise.catch(() => undefined);
          } else {
            failedSync.resolve(outcome === 'null' ? null : wrongWorkspace);
            await failedSync.promise;
          }
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(onWorkspaceUpdated).not.toHaveBeenCalled();
        expect(syncCallCount).toBe(1);

        await harness.render(workspaceRevision5, onWorkspaceUpdated);
        expect(syncCallCount).toBe(2);
        expect(onWorkspaceUpdated).not.toHaveBeenCalled();

        await harness.ReactInner.act(async () => {
          currentSync.resolve(currentIndexedWorkspace);
          await currentSync.promise;
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(onWorkspaceUpdated).toHaveBeenCalledTimes(1);
        expect(onWorkspaceUpdated).toHaveBeenLastCalledWith(currentIndexedWorkspace);
        expect(syncCallCount).toBe(2);
      } finally {
        await harness.cleanup();
      }
    },
  );

  test('starts automatic vector sync when the parent commits the same internally published revision', async () => {
    const pendingSource = {
      id: 'vector-source-internal-publication',
      kind: EnterpriseLeadExtractionSourceKind.File,
      label: 'vector-source-internal-publication.pdf',
      text: 'Searchable source published before the parent prop catches up',
      extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
      vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
      updatedAt: '2026-07-04T05:00:00.000Z',
    };
    const workspaceRevision4: EnterpriseLeadWorkspace = {
      ...createWorkspace('workspace-automatic-vector-internal-publication'),
      extractionSources: [],
      profileRevision: 4,
    };
    const workspaceRevision5: EnterpriseLeadWorkspace = {
      ...workspaceRevision4,
      extractionSources: [pendingSource],
      profileRevision: 5,
      updatedAt: '2026-07-04T05:00:00.000Z',
    };
    const indexedWorkspace: EnterpriseLeadWorkspace = {
      ...workspaceRevision5,
      extractionSources: [
        {
          ...pendingSource,
          vectorChunkCount: 1,
          vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexed,
        },
      ],
    };
    const pendingSync = createDeferred<EnterpriseLeadWorkspace | null>();
    const onWorkspaceUpdated = vi.fn();
    const harness = await mountIsolatedWorkspaceKnowledgeBase({
      workspace: workspaceRevision4,
      onWorkspaceUpdated,
      strictMode: true,
      configureService: service => {
        vi.spyOn(service, 'updateWorkspaceSources').mockReturnValue(pendingSync.promise);
      },
    });

    try {
      const updateWorkspaceSources = vi.mocked(harness.service.updateWorkspaceSources);
      vi.spyOn(harness.service, 'getWorkspace').mockResolvedValueOnce(workspaceRevision5);
      await harness.ReactInner.act(async () => {
        await harness.documentPanelProps()?.onWorkspaceProjectionChange();
      });
      expect(onWorkspaceUpdated).toHaveBeenCalledTimes(1);
      expect(onWorkspaceUpdated).toHaveBeenLastCalledWith(workspaceRevision5);
      expect(updateWorkspaceSources).not.toHaveBeenCalled();

      await harness.render(workspaceRevision5, onWorkspaceUpdated);
      expect(updateWorkspaceSources).toHaveBeenCalledTimes(1);
      expect(updateWorkspaceSources).toHaveBeenLastCalledWith(
        workspaceRevision5.id,
        workspaceRevision5.extractionSources,
      );

      await harness.ReactInner.act(async () => {
        pendingSync.resolve(indexedWorkspace);
        await pendingSync.promise;
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(onWorkspaceUpdated).toHaveBeenCalledTimes(2);
      expect(onWorkspaceUpdated).toHaveBeenLastCalledWith(indexedWorkspace);
    } finally {
      await harness.cleanup();
    }
  });

  test('does not publish a deferred automatic vector sync after unmount', async () => {
    const source = {
      id: 'vector-source-unmount',
      kind: EnterpriseLeadExtractionSourceKind.File,
      label: 'vector-source-unmount.pdf',
      text: 'Searchable unmount source',
      extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
      vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
    };
    const workspace: EnterpriseLeadWorkspace = {
      ...createWorkspace('workspace-automatic-vector-unmount'),
      extractionSources: [source],
      profileRevision: 4,
    };
    const indexedWorkspace: EnterpriseLeadWorkspace = {
      ...workspace,
      extractionSources: [
        {
          ...source,
          vectorChunkCount: 1,
          vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexed,
        },
      ],
    };
    const pendingSync = createDeferred<EnterpriseLeadWorkspace | null>();
    const onWorkspaceUpdated = vi.fn();
    let didCleanup = false;
    const harness = await mountIsolatedWorkspaceKnowledgeBase({
      workspace,
      onWorkspaceUpdated,
      configureService: service => {
        vi.spyOn(service, 'updateWorkspaceSources').mockReturnValueOnce(pendingSync.promise);
      },
    });

    try {
      await harness.cleanup();
      didCleanup = true;
      pendingSync.resolve(indexedWorkspace);
      await pendingSync.promise;
      await Promise.resolve();
      await Promise.resolve();
      expect(onWorkspaceUpdated).not.toHaveBeenCalled();
    } finally {
      if (!didCleanup) {
        await harness.cleanup();
      }
    }
  });

  test('rejects an old workspace A AI settlement after committed A to B to A transitions', async () => {
    const workspaceA: EnterpriseLeadWorkspace = {
      ...createWorkspace('workspace-aba-a'),
      profile: {
        ...emptyProfile(),
        companySummary: 'Original workspace A',
      },
      profileRevision: 4,
    };
    const workspaceB = {
      ...createWorkspace('workspace-aba-b'),
      profileRevision: 4,
    };
    const committedWorkspaceAAgain: EnterpriseLeadWorkspace = {
      ...workspaceA,
      profile: {
        ...workspaceA.profile,
        companySummary: 'Committed workspace A again',
      },
      updatedAt: '2026-07-04T04:40:00.000Z',
    };
    const staleOriginalAResult: EnterpriseLeadWorkspace = {
      ...workspaceA,
      profile: {
        ...workspaceA.profile,
        companySummary: 'Stale original A response',
      },
      updatedAt: '2026-07-04T04:20:00.000Z',
    };
    const onWorkspaceUpdated = vi.fn();
    const harness = await mountIsolatedWorkspaceKnowledgeBase({
      workspace: workspaceA,
      onWorkspaceUpdated,
    });
    const pendingWorkspace = createDeferred<EnterpriseLeadWorkspace | null>();

    try {
      await harness.ReactInner.act(async () => {
        getKnowledgeMetricButton(
          harness.container,
          harness.translate('enterpriseLeadKnowledgeAiKnowledgeTitle'),
        )?.click();
      });
      vi.spyOn(harness.service, 'getWorkspace').mockReturnValueOnce(pendingWorkspace.promise);
      const pendingRefresh = harness.aiPanelProps()?.onProjectionRefresh?.({
        workspaceId: workspaceA.id,
        profileRevision: workspaceA.profileRevision,
      });

      await harness.render(workspaceB, onWorkspaceUpdated);
      await harness.render(committedWorkspaceAAgain, onWorkspaceUpdated);
      expect(harness.aiPanelProps()).toMatchObject({
        workspaceId: committedWorkspaceAAgain.id,
        profileRevision: committedWorkspaceAAgain.profileRevision,
        profile: committedWorkspaceAAgain.profile,
      });

      await harness.ReactInner.act(async () => {
        pendingWorkspace.resolve(staleOriginalAResult);
        await pendingRefresh;
      });
      expect(onWorkspaceUpdated).not.toHaveBeenCalled();
      expect(harness.aiPanelProps()?.profile.companySummary).toBe(
        committedWorkspaceAAgain.profile.companySummary,
      );
    } finally {
      await harness.cleanup();
    }
  });

  test('reconciles mounted AI projection refreshes without losing dirty drafts or publishing stale workspaces', async () => {
    const workspaceA = {
      ...createWorkspace('workspace-projection-a'),
      profile: {
        ...emptyProfile(),
        companySummary: 'Original summary',
      },
      profileRevision: 4,
    };
    const onWorkspaceUpdated = vi.fn();
    const harness = await mountIsolatedWorkspaceKnowledgeBase({
      workspace: workspaceA,
      onWorkspaceUpdated,
    });

    try {
      const aiTab = getKnowledgeMetricButton(
        harness.container,
        harness.translate('enterpriseLeadKnowledgeAiKnowledgeTitle'),
      );
      await harness.ReactInner.act(async () => {
        aiTab?.click();
      });
      await harness.ReactInner.act(async () => {
        getFakeDomElementByTestId(harness.container, 'controlled-ai-maintain-company')?.click();
      });
      const companyTextarea = findFakeDomElement(
        harness.container,
        element => element.tagName.toLowerCase() === 'textarea',
      );
      expect(companyTextarea).not.toBeNull();
      await harness.ReactInner.act(async () => {
        companyTextarea?.input('Unsaved local summary');
      });
      expect(companyTextarea?.value).toBe('Unsaved local summary');

      const sameRevisionWorkspace: EnterpriseLeadWorkspace = {
        ...workspaceA,
        extractionSources: [
          {
            id: 'knowledge-document:same-revision',
            kind: EnterpriseLeadExtractionSourceKind.File,
            label: 'Same revision.pdf',
          },
        ],
      };
      const getWorkspace = vi
        .spyOn(harness.service, 'getWorkspace')
        .mockResolvedValueOnce(sameRevisionWorkspace);
      const revision4ProjectionRefresh = harness.aiPanelProps()?.onProjectionRefresh;
      expect(revision4ProjectionRefresh).toEqual(expect.any(Function));
      await harness.ReactInner.act(async () => {
        await revision4ProjectionRefresh?.({
          workspaceId: workspaceA.id,
          profileRevision: 4,
        });
      });
      expect(getWorkspace).toHaveBeenLastCalledWith(workspaceA.id);
      expect(companyTextarea?.value).toBe('Unsaved local summary');
      expect(onWorkspaceUpdated).toHaveBeenLastCalledWith(sameRevisionWorkspace);

      const newerWorkspace: EnterpriseLeadWorkspace = {
        ...sameRevisionWorkspace,
        profile: {
          ...sameRevisionWorkspace.profile,
          companySummary: 'Server revision summary',
        },
        profileRevision: 5,
        updatedAt: '2026-07-04T05:00:00.000Z',
      };
      getWorkspace.mockResolvedValueOnce(newerWorkspace);
      await harness.ReactInner.act(async () => {
        await harness.aiPanelProps()?.onProjectionRefresh?.({
          workspaceId: workspaceA.id,
          profileRevision: 5,
        });
      });
      expect(companyTextarea?.value).toBe('Server revision summary');
      expect(harness.aiPanelProps()).toMatchObject({
        workspaceId: workspaceA.id,
        profileRevision: 5,
        profile: newerWorkspace.profile,
      });
      expect(onWorkspaceUpdated).toHaveBeenLastCalledWith(newerWorkspace);

      const pendingWorkspace = createDeferred<EnterpriseLeadWorkspace | null>();
      const oldWorkspaceResult: EnterpriseLeadWorkspace = {
        ...newerWorkspace,
        profileRevision: 6,
        updatedAt: '2026-07-04T06:00:00.000Z',
      };
      getWorkspace.mockReturnValueOnce(pendingWorkspace.promise);
      const pendingRefresh = harness.aiPanelProps()?.onProjectionRefresh?.({
        workspaceId: workspaceA.id,
        profileRevision: 6,
      });
      const workspaceB = {
        ...createWorkspace('workspace-projection-b'),
        profileRevision: 1,
      };
      await harness.render(workspaceB, onWorkspaceUpdated);
      await harness.ReactInner.act(async () => {
        pendingWorkspace.resolve(oldWorkspaceResult);
        await pendingRefresh;
      });
      expect(harness.aiPanelProps()).toMatchObject({
        workspaceId: workspaceB.id,
        profileRevision: workspaceB.profileRevision,
        profile: workspaceB.profile,
      });
      expect(onWorkspaceUpdated).not.toHaveBeenCalledWith(oldWorkspaceResult);
    } finally {
      await harness.cleanup();
    }
  });

  test('routes only AI Chat to embedded Cowork without dedicated chat-session APIs', () => {
    expect(
      getEnterpriseLeadWorkspacePageRouting(EnterpriseLeadWorkspaceInternalPage.AiChat),
    ).toEqual({
      target: EnterpriseLeadWorkspacePageTarget.EmbeddedCoworkChat,
      usesDedicatedEnterpriseLeadChatSessions: false,
    });

    const nonAiChatRoutes = getWorkspaceInternalPages()
      .filter(page => page.id !== EnterpriseLeadWorkspaceInternalPage.AiChat)
      .map(page => getEnterpriseLeadWorkspacePageRouting(page.id));

    expect(nonAiChatRoutes).toHaveLength(getWorkspaceInternalPages().length - 1);
    expect(
      nonAiChatRoutes.every(
        route =>
          route.target === EnterpriseLeadWorkspacePageTarget.WorkspacePanel &&
          !route.usesDedicatedEnterpriseLeadChatSessions,
      ),
    ).toBe(true);
  });

  test('loads Cowork sessions when a workspace opens', async () => {
    await vi.resetModules();
    const restoreDom = installFakeDom();

    const ReactInner = await import('react');
    const { configureStore } = await import('@reduxjs/toolkit');
    const { Provider } = await import('react-redux');
    const { createRoot } = await import('react-dom/client');
    const { act } = ReactInner;
    const coworkModule = await import('../../services/cowork');
    const enterpriseLeadWorkspaceModule = await import('../../services/enterpriseLeadWorkspace');
    const { default: coworkReducer } = await import('../../store/slices/coworkSlice');

    let entryHomeProps: { onOpen: (workspaceId: string) => void } | null = null;

    vi.doMock('./WorkspaceEntryHome', () => ({
      default: (props: { onOpen: (workspaceId: string) => void }) => {
        entryHomeProps = props;
        return ReactInner.createElement('div', { 'data-testid': 'workspace-entry-home' });
      },
    }));
    vi.doMock('./WorkspaceShell', () => ({
      default: ({ children }: { children?: React.ReactNode }) =>
        ReactInner.createElement('div', { 'data-testid': 'workspace-shell' }, children),
    }));
    vi.doMock('./WorkspaceStart', () => ({
      default: () => ReactInner.createElement('div', { 'data-testid': 'workspace-start' }),
    }));
    vi.doMock('./WorkspaceKnowledgeBase', () => ({
      default: () => ReactInner.createElement('div', { 'data-testid': 'workspace-knowledge-base' }),
    }));
    vi.doMock('./WorkspaceCreate', () => ({
      default: () => ReactInner.createElement('div', { 'data-testid': 'workspace-create' }),
    }));
    vi.doMock('../cowork/CoworkSearchModal', () => ({
      default: () => ReactInner.createElement('div', { 'data-testid': 'cowork-search-modal' }),
    }));
    vi.doMock('../cowork', () => ({
      CoworkView: () => ReactInner.createElement('div', { 'data-testid': 'cowork-view' }),
    }));

    const { coworkService } = coworkModule;
    const { enterpriseLeadWorkspaceService } = enterpriseLeadWorkspaceModule;
    const { EnterpriseLeadWorkspaceView: IsolatedEnterpriseLeadWorkspaceView } =
      await import('./EnterpriseLeadWorkspaceView');

    const workspace = createWorkspace('workspace-1');
    const testStore = configureStore({
      reducer: {
        cowork: coworkReducer,
      },
    });

    vi.spyOn(enterpriseLeadWorkspaceService, 'listWorkspaces').mockResolvedValue([workspace]);
    vi.spyOn(enterpriseLeadWorkspaceService, 'getWorkspace').mockResolvedValue(workspace);
    const loadCoworkSessions = vi.spyOn(coworkService, 'loadSessions').mockResolvedValue(undefined);

    const container = document.createElement('div');
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          ReactInner.createElement(Provider, {
            store: testStore,
            children: ReactInner.createElement(IsolatedEnterpriseLeadWorkspaceView, {
              onPrepareCoworkChat: vi.fn(),
            }),
          }),
        );
      });

      expect(entryHomeProps).not.toBeNull();
      loadCoworkSessions.mockClear();

      await act(async () => {
        entryHomeProps?.onOpen('workspace-1');
      });

      expect(loadCoworkSessions).toHaveBeenCalled();
    } finally {
      root.unmount();
      restoreDom();
    }
  });

  test('does not let a pending creation refresh override later internal navigation', async () => {
    await vi.resetModules();
    const restoreDom = installFakeDom();

    const ReactInner = await import('react');
    const { configureStore } = await import('@reduxjs/toolkit');
    const { Provider } = await import('react-redux');
    const { createRoot } = await import('react-dom/client');
    const { act } = ReactInner;
    const coworkModule = await import('../../services/cowork');
    const enterpriseLeadWorkspaceModule = await import('../../services/enterpriseLeadWorkspace');
    const { default: coworkReducer } = await import('../../store/slices/coworkSlice');

    let entryHomeProps: { onCreate: () => void } | null = null;
    let createProps: {
      onCreated: (workspaceId: string, result?: KnowledgeImportBatchResult) => void;
    } | null = null;
    type CapturedShellProps = {
      activePage: EnterpriseLeadWorkspaceInternalPage;
      onPageChange: (page: EnterpriseLeadWorkspaceInternalPage) => void;
    };
    let shellProps: CapturedShellProps | null = null;
    const requireShellProps = (): CapturedShellProps => {
      const captured = shellProps as CapturedShellProps | null;
      if (!captured) {
        throw new Error('Workspace shell was not rendered');
      }
      return captured;
    };

    vi.doMock('./WorkspaceEntryHome', () => ({
      default: (props: { onCreate: () => void }) => {
        entryHomeProps = props;
        return ReactInner.createElement('div', { 'data-testid': 'workspace-entry-home' });
      },
    }));
    vi.doMock('./WorkspaceCreate', () => ({
      default: (props: {
        onCreated: (workspaceId: string, result?: KnowledgeImportBatchResult) => void;
      }) => {
        createProps = props;
        return ReactInner.createElement('div', { 'data-testid': 'workspace-create' });
      },
    }));
    vi.doMock('./WorkspaceShell', () => ({
      default: (props: {
        activePage: EnterpriseLeadWorkspaceInternalPage;
        onPageChange: (page: EnterpriseLeadWorkspaceInternalPage) => void;
        children?: React.ReactNode;
      }) => {
        shellProps = props;
        return ReactInner.createElement(
          'div',
          { 'data-testid': 'workspace-shell' },
          props.children,
        );
      },
    }));
    vi.doMock('./WorkspaceStart', () => ({
      default: () => ReactInner.createElement('div', { 'data-testid': 'workspace-start' }),
    }));
    vi.doMock('./WorkspaceKnowledgeBase', () => ({
      default: () => ReactInner.createElement('div', { 'data-testid': 'workspace-knowledge-base' }),
    }));
    vi.doMock('../cowork/CoworkSearchModal', () => ({
      default: () => ReactInner.createElement('div', { 'data-testid': 'cowork-search-modal' }),
    }));
    vi.doMock('../cowork', () => ({
      CoworkView: () => ReactInner.createElement('div', { 'data-testid': 'cowork-view' }),
    }));

    const { coworkService } = coworkModule;
    const { enterpriseLeadWorkspaceService } = enterpriseLeadWorkspaceModule;
    const { EnterpriseLeadWorkspaceView: IsolatedEnterpriseLeadWorkspaceView } =
      await import('./EnterpriseLeadWorkspaceView');
    const workspace = createWorkspace('workspace-creation-race');
    const pendingRefresh = createDeferred<EnterpriseLeadWorkspace[]>();
    const testStore = configureStore({
      reducer: {
        cowork: coworkReducer,
      },
    });

    vi.spyOn(enterpriseLeadWorkspaceService, 'listWorkspaces')
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => pendingRefresh.promise)
      .mockResolvedValue([workspace]);
    vi.spyOn(enterpriseLeadWorkspaceService, 'getWorkspace').mockResolvedValue(workspace);
    vi.spyOn(coworkService, 'loadSessions').mockResolvedValue(undefined);

    const container = document.createElement('div');
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          ReactInner.createElement(Provider, {
            store: testStore,
            children: ReactInner.createElement(IsolatedEnterpriseLeadWorkspaceView, {
              onPrepareCoworkChat: vi.fn(),
            }),
          }),
        );
      });

      await act(async () => {
        entryHomeProps?.onCreate();
      });
      expect(createProps).not.toBeNull();

      await act(async () => {
        createProps?.onCreated(workspace.id, {
          importedCount: 1,
          failedCount: 1,
          items: [],
        });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(requireShellProps().activePage).toBe(
        EnterpriseLeadWorkspaceInternalPage.KnowledgeBase,
      );

      await act(async () => {
        requireShellProps().onPageChange(EnterpriseLeadWorkspaceInternalPage.Workbench);
      });
      expect(requireShellProps().activePage).toBe(EnterpriseLeadWorkspaceInternalPage.Workbench);

      await act(async () => {
        pendingRefresh.resolve([workspace]);
        await pendingRefresh.promise;
        await Promise.resolve();
      });

      expect(requireShellProps().activePage).toBe(EnterpriseLeadWorkspaceInternalPage.Workbench);
    } finally {
      await act(async () => {
        root.unmount();
      });
      restoreDom();
    }
  });

  test('does not render the workspace exit action in the top title bar', async () => {
    await vi.resetModules();
    const restoreDom = installFakeDom();

    const ReactInner = await import('react');
    const { configureStore } = await import('@reduxjs/toolkit');
    const { Provider } = await import('react-redux');
    const { createRoot } = await import('react-dom/client');
    const { act } = ReactInner;
    const coworkModule = await import('../../services/cowork');
    const enterpriseLeadWorkspaceModule = await import('../../services/enterpriseLeadWorkspace');
    const { default: coworkReducer } = await import('../../store/slices/coworkSlice');

    let entryHomeProps: { onOpen: (workspaceId: string) => void } | null = null;

    vi.doMock('./WorkspaceEntryHome', () => ({
      default: (props: { onOpen: (workspaceId: string) => void }) => {
        entryHomeProps = props;
        return ReactInner.createElement('div', { 'data-testid': 'workspace-entry-home' });
      },
    }));
    vi.doMock('./WorkspaceShell', () => ({
      default: ({ children }: { children?: React.ReactNode }) =>
        ReactInner.createElement('div', { 'data-testid': 'workspace-shell' }, children),
    }));
    vi.doMock('./WorkspaceStart', () => ({
      default: () => ReactInner.createElement('div', { 'data-testid': 'workspace-start' }),
    }));
    vi.doMock('./WorkspaceKnowledgeBase', () => ({
      default: () => ReactInner.createElement('div', { 'data-testid': 'workspace-knowledge-base' }),
    }));
    vi.doMock('./WorkspaceCreate', () => ({
      default: () => ReactInner.createElement('div', { 'data-testid': 'workspace-create' }),
    }));
    vi.doMock('../cowork/CoworkSearchModal', () => ({
      default: () => ReactInner.createElement('div', { 'data-testid': 'cowork-search-modal' }),
    }));
    vi.doMock('../cowork', () => ({
      CoworkView: () => ReactInner.createElement('div', { 'data-testid': 'cowork-view' }),
    }));

    const { coworkService } = coworkModule;
    const { enterpriseLeadWorkspaceService } = enterpriseLeadWorkspaceModule;
    const { EnterpriseLeadWorkspaceView: IsolatedEnterpriseLeadWorkspaceView } =
      await import('./EnterpriseLeadWorkspaceView');
    const workspace = createWorkspace('workspace-1');
    const testStore = configureStore({
      reducer: {
        cowork: coworkReducer,
      },
    });

    vi.spyOn(enterpriseLeadWorkspaceService, 'listWorkspaces').mockResolvedValue([workspace]);
    vi.spyOn(enterpriseLeadWorkspaceService, 'getWorkspace').mockResolvedValue(workspace);
    vi.spyOn(coworkService, 'loadSessions').mockResolvedValue(undefined);

    const container = document.createElement('div');
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          ReactInner.createElement(Provider, {
            store: testStore,
            children: ReactInner.createElement(IsolatedEnterpriseLeadWorkspaceView, {
              isSidebarCollapsed: true,
              hideSidebarToggle: true,
              onPrepareCoworkChat: vi.fn(),
            }),
          }),
        );
      });

      await act(async () => {
        entryHomeProps?.onOpen('workspace-1');
      });

      expect(container.textContent).toContain(workspace.name);
      expect(
        collectFakeDomAttributeValues(container as unknown as FakeDomNode, 'aria-label'),
      ).not.toContain(i18nService.t('enterpriseLeadWorkspaceExitToList'));
    } finally {
      root.unmount();
      restoreDom();
    }
  });

  test('renders the Kits panel and keeps SkillsView on the settings page', async () => {
    await vi.resetModules();
    const restoreDom = installFakeDom();

    const ReactInner = await import('react');
    const { configureStore } = await import('@reduxjs/toolkit');
    const { Provider } = await import('react-redux');
    const { createRoot } = await import('react-dom/client');
    const { act } = ReactInner;
    const coworkModule = await import('../../services/cowork');
    const enterpriseLeadWorkspaceModule = await import('../../services/enterpriseLeadWorkspace');
    const { default: coworkReducer } = await import('../../store/slices/coworkSlice');

    let entryHomeProps: { onOpen: (workspaceId: string) => void } | null = null;
    let shellProps: {
      onPageChange: (page: EnterpriseLeadWorkspaceInternalPage) => void;
    } | null = null;
    let workspaceSettingsRenderCount = 0;
    let workspaceKitsPanelRenderCount = 0;
    let workspaceKitsPanelWorkspaceId = '';
    let skillsViewRenderCount = 0;

    vi.doMock('./WorkspaceEntryHome', () => ({
      default: (props: { onOpen: (workspaceId: string) => void }) => {
        entryHomeProps = props;
        return ReactInner.createElement('div', { 'data-testid': 'workspace-entry-home' });
      },
    }));
    vi.doMock('./WorkspaceShell', () => ({
      default: (props: {
        onPageChange: (page: EnterpriseLeadWorkspaceInternalPage) => void;
        children?: React.ReactNode;
      }) => {
        shellProps = props;
        return ReactInner.createElement(
          'div',
          { 'data-testid': 'workspace-shell' },
          props.children,
        );
      },
    }));
    vi.doMock('./WorkspaceSettings', () => ({
      default: () => {
        workspaceSettingsRenderCount += 1;
        return ReactInner.createElement('div', { 'data-testid': 'workspace-settings' });
      },
    }));
    vi.doMock('./WorkspaceKitsPanel', () => ({
      default: ({ workspace }: { workspace: EnterpriseLeadWorkspace }) => {
        workspaceKitsPanelRenderCount += 1;
        workspaceKitsPanelWorkspaceId = workspace.id;
        return ReactInner.createElement('div', { 'data-testid': 'workspace-kits-panel' });
      },
    }));
    vi.doMock('../skills', () => ({
      SkillsView: () => {
        skillsViewRenderCount += 1;
        return ReactInner.createElement('div', { 'data-testid': 'skills-view' });
      },
    }));
    vi.doMock('./WorkspaceStart', () => ({
      default: () => ReactInner.createElement('div', { 'data-testid': 'workspace-start' }),
    }));
    vi.doMock('./WorkspaceKnowledgeBase', () => ({
      default: () => ReactInner.createElement('div', { 'data-testid': 'workspace-knowledge-base' }),
    }));
    vi.doMock('./WorkspaceCreate', () => ({
      default: () => ReactInner.createElement('div', { 'data-testid': 'workspace-create' }),
    }));
    vi.doMock('../cowork/CoworkSearchModal', () => ({
      default: () => ReactInner.createElement('div', { 'data-testid': 'cowork-search-modal' }),
    }));
    vi.doMock('../cowork', () => ({
      CoworkView: () => ReactInner.createElement('div', { 'data-testid': 'cowork-view' }),
    }));

    const { coworkService } = coworkModule;
    const { enterpriseLeadWorkspaceService } = enterpriseLeadWorkspaceModule;
    const { EnterpriseLeadWorkspaceView: IsolatedEnterpriseLeadWorkspaceView } =
      await import('./EnterpriseLeadWorkspaceView');
    const workspace = createWorkspace('workspace-1');
    const testStore = configureStore({
      reducer: {
        cowork: coworkReducer,
      },
    });

    vi.spyOn(enterpriseLeadWorkspaceService, 'listWorkspaces').mockResolvedValue([workspace]);
    vi.spyOn(enterpriseLeadWorkspaceService, 'getWorkspace').mockResolvedValue(workspace);
    vi.spyOn(coworkService, 'loadSessions').mockResolvedValue(undefined);

    const container = document.createElement('div');
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          ReactInner.createElement(Provider, {
            store: testStore,
            children: ReactInner.createElement(IsolatedEnterpriseLeadWorkspaceView, {
              onPrepareCoworkChat: vi.fn(),
            }),
          }),
        );
      });

      await act(async () => {
        entryHomeProps?.onOpen('workspace-1');
      });

      expect(shellProps).not.toBeNull();

      await act(async () => {
        shellProps?.onPageChange(EnterpriseLeadWorkspaceInternalPage.Kits);
      });

      expect(workspaceKitsPanelRenderCount).toBe(1);
      expect(workspaceKitsPanelWorkspaceId).toBe(workspace.id);

      await act(async () => {
        shellProps?.onPageChange(EnterpriseLeadWorkspaceInternalPage.Settings);
      });

      expect(skillsViewRenderCount).toBe(1);
      expect(workspaceSettingsRenderCount).toBe(0);
    } finally {
      root.unmount();
      restoreDom();
    }
  });

  test('uses entry home as the default enterprise lead workspace screen', () => {
    expect(EnterpriseLeadWorkspaceScreen.Entry).toBe('entry');
  });

  test('uses focused shell before entering a concrete workspace', () => {
    expect(getShellModeForEnterpriseLeadWorkspaceScreen(EnterpriseLeadWorkspaceScreen.Entry)).toBe(
      EnterpriseLeadWorkspaceShellMode.Focused,
    );
    expect(getShellModeForEnterpriseLeadWorkspaceScreen(EnterpriseLeadWorkspaceScreen.Create)).toBe(
      EnterpriseLeadWorkspaceShellMode.Focused,
    );
  });

  test('uses workspace shell inside a concrete workspace', () => {
    expect(
      getShellModeForEnterpriseLeadWorkspaceScreen(EnterpriseLeadWorkspaceScreen.Workspace),
    ).toBe(EnterpriseLeadWorkspaceShellMode.Workspace);
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

  test('returns defensive copies of entry home actions', () => {
    const actions = getEntryHomeActions();

    actions[0].titleKey = 'mutatedTitle';

    expect(getEntryHomeActions()[0].titleKey).toBe('enterpriseLeadEntryCreateTitle');
  });

  test('renders entry home according to the approved centered prototype', () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceEntryHome, {
        workspaces: [createWorkspace('workspace-1')],
        isLoadingWorkspaces: false,
        workspaceListError: '',
        onCreate: vi.fn(),
        onHistoryOpen: vi.fn(),
        onOpen: vi.fn(),
        onDeleteWorkspace: vi.fn(),
      }),
    );

    expect(html).toContain('宇智能AI');
    expect(html).toContain('开始使用');
    expect(html).toContain('创建或者打开一个工作空间。');
    expect(html).toContain('工作空间操作');
    expect(html).toContain('创建工作区');
    expect(html).toContain('打开历史工作区');
    expect(html).toContain('yuzhh-logo-ai-concept');
    expect(html).toContain('bg-background');
    expect(html).not.toContain('bg-[#fbfcfe]');
    expect(html).not.toContain('>线索工作区</h1>');
  });

  test('renders global settings entry when app settings are available', () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceEntryHome, {
        workspaces: [createWorkspace('workspace-1')],
        isLoadingWorkspaces: false,
        workspaceListError: '',
        onCreate: vi.fn(),
        onHistoryOpen: vi.fn(),
        onOpen: vi.fn(),
        onDeleteWorkspace: vi.fn(),
        onRequestAppSettings: vi.fn(),
      }),
    );

    expect(html).toContain('aria-label="打开设置"');
    expect(html).toContain('fixed bottom-6 right-6');
  });

  test('refreshes history when opening the historical workspace entry', () => {
    expect(shouldRefreshHistoryOnEntryAction(EnterpriseLeadEntryAction.History)).toBe(true);
    expect(shouldRefreshHistoryOnEntryAction(EnterpriseLeadEntryAction.Create)).toBe(false);
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
    const input = [oldest, newest, middle];

    expect(sortWorkspacesByRecentUpdate(input).map(item => item.id)).toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
    expect(input.map(item => item.id)).toEqual(['oldest', 'newest', 'middle']);
  });

  test('computes historical workspace modal state', () => {
    expect(
      getHistoryModalState({
        isLoading: true,
        error: '',
        workspaces: [],
      }),
    ).toBe(EnterpriseLeadWorkspaceHistoryState.Loading);

    expect(
      getHistoryModalState({
        isLoading: false,
        error: 'failed',
        workspaces: [],
      }),
    ).toBe(EnterpriseLeadWorkspaceHistoryState.Error);

    expect(
      getHistoryModalState({
        isLoading: false,
        error: '',
        workspaces: [],
      }),
    ).toBe(EnterpriseLeadWorkspaceHistoryState.Empty);

    expect(
      getHistoryModalState({
        isLoading: false,
        error: '',
        workspaces: [createWorkspace('workspace-1')],
      }),
    ).toBe(EnterpriseLeadWorkspaceHistoryState.List);
  });

  test('renders historical workspace actions and separates delete confirmation into a dialog', () => {
    const workspace = createWorkspace('workspace-1');
    const listHtml = renderToStaticMarkup(
      React.createElement(WorkspaceHistoryList, {
        historyState: EnterpriseLeadWorkspaceHistoryState.List,
        sortedWorkspaces: [workspace],
        activeActionsWorkspaceId: workspace.id,
        isDeletingWorkspaceId: null,
        onOpen: vi.fn(),
        onCreate: vi.fn(),
        onToggleActions: vi.fn(),
        onRequestDelete: vi.fn(),
      }),
    );
    const dialogHtml = renderToStaticMarkup(
      React.createElement(WorkspaceDeleteConfirmDialog, {
        workspace,
        isDeletingWorkspaceId: null,
        deleteError: '',
        onCancelDelete: vi.fn(),
        onConfirmDelete: vi.fn(),
      }),
    );

    expect(listHtml).toContain('打开工作区操作');
    expect(listHtml).toContain('删除工作区');
    expect(listHtml).not.toContain('删除「Workspace workspace-1」？');
    expect(dialogHtml).toContain('role="dialog"');
    expect(dialogHtml).toContain('aria-modal="true"');
    expect(dialogHtml).toContain('删除「Workspace workspace-1」？');
    expect(dialogHtml).toContain(
      '删除后会移除这个空间的资料、知识库、Agent 设置和创作记录，不能恢复。',
    );
  });

  test('uses first launch mode when no workspaces exist', () => {
    expect(getLaunchMode([])).toBe(EnterpriseLeadWorkspaceLaunchMode.FirstLaunch);
    expect(getLaunchMode([createWorkspace('workspace-1')])).toBe(
      EnterpriseLeadWorkspaceLaunchMode.Returning,
    );
  });

  test('routes each workspace creation start mode to its own branch screen', () => {
    expect(getWorkspaceCreateBranchScreen(WorkspaceCreateStartMode.Material)).toBe(
      WorkspaceCreateBranchScreen.Material,
    );
    expect(getWorkspaceCreateBranchScreen(WorkspaceCreateStartMode.Paste)).toBe(
      WorkspaceCreateBranchScreen.Paste,
    );
    expect(getWorkspaceCreateBranchScreen(WorkspaceCreateStartMode.Blank)).toBe(
      WorkspaceCreateBranchScreen.Blank,
    );
  });

  test('detects workspaces that need processing refresh after document upload', () => {
    const extractingWorkspace = {
      ...createWorkspace('extracting'),
      extractionSources: [
        {
          kind: EnterpriseLeadExtractionSourceKind.File,
          label: 'factory.md',
          text: '主营精密五金加工。',
          extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracting,
          vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Pending,
        },
      ],
    };
    const indexingWorkspace = {
      ...createWorkspace('indexing'),
      extractionSources: [
        {
          kind: EnterpriseLeadExtractionSourceKind.File,
          label: 'factory.md',
          text: '主营精密五金加工。',
          extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
          vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexing,
        },
      ],
    };
    const indexedWorkspace = {
      ...createWorkspace('indexed'),
      extractionSources: [
        {
          kind: EnterpriseLeadExtractionSourceKind.File,
          label: 'factory.md',
          text: '主营精密五金加工。',
          extractionStatus: EnterpriseLeadDocumentExtractionStatus.Extracted,
          vectorIndexStatus: EnterpriseLeadKnowledgeIndexStatus.Indexed,
        },
      ],
    };

    expect(hasEnterpriseLeadWorkspaceProcessingSources(extractingWorkspace)).toBe(true);
    expect(hasEnterpriseLeadWorkspaceProcessingSources(indexingWorkspace)).toBe(true);
    expect(hasEnterpriseLeadWorkspaceProcessingSources(indexedWorkspace)).toBe(false);
  });

  test('renders escape controls on the workspace creation start step', () => {
    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceCreate, {
        onCreated: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(markup).toContain('返回开始页');
    expect(markup).toContain('取消创建');
    expect(markup).toContain('border-t border-border/70 pt-5');
    expect(markup).toContain('flex flex-col-reverse gap-2 sm:flex-row');
  });

  test('describes broad upload format support when creating a workspace', () => {
    const previousLanguage = i18nService.getLanguage();
    i18nService.setLanguage('zh', { persist: false });

    try {
      expect(i18nService.t('enterpriseLeadImportMaterialDesc')).toContain('PDF');
      expect(i18nService.t('enterpriseLeadImportMaterialDesc')).toContain('Word');
      expect(i18nService.t('enterpriseLeadImportMaterialDesc')).toContain('Excel');
      expect(i18nService.t('enterpriseLeadImportMaterialDesc')).toContain('PPTX');
      expect(i18nService.t('enterpriseLeadReadFileFailed')).toContain('PDF');
    } finally {
      i18nService.setLanguage(previousLanguage, { persist: false });
    }
  });

  test('builds a blank manual workspace draft without initial profile data', () => {
    const draft = buildManualEnterpriseLeadWorkspaceDraft({
      name: '  华东制造业拓客计划  ',
      mode: WorkspaceCreateStartMode.Blank,
      sourceLabel: '空白创建',
    });

    expect(draft.name).toBe('华东制造业拓客计划');
    expect(draft.type).toBe('enterprise_lead');
    expect(draft.source).toEqual({
      kind: 'blank',
      label: '空白创建',
      text: undefined,
    });
    expect(draft.profile).toEqual(emptyProfile());
    expect(draft.enabledAgentRoles).toEqual([]);
    expect(draft.workspaceAgents).toEqual([]);
  });

  test('builds a pasted manual workspace draft with trimmed source text', () => {
    const draft = buildManualEnterpriseLeadWorkspaceDraft({
      name: '',
      mode: WorkspaceCreateStartMode.Paste,
      sourceLabel: '粘贴内容',
      sourceText: '  目标客户是汽车零部件企业。  ',
    });

    expect(draft.name).toBe('粘贴内容');
    expect(draft.source).toEqual({
      kind: 'manual',
      label: '粘贴内容',
      text: '目标客户是汽车零部件企业。',
    });
  });

  test('computes profile completion from six populated profile groups', () => {
    const profile = emptyProfile();
    profile.companySummary = 'Industrial sales workflow automation';
    profile.productList = ['Lead Radar'];
    profile.targetCustomers = ['Manufacturing sales teams'];

    expect(getWorkspaceCompletionPercent(profile)).toBe(50);
  });

  test('treats paired profile fields as one completed group', () => {
    const profile = emptyProfile();
    profile.productCapabilities = ['Maps buyer intent'];
    profile.applicationScenarios = ['New market expansion'];
    profile.contactRules = ['No medical claims'];

    expect(getWorkspaceCompletionPercent(profile)).toBe(50);
  });

  test('summarizes draft name, products, and target customers', () => {
    const profile = emptyProfile();
    profile.productList = ['Lead Radar', 'Account Briefs'];
    profile.targetCustomers = ['Channel teams', 'Sales leaders'];

    expect(
      summarizeWorkspaceDraft(createDraft(profile), {
        productsFallback: 'No products',
        customersFallback: 'No customers',
        targetCustomersPrefix: 'For: ',
      }),
    ).toEqual({
      name: 'North Star Leads',
      products: 'Lead Radar, Account Briefs',
      targetCustomers: 'For: Channel teams, Sales leaders',
    });
  });

  test('uses caller-provided fallbacks for empty draft summary fields', () => {
    expect(
      summarizeWorkspaceDraft(createDraft(emptyProfile()), {
        productsFallback: 'No products',
        customersFallback: 'No customers',
        targetCustomersPrefix: 'For: ',
      }),
    ).toEqual({
      name: 'North Star Leads',
      products: 'No products',
      targetCustomers: 'For: No customers',
    });
  });

  test('builds workspace knowledge sections from profile and snapshot', () => {
    const workspace = createWorkspace('workspace-1');
    workspace.profile.companySummary = '精密制造企业，主营高精度零部件加工。';
    workspace.profile.productList = ['五轴加工服务'];
    const snapshot = {
      ...createSnapshot(workspace),
      deliverables: [
        {
          id: 'deliverable-1',
          runId: 'run-1',
          workspaceId: workspace.id,
          kind: EnterpriseLeadDeliverableKind.ContentDraft,
          role: EnterpriseLeadAgentRole.ContentPlanning,
          title: '销售触达草稿',
          summary: '面向长三角制造客户的触达话术。',
          payload: {},
          status: 'draft' as const,
          createdAt: '2026-07-04T01:00:00.000Z',
          updatedAt: '2026-07-04T01:00:00.000Z',
        },
      ],
    };

    const sections = getWorkspaceKnowledgeSections(workspace, snapshot);

    expect(sections.map(section => section.id)).toContain('company');
    expect(sections.map(section => section.id)).toContain('products');
    expect(sections.find(section => section.id === 'company')?.items[0]?.text).toContain(
      '精密制造企业',
    );
  });

  test('omits blank workspace creation placeholders from knowledge source sections', () => {
    const workspace = {
      ...createWorkspace('blank-source'),
      extractionSources: [
        {
          kind: EnterpriseLeadExtractionSourceKind.Blank,
          label: '空白创建',
        },
        {
          kind: EnterpriseLeadExtractionSourceKind.File,
          label: 'factory.md',
          fileName: 'factory.md',
          text: '主营精密五金加工。',
        },
      ],
    };

    const sourceItems = getWorkspaceKnowledgeSections(workspace, null).find(
      section => section.id === EnterpriseLeadKnowledgeSection.Sources,
    )?.items;

    expect(sourceItems?.map(item => item.text)).toEqual(['factory.md']);
    expect(sourceItems?.[0]?.id).toBe('source-1');
  });

  test('maps editable knowledge kinds to workspace profile fields', () => {
    expect(getEditableKnowledgeField(EnterpriseLeadKnowledgeItemKind.CompanySummary)).toEqual({
      field: 'companySummary',
      multiValue: false,
    });
    expect(getEditableKnowledgeField(EnterpriseLeadKnowledgeItemKind.Product)).toEqual({
      field: 'productList',
      multiValue: true,
    });
    expect(getEditableKnowledgeField(EnterpriseLeadKnowledgeItemKind.ContactRule)).toEqual({
      field: 'contactRules',
      multiValue: true,
    });
    expect(getEditableKnowledgeField(EnterpriseLeadKnowledgeItemKind.Source)).toBeNull();
  });

  test('summarizes creation record counts from run summary', () => {
    const summary = getCreationRecordSummary({
      run: {
        ...createRun('workspace-1'),
        id: 'run-counts',
      },
      taskCount: 3,
      deliverableCount: 2,
      todoCount: 4,
      riskCount: 1,
    });

    expect(summary.meta).toEqual([
      expect.objectContaining({ id: 'tasks', count: 3 }),
      expect.objectContaining({ id: 'deliverables', count: 2 }),
      expect.objectContaining({ id: 'todos', count: 4 }),
      expect.objectContaining({ id: 'risks', count: 1 }),
    ]);
  });

  test('builds creation record messages from a run snapshot', () => {
    const workspace = createWorkspace('workspace-1');
    const snapshot = createSnapshot(workspace);
    snapshot.currentRun = {
      ...createRun(workspace.id),
      userGoal: '验证动态 Agent 名称显示',
      controllerSummary: '总控已完成本次 UI 巡检。',
    };
    snapshot.tasks = [
      {
        ...createTask(workspace.id),
        agentSnapshot: {
          agentId: 'agent-a',
          name: '内容专家',
          description: '',
          identity: '',
          systemPrompt: '',
          icon: '',
          model: '',
          skillIds: [],
        },
        outputPayload: {
          deliverable: '动态 Agent 名称显示验证记录',
          passed: true,
        },
        summary: '动态 Agent 名称显示巡检任务已完成。',
      },
    ];

    const messages = buildCreationRecordConversationMessages(snapshot);

    expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'assistant']);
    expect(messages[0]).toMatchObject({
      id: 'run:run-1:goal',
      labelKey: 'enterpriseLeadCreationConversationUser',
      content: '验证动态 Agent 名称显示',
    });
    expect(messages[1]).toMatchObject({
      id: 'run:run-1:controller',
      labelKey: 'enterpriseLeadCreationConversationController',
      content: '推广工作流正在处理任务。',
    });
    expect(messages[2]).toMatchObject({
      id: 'task-content_planning:reply',
      labelText: '内容专家',
      content: '动态 Agent 名称显示巡检任务已完成。',
      details: [
        { key: 'deliverable', value: '动态 Agent 名称显示验证记录' },
        { key: 'passed', value: 'true' },
      ],
    });
  });

  test('uses safe localized controller status summaries in creation history', () => {
    const previousLanguage = i18nService.getLanguage();
    const workspace = createWorkspace('workspace-1');
    const snapshot = createSnapshot(workspace);
    snapshot.currentRun = {
      ...createRun(workspace.id),
      controllerSummary: 'Provider request failed: api-key=secret',
    };

    try {
      i18nService.setLanguage('zh', { persist: false });
      expect(buildCreationRecordConversationMessages(snapshot)[1]?.content).toBe(
        '推广工作流正在处理任务。',
      );

      i18nService.setLanguage('en', { persist: false });
      expect(buildCreationRecordConversationMessages(snapshot)[1]?.content).toBe(
        'Promotion workflow is processing tasks.',
      );
    } finally {
      i18nService.setLanguage(previousLanguage, { persist: false });
    }
  });

  test('uses a generic safe status when persisted controller data has an unknown status', () => {
    const workspace = createWorkspace('workspace-1');
    const snapshot = createSnapshot(workspace);
    snapshot.currentRun = {
      ...createRun(workspace.id),
      status: 'provider_failure' as EnterpriseLeadRunStatus,
      controllerSummary: 'Provider request failed: api-key=secret',
    };

    const messages = buildCreationRecordConversationMessages(snapshot);

    expect(messages[1]?.content).toBe(
      i18nService.t('enterpriseLeadWorkflowSummaryManualAttention'),
    );
    expect(messages[1]?.content).not.toContain('api-key=secret');
  });

  test('never includes persisted task errors in creation history', () => {
    const workspace = createWorkspace('workspace-1');
    const snapshot = createSnapshot(workspace);
    snapshot.tasks = [
      {
        ...createTask(workspace.id),
        summary: '',
        error: 'Provider request failed: api-key=secret',
        status: EnterpriseLeadTaskStatus.Error,
      },
    ];

    const messages = buildCreationRecordConversationMessages(snapshot);
    const taskMessage = messages.find(message => message.id === 'task-content_planning:reply');

    expect(taskMessage?.content).toBe(i18nService.t('enterpriseLeadAgentStatusError'));
    expect(taskMessage?.content).not.toContain('api-key=secret');
  });

  test('does not expose retired workspace Agent-team contracts', () => {
    [
      'EnterpriseLeadWorkbenchMode',
      'getEffectiveWorkspaceAgent',
      'getWorkspaceAgentDisplayName',
      'getPromotionDepartmentSections',
      'getWorkbenchAgentItems',
    ].forEach(symbol => {
      expect(workspaceUi).not.toHaveProperty(symbol);
    });
  });

  test('returns display metadata for dynamic workspace Agent tasks', () => {
    const display = getEnterpriseLeadTaskDisplay({
      role: 'agent-risk',
      agentSnapshot: {
        agentId: 'agent-risk',
        name: '空间风控 Agent',
        description: '检查外发内容风险',
        identity: '风控专家',
        systemPrompt: '只做风险审核',
        icon: 'shield',
        model: 'gpt-4.1',
        skillIds: ['risk-check'],
      },
    });

    expect(display).toMatchObject({
      role: 'agent-risk',
      titleText: '空间风控 Agent',
      descriptionText: '检查外发内容风险',
      outputText: '空间风控 Agent',
      safetyCritical: true,
    });
    expect(display.titleKey).toBeUndefined();
  });

  test('maps task statuses to agent card tone classes', () => {
    expect(getAgentCardTone(EnterpriseLeadTaskStatus.Running).containerClassName).toContain(
      'border-primary',
    );
    expect(getAgentCardTone(EnterpriseLeadTaskStatus.Error).statusClassName).toContain('text-red');
    expect(getAgentCardTone(EnterpriseLeadTaskStatus.Stale).actionClassName).toContain('bg-amber');
  });

  test('returns status label keys with stale state taking priority', () => {
    expect(getAgentStatusLabelKey(EnterpriseLeadTaskStatus.NeedsInput)).toBe(
      'enterpriseLeadAgentStatusNeedsInput',
    );
    expect(getAgentStatusLabelKey(EnterpriseLeadTaskStatus.Completed, true)).toBe(
      'enterpriseLeadAgentStatusStale',
    );
  });

  test('renders newly introduced workflow task statuses', () => {
    const statuses: EnterpriseLeadTaskStatus[] = [
      EnterpriseLeadTaskStatus.Ready,
      EnterpriseLeadTaskStatus.AwaitingApproval,
      EnterpriseLeadTaskStatus.Cancelled,
    ];

    expect(statuses.map(status => getAgentStatusLabelKey(status))).toEqual([
      'enterpriseLeadAgentStatusReady',
      'enterpriseLeadAgentStatusAwaitingApproval',
      'enterpriseLeadAgentStatusCancelled',
    ]);
    expect(getAgentCardTone(EnterpriseLeadTaskStatus.Ready).statusClassName).toContain(
      'text-primary',
    );
    expect(getAgentCardTone(EnterpriseLeadTaskStatus.AwaitingApproval).statusClassName).toContain(
      'text-amber',
    );
    expect(getAgentCardTone(EnterpriseLeadTaskStatus.Cancelled).statusClassName).toContain(
      'text-slate',
    );
  });

  test('detects task output from summary text or output payload', () => {
    expect(hasTaskOutput({ summary: '  Done  ', outputPayload: {} })).toBe(true);
    expect(hasTaskOutput({ summary: '', outputPayload: { draft: 'Draft text' } })).toBe(true);
    expect(hasTaskOutput({ summary: '', outputPayload: {} })).toBe(false);
  });

  test('rejects stale workspace operation tokens after workspace or revision changes', () => {
    const token = {
      workspaceId: 'workspace-1',
      revision: 2,
    };

    expect(isWorkspaceOperationCurrent(token, 'workspace-1', 2, true)).toBe(true);
    expect(isWorkspaceOperationCurrent(token, 'workspace-2', 2, true)).toBe(false);
    expect(isWorkspaceOperationCurrent(token, 'workspace-1', 3, true)).toBe(false);
    expect(isWorkspaceOperationCurrent(token, 'workspace-1', 2, false)).toBe(false);
  });

  test('defines workspace navigation without retired workflow and Agent-team pages', () => {
    expect(getWorkbenchSidebarItems().map(item => item.labelKey)).toEqual([
      'enterpriseLeadWorkbenchNavWorkbench',
      'enterpriseLeadWorkbenchNavAiChat',
      'enterpriseLeadWorkbenchNavSearch',
      'enterpriseLeadWorkbenchNavKnowledgeBase',
      'enterpriseLeadWorkspaceNavKits',
      'enterpriseLeadWorkbenchNavSettings',
    ]);
  });

  test('defines workspace internal pages in sidebar order', () => {
    expect(getWorkspaceInternalPages().map(page => page.id)).toEqual([
      'workbench',
      'ai_chat',
      'search',
      'knowledge_base',
      'kits',
      'settings',
    ]);
  });

  test('normalizes retired persisted workspace pages to accessible destinations', () => {
    expect(normalizeWorkspaceInternalPage('workflow')).toBe(
      EnterpriseLeadWorkspaceInternalPage.Workbench,
    );
    expect(normalizeWorkspaceInternalPage('agent_management')).toBe(
      EnterpriseLeadWorkspaceInternalPage.Workbench,
    );
    expect(normalizeWorkspaceInternalPage('creation_records')).toBe(
      EnterpriseLeadWorkspaceInternalPage.KnowledgeBase,
    );
    expect(normalizeWorkspaceInternalPage('kits')).toBe(EnterpriseLeadWorkspaceInternalPage.Kits);
    expect(normalizeWorkspaceInternalPage('unknown')).toBe(
      EnterpriseLeadWorkspaceInternalPage.Workbench,
    );
  });

  test('resolves start dashboard state for material workspaces', () => {
    const workspace = {
      ...createWorkspace('material'),
      profile: {
        ...emptyProfile(),
        companySummary: '服务汽车零部件企业的工业自动化方案。',
        targetCustomers: ['华东汽车零部件厂'],
        contactRules: ['避免夸大交付周期'],
      },
      extractionSources: [
        {
          kind: EnterpriseLeadExtractionSourceKind.File,
          label: '制造业客户名单.csv',
          text: '客户名单',
        },
      ],
    };

    expect(getWorkspaceStartSourceState(workspace)).toBe(
      EnterpriseLeadWorkspaceStartSourceState.Material,
    );
    expect(getWorkspaceStartReadiness(workspace).map(item => item.status)).toEqual([
      'ready',
      'ready',
      'ready',
    ]);
    expect(
      getWorkspaceStartActionTarget(
        EnterpriseLeadWorkspaceStartAction.AddMaterial,
        EnterpriseLeadWorkspaceStartSourceState.Material,
      ),
    ).toBe(EnterpriseLeadWorkspaceInternalPage.KnowledgeBase);
  });

  test('resolves start dashboard state for pasted-content workspaces', () => {
    const workspace = {
      ...createWorkspace('paste'),
      profile: {
        ...emptyProfile(),
        targetCustomers: ['跨境 SaaS 增长团队'],
      },
      extractionSources: [
        {
          kind: EnterpriseLeadExtractionSourceKind.Manual,
          label: '粘贴内容',
          text: '跨境 SaaS 线索池背景',
        },
      ],
    };

    expect(getWorkspaceStartSourceState(workspace)).toBe(
      EnterpriseLeadWorkspaceStartSourceState.Paste,
    );
    expect(getWorkspaceStartReadiness(workspace)[0].status).toBe('ready');
    expect(getWorkspaceStartReadiness(workspace)[1].status).toBe('ready');
    expect(
      getWorkspaceStartActionTarget(
        EnterpriseLeadWorkspaceStartAction.ReviewProfile,
        EnterpriseLeadWorkspaceStartSourceState.Paste,
      ),
    ).toBe(EnterpriseLeadWorkspaceInternalPage.KnowledgeBase);
  });

  test('guides blank workspaces back to material', () => {
    const workspace = {
      ...createWorkspace('blank'),
      extractionSources: [
        {
          kind: EnterpriseLeadExtractionSourceKind.Blank,
          label: '空白创建',
        },
      ],
    };

    expect(getWorkspaceStartSourceState(workspace)).toBe(
      EnterpriseLeadWorkspaceStartSourceState.Blank,
    );
    expect(getWorkspaceStartReadiness(workspace).map(item => item.status)).toEqual([
      'warning',
      'warning',
      'optional',
    ]);
    expect(
      getWorkspaceStartActionTarget(
        EnterpriseLeadWorkspaceStartAction.AddMaterial,
        EnterpriseLeadWorkspaceStartSourceState.Blank,
      ),
    ).toBe(EnterpriseLeadWorkspaceInternalPage.KnowledgeBase);
  });

  test('renders workspace shell as an in-space action sidebar', () => {
    const workspace = createWorkspace('sidebar');

    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceShell, {
        workspace,
        activePage: 'ai_chat',
        onPageChange: vi.fn(),
        children: React.createElement('div', null, 'Active page body'),
      }),
    );

    expect(markup).toContain('新对话');
    expect(markup).toContain('搜索');
    expect(markup).toContain('工作台');
    expect(markup).toContain('知识库');
    expect(markup).toContain('专家套件');
    expect(markup).toContain('空间技能');
    expect(markup).toContain('对话');
    expect(markup).not.toContain('空间设置');
    expect(markup).not.toContain('rounded-lg border border-border/70 bg-background/70 p-1');
    expect(markup).not.toContain('border-t border-border/70 pt-3');
    expect(markup).not.toContain('创作记录');
    expect(markup).not.toContain('推广工作流');
    expect(markup).not.toContain('Agent 团队');
    expect(markup).not.toContain('AI 对话');
    expect(markup).not.toContain('企业获客空间');
    expect(markup).not.toContain(workspace.name);
  });

  test('uses the search modal action for the workspace shell search nav item', () => {
    expect(getWorkspaceShellNavAction(EnterpriseLeadWorkspaceInternalPage.Search)).toBe(
      WorkspaceShellNavAction.OpenSearch,
    );
    expect(getWorkspaceShellNavAction(EnterpriseLeadWorkspaceInternalPage.Workbench)).toBe(
      WorkspaceShellNavAction.ChangePage,
    );
  });

  test('marks the workspace shell search nav item as opening a modal', () => {
    const workspace = createWorkspace('sidebar-search');

    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceShell, {
        workspace,
        activePage: 'workbench',
        onPageChange: vi.fn(),
        onSearchOpen: vi.fn(),
        children: React.createElement('div', null, 'Active page body'),
      }),
    );

    expect(markup).toContain('data-workspace-nav-action="open_search"');
  });

  test('renders a persistent exit action at the bottom of the workspace shell sidebar', () => {
    const workspace = createWorkspace('sidebar');

    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceShell, {
        workspace,
        activePage: 'workbench',
        onPageChange: vi.fn(),
        onExitWorkspace: vi.fn(),
        children: React.createElement('div', null, 'Active page body'),
      }),
    );

    expect(markup).toContain('返回空间列表');
    expect(markup).toContain('aria-label="返回空间列表"');
    expect(markup).toContain('shrink-0 border-t border-border/70 pt-3');
  });

  test('renders Codex-style Cowork chat history in the workspace shell sidebar', () => {
    const workspace = createWorkspace('sidebar');
    const chatSessions: WorkspaceConversationRecord[] = [
      {
        id: 'chat-1',
        title: '安装 oh-my-claudecode skill',
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
        updatedAt: new Date(Date.now() - 86_400_000).toISOString(),
        messageCount: 2,
      },
      {
        id: 'chat-2',
        title: '使用 GitHub 插件',
        createdAt: new Date(Date.now() - 172_800_000).toISOString(),
        updatedAt: new Date(Date.now() - 172_800_000).toISOString(),
        messageCount: 4,
      },
    ];

    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceShell, {
        workspace,
        activePage: 'ai_chat',
        onPageChange: vi.fn(),
        chatSessions,
        activeChatSessionId: 'chat-1',
        onChatSessionSelect: vi.fn(),
        children: React.createElement('div', null, 'Active page body'),
      }),
    );

    expect(markup).toContain('Cowork 对话');
    expect(markup).toContain('安装 oh-my-claudecode skill');
    expect(markup).toContain('使用 GitHub 插件');
    expect(markup).toContain('1 天');
    expect(markup).toContain('2 天');
    expect(markup).not.toContain(
      'rounded-full bg-background px-2 py-0.5 text-[11px] font-medium leading-4 text-tertiary ring-1 ring-border/70',
    );
    expect(markup).not.toContain('2 条');
    expect(markup).not.toContain('全部记录');
  });

  test('does not mark New Chat as current while a chat history row is current', () => {
    const workspace = createWorkspace('sidebar-active-chat');
    const chatSessions: WorkspaceConversationRecord[] = [
      {
        id: 'chat-1',
        title: '帮我出分析当前行业的形式',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:00:00.000Z',
        messageCount: 2,
      },
    ];

    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceShell, {
        workspace,
        activePage: 'ai_chat',
        onPageChange: vi.fn(),
        chatSessions,
        activeChatSessionId: 'chat-1',
        onChatSessionSelect: vi.fn(),
        children: React.createElement('div', null, 'Active page body'),
      }),
    );

    expect(markup.match(/aria-current="page"/g) ?? []).toHaveLength(1);
  });

  test('renders delete actions for workspace shell chat history rows', () => {
    const workspace = createWorkspace('sidebar');
    const chatSessions: WorkspaceConversationRecord[] = [
      {
        id: 'chat-1',
        title: '安装 oh-my-claudecode skill',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:00:00.000Z',
        messageCount: 2,
      },
    ];

    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceShell, {
        workspace,
        activePage: 'ai_chat',
        onPageChange: vi.fn(),
        chatSessions,
        activeChatSessionId: 'chat-1',
        onChatSessionSelect: vi.fn(),
        onChatSessionDelete: vi.fn(),
        children: React.createElement('div', null, 'Active page body'),
      }),
    );

    expect(markup).toContain('data-testid="enterprise-lead-chat-session-delete"');
    expect(markup).toContain('aria-label="删除 Cowork 对话 安装 oh-my-claudecode skill"');
    expect(markup).toContain('安装 oh-my-claudecode skill');
  });

  test('does not render recent execution record list in the workspace shell sidebar', () => {
    const workspace = createWorkspace('sidebar');

    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceShell, {
        workspace,
        activePage: 'ai_chat',
        onPageChange: vi.fn(),
        children: React.createElement('div', null, 'Active page body'),
      }),
    );

    expect(markup).not.toContain('2 条');
    expect(markup).not.toContain('全部记录');
    expect(markup).not.toContain('帮我找长三角机械厂线索');
    expect(markup).not.toContain('运行中');
    expect(markup).not.toContain('整理本周可跟进的机械厂线索');
    expect(markup).not.toContain('需补充');
    expect(markup).not.toContain('2 成果');
    expect(markup).not.toContain('7 待办');
    expect(markup).not.toContain('5 风险');
  });

  test('does not render an empty state for workspace shell recent records', () => {
    const workspace = createWorkspace('sidebar-empty');

    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceShell, {
        workspace,
        activePage: 'workbench',
        onPageChange: vi.fn(),
        children: React.createElement('div', null, 'Active page body'),
      }),
    );

    expect(markup).not.toContain('还没有对话记录');
    expect(markup).not.toContain('完成一次工作台任务后会出现在这里。');
  });

  test('renders workspace start dashboard with next actions and readiness', () => {
    const workspace = {
      ...createWorkspace('start'),
      profile: {
        ...emptyProfile(),
        targetCustomers: ['华东汽车零部件厂'],
      },
      extractionSources: [
        {
          kind: EnterpriseLeadExtractionSourceKind.File,
          label: '制造业客户名单.csv',
          text: '包含客户名称、区域和行业标签。',
        },
      ],
    };
    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceStart, {
        workspace,
        onOpenPage: vi.fn(),
      }),
    );

    expect(markup).toContain('已创建');
    expect(markup).toContain('上传资料');
    expect(markup).toContain('下一步');
    expect(markup).toContain('查看业务画像');
    expect(markup).not.toContain('开始生成线索动作');
    expect(markup).toContain('准备进度');
    expect(markup).toContain('当前资料');
    expect(markup).toContain('制造业客户名单.csv');
  });

  test('prefers the requested creation record when it exists', () => {
    const summaries = [
      createRunSummary('workspace-1', { id: 'run-newest' }),
      createRunSummary('workspace-1', { id: 'run-target' }),
    ];

    expect(getInitialCreationRecordId(summaries, 'run-target')).toBe('run-target');
    expect(getInitialCreationRecordId(summaries, 'missing-run')).toBe('run-newest');
    expect(getInitialCreationRecordId([], 'run-target')).toBeNull();
  });

  test('renders workspace settings as a focused space skills manager', () => {
    const workspace = createWorkspace('workspace-1');
    workspace.settings.model.providers.deepseek = {
      enabled: true,
      apiKey: 'sk-deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek V4 Pro' }],
    };
    workspace.settings.model.defaultModelProvider = 'deepseek';
    workspace.settings.model.defaultModel = 'deepseek-chat';
    workspace.settings.skillIds = ['docx', 'web-search'];
    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceSettings, { workspace }),
    );

    expect(markup).toContain('空间技能');
    expect(markup).toContain('空间能力');
    expect(markup).toContain('获客内容包');
    expect(markup).toContain('选择一个能力包');
    expect(markup).toContain('技能明细');
    expect(markup).toContain('文档处理');
    expect(markup).toContain('联网搜索');
    expect(markup).toContain('管理技能');
    expect(markup).toContain('已安装');
    expect(markup).toContain('技能市场');
    expect(markup).toContain('保存配置');
    expect(markup).not.toContain('推荐配置已就绪');
    expect(markup).not.toContain('基础配置');
    expect(markup).not.toContain('默认模型');
    expect(markup).not.toContain('联网调研');
    expect(markup).not.toContain('高级设置');
    expect(markup).not.toContain('高级模型设置');
    expect(markup).not.toContain('调研来源');
    expect(markup).not.toContain('内容投递与风控');
    expect(markup).not.toContain('测试模型连接');
    expect(markup).not.toContain('测试连接');
    expect(markup).not.toContain('小红书草稿');
    expect(markup).not.toContain('配置调研和输出');
    expect(markup).not.toContain('完成快速设置后即可开始任务');
    expect(markup).not.toContain('大模型厂商配置');
    expect(markup).not.toContain('外部调研能力管理');
  });

  test('summarizes workspace settings readiness across model, research, and content platforms', () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.model.providers.deepseek = {
      enabled: true,
      apiKey: 'sk-deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
    };
    settings.model.defaultModelProvider = 'deepseek';
    settings.model.defaultModel = 'deepseek-chat';
    settings.externalResearch.providers.tavily = {
      enabled: true,
      apiKey: 'tvly-key',
    };
    settings.contentPlatforms.platforms.xiaohongshu_draft = {
      ...settings.contentPlatforms.platforms.xiaohongshu_draft,
      enabled: true,
      deliveryMode: EnterpriseLeadContentDeliveryMode.ThirdPartyDraft,
      endpoint: 'https://draft.example.com/xhs',
      token: 'xhs-token',
    };
    settings.contentPlatforms.outputRules.defaultPlatformId =
      EnterpriseLeadContentOutputPlatformId.XiaohongshuDraft;

    expect(getWorkspaceSettingsReadiness(settings).map(item => item.statusKey)).toEqual([
      'enterpriseLeadWorkspaceSettingsReady',
      'enterpriseLeadWorkspaceSettingsReady',
      'enterpriseLeadWorkspaceSettingsReady',
    ]);

    settings.externalResearch.providers.tavily.apiKey = '';
    settings.contentPlatforms.platforms.xiaohongshu_draft.endpoint = '';

    expect(getWorkspaceSettingsReadiness(settings).map(item => item.statusKey)).toEqual([
      'enterpriseLeadWorkspaceSettingsReady',
      'enterpriseLeadWorkspaceSettingsNeedsSetup',
      'enterpriseLeadWorkspaceSettingsNeedsSetup',
    ]);
  });

  test('treats local content output modes as usable without external credentials', () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    const platform =
      settings.contentPlatforms.platforms[EnterpriseLeadContentOutputPlatformId.XiaohongshuDraft];

    expect(platform.deliveryMode).toBe('draft_only');
    expect(getContentPlatformConnectionStatus(platform).statusKey).toBe(
      'enterpriseLeadWorkbenchStatusConfigured',
    );
    expect(
      getWorkspaceSettingsReadiness(settings).find(item => item.id === 'content')?.statusKey,
    ).toBe('enterpriseLeadWorkspaceSettingsReady');
    expect(getWorkspaceSettingsBlockingIssues(settings)).toEqual([]);
  });

  test('blocks remote content delivery modes when required connection fields are missing', () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.contentPlatforms.platforms[
      EnterpriseLeadContentOutputPlatformId.XiaohongshuDraft
    ].deliveryMode = 'third_party_draft';
    settings.contentPlatforms.platforms[
      EnterpriseLeadContentOutputPlatformId.SalesMessage
    ].deliveryMode = 'wecom_draft';
    settings.contentPlatforms.platforms[
      EnterpriseLeadContentOutputPlatformId.WechatArticle
    ].enabled = true;

    expect(getWorkspaceSettingsBlockingIssues(settings).map(issue => issue.statusKey)).toEqual([
      'enterpriseLeadWorkbenchContentPlatformMissingEndpoint',
      'enterpriseLeadWorkbenchContentPlatformMissingEndpoint',
      'enterpriseLeadWorkbenchContentPlatformMissingSecret',
    ]);
  });

  test('identifies missing workspace setting credentials before marking providers ready', () => {
    expect(
      getModelProviderConnectionStatus('deepseek', {
        enabled: true,
        apiKey: '',
        baseUrl: 'https://api.deepseek.com',
        apiFormat: 'openai',
        models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
      }).statusKey,
    ).toBe('enterpriseLeadWorkbenchProviderMissingApiKey');

    expect(
      getModelProviderConnectionStatus('deepseek', {
        enabled: true,
        apiKey: 'sk-deepseek',
        baseUrl: 'https://api.deepseek.com',
        apiFormat: 'openai',
        models: [],
      }).statusKey,
    ).toBe('enterpriseLeadWorkbenchProviderMissingModel');

    expect(
      getModelProviderConnectionStatus('custom_0', {
        enabled: true,
        apiKey: 'sk-custom',
        baseUrl: '',
        apiFormat: 'openai',
        models: [{ id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3' }],
      }).statusKey,
    ).toBe('enterpriseLeadWorkbenchProviderMissingBaseUrl');

    expect(
      getExternalResearchProviderConnectionStatus({
        enabled: true,
        apiKey: '',
      }).statusKey,
    ).toBe('enterpriseLeadWorkbenchResearchMissingApiKey');
  });

  test('collects incomplete enabled workspace settings as save blockers', () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.model.providers.deepseek = {
      enabled: true,
      apiKey: '',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
    };
    settings.externalResearch.providers.tavily = {
      enabled: true,
      apiKey: '',
    };
    settings.contentPlatforms.platforms[
      EnterpriseLeadContentOutputPlatformId.CustomWebhook
    ].enabled = true;

    expect(getWorkspaceSettingsBlockingIssues(settings).map(issue => issue.statusKey)).toEqual([
      'enterpriseLeadWorkbenchProviderMissingApiKey',
      'enterpriseLeadWorkbenchResearchMissingApiKey',
      'enterpriseLeadWorkbenchContentPlatformMissingWebhook',
    ]);
  });

  test('blocks saving when the selected workspace default model is unavailable', () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    settings.model.providers.deepseek = {
      enabled: true,
      apiKey: 'sk-deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
    };
    settings.model.defaultModelProvider = 'deepseek';
    settings.model.defaultModel = 'missing-model';

    expect(getWorkspaceSettingsBlockingIssues(settings).map(issue => issue.statusKey)).toContain(
      'enterpriseLeadWorkbenchDefaultModelUnavailable',
    );
  });

  test('does not block space skill management with non-skill provider credentials', () => {
    const workspace = createWorkspace('workspace-1');
    workspace.settings.model.providers.deepseek = {
      enabled: true,
      apiKey: '',
      baseUrl: 'https://api.deepseek.com',
      apiFormat: 'openai',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
    };

    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceSettings, { workspace }),
    );

    expect(markup).toContain('空间技能');
    expect(markup).toContain('保存空间技能');
    expect(markup).not.toContain('请补齐：缺少 API Key');
  });

  test('hides custom workspace model provider controls from space skills', () => {
    const workspace = createWorkspace('workspace-1');
    workspace.settings.model.providers.custom_0 = {
      enabled: true,
      apiKey: 'sk-siliconflow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiFormat: 'openai',
      displayName: '硅基流动',
      models: [{ id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3' }],
    };
    workspace.settings.model.defaultModelProvider = 'custom_0';
    workspace.settings.model.defaultModel = 'deepseek-ai/DeepSeek-V3';

    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceSettings, { workspace }),
    );

    expect(markup).toContain('空间技能');
    expect(markup).toContain('技能明细');
    expect(markup).not.toContain('新增模型厂商');
    expect(markup).not.toContain('厂商名称');
    expect(markup).not.toContain('硅基流动');
  });

  test('searches current workspace profile, sources, and workspace Agents', () => {
    const workspace = createWorkspace('workspace-1');
    workspace.profile.productList = ['精密金属支架'];
    workspace.extractionSources = [
      {
        kind: 'document',
        label: '销售话术文档',
        text: '跟进节奏和禁用表达',
      },
    ];
    workspace.workspaceAgents = [
      {
        agentId: 'agent-a',
        enabled: true,
        order: 0,
        overrides: {
          name: '商机雷达',
          description: '查找自动化设备厂线索',
        },
      },
    ];

    const productResults = buildWorkspaceSearchResults(workspace, '支架');
    expect(productResults.map(result => result.title)).toContain('精密金属支架');

    const sourceResults = buildWorkspaceSearchResults(workspace, '话术');
    expect(sourceResults.map(result => result.title)).toContain('销售话术文档');

    const agentResults = buildWorkspaceSearchResults(workspace, '商机');
    expect(agentResults.map(result => result.title)).toContain('商机雷达');
  });

  test('shows recent Cowork conversations before profile search when query is empty', () => {
    const workspace = createWorkspace('workspace-1');
    workspace.profile.productList = ['精密金属支架'];
    const chatSessions: WorkspaceConversationRecord[] = [
      {
        id: 'chat-1',
        title: '你好1',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:00:00.000Z',
        messageCount: 2,
      },
    ];

    const results = buildWorkspaceSearchResults(workspace, '', chatSessions);

    expect(results.map(result => result.title)).toEqual(['你好1']);
    expect(results[0]?.areaLabelKey).toBe('enterpriseLeadWorkspaceSearchAreaConversations');
  });

  test('renders workspace search page with local workspace results', () => {
    const workspace = createWorkspace('workspace-1');
    workspace.profile.sellingPoints = ['交付稳定'];

    const markup = renderEnterpriseLeadComponent(
      React.createElement(WorkspaceSearch, { workspace }),
    );

    expect(markup).toContain('搜索');
    expect(markup).toContain('搜索 Cowork 对话、当前空间画像、来源和 Agent 配置');
    expect(markup).toContain('交付稳定');
  });

  test('workspace settings save sends only settings', async () => {
    const settings = buildDefaultEnterpriseLeadWorkspaceSettings();
    const updateWorkspaceSettings = vi
      .spyOn(enterpriseLeadWorkspaceService, 'updateWorkspaceSettings')
      .mockResolvedValue(createWorkspace('workspace-1'));
    const onSaved = vi.fn();
    const onError = vi.fn();

    await saveWorkspaceSettingsDraft({
      workspaceId: 'workspace-1',
      draftSettings: settings,
      onSaved,
      onError,
    });

    expect(updateWorkspaceSettings).toHaveBeenCalledWith('workspace-1', {
      settings,
    });
    expect(updateWorkspaceSettings.mock.calls[0]?.[1]).not.toHaveProperty('enabledAgentRoles');
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'workspace-1' }));
    expect(onError).not.toHaveBeenCalled();
  });
});
